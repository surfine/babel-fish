// 貼上引導卡的規則（參考 Apple TipKit）：
// - 使用者真的在 Slack 送出了剛複製的英文，就算完成（TipKit 的 invalidate(.actionPerformed)），卡片收起
// - 完成 COMPACT_AFTER 次以後只顯示精簡版（TipKit 的 MaxDisplayCount 概念：學會了就少講）
// - 使用者可以在設定裡關掉
import { normalizeEnglish } from './copydrafts';

export const GUIDE_PREF_KEY = 'rosetta.pasteGuide';
export const COMPACT_AFTER = 3;

export interface GuidePref {
  enabled: boolean;
  done: number;
}

export const DEFAULT_GUIDE_PREF: GuidePref = { enabled: true, done: 0 };

export function parseGuidePref(raw: string | null): GuidePref {
  try {
    const v = JSON.parse(raw ?? 'null');
    return {
      enabled: typeof v?.enabled === 'boolean' ? v.enabled : true,
      done: Number.isInteger(v?.done) && v.done >= 0 ? v.done : 0,
    };
  } catch {
    return { ...DEFAULT_GUIDE_PREF };
  }
}

export const isCompact = (p: GuidePref) => p.done >= COMPACT_AFTER;
export const recordDone = (p: GuidePref): GuidePref => ({ ...p, done: p.done + 1 });

/** 使用者在官方 Slack 送出的訊息，是不是剛才複製的英文（其中一則泡泡，或合併後的全文） */
export function matchesCopied(copied: string[], sentText: string): boolean {
  const sent = normalizeEnglish(sentText);
  if (!sent) return false;
  const candidates = [...copied, copied.join('\n\n')].map(normalizeEnglish);
  return candidates.includes(sent);
}

export interface CopySent {
  channel: string;
  draftZh: string;
}

/** 在官方 Slack 傳送了剛複製的英文後，這個輸入框要不要清掉：同一個頻道、還是同一份草稿才清 */
export function shouldClearComposer(sent: CopySent | null, here: { channel: string; draft: string; reviewDraft: string | null }): boolean {
  if (!sent || sent.channel !== here.channel) return false;
  const d = sent.draftZh.trim();
  return here.reviewDraft?.trim() === d || here.draft.trim() === d;
}
