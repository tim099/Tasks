// ───────────────────────── 設定存檔（localStorage；Tim 2026-10-13：直接開網頁時，設定存在玩家自己的瀏覽器，下次打開自動套用） ─────────────────────────
// 存：玩法（娛樂／寫實）、細節設定（血量、傷害、彈種倍率、火藥、補給、風壓、降旗、頂風失速、娛樂加成）、船隻配置頁（SHIP_CFG＋SHIP_CREW，照船型）、砲長、選了哪兩艘船、彈種、自動開砲、帆與繩的物理，
//   以及主選單的模式、距離、航行。不存整場戰局。
// 只存「跟預設不一樣」的那幾項：沒動過的照程式的預設走 ⇒ 之後改了預設值（例：火藥 450 → 675），沒動過的玩家也吃得到新的。
//   壓艙物的預設跟船走（T.ballast0）⇒ 存的時候記那艘船的 checksum，船重匯過就不套（PREF_BALLAST，04_state.js）。
// 網址參數優先：網址有的那一項照網址；網址帶了任何設定參數 ⇒ 只讀不寫（照連結開的那一場不蓋掉玩家自己的存檔）。
// ?demo（縮圖、對拍）⇒ 不讀也不寫：快轉出來的那一格不受存檔影響。?prefs=0 同（量預設用）。
// 讀寫都包 try/catch：畫廊彈窗的 iframe 只開 allow-scripts（不透明來源），一碰 localStorage 就丟錯 ⇒ 照預設跑。
// 格式帶版本號（v）；看不懂的版本、壞掉的 JSON ⇒ 整份不套；型別不對、界外的值 ⇒ 那一項不套（界外的夾回範圍）。
// 什麼時候存：每秒比一次（跟上次存的不一樣才寫）＋ 關頁、切到背景時。全部回到預設 ⇒ 刪掉那一筆。
var PREFS_KEY = 'ame_constitution_broadside.prefs', PREFS_VER = 1;
var PREF_Q = ['mode', 'start', 'wdir', 'wspd', 'ship', 'blue', 'red', 'hard', 'flood', 'ballast', 'gunw', 'speed', 'agile', 'upwind', 'base', 'pump', 'gunhp', 'sailhp', 'crewhp', 'crewdeath', 'powderhp', 'blast', 'blastv', 'dmg24', 'dmg32l', 'dmg32', 'dmg18', 'dmg12', 'dmg18l', 'dmg6', 'dmg3c', 'dmgtr', 'dmgsf', 'dmgbl', 'dmgmg', 'dmgbw', 'dmgbd',
  'box', 'carry', 'hands', 'drown', 'heal', 'musket', 'sailfix', 'burn', 'galley', 'wind', 'windcap', 'inertia', 'turninert', 'sailtq', 'ammo', 'strike', 'cap', 'phys', 'sail', 'play', 'stall', 'funspeed', 'funagile', 'funstall', 'funpowder', 'funhard', 'sea', 'helmlost', 'funhelm', 'wheelloss', 'rudderloss', 'difftq', 'funhelmloss', 'funhelmeff', 'fundiff',
  'gfx', 'g_shadow', 'g_refl', 'g_refr', 'g_sea', 'g_res', 'g_aa', 'phx', 'p_rig', 'p_rigfar', 'p_debris', 'p_fx', 'weather', 'g_rain', 'g_drops', 'g_dropspl', 'g_door', 'g_port', 'g_masks', 'g_deco', 'g_treed', 'g_plant', 'dist', 'field', 'reinf', 'cmd', 'gauge', 'blue', 'red', 'slowmo', 'dbg', 'slowcam', 'roomfn', 'navre', 'gcrew', 'smoke', 'pslow', 'pslowb', 'ramv', 'ramk', 'rame', 'ramside', 'debcap', 'csm'].concat(SHK_ITEMS.map(function (it) { return 'sh_' + it.k; }));          // 會蓋過存檔的網址參數（04_state.js、05_hull.js 讀的那些）
var DMG_Q = { long: 'dmg24', long32: 'dmg32l', carr: 'dmg32', chase: 'dmg18', long4: 'dmg4', long12: 'dmg12', long18: 'dmg18l', long6: 'dmg6', chase3: 'dmg3c', trident: 'dmgtr', dahl9: 'dmg9d', brooke64: 'dmg64b', brooke7: 'dmg7b', dahl11: 'dmg11d', long36: 'dmg36l', long8: 'dmg8l', pierrier: 'dmgpr', siphon: 'dmgsf', ballista: 'dmgbl', mangonel: 'dmgmg', bow: 'dmgbw', bombardella: 'dmgbd', krupp305: 'dmg305k', krupp150: 'dmg150k', hotch37: 'dmgh37', canet320: 'dmg320c', armstrong120: 'dmg120a', hotch57: 'dmgh57', hotch47: 'dmgh47' };
var PREFS = { read: DEMO < 0 && Q.get('prefs') !== '0' && !Q.has('admin') && !Q.has('shipcheck'), write: false, state: '', last: '' };   // ?admin=rooms（設定後台嵌的那一份）、?shipcheck（匯入檢查）⇒ 不讀不存
PREFS.write = PREFS.read && !PREF_Q.some(function (k) { return Q.has(k); }) && !LAB_FLEET;   // 擬真沙盒：讀玩家的存檔（規則跟玩家玩的同一套），⛔ 不寫回（沙盒改的距離、策略、物理檔位不能蓋掉玩家的）
// ?cmd=我方,敵方（艦隊指揮官，52_fleet.js CMD_SIDE）：放這裡 —— ⛔ 放在 52_fleet.js 那時 53_commander.js 的 CMD_NAMES 還沒定義 ⇒ 帶 ?cmd 一開就丟錯、整頁停在載入
if (Q.has('cmd')) Q.get('cmd').split(',').forEach(function (w, i) { if (i < 2 && CMD_NAMES[w]) CMD_SIDE[i ? 'red' : 'blue'] = w; });
if (Q.has('gauge')) Q.get('gauge').split(',').forEach(function (w, i) { if (i < 2 && (w === '1' || w === '0')) CMD_GAUGE[i ? 'red' : 'blue'] = w === '1'; });   // 搶上風（TASK-0679）：?gauge=我方,敵方（1 開／0 關）
/** 存檔的描述表（TASK-0670：以前 prefsSnap／prefsApply 一項一項各寫一次）：每一項 ＝
 *    數字 prefNum(鍵, 範圍（函式：設定後台改了預設要讀到新的）, 整數, 讀, 寫, 網址參數)：跟範圍的第三格（預設）不一樣才存；讀的時候夾進範圍
 *    勾選 prefBool(鍵, 預設, 讀, 寫, 網址參數)：跟預設不一樣才存；讀的時候要是 true／false
 *    其他 prefAny(鍵, 存（寫進 o）, 讀（從 p）)：艦隊、船隻配置、各設定頁的表、畫質、物理效果…自己的格式
 *  網址參數（q；沒給 ＝ 跟鍵同名，null ＝ 網址不管）有帶 ⇒ 那一項不讀（照網址）。照讀的先後排（mode 在 auto 之前、phx 之後才算 PHYS）；
 *  存檔的鍵也照這個順序。⛔ 拿掉一項 ⇒ 那一項不存也不讀。 */
function prefNum(k, lim, int, get, set, q) { return { k: k, q: q === undefined ? k : q, lim: lim, int: int, get: get, set: set }; }
function prefBool(k, def, get, set, q) { return { k: k, q: q === undefined ? k : q, def: def, get: get, set: set, bool: true }; }
function prefAny(k, snap, apply) { return { k: k, snap: snap, apply: apply }; }
function prefLim(k) { return function () { return LIM[k]; }; }
function prefOk(v, lim, int) { if (typeof v !== 'number' || !isFinite(v)) return undefined; v = clamp(v, lim[0], lim[1]); return int ? Math.round(v) : v; }
var PREF_ITEMS = [
  prefAny('fleet', function (o) { if (FLEET_SET.some(function (L) { return L.length !== 1 || L[0] !== HULL_DEF; })) o.fleet = FLEET_SET.map(function (L) { return L.slice(); }); },   // 艦隊編成（TASK-0537；舊存檔的 ship ＝ 一邊一艘，讀的時候照樣認）
    function (p) {
      if (Q.has('ship') || Q.has('blue') || Q.has('red')) return;        // 編成：網址給了任何一個 ⇒ 整組照網址
      if (Array.isArray(p.ship)) p.ship.forEach(function (w, i) { if (i < 2 && hullInfo(w)) FLEET_SET[i] = [w]; });   // 舊存檔（一邊一艘）
      if (Array.isArray(p.fleet)) p.fleet.forEach(function (L, i) { if (i < 2 && Array.isArray(L)) { L = L.filter(function (w) { return typeof w === 'string' && hullInfo(w); }); if (L.length) FLEET_SET[i] = L; } });
      fleetTrim(FLEET_SET);
    }),
  prefAny('ships', function (o) {                                       // 船隻配置頁：船隻設定 cfg（照那一型的預設比）、船員 crew（TASK-0570）、艙房的擺法 rooms（TASK-0568）
    var cfg = {};
    Object.keys(SHIP_CFG).forEach(function (id) {
      var c = SHIP_CFG[id], T = HULLT[id], d = {};
      SHIP_KEYS.forEach(function (k) { if (k !== 'ballast' && c[k] !== cfgBase(k, id)) d[k] = c[k]; });   // 跟那一型的預設比（HULL_CFG0）
      if (d.hard !== undefined) d.hard1 = 1;                            // 硬度是倍率（1 ＝ 只看材質；2026-10-16 起）⇒ 讀的時候分得出舊存檔（舊的是 3 ＝ 預設的刻度）
      if (T && c.ballast !== undefined) { if (c.ballast !== T.ballast0) { d.ballast = c.ballast; d.chk = T.h.checksum; } }
      else if (PREF_BALLAST[id]) { d.ballast = PREF_BALLAST[id].v; d.chk = PREF_BALLAST[id].chk; }   // 這一場沒載那艘船 ⇒ 存檔裡的照留
      if (Object.keys(d).length) cfg[id] = d;
    });
    if (Object.keys(cfg).length) o.cfg = cfg;
    var cr = crewSnap(true); if (Object.keys(cr).length) o.crew = cr;
    var rm = roomsSnap(true); if (Object.keys(rm).length) o.rooms = rm;
    var ft = fitSnap(); if (Object.keys(ft).length) o.fit = ft;          // 換裝表（38_fit.js；TASK-0714）：每一型跟出廠不一樣的那幾格
  }, function (p) { shipsApply(p); }),
  prefNum('gunhp', prefLim('gunhp'), true, function () { return GUN_HP; }, function (x) { GUN_HP = x; }),
  prefNum('sailhp', prefLim('sailhp'), true, function () { return SAIL_HP; }, function (x) { SAIL_HP = x; }),
  prefNum('crewhp', prefLim('crewhp'), true, function () { return CREW_HP; }, function (x) { CREW_HP = x; }),
  prefNum('crewdeath', prefLim('crewdeath'), true, function () { return CREW_DEATH; }, function (x) { CREW_DEATH = x; }),
  prefNum('powderhp', prefLim('powderhp'), true, function () { return POWDER_HP; }, function (x) { POWDER_HP = x; }),
  prefNum('blast', prefLim('blast'), false, function () { return BLAST_K; }, function (x) { BLAST_K = x; }),
  prefNum('blastv', prefLim('blastv'), false, function () { return BLAST_V; }, function (x) { BLAST_V = x; }),
  prefNum('box', prefLim('box'), true, function () { return BOX_N; }, function (x) { BOX_N = x; }),
  prefNum('carry', prefLim('carry'), true, function () { return CARRY_N; }, function (x) { CARRY_N = x; }),
  prefNum('hands', prefLim('hands'), true, function () { return HANDS; }, function (x) { HANDS = x; }),
  prefNum('drown', prefLim('drown'), true, function () { return DROWN_T; }, function (x) { DROWN_T = x; }),
  prefNum('navre', prefLim('navre'), false, function () { return NAV_RE; }, function (x) { NAV_RE = x; }),
  prefNum('heal', prefLim('heal'), true, function () { return HEAL_T; }, function (x) { HEAL_T = x; }),
  prefNum('musket', prefLim('musket'), true, function () { return MUSKET_R; }, function (x) { MUSKET_R = x; }),
  prefNum('sailfix', prefLim('sailfix'), true, function () { return SAILFIX_T; }, function (x) { SAILFIX_T = x; }),
  prefNum('burn', prefLim('burn'), true, function () { return BURN_PCT; }, function (x) { BURN_PCT = x; }),   // 火勢（49_burn.js；TASK-0717）
  prefNum('galley', prefLim('galley'), true, function () { return GALLEY_PCT; }, function (x) { GALLEY_PCT = x; }),   // 廚房加成（45_galley.js；TASK-0720）
  prefNum('debcap', function () { return DEB_LIM; }, true, function () { return DEB_CAP; }, function (x) { DEB_CAP = x; }),   // 碎片上限（畫質頁；07_gfx.js）
  prefNum('smoke', function () { return SMOKE_LIM; }, false, function () { return SMOKE_K; }, function (x) { SMOKE_K = Math.round(x * 10) / 10; }),   // 煙消散（畫質頁；07_gfx.js）
  prefAny('shk', function (o) { var v = shkSnap(); if (Object.keys(v).length) o.shk = v; }, function (p) { if (p.shk && typeof p.shk === 'object') shkApply(p.shk); }),   // 陰影細項（畫質頁；07_gfx.js SHK：跟預設不一樣的那幾項，網址 ?csm ?sh_ 有的照網址）
  prefNum('wind', prefLim('wind'), false, function () { return WIND_K; }, function (x) { WIND_K = x; }),
  prefNum('windcap', prefLim('windcap'), false, function () { return WIND_CAP; }, function (x) { WIND_CAP = x; }),
  prefNum('inertia', prefLim('inertia'), false, function () { return DRV_INERTIA; }, function (x) { DRV_INERTIA = x; }),   // 動力的手感（31_drive.js）
  prefNum('turninert', prefLim('turninert'), false, function () { return DRV_TURN; }, function (x) { DRV_TURN = x; }),
  prefNum('sailtq', prefLim('sailtq'), false, function () { return DRV_TQ; }, function (x) { DRV_TQ = x; }),
  prefAny('play', function (o) { if (PLAY !== CFG.menu.play) o.play = PLAY; }, function (p) { if (!Q.has('play') && (p.play === 'fun' || p.play === 'real')) PLAY = p.play; }),
  prefNum('stall', prefLim('stall'), false, function () { return STALL_K; }, function (x) { STALL_K = x; }),
  prefNum('wheelloss', prefLim('wheelloss'), false, function () { return WHEEL_LOSS; }, function (x) { WHEEL_LOSS = x; }),   // 操舵（TASK-0777，31_drive.js helmEff）：舵輪、舵被打掉的損失、差動的力矩
  prefNum('rudderloss', prefLim('rudderloss'), false, function () { return RUDDER_LOSS; }, function (x) { RUDDER_LOSS = x; }),
  prefNum('difftq', prefLim('difftq'), false, function () { return DIFF_K; }, function (x) { DIFF_K = x; }),
  prefNum('sea', prefLim('sea'), false, function () { return SEA_K; }, function (x) { SEA_K = x; }),
  prefAny('weather', function (o) { if (WX_ID !== 'clear') o.weather = WX_ID; }, function (p) { if (!Q.has('weather') && WEATHERS[p.weather]) { WX_ID = p.weather; WX = WEATHERS[WX_ID]; } }),   // 天色在 71_input.js 開頭 setWeather 套
  prefNum('funspeed', prefLim('funspeed'), false, function () { return FUN.speed; }, function (x) { FUN.speed = x; }),
  prefNum('funagile', prefLim('funagile'), false, function () { return FUN.agile; }, function (x) { FUN.agile = x; }),
  prefNum('funstall', prefLim('funstall'), false, function () { return FUN.stall; }, function (x) { FUN.stall = x; }),
  prefNum('funpowder', prefLim('funpowder'), false, function () { return FUN.powder; }, function (x) { FUN.powder = x; }),
  prefNum('funhard', prefLim('funhard'), false, function () { return FUN.hard; }, function (x) { FUN.hard = x; }),
  prefNum('funhelmloss', prefLim('funhelmloss'), false, function () { return FUN.helmloss; }, function (x) { FUN.helmloss = x; }),
  prefNum('funhelmeff', prefLim('funhelmeff'), false, function () { return FUN.helmeff; }, function (x) { FUN.helmeff = x; }),   // 娛樂加成：舵效、差動（TASK-0777）
  prefNum('fundiff', prefLim('fundiff'), false, function () { return FUN.diff; }, function (x) { FUN.diff = x; }),   // 舊的 helmlost／funhelm 只在操舵的開關關掉時用（網址照樣給得進去），不再存
  prefAny('dmg', function (o) { var dm = {}; Object.keys(DMG_Q).forEach(function (t) { if (DMG[t] !== LIM[DMG_Q[t]][2]) dm[t] = DMG[t]; }); if (Object.keys(dm).length) o.dmg = dm; },   // 每發傷害（砲的設定頁；網址 ?dmg24= 那幾個優先）
    function (p) { if (p.dmg && typeof p.dmg === 'object') Object.keys(DMG_Q).forEach(function (t) { if (Q.has(DMG_Q[t])) return; var x = prefOk(p.dmg[t], LIM[DMG_Q[t]], true); if (x !== undefined) DMG[t] = x; }); }),
  prefAny('wxk', function (o) { var w = wxkSnap(); if (Object.keys(w).length) o.wxk = w; }, function (p) { if (p.wxk && typeof p.wxk === 'object') wxkApply(p.wxk); }),   // 天氣設定（08_weather.js WXK_ITEMS）
  prefAny('guns', function (o) { var gs = gunsSnap(); if (Object.keys(gs).length) o.guns = gs; }, function (p) { if (p.guns && typeof p.guns === 'object') gunsApply(p.guns); }),   // 砲的設定（68_guncfg.js）
  prefAny('furn', function (o) { var fs = furnSnap(); if (Object.keys(fs).length) o.furn = fs; }, function (p) { if (p.furn && typeof p.furn === 'object') furnApply(p.furn); }),   // 道具設定（67_furncfg.js）
  prefAny('drv', function (o) { var dv = drvSnap(); if (Object.keys(dv).length) o.drv = dv; }, function (p) { if (p.drv && typeof p.drv === 'object') drvApply(p.drv); }),   // 動力件（67_furncfg.js、31_drive.js DRVP）
  prefAny('keys', function (o) { var ks = keySnap(); if (Object.keys(ks).length) o.keys = ks; }, function (p) { if (p.keys && typeof p.keys === 'object') keyApply(p.keys); }),   // 鍵位（66_keys.js）
  prefAny('ammoK', function (o) { if (AMMO_K.some(function (r, i) { return r.some(function (v, j) { return v !== AMMO_K0[i][j]; }); })) o.ammoK = AMMO_K.map(function (r) { return r.slice(); }); },
    function (p) { if (!Q.has('ammo') && Array.isArray(p.ammoK)) p.ammoK.forEach(function (r, i) { if (i < 3 && Array.isArray(r)) r.forEach(function (v, j) { var x = prefOk(v, AMMO_LIM, true); if (j < 3 && x !== undefined) AMMO_K[i][j] = x; }); }); }),
  prefAny('strike', function (o) { if (STRIKE.cas !== LIM.cas[2] || STRIKE.guns || STRIKE.masts || STRIKE.officers) o.strike = { cas: STRIKE.cas, guns: STRIKE.guns, masts: STRIKE.masts, officers: STRIKE.officers }; },
    function (p) {
      if (Q.has('strike') || !p.strike || typeof p.strike !== 'object') return;
      var cas = prefOk(p.strike.cas, LIM.cas); if (cas !== undefined) STRIKE.cas = cas;
      ['guns', 'masts', 'officers'].forEach(function (k) { if (typeof p.strike[k] === 'boolean') STRIKE[k] = p.strike[k]; });
    }),
  prefAny('cap', function (o) { if (CAP_SET.some(function (k) { return k !== 'random'; })) o.cap = CAP_SET.slice(); },
    function (p) { if (!Q.has('cap') && Array.isArray(p.cap)) p.cap.forEach(function (w, i) { if (i < 2 && (w === 'random' || Object.prototype.hasOwnProperty.call(CAPTAINS, w))) CAP_SET[i] = w; }); }),
  prefAny('ammo', function (o) { if (AMMO_I !== 0) o.ammo = AMMO_I; }, function (p) { var a = prefOk(p.ammo, [0, AMMO.length - 1], true); if (a !== undefined) AMMO_I = a; }),
  prefAny('phx', function (o) { var xd = PHX_PRESET[PHX_DEFAULT]; if (PHX_ITEMS.some(function (it) { return PHX[it.k] !== xd[it.k]; })) { o.phx = {}; PHX_ITEMS.forEach(function (it) { o.phx[it.k] = PHX[it.k]; }); } },   // 物理效果（09_phx.js）：跟預設不一樣 ⇒ 整組存
    function (p) {
      var qx = Q.has('phx') || Q.has('phys') || PHX_ITEMS.some(function (it) { return Q.has('p_' + it.k); });   // 網址指定了物理 ⇒ 存檔的那份不套
      if (!qx && p.phx && typeof p.phx === 'object') PHX_ITEMS.forEach(function (it) { var x = prefOk(p.phx[it.k], [0, it.opt.length - 1], true); if (x !== undefined) PHX[it.k] = x; });
      else if (!qx && p.phys === false) PHX.rig = 0;                   // 舊格式（只存了帆與繩的開關）
      PHYS = PHX.rig > 0;
    }),
  prefAny('gfx', function (o) { var gd = GFX_PRESET[GFX_DEFAULT]; if (GFX_ITEMS.some(function (it) { return GFX[it.k] !== gd[it.k]; })) { o.gfx = {}; GFX_ITEMS.forEach(function (it) { o.gfx[it.k] = GFX[it.k]; }); } },   // 畫質（07_gfx.js）：跟預設不一樣 ⇒ 整組存
    function (p) {
      if (!(p.gfx && typeof p.gfx === 'object' && !Q.has('gfx'))) return;
      GFX_ITEMS.forEach(function (it) { var x = prefOk(p.gfx[it.k], [0, it.opt.length - 1], true); if (x !== undefined && !Q.has('g_' + it.k)) GFX[it.k] = x; });
      // 舊存檔沒有後來加的那幾項（砲門 port、海圖讀取範圍 chartr）⇒ 其他項跟哪一檔一樣就照那一檔（不然一律變成預設檔的值、主選單顯示「自訂」）
      var miss = GFX_ITEMS.filter(function (it) { return p.gfx[it.k] === undefined && !Q.has('g_' + it.k); }).map(function (it) { return it.k; });
      if (miss.length) for (var lv in GFX_PRESET) { var pr = GFX_PRESET[lv]; if (GFX_ITEMS.every(function (it) { return miss.indexOf(it.k) >= 0 || GFX[it.k] === pr[it.k]; })) { miss.forEach(function (k) { GFX[k] = pr[k]; }); break; } }   // 舊存檔（TASK-0719 之前）沒有「砲門」⇒ 其他項跟哪一檔一樣就照那一檔補（低 ＝ 只有我艦、中以上 ＝ 每艘）：存「低」的讀回來還是低（⛔ 照預設檔 mid ⇒ 變「自訂」）；都對不上 ⇒ 照預設檔
    }),
  prefBool('fps', false, function () { return GFX_FPS; }, function (x) { GFX_FPS = x; }, null),
  prefAny('snd', function (o) {                                         // 聲音設定（02_music.js，TASK-0677）
    [['vsfx', 'sfx'], ['vamb', 'amb'], ['vbgm', 'bgm'], ['bgm', 'mode'], ['tune', 'tune'], ['theme', 'theme']].forEach(function (k) { if (SND[k[1]] !== SND_DEF[k[1]]) o[k[0]] = SND[k[1]]; });
  }, function (p) {
    [['vsfx', 'sfx'], ['vamb', 'amb'], ['vbgm', 'bgm']].forEach(function (k) { if (typeof p[k[0]] === 'number' && isFinite(p[k[0]])) SND[k[1]] = clamp(p[k[0]], 0, 1); });
    if (p.bgm === 'duck' || p.bgm === 'on' || p.bgm === 'off') SND.mode = p.bgm; else if (p.bgm === 'sail') SND.mode = 'duck';   // 'sail'：第一版的「開砲就淡出」（已拿掉）⇒ 照新的預設
    if (p.tune === 'shuffle' || TUNES.some(function (t) { return t.id === p.tune; })) SND.tune = p.tune;
    if (p.theme === 0 || p.theme === 1) SND.theme = p.theme;                // 船的主題曲（TASK-0681）
  }),
  prefBool('gcrew', true, function () { return GUN_CREW_HURT; }, function (x) { GUN_CREW_HURT = x; }),   // 砲被打飛 ⇒ 砲班跟著受傷（21_gunnery.js）
  prefBool('dbg', false, function () { return DBG_SET; }, function (x) { DBG_SET = x; }),   // Debug 模式（04_state.js dbgOn）
  prefBool('slow', true, function () { return SLOW.on; }, function (x) { SLOW.on = x; }, 'slowmo'),   // 殉爆的慢動作與特寫（73_slowmo.js）
  prefBool('pslow', false, function () { return PSLOW.on; }, function (x) { PSLOW.on = x; }),   // 物理減速（73_slowmo.js）
  prefNum('pslowb', prefLim('pslowb'), false, function () { return PSLOW.budget; }, function (x) { PSLOW.budget = Math.round(x * 100) / 100; }),
  prefNum('ramv', prefLim('ramv'), false, function () { return RAM.v0; }, function (x) { RAM.v0 = x; }),   // 碰撞傷害的數值（物理設定頁）
  prefNum('ramk', prefLim('ramk'), false, function () { return RAM.k; }, function (x) { RAM.k = x; }),
  prefNum('rame', prefLim('rame'), false, function () { return RAM.e; }, function (x) { RAM.e = x; }),
  prefNum('ramside', prefLim('ramside'), false, function () { return RAM.side; }, function (x) { RAM.side = x; }),
  prefBool('slowcam', true, function () { return SLOW.cam; }, function (x) { SLOW.cam = x; }),   // ⚠ 以前只讀不存（存的那一行被併進註解裡）⇒ 改了下次打開又回預設；現在照描述表存
  prefAny('sail', function (o) { if (SAIL !== CFG.menu.sail) o.sail = SAIL; }, function (p) { if (!Q.has('sail') && (p.sail === 'auto' || p.sail === 'manual' || p.sail === 'off')) SAIL = p.sail; }),
  prefAny('mode', function (o) { if (MODE !== CFG.menu.mode) o.mode = MODE; }, function (p) { if (!MODE_Q && Object.prototype.hasOwnProperty.call(MODE_RULES, p.mode) && MODE_RULES[p.mode].menu) flowMode(p.mode); }),   // MODE_Q：網址給了玩法（04_modes.js）⇒ 照網址
  prefAny('auto', function (o) { if (LAST_MODE === MODE && AUTOFIRE !== modeRule('autoFire')) o.auto = AUTOFIRE; },   // 換了模式還沒開局 ⇒ 開局時會照模式重套（70_flow.js reset），這時的值不算數
    function (p) { if (typeof p.auto === 'boolean') { AUTOFIRE = p.auto; LAST_MODE = MODE; } }),   // 存了自動開砲 ⇒ 開局不再照模式套預設
  prefAny('field', function (o) { if (FIELD_N !== MAX_SHIPS) o.field = FIELD_N; }, function (p) { if (!Q.has('field') && typeof p.field === 'number' && isFinite(p.field)) FIELD_N = clamp(Math.round(p.field), 2, MAX_SHIPS); }),   // 候補（52_fleet.js）
  prefAny('reinf', function (o) { if (REINF_MODE !== 'prop') o.reinf = REINF_MODE; }, function (p) { if (!Q.has('reinf') && REINF_NAMES[p.reinf]) REINF_MODE = p.reinf; }),
  prefAny('cmd', function (o) { if (CMD_SIDE.blue !== 'pair' || CMD_SIDE.red !== 'pair') o.cmd = [CMD_SIDE.blue, CMD_SIDE.red]; },   // 指揮官（TASK-0551）
    function (p) { if (!Q.has('cmd') && Array.isArray(p.cmd)) p.cmd.forEach(function (w, i) { if (i < 2 && CMD_NAMES[w]) CMD_SIDE[i ? 'red' : 'blue'] = w; }); }),
  prefAny('gauge', function (o) { if (CMD_GAUGE.blue || CMD_GAUGE.red) o.gauge = [CMD_GAUGE.blue ? 1 : 0, CMD_GAUGE.red ? 1 : 0]; },   // 搶上風（TASK-0679）
    function (p) { if (!Q.has('gauge') && Array.isArray(p.gauge)) p.gauge.forEach(function (w, i) { if (i < 2) CMD_GAUGE[i ? 'red' : 'blue'] = w === 1; }); }),
  prefAny('dist', function (o) { if (DIST !== LIM_DIST[2]) o.dist = DIST; }, function (p) { if (!Q.has('dist') && typeof p.dist === 'number' && isFinite(p.dist)) DIST = clamp(Math.round(p.dist), LIM_DIST[0], LIM_DIST[1]); })   // 舊存檔的 90／140／220 照樣是合法的值
];
/** 現在的設定裡跟預設不一樣的那幾項（＋版本號）—— 照描述表。 */
function prefsSnap() {
  var o = { v: PREFS_VER };
  PREF_ITEMS.forEach(function (it) {
    if (it.snap) return it.snap(o);
    var v = it.get(); if (v !== (it.bool ? it.def : it.lim()[2])) o[it.k] = v;
  });
  return o;
}
/** 存檔 ⇒ 變數（照描述表的先後）。網址有的那一項不套；每一項各自驗（型別、範圍），不對的那一項照預設。 */
function prefsApply(p) {
  PREF_ITEMS.forEach(function (it) {
    if (it.apply) return it.apply(p);
    if (it.q && Q.has(it.q)) return;
    if (it.bool) { if (typeof p[it.k] === 'boolean') it.set(p[it.k]); return; }
    var x = prefOk(p[it.k], it.lim(), it.int); if (x !== undefined) it.set(x);
  });
}
/** 船隻配置（船隻設定 cfg ＋ 船員 crew ＋ 艙房 rooms ＋ 換裝表 fit，照船型）：存檔、匯入共用這一支。每一項各自驗；網址有的那一項不套。 */
function shipsApply(p) {
  function num(v, lim, int) { if (typeof v !== 'number' || !isFinite(v)) return undefined; v = clamp(v, lim[0], lim[1]); return int ? Math.round(v) : v; }
  if (p.cfg && typeof p.cfg === 'object') Object.keys(p.cfg).forEach(function (id) {
    var d = p.cfg[id]; if (!hullInfo(id) || !d || typeof d !== 'object') return;
    var c = shipCfg(id);
    if (d.hard !== undefined && !d.hard1) d = Object.assign({}, d, { hard: d.hard / 3 });   // 舊存檔的硬度（預設 3 的刻度）⇒ 換成倍率
    SHIP_KEYS.forEach(function (k) { if (k !== 'ballast' && !Q.has(k)) { var x = num(d[k], LIM[k]); if (x !== undefined) c[k] = x; } });
    var b = num(d.ballast, LIM.ballast, true), T = HULLT[id];
    if (b !== undefined && typeof d.chk === 'number' && !Q.has('ballast')) { PREF_BALLAST[id] = { v: b, chk: d.chk }; if (T && T.h.checksum === d.chk) c.ballast = b; }   // 船型載好、checksum 對得上才套（cfgDefault）
  });
  if (p.crew && typeof p.crew === 'object') Object.keys(p.crew).forEach(function (id) {
    var d = p.crew[id]; if (!hullInfo(id) || !d || typeof d !== 'object') return;
    var c = SHIP_CREW[id] = SHIP_CREW[id] || {};
    CREW_ITEMS.forEach(function (it) { var x = num(d[it.k], it.lim, true); if (x !== undefined) c[it.k] = x; });
    if (d.guns && typeof d.guns === 'object') Object.keys(d.guns).forEach(function (t) { if (!GUNS[t]) return; var x = num(d.guns[t], [GUNS[t].min, GUN_CREW_MAX], true); if (x !== undefined) (c.guns = c.guns || {})[t] = x; });
  });
  if (p.rooms && typeof p.rooms === 'object') Object.keys(p.rooms).forEach(function (id) {   // 艙房的擺法（房名、格子在船型載好之前驗不了 ⇒ 照收，開戰時 roomCheck 再驗；不認得的類型、物品不收）
    var d = p.rooms[id]; if (!hullInfo(id) || !d || typeof d !== 'object') return;
    var c = SHIP_ROOMS[id] = SHIP_ROOMS[id] || {};
    Object.keys(d).forEach(function (k) { var v = roomPlanParse(d[k]); if (v !== undefined) c[k] = v; });
  });
  if (p.fit && typeof p.fit === 'object') fitApplyPrefs(p.fit);          // 換裝表（38_fit.js）：掛點有沒有、放不放得下要船型載好才知道 ⇒ 照收，載入時 fitApply 再驗
}
/** 艙房的擺法 { 船型: { 房名: '' ＝ 空著｜{ type }（自動擺滿）｜{ type, items } } }：diff ＝ 只留跟設定檔的預設不一樣的（存檔）；否則每一型玩家改過的全部（匯出）。 */
function roomsSnap(diff) {
  var o = {};
  Object.keys(SHIP_ROOMS).forEach(function (id) {
    var d = roomPlanDefault(id), p = SHIP_ROOMS[id], r = {};
    Object.keys(p).forEach(function (k) { if (!diff || JSON.stringify(p[k] || null) !== JSON.stringify(d[k] || null)) r[k] = p[k] || ''; });
    if (Object.keys(r).length) o[id] = r;
  });
  return o;
}
/** 船員配置：diff ＝ 只留跟那一型的預設不一樣的（存檔）；否則每一型整份（匯出）。 */
function crewSnap(diff) {
  var o = {};
  HULL_LIST.forEach(function (h) {
    var id = h.id, d = crewDefault(id), c = shipCrew(id), r = {}, g = {};
    CREW_ITEMS.forEach(function (it) { if (!diff || c[it.k] !== d[it.k]) r[it.k] = c[it.k]; });
    Object.keys(GUNS).forEach(function (t) { if (diff ? gunCrew(c, t) !== gunCrew(d, t) : true) g[t] = gunCrew(c, t); });
    if (Object.keys(g).length) r.guns = g;
    if (Object.keys(r).length) o[id] = r;
  });
  return o;
}
/** 匯出（船隻配置頁）：每一型整份的船隻設定與船員配置 ⇒ JSON 檔（換瀏覽器、換裝置再匯入；Tim 2026-10-14：編起來很花時間，要記錄）。 */
function shipsExport() {
  var cfg = {};
  HULL_LIST.forEach(function (h) { var c = cfgCopy(h.id), T = HULLT[h.id]; if (c.ballast === undefined || !T) { delete c.ballast; if (PREF_BALLAST[h.id]) { c.ballast = PREF_BALLAST[h.id].v; c.chk = PREF_BALLAST[h.id].chk; } } else c.chk = T.h.checksum; cfg[h.id] = c; });
  return { game: 'ame_constitution_broadside', kind: 'ships', v: 1, at: new Date().toISOString(), cfg: cfg, crew: crewSnap(false), rooms: roomsSnap(false), fit: fitSnap() };
}
/** 匯入：看得懂才套（game／kind 對得上）；回傳套了幾型。 */
function shipsImport(o) {
  if (!o || o.game !== 'ame_constitution_broadside' || o.kind !== 'ships') return -1;
  var ids = {}; [o.cfg, o.crew, o.rooms, o.fit].forEach(function (m) { if (m && typeof m === 'object') Object.keys(m).forEach(function (id) { if (hullInfo(id)) ids[id] = 1; }); });
  shipsApply(o); return Object.keys(ids).length;
}
function prefsSave() {
  if (!PREFS.write) return;
  var o = prefsSnap(), s = JSON.stringify(o);
  if (s === PREFS.last) return;
  try {
    if (Object.keys(o).length > 1) window.localStorage.setItem(PREFS_KEY, s); else window.localStorage.removeItem(PREFS_KEY);   // 全部是預設 ⇒ 不留一筆
    PREFS.last = s;
  } catch (e) { PREFS.write = false; PREFS.state = '存不了（' + (e && e.name || e) + '）'; }
}
/** 只把這幾項寫回存檔（遊戲中的畫質設定，71_input.js gfxOvClose）：網址帶了設定參數的那一場（Blocksail 地球儀開船：?mode= ?blue= …）PREFS.write 是 false ⇒ 整份不寫；
 *  畫質頁那幾項是玩家剛剛自己改的 ⇒ 照樣存，存檔裡其他項原封不動。PREFS.write ⇒ 照平常整份存。?prefs=0、?demo、?admin ⇒ 不存。 */
function prefsSaveOnly(keys) {
  if (!PREFS.read) return;
  if (PREFS.write) { prefsSave(); return; }
  var o, part = { v: PREFS_VER };
  try { o = JSON.parse(window.localStorage.getItem(PREFS_KEY) || 'null'); } catch (e) { return; }
  if (!o || typeof o !== 'object') o = { v: PREFS_VER };
  PREF_ITEMS.forEach(function (it) {
    if (keys.indexOf(it.k) < 0) return;
    delete o[it.k];
    if (it.snap) it.snap(part); else { var v = it.get(); if (v !== (it.bool ? it.def : it.lim()[2])) part[it.k] = v; }
  });
  keys.forEach(function (k) { if (part[k] !== undefined) o[k] = part[k]; });
  try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(o)); } catch (e) { /* 存不了就算了：這一場照樣用 */ }
}
var PREF_GFX = ['gfx', 'shk', 'smoke', 'debcap', 'fps'];               // 畫質頁的那幾項（07_gfx.js）
/** 細節設定的「重設預設值」：那一頁回到預設之後馬上存（船隻配置頁的不動：TASK-0570）。 */
function prefsReset() { PREFS.last = ''; prefsSave(); }
(function prefsLoad() {
  if (!PREFS.read) { PREFS.state = DEMO >= 0 ? '?demo ⇒ 不讀不存' : '?prefs=0 ⇒ 不讀不存'; return; }
  var s;
  try { s = window.localStorage.getItem(PREFS_KEY); } catch (e) { PREFS.read = PREFS.write = false; PREFS.state = '存不了（這個頁面不能用 localStorage）⇒ 照預設'; return; }
  if (s === null) PREFS.state = '沒有存檔（照預設）';
  else {
    var p = null; try { p = JSON.parse(s); } catch (e) { p = null; }
    if (!p || typeof p !== 'object' || p.v !== PREFS_VER) PREFS.state = '存檔看不懂（' + (p && typeof p === 'object' ? '版本 ' + p.v : '壞掉的 JSON') + '）⇒ 照預設';
    else { prefsApply(p); PREFS.state = '套用了本機存檔（' + (Object.keys(p).length - 1) + ' 項）'; }
  }
  if (!PREFS.write) PREFS.state += '；網址帶了設定參數 ⇒ 這一場不存';
  PREFS.last = JSON.stringify(prefsSnap());              // 套用後的樣子 ⇒ 玩家動了才寫（看不懂的存檔不會因為打開一次就被蓋掉）
  // 主選單按鈕的亮燈：外殼（71_input.js 主選單那一段）載入時照套用後的值點（玩法、距離、航行、帆的物理）
  $('autoF').classList.toggle('on', AUTOFIRE);
  if (!PREFS.write) return;
  setInterval(prefsSave, 1000);
  window.addEventListener('pagehide', prefsSave);
  document.addEventListener('visibilitychange', function () { if (document.hidden) prefsSave(); });
})();
