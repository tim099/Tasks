// ───────────────────────── 船的匯入檢查（?shipcheck=<船型>；Tim 2026-10-15：缺 meta、砲位擠到站不滿 ⇒ 匯入時就報出來，方便修） ─────────────────────────
// 遊戲自己判斷「缺了什麼、缺了會退回什麼」⇒ 檢查也放在遊戲裡（⛔ 在 admin.py 另寫一份規則 ⇒ 兩份總有一份先過期）。
// 跑法：載入那一型，跟憲法號擺在最遠的距離（打不到）開一場，固定步長跑 SC_SECS 秒，量完寫進頁面上 id 是 shipcheck 的 pre（JSON；⛔ 註解裡別寫那個標籤的原文 —— 成品內嵌這支程式，admin.py 會先比到註解）；
//   admin.py check／import／reimport 用無頭 Chrome 讀它、寫成報告。只讀，不改任何設定（不讀不存存檔：PREFS 照 ?shipcheck 關掉）。
// 每一筆：{ lv: 'error'｜'warn', what: 哪一類, where: 哪個部件, msg: 現在怎麼了（遊戲退回什麼）, fix: 怎麼修 }。
//   error ＝ 遊戲裡壞掉（開場就掉、砲開不動、斷掉的梯子…）；warn ＝ 能動，但照退路／預設跑（名字認、憲法號的數字…）。
var SC_SECS = 2;
/** 選船彈窗的卡片（Tim 2026-10-18「選船介面可以給船分類…不用載入所有船隻資訊 而是只載必要資訊」）：開戰那一刻量（還沒被打），admin.py shipcheck 寫進 config/ship_cards.json、建置時內嵌 ⇒ 主選單不用解碼船就有。
 *  tons ＝ 設計水線的排水量（T.disp）；len ＝ 水線長（公尺）；guns ＝ 砲（含迴旋砲、追擊砲）門數；volley ＝ 全部的砲各打一發的彈重（公斤，砲種表 shot）；
 *  drive ＝ 額外動力（31_drive.js D.kind：steam／oar／magic；沒有 ＝ sail）；sails ＝ 作品的帆（不算陣營旗）；crew ＝ 開戰時的人數。 */
function shipCard(sh) {
  var T = sh.T, D = sh.drive, vol = 0, by = {};
  sh.guns.forEach(function (g) { var G = GUNS[g.type] || {}; vol += +G.shot || 0; by[g.type] = (by[g.type] || 0) + 1; });
  return { tons: Math.round(T.disp || 0), len: +(((T.wl1 || T.hx1) - (T.wl0 || T.hx0)) * S).toFixed(1), guns: sh.guns.length, gunTypes: by, volley: Math.round(vol),
    drive: D && D.kind ? D.kind : 'sail', sails: sh.sails.filter(function (s) { return !(s.meta && s.meta.team); }).length, crew: sh.crew.length };
}
function shipCheck(id) {
  var R = { id: id, t: SC_SECS, issues: [], info: {} };
  function add(lv, what, where, msg, fix) { R.issues.push({ lv: lv, what: what, where: where, msg: msg, fix: fix }); }
  function done() { var pre = document.createElement('pre'); pre.id = 'shipcheck'; document.body.appendChild(pre); pre.textContent = JSON.stringify(R); uiAway(); window.__shipcheck = R; }
  Promise.all([loadHull(id), loadHull('constitution')]).then(function () {
    var info = hullInfo(id) || HULL_KNOWN.filter(function (h) { return h.id === id; })[0];
    if (!info) { add('error', '船型', id, '設定檔 ships 沒有這一型', 'admin.py import'); done(); return; }
    FLEET_DBG = [{ team: 'blue', hull: id }, { team: 'red', hull: 'constitution' }]; flowMode('eve'); DIST = LIM_DIST[1];
    WIND_FIX = { rot: 0, s0: 1 };                                        // 風固定（08_weather.js windInit；陣風照種子）：⛔ 沒固定 ⇒ Math.random() ⇒ 兩艘兩秒後的位置每次不同、迴旋砲的轉角跟著變，「送藥最遠」那一欄偶爾差 0.1 m（2026-10-21 量的）
    reset(); flowRun(true);
    var sh = SHIPS[0], T = sh.T, NV = sh.nav;
    // ── 開場那一刻（還沒跑）──
    var float0 = ropesFloating(sh).map(function (f) { return f.name + '#' + f.end + '（' + f.why + '）'; });
    R.binds = ropeBindsFresh(sh);                                        // 繩端綁定（TASK-0716）：開場那一刻現場算（不看檔頭的 bind）⇒ admin.py ropebind 寫進檔頭、出報表
    for (var i = 0, n = Math.round(SC_SECS / DT); i < n; i++) simStep();
    flowRun(false);
    R.info = { name: T.name, guns: sh.guns.length, crew: sh.crew.length, models: sh.models.length, ropes: sh.ropes.length, sails: sh.sails.filter(function (s) { return !(s.meta && s.meta.team); }).length, teamFlags: sh.sails.filter(function (s) { return s.meta && s.meta.team; }).length,   // 作品的帆／遊戲加的陣營旗分開數（77_colours.js；⛔ 混在一起 ⇒ 夜燈號 vxk 12 面、報告寫 15，basecamp 2026-10-15 問）
    masts: sh.masts.length, mags: sh.mags.length,
      decks: NV ? NV.levels.map(function (L) { return L.key + ' ' + L.name; }) : [], ladders: NV ? NV.ladders.length : 0, rooms: (sh.rooms || []).length, zw: T.zw, hits: SHIPS[1].hits + sh.hits };
    R.card = shipCard(sh);                                               // 選船彈窗的卡片（72_shippick.js；admin.py 寫進 config/ship_cards.json）
    if (sh.hits || SHIPS[1].hits) add('warn', '量測', '—', '量的這 ' + SC_SECS + ' 秒裡有砲彈打中（hits ' + (sh.hits + SHIPS[1].hits) + '）⇒ 下面「站不滿」「掉了」可能有被打的', '照舊看，或重跑');
    // ── 船型：水線、geo ──
    var p = (T.h.parts || []).filter(function (q) { return q.meta && q.meta.kind === 'ship'; })[0], wm = (p && p.meta) || T.h.meta || {};
    if (!(isFinite(+wm.waterline_z) && +wm.waterline_z > 0) && id !== 'constitution') add('warn', '水線', '船殼', info.zw0 ? '沒有 meta kind=ship waterline_z ⇒ 用設定檔的 zw0 ' + info.zw0 : '沒有 meta kind=ship waterline_z ⇒ 用憲法號的 ' + ZW0 + '（排水量跟著錯）', '船殼的關聯（或組裝件）meta kind=ship, waterline_z=<設計水線>（造船規格 §9）');
    var C = SHIPS[1].T, rl = (T.hx1 - T.hx0) / (C.hx1 - C.hx0), rh = T.sz / C.sz;   // 跟憲法號比大小：差不到一成（餘燼號從憲法號改的）⇒ 憲法號的 geo 本來就對
    if (!info.geo && id !== 'constitution' && (Math.abs(rl - 1) > 0.1 || Math.abs(rh - 1) > 0.1)) add('warn', 'geo', '設定檔', '沒填 geo ⇒ 陸戰隊站的範圍、瞄準高度、鏡頭中心都是憲法號的數字（這艘長 ×' + rl.toFixed(2) + '、高 ×' + rh.toFixed(2) + '）', '遊戲那側填 config/game.json ships[].geo（造船規格 §9.4）');
    // ── meta 規格表（TASK-0672；config/meta_kinds.json）：作品裡用到、規格表沒有的 kind ⇒ 遊戲不認（照一般模型／關聯／帆／繩）；掛的地方跟規格表不一樣也報 ──
    if (!META_SPEC) add('warn', 'meta 規格表', '—', '成品裡沒有 #meta-kinds ⇒ 照不了規格表', 'python -I admin.py build（template.html 要有 meta-kinds 那一行）');
    var MK = {};
    [['link', T.h.parts], ['model', T.rig.models], ['sail', T.rig.sails], ['rope', T.rig.ropes]].forEach(function (A) {
      (A[1] || []).forEach(function (q) {
        var k = q && q.meta && q.meta.kind; if (!k) return;
        var K = Object.prototype.hasOwnProperty.call(META_KINDS, k) ? META_KINDS[k] : null, key = k + '|' + A[0] + '|' + (K ? (K.on.indexOf(A[0]) >= 0 ? 'ok' : 'on') : 'none');
        (MK[key] = MK[key] || []).push(q.path || q.name);
      });
    });
    Object.keys(MK).forEach(function (key) {
      var p = key.split('|'), L = MK[key], where = L.length > 3 ? L.slice(0, 3).join('、') + ' 等 ' + L.length + ' 個' : L.join('、');
      if (p[2] === 'none') add('warn', 'meta 規格表', where, 'kind=' + p[0] + ' 規格表沒有 ⇒ 遊戲不認，照一般' + { link: '關聯', model: '模型', sail: '帆', rope: '繩' }[p[1]] + '處理', '要遊戲照它分流 ⇒ src/config/meta_kinds.json 加一列（造船規格照舊寫）；寫錯字 ⇒ 改 meta');
      else if (p[2] === 'on') add('warn', 'meta 規格表', where, 'kind=' + p[0] + ' 掛在' + { link: '關聯', model: '模型', sail: '帆', rope: '繩' }[p[1]] + '上，規格表寫的是 ' + META_KINDS[p[0]].on.join('／'), '照造船規格 ' + (META_KINDS[p[0]].doc || '') + ' 掛，或規格表的 on 加上這一種');
    });
    R.info.metaKinds = Object.keys(MK).filter(function (key) { return /\|ok$/.test(key); }).map(function (key) { return key.split('|')[0]; }).filter(function (k, i, a) { return a.indexOf(k) === i; }).join('、');
    // ── 物件 id 與指名（TASK-0715；造船規格 §12；05_hull.js idIndex／refPath）：沒有 id、撞號、指不到、指錯類、還是舊的路徑寫法 ──
    var IX = T.ids || idIndex(T.h);
    if (IX.none) add('warn', '物件 id', '—', IX.none + ' 件關聯／模型沒有 id ⇒ 別的部件指名不到它', 'python -I admin.py ids --id ' + id);
    IX.dup.forEach(function (d) { var j = d.indexOf('：'); add('error', '物件 id', d.slice(0, j), 'id 撞號：' + d.slice(j + 1) + ' ⇒ 指名它的只會找到第一件', '改回唯一（admin.py ids 發號不會撞；多半是手改或複製出來的）'); });
    [T.h.parts, T.rig.models, T.decos].forEach(function (A) {            // decos：裝飾在載入時就從 rig.models 拿掉了（05_hull.js decoSplit）⇒ 另外看（砲門蓋板的 lid_of，TASK-0719）
      (A || []).forEach(function (q) {
        var mt = q.meta || {}, K = Object.prototype.hasOwnProperty.call(META_KINDS, mt.kind) ? META_KINDS[mt.kind] : null, RF = K && K.refs; if (!RF) return;
        Object.keys(RF).forEach(function (f) {
          var sp = RF[f], old = sp.old || f, v = mt[f] !== undefined ? mt[f] : mt[old], where = q.path || q.name; if (v === undefined || v === '') return;
          (sp.list ? String(v).split(',').map(function (x) { return x.trim(); }) : [String(v)]).forEach(function (s) { one(sp, f, old, where, s); });   // list：可以指好幾件（逗號分開；彈藥庫 hoist）⇒ 每一件各查一次
        });
      });
    });
    function one(sp, f, old, where, s) {
      var i = s.indexOf('#'), ip = i < 0 ? s : s.slice(0, i), sub = i < 0 ? '' : s.slice(i + 1);
      if (!ID_RX.test(ip)) { add('warn', '物件 id', where, old + '=' + s + ' 是舊的路徑寫法 ⇒ 改名、搬資料夾就斷', 'python -I admin.py ids --id ' + id + ' 會換成 ' + f + '=<id>'); return; }
      var r = IX.by[ip]; if (!r) { add('error', '物件 id', where, f + '=' + s + ' 找不到這個 id ⇒ 遊戲當成沒寫', '寫這艘船裡有的 id（造船規格 §12）'); return; }
      var k = (r.q.meta && r.q.meta.kind) || '', ok = sp.to.some(function (t) { return t.slice(-1) === '#' ? i >= 0 && k === t.slice(0, -1) : i < 0 && k === t; });
      if (!ok) { add('error', '物件 id', where, f + '=' + s + ' 指到的是 ' + (k || '（沒有 kind）') + (i >= 0 ? '#' + sub : '') + '，規格表只收 ' + sp.to.join('、'), '照規格表 refs 指（config/meta_kinds.json）'); return; }
      if (sub && !Object.keys(r.q.points || {}).some(function (n) { return n.indexOf(sub + '.') === 0; })) add('error', '物件 id', where, f + '=' + s + '：' + r.path + ' 裡沒有「' + sub + '」這一座', '# 後面寫那一座的名字（固定點 <名>.foot 的 <名>）');
    }
    R.info.ids = Object.keys(IX.by).length + ' 件有 id' + (IX.none ? '、' + IX.none + ' 件沒有' : '');
    var RG = sh.ropes.filter(function (r) { return r.guess; });            // 繩端照外框猜綁到模型上（10_ship.js linkRopes：作品的 ends 沒寫綁哪個模型才猜）
    if (RG.length) add('warn', '物件 id', RG.slice(0, 3).map(function (r) { return r.name; }).join('、') + (RG.length > 3 ? ' 等 ' + RG.length + ' 條' : ''), '繩端是照位置猜綁到模型上的（作品沒寫綁哪個模型）⇒ 模型一換、一搬就可能綁錯', '雕刻端把繩端綁到模型的固定點（ends 寫 model:<模型>/<固定點>）');
    // ── 換裝（TASK-0713／0714；38_fit.js）：出廠的換裝表 ships[].fit 換不成的那幾件（掛點沒有、類別不合、放不下、零件表沒有、不能拆空）⇒ 照原本雕的那一件 ──
    ((T.fit && T.fit.bad) || []).forEach(function (b) { add('error', '換裝', b.slot + (b.path ? '（' + b.path + '）' : ''), '換成 ' + fitValName(b.to) + ' 沒換成：' + b.why + ' ⇒ 照原本雕的那一件', '改 config ships[].fit，或掛點 meta fits=；零件表 python -I admin.py parts'); });
    if (T.fit && (T.fit.done.length || (T.fit.gone || []).length)) R.info.fit = T.fit.done.map(function (d) { return d.slot + ' ' + d.from + '→' + fitValName(d.to) + '（零件：' + d.src + (d.mirror ? '、鏡射' : '') + '）'; }).concat((T.fit.gone || []).map(function (g) { return g.slot + ' 拆掉'; })).join('、') + (T.fit.ropesDropped ? '；拿掉 ' + T.fit.ropesDropped + ' 條綁在零件沒有的固定點上的繩' : '');
    // ── 裝飾（TASK-0682；05_hull.js decoSplit）：模型 meta deco=1 ⇒ 載入時從 rig.models 拿掉（照樣載、畫質「裝飾」開著才畫）—— 不算重量、不被打；規格表標 deco 的 kind（砲門蓋板 portlid）本身就是裝飾 ⇒ 不報 ──
    (T.decos || []).forEach(function (m) { var k = m.meta && m.meta.kind; if (k && !kindProp(k, 'deco')) add('warn', '裝飾', m.name, '標了 deco 又有 kind=' + k + ' ⇒ 只是畫面、不進模擬，那個功能在遊戲裡就沒了', '有功能的模型不標 deco（造船規格 §9.9）'); });
    (T.h.parts || []).forEach(function (q) { if (isDeco(q)) add('warn', '裝飾', q.path, '關聯標了 deco ⇒ 遊戲不拿掉（格子是船的一部分：重量、命中照算）；只有外部模型能隱藏', '做成外部模型再標 deco（造船規格 §9.9）'); });
    R.info.deco = T.decoN ? T.decoN + ' 個模型' + '（畫質「裝飾」' + (GFX.deco ? '開：畫' : '關：不畫' + (T.decos.some(function (m) { return m.meta && m.meta.kind === 'portlid'; }) ? '，砲門蓋板照畫（每艘、每個畫質都畫）' : '')) + '）' + '；不算重量、不被打' : '';
    // ── 廚房（TASK-0720；45_galley.js galleyInit）：模型 meta kind=galley 的爐灶 ⇒ 那一層走得到、四周有面站得住廚師（第二個面給伙夫領飯）；走不到 ⇒ ⚠（那一座不開） ──
    var GL = sh.galley ? sh.galley.list : [];
    (sh.galleySkip || []).forEach(function (k) { if (/走不到/.test(k.why)) add('warn', '廚房', k.name, k.why + ' ⇒ 這一座不開（沒有廚師、沒人去領飯）', '爐灶四周（爐門那一面優先）留一面站得下人、從待命那一層走得到（造船規格 §9.13）'); });
    R.info.galley = GL.length ? '廚房 ' + GL.length + ' 座：' + GL.map(function (S) { return S.m.path + '（廚師 ' + S.cooks.length + ' 位、站得住的面 ' + S.faces.length + ' ✓）'; }).join('、')
      : (sh.galleySkip || []).length ? '廚房沒開：' + sh.galleySkip.map(function (k) { return k.name + '（' + k.why + '）'; }).join('、') : '';
    // ── 模型 ──
    spinIssues(sh, add);                                                // 照參數轉的子物件寫了 spin 卻轉不起來（26_spin.js，TASK-0640）
    sh.models.forEach(function (m) {
      var mt = m.meta || {};
      if (mt.kind === 'gun' && mt.weapon && !GUN_WEAPON[mt.weapon]) add('warn', '武器', m.path, 'meta weapon=' + mt.weapon + ' 砲種表沒有 ⇒ 照 gun=' + mt.gun + ' 算', 'weapon 寫砲種表有的（' + Object.keys(GUN_WEAPON).join('、') + '），或拿掉');
      if (mt.kind === 'gun' && !GUN_CODE[mt.gun] && !GUN_WEAPON[mt.weapon]) add('error', '砲', m.path, 'meta gun=' + mt.gun + ' 不認得 ⇒ 默默當成長砲', 'gun 寫砲種表有的代碼（' + Object.keys(GUN_CODE).join('、') + '）');
      if (!mt.kind && GUNS[m.kind]) add('warn', '砲', m.path, '沒有 meta ⇒ 照名字認成 ' + m.kind, 'meta kind=gun, gun=<砲種>');
      if (!mt.kind && m.kind === 'wheel') add('warn', '舵輪', m.path, '沒有 meta ⇒ 照名字認', 'meta kind=wheel');   // 只剩操舵的開關關掉時會照名字認（10_ship.js modelKind）
      if (HELM_TQ && !mt.kind && /wheel|tiller|舵輪|舵柄/.test(m.name.split('/').pop())) add('error', '舵輪', m.path, '名字像舵輪／舵柄、沒有 meta kind ⇒ 不算操作端（打掉不影響舵效）', 'meta kind=wheel（或 tiller；造船規格 §9.8.1）');   // TASK-0777：照名字認拿掉了
      if (m.kind === 'rudder' && !m.pts['stock-top']) add(isFinite(+mt.hinge_x) ? 'warn' : 'error', '舵', m.path, isFinite(+mt.hinge_x) ? '沒有固定點 stock-top ⇒ 沿鉸鏈軸找船尾（退路）' : '沒有 stock-top、也沒有 hinge meta ⇒ 往下找、開局就掉', '舵子作品登記固定點 stock-top（舵頭；造船規格 §9）');
      if (m.kind === 'yard' && !m.piv) add('error', '帆桁', m.path, '沒有固定點 pivot ⇒ 找不到掛在哪根桅', '帆桁子作品登記 pivot（造船規格 §5）');
      if (m.kind === 'propeller' && !m.pts.hub) add('warn', '螺旋槳', m.path, '沒有固定點 hub ⇒ 推力作用點、轉軸都用外框中心', '螺旋槳子作品登記 hub（轉軸中心；造船規格 §9 propeller）');
      if (m.kind === 'propeller' && !(Math.abs(+mt.axis_x || 0) + Math.abs(+mt.axis_y || 0) + Math.abs(+mt.axis_z || 0) > 0)) add('warn', '螺旋槳', m.path, '沒有 meta axis_x／y／z ⇒ 照 +x（船頭方向）轉', 'meta axis_x=1, axis_y=0, axis_z=0（造船規格 §9 propeller）');
      if (m.kind === 'propeller' && !m.pts['shaft-fwd']) add('warn', '螺旋槳', m.path, '沒有固定點 shaft-fwd ⇒ 掛在正下方的船殼上（底下被打掉才掉、軸斷了不掉）', '登記 shaft-fwd（軸往前接到船殼那一格）');
      if (m.kind === 'propeller' && !(sh.cfg.base > 0)) add('warn', '螺旋槳', m.path, '設定檔沒有額外動力（cfg.base）⇒ 螺旋槳不會轉、船不靠它走', 'ships[].cfg.base 填史料航速（節）');
      if (m.kind === 'oar' && !m.pts.pivot) add('error', '槳', m.path, '沒有固定點 pivot（槳座）⇒ 不算動力、沒有槳手、往下找腳（槳伸在舷外 ⇒ 開局就掉）', '槳子作品登記 pivot（轉的中心：槳靠在舷緣的那一點；造船規格 §9.10）');
      if (m.kind === 'oar' && m.pts.pivot && !m.pts.blade) add('warn', '槳', m.path, '沒有固定點 blade（槳葉端）⇒ 槳手照「往中線」排', '登記 blade（槳葉末端；造船規格 §9.10）');
      if (m.kind === 'oar' && !(sh.cfg.base > 0)) add('warn', '槳', m.path, '設定檔沒有額外動力（cfg.base）⇒ 槳不划、船不靠它走', 'ships[].cfg.base 填划槳的全速（節）');
      if (m.kind === 'door') {                                           // 門、艙蓋（TASK-0638；25_doors.js、造船規格 §9 door）
        var dr = (sh.doors || []).filter(function (d) { return d.m === m; })[0];
        if (!dr || !dr.a) add('error', '門', m.path, '沒有固定點 hinge-a／hinge-b（或兩點重疊）⇒ 開關不演出、腳往正下方找（艙口底下）', '門子作品登記 hinge-a、hinge-b（鉸鏈軸上兩點；造船規格 §9 door）');
        else if (mt.open && (mt.open !== 'up' && mt.open !== 'side' || (mt.open === 'side') !== (Math.abs(dr.ax[2]) > 0.7))) add('warn', '門', m.path, 'meta open=' + mt.open + ' 跟鉸鏈軸對不上（軸' + (Math.abs(dr.ax[2]) > 0.7 ? '垂直 ⇒ 左右開' : '水平 ⇒ 上下開') + '）⇒ 照鉸鏈軸開', 'open 寫 up（鉸鏈水平）或 side（鉸鏈垂直），或改鉸鏈的兩點');
        if (dr && !dr.cells.length) add('warn', '門', m.path, '門正下方那一層（z ' + dr.zt + '）沒有原本就空的格 ⇒ 門被打掉也不會從這裡進水', '門擺在開口上面（外框底面 ＝ 開口那一層的上一格）');
      }
      var sn = m.name.replace(/^.*yard-/, ''), hasSail = sh.sails.some(function (s) { return s.name === sn; });   // 沒掛帆的帆桁（crossjack、spritsail 常見）不用寫 sail
      if (m.kind === 'yard' && ((!mt.sail && hasSail) || (!mt.mast && !/bowsprit|艏斜桅/.test(m.path)))) add('warn', '帆桁', m.path, '帆桁 meta 少了 ' + [!mt.sail && hasSail && 'sail（有一面帆叫 ' + sn + '）', !mt.mast && 'mast'].filter(Boolean).join('、') + ' ⇒ 照名字配帆／桅', '帆桁 meta sail=<帆名>、mast=<桅>（造船規格 §9.1）');
      if (!m.alive && !GUNS[m.kind] && !kindProp(m.kind, 'noFall')) add('error', '開場就掉', m.path, (mt.kind || m.kind) + ' 開場 ' + SC_SECS + ' 秒內就判成沒東西撐、掉了（腳 z ' + (m.foot >> 21) + '）', '把它接到實心上；掛著的（燈、舵）登記掛點固定點（bail、stock-top）');
    });
    // ── 動力（TASK-0630；造船規格 §9.6）：主機 → 軸 → 螺旋槳、鍋爐 ──
    var DV = sh.drive, DC = DV && DV.C, DP = DV ? DV.P.filter(function (q) { return q.kind !== 'sail' && q.kind !== 'rudder'; }) : [];
    // ── 操舵（TASK-0777，31_drive.js「操舵」）：每支舵的鏈（舵令 ⇒ 舵輪／舵柄（＋舵索）⇒ 舵）與份量；差動（兩舷都有動力）；沒有舵模型 ⇒ 看不見的舵（退路） ──
    if (DV && DV.R) {
      R.info.helm = DV.R.map(function (q) { return '舵令 ⇒ ' + (q.ops.length || q.lks.length ? q.ops.concat(q.lks).map(function (m) { return m.path; }).join('＋') + ' ⇒ ' : '（舵柄在舵上）⇒ ') + (q.m ? q.m.path : q.out) + ' ' + Math.round(q.w * 100) + '%'; }).join('；') +
        (DV.dif ? '；差動：兩舷都有動力（舵令直接給兩舷，不經過舵輪）' : '');
      if (!DV.R[0].m) add('warn', '舵', '—', '沒有舵模型 ⇒ 船尾中線一支看不見的舵（完好度照船尾那一塊格子）', '舵子作品標 meta kind=rudder、登記 stock-top（造船規格 §9.8.1）');
    }
    if (DV && DV.kind === 'oar') { var oS = DP.filter(function (q) { return q.sg > 0; }).length; R.info.drive = '槳 ' + DP.length + ' 支（左舷 ' + (DP.length - oS) + '、右舷 ' + oS + '）、槳手 ' + sh.crew.filter(function (c) { return c.role === ROLE.OAR; }).length + '／' + (sh.oarWant || 0) + '（每支 ' + DP.map(function (q) { return q.rw0; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join('／') + ' 人）'; }
    else if (DV && DV.kind) R.info.drive = (DV.kind === 'magic' ? '魔法（作用點 ＝ 船）' : DP.map(function (q) { return (q.m ? '螺旋槳 ' + q.m.name : q.out) + ' ' + Math.round(q.w * 100) + '%'; }).join('、')) +
      (DC ? '；主機 ' + DC.E.length + '、軸 ' + DC.SH.length + '、鍋爐 ' + DC.B.reduce(function (a, c) { return a + c.b.seats.length; }, 0) + ' 座' : '');
    if (DV && DV.kind === 'oar' && sh.models.some(function (m) { return m.kind === 'propeller'; })) add('warn', '動力', '—', '有槳又有螺旋槳 ⇒ 只算槳（31_drive.js：份量怎麼分還沒定）', '跟 Tim 確認這艘的動力怎麼分');
    if (DV && DV.kind === 'oar') { var oP = DP.length - DP.filter(function (q) { return q.sg > 0; }).length; if (oP !== DP.length - oP) add('warn', '槳', '—', '左右舷槳數不一樣（左 ' + oP + '、右 ' + (DP.length - oP) + '）⇒ 全速時會往少的那一舷偏', '兩舷照對稱擺，或確認是故意的'); }
    if (DC) DP.forEach(function (q) { if (DC.E.length && !(q.w > 0)) add('warn', '動力', q.m ? q.m.path : q.out, '沒有主機推這個輸出物件 ⇒ 不出力', '主機 meta propeller=<螺旋槳模型名>，或讓軸的 aft 靠近 hub（24 格內）、fwd 靠近主機 core'); });
    if (DC) DC.B.forEach(function (c) { if (c.b.funnel && !funnelsOf(T).some(function (f) { return f.name === c.b.funnel; })) add('warn', '鍋爐', c.b.name, 'meta funnel=' + c.b.funnel + ' 找不到這條煙囪 ⇒ 鍋爐壞了也不會停煙', 'funnel 寫煙囪關聯的路徑（一字不差）'); });
    // ── 動力件（TASK-0653；31_drive.js 檔頭「動力件」）：每一件開局幾格；傳動件（軸、蒸汽管）兩端之間開局有幾條不共用格子的路、傳不傳得滿 ──
    var PT = drvParts(T), dl = [];
    (T.h.parts || []).forEach(function (q) {
      var k = q.meta && q.meta.kind, K = META_KINDS[k]; if (!K || K.drv !== 'part') return;   // 動力件：規格表標 drv=part 的（主機、鍋爐、軸、蒸汽管）
      if (!PT.E.concat(PT.B, PT.SH, PT.SP).some(function (o) { return o.name === q.path; })) add('warn', '動力件', q.path, 'meta kind=' + k + ' 缺固定點（' + K.need.concat(K.use).join('、') + '）⇒ 遊戲不認這一件', '補固定點（造船規格 ' + K.doc + '）');
    });
    PT.E.concat(PT.B, PT.SH, PT.SP).forEach(function (o) {
      var kind = o.kind || (PT.E.indexOf(o) >= 0 ? 'engine' : 'boiler'), nm = DRVP[kind].name;
      if (!o.cells) { dl.push(o.name + '（' + nm + '，沒有格子清單 ⇒ 舊判法：固定點旁 ±' + DRV_PART_R + ' 格）'); if (PT.cells) add('warn', '動力件', o.name, '同一艘有別的件帶格子清單、這一件沒有 ⇒ 這一件照舊判法（固定點旁 ±' + DRV_PART_R + ' 格剩一半）', 'python -I admin.py metasync --id ' + T.id + '（匯出時 drive_cells 寫 cellRuns）'); return; }
      if (!(o.c0 > 0)) { add('warn', '動力件', o.name, '格子清單在、可是開局一格都不在 ⇒ 量不出剩幾成、當作一直好的', '重匯（格子清單跟船殼對不上）'); dl.push(o.name + '（' + nm + '，開局 0 格）'); return; }
      var s = o.name + '（' + nm + '，' + o.c0.toLocaleString('en') + ' 格' + (o.tubeN ? '＋穿過船殼借 ' + o.tubeN.toLocaleString('en') + ' 格' : '');
      if (o.a) {
        var need = drvNeed(kind), f = drvFlow0(T, o, need);
        s += '，開局 ' + (f >= need ? '≥ ' + need + ' 條路、傳得滿' : f + ' 條路' + (f ? '（傳滿要 ' + need + ' 條 ⇒ 照開局當滿載）' : ''));
        if (!f) add('warn', '動力件', o.name, nm + '兩端之間開局就不通 ⇒ 判不了、當作一直通（打斷也不會停）', '格子要從一端的固定點連到另一端（26 鄰；端點 ＝ 固定點 ' + DRV_END_R + ' 格內的格），或固定點挪到格子上');
        else if (f < need) add('warn', '動力件', o.name, nm + '最細那一截只有 ' + f + ' 條路（每格 ' + Math.round(DRVP[kind].cell * 100) + '%、傳滿要 ' + need + ' 條）⇒ 開局照滿載算，打掉一條就少 ' + Math.round(100 / f) + '%', '雕粗一點（造船規格 §9.6），或道具設定頁調「每格傳幾成」');
      }
      dl.push(s + '）');
    });
    R.info.drvparts = dl.join('；');
    R.info.props = propSummary(sh);                                     // 會轉的體素件（螺旋槳；24_armor.js propSetup）
    if (T.hullVox && T.hullVox.length) R.info.hullVox = T.hullVox.map(function (q) { return q.path + '（' + ((META_KINDS[q.kind] || {}).name || q.kind) + '，' + q.n.toLocaleString('en') + ' 格' + (q.ovl ? '，蓋掉船殼 ' + q.ovl.toLocaleString('en') + ' 格' : '') + '）'; }).join('；');   // 自帶格子的模型放回船殼（38_fit.js fitHullVox，TASK-0793）；沒有 ⇒ 不寫這一欄（舊船報表不變）
    sh.models.forEach(function (m) { if (m.meta && m.meta.kind === 'propeller' && !m.vox) add('warn', '螺旋槳', m.path, '檔頭沒有它的格子（rig.models[].vox）⇒ 照舊是模型：一發扣血、打不碎、推力不照剩幾成', 'python -I admin.py metasync --id ' + T.id + '（admin.py prop_vox：模型要平移放、不旋轉不縮放）'); });
    // ── 錨（TASK-0601）：模型錨（meta kind=anchor）＋錨環 ring、船殼的錨鏈孔 hawse-P／S（造船規格 §9 anchor）──
    var AN = anchorsOf(sh);
    if (AN.noAnchor) add('warn', '錨', '整艘', '找不到錨（沒有 meta kind=anchor 的模型、也沒有名字有「錨」的關聯）⇒ 不能拋錨：6／7／8 變成停船', '要能拋錨 ⇒ 放共用錨元件（造船規格 §9 anchor）');
    R.info.anchors = AN.noAnchor ? '沒有錨（6／7／8 ＝ 停船）' : (AN.single ? '單錨（' + (AN.single === 'P' ? '左' : '右') + '舷；左右錨按鈕不顯示、6 只拋這一個）：' : '') + ['P', 'S'].filter(function (k) { return !AN[k].none; }).map(function (k) { var a = AN[k]; return (k === 'P' ? '左' : '右') + (a.m ? ((T.rig.models[a.m.k] || {}).fromPart ? '關聯拆出的模型（' + T.rig.models[a.m.k].fromPart + ' 格）' : '模型') + (a.m.pts.ring ? '＋ring' : '') : a.part ? '格子' : '無') + (a.hw ? '＋hawse' : ''); }).join('、');
    ['P', 'S'].forEach(function (k) {
      var a = AN[k];
      if (a.none) return;                                               // 單錨的船：另一舷本來就沒有（TASK-0635；不補、不報）
      if (a.m && !a.m.pts.ring) add('warn', '錨', a.m.path, '模型錨沒有固定點 ring ⇒ 鐵鍊接在模型頂的中心', '錨子作品登記 ring（造船規格 §9 anchor；共用錨元件已經有）');
      else if (a.part) add('warn', '錨', a.part.path, '錨是關聯（格子）、不是模型 ⇒ 拋下去時船上那團格子不動、鍊尾另外畫一個簡單的錨', '換成共用錨元件（外部模型、meta kind=anchor），或在這條關聯標 meta kind=anchor（誰都能標；admin.py metasync 補 cells，遊戲拆出來當模型錨）');
      else if (!a.m) add('warn', '錨', k === 'P' ? '左舷' : '右舷', '這一舷的錨沒有模型、也不是關聯（不該走到這裡：單錨與沒有錨都在上面處理了）', '放共用錨元件（造船規格 §9 anchor）');
      if (!a.hw) add('warn', '錨鏈孔', '船殼', '沒有固定點 hawse-' + k + ' ⇒ 鐵鍊從錨那一點出來、船繞錨那一點被拴住', '船殼登記 hawse-P／S（造船規格 §9 anchor），或在錨的 meta 標 hawse="x,y,z"（誰都能標）');
    });
    // ── 材質（TASK-0616）：全船預設＋關聯 meta material；材質表沒有的 ID ⇒ 照全船預設 ──
    R.info.materials = matSummary(T).map(function (m) { return (m.def ? '全船預設 ' : '') + m.name + '（' + m.id + '）' + m.voxels.toLocaleString('en') + ' 格、' + m.t + ' 噸'; }).join('；');
    T.matBad.forEach(function (id) { add('warn', '材質', id, '材質表沒有這個 ID ⇒ 照全船預設 ' + T.mat0, '後台的材質表加這一種，或把關聯 meta material 改成材質表有的 ID（造船規格 §9.5）'); });
    // ── 平滑渲染（TASK-0616 ⑧）：關聯 meta render（voxel｜smooth）；檔頭 render 段落 ⇒ T.smG（05_material.js）──
    var smP = (T.h.parts || []).filter(function (p) { return p.meta && p.meta.render === 'smooth'; });
    R.info.smooth = (smP.length ? smP.map(function (p) { return p.path; }).join('、') + '（平滑 ' + (T.smN - T.smAuto).toLocaleString('en') + ' 格）' : '') +
      (T.smAuto ? (smP.length ? '；' : '') + '材質標平滑的金屬（' + T.matIds.filter(function (id, i) { return i && matInfo(id).smooth === true; }).map(function (id) { return matInfo(id).name; }).join('、') + '）' + T.smAuto.toLocaleString('en') + ' 格' : '') +
      ((T.props || []).some(function (P) { return P.smP; }) ? '；螺旋槳整份平滑：' + T.props.filter(function (P) { return P.smP; }).map(function (P) { return P.name + ' ' + P.n.toLocaleString('en') + ' 格'; }).join('、') : '');   // Tim 2026-10-17：金屬件光滑（05_material.js、24_armor.js propSetup）
    R.info.smoothN = T.smN;
    if (smP.length && !(T.smN - T.smAuto)) add('warn', '平滑渲染', smP.map(function (p) { return p.path; }).join('、'), '關聯標了 render=smooth，檔頭卻沒有平滑的格（render 段落）⇒ 照方塊畫', 'python -I admin.py reimport --id ' + T.id + '（senate 匯出才帶 render 段落）');
    (T.h.parts || []).forEach(function (p) { var v = p.meta && p.meta.render; if (v && v !== 'smooth' && v !== 'voxel') add('warn', '平滑渲染', p.path, 'meta render=' + v + ' 不認得 ⇒ 照方塊畫', 'render 只有 voxel｜smooth（造船規格 §9.5）'); });
    sh.guns.forEach(function (g) { if (!g.alive) add('error', '開場就掉', g.name, '砲開場 ' + SC_SECS + ' 秒內就沒了', '砲腳下要有甲板'); });
    // ── 砲班站位（三叉戟號船頭：砲靠太近、站位互佔 ⇒ 站不滿；Tim 2026-10-15）──
    var shortN = 0, shortG = 0;
    sh.guns.forEach(function (g) {
      var got = (g.spots || []).length; if (got >= g.crewFull) return;
      shortG++; shortN += g.crewFull - got;
      var d = gunDeck(g), near = null, nd = 1e9;
      sh.guns.forEach(function (o) { if (o === g || gunDeck(o) !== d || o.side !== g.side) return; var dd = Math.abs(o.model.c[0] - g.model.c[0]); if (dd < nd) { nd = dd; near = o; } });
      add(got < g.crewMin ? 'error' : 'warn', '砲班站不滿', g.name, g.type + ' 站得到 ' + got + '／' + g.crewFull + ' 人' + (got < g.crewMin ? '（少於開得動的 ' + g.crewMin + ' 人）' : '') + '，' + d + ' ' + g.side + ' 舷' +
        (near ? '；同一層同一舷最近的砲 ' + near.name.split('/').pop() + ' 隔 ' + (nd * S).toFixed(2) + ' m' : ''), '砲旁邊（砲尾兩側與後方）留出站位：拉開砲距、或少放一門；旁邊的模型別佔站位');
    });
    R.info.gunShort = { guns: shortG, people: shortN };
    (sh.crewShort || []).forEach(function (r) { if (r[3] !== 'guns') add('warn', '站不下', r[0], r[0] + ' 站得到 ' + r[2] + '／' + r[1], r[3] === 'marines' ? '遊戲那側調 geo.marines（陸戰隊站的範圍）或船員配置' : '遊戲那側調船員配置，或甲板上留出站位'); });
    // ── 甲板、梯子、艙房 ──
    if (NV) {
      NV.levels.forEach(function (L, li) {
        if (!L.deck) add('warn', '甲板', L.key + ' ' + L.name, '沒有 meta kind=deck ⇒ 照高度量', '甲板的關聯 meta kind=deck（level、name、floor、thick；造船規格 §9.3）');
        if (NV.reach.indexOf(li) < 0) add('warn', '甲板', L.key + ' ' + L.name, '沒有梯子通到 ⇒ 預備水手、傷員到不了', '加梯子（kind=ladders 四個點），或梯子 meta <梯名>.decks 指定兩層');
      });
      NV.ladders.forEach(function (L) { if (L.broken) add('error', '梯子', L.name, '開場就是斷的（踏板或兩頭的走路點不能站）', '對 foot／lo／hi／head 四個點（踩的那一格空氣）'); });
      var ropeLad = [];
      (sh.ladDrop || []).forEach(function (d) {                         // 被尋路靜悄悄丟掉的梯子（42_hands.js makeHands；TASK-0672：餘燼號、憲法號的貨艙梯子量出來的）
        var z = function (p) { return 'z ' + Math.floor(p[2]); };
        if (d.rope) { ropeLad.push(d.name); return; }                   // 繩梯（橫繩組 climb）：頂端在桅上、本來就不在甲板 ⇒ 只給第一人稱爬，不算丟掉
        add('warn', '梯子', d.name, '尋路沒收這一座：' + d.why + '（foot ' + z(d.a) + '、head ' + z(d.b) + '）⇒ 預備水手、傷員不走這座（第一人稱照樣爬得到）', '梯子兩頭落在宣告了 kind=deck 的甲板上（造船規格 §9.3），或梯子 meta <梯名>.decks 直接指定兩層');
      });
      if (ropeLad.length) R.info.ropeLadders = ropeLad.length + ' 座繩梯只給第一人稱爬（頂端不在甲板上 ⇒ 尋路不走）：' + ropeLad.join('、');
      if (!NV.ladders.length && NV.levels.length > 1) add('warn', '梯子', '—', '有 ' + NV.levels.length + ' 層甲板、沒有梯子', 'kind=ladders');
    }
    (T.roomsBad || []).forEach(function (b) { add('error', '艙房', b, '艙房標得不對', 'rooms.py check（造船規格 §9.2）'); });
    (sh.medSkip || []).forEach(function (s) { add('warn', '醫療艙', s.name, s.why, '房間所在的甲板要有梯子通到'); });
    // ── 繩、帆 ──
    float0.forEach(function (f) { add('error', '繩', f, '開場那一刻就浮空', '繩端綁到實心或 model: 路徑（造船規格 §6）'); });
    sh.ropes.forEach(function (r) {                                     // 兩端都沒固定（綁在空中）⇒ 遊戲不生成（10_ship.js ropeFixCheck；Tim 2026-10-16）
      if (!r.unfixed) return;
      var D = r.unfixed.ends.map(function (d, e) { return (e ? '終點' : '起點') + (d.d === null ? ' 附近 ' + (Math.ceil(ROPE_FIX_D) + 1) + ' 格內沒有實心格' : '離最近的實心格 ' + (d.d * S).toFixed(2) + ' m'); });
      add('error', '繩', r.name, '兩端都沒固定（綁在空中）⇒ 不生成：' + D.join('、') + '；也不在帆角、帆桁、模型上，也沒掛在合格的繩上', '至少一端綁到實心格（0.15 m 內）、固定點、model: 路徑、sail:帆/角，或掛在合格的繩上（造船規格 §6）');
    });
    R.info.ropesUnfixed = sh.ropes.filter(function (r) { return r.unfixed; }).length;
    var noMeta = sh.sails.filter(function (s) { return !s.meta || !s.meta.kind; }).map(function (s) { return s.name; });
    if (noMeta.length) add('warn', '帆', noMeta.join('、'), '沒有 meta ⇒ 照名字判斷（帆的種類、旗、收帆順序）', 'work sub=meta part=sail（造船規格 §9.1）');
    var ownSails = sh.sails.filter(function (s) { return !(s.meta && s.meta.team); }).length;   // 陣營旗不算
    if (!sh.masts.length && ownSails) add('warn', '桅', '—', '有帆、找不到桅（帆桁 meta mast）', '帆桁 meta mast=fore｜main｜mizzen');   // 沒有帆的蒸汽船（維吉尼亞號）本來就沒有桅
    if (!ownSails && !(+sh.cfg.base > 0)) add('warn', '動力', '—', '沒有帆、也沒有額外動力 ⇒ 船不會動', '設定檔 ships[].cfg.base（額外動力，節）');
    // ── 煙囪（meta kind=funnel、固定點 smoke；78_funnel.js）──
    R.info.funnels = funnelsOf(T).length;
    funnelsOf(T).forEach(function (f) { if (!f.pt) add('warn', '煙囪', f.name, '沒有固定點 smoke ⇒ 從外框頂面的中心冒煙', '煙囪子作品登記固定點 smoke（煙囪口的中心；造船規格 §9）'); });
    // ── 彈藥庫與取用點（23_powder.js）：沒有桶 ⇒ 不擺取用點 ⇒ 送藥手沒地方拿、砲打完砲旁藥箱那幾發就永遠停（維吉尼亞號 2026-10-15：180 秒只開 12 發，Tim 先看到）──
    var kegsAny = sh.mags.some(function (o) { return o.kegs.length; });
    if (!sh.mags.length) add('error', '彈藥庫', '—', '沒有 kind=magazine ⇒ 沒有取用點：砲打完砲旁藥箱（' + BOX_N + ' 份 × 砲種表 box）就停、也不會殉爆', '彈藥庫的關聯 meta kind=magazine, powder_lb ＋ 裡面的火藥桶模型（造船規格 §8）');
    sh.mags.forEach(function (m) { if (!m.kegs.length) add('error', '彈藥庫', m.name, '裡面沒有火藥桶模型 ⇒ 這一間不會殉爆' + (kegsAny ? '' : '、整艘沒有取用點（砲打完藥箱就停）'), '彈藥庫子作品裡掛火藥桶模型 meta kind=powder, powder_lb（造船規格 §8）'); });
    R.info.stations = sh.stations.length;
    R.info.mounts = (sh.mounts || []).map(function (g) { var M = g.mt, dg = function (a) { return Math.round(a * 57.2958); };   // 迴旋砲、砲塔（TASK-0626）
      return g.model.path + '（' + (M.ports ? '換砲門 ' + M.ports.map(dg).join('／') + '°' : '砲塔 ' + dg(M.arc[0]) + '～' + dg(M.arc[M.arc.length - 1]) + '°' + (M.fire && (M.fire[0] !== M.arc[0] || M.fire[M.fire.length - 1] !== M.arc[M.arc.length - 1]) ? '（開火 ' + dg(M.fire[0]) + '～' + dg(M.fire[M.fire.length - 1]) + '°）' : '')) + '、' + dg(M.rate) + '°／秒）'; }).join('、');
    // ── 砲帶的裝甲（TASK-0631；24_armor.js）：關聯 meta kind=armor、mount=<砲模型的路徑> ⇒ 跟著那門砲轉、一格一格打掉 ──
    R.info.armor = armSummary(T);
    // ── 砲塔層（TASK-0659；27_turret.js）：關聯 meta kind=turret ⇒ 子樹裡的殼、砲、模型、彈藥箱跟著轉，前方（固定點 front）對準瞄準方位 ──
    R.info.turrets = turretSummary(sh);
    (sh.tur || []).forEach(function (N) {
      if (!N.guns.length) add('error', '砲塔', N.path, '砲塔底下沒有砲 ⇒ 不會轉（砲全滅才停 ＝ 一開始就停）', '在砲塔作品裡掛砲的模型（meta kind=gun；造船規格 §4.8）');
    });
    if (T.turDeck) R.info.turrets += '；會轉的甲板（腳下是砲塔自己的格）：有';
    R.info.doors = doorsSummary(sh);                                    // 門、艙蓋（TASK-0638）
    portsIssues(sh, add); R.info.ports = portsSummary(sh);             // 砲門蓋板（TASK-0719；62_ports.js）：鉸鏈、lid_of、關的方向、關上時穿不穿過縮回去的砲、貼不貼船殼
    R.info.recoil = recoilSummary(sh);                                  // 後座（62_ports.js）：沒有蓋板的砲退幾格、照 meta 不演的
    R.info.spins = spinSummary(sh);                                     // 照參數轉的子物件（TASK-0640）
    (T.armBad || []).forEach(function (b) { add(b.lv, '裝甲', b.where, b.msg, b.fix); });
    (T.ancBad || []).forEach(function (b) { add(b.lv, '錨', b.where, b.msg, b.fix); });   // 錨的關聯拆不出來（76_anchor.js anchorParts）
    (sh.arm || []).forEach(function (a) {
      if (a.prop) return;                                               // 螺旋槳（會轉的體素件）：下面「動力件」那一段報
      if (!a.nd) { add('error', '裝甲', a.A.mount, '拆出來了、可是開戰時找不到那門砲的迴旋 ⇒ 裝甲不轉', '那門砲的 meta kind=gun、mount=turret｜pivot（21_gunnery.js gunMountInit）'); return; }
      var bl = armBlock(a); if (bl && bl.some(function (n) { return n > 0; })) add('error', '裝甲', a.A.mount, '砲口沿砲軸碰到裝甲（' + bl.join('／') + ' 點，轉到 ' + Math.round(armYaw(a) / Math.PI * 180) + '°）⇒ 砲口不在砲門裡（砲彈打在自己的裝甲上）', '砲門開在砲軸上（砲口固定點 muzzle 正前方），或把砲往砲門挪');
      // 掃過的那一圈是牆（TASK-0655；24_armor.js armRing）⇒ 圈裡要有梯子通得到（莫尼特號：梯子/turret 從住艙甲板上到砲塔底下的艙口）
      var Rg = a.A.ring; if (!Rg) return;
      var rin = armRingIn(Rg, Rg.z0, 12), c = Rg.c, out = 0; Object.keys(Rg.rows).forEach(function (z) { var row = Rg.rows[z]; for (var k = row.length - 1; k >= 0; k--) if (row[k]) { out = Math.max(out, (k + 1) / ARM_RK); break; } });
      var ins = shipLadders(T).filter(function (l) { return l.pts.some(function (p) { return Math.hypot(p[0] - c[0], p[1] - c[1]) < rin && p[2] >= Rg.z0 - 3 && p[2] <= Rg.z1; }); });
      R.info.armor += '；' + a.A.mount + ' 掃過的那一圈（走不穿）：離轉軸 ' + rin.toFixed(1) + '～' + out.toFixed(1) + ' 格、z ' + Rg.z0 + '–' + Rg.z1 + '，圈裡的梯子 ' + (ins.length ? ins.map(function (l) { return l.name; }).join('、') : '沒有');
      var gin = (a.g ? [a.g] : a.nd && a.nd.isTur ? a.nd.guns : []).some(function (g) { var b = g.model.pts.breech || g.model.c; return Math.hypot(b[0] - c[0], b[1] - c[1]) < rin; });   // 砲尾在圈裡 ⇒ 砲班要進得去；開放的砲盾（TASK-0661：砲班站在盾後、圈外）不用
      if (!ins.length && gin) add('warn', '裝甲', a.A.mount, '會轉的裝甲掃過的那一圈是牆（船員、第一人稱都走不穿）⇒ 圈裡沒有梯子通得到 ＝ 砲塔進不去（砲班只能待在開局的位置）', '在圈裡（離轉軸不到 ' + rin.toFixed(1) + ' 格）放一座梯子（kind=ladders）通到下一層的艙口，或頂上開艙口加梯子；⛔ 不開側門（造船規格：砲塔是封閉的一圈）');
    });
    if (kegsAny) sh.decks.forEach(function (D) { if (!sh.stations.some(function (st) { return st.deck === D.key; })) add('error', '取用點', D.name, '這一層砲甲板找不到取用點（9×9 格平地、頭上 8 格空、不碰砲）⇒ 這一層的砲打完藥箱就停', '甲板留一塊空地，或在船隻配置頁擺取用點'); });
    // ── 每門砲拿不拿得到火藥（Tim 2026-10-15：「檢查炮是否有可以到達的火藥桶」）：照送藥手的走法（23_powder.js stepMonkey）——
    //   同一層的送藥手去同一層、x 最近的取用點（stationFor）拿，直直走到砲尾後面放藥箱的位置（g.drop；monkeyTo 不尋路）。
    //   ✗ 那一層沒有取用點（上面那條已報 ⇒ 這裡不重報）／沒有送藥手／砲尾後面找不到放藥箱的位置 ⇒ 那門砲打完砲旁藥箱就停。
    //   ⚠ 走路格上（預備水手的尋路，42_hands.js）取用點跟放藥箱的位置不連通 ⇒ 送藥手照直線穿過艙壁、艙口去送。
    //   兩點在不同層 ⇒ 照「層:區域」＋梯子的圖查得到 ⇒ 算走得到（報告註明幾門要走梯子；送藥手照樣直線走，這裡只判有沒有路）；查不到 ⇒ 照舊只計數。
    var pw = { n: 0, ok: 0, lad: 0, unk: 0, far: 0, farG: '' };
    /** 第 la 層的第 ra 塊走得到第 lb 層的第 rb 塊嗎：跟 handRoute 同一張圖（節點「層:區域」、邊 ＝ 沒斷的梯子），只判有沒有路、⛔ 不碰梯子的排隊數（L.q）。 */
    function lvRegReach(la, ra, lb, rb) {
      var s = la + ':' + ra, t = lb + ':' + rb, seen = {}, q = [s]; seen[s] = 1;
      for (var k = 0; k < q.length; k++) {
        if (q[k] === t) return true;
        var u = q[k].split(':'), ul = +u[0], ur = +u[1];
        NV.ladders.forEach(function (Lg) {
          if (Lg.broken) return;
          var v = Lg.lo === ul && Lg.ra === ur ? Lg.hi + ':' + Lg.rb : Lg.hi === ul && Lg.rb === ur ? Lg.lo + ':' + Lg.ra : null;
          if (v && !seen[v]) { seen[v] = 1; q.push(v); }
        });
      }
      return false;
    }
    if (kegsAny && !(sh.cw.monkeys > 0)) add('warn', '火藥', '船員配置', '送藥手 0 ⇒ 每門砲打完砲旁藥箱（' + BOX_N + ' 份 × 砲種表 box）就停', '船員配置的送藥手給 1 或 2');
    if (kegsAny && sh.cw.monkeys > 0) sh.guns.forEach(function (g) {
      var deck = gunDeck(g), nm = g.model.path || g.model.name, sts = sh.stations.filter(function (st) { return st.deck === deck && !st.mag.gone; });
      pw.n++;
      if (!sts.length) return;
      if (!g.drop) { add('error', '火藥', nm, '砲尾後面找不到放藥箱的位置 ⇒ 送藥手不送這門、打完砲旁藥箱就停', '砲尾後面（往中線 0.7 m）留一塊站得住的地方'); return; }
      if (!sh.crew.some(function (c) { return c.pm && c.deck === deck; })) { add('error', '火藥', nm, '這一層沒有送藥手（站不下）⇒ 打完砲旁藥箱就停', '那一層兩舷砲中間靠中線留站位'); return; }
      var st = stationPick(sh, deck, g);                                 // 跟送藥手同一支（23_powder.js：x 最近、走路格不連通而同一層有連通的 ⇒ 挑連通的）
      var d = Math.hypot(g.drop[0] - st.at[0], g.drop[1] - st.at[1]) * S;
      if (d > pw.far) { pw.far = d; pw.farG = nm; }
      var li = NV ? lvAt(sh, st.at) : -1, L = li >= 0 ? NV.levels[li] : null, N = L && L.N, a = N ? navSnap(N, st.at, 4) : -1, b = N ? navSnap(N, g.drop, 4) : -1;
      var lj = NV ? lvAt(sh, g.drop) : -1;
      if (N && a >= 0 && lj >= 0 && lj !== li) {                        // 兩點落在不同層（越嶺號：取用點在主甲板的艙口、船首砲放藥箱的位置在船首平台）⇒ 照預備水手找路的那張圖（42_hands.js handRoute：「層:區域」＋沒斷的梯子）
        var Nj = NV.levels[lj].N, bj = Nj ? navSnap(Nj, g.drop, 4) : -1;
        if (bj >= 0 && lvRegReach(li, N.reg[a], lj, Nj.reg[bj])) { pw.ok++; pw.lad++; return; }
      }
      if (!N || a < 0 || b < 0 || lj !== li) { pw.unk++; return; }      // 走路格量不到（那一層沒有走路格、放藥箱的位置旁邊 4 點內沒有能走的點、兩點落在不同層而梯子接不上）⇒ 判不了，只計數（⛔ 當成不連通 ⇒ 三叉戟號 spar 甲板 22 門誤報）
      if (!navPath(N, a, b)) { add('warn', '火藥', nm, st.name + ' 跟砲尾放藥箱的位置在走路格上不連通 ⇒ 送藥手照直線穿過艙壁、艙口去送', '取用點跟砲之間留通道，或在船隻配置頁換取用點的位置'); return; }
      pw.ok++;
    });
    R.info.powder = pw.n ? pw.ok + '／' + pw.n + ' 門走得到取用點' + (pw.lad ? '（其中 ' + pw.lad + ' 門跨層、走梯子）' : '') + (pw.unk ? '（' + pw.unk + ' 門走路格量不到、照直線走）' : '') + (pw.far ? '；最遠 ' + pw.far.toFixed(1) + ' m（' + pw.farG + '，送一趟來回約 ' + (2 * pw.far / (MONKEY_SP * S) + FILL_T).toFixed(1) + ' 秒）' : '') : '—';
    R.issues.sort(function (a, b) { return (a.lv === 'error' ? 0 : 1) - (b.lv === 'error' ? 0 : 1); });
    done();
  }).catch(function (e) { add('error', '載入', id, String(e && e.message || e), '—'); done(); });
}
