// ───────────────────────── 第一人稱（TASK-0649） ─────────────────────────
// Tim 2026-10-16：「切換第一人稱模式功能(多一個Toggle按鈕 切換後就可以操控船長在船上自由移動)」「放在設定內」
//   「第一人稱下 下方操作面板隱藏 改為第一人稱用的操作面板(要能移動 旋轉視角等)」「只保留設定紐 暫停紐」；之後的建造模式（TASK-0648）由這一套衍生。
// 玩家是一個另外的角色 FP.c ＝ { pos }（Tim 2026-10-16「希望改成變成一個另外的玩家角色 抓船員只是用來對齊座標」）：
//   ⛔ 不在 sh.crew 裡 ⇒ 不會被打、不會被模擬拉走、survey 不判他掉下去；開的時候抓一個船員（船長 ＞ 軍官 ＞ 任何站著的人）只用來對齊起點。
//   位置是船的格座標（pos：腳底那一格），跟著船搖。腳下的甲板被打掉 ⇒ 照重力落到下一層；下面都沒有（掉出船外）⇒ 退出。
//   碰撞三段（FP.mode，設定裡的「碰撞」；Tim 2026-10-16「可以開另一個模式(正常 穿牆 浮空) 浮空模式可以自由上下移動(額外操作按鍵)」）：
//     0 正常：見下面「走」。
//     1 穿牆：牆不擋 —— 身體在牆裡（腳底那一格往上 FP_HEAD 格有實心）⇒ 腳的高度不變、直接穿過去（⛔ 照 fpStand 找最近的地板 ⇒ 穿舷牆時站上欄杆頂，量過）；
//            不在牆裡 ⇒ 上下台階（往上只跨 FP_NC_UP 0.3 m ⇒ 腳貼著這一層：欄杆、樓梯都照高度不變穿過去；換層用 E 爬梯子或浮空）。
//            前面沒有地板也不在牆裡（船外、艙口）、或四個方向看出去碰不到船身（fpInside）⇒ 擋住（⛔ 停在同一個高度 ⇒ 走出舷牆懸在海上，量過）。不墜落。
//     2 浮空：沒有重力、什麼都不擋；空白鍵／C（面板的 ⬆ ⬇）上下。切回正常／穿牆 ⇒ 從那裡照重力落到下面的地板；下面沒有（在船外）⇒ 回到開始浮空的地方。
//   走：每一步照現在的格子（sh.grid，打掉的地板就站不住）用 standZ 找腳下 ⇒ 往上 FP_UP、往下 FP_DOWN 格內站得住、頭上 FP_HEAD 格空才走得過去；
//   中心那一柱要站得住（⇒ 走路不會從艙口掉下去）、身體半徑 FP_R 格的四個角只擋牆 ⇒ 不穿牆、走不出舷牆。
//   跳起來在半空（Tim 2026-10-16「有些空洞跳不下去」）⇒ 往下不限 FP_DOWN：下面一路找得到地板就過得去、照重力落下去；牆照腳現在的高度擋。
//   ⚠ 不擋模型（砲、桶）：模型不是格子（Tim 2026-10-16「這個沒關係 不用碰撞」）。會轉的裝甲（砲塔）擋：格子照 navG ＝ 船殼＋它掃過的那一圈（24_armor.js；TASK-0655）⇒ 從圈裡的艙口梯進出。
//   平滑（Tim 2026-10-16「需要更平滑的移動 以及可以跨越一定高低差(且不要抖動)」）：速度有加減速（FP_ACC／FP_DEC 秒）；
//   腳底 c.pos[2] 照舊是整格（survey 判腳下要用），鏡頭的眼高 FP.ez 另外平滑地追（FP_EZ 秒）⇒ 跨台階、頭頂變低不會一格一格跳。
//   梯子：照雕刻的固定點（42_hands.js shipLadders：foot／lo／hi／head），走到梯腳或梯頭旁邊 ⇒ E（或面板的 🪜）沿那條線爬；繩梯（ratlines 標了 climb，ropeLadders）同一套。
//   看：鏡頭在眼睛（腳底往上 FP_EYE 格，頭頂低就壓低），yaw／pitch 是相對船的（船轉，視線跟著轉）；地平線照世界的上方（不跟著船橫搖）。
// 只在畫面這一層跑（frame，90_main.js）：⛔ 不抽 rnd()、不碰模擬的狀態 ⇒ 開不開第一人稱，戰局都逐位元組相同。
//   停格、設定打開（PAUSED）時只能轉頭、不能走。
// 自動退出：我艦沉了、換了一艘我艦（playerHandoff）、重新開始、回主選單、腳下一路都沒有地板。
// 建造模式鎖定第一人稱（Tim 2026-10-17「建築模式鎖定第一人稱」）：退出鈕藏起來、設定的開關與 Y 不作用；腳下沒有地板 ⇒ 回到船員旁邊重新開始。
//   別的玩法：重新開始、下一場都不維持（Tim 2026-10-17「第一人稱維持只有在建築模式下 重開維持 其他模式都不維持」；⛔ 10-16 那版 FP.want 每個玩法都維持）。
var FP = { on: false, lamp: true, mode: 0, sh: null, c: null, yaw: 0, pitch: 0, mv: { f: 0, b: 0, l: 0, r: 0, tl: 0, tr: 0, lu: 0, ld: 0, up: 0, dn: 0 }, run: false, climb: null, near: null, lads: null, v: [0, 0], vz: 0, ez: null, fz: 0, eo: 0, jz: 0, jv: 0, joy: [0, 0], look: [0, 0], fol: null, folP: null, lookT: 0, flyFrom: null };
var FP_MODE_EM = ['🚶', '🚪', '🕊'], FP_MODE = ['正常', '穿牆', '浮空'], FP_FLY_OUT = 200, FP_NC_EXIT = 2, FP_NC_UP = 3;   // 浮空時離船身最多 20 m；穿牆時從牆裡出來，前面的地板跟腳最多差 0.2 m；穿牆時跨得上 0.3 m（樓梯一階；⛔ 照正常的 0.6 m ⇒ 憲法號舷牆邊 0.2 m 木條＋0.4 m 欄杆蓋板一路踩上欄杆頂，量過）
// 跟隨船員（Tim 2026-10-16「加一個 跟隨船員(把第一人稱鏡頭綁到附近船員上)」）：FP.fol ＝ 被跟的人 —— 鏡頭在他的眼睛、他照常做自己的工作（⛔ 不設 c.fp）、
//   玩家只能轉頭；自己的角色停在原地。F 跟隨／回來、G 換下一個（照離自己由近到遠輪）；被跟的人落水、倒下 ⇒ 回到自己。
// FP_R：身體半徑（格）—— Tim 2026-10-16「只要判定不會穿牆就好 身體碰撞窄一點(目前會下不了憲法號樓梯)」⇒ 1.5 → 0.6（6 cm：只擋牆，踏板之間擠得進去）
// FP_SP：走路（格／秒）—— Tim 2026-10-16「走路速度可以改成目前跑的速度」⇒ 14 → 28（2.8 m/s）；跑 ＝ ×FP_RUN（5.6 m/s）
// FP_CLIMB：爬梯子（格／秒）—— Tim 2026-10-17「可以爬快一點(1.5倍速)」⇒ 8 → 12（憲法號 fore-lower-P 繩梯 z 105 → 264 量到 22.45 秒）
var FP_EYE = 16, FP_SP = 28, FP_RUN = 2, FP_TURN = 1.8, FP_R = 0.6, FP_CLIMB = 12, FP_REACH = 9, FP_FOV = 1.15;
var FP_UP = 6, FP_DOWN = 8, FP_ACC = 0.12, FP_DEC = 0.08, FP_EZ = 0.09;   // 跨得上 0.6 m、踩得下 0.8 m（更深 ⇒ 擋住，不會從艙口掉下去）；加速／減速／眼高的時間常數（秒）
var FP_G = 98, FP_JUMP = 10;                                          // 重力 9.8 m/s²（格／秒²）、跳 1.0 m（Tim 2026-10-16「跳躍高度改兩倍吧」：0.5 → 1.0 m）
// FP_HEAD：站得住要頭上幾格空 —— Tim 2026-10-16「碰撞高度也可以低一些(目前下樓梯會撞頭卡住)」⇒ 船員的 NAV_HEAD 1.2 m → 0.7 m（彎腰過得去；眼高照 fpEye 壓低）
var FP_HEAD = 7;
function fpCaptain(sh) { return sh ? sh.crew.filter(function (c) { return c.art === ART_CAPTAIN && c.st === 0; })[0] || null : null; }
/** 從誰的位置開始：船長 ＞ 其他軍官 ＞ 任何一個站著的船員（Tim 2026-10-16「第一人稱不用綁定船長 船長不在就找任意船員位置開始」）—— 只借座標。
 *  ⛔ 不挑：躺在病床上、正在爬梯子的預備水手（位置在別人手上）；被扛著的是傷員（st 1），本來就不算站著。 */
function fpPick(sh) {
  if (!sh) return null;
  var ok = function (c) { return c.st === 0 && !c.inBed && !(c.hand && c.hand.climb); };
  return fpCaptain(sh) || sh.crew.filter(function (c) { return ok(c) && c.role === ROLE.OFFICER; })[0] || sh.crew.filter(ok)[0] || null;
}
/** 開／關。開：鏡頭現在朝哪裡看（水平方向）⇒ 船長就面向那裡（不會一開就轉一大圈）。 */
function fpSet(on, quiet) {                                           // quiet：建造模式重建時（82_build.js bldRebuild）不再報一次說明
  if (on) {
    var sh = RUNNING ? SHIPS[PLAYER_I] : null, c = sh && !sh.sunk ? fpPick(sh) : null;
    if (!c) { if (sh) note(sh, '第一人稱：船上沒有站著的人'); fpUI(); return false; }
    if (c.art !== ART_CAPTAIN && !quiet) note(sh, '第一人稱：船長不在 ⇒ 從' + (c.role === ROLE.OFFICER ? '軍官' : ROLE_NAME[c.role] || '船員') + '的位置開始');
    var d = CAM.look && CAM.eye ? M4.dir(sh.inv, CAM.look[0] - CAM.eye[0], CAM.look[1] - CAM.eye[1], CAM.look[2] - CAM.eye[2]) : [1, 0, 0];
    FP.on = true; FP.sh = sh; FP.c = { pos: c.pos.slice() };            // 玩家自己的角色：只借那個船員的座標（⛔ 不操控他）
    FP.yaw = Math.atan2(d[1], d[0]) || 0; FP.pitch = 0; FP.climb = null; FP.lads = fpLadders(sh); FP.v = [0, 0]; FP.ez = null; FP.jz = FP.jv = 0;
    FP.vz = 0; FP.flyFrom = FP.mode === 2 ? FP.c.pos.slice() : null;
    if (!quiet) note(sh, '第一人稱：左下搖桿或 ' + ['fpFwd', 'fpLeft', 'fpBack', 'fpRight'].map(keyName).join('') + ' 走、' + keyWord('fpRun') + ' 跑、' + keyWord('fpJump') + '跳、拖曳畫面／方向鍵轉頭（電腦：點畫面用滑鼠轉頭，Esc 或按住 ' + keyName('fpUnlock') + ' 放開）、' + keyName('fpClimb') + ' 爬梯子 —— 🎥（' + keyName('fpExit') + '）回到原本的鏡頭' + (FP.mode === 2 ? '（浮空：' + keyWord('fpJump') + '上、' + keyName('fpDown') + ' 下）' : ''));
  } else if (FP.on) {
    FP.on = false; FP.sh = FP.c = FP.climb = FP.near = FP.fol = null; camSet({ snap: true }); fpUnlock();
  }
  fpStop(); fpUI(); return FP.on;
}
function fpStop() { var m = FP.mv; Object.keys(m).forEach(function (k) { m[k] = 0; }); FP.run = false; FP.joy = [0, 0]; FP.look = [0, 0]; FP.jz = FP.jv = 0; FP.v = [0, 0]; FP.vz = 0; joyDraw(0, 0); }
/** 建造模式（82_build.js）開著 ⇒ 第一人稱鎖定：玩家關不掉。 */
function fpBuildLock() { return RUNNING && modeRule('fpLock'); }   // 玩法規則 fpLock（04_modes.js；建造）
/** 玩家要離開第一人稱（🎥 鈕、Y、設定的開關）：建造模式鎖定 ⇒ 不關、說一聲。 */
function fpExit() {
  if (!FP.on) return;
  if (fpBuildLock()) { note(FP.sh, '建造模式固定第一人稱'); return; }
  fpSet(false); gsetClose();
}
/** 碰撞三段（設定裡的「碰撞」）：0 正常、1 穿牆、2 浮空。開著第一人稱時切：進浮空 ⇒ 記下從哪裡開始；離開浮空 ⇒ fpLand 落到下面的地板。 */
function fpMode(m) {
  if (m === FP.mode) return;
  var was = FP.mode; FP.mode = m;
  if (FP.on && FP.c) {
    if (m === 2) { FP.c.pos[2] += FP.jz; FP.jz = FP.jv = 0; FP.vz = 0; FP.climb = null; FP.flyFrom = FP.c.pos.slice(); }
    else if (was === 2) fpLand();
    else if (m === 0) { FP.flyFrom = null; fpLand(); }                   // 穿牆 → 正常：人可能卡在牆裡、腳下沒地板 ⇒ 一樣往下找、找不到回船員旁邊（⛔ 不管 ⇒ 下一格 fpGround 直接退出，量過）
  }
  fpUI();
}
/** 浮空結束：從現在的位置往下找站得住的地板 ⇒ 照重力落下去（腳底換成那一層、FP.jz ＝ 離地多高）；
 *  下面一路都沒有（在船外、海上）⇒ 回到開始浮空的地方（那裡也站不住 ⇒ 找它附近 12 格內最近的地板）。 */
function fpLand() {
  var c = FP.c, g = fpG(FP.sh), x = Math.floor(c.pos[0]), y = Math.floor(c.pos[1]), z = Math.floor(c.pos[2]);
  FP.vz = 0; FP.jv = 0;
  for (var dz = 0; dz <= 160; dz++) {
    var s = standZ(g, x, y, z - dz, z - dz, FP_HEAD);
    if (s >= 0) { FP.jz = c.pos[2] - s; c.pos[2] = s; return; }
  }
  var cr = fpPick(FP.sh), L = [[FP.flyFrom, '開始浮空的地方'], [cr && cr.pos, '船員旁邊']];   // ⛔ 只回開始浮空的地方 ⇒ 從穿牆卡在牆裡的位置起飛時那裡站不住，直接退出（量過）
  for (var q = 0; q < L.length; q++) {
    var p = L[q][0], sz = -1; if (!p) continue;
    for (var k = 0; k <= 12 && sz < 0; k++) sz = standZ(g, Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2]) - k, Math.floor(p[2]) + k, FP_HEAD);
    if (sz >= 0) { c.pos = [p[0], p[1], sz]; FP.jz = 0; FP.ez = null; note(FP.sh, '第一人稱：下面沒有甲板 ⇒ 回到' + L[q][1]); return; }
  }
  var sh = FP.sh; fpSet(false);
  if (fpBuildLock() && fpSet(true, true)) { note(sh, '建造：下面沒有甲板 ⇒ 從船員的位置重新開始'); return; }   // 鎖定第一人稱：⛔ 退出 ⇒ 建造介面跟著不見、玩家回不來
  note(sh, '第一人稱結束：下面沒有甲板');
}
function fpUI() {
  $('stage').classList.toggle('fp', FP.on);
  $('fpT').classList.toggle('on', FP.on); $('fpLampT').classList.toggle('on', FP.lamp);
  var lk = fpBuildLock(); $('fpExit').style.display = lk ? 'none' : ''; $('fpT').title = lk ? '建造模式固定第一人稱' : '';   // 建造模式鎖定：沒有退出鈕
  [].forEach.call(document.querySelectorAll('#gset [data-fpm]'), function (b) { b.classList.toggle('on', +b.dataset.fpm === FP.mode); });
  $('fpUI').classList.toggle('fol', !!FP.fol);                         // 跟隨中：藏搖桿、跳、跑、爬梯子（template.html #fpUI.fol）
  $('fpUI').classList.toggle('fly', FP.mode === 2);
  var bm = $('bldMode'), be = bm && bm.querySelector('.em'), bt = FP_MODE_EM[FP.mode];   // 建造模式那一顆（82_build.js）：照現在的碰撞換圖示
  if (be && be.textContent !== bt) { be.textContent = bt; bm.title = '碰撞：' + FP_MODE[FP.mode] + '（' + keyName('bMode') + ' 換：一般 → 穿牆 → 浮空）'; }                    // 浮空：藏跳、爬梯子，換上 ⬆ ⬇（template.html #fpUI.fly）
  $('fpClimb').style.display = FP.on && FP.near && !FP.fol && FP.mode !== 2 ? '' : 'none';
  var t = FP.fol ? '↩' : '👁', fe = $('fpFol').querySelector('.em'); if (fe && fe.textContent !== t) { fe.textContent = t; $('fpFol').title = (FP.fol ? '回到自己（' : '跟隨身邊的船員（') + keyName('fpFollow') + '）'; }
}
/** 鏡頭跟著誰：跟隨中 ⇒ 被跟的人，否則 ⇒ 自己。 */
function fpWho() { return FP.fol || FP.c; }
/** 跟隨中的小標籤 #fpWho（TASK-0720〔K11〕；Tim 2026-10-19「可以加一個水手工作效率數值」）：被跟的人是誰（職位；伙夫寫他在做什麼）＋工作效率
 *  （39_eff.js effText：「×1.06（吃過 1 分 12 秒前）」）；沒有任何效率因素的船（sh.effOn false）⇒ 只寫職位。之後做「點一個船員看資訊」照這一支接。 */
function fpWhoText(sh, c) {
  var nm = c.role === ROLE.OFFICER && c.rank !== undefined ? officerRank(c.rank) : ROLE_NAME[c.role] || '船員', J = c.hand && c.hand.job;
  if (J && J.kind === 'eat') nm += '（伙夫：' + (J.at ? '在爐灶盛飯' : '去廚房領飯') + '）';   // 45_galley.js galleyNeeds／galleyJoin
  nm += dutyWho(sh, c);                                                 // 航海士、軍需官在崗的加成（39_duty.js；TASK-0825）
  var e = effText(sh, c); return e ? nm + '｜工作效率 ' + e : nm;
}
/** 跟著 HUD 的節拍（61_hud.js hudFrame 每 6 格）刷新 #fpWho；沒在跟隨 ⇒ 空字串（template.html：空的不顯示）。只讀。 */
function fpWhoHud() {
  var el = $('fpWho'); if (!el) return;
  var t = FP.on && FP.fol && FP.sh ? fpWhoText(FP.sh, FP.fol) : '';
  if (el.textContent !== t) el.textContent = t;
}
/** 玩家自帶的燈（Tim 2026-10-16「是否可以讓玩家自帶點光源(艙內很暗)」；設定「視角」那一排的「🏮 提燈」，預設開）：
 *  60_render.js lampsUpdate 每一格問一次 ⇒ 第一人稱開著（跟隨船員時在被跟的人那裡）就回一盞：眼睛往下 FP_LAMP_DY、暖色、照 FP_LAMP_R 公尺、亮度固定 FP_LAMP_I（⛔ 照天色 ⇒ 白天艙裡照樣暗）。
 *  d −1 ⇒ 排在最前面，LAMP_N 盞的名額一定有它。只照船殼與模型（跟別的燈一樣不投影子、不照看板圖）；只給人看，不碰戰局。 */
var FP_LAMP_R = 6, FP_LAMP_I = 0.75, FP_LAMP_DY = 0.35, FP_LAMP_RGB = [1, 0.8, 0.55];
function fpLamp() {
  if (!FP.on || !FP.lamp || !CAM.eye) return null;
  return { w: [CAM.eye[0], CAM.eye[1] - FP_LAMP_DY, CAM.eye[2]], k: 1, I: FP_LAMP_I, R: FP_LAMP_R, rgb: FP_LAMP_RGB, d: -1 };
}
/** 誰正在這艘船上走動（Tim 2026-10-16「第一人稱模式 是否可以觸發一些船員判斷(是否有乾淨一點的作法) 有一些艙門設定是船員靠近會打開」）：
 *  正在走、正在爬的船員（c.st ≤ 1）＋第一人稱的玩家角色（在這艘船上、有在動：走、爬、跳、浮空上下）。fn(pos)（格座標、腳底）回 true ⇒ 停、整支回 true。
 *  ⛔ 只給畫面這一層的演出用（25_doors.js doorsAnim……）：模擬那一層（step 裡的 AI、站位、受傷）照舊只看 sh.crew ⇒ 開不開第一人稱戰局都逐位元組相同。
 *  ⛔ 不把玩家塞進 sh.crew（第三版之前那樣 ⇒ 會被打倒、被模擬拉走）。 */
function shPassers(sh, fn) {
  for (var i = 0; i < sh.crew.length; i++) { var c = sh.crew[i]; if (c.st <= 1 && (c.walk || c.moving) && fn(c.pos)) return true; }
  if (FP.on && FP.sh === sh && FP.c && (FP.climb || FP.jz > 0 || Math.hypot(FP.v[0], FP.v[1]) > 0.5 || Math.abs(FP.vz) > 0.5)) return !!fn(FP.c.pos);
  return false;
}
/** 跟隨（F／👁）：沒在跟 ⇒ 跟離自己最近的那一個；在跟 ⇒ 回到自己。下一個（G／⏭）：照離自己由近到遠，換成現在這個的下一個。 */
function fpFollow(next) {
  if (!FP.on) return;
  if (FP.fol && !next) { FP.fol = null; FP.ez = null; fpUI(); return; }
  var me = FP.c, L = FP.sh.crew.filter(function (o) { return o !== me && o.st === 0 && !o.inBed; })
    .sort(function (a, b) { return len(sub(a.pos, me.pos)) - len(sub(b.pos, me.pos)); });
  if (!L.length) { note(FP.sh, '第一人稱：附近沒有可以跟的人'); return; }
  var i = FP.fol ? L.indexOf(FP.fol) : -1;
  FP.fol = L[(i + 1) % L.length]; FP.folP = null; FP.ez = null; FP.climb = null; FP.v = [0, 0]; FP.jz = FP.jv = 0; fpUI();
}
/** 梯子：foot → lo → hi → head（格座標，z ＝ 腳踩的那一格）；lo、hi 抬 CLIMB_LIFT 格（同預備水手，42_hands.js：兩點連線會切過踏板前緣）。 */
function fpLadders(sh) {
  return shipLadders(sh.T).map(function (l) {
    var P = l.pts, mid = P.slice(1, -1).map(function (q) { return [q[0], q[1], q[2] + CLIMB_LIFT]; }), up = [P[0]].concat(mid, [P[P.length - 1]]);
    var ride = ladRideOf(sh.T, l, up[0][2], up[up.length - 1][2]);   // 繩梯綁在砲塔上（27_turret.js ladRide）
    return { name: l.name, up: up, up0: up, raw: P, rope: !!l.rope, span: ride ? null : l.span || null, ride: ride };   // 跟著轉的：梯腳不照 span（那是開局的 x 範圍）；raw：沒抬的固定點（樓梯不穿洞的斜坡，fpRamp）
  });
}
// 綁在砲塔上的繩梯（Tim 2026-10-17：「繩梯直接綁在頂部開口」「旋轉後兩端仍然連通」「也可以被拉伸(有彈性)」）：梯腳、梯頭、爬到一半的人都照 27_turret.js ladRide。
function fpLadMap(sh, L, p) { return ladRide(sh, L.ride, p); }
/** 每一格畫面：跟著轉的繩梯照現在的位置擺（fpNear 找梯腳、梯頭用）。 */
function fpLadPose(sh) { (FP.lads || []).forEach(function (L) { if (L.ride) L.up = L.up0.map(function (q) { return fpLadMap(sh, L, q); }); }); }
/** 站在砲塔上 ⇒ 跟著轉（Tim 2026-10-17）：上一格畫面記下腳下是哪一座砲塔的格（那一塊殼的節點）與那時這一串的角度（FP.ride）；
 *  這一格把位置照「那時 → 現在」換過去、視線跟著轉（⛔ 只記砲塔座標 ⇒ 這一格自己走的那一段會被吃掉）。腳下不是砲塔的格（甲板、爬梯子、跳起來）⇒ 不跟。 */
function fpRide(sh, c) {
  var R = FP.ride;
  if (R) {
    var now = ndYaws(R.nd); ndYawsSet(R.nd, R.y); var q = ndIn(R.nd, c.pos); ndYawsSet(R.nd, now);
    var p = ndOut(R.nd, q); c.pos[0] = p[0]; c.pos[1] = p[1]; FP.yaw += ndYaw(R.nd) - R.w;
  }
  var t = FP.climb || FP.jz > 0 || FP.mode === 2 ? null : turCell(sh, Math.floor(c.pos[0]), Math.floor(c.pos[1]), Math.floor(c.pos[2]) - 1);
  FP.ride = t && t.a ? { nd: t.a.nd, y: ndYaws(t.a.nd), w: ndYaw(t.a.nd) } : null;
}
/** 腳下：(x, y) 那一柱在 z 往下 down（沒給 ＝ FP_DOWN）、往上 up（沒給 ＝ FP_UP）格內站得住的高度（離 z 最近的）；站不住 ⇒ −1。 */
function fpStand(g, x, y, z, up, down) {
  var best = -1;
  for (var dz = -(down || FP_DOWN); dz <= (up || FP_UP); dz++) {
    var zz = z + dz; if (zz < 1) continue;
    var s = standZ(g, x, y, zz, zz, FP_HEAD);
    if (s >= 0 && (best < 0 || Math.abs(s - z) < Math.abs(best - z))) best = s;
  }
  return best;
}
/** 走到 (nx, ny)：中心那一柱要站得住（⇒ 不會從艙口掉下去）；身體四個角只擋牆（身高範圍裡有實心、又不是跨得上去的台階）——
 *  角懸在洞上可以（⛔ 四個角都要站得住 ⇒ 站在艙口邊的人連往後退都不行：量過，梯頭那一格旁邊就是地板和踏板之間的縫）。
 *  腳下 ＝ 中心那一柱的高度（⛔ 以前取四個角裡最高的 ⇒ 貼著邊走時角一下踩上一下踩空，腳底一格高一格低地跳 ＝ 抖）；不行 ⇒ null。
 *  feet（在半空時給：腳現在的絕對高度）⇒ 往下不限 FP_DOWN（FP_FALL 格內有地板就過得去 ⇒ 跳得進洞）；中心與四個角在腳現在的高度、身高範圍裡有實心 ⇒ 牆。 */
var FP_FALL = 160;                                                     // 半空往下找地板最多 16 m（比任何一艘船的甲板到底艙都深）
function fpTry(g, z, nx, ny, thin, up, feet) {
  up = up || FP_UP;
  var down = FP_DOWN, hi = fpStand(g, Math.floor(nx), Math.floor(ny), z, up);
  if (hi < 0) hi = fpFoot(g, z, nx, ny, up);                          // 中心那一柱是縫 ⇒ 看腳掌踩不踩得到旁邊（樓梯口圍欄與第一階之間那一格縫，量過）
  if (hi < 0 && feet !== undefined) { down = FP_FALL; hi = fpStand(g, Math.floor(nx), Math.floor(ny), z, up, down); }   // 半空、旁邊也踩不到 ⇒ 是洞：往下找（⛔ 先找 FP_FALL ⇒ 一兩格的縫也掉得進去）
  var rp = feet === undefined ? fpRamp(nx, ny, z, true) : -1;       // 正對著樓梯、很靠近 ⇒ 梯子的線也站得住（不從踏板之間的空洞掉下去；fpRamp）；在半空不墊 ⇒ 跳得下樓梯
  if (rp >= 0 && rp > hi) { var hr = fpTryAt(g, z, nx, ny, thin, up, rp, feet, down); if (hr !== null) return hr; }   // 斜坡上走不過去（身體的角撞到牆）⇒ 照不墊的走
  return fpTryAt(g, z, nx, ny, thin, up, hi, feet, down);
}
/** fpTry 的後半：腳下定成 hi 之後，照小起伏、半空、四個角的牆判斷走不走得過去；不行 ⇒ null。 */
function fpTryAt(g, z, nx, ny, thin, up, hi, feet, down) {
  if (hi < 0) return null;
  hi = fpFlat(g, nx, ny, hi);                                         // 小起伏：腳掌踩得到 0.2 m 以內高一點的地方 ⇒ 站在那裡
  var deep = feet !== undefined && feet - hi > FP_DOWN;                // 真的掉進洞（離下面的地板超過 0.8 m）才照腳現在的高度擋（⛔ 半空一律擋 ⇒ 格柵每下一格 0.1 m 就把前面的格條當成牆、速度歸零，量過：維吉尼亞號每 3 格停 4–5 格畫面）
  if (deep && !thin && fpBody(g, Math.floor(nx), Math.floor(ny), Math.max(hi, Math.floor(feet)))) return null;
  if (thin) return hi;                                                 // 卡住了（現在的位置四個角就撞牆）⇒ 只看中心那一柱，先走出來
  for (var i = 0; i < 4; i++) {
    var x = Math.floor(nx + (i & 1 ? FP_R : -FP_R)), y = Math.floor(ny + (i & 2 ? FP_R : -FP_R));
    if (deep && fpBody(g, x, y, Math.max(hi, Math.floor(feet)))) return null;   // 半空：照腳現在的高度擋（⛔ 照新地板 ⇒ 落進艙口的途中橫著穿過上一層甲板）
    if (fpStand(g, x, y, z, up, down) >= 0) continue;
    if (fpBody(g, x, y, hi)) return null;                              // 牆：新地板上方、身高範圍裡有實心（那個角本身站得住 ⇒ 是台階，上面已經跳過）
  }
  return hi;
}
/** 小起伏（Tim 2026-10-16「再往格表面行走會一卡一卡的(是否能無視小的高低起伏)」）：腳掌範圍（中心 ±FP_FOOT）裡高 FP_FLAT 格以內站得住 ⇒ 腳底就在那個高度。
 *  格柵（維吉尼亞號甲板：0.1 m 高的格條、0.2 m 寬的空格）一路踩在格條頂上，不一上一下；更高的台階照舊一步一步上。 */
var FP_FLAT = 2;
function fpFlat(g, nx, ny, hi) {
  for (var h = hi + FP_FLAT; h > hi; h--)
    for (var i = -1; i <= 1; i++) for (var j = -1; j <= 1; j++)
      if (standZ(g, Math.floor(nx + i * FP_FOOT), Math.floor(ny + j * FP_FOOT), h, h, FP_HEAD) >= 0) return h;
  return hi;
}
/** 穿牆時 (x, y)（腳底 z）在不在船裡：往船頭、船尾、左舷、右舷四個方向都碰得到實心（腳上 0.2 m 或 1.2 m 那一層，任一層碰到就算 ⇒ 砲門的洞不會讓人判成船外）。
 *  ⛔ 只看腳下有沒有地板 ⇒ 船殼外板往外斜，穿出舷牆就沿著外板一階一階走下去（量過 106→93）。 */
function fpInside(g, x, y, z, S) {
  var D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (var k = 0; k < 4; k++) {
    var hit = false;
    for (var t = 1; !hit; t++) {
      var xx = x + D[k][0] * t, yy = y + D[k][1] * t;
      if (xx < 0 || yy < 0 || xx >= S[0] || yy >= S[1]) break;
      hit = !!(g.get(xx, yy, z + 2) || g.get(xx, yy, z + 12));
    }
    if (!hit) return false;
  }
  return true;
}
/** (x, y) 那一柱在 z 往上 FP_HEAD 格（身高範圍）裡有沒有實心。 */
function fpBody(g, x, y, z) { for (var h = 0; h < FP_HEAD; h++) if (g.get(x, y, z + h)) return true; return false; }
/** 腳掌：中心那一柱站不住時，中心 ±FP_FOOT 格的八個點裡站得住、離現在腳底最近的高度（一兩格寬的縫跨得過去；艙口那種大洞照樣擋）；都不行 ⇒ −1。 */
var FP_FOOT = 1.2;
function fpFoot(g, z, nx, ny, up, down) {
  var best = -1;
  for (var i = -1; i <= 1; i++) for (var j = -1; j <= 1; j++) {
    if (!i && !j) continue;
    var s = fpStand(g, Math.floor(nx + i * FP_FOOT), Math.floor(ny + j * FP_FOOT), z, up, down);
    if (s >= 0 && (best < 0 || Math.abs(s - z) < Math.abs(best - z))) best = s;
  }
  return best;
}
/** 眼睛離腳底幾格：身邊（±FP_EYE_R 格）與前面（照速度 FP_EYE_T 秒會走到的地方）走得過去的柱裡，最低的頭頂（往上第一個實心）
 *  低於 FP_EYE ＋ FP_EYE_GAP ⇒ 壓到它下面 FP_EYE_GAP 格（低頭）。
 *  ⛔ 只看腳下那一柱（以前）⇒ 梁在前一格時眼睛照樣 1.6 m，走過去的那一下鏡頭整個卡進梁裡；
 *  量過（憲法號）：底艙梁底 1.4–1.5 m、下甲板 1.7 m、砲甲板 1.7–1.9 m，眼睛 1.6 m。
 *  身高範圍裡就有實心的柱（牆、台階、箱子）走不過去 ⇒ 不算。 */
var FP_EYE_R = 2, FP_EYE_T = 0.2, FP_EYE_GAP = 2;
function fpCeil(g, x, y, z) { for (var h = 1; h <= FP_EYE + FP_EYE_GAP; h++) if (g.get(x, y, z + h)) return h; return 99; }
function fpEye(g, p, v) {
  var x = Math.floor(p[0]), y = Math.floor(p[1]), z = Math.floor(p[2]), m = fpCeil(g, x, y, z), h, i, j;
  for (i = -FP_EYE_R; i <= FP_EYE_R; i++) for (j = -FP_EYE_R; j <= FP_EYE_R; j++) {
    if ((i || j) && (h = fpCeil(g, x + i, y + j, z)) >= FP_HEAD && h < m) m = h;
  }
  var sp = v ? Math.hypot(v[0], v[1]) : 0, n = Math.min(8, Math.floor(sp * FP_EYE_T));
  for (var k = FP_EYE_R + 1; k <= n; k++) {                            // 前面：沿速度方向一格一格看（走得越快看得越遠）
    var ax = Math.floor(p[0] + v[0] / sp * k), ay = Math.floor(p[1] + v[1] / sp * k);
    if ((h = fpCeil(g, ax, ay, z)) >= FP_HEAD && h < m) m = h;
  }
  return m < FP_EYE + FP_EYE_GAP ? Math.max(3, m - FP_EYE_GAP) : FP_EYE;
}
/** 每一格畫面（90_main.js frame，camUpdate 之前）：退出判斷、走、爬、看哪一座梯子在旁邊。 */
function fpFrame(dt) {
  if (!FP.on) return;
  var sh = FP.sh, c = FP.c;
  if (!RUNNING || SHIPS[PLAYER_I] !== sh || sh.sunk) {                 // 玩家的角色不在船員名單裡 ⇒ 不會被打倒、不會落水（Tim 2026-10-16「會遇到突然退出第一人稱(被打死?)」）
    var o = sh, why = RUNNING && SHIPS[PLAYER_I] === sh ? '我艦沉了' : ''; fpSet(false); if (why && o) note(o, '第一人稱結束：' + why);
    return;
  }
  var m = FP.mv, g = fpG(sh);                                         // fpG：船殼＋會轉的裝甲掃過的那一圈（24_armor.js；TASK-0655：砲塔的牆走不穿）＋砲塔自己的地板上方照砲塔現在的格（站得上砲塔頂）
  FP.yaw += (m.tr - m.tl + FP.look[0]) * FP_TURN * dt; FP.pitch = clamp(FP.pitch + (m.lu - m.ld - FP.look[1]) * FP_TURN * 0.7 * dt, -1.35, 1.35);   // 方向鍵＋右搖桿
  if (FP.fol && (sh.crew.indexOf(FP.fol) < 0 || FP.fol.st !== 0)) { FP.fol = null; FP.ez = null; note(sh, '第一人稱：跟的人倒下或落水了 —— 回到自己'); fpUI(); }
  if (PAUSED && fpLocked()) fpUnlock();                                // 停格、打開設定 ⇒ 放開滑鼠（要按面板）
  if (PAUSED) { fpEyeZ(0); return; }                                   // 停格、設定打開：只能轉頭
  fpLadPose(sh); fpRide(sh, c);                                         // 砲塔轉過：跟著轉的繩梯重擺、站在砲塔上的自己跟著轉
  if (FP.fol) {                                                        // 跟隨中：自己的角色不動，只轉頭
    var q = FP.fol.pos, lp = FP.folP || q, mx = q[0] - lp[0], my = q[1] - lp[1]; FP.folP = q.slice();
    if (Math.hypot(mx, my) > 1e-3 && performance.now() - (FP.lookT || 0) > 2000) {   // 他在走、玩家 2 秒沒拖 ⇒ 視線慢慢轉向他走的方向（⛔ 固定朝向 ⇒ 他一轉彎鏡頭就對著艙壁，量過）
      var dyaw = Math.atan2(Math.sin(Math.atan2(my, mx) - FP.yaw), Math.cos(Math.atan2(my, mx) - FP.yaw));
      FP.yaw += dyaw * (1 - Math.exp(-dt / 0.5));
    }
    FP.near = null; fpEyeZ(dt); fpUI(); return;
  }
  if (FP.climb) { fpClimbStep(sh, dt); FP.near = null; fpEyeZ(dt); fpUI(); return; }   // 爬（E）：沿梯子的線走（fpClimbStep）
  // 輸入：鍵盤（0／1）＋虛擬搖桿（類比）；合起來長度夾到 1 ⇒ 搖桿推一半就慢慢走
  var f = m.f - m.b + FP.joy[0], r = m.r - m.l + FP.joy[1], n = Math.hypot(f, r);
  if (n > 1) { f /= n; r /= n; }
  var top = FP_SP * (FP.run ? FP_RUN : 1), cy = Math.cos(FP.yaw), sy = Math.sin(FP.yaw);   // 右手邊 ＝ yaw + 90°（格的 +y ＝ 右舷）
  var tvx = (cy * f - sy * r) * top, tvy = (sy * f + cy * r) * top, kk = 1 - Math.exp(-dt / (n > 0.05 ? FP_ACC : FP_DEC));
  FP.v[0] += (tvx - FP.v[0]) * kk; FP.v[1] += (tvy - FP.v[1]) * kk;   // 加速、減速（⛔ 一按就全速、一放就急停 ⇒ 鏡頭一頓一頓）
  if (n <= 0.05 && Math.hypot(FP.v[0], FP.v[1]) < 0.2) FP.v[0] = FP.v[1] = 0;
  var dx = FP.v[0] * dt, dy = FP.v[1] * dt, z = Math.floor(c.pos[2]), feet = c.pos[2] + FP.jz, nz = null, air = FP.jz > 0 || FP.jv > 0;
  if (FP.mode === 2) {                                                 // 浮空：什麼都不擋、沒有重力；上下照 ⬆ ⬇（空白鍵／C），一樣有加減速
    var tvz = (m.up - m.dn) * top * 0.7, kz = 1 - Math.exp(-dt / (m.up || m.dn ? FP_ACC : FP_DEC)), S = sh.T.h.size;
    FP.vz += (tvz - FP.vz) * kz; if (!(m.up || m.dn) && Math.abs(FP.vz) < 0.2) FP.vz = 0;
    c.pos[0] = clamp(c.pos[0] + dx, -FP_FLY_OUT, S[0] + FP_FLY_OUT); c.pos[1] = clamp(c.pos[1] + dy, -FP_FLY_OUT, S[1] + FP_FLY_OUT);   // 離船最多 FP_FLY_OUT 格（⛔ 不夾 ⇒ 飛到看不見船）
    c.pos[2] = clamp(c.pos[2] + FP.vz * dt, 1, S[2] + FP_FLY_OUT);
    FP.jz = FP.jv = 0; FP.near = null; fpEyeZ(dt); fpUI(); return;
  }
  if ((dx || dy) && FP.mode === 1) {                                   // 穿牆：身體在牆裡 ⇒ 高度不變直接穿；不在牆裡 ⇒ 照正常上下台階；前面沒有地板也不在牆裡 ⇒ 擋住
    var px = Math.floor(c.pos[0] + dx), py = Math.floor(c.pos[1] + dy), s0 = fpStand(g, px, py, z, FP_NC_UP), inW = fpBody(g, Math.floor(c.pos[0]), Math.floor(c.pos[1]), z);
    if (fpBody(g, px, py, z) && (inW || !(s0 > z))) s0 = z;            // 前面是牆：已經在牆裡、或那不是跨得上的台階 ⇒ 高度不變穿進去（⛔ 在牆裡也照台階往上 ⇒ 一格一格爬上欄杆頂）
    else if (inW && Math.abs(s0 - z) > FP_NC_EXIT) s0 = -1;            // 從牆裡出來：前面的地板要跟腳差不多高（⛔ 照台階 ⇒ 穿出舷牆後沿著往外斜的船殼外板一階一階走下去，量過 106→93）
    if (s0 < 0 && !inW && fpFoot(g, z, c.pos[0] + dx, c.pos[1] + dy) >= 0) s0 = z;   // 中心是縫、腳掌踩得到旁邊 ⇒ 照樣走（同 fpTry）
    if (s0 >= 0 && (px !== Math.floor(c.pos[0]) || py !== Math.floor(c.pos[1])) && !fpInside(g, px, py, s0, sh.T.h.size)) s0 = -1;   // 船外 ⇒ 擋住
    if (s0 >= 0) { c.pos[0] += dx; c.pos[1] += dy; if (s0 !== z) { c.pos[2] = s0; FP.jz = Math.max(0, feet - s0); } }
    else FP.v[0] = FP.v[1] = 0;
  } else if (dx || dy) {
    var up = FP_UP + Math.floor(FP.jz), af = air ? feet : undefined, thin = fpTry(g, z, c.pos[0], c.pos[1], false, up) === null;   // 跳起來的時候跨得更高（跳上箱子、舷梯）、往下跳得進洞（af）
    if ((nz = fpTry(g, z, c.pos[0] + dx, c.pos[1] + dy, thin, up, af)) !== null) { c.pos[0] += dx; c.pos[1] += dy; }
    else if (dx && (nz = fpTry(g, z, c.pos[0] + dx, c.pos[1], thin, up, af)) !== null) { c.pos[0] += dx; FP.v[1] = 0; }   // 貼著牆滑（撞牆的那個方向速度歸零）
    else if (dy && (nz = fpTry(g, z, c.pos[0], c.pos[1] + dy, thin, up, af)) !== null) { c.pos[1] += dy; FP.v[0] = 0; }
    else FP.v[0] = FP.v[1] = 0;
    if (nz !== null && nz !== z) { c.pos[2] = nz; FP.jz = Math.max(0, feet - nz); }   // 換了一層地板：腳的高度不跳 —— 往下 ⇒ 照重力落下去；往上 ⇒ 站上去（眼高平滑地追）
    c.face = Math.cos(FP.yaw) >= 0 ? 1 : -1;
  }
  if (FP.jz > 0 || FP.jv > 0) {                                        // 垂直：跳、從台階邊落下去
    FP.jv -= FP_G * dt; FP.jz += FP.jv * dt;
    if (FP.jv > 0 && g.get(Math.floor(c.pos[0]), Math.floor(c.pos[1]), Math.floor(c.pos[2] + FP.jz + FP_HEAD))) FP.jv = 0;   // 頭頂撞到（跟站得住同一個身高）
    if (FP.jz <= 0) { FP.jz = 0; FP.jv = 0; }
  }
  if (FP.mode === 0 && FP.jz <= 0 && FP.jv <= 0 && !fpGround(g, c)) return;   // 腳下的甲板被打掉了 ⇒ 落到下一層（或退出）；穿牆不墜落
  FP.near = FP.jz > 0 ? null : fpNear(c.pos);
  fpEyeZ(dt); fpUI();
}
/** 腳下還有沒有地板（站在地上、沒在跳時每一格看一次）：腳掌範圍（中心 ±FP_FOOT）底下有實心 ⇒ true。
 *  沒有（甲板被打掉）⇒ 往下找下一層站得住的、照重力落下去 ⇒ true；一路都沒有 ⇒ fpLand 回船員旁邊；連那裡都站不住才退出 ⇒ false。 */
function fpGround(g, c) {
  var x = c.pos[0], y = c.pos[1], z = Math.floor(c.pos[2]);
  for (var i = -1; i <= 1; i++) for (var j = -1; j <= 1; j++) if (g.get(Math.floor(x + i * FP_FOOT), Math.floor(y + j * FP_FOOT), z - 1)) return true;
  if (Math.abs(fpRamp(x, y, z, false) - z) <= 1) return true;            // 站在樓梯的斜坡上（fpRamp；不看方向 ⇒ 站著轉頭不會掉下去）
  for (var dz = 1; dz <= 120; dz++) {
    var s = standZ(g, Math.floor(x), Math.floor(y), z - dz, z - dz, FP_HEAD);
    if (s >= 0) { c.pos[2] = s; FP.jz = z - s; FP.jv = 0; return true; }
  }
  FP.flyFrom = null; fpLand(); return FP.on;                          // 一路都沒有 ⇒ 回船員旁邊（再沒有才退出）
}
/** 跳（空白鍵、面板的 ⤴）：站在地上才跳得起來；爬梯子、停格不行。 */
function fpJump() {
  if (!FP.on || PAUSED || FP.fol || FP.mode === 2) return;
  if (FP.climb) { fpClimbOff(fpG(FP.sh)); return; }                    // 爬到一半 ⇒ 跳下梯子（TASK-0726）
  if (FP.jz > 0 || FP.jv > 0) return;
  FP.jv = Math.sqrt(2 * FP_G * FP_JUMP);
}
/** 鏡頭的眼高（格，船的 z）：腳底絕對高度（c.pos[2] ＋ 跳起來的 FP.jz）＋ 眼高，平滑地追（FP_EZ 秒）⇒ 跨台階、頭頂變低不會一格一格跳。 */
//   兩段分開追：腳底（FP.fz，台階、跳、落）照 FP_EZ；低頭（FP.eo，fpEye 給的眼高）低頭快、抬頭慢（FP_EZ_DN／FP_EZ_UP）——
//   ⛔ 低頭抬頭一樣快 ⇒ 砲甲板一根梁一根梁地點頭（梁距約 1 m）；抬頭慢 ⇒ 梁之間不抬頭，走出梁區才慢慢站直。
//   ⛔ 合成一個數一起追 ⇒ 上樓梯時眼睛跟著抬頭的慢速落後。
var FP_EZ_DN = 0.04, FP_EZ_UP = 0.35;
function fpEyeZ(dt) {
  var c = fpWho(), jz = FP.fol ? 0 : FP.jz, fly = FP.mode === 2 && !FP.fol, base = c.pos[2] + jz;
  // 爬梯子：眼睛也固定在腳上 FP_EYE、不看頭頂（Tim 2026-10-17「爬梯子時…是否可以關閉碰撞 目前爬繩梯會撞到」—— 爬的線本來就不擋，撞的是眼高：
  //   憲法號 fore-lower-P 繩梯越過舷牆那 1.4 秒、鑽進桅樓底下那 3 秒，fpEye 看到頭頂有格 ⇒ 眼高 16 → 3（腳上 0.3 m），鏡頭埋進木頭裡）
  var off = fly || FP.climb && !FP.fol ? FP_EYE : fpEye(fpG(FP.sh), [c.pos[0], c.pos[1], base], FP.fol ? null : FP.v);   // 浮空：眼睛固定在腳上 FP_EYE（穿過甲板時不跟著壓）
  if (FP.ez === null || FP.climb || fly || !(dt > 0)) FP.fz = base, FP.eo = off;   // 剛開、換人、爬梯子、浮空（本來就連續）⇒ 直接跟
  else {
    FP.fz += (base - FP.fz) * (1 - Math.exp(-dt / FP_EZ));
    FP.eo += (off - FP.eo) * (1 - Math.exp(-dt / (off < FP.eo ? FP_EZ_DN : FP_EZ_UP)));
  }
  FP.ez = FP.fz + FP.eo;
}
/** 旁邊有沒有梯腳（往上爬）或梯頭（往下爬）：水平 FP_REACH 格內、高度差 4 格內，取最近的那一個。
 *  繩梯（ratlines，L.rope）：水平 FP_REACH_ROPE 格、高度差 FP_REACH_ROPE_Z 格內；梯腳是一整段（L.span ＝ 最低一道的前後兩端 x，沿舷牆內側）⇒ 站在那一排 shroud 旁邊哪裡都摸得到，
 *  從站的那個 x 開始爬（⛔ 只有一個點 ⇒ 一組 ratlines 前後 3–4.6 m，站在 shroud 旁邊常常離那一點 0.9 m 以上；Tim 2026-10-17「繩梯…還是不能爬(是否可以加大判定範圍?)」）。 */
var FP_REACH_ROPE = 18, FP_REACH_ROPE_Z = 6;
/** 正對著梯子嗎（Tim 2026-10-19「梯子判定可以只判定玩家視線內(要正對梯子 一定角度內)」；TASK-0726）：視線的水平方向跟「上梯子後要去的點」
 *  （pts 從第二點起、第一個離自己水平 1.5 格以上的）夾角 FP_LAD_FACE（45°）內；每一點都在正上方／正下方（直梯貼著站）⇒ 算。只看水平：往下爬時低頭看艙口也算。 */
function fpFacing(pts, p) {
  var cy = Math.cos(FP.yaw), sy = Math.sin(FP.yaw);
  for (var i = 1; i < pts.length; i++) {
    var hx = pts[i][0] - p[0], hy = pts[i][1] - p[1], hl = Math.hypot(hx, hy);
    if (hl >= 1.5) return (cy * hx + sy * hy) / hl > FP_LAD_FACE;
  }
  return true;
}
function fpNear(p) {
  var best = null, bd = 1e9;
  (FP.lads || []).forEach(function (L) {
    [[L.up[0], L.up], [L.up[L.up.length - 1], L.up.slice().reverse()]].forEach(function (e, k) {
      var q = e[0], pts = e[1], R = L.rope ? FP_REACH_ROPE : FP_REACH, RZ = L.rope ? FP_REACH_ROPE_Z : 4, dh;
      if (L.rope && L.span && k === 0) {                                // 繩梯的梯腳：離那一段最近的點
        var cx = clamp(p[0], L.span[0], L.span[1]); dh = Math.hypot(cx - p[0], q[1] - p[1]);
        pts = [[cx, q[1], q[2]]].concat(pts.slice(1));
      } else dh = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (dh < R && Math.abs(q[2] - p[2]) <= RZ && dh < bd && fpFacing(pts, p)) { bd = dh; best = { pts: pts, up: k === 0, name: L.name, L: L.ride ? L : null, rope: L.rope }; }   // L：跟著轉的繩梯（fpClimbGo 照開局的座標爬）
    });
  });
  return best;
}
/** 畫船員（41_crew_art.js drawCrew）：自己不畫；同一艘船上、水平 FP_NEAR 格內、差不多同一層的人也不畫（看板圖 2.1 m 高，貼在臉前會蓋掉半個畫面）。 */
var FP_NEAR = 12;                                                     // 1.2 m（⛔ 0.8 m ⇒ 底艙擠的時候 1 m 外的人整張蓋住畫面，跟隨預備水手時量到）
function fpHide(sh, c) {
  if (c === fpWho()) return true;
  if (sh !== FP.sh || c.st === 4 || c.st === 5) return false;
  var p = fpWho().pos;                                                 // 跟隨中：看的是被跟的人身邊（自己的身體在遠處 ⇒ 照畫）
  return Math.abs(c.pos[0] - p[0]) < FP_NEAR && Math.abs(c.pos[1] - p[1]) < FP_NEAR && Math.abs(c.pos[2] - p[2]) < 12;
}
/** E（面板的 🪜）：整段沿梯子的線爬完（正對著梯子才摸得到，fpNear／fpFacing）。 */
function fpClimbGo() {
  if (!FP.on || FP.fol || FP.mode === 2 || FP.climb || !FP.near || PAUSED) return;
  var n = FP.near, L = n.L, c = FP.c.pos;
  FP.jz = FP.jv = 0; FP.v[0] = FP.v[1] = 0;
  if (!L) { FP.climb = { pts: n.pts, k: 0 }; return; }
  var B = n.up ? L.up0 : L.up0.slice().reverse(), m0 = fpLadMap(FP.sh, L, B[0]);   // 跟著轉的繩梯：pb ＝ 自己在開局座標裡的位置（照梯子起點那一點的位移估）
  FP.climb = { L: L, pts: B, k: 0, pb: [c[0] - (m0[0] - B[0][0]), c[1] - (m0[1] - B[0][1]), c[2] - (m0[2] - B[0][2])] };
}
/** 爬（每一格）：一段一段沿梯子的線走（三維）；跟著轉的繩梯在開局的座標裡走（pb），每一格照它現在的位置換過去（fpLadMap）⇒ 爬到一半砲塔轉了也不會脫手。 */
function fpClimbStep(sh, dt) {
  var CL = FP.climb, P = CL.pts, c = FP.c, p = CL.L ? CL.pb : c.pos, to = P[CL.k], d = sub(to, p), l = len(d), s = FP_CLIMB * dt;
  FP.jz = FP.jv = 0; FP.v[0] = FP.v[1] = 0;
  if (l <= s) { p = to.slice(); if (++CL.k >= P.length) FP.climb = null; }
  else p = add(p, mul(d, s / l));
  if (CL.L) { CL.pb = p; c.pos = fpLadMap(sh, CL.L, p); } else c.pos = p;
}
/** 爬到一半按跳（TASK-0726；Tim 2026-10-19「除非跳起來 可以跳下樓梯」）：離開梯子，腳底換成正下方站得住的那一層（FP.jz ＝ 離它多高）、往上跳一下 ⇒ 照重力落下去。
 *  下面一路都沒有 ⇒ 交給 fpGround（落到下一層或回船員旁邊）。 */
function fpClimbOff(g) {
  var c = FP.c, z = c.pos[2], zi = Math.floor(z);
  FP.climb = null; FP.v[0] = FP.v[1] = 0;
  var s = standZ(g, Math.floor(c.pos[0]), Math.floor(c.pos[1]), Math.max(1, zi - FP_FALL), zi, FP_HEAD);
  if (s >= 0) { c.pos[2] = s; FP.jz = Math.max(0, z - s); } else FP.jz = 0;
  FP.jv = Math.sqrt(2 * FP_G * FP_JUMP);
}
// 樓梯不穿洞（TASK-0726；Tim 2026-10-19「有空洞的樓梯爬不上去(會穿洞)」「梯子判定可以只判定玩家視線內(要正對梯子 一定角度內)」
//   「不要強制上梯子 只是玩家正對且很靠近時 不要穿洞就好了(關閉穿洞邏輯)」）：
//   走路照格子找腳下 ⇒ 踏板之間的空洞那一柱站不住、往下找到下一層就落下去。⇒ 梯子的線（雕刻的固定點 foot → lo → hi → head，⛔ 不抬 CLIMB_LIFT）當成一道看不見的斜坡：
//   離那條線水平 FP_LAD_W 格內、高度跟腳差 FP_UP 格內 ⇒ 那裡多一個站得住的高度（fpRamp）。人照平常走（不強制上梯子、方向鍵照舊），只是不會從空洞掉下去。
//   · 走進斜坡（fpTry）要正對著那一段（視線的水平方向跟那一段的水平方向，往上或往下，夾角 FP_LAD_FACE 45° 內）；已經站在斜坡上（fpGround）不看方向 ⇒ 站著轉頭看旁邊不會掉下去。
//   · 側著走出去（不正對）⇒ 照平常的格子 ⇒ 該掉就掉；跳起來（在半空）⇒ 不墊斜坡 ⇒ 跳得下樓梯。
//   · 只有水平 ≥ FP_LAD_RUN 格的那幾段（直梯正上正下那一段沒有坡可以走，照舊按 E）；繩梯、跟著轉的繩梯不算（不是樓梯）。
//   · ?ladramp=0 ⇒ 不墊斜坡（以前的走法；對照用）。
var FP_LAD_FACE = Math.cos(45 * Math.PI / 180), FP_LAD_W = 4, FP_LAD_RUN = 1.5, FP_LAD_ON = Q.get('ladramp') !== '0';
/** (x, y) 那一柱在斜坡上的站立高度（離 z 最近、差 FP_UP 格內）；face ⇒ 只算正對著的那幾段；沒有 ⇒ −1。 */
function fpRamp(x, y, z, face) {
  if (!FP_LAD_ON) return -1;
  var best = -1, cy = Math.cos(FP.yaw), sy = Math.sin(FP.yaw);
  (FP.lads || []).forEach(function (L) {
    if (L.rope || L.ride) return;
    for (var i = 0; i + 1 < L.raw.length; i++) {
      var a = L.raw[i], b = L.raw[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], run = Math.hypot(dx, dy);
      if (run < FP_LAD_RUN) continue;
      if (face && Math.abs(cy * dx + sy * dy) / run < FP_LAD_FACE) continue;
      var t = ((x - a[0]) * dx + (y - a[1]) * dy) / (run * run);
      if (t < 0 || t > 1) continue;                                    // 只有那一段正上方（⛔ 夾到端點 ⇒ 端點外面水平 FP_LAD_W 格都墊成平台，梯頭外的艙口上方站得住、走到平台邊卡住，量過：憲法號 hold-main 從梯頭下不去）
      if (Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy) > FP_LAD_W) continue;
      var s = Math.round(a[2] + t * (b[2] - a[2]));
      if (Math.abs(s - z) <= FP_UP && (best < 0 || Math.abs(s - z) < Math.abs(best - z))) best = s;
    }
  });
  return best;
}
/** 鏡頭（03_camera.js camUpdate 開頭）：眼睛在船長頭上、照船的矩陣（內插過的）換到世界。 */
function fpCam() {
  if (!FP.on) return false;
  var sh = FP.sh, c = fpWho();
  if (FP.ez === null) fpEyeZ(0);
  var eye = M4.pt(sh.M, c.pos[0], c.pos[1], FP.ez);                    // 眼高平滑過（fpEyeZ）
  var cp = Math.cos(FP.pitch), sp = Math.sin(FP.pitch), cy = Math.cos(FP.yaw), sy = Math.sin(FP.yaw), dir = norm(M4.dir(sh.M, cy * cp, sy * cp, sp));
  var look = add(eye, dir);
  var proj = M4.persp(FP_FOV, CAM.w / CAM.h, 0.05, 5000);            // 近裁切面 5 cm（⛔ 0.5 m ⇒ 艙裡身邊的牆被切掉）
  var vp = M4.mul(proj, M4.lookAt(eye, look, fpCamUp(sh, dir, cy, sy, cp, sp))); camSet({ eye: eye, look: look, vp: vp, inv: M4.inv(vp) });
  return true;
}
/** 畫面的「上」（TASK-0700；Tim 2026-10-18：「第一人稱會遇到視角偶爾會快速旋轉很大角度(特別是當船傾斜時)」）：
 *  視線照船的座標算（yaw／pitch 是對船的），「上」以前一律是世界的 +y ⇒ 抬頭／低頭到底（±77°）再加上船傾斜，視線貼近、甚至越過垂直，
 *  lookAt 用 +y 算出的左右在那附近沒有定義：滑鼠轉 1° 畫面轉好幾度、越過垂直就整個翻 180°（量過：憲法號傾 8° 抬頭到底 1° ⇒ 2.9°，再多傾 20° ⇒ 13.3°）。
 *  ⇒ 兩個「上」：level ＝ 世界 +y 扣掉視線方向（水平線保持水平，以前的樣子）、ship ＝ 照船算的頭頂方向（永遠跟視線垂直、不會翻，水平線跟著船傾）。
 *  離垂直夠遠、兩個也同向 ⇒ 全用 level（平常的畫面一像素不差）；貼近垂直或已經越過 ⇒ 平滑換成 ship。
 *  量過（畫面轉的度數 ÷ yaw 轉的度數，抬頭／低頭到底、整圈每 0.5°）：船多傾 0／8／12／−12° ⇒ 以前 1.2／2.4／10.5／273× ⇒ 現在 1.2／1.2／1.3／1.3×；多傾 30° 最差 2.9×。只改畫面繞視線轉多少，視線本身不動（建造模式的準心照 FP.yaw／pitch 打，82_build.js）。 */
function fpCamUp(sh, dir, cy, sy, cp, sp) {
  var ship = norm(M4.dir(sh.M, -cy * sp, -sy * sp, cp)), lv = [-dir[0] * dir[1], 1 - dir[1] * dir[1], -dir[2] * dir[1]], ll = len(lv);   // lv ＝ +y − dir·(dir·+y)；長度 ＝ 視線離垂直的 sin
  if (ll < 1e-6) return ship;
  lv = mul(lv, 1 / ll);
  var d = lv[0] * ship[0] + lv[1] * ship[1] + lv[2] * ship[2];
  var w = fpSmooth(0.17, 0.87, ll) * fpSmooth(0, 0.5, d);             // 離垂直 10°～60° 之間（抬頭、低頭超過 30° 才開始）、兩個夾角 60°～90° 之間慢慢換（越過垂直 ⇒ 兩個反向 ⇒ 全用 ship）；⛔ 10°～30° ⇒ 船多傾 30° 時換得太急（放大 4.8×，量過）
  if (w >= 1) return [0, 1, 0];                                         // 平常 ⇒ 跟以前同一個輸入（lookAt 自己扣掉視線方向）
  return norm(add(mul(lv, w), mul(ship, 1 - w)));                       // d > 0 才有權重 ⇒ 兩個在 90° 內，加起來不會是 0
}
function fpSmooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
/** 鍵盤（71_input.js keydown／keyup 先問這裡）：第一人稱的鍵吃掉 ⇒ true；其他照舊（P 停格、O／Esc 設定）。 */
/** 第一人稱的動作 ⇒ FP.mv 哪一格（走、轉頭；66_keys.js：fpLook* 是固定的方向鍵）。 */
var FP_MV = { fpFwd: 'f', fpBack: 'b', fpLeft: 'l', fpRight: 'r', fpTurnL: 'tl', fpLookU: 'lu', fpLookD: 'ld', fpLookL: 'tl', fpLookR: 'tr' };
/** 鍵盤（71_input.js 先問這裡）：照第一人稱的鍵位（66_keys.js keyAct 'fps'）；沒有綁 ⇒ false（往下給建造、海戰）。 */
function fpKey(k, down) {
  var a = keyAct('fps', k); if (!a) return false;
  if (a === 'fpRun') { FP.run = down && FP.on; return FP.on; }
  if (a === 'fpUnlock') { if (down && FP.on) fpUnlock(); return FP.on; }   // 按住 ⇒ 放開滑鼠、遊戲不停；點回畫面再抓
  if (!FP.on) { if (!down && FP_MV[a]) FP.mv[FP_MV[a]] = 0; return false; }
  if (a === 'fpExit') { if (down) fpExit(); return true; }             // 回到原本的鏡頭（建造模式鎖定 ⇒ 只說一聲）
  if (a === 'fpClimb') { if (down) fpClimbGo(); return true; }         // 爬梯子
  if (a === 'fpJump') { if (FP.mode === 2) FP.mv.up = down ? 1 : 0; else if (down) fpJump(); return true; }   // 跳（Tim 2026-10-16）；浮空 ⇒ 往上
  if (a === 'fpDown') { FP.mv.dn = down && FP.mode === 2 ? 1 : 0; return true; }   // 浮空 ⇒ 往下（第一人稱時不換鏡頭，鏡頭本來就不歸它管）
  if (a === 'fpFollow' || a === 'fpNext') { if (down) fpFollow(a === 'fpNext'); return true; }   // 跟隨／回來、換下一個（第一人稱時不開砲）
  if (FP_MV[a]) FP.mv[FP_MV[a]] = down ? 1 : 0;
  return true;
}
/** 拖曳轉頭（71_input.js pointermove）：往右拖 ⇒ 往右看。 */
function fpLook(dx, dy) { FP.yaw += dx * 0.005; FP.pitch = clamp(FP.pitch - dy * 0.005, -1.35, 1.35); FP.lookT = performance.now(); }   // lookT：跟隨中 2 秒內不自動轉
// 設定面板的開關、第一人稱的操作面板（按住才動：放開、移出、取消都停）
$('fpT').onclick = function () { if (FP.on) fpExit(); else { fpSet(true); gsetClose(); } };   // 關：跟 🎥 同一條（建造模式鎖定 ⇒ 不關）
$('fpExit').onclick = fpExit;
/** 開局（70_flow.js start，reset 之後）：只有建造模式回到第一人稱（Tim 2026-10-17「第一人稱維持只有在建築模式下 重開維持 其他模式都不維持」）。
 *  別的玩法：reset 換了一艘我艦 ⇒ 下一格 fpFrame 看到 SHIPS[PLAYER_I] 不是原本那艘就退出 ＝ 不維持（⛔ 10-16 那版 FP.want 每個玩法都帶回來）。
 *  建造模式 bldEnter（82_build.js）自己會開；這裡再保一次（bldEnter 之後才跑）。 */
//   ⚠ reset 之後 FP.on 還是 true（下一格 fpFrame 才退出）⇒ 看的是「跟的是不是現在這艘我艦」，不是 FP.on。
function fpKeep() { if (fpBuildLock() && !fpOnMine()) fpSet(true, true); }
function fpOnMine() { return FP.on && FP.sh === SHIPS[PLAYER_I]; }
$('fpLampT').onclick = function () { FP.lamp = !FP.lamp; fpUI(); };   // 提燈：開關不關設定面板；跨場留著
// 滑鼠模式（Tim 2026-10-16「視角旋轉是否可以參考PC版minecraft … 點了滑鼠後會變成滑鼠模式」；查過：Minecraft Java 版抓住滑鼠一動就轉頭，Esc 放開並打開暫停選單，點回畫面再抓住）：
//   ⛔ 31be9d3 那版的鎖定：Esc 只放開、什麼都沒打開 ⇒ Tim「要esc後才能跟ui互動」。這一版照 Minecraft：
//   · 點一下 3D 畫面（左鍵）⇒ 抓住滑鼠（Pointer Lock），一動就轉頭（FP_MOUSE_K：每 px 約 0.15°，約 Minecraft 預設靈敏度），畫面中間一個準心（#fpCross）。開第一人稱時不自動抓。
//   · Esc（瀏覽器自己放開）⇒ 打開設定（遊戲停）＝ Minecraft 的暫停選單；關掉之後點畫面再抓。
//   · 按住 Alt ⇒ 先放開、遊戲不停（像 Minecraft 的 Mouse Unlock 模組），點回畫面再抓。P 停格、O 設定也會放開。
//   · 沒抓的時候照舊按住拖曳轉頭（71_input.js）；只認滑鼠（pointerType mouse），觸控不受影響。抓住時游標的 client 座標不動 ⇒ 拖曳那條算出 0，不會轉兩次。
var FP_MOUSE_K = 0.52, FP_ESC_T = 0, FP_SPIKE = 250;   // FP_SPIKE：抓住滑鼠時一次超過這麼多 px 的位移當成假的（71_ctrl.js look；TASK-0700）
function fpLocked() { return document.pointerLockElement === cv; }
function fpLock() { if (!fpLocked() && cv.requestPointerLock) { try { var r = cv.requestPointerLock(); if (r && r.catch) r.catch(function () { }); } catch (x) { } } }
function fpUnlock() { if (fpLocked() && document.exitPointerLock) { FP.unlockMine = true; document.exitPointerLock(); } }
/** 71_input.js 的 Esc 先問這裡：剛因為 Esc 放開、已經替它打開了設定 ⇒ 吃掉（⛔ 不吃 ⇒ 同一下 Esc 又把設定關掉）。 */
function fpEscEaten() { return performance.now() - FP_ESC_T < 400; }
// 抓住滑鼠（左鍵按下）、抓住時的移動 ⇒ 轉頭：71_ctrl.js 的 fp 控制器（down／look）。
document.addEventListener('pointerlockchange', function () {
  var on = fpLocked(); $('stage').classList.toggle('fpLock', on);
  if (on) return;
  if (FP.unlockMine) { FP.unlockMine = false; return; }                // 自己放的（Alt、停格、離開第一人稱）
  if (FP.on) setTimeout(function () { if (FP.on && !GSET.open) { gsetOpen(); FP_ESC_T = performance.now(); } }, 60);   // 瀏覽器放的（Esc）⇒ 打開設定
});
[].forEach.call(document.querySelectorAll('#gset [data-fpm]'), function (b) { b.onclick = function () { fpMode(+b.dataset.fpm); }; });   // 碰撞三段（正常／穿牆／浮空）：開關不關設定面板；跨場留著
[].forEach.call(document.querySelectorAll('#fpUI [data-fp]'), function (b) {
  var k = b.dataset.fp;
  function on(e) { e.preventDefault(); FP.mv[k] = 1; b.classList.add('down'); }
  function off() { FP.mv[k] = 0; b.classList.remove('down'); }
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
});
$('fpRun').onclick = function () { FP.run = !FP.run; $('fpRun').classList.toggle('on', FP.run); };
$('fpClimb').onclick = function () { fpClimbGo(); };
$('fpJump').addEventListener('pointerdown', function (e) { e.preventDefault(); fpJump(); });
$('fpFol').onclick = function () { fpFollow(false); };
$('fpNext').onclick = function () { fpFollow(true); };
window.addEventListener('blur', fpStop);
// 虛擬搖桿（Tim 2026-10-16「移動要改為虛擬搖桿(同時支援WASD 但不用顯示按鍵)」「旋轉視角是否也可以用虛擬類比控制」）：按住拖 ⇒ 推到邊 ＝ 全速、推一半 ＝ 半速；
//   中間一小圈（12%）不動（手指放上去不會溜）；放開、取消 ⇒ 回中間（joyBind）：
//   左下 #fpJoy 走路 ⇒ FP.joy ＝ [往前, 往右]（跟鍵盤的合起來夾到 1）。
//   ⛔ 右下轉頭的那一支（#fpJoyR）拿掉了（Tim 2026-10-17 手機試玩「右側轉視角的我發現用不到(螢幕任意位置都能滑動轉視角)」）：
//   轉頭 ＝ 畫面上任何地方拖曳（71_input.js pointermove → fpLook）或方向鍵；FP.look 留著給 fpFrame 加，現在一直是 0。
function joyBind(pad, knob, set) {
  var J = { id: null, cx: 0, cy: 0, R: 1 };
  function draw(x, y) { knob.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)'; }
  function move(e) {
    var dx = e.clientX - J.cx, dy = e.clientY - J.cy, l = Math.hypot(dx, dy), s = l > J.R ? J.R / l : 1;
    dx *= s; dy *= s; draw(dx, dy);
    var a = Math.hypot(dx, dy) / J.R, dead = 0.12, k = a < dead ? 0 : (a - dead) / (1 - dead) / (a || 1);
    set(dx / J.R * k, dy / J.R * k);
  }
  function end(e) { if (e.pointerId !== J.id) return; J.id = null; set(0, 0); draw(0, 0); }
  pad.addEventListener('pointerdown', function (e) {
    e.preventDefault(); var b = pad.getBoundingClientRect();
    J.id = e.pointerId; J.cx = b.left + b.width / 2; J.cy = b.top + b.height / 2; J.R = b.width / 2 - 14;
    try { pad.setPointerCapture(e.pointerId); } catch (x) { } move(e);   // 抓不到（合成的事件、指標已經放開）⇒ 照樣動
  });
  pad.addEventListener('pointermove', function (e) { if (e.pointerId === J.id) move(e); });
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
  return draw;
}
var joyDraw = joyBind($('fpJoy'), $('fpKnob'), function (x, y) { FP.joy = [-y, x]; });
