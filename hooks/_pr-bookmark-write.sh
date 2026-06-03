#!/bin/bash
# 공통: 현재 브랜치의 PR 정보를 active-prs/<session_id>.json 에 기록 ($1=session_id, $2=cwd)
set -uo pipefail

SID="$1"; CWD="$2"
BRANCH=$(git -C "$CWD" branch --show-current 2>/dev/null) || exit 0
[ -z "$BRANCH" ] && exit 0
[ "$BRANCH" = "main" ] && exit 0

TICKET=$(printf '%s' "$BRANCH" | grep -oE '[A-Z]+-[0-9]+' | head -1)
PR_JSON=$(cd "$CWD" 2>/dev/null && gh pr view --json url,number,title,state,isDraft 2>/dev/null) || PR_JSON=null
[ -z "$PR_JSON" ] && PR_JSON=null

DIR="$HOME/.claude/active-prs"
mkdir -p "$DIR"
cat > "$DIR/${SID}.json" <<EOF
{
  "session_id": "$SID",
  "branch": "$BRANCH",
  "ticket": "$TICKET",
  "cwd": "$CWD",
  "pr": $PR_JSON,
  "updated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
echo "[$(date -u +%FT%TZ)] write sid=$SID branch=$BRANCH"
