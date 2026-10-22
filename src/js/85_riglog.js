// ───────────────────────── 帆繩記錄（整局；Tim 2026-10-19） ─────────────────────────
// Tim：「沙盒模式(物理跟遊戲同步的) 可以加帆繩debug選項 可以記錄一整場遊戲中帆繩的狀態方便之後debug」
// 開關：網址 ?riglog=1／0，或設定面板「🪢 帆繩記錄」（存在這個瀏覽器，下一場開戰起記；開著時中途打開 ⇒ 從那一刻起記）。
//   跟 🧪 測試模式（83_testlog.js，記船員）同一個樣子，分開一份檔。任何玩法都能開；要看帆與繩的物理，帆繩物理要開著（沙盒、對戰電腦都一樣）。
// ⛔ 只讀不寫：不抽亂數、不改戰局 ⇒ 開著、關著戰局逐位元組相同。
// 記什麼（每艘一份）：
//   · 帆（每 RLOG_EVERY 秒，跟上一筆不一樣才記）：[秒, 血量 %, 狀態, 布, 還綁著幾點, 洞（藏起來的細格點）, 鼓得最遠（格）, 帆桁角度（毫弧度）]
//       狀態：up 張著／furled 收著／dead 掉了；布：live 模擬中／loose 掉了還掛著／gone 沒了／hidden 收起來／none 沒建（關物理、還沒開戰）。
//   · 繩（每 RLOG_EVERY 秒，有變才記）：[秒, 斷了幾條, 帆腳放開幾條, 垂下來幾條, 垂下來還釘著幾端, 懸空的幾端]
//   · 事件 [秒, 第幾艘, 種類, 內容]：
//       cut 斷繩（名字、斷點）／tcut 帆腳被打掉、繩放開（名字）／hit 帆掉血（名字、剩幾 %；同一個 0.5 秒裡幾發算一筆，那一下就打掉的只記 drop）／drop 帆掉了／torn 布第一次被撕／furl、unfurl 收帆、張帆；
//       float 懸空：垂下來的繩還釘著的那一端，離它靠的東西超過 RLOG_FLOAT 格（帆桁：轉回作品的角度比外框；其他模型：外框；格：附近有沒有實心格；母繩：到母繩的距離）
//         —— 內容：名字（從哪一條垂下來的）、哪一端、靠什麼、離多遠（格；靠格子的只看 3 格內有沒有實心格 ⇒ 記 4）、位置；同一端只記第一次。
//       floatStatic：沒斷的繩，有一端哪裡都不靠（10_ship.js ropesFloating；每 2 秒查一次，同一條只記第一次）。
// 看得到的地方：結束畫面「📊 報表」的「🪢 匯出帆繩記錄」（JSON）；__game.riglog()（?debug=1）。
var RLOG = null, RLOG_EVERY = 0.5, RLOG_FLOAT = 3, RLOG_MAX = 400000;      // RLOG_MAX：帆與繩的列數上限（超過 ⇒ 停記這兩種、事件照記，標 trunc）
var RLOG_KEY = 'blockside_riglog';
function rlgWanted() { if (Q.get('riglog') === '1') return true; if (Q.get('riglog') === '0') return false; if (!DEBUG) return false; try { return window.localStorage.getItem(RLOG_KEY) === '1'; } catch (e) { return false; } }
function rlgReset() { RLOG = rlgWanted() ? { v: 1, seed: SEED, from: +SIMT.toFixed(1), every: RLOG_EVERY, phys: PHYS, ships: [], ev: [], n: 0, trunc: false, seen: new WeakMap(), next: 0 } : null; }
/** 設定面板的開關（同 83_testlog.js tlgToggle）：存在這個瀏覽器；網址帶了 ?riglog ⇒ 網址說了算，按鈕只管這一場暫停／繼續。 */
function rlgToggle() {
  if (Q.has('riglog')) { if (RLOG) { if (RLOG.off === undefined) RLOG.off = +SIMT.toFixed(1); else { RLOG.ev.push([+SIMT.toFixed(1), -1, 'resume', RLOG.off]); delete RLOG.off; } } }
  else {
    var on = !rlgWanted(); try { window.localStorage.setItem(RLOG_KEY, on ? '1' : '0'); } catch (e) { }
    if (on && (!RLOG || RLOG.off !== undefined)) { if (RLOG) { RLOG.ev.push([+SIMT.toFixed(1), -1, 'resume', RLOG.off]); delete RLOG.off; } else rlgReset(); } else if (!on && RLOG && RLOG.off === undefined) RLOG.off = +SIMT.toFixed(1);
  }
  if (typeof gsetShow === 'function') gsetShow();
}
function rlgNote() {
  var s = RLOG ? (RLOG.off === undefined ? '記錄中' : '暫停（' + RLOG.off + ' 秒起）') + '：' + RLOG.n + ' 列、' + RLOG.ev.length + ' 筆事件；結束畫面「📊 報表」匯出' : rlgWanted() ? '下一場開戰起記' : '';
  return s + (Q.has('riglog') ? '（網址 ?riglog=' + Q.get('riglog') + ' 決定開不開，按鈕只管這一場暫停／繼續）' : '');
}
/** 這艘的那一份（第一次看到才建：帆的名字、繩的名字表）。 */
function rlgShip(sh) {
  var r = RLOG.ships[sh.i];
  if (!r || r.ship !== sh) {
    r = RLOG.ships[sh.i] = { ship: sh, i: sh.i, name: sh.name, team: sh.team, hull: sh.T.id, from: +SIMT.toFixed(1), phys: PHYS,
      sails: sh.sails.map(function (s) { return { name: s.name, rows: [], last: null, hp: s.hp, dead: s.dead, furled: s.furled, torn: false }; }),
      ropes: { rows: [], last: null }, dead: sh.ropes.map(function (rp) { return !!rp.dead; }), tcut: {}, fs: {} };
  }
  return r;
}
function rlgEv(sh, kind, data) { RLOG.ev.push([+SIMT.toFixed(2), sh.i, kind, data]); }
/** 一面帆這一刻：[秒, 血量 %, 狀態, 布, 還綁著幾點, 洞, 鼓得最遠, 帆桁角度 mrad]（秒另外加）。 */
function rlgSail(sh, s, k) {
  var c = sh.cl && sh.cl[k], cs = !c || !c.p ? 'none' : c.gone ? 'gone' : c.loose ? 'loose' : c.hidden ? 'hidden' : 'live', holes = 0, mv = 0, j;
  if (c && c.p && c.torn && c.tv) for (j = 0; j < c.tv.length; j++) if (c.tv[j]) holes++;
  if (cs === 'live' || cs === 'loose') { var P0 = c.T.sim.p0, p = c.p; for (j = 0; j < c.T.sim.n * 3; j += 3) { var d = Math.hypot(p[j] - P0[j], p[j + 1] - P0[j + 1], p[j + 2] - P0[j + 2]); if (d > mv) mv = d; } }
  var y0 = s.yards && s.yards[0];
  return [Math.round(Math.max(0, s.hp) / (s.hpMax || 1) * 100), s.dead ? 'dead' : s.furled ? 'furled' : 'up', cs, c && c.npin >= 0 ? c.npin : null, holes, Math.round(mv), y0 ? Math.round((y0.rot || 0) * 1000) : null];
}
/** 垂下來的繩還釘著的一端，離它靠的東西幾格（看不出來 ⇒ null）。 */
function rlgOff(sh, o, e) {
  var pi = e ? o.n - 1 : 0, P = [o.p[pi * 3], o.p[pi * 3 + 1], o.p[pi * 3 + 2]], k = o.hk[e], v = o.hv[e];
  function bbD(Q, b) { return Math.hypot(Math.max(b[0] - Q[0], 0, Q[0] - b[3]), Math.max(b[1] - Q[1], 0, Q[1] - b[4]), Math.max(b[2] - Q[2], 0, Q[2] - b[5])); }
  if (k === 4) { var m = sh.models[v]; if (!m || !m.bb) return null; return bbD(m.kind === 'yard' && m.piv && m.rot ? rotZ(P, m.piv, -m.rot) : P, m.bb); }
  if (k === 1) return gridTouch(sh.grid, P, RLOG_FLOAT) ? 0 : RLOG_FLOAT + 1;
  if (k === 2) { var q = sh.ropes[v].pts, bd = 1e18; for (var j = 0; j + 5 < q.length; j += 3) bd = Math.min(bd, segDist2(P, q[j], q[j + 1], q[j + 2], q[j + 3], q[j + 4], q[j + 5])); return Math.sqrt(bd); }
  return null;
}
var RLOG_KIND = { 1: 'grid', 2: 'rope', 4: 'model' };
function rlgTick() {
  if (!RLOG || RLOG.off !== undefined || !SHIPS.length || SIMT + 1e-6 < RLOG.next) return;
  RLOG.next = SIMT + RLOG.every;
  var t = +SIMT.toFixed(2), full = RLOG.n >= RLOG_MAX, stat = Math.round(SIMT / RLOG.every) % 4 === 0;
  if (full && !RLOG.trunc) { RLOG.trunc = true; RLOG.ev.push([t, -1, 'trunc', RLOG.n]); }
  SHIPS.forEach(function (sh) {
    var R = rlgShip(sh);
    sh.sails.forEach(function (s, k) {
      var S = R.sails[k], c = sh.cl && sh.cl[k];
      if (s.hp < S.hp - 1e-6) rlgEv(sh, 'hit', [s.name, Math.round(Math.max(0, s.hp) / (s.hpMax || 1) * 100)]); S.hp = s.hp;
      if (s.dead && !S.dead) rlgEv(sh, 'drop', s.name); S.dead = s.dead;
      if (s.furled !== S.furled) { rlgEv(sh, s.furled ? 'furl' : 'unfurl', s.name); S.furled = s.furled; }
      if (c && c.torn && !S.torn) { rlgEv(sh, 'torn', s.name); S.torn = true; } else if (c && !c.torn && S.torn) S.torn = false;   // 帆匠換新帆布 ⇒ 再被撕會再記
      if (full) return;
      var row = rlgSail(sh, s, k), key = row.join(',');
      if (key !== S.last) { S.last = key; row.unshift(t); S.rows.push(row); RLOG.n++; }
    });
    var nd = 0, nt = 0, pinned = 0, fl = 0;
    sh.ropes.forEach(function (rp, j) {
      if (rp.dead) { nd++; if (!R.dead[j]) { R.dead[j] = true; rlgEv(sh, 'cut', [rp.name, rp.cutL ? rp.cutL.map(Math.round) : null]); } } else R.dead[j] = false;
      var tc = !!(sh.tCut && sh.tCut[j]); if (tc) { nt++; if (!R.tcut[j]) { R.tcut[j] = 1; rlgEv(sh, 'tcut', rp.name); } } else delete R.tcut[j];
    });
    (sh.loose || []).forEach(function (o) {
      for (var e = 0; e < 2; e++) {
        if (!o.pin[e ? o.n - 1 : 0]) continue; pinned++;
        var d = rlgOff(sh, o, e); if (d === null || d <= RLOG_FLOAT) continue; fl++;
        var seen = RLOG.seen.get(o) || 0; if (seen & (1 << e)) continue; RLOG.seen.set(o, seen | (1 << e));
        var pi = e ? o.n - 1 : 0; rlgEv(sh, 'float', [o.of ? o.of.name : null, e, RLOG_KIND[o.hk[e]] || o.hk[e], Math.round(d * 10) / 10, [Math.round(o.p[pi * 3]), Math.round(o.p[pi * 3 + 1]), Math.round(o.p[pi * 3 + 2])]]);
      }
    });
    if (stat) ropesFloating(sh).forEach(function (f) { if (R.fs[f.j]) return; R.fs[f.j] = 1; rlgEv(sh, 'floatStatic', [f.name, f.end, f.why, f.P]); });
    if (!full) { var rr = [nd, nt, (sh.loose || []).length, pinned, fl], rk = rr.join(','); if (rk !== R.ropes.last) { R.ropes.last = rk; rr.unshift(t); R.ropes.rows.push(rr); RLOG.n++; } }
  });
}
/** 整份（匯出、__game.riglog 都讀這一份）。 */
function rlgData() {
  if (!RLOG) return null;
  return { v: RLOG.v, seed: RLOG.seed, from: RLOG.from, to: +SIMT.toFixed(1), every: RLOG.every, phys: RLOG.phys, trunc: RLOG.trunc, n: RLOG.n, floatAt: RLOG_FLOAT,
    sailCols: ['t', 'hp%', 'state', 'cloth', 'pins', 'holes', 'billow', 'yardMrad'], ropeCols: ['t', 'dead', 'tcut', 'loose', 'pinnedEnds', 'floatEnds'], evCols: ['t', 'ship', 'kind', 'data'],
    ships: RLOG.ships.filter(Boolean).map(function (r) { return { i: r.i, name: r.name, team: r.team, hull: r.hull, from: r.from, phys: r.phys, sails: r.sails.map(function (S) { return { name: S.name, rows: S.rows }; }), ropes: r.ropes.rows }; }),
    ev: RLOG.ev };
}
function rlgSave() {
  var d = rlgData(); if (!d) { alert('沒有帆繩記錄：設定面板打開「🪢 帆繩記錄」（或網址 ?riglog=1），下一場開戰起記'); return; }
  var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d)], { type: 'application/json' }));
  a.download = 'blockside-riglog-seed' + SEED + '-' + Math.round(SIMT) + 's.json'; document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
$('rigT').onclick = rlgToggle;
if (!DEBUG) $('rigT').closest('.gsR').style.display = 'none';   // 設定面板只在 ?debug=1 顯示（Tim 2026-10-20）；沒開 debug ⇒ 存過的開關也不算（上面 rlgWanted），網址 ?riglog=1 照舊
evOn('stepEnd', rlgTick, 2);
