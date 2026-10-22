// ───────────────────────── 車床式的低面數網格（TASK-0795；Tim 2026-10-21） ─────────────────────────
// Tim：「火藥桶 我在想能不能參考金屬用光滑表面節省面數」「那嘗試用 車床式低面數網格搭配平滑法線內插 處理桶子呢(一樣靠meta設定)」。
// 為什麼不是平滑面（15_smooth.js）：surface nets 一個貼著空氣的格面換一個四邊形 ⇒ 火藥桶 3,048 面 ⇒ 6,096 個三角形；匯出的網格已經把同一平面合併成 1,948 個 ⇒ 會變 3 倍。
// 照 meta 選算法（meshAlgo，TASK-0815；Tim 2026-10-22「可以用meta標記要套用哪種算法」）：render=lathe 車床式（這支）、render=pole 長桿式（62_pole.js）、render=shell 外殼式（62_shell.js，TASK-0820）、render=wheel 輪式（62_wheel.js，TASK-0792）；沒標 ⇒ 照原本的方塊網格。
// 哪幾件：模型 meta render=lathe（Tim 2026-10-21「不綁定火藥桶類型(也不用額外檢查) 而是根據模型meta … 跟金屬 玻璃一樣靠meta標記」）⇒ 不看 kind、不看圓不圓：標了就轉。
//   一份網格只要有一個用它的模型、裝飾沒標 ⇒ 那一份照原本的（同一份網格一種畫法）；沒有 meta 的（取用點後加的火藥桶）不算數 ⇒ 跟著同一份網格的走。
// 怎麼做（buildMeshes 建 GPU 那一份時；latheTris）：
//   · 軸：外框三個邊裡，另外兩邊最接近一樣長的那一邊（一樣接近 ⇒ 最長的）；meta lathe_axis=x｜y｜z 可以指定。
//   · 層 ＝ 頂點在軸上的座標切開的每一片。每一層量四個方向（±u、±w）最外面那一片側面離軸多遠，平均 ＝ 那一層的半徑；
//     半徑照前後一層平均一次（一格一階的台階 ⇒ 圓弧）。
//   · 顏色照角度：每一層每一度（LATHE_BINS 格）記最外面那一片的顏色 ⇒ 桶板一條一色、兩色相間也留得住。
//     繞軸幾邊：有好幾色相間的那幾層數一圈換了幾次色（C 條）⇒ 邊數 ＝ C 的倍數（至少 LATHE_N）、邊界對齊換色的地方 ⇒ 一條桶板一邊（或兩邊）；
//     數不出來（單色、太多）⇒ LATHE_N 邊。meta lathe_n 可改（6～48）。每一邊的色 ＝ 那一段角度裡最多的那一色。
//   · 段：哪幾色（佔一成以上的）一樣的層合成一段（桶箍、桶板）；段裡的圈照 LATHE_TOL 簡化（Douglas–Peucker）。
//   · 側面每個頂點自己的法線（徑向＋照半徑的斜率傾斜）⇒ 光照平滑內插；兩端平的蓋子、自己的法線、色照角度。
// ⛔ 只換畫的那一份（GPU 的三角形）：佔格 occ（家具擋格、站位、砲線，10_ship.js／21_gunnery.js／40_crew.js）照原本的網格算 ⇒ 戰局不變。
var LATHE_N = 16, LATHE_TOL = 0.15, LATHE_BINS = 360;
var MESH_ALGOS = { lathe: 1, pole: 1, shell: 1, wheel: 1 };                               // meta render 認得的網格算法
/** 這件模型（或裝飾）標的網格算法：'lathe'／'pole'／'shell'／'wheel'；有 meta 但沒標（或不認得）⇒ ''；沒有 meta ⇒ null（不算數）。 */
function meshAlgoOf(m) { var mt = m && m.meta; if (!mt) return null; return MESH_ALGOS[mt.render] ? mt.render : ''; }
/** 船型 H 的第 k 份網格用哪一種算法：用它的模型、裝飾（有 meta 的）全部標同一種、至少一件 ⇒ { alg, n, ax }
 *  （n：meta lathe_n／wheel_n（0 ＝ 照換色數／照半徑）、ax：meta lathe_axis／wheel_axis（-1 ＝ 照外框）—— 車床式、輪式用）；有一件沒標、標的不一樣 ⇒ null（照原本的）。 */
function meshAlgo(H, k) {
  var alg = null, n = 0, ax = -1, L = (H.rig.models || []).concat(H.decos || []);
  for (var i = 0; i < L.length; i++) {
    if (L[i].mesh !== k) continue;
    var v = meshAlgoOf(L[i]); if (v === null) continue;
    if (!v || (alg && v !== alg)) return null;
    alg = v;
    if (v === 'lathe' || v === 'wheel') { var q = +(L[i].meta[v + '_n']), a = 'xyz'.indexOf(String(L[i].meta[v + '_axis'] || '')); if (q >= (v === 'lathe' ? 6 : 8) && q <= 48) n = Math.round(q); if (a >= 0 && L[i].meta[v + '_axis']) ax = a; }
  }
  return alg ? { alg: alg, n: n, ax: ax } : null;
}
/** 一份網格（verts、tris、tmat、mats）⇒ 車床式的三角形（跟 meshTris 同一種排法：每個頂點 位置 3、法線 3、色 3）；做不出來（沒有三角形、有一層四邊沒碰到側面）⇒ null（照原本的）。
 *  N0：meta 指定的邊數（0 ＝ 照換色數）；A0：meta 指定的軸（-1 ＝ 照外框）。st（給了 ⇒ 填讀數：軸、層、段、邊數、相位）。 */
function latheTris(m, N0, st, A0) {
  var V = m.verts, Tr = m.tris, nv = V.length / 3, i, j, k, t;
  if (!nv || !Tr.length) return null;
  var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (i = 0; i < nv; i++) for (k = 0; k < 3; k++) { var x = V[i * 3 + k]; if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x; }
  var d = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], a = -1, best = Infinity;
  for (k = 0; k < 3; k++) {
    var du = d[(k + 1) % 3], dv = d[(k + 2) % 3], e = Math.abs(du - dv) / Math.max(du, dv, 1e-9);
    if (e < best - 1e-9 || (Math.abs(e - best) <= 1e-9 && d[k] > d[a])) { best = e; a = k; }
  }
  if (A0 >= 0) a = A0;
  var u = (a + 1) % 3, w = (a + 2) % 3, cu = (lo[u] + hi[u]) / 2, cw = (lo[w] + hi[w]) / 2, NB = LATHE_BINS;
  function q4(x) { return Math.round(x * 1e4) / 1e4; }
  function angOf(p) { var g = Math.atan2(p[w] - cw, p[u] - cu) / (2 * Math.PI); return g < 0 ? g + 1 : g; }   // 0..1（一圈）
  var hs = [], seen = {};                                                // 層的邊界 ＝ 頂點在軸上的座標
  for (i = 0; i < nv; i++) { var h = q4(V[i * 3 + a]); if (!seen[h]) { seen[h] = 1; hs.push(h); } }
  hs.sort(function (p, r) { return p - r; });
  var nl = hs.length - 1; if (nl < 1) return null;
  var lix = {}; hs.forEach(function (h, z) { lix[h] = z; });
  var R4 = new Float64Array(nl * 4), BR = new Float64Array(nl * NB), BC = new Int16Array(nl * NB).fill(-1), CB = [new Float64Array(NB * 8), new Float64Array(NB * 8)];   // CB：兩端（軸向的面）每一度每一色的面積（最多 8 色）
  var hm = (lo[a] + hi[a]) / 2;
  for (j = 0; j < Tr.length; j += 3) {
    var P = [V.slice(Tr[j] * 3, Tr[j] * 3 + 3), V.slice(Tr[j + 1] * 3, Tr[j + 1] * 3 + 3), V.slice(Tr[j + 2] * 3, Tr[j + 2] * 3 + 3)], col = m.tmat[j / 3];
    var e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], e2 = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
    var n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], ar = Math.hypot(n[0], n[1], n[2]);
    if (!ar) continue;
    var g0 = angOf(P[0]), g1 = angOf(P[1]), g2 = angOf(P[2]), gm = Math.min(g0, g1, g2), gx = Math.max(g0, g1, g2), wrap = gx - gm > 0.5;   // 這一片跨過的角度（跨過 0 ⇒ 繞回）
    var each = function (f) {
      if (!wrap) { for (var b = Math.floor(gm * NB); b <= Math.min(NB - 1, Math.floor(gx * NB)); b++) f(b); return; }
      var L2 = [g0, g1, g2].map(function (g) { return g < 0.5 ? g + 1 : g; }), a0 = Math.min.apply(null, L2), a1 = Math.max.apply(null, L2);
      for (var b2 = Math.floor(a0 * NB); b2 <= Math.floor(a1 * NB); b2++) f(b2 % NB);
    };
    if (Math.abs(n[a]) > 0.9 * ar) {                                    // 兩端（軸向的面）：只拿顏色（照它在軸的哪一半 ⇒ 下蓋、上蓋）
      if (col < 8) { var cb = CB[P[0][a] < hm ? 0 : 1]; each(function (b) { cb[b * 8 + col] += ar; }); }
      continue;
    }
    if (Math.max(Math.abs(n[u]), Math.abs(n[w])) < 0.9 * ar) continue;   // 斜的面（匯出的方塊網格沒有）
    var dir = Math.abs(n[u]) >= Math.abs(n[w]) ? (n[u] > 0 ? 0 : 1) : (n[w] > 0 ? 2 : 3);
    var ax = dir < 2 ? u : w, r = Math.abs(P[0][ax] - (dir < 2 ? cu : cw));
    var h0 = Math.min(P[0][a], P[1][a], P[2][a]), h1 = Math.max(P[0][a], P[1][a], P[2][a]);
    for (t = lix[q4(h0)]; t < lix[q4(h1)]; t++) {
      if (r > R4[t * 4 + dir]) R4[t * 4 + dir] = r;
      each(function (b) { var ix = t * NB + b; if (r > BR[ix] + 1e-6) { BR[ix] = r; BC[ix] = col; } });
    }
  }
  var rad = [], sig = [];
  for (t = 0; t < nl; t++) {
    var s = 0, ns = 0, cn = {}, filled = 0;
    for (k = 0; k < 4; k++) if (R4[t * 4 + k] > 0) { s += R4[t * 4 + k]; ns++; }
    if (ns < 4) return null;                                            // 有一層四邊沒有都碰到側面（分成兩截、中間斷了）⇒ 轉不出一圈 ⇒ 照原本的
    rad.push(s / ns);
    for (k = 0; k < NB; k++) { var c = BC[t * NB + k]; if (c >= 0) { cn[c] = (cn[c] || 0) + 1; filled++; } }
    sig.push(Object.keys(cn).filter(function (c2) { return cn[c2] >= 0.1 * filled; }).sort().join(','));
  }
  var sm = rad.map(function (r0, z) { var p = rad[Math.max(0, z - 1)], nx = rad[Math.min(nl - 1, z + 1)]; return (p + 2 * r0 + nx) / 4; });   // 一格一階 ⇒ 圓弧
  // 邊數、相位：有好幾色的層裡，換色次數最多的那一層（一圈的條數 C）
  var C = 0, ph = 0;
  for (t = 0; t < nl; t++) {
    if (sig[t].indexOf(',') < 0) continue;
    var runs = 0, first = -1, L3 = [];
    for (k = 0; k < NB; k++) { var c3 = BC[t * NB + k]; if (c3 >= 0) L3.push([k, c3]); }
    for (k = 0; k < L3.length; k++) { var cur = L3[k][1], pv = L3[(k + L3.length - 1) % L3.length][1]; if (cur !== pv) { runs++; if (first < 0) first = L3[k][0]; } }
    if (runs > C) { C = runs; ph = first / NB; }
  }
  var N = N0 || (C >= 6 && C <= 48 ? C * Math.ceil(LATHE_N / C) : LATHE_N);
  if (!(C >= 6 && C <= 48)) ph = 0;                                    // 數不出條數 ⇒ 不用對齊
  var bands = [];                                                       // 一樣幾色的層合成一段：[第一層, 最後一層, 每一邊的色]
  for (t = 0; t < nl; t++) { var bl = bands[bands.length - 1]; if (bl && sig[bl[0]] === sig[t]) bl[1] = t; else bands.push([t, t, null]); }
  function segCol(L0, L1, k2) {                                         // 第 L0..L1 層、第 k2 邊（角度 ph ＋ k2/N … ＋(k2+1)/N）裡最多的那一色
    var cnt = {}, b0 = Math.floor((ph + k2 / N) * NB), b1 = Math.floor((ph + (k2 + 1) / N) * NB), bc = -1, bv = -1;
    for (var z = L0; z <= L1; z++) for (var b = b0; b < Math.max(b1, b0 + 1); b++) { var c4 = BC[z * NB + (b % NB)]; if (c4 >= 0) cnt[c4] = (cnt[c4] || 0) + 1; }
    Object.keys(cnt).forEach(function (c5) { if (cnt[c5] > bv || (cnt[c5] === bv && +c5 < bc)) { bv = cnt[c5]; bc = +c5; } });
    return bc;
  }
  bands.forEach(function (bd) { var cs2 = []; for (var k2 = 0; k2 < N; k2++) cs2.push(segCol(bd[0], bd[1], k2)); bd[2] = cs2; });
  function ringR(b) { return b <= 0 ? sm[0] : b >= nl ? sm[nl - 1] : (sm[b - 1] + sm[b]) / 2; }   // 邊界 b（第 b 層的下緣）的半徑
  var rings = [];                                                       // 每一段自己一串圈（換段的地方圈重複、法線一樣）
  bands.forEach(function (bd) {
    var P2 = []; for (var b = bd[0]; b <= bd[1] + 1; b++) P2.push(b);
    var keep = {}; keep[P2[0]] = keep[P2[P2.length - 1]] = 1;
    (function dp(i0, i1) {                                              // Douglas–Peucker（軸向位置 h、半徑 r）
      var x0 = hs[P2[i0]], y0 = ringR(P2[i0]), x1 = hs[P2[i1]], y1 = ringR(P2[i1]), mx = -1, mi = -1;
      for (var z = i0 + 1; z < i1; z++) { var xz = hs[P2[z]], yz = ringR(P2[z]), dd = Math.abs((y1 - y0) * xz - (x1 - x0) * yz + x1 * y0 - y1 * x0) / Math.hypot(y1 - y0, x1 - x0); if (dd > mx) { mx = dd; mi = z; } }
      if (mx > LATHE_TOL) { keep[P2[mi]] = 1; dp(i0, mi); dp(mi, i1); }
    })(0, P2.length - 1);
    rings.push(P2.filter(function (b) { return keep[b]; }));
  });
  var allB = []; rings.forEach(function (L) { L.forEach(function (b) { if (allB[allB.length - 1] !== b) allB.push(b); }); });
  function slope(b) {                                                   // 圈的法線照前後兩個圈的半徑斜率（整條側面一起算 ⇒ 換段的地方法線一樣）
    var z = allB.indexOf(b), p = allB[Math.max(0, z - 1)], nx = allB[Math.min(allB.length - 1, z + 1)];
    return nx === p ? 0 : (ringR(nx) - ringR(p)) / (hs[nx] - hs[p]);
  }
  var out = [], cs = [], sn = [];
  for (k = 0; k <= N; k++) { var th = 2 * Math.PI * (ph + k / N); cs.push(Math.cos(th)); sn.push(Math.sin(th)); }
  function rgbOf(c6) { return m.mats[c6] || m.mats[0] || [1, 0, 1]; }
  function vtx(h, r, kk, nr, na, rgb) {                                 // (h 軸向、r 半徑、第 kk 個角；法線 徑向 nr、軸向 na) ⇒ 頂點（位置、法線、色）
    var p = [0, 0, 0], nm = [0, 0, 0];
    p[a] = h; p[u] = cu + r * cs[kk]; p[w] = cw + r * sn[kk];
    nm[a] = na; nm[u] = nr * cs[kk]; nm[w] = nr * sn[kk];
    out.push(p[0], p[1], p[2], nm[0], nm[1], nm[2], rgb[0], rgb[1], rgb[2]);
  }
  function rn(b) { var sl = slope(b), l = Math.hypot(1, sl); return [1 / l, -sl / l]; }   // 徑向、軸向分量
  function side(b0, b1, segC) {
    var h0 = hs[b0], h1 = hs[b1], r0 = ringR(b0), r1 = ringR(b1), n0 = rn(b0), n1 = rn(b1);
    for (var kk = 0; kk < N; kk++) {                                    // 從外面看逆時針（外積朝外）：(u, w, a) 是 (x, y, z) 的循環排列 ⇒ 右手系
      var rgb = rgbOf(segC[kk]);
      vtx(h0, r0, kk, n0[0], n0[1], rgb); vtx(h0, r0, kk + 1, n0[0], n0[1], rgb); vtx(h1, r1, kk + 1, n1[0], n1[1], rgb);
      vtx(h0, r0, kk, n0[0], n0[1], rgb); vtx(h1, r1, kk + 1, n1[0], n1[1], rgb); vtx(h1, r1, kk, n1[0], n1[1], rgb);
    }
  }
  rings.forEach(function (L, bi) { for (var z = 0; z + 1 < L.length; z++) side(L[z], L[z + 1], bands[bi][2]); });
  function cap(b, top) {
    var cb = CB[top ? 1 : 0], h = hs[b], r = ringR(b), na = top ? 1 : -1, fb = bands[top ? bands.length - 1 : 0][2];
    for (var kk = 0; kk < N; kk++) {
      var b0 = Math.floor((ph + kk / N) * NB), b1 = Math.max(b0 + 1, Math.floor((ph + (kk + 1) / N) * NB)), bv = 0, bc = -1;
      for (var c7 = 0; c7 < 8; c7++) { var sA = 0; for (var bb = b0; bb < b1; bb++) sA += cb[(bb % NB) * 8 + c7]; if (sA > bv) { bv = sA; bc = c7; } }
      var rgb = rgbOf(bc >= 0 ? bc : fb[kk]), p0 = [0, 0, 0], nm = [0, 0, 0];
      p0[a] = h; p0[u] = cu; p0[w] = cw; nm[a] = na;
      out.push(p0[0], p0[1], p0[2], nm[0], nm[1], nm[2], rgb[0], rgb[1], rgb[2]);
      if (top) { vtx(h, r, kk, 0, na, rgb); vtx(h, r, kk + 1, 0, na, rgb); } else { vtx(h, r, kk + 1, 0, na, rgb); vtx(h, r, kk, 0, na, rgb); }
    }
  }
  cap(0, false); cap(nl, true);
  if (st) { st.axis = a; st.layers = nl; st.bands = bands.length; st.rings = allB.length; st.n = N; st.stripes = C; st.phase = +ph.toFixed(4); st.tris = out.length / 27; }
  return new Float32Array(out);
}
/** 第 k 份網格給 GPU 的三角形（buildMeshes、90_main.js hullCheck 共用）：照 meta 選的算法（車床式 latheTris、長桿式 62_pole.js poleTris、外殼式 62_shell.js shellTris、輪式 62_wheel.js wheelTris）；沒標、做不出來 ⇒ 照原本的（meshTris）。 */
function meshTriFor(H, k, m) {
  var L = meshAlgo(H, k), t = !L ? null : L.alg === 'lathe' ? latheTris(m, L.n, null, L.ax) : L.alg === 'pole' ? poleTris(m, null) : L.alg === 'shell' ? shellTris(m, null) : L.alg === 'wheel' ? wheelTris(m, L.n, null, L.ax) : null;
  return t || meshTris(m);
}
