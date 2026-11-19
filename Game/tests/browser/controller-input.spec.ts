import { test, expect, type Page } from '@playwright/test';
import type { Snapshot } from '../../src/shared/protocol';
import { selectMode } from './host-menu';

type Finger = { id: number; zone: string; x: number; y: number };
async function touch(page: Page, type: string, active: Finger[], changed: Finger[]) {
  return page.evaluate(({ type, active, changed }) => {
    const convert = (f: Finger) => ({ identifier: f.id, target: document.querySelector(f.zone)!, clientX: f.x, clientY: f.y });
    // Inject complete contact lists to reproduce dropped/retargeted releases.
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { touches: { value: active.map(convert) }, changedTouches: { value: changed.map(convert) } });
    document.dispatchEvent(event);
    return event.defaultPrevented;
  }, { type, active, changed });
}

test('controller: independent fingers, missing releases, cancellation, reset and zoom guards', async ({ page, browser, request }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  let state: Snapshot | undefined;
  page.on('websocket', socket => socket.on('framereceived', event => {
    if (typeof event.payload === 'string') { const msg = JSON.parse(event.payload); if (msg.type === 'state') state = msg.state; }
  }));
  await page.goto('/host');
  await expect(page.locator('#connection-count')).toHaveText(/\d \/ 2/);
  if (await page.locator('#lobby').isEnabled()) await page.locator('#lobby').click();
  await page.locator('#settings-open').click(); await page.locator('#release').click();
  await selectMode(page, 'practice');
  const info = await (await request.get('/api/host-info')).json();
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  const phone = await context.newPage(); phone.on('pageerror', e => errors.push(e.message));
  try {
    await phone.goto(`/controller?room=${info.room}`); await phone.locator('#ready').tap();
    await expect(phone.locator('#phone-overlay')).toBeHidden();
    const move = (await phone.locator('#move-zone').boundingBox())!, button = (await phone.locator('#field-button').boundingBox())!;
    let left: Finger = { id: 11, zone: '#move-zone', x: move.x + move.width / 2, y: move.y + move.height / 2 };
    const right: Finger = { id: 12, zone: '#field-button', x: button.x + button.width / 2, y: button.y + button.height / 2 };
    expect(await touch(phone, 'touchstart', [left], [left])).toBe(true);
    const center = await phone.locator('#stick').evaluate(e => e.style.left);
    await touch(phone, 'touchstart', [left, right], [right]);
    left = { ...left, x: left.x + 35 };
    await touch(phone, 'touchmove', [left, right], [left]);
    await expect.poll(() => state?.players[0].active).toBe(true);
    await expect.poll(() => state?.players[0].x ?? 0).toBeGreaterThan(75);
    expect(await phone.locator('#stick').evaluate(e => e.style.left)).toBe(center);
    // A release arriving on document instead of the button still releases only that hand.
    await touch(phone, 'touchend', [left], [right]);
    await expect(phone.locator('#field-button')).not.toHaveClass(/pressed/);
    await expect(phone.locator('#stick')).toBeVisible();
    await expect.poll(() => state?.players[0].active).toBe(false);
    await touch(phone, 'touchend', [], [left]);
    await expect(phone.locator('#stick')).toBeHidden();
    await phone.waitForTimeout(100); const stopped = state!.players[0].x;
    await phone.waitForTimeout(120); expect(state!.players[0].x).toBe(stopped);
    // Stationary holds remain valid; a toolbar resize does not clear either hand.
    await touch(phone, 'touchstart', [left, right], [left, right]);
    await phone.evaluate(() => window.dispatchEvent(new Event('resize')));
    await phone.waitForTimeout(450);
    await expect(phone.locator('#stick')).toBeVisible(); await expect(phone.locator('#field-button')).toHaveClass(/pressed/);
    // Deliberately omit both releases; the next contact list replaces stale IDs.
    left = { ...left, id: 21, x: left.x - 20 };
    await touch(phone, 'touchstart', [left], [left]);
    await expect(phone.locator('#field-button')).not.toHaveClass(/pressed/);
    await expect(phone.locator('#stick')).toBeVisible();
    expect(await phone.locator('#stick').evaluate(e => e.style.left)).not.toBe(center);
    await touch(phone, 'touchstart', [left, right], [right]);
    await touch(phone, 'touchcancel', [], [left, right]);
    await expect(phone.locator('#stick')).toBeHidden(); await expect(phone.locator('#field-button')).not.toHaveClass(/pressed/);
    await touch(phone, 'touchstart', [left, right], [left, right]);
    await phone.locator('#input-reset').click();
    await expect(phone.locator('#stick')).toBeHidden(); await expect(phone.locator('#field-button')).not.toHaveClass(/pressed/);
    await touch(phone, 'touchmove', [left, right], [left]);
    await expect(phone.locator('#stick')).toBeHidden(); // Reset requires a fresh touch.
    await touch(phone, 'touchend', [], [left, right]);
    await touch(phone, 'touchstart', [left, right], [left, right]);
    await phone.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(phone.locator('#stick')).toBeHidden(); await expect(phone.locator('#field-button')).not.toHaveClass(/pressed/);
    await touch(phone, 'touchend', [], [left, right]);
    // Mouse/pointer fallback also releases when capture was unavailable.
    await phone.evaluate(() => {
      const button = document.querySelector('#field-button') as HTMLElement;
      button.setPointerCapture = () => { throw new DOMException('No active pointer'); };
      button.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 99, pointerType: 'mouse', button: 0, buttons: 1, bubbles: true }));
    });
    await expect(phone.locator('#field-button')).toHaveClass(/pressed/);
    await phone.evaluate(() => document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 99, pointerType: 'mouse', bubbles: true })));
    await expect(phone.locator('#field-button')).not.toHaveClass(/pressed/);
    expect(await phone.evaluate(() => ['gesturestart', 'gesturechange', 'dblclick', 'contextmenu', 'selectstart'].every(type => {
      const event = new Event(type, { bubbles: true, cancelable: true }); document.dispatchEvent(event); return event.defaultPrevented;
    }))).toBe(true);
    await expect(phone.locator('meta[name=viewport]')).toHaveAttribute('content', /maximum-scale=1/);
    expect(errors).toEqual([]);
    await page.locator('#lobby').click(); await selectMode(page, 'battle');
  } finally { await context.close(); }
});
