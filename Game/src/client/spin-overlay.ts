import { HEIGHT, WIDTH } from '../shared/protocol';

/** Sample the continuous magnetization; these glyphs are not microscopic spins. */
export class SpinOverlay {
  private canvas = document.createElement('canvas');
  private context = this.canvas.getContext('2d')!;
  private frame?: Uint8Array;
  private ratio = 0;

  draw(target: CanvasRenderingContext2D, frame: Uint8Array, width: number, height: number, ratio: number) {
    if (this.frame !== frame || this.canvas.width !== width || this.canvas.height !== height || this.ratio !== ratio) {
      this.canvas.width = width; this.canvas.height = height;
      this.frame = frame; this.ratio = ratio;
      const ctx = this.context, unit = width / WIDTH;
      // Keep a readable spacing in CSS pixels, even on a small or Retina screen.
      const step = [4, 6, 8, 12, 16, 24, 32].find(n => n * unit / ratio >= 18) ?? 32;
      const arrows = new Path2D();
      for (let y = step / 2; y < HEIGHT; y += step) for (let x = step / 2; x < WIDTH; x += step) {
        const m = frame[Math.floor(y) * WIDTH + Math.floor(x)] / 127.5 - 1;
        const magnitude = Math.abs(m);
        // The 8-bit transport straddles zero at 127/128: suppress tiny glyphs.
        if (magnitude < 0.06) continue;
        const cx = (x + 0.5) * unit, cy = (y + 0.5) * unit;
        const half = Math.min(step * unit * 0.29, 7 * ratio) * magnitude;
        const direction = m > 0 ? -1 : 1;
        const tip = cy + direction * half, tail = cy - direction * half;
        const head = half * 0.72;
        arrows.moveTo(cx, tail); arrows.lineTo(cx, tip);
        arrows.moveTo(cx - head * 0.65, tip - direction * head);
        arrows.lineTo(cx, tip); arrows.lineTo(cx + head * 0.65, tip - direction * head);
      }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // A quiet dark outline keeps arrows legible on both domain colours.
      ctx.strokeStyle = 'rgba(12, 37, 53, 0.25)'; ctx.lineWidth = 2.6 * ratio;
      ctx.stroke(arrows);
      ctx.strokeStyle = 'rgba(255, 248, 228, 0.72)'; ctx.lineWidth = 1.15 * ratio;
      ctx.stroke(arrows);
    }
    target.drawImage(this.canvas, 0, 0);
  }
}
