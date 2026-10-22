var SURVEY_PH = 7;                                                  // 定期檢查的相位：第 i 艘在第 (i × 7) mod 30 步量（TASK-0673；7 跟 30 互質 ⇒ 30 艘以內不重複）
// ───────────────────────── 電腦 ─────────────────────────
function simAi(sh, dt) {
  var foe = foeOf(sh);                                              // 自己的目標（52_fleet.js；一對一 ＝ 另一艘）
  if (sh.sunk || sh.struck || sh.sinkingFinal || !foe) return;
  if (foe.sunk || foe.struck || foe.sinkingFinal) return;            // 對方降旗或在沉 ⇒ 停火
  captainThink(sh, foe);                                            // 砲長：該換瞄準模式就換（51_captain.js）
  if (sh.hand && (!sh.aimOn || isOut(sh.aimOn))) { sh.hand = false; setAim(sh, null); }   // 手動瞄的那艘出局了 ⇒ 回到全自動
  aiSecond(sh, foe, dt);                                            // 另一舷：對不到目標、但對得到別的敵艦的那幾門（沒有別的敵艦 ⇒ 什麼都不做）
  if (sh.hand && sh.i === PLAYER_I) return;                         // 自動開砲＋手動瞄準（71_input.js pick）：目標那一舷交給玩家（不改瞄準點、不替他開）
  sh.aiWait -= dt; if (sh.aiWait > 0) return;
  if (!anyBears(sh, foe.center)) { sh.aiWait = 0.5; return; }       // 哪一舷都對不到 ⇒ 等船轉過來
  var ready = 0, alive = 0, held = 0, FK = friendKeels(sh);         // 隔著友船的那幾門不算（52_fleet.js；沒有友船 ⇒ 空的）
  sh.guns.forEach(function (g) { if (g.alive && gunRate(g) > 0 && gunTarget(sh, g, foe.center)) { if (FK.length && friendInLine(FK, M4.pt(sh.M, g.muz[0], g.muz[1], g.muz[2]), foe.center)) { held++; return; } alive++; if (g.reload <= 0) ready++; } });
  if (!ready && held) { sh.ffHold = (sh.ffHold || 0) + held; sh.aiWait = 0.3; return; }   // 對得到的都隔著友船 ⇒ 忍住、等一下再看（不每一步重算）
  if (!ready || ready < Math.ceil(alive * 0.65)) return;
  var a = modeAim(foe, aimModeFor(sh, foe), true), t = a.t;           // 砲長選的模式（沒有帆可打 ⇒ 不瞄帆具；51_captain.js aimModeFor）裡亂挑一點（⛔ 以前固定 45% 船殼／27% 砲甲板／28% 桅，船殼瞄的是設計水線 ⇒ 敵艦浮高了還打在水面上）
  var err = Math.max(0.6, 4.5 - sh.salvo * 0.55) / S, aim = [t[0] + gauss() * err * 1.6, t[1], t[2] + gauss() * err * 0.5];
  var ammo = gunnerAmmo(sh, foe, t);                                // 照瞄準點落在哪一帶挑彈（51_captain.js）：砲長想瞄的那一點（⛔ 加了散布的 ⇒ 第一輪高度散 ±22 格，瞄砲甲板有一半落到水線那一帶、換成實心）
  if (sh.i === PLAYER_I) AMMO_AUTO = ammo;                          // 我艦自動開砲：彈種鈕跟著砲長換（Tim 2026-10-18；⛔ 不寫 AMMO_I：那是玩家自己選的、記在偏好裡）
  setAim(sh, aim, foe);
  sh.aiSpread = 0.006;
  broadside(sh, ammo, true);
  sh.aiWait = rr(1.0, 3.5);
}
/** 兩舷都開（Tim 2026-10-13：「兩側都有敵人時，也只能單側開砲」）：主要目標 foe 照舊（ai）；另外挑一艘別的敵艦（近的先），
 *  拿「對不到 foe、對得到它」的那幾門（還沒排進齊射、沒隔著友船）另開一輪 —— 自己的節奏 sh.aiWait2、自己的瞄準點（broadsideAt）。
 *  只有別的敵艦時才動（一對一 ⇒ 一進來就回去，不抽亂數 ⇒ 一位元都不差）。 */
function aiSecond(sh, foe, dt) {
  // 保留給主要那一輪的砲：平常 ＝ 對得到 foe 的；玩家手動瞄準時（sh.hand，自動開砲開著、點了一艘船）＝ 打得到瞄準圈的那幾門
  //   （Tim 2026-10-14：「能打到瞄準圈的砲不自動開砲，其他的自動瞄準、自動開砲」；瞄的可以是友艦）⇒ 其他敵艦（含 foe）都可以當這一輪的目標。
  var hand = sh.hand && sh.i === PLAYER_I && sh.aim && sh.aimOn, ex = hand ? sh.aimOn : foe;
  var others = SHIPS.filter(function (o) { return isFoe(sh, o) && o !== ex && !o.sunk && !o.struck && !o.sinkingFinal && o.center; });
  if (!others.length) return;
  sh.aiWait2 = (sh.aiWait2 || 0) - dt; if (sh.aiWait2 > 0) return;
  sh.aiWait2 = 0.5;                                                 // 沒開成 ⇒ 半秒後再看
  others.sort(function (a, b) { return Math.hypot(a.px - sh.px, a.pz - sh.pz) - Math.hypot(b.px - sh.px, b.pz - sh.pz); });
  var pend = EVENTS.filter(function (e) { return e.sh === sh.i; }).map(function (e) { return e.g; }), FK = friendKeels(sh);
  var exAim = hand ? sh.aim : [ex.T.cx, ex.T.cy, ex.T.geo.aim], exW = hand ? M4.pt(ex.M, exAim[0], exAim[1], exAim[2]) : ex.center;
  var free = sh.guns.filter(function (g) { return g.alive && gunRate(g) > 0 && pend.indexOf(g) < 0 && !withAim(sh, exAim, ex, function () { return gunTarget(sh, g, exW); }); });
  for (var j = 0; j < others.length; j++) {
    var o = others[j], oAim = [o.T.cx, o.T.cy, o.T.geo.aim], alive = [], ready = [];
    free.forEach(function (g) {
      if (!withAim(sh, oAim, o, function () { return gunTarget(sh, g, o.center); })) return;
      if (FK.length && friendInLine(FK, M4.pt(sh.M, g.muz[0], g.muz[1], g.muz[2]), o.center)) return;
      alive.push(g); if (g.reload <= 0) ready.push(g);
    });
    if (!ready.length || ready.length < Math.ceil(alive.length * 0.65)) continue;
    var a = modeAim(o, aimModeFor(sh, o), true), t = a.t, err = Math.max(0.6, 4.5 - sh.salvo * 0.55) / S;
    var aim = [t[0] + gauss() * err * 1.6, t[1], t[2] + gauss() * err * 0.5];
    var tgt = M4.pt(o.M, aim[0], aim[1], aim[2]);
    var guns = ready.filter(function (g) { return withAim(sh, aim, o, function () { return gunTarget(sh, g, tgt); }); });
    sh.aiSpread = 0.006;
    if (broadsideAt(sh, gunnerAmmo(sh, o, t), o, aim, guns)) { sh.aiWait2 = rr(1.0, 3.5); return; }
  }
}

// ───────────────────────── 船的移動切小步（TASK-0797） ─────────────────────────
// 步長變大（物理設定「模擬步長」、擬真沙盒降 Hz）時，船一步走得多 ⇒ 船對船碰撞、擱淺壓得比較深才判到。照位移上限：
// 船彼此靠近（間隔 < 兩邊這一步走的 ＋ 10 m）或有海圖（會擱淺）、這一步要走超過 SHIP_CAP ⇒ 帆（移動）＋碰撞＋擱淺切成幾小步；
// 船體、船員照舊一整步。60 Hz ⇒ 一定 1（subSteps），走原本那一條、一行都不多算。
var SHIP_CAP = 0.5;                                                  // 公尺
function shipSubSteps() {
  if (!(DT > DT60 * 1.000001)) return 1;
  var need = 0, d = SHIPS.map(function (sh) { var hl = (sh.T.wl1 - sh.T.wl0) * S / 2; return { sh: sh, hl: hl, d: (Math.hypot(sh.vel[0], sh.vel[2]) + Math.abs(sh.yawRate || 0) * hl) * DT }; });
  for (var i = 0; i < d.length; i++) {
    var A = d[i]; if (A.sh.sunk) continue;
    if (BED) need = Math.max(need, A.d);
    for (var j = i + 1; j < d.length; j++) {
      var B = d[j]; if (B.sh.sunk) continue;
      if (Math.hypot(A.sh.px - B.sh.px, A.sh.pz - B.sh.pz) - A.hl - B.hl < A.d + B.d + 10) need = Math.max(need, A.d + B.d);
    }
  }
  return subSteps(need, SHIP_CAP, DT);
}
/** 只更新船的矩陣（切小步時，碰撞與擱淺要看這一小步的位置）；畫面內插的「上一步」記在 Mpre（32_hull.js stepShip 取用）。 */
function shipPose(sh) {
  if (!sh.Mpre) sh.Mpre = sh.M;
  sh.M = M4.mul(shipMatrix(sh), M4.ident()); sh.inv = M4.inv(sh.M); sh.center = shipCenter(sh);
}
/** 前 k 小步（最後一小步在 simStep 本來那一段）：帆（移動）→ 矩陣 → 碰撞 → 擱淺。 */
function shipPreMove(k, h) {
  for (var s = 0; s < k; s++) {
    SHIPS.forEach(function (sh) { sailShip(sh, h); shipPose(sh); });
    collide(h);
    if (BED) SHIPS.forEach(function (sh) { groundStep(sh, h); });
  }
}

// ───────────────────────── 海上平靜（TASK-0799） ─────────────────────────
// 沒有砲彈在飛、每一對還在打的敵對船都隔 CALM_R 以上 ⇒ 航行：粗步長（sailDt，TASK-0800）。（布照畫面格算一開始也只在航行，後來交戰也是 ⇒ 不看這個。）
// 照遊戲狀態（距離、陣營、砲彈），⛔ 不照鏡頭。CALM_R 比長砲最遠的射程遠 ⇒ 敵艦開進射程之前就回到每一步都算。
var CALM_R = 2000;                                                   // 公尺
function seaCalm() {
  if (BALLS.length) return false;
  for (var i = 0; i < SHIPS.length; i++) {
    var a = SHIPS[i]; if (isOut(a)) continue;
    for (var j = i + 1; j < SHIPS.length; j++) { var b = SHIPS[j]; if (isFoe(a, b) && !isOut(b) && Math.hypot(a.px - b.px, a.pz - b.pz) < CALM_R) return false; }
  }
  return true;
}
// ───────────────────────── 航行粗步長（TASK-0800） ─────────────────────────
// 海上平靜、沒有船在燒 ⇒ 一步 k × DT_BASE：k ＝ 模擬速度取整、最多到 SAIL_DT_MAX（60 Hz ⇒ ×6 以上 0.1 秒一步）；不平靜 ⇒ 回到 DT_BASE（開戰時照物理設定，70_flow.js）。
//   ×1 照舊 DT_BASE：⛔ 0.1 秒一步時畫面一格不一定有一步 ⇒ 船上走動的人、砲演出照 10 Hz 一頓一頓（renderLerp 只內插船身）；快轉時一格畫面約一步 ⇒ ×8 每真實秒 80 步（以前 480）。
//   著火照相位輪（49_burn.js：每一格火記著自己第幾步燒，步長一換相位就對不上、有的格永遠輪不到）⇒ 有船在燒不切。
//   只在 k × DT_BASE 的格子上切（SIMT 是它的整數倍；不是 ⇒ 先走 DT_BASE 走到對齊）⇒ 每半秒、每 3 秒那些節拍照舊落在同一串時間上。
//   照遊戲狀態與模擬速度（玩家的輸入），⛔ 不照鏡頭；只有畫面迴圈切（90_main.js frame，每一步之前）—— ?demo、__game.run 照 DT_BASE。
var DT_BASE = 1 / 60, SAIL_DT_MAX = 0.1;
function burning(sh) { var B = sh.burn; return !!B && (B.n > 0 || B.sl.length > 0 || B.q.length > 0); }
function sailDt() {
  var k = Math.min(Math.floor(SIM_SPEED + 1e-6), Math.floor(SAIL_DT_MAX / DT_BASE + 1e-6));
  if (k <= 1 || Math.round(SIMT / DT_BASE) % k || !seaCalm() || SHIPS.some(burning)) return DT_BASE;
  return k * DT_BASE;
}

// ───────────────────────── 遠方與視線外的船降級（TASK-0802） ─────────────────────────
// Tim 2026-10-22：「是否可以讓視線外的部分也降低模擬精度(降到30Hz甚至更低 確保關鍵模擬(砲擊)符合就好)」「遠方&視線外」⇒ 照鏡頭（03_camera.js camSimFar，跟「遠方帆繩」同一個設定）。
// 降的：船員（走路、爬梯、送藥、救火、火槍上膛…；stepCrew 照 dt 算 ⇒ m 步走一次、dt ＝ 累積的時間），一次最多 SIM_FAR_DT 秒（15 Hz）。
// 照舊每步的：開火、砲彈、裝填倒數（32_hull.js stepShip）、AI 瞄準、帆與動力（sailShip 推位置 ⇒ 砲彈打到船的位置照每步）。帆布本來就照鏡頭降（RIG_FAR）；局勢檢查另外分析（TASK-0812）。
// 沒有鏡頭（?demo、無頭）⇒ 1 ⇒ 每步走、dt ＝ DT，逐位元不變。代價：鏡頭擺的地方不同，戰局可能不同（Tim：「不追求一致性」）。
var SIM_FAR = [null, { d1: 300, m1: 2, d2: 1e9, m2: 2, off: 4 }, { d1: 200, m1: 2, d2: 400, m2: 3, off: 4 }], SIM_FAR_DT = 1 / 15;   // 照 PHX.rigfar：遠方半速 ⇒ 300 m 外 30 Hz；遠方⅓ ⇒ 200 m 外 30、400 m 外 20 Hz；看不到 ⇒ 15 Hz
function simFarM(sh) { var m = evAsk('simFar', 1, sh); return m > 1 ? Math.max(1, Math.min(m, Math.floor(SIM_FAR_DT / DT + 1e-6))) : 1; }   // 粗步長（0.1 秒一步）⇒ 1
function crewStep(sh) {
  var m = sh.simM = simFarM(sh); sh.crewAcc = (sh.crewAcc || 0) + DT;
  if (m > 1 && (SIM_N + sh.i) % m) return;                          // 錯開：各艘不在同一步補
  stepCrew(sh, sh.crewAcc); sh.crewAcc = 0; sh.crewN = (sh.crewN || 0) + 1;
}

// ───────────────────────── 一步 ─────────────────────────
var SIM_N = 0;                                                       // 走過幾步（只給讀數：步長會變 ⇒ ⛔ 不能拿 SIMT ÷ DT 數；__game.tick）
var VIEW_HOLD = false, VIEW_ACC = 0;                                // 只給人看的推進（viewStep）：畫面一格補好幾步時只在最後一步推一次（90_main.js frame 設 VIEW_HOLD）；快轉、無頭照舊每一步推
function simStep() {
  if (PF) PF.t = performance.now();                                 // 逐幀分段計時（?debug=1，00_core.js）
  SIMT += DT; SIM_N++;
  if ((Math.round(SIMT / DT) % everySteps(CMD_EVERY_S)) === 0) cmdTick();   // 指揮官每 3 秒想一次（52_fleet.js；不抽亂數）
  pickFoes();                                                      // 每艘的目標（52_fleet.js）：這一步之內都用同一個
  stepWind(SIMT);                                                  // 風會變（08_weather.js）
  SHIPS.forEach(function (sh) { if (sh.mounts || sh.tur) mountStep(sh, DT); if (sh.ropeAnims !== null) ropeAnimStep(sh); });   // 繩跟著武器：綁在迴旋砲上的繩跟著轉、meta anim=gun 的繩端照開火與裝填動（26_gunanim.js；沒有的船第一步之後就跳過）   // 迴旋砲、砲塔照瞄準點轉（21_gunnery.js；TASK-0626）—— 沒有 ⇒ 不做事
  for (var i = 0; i < EVENTS.length; i++) {
    var e = EVENTS[i]; if (e.t > SIMT) continue;
    EVENTS.splice(i--, 1);
    var sh = SHIPS[e.sh];
    if (e.on) withAim(sh, e.aim, e.on, function () { sh.autoNow = true; var et2 = sh.sunk ? null : gunTarget(sh, e.g, add(aimPoint(sh), mul(shipAxis(sh), e.off))); if (et2) fireGun(sh, e.g, et2, e.ammo); sh.autoNow = false; });   // 另一舷那一輪：照它自己的瞄準點（21_gunnery.js broadsideAt）
    else { var et = sh.sunk ? null : gunTarget(sh, e.g, add(aimPoint(sh), mul(shipAxis(sh), e.off))); if (et) fireGun(sh, e.g, et, e.ammo); }   // 開火那一刻才挑點（兩艘都在動）
  }
  SHIPS.forEach(burstStep);                                        // 連發剩下的那幾發（21_gunnery.js；burst ＝ 1 的砲什麼都不做）
  if (PF) pfLap('fire');
  var nMv = shipSubSteps(), hMv = nMv === 1 ? DT : DT / nMv;       // 船的移動切小步（TASK-0797；60 Hz ⇒ 1、hMv ＝ DT）
  if (nMv > 1) shipPreMove(nMv - 1, hMv);
  SHIPS.forEach(function (sh) { sailShip(sh, hMv); if (sh.spins) spinStep(sh, DT); stepShip(sh, DT); if (sh.anc) chainStep(sh, DT); if (PF) pfLap('ship'); crewStep(sh); if (PF) pfLap('crew'); });
  collide(hMv);
  if (BED) SHIPS.forEach(function (sh) { groundStep(sh, hMv); });  // 擱淺（32_ground.js；有海圖才有）
  SHIPS.forEach(function (sh) {                                    // 照 SHIPS 的順序（一對一：我艦先、敵艦後 ⇒ 跟以前同一個順序抽亂數）
    if (sh.i === PLAYER_I) { if (AUTOFIRE) simAi(sh, DT); }            // 自動開砲：我艦也交給電腦瞄準開火
    else if (modeRule('othersAct')) simAi(sh, DT);                // 玩法規則 othersAct（04_modes.js）：沙盒的其他船不還手
  });
  if (PF) pfLap('ai');
  for (i = 0; i < BALLS.length; i++) { stepBall(BALLS[i], DT); if (!BALLS[i].alive) { evEmit('ballGone', BALLS[i]); BALLS.splice(i--, 1); } }
  if (PF) pfLap('balls');
  SHIPS.forEach(function (sh) { if (sh.burn) burnStep(sh); });     // 著火（49_burn.js；著過火的船才有 sh.burn）：燒穿的格下面 integrity 同一步斷開
  if (PF) pfLap('burn');
  SHIPS.forEach(function (sh) { integrity(sh); sh.impulse = [0, 0, 0]; });
  if (PF) pfLap('integrity');
  for (i = 0; i < PIECES.length; i++) if (!stepPiece(PIECES[i], DT)) { evEmit('pieceGone', PIECES[i]); PIECES.splice(i--, 1); }
  for (i = 0; i < FLY.length; i++) if (!stepFly(FLY[i], DT)) FLY.splice(i--, 1);
  if (PF) pfLap('pieces');
  if (!FLAB_HIDE) { if (SLOW_VIS) evEmit('viewStepSlow', DT); else { VIEW_ACC += DT; if (!VIEW_HOLD) { evEmit('viewStep', VIEW_ACC); VIEW_ACC = 0; } } }   // VIEW_HOLD：這一格畫面後面還要補步（90_main.js frame）⇒ 先累著、最後一步一次推（照 dt 生、照 dt 走 ⇒ 量一樣；補 3 步不再推 3 次）   // FLAB_HIDE：擬真沙盒只看俯視圖時不推（84_fleetlab.js；只給人看的，不改戰局）             // 只給人看的推進：碎木、煙囪排煙、粒子、船邊水花（各自的亂數；00_events.js）；殉爆慢動作中（73_slowmo.js）只推船邊水花，其餘照畫面的時間走
  if (PF) pfLap('water');                       // 船邊水花（13_water.js；只給人看、自己的亂數）
  if (PHYS) { var pt0 = performance.now(); if (VIS_FRAME) SHIPS.forEach(function (sh) { if (sh.sink < 40) physGameStep(sh); }); else { SHIPS.forEach(function (sh) { if (sh.sink < 40) physStep(sh); }); clothContactsRun(); } PHYS_MS = PHYS_MS * 0.98 + (performance.now() - pt0) * 0.02; }   // 讀數只看、不回寫模擬；VIS_FRAME（有畫面）⇒ 這裡只算帆桁追風那一段，布在畫面這一格算（TASK-0799）
  if (PF) pfLap('phys');
  stepPowder();                                                    // 殉爆排程（23_powder.js）
  stepBlasts();                                                    // 還沒挖完的彈坑接著挖（23_powder.js）
  if (PF) pfLap('powder');
  var stp = Math.round(SIMT / DT), sev = everySteps(0.5);       // sev：半秒幾步（60 Hz ＝ 30；擬真沙盒降物理 fps 照秒數，00_core.js everySteps）                                  // 每半秒的定期檢查（TASK-0673）：每艘自己的相位（sh.i × 7 步）⇒ 8 艘不擠在同一步（以前同一步 35–50 ms）；
  SHIPS.forEach(function (sh) { if ((stp + sh.i * SURVEY_PH) % sev === 0 || sh.mass0 === undefined) { survey(sh); evEmit('survey', sh); } });   //   第一次（開戰那一步、候補進場）照舊馬上量（定浮的位置、開戰時的重量）
  if (stp % sev === 0) { reinforce(); playerHandoff(); }             // reinforce：空出名額 ⇒ 候補進場；playerHandoff：我艦出局 ⇒ 換到友艦（52_fleet.js；沒有候補／我艦還在打 ⇒ 直接回去）
  if (PF) pfLap('survey');
  evEmit('stepEnd');                                              // 每一步最後：戰鬥報表（79_report.js，只讀）、測試記錄（83_testlog.js）、結束判定（61_hud.js endTick；結算畫面照模擬時間延後跳）
  if (PF) pfLap('end');
}

