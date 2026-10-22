// ───────────────────────── 航行 ─────────────────────────
// 航速 ＝ VMAX × 還在的帆面積比例 × 風向係數（POLAR）×（進水越多越慢）；降旗 ⇒ 停船（heave to），沉了 ⇒ 0。加減速時間常數 20 秒（船重）。
// 自動操舵：讓敵艦保持在 sh.side 那一舷的正橫（sh.side ＝ 敵艦現在在哪一舷，見 chooseSide），太遠往敵艦偏、太近偏開
// ⇒ 兩艘都用同一舷 ⇒ 繞著彼此轉；一艘一舷 ⇒ 並肩同向。兩舷各有砲班、各自開火，船不必為了開火換舷。
// 手動操舵（我艦）：A／D ＝ 畫面上的左轉／右轉（打滿與回正各要 0.7 秒），轉向率 ＝ 舵角 × 最大轉向率。
// 轉向率跟航速成正比（舵要有水流過）；舵輪被打飛 ⇒ 改用舵柄滑車，只剩 35%。
// 帆裝三段（W／S）：收帆（三面上桅帆＋jib）／戰鬥帆（再加上桅頂帆、後桅縱帆、前支索帆）／滿帆（全部，預設）；
// 收起來的帆不畫、鏈彈打不到、不算航速；帆收得越多瞄得越穩。
// 頂風失速（只管手動操舵；電腦操舵照舊 —— 它不會搶風，失速會卡死）：風從船頭兩側 60° 以內吹來 ⇒ 帆被吹回來，
//   推力 ×(1 − 失速)；船頭被風推開（往原本那一舷倒，航速一半以下推得動、越慢越大）⇒ 帶著速度才轉得過去（搶風 tack），
//   太慢就卡住、被推回原本那一舷；往下風轉一圈（順風換舷 wear）永遠轉得過去。45° 以內全失速、45–60° 漸變。
//   量過（2026-10-13，滿帆、舵打滿往風裡轉）：寫實 ⇒ 從近迎風（風從船頭 65°）卡住、從橫風帶 6.5 節 71 秒搶過；娛樂 ⇒ 從近迎風 48 秒搶過。
//   失速 ＝ 細節設定的「頂風失速」（0 ＝ 頂風只是慢，係數 0.25 靠慣性帶過去）× 玩法的加成（娛樂 0.4）。
var VMAX = 3.6;                                                    // m/s（約 7 節）：滿帆、側順風
var NOGO_DEG = 60, NOGO_FULL = 45, IRONS_PUSH = 0.02;              // 頂風失速：開始、全失速的角度（風從船頭偏幾度）、船頭被推開的轉向率（rad/s，船停住時）
// 低速的轉向下限（rad/s，乘靈活性等倍率之前；Tim 2026-10-17「船在很低速時 也能有一定轉彎能力」「頂風失速時也要能轉向 我遇過頂風失速動彈不得」）：
//   現實裡舵沒水流就沒用，帆船靠帆轉（倒帆：前帆反受風把船頭推開、後帆收掉）⇒ 這裡當成「用帆轉」的那一份，航速 1.1 m/s（約 2 節）以下才用得到。
//   ⛔ 照舊 0.012 ⇒ 停住的船 0.7°/s，戰列的排頭讓船讓進頂風、停到 0.2 節後轉不出來（量過風從船頭來的開局）
var RUD_LOW = 0.03;
var POLAR = [[0, 0.72], [45, 1], [90, 0.92], [112, 0.6], [125, 0.32], [180, 0.25]];   // 船頭跟「風吹去的方向」的夾角（度）→ 係數
function polar(deg) {
  for (var i = 1; i < POLAR.length; i++) if (deg <= POLAR[i][0]) { var a = POLAR[i - 1], b = POLAR[i]; return a[1] + (b[1] - a[1]) * (deg - a[0]) / (b[0] - a[0]); }
  return POLAR[POLAR.length - 1][1];
}
// 娛樂玩法的帆速曲線下限（Tim 2026-10-17「娛樂模式可以讓頂風也能有一定加速能力」）：最低 FUN_HEAD（寫實：正頂風 0.25、離頂風 45° 0.31）⇒ 頂風推力 ×2.6（推力照航速²）。
//   0.4 ＝ 比近迎風（離頂風 60°，0.43）低一點 ⇒ 曲線照舊越頂風越慢、不會反過來鼓勵往風裡開。
//   ⛔ 先試過在 31_drive.js sailWindK 給視風倍率下限：頂風那一段本來就回 1（基準點自己吃不到風）⇒ 一位元都沒變，慢的是 vS 本身（量過：正頂風 60 秒 0.79 節，前後相同）
var FUN_HEAD = 0.4;
function polarPlay(deg) { var p = polar(deg); return PLAY === 'fun' ? Math.max(p, FUN_HEAD) : p; }
function pointName(deg) { return deg < 30 ? '順風' : deg < 70 ? '側順風' : deg < 105 ? '橫風' : deg < 125 ? '迎風' : '頂風'; }
function sailArea(s) {
  var v = s.verts, A = 0;
  for (var j = 0; j < s.tris.length; j += 3) {
    var a = s.tris[j] * 3, b = s.tris[j + 1] * 3, d = s.tris[j + 2] * 3;
    A += len(cross([v[b] - v[a], v[b + 1] - v[a + 1], v[b + 2] - v[a + 2]], [v[d] - v[a], v[d + 1] - v[a + 1], v[d + 2] - v[a + 2]])) / 2;
  }
  return A;
}
/** 船型 T 的水線（z ＝ T.zw）上船體的前後端（中線附近，T.wl0／wl1）與船頭浪位置的半寬（T.bowHalf）。⛔ 用外框 ⇒ 船頭浪出現在船首前面 24 m 的水上。 */
function waterline(T) {
  var x0 = 1e9, x1 = -1, x, y, lo = 1e9, hi = -1, G = T.base, CY = T.cy, ZW = T.zw;
  for (x = 0; x < G.sx; x++) for (y = CY - 60; y <= CY + 60; y++) if (G.get(x, y, ZW)) { if (x < x0) x0 = x; if (x > x1) x1 = x; break; }
  T.wl0 = x0; T.wl1 = x1;
  for (y = 0; y < G.sy; y++) if (G.get(x1 - 25, y, ZW)) { if (y < lo) lo = y; if (y > hi) hi = y; }
  T.bowHalf = hi >= lo ? (hi - lo) / 2 + 3 : 20;
}
/** 電腦想保持的交戰距離（m）：開局距離夾在 90～220 m（以前距離只有 90／140／220 三檔、開局就在這個距離）。
 *  武器打不到這麼遠的船（希臘火 siphon）由艦長照武器的射程再收近（54_helm.js helmRange／helmAspectR，通用；⛔ 不在這裡替哪一種砲另算）。 */
function aiRange() { return clamp(DIST, 90, 220); }
function fwd(yaw) { return [Math.cos(yaw), 0, -Math.sin(yaw)]; }          // 船頭（格 +x）在世界的方向；yaw 變大 ＝ 往格 −y（左舷 P）那一側轉 ＝ 畫面上的左轉
function sideName(side) { return side === 'S' ? '右舷' : '左舷'; }        // 模型的 S（格 +y）＝ 右舷（shipBaseMatrix 照雕刻引擎的手性）
var SAILSETS = ['全收', '收帆', '戰鬥帆', '滿帆'];
/** 帆裝 k 張不張這面帆：0 全收（一面都不張）／1 收帆（三面上桅帆＋jib）／2 戰鬥帆（再加上桅頂帆、後桅縱帆、前支索帆）／3 滿帆。
 *  收起來的帆不畫、不算航速、鏈彈打不到、依靠的格或繩斷了也不掉 —— 只有桅斷了（依靠跟著斷開的那一團走）才跟著走。 */
/** 帆裝（W／S）：這面帆最少在哪一段打開（1 收帆、2 戰鬥帆、3 滿帆）。
 *  照 meta（TASK-0539，造船規格 §9.1）：有 `set` ⇒ 照它；否則照種類 `sail` 的預設（topsail、jib 1；topgallant、gaff 2；其他 3）。
 *  沒有 meta 的舊匯出照名字（以前的規則，一一對應：結尾 topsail、jib ⇒ 1；結尾 topgallant、spanker、fore-topmast-staysail ⇒ 2；其他 3）。 */
var SAIL_SET0 = { topsail: 1, jib: 1, topgallant: 2, gaff: 2 };
function sailSetLevel(s) {
  var m = s.meta;
  if (m && m.kind === 'sail' && m.sail) return +m.set || SAIL_SET0[m.sail] || 3;
  var name = s.name;
  if (/topsail$/.test(name) || name === 'jib') return 1;
  if (/topgallant$/.test(name) || name === 'spanker' || name === 'fore-topmast-staysail') return 2;
  return 3;
}
function setHas(s, k) {
  if (k >= 3) return true;
  if (k <= 0) return false;
  return sailSetLevel(s) <= k;
}
/** 旗（餘燼號階段十九：船尾旗 ensign、主桅長旗 pennant；繩帆格式裡也是「帆」，沒有 meta ⇒ 照名字）：不收、不算推力；降旗時船尾旗降下來（strikeColors）。 */
/** 旗：照 meta `kind=flag`（TASK-0539）；有 meta 但不是 flag ⇒ 不是；沒有 meta 的舊匯出照名字（ensign／pennant／flag 開頭）。 */
function isFlag(s) { var m = s.meta; if (m && m.kind) return m.kind === 'flag'; return /^(ensign|pennant|flag)/.test(s.name); }
/** 降旗：降船尾旗（meta `flag=ensign`；沒有 meta ⇒ 名字叫 ensign 的那面）。 */
function strikeColors(sh) { sh.sails.forEach(function (s) { if (s.flag && (s.meta && s.meta.kind ? s.meta.flag === 'ensign' || s.meta.team : s.name === 'ensign')) { s.furled = true; s.struck = true; } }); sh.rigDirty = true; }
function applySailSet(sh) { sh.sails.forEach(function (s) { s.furled = s.flag ? !!s.struck : !setHas(s, sh.sailSet); }); sh.rigDirty = true; }
/** 帆段只管帆（TASK-0630；Tim 2026-10-15：「如果拆成兩套呢 然後額外動力透過Slider調整輸出(有帆的才顯示帆的 然後有額外動力的才會顯示 兩種都有就都顯示」）：
 *  全收 … 滿帆（0–3）；額外動力改由俥鐘（31_drive.js teleStep／teleSet，E／T）—— ⛔ 以前帆段兩頭多「倒車」「全速前進」兩段（sh.power 照帆段開關）。 */
function sailLevel(sh) { return sh.sailSet; }
function sailSetName(sh) { return SAILSETS[sh.sailSet]; }
function hasSails(sh) { return sh.sailArea0 > 1; }                        // 有帆（不算旗）：sailArea0 沒有帆時是 1（10_ship.js）
function sailStep(sh, d) {
  if (!hasSails(sh)) return;
  sh.sailHand = true;                                                     // 玩家自己動了帆（W／S）⇒ 自動駕駛不再替他操帆，再切一次自動駕駛才收回（54_helm.js）
  var n = clamp(sh.sailSet + d, 0, SAILSETS.length - 1); if (n === sh.sailSet) return;
  sh.sailSet = n; applySailSet(sh);
  note(sh, '帆裝：' + sailSetName(sh));
}
/** 按住加帆／收帆（Tim 2026-10-15：「長按超過一定時間（例如一秒）就逐級往上加，減帆也一樣，點一下才是只切一級」）：按下切一級（71_input.js），
 *  按住 SAIL_HOLD 秒後每 SAIL_REP 秒再切一級，到頭就停；放開（keyUp）⇒ KEYS.sw ＝ null。用 SIMT ⇒ 停格時不會自己跑。 */
var SAIL_HOLD = 1, SAIL_REP = 0.5;
function sailHold(sh) { var w = KEYS.sw; if (w && SIMT >= w.n) { sailStep(sh, w.d); w.n = SIMT + SAIL_REP; } }
function setSails(sh, k) {
  k = clamp(k, 0, SAILSETS.length - 1); if (k === sh.sailSet) return;
  sh.sailSet = k; applySailSet(sh); note(sh, '帆裝：' + SAILSETS[k]);
}
function sideGuns(sh, side) { return sh.guns.filter(function (g) { return g.alive && gunRate(g) > 0 && g.side === side; }).length; }   // 這一舷開得動的砲
// 航速（TASK-0630，31_drive.js）：這裡照舊算「每個動力單獨推動時的航速」—— 帆（滿帆、完好、這個風向）與額外動力（cfg.base 節）——
//   driveStep 把它們換成推力（k·v²）、扣掉水阻、照實際質量（含進水）算加速度；最高航速 ＝ √(帆² ＋ 額外動力²) 跟以前一樣，變的是加減速與受損的偏轉。
//   額外動力照俥鐘（sh.power ＝ 航速的比例，−1…1）；倒退時舵效反過來（像倒車）。電腦的船一直全速前進（跟以前一樣）；停船（6）照舊停。
/** ⚠ TASK-0777 起只在操舵的開關關掉時用（?helmtq=0）；開著 ⇒ 31_drive.js helmEff（舵令 ⇒ 舵輪 ⇒ 舵的鏈）。
 *  操舵性能（乘在最大轉向率上）：舵輪或舵（模型）被打掉了 ⇒ 細節設定「舵壞了的操舵」HELM_LOST（寫實 25%）× 娛樂加成 FUN.helm（×2 ⇒ 50%），最多 100%；兩樣都沒了也只乘一次。
 *  Tim 2026-10-20。⛔ 以前寫死：舵輪沒了 ×0.35、舵沒了 ×0.12、兩樣都沒了相乘（0.042）。電腦指揮官的估計（52_fleet.js cmdView v.ag）同一支。
 *  本來就沒有舵輪模型的船（舵柄：德羅蒙 dromon、fusta、punt、大加雷 reale —— 2026-10-21 逐型量過 19 型，就這四型）以前一直被當成「舵輪沒了」×0.35；
 *  Tim 2026-10-21 定：平常 ×1（「大加雷、德羅蒙平時的操舵要不要從 ×0.35 改成 ×1 (改」；fusta、punt 同一個病，問過一起改）⇒ 沒有舵輪不再算壞，只看真的被打掉的舵輪或舵。 */
function helmK(sh) {
  var whs = sh.models.filter(function (m) { return m.kind === 'wheel'; }), rud = sh.models.filter(function (m) { return m.kind === 'rudder'; });
  var lost = (whs.length && !whs.some(function (m) { return m.alive; })) || (rud.length && !rud.some(function (m) { return m.alive; }));
  return lost ? Math.min(1, HELM_LOST * playK('helm')) : 1;
}
function sailShip(sh, dt) {
  var F = fwd(sh.yaw), W = norm(WIND), deg = Math.acos(clamp(dot(F, W), -1, 1)) * 57.2958;
  var UP = sh.cfg.upwind || 1, dU = UP === 1 || deg <= 90 ? deg : 90 + (deg - 90) / UP;   // 逆風性能：迎風那一半的角度壓縮（1.25 ⇒ 風從船頭 52.5° 才開始失速、45° 跑得像 36° 的船…）；1 ⇒ 一位元都不動
  sh.sailFrac = sh.sails.reduce(function (a, s) { return a + (s.dead || s.furled ? 0 : s.area * s.hp / s.hpMax); }, 0) / sh.sailArea0;   // 被打中還沒掉的帆：照剩下的血量算推力
  sh.pos = pointName(deg);
  // 拋錨模式（6）只管我艦：SAIL 是玩家的航行模式（全域），sail() 每艘都跑 ⇒ 不限 PLAYER_I 的話，友艦、敵艦也跟著拋雙錨、停在原地（Tim 2026-10-15「應該只控制我艦」）。
  var stop = (SAIL === 'off' || modeRule('stopOwn')) && sh.i === PLAYER_I,   // 玩法規則 stopOwn（04_modes.js；建造）：停在原地（跟拋錨模式同一條）
      manual = SAIL === 'manual' && sh.i === PLAYER_I;
  if (stop && !sh.ancMode && !sh.struck && !sh.sunk) { sh.ancMode = true; anchorToggle(sh, 'P', true); anchorToggle(sh, 'S', true); }   // 6 拋錨（雙錨，我艦；76_anchor.js）
  else if (!stop && sh.ancMode) { sh.ancMode = false; anchorToggle(sh, 'P', false); anchorToggle(sh, 'S', false); }   // 切回 4／5 ⇒ 起錨
  var held = !!sh.anc && anchorHeld(sh);                              // 有錨咬著 ⇒ 不靠帆走、可以原地繞錨轉
  if (sh.i === PLAYER_I && !sh.sunk) sailHold(sh);
  var BK = (sh.cfg.base || 0) * fitPowK(sh.T);                          // fitPowK：換了主機（38_fit.js，TASK-0793）⇒ 照馬力比；沒換 ⇒ 1
  sh.thr = BK > 0 ? sh.power : null;                                // 額外動力：俥鐘（航速的比例；31_drive.js）
  sh.manual = manual;
  var SPK = sh.cfg.speed * playK('speed') * WX.speed;                 // 航速倍率（船隻設定 × 玩法的加成 × 天氣：暴風雨風大 ×1.15）；Tim：「原本的航速加成 可以當成對動力的加成」⇒ 推力 × SPK²（最高航速 × SPK）
  var nogo = manual && !stop && !sh.sunk ? STALL_K * playK('stall') * clamp((NOGO_DEG - (180 - dU)) / (NOGO_DEG - NOGO_FULL), 0, 1) : 0;   // 頂風失速的程度
  sh.irons = nogo;
  var dk = (1 - clamp(sh.sink / 9, 0, 0.8)) * (sh.struck ? 0.15 : 1) * (sh.throttle || 1);   // 進水、降旗、讓砲線（52_fleet.js lineClear；平常 1）照樣慢
  var vS = sh.sunk || stop || held ? 0 : VMAX * SPK * Math.sqrt(WIND_SPD) * polarPlay(dU) * (1 - nogo) * dk;   // 帆：這一段全都張著、完好時的航速（driveStep 再乘帆的比例 sailFrac 換成推力）
  sh.vS1 = SPK > 0 ? vS / SPK * LIM.speed[2] : 0;                     // 視風的基準點（31_drive.js sailWindK，TASK-0639）：航速倍率 ＝ 船隻設定的預設（LIM.speed，1.5）的船這個風向的航速
                                                                      //   Tim 2026-10-16：「預設設定的船航速照舊，只有比預設快的加成（娛樂 ×1.4、夜隼號 ×3）才被視風限住」
  var vB = BK > 0 && !sh.sunk && !stop && !held ? BK / 1.9438 * playK('speed') * dk : 0;   // 額外動力全速的航速（節 ⇒ m/s）× 娛樂加成（跟帆一樣：推力 × 加成²、最高航速 × 加成）；船隻設定的航速倍率、天氣（風大）不吃
  driveStep(sh, dt, vS, vB, deg, stop || held);
  if (VX) {                                                            // 大漩渦：這艘船全力往外爬坡大約推得動多快（m/s）⇒ 54_helm.js vxShipEdge 照它算這艘船自己的邊緣
    var vxA = 0; for (var vxi = 0; vxi < sh.sails.length; vxi++) { var vxs = sh.sails[vxi]; if (!vxs.dead) vxA += vxs.area * vxs.hp / vxs.hpMax; }   // 帆的完好度（不管收沒收）
    sh.vxCap = VX_CAP_UP * Math.hypot(VMAX * SPK * Math.sqrt(WIND_SPD) * polarPlay(90) * vxA / sh.sailArea0, BK > 0 ? BK / 1.9438 * playK('speed') * Math.sqrt(Math.min(1, sh.drive ? sh.drive.cap : 0)) : 0)
      * (1 - clamp(sh.sink / 9, 0, 0.8)) * (sh.struck ? 0.15 : 1);   // 能耐：橫風、帆全張時的帆速 × 完好度，加上主機；⛔ 不照現在的航向與收帆（艦長一收帆、一頂風就掉到 0 ⇒ 邊緣在 80–400 m 亂跳）；上坡最多吃掉一半推力 ⇒ × √½
  }
  if (VX) sh.spd *= vxHold(sh, dt);                                    // 大漩渦：眼裡船速被水吃掉（08_sea.js vxHold）                       // 推力、水阻、實際質量 ⇒ 加速度 ⇒ sh.spd（31_drive.js）
  if (!stop && !held && !sh.sunk && !sh.struck && (sh.i !== PLAYER_I || SAIL === 'auto')) { var thP = sh.throttle || 1; helmGovern(sh, vS / thP, vB / thP); }   // 航速調節：艦長的期望航速 ⇒ 帆裝、俥鐘（54_helm.js；vS、vB 扣掉上一步的放慢）
  else sh.helmSpill = 1;
  // 舵
  sh.throttle = 1;                                                      // 油門每一步重設（戰列跟隨、讓開砲線要放慢才改；下一步的目標航速才用到）
  var foe = foeOf(sh), tY = sh.yaw, rate = 0;
  var hk = HELM_TQ ? helmEff(sh) : helmK(sh);                         // 操舵（TASK-0777，31_drive.js）：開關開著 ⇒ 舵效（舵令 ⇒ 舵輪 ⇒ 舵的鏈）；關著 ⇒ 舊的 helmK
  var rmax = Math.max(RUD_LOW, 0.012 + 0.016 * Math.abs(sh.spd) / SPK) * hk * (UP === 1 ? 1 : 1 + (UP - 1) * clamp((deg - 90) / 45, 0, 1)) * sh.cfg.agile * playK('agile') * WX.agile;   // 天氣：暴風雨浪大、舵難使 ×0.8。⛔ 用 sh.spd 直接算 ⇒ 調快航速連帶變得更會轉
  if (sh.navT !== undefined) rmax *= sh.navT;                          // 航海士（TASK-0825，39_duty.js）：最大轉向率 ×(1 ＋ 轉向 %)；沒有航海士的船 ⇒ 不乘
  var rmaxB = HELM_TQ ? Math.max(RUD_LOW, 0.012 + 0.016 * Math.abs(sh.spd) / SPK) * (UP === 1 ? 1 : 1 + (UP - 1) * clamp((deg - 90) / 45, 0, 1)) * sh.cfg.agile * playK('agile') * WX.agile * (sh.navT !== undefined ? sh.navT : 1) : rmax;   // 舵完好時的最大轉向率（差動照它換算，TASK-0777）
  if (held && Math.abs(sh.spd) < 0.6 && !sh.struck && !sh.sunk) {   // 錨咬著、船幾乎停了 ⇒ 繞錨原地轉：我艦照 A／D、電腦（或雙錨時的我艦沒按）轉舷側對敵
    var pw = sh.i === PLAYER_I ? (KEYS.l ? 1 : 0) - (KEYS.r ? 1 : 0) : 0;
    if (pw) rate = pw * ANC_PIVOT;
    else if (sh.i !== PLAYER_I && foe) { var ps = sideGuns(sh, sh.side) || !sideGuns(sh, sh.side === 'S' ? 'P' : 'S') ? sh.side : sh.side === 'S' ? 'P' : 'S', pg = ps === 'P' ? 1 : -1, pdx = foe.px - sh.px, pdz = foe.pz - sh.pz, pd = Math.hypot(pdx, pdz) || 1;
      var pe = (pg > 0 ? Math.atan2(-pdx / pd, -pdz / pd) : Math.atan2(pdx / pd, pdz / pd)) - sh.yaw; pe = Math.atan2(Math.sin(pe), Math.cos(pe)); rate = clamp(pe * 0.5, -ANC_PIVOT, ANC_PIVOT); }
    sh.rudder = rate / ANC_PIVOT;
  }
  else if (stop) { sh.rudder = 0; rate = 0; }
  else if (manual && !sh.struck && !sh.sunk) {
    var want = (KEYS.l ? 1 : 0) - (KEYS.r ? 1 : 0);                    // 舵角正 ＝ yaw 變大 ＝ 畫面上左轉
    sh.rudder += clamp(want - sh.rudder, -1.5 * dt, 1.5 * dt);
    rate = sh.rudder * rmax * (helmRev(sh) ? -1 : 1);                  // 倒退 ⇒ 舵效反過來（左舵 ⇒ 船尾往左、船頭往右）
    if (nogo > 0) {                                                     // 船頭被風推開：往讓船頭離開風的那一側（正頂風 ⇒ 照上次那一側）
      var off = -Math.sin(sh.yaw) * W[0] - Math.cos(sh.yaw) * W[2];     // d(船頭·風吹去的方向)/d(yaw)：正 ＝ yaw 變大會離開風
      if (Math.abs(off) > 0.02) sh.ironSide = off > 0 ? 1 : -1;
      if (Math.abs(sh.rudder) > 0.3) sh.ironSide = sh.rudder * (helmRev(sh) ? -1 : 1) > 0 ? 1 : -1;   // 有打舵 ⇒ 倒帆往舵那一側推（現實：前帆反受風，船頭往要的那一側掉；⛔ 照風推的那一側 ⇒ 往另一側打舵時舵效 0.012 抵不過 0.02，停在頂風動彈不得：Tim 2026-10-17）
      rate += (sh.ironSide || 1) * nogo * IRONS_PUSH * clamp(1 - sh.spd / (VMAX * SPK * 0.5), 0, 1);
      if (nogo > 0.5 && !(SIMT - (sh.ironsT || -99) < 20)) { sh.ironsT = SIMT; note(sh, '頂風失速：帆被吹回來了 —— 帶著速度轉過去，或往下風轉一圈'); }
    }
  } else {
    // 艦長（54_helm.js）：要哪一舷對敵（一舷火力不到另一舷一半 ⇒ 轉另一舷；⛔ 以前要一門都開不了才換）、航向（敵艦在那一舷正橫 ＋ 距離修正）、期望航速（下一步 helmGovern 換成帆裝與俥鐘）
    // 指揮官的命令（53_commander.js；TASK-0679）先問：戰列跟隨（照排頭的航跡）、戰列的排頭、搶上風 ⇒ 航向與期望航速照命令；都不是 ⇒ 艦長自己的交戰操舵
    var od = ORDERS[sh.i], ok = !sh.struck && !sh.sunk, ld = ok && od && od.mode === 'line' ? SHIPS[od.leader] : null;
    var hc = ld && !ld.sunk ? helmFollow(sh, ld, od) : ok && od && od.mode === 'gauge' ? helmGauge(sh, od) : ok && od && od.mode === 'lead' ? helmLead(sh, od) : null;
    if (hc) { tY = hc.yaw; sh.wantV = hc.v; }
    else if (ok && foe) { var hs = helmSteer(sh, foe); tY = hs.yaw; sh.wantV = hs.v; } else sh.wantV = null;
    if (ok && (hc || foe)) tY = helmIrons(sh, tY);                        // 避開頂風、速度不夠就順風繞（54_helm.js；讓船在下面，照舊優先）
    if (!(ld && !ld.sunk)) { sh.station = null; sh.lineErr = sh.lineLag = sh.lineArc = sh.lineOff = undefined; }
    sh.throttle = sh.helmSpill || 1;                                     // 只靠帆的船：期望航速比夠用的那一段帆慢 ⇒ 放掉一點風（54_helm.js helmGovern）
    if (od && od.throttle !== undefined && !hc) sh.throttle = Math.min(sh.throttle, od.throttle);   // 指揮官給的油門（沙盒用；遊戲的排頭、跟隨照期望航速）
    // 接管航行的順序在 54_helm.js HELM_TAKES（淺水 ＞ 逃離漩渦 ＞ 讓友船 ＞ 讓敵艦 ＞ 讓開砲線）與各模式的限制（bound）。
    if (!sh.struck && !sh.sunk) { var av = helmTakeover(sh, { hc: hc, od: od }); if (av !== null) { tY = av; sh.avT = SIMT; } }   // 接管航行（54_helm.js HELM_TAKES：照優先級，第一個接的模式 ⇒ sh.helmMode）   // avT：最後一次讓船的時刻（讀數）   // 戰列、搶上風（hc）不讓砲線（TASK-0679）：守隊形，擋到的那幾門照 friendInLine 不開（⛔ 讓 ⇒ 接近時敵艦在前方、前一艘永遠擋著後面的砲線，排頭 35 秒、紅方排頭 80 秒都在讓，隊形散掉）   // throttle 每一步重設（lineClear 要放慢才改）   // 讓友船 ＞ 讓敵艦（不撞，54_helm.js）＞ 讓開友艦的砲線（52_fleet.js；沒有友船 ⇒ null）
    var e = Math.atan2(Math.sin(tY - sh.yaw), Math.cos(tY - sh.yaw));
    var rmaxT = HELM_TQ ? rmax + helmDifRate(sh, rmaxB) : rmax;                // 操舵（TASK-0777）：上限 ＝ 舵 ＋ 差動打滿 ⇒ 舵沒了照樣靠兩舷的推力轉；關著 ⇒ 只有舵（跟以前一樣）
    rate = clamp(e * 0.5, -rmaxT, rmaxT); sh.rudder = rmaxT > 0 ? rate / rmaxT * (helmRev(sh) ? -1 : 1) : 0;   // 倒退 ⇒ 舵反著打（畫面上的舵角；轉向照要的轉）
    if (HELM_TQ) rate = rmaxT > 0 ? rate * rmax / rmaxT : 0;            //   舵那一份（差動那一份由舵令經 driveStep 的力矩給）
  }
  if (HELM_TQ) helmYaw(sh, rate, dt, stop || (held && Math.abs(sh.spd) < 0.6), rmaxB);   // 力矩 ÷ 阻尼、轉動慣量（31_drive.js「操舵」）：舵 ＋ 帆與動力的不平衡 ＋ 差動
  else {
  if (!stop && !(held && Math.abs(sh.spd) < 0.6)) rate += driveYaw(sh, rmax);   // 受損的不平衡（前帆被打掉、一邊的螺旋槳沒了）⇒ 船自己偏（31_drive.js）；舵照舊修得回來
  sh.yawRate += (rate - sh.yawRate) * Math.min(1, dt / (2 * DRV_TURN));   // 迴轉慣性（細節設定「迴轉慣性」，預設 1 ＝ 以前的 2 秒）
  }
  sh.yaw += sh.yawRate * dt;
  if (VX) sh.yaw += vxSpin(sh, dt) + vxTurn(sh, dt);                  // 大漩渦：眼裡跟著漩渦自旋、繞行轉向（08_sea.js）
  F = fwd(sh.yaw);
  sh.vel = mul(F, sh.spd);
  if (VX) { var cf = vxFlow(sh.px, sh.pz), vd = vxDrift(sh, dt); sh.vel[0] += cf[0] + vd[0]; sh.vel[2] += cf[1] + vd[1]; }   // ＋ 漩渦吸力的漂移（08_sea.js vxDrift）   // 大漩渦（08_sea.js）：水流帶著船走 ⇒ sh.vel 是對地的速度（砲彈帶的船速、瞄準的前置量、帆上的視風都照它）
  if (sh.vxEaten && sh.sinkingFinal) { sh.spd *= Math.max(0, 1 - 0.5 * dt); sh.vel = [cf[0] - 0.3 * sh.px, 0, cf[1] - 0.3 * sh.pz]; }   // 被漩渦拖沉了（32_hull.js）：自己的船速兩秒內沒了，只跟著水流、往中心拉（⛔ 不拉 ⇒ 靠原本的航速滑出眼外才沉完）
  var px0 = sh.px, pz0 = sh.pz;
  sh.px += sh.vel[0] * dt; sh.pz += sh.vel[2] * dt;
  if (sh.anc) anchorStep(sh, dt, px0, pz0);                          // 錨咬著 ⇒ 錨鏈孔拉回鍊長以內、船繞錨鏈孔轉（76_anchor.js）
  shipWake(sh);                                                       // 航跡（52_fleet.js；戰列跟隨照它走）
  // 航跡：船尾留一條白沫、船頭兩側推出的浪（點精靈，不撞任何東西）；船邊水花開著 ⇒ 換成 13_water.js 的（這裡照樣抽亂數、不放進去）
  if ((sh.wakeT -= dt) <= 0 && sh.spd > 0.4 && sh.sink < 6) {
    sh.wakeT = 0.12; ptMute(PHX.water > 0);
    var T = sh.T, st = M4.pt(sh.M, T.wl0 - 4, T.cy, T.zw);
    spawnPt([st[0] + gauss() * 0.8, seaH(st[0], st[2], SIMT) + 0.06, st[2] + gauss() * 0.8], [0, 0, 0], rr(9, 13), [0.93, 0.96, 1], 0.3 * Math.min(1, sh.spd / 2), rr(1.2, 2), rr(4, 6), 0, 0, 2);
    [1, -1].forEach(function (k) {
      var bw = M4.pt(sh.M, T.wl1 - 25, T.cy + k * T.bowHalf, T.zw), out = M4.dir(sh.M, 0, k, 0); out = norm([out[0], 0, out[2]]);
      spawnPt([bw[0], seaH(bw[0], bw[2], SIMT) + 0.08, bw[2]], mul(out, rr(0.4, 1) * sh.spd * 0.4), rr(1.5, 2.5), [0.95, 0.97, 1], 0.5, rr(0.8, 1.3), rr(2, 3), 0, 0, 2);
    });
    ptMute(false);
  }
}

/** 船與船的碰撞（物理設定「船隻碰撞」PHX.shiphit、「船隻摩擦」PHX.shipfric；09_phx.js）。任兩艘都算（TASK-0537；照 SHIPS 的順序兩兩配對）。
 *  ⛔ 會改戰局（船推到哪、航速掉多少）—— 跟進水的粒子模式一樣，開戰時照當時的檔位跑；不抽 rnd()。
 *  · 低（原本）：兩艘的龍骨線（各取 7 點）最近不到 14 公尺 ⇒ 沿那個方向各推開一半（⛔ 不推 ⇒ 手動開過去會穿船）。
 *    Tim 2026-10-15：兩艘明明還隔著一段水面就判成撞上（每艘等於一根半徑 7 m 的膠囊，船頭船尾是圓頭）⇒ 加下面三檔。
 *  · 中：水線一帶的船殼輪廓（俯視：每一欄 x 的左右外緣）互相落進去才算。
 *  · 高／全開：船殼格子 —— 每艘外表面的格（六個方向最外面那一層：船殼、桅、艏斜桅，甲板等內面不算），高每 3 格取一、全開每格；
 *    A 的表面點換到 B 的格子座標落在實心裡（反過來也量）才算。打掉的格不算（照 sh.grid）。
 *  撞上了 ⇒ 試幾個方向（中心連線、兩艘各自的橫向）各要推開多少才分得開（二分搜），取最少的那個方向各推一半 ⇒ 擦邊時只往側面推開、可以滑過去
 *  （以前沿龍骨最近點連線推：錯開並排時那條線是斜的，等於前後也被擋住 ⇒ 黏住）。
 *  · 摩擦（shipfric）：貼著的每一步，航速扣掉「航向裡頂著對方的那一份」× 係數（正面撞照樣停、擦邊幾乎不減）；原本 ＝ 不管方向每步 ×0.97。 */
var SHIPHIT_LV = [null, { foot: 1 }, { stride: 3 }, { stride: 1 }];
var SHIPFRIC_LV = [null, { n: 0.03, t: 0.01 }, { n: 0.02, t: 0.003 }, { n: 0.012, t: 0.0008 }];   // 每步扣的比例：n ＝ 正面頂著那一份、t ＝ 擦邊那一份；null ＝ 原本（不管方向 ×0.97）
var HIT_BRUTE = false;                                                   // 除錯（__game.shipHit 第四個參數）：不走八叉樹的篩、每個點都量 ⇒ 對拍用
var HIT_PROF = { n: 0, ms: 0, max: 0, pairs: 0, touch: 0, pts: 0, nodes: 0, ram: 0, ramN: 0, ramMax: 0 };   // ram…：撞擊事件（ramTick）花了多少 ms、幾步、最久一步   // 讀數（__game.shipHit）：量了幾次、花多少 ms（最多一步幾 ms）、外框沒篩掉的配對、貼著幾次、真的換座標的點數、走過的八叉樹節點
var COL_DT = 1 / 60;                                                   // 這一次碰撞判定代表幾秒（摩擦照它換；TASK-0797：步長大時船的移動切小步，一小步判一次）
function collide(dt) {
  COL_DT = dt || DT;
  if (RAM_EV.length) { var tr = performance.now(); ramTick(COL_DT); tr = performance.now() - tr; HIT_PROF.ram += tr; HIT_PROF.ramN++; if (tr > HIT_PROF.ramMax) HIT_PROF.ramMax = tr; }                                       // 撞擊事件（物理設定「碰撞傷害」）：好幾步慢慢壓、減速、最後反彈
  if (SHIPS.length < 2) return;
  var lv = SHIPHIT_LV[PHX.shiphit] || null;
  if (!lv) {
    var K = SHIPS.map(keelPts);
    for (var i = 0; i < SHIPS.length; i++) for (var j = i + 1; j < SHIPS.length; j++) collidePair(SHIPS[i], SHIPS[j], K[i], K[j]);
    return;
  }
  var t0 = performance.now();
  for (var a = 0; a < SHIPS.length; a++) for (var b = a + 1; b < SHIPS.length; b++) collideFine(SHIPS[a], SHIPS[b], lv);
  var ms = performance.now() - t0; HIT_PROF.n++; HIT_PROF.ms += ms; if (ms > HIT_PROF.max) HIT_PROF.max = ms;
}
function keelPts(sh) { var T = sh.T, r = []; for (var k = 0; k < 7; k++) r.push(M4.pt(sh.M, T.wl0 + 15 + (T.wl1 - T.wl0 - 30) * k / 6, T.cy, T.zw)); return r; }
function collidePair(A, B, ka, kb) {
  var best = 1e9, pa = null, pb = null;
  ka.forEach(function (a) { kb.forEach(function (b) { var d = Math.hypot(a[0] - b[0], a[2] - b[2]); if (d < best) { best = d; pa = a; pb = b; } }); });
  if (best >= 14) return;
  var n = best > 1e-3 ? [(pa[0] - pb[0]) / best, 0, (pa[2] - pb[2]) / best] : [0, 0, 1], push = (14 - best) / 2;
  ramHit(A, B, n);                                                      // 撞擊（照每一格量接觸點：膠囊先碰到、格子沒碰到 ⇒ 不算）
  A.px += n[0] * push; A.pz += n[2] * push; B.px -= n[0] * push; B.pz -= n[2] * push;
  if (!ramOn(A, B)) hitFriction(A, B, n);                              // 撞擊事件進行中 ⇒ 沿 n 的減速交給 ramTick（⛔ 兩邊都扣 ⇒ 彈力 0 也被扣到倒退：量過 −0.33 m/s）
  wpBump(pa, pb, A, B);                                                // 船邊水花（13_water.js；只給人看）
  if (SIMT - (A.bumpT || -9) > 5) { A.bumpT = SIMT; sfx('crack', pa, 1); note(SHIPS[PLAYER_I], '兩艘擦撞'); }
}
/** 摩擦：n ＝ 從 B 指向 A 的接觸法線（水平單位向量）。原本 ⇒ 兩艘都 ×0.97。 */
function hitFriction(A, B, n) {
  var F = SHIPFRIC_LV[PHX.shipfric];
  if (!F) { var k0 = decay60(0.97, COL_DT); A.spd *= k0; B.spd *= k0; return; }   // 每 60 Hz 一步乘的那一份 ⇒ 照這一段幾秒換（TASK-0798）
  [[A, -1], [B, 1]].forEach(function (q) {
    var sh = q[0], f = fwd(sh.yaw), c = Math.max(0, q[1] * (f[0] * n[0] + f[2] * n[2]) * Math.sign(sh.spd || 1));   // 航向（倒車照反方向）裡往對方頂的那一份（0..1）
    sh.spd *= decay60(1 - (F.n * c + F.t * (1 - c)), COL_DT);
  });
}
// ───── 撞擊（TASK-0652；Tim 2026-10-16：「船隻的碰撞傷害(只有在相對速度夠高時才判斷) 且船隻碰撞要全高」「碰撞傷害可以開關(在物理設定)」「碰撞要全開(每格)」
//   拍板：門檻 1.5 m/s、速度照非彈性碰撞改；之後：「把碰撞過程隨能量延長計算(不只發生在一frame中)」「能量夠的話可以持續好幾frame(逐步減速 能量變成破壞力 並累積彈力動能 最後反彈)」）─────
// 物理設定「碰撞傷害」（PHX.shipdmg；關 ⇒ 這一段一行都不跑，碰撞跟以前一模一樣）。
// 撞上（ramHit：collidePair／collideFine 碰到了、推開之前呼叫）：
//   · 接近速度 du ＝ 兩艘的速度（sh.vel）在接觸法線 n（B → A）上的差；du < RAM.v0（滑桿「撞擊門檻」，預設 1.5）⇒ 不算（慢慢靠上去、推開時的擦邊）。
//   · 接觸點一律照「全開」每一格量（低檔的膠囊先碰到、格子其實沒碰到 ⇒ 不算）：A 的表面點落在 B 裡、B 的落在 A 裡，各取平均 ＝ 兩艘各自的撞點（分能量用的硬度照這兩點）。
//   · 沿 n 的有效質量 m' ＝ m ÷ max(cos², 1 ÷ RAM.side)（cos ＝ 船頭跟 n 的夾角；船只能沿船頭走、橫向由龍骨與水擋著；滑桿「側撞有效質量」預設 4）。
//   · 動能 E0 ＝ ½ μ du²（μ ＝ mA' mB'／(mA' ＋ mB')，噸 ⇒ kJ）：e²（e ＝ 滑桿「彈力係數」）存成彈力、最後反彈；1 − e² 拿去破壞 —— × RAM.k（滑桿「撞擊傷害倍率」，只乘破壞那一份），照撞點的硬度分給兩艘（硬的分得少）。
//   ⇒ 建一個撞擊事件（RAM_EV；同一對還在撞 ⇒ 不再開新的；撞完 RAM_LATCH 秒內也不開）。
// 之後每一步（ramTick，collide 開頭）：
//   · 現在的接近速度 a ＝ du ×√(1 − 吸收了幾成)；壓進去的深度 d 加 a × dt；兩艘互相壓（crushStep：A 的表面點往 −n 移 d 落在 B 的實心格 ⇒ 打掉 B 那一格，B 的往 +n 移 d 落在 A 裡 ⇒ 打掉 A 那一格，
//     每一格照材質扣那艘分到的破壞能量）；吸收了幾成 ＋＝ max(這一步用掉的破壞能量 ÷ 總共的, dt ÷ RAM_TMAX)（撞到空處也會在 RAM_TMAX（3）秒內停下；每格吸收 × RAM_CRUSH）。
//   · 速度：接近速度這一步少了多少（Δa），照有效質量分給兩艘（A −mB'／M × Δa、B ＋mA'／M × Δa，質心速度不變），ramSpd 換成航速 ⇒ 一邊壓一邊減速。
//   · 吸收滿了、或 d 到上限 RAM_DEPTH × ∛max(1, 倍率)（最多 10 m）⇒ 放出彈力：接近速度變成 −e × du（反彈分開），事件結束：
//     傷人（原因「碰撞」）、撞到的模型扣血、讀數 sh.rams、廣播「撞上 ○○（4.0 m/s，壓了 0.4 秒）—— 自己撞掉 x 噸、○○撞掉 y 噸」。碎屑每一步照當步打掉的格噴。
//   · ⛔ 以前一步做完（速度一次改好、從撞點沿 n 一口一口咬球）⇒ 50 倍鑽出一條直的隧道、撞上那一步卡 0.2 秒。
//   · 裝甲子模組不看（碰撞本來就只看船殼 sh.grid）。打穿水線下 ⇒ 照常進水（removeVoxel）。
// RAM_CRUSH：壓爛一格吸收的能量 ＝ 那一格的耗能 × 這個倍數（周圍的肋骨、甲板跟著變形吸能，不只打掉的那幾格）。⛔ 照 1（砲彈打木頭校的）⇒ 4 m/s 側撞壓 3 m 才用掉不到三分之一的能量，
//   每次都是撞到深度或時間上限才停（停的那一下速度突然掉 3.2 → 0.8 m/s），倍率 10 跟 50 一模一樣（量過）。
var RAM_EV = [], RAM_STEP = 1, RAM_DEPTH = 3, RAM_TMAX = 3, RAM_LATCH = 0.5, RAM_CRUSH = 5;
function ramHit(A, B, n) {
  if (!PHX.shipdmg) return;
  if (ramOn(A, B)) return;                                              // 這一對還在撞
  if (SIMT - ((A.ramEnd || {})[B.i] === undefined ? -99 : A.ramEnd[B.i]) < RAM_LATCH) return;   // 剛撞完（反彈還沒分開）
  var vA = A.vel || [0, 0, 0], vB = B.vel || [0, 0, 0], uA = vA[0] * n[0] + vA[2] * n[2], uB = vB[0] * n[0] + vB[2] * n[2], du = uB - uA;   // A 在 +n 那一側：A 往 −n、B 往 +n ⇒ 接近
  if (du < RAM.v0) return;
  var lv = SHIPHIT_LV[3], pa = [], pb = [];
  hitCount(A, B, lv, [0, 0, 0], pa, false); hitCount(B, A, lv, [0, 0, 0], pb, false);
  if (!pa.length && !pb.length) return;
  function mean(P) { var s = [0, 0, 0], k = P.length / 3; for (var i = 0; i < P.length; i += 3) { s[0] += P[i]; s[1] += P[i + 1]; s[2] += P[i + 2]; } return [s[0] / k, s[1] / k, s[2] / k]; }
  function across(P, F, T) { var w = M4.pt(F.M, P[0], P[1], P[2]); return M4.pt(T.inv, w[0], w[1], w[2]); }   // F 的格座標 ⇒ T 的格座標
  var QA = pa.length ? mean(pa) : across(mean(pb), B, A), QB = pb.length ? mean(pb) : across(mean(pa), A, B);
  var kA = ramK(A, n), kB = ramK(B, n), mA = (A.mass0 || shipT(A)) / kA, mB = (B.mass0 || shipT(B)) / kB, mu = mA * mB / (mA + mB), E0 = 0.5 * mu * du * du;   // 沿 n 的有效質量（ramK）
  var e = RAM.e, Ed = E0 * (1 - e * e) * RAM.k, hA = hardAt(A, QA), hB = hardAt(B, QB), eA = Ed * hB / (hA + hB);
  RAM_EV.push({ A: A, B: B, n: n, kA: kA, kB: kB, mA: mA, mB: mB, du: du, a: du, e: e, E0: E0, Ed: Ed, bud: [eA, Ed - eA], eA: eA, eB: Ed - eA, abs: 0, d: 0,
    maxD: Math.min(10, RAM_DEPTH * Math.cbrt(Math.max(1, RAM.k))), rem: [[], []], t0: [massLost(A), massLost(B)], ts: SIMT });
  var w = M4.pt(A.M, QA[0], QA[1], QA[2]); sfx('crack', w, 1.6); smoke(w, [0, 0.4, 0], 3, false);
}
/** 撞擊事件每一步（collide 開頭；dt ＝ 一步）：壓、減速；吸收滿了 ⇒ 反彈、收尾。 */
function ramTick(dt) {
  for (var q = RAM_EV.length - 1; q >= 0; q--) {
    var v = RAM_EV[q], A = v.A, B = v.B, n = v.n, done = SHIPS.indexOf(A) < 0 || SHIPS.indexOf(B) < 0 || A.sunk || B.sunk;
    if (!done) {
      var a = v.du * Math.sqrt(Math.max(0, 1 - v.abs)); v.d += a * dt;
      if (v.d > v.maxD) v.abs = 1;
      else {
        var r0 = [v.rem[0].length, v.rem[1].length], used = 0, u;
        if (v.bud[1] > 0) { u = crushStep(B, A, [-n[0] * v.d, 0, -n[2] * v.d], v.rem[1], v.bud[1]); v.bud[1] -= u; used += u; }   // A 往 −n 壓進 B
        if (v.bud[0] > 0) { u = crushStep(A, B, [n[0] * v.d, 0, n[2] * v.d], v.rem[0], v.bud[0]); v.bud[0] -= u; used += u; }     // B 往 +n 壓進 A
        v.abs = Math.min(1, v.abs + Math.max(v.Ed > 0 ? used / v.Ed : 0, dt / RAM_TMAX));
        crushDebris(A, v.rem[0], r0[0], n); crushDebris(B, v.rem[1], r0[1], [-n[0], 0, -n[2]]);
      }
      var a2 = v.abs >= 1 ? -v.e * v.du : v.du * Math.sqrt(1 - v.abs), M = v.mA + v.mB;   // 壓到底 ⇒ 放出彈力：接近速度 −e × du（分開）
      var da = a2 - v.a; v.a = a2;                                       // 接近速度這一步少了多少 ⇒ 照有效質量分給兩艘（質心速度不變）
      ramSpd(A, -v.mB / M * da, n, v.kA, v.e); ramSpd(B, v.mA / M * da, n, v.kB, v.e);
      if (v.abs < 1) continue;
    }
    RAM_EV.splice(q, 1);
    (A.ramEnd || (A.ramEnd = {}))[B.i] = SIMT; (B.ramEnd || (B.ramEnd = {}))[A.i] = SIMT;
    var lA = crushAfter(A, v.rem[0], n, v.eA, B, v, v.t0[0], v.bud[0]), lB = crushAfter(B, v.rem[1], [-n[0], 0, -n[2]], v.eB, A, v, v.t0[1], v.bud[1]);
    note(A, '<b style="color:#ffb35a">撞上' + ramWho(B) + '</b>（' + v.du.toFixed(1) + ' m/s，壓了 ' + (SIMT - v.ts).toFixed(1) + ' 秒）—— 自己撞掉 ' + ramTons(lA) + ' 噸、' + ramWho(B) + '撞掉 ' + ramTons(lB) + ' 噸', true);   // 廣播（Tim：「觸發碰撞傷害是否可以廣播(撞掉多少噸)」）：每一次撞擊都報
  }
}
function ramWho(sh) { return sh.i === PLAYER_I ? '我艦' : sh.name; }
function ramTons(t) { return t.toFixed(t < 1 ? 2 : 1); }                 // 不到 1 噸 ⇒ 小數兩位（一格 0.1 m 見方：500 格才 0.35 噸）
/** 沿 n 的有效質量倍率的倒數：max(cos², 1 ÷ RAM.side)（cos ＝ 船頭跟 n 的夾角）。 */
function ramK(sh, n) { var f = fwd(sh.yaw), c = f[0] * n[0] + f[2] * n[2]; return Math.max(c * c, 1 / RAM.side); }
/** 這一步沿 n 給的速度增量 dU（有效質量算出來的）⇒ 航速改 dU × cos ÷ k（k ＝ ramK；船只能沿船頭走，沿 n 實際只變 dU × cos² ÷ k，其餘由龍骨與水擋掉、推開照舊）。
 *  ⛔ 以前 dU ÷ cos ⇒ 側面被撞的那艘（船頭跟 n 幾乎垂直）航速被放大：0 → 7.4 m/s，接著再撞一次（量過）。
 *  ⛔ 每一步把沿 n 的速度「設成目標值」（差多少補多少）⇒ 只推得動一部分的那艘每一步繼續補，最後收斂到 目標 ÷ cos：側面被撞的那艘撞完 2.6 m/s（量過）⇒ 只給增量。 */
function ramSpd(sh, dU, n, k, e) {
  var f = fwd(sh.yaw), c = f[0] * n[0] + f[2] * n[2], s = sh.spd + dU * c / k;
  if (!(e > 0) && sh.spd * s < 0) s = 0;                               // 沒有彈力 ⇒ 頂多停下來、不倒退
  sh.spd = s; sh.vel = mul(f, s);
}
/** 這一對正在撞（撞擊事件進行中）。 */
function ramOn(A, B) { for (var q = 0; q < RAM_EV.length; q++) { var o = RAM_EV[q]; if ((o.A === A && o.B === B) || (o.A === B && o.B === A)) return true; } return false; }
/** I 照世界位移 s 壓進 V：I 還在的表面點（全開取樣）落在 V 的實心格 ⇒ 打掉那一格（記進 rem），用到 budget 為止。回用掉多少 kJ。
 *  每一格照材質扣（(HARD[色] 或 1) × matK × PEN.wood × 船殼硬度倍率，跟 shatter 的耗能同一套）；被壓爛的格不再往前壓（hitCount 只看還在的格）⇒ 船頭越壓越鈍。 */
function crushStep(V, I, s, rem, budget) {
  var acc = []; hitCount(I, V, SHIPHIT_LV[3], s, acc, false);
  if (!acc.length) return 0;
  var C = M4.mul(V.inv, I.M), J = V.inv, ox = J[0] * s[0] + J[8] * s[2], oy = J[1] * s[0] + J[9] * s[2], oz = J[2] * s[0] + J[10] * s[2], used = 0, k = V.cfg.hard * PEN.wood * RAM_CRUSH;
  for (var i = 0; i < acc.length && used < budget; i += 3) {
    var x = acc[i], y = acc[i + 1], z = acc[i + 2];
    var X = Math.floor(C[0] * x + C[4] * y + C[8] * z + C[12] + ox), Y = Math.floor(C[1] * x + C[5] * y + C[9] * z + C[13] + oy), Z = Math.floor(C[2] * x + C[6] * y + C[10] * z + C[14] + oz);
    var col = removeVoxel(V, X, Y, Z, true); if (!col) continue;
    used += (HARD[col] || 1) * matK(V, X, Y, Z) * k; rem.push(X, Y, Z, col);
  }
  return used;
}
/** 這一步新打掉的格（rem 從第 r0 個起）⇒ 碎屑、片狀碎塊（往 dW：這艘船裡的方向，世界）。 */
function crushDebris(sh, rem, r0, dW) {
  var k = (rem.length - r0) / 4; if (!k) return;
  var part = rem.slice(r0), pr = Math.min(1, 40 / k), vd = norm(dW);
  for (var i = 0; i < part.length; i += 4) {
    if (rnd() > pr) continue;
    var w = M4.pt(sh.M, part[i] + 0.5, part[i + 1] + 0.5, part[i + 2] + 0.5);
    spawnDebris(w, add(add(mul(vd, rr(0.5, 3)), [gauss() * 2.5, rr(0.5, 4), gauss() * 2.5]), sh.vel || [0, 0, 0]), part[i + 3], rr(0.05, 0.11), rr(6, 14));
  }
  spawnPlates(sh, part, vd, 20, 8, 2, sh.M);
}
/** 撞擊結束：一艘打掉的那一片（rem：[x, y, z, 色] …，格座標）⇒ 傷人、模型扣血、讀數。dW ＝ 往這艘船裡的方向（世界）。回撞掉幾噸。 */
function crushAfter(sh, rem, dW, e, other, v, t0, left) {
  var n = rem.length / 4, c = [0, 0, 0], ext = 0, i;
  if (n) {
    for (i = 0; i < rem.length; i += 4) { c[0] += rem[i]; c[1] += rem[i + 1]; c[2] += rem[i + 2]; }
    c = [c[0] / n + 0.5, c[1] / n + 0.5, c[2] / n + 0.5];
    for (i = 0; i < rem.length; i += 4) ext = Math.max(ext, Math.hypot(rem[i] + 0.5 - c[0], rem[i + 1] + 0.5 - c[1], rem[i + 2] + 0.5 - c[2]));
    var dL = norm(M4.dir(sh.inv, dW[0], 0, dW[2])), R = Math.max(2, ext), k2 = clamp(Math.sqrt(e / 1000), 0.3, 1.5);
    crewHurt(sh, c, R * 0.8, R * 1.6, dL, '碰撞', 140 * k2);
    sh.models.forEach(function (m) { if (!m.alive) return; var d = len(sub(m.c, c)); if (d < R * 1.5) damageModel(sh, m, mul(dW, 6), 120 * k2 * (1 - 0.6 * d / (R * 1.5))); });
  }
  var t = massLost(sh) - t0;
  (sh.rams || (sh.rams = [])).push({ t: +v.ts.toFixed(2), dur: +(SIMT - v.ts).toFixed(2), with: other.i, du: +v.du.toFixed(2), E: Math.round(v.E0), Ed: Math.round(v.Ed), e: Math.round(e), lost: n, t_lost: +t.toFixed(2), left: Math.round(left), d: +v.d.toFixed(2), ext: +(ext * S).toFixed(2) });
  return t;
}
/** 開局（70_flow.js reset）先把這一場會用到的碰撞取樣建好：船隻碰撞那一檔、碰撞傷害開著再加全開那一份、格子檔的佔用金字塔。只是快取（不碰亂數、不改戰局）。
 *  Tim 2026-10-16：「碰撞精度也是物理效果中就開滿(可以測試效能占用)」—— 量過：憲法號全開取樣 24.8 萬點 93.5 ms，以前在第一次碰到的那一步現場建（那一步 96 ms）。 */
function hitWarm() { stepsRun(hitWarmSteps()); }
/** hitWarm 拆成步驟（每個船型每一檔：取樣 hitSampleSteps 的那幾步、佔用金字塔各一步；70_flow.js startStaged 分段做）。照順序做 ＝ 拆之前的 hitWarm。 */
function hitWarmSteps() {
  var L = [SHIPHIT_LV[PHX.shiphit], PHX.shipdmg ? SHIPHIT_LV[3] : null], seen = {}, out = [];
  SHIPS.forEach(function (sh) {
    if (seen[sh.T.id]) return; seen[sh.T.id] = 1;
    L.forEach(function (lv) { if (!lv) return; out.push(function () { return hitSampleSteps(sh.T, lv).concat(lv.foot ? [] : [function () { occPyr(sh.T); }]); }); });
  });
  return out;
}
/** 船型 T 的碰撞取樣（第一次用到才算、每個船型每一檔只算一次；HIT_PROF 記花了多久）：
 *  foot ⇒ { f0, f1 }：水線下 1 m 到水線上 4 m 那一段，每一欄 x 的 y 最小／最大（沒有 ⇒ -1）＋ 外緣點（每 2 欄取一）；
 *  stride k ⇒ Int16Array [x, y, z, …]：六個方向最外面那一格（俯視 (x,y) 的最高／最低、(x,z) 的兩舷、(y,z) 的船頭船尾），座標照 k 取一。 */
function hitSamples(T, lv) {
  var key = lv.foot ? 'foot' : 's' + lv.stride; T.hit = T.hit || {};
  if (!T.hit[key]) stepsRun(hitSampleSteps(T, lv));
  return T.hit[key];
}
/** hitSamples 拆成步驟（2026-10-20；70_flow.js startStaged 開局分段做，憲法號全開一次約 0.1 s）：foot 一步；stride ⇒ 六個方向最外面那一格（照區塊層分段）、外圍的點（三個方向各一步）、排序、八叉樹。已經有了 ⇒ []。
 *  照順序做 ＝ 拆之前的 hitSamples（只是快取：不碰亂數、不改戰局）。 */
function hitSampleSteps(T, lv) {
  var key = lv.foot ? 'foot' : 's' + lv.stride; T.hit = T.hit || {};
  if (T.hit[key]) return [];
  var G = T.base, sx = G.sx, sy = G.sy, sz = G.sz, ms = 0, P = null, E = null;
  function done(out, t0) { out.ms = +(ms + performance.now() - t0).toFixed(1); out.n = out.pts.length / 3; T.hit[key] = out; }
  if (lv.foot) return [function () {
    var t0 = performance.now(), out;
    var z0 = Math.max(0, Math.round(T.zw - 1 / S)), z1 = Math.min(sz - 1, Math.round(T.zw + 4 / S)), f0 = new Int16Array(sx).fill(-1), f1 = new Int16Array(sx).fill(-1), pts = [];
    G.each(function (x, y, z) { if (z < z0 || z > z1) return; if (f0[x] < 0 || y < f0[x]) f0[x] = y; if (y > f1[x]) f1[x] = y; });
    for (var x = 0; x < sx; x += 2) if (f0[x] >= 0) pts.push(x, f0[x], T.zw, x, f1[x], T.zw);
    out = { f0: f0, f1: f1, pts: new Int16Array(pts) };
    done(out, t0);
  }];
  return [function () {
    var t0 = performance.now();
    var k = lv.stride, NA = sx * sz, NB = sx * sy, NC = sy * sz;
    var ylo = new Int16Array(NA).fill(-1), yhi = new Int16Array(NA).fill(-1), zlo = new Int16Array(NB).fill(-1), zhi = new Int16Array(NB).fill(-1), xlo = new Int16Array(NC).fill(-1), xhi = new Int16Array(NC).fill(-1);
    E = [ylo, yhi, zlo, zhi, xlo, xhi]; ms += performance.now() - t0;
    function cell(x, y, z) {                                             // 每一格：六個方向最外面那一格（只取最大最小 ⇒ 跟走的先後無關）
      var a = x + sx * z, b = x + sx * y, c = y + sy * z;
      if (ylo[a] < 0 || y < ylo[a]) ylo[a] = y; if (y > yhi[a]) yhi[a] = y;
      if (zlo[b] < 0 || z < zlo[b]) zlo[b] = z; if (z > zhi[b]) zhi[b] = z;
      if (xlo[c] < 0 || x < xlo[c]) xlo[c] = x; if (x > xhi[c]) xhi[c] = x;
    }
    return [stepsLoop(0, G.nz, function (cz) { var t1 = performance.now(); gridEachZ(G, cz, cell); ms += performance.now() - t1; }, 15)];   // 整份格子照區塊層分段走（G.each 的順序）
  }, function () {
    var t0 = performance.now(), k = lv.stride, i, j; P = []; E.push(new Set());
    function add(x, y, z) { var h = x + 2048 * (y + 2048 * z), seen = E[6]; if (!seen.has(h)) { seen.add(h); P.push(x, y, z); } }
    var ylo = E[0], yhi = E[1];
    for (j = 0; j < sz; j += k) for (i = 0; i < sx; i += k) { var a2 = i + sx * j; if (ylo[a2] >= 0) { add(i, ylo[a2], j); add(i, yhi[a2], j); } }
    ms += performance.now() - t0;
  }, function () {
    var t0 = performance.now(), k = lv.stride, i, j, zlo = E[2], zhi = E[3];
    function add(x, y, z) { var h = x + 2048 * (y + 2048 * z), seen = E[6]; if (!seen.has(h)) { seen.add(h); P.push(x, y, z); } }
    for (j = 0; j < sy; j += k) for (i = 0; i < sx; i += k) { var b2 = i + sx * j; if (zlo[b2] >= 0) { add(i, j, zlo[b2]); add(i, j, zhi[b2]); } }
    ms += performance.now() - t0;
  }, function () {
    var t0 = performance.now(), k = lv.stride, i, j, xlo = E[4], xhi = E[5];
    function add(x, y, z) { var h = x + 2048 * (y + 2048 * z), seen = E[6]; if (!seen.has(h)) { seen.add(h); P.push(x, y, z); } }
    for (j = 0; j < sz; j += k) for (i = 0; i < sy; i += k) { var c2 = i + sy * j; if (xlo[c2] >= 0) { add(xlo[c2], i, j); add(xhi[c2], i, j); } }
    E = null; ms += performance.now() - t0;
  }, function () {
    var t0 = performance.now(), out, i, k = lv.stride;
    // 八叉樹（Tim 2026-10-15）：點照 16³ 格塊分成葉子（點照葉子排好、各記 [a, b) 與外框），往上每 2×2×2 合成一個節點直到只剩一個根；
    //   hitCount 從根往下：節點外框換到對方座標、落在對方的空區（occPyr）⇒ 整棵子樹跳過
    var leafOf = function (u) { return (P[u] >> 4) + 128 * ((P[u + 1] >> 4) + 128 * (P[u + 2] >> 4)); };
    var idx = []; for (i = 0; i < P.length; i += 3) idx.push(i);
    idx.sort(function (u, v) { return leafOf(u) - leafOf(v) || u - v; });
    var Q = new Int16Array(P.length);
    idx.forEach(function (u, r) { Q[r * 3] = P[u]; Q[r * 3 + 1] = P[u + 1]; Q[r * 3 + 2] = P[u + 2]; });
    ms += performance.now() - t0; E = Q;
  }, function () {
    var t0 = performance.now(), out, Q = E, nodes = []; E = null;
    for (var r0 = 0; r0 < Q.length;) {
      var c0 = [Q[r0] >> 4, Q[r0 + 1] >> 4, Q[r0 + 2] >> 4], r1 = r0, lo = [1e9, 1e9, 1e9], hi = [-1, -1, -1];
      while (r1 < Q.length && (Q[r1] >> 4) === c0[0] && (Q[r1 + 1] >> 4) === c0[1] && (Q[r1 + 2] >> 4) === c0[2]) { for (var c3 = 0; c3 < 3; c3++) { lo[c3] = Math.min(lo[c3], Q[r1 + c3]); hi[c3] = Math.max(hi[c3], Q[r1 + c3] + 1); } r1 += 3; }
      nodes.push({ c: c0, a: r0, b: r1, lo: lo, hi: hi, kids: null }); r0 = r1;
    }
    var nLeaf = nodes.length, depth = 0;
    while (nodes.length > 1) {                                             // 往上合：同一個父格（座標 >> 1）的收在一起
      var par = new Map();
      nodes.forEach(function (nd) {
        var pc = [nd.c[0] >> 1, nd.c[1] >> 1, nd.c[2] >> 1], pk = pc[0] + 1024 * (pc[1] + 1024 * pc[2]), pn = par.get(pk);
        if (!pn) { pn = { c: pc, lo: nd.lo.slice(), hi: nd.hi.slice(), kids: [] }; par.set(pk, pn); }
        for (var c4 = 0; c4 < 3; c4++) { pn.lo[c4] = Math.min(pn.lo[c4], nd.lo[c4]); pn.hi[c4] = Math.max(pn.hi[c4], nd.hi[c4]); }
        pn.kids.push(nd);
      });
      nodes = Array.from(par.values()); depth++;
    }
    out = { pts: Q, root: nodes[0], leaves: nLeaf, depth: depth };
    done(out, t0);
  }];
}
/** A 的取樣點換到 B 的格子座標落在實心裡的有幾個；s ＝ A 相對 B 往世界的 (sx, sz) 多移多少（m）。外框先篩：中心距離超過兩艘半長之和 ⇒ 0。 */
function hitCount(A, B, lv, s, acc, any) {                              // any ⇒ 碰到第一個就停（只要知道還有沒有碰到：推開的二分搜）
  var SA = hitSamples(A.T, lv), C = M4.mul(B.inv, A.M), I = B.inv, P = SA.pts, n = 0, GA = A.grid, GB = B.grid;
  var ox = I[0] * s[0] + I[8] * s[2], oy = I[1] * s[0] + I[9] * s[2], oz = I[2] * s[0] + I[10] * s[2];   // 世界的位移換到 B 的格子座標（只有旋轉那一部分）
  var m0 = C[0], m1 = C[1], m2 = C[2], m4 = C[4], m5 = C[5], m6 = C[6], m8 = C[8], m9 = C[9], m10 = C[10], t0 = C[12] + ox, t1 = C[13] + oy, t2 = C[14] + oz;
  if (lv.foot) {
    var SB = hitSamples(B.T, lv);
    for (var q = 0; q < P.length; q += 3) {
      var x = P[q] + 0.5, y = P[q + 1] + 0.5, z = P[q + 2] + 0.5;
      var bx = Math.floor(m0 * x + m4 * y + m8 * z + t0), by = Math.floor(m1 * x + m5 * y + m9 * z + t1);
      if (bx < 0 || bx >= SB.f0.length || SB.f0[bx] < 0 || by < SB.f0[bx] || by > SB.f1[bx]) continue;
      n++; if (acc) acc.push(x, y, z); if (any) return n;
    }
    return n;
  }
  var OP = occPyr(B.T), lo = [0, 0, 0], hi = [0, 0, 0];
  (function visit(K) {
    lo[0] = lo[1] = lo[2] = 1e9; hi[0] = hi[1] = hi[2] = -1e9;
    for (var cn = 0; cn < 8; cn++) {                                     // 節點外框八個角換到 B 的座標 ⇒ 落在 B 的空區就整棵子樹跳過
      var cx = cn & 1 ? K.hi[0] : K.lo[0], cy = cn & 2 ? K.hi[1] : K.lo[1], cz = cn & 4 ? K.hi[2] : K.lo[2];
      var qx = m0 * cx + m4 * cy + m8 * cz + t0, qy = m1 * cx + m5 * cy + m9 * cz + t1, qz = m2 * cx + m6 * cy + m10 * cz + t2;
      if (qx < lo[0]) lo[0] = qx; if (qx > hi[0]) hi[0] = qx; if (qy < lo[1]) lo[1] = qy; if (qy > hi[1]) hi[1] = qy; if (qz < lo[2]) lo[2] = qz; if (qz > hi[2]) hi[2] = qz;
    }
    HIT_PROF.nodes++;
    if (!HIT_BRUTE && !occAny(OP, lo, hi)) return;
    if (K.kids) { for (var c = 0; c < K.kids.length && !(any && n); c++) visit(K.kids[c]); return; }
    HIT_PROF.pts += (K.b - K.a) / 3;
    for (var p = K.a; p < K.b; p += 3) {
      var X = P[p], Y = P[p + 1], Z = P[p + 2];
      if (!GA.get(X, Y, Z)) continue;                                    // 打掉的格不算
      var x2 = X + 0.5, y2 = Y + 0.5, z2 = Z + 0.5;
      if (GB.get(Math.floor(m0 * x2 + m4 * y2 + m8 * z2 + t0), Math.floor(m1 * x2 + m5 * y2 + m9 * z2 + t1), Math.floor(m2 * x2 + m6 * y2 + m10 * z2 + t2))) { n++; if (acc) acc.push(x2, y2, z2); if (any) return; }
    }
  })(SA.root);
  return n;
}
/** 船型 T 的佔用金字塔（八叉樹的另一半）：第 0 層 ＝ 格子的 16³ 塊有沒有東西（T.base 的塊表，null ＝ 空），往上每 2×2×2 取 OR。
 *  照開戰時的原始格子（打掉之後只會更空 ⇒ 篩得保守、不會漏）。 */
function occPyr(T) {
  if (T.occPyr) return T.occPyr;
  var G = T.base, L = [{ nx: G.nx, ny: G.ny, nz: G.nz, a: new Uint8Array(G.nx * G.ny * G.nz) }];
  for (var i = 0; i < G.tab.length; i++) L[0].a[i] = G.tab[i] ? 1 : 0;
  while (L[L.length - 1].nx > 1 || L[L.length - 1].ny > 1 || L[L.length - 1].nz > 1) {
    var c = L[L.length - 1], p = { nx: (c.nx + 1) >> 1, ny: (c.ny + 1) >> 1, nz: (c.nz + 1) >> 1 };
    p.a = new Uint8Array(p.nx * p.ny * p.nz);
    for (var z = 0; z < c.nz; z++) for (var y = 0; y < c.ny; y++) for (var x = 0; x < c.nx; x++) if (c.a[x + c.nx * (y + c.ny * z)]) p.a[(x >> 1) + p.nx * ((y >> 1) + p.ny * (z >> 1))] = 1;
    L.push(p);
  }
  return (T.occPyr = L);
}
/** 格座標的外框 [lo, hi] 裡，B 的格子有沒有不是空的 16³ 塊（從金字塔頂往下找，只走有東西、又跟外框相交的那幾格）。 */
function occAny(L, lo, hi) {
  var c0 = [Math.floor(lo[0]) >> 4, Math.floor(lo[1]) >> 4, Math.floor(lo[2]) >> 4], c1 = [Math.floor(hi[0]) >> 4, Math.floor(hi[1]) >> 4, Math.floor(hi[2]) >> 4];
  function go(lv, x, y, z) {
    var c = L[lv];
    if (x < 0 || y < 0 || z < 0 || x >= c.nx || y >= c.ny || z >= c.nz || !c.a[x + c.nx * (y + c.ny * z)]) return false;
    var s = lv;                                                          // 這一格涵蓋第 0 層的 [x·2^s, (x+1)·2^s)
    if ((x + 1 << s) - 1 < c0[0] || x << s > c1[0] || (y + 1 << s) - 1 < c0[1] || y << s > c1[1] || (z + 1 << s) - 1 < c0[2] || z << s > c1[2]) return false;
    if (!lv) return true;
    for (var k = 0; k < 8; k++) if (go(lv - 1, 2 * x + (k & 1), 2 * y + (k >> 1 & 1), 2 * z + (k >> 2 & 1))) return true;
    return false;
  }
  return go(L.length - 1, 0, 0, 0);
}
/** 兩艘互相：A 往 d·dir 移、B 往 −d·dir 移（各一半 ⇒ 相對 d）之後還有沒有碰到（碰到第一個就停）。 */
function hitBoth(A, B, lv, dir, d) { return hitCount(A, B, lv, [dir[0] * d, 0, dir[2] * d], null, true) || hitCount(B, A, lv, [-dir[0] * d, 0, -dir[2] * d], null, true); }
function collideFine(A, B, lv) {
  var LA = (A.T.hx1 - A.T.hx0) * S / 2, LB = (B.T.hx1 - B.T.hx0) * S / 2, cA = A.center || shipCenter(A), cB = B.center || shipCenter(B);
  if (Math.hypot(cA[0] - cB[0], cA[2] - cB[2]) > LA + LB + 2) return;   // 外框先篩（含艏斜桅）
  HIT_PROF.pairs++;
  var acc = [], n0 = hitCount(A, B, lv, [0, 0, 0], acc, true) || hitCount(B, A, lv, [0, 0, 0], null, true);
  if (!n0) return;
  HIT_PROF.touch++;
  // 候選方向（從 B 指向 A、水平單位向量）：中心連線、A 的橫向 ±、B 的橫向 ±
  var cc = [cA[0] - cB[0], 0, cA[2] - cB[2]], cl = Math.hypot(cc[0], cc[2]) || 1, dirs = [[cc[0] / cl, 0, cc[2] / cl]];
  [A, B].forEach(function (sh) { var y = M4.dir(sh.M, 0, 1, 0), l = Math.hypot(y[0], y[2]) || 1; dirs.push([y[0] / l, 0, y[2] / l], [-y[0] / l, 0, -y[2] / l]); });
  var best = null;
  dirs.forEach(function (dir) {
    var hi = 0.5;
    while (hi < 24 && hitBoth(A, B, lv, dir, hi)) hi *= 2;
    if (hi >= 24 || (best && hi / 2 >= best.d)) return;                   // 這個方向推不開，或不可能比已經找到的少
    var lo = 0;
    for (var it = 0; it < 7; it++) { var mid = (lo + hi) / 2; if (hitBoth(A, B, lv, dir, mid)) lo = mid; else hi = mid; }
    if (!best || hi < best.d) best = { d: hi, dir: dir };
  });
  if (!best) best = { d: 0.5, dir: dirs[0] };                            // 全都推不開（疊太深）⇒ 照中心連線慢慢推
  var h = best.d / 2 + 0.01, n = best.dir;
  ramHit(A, B, n);                                                      // 撞擊（物理設定「碰撞傷害」；推開之前量接觸點）
  A.px += n[0] * h; A.pz += n[2] * h; B.px -= n[0] * h; B.pz -= n[2] * h;
  if (!ramOn(A, B)) hitFriction(A, B, n);                              // 撞擊事件進行中 ⇒ 沿 n 的減速交給 ramTick（⛔ 兩邊都扣 ⇒ 彈力 0 也被扣到倒退：量過 −0.33 m/s）
  var w = acc.length ? M4.pt(A.M, acc[0], acc[1], acc[2]) : [(cA[0] + cB[0]) / 2, cA[1], (cA[2] + cB[2]) / 2];   // 第一個接觸點（給水花、聲音；只有 B 的點落進 A ⇒ 兩艘中心的中點）
  wpBump([w[0] + n[0] * 0.5, w[1], w[2] + n[2] * 0.5], [w[0] - n[0] * 0.5, w[1], w[2] - n[2] * 0.5], A, B);
  if (SIMT - (A.bumpT || -9) > 5) { A.bumpT = SIMT; sfx('crack', w, 1); note(SHIPS[PLAYER_I], '兩艘擦撞'); }
}
/** 敵艦在哪一舷（給自動操舵用；有遲滯，不在正前／正後來回跳）。只影響操舵 —— 開火是每門砲各自看對不對得到。 */
function chooseSide(sh) {
  var foe = foeOf(sh); if (!foe || !foe.center || sh.struck || sh.sunk) return;   // 開局逐艘量的時候，另一艘可能還沒算過位置
  var st = M4.dir(sh.M, 0, 1, 0), dx = foe.center[0] - sh.center[0], dz = foe.center[2] - sh.center[2];
  var k = (dx * st[0] + dz * st[2]) / ((Math.hypot(dx, dz) || 1) * (Math.hypot(st[0], st[2]) || 1));
  var want = k > 0.2 ? 'S' : k < -0.2 ? 'P' : sh.side;
  if (want === sh.side) return;
  sh.side = want;
}

