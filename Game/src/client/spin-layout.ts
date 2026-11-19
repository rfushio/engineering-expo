import { HEIGHT, WIDTH } from '../shared/protocol';

export function spinLayout(value: number) {
  const columns = Number.isFinite(value) ? Math.max(8, Math.min(48, Math.round(value / 4) * 4)) : 16;
  const rows = Math.round(columns * HEIGHT / WIDTH);
  return { columns, rows, count: columns * rows, scale: Math.min(1, WIDTH / columns / 12) };
}
