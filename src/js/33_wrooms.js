// ───────────────────────── 水的房間：烘焙（TASK-0807；TASK-0804 研究報告 §5、§6.1） ─────────────────────────
// Tim 2026-10-22：「根據船艦預先烘焙好艦內空間（水按照空間（房間）模擬）然後每間之間有連通的面（先算好）」「應該說可以放在遊戲解壓縮船隻的緩存」
//   「可以判定接口面積大於多少時合併（可能被炸開 導致艙房合併）」「然後設定一個合適的分割艙房面積」。
// 切法（照格，0.1 m；艙內 ＝ 33_flood.js flSkin 的 yM < y < yP，空氣 ＝ T.hullG 那一格是空的）：
//   ① 每一層（z）一張平面空氣圖：每一格到最近的牆（實心或艙外）的距離（切比雪夫，兩趟）；離牆 > WR_NECK 格的是「寬敞處」，照平面相連編號；
//      其他空氣從寬敞處一格一格往外分（先到先得）⇒ 門、牆上的洞（寬 ≤ 2 × WR_NECK 格）在中間斷開，分回兩邊；沒有寬敞處的窄空間自成一塊。
//      同一層相鄰、分到不同塊的兩格 ＝ 旁邊的接口（一面 S²）。
//      ⛔ 只照平面相連（不找寬敞處）⇒ 門是牆上的空隙，艙房跟走廊每一層都連著 ⇒ 定遠號 28 間艙房全在同一間（量過）。
//   ② 上下兩層的區塊重疊 ≥ WR_THR × 兩塊裡較大那塊的面積 ⇒ 同一間；小的重疊（艙口、甲板破洞）⇒ 上下的接口。
//      ⛔ 照較小那塊比 ⇒ 艙口那一層的小區塊永遠併進下面那一整間 ⇒ 全船一間（原型量過）。⛔ 照 0.5 m 水格切 ⇒ 水格跨在甲板上，切不出房間（報告 §5）。
//      上下只照相對的尺：併起來的兩間中間那層甲板大半沒了 ⇒ 每一欄還是只有一段水（TASK-0808 的高度場才用得了）。
//   ③ 兩間之間旁邊的接口加起來 ≥ WR_JOIN m² ⇒ 併成一間（反覆到不再變）；甲板梁之間的空腔（上面封住、底下大半壓在一間上、≤ WR_POCKET m³）併進下面那間；
//      最後比 WR_MIN m³ 小的空腔併進接觸最多的鄰間（旁邊的優先）。
//      同一把尺 TASK-0809 打壞時照用（炸開 ⇒ 併）。
//   ④ 每間房照 WR_C × WR_C 格分欄：每一欄每一層這間房有幾格空氣（水量 ↔ 水位照它換；TASK-0808 的高度場也照它）。
// 結果掛在 T.wrm（一型一份，同型的船共用；打壞照每艘自己的，TASK-0809）；存進船型快取（06_cache.js cachePut 的 wrm）⇒ 下次載入讀回。不入版控、不進成品。
// ⛔ 模擬一行都不讀它（TASK-0808 之前）；只在載入時算、存，讀數 __game.wrooms(i)。
var WR_THR = 0.3, WR_C = 5, WR_NECK = 4, WR_JOIN = 3, WR_MIN = 1, WR_POCKET = 5, WR_LSTEPS = 8;   // WR_JOIN、WR_MIN 照 21 艘的分布定（TASK-0807 單上）：門 1.5–2 m² 那一群之後掉一大截、房間 1–2 m³ 是最低點
/** 載入船型時的步驟（05_hull.js buildHull 接在最後）：快取有 ⇒ 一步讀回；沒有 ⇒ 分段現算（平面分塊 WR_LSTEPS 段、合併、分欄），算完留在 T.keep 給 cachePut 存。 */
function wrSteps(T, C) {
  if (C && C.wrm) return [function () { T.wrm = C.wrm; T.wrmCached = true; }];
  var st = { ms: { layers: 0 } }, LY = null, steps = [];
  for (var p = 0; p < WR_LSTEPS; p++) steps.push((function (p) { return function () {   // 平面分塊：切 WR_LSTEPS 段（每段 1／WR_LSTEPS 的層），最後一段收尾
    var a = performance.now(); if (!LY) LY = wrLayers(T, st);
    for (var z = Math.floor(LY.Z * p / WR_LSTEPS); z < Math.floor(LY.Z * (p + 1) / WR_LSTEPS); z++) LY.layer(z);
    if (p === WR_LSTEPS - 1) LY.end();
    st.ms.layers = +(st.ms.layers + performance.now() - a).toFixed(1);
  }; })(p));
  return steps.concat([
    function () { var a = performance.now(); wrMerge(T, st); st.ms.merge = +(performance.now() - a).toFixed(1); },
    function () { var a = performance.now(); wrColumns(T, st); st.ms.cols = +(performance.now() - a).toFixed(1); T.wrm = wrPack(st); T.wrmCached = false; if (T.keep) T.keep.wrm = T.wrm; }]);
}
/** ① 每一層：寬敞處、分回兩邊、連續段（rowS[k] 起、ry0／ry1 含兩端、runReg 區塊）、每塊的面積 regA 與在哪一層 regZ、旁邊的接口 lat（[塊, 塊, 層, 面數, ∑x, ∑y]）。 */
function wrLayers(T, st) {                                            // ⇒ { Z, layer(z), end() }：一層一層做（開局分段，wrSteps 切 WR_LSTEPS 段；一次全做約 0.4–0.7 s）
  var K = flSkin(T), B = K.B, nxv = K.nxv, Z = K.zTop, NY = K.yhi - K.ylo + 1, P = nxv * NY, R = Z * nxv, rN = WR_NECK;
  var air = new Uint8Array(P), d = new Uint8Array(P), lab = new Int32Array(P), qu = new Int32Array(P);
  var rowS = new Int32Array(R + 1), y0 = [], y1 = [], rr = [], regA = [], regZ = [], lat = [], n = 0, z, xi, yi, i, c, e, h, t, nl;
  function bfs(h, t, core) {                                             // 從佇列 qu[h..t) 往四個鄰格擴（同一層）：還沒分到、是空氣（core ⇒ 還要是寬敞處）⇒ 照來源那一格的塊
    while (h < t) {
      var c = qu[h++], cx = (c / NY) | 0, cy = c - cx * NY, v = lab[c], e;
      if (cx > 0) { e = c - NY; if (air[e] && !lab[e] && (!core || d[e] > rN)) { lab[e] = v; qu[t++] = e; } }
      if (cx < nxv - 1) { e = c + NY; if (air[e] && !lab[e] && (!core || d[e] > rN)) { lab[e] = v; qu[t++] = e; } }
      if (cy > 0) { e = c - 1; if (air[e] && !lab[e] && (!core || d[e] > rN)) { lab[e] = v; qu[t++] = e; } }
      if (cy < NY - 1) { e = c + 1; if (air[e] && !lab[e] && (!core || d[e] > rN)) { lab[e] = v; qu[t++] = e; } }
    }
  }
  function layer(z) {
    air.fill(0); var any = false;
    for (xi = 0; xi < nxv; xi++) { var k = z * nxv + xi; if (K.yP[k] < 0) continue; var x = K.x0 + xi; for (var y = K.yM[k] + 1; y < K.yP[k]; y++) if (!B.get(x, y, z)) { air[xi * NY + y - K.ylo] = 1; any = true; } }
    var g0 = regA.length; nl = 0;
    if (any) {
      for (xi = 0; xi < nxv; xi++) for (yi = 0; yi < NY; yi++) {        // 到牆的距離（切比雪夫）：往前一趟
        i = xi * NY + yi; if (!air[i]) { d[i] = 0; continue; }
        d[i] = Math.min(254, Math.min(xi > 0 ? d[i - NY] : 0, xi > 0 && yi > 0 ? d[i - NY - 1] : 0, xi > 0 && yi < NY - 1 ? d[i - NY + 1] : 0, yi > 0 ? d[i - 1] : 0) + 1);
      }
      for (xi = nxv - 1; xi >= 0; xi--) for (yi = NY - 1; yi >= 0; yi--) {   // 往回一趟
        i = xi * NY + yi; if (!air[i]) continue;
        var m2 = Math.min(xi < nxv - 1 ? d[i + NY] : 0, xi < nxv - 1 && yi < NY - 1 ? d[i + NY + 1] : 0, xi < nxv - 1 && yi > 0 ? d[i + NY - 1] : 0, yi < NY - 1 ? d[i + 1] : 0) + 1;
        if (m2 < d[i]) d[i] = m2;
      }
      lab.fill(0);
      for (i = 0; i < P; i++) { if (air[i] && d[i] > rN && !lab[i]) { lab[i] = ++nl; qu[0] = i; bfs(0, 1, true); } }   // 寬敞處照平面相連編號（掃描順序 ⇒ 同一份格子逐位相同）
      t = 0; for (i = 0; i < P; i++) if (lab[i]) qu[t++] = i;            // 其他空氣從寬敞處往外分（先到先得）
      bfs(0, t, false);
      for (i = 0; i < P; i++) { if (air[i] && !lab[i]) { lab[i] = ++nl; qu[0] = i; bfs(0, 1, false); } }   // 沒有寬敞處的窄空間：自成一塊
      for (var q = 0; q < nl; q++) { regA.push(0); regZ.push(z); }
      var lm = new Map();                                                // 旁邊的接口：同一層、分到不同塊的相鄰兩格（往 +x、+y 各看一次）
      for (i = 0; i < P; i++) {
        if (!air[i]) continue; xi = (i / NY) | 0; yi = i - xi * NY; var a1 = lab[i];
        for (var s = 0; s < 2; s++) {
          var j = s ? (yi < NY - 1 ? i + 1 : -1) : (xi < nxv - 1 ? i + NY : -1); if (j < 0 || !air[j] || lab[j] === a1) continue;
          var lo = Math.min(a1, lab[j]), hi = Math.max(a1, lab[j]), key = lo * 65536 + hi, o = lm.get(key);
          if (!o) lm.set(key, o = [g0 + lo - 1, g0 + hi - 1, z, 0, 0, 0]);
          o[3]++; o[4] += K.x0 + xi + (s ? 0.5 : 1); o[5] += K.ylo + yi + (s ? 1 : 0.5);
        }
      }
      Array.from(lm.keys()).sort(function (a, b) { return a - b; }).forEach(function (key) { lat.push(lm.get(key)); });
    }
    for (xi = 0; xi < nxv; xi++) {                                       // 連續段：照塊切
      var k2 = z * nxv + xi, base = xi * NY, a = -1, la = 0; rowS[k2] = n;
      for (yi = 0; yi <= NY; yi++) {
        var L = yi < NY && air[base + yi] ? lab[base + yi] : 0;
        if (a >= 0 && L !== la) { y0.push(K.ylo + a); y1.push(K.ylo + yi - 1); rr.push(g0 + la - 1); regA[g0 + la - 1] += yi - a; n++; a = -1; }
        if (L && a < 0) { a = yi; la = L; }
      }
    }
  }
  return { Z: Z, layer: layer, end: function () {
    rowS[R] = n;
    st.K = K; st.rowS = rowS; st.ry0 = Int16Array.from(y0); st.ry1 = Int16Array.from(y1); st.runReg = Int32Array.from(rr); st.regA = Int32Array.from(regA); st.regZ = Int16Array.from(regZ); st.lat = lat;
  } };
}
/** ②③ 合併：上下照相對的尺、旁邊照總面積 WR_JOIN、太小的併進鄰間 ⇒ 房間；剩下的 ⇒ 接口（類型 opT：0 上下、1 旁邊；兩間、哪一層、幾面、中心）。
 *  另記校準用的分布 calib：旁邊接口在併之前每一對房間的面積（m²）、併小空腔之前每間的大小（m³）。 */
function wrMerge(T, st) {
  var K = st.K, nxv = K.nxv, Z = K.zTop, rowS = st.rowS, Y0 = st.ry0, Y1 = st.ry1, RR = st.runReg, NR = st.regA.length, ov = new Map(), z, xi, S2 = S * S, S3 = S2 * S;
  for (z = 0; z < Z - 1; z++) for (xi = 0; xi < nxv; xi++) {
    var k = z * nxv + xi, k2 = k + nxv, i = rowS[k], ie = rowS[k + 1], j = rowS[k2], je = rowS[k2 + 1], x = K.x0 + xi + 0.5;
    while (i < ie && j < je) {
      var lo = Math.max(Y0[i], Y0[j]), hi = Math.min(Y1[i], Y1[j]);
      if (lo <= hi) { var key = RR[i] * NR + RR[j], o = ov.get(key), m = hi - lo + 1; if (!o) ov.set(key, o = [0, 0, 0]); o[0] += m; o[1] += m * x; o[2] += m * ((lo + hi) / 2 + 0.5); }
      if (Y1[i] < Y1[j]) i++; else j++;
    }
  }
  var par = new Int32Array(NR); for (var r = 0; r < NR; r++) par[r] = r;
  function find(a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }
  function uni(a, b) { a = find(a); b = find(b); if (a === b) return false; par[Math.max(a, b)] = Math.min(a, b); return true; }
  function num(a, b) { return a - b; }
  var vk = Array.from(ov.keys()).sort(num);                              // 固定順序 ⇒ 同一份格子逐位相同
  vk.forEach(function (key) { var a = Math.floor(key / NR), b = key % NR; if (ov.get(key)[0] >= WR_THR * Math.max(st.regA[a], st.regA[b])) uni(a, b); });
  var calib = { lat: [], vol: [] };
  for (var it = 0; it < 16; it++) {                                      // 旁邊：兩間之間加起來 ≥ WR_JOIN ⇒ 併（併了之後別的對加總可能超過 ⇒ 反覆）
    var pm = new Map();
    st.lat.forEach(function (e) { var a = find(e[0]), b = find(e[1]); if (a === b) return; var key = Math.min(a, b) * NR + Math.max(a, b); pm.set(key, (pm.get(key) || 0) + e[3]); });
    if (!it) {
      pm.forEach(function (v) { calib.lat.push(+(v * S2).toFixed(2)); });
      var dm = new Map();                                                // 校準：≥ 2 m² 的那幾對（中心、高度範圍、每一層最多幾面）
      st.lat.forEach(function (e) { var a = find(e[0]), b = find(e[1]); if (a === b) return; var key = Math.min(a, b) * NR + Math.max(a, b); if (pm.get(key) * S2 < 2) return; var o = dm.get(key); if (!o) dm.set(key, o = [0, 0, 0, 1e9, -1, 0]); o[0] += e[3]; o[1] += e[4]; o[2] += e[5]; o[3] = Math.min(o[3], e[2]); o[4] = Math.max(o[4], e[2]); o[5] = Math.max(o[5], e[3]); });
      calib.big = Array.from(dm.values()).map(function (o) { return [+(o[0] * S2).toFixed(2), Math.round(o[1] / o[0]), Math.round(o[2] / o[0]), o[3], o[4], o[5]]; }).sort(function (a, b) { return b[0] - a[0]; });
    }
    var ch = false; Array.from(pm.keys()).sort(num).forEach(function (key) { if (pm.get(key) * S2 >= WR_JOIN && uni(Math.floor(key / NR), key % NR)) ch = true; });
    if (!ch) break;
  }
  function vols() { var v = new Map(); for (var q = 0; q < NR; q++) { var rt = find(q); v.set(rt, (v.get(rt) || 0) + st.regA[q]); } return v; }
  for (it = 0; it < 4; it++) {                                           // 甲板梁之間的小空腔：上面封住（往上幾乎沒有空氣）、底下大半壓在一間上、不大（≤ WR_POCKET）⇒ 併進下面那間
    var up = new Map(), dn = new Map(), foot = new Map(), zb = new Map(), vv = vols();   //   ⛔ 只靠 WR_MIN：梁縫一格 1 m³ 左右，跟一個小儲物間一樣大，照大小分不出來（定遠號側視量過）
    for (var q = 0; q < NR; q++) { var rq = find(q), zq = st.regZ[q], zc = zb.get(rq); if (zc === undefined || zq < zc) { zb.set(rq, zq); foot.set(rq, st.regA[q]); } else if (zq === zc) foot.set(rq, foot.get(rq) + st.regA[q]); }
    vk.forEach(function (key) { var a = find(Math.floor(key / NR)), b = find(key % NR); if (a === b) return; var n3 = ov.get(key)[0]; up.set(a, (up.get(a) || 0) + n3); var m = dn.get(b) || new Map(); m.set(a, (m.get(a) || 0) + n3); dn.set(b, m); });   // key：下面那塊 × NR ＋ 上面那塊
    var ch3 = false;
    Array.from(dn.keys()).sort(num).forEach(function (b) {
      if (find(b) !== b) return; var f = foot.get(b); if (!(vv.get(b) * S3 <= WR_POCKET) || (up.get(b) || 0) > 0.1 * f) return;
      var m = dn.get(b), best = -1, bn = 0; Array.from(m.keys()).sort(num).forEach(function (a) { if (m.get(a) > bn) { bn = m.get(a); best = a; } });
      if (bn >= 0.5 * f && uni(b, best)) ch3 = true;
    });
    if (!ch3) break;
  }
  var V = vols(), isT = null; V.forEach(function (v) { calib.vol.push(+(v * S3).toFixed(3)); });
  function note(Mp, a, b, n) { if (isT.has(a)) { var m = Mp.get(a) || new Map(); m.set(b, (m.get(b) || 0) + n); Mp.set(a, m); } }
  for (it = 0; it < 8; it++) {                                           // 太小的空腔 ⇒ 併進接觸最多的鄰間（旁邊的優先；由小到大、固定順序）
    var tiny = []; V.forEach(function (v, rt) { if (v * S3 < WR_MIN) tiny.push(rt); });
    if (!tiny.length) break;
    isT = new Set(tiny); var nbL = new Map(), nbV = new Map();
    st.lat.forEach(function (e) { var a = find(e[0]), b = find(e[1]); if (a === b) return; note(nbL, a, b, e[3]); note(nbL, b, a, e[3]); });
    vk.forEach(function (key) { var a = find(Math.floor(key / NR)), b = find(key % NR); if (a === b) return; var n2 = ov.get(key)[0]; note(nbV, a, b, n2); note(nbV, b, a, n2); });
    tiny.sort(function (a, b) { return V.get(a) - V.get(b) || a - b; });
    var ch2 = false;
    tiny.forEach(function (rt) {
      if (find(rt) !== rt) return;
      var m = nbL.get(rt) || nbV.get(rt); if (!m) return;
      var best = -1, bn = -1; Array.from(m.keys()).sort(num).forEach(function (b) { if (m.get(b) > bn) { bn = m.get(b); best = b; } });
      if (best >= 0 && uni(rt, best)) ch2 = true;
    });
    if (!ch2) break;
    V = vols();
  }
  var regRoom = new Int32Array(NR), rm = new Map(), vox = [], z0 = [], z1 = [];
  for (r = 0; r < NR; r++) {
    var rt = find(r), g = rm.get(rt); if (g === undefined) { g = vox.length; rm.set(rt, g); vox.push(0); z0.push(st.regZ[r]); z1.push(st.regZ[r]); }
    regRoom[r] = g; vox[g] += st.regA[r]; if (st.regZ[r] < z0[g]) z0[g] = st.regZ[r]; if (st.regZ[r] > z1[g]) z1[g] = st.regZ[r];
  }
  var NM = vox.length, op = new Map();
  function addOp(t, A, Bm, zz, n, sx, sy) { if (A === Bm) return; var a = Math.min(A, Bm), b = Math.max(A, Bm), key = ((t * NM + a) * NM + b) * Z + zz, e = op.get(key); if (!e) op.set(key, e = [t, a, b, zz, 0, 0, 0]); e[4] += n; e[5] += sx; e[6] += sy; }
  vk.forEach(function (key) { var a = Math.floor(key / NR), b = key % NR, o = ov.get(key); addOp(0, regRoom[a], regRoom[b], st.regZ[a], o[0], o[1], o[2]); });
  st.lat.forEach(function (e) { addOp(1, regRoom[e[0]], regRoom[e[1]], e[2], e[3], e[4], e[5]); });
  var L = Array.from(op.keys()).sort(num).map(function (k3) { return op.get(k3); });
  function col(f, Ty) { return Ty.from(L.map(f)); }
  st.regRoom = regRoom; st.roomVox = Int32Array.from(vox); st.roomZ0 = Int16Array.from(z0); st.roomZ1 = Int16Array.from(z1);
  st.opT = col(function (e) { return e[0]; }, Int8Array); st.opA = col(function (e) { return e[1]; }, Int32Array); st.opB = col(function (e) { return e[2]; }, Int32Array); st.opZ = col(function (e) { return e[3]; }, Int16Array);
  st.opN = col(function (e) { return e[4]; }, Int32Array); st.opX = col(function (e) { return e[5] / e[4]; }, Float32Array); st.opY = col(function (e) { return e[6] / e[4]; }, Float32Array);
  calib.lat.sort(num); calib.vol.sort(num); st.calib = calib;
}
/** ④ 分欄：每間房、每一欄（WR_C × WR_C 格）、每一層有幾格空氣（cnt，Uint8；一欄最多 WR_C² 格）。欄照房間、欄號排；每欄記 z0 與層數，房間記第一欄 roomCol0。 */
function wrColumns(T, st) {
  var K = st.K, nxv = K.nxv, Z = K.zTop, C = WR_C, NCX = Math.ceil(nxv / C), NCY = Math.ceil((K.yhi - K.ylo + 1) / C), NC = NCX * NCY, cols = new Map(), z, xi;
  for (z = 0; z < Z; z++) for (xi = 0; xi < nxv; xi++) {
    var k = z * nxv + xi, cx = (xi / C) | 0;
    for (var i = st.rowS[k]; i < st.rowS[k + 1]; i++) {
      var rm = st.regRoom[st.runReg[i]];
      for (var y = st.ry0[i]; y <= st.ry1[i];) {
        var cy = ((y - K.ylo) / C) | 0, ye = Math.min(st.ry1[i], K.ylo + (cy + 1) * C - 1), key = rm * NC + cx * NCY + cy, e = cols.get(key);
        if (!e) cols.set(key, e = { z0: z, c: [] });
        var d = z - e.z0; while (e.c.length <= d) e.c.push(0); e.c[d] += ye - y + 1;
        y = ye + 1;
      }
    }
  }
  var keys = Array.from(cols.keys()).sort(function (a, b) { return a - b; }), n = keys.length, tot = 0, NM = st.roomVox.length;
  keys.forEach(function (key) { tot += cols.get(key).c.length; });
  var colRoom = new Int32Array(n), colCX = new Int16Array(n), colCY = new Int16Array(n), colZ0 = new Int16Array(n), colNZ = new Int16Array(n), colOff = new Int32Array(n + 1), cnt = new Uint8Array(tot), roomCol0 = new Int32Array(NM + 1), o = 0;
  keys.forEach(function (key, j) {
    var e = cols.get(key), rm = Math.floor(key / NC), cc = key % NC;
    colRoom[j] = rm; colCX[j] = Math.floor(cc / NCY); colCY[j] = cc % NCY; colZ0[j] = e.z0; colNZ[j] = e.c.length; colOff[j] = o;
    for (var d = 0; d < e.c.length; d++) cnt[o + d] = e.c[d];
    o += e.c.length;
  });
  colOff[n] = o;
  for (var r = 0, j = 0; r <= NM; r++) { while (j < n && colRoom[j] < r) j++; roomCol0[r] = j; }
  st.NCX = NCX; st.NCY = NCY; st.colRoom = colRoom; st.colCX = colCX; st.colCY = colCY; st.colZ0 = colZ0; st.colNZ = colNZ; st.colOff = colOff; st.cnt = cnt; st.roomCol0 = roomCol0;
}
/** 收成存得進 IndexedDB 的一份（只有數字、字串陣列與型別陣列）。 */
function wrPack(st) {
  var K = st.K;
  return { thr: WR_THR, c: WR_C, neck: WR_NECK, join: WR_JOIN, min: WR_MIN, pocket: WR_POCKET, x0: K.x0, nxv: K.nxv, ylo: K.ylo, ny: K.yhi - K.ylo + 1, zTop: K.zTop, NCX: st.NCX, NCY: st.NCY, ms: st.ms, calib: st.calib,
    rowS: st.rowS, ry0: st.ry0, ry1: st.ry1, runReg: st.runReg, regRoom: st.regRoom, roomVox: st.roomVox, roomZ0: st.roomZ0, roomZ1: st.roomZ1,
    opT: st.opT, opA: st.opA, opB: st.opB, opZ: st.opZ, opN: st.opN, opX: st.opX, opY: st.opY,
    roomCol0: st.roomCol0, colRoom: st.colRoom, colCX: st.colCX, colCY: st.colCY, colZ0: st.colZ0, colNZ: st.colNZ, colOff: st.colOff, cnt: st.cnt };
}
/** 格 (x, y, z)（船的格座標）屬於哪一間（烘焙那一刻的；不是艙內的空氣 ⇒ −1）。照那一列的連續段找。 */
function wrRoomAt(W, x, y, z) {
  var xi = x - W.x0; if (z < 0 || z >= W.zTop || xi < 0 || xi >= W.nxv) return -1;
  var k = z * W.nxv + xi; for (var i = W.rowS[k]; i < W.rowS[k + 1]; i++) if (y >= W.ry0[i] && y <= W.ry1[i]) return W.regRoom[W.runReg[i]];
  return -1;
}
/** 第二把尺（TASK-0807）：作者標的艙房（36_rooms.js hullRooms：關聯 meta kind=rooms 的 .min／.max 框）跟切出來的房間比 ——
 *  每一間艙房：框裡的空氣格最多落在哪一間（frac ＝ 占幾成）、那一間比框大幾倍（big ＝ 那一間的格數 ÷ 框裡的空氣格數）。
 *  自成一間（ok）＝ frac ≥ 0.95、沒有別的艙房共用那一間、big ≤ 3（框常常沒框到天花板、窄走廊會分進來 ⇒ 1.3–2.8 倍是常見的；⛔ 以前 ≤ 1.5，憲法號量過 28 間各自一間卻全判不過）。 */
function wrCabins(T) {
  var W = T.wrm, L = hullRooms(T); if (!W) return null;
  var out = L.map(function (R) {
    var by = {}, air = 0, x, y, z;
    for (z = R.min[2]; z <= R.max[2]; z++) for (x = R.min[0]; x <= R.max[0]; x++) for (y = R.min[1]; y <= R.max[1]; y++) { var r = wrRoomAt(W, x, y, z); if (r < 0) continue; air++; by[r] = (by[r] || 0) + 1; }
    var best = -1, bn = 0; Object.keys(by).forEach(function (k) { if (by[k] > bn) { bn = by[k]; best = +k; } });
    var frac = air ? bn / air : 0, big = air && best >= 0 ? W.roomVox[best] / air : 0;
    return { name: R.name, air: air, room: best, frac: +frac.toFixed(3), big: +big.toFixed(2) };
  });
  var share = {}; out.forEach(function (c) { share[c.room] = (share[c.room] || 0) + 1; });
  out.forEach(function (c) { c.shared = share[c.room] - 1; c.ok = c.frac >= 0.95 && !c.shared && c.big <= 3; });
  return out;
}
/** 讀數（__game.wrooms）：幾間、≥ 1 m³ 幾間、最大幾間（m³）、接口幾條與面積（上下／旁邊）、切了幾 ms、是不是快取讀回的、雜湊（同一份格子 ⇒ 一樣；現算與快取比對用）、校準分布。 */
function wrInfo(T) {
  var W = T && T.wrm; if (!W) return null;
  var S3 = S * S * S, v = Array.from(W.roomVox).sort(function (a, b) { return b - a; }), av = 0, al = 0, nv = 0, nlat = 0;
  for (var i = 0; i < W.opN.length; i++) if (W.opT[i]) { al += W.opN[i]; nlat++; } else { av += W.opN[i]; nv++; }
  var h = 0x811c9dc5; function mix(A) { for (var j = 0; j < A.length; j++) { h ^= A[j] & 0xffff; h = Math.imul(h, 16777619); h ^= (A[j] >>> 16) & 0xffff; h = Math.imul(h, 16777619); } }
  [W.rowS, W.ry0, W.ry1, W.runReg, W.regRoom, W.roomVox, W.opT, W.opA, W.opB, W.opZ, W.opN, W.colRoom, W.colZ0, W.colNZ, W.cnt].forEach(mix);
  return { rooms: W.roomVox.length, ge1m3: v.filter(function (n) { return n * S3 >= 1; }).length, top: v.slice(0, 8).map(function (n) { return +(n * S3).toFixed(1); }),
    air: +(v.reduce(function (a, b) { return a + b; }, 0) * S3).toFixed(1), vert: { n: nv, m2: +(av * S * S).toFixed(1) }, side: { n: nlat, m2: +(al * S * S).toFixed(1) },
    regions: W.regRoom.length, runs: W.ry0.length, cols: W.colRoom.length, par: { neck: W.neck, join: W.join, min: W.min, pocket: W.pocket, thr: W.thr },
    ms: W.ms, cached: !!T.wrmCached, hash: (h >>> 0).toString(16), calib: W.calib };
}
