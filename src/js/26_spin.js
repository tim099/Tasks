// ───────────────────────── 子物件照參數轉（TASK-0640；Tim 2026-10-16：「跟隨船隻轉彎方向去轉舵輪&舵(參考螺旋槳跟船速關聯)」
//   「是否可以弄成一套通用架構 綁定某項參數&某個子物件的旋轉關聯(meta設定) 然後可能要定義可以旋轉的上限(可以無上限) 舵面本身應該要有上限 舵輪可以沒有(可以轉超過一圈)」）─────────────────────────
// 標法（雕刻作品的模型 meta，造船規格 §9.8）：寫了 spin ＝ 綁定；沒寫 ⇒ 這一支一行都不跑。
//   spin       來源參數：rudder（舵角 −1..1，左舵 ＝ 往左舷轉為正）｜speed（航速，節；倒退為負）｜rpm（螺旋槳轉速：這個模型自己是動力的輸出物件 ⇒ 它的，否則這艘第一個螺旋槳的）
//   spin_mode  angle（預設）：角度 ＝ spin_k × 參數｜rate：每秒轉 spin_k × 參數 度（一直轉；rpm × 6 ＝ 每秒幾度）
//   spin_k     倍率（度／參數單位；預設 1）。負的 ＝ 反著轉
//   spin_min／spin_max  上下限（度）；沒寫 ＝ 那一頭沒有上限（舵輪可以轉超過一圈）
//   spin_lag   跟上的時間常數（秒；預設 0.3；0 ＝ 立刻）—— angle 模式才用（rate 本身就是連續的）
//   轉軸（照順序找第一個有的）：固定點 spin-a → spin-b（轉的中心 ＝ spin-a）｜meta spin_pivot_x／y／z ＋ spin_axis_x／y／z｜
//     舵的 meta hinge_x／y／z ＋ axis_x／y／z（造船規格 §9 rudder）｜固定點 hub-aft → hub-fore（舵輪）｜固定點 hub ＋ meta axis_x／y／z（螺旋槳）
//   方向：繞轉軸照右手定則轉（格座標：x 往船頭、y 往右舷、z 往上）⇒ 舵（軸朝上）正轉 ＝ 舵的後緣擺向左舷 ＝ 左舵；舵輪（軸朝船頭）正轉 ＝ 輪頂往左舷。
// 只是畫面：轉角在模擬那一步照模擬的狀態算（不抽亂數、不讀畫面），寫 m.sw／spv／sax（modelLocal，跟螺旋槳、門同一條路）。
//   戰局一個值都不讀它：被打飛那一刻擺回 0°（21_gunnery.js blowModel，門也這樣）⇒ 飛出去的樣子跟轉到哪裡無關。
//   ⛔ 掛著擺的（小艇）、門不收（同一格 m.sw 各寫各的會打架）；螺旋槳寫了 spin ⇒ 照這裡轉（31_drive.js 不再寫它的 m.sw），沒寫 ⇒ 照舊。
var SPIN_LAG = 0.3;
var SPIN_SRC = {
  rudder: function (sh) { return sh.rudder || 0; },
  speed: function (sh) { return (sh.spd || 0) * 1.9438; },
  rpm: function (sh, m) {
    var P = sh.drive && sh.drive.P || [], p = P.filter(function (q) { return q.m === m; })[0] || P.filter(function (q) { return q.ax; })[0];
    return p ? p.rpm || 0 : 0;
  }
};
function spinNum(v, d) { return v !== undefined && v !== '' && isFinite(+v) ? +v : d; }
/** 轉軸：[中心, 單位軸向] 或 null（找不到 ⇒ 不轉，匯入檢查報 ⚠）。模型的固定點照用（引擎匯出時已經換成連續座標：錨的 ring 正好落在模型的 at 上、舵輪的 hub-aft 88.9）——⛔ 不再加 0.5。 */
function spinAxis(m) {
  var P = m.pts || {}, t = m.meta || {}, c = function (p) { return p.slice(); };
  var ok = function (a, b) { return a && b && len(sub(b, a)) > 1e-3 ? [a, norm(sub(b, a))] : null; };
  var v3 = function (k) { var x = spinNum(t[k + '_x'], NaN), y = spinNum(t[k + '_y'], NaN), z = spinNum(t[k + '_z'], NaN); return isFinite(x) && isFinite(y) && isFinite(z) ? [x, y, z] : null; };
  var r;
  if (P['spin-a'] && P['spin-b'] && (r = ok(c(P['spin-a']), c(P['spin-b'])))) return r;
  var pv = v3('spin_pivot'), ax = v3('spin_axis'); if (pv && ax && len(ax) > 1e-3) return [pv, norm(ax)];
  var hg = v3('hinge'), ha = v3('axis'); if (hg && ha && len(ha) > 1e-3) return [hg, norm(ha)];
  if (P['hub-aft'] && P['hub-fore'] && (r = ok(c(P['hub-aft']), c(P['hub-fore'])))) return r;
  if (P.hub && ha && len(ha) > 1e-3) return [c(P.hub), norm(ha)];
  return null;
}
/** 開一艘船（10_ship.js makeShip，模型建好之後）：每個寫了 spin 的模型。沒有 ⇒ sh.spins 不設。 */
function spinShip(sh) {
  var L = [];
  sh.models.forEach(function (m) {
    var t = m.meta || {}; if (!t.spin) return;
    if (m.hang || kindProp(m.kind, 'anim') || !SPIN_SRC[t.spin]) return;          // 匯入檢查會報（spinIssues）
    var A = spinAxis(m); if (!A) return;
    var lo = spinNum(t.spin_min, -Infinity), hi = spinNum(t.spin_max, Infinity); if (lo > hi) return;
    m.spinB = { src: t.spin, rate: t.spin_mode === 'rate', k: spinNum(t.spin_k, 1), lo: lo, hi: hi, lag: Math.max(0, spinNum(t.spin_lag, SPIN_LAG)), p: A[0], ax: A[1], deg: 0 };
    if (t.spin === 'gun') { var g = spinGunOf(sh, m); if (g && g.mt) { m.spinB.mt = g.mt; m.spv = A[0]; m.sax = A[1]; m.sw = 0; } }   // 綁的那門砲會迴旋（投石機 ports 0,180）⇒ 先繞自己的軸轉、再跟著那門砲轉（21_gunnery.js modelLocal0）
    L.push(m);
  });
  if (L.length) sh.spins = L;
}
/** 模擬的每一步（50_sim.js，sail() 之後 ⇒ 這一步的舵角已經定了）：照來源參數更新角度、寫進 modelLocal 那一格。 */
function spinStep(sh, dt) {
  sh.spins.forEach(function (m) {
    var B = m.spinB; if (!m.alive) return;
    var v = SPIN_SRC[B.src](sh, m), d = B.deg;
    if (B.rate) { d += B.k * v * dt; if (B.lo === -Infinity && B.hi === Infinity) d = ((d + 180) % 360 + 360) % 360 - 180; }   // 一直轉、沒上限 ⇒ 收在 ±180（⛔ 不收 ⇒ 轉久了浮點數失準）
    else { var w = B.k * v; d += B.lag > 0 ? (w - d) * Math.min(1, dt / B.lag) : w - d; }
    B.deg = d = clamp(d, B.lo, B.hi);
    m.spv = B.p; m.sax = B.ax; m.sw = d * Math.PI / 180;
  });
}
/** 匯入檢查（75_shipcheck.js）：寫了 spin 卻轉不起來的。 */
function spinIssues(sh, add) {
  sh.models.forEach(function (m) {
    var t = m.meta || {}; if (!t.spin) return;
    if (!SPIN_SRC[t.spin]) add('warn', '轉動', m.path, 'meta spin=' + t.spin + ' 不認得 ⇒ 不轉', 'spin 寫 ' + Object.keys(SPIN_SRC).join('｜') + '（造船規格 §9.8）');
    else if (m.hang || kindProp(m.kind, 'anim')) add('warn', '轉動', m.path, (m.hang ? '掛著擺的小艇' : '門') + '已經自己在轉 ⇒ spin 不收', '拿掉 spin，或換一個模型');
    else if (!spinAxis(m)) add('warn', '轉動', m.path, '找不到轉軸 ⇒ 不轉', '登記固定點 spin-a／spin-b，或 meta spin_pivot_*＋spin_axis_*（造船規格 §9.8）');
    else if (spinNum(t.spin_min, -Infinity) > spinNum(t.spin_max, Infinity)) add('warn', '轉動', m.path, 'spin_min ' + t.spin_min + ' > spin_max ' + t.spin_max + ' ⇒ 不轉', '上下限對調');
    if (t.spin_mode && t.spin_mode !== 'angle' && t.spin_mode !== 'rate') add('warn', '轉動', m.path, 'spin_mode=' + t.spin_mode + ' 不認得 ⇒ 照 angle', 'spin_mode 寫 angle｜rate');
  });
}
/** 匯入檢查的讀數一行：每個會轉的模型、跟什麼、轉多少。 */
function spinSummary(sh) {
  if (!sh.spins) return '';
  return sh.spins.map(function (m) {
    var B = m.spinB, lim = B.lo === -Infinity && B.hi === Infinity ? '無上限' : (B.lo === -Infinity ? '−∞' : B.lo) + '°～' + (B.hi === Infinity ? '∞' : B.hi + '°');
    return m.path + '（' + B.src + (B.rate ? ' 每秒 ' : ' × ') + B.k + '°、' + lim + '）';
  }).join('；');
}
