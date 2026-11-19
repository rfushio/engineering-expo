import { selectMode } from './host-menu';
import { test, expect } from '@playwright/test';
import { WebSocket } from 'ws';
import type { Snapshot } from '../../src/shared/protocol';

test('sound: opt in, actual field reversal, mute and preview', async ({ page, request }) => {
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    const probe = { contexts: [] as AudioContext[], starts: 0 };
    (window as any).__audioProbe = probe;
    (window as any).AudioContext = function (...args: any[]) {
      const context = new Original(...args); probe.contexts.push(context);
      const create = context.createBufferSource.bind(context);
      context.createBufferSource = () => {
        const source = create(), start = source.start.bind(source);
        source.start = (...values: Parameters<typeof start>) => { probe.starts++; start(...values); };
        return source;
      };
      return context;
    };
  });
  await page.goto('/host');
  if (await page.locator('#lobby').isEnabled()) await page.locator('#lobby').click();
  await page.locator('#settings-open').click(); await page.locator('#release').click();
  await selectMode(page, 'practice'); await page.locator('[data-map="bridges"]').click();
  expect(await page.evaluate(() => (window as any).__audioProbe.contexts.length)).toBe(0);
  await page.locator('#sound-toggle').click(); await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (window as any).__audioProbe.contexts[0].state)).toBe('running');
  const info = await (await request.get('/api/host-info')).json();
  const ws = new WebSocket('ws://localhost:3108/ws');
  let state: Snapshot | undefined;
  let input = { x: 0, y: 0, field: false };
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    ws.on('message', (data, binary) => { if (!binary) { const message = JSON.parse(data.toString()); if (message.type === 'state') state = message.state; } });
    await new Promise<void>(resolve => ws.on('open', resolve));
    ws.send(JSON.stringify({ type: 'hello', role: 'controller', room: info.room }));
    timer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', ...input })); }, 30);
    await expect.poll(() => state?.players[0].connected).toBe(true);
    ws.send(JSON.stringify({ type: 'ready' })); await expect(page.locator('#phase-label')).toHaveText('磁場を操作');
    // Applying a field inside one's own territory must not play a button-press sound.
    input = { x: 0, y: 0, field: true };
    await expect.poll(() => state?.players[0].energy ?? 1).toBeLessThan(.85);
    expect(await page.evaluate(() => (window as any).__audioProbe.starts)).toBe(0);
    input = { x: 1, y: 0, field: false };
    await expect.poll(() => state?.players[0].x ?? 0).toBeGreaterThan(150);
    input = { x: 0, y: 0, field: true };
    await expect.poll(() => page.evaluate(() => (window as any).__audioProbe.starts)).toBeGreaterThan(0);
    await page.locator('#sound-toggle').click();
    await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'false');
    const starts = await page.evaluate(() => (window as any).__audioProbe.starts);
    await expect.poll(() => state?.players[0].energy ?? 1).toBeLessThan(.65);
    expect(await page.evaluate(() => (window as any).__audioProbe.starts)).toBe(starts);
    await page.locator('#lobby').click();
    await page.locator('#sound-preview').click();
    await expect.poll(() => page.evaluate(() => (window as any).__audioProbe.starts)).toBeGreaterThan(starts);
    await page.locator('#sound-volume').evaluate((input: HTMLInputElement) => { input.value = '0'; input.dispatchEvent(new Event('input')); });
    await page.locator('#sound-toggle').click();
    await selectMode(page, 'battle');
  } finally { clearInterval(timer); ws.close(); }
});
