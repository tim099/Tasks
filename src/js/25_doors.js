// ───────────────────────── 門、艙蓋（TASK-0638；Tim 2026-10-16：「艙門機制 有人經過才打開 且打開只是演出效果(畫質設定可以關閉門的開關演出)」「門要另外建子模型 且可被破壞 …… 可以讓人員進出(直接視為通道) 但是會阻擋水流入」）─────────────────────────
// 標法（雕刻作品的模型 meta，造船規格 §9 kind 表 door 那一列）：kind=door；固定點 hinge-a、hinge-b（鉸鏈軸上兩點，門子作品裡登記）；可選 open=up｜side（說明：上下開／左右開）、open_deg（預設 100）。
//   開的方向：從 hinge-a 看向 hinge-b，右手定則正轉。第一個用的是莫尼特號主甲板的兩個艙蓋（meadow-monitor-01m-hatch，掛在前艙口、機艙艙口上）。
// 三件事，各自分開：
//   · 通道：門不擋人（40_crew.js CREW_BLOCK 不收 kind=door ⇒ 站位、走路格把它當沒有）—— 人照梯子、走路格走過去，門關著也照走。
//   · 演出（只改畫面）：有人經過（走路、爬梯子；第一人稱的玩家也算，81_fps.js shPassers）離門 1.5 m 內 ⇒ 開，人走了 1 秒 ⇒ 關（繞鉸鏈轉 m.sw，modelLocal 跟螺旋槳同一條路）。
//     在畫面那一格算（90_main.js frame，doorsAnim），⛔ 不在 step() 裡：戰局一個值都不讀它；畫質「門的開關演出」關掉 ⇒ 一直關著。
//     被打飛那一刻擺回關著（21_gunnery.js blowModel）⇒ 飛出去的落水時間跟演出開關無關（落水的水花會抽戰局的亂數）。
//   · 擋水：門底下那一片開口（門的外框正下方、甲板那一層原本就是空的格）平常不進水 —— 跟沒有門的開口一樣（遊戲只從砲彈打出的洞進水）。
//     門被打掉、掉了（m.alive 變 false，survey 那一拍）⇒ 那一片變成進水口：公式模式照水線下的洞算（sh.flood 那一層加上開口的格數）；
//     粒子模式（33_flood.js flTick）外面的水面（seaH，照浪）高過開口 ⇒ 照 Torricelli 灌進開口底下那一格（doorInflow）。
//     ⛔ 沒有門的開口照舊不進水（甲板上浪打過來沒做）⇒ 沒有門的船一位元不動。
// 血量：砲的一半（GUN_HP × 0.5；10_ship.js）—— 打得壞，壞了整片飛走（blowModel），開口露出來。
var DOOR_R = 15, DOOR_RZ = 25, DOOR_SP = 2.5, DOOR_HOLD = 1, DOOR_DEG = 100;   // 1.5 m 內有人經過（上下 2.5 m）；開／關各 0.4 秒；人走了留 1 秒
/** 開一艘船（10_ship.js makeShip，模型建好之後）：每扇門的鉸鏈、開口的格。沒有門 ⇒ sh.doors 不設（一行都不多算）。 */
function doorsShip(sh) {
  var D = [];
  sh.models.forEach(function (m) {
    if (m.kind !== 'door') return;
    var a = m.pts['hinge-a'], b = m.pts['hinge-b'];
    var d = { m: m, t: 0, hold: 0, gone: false, a: null, ax: null, deg: (isFinite(+m.meta.open_deg) ? +m.meta.open_deg : DOOR_DEG) * Math.PI / 180, cells: [], zt: Math.floor(m.bb[2]) - 1 };
    if (a && b && len(sub(b, a)) > 0.5) { d.a = [a[0] + 0.5, a[1] + 0.5, a[2] + 0.5]; d.ax = norm(sub(b, a)); }   // 固定點取格心（跟梯子一樣）；鉸鏈缺 ⇒ 不演出（匯入檢查報 ✗）
    var B = sh.T.hullG, b0 = m.bb;
    for (var x = Math.ceil(b0[0]); x < Math.floor(b0[3]); x++) for (var y = Math.ceil(b0[1]); y < Math.floor(b0[4]); y++) if (!B.get(x, y, d.zt)) d.cells.push(x, y);   // 開口：門正下方、甲板那一層原本就空的格
    D.push(d);
  });
  if (D.length) sh.doors = D;
}
/** 每半秒（32_hull.js survey）：門沒了（打飛、腳下的甲板沒了）⇒ 開口變成進水口（只登記一次）。 */
function doorsSurvey(sh) {
  sh.doors.forEach(function (d) {
    if (d.gone || d.m.alive || !d.cells.length) return;
    d.gone = true;
    var n = d.cells.length / 2, z = d.zt, sy = 0, sx = 0, cx = 0, cy = 0;
    for (var i = 0; i < d.cells.length; i += 2) { sy += d.cells[i + 1] > sh.T.cy ? 1 : -1; sx += d.cells[i] > sh.T.cx ? 1 : -1; cx += d.cells[i]; cy += d.cells[i + 1]; }
    if (z < sh.T.sz) { sh.flood[z * 3] += n; sh.flood[z * 3 + 1] += sy; sh.flood[z * 3 + 2] += sx; }   // 公式模式：跟水線下的洞一樣算（水線淹到甲板才進）
    if (sh.fl) (sh.fl.tops = sh.fl.tops || []).push({ x: cx / n + 0.5, y: cy / n + 0.5, z: z + 1, ar: n * S * S });   // 粒子模式：開口的中心、面積（flTick 讀，doorInflow）
  });
}
/** 粒子模式（33_flood.js flTick 的破口那一段之後）：門沒了的開口，外面的水面（seaH）高過開口 ⇒ 灌進開口底下那一格（水格自己往下流）。回 [進來的 m³, 面積, 幾個開口]。 */
function doorInflow(sh, fl, dtc, head) {
  var F = fl.F, M = sh.M, fk = sh.cfg.flood / LIM.flood[2], q = 0, ar = 0, n = 0;
  fl.tops.forEach(function (o) {
    var P = M4.pt(M, o.x, o.y, o.z), hOut = seaH(P[0], P[2], SIMT), ci = flCell(F, o.x, o.y, o.z - 2);
    ar += o.ar; n++;
    if (ci < 0 || hOut <= P[1]) return;
    var hIn = fl.A[ci] > 1e-6 ? head(ci) : -1e9, dh = hOut - Math.max(hIn, P[1]); if (dh <= 0.001) return;
    var dv = FL_C * o.ar * Math.sqrt(2 * G * dh) * fk * dtc; flDeposit(sh, fl, ci, dv); q += dv;
  });
  return [q, ar, n];
}
/** 匯入檢查（75_shipcheck.js）：每扇門的讀數一行。 */
function doorsSummary(sh) {
  if (!sh.doors) return '';
  return sh.doors.length + ' 扇：' + sh.doors.map(function (d) {
    var ax = d.ax ? (Math.abs(d.ax[2]) > 0.7 ? '左右開' : '上下開') : '鉸鏈缺';
    return d.m.path + '（' + ax + '、開口 ' + d.cells.length / 2 + ' 格）';
  }).join('；');
}

// ── 砲口進水（TASK-0822；Tim 2026-10-22：「船殼上如果原本就有開口 到水線下會進水嗎(不是被打出的洞)」「例如沒有炮門的砲口」「炮門被打掉前該炮口是隔水的(即使炮門視覺上打開)」）──
//   船殼上留給砲的開口（砲口）：沒有蓋板 ⇒ 開局就登記成進水口；有蓋板（62_ports.js）⇒ 蓋板被打壞才登記（照戰局的船殼狀態推：鉸鏈旁那一格船殼沒了、
//   關上時貼著的那一圈船殼掉 PORT_RING 格以上；⛔ 不讀演出的開合 P.s —— 畫面上掀開、「砲門的開關演出」關或開都一樣隔水）。
//   登記 ＝ 跟水密門一樣兩條路（doorsSurvey）：公式模式照水線下的洞算（sh.flood 每一層加上開口的格數）；粒子模式當成船殼上原本就開著的破口（33_flood.js flHoleRedo 讀 fl.portAt）⇒ 房間模擬（33_wrsim.js）照破口讀。
var PORT_WIN = 10, PORT_SIDE = 6;                                       // 從砲口往四周找開口最多幾格（碰到邊 ⇒ 不是砲口）；船殼那一層照砲口左右幾格內最外那一格
/** 第 g 門砲在船殼上的開口（照船型；回 { s 哪一舷（+1 ＝ +y）, cells [x, z, 船殼最外那一格的 y, …], n, z0 最低那一層 } 或 null）。
 *  船殼那一層 ＝ 同一層、砲口左右 PORT_SIDE 格內最外那一格（整艘含裝甲 T.base；⛔ T.hullHB 照實心格子算 ⇒ 砲口那幾層自己被挖掉、裝甲的砲廓沒有外形）；
 *  那一格往裡 4 格都沒有實心 ⇒ 開著。從砲口那一格（找不到 ⇒ 附近 2 格）往四周連（上下左右，PORT_WIN 格內）。
 *  ⛔ 碰到範圍的邊（不是一個口）、最上面那一排頭上沒有船殼（舷牆上沒蓋的缺口、砲在甲板上）⇒ null。 */
function portHole(T, g) {
  var B = T.base || T.hullG, s = g.ax[1] >= 0 ? 1 : -1, X0 = Math.floor(g.muz[0]), Z0 = Math.floor(g.muz[2]), cy = Math.round(T.cy), x, z, i, plate = {};
  function yOut(z2) {                                                  // 這一層的船殼最外那一格（砲口左右 PORT_SIDE 格內）
    if (plate[z2] !== undefined) return plate[z2];
    var best = null;
    for (var x2 = X0 - PORT_SIDE; x2 <= X0 + PORT_SIDE; x2++) for (var y = s > 0 ? B.sy - 1 : 0; s > 0 ? y > cy : y < cy; y -= s) if (B.get(x2, y, z2)) { if (best === null || (s > 0 ? y > best : y < best)) best = y; break; }
    return (plate[z2] = best);
  }
  function open(x2, z2) { var y = yOut(z2); if (y === null || z2 < 0) return false; for (var t = 0; t < 4; t++) if (B.get(x2, y - s * t, z2)) return false; return true; }
  var seed = null; for (var r = 0; r <= 2 && !seed; r++) for (var dz = -r; dz <= r && !seed; dz++) for (var dx = -r; dx <= r && !seed; dx++) if (open(X0 + dx, Z0 + dz)) seed = [X0 + dx, Z0 + dz];
  if (!seed) return null;
  var seen = {}, st = [seed], cells = [], zmin = 1e9;
  seen[seed[0] + ',' + seed[1]] = 1;
  while (st.length) {
    var c = st.pop(); x = c[0]; z = c[1];
    if (Math.abs(x - X0) >= PORT_WIN || Math.abs(z - Z0) >= PORT_WIN) return null;
    cells.push(x, z, yOut(z)); zmin = Math.min(zmin, z);
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) { var k = (x + d[0]) + ',' + (z + d[1]); if (!seen[k] && open(x + d[0], z + d[1])) { seen[k] = 1; st.push([x + d[0], z + d[1]]); } });
  }
  for (i = 0; i < cells.length; i += 3) { x = cells[i]; z = cells[i + 1]; if (!seen[x + ',' + (z + 1)] && yOut(z + 1) === null) return null; }   // 頭上沒有船殼 ⇒ 舷牆缺口、不是砲口
  return { s: s, cells: cells, n: cells.length / 3, z0: zmin };
}
/** 開一艘船（10_ship.js makeShip，進水狀態建好之後）：每門砲的砲口；沒有蓋板的當場登記、有蓋板的掛著等蓋板被打壞（portsSurvey）。沒有砲口 ⇒ sh.portW 不設。 */
function portsFloodInit(sh) {
  if (!sh.guns || !sh.guns.length) return;
  var L = [], lids = null;
  sh.guns.forEach(function (g) {
    var h = portHole(sh.T, g); if (!h) return;
    if (lids === null) { if (sh.ports === undefined) sh.ports = portsBuild(sh); lids = sh.ports ? sh.ports.L : []; }   // 蓋板（62_ports.js；那一支懶建的同一份）
    var P = lids.filter(function (q) { return q.g === g; })[0] || null;
    var w = { g: g, h: h, P: P, on: false }; L.push(w);
    if (!P) portOpen(sh, w);
  });
  if (L.length) sh.portW = L;
}
/** 每半秒（32_hull.js survey）：有蓋板的砲口，蓋板被打壞了沒（照船殼的狀態；⛔ 不讀 P.s／P.gone，那是演出）⇒ 登記成進水口（只登記一次）。 */
function portsSurvey(sh) {
  for (var k = 0; k < sh.portW.length; k++) {
    var w = sh.portW[k]; if (w.on || !w.P) continue;
    var d = w.P.d, R = w.P.ring, broke = d.foot >= 0 && !hullGp(sh.grid, d.foot);
    for (var i = 0, n = 0; !broke && i < R.length; i++) if (!hullGp(sh.grid, R[i]) && ++n >= PORT_RING) broke = true;
    if (broke) portOpen(sh, w);
  }
}
/** 砲口登記成進水口：公式模式每一層加格數（跟 doorsSurvey 同一個欄位）；粒子模式記在 fl.portAt（33_flood.js flHoleRedo 當成開著的破口）、那幾塊破口待重算。 */
function portOpen(sh, w) {
  w.on = true;
  var c = w.h.cells, T = sh.T, fl = sh.fl;
  for (var i = 0; i < c.length; i += 3) {
    var x = c[i], z = c[i + 1];
    if (z < T.sz) { sh.flood[z * 3] += 1; sh.flood[z * 3 + 1] += w.h.s; sh.flood[z * 3 + 2] += x > T.cx ? 1 : -1; }
    if (!fl) continue;
    var F = fl.F; if (z >= F.zTop || x < F.X0 || x >= F.X0 + F.nxv) continue;
    var side = w.h.s > 0 ? 0 : 1, h = (side * F.NX + ((x - F.X0) / F.c | 0)) * F.NZ + (z / F.c | 0);
    (fl.portAt || (fl.portAt = new Map())).set((side * F.nxv + x - F.X0) * F.zTop + z, c[i + 2]);
    if (!fl.hmark[h]) { fl.hmark[h] = 1; fl.hdirty.push(h); }
  }
}
