// ───────────────────────── 船型（一種船一份；兩艘同型就共用） ─────────────────────────
// 船型 T：內嵌的 .vxk（<script type="application/x-vxk" id="…">）解碼之後的一切 —— 格子（T.base；拿掉砲帶的裝甲 ⇒ 船殼 T.hullG，24_armor.js）、合併過的網格（T.pristine）、
//   繩與帆與模型（T.rig）、模型的網格（T.meshes）、桅（T.masts）、帆的布模板（T.cloth）、水線（T.wl0／wl1／bowHalf）、
//   海面遮罩（T.hullHB）、浮力表（T.hyd／disp），以及從 header 來的中線、外框、設計水線（T.cx／cy／hx0／hx1／zw／sz）。
// 每艘船 sh.T 指向它的船型；⛔ 船型是共用的、不能改（被打掉的格子在 sh.grid：Grid.share 寫的時候才複製那一塊）。
// 只在被選到時才解碼（Tim 2026-10-12：預設只載憲法號，其他船選了才載）—— 資料本身還是內嵌在同一個 HTML 裡
//   （畫廊的 iframe 只開 allow-scripts、讀不了旁邊的檔，展品也要零外部依賴），省的是解碼與網格化的時間和記憶體。
// 公尺／格（S）每種船都要一樣（模擬裡的距離、速度、碰撞都用同一個 S）；不一樣就不載、說為什麼。
// zw0：作品沒有 `kind=ship, waterline_z` 的 meta 時用的設計水線（格的 z）。餘燼號 71 ＝ basecamp 的作品筆記（basecamp-ember-01m/todo.md「水線抬高 z 63 → 71」，
//   Tim：船變高了水線也往上）。⛔ 沒有這一格 ⇒ 用憲法號的 63，多出來那層砲甲板的排水沒算進去（排水量 2,522 噸，跟憲法號 2,154 差不多 —— Tim 2026-10-13 發現）。meta 補上之後以 meta 為準。
// geo：船型的高度（格的 z）與範圍 —— 這些本來寫死成憲法號的數字；沒給的照 GEO0（＝ 原本的數字 ⇒ 憲法號、餘燼號照舊）。
//   夜隼號（summit，2026-10-13 接）只有憲法號一半高：水線 15、主甲板 z 30、後甲板 45、桅頂平台 126（前）／136（主）、桅頂 272 ⇒ 照她的作品量的。
//   桅不在這裡：照帆桁的 meta 判斷（10_ship.js findMasts）。
// 值住在 config/game.json（TASK-0542）：geo0 ＝ 預設（本來寫死成憲法號的數字），每艘船的 geo 只寫跟它不一樣的鍵。各鍵：
//   spar  露天甲板站人的高度 [z0, z1]（陸戰隊、軍官、舵手）；null ⇒ 照 carronade 推、沒有 carronade ⇒ 100–109
//   marines 陸戰隊沿舷牆站的範圍：船尾外框 + [0] 到船頭外框 − [1]；center 船的中心高度（鏡頭看哪裡）；aim 沒有目標時瞄的高度（21_gunnery.js）
//   aimZ 瞄準點的高度夾在這段裡；deckAim 砲長「砲甲板」模式瞄的高度（51_captain.js）；rigAim 砲長「桅」模式瞄的高度
// 船員配置（crew0 ＝ 預設，每艘船的 crew 只寫不一樣的；40_crew.js、23_powder.js、42_hands.js）：
//   officers 軍官（0–8，照順序是船長、大副、二副、三副，再來是見習軍官）、helm 舵手（0–4）、marines 陸戰隊最多幾個、marineGap 陸戰隊沿舷牆每幾格一個、
//   top 每根桅的桅頂水手、monkeys 送藥手（每一對砲幾個：0 ＝ 沒有、1、2）、hands 預備水手人數（沒寫 ⇒ 預備水手的基準人數 HANDS × handsK；夜隼號 ¼）、
//   guns 砲班滿編 { 砲種: 人 }（沒寫的砲種 ⇒ 砲種表 10_ship.js GUNS 的 crew）、shelter 船員避開露天甲板（0／1；42_hands.js shelterLv：莫尼特號 1）、
//   sailmaker 帆匠的全船上限（1–20；人數照設施配員 ＝ 帆布櫃每件 furniture.loft.staff.sailmaker 位，每船至少一件；47_sailmaker.js）、
//   surgeon 船醫的全船上限（0–60；人數照設施配員 ＝ 走得到的病床每張 furniture.bed.staff.surgeon 位，36_rooms.js staffSlots；站在醫療艙裡，有醫療艙才上船；44_medic.js medSurgeons）、carpenter 木匠的全船上限（1–20：每船至少一位（Tim 2026-10-17「每船至少配一台(跟一名木工)」）；人數照設施配員 ＝ 木工台每張 furniture.bench.staff.carpenter 位，每船至少 1 張；修梯子、補甲板破洞；46_carpenter.js）、
//   navigator 航海士、quartermaster 軍需官（0–1；TASK-0825，39_duty.js：舵輪旁／彈藥庫取用點旁，在崗 ⇒ 航行性能／送藥加成；0 ＝ 沒有）、
//   cook 廚師的全船上限（0–4；TASK-0720：人數 ＝ 船上 kind=galley 的爐灶每座 galley.cooks 位，有廚房的船才上船、站在爐灶旁做飯；0 ＝ 這艘不開廚房；45_galley.js galleyCooks）。
// 船隻清單 ＝ config/game.json 的 ships（el ＝ 內嵌 .vxk 的 id；匯入新船、重新匯入走 admin.py）；選單只列 HTML 裡真的有內嵌資料的那幾艘。
var GEO0 = CFG.geo0, CREW0 = CFG.crew0;
// 船隻配置頁（TASK-0570；Tim 2026-10-14：一型一份、要存檔、預設在後台管理頁設）：玩家改過的船員配置 SHIP_CREW（id → 改過的那幾項；69_prefs.js 存），
//   跟船隻設定（SHIP_CFG，04_state.js）一起在主選單「船隻配置…」那一頁編（71_input.js）。
//   每艘船開戰時用的 ＝ crew0 ← 那艘船的 crew（後台頁）← SHIP_CREW（shipCrew；40_crew.js makeCrew 存進 sh.cw）。
var CREW_ITEMS = [{ k: 'officers', name: '軍官', lim: [0, 8] }, { k: 'helm', name: '舵手', lim: [0, 4] }, { k: 'marines', name: '陸戰隊', lim: [0, 40] },
  { k: 'top', name: '桅頂水手', lim: [0, 8] }, { k: 'monkeys', name: '送藥手', lim: [0, 2] }, { k: 'hands', name: '預備水手', lim: [0, 120] },
  { k: 'shelter', name: '避開露天甲板', lim: [0, 1] }, { k: 'surgeon', name: '船醫上限', lim: [0, 60] }, { k: 'carpenter', name: '木匠上限', lim: [1, 20] },
  { k: 'sailmaker', name: '帆匠上限', lim: [1, 20] }, { k: 'cook', name: '廚師上限', lim: [0, 4] }, { k: 'navigator', name: '航海士', lim: [0, 1] }, { k: 'quartermaster', name: '軍需官', lim: [0, 1] }];   // 航海士、軍需官（TASK-0825）：範圍同 admin.py CREW   // 廚師（TASK-0720）：範圍同 admin.py CREW['cook']
var GUN_CREW_MAX = 8;                                                   // 砲旁的站位只有 8 個（40_crew.js spots）；最少 ＝ 砲種表的 min（少於它那門砲永遠開不了）
var OFFICER_RANKS = ['船長', '大副', '二副', '三副'];                    // 照順序；第五個起 ＝ 見習軍官
var SHIP_CREW = {};
var CREW_SEEN = {};                                                     // id → 這一型最近一次上船的結果 { n 人數, short 站不下的, sig 那時的配置 }（40_crew.js；船隻配置頁照實列）
function crewSig(cw) { return JSON.stringify([CREW_ITEMS.map(function (it) { return cw[it.k]; }), Object.keys(GUNS).map(function (t) { return gunCrew(cw, t); })]); }
function officerRank(i) { return OFFICER_RANKS[i] || '見習軍官'; }
/** 那一型的預設（crew0 ＋ 後台頁寫在那艘船的 crew）。 */
function crewDefault(id) {
  var h = HULL_KNOWN.filter(function (x) { return x.id === id; })[0], d = Object.assign({}, CREW0, h && h.crew);
  if (d.hands === undefined) d.hands = Math.round(HANDS * (d.handsK === undefined ? 1 : d.handsK));
  d.guns = Object.assign({}, d.guns);
  return d;
}
/** 那一型實際用的（預設 ← 玩家改的；網址 ?hands= 蓋過每一型的預備水手）。 */
function shipCrew(id) {
  var c = crewDefault(id), p = SHIP_CREW[id];
  if (p) {
    CREW_ITEMS.forEach(function (it) { if (p[it.k] !== undefined && !(it.k === 'hands' && Q.has('hands'))) c[it.k] = p[it.k]; });
    if (p.guns) Object.keys(p.guns).forEach(function (t) { c.guns[t] = p.guns[t]; });
  }
  return c;
}
function gunCrew(cw, type) { var n = cw.guns && cw.guns[type]; return n === undefined ? GUNS[type].crew : n; }
// 艦名（TASK-0552；Tim 2026-10-14：參考歷史同級艦）：ships[].names ＝ 那一型的艦名池（第一個 ＝ 原名；沒給 ⇒ 只有原名），同一場照編成的順序發（52_fleet.js fleetNames）；
//   池子用完拿公共池 names_pub，再用完 ⇒ 原名＋序號。憲法號：同級的 44 砲巡防艦（合眾國號、總統號），再來是照它們的設計造的 44 砲巡防艦；公共池：同時代美國海軍的巡防艦。
//   餘燼號、夜隼號是 basecamp、summit 的船：她們給艦名池之前只有原名。
var HULL_KNOWN = CFG.ships.map(function (s) { var h = { id: s.id, el: s.el, name: s.name, geo: s.geo, crew: s.crew, rooms: s.rooms, lamps: s.lamps, flags: s.flags, names: s.names && s.names.length ? s.names : [s.name] }; if (s.zw0) h.zw0 = s.zw0; if (s.material) h.material = s.material; if (s.matMap) h.matMap = s.matMap; if (s.author) h.author = s.author; if (s.drive) h.drive = s.drive; if (s.fireEngine === false) h.fireEngine = false; if (s.theme) h.theme = s.theme; if (s.variant_of) h.variant_of = s.variant_of; if (s.fit) h.fit = s.fit; return h; });   // material：全船預設材質（05_material.js）；author：建造者（admin.py 匯入時從 .vxk 檔頭 owner 記；船隻配置頁顯示）
var SHIP_NAMES_PUB = CFG.names_pub || [];
var HULL_LIST = HULL_KNOWN.filter(function (h) { return VK.hasEmbedded(h.el); });   // 內嵌的、或拆檔成品清單上有的（voxelkit.js embeddedBytes）
var HULL_DEF = (HULL_LIST[0] || HULL_KNOWN[0]).id;                      // 預設的船：清單裡第一艘有內嵌資料的
var HULLS = {}, HULLT = {};                                             // id → 載入中的 Promise ／ 載好的船型
// 裝飾（TASK-0682；Tim 2026-10-17：「裝飾移除是在船隻載入時就不載入裝飾」「可以隱藏的裝飾都不算重量」）：雕刻模型 meta deco=1。
//   載入船型時一律從 rig.models 拿掉（⇒ 不算重量、不被打、不掉下來、不抽 rnd()：開或關戰局逐項相同，07_gfx.js 的規矩），一律收進 T.decos、網格一律建 ——
//   畫不畫是畫面那一格的事（60_render.js drawModels 每格看 GFX.deco；砲門蓋板不看「裝飾」：每艘、每個畫質都畫，「砲門的開關演出」只管演不演，62_ports.js portOn；render 管線大修 S14）⇒ 切畫質立刻生效、船不重新載入。
//   （Tim 2026-10-20：「一樣載入，只是低畫質不顯示」—— 之前關著就不建網格、切了要丟掉船型重新載入，那條路兩次害開場「載入失敗」；拿破崙號多的只有 5 份網格、3% 三角形。）
//   規格表標 deco 的 kind（config/meta_kinds.json；TASK-0719 砲門蓋板 kind=portlid，Tim 2026-10-19：「炮門屬於裝飾物」；10-21「炮門在所有畫質下都預設顯示」⇒ 畫不畫另外看 portOn）本身就是裝飾 ⇒ meta 不用另寫 deco=1
//   （⛔ 照 meta deco=1：雕刻端漏寫一片 ⇒ 那片變成模擬模型（擋彈、抽亂數），光榮號的戰局悄悄跟著畫質變）。
function isDeco(m) { var v = m && m.meta && m.meta.deco; if (m && m.meta && kindProp(m.meta.kind, 'deco')) return true; return v !== undefined && v !== null && v !== '' && v !== '0' && v !== 0 && v !== false; }
/** 換色的擺放（TASK-0584；buildHull 一開頭、decoSplit 之前）：雕刻端把「同一件零件換個配色」匯出成共用同一份網格、擺放上多一欄 mats
 *  （跟網格的 mats 一一對應、同長度：畫這個擺放時拿它代替網格的 mats）⇒ .vxk 只存一份頂點與三角形。
 *  這裡把它展開成一份新的網格（頂點、三角形、tmat 照參照共用同一個陣列，只換 mats）、擺放改指它 ⇒ 之後讀網格的（畫、碎片、俯視圖、重量）都不用知道有換色這回事。
 *  同一份網格＋同一組 mats 的擺放共用一份。⛔ 長度跟網格的 mats 對不上 ⇒ 丟錯（不猜哪一個對到哪一個，畫成原色會看不出來）。回展開了幾個擺放。 */
function modelMats(h) {
  var ms = (h.rig && h.rig.models) || [], M = (h.rig && h.rig.meshes) || [], made = {}, n = 0;
  ms.forEach(function (m) {
    if (!m.mats) return;
    var src = M[m.mesh];
    if (!src || !src.mats || src.mats.length !== m.mats.length) throw new Error('模型 ' + m.name + ' 的換色 mats 有 ' + m.mats.length + ' 個、網格 ' + m.mesh + ' 有 ' + (src && src.mats ? src.mats.length : '（沒有）') + ' 個 —— 對不上');
    var key = m.mesh + '|' + JSON.stringify(m.mats);
    if (made[key] === undefined) { made[key] = M.length; M.push({ verts: src.verts, tris: src.tris, tmat: src.tmat, mats: m.mats }); }
    m.mesh = made[key]; delete m.mats; n++;
  });
  return n;
}
/** 載入時拆出裝飾（buildHull 一開頭）：h.rig.models 只留不是裝飾的；回 { decos：裝飾件, n：幾件, skip：模型、裝飾都沒用到的網格編號（不建、不上 GPU） }。 */
function decoSplit(h) {
  var ms = (h.rig && h.rig.models) || [], keep = [], deco = [], used = {}, skip = {};
  ms.forEach(function (m) { (isDeco(m) ? deco : keep).push(m); });
  if (!deco.length) return { decos: [], n: 0, skip: null };
  h.rig.models = keep;
  ms.forEach(function (m) { used[m.mesh] = 1; });
  (h.rig.meshes || []).forEach(function (_, k) { if (!used[k]) skip[k] = 1; });
  return { decos: deco, n: deco.length, skip: skip };                   // decos 匯入檢查也讀（meta、lid_of；75_shipcheck.js）
}
// 艦隊編成（TASK-0537）：FLEET_SET[0] ＝ 我方（第一艘是我艦）、[1] ＝ 敵方，各是一串船型；每一邊至少 1 艘、合計最多 FLEET_MAX（同時在場 FIELD_N 艘，其他的候補，52_fleet.js）。
//   主選單編；網址 ?blue=我艦,友艦…&red=敵艦,…；舊的 ?ship=我艦,敵艦 照舊（＝ 一邊一艘；?blue／?red 給了那一邊照它）。
var FLEET_SET = [[HULL_DEF], [HULL_DEF]];                                // 預設 ＝ 清單第一艘（HULL_DEF）
if (Q.has('ship')) Q.get('ship').split(',').forEach(function (w, i) { if (i < 2 && hullInfo(w)) FLEET_SET[i] = [w]; });
['blue', 'red'].forEach(function (k, i) { if (!Q.has(k)) return; var L = Q.get(k).split(',').filter(hullInfo); if (L.length) FLEET_SET[i] = L; });
fleetTrim(FLEET_SET);
/** 合計超過 FLEET_MAX ⇒ 從艘數多的那一邊的尾巴拿掉（一樣多 ⇒ 敵方先拿）；每一邊至少留 1 艘。 */
function fleetTrim(F) { while (F[0].length + F[1].length > FLEET_MAX) { var s = F[0].length > F[1].length ? 0 : 1; if (F[s].length <= 1) break; F[s].pop(); } return F; }
/** 編成裡用到的船型（不重複；我艦那一型第一個）。 */
function fleetHulls() { return FLEET_SET[0].concat(FLEET_SET[1]).filter(function (id, i, a) { return a.indexOf(id) === i; }); }
function myHull() { return FLEET_SET[0][0]; }
function hullInfo(id) { id = hullBase(id); return HULL_LIST.filter(function (h) { return h.id === id; })[0] || null; }   // id 可以是艦隊裡的一項「船型@換裝表」（38_fit.js）
/** 船型（解碼、網格化一次，之後都拿同一份）。分成幾步、每步之間讓出一次（Tim 2026-10-12：進到主選單之後才解析，解析完之前不能開戰、但可以調設定）；
 *  每一步開始時呼叫 hullSay（主選單的開戰鈕寫進度）。 */
function loadHull(id) {
  if (HULLS[id]) return HULLS[id];
  var info = hullInfo(id);
  if (!info) return Promise.reject(new Error('沒有這艘船：' + id));
  var t0 = performance.now(), F = fitOf(id);                              // 換裝表（38_fit.js）：id 是「船型@換裝表」⇒ 照那一份；船型 ⇒ 出廠 ⊕ 玩家存檔
  hullSay(info.name + '：解碼…');
  return (HULLS[id] = yieldUI().then(function () { return Promise.all([VK.loadEmbedded(info.el).then(meshPool).then(function (model) { return fitLoad(model.header, F, info.id).then(function (X) { model.fitExt = X; return model; }); }), cacheGet(info, id, F)]); })   // 解碼與讀快取一起跑（06_cache.js）；換裝要從別艘拿的零件先載好
    .then(function (r) { return buildHull(info, r[0], t0, r[1], id, F); })
    .then(function (T) { HULLT[id] = T; cachePut(T, info); return T; }));
}
/**
 * meta 裡指名別的部件的路徑（TASK-0657 改裝船；Tim：「概念類似 Unity 的 nested prefab」）：原船整艘是改裝船的一條關聯（原船/…）⇒ 原船裡的 meta 互相指名用的還是原船裡的路徑
 * （裝甲 mount=甲板-main/砲塔、鍋爐 funnel=煙囪、彈藥庫 hoist=梯子/turret）。照 nested prefab 的規矩：一個部件（模型）的 meta 字串照它自己那一層往上找 ——
 * 本身就是一條路徑（部件、模型、梯子）⇒ 不動；不是、而「它所在的那幾層＋它」是 ⇒ 換成完整路徑（最近的那一層先）。回：換了幾格。
 * ⛔ 只換「補上前綴才對得上」的字串 ⇒ pos=mid、material=iron 這種永遠不會被當成路徑；沒有巢狀的船一格都不換（對拍逐位元組相同）。
 */
function metaRebase(h) {
  var parts = h.parts || [], models = (h.rig && h.rig.models) || [], P = new Set(), n = 0;
  parts.forEach(function (p) {
    P.add(p.path);
    Object.keys(p.points || {}).forEach(function (k) { var i = k.lastIndexOf('.'); if (i > 0) P.add(p.path + '/' + k.slice(0, i)); });   // 梯子：<部件>/<梯名>（42_hands.js shipLadders）
  });
  models.forEach(function (m) { if (m.name) P.add(m.name); });
  function fix(path, meta) {
    if (!meta || !path || path.indexOf('/') < 0) return;
    var a = path.split('/'), pre = [];
    for (var i = a.length - 1; i >= 1; i--) pre.push(a.slice(0, i).join('/') + '/');
    Object.keys(meta).forEach(function (k) {
      var v = meta[k]; if (k === 'kind' || k === 'id' || k === 'render' || typeof v !== 'string' || !v || P.has(v) || ID_RX.test(v.split('#')[0])) return;   // id 寫法（TASK-0715）不是路徑   // kind 不是路徑（⛔ 以前照改：鳳凰號 kind=capstan 旁邊剛好有模型「主砲甲板/capstan」⇒ kind 變成那條路徑；TASK-0672 規格表檢查量出來的）   // render 也不是（炎羽號的舵輪就叫「露天甲板/wheel」⇒ render=wheel 變成那條路徑、照原本的畫；TASK-0792）
      for (var j = 0; j < pre.length; j++) if (P.has(pre[j] + v)) { meta[k] = pre[j] + v; n++; return; }
    });
  }
  parts.forEach(function (p) { fix(p.path, p.meta); });
  models.forEach(function (m) { fix(m.name, m.meta); });
  return n;
}
/**
 * 物件 id（TASK-0715；造船規格 §12）：每件關聯（部件）、外部模型的 meta id ＝ `<類別>-<序號>`（改裝船自己加的 `<船>.<類別>-<序號>`；admin.py ids 發號、寫回作品）。
 * 指名別的部件一律寫 id、或 `id#固定點`（一條關聯裡有好幾座的：`<梯子關聯的 id>#<梯名>`）；哪些 meta 鍵是指名 ＝ 規格表 refs（config/meta_kinds.json）。
 * 同一件子作品被關聯好幾次（哨兵號兩個彈藥櫃）⇒ 裡面那幾件 id 一樣 ⇒ 照最近一層關聯的 id 分開：`<關聯 id>/<內部 id>`。
 * 回 { by: id ⇒ { what: 'link'｜'model', q, path }, dup: [撞號（分開之後還撞）], none: 沒有 id 的件數 }。
 */
var ID_RX = /^(?:[a-z][a-z0-9_]*\.)?[a-z][a-z0-9_]*-[1-9][0-9]*(?:\/(?:[a-z][a-z0-9_]*\.)?[a-z][a-z0-9_]*-[1-9][0-9]*)*$/;
function idIndex(h) {
  var parts = h.parts || [], models = (h.rig && h.rig.models) || [], L = [], none = 0, pid = {};
  parts.forEach(function (p) { var v = p.meta && p.meta.id; if (v) pid[p.path] = String(v); L.push({ what: 'link', q: p, path: p.path, id: v ? String(v) : '' }); });
  models.forEach(function (m) { var v = m.meta && m.meta.id; L.push({ what: 'model', q: m, path: m.name, id: v ? String(v) : '' }); });
  var n = {}; L.forEach(function (r) { if (r.id) n[r.id] = (n[r.id] || 0) + 1; else none++; });
  function up(path) { var a = path.split('/'); for (var i = a.length - 1; i >= 1; i--) { var pp = a.slice(0, i).join('/'); if (pid[pp]) return pid[pp]; } return ''; }
  var by = {}, dup = [];
  L.forEach(function (r) {
    if (!r.id) return;
    var k = n[r.id] > 1 && up(r.path) ? up(r.path) + '/' + r.id : r.id;
    if (by[k]) dup.push(k + '：' + by[k].path + '、' + r.path); else by[k] = { what: r.what, q: r.q, path: r.path };
  });
  return { by: by, dup: dup, none: none };
}
/** 指名 ⇒ 部件的完整路徑（遊戲各處本來就照路徑比：彈藥庫 hoist 比梯子名、鍋爐 funnel 比煙囪、裝甲 mount 比砲模型）：
 *  `id` ⇒ 那件的路徑；`id#座名` ⇒ `<路徑>/<座名>`（梯子 ＝ 42_hands.js shipLadders 的名字）；不是 id 寫法（舊的路徑寫法）⇒ 原樣（metaRebase 已經補過前綴）；
 *  是 id 寫法卻找不到 ⇒ ''（⛔ 不退回去當路徑比 —— 匯入檢查報 ✗）。 */
function refPath(T, v) {
  if (v === undefined || v === null || v === '') return '';
  v = String(v);
  var i = v.indexOf('#'), id = i < 0 ? v : v.slice(0, i);
  if (!ID_RX.test(id)) return v;
  var r = T.ids && T.ids.by[id];
  return r ? r.path + (i < 0 ? '' : '/' + v.slice(i + 1)) : '';
}
/** 壓縮版的成品（admin.py build 預設；--raw ＝ 原格式；TASK-0583）：header 有 mpool ⇒ rig.meshes 是那艘船自己池子的編號 { pool: i }，照 header.mpool ＝ { q, meshes } 還原。
 *  （拆檔之前全部船共用一個池子 <script id=vxk-meshes>：加一個網格就整份重存、別艘的編號跟著位移 ⇒ repo 變肥；現在一艘一個，見 admin.py「拆檔」。）
 *  池子裡一份 ＝ { v: 不重複的頂點（整數 × q，跟前一點的差值）, t: 三角形的頂點編號（跟前一個的差值）, tmat, mats }；還原成跟原本一樣的三角形（頂點去重過，法線照三角形算 ⇒ 畫出來一樣）。
 *  引用 { pool: i, o: [x, y, z] }：只差起點的網格（同一種砲擺在不同位置）共用一格，o ＝ 這一份自己的起點（整數 × q，換掉差值的第一個頂點 ⇒ 整份平移；TASK-0667）。 */
function meshPool(model) {
  var h = model.header, P = h.mpool; if (!P || !h.rig || !h.rig.meshes) return model;
  var M = {};                                                            // 同一艘船裡同一個引用（同一門砲）只還原一次、共用
  h.meshShape = h.rig.meshes.map(function (m) { return m && m.pool !== undefined ? m.pool : -1; });   // 第幾個形狀（池子的那一格；只差起點的網格同一格）⇒ GPU 那一份共用（62_simview.js buildMeshes）
  h.rig.meshes = h.rig.meshes.map(function (m) { return m && m.pool !== undefined ? meshPoolMesh(P, m.pool, m.o, M) : m; });
  delete h.mpool;                                                        // 還原完就用不到了（不留在船型上佔記憶體）
  return model;
}
function meshPoolMesh(P, i, o, M) {
  var key = o ? i + '@' + o.join(',') : i;
  if (M[key]) return M[key];
  var e = P.meshes[i], q = P.q, v = new Array(e.v.length), t = new Array(e.t.length), x = 0, y = 0, z = 0, k, a = 0;
  if (o && e.v.length) { x = o[0] - e.v[0]; y = o[1] - e.v[1]; z = o[2] - e.v[2]; }   // 起點換成 o（整數，跟原本那一份逐點相同）
  for (k = 0; k < e.v.length; k += 3) { x += e.v[k]; y += e.v[k + 1]; z += e.v[k + 2]; v[k] = x / q; v[k + 1] = y / q; v[k + 2] = z / q; }
  for (k = 0; k < e.t.length; k++) { a += e.t[k]; t[k] = a; }
  return (M[key] = { verts: v, tris: t, tmat: e.tmat, mats: e.mats });
}
/** 讓出一次（MessageChannel：一個新的工作 ⇒ 瀏覽器可以先畫一格、處理點擊）。⛔ 不用 setTimeout：分頁在背景時會被壓到一秒一次。 */
function yieldUI() { return new Promise(function (r) { var ch = new MessageChannel(); ch.port1.onmessage = function () { r(); }; ch.port2.postMessage(0); }); }
/** 船體網格分段建（沒有快取時；buildHull）：跟 VK RegionSet.buildAll 同一個順序、同一份結果（快取照它存），每做滿 8 ms 讓出一次（yieldEach），最後一次上傳。 */
function hullMeshSliced(rs) {
  var g = rs.grid, L = [];
  for (var cz = 0; cz < g.nz; cz++) for (var cy = 0; cy < g.ny; cy++) for (var cx = 0; cx < g.nx; cx++) { var i = g.ci(cx, cy, cz); if (g.tab[i] !== null) L.push([cx, cy, cz, i]); }
  return yieldEach(L, function (c) { rs.meshes.set(c[3], VK.meshChunk(g, c[0], c[1], c[2])); rs.dirtyRegions.add(rs.rkey(c[0], c[1], c[2])); }, 8).then(function () { rs.flush(); });
}
/** 一串步驟一口氣做完：每一步是函式；回陣列 ⇒ 那幾步插在剩下的前面先做（開局：艦隊照每艘展開、makeShip 照段展開）。
 *  分段做（每一步之間讓出一次）見 70_flow.js flowStaged —— 兩條走同一串步驟、同一個順序。 */
function stepsRun(L) { var Q = L.slice(); while (Q.length) { var r = Q.shift()(); if (r) Q = r.concat(Q); } }
/** 一步做不完的迴圈（照步驟走）：f(i) 從 i0 做到 n−1，做滿 ms 毫秒就停、回「接著做」的那一步 ⇒ stepsRun／開戰分段照順序接下去 ＝ 一口氣從頭做到尾。 */
function stepsLoop(i0, n, f, ms) {
  return function loop() {
    var t1 = performance.now() + ms;
    while (i0 < n) { f(i0++); if (performance.now() >= t1) break; }
    return i0 < n ? [loop] : null;
  };
}
/** 格子 G 第 cz 層區塊（16 格高）裡的每一格 cb(x, y, z, 色)：跟 VK Grid.each 同一個順序，只是只走那一層 ⇒ cz 從 0 照順序走完 ＝ G.each（給 stepsLoop 分段走整份格子）。 */
function gridEachZ(G, cz, cb) {
  for (var cy = 0; cy < G.ny; cy++) for (var cx = 0; cx < G.nx; cx++) {
    var c = G.tab[G.ci(cx, cy, cz)]; if (c === null) continue;
    for (var li = 0; li < 4096; li++) if (c[li]) cb(cx * 16 + (li & 15), cy * 16 + ((li >> 4) & 15), cz * 16 + (li >> 8), c[li]);
  }
}
/** 清單 L 一個一個做 f(項, i)，每做滿 ms 毫秒讓出一次 ⇒ Promise（全部做完；f 丟錯 ⇒ reject）。
 *  給載入、畫面用的長工作（城鎮模型的網格…）：Blockside 開在 Blocksail 地球儀的 iframe 裡跟它同一條主執行緒 ⇒ 一段做太久地球儀的動畫就頓住（2026-10-20）。
 *  好幾份同時要做 ⇒ 排成一列、一次只做一份的一段（YIELD_Q）：⛔ 各自讓出 ⇒ 30 份模型各排一個工作，計時器、畫面要等前面 30 段都做完（量到 0.2 s 一頓）。
 *  ⛔ 別拿來分段跑會改戰局的東西：讓出的時候畫面迴圈會走。 */
var YIELD_Q = [], YIELD_ON = false, YIELD_MC = null;
function yieldEach(L, f, ms) {
  return new Promise(function (ok, bad) { YIELD_Q.push({ L: L, f: f, ms: ms, i: 0, ok: ok, bad: bad }); yieldKick(); });
}
function yieldKick() {
  if (YIELD_ON || !YIELD_Q.length) return;
  if (!YIELD_MC) { YIELD_MC = new MessageChannel(); YIELD_MC.port1.onmessage = yieldRun; }
  YIELD_ON = true; YIELD_MC.port2.postMessage(0);
}
/** 一段：排在最前面的那一份做到 ms 毫秒（至少一項）；做完 ⇒ resolve、換下一份。 */
function yieldRun() {
  YIELD_ON = false;
  var J = YIELD_Q[0]; if (!J) return;
  var t1 = performance.now() + J.ms;
  try { while (J.i < J.L.length) { J.f(J.L[J.i], J.i); J.i++; if (performance.now() >= t1) break; } }
  catch (e) { YIELD_Q.shift(); J.bad(e); yieldKick(); return; }
  if (J.i >= J.L.length) { YIELD_Q.shift(); J.ok(); }
  yieldKick();
}
var hullSay = function () {};                                            // 90_main.js 換成寫進度的那支
/** C：快取的記錄（06_cache.js；null ⇒ 全部現場算）。現場算的時候，要存的那幾份另外留在 T.keep，給 cachePut 存。 */
function buildHull(info, model, t0, C, key, F) {
  var h = model.header, t1 = performance.now();                            // 到這裡是解碼（loadEmbedded，跟讀快取一起），之後是網格化
  modelMats(h);                                                            // 換色的擺放（TASK-0584）：展開成自己的網格（共用頂點陣列）⇒ decoSplit 數「沒用到的網格」時看得到它
  var FR = fitApply(h, F || {}, model.fitExt);                            // 換裝（38_fit.js；TASK-0714）：掛點換成零件 ⇒ 之後讀 rig.models 的全部照新的；換裝表是空的 ⇒ 不做事
  var DS = decoSplit(h);                                                   // 裝飾（TASK-0682）：在一切之前拆掉 ⇒ 之後讀 rig.models 的（重量、繩、帆、家具）都看不到它
  h.metaRebased = metaRebase(h);                                           // 改裝船（TASK-0657）：原船裡的 meta 路徑照它所在的那一層往上找（見 metaRebase）
  if (C && (C.voxels !== h.voxels || C.checksum !== h.checksum)) C = null;  // 雙保險：鍵是 .vxk 原文的雜湊，格數與 checksum 也要一樣
  if (S && Math.abs(h.meters_per_voxel - S) > 1e-9) throw new Error(info.name + ' 是 ' + h.meters_per_voxel + ' 公尺一格，跟已經載入的船（' + S + '）不一樣 —— 模擬只吃同一個比例');
  S = h.meters_per_voxel;
  var T = { id: info.id, name: info.name, model: model, h: h, rig: h.rig || { ropes: [], sails: [] },
    sz: h.size[2], cx: (h.bbox[0] + h.bbox[3]) / 2, cy: h.size[1] / 2, hx0: h.bbox[0], hx1: h.bbox[3], zw: hullZW(h, info), geo: Object.assign({}, GEO0, info.geo), lamps: info.lamps || [], crew: Object.assign({}, CREW0, info.crew) };   // 外框：含艏斜桅與後桅帆桁
  T.ids = idIndex(h);                                                      // 物件 id（TASK-0715）：refPath 照它把 id 換成路徑
  T.key = key === undefined ? info.id : String(key); T.fit = FR;          // 艦隊裡的那一項（船型或 船型@換裝表）、換裝的結果（38_fit.js）
  T.cached = !!C; T.keep = C ? null : {};
  T.decos = DS.decos; T.decoN = DS.n; T.meshSkip = DS.skip;                // 裝飾：裝飾件、幾件、沒人用的網格（不建）
  T.ms = {};                                                               // 每一段花多久（毫秒；讀數 window.__vxk.ms）
  function tm(k, f) { var a = performance.now(); f(); T.ms[k] = +(performance.now() - a).toFixed(1); }
  // 帆只存配方（TASK-0602 ①；29_sailrecipe.js）⇒ 先生出頂點，下面的海面遮罩、縮圖、繩的檢查才讀得到。一面一步（沒有快取時一面約 35 ms；2026-10-20 開場切段）
  var SR = sailRecipeInit(); T.ms.sails = 0;
  var steps = (T.rig.sails || []).map(function (s, k) { return ['帆', function () { var a = performance.now(); sailRecipeAt(T, C, k, SR); T.ms.sails = +(T.ms.sails + performance.now() - a).toFixed(1); }]; })
    .concat([['帆', function () { T.sailRecipes = sailRecipeEnd(T, SR); }]]).concat([
    ['格子', function () { tm('grid', function () { T.base = VK.Grid.fromModel(model); }); tm('verify', function () { T.chk = VK.verify(T.base, h); }); tm('hullVox', function () { fitHullVox(T); }); tm('material', function () { hullMaterials(T, info); }); tm('armor', function () { armorSetup(T); }); tm('anchor', function () { anchorParts(T); }); }],   // 材質（05_material.js）：每格的材質索引   // fitHullVox：自帶格子的模型（主機、鍋爐）放回船殼（38_fit.js，TASK-0793）   // 格子不存快取：照解出來的比 checksum   // armorSetup：砲帶的裝甲拆出來（24_armor.js；T.hullG ＝ 船殼，T.base 照舊是整艘）；anchorParts：錨的關聯拆成模型錨（76_anchor.js，TASK-0601）
    ['模型網格', function () { tm('meshes', function () { buildMeshes(T, C && C.models); }); }],
    ['水線與浮力', function () { tm('waterline', function () { waterline(T); }); tm('hullTex', function () { hullTex(T, C && C.hb); }); }],   // 水線、海面遮罩、羅盤的船、側面圖、浮力：分四步（以前一步約 0.12 s）
    ['水線與浮力', function () { tm('navImg', function () { navImg(T); }); }],
    ['水線與浮力', function () { tm('sideImg', function () { sideImg(T); }); }],
    ['水線與浮力', function () { tm('hydro', function () { if (C) { T.hyd = C.hyd; T.disp = C.disp; } else hydrostatics(T); }); }],
    ['船體網格', function () {
      var a = performance.now(); T.pristine = new VK.RegionSet(gl, T.hullG, QIDX);
      if (C) { meshesFromCache(T.pristine, C.mesh); T.ms.pristine = +(performance.now() - a).toFixed(1); return; }
      if (!BED_SLICE) { T.pristine.buildAll(); T.ms.pristine = +(performance.now() - a).toFixed(1); return; }
      return hullMeshSliced(T.pristine).then(function () { T.ms.pristine = +(performance.now() - a).toFixed(1); });   // 沒有快取 ⇒ 分段建（一次建完約 0.22 s）
    }],
    ['船體網格', function () { smoothSetup(T); tm('armorMesh', function () { armorMesh(T); }); }],   // smoothSetup：平滑渲染的那幾格（15_smooth.js；T.ms.smooth）；合併網格照船殼 T.hullG（沒有裝甲 ＝ T.base），裝甲另建（24_armor.js armorMesh）
    ['桅與帆', function () {
      tm('masts', function () { findMasts(T); }); tm('cloth', function () { teamFlagsSetup(T, info); clothSetup(T, C); });   // 陣營旗（77_colours.js）：合成的帆接在作品的帆後面
      var mt = 12 * KEG_T; (T.rig.models || []).forEach(function (m) { mt += modelT({ kind: modelKind(m) }, 1); });   // 模型的重量（砲照實、取用點 12 桶）
      T.ballast0 = Math.max(0, Math.round((T.disp - T.voxT0 - mt) / 25) * 25);   // 剛好浮在設計水線的壓艙物（滑桿一格 25 噸）
    }]
  ]).concat(wrSteps(T, C).map(function (f) { return ['水的房間', function () { var a = performance.now(); f(); T.ms.wrooms = +((T.ms.wrooms || 0) + performance.now() - a).toFixed(1); }]; }));   // 水的房間（33_wrooms.js，TASK-0807）：快取有就讀回，沒有分三步現算（要 T.hullG、T.wl0、T.hullHB ⇒ 排在最後）
  var p = Promise.resolve();
  steps.forEach(function (s, i) { p = p.then(function () { hullSay(info.name + '：' + s[0] + '（' + (i + 1) + '／' + steps.length + '）…'); return yieldUI(); }).then(s[1]); });
  return p.then(function () { T.decodeMs = t1 - t0; T.meshMs = performance.now() - t1; return T; });
}
/** 羅盤中間的船（Tim 2026-10-13：藍色箭頭換成從上面俯瞰的船，載入時算一次、解析度可以低）：
 *  每 NAV_CELL × NAV_CELL 格取最高那一格的顏色（照高度提亮一點 ⇒ 桅頂、甲板、舷牆分得開），裁到有東西的範圍。
 *  畫布：船頭朝上、右舷（格 +y）在右 ⇒ 羅盤只要轉、不用翻。原始格子（沒有砲、帆桁這些模型；開戰後被打掉的也不跟）。 */
var NAV_CELL = 4;
function navImg(T) {
  var G = T.base, C = NAV_CELL, W = Math.ceil(G.sy / C), H = Math.ceil(G.sx / C), top = new Int16Array(W * H).fill(-1), col = new Uint8Array(W * H);
  G.each(function (x, y, z, c) { var i = ((H - 1 - ((x / C) | 0)) * W) + ((y / C) | 0); if (z > top[i]) { top[i] = z; col[i] = c; } });
  var x0 = W, x1 = -1, y0 = H, y1 = -1, i, u, v;
  for (v = 0; v < H; v++) for (u = 0; u < W; u++) if (top[v * W + u] >= 0) { if (u < x0) x0 = u; if (u > x1) x1 = u; if (v < y0) y0 = v; if (v > y1) y1 = v; }
  if (x1 < 0) return;
  var cv = document.createElement('canvas'); cv.width = x1 - x0 + 1; cv.height = y1 - y0 + 1;
  var g = cv.getContext('2d'), im = g.createImageData(cv.width, cv.height), d = im.data;
  for (v = y0; v <= y1; v++) for (u = x0; u <= x1; u++) {
    i = v * W + u; var o = ((v - y0) * cv.width + (u - x0)) * 4; if (top[i] < 0) continue;
    var c = col[i], k = 0.62 + 0.38 * clamp((top[i] - T.zw) / 80, 0, 1);
    d[o] = ((c >> 5) & 7) * 255 / 7 * k; d[o + 1] = ((c >> 2) & 7) * 255 / 7 * k; d[o + 2] = (c & 3) * 255 / 3 * k; d[o + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  T.navImg = cv; T.navU = ((T.cy / C) | 0) - x0 + 0.5; T.navV = (H - 1 - ((T.cx / C) | 0)) - y0 + 0.5;
  T.navX0 = x0; T.navY0 = y0; T.navGH = H;                               // 圖上 (u, v) ⇒ 格 (x, y) ＝ ((H − y0 − v)·C, (x0 + u)·C)：砲位圖（61_hud.js gmapDraw）照它把砲放上去   // 船的中心（格的 cx, cy）在圖上的位置 ⇒ 羅盤照它對準圓心
}
/** 整艘船的俯視圖（Blocksail 地球儀上的船；Tim 2026-10-20「船的Icon包含帆(整艘船的俯瞰圖)」）：船殼的格（同 navImg）＋ 模型（帆桁、砲、舵輪…，origin ＋ 網格）＋ 帆（作品裡的形狀，旗不算），
 *  從上往下看、每一點取最高的那一層（z 緩衝；網格的三角形照像素中心填，比一點還小的照頂點點上去 ⇒ 側立的帆不會整片漏掉）；船頭朝上、右舷在右，同 navImg。
 *  亮度照高度（同 navImg：水線 0.62 ⇒ 高 80 格 1）× 網格面朝上多少（0.75 ～ 1）。只有 ?pick=@host 選船時才算（72_shippick.js pickMeasure；不放進載入）。
 *  C：幾格一點（預設 2 ＝ 0.2 m）。回 { cv, u, v, m }：u、v ＝ 船的中心（格的 cx、cy）在圖上哪一點，m ＝ 一點幾公尺。 */
function topImg(T, C) {
  C = C || 2;
  var G = T.base, L = [], i, j, k;                                         // L：[頂點, 三角形, 每個三角形的顏色（0～1）或 null, 單色, 位移]
  (T.rig.models || []).forEach(function (m) { var M = T.rig.meshes && T.rig.meshes[m.mesh]; if (M && M.verts && M.tris) L.push([M.verts, M.tris, M.tmat ? function (t) { return M.mats[M.tmat[t]] || [0.5, 0.5, 0.5]; } : null, [0.5, 0.5, 0.5], m.origin || [0, 0, 0]]); });
  (T.rig.sails || []).forEach(function (sl) { if (!isFlag(sl) && sl.verts && sl.tris) L.push([sl.verts, sl.tris, null, sl.color || [0.9, 0.88, 0.82], [0, 0, 0]]); });
  var x0 = 0, x1 = G.sx, y0 = 0, y1 = G.sy;                                 // 範圍：船殼的格＋所有網格（帆桁、帆可能伸出格子外）
  L.forEach(function (q) { var V = q[0], o = q[4]; for (i = 0; i < V.length; i += 3) { var x = V[i] + o[0], y = V[i + 1] + o[1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } });
  x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.ceil(x1); y1 = Math.ceil(y1);
  var W = Math.ceil((y1 - y0) / C) + 1, H = Math.ceil((x1 - x0) / C) + 1, zb = new Float32Array(W * H).fill(-1e9), px = new Uint8ClampedArray(W * H * 4);
  function hk(z) { return 0.62 + 0.38 * clamp((z - T.zw) / 80, 0, 1); }
  function put(c, r, z, R, Gc, B) { if (c < 0 || r < 0 || c >= W || r >= H) return; var p = r * W + c; if (z <= zb[p]) return; zb[p] = z; p *= 4; px[p] = R; px[p + 1] = Gc; px[p + 2] = B; px[p + 3] = 255; }
  G.each(function (x, y, z, c) { var k2 = hk(z + 1); put(Math.floor((y + 0.5 - y0) / C), Math.floor((x1 - x - 0.5) / C), z + 1, ((c >> 5) & 7) * 255 / 7 * k2, ((c >> 2) & 7) * 255 / 7 * k2, (c & 3) * 255 / 3 * k2); });   // 格的頂面
  L.forEach(function (q) {
    var V = q[0], I = q[1], col = q[2], o = q[4];
    for (var t = 0; t < I.length; t += 3) {
      var a = I[t] * 3, b = I[t + 1] * 3, d = I[t + 2] * 3, rgb = col ? col(t / 3) : q[3];
      var ax = V[a] + o[0], ay = V[a + 1] + o[1], az = V[a + 2] + o[2], bx = V[b] + o[0], by = V[b + 1] + o[1], bz = V[b + 2] + o[2], dx = V[d] + o[0], dy = V[d + 1] + o[1], dz = V[d + 2] + o[2];
      var nx = (by - ay) * (dz - az) - (bz - az) * (dy - ay), ny = (bz - az) * (dx - ax) - (bx - ax) * (dz - az), nz = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax), nl = Math.hypot(nx, ny, nz) || 1;
      var f = 0.75 + 0.25 * Math.abs(nz) / nl;
      var P = [[(ay - y0) / C, (x1 - ax) / C, az], [(by - y0) / C, (x1 - bx) / C, bz], [(dy - y0) / C, (x1 - dx) / C, dz]];
      var area = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
      if (Math.abs(area) < 0.5) {                                          // 比一點還小（或側立）⇒ 頂點、邊的中點點上去
        for (k = 0; k < 3; k++) { var A = P[k], B2 = P[(k + 1) % 3]; [A, [(A[0] + B2[0]) / 2, (A[1] + B2[1]) / 2, (A[2] + B2[2]) / 2]].forEach(function (Q) { var kk = hk(Q[2]) * f; put(Math.floor(Q[0]), Math.floor(Q[1]), Q[2], rgb[0] * 255 * kk, rgb[1] * 255 * kk, rgb[2] * 255 * kk); }); }
        continue;
      }
      var c0 = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0]))), c1 = Math.min(W - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
      var r0 = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1]))), r1 = Math.min(H - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
      for (var r = r0; r <= r1; r++) for (var cc = c0; cc <= c1; cc++) {
        var X = cc + 0.5, Y = r + 0.5;
        var w0 = ((P[1][0] - X) * (P[2][1] - Y) - (P[2][0] - X) * (P[1][1] - Y)) / area, w1 = ((P[2][0] - X) * (P[0][1] - Y) - (P[0][0] - X) * (P[2][1] - Y)) / area, w2 = 1 - w0 - w1;
        if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
        var z = w0 * P[0][2] + w1 * P[1][2] + w2 * P[2][2], kz = hk(z) * f;
        put(cc, r, z, rgb[0] * 255 * kz, rgb[1] * 255 * kz, rgb[2] * 255 * kz);
      }
    }
  });
  var u0 = W, u1 = -1, v0 = H, v1 = -1;
  for (j = 0; j < H; j++) for (i = 0; i < W; i++) if (px[(j * W + i) * 4 + 3]) { if (i < u0) u0 = i; if (i > u1) u1 = i; if (j < v0) v0 = j; if (j > v1) v1 = j; }
  if (u1 < 0) return null;
  var cv = document.createElement('canvas'); cv.width = u1 - u0 + 1; cv.height = v1 - v0 + 1;
  var g = cv.getContext('2d'), im = g.createImageData(cv.width, cv.height);
  for (j = v0; j <= v1; j++) im.data.set(px.subarray((j * W + u0) * 4, (j * W + u1 + 1) * 4), (j - v0) * cv.width * 4);
  g.putImageData(im, 0, 0);
  return { cv: cv, u: (T.cy - y0) / C - u0, v: (x1 - T.cx) / C - v0, m: C * S };
}
/** 上方艦隊按鈕中間的船（TASK-0552）：從左舷看過去的側面投影（船頭朝右；每 SIDE_CELL × SIDE_CELL 格取最靠左舷那一格的顏色、越往裡越暗），
 *  帆（作品的帆面，旗不算）照每面帆的顏色畫一層墊在後面 ⇒ 認得出是帆船。載入時算一次、裁到有東西的範圍；原始格子（開戰後被打掉的不跟）。 */
var SIDE_CELL = 4;
function sideImg(T) {
  var G = T.base, C = SIDE_CELL, W = Math.ceil(G.sx / C), H = Math.ceil(G.sz / C), near = new Int16Array(W * H).fill(0x7fff), col = new Uint8Array(W * H);
  G.each(function (x, y, z, c) { var i = (H - 1 - ((z / C) | 0)) * W + ((x / C) | 0); if (y < near[i]) { near[i] = y; col[i] = c; } });
  var x0 = W, x1 = -1, y0 = H, y1 = -1, i, u, v;
  function grow(u, v) { if (u < x0) x0 = u; if (u > x1) x1 = u; if (v < y0) y0 = v; if (v > y1) y1 = v; }
  for (v = 0; v < H; v++) for (u = 0; u < W; u++) if (near[v * W + u] < 0x7fff) grow(u, v);
  var sails = (T.rig.sails || []).filter(function (s) { return !isFlag(s); });
  sails.forEach(function (s) { for (var j = 0; j < s.verts.length; j += 3) grow(clamp(Math.floor(s.verts[j] / C), 0, W - 1), clamp(H - 1 - Math.floor(s.verts[j + 2] / C), 0, H - 1)); });
  if (x1 < 0) return;
  var hc = document.createElement('canvas'); hc.width = W; hc.height = H;
  var hg = hc.getContext('2d'), im = hg.createImageData(W, H), dd = im.data;
  for (i = 0; i < W * H; i++) {
    if (near[i] === 0x7fff) continue;
    var c = col[i], k = 0.95 - 0.4 * clamp((near[i] - T.cy + G.sy / 2) / G.sy, 0, 1), o = i * 4;
    dd[o] = ((c >> 5) & 7) * 255 / 7 * k; dd[o + 1] = ((c >> 2) & 7) * 255 / 7 * k; dd[o + 2] = (c & 3) * 255 / 3 * k; dd[o + 3] = 255;
  }
  hg.putImageData(im, 0, 0);
  var cv = document.createElement('canvas'); cv.width = x1 - x0 + 1; cv.height = y1 - y0 + 1;
  var g = cv.getContext('2d'); g.translate(-x0, -y0);
  sails.forEach(function (s) {                                          // 一個三角形填一次（⛔ 全部放進同一條路徑 ⇒ 帆是正反兩層、繞向相反，互相抵銷成空的）
    var P3 = s.verts, t = s.tris, sc = s.color || [0.95, 0.92, 0.85];   // 照那面帆自己的顏色（Tim 2026-10-14：餘燼號的帆在圓鈕上變成白的；預設色跟 30_rig_physics.js 同一個）
    g.fillStyle = 'rgba(' + Math.round(sc[0] * 255) + ',' + Math.round(sc[1] * 255) + ',' + Math.round(sc[2] * 255) + ',0.85)';
    for (var j = 0; j < t.length; j += 3) { g.beginPath(); for (var q = 0; q < 3; q++) { var a = t[j + q] * 3, px = P3[a] / C, pz = H - P3[a + 2] / C; if (q) g.lineTo(px, pz); else g.moveTo(px, pz); } g.fill(); }
  });
  g.drawImage(hc, 0, 0);
  cv.wl = isFinite(T.zw) ? clamp(H - T.zw / C - y0, 0, cv.height) : cv.height;   // 設計水線在圖裡第幾個像素（由上往下）：圓鈕照它把船的水線貼在畫的海平面上（61_hud.js sideDraw；Tim 2026-10-15：船飄在空中）
  T.sideImg = cv;
}
/** 設計水線（格的 z）：組裝件或關聯的 meta `kind=ship, waterline_z`（跟 basecamp 提議中）；沒有 ⇒ ZW0（憲法號 63）。 */
function hullZW(h, info) {
  var p = (h.parts || []).filter(function (q) { return q.meta && q.meta.kind === 'ship'; })[0], m = (p && p.meta) || h.meta || {};
  return isFinite(+m.waterline_z) && +m.waterline_z > 0 ? +m.waterline_z : info && info.zw0 ? info.zw0 : ZW0;   // meta ＞ 船型清單的 zw0 ＞ 63
}
