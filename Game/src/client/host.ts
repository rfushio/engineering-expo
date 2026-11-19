import QRCode from 'qrcode';
import { Connection } from './connection';
import { MagnetSound } from './magnet-sound';
import { SpinOverlay } from './spin-overlay';
import { spinLayout } from './spin-layout';
import { drawControlPoints, pointStatus } from './control-view';
import type { ReliefRenderer } from './relief';
import { CONTROL_POINTS, DEFAULT_SETTINGS, HEIGHT, MAPS, SETTING_META, WIDTH, type MapId, type Mode, type Settings, type Snapshot } from '../shared/protocol';
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const percent = (n: number) => (100 * n / (WIDTH * HEIGHT)).toFixed(1);
export async function mountHost() {
  document.body.className = 'host';
  $('#app').innerHTML = `
    <main class="shell">
      <header class="topbar"><a class="brand" href="/host"><span class="brand-mark">磁</span><span>磁区バトル<small>DOMAIN BATTLE</small></span></a><span class="tagline">切って、つないで、最後まで残せ。</span><div class="sound-controls"><button id="sound-toggle" class="quiet" aria-pressed="false" title="磁化の反転に合わせて効果音を鳴らします">音をON</button><label>音量 <input id="sound-volume" type="range" min="0" max="100" value="35" aria-label="効果音の音量"></label><button id="sound-preview" class="quiet" title="効果音を試聴">試聴</button></div><button id="settings-open" class="quiet">調整と設定 <span>↗</span></button><button id="menu-toggle" class="quiet menu-toggle" aria-label="参加・ゲーム設定メニュー" aria-controls="host-menu" aria-expanded="false"><span class="menu-icon" aria-hidden="true"><i></i><i></i><i></i></span><span>参加・設定</span></button></header>
      <section class="game-layout">
        <div class="arena-column">
          <div class="scoreboard">
            <div class="player-score blue"><div class="score-label"><span class="player-pill">P1</span><span>BLUE</span><span id="status-0" class="player-status">未接続</span></div><div class="score-number"><span id="area-0">50.0</span><small id="score-unit-0">%</small></div><div id="score-extra-0" class="score-extra" hidden></div><div class="energy-line"><span>磁場エネルギー</span><span id="energy-text-0">100%</span></div><div class="energy-track"><div id="energy-0"></div></div></div>
            <div class="clock"><span id="phase-label">接続待ち</span><strong id="time">80<small>秒</small></strong><span id="phase-hint">75秒操作 ＋ 5秒緩和</span></div>
            <div class="player-score orange"><div class="score-label"><span class="player-pill">P2</span><span>ORANGE</span><span id="status-1" class="player-status">未接続</span></div><div class="score-number"><span id="area-1">50.0</span><small id="score-unit-1">%</small></div><div id="score-extra-1" class="score-extra" hidden></div><div class="energy-line"><span>磁場エネルギー</span><span id="energy-text-1">100%</span></div><div class="energy-track"><div id="energy-1"></div></div></div>
          </div>
          <section id="control-panel" class="control-panel" hidden aria-label="拠点の占領状況"><div class="control-heading"><span class="eyebrow">CONTROL · 90 SECONDS</span><span id="control-guide">60%以上を1秒維持で占領 · 1拠点につき毎秒1点</span></div><div class="control-cards">${CONTROL_POINTS.map(p => `<div class="control-card" id="control-${p.id}"><div class="control-card-title"><strong>${p.id}</strong><span id="control-status-${p.id}">中立</span></div><div class="control-coverage"><i id="control-blue-${p.id}"></i></div><div class="control-card-info"><span id="control-coverage-${p.id}"></span><span id="control-owner-${p.id}">得点なし</span></div><div class="control-progress"><i id="control-progress-${p.id}"></i></div></div>`).join('')}</div></section>
          <div class="view-toolbar"><div class="view-switch" role="group" aria-label="盤面の表示方式"><button id="view-flat" aria-pressed="true" class="selected">平面版</button><button id="view-relief" aria-pressed="false">立体版 <small>NEW</small></button></div><div id="relief-controls" hidden><label>起伏 <input id="relief-height" type="range" min="3" max="14" value="8" aria-label="立体表示の高さ"><output id="relief-height-value">8</output></label><label>視点 <input id="relief-angle" type="range" min="35" max="75" value="52" aria-label="立体表示の視点角度"></label></div></div>
          <div class="arena-wrap"><canvas id="arena" aria-label="磁区の盤面。青がP1、オレンジがP2"></canvas><canvas id="arena-relief" aria-label="立体版。青い磁区は高く、オレンジは低い。P1はS極が下、P2はN極が下の棒磁石" hidden></canvas><div class="arena-top"><span><i></i> <span id="field-caption">LIVE FIELD</span></span><span id="map-label">橋の切断</span></div><div id="board-overlay" class="board-overlay"><div class="overlay-card"><span id="overlay-eyebrow">READY WHEN YOU ARE</span><h1 id="overlay-title">磁石を手に取ろう。</h1><p id="overlay-body">スマホで参加して、準備完了を押してください。</p><button id="rematch" class="primary" hidden>もう一度あそぶ</button></div></div><div class="arena-bottom"><span id="board-instruction">左手で動かす · 右手で磁場をかける</span><span id="field-label">磁場半径 ${DEFAULT_SETTINGS.fieldRadius}</span></div></div>
          <div id="relief-legend" hidden><span><i class="legend-blue"></i> P1：高い磁区 · S極が下</span><span><i class="legend-orange"></i> P2：低い磁区 · N極が下</span><small id="relief-scoring-note">高さは磁化の表示。勝敗は面積で判定。</small></div>
          <div class="arena-toolbar"><span id="match-note"><span class="status-dot"></span> 同じWi-Fiから参加</span><div><button id="pause" class="quiet" disabled>一時停止</button><button id="practice-reset" class="quiet" hidden>盤面リセット</button><button id="lobby" class="quiet" disabled>待機画面に戻る</button></div></div>
          <div class="howto"><div><span>01</span><div><b id="how-title-0">切る</b><p id="how-text-0">細い橋に磁場をかけよう。</p></div></div><div><span>02</span><div><b id="how-title-1">つなぐ</b><p id="how-text-1">消えそうな島を救おう。</p></div></div><div><span>03</span><div><b id="how-title-2">残す</b><p id="how-text-2">最後の5秒は、磁区を見守ろう。</p></div></div></div>
        </div>
        <aside id="host-menu" class="sidebar" aria-label="参加・ゲーム設定" hidden><div class="menu-heading"><strong>参加・ゲーム設定</strong><button id="menu-close" class="icon-button" aria-label="メニューを閉じる">×</button></div>
          <section class="join-card"><div class="section-heading"><span class="eyebrow">JOIN THE FIELD</span><span id="connection-count" class="count-badge">0 / 2</span></div><h2>スマホが、磁石になる。</h2><p>同じWi-Fiにつないで<br>QRコードを読み取ってください。</p><div class="qr-wrap"><canvas id="qr" aria-label="スマホ参加用QRコード"></canvas></div><label class="network-select">接続先 <select id="network" aria-label="参加用ネットワーク"></select></label><a id="join-url" target="_blank" rel="noopener">参加ページを開く ↗</a><p class="join-note">iPhoneを横持ちにして操作します。<br>つながらない場合はWi-FiのIPを選択。</p></section>
          <section class="setup-card"><span class="eyebrow">PLAY SETUP</span><div class="mode-switch" role="group" aria-label="ゲームモード"><button data-mode="battle" class="selected">二人対戦</button><button data-mode="practice">練習</button><button data-mode="control">拠点争奪</button></div><div class="map-heading"><h2 id="map-heading">盤面を選ぶ</h2><span id="map-count">3 FIELDS</span></div><div class="map-list">${MAPS.map((m, i) => `<button class="map-option ${i === 0 ? 'selected' : ''}" data-map="${m.id}"><span class="map-number">0${i + 1}</span><span><strong>${m.name}</strong><small>${m.description}</small></span><span class="map-radio"></span></button>`).join('')}</div><p id="setup-note" class="setup-note">二人とも準備完了で、試合が始まります。</p></section>
        </aside>
      </section>
      <footer><span>磁区バトル <b>PROTOTYPE 01</b></span><span id="footer-rule">磁場を離すと回復 · 総面積で勝負</span><span id="diagnostics">接続しています…</span></footer>
    </main>
    <dialog id="settings-dialog"><form id="settings-form"><div class="dialog-heading"><div><span class="eyebrow">FIELD SETTINGS</span><h2>遊びの手触りを調整</h2></div><button type="button" id="settings-close" class="icon-button" aria-label="閉じる">×</button></div><p id="settings-help">対戦前、または練習を一時停止して変更できます。</p><div class="settings-grid">${Object.entries(SETTING_META).map(([key, m]) => `<label>${m.label}<span><input type="number" name="${key}" min="${m.min}" max="${m.max}" step="${m.step}" required><small>${m.unit}</small></span></label>`).join('')}</div><div class="dialog-actions"><button type="button" id="defaults" class="quiet">初期値に戻す</button><button type="submit" id="settings-save" class="primary">設定を適用</button></div><div class="connection-tools"><b>プレイヤーの交代</b><p>待機画面で接続枠をリセットしてから、次の二人が参加してください。</p><button type="button" id="release" class="quiet">接続枠をリセット</button></div><p class="model-note">Allen–Cahn型の連続場 / 192 × 108<br>数値は試作用の無次元設定です。実際の磁性体を定量的に再現するものではありません。</p></form></dialog><div id="toast" role="status" hidden></div>`;
  // Keep the board in the viewport; occasional setup and help live in the drawer.
  const menu = $('#host-menu'), menuToggle = $('#menu-toggle');
  const help = document.createElement('details'); help.className = 'menu-help';
  help.innerHTML = '<summary>ルール・表示の説明</summary>';
  help.append($('.howto'), $('#relief-legend'), $('#match-note'));
  menu.append(help, $('.shell > footer'));
  const stage = document.createElement('div'); stage.className = 'arena-stage';
  const arena = $('.arena-wrap'); arena.before(stage); stage.append(arena);
  $('.arena-toolbar').prepend($('.view-toolbar'));
  const spinToggle = document.createElement('button');
  spinToggle.id = 'spin-toggle'; spinToggle.className = 'quiet';
  spinToggle.textContent = 'スピン：ON'; spinToggle.setAttribute('aria-pressed', 'true');
  spinToggle.title = '青は上向き、オレンジは下向き。矢印の長さは磁化の強さ。';
  $('.view-switch').after(spinToggle);
  const spinView = document.createElement('button');
  spinView.id = 'view-spins'; spinView.textContent = '立体スピン';
  spinView.setAttribute('aria-pressed', 'false');
  $('.view-switch').append(spinView);
  const spinCountControl = document.createElement('label');
  spinCountControl.id = 'spin-count-control'; spinCountControl.hidden = true;
  spinCountControl.innerHTML = '本数 <input id="spin-count" type="range" min="8" max="48" step="4" value="16" aria-label="立体スピンの表示数"><output id="spin-count-value">144本</output>';
  $('#relief-controls').prepend(spinCountControl);
  const spinCount = $<HTMLInputElement>('#spin-count');
  try {
    const saved = localStorage.getItem('jiku-spin-columns');
    if (saved !== null) spinCount.value = String(spinLayout(Number(saved)).columns);
  } catch {}
  function showSpinCount() {
    const layout = spinLayout(Number(spinCount.value));
    $('#spin-count-value').textContent = `${layout.count}本`;
    spinCount.setAttribute('aria-valuetext', `${layout.count}本（${layout.columns}列 × ${layout.rows}行）`);
  }
  showSpinCount();
  const fieldColorControl = document.createElement('label');
  fieldColorControl.innerHTML = '磁場の色 <input id="field-visibility" type="range" min="0" max="100" value="65" aria-label="磁場の色の強さ"><output id="field-visibility-value">65%</output>';
  fieldColorControl.title = '照射範囲の色と光の強さ。磁場の物理的な強さは変わりません。';
  $('#relief-controls').append(fieldColorControl);
  const fieldVisibility = $<HTMLInputElement>('#field-visibility');
  try {
    const saved = localStorage.getItem('jiku-field-visibility');
    if (saved !== null && Number.isFinite(Number(saved))) fieldVisibility.value = String(Math.max(0, Math.min(100, Number(saved))));
  } catch {}
  $('#field-visibility-value').textContent = `${fieldVisibility.value}%`;
  const spinHelp = document.createElement('p'); spinHelp.className = 'spin-help';
  spinHelp.textContent = '平面版の矢印は青が↑、オレンジが↓。「立体スピン」は本数スライダーで40〜1296本に調整できます。密度に合わせて矢印を小さくしますが、反転中の長さは一定です。磁化が変わると回転し、正負が反転すると青とオレンジが切り替わります。回転は磁化を見せる演出です。';
  help.append(spinHelp);
  new ResizeObserver(() => requestAnimationFrame(() => {
    const width = Math.max(0, Math.min(stage.clientWidth, stage.clientHeight * 16 / 9));
    arena.style.width = `${width}px`;
  })).observe(stage);
  function setMenu(open: boolean, returnFocus = false) {
    menu.hidden = !open; menuToggle.setAttribute('aria-expanded', String(open));
    if (open) $('#menu-close').focus(); else if (returnFocus) menuToggle.focus();
  }
  menuToggle.onclick = () => setMenu(menu.hidden);
  $('#menu-close').onclick = () => setMenu(false, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden && !$<HTMLDialogElement>('#settings-dialog').open) setMenu(false, true);
  });
  document.addEventListener('pointerdown', event => {
    if (!menu.hidden && event.target instanceof Node && !menu.contains(event.target) && !menuToggle.contains(event.target) && !$<HTMLDialogElement>('#settings-dialog').open) setMenu(false);
  });
  let info: { token: string; room: string; urls: string[]; localController: string };
  try { const res = await fetch('/api/host-info'); if (!res.ok) throw new Error(await res.text()); info = await res.json(); }
  catch (e) { $('#overlay-title').textContent = 'PCの画面を開けません'; $('#overlay-body').textContent = String(e); return; }
  const connection = new Connection(() => ({ type: 'hello', role: 'host', token: info.token }));
  const sound = new MagnetSound();
  const spins = new SpinOverlay();
  let showSpins = true;
  spinToggle.onclick = () => {
    showSpins = !showSpins;
    spinToggle.textContent = showSpins ? 'スピン：ON' : 'スピン：OFF';
    spinToggle.setAttribute('aria-pressed', String(showSpins));
    $('#field-caption').textContent = showSpins ? '↑ BLUE · ↓ ORANGE' : 'LIVE FIELD';
  };
  $('#field-caption').textContent = '↑ BLUE · ↓ ORANGE';
  let state: Snapshot | undefined, fps = 0, frames = 0, fpsStart = performance.now();
  let latest: Uint8Array | undefined, painted: Uint8Array | undefined;
  let pendingSetup: { mode: Mode; map: MapId } | undefined;
  let view3d = false, spin3d = false, contextLost = false, relief: ReliefRenderer | undefined;
  spinCount.oninput = () => {
    showSpinCount(); relief?.setSpinColumns(Number(spinCount.value));
    try { localStorage.setItem('jiku-spin-columns', spinCount.value); } catch {}
  };
  fieldVisibility.oninput = () => {
    $('#field-visibility-value').textContent = `${fieldVisibility.value}%`;
    relief?.setFieldVisibility(Number(fieldVisibility.value) / 100);
    try { localStorage.setItem('jiku-field-visibility', fieldVisibility.value); } catch {}
  };
  const reliefCanvas = $<HTMLCanvasElement>('#arena-relief');
  const canvas = $<HTMLCanvasElement>('#arena'), ctx = canvas.getContext('2d')!;
  const fieldCanvas = document.createElement('canvas'); fieldCanvas.width = WIDTH; fieldCanvas.height = HEIGHT;
  const fieldCtx = fieldCanvas.getContext('2d')!, pixels = fieldCtx.createImageData(WIDTH, HEIGHT);
  const palette = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255, edge = Math.exp(-(((t - 0.5) / 0.06) ** 2)) * 0.6;
    const base = t >= 0.5 ? [37, 124, 180] : [225, 133, 81];
    const light = 0.9 + 0.1 * Math.abs(2 * t - 1);
    for (let c = 0; c < 3; c++) palette[i * 3 + c] = Math.round(base[c] * light * (1 - edge) + 244 * edge);
  }
  function draw() {
    requestAnimationFrame(draw);
    frames++; if (performance.now() - fpsStart > 1000) { fps = frames * 1000 / (performance.now() - fpsStart); frames = 0; fpsStart = performance.now(); }
    if (view3d && relief) { relief.render(latest, state, performance.now()); return; }
    const rect = canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio, 2);
    const width = Math.round(rect.width * ratio), height = Math.round(rect.height * ratio);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    if (!width || !height) return;
    if (latest && latest !== painted) {
      for (let i = 0; i < latest.length; i++) { const k = latest[i] * 3; pixels.data[i * 4] = palette[k]; pixels.data[i * 4 + 1] = palette[k + 1]; pixels.data[i * 4 + 2] = palette[k + 2]; pixels.data[i * 4 + 3] = 255; }
      fieldCtx.putImageData(pixels, 0, 0); painted = latest;
    }
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(fieldCanvas, 0, 0, width, height);
    ctx.fillStyle = 'rgba(5,18,30,.055)';
    const unit = width / WIDTH;
    if (showSpins && latest) spins.draw(ctx, latest, width, height, ratio);
    else for (let x = 0; x < WIDTH; x += 8) for (let y = 0; y < HEIGHT; y += 8) ctx.fillRect(x * unit, y * unit, ratio, ratio);
    if (!state) return;
    if (state.control) drawControlPoints(ctx, state.control, unit, ratio);
    for (const p of state.players) {
      const x = (p.x + 0.5) * unit, y = (p.y + 0.5) * unit, radius = state.settings.fieldRadius * unit;
      ctx.save(); ctx.strokeStyle = p.active ? '#fff' : 'rgba(255,255,255,.75)'; ctx.lineWidth = (p.active ? 2 : 1) * ratio;
      ctx.setLineDash(p.active ? [] : [4 * ratio, 4 * ratio]);
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
      if (p.active) { ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fill(); }
      ctx.setLineDash([]); ctx.strokeStyle = '#142333'; ctx.lineWidth = 2 * ratio;
      ctx.beginPath(); ctx.moveTo(x - 5 * ratio, y); ctx.lineTo(x + 5 * ratio, y); ctx.moveTo(x, y - 5 * ratio); ctx.lineTo(x, y + 5 * ratio); ctx.stroke();
      const labelY = Math.max(15 * ratio, Math.min(height - 15 * ratio, y - radius - 12 * ratio));
      const labelX = Math.max(16 * ratio, Math.min(width - 16 * ratio, x));
      ctx.fillStyle = '#142333'; ctx.beginPath(); ctx.roundRect(labelX - 16 * ratio, labelY - 10 * ratio, 32 * ratio, 20 * ratio, 5 * ratio); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `bold ${10 * ratio}px system-ui`; ctx.fillText(`P${p.id + 1}`, labelX, labelY); ctx.restore();
    }
  }
  draw();
  let toastTimer: ReturnType<typeof setTimeout>;
  function toast(text: string, duration = 6000) { $('#toast').textContent = text; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, duration); }
  const soundButton = $<HTMLButtonElement>('#sound-toggle');
  const volumeSlider = $<HTMLInputElement>('#sound-volume');
  try {
    const saved = localStorage.getItem('jiku-sound-volume');
    if (saved !== null && Number.isFinite(Number(saved))) volumeSlider.value = String(Math.max(0, Math.min(100, Number(saved))));
  } catch {}
  sound.setVolume(Number(volumeSlider.value) / 100);
  sound.onChange = () => {
    soundButton.setAttribute('aria-pressed', String(sound.enabled && !!sound.running));
    soundButton.textContent = sound.enabled ? sound.running ? '音：ON' : '音を再開' : '音をON';
  };
  soundButton.onclick = async () => {
    try {
      if (sound.enabled && sound.running) sound.mute(); else await sound.enable();
    } catch (error) { toast(error instanceof Error ? error.message : '効果音を開始できませんでした'); }
  };
  $('#sound-preview').onclick = async () => {
    try { await sound.enable(); sound.preview(); }
    catch (error) { toast(error instanceof Error ? error.message : '効果音を開始できませんでした'); }
  };
  volumeSlider.oninput = () => {
    sound.setVolume(Number(volumeSlider.value) / 100);
    try { localStorage.setItem('jiku-sound-volume', volumeSlider.value); } catch {}
  };
  async function setView(use3d: boolean, spinOnly = false) {
    spinView.disabled = true;
    $<HTMLButtonElement>('#view-relief').disabled = true;
    $<HTMLButtonElement>('#view-flat').disabled = true;
    try {
      if (use3d && !relief) {
        const module = await import('./relief');
        relief = new module.ReliefRenderer(reliefCanvas);
        relief.setSpinColumns(Number(spinCount.value));
        relief.setFieldVisibility(Number(fieldVisibility.value) / 100);
        relief.setHeight(Number($<HTMLInputElement>('#relief-height').value));
        relief.setAngle(Number($<HTMLInputElement>('#relief-angle').value));
      }
      view3d = use3d; spin3d = use3d && spinOnly;
      relief?.setSpinOnly(spin3d);
    } catch (error) {
      view3d = false; spin3d = false;
      console.warn('3D view unavailable', error);
      toast('この環境では立体表示を使えません。平面版で続けられます。');
    } finally {
      canvas.hidden = view3d; reliefCanvas.hidden = !view3d;
      $('#relief-controls').hidden = $('#relief-legend').hidden = !view3d;
      $<HTMLInputElement>('#relief-height').closest('label')!.hidden = spin3d;
      spinCountControl.hidden = !spin3d;
      $('#relief-legend .legend-blue')!.parentElement!.lastChild!.textContent = spin3d ? ' P1：青い上向きスピン' : ' P1：高い磁区 · S極が下';
      $('#relief-legend .legend-orange')!.parentElement!.lastChild!.textContent = spin3d ? ' P2：オレンジの下向きスピン' : ' P2：低い磁区 · N極が下';
      $('.arena-wrap').classList.toggle('relief-view', view3d);
      $('#view-flat').classList.toggle('selected', !view3d); $('#view-relief').classList.toggle('selected', view3d && !spin3d);
      spinView.classList.toggle('selected', spin3d); spinView.setAttribute('aria-pressed', String(spin3d));
      $('#view-flat').setAttribute('aria-pressed', String(!view3d)); $('#view-relief').setAttribute('aria-pressed', String(view3d && !spin3d));
      spinToggle.hidden = view3d;
      reliefCanvas.setAttribute('aria-label', spin3d ? '立体スピン。青は上向き、オレンジは下向き。一定の長さで回転し、反転すると色が変わります' : '立体版。青い磁区は高く、オレンジは低い。P1はS極が下、P2はN極が下の棒磁石');
      $('#field-caption').textContent = spin3d ? 'SPIN FIELD · ↑ BLUE / ↓ ORANGE' : view3d ? 'RELIEF FIELD · 3D' : showSpins ? '↑ BLUE · ↓ ORANGE' : 'LIVE FIELD';
      $('#relief-scoring-note').textContent = (spin3d ? '回転は磁化の表示。' : '高さは磁化の表示。') + (state?.control ? '勝敗は拠点の累計得点。' : '勝敗は面積で判定。');
      const url = new URL(location.href);
      if (view3d) url.searchParams.set('view', spin3d ? 'spins' : '3d'); else url.searchParams.delete('view');
      history.replaceState(null, '', url);
      $<HTMLButtonElement>('#view-relief').disabled = contextLost;
      $<HTMLButtonElement>('#view-flat').disabled = false;
      spinView.disabled = contextLost;
    }
  }
  $('#view-flat').onclick = () => void setView(false);
  $('#view-relief').onclick = () => void setView(true);
  spinView.onclick = () => void setView(true, true);
  $('#relief-height').oninput = () => {
    const value = Number($<HTMLInputElement>('#relief-height').value);
    $('#relief-height-value').textContent = String(value); relief?.setHeight(value);
  };
  $('#relief-angle').oninput = () => relief?.setAngle(Number($<HTMLInputElement>('#relief-angle').value));
  reliefCanvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); contextLost = true; void setView(false);
    toast('立体描画が中断されたため平面版に戻しました。立体版へ戻るには再読み込みしてください。');
  });
  const urls = info.urls.length ? info.urls : [info.localController];
  const network = $<HTMLSelectElement>('#network');
  for (const url of urls) { const option = document.createElement('option'); option.value = url; option.textContent = new URL(url).hostname; network.append(option); }
  async function updateQR() {
    await QRCode.toCanvas($<HTMLCanvasElement>('#qr'), network.value, { width: 172, margin: 1, color: { dark: '#142333', light: '#ffffff' }, errorCorrectionLevel: 'M' });
    $<HTMLAnchorElement>('#join-url').href = network.value;
  }
  network.onchange = () => void updateQR(); await updateQR();
  if (!info.urls.length) toast('Wi-Fiのアドレスが見つかりません。接続後にこの画面を再読み込みしてください。');
  connection.onFrame = frame => {
    if (frame.length !== WIDTH * HEIGHT) return;
    latest = frame;
    if (state) sound.update(frame, state);
  };
  connection.onStatus = connected => {
    if (!connected) { pendingSetup = undefined; sound.silence(); $('#overlay-title').textContent = 'PCサーバーに再接続中'; $('#overlay-body').textContent = '起動したターミナルとWi-Fi接続を確認してください。'; $('#board-overlay').hidden = false; }
  };
  connection.onMessage = msg => { if (msg.type === 'error') { pendingSetup = undefined; toast(msg.message); } };
  const phaseLabels = { lobby: '接続待ち', countdown: 'まもなく開始', playing: '磁場を操作', relaxing: '自然緩和', paused: '一時停止', finished: '試合終了' };
  connection.onState = s => {
    if (state && (s.phase !== state.phase || s.map !== state.map || s.elapsed < state.elapsed)) sound.silence();
    if (s.control && state?.control && s.phase === 'playing') {
      const changes = s.control.points.filter((p, i) => p.owner !== state!.control!.points[i]?.owner);
      if (changes.length) toast(changes.map(p => p.owner === null ? `拠点 ${p.id} が中立に` : `P${p.owner + 1} が拠点 ${p.id} を占領！`).join(' ／ '), 2400);
    }
    if (s.phase === 'countdown' && state?.phase !== 'countdown') setMenu(false);
    state = s;
    if (pendingSetup && ((s.mode === pendingSetup.mode && s.map === pendingSetup.map) || !['lobby', 'finished'].includes(s.phase))) pendingSetup = undefined;
    const control = s.control;
    document.body.classList.toggle('control-mode', !!control);
    $('#control-panel').hidden = !control;
    if (control) for (const point of control.points) {
      const card = $(`#control-${point.id}`);
      card.dataset.owner = point.owner === null ? 'neutral' : String(point.owner);
      card.dataset.claimant = point.claimant === null ? '' : String(point.claimant);
      $(`#control-status-${point.id}`).textContent = pointStatus(point);
      $(`#control-blue-${point.id}`).style.width = `${point.coverage[0] * 100}%`;
      $(`#control-coverage-${point.id}`).textContent = `青 ${Math.round(point.coverage[0] * 100)}% / 橙 ${Math.round(point.coverage[1] * 100)}%`;
      $(`#control-owner-${point.id}`).textContent = point.owner === null ? '得点なし' : s.phase === 'playing' ? '+1点/秒' : '保持中';
      $(`#control-progress-${point.id}`).style.width = `${point.progress * 100}%`;
    }
    const waiting = s.phase === 'lobby' || s.phase === 'finished';
    const editable = waiting || (s.phase === 'paused' && s.mode === 'practice');
    for (const p of s.players) {
      $(`#area-${p.id}`).textContent = control ? control.scores[p.id].toFixed(s.phase === 'finished' ? 2 : 1) : percent(s.area[p.id]);
      $(`#score-unit-${p.id}`).textContent = control ? '点' : '%';
      $(`#score-extra-${p.id}`).hidden = !control;
      $(`#score-extra-${p.id}`).textContent = control ? `${s.phase === 'playing' ? `+${control.rates[p.id]}点/秒` : `${control.rates[p.id]}拠点を保持`} · 面積 ${percent(s.area[p.id])}%` : '';
      $(`#energy-${p.id}`).style.width = `${p.energy * 100}%`;
      $(`#energy-text-${p.id}`).textContent = p.energy < 1e-9 ? '離すと回復' : `${Math.round(p.energy * 100)}%`;
      $(`#status-${p.id}`).textContent = !p.connected ? '未接続' : !p.available ? '復帰待ち' : p.ready ? '準備完了' : s.mode === 'practice' && !s.participants.includes(p.id) ? '見学' : '接続中';
      $(`#status-${p.id}`).classList.toggle('online', p.connected && p.available);
    }
    $('#connection-count').textContent = `${s.players.filter(p => p.connected && p.available).length} / 2`;
    $('#phase-label').textContent = control && s.phase === 'playing' ? '拠点争奪' : phaseLabels[s.phase];
    $('#time').innerHTML = s.mode === 'practice' ? '∞<small>練習</small>' : `${Math.ceil(s.remaining)}<small>秒</small>`;
    $('#phase-hint').textContent = s.phase === 'relaxing' ? '操作を止めて、見守ろう' : s.mode === 'practice' ? '時間制限なし' : control ? '保持時間の合計で勝負' : '75秒操作 ＋ 5秒緩和';
    $('#map-label').textContent = control ? 'A・B・C 拠点争奪' : MAPS.find(m => m.id === s.map)!.name;
    $('#map-heading').textContent = control ? '拠点用の固定盤面' : '盤面を選ぶ';
    $('#map-count').textContent = control ? '3 BASES' : '3 FIELDS';
    $('#relief-scoring-note').textContent = (spin3d ? '回転は磁化の表示。' : '高さは磁化の表示。') + (control ? '勝敗は拠点の累計得点。' : '勝敗は面積で判定。');
    $('#footer-rule').textContent = control ? '拠点を保持して得点 · 60%未満で中立に' : '磁場を離すと回復 · 総面積で勝負';
    const instructions = control ? [['占領', '円内の60%以上を、1秒維持。'], ['守る', '1拠点を保持するごとに毎秒1点。'], ['奪う', '橋や拠点を攻め、相手の得点を止めよう。']] : [['切る', '細い橋に磁場をかけよう。'], ['つなぐ', '消えそうな島を救おう。'], ['残す', '最後の5秒は、磁区を見守ろう。']];
    instructions.forEach(([title, text], i) => { $(`#how-title-${i}`).textContent = title; $(`#how-text-${i}`).textContent = text; });
    $('#field-label').textContent = `磁場半径 ${s.settings.fieldRadius}`;
    $('#board-instruction').textContent = s.phase === 'relaxing' ? '最後の5秒。つくった形が、どれだけ残るか。' : control ? '円の60%以上を1秒維持して占領' : '左手で動かす · 右手で磁場をかける';
    $('#setup-note').textContent = s.mode === 'practice' ? '1人で練習できます。スマホで準備完了を押してください。' : control ? '橋の先にA・C、中央にB。二人とも準備完了で開始します。' : '二人とも準備完了で、試合が始まります。';
    document.querySelectorAll<HTMLButtonElement>('[data-map]').forEach(b => { b.disabled = !waiting || !!pendingSetup || !!control; b.classList.toggle('selected', b.dataset.map === s.map); });
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => { b.disabled = !waiting || !!pendingSetup; b.classList.toggle('selected', b.dataset.mode === s.mode); });
    $<HTMLButtonElement>('#pause').disabled = !['playing', 'relaxing', 'countdown'].includes(s.phase);
    $<HTMLButtonElement>('#lobby').disabled = s.phase === 'lobby';
    $('#practice-reset').hidden = !(s.mode === 'practice' && s.phase === 'paused');
    $<HTMLButtonElement>('#settings-save').disabled = !editable;
    $<HTMLButtonElement>('#defaults').disabled = !editable;
    $<HTMLButtonElement>('#release').disabled = !waiting;
    document.querySelectorAll<HTMLInputElement>('#settings-form input').forEach(i => { i.disabled = !editable; });
    $('#settings-help').textContent = editable ? '両者に同じ設定を適用します。練習で手触りを試してください。' : '対戦中は変更できません。練習では一時停止して調整できます。';
    const overlay = $('#board-overlay'); overlay.dataset.phase = s.phase; overlay.hidden = ['playing', 'relaxing'].includes(s.phase);
    $('#rematch').hidden = s.phase !== 'finished';
    if (s.phase === 'lobby') {
      $('#overlay-eyebrow').textContent = s.mode === 'practice' ? 'FREE PRACTICE' : control ? 'CONTROL THE FIELD' : 'READY WHEN YOU ARE';
      $('#overlay-title').textContent = s.mode === 'practice' ? 'まずは、磁区に触れよう。' : control ? '3つの拠点を、奪い合おう。' : '磁石を手に取ろう。';
      $('#overlay-body').textContent = s.mode === 'practice' ? 'スマホ1台で参加して、準備完了を押してください。' : control ? '90秒の保持時間勝負。二人のスマホで準備完了。' : '二人のスマホで、準備完了を押してください。';
    } else if (s.phase === 'countdown') {
      $('#overlay-eyebrow').textContent = 'GET READY'; $('#overlay-title').textContent = String(s.countdown); $('#overlay-body').textContent = 'PCを見て、左手をスティックに。';
    } else if (s.phase === 'paused') {
      $('#overlay-eyebrow').textContent = 'PAUSED'; $('#overlay-title').textContent = 'ひと休み。'; $('#overlay-body').textContent = `${s.pauseReason}。スマホで準備完了を押すと再開します。`;
    } else if (s.phase === 'finished') {
      $('#overlay-eyebrow').textContent = control ? 'FINAL SCORE' : 'FINAL AREA'; $('#overlay-title').textContent = s.winner === 'draw' ? '引き分け！' : `P${Number(s.winner) + 1} の勝ち！`;
      $('#overlay-body').textContent = control ? `BLUE ${control.scores[0].toFixed(2)}点  /  ORANGE ${control.scores[1].toFixed(2)}点` : `BLUE ${percent(s.area[0])}%  /  ORANGE ${percent(s.area[1])}%`;
    }
    $('#match-note').textContent = s.phase === 'paused' ? '● 再開はスマホの準備完了から' : s.mode === 'practice' ? '● 練習中はPCで停止・調整できます' : control ? '● 90秒後、拠点の累計得点が多い方の勝ち' : '● 終了時の面積が多い方の勝ち';
    $('#diagnostics').textContent = `${Math.round(fps)} fps · 通信往復 ${Math.round(connection.rtt)} ms · 計算 ${s.tickMs.toFixed(1)} ms`;
  };
  function selectSetup(mode: Mode, map: MapId) {
    if (!connection.connected || pendingSetup) return;
    pendingSetup = { mode, map: mode === 'control' ? 'bridges' : map };
    // Wait for the server to acknowledge a selection before another click can
    // accidentally send a stale mode together with a newly chosen map.
    document.querySelectorAll<HTMLButtonElement>('[data-map], [data-mode]').forEach(b => { b.disabled = true; });
    connection.send({ type: 'host', action: 'setup', ...pendingSetup });
  }
  document.querySelectorAll<HTMLButtonElement>('[data-map]').forEach(b => b.onclick = () => selectSetup(state?.mode ?? 'battle', b.dataset.map as MapId));
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.onclick = () => selectSetup(b.dataset.mode as Mode, state?.map ?? 'bridges'));
  $('#pause').onclick = () => connection.send({ type: 'host', action: 'pause' });
  $('#practice-reset').onclick = () => connection.send({ type: 'host', action: 'reset' });
  $('#lobby').onclick = $('#rematch').onclick = () => connection.send({ type: 'host', action: 'lobby' });
  const dialog = $<HTMLDialogElement>('#settings-dialog');
  function fillSettings(settings: Settings) { for (const [key, value] of Object.entries(settings)) $<HTMLInputElement>(`input[name="${key}"]`).value = String(value); }
  $('#settings-open').onclick = () => { fillSettings(state?.settings ?? DEFAULT_SETTINGS); dialog.showModal(); };
  $('#settings-close').onclick = () => dialog.close();
  $('#defaults').onclick = () => fillSettings(DEFAULT_SETTINGS);
  $('#release').onclick = () => { connection.send({ type: 'host', action: 'release' }); dialog.close(); };
  $('#settings-form').onsubmit = event => {
    event.preventDefault();
    const settings = Object.fromEntries([...new FormData($<HTMLFormElement>('#settings-form')).entries()].map(([k, v]) => [k, Number(v)])) as unknown as Settings;
    connection.send({ type: 'host', action: 'settings', settings }); dialog.close();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) sound.silence();
    connection.send({ type: 'visibility', visible: !document.hidden });
  });
  window.addEventListener('pagehide', () => sound.silence());
  connection.open();
  if (new URLSearchParams(location.search).get('view') === '3d') await setView(true);
  if (new URLSearchParams(location.search).get('view') === 'spins') await setView(true, true);
}
