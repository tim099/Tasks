// ───────────────────────── 水的房間：水量 ↔ 水位的尺（TASK-0811 畫面先用；TASK-0808 的模擬照用同一支） ─────────────────────────
// Tim 2026-10-22：「房間本身存水位（容量 看目前有多少顆粒子）」「我希望至少水面要是平滑的（不能碎裂）」。
// 一把尺（TASK-0811 驗收第 2 條；⛔ 現在的細檔模擬照「裝了幾成 × 格高」33_flood.js head、畫面照每一層疊 63_flood_gl.js flMesh，兩把尺 ⇒ 接縫）：
//   水量存整數單位：一格空氣（0.1 m 見方 ＝ 1 公升）WR_U 單位。每一欄（33_wrooms.js wrColumns：WR_C × WR_C 格、這間房每一層有幾格空氣）的水從最下面一層往上裝，
//   空著 0 格的那一層（甲板）跳過 ⇒ 「這一欄裝了 u 單位」⇔「水面在第幾層的幾成」只有一種換法（wrColZ ／ wrColUnits），模擬與畫面都叫它。
// 房間拉平（wrLevelRoom）：一間房的水全部拉到同一個世界高度（照現在的姿態），每一欄裝到那個高度 —— TASK-0808「房間內瞬間拉平」的對照組，也是 TASK-0811 先接的水源。
// ⛔ 這一支只算、不存戰局的狀態；不讀亂數。
var WR_U = 64;                                                        // 一格空氣幾單位（1 單位 ≈ 15.6 mL；最大的房間 4,675 m³ ≈ 3 億單位，Int32 裝得下）
/** 一型船的衍生表（不進船型快取）：每一欄的累計容量 pre（單位；第 j 欄第 d 層以下 ＝ pre[colOff[j] + j + d]）、欄中心（格座標）。 */
function wrxOf(T) {
  if (T.wrx) return T.wrx;
  var W = T.wrm, n = W.colRoom.length, C = W.c, pre = new Int32Array(W.colOff[n] + n), cxv = new Float32Array(n), cyv = new Float32Array(n), j, d;
  for (j = 0; j < n; j++) {
    var o = W.colOff[j], p = o + j, a = 0;
    pre[p] = 0;
    for (d = 0; d < W.colNZ[j]; d++) { a += W.cnt[o + d] * WR_U; pre[p + d + 1] = a; }
    cxv[j] = W.x0 + Math.min(W.colCX[j] * C + C / 2, W.nxv - (W.nxv - W.colCX[j] * C) / 2);   // 最後一欄可能不滿 WR_C 格寬 ⇒ 取那一欄真的寬度的中間
    cyv[j] = W.ylo + Math.min(W.colCY[j] * C + C / 2, W.ny - (W.ny - W.colCY[j] * C) / 2);
  }
  return (T.wrx = { pre: pre, cx: cxv, cy: cyv });
}
/** 第 j 欄的容量（單位）。 */
function wrColCap(W, X, j) { return X.pre[W.colOff[j] + j + W.colNZ[j]]; }
/** 第 j 欄裝了 u 單位 ⇒ 水面在哪（格座標的 z，0.1 m 一格；格底 ＝ 整數）。沒水 ⇒ 那一欄最下面那層有空氣的格底。滿 ⇒ 最上面那層的頂。 */
function wrColZ(W, X, j, u) {
  var o = W.colOff[j], p = o + j, nz = W.colNZ[j], d;
  if (u <= 0) { for (d = 0; d < nz && !W.cnt[o + d]; d++); return W.colZ0[j] + Math.min(d, nz); }
  if (u >= X.pre[p + nz]) return W.colZ0[j] + nz;
  var lo = 0, hi = nz;                                                // pre[p + lo] < u ≤ pre[p + hi]：二分找那一層（剛好裝滿下面那一段 ⇒ 水面在那一段的頂，⛔ 不跳到空著的甲板層上面那一段的底：TASK-0808 開口的水頭會多讀一截）
  while (hi - lo > 1) { var m = (lo + hi) >> 1; if (X.pre[p + m] < u) lo = m; else hi = m; }
  var cap = X.pre[p + lo + 1] - X.pre[p + lo];
  return W.colZ0[j] + lo + (cap > 0 ? (u - X.pre[p + lo]) / cap : 0);
}
/** wrColZ 反過來：水面在 z（格座標）⇒ 這一欄裝了幾單位（小數；呼叫的人自己取整）。 */
function wrColUnits(W, X, j, z) {
  var p = W.colOff[j] + j, nz = W.colNZ[j], d = z - W.colZ0[j];
  if (d <= 0) return 0;
  if (d >= nz) return X.pre[p + nz];
  var l = Math.floor(d);
  return X.pre[p + l] + (X.pre[p + l + 1] - X.pre[p + l]) * (d - l);
}
/** 第 r 間房裝 U 單位、全部拉到同一個世界高度（照姿態 M：世界高 ＝ M[1]·x ＋ M[5]·y ＋ M[9]·z ＋ M[13]，格座標）⇒ 回那個高度；out（Int32Array，每欄一格）填每一欄裝幾單位（加起來 ＝ U）。
 *  U ≤ 0 ⇒ 全 0、回 NaN；U ≥ 容量 ⇒ 全滿。照高度二分到 0.1 mm（每欄照 pre 查，O(欄數 × 約 17)）；取整的零頭給水面最高的那一欄 ⇒ 守恆逐單位相等。 */
function wrLevelRoom(W, X, M, r, U, out) {
  var j0 = W.roomCol0[r], j1 = W.roomCol0[r + 1], j, k9 = M[9];
  if (!(U > 0) || !(k9 > 1e-6)) { for (j = j0; j < j1; j++) out[j] = 0; return NaN; }
  var lo = Infinity, hi = -Infinity, tot = 0;
  for (j = j0; j < j1; j++) {
    var b = M[1] * X.cx[j] + M[5] * X.cy[j] + M[13], zb = W.colZ0[j], zt = zb + W.colNZ[j];
    lo = Math.min(lo, b + k9 * zb); hi = Math.max(hi, b + k9 * zt); tot += wrColCap(W, X, j);
  }
  if (U >= tot) { for (j = j0; j < j1; j++) out[j] = wrColCap(W, X, j); return hi; }
  function vol(h) { var s = 0; for (var q = j0; q < j1; q++) s += wrColUnits(W, X, q, (h - (M[1] * X.cx[q] + M[5] * X.cy[q] + M[13])) / k9); return s; }
  for (var it = 0; it < 48 && hi - lo > 1e-4; it++) { var mid = 0.5 * (lo + hi); if (vol(mid) < U) lo = mid; else hi = mid; }
  var h = 0.5 * (lo + hi), sum = 0, top = -1, topZ = -Infinity;
  for (j = j0; j < j1; j++) {
    var zz = (h - (M[1] * X.cx[j] + M[5] * X.cy[j] + M[13])) / k9;
    out[j] = Math.floor(wrColUnits(W, X, j, zz)); sum += out[j];
    if (out[j] < wrColCap(W, X, j) && out[j] > 0 && zz > topZ) { topZ = zz; top = j; }
  }
  if (top >= 0) { var a0 = Math.min(U - sum, wrColCap(W, X, top) - out[top]); out[top] += a0; sum += a0; }   // 取整的零頭（< 欄數單位）先給水面最高、還沒滿的那一欄
  for (j = j0; j < j1 && sum < U; j++) { var add = Math.min(U - sum, wrColCap(W, X, j) - out[j]); out[j] += add; sum += add; }   // 還有剩（那一欄裝不下）⇒ 照順序給沒滿的
  return h;
}
