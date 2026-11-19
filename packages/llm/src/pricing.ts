import type { Usage } from './types.js';

/** 每百萬 token 美元牌價（Anthropic 官方，2026-10 查）。其他供應商價格變動快，沒查證就不寫，報告會顯示「—」。 */
export const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
};

export function estimateCost(model: string, usage: Usage, prices = PRICES): number | undefined {
  const p = prices[model];
  if (!p) return undefined;
  return (usage.inputTokens * p.input + usage.outputTokens * p.output) / 1_000_000;
}
