// ───────────────────────── 長桿式的低面數網格（TASK-0815；Tim 2026-10-22）─────────────────────────
// Tim：「燈籠維持原本的吧 獎先做看看」「然後可以特化網格算法」「應該說可以用meta標記要套用哪種算法」。（跟 77_colours.js 的旗桿 poleBuf 無關）
// 為什麼：槳是斜放的細長桿子，體素的階梯讓一支槳上千個三角形（雷亞爾號 1,580 × 64 支 ＝ 10 萬，比船殼還多）；
//   車床式不對（槳葉是扁的）、通用的網格簡化收不了（匯出的網格同一平面合成一大片、邊上接小片 ⇒ T 形接縫）。
// 哪幾件：模型 meta render=pole（62_lathe.js meshAlgo：照 meta 選算法；跟 render=lathe 同一個入口）。
// 怎麼做（poleTris）：
//   · 軸：三角形照面積加權的中心做 PCA ⇒ 最長的那個方向是桿子（斜的也行）；另外兩個方向是截面的兩個軸（扁的槳葉自己會對齊其中一個）。
//   · 片：沿軸每 POLE_DS 格一片；每個三角形跟每一片的交集（兩個平面裁）⇒ 那一片截面兩個軸的最小、最大；側面（法線跟軸夾角大）照面積記顏色。
//   · 片跟前後一片平均一次（階梯 ⇒ 平順）；換色的地方一定斷；同一色裡照四條邊界（兩軸的最小、最大）做 Douglas–Peucker（POLE_TOL）⇒ 幾個斷點。
//   · 兩個斷點之間一節：四面的方框、兩端可以不一樣寬（漸縮）；每一面自己的法線（平的）、色照那一節最多的那一色；兩端各一個蓋子。
//   · 粗細照體積校正：外框連階梯的凸角都算 ⇒ 寬、厚都乘 k ＝ √(原網格體積 ÷ 方框體積)（0.5～1）。
// ⛔ 只換畫的那一份（GPU 的三角形）：佔格 occ（擋格、站位、砲線）、划槳的轉軸照原本的模型 ⇒ 戰局不變。
var POLE_DS = 1, POLE_TOL = 0.3;
/** 3×3 對稱矩陣的特徵向量（Jacobi）⇒ 照特徵值由大到小的三個單位向量。 */
function poleEig(A) {
  var a = [A[0].slice(), A[1].slice(), A[2].slice()], V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], it, p, q, r;
  for (it = 0; it < 50; it++) {
    p = 0; q = 1; if (Math.abs(a[0][2]) > Math.abs(a[p][q])) { p = 0; q = 2; } if (Math.abs(a[1][2]) > Math.abs(a[p][q])) { p = 1; q = 2; }
    if (Math.abs(a[p][q]) < 1e-12) break;
    var th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]), c = Math.cos(th), s = Math.sin(th);
    for (r = 0; r < 3; r++) { var arp = a[r][p], arq = a[r][q]; a[r][p] = c * arp - s * arq; a[r][q] = s * arp + c * arq; }
    for (r = 0; r < 3; r++) { var apr = a[p][r], aqr = a[q][r]; a[p][r] = c * apr - s * aqr; a[q][r] = s * apr + c * aqr; }
    for (r = 0; r < 3; r++) { var vrp = V[r][p], vrq = V[r][q]; V[r][p] = c * vrp - s * vrq; V[r][q] = s * vrp + c * vrq; }
  }
  var L = [0, 1, 2].map(function (i) { var v = [V[0][i], V[1][i], V[2][i]], m = 0; for (var j = 1; j < 3; j++) if (Math.abs(v[j]) > Math.abs(v[m])) m = j; if (v[m] < 0) v = v.map(function (x) { return -x; }); return { l: a[i][i], v: v }; });   // 方向照最大的分量轉正（每次一樣）
  L.sort(function (x, y) { return y.l - x.l; });
  return L.map(function (x) { return x.v; });
}
/** 一份網格（verts、tris、tmat、mats）⇒ 長桿式的三角形（跟 meshTris 同一種排法：每個頂點 位置 3、法線 3、色 3）；做不出來 ⇒ null（照原本的）。st 給了 ⇒ 填讀數。
 *  62_wheel.js 用的可選參數（槳都不給 ⇒ 照以前）：E0 ＝ [桿子的方向, 截面軸一, 截面軸二] 直接給、不做 PCA；DS0／TOL0 ＝ 一片多長、簡化的誤差（網格的單位；沒給 ⇒ POLE_DS／POLE_TOL）。 */
function poleTris(m, st, E0, DS0, TOL0) {
  var V = m.verts, Tr = m.tris, nt = Tr.length / 3, i, j, k;
  if (!nt) return null;
  function P(i2) { return [V[i2 * 3], V[i2 * 3 + 1], V[i2 * 3 + 2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  var T = [], aw = 0, mu = [0, 0, 0];
  for (j = 0; j < nt; j++) {
    var p0 = P(Tr[j * 3]), p1 = P(Tr[j * 3 + 1]), p2 = P(Tr[j * 3 + 2]), n = cross(sub(p1, p0), sub(p2, p0)), ar = Math.hypot(n[0], n[1], n[2]) / 2;
    if (!(ar > 0)) continue;
    var c = [(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3, (p0[2] + p1[2] + p2[2]) / 3];
    T.push({ p: [p0, p1, p2], n: [n[0] / (2 * ar), n[1] / (2 * ar), n[2] / (2 * ar)], a: ar, c: c, col: m.tmat[j] });
    aw += ar; for (k = 0; k < 3; k++) mu[k] += c[k] * ar;
  }
  if (!aw) return null;
  for (k = 0; k < 3; k++) mu[k] /= aw;
  var C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  T.forEach(function (t) { var d = sub(t.c, mu); for (var r = 0; r < 3; r++) for (var q = 0; q < 3; q++) C[r][q] += t.a * d[r] * d[q]; });
  var E = E0 || poleEig(C), e0 = E[0], e1 = E[1], e2 = E[2];
  if (dot(cross(e0, e1), e2) < 0) e2 = e2.map(function (x) { return -x; });   // (e0, e1, e2) 右手系
  function loc(p) { var d = sub(p, mu); return [dot(d, e0), dot(d, e1), dot(d, e2)]; }
  var t0 = Infinity, t1 = -Infinity;
  T.forEach(function (t) { t.q = t.p.map(loc); t.q.forEach(function (q) { if (q[0] < t0) t0 = q[0]; if (q[0] > t1) t1 = q[0]; }); });
  var pDS = DS0 || POLE_DS, pTOL = TOL0 || POLE_TOL, ns = Math.max(1, Math.ceil((t1 - t0) / pDS - 1e-9)), ds = (t1 - t0) / ns;
  if (ns < 2) return null;
  var EX = [], CA = [];                                                 // 每一片：[u 最小, u 最大, w 最小, w 最大]；顏色 ⇒ 面積
  for (i = 0; i < ns; i++) { EX.push([Infinity, -Infinity, Infinity, -Infinity]); CA.push({}); }
  function clip(poly, lo, hi) {                                         // 多邊形（局部座標）裁到 lo ≤ t ≤ hi
    function cut(L, keep, lim) {                                        // 留 keep 那一邊、跨過的邊切在 t ＝ lim
      var out = [];
      for (var z = 0; z < L.length; z++) {
        var A = L[z], B = L[(z + 1) % L.length], ka = keep(A[0]), kb = keep(B[0]);
        if (ka) out.push(A);
        if (ka !== kb) { var f = (lim - A[0]) / (B[0] - A[0]); out.push([lim, A[1] + f * (B[1] - A[1]), A[2] + f * (B[2] - A[2])]); }
      }
      return out;
    }
    var L1 = cut(poly, function (x) { return x >= lo; }, lo);
    if (!L1.length) return L1;
    return cut(L1, function (x) { return x <= hi; }, hi);
  }
  T.forEach(function (t) {
    var a0 = Math.min(t.q[0][0], t.q[1][0], t.q[2][0]), a1 = Math.max(t.q[0][0], t.q[1][0], t.q[2][0]);
    var s0 = Math.max(0, Math.min(ns - 1, Math.floor((a0 - t0) / ds))), s1 = Math.max(0, Math.min(ns - 1, Math.floor((a1 - t0) / ds - 1e-9)));
    var side = Math.abs(dot(t.n, e0)) < 0.7;                             // 側面（法線跟軸夾角大）才算顏色；兩端的面只撐寬度
    for (var s = s0; s <= s1; s++) {
      var Q = clip(t.q, t0 + s * ds, t0 + (s + 1) * ds); if (!Q.length) continue;
      var X = EX[s];
      Q.forEach(function (q) { if (q[1] < X[0]) X[0] = q[1]; if (q[1] > X[1]) X[1] = q[1]; if (q[2] < X[2]) X[2] = q[2]; if (q[2] > X[3]) X[3] = q[2]; });
      if (side) CA[s][t.col] = (CA[s][t.col] || 0) + t.a * Math.max(0, Math.min(t0 + (s + 1) * ds, a1) - Math.max(t0 + s * ds, a0)) / Math.max(1e-9, a1 - a0);
    }
  });
  for (i = 0; i < ns; i++) if (!(EX[i][0] <= EX[i][1])) { var pv = EX[i - 1] || EX[i + 1]; if (!pv || !(pv[0] <= pv[1])) return null; EX[i] = pv.slice(); }   // 空的片（斷掉的地方）⇒ 照隔壁
  var col = CA.map(function (o, s) { var bc = -1, bv = -1; Object.keys(o).forEach(function (c2) { if (o[c2] > bv) { bv = o[c2]; bc = +c2; } }); return bc; });
  for (i = 0; i < ns; i++) if (col[i] < 0) col[i] = i ? col[i - 1] : -1;
  for (i = ns - 1; i >= 0; i--) if (col[i] < 0) col[i] = col[i + 1] >= 0 ? col[i + 1] : 0;
  // 邊界 b（0..ns）上的寬度：前後兩片平均（端點照那一片）⇒ 階梯的鋸齒變平順
  var BX = [];
  for (var b = 0; b <= ns; b++) { var A2 = EX[Math.max(0, b - 1)], B2 = EX[Math.min(ns - 1, b)]; BX.push([0, 1, 2, 3].map(function (z) { return (A2[z] + B2[z]) / 2; })); }
  var keep = {}; keep[0] = keep[ns] = 1;
  for (i = 1; i < ns; i++) if (col[i] !== col[i - 1]) keep[i] = 1;      // 換色的地方一定斷
  var brk = Object.keys(keep).map(Number).sort(function (x, y) { return x - y; });
  for (k = 0; k + 1 < brk.length; k++) (function dp(b0, b1) {           // 同一色裡：四條邊界的 Douglas–Peucker
    var mx = 0, mi = -1;
    for (var z = b0 + 1; z < b1; z++) {
      var f = (z - b0) / (b1 - b0), d = 0;
      for (var q = 0; q < 4; q++) d = Math.max(d, Math.abs(BX[z][q] - (BX[b0][q] + f * (BX[b1][q] - BX[b0][q]))));
      if (d > mx) { mx = d; mi = z; }
    }
    if (mx > pTOL) { keep[mi] = 1; dp(b0, mi); dp(mi, b1); }
  })(brk[k], brk[k + 1]);
  brk = Object.keys(keep).map(Number).sort(function (x, y) { return x - y; });
  // 粗細照體積校正：斜的桿子量到的外框連階梯的凸角都算進去（陡的槳胖四到七成）⇒ 每個截面的寬、厚都乘同一個 k ＝ √(原網格體積 ÷ 方框體積)（夾在 0.5～1；只縮不放）
  var V0 = 0, VB = 0;
  T.forEach(function (t) { var a = t.p[0], b2 = t.p[1], c2 = t.p[2]; V0 += dot(a, cross(b2, c2)) / 6; });
  for (k = 0; k + 1 < brk.length; k++) {
    var X0 = BX[brk[k]], X1 = BX[brk[k + 1]], a0 = X0[1] - X0[0], a1 = X1[1] - X1[0], b0 = X0[3] - X0[2], b1 = X1[3] - X1[2];
    VB += (brk[k + 1] - brk[k]) * ds * (a0 * b0 / 3 + (a0 * b1 + a1 * b0) / 6 + a1 * b1 / 3);   // 兩個一次函數相乘的積分
  }
  var kv = VB > 0 ? Math.max(0.5, Math.min(1, Math.sqrt(Math.abs(V0) / VB))) : 1;
  if (kv < 1) brk.forEach(function (b3) { var X = BX[b3]; for (var z = 0; z < 4; z += 2) { var cz = (X[z] + X[z + 1]) / 2, hz = (X[z + 1] - X[z]) / 2 * kv; X[z] = cz - hz; X[z + 1] = cz + hz; } });
  var out = [];
  function rgbOf(c6) { return m.mats[c6] || m.mats[0] || [1, 0, 1]; }
  function W(t, u, w) { return [mu[0] + t * e0[0] + u * e1[0] + w * e2[0], mu[1] + t * e0[1] + u * e1[1] + w * e2[1], mu[2] + t * e0[2] + u * e1[2] + w * e2[2]]; }
  function quad(A, B, Cq, D, out0, rgb) {                               // 四邊形 A B C D（照 out0 那一邊朝外排）兩個三角形、平的法線
    var n = cross(sub(B, A), sub(Cq, A)), l = Math.hypot(n[0], n[1], n[2]); if (!(l > 0)) { n = cross(sub(Cq, A), sub(D, A)); l = Math.hypot(n[0], n[1], n[2]); }
    if (!(l > 0)) return;
    n = [n[0] / l, n[1] / l, n[2] / l];
    if (dot(n, out0) < 0) { var x = B; B = D; D = x; n = [-n[0], -n[1], -n[2]]; }
    [A, B, Cq, A, Cq, D].forEach(function (p) { out.push(p[0], p[1], p[2], n[0], n[1], n[2], rgb[0], rgb[1], rgb[2]); });
  }
  function ring(b) { var t = t0 + b * ds, X = BX[b]; return [W(t, X[0], X[2]), W(t, X[1], X[2]), W(t, X[1], X[3]), W(t, X[0], X[3])]; }   // 截面的四個角（u−w−、u+w−、u+w+、u−w+）
  var OUT = [e2.map(function (x) { return -x; }), e1, e2, e1.map(function (x) { return -x; })];   // 四面朝外的方向：w−、u+、w+、u−（角 z 到 z+1 那一面）
  for (k = 0; k + 1 < brk.length; k++) {
    var r0 = ring(brk[k]), r1 = ring(brk[k + 1]), cs = {}, bc = -1, bv = -1;
    for (i = brk[k]; i < brk[k + 1]; i++) cs[col[i]] = (cs[col[i]] || 0) + 1;
    Object.keys(cs).forEach(function (c3) { if (cs[c3] > bv) { bv = cs[c3]; bc = +c3; } });
    var rgb = rgbOf(bc);
    for (var z = 0; z < 4; z++) quad(r0[z], r0[(z + 1) % 4], r1[(z + 1) % 4], r1[z], OUT[z], rgb);
  }
  var ra = ring(0), rb = ring(ns);
  quad(ra[0], ra[1], ra[2], ra[3], e0.map(function (x) { return -x; }), rgbOf(col[0]));
  quad(rb[0], rb[1], rb[2], rb[3], e0, rgbOf(col[ns - 1]));
  if (st) { st.axis = e0.map(function (x) { return +x.toFixed(3); }); st.slices = ns; st.segs = brk.length - 1; st.k = +kv.toFixed(3); st.tris = out.length / 27; }
  return new Float32Array(out);
}
