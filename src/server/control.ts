import {
  CAPTURE_THRESHOLD, CAPTURE_TICKS, CONTROL_POINTS, HEIGHT, HZ, WIDTH,
  type ControlPointView, type ControlView, type PlayerId,
} from '../shared/protocol.js';

// Use the simulation field itself, not quantized display pixels or magnet proximity.
const masks = CONTROL_POINTS.map(point => {
  const cells: number[] = [];
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    if ((x - point.x) ** 2 + (y - point.y) ** 2 <= point.radius ** 2) cells.push(y * WIDTH + x);
  }
  return cells;
});

export class ControlMatch {
  private points: ControlPointView[] = [];
  private claimTicks = [0, 0, 0];
  private scoreTicks: [number, number] = [0, 0];

  constructor() { this.reset(); }

  reset(field?: Float64Array) {
    this.points = CONTROL_POINTS.map(point => ({ ...point, owner: null, claimant: null, progress: 0, coverage: [.5, .5] }));
    this.claimTicks = [0, 0, 0]; this.scoreTicks = [0, 0];
    if (field) this.measure(field);
  }

  private measure(field: Float64Array) {
    this.points.forEach((point, index) => {
      let blue = 0;
      for (const i of masks[index]) blue += field[i] > 0 ? 1 : field[i] === 0 ? .5 : 0;
      point.coverage = [blue / masks[index].length, 1 - blue / masks[index].length];
    });
  }

  tick(field: Float64Array) {
    this.measure(field);
    this.points.forEach((point, index) => {
      const candidate: PlayerId | null = point.coverage[0] >= CAPTURE_THRESHOLD ? 0 : point.coverage[1] >= CAPTURE_THRESHOLD ? 1 : null;
      // A contested or lost point stops scoring immediately. Newly completed captures
      // begin scoring on the following tick, so the qualifying second earns no points.
      if (point.owner !== null && point.owner === candidate) {
        this.scoreTicks[point.owner]++;
        return;
      }
      point.owner = null;
      if (candidate === null) {
        point.claimant = null; point.progress = 0; this.claimTicks[index] = 0;
        return;
      }
      if (point.claimant !== candidate) this.claimTicks[index] = 0;
      point.claimant = candidate;
      this.claimTicks[index]++;
      point.progress = this.claimTicks[index] / CAPTURE_TICKS;
      if (this.claimTicks[index] >= CAPTURE_TICKS) {
        point.owner = candidate; point.claimant = null; point.progress = 0; this.claimTicks[index] = 0;
      }
    });
  }

  winner(): PlayerId | 'draw' {
    return this.scoreTicks[0] === this.scoreTicks[1] ? 'draw' : this.scoreTicks[0] > this.scoreTicks[1] ? 0 : 1;
  }

  snapshot(): ControlView {
    const rates: [number, number] = [0, 0];
    for (const point of this.points) if (point.owner !== null) rates[point.owner]++;
    return {
      points: this.points.map(point => ({ ...point, coverage: [...point.coverage] })),
      scores: [this.scoreTicks[0] / HZ, this.scoreTicks[1] / HZ], rates,
    };
  }
}
