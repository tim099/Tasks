// ───────────────────────── 輪式的低面數網格（TASK-0792 ②；Tim 2026-10-22）─────────────────────────
// Tim：「792 GO 分析目前船上還有哪些面數很高可以優化的 例如圖上這個(絞盤) 以及舵輪」「781 792 GO」（照 0792 留言 #4 的順序：① 槳 ⇒ ② 舵輪）。
// 為什麼：舵輪是一圈輪圈＋八支斜的輻條，體素的階梯讓一份網格 7,572 個三角形（17 艘共用）；車床式做不出輻條（會變實心的圓盤）、
//   長桿式只認得一根桿子、通用的網格簡化收不了（T 形接縫）。
// 哪幾件：模型 meta render=wheel（62_lathe.js meshAlgo：照 meta 選算法；跟 render=lathe、pole、shell 同一個入口）。可選 wheel_n（繞幾邊 8～48；沒給 ⇒ 每一條折線照最大半徑挑）、wheel_axis（x｜y｜z）。
// 怎麼做（wheelTris）：
//   · 體素：62_shell.js shellVox（匯出的方塊網格 ⇒ 格子、色）。軸：另外兩邊最接近一樣長的那一邊（跟車床式同一條）；中心 ＝ 那兩軸外框的中點。
//   · 繞軸對稱的部分（輪圈、輪轂、軸、鼓輪）：每一層、每一個半徑（WHEEL_DR 格一圈）照一圈的取樣算「幾成是實心」，過半 ⇒ 算在剖面裡；
//     剖面（軸向 × 半徑）的邊界描成折線、Douglas–Peucker（WHEEL_TOL 格）⇒ 每一段繞軸轉一圈（邊數照那一條折線的最大半徑：弦離圓弧 ≤ WHEEL_SAG 格）；頂點自己的法線（繞軸平滑）、色照那一邊那一段最多的那一色。
//   · 剩下的格（輻條、握把、明輪的槳板）：連在一起的一團一個（六鄰），連上貼著它的對稱部分那一圈格（兩端插進輪轂、輪圈、不留縫）；
//     每一團照 62_pole.js poleTris 出長桿（方向：沿半徑、沿軸、沿切線裡外框最長的那一個；一片 WHEEL_PDS 格、誤差 WHEEL_PTOL 格 ⇒ 縮放過的模型一樣）；太小（< WHEEL_MINC 格，或外框最長一邊 < WHEEL_MINL × 半徑）的不畫（輪圈上一兩格的凸起、方軸的四個角）。
// ⛔ 只換畫的那一份（GPU 的三角形）：佔格 occ（擋格、站位）、舵索的固定點、轉舵照原本的模型 ⇒ 戰局不變。
var WHEEL_NS = [8, 12, 16, 24, 32, 48], WHEEL_SAG = 0.4, WHEEL_DR = 0.5, WHEEL_F = 0.5, WHEEL_TOL = 0.5, WHEEL_MINC = 6, WHEEL_MINL = 0.1, WHEEL_COV = 1, WHEEL_PDS = 2, WHEEL_PTOL = 1, WHEEL_KEEP = 0.8;
var WHEEL_MEMO = {};
/** 一份網格 ⇒ 輪式的三角形（跟 meshTris 同一種排法：每個頂點 位置 3、法線 3、色 3）；做不出來 ⇒ null（照原本的）。
 *  N0：meta 指定的邊數（0 ＝ 照半徑挑）；A0：meta 指定的軸（-1 ＝ 照外框）。st 給了 ⇒ 填讀數。同一個形狀一次載入只算一次（WHEEL_MEMO）。 */
function wheelTris(m, N0, st, A0) {
  var V = m.verts, h = 2166136261, x0 = V[0], y0 = V[1], z0 = V[2], i;
  if (!V.length) return null;
  for (i = 0; i < V.length; i += 3) { h = Math.imul(h ^ Math.round((V[i] - x0) * 64), 16777619); h = Math.imul(h ^ Math.round((V[i + 1] - y0) * 64), 16777619); h = Math.imul(h ^ Math.round((V[i + 2] - z0) * 64), 16777619); }
  for (i = 0; i < m.tris.length; i++) h = Math.imul(h ^ m.tris[i], 16777619);
  for (i = 0; i < m.tmat.length; i++) h = Math.imul(h ^ m.tmat[i], 16777619);
  var key = (h >>> 0) + ':' + V.length + ':' + m.tris.length + ':' + JSON.stringify(m.mats) + ':' + N0 + ':' + A0, hit = WHEEL_MEMO[key];
  if (!hit) { var st0 = {}, R0 = wheelBuild(m, N0, st0, A0); hit = WHEEL_MEMO[key] = { R: R0, st: st0, o: [x0, y0, z0] }; }
  if (st) for (var k in hit.st) st[k] = hit.st[k];
  if (!hit.R) return null;
  var R = new Float32Array(hit.R), dx = x0 - hit.o[0], dy = y0 - hit.o[1], dz = z0 - hit.o[2];
  if (dx || dy || dz) for (i = 0; i < R.length; i += 9) { R[i] += dx; R[i + 1] += dy; R[i + 2] += dz; }
  return R;
}
function wheelBuild(m, N0, st, A0) {
  var X = shellVox(m); if (!X) return null;
  var c = X.c, o = X.o, n = X.n, S = X.s, CL = X.col, nx = n[0], nxy = n[0] * n[1], i, j, k, q;
  var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], g = [0, 0, 0];
  for (i = 0; i < S.length; i++) if (S[i]) { g[0] = i % nx; g[1] = ((i / nx) | 0) % n[1]; g[2] = (i / nxy) | 0; for (k = 0; k < 3; k++) { if (g[k] < lo[k]) lo[k] = g[k]; if (g[k] > hi[k]) hi[k] = g[k]; } }
  if (!(lo[0] <= hi[0])) return null;
  var d = [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1], a = -1, best = Infinity;
  for (k = 0; k < 3; k++) {                                              // 軸：另外兩邊最接近一樣長的那一邊（一樣接近 ⇒ 最長的；跟 latheTris 同一條）
    var du = d[(k + 1) % 3], dv = d[(k + 2) % 3], e = Math.abs(du - dv) / Math.max(du, dv, 1e-9);
    if (e < best - 1e-9 || (Math.abs(e - best) <= 1e-9 && d[k] > d[a])) { best = e; a = k; }
  }
  if (A0 >= 0) a = A0;
  var u = (a + 1) % 3, w = (a + 2) % 3, cu = (lo[u] + hi[u] + 1) / 2, cw = (lo[w] + hi[w] + 1) / 2, D = [1, nx, nxy];
  function solid(ga, gu, gw) {                                           // 格子座標（不是格心）的那一格實心嗎
    var p = [0, 0, 0]; p[a] = ga; p[u] = Math.floor(gu); p[w] = Math.floor(gw);
    if (p[0] < 0 || p[1] < 0 || p[2] < 0 || p[0] >= n[0] || p[1] >= n[1] || p[2] >= n[2]) return -1;
    var ix = p[0] + nx * p[1] + nxy * p[2]; return S[ix] ? ix : -1;
  }
  function surf(ix) {                                                    // 貼著空氣的格（顏色是匯出的面給的；包在裡面的格是照旁邊傳過來的、不算）
    for (var z = 0; z < 6; z++) { var j = ix + (z & 1 ? D[z >> 1] : -D[z >> 1]); if (j < 0 || j >= S.length || !S[j]) return true; }
    return false;
  }
  var rmax = 0;
  for (i = 0; i < S.length; i++) if (S[i]) { g[0] = i % nx; g[1] = ((i / nx) | 0) % n[1]; g[2] = (i / nxy) | 0; var r2 = Math.hypot(g[u] + 0.5 - cu, g[w] + 0.5 - cw) + 0.75; if (r2 > rmax) rmax = r2; }
  var NA = d[a], NR = Math.ceil(rmax / WHEEL_DR) + 1, Fin = new Uint8Array(NA * NR), ia, rb;
  // ── 繞軸對稱的剖面：每一層、每一圈幾成是實心（過半 ⇒ 在剖面裡）；一圈的取樣點（u、w 兩軸的位移）先算好一次、每一層共用
  var RS = [];
  for (rb = 0; rb < NR; rb++) {
    var r = (rb + 0.5) * WHEEL_DR, nt = Math.max(16, Math.ceil(2 * Math.PI * r / 0.4)), Lr = new Int32Array(nt);
    for (q = 0; q < nt; q++) {
      var th = (q + 0.5) / nt * 2 * Math.PI, pu = Math.floor(cu + r * Math.cos(th)), pw = Math.floor(cw + r * Math.sin(th));
      Lr[q] = pu < 0 || pw < 0 || pu >= n[u] || pw >= n[w] ? -1 : pu * D[u] + pw * D[w];
    }
    RS.push(Lr);
  }
  for (ia = 0; ia < NA; ia++) {
    var base = (lo[a] + ia) * D[a];
    for (rb = 0; rb < NR; rb++) { var L0 = RS[rb], hc = 0; for (q = 0; q < L0.length; q++) if (L0[q] >= 0 && S[base + L0[q]]) hc++; if (hc >= WHEEL_F * L0.length) Fin[ia * NR + rb] = 1; }
  }
  function A(ia2, rb2) { return ia2 >= 0 && ia2 < NA && rb2 >= 0 && rb2 < NR && Fin[ia2 * NR + rb2] === 1; }
  // 邊界（剖面在左手邊、往前走）：軸上那一條（半徑 0）不算邊界 ⇒ 折線從軸上出發、回到軸上，或自己繞一圈
  var E = {}, inc = {};
  function edge(x1, y1, x2, y2) { var k1 = x1 + ',' + y1; (E[k1] = E[k1] || []).push([x2, y2]); inc[x2 + ',' + y2] = (inc[x2 + ',' + y2] || 0) + 1; }
  for (ia = 0; ia < NA; ia++) for (rb = 0; rb < NR; rb++) {
    if (!A(ia, rb)) continue;
    if (rb > 0 && !A(ia, rb - 1)) edge(ia, rb, ia + 1, rb);
    if (!A(ia, rb + 1)) edge(ia + 1, rb + 1, ia, rb + 1);
    if (!A(ia - 1, rb)) edge(ia, rb + 1, ia, rb);
    if (!A(ia + 1, rb)) edge(ia + 1, rb, ia + 1, rb + 1);
  }
  function take(k1) { var L = E[k1]; if (!L || !L.length) return null; var p = L.shift(); if (!L.length) delete E[k1]; return p; }
  var paths = [];
  function trace(k1, open) {
    var x = k1.split(',').map(Number), P = [x];
    for (;;) { var nx2 = take(P[P.length - 1][0] + ',' + P[P.length - 1][1]); if (!nx2) break; P.push(nx2); if (!open && nx2[0] === P[0][0] && nx2[1] === P[0][1]) break; }
    if (P.length > 1) paths.push({ P: P, open: open });
  }
  Object.keys(E).forEach(function (k1) { if (!inc[k1] && E[k1]) while (E[k1]) trace(k1, true); });   // 從軸上出發的
  while (Object.keys(E).length) trace(Object.keys(E)[0], false);         // 自己繞一圈的（中空的輪圈）
  function dpKeep(P, i0, i1, keep) {                                     // Douglas–Peucker（軸向 格、半徑 格）
    var A2 = [P[i0][0], P[i0][1] * WHEEL_DR], B2 = [P[i1][0], P[i1][1] * WHEEL_DR], dx = B2[0] - A2[0], dy = B2[1] - A2[1], L = Math.hypot(dx, dy), mx = 0, mi = -1;
    for (var z = i0 + 1; z < i1; z++) {
      var px = P[z][0] - A2[0], py = P[z][1] * WHEEL_DR - A2[1], dd = L > 1e-9 ? Math.abs(px * dy - py * dx) / L : Math.hypot(px, py);
      if (dd > mx) { mx = dd; mi = z; }
    }
    if (mx > WHEEL_TOL) { keep[mi] = 1; dpKeep(P, i0, mi, keep); dpKeep(P, mi, i1, keep); }
  }
  var segs = [];
  function edgeCol(p, q2) {                                              // 剖面的一條邊（格點 p → q2）：往剖面裡半格、繞一圈取樣 ⇒ 最多的那一色（-1 ＝ 沒有）
    var dx = q2[0] - p[0], dy = (q2[1] - p[1]) * WHEEL_DR, L = Math.hypot(dx, dy), na = dy / L, nr = -dx / L;
    var mx = (p[0] + q2[0]) / 2 - na * 0.5, mr = (p[1] + q2[1]) / 2 * WHEEL_DR - nr * 0.3, la = Math.floor(mx), cn = {}, bc = -1, bv = 0;
    if (la < 0 || la >= NA || mr < 0) return -1;
    for (var z = 0; z < 48; z++) { var ph = (z + 0.5) / 48 * 2 * Math.PI, ix = solid(lo[a] + la, cu + mr * Math.cos(ph), cw + mr * Math.sin(ph)); if (ix >= 0 && CL[ix] >= 0 && surf(ix)) cn[CL[ix]] = (cn[CL[ix]] || 0) + 1; }
    Object.keys(cn).forEach(function (c2) { if (cn[c2] > bv || (cn[c2] === bv && +c2 < bc)) { bv = cn[c2]; bc = +c2; } });
    return bc;
  }
  paths.forEach(function (pt) {
    var P = pt.P, keep = {}, L = P.length - 1, ec = [];
    keep[0] = keep[L] = 1;
    for (var z0 = 0; z0 < L; z0++) ec.push(edgeCol(P[z0], P[z0 + 1]));
    for (z0 = 1; z0 < L; z0++) if (ec[z0] >= 0 && ec[z0 - 1] >= 0 && ec[z0] !== ec[z0 - 1]) keep[z0] = 1;   // 換色的地方一定斷（鼓輪兩端的箍）
    if (Object.keys(keep).length > 2) {                                   // 有換色 ⇒ 每兩個斷點之間各自簡化
      var kk = Object.keys(keep).map(Number).sort(function (x, y) { return x - y; });
      for (var z1 = 0; z1 + 1 < kk.length; z1++) dpKeep(P, kk[z1], kk[z1 + 1], keep);
    } else if (!pt.open) {                                                // 自己繞一圈、一色 ⇒ 從離起點最遠的那一點切兩半
      var far = 0, fd = -1; for (var z = 1; z < L; z++) { var dd = Math.hypot(P[z][0] - P[0][0], (P[z][1] - P[0][1]) * WHEEL_DR); if (dd > fd) { fd = dd; far = z; } } keep[far] = 1; dpKeep(P, 0, far, keep); dpKeep(P, far, L, keep); }
    else dpKeep(P, 0, L, keep);
    var ks = Object.keys(keep).map(Number).sort(function (x, y) { return x - y; }), rp = 0, Np = N0 >= 8 && N0 <= 48 ? N0 : 0;
    P.forEach(function (p) { if (p[1] * WHEEL_DR > rp) rp = p[1] * WHEEL_DR; });
    for (var z3 = 0; !Np; z3++) if (z3 === WHEEL_NS.length - 1 || rp * (1 - Math.cos(Math.PI / WHEEL_NS[z3])) <= WHEEL_SAG) Np = WHEEL_NS[z3];   // 一圈幾邊：弦離圓弧 ≤ WHEEL_SAG 格（同一條折線同一個邊數 ⇒ 接得上、沒有縫）
    for (var z2 = 0; z2 + 1 < ks.length; z2++) segs.push([P[ks[z2]][0], P[ks[z2]][1] * WHEEL_DR, P[ks[z2 + 1]][0], P[ks[z2 + 1]][1] * WHEEL_DR, P.slice(ks[z2], ks[z2 + 1] + 1), Np]);
  });
  var out = [], ea = [0, 0, 0], eu = [0, 0, 0], ew = [0, 0, 0]; ea[a] = 1; eu[u] = 1; ew[w] = 1;
  function rgbOf(c6) { return m.mats[c6] || m.mats[0] || [1, 0, 1]; }
  function P3(x, r, ph) { var cs = Math.cos(ph), sn = Math.sin(ph), gu = cu + r * cs, gw = cw + r * sn, p = [0, 0, 0]; p[a] = lo[a] + x; p[u] = gu; p[w] = gw; return [o[0] + p[0] * c, o[1] + p[1] * c, o[2] + p[2] * c]; }
  function N3(na, nr, ph) { var cs = Math.cos(ph), sn = Math.sin(ph), v = [0, 0, 0]; v[a] = na; v[u] = nr * cs; v[w] = nr * sn; return v; }
  function vtx(p, nn, rgb) { out.push(p[0], p[1], p[2], nn[0], nn[1], nn[2], rgb[0], rgb[1], rgb[2]); }
  var nRev = 0;
  segs.forEach(function (sg) {
    var xa = sg[0], ya = sg[1], xb = sg[2], yb = sg[3], N = sg[5], dx = xb - xa, dy = yb - ya, L = Math.hypot(dx, dy);
    if (!(L > 1e-9) || (ya <= 1e-9 && yb <= 1e-9)) return;
    var na = dy / L, nr = -dx / L;                                       // 剖面在左手邊 ⇒ 右手邊朝外
    // 色：沿這一段每一條原本的邊、往剖面裡半格，照這一邊的角度取樣 ⇒ 最多的那一色（這一邊沒有實心 ⇒ 整段最多的）
    var cnt = [], all = {};
    for (k = 0; k < N; k++) cnt.push({});
    var Pp = sg[4];
    for (var z = 0; z + 1 < Pp.length; z++) {
      var mx = (Pp[z][0] + Pp[z + 1][0]) / 2 - na * 0.5, mr = (Pp[z][1] + Pp[z + 1][1]) / 2 * WHEEL_DR - nr * 0.3;
      var la = Math.floor(mx); if (la < 0 || la >= NA || mr < 0) continue;
      for (k = 0; k < N; k++) for (q = 0; q < 4; q++) {
        var ph = (k + (q + 0.5) / 4) / N * 2 * Math.PI, ix = solid(lo[a] + la, cu + mr * Math.cos(ph), cw + mr * Math.sin(ph));
        if (ix < 0 || CL[ix] < 0 || !surf(ix)) continue;
        cnt[k][CL[ix]] = (cnt[k][CL[ix]] || 0) + 1; all[CL[ix]] = (all[CL[ix]] || 0) + 1;
      }
    }
    function maj(o2) { var bc = -1, bv = 0; Object.keys(o2).forEach(function (c2) { if (o2[c2] > bv || (o2[c2] === bv && +c2 < bc)) { bv = o2[c2]; bc = +c2; } }); return bc; }
    var ca = maj(all); if (ca < 0) ca = 0;
    for (k = 0; k < N; k++) {
      var c0 = maj(cnt[k]), rgb = rgbOf(c0 >= 0 ? c0 : ca), p0 = k / N * 2 * Math.PI, p1 = (k + 1) / N * 2 * Math.PI;
      var A1 = P3(xa, ya, p0), B1 = P3(xb, yb, p0), C1 = P3(xb, yb, p1), D1 = P3(xa, ya, p1), nA = N3(na, nr, p0), nC = N3(na, nr, p1), mid = N3(na, nr, (p0 + p1) / 2);
      tri(A1, B1, C1, nA, nA, nC, mid, rgb); tri(A1, C1, D1, nA, nC, nC, mid, rgb);   // 半徑 0 那一端兩點疊在一起 ⇒ 那一個退化、不出
    }
  });
  function tri(P, Q, R, nP, nQ, nR, out0, rgb) {                         // 跟 62_pole.js quad 同一個方向：(Q−P)×(R−P) 朝外
    var e1 = [Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]], e2 = [R[0] - P[0], R[1] - P[1], R[2] - P[2]], cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    var l = Math.hypot(cr[0], cr[1], cr[2]); if (!(l > 1e-9 * c * c)) return;
    if (cr[0] * out0[0] + cr[1] * out0[1] + cr[2] * out0[2] < 0) { vtx(P, nP, rgb); vtx(R, nR, rgb); vtx(Q, nQ, rgb); }
    else { vtx(P, nP, rgb); vtx(Q, nQ, rgb); vtx(R, nR, rgb); }
    nRev++;
  }
  // ── 剩下的格（輻條、握把、槳板）：不在剖面裡（格心前後 WHEEL_COV 格都不在 ⇒ 輪圈的鋸齒邊、體素圓正上方那一段平的不算）
  var cov = new Uint8Array(S.length), rem = new Uint8Array(S.length);
  for (i = 0; i < S.length; i++) if (S[i]) {
    g[0] = i % nx; g[1] = ((i / nx) | 0) % n[1]; g[2] = (i / nxy) | 0;
    var ia3 = g[a] - lo[a], rr = Math.hypot(g[u] + 0.5 - cu, g[w] + 0.5 - cw);
    if (A(ia3, Math.floor(rr / WHEEL_DR)) || A(ia3, Math.floor((rr - WHEEL_COV) / WHEEL_DR)) || A(ia3, Math.floor((rr + WHEEL_COV) / WHEEL_DR))) cov[i] = 1; else rem[i] = 1;
  }
  var seen = new Int32Array(S.length).fill(-1), nb = 0, nDrop = 0, nPole = 0;
  for (i = 0; i < S.length; i++) {
    if (!rem[i] || seen[i] >= 0) continue;
    var L3 = [i], s3 = [i]; seen[i] = nb;
    while (s3.length) {
      var p3 = s3.pop(); g[0] = p3 % nx; g[1] = ((p3 / nx) | 0) % n[1]; g[2] = (p3 / nxy) | 0;
      for (k = 0; k < 6; k++) {
        var ax2 = k >> 1, sgn = k & 1 ? 1 : -1, gg = g[ax2] + sgn; if (gg < 0 || gg >= n[ax2]) continue;
        var j3 = p3 + sgn * D[ax2]; if (rem[j3] && seen[j3] < 0) { seen[j3] = nb; L3.push(j3); s3.push(j3); }
      }
    }
    nb++;
    var bl = [Infinity, Infinity, Infinity], bh = [-Infinity, -Infinity, -Infinity];
    L3.forEach(function (p4) { var g4 = [p4 % nx, ((p4 / nx) | 0) % n[1], (p4 / nxy) | 0]; for (var k4 = 0; k4 < 3; k4++) { if (g4[k4] < bl[k4]) bl[k4] = g4[k4]; if (g4[k4] > bh[k4]) bh[k4] = g4[k4]; } });
    if (L3.length < WHEEL_MINC || Math.max(bh[0] - bl[0], bh[1] - bl[1], bh[2] - bl[2]) + 1 < WHEEL_MINL * rmax) { nDrop += L3.length; continue; }   // 太小（輪圈上一兩格的凸起、方軸的角）⇒ 不畫
    // 連上貼著它的對稱部分 WHEEL_COV ＋ 1 圈格（兩端插進輪轂、輪圈，蓋過剖面多邊形內接的那一點 ⇒ 不留縫）
    var inC = {}, fr = L3.slice(); L3.forEach(function (p4) { inC[p4] = 1; });
    for (var lay = 0; lay <= WHEEL_COV; lay++) {
      var nf = [];
      fr.forEach(function (p4) {
        var g4 = [p4 % nx, ((p4 / nx) | 0) % n[1], (p4 / nxy) | 0];
        for (var k4 = 0; k4 < 6; k4++) { var ax4 = k4 >> 1, s4 = k4 & 1 ? 1 : -1, q4 = g4[ax4] + s4; if (q4 < 0 || q4 >= n[ax4]) continue; var j4 = p4 + s4 * D[ax4]; if (cov[j4] && !inC[j4]) { inC[j4] = 1; L3.push(j4); nf.push(j4); } }
      });
      fr = nf;
    }
    // 方向：沿半徑（這一團的平均角度）、沿軸、沿切線三個裡外框最長的那一個（不做 PCA：握把黏到輪圈的凸起會被帶歪）
    var sa = 0, ca2 = 0;
    L3.forEach(function (p4) { if (!rem[p4]) return; var g4 = [p4 % nx, ((p4 / nx) | 0) % n[1], (p4 / nxy) | 0], t4 = Math.atan2(g4[w] + 0.5 - cw, g4[u] + 0.5 - cu); sa += Math.sin(t4); ca2 += Math.cos(t4); });
    var tb = Math.atan2(sa, ca2), er = [0, 0, 0], et = [0, 0, 0]; er[u] = Math.cos(tb); er[w] = Math.sin(tb); et[u] = -Math.sin(tb); et[w] = Math.cos(tb);
    var DIR = [er, ea, et], ext = [0, 1, 2].map(function (z5) {
      var e5 = DIR[z5], mn = Infinity, mxx = -Infinity;
      L3.forEach(function (p4) { var g4 = [p4 % nx + 0.5, ((p4 / nx) | 0) % n[1] + 0.5, ((p4 / nxy) | 0) + 0.5], v5 = g4[0] * e5[0] + g4[1] * e5[1] + g4[2] * e5[2]; if (v5 < mn) mn = v5; if (v5 > mxx) mxx = v5; });
      return mxx - mn;
    });
    var z6 = ext[0] >= ext[1] && ext[0] >= ext[2] ? 0 : ext[1] >= ext[2] ? 1 : 2;
    var t = wheelCellPole(L3, inC, X, m, [DIR[z6], DIR[(z6 + 1) % 3], DIR[(z6 + 2) % 3]]);
    if (t) { for (j = 0; j < t.length; j++) out.push(t[j]); nPole++; }
  }
  if (out.length / 27 > WHEEL_KEEP * m.tris.length / 3) { if (st) st.why = 'not smaller'; return null; }   // 沒少到原本的八成 ⇒ 照原本的
  if (st) { st.axis = 'xyz'[a]; st.segs = segs.length; st.blobs = nb; st.poles = nPole; st.drop = nDrop; st.tris = out.length / 27; }
  return out.length ? new Float32Array(out) : null;
}
/** 一團格子 ⇒ 外面那一圈面做成假的網格 ⇒ 62_pole.js poleTris（方向 E 照給的；做不出來 ⇒ 照格子的面）。 */
function wheelCellPole(L, inC, X, m, E) {
  var c = X.c, o = X.o, n = X.n, nx = n[0], nxy = n[0] * n[1], D = [1, nx, nxy], V = [], T = [], TM = [], cn = {}, bc = 0, bv = 0;
  function air(p, k) { var ax = k >> 1, sg = k & 1 ? 1 : -1, g = [p % nx, ((p / nx) | 0) % n[1], (p / nxy) | 0], q = g[ax] + sg; return q < 0 || q >= n[ax] || !X.s[p + sg * D[ax]]; }
  // 色：貼著空氣的那幾面才算（插進輪轂、輪圈的那一截、跟對稱部分相接的面 ⇒ 照這一團最多的那一色，不讓裡面的格拉暗）
  L.forEach(function (p) { if (X.col[p] < 0) return; for (var k = 0; k < 6; k++) if (air(p, k)) cn[X.col[p]] = (cn[X.col[p]] || 0) + 1; });
  Object.keys(cn).forEach(function (c2) { if (cn[c2] > bv) { bv = cn[c2]; bc = +c2; } });
  L.forEach(function (p) {
    var g = [p % nx, ((p / nx) | 0) % n[1], (p / nxy) | 0];
    for (var k = 0; k < 6; k++) {
      var ax = k >> 1, sg = k & 1 ? 1 : -1, q = g[ax] + sg;
      if (q >= 0 && q < n[ax] && inC[p + sg * D[ax]]) continue;
      var cl = X.col[p] >= 0 && air(p, k) ? X.col[p] : bc;
      var u = (ax + 1) % 3, w = (ax + 2) % 3, base = V.length / 3, f = g[ax] + (sg > 0 ? 1 : 0);
      [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(function (uv) { var r = [0, 0, 0]; r[ax] = f; r[u] = g[u] + uv[0]; r[w] = g[w] + uv[1]; V.push(o[0] + r[0] * c, o[1] + r[1] * c, o[2] + r[2] * c); });
      if (sg > 0) T.push(base, base + 1, base + 2, base, base + 2, base + 3); else T.push(base, base + 2, base + 1, base, base + 3, base + 2);
      TM.push(cl, cl);
    }
  });
  var fm = { verts: V, tris: T, tmat: TM, mats: m.mats }, t = poleTris(fm, null, E, WHEEL_PDS * c, WHEEL_PTOL * c);
  return t || meshTris(fm);
}
