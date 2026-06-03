const HOST = "com.forky.prbookmark";
const FOLDER_TITLE = "🔥 Active PRs";
const RECONNECT_ALARM = "ensure-connection";
const RECONNECT_MINUTES = 1; // SW가 죽었을 때 재연결을 보장하는 안전망 (데이터 폴링 아님)

let port = null;

function connect() {
  if (port) return;
  port = chrome.runtime.connectNative(HOST);
  port.onMessage.addListener((msg) => {
    syncFolder((msg && msg.bookmarks) || []).catch((e) => console.error("[PRBookmark] sync:", e));
  });
  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError;
    console.warn("[PRBookmark] disconnected:", err && err.message);
    port = null; // 재연결은 알람/다음 SW 기동이 담당 — 핫루프 방지
  });
}

function ensureAlarm() {
  chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: RECONNECT_MINUTES });
}

chrome.runtime.onInstalled.addListener(() => { ensureAlarm(); connect(); });
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); connect(); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === RECONNECT_ALARM) connect(); });

connect(); // SW 기동 시마다 연결 보장 (알람이 죽은 SW를 깨우면 여기서 다시 연결됨)

async function getBar() {
  const [root] = await chrome.bookmarks.getTree();
  return root.children.find((c) => c.id === "1") || root.children[0];
}

async function ensureFolder() {
  const bar = await getBar();
  const kids = await chrome.bookmarks.getChildren(bar.id);
  return (
    kids.find((k) => !k.url && k.title === FOLDER_TITLE) ||
    (await chrome.bookmarks.create({ parentId: bar.id, title: FOLDER_TITLE }))
  );
}

// url을 키로 멱등 동기화: 사라진 건 remove, 새 건 create, 제목 바뀐 건 update, 순서는 move로 맞춤
async function syncFolder(desired) {
  const folder = await ensureFolder();
  const existing = await chrome.bookmarks.getChildren(folder.id);
  const desiredUrls = new Set(desired.map((d) => d.url));
  const existingByUrl = new Map(existing.filter((e) => e.url).map((e) => [e.url, e]));

  for (const e of existing) {
    if (e.url && !desiredUrls.has(e.url)) await chrome.bookmarks.remove(e.id);
  }
  for (let i = 0; i < desired.length; i++) {
    const d = desired[i];
    const ex = existingByUrl.get(d.url);
    if (!ex) {
      await chrome.bookmarks.create({ parentId: folder.id, title: d.title, url: d.url, index: i });
    } else {
      if (ex.title !== d.title) await chrome.bookmarks.update(ex.id, { title: d.title });
      await chrome.bookmarks.move(ex.id, { parentId: folder.id, index: i });
    }
  }
}
