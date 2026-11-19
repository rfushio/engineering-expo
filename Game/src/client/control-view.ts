import type { ControlPointView, ControlView } from '../shared/protocol';

export function controlColor(owner: number | null): string {
  return owner === 0 ? '#61c3f2' : owner === 1 ? '#ffba87' : '#edf4f4';
}

export function pointStatus(point: ControlPointView): string {
  if (point.owner !== null) return `P${point.owner + 1} が保持`;
  if (point.claimant !== null) return `P${point.claimant + 1} 占領まで ${(1 - point.progress).toFixed(1)}秒`;
  return '中立';
}

export function drawControlPoints(ctx: CanvasRenderingContext2D, control: ControlView, unit: number, ratio: number) {
  for (const point of control.points) {
    const x = (point.x + .5) * unit, y = (point.y + .5) * unit, r = point.radius * unit;
    ctx.save();
    ctx.fillStyle = 'rgba(12,30,45,.2)'; ctx.strokeStyle = controlColor(point.owner); ctx.lineWidth = 2 * ratio;
    ctx.setLineDash(point.owner === null ? [5 * ratio, 4 * ratio] : []);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);
    if (point.claimant !== null) {
      ctx.strokeStyle = controlColor(point.claimant); ctx.lineWidth = 4 * ratio;
      ctx.beginPath(); ctx.arc(x, y, r + 3 * ratio, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * point.progress); ctx.stroke();
    }
    const flagY = y - r - 11 * ratio;
    ctx.strokeStyle = '#e5f3f5'; ctx.lineWidth = ratio;
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x, flagY + 7 * ratio); ctx.stroke();
    ctx.fillStyle = point.owner === null ? '#183344' : controlColor(point.owner);
    ctx.beginPath(); ctx.roundRect(x - 15 * ratio, flagY - 10 * ratio, 30 * ratio, 20 * ratio, 5 * ratio); ctx.fill();
    ctx.fillStyle = point.owner === null ? '#fff' : '#142c3d';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `bold ${12 * ratio}px system-ui`;
    ctx.fillText(point.id, x, flagY);
    ctx.restore();
  }
}
