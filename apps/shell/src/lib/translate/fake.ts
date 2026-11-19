// 假實作：還沒填 AI 金鑰時的替身（示範資料、瀏覽器預覽、測試）。
// 示範資料裡的訊息有預先寫好的譯文；其他文字一律加前綴，一眼看得出不是真的翻譯。
import type { Lang } from '@rosetta/llm';
import { DEMO_TRANSLATIONS, SAMPLE_DRAFT, SAMPLE_DRAFT_EN, SAMPLE_VARIANTS, SAMPLE_VARIANTS_EN } from '../demo/data';
import { regional, t } from '../i18n';
import type {
  BackSegment,
  MeaningCheck,
  PolishDraft,
  PolishRequest,
  Polisher,
  Summarizer,
  TranslateContext,
  TranslateItem,
  Translation,
  Translator,
  Verifier,
} from './types';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const fakePrefix = () => t('〔示範譯文〕');

export class FakeTranslator implements Translator {
  constructor(private latencyMs = 250) {}
  async translate(items: TranslateItem[], ctx: TranslateContext): Promise<Translation[]> {
    await wait(this.latencyMs);
    return items.map((it) => {
      const known = DEMO_TRANSLATIONS[it.text.trim()];
      const text = ctx.target === 'en' ? known?.en : known?.zh && regional(known.zh);
      const idioms = (ctx.target === 'en' ? known?.enIdioms : known?.idioms?.map((d) => ({ ...d, meaning: regional(d.meaning), usage: regional(d.usage ?? '') }))) ?? [];
      if (text && ctx.quality !== 'strong') return { id: it.id, text, idioms };
      return { id: it.id, text: fakePrefix() + (text ?? it.text), idioms };
    });
  }
}

// 設計稿的「再調整」：依指示挑一組預寫版本
function refineKey(instruction: string): 'warm' | 'natural' | 'short' {
  return /熱情|熱絡|興奮|warm/i.test(instruction) ? 'warm' : /縮寫|完整|full/i.test(instruction) ? 'natural' : 'short'; // i18n-ignore
}

function toDraft(v: { bubbles: string[]; merged: string | null; notes: [string, string][] }): PolishDraft {
  return { messages: [...v.bubbles], merged: v.merged, notes: v.notes.map(([term, why]) => ({ term, why: regional(why) })) };
}

export class FakePolisher implements Polisher {
  async polish(req: PolishRequest): Promise<PolishDraft> {
    await wait(900);
    if (req.draft.trim() === regional(SAMPLE_DRAFT)) return toDraft(SAMPLE_VARIANTS[req.tone]);
    if (req.draft.trim() === SAMPLE_DRAFT_EN) return toDraft(SAMPLE_VARIANTS_EN[req.tone]);
    const lines = req.draft.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const messages = lines.map((l) => `[demo] ${l}`);
    return {
      messages,
      merged: messages.length > 1 ? messages.join(' ') : null,
      notes: [{ term: t('示範用的文字'), why: t('還沒有 AI 金鑰，所以只在原文前加標記。到「設定」填好金鑰後，Babel Fish 會照頻道的語氣改寫') }],
    };
  }
  async refine(req: PolishRequest, previous: PolishDraft, instruction: string): Promise<PolishDraft> {
    await wait(500);
    if (req.draft.trim() === regional(SAMPLE_DRAFT)) return toDraft(SAMPLE_VARIANTS[refineKey(instruction)]);
    if (req.draft.trim() === SAMPLE_DRAFT_EN) return toDraft(SAMPLE_VARIANTS_EN.natural);
    return { ...previous, notes: [{ term: t('已套用：{instruction}', { instruction }), why: t('示範模式不會真的改寫') }, ...previous.notes] };
  }
}

// 回譯：從潤色結果找回設計稿的預寫回譯；找不到就加前綴
function findSample(texts: string[]) {
  const joined = texts.join('\n');
  return [...Object.values(SAMPLE_VARIANTS), ...Object.values(SAMPLE_VARIANTS_EN)].find((v) => v.bubbles.join('\n') === joined || v.merged === joined);
}

export class FakeVerifier implements Verifier {
  async backTranslate(texts: string[], _from: Lang, _to: Lang): Promise<string> {
    await wait(300);
    const s = findSample(texts);
    return s ? regional(s.back) : t('〔示範回譯〕') + texts.join(' ');
  }
  async compare(_draft: string, back: string, texts: string[]): Promise<{ segments: BackSegment[]; check: MeaningCheck }> {
    await wait(200);
    const s = findSample(texts);
    // 預寫回譯用 <mark>…</mark> 標出差異
    const segments: BackSegment[] = back
      .split(/(<mark>.*?<\/mark>)/)
      .filter(Boolean)
      .map((x) => (x.startsWith('<mark>') ? { text: x.slice(6, -7), flagged: true } : { text: x, flagged: false }));
    const check: MeaningCheck = s
      ? { kind: s.check[0], summary: regional(s.check[1]) }
      : { kind: 'info', summary: t('示範用的比對。填好 AI 金鑰後，才會真的檢查新增、遺漏和語氣') };
    return { segments, check };
  }
}

export class FakeSummarizer implements Summarizer {
  async summarize(items: TranslateItem[]): Promise<string> {
    await wait(300);
    return t('這段時間有 {n} 則新訊息。填好 AI 金鑰後，這裡會有一段摘要。', { n: items.length });
  }
}
