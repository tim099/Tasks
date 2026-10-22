// ───────────────────────── 2D 策略沙盒：畫面與批次（TASK-0551） ─────────────────────────
// 單場：俯視畫出船（長方形，照船長）、風、命令線（誰打誰）、戰列的站位、齊射；可暫停、調速。
// 批次：兩方的編成照上面那一列，策略兩兩對打（4 × 4），每一格 N 個種子、一半換邊（藍紅對調，抵掉開局位置的偏差）⇒ 列的策略打欄的策略的勝率、平均打多久、平均剩幾艘。
var UI = { W: null, run: true, speed: 4, cam: null, batch: null };
function $(id) { return document.getElementById(id); }
function sbFleet(side) { var n = +$(side + 'N').value, h = $(side + 'H').value; var L = []; for (var i = 0; i < n; i++) L.push(h); return L; }
function sbOpt(seed) {
  var w = $('wind').value;
  return { blue: sbFleet('blue'), red: sbFleet('red'), cmd: { blue: $('blueC').value, red: $('redC').value }, dist: +$('dist').value, seed: seed, play: $('play').value, wind: w === 'rnd' ? undefined : +w * Math.PI / 180 };
}
function sbStart() { UI.W = sbNew(sbOpt(+$('seed').value)); UI.W.fx = []; UI.cam = null; UI.run = true; $('pause').textContent = '暫停'; }
function sbDraw() {
  var cv = $('cv'), g = cv.getContext('2d'), W = UI.W, w = cv.width = cv.clientWidth * (window.devicePixelRatio || 1), h = cv.height = cv.clientHeight * (window.devicePixelRatio || 1);
  g.fillStyle = '#16324a'; g.fillRect(0, 0, w, h);
  if (!W) return;
  var L = W.ships.filter(function (s) { return !s.sunk; }); if (!L.length) L = W.ships;
  var x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; L.forEach(function (s) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z); });
  var cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, span = Math.max(x1 - x0, z1 - z0, 200) + 160;
  if (!UI.cam) UI.cam = { x: cx, z: cz, s: span };
  UI.cam.x += (cx - UI.cam.x) * 0.05; UI.cam.z += (cz - UI.cam.z) * 0.05; UI.cam.s += (span - UI.cam.s) * 0.05;
  var k = Math.min(w, h) / UI.cam.s;
  function P(x, z) { return [w / 2 + (x - UI.cam.x) * k, h / 2 + (z - UI.cam.z) * k]; }
  g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1;                // 100 m 的格線
  var gs = 100, gx0 = Math.floor((UI.cam.x - UI.cam.s) / gs) * gs, gz0 = Math.floor((UI.cam.z - UI.cam.s) / gs) * gs;
  for (var x = gx0; x < UI.cam.x + UI.cam.s; x += gs) { var a = P(x, 0); g.beginPath(); g.moveTo(a[0], 0); g.lineTo(a[0], h); g.stroke(); }
  for (var z = gz0; z < UI.cam.z + UI.cam.s; z += gs) { var b = P(0, z); g.beginPath(); g.moveTo(0, b[1]); g.lineTo(w, b[1]); g.stroke(); }
  // 風
  g.save(); g.translate(60, 60); g.rotate(Math.atan2(W.wind[1], W.wind[0])); g.strokeStyle = '#cfe6ff'; g.lineWidth = 3; g.beginPath(); g.moveTo(-30, 0); g.lineTo(30, 0); g.lineTo(18, -9); g.moveTo(30, 0); g.lineTo(18, 9); g.stroke(); g.restore();
  g.fillStyle = '#cfe6ff'; g.font = (12 * (window.devicePixelRatio || 1)) + 'px sans-serif'; g.fillText('風', 52, 100);
  // 齊射
  W.fx = (W.fx || []).filter(function (f) { return W.t - f.t < 0.6; });
  W.fx.forEach(function (f) { var a = P(f.x0, f.z0), b = P(f.x1, f.z1); g.strokeStyle = f.team === 'blue' ? 'rgba(140,200,255,0.55)' : 'rgba(255,150,130,0.55)'; g.lineWidth = 1 + f.n / 6; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); });
  // 命令線、站位
  W.ships.forEach(function (s) {
    if (s.out) return;
    var o = W.orders[s.id];
    if (s.foe) { var a = P(s.x, s.z), b = P(s.foe.x, s.foe.z); g.setLineDash([4, 6]); g.strokeStyle = s.team === 'blue' ? 'rgba(120,180,255,0.35)' : 'rgba(255,120,110,0.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); g.setLineDash([]); }
    if (o && o.mode === 'line' && s.station) { var c = P(s.station[0], s.station[1]); g.strokeStyle = '#ffd36b'; g.beginPath(); g.arc(c[0], c[1], 5, 0, 7); g.stroke(); var p = P(s.x, s.z); g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(c[0], c[1]); g.stroke(); }
  });
  // 船
  W.ships.forEach(function (s) {
    var p = P(s.x, s.z), len = s.H.len * k, wid = Math.max(3, 12 * k);
    g.save(); g.translate(p[0], p[1]); g.rotate(-s.yaw);
    g.globalAlpha = s.sunk ? 0.15 : s.out ? 0.45 : 1;
    g.fillStyle = s.out ? '#777' : s.team === 'blue' ? '#5aa2ff' : '#ff6b5a';
    g.beginPath(); g.moveTo(len / 2, 0); g.lineTo(len / 2 - wid, -wid / 2); g.lineTo(-len / 2, -wid / 2); g.lineTo(-len / 2, wid / 2); g.lineTo(len / 2 - wid, wid / 2); g.closePath(); g.fill();
    g.restore(); g.globalAlpha = 1;
    g.fillStyle = '#fff'; g.fillText(s.id + (W.orders[s.id] && W.orders[s.id].mode === 'line' ? '↳' : ''), p[0] + 8, p[1] - 8);
  });
  // 清單
  $('ships').innerHTML = W.ships.map(function (s) {
    var o = W.orders[s.id];
    return '<div class="sr ' + s.team + (s.out ? ' out' : '') + '"><b>' + s.id + '</b> ' + s.H.name + '　船殼 ' + Math.round(Math.max(0, s.hp) * 100) + '%　砲 ' + (s.guns.P + s.guns.S) + '　人 ' + Math.round(s.crew * 100) + '%　帆 ' + Math.round(s.sail * 100) + '%' + (function (n) { return n ? '（倒桅 ' + n + '）' : ''; })(s.masts.filter(function (m) { return !m.up; }).length) + '　' + s.spd.toFixed(1) + ' m/s' +
      (s.out ? '　<i>' + s.fate + '</i>' : '　→ ' + (s.foe ? s.foe.id : '-') + (o ? '（' + (o.mode === 'line' ? '跟 ' + o.leader : '交戰') + (o.throttle !== undefined && o.throttle < 1 ? '・慢' : '') + '）' : '')) + '</div>';
  }).join('');
  $('stat').textContent = W.t.toFixed(0) + ' 秒　風速 ×' + W.windSpd.toFixed(2) + (W.over ? '　' + (W.over.winner === 'blue' ? '藍' : '紅') + '方勝（' + W.over.t.toFixed(0) + ' 秒）' : '');
}
function sbLoop() {
  if (UI.W && UI.run && !UI.W.over) { var n = Math.round(UI.speed / 60 / SB_DT) || 1; for (var i = 0; i < n && !UI.W.over; i++) sbStep(UI.W); }
  sbDraw(); requestAnimationFrame(sbLoop);
}
/** 批次：策略兩兩對打。每一格 N 場，一半藍用列的策略、一半紅用列的策略（編成也跟著對調）。 */
function sbBatch() {
  if (UI.batch && !UI.batch.done) { UI.batch.stop = true; return; }
  var N = +$('bn').value, S = CMD_STRATS, jobs = [], res = {};
  S.forEach(function (a) { S.forEach(function (b) { res[a + '|' + b] = { w: 0, l: 0, d: 0, t: 0, left: 0, n: 0, j: 0 }; for (var i = 0; i < N; i++) jobs.push({ a: a, b: b, seed: 1000 + i, swap: i % 2 === 1 }); }); });
  UI.batch = { jobs: jobs, res: res, i: 0, stop: false, done: false, t0: performance.now() };
  $('bgo').textContent = '停止';
  (function chunk() {
    var B = UI.batch, t1 = performance.now();
    while (B.i < B.jobs.length && performance.now() - t1 < 40 && !B.stop) {
      var j = B.jobs[B.i++], o = sbOpt(j.seed), blue = o.blue, red = o.red;
      if (j.swap) { o.blue = red; o.red = blue; o.cmd = { blue: j.b, red: j.a }; } else o.cmd = { blue: j.a, red: j.b };
      var r = sbRun(o, +$('bt').value), mine = j.swap ? 'red' : 'blue', cell = B.res[j.a + '|' + j.b];
      cell.n++; cell.t += r.t; cell.left += r.left[mine] - r.left[mine === 'blue' ? 'red' : 'blue'];
      if (r.winner === mine) cell.w++; else if (r.winner) cell.l++; else cell.d++;
      if (r.judged) cell.j++;
    }
    sbTable(B);
    if (B.i < B.jobs.length && !B.stop) setTimeout(chunk, 0); else { B.done = true; $('bgo').textContent = '批次對打'; $('bprog').textContent += '　（' + ((performance.now() - B.t0) / 1000).toFixed(1) + ' 秒）'; }
  })();
}
function sbTable(B) {
  var S = CMD_STRATS;
  $('bprog').textContent = B.i + '／' + B.jobs.length + ' 場';
  $('btab').innerHTML = '<tr><th>列 打 欄</th>' + S.map(function (b) { return '<th>' + CMD_NAMES[b] + '</th>'; }).join('') + '<th>平均勝率</th></tr>' + S.map(function (a) {
    var tot = 0, cnt = 0;
    return '<tr><th>' + CMD_NAMES[a] + '</th>' + S.map(function (b) {
      var c = B.res[a + '|' + b]; if (!c.n) return '<td>…</td>';
      var wr = (c.w + c.d / 2) / c.n; if (a !== b) { tot += wr; cnt++; }
      return '<td style="background:rgba(' + (wr > 0.5 ? '90,200,120,' : '230,100,90,') + (Math.abs(wr - 0.5) * 1.2).toFixed(2) + ')">' + Math.round(wr * 100) + '%<br><small>' + (c.t / c.n).toFixed(0) + ' 秒・差 ' + (c.left / c.n).toFixed(1) + ' 艘' + (c.j ? '・判定 ' + c.j : '') + (c.d ? '・和 ' + c.d : '') + '</small></td>';
    }).join('') + '<td>' + (cnt ? Math.round(tot / cnt * 100) + '%' : '…') + '</td></tr>';
  }).join('');
}
(function init() {
  ['blueH', 'redH'].forEach(function (id) { $(id).innerHTML = Object.keys(SB_HULLS).map(function (k) { return '<option value="' + k + '">' + SB_HULLS[k].name + '</option>'; }).join(''); });
  ['blueC', 'redC'].forEach(function (id) { $(id).innerHTML = CMD_STRATS.map(function (k) { return '<option value="' + k + '"' + (k === 'pair' ? ' selected' : '') + '>' + CMD_NAMES[k] + '</option>'; }).join(''); });
  $('go').onclick = sbStart; $('pause').onclick = function () { UI.run = !UI.run; this.textContent = UI.run ? '暫停' : '繼續'; };
  [].forEach.call(document.querySelectorAll('#spd button'), function (b) { b.onclick = function () { UI.speed = +b.dataset.s; [].forEach.call(document.querySelectorAll('#spd button'), function (x) { x.className = x === b ? 'on' : ''; }); }; });
  $('bgo').onclick = sbBatch;
  sbStart(); sbLoop();
  window.__sb = { run: sbRun, opt: sbOpt, W: function () { return UI.W; }, batch: function () { return UI.batch; } };   // 量測用
})();
