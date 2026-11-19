import { describe, expect, it } from 'vitest';
import { detectLang } from './lang';

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
