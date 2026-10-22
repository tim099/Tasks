/* 憲法號對轟 —— 遊戲本體（體素的解碼、網格、算繪、射線、連通在 VoxelKit）。
 * 世界：公尺、Y 朝上、海面 y = 0。船的格座標 (x 船長、y 船寬、z 高) ⇒ 船體座標 (x, z, −y)（行列式 +1，繞序不翻）。
 * 同一型的兩艘共用一份 1:1 資料（船型 sh.T，05_hull.js），被打到的區塊才各自複製（VoxelKit.Grid.share）。
 * 模擬固定步長 1/60 秒、亂數有種子 ⇒ ?demo=<秒>&seed=<n> 每次快轉出同一格（縮圖與驗收用）。
 *
 * 拆檔：js/ 底下照功能分檔，檔名前面的數字就是順序。template.html 照這個順序列出（每檔一個帶 data-bundle="game" 的 script 標籤），
 *   vxk_inline.py 把同一個 bundle 接成一段、包進同一個閉包（(function () { 'use strict'; … })()）⇒ 各檔共用變數與函式，
 *   跟沒拆之前是同一個作用域；不會掛到 window、不會跟瀏覽器的全域名字撞。
 *   ⛔ 各檔沒有自己的作用域：新的頂層名字先搜一遍有沒有撞名（以前 IIFE 裡也撞過：船員的 kill 蓋掉碎屑的 kill）。
 *   ⛔ 頂層的敘述照檔案順序執行：要在載入時就跑的（讀網址、建 GL）放在用到它的檔之前。
 */
var VK = window.VoxelKit, M4 = VK.M4;
var Q = new URLSearchParams(location.search);
var DEMO = Q.has('demo') ? Math.max(0, parseFloat(Q.get('demo')) || 0) : -1;
var STILL = Q.get('still') === '1', DEBUG = Q.get('debug') === '1';
var LAB_FLEET = Q.get('lab') === 'fleet';                              // 擬真沙盒（84_fleetlab.js；根目錄 fleetlab.html 轉過來）：遊戲本體的模擬、只畫俯視圖
var SEED = (parseInt(Q.get('seed'), 10) >>> 0) || 1797;
var CAMQ = Q.get('cam') || '';
// 逐幀分段計時（?debug=1 才有；TASK-0531 找卡頓）：每一格畫面各段花幾 ms（模擬每一步的各段累加），留最近 PF.max 格；__game.frames() 讀最慢的幾格。
//   pfLap(k)：從上一個 lap（或這一段的起點 PF.t）到現在的時間記到 k。沒開 debug ⇒ PF ＝ null，呼叫端一個判斷就跳過。
var PF = DEBUG ? { t: 0, cur: {}, ring: [], max: 1200 } : null;
function pfLap(k) { var t = performance.now(); PF.cur[k] = (PF.cur[k] || 0) + t - PF.t; PF.t = t; }
function pfEnd(f0, steps) { var c = PF.cur; c.total = performance.now() - f0; c.steps = steps; c.simt = SIMT; PF.ring.push(c); if (PF.ring.length > PF.max) PF.ring.shift(); PF.cur = {}; }
if (STILL) document.getElementById('stage').classList.add('still');
function $(id) { return document.getElementById(id); }

// ───────────────────────── 亂數工廠（有種子；TASK-0671） ─────────────────────────
// 每一條亂數一個名字（RNG[名字]）、同一個演算法（mulberry32）；開局 rngReset() 一起重設（70_flow.js reset）：種子 ＝ SEED ^ salt（fixed ⇒ 就是 salt，不跟著 SEED）。
// 為什麼分好幾條：只給人看的（煙、水花、雨、布片…）少抽幾次不能動到戰局那一條（10-15 rndF 撞名、TASK-0669 煙吃戰局的亂數）。
// 新加一條 ⇒ 在自己的檔 rngMake 一個名字（重名 ⇒ 載入就丟錯），⛔ 不要再複製一份演算法。
// R.s ＝ 狀態（整數；要暫時換一條流的 —— 33_flood.js floodVis —— 直接存、換、還原它）；R.f() ＝ [0, 1)、R.r(a, b)、R.g() ＝ 常態分佈。
var RNG = {};
function rngMake(name, salt, fixed) {
  if (RNG[name]) throw new Error('亂數重名：' + name);
  var R = { name: name, salt: salt, fixed: !!fixed, s: 0 };
  R.seed = function () { R.s = R.fixed ? R.salt : SEED ^ R.salt; };
  R.f = function () { var s = R.s | 0; s = s + 0x6D2B79F5 | 0; R.s = s; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  R.r = function (a, b) { return a + (b - a) * R.f(); };
  R.g = function () { var u = R.f() || 1e-9, v = R.f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.2831853 * v); };
  R.seed(); RNG[name] = R; return R;
}
function rngReset() { for (var k in RNG) RNG[k].seed(); }
var RNG_B = rngMake('battle', 0), rnd = RNG_B.f, rr = RNG_B.r, gauss = RNG_B.g;   // 戰局（電腦、命中、傷亡…）
// 碎木自己的亂數（轉軸、落水、落地；12_effects.js 的碎木、24_armor.js 的裝甲碎片共用 —— TASK-0669 從 12_effects.js 搬來）：⛔ 跟戰局共用 rnd() ⇒ 少生一顆碎木（物理分級），後面的亂數全部錯位、整局都變（09_phx.js）。開局一起重設（rngReset）
var RNG_D = rngMake('debris', 0x2545F491), rndD = RNG_D.f, rD = RNG_D.r;   // 碎木自己的亂數（⛔ 不用 rr：那是戰局的 rnd()）
function hash3(x, y, z) { var h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1103515245); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
// 累加迴圈的防呆（Tim 2026-10-15：「累加迴圈 & 其他類似邏輯是否可以加防呆（要有上限）」）：「累加到 1 就生一個」那種迴圈一次最多 ACC_CAP 次；
//   之後累加值還 ≥ 1 或壞掉（NaN／無窮大）⇒ 歸零、主控台警告（同一個地方前 3 次）。沒超過上限 ⇒ 跟以前一模一樣（同樣的次數、同樣的減法）。
//   ⛔ 以前：除錯時把船一步搬 450 m ⇒ 水花的累加值上億、while 一直生 ⇒ 分頁卡死；位置變成無窮大 ⇒ 永遠出不來。
var ACC_CAP = 256, ACC_OVER = {};
function accFix(o, k, unit, tag) {
  if (o[k] < (unit || 1)) return;
  ACC_OVER[tag] = (ACC_OVER[tag] || 0) + 1; if (ACC_OVER[tag] <= 3) console.warn('累加超過上限（' + tag + '）：' + o[k] + ' ⇒ 歸零');
  o[k] = 0;
}

// ───────────────────────── 常數 ─────────────────────────
// 同時在場最多幾艘船（TASK-0537；Tim 2026-10-13：上限 4 ⇒ 8）—— 設定後台調（TASK-0542：config/game.json 的 limits）。
// 船艙遮罩（與透視）只給「視野裡離鏡頭最近的 MASK_NEAR 艘」（Tim 2026-10-13「優先選最近的 N 條船」「只選視野範圍內最近的」；60_render.js gpuSlots）；其他的沒有（遠處看不到艙裡）。
// 陰影不分船（2026-10-20 起照鏡頭分段，60_render.js shadowPass）⇒ 船數不影響陰影。
// 陰影圖、船艙遮罩都是貼圖陣列（各佔一個單元：陰影第 4 號、遮罩第 1 號）⇒ 船數不受貼圖單元限制。
// FLEET_MAX：編成最多幾艘（主選單；Tim 2026-10-13「編成可以設高一點」）—— 同時在場的最多 FIELD_N 艘（主選單滑桿 2～MAX_SHIPS），其他的候補（52_fleet.js）。
var MAX_SHIPS = CFG.limits.maxShips, MASK_NEAR = CFG.limits.maskNear, FLEET_MAX = CFG.limits.fleetMax;   // 預設 8／4／40
/** 每 sec 秒一次 ＝ 每幾步（照現在的步長 DT；擬真沙盒可以把物理降到 30／20／15／10 Hz）。60 Hz 時 ＝ 以前寫死的步數（3 秒 180、半秒 30）。 */
function everySteps(sec) { return Math.max(1, Math.round(sec / DT)); }
var DT = 1 / 60, G = 9.81, V0 = 175, ZW0 = 63;    // ZW0：沒有 meta 時的設計水線（憲法號吃水 63 格，basecamp 的下水段同一個數）；每種船的在 T.zw
// ── 模擬步長可調（TASK-0797／0798／0805）：DT 照物理設定「模擬步長」開戰時決定（70_flow.js），擬真沙盒照沙盒的 Hz ──
// 以前很多地方照 60 Hz 寫：「幾步一次」、「每一步乘 k 的衰減」。DT60 ＝ 那個基準；下面三支把它換到現在的步長。
// 三支在 DT ＝ 1/60 時都回原數（不做任何浮點運算）⇒ 60 Hz 跟改之前逐位元相同。
var DT60 = 1 / 60;
/** 照 60 Hz 寫的「n 步一次」換成現在步長的步數（30 Hz ⇒ 一半，最少 1）。 */
function stepsAt(n, dt) { return dt === DT60 ? n : Math.max(1, Math.round(n * DT60 / dt)); }   // 60 Hz 的 n 步換成一步 dt 秒的步數（帆與繩照畫面格算時 dt ＝ 一格，TASK-0799）
function steps60(n) { return stepsAt(n, DT); }
/** 照 60 Hz 寫的「每一步乘 k」換成走 dt 秒的倍率（k^(dt × 60)）。 */
function decay60(k, dt) { return dt === DT60 ? k : Math.pow(k, dt / DT60); }
/** 每一小步的位移上限（TASK-0797；Tim 2026-10-21：「無視模擬步時長 限制每步上限位移」）：走 dt 秒、這一步要移動 dist ⇒ 切成幾小步，
 *  每一小步最多 cap（單位照呼叫端：公尺或格）；但不切得比 60 Hz 一步更細 ⇒ 1/60 秒一步時永遠 1（跟以前逐位元相同、不多花），
 *  步長變大時最多切回 60 Hz 的步數 ⇒ 穿透不會比 60 Hz 更容易、花費不會比 60 Hz 更多。 */
var SUBSTEP_OFF = DEBUG && Q.get('nosub') === '1';                     // 反向對照（?debug=1&nosub=1）：位移上限關掉 ⇒ 步長大的時候照樣一步走完
function subSteps(dist, cap, dt, fine) {
  if (SUBSTEP_OFF || !(dt > DT60 * 1.000001)) return 1;
  var n = Math.ceil(dist / cap - 1e-9);
  return Math.max(1, fine ? Math.min(n, 64) : Math.min(Math.ceil(dt / DT60 - 1e-6), n));   // fine：數量少、算得便宜的（掉落物、碎塊）⇒ 真的照上限切（最多 64 段）；⛔ 照 60 Hz 封頂 ⇒ 一格厚的甲板照樣穿（10 Hz、15 m/s 量到的）
}
var RELOAD = 7, RELOAD_SANDBOX = 1.6;
var AMMO = ['實心彈', '爆裂彈', '鏈彈'];
var S;                                            // 公尺／格（封裝檔的 header；每種船都要一樣）。中線、外框、水線…每種船各一份：sh.T（05_hull.js）
var SUN = norm([-0.45, 0.62, -0.38]), SKY = [0.42, 0.58, 0.80], HORIZON = [0.80, 0.80, 0.77], GROUND = [0.30, 0.27, 0.22];
var WIND = [0.6, 0, 1.65];   // 風往哪吹（m/s，煙飄的速度）；方向也是航行的風向：開局兩艘的航向跟它大致垂直（橫風起跑）

function norm(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function lerp3(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }   // TASK-0669 從 03_camera.js 搬來（繩也用）
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function mul(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function len(a) { return Math.hypot(a[0], a[1], a[2]); }
function rotM(axis, ang) {          // 繞任意軸的 mat4
  var a = norm(axis), c = Math.cos(ang), s = Math.sin(ang), t = 1 - c, x = a[0], y = a[1], z = a[2];
  return new Float32Array([t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0, t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0, 0, 0, 0, 1]);
}
function trans(x, y, z) { var m = M4.ident(); m[12] = x; m[13] = y; m[14] = z; return m; }
// 設定的描述表（{ k, name, lim, step, int, note }）共用的三支（TASK-0774：從 64_cfgkit.js 搬來 —— 畫質、天氣、砲、道具的資料那半都用，屬於核心；設定頁的框架留在 64_cfgkit.js）
/** 描述表的一項 ⇒ 值夾進範圍、對齊刻度（整數取整）；lim 可以傳進來（砲的傷害範圍照砲種）。不是有限的數字 ⇒ undefined。 */
function cfgSnap(it, v, lim) {
  if (typeof v !== 'number' || !isFinite(v)) return undefined;
  var L = lim || it.lim; v = clamp(v, L[0], L[1]);
  return it.int ? Math.round(v) : +(Math.round(v / it.step) * it.step).toFixed(4);
}
/** 描述表 ⇒ 滑桿的 HTML：每一項一列（label、range、數字）＋說明；pre ＝ 元素前綴（gk-、fk-）；wrap(it, html) 可以再包一層（道具頁要照種類藏）。 */
function cfgSliders(items, pre, wrap) {
  return items.map(function (it) {
    var h = '<div class="row slide"><label for="' + pre + it.k + '">' + it.name + '</label><input type="range" id="' + pre + it.k + '"' + (it.lim ? ' min="' + it.lim[0] + '" max="' + it.lim[1] + '"' : '') + ' step="' + it.step + '" aria-label="' + it.name + '"><span id="' + pre + it.k + 'V"></span></div>' +
      '<div class="row note gkn">' + it.note + '</div>';
    return wrap ? wrap(it, h) : h;
  }).join('');
}
/** 值 ⇒ 字（跟預設不一樣 ⇒ 後面寫「改過；預設 …」）。 */
function cfgShown(fmt, v, d) { return fmt(v) + (v === d ? '' : '（改過；預設 ' + fmt(d) + '）'); }
