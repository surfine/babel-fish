import { describe, expect, it } from 'vitest';
import { cleanForTone, computeToneProfile, describeToneProfile, type ToneMessage } from '../src/tone.js';

const m = (user: string, text: string, ts?: number): ToneMessage => ({ user, text, ts });

describe('computeToneProfile', () => {
  it('小寫開頭比例只算以英文字母開頭的訊息，並先去掉提及與網址', () => {
    const p = computeToneProfile([
      m('a', '@dana as expected nothing here'), // 去掉提及後是 as…，小寫
      m('b', '<@U123> Sounds good'), // Slack 原始提及，去掉後大寫
      m('c', '27.2 is out'), // 數字開頭，不列入分母
      m('d', 'https://apple.com check this'), // 去掉網址後是 check，小寫
    ]);
    expect(p.lowercaseStartRatio).toBeCloseTo(2 / 3, 2);
    expect(p.sampleSize).toBe(4);
  });

  it('句尾分類忽略結尾的 emoji 與括號，分得出 ... 和 …', () => {
    const p = computeToneProfile([
      m('a', 'done.'),
      m('a', 'really?'),
      m('a', 'nice!! 🎉'),
      m('a', 'hmm...'),
      m('a', 'well…'),
      m('a', 'ok (for now)'),
      m('a', 'see you.)'),
      m('a', 'no punctuation'),
    ]);
    expect(p.endings).toEqual({ none: 0.25, period: 0.25, question: 0.13, exclamation: 0.13, ellipsis: 0.25 });
  });

  it('縮寫要整個詞才算，大小寫與標點不影響', () => {
    const p = computeToneProfile([m('a', 'fwiw, TBH this is a problem'), m('b', 'prob fine. fwiw'), m('c', 'ok k thanks')]);
    expect(p.abbreviations).toEqual([
      { abbr: 'fwiw', count: 2 },
      { abbr: 'k', count: 1 },
      { abbr: 'prob', count: 1 },
      { abbr: 'tbh', count: 1 },
    ]);
  });

  it('連發：同一人相鄰且在 5 分鐘內；換人或間隔太久就斷開', () => {
    const p = computeToneProfile([
      m('owen', 'one', 0),
      m('owen', 'two', 60), // 與上一則連發
      m('dana', 'three', 70),
      m('owen', 'four', 80),
      m('owen', 'five', 80 + 301), // 超過 5 分鐘
    ]);
    expect(p.burstRatio).toBe(0.4);
  });

  it('沒有時間戳時，只看是不是同一人相鄰', () => {
    const p = computeToneProfile([m('a', 'x y'), m('a', 'y z'), m('b', 'z w')]);
    expect(p.burstRatio).toBe(0.67);
  });

  it('引用行不算進寫法，emoji 比例看原文', () => {
    const p = computeToneProfile([m('a', 'fine print fwiw\n> Find My for AirPods requires AirPods Pro.'), m('b', 'love it :tada:')]);
    expect(p.endings.period).toBe(0);
    expect(p.avgWords).toBe(2.5);
    expect(p.emojiRatio).toBe(0.5);
  });

  it('範例挑最新、不重複、太短的最多留兩則，並維持時間順序', () => {
    const texts = ['first real message here', 'yep', 'k', 'ah k', 'lol', 'yep', 'second real one'];
    const p = computeToneProfile(texts.map((t) => m('a', t)));
    // 從最新往回：yep、lol 用掉兩個短訊息名額，k 被跳過，舊的 yep 是重複
    expect(p.examples).toEqual(['first real message here', 'ah k', 'lol', 'yep', 'second real one']);
  });

  it('空輸入不會除以零', () => {
    const p = computeToneProfile([m('a', '   '), m('b', '<@U1>')]);
    expect(p.sampleSize).toBe(0);
    expect(p.lowercaseStartRatio).toBe(0);
    expect(describeToneProfile(p)).toBe('No channel history available.');
  });
});

describe('cleanForTone', () => {
  it('去掉 Slack 連結標記、表情代碼與多餘空白', () => {
    expect(cleanForTone('see <https://x.com|this>  :eyes:  now')).toBe('see now');
  });
});

describe('中文頻道的語氣', () => {
  const zh = [
    m('mei', '好 我等等看', 0),
    m('mei', '這版好像修好了耶', 30),
    m('rita', 'build 過了嗎？', 400),
    m('sam', '過了啦', 410),
    m('rita', '那我先 merge 喔～', 900),
    m('sam', '哈哈好', 905),
    m('owen', 'ok thanks', 2000),
  ];

  it('統計全形句尾、空格當標點、語氣詞、夾英文與字形', () => {
    const p = computeToneProfile(zh);
    expect(p.zhRatio).toBe(0.86);
    expect(p.zh).not.toBeNull();
    const z = p.zh!;
    expect(z.sampleSize).toBe(6);
    expect(z.fullWidthEndingRatio).toBe(1); // ？ 和 ～ 都是全形
    expect(z.spaceAsPunctuationRatio).toBe(0.17);
    expect(z.codeSwitchRatio).toBe(0.33);
    expect(z.script).toBe('traditional');
    expect(z.particles.map((x) => x.particle).sort()).toEqual(['哈哈', '啦', '喔', '嗎', '耶'].sort());
    expect(p.endings.question).toBe(0.14);
  });

  it('中文為主時，描述改用中文頻道的寫法，不提小寫開頭', () => {
    const d = describeToneProfile(computeToneProfile(zh));
    expect(d).toContain('traditional characters');
    expect(d).toContain('full-width');
    expect(d).toContain('啦 (1)');
    expect(d).not.toContain('lowercase');
  });

  it('英文頻道照舊：沒有中文訊息時 zh 是 null', () => {
    const p = computeToneProfile([m('a', 'same here'), m('b', 'ok')]);
    expect(p.zh).toBeNull();
    expect(describeToneProfile(p)).toContain('lowercase');
  });

  it('簡體訊息判斷成簡體', () => {
    const p = computeToneProfile([m('a', '这个版本还没修好吗'), m('b', '我这边也是')]);
    expect(p.zh!.script).toBe('simplified');
  });
});
