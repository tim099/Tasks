// ───────────────────────── 設定頁的共用框架（TASK-0670，Tim 2026-10-17：「或是把一些東西規格化」） ─────────────────────────
// 船隻配置（71_input.js）、砲（68_guncfg.js）、道具（67_furncfg.js）、鍵位（66_keys.js）四頁以前各寫一份：按兩下回到預設、全部回到預設（彈窗）、
//   匯出（Blob 下載）、匯入（讀檔）、開發後台存出廠預設（postMessage）—— 同一件事四種寫法（6ac8d2d 的 gunReset 就是其中一種有病）。現在都走這裡：
//   · cfgKit(p, o)：一頁的那一排按鈕（元素照前綴 p：pR 這一種回到預設、pRA 全部、pE 匯出、pI 匯入、pF 檔案、pSt 狀態列）；
//   · cfgSliders／cfgSnap：照描述表（{ k, name, lim, step, int, note }）生滑桿、把值夾進範圍對齊刻度；
//   · cfgAdm：開發後台那一列（存成出廠預設、重建、回後台）。
// 新增一頁設定 ⇒ 寫描述表＋cfgPage（照描述生整頁，按鈕也在裡面）；現有四頁的版面照舊寫在 template.html，只把按鈕接到 cfgKit。
var CFG_GAME = 'ame_constitution_broadside';                              // 匯出檔的 game（改名前的代號；舊的匯出檔照樣讀得回來 ⇒ 不改）
/** 匯出檔：檔頭（game、kind、v、at）＋內容。 */
function cfgHead(kind, body) { return Object.assign({ game: CFG_GAME, kind: kind, v: 1, at: new Date().toISOString() }, body); }
/** 讀進來的檔是不是這一頁的。 */
function cfgMine(o, kind) { return !!o && o.game === CFG_GAME && o.kind === kind; }
/** 存成 <base>_YYYYMMDD.json（瀏覽器下載）；回檔名。 */
function cfgDownload(obj, base) {
  var d = new Date(), a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' }));
  a.download = base + '_' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '.json';
  document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return a.download;
}
/** 按兩下才做（4 秒內再按一次）：第一下把字換成 arm()，4 秒沒再按 ⇒ 換回 idle。⛔ 不用 confirm()：畫廊彈窗的 iframe 沒開 allow-modals，confirm 直接回 false。 */
function cfgTwice(b, idle, arm, run) {
  var t = 0;
  b.onclick = function () {
    if (performance.now() - t > 4000) { t = performance.now(); b.textContent = arm(); setTimeout(function () { if (performance.now() - t >= 3900) b.textContent = idle; }, 4000); return; }
    t = 0; b.textContent = idle; run();
  };
}
/** 一頁的那一排按鈕。o：
 *    one   { idle: '這一種回到預設', arm: () => '再按一次：…', run }（沒有 ⇒ 不接 pR）
 *    all   { title, body, run: () => 狀態列要寫的字 }（全部回到預設：65_ask.js 彈窗確認）
 *    kind、file（檔名開頭）、exp: () => 匯出的內容（不含檔頭）、expSay（匯出後狀態列括號裡的話）
 *    imp: (內容) => 套了幾個、what（匯入失敗時說「不是這個遊戲匯出的 what」）、unit（「n 種砲」的「種砲」）
 *    show: () => 改完重畫這一頁 */
function cfgKit(p, o) {
  var st = function (s) { $(p + 'St').textContent = s; };
  if (o.one) cfgTwice($(p + 'R'), o.one.idle, o.one.arm, function () { o.one.run(); o.show(); });
  if (o.all) $(p + 'RA').onclick = function () { if (o.all.before) o.all.before(); askOk(o.all.title, o.all.body, '全部回到預設', function () { var s = o.all.run(); o.show(); st(s); }); };
  $(p + 'E').onclick = function () { st('已匯出 ' + cfgDownload(cfgHead(o.kind, o.exp()), o.file) + '（' + o.expSay + '）。'); };
  $(p + 'I').onclick = function () { $(p + 'F').value = ''; $(p + 'F').click(); };
  $(p + 'F').onchange = function () {
    var f = $(p + 'F').files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      var n = -1, j = null; try { j = JSON.parse(r.result); } catch (e) { j = null; }
      if (cfgMine(j, o.kind)) n = o.imp(j);
      o.show();
      st(n < 0 ? '⚠ 匯入失敗：' + f.name + ' 不是這個遊戲匯出的' + o.what + '。' : '已匯入 ' + f.name + '：' + n + ' ' + o.unit + (PREFS.write ? '（已存）。' : '（這一頁存不了，下次打開要再匯入）。'));
      if (o.after) o.after(n);
    };
    r.readAsText(f);
  };
}
/** 描述表的一項 ⇒ 值夾進範圍、對齊刻度（整數取整）；lim 可以傳進來（砲的傷害範圍照砲種）。不是有限的數字 ⇒ undefined。 */
function cfgSnap(it, v, lim) {
  if (typeof v !== 'number' || !isFinite(v)) return undefined;
  var L = lim || it.lim; v = clamp(v, L[0], L[1]);
  return it.int ? Math.round(v) : +(Math.round(v / it.step) * it.step).toFixed(4);
}
/** 描述表 ⇒ 滑桿的 HTML：每一項一列（label、range、數字）＋說明；pre ＝ 元素前綴（gk-、fk-）；wrap(it, html) 可以再包一層（道具頁要照種類藏）。 */
function cfgSliders(items, pre, wrap) {
  return items.map(function (it) {
    var h = '<div class="row slide"><label for="' + pre + it.k + '">' + it.name + '</label><input type="range" id="' + pre + it.k + '"' + (it.lim ? ' min="' + it.lim[0] + '" max="' + it.lim[1] + '"' : '') + ' step="' + it.step + '" aria-label="' + it.name + '"><span id="' + pre + it.k + 'V"></span></div>' +
      '<div class="row note gkn">' + it.note + '</div>';
    return wrap ? wrap(it, h) : h;
  }).join('');
}
/** 值 ⇒ 字（跟預設不一樣 ⇒ 後面寫「改過；預設 …」）。 */
function cfgShown(fmt, v, d) { return fmt(v) + (v === d ? '' : '（改過；預設 ' + fmt(d) + '）'); }
/** 開發後台那一列（?admin=furn／keys／defaults）：頁面加 .admin、「存成出廠預設」走 save()、「重建」、「回設定後台」。
 *  ⛔ 成品裡不能有 fetch（vxk_inline.py：展品零外部依賴）⇒ 送給開這一頁的設定後台（window.opener，postMessage cb-admdef），它呼叫 admin.py、把結果送回來（cb-admdef-r）。
 *  o：panel（頁面元素 id）、out（訊息框 id）、from（後台那顆按鈕的名字，找不到後台時提示）、save: (post) => 自己組要送的東西、送完照結果改預設、
 *     build（重建鈕 id）、back（回後台的鈕 id 們）。回 post(op, 欄位) ⇒ Promise（後台的回覆；找不到後台 ⇒ { ok: false }）。 */
function cfgAdm(o) {
  $(o.panel).classList.add('admin');
  var out = $(o.out), wait = null;
  window.addEventListener('message', function (ev) { if (ev.origin !== location.origin || !ev.data || ev.data.kind !== 'cb-admdef-r' || !wait) return; var w = wait; wait = null; out.textContent = (ev.data.log || []).join('\n'); w(ev.data); });
  function post(op, fields) {
    var ad = window.opener; if (!ad || ad.closed) { out.textContent = '⚠ 找不到設定後台：要從設定後台的「' + o.from + '」開這一頁'; return Promise.resolve({ ok: false }); }
    out.textContent = '…（設定後台處理中；重建要十幾秒）'; ad.postMessage(Object.assign({ kind: 'cb-admdef', op: op }, fields || {}), location.origin);
    return new Promise(function (res) { wait = res; });
  }
  $(o.save.id).onclick = function () { o.save.run(post, out); };
  $(o.build).onclick = function () { post('build'); };
  o.back.forEach(function (id) { $(id).onclick = function () { if (window.opener && !window.opener.closed) window.close(); else location.href = '/'; }; });
  return post;
}
/** 只寫描述就有一整頁（新的設定頁用；現有四頁的版面寫在 template.html）：
 *  d：id（元素前綴）、title、sub、items（描述表：k、name、lim、step、int、unit、fix、note）、get(k)、def(k)、set(k, v)、reset()、kind、file、what、
 *     放在哪（host：元素，預設 #cover 底下）、back()（返回）。回 { el, show }。 */
function cfgPage(d) {
  var p = d.id, el = document.createElement('div'); el.className = 'card panel'; el.id = p + 'p'; el.style.display = 'none';
  el.innerHTML = '<h2>' + d.title + '</h2>' + (d.sub ? '<div class="sub">' + d.sub + '</div>' : '') + '<div id="' + p + 'Items">' + cfgSliders(d.items, p + '-') + '</div>' +
    '<div class="row note" id="' + p + 'St"></div><div class="row"><button id="' + p + 'RA">全部回到預設</button><button id="' + p + 'E">匯出…</button><button id="' + p + 'I">匯入…</button>' +
    '<input type="file" id="' + p + 'F" accept=".json,application/json" style="display:none"></div><div class="row"><button id="' + p + 'X">返回</button></div>';
  (d.host || $('cover')).appendChild(el);
  function fmt(it) { return function (v) { return (it.int ? String(v) : v.toFixed(it.fix || 2)) + (it.unit || ''); }; }
  function show() { d.items.forEach(function (it) { var v = d.get(it.k); $(p + '-' + it.k).value = v; $(p + '-' + it.k + 'V').textContent = cfgShown(fmt(it), v, d.def(it.k)); }); }
  d.items.forEach(function (it) { var r = $(p + '-' + it.k); r.oninput = function () { d.set(it.k, cfgSnap(it, +r.value)); show(); }; });
  var all = {}; d.items.forEach(function (it) { all[it.k] = 1; });
  cfgKit(p, { all: { title: d.title + '全部回到預設', body: '這一頁每一項都回到預設。', run: function () { d.reset(); return '已全部回到預設。'; } },
    kind: d.kind, file: d.file, expSay: '整份', exp: function () { var v = {}; d.items.forEach(function (it) { v[it.k] = d.get(it.k); }); return { v: v }; },
    imp: function (j) { var n = 0; d.items.forEach(function (it) { var x = cfgSnap(it, (j.v || {})[it.k]); if (x !== undefined) { d.set(it.k, x); n++; } }); return n; }, what: d.title, unit: '項', show: show });
  $(p + 'X').onclick = function () { el.style.display = 'none'; if (d.back) d.back(); };
  show();
  return { el: el, show: show };
}
/** 設定後台的視窗（TASK-0669 從 36_rooms.js 搬來）：開這一頁的分頁（opener）＞ 嵌這一頁的那一頁（parent）；都沒有（直接開網址）⇒ null，什麼都不送。 */
function admWin() {
  try { if (window.opener && !window.opener.closed) return window.opener; } catch (e) { /* 跨來源 */ }
  return window.parent !== window ? window.parent : null;
}
