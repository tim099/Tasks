// ───────────────────────── 砲彈 ─────────────────────────
// 連發（Tim 2026-10-14：風暴角號船頭的三管速射砲）：砲種表的 burst ＝ 一份彈藥打幾發（預設 1）、burstGap ＝ 每發隔幾秒。
//   第一發照常（開火的閘、扣藥箱、開始裝填）；剩下的 burst − 1 發由 burstStep 照間隔一發一發打（每發重新挑點、照樣散布；射界外那一發跳過）。
//   模型有 muzzle-a／b／c ⇒ 輪流從那幾根砲管出彈。burst ＝ 1 的砲一個亂數都不多抽 ⇒ 別的船戰局不變。
function fireGun(sh, g, target, ammo) {
  if (sh.struck || !g.alive || g.reload > 0 || gunRate(g) <= 0) return false;      // 砲要有人操作；降旗了就不開（排在齊射裡還沒開的也一樣）
  ammo = gunAmmo(g, ammo);                                            // 固定彈種（希臘火、弩箭）打自己的；大砲照選的（換不了的 ⇒ 這種砲的第一種；10_ship.js gunAmmo）
  if (GUNS[g.type].close && !gunInRange(sh, g, target) && !manualFire(sh)) return false;   // 短射程的武器（砲種表 close：希臘火）⇒ 電腦打不到就不開（⛔ 開了只是噴進海裡）；玩家自己按的照開（Tim 2026-10-18：「持火號 目前按F無法單發開火」）
  if (!bears(sh, g, target)) return false;                            // 目標不在這門砲的砲門射界 ⇒ 不開（呼叫端先用 gunTarget 挑好這門打得到的點）
  if (g.mt && mountBusy(g)) return false;                              // 迴旋砲換砲門的途中不能開（TASK-0626）
  if (!mountFireOk(g)) return false;                                   // 砲塔的砲口不在能開火的角度裡（fire；TASK-0636）
  if (g.safe && selfBlock(sh, g, target)) { sh.selfBlk = (sh.selfBlk || 0) + 1; return false; }   // 標了 safe 的砲：砲線上有自己的砲塔、砲、火藥桶 ⇒ 先不開（等砲線清了；裝填不浪費）；selfBlk：擋了幾次（讀數）
  var mz0 = g.muzs ? g.muzs[0] : g.muz;                                // 這一發從哪個砲口出（多管砲：第一根）
  if (wetAt(sh, mz0)) { sh.wetShot = (sh.wetShot || 0) + 1; return false; }   // 砲口這一刻在海面下（照浪、33_flood.js wetAt；TASK-0719，Tim 2026-10-19：「炮口在水下就無法開炮」）⇒ 不開、裝填不浪費；泡水的遲滯照舊（43_swim.js gunWet：每 2 秒、連兩次 ⇒ HUD 的 ≈、藥濕、砲班離開）；wetShot 只是讀數（__game.ports）
  var GS = GUNS[g.type], r = fireShot(sh, g, target, ammo, mz0);
  g.reload = sh.reloadT * GS.reload * rr(0.9, 1.1); g.reload0 = g.reload; g.firedAt = SIMT; sh.fired++;   // reload0：這一輪裝填要多久（武器演出的進度 gunPhase，26_gunanim.js）
  g.needCart = true;                                                // 下一發要從砲旁的藥箱拿一份火藥與彈藥（沒有 ⇒ 等送藥手，23_powder.js）
  if (ammo === AMMO_GF) { evEmit('gfJet', r.mw, r.dir, sh.vel); sfx('splash', r.mw, 0.5); } else if (ammoQuiet(ammo)) boltFx(sh, r.mw); else shotFx(sh, g, r.mw, r.dir);   // 希臘火：噴口一道火舌（28_fire.js），沒有砲聲、沒有後座；弩箭、火箭、石彈：只有弓弦／投臂一響
  if ((GS.burst || 1) > 1) { g.burstLeft = GS.burst - 1; g.burstK = 1; g.burstAmmo = ammo; g.burstT = SIMT + (GS.burstGap || 0.15); }   // 連發：同一份彈藥再打 burst − 1 發
  return true;
}
/** 連發剩下的那幾發（每一步、每艘；50_sim.js）：到時間就照現在的瞄準點再打一發；砲沒了、泡水、沒人、降旗 ⇒ 剩下的作廢；輪到的那根砲管的砲口這一刻在海面下 ⇒ 那一發跳過（TASK-0719）。
 *  沒有瞄準點（海上沒有敵艦：只剩自己、或最後一艘剛沉）⇒ 照單發的退路對空打（fireOne：skyPoint）；⛔ aimPoint 沒有敵艦會讀 null.M（守法同 gunAims）。 */
function burstStep(sh) {
  for (var i = 0; i < sh.guns.length; i++) {
    var g = sh.guns[i]; if (!(g.burstLeft > 0) || SIMT < g.burstT) continue;
    if (sh.struck || sh.sunk || !g.alive || g.wet || gunRate(g) <= 0) { g.burstLeft = 0; continue; }
    var w = foeOf(sh) || (sh.aim && sh.aimOn) ? aimPoint(sh) : null;
    var t = w ? gunTarget(sh, g, w) : skyPoint(sh, g), mzk = g.muzs ? g.muzs[g.burstK % g.muzs.length] : g.muz;   // 這一發輪到的那一根砲管
    if (t && bears(sh, g, t) && mountFireOk(g) && !(g.safe && selfBlock(sh, g, t))) {
      if (wetAt(sh, mzk)) sh.wetShot = (sh.wetShot || 0) + 1;            // 這一根的砲口在海面下（TASK-0719）⇒ 這一發不開（跟射界外那一發一樣跳過：照樣 burstK++、burstLeft--）
      else {
        var r = fireShot(sh, g, t, g.burstAmmo, mzk); sh.fired++;
        if (g.burstAmmo === AMMO_GF) evEmit('gfJet', r.mw, r.dir, sh.vel); else if (ammoQuiet(g.burstAmmo)) boltFx(sh, r.mw); else shotFx(sh, g, r.mw, r.dir);   // 希臘火連發（Tim 2026-10-18：「siphon 是否可以改成連射(參考速射炮) 先設定為10連發」）：每一發一道火舌，同第一發（⛔ shotFx ⇒ 砲煙＋砲聲）
      }
    }
    g.burstK++; g.burstLeft--; g.burstT = SIMT + (GUNS[g.type].burstGap || 0.15);
  }
}
/** 砲線上有沒有自己船的關鍵部位（Tim 2026-10-17：「應該是被自己的炮打掉的」「因為剛好在炮線上 可以讓炮檢查是否會打到自己船的關鍵部位(砲塔或炮)」
 *  「打到自己船非關鍵部位不管 因為目前風暴角號前向炮會打掉裝飾用的船頭」）：從砲口沿著往目標那條直線（船的格座標）每一格量一點，到離開船的外框或到目標為止 ——
 *  只有模型 meta 標了 safe=1 的砲才量（Tim「炮上可以加meta設定開關 有打開的炮才檢查(節省效能)」⇒ 沒標的船一行都不多算、戰局逐位元組不變）。
 *  碰到別門砲、火藥桶（模型，照網格 inMesh，不是外框；Tim「只要避開其他自己的砲塔 火藥桶之類的關鍵部件」）、砲塔／砲盾的殼（armAt；⛔ 不算這門砲自己掛的那一座：砲從它的砲門打出去；螺旋槳不算）⇒ 擋住、這一發先不開
 *  （開火的閘照舊在，砲線清了下一拍就開；裝填不浪費）。船殼、甲板、裝飾照開。⚠ 直線、不算彈道的弧（船邊幾十公尺內差不到一格）。 */
function selfBlock(sh, g, target) {
  var M = g.muz, T = toLocal(sh, target), d = sub(T, M), l = len(d); if (l < 1) return false;
  d = mul(d, 1 / l);
  var S = sh.T.h.size, own = g.model && g.model.hd, skip = g.model ? [g.model] : null, lim = Math.min(l, 1000);
  for (var s = 2; s <= lim; s++) {
    var P = [M[0] + d[0] * s, M[1] + d[1] * s, M[2] + d[2] * s];
    if (P[0] < 0 || P[1] < 0 || P[2] < 0 || P[0] >= S[0] || P[1] >= S[1] || P[2] >= S[2]) return false;   // 出了船的外框
    var o = hitModel(sh, P, 0, skip); if (o && (GUNS[o.kind] || kindProp(o.kind, 'safe'))) return true;   // 別門砲、規格表 safe 的（火藥桶（彈藥庫、砲旁的備便桶）
    if (sh.arm) { var a = armAt(sh, P); if (a && !a.prop && a.g !== g && !(own && a.nd === own)) return true; }
  }
  return false;
}
/** 這門砲照初速與最大仰角（gunElev；超過 45° 照 45°）打得到多遠（m，水平）：R ＝ V² sin(2θ)／g；9 成當安全餘量。 */
function gunMaxR(GS) { return 0.9 * GS.V * GS.V * Math.sin(2 * Math.min(gunElev(GS), Math.PI / 4)) / G; }
// 仰角與曲射（Tim 2026-10-18：「投石機是否可以給高拋物線彈道(可以砸到甲板)」「之後也可能用在迫擊砲(臼炮)上 曲射炮彈」）——砲種表兩個通用的鍵：
//   elev（度）：最大仰角，沒寫 ＝ 0.26 rad（15°，大砲的砲門）。打不到 ⇒ 照 min(elev, 45°) 打最遠。
//   lob（true）：曲射 ⇒ 兩條拋物線取高的那一條（從上面砸下來，打得到甲板）；高的那條超過 elev（太近）⇒ 退回低的那條。
//     前置量照真的飛行時間（水平距離 ÷ 水平速度，迭代兩次）——⛔ 照「距離 ÷ 初速」⇒ 高拋飛得久，打在船走過的地方。
//   都沒寫的砲一個值都不變（0.26、低的那條、前置量照舊）⇒ 別的船戰局不變。
function gunElev(GS) { return GS.elev > 0 ? GS.elev * Math.PI / 180 : 0.26; }
/** 打水平距離 d、高差 dy 要的仰角（見上）。 */
function shotEl(GS, d, dy) {
  var v2 = GS.V * GS.V, EL = gunElev(GS), disc = v2 * v2 - G * (G * d * d + 2 * dy * v2);
  if (disc < 0) return Math.min(EL, Math.PI / 4);
  var lo = Math.atan((v2 - Math.sqrt(disc)) / (G * d));
  if (!GS.lob) return lo;
  var hi = Math.atan((v2 + Math.sqrt(disc)) / (G * d));
  return hi <= EL ? hi : lo;
}
function gunInRange(sh, g, target) { var mw = M4.pt(sh.M, g.muz[0], g.muz[1], g.muz[2]); return Math.hypot(target[0] - mw[0], target[2] - mw[2]) <= gunMaxR(GUNS[g.type]); }
/** 一發砲彈：從 muz（格座標的砲口）照 target 算仰角、前置量、散布，放進 BALLS。回：{ mw 世界的砲口, dir 出膛方向 }。 */
function fireShot(sh, g, target, ammo, muz) {
  var mw = M4.pt(sh.M, muz[0], muz[1], muz[2]);
  var side = gunAxis(sh, g);
  var GS = GUNS[g.type], V = GS.V;                                    // 初速照砲種（carronade：32 磅、短砲身 ⇒ 初速低、彈大）
  var foe = aimShip(sh), rel = foe ? sub(foe.vel, sh.vel) : [0, 0, 0];   // 前置量：砲彈帶著本艦的船速 ⇒ 瞄對方「相對本艦」飛行時間後的位置（瞄的那艘，52_fleet.js）；沒有目標（單發對空打）⇒ 不加
  if (GS.lob) { var t0 = target, tf = Math.hypot(target[0] - mw[0], target[2] - mw[2]) / V; for (var it = 0; it < 2; it++) { target = add(t0, mul(rel, tf)); var dl = Math.hypot(target[0] - mw[0], target[2] - mw[2]); tf = dl / (V * Math.cos(shotEl(GS, dl, target[1] - mw[1]))); } target = add(t0, mul(rel, tf)); }   // 曲射：前置量照飛行時間（見 gunElev 上面）
  else target = add(target, mul(rel, Math.hypot(target[0] - mw[0], target[2] - mw[2]) / V));
  var dx = target[0] - mw[0], dz = target[2] - mw[2], dy = target[1] - mw[1], d = Math.hypot(dx, dz);
  var el = shotEl(GS, d, dy);
  var az = Math.atan2(dz, dx), saz = Math.atan2(side[2], side[0]), da = Math.atan2(Math.sin(az - saz), Math.cos(az - saz));
  var cn = g.cone || 0.45; da = clamp(da, -cn, cn); az = saz + da;   // 砲門只容得下 ±26°（砲塔照砲管 cone，TASK-0626）
  var spread = handAim(sh) && !sh.autoNow ? 0.0045 : sh.aiSpread || 0.008;   // 玩家自己瞄的那幾發（含自動開砲時的手動那一舷）；sh.autoNow ＝ 這一發是電腦開的（50_sim.js 另一舷那一輪）
  if (!sh.crew.some(function (c) { return c.role === ROLE.OFFICER && crewAble(c); })) spread *= 1.7;   // 軍官全倒 ⇒ 沒人指揮，瞄得散
  spread *= [0.7, 0.75, 0.85, 1][sh.sailSet];                       // 帆收得越多，船越穩
  spread *= wxSpread(sh);                                          // 天氣：暴風雨裡船晃得越快，點火那一下差得越多（晴天 ×1）
  el = clamp(el + gauss() * spread, -0.17, gunElev(GS)); az += gauss() * spread;
  var dir = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
  var b = { p: mw.slice(), v: add(mul(dir, V * rr(0.985, 1.015)), sh.vel), owner: sh.i, ammo: ammoBase(ammo), trav: 0, alive: true, age: 0, bounced: false, big: GS.big, hole: GS.hole, dmg: DMG[g.type], m: GS.shot };   // dmg：每發傷害（砲種，細節設定）；hole：洞的倍率（4 磅彈小）；m：彈重 kg（能量，TASK-0621）
  if (ammo === 2) b.ph = BALLS.length * 2.39996 % 6.28319;
  if (ammo === AMMO_BOLT || ammo === AMMO_FIRE) b.bolt = true;       // 弩箭、火箭：照實心彈飛、命中（b.ammo 0），只是畫成一支箭（60_render.js）
  if (ammo === AMMO_FIRE) b.fire = true;                             // 火箭：第一次碰到船就點火（28_fire.js fireArrowHit）
  if (ammo === AMMO_STONE) b.stone = true;                           // 石彈（投石機）：照實心彈，畫成一顆石頭
  if (ammo === AMMO_GF) b.gf = true;                                  // 希臘火（28_fire.js）：一團火，碰到什麼就潑開，⛔ 不穿透           // 鏈彈的起始角（csBar）：照場上第幾顆彈錯開（黃金角），⛔ 不抽亂數
  windShot(sh, b, dx, dz); BALLS.push(b); rptShot(sh, g, b);         // rptShot：戰鬥報表記是哪一門開的（79_report.js；只讀）
  return { mw: mw, dir: dir };
}
/** 弩砲放箭：沒有火光、煙、後座，只有弓弦一響（小聲的 crack）。 */
function boltFx(sh, mw) { sfx('crack', mw, sh.i === PLAYER_I ? 0.35 : 0.25); return true; }
/** 玩家自己按的那一發（沒開自動開砲；電腦替玩家開的 sh.autoNow 不算）。 */
function manualFire(sh) { return sh.i === PLAYER_I && !AUTOFIRE && !sh.autoNow; }
/** 開火的火光、煙、後座、聲音（連發每一發都有）。 */
function shotFx(sh, g, mw, dir) {
  flash(add(mw, mul(dir, 1)), dir, 14, false); smoke(add(mw, mul(dir, 1.5)), dir, 10, false);
  sh.rollV += g.side === 'P' ? 0.0012 : -0.0012;                      // 後座：船往反方向晃一下（開火那一舷抬起；roll 正 ＝ 右舷 S 那邊往下）
  sfx('boom', mw, sh.i === PLAYER_I ? 1 : 0.8);
  return true;
}
/** 齊射：各砲平行開火 —— 瞄準點跟著那門砲在船上的前後位置平移，整排落在對方船身上（⛔ 不是 14 發擠進同一個洞）。 */
function broadside(sh, ammo, careful) {                            // careful：電腦開的 ⇒ 隔著友船的那門不開（52_fleet.js；玩家自己按的照開）
  if (sh.struck) return 0;
  var k = 0, mid = 0, n = 0;
  sh.guns.forEach(function (g) { mid += g.muz[0]; n++; }); mid /= n || 1;
  var tgt = foeOf(sh) || (sh.aim && sh.aimOn) ? aimPoint(sh) : null, FK = careful ? friendKeels(sh) : [];   // 沒有瞄準點（海上沒有敵艦）⇒ 沒有一門打得到，不齊射（⛔ aimPoint 會讀 null.M；守法同 gunAims）
  if (!tgt) return 0;
  sh.guns.forEach(function (g) {
    if (!g.alive || g.reload > 0 || gunRate(g) <= 0 || !gunTarget(sh, g, tgt)) return;   // 兩舷都看：每一門自己判定，有機會打中敵艦的才排進齊射
    if (FK.length && friendInLine(FK, M4.pt(sh.M, g.muz[0], g.muz[1], g.muz[2]), tgt)) { sh.ffHold = (sh.ffHold || 0) + 1; return; }
    var off = (g.muz[0] - mid) * S * (ammo === 2 ? 0.15 : 1);      // 鏈彈是對著桅杆打的 ⇒ 往瞄準點收攏
    EVENTS.push({ t: SIMT + k * 0.075 + rr(0, 0.03), sh: sh.i, g: g, ammo: ammo, off: off }); k++;   // 瞄準點在開火那一刻才算（兩艘都在動）
  });
  if (k) { sh.salvo++; sh.salvoT = SIMT; }
  return k;
}
/** 玩家自己瞄（瞄準圈、空白鍵齊射照它）：沒開自動開砲；或開著但點了敵艦（sh.hand：那一舷手動、另一舷照樣自動；Tim 2026-10-14）。 */
function handAim(sh) { return sh.i === PLAYER_I && (!AUTOFIRE || !!sh.hand); }
/** 暫時把瞄準點換成 (aim, on) 跑 f（瞄準、前置量、gunTarget 都讀 sh.aim／aimShip）——另一舷的那一輪齊射用（50_sim.js aiSecond），跑完換回來。 */
function withAim(sh, aim, on, f) { var a = sh.aim, o = sh.aimOn; sh.aim = aim; sh.aimOn = on; try { return f(); } finally { sh.aim = a; sh.aimOn = o; } }
/** 另一舷的齊射（Tim 2026-10-13：兩側都有敵人時兩舷都開）：瞄 on 那艘的 aim（格座標），只排 guns 這幾門；瞄準點記在每一發上（e.on、e.aim），
 *  開火那一刻照它算 ⇒ 主要那一輪換了瞄準點也不會把這一輪拉過去。 */
function broadsideAt(sh, ammo, on, aim, guns) {
  if (sh.struck) return 0;
  var k = 0, mid = 0;
  guns.forEach(function (g) { mid += g.muz[0]; }); mid /= guns.length || 1;
  guns.forEach(function (g) {
    var off = (g.muz[0] - mid) * S * (ammo === 2 ? 0.15 : 1);
    EVENTS.push({ t: SIMT + k * 0.075 + rr(0, 0.03), sh: sh.i, g: g, ammo: ammo, off: off, on: on, aim: aim }); k++;
  });
  if (k) { sh.salvo++; sh.salvoT = SIMT; sh.salvo2 = (sh.salvo2 || 0) + 1; }
  return k;
}
/** 每門砲現在打不打得到（Tim 2026-10-19：「炮可以射擊到敵人時 是否可以有額外標示(單門判定目前開炮是否能打中)」「判定不放在UI 而是在船或炮上 UI只是取用避免重複計算」）——
 *  瞄準點 w（F 單發那一套：有敵艦或點了瞄準點 ⇒ aimPoint）記在船上 sh.ga；每門砲記兩個：
 *    g.aimT ＝ gunTarget 挑的點（含玩家手動時「射程裡打不到 ⇒ 照射界挑」的退路；null ＝ 這門對不到）—— F 單發、兩舷金線、射界外照它；
 *    g.aimHit ＝ 射界＋射程都對得到的點（gunTarget 前兩段；null ＝ 現在開也打不中）—— HUD 每門砲的金框照它（只看位置：裝填、人手照舊看符號的形狀與顏色）。
 *  多久算一次：模擬時間每 GUN_AIM_DT 秒、或瞄準的東西換了（換敵艦、點了別的點、瞄準模式、手動／自動）才重算 ⇒ HUD 每一格只讀；按 F ⇒ 先強制重算（開火照最新的）。
 *  ⛔ 不抽亂數（aimPoint 的瞄準模式照中心點、modeAim rand false）⇒ 誰叫、叫幾次都不動戰局。 */
var GUN_AIM_DT = 0.1;
function gunAims(sh, force) {
  var foe = foeOf(sh), w = foe || (sh.aim && sh.aimOn) ? aimPoint(sh) : null, mf = manualFire(sh);
  var key = (foe ? foe.i : -1) + '|' + (sh.aim ? sh.aim.join(',') : '') + '|' + (sh.aimOn ? 1 : 0) + '|' + (sh.pMode || '') + '|' + (mf ? 1 : 0) + '|' + (handAim(sh) ? 1 : 0) + '|' + (sh.struck ? 1 : 0);
  var A = sh.ga; if (!force && A && A.key === key && SIMT >= A.t && SIMT - A.t < GUN_AIM_DT) return A;
  A = sh.ga = { t: SIMT, key: key, w: w };
  sh.guns.forEach(function (g) {
    var hit = null, t = null;
    if (w && !sh.struck && g.alive && !g.wet) {
      var b = bears(sh, g, w);
      hit = b && gunInRange(sh, g, w) ? w : gunTargetIn(sh, g, w, true);
      t = hit || (mf ? (b ? w : gunTargetIn(sh, g, w, false)) : null);   // ＝ gunTarget(sh, g, w)
    }
    g.aimHit = hit; g.aimT = t;
  });
  return A;
}
/** 單發（F；Tim 2026-10-18：「沒有目標時也開一發(可以對空開炮) 有目標時優先開能打到目標的」）：照 fireOneList 的順序一門一門試，開成一發就停
 *  （⛔ 只試第一門 ⇒ 那門剛好被 safe 擋住、砲塔還沒轉到，就整發沒了）。回：開成了沒。 */
function fireOne(sh, ammo) {
  gunAims(sh, true);                                                   // 開火照最新的（HUD 讀的那一份最多舊 GUN_AIM_DT 秒）
  var L = fireOneList(sh);
  for (var i = 0; i < L.length; i++) if (fireGun(sh, L[i].g, L[i].t || skyPoint(sh, L[i].g), ammo)) return true;
  return false;
}
/** 單發要試的砲（照順序）：裝填好、有人、能開（迴旋砲沒在換砲門、砲塔在開火角度裡）的砲裡 ——
 *  先打得到瞄準點的（離瞄準點近的先，t ＝ gunTarget 挑的點），再其他的（砲軸對著瞄準點的先；沒有目標 ⇒ 照砲的順序，t ＝ null ⇒ 對空打）。 */
function fireOneList(sh) {
  if (sh.struck) return [];
  var ready = sh.guns.filter(function (g) { return g.alive && g.reload <= 0 && gunRate(g) > 0 && !(g.mt && mountBusy(g)) && mountFireOk(g); });
  if (!ready.length) return [];
  var tgt = gunAims(sh).w, hit = [], rest = [];                        // 每門打哪裡：砲上那一份（gunAims；⛔ 這裡再叫 gunTarget ⇒ HUD 每一格又算一次）
  ready.forEach(function (g) {
    var m = M4.pt(sh.M, g.muz[0], g.muz[1], g.muz[2]), t = tgt ? g.aimT : null;
    if (t) hit.push({ g: g, t: t, d: len(sub(m, tgt)) });
    else { var a = gunAxis(sh, g), d = tgt ? -((tgt[0] - m[0]) * a[0] + (tgt[2] - m[2]) * a[2]) / (Math.hypot(tgt[0] - m[0], tgt[2] - m[2]) || 1) : 0; rest.push({ g: g, t: null, d: d }); }   // d：砲軸跟往瞄準點那條線的夾角（−cos，小 ＝ 對得比較準）
  });
  function by(a, b) { return a.d - b.d; }
  return hit.sort(by).concat(rest.sort(by));
}
/** 單發最先會開的那一門（HUD 單發鈕：t ＝ null ⇒ 沒有一門打得到目標，按下會往空中打一發；null ⇒ 沒有砲能開）。 */
function fireOnePick(sh) { var L = fireOneList(sh); return L.length ? L[0] : null; }
/** 對空打一發的目標點：沿砲軸 300 m、比砲口高 60 m（fireShot 照它算仰角 ⇒ 夾在最大仰角 15°）。 */
function skyPoint(sh, g) { var m = M4.pt(sh.M, g.muz[0], g.muz[1], g.muz[2]), a = gunAxis(sh, g); return [m[0] + a[0] * 300, m[1] + 60, m[2] + a[2] * 300]; }
/** 這門砲的砲軸（世界、水平）：模型的固定點 muzzle − breech（舷側砲 ＝ 那一舷的正橫；追擊砲 ＝ 正橫偏船頭 20°）。 */
function gunAxis(sh, g) {
  var a = M4.dir(sh.M, g.ax[0], g.ax[1], 0);
  return norm([a[0], 0, a[2]]);
}
/** 這門砲對不對得到 w：從砲口量，跟它的砲軸夾角 < 0.45 rad（砲門 ±26°）。 */
function bears(sh, g, w) {
  var m = M4.pt(sh.M, g.muz[0], g.muz[1], g.muz[2]), ax = gunAxis(sh, g);
  var a = Math.atan2(w[2] - m[2], w[0] - m[0]) - Math.atan2(ax[2], ax[0]);
  return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < (g.cone || 0.45);   // g.cone：砲塔的砲管射界（gunMountInit）；一般的砲沒有 ⇒ 砲門 ±26°
}
// ───────────────────────── 砲的迴旋與砲塔（TASK-0626；Tim 2026-10-15：「有辦法讓炮能迴旋嗎(之後可以支援砲塔)」「一般炮預設固定就好(效能&避免穿模考量)」）─────────────────────────
// 照砲模型的 meta（沒有 ⇒ 固定、一行都不多算）：
//   mount=pivot、ports=0,45,-45（度，相對模型原本的砲軸；左正右負照格座標 +y）：只在這幾個方向之間換（維吉尼亞號船頭船尾的 7 吋砲：3 個砲門一門砲）。
//     目標落在別的砲門那一邊 ⇒ 轉過去；轉的時候不能開、到了才開；只停在作者標的角度 ⇒ 不穿模。rate 度／秒（預設 12）。
//   mount=turret、arc=-150,150（度）、rate（預設 20）：在 arc 裡連續轉（之後的砲塔）；砲管射界 cone（度，預設 4）⇒ 要真的對準才開。
//     fire=-174,174（度，選填；沒寫 ＝ arc）：能開砲的角度（TASK-0636；Tim 2026-10-16：「開火角度跟旋轉要分開(可以預設同一組 但可以額外設定開火角度)」「沒有的話就用同一組」）。
//     arc 管能轉到哪、fire 管砲口在哪裡才開：莫尼特號 arc 一整圈、fire −174,174（轉離中線 6° 才過得了駕駛塔 ⇒ 朝駕駛塔那 12° 不開，但轉得過去）。
//   轉的中心：模型固定點 pivot（砲塔用）＞ meta pivot（從砲尾沿砲軸量幾格，負 ＝ 往後；維吉尼亞號 −9.5 ＝ 砲廓圓頭的圓心，三個砲門都從那裡放射）＞ 外框中心。
//   runin（格，預設 0）：換砲門前先沿砲軸往後拉這麼多、轉完再推出去（史料：先把砲拉進來才換）—— 維吉尼亞號 6：停在三個砲門上網格落進實心 0 格，轉到 22° 不拉會穿進砲廓牆 48／124 個頂點，拉 4／5 格就 0。
//   跟著轉的：模型（m.rot／m.piv，帆桁那一套；拉進來 m.gsl）、砲軸、砲口、砲班的站位與站在上面的人、放藥箱的位置。⛔ 模型的外框（被打中、碰撞）不轉。
function gunMountInit(sh, g) {
  var m = g.model, mt = m.meta || {}, kind = mt.mount;
  if (kind !== 'pivot' && kind !== 'turret') return;
  var D = Math.PI / 180, br = m.pts.breech || g.muz, c = m.pts.pivot ? m.pts.pivot.slice() : isFinite(+mt.pivot) ? [br[0] + g.ax[0] * +mt.pivot, br[1] + g.ax[1] * +mt.pivot, m.bb[2]] : [(m.bb[0] + m.bb[3]) / 2, (m.bb[1] + m.bb[4]) / 2, m.bb[2]];
  function list(s, d) { var a = String(s === undefined ? d : s).split(',').map(function (v) { return +v * D; }).filter(isFinite); return a.length ? a : String(d).split(',').map(function (v) { return +v * D; }); }
  g.mt = { kind: kind, c: c, ax0: g.ax.slice(), muz0: g.muz.slice(), muzs0: g.muzs ? g.muzs.map(function (q) { return q.slice(); }) : null, yaw: 0, yawT: 0,
    ports: kind === 'pivot' ? list(mt.ports, '0') : null, runin: +mt.runin > 0 ? +mt.runin : 0, sl: 0, arc: kind === 'turret' ? list(mt.arc, '-180,180') : null, fire: kind === 'turret' ? list(mt.fire !== undefined ? mt.fire : mt.arc, '-180,180') : null, rate: (+mt.rate > 0 ? +mt.rate : kind === 'pivot' ? 12 : 20) * D };
  if (kind === 'turret') { g.cone = (+mt.cone > 0 ? +mt.cone : 4) * D; g.mt.full = g.mt.arc[g.mt.arc.length - 1] - g.mt.arc[0] >= 2 * Math.PI - 1e-6; }   // full：轉得了一整圈（arc 沒寫 ＝ −180,180）
  m.piv = c; m.rot = 0;
  (sh.mounts = sh.mounts || []).push(g);
}
/** 角度 x（弧度）落在弧 a（[起, …, 迄]）裡 ⇒ 換算進 [起, 起 ＋ 360°) 的那個值；不在 ⇒ null；一整圈的弧 ⇒ x 原樣。 */
function arcIn(a, x) { var lo = a[0], hi = a[a.length - 1], P2 = 2 * Math.PI; if (hi - lo >= P2 - 1e-6) return x; var r = lo + ((x - lo) % P2 + P2) % P2; return r <= hi ? r : null; }
/** 砲塔這一步要轉到哪（TASK-0636；Tim 2026-10-16：「有可能會繞更大一圈(轉超過180度去瞄準)」「全向砲塔瞄準不應該需要轉超過180度」—— ⛔ 夾進 arc 再直接相減 ⇒ 跨過 ±180° 往反方向轉 340°、有死角時目標一跨過就整整繞一圈）。
 *  轉得了一整圈 ⇒ 走近的那一邊（回傳 yaw ＋ 繞回後的差；mountStep 轉完再把 yaw 繞回 ±180°）。
 *  有死角 ⇒ yaw 只住在 arc 裡、只從 arc 裡轉（不繞回）：目標換算進 [arc 起點, 起點 ＋ 360°)，落在 arc 裡就是它；
 *  落在死角裡 ⇒ 停在近的那一端，原本靠哪一端就守哪一端，另一端要近過 TURRET_HYS 才換（⛔ 目標在死角中線附近 ⇒ 每一步都整整繞一圈來回甩）。 */
var TURRET_HYS = 10 * Math.PI / 180;                                     // 離兩端的差 ＝ 離死角中線的兩倍 ⇒ 過中線 5° 才換（莫尼特號死角 12°：中線兩邊各晃 2° 不再甩）
// 2026-10-16 第二輪：先照開火角度 fire 挑要瞄的角度 t（落在 fire 外 ⇒ fire 近的那一端，遲滯照上面），再照旋轉範圍 arc 走過去 ——
// arc 一整圈 ⇒ 走近的那一邊（可以轉過不能開火的那幾度）；arc 有死角 ⇒ 只能在 arc 裡走（物理上轉不過去，只能繞）。fire 沒寫 ＝ arc ⇒ 跟第一輪一樣。
function turretAim(M, rel) {
  var F = M.fire, lo = F[0], hi = F[F.length - 1], P2 = 2 * Math.PI, t = arcIn(F, rel);
  if (t === null) {                                                   // 目標在不能開火的角度 ⇒ 停在近的那一端，原本靠哪一端就守哪一端
    var r = lo + ((rel - lo) % P2 + P2) % P2, dh = r - hi, dl = lo + P2 - r, p = arcIn(F, M.yawT), rp = lo + ((M.yawT - lo) % P2 + P2) % P2;
    var onHi = p !== null ? p - lo > hi - p : rp - hi < lo + P2 - rp;   // 原本靠哪一端（原本就在開火角度外 ⇒ 離哪一端近）
    t = onHi ? (dl < dh - TURRET_HYS ? lo : hi) : (dh < dl - TURRET_HYS ? hi : lo);
  }
  if (M.full) { var d = t - M.yaw; return M.yaw + Math.atan2(Math.sin(d), Math.cos(d)); }   // 轉得了一整圈 ⇒ 近的那一邊
  var q = arcIn(M.arc, t); if (q !== null) return q;                 // 有死角 ⇒ yaw 住在 arc 裡、直接走過去（不繞回）
  var A0 = M.arc[0], A1 = M.arc[M.arc.length - 1], rq = A0 + ((t - A0) % P2 + P2) % P2;   // fire 超出 arc（設定不一致）⇒ 轉到 arc 近的那一端
  return rq - A1 < A0 + P2 - rq ? A1 : A0;
}
/** 砲口現在在不在能開火的角度裡（砲塔才有；沒有 fire ⇒ 一律可以）。 */
function mountFireOk(g) {
  if (g.mt && g.mt.fire && arcIn(g.mt.fire, g.mt.yaw) === null) return false;
  for (var N = g.mt ? g.mt.up : g.hd; N; N = N.up) if (arcIn(N.fire, N.yaw) === null) return false;   // 掛在砲塔上（27_turret.js）⇒ 每一層砲塔都要在能開火的角度
  return true;
}
/** 格座標 p 繞 c 轉 a（跟 modelLocal 同一個 rotM ⇒ 砲口、站位跟畫出來的模型轉得一樣）。 */
function mountRot(p, c, a) { var d = M4.dir(rotM([0, 0, 1], a), p[0] - c[0], p[1] - c[1], 0); return [c[0] + d[0], c[1] + d[1], p[2]]; }
/** 每一步（50_sim.js，在開砲之前）：有迴旋的砲照瞄準點挑方向、照轉速轉；轉了 ⇒ 砲軸、砲口、站位、人跟著轉。 */
function mountStep(sh, dt) {
  var G = sh.mounts; if ((!G && !sh.tur) || sh.sunk || sh.struck) return;
  var tgt = foeOf(sh) ? aimPoint(sh) : null, foe = aimShip(sh), L = tgt ? toLocal(sh, tgt) : foe && foe.M ? toLocal(sh, M4.pt(foe.M, foe.T.cx, foe.T.cy, foe.T.zw)) : null;   // 沒有敵艦（建造模式、只有一艘的沙盒）⇒ 不問瞄準點（⛔ aimPoint 讀 foe.M ⇒ 有迴旋砲的船每一步例外）；砲照原本的方向
  if (sh.tur) turretStep(sh, dt, L);                                   // 砲塔層（27_turret.js）：砲塔、上面的砲（自己會轉、掛在砲塔上的也在那裡轉）
  if (G) G.forEach(function (g) {
    var M = g.mt; if (!g.alive || !L || M.up) return;
    var rel = Math.atan2(L[1] - M.c[1], L[0] - M.c[0]) - Math.atan2(M.ax0[1], M.ax0[0]); rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    if (M.ports) {                                                    // 換砲門：挑離目標最近的那個；差不到 0.1 rad 不換（⛔ 目標在兩個砲門中間 ⇒ 來回換）
      var best = M.yawT, bd = Math.abs(Math.atan2(Math.sin(rel - M.yawT), Math.cos(rel - M.yawT)));
      M.ports.forEach(function (p) { var d = Math.abs(Math.atan2(Math.sin(rel - p), Math.cos(rel - p))); if (d < bd - 0.1) { bd = d; best = p; } });
      M.yawT = best;
    } else M.yawT = turretAim(M, rel);
    var d = M.yawT - M.yaw, m = g.model, sl0 = M.sl;
    if (Math.abs(d) < 1e-6 && !M.sl) return;
    if (Math.abs(d) >= 1e-6 && M.sl < M.runin) { M.sl = Math.min(M.runin, M.sl + MOUNT_RUN * dt); d = 0; }   // 先拉進來
    else if (Math.abs(d) < 1e-6) M.sl = Math.max(0, M.sl - MOUNT_RUN * dt);   // 到了 ⇒ 推出去
    var st = clamp(d, -M.rate * dt, M.rate * dt), a0 = M.yaw; M.yaw += st; if (Math.abs(M.yawT - M.yaw) < 1e-6) M.yaw = M.yawT;
    var da = M.yaw - a0;
    if (M.full && Math.abs(M.yaw) > Math.PI) { var w = M.yaw > 0 ? -2 * Math.PI : 2 * Math.PI; M.yaw += w; M.yawT += w; }   // 一整圈的砲塔：yaw 繞回 ±180°（⛔ 一直累加 ⇒ 轉幾圈就差幾個 360°）
    m.rot = M.yaw;
    if (M.sl !== sl0) m.gsl = M.sl ? [-M.ax0[0] * M.sl, -M.ax0[1] * M.sl] : null;
    var ax = M4.dir(rotM([0, 0, 1], M.yaw), M.ax0[0], M.ax0[1], 0); g.ax = [ax[0], ax[1]];
    var back = function (q) { return [q[0] - M.ax0[0] * M.sl, q[1] - M.ax0[1] * M.sl, q[2]]; };
    g.muz = mountRot(back(M.muz0), M.c, M.yaw); if (M.muzs0) g.muzs = M.muzs0.map(function (q) { return mountRot(back(q), M.c, M.yaw); });
    if (g.drop) g.drop = mountRot(g.drop, M.c, da);
    (g.spots || []).forEach(function (s) { s.at = mountRot(s.at, M.c, da); var c = s.who; if (c && c.gun === g && !c.walk && c.st === 0) { c.pos = mountRot(c.pos, M.c, da); if (c.home) c.home = mountRot(c.home, M.c, da); } });
  });
}
/** 迴旋砲還在轉（換砲門的途中）⇒ 不能開；砲塔邊轉邊開（照 cone 判對不對得到）。 */
var MOUNT_RUN = 4;                                                       // 拉進來／推出去的速度（格／秒 ⇒ 0.4 m／秒）
function mountBusy(g) { return !!(g.mt && g.mt.ports && (Math.abs(g.mt.yaw - g.mt.yawT) > 1e-6 || g.mt.sl > 0)); }
/** 這門砲打哪裡（每一門自己判定）：對得到 w ⇒ w；對不到 ⇒ 敵艦船身上（水線上那一段的中線、跟 w 同高，取 13 點）
 *  這門砲射界內、離 w 最近的那一點；整艘都在射界外 ⇒ null。⇒ 瞄準點在射界外，只要還有機會打中敵艦就開。
 *  「對得到」也要在射程裡（gunInRange：最大射程）：⛔ 只看射界 ⇒ 持火號貼在憲法號旁邊 5 m，砲長在 55 m 長的船身上抽到離 siphon 31 m 以外的點 ⇒ fireGun 判打不到不開，
 *    14 秒只開 1 發（量過）。長砲的射程上千公尺 ⇒ 一定在射程裡、跟以前一位元都不差。 */
function gunTarget(sh, g, w) {
  if (bears(sh, g, w) && gunInRange(sh, g, w)) return w;
  var t = gunTargetIn(sh, g, w, true); if (t || !manualFire(sh)) return t;
  return bears(sh, g, w) ? w : gunTargetIn(sh, g, w, false);           // 玩家自己按的：射程內都打不到 ⇒ 照射界挑（打不到也開，火舌噴進海裡；Tim 2026-10-18「按F無法單發開火」）
}
function gunTargetIn(sh, g, w, inR) {
  var foe = aimShip(sh); if (!foe || !foe.M) return null;
  var z = clamp(toLocal(foe, w)[2], foe.T.geo.aimZ[0], foe.T.geo.aimZ[1]), best = null, bd = 1e18;   // 高度範圍照敵艦的船型（05_hull.js GEO0）
  for (var k = 0; k <= 12; k++) {
    var p = M4.pt(foe.M, foe.T.wl0 + 15 + (foe.T.wl1 - foe.T.wl0 - 30) * k / 12, foe.T.cy, z);
    if (!bears(sh, g, p) || inR && !gunInRange(sh, g, p)) continue;
    var d = (p[0] - w[0]) * (p[0] - w[0]) + (p[2] - w[2]) * (p[2] - w[2]); if (d < bd) { bd = d; best = p; }
  }
  return best;
}
/** 有沒有哪一門（還在、有人操作的）砲有機會打中敵艦（瞄準 w；對不到 w 就看敵艦船身）；side 給了只看那一舷。 */
function anyBears(sh, w, side) { return sh.guns.some(function (g) { return g.alive && gunRate(g) > 0 && (!side || g.side === side) && !!gunTarget(sh, g, w); }); }
function shipAxis(sh) { var ax = M4.dir(sh.M, 1, 0, 0); return norm([ax[0], 0, ax[2]]); }
function aimPoint(sh) {
  var foe = foeOf(sh);
  if (handAim(sh) && !sh.autoNow && sh.pMode && sh.pMode !== 'free') { var t = modeAim(foe, sh.pMode, false).t; return M4.pt(foe.M, t[0], t[1], t[2]); }   // 我艦手動的瞄準模式：那個模式的中心點（51_captain.js）
  if (sh.aim) { var on = aimShip(sh); return M4.pt(on.M, sh.aim[0], sh.aim[1], sh.aim[2]); }   // 瞄準點是那艘的格座標
  return M4.pt(foe.M, foe.T.cx, foe.T.cy, foe.T.geo.aim);
}

/** 砲彈這一步（每 5 cm 一小段：450 m/s 的彈一步 150 段）。
 *  省時間（TASK-0531：開戰第一輪對砲幾十顆彈同時飛，每格 240–320 ms，掉到 15 FPS 以下；判定一個都不能變）：
 *    · 海面：比最高的浪（七道振幅和 1.14 m × 浪 × 天氣）還高就不可能落水 ⇒ 不算 seaH。
 *    · 繩、帆、人、模型：進了某艘船的外接球，先挑出「這一步飛得到的範圍」（這一點起算、這一步最多飛 sp × dt）裡的（ballNear），
 *      後面的小段只看這幾個（順序照原本的；模型照原本的桶、只是跳過沒挑到的）⇒ 判定與亂數順序跟全看一模一樣。量過：同一個種子戰局讀數逐字相同。
 *    量過（觀戰種子 1797，第一輪對砲最慢的一格）：繩 120–160 → 12–17 ms、人 40–46 → 1–2 ms（之後再加帆與模型）。 */
function stepBall(b, dt) {
  b.age += dt;
  var sp = len(b.v), steps = Math.max(1, Math.ceil(sp * dt / 0.05)), h = dt / steps, top = SEA_K > 0 ? 1.15 * SEA_K * WX.sea : 0, near = null;
  for (var s = 0; s < steps && b.alive; s++) {
    b.v[1] -= G * h;
    if (b.gf && (s & 7) === 0) evEmit('gfTrail', b.p.slice(), b.v.slice());   // 希臘火：零星火星（只是演出）
    if (b.fire && !b.lit && (s & 31) === 0) evEmit('gfTrail', b.p.slice(), b.v.slice());   // 火箭：同一種火星，少一點
    b.p[0] += b.v[0] * h; b.p[1] += b.v[1] * h; b.p[2] += b.v[2] * h; b.trav += len(b.v) * h;
    var sea = b.p[1] < top ? seaH(b.p[0], b.p[2], SIMT) : -1e9;         // 水面跟著浪（08_sea.js）；比最高的浪還高 ⇒ 不用算
    if (b.p[1] < sea) {
      var spd = len(b.v), ang = Math.asin(-b.v[1] / spd);
      if (!b.wet && b.ammo === 0 && !b.bounced && ang < 0.11 && spd > 90) {   // 打水漂：低角度的實心彈會跳一下
        b.v[1] = -b.v[1] * 0.45; b.v[0] *= 0.7; b.v[2] *= 0.7; b.p[1] = sea + 0.01; b.bounced = true; splash(b.p, false); continue;
      }
      if (b.ammo === AMMO_GF) { splash(b.p, false); evEmit('gfBurst', b.p.slice(), [0, 0, 0]); b.alive = false; return; }   // 希臘火落水：只有演出（28_fire.js；海上的火還沒做）
      if (!b.wet) {                                                     // 一落水：爆裂彈、鏈彈、彈重 < uwMin 的實心彈 ⇒ 沒了；大口徑實心彈 ⇒ 繼續在水裡走（TASK-0642）
        splash(b.p, true);
        if (!(b.ammo === 0 && shotM(b) >= PEN.uwMin)) { b.alive = false; return; }
        b.wet = true; b.uwR = shotR(b);
      }
      var kq = Math.exp(-PEN.uwDrag * spd * h / b.uwR);                  // 水的阻力 ∝ v²／半徑 ⇒ 每走 Δx 速度 × e^(−uwDrag·Δx／r)（XI 吋 140 → 28 m/s 約 11 m、24 磅約 6 m）
      b.v[0] *= kq; b.v[1] *= kq; b.v[2] *= kq;
      if (spd * kq < PEN_STOP) { b.alive = false; return; }
    }
    if (BED && b.p[1] < BED.top && b.p[1] < bedHgt(b.p[0], b.p[2])) { smoke(b.p.slice(), [0, 0.5, 0], 3, false); b.alive = false; return; }   // 打到陸地、海底（TASK-0721；08_seabed.js）
    for (var i = 0; i < SHIPS.length; i++) {
      var sh = SHIPS[i];
      if (i === b.owner && b.trav < 6) continue;
      var cc = sh.center, dx = b.p[0] - cc[0], dy = b.p[1] - cc[1], dz = b.p[2] - cc[2];
      if (dx * dx + dy * dy + dz * dz > sh.rad2) continue;
      var L = M4.pt(sh.inv, b.p[0], b.p[1], b.p[2]), nb = (near || (near = []))[i] || (near[i] = ballNear(sh, L, sp * dt));
      var hm = hitModel(sh, L, b.ammo === 2 ? 10 : 1.5, b.hitM, nb.id);          // 同一顆砲彈對同一個模型只算一次（穿過外框要好幾個小步；⛔ 每步都扣 ⇒ 一發扣好幾次血）
      if (hm) {                                                          // 打到模型：扣血（每發傷害 × 彈種對砲倍率；歸零整個飛出去），砲彈被擋掉一大半
        if (sh.i !== b.owner && !b.hitOnce) { SHIPS[b.owner].hits++; ffHit(sh, b); windHit(b); rptHit(b, sh, hm.gun ? 'gun' : 'model'); b.hitOnce = true; }
        (b.hitM = b.hitM || []).push(hm);
        damageModel(sh, hm, b.v, b.dmg * ammoK(b.ammo, VS_GUN), L);         // L：碰到的那一點（帶裝甲的砲 ⇒ 看是不是砲口，24_armor.js armMuzzle）
        if (b.fire && !b.lit) fireArrowHit(sh, L, b);                      // 火箭：碰到的那一點點火（28_fire.js）
        if (b.ammo === AMMO_GF) { gfSplash(sh, L, b); b.alive = false; return; }   // 希臘火打到模型：扣過血再潑開（28_fire.js）
        if (b.ammo === 1) { var kM = PEN_SK * shellK(b); explode(b.p.slice(), sh, 0); blastModels(sh, L, 22 * kM, b.p, b.hitM, b.dmg); crewHurt(sh, L, 13 * kM, 30 * kM, null, '爆炸', crewBase(b)); b.alive = false; return; }   // 直接打中的那一門已經扣過，不再吃爆風；半徑照裝藥（TASK-0621）
        b.v = mul(b.v, b.ammo === 2 ? 0.5 : 0.55);
        if (len(b.v) < 30) { ballToDebris(b); return; }
      }
      if (b.ammo === 2) cutRig(sh, L, 14, b, nb.ropes, nb.sails);
      else if ((s & 3) === 0) cutRig(sh, L, 3, b, nb.ropes, nb.sails);             // 實心與爆裂：細繩照斷、穿過帆會打洞（帆扣得少，見彈種倍率）
      if ((s & 3) === 1 && sh.i !== b.owner) crewHurt(sh, L, 4, 0, null, '砲彈', crewBase(b) * 2, nb.crew);      // 砲彈直接掠過：兩倍
      var ah = sh.arm && !sh.grid.get(L[0] | 0, L[1] | 0, L[2] | 0) ? armAt(sh, L) : null;   // 砲帶的裝甲（24_armor.js）：船殼那一格是空的才看（兩邊不重疊）；沒有裝甲的船 ⇒ 一行都不多算
      if (!ah && !sh.grid.get(L[0] | 0, L[1] | 0, L[2] | 0)) {
        if (b.ammo !== 2) continue;
        // 鏈彈：兩顆彈中間一條鏈、轉著飛，2.4 公尺寬 ⇒ 沿那條鏈現在的方向（csBar：跟畫出來的同一根）取樣，碰到哪裡就從哪裡咬下去
        var cw = csBar(b), wL = M4.dir(sh.inv, cw[0], cw[1], cw[2]), hitL = null;   // wL：鏈的方向，每公尺幾格
        for (var q = -CS_HALF; q <= CS_HALF + 1e-6 && !hitL; q += CS_HALF / 4) { var Lq = [L[0] + wL[0] * q, L[1] + wL[1] * q, L[2] + wL[2] * q]; if (sh.grid.get(Lq[0] | 0, Lq[1] | 0, Lq[2] | 0)) hitL = Lq; else if (sh.arm && (ah = armAt(sh, Lq))) hitL = Lq; }
        if (!hitL) continue;                                              // 橫掃是以彈心為中心 ⇒ 照彈心那一點咬
      }
      if (b.ammo === AMMO_GF) { if (sh.i !== b.owner && !b.hitOnce) { SHIPS[b.owner].hits++; ffHit(sh, b); windHit(b); rptHit(b, sh, 'hull'); } gfSplash(sh, L, b); b.alive = false; return; }   // 希臘火打到船殼：不開洞，潑開燒人、燒帆與細繩（28_fire.js）
      if (b.fire && !b.lit) fireArrowHit(sh, L, b);                        // 火箭打到船殼：先點火，再照實心彈咬進去
      impact(b, sh, L, ah);
      if (!b.alive) return;
    }
  }
  if (b.age > 12) b.alive = false;
}
/** 鏈彈（Tim 2026-10-17：「鍊彈 是否可以改成套用錨的鐵鍊 連接兩顆砲彈(做出真實鍊彈效果)」）：兩顆彈相距 2 × CS_HALF 公尺、中間一條錨鍊那樣的鐵鍊（76_anchor.js csBuf 畫），
 *  在垂直飛行方向的平面上轉（CS_SPIN 轉／秒；起始角 b.ph）。回傳鏈現在的方向（世界、單位向量）：角度 0 ＝ 水平（以前固定的那一根橫桿）。命中取樣（stepBall）跟畫面用同一根。 */
var CS_HALF = 1.2, CS_SPIN = 2.5;
function csBar(b) {
  var v = b.v, vl = Math.hypot(v[0], v[1], v[2]) || 1, d = [v[0] / vl, v[1] / vl, v[2] / vl];
  var sd = Math.abs(d[1]) > 0.98 ? [1, 0, 0] : norm([-d[2], 0, d[0]]), up = [sd[1] * d[2] - sd[2] * d[1], sd[2] * d[0] - sd[0] * d[2], sd[0] * d[1] - sd[1] * d[0]];   // sd：水平、垂直飛行方向；up ＝ sd × d
  var a = (b.ph || 0) + b.age * CS_SPIN * 6.28319, c = Math.cos(a), s = Math.sin(a);
  return [sd[0] * c + up[0] * s, sd[1] * c + up[1] * s, sd[2] * c + up[2] * s];
}
/** 讀數（TASK-0551）：順風打（砲線朝風吹去的方向 ⇒ 打的是自己的下風舷）／逆風打各開了幾發、中了幾發（sh.fireDn／fireUp、hitDn／hitUp）。 */
function windShot(sh, b, dx, dz) { b.dn = dx * WIND[0] + dz * WIND[2] > 0; if (b.dn) sh.fireDn = (sh.fireDn || 0) + 1; else sh.fireUp = (sh.fireUp || 0) + 1; }
function windHit(b) { var o = SHIPS[b.owner]; if (b.dn) o.hitDn = (o.hitDn || 0) + 1; else o.hitUp = (o.hitUp || 0) + 1; }
// ───────────────────────── 彈重與能量、入射角、鐵甲門檻（TASK-0621；Tim 2026-10-16）─────────────────────────
// 「小口徑炮只要夠多也能打壞鐵甲(理論上應該要大部分被彈開) 且炮的入射角是否影響」「大口徑炮非常沒有優勢(射速慢 炮少) 傷害也不足」
// 「小於一定口徑應該完全打不動鐵甲 然後在依定範圍內可以隨機」「例如有些炮可能100發中 有5發能造成傷害」「太小口徑可能1000發才有1發(甚至可以是0)」
// 「金屬應該要更能扛爆破(硬度高的材質都應該更耐爆)」「目前爆炸彈優勢太大」「大口徑爆裂彈威力可以大一點(裝藥量大)」
// 以前：打船殼只看初速與材質（彈重沒用到）、每咬一口一定先掉中心那一格（1～2 格厚的鐵甲任何砲都打得穿）、入射角沒算；爆裂彈不分口徑都炸 10～13 格。
// 現在每一發帶彈重 b.m（砲種表 shot，kg）⇒ 能量 E ＝ ½ m v²（kJ）。參數在設定檔 pen（沒寫的照下面的預設）：
//   實心彈打木頭：每咬一口照打掉的格數扣能量（每單位 wood kJ × 船殼硬度倍率），速度掉到 28 m/s 以下停 ⇒ 24 磅打橡木的總深度跟以前一樣（校準點），大的深、小的淺。
//   實心彈打有 pen 的材質（鐵甲）：法線照打中點附近 5×5×5 的格子估（surfN），θ ＝ 砲彈方向跟法線的夾角。
//     θ > rico ⇒ 彈開（照法線反射、速度剩 0.6，不掉格）。
//     否則 比值 ＝ E cos²θ ÷（pen × 沿法線量的板厚 × 船殼硬度倍率 × 娛樂的 funhard）⇒ 擊穿機率 penP：< lo ⇒ 0、> hi ⇒ 1、中間 ((比值 − lo)／(hi − lo))^k（亂數照戰局那一組）。
//     沒穿 ⇒ 不掉格、不噴碎片（凹痕只記讀數 sh.armRes），砲彈掉下去；穿了 ⇒ 沿砲彈方向把整塊板咬穿、能量扣掉門檻再往裡（b.plate：板的另一面以前不再判）。
//   碎片傷人 × √（這一口用掉的能量 ÷ splinter），夾在 0.5～2。
//   落水（TASK-0642）：實心彈、彈重 ≥ uwMin（預設 20 kg：9 吋以上）照水的阻力繼續走（uwDrag 0.019 ＝ 3/8 × Cd 0.4 × 水／鐵的比重），打得到水線下的船殼；其他一落水就沒了（不多算）。
//   爆裂彈：爆炸半徑 ＝ shellR × (彈重 ÷ ref)^⅓（裝藥 ∝ 彈重）×（硬度 ÷ HARD_BASE）^−shellHard；打在有 pen 的材質上 ⇒ 炸在外面：
//     板子吃掉一格（半徑 − 1，剩不到 0.3 ⇒ 一格都不掉）、傷人與傷模型的半徑也照硬度打折。傷人、傷模型的半徑整體 × shellR／8.3（以前 24 磅打橡木平均 8.3 格）。
var PEN = Object.assign({ lo: 0.4, hi: 1.3, k: 3, rico: 65, wood: 0.8, splinter: 50, shellR: 5.2, shellHard: 0.5, ref: 10.9, uwMin: 20, uwDrag: 0.019, muzzle: 0.3 }, CFG.pen || {});
var PEN_COS = Math.cos(PEN.rico * Math.PI / 180), PEN_SK = PEN.shellR / 8.3, PEN_STOP = 28;
function shotM(b) { return b.m > 0 ? b.m : PEN.ref; }
function shellK(b) { return Math.cbrt(shotM(b) / PEN.ref); }
/** 彈的半徑（m）：照彈重算一顆實心鐵球（比重 7.8）。水下的阻力照它（TASK-0642）。 */
function shotR(b) { return Math.cbrt(3 * shotM(b) / (4 * Math.PI * 7800)); }
/** 擊穿機率（x ＝ 有效能量 ÷ 需要的能量）。 */
function penP(x) { return x <= PEN.lo ? 0 : x >= PEN.hi ? 1 : Math.pow((x - PEN.lo) / (PEN.hi - PEN.lo), PEN.k); }
/** 打中點附近的表面法線（格座標、往外）：5×5×5 裡實心格的重心方向反過來；看不出來（四周一樣滿）⇒ 迎著砲彈。 */
function surfN(g, Q, dQ) {
  var x0 = Q[0] | 0, y0 = Q[1] | 0, z0 = Q[2] | 0, n = [0, 0, 0];
  for (var dz = -2; dz <= 2; dz++) for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) if (g.get(x0 + dx, y0 + dy, z0 + dz)) { n[0] -= dx; n[1] -= dy; n[2] -= dz; }
  var l = len(n); return l > 1e-6 ? mul(n, 1 / l) : mul(dQ, -1);
}
/** 板厚：從 Q 沿 −n 數有 pen 的材質連續幾格（最多 12）。 */
function plateT(sh, g, Q, n) {
  var t = 0;
  for (var s = 0; s < 12; s++) { var x = (Q[0] - n[0] * s) | 0, y = (Q[1] - n[1] * s) | 0, z = (Q[2] - n[2] * s) | 0; if (!g.get(x, y, z) || !(matAt(sh, x, y, z).pen > 0)) break; t++; }
  return Math.max(1, t);
}
/** ab：打到的是砲帶的裝甲（24_armor.js armAt）⇒ 拆格、硬度照它的格座標 Q（反轉 yaw；材質層的座標就是它原本的位置）；傷人、模型照船的座標 L。沒給 ＝ 船殼。 */
function impact(b, sh, L, ab) {
  var dirL = norm(M4.dir(sh.inv, b.v[0], b.v[1], b.v[2])), sp = len(b.v), r, w = b.p.slice(), Q = ab ? armIn(ab, L) : L, dQ = ab ? armIn(ab, dirL, true) : dirL;
  if (sh.i !== b.owner) { SHIPS[b.owner].hits += (b.hitOnce ? 0 : 1); if (!b.hitOnce) { ffHit(sh, b); windHit(b); rptHit(b, sh, b.wet ? 'uw' : ab ? 'armor' : 'hull'); } } b.hitOnce = true;
  var g0 = ab ? ab.grid : sh.grid, mi = matAt(sh, Q[0] | 0, Q[1] | 0, Q[2] | 0), A;
  if (b.ammo === 1) {                                                   // 爆裂彈：第一下就炸（半徑照裝藥與硬度；打在鐵甲上炸在外面）
    var ks = shellK(b), hk = Math.pow(hardAt(sh, Q) / 3, -PEN.shellHard), out = mi.pen > 0 ? hk : 1, Rb = PEN.shellR * ks * hk * rr(0.87, 1.13);
    if (mi.pen > 0) { Rb -= 1; A = sh.armRes || (sh.armRes = { pen: 0, dent: 0, rico: 0, shell: 0 }); A.shell++; }
    r = Rb > 0.3 ? shatter(sh, Q, dQ, Rb, mul(b.v, 0.05), 650, 0.85, ab) : { n: 0, cost: 0 };
    explode(w, sh, r.n); blastModels(sh, L, 22 * PEN_SK * ks * out, w, null, b.dmg); crewHurt(sh, L, 13 * PEN_SK * ks * out, 30 * PEN_SK * ks * out, null, '爆炸', crewBase(b)); b.alive = false; return;
  }
  if (b.ammo === 2) {                                                   // 鏈彈：橫著的一片
    r = gunSlab(sh, Q, dQ, b, ab);
    b.v = mul(b.v, Math.max(0, 1 - r.cost * 0.004 * HARD_BASE * sh.cfg.hard));
    if (r.n) crewHurt(sh, L, 9, 16, dirL, '鏈彈', crewBase(b));
    if (len(b.v) < 30) { ballToDebris(b); }
    if (r.n > 30) { sfx('crack', w, 0.9); smoke(w, [0, 0.2, 0], 3, false); }
    return;
  }
  var R = rr(3.4, 4.6) * (b.big ? 1.25 : b.hole || 1) * Math.pow(hardAt(sh, Q), -0.25);   // 洞照打到那一格的材質（鐵甲洞小）
  var m = shotM(b), E = 0.0005 * m * sp * sp, Estop = 0.0005 * m * PEN_STOP * PEN_STOP;   // kJ
  if (mi.pen > 0 && !(b.plate > b.trav)) {                              // 鐵甲：照入射角與能量分三條路（彈開／凹痕／擊穿）
    var n = surfN(g0, Q, dQ), c = -dot(dQ, n);
    if (b.dbg) b.dbg.push({ n: n.map(function (v) { return +v.toFixed(2); }), d: dQ.map(function (v) { return +v.toFixed(2); }), c: +c.toFixed(3), Q: Q.map(function (v) { return v | 0; }) });   // __game.shot 除錯用（b.dbg 只有量測的那一發有）
    A = sh.armRes || (sh.armRes = { pen: 0, dent: 0, rico: 0, shell: 0 });
    if (c < PEN_COS) {                                                  // 太斜 ⇒ 彈開：照法線反射、帶著六成的速度飛走，不掉格
      A.rico++;
      var rd = sub(dQ, mul(n, 2 * dot(dQ, n))), Mw = ab ? armM(ab) : sh.M, wd = norm(M4.dir(Mw, rd[0], rd[1], rd[2])), wn = norm(M4.dir(Mw, n[0], n[1], n[2]));
      b.v = add(mul(wd, sp * 0.6), sh.vel); b.p = add(b.p, mul(wn, 0.25)); b.rico = (b.rico || 0) + 1; sfx('crack', w, 0.35);
      if (b.rico > 2 || sp * 0.6 < PEN_STOP) ballToDebris(b);
      return;
    }
    var t = plateT(sh, g0, Q, n), need = mi.pen * t * sh.cfg.hard * playK('hard'), P = penP(E * c * c / need);   // playK('hard')：娛樂玩法的鐵甲硬度加成（funhard，預設 0.7；寫實 ＝ 1）
    if (b.dbg) Object.assign(b.dbg[b.dbg.length - 1], { t: t, E: +E.toFixed(1), need: +need.toFixed(1), P: +P.toFixed(3) });
    if (!(P >= 1 || (P > 0 && rnd() < P))) { A.dent++; sfx('crack', w, 0.5); ballToDebris(b); return; }   // 打不穿 ⇒ 凹痕（不掉格、不噴碎片），砲彈掉下去
    A.pen++; E -= need;                                                 // 穿了：沿砲彈方向把整塊板咬穿（板厚 ÷ cos θ 那麼長），能量扣掉門檻
    var Lt = Math.ceil(t / Math.max(c, 0.3)), nr = 0;
    for (var s2 = 0; s2 <= Lt; s2++) nr += shatter(sh, add(Q, mul(dQ, s2)), dQ, R, b.v, s2 ? 40 : 260, 0.55, ab).n;
    b.plate = b.trav + (Lt + 1) * S;
    if (nr) { crewHurt(sh, L, R * 1.1, R * 2.6, dirL, '鐵片', crewBase(b) * clamp(Math.sqrt(need / PEN.splinter), 0.5, 2)); sfx('crack', w, 1); }
    if (E <= Estop) { ballToDebris(b); return; }
    b.v = mul(b.v, Math.sqrt(2000 * E / m) / sp);
    return;
  }
  r = shatter(sh, Q, dQ, R, b.v, 260, 0.55, ab);   // 實心彈：一口一口往裡鑽（洞照口徑；越硬洞越小）
  var used = r.cost * PEN.wood * sh.cfg.hard;                       // 這一口用掉的能量（每格的消耗 × 材質，shatter 已乘）
  if (r.n) crewHurt(sh, L, R * 1.1, R * 2.6, dirL, '碎木', crewBase(b) * clamp(Math.sqrt(Math.min(used, E) / PEN.splinter), 0.5, 2));   // 碎木往前噴：船裡的人主要是被這個傷到的
  if (r.n > 0) { sfx('crack', w, 0.6 + Math.min(1, r.n / 200)); if (r.n > 40) smoke(w, mul(norm(b.v), -0.3), 2, false); }
  E -= used;
  if (E <= Estop) { ballToDebris(b); return; }
  b.v = mul(b.v, Math.sqrt(2000 * E / m) / sp);
}
/** 格座標 L 落在哪個還在的模型外框裡（外擴 m 格）。 */
function hitModel(sh, L, m, skip, nb) {                                 // skip：這顆砲彈已經打過的（略過它、找後面那一個）；nb：只看蓋了這個戳記的（stepBall 的 ballNear；沒給 ⇒ 全看）
  var bk = L[0] >= 0 ? sh.mIdx[Math.floor(L[0] / 16)] : null; if (!bk) return null;   // 只看這一桶（modelIndex；登記時外擴 12 格 ≥ 鏈彈的 10）
  for (var i = 0; i < bk.length; i++) {
    if (nb && bk[i].nb !== nb) continue;
    var o = bk[i], b = o.bb, Q = o.hd ? ndIn(o.hd, L) : L;                // 掛在砲塔上（27_turret.js）：彈點換到砲塔座標（外框照開局的擺法）
    if (o.rot) Q = unrotL(o, Q);                                          // 轉過的帆桁、迴旋砲：把彈點轉回作品裡的角度再比
    if (o.vox) continue;                                                  // 螺旋槳有自己的格（24_armor.js propSetup）⇒ 打格子（armAt），不扣模型的血
    if (o.alive && !(skip && skip.indexOf(o) >= 0) && Q[0] > b[0] - m && Q[0] < b[3] + m && Q[1] > b[1] - m && Q[1] < b[4] + m && Q[2] > b[2] - m && Q[2] < b[5] + m &&
        (m > 2 || inMesh(o, Q))) return o;                               // 實心／爆裂彈：外框裡還要真的碰到砲身或砲架（鏈彈橫掃 2.4 m ⇒ 外框就算）
  }
  return null;
}
/** 繞帆桁的轉軸（鉛直）把格座標轉 a（弧度；+x 轉向 +y 為正，跟雕刻引擎同一個方向）。 */
function rotZ(P, piv, a) { var c = Math.cos(a), s = Math.sin(a), x = P[0] - piv[0], y = P[1] - piv[1]; return [piv[0] + x * c - y * s, piv[1] + x * s + y * c, P[2]]; }
function unrotL(o, L) { return rotZ(L, o.piv, -o.rot); }
/** 模型在船的格座標裡的擺法：平移到 origin；帆桁另外繞轉軸轉 rot；掛在砲塔上（m.hd，27_turret.js）⇒ 再照砲塔現在的角度。 */
function modelLocal(m) { var L = modelLocal0(m), H = m.hd && ndMat(m.hd); return H ? M4.mul(H, L) : L; }
function modelLocal0(m) {
  if (m.swM) { var u = m.spv; return M4.mul(M4.mul(M4.mul(trans(u[0], u[1], u[2]), m.swM), trans(-u[0], -u[1], -u[2])), trans(m.origin[0], m.origin[1], m.origin[2])); }   // 繞 spv 套一整個轉動（划槳：掃＋抬，31_drive.js oarAnim；只是畫面）
  var mt = m.spinB && m.spinB.mt;                                       // 照砲轉的零件掛在迴旋砲上（26_spin.js：投石機的投臂）⇒ 繞自己的軸轉完、再繞砲的中心轉砲的 yaw
  if (m.sw || mt) { var q = m.spv, S = M4.mul(M4.mul(M4.mul(trans(q[0], q[1], q[2]), rotM(m.sax, m.sw || 0)), trans(-q[0], -q[1], -q[2])), trans(m.origin[0], m.origin[1], m.origin[2])); return mt && mt.yaw ? M4.mul(M4.mul(M4.mul(trans(mt.c[0], mt.c[1], 0), rotM([0, 0, 1], mt.yaw)), trans(-mt.c[0], -mt.c[1], 0)), S) : S; }   // 掛著擺的（小艇；30_rig_physics.js swingHangs）
  if (!m.rot || !m.piv) return trans(m.origin[0], m.origin[1], m.origin[2]);
  var p = m.piv;
  var o = m.gsl ? [m.origin[0] + m.gsl[0], m.origin[1] + m.gsl[1], m.origin[2]] : m.origin;   // gsl：迴旋砲換砲門時往後拉（TASK-0626 mountStep）
  return M4.mul(M4.mul(M4.mul(trans(p[0], p[1], p[2]), rotM([0, 0, 1], m.rot)), trans(-p[0], -p[1], -p[2])), trans(o[0], o[1], o[2]));
}
/** 格座標 L 在不在這個模型的網格裡（佔用格，外擴一格 ≈ 砲彈半徑）。⛔ 只看外框：長砲的外框 1.3 × 3.1 m，空的角落也算 ⇒ 砲甲板一半的彈都打得到砲。 */
function inMesh(o, L) {
  var oc = o.T.meshes[o.mesh] && o.T.meshes[o.mesh].occ; if (!oc) return true;
  var x = Math.floor(L[0] - o.origin[0]) + 1, y = Math.floor(L[1] - o.origin[1]) + 1, z = Math.floor(L[2] - o.origin[2]) + 1;
  return x >= 0 && y >= 0 && z >= 0 && x < oc.nx && y < oc.ny && z < oc.nz && oc.a[x + oc.nx * (y + oc.ny * z)] === 1;
}
/** 網格 ⇒ 佔用格（每格 0.1 m，座標跟網格一樣相對模型的 origin、整體位移一格）：三角形每 0.4 格取一點，往法線反方向半格那一格算實心；再外擴一格。 */
function meshOcc(m) {
  var v = m.verts, mx = [0, 0, 0], j, a;
  for (j = 0; j < v.length; j += 3) for (a = 0; a < 3; a++) mx[a] = Math.max(mx[a], v[j + a]);
  var nx = Math.ceil(mx[0]) + 3, ny = Math.ceil(mx[1]) + 3, nz = Math.ceil(mx[2]) + 3, s = new Uint8Array(nx * ny * nz), o = new Uint8Array(nx * ny * nz);
  function mark(x, y, z) { x = Math.floor(x) + 1; y = Math.floor(y) + 1; z = Math.floor(z) + 1; if (x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz) s[x + nx * (y + ny * z)] = 1; }
  for (j = 0; j < m.tris.length; j += 3) {
    var A = m.tris[j] * 3, B = m.tris[j + 1] * 3, C = m.tris[j + 2] * 3;
    var e1 = [v[B] - v[A], v[B + 1] - v[A + 1], v[B + 2] - v[A + 2]], e2 = [v[C] - v[A], v[C + 1] - v[A + 1], v[C + 2] - v[A + 2]], n = norm(cross(e1, e2));
    var st = Math.max(1, Math.ceil(Math.max(len(e1), len(e2), len(sub(e1, e2))) / 0.4));
    for (var p = 0; p <= st; p++) for (var q = 0; q <= st - p; q++) {
      var u = p / st, w = q / st;
      mark(v[A] + e1[0] * u + e2[0] * w - n[0] * 0.5, v[A + 1] + e1[1] * u + e2[1] * w - n[1] * 0.5, v[A + 2] + e1[2] * u + e2[2] * w - n[2] * 0.5);
    }
  }
  for (var z = 0; z < nz; z++) for (var y = 0; y < ny; y++) for (var x = 0; x < nx; x++) {
    if (!s[x + nx * (y + ny * z)]) continue;
    for (var dz = -1; dz <= 1; dz++) for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      var X = x + dx, Y = y + dy, Z = z + dz; if (X >= 0 && Y >= 0 && Z >= 0 && X < nx && Y < ny && Z < nz) o[X + nx * (Y + ny * Z)] = 1;
    }
  }
  var cnt = 0; for (j = 0; j < o.length; j++) cnt += o[j];
  return { nx: nx, ny: ny, nz: nz, a: o, fill: cnt / o.length };
}
/** 模型整個飛出去：剛體（拋出、翻滾、落水）；綁在它身上的砲與繩一起失效。drop ＝ 腳下甲板沒了，只是掉下去。 */
function blowModel(sh, m, vel, drop, at) {
  if (!m.alive) return;
  m.alive = false;
  if (kindProp(m.kind, 'anim') || m.spinB) { m.sw = 0; m.swM = null; }                           // 照參數轉的（26_spin.js）同一個理由：轉角只是畫面。門：開關只是演出（25_doors.js）⇒ 照關著的樣子飛出去（落水的水花抽戰局的亂數：⛔ 照開著的角度 ⇒ 演出開關會改戰局）
  var M0 = M4.mul(sh.M, modelLocal(m)), c0 = M4.pt(sh.M, m.c[0], m.c[1], m.c[2]);
  var vd = norm(vel), sp = drop ? 0 : clamp(len(vel) * 0.07, 5, 16), f;
  if (!drop && blowStyle(m) === 'fall') {                               // 被打斷、照重力掉下去（帆桁；blowStyle）
    var a1 = gauss(), a2 = rr(4, 9), a3 = gauss(), w1 = gauss(), w2 = gauss(), w3 = gauss();   // ⛔ 亂數照「飛」那一套的次數與順序抽（戰局的亂數；只是用法不同）⇒ 戰局逐字不變
    f = { v: add(add(mul(vd, clamp(len(vel) * 0.004, 0.3, 1.5)), [a1 * 0.3, (a2 - 6.5) * 0.08, a3 * 0.3]), sh.vel), w: [w1 * 0.3, w2 * 0.3, w3 * 0.3], sh: sh, land: true };
  } else f = { v: add(drop ? [0, -0.5, 0] : add(mul(vd, sp), [gauss() * 2, rr(4, 9), gauss() * 2]), sh.vel),
    w: drop ? [gauss() * 0.4, 0, gauss() * 0.4] : [gauss() * 4, gauss() * 4, gauss() * 4] };
  FLY.push(Object.assign({ T: sh.T, mesh: m.mesh, M0: M0, c0: c0, c: c0.slice(), R: M4.ident(), t: 0, wet: false }, f));
  sh.guns.forEach(function (g) { if (g.model === m) g.alive = false; });
  sh.ropes.forEach(function (r) { if (!r.dead && r.mods && r.mods.indexOf(m.k) >= 0) { r.dead = true; sh.rigDirty = true; } });
  if (m.yk) sh.rigDirty = true;                                          // 帆桁飛了 ⇒ 收在它上面的那一捲不畫（30_rig_physics.js furlLost；只是畫面旗標，物理關著也要重做）
  if (!drop && m.kind !== 'powder') {
    // 砲班跟著受傷（TASK-0568；Tim 2026-10-15）：那門砲的砲班另外算一次，3.5 m 內照距離遞減（0.7 m 內全吃）；其他人照舊 1.5 m。
    //   砲班從第一次排掉（⛔ 不排 ⇒ 站得近的被算兩次）。細節設定關掉（GUN_CREW_HURT）⇒ 完全照舊。
    //   at（TASK-0644）：打中的是帶裝甲的砲的砲口 ⇒ 爆點與碎片從那一點算（隔著裝甲的擋掉）；砲班另外吃的那一份（砲被打離砲架撞到人）照砲的中心、× pen.muzzle。
    var gc = GUN_CREW_HURT ? sh.crew.filter(function (c) { return c.st <= 1 && c.gun && c.gun.model === m; }) : [];
    if (at) {
      crewHurt(sh, at, 7, 15, null, '砲被打飛', 140);
      if (gc.length) sh.gunCrewHit = (sh.gunCrewHit || 0) + crewHurt(sh, m.c, 7, 35, null, '砲被打飛', 140 * PEN.muzzle, gc);
    } else if (gc.length) {
      crewHurt(sh, m.c, 7, 15, null, '砲被打飛', 140, sh.crew.filter(function (c) { return gc.indexOf(c) < 0; }));
      sh.gunCrewHit = (sh.gunCrewHit || 0) + crewHurt(sh, m.c, 7, 35, null, '砲被打飛', 140, gc);
    } else crewHurt(sh, m.c, 7, 15, null, '砲被打飛', 140);
    flash(c0, vd, 10, false);
    for (var i = 0; i < 14; i++) spawnPt(c0, add(mul(vd, rr(3, 12)), [gauss() * 4, rr(1, 6), gauss() * 4]), rr(0.2, 0.5), [1, 0.85, 0.5], 1, 0.25, 0.1, G, 0.5, 3);
    sfx('crack', c0, 1.3);
  }
  if (m.kind === 'wheel' || m.kind === 'tiller') note(sh, (m.kind === 'wheel' ? '舵輪' : '舵柄') + '被打飛了' + (HELM_TQ ? ' ⇒ 舵效剩 ' + Math.round(helmEff(sh) * 100) + '%' : ''));   // 舵效（TASK-0777，31_drive.js helmEff）
  else if (m.kind === 'rudder' && HELM_TQ) note(sh, (drop ? '舵掉了' : '舵被打飛了') + ' ⇒ 舵效剩 ' + Math.round(helmEff(sh) * 100) + '%');
  else if (m.kind === 'rudder') note(sh, drop ? '舵掉了' : '舵被打飛了');
  else if (m.kind === 'yard' && !drop) note(sh, '帆桁 ' + m.name.replace('yard-', '') + ' 被打斷');
  else if (GUNS[m.kind]) newsGun(sh, m, drop);                    // 廣播（同一刻好幾門 ⇒ 併成一行，見 61_hud.js）
}
/** 模型被打中：扣血（細節設定的砲血量；舵輪 6 成），歸零才整個飛出去。還撐得住 ⇒ 火星、聲音、旁邊的人被碎片波及。
 *  火藥桶另走 powderHit（歸零殉爆；拉滿 ＝ 不會爆 ⇒ 不扣）。
 *  at：砲彈碰到的那一點（stepBall 才給；爆風、殉爆不給）⇒ 帶裝甲的砲被打中的是砲口（24_armor.js armMuzzle）：藥箱在裝甲裡面 ⇒ 不引爆；碎片從那一點算。 */
function damageModel(sh, m, vel, dmg, at) {
  if (!m.alive || !(dmg > 0) || m.vox) return;                         // m.vox：螺旋槳照格子打（爆風、殉爆那幾格在 shatter／armBlast 拆）
  if (m.kind === 'powder') { powderHit(sh, m, dmg); return; }
  var muz = at && sh.arm && armMuzzle(sh, m, at) ? at : null;
  if (muz) sh.muzzleHit = (sh.muzzleHit || 0) + 1;                      // 讀數：砲口被打中幾次
  if (m.gun && !muz) boxHit(sh, m.gun, dmg);                            // 砲旁的藥箱（23_powder.js）
  m.hp -= dmg;
  if (m.hp <= 0) { blowModel(sh, m, vel, false, muz); return; }
  var c0 = M4.pt(sh.M, m.c[0], m.c[1], m.c[2]), vd = norm(vel);
  for (var i = 0; i < 8; i++) spawnPt(c0, add(mul(vd, rr(-6, -2)), [gauss() * 3, rr(1, 4), gauss() * 3]), rr(0.15, 0.35), [1, 0.8, 0.45], 1, 0.2, 0.08, G, 0.5, 3);
  crewHurt(sh, muz || m.c, 3, 8, null, '碎木', dmg * 0.7);
  sfx('crack', c0, 0.8);
}
/** 爆炸：r 格內的模型往外飛。傷害 ＝ 每發傷害 × 爆裂彈對砲倍率 × (1 − 0.75·d／r)。skip：直接打中的那一門（已經扣過）。 */
function blastModels(sh, L, r, w, skip, dmg) {
  var k = (dmg || 100) * ammoK(1, VS_GUN);
  sh.models.forEach(function (m) {
    if (!m.alive || (skip && skip.indexOf(m) >= 0)) return;
    var d = len(sub(m.c, L)); if (d > r) return;
    var cw = M4.pt(sh.M, m.c[0], m.c[1], m.c[2]);
    damageModel(sh, m, mul(norm(sub(cw, w)), 200 * (1 - d / r) + 60), k * (1 - 0.75 * d / r));
  });
}
/** 對人的基準傷害：1.4 × 每發傷害 × 彈種對人倍率（24 磅實心 ⇒ 140 ⇒ 碎木錐裡約 85% 當場陣亡，跟以前一樣）。 */
function crewBase(b) { return 1.4 * b.dmg * ammoK(b.ammo, VS_CREW); }
/** 被打飛怎麼演（Tim 2026-10-20「物件可以標meta設定該如何演出被打飛(預設就是目前的) 然後標記一下橫桁的演出meta」；TASK-0751）：
 *  'fly'（預設，跟以前一樣）＝ 往打的方向噴出去、往上拋、亂翻；'fall' ＝ 被打斷：只帶一點砲彈的推力、照重力掉、慢慢翻，掉到船上就停在船上跟著船走。
 *  模型 meta blow=fly｜fall 先看，沒有 ⇒ 規格表 config/meta_kinds.json 那個 kind 的 blow（帆桁 yard ＝ fall），都沒有 ⇒ fly。
 *  ⛔ 只是演出：FLY 只給人看（落水的水花是畫面的亂數），戰局不讀它。 */
function blowStyle(m) { var b = m.meta && m.meta.blow; return b === 'fly' || b === 'fall' ? b : kindProp(m.kind, 'blow', 'fly'); }
/** 停在船上的 'fall'（帆桁）不一直卡著（Tim 2026-10-21「掉落的桅杆在船上會穿模 且卡住一直不消失 … 過一陣子消失或是滑落水 … 可以滑一點避免卡在船上 這樣穿模就還好」）：
 *  停 FALL_SLIDE_T 秒 ⇒ 往比較近的那一舷滑（船寬方向、照船走，不看碰撞 —— 穿過舷牆只是畫面），越滑越快到 FALL_SLIDE_V；
 *  中心滑到腳下那一欄一格都沒有（出了船舷）⇒ 帶著滑出去的速度照重力掉、落水照舊漂（不再停）；
 *  停＋滑超過 FALL_REST_MAX 秒還在船上（例：卡在兩舷都是格子的地方）⇒ 拿掉。⛔ 只是演出：FLY 不讀也不抽戰局的亂數。 */
var FALL_SLIDE_T = 3, FALL_SLIDE_A = 1.2, FALL_SLIDE_V = 3, FALL_REST_MAX = 30;
function flyColFree(sh, x, y, z) { for (var k = Math.floor(z); k >= 0; k--) if (sh.grid.get(x, y, k)) return false; return true; }   // 船的格座標 (x, y) 那一欄、z 以下一格都沒有
/** 位移上限（TASK-0797）：飛出去、掉下來的模型一小步最多走一格（S 公尺）⇒ 「掉到甲板上停住」只看終點也不會一步穿過甲板；停著的照一整步；60 Hz ⇒ 不切。 */
function stepFly(f, dt) {
  var n = f.rest ? 1 : subSteps(len(f.v) * dt, S, dt, true);
  if (n === 1) return stepFly1(f, dt);
  for (var i = 0; i < n; i++) { if (!stepFly1(f, dt / n)) return false; if (f.rest) { var left = dt - dt / n * (i + 1); if (left > 1e-9) return stepFly1(f, left); return true; } }   // 中途停住了 ⇒ 剩下的時間照停著走
  return true;
}
function stepFly1(f, dt) {
  f.t += dt;
  if (f.rest) {                                                          // 停在船上（'fall' 掉到甲板、桅樓上）：跟著船走；船沉了照樣跟著下去
    f.rt = (f.rt || 0) + dt;
    if (f.rt > FALL_SLIDE_T && !f.sh.sunk) {                             // 停夠了 ⇒ 往近的那一舷滑出去
      if (!f.sd) f.sd = f.cl[1] >= f.sh.T.cy ? 1 : -1;
      f.sv = Math.min(FALL_SLIDE_V, (f.sv || 0) + FALL_SLIDE_A * dt);
      var dy = f.sd * f.sv * dt / S;                                     // 格
      f.cl = [f.cl[0], f.cl[1] + dy, f.cl[2]]; f.Ml = M4.mul(trans(0, dy, 0), f.Ml);
      f.M = M4.mul(f.sh.M, f.Ml); f.c = M4.pt(f.sh.M, f.cl[0], f.cl[1], f.cl[2]);
      if (flyColFree(f.sh, Math.floor(f.cl[0]), Math.floor(f.cl[1]), f.cl[2])) {   // 出了船舷 ⇒ 帶著滑的速度往下掉、往外慢慢翻，之後不再停
        var out = M4.dir(f.sh.M, 0, f.sd * f.sv / S, 0), ax = norm(M4.dir(f.sh.M, 1, 0, 0));
        f.rest = false; f.land = false; f.t = 0; f.M0 = f.M; f.c0 = f.c.slice(); f.R = M4.ident();
        f.v = add(f.sh.vel, out); f.w = mul(ax, -f.sd * 0.8);
      } else return f.rt < FALL_REST_MAX && f.c[1] > (VX ? vxH(f.c[0], f.c[2]) : 0) - 25;
    } else {
      f.M = M4.mul(f.sh.M, f.Ml); f.c = M4.pt(f.sh.M, f.cl[0], f.cl[1], f.cl[2]);
      if (!f.sh.grid.get(f.sup[0], f.sup[1], f.sup[2])) {               // 撐著它的那一格沒了（桅樓被打掉、桅倒了）⇒ 從現在的位置、帶著船速繼續掉（⛔ 以前停了就一直掛在原地 ⇒ 浮在半空，Tim 2026-10-20 截圖）
        f.rest = false; f.M0 = f.M; f.c0 = f.c.slice(); f.R = M4.ident(); f.v = f.sh.vel.slice(); f.w = [0, 0, 0];   // 從這一刻重新算：落下 1.5 m 之後碰到東西可以再停一次
      } else return f.rt < FALL_REST_MAX && f.c[1] > (VX ? vxH(f.c[0], f.c[2]) : 0) - 25;
    }
  }
  f.v[1] -= G * dt;
  if (f.c[1] < seaH(f.c[0], f.c[2], SIMT)) {
    if (!f.wet) { f.wet = true; splash(f.c, true); }
    f.v = mul(f.v, 1 - 2.5 * dt); f.v[1] = Math.max(f.v[1], -1.0); f.w = mul(f.w, 1 - 2 * dt);
  }
  f.c = add(f.c, mul(f.v, dt));
  var a = len(f.w) * dt; if (a > 0) f.R = M4.mul(rotM(f.w, a), f.R);
  f.M = M4.mul(M4.mul(M4.mul(trans(f.c[0], f.c[1], f.c[2]), f.R), trans(-f.c0[0], -f.c0[1], -f.c0[2])), f.M0);
  if (f.land && !f.wet && f.c0[1] - f.c[1] > 1.5 && !f.sh.sunk) {        // 'fall'：中心掉過 1.5 m 之後碰到船的格 ⇒ 停在那裡（⛔ 一開始就判 ⇒ 帆桁貼著桅，馬上停在原地）
    var L = M4.pt(f.sh.inv, f.c[0], f.c[1], f.c[2]);
    var sup = [Math.floor(L[0]), Math.floor(L[1]), Math.floor(L[2])];
    if (f.sh.grid.get(sup[0], sup[1], sup[2])) { f.rest = true; f.Ml = M4.mul(f.sh.inv, f.M); f.cl = L; f.sup = sup; }   // sup：撐著它的那一格（之後每一步看它還在不在）
  }
  return f.t < 25 && f.c[1] > (VX ? vxH(f.c[0], f.c[2]) : 0) - 25;   // 大漩渦：照漏斗那裡的水面算多深（⛔ 照 0 ⇒ 漏斗裡漂著的一出現就拿掉）
}
function meshTris(m) {
  var v = m.verts, T = [];
  for (var j = 0; j < m.tris.length; j += 3) {
    var a = m.tris[j] * 3, b = m.tris[j + 1] * 3, d = m.tris[j + 2] * 3, c = m.mats[m.tmat[j / 3]];
    var n = norm(cross([v[b] - v[a], v[b + 1] - v[a + 1], v[b + 2] - v[a + 2]], [v[d] - v[a], v[d + 1] - v[a + 1], v[d + 2] - v[a + 2]]));
    T.push(v[a], v[a + 1], v[a + 2], n[0], n[1], n[2], c[0], c[1], c[2], v[b], v[b + 1], v[b + 2], n[0], n[1], n[2], c[0], c[1], c[2],
           v[d], v[d + 1], v[d + 2], n[0], n[1], n[2], c[0], c[1], c[2]);
  }
  return new Float32Array(T);
}
function ballToDebris(b) { spawnDebris(b.p, mul(b.v, 0.3), 36, 0.15, 20); b.alive = false; }
function gunSlab(sh, L, dirL, b, ab) {                                    // ab：砲帶的裝甲（L、dirL 是它的格座標；見 impact）⛔ 不叫 a：下面的迴圈用 a
  var side = norm(cross(dirL, [0, 0, 1])), cost = 0, n = 0, removed = [], hk = Math.pow(hardAt(sh, L) / 2, -0.25);   // 越硬撕開的那一片越窄（打到那一格的材質）
  for (var a = -13; a <= 13; a++) for (var h = -2; h <= 2; h++) for (var d = -2; d <= 2; d++) {
    if (Math.abs(a) > (10.5 + 2.5 * hash3(a, h, d + (L[2] | 0))) * hk) continue;
    var x = Math.floor(L[0] + side[0] * a + dirL[0] * d), y = Math.floor(L[1] + side[1] * a + dirL[1] * d), z = Math.floor(L[2] + h);
    var c = ab ? armRemove(sh, ab, x, y, z) : removeVoxel(sh, x, y, z, true); if (c) { cost += (HARD[c] || 1) * 2.4 * matK(sh, x, y, z); n++; removed.push(x, y, z, c); }
  }
  var Mw = ab ? armM(ab) : sh.M;
  for (var j = 0; j < removed.length; j += 4) if (rnd() < 0.5) {
    var w = M4.pt(Mw, removed[j] + 0.5, removed[j + 1] + 0.5, removed[j + 2] + 0.5);
    spawnDebris(w, add(add(mul(norm(b.v), rr(4, 20)), [gauss() * 3, rr(0, 4), gauss() * 3]), sh.vel), removed[j + 3], rr(0.05, 0.11), rr(6, 12));
  }
  spawnPlates(sh, removed, norm(b.v), len(b.v), 12, 6, Mw);             // 鏈彈撕下來的那一條：片狀的多一點
  sh.impulse = add(sh.impulse, mul(norm(b.v), n * 2));
  return { cost: cost, n: n };
}
function explode(w, sh, n) {
  flash(w, [0, 1, 0], 50, true);
  for (var i = 0; i < 26; i++) spawnPt(w, [gauss() * 7, rr(1, 9), gauss() * 7], rr(0.3, 0.8), [1, rr(0.45, 0.7), 0.15], 0.9, rr(1.5, 3), rr(3, 5), 0, 2.5, 3);
  smoke(w, [0, 1, 0], 22, true); sfx('blast', w, 1.4);
}
/** 這顆彈這一步在 sh 上飛得到的範圍（格座標 L 起算、最多再飛 reach 公尺）裡的繩、帆、人、模型：碰得到這個範圍（再外擴 16 格 ≥ 斷繩的 14、
 *  傷人的 4、帆的 8、模型的 10）的才留，順序照原本的。繩與帆與模型的外框、帆桁的角度、人的位置在砲彈這一段都不會變（帆桁轉、人走路在別段）⇒ 用一整步。
 *  跟著帆桁轉的（帆、帆桁模型）：判定時把彈點繞轉軸轉回作品的角度 ⇒ 離轉軸的水平距離不變 ⇒ 用圓柱挑（轉軸到範圍的水平距離 ≤ 外框四角離轉軸最遠的 ＋ 外擴 × 1.5）。
 *  模型不另外列：蓋戳記（o.nb ＝ 這一次的編號），hitModel 照原本的桶走、沒戳記的跳過 ⇒ 打到哪一個的先後跟原本一樣。 */
var NB_ID = 0;
function ballNear(sh, L, reach) {
  var H = (reach + 0.5) / S + 16, xa = L[0] - H, xb = L[0] + H, ya = L[1] - H, yb = L[1] + H, za = L[2] - H, zb = L[2] + H, id = ++NB_ID;
  function box(bb, r) { return bb[0] - r <= xb && bb[3] + r >= xa && bb[1] - r <= yb && bb[4] + r >= ya && bb[2] - r <= zb && bb[5] + r >= za; }
  function cyl(p, bb, r) {
    if (bb[2] - r > zb || bb[5] + r < za) return false;
    var R = 0; [[bb[0], bb[1]], [bb[3], bb[1]], [bb[0], bb[4]], [bb[3], bb[4]]].forEach(function (q) { R = Math.max(R, Math.hypot(q[0] - p[0], q[1] - p[1])); });
    var dx = Math.max(xa - p[0], 0, p[0] - xb), dy = Math.max(ya - p[1], 0, p[1] - yb);
    return Math.hypot(dx, dy) <= R + r * 1.5;
  }
  sh.models.forEach(function (o) { if (o.alive && (o.rot && o.piv ? cyl(o.piv, o.bb, 10) : box(o.bb, 10))) o.nb = id; });
  return { id: id,
    ropes: sh.ropes.filter(function (rp) { return !rp.dead && box(rp.bb, 0); }),
    sails: sh.sails.filter(function (s) { var y0 = s.yards && s.yards[0], r = clothLive(sh, s) ? SAIL_HIT_BILLOW : 8; return !s.dead && !s.furled && (y0 ? cyl(y0.piv, s.bb, r) : box(s.bb, r)); }),   // 布在模擬 ⇒ 會鼓出外框，挑寬一點（cutRig 照布現在的形狀判）
    crew: sh.crew.filter(function (c) { var p = c.pos; return p[0] >= xa && p[0] <= xb && p[1] >= ya && p[1] <= yb && p[2] + 9 >= za && p[2] + 9 <= zb; }) };
}
/** 經過的繩（距離 < r 格）斷掉；鏈彈穿過帆 ⇒ 帆掉下來。ropes／sails：只看這幾條、這幾面（stepBall 先挑好的，ballNear；沒給 ⇒ 全部）。 */
function cutRig(sh, L, r, b, ropes, sails) {
  var r2 = r * r, changed = false;
  (ropes || sh.ropes).forEach(function (rp) {
    if (rp.dead) return;
    var bb = rp.bb;
    if (L[0] < bb[0] - r || L[0] > bb[3] + r || L[1] < bb[1] - r || L[1] > bb[4] + r || L[2] < bb[2] - r || L[2] > bb[5] + r) return;
    var p = rp.pts;
    for (var j = 0; j + 5 < p.length; j += 3) {
      if (segDist2(L, p[j], p[j + 1], p[j + 2], p[j + 3], p[j + 4], p[j + 5]) < r2) { rp.dead = true; rp.cutL = [L[0], L[1], L[2]]; changed = true; break; }   // cutL：垂下來的繩從這裡分成兩段
    }
  });
  // 帆：鏈彈纏上（彈心 0.8 m 內有頂點）；實心與爆裂穿過（0.4 m 內）也扣、打個小洞。扣 ＝ 每發傷害 × 彈種對帆倍率
  var chain = b.ammo === 2, rs2 = chain ? 64 : 16, rb = chain ? 8 : 4;
  (sails || sh.sails).forEach(function (s) {
    if (s.dead || s.furled) return;
    var v = s.verts, sb = s.bb;
    if (b.sails && b.sails.indexOf(s) >= 0) return;                    // 同一顆彈穿過一面帆要好幾個小步 ⇒ 只算一次（記帆本身：兩艘的同編號帆是不同的帆）
    // 帆跟著帆桁轉過 ⇒ 彈點轉回作品的角度再比（撕洞、布片照真正的彈點）。帆頂照自己的帆桁、帆腳照 footYard（course 沒有 ⇒ 0），中間照高度內插
    var y0 = s.yards && s.yards[0], aH = y0 ? y0.rot : 0, aF = s.footYard ? s.footYard.rot : 0, a = aF + (aH - aF) * clamp((L[2] - sb[2]) / Math.max(1, sb[5] - sb[2]), 0, 1);
    var Ls = y0 && a ? rotZ(L, y0.piv, -a) : L, hj = -1, j;
    var cl = clothLive(sh, s);
    if (cl) { if (clothNear(cl, L, rb)) hj = sailNearest(v, Ls); }      // 帆繩物理開著 ⇒ 照布現在的形狀（被風吹鼓、被撕的洞）判；hj 只拿來給火（從哪一點燒起來）
    else {
      if (Ls[0] < sb[0] - rb || Ls[0] > sb[3] + rb || Ls[1] < sb[1] - rb || Ls[1] > sb[4] + rb || Ls[2] < sb[2] - rb || Ls[2] > sb[5] + rb) return;
      for (j = 0; j < v.length; j += chain ? 9 : 3) { var dx = v[j] - Ls[0], dy = v[j + 1] - Ls[1], dz = v[j + 2] - Ls[2]; if (dx * dx + dy * dy + dz * dz < rs2) { hj = j; break; } }
    }
    if (hj >= 0) { j = hj;
      if (b.ammo === AMMO_GF && BURN_PCT > 0) burnSailAt(sh, s, j / 3); else { tearCloth(sh, s, L, chain ? 7 : 3, b); if (b.fire && BURN_PCT > 0) burnSailAt(sh, s, j / 3); }   // 希臘火：帆從這一點燒起來、不撕洞（49_burn.js；火勢 0 ⇒ 照舊撕）；火箭：打個小洞、也從那一點燒起來
      s.hp -= b.dmg * ammoK(b.ammo, VS_SAIL); (b.sails = b.sails || []).push(s);
      if (s.hp <= 0) dropSail(sh, s, true); else if (chain) shredSail(sh, s, L);   // 歸零才掉；還撐得住 ⇒ 撕下幾片（鏈彈）、少一份推力
      changed = true; }
  });
  if (changed) sh.rigDirty = true;
}
// 帆的命中照布現在的形狀（Tim 2026-10-19：「砲彈破壞帆 假如有開帆繩物理 會實際根據帆的變形判定命中點嗎(如果不會 希望改成會)」）：
//   以前一律比雕刻作品的帆形（跟著帆桁轉回去比），布被風吹鼓、被撕的洞都不算 ⇒ 開或關物理同一個種子走出同一局。
//   現在帆繩物理開著、這面布正在模擬（不是收著、掉了、還沒建）⇒ 彈點到布的三角形（粗格；三條邊有斷的那一格是洞，不算）的距離 < 鏈彈 0.8 m／實心與爆裂 0.4 m（跟以前同兩個距離）才算打中。
//   ⚠ 代價：開或關物理打中帆的那幾發會不同（以前已經有一格：帆桁追不追風，84_fleetlab.js 開頭）；擬真沙盒是物理全關的那一種，這一格不影響它。
var SAIL_HIT_BILLOW = 30;                                                // 布在模擬時挑帆的外框外擴幾格（ballNear；以前 8，布鼓出去會超過）
/** 這面帆正在模擬的布（沒有 ⇒ null：關物理、收著、掉了、還沒建）。 */
function clothLive(sh, s) { var c = PHYS && sh.cl ? sh.cl[s.k] : null; return c && c.p && !c.hidden && !c.gone && !c.loose ? c : null; }
/** 彈點 L 離布（還連著的三角形）r 格以內？ */
function clothNear(c, L, r) {
  var p = c.p, T = c.T.sim, n = T.n, tr = T.tris, te = T.te, r2 = r * r, i, x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (i = 0; i < n * 3; i += 3) { if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i]; if (p[i + 1] < y0) y0 = p[i + 1]; if (p[i + 1] > y1) y1 = p[i + 1]; if (p[i + 2] < z0) z0 = p[i + 2]; if (p[i + 2] > z1) z1 = p[i + 2]; }
  if (L[0] < x0 - r || L[0] > x1 + r || L[1] < y0 - r || L[1] > y1 + r || L[2] < z0 - r || L[2] > z1 + r) return false;
  for (i = 0; i < tr.length; i += 3) {
    if (c.torn && (c.brk[te[i]] || c.brk[te[i + 1]] || c.brk[te[i + 2]])) continue;
    if (triDist2(L, p, tr[i] * 3, tr[i + 1] * 3, tr[i + 2] * 3) < r2) return true;
  }
  return false;
}
/** 點 P 到三角形（p 裡的 a、b、c 三點）的最近距離²（Ericson, Real-Time Collision Detection 5.1.5）。 */
function triDist2(P, p, a, b, c) {
  var ax = p[a], ay = p[a + 1], az = p[a + 2], abx = p[b] - ax, aby = p[b + 1] - ay, abz = p[b + 2] - az, acx = p[c] - ax, acy = p[c + 1] - ay, acz = p[c + 2] - az;
  var apx = P[0] - ax, apy = P[1] - ay, apz = P[2] - az, d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz, qx, qy, qz;
  function at(u, w) { qx = ax + abx * u + acx * w; qy = ay + aby * u + acy * w; qz = az + abz * u + acz * w; var dx = P[0] - qx, dy = P[1] - qy, dz = P[2] - qz; return dx * dx + dy * dy + dz * dz; }
  if (d1 <= 0 && d2 <= 0) return at(0, 0);
  var bpx = P[0] - p[b], bpy = P[1] - p[b + 1], bpz = P[2] - p[b + 2], d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return at(1, 0);
  var vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(d1 / (d1 - d3), 0);
  var cpx = P[0] - p[c], cpy = P[1] - p[c + 1], cpz = P[2] - p[c + 2], d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return at(0, 1);
  var vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(0, d2 / (d2 - d6));
  var va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { var u = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return at(1 - u, u); }
  var dn = 1 / (va + vb + vc); return at(vb * dn, vc * dn);
}
/** 作品的帆形裡離 Ls 最近的那一點（頂點序號 × 3；給火從哪一點燒起來）。 */
function sailNearest(v, Ls) { var bj = 0, bd = 1e18; for (var j = 0; j < v.length; j += 3) { var dx = v[j] - Ls[0], dy = v[j + 1] - Ls[1], dz = v[j + 2] - Ls[2], d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; bj = j; } } return bj; }
function segDist2(p, ax, ay, az, bx, by, bz) {
  var vx = bx - ax, vy = by - ay, vz = bz - az, wx = p[0] - ax, wy = p[1] - ay, wz = p[2] - az, l2 = vx * vx + vy * vy + vz * vz;
  var t = l2 > 0 ? clamp((wx * vx + wy * vy + wz * vz) / l2, 0, 1) : 0, dx = wx - vx * t, dy = wy - vy * t, dz = wz - vz * t;
  return dx * dx + dy * dy + dz * dz;
}
/** 帆掉了：變成十來片大塊的平面布片（點精靈，不是 3D 碎屑 —— 不撞甲板、不轉四元數），飄著往下掉、碰水就沒。
 *  物理開著 ⇒ 布留著，掛在還綁著的地方擺（全鬆了就往下掉）；被打穿的那一塊已經在 tearCloth 變成真的布片（34_shreds.js）⇒ 不撒點精靈。
 *  ⛔ 亂數照抽、只是不撒 ⇒ 開或關物理，後面的亂數序列一樣（戰局不變）。 */
function dropSail(owner, s, torn) {
  s.dead = true; owner.rigDirty = true; sailLinesDie(owner, s);
  if (s.furled) return;                                              // 收在帆桁上的：跟著掉，沒有布片
  var cl = PHYS && owner.cl ? owner.cl[s.k] : null;
  if (cl && cl.gone) cl = null;
  if (cl && !cl.p) cl.late = true;                                   // 物理開著、布還沒建（開局第一步之前就掉）⇒ 下一步 physStep 照「late」建布、垂下來；⛔ 撒點精靈（那是沒物理的樣子；TASK-0579）
  else if (cl) { cl.loose = true; clothPins(owner, s, cl); }
  var M = owner.M, v = s.verts, nv = v.length / 3, n = clamp(Math.round(nv / 90), 6, 16), c = s.col || [0.95, 0.92, 0.85];
  for (var k = 0; k < n; k++) {
    var j = ((rnd() * nv) | 0) * 3, w = M4.pt(M, v[j], v[j + 1], v[j + 2]), sz = rr(1.6, 3), t = rr(0.85, 1);
    var vel = [gauss() * 1.5, rr(-0.5, 1.5), gauss() * 1.5], life = rr(5, 9);
    if (!cl) spawnPt(w, vel, life, [c[0] * t, c[1] * t, c[2] * t], 1, sz, sz * 0.85, 3, 1.2, 4);   // 終端速度 ≈ 3／1.2 ＝ 2.5 m/s，跟著風飄
  }
}
/** 帆被打中但還撐得住：撕下幾片布（不掉）。物理開著、布在 ⇒ tearCloth 已經撕下真的布片（34_shreds.js），這裡照樣抽亂數、不放（PT_MUTE）。 */
function shredSail(owner, s, L) {
  var w = M4.pt(owner.M, L[0], L[1], L[2]), c = s.col || [0.95, 0.92, 0.85], cl = owner.cl && owner.cl[s.k];
  ptMute(!!(PHYS && cl && !cl.gone));                              // 物理開著 ⇒ 不撒點精靈（布還沒建也一樣；TASK-0579）
  for (var k = 0; k < 3; k++) { var sz = rr(1.2, 2.2); spawnPt(w, [gauss() * 1.5, rr(-0.5, 1.5), gauss() * 1.5], rr(4, 7), c, 1, sz, sz * 0.85, 3, 1.2, 4); }
  ptMute(false);
}
function sailLinesDie(owner, s) { (s.lines || []).forEach(function (j) { owner.ropes[j].dead = true; owner.ropes[j].offSail = s; }); owner.rigDirty = true; }   // offSail：垂下來時靠帆的那一端放開（30_rig_physics.js spawnLoose）

