import { createRequire } from 'node:module';
// Resolve from the optional isolated Playwright install (not app dependencies).
const { test, expect } = createRequire(import.meta.url)(process.env.MAI_PLAYWRIGHT_PACKAGE || '@playwright/test');

test.beforeEach(async ({ page }) => {
  // Browser regression NEVER talks to a real account. All account routes are intercepted.
  await page.route('**/api/mcp/status', (route) => route.fulfill({ json: { configured: false, mode: 'demo', liveVerified: false } }));
  await page.route('**/api/mcp', (route) => route.fulfill({ status: 503, json: { error: { code: 'PROFILE_REQUIRED', message: 'Synthetic no-profile failure for UI regression' } } }));
  await page.goto('/');
});

test('demo controls, stale export, receipt, split and history restoration', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByRole('button', { name: '下载点餐小票' })).toBeEnabled();
  await page.getByRole('button', { name: '增加麦辣鸡腿堡', exact: true }).click();
  await expect(page.getByRole('button', { name: '下载点餐小票' })).toBeDisabled();
  await page.getByLabel('用一句话描述点餐需求').fill('3个人，一个麦辣鸡腿堡、一份薯条和一杯可乐，预算60元');
  await page.getByRole('button', { name: '识别点餐需求', exact: true }).click();
  await page.getByRole('button', { name: '算一份刚刚好的方案', exact: true }).click();
  await expect(page.getByRole('button', { name: '下载点餐小票' })).toBeEnabled();
  await page.getByLabel('第 1 位的分摊份额').fill('2');
  const amounts = await page.locator('.split-people strong').allTextContents();
  const total = amounts.reduce((sum, text) => sum + Math.round(Number(text.replace('¥', '')) * 100), 0);
  const integer = await page.locator('.receipt-amount>strong').innerText();
  const decimal = await page.locator('.receipt-amount>.decimals').innerText();
  expect(total).toBe(Math.round(Number(integer + decimal) * 100));
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载点餐小票' }).click();
  expect((await download).suggestedFilename()).toContain('小票');
  await page.getByRole('button', { name: '决策记录', exact: true }).click();
  await expect(page.locator('.history-card')).toHaveCount(1);
  await page.getByRole('button', { name: '再吃一次' }).click();
  await expect(page.getByRole('button', { name: '下载点餐小票' })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('demo-plan.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('budget failure, extras switch and coupon filtering remain explicit', async ({ page }) => {
  await page.locator('#budget').fill('1');
  await page.getByRole('button', { name: '算一份刚刚好的方案', exact: true }).click();
  await expect(page.locator('.budget-status')).toContainText('超出预算');
  const extras = page.getByRole('switch', { name: '允许更便宜的额外商品组合' });
  await extras.click();
  await expect(extras).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: '我的优惠券', exact: true }).click();
  await page.getByRole('button', { name: '到店自取', exact: true }).click();
  await page.getByLabel('搜索优惠券或商品').fill('不可能存在的合成餐品');
  await expect(page.getByText('没有找到符合条件的优惠', { exact: true })).toBeVisible();
});

test('malformed persisted history cannot crash restored rendering', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('mai-just-right.decisions.v1', JSON.stringify([{ id: 'invalid', savedAt: '2026-10-20T00:00:00Z', input: { items: [null], people: 1 }, result: { source: 'demo', best: { totalCents: 1, items: [] }, alternatives: [] } }])));
  await page.reload();
  await page.getByRole('button', { name: '决策记录', exact: true }).click();
  await expect(page.locator('.history-card')).toHaveCount(0);
  await expect(page.getByText('第一份刚刚好，等你来点。', { exact: true })).toBeVisible();
});

test('live missing-profile failure never presents synthetic official results', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: '真实自取核价', exact: true }).click();
  await page.getByLabel('城市或门店关键词').fill('合成查询');
  await page.getByRole('button', { name: '查询门店', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('尚未配置');
  await expect(page.locator('.live-results')).toHaveCount(0);
  await expect(page.locator('.receipt-amount')).toHaveCount(0);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('mock-profile-failure.png'), fullPage: true });
});

test('all navigation screens fit the viewport and expose named controls', async ({ page }, testInfo) => {
  for (const name of ['今天怎么点', '我的优惠券', '决策记录', '真实自取核价', '接入与说明']) {
    await page.getByRole('button', { name, exact: true }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow, `${name} horizontal overflow`).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
  }
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
});
