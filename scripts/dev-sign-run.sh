#!/usr/bin/env bash
# cargo runner（只在 macOS 開發時用）：執行前用固定的簽章身分簽開發版執行檔。
#
# 為什麼：鑰匙圈記住的是「哪個 App」可以讀。沒有簽章的開發版每次重編譯身分都不同，
# macOS 會一直跳「想使用你在鑰匙圈的…」。用同一個身分、同一個識別碼（app.rosetta.shell）簽，
# 按一次「永遠允許」之後就不再問，而且和發行版是同一個身分。
#
# 身分：環境變數 DEV_SIGNING_IDENTITY 或 APPLE_SIGNING_IDENTITY；都沒有就用鑰匙圈裡第一個
# Developer ID Application 或 Apple Development 憑證；都沒有就照原樣執行（不簽）。
set -euo pipefail
bin="$1"
if [[ "$(basename "$bin")" == "rosetta-shell" ]]; then
  id="${DEV_SIGNING_IDENTITY:-${APPLE_SIGNING_IDENTITY:-}}"
  if [[ -z "$id" ]]; then
    # 優先用 Developer ID（和發行版同一個團隊，鑰匙圈的授權可以共用），沒有才用 Apple Development
    ids="$(security find-identity -v -p codesigning 2>/dev/null)"
    id="$(grep -oE '"Developer ID Application: [^"]*"' <<<"$ids" | head -1 | tr -d '"')"
    [[ -n "$id" ]] || id="$(grep -oE '"Apple Development: [^"]*"' <<<"$ids" | head -1 | tr -d '"')"
  fi
  if [[ -n "$id" ]]; then
    codesign --force --sign "$id" --identifier app.rosetta.shell "$bin" >/dev/null 2>&1 || echo "dev-sign-run：簽章失敗，照原樣執行" >&2
  fi
fi
exec "$@"
