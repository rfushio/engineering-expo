export const WIDTH = 192;
export const HEIGHT = 108;
export const HZ = 60;
export const PLAY_TICKS = 75 * HZ;
export const RELAX_TICKS = 5 * HZ;
export const CONTROL_TICKS = 90 * HZ;
export const CAPTURE_TICKS = HZ;
export const CAPTURE_THRESHOLD = .6;
export const CONTROL_POINTS = [
  { id: 'A', x: 127.5, y: 27.5, radius: 6 },
  { id: 'B', x: (WIDTH - 1) / 2, y: (HEIGHT - 1) / 2, radius: 6 },
  { id: 'C', x: 63.5, y: 79.5, radius: 6 },
] as const;
export const MAPS = [
  { id: 'bridges', name: '橋の切断', tag: 'CUT', description: '細い橋を切り、張り出した領土を孤立させよう。' },
  { id: 'islands', name: '島の救援', tag: 'RESCUE', description: '縮む小島に道をつくり、本体へつなぎ直そう。' },
  { id: 'fronts', name: '複数の前線', tag: 'SHIFT', description: '離れた前線を行き来して、攻める場所を選ぼう。' },
] as const;
export type MapId = typeof MAPS[number]['id'];
export type Mode = 'battle' | 'practice' | 'control';
export type Phase = 'lobby' | 'countdown' | 'playing' | 'relaxing' | 'paused' | 'finished';
export type PlayerId = 0 | 1;
export interface Settings {
  fieldRadius: number; fieldStrength: number; relaxation: number;
  cursorSpeed: number; useSeconds: number; rechargeSeconds: number;
}
export const DEFAULT_SETTINGS: Settings = {
  fieldRadius: 8, fieldStrength: 14, relaxation: 1,
  cursorSpeed: 60, useSeconds: 3, rechargeSeconds: 4,
};
export const SETTING_META: Record<keyof Settings, { label: string; unit: string; min: number; max: number; step: number }> = {
  fieldRadius: { label: '磁場の半径', unit: '格子', min: 3, max: 14, step: 1 },
  fieldStrength: { label: '磁場の強さ', unit: '', min: 2, max: 20, step: 0.5 },
  relaxation: { label: '自然緩和の速さ', unit: '倍', min: 0.25, max: 2, step: 0.25 },
  cursorSpeed: { label: '磁石の最高速度', unit: '格子/秒', min: 20, max: 100, step: 5 },
  useSeconds: { label: '満タンで使える時間', unit: '秒', min: 1, max: 10, step: 0.5 },
  rechargeSeconds: { label: '空から全回復する時間', unit: '秒', min: 1, max: 12, step: 0.5 },
};
export function validateSettings(value: unknown): Settings | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const result = {} as Settings;
  for (const key of Object.keys(SETTING_META) as (keyof Settings)[]) {
    const x = v[key], meta = SETTING_META[key];
    if (typeof x !== 'number' || !Number.isFinite(x) || x < meta.min || x > meta.max) return null;
    result[key] = x;
  }
  return result;
}
export interface Input { x: number; y: number; field: boolean }
export const IDLE = (): Input => ({ x: 0, y: 0, field: false });
export interface PlayerView {
  id: PlayerId; connected: boolean; available: boolean; ready: boolean;
  x: number; y: number; energy: number; active: boolean;
}
export interface ControlPointView {
  id: string; x: number; y: number; radius: number;
  owner: PlayerId | null; claimant: PlayerId | null; progress: number;
  coverage: [number, number];
}
export interface ControlView {
  points: ControlPointView[];
  scores: [number, number];
  rates: [number, number];
}
export interface Snapshot {
  phase: Phase; mode: Mode; map: MapId; settings: Settings;
  players: PlayerView[]; participants: PlayerId[];
  elapsed: number; remaining: number; countdown: number;
  area: [number, number]; winner: PlayerId | 'draw' | null;
  control: ControlView | null;
  pauseReason: string; tickMs: number;
}
export type HostAction =
  | { action: 'setup'; mode: Mode; map: MapId }
  | { action: 'settings'; settings: Settings }
  | { action: 'pause' | 'reset' | 'lobby' | 'release' };
export type ClientMessage =
  | { type: 'hello'; role: 'host'; token: string }
  | { type: 'hello'; role: 'controller'; room: string; token?: string }
  | { type: 'input'; x: number; y: number; field: boolean }
  | { type: 'ready' }
  | { type: 'visibility'; visible: boolean }
  | { type: 'ping'; at: number }
  | ({ type: 'host' } & HostAction);
export type ServerMessage =
  | { type: 'welcome'; role: 'host' }
  | { type: 'welcome'; role: 'controller'; player: PlayerId; token: string }
  | { type: 'state'; state: Snapshot }
  | { type: 'error'; message: string; fatal?: boolean }
  | { type: 'pong'; at: number };
