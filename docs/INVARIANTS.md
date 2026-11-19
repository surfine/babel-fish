# 不能改壞的行為

這些行為都在真 Slack 或示範模式驗證過。改程式之前先讀這份，改完跑 `scripts/check.sh`。

如果你的改動必須改變其中一條，先問維護者。同意後，在同一個提交裡改程式、改測試，也改這份文件。不要為了讓測試通過而改測試或刪測試。

每一條後面寫著守住它的測試。

## 安全與信任

- **預設唯讀。** 第一次開啟就是唯讀模式。唯讀時，前端不顯示傳送、修改、刪除、表情回應、上傳的按鈕，Rust 端也拒絕這些命令。
  測試：`e2e/app.spec.ts`「唯讀模式（預設）」、`src-tauri/tests/slack.rs` `write_commands_are_rejected_in_read_only_mode_and_allowed_when_off`
- **先同意風險，才讀鑰匙圈、才登入。** 沒同意過、同意的是舊版本，或資料壞掉，都要重新同意。
  測試：`src/lib/consent.test.ts`、`e2e/app.spec.ts`「第一次開啟先看到風險說明」
- **開 App 不跳鑰匙圈密碼視窗。** 發行版用新式鑰匙圈（data protection keychain）：一個項目、不加使用者驗證，每次啟動只解鎖一次。改 `vault.rs` 一定要在發行版實測，開發版測不到。
  測試：`src-tauri/tests/vault.rs`
- **金鑰和權杖不出現在記錄、錯誤訊息和 Debug 輸出裡。**
  測試：`vault.rs` `debug_output_hides_keys_and_tokens`、`slack.rs` `credentials_debug_hides_secrets`
- **只連 Slack 和已知的 AI 端點。** AI 請求只放行 `llm.rs` 的 `ALLOWED_HOSTS`，下載檔案只放行 Slack 的網址。
  測試：`src-tauri/src/llm.rs` `allows_only_known_llm_endpoints`、`slack.rs` `reqwest_transport_refuses_non_slack_download_urls`、`slackfile_allowlist`
- **不讀 Claude Code 的登入權杖（`Claude Code-credentials`）。** 這違反 Anthropic 條款。
- **公開倉庫沒有私人資料。** 公開版由 `scripts/publish-public.sh` 產生，會先跑 `scripts/check.sh --privacy`。

## 寫作與送出

- **使用者親手送出。** 唯讀時只能「複製並打開 Slack」。關掉唯讀時，傳送有 5 秒撤回；撤回後，草稿回到輸入框。
  測試：`e2e/app.spec.ts`「潤色、傳送有 5 秒撤回」
- **在官方 Slack 傳送後，訊息下方附上原稿，Babel Fish 的輸入框清空。** Slack 會改引號和空白，比對時要容忍。
  測試：`src/lib/copydrafts.test.ts`、`src/lib/guide.test.ts`
- **潤色有獨立的回譯和意思比對。** 回譯請求裡不能有使用者的原稿，否則回譯只是照抄。回譯與比對用使用者語言。使用者語言和頻道語言相同時，只調語氣，不回譯。
  測試：`packages/llm/test/tasks.test.ts`「回譯請求裡絕對沒有中文原稿」、`lang.test.ts`「使用者語言和頻道語言相同時不回譯」
- **只有 DeepSeek 金鑰時，每一步都用 DeepSeek；「重譯」不能指到沒有金鑰的供應商。**
  測試：`src/lib/translate/llm.test.ts`

## 介面

- **表情選單點了就打開，不會馬上關掉。** 打開選單的按鈕要 `stopPropagation()`，否則文件層的「點外面就關」會把它關掉。
  測試：`e2e/app.spec.ts`「表情選單打得開」
- **貼上引導卡上的每項資訊只出現一次。** 要貼的文字只在輸入框，目的地只在第一步，⌘V 和 Return 只在步驟裡。卡片不放循環動畫。
  測試：`e2e/guide.spec.ts`
- **介面五種語言：英文、台灣正體、香港繁體、大陆简体、马新简体。** 介面文字一律包在 `t()` 裡，鍵是台灣正體；英文手寫在 `src/lib/i18n/en.ts`，其他地區在建置時產生。新增文字後跑 `node apps/shell/scripts/i18n.mjs`。
  測試：`src/lib/i18n/i18n.test.ts`、`e2e/app.spec.ts` 的語言項目
- **中文地區用詞照 `packages/llm/src/zh.ts` 的術語表。** 改了術語表要跑 `npm --prefix packages/llm run terms`，更新 `docs/TERMINOLOGY.md`。
  測試：`packages/llm/test/zh.test.ts`
- **Slack 訊息格式會跳脫 HTML。** 不安全的連結協定不變成連結。
  測試：`src/lib/mrkdwn.test.ts`
- **介面與文案照 no-slop 的規則：** 不重複資訊、不加裝飾、按鈕寫動作、錯誤訊息寫下一步。

## 發行

- **發行版要簽章、公證、蓋章。** 用 `scripts/release.sh`，不要手動打包。Liquid Glass 圖示由這支腳本自己用 actool 編。
- **自動更新只在發行版註冊**，要有公鑰和端點。
  測試：`src-tauri/tests/updater.rs`
