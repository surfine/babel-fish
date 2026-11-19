import Anthropic from '@anthropic-ai/sdk';
import { LLMError, type ApiKeyGetter, type GenerateRequest, type GenerateResult, type LLMProvider } from '../types.js';
import { parseJsonText } from './json.js';

export interface AnthropicProviderOptions {
  id?: string;
  apiKeyEnv?: string;
  baseURL?: string;
  getApiKey?: ApiKeyGetter;
  /**
   * Opus 5.5／Sonnet 5.5 被安全分類器拒答時，由伺服器自動改用其他模型重試
   * （beta server-side-fallback-2026-07-01，fallbacks: "default"）。預設開。
   */
  refusalFallback?: boolean;
  /** 測試用：注入假的 SDK 用戶端。 */
  client?: AnthropicLike;
  /** 自訂 fetch，例如殼用來繞過 webview 的 CORS 並由後端補上金鑰。 */
  fetch?: typeof fetch;
}

/** 只取我們會用到的 SDK 介面，方便測試注入。 */
export interface AnthropicLike {
  messages: { create(params: any, opts?: any): Promise<any>; stream(params: any, opts?: any): any };
  beta: { messages: { create(params: any, opts?: any): Promise<any>; stream(params: any, opts?: any): any } };
}

const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface AnthropicRequest {
  params: Record<string, unknown>;
  /** 有值就要走 client.beta.messages。 */
  betas?: string[];
}

/**
 * 把通用請求組成 Messages API 參數。純函式，測試直接驗它。
 *
 * - 不送 temperature：Opus 5.5 不支援，而且 2026-10-21 起所有模型送了都會 400。
 * - 不送 thinking：5.x 模型省略即為 adaptive；Opus 5.5 送 disabled 會 400。
 * - effort 一律明確給：Opus 5.5 預設是 medium、Sonnet 5.5 預設是 high，不明確給的話換模型時行為會悄悄改變。
 */
export function buildAnthropicRequest(req: GenerateRequest, opts: { refusalFallback?: boolean } = {}): AnthropicRequest {
  const outputConfig: Record<string, unknown> = { effort: req.effort ?? 'medium' };
  if (req.json) outputConfig.format = { type: 'json_schema', schema: req.json.schema };

  const params: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens ?? 16000,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    output_config: outputConfig,
  };
  if (req.system) params.system = req.system;

  if ((opts.refusalFallback ?? true) && FALLBACK_MODELS.has(req.model)) {
    params.fallbacks = 'default';
    return { params, betas: [FALLBACK_BETA] };
  }
  return { params };
}

export function createAnthropicProvider(opts: AnthropicProviderOptions = {}): LLMProvider {
  const id = opts.id ?? 'anthropic';
  let client: AnthropicLike | undefined = opts.client;

  async function getClient(): Promise<AnthropicLike> {
    if (client) return client;
    const envName = opts.apiKeyEnv ?? 'ANTHROPIC_API_KEY';
    const apiKey = opts.getApiKey ? await opts.getApiKey(id, envName) : readEnv(envName);
    if (!apiKey) throw new LLMError(`缺少 ${envName}`, id, 'auth');
    client = new Anthropic({ apiKey, baseURL: opts.baseURL, dangerouslyAllowBrowser: true, fetch: opts.fetch }) as unknown as AnthropicLike;
    return client;
  }

  return {
    id,
    async generate(req) {
      const c = await getClient();
      const { params, betas } = buildAnthropicRequest(req, opts);
      const api = betas ? c.beta.messages : c.messages;
      const body = betas ? { ...params, betas } : params;
      const reqOpts = req.signal ? { signal: req.signal } : undefined;

      let msg: any;
      try {
        if (req.onText) {
          const stream = api.stream(body, reqOpts);
          stream.on('text', (delta: string) => req.onText!(delta));
          msg = await stream.finalMessage();
        } else {
          msg = await api.create(body, reqOpts);
        }
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError) throw new LLMError(err.message, id, 'auth', 401);
        if (err instanceof Anthropic.APIError) throw new LLMError(err.message, id, 'http', err.status as number | undefined);
        throw err;
      }
      return toResult(id, req, msg);
    },
  };
}

function toResult(id: string, req: GenerateRequest, msg: any): GenerateResult {
  if (msg.stop_reason === 'refusal') {
    const cat = msg.stop_details?.category ? `（${msg.stop_details.category}）` : '';
    throw new LLMError(`模型拒答${cat}`, id, 'refusal');
  }
  const text = (msg.content as any[])
    .filter((b) => b.type === 'text')
    .map((b) => b.text as string)
    .join('');
  if (msg.stop_reason === 'max_tokens') throw new LLMError('輸出被 max_tokens 截斷', id, 'truncated');
  return {
    text,
    json: req.json ? parseJsonText(text, id) : undefined,
    usage: { inputTokens: msg.usage?.input_tokens ?? 0, outputTokens: msg.usage?.output_tokens ?? 0 },
    provider: id,
    model: msg.model ?? req.model,
    stopReason: msg.stop_reason,
  };
}

export function readEnv(name: string): string | undefined {
  return typeof process !== 'undefined' ? process.env?.[name] || undefined : undefined;
}
