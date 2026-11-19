// 假實作：還沒接 packages/llm 前的替身。
// 示範資料裡的訊息有預先寫好的譯文（取自設計稿）；其他文字一律加前綴，一眼看得出不是真的翻譯。
import { DEMO_TRANSLATIONS, SAMPLE_DRAFT, SAMPLE_VARIANTS } from '../demo/data';
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

export const FAKE_PREFIX = '〔示範譯文〕';

export class FakeTranslator implements Translator {
  constructor(private latencyMs = 250) {}
  async translate(items: TranslateItem[], ctx: TranslateContext): Promise<Translation[]> {
    await wait(this.latencyMs);
    return items.map((it) => {
      const known = DEMO_TRANSLATIONS[it.text.trim()];
      if (known && ctx.quality !== 'strong') return { id: it.id, zh: known.zh, idioms: known.idioms ?? [] };
      const tag = ctx.quality === 'strong' ? '〔示範譯文〕' : FAKE_PREFIX;
      return { id: it.id, zh: tag + (known?.zh ?? it.text), idioms: known?.idioms ?? [] };
    });
  }
}

// 設計稿的「再調整」：依指示挑一組預寫版本
function refineKey(instruction: string): 'warm' | 'natural' | 'short' {
  return /熱情|熱絡|興奮/.test(instruction) ? 'warm' : /縮寫|完整/.test(instruction) ? 'natural' : 'short';
}

function toDraft(v: { bubbles: string[]; merged: string | null; notes: [string, string][] }): PolishDraft {
  return { messages: [...v.bubbles], merged: v.merged, notes: v.notes.map(([term, why]) => ({ term, why })) };
}

export class FakePolisher implements Polisher {
  async polish(req: PolishRequest): Promise<PolishDraft> {
    await wait(900);
    if (req.draftZh.trim() === SAMPLE_DRAFT) return toDraft(SAMPLE_VARIANTS[req.tone]);
    const lines = req.draftZh.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const messages = lines.map((l) => `[demo] ${l}`);
    return {
      messages,
      merged: messages.length > 1 ? messages.join(' ') : null,
      notes: [{ term: '示範用的英文', why: '還沒有 AI 金鑰，所以只在原文前加標記。到「設定」填好金鑰後，Babel Fish 會照頻道的語氣改寫' }],
    };
  }
  async refine(req: PolishRequest, previous: PolishDraft, instruction: string): Promise<PolishDraft> {
    await wait(500);
    if (req.draftZh.trim() === SAMPLE_DRAFT) return toDraft(SAMPLE_VARIANTS[refineKey(instruction)]);
    return { ...previous, notes: [{ term: `已套用：${instruction}`, why: '示範模式不會真的改寫' }, ...previous.notes] };
  }
}

// 回譯：從英文找回設計稿的預寫回譯；找不到就加前綴
function findSample(english: string[]) {
  const joined = english.join('\n');
  return Object.values(SAMPLE_VARIANTS).find(
    (v) => v.bubbles.join('\n') === joined || v.merged === joined,
  );
}

export class FakeVerifier implements Verifier {
  async backTranslate(english: string[]): Promise<string> {
    await wait(300);
    const s = findSample(english);
    return s ? s.back : '〔示範回譯〕' + english.join(' ');
  }
  async compare(_draftZh: string, backZh: string, english: string[]): Promise<{ segments: BackSegment[]; check: MeaningCheck }> {
    await wait(200);
    const s = findSample(english);
    // 預寫回譯用 <mark>…</mark> 標出差異
    const segments: BackSegment[] = backZh
      .split(/(<mark>.*?<\/mark>)/)
      .filter(Boolean)
      .map((t) => (t.startsWith('<mark>') ? { text: t.slice(6, -7), flagged: true } : { text: t, flagged: false }));
    const check: MeaningCheck = s
      ? { kind: s.check[0], summary: s.check[1] }
      : { kind: 'info', summary: '示範用的比對。填好 AI 金鑰後，才會真的檢查新增、遺漏和語氣' };
    return { segments, check };
  }
}

export class FakeSummarizer implements Summarizer {
  async summarize(items: TranslateItem[]): Promise<string> {
    await wait(300);
    return `這段時間有 ${items.length} 則新訊息。填好 AI 金鑰後，這裡會有一段中文摘要。`;
  }
}
