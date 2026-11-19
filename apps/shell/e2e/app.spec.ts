// 主視窗的回歸測試：每一項都是在真 Slack 或示範模式手動驗過、曾經壞過或容易被改壞的行為。
// 改了介面行為而這裡失敗，先確認是不是有意的改變；是的話連同 docs/INVARIANTS.md 一起改。
import { test, expect, type Page } from '@playwright/test';

/** 收集頁面錯誤，測試結束時必須是空的 */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

async function openDemo(page: Page, opts: { readOnly?: boolean; lang?: string } = {}) {
  await page.addInitScript(
    ({ readOnly, lang }) => {
      if (readOnly !== undefined) localStorage.setItem('rosetta.readOnly', JSON.stringify(readOnly));
      if (lang) localStorage.setItem('rosetta.userLang', lang);
    },
    { readOnly: opts.readOnly, lang: opts.lang },
  );
  await page.goto('/?demo');
  await expect(page.getByRole('textbox').last()).toBeVisible();
}

const msg = (page: Page, text: string) => page.locator('.msg', { hasText: text }).first();

test('第一次開啟先看到風險說明，勾選後才能同意；也能直接看示範', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  const agree = page.getByRole('button', { name: '同意並繼續' });
  await expect(agree).toBeDisabled();
  await page.getByRole('checkbox').check();
  await expect(agree).toBeEnabled();
  await page.getByRole('button', { name: '先看示範' }).click();
  await expect(page.getByRole('complementary', { name: '側欄' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('示範頻道：原文配譯文、連結預覽卡、圖片與對話串', async ({ page }) => {
  const errors = watchErrors(page);
  await openDemo(page);
  await expect(msg(page, 'did the beta 4 build get pulled')).toContainText('你們那邊 beta 4 也被下架了嗎？');
  // 連結預覽：Slack 的 unfurl 畫成卡片，標題是連結
  await expect(page.getByRole('link', { name: 'iPadOS 27 beta 4 release notes' })).toBeVisible();
  await expect(page.getByRole('button', { name: '放大預覽 find-my-ipad.png' })).toBeVisible();
  await page.getByRole('button', { name: /2 則回覆/ }).click();
  await expect(page.locator('.thread-pane, [aria-label*="對話串"]').first()).toBeVisible();
  // 閱讀模式三種都能切
  for (const mode of ['譯文', '原文', '對照']) {
    await page.getByRole('tab', { name: mode }).click();
    await expect(page.getByRole('tab', { name: mode })).toHaveAttribute('aria-selected', 'true');
  }
  expect(errors).toEqual([]);
});

test('唯讀模式（預設）：不能加表情回應，審閱卡只給「複製並打開 Slack」，沒有傳送', async ({ page }) => {
  await openDemo(page);
  const m = msg(page, 'yep, gone from the developer site');
  await m.hover();
  await expect(page.getByRole('button', { name: '新增表情回應' })).toHaveCount(0);
  await expect(m.getByRole('button', { name: /👀/ })).toBeDisabled();

  await page.getByRole('button', { name: /潤色成英文/ }).click();
  const review = page.getByRole('region', { name: /草稿審閱/ });
  await expect(review).toBeVisible();
  await expect(review.getByRole('button', { name: '複製並打開 Slack' })).toBeVisible();
  await expect(review.getByRole('button', { name: /^傳送/ })).toHaveCount(0);
});

test('關掉唯讀後：表情選單打得開，選了會出現在訊息下方（曾因點擊冒泡而一打開就關掉）', async ({ page }) => {
  const errors = watchErrors(page);
  await openDemo(page, { readOnly: false });
  const m = msg(page, 'yep, gone from the developer site');

  const picker = page.getByRole('dialog', { name: '選擇表情' });
  const openFromMessage = async () => {
    await m.hover();
    await m.getByRole('button', { name: '新增表情回應' }).first().click();
  };
  const clickOutside = () => page.locator('main').click({ position: { x: 5, y: 5 } });

  // 這個錯要在「點外面關掉選單」之後再打開才出現：那時文件層的「點外面就關」會把新打開的選單也關掉
  await openFromMessage();
  await expect(picker).toBeVisible();
  await clickOutside();
  await expect(picker).toBeHidden();

  // 訊息上的 ☺
  await openFromMessage();
  await expect(picker).toBeVisible();
  await picker.getByRole('textbox', { name: '搜尋表情' }).fill('thumbsup');
  await picker.getByRole('button').first().click();
  await expect(picker).toBeHidden();
  await expect(m.getByRole('button', { name: /👍\s*1/ })).toBeVisible();

  // 選單開著時，直接按另一則訊息的 ☺：選單要換到那一則，不能被關掉
  await openFromMessage();
  const other = msg(page, 'did the beta 4 build get pulled');
  await other.hover();
  await other.getByRole('button', { name: '新增表情回應' }).first().click();
  await expect(picker).toBeVisible();
  await clickOutside();
  await expect(picker).toBeHidden();

  // 表情列尾端的「＋」
  await openFromMessage();
  await clickOutside();
  await m.locator('.rx.add').click();
  await expect(picker).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();

  // 已有的表情可以點一下取消
  await m.getByRole('button', { name: /👍\s*1/ }).click();
  await expect(m.getByRole('button', { name: /👍/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('關掉唯讀後：潤色、傳送有 5 秒撤回；撤回把草稿放回輸入框，傳出後訊息下附原稿', async ({ page }) => {
  await openDemo(page, { readOnly: false });
  const box = page.getByRole('textbox', { name: /草稿/ }).last();
  const draft = await box.inputValue();
  expect(draft.length).toBeGreaterThan(0);

  await page.getByRole('button', { name: /潤色成英文/ }).click();
  const review = page.getByRole('region', { name: /草稿審閱/ });
  await review.getByRole('button', { name: /^傳送/ }).click();
  await page.getByRole('button', { name: /撤回/ }).click();
  await expect(box).toHaveValue(draft);

  await page.getByRole('button', { name: /潤色成英文/ }).click();
  await review.getByRole('button', { name: /^傳送/ }).click();
  await expect(page.getByRole('button', { name: /撤回/ })).toBeHidden({ timeout: 8000 });
  await expect(page.locator('.msg.mine').last()).toContainText('你的原稿');
  await expect(page.locator('.msg.mine').last()).toContainText(draft.slice(0, 8));
  // 傳出後輸入框清空
  await expect(box).toHaveValue('');
});

test('設定裡的唯讀開關會立刻生效', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: /^設定/ }).click();
  const ro = page.getByRole('checkbox', { name: /唯讀模式/ });
  await expect(ro).toBeChecked();
  await ro.uncheck();
  await page.getByRole('button', { name: '關閉' }).click();
  const m = msg(page, 'yep, gone from the developer site');
  await m.hover();
  await expect(m.getByRole('button', { name: '新增表情回應' }).first()).toBeVisible();
});

test('英文介面：英文使用者讀中文頻道', async ({ page }) => {
  const errors = watchErrors(page);
  await openDemo(page, { lang: 'en' });
  await expect(page.getByRole('tab', { name: 'Translation' })).toBeVisible();
  await page.getByRole('button', { name: /taipei-office/ }).click();
  // 中文頻道：潤色的目標語言是中文
  await expect(page.getByRole('button', { name: /Polish into .*Chinese/ })).toBeVisible();
  expect(errors).toEqual([]);
});

for (const [lang, word, notWord] of [
  ['zh-CN', '设置', '設定'],
  ['zh-HK', '設定', '设置'],
  ['zh-SG', '设置', '設定'],
] as const) {
  test(`${lang} 介面用該地區的字`, async ({ page }) => {
    await openDemo(page, { lang });
    const settings = page.getByRole('complementary').getByRole('button').filter({ hasText: word });
    await expect(settings.or(page.getByRole('button', { name: new RegExp(word) })).first()).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(`^${notWord}`) })).toHaveCount(0);
  });
}
