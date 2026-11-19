import { createServer, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, WebSocket } from 'ws';
import { Game } from './game.js';
import { HZ, IDLE, type ClientMessage, type PlayerId, type ServerMessage } from '../shared/protocol.js';
const port = Number(process.env.PORT ?? 3000);
const dev = process.argv.includes('--dev');
const room = randomBytes(12).toString('hex');
const hostToken = randomBytes(24).toString('hex');
const game = new Game();
const dist = resolve('dist');
if (!dev && !existsSync(resolve(dist, 'index.html'))) {
  console.error('先に npm run build を実行してください。'); process.exit(1);
}
const vite = dev ? await (await import('vite')).createServer({ server: { middlewareMode: true }, appType: 'spa' }) : null;
const local = (address?: string) => address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
function respond(res: ServerResponse, status: number, body: string, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' }); res.end(body);
}
const mime: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/host-info') {
      if (!local(req.socket.remoteAddress)) { respond(res, 403, 'PCでは http://localhost:' + port + '/host を開いてください'); return; }
      const addresses = Object.values(networkInterfaces()).flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n!.address);
      const unique = [...new Set(addresses)];
      respond(res, 200, JSON.stringify({ token: hostToken, room, urls: unique.map(a => `http://${a}:${port}/controller?room=${room}`), localController: `http://localhost:${port}/controller?room=${room}` }), 'application/json'); return;
    }
    if (url.pathname === '/api/health') { respond(res, 200, '{"ok":true}', 'application/json'); return; }
    if (vite) { vite.middlewares(req, res); return; }
    const name = ['/', '/host', '/controller'].includes(url.pathname) ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = resolve(dist, name);
    if (!file.startsWith(dist + sep)) { respond(res, 403, 'Forbidden'); return; }
    try { const data = await readFile(file); res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(data); }
    catch { respond(res, 404, 'Not found'); }
  } catch { respond(res, 400, 'Bad request'); }
});
interface Peer { ws: WebSocket; role?: 'host' | 'controller'; id?: PlayerId; lastSeen: number; lastInput: number; local: boolean; visible: boolean; messages: number; windowStart: number }
const peers = new Set<Peer>();
const seats: ({ token: string; peer?: Peer } | undefined)[] = [undefined, undefined];
function send(peer: Peer, value: ServerMessage) {
  if (peer.ws.readyState === WebSocket.OPEN && peer.ws.bufferedAmount < 1024 * 1024) peer.ws.send(JSON.stringify(value));
}
function error(peer: Peer, message: string, fatal = false) {
  send(peer, { type: 'error', message, fatal }); if (fatal) peer.ws.close(1008, 'Rejected');
}
function tokenEqual(a: unknown, b: string) {
  return typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
server.on('upgrade', (req, socket, head) => {
  // Only the locally served page may connect; room and host capabilities are checked separately.
  try {
    if (req.url !== '/ws' || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)) { socket.destroy(); return; }
  } catch { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
wss.on('connection', (ws, req) => {
  const now = performance.now();
  const peer: Peer = { ws, local: local(req.socket.remoteAddress), visible: true, lastSeen: now, lastInput: now, messages: 0, windowStart: now };
  peers.add(peer);
  ws.on('error', () => {});
  ws.on('message', (raw, binary) => {
    if (binary) return error(peer, 'メッセージ形式が不正です', true);
    const time = performance.now();
    if (time - peer.windowStart > 1000) { peer.messages = 0; peer.windowStart = time; }
    if (++peer.messages > 150) return error(peer, '操作の送信が多すぎます', true);
    try {
      const msg = JSON.parse(raw.toString()) as ClientMessage;
      if (!msg || typeof msg !== 'object') throw new Error('メッセージ形式が不正です');
      peer.lastSeen = time;
      if (msg.type === 'hello') {
        if (peer.role) return;
        if (msg.role === 'host') {
          if (!peer.local || !tokenEqual(msg.token, hostToken)) return error(peer, 'PCの localhost から開いてください', true);
          peer.role = 'host'; send(peer, { type: 'welcome', role: 'host' });
        } else if (msg.role === 'controller') {
          if (!tokenEqual(msg.room, room)) return error(peer, '参加コードが変わりました。PCのQRコードを読み直してください', true);
          let id = seats.findIndex(s => s && tokenEqual(msg.token, s.token));
          if (id < 0) id = seats.findIndex(s => !s);
          if (id < 0) return error(peer, '2人の参加枠が使用中です。交代する場合はPCで接続枠をリセットしてください', true);
          if (!seats[id]) seats[id] = { token: randomBytes(24).toString('hex') };
          const seat = seats[id]!;
          if (seat.peer && seat.peer !== peer) { game.disconnect(id as PlayerId); seat.peer.ws.close(4001, 'Replaced'); }
          peer.role = 'controller'; peer.id = id as PlayerId; seat.peer = peer; game.connect(peer.id);
          send(peer, { type: 'welcome', role: 'controller', player: peer.id, token: seat.token });
        } else return error(peer, '役割が不正です', true);
        send(peer, { type: 'state', state: game.snapshot() });
        if (peer.role === 'host') ws.send(game.simulation.frame());
        return;
      }
      if (!peer.role) return error(peer, '参加情報が必要です', true);
      if (msg.type === 'ping') { if (typeof msg.at === 'number' && Number.isFinite(msg.at)) send(peer, { type: 'pong', at: msg.at }); return; }
      if (peer.role === 'controller' && peer.id !== undefined) {
        if (seats[peer.id]?.peer !== peer) return;
        if (msg.type === 'input') { peer.lastInput = time; game.input(peer.id, msg); }
        if (msg.type === 'ready') {
          if (![...peers].some(p => p.role === 'host' && p.visible && p.ws.readyState === WebSocket.OPEN)) throw new Error('PCのゲーム画面を表示してから準備完了を押してください');
          game.ready(peer.id);
        }
        if (msg.type === 'visibility' && typeof msg.visible === 'boolean') game.availability(peer.id, msg.visible);
      } else if (peer.role === 'host') {
        if (msg.type === 'visibility' && typeof msg.visible === 'boolean') {
          peer.visible = msg.visible;
          if (!msg.visible) game.pause('PCの画面が非表示になりました');
        }
        if (msg.type === 'host') {
          switch (msg.action) {
            case 'setup': game.setup(msg.mode, msg.map); break;
            case 'settings': game.configure(msg.settings); break;
            case 'pause': game.pause(); break;
            case 'reset': game.resetPractice(); break;
            case 'lobby': game.lobby(); break;
            case 'release':
              game.lobby();
              for (const seat of seats) if (seat?.peer) error(seat.peer, '接続枠をリセットしました。QRコードから参加し直してください', true);
              seats.fill(undefined); for (const id of [0, 1] as const) game.disconnect(id); break;
          }
        }
      }
    } catch (e) { error(peer, e instanceof Error ? e.message : '操作を処理できませんでした'); }
  });
  ws.on('close', () => {
    peers.delete(peer);
    if (peer.id !== undefined && seats[peer.id]?.peer === peer) { seats[peer.id]!.peer = undefined; game.disconnect(peer.id); }
    if (peer.role === 'host' && ![...peers].some(p => p.role === 'host')) game.pause('PC画面の再接続を待っています');
  });
});
let last = performance.now(), accumulator = 0, lastFrame = 0;
const timer = setInterval(() => {
  const now = performance.now(), elapsed = now - last; last = now;
  if (elapsed > 500) { game.pause('PCの処理が遅れたため停止しました'); accumulator = 0; }
  else accumulator += elapsed;
  for (const peer of peers) {
    if (now - peer.lastSeen > (peer.role ? 1500 : 5000)) { if (peer.id !== undefined && seats[peer.id]?.peer === peer) game.disconnect(peer.id); peer.ws.terminate(); continue; }
    if (peer.id !== undefined && now - peer.lastInput > 350) game.input(peer.id, IDLE());
  }
  let steps = 0;
  const started = performance.now();
  while (accumulator >= 1000 / HZ && steps < 12) { game.tick(); accumulator -= 1000 / HZ; steps++; }
  if (accumulator >= 1000 / HZ) { game.pause('計算が追いつかないため停止しました'); accumulator = 0; }
  if (steps) game.tickMs = (performance.now() - started) / steps;
  if (now - lastFrame >= 1000 / 30) {
    lastFrame += 1000 / 30;
    if (now - lastFrame > 1000 / 30) lastFrame = now;
    const state: ServerMessage = { type: 'state', state: game.snapshot() };
    const hosts = [...peers].filter(p => p.role === 'host');
    const frame = hosts.length ? game.simulation.frame() : null;
    for (const peer of peers) if (peer.role) {
      send(peer, state);
      if (peer.role === 'host' && frame && peer.ws.readyState === WebSocket.OPEN && peer.ws.bufferedAmount < 256 * 1024) peer.ws.send(frame);
    }
  }
}, 1000 / HZ);
server.listen(port, '0.0.0.0', () => {
  console.log(`\n磁区バトル — PC画面: http://localhost:${port}/host`);
  console.log('iPhone 2台を同じWi-Fiにつなぎ、PC画面のQRコードを読み取ってください。\n');
});
function shutdown() { clearInterval(timer); for (const peer of peers) peer.ws.terminate(); wss.close(); server.close(); void vite?.close(); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
