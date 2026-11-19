import { FlipTracker, type FlipEvent } from './flip-events';
import type { Snapshot } from '../shared/protocol';

/** Locally synthesized magnetic crackles. No assets, microphone, or server messages. */
export class MagnetSound {
  private context?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;
  private tracker = new FlipTracker();
  private pending: FlipEvent[] = [];
  private lastBurst = -Infinity;
  private sources = new Set<AudioScheduledSourceNode>();
  private previewTimer?: ReturnType<typeof setTimeout>;
  private volume = .35;
  enabled = false;
  onChange: () => void = () => {};
  get running() { return this.context?.state === 'running'; }

  async enable() {
    if (!this.context) {
      if (!window.AudioContext) throw new Error('このブラウザでは効果音を利用できません');
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0;
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -14; limiter.knee.value = 12; limiter.ratio.value = 8;
      limiter.attack.value = .003; limiter.release.value = .12;
      this.master.connect(limiter); limiter.connect(this.context.destination);
      this.noise = this.context.createBuffer(1, Math.ceil(this.context.sampleRate * .12), this.context.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
      this.context.onstatechange = () => { if (!this.running) this.silence(); this.onChange(); };
    }
    // Called directly from the PC's sound button to satisfy browser autoplay policy.
    await this.context.resume();
    if (this.context.state !== 'running') throw new Error('PCの音ボタンをもう一度押してください');
    this.enabled = true; this.tracker.reset(); this.pending = [];
    this.master!.gain.setTargetAtTime(this.volume, this.context.currentTime, .015);
    this.onChange();
  }
  mute() {
    this.enabled = false; this.silence();
    if (this.context && this.master) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setValueAtTime(0, this.context.currentTime);
    }
    this.onChange();
  }
  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.context.currentTime, .015);
  }
  silence() {
    this.pending = []; this.tracker.reset(); clearTimeout(this.previewTimer);
    for (const source of this.sources) { try { source.stop(); } catch {} }
    this.sources.clear();
  }
  update(frame: Uint8Array, state: Snapshot) {
    const events = this.tracker.observe(frame, state);
    if (!this.enabled || !this.running || document.hidden || state.phase !== 'playing' || this.volume === 0) { this.pending = []; return; }
    for (const event of events) {
      const pending = this.pending.find(e => e.player === event.player);
      if (pending) {
        pending.pan = (pending.pan * pending.count + event.pan * event.count) / (pending.count + event.count);
        pending.count = Math.min(100, pending.count + event.count);
      } else this.pending.push({ ...event });
    }
    const now = this.context!.currentTime;
    if (now - this.lastBurst < .085 || !this.pending.length) return;
    // Bound the number of voices even when a large region changes in a single frame.
    for (const event of this.pending) this.play(event);
    this.pending = []; this.lastBurst = now;
  }
  preview() {
    this.play({ player: 0, count: 8, pan: -.3 });
    this.previewTimer = setTimeout(() => this.play({ player: 1, count: 25, pan: .3 }), 180);
  }
  private play(event: FlipEvent) {
    const ctx = this.context;
    if (!ctx || !this.enabled || ctx.state !== 'running' || document.hidden || !this.master || !this.noise || this.volume === 0) return;
    const now = ctx.currentTime;
    const intensity = Math.min(1, Math.sqrt(event.count / 35));
    const pitch = (event.player === 0 ? 1150 : 810) * (.94 + Math.random() * .12);
    const panner = ctx.createStereoPanner(); panner.pan.value = event.pan; panner.connect(this.master);
    const envelope = ctx.createGain(); envelope.gain.setValueAtTime(.0001, now);
    envelope.gain.exponentialRampToValueAtTime(.045 + .075 * intensity, now + .002);
    envelope.gain.exponentialRampToValueAtTime(.0001, now + .06 + .05 * intensity);
    envelope.connect(panner);
    const noise = ctx.createBufferSource(); noise.buffer = this.noise;
    const filter = ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = pitch * 2.3; filter.Q.value = .65;
    noise.connect(filter); filter.connect(envelope);
    const click = ctx.createOscillator(); click.type = 'sine';
    click.frequency.setValueAtTime(pitch, now); click.frequency.exponentialRampToValueAtTime(pitch * .62, now + .08);
    const tone = ctx.createGain(); tone.gain.value = .3; click.connect(tone); tone.connect(envelope);
    let remaining = 2;
    for (const source of [noise, click]) {
      this.sources.add(source);
      source.onended = () => {
        this.sources.delete(source); source.disconnect();
        if (--remaining === 0) { filter.disconnect(); tone.disconnect(); envelope.disconnect(); panner.disconnect(); }
      };
      source.start(now); source.stop(now + .12);
    }
  }
}
