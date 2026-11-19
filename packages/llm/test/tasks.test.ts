import { describe, expect, it } from 'vitest';
import { createLLM } from '../src/config.js';
import { createMockProvider } from '../src/providers/mock.js';
import { computeToneProfile } from '../src/tone.js';
import { compareMeaning, reviewDraft, translateBatch } from '../src/tasks/index.js';
import type { GenerateRequest } from '../src/types.js';

/** 依結構化輸出的名稱回應；記下所有請求。 */
function scripted(handlers: Record<string, (req: GenerateRequest) => object>) {
  const seen: GenerateRequest[] = [];
  const mock = createMockProvider('mock', (req) => {
    seen.push(req);
    return handlers[req.json!.name](req);
  });
  return { seen, llm: createLLM({}, { providerOverrides: { anthropic: mock, deepseek: mock } }) };
}

const variant = (bubbles: string[]) => ({ bubbles, merged: 'merged', notes: [] });
const DRAFT = '我這邊也一樣，也許要等更新完才會出現';

describe('reviewDraft', () => {
  const { seen, llm } = scripted({
    polish: () => ({ casual: variant(['same', 'prob after the update']), channel: variant(['same here', 'maybe after the update?']), formal: variant(['Same here.']) }),
    backtranslation: () => ({ items: [{ key: 'casual', text: '一樣，大概更新後' }, { key: 'channel', text: '我也是，也許更新後？' }, { key: 'formal', text: '我也一樣。' }, { key: 'extra', text: '多的' }] }),
    meaning_check: (req) => ({ status: 'ok', summary: req.messages[0].content.includes('大概') ? 'warn-ish' : 'same', added: [], omitted: [], toneShifts: [], highlights: ['不存在'] }),
  });

  it('回譯請求裡絕對沒有中文原稿；比對請求才有', async () => {
    const card = await reviewDraft(llm, { draft: DRAFT, recent: [{ user: 'owen', text: 'no AirPods here' }], tone: computeToneProfile([]) });
    const back = seen.find((r) => r.json?.name === 'backtranslation')!;
    const backText = (back.system ?? '') + back.messages.map((m) => m.content).join('');
    expect(backText).not.toContain(DRAFT);
    for (const fragment of ['我這邊也一樣', '更新完才會出現']) expect(backText).not.toContain(fragment);
    expect(backText).toContain('maybe after the update?');
    expect(seen.filter((r) => r.json?.name === 'meaning_check').every((r) => r.messages[0].content.includes(DRAFT))).toBe(true);

    // 單則時 merged 一律為 null；ok 時不留標記；多出來的回譯鍵丟掉
    expect(card.variants.formal.merged).toBeNull();
    expect(card.variants.channel.merged).toBe('merged');
    expect(card.variants.channel.text).toBe('same here\nmaybe after the update?');
    expect(card.variants.casual.check.highlights).toEqual([]);
    expect(Object.keys(card.variants)).toEqual(['casual', 'channel', 'formal']);
  });
});

describe('compareMeaning', () => {
  it('只保留真的出現在回譯裡的標記片段', async () => {
    const { llm } = scripted({
      meaning_check: () => ({ status: 'warn', summary: 's', added: ['有結果再回報'], omitted: [], toneShifts: [], highlights: ['有結果再回報', '模型自己編的'] }),
    });
    const { result } = await compareMeaning(llm, { draft: '我等一下再試', backtranslation: '我等一下再試，有結果再回報。' });
    expect(result.highlights).toEqual(['有結果再回報']);
  });

  it('模型回傳不合 schema 時丟 bad_json，而不是把壞資料交給介面', async () => {
    const { llm } = scripted({ meaning_check: () => ({ status: 'maybe', summary: 's' }) });
    await expect(compareMeaning(llm, { draft: 'a', backtranslation: 'b' })).rejects.toMatchObject({ kind: 'bad_json' });
  });
});

describe('translateBatch', () => {
  it('分批送，前一批當後一批的脈絡；不在原文裡的俚語丟掉；按輸入順序回傳', async () => {
    const { seen, llm } = scripted({
      translations: (req) => {
        const batch = JSON.parse(req.messages[0].content.split('(JSON):\n')[1]) as { id: string; text: string }[];
        return {
          translations: batch.reverse().map((m) => ({ id: m.id, text: `譯:${m.text}`, idioms: [{ phrase: 'fwiw', meaning: '供參考', usage: 'u' }] })),
        };
      },
    });
    const messages = ['a fwiw', 'b', 'c'].map((text, i) => ({ id: String(i), user: 'owen', text }));
    const { translations } = await translateBatch(llm, { messages }, { batchSize: 2 });
    expect(seen).toHaveLength(2);
    expect(seen[0].model).toBe('deepseek-flash');
    expect(seen[1].messages[0].content).toContain('[owen] a fwiw');
    expect(translations.map((t) => t.text)).toEqual(['譯:a fwiw', '譯:b', '譯:c']);
    expect(translations.map((t) => t.idioms.length)).toEqual([1, 0, 0]);
  });

  it('模型漏掉的訊息單獨再送一次，補回來的照原順序', async () => {
    let calls = 0;
    const { llm } = scripted({
      translations: (req) => {
        calls++;
        const asked = req.messages[0].content;
        return asked.includes('"id":"0"')
          ? { translations: [{ id: '0', text: '零', idioms: [] }] } // 第一次只回一則
          : { translations: [{ id: '1', text: '一', idioms: [] }] };
      },
    });
    const { translations } = await translateBatch(llm, { messages: [{ id: '0', user: 'a', text: 'x' }, { id: '1', user: 'a', text: 'y' }] });
    expect(calls).toBe(2);
    expect(translations.map((t) => t.text)).toEqual(['零', '一']);
  });

  it('重送後仍漏掉就略過那則，不讓整批失敗', async () => {
    const { llm } = scripted({ translations: () => ({ translations: [{ id: '0', text: 'x', idioms: [] }] }) });
    const { translations } = await translateBatch(llm, { messages: [{ id: '0', user: 'a', text: 'x' }, { id: '1', user: 'a', text: 'y' }] });
    expect(translations.map((t) => t.id)).toEqual(['0']);
  });

  it('多出的欄位、缺少的 idioms 不會讓整批失敗', async () => {
    const { llm } = scripted({
      translations: () => ({ translations: [{ id: 0, text: '甲', idioms: [{ phrase: 'x', meaning: 'm', usage_en: 'extra' }] }, { id: '1', text: '乙' }] }),
    });
    const { translations } = await translateBatch(llm, { messages: [{ id: '0', user: 'a', text: 'x' }, { id: '1', user: 'a', text: 'y' }] });
    expect(translations).toEqual([
      { id: '0', text: '甲', idioms: [{ phrase: 'x', meaning: 'm', usage: '' }] },
      { id: '1', text: '乙', idioms: [] },
    ]);
  });
});
