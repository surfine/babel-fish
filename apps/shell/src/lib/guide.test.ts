import { describe, expect, it } from 'vitest';
import { COMPACT_AFTER, isCompact, matchesCopied, parseGuidePref, recordDone } from './guide';

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
  const copied = ['same here, no AirPods on beta 4', 'will try again in a bit'];
  it('送出其中一則、或合併全文都算；Slack 改了引號和空白也算', () => {
    expect(matchesCopied(copied, 'same here,  no AirPods on beta 4')).toBe(true);
    expect(matchesCopied(copied, 'same here, no AirPods on beta 4\n\nwill try again in a bit')).toBe(true);
    expect(matchesCopied(["it's fine"], 'it’s fine')).toBe(true);
  });
  it('別的訊息、空訊息不算', () => {
    expect(matchesCopied(copied, 'lunch?')).toBe(false);
    expect(matchesCopied(copied, '   ')).toBe(false);
  });
});
