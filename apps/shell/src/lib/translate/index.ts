// 目前用的實作：鑰匙圈裡有 LLM 金鑰就接 packages/llm，沒有就用假實作（示範資料、瀏覽器預覽、測試）。
import { invoke } from '@tauri-apps/api/core';
import { FakePolisher, FakeSummarizer, FakeTranslator, FakeVerifier } from './fake';
import { GLOSSARY } from './glossary';
import { createShellLLM, LLM_PROVIDERS, LlmPolisher, LlmSummarizer, LlmTranslator, LlmVerifier, strongTranslateModel, type KeyStatus, type LlmProviderId } from './llm';
import { llmStatus } from './runtime.svelte';
import type { Polisher, Summarizer, Translator, Verifier } from './types';

interface Impl {
  translator: Translator;
  polisher: Polisher;
  verifier: Verifier;
  summarizer: Summarizer;
}

const fake: Impl = {
  translator: new FakeTranslator(),
  polisher: new FakePolisher(),
  verifier: new FakeVerifier(),
  summarizer: new FakeSummarizer(),
};
let impl: Impl = fake;

export const translator: Translator = { translate: (items, ctx) => impl.translator.translate(items, ctx) };
export const polisher: Polisher = {
  polish: (req) => impl.polisher.polish(req),
  refine: (req, prev, instruction) => impl.polisher.refine(req, prev, instruction),
};
export const verifier: Verifier = {
  backTranslate: (english, channel) => impl.verifier.backTranslate(english, channel),
  compare: (draft, back, english) => impl.verifier.compare(draft, back, english),
};
export const summarizer: Summarizer = { summarize: (items, channel) => impl.summarizer.summarize(items, channel) };

const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// 讀鑰匙圈的金鑰狀態（不讀金鑰本身），決定用真模型或假實作
export async function refreshLLM(): Promise<void> {
  if (!inTauri()) {
    llmStatus.checked = true;
    return;
  }
  const keys = await invoke<KeyStatus>('llm_key_status', { providers: [...LLM_PROVIDERS] });
  llmStatus.keys = keys;
  llmStatus.checked = true;
  if (!keys.anthropic && !keys.deepseek) {
    impl = fake;
    llmStatus.fake = true;
    return;
  }
  const llm = createShellLLM(keys);
  impl = {
    translator: new LlmTranslator(llm, strongTranslateModel(keys)),
    polisher: new LlmPolisher(llm),
    verifier: new LlmVerifier(llm, GLOSSARY),
    summarizer: new LlmSummarizer(llm, GLOSSARY),
  };
  llmStatus.fake = false;
}

export async function setLlmKey(provider: LlmProviderId, key: string | null): Promise<void> {
  await invoke('llm_key_set', { provider, key });
  await refreshLLM();
}

export { llmStatus };
export { LLM_PROVIDERS, type LlmProviderId };
export * from './types';
export { GLOSSARY } from './glossary';
