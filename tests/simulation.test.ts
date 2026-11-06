import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/server/simulation.js';
import { DEFAULT_SETTINGS as S, HEIGHT, MAPS, WIDTH, validateSettings } from '../src/shared/protocol.js';
function island(radius = 8) {
  const sim = new Simulation();
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) sim.m[y * WIDTH + x] = Math.tanh((radius - Math.hypot(x - (WIDTH - 1) / 2, y - (HEIGHT - 1) / 2)) / 2);
  return sim;
}
function evolve(sim: Simulation, seconds: number, maxDt = 1 / 240) {
  for (let i = 0; i < seconds * 60; i++) sim.step(1 / 60, S, [], maxDt);
}
for (const map of MAPS) test(`${map.id}: equal initial area and colour/rotation symmetry through evolution`, () => {
  const sim = new Simulation(map.id);
  assert.deepEqual(sim.area(), [WIDTH * HEIGHT / 2, WIDTH * HEIGHT / 2]);
  evolve(sim, 1);
  for (let i = 0; i < sim.m.length; i++) assert.ok(Math.abs(sim.m[i] + sim.m[sim.m.length - 1 - i]) < 1e-12);
  assert.deepEqual(sim.area(), [WIDTH * HEIGHT / 2, WIDTH * HEIGHT / 2]);
});
test('island shrinks over seconds; halving time step retains area trajectory', () => {
  const a = island(), b = island();
  const initial = a.area()[0];
  for (let s = 1; s <= 4; s++) {
    const before = a.area()[0]; evolve(a, 1); evolve(b, 1, 1 / 480);
    assert.ok(a.area()[0] < before || before === 0);
    assert.ok(Math.abs(a.area()[0] - b.area()[0]) <= 4);
    if (s === 2) assert.ok(a.area()[0] > 0 && a.area()[0] < initial * .6);
  }
  assert.equal(a.area()[0], 0);
});
test('local field reverses uniform background, consistent at half time step', () => {
  const a = new Simulation(), b = new Simulation(); a.m.fill(-1); b.m.fill(-1);
  const fields = [{ x: 95.5, y: 53.5, sign: 1 }];
  for (let n = 0; n < 60; n++) { a.step(1 / 60, S, fields); b.step(1 / 60, S, fields, 1 / 480); }
  const center = 54 * WIDTH + 96;
  assert.ok(a.m[center] > 0); assert.ok(a.area()[0] > 0); assert.ok(a.area()[0] < Math.PI * S.fieldRadius ** 2);
  assert.ok(Math.abs(a.m[center] - b.m[center]) < .03);
});
test('equal opposite fields cancel but natural relaxation continues', () => {
  const a = island(), b = island(); const initial = a.area()[0];
  for (let n = 0; n < 60; n++) {
    a.step(1 / 60, S, [{ x: 96, y: 54, sign: 1 }, { x: 96, y: 54, sign: -1 }]);
    b.step(1 / 60, S, []);
  }
  assert.deepEqual(a.m, b.m); assert.ok(a.area()[0] < initial);
});
test('walls do not wrap and constant phases are stationary without fields', () => {
  const a = new Simulation(); a.m.fill(1); evolve(a, 1); assert.ok(a.m.every(x => x === 1));
  a.m.fill(-1); a.step(1 / 60, S, [{ x: 0, y: 50, sign: 1 }]);
  assert.ok(a.m[50 * WIDTH] > -1); assert.equal(a.m[50 * WIDTH + WIDTH - 1], -1);
});
test('area comes from the unrounded field, exact zeros split equally', () => {
  const a = new Simulation(); a.m.fill(-1); a.m[0] = 1e-10; a.m[1] = 0;
  assert.equal(a.area()[0], 1.5);
});
test('allowed parameter extremes stay finite; invalid settings rejected', () => {
  for (const relaxation of [.25, 2]) {
    const a = new Simulation();
    for (let n = 0; n < 180; n++) a.step(1 / 60, { ...S, relaxation, fieldStrength: 20, fieldRadius: 14 }, [{ x: 96, y: 54, sign: 1 }]);
    assert.ok(a.m.every(x => Number.isFinite(x) && Math.abs(x) < 3));
  }
  assert.equal(validateSettings({ ...S, relaxation: 10 }), null);
  assert.equal(validateSettings({ ...S, fieldStrength: NaN }), null);
});
function blueComponent(sim: Simulation, x: number, y: number) {
  const root = y * WIDTH + x;
  if (sim.m[root] <= 0) return { area: 0, body: false };
  const queue = [root], seen = new Uint8Array(WIDTH * HEIGHT); seen[root] = 1;
  let body = false;
  for (let n = 0; n < queue.length; n++) {
    const i = queue[n], px = i % WIDTH, py = Math.floor(i / WIDTH);
    if (px < 70) body = true;
    for (const j of [px > 0 ? i - 1 : -1, px < WIDTH - 1 ? i + 1 : -1, py > 0 ? i - WIDTH : -1, py < HEIGHT - 1 ? i + WIDTH : -1]) {
      if (j >= 0 && !seen[j] && sim.m[j] > 0) { seen[j] = 1; queue.push(j); }
    }
  }
  return { area: queue.length, body };
}
test('bridge map: a one-second cut creates a shrinking island; a three-second sweep reconnects it', () => {
  const cut = new Simulation('bridges'); assert.equal(blueComponent(cut, 127, 27).body, true);
  for (let n = 0; n < 60; n++) cut.step(1 / 60, S, [{ x: 109, y: 27, sign: -1 }]);
  const separated = blueComponent(cut, 127, 27); assert.equal(separated.body, false); assert.ok(separated.area > 200);
  const rescued = new Simulation(); rescued.m.set(cut.m);
  for (let n = 0; n < 180; n++) {
    cut.step(1 / 60, S, []);
    rescued.step(1 / 60, S, [{ x: 100 + 18 * n / 179, y: 27, sign: 1 }]);
  }
  assert.equal(blueComponent(cut, 127, 27).body, false); assert.ok(blueComponent(cut, 127, 27).area < separated.area);
  assert.equal(blueComponent(rescued, 127, 27).body, true);
});
test('island map starts disconnected and allows a two-second reconnection; fronts has separated sites', () => {
  const island = new Simulation('islands'); assert.equal(blueComponent(island, 110, 27).body, false); assert.ok(blueComponent(island, 110, 27).area > 150);
  for (let n = 0; n < 120; n++) island.step(1 / 60, S, [{ x: 100, y: 27, sign: 1 }]);
  assert.equal(blueComponent(island, 110, 27).body, true);
  const fronts = new Simulation('fronts');
  assert.equal(blueComponent(fronts, 124, 14).body, true); assert.equal(blueComponent(fronts, 118, 54).body, true);
  assert.equal(blueComponent(fronts, 109, 90).body, false); assert.ok(blueComponent(fronts, 109, 90).area > 50);
});
test('a full-speed field sweep creates territory that remains one second after release', () => {
  const sim = new Simulation(); sim.m.fill(-1);
  for (let n = 0; n < 60; n++) sim.step(1 / 60, S, [{ x: 60 + S.cursorSpeed * n / 60, y: 53.5, sign: 1 }]);
  const painted = sim.area()[0];
  assert.ok(painted >= 200, `sweep created only ${painted} cells`);
  evolve(sim, 1);
  assert.ok(sim.area()[0] >= 100, 'territory disappeared too quickly after release');
  assert.ok(sim.area()[0] < painted, 'natural relaxation should still shrink the new territory');
});
