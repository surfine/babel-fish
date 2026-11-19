import { LLMError } from '../types.js';

/** 解析模型回傳的 JSON；容忍 ```json 圍欄與前後雜訊（json_object 模式的供應商偶爾會加）。 */
export function parseJsonText(text: string, provider: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new LLMError('模型回傳空內容', provider, 'bad_json');
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw new LLMError(`無法解析 JSON：${candidate.slice(0, 120)}`, provider, 'bad_json');
  }
}
