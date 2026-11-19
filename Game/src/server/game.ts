import { CONTROL_TICKS, DEFAULT_SETTINGS, HEIGHT, HZ, IDLE, MAPS, PLAY_TICKS, RELAX_TICKS, WIDTH, validateSettings, type Input, type MapId, type Mode, type Phase, type PlayerId, type PlayerView, type Settings, type Snapshot } from '../shared/protocol.js';
import { Simulation, type Field } from './simulation.js';
import { ControlMatch } from './control.js';
interface Player extends PlayerView { input: Input }
export class Game {
  simulation = new Simulation();
  control = new ControlMatch();
  settings: Settings = { ...DEFAULT_SETTINGS };
  mode: Mode = 'battle'; map: MapId = 'bridges'; phase: Phase = 'lobby';
  players: Player[] = [0, 1].map(id => ({ id: id as PlayerId, connected: false, available: false, ready: false, x: id === 0 ? 75 : WIDTH - 1 - 75, y: id === 0 ? 28 : HEIGHT - 1 - 28, energy: 1, active: false, input: IDLE() }));
  participants: PlayerId[] = [0, 1];
  elapsedTicks = 0; countdownTicks = 0; tickMs = 0;
  pauseReason = ''; winner: PlayerId | 'draw' | null = null;
  private resumePhase: 'playing' | 'relaxing' = 'playing';
  private resuming = false;
  setup(mode: Mode, map: MapId) {
    if (this.phase !== 'lobby' && this.phase !== 'finished') throw new Error('盤面とモードは待機中に変更できます');
    if (!['battle', 'practice', 'control'].includes(mode) || !MAPS.some(m => m.id === map)) throw new Error('設定が不正です');
    this.mode = mode; this.map = mode === 'control' ? 'bridges' : map; this.lobby();
  }
  configure(settings: unknown) {
    if (!['lobby', 'finished'].includes(this.phase) && !(this.mode === 'practice' && this.phase === 'paused')) throw new Error('調整は待機中か練習の一時停止中に行ってください');
    const checked = validateSettings(settings);
    if (!checked) throw new Error('設定値が範囲外です');
    this.settings = checked;
  }
  private clearInputs() {
    for (const p of this.players) { p.input = IDLE(); p.active = false; p.ready = false; }
  }
  private resetBoard() {
    this.simulation.reset(this.map); this.elapsedTicks = 0; this.winner = null;
    this.control.reset(this.simulation.m);
    for (const p of this.players) {
      p.energy = 1; p.x = p.id === 0 ? 75 : WIDTH - 1 - 75; p.y = p.id === 0 ? 28 : HEIGHT - 1 - 28;
    }
    this.clearInputs();
  }
  lobby() {
    this.phase = 'lobby'; this.pauseReason = ''; this.resuming = false; this.countdownTicks = 0;
    this.resetBoard(); this.updateParticipants();
  }
  private updateParticipants() {
    if (this.phase === 'lobby') this.participants = this.mode !== 'practice' ? [0, 1] : [this.players.find(p => p.connected && p.available)?.id ?? 0];
  }
  connect(id: PlayerId) { this.players[id].connected = true; this.players[id].available = true; this.players[id].ready = false; this.updateParticipants(); }
  availability(id: PlayerId, available: boolean) {
    this.players[id].available = available; this.players[id].input = IDLE(); this.players[id].active = false;
    this.players[id].ready = false;
    if (!available && this.participants.includes(id)) this.pause(`P${id + 1} の接続・画面の復帰を待っています`);
    this.updateParticipants();
  }
  disconnect(id: PlayerId) { this.players[id].connected = false; this.availability(id, false); }
  ready(id: PlayerId) {
    if (!['lobby', 'paused'].includes(this.phase)) return;
    this.updateParticipants();
    if (!this.participants.includes(id) || !this.players[id].connected || !this.players[id].available) return;
    this.players[id].ready = true;
    if (this.participants.every(i => this.players[i].connected && this.players[i].available && this.players[i].ready)) {
      this.resuming = this.phase === 'paused';
      this.phase = 'countdown'; this.countdownTicks = 3 * HZ; this.pauseReason = '';
      for (const p of this.players) { p.input = IDLE(); p.active = false; }
    }
  }
  pause(reason = 'PCで一時停止しました') {
    if (!['playing', 'relaxing', 'countdown'].includes(this.phase)) return;
    if (this.phase !== 'countdown') this.resumePhase = this.phase as 'playing' | 'relaxing';
    else if (!this.resuming) this.resumePhase = 'playing';
    this.phase = 'paused'; this.pauseReason = reason; this.clearInputs();
  }
  resetPractice() {
    if (this.mode !== 'practice' || this.phase !== 'paused') throw new Error('練習を一時停止してからリセットしてください');
    this.resetBoard(); this.resumePhase = 'playing'; this.pauseReason = '盤面をリセットしました。準備完了で再開';
  }
  input(id: PlayerId, input: Input) {
    if (this.phase !== 'playing' || !this.participants.includes(id) || !this.players[id].available) return;
    if (!Number.isFinite(input.x) || !Number.isFinite(input.y) || typeof input.field !== 'boolean') return;
    const length = Math.max(1, Math.hypot(input.x, input.y));
    this.players[id].input = { x: input.x / length, y: input.y / length, field: input.field };
  }
  tick() {
    if (this.phase === 'countdown') {
      if (--this.countdownTicks <= 0) { this.phase = this.resuming ? this.resumePhase : 'playing'; this.clearInputs(); }
      return;
    }
    if (this.phase !== 'playing' && this.phase !== 'relaxing') return;
    const fields: Field[] = [];
    for (const p of this.players) {
      p.active = false;
      if (this.phase !== 'playing' || !this.participants.includes(p.id)) continue;
      const input = p.input;
      p.x = Math.max(0, Math.min(WIDTH - 1, p.x + input.x * this.settings.cursorSpeed / HZ));
      p.y = Math.max(0, Math.min(HEIGHT - 1, p.y + input.y * this.settings.cursorSpeed / HZ));
      if (input.field) {
        const cost = 1 / (HZ * this.settings.useSeconds);
        if (p.energy > 1e-9) {
          p.active = true;
          fields.push({ x: p.x, y: p.y, sign: p.id === 0 ? 1 : -1, strength: this.settings.fieldStrength * Math.min(1, p.energy / cost) });
          p.energy = Math.max(0, p.energy - cost);
        }
      } else p.energy = Math.min(1, p.energy + 1 / (HZ * this.settings.rechargeSeconds));
    }
    this.simulation.step(1 / HZ, this.settings, fields);
    if (this.mode === 'control') this.control.tick(this.simulation.m);
    this.elapsedTicks++;
    if (this.mode === 'control' && this.elapsedTicks >= CONTROL_TICKS) {
      this.phase = 'finished'; this.clearInputs(); this.winner = this.control.winner();
    }
    if (this.mode === 'battle') {
      if (this.elapsedTicks === PLAY_TICKS) { this.phase = 'relaxing'; this.clearInputs(); }
      if (this.elapsedTicks >= PLAY_TICKS + RELAX_TICKS) {
        this.phase = 'finished'; this.clearInputs();
        const [a, b] = this.simulation.area(); this.winner = a === b ? 'draw' : a > b ? 0 : 1;
      }
    }
  }
  snapshot(): Snapshot {
    return {
      phase: this.phase, mode: this.mode, map: this.map, settings: this.settings,
      players: this.players.map(({ input: _, ...p }) => ({ ...p })), participants: [...this.participants],
      elapsed: this.elapsedTicks / HZ,
      remaining: this.mode === 'practice' ? 0 : Math.max(0, ((this.mode === 'control' ? CONTROL_TICKS : PLAY_TICKS + RELAX_TICKS) - this.elapsedTicks) / HZ),
      countdown: Math.ceil(this.countdownTicks / HZ), area: this.simulation.area(), winner: this.winner,
      control: this.mode === 'control' ? this.control.snapshot() : null,
      pauseReason: this.pauseReason, tickMs: this.tickMs,
    };
  }
}
