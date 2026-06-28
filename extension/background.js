const HOST = "com.forky.prbookmark";
const FOLDER_TITLE = "🔥 Active PRs";
const RECONNECT_ALARM = "ensure-connection";
const RECONNECT_MINUTES = 1; // SW가 죽었을 때 재연결을 보장하는 안전망 (데이터 폴링 아님)

let port = null;

function connect() {
  if (port) return;
  port = chrome.runtime.connectNative(HOST);
  port.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.bookmarks) syncFolder(msg.bookmarks).catch((e) => console.error("[PRBookmark] sync:", e)); // fswatch push (조용히)
    if ("add" in msg || "remove" in msg) applyManualSync(msg).catch((e) => console.error("[PRBookmark] manual:", e)); // 아이콘 클릭 응답
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
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); connect(); manualSync(); });
chrome.action.onClicked.addListener(() => { connect(); manualSync(); }); // 아이콘 클릭 = 수동 동기화 (내 PR 추가 + 머지·클로즈 정리)
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

// add-only 동기화: 폴더에 없는 PR만 추가하고 삭제는 하지 않는다. 추가한 개수를 반환.
// 추가 후 폴더 전체를 정렬 순서로 재배치 — 정렬을 사용자 수동 순서보다 우선한다.
async function syncFolder(desired) {
  const folder = await ensureFolder();
  const existing = await chrome.bookmarks.getChildren(folder.id);
  const existingUrls = new Set(existing.filter((e) => e.url).map((e) => e.url));

  let added = 0;
  for (const d of desired) {
    if (!existingUrls.has(d.url)) {
      await chrome.bookmarks.create({ parentId: folder.id, title: d.title, url: d.url });
      added++;
    }
  }

  await sortFolder(folder.id);
  return added;
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

// 아이콘 클릭·크롬 시작 시: 폴더 PR의 머지/클로즈 조회(check) + healingpaper 내 open PR 발견(discover)을 요청.
// 주기 폴링 대신 이벤트로만 — check 소스는 세션 파일이 아니라 폴더 자체라 세션이 끝난 PR도 검사된다.
async function manualSync() {
  const folder = await ensureFolder();
  const kids = await chrome.bookmarks.getChildren(folder.id);
  const urls = kids.filter((k) => k.url).map((k) => k.url);
  if (!port) return; // 폴더가 비어 있어도 discover 는 해야 하므로 urls 길이는 보지 않는다
  try {
    port.postMessage({ check: urls, discover: true });
    chrome.action.setBadgeBackgroundColor({ color: "#8c959f" });
    chrome.action.setBadgeText({ text: "…" }); // 조회 중 (응답 오면 flashBadge가 덮어씀)
  } catch (e) {
    port = null;
    console.warn("[PRBookmark] manualSync send failed:", e.message); // 끊긴 port → 다음 이벤트가 재연결
  }
}

// 아이콘 클릭 응답: 발견된 내 PR 추가 + 머지/클로즈 PR 제거를 한 번에 처리하고 결과를 badge로.
async function applyManualSync(msg) {
  const removed = msg.remove ? await removeUrls(msg.remove) : 0;
  const added = msg.add ? await syncFolder(msg.add) : 0;
  flashBadge(added, removed);
}

// 주어진 URL들을 폴더에서 제거하고 제거 개수를 반환. (세션 종료·TTL로는 지우지 않음 — add-only 유지)
async function removeUrls(urls) {
  const folder = await ensureFolder();
  const kids = await chrome.bookmarks.getChildren(folder.id);
  const gone = new Set(urls);
  let n = 0;
  for (const k of kids) {
    if (k.url && gone.has(k.url)) { await chrome.bookmarks.remove(k.id); n++; }
  }
  return n;
}

// 결과를 아이콘 badge로 ~4초 표시: 추가 우선 "+m", 없으면 제거 "-n", 둘 다 없으면 "✓".
function flashBadge(added, removed) {
  const text = added > 0 ? `+${added}` : removed > 0 ? `-${removed}` : "✓";
  chrome.action.setBadgeBackgroundColor({ color: added > 0 || removed > 0 ? "#1a7f37" : "#8c959f" });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 4000);
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
