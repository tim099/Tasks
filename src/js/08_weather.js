// ───────────────────────── 天氣（TASK-0523） ─────────────────────────
// 主選單「天氣」：晴（預設）／暴風雨；網址 ?weather=storm。開戰前選、整場不變。
// 進戰局的（物理）：浪（seaH 再乘 sea）、風（煙飄的速度與帆上的風再乘 wind）、航速（乘 speed）、操舵（最大轉向率乘 agile）、
//   開砲的散布（aim：照船搖晃的角速度放大，wxSpread）。
// 只在畫面的：天色（SKY／HORIZON／GROUND）、霧（fog）、陽光（sun：直射光的強度）、水手與碎木的亮度（lum）、浪頭的白沫（foam）、
//   雨（rain，大小再看畫質設定的「雨」）、閃電（bolt：照模擬時間的雜湊挑時刻，不抽亂數；打雷的聲音照距離延後）。
// ⛔ 晴天的每一個係數都是 1（或 0 且有分支擋著）⇒ 跟加天氣之前逐位元組相同：同一個種子的戰局、縮圖都一樣（反向對照）。
//   新的效果一律寫成「晴天剛好是 1 的乘數」，⛔ 不要另外抽 rnd()（會讓晴天的亂數錯位）。
var WEATHERS = {
  clear: { name: '晴', sea: 1, wind: 1, speed: 1, agile: 1, aim: 0, sky: SKY, horizon: HORIZON, ground: GROUND, fog: 0.0016, sun: 1, lum: 1, foam: 0, rain: 0, bolt: 0 },
  storm: { name: '暴風雨', sea: 2.5, wind: 2.2, speed: 1.15, agile: 0.8, aim: 1,
    sky: [0.25, 0.28, 0.32], horizon: [0.34, 0.36, 0.38], ground: [0.13, 0.13, 0.12], fog: 0.0042, sun: 0.3, lum: 0.62, foam: 1, rain: 1, bolt: 1 } };
// 風會變（Tim 2026-10-13：風速、風向在遊戲中變動，照天氣；暴風雨變得快、風速高）：
//   風向 ＝ 開局的風向 ＋ dir ×（三道正弦，權重 0.6／0.3／0.1、週期 per）；風速倍率 WIND_SPD ＝ 1 ＋ spd ×（另外三道，週期再 ×0.73）。
//   每道都寫成 sin(ωt＋φ) − sin φ ⇒ 開局那一刻 ＝ 原本的風；相位照種子的雜湊（不抽亂數）⇒ 同一個種子同一陣風。
//   晴：週期 233／97／41 秒，風向最多偏約 23°、風速 ±30%；暴風雨：71／29／11 秒，風向最多約 70°、風速 0.4–1.6 倍（再乘 wind 2.2）。
//   WIND（00_core.js）每一步就地改：方向給航行（風向係數、頂風失速）、帆、羅盤；長度 ＝ 開局的長度 × WIND_SPD（煙飄的速度）。
//   航速 ∝ √WIND_SPD（31_sailing.js）、帆上的風 × WIND_SPD（30_rig_physics.js）。浪的方向不跟：湧浪是開局那陣風吹出來的（08_sea.js 建一次）。
WEATHERS.clear.gusts = { dir: 0.2, spd: 0.15, per: [233, 97, 41] };
WEATHERS.storm.gusts = { dir: 0.6, spd: 0.3, per: [71, 29, 11] };
// 大漩渦（TASK-0683；Tim 2026-10-17：「暴風雨+海中央大漩渦(在敵我中間)」）：暴風雨的每一格照抄，再加 vortex（08_sea.js vxInit 讀）——
//   r 水流最快那一圈的半徑（m）、depth 中間多深（m）、width 漏斗寬窄（幾倍的 r）、v 水流最快（節）、inflow 往中心吸（切向的幾成）、eye 眼的半徑（m）、pull 眼把船往下拖（m/秒，0 ＝ 不拖）。
//   預設（Tim 2026-10-17「半徑再放大2倍 然後更深一點 水流快一些」）：r 95 → 190、depth 28 → 75、v 6.8 → 10 節、eye 21 → 42；可以在天氣設定頁改（下面 WXK_ITEMS）。
//   再一次（Tim：「漩渦半徑預設值可以改400(上限改1000) 深度預設150 上限300」「起始可以在漩渦中」）：r 190 → 400、depth 75 → 150；start 開局離中心（m）130 —— 兩隊在漏斗裡面開打，不在水流最快那一圈。
WEATHERS.maelstrom = Object.assign({}, WEATHERS.storm, { name: '大漩渦', vortex: { r: 400, depth: 250, width: 0.6, v: 10, inflow: 0.2, eye: 42, eyeDepth: 100, pull: 0.4, gulp: 4, hold: 1.5, eyeSuck: 5, grav: 0.1, suck: 0.1, suckR: 90, suckP: 2, spin: 40, turn: 1, aiR: 80 } });
//   再一次（Tim：「兩船起始距離是否可以根據實際距離」「300比起非漩渦 近了很多」「深度預設250吧(上限可以改400)」「下坡加速跟吸力 預設0.1」）：
//   開局距離跟主選單的「距離」走（52_fleet.js vxPlace；拿掉「開局位置」start）、depth 150 → 250（上限 400）、grav／suck 0.05 → 0.1。
// 天氣設定頁（Tim 2026-10-17：「或是開一個天氣設定頁(參考船隻設定) 可以設定不同天氣參數(大漩渦半徑 轉速 深度等放裡面)」）：
//   描述表照 64_cfgkit.js cfgPage（71_input.js 生頁、69_prefs.js 存 wxk：只存跟預設不一樣的）。get／set 直接讀寫 WEATHERS 那一格（of：哪幾種天氣、key：哪一欄）。
//   暴風雨的浪、風同時改暴風雨與大漩渦（大漩渦照抄暴風雨）；晴天不在這一頁（晴天 ＝ 1 倍，對拍的基準）。⛔ 對拍（?demo、?prefs=0）不讀存檔 ⇒ 照預設。
var WXK_ITEMS = [
  { k: 'sea', of: ['storm', 'maelstrom'], name: '暴風雨的浪', lim: [1, 5], step: 0.1, fix: 1, unit: ' 倍', note: '暴風雨與大漩渦的浪高（晴天 ＝ 1 倍）' },
  { k: 'wind', of: ['storm', 'maelstrom'], name: '暴風雨的風', lim: [1, 4], step: 0.1, fix: 1, unit: ' 倍', note: '帆上的風、煙飄的速度（晴天 ＝ 1 倍）' },
  { k: 'r', of: ['maelstrom'], vx: 1, name: '漩渦半徑', lim: [60, 1000], step: 10, int: true, unit: ' m', note: '水流最快的那一圈（漏斗的大小跟著它）' },
  { k: 'depth', of: ['maelstrom'], vx: 1, name: '漩渦深度', lim: [5, 400], step: 5, int: true, unit: ' m', note: '中心比海面低多少（不算眼的喉部）' },
  { k: 'width', of: ['maelstrom'], vx: 1, name: '漏斗寬窄', lim: [0.3, 1.2], step: 0.05, fix: 2, unit: ' 倍半徑', note: '越小越陡（中間尖）、越大越平（像碗）' },
  { k: 'v', of: ['maelstrom'], vx: 1, name: '漩渦水流', lim: [1, 25], step: 0.5, fix: 1, unit: ' 節', note: '在那一圈最快；往外照距離淡掉（船自己的航速另外加）' },
  { k: 'grav', of: ['maelstrom'], vx: 1, name: '下坡加速', lim: [0, 0.3], step: 0.01, fix: 2, unit: '', note: '順著漏斗壁往下開變快、往上開變慢（重力沿著船頭的那一份 × 這個；0 ＝ 沒有）' },
  { k: 'spin', of: ['maelstrom'], vx: 1, name: '眼裡自旋', lim: [0, 180], step: 5, int: true, unit: ' 度/秒', note: '被吸到眼裡的船跟著漩渦自己打轉（眼的邊上開始、一半以內全速；舵抵不掉；0 ＝ 不轉）；往下拖照「眼往下拖」' },
  { k: 'suck', of: ['maelstrom'], vx: 1, name: '漩渦吸力', lim: [0, 0.3], step: 0.01, fix: 2, unit: '', note: '把船往中心拉：中心最強，往外照「吸力範圍」「吸力曲線」淡掉（水的阻力讓它不會一直變快；0 ＝ 沒有）' },
  { k: 'turn', of: ['maelstrom'], vx: 1, name: '繞行轉向', lim: [0, 2], step: 0.1, fix: 1, unit: '', note: '船頭跟著漩渦往內轉、繞著走（1 ＝ 不打舵剛好沿著那一圈繞；0 ＝ 照慣性直走、往外偏）' },
  { k: 'suckR', of: ['maelstrom'], vx: 1, name: '吸力範圍', lim: [10, 800], step: 10, int: true, unit: ' m', note: '離中心這麼遠時吸力剩一半（越小越集中在中心）' },
  { k: 'suckP', of: ['maelstrom'], vx: 1, name: '吸力曲線', lim: [0.5, 6], step: 0.5, fix: 1, unit: '', note: '往外淡掉得多快：越大外圈掉得越乾脆、越小外圈留得越多（2 ＝ 一般）' },
  { k: 'inflow', of: ['maelstrom'], vx: 1, name: '往中心吸', lim: [0, 0.6], step: 0.05, fix: 2, unit: '', note: '切向水流的幾成往中心（0 ＝ 只繞不吸）' },
  { k: 'eye', of: ['maelstrom'], vx: 1, name: '眼的半徑', lim: [5, 150], step: 1, int: true, unit: ' m', note: '船進到這個半徑以內就被往下拖（最多半徑的 0.8）' },
  { k: 'eyeSuck', of: ['maelstrom'], vx: 1, name: '眼的吸力', lim: [0, 15], step: 0.5, fix: 1, unit: ' m/s', note: '眼裡另外一股直接往中心的水流（眼的邊上開始、四分之一深處全力；船、碎片、落水的人都吃；0 ＝ 沒有）' },
  { k: 'hold', of: ['maelstrom'], vx: 1, name: '眼的束縛', lim: [0, 5], step: 0.1, fix: 1, unit: ' /秒', note: '眼裡船速每秒被水吃掉的比例（眼的邊上開始、一半以內全力；越大越難衝過去；0 ＝ 沒有，高速可以穿過眼）' },
  { k: 'gulp', of: ['maelstrom'], vx: 1, name: '眼吞沉船', lim: [0, 20], step: 0.5, fix: 1, unit: ' m/s²', note: '進水開始沉的船在眼裡往下吸的加速度（4 ⇒ 約 4 秒沉到看不見；0 ＝ 照一般沉船，要半分鐘）；被眼拖下去的照「眼往下拖」，沉沒之後才照這個' },
  { k: 'eyeDepth', of: ['maelstrom'], vx: 1, name: '眼的深度', lim: [0, 200], step: 5, int: true, unit: ' m', note: '眼那一段喉部再往下多深（中心總深 ＝ 深度 ＋ 這個；0 ＝ 沒有喉部）' },
  { k: 'pull', of: ['maelstrom'], vx: 1, name: '眼往下拖', lim: [0, 1], step: 0.01, fix: 2, unit: ' m/秒', note: '0 ＝ 不拖（只繞、不會沉）；一進眼每秒往下這麼多，越深拖得越快（每深 2 m 多一倍）；先進眼那一頭先被拉下去、另一頭留在水面；整艘進到水裡才算沉沒（預設約 7 秒）；出了眼每秒浮回 0.1 m' },
  { k: 'aiR', of: ['maelstrom'], vx: 1, name: '電腦避開半徑', lim: [0, 600], step: 5, int: true, unit: ' m', note: '電腦的船照現在的速度再開 8 秒會進到這一圈以內 ⇒ 往外開，開到 1.3 倍才回去打（0 ＝ 不避，只有快沉了才逃）' }];
function wxkObj(it, w) { return it.vx ? WEATHERS[w].vortex : WEATHERS[w]; }   // vx：大漩渦那一格（vortex）裡的欄位
function wxkGet(k) { var it = wxkItem(k); return wxkObj(it, it.of[0])[k]; }
function wxkSet(k, v) { var it = wxkItem(k); if (v === undefined) return; it.of.forEach(function (w) { wxkObj(it, w)[k] = v; }); vxInit(); }   // 主選單的背景（大漩渦）跟著變
function wxkItem(k) { return WXK_ITEMS.filter(function (it) { return it.k === k; })[0]; }
var WXK_DEF = {}; WXK_ITEMS.forEach(function (it) { WXK_DEF[it.k] = wxkGet(it.k); });
function wxkDef(k) { return WXK_DEF[k]; }
function wxkReset() { WXK_ITEMS.forEach(function (it) { wxkSet(it.k, WXK_DEF[it.k]); }); }
/** 存檔（69_prefs.js wxk）：跟預設不一樣的那幾項；讀的時候照描述表夾進範圍（cfgSnap）。 */
function wxkSnap() { var o = {}; WXK_ITEMS.forEach(function (it) { var v = wxkGet(it.k); if (v !== WXK_DEF[it.k]) o[it.k] = v; }); return o; }
function wxkApply(o) { WXK_ITEMS.forEach(function (it) { var v = cfgSnap(it, o[it.k]); if (v !== undefined) wxkSet(it.k, v); }); }
/** 改過幾項（主選單那顆鈕寫「改過」）。 */
function wxkChanged() { return Object.keys(wxkSnap()).length; }
// 開局的風（Tim 2026-10-14：起始風向、風速也要隨機）：每一場開局（70_flow.js reset）挑一次 —— 風向相對 WIND0 轉 WIND_ROT（0–360°）、風速倍率 WIND_S0（0.6–1.5；航速 ∝ √）。
//   帶 ?seed 或 ?demo（對拍、縮圖）⇒ 照種子的雜湊、同一個種子同一陣風；一般開戰 ⇒ Math.random()，每一場不同。兩種都不抽 rnd()（戰局的亂數順序不動）。
//   ?wdir=度（相對 WIND0，往 +z 轉為正）、?wspd=倍率 ⇒ 指定（?wdir=0&wspd=1 ＝ 以前固定的那陣風）。浪跟著轉（08_sea.js SEA_A）。
//   ⛔ 以前固定 WIND0（往 +z 吹）⇒ 開局藍方（+z 往 −z）永遠頂風、紅方永遠在上風：4 對 4 電腦對電腦 12 場紅方贏 10 場，策略比不出來（TASK-0551）。
var WIND0 = WIND.slice(), WIND_A0 = Math.atan2(WIND0[2], WIND0[0]), WIND_L0 = Math.hypot(WIND0[0], WIND0[2]), WIND_SPD = 1, WIND_LOG = { a: WIND_A0, s: 1, t: 0 };
var WIND_ROT = 0, WIND_S0 = 1, WIND_FIX = null;                        // WIND_FIX：擬真沙盒（84_fleetlab.js）{ rot（度；null ＝ 照種子）, s0（null ＝ 照種子）}，蓋過網址、照種子抽（null ⇒ 跟以前一樣）
var WX_ID = WEATHERS[Q.get('weather')] ? Q.get('weather') : 'clear', WX = WEATHERS[WX_ID];
function seedHash(k) { var x = Math.sin((SEED % 99991) * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); }
function windInit() {
  var pin = Q.has('seed') || DEMO >= 0 || !!WIND_FIX, u1 = pin ? seedHash(11) : Math.random(), u2 = pin ? seedHash(12) : Math.random();
  WIND_ROT = WIND_FIX && WIND_FIX.rot !== null ? WIND_FIX.rot * Math.PI / 180 : !WIND_FIX && Q.has('wdir') && isFinite(+Q.get('wdir')) ? +Q.get('wdir') * Math.PI / 180 : u1 * 2 * Math.PI;
  WIND_S0 = WIND_FIX && WIND_FIX.s0 !== null ? clamp(WIND_FIX.s0, 0.3, 3) : !WIND_FIX && Q.has('wspd') && isFinite(+Q.get('wspd')) ? clamp(+Q.get('wspd'), 0.3, 3) : 0.6 + 0.9 * u2;
  SEA_A = WIND_ROT;
}
/** 每一步（50_sim.js step 開頭、70_flow.js 開局）：照模擬時間算現在的風，改 WIND 與 WIND_SPD；風向轉了 20° 以上、風速變了三成以上 ⇒ 上方廣播（15 秒內不重複）。 */
function stepWind(t) {
  var g = WX.gusts, wt = [0.6, 0.3, 0.1], da = 0, ds = 0;
  for (var i = 0; i < 3; i++) {
    var om = 2 * Math.PI / g.per[i], p1 = seedHash(i) * 6.2832, p2 = seedHash(i + 7) * 6.2832;
    da += wt[i] * (Math.sin(om * t + p1) - Math.sin(p1)); ds += wt[i] * (Math.sin(om * 1.37 * t + p2) - Math.sin(p2));
  }
  var a = WIND_A0 + WIND_ROT + g.dir * da; WIND_SPD = WIND_S0 * Math.max(0.4, 1 + g.spd * ds);
  WIND[0] = Math.cos(a) * WIND_L0 * WIND_SPD; WIND[1] = 0; WIND[2] = Math.sin(a) * WIND_L0 * WIND_SPD;
  if (t <= 0) { WIND_LOG = { a: a, s: WIND_SPD, t: 0 }; return; }
  if (t - WIND_LOG.t < 15 || !SHIPS[PLAYER_I]) return;
  var turn = Math.atan2(Math.sin(a - WIND_LOG.a), Math.cos(a - WIND_LOG.a)) * 57.3, ds2 = WIND_SPD / WIND_LOG.s;
  if (Math.abs(turn) >= 20 || ds2 > 1.3 || ds2 < 0.77) {
    var msg = Math.abs(turn) >= 20 ? '風向轉了 ' + Math.round(Math.abs(turn)) + '°（現在從 ' + compassName(bearing(-WIND[0], -WIND[2])) + ' 吹來）' : '';
    if (ds2 > 1.3 || ds2 < 0.77) msg += (msg ? '，' : '') + (ds2 > 1 ? '風勢增強' : '風勢減弱') + '（約 ' + windKnots().toFixed(0) + ' 節）';
    note(SHIPS[PLAYER_I], msg); WIND_LOG = { a: a, s: WIND_SPD, t: t };
  }
}
/** 帆上的風速（節）：給 HUD 與廣播看。 */
function windKnots() { return WIND_SAIL * WIND_K * WX.wind * WIND_SPD * 1.944; }
/** 換天氣：天色跟著換（00_core.js 的 SKY／HORIZON／GROUND；晴天 ＝ 原本那三個陣列本身）。 */
function setWeather(id) {
  WX_ID = WEATHERS[id] ? id : 'clear'; WX = WEATHERS[WX_ID];
  SKY = WX.sky; HORIZON = WX.horizon; GROUND = WX.ground; vxInit();   // 大漩渦（08_sea.js）：主選單的背景也看得到
  evEmit('weather', WX_ID);                                         // 主選單的天氣鈕跟著亮（外殼，71_input.js）
}
// ───────── 世界時間（Tim 2026-10-20「是否可以加一個世界模擬時間(先模擬24小時就好) 讓太陽跟著這個時間變化(會有夜晚) 然後船航行這個時間也會變」）─────────
//   只有外面那一頁給了 ?tod=<時（0～24，可帶小數）> 才開（Blocksail 地球儀管時鐘、帶進帶出）；沒給 ⇒ 照舊固定的太陽與天色（對戰、沙盒、宣傳片的畫面一位元都不變）。
//   現在幾點 ＝ tod ＋ 模擬時間 SIMT ÷ 3600：1:1（Tim：「我希望維持目前手感」—— 畫面上的節數就是模擬裡的速度，地球儀也照同一個節數開）；
//     停格的模擬倍速 ×8 ⇒ 時間也 ×8。回地球儀時 'left' 帶 tod（03_camera.js camTrans）。
//   太陽：照海域原點的緯度（BED.A.lat0；沒有 ⇒ ?lat= ⇒ 18°N）、赤緯 0（先不分季節：6 點日出、18 點日落）算方位與高度；時刻照 30 秒一步
//     （太陽一步動 0.125° ⇒ 看不出跳；陰影的靜態那一層不用每一格重畫，60_render.js shadowPass 的 key 有 SUN）。
//   晨昏（太陽 −6°～10°）：天色、霧往橘紅靠；夜晚（低於 −6°）：直射光換成月亮（滿月、跟太陽相對；強度 0.14、偏藍的圓盤）、天色深藍、環境光剩三成、
//     燈變亮（wxLum 變小 ⇒ 60_render.js lampsUpdate 的 1.6 − lum 變大）；天空有星星（01_gl.js P.sky 的 uNight）。
//   只動畫面：天色在 render 開頭套（todApply）、結尾還原（todRestore／sky0）；陽光、亮度是倍數 TOD_SUNK、TOD_LUMK（讀的地方一律走 wxSun()、wxLum()）——
//     ⛔ 不改 WX.sun／lum 本身（WX 就是天氣預設那個物件；改了又沒還原 ⇒ 下一格拿它當基準、越乘越暗）。模擬不讀 SUN、天色。
var TOD0 = Q.has('tod') && isFinite(parseFloat(Q.get('tod'))) ? ((parseFloat(Q.get('tod')) % 24) + 24) % 24 : null, TOD_LAT = parseFloat(Q.get('lat'));
var SUNC = [1, 0.85, 0.6], TOD_NIGHT = 0, TOD_SUNK = 1, TOD_LUMK = 1;  // 天空的太陽（月亮）圓盤顏色、星星多少（01_gl.js P.sky）；陽光、亮度的倍數
var TOD_LIT = 0, TOD_WIN = 0;                                          // 城裡點燈了沒（0～1：太陽 3° 開始點、−5° 全亮）、幾成的窗亮著（63_towns.js「夜裡的燈」）；沒開世界時間 ⇒ 0（白天）
/** 幾點有幾成的窗亮著：入夜七成、半夜以後慢慢熄到一成、天亮前早起的人又點起三成（只在 TOD_LIT > 0 的時候有用）。 */
function todWin(h) {
  var K = [[0, 0.35], [1, 0.2], [4, 0.08], [5.5, 0.3], [7, 0.3], [17, 0.7], [21.5, 0.7], [24, 0.35]];
  for (var i = 1; i < K.length; i++) if (h <= K[i][0]) return K[i - 1][1] + (K[i][1] - K[i - 1][1]) * (h - K[i - 1][0]) / (K[i][0] - K[i - 1][0]);
  return K[0][1];
}
/** 這一格的陽光、亮度（天氣 × 世界時間；沒開世界時間 ⇒ 就是天氣的）。 */
function wxSun() { return WX.sun * TOD_SUNK; }
function wxLum() { return WX.lum * TOD_LUMK; }
/** 現在幾點（0～24）；沒開世界時間 ⇒ null。 */
function todNow() { return TOD0 === null ? null : ((TOD0 + SIMT / 3600) % 24 + 24) % 24; }
/** 那個時刻天體的方向（世界座標：東 ＋x、北 −z、上 ＋y）：時角 H ＝ (h − 12) × 15°、赤緯 dec、緯度 lat（弧度）。 */
function todDir(h, lat, dec) {
  var H = (h - 12) * Math.PI / 12, e = -Math.cos(dec) * Math.sin(H), n = Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.cos(H) * Math.sin(lat), u = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(H) * Math.cos(lat);
  return norm([e, u, -n]);
}
function todSm(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
/** render 開頭（60_render.js；在記下 sky0／hor0 之後、閃電之前）：照時刻換太陽（月亮）的方向、天色、陽光與亮度的倍數 ⇒ 回傳要還原的地面色（沒開世界時間 ⇒ null）。 */
function todApply() {
  if (TOD0 === null) return null;
  var h = Math.round(todNow() * 120) / 120, lat = (BED && BED.A && isFinite(BED.A.lat0) ? BED.A.lat0 : isFinite(TOD_LAT) ? TOD_LAT : 18) * Math.PI / 180;
  var S = todDir(h, lat, 0), el = Math.asin(S[1]) * 180 / Math.PI, day = todSm(-6, 10, el), dusk = Math.max(0, 1 - Math.abs(el - 2) / 8), gr0 = GROUND;
  if (el > -3) { SUN = S; TOD_SUNK = todSm(-1, 12, el); SUNC = [1, 0.85 - 0.25 * dusk, 0.6 - 0.35 * dusk]; }
  else { var Mo = todDir(h + 12, lat, 0), me = Math.asin(Mo[1]) * 180 / Math.PI; SUN = Mo; TOD_SUNK = 0.25 * (1 - todSm(-6, -3, el)) * todSm(-2, 10, me); SUNC = [0.32, 0.35, 0.42]; }   // 月亮：太陽 −3° 以下才換過去（那時陽光已經是 0 ⇒ 方向換了看不出來）
  // 夜色：環境光（天 × 地）約白天的三成、偏藍 —— 第一版只剩一成（0.03／0.04），船跟海一樣黑、整個畫面一片深藍（Tim 要「看得見的月光夜」）
  SKY = lerp3(lerp3([0.10, 0.14, 0.26], SKY, day), [0.36, 0.38, 0.62], dusk * 0.45);
  HORIZON = lerp3(lerp3([0.09, 0.12, 0.20], HORIZON, day), [0.86, 0.52, 0.34], dusk * 0.55);
  GROUND = lerp3([0.08, 0.08, 0.10], GROUND, day);
  TOD_LIT = 1 - todSm(-5, 3, el); TOD_WIN = todWin(h);
  TOD_LUMK = 0.3 + 0.7 * day; TOD_NIGHT = (1 - todSm(-12, -4, el)) * Math.min(1, WX.sun);   // 星星：太陽 −4° 以下才出來、−12° 全亮（第一版照 day ⇒ 太陽還在地平線上就有星星）；暴風雨（陽光 0.35）星星也少
  return { gr: gr0 };
}
/** render 結尾：地面色還原成天氣的（天、霧由 render 自己的 sky0／hor0 還原；SUN、倍數留著：下一格 todApply 會再算）。 */
function todRestore(s) { if (s) GROUND = s.gr; }
// 遠景的貼圖（63_trees.js TREE_BB_FS 樹、63_towns.js 遠處的建築）是白天烘好的顏色，以前只乘「常數 ＋ 陽光」⇒ 夜晚還有白天七成亮、650 m 外一圈亮的
//   （Tim 2026-10-20「夜晚時 遠處的部分會是亮的」「夜晚應該只計算月光」）。⇒ 再乘 todBakeK：現在的「天色環境光 ＋ 直射光（夜晚是月光）」÷ 白天的同一個量（每個顏色各自比），
//   跟近景著色器同一套光（環境 mix(地, 天, 0.6) × 0.7 ＋ 直射 0.72 × 高度 × 陽光）⇒ 夜晚只剩月光那一份、偏藍。沒開世界時間 ⇒ [1, 1, 1]（畫面一位元不變）。
var SUN_DAY = SUN.slice(), TOD_BAKE = [1, 1, 1];
function todBakeK() {
  if (TOD0 === null) return [1, 1, 1];
  var C = [1.0, 0.96, 0.88], a = Math.max(SUN[1], 0) * wxSun() * 0.72, b = Math.max(SUN_DAY[1], 0) * WX.sun * 0.72;
  for (var i = 0; i < 3; i++) TOD_BAKE[i] = ((GROUND[i] * 0.4 + SKY[i] * 0.6) * 0.7 + C[i] * a) / ((WX.ground[i] * 0.4 + WX.sky[i] * 0.6) * 0.7 + C[i] * b);
  return TOD_BAKE;
}
/** 開砲散布的倍率：晴天 1；暴風雨 ＝ 1.25 ＋ 9 ×（橫搖角速度 ＋ 一半的縱搖角速度，rad/s）—— 船晃得越快，點火那一下差得越多。 */
function wxSpread(sh) {
  if (!WX.aim || !sh.wv) return 1;
  return 1.25 + 9 * (Math.abs(sh.wv.rv) + 0.5 * Math.abs(sh.wv.pv));
}
/** 閃電（只在畫面）：每 0.1 秒一格，照模擬時間的雜湊決定那一格有沒有打（平均約 7 秒一次）；回傳最近一道的亮度（0.3 秒內衰減）與它在哪（方位、多遠）。 */
function wxBolt(t) {
  if (!WX.bolt) return null;
  for (var k = 0; k < 4; k++) {
    var n = Math.floor(t * 10) - k, h = fract(Math.sin(n * 91.7 + 13.1) * 43758.5453);
    if (h < 0.014) { var age = t - n / 10; return { f: Math.max(0, 1 - age / 0.3) * (0.6 + 0.4 * fract(h * 977)), n: n, az: fract(h * 7919) * 6.2832, d: 600 + 1800 * fract(h * 31337) }; }
  }
  return null;
}
function fract(x) { return x - Math.floor(x); }
