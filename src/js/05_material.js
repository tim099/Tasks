// ───────────────────────── 材質（TASK-0616；Tim 2026-10-15）─────────────────────────
// 材質表在設定檔（config/game.json materials；後台可以加、可以改）：{ default: ID, list: { ID: { name, kind, density, hard, flammable } } }，ID 英文小寫、跨船共用。
//   density ＝ 比重（一格 0.1 m ＝ 1 公升 ⇒ 每格幾 kg；橡木 0.7 ＝ 以前統一的 0.7 kg）；hard ＝ 硬度倍率（乘在船隻設定的船殼硬度上；橡木 1）；flammable ＝ 易燃性 0–1（著火：點不點得著、燒多久燒穿，49_burn.js；TASK-0717）。
// 每一格的材質：
//   · 全船預設 ＝ 設定檔那艘船的 material（沒寫 ⇒ materials.default）；
//   · 雕刻作品的關聯 meta material 蓋過它（巢狀照最近的那一層）⇒ .vxk 檔頭 materials（senate 匯出；照線性索引 x＋sx·(y＋sy·z) 的連續段落，見造船規格 §9.5）。
// 用在哪：打到的那一格的硬度（21_gunnery.js：洞多大、砲彈穿過去慢多少；一格一格算消耗）、重量（32_hull.js：浮多高、排水量）、殉爆斷船（23_powder.js：照全船預設）。
// ⛔ 沒有材質層、全船預設的比重是 0.7 的船（現在七艘全是）⇒ 走以前那一條（每格 VOX_T、硬度 × 1）—— 戰局逐位元組相同。
var MATS = (CFG.materials && CFG.materials.list) || { oak: { name: '橡木', kind: 'wood', density: 0.7, hard: 1, flammable: 0.5 } };
var MAT_DEF = CFG.materials && MATS[CFG.materials.default] ? CFG.materials.default : Object.keys(MATS)[0];
var MAT_REF = 0.7;                                                       // VOX_T（32_hull.js）是比重 0.7 的一格
// 混合材質（Tim 2026-10-21：「在材質上加額外的厚度乘數」「兩種材質可以線性混和」「混合可以跟空氣(也就是降低厚度)」「強度也會是混合後的結果」）：
//   ID 寫成 `iron*0.1`（一格裡 10% 是鐵、其他是空氣 ⇒ 1 cm 的鐵板）或 `iron*0.5+oak*0.5`（鐵板＋木襯）；成分照材質表、`air` ＝ 空氣（全 0），比例加起來 ≤ 1、沒寫滿的是空氣。
//   顯示名 ＝「鐵甲 50%＋橡木 50%」（括起來：船隻配置頁後面還接一個「佔全船幾成」的 %）。
//   比重、硬度、易燃、擊穿門檻 pen ＝ 各成分照比例相加（線性）；外觀（kind、metal、rough、smooth、clear）照**第一個成分** ⇒ 鐵寫在前面就照樣是光滑金屬。
//   寫在哪都行：雕刻關聯的 meta material、ships[].material、ships[].matMap（只換這一艘遊戲裡的材質，不動作品：hullMaterials）。材質表本身的 ID 不受影響 ⇒ 沒用到的船逐位元組相同。
var MAT_MIX = {}, MAT_AIR = { name: '空氣', kind: 'other', density: 0, hard: 0, flammable: 0 };
function matPart(s) { var m = /^([a-z][a-z0-9_]{0,31})(?:\*(\d*\.?\d+))?$/.exec(s); if (!m) return null; var f = m[2] === undefined ? 1 : +m[2], b = m[1] === 'air' ? MAT_AIR : MATS[m[1]]; return b && f > 0 && f <= 1 ? { m: b, f: f } : null; }
function matMix(id) {
  if (typeof id !== 'string' || (id.indexOf('*') < 0 && id.indexOf('+') < 0)) return null;
  if (MAT_MIX[id] !== undefined) return MAT_MIX[id];
  var P = id.split('+').map(matPart), sum = 0, r = null;
  if (P.every(Boolean) && P[0].m !== MAT_AIR) {
    P.forEach(function (p) { sum += p.f; });
    if (sum <= 1 + 1e-9) {
      var a = P[0].m, lin = function (k) { return P.reduce(function (t, p) { return t + p.f * (+p.m[k] || 0); }, 0); };
      r = Object.assign({}, a, { name: '「' + P.map(function (p) { return p.m.name + ' ' + +(p.f * 100).toFixed(1) + '%'; }).join('＋') + '」', density: +lin('density').toFixed(6), hard: +lin('hard').toFixed(6), flammable: +lin('flammable').toFixed(6), mix: id });
      var pen = lin('pen'); if (pen > 0) r.pen = +pen.toFixed(3); else delete r.pen;
    }
  }
  return (MAT_MIX[id] = r);
}
function matKnown(id) { return !!(MATS[id] || matMix(id)); }
/** 船型 T 的 matMap 換過之後的 ID（關聯 meta 寫的是作品裡的 ID ⇒ 跟格子的材質比之前先換；24_armor.js 裝甲的材質檢查）。 */
function matMapped(T, id) { var M = T.matMap; return M && Object.prototype.hasOwnProperty.call(M, id) ? M[id] : id; }
function matInfo(id) { return MATS[id] || matMix(id) || MATS[MAT_DEF]; }
/** 一格幾噸（材質參數 m）。比重 0.7 ⇒ 就是 VOX_T（⛔ 不重算：0.7 ÷ 0.7 × VOX_T 不一定剛好等於 VOX_T）。 */
function matVoxT(m) { return m.density === MAT_REF ? VOX_T : VOX_T * m.density / MAT_REF; }
/** 船型 T 的材質（載入時算一次，05_hull.js buildHull）：
 *  T.mat0 ＝ 全船預設的 ID；T.matIds[i] ＝ 索引 i 的材質 ID（0 ＝ 全船預設）；T.matG ＝ 每格的索引（VoxelKit 的稀疏網格；沒有材質層 ⇒ null）；
 *  T.matK[i] ＝ 硬度倍率、T.matT[i] ＝ 一格幾噸；T.matN[i] ＝ 原本幾格；T.matXYZ[i]（i ≥ 1）＝ 那幾格的座標（打掉多少照它數）；T.voxT0 ＝ 格子的總重（噸）；
 *  T.matBad ＝ 檔頭寫了、材質表沒有的 ID（照全船預設；匯入檢查報）。 */
function hullMaterials(T, info) {
  var h = T.h.materials, base = T.base, MM = info.matMap || {}, mp = function (id) { return Object.prototype.hasOwnProperty.call(MM, id) ? MM[id] : id; };   // matMap：這一艘遊戲裡換掉的材質（混合材質；作品不動）
  T.mat0 = info.material && matKnown(mp(info.material)) ? mp(info.material) : mp(MAT_DEF);
  if (!matKnown(T.mat0)) T.mat0 = MAT_DEF;
  T.matMap = info.matMap || null;
  T.matIds = [T.mat0]; T.matG = null; T.matBad = [];
  if (info.material && !matKnown(mp(info.material))) T.matBad.push(mp(info.material) + '（全船預設）');
  var n = 1 + (h && h.ids ? h.ids.length : 0), XYZ = [];
  T.matK = new Float64Array(n); T.matT = new Float64Array(n); T.matN = new Float64Array(n); T.matM = new Float32Array(n); T.matR = new Float32Array(n); T.matC = new Float32Array(n);   // matM／matR：金屬度、粗糙度（TASK-0627；平滑渲染照它反光）；matC：透明度（TASK-0753 玻璃）
  if (h && h.ids) h.ids.forEach(function (id) { id = mp(id); if (!matKnown(id)) T.matBad.push(id); T.matIds.push(id); });
  T.matIds.forEach(function (id, i) { var m = matInfo(id); T.matK[i] = m.hard; T.matT[i] = matVoxT(m); T.matM[i] = +m.metal || 0; T.matR[i] = isFinite(+m.rough) && m.rough !== undefined ? +m.rough : 0.5; T.matC[i] = clamp(+m.clear || 0, 0, 0.95); XYZ.push([]); });
  if (h && h.ids && h.runs && h.runs.length) {                            // 段落：[跟上一段結尾差幾、長度、索引]，一段 ＝ 線性索引相連的格（senate 匯出；⛔ 不跨空格 ⇒ 只走有格的地方）
    var G = new VK.Grid(T.h.size), sx = T.h.size[0], sy = T.h.size[1], at = 0, R = h.runs;
    for (var k = 0; k + 2 < R.length; k += 3) {
      var s = at + R[k], c = R[k + 1], m = R[k + 2], P = XYZ[m];
      var z = Math.floor(s / (sx * sy)), r = s - z * sx * sy, y = Math.floor(r / sx), x = r - y * sx;
      for (var j = 0; j < c; j++) {
        if (base.get(x, y, z)) { G.set(x, y, z, m); T.matN[m]++; P.push(x, y, z); }
        if (++x === sx) { x = 0; if (++y === sy) { y = 0; z++; } }
      }
      at = s + c;
    }
    T.matG = G;
  }
  T.matXYZ = XYZ.map(function (a) { return new Int16Array(a); });
  var rest = base.count; for (var i = 1; i < n; i++) rest -= T.matN[i];
  T.matN[0] = rest;
  T.matPlain = !T.matG && T.matT[0] === VOX_T;                            // 以前那一條（每格 VOX_T）
  T.voxT0 = T.matPlain ? base.count * VOX_T : 0;
  if (!T.matPlain) for (i = 0; i < n; i++) T.voxT0 += T.matN[i] * T.matT[i];
  if (T.matBad.length) console.warn('材質表沒有：' + T.matBad.join('、') + ' ⇒ 照全船預設 ' + T.mat0 + '（' + T.name + '）');
  // 平滑渲染（TASK-0616 第二段）：檔頭 render（關聯的 meta render，同一個段落格式）⇒ T.smG（smooth 那幾格 ＝ 1；VoxelKit 的方塊網格化跳過它們，15_smooth.js 另外畫成平滑面）
  //   金屬（Tim 2026-10-17：「把鍋爐 螺旋槳 以及其他金屬部件都改成光滑金屬質感」「形狀也做成平滑的（像維吉尼亞號砲廓那樣），再加金屬反光」）：
  //   材質表標 smooth: true 的（鐵甲、鍋爐；包銅皮不標：水線下那層薄殼不要變圓）⇒ 那幾格沒寫 render 也平滑；關聯明寫 render=voxel ⇒ 照方塊。
  //   ⛔ 只看非預設的材質層（關聯 meta material）：全船預設是金屬的船不會整艘變圓（現在沒有這種船）。
  var rh = T.h.render, si = rh && rh.ids ? rh.ids.indexOf('smooth') + 1 : 0, vi = rh && rh.ids ? rh.ids.indexOf('voxel') + 1 : 0;
  T.smG = null; T.smN = 0; T.smAuto = 0;
  var SG = new VK.Grid(T.h.size), VG = null;
  function runs(id, f) {                                                   // 檔頭 render 的段落裡、索引 ＝ id 的那幾格
    var sx2 = T.h.size[0], sy2 = T.h.size[1], at2 = 0, R2 = rh.runs;
    for (var k2 = 0; k2 + 2 < R2.length; k2 += 3) {
      var s2 = at2 + R2[k2], c2 = R2[k2 + 1];
      if (R2[k2 + 2] === id) {
        var z2 = Math.floor(s2 / (sx2 * sy2)), q2 = s2 - z2 * sx2 * sy2, y2 = Math.floor(q2 / sx2), x2 = q2 - y2 * sx2;
        for (var j2 = 0; j2 < c2; j2++) { if (base.get(x2, y2, z2)) f(x2, y2, z2); if (++x2 === sx2) { x2 = 0; if (++y2 === sy2) { y2 = 0; z2++; } } }
      }
      at2 = s2 + c2;
    }
  }
  if (si && rh.runs && rh.runs.length) runs(si, function (x, y, z) { SG.set(x, y, z, 1); T.smN++; });
  if (vi && rh.runs && rh.runs.length) { VG = new VK.Grid(T.h.size); runs(vi, function (x, y, z) { VG.set(x, y, z, 1); }); }
  for (var mi = 1; mi < T.matIds.length; mi++) {
    if (matInfo(T.matIds[mi]).smooth !== true) continue;
    var P = T.matXYZ[mi];
    for (var pk = 0; pk < P.length; pk += 3) { var px = P[pk], py = P[pk + 1], pz = P[pk + 2]; if (SG.get(px, py, pz) || (VG && VG.get(px, py, pz))) continue; SG.set(px, py, pz, 1); T.smN++; T.smAuto++; }
  }
  if (T.smN) { T.smG = SG; base.sm = SG; }
  // 透明（TASK-0753；Tim 2026-10-20「新增一種透明材質標記(玻璃)」）：材質表寫了 clear 的材質（玻璃 glass）那幾格 ⇒ T.glsG（旗標）＋ base.gl：
  //   VoxelKit 的方塊網格化不出它們的面、也不讓它們擋住旁邊格子的面；15_smooth.js glsBuild 另外畫成半透明的平面。平滑格（明寫 render=smooth）照平滑畫、不算透明。
  //   ⛔ 只看非預設的材質層（關聯 meta material）；沒有 ⇒ T.glsG ＝ null，跟以前一樣。
  T.glsG = null; T.glsXYZ = null; T.glsI = null; T.glsN = 0;
  var GG = null, GP = [], GI = [];
  for (var gi = 1; gi < T.matIds.length; gi++) {
    if (!(T.matC[gi] > 0)) continue;
    var Q = T.matXYZ[gi];
    for (var qk = 0; qk < Q.length; qk += 3) {
      var qx = Q[qk], qy = Q[qk + 1], qz = Q[qk + 2]; if (T.smG && T.smG.get(qx, qy, qz)) continue;
      if (!GG) GG = new VK.Grid(T.h.size);
      GG.set(qx, qy, qz, 1); GP.push(qx, qy, qz); GI.push(gi);
    }
  }
  if (GG) { T.glsG = GG; base.gl = GG; T.glsXYZ = new Int16Array(GP); T.glsI = new Uint8Array(GI); T.glsN = GI.length; }
}
/** 那一格的硬度倍率（打掉之後照樣查得到：材質層不跟著改）。 */
function matK(sh, x, y, z) { var T = sh.T, p = T.pmG && T.pmG.get(x, y, z); if (p) return T.pmI[p].hard; return T.matG ? T.matK[T.matG.get(x, y, z)] : T.matK[0]; }   // pmG：螺旋槳的格（24_armor.js propSetup；船殼沒有格的位置才有）
/** 那一格的材質參數（matInfo；砲帶的裝甲也照它：裝甲的格座標就是材質層的座標）。實心彈判擊穿用（21_gunnery.js impact：pen、kind）。 */
function matAt(sh, x, y, z) { var T = sh.T, p = T.pmG && T.pmG.get(x, y, z); if (p) return T.pmI[p]; return matInfo(T.matIds[T.matG ? T.matG.get(x, y, z) : 0]); }
/** 船殼硬度的基準（Tim 2026-10-16：船隻設定的硬度改成倍率、1 ＝ 只看材質；以前的預設 3 搬到這裡 ⇒ 倍率 1 的船跟以前預設硬度的船一樣）。 */
var HARD_BASE = 3;
/** 打到 L（格座標）的硬度 ＝ 基準 × 船隻設定的硬度倍率（預設 1）× 那一格的材質倍率。 */
function hardAt(sh, L) { return HARD_BASE * sh.cfg.hard * matK(sh, L[0] | 0, L[1] | 0, L[2] | 0); }
/** 全船預設材質的硬度（殉爆斷船這種整艘的判斷）。 */
function hard0(sh) { return HARD_BASE * sh.cfg.hard * sh.T.matK[0]; }
/** 格子少掉的重量（噸）：以前那一條 ＝ 少幾格 × VOX_T；有材質 ⇒ 每種材質還剩幾格（非預設的照座標數，格子只會少、不會多 ⇒ 只在格數變了才重數）。
 *  砲帶的裝甲（24_armor.js）也是船上的格：還剩幾格 ＝ 船殼＋裝甲（裝甲的格座標就是材質層的座標）；sh.orig 只算船殼 ⇒ 原本幾格 ＝ sh.orig ＋ sh.armN0。沒有裝甲 ⇒ 跟以前同一條算式。 */
//   重數只數變過的塊（TASK-0673：鐵甲艦一次全數約 20 ms，每次被打中之後的 survey 都要）：非預設材質的格照船殼網格的塊（16³）分組（matChunks，每型一次），
//   每一組記上次數到幾格、那一塊的版本（VoxelKit Grid.cv）；版本沒變 ⇒ 沿用。裝甲（砲塔的格）有任何一份改過 ⇒ 全部重數（跟以前一樣）。數出來的整數跟全數相同 ⇒ 重量一位元不差。
function voxLostT(sh) {
  var T = sh.T, n = sh.arm ? sh.grid.count + armCount(sh) : sh.grid.count, n0 = sh.arm ? sh.orig + sh.armN0 : sh.orig;
  if (T.matPlain) return (n0 - n) * VOX_T;
  if (sh.matLostAt === n) return sh.matLost;
  var G = sh.grid, L = matChunks(T, G), A = sh.matA, as = sh.arm ? sh.arm.map(function (a) { return a.grid.ver; }).join(',') : '', all = !A || A.g !== G || A.as !== as || A.arm !== sh.arm;   // 換了一份網格（斷成兩截之類）⇒ 版本號不能比 ⇒ 全數
  if (!A) A = sh.matA = { a: new Int32Array(L.length), v: new Uint32Array(L.length), as: '', arm: null, g: null };
  for (var g = 0; g < L.length; g++) {
    var q = L[g]; if (!all && G.cv[q.k] === A.v[g]) continue;
    var P = q.P, a = 0;
    for (var k = 0; k < P.length; k += 3) if (G.get(P[k], P[k + 1], P[k + 2]) || (sh.arm && armGet(sh, P[k], P[k + 1], P[k + 2]))) a++;
    A.a[g] = a; A.v[g] = G.cv[q.k];
  }
  A.as = as; A.arm = sh.arm; A.g = G;
  var per = new Float64Array(T.matIds.length); for (g = 0; g < L.length; g++) per[L[g].i] += A.a[g];
  var t = 0, alive = 0;
  for (var i = 1; i < T.matIds.length; i++) {
    t += (T.matN[i] - per[i]) * T.matT[i]; alive += per[i];
  }
  t += (T.matN[0] + (n0 - T.base.count) - (n - alive)) * T.matT[0];   // 預設材質：原本幾格 − 還剩（全部還剩 − 非預設還剩）；n0 ≠ 船型的格數（不該發生）⇒ 差額算在預設材質
  sh.matLostAt = n; sh.matLost = t;
  return t;
}
/** 非預設材質的格照網格 G 的塊分組（同型的船共用；G 只拿它的塊數 nx、ny）⇒ [{ i: 材質索引, k: 塊號, P: 格座標 }]。 */
function matChunks(T, G) {
  if (T.matCh) return T.matCh;
  var L = [];
  for (var i = 1; i < T.matIds.length; i++) {
    var P = T.matXYZ[i], by = new Map();
    for (var k = 0; k < P.length; k += 3) { var c = (P[k] >> 4) + G.nx * ((P[k + 1] >> 4) + G.ny * (P[k + 2] >> 4)), a = by.get(c); if (!a) by.set(c, a = []); a.push(P[k], P[k + 1], P[k + 2]); }
    by.forEach(function (a, c) { L.push({ i: i, k: c, P: new Int16Array(a) }); });
  }
  return (T.matCh = L);
}
/** 讀數（匯入檢查、主控台）：每種材質幾格、幾噸。 */
function matSummary(T) {
  return T.matIds.map(function (id, i) { var m = matInfo(id); return { id: id, name: m.name, voxels: T.matN[i], t: +(T.matN[i] * T.matT[i]).toFixed(1), hard: T.matK[i], density: m.density, flammable: m.flammable, def: i === 0 }; });
}
