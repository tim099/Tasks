// ───────────────────────── 預備水手（缺人手時補位；平常在水線下的甲板待命，也會上別層甲板走動） ─────────────────────────
// Tim 2026-10-13：通用水手待在水線下的甲板待命，缺人手時補上；也可以在其他甲板遊蕩。
// 補哪些位：砲班（每層、每一舷補回開戰時的人數；砲沒了就少補）、送藥手（每層補回開戰時的人數）、舵手（舵輪還在）。交戰的那一舷先補。
//   每半秒（survey）點一次名：缺幾個就派幾個最近的閒著的水手；走到那一層甲板（爬完梯子那一刻）就換成那個職位，
//   之後照原本的調度走（砲班 reassign、送藥手 stepMonkey）；舵手先走到倒下那位的站位再換。
// 梯子照模型的 meta（basecamp：關聯 meta kind=ladders，固定點 <梯名>.foot／lo／hi／head ＝ 腳踩的那一格）：
//   走到 foot → 沿 lo、hi 爬 → 在 head 下梯；一座梯子一次上一個人（前一個爬了 LADDER_GAP 秒，下一個才上）。
//   沒有梯子的 meta（舊的 .vxk）⇒ 預備水手待在最下層的砲甲板，只補那一層。
// 走得到的甲板 ＝ 砲甲板（sh.decks）＋梯子的一頭落在砲甲板以外的高度（憲法號：住艙甲板，地板在設計水線下 0.3 m）；待命 ＝ 最下面那層。
// 走路格：每層每 NAV_C 格一點，站得住（頭上 1.2 m 空）、不在砲與舵輪裡、跟最大那一片連得通（相鄰高低差 ≤ NAV_DZ：憲法號砲甲板 x 570 有一階 0.3 m，⛔ 2 格 ⇒ 前段整片接不上）；
//   找路 ＝ 走路格上的 BFS 再拉直。
//   ⛔ 走路格只照開戰時的船：甲板被打穿照樣走過去（跟砲班換砲一樣），站著不動時腳下沒了才掉（survey）。
// 一個人物 ＝ 一個預備水手（數量在細節設定，0 ＝ 沒有）；開戰時的人數算進 crew0（降旗的死傷 % 跟著算）。
var NAV_C = 2, NAV_HEAD = 12, NAV_DZ = 3, HAND_SP = [11, 20], CLIMB_SP = [6, 9], LADDER_GAP = 0.9, HAND_PATHS = 2, HAND_ROAM = 0.25, HAND_BACK = 0.6, CLIMB_LIFT = 2;
var NAV_DX = [1, -1, 0, 0, 1, 1, -1, -1], NAV_DY = [0, 0, 1, -1, 1, -1, 1, -1];
/** 梯子：關聯 meta kind=ladders 的固定點 <梯名>.foot／lo／hi／head（格中心）⇒ [{ name, pts, link }]（站位座標：x、y 照格中心，z ＝ 腳踩的那一格；foot 在下）。
 *  link ＝ 同一條關聯 meta 的 `<梯名>.decks`（直接指定通哪兩層，ladDecks）。 */
function shipLadders(T) {
  var out = [];
  (T.h.parts || []).forEach(function (p) {
    if (!p.meta || (p.meta.kind !== 'ladders' && p.meta.kind !== 'ladder')) return;
    var by = {};
    Object.keys(p.points || {}).forEach(function (k) {
      var i = k.lastIndexOf('.'), nm = i < 0 ? '' : k.slice(0, i), w = i < 0 ? k : k.slice(i + 1), v = p.points[k];
      (by[nm] = by[nm] || {})[w] = [v[0], v[1], Math.floor(v[2])];
    });
    Object.keys(by).forEach(function (nm) {
      var b = by[nm]; if (!b.foot || !b.head) return;
      var pts = [b.foot, b.lo, b.hi, b.head].filter(Boolean); if (b.foot[2] > b.head[2]) pts.reverse();
      out.push({ name: (p.path || '') + (nm ? '/' + nm : ''), pts: pts, link: p.meta[nm ? nm + '.decks' : 'decks'], part: p.path });   // part：那一件關聯（木匠照它的格子清單整件還原，46_carpenter.js）
    });
  });
  return out.concat(ropeLadders(T));
}
/** 繩梯（雕刻 TASK-0678：橫繩組標了 climb）：每道橫繩的 meta 帶 ratlines（組路徑）、rung、foot、head（組裝件座標 x,y,z）⇒
 *  foot → 最低一道的中點 → 最高一道的中點 → head（同梯子的 foot／lo／hi／head；中點站在橫繩上 ⇒ z ＝ 橫繩那一格的上一格）。
 *  rope ＝ 那幾道橫繩的名字：橫繩不是格子 ⇒ 斷不斷照繩（42_hands.js 的踏板檢查不適用，見 makeHands）。一頭不在甲板上（例：桅頂平台）⇒ 只有第一人稱爬得上去，水手照舊走梯子。 */
function ropeLadders(T) {
  var by = {}, out = [];
  ((T.rig && T.rig.ropes) || []).forEach(function (r) {
    var m = r.meta; if (!m || !+m.climb || !m.ratlines || !m.foot || !m.head || !r.pts || r.pts.length < 6) return;
    (by[m.ratlines] = by[m.ratlines] || []).push(r);
  });
  function xyz(s) { var v = String(s).split(',').map(Number); return [v[0], v[1], Math.floor(v[2])]; }
  function mid(r) { var p = r.pts, n = p.length / 3 - 1; return [(p[0] + p[n * 3]) / 2, (p[1] + p[n * 3 + 1]) / 2, Math.floor((p[2] + p[n * 3 + 2]) / 2) + 1]; }
  Object.keys(by).forEach(function (k) {
    var L = by[k].sort(function (a, b) { return a.meta.rung - b.meta.rung; }), m = L[0].meta;
    var pts = [xyz(m.foot), mid(L[0]), mid(L[L.length - 1]), xyz(m.head)]; if (pts[0][2] > pts[3][2]) pts.reverse();
    var p = L[0].pts, xa = p[0], xb = p[p.length - 3];                   // span：最低一道的前後兩端（x）⇒ 第一人稱沿著這一段都摸得到梯腳（81_fps.js fpNear；Tim 2026-10-17「繩梯…還是不能爬(是否可以加大判定範圍?)」）
    out.push({ name: k, pts: pts, link: m.decks, rope: L.map(function (r) { return r.name; }), span: [Math.min(xa, xb), Math.max(xa, xb)], ri: [T.rig.ropes.indexOf(L[0]), T.rig.ropes.indexOf(L[L.length - 1])] });   // ri：最低、最高那一道是第幾條繩（綁在砲塔上 ⇒ 第一人稱照它們現在的位置爬，81_fps.js fpLadMap）
  });
  return out;
}
function lvOf(Ls, z) { for (var i = 0; i < Ls.length; i++) if (z >= Ls[i].zr[0] && z <= Ls[i].zr[1]) return i; return -1; }
/** 船上一點 p 落在哪一層：有甲板 meta ⇒ 照那一欄的地板（deckAt，x 也看；navLevels 一層甲板一層 ⇒ 第幾層 ＝ d.i）；沒有甲板 meta、或離每層地板都太遠 ⇒ 照高度（lvOf）。 */
function lvAt(sh, p) {
  var Ls = sh.nav.levels, t = Ls[Ls.length - 1]; if (t && t.tur && p[2] >= t.zr[0] && p[2] <= t.zr[1]) return Ls.length - 1;   // 砲塔頂那一層（turTopLevel）
  var d = hullDecks(sh.T).length ? deckAt(sh.T, p[0], p[2]) : null; return d ? d.i : lvOf(Ls, p[2]);
}
/** 一點在走路格上是第幾層、哪一塊（[層, 塊]；量不到 ⇒ null）。 */
function navRegAt(sh, p) {
  if (!sh.nav) return null;
  var li = lvAt(sh, p), L = li >= 0 ? sh.nav.levels[li] : null; if (!L) return null;
  var i = navSnapW(L.N, p); return i < 0 ? null : [li, L.N.reg[i]];
}
/** 找走路格上最近的一點：2 點內，找不到再放寬到 6 點（站在牆邊、走路格外的放藥箱位置；測試模式量到：2 點量不到 ⇒ 當作走得到 ⇒ 被分去送砲塔裡的砲、直線穿過去）。 */
function navSnapW(N, p) { var i = navSnap(N, p, 2); return i >= 0 ? i : navSnap(N, p, 6); }
/** 直線走的人（砲手換砲 goToGun、送藥手 monkeyTo）從 a 走得到 b 嗎：走路格上同一層、同一塊才算（Tim 2026-10-17「水手會穿進去」：
 *  主砲塔吊籃裡的砲手被借去補甲板上的速射砲、送藥手被分到圈裡的砲 ⇒ 照直線穿過砲塔那一圈牆（TASK-0655 的牆只擋走路格）。
 *  只看有會轉的裝甲／砲塔的船（T.armor）⇒ 其他船一行都不多算、戰局逐位元組不變；量不到（沒有走路格、snap 不到、不同層）⇒ 照以前當作走得到。 */
function navReach(sh, a, b) {
  if (!sh.nav || !sh.T.armor || !sh.T.armor.length) return true;
  var A = navRegAt(sh, a), B = navRegAt(sh, b);
  if (A && B && A[0] !== B[0] && (sh.nav.levels[A[0]].tur || sh.nav.levels[B[0]].tur)) return false;   // 一頭在砲塔頂（turTopLevel）⇒ 要爬繩梯，直線走不到（量過：頂上砲班倒下 5 秒內，甲板上的砲手直線穿過砲塔頂站上去 3 個）
  return !A || !B || A[0] !== B[0] || A[1] === B[1];
}
/** 直線走的人（砲手換砲、送藥手來回）a → b 要經過的點（最後一點 ＝ b）：會轉裝甲的船、同一層同一塊、直直走過去會碰到牆（navSee）⇒ 照走路格找路再拉直；
 *  其他（沒有會轉裝甲的船、看得到、量不到、不同塊）⇒ [b]（照以前直線）。⛔ 只看同一塊不夠：甲板繞著砲塔一圈是連通的，兩點在砲塔兩邊時直線照樣穿過去（Tim 2026-10-17「水手會穿進去」，量到的就是這一例）。 */
function navWay(sh, a, b) {
  if (!sh.nav || !sh.T.armor || !sh.T.armor.length) return [b];
  var li = lvAt(sh, a), L = li >= 0 ? sh.nav.levels[li] : null; if (!L || lvAt(sh, b) !== li) return [b];
  var N = L.N, i = navSnapW(N, a), j = navSnapW(N, b);
  if (i < 0 || j < 0 || i === j || N.reg[i] !== N.reg[j] || navSee(N, i, j)) return [b];
  var p = navPath(N, i, j); if (!p) return [b];
  var w = navSmooth(N, p).slice(1, -1).map(function (k) { return navPos(N, k); });   // 頭尾不要（頭 ＝ 自己腳下、尾換成 b 本身）
  w.push(b); return w;
}
/** 點名補位要走到第 lv 層的哪一塊（callHands；同一個理由：到了那一層就換職位、之後照直線走 ⇒ 落在砲塔外的那一塊就會穿牆走進去）：
 *  p 落在第 lv 層 ⇒ 那一塊；沒有會轉裝甲的船、量不到 ⇒ undefined（那一層哪一塊都行，跟以前一樣）。 */
function needReg(sh, lv, p) {
  if (!sh.T.armor || !sh.T.armor.length || !p) return undefined;
  var A = navRegAt(sh, p); return A && A[0] === lv ? A[1] : undefined;
}
/** 砲手、送藥手所在那一塊已經沒有活著的砲可去（砲塔裡的砲全被打掉）⇒ 改當預備水手（會走梯子；點名照缺額重新派到別塊）。
 *  ⛔ 不改 ⇒ 不會爬梯子、又不能穿牆（navReach）⇒ 一直關在吊籃裡，點名還把他算成在崗 ⇒ 外面缺人的砲永遠沒人補。只在會轉裝甲的船叫（40_crew.js reassign）。 */
function toHand(sh, c) {
  var NV = sh.nav, lv = NV ? lvAt(sh, c.pos) : -1; if (lv < 0 || !NV.levels[lv]) return false;
  tlgEv(sh, c, 'toHand', { role: c.role, why: '這一塊沒有活著的砲' });   // 測試模式（83_testlog.js）
  if (c.role === ROLE.GUN) leaveGun(c);
  if (c.role === ROLE.POWDER) { (c.guns || []).forEach(function (g) { if (g.pm === c) g.pm = null; }); c.pm = null; c.cart = false; }
  if (c.art === undefined) c.art = c.role;                               // 貼圖照原本的職位那一列
  c.role = ROLE.HAND; c.gun = null; c.walk = null; c.moving = false; c.deck = NV.levels[lv].key;
  c.hand = { lv: lv, wait: rr(1, 3), legs: [], wp: null, k: 0, climb: null, job: null, to: null };
  return true;
}
/** 那一層倒下、還沒人接的送藥手（點名與接手照同一個挑）；reg 給了 ⇒ 先挑家在那一塊的。 */
function deadPm(sh, deck, lv, reg) {
  var L = sh.crew.filter(function (o) { return o.role === ROLE.POWDER && o.deck === deck && !crewAble(o) && !o.relieved; });
  return (reg !== undefined ? L.filter(function (o) { return needReg(sh, lv, o.home) === reg; })[0] : null) || L[0];
}
/** 走得到的甲板（由下往上）：砲甲板＋梯子一頭落在砲甲板以外的高度（相差 8 格內併成一層，上下各留 5 格的舷弧，不蓋到砲甲板）。 */
function navLevels(sh, lads) {
  var DM = hullDecks(sh.T);
  if (DM.length) {                                                        // 有甲板 meta（35_decks.js）⇒ 一層甲板一層；有砲的那幾層用砲甲板的 key（砲班、送藥手補位照它找層）
    var DL = DM.map(function (d, i) {                                     // 高度範圍：跟上下兩層各切在中間（頭一層往下 10 格、最上層往上 20 格）
      var lo = i ? Math.floor((DM[i - 1].zmax + d.zmin) / 2) + 1 : d.zmin - 10, hi = i < DM.length - 1 ? Math.floor((d.zmax + DM[i + 1].zmin) / 2) : d.zmax + 20;
      var G = sh.decks.filter(function (D) { return D.meta === d; })[0];
      return { key: G ? G.key : 'h' + i, name: d.name, zr: [lo, hi], deck: d };
    });
    return DL.concat(turTopLevel(sh, DL[DL.length - 1].zr[1]));
  }
  var Ls = sh.decks.map(function (D) { return { key: D.key, name: D.name, zr: D.zr }; }), ext = [];
  lads.forEach(function (l) {
    if (l.rope) return;                                                   // 繩梯不開新的一層（桅頂平台不是甲板）；兩頭都在甲板上的照樣接（makeHands）
    [l.pts[0], l.pts[l.pts.length - 1]].forEach(function (p) {
      if (lvOf(Ls, p[2]) >= 0) return;
      var e = ext.filter(function (e) { return p[2] >= e[0] - 8 && p[2] <= e[1] + 8; })[0];
      if (e) { e[0] = Math.min(e[0], p[2]); e[1] = Math.max(e[1], p[2]); } else ext.push([p[2], p[2]]);
    });
  });
  var low = Ls.length ? Ls[0].zr[0] : 1e9;
  ext.forEach(function (e, i) {
    var zr = [e[0] - 5, e[1] + 5];
    Ls.forEach(function (L) { if (L.zr[0] > e[1] && zr[1] >= L.zr[0]) zr[1] = L.zr[0] - 1; if (L.zr[1] < e[0] && zr[0] <= L.zr[1]) zr[0] = L.zr[1] + 1; });
    Ls.push({ key: 'h' + i, name: e[1] < low ? '住艙甲板' : '甲板（z ' + e[0] + '）', zr: zr });
  });
  Ls.sort(function (a, b) { return a.zr[0] - b.zr[0]; });
  return Ls.concat(turTopLevel(sh, Ls.length ? Ls[Ls.length - 1].zr[1] : -1));
}
/** 砲塔頂一層（Tim 2026-10-17：「確定水手可以上去就ok」—— 繩梯從砲塔頂的艙口垂到吊籃）：有砲塔層（kind=turret）、殼頂比最上面那層甲板的範圍還高
 *  ⇒ 多一層「砲塔頂」（最上層之上 ～ 殼頂往上 20 格）：站在砲塔的格上的點照會轉的甲板記（navBuild N.rot），繩梯（綁在砲塔上）接吊籃那一層 ⇄ 這一層。
 *  ⛔ 沒有砲塔層、或砲塔都矮（砲盾）⇒ 一層都不多（其他船的走路格逐位元組不變）。 */
function turTopLevel(sh, top) {
  var hi = -1; (sh.T.armor || []).forEach(function (A) { if (A.tur !== undefined) hi = Math.max(hi, A.bb[5]); });
  return hi + 1 > top && top >= 0 ? [{ key: 'tt', name: '砲塔頂', zr: [top + 1, hi + 20], tur: true }] : [];
}
/** a 往 d 方向走一格 ⇒ 那一格（站不住、高低差太大、斜走切到角 ⇒ -1）。邊上一圈一定站不住 ⇒ 不用另外查界。 */
function navStep(N, a, d) {
  var Z = N.Z, b = a + NAV_DX[d] + NAV_DY[d] * N.nx;
  if (Z[b] < 0 || Math.abs(Z[b] - Z[a]) > NAV_DZ) return -1;
  if (d >= 4 && (Z[a + NAV_DX[d]] < 0 || Z[a + NAV_DY[d] * N.nx] < 0)) return -1;
  return b;
}
/** 開局分段（10_ship.js makeShipSteps，makeCrew 之前）：makeHands 要的走路格一層一步先建好（同一型第一次建約 0.07 s）——
 *  CREW_BLOCK 照 makeCrew 一開始設的那一份（crewBlockOf）、同一套 navLevels ⇒ makeHands 照鍵（高度範圍＋模型數）拿到同一份。makeHands 不建的（沒有預備水手、不會落水）⇒ []。 */
function crewNavSteps(sh) {
  var cw = shipCrew(sh.T.id); if (cw.hands <= 0 && DROWN_T <= 0) return [];
  return navLevels(sh, shipLadders(sh.T)).map(function (L) { return function () { CREW_BLOCK = crewBlockOf(sh); navBuild(sh, L); }; });
}
/** 一層的走路格（照船型與那一層的高度記在 T 上：兩艘同型共用、重開一場不重算）。 */
function navBuild(sh, L) {
  var T = sh.T, g = navBase(T), C = T.navC || (T.navC = {}), key = L.zr.join(',') + ':' + sh.models.length, d = L.deck;
  if (C[key]) return C[key];
  var x0 = Math.max(0, T.hx0 - 4), nx = Math.ceil((Math.min(g.sx, T.hx1 + 5) - x0) / NAV_C) + 1, ny = Math.ceil(g.sy / NAV_C), n = nx * ny, i, x, y;
  var Z = new Int16Array(n).fill(-1), blk = new Uint8Array(n), rot = T.turrets && T.turrets.length ? new Uint8Array(n) : null, nrot = 0;
  for (y = 1; y < ny - 1; y++) for (x = 1; x < nx - 1; x++) {
    var gx = x0 + x * NAV_C, gy = y * NAV_C; if (gx >= g.sx || gy >= g.sy) continue;
    var z = navZ(g, d, L, gx, gy);
    if (rot) { var tz = turNavZ(T, d, L, gx, gy); if (tz) { z = tz[0]; rot[x + y * nx] = tz[1] + 1; nrot++; } }   // 會轉的甲板（27_turret.js）：腳下是砲塔自己的格 ⇒ 照砲塔座標
    if (z >= 0 && blocked(gx, gy, z)) { blk[x + y * nx] = 1; continue; }   // 站在砲、舵輪、家具裡 ⇒ 永遠不能走（動態更新時照它，⛔ 不再看 CREW_BLOCK：那是最後一艘建的船的）
    if (z >= 0) Z[x + y * nx] = z;
  }
  var N = { x0: x0, nx: nx, ny: ny, Z: Z, blk: blk, rot: nrot ? rot : null };
  if (nrot) T.turDeck = true;
  navRegions(N);
  return C[key] = N;
}
/** 會轉的甲板（27_turret.js）：(gx, gy) 照砲塔座標（＝ 開局的船的格座標）看，站得住、而且腳下是砲塔自己的格 ⇒ [高度, 第幾座砲塔]；不是 ⇒ null。
 *  頭上照那一串砲塔自己的樣子看（掃過的那一圈不擋 ⇒ 吊籃上的彈藥箱照它的位置擋）。⛔ 腳下是不轉的甲板（罩在甲板上的砲塔）⇒ 照舊（那一圈是牆）。 */
function turNavZ(T, d, L, gx, gy) {
  for (var i = 0; i < T.armor.length; i++) {
    var A = T.armor[i], R = A.ring; if (A.tur === undefined || !R || A.rootK < 0 || Math.hypot(gx + 0.5 - R.c[0], gy + 0.5 - R.c[1]) > R.r) continue;
    var z = navZ(navRestB(T, A.rootK), d, L, gx, gy); if (z < 0) continue;
    var k = armDeckK(T, gx, gy, z - 1); if (k >= 0 && turRootK(T, k) === A.rootK) return [z, k];
  }
  return null;
}
/** 走路格上的一點 p（船的格座標）換成那一層記的座標：站在會轉的甲板上 ⇒ 砲塔座標（27_turret.js）；其他照舊。 */
function navRestP(N, p) { if (!N.sh) return p; var k = turDeckAt(N.sh, p); return k >= 0 ? ndIn(N.sh.tur[k], p) : p; }
/** 那一點站得住的高度：有甲板 meta ⇒ 只看那一欄地板上下（−2～+3 格；甲板 meta 有 walk ⇒ 照走的那一層面，35_decks.js deckWalk）；沒有 ⇒ 那一層的高度範圍裡最高那個。 */
function navZ(g, d, L, gx, gy) {
  if (!d) return standZ(g, gx, gy, L.zr[0], L.zr[1], NAV_HEAD);
  var f = deckWalk(d, gx); return f === null ? -1 : standZ(g, gx, gy, f - 2, f + 3, NAV_HEAD);
}
var NAV_MINREG = 12;                                                      // 連通區域至少幾點才算（小於它 ⇒ 砲架頂、桶堆上那種站得住的小塊，不走）
/** 切連通區域（8 鄰）：N.reg（每一點屬於第幾塊，−1 ＝ 不能走）、N.regs（每一塊幾點）、N.ok、N.cells（全部能走的點）、N.big（最大那一塊）。
 *  甲板被打成兩塊以上不通 ⇒ 兩塊各自一個區域，找路只在同一塊裡找、跨塊只能走梯子（TASK-0572）。
 *  N.cid（每一點屬於第幾個連通塊，含 < NAV_MINREG 的小塊；照塊裡最小的那一點排序）、N.csz、N.cmin 留著給增量重切（navRegionsAt）。 */
function navRegions(N) {
  var n = N.nx * N.ny, Z = N.Z, comp = new Int32Array(n).fill(-1), q = new Int32Array(n), sizes = [], mins = [], i;
  for (i = 0; i < n; i++) {
    if (Z[i] < 0 || comp[i] >= 0) continue;
    var h = 0, t = 0, id = sizes.length; q[t++] = i; comp[i] = id;
    while (h < t) { var a = q[h++]; for (var dd = 0; dd < 8; dd++) { var b = navStep(N, a, dd); if (b >= 0 && comp[b] < 0) { comp[b] = id; q[t++] = b; } } }
    sizes.push(t); mins.push(i);
  }
  N.cid = comp; N.csz = sizes; N.cmin = mins;
  navRegFinish(N);
}
/** 增量重切（TASK-0673：一層 8 萬點整層 BFS，甲板被打一次就整層重來）：只有 ch（高度變了的點）那幾點的 3×3 裡的邊會變
 *  （navStep 斜走查的兩格也在 3×3 裡）⇒ 只有碰到 3×3 的舊連通塊可能分開、接上；其他塊一點都不動。
 *  從 3×3 裡站得住的每一點同時往外 BFS（輪流一步），碰頭就併成一群；走完的那一群 ＝ 一個新的塊；只剩一群還沒走完 ⇒ 停：
 *  它 ＝ 碰到的舊塊裡其他所有的點（每一點在舊的圖上走得到 3×3、進 3×3 之前走的邊都沒變）⇒ 不用走。
 *  ⇒ 成本 ＝ 被切下來的那幾小塊；沒被切開 ⇒ 繞過破洞就碰頭。最後照塊裡最小那一點重新編號 ⇒ 跟整層重切（navRegions）一位元不差。 */
function navRegionsAt(N, ch) {
  var n = N.nx * N.ny, nx = N.nx, Z = N.Z, cid = N.cid, csz = N.csz, cmin = N.cmin, C = csz.length;
  var hit = new Uint8Array(C), lab = new Int32Array(n).fill(-1), seeds = [], i, j, d;
  ch.forEach(function (c) {
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      var k = c + dx + dy * nx;
      if (cid[k] >= 0) hit[cid[k]] = 1;
      if (Z[k] >= 0 && lab[k] < 0) { lab[k] = seeds.length; seeds.push(k); }
    }
  });
  var S = seeds.length, par = new Int32Array(S), pend = new Int32Array(S), Q = [], qh = new Int32Array(S), live = S;
  for (j = 0; j < S; j++) { par[j] = j; pend[j] = 1; Q.push([seeds[j]]); }
  function root(a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }
  while (live > 1) {
    for (j = 0; j < S && live > 1; j++) {
      if (qh[j] >= Q[j].length) continue;
      var a = Q[j][qh[j]++], r = root(j); pend[r]--;
      for (d = 0; d < 8; d++) {
        var b = navStep(N, a, d); if (b < 0) continue;
        if (lab[b] < 0) { lab[b] = j; Q[j].push(b); pend[r]++; }
        else { var r2 = root(lab[b]); if (r2 !== r) { par[r2] = r; pend[r] += pend[r2]; live--; } }   // 碰頭 ⇒ 併成一群（走完的那一群不會再被碰到：它走的時候就先碰過了）
      }
      if (!pend[r]) live--;                                               // 這一群走完了 ⇒ 一個新的塊
    }
  }
  var rest = -1; for (j = 0; j < S; j++) if (root(j) === j && pend[j] > 0) rest = j;   // 還沒走完的那一群（最多一群）
  // 新的塊：先給暫時的編號 C、C+1…（照掃到的順序 ＝ 照最小那一點），沒碰到的舊塊照舊；再跟舊塊照最小那一點合併排序
  var gid = new Int32Array(S).fill(-1), nsz = [], nmin = [];
  for (i = 0; i < n; i++) {
    var o = cid[i];
    if (Z[i] < 0) { cid[i] = -1; continue; }
    if (o >= 0 && !hit[o]) continue;
    var g = lab[i] >= 0 ? root(lab[i]) : rest;
    if (gid[g] < 0) { gid[g] = C + nsz.length; nsz.push(0); nmin.push(i); }
    cid[i] = gid[g]; nsz[gid[g] - C]++;
  }
  var map = new Int32Array(C + nsz.length), sz = [], mn = [], p = 0, q = 0;
  while (p < C || q < nsz.length) {
    while (p < C && hit[p]) p++;
    if (p < C && (q >= nsz.length || cmin[p] < nmin[q])) { map[p] = sz.length; sz.push(csz[p]); mn.push(cmin[p]); p++; }
    else if (q < nsz.length) { map[C + q] = sz.length; sz.push(nsz[q]); mn.push(nmin[q]); q++; }
  }
  for (i = 0; i < n; i++) if (cid[i] >= 0) cid[i] = map[cid[i]];
  N.csz = sz; N.cmin = mn;
  navRegFinish(N);
}
/** N.cid／csz ⇒ reg、ok、cells、regs、big、parts、bigCells（< NAV_MINREG 的小塊不走）。 */
function navRegFinish(N) {
  var n = N.nx * N.ny, comp = N.cid, sizes = N.csz, i;
  var map = sizes.map(function (s) { return -1; }), regs = [], big = -1;
  sizes.forEach(function (s, k) { if (s >= NAV_MINREG) { map[k] = regs.length; if (big < 0 || s > regs[big]) big = regs.length; regs.push(s); } });
  var reg = new Int32Array(n).fill(-1), ok = new Uint8Array(n), cells = [];
  for (i = 0; i < n; i++) if (comp[i] >= 0 && map[comp[i]] >= 0) { reg[i] = map[comp[i]]; ok[i] = 1; cells.push(i); }
  N.reg = reg; N.ok = ok; N.cells = cells; N.regs = regs; N.big = big; N.parts = sizes.length;
  N.bigCells = cells.filter(function (c) { return reg[c] === big; });
}
function navCell(N, p) { if (N.sh) p = navRestP(N, p); var x = Math.round((p[0] - 0.5 - N.x0) / NAV_C), y = Math.round((p[1] - 0.5) / NAV_C); return x < 0 || y < 0 || x >= N.nx || y >= N.ny ? -1 : x + y * N.nx; }
function navPos(N, i) { var P = [N.x0 + (i % N.nx) * NAV_C + 0.5, ((i / N.nx) | 0) * NAV_C + 0.5, N.Z[i]]; return N.sh && N.rot[i] ? ndOut(N.sh.tur[N.rot[i] - 1], P) : P; }   // 會轉的甲板 ⇒ 照砲塔現在的角度換回船的座標
/** p 附近 r 點內、連得通的最近那一點（高度差一格 ＝ 遠 8 點的平面距離²；4 格以上最後才挑）；沒有 ⇒ -1。
 *  ⛔ 只看平面距離 ⇒ 梯子 head（甲板 z 82）吸到旁邊艙口圍欄的頂上（z 85），人下梯往上跳一下。 */
function navSnap(N, p, r) {
  if (N.sh) p = navRestP(N, p);
  var cx = Math.round((p[0] - 0.5 - N.x0) / NAV_C), cy = Math.round((p[1] - 0.5) / NAV_C), best = -1, bd = 1e9;
  for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
    var x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= N.nx || y >= N.ny) continue;
    var i = x + y * N.nx; if (!N.ok[i]) continue;
    var dz = Math.abs(N.Z[i] - p[2]), d = dx * dx + dy * dy + dz * 8 + (dz > 3 ? 1e4 : 0); if (d < bd) { bd = d; best = i; }
  }
  return best;
}
var NQ = null, NP = null, NV = null, NSTAMP = 0;
/** 走路格上 a → b 的路（BFS，8 鄰）；走不到 ⇒ null。 */
function navPath(N, a, b) {
  var n = N.nx * N.ny, u, v, d;
  if (!NQ || NQ.length < n) { NQ = new Int32Array(n); NP = new Int32Array(n); NV = new Uint32Array(n); NSTAMP = 0; }
  var s = ++NSTAMP, h = 0, t = 0; NQ[t++] = a; NV[a] = s; NP[a] = -1;
  while (h < t) {
    u = NQ[h++]; if (u === b) break;
    for (d = 0; d < 8; d++) { v = navStep(N, u, d); if (v >= 0 && N.ok[v] && NV[v] !== s) { NV[v] = s; NP[v] = u; NQ[t++] = v; } }
  }
  if (NV[b] !== s) return null;
  var p = []; for (u = b; u >= 0; u = NP[u]) p.push(u);
  return p.reverse();
}
/** a、b 之間直直走過去，每一點都連得通？ */
function navSee(N, a, b) {
  var nx = N.nx, ax = a % nx, ay = (a / nx) | 0, bx = b % nx, by = (b / nx) | 0, n = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2, prev = a;
  for (var k = 1; k <= n; k++) {
    var c = Math.round(ax + (bx - ax) * k / n) + Math.round(ay + (by - ay) * k / n) * nx; if (c === prev) continue;
    if (!N.ok[c] || Math.abs(N.Z[c] - N.Z[prev]) > NAV_DZ) return false;
    var dx = c % nx - prev % nx, dy = ((c / nx) | 0) - ((prev / nx) | 0);
    if (dx && dy && (!N.ok[prev + dx] || !N.ok[prev + dy * nx])) return false;
    prev = c;
  }
  return true;
}
/** 拉直：從每一點往前找看得到的最遠那一點（最多往前 80 點）。 */
function navSmooth(N, p) {
  var out = [p[0]], i = 0;
  while (i < p.length - 1) {
    var j = Math.min(p.length - 1, i + 80);
    while (j > i + 1 && !navSee(N, p[i], p[j])) j--;
    out.push(p[j]); i = j;
  }
  return out;
}
/** 層 a → 層 b 經過哪幾層（梯子連著的才算；走不到 ⇒ null）。 */
function lvPath(H, a, b) {
  var prev = {}, q = [a]; prev[a] = -1;
  while (q.length) {
    var u = q.shift(); if (u === b) break;
    H.ladders.forEach(function (L) { var v = L.lo === u ? L.hi : L.hi === u ? L.lo : -1; if (v >= 0 && !(v in prev)) { prev[v] = u; q.push(v); } });
  }
  if (!(b in prev)) return null;
  var p = []; for (var u = b; u >= 0; u = prev[u]) p.push(u);
  return p.reverse();
}
/** 從 from 層（x）去 to 層（目的地 tx）的走法：每換一層 ＝ 走到梯子那一頭＋爬；梯子挑「走過去＋從那裡再走＋排在前面的人」最短的那座
 *  （L.q：路上要爬這座的人數，一個人 ＝ 等 LADDER_GAP 秒 ⇒ 換算成跑得到的格數；⛔ 不算 ⇒ 開戰第一輪 26 個人全擠後梯子，10 秒只補上 2 個）。 */
function handRoute(sh, from, to, x, tx, fr, tr) {
  var H = sh.nav, S = {}, q = [], prev = {}, goal = null, k;
  // 節點 ＝ 「層:區域」；fr／tr 沒給 ⇒ 那一層哪一塊都可以（舊的叫法照常）。梯子斷了（踏板或兩頭的甲板被打掉）⇒ 這條邊不走
  if (fr !== undefined && fr >= 0) q.push(from + ':' + fr); else H.levels[from].N.regs.forEach(function (s, r) { q.push(from + ':' + r); });
  q.forEach(function (u) { prev[u] = null; });
  for (k = 0; k < q.length && goal === null; k++) {
    var u = q[k], ul = +u.split(':')[0], ur = +u.split(':')[1];
    if (ul === to && (tr === undefined || tr < 0 || ur === tr)) { goal = u; break; }
    H.ladders.forEach(function (L) {
      if (L.broken) return;
      var v = L.lo === ul && L.ra === ur ? L.hi + ':' + L.rb : L.hi === ul && L.rb === ur ? L.lo + ':' + L.ra : null;
      if (v && !(v in prev)) { prev[v] = u; q.push(v); }
    });
  }
  if (goal === null) return null;
  var path = []; for (var u2 = goal; u2 !== null; u2 = prev[u2]) path.push(u2); path.reverse();
  var legs = [];
  for (var i = 0; i + 1 < path.length; i++) {
    var a = path[i].split(':').map(Number), b = path[i + 1].split(':').map(Number), best = -1, bd = 1e9;   // 兩塊之間有好幾座梯子 ⇒ 挑「走過去＋從那裡再走＋排在前面的人」最短的
    H.ladders.forEach(function (L, j) {
      if (L.broken) return;
      var ok = (L.lo === a[0] && L.ra === a[1] && L.hi === b[0] && L.rb === b[1]) || (L.hi === a[0] && L.rb === a[1] && L.lo === b[0] && L.ra === b[1]);
      if (ok) { var d = Math.abs(x - L.x) + Math.abs(L.x - tx) + L.q * LADDER_GAP * HAND_SP[1]; if (d < bd) { bd = d; best = j; } }
    });
    var L = H.ladders[best], up = L.lo === a[0];
    legs.push({ w: a[0], to: up ? L.ia : L.ib }, { c: best, up: up }); x = L.x; L.q++;
  }
  return legs;
}
/** 這個預備水手現在在哪一層的哪一塊（走路格上最近的那一點；站在格外 ⇒ −1）。 */
function handReg(sh, c) { var N = sh.nav.levels[c.hand.lv].N, i = navSnap(N, c.pos, 4); return i >= 0 ? N.reg[i] : -1; }
/** 開戰時：建走路格、接梯子、記各職位開戰時的人數（補到這個數），在待命那一層生 sh.cw.hands 個預備水手（彼此隔 3 點以上）。 */
function makeHands(sh, crew, add) {
  sh.nav = null;
  if (sh.cw.hands <= 0 && DROWN_T <= 0) return;                               // 落水的人爬回船上也要走路格（43_swim.js board）
  var t0 = performance.now(), lads = shipLadders(sh.T), Ls = navLevels(sh, lads), LD = [], ri = {};
  (sh.ropes || []).forEach(function (r, j) { ri[r.name] = j; });       // 繩梯的橫繩 ⇒ sh.ropes 第幾條（斷不斷照它）
  Ls.forEach(function (L) { L.N = navBuild(sh, L); if (L.N.rot) L.N = navOwn(L.N, sh); });   // 有會轉的甲板 ⇒ 這艘自己一份（navPos／navSnap 照這艘的砲塔角度換）
  sh.ladDrop = [];                                                   // 尋路沒收的梯子與原因（只記，給匯入檢查報：TASK-0672「被靜悄悄丟掉的部件」）
  lads.forEach(function (l) {
    var a = l.pts[0], b = l.pts[l.pts.length - 1], dk = ladDecks(sh.T, l), tt = Ls[Ls.length - 1].tur ? Ls.length - 1 : -1;
    var la = dk ? (dk[0] ? dk[0].i : -1) : lvOf(Ls, a[2]), lb = dk ? (dk[1] ? dk[1].i : -1) : lvOf(Ls, b[2]);   // 有甲板 meta ⇒ 照 meta 判層（36_rooms.js ladDecks）
    if (tt >= 0 && lb < 0 && b[2] >= Ls[tt].zr[0] && b[2] <= Ls[tt].zr[1]) lb = tt;   // 梯頭在砲塔頂（turTopLevel）⇒ 接那一層
    if (la < 0 || lb < 0 || la === lb) { sh.ladDrop.push({ name: l.name, rope: !!l.rope, why: la < 0 && lb < 0 ? '兩頭（foot、head）都判不出在哪一層甲板' : la < 0 ? '下端（foot）判不出在哪一層甲板' : lb < 0 ? '上端（head）判不出在哪一層甲板' : '兩頭判成同一層', a: a, b: b }); return; }
    var R = dk && dk.link ? 10 : 5, ia = navSnap(Ls[la].N, a, R), ib = navSnap(Ls[lb].N, b, R);
    if (ia < 0 || ib < 0) { sh.ladDrop.push({ name: l.name, rope: !!l.rope, why: (ia < 0 ? '下端' : '上端') + '接不上那一層的走路格（' + R + ' 點內沒有能走的點）', a: a, b: b }); return; }   // 兩頭接不上走路格（10 格內；直接指定的 20 格內）⇒ 這座不用
    var mid = l.pts.slice(1, -1).map(function (q) { return [q[0], q[1], q[2] + CLIMB_LIFT]; });   // lo、hi 抬 0.2 m：兩點連線會切過踏板的前緣（量過：腳在踏板裡 24／71 點 ⇒ 10）
    var steps = l.rope ? [] : l.pts.slice(1, -1).map(function (q) { return [Math.floor(q[0]), Math.floor(q[1]), Math.floor(q[2]) - 1]; });   // 踏板：lo、hi 那一格底下（固定點是腳踩的那一格空氣）；繩梯的踏板是繩 ⇒ 照繩判（rj）
    var rj = l.rope ? l.rope.map(function (n) { return ri[n]; }).filter(function (j) { return j !== undefined; }) : null;
    LD.push({ name: l.name, part: l.part, lo: la, hi: lb, ia: ia, ib: ib, ra: Ls[la].N.reg[ia], rb: Ls[lb].N.reg[ib], steps: steps, rj: rj, broken: false, pts: [navPos(Ls[la].N, ia), a].concat(mid, [b, navPos(Ls[lb].N, ib)]), x: (a[0] + b[0]) / 2, t0: -9, n: 0, q: 0,
      ride: ladRideOf(sh.T, l, a[2], b[2]) });   // ride：繩梯綁在砲塔上 ⇒ pts 是開局的座標，爬的時候照 ladRide 換到現在（27_turret.js）
  });
  var home = -1;
  LD.forEach(function (L) { if (home < 0 || L.lo < home) home = L.lo; });
  if (home < 0) home = lvOf(Ls, sh.decks.length ? sh.decks[0].zr[0] : 0);
  if (home < 0) return;
  var H = sh.nav = { levels: Ls, ladders: LD, home: home, reach: [], gun0: {}, pm0: {}, helm0: 0, called: 0, joined: 0, ms: 0, dirty: false, reT: 0, log: [] };
  Ls.forEach(function (L, i) { if (lvPath(H, home, i)) H.reach.push(i); });
  crew.forEach(function (c) {
    if (c.role === ROLE.GUN) H.gun0[c.deck + c.side] = (H.gun0[c.deck + c.side] || 0) + 1;
    else if (c.role === ROLE.POWDER) H.pm0[c.deck] = (H.pm0[c.deck] || 0) + 1;
    else if (c.role === ROLE.HELM) H.helm0++;
  });
  var N = Ls[home].N, used = [], C0 = N.bigCells;                   // 生在待命那一層最大的那一塊（⛔ 全部的點 ⇒ 可能生在關起來的小艙裡）
  var hr = {}; LD.forEach(function (L) { if (L.lo === home) hr[L.ra] = 1; if (L.hi === home) hr[L.rb] = 1; });   // 有梯子接著的那幾塊
  if (Object.keys(hr).length && !hr[N.reg[C0[0]]]) {                  // 最大那一塊沒有梯子（憲法號、餘燼號的底艙：中段整片隔開，梯子落在前後兩塊）⇒ 生在有梯子的塊裡最大的那一塊
    var br = -1, bn = 0; Object.keys(hr).forEach(function (r) { var n = N.cells.filter(function (c) { return N.reg[c] === +r; }).length; if (n > bn) { bn = n; br = +r; } });
    if (br >= 0) C0 = N.cells.filter(function (c) { return N.reg[c] === br; });
  }
  var NH = sh.cw.hands;                                              // 船員配置（05_hull.js shipCrew：預設 ＝ HANDS × 那一型的 handsK；夜隼號 ¼：小船）
  if (C0.length) for (var k = 0; k < NH; k++) {
    var i = -1;
    for (var tries = 0; tries < 12; tries++) {
      i = C0[(rnd() * C0.length) | 0];
      var ix = i % N.nx, iy = (i / N.nx) | 0;
      if (!used.some(function (u) { return Math.abs(u % N.nx - ix) < 3 && Math.abs(((u / N.nx) | 0) - iy) < 3; })) break;
    }
    used.push(i);
    add(ROLE.HAND, navPos(N, i), null, rnd() < 0.5 ? 1 : -1);
    var c = crew[crew.length - 1]; c.art = ROLE.GUN; c.deck = Ls[home].key; c.hand = { lv: home, wait: rr(0, 6), legs: [], wp: null, k: 0, climb: null, job: null, to: null };
  }
  H.ms = performance.now() - t0;
}
/** 每一步：爬梯子、照路走、出發下一段、到了就補位；閒著 ⇒ 站一會兒再走去別處（待命那一層多、偶爾上別層）。 */
function stepHand(sh, c, dt) {
  var H = c.hand, NV = sh.nav, fast = H.job ? 1 : 0;
  if (H.climb && H.climb.R) {                                            // 爬綁在砲塔上的繩梯：在開局的座標裡走（pb），每一步照它現在的位置換過去（27_turret.js ladRide）⇒ 爬到一半砲塔轉了也不脫手
    var CL = H.climb, tb = CL.pts[CL.k], db = sub(tb, CL.pb), lb = len(db), sb = CLIMB_SP[fast] * dt;
    c.moving = true;
    if (lb <= sb) { CL.pb = tb.slice(); CL.k++; } else CL.pb = add(CL.pb, mul(db, sb / lb));
    c.pos = ladRide(sh, CL.R, CL.pb); H.to = ladRide(sh, CL.R, tb);
    if (CL.k >= CL.pts.length) {
      H.lv = CL.lv; c.deck = NV.levels[H.lv].key; H.climb = null; c.moving = false;
      if (c.backRole !== undefined) { c.role = c.backRole; c.backRole = undefined; c.hand = null; c.home = c.pos.slice(); }
    }
    return;
  }
  if (H.climb) {                                                         // 爬：沿 foot → lo → hi → head 一段一段走（三維）
    var P = H.climb.pts, to = P[H.climb.k], d = sub(to, c.pos), l = len(d), s = CLIMB_SP[fast] * dt;
    c.moving = true; H.to = to;
    if (l <= s) {
      c.pos = to.slice();
      if (++H.climb.k >= P.length) {
        H.lv = H.climb.lv; c.deck = NV.levels[H.lv].key; H.climb = null; c.moving = false;
        if (c.backRole !== undefined) { c.role = c.backRole; c.backRole = undefined; c.hand = null; c.home = c.pos.slice(); }   // 爬回船上的軍官、陸戰隊（43_swim.js board）：回原職
      }
    }
    else c.pos = add(c.pos, mul(d, s / l));
    return;
  }
  if (H.wp) {                                                            // 走：照拉直過的路一點一點走，高度跟著甲板
    var w = H.wp[H.k], dx = w[0] - c.pos[0], dy = w[1] - c.pos[1], dl = Math.hypot(dx, dy), st = HAND_SP[fast] * dt;
    c.moving = true; H.to = w;
    if (dl <= st) { c.pos = w.slice(); if (++H.k >= H.wp.length) { H.wp = null; c.moving = false; c.home = c.pos.slice(); } return; }
    c.pos[0] += dx / dl * st; c.pos[1] += dy / dl * st;
    var N = NV.levels[H.lv].N, ci = navCell(N, c.pos); if (ci >= 0 && N.Z[ci] >= 0) c.pos[2] = N.Z[ci];
    return;
  }
  c.moving = false;
  if (H.legs.length) { legStart(sh, c); return; }
  if (H.job) { handJoin(sh, c); return; }
  if (sh.struck || sh.sunk || (H.wait -= dt) > 0) return;
  wander(sh, c);
}
/** 出發下一段：走（要一次找路的額度，每艘每步 HAND_PATHS 次）或爬（梯子空出來才上）。走不到 ⇒ 整段作廢、站一會兒。 */
function legStart(sh, c) {
  var H = c.hand, NV = sh.nav, leg = H.legs[0];
  if (leg.c !== undefined) {
    var L = NV.ladders[leg.c]; if (SIMT - L.t0 < LADDER_GAP) return;
    L.t0 = SIMT; L.n++; L.q = Math.max(0, L.q - 1); H.legs.shift();
    H.climb = { pts: leg.up ? L.pts : L.pts.slice().reverse(), k: 0, lv: leg.up ? L.hi : L.lo, L: L.name + (leg.up ? '↑' : '↓') };   // L：梯子的名字（測試模式的記錄看；83_testlog.js）
    if (L.ride) { var B0 = H.climb.pts[0], m0 = ladRide(sh, L.ride, B0); H.climb.R = L.ride; H.climb.pb = [c.pos[0] - (m0[0] - B0[0]), c.pos[1] - (m0[1] - B0[1]), c.pos[2] - (m0[2] - B0[2])]; }   // 綁在砲塔上：pb ＝ 自己在開局座標裡的位置（照起點那一點的位移估）
    return;
  }
  if (sh.navN <= 0) return;
  sh.navN--;
  var t0 = performance.now(), N = NV.levels[leg.w].N, a = navSnap(N, c.pos, 4), p = a >= 0 && N.reg[a] === N.reg[leg.to] ? navPath(N, a, leg.to) : null;   // 不同塊 ⇒ 不用找（甲板被打成兩塊：TASK-0572）
  NV.pathN = (NV.pathN || 0) + 1; NV.pathMs = (NV.pathMs || 0) + performance.now() - t0;
  if (!p) { H.legs = []; H.wait = 1; return; }                          // 走不到（站在走路格外、被隔開）⇒ 放棄這一趟（有任務 ⇒ 下一拍 handJoin 照現在的層判斷）
  H.legs.shift();
  H.wp = navSmooth(N, p).map(function (i) { return navPos(N, i); }); H.k = 0;
}
// ── 船員避開露天甲板（船員配置 shelter；TASK-0637）──
// Tim 2026-10-16：「讓船員儘量不要上露天甲板（傷亡主要是這部分 這部分船員應該可以當後補去補砲塔傷亡的）」「露天甲板傷亡 主要是敵人炮擊直接打死」。
// 開了 ⇒ 預備水手閒晃不上露天那一層（最上面那層砲甲板，sh.weatherDeck）、走到那一層閒著就回待命那一層；點名補位照樣上去（callHands 不看它）。
//   船長以外的軍官開戰時就站在待命那一層（40_crew.js makeCrew）。莫尼特號預設開：露天那一層 ＝ 砲塔所在的主甲板，人住在水線下。
/** 露天那一層（走路格的第幾層；沒開 shelter、沒有 ⇒ -1）。 */
function shelterLv(sh) { return sh.cw.shelter && sh.weatherDeck && sh.deckZ ? lvOf(sh.nav.levels, sh.deckZ[sh.weatherDeck][0]) : -1; }
/** 待命那一層最大那一塊裡隨機 n 個站位（軍官用；沒有走路格 ⇒ []）。 */
function shelterSpots(sh, n) {
  var NV = sh.nav, out = []; if (!NV) return out;
  var N = NV.levels[NV.home].N, C = N.bigCells; if (!C.length) return out;
  for (var k = 0; k < n; k++) out.push(navPos(N, C[(rnd() * C.length) | 0]));
  return out;
}
/** 閒著：在待命那一層 HAND_ROAM 的機會上別層；在別層 HAND_BACK 的機會回待命那一層；其餘在這一層隨便挑一點走過去。shelter ⇒ 不上露天那一層、在那一層就回去。 */
function wander(sh, c) {
  var H = c.hand, NV = sh.nav, lv = H.lv, tl = lv, sl = shelterLv(sh);
  if (c.idleFrom) { H.wait = 1; return; }                                // 閒著的砲班放出來的（gunIdle）：站在原地待命（⛔ 閒晃 ⇒ 回艙底那一層，敵艦一轉過來要爬梯子回砲位：3 對 3 量到開火少 16%）
  if (lv === NV.home) { if (NV.reach.length > 1 && rnd() < HAND_ROAM) { var o = NV.reach.filter(function (i) { return i !== NV.home && i !== sl && !NV.levels[i].tur; }); if (o.length) tl = o[(rnd() * o.length) | 0]; } }   // 砲塔頂（turTopLevel）不去閒晃：露天、正對著砲火，點名補位才上去
  else if ((lv === sl || NV.levels[lv].tur || rnd() < HAND_BACK) && NV.reach.indexOf(lv) >= 0) tl = NV.home;
  var fr = handReg(sh, c), N = NV.levels[tl].N, to = N.cells[(rnd() * N.cells.length) | 0];
  if (tl === lv && fr >= 0) for (var t = 0; t < 6 && N.reg[to] !== fr; t++) to = N.cells[(rnd() * N.cells.length) | 0];   // 同一層 ⇒ 挑同一塊裡的點（別塊走不到）
  var legs = handRoute(sh, lv, tl, c.pos[0], navPos(N, to)[0], fr, tl === lv ? fr : N.reg[to]);
  H.wait = rr(3, 9);
  if (!legs) return;
  H.legs = legs.concat([{ w: tl, to: to }]);
}
// ── 閒著的砲班當預備水手（TASK-0722；Tim 2026-10-19：「炮在檢查射程範圍(檢查範圍會比射程寬 例如炮射角度45度 射程100m 檢查範圍可能是90度 200m 內沒有合適目標時
//    炮手轉為候補水手」「這樣候補水手就可以去補位另一邊能開火的炮」）——
// 每 IDLE.t 秒（點名那一拍；每艘的點名本來就錯開，SURVEY_PH）每一層每一舷看一次：那一組每門還在的砲，射界外再加 IDLE.arc 度、射程 × IDLE.r 裡都沒有敵艦
//   （迴旋砲、砲塔只看距離；那一組的砲全沒了也算）連續 IDLE.hold 秒 ⇒ 那一組閒著（sh.idleG[層＋舷].on）：砲手照樣守著砲，但算候補 ——
//   點名（callHands）有急的缺（pri ≤ IDLE_PRI：交戰那一舷的砲、剛回來那一組的砲、救火）而預備水手不夠 ⇒ 從閒著的組裡挑離那個缺最近的砲手，變成預備水手（c.idleFrom）派過去；
//   那一組閒著的時候點名不補它。⛔ 一閒就整組放掉 ⇒ 敵艦一轉過來那一舷要等判定＋點名＋走回砲位，量過 120 秒內「目標在射界、砲卻沒人」不減反增
//   （單挑 seed 3：63 → 221 秒）—— 預備水手在這段時間本來就補得過來，放出去的人多半站著沒事。
//   敵艦進到範圍 ⇒ 不閒了：放出去還在做雜事的收回來（已經在別的砲位上、正在扛傷員的不動），IDLE_BACK 秒內補那一組排在救火前面（pri 0.25）。
//   IDLE.r 0 ⇒ 關掉（跟以前一樣：砲班一直守著自己的砲）—— 設定檔預設開 r 2（Tim 2026-10-19）：300 秒的單挑、3 對 3 各三個種子，戰報 bearNo（目標在射界、砲卻沒人）比例 22.2% → 10.0%、開火 +13%、陣亡差不多；120 秒的量不到差別（預備水手還沒用完）。見 TASK-0722。以前只有著火才放、只放去救火（49_burn.js，014a6db）；現在跟著火無關。
var IDLE = CFG.idle || { r: 0 }, IDLE_BACK = 30, IDLE_PRI = 0.5, IDLE_RECALL = { fire: 1, pump: 1, staff: 1 };   // 收回來的雜事：救火、抽水、醫療艙值班（⛔ carry：扛到一半的傷員丟在路上）
/** 這門砲的範圍（射界外再加 IDLE.arc、射程 × IDLE.r）裡有沒有敵艦。 */
function gunHot(sh, g, foes) {
  var m = M4.pt(sh.M, g.muz[0], g.muz[1], g.muz[2]), R = gunMaxR(GUNS[g.type]) * IDLE.r, ax = g.mt ? null : gunAxis(sh, g), cone = (g.cone || 0.45) + IDLE.arc * Math.PI / 180;
  return foes.some(function (o) {
    var dx = o.center[0] - m[0], dz = o.center[2] - m[2]; if (dx * dx + dz * dz > R * R) return false;
    if (!ax) return true;
    var a = Math.atan2(dz, dx) - Math.atan2(ax[2], ax[0]); return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < cone;
  });
}
/** 每次點名（reassign、manning 之後、callHands 之前）：每 IDLE.t 秒判一次哪幾組閒著、收人（sh.idleG[層＋舷] ＝ { t0 開始閒的時間, on 閒著（候補）, back 收回來到幾秒 }）；放人在 callHands（idleTake）。 */
function gunIdle(sh) {
  if (!(IDLE.r > 0) || !sh.nav || sh.struck || sh.sunk) return;
  if (!(SIMT >= (sh.idleNext || 0))) return;
  sh.idleNext = SIMT + IDLE.t;
  var NV = sh.nav, I = sh.idleG || (sh.idleG = {}), foes = SHIPS.filter(function (o) { return isFoe(sh, o) && !isOut(o) && o.center; });
  sh.decks.forEach(function (D) {
    ['S', 'P'].forEach(function (side) {
      var key = D.key + side, R = I[key] || (I[key] = { t0: -1, on: false, back: -9 });
      var gs = sh.guns.filter(function (g) { return g.alive && !g.wet && g.deck === D.key && g.side === side; });
      if (!gs.some(function (g) { return gunHot(sh, g, foes); })) {
        if (R.t0 < 0) R.t0 = SIMT;
        if (SIMT - R.t0 >= IDLE.hold) R.on = true;
        return;
      }
      R.t0 = -1; if (!R.on) return;
      R.on = false; R.back = SIMT + IDLE_BACK;
      sh.crew.forEach(function (c) {
        if (c.idleFrom !== key) return;
        c.idleFrom = undefined;
        var J = c.role === ROLE.HAND && crewAble(c) && !c.hand.climb && c.hand.job; if (J && IDLE_RECALL[J.kind]) { c.hand.job = null; c.hand.legs = []; c.hand.wp = null; c.hand.wait = 0; }
      });
    });
  });
}
/** 閒著的組裡離 (x, lv) 最近的砲手 ⇒ 變成預備水手（同 toHand；⛔ 不叫它：它的 rr() 抽戰局的亂數）；沒有 ⇒ null。
 *  調過去就留在那一舷（Tim 2026-10-19「之後試『調過去就留在那一舷』」）：調過一次的（c.idleMoved）不再調；剛收回來的組（back 還沒到）不調 ——
 *  ⛔ 不擋 ⇒ 船一轉，兩舷輪流閒著，人在兩舷之間來回搬（量過：3 對 3 seed 11 三叉戟號 120 秒調了 105 人次）。 */
function idleTake(sh, x, lv0) {
  var I = sh.idleG, NV = sh.nav, best = null, bd = 1e9, blv = -1; if (!I) return null;
  sh.crew.forEach(function (c) {
    if (c.role !== ROLE.GUN || !crewAble(c) || c.walk || c.idleMoved) return;
    var R = I[c.deck + c.side]; if (!R || !R.on || R.back > SIMT) return;
    var lv = lvAt(sh, c.pos); if (lv < 0 || !NV.levels[lv]) return;
    var d = Math.abs(c.pos[0] - x) + 150 * Math.abs(lv - lv0); if (d < bd) { bd = d; best = c; blv = lv; }
  });
  if (!best) return null;
  var c = best, key = c.deck + c.side;
  leaveGun(c); if (c.art === undefined) c.art = c.role;
  c.role = ROLE.HAND; c.gun = null; c.walk = null; c.moving = false; c.deck = NV.levels[blv].key; c.idleFrom = key; c.idleMoved = true;
  c.hand = { lv: blv, wait: 0, legs: [], wp: null, k: 0, climb: null, job: null, to: null };
  sh.idleN = (sh.idleN || 0) + 1;
  return c;
}
/** 點名（每半秒，survey）：照開戰時的人數算每一格缺幾個，派最近的閒著的水手（交戰那一舷的砲班先、再來送藥手與舵手、另一舷最後）。 */
function callHands(sh) {
  var NV = sh.nav; if (!NV || sh.struck || sh.sunk) return;
  if (NAV_RE > 0 && NV.dirty && SIMT - NV.reT >= NAV_RE) navRefresh(sh);     // 尋路動態更新（TASK-0572）
  NV.ladders.forEach(function (L) { L.q = 0; });                       // 排隊的人數每半秒重數（倒下、放棄的路不會一直佔著）
  sh.crew.forEach(function (c) { if (c.role === ROLE.HAND && crewAble(c)) c.hand.legs.forEach(function (l) { if (l.c !== undefined) NV.ladders[l.c].q++; }); });
  var spare = !!(sh.idleG && Object.keys(sh.idleG).some(function (k) { return sh.idleG[k].on; }));   // 有閒著的砲班（gunIdle）⇒ 急的缺可以從那裡調人（idleTake）
  var idle = sh.crew.filter(function (c) { return c.role === ROLE.HAND && crewAble(c) && !c.hand.job && !c.hand.climb; }); if (!idle.length && !(sh.galley && sh.galley.going) && !spare) return;   // 伙夫還在路上（45_galley.js）⇒ 沒有閒人也照樣算缺額：缺人就把伙夫叫回來（galleyPull）；沒有廚房 ⇒ 跟以前一樣
  var idle0 = idle.length;
  var going = {}, need = [];
  sh.crew.forEach(function (c) { if (c.role === ROLE.HAND && crewAble(c) && c.hand.job) { var k = c.hand.job.kind + c.hand.job.key; going[k] = (going[k] || 0) + 1; } });
  sh.decks.forEach(function (D) {
    var lv = lvOf(NV.levels, D.zr[0]); if (NV.reach.indexOf(lv) < 0) return;
    ['S', 'P'].forEach(function (side) {
      var gs = sh.guns.filter(function (g) { return g.alive && !g.wet && g.deck === D.key && g.side === side; }); if (!gs.length) return;
      var IR = sh.idleG && sh.idleG[D.key + side]; if (IR && IR.on) return;   // 閒著的砲班（gunIdle）⇒ 不補；敵艦進來 30 秒內補砲班排在救火前面（pri 0.25）
      var want = Math.min(NV.gun0[D.key + side] || 0, gs.reduce(function (a, g) { return a + g.crewFull; }, 0));
      var have = sh.crew.filter(function (c) { return c.role === ROLE.GUN && crewAble(c) && c.deck === D.key && c.side === side; }).length;
      var n = want - have - (going['gun' + D.key + side] || 0), wx = 0, ww = 0;
      var gm = null, mm = -1;
      gs.forEach(function (g) { var m = Math.max(0, g.crewFull - g.manned); wx += g.muz[0] * m; ww += m; if (m > mm) { mm = m; gm = g; } });
      if (n > 0) need.push({ kind: 'gun', key: D.key + side, deck: D.key, side: side, lv: lv, n: n, x: ww ? wx / ww : gs[0].muz[0], pri: side === sh.side ? 0 : IR && IR.back > SIMT ? 0.25 : 2, reg: gm && sh.T.armor && sh.T.armor.length ? needReg(sh, lv, gunNavAt(sh, gm)) : undefined });   // reg：缺最多人那門砲所在的那一塊（會轉裝甲的船）
      var ti = NV.levels.length - 1, tt = NV.levels[ti];                 // 砲塔頂上的砲（turTopLevel；哨兵號頂上的速射砲）另外算：缺幾個派幾個、派去那一層（從繩梯爬上去）——
      if (tt.tur && NV.reach.indexOf(ti) >= 0) {                         //   ⛔ 跟整組一起算 ⇒ 甲板上的砲手（走不到頂上，navReach）也算在人數裡，頂上的砲班全倒了整組照樣不缺人（量過：頂上 0／6、一個都沒派）
        var tgs = gs.filter(function (g) { var q = gunNavAt(sh, g); return q[2] >= tt.zr[0] && q[2] <= tt.zr[1]; });
        var tn = tgs.reduce(function (a, g) { return a + Math.max(0, g.crewFull - g.manned); }, 0) - (going['gun' + D.key + side + '^'] || 0);
        if (tn > 0) need.push({ kind: 'gun', key: D.key + side + '^', deck: D.key, side: side, lv: ti, n: tn, x: tgs[0].muz[0], pri: 0, reg: needReg(sh, ti, gunNavAt(sh, tgs[0])) });
      }
    });
    var pm = sh.crew.filter(function (c) { return c.role === ROLE.POWDER && crewAble(c) && c.deck === D.key; }).length, pn = (NV.pm0[D.key] || 0) - pm - (going['pm' + D.key] || 0);
    var wl = pn > 0 && sh.T.armor && sh.T.armor.length, dp = wl ? deadPm(sh, D.key) : null;   // 會轉裝甲的船：走到倒下那位的家所在的那一塊；沒有倒下的可接 ⇒ 同層缺送藥手的活砲那一塊
    var pg = wl && !dp ? sh.guns.filter(function (g) { return g.alive && g.drop && gunDeck(g) === D.key && (!g.pm || !crewAble(g.pm)); })[0] : null;   // ⛔ 沒有 ⇒ reg 空著、在原地（沒有活砲的那一塊）就接上，下一輪又被 toHand 打回來（測試模式量到：同一人 0.5 秒一輪打轉 310 次）
    if (pn > 0 && sh.stations.some(function (s) { return s.deck === D.key && !s.mag.gone; })) need.push({ kind: 'pm', key: D.key, deck: D.key, lv: lv, n: pn, x: sh.T.cx, pri: 1, reg: needReg(sh, lv, dp ? dp.home : pg && pg.drop) });
  });
  var wheel = sh.models.filter(function (m) { return m.kind === 'wheel'; })[0], hd = sh.crew.filter(function (c) { return (c.role === ROLE.HELM && !crewAble(c) || c.helmHome) && !c.relieved; });   // helmHome：從甲板破洞掉下去的舵手（40_crew.js landIn），站位照原本的
  var hn = Math.min(hd.length, NV.helm0 - sh.crew.filter(function (c) { return c.role === ROLE.HELM && crewAble(c); }).length - (going.helm || 0));
  if (wheel && wheel.alive && hn > 0) {
    var hh = function (c) { return c.helmHome || c.home; }, lvh = lvAt(sh, hh(hd[0]));
    if (NV.reach.indexOf(lvh) >= 0) for (var j = 0; j < hn; j++) need.push({ kind: 'helm', key: '', lv: lvh, n: 1, x: hh(hd[j])[0], spot: hh(hd[j]), pri: 1, who: hd[j] });
  }
  sh.crew.forEach(function (c) {                                      // 槳手（TASK-0691）：倒下、掉下去的那一位 ⇒ 派一個走到他的位子接那支槳（同舵手；槳斷了就不補）
    var m = c.role === ROLE.OAR && !crewAble(c) ? c.oar : c.oarHome ? c.oarOf : null; if (!m || c.relieved || !m.alive || m.moved) return;
    var hm = c.oarHome || c.home, lvo = lvAt(sh, hm); if (NV.reach.indexOf(lvo) >= 0) need.push({ kind: 'oar', key: '', lv: lvo, n: 1, x: hm[0], spot: hm, pri: 1, who: c, oar: m });
  });
  if (pumpUrgent(sh)) { pumpNeeds(sh, need); medNeeds(sh, need); }     // 積水多（45_pumps.js pumpUrgent）⇒ 抽水機排在醫療艙前面（同 pri 1、sort 不換相對順序）
  else { medNeeds(sh, need); pumpNeeds(sh, need); }                    // 醫療艙的人手、等著被搬的傷員（44_medic.js）；人力抽水機：艙裡有水才要人（45_pumps.js）
  if (sh.burn) burnNeeds(sh, need);                                    // 救火（49_burn.js，pri 0.5：交戰那一舷的砲班之後、其他之前）；沒著過火 ⇒ 不加
  if (sh.galley) galleyNeeds(sh, need);                                // 伙夫領飯（45_galley.js，pri 3：所有補位之後）；沒有廚房 ⇒ 不加（sort 只比 pri、是穩定排序 ⇒ 其他的順序不變）
  need.sort(function (a, b) { return a.pri - b.pri; });
  need.forEach(function (q) {
    for (var k = 0; k < q.n; k++) {
      if (!idle.length) { var tk = spare && q.pri <= IDLE_PRI ? idleTake(sh, q.x, q.lv) : null; if (!tk) break; idle.push(tk); }   // 預備水手不夠、缺的是急的 ⇒ 從閒著的砲班調一個
      var bi = -1, bd = 1e9;
      idle.forEach(function (c, i) { var d = Math.abs(c.pos[0] - q.x) + 150 * Math.abs(c.hand.lv - q.lv); if (d < bd) { bd = d; bi = i; } });
      var c = idle[bi], H = c.hand, legs = handRoute(sh, H.lv, q.lv, c.pos[0], q.x, handReg(sh, c), q.cell !== undefined ? NV.levels[q.lv].N.reg[q.cell] : q.reg);   // cell：要走到的那一點（醫療艙；照它那一塊找路）；reg：補砲班、送藥手要到的那一塊（needReg）
      idle.splice(bi, 1); if (!legs) continue;
      if (q.cell !== undefined) legs.push({ w: q.lv, to: q.cell });
      if (q.kind === 'helm' || q.kind === 'oar') { var si = navSnap(NV.levels[q.lv].N, q.spot, 4); if (si < 0) continue; legs.push({ w: q.lv, to: si }); q.who.relieved = true; }
      H.job = { kind: q.kind, key: q.key, deck: q.deck, side: q.side, lv: q.lv, reg: q.reg, spot: q.spot, med: q.med, who: q.who, bed: q.bed, pump: q.pump, oar: q.oar, fire: q.fire, mess: q.mess, gal: q.gal }; medTake(q);   // mess／gal：伙夫領飯的那一桌、那一座爐灶（45_galley.js）
      H.legs = legs; H.wp = null; c.moving = false; NV.called++;
    }
  });
  if (sh.galley) galleyPull(sh, need, idle0);                          // 補位（pri < 3）比閒人多 ⇒ 還在路上的伙夫叫回來（45_galley.js）
}
/** 到了：換成那個職位（砲班 ⇒ 下一拍 reassign 分砲；送藥手 ⇒ 接倒下那位的砲；舵手 ⇒ 站到舵輪後）。不在那一層（路斷了）⇒ 任務作廢、照常閒晃。 */
function handJoin(sh, c) {
  var H = c.hand, J = H.job, NV = sh.nav;
  if (J.kind === 'staff' || J.kind === 'carry') { medJoin(sh, c); return; }
  if (J.kind === 'repair') { carpJoin(sh, c); return; }                // 木匠修東西（46_carpenter.js）
  if (J.kind === 'sail') { smJoin(sh, c); return; }                    // 帆匠補帆（47_sailmaker.js）
  if (J.kind === 'cloth') { smCloth(sh, c); return; }                  // 帆匠回帆布櫃拿帆布（47_sailmaker.js）
  if (J.kind === 'wood') { carpWood(sh, c); return; }                  // 木匠回木工台拿木材（46_carpenter.js）   // 醫療艙的人手、搬傷員（44_medic.js）
  if (J.kind === 'pump') { pumpJoin(sh, c); return; }                   // 搖抽水機（45_pumps.js）
  if (J.kind === 'fire') { burnJoin(sh, c); return; }                   // 救火（49_burn.js）
  if (J.kind === 'eat') { galleyJoin(sh, c); return; }                  // 伙夫領飯（45_galley.js；TASK-0720）
  var hr = J.reg !== undefined ? handReg(sh, c) : -1;                   // 量不到（-1）⇒ 照以前當作到了：爬進轉過的砲塔，梯頭那一點是開局時算的、吊籃已經轉走 ⇒ snap 不到（測試模式量到：同一人被派 88 次、次次作廢）
  if (H.lv !== J.lv || (hr >= 0 && hr !== J.reg)) { tlgEv(sh, c, 'void', { job: J.kind, lv: [H.lv, J.lv], reg: [hr, J.reg === undefined ? null : J.reg] }); H.job = null; H.wait = 1; return; }   // 不在那一層、確定在別塊（路斷了）⇒ 作廢；void：測試模式記一筆（83_testlog.js）
  if ((J.kind === 'gun' || J.kind === 'pm') && sh.T.armor && sh.T.armor.length && !sh.guns.some(function (g) {   // 會轉裝甲的船：這裡走得到的活砲一門都沒有 ⇒ 不接（接了下一輪 reassign 又 toHand ⇒ 打轉）
    return g.alive && !g.wet && gunDeck(g) === J.deck && (J.kind !== 'gun' || g.side === J.side) && navReach(sh, c.pos, J.kind === 'gun' ? gunNavAt(sh, g) : g.drop || g.muz);
  })) { tlgEv(sh, c, 'void', { job: J.kind, why: '這裡走得到的活砲一門都沒有' }); H.job = null; H.wait = 4; return; }
  c.walk = null; c.moving = false; c.home = c.pos.slice(); c.hand = null; NV.joined++;
  if (J.kind === 'gun') { c.role = ROLE.GUN; c.deck = J.deck; c.side = J.side; c.gun = null; return; }
  if (J.kind === 'oar') { c.role = ROLE.OAR; c.oar = J.oar; c.deck = NV.levels[J.lv].key; c.art = ROLE.GUN; if (J.who) { J.who.oarHome = undefined; J.who.oarOf = null; } return; }   // 接那支槳（TASK-0691）；自己是掉下去的那個槳手、爬回來補自己 ⇒ 之後倒下照常有人補
  if (J.kind === 'helm') { c.role = ROLE.HELM; c.deck = sh.weatherDeck; c.face = -1; c.helmHome = undefined; c.relieved = false; return; }   // 自己是掉下去的那個舵手、爬回來補自己 ⇒ 之後倒下照常有人補
  var dead = deadPm(sh, J.deck, J.lv, J.reg);
  var fell = dead ? null : sh.crew.filter(function (o) { return o.fellPm && o.fellPm.deck === J.deck; })[0];   // 從甲板破洞掉下去的送藥手（40_crew.js landIn）：接它的砲
  if (fell) { dead = { guns: fell.fellPm.guns, home: fell.fellPm.home }; fell.fellPm = null; }
  c.role = ROLE.POWDER; c.deck = J.deck; c.pm = { st: 'idle', t: 0 }; c.cart = false; c.guns = dead ? dead.guns : [];
  if (dead) { dead.relieved = true; c.home = dead.home.slice(); }
  c.guns.forEach(function (g) { if (!g.pm || !crewAble(g.pm)) g.pm = c; });
}
// ── 尋路動態更新（TASK-0572；Tim 2026-10-14：要有開關與刷新頻率）──
// 細節設定「尋路更新」NAV_RE 秒（0 ＝ 關：走路格只照開戰時的船，甲板打穿了照樣走過去、可以浮空移動 —— 以前的樣子）。
// 開：打掉的格（removeVoxel）落在哪幾層的高度範圍裡 ⇒ 記那幾層「髒了」與範圍；每 NAV_RE 秒（點名那一拍）有髒的才重算：
//   那幾層只重算髒的範圍（外擴 2 點）站不站得住、只重切碰到的連通區域（navRegionsAt）；梯子：踏板被打掉、兩頭的走路點不能走 ⇒ 斷（不再走）。
//   走路格本來是同型的船共用（記在船型上）⇒ 第一次重算先複製一份給這艘自己。
//   只管站在甲板上的人：落水的照舊沿外船殼爬上來（43_swim.js）；正在爬梯子、正在走的那一段照走完，下一段才照新的。
/** 有會轉的甲板的那一層：這艘自己一份（共用的格子照舊共用，只多帶 sh）。 */
function navOwn(O, sh) { var N = {}; for (var k in O) N[k] = O[k]; N.sh = sh; return N; }
function navDirty(sh, x, y, z) {
  var NV = sh.nav; if (!NV) return;
  NV.levels.forEach(function (L) {
    if (z < L.zr[0] - 8 || z > L.zr[1] + NAV_HEAD) return;
    L.dirty = true; NV.dirty = true;                                      // 刷新時那一層要看（梯子的踏板照樣每次刷新都查）
    var N = L.N, cx = (x - N.x0) / NAV_C, cy = y / NAV_C;                 // 走路點的高度只看它那一柱（navZ：x0 ＋ cx·NAV_C, cy·NAV_C）⇒ 打到的格剛好在取樣柱上才記那一點（TASK-0673）
    if (cx >= 1 && cy >= 1 && cx <= N.nx - 2 && cy <= N.ny - 2 && cx === Math.floor(cx) && cy === Math.floor(cy)) (L.dc || (L.dc = new Set())).add(cx + cy * N.nx);
  });
}
function navRefresh(sh) {
  var NV = sh.nav, g = navG(sh), t0 = performance.now(), ev = [];       // navG：船殼＋會轉的裝甲掃過的那一圈（24_armor.js：開戰時的走路格照 navBase ＝ T.base＋那一圈，重算也要照它；沒有裝甲 ＝ sh.grid）
  NV.reT = SIMT; NV.dirty = false;
  NV.levels.forEach(function (L, li) {
    if (!L.dirty) return; L.dirty = false;
    var dc = L.dc; L.dc = null;
    var n0 = L.N.regs.length, fresh = false;
    if (!dc && L.own) return;                                             // 打到的格都不在取樣柱上 ⇒ 這一層的走路格一點都不會變
    if (!L.own) { var O = L.N; L.Z0 = O.Z; L.N = { x0: O.x0, nx: O.nx, ny: O.ny, Z: O.Z.slice(), blk: O.blk, rot: O.rot, sh: O.sh, cid: O.cid.slice(), csz: O.csz, cmin: O.cmin }; L.own = fresh = true; }
    var N = L.N, ch = [];
    // 只重算記下來的那幾點（TASK-0673：以前重算整個外框 ⇒ 一舷齊射打在兩頭，整層從頭到尾重算＋重切區域，單次 69 ms）；
    //   高度一點都沒變 ⇒ 連通區域一定一樣 ⇒ 不重切（navRegions 只看 Z）。結果跟重算整個外框一位元不差（外框裡其他點那一柱沒被動過）。
    if (dc) dc.forEach(function (i) {
      if (N.blk[i]) return;
      var gx = N.x0 + (i % N.nx) * NAV_C, gy = ((i / N.nx) | 0) * NAV_C; if (gx >= g.sx || gy >= g.sy) return;
      var z = N.rot && N.rot[i] ? navZ(navRestG(sh, turRootK(sh.T, N.rot[i] - 1)), L.deck, L, gx, gy) : navZ(g, L.deck, L, gx, gy);   // 會轉的甲板 ⇒ 照砲塔座標（24_armor.js navRestG）
      if (z !== N.Z[i]) { N.Z[i] = z; ch.push(i); }
    });
    if (ch.length) navRegionsAt(N, ch); else if (fresh) navRegFinish(N);   // 只重切碰到變了的點的那幾塊（TASK-0673）；第一次複製、沒變 ⇒ 照舊塊重出一份
    if (N.regs.length !== n0) ev.push(L.name + ' ' + (N.regs.length > 1 ? '分成 ' + N.regs.length + ' 塊（' + N.regs.join('／') + ' 點）' : '接回一塊'));
  });
  NV.ladders.forEach(function (L) {
    var A = NV.levels[L.lo].N, B = NV.levels[L.hi].N, was = L.broken;
    L.ra = A.reg[L.ia]; L.rb = B.reg[L.ib];
    L.broken = L.ra < 0 || L.rb < 0 || L.steps.some(function (p) { return !g.get(p[0], p[1], p[2]); })
      || !!(L.rj && L.rj.filter(function (j) { return sh.ropes[j] && sh.ropes[j].dead; }).length * 2 > L.rj.length);   // 繩梯：橫繩斷了一半以上 ⇒ 斷了
    if (L.broken && !was) ev.push('梯子 ' + L.name + ' 斷了');
  });
  if (sh.med) medComps(sh);                                            // 醫療艙：走不走得到床跟著重算（44_medic.js）
  NV.refreshN = (NV.refreshN || 0) + 1; NV.refreshMs = (NV.refreshMs || 0) + performance.now() - t0;
  ev.forEach(function (e) { NV.log.push({ t: +SIMT.toFixed(1), e: e }); });
}
/** HUD 一段：預備水手（閒著的／在路上補位的）。 */
function handsText(sh) {
  if (!sh.nav) return '';
  var h = sh.crew.filter(function (c) { return c.role === ROLE.HAND && crewAble(c); }), go = h.filter(function (c) { return c.hand.job && c.hand.job.kind !== 'eat'; }).length;   // 伙夫（45_galley.js）不算補位：寫在後面 🍲 廚房那一段
  return '　預備 ' + (h.length - go) + (go ? '（補位中 ' + go + '）' : '') + carpText(sh) + smText(sh);
}
