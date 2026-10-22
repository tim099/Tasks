// ───────────────────────── 船周圍的水（TASK-0524） ─────────────────────────
// 水滴（WS）從船身、砲彈落點、擦撞處飛出去，照重力落回海面 ⇒ 變成白沫（WF）；白沫是貼著浪的一片（60_render.js 畫，頂點照 seaHs 跟浪起伏），漂開、變大、散成細條、消失。
// 從哪裡來：
//   · 船身的水線（船型設計水線那一層、船殼最外那一格，兩舷各 48 點；wpRing）——每一步拿這一步與上一步的船矩陣算同一個船上的點的速度：
//     往外推水（水平速度在外法線上的分量 vn）⇒ 船頭浪；船殼對水面往下壓（船的垂直速度 − 水面的垂直速度，vz < 0）⇒ 拍浪（浪頭打上來、船頭栽進浪、沉船也算）。
//     推與拍都留白沫 ⇒ 船頭兩道往外散的白沫線。
//   · 船尾：照航速翻白沫（會轉的一片）、冒一點水滴。
//   · 擦撞（31_sailing.js collide）、砲彈與碎片與落水的人（12_effects.js splash）、碎木落水（stepDebris）。
// ⛔ 只給人看：自己的亂數 rndW（00_core.js 亂數工廠，開局 rngReset 一起重設）、不回寫任何模擬狀態 ⇒ 開與關同一個種子戰局逐字相同。
//   開著的時候，原本的航跡與水花（spawnPt）照樣由呼叫端抽完 rnd()、只是不放進去（PT_MUTE）⇒ 戰局的亂數順序不變。
// 關（09_phx.js「船邊水花」第 0 檔）⇒ 原本的樣子：航跡與水花照舊是 spawnPt 的點。
// 分級：ws／wf 水滴與白沫的上限、k 生的量、pts 每舷幾點、life 白沫活多久的倍率。
var WP_LV = [null, { ws: 2000, wf: 1000, k: 0.45, pts: 16, life: 0.55 }, { ws: 4500, wf: 2200, k: 0.75, pts: 24, life: 0.8 }, { ws: 8000, wf: 4000, k: 1, pts: 48, life: 1 }];
var WS_MAX = 8000, WF_MAX = 4000, WP_RING = 48;
var WS = { n: 0, p: new Float32Array(WS_MAX * 3), v: new Float32Array(WS_MAX * 3), life: new Float32Array(WS_MAX), max: new Float32Array(WS_MAX), s: new Float32Array(WS_MAX), a: new Float32Array(WS_MAX) };
var WF = { n: 0, p: new Float32Array(WF_MAX * 2), v: new Float32Array(WF_MAX * 2), life: new Float32Array(WF_MAX), max: new Float32Array(WF_MAX), s0: new Float32Array(WF_MAX), s1: new Float32Array(WF_MAX),
  a: new Float32Array(WF_MAX), rot: new Float32Array(WF_MAX), w: new Float32Array(WF_MAX), seed: new Float32Array(WF_MAX) };
var WP_HIDE = false, WFBUF = new Float32Array(WF_MAX * 8), WP_STAT = { spray: 0, foam: 0, src: {} }, FOAMG = null;
PBUF = new Float32Array((PMAX + WS_MAX + 64) * 9);          // 點精靈的緩衝多留水滴的份（12_effects.js；60_render.js 一起畫）
var WP_SRC = '', PT_MUTE = false;   // PT_MUTE：spawnPt 收到也不放（亂數呼叫端已經抽完）
var RNG_W = rngMake('water', 0x1B873593), rndW = RNG_W.f, rgW = RNG_W.r, gsW = RNG_W.g;   // 00_core.js 亂數工廠
function wpLv() { return WP_LV[PHX.water] || null; }
function wsAdd(x, y, z, vx, vy, vz, life, s, a) {
  var L = wpLv(); if (!L || WS.n >= L.ws) return;
  WP_STAT.src[WP_SRC] = (WP_STAT.src[WP_SRC] || 0) + 1;
  var i = WS.n++, o = i * 3;
  WS.p[o] = x; WS.p[o + 1] = y; WS.p[o + 2] = z; WS.v[o] = vx; WS.v[o + 1] = vy; WS.v[o + 2] = vz;
  WS.life[i] = WS.max[i] = life; WS.s[i] = s; WS.a[i] = a; WP_STAT.spray++;
}
function wfAdd(x, z, vx, vz, life, s0, s1, a, w) {
  var L = wpLv(); if (!L) return;
  var i = WF.n < L.wf ? WF.n++ : (rndW() * WF.n) | 0;        // 滿了 ⇒ 隨便頂掉一片（⛔ 不收新的 ⇒ 船尾的舊白沫佔滿，船頭生不出來）
  WF.p[i * 2] = x; WF.p[i * 2 + 1] = z; WF.v[i * 2] = vx; WF.v[i * 2 + 1] = vz;
  WF.life[i] = WF.max[i] = life * L.life; WF.s0[i] = s0; WF.s1[i] = s1; WF.a[i] = a; WF.rot[i] = rndW() * 6.2832; WF.w[i] = w || 0; WF.seed[i] = rndW() * 64; WP_STAT.foam++;
}
/** 船型 T 的水線一圈（設計水線那一層、船殼最外那一格）：兩舷各 WP_RING 點 [x, y, 外法線 nx, ny]（格座標）。第一次用到時算。 */
function wpRing(T) {
  var G = T.base, ZW = T.zw, x0 = T.wl0, x1 = T.wl1, R = new Float32Array(WP_RING * 2 * 4), side, i, y;
  for (side = 0; side < 2; side++) {
    var k = side ? -1 : 1, ys = new Float32Array(WP_RING), xs = new Float32Array(WP_RING);
    for (i = 0; i < WP_RING; i++) {
      var x = Math.round(x0 + (x1 - x0) * (i + 0.5) / WP_RING), yo = T.cy;
      if (k > 0) { for (y = G.sy - 1; y > T.cy; y--) if (G.get(x, y, ZW)) { yo = y + 1; break; } }
      else { for (y = 0; y < T.cy; y++) if (G.get(x, y, ZW)) { yo = y; break; } }
      xs[i] = x + 0.5; ys[i] = yo;
    }
    for (i = 0; i < WP_RING; i++) {
      var a = Math.max(0, i - 1), b = Math.min(WP_RING - 1, i + 1), sl = (ys[b] - ys[a]) / ((xs[b] - xs[a]) || 1), l = Math.hypot(sl, 1), q = (side * WP_RING + i) * 4;
      R[q] = xs[i]; R[q + 1] = ys[i]; R[q + 2] = -k * sl / l; R[q + 3] = k / l;
    }
  }
  return R;
}
/** 每一步（50_sim.js，碎片與粒子之後）：船身與船尾生水花與白沫、水滴落海、白沫漂。關 ⇒ 清空。 */
/** only：'ship' ⇒ 只生（船身與船尾，照模擬的步：wpShip 拿這一步與上一步的船矩陣算速度）；'fly' ⇒ 只飛與散（殉爆慢動作時照畫面的時間走，73_slowmo.js）；沒給 ⇒ 都做。 */
function stepWater(dt, only) {
  var L = wpLv();
  if (!L) { WS.n = WF.n = 0; return; }
  if (only !== 'fly') SHIPS.forEach(function (sh) { wpShip(sh, dt, L); });
  if (only === 'ship') return;
  var hmax = 1.2 * SEA_K * WX.sea + 0.1, i, o, wx = WIND[0] * WX.wind * 0.12 * dt, wz = WIND[2] * WX.wind * 0.12 * dt, kd = 1 - 0.35 * dt;
  for (i = 0; i < WS.n; i++) {
    o = i * 3; WS.life[i] -= dt;
    var dead = WS.life[i] <= 0;
    if (!dead) {
      WS.v[o] = WS.v[o] * kd + wx; WS.v[o + 1] = WS.v[o + 1] * kd - G * dt; WS.v[o + 2] = WS.v[o + 2] * kd + wz;
      WS.p[o] += WS.v[o] * dt; WS.p[o + 1] += WS.v[o + 1] * dt; WS.p[o + 2] += WS.v[o + 2] * dt;
      if (WS.v[o + 1] < 0 && WS.p[o + 1] < hmax && WS.p[o + 1] < seaH(WS.p[o], WS.p[o + 2], SIMT)) {   // 落回海面 ⇒ 有的變成一小片白沫
        dead = true;
        if (WS.s[i] > 0.25 && rndW() < 0.05) wfAdd(WS.p[o], WS.p[o + 2], WS.v[o] * 0.15, WS.v[o + 2] * 0.15, rgW(4, 8), 0.3 + WS.s[i], 1.0 + 3 * WS.s[i], 0.55, 0);
      }
    }
    if (dead) {
      var j = --WS.n;
      if (i !== j) { WS.p.copyWithin(o, j * 3, j * 3 + 3); WS.v.copyWithin(o, j * 3, j * 3 + 3); WS.life[i] = WS.life[j]; WS.max[i] = WS.max[j]; WS.s[i] = WS.s[j]; WS.a[i] = WS.a[j]; }
      i--;
    }
  }
  var kf = 1 - 0.3 * dt;
  for (i = 0; i < WF.n; i++) {
    WF.life[i] -= dt;
    if (WF.life[i] <= 0) {
      var m = --WF.n;
      if (i !== m) { WF.p.copyWithin(i * 2, m * 2, m * 2 + 2); WF.v.copyWithin(i * 2, m * 2, m * 2 + 2); WF.life[i] = WF.life[m]; WF.max[i] = WF.max[m]; WF.s0[i] = WF.s0[m]; WF.s1[i] = WF.s1[m]; WF.a[i] = WF.a[m]; WF.rot[i] = WF.rot[m]; WF.w[i] = WF.w[m]; WF.seed[i] = WF.seed[m]; }
      i--; continue;
    }
    WF.p[i * 2] += WF.v[i * 2] * dt; WF.p[i * 2 + 1] += WF.v[i * 2 + 1] * dt; WF.v[i * 2] *= kf; WF.v[i * 2 + 1] *= kf; WF.rot[i] += WF.w[i] * dt; WF.w[i] *= kf;
  }
}
/** 一艘船：水線一圈的推與拍、船尾翻白沫、沉的時候冒氣。 */
function wpShip(sh, dt, L) {
  var T = sh.T, M = sh.M, Mp = sh.wpM; sh.wpM = M;
  if (!Mp || sh.sink > 30 || !(dt > 0)) return;
  var R = T.wpR || (T.wpR = wpRing(T)), st = WP_RING / L.pts | 0, ds = (T.wl1 - T.wl0) * S / WP_RING * st, zc = clamp(T.zw + (sh.sink - sh.lift - sh.bob) / S, 1, T.sz - 2);
  var acc = sh.wpAcc || (sh.wpAcc = new Float32Array(WP_RING * 4 + 4)), t0 = SIMT - dt;
  for (var q = 0; q < WP_RING * 2; q += st) {
    var r = q * 4, P = M4.pt(M, R[r], R[r + 1], zc), P0 = M4.pt(Mp, R[r], R[r + 1], zc), h = seaH(P[0], P[2], SIMT);
    if (P[1] - h > 0.6) continue;                                                 // 這一刻那一點離開水面（浪谷）⇒ 沒碰到水
    var nw = M4.dir(M, R[r + 2], R[r + 3], 0), nl = Math.hypot(nw[0], nw[2]) || 1, nx = nw[0] / nl, nz = nw[2] / nl;
    var vx = (P[0] - P0[0]) / dt, vy = (P[1] - P0[1]) / dt, vz = (P[2] - P0[2]) / dt, vs = (h - seaH(P[0], P[2], t0)) / dt;
    var vn = vx * nx + vz * nz, push = Math.max(0, vn - 0.35), slam = Math.max(0, vs - vy - 0.3), bw = vn > 0.2 ? 0.3 + 1.2 * (vn - 0.2) : 0;
    if (!(push > 0 || slam > 0 || bw > 0)) continue;
    acc[q] += (push * push * 2.5 + slam * slam * 25) * L.k * ds * dt; WP_SRC = push * push * 2.5 > slam * slam * 25 ? 'push' : 'slam';
    for (var nA = 0; acc[q] >= 1 && nA < ACC_CAP; nA++) {                        // 水滴：往外、往上，帶一點船的速度（ACC_CAP：防呆，00_core.js accFix）
      acc[q] -= 1;
      var up = rgW(0.4, 1.1) * (push * 1.3 + slam * 1.7) + 0.3, out = rgW(0.3, 0.9) * vn + rgW(0, 0.6) * slam, cv = rgW(0.3, 0.7);
      var so = rgW(0.8, 1.5);                                                   // 生在船殼外飄的外面（⛔ 貼著水線 ⇒ 從上面看被船頭外飄的船殼蓋住）
      wsAdd(P[0] + nx * so + gsW() * 0.3, h + 0.05, P[2] + nz * so + gsW() * 0.3, nx * out + vx * cv + gsW() * 0.3, up, nz * out + vz * cv + gsW() * 0.3,
        rgW(0.9, 1.6), rgW(0.18, 0.4) * (1 + 0.4 * push), 0.6);
    }
    accFix(acc, q, 1, '水花');
    acc[q + WP_RING * 2] += (bw + slam * 2.0) * L.k * ds * dt;
    for (var nB = 0; acc[q + WP_RING * 2] >= 1 && nB < ACC_CAP; nB++) {                                           // 白沫：船頭兩道往外散的線
      acc[q + WP_RING * 2] -= 1;
      var fo = rgW(0.8, 2.2);
      wfAdd(P[0] + nx * fo, P[2] + nz * fo, nx * Math.max(vn, 0) * 0.6 + vx * 0.15 + gsW() * 0.12, nz * Math.max(vn, 0) * 0.6 + vz * 0.15 + gsW() * 0.12, rgW(10, 18), rgW(0.5, 0.9), rgW(1.6, 2.8), rgW(0.65, 0.9), 0);
    }
    accFix(acc, q + WP_RING * 2, 1, '船頭白沫');
  }
  // 船尾：照航速翻白沫（一片一片會轉）、冒一點水滴
  var sp = Math.abs(sh.spd), k2 = WP_RING * 4; WP_SRC = 'stern';
  if (sp > 0.3 && !sh.sunk) {
    acc[k2] += sp * 2.0 * L.k * dt;
    for (var nC = 0; acc[k2] >= 1 && nC < ACC_CAP; nC++) {
      acc[k2] -= 1;
      var sx = T.wl0 + rgW(2, 14), sy = T.cy + gsW() * T.bowHalf * 0.3, S0 = M4.pt(M, sx, sy, zc);
      wfAdd(S0[0], S0[2], gsW() * 0.35, gsW() * 0.35, rgW(18, 30), rgW(0.9, 1.6), rgW(2.6, 4.4), rgW(0.5, 0.75), gsW() * 0.6);
    }
    accFix(acc, k2, 1, '船尾白沫');
    acc[k2 + 1] += sp * 3 * L.k * dt;
    for (var nD = 0; acc[k2 + 1] >= 1 && nD < ACC_CAP; nD++) {
      acc[k2 + 1] -= 1;
      var B = M4.pt(M, T.wl0 + rgW(1, 8), T.cy + gsW() * T.bowHalf * 0.25, zc), hb = seaH(B[0], B[2], SIMT);
      wsAdd(B[0], hb + 0.05, B[2], gsW() * 0.4, rgW(0.5, 1.6), gsW() * 0.4, rgW(0.8, 1.4), rgW(0.2, 0.35), 0.5);
    }
    accFix(acc, k2 + 1, 1, '船尾水滴');
  }
  // 沉的時候：船殼一圈冒氣、翻大片白沫（往下壓的拍浪由上面那一圈照垂直速度算）
  if (sh.sinkingFinal && sh.sink < 30) {
    WP_SRC = 'sink';
    acc[k2 + 2] += (2 + sh.sinkV * 6) * L.k * dt;
    for (var nE = 0; acc[k2 + 2] >= 1 && nE < ACC_CAP; nE++) {
      acc[k2 + 2] -= 1;
      var g = (rndW() * WP_RING * 2) | 0, gr = g * 4, C = M4.pt(M, R[gr] - R[gr + 2] * rgW(2, 40), R[gr + 1] - R[gr + 3] * rgW(2, 40), zc), hc = seaH(C[0], C[2], SIMT);
      for (var b = 0; b < 14 * L.k; b++) wsAdd(C[0] + gsW() * 0.6, hc + 0.05, C[2] + gsW() * 0.6, gsW() * 0.8, rgW(1.5, 5), gsW() * 0.8, rgW(0.8, 1.8), rgW(0.25, 0.5), 0.6);
      wfAdd(C[0], C[2], gsW() * 0.4, gsW() * 0.4, rgW(14, 24), rgW(1.5, 2.5), rgW(4, 7), 0.75, gsW() * 0.4);
    }
    accFix(acc, k2 + 2, 1, '沉船冒氣');
  }
}
/** 砲彈、碎片、落水的人（12_effects.js splash）：一圈冠狀的水滴、大的再一柱往上衝、落點一圈白沫。 */
function wpSplash(p, big) {
  var L = wpLv(); if (!L) return;
  var h = seaH(p[0], p[2], SIMT), n = (big ? 70 : 28) * L.k, i, a, r, u; WP_SRC = 'splash';
  for (i = 0; i < n; i++) {
    a = rndW() * 6.2832; r = rgW(0.2, 0.6) * (big ? 1.6 : 1); u = rgW(1.2, 3.5) * (big ? 1.4 : 1);
    wsAdd(p[0] + Math.cos(a) * r, h + 0.05, p[2] + Math.sin(a) * r, Math.cos(a) * u, rgW(3, big ? 11 : 7), Math.sin(a) * u, rgW(1.0, 2.4), rgW(0.15, 0.32) * (big ? 1.4 : 1), 0.75);
  }
  if (big) for (i = 0; i < 30 * L.k; i++) wsAdd(p[0] + gsW() * 0.25, h + 0.1, p[2] + gsW() * 0.25, gsW() * 0.6, rgW(7, 17), gsW() * 0.6, rgW(2, 3.5), rgW(0.3, 0.6), 0.8);
  for (i = 0; i < (big ? 14 : 6) * L.k; i++) { a = rndW() * 6.2832; u = rgW(0.6, 1.8); wfAdd(p[0] + Math.cos(a) * 0.5, p[2] + Math.sin(a) * 0.5, Math.cos(a) * u, Math.sin(a) * u, rgW(8, 14), rgW(0.8, 1.4), rgW(2.2, 3.4), 0.75, 0); }
}
/** 碎木落水（12_effects.js stepDebris）：幾滴、偶爾一小片白沫。 */
function wpDrop(x, z) {
  var L = wpLv(); if (!L || rndW() > 0.35 * L.k) return;
  var h = seaH(x, z, SIMT); WP_SRC = 'drop';
  for (var i = 0; i < 3; i++) wsAdd(x, h + 0.03, z, gsW() * 0.5, rgW(1, 3), gsW() * 0.5, rgW(0.5, 0.9), rgW(0.08, 0.15), 0.6);
  if (rndW() < 0.3) wfAdd(x, z, 0, 0, rgW(3, 5), 0.3, 0.8, 0.5, 0);
}
/** 艙內的水從破口往外流（33_flood.js，粒子模式）：洞口往外噴幾滴（量照每秒流出幾 m³）。只給人看。 */
function waterPour(P, out, rate) {
  var L = wpLv(); if (!L) return;
  var ol = Math.hypot(out[0], out[2]) || 1, n = Math.min(6, rate * 2) * L.k; WP_SRC = 'pour';
  for (var i = 0; i < n; i++) { var u = rgW(1, 3); wsAdd(P[0], P[1], P[2], out[0] / ol * u + gsW() * 0.3, rgW(-0.5, 0.8), out[2] / ol * u + gsW() * 0.3, rgW(0.8, 1.4), rgW(0.15, 0.3), 0.7); }
}
/** 擦撞（31_sailing.js collide，貼著的每一步）：兩艘之間往上、往兩舷噴，量照相對速度。 */
function waterBump(pa, pb, A, B) {
  var L = wpLv(); if (!L) return;
  var rel = Math.hypot(A.vel[0] - B.vel[0], A.vel[2] - B.vel[2]), tx = pb[2] - pa[2], tz = pa[0] - pb[0], tl = Math.hypot(tx, tz) || 1, mx = (pa[0] + pb[0]) / 2, mz = (pa[2] + pb[2]) / 2;
  tx /= tl; tz /= tl; WP_SRC = 'bump';
  A.wpBumpAcc = (A.wpBumpAcc || 0) + (40 + 60 * rel) * L.k * DT;
  for (var nF = 0; A.wpBumpAcc >= 1 && nF < ACC_CAP; nF++) {
    A.wpBumpAcc -= 1;
    var s = gsW() * 4, x = mx + tx * s, z = mz + tz * s, h = seaH(x, z, SIMT), side = rndW() < 0.5 ? -1 : 1, o = rgW(1, 3) * (0.5 + rel);
    wsAdd(x, h + 0.05, z, (pa[0] - pb[0]) / 14 * side * o + gsW() * 0.5, rgW(2, 6) * (0.6 + 0.5 * rel), (pa[2] - pb[2]) / 14 * side * o + gsW() * 0.5, rgW(1.2, 2.2), rgW(0.2, 0.4), 0.7);
    if (rndW() < 0.2) wfAdd(x, z, gsW() * 0.4, gsW() * 0.4, rgW(10, 16), 1.0, 3.0, 0.7, gsW() * 0.5);
  }
  accFix(A, 'wpBumpAcc', 1, '擦撞水花');
}

// ── 畫：白沫是貼著浪的一片（5×5 頂點、每個頂點照 seaHs 起伏，跟海面網格同一個間距）；水滴跟粒子一起畫（點精靈，60_render.js） ──
function wpGL() {
  var N = 4, V = [], I = [], i, j;
  for (j = 0; j <= N; j++) for (i = 0; i <= N; i++) V.push(i / N * 2 - 1, j / N * 2 - 1);
  for (j = 0; j < N; j++) for (i = 0; i < N; i++) { var a = j * (N + 1) + i; I.push(a, a + 1, a + N + 2, a, a + N + 2, a + N + 1); }
  FOAMG = { vao: gl.createVertexArray(), ib: null, inst: gl.createBuffer(), n: I.length };
  gl.bindVertexArray(FOAMG.vao);
  var vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(V), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
  FOAMG.ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, FOAMG.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(I), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, FOAMG.inst); gl.bufferData(gl.ARRAY_BUFFER, WFBUF.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(2, 1);
  gl.bindVertexArray(null);
  // 片段：兩層雜訊 × 圓的邊 ⇒ 一塊一塊的白沫；越舊門檻越高 ⇒ 散成細條。亮度照陽光與陰影（暴風雨暗），霧照距離。船艙裡的丟掉（跟海同一份遮罩）
  P.foam = VK.compile(gl,
    '#version 300 es\nlayout(location=0) in vec2 aQ; layout(location=1) in vec4 iA; layout(location=2) in vec4 iB; uniform mat4 uVP; uniform vec2 uC, uSG;\n' + SEA_GLSL +
    'out vec2 vQ; out vec3 vW; out float vA; out float vS;\n' +
    'void main(){ float c=cos(iA.w), s=sin(iA.w); vec2 p=iA.xy+vec2(c*aQ.x-s*aQ.y, s*aQ.x+c*aQ.y)*iA.z; float r=length(p-uC);\n' +
    ' float h=seaHs(p,max(uSG.x,r*uSG.y))*(1.0-smoothstep(900.0,1600.0,r)); vW=vec3(p.x,h+0.06,p.y); vQ=aQ; vA=iB.x; vS=iB.y; gl_Position=uVP*vec4(vW,1.0); }\n',
    '#version 300 es\nprecision highp float; in vec2 vQ; in vec3 vW; in float vA; in float vS; uniform vec3 uEye,uFog; uniform float uFogD; out vec4 o;\n' + SHADOW_GLSL + HULL_GLSL +
    'float hs1(float n){ return fract(sin(n*12.9898)*43758.5453); }\n' +
    'float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); float a=hs1(dot(i,vec2(1.0,57.0))), b=hs1(dot(i+vec2(1.0,0.0),vec2(1.0,57.0))), c=hs1(dot(i+vec2(0.0,1.0),vec2(1.0,57.0))), d=hs1(dot(i+vec2(1.0,1.0),vec2(1.0,57.0))); return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }\n' +
    'void main(){ if(' + HULL_HIT + ') discard;\n' +
    ' float m=(vn(vQ*1.7+vS)*0.65+vn(vQ*4.3+vS*1.7+3.1)*0.35)*(1.0-smoothstep(0.45,1.0,length(vQ))); float th=mix(0.62,0.22,vA);\n' +
    ' float a=smoothstep(th,th+0.12,m)*(0.35+0.65*vA); if(a<0.01) discard;\n' +
    ' vec3 col=vec3(0.84,0.88,0.9)*(0.55+0.45*shadowK(vW,vec3(0.0,1.0,0.0))); float fd=length(vW-uEye); o=vec4(mix(col,uFog,1.0-exp(-fd*uFogD)),a*0.9); }\n');
}
/** 畫白沫（海之後、粒子之前；不寫深度、往鏡頭拉一點免得跟海面打架）。hullU：船艙遮罩的 uniform（60_render.js，跟海同一份）。 */
function wpDrawFoam(hullU) {
  if (!WF.n || !P.foam || WP_HIDE) return;                               // WP_HIDE：量繪製成本用（__game.water({ hide: true })）
  var n = 0;
  for (var i = 0; i < WF.n; i++) {
    var f = WF.life[i] / WF.max[i], k = n * 8;
    WFBUF[k] = WF.p[i * 2]; WFBUF[k + 1] = WF.p[i * 2 + 1]; WFBUF[k + 2] = WF.s1[i] + (WF.s0[i] - WF.s1[i]) * f; WFBUF[k + 3] = WF.rot[i];
    WFBUF[k + 4] = WF.a[i] * Math.min(1, f * 2.5) * Math.min(1, (1 - f) * 12 + 0.3); WFBUF[k + 5] = WF.seed[i]; n++;
  }
  gl.useProgram(P.foam.prog); setCommon(P.foam); hullU(P.foam);
  var Lv = SEA_LV[GFX.sea];
  gl.uniform2f(P.foam.u.uC, Math.round(CAM.eye[0] / SEAG.snap) * SEAG.snap, Math.round(CAM.eye[2] / SEAG.snap) * SEAG.snap); gl.uniform2f(P.foam.u.uSG, Lv.min, 2 * Math.PI / Lv.seg);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -8); gl.disable(gl.CULL_FACE);
  gl.bindVertexArray(FOAMG.vao); gl.bindBuffer(gl.ARRAY_BUFFER, FOAMG.inst); gl.bufferSubData(gl.ARRAY_BUFFER, 0, WFBUF, 0, n * 8);
  gl.drawElementsInstanced(gl.TRIANGLES, FOAMG.n, gl.UNSIGNED_SHORT, 0, n);
  gl.disable(gl.POLYGON_OFFSET_FILL); gl.depthMask(true);
}
/** 水滴放進點精靈的緩衝（60_render.js 的 pushPt）：天暗的時候跟著暗。 */
function wpPushSpray(pushPt) {
  if (!WS.n || WP_HIDE) return;
  var b = 0.55 + 0.45 * wxSun(), c = [0.9 * b, 0.94 * b, 0.98 * b];
  for (var i = 0; i < WS.n; i++) { var f = WS.life[i] / WS.max[i]; pushPt([WS.p[i * 3], WS.p[i * 3 + 1], WS.p[i * 3 + 2]], WS.s[i] * (1.3 - 0.3 * f), c, WS.a[i] * Math.min(1, f * 3), -1); }
}
// 訂閱（TASK-0669：模擬層只發事件，00_events.js）
evOn('wpPour', waterPour, 0, true); evOn('wpBump', waterBump, 0, true); evOn('ptMute', function (on) { PT_MUTE = !!on; }, 0, true);
evOn('viewStep', stepWater, 3, true);                              // 粒子之後（12_effects.js stepPts order 2）—— 跟拆之前 step() 裡的順序一樣
evOn('viewStepSlow', function (dt) { stepWater(dt, 'ship'); }, 0, true);   // 殉爆慢動作中：這裡只生船邊的水花（其餘照畫面的時間走，73_slowmo.js slowVisStep）
