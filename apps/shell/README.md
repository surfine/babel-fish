# Babel Fish 殼（apps/shell）

對外名稱是 Babel Fish（2026-11-19 改名，避免和 Apple 的 Rosetta 2 混淆）；Rosetta 是內部代號。只有使用者看得到的地方用 Babel Fish：`productName`、視窗標題、介面文字、圖示（`src-tauri/icons/source/babel-fish.svg`）。識別碼 `app.rosetta.shell`、鑰匙圈服務名稱、localStorage 鍵名、套件名稱都不改，改了會讓已登入的使用者失去登入與設定。

自製的 Slack 桌面客戶端第一版：頻道訊息中英對照、中文起草 → 潤色成英文 → 審閱 → 親手送出。Tauri 2 + Svelte 5 + TypeScript，介面直接沿用 [`design/prototype.html`](../../design/prototype.html) 的配色 token 與元件樣式。

翻譯、潤色、回譯接 `packages/llm`（`src/lib/translate/llm.ts`），請求經 Rust 的 `llm_http` 代理送出，金鑰由 Rust 從鑰匙圈補上。鑰匙圈沒有任何 AI 金鑰時改用假實作（`fake.ts`，示範資料用預寫的譯文）。只有 DeepSeek 金鑰時，所有步驟都用 DeepSeek，潤色開思考模式（`deepseek-flash@high`，理由見 `packages/llm/README.md`）。

## 兩種模式：唯讀（預設）與可寫入

設定（側欄左下「設定」）裡有「唯讀模式」，**預設開啟**，設定存在 WebView 的 localStorage（`rosetta.readOnly`）。

**唯讀模式（開）**：Rosetta 只讀 Slack、翻譯與潤色，不對 Slack 寫入任何東西。
- 介面藏起送出、撤回、修改、刪除、加表情回應、附加檔案與貼上檔案；訊息上的操作只剩「回覆這則」（只是設定潤色時要回應誰）、「重譯」、「討論串」。
- 打開頻道只在記憶體裡清掉未讀，不會告訴 Slack 已讀。
- Rosetta 自己的 macOS 通知與 Dock 徽章關閉（官方用戶端本來就會通知）。
- 審閱卡改成複製流程：每則英文泡泡有「複製」；「複製並打開 Slack」把英文放進剪貼簿（拆成多則時以空行相接，合併時是合併後的全文），再用 Slack 文件記載的深層連結 `slack://channel?team={TEAM_ID}&id={CHANNEL_ID}` 打開官方用戶端的同一個頻道（討論串沒有公開的深層連結，只會開到頻道）；「只複製」不開 Slack；審閱卡裡 ⌘↩ 等於「複製並打開 Slack」。複製後會顯示「已複製，到 Slack 貼上送出」，審閱卡保持開著，可以接著複製其他泡泡。複製用 `navigator.clipboard.writeText`，失敗退到隱藏 textarea + `execCommand('copy')`。
- 開 Slack 用 `tauri-plugin-opener`，capability（`src-tauri/capabilities/default.json`）只放行 `slack://*`。
- 雙重保險：Rust 端有 `set_read_only` 命令（前端啟動與切換時同步，預設開）。唯讀時，所有寫入命令（`slack_post`、`slack_update`、`slack_delete`、`slack_react`、`slack_mark`、`slack_upload`）直接回 `read_only` 錯誤，不會碰 Slack。測試：`tests/slack.rs` 的 `write_commands_are_rejected_in_read_only_mode_and_allowed_when_off`。
- 唯讀模式下會呼叫的 Slack 方法，就這幾個：`auth.test`、`users.conversations`、`client.counts`（網頁版內部 API）、`conversations.history`、`conversations.replies`、`users.info`、`emoji.list`、`rtm.connect`（加上它回傳的 websocket 即時連線），以及 `files.slack.com` 等 Slack 網域的圖片與檔案下載（`slackfile://` 代理）。
- 貼上引導卡：「複製並打開 Slack」之後，Rust（`src-tauri/src/guide.rs`）開一個不搶焦點、置頂、透明的小視窗 `guide`，用 CGWindowList 讀官方 Slack 視窗的外框（只讀擁有者名稱與外框，不需要額外權限），每 0.4 秒把卡片放在 Slack 右側（放不下就左側，再不行就放在視窗內輸入框上方）。卡片的配色、圓角、按鈕和用詞（傳送、對話串、訊息輸入框）照官方 Slack 桌面版，含深色；有縮小版 Slack 輸入框的循環示範（⌘V 後文字出現、傳送鈕變綠，Return 後清空）、三個步驟（對話串回覆會先提醒打開對話串）、要貼的英文、「再複製一次」（用 `pbcopy` 寫剪貼簿並重新打開 Slack）。規則參考 Apple TipKit（`src/lib/guide.ts`）：看到自己在官方 Slack 送出了剛複製的英文就顯示「已送出」並收起；完成 3 次後改顯示精簡版；放著 3 分鐘自動收起；設定裡「打開 Slack 後顯示貼上提示」可以關。透明視窗需要 `macOSPrivateApi`（App Store 不收，Developer ID 發行沒影響）。
- 自己的訊息下方的「你的原稿」：複製時記下「英文（去頭尾空白、空白折成一格、彎引號改直引號後）→ 中文原稿」，存在 localStorage（`rosetta.copyDrafts`），7 天過期、最多 200 筆；之後訊息流裡自己的訊息用文字比對（拆成多則時每則泡泡和合併全文都各記一筆）。

**可寫入模式（關）**：和唯讀模式出現之前完全一樣，可以在 Rosetta 直接送出（0.8 秒防誤送、5 秒撤回）、修改、刪除、加表情回應、上傳檔案，開頻道時標記已讀，並有 macOS 通知與 Dock 徽章。這些寫入會呼叫 `chat.postMessage`、`chat.update`、`chat.delete`、`reactions.add/remove`、`conversations.mark`、`files.getUploadURLExternal` 與 `files.completeUploadExternal`。

**不是合規方案**：兩種模式都用 Slack 網頁版的登入權杖（xoxc + `d` cookie），唯讀模式只是不寫入，不代表符合 Slack 的服務條款。這點使用者已知情並接受（見「已知風險與限制」）。

## 啟動

```bash
cd apps/shell
npm install
npm run tauri dev        # 桌面應用程式；登入頁可選「用 Slack 帳號登入」或「先看示範資料」
npm run dev              # 只開前端（http://localhost:1420/?demo 直接進示範模式，不能登入）
```

檢查：

```bash
npm run build            # svelte-check + vite build
npm test                 # 單元測試（mrkdwn、語言偵測、複製原稿比對等）
cd src-tauri && cargo test && cargo check
```

## 架構

```
前端（Svelte，src/）                         Rust（src-tauri/src/）
 App ─ Login / Sidebar / Channel / ThreadPane   commands.rs   invoke 命令（auth_*、slack_*、realtime_*）
   │   MessageFeed → MessageItem                 slack/api.rs  SlackApi trait ← 換權杖種類的邊界
   │   Composer（審閱卡：送出或複製流程）  slack/client.rs  ok:false 對應錯誤、429/ratelimited 退避重試
   ├ lib/store.svelte.ts  狀態、翻譯佇列、送出、即時事件、通知與未讀  slack/transport.rs  reqwest：token 表單欄位 + Cookie: d=
   ├ lib/slack/source.ts  SlackSource 介面            slack/realtime.rs  rtm.connect + websocket；失敗退到輪詢
   │    ├ tauri.ts  真 Slack（invoke + 事件）          slack/model.rs  Slack 原始 JSON → 契約型別
   │    └ demo.ts   示範資料（記憶體內）                auth/login.rs  登入視窗擷取權杖
   ├ lib/translate/  Translator / Polisher / Verifier / Summarizer 介面與假實作   auth/store.rs  鑰匙圈
   └ lib/mrkdwn.ts  Slack mrkdwn → 安全 HTML               files.rs + lib.rs  slackfile:// 檔案代理
```

前後端之間的資料形狀只有一份：[`src/lib/slack/types.ts`](src/lib/slack/types.ts)，Rust 的 `slack/model.rs` 序列化成同樣的 JSON。

**Slack 連線層放在 Rust 的理由**

1. 網頁版權杖（xoxc）要搭配 `d` cookie 才能用。瀏覽器的 `fetch` 不能自己設 `Cookie` header，Slack API 也不開 CORS 給 `tauri://`，前端直接呼叫做不到。
2. 權杖與 cookie 只存在 Rust 記憶體和鑰匙圈裡，前端（以及任何注入到 WebView 的內容）拿不到。
3. 私有檔案（`files.slack.com`）要帶授權才取得到；Rust 註冊 `slackfile://` 協定代為取檔，前端 `<img>` 直接用。
4. 速率限制退避、websocket 重連在 Rust 背景任務裡做，不受前端頁面重載影響。

**換成官方 App 權杖**：`SlackApi` 是唯一邊界。`Credentials { token, cookie: Option, api_base }` 在 cookie 為 `None` 時就是標準 Bearer/表單權杖呼叫，xoxp 使用者權杖可以沿用同一個實作；即時連線則要改走 Socket Mode（另寫一個 realtime 實作）。前端完全不用動。

## 登入與權杖儲存

0. 第一次開啟先顯示風險說明（`Login.svelte`）：可能違反 Slack 條款、登入可能失效、可能通知管理員、訊息會送到 AI 服務。使用者勾選並按「同意並繼續」後才出現登入按鈕。同意記在 localStorage（`rosetta.consent`，含版本號；`src/lib/consent.ts` 的 `CONSENT_VERSION` 改了就要重新同意）。沒同意前，`store.start()` 不讀鑰匙圈裡的舊登入，`store.login()` 也直接返回。
1. 按「用 Slack 帳號登入」→ Rust 開一個新視窗載入 `https://slack.com/signin`，使用者在 Slack 官方頁面自己登入（含 SSO、兩步驟驗證）。登入視窗與 API 請求都用標準 Safari User-Agent（`slack/transport.rs` 的 `SAFARI_UA`）：WKWebView 預設的 UA 會被 Slack 判定為「不支援的瀏覽器」而擋下。
2. 這個視窗注入一小段腳本：在 `app.slack.com` 上讀 `localStorage.localConfig_v2` 裡 `xoxc-` 開頭的權杖，透過導覽到 `https://rosetta-capture.invalid/#…` 交給 Rust；Rust 的 `on_navigation` 攔下並**取消**這次導覽（不會發出網路請求）。
3. Rust 從該 WebView 的 cookie store 取 `d`（HttpOnly），用 `auth.test` 驗證，通過後存進鑰匙圈並關閉登入視窗。
4. 登入視窗不在任何 capability 裡，Slack 的頁面不能呼叫 Rosetta 的命令。

| 項目 | 位置 |
| --- | --- |
| 權杖與 cookie | macOS 鑰匙圈，服務 `app.rosetta.shell`、帳號 `slack-web-session`（值是 JSON：team、user、token、cookie） |
| 閱讀模式、自己訊息的中文原稿 | WebView 的 localStorage（`rosetta.modes`、`rosetta.ownDrafts`），只在這台 Mac |
| 譯文 | 記憶體（重開會重翻；持久快取是後續工作） |

**鑰匙圈**：Slack 登入和 AI 金鑰都放在鑰匙圈的同一個項目（`src-tauri/src/vault.rs`，服務 `app.rosetta.vault`），每次啟動只讀一次，讀到的內容記在記憶體，同時進來的讀取會排隊。正式版用新式鑰匙圈（data protection keychain）：只有帶同一團隊權限簽章的 Babel Fish 讀得到，Mac 解鎖後直接可讀，開啟 App 不跳任何視窗。這需要 `Entitlements.plist` 的 `keychain-access-groups` 權限，由 App ID `app.rosetta.shell` 的 Developer ID 描述檔授權；描述檔放在 `src-tauri/embedded.provisionprofile`（綁定開發者帳號，不進倉庫），`scripts/release.sh` 找到它才把權限和描述檔加進 App，找不到就用舊式鑰匙圈。開發版是裸執行檔放不了描述檔，一律用舊式鑰匙圈的單一項目；`scripts/dev-sign-run.sh` 用固定身分簽章，按一次「永遠允許」後不再問。第一次讀不到新項目時，會把改版前分開存的項目搬過來並刪掉。用別的開發者帳號發行時，把 `Entitlements.plist` 的團隊 ID 換成自己的，並放上自己的描述檔。

權杖與 cookie 不寫進檔案、日誌、錯誤訊息或事件 payload；`Credentials` 的 `Debug` 會遮掉兩者。不從 Chrome 或其他瀏覽器讀 cookie。

**失效偵測**：任何呼叫收到 `invalid_auth`、`not_authed`、`token_revoked`、`token_expired`、`account_inactive`，Rust 會清掉記憶體中的 session、停掉即時連線、發出 `auth://invalid`；前端回到登入頁並顯示「Slack 登入已失效，請重新登入」。鑰匙圈的舊值保留到重新登入時覆蓋，或按「登出」刪除。

## 已實作

- 側欄：頻道、私人頻道、私訊、群組私訊；未讀加粗、提及數紅點；連線狀態；dock 徽章顯示提及總數（僅可寫入模式）。
- 訊息流：三種閱讀模式（每個頻道各自記住）、譯文細線與字色、俚語點狀底線與提示、日期分隔、連發合併、「載入更早的訊息」、離開回來的摘要卡（三則以上未讀時）。
- Slack mrkdwn：粗體／斜體／刪除線、行內與區塊程式碼、引用、連結（只放行 http/https/mailto/slack）、使用者／頻道／廣播提及、標準與自訂 emoji、膚色；提及自己的訊息加底色。
- 討論串側窗：根訊息＋回覆，在討論串裡同樣用中文寫、潤色、審閱後回覆。
- 表情回應：顯示、點一下加／取消、挑選器（常用＋搜尋）。
- 檔案：圖片縮圖與燈箱、其他檔案卡片；輸入區附加檔案（也可直接貼上），隨訊息一起送出。
- 寫作（可寫入模式的送出流程；唯讀模式見上方「兩種模式」）：Enter 換行、⌘↩ 潤色、輸入法組字中不觸發；審閱卡（可編輯英文、拆則／合併、三段語氣、回譯與意思比對、為什麼這樣寫、再調整）；送出鈕在審閱卡出現後 0.8 秒內不作用；送出後 5 秒撤回期內不會真的呼叫 Slack，撤回會還原草稿、附件與審閱卡；自己的訊息下方顯示中文原稿（Rosetta 送出的以 ts 對應；官方用戶端送出的以複製時記下的英文比對）。
- 自己的訊息可修改（chat.update）與刪除（chat.delete，要按兩次確認）。
- macOS 通知（僅可寫入模式）：私訊或提及你的訊息，且你不在看那個頻道（或視窗不在前景）時。
- 即時連線：rtm.connect + websocket；連不上就每 15 秒輪詢目前頻道、每 60 秒重試 websocket。
- 速率限制：HTTP 429 依 `Retry-After` 等待，沒有就 1、2、4、8 秒指數退避（上限 30 秒），最多重試 4 次；5xx 同樣退避。

## 用真實 Slack 驗證過什麼（2026-10-30，使用者自己的 workspace）

使用者本人在 debug 版裡登入。已確認：登入視窗擷取 xoxc 與 `d` cookie、存進鑰匙圈、`auth.test`、`users.conversations` 側欄、`conversations.history` 訊息流、`users.info` 名字與頭像、`rtm.connect` + websocket（側欄顯示「即時連線」，沒有退到輪詢）。

**還沒驗證**：送出（chat.postMessage）、修改與刪除、表情回應、討論串、檔案上傳與 `slackfile://` 取私有圖片、`client.counts` 未讀數是否正確、收到即時事件後的通知與徽章、權杖失效後的重新登入流程、429 限流的實際行為。這些都有單元測試或示範模式涵蓋，但沒對真 Slack 跑過；送出類操作要使用者自己決定何時試。

截圖（示範資料，公司、人名與對話都是虛構的；2026-11-19 用 WebKit 1280×820 @2x 拍）：`docs/screenshots/`，`login.png`、`demo-feed.png`、`demo-zh.png`、`demo-review.png`、`demo-thread.png`。

## 已知風險與限制

- **權杖借用**：xoxc + `d` cookie 是 Slack 網頁版的內部用法，不是公開 API 的授權方式。Slack 可能偵測後作廢權杖、要求重新登入，或觸發安全警示並通知 workspace 管理員。使用者已知情並選擇此路。
- **網頁版內部 API**：`client.counts`（未讀數）與 `rtm.connect`（即時連線）對 xoxc 是否可用、回應格式為何，**都沒有用真 Slack 驗證**。`client.counts` 失敗時未讀數一律為 0；`rtm.connect` 失敗時退到輪詢（側欄顯示「輪詢中」）。
- **`localConfig_v2` 格式**是依公開資料推測的，Slack 改版就可能取不到權杖（會停在登入視窗，不會出錯也不會外洩）。
- 草稿切換頻道後不保留；譯文沒有持久快取。
- `@名字` 不會自動轉成 Slack 提及（避免誤 ping）；中文草稿裡的 @ 只是文字。
- emoji 名稱表只收常用的一批，其他標準 emoji 會顯示成 `:name:`。
- 啟動時打開上次看的頻道（localStorage `rosetta.lastChannel`），沒有紀錄就開列表第一個。

## 簽章、公證與自動更新

- `tauri.conf.json` 不寫簽章身分。建置時由環境變數 `APPLE_SIGNING_IDENTITY` 提供；沒有設定就不簽章（本機開發用）。
- 發行版用根目錄的 `scripts/release.sh` 建置：簽章、公證（`APPLE_ID`、`APPLE_TEAM_ID`，App 專用密碼從鑰匙圈服務 `rosetta-notary` 讀），並用 `--config` 併入 `plugins.updater`（公鑰與 `https://github.com/<倉庫>/releases/latest/download/latest.json`）。步驟見根目錄 README 的「發行」。
- `src-tauri/src/lib.rs` 只在 `plugins.updater` 有公鑰和網址時才註冊 updater（`updater_configured`，測試在 `tests/updater.rs`）。開發版沒有這段設定，前端 `lib/updater.svelte.ts` 的檢查會失敗並安靜略過。
- 有新版時，側欄左下出現「安裝新版 x.y.z 並重新開啟」，下載安裝後用 `tauri-plugin-process` 重新啟動。
