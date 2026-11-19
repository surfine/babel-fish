import { LLMError, type ApiKeyGetter, type GenerateRequest, type LLMProvider } from '../types.js';
import { readEnv } from './anthropic.js';
import { parseJsonText } from './json.js';

/**
 * 結構化輸出的做法因端點而異：
 * - json_schema：OpenAI 的 strict schema（response_format.type = json_schema）
 * - json_object：只保證是 JSON（DeepSeek 只支援這種）；schema 改寫進 system 提示
 * - prompt：不送 response_format（多數本機模型），只靠提示
 */
export type JsonMode = 'json_schema' | 'json_object' | 'prompt';

export interface OpenAICompatibleOptions {
  id: string;
  baseURL: string;
  apiKeyEnv?: string;
  getApiKey?: ApiKeyGetter;
  /** 本機模型可以不需要金鑰。 */
  requireApiKey?: boolean;
  jsonMode?: JsonMode;
  /** 原樣併入請求本體，例如 DeepSeek 的 thinking 設定或 Ollama 的 options。 */
  extraBody?: Record<string, unknown>;
  /**
   * 步驟的 effort 怎麼送：
   * - 'deepseek'：有 effort 就開思考模式（thinking enabled + reasoning_effort），沒有就照 extraBody（預設關思考）
   * - 不設：忽略 effort
   */
  effortParam?: 'deepseek';
  /** 測試用：注入 fetch。 */
  fetch?: typeof fetch;
}

export interface HttpRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

export function schemaInstruction(schema: Record<string, unknown>): string {
  return `只輸出一個 JSON 物件，不要加說明文字或 markdown 圍欄。JSON 必須符合這個 JSON Schema：\n${JSON.stringify(schema)}`;
}

/** 組 /chat/completions 請求。純函式，測試直接驗它。 */
export function buildOpenAIRequest(req: GenerateRequest, opts: OpenAICompatibleOptions, apiKey?: string): HttpRequest {
  const mode = opts.jsonMode ?? 'json_schema';
  let system = req.system ?? '';
  if (req.json && mode !== 'json_schema') {
    system = [system, schemaInstruction(req.json.schema)].filter(Boolean).join('\n\n');
  }
  const messages: Array<{ role: string; content: string }> = [];
  if (system) messages.push({ role: 'system', content: system });
  for (const m of req.messages) messages.push({ role: m.role, content: m.content });

  const body: Record<string, unknown> = {
    model: req.model,
    messages,
    max_tokens: req.maxTokens ?? 8000,
    ...opts.extraBody,
  };
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (opts.effortParam === 'deepseek' && req.effort) {
    body.thinking = { type: 'enabled' };
    body.reasoning_effort = req.effort;
  }
  if (req.json && mode === 'json_schema') {
    body.response_format = { type: 'json_schema', json_schema: { name: req.json.name, schema: req.json.schema, strict: true } };
  } else if (req.json && mode === 'json_object') {
    body.response_format = { type: 'json_object' };
  }
  if (req.onText) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  return { url: `${opts.baseURL.replace(/\/+$/, '')}/chat/completions`, headers, body };
}

export function createOpenAICompatibleProvider(opts: OpenAICompatibleOptions): LLMProvider {
  const doFetch = opts.fetch ?? globalThis.fetch;
  return {
    id: opts.id,
    async generate(req) {
      const envName = opts.apiKeyEnv;
      const apiKey = opts.getApiKey ? await opts.getApiKey(opts.id, envName) : envName ? readEnv(envName) : undefined;
      if (!apiKey && (opts.requireApiKey ?? true)) throw new LLMError(`缺少 ${envName ?? `${opts.id} 金鑰`}`, opts.id, 'auth');

      const http = buildOpenAIRequest(req, opts, apiKey);
      const res = await doFetch(http.url, { method: 'POST', headers: http.headers, body: JSON.stringify(http.body), signal: req.signal });
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 300);
        throw new LLMError(`HTTP ${res.status}：${detail}`, opts.id, res.status === 401 ? 'auth' : 'http', res.status);
      }
      const { text, usage, finish, model } = req.onText ? await readStream(res, req.onText) : await readJson(res);
      if (finish === 'length') throw new LLMError('輸出被 max_tokens 截斷', opts.id, 'truncated');
      return {
        text,
        json: req.json ? parseJsonText(text, opts.id) : undefined,
        usage,
        provider: opts.id,
        model: model ?? req.model,
        stopReason: finish,
      };
    },
  };
}

interface Parsed {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  finish?: string;
  model?: string;
}

async function readJson(res: Response): Promise<Parsed> {
  const data: any = await res.json();
  const choice = data.choices?.[0];
  return {
    text: choice?.message?.content ?? '',
    usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
    finish: choice?.finish_reason,
    model: data.model,
  };
}

/** 讀 SSE：每行 `data: {...}`，以 `data: [DONE]` 結束。 */
export async function readStream(res: Response, onText: (d: string) => void): Promise<Parsed> {
  const out: Parsed = { text: '', usage: { inputTokens: 0, outputTokens: 0 } };
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      const chunk = JSON.parse(payload);
      const choice = chunk.choices?.[0];
      const delta = choice?.delta?.content;
      if (delta) {
        out.text += delta;
        onText(delta);
      }
      if (choice?.finish_reason) out.finish = choice.finish_reason;
      if (chunk.model) out.model = chunk.model;
      if (chunk.usage) out.usage = { inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 };
    }
  }
  return out;
}
