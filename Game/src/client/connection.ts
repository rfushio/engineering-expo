import type { ClientMessage, ServerMessage, Snapshot } from '../shared/protocol';
export class Connection {
  ws?: WebSocket;
  connected = false; fatal = false; rtt = 0;
  private retry?: ReturnType<typeof setTimeout>;
  onState: (s: Snapshot) => void = () => {};
  onFrame: (frame: Uint8Array) => void = () => {};
  onMessage: (message: ServerMessage) => void = () => {};
  onStatus: (connected: boolean) => void = () => {};
  constructor(private hello: () => ClientMessage) {
    setInterval(() => this.send({ type: 'ping', at: performance.now() }), 500);
  }
  open() {
    this.fatal = false;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws = ws; ws.binaryType = 'arraybuffer';
    ws.onopen = () => this.send(this.hello());
    ws.onmessage = event => {
      if (event.data instanceof ArrayBuffer) { this.onFrame(new Uint8Array(event.data)); return; }
      const msg = JSON.parse(event.data) as ServerMessage;
      if (msg.type === 'welcome') { this.connected = true; this.onStatus(true); this.send({ type: 'visibility', visible: !document.hidden }); }
      if (msg.type === 'state') this.onState(msg.state);
      if (msg.type === 'pong') this.rtt = performance.now() - msg.at;
      if (msg.type === 'error' && msg.fatal) { this.fatal = true; }
      this.onMessage(msg);
    };
    ws.onclose = event => {
      this.connected = false; this.onStatus(false);
      if (event.code === 4001) { this.fatal = true; this.onMessage({ type: 'error', message: '別のタブで接続されました。このタブを閉じてください', fatal: true }); }
      if (!this.fatal) this.retry = setTimeout(() => this.open(), 1000);
    };
    ws.onerror = () => {};
  }
  send(value: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN && this.ws.bufferedAmount < 16384) this.ws.send(JSON.stringify(value));
  }
}
