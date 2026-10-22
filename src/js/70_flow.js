// ───────────────────────── 開局 ─────────────────────────
function reset() { stepsRun(resetSteps()); }
/** 開局拆成步驟（2026-10-20；?start=1 分段做見 startStaged）：清場 ⇒ 擺船（52_fleet.js spawnSteps：每艘 makeShip 的那幾段）⇒ 指揮官、選敵 ⇒ 第一步的受力與巡視 ⇒ 碰撞取樣（每型每檔一步）⇒ 砲長、鏡頭。
 *  照順序做 ＝ 拆之前的 reset（stepsRun 一口氣做完：主選單、__game、快轉都走這條）。 */
function resetSteps() {
  return [function () {
  END_AT = 0; END_WAIT = null;
  if (!LAB_FLEET) DT = 1 / (PHX_STEP_HZ[PHX.step] || 60);          // 模擬步長（09_phx.js；TASK-0805）：開戰時決定、戰鬥中改了下一場生效；擬真沙盒自己設（84_fleetlab.js flabSetup）
  DT_BASE = DT;                                                       // 航行粗步長切回來的那一個（50_sim.js sailDt；TASK-0800）
  rngReset(); SH_STAT.cut = SH_STAT.tris = 0; FLOOD_LV = PHX.flood; WP_STAT.spray = WP_STAT.foam = 0; WP_STAT.src = {}; DEB_ACC = PT_ACC = 0; SIMT = 0; windInit(); stepWind(0); vxInit();   // 開局的風：這一場的風向、風速（08_weather.js windInit）              // 碎木、水花、進水粒子的亂數，少生的節拍跟著重設（12_effects.js、13_water.js、33_flood.js）；進水模式在這裡定（戰鬥中改了下一場生效）
  SHIPS.forEach(function (sh) { sh.rs.dispose(); armDispose(sh); glsFree(sh); });   // armDispose：砲帶的裝甲（24_armor.js）；glsFree：玻璃網格（15_smooth.js）
  PIECES.forEach(function (pc) { if (pc.rs) pc.rs.dispose(); });   // 無頭：碎塊沒掛網格（62_simview.js）
  SHIPS = []; PIECES = []; BALLS = []; EVENTS = []; FLY = []; BOOMS = []; SELFB = []; BLASTS = []; D.n = 0; PT.n = 0; WS.n = WF.n = 0; SIMT = 0; OVER = false; PAUSED = false;   // 彈種（AMMO_I）重開時保留（Tim 2026-10-12）
  clearMsgs(); fleetReset();                                          // 上方艦隊：每一場開局全折疊（61_hud.js）
  rptReset(); tlgReset(); rlgReset(); if ($('rpt')) $('rpt').style.display = 'none';   // tlgReset：測試模式的船員記錄（83_testlog.js）          // 戰鬥報表（79_report.js）：每一場從頭記
  PSLOW.ts = 1; PSLOW.ms = 0;                                         // 物理減速（73_slowmo.js）：重開從 1× 起、重新量
  slowCamDrop(); SLOW.active = false; SLOW.ts = 1; SLOW.t = 0; SLOW.kicks = 0;   // 殉爆的慢動作與特寫（73_slowmo.js）：⛔ 不清 ⇒ 殉爆、自爆後馬上重開，新的一局接著慢、幾秒後鏡頭被拉回上一局的爆心；slowCamDrop ⇒ 特寫關掉的跟船還回來（⛔ 只清存檔 ⇒ 新的一局鏡頭不跟船轉）
  PLAYER_I = 0;
  CORE_LOG = []; return spawnSteps(fleetSpec());                                    // 編隊（52_fleet.js spawnFleet）：一對一 ＝ 以前那兩艘、同一個位置；船型要先載好（loadHull）
  }, function () {
  cmdReset(); cmdTick();                                             // 指揮官（52_fleet.js、53_commander.js）：開局先想一次
  pickFoes();
  KEYS.l = KEYS.r = false;
  if (MODE !== LAST_MODE) { setAutoFire(modeRule('autoFire')); LAST_MODE = MODE; }   // 自動開砲：換了模式才套預設（玩法規則 autoFire，04_modes.js：觀戰開、其他關），同一個模式重開保留（Tim 2026-10-12）
  }, function () {
  SHIPS.forEach(function (sh) { stepShip(sh, 0); survey(sh); });
  }, function () {
  RAM_EV = []; return hitWarmSteps();                                // 船隻碰撞的取樣先建好（31_sailing.js hitWarm；⛔ 第一次碰到才建 ⇒ 撞上那一刻卡約 0.1 秒）
  }, function () {
  pickCaptains();                                                    // 砲長（51_captain.js）
  obsReset();                                                        // 觀察模式（透視、剖面、隱藏甲板；72_floodui.js）：繼續後會留著 ⇒ 新開一局才收
  camStart();                                                        // 開局的鏡頭（03_camera.js：鏡頭只由那一支檔寫）
  }];
}

// ── 遊戲狀態（在跑 RUNNING、停格 PAUSED、玩法 MODE）只由這一支檔寫（TASK-0669 ③）：其他檔要改 ⇒ 叫這三個（admin.py 建置擋別的檔直接寫）。
function flowRun(on) { RUNNING = on; }
function flowPause(on) { PAUSED = on; }
function flowMode(m) { MODE = m; }

/** ?start=1（外部開戰用：Blocksail 的「一鍵開戰」，2026-10-18）：主選單的艦隊都載好 ⇒ 直接開戰、不停在主選單（90_main.js 載完呼叫）。
 *  其他照網址：?blue=…&red=…（或 ?ship=我艦,敵艦）、?mode=、?weather=、?dist=…；帶了這些 ⇒ 這一場不寫存檔（69_prefs.js PREF_Q）。
 *  開戰分段做（startStaged）；做完 ?map=@host ⇒ 鏡頭停在正上方、跟外面那一頁說 'started'。 */
var START_Q = Q.get('start') === '1';
function startWhenReady() {
  Promise.all(fleetHulls().map(loadHull)).then(function () {
    if (RUNNING || FLOW_STAGE || !fleetHulls().every(function (h) { return HULLT[h]; })) return;
    return startStaged().then(function () {
      if (BED && BED.host) { camTransSet('in'); bedHostSay('started', function () { var me = SHIPS[PLAYER_I], c = me ? shipCenter(me) : null; return { back: 1, hdg: camTransHdg(), x: c ? c[0] : null, z: c ? c[2] : null, shipHdg: me ? (Math.atan2(Math.cos(me.yaw), Math.sin(me.yaw)) * 180 / Math.PI + 360) % 360 : null }; }); }   // started 的 x、z、shipHdg：我艦在哪、船頭朝哪（同 'left'）⇒ 地球儀上的船移過去、轉過去，跟淡進來的那艘疊在一起
    });
  }).catch(function (e) { console.error(e); });
}
function start() { stepsRun(startSteps()); }
/** 遊戲接手畫面（開戰、量測頁）⇒ 外殼收起主選單（00_events.js flow:start）。 */
function uiAway() { evEmit('flow:start'); }
/** 開戰拆成步驟：聲音、收起主選單 ⇒ 開局（resetSteps）⇒ 開跑、廣播、建造與第一人稱。照順序做 ＝ 拆之前的 start。 */
function startSteps() {
  return [function () {
    initAudio(); if (AC && AC.state === 'suspended') AC.resume();
    uiAway(); $('end').className = '';
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();   // 不然空白鍵會再按一次「開戰」
  }].concat(resetSteps(), [function () {
    RUNNING = true;
    var seenT = {}; SHIPS.forEach(function (sh) { if (!seenT[sh.T.key || sh.T.id]) { seenT[sh.T.key || sh.T.id] = 1; crewShortNote(sh); } });   // 船員站不下、換裝沒換成：每一型（每一份換裝）報一次
    if (modeRule('hint')) note(SHIPS[PLAYER_I], AUTOFIRE ? '自動開砲中（' + keyName('autoFire') + ' 關掉就自己打）' : '點敵艦設瞄準點，' + keyWord('volley') + '齊射（' + keyName('autoFire') + ' 自動開砲）');
    bldEnter();                                                        // 建造（82_build.js）：進第一人稱、顯示建造介面；別的玩法 ⇒ 收起來
    inspEnter();                                                       // 船隻觀察（86_inspect.js）：觀察面板；別的玩法 ⇒ 收起來、高亮清空
    fpKeep();                                                          // 第一人稱（81_fps.js）：玩家開著 ⇒ 重新開始、下一場都維持
    if (WX.aim) note(SHIPS[PLAYER_I], '暴風雨：浪大、風強 —— 船晃得越兇砲越散，舵也難使');
  }]);
}
// 開戰分段做（2026-10-20；?start=1 開在 Blocksail 地球儀的 iframe 裡，跟地球儀同一條主執行緒 ⇒ 開局一口氣做完時地球儀的轉場動畫卡 0.4～0.8 s）：
//   startSteps 的每一步之間讓出一次（yieldUI；makeShip 一艘拆成十幾步、同一型第一次才算的快取（繩的固定、走路格、水格、碰撞取樣）各自再拆）；很短的幾步併成一段，做得久的那一段之後用計時器讓出。分段中 FLOW_STAGE ⇒ 畫面迴圈只收塊、擺樹，不畫、不走、HUD 不動（90_main.js frame）。
//   ⛔ 不改戰局：同一串程式照同一個順序跑，中間沒有別人碰戰局（模擬不走、畫面不畫；收塊只改海圖的快取，開局讀的那幾塊開戰前就等好了 bedBoot）。
//   每一步花多久記在 FLOW_ST（__game.flow()）。主選單按「開戰」、__game.start、快轉 ⇒ 照舊一口氣做（start）。
var FLOW_STAGE = false, FLOW_ST = null, FLOW_SLICE_MS = 4, FLOW_LONG_MS = 12;
/** 做得久的一步之後用計時器讓出（排在已經到期的計時器、畫面後面；MessageChannel 一路接下去時計時器要等兩三步才輪得到）。分頁在背景（計時器被壓到一秒一次）⇒ 照舊 yieldUI。 */
function flowYieldT() { return new Promise(function (r) { setTimeout(r, 0); }); }
function startStaged() {
  var Q = startSteps().concat([flowWarmSteps]), t0 = performance.now(); FLOW_STAGE = true; FLOW_ST = { n: 0, max: 0, ms: [], all: 0, big: [] };
  return new Promise(function (ok, bad) {
    (function next(slow) {
      if (!Q.length) { FLOW_STAGE = false; FLOW_ST.all = +(performance.now() - t0).toFixed(1); ok(); return; }
      (slow && document.visibilityState === 'visible' ? flowYieldT : yieldUI)().then(function () {
        var s0 = performance.now();
        do {                                                             // 很短的步驟接著做（這一段做不到 FLOW_SLICE_MS 才接下一步）⇒ 少讓出幾次
          var f = Q.shift(), a = performance.now(), r = f(), d = performance.now() - a;
          if (r) Q = r.concat(Q);
          FLOW_ST.n++; FLOW_ST.max = Math.max(FLOW_ST.max, +d.toFixed(1)); FLOW_ST.ms.push(+d.toFixed(1)); if (DEBUG && d > 20) FLOW_ST.big.push([FLOW_ST.n - 1, +d.toFixed(1), String(f).replace(/\s+/g, ' ').slice(14, 90)]);   // ?debug=1：久的那幾步是哪一段（讀數用）
        } while (Q.length && performance.now() - s0 < FLOW_SLICE_MS);
        next(performance.now() - s0 >= FLOW_LONG_MS);
      }).catch(function (e) { FLOW_STAGE = false; bad(e); });
    })();
  });
}
/** 分段開戰的最後幾步：畫面第一格才懶建的東西先建好、一樣一步（砲門蓋板與後座 62_ports.js、環境音、背景音樂；一艘的蓋板約 0.05 s、環境音約 0.04 s）——
 *  只給人看／聽，照開局那一刻的船建（第一格之前模擬不走）⇒ 跟第一格建的一樣；建了之後第一格照常用。 */
function flowWarmSteps() {
  var out = [];
  SHIPS.forEach(function (sh) {                                          // 同 62_ports.js portsAnim 懶建的那兩行（蓋板分好幾步建）
    if (!portOn(sh) || !sh.M || sh.ports !== undefined) return;       // 「只有我艦」⇒ 只建我艦的（別艘輪到時第一格懶建）
    var R = {}; out = out.concat(portsSteps(sh, R), [function () { if (sh.ports === undefined) sh.ports = R.out; if (sh.recoil === undefined) sh.recoil = recoilBuild(sh); }]);
  });
  if (AC) out.push(function () { ambNoise(AC, 'white'); }, function () { ambNoise(AC, 'pink'); }, function () { ambNoise(AC, 'brown'); });   // 環境音的三種噪音（02_ambient.js），再建環境音
  if (AC) out.push(function () { bgmRevBuf(AC); }, function () { bgmRevBuf(AC); });   // 背景音樂的殘響（02_music.js）：兩個聲道各一步，再建卷積
  return out.concat([function () { ambFrame(); }, function () { bgmWarm(); }, function () { bgmFrame(); }]);
}
