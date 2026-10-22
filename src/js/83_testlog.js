// ───────────────────────── 測試模式：船員記錄（整局；Tim 2026-10-17） ─────────────────────────
// Tim：「重現水手走進主砲塔圓筒 這個是否可以加測試模式&專屬資訊Log 可以知道水手移動路徑等資訊(記錄一整局) 之後也可以用來排查其他Bug(測試模式可以是一個開關flag)」
// 開關：網址 ?test=1，或設定面板「🧪 測試模式」（存在這個瀏覽器，下一場開戰起記；開著時中途打開 ⇒ 從那一刻起記）。
// ⛔ 只讀不寫：不抽亂數、不改戰局 ⇒ 開著、關著戰局逐位元組相同（?dump=1 的 #dump 也一樣；記錄另外寫在 #crewlog）。
// 記什麼（每艘一份）：
//   · 走路格（每一層哪幾點走得到，畫底圖用）、會轉的裝甲掃過的那一圈（砲塔的牆）。
//   · 每個船員每 TLOG_EVERY 秒一點 [秒, x, y, z, 狀態, 職位]（動了 ≥ 0.3 格或狀態、職位變了才記）—— 路徑。
//   · 每個船員一個固定編號 id（第一次看到時給；游到敵艦換了名單也不變 ⇒ 不用名單上的第幾個）。
//   · 事件 [秒, 第幾艘, 船員 id, 種類, 內容]：
//       chg  欄位變了（職位、狀態、砲、甲板、舷、送藥手的階段與目標、預備水手的任務、爬哪座梯子、換砲走去哪）；
//       wall 身體落在牆裡（每一步查，不是每 0.5 秒：穿過 4 格厚的牆只要 0.2 秒）／wallOut 離開：ring ＝ 正在走路、小腿或胸口那格在砲塔那一圈裡、離外緣超過 1.2 格（站在會轉的甲板上的不算：那一圈本來就把他圍在裡面；
//         帶 ring ＝ 哪一座、from ＝ 上一個路徑點在圈裡 in（往外走：開放的砲房從背面走出來是正常的）／圈外 out（往裡走）／牆裡 band）、
//         hull ＝ 小腿和胸口兩格都是船殼（只碰一格多半是船底弧面、梁，不算）；
//       dead／wound（原因）、toHand（改當預備水手的理由）、void（點名的任務作廢）、fallIn（掉到下一層）。
// 看得到的地方：結束畫面「📊 報表」的「匯出船員記錄」（JSON）；__game.crewlog()（?debug=1）；?dump=1&test=1 的 #crewlog（src/tests/crew_log.py 讀它、畫成路徑圖）。
var TLOG = null, TLOG_EVERY = 0.5, TLOG_MAX = 600000;                    // TLOG_MAX：路徑點的上限（超過 ⇒ 停記路徑、事件照記，標 trunc）
var TLOG_KEY = 'blockside_testmode';
function tlgWanted() { if (Q.get('test') === '1') return true; if (Q.get('test') === '0') return false; if (!DEBUG) return false; try { return window.localStorage.getItem(TLOG_KEY) === '1'; } catch (e) { return false; } }
function tlgReset() { TLOG = tlgWanted() ? { v: 1, seed: SEED, from: +SIMT.toFixed(1), every: TLOG_EVERY, ships: [], ev: [], n: 0, ms: 0, trunc: false, ids: new WeakMap(), crew: [] } : null; }
/** 船員的固定編號與那一份（第一次看到才建；WeakMap ⇒ 不在船員物件上多掛欄位）。 */
function tlgCrew(sh, c) {
  var e = TLOG.ids.get(c);
  if (!e) { e = { id: TLOG.crew.length, ship0: sh.i, ship: sh.i, k0: sh.crew.indexOf(c), role0: c.role, art: c.art !== undefined ? c.art : null, tr: [], last: null, wall: null }; TLOG.ids.set(c, e); TLOG.crew.push(e); }
  return e;
}
/** 設定面板的開關：存在這個瀏覽器；打開 ⇒ 這一場從現在起記（下一場從開戰起），關掉 ⇒ 這一場停記（已記的還在、可以匯出）。
 *  網址帶了 ?test=1／0 ⇒ 網址說了算，按鈕只管這一場暫停／繼續（暫停的那段沒有路徑點）。 */
function tlgToggle() {
  if (Q.has('test')) { if (TLOG) { if (TLOG.off === undefined) TLOG.off = +SIMT.toFixed(1); else { TLOG.ev.push([+SIMT.toFixed(1), -1, -1, 'resume', TLOG.off]); delete TLOG.off; } } }
  else {
    var on = !tlgWanted(); try { window.localStorage.setItem(TLOG_KEY, on ? '1' : '0'); } catch (e) { }
    if (on && (!TLOG || TLOG.off !== undefined)) { if (TLOG) { TLOG.ev.push([+SIMT.toFixed(1), -1, -1, 'resume', TLOG.off]); delete TLOG.off; } else tlgReset(); } else if (!on && TLOG && TLOG.off === undefined) TLOG.off = +SIMT.toFixed(1);
  }
  if (typeof gsetShow === 'function') gsetShow();
}
/** 設定面板那一行的說明（71_input.js gsetShow）。 */
function tlgNote() {
  var s = TLOG ? (TLOG.off === undefined ? '記錄中' : '暫停（' + TLOG.off + ' 秒起）') + '：' + TLOG.n + ' 點、' + TLOG.ev.length + ' 筆事件；結束畫面「📊 報表」匯出' : tlgWanted() ? '下一場開戰起記' : '';
  return s + (Q.has('test') ? '（網址 ?test=' + Q.get('test') + ' 決定開不開，按鈕只管這一場暫停／繼續）' : '');
}
function tlgOnEv(sh, c, kind, data) {
  if (!TLOG || TLOG.off !== undefined || !sh) return;
  TLOG.ev.push([+SIMT.toFixed(1), sh.i, c ? tlgCrew(sh, c).id : -1, kind, data === undefined ? null : data]);
}
/** 第 i 艘的那一份（第一次用到才建：援軍半路進場也有）：走路格、砲塔那一圈只在這時候記一次。 */
function tlgShip(sh) {
  var r = TLOG.ships[sh.i];
  if (!r) r = TLOG.ships[sh.i] = { i: sh.i, id: sh.T.id, name: sh.T.name, team: sh.team, from: +SIMT.toFixed(1), size: sh.T.h.size, navC: NAV_C, levels: tlgLevels(sh), rings: tlgRings(sh) };
  return r;
}
function tlgLevels(sh) {
  if (!sh.nav) return [];
  return sh.nav.levels.map(function (L) {
    var N = L.N, s = '', run = 0, cur = 0;                               // 走得到的點：0／1 交替的連續長度（從 0 開始），逗號分隔
    for (var i = 0; i < N.nx * N.ny; i++) { var v = N.ok[i] ? 1 : 0; if (v === cur) run++; else { s += run + ','; run = 1; cur = v; } }
    s += run;
    var zs = []; for (i = 0; i < N.cells.length; i += 7) zs.push(N.Z[N.cells[i]]);
    return { key: L.key, name: L.name || L.key, zr: L.zr, x0: N.x0, nx: N.nx, ny: N.ny, ok: s, rot: !!N.rot, z: zs.length ? Math.round(zs.reduce(function (a, b) { return a + b; }, 0) / zs.length) : null };
  });
}
function tlgRings(sh) {
  return (sh.arm || []).filter(function (a) { return a.A && a.A.ring; }).map(function (a) { var R = a.A.ring; return { path: a.A.mount, c: R.c, z0: R.z0, z1: R.z1, rIn: +armRingIn(R, R.z0, R.z1 - R.z0 + 1).toFixed(1), r: +R.r.toFixed(1) }; });
}
/** 一個船員現在的樣子（跟上一次比 ⇒ chg 事件）。 */
function tlgSnap(c) {
  var P = c.pm, H = c.hand, W = c.walk, J = H && H.job;
  return { role: c.role, st: c.st, gun: c.gun ? c.gun.model.path : null, deck: c.deck || null, side: c.side || null,
    pm: P ? P.st + (P.g ? '→' + P.g.model.path : '') + (P.src && (P.st === 'fetch' || P.st === 'fill') ? '＠' + P.src.name : '') : null,
    job: J ? J.kind + (J.key ? ':' + J.key : '') + (J.reg !== undefined ? '#' + J.reg : '') : null,
    climb: H && H.climb ? (H.climb.L || '梯子') : null,
    walk: W ? W.to.map(function (v) { return Math.round(v); }).join(',') + (W.w && W.w.length > 1 ? '（繞 ' + (W.w.length - 1) + ' 點）' : '') : null };
}
var TLOG_F = ['role', 'st', 'gun', 'deck', 'side', 'pm', 'job', 'climb', 'walk'];
/** 站在會轉的甲板上嗎（走路格那一點是 N.rot）。 */
function tlgOnRot(sh, p) {
  if (!sh.nav) return false;
  var li = lvAt(sh, p), L = li >= 0 ? sh.nav.levels[li] : null; if (!L || !L.N.rot) return false;
  var i = navSnap(L.N, p, 1); return i >= 0 && !!L.N.rot[i];
}
/** 落在哪一圈裡、離外緣超過 1.2 格嗎（只擦到外緣的不算：速射砲房的放藥箱位置就在外緣上，量過 18.0–18.6 格、外緣 18.4）。 */
function tlgDeep(sh, p) {
  var hit = null;
  (sh.arm || []).forEach(function (a) { var R = a.A && a.A.ring; if (hit || !R || p[2] + 6 < R.z0 || p[2] + 2 > R.z1) return; if (Math.hypot(p[0] - R.c[0], p[1] - R.c[1]) < R.r - 1.2) hit = { path: a.A.mount, R: R }; });
  return hit;
}
/** 每一步：身體落在牆裡嗎（進去那一刻記一筆、多記一個路徑點；出來再記一筆）。 */
function tlgWall(sh) {
  var g = sh.arm ? navG(sh) : sh.grid, t = +SIMT.toFixed(2);
  sh.crew.forEach(function (c) {
    var e = tlgCrew(sh, c), p = c.pos, w = null, rg = null;
    if (c.st === 0 && p && !(c.hand && c.hand.climb)) {                // 爬梯子：本來就貼著艙口
      var x = Math.floor(p[0]), y = Math.floor(p[1]), z = Math.round(p[2]), h2 = sh.grid.get(x, y, z + 2), h6 = sh.grid.get(x, y, z + 6);
      if (h2 && h6) w = 'hull';
      else if (sh.arm && !h2 && !h6 && (c.walk || c.moving || (c.hand && c.hand.wp)) && (g.get(x, y, z + 2) || g.get(x, y, z + 6)) && !tlgOnRot(sh, p) && (rg = tlgDeep(sh, p))) w = 'ring';   // 只查正在走路的：砲房平台上跟著砲塔轉的砲班站位常不在走路格上，站著不動不算
    }
    if (w && !e.wall) {
      var ed = { what: w, at: [+p[0].toFixed(1), +p[1].toFixed(1), Math.round(p[2])] };
      if (rg) { var q = e.tr.length ? e.tr[e.tr.length - 1] : null, R = rg.R, rIn = armRingIn(R, Math.max(R.z0, Math.round(p[2]) + 2), 5), dq = q ? Math.hypot(q[1] - R.c[0], q[2] - R.c[1]) : null;   // 從哪一邊來：上一個路徑點在圈裡（in：往外走）、圈外（out：往裡走）、牆裡（band）
        ed.ring = rg.path; ed.from = dq === null ? null : dq < rIn ? 'in' : dq > R.r ? 'out' : 'band'; }
      e.wall = w; TLOG.ev.push([t, sh.i, e.id, 'wall', ed]);
      if (!TLOG.trunc && TLOG.n < TLOG_MAX) { e.tr.push([+SIMT.toFixed(1), +p[0].toFixed(1), +p[1].toFixed(1), Math.round(p[2]), c.st, c.role, sh.i]); TLOG.n++; } }
    else if (!w && e.wall) { TLOG.ev.push([t, sh.i, e.id, 'wallOut', null]); e.wall = null; }
  });
}
/** 每一步（50_sim.js 最後）：牆每一步查；路徑、欄位變化每 TLOG_EVERY 秒掃一次。 */
function tlgTick() {
  if (!TLOG || TLOG.off !== undefined) return;
  var tw = performance.now(); SHIPS.forEach(tlgWall); TLOG.ms += performance.now() - tw;
  var k = Math.round(SIMT / DT); if (k % Math.round(TLOG_EVERY / DT)) return;
  var t0 = performance.now(), t = +SIMT.toFixed(1);
  SHIPS.forEach(function (sh) {
    tlgShip(sh);
    sh.crew.forEach(function (c) {
      var e = tlgCrew(sh, c), j = e.id, s = tlgSnap(c), L = e.last;
      if (e.ship !== sh.i) { TLOG.ev.push([t, sh.i, j, 'ship', [e.ship, sh.i]]); e.ship = sh.i; }   // 游到敵艦、換了名單
      if (L) { var d = {}, any = false; TLOG_F.forEach(function (f) { if (L[f] !== s[f]) { d[f] = [L[f], s[f]]; any = true; } }); if (any) TLOG.ev.push([t, sh.i, j, 'chg', d]); }
      e.last = s;
      if (c.st === 3) return;                                            // 抬下去、沉了：不再記點
      var p = c.st === 4 || c.st === 5 ? null : c.pos; if (!p) return;  // 落體、在水裡（世界座標）不記路徑
      var q = e.tr.length ? e.tr[e.tr.length - 1] : null;
      if (!TLOG.trunc && (!q || q[6] !== sh.i || Math.hypot(p[0] - q[1], p[1] - q[2]) >= 0.3 || Math.abs(p[2] - q[3]) >= 1 || q[4] !== c.st || q[5] !== c.role)) {
        if (TLOG.n >= TLOG_MAX) TLOG.trunc = t; else { e.tr.push([t, +p[0].toFixed(1), +p[1].toFixed(1), Math.round(p[2]), c.st, c.role, sh.i]); TLOG.n++; }
      }
    });
  });
  TLOG.ms += performance.now() - t0;
}
/** 整份（#crewlog、匯出、__game.crewlog 都讀這一份）。 */
function tlgData() {
  if (!TLOG) return null;
  return { v: TLOG.v, seed: TLOG.seed, from: TLOG.from, off: TLOG.off === undefined ? null : TLOG.off, t: +SIMT.toFixed(1), every: TLOG.every, trunc: TLOG.trunc || null, cost: { points: TLOG.n, ms: +TLOG.ms.toFixed(1) },
    roles: ROLE_NAME, states: ['站著', '受傷', '陣亡', '抬下去', '落體', '在水裡'], fields: ['t', 'x', 'y', 'z', 'st', 'role', 'ship'],
    ships: TLOG.ships.filter(Boolean).map(function (r) { return { i: r.i, id: r.id, name: r.name, team: r.team, from: r.from, size: r.size, navC: r.navC, levels: r.levels, rings: r.rings }; }),
    crew: TLOG.crew.map(function (e) { return { id: e.id, ship0: e.ship0, ship: e.ship, k0: e.k0, role0: e.role0, art: e.art, tr: e.tr }; }),
    ev: TLOG.ev };
}
/** 匯出 JSON（⛔ 成品不准 fetch ⇒ 用 Blob 下載）。 */
function tlgSave() {
  var d = tlgData(); if (!d) return;
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(d)], { type: 'application/json' }));
  a.download = 'blockside-crewlog-seed' + SEED + '-' + Math.round(SIMT) + 's.json'; document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
$('testT').onclick = tlgToggle;
if (!DEBUG) $('testT').closest('.gsR').style.display = 'none';   // 設定面板只在 ?debug=1 顯示（Tim 2026-10-20）；沒開 debug ⇒ 存過的開關也不算（上面 tlgWanted），網址 ?test=1 照舊（src/tests/crew_log.py）
// 訂閱（TASK-0669：模擬層只發事件，00_events.js）
evOn('tlgEv', tlgOnEv); evOn('stepEnd', tlgTick, 1);
