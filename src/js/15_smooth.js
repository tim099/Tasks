// ───────────────────────── 平滑渲染（TASK-0616 第二段；Tim 2026-10-15：鐵甲艦光滑的裝甲）─────────────────────────
// 哪幾格：雕刻作品關聯的 meta render=smooth（巢狀照最近一層）⇒ .vxk 檔頭 render ⇒ T.smG（05_material.js）；材質表標 smooth 的金屬（鐵甲、鍋爐）沒寫 render 也算（Tim 2026-10-17）。
//   會轉的體素件（螺旋槳，24_armor.js propSetup）：自己那份格子整份平滑（smBuild 的 o：SG ＝ 它自己、金屬度照它的材質）。
// 怎麼畫：
//   · VoxelKit 的方塊網格化跳過這幾格自己的面（grid.sm），但它們照樣擋住旁邊格子的面 ⇒ 一般格貼著平滑格的那一面不畫。
//   · 平滑面 ＝ surface nets：每一個「平滑格貼著空氣」的面換成四個頂點（那一面的四個格角），格角的位置往表面拉：
//       ① 那個格角周圍 8 格裡、有格與沒格的邊的中點平均（naive surface nets；落在格角 ±0.5 的小方塊裡）；
//       ② 再跟周圍 3×3×3 的格角（同一面的：實心的方向跟自己同側）平均一次 ⇒ 36° 的斜甲板不會一階一階；最後夾回格角 ±0.5。
//     周圍 8 格有一般格（不是平滑的實心）⇒ 頂點釘在格角上 ⇒ 跟方塊的角對齊、不露縫。
//     ①② 只看附近的格子 ⇒ 兩個區算到同一個格角，位置一定一樣（區的交界不裂）；法線也照附近的格子算（交界不斷光）。
//   · 一區 64³ 格一份網格（三角形＋索引，P.tri／P.dtri 畫，跟砲這些模型同一支著色器：陰影、剖面、點光源、水下的色都有）。
//     船型載入時建一份（船原本的樣子），開戰時每艘共用；被打掉格 ⇒ 附近 ±2 格碰得到的區各自重建（每一格畫面最多 SM_FRAME 區；快轉一次做完）。
// ⛔ 只改畫面：打中、進水、重量照舊看格子。斷開漂走的那一團照方塊畫（它的網格是新建的，沒有 sm）。
var SM_R = 64, SM_FRAME = 3;
var SM_C8 = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
var SM_E12 = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
var SM_UAX = [1, 2, 0], SM_VAX = [2, 0, 1];
function smRk(T, x, y, z) { var nx = Math.ceil(T.h.size[0] / SM_R), ny = Math.ceil(T.h.size[1] / SM_R); return (x >> 6) + nx * ((y >> 6) + ny * (z >> 6)); }
/** 船型 T：有平滑格 ⇒ 每個有平滑格的區建一份網格（T.smP：區 ⇒ 網格），T.smRK ＝ 那幾個區。 */
function smoothSetup(T) {
  T.smP = null; T.smRK = null; if (!T.smG) return;
  var RK = T.smRK = smRegions(T, T.smG), t0 = performance.now();
  T.smP = new Map();
  RK.forEach(function (rk) { var m = smBuild(T, T.hullG || T.base, rk, null, undefined, undefined, true); if (m) T.smP.set(rk, m); });   // T.hullG：船殼（砲帶的裝甲另外建，24_armor.js armorMesh）
  smArena(T.smP);
  T.ms.smooth = +(performance.now() - t0).toFixed(1);
}
// ── 船型那一份的合併緩衝（render 管線大修 S10；同 S8 船殼，60_rbatch.js rbatArena）──
// T.smP、A.smP、P.smP（船型的平滑面，一區一份 VB／IB／VAO）建完 ⇒ 照 Map 的順序接成一份：頂點照抄、索引加上前面的頂點數（整數，不差）、每區記 io（從第幾個 byte 起）。
//   開戰的每艘 smShare 借用（連 io）；被打到的區 smFlush 換成自己建的（io 0、own）⇒ 畫的時候（60_rbatch.js rbatSmAdd）同一個 VAO、io 接得上的幾區併成一個 drawElements。
//   一區一份的緩衝建完就刪（記憶體不變）；SM_AR：合併緩衝的 VAO ⇒ { vao, vb, ib, verts }（__rbatProbe 照整份的頂點數比）。
// ⛔ 船型那一份只在這裡建、不會被 smFlush 重建、smFree 只收自己建的區（15_smooth.js smFlush、62_simview.js armDispose）。?rbarena=0（或 ?rb=0）⇒ 不合，照以前一區一份。
var SM_AR = new Map();
function smArena(P) {
  if (!P || !P.size) return;
  var nv = 0, ni = 0, ok = RBAT_ARENA;
  P.forEach(function (m) { if (!m.cpu) ok = false; else { nv += m.cpu.buf.length / 11; ni += m.cpu.idx.length; } });
  if (!ok) { P.forEach(function (m) { m.cpu = null; }); return; }
  var B = new Float32Array(nv * 11), I = new Uint32Array(ni), v0 = 0, i0 = 0;
  P.forEach(function (m) {
    var c = m.cpu, x = c.idx, k;
    B.set(c.buf, v0 * 11); for (k = 0; k < x.length; k++) I[i0 + k] = x[k] + v0;
    m.io = i0 * 4; v0 += c.buf.length / 11; i0 += x.length; m.cpu = null;
  });
  var A = { vao: gl.createVertexArray(), vb: gl.createBuffer(), ib: gl.createBuffer(), verts: nv };
  gl.bindVertexArray(A.vao); gl.bindBuffer(gl.ARRAY_BUFFER, A.vb); gl.bufferData(gl.ARRAY_BUFFER, B, gl.STATIC_DRAW);   // 格式照 smBuild
  [[0, 0, 3], [1, 3, 3], [2, 6, 3], [3, 9, 2]].forEach(function (a) { gl.enableVertexAttribArray(a[0]); gl.vertexAttribPointer(a[0], a[2], gl.FLOAT, false, 44, a[1] * 4); });
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, A.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, I, gl.STATIC_DRAW); gl.bindVertexArray(null);
  P.forEach(function (m) { smFree(m); m.vao = A.vao; m.vb = A.vb; m.ib = A.ib; m.sa = A; });
  SM_AR.set(A.vao, A); (RBAT.gl.sm || (RBAT.gl.sm = [])).push(A);
}
/** G 有格的那幾區（16³ 的塊 ⇒ 64³ 的區）。 */
function smRegions(T, G) {
  var RK = new Set();
  for (var cz = 0; cz < G.nz; cz++) for (var cy = 0; cy < G.ny; cy++) for (var cx = 0; cx < G.nx; cx++) if (G.tab[G.ci(cx, cy, cz)]) RK.add(smRk(T, cx * 16, cy * 16, cz * 16));
  return RK;
}
/** 一艘船開戰：共用船型那一份（被打到的區才各自重建）。 */
function smoothShip(sh) { smShare(sh, sh.T.smP); }
/** o（船，或砲帶的裝甲 24_armor.js）共用 P 那幾區的網格（P ＝ null ⇒ 沒有平滑面）。 */
function smShare(o, P) {
  o.smR = null; o.smD = null; if (!P) return;
  o.smR = new Map(); o.smD = new Set();
  P.forEach(function (m, rk) { o.smR.set(rk, { vao: m.vao, vb: m.vb, ib: m.ib, n: m.n, own: false, io: m.io || 0, sa: m.sa || null, verts: m.verts }); });   // io、sa：船型那一份的合併緩衝（smArena）
}
/** 打掉 (x, y, z)：±2 格碰得到的、有平滑格的區排進重建。 */
function smTouch(sh, x, y, z) {
  var T = sh.T, RK = sh.smRK || T.smRK; if (!sh.smD) return;   // smRK：螺旋槳自己那幾區（24_armor.js propShip）
  for (var dz = -2; dz <= 2; dz += 4) for (var dy = -2; dy <= 2; dy += 4) for (var dx = -2; dx <= 2; dx += 4) {
    var rk = smRk(T, Math.max(0, x + dx), Math.max(0, y + dy), Math.max(0, z + dz)); if (RK.has(rk)) sh.smD.add(rk);
  }
}
/** 重建最多 n 區（回：做了幾區）。 */
function smFlush(sh, n) {
  if (!sh.smD || !sh.smD.size) return 0;
  var done = 0, list = [];
  sh.smD.forEach(function (rk) { if (done++ < n) list.push(rk); });
  list.forEach(function (rk) {
    sh.smD.delete(rk);
    var old = sh.smR.get(rk), m = smBuild(sh.T, sh.grid, rk, old && old.own ? old : null, sh.pin, sh.smO);   // pin：裝甲貼著的船殼（24_armor.js；船沒有）；smO：螺旋槳的選項
    if (m) sh.smR.set(rk, m); else { if (old && old.own) smFree(old); sh.smR.delete(rk); }
  });
  return list.length;
}
function smFree(m) { gl.deleteBuffer(m.vb); gl.deleteBuffer(m.ib); gl.deleteVertexArray(m.vao); }
// 畫：模型那一段的表（60_rbatch.js rbatPrep 收 sh.smR／a.smR 的每一區、rbatReplay 畫：一份網格開頭設 uModel（船 sh.M；砲帶的裝甲 armM(a)）＋uGlow 0，每區一個 drawElements）。
/** 一區的網格（g ＝ 現在的格子；reuse ＝ 這艘自己的舊緩衝，有就覆寫）⇒ { vao, vb, ib, n, own } 或 null（這一區沒有平滑面）。
 *  pg（砲帶的裝甲，24_armor.js）：只用來釘格角的另一份格子（拆出來之前貼著的船殼）—— 碰到它的格角只釘高度（z：貼著甲板、不往上縮），水平照樣平滑；它自己不出面、不算實心。
 *  ⛔ 三個方向都釘 ⇒ 圓筒底那一圈是轉 0° 時的格角階梯 ⇒ 砲塔一轉，階梯跟著轉、跟甲板上的座圈對不上，一圈鋸齒（Tim 2026-10-16：「旋轉砲塔旋轉後 會導致底下甲板出現破圖」）。
 *  o（螺旋槳）：{ SG：哪幾格算平滑（不給 ＝ T.smG）, mm, mr：整份一樣的金屬度、粗糙度（不看材質層）}。 */
function smBuild(T, g, rk, reuse, pg, o, keep) {                     // keep：留著 CPU 的頂點與索引（m.cpu；船型那一份，smArena 接完就丟）
  var SG = (o && o.SG) || T.smG, nx = Math.ceil(T.h.size[0] / SM_R), ny = Math.ceil(T.h.size[1] / SM_R);
  var rx = rk % nx, ry = Math.floor(rk / nx) % ny, rz = Math.floor(rk / (nx * ny)), x0 = rx * SM_R, y0 = ry * SM_R, z0 = rz * SM_R;
  var SX = T.h.size[0] + 2, SXY = SX * (T.h.size[1] + 2);
  function key(X, Y, Z) { return X + SX * Y + SXY * Z; }
  var info = new Map();                                                  // 格角 ⇒ { o: 偏移, g: 實心的方向, pin, srf }
  function corner(X, Y, Z) {
    var k = key(X, Y, Z), r = info.get(k); if (r) return r;
    var occ = [], pin = false, pz = false, gx = 0, gy = 0, gz = 0, n = 0, i;
    for (i = 0; i < 8; i++) {
      var c = SM_C8[i], vx = X - 1 + c[0], vy = Y - 1 + c[1], vz = Z - 1 + c[2], s = g.get(vx, vy, vz) ? 1 : 0;
      occ.push(s); if (s) { if (!SG.get(vx, vy, vz)) pin = true; gx += c[0] - 0.5; gy += c[1] - 0.5; gz += c[2] - 0.5; n++; } else if (pg && pg.get(vx, vy, vz)) pz = true;
    }
    var ox = 0, oy = 0, oz = 0, ne = 0;
    for (i = 0; i < 12; i++) {
      var a = SM_E12[i][0], b = SM_E12[i][1]; if (occ[a] === occ[b]) continue;
      var A = SM_C8[a], B = SM_C8[b]; ox += (A[0] + B[0]) / 2 - 0.5; oy += (A[1] + B[1]) / 2 - 0.5; oz += (A[2] + B[2]) / 2 - 0.5; ne++;
    }
    r = { srf: n > 0 && n < 8, pin: pin, pz: !pin && pz, o: ne ? [ox / ne, oy / ne, oz / ne] : [0, 0, 0], g: [gx, gy, gz] };   // pz：只釘高度（碰到 pg 的格角）
    info.set(k, r); return r;
  }
  var vidx = new Map(), V = [], F = [], MG = o ? null : T.matG, MM = o ? null : T.matM, MR = o ? null : T.matR;   // V：每個頂點 [X, Y, Z, r, g, b, 面數, 金屬度, 粗糙度]；F：每個面 4 個頂點編號
  function vert(X, Y, Z, col, mi) {
    var k = key(X, Y, Z), i = vidx.get(k);
    if (i === undefined) { i = V.length; vidx.set(k, i); V.push([X, Y, Z, 0, 0, 0, 0, 0, 0]); }
    var v = V[i]; v[3] += ((col >> 5) & 7) / 7; v[4] += ((col >> 2) & 7) / 7; v[5] += (col & 3) / 3; v[6]++;
    if (MM) { v[7] += MM[mi]; v[8] += MR[mi]; } else if (o) { v[7] += o.mm; v[8] += o.mr; }
    return i;
  }
  var CORN = [[0, 0], [1, 0], [1, 1], [0, 1]], P = [0, 0, 0];
  for (var cz = z0 >> 4; cz < Math.min(SG.nz, (z0 + SM_R) >> 4); cz++) for (var cy = y0 >> 4; cy < Math.min(SG.ny, (y0 + SM_R) >> 4); cy++) for (var cx = x0 >> 4; cx < Math.min(SG.nx, (x0 + SM_R) >> 4); cx++) {
    var ch = SG.tab[SG.ci(cx, cy, cz)]; if (!ch) continue;
    for (var li = 0; li < 4096; li++) {
      if (!ch[li]) continue;
      var x = cx * 16 + (li & 15), y = cy * 16 + ((li >> 4) & 15), z = cz * 16 + (li >> 8), col = g.get(x, y, z); if (!col) continue;
      var mi = MG ? MG.get(x, y, z) : 0;                                  // 這一格的材質（05_material.js；沒寫 ⇒ 0 ＝ 全船預設）
      for (var ax = 0; ax < 3; ax++) for (var sg = -1; sg <= 1; sg += 2) {
        P[0] = x; P[1] = y; P[2] = z; P[ax] += sg;
        if (g.get(P[0], P[1], P[2])) continue;                            // 旁邊有格 ⇒ 不是表面
        var ua = SM_UAX[ax], va = SM_VAX[ax], q = [];
        for (var e = 0; e < 4; e++) {
          var cc = CORN[sg > 0 ? e : 3 - e], L = [x, y, z];
          L[ax] += sg > 0 ? 1 : 0; L[ua] += cc[0]; L[va] += cc[1];
          q.push(vert(L[0], L[1], L[2], col, mi));
        }
        F.push(q);
      }
    }
  }
  if (!F.length) { if (reuse) smFree(reuse); return null; }
  // 頂點位置與法線：① 自己的偏移 ② 周圍同一面的格角平均 ⇒ 夾回格角 ±0.5；釘住的 ＝ 格角本身
  var buf = new Float32Array(V.length * 11);
  for (var i = 0; i < V.length; i++) {
    var v = V[i], X = v[0], Y = v[1], Z = v[2], me = corner(X, Y, Z), px = X, py = Y, pz = Z, nxv = 0, nyv = 0, nzv = 0;
    var sx = 0, sy = 0, sz = 0, sn = 0;
    for (var dz = -1; dz <= 1; dz++) for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      var o = corner(X + dx, Y + dy, Z + dz); if (!o.srf) continue;
      if (o.g[0] * me.g[0] + o.g[1] * me.g[1] + o.g[2] * me.g[2] <= 0) continue;   // 另一面（薄板的背面）⇒ 不混
      nxv -= o.g[0]; nyv -= o.g[1]; nzv -= o.g[2];
      if (o.pin) { sx += dx; sy += dy; sz += dz; } else { sx += dx + o.o[0]; sy += dy + o.o[1]; sz += dz + (o.pz ? 0 : o.o[2]); }
      sn++;
    }
    if (!me.pin && sn) {
      var f = 0.5;
      px = X + clamp((1 - f) * me.o[0] + f * sx / sn, -0.5, 0.5); py = Y + clamp((1 - f) * me.o[1] + f * sy / sn, -0.5, 0.5); pz = me.pz ? Z : Z + clamp((1 - f) * me.o[2] + f * sz / sn, -0.5, 0.5);
    }
    var nl = Math.hypot(nxv, nyv, nzv) || 1;
    buf.set([px, py, pz, nxv / nl, nyv / nl, nzv / nl, v[3] / v[6], v[4] / v[6], v[5] / v[6], v[7] / v[6], v[6] && (MM || o) ? v[8] / v[6] : 0.5], i * 11);
  }
  var idx = new Uint32Array(F.length * 6);
  for (var j = 0; j < F.length; j++) { var Q = F[j]; idx.set([Q[0], Q[1], Q[2], Q[0], Q[2], Q[3]], j * 6); }
  var m = reuse || { vao: gl.createVertexArray(), vb: gl.createBuffer(), ib: gl.createBuffer(), n: 0, own: true };
  if (!reuse) {
    gl.bindVertexArray(m.vao); gl.bindBuffer(gl.ARRAY_BUFFER, m.vb);
    [[0, 0, 3], [1, 3, 3], [2, 6, 3], [3, 9, 2]].forEach(function (a) { gl.enableVertexAttribArray(a[0]); gl.vertexAttribPointer(a[0], a[2], gl.FLOAT, false, 44, a[1] * 4); });   // 3：金屬度、粗糙度（P.tri 的 aM；TASK-0627）
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib); gl.bindVertexArray(null);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, m.vb); gl.bufferData(gl.ARRAY_BUFFER, buf, gl.DYNAMIC_DRAW);
  gl.bindVertexArray(m.vao); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.DYNAMIC_DRAW); gl.bindVertexArray(null);
  m.n = idx.length; m.own = true; m.verts = V.length; m.faces = F.length;
  if (keep) m.cpu = { buf: buf, idx: idx };
  return m;
}

// ───────────────────────── 透明格：玻璃（TASK-0753；Tim 2026-10-20：「參考金屬 新增一種透明材質標記(玻璃) 跟金屬一樣套用光滑表面」）─────────────────────────
// 哪幾格：材質表寫了 clear（透明度 0–0.95）的材質（玻璃 glass）⇒ T.glsG（旗標）、T.glsXYZ（座標）、T.glsI（材質索引；05_material.js）。
//   VoxelKit 的方塊網格化不出它們的面、也不讓它們擋住旁邊格子的面（grid.gl）⇒ 窗後面的船艙、窗框照常畫出來，從玻璃看得進去。
// 怎麼畫：玻璃格貼著空氣的每一面一個平面（不做 surface nets：窗玻璃 1 格厚，平均會把兩面黏在一起）；玻璃格之間、貼著實心格的面不畫。
//   頂點 12 個 float ＝ 位置、法線、顏色、[金屬度, 粗糙度, 透明度]（平滑面多一個透明度）⇒ P.tri 同一支著色器：反光照平滑面那一段的天空／海平線與太陽高光（菲涅耳），
//   uGls 開著才照透明度出 alpha（01_gl.js）。畫在不透明的東西、海、艙內的水都畫完之後（60_render.js glsDraw）：混色、不寫深度、陰影圖不畫（光照得進艙裡）。
//   一艘一份網格（窗只有幾千格）：打掉、換色 ±1 格碰到玻璃 ⇒ 下一格整份重建。斷開漂走的那一團照方塊畫（它的網格是新建的，沒有 gl）。
// ⛔ 只改畫面：打中、進水、重量照舊看格子（玻璃的比重、硬度在材質表）。沒有玻璃的船 ⇒ T.glsG ＝ null，整段不走。
/** 打掉／換色 (x, y, z)：碰到玻璃（自己或 6 鄰）⇒ 這艘的玻璃網格下一格重建。 */
function glsTouch(sh, x, y, z) {
  var G = sh.T.glsG; if (!G || sh.glsD) return;
  if (G.get(x, y, z) || G.get(x - 1, y, z) || G.get(x + 1, y, z) || G.get(x, y - 1, z) || G.get(x, y + 1, z) || G.get(x, y, z - 1) || G.get(x, y, z + 1)) sh.glsD = true;
}
/** 這艘的玻璃網格（照 sh.grid 現在的格子）⇒ sh.gls ＝ { vao, vb, n }；沒有面 ⇒ n ＝ 0。 */
function glsBuild(sh) {
  var T = sh.T, g = sh.grid, P = T.glsXYZ, MI = T.glsI, G = T.glsG, V = [], N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (var k = 0, j = 0; k < P.length; k += 3, j++) {
    var x = P[k], y = P[k + 1], z = P[k + 2], col = g.get(x, y, z); if (!col) continue;
    var r = ((col >> 5) & 7) / 7, gg = ((col >> 2) & 7) / 7, b = (col & 3) / 3, mi = MI[j], mm = T.matM[mi], mr = T.matR[mi], mc = T.matC[mi];
    for (var f = 0; f < 6; f++) {
      var n = N[f], nx = x + n[0], ny = y + n[1], nz = z + n[2];
      if (g.get(nx, ny, nz)) continue;                                    // 旁邊有格（玻璃或實心）⇒ 不畫：實心那一面由方塊網格畫（玻璃不擋它）
      var ax = f >> 1, ua = SM_UAX[ax], va = SM_VAX[ax], L = [x, y, z], q = [];
      if (n[ax] > 0) L[ax]++;
      for (var e = 0; e < 4; e++) { var c = SM_C4[n[ax] > 0 ? e : 3 - e], Q = L.slice(); Q[ua] += c[0]; Q[va] += c[1]; q.push(Q); }
      [0, 1, 2, 0, 2, 3].forEach(function (i) { V.push(q[i][0], q[i][1], q[i][2], n[0], n[1], n[2], r, gg, b, mm, mr, mc); });
    }
  }
  var m = sh.gls || (sh.gls = { vao: gl.createVertexArray(), vb: gl.createBuffer(), n: 0 });
  if (!m.init) {
    gl.bindVertexArray(m.vao); gl.bindBuffer(gl.ARRAY_BUFFER, m.vb);
    [[0, 0, 3], [1, 3, 3], [2, 6, 3], [3, 9, 3]].forEach(function (a) { gl.enableVertexAttribArray(a[0]); gl.vertexAttribPointer(a[0], a[2], gl.FLOAT, false, 48, a[1] * 4); });   // 3：金屬度、粗糙度、透明度（P.tri 的 aM）
    gl.bindVertexArray(null); m.init = true;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, m.vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(V), gl.DYNAMIC_DRAW);
  m.n = V.length / 12; sh.glsD = false;
}
var SM_C4 = [[0, 0], [1, 0], [1, 1], [0, 1]];
/** 重開一場（70_flow.js reset）：丟掉這艘的玻璃網格。 */
function glsFree(sh) { if (sh.gls) { gl.deleteBuffer(sh.gls.vb); gl.deleteVertexArray(sh.gls.vao); sh.gls = null; } }
/** 玻璃那一趟（60_render.js，海與艙內的水之後）：P.tri、uGls 1、混色（目的地的 alpha 不動）、不寫深度。由遠到近（船之間）。 */
function glsDraw() {
  var vb = RBAT.pd.mn.b, L = SHIPS.filter(function (sh, i) { return sh.T.glsG && sh.sink <= 40 && !(vb && !(RBAT.cs[i] & vb)); }); if (!L.length) return;   // vb：鏡頭外的船不畫（60_rbatch.js viewVis；玻璃在格子的外框裡）
  var E = CAM.eye; L.sort(function (a, b) { return Math.hypot(b.M[12] - E[0], b.M[14] - E[2]) - Math.hypot(a.M[12] - E[0], a.M[14] - E[2]); });
  gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE); gl.depthMask(false); gl.disable(gl.CULL_FACE);
  gl.useProgram(P.tri.prog); setCommon(P.tri); gl.uniform1f(P.tri.u.uLit, 1); gl.uniform1f(P.tri.u.uGls, 1); if (P.tri.u.uGlow) gl.uniform1f(P.tri.u.uGlow, 0);
  L.forEach(function (sh) {
    if (!sh.gls || sh.glsD) glsBuild(sh); if (!sh.gls.n) return;
    cutSet(P.tri, sh); gl.uniformMatrix4fv(P.tri.u.uModel, false, sh.M);
    gl.bindVertexArray(sh.gls.vao); gl.drawArrays(gl.TRIANGLES, 0, sh.gls.n);
  });
  cutSet(P.tri, null); gl.uniform1f(P.tri.u.uGls, 0); gl.depthMask(true); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
}
