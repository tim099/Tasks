// ───────────────────────── 外殼式：平滑的低面數船殼＋體素顏色烤成貼圖（TASK-0820；Tim 2026-10-22）─────────────────────────
// Tim：「小艇 GO」「可以考慮表面合併成平滑的 並轉成貼圖嗎(外殼)」「不是2D貼圖 是3D mesh+voxel顏色轉貼圖」。
// 為什麼：小艇的船殼是一格厚的薄板彎成 U 形，體素的階梯讓三角形大半花在殼上（兩種小艇 10,930／8,278 個，全艦隊 26 艘 24.8 萬）；
//   車床式不對（不是旋轉體）、通用的網格簡化收不了（匯出的網格有 T 形接縫）。
// 哪幾件：模型 meta render=shell（62_lathe.js meshAlgo：照 meta 選算法；跟 render=lathe、pole 同一個入口）。
// 怎麼做（shellTris）：
//   · 體素：匯出的網格（軸對齊、格點座標）還原成格子 —— 每個面擋住它那一格邊界，從外框外面灌（flood fill）、灌不到的 ＝ 實心；顏色照貼著它的面。
//   · 軸：水平兩軸裡長的那一個是船長（a）、另一個是船寬（l）、z 朝上。沿 a 每一格一片截面。
//   · 每一片：中心 ＝ 船寬的中點、高 ＝ 兩舷舷緣頂；從中心往左水平、往下、到右水平打 SHELL_J × 2 ＋ 1 條射線，
//     從外面往裡走 ⇒ 第一次碰到實心 ＝ 外緣（r_out）、穿出實心 ＝ 內緣；殼厚 ＝ 每一條射線所有片的中位數（座板、地板接在殼上不會把殼撐厚）。
//     射不到東西的射線照同一片最近的那一條；整片射不到一半 ⇒ 那一片不算（船頭、船尾最尖的地方）。
//   · 片跟前後片、射線跟左右射線各平均一次（階梯 ⇒ 平順）；片照 Douglas–Peucker（SHELL_TOL 格）只留轉折的 ⇒ 外殼一圈一圈 loft 起來：
//     外面、裡面兩層（頂點自己的法線 ⇒ 光照平滑）＋舷緣頂一條＋頭尾兩個 U 形的端面。
//   · 貼圖：一份網格一層（SHELLT，256×256）；橫的 ＝ 每一片、直的 ＝ 射線的角度（一條射線分 SHELL_R 列）⇒ 外面那一格、裡面那一格、舷緣頂那一格的顏色。
//     頂點色欄 (−1−u, v, 層) ⇒ 模型的著色器（01_gl.js TRI_FS）照貼圖取色（最近的那一格 ⇒ 方塊的顏色邊）。
//   · 殼以外的格（座板、收著的槳、槳座、地板、船尾板）：照體素出方塊網格（同一面同一色合成大塊）；貼著殼的那一面不出。
// ⛔ 只換畫的那一份（GPU 的三角形）：佔格 occ、碰撞、站位照原本的網格 ⇒ 戰局不變。
var SHELL_J = 8, SHELL_R = 6, SHELL_TOL = 0.6, SHELL_TW = 256;
/** 匯出的網格 ⇒ 格子：{ c 一格多大, o 起點, n [nx, ny, nz], s 實心（0／1）, col 顏色（材質序號，-1 ＝ 沒有） }；不是軸對齊的格點網格 ⇒ null。 */
function shellVox(m) {
  var V = m.verts, T = m.tris, nv = V.length / 3, i, k, c = 0;
  if (!nv || !T.length) return null;
  for (var ci = 0, CC = [1, 0.5, 0.25, 0.2, 0.125, 0.1]; ci < CC.length && !c; ci++) { var cc = CC[ci], ok = true; for (i = 0; i < V.length && ok; i++) { var q = (V[i] - V[i % 3]) / cc; if (Math.abs(q - Math.round(q)) > 1e-4) ok = false; } if (ok) c = cc; }
  if (!c) {                                                              // 縮放過的模型（格不是上面那幾種大小）⇒ 最小的座標間距當一格、每個座標都要對得上
    var mn = Infinity; for (k = 0; k < 3; k++) { var xs = []; for (i = k; i < V.length; i += 3) xs.push(V[i]); xs.sort(function (p, q) { return p - q; }); for (i = 1; i < xs.length; i++) { var dd = xs[i] - xs[i - 1]; if (dd > 1e-6 && dd < mn) mn = dd; } }
    if (mn < Infinity) { var ok2 = true; for (i = 0; i < V.length && ok2; i++) { var q2 = (V[i] - V[i % 3]) / mn; if (Math.abs(q2 - Math.round(q2)) > 1e-3) ok2 = false; } if (ok2) c = mn; }
  }
  if (!c) return null;
  var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (i = 0; i < nv; i++) for (k = 0; k < 3; k++) { var x = V[i * 3 + k]; if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x; }
  var o = [lo[0] - c, lo[1] - c, lo[2] - c], n = [0, 1, 2].map(function (a) { return Math.round((hi[a] - lo[a]) / c) + 2; });   // 外面多一圈空的（灌水從那裡開始）
  if (n[0] * n[1] * n[2] > 4e6) return null;
  var nx = n[0], ny = n[1], nxy = nx * ny, N = nxy * n[2];
  var B = [new Uint8Array(N), new Uint8Array(N), new Uint8Array(N)], BC = [new Int16Array(N).fill(-1), new Int16Array(N).fill(-1), new Int16Array(N).fill(-1)];   // B[a][格] ＝ 那一格 a 軸低的那一面有沒有被擋（BC：那一面的色）
  for (var t = 0; t < T.length; t += 3) {
    var P = [0, 1, 2].map(function (j) { var b = T[t + j] * 3; return [(V[b] - o[0]) / c, (V[b + 1] - o[1]) / c, (V[b + 2] - o[2]) / c]; });
    var ax = -1; for (k = 0; k < 3; k++) if (Math.abs(P[0][k] - P[1][k]) < 1e-4 && Math.abs(P[0][k] - P[2][k]) < 1e-4) ax = k;
    if (ax < 0) return null;                                              // 斜的面（不是方塊匯出的網格）
    var u = (ax + 1) % 3, w = (ax + 2) % 3, L = Math.round(P[0][ax]), col = m.tmat[t / 3];
    var u0 = Math.floor(Math.min(P[0][u], P[1][u], P[2][u])), u1 = Math.ceil(Math.max(P[0][u], P[1][u], P[2][u])), w0 = Math.floor(Math.min(P[0][w], P[1][w], P[2][w])), w1 = Math.ceil(Math.max(P[0][w], P[1][w], P[2][w]));
    for (var pu = u0; pu < u1; pu++) for (var pw = w0; pw < w1; pw++) {
      var cu = pu + 0.5, cw = pw + 0.5, s0 = 0, s1 = 0;                  // 格心在三角形裡（投影到那一面）
      for (k = 0; k < 3; k++) { var A = P[k], Bq = P[(k + 1) % 3], e = (Bq[u] - A[u]) * (cw - A[w]) - (Bq[w] - A[w]) * (cu - A[u]); if (e > 1e-9) s0++; else if (e < -1e-9) s1++; }
      if (s0 && s1) continue;
      var g = [0, 0, 0]; g[ax] = L; g[u] = pu; g[w] = pw;
      var ix = g[0] + nx * g[1] + nxy * g[2]; B[ax][ix] = 1; BC[ax][ix] = col;
    }
  }
  // 灌水：從外框的角落，碰到被擋的面就停 ⇒ 灌不到的 ＝ 實心
  var out = new Uint8Array(N), st = [0], X, Y, Z; out[0] = 1;
  while (st.length) {
    var p = st.pop(); X = p % nx; Y = ((p / nx) | 0) % ny; Z = (p / nxy) | 0;
    if (X > 0 && !out[p - 1] && !B[0][p]) { out[p - 1] = 1; st.push(p - 1); }
    if (X < nx - 1 && !out[p + 1] && !B[0][p + 1]) { out[p + 1] = 1; st.push(p + 1); }
    if (Y > 0 && !out[p - nx] && !B[1][p]) { out[p - nx] = 1; st.push(p - nx); }
    if (Y < ny - 1 && !out[p + nx] && !B[1][p + nx]) { out[p + nx] = 1; st.push(p + nx); }
    if (Z > 0 && !out[p - nxy] && !B[2][p]) { out[p - nxy] = 1; st.push(p - nxy); }
    if (Z < n[2] - 1 && !out[p + nxy] && !B[2][p + nxy]) { out[p + nxy] = 1; st.push(p + nxy); }
  }
  var s = new Uint8Array(N), cl = new Int16Array(N).fill(-1), D = [1, nx, nxy];
  for (i = 0; i < N; i++) s[i] = out[i] ? 0 : 1;
  for (var a = 0; a < 3; a++) for (i = 0; i < N; i++) {                  // 顏色：擋住的那一面的色給它實心的那一邊（兩邊都實心 ⇒ 都給）
    var bc = BC[a][i]; if (bc < 0) continue;
    if (s[i] && cl[i] < 0) cl[i] = bc;
    var j2 = i - D[a]; if (j2 >= 0 && s[j2] && cl[j2] < 0) cl[j2] = bc;
  }
  for (var pass = 0, left = 1; left && pass < 64; pass++) {             // 包在裡面、沒貼著面的格 ⇒ 照旁邊有色的
    left = 0;
    for (i = 0; i < N; i++) if (s[i] && cl[i] < 0) {
      for (a = 0; a < 6 && cl[i] < 0; a++) { var j3 = i + (a & 1 ? D[a >> 1] : -D[a >> 1]); if (j3 >= 0 && j3 < N && s[j3] && cl[j3] >= 0) cl[i] = cl[j3]; }
      if (cl[i] < 0) left = 1;
    }
  }
  return { c: c, o: o, n: n, s: s, col: cl };
}
/** 貼圖層（一份網格一層、SHELL_TW × SHELL_TW RGBA）：內容一樣的共用一層（雜湊）⇒ 重算同一份網格拿到同一層。綁在第 18 號（TRI_FS uMdlT；01_gl.js setCommon）。 */
var SHELLT = { tex: null, cap: 0, L: [], key: {} };
function shellTexInit() {                                                // programs()：先給一張 1 層的空陣列（沒有外殼的船也要有東西綁著，免得取樣器型別撞號）
  if (typeof gl === 'undefined' || !gl) return;
  shellTexAlloc(1);
}
function shellTexAlloc(cap) {
  if (SHELLT.tex) gl.deleteTexture(SHELLT.tex);
  var t = SHELLT.tex = gl.createTexture(); SHELLT.cap = cap;
  gl.activeTexture(gl.TEXTURE18); gl.bindTexture(gl.TEXTURE_2D_ARRAY, t); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, SHELL_TW, SHELL_TW, cap, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D_ARRAY, p, gl.NEAREST); });
  [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D_ARRAY, p, gl.CLAMP_TO_EDGE); });
  SHELLT.L.forEach(function (d, k) { gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, k, SHELL_TW, SHELL_TW, 1, gl.RGBA, gl.UNSIGNED_BYTE, d); });
  gl.activeTexture(gl.TEXTURE0);
}
/** 這一張貼圖（SHELL_TW² × 4 位元組）在第幾層；沒有 ⇒ 加一層（滿了 ⇒ 加倍重建、全部重傳）。沒有 GL（Worker、node）⇒ 照雜湊編號、不上傳。 */
function shellLayer(d) {
  var h = 2166136261; for (var i = 0; i < d.length; i += 7) h = Math.imul(h ^ d[i], 16777619);
  var key = (h >>> 0) + ':' + d.length, L = SHELLT.key[key];
  if (L !== undefined) return L;
  L = SHELLT.key[key] = SHELLT.L.length; SHELLT.L.push(d);
  if (typeof gl === 'undefined' || !gl) return L;
  if (!SHELLT.tex || L >= SHELLT.cap) shellTexAlloc(Math.max(4, SHELLT.cap * 2));
  else { gl.activeTexture(gl.TEXTURE18); gl.bindTexture(gl.TEXTURE_2D_ARRAY, SHELLT.tex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, L, SHELL_TW, SHELL_TW, 1, gl.RGBA, gl.UNSIGNED_BYTE, d); gl.activeTexture(gl.TEXTURE0); }
  return L;
}
/** 快取讀回來的三角形（06_cache.js；層是上一次載入時排的）⇒ 照這一次的層改頂點色欄的第三格（tri.shellTex 是那一張貼圖）。 */
function shellRelayer(tri, tex) {
  var L = shellLayer(tex);
  for (var i = 6; i < tri.length; i += 9) if (tri[i] < -0.5) tri[i + 2] = L;
  return tri;
}
/** 一份網格 ⇒ 外殼式的三角形（跟 meshTris 同一種排法：每個頂點 位置 3、法線 3、色 3；貼圖的頂點色 ＝ (−1−u, v, 層)）；回傳的陣列帶 .shellTex（那一層的 RGBA）。
 *  做不出來（不是方塊網格、射得到的片太少、太大）⇒ null（照原本的）。st 給了 ⇒ 填讀數。 */
var SHELL_MEMO = {};
function shellTris(m, st) {
  // 同一個形狀（頂點照第一個頂點的相對位置、三角形、色）算過 ⇒ 平移過去（好幾型船用同一艘小艇：一次載入只算一次）
  var V = m.verts, h = 2166136261, x0 = V[0], y0 = V[1], z0 = V[2], i;
  if (!V.length) return null;
  for (i = 0; i < V.length; i += 3) { h = Math.imul(h ^ Math.round((V[i] - x0) * 64), 16777619); h = Math.imul(h ^ Math.round((V[i + 1] - y0) * 64), 16777619); h = Math.imul(h ^ Math.round((V[i + 2] - z0) * 64), 16777619); }
  for (i = 0; i < m.tris.length; i++) h = Math.imul(h ^ m.tris[i], 16777619);
  for (i = 0; i < m.tmat.length; i++) h = Math.imul(h ^ m.tmat[i], 16777619);
  var key = (h >>> 0) + ':' + V.length + ':' + m.tris.length + ':' + JSON.stringify(m.mats), hit = SHELL_MEMO[key];
  if (!hit) { var st0 = {}, R0 = shellBuild(m, st0); hit = SHELL_MEMO[key] = { R: R0, st: st0, o: [x0, y0, z0] }; }
  if (st) for (var k in hit.st) st[k] = hit.st[k];
  if (!hit.R) return null;
  var R = new Float32Array(hit.R), dx = x0 - hit.o[0], dy = y0 - hit.o[1], dz = z0 - hit.o[2];
  if (dx || dy || dz) for (i = 0; i < R.length; i += 9) { R[i] += dx; R[i + 1] += dy; R[i + 2] += dz; }
  R.shellTex = hit.R.shellTex;
  return R;
}
function shellBuild(m, st) {
  var G = shellVox(m); if (!G) return null;
  var c = G.c, o = G.o, n = G.n, nx = n[0], nxy = n[0] * n[1], S = G.s, CL = G.col;
  var a = n[0] >= n[1] ? 0 : 1, l = 1 - a, J2 = SHELL_J * 2, NR = J2 + 1, i, j, k, s;
  var DA = a ? nx : 1, DL = a ? 1 : nx, NA0 = n[a], NL0 = n[l], NZ0 = n[2];
  function at(pa, pl, pz) { return pa < 0 || pl < 0 || pz < 0 || pa >= NA0 || pl >= NL0 || pz >= NZ0 ? -1 : pa * DA + pl * DL + pz * nxy; }
  function solid(pa, pl, pz) { var ix = at(pa, pl, pz); return ix >= 0 && S[ix]; }
  // 每一片：船寬的範圍、舷緣頂（兩舷最外面兩格以內最高的那一格）
  var NA = n[a], sl = [];
  for (s = 0; s < NA; s++) {
    var l0 = Infinity, l1 = -Infinity;
    for (var pl = 0; pl < n[l]; pl++) for (var pz = 0; pz < n[2]; pz++) if (solid(s, pl, pz)) { if (pl < l0) l0 = pl; if (pl > l1) l1 = pl; }
    if (l0 > l1) { sl.push(null); continue; }
    var zt = -1;
    for (pl = 0; pl < n[l]; pl++) if (pl <= l0 + 2 || pl >= l1 - 2) for (pz = n[2] - 1; pz > zt; pz--) if (solid(s, pl, pz)) { zt = pz; break; }
    sl.push({ yc: (l0 + l1 + 1) / 2, zt: zt + 1 });
  }
  var s0 = 0, s1 = NA - 1; while (s0 < NA && !sl[s0]) s0++; while (s1 >= 0 && !sl[s1]) s1--;
  if (s0 >= s1) return null;
  for (s = s0; s <= s1; s++) if (!sl[s]) sl[s] = { yc: sl[s - 1].yc, zt: sl[s - 1].zt };
  var YC = [], ZT = [];
  for (s = s0; s <= s1; s++) {                                          // 中心、舷緣頂照前後 2 片平均（船頭翹起來那一段照樣平順）
    var sy = 0, sz = 0, cn = 0;
    for (k = Math.max(s0, s - 2); k <= Math.min(s1, s + 2); k++) { sy += sl[k].yc; sz += sl[k].zt; cn++; }
    YC[s] = sy / cn; ZT[s] = sz / cn;
  }
  var DIR = []; for (j = 0; j < NR; j++) { var th0 = Math.PI * j / J2; DIR.push([-Math.cos(th0), -Math.sin(th0)]); }   // 第 j 條射線（l、z）：0 ＝ 往 l 負的水平、J ＝ 往下、2J ＝ 往 l 正的水平
  function dir(j) { return DIR[j]; }
  var RO = [], RI = [], OK = [];
  for (s = s0; s <= s1; s++) {
    var ro = new Float64Array(NR), ri = new Float64Array(NR), ok = new Uint8Array(NR), cy = YC[s], cz = ZT[s] - 0.5, nok = 0;
    for (j = 0; j < NR; j++) {
      var d = DIR[j], hit = -1, tl = d[0] < -1e-9 ? cy / -d[0] : d[0] > 1e-9 ? (NL0 - cy) / d[0] : Infinity, tz = d[1] < -1e-9 ? cz / -d[1] : Infinity, t = Math.min(tl, tz);   // 從射線離開外框的地方往裡走
      var base = s * DA, dl = d[0], dz0 = d[1];
      for (; t > 0; t -= 0.25) { var yy = Math.floor(cy + dl * t), zz = Math.floor(cz + dz0 * t); if (yy >= 0 && zz >= 0 && yy < NL0 && zz < NZ0 && S[base + yy * DL + zz * nxy]) { hit = t; break; } }
      if (hit < 0) continue;
      for (t = hit; t > 0; t -= 0.25) { var y3 = Math.floor(cy + dl * t), z3 = Math.floor(cz + dz0 * t); if (!(y3 >= 0 && z3 >= 0 && y3 < NL0 && z3 < NZ0 && S[base + y3 * DL + z3 * nxy])) break; }
      ro[j] = hit + 0.125; ri[j] = Math.max(0, t + 0.125); ok[j] = 1; nok++;
    }
    if (nok * 2 < NR) { RO[s] = null; continue; }
    for (j = 0; j < NR; j++) if (!ok[j]) {                             // 射不到 ⇒ 同一片最近的那一條
      for (k = 1; k < NR; k++) { var jj = j - k >= 0 && ok[j - k] ? j - k : j + k < NR && ok[j + k] ? j + k : -1; if (jj >= 0) { ro[j] = ro[jj]; ri[j] = ri[jj]; break; } }
    }
    RO[s] = ro; RI[s] = ri; OK[s] = ok;
  }
  while (s0 <= s1 && !RO[s0]) s0++; while (s1 >= s0 && !RO[s1]) s1--;
  if (s1 - s0 < 2) return null;
  for (s = s0; s <= s1; s++) if (!RO[s]) { RO[s] = RO[s - 1].slice(); RI[s] = RI[s - 1].slice(); OK[s] = new Uint8Array(NR); }
  var TH = new Float64Array(NR);                                        // 殼厚：每一條射線所有片的中位數
  for (j = 0; j < NR; j++) {
    var L = []; for (s = s0; s <= s1; s++) if (OK[s][j]) L.push(RO[s][j] - RI[s][j]);
    L.sort(function (x, y) { return x - y; }); TH[j] = L.length ? Math.max(0.75, L[L.length >> 1]) : 1;
  }
  // 平順：片跟前後片、射線跟左右射線各一次 [1 2 1]
  function smooth(A) {
    var B2 = [], s2, j2;
    for (s2 = s0; s2 <= s1; s2++) { B2[s2] = new Float64Array(NR); for (j2 = 0; j2 < NR; j2++) { var p0 = A[Math.max(s0, s2 - 1)][j2], p2 = A[Math.min(s1, s2 + 1)][j2]; B2[s2][j2] = (p0 + 2 * A[s2][j2] + p2) / 4; } }
    for (s2 = s0; s2 <= s1; s2++) { var r = B2[s2], q = new Float64Array(NR); for (j2 = 0; j2 < NR; j2++) q[j2] = (r[Math.max(0, j2 - 1)] + 2 * r[j2] + r[Math.min(NR - 1, j2 + 1)]) / 4; A[s2] = q; }
  }
  var RS = []; for (s = s0; s <= s1; s++) RS[s] = RO[s].slice();
  smooth(RS);
  // 頂點（格座標：a、l、z）：外面 r、裡面 r − 殼厚；j ＝ 0、2J 那兩條是舷緣頂（往上抬半格到頂面）
  function P3(s2, j2, r) {
    var d2 = dir(j2), y = YC[s2] + d2[0] * r, z = ZT[s2] - 0.5 + d2[1] * r + (j2 === 0 || j2 === J2 ? 0.5 : 0), g = [0, 0, 0];
    g[a] = s2 + 0.5; g[l] = y; g[2] = z; return g;
  }
  // 片照 Douglas–Peucker 只留轉折的（誤差 ＝ 外面每個頂點跟前後兩片直線內插的距離）
  var PY = [], PZ = [];
  for (s = s0; s <= s1; s++) { var py = PY[s] = new Float64Array(NR), pzz = PZ[s] = new Float64Array(NR); for (j = 0; j < NR; j++) { var q0 = P3(s, j, RS[s][j]); py[j] = q0[l]; pzz[j] = q0[2]; } }
  var keep = {}; keep[s0] = keep[s1] = 1;
  (function dp(b0, b1) {
    if (b1 - b0 < 2) return;
    var mx = 0, mi = -1;
    for (var b = b0 + 1; b < b1; b++) {
      var f = (b - b0) / (b1 - b0), e = 0;
      for (var j2 = 0; j2 < NR; j2++) {
        e = Math.max(e, Math.hypot(PY[b0][j2] + (PY[b1][j2] - PY[b0][j2]) * f - PY[b][j2], PZ[b0][j2] + (PZ[b1][j2] - PZ[b0][j2]) * f - PZ[b][j2]));
      }
      if (e > mx) { mx = e; mi = b; }
    }
    if (mx > SHELL_TOL) { keep[mi] = 1; dp(b0, mi); dp(mi, b1); }
  })(s0, s1);
  var KS = Object.keys(keep).map(Number).sort(function (x, y) { return x - y; });
  // 貼圖：橫 ＝ 片（s − s0）、直：外面 [0, Q)、裡面 [Q, 2Q)、舷緣頂 2Q；一條射線 SHELL_R 列
  var NS = s1 - s0 + 1, Q = J2 * SHELL_R + 1, TW = SHELL_TW;
  if (NS > TW || 2 * Q + 1 > TW) return null;
  var tex = new Uint8Array(TW * TW * 4);
  function rgbOf(ci) { return m.mats[ci] || m.mats[0] || [1, 0, 1]; }
  function texel(x, y, ci) { var rgb = rgbOf(ci), p = (y * TW + x) * 4; tex[p] = Math.round(rgb[0] * 255); tex[p + 1] = Math.round(rgb[1] * 255); tex[p + 2] = Math.round(rgb[2] * 255); tex[p + 3] = 255; }
  function colAt(s2, y, z) { var ix = at(s2, Math.floor(y), Math.floor(z)); return ix >= 0 && S[ix] ? CL[ix] : -1; }
  var DDQ = []; for (var q1 = 0; q1 < Q; q1++) { var th1 = Math.PI * q1 / SHELL_R / J2; DDQ.push([-Math.cos(th1), -Math.sin(th1)]); }
  var TOPC = [];                                                         // 每一片頂上那一排每一色幾格
  for (s = s0; s <= s1; s++) { var tc = TOPC[s] = {}; for (var y2 = 0; y2 < n[l]; y2++) { var c2 = colAt(s, y2, ZT[s] - 0.5); if (c2 >= 0) tc[c2] = (tc[c2] || 0) + 1; } }
  for (s = s0; s <= s1; s++) {
    var cy2 = YC[s], cz2 = ZT[s] - 0.5, lastO = 0, lastI = 0;
    for (var q2 = 0; q2 < Q; q2++) {
      var jf = q2 / SHELL_R, th = Math.PI * jf / J2, dd = DDQ[q2], j0 = Math.min(NR - 2, Math.floor(jf)), f2 = jf - j0;
      var r0 = RO[s][j0] * (1 - f2) + RO[s][j0 + 1] * f2, r1 = RI[s][j0] * (1 - f2) + RI[s][j0 + 1] * f2, co = -1, ci = -1;
      for (var tt = r0 + 0.5; tt >= r1 - 0.5 && co < 0; tt -= 0.25) co = colAt(s, cy2 + dd[0] * tt, cz2 + dd[1] * tt);   // 外面：從外往裡第一個有色的
      for (tt = r1 - 0.5; tt <= r0 + 0.5 && ci < 0; tt += 0.25) ci = colAt(s, cy2 + dd[0] * tt, cz2 + dd[1] * tt);       // 裡面：從裡往外
      if (co < 0) co = lastO; if (ci < 0) ci = lastI; lastO = co; lastI = ci;
      texel(s - s0, q2, co); texel(s - s0, Q + q2, ci);
    }
    var ct = -1, cn2 = {};                                                // 舷緣頂：前後 2 片頂上那一排最多的色（一片一片取 ⇒ 兩色的飾條會跳色）
    for (var s3 = Math.max(s0, s - 2); s3 <= Math.min(s1, s + 2); s3++) for (var c4 in TOPC[s3]) cn2[c4] = (cn2[c4] || 0) + TOPC[s3][c4];
    Object.keys(cn2).forEach(function (c3) { if (ct < 0 || cn2[c3] > cn2[ct]) ct = +c3; });
    texel(s - s0, 2 * Q, ct >= 0 ? ct : lastO);
  }
  var Lyr = shellLayer(tex);
  // 殼的格（外緣往外半格到裡面 r − 殼厚 再往裡半格之間、在中心以下的）⇒ 殼以外的實心另外出方塊
  var SH = new Uint8Array(S.length);
  for (s = s0; s <= s1; s++) {
    var cy3 = YC[s], cz3 = ZT[s] - 0.5;
    for (pl = 0; pl < NL0; pl++) for (pz = 0; pz < NZ0; pz++) {
      var ix2 = s * DA + pl * DL + pz * nxy; if (!S[ix2]) continue;
      var dy = pl + 0.5 - cy3, dz = pz + 0.5 - cz3;
      if (dz > 0.5) continue;
      var r = Math.hypot(dy, dz), th2 = Math.atan2(-Math.min(dz, 0), -dy), jf2 = Math.max(0, Math.min(J2, th2 / Math.PI * J2)), jj0 = Math.min(NR - 2, Math.floor(jf2)), ff = jf2 - jj0;
      var ro2 = RO[s][jj0] * (1 - ff) + RO[s][jj0 + 1] * ff, th3 = TH[jj0] * (1 - ff) + TH[jj0 + 1] * ff;
      if (r <= ro2 + 0.75 && r >= ro2 - th3 - 0.75) SH[ix2] = 1;
    }
  }
  var out = [];
  function U(s2) { return -1 - (s2 - s0 + 0.5) / TW; }
  function Vt(row) { return (row + 0.5) / TW; }
  function M3(g) { return [o[0] + g[0] * c, o[1] + g[1] * c, o[2] + g[2] * c]; }
  function push(p, nm, cv) { var q = M3(p); out.push(q[0], q[1], q[2], nm[0], nm[1], nm[2], cv[0], cv[1], cv[2]); }
  function nrm(v) { var h = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / h, v[1] / h, v[2] / h]; }
  function sub3(p, q) { return [p[0] - q[0], p[1] - q[1], p[2] - q[2]]; }
  function crs(p, q) { return [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]; }
  // 外、裡兩層的格點與頂點法線（照相鄰四邊形的面法線加總；外面朝外、裡面朝船裡）
  var NK = KS.length, GO = [], GI = [];
  for (k = 0; k < NK; k++) { s = KS[k]; GO[k] = []; GI[k] = []; for (j = 0; j < NR; j++) { GO[k][j] = P3(s, j, RS[s][j]); GI[k][j] = P3(s, j, Math.max(0, RS[s][j] - TH[j])); } }
  function vnorm(Gd, k2, j2, sg) {
    var acc = [0, 0, 0];
    for (var dk = -1; dk <= 0; dk++) for (var dj = -1; dj <= 0; dj++) {
      var ka = k2 + dk, ja = j2 + dj; if (ka < 0 || ja < 0 || ka + 1 >= NK || ja + 1 >= NR) continue;
      var nf = crs(sub3(Gd[ka + 1][ja], Gd[ka][ja]), sub3(Gd[ka][ja + 1], Gd[ka][ja])), h = Math.hypot(nf[0], nf[1], nf[2]);
      if (h > 0) { acc[0] += nf[0] / h; acc[1] += nf[1] / h; acc[2] += nf[2] / h; }
    }
    var v = nrm(acc); return [v[0] * sg, v[1] * sg, v[2] * sg];
  }
  // 外面的方向：中心那一條射線往下 ⇒ 外法線朝下；照它定號
  var tst = crs(sub3(GO[1][SHELL_J], GO[0][SHELL_J]), sub3(GO[0][SHELL_J + 1], GO[0][SHELL_J])), sgO = tst[2] < 0 ? 1 : -1;
  function surf(Gd, sg, row0) {
    var NN = []; for (k = 0; k < NK; k++) { NN[k] = []; for (j = 0; j < NR; j++) NN[k][j] = vnorm(Gd, k, j, sg); }
    for (k = 0; k + 1 < NK; k++) for (j = 0; j + 1 < NR; j++) {
      var A = [k, j], Bv = [k + 1, j], C2 = [k + 1, j + 1], D2 = [k, j + 1], Lq = sg > 0 ? [A, Bv, C2, A, C2, D2] : [A, D2, C2, A, C2, Bv];
      Lq.forEach(function (e) { push(Gd[e[0]][e[1]], NN[e[0]][e[1]], [U(KS[e[0]]), Vt(row0 + e[1] * SHELL_R), Lyr]); });
    }
  }
  surf(GO, sgO, 0); surf(GI, -sgO, Q);
  function flat(A, Bq, Cq, Dq, cv, want) {                              // 平的四邊形（法線照 want 那一邊）
    var nf = nrm(crs(sub3(Bq, A), sub3(Cq, A)));
    if (nf[0] * want[0] + nf[1] * want[1] + nf[2] * want[2] < 0) { var x = Bq; Bq = Dq; Dq = x; nf = [-nf[0], -nf[1], -nf[2]]; }
    [A, Bq, Cq, A, Cq, Dq].forEach(function (p, ii) { push(p, nf, cv[ii]); });
  }
  var up = [0, 0, 1];
  for (k = 0; k + 1 < NK; k++) [0, J2].forEach(function (j2) {              // 舷緣頂：外 j ＝ 0（2J）到裡 j ＝ 0（2J）
    var cv0 = [U(KS[k]), Vt(2 * Q), Lyr], cv1 = [U(KS[k + 1]), Vt(2 * Q), Lyr];
    flat(GO[k][j2], GO[k + 1][j2], GI[k + 1][j2], GI[k][j2], [cv0, cv1, cv1, cv0, cv1, cv0], up);
  });
  [0, NK - 1].forEach(function (k2) {                                   // 頭尾的端面：U 形的那一條（外 j 到裡 j）
    var want = [0, 0, 0]; want[a] = k2 ? 1 : -1;
    for (j = 0; j + 1 < NR; j++) {
      var cvA = [U(KS[k2]), Vt(j * SHELL_R), Lyr], cvB = [U(KS[k2]), Vt((j + 1) * SHELL_R), Lyr];
      flat(GO[k2][j], GO[k2][j + 1], GI[k2][j + 1], GI[k2][j], [cvA, cvB, cvB, cvA, cvB, cvA], want);
    }
  });
  var nShell = out.length / 27;
  // 殼以外的實心：方塊網格（同一平面、同一色合成長方形；貼著實心（殼或別的格）的面不出）
  var FB = {}, STR = [1, nx, nxy];                                       // 露出來的面照（軸、朝向、層）分桶：只從殼以外的格出發
  for (i = 0; i < S.length; i++) {
    if (!S[i] || SH[i]) continue;
    var gx = i % nx, gy = ((i / nx) | 0) % n[1], gz = (i / nxy) | 0, gg = [gx, gy, gz];
    for (var f6 = 0; f6 < 6; f6++) {
      var ax6 = f6 >> 1, sg6 = f6 & 1 ? 1 : -1, nb6 = gg[ax6] + sg6;
      if (nb6 >= 0 && nb6 < n[ax6] && S[i + sg6 * STR[ax6]]) continue;
      var kb = f6 * 4096 + gg[ax6], bk = FB[kb] || (FB[kb] = []);
      bk.push(gg[(ax6 + 1) % 3], gg[(ax6 + 2) % 3], CL[i] >= 0 ? CL[i] : 0);
    }
  }
  Object.keys(FB).map(Number).sort(function (x, y) { return x - y; }).forEach(function (kb) {
    var f6 = Math.floor(kb / 4096), L2 = kb % 4096, ax = f6 >> 1, sgn = f6 & 1 ? 1 : -1, u2 = (ax + 1) % 3, w2 = (ax + 2) % 3, Lf = FB[kb], iu, iw;
    var mask = new Int16Array(n[u2] * n[w2]).fill(-1);
    for (var q4 = 0; q4 < Lf.length; q4 += 3) mask[Lf[q4] + n[u2] * Lf[q4 + 1]] = Lf[q4 + 2];
    {
      for (iw = 0; iw < n[w2]; iw++) for (iu = 0; iu < n[u2];) {
        var mc = mask[iu + n[u2] * iw]; if (mc < 0) { iu++; continue; }
        var wu = 1; while (iu + wu < n[u2] && mask[iu + wu + n[u2] * iw] === mc) wu++;
        var ww = 1, okw = true;
        while (iw + ww < n[w2] && okw) { for (var q3 = 0; q3 < wu; q3++) if (mask[iu + q3 + n[u2] * (iw + ww)] !== mc) { okw = false; break; } if (okw) ww++; }
        for (var e1 = 0; e1 < ww; e1++) for (var e2 = 0; e2 < wu; e2++) mask[iu + e2 + n[u2] * (iw + e1)] = -1;
        var Lp = L2 + (sgn > 0 ? 1 : 0), cs = function (du, dw) { var p = [0, 0, 0]; p[ax] = Lp; p[u2] = iu + du; p[w2] = iw + dw; return p; };
        var nm = [0, 0, 0], rgb = rgbOf(mc); nm[ax] = sgn;
        var Aq = cs(0, 0), Bq2 = cs(wu, 0), Cq2 = cs(wu, ww), Dq2 = cs(0, ww);
        flat(Aq, Bq2, Cq2, Dq2, [rgb, rgb, rgb, rgb, rgb, rgb], nm);
        iu += wu;
      }
    }
  });
  var R = new Float32Array(out); R.shellTex = tex;
  if (st) { st.cell = c; st.axis = a; st.slices = NS; st.kept = NK; st.shellTris = nShell; st.restTris = out.length / 27 - nShell; st.tris = out.length / 27; st.layer = Lyr; st.th = Array.from(TH).map(function (x) { return +x.toFixed(2); }); }
  return R;
}
