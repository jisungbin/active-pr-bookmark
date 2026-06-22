# Active PR Bookmark Sync

**Claude 세션에서 작업 중인** open PR을 Chrome 북마크 바의 **🔥 Active PRs** 폴더에 자동 동기화한다.
표시: 🔥 ready · ⚪ draft.

## 구조 (B안 — fswatch push, macOS 앱 없음)

```
Claude hook (bash)  ──쓰기──> ~/.claude/active-prs/<session_id>.json
                                         │ 파일 변경
                                         ▼ fswatch 감지
Chrome Extension  ◀───push─── host/pr-host.py (영속, connectNative)
       │  ──check(크롬 시작)─▶  폴더 PR을 gh 로 조회 → 머지/클로즈만 remove
       ▼
  push: 폴더에 없는 PR 추가 (add-only) / remove: 머지·클로즈된 PR 제거
```

- **Extension**: 북마크를 만질 수 있는 유일한 주체. 호스트와 connectNative로 연결해두고, **push가 올 때** 폴더에 새 PR을 추가(add-only — 삭제·이동 없음). 또한 **크롬 시작 시·툴바 아이콘 클릭 시** 폴더의 PR URL을 호스트에 보내(`check`), 호스트가 머지/클로즈로 확인해 돌려준(`remove`) PR만 폴더에서 지우고 결과를 아이콘 badge로 잠깐 표시한다(제거 `n`개 / 정리할 것 없으면 `✓`). 주기 폴링은 없음.
- **호스트(`pr-host.py`)**: Chrome이 spawn하는 **영속** 스크립트. `fswatch`로 active-prs 변경을 감지해 즉시 push. `check` 요청을 받으면 해당 URL들을 `gh pr view`로 조회해 **MERGED/CLOSED로 확인된 것만** `remove`로 응답(조회 실패·OPEN은 보존).
- **hook**: 작업 중인 PR을 기록하는 **유일한 소스**. hook이 없으면 폴더는 빈 채로 유지됨.

## 설치

**준비**: `brew install fswatch` (push 감지), `gh auth login` (머지/클로즈 조회에 사용 — hook도 `gh`를 씀).

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
| 머지/클로즈된 PR | 크롬 시작·아이콘 클릭 시 `gh` 조회로 제거 (세션 종료·TTL로는 안 지움) | `extension/background.js` · `host/pr-host.py` |
| 죽은 세션 파일 청소 | 24h TTL | `host/pr-host.py` `TTL` |

## 한계

- **Claude 세션이 연 PR만 표시** — 웹 UI·동료·다른 도구로 만든 PR은 안 나옴 (설계상 의도). 잡히는 건 세션이 머문 브랜치의 PR + 세션 내 `gh pr create/merge/...` 로 건드린 PR.
- push 반영은 ~수백 ms (fswatch 디바운스 200ms + 동기화).
- SW가 강제 종료되면 재연결까지 최대 1분 — 그 사이 변경은 재연결 직후 초기 push로 일괄 반영(누락 없음).
- `fswatch` 미설치 시 push 동작 안 함 (`brew install fswatch`).
- CI/리뷰 상태(🟢🟡🔴) 미반영 — 현재는 🔥/⚪(draft) 만.
- **머지/클로즈 제거 트리거는 크롬 시작·아이콘 클릭** — 크롬을 계속 켜두면 웹에서 머지된 PR이 그 자리에 남는데, **툴바 아이콘을 누르거나** 다음 크롬 재시작 때 `gh` 조회로 일괄 정리된다. 세션 종료·TTL로는 지우지 않으므로 OPEN인 PR은 세션이 끝나도 폴더에 남는다(추가는 add-only 유지).
