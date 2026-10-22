// ───────────────────────── 煙囪排煙（Tim 2026-10-15：維吉尼亞號、拿破崙號有煙囪，遊戲裡要冒煙）─────────────────────────
// 哪裡：雕刻作品裡煙囪的關聯（或外部模型）meta kind=funnel，固定點 smoke ＝ 排煙點（煙囪口的中心；造船規格 §9 kind 表）。
//   沒有 smoke ⇒ 從那個部件外框頂面的中心冒（匯入檢查報 ⚠）。
// 冒多少：額外動力在出力（全速前進、倒車：sh.power ≠ 0）⇒ 濃（每秒約 FN_ON 團）；停車（power 0）或沒有額外動力的船 ⇒ 淡（FN_IDLE）。
//   主機全壞（31_drive.js driveSurvey：sh.drive.C.fnOff）⇒ 每根都不冒；通這根的鍋爐全壞 ⇒ 這根不冒；額外動力一成都出不來（cap 0）⇒ 淡。
//   煙往上升、跟著風飄；煙囪口附近（排煙點水平 ±12 格、往下 6 格）的格子剩不到一半（煙囪被打斷）⇒ 不冒（每半秒數一次）；沉了、在沉 ⇒ 不冒。
// ⛔ 只給人看：自己一組亂數（不抽 rnd()）⇒ 戰局跟沒有煙囪一樣。物理設定「煙與水花」照樣少生幾顆（spawnPt）。
var FN_ON = 7, FN_IDLE = 1.5;
var RNG_FN = rngMake('funnel', 0x2F6B1D4D), rndFn = RNG_FN.f, rgFn = RNG_FN.r;   // 煙囪（00_core.js 亂數工廠；以前開局不重設 ⇒ 現在一起重設，只給人看）
/** 船型 T 的煙囪：[{ name, p: 排煙點（格座標）, pt: 有沒有登記 smoke }]（載入時算一次）。 */
function funnelsOf(T) {
  if (T.funnels) return T.funnels;
  var L = [];
  (T.h.parts || []).forEach(function (q) {
    if (!q.meta || q.meta.kind !== 'funnel') return;
    var s = q.points && q.points.smoke, b = q.box;
    L.push({ name: q.path, p: s ? s.slice() : [(b[0] + b[3] + 1) / 2, (b[1] + b[4] + 1) / 2, b[5] + 1], pt: !!s });   // 固定點已經是格心
  });
  (T.rig.models || []).forEach(function (m) {
    if (!m.meta || m.meta.kind !== 'funnel') return;
    var s = m.points && m.points.smoke, b = m.bbox;
    L.push({ name: m.name, p: s ? s.slice() : [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, b[5]], pt: !!s, model: m.name });
  });
  L.forEach(function (f) { if (!f.model) f.n0 = funnelCount(T.base, f.p); });
  return (T.funnels = L);
}
function funnelCount(G, p) {
  var x = Math.floor(p[0]), y = Math.floor(p[1]), z = Math.floor(p[2]), n = 0;
  for (var dz = -6; dz <= 0; dz++) for (var dy = -12; dy <= 12; dy++) for (var dx = -12; dx <= 12; dx++) if (G.get(x + dx, y + dy, z + dz)) n++;
  return n;
}
/** 每一步（50_sim.js，跟 stepPts 一起）：每艘還浮著的船、每根還在的煙囪照出力冒煙。 */
function funnelSmoke(dt) {
  SHIPS.forEach(function (sh) {
    var F = funnelsOf(sh.T); if (!F.length || sh.sunk || sh.sinkingFinal) return;
    var D = sh.drive, off = D && D.C && D.C.fnOff;
    var on = (+sh.cfg.base || 0) > 0 && (sh.power || 0) !== 0 && !(D && D.kind && D.cap <= 0), rate = (on ? FN_ON : FN_IDLE) * dt;
    var A = sh.fnAcc || (sh.fnAcc = F.map(function () { return 0; }));
    F.forEach(function (f, j) {
      if (off && off[j]) return;
      if (!funnelUp(sh, f, j)) return;
      A[j] += rate;
      while (A[j] >= 1) {
        A[j] -= 1;
        var w = M4.pt(sh.M, f.p[0], f.p[1], f.p[2]), g = on ? rgFn(0.14, 0.24) : rgFn(0.35, 0.5);
        var v = [sh.vel[0] * 0.3 + WIND[0] * 0.5 + rgFn(-0.6, 0.6), rgFn(2.2, 3.6), sh.vel[2] * 0.3 + WIND[2] * 0.5 + rgFn(-0.6, 0.6)];
        spawnPt([w[0] + rgFn(-0.3, 0.3), w[1] + 0.2, w[2] + rgFn(-0.3, 0.3)], v, rgFn(6, 9) / smokeK(), [g, g * 0.97, g * 0.94], on ? rgFn(0.45, 0.6) : rgFn(0.25, 0.35),
          rgFn(0.9, 1.3), rgFn(5, 8) * (on ? 1.2 : 0.8), -0.12, 0.35, 0);
      }
    });
  });
}
/** 煙囪還在嗎：煙囪口附近的格子還有原本的一半（每半秒數一次；⛔ 只看排煙點旁邊幾格：煙囪是空心的，口的正中間本來就沒有格子）。外部模型的煙囪 ⇒ 模型還在。 */
function funnelUp(sh, f, j) {
  if (f.model) { var m = sh.models.filter(function (q) { return q.path === f.model; })[0]; return !!(m && m.alive && !m.moved); }
  var U = sh.fnUp || (sh.fnUp = []);
  if (!U[j] || SIMT - U[j].t >= 0.5) U[j] = { t: SIMT, ok: f.n0 > 0 && funnelCount(sh.grid, f.p) * 2 >= f.n0 };
  return U[j].ok;
}
// 訂閱（TASK-0669：模擬層只發事件，00_events.js）
evOn('viewStep', funnelSmoke, 1, true);   // 碎木之後、粒子之前（自己的亂數 rndFn，不改戰局）
