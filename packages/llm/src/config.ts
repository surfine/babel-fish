import { z } from 'zod';
import { createAnthropicProvider, type AnthropicLike } from './providers/anthropic.js';
import { createOpenAICompatibleProvider, DEEPSEEK_BASE_URL } from './providers/openai-compatible.js';
import { LLMError, STEPS, type ApiKeyGetter, type Effort, type GenerateRequest, type GenerateResult, type LLMProvider, type Step } from './types.js';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

const AnthropicConfig = z.strictObject({
  kind: z.literal('anthropic'),
  apiKeyEnv: z.string().optional(),
  baseURL: z.string().optional(),
  refusalFallback: z.boolean().optional(),
});
const DeepSeekConfig = z.strictObject({
  kind: z.literal('deepseek'),
  apiKeyEnv: z.string().optional(),
  baseURL: z.string().optional(),
  extraBody: z.record(z.string(), z.unknown()).optional(),
});
const OpenAICompatibleConfig = z.strictObject({
  kind: z.literal('openai-compatible'),
  baseURL: z.string(),
  apiKeyEnv: z.string().optional(),
  requireApiKey: z.boolean().optional(),
  jsonMode: z.enum(['json_schema', 'json_object', 'prompt']).optional(),
  extraBody: z.record(z.string(), z.unknown()).optional(),
});
const ProviderConfig = z.discriminatedUnion('kind', [AnthropicConfig, DeepSeekConfig, OpenAICompatibleConfig]);
export type ProviderConfig = z.infer<typeof ProviderConfig>;

const StepObject = z.strictObject({
  provider: z.string(),
  model: z.string(),
  effort: z.enum(EFFORTS).optional(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().optional(),
});
export type StepConfig = z.infer<typeof StepObject>;

const RawConfig = z.strictObject({
  providers: z.record(z.string(), ProviderConfig).optional(),
  steps: z.partialRecord(z.enum(STEPS), z.union([z.string(), StepObject])).optional(),
});
export type RawConfig = z.input<typeof RawConfig>;

export interface LLMConfig {
  providers: Record<string, ProviderConfig>;
  steps: Record<Step, StepConfig>;
}

/** 預設：閱讀端（翻譯、俚語、摘要）用 DeepSeek Flash；寫作端用 Claude。polish 依 M0 bench（2026-10-30）選 Sonnet 5.5。 */
export const DEFAULT_CONFIG: LLMConfig = {
  providers: {
    anthropic: { kind: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY' },
    // DeepSeek 預設開思考模式（effort high），逐則翻譯用不到，只會變慢、吃掉 max_tokens；關掉。
    // 個別步驟要思考就在模型後加 effort，例如 deepseek:deepseek-flash@low（見 openai-compatible.ts 的 effortParam）
    deepseek: { kind: 'deepseek', apiKeyEnv: 'DEEPSEEK_API_KEY', extraBody: { thinking: { type: 'disabled' } } },
  },
  steps: {
    translate: { provider: 'deepseek', model: 'deepseek-flash' },
    annotate: { provider: 'deepseek', model: 'deepseek-flash' },
    summarize: { provider: 'deepseek', model: 'deepseek-flash' },
    polish: { provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'medium' },
    backtranslate: { provider: 'anthropic', model: 'claude-haiku-5-5', effort: 'low' },
    compare: { provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'medium' },
  },
};

/**
 * 解析「供應商:模型[@effort]」簡寫，例如 `anthropic:claude-opus-5-5@low`、`local:qwen3:14b`。
 * 只切第一個冒號（本機模型名常含冒號）；@ 後面必須是合法 effort 才當 effort。
 */
export function parseModelRef(ref: string): StepConfig {
  const i = ref.indexOf(':');
  if (i <= 0 || i === ref.length - 1) throw new LLMError(`模型寫法要是「供應商:模型」，收到 "${ref}"`, 'config', 'config');
  const provider = ref.slice(0, i);
  let model = ref.slice(i + 1);
  let effort: Effort | undefined;
  const at = model.lastIndexOf('@');
  if (at > 0 && (EFFORTS as readonly string[]).includes(model.slice(at + 1))) {
    effort = model.slice(at + 1) as Effort;
    model = model.slice(0, at);
  }
  return effort ? { provider, model, effort } : { provider, model };
}

/** 把使用者設定疊到預設值上並驗證。錯誤訊息列出所有問題，方便直接改設定檔。 */
export function parseConfig(raw: unknown = {}): LLMConfig {
  const parsed = RawConfig.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(根)'}：${i.message}`);
    throw new LLMError(`設定檔格式錯誤\n${issues.join('\n')}`, 'config', 'config');
  }
  const providers = { ...DEFAULT_CONFIG.providers, ...parsed.data.providers };
  const steps = { ...DEFAULT_CONFIG.steps };
  for (const [step, value] of Object.entries(parsed.data.steps ?? {}) as [Step, string | StepConfig][]) {
    steps[step] = typeof value === 'string' ? parseModelRef(value) : value;
  }
  const missing = STEPS.filter((s) => !(steps[s].provider in providers)).map((s) => `steps.${s} 指到不存在的供應商 "${steps[s].provider}"`);
  if (missing.length) throw new LLMError(`設定檔錯誤\n${missing.join('\n')}`, 'config', 'config');
  return { providers, steps };
}

export interface CreateLLMOptions {
  getApiKey?: ApiKeyGetter;
  /** 測試或自訂：直接指定某個供應商鍵名要用的實例（例如 mock）。 */
  providerOverrides?: Record<string, LLMProvider>;
  fetch?: typeof fetch;
  anthropicClient?: AnthropicLike;
}

export function createProvider(id: string, cfg: ProviderConfig, opts: CreateLLMOptions = {}): LLMProvider {
  switch (cfg.kind) {
    case 'anthropic':
      return createAnthropicProvider({ id, ...cfg, getApiKey: opts.getApiKey, client: opts.anthropicClient, fetch: opts.fetch });
    case 'deepseek':
      return createOpenAICompatibleProvider({
        id,
        baseURL: cfg.baseURL ?? DEEPSEEK_BASE_URL,
        apiKeyEnv: cfg.apiKeyEnv ?? 'DEEPSEEK_API_KEY',
        jsonMode: 'json_object',
        extraBody: cfg.extraBody,
        effortParam: 'deepseek',
        getApiKey: opts.getApiKey,
        fetch: opts.fetch,
      });
    case 'openai-compatible':
      return createOpenAICompatibleProvider({ id, ...cfg, getApiKey: opts.getApiKey, fetch: opts.fetch });
  }
}

/** 任務函式拿到的東西：依步驟挑供應商與模型，並把步驟的預設參數帶進請求。 */
export interface LLM {
  config: LLMConfig;
  run(step: Step, req: Omit<GenerateRequest, 'model'> & { model?: string }): Promise<GenerateResult>;
  /** 換掉某一步的模型（bench 比較用），回傳新的 LLM，原物件不變。 */
  withStep(step: Step, value: string | StepConfig): LLM;
}

export function createLLM(config: LLMConfig | RawConfig = {}, opts: CreateLLMOptions = {}): LLM {
  const cfg = parseConfig(config);
  const cache = new Map<string, LLMProvider>();
  const provider = (id: string) => {
    const override = opts.providerOverrides?.[id];
    if (override) return override;
    let p = cache.get(id);
    if (!p) {
      p = createProvider(id, cfg.providers[id], opts);
      cache.set(id, p);
    }
    return p;
  };
  return {
    config: cfg,
    run(step, req) {
      const s = cfg.steps[step];
      return provider(s.provider).generate({
        maxTokens: s.maxTokens,
        temperature: s.temperature,
        effort: s.effort,
        ...req,
        model: req.model ?? s.model,
      });
    },
    withStep(step, value) {
      const s = typeof value === 'string' ? parseModelRef(value) : value;
      if (!(s.provider in cfg.providers)) throw new LLMError(`不存在的供應商 "${s.provider}"`, 'config', 'config');
      return createLLM({ ...cfg, steps: { ...cfg.steps, [step]: s } }, opts);
    },
  };
}

