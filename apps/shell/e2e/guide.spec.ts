// 貼上引導卡（?guide 是瀏覽器預覽用的假資料，見 src/main.ts 的 GUIDE_PREVIEW）。
// 每項資訊只能出現一次：要貼的文字、目的地、每個按鍵。
import { test, expect } from '@playwright/test';

const FIRST_LINE = 'same here, the green on my sample looks darker';

test('完整版：文字、目的地、⌘V、Return 各出現一次', async ({ page }) => {
  await page.goto('/?guide');
  const card = page.locator('section.guide');
  await expect(card).toBeVisible();
  await expect(card.getByText(FIRST_LINE)).toHaveCount(1);
  await expect(card.getByText('product', { exact: true })).toHaveCount(1);
  await expect(card.locator('kbd', { hasText: '⌘ V' })).toHaveCount(1);
  await expect(card.locator('kbd', { hasText: 'Return' })).toHaveCount(1);
  await expect(card.locator('ol > li')).toHaveCount(3);
  await expect(card.getByRole('button', { name: '再複製一次' })).toBeVisible();
});

test('對話串：第一步說要打開對話串', async ({ page }) => {
  await page.goto('/?guide&thread');
  const card = page.locator('section.guide');
  await expect(card.locator('ol > li').first()).toContainText('對話串');
  await expect(card.getByText(FIRST_LINE)).toHaveCount(1);
});

test('熟手版：不教步驟，只留目的地和文字', async ({ page }) => {
  await page.goto('/?guide&compact');
  const card = page.locator('section.guide');
  await expect(card.locator('ol')).toHaveCount(0);
  await expect(card.getByText(FIRST_LINE, { exact: false })).toHaveCount(1);
  await expect(card.getByText('product', { exact: true })).toHaveCount(1);
});
