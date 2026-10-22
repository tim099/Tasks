// ───────────────────────── 進水報表（沙盒；TASK-0654） ─────────────────────────
// Tim 2026-10-16：「沙盒可以做專門的報表紀錄水的變化細節與畫面對應 方便比對」（先量接縫是哪一種再動手）。
// ?lab=flood（＋ ship=<船>,<另一艘>、phx=mid／high／full ⇒ 進水粗／中／細）⇒ 船在沙盒裡浮穩（不開帆、另一艘移遠）、在水線下打幾個洞，
//   之後每 every 秒記一筆：進水讀數（33_flood.js flReadout）、水面網格（三角形、那一次重做幾毫秒）、接縫分類（flSeams）、同一刻的截圖（固定鏡頭）。
//   截圖那一刻 FL_SNAP（水面網格當場重做、不內插）⇒ 圖跟讀數是同一刻；量完 FL_SNAP／FL_STAT 還原。
// 結果寫進頁面上 id ＝ lab 的 pre（JSON；截圖是 data URL）；無頭 Chrome --dump-dom 讀：src/tests/flood_lab.py 寫成並排的 HTML 報表（../reports/，不入版控）。
//   ?debug=1 時 __game.floodLab(o) 同一套、回傳同一份。
// 參數（網址同名）：holes（x:dz:side:r，以 ; 分隔：x ＝ 水線那一段船長的比例 0–1、dz ＝ 水線下幾格、side 0 ＝ 格 +y 那一舷、r ＝ 半徑幾格；不給 ⇒ 預設三個）、
//   dur（秒，預設 60）、every（秒，預設 10）、fyaw、fpitch、fdist、fty（鏡頭；fty ＝ 注視點在船中心上面幾公尺，看底艙給負的；⛔ 不叫 dist／pitch：dist 是開局兩艘船的距離、pitch 是 ?cam=deck 的俯角 —— 撞名量過：dist=38 把另一艘擺到旁邊、進水整個不一樣）、cut（half ＝ 剖面、none；預設 half）、deck（拿掉幾層甲板，預設 0）、xray（1 ＝ 透視）、
//   boom（殉爆開局，TASK-0662：彈藥庫編號，0 後、1 前、0,1 兩間；浮穩之後直接整間炸 ⇒ 沒另外給 holes 就不打預設的洞；每一筆多記 ex ＝ 艙內最高水面離海面幾公尺（flabEx），另有每秒一筆的 trace）、
//   w（截圖寬，預設 480）、flat（1 ＝ 浪設 0）、focus（step ＝ 每一筆把鏡頭對準水面差最大的那條兩池交界；cell:x:y ＝ 固定對準那一欄最高的水面 —— 照 fpitch／fdist 拉近、鏡頭擺在往船中心那一側，fyaw 不用）。
// 對解析解（TASK-0806；Tim 2026-10-22，進水換演算法 TASK-0804 的第一步）：hz（模擬步長 60／30／10 Hz：開局之後換 DT、DT_BASE；量完還原）、
//   pin（1 ＝ 浮穩之後把船的位置與姿態釘住：每一步之後照浮穩那一刻還原、重算矩陣 ⇒ 水頭只由艙內水位決定）、pump（0 ＝ 這艘不抽水）、
//   ref（1 ＝ 另算一條參考解 flabRef：那個洞通得到的艙內空間照格與世界高度由低往高填、Torricelli 照模擬自己的係數與破口面積、1 ms 一步積分）。
//   都不給 ⇒ 跟加之前逐位相同（只多讀幾個網址參數）。
// 房間的水面（TASK-0811）：rooms（1 ＝ 照房間畫、0 ＝ 水格的；同一個種子跑兩次並排比）、roll（浮穩之後橫傾幾度，配 pin=1 停住）；給了 rooms ⇒ 每一筆多記 wr（63_wrwater_gl.js wrwMesh 的讀數）。
// 房間模擬（TASK-0808）：wsim（1 ＝ 跟細檔並排跑 33_wrsim.js，同一組破口；每一筆多記 wsim、每秒 traceR／traceT；配 ref=1 多一份 refR）；畫面（rooms=1）改畫房間模擬的水；wpic（每幾秒一組過程圖，wsimPic）、wpx。
// ⛔ 只在 ?lab=flood 或 __game.floodLab 才跑；一般遊戲一行都不多算。
// 鏡頭用自由鏡頭（CAM.mode 0：注視點 CAM.tgt、yaw／pitch／dist 照給的）。⛔ mode 4 是「我艦看向敵艦」：注視點固定在我艦中心上 4 m、yaw 照敵艦方向 ⇒ fyaw、對準都沒效（量過：focus 對準的點被蓋回船中心）。
// ⚠ 要帶 seed（flood_lab.py 沒給就補 seed=3）：沒帶 ⇒ 每次開都是隨機的一局，浮穩的姿勢、洞的位置、進水都不一樣（量過：同一組參數兩次 t 38 是 130／138 m³）；
//   帶了 ⇒ 兩次逐位元相同（帆繩物理開關都一樣）。
var FLAB_HOLES = [[0.35, 8, 0, 4], [0.55, 12, 1, 4], [0.7, 6, 0, 3]];

/** 在第 sh 艘、格 (x, z) 那一舷（side 0 ＝ 格 +y、1 ＝ −y）的船殼打一個半徑 r 格的洞（從最外那一格往艙內打穿）。__game.hole 與進水報表共用。 */
function labHole(sh, x, z, side, r) {
  var B = sh.T.base, y0 = -1, y, s = side ? 1 : -1, n = 0; r = r || 4;
  if (side) { for (y = 0; y < sh.T.cy; y++) if (B.get(x, y, z)) { y0 = y; break; } } else { for (y = B.sy - 1; y > sh.T.cy; y--) if (B.get(x, y, z)) { y0 = y; break; } }
  if (y0 < 0) return null;
  for (var dz = -r; dz <= r; dz++) for (var dx = -r; dx <= r; dx++) {
    if (dx * dx + dz * dz > r * r) continue;
    for (var t = 0; t < 16; t++) { var yy = y0 + s * t; if (t > 2 && !B.get(x + dx, yy, z + dz)) break; if (removeVoxel(sh, x + dx, yy, z + dz, false)) n++; }
  }
  sh.rs.flush(); return { removed: n, skin: y0 };
}

/** 截圖：畫布縮到寬 w 的 JPEG（data URL）。畫布開著 preserveDrawingBuffer（01_gl.js）⇒ render() 之後隨時讀得到。 */
function flabShot(w) {
  var h = Math.round(cv.height * w / cv.width), c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
  c2.getContext('2d').drawImage(cv, 0, 0, w, h); return c2.toDataURL('image/jpeg', 0.82);
}

/** 接縫地圖（俯視，一格一個方塊；x 往右 ＝ 船頭方向的格 x、y 往下 ＝ 格 y）：
 *  方塊顏色 ＝ 哪一池（同一池同色，只用綠到藍 ⇒ 不跟紅、橘、洋紅撞；越深 ＝ 越高的甲板，高的畫在上面）、紅 ＝ 整塊沒畫（中心都判在船殼外）、橘框 ＝ 船殼邊切掉幾片、洋紅點 ＝ 有水但太薄沒畫；
 *  綠粗線 ＝ 兩池交界（兩片平面之間沒有面）、黃線 ＝ 懸空的邊（鄰格裝得了水但乾的）。 */
function flabMap(st, px) {
  var M = st.map, c2 = document.createElement('canvas'), W = M.NX * px + 2, H = M.NY * px + 2, g = c2.getContext('2d'); c2.width = W; c2.height = H;
  g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, W, H);
  M.top.slice().sort(function (a, b) { return a[2] - b[2]; }).forEach(function (q) {
    var x = 1 + q[0] * px, y = 1 + q[1] * px;
    g.fillStyle = q[4] === 2 ? '#e02020' : 'hsl(' + (90 + (q[3] * 53) % 160) + ',45%,' + (66 - Math.min(24, q[2] * 3)) + '%)'; g.fillRect(x, y, px, px);
    if (q[4] === 1) { g.strokeStyle = '#ff8c00'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, px - 2, px - 2); }
  });
  g.fillStyle = '#d000d0'; (st.thin || []).forEach(function (q) { g.beginPath(); g.arc(1 + (q[0] + 0.5) * px, 1 + (q[1] + 0.5) * px, px * 0.22, 0, 7); g.fill(); });
  M.edge.forEach(function (e) {
    var x = 1 + e[0] * px, y = 1 + e[1] * px, d = e[2];
    g.strokeStyle = e[3] === 1 ? '#0a8a2a' : '#e6c200'; g.lineWidth = e[3] === 1 ? 3 : 2; g.beginPath();
    if (d === 0) { g.moveTo(x, y); g.lineTo(x, y + px); } else if (d === 1) { g.moveTo(x + px, y); g.lineTo(x + px, y + px); } else if (d === 2) { g.moveTo(x, y); g.lineTo(x + px, y); } else { g.moveTo(x, y + px); g.lineTo(x + px, y + px); }
    g.stroke();
  });
  return c2.toDataURL('image/png');
}

/** 整個報表：o 見檔頭。回 { hull, lv, o, holes, rows: [{ t, fl, mesh, seam, img, map }] }。
 *  ⚠ 截圖每次跑都會差一點（量過：還沒進水的 t 8 兩次就不一樣，換掉 Math.random 也一樣 ⇒ 畫面裡有別的跟真實時間走的東西）⇒ 比圖照像素差的大小比，不比位元組。 */
function floodLab(o) {
  o = Object.assign({ holes: FLAB_HOLES, dur: 60, every: 10, yaw: 2.6, pitch: 0.42, dist: 0, cut: 'half', deck: 0, xray: false, w: 480, flat: false }, o || {});
  var seaK = SEA_K; if (o.flat) SEA_K = 0;
  flowMode('sandbox'); reset(); AUTOFIRE = false; flowRun(false);
  var DT0 = DT; if (o.hz > 0) DT = DT_BASE = 1 / o.hz;                   // 換模擬步長（TASK-0806）：⛔ 要在 reset 之後換 —— 開局照物理設定重設 DT、DT_BASE（70_flow.js resetSteps，TASK-0805）；量完還原成開局設的
  var sh = SHIPS[0], i;
  SHIPS.forEach(function (s2) { s2.sailSet = 0; s2.power = 0; s2.manual = true; s2.rudder = 0; });
  if (SHIPS[1]) { SHIPS[1].px += 3000; SHIPS[1].pz += 3000; }
  for (i = 0; i < Math.round(LAB_SETTLE / DT); i++) simStep();
  if (o.roll !== undefined) sh.rollA = o.roll * Math.PI / 180;           // 橫傾幾度（TASK-0811；配 pin=1 才停得住）
  sh.M = shipMatrix(sh); sh.inv = M4.inv(sh.M); sh.center = shipCenter(sh);
  var pin = o.pin ? flabPin(sh) : null;                                  // 釘住姿態（TASK-0806）：每一步之後還原
  var wrw0 = GFX.proom; if (o.rooms !== undefined) GFX.proom = o.rooms ? 1 : 0;   // 照房間畫水面（TASK-0811，畫質「艙內水面的畫法」）；量完還原
  if (o.pump === 0) { sh.cfg.pump = 0; sh.pumps = null; }                // 這艘不抽水（pumpK ⇒ 0；sh.cfg 是這艘自己的一份 cfgCopy）
  var out = { hull: sh.T.id, seed: SEED, lv: FLOOD_LV, c: sh.fl ? sh.fl.F.c : null, sea: SEA_K, o: { dur: o.dur, every: o.every, cut: o.cut, deck: o.deck, xray: !!o.xray }, holes: [], rows: [] };
  if (o.hz > 0) out.o.hz = o.hz; if (pin) out.o.pin = 1; if (o.pump === 0) out.o.pump = 0;   // 只在給了才記（⛔ 都不給 ⇒ 報表跟加之前逐位相同）
  if (o.rooms !== undefined) out.o.rooms = o.rooms ? 1 : 0; if (o.roll !== undefined) out.o.roll = o.roll;
  if (!sh.fl) {                                                         // 公式模式（物理效果的「進水」第 0 檔）：沒有艙內的水可畫 ⇒ 只記每秒水線下的洞幾格（sh.inflow，32_hull.js stepShip）、砲口（TASK-0822）；網址加 phx=mid／high／full 才有細檔
    out.err = '進水是公式模式 ⇒ 只有 traceF（每秒 [t, 水線下的洞幾格, 下沉 m]）與 guns';
    var evF = (o.pset || []).map(function (e) { return { t: e[0], k: e[1], v: e[2] }; }).concat((o.pbreak || []).map(function (e) { return { t: e[0], pb: e[1] }; })), t0F = SIMT, tnF = Math.max(1, Math.round(1 / DT));
    out.events = []; out.traceF = [];
    for (i = 0; i < Math.round(o.dur / DT); i++) { if (evF.length) flabEvents(sh, pin, evF, SIMT - t0F, out); simStep(); if (pin) pin(); if (i % tnF === tnF - 1) out.traceF.push([+SIMT.toFixed(1), sh.inflow || 0, +sh.sink.toFixed(3)]); }
    out.guns = flabGuns(sh);
    SEA_K = seaK; DT = DT_BASE = DT0; GFX.proom = wrw0; return out;
  }
  var T = sh.T, x0 = T.wl0, x1 = T.wl1;
  if (o.boom) o.boom.forEach(function (k) { var g = sh.mags[k]; if (g) magBoom(sh, g); out.holes.push({ boom: k, mag: g ? g.name : null }); });   // 殉爆開局（TASK-0662）：整間直接炸（同 __game.ignite(0, k, 'mag')）
  (o.boom && !o.holesSet ? [] : o.holes).forEach(function (hd) {
    var x = Math.round(x0 + (x1 - x0) * hd[0]), sk = labSkin(sh, x, hd[2]);
    var z = sk ? sk.z - hd[1] : null, r = z === null ? null : labHole(sh, x, z, hd[2], hd[3]);
    out.holes.push({ x: x, z: z, side: hd[2], r: hd[3], removed: r ? r.removed : 0 });
  });
  var tHole = SIMT, holeA = function () { return [+SIMT.toFixed(1), sh.fl.holes.filter(function (h) { return sh.fl.hA[h] > 0; }).map(function (h) { return [h, +sh.fl.hA[h].toFixed(4)]; })]; };   // 參考解從打洞那一刻起算（flabRef）；holeA ＝ 那一刻每個洞的面積（參考解照當時的算）
  out.traceA = [holeA()];
  if (o.wsim) { if (!(sh.fl && sh.fl.L.room && sh.wrs)) sh.wrs = wrsInit(sh); out.o.wsim = 1; out.wsimDoors = wsimDoors(sh); out.traceR = []; out.traceT = []; if (o.wsimo) { o.wsimo.forEach(function (k) { sh.wrs.opt[k] = true; }); out.o.wsimo = o.wsimo.join(','); } }   // 房間模擬並排跑（TASK-0808，33_wrsim.js）：同一組破口；每秒一筆 traceR ＝ [t, 水 m³, 橫傾目標, 縱傾目標, 小步數, ms]，traceT ＝ 細檔的 [t, 橫傾目標, 縱傾目標]
  // 鏡頭：對著船中、看艙內（剖面拿掉靠鏡頭那一半）
  var cc = shipCenter(sh); camSet({ tgt: [cc[0], cc[1] + (o.ty || 0), cc[2]], trYaw: null, trMe: null });   // 注視點：船中心往上 ty 公尺（看底艙 ⇒ 負的）
  camSet({ follow: null, mode: 0, yaw: o.yaw, pitch: o.pitch, dist: o.dist > 0 ? o.dist : Math.max(60, (x1 - x0) * S * 0.95) });
  CUTV.half = o.cut === 'half'; CUTV.deck = o.deck | 0; FLX3 = !!o.xray;
  var snap0 = FL_SNAP, stat0 = FL_STAT; FL_SNAP = FL_STAT = true;
  var n = Math.round(o.every / DT), steps = Math.max(1, Math.round(o.dur / o.every)), tn = Math.max(1, Math.round(1 / DT));
  var npic = o.wsim && o.wpic > 0 ? Math.max(1, Math.round(o.wpic / DT)) : 0, kpic = 0;   // 房間模擬的過程圖（wsimPic）：開局一組、之後每 wpic 秒一組
  if (npic) { sh.wrs.spillAt = []; out.wpic = [wsimPic(sh, o.wpx)]; out.o.wpic = o.wpic; }
  var evs = (o.pset || []).map(function (e) { return { t: e[0], k: e[1], v: e[2] }; }).concat((o.wkill || []).map(function (e) { return { t: e[0], door: e[1] }; })).concat((o.pbreak || []).map(function (e) { return { t: e[0], pb: e[1] }; }));   // 中途改姿態、打掉門（TASK-0808 驗收第 9、11 格；flabEvents）
  if (evs.length) out.events = [];
  var wdz = [0, 0, 0];                                                  // 房間模擬走那一步之前，物理把船推離釘住的姿態多少（船的 y 平移，m）：[總和, 步數, 最大]（⛔ 以前 wrsStep 在 pin 之前 ⇒ 看到的是被推了一步的船：0.1 秒一步下沉 ½·a·dt²，水越多越沉 ⇒ 10 Hz 後段往上爬；wsimo=prepin 還原舊順序對照）
  out.trace = [];                                                       // 每秒一筆：[t, 水 m³, 進 m³/s, 出 m³/s, 艙內最高水面 − 海面 m, 高出海面的水 m³, 下沉 m]（flabEx）
  for (var k = 0; k <= steps; k++) {
    var focusAt = null;
    if (k) { for (i = 0; i < n; i++) { if (evs.length) flabEvents(sh, pin, evs, SIMT - tHole, out); simStep(); if (sh.wrs && o.wsim && !(sh.fl && sh.fl.L.room)) { var m13 = sh.M[13]; if (pin && !sh.wrs.opt.prepin) pin(); wrsStep(sh, DT, sh.fl); if (pin) { pin(); var dzp = m13 - sh.M[13]; wdz[0] += dzp; wdz[1]++; if (Math.abs(dzp) > Math.abs(wdz[2])) wdz[2] = dzp; } } else if (pin) pin(); if (npic && ++kpic >= npic) { kpic = 0; out.wpic.push(wsimPic(sh, o.wpx)); } if (o.wsim && i % tn === tn - 1) { var rd = wrsRead(sh), tf = floodTilt(sh, sh.fl); var bq = 0; sh.wrs.br.forEach(function (bb) { if (bb.j >= 0) bq += bb.q; }); out.traceR.push([+SIMT.toFixed(1), rd.vol, rd.roll, rd.pitch, rd.sub, rd.ms, rd.hash, +bq.toFixed(4), sh.wrs.tops.map(function (tp) { return +tp.q.toFixed(4); })]); out.traceT.push([+SIMT.toFixed(1), +tf[0].toFixed(4), +tf[1].toFixed(4)]); } if (i % 30 === 29) remesh(Infinity); if (i % tn === tn - 1) { out.traceA.push(holeA()); var ex = flabEx(sh); out.trace.push([+SIMT.toFixed(1), +sh.fl.vol.toFixed(1), +sh.fl.inQ.toFixed(2), +sh.fl.outQ.toFixed(2), ex.max, ex.vol, +sh.sink.toFixed(2)]); } } }
    remesh(Infinity); camSet({ snap: true }); camUpdate(1); render();
    if (o.focus === 'step' && sh.fl.mesh && sh.fl.mesh.stat) {             // 對準水面差最大的那條兩池交界（高的那一邊），拉近再拍
      var E = sh.fl.mesh.stat.map.edge.filter(function (e) { return e[3] === 1 && e[4] > 0; }).sort(function (a, b) { return b[4] - a[4]; })[0];
      if (o.focusCell) {                                                  // focus=cell:x:y ⇒ 固定對準那一欄（改前改後同一個角度比）：那一欄最高的水面
        var TT = sh.fl.mesh.stat.map.top.filter(function (q) { return q[0] === o.focusCell[0] && q[1] === o.focusCell[1]; }).sort(function (a, b) { return b[2] - a[2]; })[0];
        var Fc = sh.fl.F, hcell = TT ? M4.pt(sh.M, Fc.X0 + (TT[0] + 0.5) * Fc.c, Fc.Y0 + (TT[1] + 0.5) * Fc.c, (TT[2] + 1) * Fc.c)[1] : null;
        E = TT ? [TT[0], TT[1], -1, 1, 0, hcell] : null;
      }
      if (E) {
        var F2 = sh.fl.F, M = sh.M, gx = F2.X0 + (E[0] + 0.5 + (E[2] === 0 ? -0.5 : E[2] === 1 ? 0.5 : 0)) * F2.c, gy = F2.Y0 + (E[1] + 0.5 + (E[2] === 2 ? -0.5 : E[2] === 3 ? 0.5 : 0)) * F2.c;
        var gzz = (E[5] - (M[1] * gx + M[5] * gy + M[13])) / M[9], P = M4.pt(M, gx, gy, gzz);
        var ccn = shipCenter(sh); camSet({ yaw: Math.atan2(ccn[2] - P[2], ccn[0] - P[0]) });   // 鏡頭擺在那一點往船中心那一側（從艙裡往船殼看）⇒ 對準時 fyaw 不用
        camSet({ tgt: [P[0], P[1] - E[4] * 0.5, P[2]], trYaw: null, trMe: null, snap: true }); camUpdate(1); render();
        focusAt = { ix: E[0], iy: E[1], dir: E[2], dh: +E[4].toFixed(2) };
      }
    }
    var me = sh.fl.mesh, st = me && me.stat ? me.stat : null, dh = st ? st.dh.slice().sort(function (a, b) { return a - b; }) : [];
    out.rows.push({ t: +SIMT.toFixed(1), fl: flReadout(sh), ex: flabEx(sh, true), ship: { broken: !!sh.broken, final: !!sh.sinkingFinal, sunk: !!sh.sunk }, focus: focusAt, cam: { eye: CAM.eye.map(function (v) { return +v.toFixed(2); }), look: (CAM.look || CAM.tgt).map(function (v) { return +v.toFixed(2); }) },
      mesh: me ? { tris: me.n / 3, quads: me.quads, ms: +(me.ms || 0).toFixed(2), falls: me.fn ? me.fn / 6 : 0, sides: me.sideN || 0, spill: me.fallN || 0, sideMax: me.sst ? +me.sst.max.toFixed(2) : 0, sideAt: me.sst ? me.sst.at : null, sideXo: me.sst ? me.sst.xo : 0, sideXf: me.sst ? me.sst.xf : 0, sideXoAt: me.sst && me.sst.xoAt ? me.sst.xoAt.slice(0, 8) : null, sideXn: me.sst ? me.sst.xn : 0, sideXoMax: me.sst ? me.sst.xoMax : 0, depBlit: FL_DEPBLIT, fst: me.fst || null } : null,
      seam: st ? { tops: st.tops, pools: st.pools, join: st.join, step: st.step, open: st.open, wall: st.wall, cutTops: st.cutTops, cutPieces: st.cutPieces, outTops: st.outTops,
        dhMed: dh.length ? +dh[dh.length >> 1].toFixed(2) : 0, dhMax: dh.length ? +dh[dh.length - 1].toFixed(2) : 0,
        openAt: st.map.edge.filter(function (e) { return e[3] === 2; }).slice(0, 12).map(function (e) { return e.slice(0, 3); }) } : null,   // 懸空的邊（水邊 noise 會上的那幾邊）：[x, y, 方向] ⇒ focus=cell:x:y 拉近看
      img: flabShot(o.w), map: st ? flabMap(st, sh.fl.F.c >= 10 ? 10 : 6) : null });
    if (o.wsim) { out.rows[out.rows.length - 1].wsim = wrsRead(sh); if (sh.wrs.opt.bench) out.rows[out.rows.length - 1].wsim.bench = wrsBench(sh); }       // 房間模擬的讀數（33_wrsim.js wrsRead）
    if (o.rooms !== undefined) out.rows[out.rows.length - 1].wr = sh.wrw ? sh.wrw.st : null;   // 房間水面的讀數（63_wrwater_gl.js wrwMesh：幾間、幾欄、切邊的欄、片數、水量、ms）
  }
  if (o.wsim) out.guns = flabGuns(sh);   // 每門砲：名字、哪一舷、砲口比海面高幾公尺（負 ⇒ 在水下）、有沒有蓋板（62_ports.js）、還在不在、船殼上的開口幾格、開口最低那一層比海面高幾公尺、登記成進水口了沒（25_doors.js portHole／portOpen；TASK-0822）
  if (o.wsim && sh.guns && sh.guns.length) { var g0 = sh.guns.filter(function (q) { return q.side === 'S'; }).sort(function (a2, b2) { return Math.abs(b2.ax[1]) - Math.abs(a2.ax[1]); })[0] || sh.guns[0], T0 = sh.T, s0 = g0.ax[1] >= 0 ? 1 : -1, xg = Math.floor(g0.muz[0]), zg = Math.floor(g0.muz[2]), rowsP = [];   // 除錯：第一門右舷砲附近的船殼剖面（每一層從外往裡：# 實心、. 空；| ＝ 外形半寬那一格）
    for (var dzp = 6; dzp >= -6; dzp--) { var zp = zg + dzp, BB = T0.base || T0.hullG, hbp = null; for (var xq = xg - 6; xq <= xg + 6; xq++) for (var yq = s0 > 0 ? BB.sy - 1 : 0; s0 > 0 ? yq > T0.cy : yq < T0.cy; yq -= s0) if (BB.get(xq, yq, zp)) { if (hbp === null || (s0 > 0 ? yq > hbp : yq < hbp)) hbp = yq; break; } var yo = hbp === null ? Math.round(T0.cy) : hbp, line = ''; for (var t3 = -3; t3 < 16; t3++) { var yy = yo - s0 * t3; line += (t3 === 0 ? '|' : '') + (BB.get(xg, yy, zp) ? '#' : '.'); } rowsP.push([zp, +hbp.toFixed ? +(+hbp).toFixed(2) : hbp, line]); }
    out.portProbe = { gun: g0.name, muz: g0.muz.map(function (v) { return +v.toFixed(2); }), ax: g0.ax.map(function (v) { return +v.toFixed(3); }), cy: T0.cy, rows: rowsP }; }
  if (sh.fl && sh.fl.msN) out.flMs = { step: +(sh.fl.ms / sh.fl.msN).toFixed(4), n: sh.fl.msN };   // 這艘進水每步平均幾 ms（33_flood.js floodStep；⚠ 白天會飄）
  if (o.wsim && pin) out.wsimDz = { mean: wdz[1] ? +(wdz[0] / wdz[1]).toFixed(5) : 0, max: +wdz[2].toFixed(5), prepin: !!sh.wrs.opt.prepin };
  if (o.ref) out.ref = flabRef(sh, out.trace, tHole, out.traceA);
  if (o.ref && o.wsim) out.refR = flabRef(sh, out.traceR, tHole, out.traceA);      // 同一個參考解對房間模擬
  FL_SNAP = snap0; FL_STAT = stat0; SEA_K = seaK; DT = DT_BASE = DT0; GFX.proom = wrw0;
  return out;
}

/** 房間模擬的過程圖（TASK-0808；Tim 2026-10-22「可以額外加上debug資訊輸出排查（寫檔 也可以圖片化輸出模擬結果）」「可以輸出多張圖查看進水過程」）。
 *  ?lab=flood&wsim=1&wpic=<秒>（＋ wpx ＝ 一格幾像素，預設 2）⇒ 開局那一刻與之後每 wpic 秒一組，out.wpic[]：
 *    side（側視：x 往右、z 往上）：每個 (x, z) 那一排 —— 底色 ＝ 最多的那一間的房間色（調暗 ⇒ 看得到艙房分割，同 ?lab=wrooms 的顏色）、藍 ＝ 那一排有幾成在水面以下；
 *    fill（側視）：每個 (x, z) 最多的那一間裝了幾成 —— 灰 ＝ 乾、青 → 黃 ＝ 裝了一部分、紅 ＝ 整間滿；
 *    press（側視，Tim 2026-10-22「debug可以用顏色表示水壓」）：每個 (x, z) 那一排水最深的那一格上面有幾公尺水頭（照那一欄的有效水面 lv；灌滿的照連通水體的水壓）—— 淺黃 → 橘 → 深紅（≥ 2 m）、洋紅 ＝ 那一欄的水壓高過海面；
 *    top（俯視：x 往右、y 往下）：每個 (x, y) 那一柱有幾成在水面以下；
 *    標記：紅十字 ＝ 破口、黃點 ＝ 飛行中的粒子、洋紅點 ＝ 這一段溢出（記成流回海裡）的落點（33_wrsim.js s.spillAt）。
 *    rooms ＝ 有水或這一段有溢出的房間 [房, 容積 m³, 水 m³, 裝了幾成, 這一段溢出 m³]（照水量排，最多 24 間）；r ＝ wrsRead 的讀數。 */
function wsimPic(sh, px) {
  var s = sh.wrs, W = s.W, X = s.X, C = W.c, NX = W.nxv, NY = W.ny, NZ = W.zTop, u = s.su, j, r, z, xi;   // W、X、u ＝ 模擬的段（33_wrsim.js wrsSegs）；房間、網格照烘焙的（W 繼承）
  px = px || 2;
  var zc = new Float32Array(s.n); for (j = 0; j < s.n; j++) zc[j] = u[j] > 0 ? wrColZ(W, X, j, u[j]) : -1;
  var sN = new Int32Array(NX * NZ), sW = new Int32Array(NX * NZ), tN = new Int32Array(NX * NY), tW = new Int32Array(NX * NY), pH = new Float32Array(NX * NZ).fill(-1), pUp = new Uint8Array(NX * NZ), Mp = sh.M;
  if (!s.picDom) {                                                       // 每個 (x, z) 最多的那一間（不會變，算一次）
    s.picDom = new Int32Array(NX * NZ).fill(-1);
    for (z = 0; z < NZ; z++) for (xi = 0; xi < NX; xi++) { var k0 = z * NX + xi, by = {}, bn = 0; for (var i0 = W.rowS[k0]; i0 < W.rowS[k0 + 1]; i0++) { r = W.regRoom[W.runReg[i0]]; by[r] = (by[r] || 0) + W.ry1[i0] - W.ry0[i0] + 1; if (by[r] > bn) { bn = by[r]; s.picDom[k0] = r; } } }
  }
  for (z = 0; z < NZ; z++) for (xi = 0; xi < NX; xi++) {
    var k = z * NX + xi, cx = Math.floor(xi / C);
    for (var i = W.rowS[k]; i < W.rowS[k + 1]; i++) {
      r = W.regRoom[W.runReg[i]];
      for (var cy = Math.floor((W.ry0[i] - W.ylo) / C), cy1 = Math.floor((W.ry1[i] - W.ylo) / C); cy <= cy1; cy++) {
        var yA = Math.max(W.ry0[i], W.ylo + cy * C), yB = Math.min(W.ry1[i], W.ylo + cy * C + C - 1), q0 = s.idx.get(r * s.NCK + cx * W.NCY + cy), q = q0 === undefined ? -1 : wrsSegAt(s.G, q0, z + 0.5);   // 那一欄裡含這一層的那一段
        var wet = q >= 0 && zc[q] > z + 0.5;
        sN[k] += yB - yA + 1; if (wet) sW[k] += yB - yA + 1;
        if (wet) { var yc = (yA + yB + 1) / 2, wz2 = Mp[1] * (W.x0 + xi + 0.5) + Mp[5] * yc + Mp[9] * (z + 0.5) + Mp[13], hd2 = s.lv[q] - wz2; if (hd2 > pH[k]) pH[k] = hd2; if (!pUp[k]) { var Ps = M4.pt(Mp, W.x0 + xi + 0.5, yc, z + 0.5); if (s.lv[q] > 0.02 + seaH(Ps[0], Ps[2], SIMT)) pUp[k] = 1; } }   // 水壓：那一格上面有幾公尺的水頭（照那一欄的有效水面 lv：灌滿的照那一塊連通水體的水壓）；水面高過海面 ⇒ 標記
        for (var y = yA; y <= yB; y++) { var t = xi * NY + y - W.ylo; tN[t]++; if (wet) tW[t]++; }
      }
    }
  }
  var cap = new Float64Array(s.NR), wat = new Float64Array(s.NR), top = new Float64Array(s.NR).fill(-1e9), M = sh.M;
  for (j = 0; j < s.n; j++) { cap[W.colRoom[j]] += s.cap[j]; wat[W.colRoom[j]] += u[j]; if (u[j] > 0) { var Pw = M4.pt(M, X.cx[j], X.cy[j], zc[j]); top[W.colRoom[j]] = Math.max(top[W.colRoom[j]], Pw[1] - seaH(Pw[0], Pw[2], SIMT)); } }   // 每間最高的水面比那裡的海面高多少（m；＞ 0 ⇒ 高過海面）
  var vS = new Float64Array(s.NR), vAb = new Float64Array(s.NR), vDf = new Float64Array(s.NR), rlS = new Float64Array(s.NR).fill(-1e9);   // 每間照海面裝得下多少（每一欄裝到它正上方的海面）、高過海面的、比海面低還沒裝的（單位）；平均水面 − 海面（m）
  for (j = 0; j < s.n; j++) { var Pc = M4.pt(M, X.cx[j], X.cy[j], W.colZ0[j]), zsS = (seaH(Pc[0], Pc[2], SIMT) - (M[1] * X.cx[j] + M[5] * X.cy[j] + M[13])) / M[9], uS = Math.min(s.cap[j], wrColUnits(W, X, j, zsS)), rj = W.colRoom[j]; vS[rj] += uS; if (u[j] > uS) vAb[rj] += u[j] - uS; else vDf[rj] += uS - u[j]; }
  for (r = 0; r < s.NR; r++) if (s.rl[r] > -1e8) { var q0 = W.roomCol0[r], Pr = M4.pt(M, X.cx[q0], X.cy[q0], W.colZ0[q0]); rlS[r] = s.rl[r] - seaH(Pr[0], Pr[2], SIMT); }
  function blue(base, f) { if (f <= 0) return base; f = 0.3 + 0.7 * f; return [base[0] * (1 - f) + 40 * f, base[1] * (1 - f) + 130 * f, base[2] * (1 - f) + 255 * f]; }
  function dim(r2) { var c = wrColor(r2); return [c[0] * 0.4, c[1] * 0.4, c[2] * 0.4]; }
  function fillC(r2) {
    if (r2 < 0) return [24, 24, 28];
    var f = cap[r2] ? wat[r2] / cap[r2] : 0; if (f <= 0) return [70, 70, 76]; if (f >= 0.999) return [230, 40, 40];
    return [40 + 200 * f, 200 + 20 * f, 220 - 180 * f];
  }
  var spill = s.spillAt || [], marks = function (g, side) {                // 標記：照格座標畫到圖上（side ⇒ (x, z)、否則 (x, y)）
    function at(x, b) { return [(x - W.x0) * px, side ? (NZ - b) * px : (b - W.ylo) * px]; }
    g.fillStyle = '#ff40ff'; for (var a = 0; a < spill.length; a += 4) { var P = at(spill[a] + 0.5, side ? spill[a + 2] + 0.5 : spill[a + 1] + 0.5); g.fillRect(P[0] - px, P[1] - px, 2 * px, 2 * px); }
    g.fillStyle = '#ffe040'; for (var b = 0; b < s.J.n; b++) { var P2 = at(s.J.p[3 * b], side ? s.J.p[3 * b + 2] : s.J.p[3 * b + 1]); g.fillRect(P2[0] - 1, P2[1] - 1, 3, 3); }
    g.strokeStyle = '#ff2020'; g.lineWidth = 2; s.br.forEach(function (bb) { if (bb.j < 0) return; var P3 = at(bb.x, side ? bb.z : bb.y); g.beginPath(); g.moveTo(P3[0] - 4, P3[1]); g.lineTo(P3[0] + 4, P3[1]); g.moveTo(P3[0], P3[1] - 4); g.lineTo(P3[0], P3[1] + 4); g.stroke(); });
  };
  var A = wrPaint(NX, NZ, px, function (x, yy) { var k2 = (NZ - 1 - yy) * NX + x, d = s.picDom[k2]; if (d < 0) return [24, 24, 28]; return blue(dim(d), sN[k2] ? sW[k2] / sN[k2] : 0); });
  marks(A.g, true);
  var B = wrPaint(NX, NZ, px, function (x, yy) { return fillC(s.picDom[(NZ - 1 - yy) * NX + x]); });
  marks(B.g, true);
  var Pv = wrPaint(NX, NZ, px, function (x, yy) {                        // 水壓圖：淺黃（剛淹過）→ 橘 → 深紅（≥ 2 m 水頭）；乾的 ⇒ 房間色調暗；水面高過海面的那一排 ⇒ 洋紅
    var k3 = (NZ - 1 - yy) * NX + x, d3 = s.picDom[k3]; if (d3 < 0) return [24, 24, 28];
    var hp = pH[k3]; if (hp < 0) return dim(d3); if (pUp[k3]) return [255, 64, 255];
    var f3 = Math.min(1, hp / 2); return [255 - 115 * f3, 235 - 215 * f3, 150 - 130 * f3];
  });
  marks(Pv.g, true);
  var Cv = wrPaint(NX, NY, px, function (x, yy) { var t2 = x * NY + yy; return tN[t2] ? blue([60, 60, 66], tW[t2] / tN[t2]) : [24, 24, 28]; });
  marks(Cv.g, false);
  var sp = {}; for (var a2 = 0; a2 < spill.length; a2 += 4) { var rr = wrRoomAt(W, spill[a2], spill[a2 + 1], spill[a2 + 2]); sp[rr] = (sp[rr] || 0) + spill[a2 + 3]; }
  var rooms = [], eq = [0, 0, 0, 0]; for (r = 0; r < s.NR; r++) if (wat[r] > 0 || sp[r]) { rooms.push([r, +(cap[r] / s.upm).toFixed(2), +(wat[r] / s.upm).toFixed(2), cap[r] ? +(wat[r] / cap[r]).toFixed(3) : 0, +((sp[r] || 0) / s.upm).toFixed(2), wat[r] > 0 ? +top[r].toFixed(3) : null, +(vS[r] / s.upm).toFixed(2), +(vAb[r] / s.upm).toFixed(2), +(vDf[r] / s.upm).toFixed(2), rlS[r] > -1e8 ? +rlS[r].toFixed(3) : null]); eq[0] += vS[r]; eq[1] += vAb[r]; eq[2] += vDf[r]; eq[3] += wat[r]; }   // 第 6–9 欄：照海面裝得下、高過海面的、比海面低還沒裝的（m³）、平均水面 − 海面（m）
  eq = eq.map(function (v) { return +(v / s.upm).toFixed(2); });            // 有水的房間合計：[照海面裝得下, 高過海面, 還沒裝, 裝了]
  rooms.sort(function (a3, b3) { return b3[2] - a3[2] || b3[4] - a3[4]; });
  var ops = [];                                                           // 這一段生粒子（em）、往上溢（up）最多的開口：[開口, 類型, 下／a 房, 上／b 房, 層, m², 面中心 x, y, em m³, up m³]
  if (s.emO) { var e0 = s.picEm || new Float64Array(s.NO), u0 = s.picUp || new Float64Array(s.NO);
    for (j = 0; j < s.NO; j++) { var de = s.emO[j] - e0[j], du = s.upO[j] - u0[j]; if (de > 0 || du > 0) ops.push([j, s.O.T[j] ? 'side' : 'deck', s.oa[j], s.ob[j], s.O.Z[j], +(s.O.N[j] * S * S).toFixed(2), s.O.X[j], s.O.Y[j], +(de / s.upm).toFixed(2), +(du / s.upm).toFixed(2)]); }
    ops.sort(function (a4, b4) { return (b4[8] + b4[9]) - (a4[8] + a4[9]); }); s.picEm = Float64Array.from(s.emO); s.picUp = Float64Array.from(s.upO);
    var m0 = s.picMv || new Float64Array(s.NO), mvs = []; for (j = 0; j < s.NO; j++) { var dm = s.mvO[j] - m0[j]; if (dm) mvs.push([j, s.O.T[j] ? 'side' : 'deck', s.oa[j], s.ob[j], s.O.Z[j], +(dm / s.upm).toFixed(2)]); }   // 這一段每個開口淨搬了多少 m³（＋ a → b）
    mvs.sort(function (a5, b5) { return Math.abs(b5[5]) - Math.abs(a5[5]); }); s.picMv = Float64Array.from(s.mvO); s.picMvs = mvs.slice(0, 64); }
  var out = { t: +SIMT.toFixed(1), eq: eq, ops: ops.slice(0, 16), mvs: s.picMvs || [], side: A.cv.toDataURL('image/png'), fill: B.cv.toDataURL('image/png'), press: Pv.cv.toDataURL('image/png'), top: Cv.cv.toDataURL('image/png'), rooms: rooms.slice(0, 24), nRooms: rooms.length, spillNo: sp[-1] ? +(sp[-1] / s.upm).toFixed(2) : 0, r: wrsRead(sh) };
  if (s.spillAt) s.spillAt.length = 0;                                   // 下一段重新記
  return out;
}

/** 門、艙蓋對到哪個開口（TASK-0808 驗收第 11 格；33_wrsim.js wrsInit 的 odoor／tops）：
 *  { n 幾扇門, ops: [{ door 第幾扇, name, cells 開口幾格, zt, op 開口, z 層, m2, a 下面那間, b 上面那間 }], tops: [{ door, name, room, m2 }]（沒對到開口 ⇒ 通到甲板上面）}。 */
function wsimDoors(sh) {
  var s = sh.wrs, O = s.O, D = sh.doors || [], ops = [], k;
  function nm(d) { var m = d && d.m; return m ? (m.ref || m.name || m.id || null) : null; }
  for (k = 0; k < s.NO; k++) if (s.odoor[k] >= 0) { var d = D[s.odoor[k]]; ops.push({ door: s.odoor[k], name: nm(d), cells: d ? d.cells.length / 2 : 0, zt: d ? d.zt : null, op: k, z: O.Z[k], m2: +(O.N[k] * S * S).toFixed(2), a: s.oa[k], b: s.ob[k] }); }
  return { n: D.length, ops: ops, tops: s.tops.map(function (t) { return { door: t.d, name: nm(D[t.d]), room: t.r, m2: +t.ar.toFixed(2) }; }) };
}
/** 釘住姿態（TASK-0806，?pin=1）：記下浮穩那一刻的位置與姿態，回一支「每一步之後照它還原、重算矩陣」的函式。
 *  ⇒ 水頭只由艙內水位決定（下沉、傾斜、浪的起伏都不動）；只在報表裡叫，⛔ 不碰 stepShip。 */
function flabPin(sh) {
  var K = ['px', 'pz', 'yaw', 'sink', 'sinkV', 'lift', 'wl', 'bob', 'rollA', 'rollV', 'pitchA', 'pitchW', 'rollW'], s0 = {};
  K.forEach(function (k) { s0[k] = sh[k]; });
  var f = function () { K.forEach(function (k) { sh[k] = s0[k]; }); sh.M = M4.mul(shipMatrix(sh), M4.ident()); sh.inv = M4.inv(sh.M); sh.center = shipCenter(sh); };
  f.s0 = s0; return f;                                                  // s0 給 flabEvents 中途改（pset）
}
/** 進水報表：每門砲的砲口與開口（見 floodLab 的 out.guns）。 */
function flabGuns(sh) {
  var T = sh.T; var PL = sh.ports === undefined ? portsBuild(sh) : sh.ports, lidG = PL ? PL.L.map(function (P) { return P.g; }) : []; return sh.guns.map(function (g) { var P = M4.pt(sh.M, g.muz[0], g.muz[1], g.muz[2]); var w = (sh.portW || []).filter(function (q) { return q.g === g; })[0], Pb = w ? M4.pt(sh.M, w.h.cells[0], T.cy + w.h.s * 1e-3, w.h.z0) : null; return [g.name, g.side, +(P[1] - seaH(P[0], P[2], SIMT)).toFixed(2), lidG.indexOf(g) >= 0 ? 1 : 0, g.alive ? 1 : 0, w ? w.h.n : 0, Pb ? +(Pb[1] - seaH(Pb[0], Pb[2], SIMT)).toFixed(2) : null, w && w.on ? 1 : 0]; });
}
/** 中途的事件（TASK-0808 驗收第 9、11 格；TASK-0822）：pset ＝ 打洞後 t 秒把釘住的那一格加 v（lift 公尺往上、rollA／pitchA 弧度；沒釘住 ⇒ 直接加在船上）、wkill ＝ 打洞後 t 秒打掉第幾扇門（m.alive ＝ false）、pbreak ＝ 打洞後 t 秒打掉那門砲的蓋板鉸鏈旁那一格船殼。每個只發生一次，記在 out.events。 */
function flabEvents(sh, pin, evs, t, out) {
  for (var q = evs.length - 1; q >= 0; q--) {
    var e = evs[q]; if (t < e.t) continue;
    if (e.k) { if (pin) pin.s0[e.k] += e.v; else sh[e.k] += e.v; out.events.push({ t: +t.toFixed(2), set: e.k, by: e.v, now: pin ? pin.s0[e.k] : sh[e.k] }); }
    else if (e.pb !== undefined) { var w = (sh.portW || []).filter(function (q) { return q.g.name === e.pb; })[0], f = w && w.P ? w.P.d.foot : -1; if (f >= 0) removeVoxel(sh, f & 2047, (f >> 11) & 1023, f >> 21, []); out.events.push({ t: +t.toFixed(2), pbreak: e.pb, lid: !!(w && w.P), foot: f }); }   // 打掉那片蓋板鉸鏈旁的那一格船殼（戰局的格；25_doors.js portsSurvey 下一次判斷就登記成進水口）
    else { var d = (sh.doors || [])[e.door]; if (d && d.m) d.m.alive = false; out.events.push({ t: +t.toFixed(2), kill: e.door, ok: !!(d && d.m) }); }
    evs.splice(q, 1);
  }
  if (pin) pin();
}

/** 參考解（TASK-0806，?ref=1；給 TASK-0808 房間圖同一個情境對拍）：
 *  · 水量 → 水位：艙內（flInHull）的空氣格照世界高度（格中心，1 cm 一階）由低往高加進 union-find；水位 h 時的水量 ＝ 落點那一格所在的那一塊有幾格 × S³。
 *    ⇒ 低於 h 才連得到的地方才算（門檻、甲板：水位過了才併進來，跟平衡時水能到的地方一樣）；落點 ＝ 破口裡面那一格往下（−z）走到底。
 *  · 進水：每塊破口照模擬自己的 Torricelli（33_flood.js flTick：FL_C × 面積 × √(2g × (max(海, 洞) − max(艙內, 洞))) × fk），1 ms 一步積分；不算抽水（要比就帶 pump=0）。
 *  · 破口照每一秒當時的面積（trA ＝ floodLab 的 traceA：[t, [[洞, m²], …]]；給了就用，TASK-0808 量過：破口開頭 1.11 m²、後來縮成 0.91 m²，照最後那一刻算 ⇒ 前段模擬看起來多 25%）；沒給 ⇒ 照報表最後那一刻的（flHoleInfo；釘住姿態 ⇒ 位置不會變）。⚠ 只比水量怎麼分配與步長，⛔ 不是「真的流體」：係數、面積都跟模擬同一份。
 *  回 { H 海面, holes 幾塊, A m², C 係數, Vmax 灌到海面的 m³, half: { t, ref, model, pct }, full: { ref, model }（水量到 Vmax 99% 那一刻，秒；沒到 ⇒ null）, back 模擬算回海裡的 m³, rows: [[t, 參考 m³, 模擬 m³]] }。 */
function flabRef(sh, trace, t0, trA) {
  var fl = sh.fl, F = fl.F, G3 = sh.grid, M = sh.M, hs = flHoleInfo(sh) || [], ia = 0;
  if (trA && trA.length) {                                              // 每一秒的面積：出現過的洞都列進來（位置照細檔），面積先放那一秒最大的（找落點用），積分時換成當時的
    var mx = {}; trA.forEach(function (row) { row[1].forEach(function (pa) { mx[pa[0]] = Math.max(mx[pa[0]] || 0, pa[1]); }); });
    hs = Object.keys(mx).map(Number).sort(function (a, b) { return a - b; }).map(function (h) { return { id: h, x: fl.hX[h], y: fl.hY[h], z: fl.hZ[h], area: mx[h] }; });
  }
  if (!hs.length || !trace.length) return { err: '沒有破口或沒有逐秒紀錄' };
  var C = FL_C * sh.cfg.flood / LIM.flood[2], wy = function (x, y, z) { return M[1] * x + M[5] * y + M[9] * z + M[13]; };
  var P = hs.map(function (h) { return M4.pt(M, h.x, h.y, h.z); }), H = seaH(P[0][0], P[0][2], SIMT), A = hs.reduce(function (s, h) { return s + h.area; }, 0);
  var big = hs.slice().sort(function (a, b) { return b.area - a.area; })[0], side = big.y < sh.T.cy ? 1 : -1;
  // 落點：最大那塊破口往艙內走到第一個空氣格，再往下走到底
  var lx = Math.floor(big.x), lz = Math.floor(big.z), ly = Math.floor(big.y);
  for (var t = 0; t < 40 && (G3.get(lx, ly, lz) || !flInHull(F, lx, ly, lz)); t++) ly += side;
  while (lz > 0 && flInHull(F, lx, ly, lz - 1) && !G3.get(lx, ly, lz - 1)) lz--;
  // 艙內、海面以下的空氣格 ⇒ 照世界高度分桶（1 cm）
  var NYv = F.NY * F.c, NXv = F.nxv, Z = F.zTop, n3 = NXv * NYv * Z, id = function (x, y, z) { return (z * NYv + (y - F.Y0)) * NXv + (x - F.X0); };
  var wmin = 1e9, cells = [], hv = [];
  for (var z = 0; z < Z; z++) for (var x = F.X0; x < F.X0 + NXv; x++) {
    var k = z * F.nxv + x - F.X0; if (F.yP[k] < 0) continue;
    for (var y = F.yM[k] + 1; y < F.yP[k]; y++) { if (G3.get(x, y, z)) continue; var w = wy(x + 0.5, y + 0.5, z + 0.5); if (w >= H) continue; cells.push(id(x, y, z)); hv.push(w); if (w < wmin) wmin = w; }
  }
  var nb = Math.ceil((H - wmin) / 0.01) + 1, cnt = new Int32Array(nb + 1), ord = new Int32Array(cells.length), i;
  for (i = 0; i < cells.length; i++) cnt[((hv[i] - wmin) / 0.01 | 0) + 1]++;
  for (i = 1; i <= nb; i++) cnt[i] += cnt[i - 1];
  for (i = 0; i < cells.length; i++) ord[cnt[(hv[i] - wmin) / 0.01 | 0]++] = i;
  var par = new Int32Array(n3).fill(-1), sz = new Int32Array(n3), Lid = id(lx, ly, lz), lvH = [], lvV = [], S3 = S * S * S, D = [1, -1, NXv, -NXv, NXv * NYv, -NXv * NYv];
  function find(a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }
  for (var qi = 0, b = 0; b < nb; b++) {
    var top = wmin + (b + 1) * 0.01;
    for (; qi < ord.length && hv[ord[qi]] < top; qi++) {
      var c0 = cells[ord[qi]], xi = c0 % NXv, yi = ((c0 / NXv) | 0) % NYv; par[c0] = c0; sz[c0] = 1;
      for (var d = 0; d < 6; d++) {
        if ((d === 0 && xi === NXv - 1) || (d === 1 && xi === 0) || (d === 2 && yi === NYv - 1) || (d === 3 && yi === 0)) continue;   // ⛔ 列尾不繞到下一列
        var c1 = c0 + D[d]; if (c1 < 0 || c1 >= n3 || par[c1] < 0) continue; var ra = find(c0), rb = find(c1); if (ra !== rb) { if (sz[ra] < sz[rb]) { var tt = ra; ra = rb; rb = tt; } par[rb] = ra; sz[ra] += sz[rb]; } }
    }
    if (par[Lid] >= 0) { lvH.push(Math.min(top, H)); lvV.push(sz[find(Lid)] * S3); }
  }
  if (!lvV.length) return { err: '落點不在海面以下的艙內', at: [lx, ly, lz] };
  var Vmax = lvV[lvV.length - 1];
  function lev(V) { if (V <= 0) return -1e9; var lo = 0, hi = lvV.length - 1; if (V >= lvV[hi]) return H; while (lo < hi) { var m = (lo + hi) >> 1; if (lvV[m] < V) lo = m + 1; else hi = m; } return lvH[lo]; }
  function q(V) { var h = lev(V), s = 0; for (var j = 0; j < hs.length; j++) { var p = P[j][1], dd = Math.max(H, p) - Math.max(h, p); if (dd > 0.001) s += C * hs[j].area * Math.sqrt(2 * G * dd); } return s; }
  // 積分（1 ms）、每一筆逐秒紀錄的時刻取樣
  // 「灌滿」照水量判：到 Vmax 的 99% 那一刻（⛔ 不照進水量：模擬的 inQ 讀數扣掉了進不去、算回海裡的 back ⇒ 水量還在漲時 inQ 已經是 0，量過 60 Hz 387 s）
  var V = 0, tt2 = t0, rows = [], q0 = null, fullRef = null, halfT = null, dt = 0.001;
  for (var r = 0; r < trace.length; r++) {
    var tEnd = trace[r][0];
    if (trA && trA.length) { while (ia + 1 < trA.length && trA[ia + 1][0] <= tEnd - 1 + 1e-6) ia++; var am = {}; trA[ia][1].forEach(function (pa) { am[pa[0]] = pa[1]; }); hs.forEach(function (hh) { hh.area = am[hh.id] || 0; }); }   // 這一秒的面積
    while (tt2 < tEnd - 1e-9) { var Q = q(V); if (q0 === null && Q > 0) q0 = Q; if (fullRef === null && V >= Vmax * 0.99) fullRef = tt2 - t0; if (halfT === null && V >= Vmax / 2) halfT = tt2; V = Math.min(Vmax, V + Q * dt); tt2 += dt; }
    rows.push([tEnd, +V.toFixed(2), trace[r][1]]);
  }
  var fullModel = null;
  for (r = 0; r < trace.length; r++) if (fullModel === null && trace[r][1] >= Vmax * 0.99) fullModel = +(trace[r][0] - t0).toFixed(1);
  var half = null;
  if (halfT !== null) {
    for (r = 1; r < trace.length && trace[r][0] < halfT; r++);
    if (r < trace.length) { var a0 = trace[r - 1], a1 = trace[r], f = (halfT - a0[0]) / Math.max(1e-9, a1[0] - a0[0]), vm = a0[1] + (a1[1] - a0[1]) * f; half = { t: +(halfT - t0).toFixed(1), ref: +(Vmax / 2).toFixed(1), model: +vm.toFixed(1), pct: +((vm / (Vmax / 2) - 1) * 100).toFixed(1) }; }
  }
  return { H: +H.toFixed(3), holes: hs.length, A: +A.toFixed(3), C: +C.toFixed(4), land: [lx, ly, lz], cells: cells.length, Vmax: +Vmax.toFixed(1), q0: q0 === null ? null : +q0.toFixed(3), half: half, full: { ref: fullRef === null ? null : +fullRef.toFixed(1), model: fullModel }, back: +(fl.back || 0).toFixed(1), rows: rows };
}

/** 艙內水面高出海面多少（TASK-0662；Tim 2026-10-16 殉爆後艙內的水停在海面以上不退）：每一格有水的水格，水面（照 flTick head 同一套：格底 ＋ 裝了幾成 × 格高，裝超過一成照算 ⇒ 擠出來的也看得到）減那一點正上方的海面（seaH，照浪）。
 *  回 { max 最高那格高出幾 m、at 那一格 [ix, iy, iz]、fill 那一格裝了幾成、n 高出 0.3 m 以上的格數、vol 高出海面的水 m³（每格只算海面以上那一截）、over 裝超過的格數、overV 裝超過的水 m³；room ⇒ 另外 roomBelow 海面以下還空著的 m³、roomWet 其中已經有水的格、nWetRoom 那幾格的格數 }。只讀。 */
function flabEx(sh, room) {
  var fl = sh.fl, F = fl.F, c = F.c, NX = F.NX, NXY = NX * F.NY, M = sh.M, Vc = Math.pow(c * S, 3), hc = c * S, r = { max: -99, at: null, fill: 0, n: 0, vol: 0, over: 0, overV: 0 };
  var h0 = M[1] * (F.X0 + 0.5 * c) + M[5] * (F.Y0 + 0.5 * c) + M[13], dhx = M[1] * c, dhy = M[5] * c, dhz = M[9] * c;
  for (var t = 0; t < fl.actN; t++) {
    var i = fl.act[t], A = fl.A[i], cp = fl.cap[i]; if (!(A > 1e-4) || !(cp > 0.02)) continue;
    var ix = i % NX, iy = ((i / NX) | 0) % F.NY, iz = (i / NXY) | 0, f = A / (cp * Vc), hb = h0 + ix * dhx + iy * dhy + iz * dhz, h = hb + f * hc;
    var P = M4.pt(M, F.X0 + (ix + 0.5) * c, F.Y0 + (iy + 0.5) * c, iz * c), sea = seaH(P[0], P[2], SIMT), e = h - sea;
    if (f > 1.001) { r.over++; r.overV += A - cp * Vc; }
    if (e > r.max) { r.max = e; r.at = [ix, iy, iz]; r.fill = f; }
    if (e > 0.3) r.n++;
    if (e > 0) r.vol += A * Math.min(1, e / Math.max(1e-6, f * hc));
  }
  if (room) {                                                           // 海面以下還空著多少（每一格裝到海面那一點的高度為止）、其中已經有水的那幾格
    var rb = 0, rbW = 0, nw = 0;
    for (var i2 = 0; i2 < F.N; i2++) { var cp2 = fl.cap[i2]; if (!(cp2 > 0.02)) continue; var jx = i2 % NX, jy = ((i2 / NX) | 0) % F.NY, jz = (i2 / NXY) | 0, P2 = M4.pt(M, F.X0 + (jx + 0.5) * c, F.Y0 + (jy + 0.5) * c, jz * c), f2 = clamp((seaH(P2[0], P2[2], SIMT) - P2[1]) / hc, 0, 1), rr2 = f2 * cp2 * Vc - fl.A[i2]; if (rr2 <= 0) continue; rb += rr2; if (fl.A[i2] > 1e-4) { rbW += rr2; nw++; } }
    r.roomBelow = +rb.toFixed(0); r.roomWet = +rbW.toFixed(0); r.nWetRoom = nw;
  }
  r.max = +r.max.toFixed(2); r.fill = +r.fill.toFixed(2); r.vol = +r.vol.toFixed(1); r.overV = +r.overV.toFixed(1);
  return r;
}

/** 換個鏡頭再拍一張（__game.floodView；找報表的固定角度用）：o ＝ { yaw, pitch, dist, ty, cut: 'half'|'none', deck, xray, w }，沒給的照現在的。回 data URL。 */
function floodView(o) {
  o = o || {};
  if (o.ty !== undefined && SHIPS[0]) { var cc = shipCenter(SHIPS[0]); camSet({ tgt: [cc[0], cc[1] + o.ty, cc[2]], trYaw: null, trMe: null }); }
  if (o.at && SHIPS[0]) camSet({ tgt: M4.pt(SHIPS[0].M, o.at[0], o.at[1], o.at[2]), trYaw: null, trMe: null });   // 對準船上一點（格座標；TASK-0811 拉近看細波）
  var cs = { follow: null, mode: 0 }; ['yaw', 'pitch', 'dist'].forEach(function (k) { if (o[k] !== undefined) cs[k] = o[k]; }); camSet(cs);
  if (o.cut !== undefined) CUTV.half = o.cut === 'half'; if (o.deck !== undefined) CUTV.deck = o.deck | 0; if (o.xray !== undefined) FLX3 = !!o.xray;
  var snap0 = FL_SNAP; FL_SNAP = true; camSet({ snap: true }); camUpdate(1); render(); FL_SNAP = snap0;
  return flabShot(o.w || 480);
}

/** 網址 ?lab=flood 的參數 ⇒ floodLab 的 o。 */
function flLabOpts() {
  var o = {};
  if (Q.has('boom')) o.boom = Q.get('boom').split(',').filter(function (w) { return w !== ''; }).map(Number);   // 殉爆開局：boom=0（後彈藥庫）、1（前）、0,1；有給 boom 又沒給 holes ⇒ 不另外打洞
  if (Q.has('holes')) o.holesSet = true;
  if (Q.has('holes')) o.holes = Q.get('holes').split(';').filter(function (w) { return w; }).map(function (w) { return w.split(':').map(Number); });
  ['dur', 'every', 'deck', 'w'].forEach(function (k) { if (Q.has(k)) o[k] = +Q.get(k); });
  [['fyaw', 'yaw'], ['fpitch', 'pitch'], ['fdist', 'dist'], ['fty', 'ty']].forEach(function (kk) { if (Q.has(kk[0])) o[kk[1]] = +Q.get(kk[0]); });
  if (Q.has('cut')) o.cut = Q.get('cut');
  if (Q.has('focus')) { o.focus = Q.get('focus'); var fm = /^cell:(\d+):(\d+)$/.exec(o.focus); if (fm) { o.focus = 'step'; o.focusCell = [+fm[1], +fm[2]]; } }
  if (Q.get('xray') === '1') o.xray = true;
  if (Q.get('flat') === '1') o.flat = true;
  if (Q.has('hz')) o.hz = +Q.get('hz');                                 // TASK-0806：模擬步長、釘住姿態、不抽水、參考解
  if (Q.get('pin') === '1') o.pin = true;
  if (Q.get('pump') === '0') o.pump = 0;
  if (Q.get('ref') === '1') o.ref = true;
  if (Q.has('rooms')) o.rooms = Q.get('rooms') === '1';                 // TASK-0811：照房間畫水面（0 ＝ 水格的，兩張並排比）、橫傾幾度
  if (Q.has('roll')) o.roll = +Q.get('roll');
  if (Q.get('wsim') === '1') o.wsim = true;
  ['wpic', 'wpx'].forEach(function (k) { if (Q.has(k)) o[k] = +Q.get(k); });   // 房間模擬的過程圖：每幾秒一組、一格幾像素（wsimPic）
  if (Q.has('pset')) o.pset = Q.get('pset').split(';').filter(function (w) { return w; }).map(function (w) { var a = w.split(':'); return [+a[0], a[1], +a[2]]; });   // 中途改姿態：<秒>:<lift|rollA|pitchA>:<加多少>;…（flabEvents）
  if (Q.has('pbreak')) o.pbreak = Q.get('pbreak').split(';').filter(function (w) { return w; }).map(function (w) { var a = w.split(':'); return [+a[0], a[1]]; });   // 中途打壞砲門蓋板：<秒>:<砲的名字>;…（TASK-0822）
  if (Q.has('wkill')) o.wkill = Q.get('wkill').split(';').filter(function (w) { return w; }).map(function (w) { var a = w.split(':'); return [+a[0], +a[1]]; });   // 中途打掉門：<秒>:<第幾扇>;…
  if (Q.has('wsimo')) o.wsimo = Q.get('wsimo').split(',').filter(function (w) { return w; });   // 反向對照的開關（33_wrsim.js：nocfl、noclamp、nodda、level）                              // TASK-0808：房間模擬並排跑
  return o;
}

// ── 水的房間的報表（TASK-0807；Tim 2026-10-22「可以額外加上debug資訊輸出排查（寫檔 也可以圖片化輸出模擬結果）」）──
// ?lab=wrooms（＋ ship=<船>、cache=0 量現算；dz ＝ 每幾層一張俯視圖（預設 6）、px ＝ 一格幾像素（預設 2））⇒ 頁面上 id ＝ lab 的 pre：
//   讀數（33_wrooms.js wrInfo）、艙房對照（wrCabins）、圖 —— 側視（每個 (x, z) 那一列最多的那一間）、俯視（每 dz 層一張：每一格照房間上色；
//   旁邊的接口（同一層相鄰兩格不同間）紅、上下的接口（這一格跟正上方那一格不同間）黃、作者標的艙房白框）。顏色照房間編號（同一間同色，⛔ 不代表大小）。
// src/tests/wrooms_lab.py 用無頭 Chrome 讀、寫成 reports/wrooms/<tag>/（JSON、PNG、index.html；不入版控）。?debug=1 時 __game.wroomsLab(o) 同一套。
// ⛔ 只在 ?lab=wrooms 或 __game.wroomsLab 才跑。
function wrColor(r) {
  if (r < 0) return [40, 40, 44];
  var h = (r * 0.6180339887) % 1 * 6, s = 0.6, l = r % 3 ? 0.5 : 0.62, c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(h % 2 - 1)), m = l - c / 2, p = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h) % 6];
  return [Math.round((p[0] + m) * 255), Math.round((p[1] + m) * 255), Math.round((p[2] + m) * 255)];
}
/** 那一層的房間圖（nxv × ny，−1 ＝ 不是艙內的空氣）。 */
function wrLayerLab(W, z, out) {
  out.fill(-1); if (z < 0 || z >= W.zTop) return out;
  for (var xi = 0; xi < W.nxv; xi++) { var k = z * W.nxv + xi; for (var i = W.rowS[k]; i < W.rowS[k + 1]; i++) { var r = W.regRoom[W.runReg[i]]; for (var y = W.ry0[i]; y <= W.ry1[i]; y++) out[xi * W.ny + y - W.ylo] = r; } }
  return out;
}
function wrPaint(w, h, px, f) {                                            // f(x, y) ⇒ [r, g, b]；每一格畫成 px × px
  var cv2 = document.createElement('canvas'); cv2.width = w * px; cv2.height = h * px;
  var g = cv2.getContext('2d'), im = g.createImageData(cv2.width, cv2.height), D = im.data;
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var c = f(x, y); for (var dy = 0; dy < px; dy++) for (var dx = 0; dx < px; dx++) { var o = ((y * px + dy) * cv2.width + x * px + dx) * 4; D[o] = c[0]; D[o + 1] = c[1]; D[o + 2] = c[2]; D[o + 3] = 255; } }
  g.putImageData(im, 0, 0); return { cv: cv2, g: g };
}
/** 俯視：第 z 層（x 往右、y 往下）。 */
function wrSlice(T, z, px, cabins) {
  var W = T.wrm, A = wrLayerLab(W, z, new Int32Array(W.nxv * W.ny)), U = wrLayerLab(W, z + 1, new Int32Array(W.nxv * W.ny)), NY = W.ny;
  var P = wrPaint(W.nxv, NY, px, function (xi, yi) {
    var i = xi * NY + yi, r = A[i]; if (r < 0) return [40, 40, 44];
    if ((xi < W.nxv - 1 && A[i + NY] >= 0 && A[i + NY] !== r) || (yi < NY - 1 && A[i + 1] >= 0 && A[i + 1] !== r)) return [235, 40, 40];   // 旁邊的接口
    if (U[i] >= 0 && U[i] !== r) return [245, 210, 40];                  // 上下的接口（正上方是別間）
    return wrColor(r);
  });
  P.g.strokeStyle = '#fff'; P.g.lineWidth = 1;
  (cabins || []).forEach(function (R) { if (z < R.min[2] || z > R.max[2]) return; P.g.strokeRect((R.min[0] - W.x0) * px + 0.5, (R.min[1] - W.ylo) * px + 0.5, (R.max[0] - R.min[0] + 1) * px - 1, (R.max[1] - R.min[1] + 1) * px - 1); });
  return P.cv.toDataURL('image/png');
}
/** 側視：x 往右、z 往上；每個 (x, z) 那一列最多的那一間。 */
function wrSide(T, px) {
  var W = T.wrm, best = new Int32Array(W.nxv * W.zTop).fill(-1);
  for (var z = 0; z < W.zTop; z++) for (var xi = 0; xi < W.nxv; xi++) {
    var k = z * W.nxv + xi, by = {}, bn = 0;
    for (var i = W.rowS[k]; i < W.rowS[k + 1]; i++) { var r = W.regRoom[W.runReg[i]]; by[r] = (by[r] || 0) + W.ry1[i] - W.ry0[i] + 1; if (by[r] > bn) { bn = by[r]; best[k] = r; } }
  }
  return wrPaint(W.nxv, W.zTop, px, function (xi, yy) { return wrColor(best[(W.zTop - 1 - yy) * W.nxv + xi]); }).cv.toDataURL('image/png');
}
/** 整份：o ＝ { dz, px }。 */
function wroomsLab(T, o) {
  o = Object.assign({ dz: 6, px: 2 }, o || {});
  var W = T && T.wrm; if (!W) return { err: '這艘沒有水的房間（T.wrm）' };
  var cab = hullRooms(T), out = { id: T.id, name: T.name, info: wrInfo(T), cabins: wrCabins(T), o: o, side: wrSide(T, o.px), slices: [] };
  for (var z = 0; z < W.zTop; z += o.dz) out.slices.push({ z: z, img: wrSlice(T, z, o.px, cab) });
  return out;
}

// ── 高度場在 0.1 秒一步穩不穩（TASK-0808 驗收第 2 格：不切小步、深水 ⇒ 量得到發散；照 CFL 切 ⇒ 不發散）──
// ?lab=wslosh（＋ ship=、hz=（預設 10 ⇒ 0.1 秒一步）、room ＝ 哪一間（預設：最大的那一間；−2 ⇒ 沒有上下兩段合併欄、最大的那一間）、depth ＝ 水深（公尺，從那一間最低的地板算；預設 2）、
//   slope ＝ 初始水面沿船長方向的斜度（船頭比平均高幾公尺、船尾低幾公尺；預設 0.3）、dur（秒，預設 60））⇒ #lab：
//   浮穩、釘住姿態（不再走物理）、不打洞、開口全關（封閉的水池）；那一間照斜的水面裝水，只走房間模擬（沒有破口），照 CFL 切小步與 nocfl（一步一小步）各跑一次。
//   每 0.5 秒一筆 [t, 水面對平均的 RMS m, 最高 − 平均 m, 平均 − 最低 m, 相鄰兩欄水面差最大 m, 這間的水 m³, 乾的欄, 全船的水 − 開局（單位，守恆 ⇒ 0）, 管子流量總和 m³/s, 流向跟上一筆相反的管子數, 其中接到上下兩段合併欄的：流量、翻向, 每一種管子 [條數, 流量, 翻向] × 兩段欄／收的滿了／地板落差／乾濕邊緣／普通]（那一間有水、沒滿的欄）。
function wsloshLab(o) {
  o = Object.assign({ hz: 10, depth: 2, slope: 0.3, dur: 60, room: -1 }, o || {});
  flowMode('sandbox'); reset(); AUTOFIRE = false; flowRun(false);
  var DT0 = DT; DT = DT_BASE = 1 / o.hz;
  var sh = SHIPS[0], i, W = sh.T.wrm;
  SHIPS.forEach(function (s2) { s2.sailSet = 0; s2.power = 0; s2.manual = true; s2.rudder = 0; });
  if (SHIPS[1]) { SHIPS[1].px += 3000; SHIPS[1].pz += 3000; }
  for (i = 0; i < Math.round(LAB_SETTLE / DT); i++) simStep();
  sh.M = shipMatrix(sh); sh.inv = M4.inv(sh.M);
  var out = { hull: sh.T.id, hz: o.hz, depth: o.depth, slope: o.slope, dur: o.dur, runs: {} };
  if (!W) { DT = DT_BASE = DT0; out.err = '沒有烘焙好的房間'; return out; }
  var X = wrxOf(sh.T), M = sh.M, r = o.room;
  function gapCol(g) { for (var l = 0, seen = 0, hole = 0; l < W.colNZ[g]; l++) { var c0 = W.cnt[W.colOff[g] + l]; if (c0 && hole) return 1; if (c0) seen = 1; else if (seen) hole = 1; } return 0; }
  if (r === -2) for (var r1 = 0, bv1 = -1; r1 < W.roomVox.length; r1++) { var ok1 = true; for (var g1 = W.roomCol0[r1]; g1 < W.roomCol0[r1 + 1] && ok1; g1++) if (gapCol(g1)) ok1 = false; if (ok1 && W.roomVox[r1] > bv1) { bv1 = W.roomVox[r1]; r = r1; } }   // room=-2 ⇒ 沒有上下兩段合併欄、最大的那一間（對照：普通的房間靜不靜得下來）
  if (r < 0) for (var r0 = 0, bv = -1; r0 < W.roomVox.length; r0++) if (W.roomVox[r0] > bv) { bv = W.roomVox[r0]; r = r0; }
  out.room = r; out.m3 = +(W.roomVox[r] * S * S * S).toFixed(1);
  ['cfl', 'nocfl'].forEach(function (mode) {
    var s = sh.wrs = wrsInit(sh), q, x0 = Infinity, x1 = -Infinity, fz = Infinity, cz = -Infinity, U0 = 0;
    if (mode === 'nocfl') s.opt.nocfl = true; (o.wsimo || []).forEach(function (k) { s.opt[k] = true; }); s.opt.onlyOp = -1;   // 開口全關 ⇒ 封閉的水池（⛔ 開著 ⇒ 水從開口流走，流量、水面不平都是排水，不是晃動）
    var Ws = s.W, Xs = s.X;                                              // 模擬的段（33_wrsim.js wrsSegs）
    for (q = Ws.roomCol0[r]; q < Ws.roomCol0[r + 1]; q++) {
      x0 = Math.min(x0, Xs.cx[q]); x1 = Math.max(x1, Xs.cx[q]);
      var bq = M[1] * Xs.cx[q] + M[5] * Xs.cy[q] + M[13]; fz = Math.min(fz, bq + M[9] * s.zf[q]); cz = Math.max(cz, bq + M[9] * (Ws.colZ0[q] + Ws.colNZ[q]));
    }
    var xm = (x0 + x1) / 2, hx = Math.max(1, (x1 - x0) / 2);
    for (q = Ws.roomCol0[r]; q < Ws.roomCol0[r + 1]; q++) {
      var hT = fz + o.depth + o.slope * (Xs.cx[q] - xm) / hx, base = M[1] * Xs.cx[q] + M[5] * Xs.cy[q] + M[13];
      s.su[q] = Math.max(0, Math.min(s.cap[q], Math.floor(wrColUnits(Ws, Xs, q, (hT - base) / M[9]))));
    }
    wrsAgg(s);
    for (q = 0; q < s.n; q++) U0 += s.su[q];
    var rows = [], every = Math.max(1, Math.round(0.5 / DT)), subMax = 0;
    for (var t = 0; t <= Math.round(o.dur / DT); t++) {
      if (t % every === 0) rows.push(wsloshRead(s, M, r, t * DT, U0));
      wrsStep(sh, DT, null); subMax = Math.max(subMax, s.sub);
    }
    out.floor = +fz.toFixed(2); out.ceil = +cz.toFixed(2); out.lenM = +((x1 - x0) * S).toFixed(1);
    for (var np = 0, ng = 0, ncg = 0, e3 = 0; e3 < s.E.n; e3++) if (Ws.colRoom[s.E.a[e3]] === r) { np++; if (s.gp[s.E.a[e3]] || s.gp[s.E.b[e3]]) ng++; }   // 基準：這間的管子幾條、其中接到拆過的兩段欄的幾條
    for (q = W.roomCol0[r]; q < W.roomCol0[r + 1]; q++) if (s.G.gp[q]) ncg++;
    out.runs[mode] = { sub: subMax, rows: rows, pipes: np, gapPipes: ng, cols: W.roomCol0[r + 1] - W.roomCol0[r], segs: Ws.roomCol0[r + 1] - Ws.roomCol0[r], gapCols: ncg };
  });
  sh.wrs = null; DT = DT_BASE = DT0;
  return out;
}
function wsloshRead(s, M, r, t, U0) {
  wrsSurf(s, M);
  var W = s.W, u = s.su, E = s.E, n = 0, sm = 0, q, mx = -Infinity, mn = Infinity, dry = 0, U = s.Jtot, vr = 0, dmax = 0, e;
  for (q = 0; q < s.n; q++) U += u[q];
  for (q = W.roomCol0[r]; q < W.roomCol0[r + 1]; q++) { vr += u[q]; if (!u[q]) { dry++; continue; } if (u[q] >= s.cap[q]) continue; n++; sm += s.hw[q]; mx = Math.max(mx, s.hw[q]); mn = Math.min(mn, s.hw[q]); }
  var mean = n ? sm / n : 0, v2 = 0;
  for (q = W.roomCol0[r]; q < W.roomCol0[r + 1]; q++) if (u[q] && u[q] < s.cap[q]) v2 += (s.hw[q] - mean) * (s.hw[q] - mean);
  var fs = 0, fo = 0, fg = 0, fgv = 0, pf = s.pf, cat = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];   // 管子的流量總和（m³/s；靜下來 ⇒ 0）、跟上一筆比流向翻過來的管子數；每一種管子 [條數, 流量, 翻向] × 拆過的兩段欄／收的那一段滿了／地板有落差（> 5 cm）／乾濕邊緣（一邊不到 2 cm）／普通（先中先算）
  for (e = 0; e < E.n; e++) {
    var a = E.a[e], b = E.b[e]; if (W.colRoom[a] !== r) continue;
    var f = E.f[e], fl = pf && pf[e] * f < 0, c4, da = (s.zs[a] - s.zf[a]) * S, db = (s.zs[b] - s.zf[b]) * S;
    if (u[a] && u[b] && u[a] < s.cap[a] && u[b] < s.cap[b]) dmax = Math.max(dmax, Math.abs(s.hw[a] - s.hw[b]));
    fs += Math.abs(f); if (fl) fo++; if (s.gp[a] || s.gp[b]) { fgv += Math.abs(f); if (fl) fg++; }
    if (s.gp[a] || s.gp[b]) c4 = 0; else if (u[a] >= s.cap[a] || u[b] >= s.cap[b]) c4 = 1; else if (Math.abs(s.zf[a] - s.zf[b]) * S > 0.05) c4 = 2; else if (Math.min(u[a] ? da : 0, u[b] ? db : 0) < 0.02) c4 = 3; else c4 = 4;
    cat[c4 * 3]++; cat[c4 * 3 + 1] += Math.abs(f); if (fl) cat[c4 * 3 + 2]++;
  }
  s.pf = Float64Array.from(E.f);
  return [+t.toFixed(1), n ? +Math.sqrt(v2 / n).toFixed(4) : 0, n ? +(mx - mean).toFixed(3) : 0, n ? +(mean - mn).toFixed(3) : 0, +dmax.toFixed(3), +(vr / s.upm).toFixed(2), dry, U - U0, +fs.toFixed(3), fo, +fgv.toFixed(3), fg, cat.map(function (v, i) { return i % 3 === 1 ? +v.toFixed(2) : v; })];
}

// ── 夾到拉平 ⇒ 不來回穿越（TASK-0808 驗收第 8 格；教科書式的單獨對照：在船上跑全部的開口，別的開口、破口、房間內的管子也在動兩邊的水位，「下一小步反過來」不全是這個開口衝過頭）──
// ?lab=wpair（＋ ship=、hz=（預設 10）、op ＝ 哪一個開口（拆過的，預設：兩間都至少 30 m³、面積最大的旁邊開口）、ha ／ hb ＝ 兩間的水面比開口底高幾公尺（預設 0.8 ／ 0.2）、dur（秒，預設 30））⇒ #lab：
//   浮穩、釘住姿態、不打洞；只開這一個開口（33_wrsim.js opt.onlyOp），兩間照水平的水面裝水，夾（預設）與 noclamp 各跑一次。
//   每 0.5 秒一筆 [t, a 的平均水面 − 開口底, b 的, a − b（m）, 真的穿越（下一小步兩邊反過來、差 > 1 cm）, 流向翻過來]；sum ＝ 最後的穿越、翻向次數。
function wpairLab(o) {
  o = Object.assign({ hz: 10, op: -1, ha: 0.8, hb: 0.2, dur: 30 }, o || {});
  flowMode('sandbox'); reset(); AUTOFIRE = false; flowRun(false);
  var DT0 = DT; DT = DT_BASE = 1 / o.hz;
  var sh = SHIPS[0], i, W = sh.T.wrm;
  SHIPS.forEach(function (s2) { s2.sailSet = 0; s2.power = 0; s2.manual = true; s2.rudder = 0; });
  if (SHIPS[1]) { SHIPS[1].px += 3000; SHIPS[1].pz += 3000; }
  for (i = 0; i < Math.round(LAB_SETTLE / DT); i++) simStep();
  sh.M = shipMatrix(sh); sh.inv = M4.inv(sh.M);
  var out = { hull: sh.T.id, hz: o.hz, ha: o.ha, hb: o.hb, dur: o.dur, runs: {} };
  if (!W) { DT = DT_BASE = DT0; out.err = '沒有烘焙好的房間'; return out; }
  var O = wrsOpenings(sh.T), X = wrxOf(sh.T), M = sh.M, oi = o.op;
  if (oi < 0) for (var q0 = 0, bn = 0; q0 < O.n; q0++) if (O.T[q0] && O.N[q0] > bn && Math.min(W.roomVox[O.A[q0]], W.roomVox[O.B[q0]]) * S * S * S >= 30) { bn = O.N[q0]; oi = q0; }   // 兩間都至少 30 m³（⛔ 小間一下就灌滿 ⇒ 水壓改照整間滿的規則，量的就不是這個開口）
  var ra = O.A[oi], rb = O.B[oi], wb = M[1] * O.X[oi] + M[5] * O.Y[oi] + M[9] * O.Z[oi] + M[13];
  out.op = oi; out.a = ra; out.b = rb; out.z = O.Z[oi]; out.m2 = +(O.N[oi] * S * S).toFixed(2); out.aM3 = +(W.roomVox[ra] * S * S * S).toFixed(1); out.bM3 = +(W.roomVox[rb] * S * S * S).toFixed(1);
  ['clamp', 'noclamp'].forEach(function (mode) {
    var s = sh.wrs = wrsInit(sh), q; s.opt.onlyOp = oi; if (mode === 'noclamp') s.opt.noclamp = true;
    [[ra, o.ha], [rb, o.hb]].forEach(function (rh) {
      for (q = s.W.roomCol0[rh[0]]; q < s.W.roomCol0[rh[0] + 1]; q++) { var base = M[1] * s.X.cx[q] + M[5] * s.X.cy[q] + M[13]; s.su[q] = Math.max(0, Math.min(s.cap[q], Math.floor(wrColUnits(s.W, s.X, q, (wb + rh[1] - base) / M[9])))); }   // 模擬的段（wrsSegs）
    });
    wrsAgg(s);
    var rows = [], every = Math.max(1, Math.round(0.5 / DT));
    for (var t = 0; t <= Math.round(o.dur / DT); t++) {
      if (t % every === 0) { wrsSurf(s, M); var la = s.rl[ra] - wb, lb = s.rl[rb] - wb; rows.push([+(t * DT).toFixed(1), +la.toFixed(4), +lb.toFixed(4), +(la - lb).toFixed(4), s.xoO[oi], s.crO[oi]]); }
      wrsStep(sh, DT, null);
    }
    out.runs[mode] = { rows: rows, xover: s.xoO[oi], cross: s.crO[oi], sub: s.sub };
  });
  sh.wrs = null; DT = DT_BASE = DT0;
  return out;
}

// ── 粒子不穿甲板（TASK-0808 驗收第 4 條；Tim 2026-10-22「房間之間的洞用粒子模擬流動（且會根據重力往下流）」）──
// ?lab=wdrop（＋ ship=、hz=（預設 10 ⇒ 0.1 秒一步）、k ＝ 幾個艙口（預設 8，照面積大的先）、per ＝ 每個放幾顆（預設 12））⇒ #lab：
//   浮穩、釘住姿態；每個上下的開口（艙口、甲板破洞；拆過的，33_wrsim.js wrsOpenings）從開口正上方 4 格放粒子（靜止起落、每顆 1 公升），只走粒子（33_wrsim.js opt.jetsOnly）到全部落地。
//   每顆的正確答案：從放的那一格一格一格往下找、碰到實心的格 ⇒ 上面那一格那一間（跟模擬分開算）。DDA（一格一格走）、nodda（只看終點那一格）各跑一次 ⇒ 落進對的那一間幾成。
function wdropLab(o) {
  o = Object.assign({ hz: 10, k: 8, per: 12 }, o || {});
  flowMode('sandbox'); reset(); AUTOFIRE = false; flowRun(false);
  var DT0 = DT; DT = DT_BASE = 1 / o.hz;
  var sh = SHIPS[0], i, W = sh.T.wrm;
  SHIPS.forEach(function (s2) { s2.sailSet = 0; s2.power = 0; s2.manual = true; s2.rudder = 0; });
  if (SHIPS[1]) { SHIPS[1].px += 3000; SHIPS[1].pz += 3000; }
  for (i = 0; i < Math.round(LAB_SETTLE / DT); i++) simStep();
  sh.M = shipMatrix(sh); sh.inv = M4.inv(sh.M);
  var out = { hull: sh.T.id, hz: o.hz, rows: [], sum: {} };
  if (!W) { DT = DT_BASE = DT0; out.err = '沒有烘焙好的房間'; return out; }
  var O = wrsOpenings(sh.T), cand = []; for (i = 0; i < O.n; i++) if (!O.T[i]) cand.push(i);   // 拆過的開口（33_wrsim.js wrsOpenings；⛔ 烘焙接口的重心可能在梁上）
  cand.sort(function (a, b) { return O.N[b] - O.N[a] || a - b; });
  ['dda', 'nodda'].forEach(function (mode) {
    var ok = 0, all = 0;
    cand.slice(0, o.k).forEach(function (oi) {
      var s = sh.wrs = wrsInit(sh); s.opt.jetsOnly = true; if (mode === 'nodda') s.opt.nodda = true; s.landLog = [];
      var truth = [], z0 = O.Z[oi] + 5;
      for (var p = 0; p < o.per; p++) {
        var x = O.X[oi] + ((p % 4) - 1.5) * 0.6, y = O.Y[oi] + (((p / 4) | 0) - 1) * 0.6, X = Math.floor(x), Y = Math.floor(y), z = z0;
        while (z > 0 && !sh.grid.get(X, Y, z - 1)) z--;                    // 正確答案：一格一格往下，碰到實心 ⇒ 上面那一格
        truth.push(wrRoomAt(W, X, Y, z));
        wrsEmit(s, x, y, z0 + 0.5, 0, 0, 0, WR_U, -(p + 2));                // 負的 src ⇒ 不放回（只看落點）；tag ＝ −(p + 2)
      }
      for (var t = 0; t < 10 / DT && s.J.n; t++) wrsStep(sh, DT, null);
      var row = { op: oi, m2: +(O.N[oi] * S * S).toFixed(2), z: O.Z[oi], lower: s.oa[oi], upper: s.ob[oi], mode: mode, ok: 0, wrong: [] };
      for (var q = 0; q < s.landLog.length; q += 2) { var tg = -s.landLog[q] - 2, rr = s.landLog[q + 1]; if (rr === truth[tg]) row.ok++; else row.wrong.push([truth[tg], rr]); }
      row.n = s.landLog.length / 2; ok += row.ok; all += row.n; out.rows.push(row);
    });
    out.sum[mode] = { ok: ok, all: all, pct: all ? +(ok / all * 100).toFixed(1) : null };
  });
  sh.wrs = null; DT = DT_BASE = DT0;
  return out;
}
