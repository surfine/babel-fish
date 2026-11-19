import { describe, expect, it } from 'vitest';
import { LLMError } from '@rosetta/llm';
import { aiErrText } from './errors';

describe('aiErrText', () => {
  it('依錯誤種類給下一步，不露出 HTTP 細節', () => {
    expect(aiErrText(new LLMError('HTTP 401：{"error":...}', 'deepseek', 'auth', 401))).toContain('設定');
    expect(aiErrText(new LLMError('HTTP 429：busy', 'deepseek', 'http', 429))).toBe('AI 服務現在太忙，等一下再試');
    expect(aiErrText(new LLMError('HTTP 402：Insufficient Balance', 'deepseek', 'http', 402))).toContain('額度');
    expect(aiErrText(new LLMError('bad', 'deepseek', 'bad_json'))).toBe('AI 的回覆不完整，再試一次');
    expect(aiErrText(new LLMError('HTTP 503：x', 'deepseek', 'http', 503))).not.toContain('503');
  });
  it('其他錯誤也不顯示原始訊息', () => {
    expect(aiErrText(new TypeError('Failed to fetch'))).toBe('連不上 AI 服務，檢查網路後再試');
    expect(aiErrText({ message: 'weird internal thing' })).toBe('AI 沒有回應，再試一次');
  });
});
