// ───────────────────────── 船的損壞表（木匠、帆匠共用一份） ─────────────────────────
// Tim 2026-10-18：「缺損可以全船共用一份資料(不用每名木匠 帆匠計算)」「船隻可以有一份目前被破壞結構的清單(資料表) 去管理目前損壞情況」
// 一艘船一張表（sh.dmg.rows）：每一列 ＝ 一件要修的東西 { key, kind, role, pri, … }；木匠、帆匠點名時只從表裡挑（各自找路、挑近的），不再各自掃船。
//   木匠（role 'carpenter'）：
//     · 梯子 lad、通道／破洞 hole（46_carpenter.js carpScan）—— 尋路刷新（NV.refreshN 變了）才重掃（走路格只在刷新時變）；
//     · 帆的綁定點 anchor（46_carpenter.js carpAnchors）—— 帆與繩的狀態變了才重掃（同下）。
//   帆匠（role 'sailmaker'）：要補的帆 sail、要接的繩梯 rlad（47_sailmaker.js smScan）—— 帆與繩的狀態變了才重掃。
//   帆與繩的狀態（dmgRigStamp）：打掉的格（sh.lost）、木匠補回幾格、斷的繩、帆腳被打掉的繩（tCut）、掉的帆、帆的血量、破的布、還在的模型、帆匠修了多少。
//     ⛔ 少記一樣 ⇒ 表過期、帆匠看不到新的損傷（以前每次點名重算，戰局是照那樣排的；這張表要跟它挑得一模一樣）。
//   沒有木匠 ⇒ 不掃木匠那幾種；沒有帆匠 ⇒ 不掃帆匠那幾種。兩種都沒有 ⇒ 不建表。
// 讀數：__game.dmg(i)（每一列、各重掃了幾次）。
/** 這艘的表（第一次用才建）。 */
function dmgOf(sh) { return sh.dmg || (sh.dmg = { nav: -1, rig: null, comp: -1, carp: [], anc: [], sm: [], rows: [], n: {}, scans: { nav: 0, rig: 0 } }); }
/** 帆與繩的狀態：變了 ⇒ 帆匠那幾種與綁定點重掃（字串比對；每次點名一次，掃繩、帆、模型各一遍）。 */
function dmgRigStamp(sh) {
  var d = 0, t = 0, f = 0, hp = 0, torn = 0, m = 0, k, C = sh.carp, K = sh.sm;
  for (k = 0; k < sh.ropes.length; k++) if (sh.ropes[k].dead) d++;
  if (sh.tCut) for (k in sh.tCut) t++;
  for (k = 0; k < sh.sails.length; k++) { if (sh.sails[k].dead) f++; hp += sh.sails[k].hp; }
  if (sh.cl) for (k = 0; k < sh.cl.length; k++) if (sh.cl[k] && sh.cl[k].torn) torn++;
  for (k = 0; k < sh.models.length; k++) if (sh.models[k].alive) m++;
  return [sh.lost, C ? C.cells : 0, d, t, f, hp, torn, m, K ? K.hp + ':' + K.ropes + ':' + K.sails + ':' + K.lads : ''].join('|') + (sh.burn ? '|b' + sh.burn.sv : '');   // 帆的火變了（49_burn.js sv：著、熄、換帆布）⇒ 重掃；沒著過火 ⇒ 字串照舊
}
/** 表（木匠、帆匠點名時叫；過期的那幾種重掃）⇒ sh.dmg.rows。 */
function dmgRows(sh) {
  var D = dmgOf(sh), NV = sh.nav, ch = false;
  if (sh.carp && NV && D.nav !== (NV.refreshN || 0)) {
    D.nav = NV.refreshN || 0; D.scans.nav++; ch = true; sh.carp.done = {};          // done：修好的那件到下一次刷新之前不再挑
    D.carp = carpScan(sh); D.carp.forEach(function (r) { r.role = 'carpenter'; });
  }
  if (sh.carp || sh.sm) {
    var st = dmgRigStamp(sh);
    if (st !== D.rig) {
      D.rig = st; D.scans.rig++; ch = true;
      D.anc = sh.carp && NV ? carpAnchors(sh) : []; D.anc.forEach(function (r) { r.role = 'carpenter'; });
      D.sm = sh.sm ? smScan(sh) : [];
    }
  }
  if (ch) { D.rows = D.carp.concat(D.anc, D.sm); D.n = {}; D.rows.forEach(function (r) { D.n[r.kind] = (D.n[r.kind] || 0) + 1; }); }   // n：各種幾件（詳細資訊那一行直接讀）
  if (NV && D.comp !== (NV.refreshN || 0) && (D.carp.length || D.anc.length)) { D.comp = NV.refreshN || 0; medComps(sh); }   // 「層:區域」照沒斷的梯子連成幾群（44_medic.js）：木匠挑走得到的用；尋路刷新之後、有件要修才算
  return D.rows;
}
/** 表裡某一種人的那幾列。 */
function dmgFor(sh, role) { return dmgRows(sh).filter(function (r) { return r.role === role; }); }
/** 讀數（__game.dmg）：每一列（種類、誰修、先後、在哪、缺多少）、各重掃了幾次。 */
function dmgInfo(sh) {
  var D = sh.dmg; if (!D) return { rows: [], scans: { nav: 0, rig: 0 } };
  return { scans: D.scans, rows: D.rows.map(function (r) {
    var o = { key: r.key, kind: r.kind, role: r.role, pri: +(+r.pri).toFixed(3) };
    if (r.kind === 'hole') { o.lv = r.lv; o.n = r.hole.length; }
    else if (r.kind === 'lad') o.name = sh.nav.ladders[r.j].name;
    else if (r.kind === 'anchor') { o.sail = r.sail.name; o.lv = r.lv; }
    else { o.name = r.t.name; o.need = { hp: r.need.hp, ropes: r.need.ropes.length, torn: r.need.torn }; }
    return o;
  }) };
}
