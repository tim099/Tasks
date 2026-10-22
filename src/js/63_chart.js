// ───────────────────────── 小地圖（海圖；玩法規則 chart，04_modes.js：航海，TASK-0746 ⑤） ─────────────────────────
// Tim 2026-10-20：「航海模式下 是否可以加一個小地圖(海圖)」「橫版畫面時 放在右下角」「直版也先放右下角」。
// 只有畫面：海圖塊進來（08_seabed.js 'bedChunk' 細的、63_bed_gl.js bedFarPut 遠景的粗塊）就畫進一張整個海域的底圖（一點 CHART_M 公尺（chartPx：一塊幾點 ＝ A.chunk ÷ 32），跟遠景的粗塊同一個點距；
//   海域跟著旗艦走 ⇒ 底圖跟著窗換，疊到的照搬：chartWin），
//   細的那一份蓋過粗的；顏色照高度：陸地（沙灘、低地、山）、淺到我艦過不去（船底＋電腦讓開淺水的 BEDAV_CLR）、淺海、深海；水下的珊瑚礁、礁石另外標紅。
// 每 6 格畫面（hudFrame）畫一次：北朝上、我艦在中間（三角形尖端 ＝ 船頭）、走過的航跡、出發點 ⚓（開戰位置 ＝ 世界原點；停靠 ⇒ 泊位）、比例尺；
//   右上角「＋」拉近、「−」拉遠（滾輪也行）：半徑 0.5、1、1.5（開局）、2.5、4、7 km、整個海域。
// 位置：右下角、右邊那一排按鈕的上面（橫版、直版都是；照按鈕現在的位置算）—— ⛔ #stage 的 canvas 樣式是 inset:0 滿版 ⇒ 要先 inset:auto。⛔ 不讀不寫模擬 ⇒ 無頭不訂閱、戰局一位元不動；沒有海圖（?map）或玩法沒開 ⇒ 不建、不顯示。
var CHART = { A: null, im: null, g: null, res: null, cv: null, box: null, zb: null, zoom: 2, trail: [], trT: -1, need: 6.5 };
if (Q.has('chartz') && isFinite(+Q.get('chartz'))) CHART.zoom = Math.max(0, Math.min(6, Math.round(+Q.get('chartz'))));   // ?chartz=0..6：開局的範圍（量測、截圖用）
var CHART_M = 32, CHART_R = [500, 1000, 1500, 2500, 4000, 7000, 0], CHART_TRAIL = 900;   // 底圖一點幾公尺（以前「一塊 32 點」⇒ 塊從 1024 改 512 m 時照公尺換：chartPx）；範圍（半徑 m；0 ＝ 整個海域；開局 1.5 km）；航跡最多幾點（2 秒一點 ⇒ 30 分鐘）
var CHART_COL = { deep: [18, 52, 92], mid: [29, 86, 140], shoal: [62, 150, 190], danger: [150, 225, 230], reef: [222, 120, 100], sand: [214, 196, 140], low: [118, 156, 88], hill: [92, 128, 70], high: [140, 128, 104] };
/** 海域變了（或第一次）⇒ 新的一張底圖（全部先塗深海）、把已經載好的細塊畫上去。 */
/** 底圖一塊幾點（照公尺：CHART_M 一點）。 */
function chartPx() { return Math.max(1, Math.round(BED.A.chunk / CHART_M)); }
function chartReady() {
  if (!BED || !BED.A || !modeRule('chart')) return false;
  if (CHART.A === BED.A) return true;
  var A = BED.A, nx = BED.nx, ny = A.y[1] - A.y[0] + 1, c = document.createElement('canvas');
  c.width = nx * chartPx(); c.height = ny * chartPx();
  var g = c.getContext('2d'), d = CHART_COL.deep; g.fillStyle = 'rgb(' + d.join(',') + ')'; g.fillRect(0, 0, c.width, c.height);
  CHART.A = A; CHART.im = c; CHART.g = g; CHART.res = {}; CHART.trail = []; CHART.trT = -1; CHART.need = chartNeed();
  CHART.x0 = A.x[0]; CHART.y0 = A.y[0]; CHART.nx = nx; CHART.ny = ny;  // 底圖蓋的範圍（塊號）：海域跟著旗艦走 ⇒ chartWin 換
  for (var k in BED.ch) chartPut(BED.ch[k]);
  for (k in BED.cm) chartPut(BED.cm[k]);                                 // 外圈的中等塊（chartPut 只收更細的 ⇒ 順序無關）
  return true;
}
/** 吃水的門檻：我艦那一型（主選單的第一艘）龍骨線最低那一點到設計水線（32_ground.js groundKeel）＋ BEDAV_CLR —— 比它淺的水畫成「過不去」。
 *  船型還沒載好（海圖塊先到）⇒ 6.5（風暴角號 4.97 ＋ 1.5）。 */
function chartNeed() {
  var T = HULLT[myHull()]; if (!T) return 6.5;
  var K = groundKeel(T), lo = Infinity; K.forEach(function (p) { lo = Math.min(lo, p[1]); });
  return isFinite(lo) ? (T.zw - lo) * S + BEDAV_CLR : 6.5;
}
function chartRGB(h, m) {
  var C = CHART_COL;
  if (h > 0) return h < 3 ? C.sand : h < 40 ? C.low : h < 200 ? C.hill : C.high;
  var dp = -h;
  if ((m === BED_MAT.REEF || m === BED_MAT.ROCK) && dp < 12) return C.reef;
  return dp < CHART.need ? C.danger : dp < 20 ? C.shoal : dp < 80 ? C.mid : C.deep;
}
/** 一塊畫進底圖（細的 n 大 ⇒ 蓋過粗的；粗的不蓋細的）。 */
function chartPut(C) {
  if (!chartReady() || !C) return;
  var k = bedKey(C.cx, C.cy); if (CHART.res[k] >= C.n) return;
  var i0 = C.cx - CHART.x0, j0 = C.cy - CHART.y0; if (i0 < 0 || j0 < 0 || i0 >= CHART.nx || j0 >= CHART.ny) return;
  CHART.res[k] = C.n;
  var P = chartPx(), img = CHART.g.createImageData(P, P), D = img.data, n = C.n;
  for (var j = 0; j < P; j++) for (var i = 0; i < P; i++) {
    var u = Math.min(n - 1, Math.round((i + 0.5) / P * (n - 1))), v = Math.min(n - 1, Math.round((j + 0.5) / P * (n - 1))), o = v * n + u;
    var c = chartRGB(C.h0[o] / 10, C.mat0[o]), q = (j * P + i) * 4;
    D[q] = c[0]; D[q + 1] = c[1]; D[q + 2] = c[2]; D[q + 3] = 255;
  }
  CHART.g.putImageData(img, i0 * P, j0 * P);
}
evOn('bedChunk', function (cx, cy, C) { chartPut(C); }, 0, true);
evOn('bedWin', function () { chartWin(); }, 0, true);
/** 海域的窗換了（08_seabed.js bedWinApply）：照新的範圍換一張底圖 —— 兩個窗疊到的那一塊照搬（畫好的不重畫），新進來的先塗深海、塊到了再畫。 */
function chartWin() {
  if (!CHART.im || CHART.A !== BED.A) return;
  var A = BED.A, nx = A.x[1] - A.x[0] + 1, ny = A.y[1] - A.y[0] + 1, P = chartPx(), c = document.createElement('canvas');
  c.width = nx * P; c.height = ny * P;
  var g = c.getContext('2d'), d = CHART_COL.deep; g.fillStyle = 'rgb(' + d.join(',') + ')'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(CHART.im, (CHART.x0 - A.x[0]) * P, (CHART.y0 - A.y[0]) * P);
  var res = {}; Object.keys(CHART.res).forEach(function (k) { var q = k.split('_').map(Number); if (bedIdx(q[0], q[1]) >= 0) res[k] = CHART.res[k]; });
  CHART.im = c; CHART.g = g; CHART.res = res; CHART.x0 = A.x[0]; CHART.y0 = A.y[0]; CHART.nx = nx; CHART.ny = ny;
}
/** 畫面上那一張（第一次要畫才建）：外框裡一張 canvas ＋ 右上角「＋」拉近、「−」拉遠（Tim 2026-10-20「小地圖是否可以加上縮放按鍵」）；滾輪也能縮放。 */
function chartEl() {
  if (CHART.box) return CHART.box;
  var b = document.createElement('div'); b.id = 'chartBox';
  b.style.cssText = 'position:absolute; right:10px; bottom:120px; z-index:6; display:none; pointer-events:auto; touch-action:manipulation;';
  var c = document.createElement('canvas'); c.id = 'chart'; c.title = '海圖（＋／− 或滾輪縮放）';
  c.style.cssText = 'position:static; inset:auto; display:block; border-radius:10px; border:1px solid rgba(232,194,106,.55); background:rgba(8,22,38,.7); cursor:default; touch-action:manipulation;';
  b.appendChild(c);
  var z = document.createElement('div'); z.style.cssText = 'position:absolute; right:5px; top:5px; display:flex; flex-direction:column; gap:4px;';
  [['＋', -1, '拉近'], ['−', 1, '拉遠（看更大範圍）']].forEach(function (q) {
    var k = document.createElement('button'); k.type = 'button'; k.textContent = q[0]; k.title = q[2]; k.dataset.d = q[1];
    k.style.cssText = 'width:24px; height:24px; padding:0; border-radius:6px; border:1px solid rgba(232,194,106,.7); background:rgba(8,22,38,.8); color:#f3ead8; font:bold 15px/1 sans-serif; cursor:pointer;';
    k.addEventListener('click', function (e) { e.stopPropagation(); chartZoom(q[1]); k.blur(); });   // blur：⛔ 留著焦點 ⇒ 空白鍵（齊射）會再按一次這顆
    z.appendChild(k);
  });
  b.appendChild(z);
  ['pointerdown', 'mousedown', 'touchstart', 'dblclick'].forEach(function (t) { b.addEventListener(t, function (e) { e.stopPropagation(); }, { passive: true }); });   // 點小地圖不算點海面（瞄準、轉鏡頭）
  b.addEventListener('wheel', function (e) { e.preventDefault(); e.stopPropagation(); chartZoom(e.deltaY > 0 ? 1 : -1); }, { passive: false });
  $('stage').appendChild(b);
  CHART.cv = c; CHART.zb = z.children;
  return (CHART.box = b);
}
/** 換範圍：d −1 拉近、+1 拉遠（到頭就停）。 */
function chartZoom(d) {
  CHART.zoom = Math.max(0, Math.min(CHART_R.length - 1, CHART.zoom + d)); HUDN = 0;
  if (CHART.zb) { CHART.zb[0].disabled = CHART.zoom === 0; CHART.zb[1].disabled = CHART.zoom === CHART_R.length - 1; [].forEach.call(CHART.zb, function (k) { k.style.opacity = k.disabled ? '.4' : '1'; }); }
}
/** 每 6 格畫面（61_hud.js hudFrame）：沒開就藏起來。 */
function chartDraw(me) {
  var on = RUNNING && me && chartReady();
  if (!on) { if (CHART.box && CHART.box.style.display !== 'none') CHART.box.style.display = 'none'; return; }
  var bx0 = chartEl(), c = CHART.cv, A = CHART.A, ch = A.chunk, port = innerHeight > innerWidth, W = port ? 132 : 176, dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (bx0.style.display === 'none') { bx0.style.display = 'block'; chartZoom(0); }
  if (c.width !== W * dpr) { c.width = c.height = W * dpr; c.style.width = c.style.height = W + 'px'; }
  // 右下角、右邊那一排按鈕的上面：跟 c 橫向重疊的按鈕裡最高的那一個的頂 ⇒ 底
  var top = innerHeight - 8;
  ['helmR', 'ctlRow', 'navBox'].forEach(function (id) { var e = $(id); if (!e || !e.offsetParent) return; var r = e.getBoundingClientRect(); if (r.right > innerWidth - W - 16 && r.height) top = Math.min(top, r.top); });
  var bt = Math.max(8, innerHeight - top + 8) + 'px'; if (bx0.style.bottom !== bt) bx0.style.bottom = bt;
  // 航跡：模擬時間 2 秒一點（新的一場 ⇒ 清掉）
  if (SIMT < CHART.trT) CHART.trail = [];
  if (SIMT - CHART.trT >= 2 || CHART.trT < 0) { CHART.trT = SIMT; CHART.trail.push([me.px, me.pz]); if (CHART.trail.length > CHART_TRAIL) CHART.trail.shift(); }
  var g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, W);
  var e0 = CHART.x0 * ch, s0 = CHART.y0 * ch, ew = CHART.nx * ch, sw = CHART.ny * ch;                // 底圖蓋的範圍（往東、往南公尺；海域跟著旗艦走 ⇒ 現在的窗）
  var R = CHART_R[CHART.zoom], ce = BED.ax + me.px, cs = BED.az + me.pz;                            // 中心：我艦（整個海域 ⇒ 海域中心）
  if (!R) { R = Math.max(ew, sw) / 2; ce = e0 + ew / 2; cs = s0 + sw / 2; }
  var kp = chartPx() / ch, sc = W / (2 * R);                                                          // 底圖每公尺幾點；畫面每公尺幾 px
  function P(e, s) { return [W / 2 + (e - ce) * sc, W / 2 + (s - cs) * sc]; }
  g.save(); g.beginPath(); g.roundRect ? g.roundRect(0, 0, W, W, 10) : g.rect(0, 0, W, W); g.clip();
  g.fillStyle = 'rgb(' + CHART_COL.deep.join(',') + ')'; g.fillRect(0, 0, W, W);
  g.imageSmoothingEnabled = true;
  g.drawImage(CHART.im, (ce - R - e0) * kp, (cs - R - s0) * kp, 2 * R * kp, 2 * R * kp, 0, 0, W, W);
  chartTowns(g, P, sc, W);                                                                            // 城鎮（路、建築、城牆、圖示）
  if (CHART.trail.length > 1) {                                                                       // 航跡
    g.strokeStyle = 'rgba(255,236,170,.75)'; g.lineWidth = 1.4; g.setLineDash([3, 3]); g.beginPath();
    CHART.trail.forEach(function (p, i) { var q = P(BED.ax + p[0], BED.az + p[1]); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); });
    var qn = P(BED.ax + me.px, BED.az + me.pz); g.lineTo(qn[0], qn[1]); g.stroke(); g.setLineDash([]);   // 接到現在的位置
  }
  var o = P(BED.ax, BED.az); g.font = '12px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#f0c56a'; g.fillText('⚓', o[0], o[1]);   // 出發點 ＝ 開戰位置（世界原點；海域的原點對齊固定的格線之後不一定在這裡）
  var m = P(BED.ax + me.px, BED.az + me.pz), F = fwd(me.yaw), dx = F[0], dz = F[2], L = 7;           // 我艦：畫面右 ＝ 東、下 ＝ 南
  g.beginPath(); g.moveTo(m[0] + dx * L * 1.4, m[1] + dz * L * 1.4); g.lineTo(m[0] - dx * L + dz * L * 0.7, m[1] - dz * L - dx * L * 0.7); g.lineTo(m[0] - dx * L * 0.5, m[1] - dz * L * 0.5); g.lineTo(m[0] - dx * L - dz * L * 0.7, m[1] - dz * L + dx * L * 0.7); g.closePath();
  g.fillStyle = '#ffffff'; g.fill(); g.strokeStyle = '#10243a'; g.lineWidth = 1.2; g.stroke();
  g.restore();
  // 北、比例尺、範圍
  g.font = 'bold 11px sans-serif'; g.fillStyle = '#e8c26a'; g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText('N', W / 2, 3);
  var bar = [100, 200, 500, 1000, 2000, 5000].filter(function (v) { return v * sc <= W * 0.35; }).pop() || 100, bx = 8, by = W - 9;
  g.strokeStyle = '#f3ead8'; g.lineWidth = 2; g.beginPath(); g.moveTo(bx, by - 3); g.lineTo(bx, by); g.lineTo(bx + bar * sc, by); g.lineTo(bx + bar * sc, by - 3); g.stroke();
  g.font = '10px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillStyle = '#f3ead8'; g.fillText(bar >= 1000 ? bar / 1000 + ' km' : bar + ' m', bx, by - 3);
}
/** 城鎮（63_towns.js TOWNS.list；Tim 2026-10-20「航海小地圖上 是否可以顯示城鎮Icon(同時好像看不到城鎮 只有地形? 可以的話也顯示城鎮)」）：
 *  路（實際的寬、至少 1.2 px，外面一圈深色描邊；顏色 TOWN_COL）、城牆、建築（實例的佔地 pl 照屋頂的顏色 col；模型還沒到 ⇒ 地塊的框）、
 *  市中心（T.cen）一個城鎮圖示（同 Blocksail 地球儀的 townIcon：圓底、白牆、屋頂、門）＋ 名字。座標都是海域的往東、往南（實例 ＝ 減掉 BED.ax、BED.az 的）。 */
function chartTowns(g, P, sc, W) {
  if (!TOWNS.list.length) return;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  TOWNS.list.forEach(function (T) {                                     // 路、城牆、建築：先畫進那座城的圖層（chartTownLayer），每格只貼上去
    var L = chartTownLayer(T, sc, dpr);
    if (!L) { chartTownDraw(g, P, sc, T); return; }
    var p0 = P(L.e0, L.s0); g.drawImage(L.cv, p0[0] - L.pad, p0[1] - L.pad, L.cv.width / dpr, L.cv.height / dpr);
  });
  chartTownIcons(g, P, W);
}
// 城的圖層（TASK-0817）：以前每格把每座城的路、城牆、每一棟建築重畫一次 —— 君士坦丁堡（1,232 條路、12,854 個實例）一格 3 ms 起、53 秒合計 9.5 s。
//   ⇒ 照現在的比例（sc）在一張離屏畫布上畫一次，比例、實例（模型到了、重建）換了才重畫；太大（> CHART_TOWN_MAX 點）⇒ 照舊每格直接畫。
var CHART_TOWN_MAX = 4096;
function chartTownLayer(T, sc, dpr) {
  var pad = 4, b = T.box, w = Math.ceil(((b[2] - b[0]) * sc + 2 * pad) * dpr), h = Math.ceil(((b[3] - b[1]) * sc + 2 * pad) * dpr), L = T.chartL;
  if (w > CHART_TOWN_MAX || h > CHART_TOWN_MAX) return null;
  if (L && L.sc === sc && L.dpr === dpr && L.inst === T.inst) return L;
  var cv = L ? L.cv : document.createElement('canvas'); cv.width = w; cv.height = h;
  var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  chartTownDraw(g, function (e, s) { return [(e - b[0]) * sc + pad, (s - b[1]) * sc + pad]; }, sc, T);
  return (T.chartL = { cv: cv, sc: sc, dpr: dpr, inst: T.inst, e0: b[0], s0: b[1], pad: pad });
}
/** 一座城的路、城牆、建築（P：海域的往東、往南 ⇒ 畫面 px）。 */
function chartTownDraw(g, P, sc, T) {
  function rgb(c, k) { return 'rgb(' + c.map(function (v) { return Math.round(Math.min(1, v * (k || 1)) * 255); }).join(',') + ')'; }
  function path(L) { g.beginPath(); L.forEach(function (q, i) { var p = P(q[0], q[1]); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); }
  function quad(C) { path(C); g.closePath(); g.fill(); }
  g.lineJoin = 'round'; g.lineCap = 'round';
  [0, 1].forEach(function (pass) {                                    // 路：先描邊、再路面
    T.roads.forEach(function (r) { var w = Math.max(1.2, r.w * sc); path(r.P); g.lineWidth = pass ? w : w + 1.6; g.strokeStyle = pass ? rgb(TOWN_COL[r.kind] || TOWN_COL.street, 1.15) : 'rgba(30,20,10,.55)'; g.stroke(); });
  });
  (T.p.walls || []).forEach(function (w) { var P2 = w.path.map(T.E); if (w.closed) P2.push(P2[0]); path(P2); g.lineWidth = Math.max(1.5, (w.w || 4) * sc); g.strokeStyle = 'rgb(170,160,140)'; g.stroke(); });
  if (T.inst) T.inst.forEach(function (q) {                           // 建築、城牆的部件：模型的 +x ＝ (sinθ, −cosθ)、+y ＝ (−cosθ, −sinθ)
    var hw = q.pl ? q.pl[0] / 2 : q.ft ? q.ft[0] : 0, hd = q.pl ? q.pl[1] / 2 : q.ft ? q.ft[1] : 0; if (!hw) return;
    var s = Math.sin(q.th), c = Math.cos(q.th), x = q.x + BED.ax, z = q.z + BED.az;
    g.fillStyle = rgb(q.col || [0.6, 0.45, 0.35], q.sh || 1);
    quad([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (k) { var a = k[0] * hw, b = k[1] * hd; return [x + a * s - b * c, z - a * c - b * s]; }));
  });
  else (T.p.lots || []).forEach(function (l) {                         // 模型還沒到 ⇒ 地塊的框（空建地、廣場不畫）
    if (l.use === 'plot' || l.use === 'plaza') return;
    var t = l.rot * Math.PI / 180, c = Math.cos(t), s = Math.sin(t), hd = l.d / 2, hw = l.w / 2;
    g.fillStyle = 'rgba(190,150,110,.85)'; quad([[-hd, -hw], [hd, -hw], [hd, hw], [-hd, hw]].map(function (k) { return T.E([l.at[0] + k[0] * c - k[1] * s, l.at[1] + k[0] * s + k[1] * c]); }));
  });
}
/** 城鎮圖示＋名字（在路、建築上面；每格畫）。 */
function chartTownIcons(g, P, W) {
  g.font = 'bold 10px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
  TOWNS.list.forEach(function (T) {                                     // 圖示＋名字（在路、建築上面）
    var p = P(T.cen[0], T.cen[1]), x = p[0], y = p[1] - 2; if (x < -40 || y < -20 || x > W + 40 || y > W + 20) return;
    g.beginPath(); g.arc(x, y, 7.5, 0, 6.2832); g.fillStyle = 'rgba(5,15,25,.8)'; g.fill(); g.lineWidth = 1.2; g.strokeStyle = 'rgba(243,234,216,.9)'; g.stroke();
    g.fillStyle = '#f3ead8'; g.fillRect(x - 3.5, y - 0.4, 7, 4.2);                                     // 牆
    g.beginPath(); g.moveTo(x - 4.8, y); g.lineTo(x, y - 4.6); g.lineTo(x + 4.8, y); g.closePath(); g.fillStyle = '#e8c26a'; g.fill();   // 屋頂
    g.fillStyle = '#2a1607'; g.fillRect(x - 0.9, y + 1.4, 1.8, 2.4);                                  // 門
    if (T.name) { g.lineWidth = 3; g.strokeStyle = 'rgba(5,15,25,.85)'; g.strokeText(T.name, x + 10, y); g.fillStyle = '#f3ead8'; g.fillText(T.name, x + 10, y); }
  });
}
/** 讀數（?debug=1 的 __game.chart()）：開了沒、範圍、吃水門檻、底圖畫了幾塊（細／粗）、航跡幾點、畫面上的位置。 */
function chartInfo() {
  var r = CHART.res || {}, ks = Object.keys(r), b = CHART.box && CHART.box.style.display !== 'none' ? CHART.cv.getBoundingClientRect() : null;
  return { on: !!b, zoom: CHART_R[CHART.zoom], need: +CHART.need.toFixed(2), fine: ks.filter(function (k) { return r[k] > 100; }).length, coarse: ks.filter(function (k) { return r[k] <= 100; }).length, trail: CHART.trail.length,
    box: b ? [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)] : null, view: [innerWidth, innerHeight] };
}
