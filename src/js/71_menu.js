// ───────────────────────── Blockside 的外殼：主選單（TASK-0774 第 3 步：從 71_input.js 搬來，內容一字不改）─────────────────────────
// 核心與外殼拆兩包：外殼（主選單、設定頁、開發後台頁）照樣在同一個閉包裡，依賴只往下 —— 外殼叫核心 OK；核心不叫這裡的名字、不碰 #cover 的 DOM（admin.py layers --shell）。
// 排在 71_input.js 後面（71_cfgpages.js、71_pages.js 之後）⇒ 頂層的敘述照搬之前的先後跑（玩法鈕、編成、訂閱、sliders()、天氣、同時在場…）。
// Discord（主選單；Tim 2026-10-17）：新分頁開（從主畫面開的 ⇒ iOS 交給 Safari）。畫廊彈窗的 iframe 沒開 allow-popups ⇒ 開不了，照樣不擋遊戲。
var DISCORD_URL = 'https://discord.gg/XuHkBFN9r';
$('discordB').onclick = function () { window.open(DISCORD_URL, '_blank', 'noopener'); };
/** 主選單的玩法鈕：照玩法規則表（04_modes.js MODE_RULES）裡 menu 的那幾份生、照表的順序（TASK-0668：加一種玩法不用改這裡）。 */
function modeButtons() {
  $('modes').innerHTML = Object.keys(MODE_RULES).filter(function (m) { return MODE_RULES[m].menu; }).map(function (m) { return '<button data-m="' + m + '">' + MODE_RULES[m].name + '</button>'; }).join('');
  [].forEach.call(document.querySelectorAll('#modes button'), function (b) { b.onclick = function () { flowMode(b.dataset.m); [].forEach.call(document.querySelectorAll('#modes button'), function (x) { x.className = x === b ? 'on' : ''; }); }; });
}
modeButtons();
var CFG_ID = myHull();                             // 細節設定的「船隻設定」正在編輯哪一型
var SLIDERS_SHOW = null;                               // 載入完（HYD 算好）再顯示一次 ⇒ 減重上浮的例子有數字
/** 主選單的畫質那一排（低／中／高／全開＋「畫質設定…」）：畫質頁本身是核心那一層（gfxUI）；這裡只接按鈕、照 cfg:gfx 點亮（TASK-0774）。 */
function gfxMenuUI() {
  [].forEach.call(document.querySelectorAll('#gfxs button[data-g]'), function (b) { b.onclick = function () { gfxSet(b.dataset.g); gfxShow(); }; });
  gfxMenuShow(gfxLevel());
}
function gfxMenuShow(lv) {
  [].forEach.call(document.querySelectorAll('#gfxs button[data-g]'), function (b) { b.className = b.dataset.g === lv ? 'on' : ''; });
  var gb = $('gfxB'); gb.textContent = lv === 'custom' ? '自訂（畫質設定…）' : '畫質設定…'; gb.className = lv === 'custom' ? 'on' : '';
}
evOn('cfg:gfx', gfxMenuShow);
/** 玩法：娛樂／寫實（04_state.js 的 PLAY）＋主選單按鈕的亮燈。航行每一步都讀（playK）；按鈕在主選單，沒開戰時才按得到。 */
function setPlay(p) { PLAY = p === 'real' ? 'real' : 'fun'; [].forEach.call(document.querySelectorAll('#plays button'), function (x) { x.className = x.dataset.p === PLAY ? 'on' : ''; }); }
/** 選單列船：HULL_LIST 的每一艘。 */
function hullOptions(sel, v) { sel.innerHTML = HULL_LIST.map(function (h) { return '<option value="' + h.id + '">' + h.name + '</option>'; }).join(''); sel.value = v; }
/** 主選單的艦隊編成（TASK-0537）：我方、敵方各一列，每艘一個選單；第二艘起有 ×（拿掉）；＋ 加一艘（照那一邊最後一艘的船型），合計到 MAX_SHIPS 就停用。
 *  我方第一艘 ＝ 我艦。改了就重建這兩列。 */
function fleetUI() {
  var full = FLEET_SET[0].length + FLEET_SET[1].length >= FLEET_MAX;
  [0, 1].forEach(function (s) {
    var box = $('fleet' + s), L = FLEET_SET[s];
    box.innerHTML = L.map(function (id, j) {
      var lab = s === 0 ? (j ? '友艦 ' + j : '我艦') : '敵艦 ' + (j + 1);
      var h = hullInfo(id);
      return '<span class="fs"><button class="fsb" data-s="' + s + '" data-j="' + j + '" aria-label="' + lab + '的船：' + (h ? h.name : id) + '（點了選船）" title="' + lab + '">' + (h ? h.name : id) + '</button>' + (j ? '<button class="fx" data-s="' + s + '" data-j="' + j + '" aria-label="拿掉' + lab + '">×</button>' : '') + '</span>';
    }).join('') + '<button class="fa" data-s="' + s + '" aria-label="' + (s ? '加一艘敵艦' : '加一艘友艦') + '"' + (full ? ' disabled' : '') + '>＋</button>';
    [].forEach.call(box.querySelectorAll('button.fsb'), function (b) {
      var j = +b.dataset.j;
      b.onclick = function () { spkOpen({ title: '選船：' + (s === 0 ? (j ? '友艦 ' + j : '我艦') : '敵艦 ' + (j + 1)), cur: L[j], pick: function (id) { pickShip(s, j, id); fleetUI(); } }); };
    });   // 選船彈窗（72_shippick.js；Tim 2026-10-18：下拉選單換成按鈕＋彈窗分類）
    [].forEach.call(box.querySelectorAll('button.fx'), function (b) { b.onclick = function () { L.splice(+b.dataset.j, 1); fleetUI(); pickShip(); }; });
    box.querySelector('button.fa').onclick = function () { if (FLEET_SET[0].length + FLEET_SET[1].length < FLEET_MAX) { L.push(L[L.length - 1]); fleetUI(); pickShip(); } };
  });
  var sp = fieldSplit(fleetSpec()), fb = sp.field.filter(function (f) { return f.team === 'blue'; }).length, fr = sp.field.length - fb;   // 開局誰上場（52_fleet.js）
  $('fleetN').textContent = FLEET_SET[0].length + ' 對 ' + FLEET_SET[1].length + (full ? '（編成上限 ' + FLEET_MAX + ' 艘）' : '') +
    (sp.reserve.blue.length || sp.reserve.red.length ? '　⇒ 開局 ' + fb + ' 對 ' + fr + ' 上場，候補 ' + sp.reserve.blue.length + '／' + sp.reserve.red.length + ' 艘（' + REINF_NAMES[REINF_MODE] + '）' : '');
}
/** 主選單換船（s 那一邊第 j 艘換成 id；不給 ⇒ 只是艘數變了）：還沒載的先載（開戰鈕暫時停用），載好就把背景的船換掉；細節設定跟著編輯我艦那一型。 */
function pickShip(s, j, id) {
  if (id) { FLEET_SET[s][j] = id; if (s === 0 && j === 0) CFG_ID = id; }
  var need = fleetHulls().filter(function (h) { return !HULLT[h]; });
  var go = $('go'); go.disabled = true; go.textContent = need.length ? '載入' + hullInfo(need[0]).name + '…' : '編隊中…';
  Promise.all(fleetHulls().map(loadHull)).then(function () {
    if (fleetHulls().some(function (h) { return !HULLT[h]; })) return;     // 又換了一艘、還在載
    go.disabled = false; go.textContent = '開戰';
    if (!RUNNING) reset();                                                  // 選單後面的兩艘換成選到的船
    if (SLIDERS_SHOW) SLIDERS_SHOW();
  }).catch(function (e) { go.textContent = '載不了：' + (e && e.message || e); console.error(e); });
}
// 外殼訂閱核心的事件（00_events.js；2026-10-21 核心與外殼拆兩包：核心不碰 #cover，主選單自己點亮、自己顯示）—— ⛔ 要在下一行 setWeather 之前訂好
evOn('boot:say', function (s) { $('load').textContent = s; });             // 載入的字（glFail、90_main.js loadSay）
if (BOOT.say) $('load').textContent = BOOT.say;                             // 訂閱之前就說過的（01_gl.js 開機就失敗）
evOn('boot:hull', function (s) { var go = $('go'); if (go.disabled) go.textContent = s; });   // 解析中：開戰鈕寫進度（設定照樣能調）
evOn('boot:loaded', function () { if (SLIDERS_SHOW && !START_Q) SLIDERS_SHOW(); });           // ?start=1：主選單不會出來 ⇒ 先不重畫（回到主選單時才補，coverShow）
evOn('boot:ready', function () { $('go').disabled = false; $('go').textContent = '開戰'; });
evOn('flow:start', function () { $('cover').style.display = 'none'; });   // 開戰、量測頁（70_flow.js uiAway）
evOn('flow:menu', coverShow);                                               // 回主選單（menuGo）
evOn('weather', function () { [].forEach.call(document.querySelectorAll('#wxs button'), function (b) { b.className = b.dataset.w === WX_ID ? 'on' : ''; }); });
evOn('phys', function () { if ($('phxB')) phxShow(); }, 0, true);          // 物理開關（62_simview.js 那一個之後）
evOn('pslow', function () { phxShow(); });                                  // 物理減速（73_slowmo.js pslowToggle）
evOn('cfg:phx', phxShow);                                                   // 物理檔位改了（phxSync）
$('repB').onclick = function () { errShow(null); };                         // 主選單「問題回報…」：手動回報（沒有錯誤訊息；01_gl.js errShow）
sliders(); setPlay(PLAY); setWeather(WX_ID);
[].forEach.call(document.querySelectorAll('#wxs button'), function (b) { b.onclick = function () { setWeather(b.dataset.w); if (SLIDERS_SHOW) SLIDERS_SHOW(); }; });   // 主選單：天氣（08_weather.js）
/** 主選單：同時在場（滑桿 2～MAX_SHIPS，52_fleet.js FIELD_N）；編成超過它的照候補規則進場。 */
function fieldShow() { var f = $('field'); f.value = FIELD_N; $('fieldV').textContent = FIELD_N + ' 艘'; if ($('fleetN')) fleetUI(); }
(function () { var f = $('field'); f.min = 2; f.max = MAX_SHIPS; f.oninput = function () { FIELD_N = Math.round(+f.value); fieldShow(); }; fieldShow(); })();
/** 細節設定：艦隊指揮官（52_fleet.js CMD_SIDE；策略在 53_commander.js）。 */
function cmdShow() { [].forEach.call(document.querySelectorAll('.cmds'), function (row) { [].forEach.call(row.querySelectorAll('button'), function (b) { b.className = b.dataset.c === CMD_SIDE[row.dataset.side] ? 'on' : ''; }); }); }
[].forEach.call(document.querySelectorAll('.cmds'), function (row) { [].forEach.call(row.querySelectorAll('button'), function (b) { b.onclick = function () { CMD_SIDE[row.dataset.side] = b.dataset.c; cmdShow(); }; }); });
cmdShow();
/** 細節設定：搶上風（52_fleet.js CMD_GAUGE；TASK-0679）每一方一顆開關。 */
function gaugeShow() { [].forEach.call(document.querySelectorAll('#gauges button'), function (b) { b.className = CMD_GAUGE[b.dataset.side] ? 'on' : ''; }); }
[].forEach.call(document.querySelectorAll('#gauges button'), function (b) { b.onclick = function () { CMD_GAUGE[b.dataset.side] = !CMD_GAUGE[b.dataset.side]; gaugeShow(); }; });
gaugeShow();
/** 細節設定：候補補位（52_fleet.js REINF_MODE）。 */
function reinfShow() { [].forEach.call(document.querySelectorAll('#reinfs button'), function (b) { b.className = b.dataset.r === REINF_MODE ? 'on' : ''; }); if ($('fleetN')) fleetUI(); }
[].forEach.call(document.querySelectorAll('#reinfs button'), function (b) { b.onclick = function () { REINF_MODE = b.dataset.r; reinfShow(); }; });
reinfShow();
/** 主選單：開局距離（滑桿，04_state.js LIM_DIST）。開局才用 ⇒ 改了下一場生效。 */
function distShow() { var d = $('dist'); d.value = DIST; $('distV').textContent = DIST + ' m（船頭到船頭）'; }
(function () { var d = $('dist'); d.min = LIM_DIST[0]; d.max = LIM_DIST[1]; d.oninput = function () { DIST = Math.round(+d.value); distShow(); }; distShow(); })();
[].forEach.call(document.querySelectorAll('#sails button'), function (b) { b.onclick = function () { setSailMode(b.dataset.s); }; });
[].forEach.call(document.querySelectorAll('#modes button'), function (b) { b.className = b.dataset.m === MODE ? 'on' : ''; });   // 模式的預設照設定檔（menu.mode）
setSailMode(SAIL); setCamTrack(true); $('physT').classList.toggle('on', PHYS);
$('go').onclick = start;
/** 回到主選單（'menu'、結束畫面的「主選單」）：?start=1 開場時沒照載好的船型重畫主選單（90_main.js：主選單不會出來 ⇒ 不佔開場）⇒ 第一次回來才補畫。 */
var COVER_LATE = START_Q;
function coverShow() { $('cover').style.display = ''; if (COVER_LATE && SLIDERS_SHOW) { COVER_LATE = false; SLIDERS_SHOW(); } }
// __game（DEBUG 的量測入口，90_main.js）裡屬於主選單的那幾項：開機時核心發 game:api ⇒ 掛上去（TASK-0774 第 4 步）
evOn('game:api', function (G) {
  G.menuFleet = function (F) { if (F) { FLEET_SET = fleetTrim(F.map(function (L) { return L.slice(); })); fleetUI(); pickShip(); } return { set: FLEET_SET, spec: fleetSpec(), html: [$('fleet0').innerHTML.length, $('fleet1').innerHTML.length] }; };
  var rp = G.roomPlans; G.roomPlans = function (id, type) { return rp(id || CFG_ID, type); };   // 沒給船型 ⇒ 主選單「船隻配置」正在編的那一型
});
evOn('cfg:ships', function () { if (SLIDERS_SHOW) SLIDERS_SHOW(); });   // 船隻配置改了（__game.roomSet、shipsIO.imp）⇒ 主選單重畫
