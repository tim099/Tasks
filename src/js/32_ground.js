// ───────────────────────── 擱淺（TASK-0721） ─────────────────────────
// 有海圖（?map，08_seabed.js BED）才有；沒有 ⇒ 每一支第一行就回去（戰局逐位元組不變）。⛔ 不抽 rnd()。
// 船底：龍骨線上 7 點（船型的水線前後端往內 15 格之間；每一點是那一欄中線附近最低的實心格 ⇒ 船頭船尾翹起來的照實際）。
// 每一步（50_sim.js，碰撞之後）：每一點的海底比它高多少（pen）——
//   · 碰到 ⇒ 航速每秒扣 (0.5 ＋ 2.5 × pen)，往高處開再多扣一倍（往深處退出來比較容易）；壓進去超過 1.2 m ⇒ 沿坡往低處推（不會整艘開上岸）。
//   · 剛碰上、或還在動（> 0.8 m/s）每一秒 ⇒ 船底那一點附近打掉 硬度 × 速度² × 1.5 格（最多 40 格；船殼破了照常進水）：
//     珊瑚礁 1、礁石／岩壁 1.5、陸地 0.6、沙灘 0.4、沙底／沙洲 0.25 ⇒ 撞礁比擱在沙上重得多。
//   · 撞破船殼（Tim 2026-10-19：「可以嘗試真的讓船殼撞破嗎 然後順序跟漏水調換(先撞破 才進水)」；groundPunch）：硬的底（珊瑚礁、礁石、岩壁：硬度 ≥ GRD_PUNCH_H）
//     而且撞上的速度 ≥ GRD_PUNCH_V ⇒ 撞點前後那一段船底的船板被撞穿：每一欄（x、z）從船殼最外那一格往裡走，走 GRD_PUNCH_T 格以內通到艙內（原本是空的）⇒ 那幾格打掉，
//     通不到（龍骨那種實心的）⇒ 那一欄不動。打掉幾格 ＝ 硬度 × 速度² × GRD_PUNCH_K（最多 GRD_PUNCH_MAX），照離撞點近的先（沿船身拉長的一道口子）、兩舷輪流。
//     ⇒ 破口跟砲彈打出來的一樣是真的通進艙內：公式模式照水線下的破洞進水、粒子模式從破口灌水（33_flood.js flHoleRedo 照同一條「最外那一格往裡通」量）。
//     ⛔ 以前只有上面那一條（撞點半徑 6 格、最多 40 格）：打到的是龍骨那團實心木頭，沒通進艙內 ⇒ 粒子模式一滴水都沒進來，公式模式那 40 個「洞」抽水機抽得贏 ⇒ 撞礁之後船一點都沒下沉（2026-10-19 宣傳片量）。
//   · 讀數：sh.grnd ＝ { t 最後一次撞的時刻, m 底質, pen 壓進去多深, lost 打掉幾格, punch 撞穿幾格 }（離開海底 ⇒ null，lost 留在 sh.grndLost、punch 留在 sh.grndPunch）。
var GRD_HARD = { 0: 0.3, 1: 0.25, 2: 1.0, 3: 0.25, 4: 1.5, 10: 0.4, 11: 0.6, 12: 1.5 };
var GRD_OFF = null;                                                      // 撞點附近的格（照離撞點的距離排；半徑 6 格）
var GRD_PUNCH_H = 1, GRD_PUNCH_V = 1.5, GRD_PUNCH_K = 12, GRD_PUNCH_MAX = 900, GRD_PUNCH_T = 12, GRD_COL = null;   // 硬度、m/s、格／(m/s)²、格、船板最厚幾格；GRD_COL：撞點前後的欄（照離撞點遠近排）
function groundKeel(T) {
  if (T.keel) return T.keel;
  var G = T.base, out = [];
  for (var k = 0; k < 7; k++) {
    var x = Math.round(T.wl0 + 15 + (T.wl1 - T.wl0 - 30) * k / 6), z = T.zw;
    for (var zz = 0; zz < T.zw; zz++) { var hit = false; for (var y = Math.round(T.cy) - 3; y <= Math.round(T.cy) + 3 && !hit; y++) if (G.get(x, y, zz)) hit = true; if (hit) { z = zz; break; } }
    out.push([x, z]);
  }
  return (T.keel = out);
}
function groundStep(sh, dt) {                                           // dt：這一次代表幾秒（TASK-0797：船的移動切小步時一小步判一次；沒給 ＝ DT）
  if (!BED || sh.sunk) return;
  dt = dt || DT;
  var K = groundKeel(sh.T), best = 0, bp = null, low = Infinity;
  for (var k = 0; k < K.length; k++) {
    var p = M4.pt(sh.M, K[k][0], sh.T.cy, K[k][1]), pen = bedHgt(p[0], p[2]) - p[1];
    if (p[1] < low) low = p[1];
    if (pen > best) { best = pen; bp = p; }
  }
  sh.keelY = low;                                                        // 船底最低點（世界 y）：54_helm.js bedAvoid 照它算吃水
  if (!bp) { if (sh.grnd) sh.grnd = null; return; }
  var m = bedMat(bp[0], bp[2]), hard = GRD_HARD[m] !== undefined ? GRD_HARD[m] : 0.5, g = bedGrad(bp[0], bp[2]), gl = Math.hypot(g[0], g[1]);
  var F = fwd(sh.yaw), dir = sh.spd < 0 ? -1 : 1, up = gl > 1e-6 ? dir * (F[0] * g[0] + F[2] * g[1]) / gl : 0, v0 = Math.abs(sh.spd);
  sh.spd *= Math.max(0, 1 - dt * (0.5 + 2.5 * best) * (1 + Math.max(0, up)));
  if (best > 1.2 && gl > 1e-6) { var push = Math.min(0.5, (best - 1.2) * 0.25); sh.px -= g[0] / gl * push; sh.pz -= g[1] / gl * push; }
  if (!sh.grnd) {
    sh.grnd = { t: SIMT, m: m, pen: best, lost: 0 };
    note(sh, (m === BED_MAT.REEF ? '撞上珊瑚礁' : m === BED_MAT.ROCK || m === BED_MAT.CLIFF ? '撞上礁石' : m >= BED_MAT.BEACH ? '衝上岸' : '擱淺') + '（' + v0.toFixed(1) + ' m/s）', true);
    groundHit(sh, bp, v0, hard); groundPunch(sh, bp, v0, hard);
  } else if (v0 > 0.8 && SIMT - sh.grnd.t >= 1) { sh.grnd.t = SIMT; groundHit(sh, bp, v0, hard); groundPunch(sh, bp, v0, hard); }
  sh.grnd.pen = best; sh.grnd.m = m;
}
function groundHit(sh, p, v, hard) {
  var want = Math.min(40, Math.round(hard * v * v * 1.5)); if (want <= 0) return;
  if (!GRD_OFF) {
    GRD_OFF = [];
    for (var dz = 0; dz <= 6; dz++) for (var dy = -6; dy <= 6; dy++) for (var dx = -6; dx <= 6; dx++) if (dx * dx + dy * dy + dz * dz <= 36) GRD_OFF.push([dx, dy, dz, dx * dx + dy * dy + dz * dz]);
    GRD_OFF.sort(function (a, b) { return a[3] - b[3] || a[2] - b[2] || a[1] - b[1] || a[0] - b[0]; });
  }
  var L = M4.pt(sh.inv, p[0], p[1], p[2]), x0 = Math.round(L[0]), y0 = Math.round(L[1]), z0 = Math.round(L[2]), got = 0;
  for (var i = 0; i < GRD_OFF.length && got < want; i++) {
    var o = GRD_OFF[i], x = x0 + o[0], y = y0 + o[1], z = z0 + o[2];
    if (sh.grid.get(x, y, z) > 0 && removeVoxel(sh, x, y, z, true)) got++;
  }
  sh.grnd.lost += got; sh.grndLost = (sh.grndLost || 0) + got;
  if (got) { smoke(p, [0, 0.4, 0], 2, false); sfx('crack', p, 1.2); }
}
/** 撞破船殼（上面的說明）：撞點 p（世界）、速度 v、底質硬度 hard。回傳撞穿幾格。 */
function groundPunch(sh, p, v, hard) {
  if (hard < GRD_PUNCH_H || v < GRD_PUNCH_V) return 0;
  var want = Math.min(GRD_PUNCH_MAX, Math.round(hard * v * v * GRD_PUNCH_K)); if (want <= 0) return 0;
  if (!GRD_COL) {                                                        // 沿船身前後 40 格、往上 14 格；離撞點的「距離」＝ |dx| ＋ 2·dz（口子沿船身拉長）
    GRD_COL = [];
    for (var dz = -2; dz <= 14; dz++) for (var dx = -40; dx <= 40; dx++) GRD_COL.push([dx, dz, Math.abs(dx) + 2 * Math.abs(dz)]);
    GRD_COL.sort(function (a, b) { return a[2] - b[2] || a[1] - b[1] || a[0] - b[0]; });
  }
  var T = sh.T, g = sh.grid, L = M4.pt(sh.inv, p[0], p[1], p[2]), x0 = Math.round(L[0]), z0 = Math.round(L[2]), cy = Math.round(T.cy), got = 0;
  for (var i = 0; i < GRD_COL.length && got < want; i++) {
    var x = x0 + GRD_COL[i][0], z = z0 + GRD_COL[i][1];
    if (x < 0 || x >= g.sx || z < 0 || z >= T.zw) continue;              // 只撞水線以下
    for (var sd = 0; sd < 2 && got < want; sd++) {                       // 兩舷輪流（右舷先 ⇒ 每次一樣）
      var dy = sd ? 1 : -1, y = sd ? 0 : g.sy - 1;
      while (y !== cy && !g.get(x, y, z)) y += dy;                       // 從外面找到最外那一格
      if (y === cy) continue;
      var y1 = y, n = 0;
      while (y1 !== cy && g.get(x, y1, z) && n <= GRD_PUNCH_T) { y1 += dy; n++; }
      if (y1 === cy || n > GRD_PUNCH_T || g.get(x, y1, z)) continue;     // 通不到艙內（實心的龍骨、太厚）⇒ 這一欄不動
      for (var k = 0; k < n; k++, y += dy) if (removeVoxel(sh, x, y, z, true)) got++;
    }
  }
  if (sh.grnd) sh.grnd.punch = (sh.grnd.punch || 0) + got;
  sh.grndPunch = (sh.grndPunch || 0) + got;
  if (got) { note(sh, '船底被撞破了（' + got + ' 格）', true); smoke(p, [0, 0.6, 0], 3, false); sfx('crack', p, 1.6); }
  return got;
}
