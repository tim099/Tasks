// ───────────────────────── 選船彈窗（主選單的艦隊編成；Tim 2026-10-18「船數已經有多 下拉選單不好操作 是否可以改成變成一個按鈕 按下後彈窗選取…給船分類」） ─────────────────────────
// 編成那一列每艘一顆鈕（71_input.js fleetUI）、船隻配置頁的「船型」鈕（Tim 2026-10-18「船隻配置的選船是否可以套一樣的UI」）⇒ 點了開這個彈窗：
//   spkOpen({ title, cur 現在選的那一型, pick(id) 選了別的才叫 })；上面篩選（動力、噸位、火力、搜尋名字），下面卡片；點卡片 ＝ pick，彈窗關掉。
// 航速（Tim「選船時有辦法顯示船速嗎」）：跟船隻配置頁最上面那張卡片同一條算法（71_input.js shipCardShow）—— 照那一型現在的船隻設定（航速倍率、逆風性能、額外動力）與玩法的加成，
//   標準風、滿帆：順風／側順風（最快）／逆風（離風 180 − NOGO_DEG 度）＝ √(帆² ＋ 額外動力²)；沒有帆 ⇒ 只寫額外動力。⇒ 改了船隻設定、換了玩法，下次打開就跟著變（不存進卡片）。
// 卡片資料 ＝ config/ship_cards.json（admin.py shipcheck 量的：js/75_shipcheck.js shipCard；建置時內嵌成 #ship-cards）⇒ 打開彈窗不用解碼任何一艘船，
//   選定了才照舊 loadHull（只載編成裡的那幾艘）。沒量過的船（新匯入還沒跑 shipcheck）⇒ 卡片只寫名字，只在「全部」裡。
// 分類（Tim：「預設All 然後可以切分類 根據動力 噸位 火力等大致分類」）：三排各自篩、可以疊；預設都是全部。
//   動力 ＝ 卡片的 drive（帆 sail／蒸汽 steam／槳 oar／魔法 magic；船隊裡沒有的那一種不列）；
//   噸位 ＝ 設計水線排水量：小 ＜ SPK_TONS[0]、大 ≥ SPK_TONS[1]；火力 ＝ 全部的砲各打一發的彈重（公斤）：輕 ＜ SPK_VOLLEY[0]、重 ≥ SPK_VOLLEY[1]。
//   門檻照 2026-10-18 那 17 艘的分布切成大約三等份（噸位 4／6／7 艘、火力 5／8／4 艘；ship_cards.json），之後船多了再調。
var SHIP_CARDS = (window.VoxelKit.embeddedJSON('ship-cards') || {}).ships || {};
var SPK_TONS = [1000, 3000], SPK_VOLLEY = [200, 600];
var SPK_DRIVE = [['sail', '⛵', '帆船'], ['steam', '♨️', '蒸汽'], ['oar', '🚣', '槳帆'], ['magic', '✨', '魔法']];
var SPK = { cur: '', pick: null, same: false, onClose: null, f: { drive: '', tons: '', fire: '', q: '' }, open: false };   // 篩選照上一次（同一次開遊戲裡記著）；open ＝ 篩選那三排展開了沒（預設收著）
// 篩選收起來（Tim 2026-10-20 手機截圖：「請協助調整一下 手機板選船的排版 可以調整尺寸 確保上方篩選不要佔用太多空間」「另外篩選可以折疊(預設摺疊)」）：
//   上面只留一列「搜尋框＋篩選 ▾」，三排分類點了才展開；收著時那一顆寫有幾個篩選在用（亮金色），下面那一行寫篩了哪些 ⇒ 收著也看得出來。
//   以前 390 px 寬的手機：三排分類各折成兩行、加搜尋，佔掉畫面四成多。
var SPK_SHORT = { tons: { lo: '小船', mid: '中型', hi: '大船' }, fire: { lo: '火力輕', mid: '火力中', hi: '火力重' } };   // 下面那一行用的短名（動力照 SPK_DRIVE 的名字）
function spkTier(v, cut) { return v === undefined ? '' : v < cut[0] ? 'lo' : v >= cut[1] ? 'hi' : 'mid'; }
function spkMatch(h) {
  var c = SHIP_CARDS[h.id], F = SPK.f, q = F.q.trim().toLowerCase();
  if (q && (h.name + ' ' + h.id + ' ' + (h.author || '')).toLowerCase().indexOf(q) < 0) return false;
  if (!F.drive && !F.tons && !F.fire) return true;
  if (!c) return false;
  return (!F.drive || c.drive === F.drive) && (!F.tons || spkTier(c.tons, SPK_TONS) === F.tons) && (!F.fire || spkTier(c.volley, SPK_VOLLEY) === F.fire);
}
/** 這一型的航速（節）：[順風, 側順風, 逆風]；沒有帆 ⇒ [額外動力]。⛔ 不呼叫 shipCfg：那會替沒動過的船型建一份設定（照預設值算就好）。 */
function spkSpeed(id, c) {
  var k = SHIP_CFG[id] || {}, g = function (key) { return k[key] !== undefined ? k[key] : cfgDefault(key, null, id); };
  var kn = VMAX * g('speed') * playK('speed') * 1.9438, B = (+g('base') || 0) * playK('speed');   // 額外動力也吃娛樂加成（31_sailing.js vB）
  if (c && !c.sails) return B ? [B] : null;
  return [Math.hypot(kn * polar(0), B), Math.hypot(kn, B), Math.hypot(kn * polar(180 - NOGO_DEG), B)];
}
/** Blocksail 地球儀的海圖模式（TASK-0803）：這一型的穩定航速表（節）—— kn[i][j] ＝ 風速倍率 ws[i]（?wspd，1 ＝ 帆上 10 m/s）、船頭跟「風吹去的方向」夾 15·j 度（0 ＝ 正順風、180 ＝ 正頂風）；
 *  照 31_drive.js driveSteady（帆 × 視風倍率 sailWindK ＋ 額外動力，跟 driveStep 同一條）、帆全張完好、俥鐘全速、晴天、現在的船隻設定與玩法。地球儀在表裡內插 ⇒ 推進的公式只住核心。
 *  sail、base ＝ 帆（風速倍率 1、polar 1）、額外動力全速（節）—— 只給人看。 */
var SPK_WS = [0.3, 0.5, 0.7, 1, 1.4, 2, 3];
function spkChart(id, c) {
  var k = SHIP_CFG[id] || {}, g = function (key) { return k[key] !== undefined ? k[key] : cfgDefault(key, null, id); };
  var sp = VMAX * g('speed') * playK('speed'), vB = (+g('base') || 0) / 1.9438 * playK('speed'), up = +g('upwind') || 1, sails = !(c && !c.sails);
  var kn = SPK_WS.map(function (ws) {
    var row = [];
    for (var deg = 0; deg <= 180; deg += 15) {
      var dU = up === 1 || deg <= 90 ? deg : 90 + (deg - 90) / up, pp = polarPlay(dU), v1 = VMAX * Math.sqrt(ws) * pp * LIM.speed[2];   // v1 ＝ sh.vS1（31_sailing.js：預設航速倍率的船這個風向的航速）
      row.push(+(driveSteady(sails ? sp * Math.sqrt(ws) * pp : 0, vB, deg, WIND_SAIL * WIND_K * ws, v1) * 1.9438).toFixed(3));
    }
    return row;
  });
  return { sail: sails ? +(sp * 1.9438).toFixed(3) : 0, base: +(vB * 1.9438).toFixed(3), ws: SPK_WS, kn: kn };
}
function spkOpen(o) {
  SPK.cur = o.cur; SPK.pick = o.pick; SPK.same = !!o.same; SPK.onClose = o.onClose || null;   // same：點現在那一型也叫 pick；onClose(選了哪一型 | null)：關掉時叫（?pick=@host 用）
  $('spkT').textContent = o.title || '選船';
  spkFilters(); spkShow();
  $('spk').classList.add('on');
  var sb = $('spk').querySelector('input[type=search]'); if (sb && matchMedia('(pointer:fine)').matches) sb.focus();   // 手機不自動跳鍵盤
}
function spkClose(picked) { $('spk').classList.remove('on'); if (SPK.onClose) SPK.onClose(picked || null); }
/** 篩選那三排＋搜尋（每次打開重畫：船隊裡有哪幾種動力照卡片算）。 */
function spkFilters() {
  var have = {}; HULL_LIST.forEach(function (h) { var c = SHIP_CARDS[h.id]; if (c) have[c.drive] = 1; });
  function row(k, name, opts) {
    return '<div class="spkR" data-k="' + k + '"><span>' + name + '</span>' + [['', '全部']].concat(opts).map(function (o) { return '<button data-v="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div>';
  }
  var t = function (a, b) { return a.toLocaleString() + (b ? '–' + b.toLocaleString() : ''); };
  $('spkF').innerHTML = '<div class="spkS"><input type="search" placeholder="搜尋船名、建造者…" aria-label="搜尋船名或建造者"><button id="spkFT" aria-controls="spkFB"></button></div><div id="spkFB">' +
    row('drive', '動力', SPK_DRIVE.filter(function (d) { return have[d[0]]; }).map(function (d) { return [d[0], d[1] + ' ' + d[2]]; })) +
    row('tons', '噸位', [['lo', '小 &lt; ' + t(SPK_TONS[0]) + ' 噸'], ['mid', '中'], ['hi', '大 ≥ ' + t(SPK_TONS[1]) + ' 噸']]) +   // ⛔ 全形括號、「齊射」⇒ 390 px 寬的手機一排擠不進一行
    row('fire', '火力', [['lo', '輕 &lt; ' + SPK_VOLLEY[0] + ' kg'], ['mid', '中'], ['hi', '重 ≥ ' + SPK_VOLLEY[1] + ' kg']]) + '</div>';   // kg ＝ 齊射彈重（同卡片上的「齊射」）
  [].forEach.call($('spkF').querySelectorAll('.spkR[data-k]'), function (r) {
    [].forEach.call(r.querySelectorAll('button'), function (b) { b.onclick = function () { SPK.f[r.dataset.k] = b.dataset.v; spkShow(); }; });
  });
  $('spkFT').onclick = function () { SPK.open = !SPK.open; spkShow(); };
  var sb = $('spkF').querySelector('input'); sb.value = SPK.f.q; sb.oninput = function () { SPK.f.q = sb.value; spkShow(); };
}
/** 卡片（照篩選）＋篩選鈕的亮燈。 */
function spkShow() {
  [].forEach.call($('spkF').querySelectorAll('.spkR[data-k]'), function (r) { [].forEach.call(r.querySelectorAll('button'), function (b) { b.className = b.dataset.v === SPK.f[r.dataset.k] ? 'on' : ''; }); });
  var cur = SPK.cur, L = HULL_LIST.filter(spkMatch), dn = {}, F = SPK.f;
  SPK_DRIVE.forEach(function (d) { dn[d[0]] = d; });
  var used = [F.drive && dn[F.drive] && dn[F.drive][2], F.tons && SPK_SHORT.tons[F.tons], F.fire && SPK_SHORT.fire[F.fire]].filter(Boolean);
  $('spkF').classList.toggle('open', SPK.open);
  var ft = $('spkFT'); ft.textContent = '篩選' + (used.length ? '・' + used.length : '') + (SPK.open ? ' ▴' : ' ▾'); ft.className = used.length ? 'on' : ''; ft.setAttribute('aria-expanded', SPK.open ? 'true' : 'false');
  $('spkN').textContent = '顯示 ' + L.length + '／' + HULL_LIST.length + ' 艘' + (used.length ? '（' + used.join('・') + '）' : '') + (L.length ? '' : ' —— 沒有符合的船，換一個篩選') + '・航速：' + (PLAY === 'fun' ? '娛樂' : '寫實') + '、標準風、滿帆';
  $('spkN').title = '航速照現在的船隻設定與玩法算（標準風、滿帆）';
  $('spkG').innerHTML = L.map(function (h) {
    var c = SHIP_CARDS[h.id], d = c && dn[c.drive];
    var m = c ? '<span class="m">' + c.tons.toLocaleString() + ' 噸・水線 ' + c.len + ' m</span><span class="m">砲 ' + c.guns + ' 門・齊射 ' + c.volley.toLocaleString() + ' kg' + (c.crew ? '・' + c.crew + ' 人' : '') + '</span>'
      : '<span class="m">（還沒量：admin.py shipcheck）</span>';
    var v = spkSpeed(h.id, c);
    if (v) m += '<span class="m">' + (v.length === 1 ? '航速 ' + v[0].toFixed(1) + ' 節（額外動力）' : '航速 順風 ' + v[0].toFixed(1) + '・側順風 ' + v[1].toFixed(1) + '・逆風 ' + v[2].toFixed(1) + ' 節') + '</span>';
    return '<button class="spkC' + (h.id === cur ? ' on' : '') + '" data-id="' + h.id + '"' + (d ? ' title="' + d[2] + '"' : '') + '>' + (d ? '<span class="i">' + d[1] + '</span>' : '') + '<b>' + h.name + '</b>' + m +
      (h.author ? '<span class="m">建造者 ' + h.author + '</span>' : '') + '</button>';
  }).join('');
  [].forEach.call($('spkG').querySelectorAll('button.spkC'), function (b) { b.onclick = function () { var id = b.dataset.id; spkClose(id); if ((id !== cur || SPK.same) && SPK.pick) SPK.pick(id); }; });
}
$('spkX').onclick = function () { spkClose(); };
$('spk').onclick = function (e) { if (e.target === $('spk')) spkClose(); };   // 點彈窗外面關
window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('spk').classList.contains('on')) { e.preventDefault(); e.stopImmediatePropagation(); spkClose(); } }, true);   // 捕獲階段：先於主選單的 Esc（關子頁）
// ───────────────────────── ?pick=@host：只開選船彈窗（Blocksail 地球儀的「選船」；Tim 2026-10-20「加上一個選船欄位(可以直接開原本的選船介面) 只要能選一艘就好 航海時使用選取的船」） ─────────────────────────
// 地球儀把這一頁開在 iframe 裡（?pick=@host&cur=<現在那一型>）⇒ 不開主選單、不載編成、不跑畫面迴圈（90_main.js），只開這個彈窗；頁面透明（template.html html.pickonly）。
//   這一頁 ⇒ 外面那一頁（{ bspick: … }）：'ready' 彈窗開好了；'measuring' { id, name } 選了、在載那一型；'picked' { id, name, knots, draft, loa, play, img, imgU, imgV, imgM } 量好了（img ＝ 俯視圖 PNG 的 data URL）；'cancel' 沒選就關了；'error' { id, msg }。
//   knots ＝ 卡片上那一型最快的航速（spkSpeed：標準風、滿帆＋額外動力全速，照現在的船隻設定與玩法）⇒ 地球儀上照它開；
//   chart ＝ 海圖模式的穩定航速表（spkChart：風速 × 風向 ⇒ 節，照核心的推進公式解；TASK-0803）⇒ 地球儀照風向、風速查這一型的航速；
//   draft ＝ 開戰時吃水多深（m：船底最低點（32_ground.js groundKeel）到水面，照開戰時的重量浮高／吃水深 liftFor，跟船隻配置頁的卡片同一套）、loa ＝ 外框全長（m，含艏斜桅）
//   ⇒ 航海找起點要的「夠我艦吃水的水深」「我艦多長」（Blocksail presets.js BLOCKSAIL_SAIL 的 depth、r）。
var PICK_HOST = Q.get('pick') === '@host' ? (window.parent !== window ? window.parent : window.opener) : null;
if (PICK_HOST) document.documentElement.classList.add('pickonly');
function pickPost(what, o) { try { PICK_HOST.postMessage(Object.assign({ bspick: what }, o || {}), '*'); } catch (e) { /* 外面那一頁關了 */ } }
function pickBoot() {
  spkOpen({ title: Q.get('title') || '選船', cur: Q.get('cur') || '', same: true, pick: pickMeasure, onClose: function (id) { if (!id) pickPost('cancel'); } });
  pickPost('ready');
}
function pickMeasure(id) {
  var h = hullInfo(id); pickPost('measuring', { id: id, name: h ? h.name : id });
  loadHull(id).then(function (T) {
    var k = SHIP_CFG[id] || {}, c = { gunw: k.gunw !== undefined ? k.gunw : cfgDefault('gunw', null, id), ballast: k.ballast !== undefined ? k.ballast : cfgDefault('ballast', T) };   // ⛔ 不呼叫 shipCfg（同 spkSpeed）
    var L = liftFor(T, T.disp - hullT0(T, c).all) || 0, z0 = groundKeel(T).reduce(function (a, p) { return Math.min(a, p[1]); }, T.zw), v = spkSpeed(id, SHIP_CARDS[id]), TI = topImg(T, 2);
    pickPost('picked', { id: id, name: T.name, knots: v ? +Math.max.apply(null, v).toFixed(2) : 0, chart: spkChart(id, SHIP_CARDS[id]), draft: +((T.zw - z0) * S - L).toFixed(2), loa: +((T.hx1 - T.hx0) * S).toFixed(1), play: PLAY,
      img: TI ? TI.cv.toDataURL('image/png') : null, imgU: TI && TI.u, imgV: TI && TI.v, imgM: TI && TI.m });   // 整艘船的俯視圖（05_hull.js topImg：船殼＋帆桁等模型＋帆，船頭朝上、右舷在右）：imgU／imgV ＝ 船的中心在圖上哪一點，imgM ＝ 圖上一點幾公尺 ⇒ 地球儀照實際比例尺畫
  }, function (e) { pickPost('error', { id: id, msg: e && e.message || String(e) }); });
}
