// LLM 實作的切換狀態：鑰匙圈裡有金鑰就用真模型，沒有就用假實作。
import type { KeyStatus } from './llm';

export const llmStatus = $state<{ fake: boolean; keys: KeyStatus; checked: boolean }>({
  fake: true,
  keys: { anthropic: false, deepseek: false },
  checked: false,
});
