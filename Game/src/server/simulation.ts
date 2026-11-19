import { WIDTH, HEIGHT, type MapId, type Settings } from '../shared/protocol.js';
export interface Field { x: number; y: number; sign: number; strength?: number }
const capsule = (x: number, y: number, x1: number, y1: number, x2: number, y2: number, radius: number) => {
  const t = Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / ((x2 - x1) ** 2 + (y2 - y1) ** 2)));
  return radius - Math.hypot(x - x1 - t * (x2 - x1), y - y1 - t * (y2 - y1));
};
function blueFeature(x: number, y: number, map: MapId): number {
  let d = -Infinity;
  const circle = (cx: number, cy: number, r: number) => r - Math.hypot(x - cx, y - cy);
  if (map === 'bridges') {
    d = Math.max(d, capsule(x, y, 91, 28, 126, 28, 2.8), circle(128, 28, 10));
  } else if (map === 'islands') {
    d = Math.max(d, circle(111, 28, 8), capsule(x, y, 90, 66, 114, 66, 3), circle(116, 66, 8));
  } else {
    d = Math.max(d,
      capsule(x, y, 91, 15, 123, 15, 2.5), circle(125, 15, 7),
      capsule(x, y, 91, 55, 117, 55, 3), circle(119, 55, 8), circle(110, 91, 6));
  }
  return d;
}
export class Simulation {
  m = new Float64Array(WIDTH * HEIGHT);
  private next = new Float64Array(WIDTH * HEIGHT);
  private forcing = new Float64Array(WIDTH * HEIGHT);
  constructor(map: MapId = 'bridges') { this.reset(map); }
  reset(map: MapId) {
    // Features override the half-plane; rotating and exchanging colours gives the opponent's features.
    const signs = new Int8Array(this.m.length);
    for (let i = 0; i < this.m.length / 2; i++) {
      const x = i % WIDTH + 0.5, y = Math.floor(i / WIDTH) + 0.5;
      const a = blueFeature(x, y, map), b = blueFeature(WIDTH - x, HEIGHT - y, map);
      const value = a > 0 || b > 0 ? a - b : WIDTH / 2 - x;
      signs[i] = value >= 0 ? 1 : -1;
      signs[this.m.length - 1 - i] = -signs[i];
    }
    const boundary: { x: number; y: number; sign: number }[] = [];
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      const i = y * WIDTH + x, sign = signs[i];
      if ((x > 0 && signs[i - 1] !== sign) || (x < WIDTH - 1 && signs[i + 1] !== sign) ||
          (y > 0 && signs[i - WIDTH] !== sign) || (y < HEIGHT - 1 && signs[i + WIDTH] !== sign)) boundary.push({ x, y, sign });
    }
    // Distance to the nearest opposite-colour boundary cell produces a smooth interface.
    // Explicit paired assignment preserves exact antisymmetry even in floating point.
    for (let i = 0; i < this.m.length / 2; i++) {
      const x = i % WIDTH, y = Math.floor(i / WIDTH);
      let distance2 = Infinity;
      for (const p of boundary) if (p.sign !== signs[i]) distance2 = Math.min(distance2, (p.x - x) ** 2 + (p.y - y) ** 2);
      const v = signs[i] * Math.tanh((Math.sqrt(distance2) - 0.5) / 2);
      this.m[i] = v; this.m[this.m.length - 1 - i] = -v;
    }
  }
  step(seconds: number, settings: Settings, fields: Field[], maxDt = 1 / 240) {
    this.forcing.fill(0);
    const r = settings.fieldRadius;
    for (const f of fields) {
      for (let y = Math.max(0, Math.floor(f.y - r)); y <= Math.min(HEIGHT - 1, Math.ceil(f.y + r)); y++) {
        for (let x = Math.max(0, Math.floor(f.x - r)); x <= Math.min(WIDTH - 1, Math.ceil(f.x + r)); x++) {
          const distance = Math.hypot(x - f.x, y - f.y);
          if (distance < r) this.forcing[y * WIDTH + x] += f.sign * (f.strength ?? settings.fieldStrength) * 0.5 * (1 + Math.cos(Math.PI * distance / r));
        }
      }
    }
    const steps = Math.ceil(seconds / maxDt), dt = seconds / steps;
    const D = 8 * settings.relaxation, a = 4 * settings.relaxation;
    for (let s = 0; s < steps; s++) {
      const m = this.m, n = this.next;
      for (let y = 0; y < HEIGHT; y++) {
        const row = y * WIDTH, up = Math.max(0, y - 1) * WIDTH, down = Math.min(HEIGHT - 1, y + 1) * WIDTH;
        for (let x = 0; x < WIDTH; x++) {
          const i = row + x, v = m[i];
          const lap = (m[row + Math.max(0, x - 1)] + m[row + Math.min(WIDTH - 1, x + 1)]) + (m[up + x] + m[down + x]) - 4 * v;
          n[i] = v + dt * (D * lap + a * (v - v * v * v) + this.forcing[i]);
        }
      }
      this.m = n; this.next = m;
    }
  }
  area(): [number, number] {
    let blue = 0;
    for (const v of this.m) blue += v > 0 ? 1 : v === 0 ? 0.5 : 0;
    return [blue, this.m.length - blue];
  }
  frame(): Uint8Array {
    const frame = new Uint8Array(this.m.length);
    for (let i = 0; i < frame.length; i++) frame[i] = Math.round((Math.max(-1, Math.min(1, this.m[i])) + 1) * 127.5);
    return frame;
  }
}
