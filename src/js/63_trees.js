// ───────────────────────── 島上的樹（只給人看；樹的形狀見 16_treegen.js） ─────────────────────────
// Tim 2026-10-19：「然後把樹種到島上吧(遠景可以用貼圖 低模)」
// 擺：海圖塊載進來（'bedChunk'）就照那一塊的高度擺（treePlant）—— 每一種樹各自每 place.spacing 公尺一個候選點（位置照雜湊抖開），
//   長不長照那一點的機率 ＝ dens × 海拔帶（alt，漸入漸出）× 底質權重（mats）× 林地（forest：跟著林地走、或避開）× 成片（patch）；坡度超過 slopeMax 不長；
//   跟「雜湊 55% ＋ clump 公尺一叢的雜訊 45%」比 ⇒ 一叢一叢、邊緣碎開（TASK-0725：沙灘上椰子樹與海葡萄、海邊淺水成片的紅樹、林子裡闊葉樹、高地松樹、乾的坡上龍舌蘭）。
//   林地：海圖塊帶了林地覆蓋（Blocksail 照每座島的種子算、大陸分區平滑混合；MAP_CHUNK.md §4）⇒ 照它；沒帶（舊檔）⇒ 自己的值雜訊（250 m 一片，TREE_FALLBACK 成是林子）；
//   植被（海圖塊的段 2，MAP_CHUNK.md §4；Blocksail 照物種的分區、氣候、土壤推算 —— gura 的物種系統）：有這一段、海域的 vis 名單裡有這一種 ⇒ 那一點的名單沒有它就不長；
//     沒有這一段（舊檔、Blockside 自己的 maps）⇒ 照上面的規則（跟以前一樣）。這一段只說「能不能長」，長多密、長在哪一條等高線照樹種自己的 place。
//   哪一棵、轉幾度（face ⇒ 往下坡歪）、多大、顏色深淺都照那一點的雜湊 ⇒ 同一塊每次一樣、跟載入順序無關。⛔ 不抽戰局的 rnd()、不進模擬（船不會上岸、砲彈不打樹）。
//   遠景塊（bedFarPut，32 m 一點的粗塊）也擺，間距 × TREE_FAR_SP —— 只拿來算樹冠殼；那一塊細的載進來了就換細的那一份（跟地形同一套）。
// 畫（treeDraw，接在地形後面）：離鏡頭 < TREE_LOD[0] 細的、< TREE_LOD[1] 低模、< TREE_SHELL[1] 貼圖（樹的側面照，面向鏡頭轉，開機時從細的那一份拍成一張圖集）。
// 再遠 ⇒ 樹冠殼（Tim 2026-10-19：「遠距離的樹林可以改用更簡易的算法(可以參考其他遊戲)」；飛行模擬、Arma 那類大地圖的做法）：
//   不再一棵一棵畫 —— 每塊照實際擺的樹數每 32 m 一格有幾棵（3×3 抹平 ⇒ 覆蓋 0～1），在地面上墊一層樹冠高的網格、塗樹冠的顏色（treeShell；
//   好幾種混著長 ⇒ 高度、顏色照那一格各種的棵數加權；place.shell 0 的小植物不算）；
//   一塊一份靜態網格、一次 draw。交接在 TREE_SHELL（1.1～1.5 km）：殼照距離抖動淡入、貼圖用同一個抖動互補淡出 ⇒ 同一個像素只有一個，沒有一刀切的線。
//   細的、低模照（樹種, 第幾棵）分組實例化畫（一組一次 draw）；看得到的塊換了、鏡頭動了 8 m 以上、或塊進出 ⇒ 重新分組（treeBin；塊照視錐先剔掉）。
//   place.view（小植物）⇒ 超過那個距離就不畫。貼圖集照格子排（每列 TREE_ATLAS_COLS 格起跳、棵數多了加寬到接近正方形 ⇒ 寬高都不超過 2048（WebGL2 保證的貼圖大小））。
//   光照跟地形同一套（天光、陽光、船的陰影、霧照 BED_FOG）；葉子照風搖（搖晃權重 × 風）。樹不投影子。
//   城鎮（63_towns.js）：高度照整過地的那一份（townHv）、規劃的 clear 裡不擺（townClr；樹與小植物都是）。
//   ?trees=0 ⇒ 不長樹。
var TREE_DENS_K = [0.3, 0.6, 1];                                        // 植物密度：畫質的「植物密度」少／中／多留幾成（07_gfx.js GFX.plant；treeBin 照位置雜湊挑，跟載入順序無關）
var TREE_LOD_D = [400, 650, 900, 1350];                                 // 低模到多遠：畫質的「立體樹的距離」（07_gfx.js GFX.treed；treeDraw 換了就重新分組）。⛔ 不超過 TREE_SHELL[0]（貼圖跟樹冠殼交接的地方）
var TREE_SHELL_D = [[1100, 1500], [1100, 1500], [1100, 1500], [1650, 2250]];   // 貼圖 ⇒ 樹冠殼的交接：全開 × 1.5（Tim 2026-10-21「繪製陰影&植物距離再多1.5倍」）
var TREE_LOD = [140, 650], TREE_SHELL = [1100, 1500], TREE_SHELL_G = 32, TREE_FAR_SP = 3, TREE_FAR_K = 1.35, TREE_REBIN = 8, TREE_FALLBACK = 0.55, TREE_ATLAS_COLS = 8, TREE_BB_MAX = 96, TREE_VEG_JIT = 70, TREE_CELL = 32;
var TREES = { on: Q.get('trees') !== '0', init: false, job: null, list: [], ch: {}, far: {}, eye: null, dirty: true, buf: [], cnt: null, bb: null, stat: { plant: 0, far: 0, d0: 0, d1: 0, d2: 0, binMs: 0, bakeMs: 0, genMs: 0, plantMs: 0, bySp: {} } };
evOn('bedChunk', function (cx, cy, C) { if (TREES.on && BED && BED.A) treeQueue(bedKey(cx, cy), C); }, 0, true);   // 有畫面迴圈 ⇒ 排隊、每格照預算擺（treePump）
evOn('bedDrop', function (cx, cy) { var k = bedKey(cx, cy); treeUnq(k); if (TREES.ch[k]) { delete TREES.ch[k]; TREES.dirty = true; } }, 0, true);

/** 整數格點的雜湊 ⇒ [0, 1)（i、j、s 都是整數）。 */
function treeHash(i, j, s) { var h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(s | 0, 1274126177); h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
/** 值雜訊 ⇒ [0, 1)（林地成片：x、y 公尺 ÷ 格寬）。 */
function treeNoise(x, y, s) {
  var i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j; u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
  var a = treeHash(i, j, s), b = treeHash(i + 1, j, s), c = treeHash(i, j + 1, s), d = treeHash(i + 1, j + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** 一塊（解碼好的 C）⇒ 樹：{ I: Float32Array（8 個一組：x, y, z, 轉角, 放大, 深淺, 樹種, 第幾棵；世界座標）, n, bb（外框）, sh（樹冠殼） }。
 *  一次擺完（遠景塊；快轉、無頭）；畫面迴圈照預算分格擺見 treePump —— 同一支 treeStep、同一個順序 ⇒ 擺出來逐位元相同。 */
function treePlant(C, far) { var J = treeJob(C, far); treeStep(J, Infinity); return J.res; }
/** 擺一塊樹的工作：treeStep 一段一段做 —— 準備（整地、每格的底質與海拔範圍）⇒ 一種一種、一列一列擺 ⇒ 樹冠殼。 */
function treeJob(C, far) { return { C: C, far: far, si: -1, sp: null, out: [], bb: [1e9, 1e9, 1e9, -1e9, -1e9, -1e9], ms: 0, res: null }; }
/** 做到 t1（performance.now()）或做完（每次至少做一小段：準備、一列、或收尾）；做完 ⇒ J.res、回 true。 */
function treeStep(J, t1) {
  var t0 = performance.now(), C = J.C, far = J.far;
  if (J.si < 0) treePrep(J);
  while (J.si < J.SP.length) {
    if (!J.sp && !treeSpecies(J)) { J.si++; continue; }
    var P = J.sp;
    while (P.j < P.m) { if (performance.now() >= t1 && !J.fresh) { J.ms += performance.now() - t0; return false; } J.fresh = false; treeRow(J, P, P.j++); }
    if (!far) TREES.stat.bySp[P.sp] = (TREES.stat.bySp[P.sp] || 0) + P.nk;
    J.sp = null; J.si++;
  }
  var out = J.out, bb = J.bb;
  bb[4] += 30; bb[0] -= 10; bb[2] -= 10; bb[3] += 10; bb[5] += 10;
  J.ms += performance.now() - t0; TREES.stat.plantMs += J.ms;
  if (far) TREES.stat.far += out.length / 8; else TREES.stat.plant += out.length / 8;
  J.res = { I: new Float32Array(out), n: out.length / 8, bb: bb, sh: out.length ? treeShell(C, out, far, J.hAt) : null };
  return true;
}
/** 準備：整地（townHv）；每 TREE_CELL 公尺一格（外擴一格）有哪些底質（位元）、最低最高的海拔 ⇒ 每一種先照它跳過整格（底質不合、海拔帶整個在外面）的候選點；
 *  只是提早跳過（雙線性的高度不會超出格點的最低最高、候選點的抖動 ＋ 底質取樣的四捨五入落在外擴的那一格裡）⇒ 擺出來的跟逐點查一樣。 */
function treePrep(J) {
  var C = J.C, size = BED.A.chunk, st = C.step, n = C.n, h = townHv(C);
  J.tcl = !!C.tc; J.SP = Object.keys(TREE_SPECIES); J.si = 0; J.fresh = true;   // fresh：這一段剛開始 ⇒ 準備完至少再擺一列
  J.hAt = function (x, z) {                                             // 塊裡 (x, z) 公尺的海拔（雙線性）
    var u = Math.max(0, Math.min(n - 1.001, x / st)), v = Math.max(0, Math.min(n - 1.001, z / st)), i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, o = j * n + i;
    return ((h[o] * (1 - fu) + h[o + 1] * fu) * (1 - fv) + (h[o + n] * (1 - fu) + h[o + n + 1] * fu) * fv) / 10;
  };
  var CG = TREE_CELL, cn = Math.ceil(size / CG), N2 = cn * cn, cm = new Int32Array(N2), lo = new Float32Array(N2).fill(1e9), hi = new Float32Array(N2).fill(-1e9), q, qi, qj;
  for (qj = 0; qj < n; qj++) for (qi = 0; qi < n; qi++) { q = Math.min(cn - 1, Math.floor(qj * st / CG)) * cn + Math.min(cn - 1, Math.floor(qi * st / CG)); var hv = h[qj * n + qi] / 10; cm[q] |= 1 << C.mat[qj * n + qi]; if (hv < lo[q]) lo[q] = hv; if (hv > hi[q]) hi[q] = hv; }
  var cmD = new Int32Array(N2), loD = new Float32Array(N2), hiD = new Float32Array(N2);
  for (qj = 0; qj < cn; qj++) for (qi = 0; qi < cn; qi++) {
    var mk = 0, l0 = 1e9, h0 = -1e9;
    for (var dj = -1; dj <= 1; dj++) for (var di = -1; di <= 1; di++) { var o2 = (qj + dj) * cn + qi + di; if (qi + di < 0 || qj + dj < 0 || qi + di >= cn || qj + dj >= cn) continue; mk |= cm[o2]; l0 = Math.min(l0, lo[o2]); h0 = Math.max(h0, hi[o2]); }
    q = qj * cn + qi; cmD[q] = mk; loD[q] = l0; hiD[q] = h0;
  }
  J.cn = cn; J.N2 = N2; J.cmD = cmD; J.loD = loD; J.hiD = hiD;
}
/** 第 J.si 種開始擺：候選點的間距、雜湊的種子、整格先跳過的表 ⇒ J.sp；這一種在這一塊不擺（遠景塊不算殼的小植物）⇒ false。 */
function treeSpecies(J) {
  var C = J.C, far = J.far, A = BED.A, size = A.chunk, si = J.si, sp = J.SP[si], S = TREE_SPECIES[sp], Pl = S.place, gap = Pl.spacing * (far ? TREE_FAR_SP : 1), m = Math.floor(size / gap);
  if (far && Pl.shell === 0) return false;                              // 遠景塊只拿來算樹冠殼 ⇒ 不算進殼的小植物不擺
  var vb = C.vg && A.vis ? A.vis.indexOf(sp) : -1, vs = vb >= 0 ? size / (C.vgN - 1) : 0;   // 植被段（Blocksail 照物種的分區、氣候、土壤推算，MAP_CHUNK.md §4）：這一種在不在那一點的名單裡；名單沒有這一種 ⇒ 不限
  var CG = TREE_CELL, cn = J.cn, N2 = J.N2, A4 = Pl.alt, mm = 0, ok = new Uint8Array(N2), cI = new Int32Array(m), q; for (q in Pl.mats) mm |= 1 << q;
  for (q = 0; q < N2; q++) ok[q] = gap > CG / 2 || (J.cmD[q] & mm && J.hiD[q] > A4[0] && J.loD[q] < A4[3]) ? 1 : 0;   // 間距大過半格 ⇒ 抖動可能跨出外擴的那一格 ⇒ 不先跳
  for (q = 0; q < m; q++) cI[q] = Math.min(cn - 1, Math.floor((q + 0.5) * gap / CG));
  J.sp = { sp: sp, si: si, S: S, Pl: Pl, gap: gap, m: m, j: 0, nk: 0, sd: 7001 + si * 131 + (far ? 17 : 0), fs: 7001 + (far ? 17 : 0), vb: vb, vs: vs, A4: A4, ok: ok, cI: cI,
    gi0: Math.round(C.cx * size / gap), gj0: Math.round(C.cy * size / gap) };
  return true;
}
/** 第 P.si 種的第 j 列候選點。 */
function treeRow(J, P, j) {
  var C = J.C, far = J.far, size = BED.A.chunk, st = C.step, n = C.n, hAt = J.hAt, out = J.out, bb = J.bb, Pl = P.Pl, S = P.S, si = P.si, gap = P.gap, m = P.m, sd = P.sd, fs = P.fs, A4 = P.A4, vb = P.vb, vs = P.vs, ok = P.ok, cI = P.cI;
  for (var i = 0, row = cI[j] * J.cn; i < m; i++) {
    if (!ok[row + cI[i]]) continue;
    var gi = P.gi0 + i, gj = P.gj0 + j, x = (i + 0.15 + 0.7 * treeHash(gi, gj, sd)) * gap, z = (j + 0.15 + 0.7 * treeHash(gi, gj, sd + 1)) * gap;
    if (J.tcl && townClr(C, x, z)) continue;                            // 城鎮的建築、路、牆、碼頭那裡不長（63_towns.js；空建地照長）
    var y = hAt(x, z); if (y <= A4[0] || y >= A4[3]) continue;
    var mt = C.mat[Math.min(n - 1, Math.round(z / st)) * n + Math.min(n - 1, Math.round(x / st))], wM = Pl.mats[mt]; if (!wM) continue;
    var e = Math.max(st, 4), gx = (hAt(x + e, z) - hAt(x - e, z)) / (2 * e), gz = (hAt(x, z + e) - hAt(x, z - e)) / (2 * e), g2 = gx * gx + gz * gz;
    if (g2 > Pl.slopeMax * Pl.slopeMax) continue;
    if (Pl.flat) { var fr = Pl.flat[0], f0 = hAt(x + fr, z), f1 = hAt(x - fr, z), f2 = hAt(x, z + fr), f3 = hAt(x, z - fr); if (Math.max(y, f0, f1, f2, f3) - Math.min(y, f0, f1, f2, f3) > Pl.flat[1]) continue; }   // 要一大片平的（紅樹：泥灘、瀉湖邊；塊邊上照塊裡最近的點）
    var wx = C.cx * size + x, wz = C.cy * size + z;                     // 海域座標（往東、往南公尺）：林地的雜訊照它 ⇒ 相鄰兩塊接得起來
    // 林地覆蓋：海圖帶了（Blocksail 照島的種子算、大陸分區平滑混合）⇒ 照它；沒帶（舊的海圖檔）⇒ 自己的雜訊（250 m 一片＋70 m 細節；每一種看同一張）
    var cov = C.fo ? treeCover(C, x, z) : Math.max(0, Math.min(1, (TREE_FALLBACK - (treeNoise(wx / 250, wz / 250, fs + 5) * 0.75 + treeNoise(wx / 70, wz / 70, fs + 6) * 0.25)) / 0.04 + 0.5));
    var p = Pl.dens * wM * (y < A4[1] ? (y - A4[0]) / (A4[1] - A4[0]) : y > A4[2] ? (A4[3] - y) / (A4[3] - A4[2]) : 1) * (Pl.forest >= 0 ? 1 - Pl.forest + Pl.forest * cov : 1 + Pl.forest * cov);
    if (Pl.patch) p *= Math.max(0, Math.min(1, (treeNoise(wx / Pl.patch[0], wz / Pl.patch[0], sd + 8) - Pl.patch[1]) / 0.08 + 0.5));
    if (vb >= 0) {                                                       // 查最近的那一點；位置照雜訊抖 ±TREE_VEG_JIT 公尺（每一種同一張 ⇒ 交界一叢一叢地換過去，不是 128 m 的方格）
      var vi2 = Math.round((x + (treeNoise(wx / 90, wz / 90, 991) - 0.5) * 2 * TREE_VEG_JIT) / vs), vj2 = Math.round((z + (treeNoise(wx / 90, wz / 90, 992) - 0.5) * 2 * TREE_VEG_JIT) / vs);
      vi2 = Math.max(0, Math.min(C.vgN - 1, vi2)); vj2 = Math.max(0, Math.min(C.vgN - 1, vj2));
      if (!(C.vg[vj2 * C.vgN + vi2] & (1 << vb))) continue;
    }
    if (treeHash(gi, gj, sd + 6) * 0.55 + treeNoise(wx / Pl.clump, wz / Pl.clump, sd + 7) * 0.45 >= p) continue;
    var r = treeHash(gi, gj, sd + 2), px = wx - BED.ax, pz = wz - BED.az, sc = treeIn(function () { return r; }, Pl.scale) * (far ? TREE_FAR_K : 1);
    var rot = Pl.face && g2 > 1e-4 ? Math.atan2(gz, -gx) + (treeHash(gi, gj, sd + 3) - 0.5) * 1.4 : treeHash(gi, gj, sd + 3) * 6.2832;   // face：模型 +x（歪的那一邊）轉到下坡
    out.push(px, y - (Pl.sink != null ? Pl.sink : 0.3), pz, rot, sc, 0.85 + 0.3 * treeHash(gi, gj, sd + 4), si, Math.floor(treeHash(gi, gj, sd + 5) * S.variants)); P.nk++;
    bb[0] = Math.min(bb[0], px); bb[2] = Math.min(bb[2], pz); bb[3] = Math.max(bb[3], px); bb[5] = Math.max(bb[5], pz); bb[1] = Math.min(bb[1], y); bb[4] = Math.max(bb[4], y);
  }
}
// 擺樹排隊（2026-10-20；08_seabed.js 檔頭「收塊排隊」）：有畫面迴圈（BED_SLICE）⇒ 'bedChunk' 只記下來（TREE_Q；同一塊只留最新的那一份），
//   畫面迴圈每格照背景預算擺（treePump：一塊照樹種、照列分好幾格做完；在用的塊先、遠景的樹冠殼後）；擺好之前那一塊照舊畫舊的那一份（城到了、換漩渦要重擺時不會先空一下）；
//   'bedDrop' ⇒ 排著的、擺到一半的一起丟。快轉、無頭 ⇒ 照舊當場擺。
var TREE_Q = [];
function treeQueue(k, C, far) {
  if (!BED_SLICE) { var F = treePlant(C, !!far); if (far) TREES.far[k] = F.sh || { n: 0 }; else { TREES.ch[k] = F; TREES.dirty = true; } return; }
  treeUnq(k, far); TREE_Q.push({ k: k, C: C, far: !!far });
}
function treeUnq(k, far) { far = !!far; TREE_Q = TREE_Q.filter(function (q) { return q.k !== k || q.far !== far; }); if (TREES.job && TREES.job.k === k && TREES.job.far === far) TREES.job = null; }
/** 擺排著的塊（90_main.js frame，接在 bedPump 後面、同一份背景預算；用完了就不做）：這一段剛開始的那一塊至少擺一列。 */
function treePump() {
  if (!TREES.on || bedBusy()) return;
  var t0 = performance.now(), t1 = bedT1();
  for (;;) {
    var J = TREES.job;
    if (!J) {
      var i = 0; while (i < TREE_Q.length && TREE_Q[i].far) i++; if (i >= TREE_Q.length) i = 0;   // 在用的塊先
      var q = TREE_Q.splice(i, 1)[0]; if (!q) break;
      J = TREES.job = treeJob(q.C, q.far); J.k = q.k;
    }
    J.fresh = true;
    if (!treeStep(J, t1)) break;
    TREES.job = null;
    if (J.far) TREES.far[J.k] = J.res.sh || { n: 0 }; else { TREES.ch[J.k] = J.res; TREES.dirty = true; }
    if (performance.now() >= t1) break;
  }
  bedSpent(t0);
}
/** 林地覆蓋（海圖塊選用的段，MAP_CHUNK.md §4）在塊裡 (x, z) 公尺 ⇒ 0～1（雙線性）。 */
function treeCover(C, x, z) {
  var m = C.foN, s = BED.A.chunk / (m - 1), u = Math.max(0, Math.min(m - 1.001, x / s)), v = Math.max(0, Math.min(m - 1.001, z / s)), i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, o = j * m + i, F = C.fo;
  return ((F[o] * (1 - fu) + F[o + 1] * fu) * (1 - fv) + (F[o + m] * (1 - fu) + F[o + m + 1] * fu) * fv) / 255;
}
/** 遠景塊（63_bed_gl.js bedFarPut 叫）：擺粗的一份（不留）⇒ 只留它的樹冠殼。 */
function treeFar(k, C) {
  if (!TREES.on || TREES.far[k]) return;
  treeQueue(k, C, true);                                                // 有畫面迴圈 ⇒ 排隊（treePump）；擺好之前那一塊沒有遠景的樹冠殼
}
/** 樹冠殼：I ＝ 這一塊擺的樹（8 個一組，世界座標）⇒ 每 TREE_SHELL_G 公尺一點數幾棵、3×3 抹平 ⇒ 覆蓋 0～1（每一種照自己的間距算：滿 ＝ 那一格那一種長滿的棵數的 55%）；
 *  覆蓋 > 0.12 ⇒ 地面 ＋ 樹冠高（那一格各種的平均高 × 放大 × 0.85，照棵數加權；照覆蓋 55～100%、每點抖 ± 10%）；其他 ⇒ 埋進地面 2 m（林子的邊斜下去）。
 *  顏色 ＝ 那一格各種樹葉的顏色（照棵數加權）、越密越暗、每點抖一點；place.shell 0 的不算；只出四角有一角是林子的那幾格。⇒ { vao, vb, ib, n（索引數）, bb }。 */
function treeShell(C, I, far, hAt) {
  var A = BED.A, G = TREE_SHELL_G, m = Math.round(A.chunk / G) + 1, x0 = C.cx * A.chunk - BED.ax, z0 = C.cy * A.chunk - BED.az, N = m * m, i, j;
  var cnt = new Float32Array(N), hs = new Float32Array(N), cs = new Float32Array(N * 3), SP = Object.keys(TREE_SPECIES).map(function (k) { return TREE_SPECIES[k]; });
  for (var o = 0; o < I.length; o += 8) {
    var S = SP[I[o + 6]], Pl = S.place; if (Pl.shell === 0) continue;
    i = Math.round((I[o] - x0) / G); j = Math.round((I[o + 2] - z0) / G); if (i < 0 || j < 0 || i >= m || j >= m) continue;
    var gap = Pl.spacing * (far ? TREE_FAR_SP : 1), w1 = gap * gap / (G * G * 0.55), q0 = j * m + i, lc = S.leaf.col;
    cnt[q0] += w1; hs[q0] += w1 * (S.height[0] + S.height[1]) / 2 * I[o + 4] * 0.85; cs[q0 * 3] += w1 * lc[0]; cs[q0 * 3 + 1] += w1 * lc[1]; cs[q0 * 3 + 2] += w1 * lc[2];
  }
  var cov = new Float32Array(N), Y = new Float32Array(N), Cc = new Float32Array(N * 3), l0 = SP[0].leaf.col, bb = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
  for (j = 0; j < m; j++) for (i = 0; i < m; i++) {
    var sw = 0, sv = 0, sh = 0, sr = 0, sg = 0, sb = 0;
    for (var dj = -1; dj <= 1; dj++) for (var di = -1; di <= 1; di++) {
      var ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= m || jj >= m) continue;
      var wt = di || dj ? 0.5 : 1, q1 = jj * m + ii; sw += wt; sv += wt * cnt[q1]; sh += wt * hs[q1]; sr += wt * cs[q1 * 3]; sg += wt * cs[q1 * 3 + 1]; sb += wt * cs[q1 * 3 + 2];
    }
    var c = Math.min(1, sv / sw), gnd = hAt(i * G, j * G), kk = j * m + i; cov[kk] = c;
    if (sv > 0) { Cc[kk * 3] = sr / sv; Cc[kk * 3 + 1] = sg / sv; Cc[kk * 3 + 2] = sb / sv; } else { Cc[kk * 3] = l0[0]; Cc[kk * 3 + 1] = l0[1]; Cc[kk * 3 + 2] = l0[2]; }
    Y[kk] = c > 0.12 ? gnd + sh / sv * (0.55 + 0.45 * c) * (0.9 + 0.2 * treeHash(C.cx * m + i, C.cy * m + j, 913)) : gnd - 2;
  }
  var V = new Float32Array(m * m * 9), Ix = [];
  for (j = 0; j < m; j++) for (i = 0; i < m; i++) {
    var k = j * m + i, q = k * 9, x = x0 + i * G, z = z0 + j * G, il = Math.max(0, i - 1), ir = Math.min(m - 1, i + 1), jl = Math.max(0, j - 1), jr = Math.min(m - 1, j + 1);
    var gx = (Y[j * m + ir] - Y[j * m + il]) / ((ir - il) * G), gz = (Y[jr * m + i] - Y[jl * m + i]) / ((jr - jl) * G), L = Math.sqrt(gx * gx + 1 + gz * gz), t = (0.78 + 0.3 * treeHash(C.cx * m + i, C.cy * m + j, 917)) * (1.05 - 0.3 * cov[k]);
    V[q] = x; V[q + 1] = Y[k]; V[q + 2] = z; V[q + 3] = -gx / L; V[q + 4] = 1 / L; V[q + 5] = -gz / L; V[q + 6] = Cc[k * 3] * t; V[q + 7] = Cc[k * 3 + 1] * t; V[q + 8] = Cc[k * 3 + 2] * t;
    if (cov[k] > 0.12) { bb[0] = Math.min(bb[0], x); bb[2] = Math.min(bb[2], z); bb[3] = Math.max(bb[3], x); bb[5] = Math.max(bb[5], z); bb[1] = Math.min(bb[1], Y[k] - 30); bb[4] = Math.max(bb[4], Y[k]); }
    if (i < m - 1 && j < m - 1 && (cov[k] > 0.12 || cov[k + 1] > 0.12 || cov[k + m] > 0.12 || cov[k + m + 1] > 0.12)) Ix.push(k, k + m, k + 1, k + 1, k + m, k + m + 1);
  }
  if (!Ix.length) return null;
  bb[0] -= G; bb[2] -= G; bb[3] += G; bb[5] += G;
  var g = { vao: gl.createVertexArray(), vb: gl.createBuffer(), ib: gl.createBuffer(), n: Ix.length, bb: bb };
  gl.bindVertexArray(g.vao); gl.bindBuffer(gl.ARRAY_BUFFER, g.vb); gl.bufferData(gl.ARRAY_BUFFER, V, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 36, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 24);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(Ix), gl.STATIC_DRAW); gl.bindVertexArray(null);
  return g;
}

// ── 網格、貼圖集、著色器（第一次要畫的時候建） ──
var TREE_VS = '#version 300 es\nlayout(location=0) in vec3 aP; layout(location=1) in vec3 aN; layout(location=2) in vec3 aC; layout(location=3) in float aW; layout(location=4) in vec4 aI; layout(location=5) in vec2 aS;\n' +
  'uniform mat4 uVP; uniform float uT, uWind; out vec3 vN; out vec3 vW; out vec3 vC; out vec3 vO; out float vL;\n' +
  'void main(){ float c=cos(aI.w), s=sin(aI.w); vec3 p=aP*aS.x; p=vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);\n' +
  ' float lf=step(1.5,aW), aw=aW-' + TREE_LEAF_DET.toFixed(1) + '*lf;\n' +   // 葉簇的旗標（16_treegen.js TREE_LEAF_DET）拆回搖晃權重
  ' float ph=aI.x*0.11+aI.z*0.07; vec2 sw=vec2(sin(uT*1.3+ph),cos(uT*1.07+ph*1.3))*aw*uWind*0.22*aS.x;\n' +
  ' vec3 w=aI.xyz+p+vec3(sw.x,0.0,sw.y); vN=vec3(c*aN.x+s*aN.z,aN.y,-s*aN.x+c*aN.z); vW=w; vC=aC*aS.y; vO=aI.xyz+p; vL=lf; gl_Position=uVP*vec4(w,1.0); }\n';
// 葉簇近看的葉片（Tim 2026-10-20「給樹葉近距離時 一些貼圖細化 椰子樹不用」「用算法去生成 不用太細(有風格化就好 不追求寫實風)」）：
//   只畫在葉簇（vL ＝ 1，16_treegen.js TREE_LEAF_DET）；照樹的座標（vO：不含搖晃 ⇒ 風吹時紋理黏在葉子上）切成約 0.4 m 一片的 3D 細胞（一片 ＝ 一格），
//   每片自己的朝向（法線偏一點 ⇒ 光照一片一片亮暗）、深淺、偏黃偏藍一點；片與片的縫暗一點 ⇒ 看起來是一層一層疊的葉子，不是一顆光滑的球。
//   16 m 內全開、42 m 淡完（貼圖遠景、低模那一段照舊）。
var TREE_FS = function () {
  return '#version 300 es\nprecision highp float;\n' + SHADOW_GLSL + 'in vec3 vN; in vec3 vW; in vec3 vC; in vec3 vO; in float vL; uniform vec3 uSun,uEye,uFog,uSky,uGround; uniform float uFogD; out vec4 o;\n' +
    'vec3 lh3(vec3 p){ return fract(sin(vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6))))*43758.5453); }\n' +
    // 3D 細胞（兩近點）：(最近那一格的編號, 第二近減最近 —— ≈ 0 是兩片的縫)；c0 ＝ 到最近那一點（片的中心）多遠
    'vec4 leafCell(vec3 p, out float c0){ vec3 i=floor(p), f=fract(p); float d1=8.0, d2=8.0; vec3 id=i;\n' +
    ' for(int z=-1;z<=1;z++) for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec3 g=vec3(float(x),float(y),float(z)), q=g+lh3(i+g)-f; float e=dot(q,q); if(e<d1){ d2=d1; d1=e; id=i+g; } else if(e<d2) d2=e; }\n' +
    ' c0=sqrt(d1); return vec4(id, sqrt(d2)-c0); }\n' +
    'void main(){ if(vW.y<uClip) discard; vec3 n=normalize(vN); if(!gl_FrontFacing) n=-n; float fd=length(vW-uEye), lk=vL*(1.0-smoothstep(16.0,42.0,fd)); vec3 tn=vec3(1.0);\n' +
    // 一片 ＝ 中間亮、往邊上慢慢暗的鼓起（bu），縫只淡淡暗一點（e）；朝向、深淺、偏黃偏藍每片不同
    ' if(lk>0.0){ float c0; vec4 lc=leafCell(vO*2.4,c0); vec3 r=lh3(lc.xyz+17.0)-0.5; n=normalize(n+r*0.7*lk);\n' +
    '  float bu=1.0-smoothstep(0.1,0.75,c0), e=smoothstep(0.0,0.06,lc.w), v=(0.86+0.26*r.x)*(0.8+0.28*bu)*mix(0.85,1.0,e);\n' +
    '  tn=mix(vec3(1.0),vec3(v*(1.0+0.10*r.y),v*(1.0+0.05*r.y),v*(1.0-0.12*r.y)),lk); }\n' +
    ' float sd=dot(n,uSun), d=max(sd,0.0)*0.8+abs(sd)*0.2;\n' +
    // 樹收的影子淡掉（到 uShTr ＝ 立體樹的距離 − 50 m，最後四成淡掉；預設 650 ⇒ 350～600 m）：再外面是貼圖（TREE_BB_FS，不收影子）⇒ 不淡的話那一圈網格的樹（被自己的樹冠遮）暗、貼圖亮，一刀切開
    ' float sk=mix(uSunK,shadowK(vW,n*1.5),1.0-smoothstep(uShTr*0.5833,uShTr,fd)); vec3 col=vC*tn*(mix(uGround,uSky,n.y*0.5+0.5)*0.7+vec3(1.0,0.96,0.88)*d*sk*0.72);\n' +
    ' o=vec4(mix(col,uFog,1.0-exp(-fd*uFogD)),1.0); }\n';
};
// 貼圖：面向鏡頭（只繞 y 轉）的一張四邊形；uBB[第幾棵] ＝ (圖集 u 起點, v 起點, 世界寬, 世界高)、uCell ＝ 一格的 (u 寬, v 高)
var TREE_BB_VS = '#version 300 es\nlayout(location=0) in vec2 aQ; layout(location=4) in vec4 aI; layout(location=5) in vec2 aS; uniform mat4 uVP; uniform vec3 uEye; uniform vec4 uBB[' + TREE_BB_MAX + ']; uniform vec2 uCell; out vec2 vT; out vec3 vW; out float vK;\n' +
  'void main(){ vec4 B=uBB[int(aI.w+0.5)]; vec3 to=uEye-aI.xyz; vec3 r=normalize(vec3(to.z,0.0,-to.x)+vec3(1e-4,0.0,0.0));\n' +
  ' vec3 w=aI.xyz+r*aQ.x*B.z*aS.x+vec3(0.0,aQ.y*B.w*aS.x,0.0); vW=w; vK=aS.y; vT=vec2(B.x+(aQ.x+0.5)*uCell.x,B.y+aQ.y*uCell.y); gl_Position=uVP*vec4(w,1.0); }\n';
// 交接（TREE_SHELL）的抖動：同一個像素的門檻，殼與貼圖用同一個 ⇒ 互補（殼畫的地方貼圖不畫）
var TREE_DITHER = 'float treeDi(vec2 p){ return fract(sin(dot(floor(p),vec2(12.9898,78.233)))*43758.5453); }\n';
var TREE_BB_FS = '#version 300 es\nprecision highp float; uniform sampler2D uTex; uniform vec3 uEye,uFog; uniform float uFogD,uSunK,uClip; uniform vec2 uFade; uniform vec3 uBkK; in vec2 vT; in vec3 vW; in float vK; out vec4 o;\n' + TREE_DITHER +
  'void main(){ if(vW.y<uClip) discard; if(smoothstep(uFade.x,uFade.y,length(vW.xz-uEye.xz))>treeDi(gl_FragCoord.xy)) discard; vec4 t=texture(uTex,vT); if(t.a<0.45) discard; vec3 col=t.rgb/t.a*vK*(0.6+0.4*uSunK)*uBkK;\n' +
  ' float fd=length(vW-uEye); o=vec4(mix(col,uFog,1.0-exp(-fd*uFogD)),1.0); }\n';
var TREE_SH_VS = '#version 300 es\nlayout(location=0) in vec3 aP; layout(location=1) in vec3 aN; layout(location=2) in vec3 aC; uniform mat4 uVP; out vec3 vN; out vec3 vW; out vec3 vC; void main(){ vN=aN; vW=aP; vC=aC; gl_Position=uVP*vec4(aP,1.0); }\n';
var TREE_SH_FS = '#version 300 es\nprecision highp float; in vec3 vN; in vec3 vW; in vec3 vC; uniform vec3 uSun,uEye,uFog,uSky,uGround; uniform float uFogD,uClip,uSunK; uniform vec2 uFade; out vec4 o;\n' + TREE_DITHER +
  'void main(){ if(vW.y<uClip) discard; if(smoothstep(uFade.x,uFade.y,length(vW.xz-uEye.xz))<=treeDi(gl_FragCoord.xy)) discard; vec3 n=normalize(vN); float d=max(dot(n,uSun),0.0);\n' +
  ' vec3 col=vC*(mix(uGround,uSky,0.6)*0.7+vec3(1.0,0.96,0.88)*d*uSunK*0.72); float fd=length(vW-uEye); o=vec4(mix(col,uFog,1.0-exp(-fd*uFogD)),1.0); }\n';
var TREE_BAKE_VS = '#version 300 es\nlayout(location=0) in vec3 aP; layout(location=1) in vec3 aN; layout(location=2) in vec3 aC; uniform mat4 uM; out vec3 vN; out vec3 vC; void main(){ vN=aN; vC=aC; gl_Position=uM*vec4(aP,1.0); }\n';
var TREE_BAKE_FS = '#version 300 es\nprecision highp float; in vec3 vN; in vec3 vC; out vec4 o; void main(){ vec3 n=normalize(vN); if(!gl_FrontFacing) n=-n; float d=max(dot(n,normalize(vec3(0.45,0.75,0.5))),0.0); o=vec4(vC*(0.62+0.62*d),1.0); }\n';

/** 樹種的網格（每種 variants 棵 × 細、低模）、遠景貼圖集、著色器；只建一次。TREES.vi[樹種編號] ＝ 那一種第 0 棵在貼圖集的第幾格。
 *  有畫面迴圈（BED_SLICE）⇒ 一棵一棵建、照背景預算（08_seabed.js bedBusy；全部 71 棵一次建約 0.15 s，以前第一次要畫樹的那一格整段卡住）；建好之前不畫樹 ⇒ 回 false。 */
function treeInit() {
  if (TREES.init) return true;
  if (bedBusy()) return false;
  var t0 = performance.now(), t1 = bedT1(), sps = Object.keys(TREE_SPECIES), G = TREES.gen || (TREES.gen = { si: 0, v: -1, cell: 0, ms: 0 });
  if (!TREES.vi) { TREES.vi = []; TREES.vw = []; }                      // vw[樹種] ＝ 超過這個距離（平方）就不畫
  while (G.si < sps.length) {
    var sp = sps[G.si], si = G.si, S = TREE_SPECIES[sp];
    if (G.v < 0) { TREES.vi[si] = G.cell; TREES.vw[si] = S.place.view ? S.place.view * S.place.view : Infinity; G.v = 0; }
    if (G.v >= S.variants) { G.si++; G.v = -1; continue; }
    var K = treeSkel(sp, 9157 + si * 7717 + G.v * 104729, G.v), m0 = treeMesh(K, 0), L = [m0, treeMesh(K, 1)].map(treeVao);   // 細的那一份同時拿去拍貼圖集（treeMesh 照 K 自己的亂數，同一份）
    TREES.list.push({ sp: si, v: G.v, cell: G.cell++, lod: L, mesh0: m0, h: K.h }); G.v++;
    if (performance.now() >= t1) { G.ms += performance.now() - t0; bedSpent(t0); return false; }
  }
  if (BED_SLICE && !G.last) { G.last = true; G.ms += performance.now() - t0; bedSpent(t0); return false; }   // 著色器與貼圖集留到下一格（不跟最後幾棵擠在同一格）
  TREES.init = true;
  TREES.stat.genMs = G.ms + performance.now() - t0;
  TREES.prog = VK.compile(gl, TREE_VS, TREE_FS());
  TREES.bbProg = VK.compile(gl, TREE_BB_VS, TREE_BB_FS);
  TREES.shProg = VK.compile(gl, TREE_SH_VS, TREE_SH_FS);
  TREES.ib = [gl.createBuffer(), gl.createBuffer(), gl.createBuffer()];  // 細、低模、貼圖的實例（每次分組重寫）
  TREES.quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, TREES.quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, 0, 0.5, 0, 0.5, 1, -0.5, 0, 0.5, 1, -0.5, 1]), gl.STATIC_DRAW);
  TREES.bbVao = gl.createVertexArray(); gl.bindVertexArray(TREES.bbVao); treeQuadAttr(); gl.bindBuffer(gl.ARRAY_BUFFER, TREES.ib[2]); treeInstAttr(0); gl.bindVertexArray(null);
  treeBake();
  bedSpent(t0);
  return true;
}
function treeVao(M) {
  var g = { vao: gl.createVertexArray(), vb: gl.createBuffer(), ib: gl.createBuffer(), n: M.I.length, h: M.h, w: M.w };
  gl.bindVertexArray(g.vao); gl.bindBuffer(gl.ARRAY_BUFFER, g.vb); gl.bufferData(gl.ARRAY_BUFFER, M.V, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 40, 24);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 40, 36);
  gl.enableVertexAttribArray(4); gl.vertexAttribDivisor(4, 1); gl.enableVertexAttribArray(5); gl.vertexAttribDivisor(5, 1);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, M.I, gl.STATIC_DRAW); gl.bindVertexArray(null);
  return g;
}
function treeQuadAttr() { gl.bindBuffer(gl.ARRAY_BUFFER, TREES.quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0); for (var a = 1; a < 4; a++) gl.disableVertexAttribArray(a); gl.enableVertexAttribArray(4); gl.vertexAttribDivisor(4, 1); gl.enableVertexAttribArray(5); gl.vertexAttribDivisor(5, 1); }
/** 實例屬性指到現在綁著的 ARRAY_BUFFER 的第 first 筆（6 個 float 一筆：x, y, z, 轉角或貼圖格, 放大, 深淺）。 */
function treeInstAttr(first) { gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 24, first * 24); gl.vertexAttribPointer(5, 2, gl.FLOAT, false, 24, first * 24 + 16); }
/** 遠景貼圖集：每一棵（細的那一份）從側面照一張（正交投影、固定的光），128 × 256 一格、每列 max(TREE_ATLAS_COLS, ⌈√(2 × 棵數)⌉) 格；alpha ＝ 有沒有東西；產生 mipmap（片段除回 alpha）。 */
function treeBake() {
  var t0 = performance.now(), N = TREES.list.length, CW = 128, CH = 256, NC = Math.min(N, Math.max(TREE_ATLAS_COLS, Math.ceil(Math.sqrt(2 * N)))), NR = Math.ceil(N / NC), W = CW * NC, H = CH * NR;
  if (N > TREE_BB_MAX) throw new Error('樹種的棵數 ' + N + ' 超過貼圖集上限 TREE_BB_MAX ' + TREE_BB_MAX);
  var prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING), prevVp = gl.getParameter(gl.VIEWPORT), cf = gl.isEnabled(gl.CULL_FACE), bl = gl.isEnabled(gl.BLEND);
  var tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  var rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H);
  var fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
  gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  var pr = VK.compile(gl, TREE_BAKE_VS, TREE_BAKE_FS); gl.useProgram(pr.prog); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST);
  TREES.bbU = new Float32Array(TREE_BB_MAX * 4); TREES.cellUV = [1 / NC, 1 / NR];
  TREES.list.forEach(function (T, k) {
    var M = T.mesh0, Hb = Math.max(M.h * 1.04, 4 * M.w * 1.04), Wb = Hb / 2, g = T.lod[0];
    gl.viewport(k % NC * CW, Math.floor(k / NC) * CH, CW, CH);
    gl.uniformMatrix4fv(pr.u.uM, false, new Float32Array([2 / Wb, 0, 0, 0, 0, 2 / Hb, 0, 0, 0, 0, -1 / Wb, 0, 0, -1, 0, 1]));
    gl.bindVertexArray(g.vao); gl.disableVertexAttribArray(4); gl.disableVertexAttribArray(5); gl.vertexAttrib4f(4, 0, 0, 0, 0); gl.vertexAttrib2f(5, 1, 1);
    gl.drawElements(gl.TRIANGLES, g.n, gl.UNSIGNED_SHORT, 0);
    gl.enableVertexAttribArray(4); gl.enableVertexAttribArray(5);
    TREES.bbU.set([k % NC / NC, Math.floor(k / NC) / NR, Wb, Hb], k * 4);
    T.mesh0 = null;
  });
  gl.bindVertexArray(null);
  gl.bindTexture(gl.TEXTURE_2D, tex); gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb); gl.viewport(prevVp[0], prevVp[1], prevVp[2], prevVp[3]); gl.deleteFramebuffer(fb); gl.deleteRenderbuffer(rb); gl.deleteProgram(pr.prog);
  if (cf) gl.enable(gl.CULL_FACE); if (bl) gl.enable(gl.BLEND);
  TREES.tex = tex; TREES.stat.bakeMs = performance.now() - t0;
}
/** 分組：看得到的塊（視錐）裡每一棵照離鏡頭多遠分到細、低模（照樹種與第幾棵分組）、貼圖 ⇒ 寫進三個實例緩衝區。 */
function treeBin(keys, eye) {
  var t0 = performance.now(), NL = TREES.list.length, cnt = new Int32Array(NL * 2 + 1), L0 = TREE_LOD[0] * TREE_LOD[0], L1 = TREE_LOD[1] * TREE_LOD[1], L2 = TREE_SHELL[1] * TREE_SHELL[1], vi = TREES.vi;
  // 3 ＝ 交給樹冠殼（這一棵不畫；水平距離，跟著色器的淡入淡出同一把尺）；4 ＝ 超過那一種的 view（小植物）不畫
  var vw = TREES.vw;
  // 植物密度（畫質）：每一棵照位置的雜湊（0～1，同一棵每次一樣）比 dk，大的不畫（細、低模、貼圖三級一起少；樹冠殼照擺的棵數不變 ⇒ 1.1 km 外照舊是整片林子）
  var dk = TREES.dens = TREE_DENS_K[GFX.plant] != null ? TREE_DENS_K[GFX.plant] : 1;
  function lodOf(I, o) {
    if (dk < 1) { var hh = Math.sin(I[o] * 12.9898 + I[o + 2] * 78.233) * 43758.5453; if (hh - Math.floor(hh) >= dk) return 4; }
    var dx = I[o] - eye[0], dy = I[o + 1] - eye[1], dz = I[o + 2] - eye[2], d = dx * dx + dy * dy + dz * dz; return d > vw[I[o + 6]] ? 4 : d < L0 ? 0 : d < L1 ? 1 : dx * dx + dz * dz < L2 ? 2 : 3;
  }
  keys.forEach(function (k) { var c = TREES.ch[k], I = c.I; for (var o = 0; o < I.length; o += 8) { var l = lodOf(I, o); if (l < 3) cnt[l < 2 ? l * NL + vi[I[o + 6]] + I[o + 7] : NL * 2]++; } });
  var off = new Int32Array(cnt.length), tot = [0, 0, 0];
  for (var b = 0; b < cnt.length; b++) { var l2 = b < NL ? 0 : b < NL * 2 ? 1 : 2; off[b] = tot[l2]; tot[l2] += cnt[b]; }
  var D = [0, 1, 2].map(function (l) { var need = tot[l] * 6; if (!TREES.buf[l] || TREES.buf[l].length < need) TREES.buf[l] = new Float32Array(Math.max(need, 6) * 1.5 | 0); return TREES.buf[l]; });
  var at = off.slice();
  keys.forEach(function (k) {
    var I = TREES.ch[k].I;
    for (var o = 0; o < I.length; o += 8) {
      var l = lodOf(I, o); if (l > 2) continue;
      var cell = vi[I[o + 6]] + I[o + 7], b = l < 2 ? l * NL + cell : NL * 2, q = at[b]++ * 6, A = D[l];
      A[q] = I[o]; A[q + 1] = I[o + 1]; A[q + 2] = I[o + 2]; A[q + 3] = l < 2 ? I[o + 3] : cell; A[q + 4] = I[o + 4]; A[q + 5] = I[o + 5];
    }
  });
  [0, 1, 2].forEach(function (l) { gl.bindBuffer(gl.ARRAY_BUFFER, TREES.ib[l]); gl.bufferData(gl.ARRAY_BUFFER, D[l].subarray(0, Math.max(6, tot[l] * 6)), gl.DYNAMIC_DRAW); });
  TREES.cnt = cnt; TREES.off = off; TREES.stat.d0 = tot[0]; TREES.stat.d1 = tot[1]; TREES.stat.d2 = tot[2]; TREES.stat.binMs = performance.now() - t0;
}
/** 畫（60_render.js：地形 bedDraw 之後）。 */
function treeDraw() {
  if (!TREES.on || !BED || !BED.A || PASS.vp) return;
  var keys = Object.keys(TREES.ch), farK = Object.keys(TREES.far); if (!keys.length && !farK.length) return;
  if (!treeInit()) return;                                            // 樹種的網格分好幾格建（BED_SLICE）：還沒建好 ⇒ 這一格先不畫樹
  var L1 = TREE_LOD_D[GFX.treed], SD = TREE_SHELL_D[GFX.treed]; if (L1 && L1 !== TREE_LOD[1]) { TREE_LOD[1] = L1; TREES.dirty = true; }
  if (SD && SD[0] !== TREE_SHELL[0]) { TREE_SHELL[0] = SD[0]; TREE_SHELL[1] = SD[1]; TREES.dirty = true; }
  if (TREES.dens !== TREE_DENS_K[GFX.plant]) TREES.dirty = true;           // 植物密度換了 ⇒ 重新分組（treeBin）   // 畫質的「立體樹的距離」換了 ⇒ 重新分組（陰影跟著：投影子的、收影子的都照它）
  var PL = bedPlanes(CAM.vp), eye = CAM.eye, E = TREES.eye, vis = keys.filter(function (k) { var c = TREES.ch[k]; return c.n && bedSeen(PL, c.bb); }), sig = vis.join(' ');
  if (TREES.dirty || !E || sig !== TREES.sig || Math.abs(E[0] - eye[0]) + Math.abs(E[1] - eye[1]) + Math.abs(E[2] - eye[2]) > TREE_REBIN) { treeBin(vis, eye); TREES.eye = eye.slice(); TREES.dirty = false; TREES.sig = sig; }   // 看得到的塊換了、鏡頭動了 8 m 以上、塊進出 ⇒ 重新分組
  var cf = gl.isEnabled(gl.CULL_FACE); gl.disable(gl.CULL_FACE);
  var fogD = WX.fog * BED_FOG * CAM.fogK, P1 = TREES.prog, NL = TREES.list.length;
  gl.useProgram(P1.prog); setCommon(P1); gl.uniform1f(P1.u.uFogD, fogD); gl.uniform1f(P1.u.uT, performance.now() / 1000); gl.uniform1f(P1.u.uWind, Math.min(2, 0.4 + (WX.wind || 1) * 0.6));
  for (var l = 0; l < 2; l++) TREES.list.forEach(function (T, c) {
    var n = TREES.cnt[l * NL + c]; if (!n) return; var g = T.lod[l];
    gl.bindVertexArray(g.vao); gl.bindBuffer(gl.ARRAY_BUFFER, TREES.ib[l]); treeInstAttr(TREES.off[l * NL + c]);
    gl.drawElementsInstanced(gl.TRIANGLES, g.n, gl.UNSIGNED_SHORT, 0, n);
  });
  var P2 = TREES.bbProg; gl.useProgram(P2.prog); setCommon(P2); gl.uniform1f(P2.u.uFogD, fogD); gl.uniform4fv(P2.u.uBB, TREES.bbU); gl.uniform2f(P2.u.uCell, TREES.cellUV[0], TREES.cellUV[1]); gl.uniform2f(P2.u.uFade, TREE_SHELL[0], TREE_SHELL[1]);
  gl.activeTexture(gl.TEXTURE11); gl.bindTexture(gl.TEXTURE_2D, TREES.tex); gl.uniform1i(P2.u.uTex, 11); gl.activeTexture(gl.TEXTURE0);
  if (TREES.stat.d2) { gl.bindVertexArray(TREES.bbVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, TREES.stat.d2); }
  // 樹冠殼：細的塊用自己的、沒載細的那幾塊用遠景塊的（跟地形同一套）
  var P3 = TREES.shProg, ns = 0, nt = 0; gl.useProgram(P3.prog); setCommon(P3); gl.uniform1f(P3.u.uFogD, fogD); gl.uniform2f(P3.u.uFade, TREE_SHELL[0], TREE_SHELL[1]);
  function far2(b) { var dx = Math.max(Math.abs(b[0] - eye[0]), Math.abs(b[3] - eye[0])), dz = Math.max(Math.abs(b[2] - eye[2]), Math.abs(b[5] - eye[2])); return dx * dx + dz * dz; }   // 外框離鏡頭最遠的那一角（水平）
  function shell(g) { if (!g || !g.n || !bedSeen(PL, g.bb) || far2(g.bb) < TREE_SHELL[0] * TREE_SHELL[0]) return; ns++; nt += g.n / 3; gl.bindVertexArray(g.vao); gl.drawElements(gl.TRIANGLES, g.n, gl.UNSIGNED_SHORT, 0); }
  keys.forEach(function (k) { shell(TREES.ch[k].sh); });
  farK.forEach(function (k) { if (!TREES.ch[k]) shell(TREES.far[k]); });
  TREES.stat.shells = ns; TREES.stat.shellTris = nt;
  gl.bindVertexArray(null); if (cf) gl.enable(gl.CULL_FACE);
}
/** 陰影的靜態那一層（60_render.js csmStatic；PASS.vp 已經換成那一段）：照主畫面上一次分好的組（treeBin：細的、低模那兩級，各自的實例緩衝）只寫深度；
 *  不晃（uT、uWind 0：那一層不是每一格重畫）。遠處的貼圖與樹冠殼不畫（TREE_LOD[1] 以外：畫質的「立體樹的距離」，400／650／900 m）。⇒ 畫了幾棵。
 *  兩組一律用細的網格投影子（Tim 2026-10-20「只動了一點點陰影就完全不同」、舊版也「陰影會出現在中間(天空沒東西)」）：低模把枝尖的葉團併成一大團，比細的胖一圈；
 *    靜態那一層最久一秒才重畫，鏡頭一動，一批樹在主畫面從低模換成細的（每 8 m 重分組）⇒ 細的葉子整個躲在陰影圖裡那團舊的低模裡 ⇒ 一整帶森林全在影子裡、下一次重畫又亮回來。
 *    細的不會包住任何一級的葉子 ⇒ 樹換級、靜態那一層晚一點重畫都不會整帶變暗（投影子的跟收的對得上，其他遊戲也是「投影子的不能比畫面上的胖」）。 */
function treeDepth() {
  if (!TREES.on || !TREES.init || !TREES.cnt || !TREES.list.length) return 0;
  var P0 = TREES.dProg || (TREES.dProg = VK.compile(gl, TREE_VS, DEPTH_ONLY_FS)), NL = TREES.list.length, n = 0;
  gl.useProgram(P0.prog); setCommon(P0); if (P0.u.uT) gl.uniform1f(P0.u.uT, 0); if (P0.u.uWind) gl.uniform1f(P0.u.uWind, 0);
  for (var l = 0; l < 2; l++) TREES.list.forEach(function (T, c) {
    var k = TREES.cnt[l * NL + c]; if (!k) return; var g = T.lod[0];   // 細的（見上）；實例資料兩組同一個樣子，照那一組的緩衝讀
    gl.bindVertexArray(g.vao); gl.bindBuffer(gl.ARRAY_BUFFER, TREES.ib[l]); treeInstAttr(TREES.off[l * NL + c]);
    gl.drawElementsInstanced(gl.TRIANGLES, g.n, gl.UNSIGNED_SHORT, 0, k); n += k;
  });
  gl.bindVertexArray(null); return n;
}
/** 找樹（__game.trees(sp, n, [x, z])）：載進來的塊裡那一種最靠近 (x, z)（沒給 ⇒ 鏡頭）的 n 棵 ⇒ [[x, y, z, 轉角, 放大, 第幾棵], …]（截圖、對位置用）。 */
function treeFind(sp, n, at) {
  var si = Object.keys(TREE_SPECIES).indexOf(sp), q = at || [CAM.eye[0], CAM.eye[2]], L = [];
  Object.keys(TREES.ch).forEach(function (k) { var I = TREES.ch[k].I; for (var o = 0; o < I.length; o += 8) if (I[o + 6] === si) L.push([I[o], I[o + 1], I[o + 2], I[o + 3], I[o + 4], I[o + 7], (I[o] - q[0]) * (I[o] - q[0]) + (I[o + 2] - q[1]) * (I[o + 2] - q[1])]); });
  return L.sort(function (a, b) { return a[6] - b[6]; }).slice(0, n || 5).map(function (r) { return r.slice(0, 6).map(function (v) { return +v.toFixed(2); }); });
}
/** 讀數（__game.bed().trees）。 */
function treeStat() {
  var S = TREES.stat;
  return { on: TREES.on, kinds: Object.keys(TREE_SPECIES), variants: TREES.list.length, planted: S.plant, bySp: S.bySp, far: S.far, drawn: { full: S.d0, low: S.d1, card: S.d2, shells: S.shells || 0, shellTris: S.shellTris || 0 },
    ms: { gen: +S.genMs.toFixed(1), bake: +S.bakeMs.toFixed(1), plant: +S.plantMs.toFixed(1), bin: +S.binMs.toFixed(2) },
    tris: TREES.init ? Object.keys(TREE_SPECIES).reduce(function (o, sp, si) { var T = TREES.list[TREES.vi[si]]; o[sp] = [T.lod[0].n / 3, T.lod[1].n / 3]; return o; }, {}) : null };
}
