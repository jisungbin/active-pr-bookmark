# Active PR Bookmark Sync

**Claude 세션에서 작업 중인** open PR을 Chrome 북마크 바의 **🔥 Active PRs** 폴더에 자동 동기화한다.
표시: 🔥 ready · ⚪ draft.

## 구조 (B안 — fswatch push, macOS 앱 없음)

```
Claude hook (bash)  ──쓰기──> ~/.claude/active-prs/<session_id>.json
                                         │ 파일 변경
                                         ▼ fswatch 감지
Chrome Extension  ◀───push─── host/pr-host.py (영속, connectNative)
       │                      active-prs 파일만 읽음 (gh 호출 없음)
       ▼
  폴더와 diff → chrome.bookmarks 갱신
```

- **Extension**: 북마크를 만질 수 있는 유일한 주체. 호스트와 connectNative로 연결해두고, **push가 올 때만** 폴더를 멱등 동기화 (주기 폴링 없음).
- **호스트(`pr-host.py`)**: Chrome이 spawn하는 **영속** 스크립트. `fswatch`로 active-prs 변경을 감지해 즉시 push (외부 명령 호출 안 함).
- **hook**: 작업 중인 PR을 기록하는 **유일한 소스**. hook이 없으면 폴더는 빈 채로 유지됨.

## 설치

**준비**: `brew install fswatch` (push 감지에 필요).

### 1. Extension 로드 (→ Extension ID 확정)

1. `chrome://extensions` → 우상단 **개발자 모드** ON
2. **압축해제된 확장 프로그램을 로드** → `extension/` 폴더 선택
3. 카드에 표시되는 **ID** 복사 (예: `abcdef...`)

### 2. 네이티브 호스트 + hook 권한 설치

```bash
./install.sh <복사한_EXTENSION_ID>
```

`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.forky.prbookmark.json` 생성 + 스크립트 실행권한 부여.

### 3. Claude hook 등록 (**필수** — 유일한 PR 소스)

`settings-hooks.snippet.json` 의 `hooks` 블록을 `~/.claude/settings.json` 에 **머지**.
⚠️ 기존 `hooks`(있다면)를 덮지 말고 SessionStart/PostToolUse/SessionEnd 만 추가. `./install.sh` 실행 시 정확한 경로의 블록을 출력해 주니 그걸 붙여넣으면 됩니다.

이 단계를 건너뛰면 PR 소스가 없어 폴더가 빈 채로 유지된다.

### 4. 확인

Chrome 재시작(또는 확장 reload) → 북마크 바에 **🔥 Active PRs** 폴더 생성 확인.

## 디버깅

- hook 로그: `~/.claude/hooks/pr-bookmark.log`
- 호스트 초기 push 테스트 (stdin EOF로 즉시 종료):
  ```bash
  host/pr-host.py < /dev/null \
    | python3 -c "import sys,struct,json;r=sys.stdin.buffer.read();print(json.loads(r[4:4+struct.unpack('<I',r[:4])[0]]))"
  ```
- Extension 동작: `chrome://extensions` → 확장 카드 → **서비스 워커** 콘솔에서 `[PRBookmark]` 로그 확인.

## 기본값 / 바꿀 곳

| 항목 | 기본 | 위치 |
|------|------|------|
| 폴더 이름 | `🔥 Active PRs` | `extension/background.js` `FOLDER_TITLE` |
| push 디바운스 | 200ms (`fswatch -l`) | `host/pr-host.py` |
| 재연결 점검 | 1분 (SW 死 대비 안전망) | `extension/background.js` `RECONNECT_MINUTES` |
| 머지/클로즈된 PR | 표시 안 함 (호스트가 `state=OPEN` 만) + 세션 종료/24h TTL 시 파일 제거 | `host/pr-host.py` |
| 죽은 세션 파일 청소 | 24h TTL | `host/pr-host.py` `TTL` |

## 한계

- **Claude 세션이 연 PR만 표시** — 웹 UI·동료·다른 도구로 만든 PR은 안 나옴 (설계상 의도). 잡히는 건 세션이 머문 브랜치의 PR + 세션 내 `gh pr create/merge/...` 로 건드린 PR.
- push 반영은 ~수백 ms (fswatch 디바운스 200ms + 동기화).
- SW가 강제 종료되면 재연결까지 최대 1분 — 그 사이 변경은 재연결 직후 초기 push로 일괄 반영(누락 없음).
- `fswatch` 미설치 시 push 동작 안 함 (`brew install fswatch`).
- CI/리뷰 상태(🟢🟡🔴) 미반영 — 현재는 🔥/⚪(draft) 만.
- 세션이 비정상 종료되면 그 PR이 최대 24h 폴더에 남을 수 있음(SessionEnd 누락 → TTL로 정리).
