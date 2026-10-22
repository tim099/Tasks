// ───────────────────────── 艦隊指揮官 AI ②：對戰中往前推演（TASK-0688） ─────────────────────────
// Tim 2026-10-17：「對戰中往前推演 這個可以用精簡版本邏輯(類似下棋) 可以只考慮風速 船隻帆的狀況 等因素 用較粗的時間刻度(3秒一步? 可以抽成參數調整測試)
//   跑幾步去預測策略 不追求完全對齊(現實海戰指揮官有的資訊更少)」
// 策略「推演」（CMD_STRATS 的 'auto'）：每 ROLL_EVERY 秒把候選策略（ROLL_CANDS）各往前推 ROLL_N 步（一步 ROLL_DT 秒），挑推到最後「我方剩的戰力 − 敵方剩的戰力」最大的那個。
// ⛔ 這一檔跟 53_commander.js 一樣是純邏輯：只讀局勢 view、不碰遊戲的全域變數 ⇒ 遊戲與 2D 沙盒載入同一份。不抽亂數：每一發照命中率取期望值（⇒ 同一局重跑逐位元相同）。
// 精簡模型（沒有格子、砲彈、帆與繩的物理、進水；數字照 2D 沙盒 sb_sim.js 從遊戲量的那組）：
//   航行：航速 ＝ 滿帆側風航速（view 的 vs）× 帆剩多少 × 風向係數（＝ 31_sailing.js POLAR，逆風壓縮照 up），額外動力 vb 照 √(帆² ＋ 動力²) 合成；加減速時間常數 20 秒；
//         轉向率 ＝ max(0.03, 0.012 ＋ 0.016 × 航速 ÷ 航速倍率) × 舵效（ag）（＝ 31_sailing.js，天氣、錨不抄）。
//   操舵：交戰 ＝ 31_sailing.js 的交戰操舵（敵艦擺在有砲的那一舷、照距離往內切或往外拉）；戰列跟隨 ＝ cmdHelmLine（跟前一艘的船尾，⛔ 遊戲照排頭航跡，這裡粗）；
//         排頭 ＝ 交戰、舷照命令；搶上風 ＝ 迎風 65° 往命令的那一側；船頭／船尾武器的船 ＝ 船頭對準目標。不讓船、不擦撞。
//   開砲：兩舷各自，敵艦落在那一舷正橫 ± ROLL_ARC（加對方半個船長）、ROLL_RMAX 以內 ⇒ 每秒 砲數 × 人 × ROLL_SHOT 發、照距離的命中率；
//         每中一發：船殼 1 ÷（ROLL_HULL ×（排水量 ÷ 2154）^0.7）、人 ROLL_CREW 人、朝它那一舷的砲 ROLL_GUN 門、帆 ROLL_CLOTH × 帆^4。
//   敵方：指揮官不知道對方的策略 ⇒ 假設每艘打離自己最近的（'free'）。
// 預算：每次決策最多推 ROLL_BUDGET「船‧步」（候選數 × 步數 × 艘數）；超過就把步數等比縮短。⛔ 不照毫秒截斷 —— 機器快慢會讓同一局重跑挑出不同的策略；毫秒只量來報。
var ROLL_DT = 3, ROLL_N = 30, ROLL_EVERY = 30, ROLL_MARGIN = 0.02, ROLL_BUDGET = 3000;   // 一步幾秒、推幾步、幾秒重推一次、換策略要好過現在的幾分（每艘戰力差）、預算（船‧步）
var ROLL_CANDS = ['pair', 'focus', 'line'], ROLL_FOE = 'free';                 // ROLL_FOE：假設敵方用哪個策略（指揮官不知道對方的）
var ROLL_POLAR = [[0, 0.72], [45, 1], [90, 0.92], [112, 0.6], [125, 0.32], [180, 0.25]];   // ＝ 31_sailing.js POLAR
var ROLL_SHOT = 1 / 8.3;                                                 // 一門砲每秒幾發（滿員）：裝填 7 × 0.87 ＋ 電腦兩輪之間等 2.25 秒（sb_sim.js SB_CAL）
var ROLL_HIT = [[100, 0.60], [150, 0.50], [200, 0.51], [300, 0.41], [400, 0.38], [600, 0.35], [800, 0.33], [1000, 0.2]];   // ＝ sb_sim.js SB_CAL.hit
var ROLL_HULL = 900, ROLL_CREW = 0.35, ROLL_GUN = 0.116, ROLL_CLOTH = 0.0067, ROLL_ARC = 0.45, ROLL_RMAX = 1000;   // ROLL_CLOTH ＝ 0.4 × 0.05 ÷ 3 根桅（sb_sim.js sbRig 的期望值）

function rollPolar(deg) { var P = ROLL_POLAR; for (var i = 1; i < P.length; i++) if (deg <= P[i][0]) { var a = P[i - 1], b = P[i]; return a[1] + (b[1] - a[1]) * (deg - a[0]) / (b[0] - a[0]); } return P[P.length - 1][1]; }
function rollHitD(d) { var H = ROLL_HIT; if (d <= H[0][0]) return H[0][1]; for (var i = 1; i < H.length; i++) if (d <= H[i][0]) { var a = H[i - 1], b = H[i]; return a[1] + (b[1] - a[1]) * (d - a[0]) / (b[0] - a[0]); } return 0; }
function rollWrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
function rollClamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/** 局勢裡的一艘 ⇒ 推演用的船。view 沒給的欄位（2D 沙盒、舊的 view）⇒ 照憲法號估。 */
function rollShip(s) {
  var gT = s.gT || 54, g = s.guns === undefined ? 1 : s.guns;
  return { id: s.id, team: s.team, x: s.x, z: s.z, yaw: s.yaw, spd: Math.max(0, s.spd || 0), hp: s.hp === undefined ? 1 : s.hp, crew: s.crew === undefined ? 1 : s.crew,
    gP: s.gP !== undefined ? s.gP : gT * g / 2, gS: s.gS !== undefined ? s.gS : gT * g / 2, gT: gT, nc: s.nc || 313, sail: s.sail === undefined ? 1 : s.sail,
    vs: s.vs || 3.6, vb: s.vb || 0, up: s.up || 1, ag: s.ag || 1, spk: s.spk || 1, mass: s.mass || 2154, len: s.len || 55.5, out: !!s.out, cmd: s.cmd !== false, asp: s.asp || 'side', side: 'S' };
}
function rollGuns(r) { return r.gT ? rollClamp((r.gP + r.gS) / r.gT, 0, 1) : 0; }
function rollView(t, W, side, R, gauge, tune, S) {
  return { t: t, side: side, wind: W, R: R, gauge: gauge, tune: tune, ships: S.map(function (r) {
    return { id: r.id, team: r.team, x: r.x, z: r.z, yaw: r.yaw, spd: r.spd, hp: Math.max(0, r.hp), guns: rollGuns(r), crew: Math.max(0, r.crew), mass: r.mass, len: r.len, out: r.out, cmd: true, tgt: r.foe ? r.foe.id : null, asp: r.asp };
  }) };
}
/** 這一方剩的戰力加總（cmdStrength 同一把尺）。 */
function rollPow(S, team) { var p = 0; S.forEach(function (r) { if (r.team === team && !r.out) p += 0.5 * Math.max(0, r.hp) + 0.3 * rollGuns(r) + 0.2 * Math.max(0, r.crew); }); return p; }
/** 分數（side 那一方看）：(我方剩的戰力 − 敵方剩的戰力) ÷ 兩方開局艘數較多的那邊。 */
function rollScore(S, side, n) { return (rollPow(S, side) - rollPow(S, side === 'blue' ? 'red' : 'blue')) / (n || 1); }
function rollViewScore(view) {
  var n = { blue: 0, red: 0 }, S = view.ships.map(rollShip); S.forEach(function (r) { n[r.team]++; });
  return rollScore(S, view.side, Math.max(n.blue, n.red));
}

/** 替 view.side 那一方，用策略 strat 往前推 steps 步 ⇒ 分數。mem0：這一方現在的記憶（只拿搶上風的進度與覆寫，其他的照新策略重來）。 */
function rollRun(view, strat, mem0, steps) {
  var side = view.side, W = view.wind, R = view.R || 150, dt = ROLL_DT;
  var S = view.ships.map(rollShip), byId = {}, n = { blue: 0, red: 0 };
  S.forEach(function (r) { byId[r.id] = r; n[r.team]++; });
  var mem = { tn: mem0 && mem0.tn || null }, foeMem = {};
  if (mem0 && mem0.gauge) mem.gauge = JSON.parse(JSON.stringify(mem0.gauge));
  if (mem0 && mem0.side) mem.side = mem0.side;
  for (var k = 0; k < steps; k++) {
    var t = view.t + k * dt, live = S.filter(function (r) { return !r.out; });
    if (!live.some(function (r) { return r.team === 'blue'; }) || !live.some(function (r) { return r.team === 'red'; })) break;
    var od = cmdThink(rollView(t, W, side, R, view.gauge, view.tune, S), strat, mem);
    var oe = cmdThink(rollView(t, W, side === 'blue' ? 'red' : 'blue', R, false, null, S), ROLL_FOE, foeMem);
    for (var q in oe) od[q] = oe[q];
    live.forEach(function (r) {                                            // 目標：命令的（還在打的敵艦）；不然最近的（＝ 52_fleet.js pickFoes）
      var o = od[r.id], f = o && o.target !== null && o.target !== undefined ? byId[o.target] : null;
      if (!f || f.out || f.team === r.team) { f = null; var bd = 1e18; live.forEach(function (e) { if (e.team === r.team) return; var d = Math.hypot(e.x - r.x, e.z - r.z); if (d < bd) { bd = d; f = e; } }); }
      r.foe = f;
    });
    live.forEach(function (r) { rollMove(r, od[r.id], byId, W, R, dt); });
    var dmg = [];
    live.forEach(function (r) { rollFire(r, live, dt, dmg); });
    dmg.forEach(function (h) { rollTake(h.tgt, h.from, h.n); });
    S.forEach(function (r) { if (!r.out && (r.hp <= 0 || r.crew <= 0)) r.out = true; });
  }
  return rollScore(S, side, Math.max(n.blue, n.red));
}
function rollMove(r, o, byId, W, R, dt) {
  var f = r.foe, tY = r.yaw, thr = o && o.throttle !== undefined ? o.throttle : 1;
  if (o && o.mode === 'line' && byId[o.leader] && !byId[o.leader].out) { var hl = cmdHelmLine(r, byId[o.leader]); tY = hl.yaw; thr = hl.throttle; }
  else if (o && o.mode === 'gauge') {                                   // 迎風 65° 往 tack 那一側（tack ＋ ＝ 風吹去的方向往左轉 90° 那一側；＝ 53_commander.js cmdGauge）
    var ux = -W[0], uz = -W[1], lx = -W[1], lz = W[0], c = Math.cos(65 / 57.2958), s = Math.sin(65 / 57.2958) * (o.tack || 1);
    tY = Math.atan2(-(c * uz + s * lz), c * ux + s * lx);
  }
  else if (f) {
    var dx = f.x - r.x, dz = f.z - r.z, d = Math.hypot(dx, dz) || 1;
    if (r.asp === 'B' || r.asp === 'A') tY = Math.atan2(-dz, dx) + (r.asp === 'A' ? Math.PI : 0);   // 船頭（船尾）的武器 ⇒ 船頭（船尾）對準
    else {                                                                 // ＝ 31_sailing.js 交戰操舵（sb_sim.js sbSail 抄的那一段）
      var k = (dx * Math.sin(r.yaw) + dz * Math.cos(r.yaw)) / d;
      if (o && o.mode === 'lead' && o.side) r.side = o.side; else if (k > 0.2) r.side = 'S'; else if (k < -0.2) r.side = 'P';
      var other = r.side === 'S' ? 'P' : 'S', have = r.side === 'S' ? r.gS : r.gP, alt = r.side === 'S' ? r.gP : r.gS;
      var present = have > 0 || !(alt > 0) ? r.side : other, sg = present === 'P' ? 1 : -1;
      tY = (sg > 0 ? Math.atan2(-dx / d, -dz / d) : Math.atan2(dx / d, dz / d)) + sg * rollClamp((d - R) / R * 1.5, -0.4, 1.2);
    }
    if (o && o.mode === 'lead' && o.pace) thr = Math.min(thr, o.pace);
  }
  var rmax = Math.max(0.03, 0.012 + 0.016 * r.spd / r.spk) * r.ag, dy = rollClamp(rollWrap(tY - r.yaw), -rmax * dt, rmax * dt), y1 = r.yaw + dy;
  var F = [Math.cos(y1), -Math.sin(y1)], deg = Math.acos(rollClamp(F[0] * W[0] + F[1] * W[1], -1, 1)) * 57.2958, dU = r.up === 1 || deg <= 90 ? deg : 90 + (deg - 90) / r.up;
  var vS = r.vs * r.sail * rollPolar(dU), v = Math.hypot(vS, r.vb) * thr, s0 = r.spd;
  r.spd += (v - r.spd) * Math.min(1, dt / 20);
  var ym = r.yaw + dy / 2, sm = (s0 + r.spd) / 2;
  r.yaw = y1; r.x += Math.cos(ym) * sm * dt; r.z += -Math.sin(ym) * sm * dt;
}
function rollFire(r, live, dt, dmg) {
  ['P', 'S'].forEach(function (side) {
    var ng = side === 'S' ? r.gS : r.gP; if (!(ng > 0)) return;
    var nrm = side === 'S' ? [Math.sin(r.yaw), Math.cos(r.yaw)] : [-Math.sin(r.yaw), -Math.cos(r.yaw)], best = null, bs = 1e18, bd = 0;
    live.forEach(function (e) {
      if (e.team === r.team || e.out) return;
      var dx = e.x - r.x, dz = e.z - r.z, d = Math.hypot(dx, dz); if (d > ROLL_RMAX) return;
      if (Math.acos(rollClamp((dx * nrm[0] + dz * nrm[1]) / (d || 1), -1, 1)) > ROLL_ARC + Math.atan2(e.len / 2, d)) return;
      var sc = d * (e === r.foe ? 0.5 : 1); if (sc < bs) { bs = sc; best = e; bd = d; }
    });
    if (!best) return;
    var h = ng * Math.max(0.3, r.crew) * ROLL_SHOT * dt * rollHitD(bd) * Math.min(1, Math.pow(best.len / 55.5, 0.7));
    if (h > 0) dmg.push({ tgt: best, from: r, n: h });
  });
}
function rollTake(t, from, h) {
  t.hp -= h / (ROLL_HULL * Math.pow(t.mass / 2154, 0.7));
  t.crew = Math.max(0, t.crew - h * ROLL_CREW / t.nc);
  var ts = ((from.x - t.x) * Math.sin(t.yaw) + (from.z - t.z) * Math.cos(t.yaw)) > 0 ? 'S' : 'P';
  if (ts === 'S') t.gS = Math.max(0, t.gS - h * ROLL_GUN); else t.gP = Math.max(0, t.gP - h * ROLL_GUN);
  t.sail = Math.max(0, t.sail - h * ROLL_CLOTH * Math.pow(t.sail, 4));
}
function rollNow() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }

/** 策略「推演」：這一次要照哪個策略想（53_commander.js cmdThink 開頭叫）。進度記在 mem.roll（換策略時 cmdThink 留著它）：
 *  { t（上一次推的時間）, pick（挑中的）, sc（各候選的分數）, steps（推了幾步）, ms（花了幾毫秒，只報不用）, n（推了幾次）, said（報過了沒）,
 *    pred（挑中的那個預測：{ t0, t1, v（預測 t1 的分數）, v0（推的那一刻的分數）}）, errs（到期的預測 [t1, 預測, 實際]，最多 20 筆）} */
function rollStrat(view, mem) {
  var R = mem.roll;
  if (R && R.pred && view.t >= R.pred.t1 - 1e-6) {                       // 預測到期 ⇒ 記落差（只拿來參考，不影響挑選）
    var now = rollViewScore(view); R.errs.push([+R.pred.t1.toFixed(1), +R.pred.v.toFixed(3), +now.toFixed(3)]); if (R.errs.length > 20) R.errs.shift(); R.pred = null;
  }
  if (R && view.t - R.t < ROLL_EVERY - 1e-6) return R.pick;
  var nShip = view.ships.filter(function (s) { return !s.out; }).length || 1, steps = Math.max(1, Math.min(ROLL_N, Math.floor(ROLL_BUDGET / (ROLL_CANDS.length * nShip))));
  var t0 = rollNow(), sc = {}, best = null;
  ROLL_CANDS.forEach(function (c) { sc[c] = rollRun(view, c, mem, steps); if (best === null || sc[c] > sc[best] + 1e-9) best = c; });
  var pick = R && R.pick && sc[R.pick] !== undefined && sc[R.pick] >= sc[best] - ROLL_MARGIN ? R.pick : best;   // 現在的沒差到 ROLL_MARGIN ⇒ 不換（換策略會讓配對、戰列重來）
  var errs = R ? R.errs : [], prev = R ? R.pick : null;
  mem.roll = { t: view.t, pick: pick, prev: prev, sc: sc, steps: steps, ms: rollNow() - t0, n: (R ? R.n : 0) + 1, said: false, errs: errs,
    pred: R && R.pred ? R.pred : { t0: view.t, t1: view.t + steps * ROLL_DT, v: sc[pick], v0: rollViewScore(view) } };   // 上一個預測還沒到期 ⇒ 留著它（⛔ 每 30 秒重推就換一個新的 ⇒ 90 秒的預測永遠等不到期，落差一筆都量不到）
  return pick;
}
/** 推演那一次的理由（戰鬥報表、上方廣播用）。 */
function rollText(R) {
  var s = ROLL_CANDS.map(function (c) { return CMD_NAMES[c] + ' ' + (R.sc[c] >= 0 ? '+' : '') + R.sc[c].toFixed(3); }).join('／');
  var e = R.errs.length ? R.errs[R.errs.length - 1] : null;
  return '指揮官（推演 ' + Math.round(R.steps * ROLL_DT) + ' 秒）：' + s + ' ⇒ ' + CMD_NAMES[R.pick] + (R.prev && R.prev !== R.pick ? '（原本' + CMD_NAMES[R.prev] + '）' : '') +
    '，' + R.ms.toFixed(1) + ' ms' + (e ? '；上一次預測 ' + (e[1] >= 0 ? '+' : '') + e[1].toFixed(3) + '、實際 ' + (e[2] >= 0 ? '+' : '') + e[2].toFixed(3) : '');
}
