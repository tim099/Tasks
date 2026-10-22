// ───────────────────────── Blockside 的外殼：設定頁（TASK-0774 第 3 步：從 71_input.js 搬來，內容一字不改）─────────────────────────
// sliders()：細節設定、船隻配置、艙房編輯器、船員、天氣設定頁、page()、全部回到預設…（一支大函式、共用區域變數，這一步不拆）；物理設定頁 phxUI／phxShow。
// 畫質設定頁是核心自己的一層（71_input.js gfxUI，#gfxov）；這裡的 page('gfx') 開那一層。
/** 選單：滑桿的上下限從 LIM 來；數值只在使用者動了那一條時才從滑桿讀回（⛔ 一開頭就讀回 ⇒ 網址給的 0.33 被 step 吃成 0.35）。
 *  船殼、砲、帆、火藥桶、航行、降旗的滑桿在「細節設定」那一頁（從主選單進）；主選單只留一行摘要（#detV）。 */
/** 模型（砲、火藥桶）的總重（噸）：照匯出的模型清單＋取用點的 12 桶（細節設定的例子用；開戰時每艘照自己的模型算）。 */
function sliders() {
  var lf = $('ballast'), f = $('flood'), h = $('hard'), c = $('cas'), sp = $('speed'), ag = $('agile'), uw = $('upwind'), gh = $('gunhp'), gw = $('gunw'), sl = $('sailhp'), ph = $('powderhp'), bl = $('blast'), bv = $('blastv'), ch = $('crewhp'), cd = $('crewdeath');
  var bx = $('box'), cy = $('carry'), wk = $('wind'), wc = $('windcap'), dr = $('drown');
  var st = $('stall'), fs = $('funspeed'), fa = $('funagile'), fl = $('funstall'), fp = $('funpowder'), fh = $('funhard'), se = $('sea'), whl = $('wheelloss'), rdl = $('rudderloss'), dtq = $('difftq'), fhl = $('funhelmloss'), fhe = $('funhelmeff'), fdf = $('fundiff');   // 頂風失速、娛樂加成、浪
  [[se, 'sea'], [st, 'stall'], [fs, 'funspeed'], [fa, 'funagile'], [fl, 'funstall'], [fp, 'funpowder'], [fh, 'funhard'], [whl, 'wheelloss'], [rdl, 'rudderloss'], [dtq, 'difftq'], [fhl, 'funhelmloss'], [fhe, 'funhelmeff'], [fdf, 'fundiff']].forEach(function (e) { e[0].min = LIM[e[1]][0]; e[0].max = LIM[e[1]][1]; });
  dr.min = LIM.drown[0]; dr.max = LIM.drown[1];
  bx.min = LIM.box[0]; bx.max = LIM.box[1]; cy.min = LIM.carry[0]; cy.max = LIM.carry[1]; wk.min = LIM.wind[0]; wk.max = LIM.wind[1]; wc.min = LIM.windcap[0]; wc.max = LIM.windcap[1]; ['inertia', 'turninert', 'sailtq'].forEach(function (k) { $(k).min = LIM[k][0]; $(k).max = LIM[k][1]; });   // 動力的手感（31_drive.js）
  // 硬度跨 40 倍 ⇒ 對數刻度：滑桿 0..1 ↔ 硬度 LIM 下限 × (上限／下限)^v
  var hk = Math.log(LIM.hard[1] / LIM.hard[0]);
  lf.min = LIM.ballast[0]; lf.max = LIM.ballast[1]; gw.min = LIM.gunw[0]; gw.max = LIM.gunw[1];
  f.min = LIM.flood[0]; f.max = LIM.flood[1]; h.min = 0; h.max = 1; h.step = 0.005; c.min = LIM.cas[0] * 100; c.max = LIM.cas[1] * 100;
  sp.min = LIM.speed[0]; sp.max = LIM.speed[1]; ag.min = LIM.agile[0]; ag.max = LIM.agile[1]; uw.min = LIM.upwind[0]; uw.max = LIM.upwind[1]; var bs = $('base'); bs.min = LIM.base[0]; bs.max = LIM.base[1]; $('pump').min = LIM.pump[0]; $('pump').max = LIM.pump[1];
  gh.min = LIM.gunhp[0]; gh.max = LIM.gunhp[1]; sl.min = LIM.sailhp[0]; sl.max = LIM.sailhp[1]; ph.min = LIM.powderhp[0]; ph.max = LIM.powderhp[1];
  bl.min = LIM.blast[0]; bl.max = LIM.blast[1]; bv.min = LIM.blastv[0] * 100; bv.max = LIM.blastv[1] * 100; ch.min = LIM.crewhp[0]; ch.max = LIM.crewhp[1]; cd.min = LIM.crewdeath[0]; cd.max = LIM.crewdeath[1];
  function am(r, k) { return $('am-' + r + '-' + k); }
  function C() { return shipCfg(CFG_ID); }             // 正在編輯的那一型（船隻配置頁）
  // 船員（船隻配置頁；TASK-0570）：每一項一條滑桿；砲班照砲種各一條（這一型沒有的砲種藏起來）。改了寫進 SHIP_CREW（05_hull.js），存檔跟著存（69_prefs.js）
  var CR = {}, crBox = $('crewItems');
  CREW_ITEMS.concat([{ k: 'oar' }, { k: 'gh' }], Object.keys(GUNS).map(function (t) { return { k: 'g-' + t, gun: t, name: GUNS[t].name, lim: [GUNS[t].min, GUN_CREW_MAX] }; })).forEach(function (it) {
    var row = document.createElement('div');
    if (it.k === 'gh') { row.className = 'row note'; row.textContent = '砲班（每門砲幾個人）'; crBox.appendChild(row); return; }
    if (it.k === 'oar') { row.className = 'row slide'; row.id = 'cr-oarR'; row.innerHTML = '<label>槳手</label><span></span><span id="cr-oarV"></span>'; crBox.appendChild(row); return; }   // 只顯示：人數照船上每支槳的 meta rowers（TASK-0691），這一頁不調
    row.className = 'row slide';
    row.innerHTML = '<label for="cr-' + it.k + '">' + it.name + '</label><input type="range" id="cr-' + it.k + '" step="1" min="' + it.lim[0] + '" max="' + it.lim[1] + '"><span id="cr-' + it.k + 'V"></span>';
    crBox.appendChild(row);
    var el = row.querySelector('input');
    el.oninput = function () { var p = SHIP_CREW[CFG_ID] = SHIP_CREW[CFG_ID] || {}, v = Math.round(+el.value); if (it.gun) (p.guns = p.guns || {})[it.gun] = v; else p[it.k] = v; show(); };
    CR[it.k] = { it: it, el: el, row: row };
  });
  /** 這一型的砲（照砲種）、幾根桅、有沒有舵輪：船型載好才知道（沒載 ⇒ null）。 */
  function hullCounts(id) {
    var T = HULLT[id]; if (!T) return null;
    var g = {}, n = 0, wheel = false, oars = 0, rowers = 0, rk = [], gal = 0;
    (T.rig.models || []).forEach(function (m) {
      var k = modelKind(m); if (GUNS[k]) { g[k] = (g[k] || 0) + 1; n++; } if (k === 'wheel') wheel = true; if (k === 'galley') gal++;   // 廚房的爐灶（模型 meta kind=galley；45_galley.js）
      if ((m.meta || {}).kind === 'oar' && (m.points || {}).pivot) { var r = oarRowers(m); oars++; rowers += r; if (rk.indexOf(r) < 0) rk.push(r); }   // 槳：跟開戰時 oarCrew 同一條（有槳座才算）
    });
    return { guns: g, n: n, masts: T.masts.length, wheel: wheel, oars: oars, rowers: rowers, rk: rk.sort(function (a, b) { return a - b; }), galley: gal };
  }
  /** 全船人數（跟船員那一節的合計同一條算法）。 */
  function crewTotal(cw, hc) { var g = 0; Object.keys(GUNS).forEach(function (t) { g += gunCrew(cw, t) * (hc.guns[t] || 0); }); return g + Math.ceil(hc.n / 2) * cw.monkeys + cw.officers + (hc.wheel ? cw.helm : 0) + cw.marines + cw.top * hc.masts + cw.hands + hc.rowers; }
  /** 船隻配置頁最上面（Tim 2026-10-14）：大圓鈕（61_hud.js badgeDraw）＋排水量、航速（順風／側順風／逆風，照這一型的航速與逆風性能、玩法的加成；標準風、滿帆）、砲、船員、靈活與硬度。 */
  function shipCardShow() {
    var T = HULLT[CFG_ID], h = hullInfo(CFG_ID), el = $('shipCardT'); badgeDraw($('shipCardC'), T);   // 不寫艦名：右邊那一欄第一行就是（Tim 2026-10-17）
    if (!T) { el.innerHTML = '<div class="h">' + (h ? h.name : CFG_ID) + '</div><div class="n">船型載入中…</div>'; return; }
    var c = shipCfg(CFG_ID), hc = hullCounts(CFG_ID), kn = VMAX * c.speed * playK('speed') * 1.9438, UP = c.upwind || 1, dz = 180 - NOGO_DEG, stall = 180 - (UP === 1 ? dz : 90 + (dz - 90) * UP);
    var gl = Object.keys(GUNS).filter(function (t) { return hc.guns[t]; }).map(function (t) { return (GUNS[t].short || GUNS[t].name).trim() + ' ' + hc.guns[t]; }).join('、');
    // 開戰時的排水量（Tim 2026-10-17「額外顯示實際遊戲開場的排水量(加上炮重&其他配件重)」）：浮著的船排開的水 ＝ 自己的重量（32_hull.js hullT0，跟開戰時的 sh.mass0 同一套）；
    //   跟設計水線差多少 ⇒ 開戰時浮高／吃水深幾公尺（liftFor）
    var W = hullT0(T, c), L = liftFor(T, T.disp - W.all) || 0, t0 = function (v) { return Math.round(v).toLocaleString(); };
    // 沒有帆（莫尼特號；Tim 2026-10-17「實戰中實際上是固定6節(沒有帆)」）：遊戲裡帆的推力 × sailFrac ＝ 0 ⇒ 只寫額外動力（以前照帆的公式算出順風 12.2 節）
    var sails = T.rig.sails.some(function (s) { return !isFlag(s); }), B = (+c.base || 0) * playK('speed');   // 額外動力也吃娛樂加成（31_sailing.js vB）
    el.innerHTML = '<div class="h">' + h.name + '</div>' +
      (h.author ? '建造者 <b>' + h.author + '</b><br>' : '') +   // Tim 2026-10-15：船的作者（ships[].author ← 匯入時 .vxk 檔頭的 owner）
      '排水量 <b>' + t0(W.all) + '</b> 噸<span class="n">（開戰時）</span>・設計水線 <b>' + t0(T.disp) + '</b> 噸<br>' +
      '<span class="n">開戰時 ＝ 格子 ' + t0(W.vox) + '＋砲 ' + t0(W.gun) + '＋火藥桶 ' + t0(W.keg) + '＋壓艙物 ' + t0(W.ballast) + ' 噸' +
        (Math.abs(L) >= 0.005 ? ' ⇒ 比設計水線' + (L > 0 ? '浮高 ' : '吃水深 ') + Math.abs(L).toFixed(2) + ' m' : ' ⇒ 剛好在設計水線') + '</span><br>' +
      (sails ? '航速 順風 <b>' + Math.hypot(kn * polar(0), B).toFixed(1) + '</b>・側順風 <b>' + Math.hypot(kn, B).toFixed(1) + '</b>（最快）・逆風 <b>' + Math.hypot(kn * polar(dz), B).toFixed(1) + '</b> 節<br>' +
        (B ? '額外動力 <b>' + B.toFixed(1) + '</b> 節<span class="n">（推力跟帆相加 ⇒ 上面三格 ＝ √(帆² ＋ 額外動力²)：不看風向與帆，頂風、收帆也走得動；帆段滿帆再加 ＝ 全速前進（開）、全收再收 ＝ 倒車）</span><br>' : '') +
        '<span class="n">標準風、滿帆；逆風 ＝ 離風 ' + Math.round(stall) + '° 時（再頂就開始失速）' + (PLAY === 'fun' ? '；含娛樂玩法的加成' : '') + '</span><br>'
      : '航速 <b>' + B.toFixed(1) + '</b> 節<span class="n">（沒有帆：只靠額外動力，不看風向；全速前進時' + (PLAY === 'fun' ? '；含娛樂玩法的加成' : '') + '）</span><br>') +
      '砲 <b>' + hc.n + '</b> 門<span class="n">（' + gl + '）</span><br>' +
      '船員 約 <b>' + crewTotal(shipCrew(CFG_ID), hc) + '</b> 人<span class="n">（含預備水手 ' + shipCrew(CFG_ID).hands + '）</span><br>' +
      '靈活 <b>×' + (+c.agile).toFixed(2) + '</b>・船殼硬度 <b>×' + (+c.hard).toFixed(2) + '</b>・桅 <b>' + hc.masts + '</b> 根<br>' +
      '材質 ' + matSummary(T).map(function (m) { return '<b>' + m.name + '</b>' + (T.matIds.length > 1 ? ' ' + Math.round(m.voxels / T.base.count * 100) + '%' : '') + (m.hard !== 1 ? '（硬度 ×' + m.hard + '）' : ''); }).join('・') +
      '<span class="n">（格子 ' + Math.round(T.voxT0).toLocaleString() + ' 噸）</span>';   // TASK-0616：全船預設＋關聯 meta material（05_material.js）
  }
  function rankList(n) { var r = OFFICER_RANKS.slice(0, n); if (n > OFFICER_RANKS.length) r.push('見習軍官 ' + (n - OFFICER_RANKS.length)); return r.join('、'); }
  // 艙房（船隻配置頁；TASK-0568）：這一型標好的空艙房一間一列 —— 房間類型（放不下必要件的那個選項不能選、寫出原因）、擺了什麼、buff；
  //   「擺設…」打開那一間的俯視格子編輯器（#roomEd；0.5 m 一格）：挑物品、點格子擺（物品的中心在點的那一格）、轉 90°、拿掉、自動擺滿、清空。
  //   改了寫進 SHIP_ROOMS（36_rooms.js），存檔跟著存（69_prefs.js）。自動擺滿的那一間第一次被改 ⇒ 先把自動擺的那一份抄下來再改。
  //   甲板也是一間（Tim 2026-10-14）：每一層砲甲板一列，只擺火藥桶（取用點）；沒擺過 ＝ 自動（照舊的那幾處）。RE.d ＝ 編輯的是甲板。
  var RE = { i: -1, d: false, it: '', r: 0, del: false, hover: null, msg: '' }, ITEM_COL = { bed: '#d8cba4', table: '#9a7552', medkit: '#c04a40', keg: '#7a5230', pump: '#6f9fc4', spump: '#8a8f99' };
  function roomName(r) { return (r.deck ? r.deck.name + ' ' : '') + r.name.split('/').slice(-2).join(' ').replace('艙房-鏡像', '左').replace('艙房', '右'); }
  var ADM_SENT = {};                                                 // 後台模式：每一型上一次送回後台的預設（一樣就不送）
  function roomSet(name, v) { (SHIP_ROOMS[CFG_ID] = SHIP_ROOMS[CFG_ID] || {})[name] = v; if (ADMIN_ROOMS) ADM_SENT[CFG_ID] = ADM_SENT[CFG_ID] || ''; }
  /** 後台模式：使用者改過的那一型 ⇒ 把預設送回後台（後台照收、標成還沒存）。 */
  function roomsAdminPost() {
    if (!ADMIN_ROOMS || ADM_SENT[CFG_ID] === undefined || !HULLT[CFG_ID]) return;
    var o = roomsDefaultSnap(CFG_ID), s = JSON.stringify(o);
    if (s === ADM_SENT[CFG_ID]) return;
    var w = admWin(); if (!w) return;                             // 不是從設定後台開的 ⇒ 不送（ADM_SENT 不記，連上之前改的照樣算沒送過）
    ADM_SENT[CFG_ID] = s; try { w.postMessage({ kind: 'cb-rooms', id: CFG_ID, rooms: o }, location.origin); } catch (e) { /* 後台關了 */ }
  }
  function itemsText(items) { var n = {}; items.forEach(function (q) { n[q.it] = (n[q.it] || 0) + 1; }); return Object.keys(n).map(function (it) { return FURN[it].name + ' ' + n[it]; }).join('、'); }
  function furnNote(it) { var f = FURN[it], b = f.buff || {}; return f.role === 'powder' ? '一處三桶' : f.role === 'bench' ? '配木匠 ' + furnStaff(it, 'carpenter') + ' 位' : f.role === 'loft' ? '配帆匠 ' + furnStaff(it, 'sailmaker') + ' 位' : f.role === 'pump' ? '抽水 ' + f.tpm + ' 噸／分' + (f.power === 'steam' ? '、靠鍋爐' : '、' + (f.crew || 1) + ' 人搖') + (f.place === 'well' ? '、主桅旁中線' : '、中線') : f.hold ? '躺 ' + f.hold + ' 人' : Object.keys(b).map(function (k) { return (BUFF_NAMES[k] || k) + ' +' + Math.round(b[k] * 100) + '%'; }).join('、'); }
  function roomsPut() {
    var box = $('roomItems'), T = HULLT[CFG_ID], R = T ? hullRooms(T) : [], html = '';
    R.forEach(function (r, i) {
      var opts = '<option value="">空著</option>' + Object.keys(ROOM_FN).filter(function (k) { return !ROOM_FN[k].deck; }).map(function (k) {
        var a = roomAuto(T, r, k);
        return '<option value="' + k + '"' + (a.items ? '' : ' disabled') + '>' + ROOM_FN[k].name + (a.items ? '' : '（' + a.why + '）') + '</option>';
      }).join('');
      html += '<div class="rm"><label for="rm-' + i + '">' + roomName(r) + '</label><select id="rm-' + i + '" data-i="' + i + '">' + opts + '</select><button data-e="' + i + '">擺設…</button><span class="rs" id="rm-' + i + 'V"></span></div>';
    });
    box.innerHTML = html;
    var kit = T ? hullDeckKit(T) : { decks: [] };
    $('deckItems').innerHTML = kit.decks.map(function (D, i) { return '<div class="rm"><label>' + D.name + '</label><button data-d="' + i + '">擺設…</button><span class="rs" id="dk-' + i + 'V"></span></div>'; }).join('');
    [].forEach.call($('deckItems').querySelectorAll('button[data-d]'), function (b) { b.onclick = function () { var i = +b.dataset.d, same = RE.d && RE.i === i; RE.d = true; RE.i = same ? -1 : i; RE.it = ''; RE.del = false; RE.msg = ''; RE.hover = null; show(); if (RE.i >= 0) $('roomEd').scrollIntoView({ block: 'nearest' }); }; });
    [].forEach.call(box.querySelectorAll('select'), function (s) {
      var r = R[+s.dataset.i], pl = roomPlan(CFG_ID, r.name);
      s.value = pl ? pl.type : '';
      if (s.selectedOptions[0] && s.selectedOptions[0].disabled) s.value = '';
      s.onchange = function () { roomSet(r.name, s.value ? { type: s.value } : null); RE.it = ''; RE.msg = ''; show(); };
    });
    [].forEach.call(box.querySelectorAll('button[data-e]'), function (b) { b.onclick = function () { var i = +b.dataset.e, same = !RE.d && RE.i === i; RE.d = false; RE.i = same ? -1 : i; RE.it = ''; RE.del = false; RE.msg = ''; RE.hover = null; show(); if (RE.i >= 0) $('roomEd').scrollIntoView({ block: 'nearest' }); }; });
    if (RE.i >= (RE.d ? kit.decks.length : R.length)) RE.i = -1;
  }
  function roomsShow() {
    var T = HULLT[CFG_ID], R = T ? hullRooms(T) : [], n = {}, reach = T ? deckReach(T) : null;
    R.forEach(function (r, i) {
      var I = roomItems(T, r, roomPlan(CFG_ID, r.name)), el = $('rm-' + i + 'V'), b = document.querySelector('#roomItems button[data-e="' + i + '"]');
      var sz = ((r.max[0] - r.min[0] + 1) * S).toFixed(1) + '×' + ((r.max[1] - r.min[1] + 1) * S).toFixed(1) + ' m';
      var far = reach && r.deck && !reach[r.deck.i] ? '　⚠ 走不到（沒有梯子通' + r.deck.name + '）' : '';   // TASK-0572：艙房綁在甲板上（走不到 ⇒ 傷員送不過去）
      if (b) { b.style.display = I.type ? '' : 'none'; b.className = !RE.d && RE.i === i ? 'on' : ''; }
      if (!el) return;
      if (!I.type) { el.textContent = sz + far; return; }
      var its = I.items.map(function (q) { return q.it; }), B = roomBuff(I.type, its), lack = roomLack(I.type, its);
      if (!lack) n[I.type] = (n[I.type] || 0) + 1;
      el.textContent = sz + '・' + (I.auto ? '自動擺滿：' : '自訂：') + (itemsText(I.items) || '沒有物品') + (Object.keys(B).length ? '・' + buffText(B) : '') + (lack ? '　⚠ 缺必要件（' + lack + '）⇒ 不能用' : '') + (I.bad.length ? '　⚠ 存的擺法有 ' + I.bad.length + ' 件擺不下（沒擺）' : '') + far;
    });
    (T ? hullDeckKit(T).decks : []).forEach(function (D, i) {
      var I = deckItems(T, D, deckPlan(CFG_ID, D.id)), el = $('dk-' + i + 'V'), b = document.querySelector('#deckItems button[data-d="' + i + '"]');
      if (b) b.className = RE.d && RE.i === i ? 'on' : '';
      var nk = I.items.filter(function (q) { return FURN[q.it].role === 'powder'; }).length, oth = itemsText(I.items.filter(function (q) { return FURN[q.it].role !== 'powder'; }));   // 抽水機、木工台、帆布櫃照名字各數（⛔ 以前「不是火藥 ＝ 抽水機」⇒ 木工台＋帆布櫃被寫成「抽水機 2 台」）
      if (el) el.textContent = (I.auto ? '自動：' : '自訂：') + '取用點 ' + nk + ' 處（每處三桶）' + (oth ? '・' + oth : '') + (nk ? '' : '　⚠ 這一層的送藥手沒地方拿火藥') + (I.bad.length ? '　⚠ 存的擺法有 ' + I.bad.length + ' 處擺不下（沒擺）' : '');
    });
    $('roomSum').textContent = !T ? '船型載入後列得出艙房。' : !R.length ? '這一型還沒標空艙房（造船規格 §9.2：艙房子作品的固定點 <房名>.min／.max、關聯 meta kind=rooms）。'
      : R.length + ' 間空艙房' + (Object.keys(n).length ? '：' + Object.keys(n).map(function (f) { return ROOM_FN[f].name + ' ' + n[f] + ' 間'; }).join('、') : '，都空著') + '。選了類型就自動擺滿（先擺必要件、再擺加強件、剩下的空間多擺）；「擺設…」自己擺。門口留一格走道。' + (ROOMFN_Q ? '　⚠ 網址 ?roomfn= 蓋過' : '');
    roomEdShow(); roomsAdminPost();
  }
  /** 編輯器裡那一間：{ T, name（擺法的鍵）, label, G, pl（擺法）, I（實際擺上的）}；沒有打開 ⇒ null。 */
  function roomEdCur() {
    var T = HULLT[CFG_ID]; if (!T || RE.i < 0) return null;
    if (RE.d) { var D = hullDeckKit(T).decks[RE.i]; if (!D) return null; var dp = deckPlan(CFG_ID, D.id); return { T: T, name: D.id, label: D.name, G: deckGrid(T, D), pl: dp, I: deckItems(T, D, dp) }; }
    var r = hullRooms(T)[RE.i], pl = r && roomPlan(CFG_ID, r.name);
    return pl ? { T: T, name: r.name, label: roomName(r), G: roomGrid(T, r), pl: pl, I: roomItems(T, r, pl) } : null;
  }
  function roomEdShow() {
    var ed = $('roomEd'), E = roomEdCur();
    if (!E) { ed.style.display = 'none'; RE.i = -1; document.body.classList.remove('roomEdOn'); return; }
    ed.style.display = ''; document.body.classList.add('roomEdOn');            // 打開 ⇒ 接近全螢幕的浮層（Tim：拉寬、儘量不要捲軸）
    var F = ROOM_FN[E.pl.type], its = E.I.items.map(function (q) { return q.it; }), B = roomBuff(E.pl.type, its), lack = roomLack(E.pl.type, its), cap = 0;
    if (!RE.it || F.items.indexOf(RE.it) < 0) RE.it = F.items[0];
    E.I.items.forEach(function (q) { cap += FURN[q.it].hold || 0; });
    $('roomEdT').textContent = E.label + '・' + F.name + '（' + E.G.nx + '×' + E.G.ny + ' 格，一格 0.5 m）' + (E.I.auto ? (RE.d ? '・自動（照舊的取用點' + (E.I.pumps ? '＋抽水機 ' + E.I.pumps + ' 台' : '') + '）' : '・自動擺滿') : '・自訂');
    $('roomEdA').textContent = RE.d ? '回到自動' : '自動擺滿';
    $('roomEdPm').style.display = RE.d && F.items.some(function (it) { return FURN[it] && FURN[it].role === 'pump'; }) ? '' : 'none';   // 擺滿抽水機（TASK-0604；45_pumps.js pumpFillMax）：只有甲板
    $('roomEdP').innerHTML = F.items.map(function (it) { return '<button data-it="' + it + '"' + (RE.it === it && !RE.del ? ' class="on"' : '') + '>' + FURN[it].name + '（' + furnNote(it) + '）</button>'; }).join('') +
      '<button data-rot="1">轉 90°（' + (RE.r ? '橫過船身' : '順著船身') + '）</button><button data-del="1"' + (RE.del ? ' class="on"' : '') + '>拿掉</button>';
    [].forEach.call($('roomEdP').querySelectorAll('button'), function (b) {
      b.onclick = function () { if (b.dataset.it) { RE.it = b.dataset.it; RE.del = false; } else if (b.dataset.rot) RE.r = 1 - RE.r; else RE.del = !RE.del; RE.msg = ''; roomEdShow(); };
    });
    var npE = E.I.items.filter(function (q) { return FURN[q.it].role === 'pump'; }).length;
    $('roomEdV').innerHTML = (RE.d && npE ? '抽水機 ' + npE + ' 台：加在基礎抽水量上；人力的艙裡有水才派預備水手去搖，蒸汽的靠鍋爐；被打壞、泡水就停。選到抽水機時，調暗的格不能擺（泵井在主桅腳、泵管走中線）。<br>' : '') + (RE.d ? '取用點 ' + E.I.items.filter(function (q) { return FURN[q.it].role === 'powder'; }).length + ' 處：送藥手到最近的一處拿火藥與彈藥（彈藥庫 ＝ 離它最近的那間）；被打到會殉爆。深紅 ＝ 砲班的位置（不能擺）。' : '') + (cap ? '容納 ' + cap + ' 人' : '') + (Object.keys(B).length ? (cap ? '・' : '') + buffText(B) : '') + (lack ? '　<b style="color:#ff9a7a">缺必要件（' + lack + '）⇒ 這一間不能用</b>' : '') +
      (E.I.bad.length ? '<br>⚠ 存的擺法這幾件擺不下（沒擺）：' + E.I.bad.join('；') : '') + (E.I.why ? '<br>⚠ ' + E.I.why : '') + (RE.msg ? '<br>' + RE.msg : '') + (ROOMFN_Q ? '<br>⚠ 網址 ?roomfn= 蓋過：這裡改的開戰時不會用' : '');
    var L = roomEdLay(E.G);
    $('roomEdL').textContent = (L.rot ? '↑ 船頭；左 ＝ 左舷、右 ＝ 右舷' : '← 船尾　船頭 →；上 ＝ 左舷、下 ＝ 右舷') + '。綠 ＝ 可以擺、' + (RE.d ? '深紅 ＝ 砲班的位置' : '黃 ＝ 門口走道') + '（不能擺）、深色 ＝ 站不住。物品的中心擺在點的那一格' + (RE.d ? '。' : '；每一件都要有一邊從門口走得到。');
    roomEdDraw(E);
  }
  /** 格子怎麼畫：一格幾 px、要不要轉（窄的螢幕上，長的甲板改成船頭朝上 ⇒ 往下捲、不用左右捲）。 */
  function roomEdLay(G) {
    var W = Math.max(200, ($('roomEd').clientWidth || innerWidth) - 24), a = Math.floor(W / G.nx), b = Math.floor(W / G.ny);
    if (a < 9 && G.nx > G.ny && b > a) return { rot: true, cs: Math.min(40, b) };
    return { rot: false, cs: Math.max(6, Math.min(40, a)) };
  }
  /** 物品的中心落在 (i, j) 那一格 ⇒ 最小角。 */
  function roomEdAt(it, r, i, j) { var t = itemTiles(it, r); return { it: it, x: i - Math.floor((t[0] - 1) / 2), y: j - Math.floor((t[1] - 1) / 2), r: r }; }
  function roomEdHit(items, i, j) { return items.filter(function (q) { var t = itemTiles(q.it, q.r); return i >= q.x && i < q.x + t[0] && j >= q.y && j < q.y + t[1]; })[0] || null; }
  function roomEdDraw(E) {
    var cv = $('roomEdC'), G = E.G, L = roomEdLay(G), cs = L.cs, dpr = window.devicePixelRatio || 1, W = (L.rot ? G.ny : G.nx) * cs, H = (L.rot ? G.nx : G.ny) * cs;
    cv.style.width = W + 'px'; cv.style.height = H + 'px'; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.lay = L;
    var x = cv.getContext('2d'), i, j; x.setTransform(dpr, 0, 0, dpr, 0, 0);
    /** 格子（i, j）起、寬 wi 格、高 hj 格的那一塊 ⇒ 畫面上的 [x, y, w, h]（轉了 ⇒ 船頭朝上：畫面的列 ＝ nx − 1 − i、欄 ＝ j）。 */
    function R(i0, j0, wi, hj) { return L.rot ? [j0 * cs, (G.nx - i0 - wi) * cs, hj * cs, wi * cs] : [i0 * cs, j0 * cs, wi * cs, hj * cs]; }
    for (j = 0; j < G.ny; j++) for (i = 0; i < G.nx; i++) { var s = G.s[i + j * G.nx], r = R(i, j, 1, 1); x.fillStyle = s === 0 ? '#20252c' : s === 2 ? '#5d5530' : s === 3 ? '#4e2a26' : '#3b4a3a'; x.fillRect(r[0], r[1], r[2], r[3]); }
    var PF = !RE.del && FURN[RE.it] && FURN[RE.it].place;             // 抽水機（45_pumps.js）：選到它 ⇒ 位置規則外的格調暗（主桅旁中線、蒸汽的只有蒸汽船）
    if (PF) { x.fillStyle = 'rgba(0,0,0,.55)'; for (j = 0; j < G.ny; j++) for (i = 0; i < G.nx; i++) if (G.s[i + j * G.nx] === 1 && pumpPlaceWhy(G, roomEdAt(RE.it, RE.r, i, j))) { var r3 = R(i, j, 1, 1); x.fillRect(r3[0], r3[1], r3[2], r3[3]); } }
    if (cs >= 6) {
      x.strokeStyle = 'rgba(255,255,255,.12)'; x.lineWidth = 1; x.beginPath();
      for (i = 0; i <= W / cs; i++) { x.moveTo(i * cs + 0.5, 0); x.lineTo(i * cs + 0.5, H); }
      for (j = 0; j <= H / cs; j++) { x.moveTo(0, j * cs + 0.5); x.lineTo(W, j * cs + 0.5); }
      x.stroke();
    }
    var hit = RE.hover && RE.del ? roomEdHit(E.I.items, RE.hover[0], RE.hover[1]) : null;
    x.font = Math.max(9, Math.min(13, cs * 0.45)) + 'px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    E.I.items.forEach(function (q) {
      var t = itemTiles(q.it, q.r), r = R(q.x, q.y, t[0], t[1]);
      x.fillStyle = ITEM_COL[q.it] || '#aaa'; x.fillRect(r[0] + 2, r[1] + 2, r[2] - 4, r[3] - 4);
      x.strokeStyle = q === hit ? '#ff5040' : 'rgba(0,0,0,.6)'; x.lineWidth = q === hit ? 3 : 1; x.strokeRect(r[0] + 2, r[1] + 2, r[2] - 4, r[3] - 4);
      x.fillStyle = q.it === 'keg' ? '#f2dcb8' : '#111'; if (Math.min(r[2], r[3]) > 14 && Math.max(r[2], r[3]) > 22) x.fillText(q.it === 'keg' ? '桶' : FURN[q.it].name, r[0] + r[2] / 2, r[1] + r[3] / 2);
    });
    if (RE.hover && !RE.del) {
      var q = roomEdAt(RE.it, RE.r, RE.hover[0], RE.hover[1]), t = itemTiles(q.it, q.r), ok = !placeOk(G, E.pl.type, E.I.items, q), r2 = R(q.x, q.y, t[0], t[1]);
      x.fillStyle = ok ? 'rgba(120,255,140,.35)' : 'rgba(255,90,70,.35)'; x.fillRect(r2[0], r2[1], r2[2], r2[3]);
      x.strokeStyle = ok ? '#7f8' : '#f65'; x.lineWidth = 2; x.strokeRect(r2[0] + 1, r2[1] + 1, r2[2] - 2, r2[3] - 2);
    }
  }
  function roomEdTile(ev) {
    var cv = $('roomEdC'), b = cv.getBoundingClientRect(), L = cv.lay || { cs: 20 }, c = Math.floor((ev.clientX - b.left) / L.cs), rw = Math.floor((ev.clientY - b.top) / L.cs), E = roomEdCur();
    return L.rot && E ? [E.G.nx - 1 - rw, c] : [c, rw];
  }
  $('roomEdC').onpointermove = function (ev) { var E = roomEdCur(); if (!E) return; var h = roomEdTile(ev); if (!RE.hover || h[0] !== RE.hover[0] || h[1] !== RE.hover[1]) { RE.hover = h; roomEdDraw(E); } };
  $('roomEdC').onpointerleave = function () { var E = roomEdCur(); RE.hover = null; if (E) roomEdDraw(E); };
  $('roomEdC').onclick = function (ev) {
    var E = roomEdCur(); if (!E) return;
    var h = roomEdTile(ev), cur = E.I.items.map(function (q) { return { it: q.it, x: q.x, y: q.y, r: q.r }; }), hit = roomEdHit(cur, h[0], h[1]);
    RE.hover = h;
    if (RE.del) { if (!hit) { RE.msg = '這格沒有物品'; roomEdShow(); return; } cur.splice(cur.indexOf(hit), 1); RE.msg = '拿掉了' + FURN[hit.it].name; }
    else if (hit) { RE.msg = '這格已經有' + FURN[hit.it].name + '（要拿掉：按「拿掉」再點它）'; roomEdShow(); return; }
    else {
      var q = roomEdAt(RE.it, RE.r, h[0], h[1]), why = placeOk(E.G, E.pl.type, cur, q);
      if (why) { RE.msg = '<b style="color:#ff9a7a">放不下：' + why + '</b>'; roomEdShow(); return; }
      cur.push(q); RE.msg = '擺上' + FURN[q.it].name;
    }
    roomSet(E.name, { type: E.pl.type, items: cur }); show();
  };
  $('roomEdA').onclick = function () {
    var E = roomEdCur(); if (!E) return;
    if (RE.d) { roomSet(E.name, { type: 'deck' }); RE.msg = '回到自動（照舊的取用點；道具設定「每船自動擺幾台」不是 0 的抽水機也照它擺）'; }   // 甲板的自動 ＝ 沒有 items（⇒ 開戰時照舊找、戰局跟沒改過一樣；蓋過設定檔的自訂預設）
    else { roomSet(E.name, { type: E.pl.type }); RE.msg = '自動擺滿了'; }
    show();
  };
  // 擺滿抽水機（TASK-0604）：照位置規則（主桅旁中線；蒸汽的只有蒸汽船）把每一種擺到全船上限，扣掉別層、這一層已經擺的 ⇒ 存成這一層的自訂擺法（多的自己拿掉）
  $('roomEdPm').onclick = function () {
    var E = roomEdCur(); if (!E || !RE.d) return;
    var DK = hullDeckKit(E.T).decks, cur = E.I.items.map(function (q) { return { it: q.it, x: q.x, y: q.y, r: q.r }; }), have = {};
    function cnt(L) { L.forEach(function (q) { if (FURN[q.it] && FURN[q.it].role === 'pump') have[q.it] = (have[q.it] || 0) + 1; }); }
    DK.forEach(function (X, k) { if (k !== RE.i) cnt(deckItems(E.T, X, deckPlan(CFG_ID, X.id)).items); }); cnt(cur);
    var got = pumpFillMax(E.T, DK[RE.i], cur, have), n = 0, txt = Object.keys(got).filter(function (it) { return got[it]; }).map(function (it) { n += got[it]; return FURN[it].name + ' ' + got[it] + ' 台'; }).join('、');
    if (!n) { RE.msg = '沒有再擺上抽水機（已經到全船上限，或這一層的主桅旁中線擺不下）'; roomEdShow(); return; }
    roomSet(E.name, { type: 'deck', items: cur }); RE.msg = '擺上' + txt + '（擺到全船上限' + (got.pump ? '；人力的每台要 ' + FURN.pump.crew + ' 人搖' : '') + '，多的按「拿掉」）'; show();
  };
  $('roomEdZ').onclick = function () { var E = roomEdCur(); if (!E) return; roomSet(E.name, { type: E.pl.type, items: [] }); RE.msg = '清空了'; show(); };
  $('roomEdX').onclick = $('roomEdX2').onclick = function () { RE.i = -1; show(); };
  window.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && RE.i >= 0) { RE.i = -1; show(); } });
  window.addEventListener('resize', function () { if (RE.i >= 0) roomEdShow(); });
  // 後台模式（?admin=rooms）：只開船隻配置頁的甲板與艙房；後台送來設定檔的預設（{ kind:'cb-defaults', rooms: { 船型: ships[].rooms } }）⇒ 換掉預設、清掉這裡改的
  if (ADMIN_ROOMS) {
    $('shipp').classList.add('admin');
    window.addEventListener('message', function (ev) {
      if (ev.origin !== location.origin || !ev.data || ev.data.kind !== 'cb-defaults') return;
      HULL_KNOWN.forEach(function (h) { h.rooms = ev.data.rooms[h.id] || undefined; });
      Object.keys(SHIP_ROOMS).forEach(function (k) { delete SHIP_ROOMS[k]; }); ADM_SENT = {};
      put(); show();
    });
  }
  function crewPut() {
    var cw = shipCrew(CFG_ID), hc = hullCounts(CFG_ID);
    Object.keys(CR).forEach(function (key) { var e = CR[key]; e.el.value = e.it.gun ? gunCrew(cw, e.it.gun) : cw[e.it.k]; if (e.it.gun) e.row.style.display = !hc || hc.guns[e.it.gun] ? '' : 'none'; });
  }
  function crewShow() {
    var cw = shipCrew(CFG_ID), d = crewDefault(CFG_ID), hc = hullCounts(CFG_ID);
    function v(key, txt, x, x0) { $('cr-' + key + 'V').textContent = txt + (x === x0 ? '' : '　（預設 ' + x0 + '）'); }
    var n = cw.officers; v('officers', n + ' 人' + (n ? '（' + rankList(n) + '）' : '（沒有軍官：沒人指揮，瞄準變散）'), n, d.officers);
    n = cw.helm; v('helm', n + ' 人' + (hc && !hc.wheel ? '（這型沒有舵輪 ⇒ 不站人）' : '（站在舵輪後面；倒下時預備水手會補）'), n, d.helm);
    n = cw.marines; v('marines', n + ' 人（沿右舷舷牆站，用火槍打敵艦露天的人）', n, d.marines);
    n = cw.top; v('top', n + ' 人 × ' + (hc ? hc.masts + ' 根桅 ＝ ' + n * hc.masts : '每根桅'), n, d.top);
    n = cw.monkeys; v('monkeys', n ? n + ' 人 × 每一對砲' + (hc ? '（約 ' + Math.ceil(hc.n / 2) + ' 對）' : '') + '：從取用點搬火藥與彈藥' : '0（沒有：砲旁的藥箱用完就停）', n, d.monkeys);
    n = cw.hands; v('hands', n + ' 人（在住艙甲板待命，缺人手時補位）' + (Q.has('hands') ? '　⚠ 網址 ?hands= 蓋過' : ''), n, d.hands);
    n = cw.carpenter; var cp = hullStaff(CFG_ID, 'carpenter');   // 設施配員：木工台每張配幾位 ⇒ 這型擺了幾張（每船至少 1 張，不夠自動補）
    v('carpenter', n ? '上限 ' + n + ' 人：木工台每張配 ' + furnStaff(benchIt() || '', 'carpenter') + ' 位' + (cp === null ? '' : '（這型 ' + cp + ' 位' + (cp > n ? ' ⇒ 上限截到 ' + n : '') + '）') + '；開戰時生在木工台旁；修斷掉的梯子 —— 整件還原、補甲板破洞 —— 先補把甲板打成兩塊的；跟預備水手一樣在船裡走動' : '0（沒有：梯子、甲板打壞了就一直壞著）', n, d.carpenter);
    n = cw.sailmaker; var smn = hullStaff(CFG_ID, 'sailmaker');   // 設施配員：帆布櫃每件配幾位 ⇒ 這型擺了幾件（每船至少 1 件，不夠自動補）
    v('sailmaker', n ? '上限 ' + n + ' 人：帆布櫃每件配 ' + furnStaff(loftIt() || '', 'sailmaker') + ' 位' + (smn === null ? '' : '（這型 ' + smn + ' 位' + (smn > n ? ' ⇒ 上限截到 ' + n : '') + '）') + '；開戰時生在帆布櫃旁；還掛著的破帆走到帆底下修 —— 血量、斷在帆那一端的繩、破洞一次修好；整面掉了不補；帆布用完回櫃拿' : '0（沒有）', n, d.sailmaker);
    n = cw.surgeon; var sg = hullStaff(CFG_ID, 'surgeon');   // 設施配員（36_rooms.js staffSlots）：病床每張配幾位 ⇒ 這型擺了幾張；上限截掉的照實寫
    v('surgeon', n ? '上限 ' + n + ' 人：病床每張配 ' + furnStaff('bed', 'surgeon') + ' 位' + (sg === null ? '' : '（這型 ' + sg + ' 位' + (sg > n ? ' ⇒ 上限截到 ' + n : '') + '；走不到的床不配）') + '；開戰就站在床旁；醫療艙要的人手先算船醫、不夠才派預備水手；有船醫的那一間治療快 50%；沒設醫療艙的船不上船' : '0（沒有：醫療艙照舊只靠預備水手）', n, d.surgeon);
    n = cw.cook; var gk = hc ? hc.galley * GALLEY.cooks : null;   // 廚師（TASK-0720，45_galley.js）：爐灶（模型 meta kind=galley）每座配 galley.cooks 位，上限截掉的照實寫
    v('cook', n ? '上限 ' + n + ' 人：爐灶每座配 ' + GALLEY.cooks + ' 位' + (gk === null ? '' : hc.galley ? '（這型 ' + hc.galley + ' 座 ⇒ ' + Math.min(n, gk) + ' 位' + (gk > n ? '，上限截到 ' + n : '') + '）' : '（這型沒有廚房 ⇒ 不上船）') + '；有廚房（kind=galley）的船才上船，開戰就站在爐灶旁做飯，預備水手輪流當伙夫去領；倒下不補 ⇒ 存糧吃完就斷炊' + (GALLEY_PCT > 0 ? '' : '　⚠ 細節設定「廚房加成」是 0 ⇒ 不開廚房') : '0（不開廚房：沒有廚師、沒人吃飯，工作效率一直是 ×1）', n, d.cook);
    n = cw.navigator; v('navigator', n ? '1 人：站在後甲板舵輪旁；在崗 ⇒ 航速 +' + DUTY.navSpd + '%、轉向 +' + DUTY.navTurn + '%（倒下 ⇒ 還有軍官時剩 ' + Math.round(DUTY.standIn * 100) + '%）' : '沒有（航速、轉向照原本的）', n, d.navigator);   // 39_duty.js（TASK-0825）
    n = cw.quartermaster; v('quartermaster', n ? '1 人：站在彈藥庫的取用點旁；在崗 ⇒ 送藥手裝藥包快 ' + DUTY.qmFill + '%（倒下 ⇒ 還有軍官時剩 ' + Math.round(DUTY.standIn * 100) + '%；沒有彈藥庫的船不上船）' : '沒有（送藥照原本的）', n, d.quartermaster);
    $('cr-oarR').style.display = hc && !hc.oars ? 'none' : '';   // 沒有槳的船藏起來
    $('cr-oarV').textContent = !hc ? '船型載入後才知道' : hc.rowers + ' 人：' + hc.oars + ' 支槳 × 每支 ' + hc.rk.join('–') + ' 人（照船上每支槳的設定，這一頁不調）；坐在槳座內側划；倒下時預備水手照位子補；一支槳到崗幾成就出幾成力';
    n = cw.shelter ? 1 : 0; v('shelter', n ? '開：預備水手不上露天甲板閒晃（只上去補位）、船長以外的軍官待在甲板下' : '關：預備水手偶爾上露天甲板走動、軍官站在露天甲板', n, d.shelter ? 1 : 0);
    var gsum = 0;
    Object.keys(GUNS).forEach(function (t) {
      var x = gunCrew(cw, t), std = GUNS[t].crew, c = hc ? hc.guns[t] || 0 : 0; gsum += x * c;
      v('g-' + t, x + ' 人' + (hc ? ' × ' + c + ' 門 ＝ ' + x * c : '') + '（' + (x < std ? '標準 ' + std + '：人少裝填慢' : x > std ? '標準 ' + std + '：多的 ' + (x - std) + ' 人是替補' : '標準') + '；最少 ' + GUNS[t].min + ' 人才開得動）', x, gunCrew(d, t));
    });
    if (hc) {
      var pm = Math.ceil(hc.n / 2) * cw.monkeys, hl = hc.wheel ? cw.helm : 0, tp = cw.top * hc.masts, tot = gsum + pm + cw.officers + hl + cw.marines + tp + cw.hands + hc.rowers;
      var seen = CREW_SEEN[CFG_ID], ss = !seen ? '這一型還沒上過船：站不站得下，開戰時才知道（站不下的那一項會在上方廣播）。'
        : seen.sig !== crewSig(cw) ? '改過之後還沒開過戰：站不站得下，下一場開戰時才知道（站不下的那一項會在上方廣播）。'
        : '上一場實際上船 ' + seen.n + ' 人' + (seen.short.length ? '；站位不夠、站不下的：' + seen.short.map(function (r) { return r[0] + ' ' + r[2] + '／' + r[1]; }).join('、') + '。' : '，全部站得下。');
      $('crewSum').textContent = '全船約 ' + tot + ' 人：砲班 ' + gsum + '、送藥手約 ' + pm + '、軍官 ' + cw.officers + '、舵手 ' + hl + '、陸戰隊 ' + cw.marines + '、桅頂 ' + tp + (hc.rowers ? '、槳手 ' + hc.rowers : '') + '、預備水手 ' + cw.hands + '。' + ss;
    } else $('crewSum').textContent = '船型載入後算得出全船人數。';
    shipCardShow();
    $('shipSt').textContent = PREFS.write ? '改了就自動存在這個瀏覽器（重新整理、下次打開都還在）；換瀏覽器或裝置：用下面的匯出、匯入。'
      : '⚠ 這一頁現在存不了' + (PREFS.state ? '（' + PREFS.state + '）' : '（網址帶了設定參數、或是在畫廊的彈窗裡）') + ' —— 要留住請用下面的「匯出」。';
  }
  function put() {                                     // 變數 ⇒ 滑桿位置（開頭、重設預設值、換編輯的船時）
    var k = C(); $('cfgShip').textContent = (hullInfo(CFG_ID) || {}).name || CFG_ID;
    lf.value = k.ballast !== undefined ? k.ballast : LIM.ballast[2]; f.value = k.flood; h.value = Math.log(k.hard / LIM.hard[0]) / hk; c.value = STRIKE.cas * 100; sp.value = k.speed; ag.value = k.agile; uw.value = k.upwind; $('base').value = k.base || 0; $('pump').value = k.pump;
    gh.value = GUN_HP; gw.value = k.gunw; sl.value = SAIL_HP; ph.value = POWDER_HP; bl.value = BLAST_K; bv.value = Math.round(BLAST_V * 100); ch.value = CREW_HP;
    bx.value = BOX_N; cy.value = CARRY_N; wk.value = WIND_K; wc.value = WIND_CAP; $('inertia').value = DRV_INERTIA; $('turninert').value = DRV_TURN; $('sailtq').value = DRV_TQ; dr.value = DROWN_T; $('navre').value = NAV_RE; $('heal').value = HEAL_T; $('musket').value = MUSKET_R; $('sailfix').value = SAILFIX_T; $('burn').value = BURN_PCT; $('galley').value = GALLEY_PCT; $('gcrew').checked = GUN_CREW_HURT; $('dbg').checked = DBG_SET;
    se.value = SEA_K; st.value = STALL_K; fs.value = FUN.speed; fa.value = FUN.agile; fl.value = FUN.stall; fp.value = FUN.powder; fh.value = FUN.hard; whl.value = WHEEL_LOSS; rdl.value = RUDDER_LOSS; dtq.value = DIFF_K; fhl.value = FUN.helmloss; fhe.value = FUN.helmeff; fdf.value = FUN.diff;
    for (var r = 0; r < 3; r++) for (var k = 0; k < 3; k++) am(r, k).value = AMMO_K[r][k];
    ['guns', 'masts', 'officers'].forEach(function (k) { $('st-' + k).checked = STRIKE[k]; });
    [0, 1].forEach(function (i) { $('cap' + i).value = CAP_SET[i]; });
    crewPut(); roomsPut();
  }
  function show() {
    var K = C(), SPEEDK = K.speed, AGILK = K.agile, FLOOD = K.flood, HARDK = K.hard, GUNW_K = K.gunw, BALLAST_T = K.ballast !== undefined ? K.ballast : LIM.ballast[2];   // 正在編輯的那一型
    var fun = PLAY === 'fun' ? '（娛樂：' : '（', SPE = SPEEDK * playK('speed'), AGE = AGILK * playK('agile');   // 娛樂 ⇒ 括號裡寫乘過加成的實際值
    $('speedV').textContent = SPEEDK.toFixed(2) + '×' + fun + '最快約 ' + (VMAX * SPE * 1.944).toFixed(0) + ' 節）';
    $('agileV').textContent = AGILK.toFixed(2) + '×' + fun + '滿帆側風約 ' + ((0.012 + 0.016 * VMAX * 0.92) * AGE * 57.3).toFixed(1) + '°/秒）';
    var BKV = K.base || 0; $('baseV').textContent = BKV ? BKV.toFixed(1) + ' 節（' + (PLAY === 'fun' ? '娛樂：實際 ' + (BKV * playK('speed')).toFixed(1) + ' 節；' : '') + '推力跟帆相加：實際 ＝ √(帆² ＋ 額外動力²)；不看風向、風速、帆，頂風、收帆也走得動；帆段滿帆再加 ＝ 全速前進才開、全收再收 ＝ 倒車）' : '0（沒有：照帆與風走）';
    var UPK = K.upwind; $('upwindV').textContent = UPK.toFixed(2) + '×（' + (UPK === 1 ? '照舊：' : '') + '風從船頭 ' + (90 - (90 - NOGO_DEG) * UPK).toFixed(0) + '° 開始失速、' + (90 - (90 - NOGO_FULL) * UPK).toFixed(0) + '° 全失速（手動操舵）；近迎風轉向最多 ×' + UPK.toFixed(2) + '）';
    var SK = STALL_K * playK('stall'), WA = WAVES.reduce(function (a, w) { return a + w.a; }, 0) * SEA_K;   // WA：幾道浪疊在一起最高的那一下（振幅）
    $('seaV').textContent = SEA_K <= 0 ? '0（平靜）' : SEA_K.toFixed(2) + '×（浪高最多約 ' + (WA * 2).toFixed(1) + ' m，主浪週期 ' + (2 * Math.PI / WAVES[0].w).toFixed(1) + ' 秒）';
    $('stallV').textContent = Math.round(STALL_K * 100) + '%' + (PLAY === 'fun' ? '（娛樂：實際 ' + Math.round(SK * 100) + '%）' : '') + (SK <= 0 ? '（不會失速）' : SK >= 0.95 ? '（寫實）' : '');
    var HLk = PLAY === 'fun' ? FUN.helmloss : 1, HLw = Math.min(1, WHEEL_LOSS * HLk), HLr = Math.min(1, RUDDER_LOSS * HLk);   // 操舵（TASK-0777）：損失 ⇒ 舵效剩幾成
    $('wheellossV').textContent = '損失 ' + Math.round(WHEEL_LOSS * 100) + '%' + (PLAY === 'fun' ? '（娛樂：實際 ' + Math.round(HLw * 100) + '%）' : '') + ' ⇒ 舵效剩 ' + Math.round((1 - HLw) * 100) + '%';
    $('rudderlossV').textContent = '損失 ' + Math.round(RUDDER_LOSS * 100) + '%' + (PLAY === 'fun' ? '（娛樂：實際 ' + Math.round(HLr * 100) + '%）' : '') + ' ⇒ 舵效剩 ' + Math.round((1 - HLr) * 100) + '%（兩樣都沒了 ' + Math.round((1 - HLw) * (1 - HLr) * 100) + '%）';
    $('difftqV').textContent = DIFF_K <= 0 ? '0（兩舷推力差不轉船）' : '舵的 ' + Math.round(DIFF_K * 100) + '%' + (PLAY === 'fun' ? '（娛樂：實際 ' + Math.round(DIFF_K * FUN.diff * 100) + '%）' : ''); $('fundiffV').textContent = FUN.diff.toFixed(2) + '×'; $('funhelmlossV').textContent = FUN.helmloss.toFixed(2) + '×'; $('funhelmeffV').textContent = FUN.helmeff.toFixed(2) + '×';
    $('funspeedV').textContent = FUN.speed.toFixed(2) + '×'; $('funagileV').textContent = FUN.agile.toFixed(2) + '×'; $('funstallV').textContent = FUN.stall.toFixed(2) + '×';
    $('funhardV').textContent = FUN.hard.toFixed(2) + '×（鐵甲的擊穿門檻：寫實 ' + Math.round(MATS.iron ? MATS.iron.pen || 0 : 0) + ' ⇒ 娛樂 ' + Math.round((MATS.iron ? MATS.iron.pen || 0 : 0) * FUN.hard) + ' kJ／格；木頭不變）';
    $('funpowderV').textContent = FUN.powder.toFixed(2) + '×' + (powderNever() ? '（火藥拉滿：不會爆）' : '（火藥血量 ' + POWDER_HP + ' ⇒ ' + Math.round(POWDER_HP * FUN.powder) + '）');
    var PU = K.pump; $('pumpV').textContent = PU.toFixed(1) + ' 噸／分' + (PU === cfgBase('pump', CFG_ID) ? '（預設：照排水量）' : '') + (PU <= 0 ? '（不抽水）' : '');
    $('floodV').textContent = FLOOD === 0 ? '0×（不會沉）' : FLOOD.toFixed(2) + '×' + (FLOOD < 0.5 ? '（慢）' : FLOOD < 1.2 ? '' : '（快）');
    var HT = HULLT[CFG_ID], m0 = HT ? hullT0(HT, { ballast: BALLAST_T, gunw: GUNW_K }).all : 0, l0 = liftFor(HT, HT ? HT.disp - m0 : 0), lx = liftFor(HT, HT ? HT.disp - m0 + 70 : 0);   // 照我艦的船型   // 開戰時浮在哪；例子：再打掉 10 萬格（70 噸）
    var gm = 0, kinds = {}; if (HT) (HT.rig.models || []).forEach(function (m) { var k = modelKind(m); if (GUNS[k]) { gm += GUNS[k].mass * GUNW_K; kinds[k] = 1; } });
    $('gunwV').textContent = GUNW_K.toFixed(2) + '×（' + Object.keys(GUNS).filter(function (k) { return !HT || kinds[k]; }).map(function (k) { return GUNS[k].name + ' ' + (GUNS[k].mass * GUNW_K).toFixed(1) + ' 噸'; }).join('、') + (gm ? '；全部 ' + Math.round(gm) + ' 噸' : '') + '）';
    $('ballastV').textContent = BALLAST_T + ' 噸' + (l0 === null ? '' : '（' + HT.name + ' ' + Math.round(m0).toLocaleString() + ' 噸 ⇒ ' + (Math.abs(l0) < 0.05 ? '剛好在設計水線' : l0 > 0 ? '浮高 ' + l0.toFixed(1) + ' m' : '吃水深 ' + (-l0).toFixed(1) + ' m') + '；打掉 10 萬格再浮 ' + (lx - l0).toFixed(2) + ' m）');
    $('hardV').textContent = HARDK.toFixed(2) + '×' + (HARDK === 1 ? '（只看材質）' : HARDK < 0.5 ? '（容易打穿）' : HARDK > 3 ? '（幾乎打不穿）' : HARDK > 1 ? '（比材質硬）' : '（比材質軟）');
    function shots(hp, dmg) { return dmg > 0 ? Math.ceil(hp / dmg - 1e-9) : '∞'; }
    $('gunhpV').textContent = GUN_HP + '（24 磅實心 ' + shots(GUN_HP, DMG.long * ammoK(0, VS_GUN)) + ' 發、舵輪 ' + Math.round(GUN_HP * 0.6) + '）';
    $('sailhpV').textContent = SAIL_HP + '（24 磅鏈彈 ' + shots(SAIL_HP, DMG.long * ammoK(2, VS_SAIL)) + ' 發）';
    $('crewhpV').textContent = CREW_HP + (CREW_HP === LIM.crewhp[2] ? '' : CREW_HP > LIM.crewhp[2] ? '（耐打）' : '（脆）');
    $('crewdeathV').textContent = CREW_DEATH + '%（HP 歸零：' + (CREW_DEATH >= 100 ? '一律陣亡' : CREW_DEATH <= 0 ? '一律變成傷員' : CREW_DEATH + '% 陣亡、' + (100 - CREW_DEATH) + '% 變成傷員') + '）';
    $('powderhpV').textContent = powderNever() ? '拉滿（不會爆）' : POWDER_HP + (PLAY === 'fun' ? '（娛樂：實際 ' + powderHP() + '）' : '') + (powderHP() >= 600 ? '（很難殉爆，' : powderHP() >= 250 ? '（偶爾殉爆，' : '（很容易殉爆，') + '藥包 ' + Math.round(powderHP() * CART_K) + '）';   // 照實際的（娛樂乘過加成）；300 量過六艘一艘殉爆 ⇒ 偶爾
    $('blastV').textContent = BLAST_K.toFixed(2) + '×（前彈藥庫半徑約 ' + (MAG_R * Math.pow(BLAST_K, 1 / 3) * (S || 0.1)).toFixed(1) + ' m）';
    var r0 = MAG_R * Math.pow(BLAST_K * (1 - BLAST_V), 1 / 3) * (S || 0.1), r1 = MAG_R * Math.pow(BLAST_K * (1 + BLAST_V), 1 / 3) * (S || 0.1);
    $('blastvV').textContent = BLAST_V <= 0 ? '0（每次一樣）' : '±' + Math.round(BLAST_V * 100) + '%（前彈藥庫半徑 ' + r0.toFixed(1) + '～' + r1.toFixed(1) + ' m）';
    var bxK = Object.keys(GUNS).filter(function (k) { return gunBoxK(k) > 1; }).map(function (k) { return GUNS[k].short + ' × ' + gunBoxK(k); }); $('boxV').textContent = BOX_N + ' 份（開戰時裝滿' + (bxK.length ? '；' + bxK.join('、') : '') + '）';   // 砲種表 box：那種武器一份算幾發（10_ship.js gunBoxK）
    $('healV').textContent = HEAL_T ? '約 ' + HEAL_T + ' 秒（預備水手把傷員搬到醫療艙的病床；手術台快 3 倍（要船醫）、藥箱加快，人手不足變慢；治好的回來當預備水手）' : '0（關：傷員照舊 12 秒抬下去，不搬、不治）';
    $('musketV').textContent = MUSKET_R + ' m（射程內看不到人就不開槍；射程內命中率照距離，船不晃、甲板對甲板：25 m 約 ' + (musketHit(25, MUSKET.h, 0) * 100).toFixed(0) + '%、100 m 約 ' + (musketHit(100, MUSKET.h, 0) * 100).toFixed(1) + '%、' + MUSKET_R + ' m 約 ' + (musketHit(MUSKET_R, MUSKET.h, 0) * 100).toFixed(1) + '%；船晃得兇更低）';
    $('sailfixV').textContent = SAILFIX_T + ' 秒（一面帆從滿血打到快掉，帆匠站在帆底下修這麼久；照缺的血量比例算，接一條繩多 ' + SM_ROPE_T + ' 秒；修完一次補回：血量、繩、破洞）';
    $('burnV').textContent = BURN_PCT ? BURN_PCT + '%（希臘火點著的木頭往外燒、燒久了燒穿（水線下會進水）；帆也會燒出洞、燒掉；預備水手去潑水）' : '0（不點火：希臘火照以前只燒人、撕帆、燒細繩）';
    $('galleyV').textContent = GALLEY_PCT ? '×' + (1 + GALLEY_PCT / 100).toFixed(2) + '（吃過飯的人裝填、抽水、修補、救火、治療快 ' + GALLEY_PCT + '%；吃完 ' + GALLEY.hold + ' 秒內滿的、之後 ' + GALLEY.fade + ' 秒慢慢退回 ×1；下一場開戰才決定開不開廚房）' : '0（關：不開廚房、不生廚師，有爐灶的船照沒有廚房跑）';
    $('navreV').textContent = NAV_RE > 0 ? '每 ' + NAV_RE + ' 秒（這段時間裡有甲板、梯子被打壞才重算那幾層：打成兩塊不通 ⇒ 分開找路、梯子斷了 ⇒ 改走別座）' : '關（走路格照開戰時的船：甲板打穿了照樣走過去）';
    $('drownV').textContent = DROWN_T ? '約 ' + DROWN_T + ' 秒（浮上水面、往自己的船游，爬回來當預備水手；受傷的減半）' : '0（關：落水當場算陣亡、淹到的跟著船沉）';
    $('windcapV').textContent = WIND_CAP + ' m/s（暴風雨陣風最大約 ' + Math.round(WIND_SAIL * WIND_K * (1 + GUST[0] + GUST[1] + GUST[2]) * 2.2 * 1.5) + ' m/s ⇒ ' + (WIND_SAIL * WIND_K * (1 + GUST[0] + GUST[1] + GUST[2]) * 2.2 * 1.5 > WIND_CAP ? '會被夾住' : '不會碰到') + '）';
    $('inertiaV').textContent = DRV_INERTIA.toFixed(2) + '×（質量的倍率：加減速' + (DRV_INERTIA > 1.01 ? '慢 ' + DRV_INERTIA.toFixed(2) + ' 倍' : DRV_INERTIA < 0.99 ? '快 ' + (1 / DRV_INERTIA).toFixed(2) + ' 倍' : '照校準') + '）'; $('turninertV').textContent = DRV_TURN.toFixed(2) + '×（轉向追舵 ' + (2 * DRV_TURN).toFixed(1) + ' 秒）'; $('sailtqV').textContent = DRV_TQ.toFixed(2) + '×' + (DRV_TQ === 0 ? '（受損不偏）' : '');
    $('windV').textContent = WIND_K.toFixed(2) + '×（帆上的風約 ' + (WIND_SAIL * WIND_K).toFixed(0) + ' m/s，陣風 ±' + Math.round(GUST[0] * 100) + '%）';
    $('carryV').textContent = CARRY_N + ' 份' + (CARRY_N > BOX_N ? '（比藥箱多 ⇒ 一趟送好幾門）' : '');
    $('casV').textContent = STRIKE.cas >= 1 ? '100%（全員倒下才停）' : Math.round(STRIKE.cas * 100) + '%';
    $('strikeV').textContent = strikeText();
    var amDef = AMMO_K.every(function (r, i) { return r.every(function (v, j) { return v === AMMO_K0[i][j]; }); });
    $('detV').textContent = '玩法 ' + (PLAY === 'fun' ? '娛樂（航速 ×' + FUN.speed.toFixed(2) + '、靈活 ×' + FUN.agile.toFixed(2) + '、頂風失速 ' + Math.round(SK * 100) + '%）' : '寫實（頂風失速 ' + Math.round(SK * 100) + '%）') + '・天氣 ' + WX.name + '・浪 ' + (SEA_K > 0 ? SEA_K.toFixed(2) + '×' : '平靜') + '・' + fleetHulls().map(function (id) { var c = shipCfg(id), hi = hullInfo(id); return (hi ? hi.name : id) + '：硬度 ' + c.hard.toFixed(1) + '×・進水 ' + c.flood.toFixed(2) + '×・抽水 ' + c.pump.toFixed(1) + ' 噸／分・壓艙物 ' + (c.ballast !== undefined ? c.ballast + ' 噸' : '（載入後）') + '・砲重 ' + c.gunw.toFixed(2) + '×・航速 ' + c.speed.toFixed(2) + '×・靈活 ' + c.agile.toFixed(2) + '×・逆風 ' + c.upwind.toFixed(2) + '×・預備水手 ' + shipCrew(id).hands; }).join('；') + '・血量 砲 ' + GUN_HP + '／帆 ' + SAIL_HP + '／船員 ' + CREW_HP +
      '・傷害 ' + DMG.long + '／' + DMG.long32 + '／' + DMG.carr + '／' + DMG.chase + '／' + DMG.long4 + '／' + DMG.long12 + '／' + DMG.long18 + '／' + DMG.long6 + '／' + DMG.chase3 + (amDef ? '' : '・彈種倍率已改') + '・藥箱 ' + BOX_N + '、一次搬 ' + CARRY_N + '・溺水 ' + (DROWN_T ? DROWN_T + ' 秒' : '關') +
      '・火藥桶 ' + (powderNever() ? '不會爆' : '血量 ' + powderHP() + '、殉爆 ' + BLAST_K.toFixed(2) + '×' + (BLAST_V > 0 ? ' ±' + Math.round(BLAST_V * 100) + '%' : '')) + '・砲長 ' + CAP_SET.map(function (k) { return CAPTAINS[k] ? CAPTAINS[k].name : '隨機'; }).join('／') + '・' + strikeText();
    crewShow(); roomsShow(); fitShow(CFG_ID, $('fitItems'), $('fitSum'));   // 換裝（72_fitui.js；TASK-0713）
  }
  lf.oninput = function () { C().ballast = Math.round(+lf.value); show(); };
  f.oninput = function () { C().flood = +f.value; show(); };
  sp.oninput = function () { C().speed = +sp.value; show(); };
  ag.oninput = function () { C().agile = +ag.value; show(); };
  uw.oninput = function () { C().upwind = +uw.value; show(); };
  $('base').oninput = function () { C().base = +$('base').value; show(); };
  $('pump').oninput = function () { C().pump = +$('pump').value; show(); };   // 基礎抽水量（噸／分；33_flood.js pumpK）   // 額外動力（31_sailing.js；設定鍵照舊叫 base）
  h.oninput = function () { C().hard = Math.round(LIM.hard[0] * Math.exp(h.value * hk) * 20) / 20; show(); };   // 倍率：0.05 一格（1 ＝ 只看材質）
  c.oninput = function () { STRIKE.cas = c.value / 100; show(); };
  gh.oninput = function () { GUN_HP = Math.round(+gh.value); show(); };
  gw.oninput = function () { C().gunw = +gw.value; show(); };
  sl.oninput = function () { SAIL_HP = Math.round(+sl.value); show(); };
  ph.oninput = function () { POWDER_HP = Math.round(+ph.value); show(); };
  bl.oninput = function () { BLAST_K = +bl.value; show(); };
  bv.oninput = function () { BLAST_V = Math.round(+bv.value) / 100; show(); };
  ch.oninput = function () { CREW_HP = Math.round(+ch.value); show(); };
  cd.oninput = function () { CREW_DEATH = Math.round(+cd.value); show(); };
  bx.oninput = function () { BOX_N = Math.round(+bx.value); show(); };
  cy.oninput = function () { CARRY_N = Math.round(+cy.value); show(); };
  dr.oninput = function () { DROWN_T = Math.round(+dr.value); show(); };
  var nr = $('navre'); nr.min = LIM.navre[0]; nr.max = LIM.navre[1];       // 尋路動態更新（TASK-0572）
  nr.oninput = function () { NAV_RE = +nr.value; show(); };
  var hl = $('heal'); hl.min = LIM.heal[0]; hl.max = LIM.heal[1];          // 醫療艙的治療時間（TASK-0568）
  hl.oninput = function () { HEAL_T = Math.round(+hl.value); show(); };
  var mk = $('musket'); mk.min = LIM.musket[0]; mk.max = LIM.musket[1];   // 火槍射程（TASK-0633）
  mk.oninput = function () { MUSKET_R = Math.round(+mk.value); show(); };
  var sf = $('sailfix'); sf.min = LIM.sailfix[0]; sf.max = LIM.sailfix[1];   // 帆匠補帆時間（TASK-0699）
  sf.oninput = function () { SAILFIX_T = Math.round(+sf.value); show(); };
  var bu = $('burn'); bu.min = LIM.burn[0]; bu.max = LIM.burn[1];       // 火勢（TASK-0717）
  bu.oninput = function () { BURN_PCT = Math.round(+bu.value); show(); };
  var ga = $('galley'); ga.min = LIM.galley[0]; ga.max = LIM.galley[1];   // 廚房加成（TASK-0720）
  ga.oninput = function () { GALLEY_PCT = Math.round(+ga.value); show(); };
  $('gcrew').onchange = function () { GUN_CREW_HURT = $('gcrew').checked; show(); };
  $('dbg').onchange = function () { DBG_SET = $('dbg').checked; show(); };   // Debug 模式（04_state.js dbgOn）：遊戲中也生效   // 砲被打飛 ⇒ 砲班跟著受傷（TASK-0568）
  st.oninput = function () { STALL_K = +st.value; show(); };
  whl.oninput = function () { WHEEL_LOSS = +whl.value; show(); }; rdl.oninput = function () { RUDDER_LOSS = +rdl.value; show(); }; dtq.oninput = function () { DIFF_K = +dtq.value; show(); }; fhl.oninput = function () { FUN.helmloss = +fhl.value; show(); }; fhe.oninput = function () { FUN.helmeff = +fhe.value; show(); }; fdf.oninput = function () { FUN.diff = +fdf.value; show(); };   // 操舵（TASK-0777，31_drive.js）
  se.oninput = function () { SEA_K = +se.value; show(); };
  fs.oninput = function () { FUN.speed = +fs.value; show(); }; fa.oninput = function () { FUN.agile = +fa.value; show(); }; fl.oninput = function () { FUN.stall = +fl.value; show(); }; fp.oninput = function () { FUN.powder = +fp.value; show(); }; fh.oninput = function () { FUN.hard = +fh.value; show(); };
  wk.oninput = function () { WIND_K = +wk.value; show(); };
  wc.oninput = function () { WIND_CAP = +wc.value; show(); };
  $('inertia').oninput = function () { DRV_INERTIA = +$('inertia').value; show(); }; $('turninert').oninput = function () { DRV_TURN = +$('turninert').value; show(); }; $('sailtq').oninput = function () { DRV_TQ = +$('sailtq').value; show(); };   // 每一步讀 ⇒ 遊戲中也能調          // 物理是每一步讀 ⇒ 遊戲中也能調（只管畫面）
  for (var r = 0; r < 3; r++) for (var k = 0; k < 3; k++) (function (r, k) {
    var el = am(r, k);
    el.oninput = function () { var v = parseFloat(el.value); if (isFinite(v)) { AMMO_K[r][k] = clamp(Math.round(v), AMMO_LIM[0], AMMO_LIM[1]); show(); } };
    el.onchange = function () { el.value = AMMO_K[r][k]; };          // 打了界外或空白 ⇒ 回到夾過的值
  })(r, k);
  ['guns', 'masts', 'officers'].forEach(function (k) { var b = $('st-' + k); b.onchange = function () { STRIKE[k] = b.checked; show(); }; });
  [0, 1].forEach(function (i) { var s = $('cap' + i); capOptions(s, CAP_SET[i]); s.onchange = function () { CAP_SET[i] = s.value; show(); }; });   // 砲長
  // 船隻設定：編輯哪一型 —— 跟編成同一個選船彈窗（72_shippick.js；選到還沒載的船 ⇒ 先載，壓艙物的預設要船型才算得出來）
  $('cfgShip').onclick = function () { spkOpen({ title: '船隻配置：編輯哪一型', cur: CFG_ID, pick: function (id) { CFG_ID = id; loadHull(CFG_ID).then(function () { put(); show(); }); put(); show(); } }); };
  fleetUI();                                                     // 主選單：艦隊編成
  // 細節設定那一頁：主選單 ⇄ 細節設定（同一個 #cover 裡兩張卡片，一次顯示一張）
  function page(w) { $('detail').style.display = w === 'det' ? '' : 'none'; gfxPanel(w === 'gfx'); $('phxp').style.display = w === 'phx' ? '' : 'none'; $('shipp').style.display = w === 'ship' ? '' : 'none'; $('gunp').style.display = w === 'gun' ? '' : 'none'; $('furnp').style.display = w === 'furn' ? '' : 'none'; $('keysp').style.display = w === 'keys' ? '' : 'none'; $('sndp').style.display = w === 'snd' ? '' : 'none'; if ($('wqp')) $('wqp').style.display = w === 'wq' ? '' : 'none'; if (w !== 'keys') KEY_WAIT = null; document.querySelector('#cover .card:not(#detail):not(#gfxp):not(#phxp):not(#shipp):not(#gunp):not(#furnp):not(#keysp):not(#sndp):not(#wqp)').style.display = w ? 'none' : ''; $('cover').scrollTop = 0; $('pgX').classList.toggle('on', !!w && !ADMIN_ROOMS); }   // w：'' 主選單、'det' 細節設定、'gfx' 畫質設定、'phx' 物理設定、'ship' 船隻配置、'gun' 砲的設定、'furn' 道具設定（67_furncfg.js）
  evOn('gfxov:back', function () { page(''); });                 // 畫質那一層（核心）在主選單按返回 ⇒ 回主選單
  [].forEach.call(document.querySelectorAll('#plays button'), function (b) { b.onclick = function () { setPlay(b.dataset.p); show(); }; });   // 主選單：玩法
  $('detB').onclick = function () { page('det'); };
  $('detX').onclick = function () { page(''); };
  $('gfxB').onclick = function () { page('gfx'); };
  $('phxB').onclick = function () { page('phx'); };
  $('phxX').onclick = function () { page(''); };
  $('shipB').onclick = function () { page('ship'); loadHull(CFG_ID).then(function () { put(); show(); }); };   // 船隻配置：先載那一型（砲數、桅數、壓艙物的預設要船型）
  if (ADMIN_DEF) admDefUI(page);                                 // 出廠預設值（?admin=defaults）：直接開細節設定頁
  if (ADMIN_ROOMS) {                                              // 甲板與艙房編輯器：後台開的分頁（TASK-0647；舊的 iframe 也認）
    $('shipB').onclick();
    var aw = admWin();
    if (aw) { try { aw.postMessage({ kind: 'cb-ready' }, location.origin); } catch (e) { /* 後台關了 */ } }
    else { var wn = document.createElement('p'); wn.className = 'admWarn'; wn.style.cssText = 'color:#f9a;margin:6px 0'; wn.textContent = '⚠ 找不到設定後台：要從設定後台最上面的「甲板與艙房編輯器…」開這一頁；直接開的改了也不會送回去'; $('shipp').insertBefore(wn, $('shipp').firstChild); }
  }
  $('shipX').onclick = function () { page(''); };
  $('gunB').onclick = function () { page('gun'); gunShow(); };   // 砲的設定（68_guncfg.js）
  // 天氣設定（TASK-0683；Tim 2026-10-17「或是開一個天氣設定頁(參考船隻設定) 可以設定不同天氣參數(大漩渦半徑 轉速 深度等放裡面)」）：描述表 08_weather.js WXK_ITEMS，整頁照 64_cfgkit.js cfgPage 生
  function wqBtn() { var b = $('wqB'), n = wxkChanged(); b.textContent = n ? '天氣設定（改過）…' : '天氣設定…'; b.className = n ? 'on' : ''; }
  var WQ = cfgPage({ id: 'wq', title: '天氣設定', sub: '暴風雨與大漩渦的參數（晴天不在這裡）。下一場開始生效；主選單背景的大漩渦馬上跟著變。',
    items: WXK_ITEMS, get: wxkGet, def: wxkDef, set: function (k, v) { wxkSet(k, v); wqBtn(); }, reset: function () { wxkReset(); wqBtn(); },
    kind: 'weather', file: 'blockside_weather', what: '天氣設定', back: function () { page(''); } });
  // 吸力讀數（Tim 2026-10-17「或是可以有一個頁面可調參數 來控制吸力變化」）：照現在的設定算各處的終端漂移（08_sea.js vxSuckV），改滑桿就跟著變
  var wqS = document.createElement('div'); wqS.className = 'row note'; wqS.id = 'wqSuck'; $('wqItems').appendChild(wqS);
  function wqSuck() { var o = WEATHERS.maelstrom.vortex; wqS.textContent = '吸力（靜止的船最後被拉多快）：' + [10, 50, 100, 200, 400].map(function (r) { return r + ' m ' + vxSuckV(o, r).toFixed(2); }).join('・') + ' m/s'; }
  [].forEach.call($('wqItems').querySelectorAll('input[type=range]'), function (r) { r.addEventListener('input', wqSuck); });
  $('wqB').onclick = function () { page('wq'); WQ.show(); wqSuck(); };
  wqBtn(); wqSuck();
  $('gunX').onclick = function () { page(''); };
  $('furnB').onclick = function () { page('furn'); furnShow(); };   // 道具設定（67_furncfg.js）
  $('furnX').onclick = function () { page(''); };
  $('keysB').onclick = function () { page('keys'); keysShow(); };   // 鍵位設定（66_keys.js）
  $('keysX').onclick = function () { page(''); };
  bgmUI();                                                       // 聲音設定的滑桿與按鈕（主選單那一頁＋遊戲內設定面板，02_music.js）
  $('sndB').onclick = function () { page('snd'); sndShow(); };   // 聲音設定（02_music.js，TASK-0677）
  $('sndX').onclick = function () { page(''); };
  $('pgX').onclick = function () { RE.i = -1; show(); page(''); };   // 右上角的返回（每一頁同一顆）
  function shipReset(id) {                             // 一型回到預設：船員、艙房的擺法、換裝、壓艙物、性能
    delete SHIP_CREW[id]; delete SHIP_ROOMS[id]; delete PREF_BALLAST[id];
    if (SHIP_FIT[id]) { delete SHIP_FIT[id]; fitDirty(id); }            // 換裝回出廠（38_fit.js）：已經載好的船型丟掉重載
    var c = shipCfg(id); SHIP_KEYS.forEach(function (k) { c[k] = k === 'ballast' ? (HULLT[id] ? HULLT[id].ballast0 : undefined) : cfgBase(k, id); });
  }
  cfgKit('ship', {                                     // 那一排按鈕（64_cfgkit.js）；這一型回到預設按兩下（Tim：編起來很花時間 ⇒ 不要一按就沒了）
    one: { idle: '這一型回到預設', arm: function () { var hi = hullInfo(CFG_ID); return '再按一次：' + (hi ? hi.name : CFG_ID) + '的船員、艙房、換裝與性能都回到預設'; }, run: function () { shipReset(CFG_ID); } },
    all: { title: '船隻配置全部回到預設', body: '每一型船（不只正在看的這一型）的船員、艙房擺設、換裝、壓艙物與性能都回到預設。改過的會不見；要留的話先按「匯出…」。',
      run: function () {                               // 每一型（設定檔裡的船＋存檔裡有、這份成品沒有的）
        var ids = {}; CFG.ships.forEach(function (s) { ids[s.id] = 1; }); [SHIP_CFG, SHIP_CREW, SHIP_ROOMS, SHIP_FIT, PREF_BALLAST].forEach(function (m) { Object.keys(m).forEach(function (id) { ids[id] = 1; }); });
        Object.keys(ids).forEach(shipReset); return '已全部回到預設（' + CFG.ships.length + ' 型船）。';
      } },
    kind: 'ships', file: 'constitution_broadside_ships', expSay: '每一型的船員與性能', exp: function () { var o = shipsExport(); return { cfg: o.cfg, crew: o.crew, rooms: o.rooms, fit: o.fit }; },   // 69_prefs.js shipsExport（fit：換裝表，38_fit.js）
    imp: shipsImport, what: '船隻配置', unit: '型船', show: function () { put(); show(); }
  });
  $('allR').onclick = function () {                    // 主選單的全部回到預設：刪掉這台瀏覽器的存檔、重新載入 ⇒ 每一項都照程式與設定檔的預設（網址帶的參數照舊優先）
    askOk('全部回到預設', '主選單的選擇（模式、玩法、艦隊、航行、距離、天氣、畫質、物理效果）、細節設定、船隻配置、砲的設定、道具設定、鍵位，全部回到預設：這台瀏覽器裡的存檔會刪掉，頁面重新載入。要留的話先到各設定頁按「匯出…」。', '全部回到預設', function () {
      PREFS.write = false;                               // ⛔ 關頁時的自動存檔會把現在的設定又寫回去（69_prefs.js）
      try { window.localStorage.removeItem(PREFS_KEY); } catch (e) { /* 這一頁不能用 localStorage（畫廊彈窗）⇒ 本來就沒有存檔 */ }
      location.reload();
    });
  };
  askUI();                                             // 確認彈窗（65_ask.js）：⛔ 要比 keysUI 先掛（鍵盤的捕獲階段照掛的先後）
  gfxMenuUI(); phxUI(); gunUI(); gunShow(); furnUI(page); furnShow(); keysUI(page); keysShow();
  if (ADMIN_FURN) { page('furn'); furnShow(); }
  if (ADMIN_KEYS) { page('keys'); keysShow(); }                   // 鍵位的出廠預設值（?admin=keys）：直接開鍵位設定頁（66_keys.js keysAdmUI）                   // 道具的出廠預設值（?admin=furn）：直接開道具設定頁（67_furncfg.js furnAdmUI 接存檔、重建）
  $('detR').onclick = function () {                    // 重設預設值：LIM 的第三格、降旗全不勾
    // 船隻配置頁（每一型的船員與性能）不跟著重設：那一頁有自己的「這一型回到預設」（TASK-0570：編起來很花時間）
    GUN_HP = LIM.gunhp[2]; SAIL_HP = LIM.sailhp[2]; POWDER_HP = LIM.powderhp[2]; BLAST_K = LIM.blast[2]; BLAST_V = LIM.blastv[2]; CREW_HP = LIM.crewhp[2]; CREW_DEATH = LIM.crewdeath[2];
    BOX_N = LIM.box[2]; CARRY_N = LIM.carry[2]; WIND_K = LIM.wind[2]; WIND_CAP = LIM.windcap[2]; DRV_INERTIA = LIM.inertia[2]; DRV_TURN = LIM.turninert[2]; DRV_TQ = LIM.sailtq[2]; HANDS = LIM.hands[2]; DROWN_T = LIM.drown[2]; NAV_RE = LIM.navre[2]; HEAL_T = LIM.heal[2]; MUSKET_R = LIM.musket[2]; SAILFIX_T = LIM.sailfix[2]; BURN_PCT = LIM.burn[2]; GALLEY_PCT = LIM.galley[2]; GUN_CREW_HURT = true; DBG_SET = false;
    AMMO_K = AMMO_K0.map(function (r) { return r.slice(); });
    SEA_K = LIM.sea[2]; STALL_K = LIM.stall[2]; FUN.speed = LIM.funspeed[2]; FUN.agile = LIM.funagile[2]; FUN.stall = LIM.funstall[2]; FUN.powder = LIM.funpowder[2]; WHEEL_LOSS = LIM.wheelloss[2]; RUDDER_LOSS = LIM.rudderloss[2]; DIFF_K = LIM.difftq[2]; FUN.helmloss = LIM.funhelmloss[2]; FUN.helmeff = LIM.funhelmeff[2]; FUN.diff = LIM.fundiff[2];
    STRIKE.cas = LIM.cas[2]; STRIKE.guns = STRIKE.masts = STRIKE.officers = false; CAP_SET = ['random', 'random'];
    put(); show(); prefsReset();                         // 存檔跟著清（69_prefs.js：只剩主選單的選擇）
  };
  window.addEventListener('keydown', function (e) { if (!RUNNING && e.key === 'Escape' && ($('detail').style.display !== 'none' || gfxPanelOn() || $('phxp').style.display !== 'none' || $('shipp').style.display !== 'none' || $('gunp').style.display !== 'none' || $('furnp').style.display !== 'none' || ($('keysp').style.display !== 'none' && !KEY_WAIT))) page(''); });   // 鍵位設定頁正在等新鍵 ⇒ Esc 是取消（66_keys.js），不關頁
  put(); if (START_Q) yieldUI().then(show); else show();                // ?start=1：主選單的說明文字與船卡（show 約 0.03 s）晚一個工作再畫（不擠在載入頁面那一段）
  SLIDERS_SHOW = function () { put(); show(); };
  evOn('hullReload', function () { put(); show(); }, 0, true);           // 換裝改了、那一型重載好了（38_fit.js fitDirty）⇒ 卡片照新的船型畫
}
/** 物理效果（09_phx.js）：主選單的全開／高／中／低、物理設定頁每一項的按鈕。帆與繩換到「關」或從「關」換出來 ⇒ setPhys（跟 B 鍵同一支）。 */
function phxUI() {
  var box = $('phxItems');
  box.innerHTML = PHX_ITEMS.map(function (it) {
    return '<div class="row"><label>' + it.name + '</label>' + it.opt.map(function (o, v) { return '<button data-k="' + it.k + '" data-v="' + v + '">' + o + '</button>'; }).join('') + '</div>' + (it.k === 'shipdmg' ? ramRows() : '');   // 碰撞傷害底下：它的數值（ramRows）
  }).join('') + '<div class="row"><label>物理減速</label><button data-pslow="0">關</button><button data-pslow="1">開（計算量大時放慢模擬）</button></div>'   // 不跟四檔走（73_slowmo.js PSLOW）
    + '<div class="row slide"><label for="pslowR">減速門檻</label><input type="range" id="pslowR" min="' + LIM.pslowb[0] + '" max="' + LIM.pslowb[1] + '" step="0.05" aria-label="模擬最多佔真實時間幾成，超過就放慢"><span id="pslowV"></span></div>';
  [].forEach.call(box.querySelectorAll('button[data-k]'), function (b) { b.onclick = function () { PHX[b.dataset.k] = +b.dataset.v; phxSync(); }; });
  [].forEach.call(box.querySelectorAll('button[data-pslow]'), function (b) { b.onclick = function () { if ((b.dataset.pslow === '1') !== PSLOW.on) pslowToggle(); }; });
  var pr = $('pslowR'); pr.oninput = function () { PSLOW.budget = Math.round(+pr.value * 100) / 100; phxShow(); };
  RAM_UI.forEach(function (u) { var el = $('ram_' + u.k); el.oninput = function () { RAM[u.k] = ramFrom(u, +el.value); phxShow(); }; });
  [].forEach.call(document.querySelectorAll('#phxs button[data-x], #phxPre button'), function (b) { b.onclick = function () { phxSet(b.dataset.x); phxSync(); }; });
  phxShow();
}
/** 碰撞傷害的數值（TASK-0652；Tim 2026-10-16：「數值可以開成設定頁面Slider嗎(開啟碰撞傷害後才顯示)」）：接在「碰撞傷害」那一列底下，開關關著 ⇒ 整塊藏起來（phxShow）。
 *  k ＝ RAM 的欄位、q ＝ 設定檔 lim 與網址的鍵、st ＝ 步長；txt ＝ 數值後面那一段說明；log ⇒ 滑桿照對數走（傷害倍率 0.2–100：Tim 2026-10-16「傷害倍率上限可以調整到100x嗎」—— 線性的話 1 附近幾乎調不動），數值照大小取整（< 2 每 0.05、< 10 每 0.1、< 30 每 0.5、其他每 1）。 */
var RAM_UI = [
  { k: 'v0', q: 'ramv', name: '撞擊門檻', st: 0.1, txt: function (x) { return x.toFixed(1) + ' m/s（約 ' + (x * 1.944).toFixed(1) + ' 節）：沿接觸方向接近得比這快才算撞擊'; } },
  { k: 'k', q: 'ramk', name: '撞擊傷害倍率', st: 0.01, log: true, txt: function (x) { return '× ' + (x < 10 ? x.toFixed(2) : x.toFixed(x < 30 ? 1 : 0)) + '：撞掉多少格（速度照物理，不跟著變）'; } },
  { k: 'e', q: 'rame', name: '彈力係數', st: 0.05, txt: function (x) { return x.toFixed(2) + (x ? '：撞完反彈（恢復係數；沿接觸方向彈回 ' + Math.round(x * 100) + '% 的接近速度、拿去撞壞的能量剩 ' + Math.round((1 - x * x) * 100) + '%）' : '：不反彈（完全非彈性，撞完一起走）'); } },   // Tim 2026-10-16：「是否可以有加彈力系數(撞擊後反彈)」
  { k: 'side', q: 'ramside', name: '側撞有效質量', st: 0.5, txt: function (x) { return '× ' + x.toFixed(1) + '：被側面撞的船沿接觸方向多難推動（水擋著橫向）；越大 ⇒ 撞人的那艘停得越乾脆'; } }];
/** 滑桿的位置 ⇄ 數值（log 那一條照 log10）。 */
function ramPos(u, x) { return u.log ? Math.log10(x) : x; }
function ramFrom(u, v) {
  var L = LIM[u.q]; if (!u.log) return clamp(Math.round(v / u.st) * u.st, L[0], L[1]);
  var x = Math.pow(10, v), s = x < 2 ? 0.05 : x < 10 ? 0.1 : x < 30 ? 0.5 : 1; return clamp(Math.round(x / s) * s, L[0], L[1]);
}
function ramRows() {
  return '<div id="ramBox">' + RAM_UI.map(function (u) { var L = LIM[u.q]; return '<div class="row slide"><label for="ram_' + u.k + '">' + u.name + '</label><input type="range" id="ram_' + u.k + '" min="' + ramPos(u, L[0]) + '" max="' + ramPos(u, L[1]) + '" step="' + (u.log ? 'any' : u.st) + '" aria-label="' + u.name + '"><span id="ram_' + u.k + 'V"></span></div>'; }).join('') + '</div>';
}
function phxShow() {
  var lv = phxLevel();
  [].forEach.call(document.querySelectorAll('#phxs button[data-x], #phxPre button'), function (b) { b.className = b.dataset.x === lv ? 'on' : ''; });
  var pb = $('phxB'); pb.textContent = lv === 'custom' ? '自訂（物理設定…）' : '物理設定…'; pb.className = lv === 'custom' ? 'on' : '';
  [].forEach.call(document.querySelectorAll('#phxItems button[data-k]'), function (b) { b.className = PHX[b.dataset.k] === +b.dataset.v ? 'on' : ''; });
  [].forEach.call(document.querySelectorAll('#phxItems button[data-pslow]'), function (b) { b.className = (b.dataset.pslow === '1') === PSLOW.on ? 'on' : ''; });
  $('pslowR').value = PSLOW.budget; $('pslowV').textContent = '模擬最多佔 ' + Math.round(PSLOW.budget * 100) + '% 的時間' + (PSLOW.budget === LIM.pslowb[2] ? '（預設）' : '') + '：越低越早放慢、畫面越順' + (PSLOW.on ? '' : '（物理減速關著）');
  $('phxLv').textContent = '現在：' + PHX_NAME[lv];
  if ($('ramBox')) { $('ramBox').style.display = PHX.shipdmg ? '' : 'none'; RAM_UI.forEach(function (u) { var x = RAM[u.k]; $('ram_' + u.k).value = ramPos(u, x); $('ram_' + u.k + 'V').textContent = u.txt(x) + (Math.abs(x - LIM[u.q][2]) < 1e-9 ? '（預設）' : ''); }); }
  if (typeof gsetShow === 'function') gsetShow();
}
