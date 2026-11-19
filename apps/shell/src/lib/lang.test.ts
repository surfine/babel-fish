import { describe, expect, it } from 'vitest';
import { detectChannelLang, detectLang } from './lang';

describe('detectLang', () => {
  it.each([
    ['我這邊也一樣，27.2 上看不到遙控器', 'zh'],
    ['今天要開會嗎？我晚點到', 'zh'],
    ['sure does take a long time to Prepare', 'en'],
    ['ah k', 'en'],
    ['iPadOS 27 終於出了，AirPods Pro 可以用尋找了', 'zh'],
    ['新しいMacBook Proはすごいです', 'ja'],
    ['새로운 맥북 프로', 'ko'],
    ['Ежедневные новости', 'ru'],
  ])('%s → %s', (text, lang) => {
    expect(detectLang(text)).toBe(lang);
  });

  it('只有網址、emoji 或數字時無法判斷（照常翻譯）', () => {
    expect(detectLang('https://example.com/a')).toBe('unknown');
    expect(detectLang(':thumbsup: 27.2')).toBe('unknown');
  });

  it('中英混雜到不分上下時判成 unknown，寧可多翻也不漏翻', () => {
    expect(detectLang('ok 好 the update 更新了 yes')).toBe('unknown');
  });
});

describe('detectChannelLang', () => {
  const en = ['same here', 'ok it’s updating now', 'ah k', 'yep'];
  const tw = ['這版好像修好了耶', '那我先 merge 喔', '好 我等等看', '還沒過嗎？'];
  const cn = ['这个版本还没修好吗', '我这边也是', '收到 我下午看一下', '有问题随时说哈'];

  it('英文為主就是英文；中文為主再分地區', () => {
    expect(detectChannelLang(en, 'zh-TW')).toBe('en');
    expect(detectChannelLang(tw, 'en')).toBe('zh-TW');
    expect(detectChannelLang(cn, 'en')).toBe('zh-CN');
  });

  it('繁體有粵語字或使用者在香港就是香港；簡體而使用者在馬新就是馬新', () => {
    expect(detectChannelLang(['我哋今日開會', '佢未覆我', '係咪改咗時間', '好'], 'zh-TW')).toBe('zh-HK');
    expect(detectChannelLang(tw, 'zh-HK')).toBe('zh-HK');
    expect(detectChannelLang(cn, 'zh-SG')).toBe('zh-SG');
  });

  it('訊息太少時不判斷', () => {
    expect(detectChannelLang(['ok', ':tada:'], 'zh-TW')).toBeNull();
  });
});
