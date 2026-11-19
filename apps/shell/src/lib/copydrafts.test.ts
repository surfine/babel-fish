import { describe, expect, it } from 'vitest';
import {
  COPY_DRAFT_CAP,
  COPY_DRAFT_TTL_MS,
  lookupCopyDraft,
  normalizeEnglish,
  pruneCopyDrafts,
  recordCopyDraft,
  type CopyDraftMap,
} from './copydrafts';

const T0 = 1_800_000_000_000;

describe('normalizeEnglish', () => {
  it('trims and collapses whitespace including newlines', () => {
    expect(normalizeEnglish('  Hello \n\n  world\t!  ')).toBe('Hello world !');
  });
  it('unifies curly quotes and apostrophes', () => {
    expect(normalizeEnglish('It’s “fine”, ‘really’')).toBe('It\'s "fine", \'really\'');
  });
  it('returns empty for blank input', () => {
    expect(normalizeEnglish(' \n ')).toBe('');
  });
});

describe('copy draft matching', () => {
  it('matches a message that Slack re-rendered with curly quotes and different spacing', () => {
    const m = recordCopyDraft({}, "I'll check it  tomorrow.", '我明天看', T0);
    expect(lookupCopyDraft(m, 'I’ll check it tomorrow. ', T0 + 1000)).toBe('我明天看');
  });
  it('matches each bubble and the joined text separately', () => {
    let m: CopyDraftMap = {};
    m = recordCopyDraft(m, 'First point.', '原稿', T0);
    m = recordCopyDraft(m, 'Second point.', '原稿', T0);
    m = recordCopyDraft(m, 'First point.\n\nSecond point.', '原稿', T0);
    expect(lookupCopyDraft(m, 'First point.', T0)).toBe('原稿');
    expect(lookupCopyDraft(m, 'Second point.', T0)).toBe('原稿');
    expect(lookupCopyDraft(m, 'First point. Second point.', T0)).toBe('原稿');
    expect(lookupCopyDraft(m, 'Third point.', T0)).toBeUndefined();
  });
  it('ignores empty english or empty draft', () => {
    expect(recordCopyDraft({}, '  ', '原稿', T0)).toEqual({});
    expect(recordCopyDraft({}, 'Hi', ' ', T0)).toEqual({});
    expect(lookupCopyDraft({}, '', T0)).toBeUndefined();
  });
  it('expires after 7 days', () => {
    const m = recordCopyDraft({}, 'Hi there', '嗨', T0);
    expect(lookupCopyDraft(m, 'Hi there', T0 + COPY_DRAFT_TTL_MS - 1)).toBe('嗨');
    expect(lookupCopyDraft(m, 'Hi there', T0 + COPY_DRAFT_TTL_MS)).toBeUndefined();
    expect(pruneCopyDrafts(m, T0 + COPY_DRAFT_TTL_MS)).toEqual({});
  });
  it('caps at 200 entries and keeps the newest', () => {
    let m: CopyDraftMap = {};
    for (let i = 0; i < COPY_DRAFT_CAP + 20; i++) m = recordCopyDraft(m, `message ${i}`, `稿 ${i}`, T0 + i);
    expect(Object.keys(m)).toHaveLength(COPY_DRAFT_CAP);
    expect(lookupCopyDraft(m, 'message 0', T0 + 300)).toBeUndefined();
    expect(lookupCopyDraft(m, `message ${COPY_DRAFT_CAP + 19}`, T0 + 300)).toBe(`稿 ${COPY_DRAFT_CAP + 19}`);
  });
  it('re-copying the same english refreshes the draft and time', () => {
    let m = recordCopyDraft({}, 'Same text', '舊稿', T0);
    m = recordCopyDraft(m, 'Same  text', '新稿', T0 + 5000);
    expect(Object.keys(m)).toHaveLength(1);
    expect(lookupCopyDraft(m, 'Same text', T0 + 5000)).toBe('新稿');
  });
});
