import { test, expect, type Page } from '@playwright/test';
import type { Snapshot } from '../../src/shared/protocol';

async function moveTo(phone: Page, getState: () => Snapshot, x: number, y: number) {
  const box = (await phone.locator('#move-zone').boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2, radius = Math.min(55, box.height * .23);
  await phone.mouse.move(cx, cy); await phone.mouse.down();
  try {
    for (let n = 0; n < 70; n++) {
      const p = getState().players[0], dx = x - p.x, dy = y - p.y, distance = Math.hypot(dx, dy);
      if (distance < 1.5) return;
      const fraction = .12 + .88 * Math.min(1, distance / 8);
      await phone.mouse.move(cx + dx / distance * radius * fraction, cy + dy / distance * radius * fraction);
      await phone.waitForTimeout(50);
    }
    throw new Error('Controller did not reach the capture point');
  } finally { await phone.mouse.up(); }
}

test('control mode: two phones capture, score, pause, render in 3D and complete the match', async ({ browser, page, request, browserName }, testInfo) => {
  test.setTimeout(125000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let state: Snapshot | undefined;
  page.on('websocket', socket => socket.on('framereceived', event => {
    if (typeof event.payload === 'string') { const message = JSON.parse(event.payload); if (message.type === 'state') state = message.state; }
  }));
  await page.goto('/host');
  await expect(page.locator('#connection-count')).toHaveText(/\d \/ 2/);
  if (await page.locator('#lobby').isEnabled()) await page.locator('#lobby').click();
  await page.locator('#settings-open').click(); await page.locator('#release').click();
  await page.locator('[data-mode="control"]').click();
  await expect(page.locator('#control-panel')).toBeVisible(); await expect(page.locator('#time')).toHaveText('90秒');
  await expect(page.locator('[data-map="islands"]')).toBeDisabled();
  await expect(page.locator('#score-unit-0')).toHaveText('点');
  await page.screenshot({ path: testInfo.outputPath('control-lobby.png'), fullPage: true });
  const info = await (await request.get('/api/host-info')).json();
  const contexts = await Promise.all([0, 1].map(() => browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true })));
  try {
    const a = await contexts[0].newPage(), b = await contexts[1].newPage();
    for (const phone of [a, b]) {
      phone.on('pageerror', error => errors.push(error.message));
      await phone.goto(`/controller?room=${info.room}`); await expect(phone.locator('#ready')).toBeVisible();
    }
    await a.locator('#ready').tap(); await expect(a.locator('#ready')).toBeDisabled();
    await expect(page.locator('#phase-label')).toHaveText('接続待ち');
    await b.locator('#ready').tap(); await expect(page.locator('#phase-label')).toHaveText('拠点争奪');
    await expect(page.locator('#control-status-A')).toHaveText('P1 が保持');
    await expect(page.locator('#control-status-C')).toHaveText('P2 が保持');
    await expect(page.locator('#control-status-B')).toHaveText('中立');
    await moveTo(a, () => state!, 95.5, 53.5);
    const field = (await a.locator('#field-button').boundingBox())!;
    await a.mouse.move(field.x + field.width / 2, field.y + field.height / 2); await a.mouse.down();
    await expect(page.locator('#control-status-B')).toHaveText('P1 が保持');
    await expect.poll(() => state!.control!.scores[0] - state!.control!.scores[1]).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath('control-capture-flat.png'), fullPage: true });
    await a.mouse.up();
    await page.setViewportSize({ width: 1440, height: 800 });
    expect((await page.locator('#pause').boundingBox())!.y + (await page.locator('#pause').boundingBox())!.height).toBeLessThanOrEqual(800);
    await page.screenshot({ path: testInfo.outputPath('control-compact.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(a.locator('#phone-point-B')).toHaveText('B · P1');
    await a.screenshot({ path: testInfo.outputPath('control-phone.png') });
    await page.locator('#pause').click(); await expect(page.locator('#phase-label')).toHaveText('一時停止');
    const paused = structuredClone(state!.control), time = state!.elapsed;
    await page.waitForTimeout(300); expect(state!.control).toEqual(paused); expect(state!.elapsed).toEqual(time);
    await page.locator('#view-relief').click(); await expect(page.locator('#arena-relief')).toBeVisible();
    await a.locator('#ready').tap(); await b.locator('#ready').tap(); await expect(page.locator('#phase-label')).toHaveText('拠点争奪');
    expect((await page.locator('#pause').boundingBox())!.y + (await page.locator('#pause').boundingBox())!.height).toBeLessThanOrEqual(1000);
    await page.screenshot({ path: testInfo.outputPath('control-relief.png'), fullPage: true });
    if (browserName === 'chromium') {
      // Exercise the actual 90-second server clock and result UI, not an injected snapshot.
      await expect(page.locator('#phase-label')).toHaveText('試合終了', { timeout: 100000 });
      expect(state!.elapsed).toBe(90); expect(state!.control!.scores[0]).toBeGreaterThan(state!.control!.scores[1]);
      expect(state!.winner).toBe(0); await expect(page.locator('#overlay-title')).toHaveText('P1 の勝ち！');
      await expect(page.locator('#overlay-body')).toContainText('点'); await expect(a.locator('#phone-title')).toHaveText('あなたの勝ち！');
      await page.screenshot({ path: testInfo.outputPath('control-result.png'), fullPage: true });
      await page.locator('#rematch').click();
    } else await page.locator('#lobby').click();
    await expect(page.locator('#area-0')).toHaveText('0.0'); await expect(page.locator('#control-status-B')).toHaveText('中立');
    await page.locator('[data-mode="battle"]').click(); await expect(page.locator('#control-panel')).toBeHidden();
    await expect(page.locator('#score-unit-0')).toHaveText('%'); await expect(page.locator('#time')).toHaveText('80秒');
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
