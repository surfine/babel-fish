// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { convertUI, makeConverter, replaceTerms, variantFromLocales } from './zh';

describe('variantFromLocales', () => {
  it('依系統語言猜地區', () => {
    expect(variantFromLocales(['zh-CN'])).toBe('zh-CN');
    expect(variantFromLocales(['zh-Hans-CN'])).toBe('zh-CN');
    expect(variantFromLocales(['zh-HK'])).toBe('zh-HK');
    expect(variantFromLocales(['zh-Hant-HK'])).toBe('zh-HK');
    expect(variantFromLocales(['zh-SG'])).toBe('zh-SG');
    expect(variantFromLocales(['zh-Hans-MY'])).toBe('zh-SG');
    expect(variantFromLocales(['en-US', 'zh-TW'])).toBe('zh-TW');
    expect(variantFromLocales(['en-US'])).toBe('zh-TW');
  });
});

describe('replaceTerms', () => {
  it('長詞先換，不把「資料夾」拆成「資料」＋夾', () => {
    expect(replaceTerms('打開資料夾，再看資料', 'zh-CN')).toBe('打開文件夹，再看数据');
    expect(replaceTerms('程式碼和程式', 'zh-HK')).toBe('程式碼和程式');
    expect(replaceTerms('上傳檔案', 'zh-HK')).toBe('上載檔案');
    expect(replaceTerms('搭計程車', 'zh-SG')).toBe('搭德士');
  });
});

describe('makeConverter', () => {
  it('介面文字換成各地區的用詞與字形', async () => {
    const cn = await makeConverter('zh-CN');
    expect(cn('登入 Slack 之前')).toBe('登录 Slack 之前');
    expect(cn('金鑰存在這台 Mac 的鑰匙圈')).toBe('密钥存在这台 Mac 的钥匙串');
    expect(cn('唯讀模式')).toBe('只读模式');
    expect(cn('只複製')).toBe('只复制');
    expect(cn('到左下「設定」')).toBe('到左下“设置”');
    const hk = await makeConverter('zh-HK');
    expect(hk('軟體更新')).toBe('軟件更新');
    expect(hk('「設定」')).toBe('「設定」');
    const sg = await makeConverter('zh-SG');
    expect(sg('資訊')).toBe('资讯');
    const tw = await makeConverter('zh-TW');
    expect(tw('登入')).toBe('登入');
  });
});

describe('convertUI', () => {
  it('轉換介面文字與屬性，跳過 data-raw 的原文和人名', async () => {
    document.body.innerHTML = `<div id="r"><button title="登入">登入 Slack</button><input placeholder="搜尋表情"><div data-raw><span>原文的軟體二字</span></div></div>`;
    const root = document.getElementById('r')!;
    const stop = convertUI(root, await makeConverter('zh-CN'));
    expect(root.querySelector('button')!.textContent).toBe('登录 Slack');
    expect(root.querySelector('button')!.getAttribute('title')).toBe('登录');
    expect(root.querySelector('input')!.getAttribute('placeholder')).toBe('搜索表情');
    expect(root.querySelector('[data-raw] span')!.textContent).toBe('原文的軟體二字');
    // 之後才出現的文字也會轉
    const p = document.createElement('p');
    p.textContent = '設定';
    root.appendChild(p);
    await new Promise((r) => setTimeout(r, 0));
    expect(p.textContent).toBe('设置');
    stop();
  });
});
