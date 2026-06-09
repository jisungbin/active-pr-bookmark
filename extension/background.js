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

// add-only 동기화: 폴더에 없는 PR만 추가하고 삭제는 하지 않는다.
// 추가 후 폴더 전체를 정렬 순서로 재배치 — 정렬을 사용자 수동 순서보다 우선한다.
async function syncFolder(desired) {
  const folder = await ensureFolder();
  const existing = await chrome.bookmarks.getChildren(folder.id);
  const existingUrls = new Set(existing.filter((e) => e.url).map((e) => e.url));

  for (const d of desired) {
    if (!existingUrls.has(d.url)) {
      await chrome.bookmarks.create({ parentId: folder.id, title: d.title, url: d.url });
    }
  }

  await sortFolder(folder.id);
}

// [Android] → [iOS] → 기타 레포 순, 각 그룹 안에서는 티켓(프로젝트 키 → 번호)순.
// 번호는 정수로 비교 — 문자열 정렬이면 SEARCH-1200 이 SEARCH-672 앞에 온다.
function sortKey(title) {
  const m = title.match(/^\[([^\]]+)\](?:\s*\[([A-Za-z]+)-(\d+)\])?/);
  const platform = m ? m[1] : "";
  const rank = platform === "Android" ? 0 : platform === "iOS" ? 1 : 2;
  const ticket = !!(m && m[2]);
  return { rank, platform, ticket, project: ticket ? m[2] : "", num: ticket ? parseInt(m[3], 10) : 0 };
}

function compareBookmarks(a, b) {
  const x = sortKey(a.title), y = sortKey(b.title);
  return x.rank - y.rank
    || x.platform.localeCompare(y.platform)
    || (x.ticket === y.ticket ? 0 : x.ticket ? -1 : 1)  // 티켓 없는 항목은 그룹 맨 뒤
    || x.project.localeCompare(y.project)
    || x.num - y.num
    || a.title.localeCompare(b.title);
}

// 정렬된 순서로 in-place 재배치. 이미 제자리인 항목은 move를 건너뛴다(불필요한 변경 이벤트 방지).
async function sortFolder(folderId) {
  const order = await chrome.bookmarks.getChildren(folderId);
  const sorted = [...order].sort(compareBookmarks);
  for (let i = 0; i < sorted.length; i++) {
    if (order[i].id === sorted[i].id) continue;
    await chrome.bookmarks.move(sorted[i].id, { parentId: folderId, index: i });
    const from = order.findIndex((b) => b.id === sorted[i].id);
    order.splice(i, 0, order.splice(from, 1)[0]);  // 로컬 순서도 동기화해 다음 비교를 정확히
  }
}
