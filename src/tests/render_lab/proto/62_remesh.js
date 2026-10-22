// ───────────────────────── 平滑再減面：同色大方塊抽成方框＋surface nets＋QEM＋投影貼圖（TASK-0824；Tim 2026-10-22）─────────────────────────
// Tim：「是否可以先套用金屬材質的平滑算法先跑一遍 再轉成模型」「是否可以把一些同色立方體部分 直接獨立出來 同色且體積大的立方體」。
// ⚠ 原型，沒有進成品（template.html 沒掛）：Tim 2026-10-22「目前看起來外觀差太多」「先還原回voxel繪製小艇吧」「不過算法可以保留」。
//   試的時候跟 62_shell.js 一起載（用它的 shellVox、shellLayer；SHELL_TW 要改 512）。小艇讀數（第三版）：捕鯨艇 8,278 → 2,408、餘燼號小艇 10,930 → 5,048、
//   一次 0.9～2 秒；一格寬的飾條會碎（平滑後點偏 ±0.5 格、減面再挪）—— 要再用，先處理飾條那一圈（不平滑、只沿飾條收，或貼圖照原本的格面烤）。
//   同一個資料夾的 boat-box.patch：外殼式（62_shell.js）加「殼的碎塊不出＋同色大方塊抽成方框」（捕鯨艇 1,724 → 1,324、餘燼號小艇 1,874 → 1,542），沒在遊戲裡看過。
// 怎麼做（rmTris）：
//   · 體素：62_shell.js shellVox（匯出的方塊網格 ⇒ 格子）。
//   · 方塊：同色、體積 ≥ RM_BOXV、每邊 ≥ RM_BOXMIN 的長方體（從每一格往三個方向長，挑最大的）⇒ 一塊一個方框（12 個三角形，頂點色），不進平滑。
//   · 其餘的格：surface nets（跟 15_smooth.js 同一套：露出來的格面一個四邊形，格角往表面拉、跟周圍同一面的格角平均一次、夾回格角 ±0.5；
//     周圍有方塊的格 ⇒ 格角釘住 ⇒ 跟方框接得起來）。
//   · QEM（Garland–Heckbert）邊收縮到誤差 RM_ERR 格：釘住、非流形的點不動；收了會翻面、會變非流形的不收。
//   · 貼圖：每個三角形照法線最大的那一軸（含正負）分組，相連的成一片，照那一軸投影 ⇒ 片的外框排進一張 RM_TW² 的貼圖；
//     貼圖每一格回到三角形上的那一點、往裡半格查原本的體素色 ⇒ 顏色精度跟減掉多少面無關。
// ⛔ 只換畫的那一份（GPU 的三角形）：佔格 occ、碰撞、站位照原本的網格。
var RM_BOXV = 48, RM_BOXMIN = 2, RM_BOXAIR = 0.88, RM_ERR = 0.7, RM_ERRK = 8, RM_CHART = 0.4, RM_TW = 512;   // RM_ERRK：顏色交界的點成本乘幾倍（0.7 格 ⇒ 約 0.25 格）
function rmTris(m, st) {
  var t0 = Date.now(), G = shellVox(m); if (!G) return null;
  var c = G.c, o = G.o, n = G.n, nx = n[0], ny = n[1], nz = n[2], nxy = nx * ny, S = G.s, CL = G.col, N = S.length, i, j, k;
  var D3 = [1, nx, nxy];
  function solid(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && S[x + nx * y + nxy * z]; }
  // ── 方塊 ──
  var BX = new Uint8Array(N), boxes = [], ORD = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  function free(x, y, z, col) { var ix = x + nx * y + nxy * z; return x < nx && y < ny && z < nz && S[ix] && !BX[ix] && CL[ix] === col; }
  function grow(g0, col, ord) {
    var d = [1, 1, 1], a1 = ord[0], a2 = ord[1], a3 = ord[2];
    function slabOk(ax, at) {                                            // 第 ax 軸第 at 層整面（另外兩軸照現在的大小）都可以
      var u = (ax + 1) % 3, w = (ax + 2) % 3, p = [0, 0, 0];
      for (var a = 0; a < d[u]; a++) for (var b = 0; b < d[w]; b++) { p[ax] = at; p[u] = g0[u] + a; p[w] = g0[w] + b; if (!free(p[0], p[1], p[2], col)) return false; }
      return true;
    }
    [a1, a2, a3].forEach(function (ax) { while (g0[ax] + d[ax] < n[ax] && slabOk(ax, g0[ax] + d[ax])) d[ax]++; });
    return d;
  }
  for (i = 0; i < N; i++) {
    if (!S[i] || BX[i]) continue;
    var g0 = [i % nx, ((i / nx) | 0) % ny, (i / nxy) | 0], col0 = CL[i], best = null, bv = 0;
    for (k = 0; k < 6; k++) { var d = grow(g0, col0, ORD[k]), v = d[0] * d[1] * d[2]; if (v > bv) { bv = v; best = d; } }
    if (bv < RM_BOXV) continue;
    if (Math.min(best[0], best[1], best[2]) < RM_BOXMIN) {               // 一格厚的：外擴一圈（含斜對角）幾乎都是空氣才抽（收著的槳）；殼的一格厚斜階梯斜對角就是下一階 ⇒ 留給平滑面
      var ex = 0, tot = 0;
      for (var z7 = g0[2] - 1; z7 <= g0[2] + best[2]; z7++) for (var y7 = g0[1] - 1; y7 <= g0[1] + best[1]; y7++) for (var x7 = g0[0] - 1; x7 <= g0[0] + best[0]; x7++) {
        if (x7 >= g0[0] && x7 < g0[0] + best[0] && y7 >= g0[1] && y7 < g0[1] + best[1] && z7 >= g0[2] && z7 < g0[2] + best[2]) continue;
        tot++; if (!solid(x7, y7, z7)) ex++;
      }
      if (ex < RM_BOXAIR * tot) continue;
    }
    for (var bz = 0; bz < best[2]; bz++) for (var by = 0; by < best[1]; by++) for (var bx = 0; bx < best[0]; bx++) BX[(g0[0] + bx) + nx * (g0[1] + by) + nxy * (g0[2] + bz)] = 1;
    boxes.push({ g: g0, d: best, col: col0 });
  }
  // 補縫：兩格只靠一條邊（或一個角）相連、旁邊空著 ⇒ 補一格（色照它旁邊的），平滑面才是流形（斜的一格厚薄板 ⇒ 不會一個格角被兩邊共用、QEM 鎖死）
  var nfill = 0;
  for (var pass = 0; pass < 3; pass++) {
    var fills = [];
    for (i = 0; i < N; i++) {
      if (S[i]) continue;
      var fx = i % nx, fy = ((i / nx) | 0) % ny, fz = (i / nxy) | 0, need = false, cpick = -1;
      for (var a5 = 0; a5 < 3 && !need; a5++) {                          // 這一格跟兩個相鄰格 p、q（不同軸）都實心，p、q 的對角格 r 空、而且 p+q 方向的那一格（對角）實心 ⇒ 兩格只靠邊相連
        for (var b5 = a5 + 1; b5 < 3 && !need; b5++) for (var sa = -1; sa <= 1 && !need; sa += 2) for (var sb = -1; sb <= 1 && !need; sb += 2) {
          var pq = [fx, fy, fz], pr = [fx, fy, fz], pd = [fx, fy, fz]; pq[a5] += sa; pr[b5] += sb; pd[a5] += sa; pd[b5] += sb;
          var sq = solid(pq[0], pq[1], pq[2]), sr = solid(pr[0], pr[1], pr[2]), sd = solid(pd[0], pd[1], pd[2]);
          if (sq && sr && !sd) { need = true; cpick = CL[pq[0] + nx * pq[1] + nxy * pq[2]]; }
        }
      }
      if (need) { S[i] = 1; CL[i] = cpick; nfill++; fills.push(i); }   // 馬上補 ⇒ 2×2 的另一格就不用補
    }
    if (!fills.length) break;
  }
  var t1 = Date.now();
  // ── surface nets（其餘的格）──
  var CX = nx + 1, CXY = CX * (ny + 1), cinfo = new Map(), C8 = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  var E12 = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  function corner(X, Y, Z) {                                             // 格角（X, Y, Z）周圍 8 格 ⇒ { srf, pin, o 偏移, g 實心的方向 }
    var kk = X + CX * Y + CXY * Z, r = cinfo.get(kk); if (r) return r;
    var occ = [], pin = false, gx = 0, gy = 0, gz = 0, cnt = 0, q;
    for (q = 0; q < 8; q++) {
      var cc = C8[q], vx = X - 1 + cc[0], vy = Y - 1 + cc[1], vz = Z - 1 + cc[2], s1 = solid(vx, vy, vz) ? 1 : 0;
      occ.push(s1); if (s1) { if (BX[vx + nx * vy + nxy * vz]) pin = true; gx += cc[0] - 0.5; gy += cc[1] - 0.5; gz += cc[2] - 0.5; cnt++; }
    }
    var ox = 0, oy = 0, oz = 0, ne = 0;
    for (q = 0; q < 12; q++) { var a = E12[q][0], b = E12[q][1]; if (occ[a] === occ[b]) continue; var A = C8[a], B = C8[b]; ox += (A[0] + B[0]) / 2 - 0.5; oy += (A[1] + B[1]) / 2 - 0.5; oz += (A[2] + B[2]) / 2 - 0.5; ne++; }
    r = { srf: cnt > 0 && cnt < 8, pin: pin, o: ne ? [ox / ne, oy / ne, oz / ne] : [0, 0, 0], g: [gx, gy, gz] };
    cinfo.set(kk, r); return r;
  }
  var vid = new Map(), VK = [], F = [], CORN = [[0, 0], [1, 0], [1, 1], [0, 1]];
  function vert(X, Y, Z) { var kk = X + CX * Y + CXY * Z, q = vid.get(kk); if (q === undefined) { q = VK.length / 3; vid.set(kk, q); VK.push(X, Y, Z); } return q; }
  for (i = 0; i < N; i++) {
    if (!S[i] || BX[i]) continue;
    var x = i % nx, y = ((i / nx) | 0) % ny, z = (i / nxy) | 0;
    for (var ax = 0; ax < 3; ax++) for (var sg = -1; sg <= 1; sg += 2) {
      var P = [x, y, z]; P[ax] += sg; if (solid(P[0], P[1], P[2])) continue;
      var ua = (ax + 1) % 3, va = (ax + 2) % 3, qd = [];
      for (var e = 0; e < 4; e++) { var cc2 = CORN[sg > 0 ? e : 3 - e], L = [x, y, z]; L[ax] += sg > 0 ? 1 : 0; L[ua] += cc2[0]; L[va] += cc2[1]; qd.push(vert(L[0], L[1], L[2])); }
      F.push(qd);
    }
  }
  var nv = VK.length / 3, V = new Float64Array(nv * 3), PIN = new Uint8Array(nv), VN = new Float64Array(nv * 3), CB = new Uint8Array(nv);   // VN：平滑的頂點法線（照佔格，朝外）；CB：顏色交界的點
  for (i = 0; i < nv; i++) {
    var X = VK[i * 3], Y = VK[i * 3 + 1], Z = VK[i * 3 + 2], me = corner(X, Y, Z), c8 = -1;
    for (var q8 = 0; q8 < 8; q8++) { var cx8 = X - 1 + C8[q8][0], cy8 = Y - 1 + C8[q8][1], cz8 = Z - 1 + C8[q8][2]; if (!solid(cx8, cy8, cz8)) continue; var cc8 = CL[cx8 + nx * cy8 + nxy * cz8]; if (c8 < 0) c8 = cc8; else if (cc8 !== c8) CB[i] = 1; }
    var sx = 0, sy = 0, sz = 0, sn = 0, gnx = 0, gny = 0, gnz = 0;
    for (var dz = -1; dz <= 1; dz++) for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      var oc = corner(X + dx, Y + dy, Z + dz); if (!oc.srf) continue;
      if (oc.g[0] * me.g[0] + oc.g[1] * me.g[1] + oc.g[2] * me.g[2] <= 0) continue;   // 薄板的背面不混
      gnx -= oc.g[0]; gny -= oc.g[1]; gnz -= oc.g[2];
      if (oc.pin) { sx += dx; sy += dy; sz += dz; } else { sx += dx + oc.o[0]; sy += dy + oc.o[1]; sz += dz + oc.o[2]; }
      sn++;
    }
    var gl8 = Math.hypot(gnx, gny, gnz) || 1; VN[i * 3] = gnx / gl8; VN[i * 3 + 1] = gny / gl8; VN[i * 3 + 2] = gnz / gl8;
    if (me.pin) { V[i * 3] = X; V[i * 3 + 1] = Y; V[i * 3 + 2] = Z; PIN[i] = 1; continue; }
    var ofs = sn ? [sx / sn, sy / sn, sz / sn] : me.o;
    V[i * 3] = X + Math.max(-0.5, Math.min(0.5, ofs[0])); V[i * 3 + 1] = Y + Math.max(-0.5, Math.min(0.5, ofs[1])); V[i * 3 + 2] = Z + Math.max(-0.5, Math.min(0.5, ofs[2]));
  }
  var TR = [];                                                           // 四邊形 ⇒ 兩個三角形（照短的那條對角線切）
  F.forEach(function (q) {
    var d02 = 0, d13 = 0; for (var a = 0; a < 3; a++) { d02 += Math.pow(V[q[0] * 3 + a] - V[q[2] * 3 + a], 2); d13 += Math.pow(V[q[1] * 3 + a] - V[q[3] * 3 + a], 2); }
    if (d02 <= d13) TR.push(q[0], q[1], q[2], q[0], q[2], q[3]); else TR.push(q[0], q[1], q[3], q[1], q[2], q[3]);
  });
  var nSN = TR.length / 3, t2 = Date.now();
  // ── QEM ──
  var TRI = new Int32Array(TR), nt = nSN, ALIVE = new Uint8Array(nt).fill(1), VT = [];   // VT：每個頂點用到它的三角形
  for (i = 0; i < nv; i++) VT.push([]);
  for (j = 0; j < nt; j++) for (k = 0; k < 3; k++) VT[TRI[j * 3 + k]].push(j);
  function tnorm(j2, out) {
    var a = TRI[j2 * 3] * 3, b = TRI[j2 * 3 + 1] * 3, cq = TRI[j2 * 3 + 2] * 3;
    var e1x = V[b] - V[a], e1y = V[b + 1] - V[a + 1], e1z = V[b + 2] - V[a + 2], e2x = V[cq] - V[a], e2y = V[cq + 1] - V[a + 1], e2z = V[cq + 2] - V[a + 2];
    out[0] = e1y * e2z - e1z * e2y; out[1] = e1z * e2x - e1x * e2z; out[2] = e1x * e2y - e1y * e2x; return out;
  }
  var Q = new Float64Array(nv * 10), QA = new Float64Array(nv), tn = [0, 0, 0];   // QA：累積的面積（成本 ÷ 它 ＝ 平均距離²，門檻才是格）
  for (j = 0; j < nt; j++) {
    tnorm(j, tn); var ar = Math.hypot(tn[0], tn[1], tn[2]); if (!(ar > 0)) continue;
    var a0 = tn[0] / ar, b0 = tn[1] / ar, c0 = tn[2] / ar, v0 = TRI[j * 3] * 3, d0 = -(a0 * V[v0] + b0 * V[v0 + 1] + c0 * V[v0 + 2]), w = ar / 2;
    var qq = [a0 * a0, a0 * b0, a0 * c0, a0 * d0, b0 * b0, b0 * c0, b0 * d0, c0 * c0, c0 * d0, d0 * d0];
    for (k = 0; k < 3; k++) { var vb = TRI[j * 3 + k] * 10; for (var h = 0; h < 10; h++) Q[vb + h] += qq[h] * w; QA[TRI[j * 3 + k]] += w; }
  }
  function qerr(vi, x, y, z, vj) {
    var A = vi * 10, B = vj * 10, q = function (h) { return Q[A + h] + Q[B + h]; };
    return q(0) * x * x + 2 * q(1) * x * y + 2 * q(2) * x * z + 2 * q(3) * x + q(4) * y * y + 2 * q(5) * y * z + 2 * q(6) * y + q(7) * z * z + 2 * q(8) * z + q(9);
  }
  // 非流形的邊（不是剛好 2 個三角形）⇒ 兩端鎖住
  var LOCK = new Uint8Array(nv), EC = new Map();
  for (i = 0; i < nv; i++) if (PIN[i]) LOCK[i] = 1;
  for (j = 0; j < nt; j++) for (k = 0; k < 3; k++) { var p0 = TRI[j * 3 + k], p1 = TRI[j * 3 + (k + 1) % 3], ek = p0 < p1 ? p0 * nv + p1 : p1 * nv + p0; EC.set(ek, (EC.get(ek) || 0) + 1); }
  EC.forEach(function (cnt, ek) { if (cnt !== 2) { LOCK[Math.floor(ek / nv)] = 1; LOCK[ek % nv] = 1; } });
  var STAMP = new Int32Array(nv), HP = [], HC = [], HA = [], HB = [], HS = [], HX = [], HY = [], HZ = [];   // 堆（成本最小在上）
  function hpush(cost, a, b, sa, x, y, z) {
    var e = HC.length; HC.push(cost); HA.push(a); HB.push(b); HS.push(sa); HX.push(x); HY.push(y); HZ.push(z);
    var p = HP.length; HP.push(e);
    while (p > 0) { var pr = (p - 1) >> 1; if (HC[HP[pr]] <= HC[HP[p]]) break; var t = HP[pr]; HP[pr] = HP[p]; HP[p] = t; p = pr; }
  }
  function hpop() {
    var top = HP[0], last = HP.pop(); if (HP.length) { HP[0] = last; var p = 0;
      for (;;) { var l = p * 2 + 1, r = l + 1, s = p; if (l < HP.length && HC[HP[l]] < HC[HP[s]]) s = l; if (r < HP.length && HC[HP[r]] < HC[HP[s]]) s = r; if (s === p) break; var t = HP[s]; HP[s] = HP[p]; HP[p] = t; p = s; } }
    return top;
  }
  function plan(a, b) {                                                  // a 收進 b：位置（鎖住的那一端不動；都沒鎖 ⇒ 兩端、中點挑誤差小的）
    if (LOCK[a] && LOCK[b]) return;
    var C = [];
    if (LOCK[b]) C.push(b); else if (LOCK[a]) C.push(a); else if (CB[a] && !CB[b]) C.push(a); else if (CB[b] && !CB[a]) C.push(b); else C.push(a, b, -1);   // 顏色交界的點只沿著交界收（不被拉進一色的面裡）
    var bc = Infinity, bx = 0, by = 0, bz = 0;
    C.forEach(function (s) {
      var x = s < 0 ? (V[a * 3] + V[b * 3]) / 2 : V[s * 3], y = s < 0 ? (V[a * 3 + 1] + V[b * 3 + 1]) / 2 : V[s * 3 + 1], zz = s < 0 ? (V[a * 3 + 2] + V[b * 3 + 2]) / 2 : V[s * 3 + 2];
      var e2 = qerr(a, x, y, zz, b); if (e2 < bc) { bc = e2; bx = x; by = y; bz = zz; }
    });
    hpush(Math.max(0, bc) / Math.max(1e-9, QA[a] + QA[b]) * (CB[a] || CB[b] ? RM_ERRK : 1), a, b, STAMP[a] * 1e6 + STAMP[b], bx, by, bz);
  }
  function nbrs(v) { var s = new Set(); VT[v].forEach(function (t) { if (!ALIVE[t]) return; for (var q = 0; q < 3; q++) { var u = TRI[t * 3 + q]; if (u !== v) s.add(u); } }); return s; }
  for (j = 0; j < nt; j++) for (k = 0; k < 3; k++) { var pa = TRI[j * 3 + k], pb = TRI[j * 3 + (k + 1) % 3]; if (pa < pb) plan(pa, pb); }
  var live = nt, maxE = RM_ERR * RM_ERR, nA = [0, 0, 0], nB = [0, 0, 0];
  while (HP.length) {
    var e0 = hpop(), a1 = HA[e0], b1 = HB[e0];
    if (HC[e0] > maxE) break;
    if (HS[e0] !== STAMP[a1] * 1e6 + STAMP[b1]) continue;                // 兩端動過 ⇒ 舊的
    var NA = nbrs(a1), NB = nbrs(b1), common = 0; NA.forEach(function (u) { if (NB.has(u)) common++; });
    if (common !== 2) continue;                                          // 收了會變非流形
    var px = HX[e0], py = HY[e0], pz = HZ[e0], ok = true, save = [];
    [a1, b1].forEach(function (vv) {                                     // 翻面檢查：不含這條邊的三角形移過去之後法線跟原本同向
      if (!ok) return;
      VT[vv].forEach(function (t) {
        if (!ok || !ALIVE[t]) return; var ta = TRI[t * 3], tb = TRI[t * 3 + 1], tc = TRI[t * 3 + 2];
        if ((ta === a1 || tb === a1 || tc === a1) && (ta === b1 || tb === b1 || tc === b1)) return;
        tnorm(t, nA); var ox = V[vv * 3], oy = V[vv * 3 + 1], oz = V[vv * 3 + 2]; V[vv * 3] = px; V[vv * 3 + 1] = py; V[vv * 3 + 2] = pz; tnorm(t, nB); V[vv * 3] = ox; V[vv * 3 + 1] = oy; V[vv * 3 + 2] = oz;
        var la = Math.hypot(nA[0], nA[1], nA[2]), lb = Math.hypot(nB[0], nB[1], nB[2]);
        if (!(lb > 1e-9) || (nA[0] * nB[0] + nA[1] * nB[1] + nA[2] * nB[2]) < 0.3 * la * lb) ok = false;
      });
    });
    if (!ok) continue;
    // 收：a1 收進 b1
    VT[a1].forEach(function (t) {
      if (!ALIVE[t]) return; var hasB = TRI[t * 3] === b1 || TRI[t * 3 + 1] === b1 || TRI[t * 3 + 2] === b1;
      if (hasB) { ALIVE[t] = 0; live--; return; }
      for (var q = 0; q < 3; q++) if (TRI[t * 3 + q] === a1) TRI[t * 3 + q] = b1;
      VT[b1].push(t);
    });
    VT[a1] = []; V[b1 * 3] = px; V[b1 * 3 + 1] = py; V[b1 * 3 + 2] = pz;
    for (var h2 = 0; h2 < 3; h2++) VN[b1 * 3 + h2] = VN[b1 * 3 + h2] * QA[b1] + VN[a1 * 3 + h2] * QA[a1];
    var vl9 = Math.hypot(VN[b1 * 3], VN[b1 * 3 + 1], VN[b1 * 3 + 2]) || 1; for (h2 = 0; h2 < 3; h2++) VN[b1 * 3 + h2] /= vl9;
    for (h2 = 0; h2 < 10; h2++) Q[b1 * 10 + h2] += Q[a1 * 10 + h2];
    QA[b1] += QA[a1]; if (CB[a1]) CB[b1] = 1;
    if (LOCK[a1]) LOCK[b1] = 1;
    STAMP[a1]++; STAMP[b1]++;
    VT[b1] = VT[b1].filter(function (t) { return ALIVE[t]; });
    nbrs(b1).forEach(function (u) { plan(u, b1); });                     // 只有接著 b1 的邊變了（b1 換了位置、Q）；別的邊照舊（翻面在取出時才檢查）
  }
  var FT = []; for (j = 0; j < nt; j++) if (ALIVE[j]) FT.push(TRI[j * 3], TRI[j * 3 + 1], TRI[j * 3 + 2]);
  var nQ = FT.length / 3, t3 = Date.now();
  // ── 貼圖：照法線最大的那一軸分組、相連的成一片、投影、排進貼圖、回體素查色 ──
  var TN = [], TG = new Int8Array(nQ);
  for (j = 0; j < nQ; j++) {
    var A3 = FT[j * 3] * 3, B3 = FT[j * 3 + 1] * 3, C3 = FT[j * 3 + 2] * 3;
    var ux = V[B3] - V[A3], uy = V[B3 + 1] - V[A3 + 1], uz = V[B3 + 2] - V[A3 + 2], wx = V[C3] - V[A3], wy = V[C3 + 1] - V[A3 + 1], wz = V[C3 + 2] - V[A3 + 2];
    var nn = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx], ln = Math.hypot(nn[0], nn[1], nn[2]) || 1; nn = [nn[0] / ln, nn[1] / ln, nn[2] / ln];
    TN.push(nn); var m3 = 0; for (k = 1; k < 3; k++) if (Math.abs(nn[k]) > Math.abs(nn[m3])) m3 = k; TG[j] = m3 * 2 + (nn[m3] > 0 ? 1 : 0);
  }
  // 法線朝外還是朝裡：surface nets 的四邊形照「從實心往外」排 ⇒ 用第一個三角形試（往法線反方向半格是不是實心）
  var flipN = 0, tests = 0;
  for (j = 0; j < nQ && tests < 200; j += Math.max(1, (nQ / 200) | 0)) {
    var cxq = (V[FT[j * 3] * 3] + V[FT[j * 3 + 1] * 3] + V[FT[j * 3 + 2] * 3]) / 3, cyq = (V[FT[j * 3] * 3 + 1] + V[FT[j * 3 + 1] * 3 + 1] + V[FT[j * 3 + 2] * 3 + 1]) / 3, czq = (V[FT[j * 3] * 3 + 2] + V[FT[j * 3 + 1] * 3 + 2] + V[FT[j * 3 + 2] * 3 + 2]) / 3;
    var nn2 = TN[j]; tests++; if (solid(Math.floor(cxq + nn2[0] * 0.5), Math.floor(cyq + nn2[1] * 0.5), Math.floor(czq + nn2[2] * 0.5))) flipN++;
  }
  var inward = flipN > tests / 2;                                        // 法線朝實心 ⇒ 輸出時反過來
  // 分片：從還沒分的三角形（面積大的先）往外長，鄰居的法線在這一片投影軸上的分量 ≥ RM_CHART 就併進來（照最大軸硬切 ⇒ 45° 附近碎成幾千片）
  var EM = new Map(), TA = new Float64Array(nQ), CHID = new Int32Array(nQ).fill(-1), CH = [];
  for (j = 0; j < nQ; j++) for (k = 0; k < 3; k++) {
    var e1 = FT[j * 3 + k], e2 = FT[j * 3 + (k + 1) % 3], ekk = Math.min(e1, e2) * nv + Math.max(e1, e2), L5 = EM.get(ekk);
    if (L5) L5.push(j); else EM.set(ekk, [j]);
  }
  for (j = 0; j < nQ; j++) { var A6 = FT[j * 3] * 3, B6 = FT[j * 3 + 1] * 3, C6 = FT[j * 3 + 2] * 3, cr = [0, 0, 0];
    cr[0] = (V[B6 + 1] - V[A6 + 1]) * (V[C6 + 2] - V[A6 + 2]) - (V[B6 + 2] - V[A6 + 2]) * (V[C6 + 1] - V[A6 + 1]); cr[1] = (V[B6 + 2] - V[A6 + 2]) * (V[C6] - V[A6]) - (V[B6] - V[A6]) * (V[C6 + 2] - V[A6 + 2]); cr[2] = (V[B6] - V[A6]) * (V[C6 + 1] - V[A6 + 1]) - (V[B6 + 1] - V[A6 + 1]) * (V[C6] - V[A6]);
    TA[j] = Math.hypot(cr[0], cr[1], cr[2]); }
  var seeds = []; for (j = 0; j < nQ; j++) seeds.push(j); seeds.sort(function (p, q) { return TA[q] - TA[p]; });
  seeds.forEach(function (s0) {
    if (CHID[s0] >= 0) return;
    var g6 = TG[s0], ax6 = g6 >> 1, sg6 = g6 & 1 ? 1 : -1, ch = { t: [], g: g6, lo: [Infinity, Infinity], hi: [-Infinity, -Infinity] }, id = CH.length, st6 = [s0];
    CH.push(ch); CHID[s0] = id;
    while (st6.length) {
      var t6 = st6.pop(); ch.t.push(t6);
      for (var q6 = 0; q6 < 3; q6++) {
        var a6 = FT[t6 * 3 + q6], b6 = FT[t6 * 3 + (q6 + 1) % 3], L6 = EM.get(Math.min(a6, b6) * nv + Math.max(a6, b6));
        L6.forEach(function (u6) { if (CHID[u6] < 0 && TN[u6][ax6] * sg6 >= RM_CHART) { CHID[u6] = id; st6.push(u6); } });
      }
    }
  });
  CH.forEach(function (ch) {
    var ax2 = ch.g >> 1, u2 = (ax2 + 1) % 3, v2 = (ax2 + 2) % 3; ch.u = u2; ch.v = v2;
    ch.t.forEach(function (t) { for (var q = 0; q < 3; q++) { var vi = FT[t * 3 + q] * 3; ch.lo[0] = Math.min(ch.lo[0], V[vi + u2]); ch.hi[0] = Math.max(ch.hi[0], V[vi + u2]); ch.lo[1] = Math.min(ch.lo[1], V[vi + v2]); ch.hi[1] = Math.max(ch.hi[1], V[vi + v2]); } });
  });
  var TPV = 2, PAD = 2, W = RM_TW, placed = false;
  for (var tries = 0; tries < 6 && !placed; tries++, TPV /= 2) {         // 一格幾個貼圖格：2 起，排不下就減半
    var order = CH.slice().sort(function (p, q) { return (q.hi[1] - q.lo[1]) - (p.hi[1] - p.lo[1]); }), sx2 = 0, sy2 = 0, rowH = 0; placed = true;
    for (k = 0; k < order.length; k++) {
      var chk = order[k], w2 = Math.ceil((chk.hi[0] - chk.lo[0]) * TPV) + 1 + PAD * 2, h3 = Math.ceil((chk.hi[1] - chk.lo[1]) * TPV) + 1 + PAD * 2;
      if (w2 > W) { placed = false; break; }
      if (sx2 + w2 > W) { sx2 = 0; sy2 += rowH; rowH = 0; }
      if (sy2 + h3 > W) { placed = false; break; }
      chk.ox = sx2 + PAD; chk.oy = sy2 + PAD; chk.w = w2; chk.h = h3; sx2 += w2; rowH = Math.max(rowH, h3);
    }
    if (placed) break;
  }
  if (!placed) return null;
  var tex = new Uint8Array(W * W * 4), own = new Int32Array(W * W).fill(-1);
  function rgbOf(ci) { return m.mats[ci] || m.mats[0] || [1, 0, 1]; }
  function colNear(px2, py2, pz2, nn3) {                                 // 那一點往裡 0.3 格的位置，附近（半徑 1、不夠再 2）格心最近的實心格（一格厚的舷緣：平滑之後點移了半格，照「往裡半格那一格」會查到旁邊的殼）
    var qx0 = px2 - nn3[0] * 0.3, qy0 = py2 - nn3[1] * 0.3, qz0 = pz2 - nn3[2] * 0.3, gx2 = Math.floor(qx0), gy2 = Math.floor(qy0), gz2 = Math.floor(qz0);
    var bd = Infinity, bc2 = -1;
    for (var r2 = 1; r2 <= 2 && bc2 < 0; r2++) for (var ddz = -r2; ddz <= r2; ddz++) for (var ddy = -r2; ddy <= r2; ddy++) for (var ddx = -r2; ddx <= r2; ddx++) {
      var qx = gx2 + ddx, qy = gy2 + ddy, qz = gz2 + ddz; if (!solid(qx, qy, qz)) continue;
      var dd = Math.pow(qx + 0.5 - qx0, 2) + Math.pow(qy + 0.5 - qy0, 2) + Math.pow(qz + 0.5 - qz0, 2); if (dd < bd) { bd = dd; bc2 = CL[qx + nx * qy + nxy * qz]; }
    }
    return bc2;
  }
  CH.forEach(function (ch, ci) {
    ch.t.forEach(function (t) {
      var P2 = [0, 1, 2].map(function (q) { var vi = FT[t * 3 + q] * 3; return [(V[vi + ch.u] - ch.lo[0]) * TPV + ch.ox, (V[vi + ch.v] - ch.lo[1]) * TPV + ch.oy]; });
      var den = (P2[1][1] - P2[2][1]) * (P2[0][0] - P2[2][0]) + (P2[2][0] - P2[1][0]) * (P2[0][1] - P2[2][1]); if (Math.abs(den) < 1e-12) return;
      var x0 = Math.floor(Math.min(P2[0][0], P2[1][0], P2[2][0])), x1 = Math.ceil(Math.max(P2[0][0], P2[1][0], P2[2][0])), y0 = Math.floor(Math.min(P2[0][1], P2[1][1], P2[2][1])), y1 = Math.ceil(Math.max(P2[0][1], P2[1][1], P2[2][1]));
      for (var ty = y0; ty <= y1; ty++) for (var tx = x0; tx <= x1; tx++) {
        if (tx < 0 || ty < 0 || tx >= W || ty >= W) continue;
        var cxp = tx + 0.5, cyp = ty + 0.5, l0 = ((P2[1][1] - P2[2][1]) * (cxp - P2[2][0]) + (P2[2][0] - P2[1][0]) * (cyp - P2[2][1])) / den, l1 = ((P2[2][1] - P2[0][1]) * (cxp - P2[2][0]) + (P2[0][0] - P2[2][0]) * (cyp - P2[2][1])) / den, l2 = 1 - l0 - l1;
        if (l0 < -0.02 || l1 < -0.02 || l2 < -0.02) continue;
        var pt = [0, 1, 2].map(function (a) { return l0 * V[FT[t * 3] * 3 + a] + l1 * V[FT[t * 3 + 1] * 3 + a] + l2 * V[FT[t * 3 + 2] * 3 + a]; });
        var nn4 = inward ? TN[t].map(function (x) { return -x; }) : TN[t], cv = colNear(pt[0], pt[1], pt[2], nn4); if (cv < 0) continue;
        var rgb = rgbOf(cv), pp = (ty * W + tx) * 4; tex[pp] = Math.round(rgb[0] * 255); tex[pp + 1] = Math.round(rgb[1] * 255); tex[pp + 2] = Math.round(rgb[2] * 255); tex[pp + 3] = 255; own[ty * W + tx] = ci;
      }
    });
  });
  for (var it = 0; it < PAD + 1; it++) {                                 // 片的邊外擴（取樣在邊上不吃到別片／空白）
    var add = [];
    CH.forEach(function (ch, ci) {
      for (var ty2 = ch.oy - PAD; ty2 < ch.oy - PAD + ch.h; ty2++) for (var tx2 = ch.ox - PAD; tx2 < ch.ox - PAD + ch.w; tx2++) {
        if (tx2 < 0 || ty2 < 0 || tx2 >= W || ty2 >= W || own[ty2 * W + tx2] >= 0) continue;
        for (var q4 = 0; q4 < 4; q4++) { var qx2 = tx2 + [1, -1, 0, 0][q4], qy2 = ty2 + [0, 0, 1, -1][q4]; if (qx2 < 0 || qy2 < 0 || qx2 >= W || qy2 >= W || own[qy2 * W + qx2] !== ci) continue; add.push(ty2 * W + tx2, qy2 * W + qx2, ci); break; }
      }
    });
    for (var a4 = 0; a4 < add.length; a4 += 3) { var dst = add[a4], src = add[a4 + 1]; if (own[dst] >= 0) continue; for (var c4 = 0; c4 < 4; c4++) tex[dst * 4 + c4] = tex[src * 4 + c4]; own[dst] = add[a4 + 2]; }
  }
  var Lyr = shellLayer(tex), t4 = Date.now();
  // ── 輸出：每個三角形角的法線 ＝ 同一點周圍法線夾角 < 50° 的三角形加總（折角留著）──
  var VTF = []; for (i = 0; i < nv; i++) VTF.push(null);
  for (j = 0; j < nQ; j++) for (k = 0; k < 3; k++) { var vk = FT[j * 3 + k]; (VTF[vk] || (VTF[vk] = [])).push(j); }
  var out = [], COS = Math.cos(50 * Math.PI / 180), sgnO = inward ? -1 : 1;
  function M3(p) { return [o[0] + p[0] * c, o[1] + p[1] * c, o[2] + p[2] * c]; }
  CH.forEach(function (ch) {
    ch.t.forEach(function (t) {
      var idx = inward ? [0, 2, 1] : [0, 1, 2];
      idx.forEach(function (q) {
        var vi = FT[t * 3 + q], acc = [0, 0, 0], me2 = TN[t];
        VTF[vi].forEach(function (t2) { var n2 = TN[t2]; if (n2[0] * me2[0] + n2[1] * me2[1] + n2[2] * me2[2] >= COS) { acc[0] += n2[0]; acc[1] += n2[1]; acc[2] += n2[2]; } });
        var la = Math.hypot(acc[0], acc[1], acc[2]) || 1, p = M3([V[vi * 3], V[vi * 3 + 1], V[vi * 3 + 2]]);
        var u = ((V[vi * 3 + ch.u] - ch.lo[0]) * TPV + ch.ox) / W, v = ((V[vi * 3 + ch.v] - ch.lo[1]) * TPV + ch.oy) / W;
        var fx9 = sgnO * acc[0] / la, fy9 = sgnO * acc[1] / la, fz9 = sgnO * acc[2] / la, vx9 = VN[vi * 3], vy9 = VN[vi * 3 + 1], vz9 = VN[vi * 3 + 2];
        if (vx9 * sgnO * me2[0] + vy9 * sgnO * me2[1] + vz9 * sgnO * me2[2] >= 0.6) { fx9 = vx9; fy9 = vy9; fz9 = vz9; }   // surface nets 照佔格的平滑法線（減面前算的、收縮時加權平均）；跟這一面差太多（摺角）⇒ 照面法線
        out.push(p[0], p[1], p[2], fx9, fy9, fz9, -1 - u, v, Lyr);
      });
    });
  });
  var nSmooth = out.length / 27;
  boxes.forEach(function (b) {                                           // 方框：六面、平的法線、頂點色
    var rgb = rgbOf(b.col), L0 = b.g, L1 = [b.g[0] + b.d[0], b.g[1] + b.d[1], b.g[2] + b.d[2]];
    for (var ax3 = 0; ax3 < 3; ax3++) for (var s3 = 0; s3 < 2; s3++) {
      var u3 = (ax3 + 1) % 3, v3 = (ax3 + 2) % 3, nm = [0, 0, 0]; nm[ax3] = s3 ? 1 : -1;
      var cs = [[0, 0], [1, 0], [1, 1], [0, 1]].map(function (q) { var p = [0, 0, 0]; p[ax3] = s3 ? L1[ax3] : L0[ax3]; p[u3] = q[0] ? L1[u3] : L0[u3]; p[v3] = q[1] ? L1[v3] : L0[v3]; return M3(p); });
      var ord = s3 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      ord.forEach(function (q) { var p = cs[q]; out.push(p[0], p[1], p[2], nm[0], nm[1], nm[2], rgb[0], rgb[1], rgb[2]); });
    }
  });
  var R = new Float32Array(out); R.shellTex = tex;
  if (st) { st.cell = c; st.boxes = boxes.length; st.boxCells = boxes.reduce(function (s4, b) { return s4 + b.d[0] * b.d[1] * b.d[2]; }, 0); st.cells = G.s.reduce(function (s4, x) { return s4 + x; }, 0);
    st.fill = nfill; st.snTris = nSN; st.qemTris = nQ; st.charts = CH.length; st.tpv = TPV; st.tris = out.length / 27; st.smoothTris = nSmooth; st.inward = inward; st.layer = Lyr;
    st.ms = { vox_box: t1 - t0, sn: t2 - t1, qem: t3 - t2, tex: t4 - t3, out: Date.now() - t4 }; }
  return R;
}
