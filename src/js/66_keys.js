// ───────────────────────── 鍵位（Tim 2026-10-17：「整理一套系統去管理鍵位(然後要分不同模式 目前還有建造模式 第一人稱)」「不是後台 而是遊戲中(後台可以設定預設值)」）─────────────────────────
// 一個動作一列（KEY_ACTS）：id（全域唯一）、模式 c（battle 海戰／fps 第一人稱／build 建造）、名字、預設鍵、按住才算（hold）。
//   鍵 ＝ KeyboardEvent.key 轉小寫（空白鍵 ' '、'shift'、'alt'）；畫面上照 keyName 寫（空白、Shift、A）。
//   三層：出廠（這裡的 def）→ 設定檔 config/game.json keys（開發後台 ?admin=keys 用同一頁存）→ 玩家（69_prefs.js keys ＝ KEY_SET，只存跟預設不一樣的）。
// 模式疊在一起時上層先問：第一人稱（81_fps.js fpKey）→ 建造（82_build.js bldKey）→ 海戰（71_input.js doKey）⇒ 第一人稱開著時 WASD 走路、不打舵（照舊）。
//   ⇒ 同一個模式裡一個鍵只能給一個動作（設定頁換鍵撞到 ⇒ 兩個對調）；不同模式可以重複（上層蓋過下層，就是設計）。
// 固定、不給改：Esc（設定／關頁）、方向鍵（海戰 ＝ 打舵、帆；第一人稱 ＝ 轉頭、看上下）、?（說明）。
// 畫面上寫鍵的地方一律照這裡（keyPaint）：[data-act]（點了 ＝ 做那個海戰動作）、[data-kl]（只寫鍵）：裡面的 <b> 換成鍵名、title 用 data-tip ＋（鍵）；
//   kbd[data-ico] ⇒ 整格寫「圖示 鍵」；span.kn ⇒ 只寫鍵名。程式裡組字串的提示用 keyName（鍵帽）／keyWord（句子裡：空白鍵）。
var KEY_CTX = [{ id: 'battle', name: '海戰' }, { id: 'fps', name: '第一人稱' }, { id: 'build', name: '建造' }];
var KEY_ACTS = [
  // ico ＝ 畫面上那顆圓鈕的圖示（設定頁寫「圖示 正式名稱」；Tim 2026-10-17：「圓鈕的操作 設定頁除了emoji外 額外顯示正式名稱(例如 拋錨 切換彈藥)」）；沒有圓鈕的不寫。
  // 海戰（71_input.js doAct）——數字鍵照畫面左右排（Tim 2026-10-16：「拋錨數字鍵位重新排列(目前簡化後 跳過好幾個鍵)」）：1 彈種、2 自動操舵、3 左錨、4 雙錨、5 右錨
  // Tim 2026-10-17「開火的預設鍵位 F 拋左錨Q 右錨E (可以看跟那些鍵有衝突)」「換彈藥種類 R」⇒ 錨 Q／E、換彈藥 R；擠掉的：俥鐘 E▲T▼ → T▲G▼（上下一對）、
  //   自動開砲 G → 5、瞄準模式 Q → 3、回主選單 R → 0（⛔ 放 1：就在 Q 旁邊，回主選單沒有確認、一按這局就結束）。開一門砲照舊 F、齊射照舊空白。
  { c: 'battle', id: 'ruddL', ico: '⬅️', name: '左舵', def: 'a', hold: 1 }, { c: 'battle', id: 'ruddR', ico: '➡️', name: '右舵', def: 'd', hold: 1 },
  { c: 'battle', id: 'sailDn', ico: '⛵⬇', name: '收帆', def: 's', hold: 1 }, { c: 'battle', id: 'sailUp', ico: '⛵⬆', name: '加帆', def: 'w', hold: 1 },
  { c: 'battle', id: 'ammo', ico: '💣', name: '切換彈藥（輪流）', def: 'r' }, { c: 'battle', id: 'sailMode', ico: '🤖☸', name: '自動操舵（自動 ⇄ 手動）', def: '2' },
  { c: 'battle', id: 'ancP', ico: '◀⚓', name: '拋左錨', def: 'q' }, { c: 'battle', id: 'ancAll', ico: '⚓⚓', name: '拋錨（雙錨；再按起錨）', def: '4' }, { c: 'battle', id: 'ancS', ico: '⚓▶', name: '拋右錨', def: 'e' },
  { c: 'battle', id: 'volley', ico: '💥💥', name: '齊射', def: ' ' }, { c: 'battle', id: 'fire1', ico: '💥', name: '開一門砲', def: 'f' }, { c: 'battle', id: 'autoFire', ico: '🤖💥', name: '自動開砲', def: '5' },
  { c: 'battle', id: 'aim', ico: '🎯', name: '瞄準模式', def: '3' }, { c: 'battle', id: 'teleFwd', ico: '▲', name: '俥鐘往前撥', def: 't' }, { c: 'battle', id: 'teleBack', ico: '▼', name: '俥鐘往後撥', def: 'g' },
  { c: 'battle', id: 'cam', ico: '🎥', name: '換鏡頭', def: 'c' }, { c: 'battle', id: 'camTrack', name: '鏡頭跟船／固定', def: 'v' },
  { c: 'battle', id: 'signals', ico: '🚩', name: '旗號（對我方友艦下令）', def: 'k' }, { c: 'battle', id: 'pause', ico: '⏸', name: '停格', def: 'p' }, { c: 'battle', id: 'settings', ico: '⚙', name: '設定', def: 'o' }, { c: 'battle', id: 'help', name: '說明', def: 'h' },
  { c: 'battle', id: 'flood', ico: '📊', name: '進水圖表（停格時）', def: 'i' }, { c: 'battle', id: 'xray', ico: '🔍', name: '透視', def: 'x' }, { c: 'battle', id: 'cut', ico: '✂', name: '剖面', def: 'z' }, { c: 'battle', id: 'deck', ico: '☰', name: '隱藏甲板', def: 'l' },
  { c: 'battle', id: 'phys', name: '帆繩物理', def: 'b' }, { c: 'battle', id: 'mute', name: '靜音', def: 'm' }, { c: 'battle', id: 'restart', name: '重新開始', def: 'n' }, { c: 'battle', id: 'menu', name: '回主選單', def: '0' },
  { c: 'battle', id: 'hostBack', ico: '🌍', name: '回到地球儀（Blocksail 地球儀開的才有）', def: 'u', host: 1 },   // Tim 2026-10-20「回到地球儀加一個快捷鍵吧(同時顯示)」；host ⇒ 設定頁只在 ?map=@host 列（08_seabed.js bedHostBack）
  // 第一人稱（81_fps.js fpKey）：走路四個鍵、轉頭 Q 按住才算（畫面上是搖桿，沒有圓鈕）
  { c: 'fps', id: 'fpFwd', name: '往前走', def: 'w', hold: 1 }, { c: 'fps', id: 'fpBack', name: '往後走', def: 's', hold: 1 }, { c: 'fps', id: 'fpLeft', name: '往左走', def: 'a', hold: 1 }, { c: 'fps', id: 'fpRight', name: '往右走', def: 'd', hold: 1 },
  { c: 'fps', id: 'fpTurnL', name: '往左轉頭', def: 'q', hold: 1 }, { c: 'fps', id: 'fpRun', ico: '🏃', name: '跑', def: 'shift', hold: 1 },
  { c: 'fps', id: 'fpJump', ico: '⤴', name: '跳（浮空：往上）', def: ' ', hold: 1 }, { c: 'fps', id: 'fpDown', ico: '⬇', name: '浮空：往下', def: 'c', hold: 1 },
  { c: 'fps', id: 'fpClimb', ico: '🪜', name: '爬梯子', def: 'e' }, { c: 'fps', id: 'fpFollow', ico: '👁', name: '跟隨身邊的船員（再按回來）', def: 'f' }, { c: 'fps', id: 'fpNext', ico: '⏭', name: '跟隨下一個', def: 'g' },
  { c: 'fps', id: 'fpUnlock', name: '放開滑鼠（遊戲不停）', def: 'alt' },
  { c: 'fps', id: 'fpExit', ico: '🎥', name: '離開第一人稱（建造模式固定第一人稱）', def: 'y' },   // Tim 2026-10-17「一鍵退出第一人稱」
  // 建造（82_build.js bldKey）：快捷欄 1–9
  { c: 'build', id: 'bSlot1', name: '快捷欄 1', def: '1' }, { c: 'build', id: 'bSlot2', name: '快捷欄 2', def: '2' }, { c: 'build', id: 'bSlot3', name: '快捷欄 3', def: '3' },
  { c: 'build', id: 'bSlot4', name: '快捷欄 4', def: '4' }, { c: 'build', id: 'bSlot5', name: '快捷欄 5', def: '5' }, { c: 'build', id: 'bSlot6', name: '快捷欄 6', def: '6' },
  { c: 'build', id: 'bSlot7', name: '快捷欄 7', def: '7' }, { c: 'build', id: 'bSlot8', name: '快捷欄 8', def: '8' }, { c: 'build', id: 'bSlot9', name: '快捷欄 9', def: '9' },
  { c: 'build', id: 'bRot', ico: '⟳', name: '轉 90°', def: 'r' }, { c: 'build', id: 'bCat', ico: '📦', name: '目錄', def: 'b' }, { c: 'build', id: 'bDel', ico: '✖', name: '拆', def: 'x' }, { c: 'build', id: 'bPut', ico: '✔', name: '放', def: 'v' },
  { c: 'build', id: 'bMode', ico: '🚶', name: '碰撞模式（一般 → 穿牆 → 浮空）', def: 'm' }
];
/** 固定的鍵（不在設定頁、不能改）：照模式 ⇒ 動作。fpLook* 只在這裡（方向鍵轉頭、看上下）。 */
var KEY_FIX = { battle: { arrowleft: 'ruddL', arrowright: 'ruddR', arrowup: 'sailUp', arrowdown: 'sailDn', '?': 'help' }, fps: { arrowup: 'fpLookU', arrowdown: 'fpLookD', arrowleft: 'fpLookL', arrowright: 'fpLookR' }, build: {} };
/** 不給綁的鍵（設定頁按到 ⇒ 不收）。 */
var KEY_RESERVED = /^(escape|arrow(up|down|left|right)|tab|capslock|meta|os|control|contextmenu|f\d+|\?|dead|unidentified|process)$/;
var KEY_BY = {}; KEY_ACTS.forEach(function (a) { KEY_BY[a.id] = a; });
var KEY_DEF = {}; KEY_ACTS.forEach(function (a) { KEY_DEF[a.id] = a.def; }); keyMerge(KEY_DEF, CFG.keys);   // 出廠 ＝ 程式的 def 蓋上設定檔 keys（同一個模式撞到 ⇒ 照設定檔、被搶的那個退回程式的 def）
var KEY_SET = {};                                                        // 玩家改的：{ 動作: 鍵 }（跟 KEY_DEF 不一樣的才有）
var KEYS_NOW = {}, KEY_IDX = {};                                         // 現在用的 { 動作: 鍵 }、反查 { 模式: { 鍵: 動作 } }
var ADMIN_KEYS = Q.get('admin') === 'keys';
/** o（{ 動作: 鍵 }）蓋進 M：只收認得的動作、合法的鍵。 */
function keyMerge(M, o) {
  if (!o || typeof o !== 'object') return 0;
  var n = 0; Object.keys(o).forEach(function (id) { var k = keyNorm(o[id]); if (KEY_BY[id] && k && !KEY_RESERVED.test(k)) { M[id] = k; n++; } });
  return n;
}
function keyNorm(k) { if (typeof k !== 'string' || !k.length || k.length > 12) return ''; return k === ' ' ? ' ' : k.toLowerCase(); }
/** KEYS_NOW、KEY_IDX 重算（開頁、改鍵、讀存檔之後），順便重寫畫面上的鍵。同一組模式兩個動作搶同一個鍵（存檔被手改過）⇒ 後到的那個退回出廠。 */
function keyRebuild() {
  KEYS_NOW = {}; KEY_IDX = {}; KEY_CTX.forEach(function (c) { KEY_IDX[c.id] = Object.assign({}, KEY_FIX[c.id] || {}); });
  KEY_ACTS.filter(function (a) { return KEY_SET[a.id] === undefined; }).concat(KEY_ACTS.filter(function (a) { return KEY_SET[a.id] !== undefined; })).forEach(function (a) {   // 兩輪：出廠的先放、玩家改過的後放 ⇒ 撞到時退的是改過的那個
    var k = KEY_SET[a.id] !== undefined ? KEY_SET[a.id] : KEY_DEF[a.id], I = KEY_IDX[a.c];
    function taken(v) { return (KEY_GROUP[a.c] || [a.c]).some(function (c) { var o = KEY_IDX[c] && KEY_IDX[c][v]; return o && KEY_BY[o] && o !== a.id; }); }   // 同一組模式（KEY_GROUP）
    if (taken(k)) { delete KEY_SET[a.id]; k = KEY_DEF[a.id]; if (taken(k)) k = ''; }   // 撞到 ⇒ 退回出廠；出廠也撞（設定檔被手改過）⇒ 這個動作沒有鍵
    KEYS_NOW[a.id] = k; if (k && !(KEY_FIX[a.c] || {})[k]) I[k] = a.id;
  });
  keyPaint();
}
/** 那個模式裡，鍵 k 對應的動作（沒有 ⇒ ''）。 */
function keyAct(c, k) { var I = KEY_IDX[c]; return (I && I[k]) || ''; }
/** 動作的鍵（畫面上鍵帽那種寫法：空白、Shift、A、1）；沒有鍵 ⇒ '—'。 */
function keyName(id) { return keyLabel(KEYS_NOW[id]); }
var KEY_ARROW = { arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→' };
function keyLabel(k) { if (!k) return '—'; if (KEY_ARROW[k]) return KEY_ARROW[k]; if (k === ' ') return '空白'; if (k === 'shift') return 'Shift'; if (k === 'alt') return 'Alt'; if (k.length === 1) return k.toUpperCase(); return k.charAt(0).toUpperCase() + k.slice(1); }
/** 句子裡的寫法（空白 ⇒ 空白鍵）。 */
function keyWord(id) { var s = keyName(id); return s === '空白' ? '空白鍵' : s; }
/** 畫面上寫鍵的地方照現在的鍵重寫（見檔頭）。開局、改鍵、建造的快捷欄重畫之後都會叫。 */
function keyPaint(root) {
  root = root || document;
  [].forEach.call(root.querySelectorAll('[data-act],[data-kl]'), function (el) {
    var id = el.dataset.act || el.dataset.kl, n = keyName(id), A = KEY_BY[id];
    if (el.tagName === 'KBD' && el.dataset.ico !== undefined) { var h = (el.dataset.ico ? el.dataset.ico + ' ' : '') + n; if (el.innerHTML !== h) el.innerHTML = h; }
    else if (el.classList.contains('kn')) { if (el.textContent !== n) el.textContent = n; }
    else { var b = el.querySelector('b'); if (b && b.textContent !== n) b.textContent = n; }
    if (el.dataset.tip) el.title = el.dataset.tip + '（' + n + (A && A.hold && el.dataset.hold ? '，按住' : '') + '）';
  });
}
// ── 鍵位設定頁（主選單「鍵位設定…」；71_input.js 接返回、換頁）：分頁 ＝ 模式；點「改」再按新的鍵（Esc 取消）。寫法照道具設定頁（67_furncfg.js）——
//   玩家：存檔只存跟出廠不一樣的（69_prefs.js keys）、可以匯出匯入；開發後台 ?admin=keys ⇒ 同一頁多一列「存成出廠預設」⇒ postMessage ⇒ admin.py act_keys 寫 config/game.json keys。
/** 同時開著的模式算一組（建造模式本身就是第一人稱 ⇒ 兩頁一起查撞鍵；海戰被第一人稱蓋掉是設計：WASD 走路不打舵）。 */
var KEY_GROUP = { battle: ['battle'], fps: ['fps', 'build'], build: ['fps', 'build'] };
var KEY_TAB = 'battle', KEY_WAIT = null;                                 // KEY_WAIT ＝ 正在等新鍵的那個動作
/** 動作 id 改成鍵 k：同一組模式（KEY_GROUP）裡別的動作原本用 k ⇒ 換成 id 原本的鍵（對調）。回：被對調的那個動作（沒有 ⇒ null）。 */
function keySet(id, k) {
  var A = KEY_BY[id]; k = keyNorm(k); if (!A || !k || KEY_RESERVED.test(k) || KEY_FIX[A.c][k]) return null;
  var old = KEYS_NOW[id], other = '', sw = null;
  KEY_GROUP[A.c].forEach(function (c) { var o = keyAct(c, k); if (o && !other && KEY_BY[o]) other = o; });   // KEY_BY：固定鍵（fpLook*）不算
  function put(a, v) { if (v === KEY_DEF[a]) delete KEY_SET[a]; else KEY_SET[a] = v; }
  put(id, k);
  if (other && other !== id) { put(other, old); sw = other; }
  keyRebuild();
  return sw;
}
function keyReset(c) { KEY_ACTS.forEach(function (a) { if (!c || a.c === c) delete KEY_SET[a.id]; }); keyRebuild(); }
function keySnap() { return JSON.parse(JSON.stringify(KEY_SET)); }
/** 存檔／匯入 ⇒ 變數：認得的動作、合法的鍵才收；回收了幾個。 */
function keyApply(o) { var n = keyMerge(KEY_SET, o); Object.keys(KEY_SET).forEach(function (id) { if (KEY_SET[id] === KEY_DEF[id]) delete KEY_SET[id]; }); keyRebuild(); return n; }
function keyExport() { var all = {}; KEY_ACTS.forEach(function (a) { all[a.id] = KEYS_NOW[a.id]; }); return cfgHead('keys', { keys: all }); }
function keyImport(o) { return cfgMine(o, 'keys') ? keyApply(o.keys) : -1; }
function keysUI(page) {
  $('keysTabs').innerHTML = KEY_CTX.map(function (c) { return '<button data-kc="' + c.id + '">' + c.name + '</button>'; }).join('');
  [].forEach.call($('keysTabs').querySelectorAll('button'), function (b) { b.onclick = function () { KEY_TAB = b.dataset.kc; KEY_WAIT = null; keysShow(); }; });
  function tabName() { return KEY_CTX.filter(function (c) { return c.id === KEY_TAB; })[0].name; }
  cfgKit('keys', {                                       // 那一排按鈕（64_cfgkit.js）
    one: { idle: '這一頁回到預設', arm: function () { return '再按一次：' + tabName() + '回到預設'; }, run: function () { keyReset(KEY_TAB); } },
    all: { before: function () { KEY_WAIT = null; }, title: '鍵位全部回到預設', body: KEY_CTX.map(function (c) { return c.name; }).join('、') + '（不只正在看的這一頁）的鍵都回到預設。改過的會不見；要留的話先按「匯出…」。',
      run: function () { keyReset(); return '已全部回到預設（' + KEY_CTX.length + ' 個模式）。'; } },
    kind: 'keys', file: 'blockside_keys', expSay: '三個模式整份', exp: function () { return { keys: keyExport().keys }; },
    imp: keyImport, what: '鍵位', unit: '個鍵', show: keysShow
  });
  window.addEventListener('keydown', function (e) {                      // 等新鍵：開著這一頁、按了「改」才收（捕獲階段：⛔ 讓遊戲的鍵盤處理先吃到）
    if (!KEY_WAIT || $('keysp').style.display === 'none') return;
    e.preventDefault(); e.stopImmediatePropagation();                   // ⛔ stopPropagation 擋不住同掛在 window 上的（71_input.js 的 Esc 關頁、遊戲的鍵）
    var k = e.code === 'Space' ? ' ' : keyNorm(e.key), id = KEY_WAIT;
    if (k === 'escape') { KEY_WAIT = null; keysShow(); return; }
    if (KEY_RESERVED.test(k) || KEY_FIX[KEY_BY[id].c][k]) { $('keysSt').textContent = '⚠ ' + keyLabel(k) + ' 不能綁（Esc、方向鍵、Tab、F1–F12 留給遊戲與瀏覽器）—— 換一個鍵，或按 Esc 取消'; return; }
    KEY_WAIT = null; var sw = keySet(id, k);
    $('keysSt').textContent = KEY_BY[id].name + ' ⇒ ' + keyLabel(k) + (sw ? '；跟「' + KEY_BY[sw].name + '」對調（它改成 ' + keyName(sw) + '）' : '') + (PREFS.write ? '（已存）' : '');
    prefsSave(); keysShow();
  }, true);
  if (ADMIN_KEYS) keysAdmUI(page);
}
/** 變數 ⇒ 這一頁。 */
function keysShow() {
  [].forEach.call($('keysTabs').querySelectorAll('button'), function (b) { b.className = b.dataset.kc === KEY_TAB ? 'on' : ''; });
  var note = { battle: '開戰時用。方向鍵固定：← → 打舵、↑ ↓ 加帆收帆；Esc 設定；? 說明。', fps: '第一人稱開著時先問這一頁：同一個鍵在這裡有動作 ⇒ 不做海戰那一個（例 WASD 走路、不打舵）。跟「建造」那一頁一起查撞鍵（建造模式也是第一人稱）。方向鍵固定：轉頭、看上下；滑鼠拖曳也能轉頭。', build: '建造模式（也是第一人稱）時再問這一頁；跟「第一人稱」那一頁一起查撞鍵；海戰的鍵只剩停格、設定、鏡頭。' }[KEY_TAB];
  $('keysInfo').textContent = note;
  $('keysItems').innerHTML = KEY_ACTS.filter(function (a) { return a.c === KEY_TAB && (!a.host || document.body.classList.contains('bsHost')); }).map(function (a) {   // host：只有地球儀開的才有的動作
    var k = KEYS_NOW[a.id], d = KEY_DEF[a.id], w = KEY_WAIT === a.id;
    return '<div class="keyrow"><label>' + (a.ico ? '<span class="kico">' + a.ico + '</span>' : '') + a.name + (a.hold ? '<small>（按住）</small>' : '') + '</label><span class="kcap' + (w ? ' wait' : '') + '">' + (w ? '按新的鍵…（Esc 取消）' : keyLabel(k)) + '</span>' +
      '<button data-kid="' + a.id + '">' + (w ? '取消' : '改') + '</button><span class="note">' + (k === d ? '' : '改過；預設 ' + keyLabel(d)) + '</span></div>';
  }).join('');
  [].forEach.call($('keysItems').querySelectorAll('button[data-kid]'), function (b) { b.onclick = function () { KEY_WAIT = KEY_WAIT === b.dataset.kid ? null : b.dataset.kid; keysShow(); }; });
  var n = Object.keys(KEY_SET).length, kb = $('keysB'); if (kb) { kb.textContent = n ? '鍵位設定（改過）…' : '鍵位設定…'; kb.className = n ? 'on' : ''; }
}
/** 開發後台（?admin=keys）：同一頁多一列 —— 「存成出廠預設」⇒ KEY_SET 送給開這一頁的設定後台（postMessage；⛔ 成品裡不能有 fetch）⇒ admin.py act_keys；「重建」；「回設定後台」。 */
function keysAdmUI(page) {
  cfgAdm({ panel: 'keysp', out: 'keysAdmL', from: '用鍵位設定頁設出廠預設值…', build: 'keysAdmB', back: ['keysAdmX', 'keysX', 'pgX'],
    save: { id: 'keysAdmS', run: function (post, out) {
      var o = keySnap(); if (!Object.keys(o).length) { out.textContent = '（都跟出廠預設一樣，沒有要存的）'; return; }
      post('keys', { keys: o }).then(function (j) { if (!j.ok) return; Object.keys(o).forEach(function (id) { KEY_DEF[id] = o[id]; delete KEY_SET[id]; }); keyRebuild(); keysShow(); });
    } } });
}
keyRebuild();                                                            // 載入時先算一次（69_prefs.js 讀存檔之後 keyApply 會再算）
