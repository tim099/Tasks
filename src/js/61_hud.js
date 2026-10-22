// ───────────────────────── HUD ─────────────────────────
// ───────────────────────── 廣播（畫面上方的訊息） ─────────────────────────
// 一行一則、最多 5 行，各自 4 秒後淡掉（⛔ 以前只有一行、新的蓋掉舊的 ⇒ 同一刻兩件事只看得到一件）。
// 砲被打飛：同一個半秒內的併成一行；傷亡：第一個人倒下起算 5 秒，報這 5 秒裡陣亡、受傷各幾個（不洗版；是 0 的那一項不報）。
var MSGS = [], MSG_MAX = 5, MSG_LIFE = 4;
/** imp：重要的（殉爆、斷成兩截、沉沒、降旗）⇒ 留 8 秒，滿了先擠掉不重要的。 */
function hudNote(sh, text, imp) {
  if (DEMO >= 0 && !RUNNING) return;
  var who = sh.i === PLAYER_I ? '我艦' : sh.name, el = document.createElement('div');   // 我艦照舊；其他每艘用艦名（TASK-0552：多船時分得出是哪一艘），顏色照陣營
  el.innerHTML = '<span style="color:' + (teamIdx(sh) === 0 ? 'var(--blue)' : 'var(--red)') + '">' + who + '</span>　' + text;
  $('msg').appendChild(el); MSGS.push({ el: el, t: imp ? 8 : MSG_LIFE, imp: !!imp });
  while (MSGS.length > MSG_MAX) { var j = MSGS.findIndex(function (m) { return !m.imp; }); MSGS.splice(j < 0 ? 0 : j, 1)[0].el.remove(); }
}
function stepMsgs(dt) {
  for (var i = 0; i < MSGS.length; i++) { var m = MSGS[i]; m.t -= dt; m.el.style.opacity = clamp(m.t / 0.6, 0, 1); if (m.t <= 0) { m.el.remove(); MSGS.splice(i--, 1); } }
}
function clearMsgs() { MSGS.forEach(function (m) { m.el.remove(); }); MSGS = []; }
/** 砲被打飛（blowModel 呼叫）：先記著，下一次 newsFlush 併成一行。 */
function hudNewsGun(sh, m, drop) {
  var g = sh.guns.filter(function (x) { return x.model === m; })[0]; if (!g) return;
  var no = /(\d+)$/.exec(m.name), lab = sideName(g.side) + (g.type === 'chase' || g.type === 'carr' ? GUNS[g.type].short : GUNS[g.type].short + ' ') + (g.type === 'chase' ? '' : no ? +no[1] : '');
  sh.news.guns.push(lab + (drop ? '（掉下去）' : ''));
}
var NEWS_WIN = 5;                                  // 傷亡廣播的時間區間（秒；Tim：3 → 5）
/** 普通水手（砲手）以外的人倒下：船長、軍官、舵手 ⇒ 當下各報一則（船長 ＝ 重要）；陸戰隊、桅頂水手、送藥手 ⇒ 記著，併進 5 秒那一行（人多，一個一個報會洗版）。 */
function hudNewsCrew(sh, c, dead, cause) {
  if (c.role === ROLE.GUN) return;
  var cap = c.art === ART_CAPTAIN, how = dead ? (cause === '落水' || cause === '溺水' ? cause : '陣亡') : '受傷倒下', why = cause && cause !== '落水' && cause !== '溺水' ? '（' + cause + '）' : '';
  if (cap) { note(sh, '<b style="color:var(--gold)">船長' + how + '！</b>' + why, true); return; }
  if (c.role === ROLE.OFFICER || c.role === ROLE.HELM || c.role === ROLE.SURGEON || c.role === ROLE.COOK || c.role === ROLE.NAVIGATOR || c.role === ROLE.QUARTERMASTER) {   // 航海士、軍需官（TASK-0825）   // 船醫（TASK-0676）、廚師（TASK-0720，45_galley.js）：人少，當下報
    var left = sh.crew.filter(function (o) { return o.role === c.role && crewAble(o); }).length, nm = ROLE_NAME[c.role], off = c.role === ROLE.OFFICER;   // 軍官照階級報（大副、二副…；40_crew.js makeCrew）
    // 「全倒」只報一次（sh.news.down[職位]；newsFlush 看到那個職位又有人能動才收回）：之後倒下的同職位併進 5 秒那一行。
    //   ⛔ 不管 ⇒ 醫療艙淹了、幾位船醫一起落水（在水裡的不算能動）、一個一個溺水 ⇒ 每淹死一位都算出「還有 0 位」，連報好幾次「船醫溺水　船醫全倒」（Tim 2026-10-18 截圖：憲法號 4 次；軍官同理）。
    var D = sh.news.down || (sh.news.down = {});
    if (!left && D[c.role]) { var by0 = dead ? sh.news.kr : sh.news.wr; by0[c.role] = (by0[c.role] || 0) + 1; return; }
    D[c.role] = !left;
    note(sh, (off && c.rank !== undefined ? officerRank(c.rank) : nm) + how + why + (left ? '（還有 ' + left + ' 位' + (off ? '軍官' : '') + '）' : '　<b style="color:#ff9a7a">' + nm + '全倒' + (c.role === ROLE.OFFICER ? ' —— 沒人指揮，瞄準變散' : c.role === ROLE.SURGEON ? ' —— 醫療艙只剩預備水手' : c.role === ROLE.COOK ? ' —— 廚房沒人顧了' : '') + '</b>'), !left);
    return;
  }
  var by = dead ? sh.news.kr : sh.news.wr; by[c.role] = (by[c.role] || 0) + 1;
}
/** 船員站不下（40_crew.js makeCrew 記的 sh.crewShort）⇒ 開戰時每一型報一行、援軍進場時報那一艘（TASK-0570：⛔ 不默默少人）。
 *  只報船隻配置頁改過的那幾項（預設本來就站不下的每一場都報會洗版；那些照實列在船隻配置頁）。 */
function hudCrewShort(sh) {
  var d = crewDefault(sh.T.id), cw = sh.cw;
  var L = (sh.crewShort || []).filter(function (r) { return r[3] === 'guns' ? Object.keys(GUNS).some(function (t) { return gunCrew(cw, t) !== gunCrew(d, t); }) : cw[r[3]] !== d[r[3]]; });
  if (L.length) note(sh, '船員站不下（' + sh.T.name + '型）：' + L.map(function (r) { return r[0] + ' ' + r[2] + '／' + r[1]; }).join('、'));
  var ft = fitText(sh.T); if (ft) note(sh, ft);                          // 換裝沒換成的那幾門（38_fit.js；TASK-0714）
}
/** 落水的水手（43_swim.js）：爬回船上、爬上友艦、被敵艦撈走、撈起別艘的 ⇒ 記著，第一件起算 NEWS_WIN 秒那一艘報一行（Tim 2026-10-14：⛔ 一個一個報會洗版）。 */
var SWIM_TXT = { back: '爬回船上', ally: '爬上友艦', foe: '被敵艦撈走', gotAlly: '撈起友艦水手', gotFoe: '撈起敵艦水手（加入我方）' };
function hudSwimNews(sh, k) { var N = sh.news; N.sw = N.sw || {}; N.sw[k] = (N.sw[k] || 0) + 1; if (!(N.st >= 0)) N.st = SIMT; }
/** 著火（TASK-0717；49_burn.js burnNews）：整艘第一次起火、燒穿水線下、帆起火 ⇒ 重要（留 8 秒）；帆燒掉、撲滅、割下來、全熄 ⇒ 當下一則；
 *  一處起火（ign）、一處撲滅（out）⇒ 記著，第一件起算 NEWS_WIN 秒報一行（Tim 2026-10-14：⛔ 一個一個報會洗版）。a：火場（船殼）或帆。 */
function hudBurnNews(sh, kind, a) {
  var F = '<b style="color:#ff8a3a">', nm = a && a.name ? a.name : '';
  if (kind === 'ign' || kind === 'out') { var N = sh.news, B = N.fire || (N.fire = { ign: 0, out: 0, t: -1 }); B[kind]++; if (B.t < 0) B.t = SIMT; return; }
  if (kind === 'first') { var at = burnPlace(sh, a); note(sh, F + '起火！</b>' + (at ? '（' + at + '）' : ''), true); }
  else if (kind === 'thru') { var at2 = burnPlace(sh, a); note(sh, F + '燒穿了水線下的船殼！</b>' + (at2 ? '（' + at2 + '）' : ''), true); }
  else if (kind === 'sail') note(sh, F + nm + '起火！</b>', true);
  else if (kind === 'sailGone') note(sh, nm + '燒掉了');
  else if (kind === 'sailOut') note(sh, nm + '的火撲滅了');
  else if (kind === 'sailCut') note(sh, '把著火的' + nm + '割下來了');
  else if (kind === 'all') note(sh, '火撲滅了');
}
// 訂閱（TASK-0669：模擬層只發事件，00_events.js）
evOn('note', hudNote, 0, true); evOn('newsGun', hudNewsGun, 0, true); evOn('newsCrew', hudNewsCrew, 0, true); evOn('swimNews', hudSwimNews, 0, true); evOn('crewShort', hudCrewShort, 0, true);
evOn('burnNews', hudBurnNews, 0, true);                          // 著火（49_burn.js）：起火、全熄、燒穿、帆 ⇒ 當下報；一處起火／撲滅 ⇒ 併進 5 秒那一行
evOn('survey', newsFlush, 0, true);                                // 每半秒（50_sim.js survey 那一拍）：記著的砲、傷亡併成一行
evOn('stepEnd', endTick, 9);                                       // 結束判定在每一步最後（報表、測試紀錄之後；⛔ 不是 view：不畫也要判）
function endTick() { if (!OVER || END_AT) checkEnd(); }
function roleList(by) { var r = []; for (var k in by) r.push(ROLE_NAME[k] + ' ' + by[k]); return r.length ? '（' + r.join('、') + '）' : ''; }
/** 每半秒（survey 那一拍）：把記著的砲併成一行；傷亡滿 NEWS_WIN 秒報一次。 */
function newsFlush(sh) {
  var N = sh.news;
  if (N.guns.length) {
    var gl0 = N.guns.length, list = gl0 > 5 ? N.guns.slice(0, 4).join('、') + '…' : N.guns.join('、');   // 一次太多（殉爆）⇒ 只列前四門
    note(sh, (gl0 === 1 ? N.guns[0] + ' 被打飛' : gl0 + ' 門砲被打飛：' + list) + '（砲還在 ' + sh.gunsAlive + '／' + sh.guns.length + '）'); N.guns = [];
  }
  if (N.down) for (var r in N.down) if (N.down[r] && sh.crew.some(function (o) { return String(o.role) === r && crewAble(o); })) N.down[r] = false;   // 全倒過的職位又有人能動（軍官爬回船上歸隊）⇒ 下次全倒照常報
  var dk = sh.kills - N.k, dw = sh.wounds - N.w;
  if (N.t < 0 && (dk > 0 || dw > 0)) N.t = SIMT;                       // 第一個人倒下 ⇒ 開始數
  if (N.t >= 0 && SIMT - N.t >= NEWS_WIN) {
    var parts = []; if (dk > 0) parts.push('陣亡 ' + dk + roleList(N.kr)); if (dw > 0) parts.push('受傷 ' + dw + roleList(N.wr));   // 是 0 的那一項不報；陸戰隊等另列
    N.kr = {}; N.wr = {};
    if (parts.length) note(sh, NEWS_WIN + ' 秒內 ' + parts.join('、'));   // 累計看兩邊面板（⛔ 也寫進來 ⇒ 一行太長、蓋到面板）
    N.k = sh.kills; N.w = sh.wounds; N.t = -1;
  }
  var BF = N.fire;                                                   // 著火（hudBurnNews 記的）：NEWS_WIN 秒內起火、撲滅幾處
  if (BF && BF.t >= 0 && SIMT - BF.t >= NEWS_WIN) {
    var fpa = []; if (BF.ign) fpa.push('起火 ' + BF.ign + ' 處'); if (BF.out) fpa.push('撲滅 ' + BF.out + ' 處');
    if (fpa.length) note(sh, NEWS_WIN + ' 秒內 ' + fpa.join('、'));
    BF.ign = BF.out = 0; BF.t = -1;
  }
  if (N.st >= 0 && SIMT - N.st >= NEWS_WIN) {
    var sp = []; for (var k in SWIM_TXT) if (N.sw[k]) sp.push(SWIM_TXT[k] + ' ' + N.sw[k]);
    if (sp.length) note(sh, NEWS_WIN + ' 秒內 落水水手 ' + sp.join('、'));
    N.sw = {}; N.st = -1;
  }
  if (sh.galley) hudGalleyNews(sh);
}
/** 廚房（TASK-0720；45_galley.js galleyTick 記的 sh.galley.news：各記第一次的時刻）⇒ 每一件只報一次（sh.news.gal 記報過的）：
 *  爐灶全打壞（鍋打翻了；同一拍斷炊 ⇒ 併成一行）、斷炊（沒有一座能做飯、現成的鍋也領光了 ⇒ 吃過的加成照 hold＋fade 慢慢退回 1）。
 *  廚師倒下照 hudNewsCrew 當下報（「廚師全倒 —— 廚房沒人顧了」）；只有不是倒下、而是不在爐灶了（掉到別層當預備水手）才在這裡補一則。⛔ 只讀 sh.galley。 */
function hudGalleyNews(sh) {
  var W = sh.galley.news, R = sh.news.gal || (sh.news.gal = {}), D = sh.news.down || {};
  if (W.broke !== undefined && !R.broke) { R.broke = true; if (W.out !== undefined) R.out = true; note(sh, '<b style="color:#ff9a7a">爐灶被打壞了</b> —— 鍋打翻了' + (R.out ? '　<b style="color:#ff9a7a">斷炊</b>' : ''), true); }
  if (W.cook !== undefined && !R.cook) { R.cook = true; if (!D[ROLE.COOK]) note(sh, '廚師都不在爐灶 —— 廚房沒人顧了'); }
  if (W.out !== undefined && !R.out) { R.out = true; note(sh, '<b style="color:#ff9a7a">斷炊</b> —— 鍋領光了、廚房做不出飯（吃過的加成慢慢退回 ×1）', true); }
}
/** 面板的一行：砲長與現在瞄哪裡（我艦手動 ⇒ 玩家的瞄準模式，砲長待命）。 */
function capText(sh) {
  var C = CAPTAINS[sh.cap], manual = handAim(sh);
  return '砲長 ' + (C ? C.name : '—') + '：' + (manual ? '待命（我在瞄：' + AIM_NAME[sh.pMode || 'free'] + '）' : sh.aimMode ? '瞄' + AIM_NAME[sh.aimMode] : '觀察中');
}
// 進水 %（HUD；TASK-0535，Tim 2026-10-13：原本 ＝ 下沉 ÷ 9 m ⇒ 26% 時已經注定要沉、50% 就淹過船體 ⇒ 改用艙內積水算：船重＋積水 ＝ 浮力 ⇒ 100%）。
//   浮力算到「開始沉」那條線（下沉 SINK_FINAL ＝ 4.2 m，32_hull.js；約略是甲板泡水）：W100 ＝ 船從現在的浮高再往下 4.2 m 要多吃的水（浮力表 T.hyd；
//   船被打輕、浮高了 ⇒ W100 跟著變大）。粒子模式 W ＝ 艙內的積水；公式模式沒有水量 ⇒ W ＝ 現在比原本多吃的水（下沉照浮力表換算）。
//   ⇒ 兩種模式都是開始沉那一刻 100%。只是顯示：航速照舊用下沉 ÷ 9 m（31_sailing.js，模擬）。
var SINK_FINAL = 4.2;
/** 水線現在比開戰時高還是低（Tim 2026-10-16：「浮高資訊 是否可以用實際水線變化來計算(目前好像只考慮船體損失質量 不考慮進水)」）：
 *  船的高度 ＝ 減重上浮 sh.lift − 進水下沉 sh.sink（10_ship.js shipMatrix 同一條；浪的起伏 bob 不算）⇒ 正 ＝ 浮高、負 ＝ 吃水深。
 *  兩項都有 ⇒ 括號拆開（減重 ＋、進水 −）。以前只印 sh.lift ⇒ 積水上千噸還寫「浮高 0.1 m」。只是讀數，模擬不讀。 */
function liftText(sh) {
  var up = sh.lift || 0, dn = sh.sink || 0, net = up - dn;
  var s = net > 0.05 ? '　浮高 ' + net.toFixed(1) + ' m' : net < -0.05 ? '　吃水深 ' + (-net).toFixed(1) + ' m' : '';
  if (s && Math.abs(up) > 0.05 && dn > 0.05) s += '（減重 ' + (up >= 0 ? '+' : '−') + Math.abs(up).toFixed(1) + '・進水 −' + dn.toFixed(1) + '）';
  return s;
}
/** 進水 %（0–1）。斷船、開始沉的船：沉船進水在算（33_flood.js floodVis，fl.vis）⇒ 照艙內實際的水（Tim 2026-10-19「照實際的水量算」；TASK-0617）；
 *  沒在算（沉船進水關、同時在算的已經滿了、公式模式）⇒ 照以前寫 100%。沉沒 ⇒ 100%。 */
function floodPct(sh) {
  var vis = sh.fl && sh.fl.vis && !sh.sunk;
  if (sh.sunk || (sh.sinkingFinal && !vis)) return 1;
  var T = sh.T; if (!T || !T.hyd) return clamp(sh.sink / SINK_FINAL, 0, 1);
  var base = T.disp - (sh.mass0 || shipT(sh)) + massLost(sh), L0 = liftFor(T, base), W100 = base - tonsAt(T, L0 - SINK_FINAL);
  var W = sh.fl && (!sh.broken || vis) ? sh.fl.vol * RHO_W : base - tonsAt(T, L0 - sh.sink);
  return W100 > 0 ? clamp(W / W100, 0, 1) : 1;
}
function panel(sh, title) {
  var hull = sh.grid.count / sh.orig, fl = floodPct(sh);
  // 我艦 ⇒ 羅盤上方已經寫的數字不再重寫一次（Tim 2026-10-19「詳細資訊 是否可以移除羅盤上已經有顯示的資訊」）：航速＋點風＋帆段＋俥鐘那一行、積水噸與破口 m²（floodLine）。
  //   羅盤只有圖、沒有數字的照留（航向度數、轉向 °/秒、風的方位與節數、船體／進水 %）；看別艘時羅盤不是那艘 ⇒ 全照舊。
  var mine = sh === SHIPS[PLAYER_I];
  var m = sh.masts.map(function (x) { return x.name + (x.up ? '✓' : '✗'); }).join(' ');
  // 排水量（Tim 2026-10-13）＝ 開戰時整艘船的重量（格＋砲＋火藥桶＋壓艙物，sh.mass0）：浮著的船排開的水跟自己一樣重；預設壓艙物剛好在設計水線 ⇒ 也就是設計排水量。
  // 「現在」＝ 扣掉被打掉的（格、打飛的砲、炸掉的桶，massLost，跟減重上浮同一支）；艙內的積水不算（那是進水，看下一行）
  var m0 = sh.mass0 || shipT(sh), disp = Math.round(m0), now = Math.round(m0 - massLost(sh));   // 兩個都取到 1 噸（⛔ 開戰時的取到 10 噸 ⇒ 第一格「2,150・現在 2,154」，現在比開戰還重）
  // 橫向兩欄（TASK-0564，Tim 2026-10-14：佔畫面中間 ⇒ 儘量橫鋪、別往下壓）：左 ＝ 船體、進水、航行；右 ＝ 砲長、船員、砲、開火。砲一門一門的狀態在底下的砲位圖（gmapDraw）。
  return '<h3>' + title + '<span class="disp">排水量 ' + disp.toLocaleString() + ' 噸・現在 ' + now.toLocaleString() + ' 噸</span>' + (sh.fate && !sh.sunk ? '　<span style="color:var(--gold)">' + sh.fate + '</span>' : '') + '</h3><div class="pcols"><div class="pc">船體 ' + (hull * 100).toFixed(1) + '%（打掉 ' + sh.lost.toLocaleString() + ' 格）<div class="bar"><i style="width:' + (hull * 100).toFixed(1) + '%"></i></div>' +
    '進水 ' + (sh.sunk ? '沉沒' : (fl * 100).toFixed(0) + '%') + (sh.fl && (!sh.broken || sh.fl.vis) ? (mine ? '' : '（艙內積水 ' + Math.round(sh.fl.vol * RHO_W).toLocaleString() + ' 噸・破口 ' + sh.fl.area.toFixed(1) + ' m²）') : '（水線下破洞 ' + (sh.inflow || 0).toLocaleString() + ' 格）') + liftText(sh) + '<div class="bar water"><i style="width:' + (fl * 100).toFixed(0) + '%"></i></div>' +
    (mine ? '' : (sh.spd < -0.05 ? '倒車 ' + (-sh.spd * 1.944).toFixed(1) : '航速 ' + (sh.spd * 1.944).toFixed(1)) + ' 節（' + sh.pos + '）　' + (driveText(sh) ? driveText(sh) + '　' : '') + (hasSails(sh) ? sailSetName(sh) + ' ' + Math.round(sh.sailFrac * 100) + '%' : '') + '<br>') +
    ((sh.ancMode ? '拋錨' : sh.manual ? '手動操舵' : '自動操舵' + (sh.helmMode && HELM_TAKE_K[sh.helmMode] && !sh.struck && !sh.sunk ? '・' + HELM_TAKE_K[sh.helmMode].name : '')) +   // 接管航行的模式（54_helm.js HELM_TAKES）
    (sh.anc ? '　' + anchorText(sh) : '') + '　舵 ' + (sh.rudder > 0.05 ? '左 ' + Math.round(sh.rudder * 100) + '%' : sh.rudder < -0.05 ? '右 ' + Math.round(-sh.rudder * 100) + '%' : '正')) + '<br>' + navText(sh) + '</div><div class="pc">' +
    capText(sh) + '<br>' +
    '船員 ' + (sh.able || 0) + '/' + sh.crew0 + '（傷 ' + sh.wounded + '　亡 ' + sh.dead + '）' + handsText(sh) + medText(sh) + pumpText(sh) + galleyText(sh) + dutyText(sh) + burnText(sh) + swimText(sh) + '　' + supplyText(sh) + '<br>' +
    '砲 有人 ' + (sh.gunsManned || 0) + '／還在 ' + sh.gunsAlive + '／' + sh.guns.length + '　' + m + '<br>開火 ' + sh.fired + '　命中 ' + sh.hits +
    gmapLegend(sh) + '</div></div>';
}
/** 旁邊那張圖的圖說：砲位（預設）、損壞或進水（GMAP_MODE；Tim 2026-10-18「在開啟船體詳細資訊頁上加一個toggle 切換顯示炮位或是船隻損壞情況」「在炮位 損壞之外 加一個切換顯示進水」）。 */
function gmapLegend(sh) {
  if (GMAP_MODE === 'fire') return '<div class="dmgsum">' + burnSumText(sh) + '</div><div class="legend">火災圖：<b style="color:#ffcf4a">●</b>～<b style="color:#ff6a1a">●</b> 火場（大小照格數，越紅越旺；白圈 ＝ 有人在潑、數字 ＝ 到了／要幾人） '
    + '<b style="color:#5a4636">■</b> 焦痕 <b style="color:#1b1210">■</b> 燒穿 <b style="color:#58b7ff">●</b> 救火的水手 <b style="color:#fff">━</b> 著過火的帆（黑 ＝ 燒掉的、橘 ＝ 還在燒）</div>';
  if (GMAP_MODE === 'flood') return '<div class="dmgsum">' + floodSumText(sh) + '</div><div class="legend">進水圖：艙內的水深 0 <span style="display:inline-block;width:48px;height:8px;vertical-align:middle;border-radius:2px;background:' + flRampCss() + '"></span> ' + FL_DEPTH_MAX + ' m <b style="color:#ff3c32">●</b> 水下的破口 <b style="color:#ffaa28">●</b> 水上的破口 <b style="color:#3ee07a">●</b> 水往外流的破口（大小照洞的面積）</div>';
  if (GMAP_MODE !== 'dmg') return '<div class="legend">砲位圖：● 好 ◌ 裝填 ○ 開不了 △ 等火藥 ≈ 泡水 ✕ 毀｜<b style="color:#7be37b">綠</b> 滿編 <b style="color:#f0d264">黃</b> 不足 <b style="color:#9a9a9a">灰</b> 沒人｜最上層在船內、越下層越外</div>';
  var C = GMAP_DMG;
  return '<div class="dmgsum">' + dmgSumText(sh) + '</div><div class="legend">損壞圖：<b style="color:' + C.chan + '">■</b> 通道斷了 <b style="color:' + C.hole + '">■</b> 甲板破洞 <b style="color:' + C.lad + '">H</b> 梯子 <b style="color:' + C.anc + '">◆</b> 帆的綁定點 ' +
    '<b style="color:#fff">━</b> 帆（白 ＝ 剩下的血量，✂ 繩斷） <b style="color:' + C.rlad + '">⋮</b> 繩梯 <b style="color:' + C.mast + '">✕</b> 倒掉的桅｜<b style="color:' + C.carp + '">●</b> 木匠 <b style="color:' + C.sm + '">●</b> 帆匠（白圈 ＝ 正在修）</div>';
}
/** 進水一行（33_flood.js 的讀數，同停格的進水細節頁 72_floodui.js floodPanel；只讀）：積水、破口（水下幾處）、進出水、抽水、下沉。公式模式 ⇒ 水線下打掉幾格。 */
function floodSumText(sh) {
  var fl = sh.fl;
  if (!fl || sh.broken) return (sh.broken ? '斷成兩截（照公式，一定沉）' : '公式模式：看不到艙內的水（物理效果「進水」選粒子才看得到）') + '・水線下打掉 ' + (sh.inflow || 0).toLocaleString() + ' 格・下沉 ' + sh.sink.toFixed(2) + ' m';
  // 排版固定（Tim 2026-10-18「這一塊會快速抖動(因為字的長度不固定)」）：兩行、每個數字一格固定寬度靠右（numCell：等寬數字），每一段一直都在（沒有 ⇒ 0）⇒ 數字變了欄位不動、不會換行換來換去
  var R = flRates(fl), t = function (q) { return (q * RHO_W * 60).toFixed(1); }, net = R.netQ * RHO_W * 60;
  return '積水 ' + numCell(Math.round(fl.vol * RHO_W).toLocaleString(), 5) + ' 噸・破口 ' + numCell(fl.open, 3) + ' 處（水下 ' + numCell(fl.underN, 2) + '・外流 ' + numCell(fl.outN, 2) + '）・下沉 ' + numCell(sh.sink.toFixed(2), 4) + ' m<br>' +
    FL_AVG_T + ' 秒平均（噸／分）：進水 ' + numCell(t(R.inQ), 5) + '・外流 ' + numCell(t(R.outQ), 5) + '・抽水 ' + numCell(t(R.pumpQ), 4) + '／' + pumpNow(sh).toFixed(1) + '・淨進水 ' + numCell((net > 0.05 ? '+' : net < -0.05 ? '−' : '') + Math.abs(net).toFixed(1), 6);
}
/** 一個數字一格（固定寬度 w 個字、靠右、等寬數字；template.html .nv）。 */
function numCell(v, w) { return '<span class="nv" style="min-width:' + w + 'ch">' + v + '</span>'; }
/** 損壞表一行（48_damage.js；只讀，⛔ 不在這裡重掃 ⇒ 有畫面那場跟無頭的戰局一位元不差）。 */
function dmgSumText(sh) {
  var D = sh.dmg; if (!D) return '損壞表：' + (sh.carp || sh.sm ? '還沒點名' : '這艘沒有木匠、帆匠');
  var n = D.n;                                                          // 各種幾件：損壞表重掃時記的（48_damage.js）
  var c = (n.hole || 0) + (n.lad || 0) + (n.anchor || 0), m = (n.sail || 0) + (n.rlad || 0);
  if (!c && !m) return '損壞表：沒有要修的';
  return '損壞表：木匠 ' + c + ' 件' + (c ? '（洞 ' + (n.hole || 0) + '、梯子 ' + (n.lad || 0) + '、綁定點 ' + (n.anchor || 0) + '）' : '') + '　帆匠 ' + m + ' 件' + (m ? '（帆 ' + (n.sail || 0) + '、繩梯 ' + (n.rlad || 0) + '）' : '');
}
// ───────────────────────── 上方艦隊（TASK-0552；Tim 2026-10-14） ─────────────────────────
// 場上每一艘一個圓形按鈕：我方沿左邊、敵方沿右邊往下排（照 SHIPS 的順序 ⇒ 我艦、敵方第一艘在最上面；候補還有幾艘接在最後）。
//   外圈 ＝ 船體（金）、內圈 ＝ 進水（水藍），中間 ＝ 那一型的側面投影（05_hull.js sideImg；我方船頭朝右、敵方朝左 ⇒ 都朝畫面中間）與艦名；
//   ★ ＝ 我艦；沉沒、下沉、降旗寫在圖上、整顆變暗。按鈕的畫布只在讀數變了才重畫（key）。
// 點一顆 ⇒ 中間展開那一艘的詳細資訊（panel，同時最多一艘）；點同一顆或點資訊本身 ⇒ 收回。預設全折疊、每一場開局全折疊（fleetReset，70_flow.js reset）。
var HUD_SAILS = null;   // 收帆、加帆兩顆按鈕現在顯不顯示（換船才重設）
var INFO_SH = null, SB_EL = {}, SUNK_HIDE = 60;   // SUNK_HIDE：沉了幾秒（模擬時間）之後上方的圓鈕收掉（Tim 2026-10-14：補船之後那一欄才不會越排越長）
// 點資訊或旁邊的砲位圖任何地方 ⇒ 收回。用 pointerdown：⛔ click 要按下、放開都落在同一個元素 —— 卡片每 6 格整個重畫（innerHTML），按下到放開之間剛好重畫 ⇒ click 不觸發（Tim：收起有時沒反應）
['info', 'gmap'].forEach(function (id) { $(id).addEventListener('pointerdown', function (e) { e.preventDefault(); var gm = e.target.closest && e.target.closest('[data-gmode]'); if (gm) { GMAP_MODE = gm.getAttribute('data-gmode'); fleetHud(SHIPS[PLAYER_I]); return; } if (e.target.closest && e.target.closest('[data-see]')) { camSee(INFO_SH); return; } if (e.target.closest && e.target.closest('[data-take]')) { playerTakeShip(INFO_SH); fleetHud(SHIPS[PLAYER_I]); return; } INFO_SH = null; fleetHud(SHIPS[PLAYER_I]); }); });
// 按羅盤 ＝ 按艦隊的我艦圓鈕（Tim 2026-10-15：「遊戲下方的羅盤是否可以改成可以按，效果跟按下我艦一樣顯示詳細資訊」）：開／收我艦的詳細資訊。
//   pointerdown（同上：羅盤每 6 格重畫，click 可能落空）；只綁在羅盤的畫布 ⇒ 兩舷的砲（#gunsL／#gunsR，pointer-events:none）、鏡頭拖曳（遊戲畫布）都不受影響。
$('navc').addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); var me = SHIPS[PLAYER_I]; if (!me) return; INFO_SH = INFO_SH === me ? null : me; fleetHud(me); });
function fleetReset() { INFO_SH = null; for (var k in SB_EL) SB_EL[k].el.remove(); SB_EL = {}; [].forEach.call(document.querySelectorAll('.sbres, .sigb'), function (e) { e.remove(); }); if ($('sigP')) $('sigP').classList.remove('on'); }
function sbMake(o, box) {
  var el = document.createElement('div'), cv = document.createElement('canvas'); el.className = 'sb'; el.appendChild(cv);
  var nl = document.createElement('span'), nr = document.createElement('span'); nl.className = 'sbn l'; nr.className = 'sbn r'; el.appendChild(nl); el.appendChild(nr);   // 船員、砲（sbNums）
  el.onclick = function (e) { e.stopPropagation(); INFO_SH = INFO_SH === o ? null : o; fleetHud(SHIPS[PLAYER_I]); };
  box.insertBefore(el, box.querySelector('.sbres')); return { el: el, cv: cv, box: box, key: '', nl: nl, nr: nr, nk: '' };
}
/** 圓鈕兩側的數字：左下 還能動的船員、右下 還在的砲（像素圖示：HUD 美術的「船員」「裝填好」；沒有美術 ⇒ emoji）。 */
function sbIcon(k, emo) { return HUD_ART ? '<span class="ico" style="background-position:' + (k * 100 / 7).toFixed(3) + '% 0"></span>' : '<i>' + emo + '</i>'; }
/** 開砲的圖示（Tim 2026-10-15：「開砲改用目前船資訊上的砲數 emoji 符號，齊射用三個該符號表示」「自動開砲可以改為自動符號＋開砲符號」）：
 *  跟艦隊圓鈕砲數同一個（sbIcon(3)：有 HUD 美術 ⇒ 那一格圖、沒有 ⇒ 💥）；美術是載入後才有的 ⇒ 每次 HUD 看一次（字串一樣就不動）。 */
var HUD_OUTARC = false;                                                  // 瞄準點在射界外（gunHud 記、羅盤上方那一行寫）
function hudIcons() {
  var g = sbIcon(3, '💥'), L = [['fireK', '<b>' + keyName('fire1') + '</b>', g], ['volleyK', '<b>' + keyName('volley') + '</b>', g + g], ['autoF', '<b>' + keyName('autoFire') + '</b>', '🤖' + g]];   // 鍵照 66_keys.js
  var me = SHIPS[PLAYER_I], pk = me && !me.sunk ? fireOnePick(me) : null, waste = !!(pk && !pk.t);   // 單發鈕：有砲裝填好、但沒有一門打得到目標（或沒有目標）⇒ 按下會往空中打一發（Tim 2026-10-18「讓玩家知道目前按下會浪費砲彈」）
  if (waste) L[0][2] = '💨';
  L.forEach(function (q) { var el = $(q[0]), h = q[1] + '<i class="em">' + q[2] + '</i>'; if (el && el.innerHTML !== h) el.innerHTML = h; });
  var fk = $('fireK'); if (fk && fk.classList.contains('waste') !== waste) { fk.classList.toggle('waste', waste); fk.dataset.tip = waste ? '開一門砲：沒有砲打得到目標 —— 按下會往砲口方向空打一發' : '開一門砲'; fk.title = fk.dataset.tip + '（' + keyName('fire1') + '）'; }   // title 照 66_keys.js keyPaint 的寫法
}
function sbNums(b, o) {
  var cr = 0, gn = 0; o.crew.forEach(function (c) { if (crewAble(c)) cr++; }); o.guns.forEach(function (g) { if (g.alive && !g.wet) gn++; });   // 泡水的不算（Tim 2026-10-14：只算還能用的）
  var k = cr + '/' + gn + (HUD_ART ? 'a' : ''); if (k === b.nk) return; b.nk = k;
  b.nl.innerHTML = sbIcon(0, '👤') + cr; b.nr.innerHTML = sbIcon(3, '💥') + gn;
  b.nl.title = '船員還能動的 ' + cr + ' 人'; b.nr.title = '還能用的砲 ' + gn + ' 門（沒被打掉、沒泡水）';
}
/** 圓鈕裡的船（艦隊圓鈕 sbDraw、船隻配置頁 badgeDraw 共用；Tim 2026-10-15：「把船的水線貼到背景的水面上（現在飄在空中）」「水可以是半透明蓋在船水線下」）：
 *  側面投影的設計水線（05_hull.js sideImg 的 im.wl）對齊背景漸層的海平線 horizon；縮放取「寬不超過 maxW」跟「水線以上不超出 top」較小的那個；
 *  再拿同一條天海漸層、SEA_VEIL 不透明度蓋在海平線以下 ⇒ 背景的海不變色、船身水線以下染成水色。clipR ＝ 圓心那一圈的半徑；flip ⇒ 船頭朝左（敵方）。 */
var SEA_STOP = 0.625, SEA_VEIL = 0.6;   // 天海漸層的交界（色標 0.62／0.63 的中間）、水蓋在船上的不透明度
function sideDraw(g, im, R, clipR, horizon, maxW, top, flip, sky) {
  if (!im) return;
  var wl = im.wl != null ? im.wl : im.height, k = Math.min(maxW / im.width, wl > 0 ? (horizon - top) / wl : 1e9), iw = im.width * k, ih = im.height * k;
  g.save(); g.beginPath(); g.arc(R, R, clipR, 0, 6.2832); g.clip();
  g.save(); g.translate(R, horizon - wl * k); if (flip) g.scale(-1, 1); g.imageSmoothingEnabled = true; g.drawImage(im, -iw / 2, 0, iw, ih); g.restore();
  g.globalAlpha *= SEA_VEIL; g.fillStyle = sky; g.fillRect(R - clipR, horizon, clipR * 2, R + clipR - horizon);
  g.restore();
}
/** 船隻配置頁最上面那個大圓鈕（跟艦隊圓鈕同一種畫法：天與海、側面投影；沒有圓環）。
 *  name 不給 ⇒ 不寫艦名（Tim 2026-10-17「船隻配置頁的Logo可以不印船名(因為已經有顯示)」：右邊那一欄第一行就是艦名）。 */
function badgeDraw(cv, T, name) {
  var dpr = window.devicePixelRatio || 1, W = Math.round((cv.clientWidth || 150) * dpr); if (!W) return;
  cv.width = cv.height = W; var g = cv.getContext('2d'), R = W / 2; g.clearRect(0, 0, W, W);
  g.fillStyle = 'rgba(12,18,26,.92)'; g.beginPath(); g.arc(R, R, R - 1, 0, 6.2832); g.fill();
  var sky = g.createLinearGradient(0, R * 0.2, 0, R * 1.8); sky.addColorStop(0, '#6f8aa3'); sky.addColorStop(0.62, '#a9bccb'); sky.addColorStop(0.63, '#3e6680'); sky.addColorStop(1, '#2a4a60');
  g.fillStyle = sky; g.beginPath(); g.arc(R, R, R * 0.86, 0, 6.2832); g.fill();
  g.lineWidth = Math.max(2, 2 * dpr); g.strokeStyle = '#e8c26a'; g.beginPath(); g.arc(R, R, R - 2 * dpr, 0, 6.2832); g.stroke();
  sideDraw(g, T && T.sideImg, R, R * 0.86, R * 0.2 + R * 1.6 * SEA_STOP, R * 1.5, R * 0.2, false, sky);
  if (!name) return;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = '#000'; g.shadowBlur = 4 * dpr; g.fillStyle = '#fff';
  g.font = 'bold ' + Math.round(R * 0.2) + 'px "Noto Sans TC","Microsoft JhengHei",sans-serif'; g.fillText(name, R, R * 1.4, R * 1.3);
}
function sbDraw(b, o, flip) {
  var hull = o.grid.count / o.orig, fl = o.sunk ? 1 : floodPct(o), st = o.sunk ? '沉沒' : o.sinkingFinal ? '下沉' : o.struck ? '降旗' : '';
  var dpr = window.devicePixelRatio || 1, W = Math.round(b.el.clientWidth * dpr), me = o.i === PLAYER_I;
  var key = [hull.toFixed(3), fl.toFixed(2), st, me, W].join();
  b.el.classList.toggle('on', INFO_SH === o); b.el.classList.toggle('out', !!st);
  b.el.title = (me ? '我艦 ' : '') + o.name + '　船體 ' + (hull * 100).toFixed(1) + '%　進水 ' + Math.round(fl * 100) + '%' + (st ? '　' + st : '');
  if (key === b.key || !W) return; b.key = key;
  var cv = b.cv; cv.width = cv.height = W;
  var g = cv.getContext('2d'), R = W / 2, tc = teamIdx(o) === 0 ? '#6f9bff' : '#ff6f6f';
  function ring(r, w, f, col) {
    g.lineWidth = w; g.lineCap = 'butt'; g.strokeStyle = 'rgba(255,255,255,.13)'; g.beginPath(); g.arc(R, R, r, 0, 6.2832); g.stroke();
    if (f > 0.002) { g.strokeStyle = col; g.beginPath(); g.arc(R, R, r, -Math.PI / 2, -Math.PI / 2 + 6.2832 * Math.min(1, f)); g.stroke(); }
  }
  g.fillStyle = 'rgba(12,18,26,.88)'; g.beginPath(); g.arc(R, R, R - 1, 0, 6.2832); g.fill();
  var sky = g.createLinearGradient(0, R * 0.3, 0, R * 1.7); sky.addColorStop(0, '#6f8aa3'); sky.addColorStop(0.62, '#a9bccb'); sky.addColorStop(0.63, '#3e6680'); sky.addColorStop(1, '#2a4a60');
  g.fillStyle = sky; g.beginPath(); g.arc(R, R, R * 0.62, 0, 6.2832); g.fill();                              // 圓心：天與海（深色的船身才看得到）
  g.lineWidth = Math.max(1, dpr); g.strokeStyle = tc; g.beginPath(); g.arc(R, R, R - 1, 0, 6.2832); g.stroke();   // 陣營色的外框
  ring(R * 0.86, R * 0.13, hull, '#e8c26a');                                                                  // 外圈：船體
  ring(R * 0.69, R * 0.11, fl, fl >= 0.7 ? '#ff7a6a' : '#4fb3ff');                                            // 內圈：進水（七成以上轉紅）
  g.globalAlpha = st ? 0.4 : 1;
  sideDraw(g, o.T.sideImg, R, R * 0.62, R * 0.3 + R * 1.4 * SEA_STOP, R * 1.12, R * 0.38, flip, sky);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = '#000'; g.shadowBlur = 3 * dpr;
  g.fillStyle = '#fff'; g.font = 'bold ' + Math.round(R * 0.27) + 'px "Noto Sans TC","Microsoft JhengHei",sans-serif'; g.fillText(o.name, R, R * 1.28, R * 1.1);
  g.globalAlpha = 1;
  if (st) { g.fillStyle = st === '降旗' ? '#fff' : '#ff9a8a'; g.font = 'bold ' + Math.round(R * 0.3) + 'px sans-serif'; g.fillText(st, R, R * 0.92); }
  if (me) { g.fillStyle = '#e8c26a'; g.font = Math.round(R * 0.3) + 'px sans-serif'; g.fillText('★', R, R * 0.4); }
}
function fleetHud(me) {
  if (!me) return;
  var pt = playerTeam();
  ['L', 'R'].forEach(function (s) {
    var box = $('fleet' + s), team = s === 'L' ? pt : other(pt);
    SHIPS.forEach(function (o) {
      if (o.team !== team) return;
      if (o.sunk && o.sunkHud == null) o.sunkHud = SIMT;                                                      // 沉沒那一刻（模擬時間；只給 HUD 用）
      if (o.sunk && SIMT - o.sunkHud > SUNK_HIDE) { if (SB_EL[o.i]) { SB_EL[o.i].el.remove(); delete SB_EL[o.i]; } if (INFO_SH === o) INFO_SH = null; return; }
      var b = SB_EL[o.i]; if (!b || b.box !== box) { if (b) b.el.remove(); b = SB_EL[o.i] = sbMake(o, box); }
      sbDraw(b, o, s === 'R'); sbNums(b, o);
    });
    if (s === 'L') {                                                       // 🚩 旗號（TASK-0679）：我方有電腦開的友艦才有，排在我方那一欄最上面；點了開關旗號面板（71_input.js sigToggle）
      var sg = box.querySelector('.sigb'), can = sigCan();
      if (can && !sg) { sg = document.createElement('div'); sg.className = 'sigb'; sg.title = '旗號：對我方友艦下令（' + keyName('signals') + '）'; sg.textContent = '🚩'; sg.onclick = function (e) { e.stopPropagation(); sigToggle(); }; box.insertBefore(sg, box.firstChild); }
      else if (!can && sg) { sg.remove(); sg = null; sigToggle(false); }
      if (sg) sg.classList.toggle('on', !!SIGNAL);
    }
    var n = RESERVE[team].length, rc = box.querySelector('.sbres');
    if (n && !rc) { rc = document.createElement('div'); rc.className = 'sbres'; box.appendChild(rc); }
    if (rc) { if (n) rc.textContent = '候補 ' + n; else rc.remove(); }
  });
  var el = $('info'), o = INFO_SH;
  if (o && SHIPS.indexOf(o) < 0) o = INFO_SH = null;
  if (!o) { el.style.display = 'none'; gmapDraw(null); }
  else {
    var fs = flagship(o.team), many = teamShips(o.team).length > 1 || RESERVE[o.team].length > 0;
    var who = o.i === PLAYER_I ? '我艦' : o.team === pt ? (many && o === fs ? '我方旗艦' : '友艦') : (many && o === fs ? '敵方旗艦' : '敵艦');
    var title = who + ' ' + o.name + (o.name !== o.T.name ? '<span class="cls">（' + o.T.name + '型）</span>' : '') + teamTag(o);
    var seeing = CAM.mode === 3 && (CAM.see === o || (!CAM.see && o.i === PLAYER_I));
    el.innerHTML = panel(o, title).replace('<h3>', '<h3><span class="fold">▲ 收起</span><span class="fold see' + (seeing ? ' on' : '') + '" data-see="1">🎥 ' + (seeing ? '看著這艘' : '看這艘') + '</span>' + (canTake(o) ? '<span class="fold take" data-take="1">⚓ 改操控這艘</span>' : '') + '<span class="fold gm">' + [['gun', '💥 砲位'], ['dmg', '🔧 損壞'], ['flood', '💧 進水'], ['fire', '🔥 火災']].map(function (m) { return '<i data-gmode="' + m[0] + '"' + (GMAP_MODE === m[0] ? ' class="on"' : '') + '>' + m[1] + '</i>'; }).join('') + '</span>');   // 旁邊那張圖：砲位／損壞／進水（gmapDraw）   // 友艦才有（52_fleet.js playerTakeShip）   // 放在標題最前面再靠右浮動（⛔ 放最後 ⇒ 窄的時候浮到排水量那一行、壓到右欄）
    el.style.display = 'block'; el.style.borderLeftColor = teamIdx(o) === 0 ? 'var(--blue)' : 'var(--red)';
    gmapDraw(o);
  }
}
// ───────────────────────── 砲位圖（TASK-0564；Tim 2026-10-14） ─────────────────────────
// 展開的那一艘：俯視船體（05_hull.js navImg，船頭朝上、右舷在右；Tim 2026-10-14）直接鋪在詳細資訊旁邊（沒有底框；窄螢幕排到下面），每門砲畫在它的砲口位置。
//   比例尺固定（電腦 GMAP_K px／公尺、手機 2.5，跟卡片並排）⇒ 小船就小；一條 10 m 在船的下面（GMAP_FOOT：⛔ 疊在右下角會蓋到船尾的砲）。上下幾層的砲同一個位置 ⇒ 沿砲軸往外錯開：最上層往船內 1.4 m、往下每一層再往外 2.3 m。
//   砲的符號與顏色跟下方 HUD（gunCell）同一套：形狀 ＝ 裝填（● 好 ◌ 裝填中 ○ 開不了 △ 等火藥 ≈ 泡水 ✕ 毀）、顏色 ＝ 人手（綠 滿編、黃 不足、灰 沒人、紅 毀、藍 泡水）；
//   不寫「左舷／右舷」（Tim 2026-10-14 拿掉：船頭朝上 ⇒ 左右就是左右舷）。
// 進水（GMAP_MODE ＝ 'flood'；Tim 2026-10-18「在炮位 損壞之外 加一個切換顯示進水」）：同停格的進水細節頁的俯視剖面（72_floodui.js fpDraw view 1）—— 艙內的水沿高度加總、越滿越藍；
//   破口照洞的大小（水下紅、水上橙、水往外流綠）。公式模式沒有艙內的水 ⇒ 圖上不畫、卡片寫水線下打掉幾格。⛔ 只讀模擬。
// 損壞（GMAP_MODE ＝ 'dmg'；卡片標題的「砲位｜損壞｜進水」切換，預設砲位）：同一張俯視圖上畫全船的損壞表（48_damage.js sh.dmg.rows，只讀）——
//   甲板破洞（每個走路點一小格；通道斷了深紅、其他橘紅）、梯子（H）、帆的綁定點（◆）、帆（橫過船寬一條：白的長度 ＝ 剩下的血量，繩斷了標 ✂）、繩梯（⋮，梯腳）、
//   倒掉的桅（✕）；木匠、帆匠在哪（點），正在修的那一件外面一圈白。
// 火災（GMAP_MODE ＝ 'fire'；TASK-0717）：焦痕、燒穿的格（4×4 格一小塊）、火場（圓的大小照格數、顏色照熱度；有人在潑 ⇒ 白圈＋到了／要幾人）、救火的水手、著過火的帆（同損壞圖的帆條：黑 ＝ 燒掉的比例）。⛔ 只讀 sh.burn。
var GMAP_MODE = 'gun';
var GMAP_DMG = { chan: '#ff3b3b', hole: '#ff9a5b', lad: '#ffb347', anc: '#f0d264', rlad: '#d8b483', mast: '#ff5b5b', carp: '#e0a05a', sm: '#9fd3ff' };
var GMAP_K = 4, GMAP_PAD = 4.5, GMAP_FOOT = 18;                                          // px／公尺；四周留白（公尺：最下層的砲畫在船殼外）
var GMAP_COL = { full: '#7be37b', short: '#f0d264', none: '#9a9a9a', dead: '#ff5b5b', wet: '#58b7ff' };
function gmapDraw(sh) {
  var cv = $('gmap'), T = sh && sh.T, NI = T && T.navImg;
  if (!NI) { cv.style.display = 'none'; return; }
  var D = sh.decks, n = D.length;
  var narrow = window.innerWidth <= 760, K = narrow ? 2.5 : GMAP_K, dpr = window.devicePixelRatio || 1, C = NAV_CELL, s = K * S, P0 = Math.max(GMAP_PAD, -1.4 + 2.3 * (n - 1) + 2) * K;   // s：每一格幾 px；P0：留白（px）—— 最下層錯開得最外面（三叉戟號四層砲甲板 ⇒ 5.5 m，⛔ 固定 4.5 m 那層畫到圖外）
  var W = NI.width * C * s + 2 * P0, H = NI.height * C * s + 2 * P0 + GMAP_FOOT;
  function scr(x, y) { return [(y - T.navX0 * C) * s + P0, ((T.navGH - T.navY0) * C - x) * s + P0]; }   // 格 (x, y) ⇒ 畫面（圖上 (u, v) ＝ (y/C − x0, H − y0 − x/C)）
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = Math.round(W) + 'px'; }
  cv.style.display = 'block';
  var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  g.save(); g.shadowColor = 'rgba(0,0,0,.75)'; g.shadowBlur = 6; g.globalAlpha = sh.sunk ? 0.45 : 0.97;
  g.drawImage(NI, P0, P0, NI.width * C * s, NI.height * C * s); g.restore();
  var R = Math.max(narrow ? 1.5 : 2.2, Math.min(4, K * 0.55));
  if (GMAP_MODE === 'dmg') gmapDmg(g, sh, scr, s, R);
  else if (GMAP_MODE === 'flood') gmapFlood(g, sh, scr, s);
  else if (GMAP_MODE === 'fire') gmapFire(g, sh, scr, s, R);
  else sh.guns.forEach(function (gn) {
    var k = 0; for (var q = 0; q < n; q++) if (D[q].key === gn.deck) k = q;
    var off = (-1.4 + 2.3 * (n - 1 - k)) / S, p = scr(gn.muz[0] + gn.ax[0] * off, gn.muz[1] + gn.ax[1] * off), X = p[0], Y = p[1];
    var st = !gn.alive ? 'dead' : gn.wet ? 'wet' : gn.manned < gn.crewMin ? 'none' : gn.manned < gn.crewFull ? 'short' : 'full';
    var sym = !gn.alive ? 3 : gn.wet ? 5 : gunRate(gn) <= 0 ? 2 : gn.needCart && !(gn.box > 0) ? 4 : gn.reload > 0 ? 1 : 0, col = GMAP_COL[st];
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.4;
    g.beginPath();
    if (sym === 3) { g.moveTo(X - R, Y - R); g.lineTo(X + R, Y + R); g.moveTo(X + R, Y - R); g.lineTo(X - R, Y + R); g.stroke(); }
    else if (sym === 4) { g.fillStyle = '#ffb35a'; g.moveTo(X, Y - R); g.lineTo(X + R, Y + R * 0.8); g.lineTo(X - R, Y + R * 0.8); g.closePath(); g.fill(); }
    else { g.arc(X, Y, R, 0, 6.2832); if (sym === 0 || sym === 5) g.fill(); else { if (sym === 2) g.setLineDash([1.5, 1.5]); g.stroke(); g.setLineDash([]); } }
  });
  g.font = 'bold ' + (narrow ? 9 : 11) + 'px "Noto Sans TC","Microsoft JhengHei",sans-serif'; g.shadowColor = '#000'; g.shadowBlur = 3;
  var bar = 10 * K, yb = H - 4; g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2; g.beginPath(); g.moveTo(W - 6 - bar, yb); g.lineTo(W - 6, yb); g.stroke();   // 10 m：船下面那一條留白（GMAP_FOOT）
  g.fillStyle = 'rgba(255,255,255,.85)'; g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText('10 m', W - 6 - bar - 4, yb + 3); g.textAlign = 'left'; g.textBaseline = 'middle';
}
/** 損壞圖（gmapDraw 的 'dmg'）：照損壞表一列一列畫在俯視圖上（scr：格 (x, y) ⇒ 畫面；s：每格幾 px；R：符號半徑）。 */
function gmapDmg(g, sh, scr, s, R) {
  var D = sh.dmg, NV = sh.nav, T = sh.T, busy = [], C = GMAP_DMG;
  sh.crew.forEach(function (c) { var J = c.hand && c.hand.job; if (J && crewAble(c)) busy.push(J.kind === 'repair' ? J.t : J.kind === 'sail' ? J.s : null); });
  function ring(X, Y, r) { g.strokeStyle = '#fff'; g.lineWidth = 1.2; g.beginPath(); g.arc(X, Y, r, 0, 6.2832); g.stroke(); }
  g.lineWidth = 1.4;
  (D ? D.rows : []).forEach(function (r) {
    var on = busy.indexOf(r) >= 0 || (r.t && busy.indexOf(r.t) >= 0), p, X, Y;
    if (r.kind === 'hole') {
      var N = NV.levels[r.lv].N, w = Math.max(1.5, NAV_C * s), sx = 0, sy = 0;
      g.fillStyle = r.pri === 1 ? C.chan : C.hole; g.globalAlpha = 0.85;
      r.hole.forEach(function (i) { var q = navPos(N, i), P = scr(q[0], q[1]); g.fillRect(P[0] - w / 2, P[1] - w / 2, w, w); sx += P[0]; sy += P[1]; });
      g.globalAlpha = 1; if (on) ring(sx / r.hole.length, sy / r.hole.length, R * 2.2);
    } else if (r.kind === 'lad') {
      var L = NV.ladders[r.j]; p = scr(L.pts[1][0], L.pts[1][1]); X = p[0]; Y = p[1];
      g.strokeStyle = C.lad; g.beginPath(); g.moveTo(X - R, Y - R); g.lineTo(X - R, Y + R); g.moveTo(X + R, Y - R); g.lineTo(X + R, Y + R); g.moveTo(X - R, Y); g.lineTo(X + R, Y); g.stroke();
      if (on) ring(X, Y, R * 2);
    } else if (r.kind === 'anchor') {
      p = scr((r.a & 2047) + 0.5, ((r.a >> 11) & 1023) + 0.5); X = p[0]; Y = p[1];
      g.fillStyle = C.anc; g.beginPath(); g.moveTo(X, Y - R * 1.2); g.lineTo(X + R, Y); g.lineTo(X, Y + R * 1.2); g.lineTo(X - R, Y); g.closePath(); g.fill();
      if (on) ring(X, Y, R * 2);
    } else if (r.kind === 'sail') {
      var t = r.t, x = smCenter(t), yb = gmapSailY(t), A = scr(x, yb[0]), B = scr(x, yb[1]), f = Math.max(0, Math.min(1, t.hp / t.hpMax)), Wc = g.canvas.width / (window.devicePixelRatio || 1);
      A[0] = Math.max(3, Math.min(Wc - 3, A[0])); B[0] = Math.max(3, Math.min(Wc - 3, B[0]));   // 帆桁比船寬 ⇒ 收在圖裡（⛔ 不收 ⇒ 畫到圖外、✂ 被切掉）
      g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.28)'; g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke();
      g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f); g.stroke(); g.lineWidth = 1.4;
      if (r.need.ropes.length) { g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.font = 'bold 10px sans-serif'; g.fillText('✂' + r.need.ropes.length, (A[0] + B[0]) / 2, A[1] - 3); }
      if (on) ring((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, R * 1.6);
    } else if (r.kind === 'rlad') {
      p = scr(r.t.foot[0], r.t.foot[1]); X = p[0]; Y = p[1]; g.fillStyle = C.rlad;
      for (var k = -1; k <= 1; k++) { g.beginPath(); g.arc(X, Y + k * R * 0.9, R * 0.38, 0, 6.2832); g.fill(); }
      if (on) ring(X, Y, R * 2);
    }
  });
  sh.masts.forEach(function (m) { if (m.up) return; var P = scr(m.x, T.cy), X = P[0], Y = P[1], r = R * 1.4; g.strokeStyle = C.mast; g.lineWidth = 2; g.beginPath(); g.moveTo(X - r, Y - r); g.lineTo(X + r, Y + r); g.moveTo(X + r, Y - r); g.lineTo(X - r, Y + r); g.stroke(); });
  sh.crew.forEach(function (c) {
    if (!crewAble(c) || (c.role !== ROLE.CARPENTER && c.role !== ROLE.SAILMAKER)) return;
    var P = scr(c.pos[0], c.pos[1]); g.fillStyle = c.role === ROLE.CARPENTER ? C.carp : C.sm; g.strokeStyle = '#000'; g.lineWidth = 0.8;
    g.beginPath(); g.arc(P[0], P[1], R * 0.75, 0, 6.2832); g.fill(); g.stroke();
  });
}
/** 火災圖（gmapDraw 的 'fire'）：49_burn.js 的 sh.burn 照俯視圖畫（scr：格 (x, y) ⇒ 畫面；s：每格幾 px；R：符號半徑）。 */
function gmapFire(g, sh, scr, s, R) {
  var B = sh.burn; if (!B) return;
  var bin = {}, w = Math.max(1.5, 4 * s), k;
  for (k = 0; k < B.chP.length; k++) {                                 // 焦痕／燒穿：4×4 格一小塊（同一塊燒穿的蓋過焦的；木匠補回來的那格不算燒穿）
    var p = B.chP[k], x = p & 2047, y = (p >> 11) & 1023, z = p >> 21, key = (x >> 2) + 512 * (y >> 2), t = B.chK[k];
    if (t === 3 && sh.grid.get(x, y, z)) continue;
    if ((bin[key] || 0) < t) bin[key] = t;
  }
  for (k in bin) { var bx = (k % 512) * 4, by = Math.floor(k / 512) * 4, P = scr(bx + 2, by + 2); g.fillStyle = bin[k] === 3 ? '#1b1210' : '#5a4636'; g.globalAlpha = 0.85; g.fillRect(P[0] - w / 2, P[1] - w / 2, w, w); }
  g.globalAlpha = 1;
  sh.sails.forEach(function (t) {                                      // 著過火的帆：橫過船寬一條（黑 ＝ 燒掉的比例；還在燒 ⇒ 橘）
    var F = t.burn; if (!F) return;
    var x = smCenter(t), yb = gmapSailY(t), A = scr(x, yb[0]), C = scr(x, yb[1]), Wc = g.canvas.width / (window.devicePixelRatio || 1), f = Math.max(0, Math.min(1, F.hf));
    A[0] = Math.max(3, Math.min(Wc - 3, A[0])); C[0] = Math.max(3, Math.min(Wc - 3, C[0]));
    g.lineWidth = 3; g.strokeStyle = t.dead ? 'rgba(255,255,255,.18)' : F.lit ? '#ff8a3a' : 'rgba(255,255,255,.55)'; g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(C[0], C[1]); g.stroke();
    g.strokeStyle = '#120c0a'; g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(A[0] + (C[0] - A[0]) * f, A[1] + (C[1] - A[1]) * f); g.stroke(); g.lineWidth = 1.4;
  });
  g.font = 'bold 10px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'bottom';
  B.spots.forEach(function (sp) {                                      // 火場：圓的大小照格數、顏色照熱度（黃 → 紅）；有人在潑 ⇒ 白圈；數字 ＝ 到了／要幾人
    if (sp.sail || !sp.c) return;
    var P = scr(sp.c[0], sp.c[1]), r = Math.max(R, Math.min(R * 4, Math.sqrt(sp.n) * s * 2.2 + R * 0.6)), h = Math.max(0, Math.min(1, sp.heat));
    g.fillStyle = 'rgb(255,' + Math.round(207 - 101 * h) + ',' + Math.round(74 - 48 * h) + ')'; g.globalAlpha = 0.85; g.beginPath(); g.arc(P[0], P[1], r, 0, 6.2832); g.fill(); g.globalAlpha = 1;
    if (sp.have) { g.strokeStyle = '#fff'; g.lineWidth = 1.2; g.beginPath(); g.arc(P[0], P[1], r + 2, 0, 6.2832); g.stroke(); }
    if (sp.need) { g.fillStyle = '#fff'; g.fillText(sp.have + '/' + sp.need, P[0], P[1] - r - 2); }
  });
  g.textAlign = 'left'; g.textBaseline = 'middle';
  sh.crew.forEach(function (c) {                                       // 救火的水手（藍點；站到了 ⇒ 黑邊粗一點）
    var J = c.hand && c.hand.job; if (!J || J.kind !== 'fire' || !crewAble(c)) return;
    var P = scr(c.pos[0], c.pos[1]); g.fillStyle = '#58b7ff'; g.strokeStyle = '#000'; g.lineWidth = J.at ? 1.4 : 0.8;
    g.beginPath(); g.arc(P[0], P[1], R * 0.75, 0, 6.2832); g.fill(); g.stroke();
  });
}
/** 進水圖（gmapDraw 的 'flood'）：水格（33_flood.js：邊長 c 格）沿高度加總 ⇒ 每一柱水量／容量，越滿越藍；破口照洞的大小（水下紅、水上橙）。 */
function gmapFlood(g, sh, scr, s) {
  var fl = sh.fl; if (!fl || sh.broken) return;
  var F = fl.F, c = F.c, NX = F.NX, NY = F.NY, NXY = NX * NY, Vc = Math.pow(c * S, 3), capS = new Float32Array(NXY), watS = new Float32Array(NXY), k;
  for (k = 0; k < F.N; k++) { if (!(fl.cap[k] > 0.02)) continue; var j = k % NXY; capS[j] += fl.cap[k] * Vc; watS[j] += fl.A[k]; }
  // 每一柱水 ＝ 一張小圖上的一個像素（寬 NY：船寬、高 NX：船長，船頭朝上），整張縮放貼上去（Tim 2026-10-18 截圖：一格一格的網格紋）——
  //   ⛔ 一格一個 fillRect：水格比一個像素還窄（量到每 4 個裝置像素一條暗線）⇒ 取整數之後有的疊兩次、半透明疊出網格紋
  //   顏色照水深（m）：0 ～ FL_DEPTH_MAX，淺青 → 深靛紫（72_floodui.js FL_RAMP；⛔ 照整柱裝幾成 ⇒ 水少時每柱都一兩成、整片一樣藍）
  var img = gmapFlood.cv || (gmapFlood.cv = document.createElement('canvas')), any = false;
  if (img.width !== NY || img.height !== NX) { img.width = NY; img.height = NX; }
  var ig = img.getContext('2d'), id = ig.createImageData(NY, NX), D = id.data;
  for (k = 0; k < NXY; k++) {
    if (!(watS[k] > 1e-4) || !(capS[k] > 0)) continue;
    var col = flWaterRGBA(watS[k] / Math.pow(c * S, 2) / FL_DEPTH_MAX), o = ((NX - 1 - (k % NX)) * NY + ((k / NX) | 0)) * 4;   // 船頭（x 大）在上、格 +y 在右（同 scr）
    D[o] = col[0]; D[o + 1] = col[1]; D[o + 2] = col[2]; D[o + 3] = Math.round(col[3] * 255); any = true;
  }
  if (any) {
    ig.putImageData(id, 0, 0);
    var A = scr(F.X0 + NX * c, F.Y0), B = scr(F.X0, F.Y0 + NY * c);
    g.save(); g.imageSmoothingEnabled = true; g.drawImage(img, A[0], A[1], B[0] - A[0], B[1] - A[1]); g.restore();
  }
  fl.holes.forEach(function (h) {
    if (!(fl.hA[h] > 0) || (fl.hPort[h] >= fl.hA[h] - 1e-9 && !fl.hWet[h])) return;   // 只有砲口、在海面上 ⇒ 不畫成破口（TASK-0822）
    var P = scr(fl.hX[h], fl.hY[h]), r = Math.max(1.5, Math.sqrt(fl.hA[h]) / 2 / S * s * 1.3);
    g.fillStyle = flHoleCol(fl, h); g.beginPath(); g.arc(P[0], P[1], r, 0, 6.2832); g.fill();
  });
}
/** 帆橫過船寬的範圍（帆的頂點 y 的最小、最大；算一次）。 */
function gmapSailY(t) {
  if (!t.gmY) { var v = t.verts, lo = 1e9, hi = -1e9; for (var i = 1; i < v.length; i += 3) { if (v[i] < lo) lo = v[i]; if (v[i] > hi) hi = v[i]; } t.gmY = [lo, hi]; }
  return t.gmY;
}
/** 砲列的圈（Tim 2026-10-20「另外是否可以讓綠色變成圓圈而非點狀」「這部分可以直接用一個白色圓圈圖片 換色達成嗎(包含外圍圓圈) 透過縮放圖片與換色」「白色圓圈圖片用程式生成」
 *  「綠圈(標記裝填中) 黑圈(外框) 黃圈(目標在砲擊範圍)」「然後要考慮到不同解析度(且會在手機 PC上運行)」）：程式生成一個白色實心圓（hudDisc），三個圈都是它縮放＋換色出來的 ——
 *    黑圈（外框）＋綠圈（裝填中；顏色照人手，讀 .g-* 的 color ⇒ 顏色只在 template.html 一份）：白圓原大換黑 → 縮一圈換色 → 再縮一圈換黑，
 *      最後用「白圓挖掉更小的白圓」當遮罩把中間挖空 ⇒ 外黑邊、色圈、內黑邊；每種人手顏色一張，寫進 <style>（.ring.g-full…），格子裡置中、HUD_RING_D 格寬（跟 ● 差不多大）
 *    黃圈（打得中，template.html .aim::before）＝ 同一個白圓當遮罩（mask）、CSS 縮到 1.05 格、底色半透明金。
 *  不同解析度：圓是向量（SVG），照 --gc（電腦 12 px、窄螢幕 9 px）縮放、照裝置像素比（PC 1–2、手機 3）畫，哪一種都是銳利的、不用重畫。
 *    ⛔ 量過的路：畫布點陣（64 px）⇒ 電腦 1 倍時縮到 8 px，細邊會糊；要照像素比重畫又得跟著縮放、換螢幕改。
 *  ⛔ 以前裝填中是字型的 ◌：本身是一圈點（Tim 截圖：綠點一圈），壓在金色圓上更糊。第一次畫砲列時做一次。 */
var HUD_RING = false, HUD_RING_D = 0.66;                                // 0.66 格 ≈ ● 連黑邊的大小（量過 0.75：比 ● 大一圈、洞太小像甜甜圈）
var HUD_RING_EDGE = 0.11, HUD_RING_IN = 0.52;   // 白圓的直徑 ＝ 1：外黑邊 0.11（畫面上約 1 px）；色圈 1 − 2×0.11 ＝ 0.78 到 0.52；內黑邊 0.52 到 0.52 − 0.22（中間挖空）
/** 白色實心圓（SVG，圓心在原點、直徑 100）縮到 f 倍、換成 col。 */
function hudDisc(f, col) { return '<circle r="' + (50 * f).toFixed(2) + '" fill="' + col + '"/>'; }
/** SVG 內容 ⇒ CSS 的 url()（viewBox −50…50 ⇒ 圓剛好填滿）。 */
function hudSvg(body) { return 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100">' + body + '</svg>') + '")'; }
function hudRing() {
  if (HUD_RING) return true;
  var E = HUD_RING_EDGE, IN = HUD_RING_IN, D = 'calc(var(--gc) * ' + HUD_RING_D + ')';
  var hole = '<mask id="h">' + hudDisc(1, '#fff') + hudDisc(IN - 2 * E, '#000') + '</mask>';   // 遮罩：白圓挖掉最裡面那個 ⇒ 中間透出底下（海或黃圈）
  var css = '.ring{background:no-repeat center/' + D + ' ' + D + ';}';
  ['full', 'short', 'none', 'dead', 'wet'].forEach(function (k) {
    var probe = document.createElement('span'); probe.className = 'g-' + k; document.body.appendChild(probe);
    var col = getComputedStyle(probe).color; probe.remove();
    css += '.ring.g-' + k + '{background-image:' + hudSvg(hole + '<g mask="url(#h)">' + hudDisc(1, '#000') + hudDisc(1 - 2 * E, col) + hudDisc(IN, '#000') + '</g>') + ';}';
  });
  var m = hudSvg(hudDisc(1, '#fff')) + ' center/100% 100% no-repeat';   // 黃圈：白圓當遮罩，顏色、大小照 template.html 的 .aim::before
  css += '.gside .aim::before,.gend .aim::before{-webkit-mask:' + m + ';mask:' + m + ';}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  return (HUD_RING = true);
}
/** 一門砲的符號：形狀 ＝ 裝填（● 好　綠圈 裝填中（hudRing）　○ 開不了　△ 等火藥　≈ 泡水　✕ 毀），顏色 ＝ 人手（綠 滿編、黃 人數不足但能開（裝填慢）、灰 少於最少人數、紅 毀、藍 泡水）；受損 ⇒ 底下一條血條。 */
function gunCell(g, aim) {
  var st = !g.alive ? 'dead' : g.wet ? 'wet' : g.manned < g.crewMin ? 'none' : g.manned < g.crewFull ? 'short' : 'full';
  var k = !g.alive ? 3 : g.wet ? 5 : gunRate(g) <= 0 ? 2 : g.needCart && !(g.box > 0) ? 4 : g.reload > 0 ? 1 : 0;   // 4 ＝ 等火藥與彈藥（藥箱空了）
  var hp = !g.alive ? 0 : Math.max(0, g.model.hp / g.model.hpMax), hurt = g.alive && hp < 0.999;   // 受損 ⇒ 底下一條血條（.hp::after，寬 ＝ 剩下的血量）
  var cls = 'g-' + st + (hurt ? ' hp' : '') + (aim ? ' aim' : ''), sty = hurt ? '--hp:' + Math.round(hp * 100) + '%;' : '';
  if (HUD_ART) return '<span class="ico ' + cls + '" style="' + sty + 'background-position:' + ((3 + (k === 4 ? 1 : k === 5 ? 2 : k)) * 100 / 7).toFixed(3) + '% 0"></span>';
  var ring = k === 1 && hudRing();                                    // 裝填中 ⇒ 程式畫的綠圈＋黑圈（不用 ◌ 那一圈點）
  return '<span class="' + (ring ? 'ring ' : '') + cls + ' gk' + k + '"' + (sty ? ' style="' + sty + '"' : '') + '>' + (ring ? '' : '●◌○✕△≈'[k]) + '</span>';   // gk<k>：比較寬的符號（✕ △）在 HUD 的固定格子裡縮小字級（template.html）
}
/** HUD 放哪：追擊砲 ⇒ 砲軸偏船頭 'bow'、偏船尾 'stern'（⛔ 只看砲軸：憲法號、餘燼號船頭的追擊砲朝兩舷外 60–75°，會被當成側舷）；
 *  其他砲 ⇒ 砲軸（格座標，+x ＝ 船頭）幾乎朝船頭／船尾才算，不然 ＝ 側舷 'side'。 */
function gunDir(g) { if (g.type === 'chase') return g.ax[0] >= 0 ? 'bow' : 'stern'; return g.ax[0] > 0.7 ? 'bow' : g.ax[0] < -0.7 ? 'stern' : 'side'; }
/** 我艦的砲（Tim 2026-10-14）：沒有字、沒有底板（符號描黑邊直接壓在畫面上）。
 *  側舷砲貼著羅盤左右兩邊往外長（#gunsL 左舷、#gunsR 右舷；船頭那門靠羅盤、每層砲甲板一行、最上層在上；那一舷有砲對得到目標 ⇒ 靠羅盤那一側一條金線）；
 *  船頭砲在羅盤上面（#gunsB）、船尾砲在羅盤下面（#gunsA）—— 跟羅盤裡船頭朝上的船同一個方向；左舷的在左、對得到 ⇒ 靠羅盤那一側一條金線；沒有就藏起來。
 *  「⚠ 射界外」改到羅盤上方那一行（Tim 2026-10-15：「射界外提示不要放在下方面板內，都改到羅盤上方的資訊」）⇒ 這裡只記 HUD_OUTARC，下方面板那一格（#guns）一律藏起來。 */
function gunHud(me) {
  if (!foeOf(me) && !me.aim) { HUD_OUTARC = false; return; }        // 沒有敵艦也沒有瞄準點（建造模式，82_build.js）⇒ 不算（⛔ 照算 ⇒ aimPoint 拿 null 的敵艦，每一格例外）
  gunAims(me);                                                         // 每門打不打得到：砲上那一份（21_gunnery.js；這裡只讀）
  function cell(g) { return gunCell(g, !!g.aimHit); }                  // 金框：這門現在開打得中（射界＋射程）
  function on(g) { return g.alive && gunRate(g) > 0 && !!g.aimT; }
  ['P', 'S'].forEach(function (side) {
    var rows = me.decks.map(function (D) { return me.guns.filter(function (x) { return x.deck === D.key && x.side === side && gunDir(x) === 'side'; }); }).filter(function (r) { return r.length; }).reverse();
    var lit = me.guns.some(function (g) { return g.side === side && gunDir(g) === 'side' && on(g); });
    var box = $(side === 'P' ? 'gunsL' : 'gunsR'), h = rows.map(function (r) { return '<div>' + r.map(cell).join('') + '</div>'; }).join('');   // 左舷那一欄 rtl（template.html）⇒ 兩舷都是船頭靠羅盤、換行也從羅盤那邊接
    if (box.innerHTML !== h) box.innerHTML = h;
    box.classList.toggle('on', lit);
  });
  [['bow', 'gunsB'], ['stern', 'gunsA']].forEach(function (E) {
    var L = me.guns.filter(function (g) { return gunDir(g) === E[0]; }).sort(function (a, b) { return a.ax[1] - b.ax[1]; });   // 左舷（−y）在左
    var lit = L.some(on), box = $(E[1]), h = L.map(cell).join('');
    if (box.innerHTML !== h) box.innerHTML = h;
    box.style.display = L.length ? '' : 'none'; box.classList.toggle('on', lit);
  });
  var bears = me.guns.some(on);                                        // ＝ 以前的 anyBears(aimPoint)：有一門（還在、有人操作）對得到
  HUD_OUTARC = !bears && handAim(me); var gb = $('guns'); if (gb.style.display !== 'none') gb.style.display = 'none';
}
/** 補給一行：送藥手還能動的／全部、等火藥的砲幾門、取用點還剩幾桶。 */
function supplyText(sh) {
  var pm = sh.crew.filter(function (c) { return c.role === ROLE.POWDER; }), ok = pm.filter(crewAble).length;
  var wait = sh.guns.filter(function (g) { return g.alive && g.needCart && !(g.box > 0) && gunRate(g) > 0; }).length;
  return '送藥手 ' + ok + '/' + pm.length + (wait ? '　<span style="color:#ffb35a">等火藥 ' + wait + ' 門</span>' : '');
}
var HUDN = 0;
/** HUD 圖示表（art/hud.png，8 欄 × 2 列）：第一列 船員 傷 亡 裝填好 裝填中 沒人 毀 鏈；只換掉砲列的符號。 */
function hudArt() {
  var st = document.createElement('style');
  st.textContent = '.ico{display:inline-block;width:14px;height:14px;vertical-align:-2px;background-image:url(' + HUD_ART.src + ');background-size:800% 200%;}';
  document.head.appendChild(st);
}
/** 羅盤那一團（#navBox）往下壓、底邊貼在下方面板（#ctl）頂上 BOT_GAP px（Tim 2026-10-14）：量現在差多少、改 margin-bottom（負的 ⇒ 落進兩組大圓鈕之間；砲列壓在大圓鈕底下）。
 *  #botC 可能被 scale（手機橫拿 .82）⇒ 量到的差先除回去；差不到半格不動。 */
/** 瞄準圈（UI 層；Tim 2026-10-17「瞄準圈是否可以改成UI層顯示(目前會隨敵艦旋轉 且很不清楚) 然後瞄敵人時改紅色(友軍維持藍色)」「希望在中心加個十字」）：
 *  以前是 3D 裡 16 個點、圈面跟著敵艦的船長方向轉（60_render.js）⇒ 船一轉就側成橢圓、點小看不清。現在每一格把瞄準點（sh.aim，那艘的格座標）投影到螢幕，
 *  #aimR（template.html：外圈＋中心十字＋中心點，描暗邊）放在那一點、固定像素大小、不轉；瞄敵艦紅、瞄友艦藍（.ally）。
 *  只畫玩家自己瞄的（handAim：沒開自動開砲，或開著但點了那一舷）；跑到鏡頭後面、畫面外、沒開戰、?still=1 ⇒ 藏。⛔ 不擋點擊（pointer-events:none）。
 *  座標照畫布（＝ #stage，安全區收過邊）的大小 —— 跟點擊瞄準（71_input.js pick）同一套換算。 */
var AIMR = { on: false, ally: null, x: NaN, y: NaN };
function aimRingUi() {
  var el = $('aimR'); if (!el) return;
  var me = SHIPS[PLAYER_I], fs = me && me.aim && handAim(me) && RUNNING && !STILL ? aimShip(me) : null, show = !!(fs && fs.M), x = 0, y = 0;
  if (show) {
    var w = M4.pt(fs.M, me.aim[0], me.aim[1], me.aim[2]), q = CAM.vp, cw = q[3] * w[0] + q[7] * w[1] + q[11] * w[2] + q[15];
    if (cw <= 0.1) show = false;                                               // 在鏡頭後面
    else {
      var W = cv.clientWidth, H = cv.clientHeight;
      x = Math.round(((q[0] * w[0] + q[4] * w[1] + q[8] * w[2] + q[12]) / cw + 1) / 2 * W);
      y = Math.round((1 - (q[1] * w[0] + q[5] * w[1] + q[9] * w[2] + q[13]) / cw) / 2 * H);
      if (x < -30 || y < -30 || x > W + 30 || y > H + 30) show = false;
    }
  }
  if (AIMR.on !== show) { AIMR.on = show; el.classList.toggle('on', show); }
  if (!show) return;
  var ally = !isFoe(me, fs); if (AIMR.ally !== ally) { AIMR.ally = ally; el.classList.toggle('ally', ally); }
  if (AIMR.x !== x || AIMR.y !== y) { AIMR.x = x; AIMR.y = y; el.style.transform = 'translate(' + x + 'px,' + y + 'px)'; }
}
var BOT_GAP = 2;
/** 直式手機（Tim 2026-10-17「iphone直畫面全螢幕時 把羅盤放到最下排」「輪盤上方文字 改成按鈕上方」「或是統一改到下面好了」「羅盤跟炮提示統一到畫面下方」）
 *  ⇒ html.navlow：最下排整排只留給羅盤與兩舷的砲數提示（#navBox），按鈕（#ctl 的 C P O 4 R、左右兩欄 #helmL／#helmR）都抬到它上面、狀態文字（#modeT）再上面
 *  （template.html html.navlow 那一段）。瀏覽器裡、從主畫面開都一樣；橫式與平板照舊（Tim：橫板不用改）。 */
var NAV_LOW_MQ = window.matchMedia ? window.matchMedia('(orientation:portrait) and (max-width:760px)') : null, NAV_LOW_GAP = 4;
function navLow() { return !!(NAV_LOW_MQ && NAV_LOW_MQ.matches); }
function botFit() {
  var nb = $('navBox'), ctl = $('ctl'), bc = $('botC'); if (!nb || !ctl) return;
  var low = navLow(), root = document.documentElement;
  if (root.classList.contains('navlow') !== low) root.classList.toggle('navlow', low);
  var up = low ? nb.offsetHeight + NAV_LOW_GAP : 0;   // C P O 4 R 抬多少 ＝ 羅盤那一團多高（砲條 #gunsB＋羅盤＋追擊砲 #gunsA；#modeT 這時是 absolute、不算）
  if ((parseFloat(ctl.style.marginBottom) || 0) !== up) ctl.style.marginBottom = up ? up + 'px' : '';
  // 左右兩欄也一起抬（Tim 2026-10-17「滿版時左右兩側按鈕也要往上移動」「應該說直式排版時 最下方全部留給羅盤空間 按鈕從羅盤上方開始排」）⇒ 最下排只有羅盤
  ['helmL', 'helmR'].forEach(function (id) { var h = $(id); if ((parseFloat(h.style.marginBottom) || 0) !== up) h.style.marginBottom = up ? up + 'px' : ''; });
  if (low) { var lu = ctl.offsetHeight + 2 * NAV_LOW_GAP + 'px'; if (nb.style.getPropertyValue('--lowup') !== lu) nb.style.setProperty('--lowup', lu); }
  var k = bc.getBoundingClientRect().width / (bc.offsetWidth || 1) || 1,
      to = low ? $('ctlRow').getBoundingClientRect().bottom : ctl.getBoundingClientRect().top - BOT_GAP,   // 羅盤的底：最下排（A／D 的底）｜C P O 4 R 的頂上
      d = (to - nb.getBoundingClientRect().bottom) / k;
  if (Math.abs(d) < 0.5) return;
  nb.style.marginBottom = Math.min(0, (parseFloat(nb.style.marginBottom) || 0) - d) + 'px';   // ⛔ 不給正的：面板比大圓鈕高的時候照舊排在面板上面
}
// ───────────────────────── 左下：羅盤與船身 ─────────────────────────
// 羅盤跟著鏡頭轉（畫面上方 ＝ 鏡頭看的方向）；「北」＝ 世界 −z（只是參考方向，航向照它算：東 ＝ +x）。
// 圈上：我艦（中間，尖端 ＝ 船頭）、風（從哪吹來的箭頭）、敵艦方位（紅點）、兩舷的砲門射界（±26°，對得到敵艦的那一舷亮）。
var COMPASS = ['北', '北北東', '東北', '東北東', '東', '東南東', '東南', '南南東', '南', '南南西', '西南', '西南西', '西', '西北西', '西北', '北北西'];
function bearing(x, z) { return ((Math.atan2(x, -z) * 57.2958) % 360 + 360) % 360; }
function compassName(b) { return COMPASS[Math.round(b / 22.5) % 16]; }
function deg3(b) { return ('00' + Math.round(b) % 360).slice(-3) + '°'; }
/** 羅盤的射界（drawNav）：世界方位角（度，atan2(z, x)）的連續段 [起, 迄]。all ＝ 開得動的砲、on ＝ 這一刻對得到敵艦的。 */
var ARC_BIN = { all: new Uint8Array(360), on: new Uint8Array(360) };
function gunArcs(sh, foe) {
  var A = ARC_BIN.all, O = ARC_BIN.on, w = foe && foe.center; A.fill(0); O.fill(0);
  sh.guns.forEach(function (gn) {
    if (!gn.alive || gunRate(gn) <= 0) return;
    var ax = gunAxis(sh, gn), a = Math.round(Math.atan2(ax[2], ax[0]) * 57.2958), on = w && !!gunTarget(sh, gn, w);
    for (var d = -26; d <= 26; d++) { var k = ((a + d) % 360 + 360) % 360; A[k] = 1; if (on) O[k] = 1; }   // ±26° ＝ ±0.45 rad
  });
  function runs(B) {
    var out = [], s0 = -1, k, i;
    for (k = 0; k < 360 && B[k]; k++); if (k === 360) return [[0, 360]];   // 整圈都有
    for (i = 1; i <= 360; i++) { var j = (k + i) % 360; if (B[j] && s0 < 0) s0 = k + i; if (!B[j] && s0 >= 0) { out.push([s0, k + i - 1]); s0 = -1; } }   // 從空的那一格開始掃 ⇒ 跨 0° 的段不會斷成兩截
    return out;
  }
  return { all: runs(A), on: runs(O) };
}
var TURN_T = 10, TURN_COL = '#7ef0c8', TURN_OFF = 0.22;   // 羅盤外圈的轉向弧：預測幾秒後的船頭、顏色（跟射界的金、風的藍、敵艦的紅分開）、起點離船頭幾 rad（約 13°，讓開航速箭頭）
function drawNav(sh) {
  if (!CAM.look) return;
  var c2 = $('navc'), g = c2.getContext('2d'), dpr = Math.min(window.devicePixelRatio || 1, 2), W = 150;
  if (c2.width !== W * dpr || c2.height !== W * dpr) { c2.width = c2.height = W * dpr; }   // ⛔ 只比寬：canvas 預設 300×150，dpr 2（手機）時寬剛好是 300 ⇒ 高停在 150，羅盤被拉成兩倍高、下半截切掉
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, W);
  var f = norm([CAM.look[0] - CAM.eye[0], 0, CAM.look[2] - CAM.eye[2]]), rt = [-f[2], 0, f[0]], cx = W / 2, cy = W / 2, R = 46;   // 46（以前 56）：外面讓給船體／進水兩圈
  // 船體、進水（Tim 2026-10-15：「跟船隻摺疊資訊一樣做成圓環，放在羅盤外圈（這樣就不用文字顯示），羅盤縮小一點確保佔用空間不變」）：
  //   跟艦隊圓鈕同一個畫法（fleetHud ring）：外圈金 ＝ 船體（還剩幾成格子）、內圈藍 ＝ 進水（floodPct，七成以上轉紅），從正上方順時針；底下一圈淡的是滿的樣子
  var hp = sh.grid.count / sh.orig, fp = floodPct(sh);
  function ringN(r, w, fr, col) {
    g.lineWidth = w; g.lineCap = 'butt'; g.strokeStyle = 'rgba(255,255,255,.13)'; g.beginPath(); g.arc(cx, cy, r, 0, 6.2832); g.stroke();
    if (fr > 0.002) { g.strokeStyle = col; g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + 6.2832 * Math.min(1, fr)); g.stroke(); }
  }
  ringN(69, 6, hp, '#e8c26a'); ringN(61.5, 5, sh.sunk ? 1 : fp, fp >= 0.7 || sh.sunk ? '#ff7a6a' : '#4fb3ff');
  var tt = '船體 ' + (hp * 100).toFixed(1) + '%　進水 ' + (sh.sunk ? '沉沒' : Math.round(fp * 100) + '%'); if (c2.title !== tt) c2.title = tt;
  function P(d, k) { return [cx + (d[0] * rt[0] + d[2] * rt[2]) * R * k, cy - (d[0] * f[0] + d[2] * f[2]) * R * k]; }
  function dirOf(b) { var a = b / 57.2958; return [Math.sin(a), 0, -Math.cos(a)]; }
  function line(a, b, col, w) { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
  g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, R, 0, 6.2832); g.stroke();
  for (var b = 0; b < 360; b += 30) line(P(dirOf(b), b % 90 ? 0.93 : 0.86), P(dirOf(b), 1), 'rgba(255,255,255,.35)', 1);
  g.font = '11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#e8c26a';
  var pn = P(dirOf(0), 1.17); g.fillText('N', pn[0], pn[1]);
  var F = fwd(sh.yaw), foe = foeOf(sh);
  // 射界（Tim 2026-10-13：照真的能開的砲畫）：每一門還開得動的砲（沒毀、有人）自己的砲門射界（砲軸 ±0.45 rad，跟 bears 同一個數）的聯集 ⇒ 暗；
  //   這一刻對得到敵艦的那幾門（gunTarget，跟開砲同一支）再疊一層亮的。追擊砲（船頭、餘燼號的船尾）各自的方向都畫得出來；砲打掉、沒人操作 ⇒ 那一塊消失。
  //   以 1° 一格累計再畫連續的段（聯集、跨 ±180° 都不用另外處理）；從船的中心畫（羅盤的比例下砲口在船上的前後差可以不管）。
  var arc = gunArcs(sh, foe), p0 = P([0, 0, 0], 0);
  [[arc.all, 'rgba(232,194,106,.13)'], [arc.on, 'rgba(232,194,106,.45)']].forEach(function (L) {
    L[0].forEach(function (r) {
      g.fillStyle = L[1]; g.beginPath(); g.moveTo(p0[0], p0[1]);
      for (var d = r[0]; ; d = Math.min(d + 3, r[1])) { var t = d / 57.2958, q = P([Math.cos(t), 0, Math.sin(t)], 0.97); g.lineTo(q[0], q[1]); if (d >= r[1]) break; }   // 每 3° 一點，最後一點落在段尾
      g.closePath(); g.fill();
    });
  });
  // 風：三條平行的風線從圈外吹進來（Tim 2026-10-14：一眼看出是風向），中間那條最長、尖端一個 ＞；風越強越長、越粗、越開（TASK-0566）：
  //   長 ＝ 0.25 ＋ 節 ÷ 60（0.3–0.95 個半徑；兩邊那兩條 ×0.65）、粗 ＝ 1 ＋ 節 ÷ 30（到 3 px）、間距 4 ＋ 節 ÷ 12 px ⇒ 晴天約 14 節短細、暴風雨 50 節長到圓心附近
  var Wd = norm(WIND), from = [-Wd[0], 0, -Wd[2]], kn = windKnots(), wl = clamp(0.25 + kn / 60, 0.3, 0.95), ww = clamp(1 + kn / 30, 1, 3), gap = clamp(4 + kn / 12, 4, 9);
  var a0 = P(from, 1.2), a1 = P(from, 1.2 - wl), hd = norm([a1[0] - a0[0], 0, a1[1] - a0[1]]), nx = -hd[2], ny = hd[0], hs = 3 + ww * 1.5;
  g.lineCap = 'round';
  [[0, 1], [gap, 0.65], [-gap, 0.65]].forEach(function (q) {
    var o0 = [a0[0] + nx * q[0], a0[1] + ny * q[0]], o1 = [o0[0] + (a1[0] - a0[0]) * q[1], o0[1] + (a1[1] - a0[1]) * q[1]];
    line(o0, o1, '#8fd3ff', ww);
  });
  g.beginPath(); g.moveTo(a1[0] - hd[0] * hs + nx * hs * 0.8, a1[1] - hd[2] * hs + ny * hs * 0.8); g.lineTo(a1[0], a1[1]); g.lineTo(a1[0] - hd[0] * hs - nx * hs * 0.8, a1[1] - hd[2] * hs - ny * hs * 0.8); g.stroke();
  g.lineCap = 'butt';
  // 其他船的方位（TASK-0537：全部畫，敵紅、友藍、沉了灰；一對一 ＝ 以前那一個紅點）
  SHIPS.forEach(function (o) {
    if (o === sh || !o.center || !sh.center) return;
    var e = norm([o.center[0] - sh.center[0], 0, o.center[2] - sh.center[2]]), pe = P(e, 0.86);
    g.fillStyle = o.sunk ? '#666' : isFoe(sh, o) ? '#ff6f6f' : '#6f9bff'; g.beginPath(); g.arc(pe[0], pe[1], 4.5, 0, 6.2832); g.fill();
  });
  // 我艦：從上面俯瞰的船（05_hull.js navImg，載入時算一次；船頭朝上、右舷在右 ⇒ 只轉不翻），船長（含艏斜桅）＝ 半徑的 1.575 倍（中心到兩端約 0.79 R，還在圈裡）
  //   （⛔ 0.8 倍 ⇒ 船長寬比約 6:1，在 150 px 的圈裡細成一條線；Tim 2026-10-13：1.05 倍再放大 1.5 倍）；外面一圈我方的顏色。沒有圖 ⇒ 以前的三角形
  var tc = teamIdx(sh) === 0 ? '#6f9bff' : '#ff6f6f', NI = sh.T.navImg;
  if (NI) {
    var tip = P(F, 1), sc = R * 1.575 / NI.height;
    g.save(); g.translate(cx, cy); g.rotate(Math.atan2(tip[1] - cy, tip[0] - cx) + Math.PI / 2); g.scale(sc, sc);
    g.shadowColor = tc; g.shadowBlur = 5; g.imageSmoothingEnabled = true; g.drawImage(NI, -sh.T.navU, -sh.T.navV);
    g.restore();
  } else {
    var S2 = norm([F[2], 0, -F[0]]), tip0 = P(F, 0.42), l = P(add(mul(F, -0.32), mul(S2, 0.12)), 1), r2 = P(add(mul(F, -0.32), mul(S2, -0.12)), 1);
    g.fillStyle = tc; g.beginPath(); g.moveTo(tip0[0], tip0[1]); g.lineTo(l[0], l[1]); g.lineTo(r2[0], r2[1]); g.closePath(); g.fill();
  }
  // 航速（TASK-0566）：從船頭往前延伸的白色箭頭，長 ＝ 節 ÷ 12 × 0.5 個半徑（最長到 1.32，圈外一點）；不到 0.3 節不畫
  var sk = Math.abs(sh.spd) * 1.944, FS = sh.spd < 0 ? mul(F, -1) : F;   // 倒車（31_sailing.js）⇒ 箭頭從船尾往後
  if (sk >= 0.3) {
    var s0 = P(FS, 0.8), s1 = P(FS, Math.min(1.32, 0.8 + sk / 12 * 0.5)), sd = norm([s1[0] - s0[0], 0, s1[1] - s0[1]]);
    g.lineCap = 'round'; line(s0, s1, '#ffffff', 2.5); g.lineCap = 'butt';
    g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(s1[0] + sd[0] * 5, s1[1] + sd[2] * 5); g.lineTo(s1[0] - sd[2] * 4, s1[1] + sd[0] * 4); g.lineTo(s1[0] + sd[2] * 4, s1[1] - sd[0] * 4); g.closePath(); g.fill();
  }
  // 轉向（Tim 2026-10-13：用圖示表現轉彎的方向與快慢，沿外圈畫）：從船頭的方向沿外圈畫到「照現在的轉向率，TURN_T 秒後船頭會在哪」，
  //   箭頭 ＝ 轉的方向，弧越長轉得越快（最多 120°）；幾乎直走（< 0.2°/秒）只畫船頭那一點。跟船頭在羅盤上用同一支 P(fwd(yaw)) ⇒ 弧的起點就是船頭指的方向。
  //   弧的起點往轉的那一側偏 TURN_OFF（Tim 2026-10-14：⛔ 從船頭正前方起畫 ⇒ 跟航速箭頭疊在一起）；船頭那一點只在停住（沒有航速箭頭）時畫。
  var yr = sh.yawRate || 0, span = clamp(yr * TURN_T, -2.094, 2.094), hp = P(F, 1.07);
  g.fillStyle = TURN_COL;
  if (sk < 0.3) { g.beginPath(); g.arc(hp[0], hp[1], 2.5, 0, 6.2832); g.fill(); }
  if (Math.abs(yr) > 0.0035) {
    var nT = Math.max(2, Math.ceil(Math.abs(span) / 0.05)), pt = [], a0T = sh.yaw + (span > 0 ? TURN_OFF : -TURN_OFF);
    for (var iT = 0; iT <= nT; iT++) pt.push(P(fwd(a0T + span * iT / nT), 1.07));
    g.strokeStyle = TURN_COL; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); g.moveTo(pt[0][0], pt[0][1]);
    for (iT = 1; iT <= nT; iT++) g.lineTo(pt[iT][0], pt[iT][1]);
    g.stroke();
    var e1 = pt[nT], e0 = pt[nT - 1], tl = Math.hypot(e1[0] - e0[0], e1[1] - e0[1]) || 1, tx = (e1[0] - e0[0]) / tl, ty = (e1[1] - e0[1]) / tl;   // 箭頭：沿弧的切線
    g.beginPath(); g.moveTo(e1[0] + tx * 6, e1[1] + ty * 6); g.lineTo(e1[0] - ty * 4.5, e1[1] + tx * 4.5); g.lineTo(e1[0] + ty * 4.5, e1[1] - tx * 4.5); g.closePath(); g.fill();
  }
  // 文字搬進詳細資訊（navText，TASK-0566：羅盤電腦版跟手機版一樣只剩圓盤）
}
/** 羅盤以前底下那幾行（TASK-0566 搬進詳細資訊的左欄）：航向與轉向、風（從哪吹來、節、相對位置、失速）、傾斜與縱傾。照那一艘自己的（不只我艦）。 */
function navText(sh) {
  var F = fwd(sh.yaw), Wd = norm(WIND), hb = bearing(F[0], F[2]), wb = bearing(-Wd[0], -Wd[2]), yr = sh.yawRate || 0;
  var roll = (sh.rollA + (sh.rollW || 0)) * 57.2958, pitch = (sh.pitchA + (sh.pitchW || 0)) * 57.2958;
  return '航向 ' + deg3(hb) + '（' + compassName(hb) + '）' + (Math.abs(yr) > 0.0035 ? '　<span style="color:' + TURN_COL + '">' + (yr > 0 ? '左' : '右') + '轉 ' + (Math.abs(yr) * 57.2958).toFixed(1) + '°/秒</span>' : '') + '<br>' +   // yawRate 正 ＝ 畫面上左轉（31_sailing.js fwd）
    '<span style="color:#8fd3ff">風 從 ' + deg3(wb) + '（' + compassName(wb) + '）' + windKnots().toFixed(0) + ' 節</span>' + (sh.irons > 0.05 ? '　<b style="color:#ff9a7a">失速' + (sh.irons < 0.95 ? ' ' + Math.round(sh.irons * 100) + '%' : '') + '</b>' : '') + '<br>' +
    '傾斜 ' + Math.abs(roll).toFixed(1) + '°' + (Math.abs(roll) < 0.2 ? '' : roll < 0 ? '（左低）' : '（右低）') + '　縱傾 ' + pitch.toFixed(1) + '°';
}
/** P 那顆按鈕：停格中寫「繼續」、平常寫「停格」（Tim 2026-10-14）。 */
function pauseLabel() { var b = $('pauseK'), s = '<b>' + keyName('pause') + '</b><i class="em">' + (PAUSED ? '▶' : '⏸') + '</i>'; if (b && b.innerHTML !== s) b.innerHTML = s; }   // 圖示（Tim 2026-10-15）：停格中 ⇒ ▶ 繼續
/** 彈種那一顆（Tim 2026-10-15：「砲彈改成一個按鈕，切換所有支援的砲彈（顯示當前彈種圖示）」）：鐵球 實心彈（CSS 畫的 .ball：灰色、左上高光、淡白邊；⛔ ⚫ 在深色圓鈕上看不見、⚪ 是白點不像砲彈 —— Tim 2026-10-15「顯示為一顆白色圓點，是否可以替換」）、💣 爆裂彈、⛓️ 鏈彈；每一種砲三種都能打。 */
var PSLOW_SHOW = 0.7;   // 物理減速放慢到 ×0.7 以下才在航速那一行顯示（Tim 2026-10-15：「高於 0.7 可以不顯示，目前頻繁閃爍」—— 以前 < 0.98 就顯示，倍率在 0.9 上下跳 ⇒ 一直閃）
var AMMO_ICON = ['<span class="ball"></span>', '💣', '⛓️', '🔥', '🏹', '☄️', '🪨'], AMMO_TXT = ['實心彈', '爆裂彈', '鏈彈', '希臘火', '弩箭', '火箭', '石彈'];   // 第 6、7 種：火箭（弩砲）、石彈（投石機）—— 10_ship.js AMMO_FIRE／AMMO_STONE   // 第 4 種希臘火（28_fire.js AMMO_GF）只給固定彈種的砲，不在換彈的輪流裡（ammoOf）
function ammoLabel() {
  var b = $('ammoB'); if (!b) return; var me = SHIPS[PLAYER_I], L = me ? ammoOf(me) : [0], a = ammoNow(); if (L.indexOf(a) < 0) a = L[0];   // 主武器打不出的那一種 ⇒ 顯示主武器的（持火號 ⇒ 希臘火）
  var fix = L.length === 1, s = '<b>' + keyName('ammo') + '</b><i class="em">' + (AUTOFIRE ? '🤖' : '') + (AMMO_ICON[a] || '?') + '</i>';   // 上面寫的是鍵（同其他圓鈕；66_keys.js），不是第幾種
  if (b.innerHTML !== s) { b.innerHTML = s; b.title = fix ? '主武器（' + GUNS[shipMainGun(me)].short + '）只打 ' + AMMO_TXT[a] + '：不能換彈' : AUTOFIRE ? '自動開砲：砲長照瞄準位置挑彈，現在 ' + AMMO_TXT[a] + '（關掉自動開砲才自己換）' : '切換彈藥：現在 ' + AMMO_TXT[a] + '（點一下或按 ' + keyName('ammo') + ' 換下一種）'; }
}
/** 自動開砲時砲長挑的彈（50_sim.js simAi 每一輪齊射寫；⛔ 不寫 AMMO_I：那是玩家自己選的、記在偏好裡）。 */
var AMMO_AUTO = 0;
/** 我艦現在用哪一種彈（按鍵開砲、彈種鈕都照它）：沒開自動開砲 ⇒ 玩家選的（AMMO_I）；開著 ⇒ 砲長照瞄準位置挑（Tim 2026-10-18）——
 *  玩家自己瞄的那一舷（點了船、或 Q 選了瞄準模式）照玩家的瞄準點挑，其他照砲長上一輪齊射挑的。 */
function ammoNow() {
  if (!AUTOFIRE) return AMMO_I;
  var me = SHIPS[PLAYER_I];
  if (me && handAim(me)) { var f = foeOf(me), on = me.pMode && me.pMode !== 'free' ? f : aimShip(me), t = me.pMode && me.pMode !== 'free' ? f && modeAim(f, me.pMode, false).t : me.aim; if (on && t) return gunnerAmmo(me, on, t); }
  return AMMO_AUTO;
}
/** 這艘船打得出哪幾種彈（AMMO 的序號，照輪流的順序）。Tim 2026-10-16：「目前彈種是固定的 不過可以保留擴充接口」⇒ 現在每艘都是全部；之後照船擴充（例 ships[].ammo）只改這裡。 */
function ammoOf(sh) { var m = sh && shipMainGun(sh); return m ? gunAmmoList(m) : AMMO.map(function (_, i) { return i; }); }   // 主武器打得出的（Tim 2026-10-18：「應該只有主武器能換彈種」；10_ship.js shipMainGun／gunAmmoList）
/** 換下一種彈（Tim 2026-10-16：「統一用一個鍵循環切換所有彈藥(不一定三種 之後可能根據船擴充)」）：鍵盤 1 與圓鈕共用；照我艦的 ammoOf 輪流，現在這一種不在清單裡 ⇒ 從第一種開始。 */
function ammoNext() {
  var L = ammoOf(SHIPS[PLAYER_I]); if (!L.length) return;
  if (L.length === 1) { note(SHIPS[PLAYER_I], '主武器（' + GUNS[shipMainGun(SHIPS[PLAYER_I])].short + '）只打 ' + AMMO_TXT[L[0]] + '：不能換彈'); return; }
  if (AUTOFIRE) { note(SHIPS[PLAYER_I], '自動開砲中：彈種由砲長照瞄準位置挑（' + keyName('autoFire') + ' 關掉自動開砲才自己換）'); return; }
  var i = L.indexOf(AMMO_I); AMMO_I = L[(i + 1) % L.length]; ammoLabel();
}
function hudFrame(dt) {
  stepMsgs(dt);
  if (ROOMS_DBG) roomLabels();                                                   // 空艙房的名字（36_rooms.js；?rooms=1）：每一格跟著鏡頭
  aimRingUi();                                                                   // 瞄準圈（UI 層）：每一格跟著鏡頭
  if (!SHIPS.length || (HUDN++ % 6)) return;
  var me = SHIPS[PLAYER_I];
  fleetHud(me);                                                                  // 上方：每艘一個圓形按鈕＋中間一艘的詳細資訊（TASK-0552）
  gunHud(me);                                                                   // 我艦的砲：兩舷貼左右兩邊、追擊砲與射界外警告在下方面板
  anchorChips(me);                                                              // 左右錨的按鈕：咬著亮、打壞灰掉（76_anchor.js）
  botFit();
  pauseLabel(); sailLabel(); hudIcons();
  var hs = hasSails(me); if (HUD_SAILS !== hs) { HUD_SAILS = hs; [].forEach.call(document.querySelectorAll('#helmL [data-k="w"], #helmL [data-k="s"]'), function (b) { b.style.display = hs ? '' : 'none'; }); }   // 沒有帆的船（維吉尼亞號）⇒ 收帆、加帆不顯示（TASK-0630）
  ammoLabel();
  // 瞄準模式＋鏡頭名稱：羅盤上方空心字（Tim 2026-10-14）；鏡頭名稱要常駐（Tim：拿掉之後看不出現在是哪個鏡頭）
  var cn = CAM.mode === 3 && CAM.see && SHIPS.indexOf(CAM.see) >= 0 ? '看' + CAM.see.name : CAM_NAMES[CAM.mode];   // 「🎥 看這艘」⇒ 寫那一艘的名字
  // 圖示（Tim 2026-10-15：「瞄準、鏡頭的文字顯示也改成 Icon，然後那邊是否可以額外顯示航速、船體 %、進水 %（一樣用 Icon）」）：第二行 ⛵ 航速（節，倒車 −）；船體 %、進水 % 改成羅盤外圈的兩圈（drawNav；Tim：「這樣就不用文字顯示」）
  var kn = me.spd * 1.944;
  // 航速後面接點風（順風／側順風／橫風／迎風／頂風，31_sailing.js pointName）—— Tim 2026-10-19「羅盤上多顯示 頂風 資訊」；以前只寫在詳細資訊的航速那一行（我艦那一行拿掉了）。沒有帆的船不寫
  var mt = $('modeT'), ms = '🎯 <b>' + (!handAim(me) ? '砲長' : (AUTOFIRE ? '手動一舷・' : '') + AIM_NAME[me.pMode || 'free']) + '</b>　🎥 <b>' + cn + '</b>' +
    (HUD_OUTARC ? '　<b style="color:#ff9a7a">⚠ 射界外</b>' : '') + (SIGNAL && MODE !== 'eve' ? '　🚩 <b>' + sigText() + '</b>' : '') + '<br>' +   // 玩家的旗號（TASK-0679；照指揮官 ⇒ 不寫）
    '⛵ <b>' + (kn < -0.05 ? '−' + (-kn).toFixed(1) : Math.max(0, kn).toFixed(1)) + '</b> 節' + (hasSails(me) && me.pos ? '（' + me.pos + '）' : '') + (hasSails(me) ? '　' + sailSetName(me) + ' ' + Math.round(me.sailFrac * 100) + '%' : '') + (me.cfg.base > 0 ? '　⚙ ' + TELE_NAME[me.tele] + driveCapText(me) : '') +   // 兩套控制（TASK-0630）：有帆才寫帆段、有額外動力才寫俥鐘
    (HELM_TQ && me.drive && me.drive.R ? '　<span title="舵效（舵輪 × 舵）">☸</span> ' + (me.drive.eff < 0.995 ? '<b style="color:#ffb27a">' + Math.round(me.drive.eff * 100) + '%</b>' : Math.round(me.drive.eff * 100) + '%') : '') +   // 舵效（TASK-0777；Tim 2026-10-21「船隻資訊要多一個舵效%」「羅盤上方資訊那邊」「可以直接用舵輪Icon(不用文字)」）
       // 帆 %（Tim 2026-10-15）：張著、還在的帆面積 × 血量（sailFrac，航速照它算）
    (RUNNING && SIM_SPEED !== 1 ? '　<b style="color:#9fd8ff">⏱ 模擬 ×' + (SIM_SPEED < 1 ? SIM_SPEED.toFixed(2) : SIM_SPEED.toFixed(1)) + '</b>' : '') +   // 設定的模擬速度（73_slowmo.js simSpeedSet）
    (RUNNING && PSLOW.on && PSLOW.ts < PSLOW_SHOW && !(SLOW.active && SLOW.ts < 0.98) ? '　<b style="color:#ffd27a">🐢 物理減速 ×' + PSLOW.ts.toFixed(2) + '</b>' : '');   // 物理減速的提示（Tim 2026-10-15：搬到航速這一行；73_slowmo.js）—— 殉爆的慢動作照舊在畫面中間   // 船體、進水改成羅盤外圈的兩圈（drawNav）；後面接帆裝（Tim 2026-10-15「羅盤上方航速資訊可以顯示當前帆狀態」：全收…滿帆，有額外動力的船多倒車、全速前進）
  ms += floodLine(me);
  if (mt && mt.innerHTML !== ms) mt.innerHTML = ms;
  var t = dbgOn() ? '格：' + SHIPS.map(function (s) { return s.grid.count; }).join('／') + '　四邊形：' + SHIPS.map(function (s) { return s.rs.quads(); }).join('／') + '　碎片 ' + D.n + '　粒子 ' + PT.n + '　脫落 ' + PIECES.length + (PHYS ? '　物理 ' + PHYS_MS.toFixed(2) + ' ms/步、垂繩 ' + SHIPS.map(function (s) { return s.loose.length; }).join('／') : '') + '　' + shadowDbgText() + '　' + FPS.toFixed(0) + ' fps' : '';
  $('tip').textContent = t;
  drawNav(me);
  chartDraw(me);                                                                 // 小地圖（海圖；63_chart.js，玩法規則 chart）
  teleDraw(me);                                                                  // 俥鐘（橫版左下角、直版左邊那一欄按鈕上方；31_drive.js teleDraw／teleFit）
  fpWhoHud();                                                                    // 第一人稱跟隨船員時的小標籤：職位＋工作效率（81_fps.js；TASK-0720）
}
/** 羅盤上方第三行：💧 艙內積水（噸）、🕳 破口（m²）—— Tim 2026-10-15：「羅盤上方資訊額外多一個積水、破口資訊」「假如沒有破口或積水則隱藏」。
 *  數字跟詳細資訊那一行同一份（sh.fl.vol × RHO_W、sh.fl.area；粒子模式才有）；兩個都沒有 ⇒ 整行不出現（沒有空行）、只有一個 ⇒ 只寫那一個。
 *  門檻：積水 < 1 噸、破口 < 0.05 m² 當作沒有（四捨五入會寫成 0）；沉了不寫（船卡已經寫沉沒）。 */
function floodLine(sh) {
  var f = sh && !sh.sunk && sh.fl; if (!f || (sh.broken && !f.vis)) return '';
  var t = Math.round((f.vol || 0) * RHO_W), a = f.area || 0, p = [];
  if (t >= 1) p.push('💧 <b>' + t.toLocaleString() + '</b> 噸積水');
  if (a >= 0.05) p.push('🕳 <b>' + a.toFixed(1) + '</b> m² 破口');
  return p.length ? '<br>' + p.join('　') : '';
}
// ───────────────────────── 結算判定（Tim 2026-10-15：「把整個結算判定規範化」） ─────────────────────────
// 三步，各管一件事：
//   ① 出局（模擬裡，每艘）：isOut（52_fleet.js）＝ 沉了（sunk）、開始沉（sinkingFinal：進水太多、殉爆斷船）或降旗（struck：strikeCheck 的規則、全員倒下、自爆）。
//      出局 ⇒ 換船（playerHandoff）、候補進場（reinforce）。⛔ 自爆不另外判：算降旗，照這一條走（Tim：「自爆不直接判輸 根據規則繼續換下一台候補(除非沒有船了)」）。
//   ② 分出勝負（checkEnd，每一步）：一方全部出局、候補也沒了（teamDown）⇒ 那一方輸、OVER（先看敵方 ⇒ 同一步兩邊都倒算贏，跟以前一樣）。
//   ③ 跳結算（照模擬時間：暫停不跳、殉爆慢動作跟著慢）：輸的那一方每艘都「定了」才開始倒數 ——
//      沒定 ＝ 還沒沉、而且（正在沉；或彈藥庫還在炸、彈坑還在挖；或殉爆後 END_SETTLE 秒內：水還在灌、可能開始沉）；最多等 END_MAX 秒。
//      定了 ⇒ 有沉的再 END_SINK 秒、都沒沉 END_OTHER 秒 ⇒ 跳（Tim 2026-10-13：讓玩家看完沉船；2026-10-15：自爆的結算等判定沉沒才跳、跟沉沒同一個時間點，但自爆不一定會沉）。
//      結算的文字在跳的那一刻才組（shipFate）：船怎麼收場要等定了才知道。
//   每艘的收場只在 shipFate 判：沉了 ⇒ 自爆後 SELF_WIN 秒內沉的「自爆沉沒」（Tim：「自爆標記一個Flag(紀錄時間點) 結算沉船時如果有該Flag且間隔不到1分鐘 算自爆沉」）、
//      殉爆斷船的「殉爆斷船沉沒」、其他「沉沒」；沒沉 ⇒ 出局那一刻記的那一句（sh.fate：降旗（…）、全員倒下、自爆…），開始沉的再加「沉沒中」。
//   只管結算畫面的時機與文字：OVER 在 ② 那一步定 ⇒ 戰局讀數不變；?demo、沙盒不跑。
var END_AT = 0, END_SINK = 5, END_OTHER = 5.5, END_MAX = 40, END_SETTLE = 10, END_WAIT = null, SELF_WIN = 60;
/** 這艘怎麼收場（結算畫面的那一句）。sh.selfAt：按自爆的模擬時間（23_powder.js selfDestruct）；sh.sunkAt：沉沒的那一刻（32_hull.js）。 */
function shipFate(sh) {
  if (sh.sunk) return sh.selfAt !== undefined && sh.sunkAt - sh.selfAt < SELF_WIN ? '自爆沉沒' : sh.broken ? '殉爆斷船沉沒' : sh.vxEaten ? '捲進漩渦沉沒' : '沉沒';
  if (sh.sinkingFinal) return (sh.fate ? sh.fate + '、' : '') + '沉沒中';
  return sh.fate || '出局';
}
/** 這艘的收場定了沒（③）：沉了 ⇒ 定了；正在沉、彈藥庫還在炸（SELFB、BLASTS）、殉爆後 END_SETTLE 秒內（sh.boomAt，23_powder.js magBoom、blastNear）⇒ 還沒。 */
function shipSettled(sh) {
  if (sh.sunk) return true;
  if (sh.sinkingFinal) return false;
  if (SELFB.some(function (e) { return e.sh === sh; }) || BLASTS.some(function (j) { return j.sh === sh; })) return false;
  return sh.boomAt === undefined || SIMT - sh.boomAt >= END_SETTLE;
}
function checkEnd() {
  if (!modeRule('judge') || DEMO >= 0 || LAB_FLEET) return;   // 擬真沙盒自己判（84_fleetlab.js）   // 玩法規則 judge（04_modes.js）：沙盒、建造不判勝負
  if (OVER) {                                                         // ③：等輸的那一方定了 ⇒ 倒數 ⇒ 跳
    var W = END_WAIT; if (!W) return;
    if (!W.at) { if (SIMT < W.limit && !W.lose.every(shipSettled)) return; W.at = SIMT + (W.lose.some(function (o) { return o.sunk; }) ? END_SINK : END_OTHER); }
    if (SIMT >= W.at) { END_WAIT = null; END_AT = 0; endShow(W); }
    return;
  }
  var mt = playerTeam(), ft = foeTeam(), win = teamShips(ft).length > 0 && teamDown(ft);   // ②
  if (!win && !teamDown(mt)) return;
  OVER = true;
  END_WAIT = { win: win, mt: mt, ft: ft, lose: teamShips(win ? ft : mt), limit: SIMT + END_MAX, at: 0 };
  END_AT = END_WAIT.limit;                                            // ≠ 0 ⇒ 50_sim.js 每一步照樣呼叫 checkEnd；重開／回選單時歸零（70_flow.js、71_input.js）
}
/** 亮出結算畫面：文字照現在每艘的收場組（一艘 ⇒ 那一句；多艘 ⇒ 全數沉沒（或沉沒或降旗）＋各種收場幾艘）。 */
function endShow(W) {
  var me = SHIPS[PLAYER_I], mine = teamShips(W.mt), foes = teamShips(W.ft);
  function who(L, one) {
    if (L.length === 1) return one + shipFate(L[0]);
    var c = {}; L.forEach(function (o) { var f = shipFate(o); c[f] = (c[f] || 0) + 1; });
    return one.replace('艦', '方') + ' ' + L.length + ' 艘全數' + (L.every(function (o) { return o.sunk; }) ? '沉沒' : '沉沒或降旗') + '（' + Object.keys(c).map(function (f) { return f + ' ' + c[f]; }).join('、') + '）';
  }
  function sum(L, k) { return L.reduce(function (a, o) { return a + o[k]; }, 0); }
  $('endT').textContent = W.win ? '勝利！' + who(foes, '敵艦') : '敗北……' + who(mine, '我艦');
  $('endS').innerHTML = '打掉的格數：我' + (mine.length > 1 ? '方 ' : '艦 ') + sum(mine, 'lost').toLocaleString() + '　敵' + (foes.length > 1 ? '方 ' : '艦 ') + sum(foes, 'lost').toLocaleString() + '<br>開火／命中：' + me.fired + '／' + me.hits + '　經過 ' + SIMT.toFixed(0) + ' 秒' +
    '<br><span style="color:var(--dim)">' + strikeText() + '</span>';
  $('end').className = 'on';
}

