#!/bin/bash
set -euo pipefail

EXT_ID="${1:-}"
if [ -z "$EXT_ID" ]; then
  echo "Usage: ./install.sh <EXTENSION_ID>"
  echo "  chrome://extensions 에서 'Active PR Bookmark Sync' 로드 후 표시되는 ID를 넣으세요."
  exit 1
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
HOST_PATH="$HERE/host/pr-host.py"

command -v fswatch >/dev/null || echo "⚠️  fswatch 미설치 — 'brew install fswatch' 필요 (없으면 push 동작 안 함)"

chmod +x "$HOST_PATH" "$HERE/hooks/"*.sh

DEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$DEST"
cat > "$DEST/com.forky.prbookmark.json" <<EOF
{
  "name": "com.forky.prbookmark",
  "description": "Active PR Bookmark native host",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF

echo "✓ native messaging host 설치 → $DEST/com.forky.prbookmark.json"
echo "✓ host: $HOST_PATH"
echo "✓ hooks 실행권한 부여"
echo
echo "=== ~/.claude/settings.json 의 \"hooks\" 에 추가할 블록 (경로 자동 반영) ==="
cat <<SNIPPET
  "SessionStart": [
    { "hooks": [ { "type": "command", "command": "$HERE/hooks/pr-bookmark-session-start.sh" } ] }
  ],
  "PostToolUse": [
    { "matcher": "Bash", "hooks": [ { "type": "command", "command": "$HERE/hooks/pr-bookmark-post-bash.sh" } ] }
  ],
  "SessionEnd": [
    { "hooks": [ { "type": "command", "command": "$HERE/hooks/pr-bookmark-session-end.sh" } ] }
  ]
SNIPPET
echo
echo "다음: 위 블록을 settings.json 의 hooks 에 머지 → chrome://extensions 에서 확장 reload"
