// ───────────────────────── 落水求生（水淹過頭 ⇒ 浮上水面、往自己的船游、太久溺水） ─────────────────────────
// Tim 2026-10-13：水完全淹沒水手時讓他漂浮到水面上，然後可以嘗試游回船上，太久會溺水。
// Tim（TASK-0536）：主要是要處理「船沉到水中的那一段，船員還能裝填、開砲」。
// 什麼時候算「淹過頭」（drownCheck，每半秒 survey）：頭頂（腳底往上 1.7 m）低於當地的海面，而且那一層通海 ——
//   砲甲板以上（有砲門）一律通；住艙以下（封閉）⇒ 船開始沉、沉了或斷了才算 —— 之前艙內那一格的水滿了九成（粒子模式）⇒ 預備水手往上一層躲（evacuate），
//   待命的那一層也搬上去（⛔ 也當成落水 ⇒ 艙內的人穿過船殼浮到海面、再游回船邊爬上來）；
//   每 2 秒查一次（Tim：效能為主，只是避免太離譜 —— 每四次 survey 一次）、連兩次都在水下才算（⛔ 一次就算 ⇒ 暴風雨的浪頭掃過就有人平白落水）；
//   從高處掉下去（fall：桅倒、甲板被打穿、斷開的那一團）落到海裡也一樣 —— 細節設定「溺水時間」0 ⇒ 照以前（落水當場算陣亡、淹到的跟著船沉）。
//   ⚠ 船殼完好、只是艙內進水淹到人：還沒做（艙內的水面在甲板之間，往上浮會撞到上一層甲板）。
// 在水裡（c.st 5，世界座標 c.fw，跟墜落一樣不跟著船走）：先浮上來（SWIM_UP），到水面露出頭肩（腳在水面下 SWIM_SUB）、跟著浪起伏，
//   往自己的船游（SWIM_SP）：船舷水線那一點（同一個 x、靠自己這一舷）；到了 SWIM_REACH 內、船速低於 SWIM_GRAB ⇒ 沿船舷爬上最上面那層甲板（42_hands.js 的爬法），
//   軍官、陸戰隊回原職，其他人當預備水手（之後照常被派去補位）。船開得比人游得快 ⇒ 追不上。
//   自己的船在沉、沉了或斷了 ⇒ 往敵艦游（TASK-0536，Tim：可以到敵艦上變成敵方船員）：爬上去 ⇒ 從原本那艘的船員名單移到敵艦的（隊色、調度都換），
//   當敵艦的預備水手；兩艘都上不去 ⇒ 只能踩水。換邊在那一艘的每一步跑完才做（swimXfer；⛔ 邊跑 forEach 邊改陣列 ⇒ 下一個人被跳過）。
//   撐的時間 ＝ 溺水時間 × 0.6～1.2（受傷的再減半）；到了 ⇒ 溺水（算陣亡，原因「溺水」），沉下去。
// 在水裡的不算「還能動的」（降旗的死傷 % 照算）、打不到也不會被打（hurt／火槍只看甲板上的）。
var SWIM_UP = 1.2, SWIM_SP = 1.1, SWIM_SUB = 1.5, SWIM_REACH = 1.6, SWIM_HEAD = 17, SWIM_GRAB = 3;   // SWIM_GRAB：船速（m/s）超過這個抓不住船殼（⛔ 不限 ⇒ 7.7 節開著走，推下去 6 個爬回 5 個）
/** 變成在水裡（w ＝ 腳的世界座標）：離開砲與藥包；受傷的不再算在「傷」裡（在水裡另算）。 */
function toSwim(sh, c, w) {
  if (c.st === 1) { sh.wounded--; c.hurtSwim = true; }
  c.walk = null; c.moving = false; c.cart = false; leaveGun(c);
  sh.guns.forEach(function (g) { if (g.pm === c) g.pm = null; });     // 送藥手：那幾門砲改由同一層別的送藥手送（⛔ 留著 ⇒ 人換到敵艦後照樣「能動」，這幾門砲沒人送）
  c.swim = { t: 0, life: DROWN_T * rr(0.6, 1.2) * (c.hurtSwim ? 0.5 : 1), dead: false, role: c.role, no: [] };
  c.st = 5; c.fw = w.slice(); c.fv = [0, 0, 0];
  sh.swims = (sh.swims || 0) + 1;
}
/** 每 2 秒（survey 每四次一次）：頭頂連兩次在海面下、而且那一層通海的人變成在水裡；砲口連兩次在海面下的砲浸水（gunWet）。 */
function drownCheck(sh) {
  if (DROWN_T <= 0 || (sh.dkN = (sh.dkN || 0) + 1) % 4) return;           // 每 2 秒一次
  gunWet(sh);
  var open = sh.sinkingFinal || sh.sunk || sh.broken, low = sh.decks.length ? sh.decks[0].zr[0] : -1e9, fl = sh.fl;
  sh.crew.forEach(function (c) {
    if (c.st > 1) return;
    var bed = c.st === 1 && c.inBed && c.medBed, hz = bed ? BED_FACE : SWIM_HEAD;   // 躺在病床上 ⇒ 看躺著的臉（床面往上 BED_FACE），不看站著的頭頂
    var hp = [c.pos[0], c.pos[1], c.pos[2] + hz];
    if (!wetAt(sh, hp)) { c.wetN = 0; return; }                         // 33_flood.js 泡水判定（通用）
    if (open || c.pos[2] >= low) { if ((c.wetN = (c.wetN || 0) + 1) >= 2) { if (bed) bedDrown(sh, c); else toSwim(sh, c, M4.pt(sh.M, c.pos[0], c.pos[1], c.pos[2])); } return; }   // 砲甲板以上有砲門 ⇒ 通海
    if (!wetAt(sh, hp, { sea: false, inner: 0.9 })) { c.wetN = 0; return; }   // 住艙以下：艙內那一格的水滿了九成（公式模式看不到艙內的水 ⇒ 不管）
    if ((c.wetN = (c.wetN || 0) + 1) < 2) return;
    if (bed) bedDrown(sh, c);
    else if (c.role === ROLE.HAND && sh.nav) evacuate(sh, c); else toSwim(sh, c, M4.pt(sh.M, c.pos[0], c.pos[1], c.pos[2]));
  });
}
/** 病床上的傷員跟著床淹（TASK-0568；Tim 2026-10-14）：水淹過床面 ⇒ 在床上溺水（算陣亡，原因「溺水」）—— 不先搬走、不往上躲、不穿過船殼浮出去游。
 *  床空出來（medTick 收回）；床還在、水退了照樣能再躺人。 */
var BED_FACE = 3;                                                        // 躺著的臉離床面幾格（0.3 m）
function bedDrown(sh, c) {
  medRelease(c); c.wetN = 0;
  killCrew(sh, c, '溺水');
  sh.bedDrowned = (sh.bedDrowned || 0) + 1;
}
/** 艙內淹過頭的預備水手：往上一層（梯子）躲；淹了的那一層不再去（走得到的層拿掉它），待命的是那一層 ⇒ 改成上一層。在爬、在去補位的照走（補位一定往上）。 */
function evacuate(sh, c) {
  var NV = sh.nav, H = c.hand, lv = H.lv, up = -1;
  NV.reach.forEach(function (i) { if (NV.levels[i].zr[0] > NV.levels[lv].zr[1] && (up < 0 || i < up)) up = i; });
  if (up < 0) { toSwim(sh, c, M4.pt(sh.M, c.pos[0], c.pos[1], c.pos[2])); return; }
  if (NV.reach.indexOf(lv) >= 0) { NV.reach = NV.reach.filter(function (i) { return i !== lv; }); NV.flooded = (NV.flooded || []).concat([lv]); }
  if (NV.home === lv) NV.home = up;
  c.wetN = 0;
  if (H.climb || H.job || (H.legs.length && H.legs[H.legs.length - 1].w !== lv)) return;   // 已經在往上走
  var legs = handRoute(sh, lv, up, c.pos[0], c.pos[0], handReg(sh, c));
  H.wp = null; c.moving = false; H.legs = legs || []; H.wait = rr(2, 5);
}
/** 砲浸水（TASK-0536）：砲口連兩次在海面下 ⇒ 浸水（g.wet：不能裝填、不能開，砲班離開；藥箱的火藥濕了、裝好的要重裝）；連兩次在海面上 ⇒ 乾了（等送藥手送火藥再裝）。 */
function gunWet(sh) {
  sh.guns.forEach(function (g) {
    if (!g.alive) return;
    var ch = wetLatch(g, wetAt(sh, g.muz));                             // 33_flood.js 泡水判定（通用）：砲口在海面下，連兩次
    if (ch > 0) { g.box = 0; g.needCart = true; if (!(g.reload > 0)) g.reload = sh.reloadT * GUNS[g.type].reload; sh.wetGuns = (sh.wetGuns || 0) + 1; }
  });
}
/** 往哪裡游：自己的船還浮著 ⇒ 船舷水線上、同一個 x（夾在船身裡）、靠自己這一舷那一點（世界座標）；在沉、沉了、斷了 ⇒ null。 */
function boardPoint(sh, w) {
  if (sh.sinkingFinal || sh.sunk || sh.broken) return null;
  var T = sh.T, l = toLocal(sh, w), x = clamp(Math.round(l[0]), T.wl0 + 30, T.wl1 - 30), hb = T.hullHB[T.zw * T.hullTW + x] || 20, s = l[1] >= T.cy ? 1 : -1;
  return M4.pt(sh.M, x, T.cy + s * (hb + 2), T.zw);
}
/** 每一步：浮上來 → 踩水、往船游 → 到了爬上去；撐不住 ⇒ 溺水、沉下去。 */
function stepSwim(sh, c, dt) {
  var S2 = c.swim, w = c.fw, top = seaH(w[0], w[2], SIMT) - SWIM_SUB;
  S2.t += dt;
  if (S2.dead) { w[1] -= 0.8 * dt; if (S2.t > S2.life + 4) c.st = 3; return; }
  if (S2.t > S2.life) { drown(sh, c); return; }
  if (w[1] < top - 0.05) { w[1] = Math.min(top, w[1] + SWIM_UP * dt); c.fv = [0, 1, 0]; return; }
  w[1] = top + 0.06 * Math.sin(c.t * 2.4);
  if (VX) { var cf = vxFlow(w[0], w[2]); w[0] += cf[0] * dt; w[2] += cf[1] * dt; }   // 大漩渦（08_sea.js）：浮在水面就跟著水流漂（游的速度另外加在下面）
  var dst = S2.no.indexOf(sh) < 0 && boardPoint(sh, w) ? sh : null;   // 自己的船優先，上不去才往別艘（友船先、再敵船；照 SHIPS 的順序 ⇒ 一對一 ＝ 以前的敵艦）
  if (!dst) swimOthers(sh).some(function (o) { if (S2.no.indexOf(o) < 0 && boardPoint(o, w)) { dst = o; return true; } return false; });
  if (!dst) { c.fv = [0, 0, 0]; return; }
  var p = boardPoint(dst, w), dx = p[0] - w[0], dz = p[2] - w[2], d = Math.hypot(dx, dz);
  if (d < SWIM_REACH && Math.abs(dst.spd) < SWIM_GRAB) {                 // 船太快 ⇒ 抓不住，跟在旁邊游（船慢下來才爬得上去）
    if (dst === sh) { if (board(sh, c, true)) { sh.saved = (sh.saved || 0) + 1; swimNews(sh, 'back'); } else S2.no.push(sh); }
    else if (!S2.xfer) { S2.xfer = true; S2.to = dst; (sh.xfer = sh.xfer || []).push(c); }   // 別艘：這一步跑完再換名單（swimXfer）
    return;
  }
  var s = Math.min(d, SWIM_SP * dt); w[0] += dx / d * s; w[2] += dz / d * s; c.fv = [dx / d, 0, dz / d];
}
/** 溺水：算陣亡（原因「溺水」），之後沉下去 4 秒才不畫。 */
function drown(sh, c) {
  c.swim.dead = true; c.swim.t = c.swim.life; c.fv = [0, -1, 0];
  sh.dead++; sh.kills++; sh.causes['溺水'] = (sh.causes['溺水'] || 0) + 1; newsCrew(sh, c, true, '溺水');
}
/** 爬上船 sh：沿船舷往上爬到最上面那層甲板、跨進來站到走路格上那一點（42_hands.js stepHand 的爬法，船的格座標 ⇒ 跟著船走）。
 *  own（自己的船）⇒ 軍官、陸戰隊爬完回原職；其他人、還有被敵艦撈起的都當預備水手。走路格接不上（舷邊 3 m 內沒有站得住的點）⇒ 回 false、不爬。 */
function board(sh, c, own) {
  var NV = sh.nav, l = toLocal(sh, c.fw), lv = NV && sh.weatherDeck ? lvOf(NV.levels, sh.deckZ[sh.weatherDeck][0]) : -1;
  if (lv < 0) return false;
  var T = sh.T, N = NV.levels[lv].N, zr = NV.levels[lv].zr, s = l[1] >= T.cy ? 1 : -1, hb = T.hullHB[T.zw * T.hullTW + clamp(Math.round(l[0]), 0, T.hullTW - 1)] || 20;
  var ci = navSnap(N, [l[0], T.cy + s * Math.max(4, hb - 10), zr[0] + 3], 16);
  if (ci < 0) return false;
  var dest = navPos(N, ci), r = c.swim.role;
  if (c.art === undefined) c.art = r;                                   // 貼圖照原本的職位那一列（換成 HAND 之後 c.role 是 6 ＝ 船長那一列）；隊色照畫它的那艘
  c.backRole = own && (r === ROLE.OFFICER || r === ROLE.MARINE) ? r : undefined;
  c.role = ROLE.HAND; c.gun = null; c.st = 0; c.swim = null; c.hurtSwim = false; c.hp = Math.max(c.hp, CREW_HP * 0.5);   // 救上來的照常能動（傷的撐在一半）
  c.pos = [l[0], l[1], l[2]]; c.deck = NV.levels[lv].key;
  var sy = T.cy + s * (hb + 1);                                         // 先貼到船殼（水線那一層的外緣），再沿船殼往上爬、跨進來（⛔ 從游到的那一點直直往上 ⇒ 離船殼 1.8 m 的半空中爬）
  c.hand = { lv: lv, wait: rr(1, 3), legs: [], wp: null, k: 0, climb: { pts: [c.pos.slice(), [l[0], sy, l[2]], [l[0], sy, dest[2] + 3], dest], k: 0, lv: lv }, job: null, to: null };
  return true;
}
/** 那一艘的每一步跑完（stepCrew）：游到敵艦舷邊的人爬上敵艦、從這艘的名單移到敵艦的（爬不上去 ⇒ 留在水裡、不再往敵艦游）。 */
function swimXfer(sh) {
  var L = sh.xfer; sh.xfer = null;
  L.forEach(function (c) {
    var i = sh.crew.indexOf(c); if (i < 0 || c.st !== 5) return;
    var foe = c.swim.to || foeOf(sh), ally = foe && foe.team === sh.team;   // 游到的那一艘（友船 ⇒ 換到友船上，照樣當預備水手）
    c.swim.xfer = false;
    if (!foe || !board(foe, c, false)) { c.swim.no.push(foe); return; }
    sh.crew.splice(i, 1); foe.crew.push(c);
    sh.lostTo = (sh.lostTo || 0) + 1; foe.gained = (foe.gained || 0) + 1;
    if (ally) { swimNews(sh, 'ally'); swimNews(foe, 'gotAlly'); }                // 廣播：5 秒併成一行（61_hud.js swimNews／newsFlush）
    else { swimNews(sh, 'foe'); swimNews(foe, 'gotFoe'); }
  });
}
/** HUD 一段：現在在水裡的（還沒溺水的）。 */
function swimText(sh) {
  var n = sh.swims ? sh.crew.filter(function (c) { return c.st === 5 && !c.swim.dead; }).length : 0;
  return n ? '　<span style="color:#7fc8ff">落水 ' + n + '</span>' : '';
}
