// ───────────────────────── 海圖塊的畫面（TASK-0721；只給人看） ─────────────────────────
// 每塊一份網格（P.bed：位置、法線、底色、紋理權重；照常吃陰影與霧），載進來（08_seabed.js 'bedChunk'）就排隊建、丟掉（'bedDrop'）就刪。
// 底質的顏色與程序紋理（Tim 2026-10-19：「是否可以嘗試讓不同地形用不同的顏色(甚至可以用程序生成紋理) 例如珊瑚礁(目前是綠色 可以參考現實顏色&外觀)」）：
//   每個頂點帶底色（bedCol）＋四種紋理的權重（BED_TEX：沙、草地、岩石、礁；相鄰兩種照頂點內插 ⇒ 交界平滑）；陸地照坡度、海拔再混進岩石。
//   片段照世界座標算紋理（不用貼圖檔）：沙 ＝ 細顆粒＋風紋；草地 ＝ 兩種尺度的斑駁、帶一點色相；岩石 ＝ 水平層理＋雜訊；
//   珊瑚礁 ＝ 一顆一顆的珊瑚頭（細胞雜訊，約 3 m 一顆）照實物配色 —— 赭、黃褐、橄欖褐為主，夾珊瑚藻的粉、紫，頭與頭之間是淺色的礁沙。
//   紋理細節照距離淡掉（250 m～1.8 km）⇒ 遠處只剩底色、不閃；底色挑成紋理的平均色 ⇒ 淡掉時顏色不跳。
//   近看（Tim 2026-10-20「是否可以強化一下近看地形時的紋理(一樣用程式生成)」）：70～260 m 以內再疊一層細的 ——
//     沙：細風紋、顆粒、海面上 0.6 m 內的濕沙（深一點、有反光）、再往上一條打上岸的海草與貝殼；草地：草叢、順一個方向的草葉紋、露土的斑塊、零星小花；
//     岩石：粗糙柔和的坑洞、顆粒、地衣斑（2026-10-20 拿掉裂縫網、粗一級）；珊瑚礁：頭鼓起來、表面細紋；海底泥沙：水流沙紋。
//     凹凸：每種另外給一個微高度 hb（公尺），照螢幕導數擾動法線（Mikkelsen 的 surface gradient，不多算雜訊）⇒ 光照看得出起伏；陰影照舊用網格的法線。
//     細的那幾層照一個像素佔幾公尺（fw）淡掉（baa：一個週期不到兩三個像素就不畫）⇒ 斜看、遠一點都不閃。
//   在用的那幾圈（中心 ± ring）每 8 m 一點、預載的那一圈每 16 m；四邊往下垂 40 m 的裙邊 ⇒ 粗細不同的兩塊接在一起也看不到縫。
//   水下的部分由海面的折射（07_gfx.js 折射：高）透出來，越深越被水的顏色蓋掉 ⇒ 礁、沙洲在淺水裡看得出顏色。
// 遠景（BEDFAR）：載入的 5×5 以外也要看得到島 ⇒ 整個海域有檔的塊每塊照 32 m 抽一份粗網格（bedMesh stride 8），開戰後在背景一塊一塊讀
//   （08_seabed.js bedPeek：⛔ 不放進模擬查的那一份；離開戰位置近的先讀），網格建好就丟掉解碼的資料。那一塊有細的（BEDGL）就畫細的、沒有才畫粗的 ⇒ 不疊在一起。
//   多遠看得到：鏡頭的遠裁切面 5 km（03_camera.js）、地形的霧淡成 0.4 倍（BED_FOG）⇒ 晴天 4 km 外還剩一成的輪廓。
// 岸邊的白沫（BEDFOAM）：5×5 那幾塊的高度照 8 m 一格放進一張貼圖（R16F、雙線性），海的著色器（01_gl.js）照「海面 − 海底」< 2 m 畫一圈白沫。只給人看。
// 內陸水（BEDWAT；TASK-0768，海圖塊的段 3：src/MAP_CHUNK.md §4）：湖、河、瀑布照「高度＋水深」畫一層水面（淡水的顏色、照水深變透），只給人看、⛔ 模擬不讀。
//   有內陸水的塊才有一份水面網格（g.w，跟著那一塊的地形網格建、丟）：在用的那幾圈每個取樣點一個頂點（4 m；河窄，8 m 一點會斷）、遠景照地形同一個點距；
//   有水的點 ⇒ 那一點的水面（湖是平的、河照每一點）；格子的其他角（岸上）⇒ 旁邊有水的點裡最低的水面、水深 0（全透）⇒ 跟岸的地形交出岸線、邊上淡出去。
//   瀑布：水面在崖口陡降 ⇒ 網格本身就是一面陡的水幕；片段照坡度把陡的那幾格畫成白的、往下流的條紋（水花之後）。
//   有內陸水的塊，地形在用的那幾圈也是 4 m 一點（bedLod）⇒ 窄的河床不會被 8 m 一點抹平、蓋過水面。
// 低於海平面的乾地（BEDDRY；例：恩里基約湖 −40 m 的湖岸與湖）：0 m 的海面會蓋住它 ⇒ 一張遮罩（BED_DRY_SP 公尺一格、蓋整個海域的窗），海與遠海的著色器照它丟掉海面（01_gl.js BED_DRY_GLSL）。
//   只算有「不是海（陸地 ≥ 10 或內陸水）而且地面低於 0」的點的塊：那一塊每一格裡的點全都不是海 ⇒ 遮；岸邊那一格裡有海的點 ⇒ 不遮 ⇒ 海岸照舊。
//   沒有這種點的塊不算 ⇒ 沒有的海域整段跳過（uDryOn 0 ⇒ 畫面逐位元組不變；托爾圖加 43 塊 0 點）。
//   另外（2026-10-21）跟海斷開的低地也遮：8 m 一格、照城鎮整過地的地面，只走水格從海往裡淹，淹不到的水坑、離海超過一條岸帶的低地不畫海（bedDryTex）。
var BEDGL = {}, BEDGL_Q = [], BEDGL_ID = null, BED_FOG = 0.4, BED_FAR_ST = 8;
// 地形網格換過幾次（建好、換粗細、丟掉）與換的是哪一塊（外框）：陰影的靜態那一層，那一段碰到換掉的塊就重畫（60_render.js shadowPass）
//   —— 粗的網格比細的高出幾公尺，晚一秒才重畫 ⇒ 那一整塊（1 km）的地面與樹被粗網格的影子蓋住、暗一下（Tim 2026-10-20「只動了一點點陰影就完全不同」）。
var BED_MESH_GEN = 0, BED_MESH_LOG = [];
function bedMeshChanged(bb) { BED_MESH_GEN++; BED_MESH_LOG.push([BED_MESH_GEN, bb]); if (BED_MESH_LOG.length > 512) BED_MESH_LOG.splice(0, 256); }
var BEDWAT = { on: true, n: 0, tris: 0, prog: null };                    // on：畫不畫（__game.inland）；n、tris：上一格畫了幾塊、幾個三角形
var BEDDRY = { c: {}, src: {}, hv: {}, tver: -1, tex: null, dirty: false, on: false, r: [0, 0, 1, 1], cells: 0, cut: 0, builds: 0, ms: 0 }, BED_DRY_SP = 32;   // src、hv：每塊最新的那一份與它的地面（bedDryTex 照它算跟海連不連）   // c：每塊的遮罩（沒有 ⇒ null）；r：第 0 格的世界 x、z、整張多寬、多高（公尺）
var BEDFAR = { g: {}, todo: null, fly: 0, inF: {}, ready: [], fail: 0, n: 0, bytes: 0, ms: 0 };   // todo：還要讀的塊 [cx, cy, 有檔, 失敗次數]；fly／inF：在路上的；ready：到了、等著建網格的
var BED_FAR_PAR = 4;                                                     // 遠景同時跟外面那一頁要幾塊（它有 2 個 Worker；以前一次一塊 ⇒ 托爾圖加 182 塊要 4 秒，一格一格出來）
var BEDDRAW = { n: 0, cull: 0, tris: 0 };                                // 上一格畫了幾塊、剔掉幾塊、幾個三角形（__game.bed）
var BEDFOAM = { tex: null, dirty: true, cx: null, cy: null, ox: 0, oz: 0, sp: 8, N: 0, ms: 0, builds: 0 };
var BED_COL = { 0: [0.30, 0.31, 0.27], 1: [0.74, 0.70, 0.52], 2: [0.66, 0.57, 0.44], 3: [0.86, 0.81, 0.62], 4: [0.40, 0.38, 0.35], 10: [0.84, 0.77, 0.57], 12: [0.45, 0.42, 0.38] };   // 2 珊瑚礁：紋理的平均色（以前是綠的）
// 每種底質的紋理權重 [沙, 草地, 岩石, 礁]；全 0（深海底）⇒ 片段只照底色加一點泥的斑駁
var BED_TEX = { 0: [0, 0, 0, 0], 1: [1, 0, 0, 0], 2: [0, 0, 0, 1], 3: [1, 0, 0, 0], 4: [0, 0, 1, 0], 10: [1, 0, 0, 0], 11: [0, 1, 0, 0], 12: [0, 0, 1, 0] };
function bedCol(h, m) {
  if (m === BED_MAT.LAND) {                                              // 陸地：低的綠、往上變褐、很高變灰
    var t = Math.min(1, Math.max(0, h / 450)), u = Math.min(1, Math.max(0, (h - 900) / 900));
    var c = [0.30 + 0.16 * t, 0.43 - 0.03 * t, 0.20 + 0.10 * t];
    return [c[0] + (0.52 - c[0]) * u, c[1] + (0.50 - c[1]) * u, c[2] + (0.47 - c[2]) * u];
  }
  return BED_COL[m] || BED_COL[0];
}
evOn('bedChunk', function (cx, cy, C) { BEDGL_Q.push(bedKey(cx, cy)); BEDFOAM.dirty = true; bedDryPut(bedKey(cx, cy), C, true); }, 0, true);
evOn('bedDrop', function (cx, cy) { var k = bedKey(cx, cy), g = BEDGL[k]; BEDFOAM.dirty = true; if (g) { bedMeshChanged(g.bb); gl.deleteVertexArray(g.vao); gl.deleteBuffer(g.vb); gl.deleteBuffer(g.ib); bedWatSet(g, null); delete BEDGL[k]; } }, 0, true);   // 遮罩（BEDDRY.c）留著：遠景照樣畫那一塊
evOn('bedWin', function () {                                             // 海域的窗換了（08_seabed.js bedWinApply）：窗外的遠景（網格、樹）丟掉；要讀的清單照新的窗重排
  Object.keys(BEDFAR.g).forEach(function (k) { var c = k.split('_').map(Number); if (bedIdx(c[0], c[1]) < 0) bedFarDrop(k); });
  BEDFAR.todo = null; BEDFAR.ready = BEDFAR.ready.filter(function (r) { return bedIdx(r[1].cx, r[1].cy) >= 0; }); BEDFOAM.dirty = true;
  Object.keys(BEDDRY.c).forEach(function (k) { var c = k.split('_').map(Number); if (bedIdx(c[0], c[1]) < 0) { if (BEDDRY.c[k]) BEDDRY.dirty = true; delete BEDDRY.c[k]; } });
  Object.keys(BEDDRY.src).forEach(function (k) { var c = k.split('_').map(Number); if (bedIdx(c[0], c[1]) < 0) { delete BEDDRY.src[k]; delete BEDDRY.hv[k]; } });
  if (BEDDRY.on) BEDDRY.dirty = true;                                    // 遮罩照新的窗重排
}, 0, true);
/** 丟掉一塊的遠景：網格、遠景的樹（63_trees.js）。 */
function bedFarDrop(k) {
  if (BEDFAR.g[k]) bedMeshChanged(BEDFAR.g[k].bb);
  var g = BEDFAR.g[k]; if (g) { gl.deleteVertexArray(g.vao); gl.deleteBuffer(g.vb); gl.deleteBuffer(g.ib); bedWatSet(g, null); delete BEDFAR.g[k]; }
  var s = TREES.far[k]; if (s) { if (s.vao) { gl.deleteVertexArray(s.vao); gl.deleteBuffer(s.vb); gl.deleteBuffer(s.ib); } delete TREES.far[k]; }
  treeUnq(k, true);                                                     // 排著還沒擺的遠景樹冠殼（63_trees.js treePump）一起丟
}
function bedLod(C) {                                                     // 每幾個取樣點取一個：在用的那幾圈 8 m（有城、有內陸水的塊 4 m，63_towns.js）、預載那一圈 16 m —— 照公尺算 ⇒ 外圈的中等塊（16 m 一點）每點都取
  var R = bedRingN(BED_CFG.ring), w = Math.abs(C.cx - BED.cx) <= R && Math.abs(C.cy - BED.cy) <= R ? (townFine(C) || C.wd ? 1 : 2) : 4;
  return Math.max(1, Math.round(w * BED.A.step / C.step));
}
/** 一塊 ⇒ 網格（stride：每幾個取樣點取一個）。頂點：位置 3、法線 3、底色 3、紋理權重 4（世界座標：原點 ＝ 開戰位置）。
 *  高度照 townHv（63_towns.js：有城 ⇒ 整過地的那一份，只給畫面）；點距照這一塊自己的 C.step（遠景塊可以是粗的：@host 的 peek 回 32 m 一點的 33×33，src/MAP_CHUNK.md §5）；塊的原點照海域的 A.chunk。 */
function bedMesh(C, stride) {
  var n = C.n, m = (n - 1) / stride + 1, A = BED.A, st = C.step, h = townHv(C), nv = m * m + 4 * m, V = new Float32Array(nv * 13), I = [];
  var ox = C.cx * A.chunk - BED.ax, oz = C.cy * A.chunk - BED.az;
  function put(k, i, j, dy) {
    var o = j * n + i, y = h[o] / 10, il = Math.max(0, i - stride), ir = Math.min(n - 1, i + stride), jl = Math.max(0, j - stride), jr = Math.min(n - 1, j + stride);
    var gx = (h[j * n + ir] - h[j * n + il]) / 10 / ((ir - il) * st), gz = (h[jr * n + i] - h[jl * n + i]) / 10 / ((jr - jl) * st), L = Math.sqrt(gx * gx + 1 + gz * gz), c = bedCol(y, C.mat[o]);
    var q = k * 13, mt = C.mat[o], w = BED_TEX[mt] || BED_TEX[0], wr = 0;
    if (mt === BED_MAT.LAND) { var sl = Math.sqrt(gx * gx + gz * gz); wr = Math.max(Math.min(1, Math.max(0, (sl - 0.45) / 0.5)), Math.min(1, Math.max(0, (y - 700) / 600))); }   // 陸地：陡坡（tan 0.45～0.95）、高山（700～1300 m）混進岩石
    V[q] = ox + i * st; V[q + 1] = y + dy; V[q + 2] = oz + j * st; V[q + 3] = -gx / L; V[q + 4] = 1 / L; V[q + 5] = -gz / L; V[q + 6] = c[0]; V[q + 7] = c[1]; V[q + 8] = c[2];
    V[q + 9] = w[0]; V[q + 10] = w[1] * (1 - wr); V[q + 11] = w[2] + w[1] * wr; V[q + 12] = w[3];
  }
  for (var j = 0; j < m; j++) for (var i = 0; i < m; i++) put(j * m + i, i * stride, j * stride, 0);
  for (j = 0; j < m - 1; j++) for (i = 0; i < m - 1; i++) { var a = j * m + i; I.push(a, a + m, a + 1, a + 1, a + m, a + m + 1); }
  // 裙邊：四條邊各 m 點，往下 40 m
  var edges = [[0, 0, 1, 0], [0, m - 1, 1, 0], [0, 0, 0, 1], [m - 1, 0, 0, 1]];
  edges.forEach(function (e, q) {
    var base = m * m + q * m;
    for (var t = 0; t < m; t++) { var ii = e[0] + e[2] * t, jj = e[1] + e[3] * t; put(base + t, ii * stride, jj * stride, -40); }
    for (t = 0; t < m - 1; t++) { var a0 = (e[1] + e[3] * t) * m + e[0] + e[2] * t, a1 = (e[1] + e[3] * (t + 1)) * m + e[0] + e[2] * (t + 1); I.push(a0, a1, base + t, a1, base + t + 1, base + t); }
  });
  return { V: V, I: new Uint32Array(I) };
}
function bedUpload(k, C, lod) {
  bedMeshChanged(bedBox(C));
  var g = bedGpu(bedMesh(C, lod), BEDGL[k]);
  g.lod = lod; g.C = C; g.cx = C.cx; g.cy = C.cy; g.bb = bedBox(C); BEDGL[k] = g;   // g.C：建網格用的那一份（原精度到了、或換回中等塊 ⇒ 重建）
  if (g.wC !== C) { bedWatSet(g, bedWaterMesh(C, 1)); g.wC = C; }       // 內陸水：每個取樣點一個頂點（粗細不跟著地形換；那一份換了才重建）
}
/** 一塊的內陸水 ⇒ 水面網格（s：每幾個取樣點取一個）；沒有段 3、取到的點都沒有水 ⇒ null。頂點：位置 3、水深 1（世界座標，同 bedMesh）。 */
function bedWaterMesh(C, s) {
  var wd = C.wd; if (!wd) return null;
  var n = C.n, m = (n - 1) / s + 1, A = BED.A, st = C.step * s, h = C.h0, M2 = m * m, sf = new Float32Array(M2), dp = new Float32Array(M2), wet = new Uint8Array(M2), any = 0;
  for (var j = 0; j < m; j++) for (var i = 0; i < m; i++) { var o = j * s * n + i * s, q = j * m + i; if (wd[o]) { wet[q] = 1; sf[q] = (h[o] + wd[o]) / 10; dp[q] = wd[o] / 10; any++; } }   // h0：漩渦烤之前的那一份（水深照它存）
  if (!any) return null;
  var ox = C.cx * A.chunk - BED.ax, oz = C.cy * A.chunk - BED.az, id = new Int32Array(M2).fill(-1), V = [], I = [], lo = Infinity, hi = -Infinity;
  function vert(i, j) {
    var q = j * m + i; if (id[q] >= 0) return id[q];
    var y = sf[q];
    if (!wet[q]) { y = Infinity; for (var b = Math.max(0, j - 1); b <= Math.min(m - 1, j + 1); b++) for (var a = Math.max(0, i - 1); a <= Math.min(m - 1, i + 1); a++) { var r = b * m + a; if (wet[r] && sf[r] < y) y = sf[r]; } }   // 岸上的角：旁邊最低的水面（瀑布旁邊照下游那一層 ⇒ 不會浮在岸上）
    id[q] = V.length / 4; V.push(ox + i * st, y, oz + j * st, wet[q] ? dp[q] : 0); if (y < lo) lo = y; if (y > hi) hi = y;
    return id[q];
  }
  for (j = 0; j < m - 1; j++) for (i = 0; i < m - 1; i++) {
    var q0 = j * m + i; if (!(wet[q0] | wet[q0 + 1] | wet[q0 + m] | wet[q0 + m + 1])) continue;
    var a0 = vert(i, j), a1 = vert(i + 1, j), a2 = vert(i, j + 1), a3 = vert(i + 1, j + 1);
    I.push(a0, a2, a1, a1, a2, a3);
  }
  return { V: new Float32Array(V), I: new Uint32Array(I), lo: lo, hi: hi, wet: any, x0: ox, z0: oz };
}
/** 換掉一塊的水面網格（g ＝ 那一塊的地形網格；M ＝ null ⇒ 只刪）。 */
function bedWatSet(g, M) {
  var w = g.w;
  if (w) { gl.deleteVertexArray(w.vao); gl.deleteBuffer(w.vb); gl.deleteBuffer(w.ib); g.w = null; }
  if (!M || !M.I.length) return;
  w = { vao: gl.createVertexArray(), vb: gl.createBuffer(), ib: gl.createBuffer(), n: M.I.length, wet: M.wet, bb: [M.x0, M.lo - 1, M.z0, M.x0 + BED.A.chunk, M.hi + 1, M.z0 + BED.A.chunk] };
  gl.bindVertexArray(w.vao); gl.bindBuffer(gl.ARRAY_BUFFER, w.vb); gl.bufferData(gl.ARRAY_BUFFER, M.V, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, w.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, M.I, gl.STATIC_DRAW); gl.bindVertexArray(null);
  g.w = w;
}
/** 一塊的外框（世界座標；高度含往下垂 40 m 的裙邊）。 */
function bedBox(C) { var x0 = C.cx * BED.A.chunk - BED.ax, z0 = C.cy * BED.A.chunk - BED.az; return [x0, C.min - 40, z0, x0 + BED.A.chunk, C.max, z0 + BED.A.chunk]; }
/** 視錐的六個面（從 VP 抽：每個面 a·x + b·y + c·z + d ≥ 0 在裡面）。 */
function bedPlanes(m) {
  var P = [], r = function (i) { return [m[i], m[4 + i], m[8 + i], m[12 + i]]; }, w = r(3);
  [0, 1, 2].forEach(function (i) { var a = r(i); P.push([w[0] + a[0], w[1] + a[1], w[2] + a[2], w[3] + a[3]], [w[0] - a[0], w[1] - a[1], w[2] - a[2], w[3] - a[3]]); });
  return P;
}
/** 外框整個在某一面外面 ⇒ 看不到（保守：只剔除確定看不到的）。 */
function bedSeen(P, b) {
  for (var i = 0; i < 6; i++) { var p = P[i]; if (p[0] * (p[0] > 0 ? b[3] : b[0]) + p[1] * (p[1] > 0 ? b[4] : b[1]) + p[2] * (p[2] > 0 ? b[5] : b[2]) + p[3] < 0) return false; }
  return true;
}
/** 網格 ⇒ GPU（g 給了就重用那一組 VAO 與緩衝區）。 */
function bedGpu(M, g) {
  g = g || { vao: gl.createVertexArray(), vb: gl.createBuffer(), ib: gl.createBuffer() };
  gl.bindVertexArray(g.vao); gl.bindBuffer(gl.ARRAY_BUFFER, g.vb); gl.bufferData(gl.ARRAY_BUFFER, M.V, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 52, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 52, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 52, 24);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 52, 36);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, M.I, gl.STATIC_DRAW); gl.bindVertexArray(null);
  g.n = M.I.length; return g;
}
// 地形的著色器（第一次畫的時候建）：光照跟 P.tri 同一套（天光、陽光、陰影、霧），顏色換成「底色 × 紋理」
var BED_VS = '#version 300 es\nlayout(location=0) in vec3 aP; layout(location=1) in vec3 aN; layout(location=2) in vec3 aC; layout(location=3) in vec4 aK; uniform mat4 uVP; out vec3 vN; out vec3 vW; out vec3 vC; out vec4 vK;\n' +
  'void main(){ vN=aN; vW=aP; vC=aC; vK=aK; gl_Position=uVP*vec4(aP,1.0); }\n';
function bedFS() {
  return '#version 300 es\nprecision highp float;\n' + SHADOW_GLSL + TLAMP_GLSL + 'in vec3 vN; in vec3 vW; in vec3 vC; in vec4 vK; uniform vec3 uSun,uEye,uFog,uSky,uGround; uniform float uFogD; out vec4 o;\n' +
    'float bh(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }\n' +
    'float bn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(bh(i),bh(i+vec2(1.0,0.0)),f.x),mix(bh(i+vec2(0.0,1.0)),bh(i+vec2(1.0,1.0)),f.x),f.y); }\n' +
    'float bf(vec2 p){ return (bn(p)*0.5+bn(p*2.03)*0.25+bn(p*4.01)*0.125+bn(p*8.07)*0.0625)/0.9375; }\n' +
    // 細胞雜訊：(到最近一點的距離, 那一格的兩個亂數)
    'vec3 bcell(vec2 p){ vec2 i=floor(p), f=fract(p); float d=8.0; vec2 id=i; for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g=vec2(float(x),float(y)); vec2 q=g+vec2(bh(i+g),bh(i+g+17.3))-f; float e=dot(q,q); if(e<d){ d=e; id=i+g; } } return vec3(sqrt(d),bh(id+3.7),bh(id+9.1)); }\n' +
    // 細胞雜訊（兩近點）：(到最近一點, 到第二近一點, 最近那一格的兩個亂數) —— 第二近減最近 ≈ 0 的地方是兩格的交界（裂縫）
    'vec4 bcell2(vec2 p){ vec2 i=floor(p), f=fract(p); float d1=8.0, d2=8.0; vec2 id=i; for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g=vec2(float(x),float(y)); vec2 q=g+vec2(bh(i+g),bh(i+g+17.3))-f; float e=dot(q,q); if(e<d1){ d2=d1; d1=e; id=i+g; } else if(e<d2) d2=e; } return vec4(sqrt(d1),sqrt(d2),bh(id+3.7),bh(id+9.1)); }\n' +
    // 每公尺 f 個週期的那一層：一個像素佔 fw 公尺 ⇒ 一個週期不到三個像素就淡掉（不閃）
    'float baa(float f, float fw){ return 1.0-smoothstep(0.3,0.6,f*fw); }\n' +
    // 岩石（照平面座標 q、高度 yy）：水平層理（照雜訊扭）＋細雜訊；近看多中尺度的明暗斑駁、
    //   坑洞（岸邊石灰岩那種蝕出來的洞，約 1 m 一格、四成的格子有；邊緣照兩層雜訊咬得粗糙、從坑心到外圈慢慢淡、坑底也有一點起伏）、顆粒（約 0.5 m）、地衣斑
    //   ⇒ (亮度倍數, 地衣多少, 那一塊的亂數（挑地衣的顏色）, 微高度)
    //   （Tim 2026-10-20「這個沙地就太細了(裂紋不用 紋理可以在粗一個水平)」「圓洞可以粗糙柔和一點」：拿掉裂縫網；坑洞、顆粒、地衣斑各粗一倍；坑洞淡一點、邊緣不再是一圈硬邊）
    'vec4 brock(vec2 q, float yy, float fw, float nk){ float st=sin(yy*1.1+bf(q*0.05)*7.0)*0.5+0.5, m=(0.82+0.2*st)*(0.88+0.24*bn(q*0.6+vec2(yy*0.3)));\n' +
    ' vec3 ck=bcell(q*0.45+vec2(bn(q*0.3),yy*0.2)); float gn=(bn(q*2.15+vec2(yy))-0.5)*baa(2.15,fw);\n' +
    ' vec3 pc=bcell(q*0.95+vec2(bn(q*0.4),bn(q*0.4+3.3))*0.9); float ed=pc.x+(bn(q*3.1)-0.5)*0.22+(bn(q*7.3)-0.5)*0.08*baa(7.3,fw);\n' +
    ' float pt=(1.0-smoothstep(0.08+0.1*pc.z,0.34+0.1*pc.z,ed))*step(pc.y,0.4)*baa(0.95,fw), pf=0.8+0.4*bn(q*5.0), mo=bf(q*0.22+vec2(yy*0.1));\n' +
    ' m*=(1.0+nk*(0.18*gn+0.3*(mo-0.5)))*(1.0-nk*0.22*pt*pf); return vec4(m, smoothstep(0.62,0.75,bf(q*0.45+vec2(yy*0.5,3.0)))*nk, ck.y, nk*(0.06*ck.x-0.07*pt*pf+0.04*gn+0.05*st+0.08*mo)); }\n' +
    'void main(){ if(vW.y<uClip) discard; vec3 n=normalize(vN); vec2 p=vW.xz; float fd=length(vW-uEye), dk=1.0-smoothstep(250.0,1800.0,fd), nk=1.0-smoothstep(70.0,260.0,fd);\n' +
    ' float fw=max(length(dFdx(p)),length(dFdy(p))), hb=0.0, wet=0.0; vec3 col=vC;\n' +
    // 陡的面（岩石用）：側面的座標 sq（照法線比較朝東西還是南北）與它一個像素佔幾公尺；sv：坡越陡越照側面（法線 y 0.85 ⇒ 0.6）
    ' vec2 sq=abs(n.x)>abs(n.z)?vW.zy:vW.xy; float fws=max(length(dFdx(sq)),length(dFdy(sq))), sv=smoothstep(0.85,0.6,n.y);\n' +
    ' if(dk>0.0){ vec4 w=vK; float ws=w.x+w.y+w.z+w.w; vec3 det;\n' +
    // 海底（深海底、沒有紋理權重的）：泥的斑駁＋水流沙紋（約 1.6 m 一道）
    '  if(ws<0.01){ float rp=sin(dot(p,vec2(0.6,0.8))*4.0+bf(p*0.08)*5.0)*baa(0.64,fw); det=vC*(0.85+0.3*bn(p*0.4))*(1.0+0.05*rp*nk); hb=0.025*rp; }\n' +
    '  else { det=vec3(0.0);\n' +
    // 沙：細顆粒＋風紋（照雜訊彎）；近看多一層細風紋（約 0.57 m 一道）與兩種顆粒
    //   濕沙：海面上 wl（0.55 m 照雜訊抖 ±0.35）以下變深、有反光（wet）；水下 0.6 m 以下不算（折射那邊本來就暗）
    //   打上岸的東西：濕沙線再往上 0.45 m 那一條，零星的貝殼（白）與海草（深褐）；其他乾沙只有很少的貝殼
    '   if(w.x>0.0){ float g=bn(p*1.7), wf=bf(p*0.12)*6.0, r=sin(dot(p,vec2(0.8,0.6))*2.2+wf)*0.5+0.5;\n' +
    '    float a2=baa(1.75,fw), rf=(sin(dot(p,vec2(0.74,0.67))*11.0+wf*2.3+bn(p*0.9)*2.0)*0.5+0.5-0.5)*a2, gr=(bn(p*23.0)-0.5)*baa(23.0,fw), gr2=(bn(p*61.0)-0.5)*baa(61.0,fw);\n' +
    '    float wl=0.55+0.35*(bn(p*0.15)-0.5)*2.0, wt=(1.0-smoothstep(wl-0.25,wl+0.1,vW.y))*smoothstep(-0.6,-0.2,vW.y);\n' +
    '    vec3 sc=vC*(0.95+0.12*(g-0.5)+0.07*(r-0.5)+nk*(0.06*rf+0.10*gr+0.08*gr2))*(1.0-0.32*wt*nk);\n' +
    '    if(nk>0.0){ vec4 sh=bcell2(p*1.6+vec2(bn(p*0.5))*0.6); float dr=1.0-smoothstep(0.0,0.3,abs(vW.y-wl-0.45+0.25*(bn(p*0.3)-0.5)));\n' +
    '     float sp=(1.0-smoothstep(0.05,0.1,sh.x))*step(sh.z,0.03+0.3*dr)*(1.0-wt)*nk*baa(5.0,fw);\n' +
    '     sc=mix(sc,sh.w>0.55&&dr>0.3?vec3(0.30,0.24,0.14):vec3(0.92,0.88,0.79),sp*0.85); }\n' +
    '    hb+=w.x*(0.05*(r-0.5)+nk*(0.018*rf+0.004*gr)*(1.0-0.7*wt)); wet+=w.x*wt*nk; det+=w.x*sc; }\n' +
    // 草地：兩種尺度的斑駁、乾的地方偏黃褐；近看多草叢（約 1.8 m）、順一個方向的草葉紋（照雜訊彎）、被踩薄露出土的斑塊、零星的黃白小花
    '   if(w.y>0.0){ float m1=bf(p*0.06), m2=bn(p*0.8), cl=bf(p*0.55);\n' +
    '    vec2 q=vec2(dot(p,vec2(0.94,0.34)),dot(p,vec2(-0.34,0.94)))+vec2(bn(p*0.4),bn(p*0.4+5.7))*1.5; float bl=(bn(vec2(q.x*7.0,q.y*2.2))-0.5)*baa(7.0,fw), bl2=(bn(vec2(q.x*19.0,q.y*5.0)+3.1)-0.5)*baa(19.0,fw);\n' +
    '    vec3 tu=bcell(p*1.3+vec2(bn(p*0.9),bn(p*0.9+4.1))*1.2); float tf=(1.0-smoothstep(0.15,0.8,tu.x+(bn(p*3.3)-0.5)*0.35))*baa(1.3,fw);\n' +
    '    vec3 gc=(vC*(0.8+0.4*m1)*(0.93+0.14*m2)+vec3(0.06,0.03,-0.02)*(m1-0.5))*(1.0+nk*(0.3*(cl-0.5)+0.3*bl+0.2*bl2+0.22*(tf-0.5)+0.1*(tu.y-0.5)*tf));\n' +
    '    float dy=smoothstep(0.55,0.75,bf(p*0.2+vec2(9.1,2.4)))*nk; gc=mix(gc,gc*vec3(1.18,1.06,0.62),dy*0.6);\n' +
    '    float dz=smoothstep(0.64,0.74,bf(p*0.11+vec2(5.2,1.3)))*nk; gc=mix(gc,vec3(0.40,0.32,0.21)*(0.85+0.3*bn(p*3.1)),dz*0.85);\n' +
    '    if(nk>0.0){ vec4 fl=bcell2(p*2.3); float fs=(1.0-smoothstep(0.05,0.09,fl.x))*step(fl.z,0.04)*(1.0-dz)*nk*baa(9.0,fw); gc=mix(gc,fl.w<0.5?vec3(0.86,0.76,0.26):vec3(0.88,0.86,0.80),fs*0.85); }\n' +
    '    hb+=w.y*nk*(0.10*(cl-0.5)+0.025*bl+0.05*tf-0.04*dz); det+=w.y*gc; }\n' +
    // 岩石（brock）：陡的面改照側面的座標（坡越陡越換過去，sv）⇒ 崖壁上不會被拉成直條；地衣灰綠、赭
    '   if(w.z>0.0){ vec4 rt=brock(p,vW.y,fw,nk); if(sv>0.0) rt=mix(rt,brock(sq,vW.y,fws,nk),sv);\n' +
    '    vec3 rc=mix(vC*rt.x,rt.z<0.5?vec3(0.60,0.62,0.52):vec3(0.64,0.50,0.32),rt.y*0.4); hb+=w.z*rt.w; det+=w.z*rc; }\n' +
    // 珊瑚礁：珊瑚頭（約 3 m 一顆）照實物配色，頭與頭之間是礁沙
    // 每顆大小不同（c.z）、約兩成的格子空著（只有礁沙）、邊緣照雜訊咬得不規則；珊瑚藻的粉、紫偏灰（實物不艷）；近看頭鼓起來（最高 0.3 m）、表面細紋
    '   if(w.w>0.0){ vec3 c=bcell(p*0.33+vec2(bn(p*0.21),bn(p*0.21+7.3))*0.9); vec3 cc=c.y<0.3?vec3(0.62,0.48,0.30):c.y<0.52?vec3(0.50,0.44,0.28):c.y<0.66?vec3(0.70,0.58,0.36):c.y<0.8?vec3(0.66,0.50,0.50):c.y<0.9?vec3(0.52,0.43,0.50):vec3(0.86,0.80,0.66);\n' +
    '    float rr=0.16+0.26*c.z, ed=c.x+(bn(p*1.4)-0.5)*0.24; float head=(1.0-smoothstep(rr-0.06,rr+0.06,ed))*step(0.2,c.z); vec3 sd=vec3(0.82,0.77,0.62)*(0.9+0.15*bn(p*2.0));\n' +
    '    float po=(bn(p*9.0+c.y*31.0)-0.5)*baa(9.0,fw);\n' +
    '    det+=w.w*mix(sd,cc*(0.78+0.4*bn(p*2.7+c.z*13.0))*(1.0+0.2*po*nk),head*(0.7+0.3*c.z)); hb+=w.w*nk*(head*0.3*sqrt(max(0.0,1.0-ed/rr))+0.015*po); }\n' +
    '   det/=ws; hb/=ws; wet/=ws; }\n' +
    '  col=mix(vC,det,dk); }\n' +
    // 凹凸（近看）：法線照 hb 的螢幕導數擾動 —— 導數在分支外算（分支裡的導數沒有定義）
    ' vec3 sx=dFdx(vW), sy=dFdy(vW), r1=cross(sy,n), r2=cross(n,sx); float hx=dFdx(hb), hy=dFdy(hb), dt=dot(sx,r1); vec3 nb=n;\n' +
    ' if(nk>0.0){ vec3 nq=abs(dt)*n-sign(dt)*(hx*r1+hy*r2); if(dot(nq,nq)>1e-12) nb=normalize(mix(n,normalize(nq),nk)); }\n' +
    ' float sd2=dot(nb,uSun), d=abs(sd2), sg=dot(n,uSun); float sk=shadowK(vW,(sg<0.0?-n:n)*(3.0-2.0*abs(sg))); d*=sk; col=col*(mix(uGround,uSky,0.6)*0.65+vec3(1.0,0.96,0.88)*d*0.7+townLamp(vW,nb));\n' +   // townLamp：城裡夜裡的燈（63_towns.js）
    // 濕沙的反光：太陽的半向量，照陰影
    ' if(wet>0.0){ vec3 hv=normalize(uSun+normalize(uEye-vW)); col+=vec3(1.0,0.96,0.88)*pow(max(dot(nb,hv),0.0),40.0)*wet*0.35*sk; }\n' +
    ' o=vec4(mix(col,uFog,1.0-exp(-fd*uFogD)),1.0); }\n';
}
/** 遠景（每格；nb ＝ 這一格最多建幾塊網格，bedDraw 這一格建過細的 ⇒ 0）：離焦點（旗艦）那一塊近的先（2026-10-20：以前照離開戰位置近的排一次就定了 ⇒ 開遠了旁邊的最後才來）。
 *  那一塊現在載著（原精度或外圈的中等塊）⇒ 直接抽；沒有 ⇒ 讀檔（bedPeek，同時最多 BED_FAR_PAR 塊，到了先放 ready 等建）；要不到 ⇒ 放回去再要，三次都不行才放棄。 */
function bedFarStep(nb) {
  var F = BEDFAR;
  if (!F.todo) F.todo = BED.A.chunks.filter(function (c) { return c[2] && !F.g[bedKey(c[0], c[1])]; }).map(function (c) { return [c[0], c[1], 1, 0]; });   // 第一次、換過窗：有檔、還沒有遠景的
  var t0 = performance.now();
  while (F.ready.length && nb > 0 && !bedBusy()) { var r = F.ready.shift(); if (!F.g[r[0]] && bedIdx(r[1].cx, r[1].cy) >= 0) { bedFarPut(r[0], r[1], r[2]); nb--; bedSpent(t0); t0 = performance.now(); } }
  var fx = BED.cx == null ? 0 : BED.cx, fy = BED.cy == null ? 0 : BED.cy;
  while (F.todo.length) {
    var b = -1, bd = Infinity;
    for (var i = 0; i < F.todo.length; i++) { var c = F.todo[i], kv = bedViewK(c[0], c[1]), dd = ((c[0] - fx) * (c[0] - fx) + (c[1] - fy) * (c[1] - fy)) * kv * kv; if (dd < bd) { bd = dd; b = i; } }   // 鏡頭看得到的那一邊先（bedViewK）
    var q = F.todo[b], k = bedKey(q[0], q[1]);
    if (F.g[k] || F.inF[k] || bedIdx(q[0], q[1]) < 0) { F.todo.splice(b, 1); continue; }   // 已經有了、在路上、窗外
    var C = bedShowC(k);
    if (C) { if (nb <= 0 || bedBusy()) break; F.todo.splice(b, 1); bedFarPut(k, C, 0); nb--; bedSpent(t0); t0 = performance.now(); continue; }
    if (F.fly >= BED_FAR_PAR) break;
    F.todo.splice(b, 1); bedFarAsk(q, k);
  }
}
function bedFarAsk(q, k) {
  var F = BEDFAR; F.fly++; F.inF[k] = 1;
  bedPeek(q[0], q[1]).then(function (b64) { F.fly--; delete F.inF[k]; var t0 = performance.now(), C = bedDecode(b64); F.ready.push([k, C, performance.now() - t0]); },
    function (e) { F.fly--; delete F.inF[k]; q[3]++; if (q[3] < 3 && F.todo) F.todo.push(q); else { F.fail++; console.warn('遠景：' + e.message); } });
}
function bedFarPut(k, C, ms) {
  if (!BED || !BED.A || BEDFAR.g[k]) return;
  bedMeshChanged(bedBox(C));
  var t0 = performance.now(), fs = Math.max(1, Math.round(BED_FAR_ST * BED.A.step / C.step)), M = bedMesh(C, fs), g = bedGpu(M, null);   // 32 m 一點：細的塊（4 m）每 8 點取一點，粗的（32 m）每點都取
  g.bb = bedBox(C); BEDFAR.g[k] = g; treeFar(k, C); chartPut(C);                    // treeFar：遠景的樹（貼圖；63_trees.js）
  bedWatSet(g, bedWaterMesh(C, fs)); bedDryPut(k, C, false);           // 內陸水（同一個點距；窄的河取不到點就沒有）、低於海平面的乾地（細的那一份算過就不重算）
  BEDFAR.n++; BEDFAR.bytes += M.V.byteLength + M.I.byteLength; BEDFAR.ms += ms + performance.now() - t0;   // （以前這三個寫在上一行的註解後面 ⇒ 讀數一直是 0）
}
/** 白沫的高度貼圖：中心 ± (ring＋prefetch) 那幾塊，每 2 個取樣點（8 m）一格；沒載的、深海塊 ⇒ deep。換中心、載進來、丟掉之後重建。 */
function bedFoamTex() {
  var Fm = BEDFOAM, A = BED.A;
  if (BED.cx === null || !Fm.dirty && Fm.cx === BED.cx && Fm.cy === BED.cy) return;
  if (Fm.tex && bedBusy()) return;                                      // 背景預算用完了 ⇒ 下一格再重建（收塊時每一塊都會弄髒它；一次約 30 ms）
  var t0 = performance.now(), R = bedRingN(BED_CFG.ring) + bedRingN(BED_CFG.prefetch), n = A.n, sk = 2, per = (n - 1) / sk, W = (2 * R + 1) * per, D = new Float32Array(W * W).fill(A.deep);
  for (var cj = 0; cj <= 2 * R; cj++) for (var ci = 0; ci <= 2 * R; ci++) {
    var C = bedShowC(bedKey(BED.cx - R + ci, BED.cy - R + cj)); if (!C) continue;
    if (C.step !== A.step) {                                             // 外圈的中等塊（點距比 8 m 粗）：照公尺取最近的點
      var cn = C.n, f = sk * A.step / C.step;
      for (var j2 = 0; j2 < per; j2++) { var r2 = (cj * per + j2) * W + ci * per, s2 = Math.min(cn - 1, Math.round(j2 * f)) * cn; for (var i2 = 0; i2 < per; i2++) D[r2 + i2] = C.h[s2 + Math.min(cn - 1, Math.round(i2 * f))] / 10; }
      continue;
    }
    for (var j = 0; j < per; j++) { var r = (cj * per + j) * W + ci * per, s = j * sk * n; for (var i = 0; i < per; i++) D[r + i] = C.h[s + i * sk] / 10; }
  }
  if (!Fm.tex) { Fm.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, Fm.tex); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); }
  gl.bindTexture(gl.TEXTURE_2D, Fm.tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, W, W, 0, gl.RED, gl.FLOAT, D); gl.bindTexture(gl.TEXTURE_2D, null);
  Fm.dirty = false; Fm.cx = BED.cx; Fm.cy = BED.cy; Fm.N = W; Fm.sp = A.step * sk; Fm.ox = (BED.cx - R) * A.chunk - BED.ax; Fm.oz = (BED.cy - R) * A.chunk - BED.az;
  Fm.ms = performance.now() - t0; Fm.builds++; bedSpent(t0);
}
/** 海的著色器（60_render.js 畫海那一段）：白沫的高度貼圖接第 10 號；沒有海圖 ⇒ uBedOn 0（整段跳過）。 */
function bedWaterU(u) {
  var on = !!(BED && BED.A && BEDFOAM.tex);
  gl.uniform1f(u.uBedOn, on ? 1 : 0);
  gl.activeTexture(gl.TEXTURE10); gl.bindTexture(gl.TEXTURE_2D, on ? BEDFOAM.tex : DUMMY); gl.uniform1i(u.uBedT, 10); gl.activeTexture(gl.TEXTURE0);
  if (on) gl.uniform4f(u.uBedR, BEDFOAM.ox, BEDFOAM.oz, BEDFOAM.sp, BEDFOAM.N);
  bedDryU(u);
}
/** 低於海平面的乾地的遮罩（01_gl.js BED_DRY_GLSL）：接第 12 號；沒有 ⇒ uDryOn 0（整段跳過）。海、遠海兩支著色器都叫。 */
function bedDryU(u) {
  var on = !!(BED && BED.A && BEDDRY.on && BEDDRY.tex && BEDWAT.on);
  gl.uniform1f(u.uDryOn, on ? 1 : 0);
  gl.activeTexture(gl.TEXTURE12); gl.bindTexture(gl.TEXTURE_2D, on ? BEDDRY.tex : DUMMY); gl.uniform1i(u.uDryT, 12); gl.activeTexture(gl.TEXTURE0);
  if (on) gl.uniform4fv(u.uDryR, BEDDRY.r);
}
/** 遮罩記著、但現在沒在畫的那一塊（換了精度、被窗擠出去）：城換了 ⇒ 照新的整地記下來（63_towns.js townRegrade 排隊叫；TASK-0819）。
 *  以前 bedDryTex 每次都對每一塊 townHv，這種塊順手就整好了；現在 bedDryTex 只讀記下的那一份 ⇒ 要有人替它們重整。 */
function bedDryRegrade(k) {
  var C = BEDDRY.src[k]; if (!C) return;
  var hv = townHv(C); if (BEDDRY.hv[k] !== hv) { BEDDRY.hv[k] = hv; BEDDRY.dirty = true; }
}
/** 一塊的遮罩（BED_DRY_SP 公尺一格，1 ＝ 不畫海）：那一塊有「不是海、地面低於 0」的點才算，每一格裡的點全都不是海 ⇒ 遮。fine ⇒ 細的那一份（換掉粗的）；不然已經算過就不算。 */
function bedDryPut(k, C, fine) {
  if (fine || !BEDDRY.src[k]) { var hv = townHv(C); if (BEDDRY.src[k] !== C || BEDDRY.hv[k] !== hv) { BEDDRY.src[k] = C; BEDDRY.hv[k] = hv; BEDDRY.dirty = true; } }   // 跟海連不連（bedDryTex）用的地面：細的那一份優先
  if (!fine && k in BEDDRY.c) return;
  var wd = C.wd, h = C.h0, mt = C.mat0, n = C.n, N = n * n, D = null, any = false, o;
  for (o = 0; o < N; o++) if ((mt[o] >= BED_MAT.BEACH || wd && wd[o]) && h[o] < 0) { any = true; break; }   // 內陸水的水底、陸地低於 0（漩渦烤之前的那一份：水面、陸地本來在哪）
  if (any) {
    var G = BED.A.chunk / BED_DRY_SP, f = BED_DRY_SP / C.step, cnt = 0;
    D = new Uint8Array(G * G);
    for (var b = 0; b < G; b++) for (var a = 0; a < G; a++) {
      var i0 = Math.floor(a * f), i1 = Math.min(n - 1, Math.ceil((a + 1) * f)), j0 = Math.floor(b * f), j1 = Math.min(n - 1, Math.ceil((b + 1) * f)), all = true;
      for (var j = j0; j <= j1 && all; j++) for (var i = i0; i <= i1; i++) { o = j * n + i; if (mt[o] < BED_MAT.BEACH && !(wd && wd[o])) { all = false; break; } }
      if (all) { D[b * G + a] = 255; cnt++; }
    }
    if (!cnt) D = null;
  }
  if (D || BEDDRY.c[k]) BEDDRY.dirty = true;
  BEDDRY.c[k] = D;
}
/** 遮罩的貼圖（R8、雙線性，BED_SEA_SP 公尺一格、蓋整個海域的窗；1 ＝ 不畫海）：有塊的遮罩、地面（城鎮整地）變了、換了窗 ⇒ 重建；一格都不用遮 ⇒ 關（uDryOn 0）。怎麼算見 bedDryCalc。 */
var BED_SEA_SP = 8, BED_SEA_LOW = 4, BED_SEA_WET = 0, BED_SEA_BAND = 2;
// 遮罩在 Worker 算（TASK-0816；Tim 2026-10-22「目前進入航海模式時 會卡頓(lag)一段時間」「是否可以讓載入改到其他thread並且降低占用呢(目前感覺遠景沒加載影響不大 慢慢載就好)」）：
//   進航海那幾秒遠景一塊一塊進來，每一塊都弄髒遮罩 ⇒ 以前每格在這一頁重算整個窗（±10 塊、8 m 一格 ＝ 690 萬格）：皇家港外進場後 3 秒幾乎每格 50～100 ms、淡入那一下 971 ms。
//   ⇒ 算的那一段（bedDryCalc：純函式，⛔ 不碰外面的變數 —— 它的原始碼整段送進 Worker）搬到 Worker；一次只算一份，算的時候又髒了 ⇒ 回來之後再算一次（中間進來的塊併成一次）；
//   回來才換貼圖（算的那段時間畫舊的那一張）。每塊的地面只在換了（新的一份、城鎮整過地）才送過去（BEDDRYW.sent），Worker 自己留著、窗外的丟掉。
//   開不了 Worker ⇒ 照舊在這一頁算（同一支 bedDryCalc ⇒ 遮罩逐位元組相同），但兩次之間至少隔 BED_DRY_GAP ms（遮罩晚一點到沒關係）。
//   Worker 那一條也節流（TASK-0819；Tim 2026-10-22「第1格照erina建議加節流吧」）：已經有貼圖 ⇒ 離上次建好不到 BED_DRY_GAP_W ms 先不送（dirty 留著，下一次再看）。
//     塊改 512 m 之後塊到得更頻繁 ⇒ 君士坦丁堡進場 45 秒重建 187～203 次（一次 29～49 ms，在 Worker）；第一次（還沒有貼圖）照舊馬上送。新塊進來後遮罩最多晚這麼久跟上。
var BEDDRYW = { w: null, ok: null, busy: null, sent: {}, id: 0 }, BED_DRY_GAP = 500, BED_DRY_GAP_W = 2000;
function bedDryTex() {
  var Dy = BEDDRY, A = BED.A; if (TOWNS.ver !== Dy.tver) { Dy.tver = TOWNS.ver; Dy.dirty = true; }   // 城鎮換了 ⇒ 整地換了
  if (!Dy.dirty || BEDDRYW.busy) return;
  var w = bedDryWorker();
  if (!w && Dy.tex && (bedBusy() || performance.now() - (Dy.at || 0) < BED_DRY_GAP)) return;
  if (w && Dy.tex && performance.now() - (Dy.at || 0) < BED_DRY_GAP_W) return;      // Worker 也節流（見上）
  var S = BED_SEA_SP, GS = A.chunk / S, nx = A.x[1] - A.x[0] + 1, ny = A.y[1] - A.y[0] + 1, L = [], st = {}, sent = {}, old = [], nOld = 0, t0 = performance.now();
  Dy.dirty = false;
  Object.keys(Dy.src).forEach(function (k) {                             // 有陸地的塊（地面最高 > 0）
    var C = Dy.src[k], c = k.split('_').map(Number), ci = c[0] - A.x[0], cj = c[1] - A.y[0];
    if (!(C && C.max0 > 0 && ci >= 0 && cj >= 0 && ci < nx && cj < ny)) return;
    // 地面照 bedDryPut 記下的那一份（Dy.hv），不在這裡 townHv：規劃晚到、城換了（TOWNS.ver）⇒ 以前這一圈把還沒整地的塊在同一格全部整掉（君士坦丁堡 0.55～0.84 s；TASK-0819）。
    //   還沒輪到重新整地的塊先用舊的地面；輪到時（63_towns.js townRegrade ⇒ 'bedChunk' ⇒ bedDryPut）記下新的、弄髒遮罩。
    var hv = Dy.hv[k] || C.h, one = { h: hv, n: C.n, step: C.step }; L.push([k, ci, cj]);
    if (!w) { st[k] = one; return; }
    sent[k] = hv; if (BEDDRYW.sent[k] !== hv) { one.h = hv.slice(); w.postMessage({ op: 'put', k: k, c: one }, [one.h.buffer]); }
  });
  Object.keys(Dy.c).forEach(function (k) {                               // 以前那一種（32 m 一格）
    var D = Dy.c[k]; if (!D) return; nOld++;
    var c = k.split('_').map(Number), ci = c[0] - A.x[0], cj = c[1] - A.y[0]; if (ci >= 0 && cj >= 0 && ci < nx && cj < ny) old.push([ci, cj, D]);
  });
  BEDDRYW.sent = sent;
  if (!L.length && !nOld) { Dy.on = false; Dy.cells = Dy.cut = 0; return; }   // 沒有陸地 ⇒ 不用遮（海上的海域整段跳過，畫面逐位元組不變）
  var m = { op: 'calc', S: S, GS: GS, G: A.chunk / BED_DRY_SP, sp: BED_DRY_SP, nx: nx, ny: ny, wet: BED_SEA_WET, low: BED_SEA_LOW, band: BED_SEA_BAND, L: L, old: old };
  var ctx = { A: A, key: bedDryKey(), r: [A.x[0] * A.chunk - BED.ax, A.y[0] * A.chunk - BED.az, nx * GS * S, ny * GS * S], Wd: nx * GS, Hd: ny * GS };
  if (!w) { var R = bedDryCalc(m, st); bedDryDone(ctx, R, performance.now() - t0); bedSpent(t0); return; }
  ctx.id = m.id = ++BEDDRYW.id; BEDDRYW.busy = ctx; w.postMessage(m);
}
/** 遮罩對到的那個窗（Worker 算的時候窗換了 ⇒ 回來的那一份作廢、再算一次）。 */
function bedDryKey() { var A = BED && BED.A; return A ? [A.x[0], A.x[1], A.y[0], A.y[1], A.chunk, BED.ax, BED.az].join(',') : ''; }
/** 算好的遮罩 ⇒ 貼圖（R8、雙線性；Wd × Hd 格）。一格都不用遮 ⇒ 關。 */
function bedDryDone(ctx, R, ms) {
  var Dy = BEDDRY; Dy.ms = +ms.toFixed(1); Dy.at = performance.now(); Dy.cells = R.cells; Dy.cut = R.cut;
  if (!R.cells) { Dy.on = false; return; }
  if (!Dy.tex) { Dy.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, Dy.tex); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); }
  gl.bindTexture(gl.TEXTURE_2D, Dy.tex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, ctx.Wd, ctx.Hd, 0, gl.RED, gl.UNSIGNED_BYTE, R.T); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4); gl.bindTexture(gl.TEXTURE_2D, null);
  Dy.on = true; Dy.r = ctx.r; Dy.builds++;
}
/** 遮罩的 Worker（第一次要用才開；Blob ⇒ 單一檔案的成品也開得了）。開不了 ⇒ null（照舊在這一頁算）。 */
function bedDryWorker() {
  var W = BEDDRYW; if (W.ok !== null) return W.ok ? W.w : null;
  try {
    var src = bedDryCalc.toString() + '\nvar st = {};\nonmessage = function (e) {\n  var m = e.data; if (m.op === "put") { st[m.k] = m.c; return; }\n' +
      '  var keep = {}; m.L.forEach(function (l) { keep[l[0]] = 1; }); Object.keys(st).forEach(function (k) { if (!keep[k]) delete st[k]; });\n' +
      '  var t0 = performance.now(), R = bedDryCalc(m, st); R.id = m.id; R.ms = performance.now() - t0; postMessage(R, [R.T.buffer]);\n};\n';
    W.w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    W.w.onmessage = bedDryMsg;
    W.w.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); bedDryFail(); };
    W.ok = true;
  } catch (e) { W.ok = false; W.w = null; }
  return W.w;
}
function bedDryMsg(e) {
  var R = e.data, ctx = BEDDRYW.busy; BEDDRYW.busy = null;
  if (!ctx || R.id !== ctx.id) return;
  if (!BED || BED.A !== ctx.A || bedDryKey() !== ctx.key) { BEDDRY.dirty = true; return; }   // 算的時候海域、窗換了 ⇒ 作廢、照新的再算
  bedDryDone(ctx, R, R.ms);
}
function bedDryFail() {                                                  // Worker 掛了 ⇒ 收掉、改在這一頁算
  var W = BEDDRYW; try { W.w.terminate(); } catch (e) { /* 已經停了 */ }
  W.w = null; W.ok = false; W.busy = null; W.sent = {}; BEDDRY.dirty = true;
}
/** 算遮罩（純函式：Worker 與這一頁共用同一份原始碼）。m：窗（nx × ny 塊、每塊 GS × GS 格、S 公尺一格）、L ＝ [[塊, ci, cj]…]、old ＝ [[ci, cj, 舊遮罩]…]；
 *  st[塊] ＝ { h：地面（城鎮整過地的那一份，公寸）, n, step }。⇒ { T：Wd × Hd（255 ＝ 不畫海）, cells, cut }。
 *  兩種都遮：
 *  1. 跟海斷開的低地（Tim 2026-10-21「是否可以用遮罩或其他方式 避免海水跑到岸上太深位置(且已跟海斷開) 保留沿岸的浪」；圖上是城裡被整地壓到快貼海面的地）：
 *     每一格取那一塊最近的點（細的塊 4 m、中等塊 8～16 m）。
 *     · 海：只走「水」的格子（地面 < wet）—— 從窗邊、從沒有陸地的塊（整塊都是海，不逐格算）往裡淹（四鄰），淹得到的才是海。
 *       ⛔ 不能走「低地」：海灘本身就低於幾公尺，走得過去的話城裡的坑都會經過海灘「連到海」（2026-10-21 第一版就是這樣，一格都沒遮到）。
 *     · 岸：跟海連著的水邊往裡 band 格以內、地面 < low 的低地 ⇒ 照舊畫海（浪沖得上海灘）。
 *     · 其他的低地（再往裡的、沒跟海連著的水坑）⇒ 遮；它旁邊高的那一圈也遮（雙線性的交界不會在坑邊露出一條海）。
 *     只在有陸地的塊裡逐格算（沒有陸地的塊整塊當成海、跳過）⇒ 時間跟陸地的面積走，不跟整個窗。
 *  2. 以前那一種（old，sp 公尺一格）：「不是海（陸地或內陸水）而且低於 0」的點、整格都不是海 ⇒ 遮（恩里基約湖；跟海連著的低於 0 的陸地也算）。 */
function bedDryCalc(m, st) {
  var S = m.S, GS = m.GS, G = m.G, Wd = m.nx * GS, Hd = m.ny * GS, N = Wd * Hd, LC = [], cut = 0, cells = 0;
  m.L.forEach(function (l) { var c = st[l[0]]; if (c) LC.push({ h: c.h, n: c.n, step: c.step, ci: l[1], cj: l[2] }); });
  var inL = new Uint8Array(N), wet = new Uint8Array(N), low = new Uint8Array(N), sea = new Uint8Array(N), T = new Uint8Array(N), Q = [], qh = 0, o, x, y, q;
  LC.forEach(function (L) {                                              // 每一格的地面：照那一塊最近的取樣點
    var hv = L.h, n = L.n, f = S / L.step, Wl = m.wet * 10, Ll = m.low * 10;
    for (var b2 = 0; b2 < GS; b2++) {
      var j = Math.min(n - 1, Math.round((b2 + 0.5) * f)), row = (L.cj * GS + b2) * Wd + L.ci * GS;
      for (var a2 = 0; a2 < GS; a2++) { var h = hv[j * n + Math.min(n - 1, Math.round((a2 + 0.5) * f))]; o = row + a2; inL[o] = 1; if (h < Ll) low[o] = 1; if (h < Wl) wet[o] = 1; }
    }
  });
  function outside(X, Y) { return X < 0 || Y < 0 || X >= Wd || Y >= Hd || !inL[Y * Wd + X]; }   // 窗外、沒有陸地的塊 ⇒ 海
  LC.forEach(function (L) {                                              // 種子：碰到「外面」（海）的水格
    for (var b3 = 0; b3 < GS; b3++) for (var a3 = 0; a3 < GS; a3++) {
      x = L.ci * GS + a3; y = L.cj * GS + b3; o = y * Wd + x; if (!wet[o]) continue;
      if (outside(x - 1, y) || outside(x + 1, y) || outside(x, y - 1) || outside(x, y + 1)) { sea[o] = 1; Q.push(o); }
    }
  });
  function go(o2) { if (inL[o2] && wet[o2] && !sea[o2]) { sea[o2] = 1; Q.push(o2); } }
  while (qh < Q.length) { o = Q[qh++]; x = o % Wd; if (x > 0) go(o - 1); if (x < Wd - 1) go(o + 1); if (o >= Wd) go(o - Wd); if (o < N - Wd) go(o + Wd); }
  // 岸：從海（連著的水格、陸地塊外面）往裡 band 格的低地 ⇒ 照舊畫海（sea 標 2）
  var front = Q.slice(); LC.forEach(function (L) {
    for (var b4 = 0; b4 < GS; b4++) for (var a4 = 0; a4 < GS; a4++) {
      x = L.ci * GS + a4; y = L.cj * GS + b4; o = y * Wd + x; if (sea[o] || !low[o]) continue;
      if (outside(x - 1, y) || outside(x + 1, y) || outside(x, y - 1) || outside(x, y + 1)) { sea[o] = 2; front.push(o); }
    }
  });
  for (var step = 0; step < m.band; step++) {
    var nf = []; front.forEach(function (o3) { var X = o3 % Wd; [X > 0 ? o3 - 1 : -1, X < Wd - 1 ? o3 + 1 : -1, o3 - Wd, o3 + Wd].forEach(function (o4) { if (o4 >= 0 && o4 < N && inL[o4] && low[o4] && !sea[o4]) { sea[o4] = 2; nf.push(o4); } }); });
    front = nf;
  }
  LC.forEach(function (L) {                                              // 遮：剩下的低地；再一圈：旁邊高的（八鄰）
    for (var b5 = 0; b5 < GS; b5++) for (var a5 = 0; a5 < GS; a5++) { o = (L.cj * GS + b5) * Wd + L.ci * GS + a5; if (low[o] && !sea[o]) { T[o] = 255; cut++; } }
  });
  if (cut) LC.forEach(function (L) {
    for (var b6 = 0; b6 < GS; b6++) for (var a6 = 0; a6 < GS; a6++) {
      x = L.ci * GS + a6; y = L.cj * GS + b6; o = y * Wd + x; if (low[o] || T[o]) continue;
      for (var dy = -1; dy <= 1 && !T[o]; dy++) for (var dx = -1; dx <= 1; dx++) { var X2 = x + dx, Y2 = y + dy; if (X2 < 0 || Y2 < 0 || X2 >= Wd || Y2 >= Hd) continue; q = Y2 * Wd + X2; if (T[q] === 255) { T[o] = 128; break; } }
    }
  });
  m.old.forEach(function (d) {                                           // 以前那一種（sp 公尺一格）⇒ 那一格蓋的 r × r 格
    var D = d[2], ci = d[0], cj = d[1], r = m.sp / S;
    for (var b7 = 0; b7 < G; b7++) for (var a7 = 0; a7 < G; a7++) if (D[b7 * G + a7]) for (var v = 0; v < r; v++) for (var u = 0; u < r; u++) T[(cj * GS + b7 * r + v) * Wd + ci * GS + a7 * r + u] = 255;
  });
  for (o = 0; o < N; o++) if (T[o]) { T[o] = 255; cells++; }
  return { T: T, cells: cells, cut: cut };
}
// 內陸水的著色器（第一次畫的時候建）：淡水的顏色（偏綠褐）、照水深變透（岸上的角 0 ⇒ 岸線淡出去）、菲涅耳反射天空、陽光的亮點、細的漣漪；
//   陡的地方（瀑布的水幕：法線 y < 0.5 左右）⇒ 白的、往下流的條紋，比平的水不透明。法線照畫面上的微分算（網格只有位置＋水深）。霧照地形（BED_FOG）。
var BEDW_VS = '#version 300 es\nlayout(location=0) in vec3 aP; layout(location=1) in float aD; uniform mat4 uVP; out vec3 vW; out float vD;\n' +
  'void main(){ vW=aP; vD=aD; gl_Position=uVP*vec4(aP,1.0); }\n';
function bedWaterFS() {
  return '#version 300 es\nprecision highp float;\n' + SHADOW_GLSL + 'in vec3 vW; in float vD; uniform vec3 uSun,uEye,uFog,uSky,uGround; uniform float uFogD,uSeaT; out vec4 o;\n' +
    'float bh(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }\n' +
    'float bn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(bh(i),bh(i+vec2(1.0,0.0)),f.x),mix(bh(i+vec2(0.0,1.0)),bh(i+vec2(1.0,1.0)),f.x),f.y); }\n' +
    'void main(){ vec3 n=normalize(cross(dFdy(vW),dFdx(vW))); if(n.y<0.0) n=-n; float fall=smoothstep(0.3,0.6,1.0-n.y);\n' +
    ' vec2 p=vW.xz; vec3 v=normalize(uEye-vW); float fd=length(uEye-vW);\n' +
    ' float rk=(1.0-fall)*(1.0-smoothstep(60.0,500.0,fd)); vec2 g=vec2(bn(p*0.45+vec2(uSeaT*0.13,0.0))-0.5,bn(p*0.45+vec2(5.2,uSeaT*0.11))-0.5)*0.16*rk;\n' +
    ' vec3 nn=normalize(n+vec3(g.x,0.0,g.y)); float fr=0.02+0.98*pow(1.0-max(dot(nn,v),0.0),5.0);\n' +
    ' vec3 r=reflect(-v,nn); vec3 sky=mix(uFog,uSky,clamp(r.y*1.6,0.0,1.0)); float sk=shadowK(vW,vec3(0.0,1.0,0.0));\n' +
    ' vec3 lit=mix(uGround,uSky,0.6)*0.65+vec3(1.0,0.96,0.88)*max(dot(n,uSun),0.0)*0.7*sk;\n' +
    ' float sp=pow(max(dot(r,uSun),0.0),160.0)*1.3*sk*(1.0-fall);\n' +
    ' vec3 c=mix(vec3(0.07,0.19,0.16)*lit,sky,fr)+vec3(1.0,0.92,0.75)*sp;\n' +
    ' float e=smoothstep(0.0,0.4,vD), a=clamp(e*mix(0.55,0.9,1.0-exp(-0.25*vD))+fr*0.4*e,0.0,0.97);\n' +
    ' if(fall>0.0){ vec2 hn=normalize(n.xz+vec2(1e-4,0.0)); float u=dot(p,vec2(-hn.y,hn.x));\n' +
    '   float s=bn(vec2(u*1.3,vW.y*0.25+uSeaT*2.2))*0.6+bn(vec2(u*4.0,vW.y*0.9+uSeaT*4.5))*0.4;\n' +
    '   c=mix(c,vec3(0.88,0.91,0.93)*(lit*0.8+0.25)*(0.78+0.35*s),fall); a=mix(a,0.78+0.2*s,fall*smoothstep(0.0,0.2,vD)); }\n' +
    ' o=vec4(mix(c,uFog,1.0-exp(-fd*uFogD)),a); }\n';
}
/** 畫內陸水（60_render.js：海、遠海之後）：在用的塊畫細的、沒有細的才畫遠景那一份；半透明、不寫深度、兩面都畫。 */
function bedWaterDraw() {
  var W = BEDWAT; W.n = W.tris = 0;
  if (!BED || !BED.A || !W.on) return;
  var L = [];
  Object.keys(BEDGL).forEach(function (k) { if (BEDGL[k].w) L.push(BEDGL[k].w); });
  Object.keys(BEDFAR.g).forEach(function (k) { if (!BEDGL[k] && BEDFAR.g[k].w) L.push(BEDFAR.g[k].w); });
  if (!L.length) return;
  var PW = W.prog || (W.prog = VK.compile(gl, BEDW_VS, bedWaterFS()));
  gl.useProgram(PW.prog); setCommon(PW); gl.uniform1f(PW.u.uFogD, WX.fog * BED_FOG * CAM.fogK);
  var cf = gl.isEnabled(gl.CULL_FACE); gl.disable(gl.CULL_FACE); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
  var PL = bedPlanes(CAM.vp);
  L.forEach(function (w) { if (!bedSeen(PL, w.bb)) return; W.n++; W.tris += w.n / 3; gl.bindVertexArray(w.vao); gl.drawElements(gl.TRIANGLES, w.n, gl.UNSIGNED_INT, 0); });
  gl.bindVertexArray(null); gl.depthMask(true); if (cf) gl.enable(gl.CULL_FACE);
}
// 遠海（轉場拉高時；Tim 2026-10-19：「海面問題可以額外貼一張圖嗎」「拉進後就隱藏這張海面色的填充圖」）：
//   海面網格只有 4 km 半徑、深海塊沒有網格 ⇒ 從 10 km 往下看是中間一個圓、外面空的。⇒ 海之後畫一大片平面（鏡頭正下方 ±40 km、海面下 0.5 m），
//   顏色照海從高處看的顏色＋同一套霧：網格以內海面在它前面（照常畫，看得到海底），網格以外它蓋掉水下的東西（海底、空的），陸地照樣在它上面。
//   只在鏡頭高於 BEDSEA_H（3 km）畫：3 km 以下畫面四角都在網格裡（16:9 ⇒ 0.99 × 高度），本來就被蓋住 ⇒ 關掉不會跳。平常的海戰鏡頭不會到這麼高。
var BEDSEA = { prog: null, vao: null, u: null, col: [0.11, 0.25, 0.31] }, BEDSEA_H = 3000;
function bedSeaDraw() {
  if (!BED || !BED.A || CAM.eye[1] < BEDSEA_H) return;
  var S = BEDSEA;
  if (!S.prog) {
    S.prog = VK.compile(gl,
      '#version 300 es\nlayout(location=0) in vec2 aP; uniform mat4 uVP; uniform vec3 uEye; out vec3 vW; void main(){ vW=vec3(uEye.x+aP.x*40000.0,-0.5,uEye.z+aP.y*40000.0); gl_Position=uVP*vec4(vW,1.0); }\n',
      '#version 300 es\nprecision highp float; in vec3 vW; uniform vec3 uEye,uFog,uCol; uniform float uFogD; out vec4 o;\n' + BED_DRY_GLSL +   // 低於海平面的乾地照樣丟掉（bedDryU）
      'void main(){ if(bedDry(vW.xz)) discard; float fd=length(vW-uEye); o=vec4(mix(uCol,uFog,1.0-exp(-fd*uFogD)),1.0); }\n');
    S.vao = gl.createVertexArray(); var vb = gl.createBuffer();
    gl.bindVertexArray(S.vao); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null);
  }
  var cf = gl.isEnabled(gl.CULL_FACE); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
  gl.useProgram(S.prog.prog); setCommon(S.prog); gl.uniform3fv(S.prog.u.uCol, S.col); bedDryU(S.prog.u);
  gl.bindVertexArray(S.vao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
  if (cf) gl.enable(gl.CULL_FACE);
}
/** 陰影的靜態那一層（60_render.js csmStatic；PASS.vp 已經換成那一段）：地形的網格只寫深度 —— 細的、沒有細的才畫遠景塊，照陰影那一層的範圍（PL）剔除。⇒ 畫了幾塊。 */
function bedDepth(PL) {
  var P0 = P.bedD || (P.bedD = VK.compile(gl, BED_VS, DEPTH_ONLY_FS)), n = 0;
  gl.useProgram(P0.prog); setCommon(P0);
  function one(g) { if (!g || !g.n || (g.bb && !bedSeen(PL, g.bb))) return; n++; gl.bindVertexArray(g.vao); gl.drawElements(gl.TRIANGLES, g.n, gl.UNSIGNED_INT, 0); }
  Object.keys(BEDGL).forEach(function (k) { one(BEDGL[k]); });
  Object.keys(BEDFAR.g).forEach(function (k) { if (!BEDGL[k]) one(BEDFAR.g[k]); });
  gl.bindVertexArray(null); return n;
}
/** 畫（60_render.js：帆之後、折射複製之前）。每格最多建 2 塊（新載的、粗細要換的）⇒ 換中心那一下不會卡一大格。 */
function bedDraw() {
  if (!BED || !BED.A) return;
  bedBuild();
  var PB = P.bed || (P.bed = glProgTry(BED_VS, bedFS()));                // 開機時先送出編譯（01_gl.js programs）；還沒編好 ⇒ 這一格不畫地形（TASK-0816：以前在這裡等 2.6 秒）
  if (!PB) return;
  gl.useProgram(PB.prog); setCommon(PB);
  gl.uniform1f(PB.u.uFogD, WX.fog * BED_FOG * CAM.fogK);                            // 霧淡一點：島要從幾公里外就看得到（船照原本的霧）
  var PL = bedPlanes(PASS.vp || CAM.vp), D = BEDDRAW; D.n = D.cull = D.tris = 0;   // 視錐外的塊不畫（鏡頭後面、旁邊的島；BEDDRAW ⇒ __game.bed().draw）
  function one(g) { if (g.bb && !bedSeen(PL, g.bb)) { D.cull++; return; } D.n++; D.tris += g.n / 3; gl.bindVertexArray(g.vao); gl.drawElements(gl.TRIANGLES, g.n, gl.UNSIGNED_INT, 0); }
  Object.keys(BEDGL).forEach(function (k3) { one(BEDGL[k3]); });
  Object.keys(BEDFAR.g).forEach(function (k4) { if (!BEDGL[k4]) one(BEDFAR.g[k4]); });   // 遠景：細的沒有的那幾塊
  gl.bindVertexArray(null);
}
/** 這一格要換的地形網格（新載的、粗細要換的、遠景）：一格一次 —— 60_render.js render 在畫陰影之前先叫（Tim 2026-10-20「是某種更大範圍的陰影閃爍 且是一閃而過」）：
 *  以前在 bedDraw（畫陰影之後）才建 ⇒ 換網格的那一格，陰影圖還是舊的粗網格、主畫面已經是細的 ⇒ 粗的在起伏處高出細的 ⇒ 那一塊（1 km）細網格整片落在影子裡一格
 *  （淺海看得到海底 ⇒ 一大片海暗一下）。先建 ⇒ shadowPass 看到 bedMeshChanged、同一格就重畫那幾段 ⇒ 陰影與主畫面同一份網格。 */
var BEDBUILD_RFR = -1;
function bedBuild() {
  if (!BED || !BED.A || BEDBUILD_RFR === RFR) return;
  BEDBUILD_RFR = RFR;
  var built = 0, t0 = performance.now();                                 // 建網格照背景預算（08_seabed.js bedBusy：收塊、擺樹先用；用完了這一格就不建）
  while (BEDGL_Q.length && built < 2 && !bedBusy()) { var k = BEDGL_Q.shift(), C = bedShowC(k); if (C) { bedUpload(k, C, bedLod(C)); built++; bedSpent(t0); t0 = performance.now(); } }
  Object.keys(BEDGL).forEach(function (k2) {                            // 粗細要換的（換中心）、那一份換了的（原精度到了、城到了要整地）：bedLod 第一次會算整地（townHv，一塊 25～70 ms）⇒ 也算進預算
    var g = BEDGL[k2], C2 = bedShowC(k2); if (!C2 || built >= 2 || bedBusy()) return;
    var lod = bedLod(C2); bedSpent(t0); t0 = performance.now();
    if (g.lod !== lod || g.C !== C2) { bedUpload(k2, C2, lod); built++; bedSpent(t0); t0 = performance.now(); }
  });
  bedFarStep(built || bedBusy() ? 0 : 2);                                // 遠景：照樣要；這一格建過細的（或預算用完了）就不建遠景的網格
  bedFoamTex(); bedDryTex();
}
