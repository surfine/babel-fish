// 唯讀模式下，英文是使用者複製後到官方 Slack 自己送的，Rosetta 拿不到那則訊息的 ts。
// 複製時先記下「英文（正規化後）→ 中文原稿」，之後在訊息流裡看到自己的訊息，用文字對回去，就能顯示「你的原稿」。

export interface CopyDraft {
  zh: string;
  at: number; // 毫秒時間戳
}
export type CopyDraftMap = Record<string, CopyDraft>;

export const COPY_DRAFT_KEY = 'rosetta.copyDrafts';
export const COPY_DRAFT_TTL_MS = 7 * 24 * 3600 * 1000;
export const COPY_DRAFT_CAP = 200;

// 去頭尾空白、連續空白（含換行）收成一個空格、彎引號與彎撇號換成直的。
// Slack 送出時會動到這幾處（智慧引號、空白），所以比對前兩邊都先正規化。
export function normalizeEnglish(text: string): string {
  return text
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// 回傳新的 map（不改動傳入的）：過期的丟掉，超過上限就丟最舊的。
export function pruneCopyDrafts(map: CopyDraftMap, now: number): CopyDraftMap {
  const live = Object.entries(map).filter(([, v]) => v && typeof v.zh === 'string' && now - v.at < COPY_DRAFT_TTL_MS);
  live.sort((a, b) => b[1].at - a[1].at);
  return Object.fromEntries(live.slice(0, COPY_DRAFT_CAP));
}

// 記一筆。空的英文或空的原稿不記。
export function recordCopyDraft(map: CopyDraftMap, english: string, zh: string, now: number): CopyDraftMap {
  const key = normalizeEnglish(english);
  if (!key || !zh.trim()) return pruneCopyDrafts(map, now);
  return pruneCopyDrafts({ ...map, [key]: { zh, at: now } }, now);
}

export function lookupCopyDraft(map: CopyDraftMap, text: string, now: number): string | undefined {
  const key = normalizeEnglish(text);
  if (!key) return undefined;
  const hit = map[key];
  return hit && now - hit.at < COPY_DRAFT_TTL_MS ? hit.zh : undefined;
}
