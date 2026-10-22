// ───────────────────────── 希臘火（TASK-0693，持火號 dromon） ─────────────────────────
// Tim 2026-10-18：「武器部分套用大炮規格 不過之後會需要新增彈種 希臘火」；
//   「點燃機制我也還要想(還要搭配滅火) 可以先直接給予傷害就好」「傷害&噴火演出」⇒ 第一版：直接傷害＋噴火演出（不留燃燒點、不延燒）。
// Tim 2026-10-18（TASK-0717）：「可以趁現在空檔 加一下著火效果(希臘火可以讓木材起火) 火會延燒 然後船員會去滅火」「帆也可以燒起來(可以嘗試真的燒掉帆的演出 出現邊緣焦黑以及逐漸燒掉)」
//   ⇒ 點燃、延燒、燒穿、滅火、燒帆都在 49_burn.js（演出 59_burnfx.js）；這裡潑開時叫 burnSplash。細節設定「火勢」0（?burn=0）⇒ 照第一版。
// 史料：Leo VI《Taktika》艏部的 siphon；Haldon 2002 全尺寸實測噴約 15 m（遊戲射程放寬到 ~30 m：砲種表 siphon 的 V 26 m/s，21_gunnery.js gunMaxR）。
// 彈種序號 AMMO_GF（3）：⛔ 不在 AMMO（玩家換彈的三種）裡 —— 只有砲種表 ammo=greekfire（或模型 meta ammo=greekfire）的砲打它（10_ship.js gunAmmoFix）；
//   倍率在 config/game.json 的 fire.k（對砲／對帆／對人，%），潑開的半徑 fire.r（格）。
// 一發希臘火（21_gunnery.js stepBall）碰到什麼就潑開，⛔ 不開洞、不穿透：
//   · 模型：直接命中扣血（damageModel × 對砲倍率）＋潑開（下面）
//   · 船殼／甲板：潑開 —— 半徑 r 裡的人燒傷（crewHurt，基準 ＝ 1.4 × 每發傷害 × 對人倍率）、帆扣血、細繩燒斷（cutRig，對帆倍率）、
//     木頭著火（burnSplash：半徑 burn.ign 格裡照材質的 flammable；旁邊 burn.sailR 格內的帆也著 —— 49_burn.js）；飛過帆 ⇒ 帆著火、不撕洞（cutRig）
//   · 水面：沒了（只有演出）
// 演出（只給人看，走特效自己的亂數 rrX／gaussX ⇒ 不改戰局）：開火 ⇒ 噴口一道火舌；飛的途中 ⇒ 火團＋拖尾（60_render.js）與零星火星；碰到 ⇒ 一團火炸開＋黑煙。
var AMMO_GF = 3;
/** 潑開：船 sh 的格座標 L（b：那一發）。 */
function gfSplash(sh, L, b) {
  var R = CFG.fire.r;
  crewHurt(sh, L, R * 0.5, R * 1.5, null, '燒傷', crewBase(b));
  cutRig(sh, L, R, b);
  burnSplash(sh, L, b);                                                 // 點火（49_burn.js；火勢 0 ⇒ 不點）
  evEmit('gfBurst', M4.pt(sh.M, L[0], L[1], L[2]), sh.vel);
}
// ── 演出 ──
/** 開火：噴口 mw、方向 dir、船速 vel ⇒ 一道往前張開的火舌（0.3–0.8 秒）。 */
function gfJetFx(mw, dir, vel) {
  for (var i = 0; i < 90; i++) {
    var sp = rrX(7, 27), spread = sp < 13 ? 0.2 : 0.09;
    var v = add(add(mul(dir, sp), [gaussX() * sp * spread, gaussX() * sp * spread + rrX(0, 2), gaussX() * sp * spread]), vel);
    var hot = rrX(0, 1);
    fxPt(add(mw, mul(dir, rrX(0, 1.2))), v, rrX(0.4, 0.9), [1, 0.3 + 0.55 * hot, 0.03 + 0.25 * hot], 1, rrX(0.6, 1.2), rrX(2.2, 4.2), -1.2, 0.45, 1);
  }
  for (var j = 0; j < 2; j++) fxPt(add(mw, mul(dir, rrX(3, 6))), add(add(mul(dir, rrX(2, 5)), [gaussX() * 0.6, rrX(1, 2.5), gaussX() * 0.6]), vel), rrX(1.5, 3) / smokeK(), [0.22, 0.2, 0.19], 0.45, rrX(1, 2), rrX(4, 6), -0.08, 1, 0);
}
/** 飛的途中：零星火星（stepBall 每隔幾步發一次）。 */
function gfTrailFx(p, v) {
  for (var i = 0; i < 6; i++) fxPt(p, add(mul(v, rrX(0.05, 0.35)), [gaussX(), gaussX() + 0.8, gaussX()]), rrX(0.2, 0.5), [1, rrX(0.35, 0.75), 0.06], 0.95, rrX(0.6, 1.1), rrX(1.2, 2.2), -1, 2, 1);
}
/** 碰到：一團火往外炸開、往上翻，接著黑煙。 */
function gfBurstFx(p, vel) {
  for (var i = 0; i < 40; i++) {
    var v = add([gaussX() * 4, rrX(1, 6), gaussX() * 4], vel), hot = rrX(0, 1);
    fxPt([p[0] + gaussX() * 0.4, p[1] + rrX(0, 0.4), p[2] + gaussX() * 0.4], v, rrX(0.4, 1.1), [1, 0.3 + 0.5 * hot, 0.04 + 0.2 * hot], 1, rrX(0.6, 1.2), rrX(1.6, 3.2), -2.5, 1.6, 1);
  }
  for (var j = 0; j < 4; j++) fxPt([p[0], p[1] + 0.8, p[2]], add([gaussX() * 0.8, rrX(1.5, 3), gaussX() * 0.8], vel), rrX(2, 4) / smokeK(), [0.18, 0.16, 0.15], 0.5, rrX(1, 1.8), rrX(4, 7), -0.08, 1, 0);
  sfx('crack', p, 0.5);
}
evOn('gfJet', gfJetFx, 0, true); evOn('gfTrail', gfTrailFx, 0, true); evOn('gfBurst', gfBurstFx, 0, true);
// ───────────────────────── 火箭（弩砲；Tim 2026-10-18：「是否可以讓弩炮改發射火箭(有點燃效果) 不然目前威力太弱了」）─────────────────────────
// 彈種 firebolt（10_ship.js AMMO_FIRE）：照弩箭飛、照實心彈咬進去（穿透、開洞照舊），第一次碰到船（模型或船殼）那一點著火（b.lit 之後不再點）：
//   半徑 fire.arrow 格（設定檔；沒寫 ＝ 6）裡的人燒傷（基準照希臘火：1.4 × 每發傷害 × fire.k 對人）、帆扣血、細繩燒斷；一小團火＋煙（演出）；
//   木頭著火（TASK-0717 的 49_burn.js burnSplash，Tim 2026-10-19「把 kaguya/fire 合進 dev，再把火箭接上它的點火（小半徑）」）：點火半徑 fire.arrowIgn 格（沒寫 ＝ 3，希臘火 10）、
//   旁邊 fire.arrowSail 格（沒寫 ＝ 4）內的帆也著 ⇒ 之後照延燒、燒穿、滅火那一套（火勢 0 ⇒ 不點）。飛過帆 ⇒ 打個小洞、帆從那一點燒起來（21_gunnery.js cutRig）。
function fireArrowHit(sh, L, b) {
  b.lit = true;
  var R = CFG.fire.arrow > 0 ? CFG.fire.arrow : 6;
  crewHurt(sh, L, R * 0.5, R * 1.5, null, '燒傷', 1.4 * b.dmg * ammoK(AMMO_GF, VS_CREW));
  cutRig(sh, L, R, b);
  burnSplash(sh, L, b, CFG.fire.arrowIgn > 0 ? CFG.fire.arrowIgn : 3, CFG.fire.arrowSail > 0 ? CFG.fire.arrowSail : 4);   // 點火（49_burn.js；小半徑）
  evEmit('arrowFire', M4.pt(sh.M, L[0], L[1], L[2]), sh.vel);
}
/** 火箭碰到：一小團火往上竄＋一縷煙（只是演出，特效自己的亂數）。 */
function arrowFireFx(p, vel) {
  for (var i = 0; i < 14; i++) {
    var hot = rrX(0, 1);
    fxPt([p[0] + gaussX() * 0.2, p[1] + rrX(0, 0.3), p[2] + gaussX() * 0.2], add([gaussX() * 1.2, rrX(1, 3.5), gaussX() * 1.2], vel), rrX(0.4, 1), [1, 0.3 + 0.5 * hot, 0.04 + 0.2 * hot], 1, rrX(0.4, 0.8), rrX(1, 2), -2, 1.6, 1);
  }
  fxPt([p[0], p[1] + 0.5, p[2]], add([gaussX() * 0.5, rrX(1, 2), gaussX() * 0.5], vel), rrX(1.5, 3) / smokeK(), [0.2, 0.18, 0.17], 0.4, rrX(0.8, 1.4), rrX(2.5, 4), -0.08, 1, 0);
}
evOn('arrowFire', arrowFireFx, 0, true);
