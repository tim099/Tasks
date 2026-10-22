// ───────────────────────── 著火的演出（TASK-0717） ─────────────────────────
// Tim 2026-10-18：「可以趁現在空檔 加一下著火效果(希臘火可以讓木材起火) 火會延燒 然後船員會去滅火」「帆也可以燒起來(可以嘗試真的燒掉帆的演出 出現邊緣焦黑以及逐漸燒掉)」
// 只給人看：無頭不訂閱、⛔ 不碰 rnd()（自己的亂數 rngMake('firefx')）、只讀 sh.burn／s.burn（模擬在 49_burn.js）。累加值記在 sh.bfx（⛔ 模擬不讀）。
//   · 火焰：燒著的格隨機挑（每秒 BFX_RATE × √格數；照鏡頭距離減量，BFX_NEAR 公尺內全量、BFX_FAR 外剩 6%；全場每一步最多 BFX_CAP 顆）。
//   · 黑煙：每個火場一柱（BFX_SMOKE × √格數／秒，往上翻、順風飄）；有人在潑水 ⇒ 混白色的水蒸氣；往上竄的火星。
//   · 帆：燒口那一圈（a ≤ 現在 < a + sailBurn、還沒撲滅）冒火焰：每面帆每一步抽 BFX_SAIL 點看（物理開著照布現在的位置、關著照作品的形狀）。
//     帆的焦黃、焦黑的邊、燒穿的洞在著色器（01_gl.js BURN_GLSL；11_rig_gpu.js 每個頂點帶 a、x）。
//   · 潑水：站在火邊的水手每 1.2–1.8 秒往火場潑一桶（水花的拋物線）；手上提水桶、彎腰潑（41_crew_art.js）。
//   · 燒穿的格（burnAsh 事件）：一撮灰燼＋火星。
//   · 火光（60_render.js lampsUpdate 叫 burnLamps）：最大的幾個火場當成船殼上的燈（sh.vlamps：燒著的格 ＝ 色碼 BURN_EMBER 發光，01_gl.js voxFS）＋光暈（lanternHalo，ha 縮小）＋點光源；燒著的帆一盞點光源。
// 殉爆慢動作（73_slowmo.js slowVisStep）不推這裡（跟煙囪排煙一樣停住）。
var RNG_FIX = rngMake('firefx', 0x6A09E667), rndFfx = RNG_FIX.f, rgFfx = RNG_FIX.r;
var BFX_RATE = 6, BFX_SMOKE = 0.8, BFX_NEAR = 60, BFX_FAR = 450, BFX_CAP = 400, BFX_SAIL = 6;
var BFX_TOSS = new WeakMap();                                          // 每個救火的水手下一桶什麼時候潑（模擬時間）
/** 每一步（viewStep，跟煙囪排煙同一個順序 1）：每艘在燒的船。 */
function burnFx(dt) {
  var E = CAM.eye, cap = { n: BFX_CAP };
  SHIPS.forEach(function (sh) {
    var B = sh.burn; if (!B || sh.sink > 40) return;
    var V = sh.bfx || (sh.bfx = { f: 0, s: new Map() });
    var d = E ? Math.hypot(sh.center[0] - E[0], sh.center[1] - E[1], sh.center[2] - E[2]) : BFX_NEAR, lod = d < BFX_NEAR ? 1 : d > BFX_FAR ? 0.06 : BFX_NEAR / d;
    if (B.n) {                                                         // 火焰：隨機挑燒著的格
      V.f += BFX_RATE * Math.sqrt(B.n) * lod * dt;
      while (V.f >= 1 && cap.n > 0) {
        V.f -= 1; cap.n--;
        var i = (rndFfx() * B.n) | 0, p = B.p[i], h = B.h[i], hot = rndFfx();
        var w = M4.pt(sh.M, (p & 2047) + rndFfx(), ((p >> 11) & 1023) + rndFfx(), (p >> 21) + 1);
        fxPt(w, [sh.vel[0] + rgFfx(-0.3, 0.3), rgFfx(1.2, 2.8) * (0.6 + 0.4 * h), sh.vel[2] + rgFfx(-0.3, 0.3)], rgFfx(0.35, 0.8), [1, 0.3 + 0.5 * hot, 0.04 + 0.2 * hot], 1,
          rgFfx(0.25, 0.5) * (0.6 + h), rgFfx(0.8, 1.6) * (0.6 + h), -2, 0.35, 1);
      }
      if (V.f >= 1) V.f = 0;                                           // 全場上限到了 ⇒ 剩下的不補（⛔ 一直累加 ⇒ 下一格一次噴一大團）
    } else V.f = 0;
    var S2 = new Map();                                                // 黑煙：每個火場一柱（累加值照火場；熄了的不留）
    B.spots.forEach(function (sp) {
      if (sp.sail || !sp.c) return;
      var a = (V.s.get(sp.key) || 0) + BFX_SMOKE * Math.sqrt(sp.n) * lod * dt, w = null, big = 1 + Math.sqrt(sp.n) / 30;
      while (a >= 1 && cap.n > 0) {
        a -= 1; cap.n--;
        w = w || M4.pt(sh.M, sp.c[0] + 0.5, sp.c[1] + 0.5, sp.c[2] + 3);
        var v = [sh.vel[0] * 0.3 + WIND[0] * 0.4 + rgFfx(-0.5, 0.5), rgFfx(2, 3.5), sh.vel[2] * 0.3 + WIND[2] * 0.4 + rgFfx(-0.5, 0.5)], P = [w[0] + rgFfx(-0.6, 0.6), w[1], w[2] + rgFfx(-0.6, 0.6)];
        if (sp.have && rndFfx() < 0.45) { var g0 = rgFfx(0.72, 0.84); fxPt(P, v, rgFfx(2, 4) / smokeK(), [g0, g0, g0 * 1.02], 0.32, rgFfx(0.8, 1.2), rgFfx(3, 5) * big, -0.3, 0.6, 0); }   // 潑水 ⇒ 水蒸氣
        else { var g = rgFfx(0.06, 0.12); fxPt(P, v, rgFfx(6, 10) / smokeK(), [g, g * 0.95, g * 0.92], 0.55, rgFfx(1, 1.6) * big, rgFfx(5, 9) * big, -0.25, 0.6, 0); }
        if (rndFfx() < 0.35) fxPt([P[0], w[1] - 1, P[2]], [sh.vel[0] + rgFfx(-1, 1), rgFfx(2, 5), sh.vel[2] + rgFfx(-1, 1)], rgFfx(0.6, 1.4), [1, rgFfx(0.45, 0.75), 0.12], 1, rgFfx(0.08, 0.15), 0.04, -1.5, 0.8, 3);   // 火星
      }
      S2.set(sp.key, a >= 1 ? 0 : a);
    });
    V.s = S2;
    burnSailFx(sh, lod, cap);
    burnTossFx(sh);
  });
}
/** 帆：燒口那一圈冒火（每面帆抽幾點看；撲滅、燒完的沒有）。掉下來還在燒的照樣冒（物理開著才畫得到）。 */
function burnSailFx(sh, lod, cap) {
  var CL = sh.cl, T = BURN.sailBurn; if (!CL) return;
  sh.sails.forEach(function (s) {
    var F = s.burn, c = CL[s.k]; if (!F || !c || c.gone || s.furled || (!F.lit && !s.dead) || (s.dead && !PHYS)) return;
    var n = c.T.n, P = PHYS && c.p && !c.hidden && c.p.length >= n * 3 ? c.p : c.T.p0, emit = 0;
    for (var k = 0; k < BFX_SAIL * 4 && emit < BFX_SAIL && cap.n > 0; k++) {
      var q = (rndFfx() * n) | 0, pr = (Math.min(SIMT, F.x[q]) - F.a[q]) / T;
      if (!(pr >= 0 && pr < 1 && SIMT < F.x[q]) || rndFfx() > lod) continue;
      emit++; cap.n--;
      var w = M4.pt(sh.M, P[q * 3], P[q * 3 + 1], P[q * 3 + 2]), hot = rndFfx();
      fxPt(w, [sh.vel[0] + rgFfx(-0.3, 0.3), rgFfx(0.8, 2.2), sh.vel[2] + rgFfx(-0.3, 0.3)], rgFfx(0.3, 0.7), [1, 0.35 + 0.45 * hot, 0.05 + 0.15 * hot], 1, rgFfx(0.3, 0.6), rgFfx(0.9, 1.6), -1.5, 0.5, 1);
      if (rndFfx() < 0.25) { var g = rgFfx(0.1, 0.18); fxPt(w, [sh.vel[0] * 0.3 + WIND[0] * 0.4, rgFfx(1.2, 2.4), sh.vel[2] * 0.3 + WIND[2] * 0.4], rgFfx(3, 5) / smokeK(), [g, g * 0.95, g * 0.92], 0.4, rgFfx(0.6, 1), rgFfx(3, 5), -0.2, 0.6, 0); }
    }
  });
}
/** 潑水：站到火邊的水手每 1.2–1.8 秒往火場（帆 ⇒ 帆腳）潑一桶。 */
function burnTossFx(sh) {
  sh.crew.forEach(function (c) {
    var J = c.hand && c.hand.job; if (!J || J.kind !== 'fire' || !J.at || c.st !== 0) return;
    var sp = J.fire; if (!sp || sp.out) return;
    var due = BFX_TOSS.get(c); if (due !== undefined && SIMT < due) return;
    BFX_TOSS.set(c, SIMT + rgFfx(1.2, 1.8)); if (due === undefined) return;   // 剛站到：先等一下再潑
    var bb = sp.sail && sp.sail.bb, to = sp.sail ? M4.pt(sh.M, (bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, bb[2] + 8) : M4.pt(sh.M, sp.c[0] + 0.5, sp.c[1] + 0.5, sp.c[2] + 1);
    var fr = M4.pt(sh.M, c.pos[0], c.pos[1], c.pos[2] + 12), dx = to[0] - fr[0], dy = to[1] - fr[1], dz = to[2] - fr[2], Tf = 0.45 + 0.04 * Math.hypot(dx, dy, dz);
    for (var k = 0; k < 8; k++) {
      var j = rgFfx(0.85, 1.15), T = Tf * j;
      fxPt([fr[0] + rgFfx(-0.1, 0.1), fr[1], fr[2] + rgFfx(-0.1, 0.1)], [sh.vel[0] + dx / T + rgFfx(-0.4, 0.4), dy / T + 4.9 * T, sh.vel[2] + dz / T + rgFfx(-0.4, 0.4)], T * 1.05, [0.72, 0.84, 0.95], 0.8, rgFfx(0.12, 0.2), rgFfx(0.3, 0.5), 9.8, 0.05, 2);
    }
  });
}
/** 燒穿的格（49_burn.js burnThrough）：一撮灰燼、兩點火星（一半的格才放：一次燒穿好幾格）。 */
function burnAshFx(sh, x, y, z) {
  if (sh.sink > 40 || rndFfx() < 0.5) return;
  var w = M4.pt(sh.M, x + 0.5, y + 0.5, z + 0.5);
  fxPt(w, [sh.vel[0] + rgFfx(-0.4, 0.4), rgFfx(0.4, 1.4), sh.vel[2] + rgFfx(-0.4, 0.4)], rgFfx(1.5, 3), [0.08, 0.07, 0.06], 0.8, 0.14, 0.08, 0.6, 1.2, 0);
  for (var k = 0; k < 2; k++) fxPt(w, [sh.vel[0] + rgFfx(-1, 1), rgFfx(1.5, 4), sh.vel[2] + rgFfx(-1, 1)], rgFfx(0.5, 1.2), [1, rgFfx(0.45, 0.75), 0.12], 1, rgFfx(0.08, 0.14), 0.04, -1.2, 0.8, 3);
}
/** 火光（60_render.js lampsUpdate：船殼上的燈篩完之後）：最大的幾個火場加進 sh.vlamps（燒著的格發光、光暈）與點光源 L；燒著的帆各一盞點光源。亮度照模擬時間晃（⛔ 不抽亂數）。 */
function burnLamps(sh, L, E) {
  var B = sh.burn; if (!B) return;
  var H = []; B.spots.forEach(function (sp) { if (!sp.sail && sp.c && sp.n) H.push(sp); });
  H.sort(function (a, b) { return b.n - a.n || a.ord - b.ord; });
  var V = sh.vlamps || (sh.vlamps = []);
  for (var j = 0; j < H.length && j < VLAMP_N; j++) {
    var sp = H[j], f = 0.8 + 0.12 * Math.sin(SIMT * 9.1 + sp.ord * 1.7) + 0.08 * Math.sin(SIMT * 23.3 + sp.ord), at = [sp.c[0] + 0.5, sp.c[1] + 0.5, sp.c[2] + 0.5];
    if (V.length < VLAMP_N) V.push({ at: at, r: Math.min(36, 8 + 2.2 * Math.sqrt(sp.n)), rgb: [f, 0.42 * f, 0.12 * f], color: BURN_EMBER, ha: 0.45 });   // ha：光暈比燈籠小（lanternHalo）
    var w = M4.pt(sh.M, at[0], at[1], at[2] + 4);
    L.push({ w: w, I: 0.8 * f * (1.6 - wxLum()) * Math.min(1, 0.4 + sp.heat), R: Math.min(14, 5 + 0.3 * Math.sqrt(sp.n)), rgb: [1, 0.5, 0.18], d: (w[0] - E[0]) * (w[0] - E[0]) + (w[1] - E[1]) * (w[1] - E[1]) + (w[2] - E[2]) * (w[2] - E[2]) });
  }
  B.sl.forEach(function (s, k) {
    var bb = s.bb, w = M4.pt(sh.M, (bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2), f = 0.85 + 0.15 * Math.sin(SIMT * 11.3 + k * 2.1);
    L.push({ w: w, I: 0.7 * f * (1.6 - wxLum()), R: 10, rgb: [1, 0.5, 0.15], d: (w[0] - E[0]) * (w[0] - E[0]) + (w[1] - E[1]) * (w[1] - E[1]) + (w[2] - E[2]) * (w[2] - E[2]) });
  });
}
// 訂閱（TASK-0669：模擬層只發事件，00_events.js）
evOn('viewStep', burnFx, 1, true); evOn('burnAsh', burnAshFx, 0, true);
