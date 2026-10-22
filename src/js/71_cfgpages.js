// ───────────────────────── Blockside 的外殼：鍵位、道具、砲、出廠預設值、聲音的設定頁（TASK-0774 第 3 步：從 66_keys／67_furncfg／68_guncfg／69_prefs／02_music 搬來）─────────────────────────
// 資料那半（KEY_*、keyApply、GUNS、gunsSnap、FURN0、furnSnap、prefsSnap…）留在原本的檔（核心）；這裡只有頁面。內容一字不改（02_music 的聲音頁拆成核心的音量＋這裡的 BGM 那幾排）。
// ── 鍵位頁（66_keys.js）
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
// ── 道具頁（67_furncfg.js）
function furnExport() {
  function all(pre, src) { var g = {}; furnIds().forEach(function (id) { var T = furnTab(id); if (id.indexOf(pre) !== 0 || (pre === '' && id.indexOf('drv:') === 0)) return; g[T.id] = {}; T.items.forEach(function (it) { if (it.has(T.def[T.id])) g[T.id][it.k] = fGet(src[T.id], it.k); }); }); return g; }
  return cfgHead('furniture', { furn: all('', FURN), drv: all('drv:', DRVP) });
}
function furnImport(o) { return cfgMine(o, 'furniture') ? furnApply(o.furn) + drvApply(o.drv) : -1; }
// ── 頁面（71_input.js 接返回、換頁） ──
var FURN_ID = furnIds()[0];
function furnFmt(it, v) { return it.pct ? '+' + Math.round(v * 100) + '%' : it.per ? Math.round(v * 100) + '%' : (it.int ? String(v) : v.toFixed(it.fix || 2)) + (it.unit || ''); }
function furnName(id) { var T = furnTab(id), f = T.cur[T.id]; if (T.cur === DRVP) return f.name + '（動力件）'; var t = ROOM_FN[f.type]; return f.name + (t ? '（' + t.name + '）' : ''); }
function furnUI(page) {
  var sel = $('furnSel'), ids = furnIds(), ALL = FURN_ITEMS.concat(DRV_ITEMS);
  sel.innerHTML = ids.map(function (id) { return '<option value="' + id + '">' + furnName(id) + '</option>'; }).join('');
  sel.value = FURN_ID; sel.onchange = function () { FURN_ID = sel.value; furnShow(); };
  $('furnItems').innerHTML = cfgSliders(ALL, 'fk-', function (it, h) { return '<div class="fk" data-k="' + it.k + '">' + h + '</div>'; });   // 這一種沒有的那一格照 data-k 藏（furnShow）
  ALL.forEach(function (it) { var r = $('fk-' + it.k); r.oninput = function () { var T = furnTab(FURN_ID), v = +r.value; if (it.fit) v = it.fit(T.cur[T.id], v); furnSet(FURN_ID, it.k, v); furnShow(); }; });
  cfgKit('furn', {                                       // 那一排按鈕（64_cfgkit.js）
    one: { idle: '這一種回到預設', arm: function () { var T = furnTab(FURN_ID); return '再按一次：' + T.cur[T.id].name + '回到預設'; }, run: function () { furnReset(FURN_ID); } },
    all: { title: '道具設定全部回到預設', body: '每一種道具與動力件（不只正在看的這一種）都回到預設。改過的會不見；要留的話先按「匯出…」。',
      run: function () { var ids = furnIds(); ids.forEach(furnReset); return '已全部回到預設（' + ids.length + ' 種）。'; } },
    kind: 'furniture', file: 'constitution_broadside_furniture', expSay: '每一種道具、動力件整份', exp: function () { var o = furnExport(); return { furn: o.furn, drv: o.drv }; },
    imp: furnImport, what: '道具設定', unit: '種', show: furnShow
  });
  if (ADMIN_FURN) furnAdmUI(page);
}
/** 變數 ⇒ 這一頁（這一種沒有的那一格藏起來；跟預設不一樣的標「改過」）。 */
function furnShow() {
  var T = furnTab(FURN_ID), id = T.id, f = T.cur[id], f0 = T.def[id] || f;
  FURN_ITEMS.concat(DRV_ITEMS).forEach(function (it) {
    var box = document.querySelector('#furnItems .fk[data-k="' + it.k + '"]'), on = T.items.indexOf(it) >= 0 && it.has(f0); box.style.display = on ? '' : 'none'; if (!on) return;
    var v = fGet(f, it.k), d = fGet(f0, it.k);
    $('fk-' + it.k).value = v;
    $('fk-' + it.k + 'V').textContent = cfgShown(function (x) { return furnFmt(it, x); }, v, d);
  });
  if (T.cur === DRVP && f.hpK !== undefined) $('furnInfo').innerHTML = '動力件：雕刻的模型 meta kind=' + id + '（造船規格 §9.10）・整支一塊・現在血量 ' + Math.round(GUN_HP * f.hpK) + '（砲 ' + GUN_HP + ' × ' + f.hpK.toFixed(2) + '）・改了下一場開始生效';
  else if (T.cur === DRVP) $('furnInfo').innerHTML = '動力件：雕刻的關聯 meta kind=' + id + '（造船規格 §9.6）・' + (f.cell !== undefined ? '傳動件：照兩端之間最細的那一截算' : '體素件：照這一件還剩幾成的格算') + '・每 1 秒算一次・改了下一場開始生效';
  else {
    var t = ROOM_FN[f.type], where = f.role === 'pump' ? '甲板（' + (f.place === 'well' ? '主桅旁中線' : '中線') + (f.power === 'steam' ? '、只有蒸汽船' : '') + (f.autoDeck > 0 ? '；沒自己改過的甲板每船補到 ' + f.autoDeck + ' 台' : '') + '）' : f.role === 'bench' ? '甲板（不夠每船至少的張數 ⇒ 自動補在水線以上最低那層砲甲板）' : t ? t.name : '';
    $('furnInfo').innerHTML = '擺在：' + where + '（船隻配置頁的「擺設…」）' + (f.size && S > 0 ? '・大小 ' + f.size.map(function (v) { return (v * S).toFixed(1); }).join('×') + ' m' : '')   /* S（公尺／格）第一艘船載好才有 ⇒ 之前不寫大小 */;
  }
  var n = Object.keys(FURN_SET).length + Object.keys(DRV_SET).length, b = $('furnB'); b.textContent = n ? '道具設定（改過）…' : '道具設定…'; b.className = n ? 'on' : '';
}
/** 開發後台（?admin=furn）：同一頁多一列 —— 「存成出廠預設」⇒ FURN_SET、DRV_SET 送給開這一頁的設定後台（postMessage；⛔ 成品裡不能有 fetch）⇒ admin.py act_furniture；「重建」；「回設定後台」。 */
function furnAdmUI(page) {
  cfgAdm({ panel: 'furnp', out: 'furnAdmL', from: '用道具設定頁設出廠預設值…', build: 'furnAdmB', back: ['furnAdmX', 'furnX', 'pgX'],
    save: { id: 'furnAdmS', run: function (post, out) {
      var o = furnSnap(), d = drvSnap(); if (!Object.keys(o).length && !Object.keys(d).length) { out.textContent = '（都跟出廠預設一樣，沒有要存的）'; return; }
      post('furn', { furn: o, drv: d }).then(function (j) {
        if (!j.ok) return;
        [[o, FURN0, FURN_SET], [d, DRVP0, DRV_SET]].forEach(function (A) { Object.keys(A[0]).forEach(function (id) { Object.keys(A[0][id]).forEach(function (k) { fPut(A[1][id], k, A[0][id][k]); }); delete A[2][id]; }); });
        furnShow();
      });
    } } });
}
// ── 砲的設定頁（68_guncfg.js）
function gunsExport() {
  var g = {}; Object.keys(GUNS).forEach(function (t) { g[t] = {}; GUN_ITEMS.forEach(function (it) { g[t][it.k] = gunVal(t, it.k); }); });
  return cfgHead('guns', { guns: g });
}
function gunsImport(o) { return cfgMine(o, 'guns') ? gunsApply(o.guns) : -1; }
// ── 頁面（71_input.js sliders 接返回、換頁） ──
var GUN_ID = Object.keys(GUNS)[0];
function gunFmt(t, it, v) { return (it.int ? String(v) : v.toFixed(it.fix || 2)) + (it.unit || ''); }
function gunUI() {
  var sel = $('gunSel');
  sel.innerHTML = Object.keys(GUNS).map(function (t) { return '<option value="' + t + '">' + GUNS[t].name + '（' + GUNS[t].code + '）</option>'; }).join('');
  sel.value = GUN_ID; sel.onchange = function () { GUN_ID = sel.value; gunShow(); };
  $('gunItems').innerHTML = cfgSliders(GUN_ITEMS, 'gk-');
  GUN_ITEMS.forEach(function (it) { var r = $('gk-' + it.k); r.oninput = function () { gunSet(GUN_ID, it.k, +r.value); gunShow(); }; });
  cfgKit('gun', {                                        // 那一排按鈕（64_cfgkit.js）
    one: { idle: '這一種回到預設', arm: function () { return '再按一次：' + GUNS[GUN_ID].name + '回到預設'; }, run: function () { gunReset(GUN_ID); } },
    all: { title: '砲的設定全部回到預設', body: '每一種砲（不只正在看的這一種）的數值與每發傷害都回到預設。改過的會不見；要留的話先按「匯出…」。',
      run: function () { var ts = Object.keys(GUNS); ts.forEach(gunReset); return '已全部回到預設（' + ts.length + ' 種砲）。'; } },
    kind: 'guns', file: 'constitution_broadside_guns', expSay: '每一種砲整份', exp: function () { return { guns: gunsExport().guns }; },
    imp: gunsImport, what: '砲的設定', unit: '種砲', show: gunShow
  });
}
/** 變數 ⇒ 這一頁（滑桿、數字、跟預設不一樣的標「改過」）。 */
function gunShow() {
  var t = GUN_ID, G = GUNS[t];
  GUN_ITEMS.forEach(function (it) {
    var r = $('gk-' + it.k), L = gunLim(t, it), v = gunVal(t, it.k), d = gunDef(t, it.k);
    r.min = L[0]; r.max = it.k === 'min' ? gunVal(t, 'crew') : L[1]; r.value = v;
    $('gk-' + it.k + 'V').textContent = cfgShown(function (x) { return gunFmt(t, it, x); }, v, d);
  });
  $('gk-burstGap').disabled = gunVal(t, 'burst') <= 1;
  var where = Object.keys(HULLT).map(function (id) { var n = (HULLT[id].rig.models || []).filter(function (m) { return modelKind(m) === t; }).length; return n ? ((hullInfo(id) || {}).name || id) + ' ' + n + ' 門' : ''; }).filter(Boolean);
  var rl = RELOAD * gunVal(t, 'reload'), bu = gunVal(t, 'burst');
  $('gunInfo').innerHTML = '代號 <b>' + G.code + '</b>・裝填約 <b>' + rl.toFixed(1) + '</b> 秒（標準砲班）' + (bu > 1 ? '・一份彈藥 ' + bu + ' 發、' + ((bu - 1) * gunVal(t, 'burstGap')).toFixed(2) + ' 秒打完' : '') +
    (where.length ? '<br>裝在：' + where.join('、') : '<br><span class="n">（裝在哪幾艘：開過的船才列得出來）</span>');
  var n = Object.keys(GUN_SET).length + Object.keys(DMG_Q).filter(function (k) { return DMG[k] !== LIM[DMG_Q[k]][2]; }).length;
  var b = $('gunB'); b.textContent = n ? '砲的設定（改過）…' : '砲的設定…'; b.className = n ? 'on' : '';
}
// ── 出廠預設值後台頁（69_prefs.js）
/** 出廠預設值（設定後台跳轉開的 ?admin=defaults；Tim 2026-10-15：「後台介面是否可以直接使用細節設定頁面的Layout(可以跳轉開啟) 只是變成套用成預設設定」「應該說用一樣的頁面去設定出廠預設值」）：
 *  開頁 ⇒ 細節設定頁（值 ＝ 這份成品裡設定檔的預設，PREFS 不讀不存）；「存成出廠預設」⇒ prefsSnap 跟預設不一樣的那幾項裡、是滑桿（LIM 有那個鍵、數字）的 ⇒ POST /api/defaults（admin.py act_defaults 只改 lim[鍵][2]）；
 *  其他（勾選、彈種倍率、砲長、主選單的選擇…）列出來、不存。存了 ⇒ 這一頁的 LIM 預設跟著換（再改從新的預設比）。「重建」⇒ /api/build。「回設定後台」⇒ 回 /。 */
function admDefUI(page) {
  page('det');
  cfgAdm({ panel: 'detail', out: 'detAdmL', from: '用細節設定頁設出廠預設值…', build: 'detAdmB', back: ['detAdmX', 'detX', 'pgX'],   // 64_cfgkit.js：回設定後台 ＝ 關掉這個分頁（後台是開它的那一頁）
    save: { id: 'detAdmS', run: function (post, out) {
      var o = prefsSnap(), lim = {}, skip = [];
      Object.keys(o).forEach(function (k) { if (k === 'v') return; if (LIM[k] && typeof o[k] === 'number') lim[k] = o[k]; else skip.push(k); });
      if (!Object.keys(lim).length) { out.textContent = '（滑桿都跟出廠預設一樣，沒有要存的）' + (skip.length ? '\n不是滑桿、沒存：' + skip.join('、') : ''); return; }
      post('save', { lim: lim }).then(function (j) {
        if (j.ok) Object.keys(lim).forEach(function (k) { LIM[k][2] = lim[k]; });
        if (skip.length) out.textContent += '\n不是滑桿、沒存：' + skip.join('、');
      });
    } } });
}
// ── 聲音設定頁的 BGM 那幾排（從 02_music.js 搬來；TASK-0774：音量滑桿留核心 sndShow／sndUI）
/** BGM：什麼時候放、選曲、主題曲亮哪一顆、正在放什麼（核心 sndShow 發 cfg:snd ⇒ 照這裡畫）。 */
function bgmShow() {
  [].forEach.call(document.querySelectorAll('#bgmModes [data-bm]'), function (b) { b.classList.toggle('on', b.dataset.bm === SND.mode); });
  [].forEach.call(document.querySelectorAll('#bgmTunes [data-bt]'), function (b) { b.classList.toggle('on', b.dataset.bt === SND.tune); });
  [].forEach.call(document.querySelectorAll('#bgmThemes [data-bth]'), function (b) { b.classList.toggle('on', +b.dataset.bth === SND.theme); });
  var nw = $('bgmNow'); if (nw) { var tn = BGM && BGM.tn, er = tn ? tuneEra(tn) : ''; nw.textContent = tn ? '正在放：' + (er ? er + '・' : '') + tn.name + '（' + tn.en + '）—— 譜：' + tn.src : '還沒放（按 ▶ 試聽，或開局後照上面的設定放）'; }
}
evOn('cfg:snd', bgmShow);
/** 綁一次（71_pages.js sliders 主選單初始化時叫）：選曲、什麼時候放、試聽、這一頁回到預設。 */
function bgmUI() {
  var tb = $('bgmTunes');
  if (tb && !tb.firstChild) {                                          // 第一列：輪播＋四首船歌（照舊）；年代篇（TASK-0718）一章一列，標題照 BGM_ERAS
    var q = function (s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); };   // 出處裡有引號（總統進行曲的 Sonneck 報告名）⇒ title 要跳脫
    var btn = function (t) { return '<button data-bt="' + t.id + '" title="' + q(t.en + '（' + t.src + '）—— ' + tuneInsts(t).map(function (k) { return INSTR[k].name; }).join('＋')) + '">' + q(t.name) + '</button><button data-bp="' + t.id + '" title="試聽 ' + q(t.name) + '">▶</button>'; };
    var h = '曲目 <button data-bt="shuffle">輪播</button>';
    TUNES.forEach(function (t) { if (!t.era) h += btn(t); });
    BGM_ERAS.forEach(function (e) {
      var r = ''; TUNES.forEach(function (t) { if (t.era === e[0]) r += btn(t); });
      if (r) h += '<div class="row">' + e[1] + ' ' + r + '</div>';
    });
    tb.innerHTML = h;
  }
  var tt = $('bgmThemes');
  if (tt && !tt.firstChild) {                                          // 船的主題曲（TASK-0681）：放不放＋每首的試聽
    var h2 = '船的主題曲 <button data-bth="1">操控的船有主題曲時改放它</button><button data-bth="0">不放（照上面的曲目）</button>';
    THEMES.forEach(function (t) { h2 += '<button data-bp="' + t.id + '" title="試聽 ' + t.name + '（' + t.src + '）">▶ ' + t.name + '</button>'; });
    tt.innerHTML = h2;
  }
  [].forEach.call(document.querySelectorAll('#bgmModes [data-bm]'), function (b) { b.onclick = function () { SND.mode = b.dataset.bm; sndShow(); }; });
  [].forEach.call(document.querySelectorAll('#bgmTunes [data-bt]'), function (b) { b.onclick = function () { SND.tune = b.dataset.bt; if (BGM && !BGM.forced && SND.tune !== 'shuffle' && BGM.tn.id !== SND.tune) BGM = null; sndShow(); }; });   // 指定了別首 ⇒ 下一格從那首開始
  [].forEach.call(document.querySelectorAll('#bgmTunes [data-bp], #bgmThemes [data-bp]'), function (b) { b.onclick = function () { bgmPreview(b.dataset.bp); sndShow(); }; });
  [].forEach.call(document.querySelectorAll('#bgmThemes [data-bth]'), function (b) { b.onclick = function () { SND.theme = +b.dataset.bth; sndShow(); }; });
  var rb = $('sndR'); if (rb) rb.onclick = function () { for (var k in SND_DEF) SND[k] = SND_DEF[k]; sndApply(); sndShow(); };
}
