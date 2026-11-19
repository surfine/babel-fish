import { describe, expect, it } from 'vitest';
import { COMPACT_AFTER, isCompact, matchesCopied, parseGuidePref, recordDone, shouldClearComposer } from './guide';

describe('guide pref', () => {
  it('沒有紀錄或壞掉時預設開啟、次數 0', () => {
    expect(parseGuidePref(null)).toEqual({ enabled: true, done: 0 });
    expect(parseGuidePref('{oops')).toEqual({ enabled: true, done: 0 });
    expect(parseGuidePref('{"enabled":false,"done":-2}')).toEqual({ enabled: false, done: 0 });
  });

  it(`完成 ${COMPACT_AFTER} 次後改顯示精簡版`, () => {
    let p = parseGuidePref(null);
    for (let i = 0; i < COMPACT_AFTER - 1; i++) p = recordDone(p);
    expect(isCompact(p)).toBe(false);
    expect(isCompact(recordDone(p))).toBe(true);
  });
});

describe('matchesCopied', () => {
  const copied = ['same here, my sample looks darker', 'will reshoot tomorrow'];
  it('送出其中一則、或合併全文都算；Slack 改了引號和空白也算', () => {
    expect(matchesCopied(copied, 'same here,  my sample looks darker')).toBe(true);
    expect(matchesCopied(copied, 'same here, my sample looks darker\n\nwill reshoot tomorrow')).toBe(true);
    expect(matchesCopied(["it's fine"], 'it’s fine')).toBe(true);
  });
  it('別的訊息、空訊息不算', () => {
    expect(matchesCopied(copied, 'lunch?')).toBe(false);
    expect(matchesCopied(copied, '   ')).toBe(false);
  });
});

describe('shouldClearComposer', () => {
  const sent = { channel: 'D1', draftZh: '這是測試訊息' };
  it('同頻道、同一份草稿（審閱中或還在輸入框）才清', () => {
    expect(shouldClearComposer(sent, { channel: 'D1', draft: '', reviewDraft: '這是測試訊息' })).toBe(true);
    expect(shouldClearComposer(sent, { channel: 'D1', draft: ' 這是測試訊息 ', reviewDraft: null })).toBe(true);
  });
  it('別的頻道、已經改寫成別的草稿、沒有傳送紀錄都不清', () => {
    expect(shouldClearComposer(sent, { channel: 'C2', draft: '這是測試訊息', reviewDraft: null })).toBe(false);
    expect(shouldClearComposer(sent, { channel: 'D1', draft: '新的草稿', reviewDraft: '另一份' })).toBe(false);
    expect(shouldClearComposer(null, { channel: 'D1', draft: '這是測試訊息', reviewDraft: null })).toBe(false);
  });
});
