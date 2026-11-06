import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/server/game.js';
import { DEFAULT_SETTINGS, HZ, IDLE, PLAY_TICKS, RELAX_TICKS, WIDTH } from '../src/shared/protocol.js';
function make(mode: 'battle' | 'practice' = 'battle') {
  const g = new Game(); g.simulation.step = () => {}; g.setup(mode, 'bridges'); g.connect(0);
  if (mode === 'battle') g.connect(1);
  return g;
}
function ticks(g: Game, n: number) { for (let i = 0; i < n; i++) g.tick(); }
function start(g: Game) { g.ready(0); if (g.mode === 'battle') g.ready(1); ticks(g, 3 * HZ); assert.equal(g.phase, 'playing'); }
test('both players must be ready, with a three second countdown', () => {
  const g = make(); g.ready(0); assert.equal(g.phase, 'lobby'); g.ready(1); assert.equal(g.phase, 'countdown');
  ticks(g, 3 * HZ - 1); assert.equal(g.phase, 'countdown'); g.tick(); assert.equal(g.phase, 'playing'); assert.equal(g.elapsedTicks, 0);
});
test('75 seconds of input then 5 seconds of relaxation; exact tie is a draw', () => {
  const g = make(); start(g);
  g.input(0, { x: 1, y: 0, field: true }); ticks(g, PLAY_TICKS - 1); assert.equal(g.phase, 'playing');
  g.tick(); assert.equal(g.phase, 'relaxing'); assert.equal(g.players[0].active, false);
  const x = g.players[0].x; g.input(0, { x: -1, y: 0, field: true }); ticks(g, RELAX_TICKS - 1); assert.equal(g.phase, 'relaxing');
  g.tick(); assert.equal(g.phase, 'finished'); assert.equal(g.players[0].x, x); assert.equal(g.winner, 'draw'); assert.equal(g.snapshot().remaining, 0);
});
test('energy depletes in 3 seconds, held empty stays empty, released recovers in 4', () => {
  const g = make(); start(g); g.input(0, { x: 0, y: 0, field: true }); ticks(g, 3 * HZ);
  assert.ok(g.players[0].energy < 1e-9); ticks(g, HZ); assert.ok(g.players[0].energy < 1e-9); assert.equal(g.players[0].active, false);
  g.input(0, IDLE()); ticks(g, 4 * HZ); assert.ok(Math.abs(g.players[0].energy - 1) < 1e-9);
});
test('both players spend energy when fields overlap', () => {
  const g = make(); start(g); g.players[0].x = g.players[1].x = 96; g.players[0].y = g.players[1].y = 54;
  for (const id of [0, 1] as const) g.input(id, { x: 0, y: 0, field: true }); ticks(g, HZ);
  assert.ok(g.players[0].energy < 1); assert.equal(g.players[0].energy, g.players[1].energy);
});
test('disconnect freezes time/board/energy, clears both inputs, and requires fresh readiness', () => {
  const g = make(); start(g); g.input(0, { x: 1, y: 0, field: true }); ticks(g, HZ); g.disconnect(1);
  assert.equal(g.phase, 'paused'); const before = [g.elapsedTicks, g.players[0].energy, g.players[0].x];
  ticks(g, 3 * HZ); assert.deepEqual([g.elapsedTicks, g.players[0].energy, g.players[0].x], before);
  assert.deepEqual(g.players[0].input, IDLE()); g.ready(0); assert.equal(g.phase, 'paused');
  g.connect(1); g.ready(1); assert.equal(g.phase, 'countdown'); ticks(g, 3 * HZ); assert.equal(g.phase, 'playing'); assert.equal(g.players[0].input.field, false);
});
test('disconnect during initial or resume countdown preserves phase correctly', () => {
  const g = make(); g.ready(0); g.ready(1); ticks(g, 20); g.disconnect(0); assert.equal(g.phase, 'paused');
  g.connect(0); start(g); ticks(g, PLAY_TICKS); assert.equal(g.phase, 'relaxing');
  g.pause(); g.ready(0); g.ready(1); ticks(g, 30); g.disconnect(1); g.connect(1); g.ready(0); g.ready(1); ticks(g, 180); assert.equal(g.phase, 'relaxing');
});
test('practice needs one player, never times out, and supports paused tuning/reset', () => {
  const g = make('practice'); start(g); ticks(g, PLAY_TICKS + RELAX_TICKS + 1); assert.equal(g.phase, 'playing');
  assert.throws(() => g.configure(DEFAULT_SETTINGS)); g.pause(); g.configure({ ...DEFAULT_SETTINGS, fieldRadius: 8 });
  assert.equal(g.settings.fieldRadius, 8); g.resetPractice(); assert.equal(g.elapsedTicks, 0); assert.equal(g.phase, 'paused'); start(g);
});
test('battle parameters cannot be changed even while paused', () => {
  const g = make(); start(g); g.pause(); assert.throws(() => g.configure(DEFAULT_SETTINGS));
  assert.throws(() => g.setup('practice', 'islands')); g.lobby(); g.configure(DEFAULT_SETTINGS); g.setup('practice', 'islands'); assert.equal(g.map, 'islands');
});
test('zero territory is not elimination, and actual area determines winner', () => {
  const g = make(); start(g); g.simulation.m.fill(-1); ticks(g, 10); assert.equal(g.phase, 'playing');
  g.input(0, { x: 0, y: 0, field: true }); g.tick(); assert.equal(g.players[0].active, true);
  ticks(g, PLAY_TICKS + RELAX_TICKS - g.elapsedTicks); assert.equal(g.winner, 1);
});
test('input is bounded, invalid input ignored, and cursors stop at walls', () => {
  const g = make(); start(g); g.input(0, { x: 100, y: 0, field: false }); g.tick(); assert.equal(g.players[0].x, 76);
  g.input(0, { x: NaN, y: 0, field: true }); assert.equal(g.players[0].input.field, false);
  ticks(g, 500); assert.equal(g.players[0].x, WIDTH - 1);
});
