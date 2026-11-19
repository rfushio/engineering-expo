import { test, expect } from '@playwright/test';
import type { Snapshot } from '../../src/shared/protocol';

test('relief edition: terrain, magnets, view controls and live 2D/3D switching', async ({ page, browser, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let state: Snapshot | undefined;
  page.on('websocket', socket => socket.on('framereceived', event => {
    if (typeof event.payload === 'string') {
      const message = JSON.parse(event.payload); if (message.type === 'state') state = message.state;
    }
  }));
  await page.goto('/host?view=3d');
  await expect(page.locator('#arena-relief')).toBeVisible();
  await expect(page.locator('#view-relief')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#arena')).toBeHidden();
  if (await page.locator('#lobby').isEnabled()) await page.locator('#lobby').click();
  await page.locator('#settings-open').click(); await page.locator('#release').click();
  await page.locator('[data-mode="practice"]').click();
  await page.locator('[data-map="fronts"]').click();
  await expect(page.locator('#map-label')).toHaveText('複数の前線');
  await page.screenshot({ path: testInfo.outputPath('relief-lobby.png'), fullPage: true });
  const info = await (await request.get('/api/host-info')).json();
  const phoneContext = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const phone = await phoneContext.newPage();
  await phone.goto(`/controller?room=${info.room}`);
  await expect(phone.locator('#ready')).toBeVisible(); await phone.locator('#ready').tap();
  await expect(page.locator('#phase-label')).toHaveText('磁場を操作');
  const settings = { ...state!.settings }, elapsed = state!.elapsed;
  await page.locator('#relief-height').evaluate((input: HTMLInputElement) => { input.value = '12'; input.dispatchEvent(new Event('input')); });
  await page.locator('#relief-angle').evaluate((input: HTMLInputElement) => { input.value = '42'; input.dispatchEvent(new Event('input')); });
  await expect(page.locator('#relief-height-value')).toHaveText('12');
  await page.screenshot({ path: testInfo.outputPath('relief-playing.png'), fullPage: true });
  const field = await phone.locator('#field-button').boundingBox();
  await phone.mouse.move(field!.x + field!.width / 2, field!.y + field!.height / 2);
  await phone.mouse.down();
  await expect.poll(() => state?.players[0].active).toBe(true);
  await expect.poll(() => state?.players[0].energy ?? 1).toBeLessThan(.9);
  await page.screenshot({ path: testInfo.outputPath('relief-field-active.png'), fullPage: true });
  await phone.mouse.up();
  await expect.poll(() => state?.players[0].active).toBe(false);
  await page.locator('#view-flat').click();
  await expect(page.locator('#arena')).toBeVisible(); await expect(page.locator('#arena-relief')).toBeHidden();
  await expect(page).not.toHaveURL(/view=3d/);
  await page.locator('#view-relief').click();
  await expect(page.locator('#arena-relief')).toBeVisible();
  await expect(page).toHaveURL(/view=3d/);
  expect(state!.phase).toBe('playing'); expect(state!.elapsed).toBeGreaterThanOrEqual(elapsed); expect(state!.settings).toEqual(settings);
  await page.locator('#lobby').click(); await page.locator('[data-mode="battle"]').click();
  await phoneContext.close();
  expect(errors).toEqual([]);
});

test('WebGL unavailable: keep a working flat view with an explanation', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: any[]) {
      if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
      return (getContext as any).call(this, type, ...args);
    } as typeof getContext;
  });
  await page.goto('/host?view=3d');
  await expect(page.locator('#toast')).toContainText('立体表示を使えません');
  await expect(page.locator('#arena')).toBeVisible();
  await expect(page.locator('#view-flat')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#connection-count')).toHaveText(/\d \/ 2/);
});
