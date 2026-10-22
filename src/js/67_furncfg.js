// ───────────────────────── 道具設定（主選單「道具設定…」；Tim 2026-10-16：「是否可以把這些道具的參數(抽水速度等) 加一個道具後台可以調整(一樣是開發後台調預設 玩家後台套同一個UI)」） ─────────────────────────
// 一種道具一份（config furniture：病床、手術台、藥箱、抽水機…）：所有船上同一種都照這一份。寫法照砲的設定（68_guncfg.js）：
//   這一頁改的直接寫進 FURN（抽水量、上限、治療加成是即時讀的；血量、容納人數擺上去那一刻讀 ⇒ 都說「下一場開始生效」）；
//   玩家：存檔只存跟預設不一樣的（69_prefs.js furn ＝ FURN_SET）、可以匯出匯入。
//   開發後台：設定後台開 ?admin=furn ⇒ 同一頁、多一列「存成出廠預設」⇒ postMessage 給後台 ⇒ admin.py act_furniture 寫進 config/game.json furniture（重建之後才吃得到）。
// 項目（FURN_ITEMS）：has(f) 決定這一種有沒有那一格；沒有任何一格可以調的（火藥桶：血量在細節設定）不列。
// 動力件（TASK-0653；Tim：「是否可以整合到道具系統去設定輸出動力&其他參數」）：主機、鍋爐、螺旋槳軸、蒸汽管也在這一頁（下拉選單的「（動力件）」那幾項，id ＝ 'drv:種類'）：
//   改的寫進 31_drive.js DRVP（config drvparts）；玩家存檔 69_prefs.js drv ＝ DRV_SET；出廠預設一樣經過 act_furniture（drv）。
var FURN0 = JSON.parse(JSON.stringify(FURN));   // 設定檔的原樣（回到預設、比改過沒）
var FURN_SET = {};                               // { 道具: { 鍵: 值 } }：跟 FURN0 不一樣的（鍵可以是 'buff.heal'）
var DRVP0 = JSON.parse(JSON.stringify(DRVP));   // 動力件的原樣（31_drive.js：DRVP_DEF ＋ config drvparts）
var DRV_SET = {};                                // { 種類: { 鍵: 值 } }：跟 DRVP0 不一樣的
var ADMIN_FURN = Q.get('admin') === 'furn';
function furnIsPump(f) { return f.role === 'pump'; }
var FURN_ITEMS = [
  { k: 'tpm', name: '抽水量', lim: [0, 120], step: 0.5, unit: ' 噸／分', fix: 1, has: furnIsPump, note: '每台每分鐘抽幾噸（人力的要人手到齊才是這個數；加在船的基礎抽水量上）' },
  { k: 'crew', name: '要幾人搖', lim: [1, 12], step: 1, unit: ' 人', int: true, has: function (f) { return furnIsPump(f) && f.power !== 'steam'; }, note: '抽水量 × 到崗 ÷ 這個數；艙裡有水才從預備水手派' },
  { k: 'cap', name: '全船上限', lim: [0, 300], step: 1, unit: ' 噸／分', int: true, has: furnIsPump, note: '同一種抽水機全船加總最多抽多少（0 ＝ 不限）' },
  { k: 'autoDeck', name: '每船自動擺幾台', lim: [0, 4], step: 1, unit: ' 台', int: true, has: function (f) { return furnIsPump(f) && f.autoDeck !== undefined; }, note: '水線以上最低那層甲板，船隻配置頁沒自己改過的話（自動、或出廠的擺法），照位置規則補到這麼多台（擺不下就少擺；蒸汽的只有蒸汽船）；0 ＝ 不擺。自己改過那一層 ⇒ 照自己擺的。下一場開始生效' },
  { k: 'hold', name: '容納', lim: [1, 4], step: 1, unit: ' 人', int: true, has: function (f) { return f.hold !== undefined; }, note: '一張床躺幾個傷員' },
  { k: 'rate', name: '治療速度', lim: [1, 10], step: 0.5, unit: ' 倍', fix: 1, has: function (f) { return f.rate !== undefined; }, note: '躺在這上面治療快幾倍（手術台 3 ＝ 300%；要船醫的，船醫不在 ⇒ 1 倍）' },
  { k: 'doc', name: '要船醫', lim: [0, 1], step: 1, unit: '', int: true, has: function (f) { return f.doc !== undefined; }, note: '1 ＝ 那一間要有還能動的船醫才收傷員、才照上面的倍數治（手術台）；0 ＝ 跟病床一樣' },
  { k: 'buff.heal', name: '治療速度加成', lim: [0, 1], step: 0.05, pct: true, has: function (f) { return !!(f.buff && f.buff.heal !== undefined); }, note: '同一間加總，上限照房間類型（醫療艙 60%）' },
  { k: 'staff.surgeon', name: '配幾位船醫', lim: [0, 4], step: 1, unit: ' 人', int: true, has: function (f) { return !!(f.staff && f.staff.surgeon !== undefined); }, note: '設施配員：開戰時走得到的每一件配這麼多位船醫，站在旁邊（全船上限在船隻配置頁）' },
  { k: 'staff.carpenter', name: '配幾位木匠', lim: [1, 4], step: 1, unit: ' 人', int: true, has: function (f) { return !!(f.staff && f.staff.carpenter !== undefined); }, note: '設施配員：每張配這麼多位木匠，開戰時生在台旁（全船上限在船隻配置頁）' },
  { k: 'staff.sailmaker', name: '配幾位帆匠', lim: [1, 4], step: 1, unit: ' 人', int: true, has: function (f) { return !!(f.staff && f.staff.sailmaker !== undefined); }, note: '設施配員：每件配這麼多位帆匠，開戰時生在櫃旁（船隻配置頁的帆匠是全船上限）' },
  { k: 'cloth', name: '帆布存量', lim: [0, 20000], step: 100, unit: ' 份', int: true, has: function (f) { return f.role === 'loft'; }, note: '每件櫃存幾份帆布（補一點血量用一份、接一條繩 20 份；櫃被打壞 ⇒ 剩下的拿不到）' },
  { k: 'wood', name: '木材存量', lim: [0, 20000], step: 100, unit: ' 份', int: true, has: function (f) { return f.role === 'bench'; }, note: '每張台存幾份木材（補一格用一份；台被打壞 ⇒ 剩下的拿不到）' },
  { k: 'carry', name: '一趟帶幾份', lim: [10, 2000], step: 10, unit: ' 份', int: true, has: function (f) { return f.role === 'bench' || f.role === 'loft'; }, note: '木匠（帆匠）開戰時身上帶滿；用完了、又有東西要修 ⇒ 走回台旁拿到滿' },
  { k: 'auto', name: '每船至少幾張', lim: [1, 4], step: 1, unit: ' 張', int: true, has: function (f) { return f.role === 'bench' || f.role === 'loft'; }, note: '甲板上擺的不夠就自動補在水線以上最低那層砲甲板（拿掉最後一張也會補回來；不要木匠 ⇒ 船隻配置頁上限設 0）' },
  { k: 'hp', name: '血量', lim: [10, 1000], step: 10, unit: '', int: true, has: function (f) { return f.hp !== undefined; }, note: '被打到扣血，歸零就壞（不再能用、不再給加成）' }
];
/** 動力件的項目（31_drive.js drvCurve／drvNeed／drvPartsTick 讀）；fit ＝ 拉滑桿時跟另一格保持 lo < hi。 */
var DRV_ITEMS = [
  { k: 'lo', name: '剩幾成就沒力', lim: [0, 0.95], step: 0.05, per: true, has: function (f) { return f.lo !== undefined; }, fit: function (f, v) { return Math.min(v, f.hi - 0.05); }, note: '這一件還在的格 ÷ 開局的格，低於這個 ⇒ 輸出 0（鍋爐預設 50%：打掉一半就沒蒸汽）' },
  { k: 'hi', name: '剩幾成還是全力', lim: [0.05, 1], step: 0.05, per: true, has: function (f) { return f.hi !== undefined; }, fit: function (f, v) { return Math.max(v, f.lo + 0.05); }, note: '高於這個 ⇒ 全力；兩格中間照直線' },
  { k: 'wet', name: '泡水熄火', lim: [0, 1], step: 0.05, per: true, has: function (f) { return f.wet !== undefined; }, note: '每一座鍋爐中心那一格，艙內的水淹到這麼深就熄火（0 ＝ 不會因為泡水熄）' },
  { k: 'hpK', name: '血量（砲的幾倍）', lim: [0.1, 5], step: 0.05, unit: ' 倍', fix: 2, has: function (f) { return f.hpK !== undefined; }, note: '整支一塊：被打到扣血，歸零就斷。血量 ＝ 細節設定「砲的血量」× 這個數' },
  { k: 'cell', name: '每格傳幾成', lim: [0, 1], step: 0.01, per: true, has: function (f) { return f.cell !== undefined; }, note: '最細那一截有幾條不共用格子的路 × 這個數 ＝ 傳得過去的比例（15% ≈ 7 格粗就傳滿；0 ＝ 只看通不通）' }
];
/** id ⇒ 那一份的表：道具（FURN）或動力件（'drv:種類' ⇒ DRVP）。 */
function furnTab(id) { return String(id).indexOf('drv:') === 0 ? { cur: DRVP, def: DRVP0, set: DRV_SET, items: DRV_ITEMS, id: id.slice(4) } : { cur: FURN, def: FURN0, set: FURN_SET, items: FURN_ITEMS, id: id }; }
function furnItem(T, k) { return T.items.filter(function (it) { return it.k === k; })[0]; }
function fGet(f, k) { var p = k.split('.'); return p.length > 1 ? (f[p[0]] || {})[p[1]] : f[k]; }
function fPut(f, k, v) { var p = k.split('.'); if (p.length > 1) (f[p[0]] = f[p[0]] || {})[p[1]] = v; else f[k] = v; }
/** 有哪幾種可以調（至少一格）：道具在前、動力件在後。 */
function furnIds() {
  function can(T, id) { return T.items.some(function (it) { return it.has(T.def[id] || T.cur[id]); }); }
  return Object.keys(FURN).filter(function (id) { return can(furnTab(id), id); }).concat(Object.keys(DRVP).filter(function (k) { return can(furnTab('drv:' + k), k); }).map(function (k) { return 'drv:' + k; }));
}
/** 改一項（夾進範圍、對齊刻度）；跟預設一樣 ⇒ 從 FURN_SET／DRV_SET 拿掉。 */
function furnSet(id, k, v) {
  var T = furnTab(id), it = furnItem(T, k), f = T.cur[T.id]; if (!it || !f || !it.has(T.def[T.id] || f) || typeof v !== 'number' || !isFinite(v)) return;
  v = cfgSnap(it, v);                                                  // 夾進範圍、對齊刻度（64_cfgkit.js）
  var d = fGet(T.def[T.id], k), S = T.set[T.id] = T.set[T.id] || {};
  fPut(f, k, v);
  if (v === d) delete S[k]; else S[k] = v;
  if (!Object.keys(S).length) delete T.set[T.id];
}
/** 回到預設：整份照抄（⛔ 不一格一格走 furnSet：lo／hi 的先後會被 fit 夾住）。 */
function furnReset(id) { var T = furnTab(id), f = T.cur[T.id], f0 = T.def[T.id] || {}; T.items.forEach(function (it) { if (it.has(f0)) fPut(f, it.k, fGet(f0, it.k)); }); delete T.set[T.id]; }
/** 存檔用：FURN_SET／DRV_SET 的拷貝。 */
function furnSnap() { return JSON.parse(JSON.stringify(FURN_SET)); }
function drvSnap() { return JSON.parse(JSON.stringify(DRV_SET)); }
/** 存檔／匯入 ⇒ 變數：看得懂的種類、鍵才套（照 furnSet 夾範圍）。pre ＝ '' 道具、'drv:' 動力件。回傳套了幾種。 */
function furnApply(o, pre) {
  if (!o || typeof o !== 'object') return 0;
  var n = 0; pre = pre || '';
  Object.keys(o).forEach(function (id) {
    var T = furnTab(pre + id), f = T.cur[T.id]; if (!f || !o[id] || typeof o[id] !== 'object') return; n++;
    Object.keys(o[id]).forEach(function (k) { furnSet(pre + id, k, o[id][k]); });
    if (f.lo !== undefined && f.hi !== undefined && !(f.lo < f.hi)) furnSet(pre + id, 'hi', Math.min(1, f.lo + 0.05));   // 存檔裡 lo ≥ hi ⇒ 把 hi 推上去
  });
  return n;
}
function drvApply(o) { return furnApply(o, 'drv:'); }
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
