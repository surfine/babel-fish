// AI 呼叫失敗時給使用者看的話：說發生什麼、接下來怎麼做，不顯示 HTTP 細節
export function aiErrText(e: unknown): string {
  const err = e as { name?: string; kind?: string; status?: number; message?: string } | null;
  if (err?.name === 'LLMError') {
    if (err.kind === 'auth') return 'AI 金鑰沒填或無效，到「設定」檢查金鑰';
    if (err.kind === 'http' && err.status === 429) return 'AI 服務現在太忙，等一下再試';
    if (err.kind === 'http' && err.status === 402) return 'AI 帳戶的額度用完了，到服務商的網站儲值';
    if (err.kind === 'http' && (err.status ?? 0) >= 500) return 'AI 服務暫時出錯，等一下再試';
    if (err.kind === 'truncated' || err.kind === 'bad_json') return 'AI 的回覆不完整，再試一次';
    if (err.kind === 'refusal') return 'AI 拒絕處理這段內容，換個說法再試';
  }
  const msg = String(err?.message ?? e ?? '');
  if (/network|fetch|連線|timed? ?out/i.test(msg)) return '連不上 AI 服務，檢查網路後再試';
  return 'AI 沒有回應，再試一次';
}
