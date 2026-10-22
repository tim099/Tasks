// ───────────────────────── 建造模式（TASK-0648） ─────────────────────────
// Tim 2026-10-16：「用第一人稱為基底 新增建造模式吧(玩法多一個建造 然後只會出我方第一艘船) 一進場就是第一人稱模式 UI可以選取要擺放的物件(參考常見建造遊戲UI設計 可以給物件分類)」；
//   之前拍板：「這個介面預計之後會在遊戲中開放玩家使用」「差異在於 後台編輯的會是遊戲初始值」⇒ 跟艙房編輯器（71_input.js 船隻配置頁）同一份資料：
//   SHIP_ROOMS[船型][房名] ＝ { type, items: [{ it, x, y, r }] }（36_rooms.js）—— 玩家存本機（69_prefs.js prefsSave），沒存 ⇒ 設定檔的預設（後台 ?admin=rooms 編的那一份）。
// 玩法「🔨 建造」（MODE 'build'）：只生我方第一艘（52_fleet.js fleetSpec）、停在原地（31_sailing.js 跟拋錨模式同一條：stop）、不開戰（沒有敵艦；不判勝負 61_hud.js checkEnd）；
//   一進場就是第一人稱（70_flow.js start ⇒ bldEnter）。開砲、轉舵那些鍵在建造時不作用（71_input.js keydown 只放 P、O、C 與第一人稱、建造的鍵）。
// 擺放（第一期：物品 ＝ 設定檔 furniture 那幾樣；⛔ 雕刻作品本來的模型、格子方塊的拆和加還不做 —— 現有的資料都不支援）：
//   · 對準：從眼睛沿視線在船的格子裡打一條射線（VK.raycast，最遠 BLD_REACH 格），打到的那一點往回退一點、往下找站得住的那一格 ＝ 地板；
//     先看它在哪一間艙房的格子上（hullRooms／roomGrid：地板那一層、0.5 m 一格），再看哪一層砲甲板（hullDeckKit／deckGrid）⇒ 第幾格。
//   · 放（右鍵、V、面板的 ✔）：物品擺在準心那一格的中間；能不能擺照 placeOk（擋門口、擋砲班、重疊、地面不平、圍住別的……）。空著的艙房放一張床 ⇒ 那一間變成醫療艙。
//   · 拆（左鍵、X、面板的 ✖）：準心那一格上的那一件。轉（R、⟳）：90°。碰撞（M、🚶／🚪／🕊）：一般 → 穿牆 → 浮空 循環（81_fps.js fpMode）。
//   · 改完 ⇒ 寫進 SHIP_ROOMS、存檔、整艘照新擺法重建（reset：單艘約 0.1 秒，量過）⇒ 第一人稱留在原地、原本的朝向。
//   · 預覽：對到的地方畫一個框（綠 ＝ 可以放、紅 ＝ 不行、橘 ＝ 要拆的那一件；60_render.js 跟 ?rooms=1 的艙房外框同一套線，穿牆看得到）；
//     每一間艙房的外框（穿牆）＝ 設定「視角」那一排的「📐 艙房外框」BLD.lines，預設關（Tim 2026-10-16「房間透視線要可以開關(預設關閉)」）。
// 介面（template.html #bldUI，#stage.bld 才顯示）：下方快捷欄（1–9 選、照分類排）＋ 📦 目錄（B：分類分頁、每一樣的大小與用途）＋ 準心上方一行說明（對到哪裡、能不能放、為什麼）。
// 只在畫面這一層跑（90_main.js frame）：⛔ 不抽 rnd()；別的玩法 BLD.on 是 false ⇒ 什麼都不做（戰局逐位元組相同）。
var BLD = { on: false, lines: false, it: null, r: 0, tgt: null, key: '', cat: 'all', open: false, msg: '', msgT: 0 };
var BLD_REACH = 60;                                                  // 6 m 內的地板才擺得到
var BLD_CAT = [
  { id: 'med', name: '醫療', em: '🏥', has: function (f) { return f.type === 'medical'; } },
  { id: 'pump', name: '抽水', em: '💧', has: function (f) { return f.role === 'pump'; } },
  { id: 'powder', name: '火藥', em: '🧨', has: function (f) { return f.role === 'powder'; } },
  { id: 'misc', name: '其他', em: '📦', has: function () { return true; } }
];
var BLD_EM = { bed: '🛏', table: '🩺', medkit: '💊', pump: '🚰', spump: '♨', keg: '🛢', bench: '🪚' };   // 設定檔沒有圖示 ⇒ 這裡給；沒列的 ⇒ 📦
function bldEm(it) { return BLD_EM[it] || '📦'; }
function bldCat(it) { var f = FURN[it]; for (var i = 0; i < BLD_CAT.length; i++) if (BLD_CAT[i].has(f)) return BLD_CAT[i].id; return 'misc'; }
/** 快捷欄的順序：照分類（醫療 → 抽水 → 火藥 → 其他），同一類照設定檔的順序。 */
function bldList() {
  var ks = Object.keys(FURN);
  return BLD_CAT.reduce(function (a, c) { return a.concat(ks.filter(function (k) { return bldCat(k) === c.id; })); }, []);
}
function bldNote(it) { var f = FURN[it], b = f.buff || {}; return f.role === 'powder' ? '取用點（一處三桶）' : f.role === 'bench' ? '木匠 ' + furnStaff(it, 'carpenter') + ' 位' : f.role === 'loft' ? '帆匠 ' + furnStaff(it, 'sailmaker') + ' 位' : f.role === 'pump' ? '抽水 ' + f.tpm + ' 噸／分' + (f.power === 'steam' ? '、靠鍋爐' : '') : f.hold ? '躺 ' + f.hold + ' 人' : b.heal ? '治療速度 +' + Math.round(b.heal * 100) + '%' : ''; }
function bldRoomName(r) { return (r.deck ? r.deck.name + ' ' : '') + r.name.split('/').slice(-2).join(' ').replace('艙房-鏡像', '左').replace('艙房', '右'); }
/** 開局（70_flow.js start，reset 之後）：建造玩法 ⇒ 進第一人稱、顯示建造介面；別的玩法 ⇒ 收起來。 */
function bldEnter() {
  BLD.on = modeRule('build'); BLD.key = ''; BLD.open = false;
  if (BLD.on) { if (!BLD.it) BLD.it = bldList()[0] || null; if (!fpOnMine()) fpSet(true, true); note(SHIPS[PLAYER_I], '建造：準心對著甲板 —— 右鍵（或 ✔）放、左鍵（或 ✖）拆、R 轉 90°、1–9 選物品、B 目錄'); }
  bldUI();
}
/** 每一格畫面（90_main.js frame，fpFrame 之後）：準心對到哪裡、預覽框、說明。 */
function bldFrame() {
  if (!BLD.on) return;
  $('stage').classList.toggle('bld', BLD.on && FP.on);
  var tg = FP.on && !FP.fol && FP.sh ? bldAim() : null, R = tg ? bldTry(tg, false) : null;
  BLD.tgt = tg;
  var key = tg ? [tg.name, tg.i, tg.j, tg.z, BLD.it, BLD.r, R.why, R.del ? R.del.x + ',' + R.del.y : ''].join('|') : '';
  if (key !== BLD.key) { BLD.key = key; bldLines(tg, R); }
  bldInfo(tg, R);
}
/** 準心對到的地板：{ kind:'room'|'deck'|null, name, label, G, i, j, z, … }；什麼都沒打到（看天空、太遠）⇒ null。 */
function bldAim() {
  var sh = FP.sh, g = sh.grid, c = FP.c, cp = Math.cos(FP.pitch);
  var o = [c.pos[0], c.pos[1], FP.ez === null ? c.pos[2] + FP_EYE : FP.ez], d = [Math.cos(FP.yaw) * cp, Math.sin(FP.yaw) * cp, Math.sin(FP.pitch)];
  var h = VK.raycast(g, o, d, BLD_REACH); if (!h) return null;
  var t = Math.max(0, h.t - 0.3), x = Math.floor(o[0] + d[0] * t), y = Math.floor(o[1] + d[1] * t), z0 = Math.floor(o[2] + d[2] * t), z = -1;
  for (var dz = 0; dz < 30 && z < 0; dz++) if (standZ(g, x, y, z0 - dz, z0 - dz, 1) >= 0) z = z0 - dz;   // 打到牆 ⇒ 往下找牆腳的地板
  return z < 0 ? null : bldWhere(sh.T, x, y, z);
}
function bldWhere(T, x, y, z) {
  var R = hullRooms(T), n, G, i, j;
  for (n = 0; n < R.length; n++) {
    G = roomGrid(T, R[n]); if (Math.abs(z - G.z) > 1) continue;
    i = Math.floor((x - G.x0) / ROOM_TILE); j = Math.floor((y - G.y0) / ROOM_TILE);
    if (i >= 0 && j >= 0 && i < G.nx && j < G.ny) return { kind: 'room', r: R[n], name: R[n].name, label: bldRoomName(R[n]), G: G, i: i, j: j, z: G.z, x: x, y: y };
  }
  var K = hullDeckKit(T).decks;
  for (n = 0; n < K.length; n++) {
    G = deckGrid(T, K[n]); i = Math.floor((x - G.x0) / ROOM_TILE); j = Math.floor((y - G.y0) / ROOM_TILE);
    if (i < 0 || j < 0 || i >= G.nx || j >= G.ny) continue;
    var zt = G.zt[i + j * G.nx]; if (zt < 0 || Math.abs(zt - z) > 2) continue;
    return { kind: 'deck', D: K[n], name: K[n].id, label: K[n].name, G: G, i: i, j: j, z: zt, x: x, y: y };
  }
  return { kind: null, name: '', label: '', i: 0, j: 0, z: z, x: x, y: y };
}
/** 那一間（或那一層甲板）現在的擺法與實際擺上的物品：{ type, items }（type null ＝ 空著的艙房）。 */
function bldPlan(tg) {
  var T = FP.sh.T;
  if (tg.kind === 'room') { var pl = roomPlan(T.id, tg.name); return { type: pl ? pl.type : null, items: roomItems(T, tg.r, pl).items }; }
  return { type: 'deck', items: deckItems(T, tg.D, deckPlan(T.id, tg.name)).items };
}
function bldHit(items, i, j) { return items.filter(function (q) { var t = itemTiles(q.it, q.r); return i >= q.x && i < q.x + t[0] && j >= q.y && j < q.y + t[1]; })[0] || null; }
/** 試著放（del ＝ 拆）：{ p（要放的那一件）, del（要拆的那一件）, type, cur（複製出來的現有清單）, why（不行的原因；'' ＝ 可以）}。 */
function bldTry(tg, del) {
  if (!tg.kind) return { why: '這裡不是艙房也不是砲甲板' };
  var P = bldPlan(tg), cur = P.items.map(function (q) { return { it: q.it, x: q.x, y: q.y, r: q.r }; }), hit = bldHit(cur, tg.i, tg.j);
  if (del) return hit ? { del: hit, cur: cur, type: P.type, why: '' } : { why: '這格沒有物品', cur: cur, type: P.type };
  var f = FURN[BLD.it]; if (!f) return { why: '先在快捷欄選一樣物品', del: hit };
  var type = P.type || (tg.kind === 'room' && f.type !== 'deck' ? f.type : null);
  if (!type) return { why: f.name + '只能擺在砲甲板', del: hit };
  var t = itemTiles(BLD.it, BLD.r), p = { it: BLD.it, x: tg.i - Math.floor((t[0] - 1) / 2), y: tg.j - Math.floor((t[1] - 1) / 2), r: BLD.r };
  if (hit) return { p: p, type: type, cur: cur, del: hit, why: '這格已經有' + FURN[hit.it].name };
  return { p: p, type: type, cur: cur, why: placeOk(tg.G, type, cur, p) };
}
/** 放／拆（滑鼠、鍵盤、面板都走這裡）。 */
function bldDo(del) {
  if (!BLD.on || !FP.on || PAUSED || !BLD.tgt) { if (BLD.on && FP.on && !BLD.tgt) bldMsg('準心沒對到甲板'); return; }
  var tg = BLD.tgt, R = bldTry(tg, del), was = tg.kind === 'room' && !bldPlan(tg).type;   // 空著的艙房（改之前先看：⛔ 改完再看 ⇒ 已經有類型了）
  if (del) { if (!R.del) { bldMsg(R.why); return; } R.cur.splice(R.cur.indexOf(R.del), 1); bldSet(tg, R.type, R.cur, '拿掉了' + FURN[R.del.it].name); }
  else { if (R.why) { bldMsg('放不下：' + R.why); return; } R.cur.push(R.p); bldSet(tg, R.type, R.cur, '擺上' + FURN[R.p.it].name + (was ? '（這一間變成' + ROOM_FN[R.type].name + '）' : '')); }
}
function bldSet(tg, type, items, msg) {
  var id = FP.sh.T.id; (SHIP_ROOMS[id] = SHIP_ROOMS[id] || {})[tg.name] = { type: type, items: items };
  if (typeof prefsSave === 'function') prefsSave();
  bldRebuild(); bldMsg(msg);
}
/** 照新擺法整艘重建（reset ⇒ 只生我方第一艘）⇒ 第一人稱回到原地、原本的朝向。 */
function bldRebuild() {
  var s = { pos: FP.c.pos.slice(), yaw: FP.yaw, pitch: FP.pitch };
  reset(); fpSet(true, true);
  if (FP.on) { FP.c.pos = s.pos; FP.yaw = s.yaw; FP.pitch = s.pitch; FP.ez = null; FP.jz = FP.jv = 0; FP.v = [0, 0]; }
  BLD.key = '';
}
function bldMsg(t) { BLD.msg = t || ''; BLD.msgT = performance.now(); }
/** 預覽框（船的格座標的線；60_render.js 畫）：要放的那一件的外框（綠／紅）、要拆的那一件（橘）、準心那一格（白）。 */
function bldLines(tg, R) {
  var sh = FP.sh; if (!sh) return;
  var L = [];
  function box(a, b, c) {
    var P = []; for (var i = 0; i < 8; i++) P.push([i & 1 ? b[0] : a[0], i & 2 ? b[1] : a[1], i & 4 ? b[2] : a[2]]);
    [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(function (e) { L.push(P[e[0]][0], P[e[0]][1], P[e[0]][2], c[0], c[1], c[2], P[e[1]][0], P[e[1]][1], P[e[1]][2], c[0], c[1], c[2]); });
  }
  function itemBox(G, q, z, c) { var t = itemTiles(q.it, q.r), x0 = G.x0 + q.x * ROOM_TILE, y0 = G.y0 + q.y * ROOM_TILE; box([x0, y0, z + 0.05], [x0 + t[0] * ROOM_TILE, y0 + t[1] * ROOM_TILE, z + FURN[q.it].size[2]], c); }
  if (tg && tg.kind) {
    var x0 = tg.G.x0 + tg.i * ROOM_TILE, y0 = tg.G.y0 + tg.j * ROOM_TILE; box([x0, y0, tg.z + 0.05], [x0 + ROOM_TILE, y0 + ROOM_TILE, tg.z + 0.3], [1, 1, 1]);
    if (R && R.del && (R.why || !R.p)) itemBox(tg.G, R.del, tg.z, [1, 0.55, 0.15]);
    if (R && R.p) itemBox(tg.G, R.p, tg.z, R.why ? [1, 0.3, 0.25] : [0.45, 1, 0.5]);
  }
  sh.bldLines = upload(sh.bldLines, new Float32Array(L), 6, [[0, 3, 0], [2, 3, 3]]);
}
/** 準心上方一行：對到哪裡、能不能放；剛放／剛拆的訊息留 2.5 秒。 */
function bldInfo(tg, R) {
  var el = $('bldInfo'); if (!el) return;
  var f = FURN[BLD.it], s;
  if (BLD.msg && performance.now() - BLD.msgT < 2500) s = BLD.msg;
  else if (!tg) s = '準心對著甲板';
  else if (!tg.kind) s = R.why;
  else s = tg.label + '：' + (R.why ? (R.del && !R.p ? '' : '放不下：') + R.why : '可以擺' + f.name) + (R.del ? '（左鍵拆' + FURN[R.del.it].name + '）' : '');
  if (el.textContent !== s) el.textContent = s;
}
/** 介面：快捷欄（照分類、分類之間空一點）＋ 目錄。開局、選物品、轉向時重畫。 */
function bldUI() {
  var bar = $('bldBar'); if (!bar) return;
  $('stage').classList.toggle('bld', BLD.on && FP.on);
  var L = bldList(), last = '';
  bar.innerHTML = L.map(function (it, n) {
    var c = bldCat(it), gap = last && c !== last ? ' gap' : ''; last = c;
    return '<span class="kb hb bslot' + gap + (it === BLD.it ? ' on' : '') + '" data-it="' + it + '" title="' + FURN[it].name + (n < 9 ? '（' + keyName('bSlot' + (n + 1)) + '）' : '') + bldNote(it) + '"><b>' + (n < 9 ? keyName('bSlot' + (n + 1)) : '') + '</b><i class="em">' + bldEm(it) + '</i></span>';
  }).join('') + '<span class="kb hb bslot gap" id="bldCatB" title="目錄（' + keyName('bCat') + '）"><b>' + keyName('bCat') + '</b><i class="em">📦</i></span>';
  [].forEach.call(bar.querySelectorAll('[data-it]'), function (b) { b.onclick = function () { BLD.it = b.dataset.it; bldUI(); }; });
  $('bldCatB').onclick = function () { bldCatOpen(!BLD.open); };
  $('bldRot').querySelector('.em').textContent = BLD.r ? '⟲' : '⟳';
  var cat = $('bldCat'); cat.style.display = BLD.open && BLD.on ? '' : 'none';
  if (!BLD.open) return;
  var tabs = [{ id: 'all', name: '全部', em: '🗂' }].concat(BLD_CAT.filter(function (c) { return L.some(function (it) { return bldCat(it) === c.id; }); }));
  $('bldTabs').innerHTML = tabs.map(function (c) { return '<button data-cat="' + c.id + '"' + (BLD.cat === c.id ? ' class="on"' : '') + '>' + c.em + ' ' + c.name + '</button>'; }).join('');
  [].forEach.call($('bldTabs').querySelectorAll('button'), function (b) { b.onclick = function () { BLD.cat = b.dataset.cat; bldUI(); }; });
  $('bldGrid').innerHTML = L.filter(function (it) { return BLD.cat === 'all' || bldCat(it) === BLD.cat; }).map(function (it) {
    var f = FURN[it], n = L.indexOf(it) + 1;
    return '<button class="bcard' + (it === BLD.it ? ' on' : '') + '" data-it="' + it + '"><span class="bem">' + bldEm(it) + '</span><b>' + f.name + '</b><small>' + (f.size[0] * S).toFixed(1) + '×' + (f.size[1] * S).toFixed(1) + ' m・' + (f.type === 'deck' ? '砲甲板' : (ROOM_FN[f.type] || {}).name || f.type) + '</small><small>' + bldNote(it) + '</small><i>' + n + '</i></button>';
  }).join('');
  [].forEach.call($('bldGrid').querySelectorAll('[data-it]'), function (b) { b.onclick = function () { BLD.it = b.dataset.it; bldCatOpen(false); }; });
}
/** 目錄開關：開 ⇒ 放開滑鼠（要點卡片；跟 Minecraft 開物品欄一樣，遊戲不停）。 */
function bldCatOpen(on) { BLD.open = !!on; if (on) fpUnlock(); bldUI(); }
/** 鍵盤（71_input.js keydown／keyup，第一人稱的鍵之後）：建造玩法吃掉 ⇒ true。 */
function bldKey(k, down) {
  if (!BLD.on) return false;
  var L = bldList(), a = keyAct('build', k), n = /^bSlot\d$/.test(a) ? +a.slice(5) : 0;   // 建造的鍵位（66_keys.js）
  if (n) { if (down && L[n - 1]) { BLD.it = L[n - 1]; bldUI(); } return true; }
  if (a === 'bRot') { if (down) { BLD.r = 1 - BLD.r; bldUI(); } return true; }
  if (a === 'bCat') { if (down) bldCatOpen(!BLD.open); return true; }
  if (a === 'bDel') { if (down) bldDo(true); return true; }
  if (a === 'bPut') { if (down) bldDo(false); return true; }
  if (a === 'bMode') { if (down) fpMode((FP.mode + 1) % 3); return true; }   // 碰撞循環：一般 → 穿牆 → 浮空（Tim 2026-10-16「建造模式加一個按鈕 可以循環切換 一般 穿牆 浮空模式吧」）
  return false;
}
// 滑鼠（只在滑鼠模式＝抓住滑鼠時，跟 Minecraft 一樣）：左鍵拆、右鍵放 ⇒ 71_ctrl.js 的 build 控制器（mouse）。沒抓住時左鍵照舊是「抓住滑鼠」（fp 控制器）。
$('bldPut').onclick = function () { bldDo(false); };
$('bldDel').onclick = function () { bldDo(true); };
$('bldRot').onclick = function () { BLD.r = 1 - BLD.r; bldUI(); };
$('bldMode').onclick = function () { fpMode((FP.mode + 1) % 3); };
$('bldCatX').onclick = function () { bldCatOpen(false); };
$('bldLinesT').onclick = function () { BLD.lines = !BLD.lines; $('bldLinesT').classList.toggle('on', BLD.lines); };   // 艙房外框（Tim 2026-10-16「房間透視線要可以開關(預設關閉)」）：開關不關設定面板；跨場留著
