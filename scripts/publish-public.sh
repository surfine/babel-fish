#!/usr/bin/env bash
# 把目前的 HEAD 做成公開倉庫的一個新提交。公開倉庫有自己的歷史：
# 本機 main 的歷史含私人頻道內容（2026-11-19 以前），永遠不推出去。
#
#   scripts/publish-public.sh "提交說明"          只在本機的 public-main 分支產生提交
#   scripts/publish-public.sh "提交說明" --push   再推到 public 遠端的 main（對外動作，先確認）
#
# 排除的路徑：開發 session 的內部筆記與本機設定。
set -euo pipefail
cd "$(dirname "$0")/.."

MSG="${1:?要給提交說明}"
EXCLUDE=(.jspace docs/HANDOFF.md .claude)
AUTHOR_NAME="epiphany42"
AUTHOR_EMAIL="12213433+surfine@users.noreply.github.com"

[[ -z "$(git status --porcelain)" ]] || { echo "工作區有未提交的改動，先提交再發布"; exit 1; }

idx="$(mktemp)"; trap 'rm -f "$idx"' EXIT
GIT_INDEX_FILE="$idx" git read-tree HEAD
GIT_INDEX_FILE="$idx" git rm -r -q --cached --ignore-unmatch "${EXCLUDE[@]}"
tree="$(GIT_INDEX_FILE="$idx" git write-tree)"

parent_args=()
if git rev-parse -q --verify refs/heads/public-main >/dev/null; then
  parent="$(git rev-parse refs/heads/public-main)"
  if [[ "$(git rev-parse "$parent^{tree}")" == "$tree" ]]; then
    echo "公開版內容沒有變，不產生新提交"
  else
    parent_args=(-p "$parent")
  fi
fi

if [[ -z "${parent:-}" || ${#parent_args[@]} -gt 0 ]]; then
  commit="$(GIT_AUTHOR_NAME="$AUTHOR_NAME" GIT_AUTHOR_EMAIL="$AUTHOR_EMAIL" \
    GIT_COMMITTER_NAME="$AUTHOR_NAME" GIT_COMMITTER_EMAIL="$AUTHOR_EMAIL" \
    git commit-tree "$tree" ${parent_args[@]+"${parent_args[@]}"} -m "$MSG")"
  git update-ref refs/heads/public-main "$commit"
  echo "public-main → $(git log -1 --format='%h %s' public-main)"
fi

if [[ "${2:-}" == "--push" ]]; then
  git push public public-main:main
fi
