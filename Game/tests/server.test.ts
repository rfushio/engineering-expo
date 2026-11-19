import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';
import type { Snapshot } from '../src/shared/protocol.js';
const port = 3109, base = `http://localhost:${port}`;
let proc: ChildProcess, info: { token: string; room: string }, host: Client;
const clients: Client[] = [];
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
class Client {
  ws = new WebSocket(`ws://localhost:${port}/ws`);
  messages: any[] = []; state?: Snapshot; frames = 0; timer?: ReturnType<typeof setInterval>;
  constructor() { clients.push(this); this.ws.on('message', (raw, binary) => { if (binary) { this.frames++; return; } const msg = JSON.parse(raw.toString()); this.messages.push(msg); if (msg.type === 'state') this.state = msg.state; }); }
  async hello(message: object) { await new Promise<void>(r => this.ws.on('open', r)); this.send(message); this.timer = setInterval(() => this.send({ type: 'ping', at: 1 }), 400); }
  send(msg: object) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg)); }
  close() { clearInterval(this.timer); this.ws.close(); }
  async wait(predicate: () => boolean) { for (let n = 0; n < 150; n++) { if (predicate()) return; await delay(30); } throw new Error('Timed out waiting for socket state'); }
}
before(async () => {
  let output = '';
  proc = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout?.on('data', d => output += d); proc.stderr?.on('data', d => output += d);
  for (let n = 0; n < 100; n++) {
    try { const res = await fetch(`${base}/api/host-info`); if (res.ok) { info = await res.json() as typeof info; break; } } catch {}
    await delay(50);
  }
  assert.ok(info, output);
  host = new Client(); await host.hello({ type: 'hello', role: 'host', token: info.token }); await host.wait(() => !!host.state);
});
after(async () => { clients.forEach(c => c.close()); proc?.kill('SIGTERM'); await delay(100); });
test('two seats, third rejected, reconnection retains identity and pauses live match', async () => {
  const a = new Client(), b = new Client();
  await a.hello({ type: 'hello', role: 'controller', room: info.room }); await b.hello({ type: 'hello', role: 'controller', room: info.room });
  await a.wait(() => a.messages.some(m => m.type === 'welcome')); await b.wait(() => b.messages.some(m => m.type === 'welcome'));
  const welcome = a.messages.find(m => m.type === 'welcome'); assert.equal(welcome.player, 0); assert.equal(b.messages.find(m => m.type === 'welcome').player, 1);
  const extra = new Client(); await extra.hello({ type: 'hello', role: 'controller', room: info.room }); await extra.wait(() => extra.messages.some(m => m.fatal));
  a.send({ type: 'ready' }); b.send({ type: 'ready' }); await host.wait(() => host.state?.phase === 'playing');
  a.send({ type: 'input', x: 1, y: 0, field: true }); await host.wait(() => (host.state?.players[0].energy ?? 1) < .99);
  a.close(); await host.wait(() => host.state?.phase === 'paused');
  const elapsed = host.state!.elapsed;
  const again = new Client(); await again.hello({ type: 'hello', role: 'controller', room: info.room, token: welcome.token });
  await again.wait(() => again.messages.some(m => m.type === 'welcome')); assert.equal(again.messages.find(m => m.type === 'welcome').player, 0);
  assert.equal(host.state!.elapsed, elapsed); assert.equal(host.state!.players[0].active, false);
  assert.ok(host.frames > 0); assert.equal(b.frames, 0);
  again.close(); b.close(); extra.close(); host.send({ type: 'host', action: 'release' });
});
test('room and host capability checks reject unauthorized roles', async () => {
  for (const hello of [{ type: 'hello', role: 'host', token: 'wrong' }, { type: 'hello', role: 'controller', room: 'wrong' }]) {
    const peer = new Client(); await peer.hello(hello); await peer.wait(() => peer.messages.some(m => m.fatal)); peer.close();
  }
});
test('stale heartbeat pauses play rather than leaving a field active', async () => {
  host.send({ type: 'host', action: 'setup', mode: 'practice', map: 'bridges' });
  const a = new Client(); await a.hello({ type: 'hello', role: 'controller', room: info.room }); await a.wait(() => !!a.state);
  a.send({ type: 'ready' }); await host.wait(() => host.state?.phase === 'playing');
  a.send({ type: 'input', x: 0, y: 0, field: true }); clearInterval(a.timer);
  await host.wait(() => host.state?.phase === 'paused'); assert.equal(host.state!.players[0].active, false); a.close();
});
