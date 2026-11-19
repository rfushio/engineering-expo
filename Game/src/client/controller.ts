import { Connection } from './connection';
import { bindControllerInput } from './controller-input';
import { CONTROL_POINTS, type PlayerId, type Snapshot } from '../shared/protocol';
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
export function mountController() {
  document.body.className = 'controller';
  document.documentElement.classList.add('controller-page');
  document.querySelector('meta[name=viewport]')?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
  const room = new URLSearchParams(location.search).get('room') ?? '';
  const storageKey = `jiku-player-${room}`;
  const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch {} };
  let token = read(storageKey) ?? undefined;
  $('#app').innerHTML = `<main class="phone-shell">
    <header class="phone-header"><div class="phone-brand"><span class="brand-mark">磁</span><b>磁区バトル</b></div><div class="phone-identity"><span id="phone-player">接続中</span><span id="phone-color">YOUR MAGNET</span></div><div class="phone-tools"><span id="phone-connection">接続中…</span><button id="input-reset" aria-label="移動と磁場の操作を解除">操作解除</button><button id="swap" aria-label="左右の配置を交換">左右交換 ⇄</button></div></header>
    <div id="phone-objective" class="phone-objective" hidden><strong id="phone-control-score"></strong><div>${CONTROL_POINTS.map(p => `<span id="phone-point-${p.id}" class="phone-point">${p.id} · 中立</span>`).join('')}</div></div>
    <section class="phone-controls" aria-label="磁石の操作"><div id="move-zone" class="move-zone" aria-label="移動用スティック"><div class="zone-label"><span>MOVE</span><h1>ここをなぞって移動</h1><p>触れたところが、スティックの中心。</p></div><div class="joystick-guide"><span>↑</span><span>←</span><i></i><span>→</span><span>↓</span></div><div id="stick" class="stick" hidden><div id="stick-knob"></div></div><span class="control-footnote">離すと止まる</span></div><div class="field-zone"><button id="field-button" aria-label="磁場をかける"><span class="field-button-content"><span class="field-symbol">＋</span><strong>磁場</strong><small>押し続ける</small></span></button><span id="field-help">離すとエネルギーが回復</span></div></section>
    <footer class="phone-footer"><span id="phone-instruction">PCの盤面を見ながら操作しよう</span><div class="phone-energy"><span>ENERGY</span><div><i id="phone-energy-bar"></i></div><b id="phone-energy-text">100%</b></div></footer>
    <div id="phone-overlay" class="phone-overlay"><div><span id="phone-overlay-label" class="eyebrow">CONNECTING</span><h2 id="phone-title">磁石を接続しています</h2><p id="phone-message">PCと同じWi-Fiにつないでください。</p><button id="ready" class="primary" hidden>準備完了</button><button id="reconnect" class="quiet" hidden>参加し直す</button></div></div>
    <div class="rotate-overlay"><div class="rotate-phone">↻</div><h2>スマホを横向きに</h2><p>左手で動かして、右手で磁場をかけます。<br>画面の回転ロックを解除してください。</p></div>
  </main>`;
  let player: PlayerId | undefined, state: Snapshot | undefined, fatalText = '';
  const connection = new Connection(() => ({ type: 'hello', role: 'controller', room, token }));
  const move = $('#move-zone'), stick = $('#stick'), knob = $('#stick-knob'), button = $<HTMLButtonElement>('#field-button');
  const landscape = () => matchMedia('(orientation: landscape)').matches;
  const available = () => !document.hidden && landscape();
  const canPlay = () => connection.connected && available() && state?.phase === 'playing' && player !== undefined && state.players[player].available && state.participants.includes(player);
  const controls = bindControllerInput(move, button, stick, knob, canPlay, input => connection.send({ type: 'input', ...input }));
  const clearTouches = controls.clear;
  setInterval(() => {
    if (!canPlay()) clearTouches();
    else connection.send({ type: 'input', ...controls.read() });
  }, 1000 / 30);
  function updateAvailability() { clearTouches(); connection.send({ type: 'visibility', visible: available() }); }
  document.addEventListener('visibilitychange', updateAvailability);
  window.addEventListener('pagehide', () => { clearTouches(); connection.send({ type: 'visibility', visible: false }); });
  window.addEventListener('pageshow', updateAvailability);
  window.addEventListener('blur', clearTouches);
  // Browser toolbar/viewport resizing is not a finger release. Only actual
  // orientation changes interrupt the gesture and pause the match.
  matchMedia('(orientation: landscape)').addEventListener('change', updateAvailability);
  $('#input-reset').addEventListener('pointerdown', clearTouches);
  $('#input-reset').onclick = clearTouches;
  let swapped = read('jiku-swapped') === 'true';
  $('.phone-controls').classList.toggle('swapped', swapped);
  $('#swap').onclick = () => { clearTouches(); swapped = !swapped; write('jiku-swapped', String(swapped)); $('.phone-controls').classList.toggle('swapped', swapped); };
  $('#ready').onclick = () => { clearTouches(); connection.send({ type: 'ready' }); };
  $('#reconnect').onclick = () => { try { localStorage.removeItem(storageKey); } catch {} location.reload(); };
  connection.onStatus = connected => {
    clearTouches();
    $('#phone-connection').textContent = connected ? '● 接続済み' : '○ 再接続中';
    if (!connected) {
      $('#phone-overlay').hidden = false; $('#phone-overlay-label').textContent = fatalText ? 'CONNECTION' : 'RECONNECTING';
      $('#phone-title').textContent = fatalText ? '接続を確認してください' : '再接続しています';
      $('#phone-message').textContent = fatalText || '試合は一時停止します。PCと同じWi-Fiを確認してください。';
      $('#ready').hidden = true; $('#reconnect').hidden = !fatalText;
    }
  };
  connection.onMessage = msg => {
    if (msg.type === 'welcome' && msg.role === 'controller') {
      player = msg.player; token = msg.token; write(storageKey, token);
      document.body.classList.toggle('player-orange', player === 1);
      $('#phone-player').textContent = `P${player + 1}`; $('#phone-color').textContent = player === 0 ? 'BLUE' : 'ORANGE';
      if (!landscape()) connection.send({ type: 'visibility', visible: false });
    }
    if (msg.type === 'error') {
      fatalText = msg.message; clearTouches(); $('#phone-overlay').hidden = false;
      $('#phone-title').textContent = '接続を確認してください'; $('#phone-message').textContent = msg.message;
      $('#ready').hidden = true; $('#reconnect').hidden = !msg.fatal;
    }
  };
  connection.onState = s => {
    if (s.phase !== state?.phase) clearTouches();
    state = s;
    if (player === undefined) return;
    const p = s.players[player], participating = s.participants.includes(player);
    $('#phone-objective').hidden = !s.control;
    if (s.control) {
      $('#phone-control-score').textContent = `P1 ${s.control.scores[0].toFixed(1)} : ${s.control.scores[1].toFixed(1)} P2`;
      for (const point of s.control.points) {
        const chip = $(`#phone-point-${point.id}`);
        chip.textContent = `${point.id} · ${point.owner === null ? point.claimant === null ? '中立' : `P${point.claimant + 1}…` : `P${point.owner + 1}`}`;
        chip.dataset.owner = point.owner === null ? 'neutral' : String(point.owner);
      }
    }
    $('#phone-energy-bar').style.width = `${p.energy * 100}%`;
    $('#phone-energy-text').textContent = `${Math.round(p.energy * 100)}%`;
    button.style.setProperty('--energy-angle', `${p.energy * 360}deg`);
    button.classList.toggle('empty', p.energy < 1e-9);
    $('#field-help').textContent = p.energy < 1e-9 ? 'ボタンを離すと回復します' : '離すとエネルギーが回復';
    $('#phone-connection').textContent = `● 接続済み · ${Math.round(connection.rtt)} ms`;
    $('#phone-instruction').textContent = s.phase === 'playing' ? (s.mode === 'practice' ? '練習中 · PCで停止や調整ができます' : s.control ? `拠点争奪 · 残り ${Math.ceil(s.remaining)} 秒 · 1拠点につき毎秒1点` : `残り ${Math.ceil(s.remaining)} 秒 · PCの盤面を見よう`) : 'PCの盤面を見ながら操作しよう';
    const overlay = $('#phone-overlay'); overlay.hidden = s.phase === 'playing' && participating;
    const ready = $<HTMLButtonElement>('#ready'); ready.hidden = !['lobby', 'paused'].includes(s.phase) || !participating;
    ready.disabled = p.ready || !p.available;
    ready.textContent = p.ready ? '準備完了 ✓ 相手を待っています' : s.phase === 'paused' ? '準備完了・再開する' : '準備完了';
    $('#reconnect').hidden = true;
    if (!participating) {
      $('#phone-overlay-label').textContent = 'SPECTATOR'; $('#phone-title').textContent = 'もう一人が練習中'; $('#phone-message').textContent = '二人で遊ぶときはPCで二人対戦を選んでください。';
    } else if (s.phase === 'lobby') {
      $('#phone-overlay-label').textContent = `PLAYER ${player + 1} · ${s.mode === 'practice' ? 'PRACTICE' : s.control ? 'CONTROL' : 'READY'}`;
      $('#phone-title').textContent = '準備はいい？'; $('#phone-message').textContent = s.control ? '拠点の60%以上を1秒維持して占領。90秒の累計得点で勝負！' : '左手で移動、右手で磁場。PCを見ながら遊ぼう。';
    } else if (s.phase === 'countdown') {
      $('#phone-overlay-label').textContent = 'GET READY'; $('#phone-title').textContent = String(s.countdown); $('#phone-message').textContent = 'PCの盤面を見よう。';
    } else if (s.phase === 'relaxing') {
      $('#phone-overlay-label').textContent = 'LET IT SETTLE'; $('#phone-title').textContent = 'あとは、磁区にまかせよう。'; $('#phone-message').textContent = `残り ${Math.ceil(s.remaining)} 秒。操作を止めてPCを見よう。`;
    } else if (s.phase === 'paused') {
      $('#phone-overlay-label').textContent = 'PAUSED'; $('#phone-title').textContent = '試合を一時停止しています'; $('#phone-message').textContent = '準備ができたらボタンを押してください。';
    } else if (s.phase === 'finished') {
      $('#phone-overlay-label').textContent = 'RESULT'; $('#phone-title').textContent = s.winner === 'draw' ? '引き分け！' : s.winner === player ? 'あなたの勝ち！' : '次こそ、つなぎ返そう。'; $('#phone-message').textContent = s.control ? `P1 ${s.control.scores[0].toFixed(2)}点 / P2 ${s.control.scores[1].toFixed(2)}点。再戦はPCから。` : 'PCで「もう一度あそぶ」を押すと再戦できます。';
    }
  };
  connection.open();
}
