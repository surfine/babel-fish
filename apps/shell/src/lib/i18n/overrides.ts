// 自動轉換（術語表＋OpenCC）結果不對時，在這裡手寫該地區的說法。鍵是台灣正體原文。
import type { ZhVariant } from '@rosetta/llm';

export const OVERRIDES: Partial<Record<Exclude<ZhVariant, 'zh-TW'>, Record<string, string>>> = {
  'zh-CN': {},
  'zh-SG': {},
  'zh-HK': {},
};
