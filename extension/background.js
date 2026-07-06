const HOST = "com.forky.prbookmark";
const FOLDER_TITLE = "🔥 Active PRs";
const RECONNECT_ALARM = "ensure-connection";
const RECONNECT_MINUTES = 1; // SW가 죽었을 때 재연결을 보장하는 안전망 (데이터 폴링 아님)

const log = (...a) => console.log("[PRBookmark]", ...a);
const warn = (...a) => console.warn("[PRBookmark]", ...a);
const err = (...a) => console.error("[PRBookmark]", ...a);

let port = null;

function connect() {
  if (port) { log("connect: 이미 연결됨 — skip"); return; }
  log("connect: connectNative →", HOST);
  port = chrome.runtime.connectNative(HOST);
  port.onMessage.addListener((msg) => {
    log("onMessage 수신:", msg ? Object.keys(msg).join(",") : "(null)",
        msg?.bookmarks ? `bookmarks=${msg.bookmarks.length}` : "",
        msg?.add ? `add=${msg.add.length}` : "",
        msg?.remove ? `remove=${msg.remove.length}` : "");
    if (!msg) return;
    if (msg.bookmarks) syncFolder(msg.bookmarks).catch((e) => err("sync:", e)); // fswatch push
    if ("add" in msg || "remove" in msg) applyManualSync(msg).catch((e) => err("manual:", e)); // 아이콘 클릭 응답
  });
  port.onDisconnect.addListener(() => {
    const e = chrome.runtime.lastError;
    warn("disconnected:", e && e.message);
    port = null; // 재연결은 알람/다음 SW 기동이 담당 — 핫루프 방지
  });
  log("connect: port 생성 완료");
}

function ensureAlarm() {
  log("ensureAlarm:", RECONNECT_ALARM, `(${RECONNECT_MINUTES}m)`);
  chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: RECONNECT_MINUTES });
}

chrome.runtime.onInstalled.addListener(() => { log("event onInstalled"); ensureAlarm(); connect(); });
chrome.runtime.onStartup.addListener(() => { log("event onStartup"); ensureAlarm(); connect(); manualSync(); });
chrome.action.onClicked.addListener(() => { log("event action.onClicked → 수동 동기화"); connect(); manualSync(); });
chrome.alarms.onAlarm.addListener((a) => { log("event onAlarm:", a.name); if (a.name === RECONNECT_ALARM) connect(); });

log("SW 기동 — connect() 호출"); // 알람이 죽은 SW를 깨우면 여기서 다시 연결됨
connect();

async function getBar() {
  const [root] = await chrome.bookmarks.getTree();
  const bar = root.children.find((c) => c.id === "1") || root.children[0];
  log("getBar:", bar?.title, `(id=${bar?.id})`);
  return bar;
}

async function ensureFolder() {
  const bar = await getBar();
  const kids = await chrome.bookmarks.getChildren(bar.id);
  const found = kids.find((k) => !k.url && k.title === FOLDER_TITLE);
  if (found) { log("ensureFolder: 기존 폴더", `(id=${found.id})`); return found; }
  const created = await chrome.bookmarks.create({ parentId: bar.id, title: FOLDER_TITLE });
  log("ensureFolder: 폴더 생성", `(id=${created.id})`);
  return created;
}

// add-only 동기화: 폴더에 없는 PR만 추가하고 삭제는 하지 않는다. 추가한 개수를 반환.
// 추가 후 폴더 전체를 정렬 순서로 재배치 — 정렬을 사용자 수동 순서보다 우선한다.
async function syncFolder(desired) {
  log("syncFolder 시작: desired =", desired.length);
  const folder = await ensureFolder();
  const existing = await chrome.bookmarks.getChildren(folder.id);
  const existingUrls = new Set(existing.filter((e) => e.url).map((e) => e.url));

  let added = 0;
  for (const d of desired) {
    if (!existingUrls.has(d.url)) {
      await chrome.bookmarks.create({ parentId: folder.id, title: d.title, url: d.url });
      log("  + 추가:", d.title);
      added++;
    }
  }
  log(`syncFolder 완료: ${added}건 추가 (기존 ${existingUrls.size}건)`);
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
async function manualSync() {
  log("manualSync 시작");
  const folder = await ensureFolder();
  const kids = await chrome.bookmarks.getChildren(folder.id);
  const urls = kids.filter((k) => k.url).map((k) => k.url);
  if (!port) { warn("manualSync: port 없음 — 전송 skip (다음 이벤트가 재연결)"); return; }
  try {
    log("manualSync: postMessage → check =", urls.length, ", discover = true");
    port.postMessage({ check: urls, discover: true });
    chrome.action.setBadgeBackgroundColor({ color: "#8c959f" });
    chrome.action.setBadgeText({ text: "…" }); // 조회 중 (응답 오면 flashBadge가 덮어씀)
  } catch (e) {
    port = null;
    warn("manualSync send failed:", e.message); // 끊긴 port → 다음 이벤트가 재연결
  }
}

// 아이콘 클릭 응답: 발견된 내 PR 추가 + 머지/클로즈 PR 제거를 한 번에 처리하고 결과를 badge로.
async function applyManualSync(msg) {
  log("applyManualSync: remove =", msg.remove?.length || 0, ", add =", msg.add?.length || 0);
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
    if (k.url && gone.has(k.url)) { await chrome.bookmarks.remove(k.id); log("  - 제거:", k.title); n++; }
  }
  log(`removeUrls 완료: ${n}건 제거`);
  return n;
}

// 결과를 아이콘 badge로 ~4초 표시: 추가 우선 "+m", 없으면 제거 "-n", 둘 다 없으면 "✓".
function flashBadge(added, removed) {
  const text = added > 0 ? `+${added}` : removed > 0 ? `-${removed}` : "✓";
  log("flashBadge:", text, `(added=${added}, removed=${removed})`);
  chrome.action.setBadgeBackgroundColor({ color: added > 0 || removed > 0 ? "#1a7f37" : "#8c959f" });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 4000);
}

// 정렬된 순서로 in-place 재배치. 이미 제자리인 항목은 move를 건너뛴다(불필요한 변경 이벤트 방지).
async function sortFolder(folderId) {
  const order = await chrome.bookmarks.getChildren(folderId);
  const sorted = [...order].sort(compareBookmarks);
  let moves = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (order[i].id === sorted[i].id) continue;
    await chrome.bookmarks.move(sorted[i].id, { parentId: folderId, index: i });
    const from = order.findIndex((b) => b.id === sorted[i].id);
    order.splice(i, 0, order.splice(from, 1)[0]);  // 로컬 순서도 동기화해 다음 비교를 정확히
    moves++;
  }
  log(`sortFolder 완료: ${order.length}개 중 ${moves}개 이동`);
}
