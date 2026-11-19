# @rosetta/llm

Rosetta 的 LLM 接入層：多家供應商可插拔，每個步驟各自指定供應商與模型；提供閱讀端（翻譯、俚語、摘要）與寫作端（潤色、回譯、意思比對）的任務函式。與 UI 無關，殼（`apps/shell`）直接 import TypeScript 原始碼即可。`bench/` 是 M0 潤色品質實驗台。

```bash
npm install
npm test          # vitest，不打網路
npm run typecheck
npm run bench -- --mock   # 不打網路，驗證 bench 流程與報告格式
```

## 介面

```ts
import { createLLM, computeToneProfile, reviewDraft, translateBatch } from '@rosetta/llm';

const llm = createLLM(config, { getApiKey: (providerId, envName) => keychain.get(providerId) });

// 閱讀：英→台灣繁中，保留術語表，附俚語註解（phrase 一定是原文的子字串，可直接畫點狀底線）
const { translations } = await translateBatch(llm, { messages, context, glossary });

// 寫作：一次跑完審閱卡（polish → 獨立回譯 → 三個意思比對並行）
const tone = computeToneProfile(last200Messages);           // 純函式，不用模型
const card = await reviewDraft(llm, { draft, recent, replyTo, tone, glossary, myVoice });
card.variants.channel.bubbles;   // 要送出的訊息陣列（頻道習慣連發就拆）
card.variants.channel.merged;    // 合併成一則的版本；只有一則時為 null
card.variants.channel.back;      // 回譯
card.variants.channel.check;     // { status: 'ok'|'warn'|'info', summary, added, omitted, toneShifts, highlights }
card.variants.channel.notes;     // 為什麼這樣寫：[{ phrase, why }]
```

| 函式 | 步驟 | 說明 |
| --- | --- | --- |
| `translateBatch` | translate | 每批 20 則（可調），前面的訊息當脈絡；模型漏譯任何一則就丟錯 |
| `annotateIdioms` | annotate | 「解釋用法」：單則訊息的俚語、片語說明 |
| `summarizeUnread` | summarize | 回來時的一段中文摘要 |
| `polish` | polish | 一次回傳 `casual`／`channel`／`formal` 三種語氣，各含 `bubbles`、`merged`、`notes`；`instruction` 欄位接「再調整」 |
| `backtranslate` | backtranslate | 輸入型別只有英文（`texts`），**沒有放中文原稿的欄位**；測試會檢查請求內容裡沒有草稿 |
| `compareMeaning` | compare | 原稿 vs 回譯：新增、遺漏、語氣強弱；`highlights` 只保留確實出現在回譯裡的片段 |
| `reviewDraft` | 以上三步 | 對應設計稿審閱卡的完整資料形狀 |

所有結構化步驟都用 zod 定義輸出、轉成 JSON Schema 交給供應商，回來後再用 zod 驗證；格式不符丟 `LLMError`（`kind: 'bad_json'`），不把壞資料交給介面。錯誤種類：`auth`、`refusal`、`truncated`、`bad_json`、`http`、`config`。

需要底層呼叫時用 `llm.run(step, { system, messages, json?, onText?, signal? })`；給 `onText` 就走串流。

## 設定

```jsonc
{
  "providers": {
    // anthropic、deepseek 兩家內建，不寫也有；這裡示範加一個本機模型
    "local": { "kind": "openai-compatible", "baseURL": "http://localhost:11434/v1", "requireApiKey": false, "jsonMode": "prompt" }
  },
  "steps": {
    "translate": "local:qwen3:14b",                        // 簡寫：供應商:模型[@effort]
    "polish": { "provider": "anthropic", "model": "claude-sonnet-5-5", "effort": "high", "maxTokens": 8000 }
  }
}
```

使用者設定逐鍵疊在預設上；寫錯欄位、步驟指到不存在的供應商，`parseConfig` 會列出路徑報錯。完整範例見 [bench/rosetta.config.example.json](bench/rosetta.config.example.json)。

| 步驟 | 預設 | 理由 |
| --- | --- | --- |
| translate、annotate、summarize | `deepseek:deepseek-flash` | 使用者拍板：閱讀量大、要便宜 |
| polish | `anthropic:claude-sonnet-5-5@medium` | M0 bench 兩輪：意思檢查最穩、最快、最便宜，品質與 Opus 5.5 相當（見下方「M0 結果」） |
| backtranslate | `anthropic:claude-haiku-5-5@low` | 只是忠實翻譯；刻意和 polish 用不同模型，減少同一模型替自己圓話 |
| compare | `anthropic:claude-sonnet-5-5@medium` | 需要判斷力，輸入很短 |

供應商種類：

| kind | 用途 | 結構化輸出 |
| --- | --- | --- |
| `anthropic` | 官方 `@anthropic-ai/sdk` | `output_config.format`（json_schema） |
| `deepseek` | `https://api.deepseek.com`，模型 `deepseek-flash`／`deepseek-v4-pro`；預設不思考，步驟加 `@effort` 才開 | `json_object`，schema 寫進 system 提示（官方只支援 json_object） |
| `openai-compatible` | OpenAI、OpenRouter、Ollama、LM Studio 等 | `jsonMode`：`json_schema`（預設）、`json_object`、`prompt` |

Anthropic 的組裝規則（見 `src/providers/anthropic.ts`）：不送 `temperature`（Opus 5.5 不支援，2026-10-21 起所有模型送了都會 400）；不送 `thinking`（5.x 省略即為 adaptive，Opus 5.5 不能關）；`effort` 一律明確給，預設 `medium`；Opus 5.5／Sonnet 5.5 預設開伺服器端拒答備援（beta `server-side-fallback-2026-07-01`，`fallbacks: "default"`），設定 `refusalFallback: false` 可關。

**金鑰**：預設從環境變數讀（`ANTHROPIC_API_KEY`、`DEEPSEEK_API_KEY`，或供應商設定的 `apiKeyEnv`）；殼應傳 `getApiKey(providerId, envName)` 從鑰匙圈讀。設定檔只放環境變數名稱，schema 不接受 `apiKey` 欄位，金鑰不會進 git。

## 頻道語氣檔案

`computeToneProfile(messages)` 是純函式，統計：小寫開頭比例（只算字母開頭，先去掉提及、網址、表情代碼、引用行）、句尾標點分布（無／句號／問號／驚嘆號／刪節號）、常見縮寫（固定詞表、整詞比對）、平均字數與字元數、連發比例（同一人相鄰且相隔 5 分鐘內）、emoji 比例，並挑 15 則真實訊息當範例。`describeToneProfile` 把它寫成給模型讀的英文描述。殼每天對最近 200 則重算一次即可。

## M0 實驗台（bench）

```bash
export ANTHROPIC_API_KEY=...        # 必要：潤色候選與回譯／比對都用 Claude
export DEEPSEEK_API_KEY=...         # 想把 deepseek-flash 也列入候選時
npm run bench                                         # 預設比較 opus-5-5@low、opus-5-5@medium、sonnet-5-5@medium
npm run bench -- --models anthropic:claude-sonnet-5-5@low,deepseek:deepseek-flash
npm run bench -- --cases 01,04                        # 只跑檔名開頭符合的 case
npm run bench -- --same-model                         # 回譯與比對也換成候選模型（預設固定，避免評分者跟著換）
npm run bench -- --dry-run                            # 只印第一個 case 的潤色提示，不打網路
npm run bench -- --config path/to/config.json         # 預設讀 bench/rosetta.config.json（已 gitignore）
```

缺金鑰的候選會在開跑前列出並跳過；全部都缺時以 exit code 2 結束。輸出到 `bench/reports/<日期-時間>.md`（並排比較）與同名 `.json`（原始資料）。報告每格都留了 ☐ 讓你勾「可以直接送」，總覽表最後一欄填各模型的總數；自動的「意思檢查」只是輔助，M0 的判準是你自己覺得可以直接送的比例。`--mock` 產生的報告檔名帶 `-mock`，不進 git。

### 只用 DeepSeek 的結果（2026-11-19，5 個範例 case × 2 輪）

Claude API 暫時不能用，所以比較了全部走 DeepSeek 的組合。回譯固定 `deepseek-flash`（不開思考）；比對第一輪不開思考、第二輪開 `@medium`。報告：[第一輪](bench/reports/2026-11-19-1836.md)、[第二輪](bench/reports/2026-11-19-1839.md)。

| polish 候選 | 讀過「像這個頻道」版本後的判斷（10 則） | polish 平均延遲 | 整張審閱卡平均 |
| --- | --- | --- | --- |
| `deepseek-flash`（不思考） | case 04 兩輪都漏掉「給你們看」；1 次重試後仍回錯格式，整張卡失敗 | 4 s | 6–10 s |
| `deepseek-flash@low` | case 04 兩輪都漏掉「給你們看」，還加了原稿沒有的 tbh 或把「不太確定」寫成「不確定」 | 12 s | 15–18 s |
| `deepseek-flash@high` | 第一輪 5 則都對；第二輪漏掉道謝對象的名字 1 次、case 04 漏掉「給你們看」1 次 | 9 s | 11–15 s |
| `deepseek-v4-pro` | 「好像」常被寫成肯定句、會漏名字與承諾，最差 | 8–10 s | 13–14 s |

結論：只有 DeepSeek 金鑰時，潤色用 `deepseek-flash@high`（殼的 `configFor()`）。它保留語氣最穩，兩輪都沒有格式錯誤，polish 速度接近 Sonnet 5.5（約 8 s）。比對開不開思考，抓到的問題差不多，開了每張卡多 3–5 秒，所以不開。這只是 5 個範例 case，最後還是要用真實草稿判斷。

**DeepSeek 的思考模式**：供應商預設關閉（`extraBody.thinking.type = disabled`，翻譯要快）。步驟的模型寫法加上 effort（例如 `deepseek:deepseek-flash@high`）就對那一步開思考，送出 `thinking: {type: enabled}` 與 `reasoning_effort`（見 `src/providers/openai-compatible.ts` 的 `effortParam`）。DeepSeek 接受的 effort：`low`、`medium`、`high`、`xhigh`、`max`。

### M0 結果（2026-10-30，Claude 與 DeepSeek）

當時用的範例對話含私人頻道內容，報告已移除，只留結論：`claude-sonnet-5-5@medium` 意思檢查最穩（10/10 非 warn）、polish 約 8 s、每次審閱約 $0.03，所以兩把金鑰都有時潤色用它。Opus 5.5 偶爾把問句寫成肯定句；`deepseek-flash`（不思考）會把「好像」寫篤定。回譯會從脈絡自行補上產品名、把「細則」譯成「小字說明」，造成比對誤報；現在回譯帶術語表並禁止補脈絡資訊，比對看得到對話、忽略同義詞。

### 補你自己的真實草稿

1. 從 Slack 複製一段真實對話（最近 10–20 則），存成 `bench/conversations/<名字>.json`，格式是 `[{ "user": "...", "text": "...", "ts": 1793145360 }]`（`ts` 可省略）。
2. 在 `bench/cases/` 新增一個 JSON。檔名用 `private-` 開頭（例如 `private-07-xxx.json`）就不會進 git，適合放真實頻道內容：

```json
{
  "id": "private-07-deadline",
  "title": "跟編輯確認截稿時間",
  "conversation": "team-1030",
  "replyTo": 4,
  "draft": "你的中文草稿",
  "watch": "這則要特別注意的地方（會寫進報告）",
  "myVoice": ["你以前在 Slack 寫過的英文", "可省略"]
}
```

`conversation` 也可以直接內嵌陣列；`replyTo` 是對話裡的索引（0 起算），也可以直接給 `{ "user", "text" }`；`toneSamples` 可以額外放更多頻道訊息只給語氣統計用。概念文件的目標是 15–20 則真實草稿。

內附 5 個範例 case 共用一段虛構的編輯部對話（`bench/conversations/newsroom.json`），各測一種容易出錯的地方：帶保留的猜測（「也許」不能變 prob）、問句、道謝加提議、委婉的不同意見、多個數字與產品名。

## 檔案

| 路徑 | 內容 |
| --- | --- |
| `src/types.ts` | 供應商介面、請求／結果、錯誤、步驟名 |
| `src/config.ts` | 設定 schema、預設、`parseConfig`、`createLLM` |
| `src/providers/` | `anthropic.ts`、`openai-compatible.ts`（含 DeepSeek）、`mock.ts`（測試與介面開發用） |
| `src/tone.ts` | 頻道語氣統計 |
| `src/tasks/` | `read.ts`（翻譯、俚語、摘要）、`write.ts`（潤色、回譯、比對、審閱卡）、`shared.ts`（脈絡格式、JSON 驗證） |
| `src/pricing.ts` | Claude 牌價（2026-10），bench 估成本用；其他供應商未查證不列 |
| `bench/` | `run.ts`、`cases/`、`conversations/`、`glossary.json`、`reports/` |
