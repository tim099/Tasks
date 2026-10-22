// ───────────────────────── 木匠：修梯子、補甲板破洞、恢復通道（TASK-0676 ②；Tim 2026-10-17：「然後是木工(可以修理梯子 甲板破洞 補上通道)」） ─────────────────────────
// 人數 ＝ 設施配員（36_rooms.js staffSlots；Tim 2026-10-17：「加一件木工台設施，走同一套設施配員」「然後可以有預設數量(每船最少1)」）：
//   木工台（furniture 裡 role ＝ 'bench' 那一種，擺在甲板上）每張配 staff.carpenter 位；船隻配置頁的 crew.carpenter 是全船上限。
//   擺在哪都行（Tim：「木工台不用限制擺放位置 哨兵號也放吧(艙內也可以放)」）：砲甲板、艙房（木工間 rooms.workshop，醫療艙也能擺）。
//   每船至少 furniture.bench.auto 張（最少 1）：全船（甲板＋艙房）擺的不夠 ⇒ 先在木工台那一層（benchDeck：水線以上最低那層砲甲板）自動補，
//   照抽水機的找法（45_pumps.js pumpAuto：船身中段、中線上先試）；沒有砲甲板、擺不下（哨兵號）⇒ 開戰時擺在待命那一層的中段（benchNavFill：開戰才有走路格）。
//   沒有木工台這種道具（設定檔沒寫）⇒ 照舊：crew.carpenter 就是人數、生在待命那一層（戰局跟以前一位元不差）。
// 要有走路格（42_hands.js sh.nav）才上船；開戰時生在木工台旁（走得到的話；走不到 ⇒ 待命那一層），平常跟預備水手一樣在船裡走動。
// 木材（Tim 2026-10-17：「可以參考彈藥箱機制 木工修補要消耗道具(木材?) 要跑回木工台拿」）：補一格用一份木材（c.wood）。
//   開戰時每位木匠身上帶滿 furniture.bench.carry 份；木工台存 wood 份（每張；被打壞 ⇒ 拿不到）。身上用完、又有東西要修 ⇒ 走回走得到、還有存量的那張台
//   （同一群、沿船長最近），站 CARP_WOOD_T 秒拿到滿（台上剩多少拿多少）。修的時候帶的不夠 ⇒ 補到用完為止，那一件留著、拿了木材再回來補完。
//   一張台都沒有（沒有走路格之類）或沒有木工台這種道具 ⇒ 不用木材（c.wood ＝ Infinity；跟以前一樣）。
//   手上拿著木材（41_crew_art.js heldItem 'plank'，點陣圖；跟送藥手抱藥筒同一層）：身上還有木材就拿著。
// 走路、爬梯子、找路都照預備水手那一套（42_hands.js stepHand／handRoute），只是不補砲班、不搬傷員，只接「修」的工作（job.kind ＝ 'repair'）：
//   · 梯子（優先；Tim：「木工的修復機制可以單純是還原該子模組(梯子)」）：尋路判成斷了的梯子、它那件關聯（meta kind=ladders）有格子清單（檔頭 parts[].cellRuns，
//     admin.py part_cells）⇒ 站到還接得上的那一頭，修 CARP_LAD_T 秒 ⇒ 那一件被打掉的格照開戰時全部補回來（一件裡有好幾座梯子 ⇒ 一起好）。
//     繩梯（橫繩斷了）不修：繩不是格子；沒有格子清單的舊檔 ⇒ 只補踏板那兩格。
//   · 甲板破洞（Tim：「修復甲板機制就交給妳發揮了(要考慮性能) 直接補破洞?」）：開戰時能走、現在不能走的走路點連成一個洞 ＝ 一件工作；
//     木匠站到洞邊走得到的那一點；到了才往外接洞邊還缺格子的點（carpHoleArea：被打掉一部分、還走得過去的那一圈）⇒
//     修 CARP_HOLE_T0 ＋ CARP_HOLE_K × 點數 秒 ⇒ 這一片腳下那一層（每點 NAV_C × NAV_C 格、開戰時的高度）一次補回來（木材夠的話）。
//     連著兩塊以上的洞（甲板被打成兩塊不通）先修 ＝ 恢復通道。
//   · 帆的綁定點（carpAnchors；Tim 2026-10-18：「是否可以讓木匠也去修帆的綁定點(優先度在修斷掉甲板之後 在修破洞之前」）：排在通道之後、其他洞之前。
//     補好 ⇒ 帆匠下一次點名就判得出那條繩接得回去，走去修那面帆（47_sailmaker.js smRopeOk；Tim：「修完後 帆匠要能去修這面帆(因為綁定點回來了)」）。
//   性能：要修的清單是全船一份（48_damage.js 損壞表）：梯子與洞只在尋路刷新（navRefresh，每 NAV_RE 秒、有被打到才刷）之後重掃，平常點名只是挑；修好的那件到下一次刷新之前不再挑。
//   補回來的格 ＝ 開戰時那一格的顏色（restoreVoxel：網格重建、進水、尋路跟著更新，removeVoxel 反過來）；尋路刷新之後才看得到（梯子接回去、兩塊接回一塊）。
//   細節設定「尋路更新」關（NAV_RE 0）⇒ 走路格不會變 ⇒ 看不到洞、梯子不會斷 ⇒ 木匠只會閒逛。
// 木匠倒下、陣亡 ⇒ 沒人修；掉到別層 ⇒ 照舊是木匠；落水爬回來 ⇒ 當預備水手（同其他職位）。0 人 ⇒ 戰局跟以前一位元不差（不生、不抽 rnd()）。
var CARP_LAD_T = 6, CARP_HOLE_T0 = 2, CARP_HOLE_K = 0.5;                     // 修一件梯子幾秒；補一個洞 ＝ 2 秒 ＋ 每點 0.5 秒
var CARP_WOOD_T = 3;
var CARP_ANC_UP = 20, CARP_ANC_DN = 10, CARP_ANC_T0 = 2, CARP_ANC_K = 0.25;  // 綁定點搆得到的高度（離腳下地板往上／往下幾格）；補一個 ＝ 2 秒 ＋ 每格 0.25 秒                                                          // 在木工台拿木材幾秒
/** 有人駐守、每船至少幾件的設施（自動補擺、開戰時補在待命那一層、台旁走得到的點都同一套）：木工台（木匠）、帆布櫃（帆匠，47_sailmaker.js）。 */
var STATION_ROLES = ['bench', 'loft'];
/** furniture 裡 role 是這個的第一種道具；沒有 ⇒ null。 */
function furnRoleIt(role) { for (var k in FURN) if (FURN[k].role === role) return k; return null; }
/** 木工台是哪一種道具（furniture 裡 role ＝ 'bench' 的第一種）；沒有 ⇒ null。 */
function benchIt() { return furnRoleIt('bench'); }
/** 那一型自動補木工台的那一層：水線以上最低那層砲甲板（沒有 ⇒ 最上面那層；沒有砲甲板 ⇒ null）。帆布櫃也補在這一層。 */
function benchDeck(T) { var ds = hullDeckKit(T).decks; return ds.filter(function (D) { return D.zr[0] >= T.zw; })[0] || ds[ds.length - 1] || null; }
/** 甲板 D 的擺法 items（會改它；36_rooms.js deckItems 呼叫）：D 是木工台那一層、全船擺的木工台（帆布櫃）不到預設張數 ⇒ 補到夠（木工台先補）。 */
function benchFill(T, D, items) { STATION_ROLES.forEach(function (role) { stationFill(T, D, items, furnRoleIt(role)); }); }
function stationFill(T, D, items, it) {
  var BD = it && benchDeck(T); if (!BD || deckId(BD) !== deckId(D)) return;
  var have = items.filter(function (q) { return q.it === it; }).length + benchRooms(T, it);
  hullDeckKit(T).decks.forEach(function (E) {
    if (deckId(E) === deckId(D)) return;
    var pl = deckPlan(T.id, deckId(E)); if (pl.items) have += roomCheck(T, { grid: deckGrid(T, E) }, 'deck', pl.items).items.filter(function (q) { return q.it === it; }).length;
  });
  var want = Math.max(1, Math.round(+FURN[it].auto || 1)) - have;
  if (want > 0) pumpAuto(T, D, items, it, want);
}
/** 艙房裡擺了幾張木工台（照擺法；36_rooms.js roomItems）。 */
function benchRooms(T, it) { var n = 0; hullRooms(T).forEach(function (r) { roomItems(T, r, roomPlan(T.id, r.name)).items.forEach(function (p) { if (p.it === it) n++; }); }); return n; }
/** 開戰時（carpInit／smInit，走路格建好之後）：全船的木工台（帆布櫃）還不到預設張數（沒有砲甲板、擺不下）⇒ 在待命那一層的中段補（C0：木匠會生的那一塊），也是模型（會被打）。
 *  key：存在船上的哪一格（'benches'／'lofts'）。 */
function benchNavFill(sh, it, C0, key) {
  var NV = sh.nav, B = sh[key || 'benches'] = sh[key || 'benches'] || [], want = Math.max(1, Math.round(+FURN[it].auto || 1)) - B.length, f = FURN[it], T = sh.T, N = NV.levels[NV.home].N;
  for (var k = 0; k < want && C0.length; k++) {
    var P = navPos(N, C0[Math.floor((k + 0.5) / want * C0.length)]), at = [Math.round(P[0] - f.size[0] / 2), Math.round(P[1] - f.size[1] / 2), Math.round(P[2])];
    var bb = [at[0], at[1], at[2], at[0] + f.size[0], at[1] + f.size[1], at[2] + f.size[2] + 1], nm = (NV.levels[NV.home].name || NV.levels[NV.home].key) + f.name + '-' + (B.length + 1);
    var m = { T: T, k: sh.models.length, name: nm, path: 'nav/' + nm, kind: 'furn', item: it, hold: 0, room: null, hp: f.hp, hpMax: f.hp, mesh: furnMesh(T, it, 'x'), origin: at, bb: bb, pts: {}, meta: { kind: 'furniture', item: it },
      c: [(bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2], foot: VK.pack(Math.floor(bb[0] + 1), Math.floor(bb[1] + 1), at[2] - 1), alive: true };
    sh.models.push(m); B.push(m);
    for (var bx = Math.max(0, Math.floor((bb[0] - 12) / 16)); bx <= Math.floor((bb[3] + 12) / 16); bx++) (sh.mIdx[bx] = sh.mIdx[bx] || []).push(m);   // 命中分桶（10_ship.js modelIndex 同一套）
  }
}
/** 木工台旁、從待命那一層走得到的走路點 ⇒ { lv, ci }；走不到 ⇒ null。 */
function benchSpot(sh, m) {
  var NV = sh.nav, lv = lvOf(NV.levels, m.origin[2]); if (lv < 0 || NV.reach.indexOf(lv) < 0) return null;
  var N = NV.levels[lv].N, ci = navSnap(N, [m.c[0], m.c[1], m.origin[2]], 8);
  return ci >= 0 && handRoute(sh, NV.home, lv, m.c[0], m.c[0], undefined, N.reg[ci]) ? { lv: lv, ci: ci } : null;
}
/** 待命那一層最大、有梯子接著的那一塊的走路點（木匠、帆匠生在這裡；台擺不下時也補在這裡）。 */
function carpHomeCells(sh) {
  var NV = sh.nav, N = NV.levels[NV.home].N, C0 = N.bigCells.length ? N.bigCells : N.cells, hr = {};
  NV.ladders.forEach(function (L) { if (L.lo === NV.home) hr[L.ra] = 1; if (L.hi === NV.home) hr[L.rb] = 1; });   // 有梯子接著的那幾塊（同 makeHands：憲法號、餘燼號的底艙最大那一塊沒有梯子）
  if (Object.keys(hr).length && !hr[N.reg[C0[0]]]) {
    var br = -1, bn = 0; Object.keys(hr).forEach(function (r) { var k2 = N.cells.filter(function (c) { return N.reg[c] === +r; }).length; if (k2 > bn) { bn = k2; br = +r; } });
    if (br >= 0) C0 = N.cells.filter(function (c) { return N.reg[c] === br; });
  }
  return C0;
}
/** 開戰時（makeCrew，預備水手之後）：照設施配員生木匠（上限 sh.cw.carpenter）—— 木工台旁走得到的生在台旁，其他的在待命那一層最大的那一塊（照順序平均分開，不抽 rnd()）。 */
function carpInit(sh, crew, add) {
  var NV = sh.nav, it = benchIt(), cap = it ? Math.max(1, sh.cw.carpenter || 0) : sh.cw.carpenter || 0; sh.carp = null;   // 有木工台這種道具 ⇒ 每船至少一位（舊存檔的 0 也照 1）
  if (!NV || !cap) { sh.carpWant = 0; sh.carpSlots = it ? 0 : cap; return; }
  var C0 = carpHomeCells(sh);
  if (it) benchNavFill(sh, it, C0);                                   // 甲板、艙房擺的不夠預設張數 ⇒ 待命那一層補
  var B = sh.benches || [], S = it ? staffSlots([B.length ? B : [{ item: it }]], 'carpenter') : null;   // 一張都擺不下（那一塊沒有走路點）⇒ 當作有一張
  var n = S ? Math.min(cap, S.length) : cap;                             // 沒有木工台這種道具 ⇒ 照舊（crew.carpenter 就是人數）
  sh.carpWant = n; sh.carpSlots = S ? S.length : cap;
  var at = [], hn = 0, BF = it ? FURN[it] : null;
  B.forEach(function (m) { m.spot = benchSpot(sh, m); m.wood = Math.max(0, +BF.wood || 0); });   // spot：台旁走得到的那一點（拿木材走這裡）；wood：存量
  if (B.length) NV.ladders.forEach(function (L) { L.q = 0; });          // handRoute 會記排隊人數；這裡只是試走
  for (var q = 0; q < n; q++) { var bm = S && S[q].m.origin ? S[q].m : null; at.push(bm ? bm.spot : null); if (!at[q]) hn++; }
  if (!C0.length && hn) { sh.carpWant = 0; return; }
  sh.carp = { lad: 0, holes: 0, anc: 0, cells: 0, log: [], todo: [], at: -1, done: {}, fetch: 0, used: 0 };   // fetch：拿了幾趟木材；used：從台上拿走幾份
  for (var k = 0, h = 0; k < n; k++) {
    var lv = at[k] ? at[k].lv : NV.home, i = at[k] ? at[k].ci : C0[Math.floor((h++ + 0.5) / hn * C0.length)];
    add(ROLE.CARPENTER, navPos(NV.levels[lv].N, i), null, 1);
    var c = crew[crew.length - 1]; c.art = ART_CARPENTER; c.deck = NV.levels[lv].key; c.wood = B.length ? Math.max(0, +BF.carry || 0) : Infinity;   // 身上的木材（沒有台 ⇒ 不用）
    c.hand = { lv: lv, wait: 1 + k, legs: [], wp: null, k: 0, climb: null, job: null, to: null };
  }
}
/** 補回一格（開戰時那一格的顏色）：removeVoxel（20_shatter.js）反過來 —— 網格、進水、尋路跟著更新。那一格現在已經有東西 ⇒ 不動、回 0。 */
function restoreVoxel(sh, x, y, z, col) {
  if (!col || sh.grid.get(x, y, z)) return 0;
  sh.grid.set(x, y, z, col);
  if (sh.burn) burnForget(sh, x, y, z);                                // 新木頭：沒燒過（49_burn.js）
  evEmit('cell', sh, x, y, z); sh.lost--;
  if (z < sh.T.sz) { sh.flood[z * 3]--; sh.flood[z * 3 + 1] -= y > sh.T.cy ? 1 : -1; sh.flood[z * 3 + 2] -= x > sh.T.cx ? 1 : -1; }
  if (sh.fl) floodTouch(sh, x, y, z);
  if (NAV_RE > 0 && sh.nav) navDirty(sh, x, y, z);
  return col;
}
/** 梯子那一件關聯的格（檔頭 parts[].cellRuns ⇒ 格座標，31_drive.js drvCells；同型的船共用）；沒有 ⇒ null。 */
function ladCells(T, path) {
  var C = T.ladCells || (T.ladCells = {}); if (path in C) return C[path];
  var q = (T.h.parts || []).filter(function (p) { return p.path === path; })[0];
  return (C[path] = q && q.cellRuns && q.cellRuns.length ? drvCells(T, q.cellRuns) : null);
}
/** 要修的梯子與洞（尋路刷新之後重掃；48_damage.js dmgRows）：[{ key, kind: 'lad'｜'hole'｜'anchor', lv, cell（木匠站的走路點）, pri, … }]。 */
function carpScan(sh) {
  var NV = sh.nav, out = [], G = sh.grid, T = sh.T, seen = {};
  NV.ladders.forEach(function (L, j) {
    if (!L.broken || L.rj) return;                                       // 繩梯不修（繩不是格子）
    var C = L.part ? ladCells(T, L.part) : null, key = C ? 'P' + L.part : 'L' + j;
    if (seen[key]) return;
    if (C ? drvLeft(G, C) * 3 >= C.length : L.steps.every(function (p) { return G.get(p[0], p[1], p[2]); })) return;   // 格子都還在（斷在兩頭的甲板 ⇒ 交給補洞）
    var st = L.ra >= 0 && NV.reach.indexOf(L.lo) >= 0 ? [L.lo, L.ia] : L.rb >= 0 && NV.reach.indexOf(L.hi) >= 0 ? [L.hi, L.ib] : null; if (!st) return;
    seen[key] = 1; out.push({ key: key, kind: 'lad', j: j, C: C, lv: st[0], cell: st[1], pri: 0 });
  });
  NV.levels.forEach(function (Lv, lv) {
    var N = Lv.N, Z0 = Lv.Z0; if (!Z0 || NV.reach.indexOf(lv) < 0) return;   // Z0：這一層第一次重算之前的走路格高度（42_hands.js navRefresh）；沒有 ⇒ 這一層沒被打過
    var nx = N.nx, ny = N.ny, n = nx * ny, comp = null, i, d, b;
    function nb(a, k) { var x = a % nx + NAV_DX[k], y = ((a / nx) | 0) + NAV_DY[k]; return x < 0 || y < 0 || x >= nx || y >= ny ? -1 : x + y * nx; }   // ⛔ 不用 navStep：洞（Z < 0）它一律回 −1
    for (i = 0; i < n; i++) {
      if (!(Z0[i] >= 0 && N.Z[i] < 0) || N.blk[i]) continue;
      if (!comp) comp = new Uint8Array(n);
      if (comp[i]) continue;
      var q = [i], R = {}, st = -1; comp[i] = 1;                         // 一個洞：連在一起的洞點、碰到哪幾塊、站在哪
      for (var h = 0; h < q.length; h++) for (d = 0; d < 8; d++) {
        b = nb(q[h], d); if (b < 0) continue;
        if (N.ok[b]) { R[N.reg[b]] = 1; if (st < 0) st = b; }
        else if (!comp[b] && Z0[b] >= 0 && N.Z[b] < 0 && !N.blk[b]) { comp[b] = 1; q.push(b); }
      }
      if (st >= 0) out.push({ key: 'H' + lv + ':' + i, kind: 'hole', lv: lv, cell: st, hole: q, pri: Object.keys(R).length >= 2 ? 1 : 2 });   // 連著兩塊以上 ＝ 通道
    }
  });
  return out;
}
/** 帆的綁定點（帆與繩變了才重掃；48_damage.js dmgRows）：還掛著的帆（不是旗）、綁在帆上的斷繩（s.lines）、它綁的格（r.a／r.b）被打掉了 ⇒ 一件（同一格只算一件；pri 1.5：通道之後、其他洞之前）。
 *  站在那一格旁走得到的走路點，綁定點要在腳下地板往上 CARP_ANC_UP、往下 CARP_ANC_DN 格內（舷牆、帆腳索栓、chainplate；桅頂的搆不到 ⇒ 不修）。
 *  繩的另一端（帆桁、模型）沒了或被帶走、被斷開的那一團帶走（moved）的 ⇒ 補了也接不回去 ⇒ 不修。 */
function carpAnchors(sh) {
  var NV = sh.nav, G = sh.grid, B = sh.T.base, out = [], seen = {};
  (sh.sails || []).forEach(function (s) {
    if (s.dead || s.flag) return;
    (s.lines || []).forEach(function (j) {
      var r = sh.ropes[j]; if (!(r.dead || (sh.tCut && sh.tCut[j])) || r.moved || r.never || r.unfixed) return;
      if ((r.mods || []).some(function (k) { return !sh.models[k] || !sh.models[k].alive; })) return;
      for (var e = 0; e < 2; e++) { var E = ropeEnd(r, e); if ((E.k === 'yard' || E.k === 'model') && ropeEndWhy(sh, r, e, 0)) return; }
      [r.a, r.b].forEach(function (a) {
        if (!(a >= 0) || seen[a] || hullGp(G, a)) return;
        var x = a & 2047, y = (a >> 11) & 1023, z = a >> 21, best = null; if (!B.get(x, y, z)) return;
        seen[a] = 1;
        NV.reach.forEach(function (lv) {
          var N = NV.levels[lv].N, ci = navSnap(N, [x + 0.5, y + 0.5, z], 8); if (ci < 0) return;
          var dz = z - N.Z[ci]; if (dz > CARP_ANC_UP || dz < -CARP_ANC_DN) return;
          if (!best || Math.abs(dz) < best.d) best = { lv: lv, ci: ci, d: Math.abs(dz) };
        });
        if (best) out.push({ key: 'A' + a, kind: 'anchor', a: a, sail: s, lv: best.lv, cell: best.ci, pri: 1.5 });
      });
    });
  });
  return out;
}
/** 綁定點要補的格：那一格（排第一：木材不夠也先補它）加旁邊一圈（3×3×3）開戰時有、現在沒有的 ⇒ [[x, y, z], …]。 */
function carpAncCells(sh, a) {
  var G = sh.grid, B = sh.T.base, x0 = a & 2047, y0 = (a >> 11) & 1023, z0 = a >> 21, out = [[x0, y0, z0]];
  for (var dz = -1; dz <= 1; dz++) for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
    if (!dx && !dy && !dz) continue;
    var x = x0 + dx, y = y0 + dy, z = z0 + dz; if (B.get(x, y, z) && !G.get(x, y, z)) out.push([x, y, z]);
  }
  return out;
}
/** 每次點名（survey）：閒著的木匠接一件（梯子 ＞ 通道 ＞ 帆的綁定點 ＞ 其他洞；同一級挑最近、走得到的）。 */
function carpTick(sh) {
  var NV = sh.nav, K = sh.carp; if (!K || !NV || sh.struck || sh.sunk || sh.broken) return;
  var C = sh.crew.filter(function (c) { return c.role === ROLE.CARPENTER && crewAble(c); }); if (!C.length) return;
  K.todo = dmgFor(sh, 'carpenter');                                       // 全船的損壞表（48_damage.js）：尋路刷新過才重掃梯子與洞、帆與繩變了才重掃綁定點
  if (!K.todo.length) return;
  var taken = {}; C.forEach(function (c) { if (c.hand.job) taken[c.hand.job.key] = 1; });
  for (var k in K.done) taken[k] = 1;
  C.forEach(function (c) {
    var H = c.hand; if (H.job || H.climb) return;
    var fr = handReg(sh, c), cw = fr >= 0 ? NV.comp[H.lv + ':' + fr] : undefined, legs = null, best = null; if (cw === undefined) return;   // 站在走路格外（剛爬上來、在路上）⇒ 下一次
    if (!(c.wood > 0)) { carpFetch(sh, c, fr, cw); return; }             // 身上沒木材 ⇒ 先回木工台拿
    var L = K.todo.filter(function (t) { if (taken[t.key]) return false; var N = NV.levels[t.lv].N; return NV.comp[t.lv + ':' + N.reg[t.cell]] === cw; });   // 走得到的（同一群）
    L.sort(function (a, b) { return carpD(NV, a, c) - carpD(NV, b, c); });
    for (var k = 0; k < L.length && !legs; k++) {                       // 同一群裡 handRoute 還是可能失敗（梯子正在排隊之類）⇒ 下一個
      var N = NV.levels[L[k].lv].N; best = L[k];
      legs = handRoute(sh, H.lv, best.lv, c.pos[0], navPos(N, best.cell)[0], fr, N.reg[best.cell]);
    }
    if (!legs) return;
    taken[best.key] = 1;
    H.job = { kind: 'repair', key: best.key, t: best, lv: best.lv, at: 0 };
    H.legs = legs.concat([{ w: best.lv, to: best.cell }]); H.wp = null; c.moving = false;
  });
}
/** 身上沒木材：走回同一群、還有存量、沒被打壞的木工台（沿船長最近）；一張都沒有 ⇒ 閒著。 */
function carpFetch(sh, c, fr, cw) {
  var NV = sh.nav, H = c.hand, L = (sh.benches || []).filter(function (m) { return m.alive && m.wood > 0 && m.spot && NV.comp[m.spot.lv + ':' + NV.levels[m.spot.lv].N.reg[m.spot.ci]] === cw; });
  L.sort(function (a, b) { return Math.abs(a.c[0] - c.pos[0]) + 150 * Math.abs(a.spot.lv - H.lv) - Math.abs(b.c[0] - c.pos[0]) - 150 * Math.abs(b.spot.lv - H.lv); });
  for (var k = 0; k < L.length; k++) {
    var m = L[k], N = NV.levels[m.spot.lv].N, legs = handRoute(sh, H.lv, m.spot.lv, c.pos[0], navPos(N, m.spot.ci)[0], fr, N.reg[m.spot.ci]);
    if (!legs) continue;
    H.job = { kind: 'wood', key: 'W' + m.k, m: m, lv: m.spot.lv, at: 0 };
    H.legs = legs.concat([{ w: m.spot.lv, to: m.spot.ci }]); H.wp = null; c.moving = false; return;
  }
}
/** 到了木工台（42_hands.js handJoin）：站 CARP_WOOD_T 秒 ⇒ 拿到滿（台上剩多少拿多少；台在這段時間被打壞 ⇒ 空手）。 */
function carpWood(sh, c) {
  var H = c.hand, J = H.job, m = J.m;
  if (!J.at) { if (H.lv !== J.lv) { H.job = null; H.wait = 0.5; return; } J.at = SIMT; J.T = CARP_WOOD_T / crewEff(sh, c); c.home = c.pos.slice(); return; }   // J.T：工作效率（TASK-0720，39_eff.js；沒開 ⇒ ÷ 1）到的那一刻算一次
  if (SIMT - J.at < J.T) return;
  var get = m.alive ? Math.min(Math.max(0, (+FURN[m.item].carry || 0) - c.wood), m.wood) : 0;
  m.wood -= get; c.wood += get; sh.carp.fetch++; sh.carp.used += get;
  H.job = null; H.wait = 0.5;
}
/** 挑件的距離：梯子 ＞ 通道 ＞ 帆的綁定點 ＞ 其他洞，同一級照沿船長的距離＋換層。 */
function carpD(NV, t, c) { var p = navPos(NV.levels[t.lv].N, t.cell); return t.pri * 1e6 + Math.abs(p[0] - c.pos[0]) + 150 * Math.abs(t.lv - c.hand.lv); }
/** 到了（42_hands.js handJoin）：站著修，修滿那件的秒數 ⇒ 補回去。不在那一層（路斷了）⇒ 作廢。 */
function carpJoin(sh, c) {
  var H = c.hand, J = H.job, t = J.t;
  if (!J.at) {
    if (H.lv !== J.lv) { H.job = null; H.wait = 0.5; return; }
    J.at = SIMT; c.home = c.pos.slice();
    if (t.kind === 'hole') J.area = carpHoleArea(sh, t.lv, t.hole);       // 到了才看要補多大一片（洞＋洞邊還缺格子的那一圈）
    else if (t.kind === 'anchor') J.area = carpAncCells(sh, t.a);
    J.T = (t.kind === 'lad' ? CARP_LAD_T : t.kind === 'anchor' ? CARP_ANC_T0 + CARP_ANC_K * J.area.length : CARP_HOLE_T0 + CARP_HOLE_K * J.area.length) / crewEff(sh, c);   // 修滿要幾秒：工作效率（TASK-0720，39_eff.js；沒開 ⇒ ÷ 1）到的那一刻算一次（J.area 也是這時算的；中途效率變了不追）
    return;
  }
  if (SIMT - J.at < J.T) return;
  var W = { n: c.wood, more: false }, n = t.kind === 'lad' ? carpFixLadder(sh, t, W) : t.kind === 'anchor' ? carpFixCells(sh, J.area, W) : carpFixHole(sh, t.lv, J.area, W), K = sh.carp;   // W：身上的木材（補一格用一份；用完 ⇒ more）
  c.wood -= n;
  if (n && !W.more) { if (t.kind === 'lad') { K.lad++; note(sh, '木匠修好了梯子（' + sh.nav.ladders[t.j].name.split('/').pop() + '）'); } else if (t.kind === 'anchor') { K.anc++; note(sh, '木匠補好了帆的綁定點（' + t.sail.name + '，' + n + ' 格）'); } else { K.holes++; note(sh, '木匠補好了甲板破洞（' + (sh.nav.levels[t.lv].name || sh.nav.levels[t.lv].key) + '，' + n + ' 格）'); } }   // Tim 2026-10-18：「木匠跟帆匠修補完成可以廣播」
  K.cells += n;
  K.log.push({ t: +SIMT.toFixed(1), what: t.kind, key: t.key, n: n, more: W.more }); if (!W.more) K.done[t.key] = 1;   // 木材不夠補完 ⇒ 那一件留著（拿了木材再來）
  H.job = null; H.wait = 0.5;
}
/** 梯子：那一件關聯被打掉的格全部補回來（沒有格子清單 ⇒ 只補踏板）⇒ 補了幾格。 */
function carpFixLadder(sh, t, W) {
  var B = sh.T.base, n = 0, C = t.C;
  function one(x, y, z) { var col = B.get(x, y, z); if (!col || sh.grid.get(x, y, z)) return; if (n >= W.n) { W.more = true; return; } if (restoreVoxel(sh, x, y, z, col)) n++; }
  if (C) { for (var i = 0; i < C.length; i += 3) one(C[i], C[i + 1], C[i + 2]); }
  else sh.nav.ladders[t.j].steps.forEach(function (p) { one(p[0], p[1], p[2]); });
  return n;
}
/** 一個洞要補的走路點：洞本身（走不過去的點），再往外接連著的、腳下那一層還缺格子的點（8 方向）。
 *  Tim 2026-10-18：「修理甲板破洞後會有遺漏部分(只補了一部份) 希望能改成一次補好(材料足夠的話)」—— 洞邊被打掉一部分、還走得過去的點不算洞（carpScan），
 *  以前只補洞那幾點 ⇒ 修完洞邊留一圈坑（量過：半徑 4 的坑甲板那一層缺 49 格，修完還剩 33）。只看被打過的那一片，不掃整層。 */
function carpHoleArea(sh, lv, hole) {
  var Lv = sh.nav.levels[lv], N = Lv.N, Z0 = Lv.Z0, B = sh.T.base, G = sh.grid, nx = N.nx, ny = N.ny, q = [], seen = {};
  function zOf(i) { return (Z0 ? Z0[i] : N.Z[i]) - 1; }
  function gap(i, z) {
    var gx = N.x0 + (i % nx) * NAV_C, gy = ((i / nx) | 0) * NAV_C;
    for (var dy = 0; dy < NAV_C; dy++) for (var dx = 0; dx < NAV_C; dx++) if (B.get(gx + dx, gy + dy, z) && !G.get(gx + dx, gy + dy, z)) return true;
    return false;
  }
  hole.forEach(function (i) { seen[i] = 1; q.push([i, zOf(i)]); });
  for (var h = 0; h < q.length; h++) for (var d = 0; d < 8; d++) {
    var x = q[h][0] % nx + NAV_DX[d], y = ((q[h][0] / nx) | 0) + NAV_DY[d], b = x + y * nx;
    if (x < 0 || y < 0 || x >= nx || y >= ny || seen[b]) continue;
    var z = zOf(b); if (!(z >= 0)) z = q[h][1];                          // 開戰時就走不過去的點（艙口、絞盤底下）：沒有自己的高度 ⇒ 照旁邊那一點的甲板高度
    seen[b] = 1; if (z >= 0 && gap(b, z)) q.push([b, z]);
  }
  return q;
}
/** 綁定點：carpAncCells 的每一格照開戰時的船補回來 ⇒ 補了幾格。 */
function carpFixCells(sh, cells, W) {
  var B = sh.T.base, n = 0;
  cells.forEach(function (p) {
    if (W.more) return;
    var col = B.get(p[0], p[1], p[2]); if (!col || sh.grid.get(p[0], p[1], p[2])) return;
    if (n >= W.n) { W.more = true; return; }
    if (restoreVoxel(sh, p[0], p[1], p[2], col)) n++;
  });
  return n;
}
/** 洞：carpHoleArea 的每一點 [走路點, 甲板那一層的 z]，那一層的 NAV_C × NAV_C 格照開戰時的船補回來 ⇒ 補了幾格。 */
function carpFixHole(sh, lv, cells, W) {
  var N = sh.nav.levels[lv].N, B = sh.T.base, n = 0;
  cells.forEach(function (e) {
    var i = e[0], z = e[1]; if (!(z >= 0)) return;
    var gx = N.x0 + (i % N.nx) * NAV_C, gy = ((i / N.nx) | 0) * NAV_C;
    for (var dy = 0; dy < NAV_C; dy++) for (var dx = 0; dx < NAV_C; dx++) {
      var col = B.get(gx + dx, gy + dy, z); if (!col || sh.grid.get(gx + dx, gy + dy, z)) continue;
      if (n >= W.n) { W.more = true; return; }
      if (restoreVoxel(sh, gx + dx, gy + dy, z, col)) n++;
    }
  });
  return n;
}
/** 讀數（__game.carp）：木工台（中心、還在不在、走得到的點、存量）、木匠 { want, slots, cap }、每位木匠在哪一層、身上的木材、離最近的木工台幾格；修好幾件（梯子、洞、綁定點）、拿了幾趟。 */
function carpInfo(sh) {
  var B = sh.benches || [], C = sh.crew.filter(function (c) { return c.role === ROLE.CARPENTER; }), K = sh.carp;
  return { want: sh.carpWant || 0, slots: sh.carpSlots || 0, cap: sh.cw.carpenter || 0, lad: K ? K.lad : 0, holes: K ? K.holes : 0, anc: K ? K.anc : 0, cells: K ? K.cells : 0, fetch: K ? K.fetch : 0, used: K ? K.used : 0,
    benches: B.map(function (m) { return { name: m.name, c: m.c.map(Math.round), alive: m.alive, reach: !!m.spot, wood: m.wood }; }),
    crew: C.map(function (c) { return { deck: c.deck, st: c.st, wood: isFinite(c.wood) ? c.wood : null, job: c.hand && c.hand.job ? c.hand.job.kind : null, near: B.length ? Math.round(Math.min.apply(null, B.map(function (m) { return Math.hypot(c.pos[0] - m.c[0], c.pos[1] - m.c[1]); }))) : null }; }) };
}
/** HUD 一段：木匠（在修／拿木材、還能動、修好的梯子與洞、台上還剩幾份木材）。 */
function carpText(sh) {
  if (!sh.carp) return '';
  var C = sh.crew.filter(function (c) { return c.role === ROLE.CARPENTER && crewAble(c); }), w = C.filter(function (c) { return c.hand.job && c.hand.job.kind === 'repair'; }).length, g = C.filter(function (c) { return c.hand.job && c.hand.job.kind === 'wood'; }).length;
  var B = sh.benches || [], left = B.reduce(function (a, m) { return a + (m.alive ? m.wood : 0); }, 0);
  return '　木匠 ' + C.length + (w ? '（修 ' + w + '）' : '') + (g ? '（拿木材 ' + g + '）' : '') + (sh.carp.lad || sh.carp.holes || sh.carp.anc ? '　修好 梯 ' + sh.carp.lad + '、洞 ' + sh.carp.holes + (sh.carp.anc ? '、綁定點 ' + sh.carp.anc : '') : '') + (B.length ? '　木材 ' + left : '');
}
