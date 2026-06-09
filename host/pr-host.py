#!/usr/bin/env python3
"""Chrome Native Messaging host (push): active-prs 변경을 fswatch로 감지해 즉시 push한다.

connectNative로 연결되면 현재 목록을 1회 push하고, 이후 ~/.claude/active-prs/ 가
바뀔 때마다 push한다. 소스는 Claude hook이 기록한 세션 파일뿐 (gh 등 외부 명령 없음).
Chrome이 spawn하며, port가 닫히면(=stdin EOF) 종료한다.
"""
import sys, os, re, struct, json, glob, time, select, subprocess

# Chrome가 spawn하는 프로세스는 PATH가 최소라 fswatch를 못 찾음 → 보강
os.environ["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + os.environ.get("PATH", "/usr/bin:/bin")

ACTIVE_DIR = os.path.expanduser("~/.claude/active-prs")
TTL = 24 * 3600  # SessionEnd 누락(크래시) 세션 파일을 이 시간 뒤 청소


def send_message(obj):
    data = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)))  # 4바이트 LE 길이 = NM 프로토콜
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def active_session_prs():
    prs = {}
    now = time.time()
    for path in glob.glob(os.path.join(ACTIVE_DIR, "*.json")):
        try:
            if now - os.path.getmtime(path) > TTL:
                os.remove(path)
                continue
        except OSError:
            continue
        try:
            with open(path) as f:
                entry = json.load(f)
        except Exception:
            continue
        pr = entry.get("pr")
        # state 가 OPEN 인 것만 (머지/클로즈된 PR은 폴더에서 제외)
        if isinstance(pr, dict) and pr.get("url") and (pr.get("state") or "OPEN") == "OPEN":
            prs[pr["url"]] = pr
    return prs


def platform_tag(url):
    m = re.search(r"github\.com/[^/]+/([^/]+)", url)
    repo = m.group(1) if m else ""
    low = repo.lower()
    if low == "unni-android":
        return "Android"
    if low == "unni-ios":
        return "iOS"
    return repo or "?"  # 그 외 레포는 레포명 그대로


def sort_key(pr):
    tag = platform_tag(pr["url"])
    rank = 0 if tag == "Android" else 1 if tag == "iOS" else 2
    title = pr.get("title", pr["url"])
    m = re.search(r"\[([A-Za-z]+)-(\d+)\]", title)
    # 티켓 있으면 (프로젝트 키, 번호)순, 없으면 그룹 맨 뒤. 번호는 정수 비교.
    ticket = (0, m.group(1), int(m.group(2))) if m else (1, "", 0)
    return (rank, tag, ticket, title)


def build_bookmarks():
    prs = sorted(active_session_prs().values(), key=sort_key)
    return [{"title": f"[{platform_tag(pr['url'])}] {pr.get('title', pr['url'])}",
             "url": pr["url"]}
            for pr in prs]


def push():
    send_message({"bookmarks": build_bookmarks()})


def main():
    os.makedirs(ACTIVE_DIR, exist_ok=True)
    # -o: 변경을 배치해 배치당 한 줄, -l 0.2: 200ms 디바운스
    fsw = subprocess.Popen(["fswatch", "-o", "-l", "0.2", ACTIVE_DIR], stdout=subprocess.PIPE)
    stdin_fd, fsw_fd = sys.stdin.fileno(), fsw.stdout.fileno()
    try:
        push()  # 연결 직후 현재 상태
        while True:
            ready, _, _ = select.select([stdin_fd, fsw_fd], [], [])
            if fsw_fd in ready:
                if not fsw.stdout.readline():  # fswatch 종료
                    break
                push()
            if stdin_fd in ready:
                if not os.read(stdin_fd, 65536):  # stdin EOF = port 닫힘
                    break
    except (BrokenPipeError, OSError):
        pass  # port가 닫히는 중 — 조용히 종료
    finally:
        fsw.terminate()


if __name__ == "__main__":
    main()
