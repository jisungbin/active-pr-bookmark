#!/bin/bash
# SessionEnd 전용: 세션 종료 시 자기 entry 제거. (Stop은 매 턴마다 발동하므로 쓰면 안 됨)
set -uo pipefail
LOG="$HOME/.claude/hooks/pr-bookmark.log"
mkdir -p "$(dirname "$LOG")"
exec >>"$LOG" 2>&1

INPUT=$(cat)
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null); [ -z "$SID" ] && SID="$PPID"
rm -f "$HOME/.claude/active-prs/${SID}.json"
echo "[$(date -u +%FT%TZ)] SessionEnd sid=$SID removed"
