import { WIDTH, HEIGHT, type PlayerId, type Snapshot } from '../shared/protocol';

export interface FlipEvent { player: PlayerId; count: number; pan: number }

/** Detect visible sign reversals near an active player's field, not area drift elsewhere. */
export class FlipTracker {
  private signs = new Int8Array(WIDTH * HEIGHT);
  private initialized = false;
  private map = '';
  private elapsed = 0;

  reset() { this.initialized = false; }

  observe(frame: Uint8Array, state: Snapshot): FlipEvent[] {
    if (frame.length !== this.signs.length) { this.reset(); return []; }
    const counts = [0, 0], xs = [0, 0];
    const continuous = this.initialized && this.map === state.map && state.elapsed >= this.elapsed && state.elapsed - this.elapsed < .3;
    const audible = continuous && state.phase === 'playing';
    for (let i = 0; i < frame.length; i++) {
      // Hysteresis around zero suppresses repeated clicks from near-zero quantization/jitter.
      const sign = frame[i] >= 138 ? 1 : frame[i] <= 117 ? -1 : 0;
      const previous = this.signs[i];
      if (audible && sign && previous && sign !== previous) {
        const player: PlayerId = sign > 0 ? 0 : 1;
        const p = state.players[player], x = i % WIDTH, y = Math.floor(i / WIDTH);
        if (p.active && state.participants.includes(player) && (x - p.x) ** 2 + (y - p.y) ** 2 < state.settings.fieldRadius ** 2) {
          counts[player]++; xs[player] += x;
        }
      }
      if (!continuous || state.phase !== 'playing') this.signs[i] = sign;
      else if (sign) this.signs[i] = sign;
    }
    this.initialized = true; this.map = state.map; this.elapsed = state.elapsed;
    return ([0, 1] as const).filter(id => counts[id] > 0).map(id => ({
      player: id, count: counts[id], pan: (xs[id] / counts[id] / (WIDTH - 1) * 2 - 1) * .75,
    }));
  }
}
