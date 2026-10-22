// ───────────────────────── 船隻配置頁：換裝（TASK-0713 第三段；38_fit.js） ─────────────────────────
// 「換裝」一節（船隻配置頁、甲板與艙房的下面）：掛點照「原本雕的那一種＋在哪一層（路徑的第一段）＋砲架類別」分組，一組一列：
//   下拉選單 ＝ 整組換成同一樣；組裡不一樣 ⇒ 顯示「（各不相同）」。「逐一」展開那一組，每個掛點一個選單。
//   選單只列這一類換得進來的：砲 ＝ 同一種砲架、這艘或零件表有的砲種（弩砲這類不列）；其他 ＝ 零件表裡同一種 kind 的每一件（＋可以拆空的「拆掉」）。
//   放不放得下要真的擺上去才知道 ⇒ 換完那一型重載（38_fit.js fitDirty ⇒ 事件 hullReload ⇒ 71_input.js 重畫），沒換成的列在下面（T.fit.bad 的原因）；船型卡片的排水量、砲數、船員跟著變。
// 寫進 SHIP_FIT[船型]（存檔、匯出入跟船員配置一起，69_prefs.js）；跟出廠（ships[].fit）一樣的那一格不留 ⇒ 存檔只存玩家改的。
//   原本雕的：砲 ＝ 那一種砲種；其他 ＝ '*'（出廠換過那一格時才要寫，蓋掉出廠的）。「這一型回到預設」⇒ 換裝也回出廠（71_input.js shipReset）。
var FITUI = { open: {} };                                                // 哪幾組展開了（組的鍵）
/** 這一型的掛點（照原本雕的；拆空的那幾件也列）。 */
function fitSlots(T) {
  var W = (T.fit && T.fit.was) || {}, out = [];
  (T.rig.models || []).concat(T.decos || [], T.hullVoxM || []).forEach(function (m) {   // hullVoxM：放回船殼的主機、鍋爐（38_fit.js fitHullVox）
    var k = fitKindOf(m); if (!k || !(m.meta && m.meta.id)) return;   // 錨的關聯載入時才拆成的模型（m.fromPart；76_anchor.js anchorParts）也列：拆好再換（38_fit.js fitAncSwap）
    if (k === 'engine' && fitOrgan(m)) return;                           // 管風琴（魔法動力源）：零件表沒有第二座、不列
    var t0 = k === 'gun' ? (W[m.name] ? W[m.name].kind : modelKind(m)) : k;
    if (k === 'gun' && GUNS[t0] && GUNS[t0].weapon) return;              // 弩砲、投石機、弓、希臘火：這一段不換
    out.push({ id: String(m.meta.id), path: m.name, k: k, t0: t0, cls: k === 'gun' ? fitClass(m) : '' });
  });
  ((T.fit && T.fit.gone) || []).forEach(function (g) { out.push({ id: g.slot, path: g.path, k: g.kind, t0: g.kind, cls: '' }); });
  return out;
}
function fitGroups(T) {
  var G = {}, L = [];
  fitSlots(T).forEach(function (s) {
    var deck = s.path.indexOf('/') > 0 ? s.path.split('/')[0] : '', key = s.k + '|' + s.t0 + '|' + deck + '|' + s.cls;
    if (!G[key]) { G[key] = { key: key, k: s.k, t0: s.t0, deck: deck, cls: s.cls, slots: [] }; L.push(G[key]); }
    G[key].slots.push(s);
  });
  return L.sort(function (a, b) { return (a.k === 'gun' ? 0 : 1) - (b.k === 'gun' ? 0 : 1); });   // 砲排前面（其他照作品裡的順序；sort 是穩定的）
}
/** 那一組的選單：[[值, 名字]]（第一個 ＝ 原本雕的）。 */
function fitChoices(T, g) {
  if (g.k === 'gun') {
    var have = {}; (T.rig.models || []).forEach(function (m) { if (fitKindOf(m) === 'gun' && fitClass(m) === g.cls) have[modelKind(m)] = 1; });
    return [[g.t0, GUNS[g.t0].name + '（原本）']].concat(Object.keys(GUNS).filter(function (t) { return t !== g.t0 && !GUNS[t].weapon && (have[t] || (FIT_PARTS[t] || {})[g.cls]); }).map(function (t) { return [t, GUNS[t].name]; }));
  }
  var P = (CFG.parts && CFG.parts[g.k]) || {}, K = FIT_KINDS[g.k] || {};
  return [['*', '（原本）']].concat(Object.keys(P).map(function (r) { return [r, P[r]]; })).concat(K.opt ? [['', '拆掉']] : []);
}
/** 一個掛點現在的值（換裝表裡的；沒寫 ＝ 原本）。 */
function fitNow(id, s) { var v = fitOf(id)[s.id]; return v === undefined || v === '*' ? (s.k === 'gun' ? s.t0 : '*') : v; }
/** 改一格 ⇒ SHIP_FIT；跟出廠一樣（出廠沒寫的 ＝ 原本雕的）就不留。 */
function fitSetSlot(id, s, v) {
  var H = HULL_KNOWN.filter(function (h) { return h.id === id; })[0], F0 = (H && H.fit) || {}, P = SHIP_FIT[id] = SHIP_FIT[id] || {};
  var orig = s.k === 'gun' ? s.t0 : '*', f0 = F0[s.id] === undefined || F0[s.id] === '*' ? orig : F0[s.id];
  if (v === f0) delete P[s.id]; else P[s.id] = v === orig && s.k !== 'gun' ? '*' : v;
  if (!Object.keys(P).length) delete SHIP_FIT[id];
}
function fitEsc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
/** 畫「換裝」那一節（71_input.js show 呼叫）：box ＝ 放選單的地方、sum ＝ 下面那一行讀數。 */
function fitShow(id, box, sum) {
  var T = HULLT[id];
  if (!T) { box.innerHTML = ''; sum.textContent = '船型載入中…'; return; }
  var G = fitGroups(T);
  if (!G.length) { box.innerHTML = ''; sum.textContent = '這一型沒有可以換的零件（砲、槳、舵、燈…要有 id：admin.py ids）'; return; }
  function sel(g, i, cur) {
    var C = fitChoices(T, g), mixed = cur === null;
    return '<select data-g="' + fitEsc(g.key) + '"' + (i >= 0 ? ' data-i="' + i + '"' : '') + '>' + (mixed ? '<option value="\u0000" selected>（各不相同）</option>' : '') +
      C.map(function (c) { return '<option value="' + fitEsc(c[0]) + '"' + (!mixed && c[0] === cur ? ' selected' : '') + '>' + fitEsc(c[1]) + '</option>'; }).join('') + '</select>';
  }
  box.innerHTML = G.map(function (g) {
    var now = g.slots.map(function (s) { return fitNow(id, s); }), same = now.every(function (v) { return v === now[0]; }) ? now[0] : null;
    var nm = (g.k === 'gun' ? GUNS[g.t0].name + (g.cls !== 'carriage' ? '・' + fitClsName(g.cls) : '') : FIT_KINDS[g.k].name) + (g.deck ? '（' + g.deck + '）' : '') + ' ×' + g.slots.length;
    var open = FITUI.open[g.key];
    return '<div class="row slide fitG"><label>' + fitEsc(nm) + '</label>' + sel(g, -1, same) + '<button data-o="' + fitEsc(g.key) + '">' + (open ? '收起' : '逐一') + '</button></div>' +
      (open ? g.slots.map(function (s, i) { return '<div class="row slide fitS"><label>' + fitEsc(s.id + '　' + s.path.split('/').pop()) + '</label>' + sel(g, i, now[i]) + '</div>'; }).join('') : '');
  }).join('');
  var byKey = {}; G.forEach(function (g) { byKey[g.key] = g; });
  [].forEach.call(box.querySelectorAll('select'), function (el) {
    el.onchange = function () {
      var g = byKey[el.dataset.g], v = el.value; if (!g || v === '\u0000') return;
      (el.dataset.i !== undefined ? [g.slots[+el.dataset.i]] : g.slots).forEach(function (s) { fitSetSlot(id, s, v); });
      sum.textContent = '換裝中…（重載這一型）'; fitDirty(id);
    };
  });
  [].forEach.call(box.querySelectorAll('button[data-o]'), function (b) { b.onclick = function () { FITUI.open[b.dataset.o] = !FITUI.open[b.dataset.o]; fitShow(id, box, sum); }; });
  var F = T.fit || { done: [], bad: [], gone: [] }, n = F.done.length + F.gone.length;
  sum.innerHTML = (n ? '換了 ' + n + ' 件' + (F.gone.length ? '（拆掉 ' + F.gone.length + '）' : '') : '照原本雕的') + (F.ropesDropped ? '；拿掉 ' + F.ropesDropped + ' 條綁在新零件沒有的固定點上的繩' : '') +
    (F.bad.length ? '<br><b style="color:var(--red)">沒換成</b>（照原本的那一件）：' + F.bad.map(function (b) { return fitEsc(b.slot + '→' + fitValName(b.to) + '：' + b.why); }).join('；') : '');
}
