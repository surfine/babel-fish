/**
 * M0 潤色品質實驗台。
 *
 *   npm run bench                                  # 預設比較 Opus 5.5（low/medium）與 Sonnet 5.5
 *   npm run bench -- --models anthropic:claude-sonnet-5-5,deepseek:deepseek-flash
 *   npm run bench -- --cases 01,04 --same-model    # 回譯與比對也用候選模型
 *   npm run bench -- --mock                        # 不打網路，驗證流程與報告格式
 *   npm run bench -- --dry-run                     # 只印出第一個 case 的潤色提示
 *
 * 讀 bench/cases/*.json，對每個候選模型跑 polish → backtranslate → compare，
 * 輸出並排比較的 markdown（與原始 JSON）到 bench/reports/。
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeToneProfile,
  createLLM,
  createMockProvider,
  estimateCost,
  parseModelRef,
  reviewDraft,
  buildPolishPrompt,
  POLISH_SYSTEM,
  TONES,
  type ContextMessage,
  type GlossaryEntry,
  type LLM,
  type RawConfig,
  type ReviewCard,
  type Step,
  type TaskMeta,
  type Tone,
} from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MODELS = ['anthropic:claude-opus-5-5@low', 'anthropic:claude-opus-5-5@medium', 'anthropic:claude-sonnet-5-5@medium'];
const TONE_LABEL: Record<Tone, string> = { channel: '像這個頻道（預設）', casual: '更隨意', formal: '更正式' };
const TONE_ORDER: Tone[] = ['channel', 'casual', 'formal'];

interface BenchCase {
  id: string;
  title: string;
  draft: string;
  /** 對話：內嵌陣列，或 bench/conversations/<名字>.json。 */
  conversation: string | ContextMessage[];
  /** 回應對象：對話中的索引（0 起算），或直接給訊息。 */
  replyTo?: number | ContextMessage;
  /** 額外給語氣統計用的頻道訊息（不進潤色脈絡）。 */
  toneSamples?: ContextMessage[];
  myVoice?: string[];
  /** 這個 case 要特別看什麼，寫進報告提醒評審。 */
  watch?: string;
}

interface Cell {
  model: string;
  card?: ReviewCard;
  error?: string;
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[a.slice(2)] = next;
      i++;
    } else args[a.slice(2)] = true;
  }
  return args;
}

function loadCases(filter?: string): BenchCase[] {
  const dir = join(HERE, 'cases');
  const wanted = filter ? filter.split(',').map((s) => s.trim()) : undefined;
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .filter((f) => !wanted || wanted.some((w) => f.startsWith(w)))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as BenchCase);
}

function resolveConversation(c: BenchCase): ContextMessage[] {
  if (Array.isArray(c.conversation)) return c.conversation;
  return JSON.parse(readFileSync(join(HERE, 'conversations', `${c.conversation}.json`), 'utf8'));
}

function polishInput(c: BenchCase, glossary: GlossaryEntry[]) {
  const recent = resolveConversation(c);
  const replyTo = typeof c.replyTo === 'number' ? recent[c.replyTo] : c.replyTo;
  const tone = computeToneProfile([...(c.toneSamples ?? []), ...recent]);
  return { draft: c.draft, recent, replyTo, tone, glossary, myVoice: c.myVoice };
}

/** 沒有金鑰的供應商列出來，對應的候選直接跳過（而不是跑到一半才失敗）。 */
function missingKey(llm: LLM, providerId: string): string | undefined {
  const p = llm.config.providers[providerId];
  if (!p) return `沒有設定供應商 ${providerId}`;
  if (p.kind === 'openai-compatible' && p.requireApiKey === false) return undefined;
  const env = p.apiKeyEnv ?? (p.kind === 'anthropic' ? 'ANTHROPIC_API_KEY' : p.kind === 'deepseek' ? 'DEEPSEEK_API_KEY' : undefined);
  return env && !process.env[env] ? `缺少 ${env}` : undefined;
}

function mockLLM(config: RawConfig): LLM {
  const mock = createMockProvider('mock', (req) => {
    const user = req.messages[0].content;
    switch (req.json?.name) {
      case 'polish':
        return {
          casual: { bubbles: ['yep same, nothing on 27.2 here either', 'prob need the Apple TV to finish updating first. will check again later'], merged: 'x', notes: [{ phrase: 'prob', why: 'probably 的縮寫' }] },
          channel: { bubbles: ['same here, no remotes showing up on 27.2 for me either', 'maybe it only shows up once the Apple TV finishes updating? will try again in a bit'], merged: 'x', notes: [{ phrase: 'same here', why: '最自然的附和' }] },
          formal: { bubbles: ['Same here. I’m not seeing any remotes on iOS 27.2 either.'], merged: null, notes: [{ phrase: '完整句子', why: '適合寫給編輯' }] },
        };
      case 'backtranslation': {
        const items = JSON.parse(user.slice(user.lastIndexOf('[')));
        return { items: items.map((i: { key: string }) => ({ key: i.key, zh: i.key === 'casual' ? '對啊我也是。大概要等 Apple TV 更新完吧' : '我這邊也一樣。也許要等 Apple TV 更新完？' })) };
      }
      case 'meaning_check':
        return user.includes('大概')
          ? { status: 'warn', summary: '「也許」寫成了 prob（大概），語氣比你的原稿篤定一點', added: [], omitted: [], toneShifts: [{ original: '也許', now: '大概', direction: 'stronger' }], highlights: ['大概'] }
          : { status: 'ok', summary: '意思一致：沒有新增或漏掉資訊', added: [], omitted: [], toneShifts: [], highlights: [] };
      default:
        return {};
    }
  });
  const providers = Object.keys({ anthropic: 1, deepseek: 1, ...(config.providers ?? {}) });
  return createLLM(config, { providerOverrides: Object.fromEntries(providers.map((p) => [p, mock])) });
}

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
const usd = (x: number | undefined) => (x === undefined ? '—' : `$${x.toFixed(4)}`);

function highlight(back: string, marks: string[]): string {
  let out = esc(back);
  for (const m of marks) out = out.split(esc(m)).join(`**${esc(m)}**`);
  return out;
}

function cardCost(card: ReviewCard): { polish?: number; total?: number } {
  const all: TaskMeta[] = [card.meta.polish, card.meta.backtranslate, ...card.meta.compare];
  const costs = all.map((m) => estimateCost(m.model, m.usage));
  return { polish: costs[0], total: costs.every((c) => c !== undefined) ? costs.reduce((a, b) => a! + b!, 0) : undefined };
}

function renderReport(opts: { cases: BenchCase[]; models: string[]; skipped: string[]; results: Map<string, Cell[]>; steps: Record<Step, string>; sameModel: boolean; mock: boolean }): string {
  const { cases, models, results } = opts;
  const now = new Date();
  const lines: string[] = [];
  lines.push(`# M0 潤色比較　${now.toLocaleString('zh-TW', { hour12: false })}${opts.mock ? '（mock，非真實模型輸出）' : ''}`, '');
  lines.push(`- 候選（只換 polish${opts.sameModel ? '，回譯與比對也用同一模型' : ''}）：${models.map((m) => `\`${m}\``).join('、')}`);
  if (!opts.sameModel) lines.push(`- 回譯：\`${opts.steps.backtranslate}\`；意思比對：\`${opts.steps.compare}\`（固定，避免評分者跟著換）`);
  if (opts.skipped.length) lines.push(`- 跳過：${opts.skipped.join('；')}`);
  lines.push(`- case 數：${cases.length}；每個候選各跑一次 polish → backtranslate → compare`, '');

  lines.push('## 總覽', '', '「頻道語氣 ok」指預設語氣的意思檢查為 ok 或 info。延遲與 token 只算 polish 一步；成本含回譯與比對。最後一欄留給你：讀完下面每個 case，數一數這個模型「可以直接送」的則數。', '');
  lines.push('| 模型 | 成功 | 頻道語氣 ok | 三語氣 warn 數 | polish 平均延遲 | polish 平均輸出 token | 每次審閱約 | 你判斷可直接送 |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const model of models) {
    const cells = cases.map((c) => results.get(c.id)!.find((x) => x.model === model)!).filter((x) => x.card);
    const cards = cells.map((x) => x.card!);
    const okChannel = cards.filter((c) => c.variants.channel.check.status !== 'warn').length;
    const warns = cards.reduce((n, c) => n + TONES.filter((t) => c.variants[t].check.status === 'warn').length, 0);
    const avgMs = cards.length ? Math.round(cards.reduce((n, c) => n + c.meta.polish.ms, 0) / cards.length) : 0;
    const avgOut = cards.length ? Math.round(cards.reduce((n, c) => n + c.meta.polish.usage.outputTokens, 0) / cards.length) : 0;
    const totals = cards.map((c) => cardCost(c).total);
    const avgCost = totals.length && totals.every((t) => t !== undefined) ? totals.reduce((a, b) => a! + b!, 0)! / totals.length : undefined;
    lines.push(`| \`${model}\` | ${cards.length}/${cases.length} | ${okChannel}/${cards.length} (${pct(okChannel, cards.length)}) | ${warns} | ${(avgMs / 1000).toFixed(1)} s | ${avgOut} | ${usd(avgCost)} | ☐ /${cases.length} |`);
  }
  lines.push('');

  for (const c of cases) {
    const input = polishInput(c, []);
    lines.push(`## ${c.id}　${c.title}`, '');
    lines.push(`**中文草稿**：${c.draft}`, '');
    if (input.replyTo) lines.push(`**回應**：[${input.replyTo.user}] ${esc(input.replyTo.text)}`, '');
    if (c.watch) lines.push(`**要看的地方**：${c.watch}`, '');
    const cells = results.get(c.id)!;
    for (const tone of TONE_ORDER) {
      lines.push(`### ${TONE_LABEL[tone]}`, '', '| 模型 | 會送出的英文 | 回譯（粗體＝差異） | 意思檢查 | 可直接送？ |', '| --- | --- | --- | --- | --- |');
      for (const cell of cells) {
        if (!cell.card) {
          lines.push(`| \`${cell.model}\` | 失敗：${esc(cell.error ?? '')} | | | |`);
          continue;
        }
        const v = cell.card.variants[tone];
        const english = v.bubbles.map((b) => `› ${esc(b)}`).join('<br>');
        lines.push(`| \`${cell.model}\` | ${english} | ${highlight(v.back, v.check.highlights)} | **${v.check.status}** ${esc(v.check.summary)} | ☐ |`);
      }
      lines.push('');
    }
    lines.push('<details><summary>為什麼這樣寫（各模型，像這個頻道）</summary>', '');
    for (const cell of cells) {
      if (!cell.card) continue;
      lines.push(`- \`${cell.model}\`：${cell.card.variants.channel.notes.map((n) => `**${esc(n.phrase)}** ${esc(n.why)}`).join('；')}`);
    }
    lines.push('', '</details>', '');
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = typeof args.config === 'string' ? args.config : join(HERE, 'rosetta.config.json');
  const config: RawConfig = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
  const glossary: GlossaryEntry[] = JSON.parse(readFileSync(join(HERE, 'glossary.json'), 'utf8'));
  const cases = loadCases(typeof args.cases === 'string' ? args.cases : undefined);
  const models = typeof args.models === 'string' ? args.models.split(',').map((s) => s.trim()) : DEFAULT_MODELS;
  const sameModel = args['same-model'] === true;
  const mock = args.mock === true;
  if (!cases.length) throw new Error('bench/cases 裡沒有符合的 case');

  if (args['dry-run']) {
    const input = polishInput(cases[0], glossary);
    console.log(`=== system ===\n${POLISH_SYSTEM}\n\n=== user（${cases[0].id}）===\n${buildPolishPrompt(input)}`);
    return;
  }

  const base = mock ? mockLLM(config) : createLLM(config);
  const steps = Object.fromEntries(Object.entries(base.config.steps).map(([k, v]) => [k, `${v.provider}:${v.model}${v.effort ? `@${v.effort}` : ''}`])) as Record<Step, string>;
  const skipped: string[] = [];
  const runnable: Array<{ model: string; llm: LLM }> = [];
  for (const model of models) {
    let llm = base.withStep('polish', model);
    if (sameModel) llm = llm.withStep('backtranslate', model).withStep('compare', model);
    const needed = new Set([parseModelRef(model).provider, llm.config.steps.backtranslate.provider, llm.config.steps.compare.provider]);
    const reason = mock ? undefined : [...needed].map((p) => missingKey(llm, p)).find(Boolean);
    if (reason) skipped.push(`\`${model}\`（${reason}）`);
    else runnable.push({ model, llm });
  }
  if (!runnable.length) {
    console.error(`沒有可以跑的候選：${skipped.join('；')}\n設定 ANTHROPIC_API_KEY／DEEPSEEK_API_KEY 後再跑，或用 --mock 驗證流程。`);
    process.exitCode = 2;
    return;
  }

  const results = new Map<string, Cell[]>();
  for (const c of cases) {
    const input = polishInput(c, glossary);
    const cells = await Promise.all(
      runnable.map(async ({ model, llm }): Promise<Cell> => {
        try {
          return { model, card: await reviewDraft(llm, input) };
        } catch (err) {
          return { model, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
    results.set(c.id, cells);
    console.log(`${c.id}：${cells.map((x) => `${x.model} ${x.card ? x.card.variants.channel.check.status : '失敗'}`).join('，')}`);
  }

  const outDir = typeof args.out === 'string' ? args.out : join(HERE, 'reports');
  mkdirSync(outDir, { recursive: true });
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  const name = `${stamp}${mock ? '-mock' : ''}`;
  const md = renderReport({ cases, models: runnable.map((r) => r.model), skipped, results, steps, sameModel, mock });
  writeFileSync(join(outDir, `${name}.md`), md);
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify({ steps, sameModel, mock, cases: cases.map((c) => ({ ...c, results: results.get(c.id) })) }, null, 2));
  console.log(`報告：${join(outDir, `${name}.md`)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
