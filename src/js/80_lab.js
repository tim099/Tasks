// ───────────────────────── 落水彈道的測試場（TASK-0642） ─────────────────────────
// Tim 2026-10-16：「目前難以測試 是否可以由你專門設置環境 由你測試」「可以記錄砲彈飛行軌跡」
// ?lab=uw（＋ ship=<靶船>,<另一艘>）⇒ 靶船（第一艘）停在水上先浮穩（沙盒、不開帆、不還手），另一艘移到遠處；
// 每一發從靶船正橫 R 公尺外、離海面 h0 公尺的砲口打，仰角照解析解算成「落在水線那一點前面 short 公尺的海上」；
// 一發一發只跑那一顆砲彈（船不動、海面停在同一刻 ⇒ 每一發的條件相同），每一小段記下軌跡。
// 跑完（floodS > 0）再照常走 floodS 秒看進水。結果寫進頁面上 id ＝ lab 的 pre（無頭 Chrome --dump-dom 讀：src/tests/uw_lab.py）；
// ?debug=1 時 __game.lab(o) 同一套，回傳同一份。
// ⛔ 只在 ?lab= 或 __game.lab 才跑；一般遊戲一行都不多算。
// 參數（網址同名）：guns（砲種 key，逗號分隔）、short（落在水線前幾公尺，逗號分隔）、ammo（0 實心、1 爆裂、2 鏈彈）、
//   R（距離 m，預設 400）、h0（砲口離海面 m，預設 3）、side（0 ＝ 格 +y 那一舷、1 ＝ −y）、flat（1 ＝ 浪設 0）、floodS（之後照常走幾秒，預設 30）、rec（軌跡每幾公尺記一點，預設 0.5）。
var LAB_SETTLE = 8;                                                    // 開打前先讓靶船浮穩幾秒（量過：reset 後 sink 從 0 起、約 5 秒內停）

/** 靶船那一欄、那一舷：最外面那一格的外表面上，最接近海面的那一點（世界座標）與它的格座標。 */
function labSkin(sh, x, side) {
  var B = sh.T.base, best = null;
  for (var z = 0; z < B.sz; z++) {
    var y0 = -1, y;
    if (side) { for (y = 0; y < sh.T.cy; y++) if (sh.grid.get(x, y, z)) { y0 = y; break; } }
    else { for (y = B.sy - 1; y > sh.T.cy; y--) if (sh.grid.get(x, y, z)) { y0 = y; break; } }
    if (y0 < 0) continue;
    var q = M4.pt(sh.M, x + 0.5, side ? y0 : y0 + 1, z + 0.5), d = Math.abs(q[1] - seaH(q[0], q[2], SIMT));
    if (!best || d < best.d) best = { d: d, q: q, z: z, y: y0 };
  }
  return best;
}

/** 從 h0 高、水平 D 公尺外落到海面（高 0）的低仰角（無空氣阻力，跟 stepBall 一樣）。打不到 ⇒ null。 */
function labElev(V, D, h0) {
  var a = G * D * D / (2 * V * V), disc = D * D - 4 * a * (a - h0);
  if (disc < 0) return null;
  return Math.atan((D - Math.sqrt(disc)) / (2 * a));
}

/** 打一發、記軌跡。回：落水點離船殼幾公尺、入水的速度與角度、在水裡走了多遠、打到船殼時在水面下多深、掉了幾格、鐵甲那一下（穿／凹／彈）、軌跡。 */
function uwLabShot(sh, x, side, gun, short, o) {
  var GS = GUNS[gun], sk = labSkin(sh, x, side); if (!GS || !sk) return { gun: gun, x: x, err: !GS ? '沒有這個砲種' : '這一欄沒有船殼' };
  var s = side ? -1 : 1, out = norm([sh.M[4] * s, 0, sh.M[6] * s]), Q = sk.q, sea = seaH(Q[0], Q[2], SIMT);   // 格 y 軸 ＝ M[4..6]（右舷）；水平往船外
  var D = o.R - short, th = labElev(GS.V, D, o.h0); if (th === null) return { gun: gun, x: x, short: short, err: '打不到這麼遠' };
  var p = [Q[0] + out[0] * o.R, sea + o.h0, Q[2] + out[2] * o.R], v = [-out[0] * GS.V * Math.cos(th), GS.V * Math.sin(th), -out[2] * GS.V * Math.cos(th)];
  var b = { p: p, v: v, owner: SHIPS.length > 1 ? 1 - sh.i : 0, ammo: o.ammo, trav: 0, alive: true, age: 0, bounced: false, big: GS.big, hole: GS.hole, dmg: GS.dmg || 0, m: GS.shot, dbg: [] };
  var n0 = sh.grid.count, A0 = JSON.stringify(sh.armRes || {}), tr = [], lastS = 1e9, r = { gun: gun, m: GS.shot, V: GS.V, x: x, z: sk.z, short: short, elev: +(th * 180 / Math.PI).toFixed(3) };
  function along(q) { return (q[0] - Q[0]) * out[0] + (q[2] - Q[2]) * out[2]; }   // 離水線那一點多遠（水平、往船外為正）
  var kMax = Math.ceil((o.R / (GS.V * Math.cos(th)) + 4) / (DT / 16));   // 飛到那裡的時間 ＋ 4 秒（水裡、彈開之後）
  for (var k = 0; k < kMax && b.alive; k++) {
    var wet0 = !!b.wet, hit0 = !!b.hitOnce, sp0 = len(b.v);
    stepBall(b, DT / 16);
    var a = along(b.p), y = b.p[1] - seaH(b.p[0], b.p[2], SIMT);
    if (!wet0 && b.wet) { r.entry = { at: +a.toFixed(2), v: +sp0.toFixed(1), deg: +(Math.asin(Math.max(-1, Math.min(1, -b.v[1] / Math.max(1e-6, len(b.v))))) * 180 / Math.PI).toFixed(2) }; tr.push([+a.toFixed(2), +y.toFixed(2), 1]); lastS = a; }
    if (b.bounced && !r.skip) r.skip = +a.toFixed(2);                 // 打水漂
    if (!hit0 && b.hitOnce) { r.hit = { at: +a.toFixed(2), depth: +(-y).toFixed(2), v: +sp0.toFixed(1), wet: !!b.wet }; tr.push([+a.toFixed(2), +y.toFixed(2), b.wet ? 1 : 0]); lastS = a; }
    if (Math.abs(lastS - a) >= o.rec || !b.alive) { tr.push([+a.toFixed(2), +y.toFixed(2), b.wet ? 1 : 0]); lastS = a; }
  }
  sh.rs.flush(); if (sh.arm) sh.arm.forEach(function (e) { e.rs.flush(); });
  var A1 = sh.armRes || {}, a0 = JSON.parse(A0);
  r.removed = n0 - sh.grid.count; r.res = ['pen', 'dent', 'rico', 'shell'].filter(function (k2) { return (A1[k2] || 0) > (a0[k2] || 0); }).join('+') || null;
  r.end = b.alive ? '還在飛' + (/rico/.test(r.res || '') ? '（彈開）' : '') : b.wet ? (r.hit ? '水下打進船殼' : '水裡停了') : r.hit ? '打進船殼' : '落水沒了';   // 沒打到又沒在水裡停 ⇒ 一落水就沒了（stepBall 沒設 wet 的那種）
  r.uw = r.entry ? +Math.max(0, r.entry.at - along(b.p)).toFixed(2) : 0;   // 在水裡走了幾公尺（水平）
  r.tr = tr; return r;
}

/** 整個測試場：o 見檔頭。回 { hull, settle, cases: […], flood }。 */
function uwLab(o) {
  o = Object.assign({ guns: ['dahl11', 'dahl9', 'brooke7', 'long32', 'long'], short: [0, 2, 4, 6, 8, 12, 16, 25], ammo: 0, R: 400, h0: 3, side: 0, flat: false, floodS: 30, rec: 0.5 }, o || {});
  var seaK = SEA_K; if (o.flat) SEA_K = 0;
  flowMode('sandbox'); reset(); AUTOFIRE = false; flowRun(false);
  var sh = SHIPS[0];
  SHIPS.forEach(function (s2) { s2.sailSet = 0; s2.power = 0; s2.manual = true; s2.rudder = 0; });
  if (SHIPS[1]) { SHIPS[1].px += 3000; SHIPS[1].pz += 3000; }        // 另一艘移遠（砲彈算它的、但飛不到）
  for (var i = 0; i < Math.round(LAB_SETTLE / DT); i++) simStep();
  sh.M = shipMatrix(sh); sh.inv = M4.inv(sh.M); sh.center = shipCenter(sh);
  var out = { hull: sh.T.id, seed: SEED, sea: SEA_K, settle: { t: LAB_SETTLE, sink: +sh.sink.toFixed(3), roll: +(sh.rollA * 57.3).toFixed(2), pitch: +(sh.pitchA * 57.3).toFixed(2) }, o: { R: o.R, h0: o.h0, ammo: o.ammo, side: o.side }, cases: [] };
  var B = sh.T.base, n = o.guns.length * o.short.length, x0 = Math.round(B.sx * 0.25), x1 = Math.round(B.sx * 0.75), k = 0;   // 每一發各打一欄（船身中段一半，平均分開 ⇒ 不打進前一發的洞）
  var fl0 = sh.fl ? sh.fl.inTot : 0, n0 = sh.grid.count;
  o.guns.forEach(function (g) { o.short.forEach(function (sd) { var x = n > 1 ? Math.round(x0 + (x1 - x0) * k / (n - 1)) : (x0 + x1) >> 1; k++; out.cases.push(uwLabShot(sh, x, o.side, g, sd, o)); }); });
  out.removed = n0 - sh.grid.count;
  if (o.floodS > 0) {                                                 // 之後照常走：打到水線下的洞會不會進水
    for (i = 0; i < Math.round(o.floodS / DT); i++) simStep();
    var fl = sh.fl; out.flood = { t: o.floodS, lv: FLOOD_LV, inTot: fl ? +(fl.inTot - fl0).toFixed(2) : null, tonnes: fl ? +(fl.vol * RHO_W).toFixed(2) : null, holes: fl ? fl.open : null, sink: +sh.sink.toFixed(3), roll: +(sh.rollA * 57.3).toFixed(2) };
  }
  SEA_K = seaK;
  return out;
}

/** 網址 ?lab=uw 的參數 ⇒ uwLab 的 o。 */
function labOpts() {
  var o = {}, L = function (k) { return Q.get(k).split(',').filter(function (w) { return w !== ''; }); };
  if (Q.has('guns')) o.guns = L('guns');
  if (Q.has('short')) o.short = L('short').map(Number);
  ['ammo', 'R', 'h0', 'side', 'floodS', 'rec'].forEach(function (k) { if (Q.has(k)) o[k] = +Q.get(k); });
  if (Q.get('flat') === '1') o.flat = true;
  return o;
}
