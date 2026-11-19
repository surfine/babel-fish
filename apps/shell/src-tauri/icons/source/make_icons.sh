#!/usr/bin/env bash
# 重新產生全部圖示：
#   1. 加 --fish 才用 make_fish.py 重畫魚的圖層（會蓋掉在 Icon Composer 裡對 fish.svg、eye.svg 的修改）
#   2. ictool 算出 Liquid Glass 成品圖，縮成 824 放進 1024 畫布（舊版 macOS 的圖示格線）
#   3. tauri icon 從它產生 icon.icns 與各尺寸 PNG
# macOS 26 以後用 BabelFish.icon（打包時由 actool 編成 Assets.car），更舊的系統用 icon.icns。
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
icons="$here/.."
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
[[ "${1:-}" == "--fish" ]] && python3 "$here/make_fish.py"
ictool="/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool"
"$ictool" "$icons/BabelFish.icon" --export-image --output-file "$tmp/full.png" --platform macOS --rendition Default --width 1024 --height 1024 --scale 1 >/dev/null
python3 - "$tmp/full.png" "$tmp/legacy.png" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGBA").resize((824, 824), Image.LANCZOS)
c = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0)); c.paste(im, (100, 100), im); c.save(sys.argv[2])
PY
(cd "$icons/../.." && npx tauri icon "$tmp/legacy.png" >/dev/null)
rm -rf "$icons/android" "$icons/ios"
echo "圖示已更新"
