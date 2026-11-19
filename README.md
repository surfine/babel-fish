# Babel Fish

<img src="apps/shell/src-tauri/icons/128x128@2x.png" width="128" alt="Babel Fish 圖示：深藍底上的黃色小魚吐出對話泡泡">

Babel Fish 是 macOS 上的 Slack 閱讀輔助工具。它把頻道裡的英文訊息翻成台灣正體中文。你用中文寫回覆，它改寫成這個頻道的人會寫的英文，再附上回譯，讓你確認意思沒有跑掉。

*Babel Fish is an unofficial macOS reader for Slack. It translates English messages into Traditional Chinese (Taiwan) and helps you write natural English replies from Chinese drafts. The interface is in Chinese.*

名字取自《銀河便車指南》裡的巴別魚：塞進耳朵，就聽得懂任何語言。開發時的內部代號是 Rosetta，所以程式碼、倉庫和鑰匙圈項目還用這個名字。

![訊息與譯文對照](apps/shell/docs/screenshots/demo-feed.png)

![中文草稿改寫成英文，附回譯與意思比對](apps/shell/docs/screenshots/demo-review.png)

## 中文用字

譯文、說明和介面可以用四種中文：台灣正體、香港繁體、大陆简体、马新简体。第一次開啟時依系統語言自動選，之後可以在「設定」的「中文用字」換。

譯文、回譯和摘要直接請模型用你選的地區寫。介面文字先照[地區用詞對照表](docs/TERMINOLOGY.md)換用詞，再用 [OpenCC](https://github.com/BYVoid/OpenCC) 換字形。別人寫的訊息、你的中文原稿、人名和頻道名都保持原樣。

## 使用前要知道的風險

Babel Fish 不是 Slack 官方的 App，也不是工作空間安裝的 App。它借用 Slack 網頁版的登入來讀訊息。

- 這種登入方式可能違反 Slack 的使用條款。
- Slack 可能隨時讓登入失效。失效時要重新登入。
- Slack 可能跳出安全警示，並通知 工作空間的管理員。
- 要翻譯的訊息會送到你設定的 AI 服務（DeepSeek 或 Anthropic）。公司頻道的內容能不能外送，請先確認。

第一次開啟時，Babel Fish 會先顯示這些風險。你勾選同意後才能登入。

## 唯讀模式

Babel Fish 預設是唯讀模式。它只讀訊息，不會替你傳送任何東西。英文改好後，按「複製並打開 Slack」，到官方 Slack 貼上，自己傳送。

在設定裡關掉唯讀模式後，可以直接在 Babel Fish 傳送、修改、刪除訊息，也可以加表情回應和上傳檔案。

## 安裝

1. 到 [Releases](../../releases) 下載最新的 `.dmg`。
2. 打開 `.dmg`，把 Babel Fish 拖到「應用程式」。
3. 開啟 Babel Fish，讀完風險說明後登入 Slack。

目前只有 Apple 晶片（M 系列）的版本。有新版時，側欄左下會出現「安裝新版」。

## 設定 AI 金鑰

Babel Fish 不附 AI 服務。你要自己申請金鑰：

- [DeepSeek](https://platform.deepseek.com)：只填這一把就能用全部功能，也比較便宜。
- [Anthropic](https://console.anthropic.com)：兩把都填時，翻譯用 DeepSeek，英文改寫用 Claude。

在側欄左下按「設定」（或選單列的 Babel Fish › 設定…，⌘,），貼上金鑰，按「儲存」。金鑰存在這台 Mac 的鑰匙圈。

沒有填金鑰時，Babel Fish 用內建的示範譯文，不會連到任何 AI 服務。

## 從原始碼建置

需要 Node.js 20 以上與 Rust。

```bash
npm --prefix packages/llm install
```

```bash
npm --prefix apps/shell install
```

```bash
npm --prefix apps/shell run tauri dev
```

只想看介面，不登入 Slack：

```bash
npm --prefix apps/shell run dev
```

然後打開 http://localhost:1420/?demo 。示範資料裡的公司、人名與對話都是虛構的。

檢查：

```bash
npm --prefix packages/llm test
```

```bash
npm --prefix apps/shell run build && npm --prefix apps/shell test
```

```bash
cd apps/shell/src-tauri && cargo test
```

架構與 Slack 連線的細節見 [apps/shell/README.md](apps/shell/README.md)；AI 接入層與品質實驗台見 [packages/llm/README.md](packages/llm/README.md)。

## 發行（維護者）

`scripts/release.sh` 會簽章、送 Apple 公證、蓋章，做出 `.dmg`，結果放在 `release/v<版本>/`。它不會上傳任何東西。

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

最後照腳本印出的 `gh release create` 指令，把 `release/v<版本>/` 裡的檔案傳到 GitHub Releases。`latest.json` 一定要一起上傳，舊版才找得到更新。

發新版前，記得改 `apps/shell/src-tauri/tauri.conf.json` 的 `version`。

圖示的原始檔是 Icon Composer 文件 `apps/shell/src-tauri/icons/BabelFish.icon`。改完後執行 `apps/shell/src-tauri/icons/source/make_icons.sh`，從它重新產生 `icon.icns` 與各尺寸 PNG。

## 授權

MIT，見 [LICENSE](LICENSE)。
