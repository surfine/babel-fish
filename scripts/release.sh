#!/usr/bin/env bash
# 建置發行版：簽章、送 Apple 公證、蓋章（staple）、產生 .dmg 與自動更新檔。不上傳任何東西。
#
#   scripts/release.sh --check   只檢查環境，列出缺什麼
#   scripts/release.sh           建置到 release/v<版本>/
#
# 環境變數（都不是密碼）：
#   APPLE_SIGNING_IDENTITY  選用。預設用鑰匙圈裡第一個 Developer ID Application 憑證
#   NOTARY_PROFILE          選用。notarytool 鑰匙圈設定檔名稱，預設 babel-fish-notary
#   ROSETTA_GITHUB_REPO     選用。GitHub 倉庫（例如 someone/babel-fish）。有設才產生自動更新檔 latest.json
#   ROSETTA_UPDATER_KEY     選用。更新簽章私鑰，預設 ~/.tauri/rosetta.key（只有設了倉庫才需要）
#
# 公證憑證存在鑰匙圈，由你自己建立一次（指令會要你輸入 App 專用密碼）：
#   xcrun notarytool store-credentials babel-fish-notary --apple-id <Apple ID> --team-id <Team ID>
# 更新私鑰的密碼（產生金鑰時有設才需要）：鑰匙圈服務 rosetta-updater-key，帳號 $USER
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHELL_DIR="$ROOT/apps/shell"
CONF="$SHELL_DIR/src-tauri/tauri.conf.json"
KEY="${ROSETTA_UPDATER_KEY:-$HOME/.tauri/rosetta.key}"
PROFILE="${NOTARY_PROFILE:-babel-fish-notary}"
VERSION="$(node -p "require('$CONF').version")"
APP_NAME="$(node -p "require('$CONF').productName")"
# 上傳檔名不能有空格：GitHub 會把空格換成點，latest.json 裡的網址就對不上
ASSET="${APP_NAME// /}"

if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  APPLE_SIGNING_IDENTITY="$(security find-identity -v -p codesigning | grep -oE '"Developer ID Application: [^"]*"' | head -1 | tr -d '"' || true)"
fi

missing=()
[[ -n "$APPLE_SIGNING_IDENTITY" ]] || missing+=("鑰匙圈裡沒有 Developer ID Application 憑證")
if ! xcrun notarytool history --keychain-profile "$PROFILE" >/dev/null 2>&1; then
  missing+=("公證憑證：鑰匙圈裡沒有可用的 notarytool 設定檔「$PROFILE」（建立方法見檔頭）")
fi
if [[ -n "${ROSETTA_GITHUB_REPO:-}" ]]; then
  [[ -f "$KEY" && -f "$KEY.pub" ]] || missing+=("更新簽章金鑰 $KEY 與 $KEY.pub")
fi
if (( ${#missing[@]} )); then
  echo "還缺："
  printf '  - %s\n' "${missing[@]}"
  exit 1
fi
echo "環境齊全：$APP_NAME $VERSION，簽章身分 ${APPLE_SIGNING_IDENTITY%% (*}…，公證設定檔 $PROFILE"
[[ -n "${ROSETTA_GITHUB_REPO:-}" ]] || echo "沒有設 ROSETTA_GITHUB_REPO：這次不產生自動更新檔"
[[ "${1:-}" == "--check" ]] && exit 0

export APPLE_SIGNING_IDENTITY
# 公證由這支腳本自己做（notarytool 鑰匙圈設定檔），所以不讓 Tauri 讀到 APPLE_ID／APPLE_PASSWORD
unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID APPLE_API_KEY APPLE_API_ISSUER

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
OUT="$ROOT/release/v$VERSION"
rm -rf "$OUT"
mkdir -p "$OUT"

# 發行設定：有描述檔就嵌進 App 並加上新式鑰匙圈的權限（見 apps/shell/src-tauri/src/vault.rs）；
# 有 GitHub 倉庫就加上自動更新。描述檔綁定開發者帳號，不放進公開倉庫。
PROFILE_FILE="$SHELL_DIR/src-tauri/embedded.provisionprofile"
[[ -f "$PROFILE_FILE" ]] || echo "沒有 embedded.provisionprofile：這次用舊式鑰匙圈"
BASE=""
[[ -n "${ROSETTA_GITHUB_REPO:-}" ]] && BASE="https://github.com/$ROSETTA_GITHUB_REPO/releases"
node -e '
const fs = require("fs");
const [profile, pubFile, base, assets] = process.argv.slice(1);
const conf = {};
conf.bundle = { macOS: { files: { "Resources/Assets.car": assets } } };
if (fs.existsSync(profile)) {
  conf.bundle.macOS.entitlements = "Entitlements.plist";
  conf.bundle.macOS.files["embedded.provisionprofile"] = profile;
}
if (base) {
  conf.plugins = { updater: { pubkey: fs.readFileSync(pubFile, "utf8").trim(), endpoints: [base + "/latest/download/latest.json"] } };
}
process.stdout.write(JSON.stringify(conf));' "$PROFILE_FILE" "$KEY.pub" "$BASE" "$TMP/icon/Assets.car" > "$TMP/release.conf.json"
CONFIG_ARGS=(--config "$TMP/release.conf.json")

# Liquid Glass 圖示：自己用 actool 從 BabelFish.icon 編出 Assets.car，再放進 App 的 Resources。
# （交給 Tauri 編時 actool 會報「Bad file descriptor」，原因不明；自己編就正常。）
# 圖示服務留著過期的共用記憶體時也會失敗，所以先清掉。
xcrun ictool --quit-all-idle-servers >/dev/null 2>&1 || true
xcrun ictool --clear-shared-memory >/dev/null 2>&1 || true
mkdir -p "$TMP/icon"
cp -R "$SHELL_DIR/src-tauri/icons/BabelFish.icon" "$TMP/icon/Icon.icon"
xcrun actool "$TMP/icon/Icon.icon" --compile "$TMP/icon" --output-format human-readable-text --errors \
  --output-partial-info-plist "$TMP/icon/partial.plist" --app-icon Icon --include-all-app-icons \
  --enable-on-demand-resources NO --development-region en --target-device mac \
  --minimum-deployment-target 10.13 --platform macosx >/dev/null
[[ -f "$TMP/icon/Assets.car" ]] || { echo "actool 沒有編出 Assets.car"; exit 1; }

# 1. 建置並簽章 .app（只建 app；dmg 要等 app 公證完再做，裡面才是蓋過章的 app）
npm --prefix "$SHELL_DIR" run tauri build -- --bundles app ${CONFIG_ARGS[@]+"${CONFIG_ARGS[@]}"}
APP="$SHELL_DIR/src-tauri/target/release/bundle/macos/$APP_NAME.app"

# 2. 公證 .app 並蓋章
ditto -c -k --keepParent "$APP" "$TMP/app.zip"
xcrun notarytool submit "$TMP/app.zip" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$APP"

# 3. 用蓋過章的 app 做 dmg（含「應用程式」捷徑），簽章、公證、蓋章
mkdir -p "$TMP/dmg"
ditto "$APP" "$TMP/dmg/$APP_NAME.app"
ln -s /Applications "$TMP/dmg/Applications"
DMG="$OUT/${ASSET}_${VERSION}_aarch64.dmg"
hdiutil create -volname "$APP_NAME" -srcfolder "$TMP/dmg" -ov -format UDZO "$DMG" >/dev/null
codesign --force --sign "$APPLE_SIGNING_IDENTITY" "$DMG"
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$DMG"

# 4. 自動更新檔：用蓋過章的 app 重新打包並簽名
if [[ -n "${ROSETTA_GITHUB_REPO:-}" ]]; then
  PASS="$(security find-generic-password -s rosetta-updater-key -a "$USER" -w 2>/dev/null || true)"
  tar -czf "$OUT/$ASSET.app.tar.gz" -C "$(dirname "$APP")" "$APP_NAME.app"
  npx --prefix "$SHELL_DIR" tauri signer sign -f "$KEY" -p "$PASS" "$OUT/$ASSET.app.tar.gz" >/dev/null
  # 只建 Apple 晶片版；Intel Mac 要另外建（rustup target add x86_64-apple-darwin）
  node -e '
const fs = require("fs");
const [version, sigFile, url, out] = process.argv.slice(1);
fs.writeFileSync(out, JSON.stringify({
  version,
  pub_date: new Date().toISOString(),
  platforms: { "darwin-aarch64": { signature: fs.readFileSync(sigFile, "utf8").trim(), url } },
}, null, 2) + "\n");' "$VERSION" "$OUT/$ASSET.app.tar.gz.sig" "$BASE/download/v$VERSION/$ASSET.app.tar.gz" "$OUT/latest.json"
fi

echo "檢查公證："
xcrun stapler validate "$APP"
spctl -a -vv "$APP"
spctl -a -vv -t open --context context:primary-signature "$DMG"

echo
echo "完成：$OUT"
ls -1 "$OUT"
echo
echo "安裝到這台 Mac：打開 $DMG，把 $APP_NAME 拖到「應用程式」。"
if [[ -n "${ROSETTA_GITHUB_REPO:-}" ]]; then
  echo "上傳到 GitHub Releases（確認後自己執行）："
  echo "  gh release create v$VERSION --repo $ROSETTA_GITHUB_REPO $OUT/*"
fi
