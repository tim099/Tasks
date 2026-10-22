// ───────────────────────── 砲長：瞄準模式與策略（Tim 2026-10-12） ─────────────────────────
// 瞄準模式：水線（敵艦「現在」的水線 ⇒ 浮高了就跟著往下）／砲甲板／帆具／甲板人員／彈藥庫（彈藥庫頂離水面 1 m 內才有意義），各配合適的彈種。
// 砲長（每艘一個，細節設定可選、預設隨機）：每隔幾秒照局勢替每個模式打分 ＝ 偏好 × 局勢 × 隨機 ±15%，最高的那個比現在的高兩成才換，換的時候上方廣播。
//   戰鬥中會換著打（Tim：不是固定用一種）：同一個模式打久了分數慢慢打折（45 秒折到一半）；現在這個模式打了沒用（局勢 ≈ 0：桅都倒了…）就馬上換。
//   局勢：水線 ＝ 0.6 ＋ 敵艦浮高（1.2 m 加滿 2.4）＋ 敵艦進水（4 m 加滿 0.4）—— Tim：敵艦浮高時改瞄水線；
//         砲甲板 ＝ 0.2 ＋ 0.8 × 敵艦還有人操作的砲比例；帆具 ＝ 還站著的桅比例 × 帆面積比例；甲板人員 ＝ 0.2 ＋ 0.8 × 還能動的人比例；
//         彈藥庫 ＝ 最淺那間的頂離水面 d：露出水面 3、1 m 內 3 × (1 − d)、更深 0（火藥拉滿不會爆 ⇒ 0）。
// 我艦手動時：Q 循環瞄準模式（點敵艦 ⇒ 回到自由）；瞄的是那個模式的中心點（不抽亂數 ⇒ HUD 每一格算也不影響戰局）。自動開砲 ⇒ 交給我艦的砲長。
var AIM_MODES = ['water', 'hull', 'rig', 'deck', 'mag'], AIM_CYCLE = ['free', 'water', 'hull', 'rig', 'deck', 'mag'];
var AIM_NAME = { free: '自由', water: '水線', hull: '砲甲板', rig: '帆具', deck: '甲板人員', mag: '彈藥庫' };
var CAPTAINS = {
  steady: { name: '穩健派', tip: '照局勢平均分配', think: 10, w: { water: 1.2, hull: 1.2, rig: 0.8, deck: 0.6, mag: 1.5 } },
  sink: { name: '擊沉派', tip: '專打水線，敵艦浮高就追著水線打', think: 8, w: { water: 2.2, hull: 0.7, rig: 0.4, deck: 0.4, mag: 2.0 } },
  mast: { name: '拆桅派', tip: '先拆桅讓對方跑不動，再打水線', think: 8, w: { water: 0.8, hull: 0.6, rig: 2.4, deck: 0.5, mag: 1.2 } },
  kill: { name: '殺傷派', tip: '打砲甲板與甲板上的人，讓對方開不了砲', think: 8, w: { water: 0.6, hull: 1.6, rig: 0.4, deck: 2.0, mag: 1.0 } },
  gamble: { name: '賭徒', tip: '彈藥庫一靠近水面就全押上去', think: 6, w: { water: 1.0, hull: 0.8, rig: 0.6, deck: 0.6, mag: 5.0 } }
};
var CAP_KEYS = Object.keys(CAPTAINS), AIM_P = 'free';   // AIM_P：我艦手動的瞄準模式（重開時保留）
/** 開局：每艘挑一個砲長（細節設定的；隨機 ⇒ 抽種子亂數）。 */
function pickCaptains() { SHIPS.forEach(pickCaptain); }
/** 一艘的砲長（開局每艘、候補進場時那一艘；52_fleet.js spawnReserve）。 */
function pickCaptain(sh) {
  var k = sh.i === PLAYER_I ? CAP_SET[0] : sh.team !== playerTeam() ? CAP_SET[1] : 'random'; if (!CAPTAINS[k]) k = CAP_KEYS[(rnd() * CAP_KEYS.length) | 0];   // 細節設定的兩格：我艦／敵船（友船隨機）
  sh.cap = k; sh.aimMode = null; sh.capT = -99; sh.pMode = sh.i === PLAYER_I ? AIM_P : 'free';
}
/** 敵艦現在的水線（格座標的 z）：設計水線 ＋ 進水 − 浮高 − 浪。 */
function wlZ(foe) { return foe.T.zw + (foe.sink - foe.lift - foe.bob) / S; }
/** 最淺那間還在的彈藥庫：{ mag, d（頂離水面幾公尺，負 ＝ 露出水面）}；沒有 ⇒ null。 */
function magNear(foe) {
  var wl = wlZ(foe), best = null;
  (foe.mags || []).forEach(function (m) { if (m.gone) return; var d = (wl - m.box[5]) * S; if (!best || d < best.d) best = { mag: m, d: d }; });
  return best;
}
/** 每個模式的局勢分數（0 ＝ 打了沒用）。 */
function aimValue(foe, mode) {
  if (mode === 'water') return 0.6 + 2.4 * clamp(foe.lift / 1.2, 0, 1) + 0.4 * clamp(foe.sink / 4, 0, 1);
  if (mode === 'hull') return 0.2 + 0.8 * (foe.gunsManned || 0) / Math.max(1, foe.guns.length);
  if (mode === 'rig') return (foe.mastsUp || 0) / Math.max(1, foe.masts.length) * foe.sailFrac;   // 照那艘有幾根桅（夜隼號 2）
  if (mode === 'deck') return 0.2 + 0.8 * (foe.able || 0) / Math.max(1, foe.crew0);
  if (mode === 'mag') { if (powderNever()) return 0; var n = magNear(foe); return !n ? 0 : n.d <= 0 ? 3 : n.d < 1 ? 3 * (1 - n.d) : 0; }
  return 0;
}
/** 砲長想一想：該換模式就換、廣播一則。艦長的命令（sh.gOrd，54_helm.js helmGunOrder）：那個模式的偏好 × GUN_ORD_K；命令一換就馬上重想（不等 think 秒）。 */
var GUN_ORD_K = 2.5, GUN_ORD_T = 6;                                       // 艦長點名的模式偏好 × 2.5；命令至少隔 6 秒才換（邊界上抖不洗版）
function captainThink(sh, foe) {
  var C = CAPTAINS[sh.cap]; if (!C) return;
  var o = typeof helmGunOrder === 'function' ? helmGunOrder(sh, foe) : null, om = o ? o.m : null;
  if (om !== (sh.gOrd || null) && SIMT - (sh.gOrdT || -1e9) >= GUN_ORD_T) {   // 艦長換了命令 ⇒ 記下來、砲長馬上重想
    sh.gOrd = om; sh.gOrdT = SIMT; sh.capT = -1e9;
    if (o) helmSay(sh, 'gun', '要砲長打' + AIM_NAME[om] + '（' + o.why + '）', false);
  }
  if (SIMT - sh.capT < C.think) return;
  sh.capT = SIMT;
  var tired = sh.aimMode ? Math.max(0.5, 1 - (SIMT - sh.modeT) / 90) : 1, sc = {}, best = null, bs = -1;   // 打久了會膩：45 秒折到一半
  AIM_MODES.forEach(function (m) { var v = aimValue(foe, m), s = C.w[m] * (m === sh.gOrd ? GUN_ORD_K : 1) * v * rr(0.85, 1.15) * (m === sh.aimMode ? tired : 1); sc[m] = v > 0 ? s : 0; if (sc[m] > bs) { bs = sc[m]; best = m; } });
  var cur = sh.aimMode ? sc[sh.aimMode] : -1;
  if (best === sh.aimMode || (sh.aimMode && cur > 0.05 && bs < cur * 1.2)) return;
  var first = !sh.aimMode; sh.aimMode = best; sh.modeT = SIMT; sh.modes = (sh.modes || 0) + 1;
  var why = best === sh.gOrd ? '艦長的命令' : best === 'water' && foe.lift > 0.3 ? '敵艦浮高 ' + foe.lift.toFixed(1) + ' m' : best === 'mag' ? (function (n) { return n.d <= 0 ? '彈藥庫露出水面' : '彈藥庫離水面 ' + n.d.toFixed(1) + ' m'; })(magNear(foe)) : !first && tired < 0.75 ? '換個打法' : '';
  note(sh, '砲長（' + C.name + '）：' + (first ? '先瞄' : '改瞄') + AIM_NAME[best] + (why ? '（' + why + '）' : ''), best === 'mag');
}
/** 那個模式要瞄哪裡（敵艦的格座標）；rand ⇒ 在範圍裡亂挑一點（電腦），否則中心點（我艦手動，不抽亂數）。
 *  ⛔ 彈種不在這裡挑了（以前照模式抽籤：水線全實心、砲甲板 30% 爆裂、帆具 70% 鏈彈 ⇒ 停在水線就整場不換）⇒ 照瞄準點的位置挑（gunnerAmmo）。 */
function modeAim(foe, mode, rand) {
  function R(a, b) { return rand ? rr(a, b) : (a + b) / 2; }
  var wl = wlZ(foe), CY = foe.T.cy, WL_X0 = foe.T.wl0, WL_X1 = foe.T.wl1, xm = (WL_X0 + WL_X1) / 2;
  if (mode === 'mag') {
    var n = magNear(foe); if (n) return { t: [R(n.mag.box[0] + 4, n.mag.box[3] - 4), CY, wl + R(0.5, 4)] };
    mode = 'water';
  }
  if (mode === 'water') return { t: [R(WL_X0 + 40, WL_X1 - 40), CY, wl + R(1, 9)] };                 // 水面上 0.1–0.9 m（砲彈碰到水就沒了）
  if (mode === 'rig') {
    var masts = foe.masts.filter(function (m) { return m.up; });
    if (masts.length) { var m = rand ? masts[(rnd() * masts.length) | 0] : masts.reduce(function (a, b) { return Math.abs(b.x - xm) < Math.abs(a.x - xm) ? b : a; }); return { t: [m.x, CY, R(foe.T.geo.rigAim[0], foe.T.geo.rigAim[1])] }; }
    mode = 'hull';
  }
  if (mode === 'deck') {
    var on = foe.crew.filter(function (c) { return c.st === 0 && (c.deck === foe.weatherDeck || c.role === ROLE.MARINE || c.role === ROLE.OFFICER || c.role === ROLE.HELM); });
    if (on.length) { var c = rand ? on[(rnd() * on.length) | 0] : on[0]; return { t: [rand ? c.pos[0] : xm, CY, c.pos[2] + 10] }; }
    mode = 'hull';
  }
  return { t: [R(WL_X0 + 60, WL_X1 - 60), CY, R(foe.T.geo.deckAim[0], foe.T.geo.deckAim[1])] };   // 砲甲板（高度照船型，05_hull.js GEO0）
}
// ───────────────────────── 照瞄準位置挑彈種（Tim 2026-10-18：「開啟自動開炮後應該要根據瞄準位置換彈種」） ─────────────────────────
// Tim 同一天：「之後預計會加新的彈種(不同船隻可以有自己的炮彈類型 每種炮彈會有一些標記 例如對帆傷害 對船員傷害 對船殼傷害 飛行速度 等資訊) 炮長AI要能支援不同彈種(而非固定三種)」
//   ⇒ 砲長不認彈種的名字，只看每一種的屬性（ammoProps）；挑的範圍是那艘打得出的（61_hud.js ammoOf）。新彈種只要在 AMMO_TAG 補一列、AMMO_K 補一列，砲長就會用。
//   屬性：gun／sail／crew ＝ 彈種倍率表（AMMO_K，對砲／對帆／對人，細節設定可調）；hull ＝ 打船殼（開洞、進水）；uw ＝ 碰到水不會沒（實心彈：打水漂、水面下照樣穿，21_gunnery.js）；blast ＝ 打中就炸（爆裂彈）。
//   ⚠ hull 是估的（實心彈穿透、爆裂彈第一下就在外面炸、鏈彈打中就慢一半），還沒量過。
var AMMO_TAG = [{ hull: 1, uw: 1 }, { hull: 0.6, blast: 1 }, { hull: 0.5 }, { hull: 0.3 }, { hull: 0.4 }, { hull: 0.4 }, { hull: 0.8 }];   // 第 6、7 列：火箭、石彈（固定彈種）   // 第 5 列：弩箭（10_ship.js AMMO_BOLT；固定彈種）   // 第 4 列：希臘火（28_fire.js；固定彈種，砲長不會挑到 —— 留著給之後「照船給彈種」）
/** 彈種 a 的屬性（砲長挑彈用）。 */
function ammoProps(a) { var t = AMMO_TAG[a] || {}; return { gun: ammoK(a, VS_GUN), sail: ammoK(a, VS_SAIL), crew: ammoK(a, VS_CREW), hull: t.hull || 0, uw: t.uw || 0, blast: t.blast || 0 }; }
// 瞄準點落在哪一帶 ⇒ 那一帶看重哪幾樣屬性
var AIM_ZONE_W = { water: { hull: 1, uw: 1 }, hull: { gun: 0.6, crew: 0.4, blast: 0.3 }, deck: { crew: 1, blast: 0.5 }, rig: { sail: 1 } };
/** 瞄準點（敵艦的格座標 t）落在哪一帶：砲甲板以下 ＝ 水線（含彈藥庫）、砲甲板（deckAim）、再往上到帆具以下 ＝ 甲板（站人的）、帆具（rigAim）以上。高度照船型（05_hull.js GEO0）。
 *  沒有帆可打（rigLive）⇒ 帆具那一帶當甲板（TASK-0828；Tim 2026-10-22「目前會對沒有桅杆(帆)的船打鏈彈」）：
 *  ⛔ 以前照高度直接判 ⇒ 莫尼特號、哨兵號的 rigAim（35–64）跟 deckAim（35–45）重疊，瞄甲板上的人（腳下 ＋ 10 格）一高過 45 就算帆具、挑鏈彈（量過）。 */
function aimZone(foe, t) { var z = t[2], G = foe.T.geo; return z < G.deckAim[0] ? 'water' : z <= G.deckAim[1] ? 'hull' : z < G.rigAim[0] || !rigLive(foe) ? 'deck' : 'rig'; }
/** 這艘還有帆可打嗎（帆具模式的局勢分數 > 0：有立著的桅、帆還剩）。沒有帆的鐵甲艦（假帆面積 1、剩 0%）、只有信號桅的（定遠號、松島號）、帆都打光的 ⇒ false。 */
function rigLive(foe) { return aimValue(foe, 'rig') > 0; }
/** 齊射照哪個模式瞄（50_sim.js）：砲長選的；選的是帆具、這個目標卻沒有帆可打（兩舷都開的另一艘、換了目標還沒重想）⇒ 砲甲板。 */
function aimModeFor(sh, foe) { var m = sh.aimMode || 'hull'; return m === 'rig' && !rigLive(foe) ? 'hull' : m; }
/** 砲長照瞄準點挑彈：sh 打得出的彈種裡，照那一帶看重的屬性打分最高的（同分 ⇒ 序號小的；不抽亂數）。 */
function gunnerAmmo(sh, foe, t) {
  var W = AIM_ZONE_W[aimZone(foe, t)], L = ammoOf(sh), best = L.length ? L[0] : 0, bs = -1e9;
  L.forEach(function (a) { var p = ammoProps(a), s = 0; for (var k in W) s += W[k] * p[k]; if (s > bs + 1e-9) { bs = s; best = a; } });
  return best;
}
