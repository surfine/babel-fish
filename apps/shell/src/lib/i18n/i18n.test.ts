import { afterEach, describe, expect, it } from 'vitest';
import { report } from '../../../scripts/i18n.mjs';
import { buildRegions } from '../../../scripts/i18n-plugin';
import { charConverter } from './opencc';
import { replaceTerms, toRegion } from './region';
import { format, langName, regional, rustStrings, setUserLangForTest, t } from './index';
import en from './en';

afterEach(() => setUserLangForTest('zh-TW'));

describe('沒有漏翻', () => {
  it('每個 t()／tr() 的鍵都有英文，英文目錄沒有多的鍵，參數一致，也沒有沒包進 t() 的中文', async () => {
    const r = await report();
    expect(r.missing, '缺英文：跑 node scripts/i18n.mjs --stub 再填').toEqual([]);
    expect(r.unused, '英文目錄裡沒人用的鍵').toEqual([]);
    expect(r.badParams, '英文的 {參數} 和原文不一致').toEqual([]);
    expect(r.unwrapped.map((u) => `${u.file}:${u.line} ${u.text}`), '介面文字要用 t() 包起來').toEqual([]);
    expect(r.keys).toBeGreaterThan(200);
  });

  it('香港、大陆、马新的目錄涵蓋每個鍵，而且真的換成該地區的寫法', () => {
    const { regions, rustKeys } = buildRegions();
    const keys = Object.keys(en);
    for (const v of ['zh-HK', 'zh-CN', 'zh-SG'] as const) {
      for (const k of keys) expect(regions[v][k], `${v} 缺 ${k}`).toBeTruthy();
    }
    expect(regions['zh-CN']['登入 Slack']).toBe('登录 Slack');
    expect(regions['zh-CN']['唯讀模式']).toBe('只读模式');
    expect(regions['zh-CN']['只複製']).toBe('只复制');
    expect(regions['zh-CN']['AI 金鑰沒填或無效，到「設定」檢查金鑰']).toBe('AI 密钥没填或无效，到“设置”检查密钥');
    expect(regions['zh-HK']['設定']).toBe('設定');
    expect(regions['zh-SG']['我的語言']).toBe('我的语言');
    // Rust 要的字串也在目錄裡
    expect(rustKeys).toContain('Slack 登入已失效，請重新登入');
    for (const k of rustKeys) expect(en[k]).toBeTruthy();
  });

  it('示範資料預寫的中文也有各地區版本', () => {
    const { demo } = buildRegions();
    expect(demo['zh-CN']['到了，今天早上送到辦公室']).toBe('到了，今天早上送到办公室');
  });
});

describe('t()', () => {
  it('台灣正體直接用原文；英文查表；參數與單複數', () => {
    expect(t('{n} 則回覆', { n: 2 })).toBe('2 則回覆');
    setUserLangForTest('en');
    expect(t('{n} 則回覆', { n: 1 })).toBe('1 reply');
    expect(t('{n} 則回覆', { n: 3 })).toBe('3 replies');
    expect(t('潤色成{lang}', { lang: t('中文（台灣用字）') })).toBe('Polish into Chinese (Taiwan)');
    // 目錄裡沒有的鍵顯示原文，不會變空白
    expect(t('目錄裡沒有的字')).toBe('目錄裡沒有的字');
  });

  it('大陆简体用建置時產生的目錄', () => {
    setUserLangForTest('zh-CN');
    expect(t('設定')).toBe('设置');
    expect(t('你不在的時候有 {n} 則新訊息', { n: 4 })).toBe('你不在的时候有 4 则新消息');
    expect(regional('到了，今天早上送到辦公室')).toBe('到了，今天早上送到办公室');
  });

  it('format 只換認得的參數', () => {
    expect(format('{a} 和 {b}', { a: 1 })).toBe('1 和 {b}');
  });

  it('交給 Rust 的字串跟著語言', () => {
    setUserLangForTest('en');
    expect(rustStrings()['Slack 登入已失效，請重新登入']).toBe('Your Slack sign-in expired. Sign in again');
  });
});

describe('langName', () => {
  it('同是中文時只說「中文」，地區不同才寫出地區；英文介面一律寫出地區', () => {
    expect(langName('en', 'zh-TW')).toBe('英文');
    expect(langName('zh-TW', 'zh-TW')).toBe('中文');
    expect(langName('zh-CN', 'zh-TW')).toBe('中文（大陸用字）');
    setUserLangForTest('en');
    expect(langName('zh-TW', 'en')).toBe('Chinese (Taiwan)');
    expect(langName('en', 'en')).toBe('English');
  });
});

describe('地區轉換', () => {
  it('長詞先換，不把「資料夾」拆成「資料」＋夾', () => {
    expect(replaceTerms('打開資料夾，再看資料', 'zh-CN')).toBe('打開文件夹，再看数据');
    expect(replaceTerms('程式碼和程式', 'zh-HK')).toBe('程式碼和程式');
    expect(replaceTerms('上傳檔案', 'zh-HK')).toBe('上載檔案');
    expect(replaceTerms('搭計程車', 'zh-SG')).toBe('搭德士');
  });

  it('用詞、字形、引號一起換', () => {
    expect(toRegion('金鑰存在這台 Mac 的鑰匙圈', 'zh-CN', charConverter('zh-CN'))).toBe('密钥存在这台 Mac 的钥匙串');
    expect(toRegion('到左下「設定」', 'zh-CN', charConverter('zh-CN'))).toBe('到左下“设置”');
    expect(toRegion('軟體更新', 'zh-HK', charConverter('zh-HK'))).toBe('軟件更新');
    expect(toRegion('資訊', 'zh-SG', charConverter('zh-SG'))).toBe('资讯');
    expect(toRegion('登入', 'zh-TW', charConverter('zh-TW'))).toBe('登入');
  });
});
