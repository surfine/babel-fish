import type { GenerateRequest, GenerateResult, LLMProvider } from '../types.js';

/** 不打網路的供應商：測試、介面開發與 `bench --mock` 用。respond 回字串或物件（物件會序列化成 JSON）。 */
export function createMockProvider(id: string, respond: (req: GenerateRequest) => string | object): LLMProvider {
  return {
    id,
    async generate(req): Promise<GenerateResult> {
      const out = respond(req);
      const text = typeof out === 'string' ? out : JSON.stringify(out);
      req.onText?.(text);
      return {
        text,
        json: req.json ? JSON.parse(text) : undefined,
        usage: { inputTokens: Math.ceil(JSON.stringify(req.messages).length / 4), outputTokens: Math.ceil(text.length / 4) },
        provider: id,
        model: req.model,
        stopReason: 'end_turn',
      };
    },
  };
}
