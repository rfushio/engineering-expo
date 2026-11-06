import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlMatch } from '../src/server/control.js';
import { Game } from '../src/server/game.js';
import { Simulation } from '../src/server/simulation.js';
import { CONTROL_POINTS, CONTROL_TICKS, DEFAULT_SETTINGS, HEIGHT, HZ, WIDTH } from '../src/shared/protocol.js';

const cells = CONTROL_POINTS.map(p => Array.from({ length: WIDTH * HEIGHT }, (_, i) => i).filter(i => (i % WIDTH - p.x) ** 2 + (Math.floor(i / WIDTH) - p.y) ** 2 <= p.radius ** 2));
function paint(field: Float64Array, id: number, sign: number) { for (const i of cells[id]) field[i] = sign; }
function advance(match: ControlMatch, field: Float64Array, ticks: number) { for (let i = 0; i < ticks; i++) match.tick(field); }
function step(game: Game, ticks: number) { for (let i = 0; i < ticks; i++) game.tick(); }
function startGame() {
  const game = new Game(); game.setup('control', 'fronts'); game.connect(0); game.connect(1);
  game.ready(0); game.ready(1); step(game, 3 * HZ); return game;
}

test('three fixed symmetric points start neutral, regardless of their underlying colour', () => {
  const match = new ControlMatch(), sim = new Simulation('bridges'); match.reset(sim.m);
  const state = match.snapshot();
  assert.equal(state.points.length, 3); assert.ok(state.points.every(p => p.owner === null && p.progress === 0));
  assert.deepEqual(state.scores, [0, 0]);
  assert.equal(state.points[0].coverage[0], state.points[2].coverage[1]); assert.equal(state.points[1].coverage[0], .5);
  assert.equal(CONTROL_POINTS[0].x + CONTROL_POINTS[2].x, WIDTH - 1);
  assert.equal(CONTROL_POINTS[0].y + CONTROL_POINTS[2].y, HEIGHT - 1);
});
test('one full qualifying second earns capture, then one point per held second', () => {
  const match = new ControlMatch(), field = new Float64Array(WIDTH * HEIGHT); paint(field, 0, 1);
  advance(match, field, 59); assert.equal(match.snapshot().points[0].owner, null); assert.equal(match.snapshot().points[0].progress, 59 / 60);
  match.tick(field); assert.equal(match.snapshot().points[0].owner, 0); assert.deepEqual(match.snapshot().scores, [0, 0]);
  advance(match, field, 60); assert.deepEqual(match.snapshot().scores, [1, 0]);
});
test('threshold uses raw signs; below 60% immediately stops scoring', () => {
  const match = new ControlMatch(), field = new Float64Array(WIDTH * HEIGHT); paint(field, 0, -1);
  const needed = Math.ceil(cells[0].length * .6);
  for (const i of cells[0].slice(0, needed)) field[i] = 1e-12;
  advance(match, field, 120); assert.equal(match.snapshot().points[0].owner, 0); assert.equal(match.snapshot().scores[0], 1);
  field[cells[0][needed - 1]] = -1e-12;
  match.tick(field); assert.equal(match.snapshot().points[0].owner, null); assert.equal(match.snapshot().scores[0], 1);
  assert.deepEqual(match.snapshot().rates, [0, 0]);
});
test('interrupted claims restart and opposing players must also qualify for one second', () => {
  const match = new ControlMatch(), field = new Float64Array(WIDTH * HEIGHT); paint(field, 0, 1);
  advance(match, field, 59); paint(field, 0, 0); match.tick(field);
  paint(field, 0, 1); advance(match, field, 59); assert.equal(match.snapshot().points[0].owner, null);
  match.tick(field); assert.equal(match.snapshot().points[0].owner, 0);
  paint(field, 0, -1); match.tick(field); assert.equal(match.snapshot().points[0].owner, null); assert.equal(match.snapshot().points[0].claimant, 1);
  advance(match, field, 58); assert.equal(match.snapshot().points[0].owner, null);
  match.tick(field); assert.equal(match.snapshot().points[0].owner, 1);
});
test('multiple held points add rates without rounding cumulative scores', () => {
  const match = new ControlMatch(), field = new Float64Array(WIDTH * HEIGHT);
  paint(field, 0, 1); paint(field, 1, 1); paint(field, 2, -1); advance(match, field, 120);
  assert.deepEqual(match.snapshot().rates, [2, 1]); assert.deepEqual(match.snapshot().scores, [2, 1]); assert.equal(match.winner(), 0);
});
test('control requires two players, fixes the bridge map and ends at 90 seconds without relaxation', () => {
  const game = new Game(); game.setup('control', 'islands'); assert.equal(game.map, 'bridges');
  game.connect(0); game.ready(0); assert.equal(game.phase, 'lobby'); assert.deepEqual(game.participants, [0, 1]);
  game.connect(1); game.ready(1); step(game, 180); assert.equal(game.phase, 'playing');
  game.simulation.step = () => {}; game.simulation.m.fill(0);
  step(game, CONTROL_TICKS - 1); assert.equal(game.phase, 'playing'); assert.equal(game.snapshot().remaining, 1 / HZ);
  game.tick(); assert.equal(game.phase, 'finished'); assert.equal(game.snapshot().remaining, 0); assert.equal(game.winner, 'draw');
  const before = game.snapshot(); step(game, 100); assert.deepEqual(game.snapshot(), before);
});
test('score wins even when the winner has much less total territory', () => {
  const game = startGame(); game.simulation.step = () => {}; game.simulation.m.fill(-1);
  paint(game.simulation.m, 0, 1); paint(game.simulation.m, 1, 1);
  step(game, CONTROL_TICKS);
  assert.ok(game.simulation.area()[0] < game.simulation.area()[1]); assert.equal(game.winner, 0);
  assert.deepEqual(game.snapshot().control!.scores, [178, 89]);
});
test('pause and reconnect freeze capture progress, scoring and time; rematch clears them', () => {
  const game = startGame(); game.simulation.step = () => {}; game.simulation.m.fill(0); paint(game.simulation.m, 0, 1);
  step(game, 30); game.disconnect(1);
  const before = game.snapshot(); step(game, 120);
  assert.deepEqual(game.snapshot().control, before.control); assert.equal(game.elapsedTicks, 30);
  game.connect(1); game.ready(0); game.ready(1); step(game, 180);
  assert.deepEqual(game.snapshot().control, before.control);
  step(game, 30); assert.equal(game.snapshot().control!.points[0].owner, 0);
  step(game, 60); assert.equal(game.snapshot().control!.scores[0], 1);
  game.pause(); assert.throws(() => game.configure(DEFAULT_SETTINGS)); game.lobby();
  assert.deepEqual(game.snapshot().control!.scores, [0, 0]); assert.ok(game.snapshot().control!.points.every(p => p.owner === null));
  game.setup('battle', 'fronts'); assert.equal(game.snapshot().control, null); assert.equal(game.map, 'fronts');
});
test('a real field can capture the neutral centre within one full energy charge', () => {
  const game = startGame();
  game.players[0].x = CONTROL_POINTS[1].x; game.players[0].y = CONTROL_POINTS[1].y;
  game.input(0, { x: 0, y: 0, field: true }); step(game, 3 * HZ);
  assert.equal(game.snapshot().control!.points[1].owner, 0); assert.ok(game.snapshot().control!.scores[0] > 0);
});
