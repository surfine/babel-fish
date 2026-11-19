import { z } from 'zod';
import { glossaryZh, zhInstruction } from '../zh.js';
import { DEFAULT_LANG, type Lang } from '../lang.js';
import type { ZhVariant } from '../zh.js';
import type { LLM } from '../config.js';
import { LLMError, type GenerateResult, type JsonSpec, type Step } from '../types.js';

export interface ContextMessage {
  user: string;
  text: string;
  ts?: number;
  id?: string;
}

/** 術語表：zh 為 null 代表保留原文不翻（例如 Siri Remote、tvOS 27）。 */
export interface GlossaryEntry {
  term: string;
  /** 台灣寫法；null 代表保留原文 */
  zh: string | null;
  /** 其他地區的譯名，例如 Find My 在大陸是「查找」 */
  zhVariants?: Partial<Record<ZhVariant, string>>;
  note?: string;
}

export const MAX_CONTEXT = 20;

export function formatConversation(messages: ContextMessage[], limit = MAX_CONTEXT): string {
  return messages
    .slice(-limit)
    .map((m) => `[${m.user}] ${m.text}`)
    .join('\n');
}

/**
 * 術語表給模型讀的樣子。target 是要寫出的語言：
 * - 中文：英文術語 → 該地區的譯名（null 保留英文）；
 * - 英文：中文寫法 → 英文正式名稱，讓中文訊息裡的產品名翻回官方寫法。
 */
export function formatGlossary(glossary: GlossaryEntry[] = [], target: Lang = DEFAULT_LANG): string {
  if (!glossary.length) return '';
  if (target === 'en') {
    return glossary
      .map((g) => {
        const zh = [...new Set([g.zh, ...Object.values(g.zhVariants ?? {})].filter((x): x is string => !!x))];
        return `- ${g.term}${zh.length ? ` (Chinese: ${zh.join(' / ')})` : ' (same in Chinese)'}${g.note ? ` — ${g.note}` : ''}`;
      })
      .concat('(Write these terms with the English names and capitalization shown.)')
      .join('\n');
  }
  const variant: ZhVariant = target;
  const lines = glossary.map((g) => {
    const zh = glossaryZh(g.zh, g.zhVariants, variant);
    return `- ${g.term} → ${zh ?? '(keep in English, exact capitalization)'}${g.note ? ` — ${g.note}` : ''}`;
  });
  // 沒有該地區譯名的條目給的是台灣寫法，提醒模型換成目標地區的字與用詞
  if (variant !== 'zh-TW' && glossary.some((g) => g.zh !== null && !g.zhVariants?.[variant])) {
    lines.push('(Chinese renderings above are given in Taiwan form unless region-specific; write them in the target region\'s characters and usual name.)');
  }
  return lines.join('\n');
}

/** zod → 各供應商都吃的 JSON Schema（去掉 $schema；物件一律 additionalProperties: false）。 */
export function jsonSpec(name: string, schema: z.ZodType): JsonSpec {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return { name, schema: rest };
}

export interface TaskMeta {
  provider: string;
  model: string;
  usage: GenerateResult['usage'];
  ms: number;
}

/**
 * 跑一個結構化步驟並用 zod 驗證。
 * - schema 是交給模型的嚴格格式；lenient 是驗證用的寬鬆版本（例如多出欄位就丟掉、缺的陣列當空的）。
 *   只保證「是 JSON」的端點（DeepSeek 的 json_object）常會多一個欄位或少一個欄位，嚴格驗證會整批丟掉。
 * - 格式不合（含空白內容）重試一次，再不合才丟 bad_json。
 */
export async function runJson<T>(
  llm: LLM,
  step: Step,
  name: string,
  schema: z.ZodType<T>,
  system: string,
  user: string,
  opts: { signal?: AbortSignal; onText?: (d: string) => void; lenient?: z.ZodType<T> } = {},
): Promise<{ data: T; meta: TaskMeta }> {
  const started = Date.now();
  const validator = opts.lenient ?? schema;
  let lastError: LLMError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: GenerateResult;
    try {
      res = await llm.run(step, {
        system,
        messages: [{ role: 'user', content: user }],
        json: jsonSpec(name, schema),
        signal: opts.signal,
        onText: opts.onText,
      });
    } catch (e) {
      if (e instanceof LLMError && e.kind === 'bad_json' && attempt === 0) {
        lastError = e;
        continue;
      }
      throw e;
    }
    const parsed = validator.safeParse(res.json);
    if (parsed.success) {
      return { data: parsed.data, meta: { provider: res.provider, model: res.model, usage: res.usage, ms: Date.now() - started } };
    }
    lastError = new LLMError(`${name} 回傳格式不符：${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`, res.provider, 'bad_json');
  }
  throw lastError!;
}

/** 舊名：台灣正體的提示詞說明。新程式用 zhInstruction(variant)。 */
export const TAIWAN_ZH = zhInstruction('zh-TW');
