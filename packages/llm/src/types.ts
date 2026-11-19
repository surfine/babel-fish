/** 供應商無關的核心型別。殼（apps/shell）只需要依賴這裡與 tasks 匯出的型別。 */

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** 結構化輸出：name 給人看與除錯用，schema 是 JSON Schema（由 zod 產生）。 */
export interface JsonSpec {
  name: string;
  schema: Record<string, unknown>;
}

export interface GenerateRequest {
  model: string;
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  /** 只有支援的供應商會用；Anthropic 的 5.x 模型一律忽略。 */
  temperature?: number;
  effort?: Effort;
  json?: JsonSpec;
  /** 給了就走串流，每段文字增量回呼一次；最終結果仍由 generate() 回傳。 */
  onText?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateResult {
  text: string;
  /** 有 json 規格時，解析後的物件（尚未經 zod 驗證）。 */
  json?: unknown;
  usage: Usage;
  provider: string;
  model: string;
  stopReason?: string;
}

export interface LLMProvider {
  /** 設定檔裡的供應商鍵名，例如 "anthropic"、"deepseek"、"local"。 */
  readonly id: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

/** 取得金鑰的函式：殼可以改成從 macOS 鑰匙圈讀。回傳 undefined 代表沒有金鑰。 */
export type ApiKeyGetter = (providerId: string, envName?: string) => string | undefined | Promise<string | undefined>;

export class LLMError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly kind: 'auth' | 'refusal' | 'truncated' | 'bad_json' | 'http' | 'config',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

export const STEPS = ['translate', 'annotate', 'summarize', 'polish', 'backtranslate', 'compare'] as const;
export type Step = (typeof STEPS)[number];
