import { describe, expect, it } from 'vitest';
import { createLLM } from '../src/config.js';
import { langFromLocales } from '../src/lang.js';
import { createMockProvider } from '../src/providers/mock.js';
import { computeToneProfile } from '../src/tone.js';
import { annotateIdioms, backtranslate, compareMeaning, polishSystem, reviewDraft, summarizeUnread, translateBatch } from '../src/tasks/index.js';
import { formatGlossary } from '../src/tasks/shared.js';
import type { GenerateRequest } from '../src/types.js';

function capture(back = '我也是') {
  const seen: GenerateRequest[] = [];
  const mock = createMockProvider('mock', (req) => {
    seen.push(req);
    const name = req.json!.name;
    if (name === 'translations') return { translations: [{ id: '1', text: 'Same here', idioms: [{ phrase: '傻眼', meaning: 'stunned', usage: 'u' }] }] };
    if (name === 'idioms') return { idioms: [] };
    if (name === 'summary') return { summary: 'summary' };
    if (name === 'polish') {
      const v = { bubbles: ['我也是'], merged: null, notes: [] };
      return { casual: v, channel: v, formal: v };
    }
    if (name === 'backtranslation') return { items: ['casual', 'channel', 'formal', 'en'].map((key) => ({ key, text: back })) };
    return { status: 'ok', summary: 'ok', added: [], omitted: [], toneShifts: [], highlights: [] };
  });
  return { seen, llm: createLLM({}, { providerOverrides: { anthropic: mock, deepseek: mock } }) };
}

const sys = (r: GenerateRequest) => r.system ?? '';
const user = (r: GenerateRequest) => r.messages.map((m) => m.content).join('\n');

describe('閱讀：中文訊息翻成英文', () => {
  it('目標是英文時，翻譯、俚語、摘要的提示都要求英文，俚語可以是中文網路用語', async () => {
    const { seen, llm } = capture();
    const { translations } = await translateBatch(llm, { messages: [{ id: '1', user: 'mei', text: '我也傻眼' }], target: 'en' });
    await annotateIdioms(llm, { message: { user: 'mei', text: '摸魚中' }, target: 'en' });
    await summarizeUnread(llm, { messages: [{ user: 'mei', text: '好' }], target: 'en' });
    expect(sys(seen[0])).toMatch(/^You translate Slack messages into natural, idiomatic English/);
    expect(sys(seen[0])).toContain('摸魚');
    expect(sys(seen[1])).toContain('meaning: a short gloss in English');
    expect(sys(seen[2])).toContain('the summary is always in English');
    // 俚語的 phrase 是中文原文的子字串，照樣保留
    expect(translations[0]).toEqual({ id: '1', text: 'Same here', idioms: [{ phrase: '傻眼', meaning: 'stunned', usage: 'u' }] });
  });

  it('術語表給英文讀者時，列出中文寫法對應的英文正式名稱', () => {
    const g = [{ term: 'Find My', zh: '「尋找」', zhVariants: { 'zh-CN': '“查找”' } }, { term: 'AirPods Pro', zh: null }];
    const out = formatGlossary(g, 'en');
    expect(out).toContain('Find My (Chinese: 「尋找」 / “查找”)');
    expect(out).toContain('AirPods Pro (same in Chinese)');
  });
});

describe('寫作：英文草稿 → 中文頻道', () => {
  it('潤色提示寫明方向、保留語氣的對照、避開翻譯腔；「為什麼這樣寫」用英文', () => {
    const s = polishSystem('en', 'zh-TW');
    expect(s).toContain('a draft written in English');
    expect(s).toContain('into the Chinese (Taiwan, Traditional) messages');
    expect(s).toContain('maybe/might/could → 也許/可能');
    expect(s).toContain('翻譯腔');
    expect(s).toContain('why is one sentence in natural, idiomatic English');
    expect(s).not.toContain('capitalization, ending punctuation, message length, abbreviations');
  });

  it('原本的方向（台灣中文 → 英文）提示不變', () => {
    const s = polishSystem();
    expect(s).toContain('a draft written in Chinese (Taiwan, Traditional)');
    expect(s).toContain('也許/可能 → maybe/might/could');
    expect(s).toContain('no "Hope this helps"');
  });

  it('審閱卡：回譯從中文到英文、不含原稿；比對用英文寫摘要', async () => {
    const { seen, llm } = capture('me too');
    const draft = 'same here, maybe after the update?';
    const card = await reviewDraft(llm, { draft, recent: [{ user: 'mei', text: '我這邊也沒有' }], tone: computeToneProfile([]), userLang: 'en', channelLang: 'zh-TW' });
    const polishReq = seen.find((r) => r.json?.name === 'polish')!;
    expect(user(polishReq)).toContain("The user's draft (English)");
    expect(user(polishReq)).toContain('Write the messages in Chinese (Taiwan, Traditional).');
    const back = seen.find((r) => r.json?.name === 'backtranslation')!;
    expect(sys(back)).toMatch(/^You translate Chinese \(Taiwan, Traditional\) Slack messages into natural, idiomatic English/);
    expect(sys(back) + user(back)).not.toContain(draft);
    const compare = seen.filter((r) => r.json?.name === 'meaning_check');
    expect(compare).toHaveLength(3);
    for (const r of compare) expect(sys(r)).toContain('one sentence in natural, idiomatic English');
    expect(card.variants.channel).toMatchObject({ text: '我也是', back: 'me too' });
  });

  it('使用者語言和頻道語言相同時不回譯，直接拿潤色結果比對', async () => {
    const { seen, llm } = capture();
    const card = await reviewDraft(llm, { draft: '我也是', recent: [], tone: computeToneProfile([]), userLang: 'zh-TW', channelLang: 'zh-TW' });
    expect(seen.some((r) => r.json?.name === 'backtranslation')).toBe(false);
    expect(card.meta.backtranslate).toBeNull();
    expect(card.variants.formal.back).toBe('我也是');
    expect(sys(seen[0])).toContain("already in the channel's language");
  });

  it('單獨回譯與比對也能指定方向', async () => {
    const { seen, llm } = capture('me too');
    await backtranslate(llm, { texts: { en: '我也是' }, from: 'zh-CN', to: 'en' });
    await compareMeaning(llm, { draft: 'me too', backtranslation: 'me too', lang: 'en' });
    expect(sys(seen[0])).toContain('Chinese (mainland China, Simplified) Slack messages');
    expect(user(seen[0])).toContain('Translate each item into English');
    expect(sys(seen[1])).toContain('back-translation into English');
  });
});

describe('langFromLocales', () => {
  it('中文依地區；英文或其他語言一律英文；沒有資訊時台灣正體', () => {
    expect(langFromLocales(['zh-Hans-CN'])).toBe('zh-CN');
    expect(langFromLocales(['zh-HK'])).toBe('zh-HK');
    expect(langFromLocales(['en-US', 'zh-TW'])).toBe('en');
    expect(langFromLocales(['ja-JP', 'zh-TW'])).toBe('zh-TW');
    expect(langFromLocales(['fr-FR'])).toBe('en');
    expect(langFromLocales([])).toBe('zh-TW');
  });
});
