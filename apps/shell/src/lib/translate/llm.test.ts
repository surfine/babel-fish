import { describe, expect, it } from 'vitest';
import { parseConfig } from '@rosetta/llm';
import { configFor, segmentize, strongTranslateModel } from './llm';

describe('segmentize', () => {
  it('標出回譯裡的差異片段，其餘保持原樣', () => {
    expect(segmentize('我等一下再試，有結果再回報。', ['有結果再回報'])).toEqual([
      { text: '我等一下再試，', flagged: false },
      { text: '有結果再回報', flagged: true },
      { text: '。', flagged: false },
    ]);
  });

  it('多個片段照出現順序切，同位置取較長者', () => {
    const segs = segmentize('大概要等更新完，大概吧', ['大概', '大概要等']);
    expect(segs.map((s) => [s.text, s.flagged])).toEqual([
      ['大概要等', true],
      ['更新完，', false],
      ['大概', true],
      ['吧', false],
    ]);
  });

  it('沒有差異時是單一段落', () => {
    expect(segmentize('意思一致', [])).toEqual([{ text: '意思一致', flagged: false }]);
  });
});

describe('configFor', () => {
  it('兩把金鑰都有：沿用預設（翻譯 DeepSeek、潤色 Claude）', () => {
    const c = parseConfig(configFor({ anthropic: true, deepseek: true }));
    expect(c.steps.translate.provider).toBe('deepseek');
    expect(c.steps.polish.provider).toBe('anthropic');
  });

  it('只有一家金鑰：每一步都改用那一家', () => {
    const onlyClaude = parseConfig(configFor({ anthropic: true, deepseek: false }));
    expect(Object.values(onlyClaude.steps).every((s) => s.provider === 'anthropic')).toBe(true);
    const onlyDeepseek = parseConfig(configFor({ anthropic: false, deepseek: true }));
    expect(Object.values(onlyDeepseek.steps).every((s) => s.provider === 'deepseek')).toBe(true);
  });

  it('只有 DeepSeek：潤色開思考，回譯與比對不開', () => {
    const c = parseConfig(configFor({ anthropic: false, deepseek: true }));
    expect(c.steps.polish).toMatchObject({ model: 'deepseek-flash', effort: 'high' });
    expect(c.steps.backtranslate.effort).toBeUndefined();
    expect(c.steps.compare.effort).toBeUndefined();
  });
});

describe('strongTranslateModel', () => {
  it('「重譯」不能指到沒有金鑰的供應商', () => {
    expect(strongTranslateModel({ anthropic: false, deepseek: true })).toMatch(/^deepseek:/);
    expect(strongTranslateModel({ anthropic: true, deepseek: false })).toMatch(/^anthropic:/);
  });
});
