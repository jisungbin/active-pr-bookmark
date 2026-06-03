#!/bin/bash
set -uo pipefail
LOG="$HOME/.claude/hooks/pr-bookmark.log"
mkdir -p "$(dirname "$LOG")"
exec >>"$LOG" 2>&1

INPUT=$(cat)
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null); [ -z "$SID" ] && SID="$PPID"
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null); [ -z "$CWD" ] && CWD="$PWD"

exec "$(dirname "$0")/_pr-bookmark-write.sh" "$SID" "$CWD"
