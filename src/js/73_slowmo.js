// ───────────────────────── 殉爆的慢動作與特寫（TASK-0531） ─────────────────────────
// Tim 2026-10-13：卡頓先優化掉（開戰第一輪對砲：21_gunnery.js stepBall）；減速只留給殉爆，可以開關；慢多少是動態的（大的殉爆慢很多）。
// 慢動作：模擬照舊一步 1/60 秒（DT），只是每一格畫面累積的時間 ×SLOW.ts（90_main.js frame）⇒ 模擬時間對真實時間變慢。
//   ⇒ 開或關同一個種子走出同一局（只差在哪一格畫面走那一步）；?demo、__game.run 不經過 frame ⇒ 不受影響。
//   倍率：殉爆那一刻掉到 tsMin（照爆炸半徑：前彈藥庫 9.5 m ⇒ 0.1×、後彈藥庫 5.5 m ⇒ 約 0.26×），停 hold 秒（真實時間，大的停久一點：前 5 秒、後 3.7 秒），再 SLOW_EASE 秒平滑回到 1×。
//   Tim 2026-10-13：慢動作時間可以延長 ⇒ 停 1–2.5 → 2–5 秒、回到 1× 2.5 → 3.5 秒。
//   兩間接連炸 ⇒ 取比較慢的那個、從頭算。
//   慢動作中，只給人看的（碎木、煙與水花、船邊水花：12_effects.js、13_water.js）改成每一格畫面照「畫面的 dt × 倍率」走（SLOW_VIS；step() 那邊跳過）
//   ⇒ 火球、碎片照樣平順（⛔ 留在 step() ⇒ 0.1× 時十格才動一下）。它們不回寫模擬 ⇒ 戰局不變。
// 特寫：殉爆那一刻鏡頭切到爆心的側面（自由鏡頭、不跟船），慢動作回到 1× 再過 SLOW_CAM_TAIL 秒，回到原本的鏡頭；中間按了換鏡頭（C）⇒ 不再切回去（只把跟船還成特寫之前的，slowCamDrop）。
// 設定：遊戲內設定面板的「殉爆慢動作」「殉爆特寫」（跟著存檔；網址 ?slowmo=0、?slowcam=0）。狀態 SLOW 在 04_state.js（存檔在 69_prefs.js 載入時就讀）。
var SLOW_EASE = 3.5, SLOW_CAM_TAIL = 0.8;
/** 殉爆（23_powder.js magBoom）：w ＝ 爆心（世界）、R ＝ 爆炸半徑（格）。快轉（?demo）不切。 */
function slowOnBlast(sh, w, R) {
  if (DEMO >= 0 || !RUNNING) return;
  var k = clamp(R / MAG_R, 0, 1.3);
  SLOW.kicks++;
  if (SLOW.on) {
    var m = clamp(0.1 + (1 - k) * 0.37, 0.1, 0.5), h = 2 + 3 * Math.min(k, 1);
    if (!SLOW.active || m < SLOW.ts) { SLOW.min = m; SLOW.hold = h; SLOW.t = 0; SLOW.active = true; SLOW.ts = m; }
  }
  if (SLOW.cam) {
    if (!SLOW.camSave) SLOW.camSave = { mode: CAM.mode, tgt: CAM.tgt.slice(), dist: CAM.dist, yaw: CAM.yaw, pitch: CAM.pitch, track: CAM.track };
    var F = M4.dir(sh.M, 1, 0, 0), side = norm([-F[2], 0, F[0]]), e = CAM.eye;          // 船的正橫；站在鏡頭本來那一側
    if ((e[0] - w[0]) * side[0] + (e[2] - w[2]) * side[2] < 0) side = mul(side, -1);
    var yw = Math.atan2(side[2], side[0]) + 0.35;                                         // 偏一點船頭的方向 ⇒ 看得到斷開的兩截
    camSet({ mode: 0, track: false, tgt: [w[0], w[1] + R * S * 0.4, w[2]], dist: clamp(R * S * 5.2, 28, 70), yaw: yw, pitch: 0.2, snap: true });
    SLOW.camT = SLOW.hold + SLOW_EASE + SLOW_CAM_TAIL; SLOW.camMode = 0;
  }
}
/** 特寫提早結束（中間換了鏡頭、70_flow.js 重開）：鏡頭照玩家現在的，只把「跟船」還成特寫之前的。
 *  ⛔ 只丟掉存檔（Tim 2026-10-20「目前看我艦 有時候鏡頭不會跟著轉(偶發)」）：特寫關掉的跟船就一直關著 —— 換回看我艦、下一局也一樣，
 *     🎥 那一顆還亮著，只有按兩下 V 才回來。 */
function slowCamDrop() {
  if (!SLOW.camSave) return;
  var tr = SLOW.camSave.track; SLOW.camSave = null;
  camSet({ track: tr, trYaw: null, trMe: null });
}
/** 每一格畫面（90_main.js frame，停格時不走）：照真實時間算現在的倍率；特寫時間到了把鏡頭還回去。回：倍率。 */
function slowTick(dt) {
  if (SLOW.active) {
    SLOW.t += dt;
    var u = (SLOW.t - SLOW.hold) / SLOW_EASE;
    if (u >= 1 || !SLOW.on) { SLOW.active = false; SLOW.ts = 1; }
    else SLOW.ts = u <= 0 ? SLOW.min : SLOW.min + (1 - SLOW.min) * u * u * (3 - 2 * u);
  }
  if (SLOW.camSave) {
    SLOW.camT -= dt;
    if (CAM.mode !== SLOW.camMode) slowCamDrop();                                         // 中間換過鏡頭 ⇒ 照玩家的（跟船照特寫之前的）
    else if (SLOW.camT <= 0 || !SLOW.cam) {
      var s = SLOW.camSave; SLOW.camSave = null;
      camSet({ mode: s.mode, tgt: s.tgt, dist: s.dist, yaw: s.yaw, pitch: s.pitch, track: s.track });
    }
  }
  return SLOW.ts;
}
// ── 物理減速（Tim 2026-10-14：物理計算量超過一定時降低模擬速度 —— 慢動作，參考殉爆；可以開關、預設關）──
// 每一格畫面量 step() 平均一步幾毫秒（PSLOW.ms，指數平均）；1× 要每秒 60 步 ⇒ 模擬佔真實時間的比例 L ＝ ms × 60 ÷ 1000。
//   L 超過門檻 PSLOW.budget（物理設定頁的滑桿，預設 0.5：至少留一半給畫面）⇒ 倍率 ＝ 門檻 ÷ L（最低 PSLOW_MIN）；往下立刻跟（開戰第一輪、殉爆挖彈坑那種尖峰），往上 PSLOW_UP 秒才回到 1×（不忽快忽慢）。
//   跟殉爆慢動作取比較慢的；一樣只改「每格畫面走幾步」⇒ 開或關同一個種子走出同一局；只給人看的照畫面的時間走（slowVisStep）。?demo、__game.run 不經過 frame ⇒ 不受影響。
// 開關：遊戲內設定面板與主選單的物理設定頁；門檻：物理設定頁的滑桿（config lim.pslowb）。都跟著存檔；網址 ?pslow=1、?pslowb=0.4。
//   量過（8 艘 4 對 4、門檻 0.5）：一步 12–24 ms ⇒ L 0.75–1.44 ⇒ 0.33–0.66×。
var PSLOW_MIN = 0.2, PSLOW_UP = 1.5;
function pslowMeasure(ms) { PSLOW.ms = PSLOW.ms ? PSLOW.ms * 0.85 + ms * 0.15 : ms; }
/** 每一格畫面：照量到的一步幾毫秒算這一格的倍率（關 ⇒ 1）。 */
function pslowTick(dt) {
  if (!PSLOW.on) { PSLOW.ts = 1; return 1; }
  var L = PSLOW.ms * 60 / 1000, want = L > PSLOW.budget ? Math.max(PSLOW_MIN, PSLOW.budget / L) : 1;
  PSLOW.ts = want < PSLOW.ts ? want : Math.min(want, PSLOW.ts + dt / PSLOW_UP);
  return PSLOW.ts;
}
function pslowToggle() { PSLOW.on = !PSLOW.on; if (!PSLOW.on) PSLOW.ts = 1; gsetShow(); evEmit('pslow'); }   // 物理設定頁跟著亮（外殼）
/** 慢動作中，只給人看的效果照畫面的時間走（step() 那邊跳過）。 */
function slowVisStep(dt) { stepDebris(dt); stepPts(dt); stepWater(dt, 'fly'); }
/** 慢動作的提示（畫面中間）：倍率 < 0.98 才顯示。物理減速的提示在羅盤上方的航速那一行（61_hud.js；Tim 2026-10-15）。 */
function slowShow() {
  var el = $('slowB'); if (!el) return;
  var on = RUNNING && SLOW.active && SLOW.ts < 0.98;                 // 殉爆的慢動作
  el.classList.toggle('on', on); if (on) el.textContent = '慢動作 ×' + SLOW.ts.toFixed(2);
}
$('slowT').onclick = function () { SLOW.on = !SLOW.on; if (!SLOW.on) { SLOW.active = false; SLOW.ts = 1; } gsetShow(); };
$('slowCamT').onclick = function () { SLOW.cam = !SLOW.cam; gsetShow(); };
$('pslowT').onclick = pslowToggle;
// 模擬速度的滑桿（設定 O）：對數刻度 10^(值／1000) ⇒ 0.05–8 倍、中間 0 ＝ 1 倍；1× 回到正常。0 倍 ＝ 暫停（P），所以最低 0.05（Tim）。
function simSpeedSet(x) {
  SIM_SPEED = clamp(x, SIM_SPEED_MIN, SIM_SPEED_MAX); if (Math.abs(SIM_SPEED - 1) < 0.02) SIM_SPEED = 1;
  $('simSpd').value = Math.round(Math.log10(SIM_SPEED) * 1000); $('simSpdV').textContent = '×' + (SIM_SPEED < 1 ? SIM_SPEED.toFixed(2) : SIM_SPEED.toFixed(SIM_SPEED < 10 ? 1 : 0));
  $('simSpd1').classList.toggle('on', SIM_SPEED === 1);
}
$('simSpd').oninput = function () { simSpeedSet(Math.pow(10, +$('simSpd').value / 1000)); };
$('simSpd1').onclick = function () { simSpeedSet(1); };
simSpeedSet(1);
// 訂閱（TASK-0669：模擬層只發事件，00_events.js）
evOn('blast', slowOnBlast, 0, true);
