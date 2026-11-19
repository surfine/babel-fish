# 給在這個倉庫工作的 AI 代理

Babel Fish 是 macOS 上的 Slack 閱讀輔助工具（Tauri 2 + Svelte 5 + Rust）。內部代號 Rosetta，識別碼與鍵名仍用 `rosetta`，不要改。

1. 改程式之前，讀 [docs/INVARIANTS.md](docs/INVARIANTS.md)。那裡列的行為都驗證過，不能改壞。
2. 提交之前，跑 `scripts/check.sh`，全部通過才提交。只想快速檢查時用 `scripts/check.sh --fast`，但提交前仍要跑完整版。驗證只靠本機：GitHub Actions 不自動執行，pre-commit 跑快速檢查，pre-push 跑完整檢查。
3. 測試失敗時，修程式，不要改測試讓它通過。如果是行為本來就要改，先問維護者，再照 INVARIANTS.md 開頭的規則一起改。
4. 修了一個使用者回報的錯，就加一個測試，先確認拿掉修正時測試會失敗。介面互動的錯放在 `apps/shell/e2e/`（WebKit、示範模式）。
5. 新增介面文字要包 `t()`，再跑 `node apps/shell/scripts/i18n.mjs` 補英文。
6. 對外動作要先問維護者：推送、發 Release、改公開倉庫。

結構：

| 路徑 | 內容 |
| --- | --- |
| `packages/llm` | 多供應商 LLM 層、翻譯與潤色的提示、中文地區術語表 |
| `apps/shell/src` | Svelte 前端；`?demo` 是不登入的示範模式，`?guide` 是貼上引導卡 |
| `apps/shell/src-tauri` | Rust：Slack 連線、鑰匙圈、AI 請求代理、選單、引導卡視窗 |
| `apps/shell/e2e` | 端到端測試（Playwright + WebKit） |
| `scripts/` | `check.sh` 檢查、`release.sh` 簽章公證打包、`publish-public.sh` 產生公開倉庫的提交 |
