# 發行

`scripts/release.sh` 會簽章、送 Apple 公證、把公證結果附進 App（staple），再做出 `.dmg`，結果放在 `release/v<版本>/`。它不會上傳任何東西。

第一次發行前，先準備這些：

1. 在鑰匙圈裝好 Developer ID Application 憑證。
2. 到 [appleid.apple.com](https://appleid.apple.com) 產生一組 App 專用密碼。
3. 把公證憑證存進鑰匙圈。指令會要你輸入剛才的 App 專用密碼：

   ```bash
   xcrun notarytool store-credentials babel-fish-notary --apple-id "你的 Apple ID" --team-id "TEAMID"
   ```

先檢查環境：

```bash
scripts/release.sh --check
```

再建置：

```bash
scripts/release.sh
```

要給別人自動更新時，再多做兩件事：

1. 產生自動更新的簽章金鑰。私鑰留在本機，不要放進倉庫：

   ```bash
   npx --prefix apps/shell tauri signer generate -w ~/.tauri/rosetta.key
   ```

   如果有設密碼，也存進鑰匙圈：

   ```bash
   security add-generic-password -s rosetta-updater-key -a "$USER" -w
   ```

2. 建置前設定 GitHub 倉庫，腳本就會多產生 `latest.json` 和更新檔：

   ```bash
   export ROSETTA_GITHUB_REPO="帳號/倉庫"
   ```

要讓 App 用新式鑰匙圈（只有你的 App 讀得到，開啟時不跳密碼視窗），再做這件事：

1. 在 Apple 開發者網站建立 App ID 與 Developer ID 描述檔，存成 `apps/shell/src-tauri/embedded.provisionprofile`。這個檔案綁定你的帳號，不要放進倉庫。
2. 把 `apps/shell/src-tauri/Entitlements.plist` 裡的團隊 ID 換成你的。

沒有描述檔時，腳本照樣能建置，App 改用一般的鑰匙圈。

最後照腳本印出的 `gh release create` 指令，把 `release/v<版本>/` 裡的檔案傳到 GitHub Releases。`latest.json` 一定要一起上傳，舊版才找得到更新。

發新版前，記得改 `apps/shell/src-tauri/tauri.conf.json` 的 `version`。

圖示的原始檔是 Icon Composer 文件 `apps/shell/src-tauri/icons/BabelFish.icon`。改完後執行 `apps/shell/src-tauri/icons/source/make_icons.sh`，從它重新產生 `icon.icns` 與各尺寸 PNG。
