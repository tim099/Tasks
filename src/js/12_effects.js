// ───────────────────────── 碎片（每格一顆小方塊，GPU instancing） ─────────────────────────
var DMAX = 45000, D = {
  n: 0, p: new Float32Array(DMAX * 3), v: new Float32Array(DMAX * 3), q: new Float32Array(DMAX * 4), w: new Float32Array(DMAX * 3),
  life: new Float32Array(DMAX), size: new Float32Array(DMAX), col: new Uint8Array(DMAX), st: new Uint8Array(DMAX), ship: new Int8Array(DMAX), sh: new Uint8Array(DMAX)
};
// 形狀 D.sh：0 ＝ 一格的小方塊；1–3 ＝ 片狀的碎塊（木板被撕下來的那種，Tim 2026-10-14）—— 長寬厚的比例在著色器（01_gl.js DEB_SHAPES），飄得慢（DEB_FLUT）、落在甲板上貼得低。
// 上限（Tim 2026-10-14）：畫質頁的「碎片上限」DEB_CAP（不跟低／中／高走）；超過 ⇒ debCull 先清視野外、遠處、沉在水裡的（照畫面的鏡頭；只影響畫面）。DMAX 是陣列的硬上限。
var DEB_FLUT = 0.9, DEB_THIN = [1, 0.22, 0.22, 0.25];
var DINST = new Float32Array(DMAX * 9);
var DEB_ACC = 0, PT_ACC = 0;   // DEB_ACC／PT_ACC：照分級少生的節拍（不抽亂數）
// 煙、火光、水花自己的亂數（TASK-0669）：以前抽戰局的 rr／gauss ⇒ 少放一團煙（調粒子數、不開畫面）後面的戰局全部錯位；開局一起重設（rngReset）
var RNG_X = rngMake('fx', 0x5BD1E995), rndX = RNG_X.f, rrX = RNG_X.r, gaussX = RNG_X.g;   // 00_core.js 亂數工廠
function fxDebris(p, v, col, size, life, shape) {
  var k = DEB_KS[PHX.debris]; if (k < 1) { DEB_ACC += k; if (DEB_ACC < 1) return; DEB_ACC -= 1; }   // 物理分級：少生幾顆（呼叫端的亂數已經抽完 ⇒ 戰局不變）
  var i;
  if (D.n < DMAX) i = D.n++;
  else { i = (rndD() * DMAX) | 0; }     // 滿了 ⇒ 隨便頂掉一顆（只影響畫面，不影響模擬判定）
  D.p[i * 3] = p[0]; D.p[i * 3 + 1] = p[1]; D.p[i * 3 + 2] = p[2];
  D.v[i * 3] = v[0]; D.v[i * 3 + 1] = v[1]; D.v[i * 3 + 2] = v[2];
  var ax = norm([rndD() - 0.5, rndD() - 0.5, rndD() - 0.5]), sp = 4 + 14 * rndD();
  D.w[i * 3] = ax[0] * sp; D.w[i * 3 + 1] = ax[1] * sp; D.w[i * 3 + 2] = ax[2] * sp;
  D.q[i * 4] = 0; D.q[i * 4 + 1] = 0; D.q[i * 4 + 2] = 0; D.q[i * 4 + 3] = 1;
  D.life[i] = life; D.size[i] = size; D.col[i] = col; D.st[i] = 1; D.ship[i] = -1; D.sh[i] = shape || 0;
}
/** 片狀的碎塊：從 removed（x, y, z, 色 一組四個，格座標）挑幾格當起點，往 vd（世界的單位向量）噴；數量照打掉的格數（每 per 格一片、最多 max 片）。
 *  只抽碎木自己的亂數 rndD ⇒ 戰局不變；物理分級少生照 spawnDebris。 */
function fxPlates(sh, removed, vd, sp, per, max, M) {                 // M：removed 的格座標換到世界（沒給 ＝ sh.M；砲帶的裝甲給它轉過的那個，24_armor.js）
  var m = removed.length / 4, k = Math.min(max, Math.floor(m / per));
  for (var j = 0; j < k; j++) {
    var q = ((rndD() * m) | 0) * 4, w = M4.pt(M || sh.M, removed[q] + 0.5, removed[q + 1] + 0.5, removed[q + 2] + 0.5);
    var v = add(add(mul(vd, sp * rD(0.05, 0.25)), [rD(-4, 4), rD(1.5, 7), rD(-4, 4)]), sh.vel);
    fxDebris(w, v, removed[q + 3], rD(0.12, 0.22), rD(10, 18), 1 + ((rndD() * 3) | 0));
  }
}
/** 超過上限 ⇒ 清到 DEB_CAP 的九成：分數 ＝ 離鏡頭的距離 ×（視野外 4）＋ 沉在水裡的 +1e4（最先清）；取樣找門檻，分數比門檻高的都清掉（不抽亂數）。
 *  鏡頭還沒算過（快轉、無頭對拍）⇒ 照剩下的壽命（快散的先清）。 */
var DSCORE = new Float32Array(DMAX), DSAMP = new Float32Array(1024);
function debCull() {
  var n = D.n, want = Math.floor(DEB_CAP * 0.9); if (n <= want) return;
  var vp = CAM.vp, e = CAM.eye, i, o;
  for (i = 0; i < n; i++) {
    o = i * 3; var x = D.p[o], y = D.p[o + 1], z = D.p[o + 2];
    if (D.st[i] === 2) { var hs = SHIPS[D.ship[i]]; if (hs) { var wp = M4.pt(hs.M, x, y, z); x = wp[0]; y = wp[1]; z = wp[2]; } }
    if (!vp || !e) { DSCORE[i] = -D.life[i]; continue; }
    var d = Math.hypot(x - e[0], y - e[1], z - e[2]), cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15], vis = false;
    if (cw > 0.1) { var cx = (vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / cw, cy = (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / cw; vis = cx > -1.1 && cx < 1.1 && cy > -1.1 && cy < 1.1; }
    DSCORE[i] = d * (vis ? 1 : 4) + (D.st[i] === 3 ? 1e4 : 0);
  }
  var ns = Math.min(1024, n), step = n / ns;
  for (i = 0; i < ns; i++) DSAMP[i] = DSCORE[Math.floor(i * step)];
  var S = DSAMP.subarray(0, ns).sort(), th = S[Math.min(ns - 1, Math.max(0, Math.floor(ns * want / n)))];
  for (i = n - 1; i >= 0; i--) if (DSCORE[i] > th) fxKill(i);           // 由後往前：kill 把最後一顆搬來 i，那顆已經看過、留著
  if (D.n > want) for (i = D.n - 1; i >= 0 && D.n > want; i--) if (DSCORE[i] >= th) fxKill(i);   // 同分很多（全在水裡）⇒ 再清一輪
}
/** 碎木每一步：飛、轉、落水、落在甲板上。
 *  省時間（TASK-0531：殉爆噴一萬多顆，每步 10 ms 以上）：比最高的浪還高 ⇒ 不算 seaH；不在那艘船的格子外接球裡（格子盒的中心＋半對角線）⇒ 不換格座標查格子。結果跟全算一樣。 */
function stepDebris(dt) {
  if (D.n > DEB_CAP) debCull();                                          // 碎片上限（畫質頁）
  var top = SEA_K > 0 ? 1.15 * SEA_K * WX.sea : 0, sc = SHIPS.map(function (sh) { var B = sh.T.base; return { c: M4.pt(sh.M, B.sx / 2, B.sy / 2, B.sz / 2), r2: Math.pow(0.5 * S * Math.hypot(B.sx, B.sy, B.sz) + 1, 2) }; });
  for (var i = 0; i < D.n; i++) {
    var st = D.st[i]; if (!st) continue;
    D.life[i] -= dt;
    if (D.life[i] <= 0) { fxKill(i); i--; continue; }
    var o = i * 3;
    if (st === 2) {                                            // 落在甲板上：跟著船（座標存的是格座標）；底下那一格沒了 ⇒ 重新掉
      var hs = SHIPS[D.ship[i]];
      if (hs.grid.get(D.p[o] | 0, D.p[o + 1] | 0, (D.p[o + 2] | 0) - 1)) continue;
      var wp = M4.pt(hs.M, D.p[o], D.p[o + 1], D.p[o + 2]);
      D.p[o] = wp[0]; D.p[o + 1] = wp[1]; D.p[o + 2] = wp[2]; D.v[o] = D.v[o + 1] = D.v[o + 2] = 0; D.st[i] = st = 1;
    }
    if (st === 1) { D.v[o + 1] -= G * dt; var fk = D.sh[i] ? DEB_FLUT : 0.15; D.v[o] *= 1 - fk * dt; D.v[o + 2] *= 1 - fk * dt; if (D.sh[i]) D.v[o + 1] *= 1 - 0.35 * dt; }   // 片狀的：空氣阻力大、飄
    D.p[o] += D.v[o] * dt; D.p[o + 1] += D.v[o + 1] * dt; D.p[o + 2] += D.v[o + 2] * dt;
    // 轉
    var qi = i * 4, qx = D.q[qi], qy = D.q[qi + 1], qz = D.q[qi + 2], qw = D.q[qi + 3], wx = D.w[o] * dt * 0.5, wy = D.w[o + 1] * dt * 0.5, wz = D.w[o + 2] * dt * 0.5;
    var nx = qx + wx * qw + wy * qz - wz * qy, ny = qy + wy * qw + wz * qx - wx * qz, nz = qz + wz * qw + wx * qy - wy * qx, nw = qw - wx * qx - wy * qy - wz * qz, l = Math.hypot(nx, ny, nz, nw);
    D.q[qi] = nx / l; D.q[qi + 1] = ny / l; D.q[qi + 2] = nz / l; D.q[qi + 3] = nw / l;
    if (st === 1) {
      if (D.p[o + 1] < top && D.p[o + 1] < seaH(D.p[o], D.p[o + 2], SIMT)) {               // 落水：慢慢沉
        D.st[i] = 3; D.v[o] *= 0.1; D.v[o + 1] = -0.25; D.v[o + 2] *= 0.1; D.life[i] = Math.min(D.life[i], 4);
        if (rndD() < 0.04) fxPt(add([D.p[o], 0.05, D.p[o + 2]], [0, 0, 0]), [0, 1.5, 0], 0.5, [0.9, 0.95, 1], 0.6, 0.6, 0, 1);
        wpDrop(D.p[o], D.p[o + 2]);                                     // 船邊水花（13_water.js）：幾滴、偶爾一小片白沫
        continue;
      }
      if (D.v[o + 1] < 0) for (var s = 0; s < SHIPS.length; s++) {       // 掉到甲板上 ⇒ 停住
        var q = sc[s], ex = D.p[o] - q.c[0], ey = D.p[o + 1] - q.c[1], ez = D.p[o + 2] - q.c[2]; if (ex * ex + ey * ey + ez * ez > q.r2) continue;
        var sh = SHIPS[s], L = M4.pt(sh.inv, D.p[o], D.p[o + 1], D.p[o + 2]);
        if (L[0] < 0 || L[2] < 0 || L[0] >= sh.grid.sx) continue;
        if (sh.grid.get(L[0] | 0, L[1] | 0, L[2] | 0)) {
          D.st[i] = 2; D.ship[i] = s; D.p[o] = L[0]; D.p[o + 1] = L[1]; D.p[o + 2] = Math.floor(L[2]) + 1.0 + D.size[i] * 5 * DEB_THIN[D.sh[i]];
          D.life[i] = Math.min(D.life[i], 25 + 20 * rndD()); break;
        }
      }
    }
  }
}
function fxKill(i) {
  var j = D.n - 1;
  if (i !== j) {
    D.p.copyWithin(i * 3, j * 3, j * 3 + 3); D.v.copyWithin(i * 3, j * 3, j * 3 + 3); D.w.copyWithin(i * 3, j * 3, j * 3 + 3); D.q.copyWithin(i * 4, j * 4, j * 4 + 4);
    D.life[i] = D.life[j]; D.size[i] = D.size[j]; D.col[i] = D.col[j]; D.st[i] = D.st[j]; D.ship[i] = D.ship[j]; D.sh[i] = D.sh[j];
  }
  D.st[j] = 0; D.n--;
}

// ───────────────────────── 粒子（煙、水花、火光、砲彈） ─────────────────────────
var PMAX = 12000, PT = { n: 0, p: new Float32Array(PMAX * 3), v: new Float32Array(PMAX * 3), life: new Float32Array(PMAX), max: new Float32Array(PMAX),
  s0: new Float32Array(PMAX), s1: new Float32Array(PMAX), c: new Float32Array(PMAX * 3), a: new Float32Array(PMAX), grav: new Float32Array(PMAX), drag: new Float32Array(PMAX), ty: new Float32Array(PMAX) };
var PBUF = new Float32Array(PMAX * 9);
function fxPt(p, v, life, col, a, s0, s1, grav, drag, ty) {
  if (PT_MUTE) return;                               // 船邊水花開著：原本的航跡與水花不放（呼叫端的亂數照樣抽完，13_water.js）
  var k = FX_KS[PHX.fx]; if (k < 1) { PT_ACC += k; if (PT_ACC < 1) return; PT_ACC -= 1; }   // 物理分級：少生幾顆（參數的亂數呼叫端已經抽完）
  if (PT.n >= PMAX) return;
  var i = PT.n++;
  PT.p[i * 3] = p[0]; PT.p[i * 3 + 1] = p[1]; PT.p[i * 3 + 2] = p[2]; PT.v[i * 3] = v[0]; PT.v[i * 3 + 1] = v[1]; PT.v[i * 3 + 2] = v[2];
  PT.life[i] = PT.max[i] = life; PT.c[i * 3] = col[0]; PT.c[i * 3 + 1] = col[1]; PT.c[i * 3 + 2] = col[2]; PT.a[i] = a; PT.s0[i] = s0; PT.s1[i] = s1; PT.grav[i] = grav || 0; PT.drag[i] = drag || 0;
  PT.ty[i] = (ty || 0) * 4 + ((i * 7) & 3);         // 類型 × 4 ＋ 變體
}
function stepPts(dt) {
  for (var i = 0; i < PT.n; i++) {
    PT.life[i] -= dt;
    if (PT.life[i] <= 0) {
      var j = --PT.n;
      if (i !== j) { PT.p.copyWithin(i * 3, j * 3, j * 3 + 3); PT.v.copyWithin(i * 3, j * 3, j * 3 + 3); PT.c.copyWithin(i * 3, j * 3, j * 3 + 3);
        PT.life[i] = PT.life[j]; PT.max[i] = PT.max[j]; PT.a[i] = PT.a[j]; PT.s0[i] = PT.s0[j]; PT.s1[i] = PT.s1[j]; PT.grav[i] = PT.grav[j]; PT.drag[i] = PT.drag[j]; PT.ty[i] = PT.ty[j]; }
      i--; continue;
    }
    var o = i * 3, k = 1 - PT.drag[i] * dt;
    PT.v[o] = PT.v[o] * k + WIND[0] * WX.wind * PT.drag[i] * dt; PT.v[o + 1] = PT.v[o + 1] * k - PT.grav[i] * dt; PT.v[o + 2] = PT.v[o + 2] * k + WIND[2] * WX.wind * PT.drag[i] * dt;   // 天氣：暴風雨煙飄得快
    PT.p[o] += PT.v[o] * dt; PT.p[o + 1] += PT.v[o + 1] * dt; PT.p[o + 2] += PT.v[o + 2] * dt;
    if (PT.grav[i] > 0 && PT.p[o + 1] < 0) PT.life[i] = Math.min(PT.life[i], 0.05);
  }
}
function fxSmoke(p, dir, n, big) {
  for (var i = 0; i < n; i++) {
    var v = add(mul(dir, rrX(2, big ? 9 : 14)), [gaussX() * 1.2, rrX(0.3, 1.6), gaussX() * 1.2]);
    var g = rrX(0.62, 0.86);
    // 2.5–5.5 秒就散：齊射的煙不要一直擋著看砲彈落點；÷ 畫質頁的「煙消散」倍數（07_gfx.js smokeK）
    fxPt(add(p, mul(dir, rrX(0, 2))), v, rrX(2.5, 5.5) / smokeK(), [g, g, g * 0.98], rrX(0.35, 0.55), rrX(1.2, 2.2) * (big ? 1.6 : 1), rrX(6, 11) * (big ? 1.5 : 1), -0.05, 1.1, 0);
  }
}
function fxFlash(p, dir, n, big) {
  for (var i = 0; i < n; i++) fxPt(p, add(mul(dir, rrX(5, 30)), [gaussX() * 3, gaussX() * 3, gaussX() * 3]), rrX(0.08, 0.22), [1, rrX(0.6, 0.85), 0.3], 1, rrX(1, 2.5) * (big ? 2 : 1), 0.3, 0, 4, 1);
}
function fxSplash(p, big) {
  PT_MUTE = PHX.water > 0;                         // 船邊水花開著（13_water.js）：下面這些照樣抽亂數、不放進去，換成 wpSplash
  var n = big ? 60 : 26;
  for (var i = 0; i < n; i++) fxPt([p[0] + gaussX() * 0.6, 0.1, p[2] + gaussX() * 0.6], [gaussX() * 1.6, rrX(4, big ? 14 : 10), gaussX() * 1.6], rrX(0.8, 1.8), [0.92, 0.96, 1], 0.75, rrX(0.4, 1.0), rrX(0.8, 1.6), G, 0.3, 2);
  for (i = 0; i < 10; i++) fxPt([p[0] + gaussX() * 1.5, 0.15, p[2] + gaussX() * 1.5], [gaussX() * 0.4, 0.2, gaussX() * 0.4], rrX(1.5, 3), [0.95, 0.97, 1], 0.35, 1.5, 4, 0, 0.5, 2);
  PT_MUTE = false; wpSplash(p, big);
  sfx('splash', p, big ? 1.2 : 0.7);
}
// 訂閱（TASK-0669：模擬層只發事件，00_events.js）
evOn('debris', fxDebris, 0, true); evOn('plates', fxPlates, 0, true); evOn('pt', fxPt, 0, true); evOn('smoke', fxSmoke, 0, true); evOn('flash', fxFlash, 0, true); evOn('splash', fxSplash, 0, true);
evOn('viewStep', stepDebris, 0, true); evOn('viewStep', stepPts, 2, true);   // 每一步：碎木先、煙囪排煙（78_funnel.js，order 1）、粒子最後 —— 跟拆之前 step() 裡的順序一樣
