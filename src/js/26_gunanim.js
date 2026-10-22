// ───────────────────────── 武器演出（通用） ─────────────────────────
// Tim 2026-10-18：「弩炮的弦是否可以改用繩索 並在開火時有動態」「不可動的話 可以調整框架(儘量以好維護 可通用的架構去調整 之後可以用在類似武器上)」
//   「同時可以分析投石機的演出(是否可以做出動態) 可以讓武器系統支援演出」。
// 三件通用的東西（雕刻那側只標 meta，⛔ 不寫哪一種武器的專用程式）：
//   ① gunPhase(g)：武器的動作進度 —— 1 ＝ 上好弦／裝好；開火那一刻 0，往「放出去」那一邊彈過頭再回來（GUN_SNAP 秒）；
//      之後照裝填進度（1 − reload／reload0）回到 1（等藥箱的時候 reload 不倒數 ⇒ 停在 0）。沒開過 ⇒ 1。
//   ② spin 的來源 gun（26_spin.js SPIN_SRC）：子物件照它綁的那門砲的進度轉 —— 模型 meta spin=gun、spin_k（開火那一刻轉到 spin_k 度，裝填時轉回 0）、
//      spin_gun=<砲的模型路徑或 id>（沒寫 ⇒ 離它最近的那門砲）、建議 spin_lag=0（不然放出去那一下被延遲抹掉）。轉軸照 spin 的規矩（固定點 spin-a → spin-b）。
//      例：投石機的投臂（拆成自己的子模型，軸在橫軸上）、弩砲的弓臂。
//   ③ 繩跟著武器（ropeAnimInit／ropeAnimStep）：
//      · 綁在會動的模型上的繩，照那個模型現在的樣子重算（兩端各照它綁的那個模型動；中間照沿繩的比例內插 —— 帆桁的繩 30_rig_physics.js yardRopes 同一套）。
//        會動的模型（ropeMover）：迴旋砲（mount，照 yaw 轉）、照砲轉的零件（spin=gun：繞自己的軸轉，掛在迴旋砲上的再跟著砲轉 —— 投石機的投臂）。
//        ⛔ 以前只有帆桁的繩會跟著轉：綁在迴旋砲上的繩轉了之後留在原地；第二版（投石機）之前只認迴旋砲：綁在投臂上的拉繩、投袋繩留在原地。
//      · 繩 meta anim=gun、rest=<固定點>、fire=<固定點>（那個模型的固定點）：綁在 rest 那一點的那一端照進度在 rest（1）與 fire（0）之間移動，整條拉直。
//        另一端綁在會動的模型上 ⇒ 照上面那一條跟著它（投石機的拉繩：上端在投臂的短臂、下端在拉繩手手上 rest=grip、fire=grip-fire）。
//        例：弩弦（兩條：弓臂尖 → 扣弦點 → 另一邊弓臂尖；rest=nock、fire=nock-fire）、投石機的拉繩。投袋繩兩端都在投臂上 ⇒ 只跟著投臂（meta anim=gun、不寫 rest／fire）。
// 都只是畫面：每一步照模擬的狀態算（不抽亂數、不讀畫面），只改 m.sw／r.pts（＋ r.bb、rigDirty）；戰局不讀這些值。沒有的船一步都不多做（sh.ropeAnims ＝ null、spin 沒寫 gun）。
var GUN_SNAP = 0.25, GUN_OVER = 0.25, GUN_ANIM_Q = 50;   // 放出去那一下多久（秒）、彈過頭多少（進度）、進度量化幾格（沒變就不重算繩）
/** 武器的動作進度（見檔頭 ①）：1 ＝ 裝好；0 ＝ 剛放出去；負的 ＝ 彈過頭。 */
function gunPhase(g) {
  if (!g || g.firedAt === undefined) return 1;
  var t = SIMT - g.firedAt;
  if (t < GUN_SNAP) return -GUN_OVER * Math.sin(t / GUN_SNAP * Math.PI);
  return g.reload0 > 0 ? clamp(1 - Math.max(0, g.reload) / g.reload0, 0, 1) : 1;
}
/** 模型 m 綁的那門砲（spin=gun 用）：meta spin_gun（模型路徑或 id）⇒ 那個；沒寫 ⇒ 外框中心最近的那門（30 格內）。快取在 m.spinGun。 */
function spinGunOf(sh, m) {
  if (m.spinGun !== undefined) return m.spinGun;
  var v = m.meta && m.meta.spin_gun, best = null, bd = 900;
  sh.guns.forEach(function (g) {
    var gm = g.model; if (v) { if (gm.path === v || gm.name === v || (gm.meta && String(gm.meta.id) === String(v))) best = g; return; }
    var d = len(sub(gm.c, m.c)); d *= d; if (d < bd) { bd = d; best = g; }
  });
  return (m.spinGun = best);
}
SPIN_SRC.gun = function (sh, m) { return 1 - gunPhase(spinGunOf(sh, m)); };   // 0 ＝ 裝好（作品的樣子）、1 ＝ 放出去（轉到 spin_k）
/** 會動的模型 m（見檔頭 ③）⇒ { m, k() 現在的狀態（比對有沒有變）, f(p) 作品裡的點 p 現在在哪 }；不會動 ⇒ null。 */
function ropeMover(m) {
  if (!m) return null;
  var G = m.gun && m.gun.mt ? m.gun.mt : null, B = m.spinB && m.spinB.src === 'gun' ? m.spinB : null; if (!G && !B) return null;
  var M = G || (B && B.mt) || null;
  return { m: m,
    k: function () { return (B ? m.sw || 0 : 0) + '/' + (M ? M.yaw : 0); },
    f: function (p) {
      var q = p;
      if (B && m.sw) { var d = M4.dir(rotM(B.ax, m.sw), q[0] - B.p[0], q[1] - B.p[1], q[2] - B.p[2]); q = [B.p[0] + d[0], B.p[1] + d[1], B.p[2] + d[2]]; }   // 繞自己的軸（跟 modelLocal0 同一個 rotM）
      return M && M.yaw ? mountRot(q, M.c, M.yaw) : q;
    } };
}
/** 一艘船的「繩跟著武器」清單（見檔頭 ③）；第一次 ropeAnimStep 時建。 */
function ropeAnimInit(sh) {
  var L = [];
  function mdl(k) { return k !== undefined ? sh.models[k] : null; }
  sh.ropes.forEach(function (r) {
    if (r.dead) return;
    var t = r.meta || {}, va = ropeMover(mdl(r.ma)), vb = ropeMover(mdl(r.mb)), anim = null;
    if (t.anim === 'gun' && t.rest && t.fire) {
      var gm = [r.ma, r.mb].map(mdl).filter(function (m) { return m && m.gun && m.pts[t.rest] && m.pts[t.fire]; })[0];
      if (gm) anim = { g: gm.gun, rest: gm.pts[t.rest].slice(), fire: gm.pts[t.fire].slice(), v: ropeMover(gm) };
    }
    if (!anim && !va && !vb) return;
    var n = r.pts.length / 3, p0 = Float32Array.from(r.pts), E = [[p0[0], p0[1], p0[2]], [p0[n * 3 - 3], p0[n * 3 - 2], p0[n * 3 - 1]]], F = new Float32Array(n), tot = 0, j;
    for (j = 1; j < n; j++) { tot += Math.hypot(p0[j * 3] - p0[j * 3 - 3], p0[j * 3 + 1] - p0[j * 3 - 2], p0[j * 3 + 2] - p0[j * 3 - 1]); F[j] = tot; }
    for (j = 0; j < n; j++) F[j] = tot > 0 ? F[j] / tot : j / Math.max(1, n - 1);
    if (anim) anim.end = len(sub(E[0], anim.rest)) <= len(sub(E[1], anim.rest)) ? 0 : 1;   // 綁在 rest 那一點的那一端
    L.push({ r: r, n: n, p0: p0, E: E, F: F, va: va, vb: vb, anim: anim, key: null });
  });
  sh.ropeAnims = L.length ? L : null;
}
/** 每一步（50_sim.js simStep，迴旋砲轉完之後）：模型的樣子或進度變了才重算那一條繩。 */
function ropeAnimStep(sh) {
  if (sh.ropeAnims === undefined) ropeAnimInit(sh); if (!sh.ropeAnims) return;
  sh.ropeAnims.forEach(function (A) {
    var r = A.r; if (r.dead) return;
    var k = A.anim ? Math.round(gunPhase(A.anim.g) * GUN_ANIM_Q) / GUN_ANIM_Q : 1, key = (A.va ? A.va.k() : '') + ',' + (A.vb ? A.vb.k() : '') + ',' + (A.anim && A.anim.v ? A.anim.v.k() : '') + ',' + k;
    if (key === A.key) return; A.key = key;
    var n = A.n, out = new Float32Array(n * 3), j, P;
    function ra(p) { return A.va ? A.va.f(p) : p; }
    function rb(p) { return A.vb ? A.vb.f(p) : p; }
    if (A.anim) {                                                        // 拉直：兩端各照它的模型動、rest 那一端照進度（在那門砲的座標裡內插，再照那門砲轉）
      var M = [A.anim.fire[0] + (A.anim.rest[0] - A.anim.fire[0]) * k, A.anim.fire[1] + (A.anim.rest[1] - A.anim.fire[1]) * k, A.anim.fire[2] + (A.anim.rest[2] - A.anim.fire[2]) * k];
      var Mv = A.anim.v ? A.anim.v.f(M) : M;
      var a = A.anim.end === 0 ? Mv : ra(A.E[0]), b = A.anim.end === 1 ? Mv : rb(A.E[1]);
      for (j = 0; j < n; j++) { var f = n > 1 ? j / (n - 1) : 0; out[j * 3] = a[0] + (b[0] - a[0]) * f; out[j * 3 + 1] = a[1] + (b[1] - a[1]) * f; out[j * 3 + 2] = a[2] + (b[2] - a[2]) * f; }
    } else {                                                             // 只跟著動：每一點照兩端的動法、沿繩的比例內插（形狀照作品）
      for (j = 0; j < n; j++) {
        P = [A.p0[j * 3], A.p0[j * 3 + 1], A.p0[j * 3 + 2]];
        var pa = ra(P), pb = rb(P), w = A.F[j];
        out[j * 3] = pa[0] * (1 - w) + pb[0] * w; out[j * 3 + 1] = pa[1] * (1 - w) + pb[1] * w; out[j * 3 + 2] = pa[2] * (1 - w) + pb[2] * w;
      }
    }
    r.pts = out; r.bb = ropeBox(out); sh.rigDirty = true;
  });
}
