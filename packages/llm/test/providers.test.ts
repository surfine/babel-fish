import { describe, expect, it, vi } from 'vitest';
import { createProvider } from '../src/config.js';
import { buildAnthropicRequest, createAnthropicProvider, type AnthropicLike } from '../src/providers/anthropic.js';
import { buildOpenAIRequest, createOpenAICompatibleProvider } from '../src/providers/openai-compatible.js';
import { LLMError, type GenerateRequest } from '../src/types.js';

const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };
const base: GenerateRequest = { model: 'claude-opus-5-5', system: 'sys', messages: [{ role: 'user', content: 'hello' }] };

describe('Anthropic 請求組裝', () => {
  it('Opus 5.5：不送 temperature、不送 thinking、effort 明確給 medium', () => {
    const { params } = buildAnthropicRequest({ ...base, temperature: 0.7 });
    expect(params).not.toHaveProperty('temperature');
    expect(params).not.toHaveProperty('thinking');
    expect(params.output_config).toEqual({ effort: 'medium' });
    expect(params.system).toBe('sys');
  });

  it('結構化輸出放在 output_config.format，與 effort 並存', () => {
    const { params } = buildAnthropicRequest({ ...base, effort: 'low', json: { name: 'x', schema } });
    expect(params.output_config).toEqual({ effort: 'low', format: { type: 'json_schema', schema } });
  });

  it('Opus／Sonnet 5.5 預設開伺服器端拒答備援；Haiku 與關閉時不帶', () => {
    expect(buildAnthropicRequest(base)).toMatchObject({ betas: ['server-side-fallback-2026-07-01'], params: { fallbacks: 'default' } });
    expect(buildAnthropicRequest({ ...base, model: 'claude-sonnet-5-5' }).betas).toBeDefined();
    const haiku = buildAnthropicRequest({ ...base, model: 'claude-haiku-5-5' });
    expect(haiku.betas).toBeUndefined();
    expect(haiku.params).not.toHaveProperty('fallbacks');
    expect(buildAnthropicRequest(base, { refusalFallback: false }).betas).toBeUndefined();
  });
});

function fakeClient(response: any) {
  const calls: { api: string; body: any }[] = [];
  const make = (api: string) => ({
    create: vi.fn(async (body: any) => {
      calls.push({ api, body });
      return response;
    }),
    stream: vi.fn((body: any) => {
      calls.push({ api: `${api}.stream`, body });
      const handlers: Record<string, (d: string) => void> = {};
      return {
        on(ev: string, fn: (d: string) => void) {
          handlers[ev] = fn;
          return this;
        },
        async finalMessage() {
          for (const b of response.content) if (b.type === 'text') handlers.text?.(b.text);
          return response;
        },
      };
    }),
  });
  const client: AnthropicLike = { messages: make('messages'), beta: { messages: make('beta') } };
  return { client, calls };
}

const msg = (text: string, extra: Record<string, unknown> = {}) => ({
  model: 'claude-opus-5-5',
  stop_reason: 'end_turn',
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }],
  usage: { input_tokens: 10, output_tokens: 5 },
  ...extra,
});

describe('Anthropic provider', () => {
  it('有 betas 時走 beta 端點並帶 betas；只取 text 區塊並解析 JSON', async () => {
    const { client, calls } = fakeClient(msg('{"a":"b"}'));
    const p = createAnthropicProvider({ client });
    const res = await p.generate({ ...base, json: { name: 'x', schema } });
    expect(calls[0].api).toBe('beta');
    expect(calls[0].body.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(res).toMatchObject({ text: '{"a":"b"}', json: { a: 'b' }, usage: { inputTokens: 10, outputTokens: 5 } });
  });

  it('給 onText 就串流', async () => {
    const { client, calls } = fakeClient(msg('hi there'));
    const deltas: string[] = [];
    await createAnthropicProvider({ client, refusalFallback: false }).generate({ ...base, onText: (d) => deltas.push(d) });
    expect(calls[0].api).toBe('messages.stream');
    expect(deltas.join('')).toBe('hi there');
  });

  it('拒答與截斷變成可辨識的錯誤', async () => {
    const refused = createAnthropicProvider({ client: fakeClient(msg('', { stop_reason: 'refusal', stop_details: { category: 'cyber' } })).client });
    await expect(refused.generate(base)).rejects.toMatchObject({ kind: 'refusal', message: expect.stringContaining('cyber') });
    const cut = createAnthropicProvider({ client: fakeClient(msg('{"a":', { stop_reason: 'max_tokens' })).client });
    await expect(cut.generate(base)).rejects.toMatchObject({ kind: 'truncated' });
  });

  it('金鑰從取得函式讀；拿不到就報 auth，不送請求', async () => {
    const getApiKey = vi.fn(() => undefined);
    await expect(createAnthropicProvider({ getApiKey }).generate(base)).rejects.toMatchObject({ kind: 'auth' });
    expect(getApiKey).toHaveBeenCalledWith('anthropic', 'ANTHROPIC_API_KEY');
  });
});

describe('OpenAI 相容請求組裝', () => {
  const opts = { id: 'openai', baseURL: 'https://api.example.com/v1/' };

  it('json_schema 模式送 strict schema，system 不動；網址去掉多餘斜線', () => {
    const r = buildOpenAIRequest({ ...base, model: 'gpt-x', json: { name: 'polish', schema } }, opts, 'k');
    expect(r.url).toBe('https://api.example.com/v1/chat/completions');
    expect(r.headers.authorization).toBe('Bearer k');
    expect(r.body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'polish', schema, strict: true } });
    expect(r.body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
    ]);
  });

  it('json_object 模式：schema 寫進 system，且提示裡有 JSON 這個字（DeepSeek 的要求）', () => {
    const r = buildOpenAIRequest({ ...base, json: { name: 'x', schema } }, { ...opts, jsonMode: 'json_object' });
    expect(r.body.response_format).toEqual({ type: 'json_object' });
    const system = (r.body.messages as any[])[0].content as string;
    expect(system.startsWith('sys')).toBe(true);
    expect(system).toContain('JSON');
    expect(system).toContain(JSON.stringify(schema));
  });

  it('prompt 模式不送 response_format；沒有 system 時也會補一則', () => {
    const r = buildOpenAIRequest({ model: 'm', messages: [{ role: 'user', content: 'x' }], json: { name: 'x', schema } }, { ...opts, jsonMode: 'prompt' });
    expect(r.body).not.toHaveProperty('response_format');
    expect((r.body.messages as any[])[0].role).toBe('system');
    expect(r.headers).not.toHaveProperty('authorization');
  });

  it('temperature 有給才送；串流加 include_usage；extraBody 原樣併入', () => {
    const r = buildOpenAIRequest({ ...base, temperature: 0.2, onText: () => {} }, { ...opts, extraBody: { thinking: { type: 'disabled' } } });
    expect(r.body).toMatchObject({ temperature: 0.2, stream: true, stream_options: { include_usage: true }, thinking: { type: 'disabled' } });
    expect(buildOpenAIRequest(base, opts).body).not.toHaveProperty('temperature');
  });

  it('DeepSeek：步驟有 effort 才開思考，覆蓋供應商的 thinking disabled；沒有 effort 維持關閉', () => {
    const ds = { ...opts, extraBody: { thinking: { type: 'disabled' } }, effortParam: 'deepseek' as const };
    expect(buildOpenAIRequest({ ...base, effort: 'low' }, ds).body).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'low' });
    const off = buildOpenAIRequest(base, ds).body;
    expect(off).toMatchObject({ thinking: { type: 'disabled' } });
    expect(off).not.toHaveProperty('reasoning_effort');
    // 一般 openai-compatible 供應商不送 effort
    expect(buildOpenAIRequest({ ...base, effort: 'high' }, opts).body).not.toHaveProperty('reasoning_effort');
  });
});

function sse(chunks: string[]) {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    }),
  );
}

describe('OpenAI 相容 provider', () => {
  it('DeepSeek 預設打 api.deepseek.com、用 json_object、讀 DEEPSEEK_API_KEY', async () => {
    const fetch = vi.fn(async (_url: string, _init: any) =>
      Response.json({ model: 'deepseek-flash', choices: [{ message: { content: '```json\n{"a":"中文"}\n```' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 4 } }),
    );
    const getApiKey = vi.fn(() => 'dk');
    const p = createProvider('deepseek', { kind: 'deepseek' }, { fetch: fetch as any, getApiKey });
    const res = await p.generate({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'x' }], json: { name: 'x', schema } });
    expect(getApiKey).toHaveBeenCalledWith('deepseek', 'DEEPSEEK_API_KEY');
    expect(fetch.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions');
    expect(JSON.parse(fetch.mock.calls[0][1].body).response_format).toEqual({ type: 'json_object' });
    expect(res).toMatchObject({ json: { a: '中文' }, usage: { inputTokens: 3, outputTokens: 4 } });
  });

  it('SSE 串流：跨 chunk 切斷的行也能接起來，最後一包帶用量', async () => {
    const fetch = vi.fn(async () =>
      sse([
        'data: {"choices":[{"delta":{"content":"he"}}]}\n\ndata: {"choi',
        'ces":[{"delta":{"content":"llo"},"finish_reason":"stop"}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2}}\n\ndata: [DONE]\n\n',
      ]),
    );
    const p = createOpenAICompatibleProvider({ id: 'local', baseURL: 'http://localhost:11434/v1', requireApiKey: false, fetch: fetch as any });
    const deltas: string[] = [];
    const res = await p.generate({ model: 'qwen3:14b', messages: [{ role: 'user', content: 'x' }], onText: (d) => deltas.push(d) });
    expect(deltas).toEqual(['he', 'llo']);
    expect(res).toMatchObject({ text: 'hello', usage: { inputTokens: 7, outputTokens: 2 }, stopReason: 'stop' });
  });

  it('HTTP 錯誤、截斷、缺金鑰各自成錯誤種類', async () => {
    const err401 = createOpenAICompatibleProvider({ id: 'o', baseURL: 'https://x', getApiKey: () => 'k', fetch: (async () => new Response('bad key', { status: 401 })) as any });
    await expect(err401.generate(base)).rejects.toMatchObject({ kind: 'auth', status: 401 });
    const cut = createOpenAICompatibleProvider({
      id: 'o',
      baseURL: 'https://x',
      getApiKey: () => 'k',
      fetch: (async () => Response.json({ choices: [{ message: { content: '{' }, finish_reason: 'length' }] })) as any,
    });
    await expect(cut.generate(base)).rejects.toMatchObject({ kind: 'truncated' });
    const noKey = createOpenAICompatibleProvider({ id: 'o', baseURL: 'https://x', apiKeyEnv: 'ROSETTA_TEST_UNSET_KEY', fetch: vi.fn() as any });
    await expect(noKey.generate(base)).rejects.toBeInstanceOf(LLMError);
  });
});
