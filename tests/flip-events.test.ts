import test from 'node:test';
import assert from 'node:assert/strict';
import { FlipTracker } from '../src/client/flip-events.js';
import { Game } from '../src/server/game.js';
import { WIDTH, HEIGHT } from '../src/shared/protocol.js';
function fixture() {
  const tracker = new FlipTracker(), state = new Game().snapshot(), frame = new Uint8Array(WIDTH * HEIGHT);
  state.phase = 'playing'; state.players[0].active = true; state.players[0].x = 20; state.players[0].y = 20;
  state.players[1].x = 160; state.players[1].y = 80;
  tracker.observe(frame, state); state.elapsed += 1 / 30;
  return { tracker, state, frame, index: 20 * WIDTH + 20 };
}
test('field-local sign reversal produces count and left/right location', () => {
  const { tracker, state, frame, index } = fixture(); frame[index] = 255; frame[index + 1] = 255;
  const events = tracker.observe(frame, state);
  assert.equal(events.length, 1); assert.equal(events[0].player, 0); assert.equal(events[0].count, 2); assert.ok(events[0].pan < 0);
  assert.deepEqual(tracker.observe(frame, state), []);
});
test('holding a field without reversal and natural changes away from fields are silent', () => {
  const { tracker, state, frame, index } = fixture();
  assert.deepEqual(tracker.observe(frame, state), []);
  frame[90 * WIDTH + 180] = 255; assert.deepEqual(tracker.observe(frame, state), []);
  state.players[0].active = false; frame[index] = 255; assert.deepEqual(tracker.observe(frame, state), []);
});
test('near-zero display jitter does not cause repeated crackles', () => {
  const { tracker, state, frame, index } = fixture();
  for (const value of [125, 128, 127, 132, 129]) { frame[index] = value; assert.deepEqual(tracker.observe(frame, state), []); }
  frame[index] = 145; assert.equal(tracker.observe(frame, state)[0].count, 1);
  for (const value of [127, 130, 128, 140]) { frame[index] = value; assert.deepEqual(tracker.observe(frame, state), []); }
});
test('pause, relaxation, map reset, time reset and reconnect baseline do not make sounds', () => {
  for (const kind of ['paused', 'relaxing', 'map', 'time', 'gap', 'reset']) {
    const { tracker, state, frame, index } = fixture(); frame[index] = 255;
    if (kind === 'paused' || kind === 'relaxing') state.phase = kind;
    if (kind === 'map') state.map = 'islands';
    if (kind === 'time') state.elapsed = -1;
    if (kind === 'gap') state.elapsed = 1;
    if (kind === 'reset') tracker.reset();
    assert.deepEqual(tracker.observe(frame, state), [], kind);
  }
});
test('opposite colour reversals belong to the correct active player', () => {
  const { tracker, state, frame } = fixture(); frame.fill(255); tracker.reset(); tracker.observe(frame, state);
  state.players[1].active = true; frame[80 * WIDTH + 160] = 0;
  const events = tracker.observe(frame, state); assert.equal(events[0].player, 1); assert.ok(events[0].pan > 0);
});
