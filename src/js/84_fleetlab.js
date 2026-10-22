// ───────────────────────── 擬真沙盒（TASK-0679；Tim 2026-10-17） ─────────────────────────
// Tim：「是否可以加入一個擬真沙盒(參考目前沙盒 另外一個頁面) 區別在判定完全跟遊戲本體相同 只是只有在需要時才去渲染畫面 且畫面相關物理全關閉
//   然後可以開高倍速 & 降低物理fps(艦隊指揮不追求高精度物理模擬) 帆繩這類畫面相關物理全關」
// 入口：根目錄 fleetlab.html ⇒ index.html?lab=fleet（LAB_FLEET，00_core.js）。跟 2D 沙盒（sandbox.html，自己一套簡化的模擬）不同：這裡跑的是遊戲本體的 step()（50_sim.js），
//   規則、命中、進水、指揮官、艦長全部同一份；設定照玩家的存檔讀（⛔ 不寫回，69_prefs.js）。
// 跟遊戲不一樣的只有「給人看的」：
//   · 物理分級（09_phx.js）裡只管畫面的那幾項關到最低：帆與繩關、遠方帆繩照常、碎木 20%、煙與水花 40%、船邊水花關、沉船進水關、帆的碰撞關；
//     會改戰局的（進水的模式、船隻碰撞、摩擦、碰撞傷害、殉爆波及）照玩家的設定不動。⚠ 帆與繩關 ⇒ 帆桁不追風（30_rig_physics.js：帆桁的角度會改到打中帆桁的那幾下），Tim 要全關，照關。
//   · 只看俯視圖時：不畫 3D、不建網格、模擬裡「只給人看的推進」（碎木、粒子、煙；viewStep）不推（FLAB_HIDE）；按「看實景」才建網格、畫 3D（鏡頭跟著選的那艘）。
//   · 步長：物理 60／30／20／15／10 Hz（DT；每半秒、每 3 秒那幾件照秒數換步數 everySteps）。60 Hz ⇒ 跟遊戲逐步相同；降下來 ⇒ 同一套程式、粗一點的步，結果會不一樣（量法見 README）。
//   · 倍速：1／4／16／64 倍或「最快」（照時間預算一直走）；模擬放在 MessageChannel 一片一片走（每片 12 ms 就讓出來）⇒ 畫面與按鈕照常回應。
// 一場：電腦對電腦（MODE eve）、藍紅各一型 × 艘數、各自的策略與搶上風、開局距離、風向／風速（WIND_FIX；空白 ＝ 照種子）、種子、時限。
//   結束：一方全沉或降旗（teamDown）⇒ 另一方贏；到時限 ⇒ 照剩下的戰力判（跟 #dump 的 pow 同一把尺：cmdStrength 加總），差 < 0.05 艘 ⇒ 和局。
// 批次：目前這組（藍策略 對 紅策略）或四種策略兩兩，每格 N 場（一半換邊），出勝率表（跟 2D 沙盒同一個格式）。
// 記錄（Tim 2026-10-17「沙盒可以記錄航行軌跡圖以及其他資訊方便DEBUG」）：每一場每半秒一筆（flabRec）—— 每艘 FLAB_COLS（位置、航向、節、船殼、砲、人、帆、中幾發、命令、目標、打法、離站位、站位、出局）、
//   風（吹去的方向°、節）、兩方搶上風的進度；艦長與指揮官的每個決定（rptHelm 事件：[秒, 第幾艘, 種類, 理由]）。只記、不改戰局。
//   畫面：「🧭 軌跡」⇒ 整場每艘的航跡＋時間軸（拖到哪一秒就畫那一秒的船位、目標線、站位）；點一艘 ⇒ 右下畫它的時間線與決定紀錄；「⬇ 匯出」⇒ 整場 JSON（參數、結果、記錄）。
var FLAB = { tl: null, run: false, view: 'map', speed: 16, match: null, batch: null, sel: null, cam: null, drag: null, last: 0, simRate: 0, kicked: false };
var FLAB_HIDE = false;                                                   // 50_sim.js step：true ⇒ 不發 viewStep
var FLAB_HZ = [60, 30, 20, 15, 10], FLAB_SPEEDS = [1, 4, 16, 64, Infinity];
var FLAB_MC = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
function flabEl(id) { return document.getElementById(id); }
/** 載完船型（90_main.js 載入那一段）：進沙盒的畫面、關畫面那幾項物理、照網址填預設值。 */
function flabInit() {
  document.body.classList.add('flab'); uiAway();
  ['rig', 'debris', 'fx', 'water', 'sinkflood', 'sailhit'].forEach(function (k) { PHX[k] = 0; }); PHX.rigfar = 0; setPhys(false);
  SAIL = 'auto'; muted = true;
  var hs = flabEl('flabHB'), hr = flabEl('flabHR');
  HULL_LIST.forEach(function (h) { [hs, hr].forEach(function (s) { var o = document.createElement('option'); o.value = h.id; o.textContent = h.name; s.appendChild(o); }); });
  [flabEl('flabCB'), flabEl('flabCR')].forEach(function (s) { CMD_STRATS.forEach(function (k) { var o = document.createElement('option'); o.value = k; o.textContent = CMD_NAMES[k]; s.appendChild(o); }); });
  FLAB_HZ.forEach(function (h) { var o = document.createElement('option'); o.value = h; o.textContent = h + ' Hz'; flabEl('flabHz').appendChild(o); });
  function q(k, d) { return Q.has(k) ? Q.get(k) : d; }
  flabEl('flabNB').value = q('nb', 4); flabEl('flabNR').value = q('nr', 4);
  hs.value = q('hb', HULL_LIST[0].id); hr.value = q('hr', HULL_LIST[0].id);
  flabEl('flabCB').value = q('cb', 'line'); flabEl('flabCR').value = q('cr', 'pair');
  flabEl('flabGB').checked = q('gb', '0') === '1'; flabEl('flabGR').checked = q('gr', '0') === '1';
  flabEl('flabDist').value = q('dist', 800); flabEl('flabWdir').value = q('wdir', ''); flabEl('flabWspd').value = q('wspd', '');
  flabEl('flabSeed').value = q('seed', 1); flabEl('flabHz').value = q('hz', 20); flabEl('flabT').value = q('tmax', 600); flabEl('flabBN').value = q('bn', 4);
  flabEl('flabGo').onclick = function () { flabStart(flabParams()); };
  flabEl('flabPause').onclick = function () { FLAB.run = !FLAB.run; this.textContent = FLAB.run ? '暫停' : '繼續'; if (FLAB.run) flabKick(); };
  [].forEach.call(document.querySelectorAll('#flabSpd button'), function (b) { b.onclick = function () { FLAB.speed = +b.dataset.s || Infinity; flabSpdShow(); }; });
  flabEl('flabView').onclick = function () { flabSetView(FLAB.view === '3d' ? 'map' : '3d'); };
  flabEl('flabTrace').onclick = function () { flabSetView(FLAB.view === 'trace' ? 'map' : 'trace'); };
  flabEl('flabTL').oninput = function () { FLAB.tl = +this.value; };
  flabEl('flabExp').onclick = flabExport;
  flabEl('flabBgo').onclick = flabBatchToggle;
  var cv = flabEl('flabCv');
  cv.addEventListener('wheel', function (e) { e.preventDefault(); var C = flabCam(); C.auto = false; C.k *= Math.exp(-e.deltaY * 0.0015); }, { passive: false });
  cv.addEventListener('pointerdown', function (e) { FLAB.drag = { x: e.clientX, y: e.clientY, moved: false }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', function (e) { var D = FLAB.drag; if (!D) return; var C = flabCam(); if (Math.abs(e.clientX - D.x) + Math.abs(e.clientY - D.y) > 3) D.moved = true; if (D.moved) { C.auto = false; C.x -= (e.clientX - D.x) / C.k; C.z -= (e.clientY - D.y) / C.k; D.x = e.clientX; D.y = e.clientY; } });
  cv.addEventListener('pointerup', function (e) { var D = FLAB.drag; FLAB.drag = null; if (D && !D.moved) flabPick(e); });
  cv.addEventListener('dblclick', function () { flabCam().auto = true; });
  if (FLAB_MC) FLAB_MC.port1.onmessage = flabPump;
  flabSpdShow();
  if (Q.get('go') === '1') flabStart(flabParams());
}
function flabSpdShow() { [].forEach.call(document.querySelectorAll('#flabSpd button'), function (b) { b.className = (+b.dataset.s || Infinity) === FLAB.speed ? 'on' : ''; }); }
/** 畫面上的設定 ⇒ 一場的參數。 */
function flabParams() {
  function n(id, d, lo, hi) { var v = parseFloat(flabEl(id).value); return isFinite(v) ? clamp(v, lo, hi) : d; }
  function opt(id) { var v = flabEl(id).value.trim(); return v === '' || !isFinite(+v) ? null : +v; }
  return { blue: { n: Math.round(n('flabNB', 4, 1, FLEET_MAX)), hull: flabEl('flabHB').value, strat: flabEl('flabCB').value, gauge: flabEl('flabGB').checked },
    red: { n: Math.round(n('flabNR', 4, 1, FLEET_MAX)), hull: flabEl('flabHR').value, strat: flabEl('flabCR').value, gauge: flabEl('flabGR').checked },
    dist: Math.round(n('flabDist', 800, LIM_DIST[0], LIM_DIST[1])), wdir: opt('flabWdir'), wspd: opt('flabWspd'), seed: Math.round(n('flabSeed', 1, 1, 1e9)),
    hz: +flabEl('flabHz').value || 20, tmax: n('flabT', 600, 30, 7200) };
}
/** 編成：我艦（藍第一艘）、敵方第一艘、我方其他、敵方其他（＝ 52_fleet.js fleetSpec 的順序）。 */
function flabSpec(p) {
  var L = [{ team: 'blue', hull: p.blue.hull }, { team: 'red', hull: p.red.hull }], i;
  for (i = 1; i < p.blue.n; i++) L.push({ team: 'blue', hull: p.blue.hull });
  for (i = 1; i < p.red.n; i++) L.push({ team: 'red', hull: p.red.hull });
  return L;
}
/** 開一場（船型先載好）：照參數設好全域（步長、種子、風、距離、指揮官）⇒ reset（70_flow.js，跟遊戲開局同一條）。回傳 Promise。 */
function flabSetup(p) {
  var ids = {}; ids[p.blue.hull] = 1; ids[p.red.hull] = 1;
  return Promise.all(Object.keys(ids).map(loadHull)).then(function () {
    DT = 1 / p.hz; SEED = p.seed >>> 0 || 1; WIND_FIX = { rot: p.wdir, s0: p.wspd }; DIST = p.dist;
    CMD_SIDE.blue = p.blue.strat; CMD_SIDE.red = p.red.strat; CMD_GAUGE.blue = p.blue.gauge; CMD_GAUGE.red = p.red.gauge;
    flowMode('eve'); FLEET_DBG = flabSpec(p); FIELD_N = Math.min(MAX_SHIPS, Math.max(2, FLEET_DBG.length));
    reset(); flowRun(true); SIGNAL = null;
    FLAB.match = { p: p, steps: 0, acc: 0, lastR: 0, t0: performance.now(), down: { blue: null, red: null }, res: null, simT0: 0, realT0: performance.now(),
      rec: { every: 0.5, hz: p.hz, ships: [], wind: [], gauge: { blue: [], red: [] }, helm: [] } };
    FLAB.tl = null; flabRec(FLAB.match);
    FLAB.cam = null; FLAB.sel = FLAB.sel !== null && FLAB.sel < SHIPS.length ? FLAB.sel : 0;
    if (FLAB.view === '3d') flabSetView('3d');
    return FLAB.match;
  });
}
function flabStart(p) {
  if (FLAB.batch && !FLAB.batch.done) { FLAB.batch.stop = true; }
  FLAB.run = false; flabEl('flabMsg').textContent = '載入中…';
  flabSetup(p).then(function () { FLAB.run = true; flabEl('flabPause').textContent = '暫停'; flabEl('flabMsg').textContent = ''; flabKick(); });
}
function flabKick() { if (FLAB.kicked) return; FLAB.kicked = true; if (FLAB_MC) FLAB_MC.port2.postMessage(0); else setTimeout(flabPump, 0); }
/** 一片模擬：最多 12 ms；照倍速欠多少模擬時間就走多少步（最快 ＝ 走滿時間預算）。一場打完 ⇒ 記結果（批次 ⇒ 接下一場）。 */
function flabPump() {
  FLAB.kicked = false;
  var M = FLAB.match; if (!M || !FLAB.run || M.res) return;
  var now = performance.now(), dtR = M.lastR ? Math.min(0.25, (now - M.lastR) / 1000) : 0; M.lastR = now;
  var batch = FLAB.batch && !FLAB.batch.done && !FLAB.batch.stop;
  if (FLAB.speed !== Infinity && !batch) M.acc = Math.min(M.acc + dtR * FLAB.speed, 2);
  var ev = everySteps(0.5);
  while (performance.now() - now < 12) {
    if (FLAB.speed !== Infinity && !batch) { if (M.acc < DT) break; M.acc -= DT; }
    simStep(); M.steps++;
    if (M.steps % ev === 0) { flabRec(M); if (flabCheck(M)) { flabFinish(M); return; } }
  }
  var rt = (performance.now() - (M.rateT || 0)) / 1000; if (!M.rateT || rt > 1) { if (M.rateT) FLAB.simRate = (SIMT - M.rateS) / rt; M.rateT = performance.now(); M.rateS = SIMT; }   // 實際倍速（模擬秒 ÷ 真實秒，每秒量一次；⛔ 放在畫面那一格 ⇒ 分頁在背景時不畫、讀數停在 0）
  if (FLAB.speed !== Infinity && !batch && M.acc < DT) setTimeout(flabKick, 4); else flabKick();
}
/** 打完了沒：一方全出局（沉、降旗、沒有候補）或到時限。 */
function flabCheck(M) {
  ['blue', 'red'].forEach(function (tm) { if (M.down[tm] === null && teamDown(tm)) M.down[tm] = +SIMT.toFixed(1); });
  return M.down.blue !== null || M.down.red !== null || SIMT >= M.p.tmax;
}
/** 這一場的結果（跟 #dump 的 pow 同一把尺）。 */
function flabResult(M) {
  var CV = cmdView('blue').ships, pow = { blue: 0, red: 0 }, left = { blue: 0, red: 0 }, hits = { blue: 0, red: 0 };
  CV.forEach(function (v) { if (!v.out) { pow[v.team] += cmdStrength(v); left[v.team]++; } });
  SHIPS.forEach(function (s) { hits[s.team] += s.hits; });
  var winner = null, judged = false;
  if (M.down.blue !== null && M.down.red === null) winner = 'red'; else if (M.down.red !== null && M.down.blue === null) winner = 'blue';
  else if (M.down.blue === null && M.down.red === null && Math.abs(pow.blue - pow.red) >= 0.05) { winner = pow.blue > pow.red ? 'blue' : 'red'; judged = true; }
  var r = { winner: winner, judged: judged, t: +SIMT.toFixed(1), left: left, pow: { blue: +pow.blue.toFixed(2), red: +pow.red.toFixed(2) }, hits: hits, down: M.down,
    steps: M.steps, ms: Math.round(performance.now() - M.realT0) };
  // 策略「推演」那一方（TASK-0688）：推了幾次、最後挑哪個、到期的預測 [時間, 預測, 實際]（56_rollout.js mem.roll）—— 只有用推演的那一方才有這一欄（別的策略結果一個字都不多）
  ['blue', 'red'].forEach(function (tm) { var R = CMD_MEM[tm].roll; if (R) (r.roll || (r.roll = {}))[tm] = { n: R.n, pick: R.pick, errs: R.errs.slice() }; });
  return r;
}
function flabFinish(M) {
  M.res = flabResult(M);
  var r = M.res, w = r.winner ? (r.winner === 'blue' ? '藍方' : '紅方') + '贏' + (r.judged ? '（時限到，照剩下的戰力判）' : '') : '和局';
  flabEl('flabMsg').textContent = w + '　' + r.t + ' 秒　剩 藍 ' + r.left.blue + '／紅 ' + r.left.red + ' 艘　戰力 ' + r.pow.blue + '／' + r.pow.red + '　（實際 ' + (r.ms / 1000).toFixed(1) + ' 秒、' + r.steps + ' 步）';
  window.__flabLast = r;
  if (FLAB.batch && !FLAB.batch.done) flabBatchNext(r);
  if (FLAB.work && FLAB.work.job) flabWorkDone(r);
}
// ── 調參的工作（TASK-0687；src/tune.py） ──
// 頁面不自己連線（成品零外部依賴：vxk_inline.py 擋 fetch）⇒ 由 src/tune.py 用 Chrome 的除錯協定（CDP）把工作塞進來、輪詢結果：
//   __game.flab.job(工作) ⇒ 照工作的參數（flabParams 的格式，p）與兩方的覆寫（tune.blue／red ⇒ TUNE，55_tune.js）用最快速度打一場；
//   __game.flab.done() ⇒ 打完了 ⇒ { id, res（flabResult）, tune（實際套上的覆寫，回讀用）}，還沒 ⇒ null。打完就把 TUNE 清回 null（遊戲本體永遠是 null）。
//   出錯 ⇒ window.__flabErr（tune.py 讀到就重開這個工作者、那份工作重發）。
function flabJob(j) {
  if (!FLAB.work) { FLAB.work = { n: 0 }; window.addEventListener('error', function (e) { window.__flabErr = String(e.message) + ' @' + e.lineno; }); }
  FLAB.work.job = j; FLAB.work.done = null;
  TUNE.blue = tuneClean(j.tune && j.tune.blue); TUNE.red = tuneClean(j.tune && j.tune.red);
  FLAB.speed = Infinity;
  return flabSetup(Object.assign(flabParams(), j.p)).then(function () { FLAB.run = true; flabKick(); return true; });
}
function flabWorkDone(r) {
  var W = FLAB.work; W.n++;
  W.done = { id: W.job.id, res: r, tune: { blue: TUNE.blue, red: TUNE.red } };
  W.job = null; TUNE.blue = TUNE.red = null;
}
// ── 批次 ──
function flabBatchToggle() {
  if (FLAB.batch && !FLAB.batch.done) { FLAB.batch.stop = true; FLAB.batch.done = true; flabEl('flabBgo').textContent = '批次對打'; return; }
  var p = flabParams(), N = Math.max(1, Math.round(+flabEl('flabBN').value || 4)), all = flabEl('flabBall').checked;
  var S = all ? CMD_STRATS : null, pairs = [], jobs = [], res = {};
  if (S) S.forEach(function (a) { S.forEach(function (b) { pairs.push([a, b]); }); }); else pairs.push([p.blue.strat, p.red.strat]);
  pairs.forEach(function (ab) { res[ab[0] + '|' + ab[1]] = { w: 0, l: 0, d: 0, t: 0, left: 0, n: 0, j: 0 }; for (var i = 0; i < N; i++) jobs.push({ a: ab[0], b: ab[1], seed: p.seed + i, swap: i % 2 === 1 }); });
  FLAB.batch = { p: p, jobs: jobs, res: res, pairs: pairs, i: 0, stop: false, done: false, t0: performance.now(), cur: null };
  flabEl('flabBgo').textContent = '停止'; flabBatchTable();
  flabBatchNext(null);
}
function flabBatchNext(r) {
  var B = FLAB.batch;
  if (r && B.cur) {
    var j = B.cur, mine = j.swap ? 'red' : 'blue', cell = B.res[j.a + '|' + j.b];
    cell.n++; cell.t += r.t; cell.left += r.left[mine] - r.left[mine === 'blue' ? 'red' : 'blue'];
    if (r.winner === mine) cell.w++; else if (r.winner) cell.l++; else cell.d++;
    if (r.judged) cell.j++;
    flabBatchTable();
  }
  if (B.stop || B.i >= B.jobs.length) { B.done = true; flabEl('flabBgo').textContent = '批次對打'; flabEl('flabBprog').textContent += '　（' + ((performance.now() - B.t0) / 1000).toFixed(0) + ' 秒）'; return; }
  var j = B.jobs[B.i++], p = JSON.parse(JSON.stringify(B.p)); B.cur = j;
  p.seed = j.seed; p.blue.strat = j.a; p.red.strat = j.b;
  if (j.swap) { var t = p.blue; p.blue = p.red; p.red = t; p.blue.strat = j.b; p.red.strat = j.a; }
  FLAB.run = false;
  flabSetup(p).then(function () { FLAB.run = true; flabKick(); });
}
function flabBatchTable() {
  var B = FLAB.batch, done = 0; for (var k in B.res) done += B.res[k].n;
  flabEl('flabBprog').textContent = done + '／' + B.jobs.length + ' 場';
  var S = B.pairs.length > 1 ? CMD_STRATS : null, h = '';
  function cell(c) { if (!c.n) return '—'; return Math.round(c.w / c.n * 100) + '%<br><small>' + Math.round(c.t / c.n) + ' 秒・差 ' + (c.left / c.n).toFixed(1) + ' 艘' + (c.j ? '・判定 ' + c.j : '') + (c.d ? '・和 ' + c.d : '') + '</small>'; }
  if (S) {
    h = '<tr><th>列 打 欄</th>' + S.map(function (b) { return '<th>' + CMD_NAMES[b] + '</th>'; }).join('') + '<th>平均勝率</th></tr>';
    S.forEach(function (a) { var w = 0, n = 0; h += '<tr><th>' + CMD_NAMES[a] + '</th>' + S.map(function (b) { var c = B.res[a + '|' + b]; if (a !== b) { w += c.w; n += c.n; } return '<td>' + cell(c) + '</td>'; }).join('') + '<td>' + (n ? Math.round(w / n * 100) + '%' : '—') + '</td></tr>'; });
  } else { var ab = B.pairs[0]; h = '<tr><th>' + CMD_NAMES[ab[0]] + ' 打 ' + CMD_NAMES[ab[1]] + '</th><td>' + cell(B.res[ab[0] + '|' + ab[1]]) + '</td></tr>'; }
  flabEl('flabBtab').innerHTML = h;
}
// ── 畫面 ──
function flabSetView(v) {
  FLAB.view = v; FLAB_HIDE = v !== '3d';
  document.body.classList.toggle('flab3d', v === '3d'); flabEl('flabView').textContent = v === '3d' ? '🗺 俯視圖' : '🎥 看實景';
  flabEl('flabTrace').className = v === 'trace' ? 'on' : ''; flabEl('flabTLbox').style.display = v === 'trace' ? '' : 'none';
  if (v === '3d' && SHIPS.length) { remesh(Infinity); var o = SHIPS[FLAB.sel] || SHIPS[0]; camSet({ mode: 3, follow: null, pan: [0, 0], see: o.i === PLAYER_I ? null : o, dist: 120, snap: true }); }
}
function flabCam() { return FLAB.cam || (FLAB.cam = { x: 0, z: 0, k: 0.5, auto: true }); }
function flabPick(e) {
  var cv = flabEl('flabCv'), r = cv.getBoundingClientRect(), C = flabCam(), x = C.x + (e.clientX - r.left - r.width / 2) / C.k, z = C.z + (e.clientY - r.top - r.height / 2) / C.k, best = null, bd = 40 / C.k;
  SHIPS.forEach(function (s) { var d = Math.hypot(s.px - x, s.pz - z); if (d < bd) { bd = d; best = s; } });
  if (best) { FLAB.sel = best.i; if (FLAB.view === '3d') flabSetView('3d'); }
}
/** 每一格畫面（90_main.js frame 的沙盒分支）：俯視圖、右邊每艘的讀數；看實景時才畫 3D。 */
function flabFrame(ts) {
  var dt = FLAB.last ? Math.min(0.1, (ts - FLAB.last) / 1000) : 1 / 60; FLAB.last = ts;
  if (FLAB.view === '3d' && SHIPS.length) { remesh(RM_BUDGET); renderLerp(true, 1); camUpdate(dt); render(); renderLerp(false); }
  else flabDraw();
  if (!FLAB.sideT || ts - FLAB.sideT > 250) { FLAB.sideT = ts; flabSide(); flabDetail(); }   // 右邊的讀數每 0.25 秒換一次（innerHTML 整片重寫）
}
function flabTeamC(t, a) { return t === 'blue' ? 'rgba(90,162,255,' + a + ')' : 'rgba(255,107,90,' + a + ')'; }
function flabDraw() {
  var cv = flabEl('flabCv'), dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#0e1a26'; g.fillRect(0, 0, w, h);
  if (!SHIPS.length) return;
  var C = flabCam(), live = SHIPS.filter(function (s) { return !s.sunk; }); if (!live.length) live = SHIPS;
  if (C.auto) {
    var x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; live.forEach(function (s) { x0 = Math.min(x0, s.px); x1 = Math.max(x1, s.px); z0 = Math.min(z0, s.pz); z1 = Math.max(z1, s.pz); });
    var tx = (x0 + x1) / 2, tz = (z0 + z1) / 2, tk = Math.min(w / (x1 - x0 + 300), h / (z1 - z0 + 300));
    C.x += (tx - C.x) * 0.15; C.z += (tz - C.z) * 0.15; C.k += (tk - C.k) * 0.15;
  }
  function X(x) { return w / 2 + (x - C.x) * C.k; } function Y(z) { return h / 2 + (z - C.z) * C.k; }
  var tr = FLAB.view === 'trace';
  // 格線（100 m）
  g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 1; var step = C.k * 100 < 25 ? 500 : 100;
  for (var gx = Math.floor((C.x - w / 2 / C.k) / step) * step; gx < C.x + w / 2 / C.k; gx += step) { g.beginPath(); g.moveTo(X(gx), 0); g.lineTo(X(gx), h); g.stroke(); }
  for (var gz = Math.floor((C.z - h / 2 / C.k) / step) * step; gz < C.z + h / 2 / C.k; gz += step) { g.beginPath(); g.moveTo(0, Y(gz)); g.lineTo(w, Y(gz)); g.stroke(); }
  if (tr) flabDrawTrace(g, w, h, C, X, Y);
  // 航跡
  if (!tr) SHIPS.forEach(function (s) { var W = s.wake; if (!W || W.length < 2) return; g.strokeStyle = flabTeamC(s.team, 0.18); g.beginPath(); for (var i = Math.max(0, W.length - 120); i < W.length; i++) { var p = W[i]; if (i === Math.max(0, W.length - 120)) g.moveTo(X(p[0]), Y(p[1])); else g.lineTo(X(p[0]), Y(p[1])); } g.lineTo(X(s.px), Y(s.pz)); g.stroke(); });
  // 目標線、戰列站位
  SHIPS.forEach(function (s) {
    if (tr || isOut(s)) return;
    if (s.foe && !s.foe.sunk) { g.strokeStyle = flabTeamC(s.team, 0.22); g.setLineDash([4, 6]); g.beginPath(); g.moveTo(X(s.px), Y(s.pz)); g.lineTo(X(s.foe.px), Y(s.foe.pz)); g.stroke(); g.setLineDash([]); }
    if (s.station) { g.fillStyle = flabTeamC(s.team, 0.7); g.beginPath(); g.arc(X(s.station[0]), Y(s.station[1]), 3, 0, 7); g.fill(); g.strokeStyle = flabTeamC(s.team, 0.4); g.beginPath(); g.moveTo(X(s.px), Y(s.pz)); g.lineTo(X(s.station[0]), Y(s.station[1])); g.stroke(); }
  });
  // 砲彈
  g.fillStyle = 'rgba(255,230,150,.9)'; if (!tr) BALLS.forEach(function (b) { g.fillRect(X(b.p[0]) - 1, Y(b.p[2]) - 1, 2, 2); });
  // 船
  if (!tr) SHIPS.forEach(function (s) {
    var od = ORDERS[s.i], tag = '#' + s.i + (od ? (od.mode === 'lead' ? ' ★' : od.mode === 'gauge' ? ' 🌬' : od.mode === 'line' ? ' ⛓' : '') : '') + (s.sunk ? ' 沉' : s.struck ? ' 降旗' : '');
    flabShip(g, X, Y, C, { px: s.px, pz: s.pz, yaw: s.yaw, team: s.team, i: s.i, len: (s.T.wl1 - s.T.wl0) * S, out: s.sunk ? 2 : isOut(s) ? 1 : 0 }, tag);
  });
  // 風、比例尺、時間
  var Wd = norm(WIND), cx = 46, cy = 46; g.strokeStyle = '#cfe3ff'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - Wd[0] * 26, cy - Wd[2] * 26); g.lineTo(cx + Wd[0] * 26, cy + Wd[2] * 26); g.stroke();
  g.beginPath(); g.arc(cx + Wd[0] * 26, cy + Wd[2] * 26, 4, 0, 7); g.fillStyle = '#cfe3ff'; g.fill(); g.lineWidth = 1;
  g.fillStyle = '#9fb0c2'; g.font = '12px system-ui, "Microsoft JhengHei", sans-serif'; g.fillText('風往 ●　' + windKnots().toFixed(0) + ' 節', 14, 90);
  var sb = step * C.k; g.strokeStyle = '#9fb0c2'; g.beginPath(); g.moveTo(14, h - 16); g.lineTo(14 + sb, h - 16); g.stroke(); g.fillText(step + ' m', 18 + sb, h - 12);
  var M = FLAB.match, gs = function (tm) { var G = CMD_MEM[tm].gauge; return G ? '搶上風 ' + ({ beat: '搶風中', done: '搶到', timeout: '時間到', near: '已接近' }[G.st] || G.st) + '（' + Math.round(G.up) + ' m）' : ''; };
  g.fillStyle = '#e8eef5'; g.fillText(SIMT.toFixed(0) + ' 秒' + (M ? '　×' + FLAB.simRate.toFixed(1) + '　' + Math.round(1 / DT) + ' Hz' : '') + '　藍 ' + CMD_NAMES[CMD_SIDE.blue] + ' ' + gs('blue') + '　紅 ' + CMD_NAMES[CMD_SIDE.red] + ' ' + gs('red'), 100, 24);
}
/** 右邊：每艘的讀數（船殼、砲、人、帆、航速、命令、打法）。 */
function flabSide() {
  var el = flabEl('flabSide'); if (!el) return;
  var CV = SHIPS.length ? cmdView('blue').ships : [];
  el.innerHTML = SHIPS.map(function (s, k) {
    var v = CV[k], od = ORDERS[s.i];
    return '<div class="fr ' + s.team + (isOut(s) ? ' out' : '') + (FLAB.sel === s.i ? ' sel' : '') + '" data-i="' + s.i + '">#' + s.i + ' ' + s.name + '　殼 ' + Math.round(v.hp * 100) + '%　砲 ' + Math.round(v.guns * 100) + '%　人 ' + Math.round(v.crew * 100) + '%　帆 ' + Math.round(s.sailFrac * 100) + '%　' + (s.spd * 1.944).toFixed(1) + ' 節'
      + '<br><small>' + (od ? od.mode + (od.target !== null && od.target !== undefined ? '→' + od.target : '') + (od.mode === 'line' ? ' 跟 ' + od.leader : '') : '—') + '　' + (HELM_MODE[s.hMode] || '') + (s.lineErr !== undefined ? '　離站位 ' + Math.round(s.lineErr) + ' m' : '') + '　中 ' + s.hits + '</small></div>';
  }).join('');
  [].forEach.call(el.querySelectorAll('.fr'), function (d) { d.onclick = function () { FLAB.sel = +d.dataset.i; if (FLAB.view === '3d') flabSetView('3d'); }; });
}
// ── 記錄 ──
/** 每半秒一筆（flabPump；開局那一刻也記一筆）。候補進場的船後來才有 ⇒ 補一份。 */
function flabRec(M) {
  var R = M.rec, t = +SIMT.toFixed(2), CV = cmdView('blue').ships;
  while (R.ships.length < SHIPS.length) { var n = SHIPS[R.ships.length]; R.ships.push({ i: n.i, team: n.team, name: n.name, hull: n.T.id, len: +((n.T.wl1 - n.T.wl0) * S).toFixed(1), s: [] }); }
  SHIPS.forEach(function (s, k) {
    var v = CV[k], od = ORDERS[s.i];
    R.ships[k].s.push([t, Math.round(s.px * 10) / 10, Math.round(s.pz * 10) / 10, +s.yaw.toFixed(3), +(s.spd * 1.944).toFixed(2), +v.hp.toFixed(3), +v.guns.toFixed(3), +v.crew.toFixed(3), +s.sailFrac.toFixed(3), s.hits,
      od ? od.mode : null, s.foe ? s.foe.i : null, s.hMode || null, s.lineErr === undefined ? null : Math.round(s.lineErr), s.station ? Math.round(s.station[0]) : null, s.station ? Math.round(s.station[1]) : null, s.sunk ? 2 : isOut(s) ? 1 : 0]);
  });
  var W = norm(WIND); R.wind.push([t, Math.round(Math.atan2(W[2], W[0]) * 57.2958), +windKnots().toFixed(1)]);
  ['blue', 'red'].forEach(function (tm) { var G = CMD_MEM[tm].gauge; if (G) R.gauge[tm].push([t, G.st, Math.round(G.up), Math.round(G.near)]); });
}
var FLAB_COLS = ['t', 'x', 'z', 'yaw', 'kn', 'hp', 'guns', 'crew', 'sail', 'hits', 'order', 'foe', 'helm', 'lineErr', 'stX', 'stZ', 'out'];
evOn('rptHelm', function (sh, kind, text) { var M = FLAB.match; if (LAB_FLEET && M && M.rec && !M.res) M.rec.helm.push([+SIMT.toFixed(1), sh.i, kind, text]); }, 5);   // 艦長、指揮官的決定（只記）
/** 匯出這一場：參數、結果、記錄（每艘的欄位名 cols）。 */
function flabExport() {
  var M = FLAB.match; if (!M) return;
  var data = { v: 1, params: M.p, result: M.res || flabResult(M), cols: FLAB_COLS, rec: M.rec };
  var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = 'fleetlab-seed' + M.p.seed + '-' + M.p.blue.strat + '-vs-' + M.p.red.strat + '-' + Math.round(SIMT) + 's.json'; document.body.appendChild(a); a.click(); a.remove();
}
/** 軌跡：這一艘的記錄在 t 秒（不晚於 t 的最後一筆）。 */
function flabAt(sr, t) { var L = sr.s, lo = 0, hi = L.length - 1; if (hi < 0) return null; while (lo < hi) { var m = (lo + hi + 1) >> 1; if (L[m][0] <= t) lo = m; else hi = m - 1; } return L[lo]; }
/** 「🧭 軌跡」：整場每艘的航跡（照記錄；每 10 秒一個點）＋時間軸那一秒的船位、目標線、站位。 */
function flabDrawTrace(g, w, h, C, X, Y) {
  var M = FLAB.match, R = M && M.rec; if (!R) return;
  var s0 = R.ships[0], tEnd = s0 && s0.s.length ? s0.s[s0.s.length - 1][0] : 0, sl = flabEl('flabTL'); sl.max = tEnd; if (FLAB.tl === null) FLAB.tl = tEnd;
  var t = Math.min(FLAB.tl, tEnd); flabEl('flabTLv').textContent = t.toFixed(1) + ' 秒'; if (+sl.value !== t) sl.value = t;
  R.ships.forEach(function (sr) {
    var L = sr.s; if (L.length < 2) return;
    g.strokeStyle = flabTeamC(sr.team, FLAB.sel === sr.i ? 0.85 : 0.35); g.lineWidth = FLAB.sel === sr.i ? 2 : 1;
    g.beginPath(); L.forEach(function (r, k) { if (k) g.lineTo(X(r[1]), Y(r[2])); else g.moveTo(X(r[1]), Y(r[2])); }); g.stroke();
    g.fillStyle = flabTeamC(sr.team, 0.5); L.forEach(function (r, k) { if (k % 20 === 0) g.fillRect(X(r[1]) - 1, Y(r[2]) - 1, 2, 2); });
  });
  g.lineWidth = 1;
  R.ships.forEach(function (sr) {
    var r = flabAt(sr, t); if (!r) return;
    if (r[11] !== null && R.ships[r[11]] && !r[16]) { var f = flabAt(R.ships[r[11]], t); if (f) { g.strokeStyle = flabTeamC(sr.team, 0.25); g.setLineDash([4, 6]); g.beginPath(); g.moveTo(X(r[1]), Y(r[2])); g.lineTo(X(f[1]), Y(f[2])); g.stroke(); g.setLineDash([]); } }
    if (r[14] !== null) { g.fillStyle = flabTeamC(sr.team, 0.8); g.beginPath(); g.arc(X(r[14]), Y(r[15]), 3, 0, 7); g.fill(); }
  });
  R.ships.forEach(function (sr) { var r = flabAt(sr, t); if (r) flabShip(g, X, Y, C, { px: r[1], pz: r[2], yaw: r[3], team: sr.team, i: sr.i, len: sr.len, out: r[16] }, '#' + sr.i + (r[10] === 'lead' ? ' ★' : r[10] === 'gauge' ? ' 🌬' : r[10] === 'line' ? ' ⛓' : '') + ' ' + r[4].toFixed(1) + ' 節'); });
}
/** 一艘船的形狀（俯視圖、軌跡共用）。o：{ px, pz, yaw, team, i, len, out（0 在打、1 出局、2 沉）}。 */
function flabShip(g, X, Y, C, o, tag) {
  var L = o.len, B = L * 0.27, f = [Math.cos(o.yaw), -Math.sin(o.yaw)], r = [-f[1], f[0]];
  var pts = [[0.5, 0], [0.25, 0.5], [-0.5, 0.42], [-0.5, -0.42], [0.25, -0.5]].map(function (q) { return [o.px + f[0] * q[0] * L + r[0] * q[1] * B, o.pz + f[1] * q[0] * L + r[1] * q[1] * B]; });
  g.fillStyle = o.out === 2 ? 'rgba(120,120,120,.25)' : o.out ? 'rgba(200,200,200,.45)' : flabTeamC(o.team, 0.9);
  g.beginPath(); pts.forEach(function (p, i) { if (i) g.lineTo(X(p[0]), Y(p[1])); else g.moveTo(X(p[0]), Y(p[1])); }); g.closePath(); g.fill();
  if (FLAB.sel === o.i) { g.strokeStyle = '#ffd27a'; g.lineWidth = 2; g.stroke(); g.lineWidth = 1; }
  g.fillStyle = 'rgba(232,238,245,.85)'; g.font = '11px system-ui, "Microsoft JhengHei", sans-serif'; g.fillText(tag, X(o.px) + Math.max(8, L * C.k * 0.4), Y(o.pz) - 6);
}
/** 選的那一艘：時間線（航速 節、離站位 10 m、船殼 10%、帆 10% 疊在同一張）＋決定紀錄（點一筆 ⇒ 軌跡跳到那一秒）。 */
function flabDetail() {
  var M = FLAB.match, R = M && M.rec, el = flabEl('flabDet'), cv = flabEl('flabChart');
  if (!R || FLAB.sel === null || !R.ships[FLAB.sel]) { el.textContent = '點一艘船看它的時間線與決定'; return; }
  var sr = R.ships[FLAB.sel], L = sr.s, dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w || !L.length) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#0b1520'; g.fillRect(0, 0, w, h);
  var tEnd = Math.max(1, L[L.length - 1][0]), series = [[4, 1, '#9fd8ff', '航速 節'], [13, 0.1, '#ffd27a', '離站位 10 m'], [5, 10, '#8fe39a', '船殼 10%'], [8, 10, '#e0a0ff', '帆 10%']], ymax = 12;
  function Yv(v) { return h - 14 - Math.min(ymax, v) / ymax * (h - 30); }
  g.strokeStyle = 'rgba(255,255,255,.08)'; for (var y = 0; y <= ymax; y += 2) { g.beginPath(); g.moveTo(0, Yv(y)); g.lineTo(w, Yv(y)); g.stroke(); }
  g.font = '11px system-ui, "Microsoft JhengHei", sans-serif';
  series.forEach(function (S2, si) {
    g.strokeStyle = S2[2]; g.beginPath(); var on = false;
    L.forEach(function (r) { var v = r[S2[0]]; if (v === null) { on = false; return; } var px = r[0] / tEnd * w, py = Yv(v * S2[1]); if (on) g.lineTo(px, py); else g.moveTo(px, py); on = true; }); g.stroke();
    g.fillStyle = S2[2]; g.fillText(S2[3], 6 + si * 92, 12);
  });
  if (FLAB.view === 'trace' && FLAB.tl !== null) { g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(FLAB.tl / tEnd * w, 16); g.lineTo(FLAB.tl / tEnd * w, h - 14); g.stroke(); }
  g.fillStyle = '#9fb0c2'; g.fillText('0', 2, h - 2); g.fillText(Math.round(tEnd) + ' 秒', w - 44, h - 2);
  var hl = R.helm.filter(function (d) { return d[1] === sr.i; });
  el.innerHTML = '<b>#' + sr.i + ' ' + sr.name + '</b>（' + (sr.team === 'blue' ? '藍' : '紅') + '）的決定 ' + hl.length + ' 筆（新的在上；點一筆 ⇒ 軌跡跳到那一秒）' +
    hl.slice(-60).reverse().map(function (d) { return '<div class="hd" data-t="' + d[0] + '">' + d[0].toFixed(1) + ' 秒　' + d[3] + '</div>'; }).join('');
  [].forEach.call(el.querySelectorAll('.hd'), function (d) { d.onclick = function () { flabSetView('trace'); FLAB.tl = +d.dataset.t; }; });
}
// 量測（?debug=1）：__game.flab.start(參數)、state()、last()、speed(倍)、prof()；調參（src/tune.py）：job(工作)、done()、tuneDef()（參數表，55_tune.js）（上次讀到現在 step() 每一段累積幾毫秒，00_core.js PF）
if (DEBUG) setTimeout(function () { if (window.__game) window.__game.flab = { job: flabJob, done: function () { return FLAB.work && FLAB.work.done || null; }, tuneDef: function () { return TUNE_DEF; }, start: function (p) { return flabSetup(Object.assign(flabParams(), p || {})).then(function () { FLAB.run = true; flabKick(); return true; }); }, last: function () { return window.__flabLast || null; }, state: function () { return { t: SIMT, run: FLAB.run, rate: FLAB.simRate, steps: FLAB.match && FLAB.match.steps, res: FLAB.match && FLAB.match.res, batch: FLAB.batch && { i: FLAB.batch.i, n: FLAB.batch.jobs.length, done: FLAB.batch.done, res: FLAB.batch.res } }; }, speed: function (s) { FLAB.speed = s || Infinity; flabSpdShow(); return FLAB.speed; }, prof: function () { var c = PF ? PF.cur : null; if (PF) PF.cur = {}; return c; } }; }, 0);
