// ───────────────────────── 艙內的水：照房間畫（TASK-0811；TASK-0804 的畫面那一半） ─────────────────────────
// Tim 2026-10-22：「我希望至少水面要是平滑的（不能碎裂）」「顯示上 模擬房間表面的水傾斜跟波動」；同一天「完成後繼續進水相關的部分吧（畫面渲染）」⇒ 先做畫面、模擬（TASK-0808）後接。
// 做法：
//   · 一間房（33_wrooms.js 烘焙）一片水：每一欄（WR_C × WR_C 格）一塊，四個角 ＝ 同一間房、這一角周圍有水面的欄的世界高度平均 ⇒ 角兩邊共用、一定接得起來；
//     房間跟房間之間的高低差只出在牆上（兩間各畫各的、不互相平均）。
//   · 同一把尺：每一欄的水面照 33_wrwater.js wrColZ（模擬照用）換成高度；⛔ 不照水格「裝了幾成 × 格高」。
//   · 跟地球水平、跟著船走：每間房在船上一個錨點（那一間的水平中心，wrwAnchors），頂點帶「離那一間平均水面多高」d；頂點著色器每一格畫面照船現在的姿態（uModel）
//     算通過錨點、跟地球水平的那個平面再加 d ⇒ 船起伏、晃的時候水跟著船走、水面照樣是平的，不用重做網格；
//     （⛔ 2026-10-22 以前頂點帶世界高度 ⇒ 船上下、繞中心晃的時候水停在上一次重做的世界高度、看起來飄；暫停之後照真實時間內插補回去、看起來還在動 —— Tim 回報）
//     z 夾在那一欄的上下界以內（兩次重做之間船晃太多也不會穿出甲板）。
//   · 靠牆、船殼、地板的那幾欄：每一格（0.1 m）看水面那一點落在哪一間 —— 是這一間的空氣才畫那一格（⛔ 整欄畫一塊 ⇒ 伸進牆裡、船殼外、高出地板）。整欄都是 ⇒ 2 × 2 片就夠。
//   · 重做：每 WRW_MS 一次（跟水格的 FL_MESH_MS 一樣），兩次之間照角的高度內插（角的鍵：哪一間 × 哪一角）。進水報表截圖時（FL_SNAP）每次都重做。
// 水從哪來（只給畫面，⛔ 不改戰局、不讀亂數）：
//   TASK-0808 之前 ⇒ 照現在的水格（33_flood.js sh.fl）分到房間（wrwBridge：每一格水從格底往上一層一層裝，那一層的空氣在哪幾間就照格數分過去），再每間拉平（33_wrwater.js wrLevelRoom）。
//   TASK-0808 之後 ⇒ 直接讀房間模擬的每欄水量（同一把尺）。
// 開關：畫質「艙內水面的畫法」（07_gfx.js GFX.proom；網址 ?g_proom=0／1）；進水報表 rooms=0／1。
var WRW_MS = 500, WRW_G = 2;
// 頂點（WRW_ST 個 float）：aP ＝ (x, y, d ＝ 離那一間平均水面多高（這次重做的，m）, 水邊值)、aH0 ＝ 上一次重做時這一點畫面上的 d、aR ＝ 這一欄的 z 上下界（格座標）、
//   aC ＝ (錨點 x, y（格座標）, 錨點那一點平均水面的船上 z：起點（上一次畫面上的）、終點)。z ＝ 錨點的 z ＋ (d ＋ 錨點與這一點照姿態的高低差) ÷ 船的 z 軸往上的分量。
var WRW_ST = 11;
var WRW_VS = '#version 300 es\nlayout(location=0) in vec4 aP; layout(location=1) in float aH0; layout(location=2) in vec2 aR; layout(location=3) in vec4 aC; uniform mat4 uModel,uVP; uniform float uMix,uVox; out vec3 vW; out float vF; out vec2 vG;\n' +
  'void main(){ float d=mix(aH0,aP.z,uMix), cz=mix(aC.z,aC.w,uMix), k=uModel[2][1]; float z=k>1e-4?cz+(d+uModel[0][1]*(aC.x-aP.x)+uModel[1][1]*(aC.y-aP.y))/k:aR.y; z=clamp(z,aR.x,aR.y);\n' +
  ' vec4 w=uModel*vec4(aP.xy,z,1.0); vW=w.xyz; vF=aP.w; vG=aP.xy*uVox; gl_Position=uVP*w; }\n';
/** 第 i 格水格每一層的空氣分到哪幾間：[l, 房, 格數, l, 房, 格數, …]（照 l 由下往上）。同型共用、照進水檔位的格大小各一份（wrxOf(T).split）。 */
function wrwSplit(T, F, i) {
  var X = wrxOf(T), W = T.wrm, SP = X.split && X.split.c === F.c ? X.split : (X.split = { c: F.c, m: new Map() }), e = SP.m.get(i);
  if (e) return e;
  var c = F.c, NX = F.NX, NXY = NX * F.NY, ix = i % NX, iy = ((i / NX) | 0) % F.NY, iz = (i / NXY) | 0, xa = F.X0 + ix * c, ya = F.Y0 + iy * c, yb = ya + c - 1;
  e = []; var all = new Map();
  for (var l = 0; l < c; l++) {
    var z = iz * c + l; if (z < 0 || z >= W.zTop) continue;
    var cnt = new Map();
    for (var x = xa; x < xa + c; x++) {
      var xi = x - W.x0; if (xi < 0 || xi >= W.nxv) continue;
      var k = z * W.nxv + xi;
      for (var q = W.rowS[k]; q < W.rowS[k + 1]; q++) {
        var a = Math.max(ya, W.ry0[q]), b = Math.min(yb, W.ry1[q]); if (a > b) continue;
        var r = W.regRoom[W.runReg[q]]; cnt.set(r, (cnt.get(r) || 0) + b - a + 1);
      }
    }
    cnt.forEach(function (n, r) { e.push(l, r, n); all.set(r, (all.get(r) || 0) + n); });
  }
  e.all = []; all.forEach(function (n, r) { e.all.push(r, n); e.allN = (e.allN || 0) + n; });   // 整格出現過的房間（那一層沒有房間 ⇒ 照它分；打穿的地方，TASK-0809 之前烘焙的房間沒有那幾格）
  SP.m.set(i, e); return e;
}
/** 整格都沒有房間（炸開的地方）⇒ 六個鄰格出現過的房間合起來 [房, 格數, …]（e.near、e.nearN；算一次留著）。 */
function wrwNear(T, F, i, e) {
  if (e.near) return e;
  var NX = F.NX, NXY = NX * F.NY, ix = i % NX, iy = ((i / NX) | 0) % F.NY, iz = (i / NXY) | 0, m = new Map();
  [ix > 0 ? i - 1 : -1, ix < NX - 1 ? i + 1 : -1, iy > 0 ? i - NX : -1, iy < F.NY - 1 ? i + NX : -1, iz > 0 ? i - NXY : -1, iz < F.NZ - 1 ? i + NXY : -1].forEach(function (k) {
    if (k < 0) return; var a = wrwSplit(T, F, k).all; for (var q = 0; q < a.length; q += 2) m.set(a[q], (m.get(a[q]) || 0) + a[q + 1]);
  });
  e.near = []; e.nearN = 0; m.forEach(function (n, r) { e.near.push(r, n); e.nearN += n; });
  return e;
}
/** 現在的水格 ⇒ 每間房幾單位（me.U，小數）。那一層沒有房間（打穿、不在烘焙的艙內空氣裡）⇒ 照整格出現過的房間分；整格都沒有 ⇒ 照六個鄰格的；還是沒有 ⇒ 記在 me.lost（m³，只給讀數）。 */
function wrwBridge(sh, me) {
  var fl = sh.fl, F = fl.F, c = F.c, A = fl.A, op = fl.op, S3 = S * S * S, U = me.U, lost = 0, tot = 0;
  U.fill(0);
  for (var t = 0; t < fl.actN; t++) {
    var i = fl.act[t], w = A[i] / S3; if (!(w > 1e-9)) continue;            // 這一格的水（格數）
    tot += w;
    var e = wrwSplit(sh.T, F, i), p = 0;
    if (!e.allN) { wrwNear(sh.T, F, i, e); if (e.nearN) { for (var q3 = 0; q3 < e.near.length; q3 += 2) U[e.near[q3]] += w * e.near[q3 + 1] / e.nearN * WR_U; continue; } }   // 整格都沒有房間 ⇒ 照六個鄰格的房間分
    for (var l = 0; l < c && w > 1e-9; l++) {
      var o = op[i * c + l]; if (o <= 0) continue;                            // 空著 0 格的那一層（甲板）：水過不去也不停在那裡（同 flMesh）
      var take = Math.min(w, o), n = 0, q; w -= take;
      while (p < e.length && e[p] < l) p += 3;
      for (q = p; q < e.length && e[q] === l; q += 3) n += e[q + 2];
      if (!n) { if (!e.allN) { lost += take; continue; } for (q = 0; q < e.all.length; q += 2) U[e.all[q]] += take * e.all[q + 1] / e.allN * WR_U; continue; }
      for (q = p; q < e.length && e[q] === l; q += 3) U[e[q + 1]] += take * e[q + 2] / n * WR_U;
    }
    if (w > 1e-9) { if (e.allN) for (var q2 = 0; q2 < e.all.length; q2 += 2) U[e.all[q2]] += w * e.all[q2 + 1] / e.allN * WR_U; else lost += w; }   // 裝超過格的容量的（擠上去還沒搬）⇒ 一樣照整格的房間分
  }
  me.lost = lost * S3; me.tot = tot * S3;
}
/** 除錯（__game.wrwater(i, { probe: 1 })）：上次重做之後船動了，水面還對不對 ——
 *  每一欄有水面的欄中心，照上次重做的資料、現在的姿態算船上的 z：新算法（錨點）、舊算法（頂點帶世界高度，2026-10-22 以前），各跟「當場重做」比，回平均、最大差（m）。 */
function wrwProbe(sh) {
  var me = sh.wrw; if (!me || !me.cols) return null;
  var T = sh.T, W = T.wrm, X = wrxOf(T), M = sh.M, NCX1 = W.NCX + 1, NCC = NCX1 * (W.NCY + 1), AN = wrwAnchors(T);
  function cen(m, j) { var r = W.colRoom[j], b = r * NCC + W.colCY[j] * NCX1 + W.colCX[j], s = 0, k = [b, b + 1, b + NCX1, b + NCX1 + 1]; for (var a = 0; a < 4; a++) s += m.cv.get(k[a])[1]; return s / 4; }
  var old = {}, j, t, r;
  for (t = 0; t < me.cols.length; t++) {
    j = me.cols[t]; r = W.colRoom[j]; var d = cen(me, j);
    old[j] = [me.cz[2 * r + 1] + (d + M[1] * (AN[2 * r] - X.cx[j]) + M[5] * (AN[2 * r + 1] - X.cy[j])) / M[9], (me.hm[r] + d - (M[1] * X.cx[j] + M[5] * X.cy[j] + M[13])) / M[9]];
  }
  var snap0 = FL_SNAP; FL_SNAP = true; wrwMesh(sh); FL_SNAP = snap0;   // 當場重做（同一個姿態）
  var n = 0, sN = 0, sO = 0, mN = 0, mO = 0;
  for (t = 0; t < me.cols.length; t++) {
    j = me.cols[t]; if (!old[j]) continue; r = W.colRoom[j];
    var z = me.cz[2 * r + 1] + (cen(me, j) + M[1] * (AN[2 * r] - X.cx[j]) + M[5] * (AN[2 * r + 1] - X.cy[j])) / M[9], eN = Math.abs(old[j][0] - z) * S, eO = Math.abs(old[j][1] - z) * S;
    n++; sN += eN; sO += eO; mN = Math.max(mN, eN); mO = Math.max(mO, eO);
  }
  return { cols: n, newMean: +(sN / Math.max(1, n)).toFixed(4), newMax: +mN.toFixed(4), oldMean: +(sO / Math.max(1, n)).toFixed(4), oldMax: +mO.toFixed(4) };
}
/** 每間房在船上的錨點（格座標 x, y：照每一欄的容量加權的水平中心；一型船算一次，T.wrwA）。水面照「通過錨點、跟地球水平」畫 ⇒ 水跟著船走。 */
function wrwAnchors(T) {
  if (T.wrwA) return T.wrwA;
  var W = T.wrm, X = wrxOf(T), NR = W.roomVox.length, A = new Float32Array(2 * NR);
  for (var r = 0; r < NR; r++) {
    var sw = 0, sx = 0, sy = 0;
    for (var j = W.roomCol0[r]; j < W.roomCol0[r + 1]; j++) { var c = wrColCap(W, X, j); sw += c; sx += c * X.cx[j]; sy += c * X.cy[j]; }
    A[2 * r] = sw ? sx / sw : W.x0; A[2 * r + 1] = sw ? sy / sw : W.ylo;
  }
  return (T.wrwA = A);
}
function wrwMix(me) { return FL_SNAP ? 1 : clamp((performance.now() - me.tw) / WRW_MS, 0, 1); }
// ── 細波（TASK-0811 驗收第 4 條；Tim 2026-10-22「顯示上 模擬房間表面的水傾斜跟波動」）：只給畫面 ──
//   噴進來的粒子（33_flood.js fl.J）往下掉、穿過它所在那一間的水面（wrwMesh 記的 me.hk）、水幕落到水面（fl.mesh.falls）⇒ 記一個漣漪點 [x, y（船的格座標）, 起點（SIMT）, 強度]；
//   同一個地方 0.3 秒內只起一圈、每艘最多 WRW_RN 圈、活 WRW_RT 秒。著色器（WRW_RIP_GLSL）照點往外擴的同心圓擾動法線、波峰加一點白沫。
//   時間照 SIMT（uSeaT）⇒ 暫停就停、慢動作就慢。⛔ 不抽 rnd()、不改水量：關掉（畫質「艙內水面的畫法」水格）戰局逐位相同。
var WRW_RN = 24, WRW_RT = 2.2, WRW_RGAP = 0.12;
var WRW_RIP_DECL = 'uniform vec4 uRip[' + WRW_RN + ']; uniform int uRipN; uniform vec4 uAx;\n';   // uRip ＝ (x, y（船上的公尺）, 起點秒, 強度)；uAx ＝ 船的 x、y 軸在世界 xz 上的方向
var WRW_RIP_GLSL = ' float wrRf=0.0; for(int i=0;i<' + WRW_RN + ';i++){ if(i>=uRipN) break; vec4 q=uRip[i]; float ag=uSeaT-q.z; if(ag<0.0) continue;\n' +
  '  float f0=0.2+0.85*ag; vec2 dv=vG-q.xy; float d=length(dv); if(d>f0+0.12) continue;\n' +
  '  float a=q.w*exp(-1.6*ag)*(1.0-smoothstep(f0-0.04,f0+0.12,d))*exp(-2.2*max(f0-d,0.0)), ph=17.0*(d-f0);\n' +   // 波前往外 0.85 m／秒、越往裡越淡、越老越淡
  '  vec2 gg=(d>1e-3?dv/d:vec2(0.0))*sin(ph)*a*0.32; r+=vec2(gg.x*uAx.x+gg.y*uAx.z,gg.x*uAx.y+gg.y*uAx.w); wrRf+=a*smoothstep(0.55,1.0,cos(ph)); }\n';
var WRW_RIP_FOAM = ' c=mix(c,vec3(0.82,0.9,0.92),clamp(wrRf,0.0,1.0)*0.45);\n';
/** 每一格畫面（flDraw）：照粒子、水幕記漣漪點（只看最多約 300 顆粒子，輪流）。 */
function wrwRipples(sh, me) {
  var fl = sh.fl, J = fl.J, W = sh.T.wrm, M = sh.M, C = W.c, NCK = W.NCX * W.NCY, R = me.rip || (me.rip = []), now = SIMT, HK = me.hk;
  while (R.length && (now - R[0][2] > WRW_RT || now < R[0][2])) R.shift();   // 照時間排：最老的在前（重開一局 SIMT 歸零 ⇒ 全清）
  if (!HK || !HK.size || now - (me.ripT === undefined ? -1 : me.ripT) < WRW_RGAP && now >= me.ripT) return;   // 整艘限速：WRW_RGAP 秒最多起一圈（⛔ 不限 ⇒ 噴流一格起好幾圈、24 圈一下就輪完，每一圈活不到半秒、看不見）
  var done = false;
  function add(x, y, z, amp) {
    if (done) return;
    var r = wrRoomAt(W, Math.floor(x), Math.floor(y), Math.floor(z)); if (r < 0) return;
    var h = HK.get(r * NCK + Math.floor((x - W.x0) / C) * W.NCY + Math.floor((y - W.ylo) / C)); if (h === undefined) return;
    if (z > h + 0.08 / S || z < h - 0.35 / S) return;                   // 剛好在水面那一帶（HK ＝ 水面的船上 z，格）
    for (var k = R.length - 1; k >= 0 && now - R[k][2] < 0.3; k--) { var dx = (R[k][0] - x) * S, dy = (R[k][1] - y) * S; if (dx * dx + dy * dy < 0.25) return; }
    R.push([x, y, now, amp]); if (R.length > WRW_RN) R.shift();
    done = true; me.ripT = now;
  }
  var step = Math.max(1, Math.ceil(J.n / 300)), off = me.ripK = ((me.ripK || 0) + 1) % step;
  for (var i = off; i < J.n; i += step) { var o = i * 3; if (J.v[o + 2] < 0) add(J.p[o], J.p[o + 1], J.p[o + 2], Math.min(1, 0.35 + 0.6 * Math.cbrt(J.vol[i]))); }
  var FS = GFX.fall && fl.mesh && fl.mesh.fn ? fl.mesh.falls : null;     // 水幕的落點：落到水面 ⇒ 一直起波（照流量）
  if (FS) for (var k2 = 0; k2 < FS.length; k2++) { var f = FS[k2]; add(f.x, f.y, f.z1 + 0.5, Math.min(1, 0.3 + f.r)); }
}
/** 畫房間的水面之前：這一艘的漣漪點、船軸（P.wpool 的 uRip、uRipN、uAx）。 */
function wrwRipU(p, sh, me) {
  var R = me.rip || [], A = me.ripA || (me.ripA = new Float32Array(WRW_RN * 4)), M = sh.M;
  for (var i = 0; i < R.length; i++) { A[i * 4] = R[i][0] * S; A[i * 4 + 1] = R[i][1] * S; A[i * 4 + 2] = R[i][2]; A[i * 4 + 3] = R[i][3]; }
  gl.uniform4fv(p.u.uRip, A); gl.uniform1i(p.u.uRipN, R.length);
  var ax = Math.hypot(M[0], M[2]) || 1, ay = Math.hypot(M[4], M[6]) || 1;
  gl.uniform4f(p.u.uAx, M[0] / ax, M[2] / ax, M[4] / ay, M[6] / ay);
}
/** 重做一艘的房間水面（到時間才做）⇒ me（vao、n 個頂點、讀數 st）。 */
function wrwMesh(sh) {
  var T = sh.T, W = T.wrm, X = wrxOf(T), M = sh.M, NR = W.roomVox.length, NCOL = W.colRoom.length, C = W.c;
  var me = sh.wrw || (sh.wrw = { vao: gl.createVertexArray(), vb: gl.createBuffer(), buf: new Float32Array(WRW_ST * 6 * 1024), n: 0, cap: 0, tw: -1e9, U: new Float64Array(NR), u: new Int32Array(NCOL), h: new Float64Array(NR), cv: new Map(), st: null, hm: new Float64Array(NR), cz: new Float64Array(2 * NR), czp: new Float64Array(2 * NR).fill(NaN) });
  var now = performance.now();
  if (!FL_SNAP && me.n && now - me.tw < WRW_MS) return me;
  var mix0 = me.n ? wrwMix(me) : 1, prev = me.cv, j, r;
  me.tw = now;
  var wetR = [], tB;
  if (sh.wrs) {                                                             // 有房間模擬（TASK-0808，33_wrsim.js）⇒ 直接畫它每一欄的水（同一把尺；高度場 ⇒ 看得到水位差與晃動）
    me.u.set(sh.wrs.u); me.U.fill(0); me.tot = me.lost = 0;
    for (j = 0; j < NCOL; j++) if (me.u[j]) me.U[W.colRoom[j]] += me.u[j];
    tB = performance.now();
    for (r = 0; r < NR; r++) { me.h[r] = NaN; if (me.U[r] >= 1) { wetR.push(r); me.tot += me.U[r] / WR_U * S * S * S; } }
  } else {
    wrwBridge(sh, me); me.u.fill(0); tB = performance.now();
    for (r = 0; r < NR; r++) { var Ur = Math.round(me.U[r]); me.h[r] = Ur >= 1 ? wrLevelRoom(W, X, M, r, Ur, me.u) : NaN; if (Ur >= 1) wetR.push(r); }
  }
  // 每一欄有水面（有水、沒滿）的世界高度 ⇒ 那一間的平均水面 hm（世界高度）；角（同一間房）累加 d ＝ 離平均水面多高（船怎麼動都不變）
  var tL = performance.now(), NCX1 = W.NCX + 1, NCC = NCX1 * (W.NCY + 1), CS = new Map(), cols = [], zcol = [], HK = me.hk = new Map(), NCK = W.NCX * W.NCY;   // HK：(房, 欄) ⇒ 水面的船上 z（細波 wrwRipples 查）
  var AN = wrwAnchors(T), hm = me.hm, hn = new Int32Array(NR), CZ = me.cz, czp = me.czp;
  function addC(k, v) { var e = CS.get(k); if (e) { e[0] += v; e[1]++; } else CS.set(k, [v, 1]); }
  hm.fill(0);
  wetR.forEach(function (r) {
    for (var j = W.roomCol0[r]; j < W.roomCol0[r + 1]; j++) {
      var u = me.u[j]; if (u <= 0 || u >= wrColCap(W, X, j)) continue;    // 沒水、滿到天花板 ⇒ 沒有水面
      var z = wrColZ(W, X, j, u); cols.push(j); zcol.push(z); HK.set(r * NCK + W.colCX[j] * W.NCY + W.colCY[j], z);
      hm[r] += M[1] * X.cx[j] + M[5] * X.cy[j] + M[9] * z + M[13]; hn[r]++;
    }
  });
  for (r = 0; r < NR; r++) hm[r] = hn[r] ? hm[r] / hn[r] : NaN;
  for (var t1 = 0; t1 < cols.length; t1++) {
    var j1 = cols[t1], r1 = W.colRoom[j1], dv = M[1] * X.cx[j1] + M[5] * X.cy[j1] + M[9] * zcol[t1] + M[13] - hm[r1], b1 = r1 * NCC + W.colCY[j1] * NCX1 + W.colCX[j1];
    addC(b1, dv); addC(b1 + 1, dv); addC(b1 + NCX1, dv); addC(b1 + NCX1 + 1, dv);
  }
  var cv = new Map();                                                       // 角 ⇒ [這次的起點（上一次畫面上的 d）, 終點]
  CS.forEach(function (e, k) { var v = e[0] / e[1], p = prev.get(k); cv.set(k, [p ? p[0] + (p[1] - p[0]) * mix0 : v, v]); });
  me.cv = cv; me.cols = cols;
  for (r = 0; r < NR; r++) {                                                // 錨點那一點平均水面的船上 z：[起點（上一次畫面上的）, 終點]
    if (!(hm[r] === hm[r])) { CZ[2 * r] = CZ[2 * r + 1] = NaN; continue; }
    var c1 = (hm[r] - (M[1] * AN[2 * r] + M[5] * AN[2 * r + 1] + M[13])) / M[9], o0 = czp[2 * r], o1 = czp[2 * r + 1];
    CZ[2 * r] = o0 === o0 && o1 === o1 ? o0 + (o1 - o0) * mix0 : c1; CZ[2 * r + 1] = c1;
  }
  czp.set(CZ);
  // 每一欄：照四個角雙線性內插；整欄的每一格水面都落在這一間 ⇒ WRW_G × WRW_G 片，否則只畫落在這一間的那幾格
  var q = 0, quads = 0, clip = 0, vox = 0;
  function bil(H, u, v) { return (H[0] * (1 - u) + H[1] * u) * (1 - v) + (H[3] * (1 - u) + H[2] * u) * v; }
  function grow(nq) { if ((q + nq * 6) * WRW_ST > me.buf.length) { var nb = new Float32Array(Math.max(me.buf.length * 2, (q + nq * 6) * WRW_ST * 2)); nb.set(me.buf); me.buf = nb; } }
  var TRI6 = [0, 1, 2, 0, 2, 3], IN = new Uint8Array(C * C);
  for (var t = 0; t < cols.length; t++) {
    j = cols[t]; r = W.colRoom[j];
    var gx = W.colCX[j], gy = W.colCY[j], base = r * NCC + gy * NCX1 + gx, x0 = W.x0 + gx * C, y0 = W.ylo + gy * C, wc = Math.min(C, W.nxv - gx * C), hc = Math.min(C, W.ny - gy * C);
    var K4 = [base, base + 1, base + NCX1 + 1, base + NCX1], H0 = [], H1 = [];
    for (var a = 0; a < 4; a++) { var cc = cv.get(K4[a]); H0.push(cc[0]); H1.push(cc[1]); }
    var zlo = W.colZ0[j], zhi = W.colZ0[j] + W.colNZ[j], n = 0, b, Lmin = 1e9, Lmax = -1e9;
    for (a = 0; a < 4; a++) {                                               // 水面經過哪幾層：雙線性的極值在四個角 ⇒ 四個角的 z 夾出來
      var zc = (hm[r] + H1[a] - (M[1] * (x0 + (a === 1 || a === 2 ? wc : 0)) + M[5] * (y0 + (a >= 2 ? hc : 0)) + M[13])) / M[9], Lc = Math.floor(zc - 1e-3);
      Lmin = Math.min(Lmin, Lc); Lmax = Math.max(Lmax, Lc);
    }
    var full = Lmax - Lmin < 4;                                             // 那幾層這一欄每一格都是這間房 ⇒ 整欄都畫（⛔ 不用一格一格查）
    for (var L = Lmin; L <= Lmax && full; L++) { var dl = L - zlo; if (dl < 0 || dl >= W.colNZ[j] || W.cnt[W.colOff[j] + dl] !== wc * hc) full = false; }
    if (full) n = wc * hc;
    else for (a = 0; a < wc; a++) for (b = 0; b < hc; b++) {
      var xv = x0 + a, yv = y0 + b, hs = hm[r] + bil(H1, (a + 0.5) / wc, (b + 0.5) / hc), zs = (hs - (M[1] * (xv + 0.5) + M[5] * (yv + 0.5) + M[13])) / M[9];
      if ((IN[a * C + b] = wrRoomAt(W, xv, yv, Math.floor(zs - 1e-3)) === r ? 1 : 0)) n++;
    }
    if (!n) continue;
    if (n === wc * hc) full = true;
    var G = full ? WRW_G : 0, SP = [];                                      // SP：要畫的片 [u0, u1, v0, v1]；切邊的欄每一行（同一個 x）連著的格併成一條
    if (full) { for (a = 0; a < G; a++) for (b = 0; b < G; b++) SP.push(a / G, (a + 1) / G, b / G, (b + 1) / G); }
    else for (a = 0; a < wc; a++) for (b = 0; b < hc; b++) {
      if (!IN[a * C + b]) continue;
      var b1 = b; while (b1 + 1 < hc && IN[a * C + b1 + 1]) b1++;
      SP.push(a / wc, (a + 1) / wc, b / hc, (b1 + 1) / hc); b = b1;
    }
    grow(SP.length / 4); if (!full) clip++; vox += n;
    for (var sp = 0; sp < SP.length; sp += 4) {
      var u0 = SP[sp], u1 = SP[sp + 1], v0 = SP[sp + 2], v1 = SP[sp + 3];
      var CN = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
      for (var e6 = 0; e6 < 6; e6++) {
        var cu = CN[TRI6[e6]][0], cvv = CN[TRI6[e6]][1], o7 = q * WRW_ST;
        me.buf[o7] = x0 + cu * wc; me.buf[o7 + 1] = y0 + cvv * hc; me.buf[o7 + 2] = bil(H1, cu, cvv); me.buf[o7 + 3] = 0;
        me.buf[o7 + 4] = bil(H0, cu, cvv); me.buf[o7 + 5] = zlo; me.buf[o7 + 6] = zhi;
        me.buf[o7 + 7] = AN[2 * r]; me.buf[o7 + 8] = AN[2 * r + 1]; me.buf[o7 + 9] = CZ[2 * r]; me.buf[o7 + 10] = CZ[2 * r + 1]; q++;
      }
      quads++;
    }
  }
  if (FLX3 && WRV_ON) { me.sn = 0; wrvCols(sh, me, cv); }                 // 透視 ⇒ 畫成一團水（體積，wrvDraw）：水面、側面都不畫
  else if (FLX3 || CUTV.half) wrwSides(sh, me, cv); else me.sn = 0;      // 水的側面：只在透視、剖面畫（平常被牆擋住，⛔ 畫了會跟牆搶深度）
  gl.bindVertexArray(me.vao); gl.bindBuffer(gl.ARRAY_BUFFER, me.vb);
  if (q * WRW_ST > me.cap) {
    me.cap = me.buf.length; gl.bufferData(gl.ARRAY_BUFFER, me.cap * 4, gl.DYNAMIC_DRAW);
    var SB4 = WRW_ST * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, SB4, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, SB4, 16);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, SB4, 20);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, SB4, 28);
  }
  if (q) gl.bufferSubData(gl.ARRAY_BUFFER, 0, me.buf, 0, q * WRW_ST);
  gl.bindVertexArray(null);
  me.n = q;
  var Ut = 0; wetR.forEach(function (r) { Ut += Math.round(me.U[r]); });
  me.st = { rooms: wetR.length, cols: cols.length, clip: clip, vox: vox, quads: quads, tris: q / 3, sides: me.sn / 6, m3: +(Ut / WR_U * S * S * S).toFixed(2), src: +me.tot.toFixed(2), lost: +me.lost.toFixed(3), ms: +(performance.now() - now).toFixed(2), msB: +(tB - now).toFixed(2), msL: +(tL - tB).toFixed(2) };
  return me;
}
/** 水的側面（Tim 2026-10-22「按x的透視水 是否可以顯示水的側面(不然看起來是片狀的 不像水體)」）：跟水面同一次重做，畫在 P.pside（63_flood_gl.js，水格的側面那一支著色器）。
 *  每一欄有水的（含滿到天花板的）往前後左右看：同一間的鄰欄也有水、水面差不到 2 cm ⇒ 水連著、不畫；同一間的鄰欄水比較低 ⇒ 從這欄的水面往下接到鄰欄的水面；
 *  其他（牆、別間、船殼、鄰欄乾的）⇒ 從這欄的水面往下到這一段的地板（從水面那一層往下、照格數連著有空氣的最下面那一層；⛔ 不穿過甲板到下一段）。
 *  頂 ＝ 水面的角（同一份 cv）⇒ 側面頂跟水面接得起來；滿到天花板的欄（沒有水面）⇒ 頂 ＝ 欄頂 ⇒ 灌滿的房間看起來是一整塊水。
 *  ⚠ 側面照重做那一刻的姿態換成船上的 z、不跟著水面的骨架內插（同水格的側面）。只動畫面。 */
function wrwSides(sh, me, cv) {
  var T = sh.T, W = T.wrm, X = wrxOf(T), M = sh.M, C = W.c, n = W.colRoom.length, NCX1 = W.NCX + 1, NCC = NCX1 * (W.NCY + 1), NCK = W.NCX * W.NCY, u = me.u, j, d;
  var NB = T.wrwNb;
  if (!NB) {                                                                // 同一間的鄰欄（四個方向，−1 ＝ 沒有）：一型船算一次
    var key = new Map(); for (j = 0; j < n; j++) key.set(W.colRoom[j] * NCK + W.colCX[j] * W.NCY + W.colCY[j], j);
    NB = T.wrwNb = new Int32Array(4 * n).fill(-1);
    for (j = 0; j < n; j++) {
      var r0 = W.colRoom[j], cx = W.colCX[j], cy = W.colCY[j], k;
      if (cx > 0 && (k = key.get(r0 * NCK + (cx - 1) * W.NCY + cy)) !== undefined) NB[4 * j] = k;
      if (cx + 1 < W.NCX && (k = key.get(r0 * NCK + (cx + 1) * W.NCY + cy)) !== undefined) NB[4 * j + 1] = k;
      if (cy > 0 && (k = key.get(r0 * NCK + cx * W.NCY + cy - 1)) !== undefined) NB[4 * j + 2] = k;
      if (cy + 1 < W.NCY && (k = key.get(r0 * NCK + cx * W.NCY + cy + 1)) !== undefined) NB[4 * j + 3] = k;
    }
  }
  function gz(x, y, hw) { return (hw - (M[1] * x + M[5] * y + M[13])) / M[9]; }
  function lev(c) { return u[c] > 0 ? M[1] * X.cx[c] + M[5] * X.cy[c] + M[9] * wrColZ(W, X, c, u[c]) + M[13] : -1e9; }   // 那一欄的水面（世界高度；滿 ⇒ 欄頂）
  var sq = 0, SB = me.sbuf || (me.sbuf = new Float32Array(7 * 6 * 512));
  for (j = 0; j < n; j++) {
    if (u[j] <= 0) continue;
    var r = W.colRoom[j], gx = W.colCX[j], gy = W.colCY[j], x0 = W.x0 + gx * C, y0 = W.ylo + gy * C, wc = Math.min(C, W.nxv - gx * C), hc = Math.min(C, W.ny - gy * C);
    var zlo = W.colZ0[j], zhi = zlo + W.colNZ[j], hj = lev(j), full = u[j] >= wrColCap(W, X, j);
    for (d = 0; d < 4; d++) {
      var nb = NB[4 * j + d], hn = nb >= 0 ? lev(nb) : -1e9;
      if (nb >= 0 && hn >= hj - 0.02) continue;                            // 水連著
      var xa, ya, xb, yb, ka, kb;                                          // 邊的兩端（格座標）與兩端的角（同水面的鍵）
      if (d === 0) { xa = xb = x0; ya = y0; yb = y0 + hc; ka = r * NCC + gy * NCX1 + gx; kb = ka + NCX1; }
      else if (d === 1) { xa = xb = x0 + wc; ya = y0; yb = y0 + hc; ka = r * NCC + gy * NCX1 + gx + 1; kb = ka + NCX1; }
      else if (d === 2) { ya = yb = y0; xa = x0; xb = x0 + wc; ka = r * NCC + gy * NCX1 + gx; kb = ka + 1; }
      else { ya = yb = y0 + hc; xa = x0; xb = x0 + wc; ka = r * NCC + (gy + 1) * NCX1 + gx; kb = ka + 1; }
      var ca = full ? null : cv.get(ka), cb = full ? null : cv.get(kb);
      var za = clamp(ca ? gz(xa, ya, me.hm[r] + ca[1]) : gz(xa, ya, hj), zlo, zhi), zb = clamp(cb ? gz(xb, yb, me.hm[r] + cb[1]) : gz(xb, yb, hj), zlo, zhi);   // 角存的是 d（離那一間平均水面多高）
      var za1, zb1;
      if (nb >= 0 && hn > -1e8) { za1 = clamp(gz(xa, ya, hn), zlo, za); zb1 = clamp(gz(xb, yb, hn), zlo, zb); }   // 接到鄰欄（同一間、比較低）的水面
      else {                                                               // 到這一段的地板：從水面那一層往下，連著有空氣的最下面那一層
        var L = clamp(Math.floor(Math.max(za, zb) - 1e-3) - zlo, 0, W.colNZ[j] - 1), off = W.colOff[j];
        while (L > 0 && W.cnt[off + L - 1] > 0) L--;
        za1 = zb1 = zlo + L;
      }
      if (za - za1 < 0.3 && zb - zb1 < 0.3) continue;
      if ((sq + 6) * 7 > SB.length) { var SB2 = new Float32Array(SB.length * 2); SB2.set(SB); SB = me.sbuf = SB2; }
      var Lm = Math.max(za - za1, zb - zb1) * S, V = [[xa, ya, za, 0, 0], [xb, yb, zb, 1, 0], [xb, yb, zb1, 1, 1], [xa, ya, za, 0, 0], [xb, yb, zb1, 1, 1], [xa, ya, za1, 0, 1]];
      for (var e = 0; e < 6; e++) { var o = sq * 7, p = V[e]; SB[o] = p[0]; SB[o + 1] = p[1]; SB[o + 2] = p[2]; SB[o + 3] = p[3]; SB[o + 4] = p[4]; SB[o + 5] = Lm; SB[o + 6] = 0; sq++; }
    }
  }
  if (!me.svao) {
    me.svao = gl.createVertexArray(); me.svb = gl.createBuffer(); me.scap = 0;
    gl.bindVertexArray(me.svao); gl.bindBuffer(gl.ARRAY_BUFFER, me.svb);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
  }
  gl.bindVertexArray(me.svao); gl.bindBuffer(gl.ARRAY_BUFFER, me.svb);
  if (sq * 7 > me.scap) { me.scap = SB.length; gl.bufferData(gl.ARRAY_BUFFER, me.scap * 4, gl.DYNAMIC_DRAW); }
  if (sq) gl.bufferSubData(gl.ARRAY_BUFFER, 0, SB, 0, sq * 7);
  gl.bindVertexArray(null);
  me.sn = sq;
}
// ── 透視的水：體積（Tim 2026-10-22：「是否可以改用 light scattering 算法去顯示透視水體 把水體空間當灰塵」「根據穿透量顯示不同深淺的藍色」）──
//   只在透視（FLX3）：水面片、側面片都不畫，改成一團會吸光、會散射的介質（participating media）——
//   每個像素沿視線在「有水的那幾欄」的包圍盒裡走固定步數，累加視線在水裡走了幾公尺 L；Beer–Lambert 穿透率 T ＝ e^(−WRV_SIG·L)，
//   顏色 ＝ 背景·T ＋ (1 − T)·水的藍（L 越長越深；朝太陽那一側加一點前向散射，Henyey–Greenstein g ＝ 0.55）⇒ 薄的地方淡、厚的地方深藍。
//   密度從哪來（⛔ 不重做 3D 網格）：
//   · 一型船一張 3D 整數貼圖（wrvVol，T.wrvV；寬 NCX × 高 NCY × 深 zTop：一欄 WR_C 格見方、一層 0.1 m）：每一格記「屬於哪一欄、這一層這一欄有幾格空氣」，一格最多兩欄（牆在欄中間 ⇒ 兩間）。只看烘焙、不看水 ⇒ 算一次。
//   · 每一次重做（wrwMesh，WRW_MS）一張小表（wrvCols，me.wv；每欄兩格 RGBA32F）：這一欄乾／有水面／灌滿、離那一間平均水面多高 d（起點、終點）、那一間的錨點與錨點水面的船上 z（起點、終點）。
//   · 著色器每一步照船現在的姿態（uModel）算那一欄的水面（同 WRW_VS 的錨點算法）⇒ 水跟著船走、水面跟地球水平；兩次重做之間照 uMix 內插（同水面）。
//   ?wrvol=0 ⇒ 透視照舊畫水面＋側面（前後對照；__game.wrwater(0, { vol: 0／1 }) 當場切）。只動畫面：不讀亂數、不改水量。
var WRV_ON = Q.get('wrvol') !== '0', WRV_SIG = 1.4, WRV_N = 96, WRV_TW = 2048, WRV_BOX = null;
var WRV_VS = '#version 300 es\nlayout(location=0) in vec3 aP; uniform mat4 uModel,uVP; uniform vec3 uB0,uB1; out vec3 vL; out vec3 vW;\n' +
  'void main(){ vL=mix(uB0,uB1,aP); vec4 w=uModel*vec4(vL,1.0); vW=w.xyz; gl_Position=uVP*w; }\n';
var WRV_FS = '#version 300 es\nprecision highp float; precision highp int; in vec3 vL; in vec3 vW; uniform highp usampler3D uVol; uniform highp sampler2D uCol;\n' +
  'uniform mat4 uModel; uniform vec3 uEyeL,uB0,uB1,uO,uEye,uSun,uFog; uniform ivec3 uDim; uniform float uMix,uVox,uFogD,uLit,uSig; out vec4 o;\n' +
  'vec2 wrvW(uint v,vec3 p){ if(v==0u) return vec2(0.0); int q=2*(int(v>>5u)-1); float a=float(v&31u)/(uO.z*uO.z);\n' +   // 這一欄在 p 那一點：x ＝ 有幾成是水（乾 0、灌滿 ＝ 空氣的比例、有水面 ⇒ 水面以下，±半格淡進）、y ＝ 離水面多近（±1.5 格內，水面的亮線用）
  ' vec4 A=texelFetch(uCol,ivec2(q&' + (WRV_TW - 1) + ',q/' + WRV_TW + '),0); if(A.z<0.5) return vec2(0.0); if(A.z>1.5) return vec2(a,0.0);\n' +
  ' vec4 B=texelFetch(uCol,ivec2((q+1)&' + (WRV_TW - 1) + ',(q+1)/' + WRV_TW + '),0); float zs=mix(B.z,B.w,uMix)+(mix(A.x,A.y,uMix)+uModel[0][1]*(B.x-p.x)+uModel[1][1]*(B.y-p.y))/uModel[2][1];\n' +
  ' return a*vec2(clamp(zs-p.z+0.5,0.0,1.0),max(1.0-abs(zs-p.z)/1.5,0.0)); }\n' +
  'void main(){ vec3 rd=vL-uEyeL; float tf=length(rd); rd/=tf; vec3 iv=vec3(rd.x<0.0?-1.0:1.0,rd.y<0.0?-1.0:1.0,rd.z<0.0?-1.0:1.0)/max(abs(rd),vec3(1e-6));\n' +
  ' vec3 ta=(uB0-uEyeL)*iv, tb=(uB1-uEyeL)*iv, tn=min(ta,tb), tx=max(ta,tb); float t0=max(max(max(tn.x,tn.y),tn.z),0.0), t1=min(min(tx.x,tx.y),tx.z);\n' +
  ' if(t1<=t0||tf<t1*0.999-0.01) discard;\n' +                                                            // 只照盒子的背面那一片算（⛔ 不靠剔除：船的矩陣把 y、z 對調 ⇒ 正反面跟著翻）；鏡頭在盒子裡也對
  ' int n=int(min(' + WRV_N + '.0,ceil((t1-t0)/0.8))); float dt=(t1-t0)/float(n), jt=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715)))), acc=0.0, sh=0.0;\n' +   // 步距最細 0.8 格；起點照像素錯開（交錯梯度雜訊）⇒ 沒有一圈一圈的紋
  ' for(int i=0;i<' + WRV_N + ';i++){ if(i>=n) break; vec3 p=uEyeL+rd*(t0+dt*(float(i)+jt)); vec2 h=fract(vec2(jt,jt*1.618)+float(i)*vec2(0.7548777,0.5698403))-0.5;\n' +   // 查哪一欄：水平再錯開 ±半欄（每一步不同）⇒ 0.5 m 一欄的邊變柔、不是一階一階
  '  ivec3 c=ivec3(floor((p.x-uO.x)/uO.z+h.x),floor((p.y-uO.y)/uO.z+h.y),floor(p.z)); if(any(lessThan(c,ivec3(0)))||any(greaterThanEqual(c,uDim))) continue;\n' +
  '  uvec2 v=texelFetch(uVol,c,0).rg; if(v.x==0u) continue; vec2 w=wrvW(v.x,p)+wrvW(v.y,p); if(w.y>0.0) sh+=w.y*dt*exp(-uSig*acc*uVox); acc+=w.x*dt; }\n' +   // sh：擦過水面那一帶的長度（照前面的水吸掉多少打折）
  ' float L=acc*uVox, a=1.0-exp(-uSig*L); if(a<0.003) discard; float k=1.0-exp(-0.25*L);\n' +             // L：視線在水裡走了幾公尺；k：越厚越深的藍
  ' vec3 rw=normalize(vW-uEye); float g=0.55, ph=(1.0-g*g)/pow(1.0+g*g-2.0*g*dot(rw,uSun),1.5);\n' +       // Henyey–Greenstein：看向太陽那一側亮一點
  ' vec3 c=mix(vec3(0.4,0.75,1.0),vec3(0.01,0.1,0.35),k)*(0.72+0.28*uLit)+vec3(1.0,0.95,0.85)*0.07*ph*uLit*(1.0-0.6*k);\n' +
  ' c=mix(c,vec3(0.75,0.88,0.95)*(0.75+0.25*uLit),0.35*(1.0-exp(-0.08*sh)));\n' +                       // 水面的亮線：從側面平平看過去最亮、從上面看只淡淡一層
  ' o=vec4(mix(c,uFog,1.0-exp(-length(vW-uEye)*uFogD)),a); }\n';
/** 一型船的 3D 貼圖（RG32UI）：每一格 ＝ 最多兩個 (欄號 ＋ 1) × 32 ＋ 這一層這一欄有幾格空氣（多的排前面）。太大（超過 MAX_3D_TEXTURE_SIZE）⇒ null（照舊畫水面）。 */
function wrvVol(T) {
  if (T.wrvV !== undefined) return T.wrvV;
  var W = T.wrm, n = W.colRoom.length, NX = W.NCX, NY = W.NCY, NZ = W.zTop, mx = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
  if (NX > mx || NY > mx || NZ > mx || n >= 1 << 26) return (T.wrvV = null);
  var D = new Uint32Array(NX * NY * NZ * 2);
  for (var j = 0; j < n; j++) for (var d = 0; d < W.colNZ[j]; d++) {
    var c = W.cnt[W.colOff[j] + d]; if (!c) continue;
    var i = (((W.colZ0[j] + d) * NY + W.colCY[j]) * NX + W.colCX[j]) * 2, v = (j + 1) * 32 + c;
    if (c > (D[i] & 31)) { D[i + 1] = D[i]; D[i] = v; } else if (c > (D[i + 1] & 31)) D[i + 1] = v;
  }
  var t = gl.createTexture(); gl.activeTexture(gl.TEXTURE15); gl.bindTexture(gl.TEXTURE_3D, t); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);   // 第 15、16 號：別人沒用的單元（⛔ 綁在當下的單元 ⇒ 蓋掉別人留著的貼圖）
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RG32UI, NX, NY, NZ, 0, gl.RG_INTEGER, gl.UNSIGNED_INT, D);
  [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(function (p) { gl.texParameteri(gl.TEXTURE_3D, p, gl.NEAREST); });
  [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R].forEach(function (p) { gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE); });
  gl.bindTexture(gl.TEXTURE_3D, null);
  return (T.wrvV = { tex: t, nx: NX, ny: NY, nz: NZ, x0: W.x0, y0: W.ylo, c: W.c, mb: +(D.length * 4 / 1048576).toFixed(2) });
}
/** 每一次重做（wrwMesh）：每欄的水（me.wv 小表）＋ 有水的欄的包圍盒（格座標，b0／b1）。角 cv 存的是 d ⇒ 欄中心 ＝ 四個角平均。 */
function wrvCols(sh, me, cv) {
  var T = sh.T, W = T.wrm, X = wrxOf(T), C = W.c, n = W.colRoom.length, NCX1 = W.NCX + 1, NCC = NCX1 * (W.NCY + 1), AN = wrwAnchors(T), CZ = me.cz, u = me.u, V = wrvVol(T);
  if (!V) { me.wv = null; return; }
  var rows = Math.ceil(2 * n / WRV_TW), wv = me.wv || (me.wv = { tex: null, buf: new Float32Array(WRV_TW * rows * 4), rows: rows, b0: new Float32Array(3), b1: new Float32Array(3) });
  var B = wv.buf, lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9], wet = 0, full = 0;
  B.fill(0);
  for (var j = 0; j < n; j++) {
    if (!(u[j] > 0)) continue;
    var r = W.colRoom[j], o = 8 * j, cz0 = CZ[2 * r], cz1 = CZ[2 * r + 1];
    if (u[j] >= wrColCap(W, X, j)) { B[o + 2] = 2; full++; }
    else {
      var b = r * NCC + W.colCY[j] * NCX1 + W.colCX[j], K = [b, b + 1, b + NCX1, b + NCX1 + 1], s0 = 0, s1 = 0, a;
      for (a = 0; a < 4; a++) { var e = cv.get(K[a]); if (!e) break; s0 += e[0]; s1 += e[1]; }
      if (a < 4 || !(cz1 === cz1)) continue;                                // 那一間沒有水面（量不到 1 單位、還沒算到）⇒ 當乾的
      B[o] = s0 / 4; B[o + 1] = s1 / 4; B[o + 2] = 1;
      B[o + 4] = AN[2 * r]; B[o + 5] = AN[2 * r + 1]; B[o + 6] = cz0 === cz0 ? cz0 : cz1; B[o + 7] = cz1;
    }
    wet++;
    var x0 = W.x0 + W.colCX[j] * C, y0 = W.ylo + W.colCY[j] * C;
    lo[0] = Math.min(lo[0], x0); hi[0] = Math.max(hi[0], x0 + C); lo[1] = Math.min(lo[1], y0); hi[1] = Math.max(hi[1], y0 + C);
    lo[2] = Math.min(lo[2], W.colZ0[j]); hi[2] = Math.max(hi[2], W.colZ0[j] + W.colNZ[j]);
  }
  for (var q = 0; q < 3; q++) { wv.b0[q] = lo[q] - 0.5; wv.b1[q] = hi[q] + 0.5; }
  gl.activeTexture(gl.TEXTURE16);
  if (!wv.tex) {
    wv.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, wv.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, WRV_TW, rows, 0, gl.RGBA, gl.FLOAT, B);
    [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST); });
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE); });
  } else { gl.bindTexture(gl.TEXTURE_2D, wv.tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, WRV_TW, rows, gl.RGBA, gl.FLOAT, B); }
  gl.bindTexture(gl.TEXTURE_2D, null);
  wv.tw = me.tw; wv.wet = wet; wv.full = full;
}
/** 這一格畫面畫不畫體積：透視開著、這一次重做有做小表（剛按 X ⇒ 下一次重做之前照舊畫水面）。 */
function wrvOn(sh, me) { return FLX3 && WRV_ON && !!me.wv && me.wv.tw === me.tw && me.wv.wet > 0 && !!sh.T.wrvV; }
/** 畫一艘的體積水（flDraw；著色器已經 use、共用的 uniform 已經設好）：盒子 36 個頂點，背面那一片算整條視線。 */
function wrvDraw(p, sh, me) {
  if (!WRV_BOX) {
    var F = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 4, 5], [2, 3, 6, 7], [0, 2, 4, 6], [1, 3, 5, 7]], Bx = [];   // 角 k ＝ (k&1, k>>1&1, k>>2&1)；每面兩個三角形
    F.forEach(function (f) { [f[0], f[1], f[3], f[0], f[3], f[2]].forEach(function (k) { Bx.push(k & 1, (k >> 1) & 1, (k >> 2) & 1); }); });
    WRV_BOX = gl.createVertexArray(); var vb = gl.createBuffer(); gl.bindVertexArray(WRV_BOX); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(Bx), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
  }
  var V = sh.T.wrvV, wv = me.wv, E = PASS.eye || CAM.eye, eL = M4.pt(M4.inv(sh.M), E[0], E[1], E[2]);
  gl.uniformMatrix4fv(p.u.uModel, false, sh.M); gl.uniform3f(p.u.uEyeL, eL[0], eL[1], eL[2]); gl.uniform3fv(p.u.uB0, wv.b0); gl.uniform3fv(p.u.uB1, wv.b1);
  gl.uniform3f(p.u.uO, V.x0, V.y0, V.c); gl.uniform3i(p.u.uDim, V.nx, V.ny, V.nz); gl.uniform1f(p.u.uMix, wrwMix(me));
  gl.activeTexture(gl.TEXTURE15); gl.bindTexture(gl.TEXTURE_3D, V.tex); gl.uniform1i(p.u.uVol, 15);
  gl.activeTexture(gl.TEXTURE16); gl.bindTexture(gl.TEXTURE_2D, wv.tex); gl.uniform1i(p.u.uCol, 16);
  gl.bindVertexArray(WRV_BOX); gl.drawArrays(gl.TRIANGLES, 0, 36);
}
