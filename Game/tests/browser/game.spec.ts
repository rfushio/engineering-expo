import { selectMode } from './host-menu';
import { test, expect, type Browser, type Page } from '@playwright/test';
import type { Snapshot } from '../../src/shared/protocol';
async function reset(host: Page) {
  await host.goto('/host');
  await expect(host.locator('#connection-count')).toHaveText(/\d \/ 2/);
  if (await host.locator('#lobby').isEnabled()) await host.locator('#lobby').click();
  await host.locator('#settings-open').click(); await host.locator('#release').click();
  await expect(host.locator('#connection-count')).toHaveText('0 / 2');
}
async function phone(browser: Browser, room: string) {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto(`/controller?room=${room}`);
  await expect(page.locator('#phone-title')).toHaveText('準備はいい？');
  return { context, page };
}
test('two phones: readiness, touch input, release, disconnect/rejoin and reset', async ({ browser, page, request, browserName }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let latestState: Snapshot | undefined;
  page.on('websocket', socket => socket.on('framereceived', event => {
    if (typeof event.payload === 'string') { const message = JSON.parse(event.payload); if (message.type === 'state') latestState = message.state; }
  }));
  await reset(page); await selectMode(page, 'battle');
  const info = await (await request.get('/api/host-info')).json();
  const a = await phone(browser, info.room), b = await phone(browser, info.room);
  a.page.on('pageerror', error => errors.push(error.message)); b.page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('#connection-count')).toHaveText('2 / 2');
  await page.screenshot({ path: testInfo.outputPath('host-lobby.png'), fullPage: true });
  await a.page.locator('#ready').tap(); await b.page.locator('#ready').tap();
  await expect(a.page.locator('#phone-overlay')).toBeHidden(); await expect(page.locator('#phase-label')).toHaveText('磁場を操作');
  await a.page.screenshot({ path: testInfo.outputPath('controller-playing.png') });
  if (browserName === 'chromium') {
    const cdp = await a.context.newCDPSession(a.page);
    const zone = await a.page.locator('#move-zone').boundingBox(), field = await a.page.locator('#field-button').boundingBox();
    const x = zone!.x + zone!.width * .4, y = zone!.y + zone!.height * .6;
    const fx = field!.x + field!.width / 2, fy = field!.y + field!.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 45, y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x + 45, y, id: 1 }, { x: fx, y: fy, id: 2 }] });
    await expect(a.page.locator('#field-button')).toHaveClass(/pressed/);
    await expect(a.page.locator('#phone-energy-text')).not.toHaveText('100%');
    await expect.poll(() => latestState?.players[0].x ?? 0).toBeGreaterThan(75);
    await a.page.screenshot({ path: testInfo.outputPath('controller-touch.png') });
    const origin = await a.page.locator('#stick').evaluate(el => el.style.left);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fx - 20, y, id: 1 }, { x: fx, y: fy, id: 2 }] });
    expect(await a.page.locator('#stick').evaluate(el => el.style.left)).toEqual(origin);
    await expect(a.page.locator('#field-button')).toHaveClass(/pressed/);
    // Real browser contacts: releasing either hand must leave the other working.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: fx, y: fy, id: 2 }] });
    await expect(a.page.locator('#field-button')).not.toHaveClass(/pressed/);
    await expect(a.page.locator('#stick')).toBeVisible();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fx - 20, y, id: 1 }, { x: fx, y: fy, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: fx - 20, y, id: 1 }] });
    await expect(a.page.locator('#stick')).toBeHidden();
    await expect(a.page.locator('#field-button')).toHaveClass(/pressed/);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(a.page.locator('#stick')).toBeHidden(); await expect(a.page.locator('#field-button')).not.toHaveClass(/pressed/);
    await expect(a.page.locator('#phone-energy-text')).toHaveText('100%');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }, { x: fx, y: fy, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect(a.page.locator('#stick')).toBeHidden();
    await expect(a.page.locator('#field-button')).not.toHaveClass(/pressed/);
    // A pinch across both play zones and repeated tapping must not zoom the page.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 3 }, { x: fx, y: fy, id: 4 }] });
    for (let n = 1; n <= 5; n++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - n * 12, y, id: 3 }, { x: fx + n * 10, y: fy, id: 4 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await a.page.locator('#field-button').tap(); await a.page.locator('#field-button').tap();
    expect(await a.page.evaluate(() => visualViewport?.scale)).toBe(1);
    await expect(a.page.locator('#field-button')).not.toHaveClass(/pressed/);
  } else {
    await a.page.locator('#field-button').tap();
    await expect(a.page.locator('#field-button')).not.toHaveClass(/pressed/);
  }
  await page.screenshot({ path: testInfo.outputPath('host-playing.png'), fullPage: true });
  await a.page.reload();
  await expect(page.locator('#phase-label')).toHaveText('一時停止');
  await expect(a.page.locator('#phone-player')).toHaveText('P1');
  await a.page.locator('#ready').tap(); await b.page.locator('#ready').tap();
  await expect(page.locator('#phase-label')).toHaveText('磁場を操作');
  await page.locator('#pause').click(); await expect(a.page.locator('#phone-title')).toHaveText('試合を一時停止しています');
  await page.locator('#lobby').click(); await expect(page.locator('#phase-label')).toHaveText('接続待ち');
  expect(errors).toEqual([]); await a.context.close(); await b.context.close();
});
test('practice: one phone, tuning, reset, swap and rotation guidance', async ({ browser, page, request }) => {
  await reset(page); await selectMode(page, 'practice');
  await page.locator('[data-map="islands"]').click();
  const info = await (await request.get('/api/host-info')).json(); const a = await phone(browser, info.room);
  await a.page.locator('#ready').tap(); await expect(a.page.locator('#phone-overlay')).toBeHidden();
  await a.page.locator('#swap').tap(); await expect(a.page.locator('.phone-controls')).toHaveClass(/swapped/);
  await page.locator('#pause').click(); await page.locator('#settings-open').click();
  await page.locator('input[name="fieldRadius"]').fill('9'); await page.locator('#settings-save').click();
  await expect(page.locator('#field-label')).toHaveText('磁場半径 9');
  await page.locator('#practice-reset').click();
  await a.page.locator('#ready').tap(); await expect(page.locator('#phase-label')).toHaveText('磁場を操作');
  await a.page.setViewportSize({ width: 390, height: 844 }); await expect(a.page.locator('.rotate-overlay')).toBeVisible();
  await expect(page.locator('#phase-label')).toHaveText('一時停止');
  await a.page.setViewportSize({ width: 844, height: 390 }); await expect(a.page.locator('.rotate-overlay')).toBeHidden();
  await page.locator('#lobby').click();
  await page.locator('#settings-open').click(); await page.locator('#defaults').click(); await page.locator('#settings-save').click();
  await selectMode(page, 'battle'); await a.context.close();
});
