import { describe, expect, it } from 'vitest';
import { createLLM, DEFAULT_CONFIG, parseConfig, parseModelRef } from '../src/config.js';
import { createMockProvider } from '../src/providers/mock.js';
import type { GenerateRequest } from '../src/types.js';

describe('parseModelRef', () => {
  it('只切第一個冒號，本機模型名裡的冒號保留', () => {
    expect(parseModelRef('local:qwen3:14b')).toEqual({ provider: 'local', model: 'qwen3:14b' });
  });
  it('@ 後是合法 effort 才拆出來', () => {
    expect(parseModelRef('anthropic:claude-opus-5-5@low')).toEqual({ provider: 'anthropic', model: 'claude-opus-5-5', effort: 'low' });
    expect(parseModelRef('local:org/model@v2')).toEqual({ provider: 'local', model: 'org/model@v2' });
  });
  it('缺供應商或模型就報錯', () => {
    expect(() => parseModelRef('claude-opus-5-5')).toThrow(/供應商:模型/);
    expect(() => parseModelRef('anthropic:')).toThrow();
  });
});

describe('parseConfig', () => {
  it('空設定得到預設：閱讀走 DeepSeek Flash，寫作走 Claude', () => {
    const c = parseConfig({});
    expect(c).toEqual(DEFAULT_CONFIG);
    expect(c.steps.translate).toMatchObject({ provider: 'deepseek', model: 'deepseek-flash' });
    expect(c.steps.polish.provider).toBe('anthropic');
  });

  it('使用者設定逐鍵疊在預設上，可用簡寫指定步驟', () => {
    const c = parseConfig({
      providers: { local: { kind: 'openai-compatible', baseURL: 'http://localhost:11434/v1', requireApiKey: false, jsonMode: 'prompt' } },
      steps: { translate: 'local:qwen3:14b', polish: { provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'high' } },
    });
    expect(Object.keys(c.providers).sort()).toEqual(['anthropic', 'deepseek', 'local']);
    expect(c.steps.translate).toEqual({ provider: 'local', model: 'qwen3:14b' });
    expect(c.steps.polish).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'high' });
    expect(c.steps.compare).toEqual(DEFAULT_CONFIG.steps.compare);
  });

  it('步驟指到不存在的供應商會指出是哪一步', () => {
    expect(() => parseConfig({ steps: { polish: 'openai:gpt-x' } })).toThrow(/steps\.polish.*openai/);
  });

  it('未知欄位、未知步驟、錯的 kind、缺 baseURL 都擋下並列出路徑', () => {
    expect(() => parseConfig({ steps: { polsh: 'anthropic:x' } })).toThrow(/設定檔格式錯誤/);
    expect(() => parseConfig({ providers: { x: { kind: 'gemini' } } })).toThrow(/providers\.x/);
    expect(() => parseConfig({ providers: { x: { kind: 'openai-compatible' } } })).toThrow(/baseURL/);
    expect(() => parseConfig({ providers: { anthropic: { kind: 'anthropic', apiKey: 'sk-oops' } } })).toThrow(/設定檔格式錯誤/);
  });
});

describe('createLLM', () => {
  function capture() {
    const seen: GenerateRequest[] = [];
    const mock = createMockProvider('mock', (req) => {
      seen.push(req);
      return 'ok';
    });
    return { seen, overrides: { anthropic: mock, deepseek: mock } };
  }

  it('run 依步驟帶入模型與 effort；呼叫端可覆寫', async () => {
    const { seen, overrides } = capture();
    const llm = createLLM({}, { providerOverrides: overrides });
    await llm.run('polish', { messages: [{ role: 'user', content: 'hi' }] });
    await llm.run('translate', { messages: [{ role: 'user', content: 'hi' }], effort: 'low' });
    expect(seen[0]).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'medium' });
    expect(seen[1]).toMatchObject({ model: 'deepseek-flash', effort: 'low' });
  });

  it('withStep 回傳新物件，不改原本的設定', async () => {
    const { seen, overrides } = capture();
    const base = createLLM({}, { providerOverrides: overrides });
    const alt = base.withStep('polish', 'anthropic:claude-opus-5-5@high');
    await alt.run('polish', { messages: [] });
    await base.run('polish', { messages: [] });
    expect(seen.map((r) => `${r.model}@${r.effort}`)).toEqual(['claude-opus-5-5@high', 'claude-sonnet-5-5@medium']);
    expect(() => base.withStep('polish', 'nope:x')).toThrow(/nope/);
  });
});
