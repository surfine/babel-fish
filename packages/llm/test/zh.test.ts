import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLLM } from '../src/config.js';
import { createMockProvider } from '../src/providers/mock.js';
import { computeToneProfile } from '../src/tone.js';
import { reviewDraft, summarizeUnread, translateBatch } from '../src/tasks/index.js';
import { formatGlossary } from '../src/tasks/shared.js';
import { renderTermsDoc } from '../src/terms-doc.js';
import type { GenerateRequest } from '../src/types.js';
import { TERMS, ZH_VARIANTS, zhInstruction } from '../src/zh.js';

function capture() {
  const seen: GenerateRequest[] = [];
  const mock = createMockProvider('mock', (req) => {
    seen.push(req);
    const name = req.json!.name;
    if (name === 'translations') return { translations: [{ id: '1', text: '你好', idioms: [] }] };
    if (name === 'summary') return { summary: '摘要' };
    if (name === 'polish') {
      const v = { bubbles: ['hi'], merged: null, notes: [] };
      return { casual: v, channel: v, formal: v };
    }
    if (name === 'backtranslation') return { items: [{ key: 'casual', text: '嗨' }, { key: 'channel', text: '嗨' }, { key: 'formal', text: '嗨' }] };
    return { status: 'ok', summary: 'ok', added: [], omitted: [], toneShifts: [], highlights: [] };
  });
  return { seen, llm: createLLM({}, { providerOverrides: { anthropic: mock, deepseek: mock } }) };
}

describe('地區用字', () => {
  it('每個地區的說明寫明字形，並舉出這個地區自己的用詞', () => {
    expect(zhInstruction('zh-CN')).toMatch(/Simplified Chinese as written in mainland China/);
    expect(zhInstruction('zh-CN')).toContain('软件 (not');
    expect(zhInstruction('zh-HK')).toMatch(/Hong Kong.*not colloquial Cantonese/);
    expect(zhInstruction('zh-HK')).toContain('軟件 (not');
    expect(zhInstruction('zh-TW')).toContain('軟體 (not');
    expect(zhInstruction('zh-SG')).toMatch(/Singapore and Malaysia/);
  });

  it('翻譯、摘要、潤色說明、回譯、比對的系統提示都換成選的地區；沒選就是台灣', async () => {
    const { seen, llm } = capture();
    await translateBatch(llm, { messages: [{ id: '1', user: 'a', text: 'hi' }], target: 'zh-CN' });
    await summarizeUnread(llm, { messages: [{ user: 'a', text: 'hi' }], target: 'zh-HK' });
    await reviewDraft(llm, { draft: '你好', recent: [], tone: computeToneProfile([]), userLang: 'zh-SG' });
    await translateBatch(llm, { messages: [{ id: '1', user: 'a', text: 'hi' }] });
    const sys = seen.map((r) => r.system ?? '');
    expect(sys[0]).toContain('mainland China');
    expect(sys[1]).toContain('Hong Kong');
    for (const s of sys.slice(2, -1)) expect(s).toContain('Singapore and Malaysia');
    expect(sys.at(-1)).toContain('Taiwan');
  });

  it('術語表的中文譯名：有地區譯名就用，沒有就提醒模型換成該地區寫法', () => {
    const g = [{ term: 'Find My', zh: '「尋找」', zhVariants: { 'zh-CN': '“查找”' } }, { term: 'Control Center', zh: '控制中心' }, { term: 'iOS 27', zh: null }];
    expect(formatGlossary(g, 'zh-CN')).toContain('Find My → “查找”');
    expect(formatGlossary(g, 'zh-CN')).toContain('Taiwan form');
    expect(formatGlossary(g, 'zh-TW')).not.toContain('Taiwan form');
    expect(formatGlossary(g, 'zh-TW')).toContain('Find My → 「尋找」');
  });

  it('術語表每一列四個地區都有填，台灣詞不重複', () => {
    for (const t of TERMS) for (const v of [t.tw, t.hk, t.cn, t.sg]) expect(v.trim()).not.toBe('');
    expect(new Set(TERMS.map((t) => t.tw)).size).toBe(TERMS.length);
    expect(ZH_VARIANTS).toHaveLength(4);
  });

  it('docs/TERMINOLOGY.md 和術語表一致（改了 TERMS 要跑 npm run terms）', () => {
    const file = readFileSync(join(__dirname, '../../../docs/TERMINOLOGY.md'), 'utf8');
    expect(file).toBe(renderTermsDoc());
  });
});
