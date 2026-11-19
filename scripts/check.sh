#!/usr/bin/env bash
# 一次跑完所有檢查。提交前、發布前都跑；任何一項失敗就停。
#
#   scripts/check.sh          全部：llm 測試、前端型別與建置、前端單元測試、介面字串、端到端（WebKit）、Rust 測試、私人資料
#   scripts/check.sh --fast   不跑端到端與 Rust（pre-commit 用，約 20 秒）
#   scripts/check.sh --privacy 只查私人資料
#
# 端到端第一次要先裝瀏覽器：npx --prefix apps/shell playwright install webkit
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
MODE="${1:-}"

step() { printf '\n== %s\n' "$1"; }

# 私人資料：公開倉庫不能出現的字。清單放在不進 git 的 .private-patterns（一行一個，grep -E 語法，# 開頭是註解）。
privacy() {
  step "私人資料"
  local f="$ROOT/.private-patterns"
  if [[ ! -f "$f" ]]; then echo "沒有 .private-patterns，略過"; return; fi
  local pat
  pat="$(grep -vE '^\s*(#|$)' "$f" | paste -sd'|' -)"
  [[ -n "$pat" ]] || { echo ".private-patterns 是空的，略過"; return; }
  # 公開版排除的路徑（見 scripts/publish-public.sh）不查
  if git grep -nIiE "$pat" -- . ':!.jspace' ':!docs/HANDOFF.md' ':!.claude' ':!.private-patterns'; then
    echo "上面這些檔案含有 .private-patterns 裡的字，公開前要拿掉"
    exit 1
  fi
  echo "沒有私人資料"
}

[[ "$MODE" == "--privacy" ]] && { privacy; exit 0; }

step "packages/llm 測試"
npm --prefix packages/llm test --silent

step "介面字串（每個 t() 都有英文、沒有沒包 t() 的中文）"
node apps/shell/scripts/i18n.mjs

step "前端型別檢查與建置"
npm --prefix apps/shell run build --silent

step "前端單元測試"
npm --prefix apps/shell test --silent

if [[ "$MODE" != "--fast" ]]; then
  step "端到端（WebKit，示範模式）"
  npm --prefix apps/shell run e2e --silent

  step "Rust 測試"
  (cd apps/shell/src-tauri && cargo test --quiet)
fi

privacy

printf '\n全部通過\n'
