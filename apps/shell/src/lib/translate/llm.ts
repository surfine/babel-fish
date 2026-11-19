// 真實作：把殼的 Translator／Polisher／Verifier／Summarizer 介面接到 packages/llm。
// 請求一律經 Rust 的 llm_http 代理送出：webview 不受 CORS 限制，金鑰欄位只放佔位字串，由後端從鑰匙圈換上真金鑰。
import { invoke } from '@tauri-apps/api/core';
import { loadVariant } from '../zh';
import {
  backtranslate,
  compareMeaning,
  computeToneProfile,
  createLLM,
  polish as polishTask,
  summarizeUnread,
  translateBatch,
  type LLM,
  type PolishResult,
  type PolishVariant,
  type RawConfig,
} from '@rosetta/llm';
import type {
  BackSegment,
  GlossaryEntry,
  MeaningCheck,
  PolishDraft,
  PolishRequest,
  Polisher,
  Summarizer,
  Tone,
  TranslateContext,
  TranslateItem,
  Translation,
  Translator,
  Verifier,
} from './types';

export const LLM_PROVIDERS = ['anthropic', 'deepseek'] as const;
export type LlmProviderId = (typeof LLM_PROVIDERS)[number];
export type KeyStatus = Record<LlmProviderId, boolean>;

// 和 src-tauri/src/llm.rs 的 KEY_PLACEHOLDER 一致
const KEY_PLACEHOLDER = 'rosetta-keychain:';

interface ProxyResponse {
  status: number;
  headers: [string, string][];
  body: string;
}

export const proxyFetch: typeof fetch = async (input, init) => {
  const req = new Request(input, init);
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();
  const r = await invoke<ProxyResponse>('llm_http', {
    req: { url: req.url, method: req.method, headers: [...req.headers.entries()], body },
  });
  const nullBody = r.status === 204 || r.status === 304;
  return new Response(nullBody ? null : r.body, { status: r.status, headers: r.headers });
};

// 只有一家有金鑰時，所有步驟都改用那一家，不必兩把都填才能用
export function configFor(keys: KeyStatus): RawConfig {
  if (keys.anthropic && !keys.deepseek) {
    const haiku = 'anthropic:claude-haiku-5-5@low';
    return { steps: { translate: haiku, annotate: haiku, summarize: haiku } };
  }
  if (keys.deepseek && !keys.anthropic) {
    // bench（2026-11-19）：潤色開思考（@high）最能保住「好像」「不太確定」這類保留語氣，也沒有格式錯誤；
    // 回譯與比對不開思考就夠準，維持快
    const flash = 'deepseek:deepseek-flash';
    return { steps: { polish: `${flash}@high`, backtranslate: flash, compare: flash } };
  }
  return {};
}

// 「重譯」用的較強模型：有 Claude 金鑰用 Sonnet，只有 DeepSeek 就讓 Flash 開思考
export function strongTranslateModel(keys: KeyStatus): string {
  return keys.anthropic ? 'anthropic:claude-sonnet-5-5@low' : 'deepseek:deepseek-flash@high';
}

export function createShellLLM(keys: KeyStatus): LLM {
  return createLLM(configFor(keys), { fetch: proxyFetch, getApiKey: (id) => KEY_PLACEHOLDER + id });
}

const TONE: Record<Tone, keyof PolishResult> = { casual: 'casual', natural: 'channel', formal: 'formal' };

function toDraft(v: PolishVariant): PolishDraft {
  return {
    messages: [...v.bubbles],
    merged: v.bubbles.length > 1 ? v.merged : null,
    notes: v.notes.map((n) => ({ term: n.phrase, why: n.why })),
  };
}

// 把回譯切成一般段與標黃段；highlights 是 compareMeaning 確認過確實出現在回譯裡的子字串
export function segmentize(text: string, highlights: string[]): BackSegment[] {
  const out: BackSegment[] = [];
  let rest = text;
  const hs = highlights.filter(Boolean);
  while (rest) {
    let at = -1;
    let hit = '';
    for (const h of hs) {
      const i = rest.indexOf(h);
      if (i >= 0 && (at < 0 || i < at || (i === at && h.length > hit.length))) [at, hit] = [i, h];
    }
    if (at < 0) {
      out.push({ text: rest, flagged: false });
      break;
    }
    if (at > 0) out.push({ text: rest.slice(0, at), flagged: false });
    out.push({ text: hit, flagged: true });
    rest = rest.slice(at + hit.length);
  }
  return out;
}

export class LlmTranslator implements Translator {
  constructor(private llm: LLM, private strongModel: string) {}
  async translate(items: TranslateItem[], ctx: TranslateContext): Promise<Translation[]> {
    // 「重譯」改用較強的模型
    const llm = ctx.quality === 'strong' ? this.llm.withStep('translate', this.strongModel) : this.llm;
    const { translations } = await translateBatch(llm, {
      messages: items.map((i) => ({ id: i.id, user: i.author ?? '?', text: i.text })),
      context: ctx.recent.map((r) => ({ user: r.author ?? '?', text: r.text })),
      glossary: ctx.glossary,
      variant: loadVariant(),
    });
    return translations.map((t) => ({ id: t.id, zh: t.zh, idioms: t.idioms }));
  }
}

export class LlmPolisher implements Polisher {
  // 一次潤色就產出三種語氣；切語氣時直接取用，不再呼叫模型
  private cache = new Map<string, Promise<PolishResult>>();
  constructor(private llm: LLM) {}

  private run(req: PolishRequest, instruction?: string): Promise<PolishResult> {
    const key = JSON.stringify([req.draftZh, req.replyTo?.text ?? null, instruction ?? null, req.recent.at(-1)?.text ?? null]);
    let p = this.cache.get(key);
    if (!p) {
      const sample: { author: string; text: string; ts?: number }[] = req.sample?.length ? req.sample : req.recent;
      p = polishTask(this.llm, {
        draft: req.draftZh,
        recent: req.recent.map((r) => ({ user: r.author, text: r.text })),
        replyTo: req.replyTo ? { user: req.replyTo.author, text: req.replyTo.text } : undefined,
        tone: computeToneProfile(sample.map((m) => ({ user: m.author, text: m.text, ts: m.ts }))),
        glossary: req.glossary,
        myVoice: req.myVoice,
        instruction,
        variant: loadVariant(),
      }).then((r) => r.result);
      p.catch(() => this.cache.delete(key));
      this.cache.set(key, p);
      if (this.cache.size > 20) this.cache.delete(this.cache.keys().next().value!);
    }
    return p;
  }

  async polish(req: PolishRequest): Promise<PolishDraft> {
    return toDraft((await this.run(req))[TONE[req.tone]]);
  }

  async refine(req: PolishRequest, _previous: PolishDraft, instruction: string): Promise<PolishDraft> {
    return toDraft((await this.run(req, instruction))[TONE[req.tone]]);
  }
}

export class LlmVerifier implements Verifier {
  constructor(private llm: LLM, private glossary: GlossaryEntry[]) {}
  // 刻意不傳中文原稿：回譯看不到原稿，比對才有意義
  async backTranslate(english: string[]): Promise<string> {
    const { result } = await backtranslate(this.llm, { texts: { en: english.join('\n') }, glossary: this.glossary, variant: loadVariant() });
    return result.en ?? '';
  }
  async compare(draftZh: string, backZh: string, english: string[]): Promise<{ segments: BackSegment[]; check: MeaningCheck }> {
    const { result } = await compareMeaning(this.llm, { draft: draftZh, backtranslation: backZh, english: english.join('\n'), variant: loadVariant() });
    return { segments: segmentize(backZh, result.highlights), check: { kind: result.status, summary: result.summary } };
  }
}

export class LlmSummarizer implements Summarizer {
  constructor(private llm: LLM, private glossary: GlossaryEntry[]) {}
  async summarize(items: TranslateItem[]): Promise<string> {
    const { summary } = await summarizeUnread(this.llm, {
      messages: items.map((i) => ({ user: i.author ?? '?', text: i.text })),
      glossary: this.glossary,
      variant: loadVariant(),
    });
    return summary;
  }
}
