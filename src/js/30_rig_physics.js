// ───────────────────────── 帆與繩的物理（可關） ─────────────────────────
// 開（PHYS）：帆是一塊布（質點＋距離約束，Verlet），被「相對風」（真風 − 船速）吹鼓 —— 轉向、頂風時帆會往另一邊鼓；
//   斷掉的繩與掉下來的帆不消失：掛在還綁著的那一端擺，整個鬆脫就往下掉，落到甲板上會停住。
//   帆被打穿：洞裡那一塊布切成布片，照同一套布的物理飄下去（34_shreds.js）。
// 關：跟以前一樣 —— 帆停在雕刻作品模擬的那一刻、斷掉的就不見。
// ⛔ 物理只管畫出來的樣子：航速、命中、帆算不算數照原本的規則（s.dead／s.furled），而且這一段不碰 rnd()
//   ⇒ 開或關，同一個種子走出同一局。
// 座標：船的格座標（跟繩與帆的資料同一套）；重力與相對風用 sh.inv 換進來（1 格 ＝ S 公尺，速度單位 格/秒）。
var WIND_SAIL = 10;           // 推帆的風速（m/s）；WIND 的大小是煙飄的速度，只共用方向。Tim 2026-10-12：7 太不明顯 ⇒ 10，再乘細節設定的風壓（WIND_K）
var GUST = [0.24, 0.12, 0.06], FLUTTER = 0.35, SLACK = 1.02;   // 陣風三個頻率的幅度、布上走過去的波紋（風壓 ±35%）、布比作品的形狀鬆 2%（鼓得深一點）
var KW = 0.05;                // 風壓：加速度（格/秒²）＝ KW ×（相對風在法線上的分量）²
var KD = 0.3, DAMP = 0.985;   // 繩的空氣阻力（1/秒）、每一步的速度保留
var SEG = 6;                  // 布與繩的迭代次數、帆幾步走一次、垂繩上限照物理分級（09_phx.js rigLv：高 ＝ 4 次、隔一步（30 Hz）、500 條）
var CACC = null, CCNT = null, PHYS_MS = 0, PROF = { cloth: 0, rope: 0, shred: 0, buf: 0, cc: 0, ccN: 0, ccHit: 0, ccQ: 0, ccMax: 0, ccGeo: 0 };   // cc：帆的碰撞花的 ms、ccN 跑了幾次、ccHit 每次第一輪找到的接觸（＝ 那一刻還穿著的；clothContacts）、ccQ 排了幾面（解不完的下一步再排）
// 帆桁追風（物理開著才轉）：方帆桁讓帆的法線落在「相對風吹去的方向」與船頭的角平分線上，最多轉離正橫 40°（再多就頂到支索與 shroud）；
//   gaff／boom（後桅縱帆）往下風擺，帆面跟船身的夾角 ＝ (180° − 相對風角)／2，8°–80°；頂風 ±25° 內不換邊（遲滯）。每秒最多轉 8°。
//   帆的綁點、帆腳與綁在帆桁上的繩跟著轉（繩照弧長在兩端之間內插：一端綁甲板的 brace 就只有帆桁那一頭轉）。
//   ⚠ 帆桁轉了，砲彈打到帆桁的位置跟著變 ⇒ 物理開或關不再走出逐格同一局（只差在打到帆桁的那幾下）。
//   三角帆桁（帆桁 meta rig=lateen，皇家號；照 gaff 往下風擺）：前端（car）被 tack 綁在船頭 ⇒ 只能在船頭左右移 LATEEN_SWING 格 ⇒ 最多擺 asin(LATEEN_SWING ÷ 轉軸到前端的水平距離)
//     （Tim 2026-10-18「皇家號 發現浮空纜線」：照 gaff 擺到 80° ⇒ 主帆桁前端甩出舷外 13 m、tack 從那裡斜拉到中央走道前端）。沒有固定點 fore ⇒ 照 gaff。
//   信號桁（帆桁 meta yard=signal；蒸汽船的戰鬥桅，定遠號 2026-10-21）：不掛帆、不追風 —— 只給遊戲認桅（10_ship.js findMasts、77_colours.js 桅頂旗）。
var BRACE_MAX = 0.70, BOOM_MIN = 0.14, BOOM_MAX = 1.40, BRACE_RATE = 0.14, BRACE_HYST = 2.7, LATEEN_SWING = 25;
function yardSwingMax(m) {
  if (m.swMax === undefined) { var f = m.pts.fore, p = m.piv, L = f && p ? Math.hypot(f[0] - p[0], f[1] - p[1]) : 0; m.swMax = m.meta.rig === 'lateen' && L > LATEEN_SWING ? Math.asin(LATEEN_SWING / L) : BOOM_MAX; }
  return m.swMax;
}
function braceYards(sh, wl, dt) {
  var psi = Math.atan2(wl[1], wl[0]);                                // 相對風吹去的方向（格座標、從船頭往 +y 量）：0 ＝ 正後方來的風
  if (Math.abs(psi) < BRACE_HYST || !sh.braceSide) sh.braceSide = psi >= 0 ? 1 : -1;
  sh.yards.forEach(function (m) {
    if (!m.alive || m.yk === 'signal') return;
    var tgt = m.yk === 'gaff' || m.yk === 'boom' ? -sh.braceSide * clamp((Math.PI - Math.abs(psi)) / 2, Math.min(BOOM_MIN, yardSwingMax(m)), yardSwingMax(m))
      : Math.abs(psi) < BRACE_HYST ? clamp(psi / 2, -BRACE_MAX, BRACE_MAX) : sh.braceSide * BRACE_MAX;
    m.rot += clamp(tgt - m.r0 - m.rot, -BRACE_RATE * dt, BRACE_RATE * dt);
  });
  sh.psi = psi;
}
// 掛著的模型擺（Tim 2026-10-14：吊艇架上的小艇跟著繩子搖晃；物理開著才擺，跟帆桁追風一樣只管畫出來的樣子）：
//   單擺，轉軸 ＝ 兩條吊索上端的連線（10_ship.js hangFalls）。ψ ＝ 偏離鉛直的角度：ψ'' ＝ −(g sinψ ＋ a cosψ)／L − c ψ'，
//   a ＝ 吊點（世界）在擺動方向上的加速度（船橫搖、轉向、被打中一晃 ⇒ 擺起來）。畫出來的角度 ＝ 重力在船身座標裡的方向 ＋ ψ（船傾斜時照樣朝下）。
//   吊索跟著轉（繞同一根軸，上端在軸上不動）。最多 ±0.6 rad（再多就撞船殼）。
var SWING_DAMP = 0.35, SWING_MAX = 0.6;
function rotAxis(P, q, A, ang) {
  var c = Math.cos(ang), s = Math.sin(ang), v = sub(P, q), d = dot(A, v), x = cross(A, v);
  return [q[0] + v[0] * c + x[0] * s + A[0] * d * (1 - c), q[1] + v[1] * c + x[1] * s + A[1] * d * (1 - c), q[2] + v[2] * c + x[2] * s + A[2] * d * (1 - c)];
}
function swingHangs(sh, gv) {
  (sh.hangs || []).forEach(function (m) {
    if (!m.alive) return;
    var A = m.sax, e = norm(cross(A, [0, 0, -1])), gA = dot(gv, A), gp = sub(gv, mul(A, gA)), eq = Math.atan2(dot(gp, e), -gp[2]);
    var w = M4.pt(sh.M, m.spv[0], m.spv[1], m.spv[2]), a = 0;
    if (m.pw && m.pw2) { var ew = norm(M4.dir(sh.M, e[0], e[1], e[2])); a = clamp(dot([(w[0] - 2 * m.pw[0] + m.pw2[0]) / (DT * DT), (w[1] - 2 * m.pw[1] + m.pw2[1]) / (DT * DT), (w[2] - 2 * m.pw[2] + m.pw2[2]) / (DT * DT)], ew), -30, 30); }
    m.pw2 = m.pw; m.pw = w;
    var L = m.sL * S;
    m.psiV += (-(G * Math.sin(m.psi) + a * Math.cos(m.psi)) / L - SWING_DAMP * m.psiV) * DT; m.psi += m.psiV * DT;
    m.sw = clamp(eq + m.psi, -SWING_MAX, SWING_MAX);
    if (Math.abs(m.sw - m.swA) > 0.004) {                                // 吊索跟著轉（上端在軸上）
      m.swA = m.sw;
      m.falls.forEach(function (j) {
        var r = sh.ropes[j]; if (r.dead) return;
        var p0 = r.pts0, out = new Float32Array(p0.length);
        for (var k = 0; k < p0.length; k += 3) { var q = rotAxis([p0[k], p0[k + 1], p0[k + 2]], m.spv, A, m.sw); out[k] = q[0]; out[k + 1] = q[1]; out[k + 2] = q[2]; }
        r.pts = out; r.bb = ropeBox(out);
      });
      childBind(sh);
      sh.rigDirty = true;
    }
  });
}
/** 物理關掉 ⇒ 掛著的回到作品的位置。 */
function unswingHangs(sh) { (sh.hangs || []).forEach(function (m) { m.sw = m.swA = m.psi = m.psiV = 0; m.pw = m.pw2 = null; m.falls.forEach(function (j) { var r = sh.ropes[j]; if (!r.dead) { r.pts = r.pts0; r.bb = ropeBox(r.pts); } }); }); childBind(sh); }
/** 綁在帆桁上的繩重算形狀（帆桁轉了 0.25° 以上才算；物理關掉時 rot 歸零 ⇒ 回到作品的形狀）。 */
function yardRopes(sh, force) {
  var moved = force || sh.yards.some(function (m) { return Math.abs(m.rot - (m.rotA || 0)) > 0.004; });
  if (!moved) return;
  sh.yards.forEach(function (m) { m.rotA = m.rot; });
  sh.yRopes.forEach(function (r) {
    var A = r.ya >= 0 ? sh.models[r.ya] : null, B = r.yb >= 0 ? sh.models[r.yb] : null;
    if ((!A || !A.rot) && (!B || !B.rot)) { r.pts = r.pts0; r.bb = ropeBox(r.pts); return; }
    var p0 = r.pts0, n = p0.length / 3, acc = new Float32Array(n), tot = 0, j;
    for (j = 1; j < n; j++) { tot += Math.hypot(p0[j * 3] - p0[j * 3 - 3], p0[j * 3 + 1] - p0[j * 3 - 2], p0[j * 3 + 2] - p0[j * 3 - 1]); acc[j] = tot; }
    var out = new Float32Array(p0.length);
    for (j = 0; j < n; j++) {
      var P0 = [p0[j * 3], p0[j * 3 + 1], p0[j * 3 + 2]], t = tot > 0 ? acc[j] / tot : 0;
      var pa = A && A.rot ? rotZ(P0, A.piv, A.rot) : P0, pb = B && B.rot ? rotZ(P0, B.piv, B.rot) : P0;
      if (A && B && A === B) pb = pa;
      out[j * 3] = pa[0] * (1 - t) + pb[0] * t; out[j * 3 + 1] = pa[1] * (1 - t) + pb[1] * t; out[j * 3 + 2] = P0[2];
    }
    r.pts = out; r.bb = ropeBox(out);
  });
  childBind(sh);                                                        // 子繩（ratlines）跟著母繩（10_ship.js；Tim 2026-10-17：shroud 上端跟著帆桁轉、ratlines 留在原地 ⇒ 浮空）
  sh.rigDirty = true;
}
/** 綁著的布點跟著帆桁轉（每一步都放回「作品的位置繞轉軸轉 rot」；鬆開的點交給物理）。 */
function yardPins(sh, c) {
  var T = c.T.sim, yk = T.yk; if (!yk) return;
  for (var i = 0; i < T.n; i++) {
    if (!c.pin[i] || yk[i] < 0) continue;
    var m = sh.models[yk[i]]; if (!m.rot) { if (!c.yr) continue; }
    var o = i * 3, w = rotZ([T.p0[o], T.p0[o + 1], T.p0[o + 2]], m.piv, m.rot);
    c.p[o] = c.q[o] = w[0]; c.p[o + 1] = c.q[o + 1] = w[1];
  }
  c.yr = sh.yards.some(function (m) { return m.rot; });
}
/** 一面帆的布（兩艘船共用；載入時算一次）：
 *  只留一層 —— 雕刻作品的帆是正反兩層、相差 0.11 格，兩層都畫遠看會互相打架成棋盤格；
 *  邊（距離約束）＋ 同一條格線上隔一點的兩點（跨點約束，布不會揉成一團）；
 *  外緣在轉角（> 29°）處切成幾段：筆直的那幾段是綁在帆桁／支索／斜桁上的邊（作品裡整條固定在線段上；鼓起來的自由邊不會直），
 *  綁邊上的點各自找靠的格（0.6 m 內）或繩（0.4 m 內）—— 帆桁被打掉一截，只有那一截的布鬆開；
 *  不在綁邊上的角 ＝ 帆腳：綁在帆自己的繩（sheet／tack，端點 1 m 內）、旁邊的格或繩上。
 *  hk：0 不綁、1 格、2 繩、3 找不到靠的（帆還在就綁著）、4 模型（帆桁：綁邊靠在帆桁的網格上）。
 *  sim.yk：每個綁著的粗格點跟著哪根帆桁轉（帆桁追風，見 braceYards；-1 ＝ 不轉）。 */
function clothTemplate(H, s) {                         // H：船型（帆的布模板、繩的外框在 H.cloth／H.rbox）
  var v = s.verts, tr = s.tris, nv = v.length / 3, h = nv >> 1, T = [], one = nv % 2 === 0, i, j, k;
  for (j = 0; j < tr.length; j += 3) {
    var lo = tr[j] < h;
    if ((tr[j + 1] < h) !== lo || (tr[j + 2] < h) !== lo) one = false;
    if (lo) T.push(tr[j], tr[j + 1], tr[j + 2]);
  }
  if (!one || T.length * 2 !== tr.length) { T = Array.prototype.slice.call(tr); h = nv; }
  var n = h, p0 = new Float32Array(v.slice(0, n * 3));
  function P(q) { return [p0[q * 3], p0[q * 3 + 1], p0[q * 3 + 2]]; }
  var E = new Map(), ea = [], eb = [], use = [];
  for (j = 0; j < T.length; j += 3) for (k = 0; k < 3; k++) {
    var a = T[j + k], b = T[j + (k + 1) % 3], kk = a < b ? a * 65536 + b : b * 65536 + a, e = E.get(kk);
    if (e === undefined) { e = ea.length; E.set(kk, e); ea.push(a); eb.push(b); use.push(0); }
    use[e]++;
  }
  // 外緣：只被一個三角形用到的邊，接成一圈
  var bn = []; for (i = 0; i < n; i++) bn.push([]);
  ea.forEach(function (a, e) { if (use[e] === 1) { bn[a].push(eb[e]); bn[eb[e]].push(a); } });
  var loop = [], st = -1; for (i = 0; i < n; i++) if (bn[i].length === 2) { st = i; break; }
  if (st >= 0) { var pv = -1, cu = st; do { loop.push(cu); var nx = bn[cu][0] === pv ? bn[cu][1] : bn[cu][0]; pv = cu; cu = nx; } while (cu !== st && cu !== undefined && loop.length <= n); }
  var L = loop.length, corner = [];
  for (k = 0; k < L; k++) { var A = P(loop[(k + L - 1) % L]), M = P(loop[k]), C = P(loop[(k + 1) % L]); if (dot(norm(sub(M, A)), norm(sub(C, M))) < Math.cos(0.5)) corner.push(k); }
  var hk = new Int8Array(n), hv = new Int32Array(n).fill(-1), sides = [];
  for (k = 0; k < corner.length; k++) {
    var side = [], k1 = corner[(k + 1) % corner.length];
    for (var t = corner[k]; ; t = (t + 1) % L) { side.push(loop[t]); if (t === k1 && side.length > 1) break; if (side.length > L) break; }
    var a0 = P(side[0]), a1 = P(side[side.length - 1]), ch = len(sub(a1, a0)), md = 0;
    side.forEach(function (q) { var w = P(q); md = Math.max(md, Math.sqrt(segDist2(w, a0[0], a0[1], a0[2], a1[0], a1[1], a1[2]))); });
    var bound = ch > 25 && md < 0.75;
    sides.push({ n: side.length, len: +ch.toFixed(1), dev: +md.toFixed(2), bound: bound });
    if (bound) side.forEach(function (q) { hk[q] = 3; });
  }
  // 配方生的帆（29_sailrecipe.js）：綁定全照 meta —— 帆角的 refs、bind 的邊、繩的 ends（Tim 2026-10-17：「都不要靠猜 帆跟繩的綁定必須靠 meta」）⇒ 下面猜的那幾段跳過
  var MB = s.recipe && s.recipe.refs && s.bmeta ? clothBindMeta(H, s, n, P) : null;
  if (MB) { hk = MB.hk; hv = MB.hv; }
  function ropeNear(w, r2) {
    var best = -1, bd = r2, r = Math.sqrt(r2);
    H.rig.ropes.forEach(function (o, j2) {
      var b2 = H.rbox[j2]; if (w[0] < b2[0] - r || w[0] > b2[3] + r || w[1] < b2[1] - r || w[1] > b2[4] + r || w[2] < b2[2] - r || w[2] > b2[5] + r) return;
      for (var q = 0; q + 5 < o.pts.length; q += 3) { var d = segDist2(w, o.pts[q], o.pts[q + 1], o.pts[q + 2], o.pts[q + 3], o.pts[q + 4], o.pts[q + 5]); if (d < bd) { bd = d; best = j2; } }
    });
    return best;
  }
  if (!MB) for (i = 0; i < n; i++) {
    if (hk[i] !== 3) continue;
    var yw = yardNear(H, P(i), 3); if (yw >= 0) { hk[i] = 4; hv[i] = yw; continue; }   // 綁在帆桁上（帆桁改成模型之後，那裡已經沒有格）
    var w = P(i), an = anchorNear(H, w[0], w[1], w[2], 6);
    if (an >= 0) { hk[i] = 1; hv[i] = an; } else { var rp = ropeNear(w, 16); if (rp >= 0) { hk[i] = 2; hv[i] = rp; } }
  }
  // 掛在斜桁頂上的旗（三叉戟號的 ensign；Tim 2026-10-15：船尾旗飄在空中）：綁邊上面幾點靠在 gaff 上、下面幾點找不到靠的（3）⇒
  //   gaff 追風轉了、旗留在作品的位置。旗有任何一點綁在帆桁上 ⇒ 整條綁邊都歸那根帆桁（跟著轉、帆桁沒了一起鬆開）；跟轉的 yk 在下面照 hv 給。
  var flagYard = -1; if (!MB && isFlag(s)) for (i = 0; i < n; i++) if (hk[i] === 4) { flagYard = hv[i]; break; }
  if (flagYard >= 0) for (i = 0; i < n; i++) if (hk[i] === 3) { hk[i] = 4; hv[i] = flagYard; }
  if (s.pins) { hk.fill(0); hv.fill(-1); s.pins.forEach(function (q) { hk[q] = s.pinK; hv[q] = s.pinV; }); }   // 明寫的綁邊（陣營旗：靠旗桿那一邊釘在桅頂那一格；⛔ 不照外緣直不直猜）
  var own = []; H.rig.ropes.forEach(function (r, j2) { if (sailRope(r, s.name)) own.push(j2); });   // 帆自己的 sheet、tack（10_ship.js sailRope：照 meta，沒有才照名字）
  var clews = MB ? MB.clews : 0, clewYard = MB ? MB.clewYard : {};   // 帆腳 → 跟哪根帆桁轉（-1 ＝ 不轉）；配方的帆照繩的 ends（clothBindMeta）
  if (!s.pins && !MB) corner.forEach(function (kc) {
    var q = loop[kc]; if (hk[q]) return;
    var w = P(q), best = -1, bd = 100, end = null;
    own.forEach(function (j2) { var pts = H.rig.ropes[j2].pts; [0, pts.length - 3].forEach(function (o) { var dx = pts[o] - w[0], dy = pts[o + 1] - w[1], dz = pts[o + 2] - w[2], d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = j2; end = [pts[o], pts[o + 1], pts[o + 2]]; } }); });
    clewYard[q] = end ? yardNear(H, end, 3) : -1;        // 帆自己的 sheet 靠帆那一端在哪根帆桁上（topsail 以上：下一根帆桁的兩端）；course 的綁甲板繩栓 ⇒ 不轉（basecamp 2026-10-12）
    if (best < 0) { var an = anchorNear(H, w[0], w[1], w[2], 6); if (an >= 0) { hk[q] = 1; hv[q] = an; clews++; return; } best = ropeNear(w, 16); }
    if (best >= 0) { hk[q] = 2; hv[q] = best; clews++; }
  });
  var pins = 0; for (i = 0; i < n; i++) if (hk[i]) pins++;
  // 物理在粗格上算（規則格 ⇒ 隔一點取一點：25×25 → 13×13，約束少 4 倍）；畫的時候細格照權重從粗格內插回來
  var cg = coarseOf(n, T);
  // Contact geometry must retain the authored fine surface at initialization.
  // Coarsening moved interpolated vertices through thin masts before any wind.
  cg = { idx: Array.from({ length: n }, function (_, i) { return i; }), tris: T,
    mi: new Uint16Array(n * 4), mw: new Float32Array(n * 4), kind: 'contact-fine' };
  for (i = 0; i < n; i++) { cg.mi[i * 4] = i; cg.mw[i * 4] = 1; }
  var sim = meshCons(cg.idx.map(P), cg.tris);
  sim.fine = cg.idx; sim.hk = new Int8Array(cg.idx.length); sim.hv = new Int32Array(cg.idx.length);
  cg.idx.forEach(function (f, ci) { sim.hk[ci] = hk[f]; sim.hv[ci] = hv[f]; });
  // 跟著哪根帆桁轉：綁邊上的點 ＝ 這面帆的帆桁（meta sail）裡離這一點最近的那根（線段：方帆桁 arm-P–arm-S、gaff／boom pivot–end）；
  //   帆腳 ＝ 它的 sheet 綁在哪根帆桁上（上面的 clewYard）。course 的帆腳綁在甲板繩栓上、不轉 ⇒ 帆桁轉了，帆頂跟著轉、帆腳留著，中間的布交給物理。
  //   ⛔ 帆腳跟著自己的帆桁轉 ⇒ course 整面被拖著轉、sheet 與 tack 也被拖離繩栓（2026-10-12 的版本）。
  var ys = []; (H.rig.models || []).forEach(function (m, k) {
    var mt = m.meta || {}, pt = m.points || {}; if (mt.kind !== 'yard' || mt.sail !== s.name || !pt.pivot) return;
    var a = pt['arm-P'] || pt.pivot, b = pt['arm-S'] || pt.end || pt.pivot; ys.push({ k: k, a: a, b: b });
  });
  sim.yk = new Int16Array(cg.idx.length).fill(-1);
  if (MB) cg.idx.forEach(function (f, ci) {                            // 配方的帆：綁在帆桁模型上的點跟那根帆桁轉；帆腳跟它那條繩另一端指名的帆桁轉（clewYard）
    if (f in clewYard) { sim.yk[ci] = clewYard[f]; return; }
    var m = sim.hk[ci] === 4 ? H.rig.models[sim.hv[ci]] : null; sim.yk[ci] = m && m.meta && m.meta.kind === 'yard' ? sim.hv[ci] : -1;
  });
  else if (ys.length) cg.idx.forEach(function (f, ci) {
    if (!sim.hk[ci]) return;
    if (f in clewYard) { sim.yk[ci] = clewYard[f]; return; }
    var w = P(f), bi = -1, bd = 1e18;
    ys.forEach(function (y) { var d = segDist2(w, y.a[0], y.a[1], y.a[2], y.b[0], y.b[1], y.b[2]); if (d < bd) { bd = d; bi = y.k; } });
    sim.yk[ci] = bi;
  });
  if (flagYard >= 0) cg.idx.forEach(function (f, ci) { if (sim.hk[ci] === 4) sim.yk[ci] = sim.hv[ci]; });   // 旗跟著它掛的帆桁轉（帆桁的 meta sail 是別面帆 ⇒ 上面的 ys 找不到它）
  var foot = -1; Object.keys(clewYard).forEach(function (q) { if (clewYard[q] >= 0) foot = clewYard[q]; });
  var vcol = texColors(s.texture, n);                   // 有貼圖（旗）⇒ 每個頂點照 UV 取貼圖的顏色；整面的顏色（布片、碎布）取平均
  return { name: s.name, col: vcol ? vcol.avg : s.color || [0.95, 0.92, 0.85], vcol: vcol ? vcol.c : null, uv: vcol ? Float32Array.from(s.texture.uv.slice(0, n * 2)) : null, n: n, p0: p0, tris: new Uint16Array(T), sim: sim, mi: cg.mi, mw: cg.mw, grid: cg.kind,
    hk: hk, hv: hv, sides: sides, pins: pins, clews: clews, foot: foot, tm: MB ? MB.tm : null };   // foot：帆腳跟著轉的帆桁（-1 ＝ 不轉；砲彈打帆照高度內插轉角用）；tm：帆腳被哪條繩的哪一端拉著（照 meta，tethOf）
}
/** 旗的貼圖（.vxk 帆的 texture：w×h 的 RGBA、base64，uv 每個頂點一對）⇒ 前 n 個頂點（正面那一份）的顏色：每個頂點取它四周一格布寬的平均（不透明的才算）。
 *  Tim 2026-10-13：夜隼號的旗變成白旗 —— 遊戲畫帆只用一個顏色，夜隼號那面旗的顏色欄是帆布白（憲法號的是紅）。沒有貼圖 ⇒ null（照舊單色）。 */
function texColors(tx, n) {
  if (!tx || !tx.rgba || !tx.uv || tx.uv.length < n * 2 || !tx.w || !tx.h) return null;
  var b = atob(tx.rgba), W = tx.w, H = tx.h, am = tx.alpha_min || 0, f = 0.5 / Math.sqrt(n), c = new Float32Array(n * 3), avg = [0, 0, 0], i;
  if (b.length < W * H * 4) return null;
  for (i = 0; i < n; i++) {
    var u = tx.uv[i * 2], v = tx.uv[i * 2 + 1], x0 = clamp(Math.floor((u - f) * W), 0, W - 1), x1 = clamp(Math.ceil((u + f) * W) - 1, x0, W - 1);
    var y0 = clamp(Math.floor((v - f) * H), 0, H - 1), y1 = clamp(Math.ceil((v + f) * H) - 1, y0, H - 1), r = 0, g = 0, bl = 0, k = 0;
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) { var o = (y * W + x) * 4; if (b.charCodeAt(o + 3) < am) continue; r += b.charCodeAt(o); g += b.charCodeAt(o + 1); bl += b.charCodeAt(o + 2); k++; }
    if (!k) { r = g = bl = 242; k = 1; }
    c[i * 3] = r / k / 255; c[i * 3 + 1] = g / k / 255; c[i * 3 + 2] = bl / k / 255; avg[0] += c[i * 3] / n; avg[1] += c[i * 3 + 1] / n; avg[2] += c[i * 3 + 2] / n;
  }
  return { c: c, avg: avg };
}
/** 帆的貼圖集（一個船型一張；TASK-0579）：每面有貼圖的帆一格，四周多一圈重複邊上的像素（NEAREST 取到 u ＝ 1 不會讀到隔壁那格）；
 *  alpha 照 vxk 的 alpha_min 先二值化（≥ ⇒ 255、< ⇒ 0）⇒ 著色器 a < 0.5 就 discard（洞）。
 *  rect[k] ＝ 第 k 面帆在集裡的 [x, y, w, h]（不含那一圈；沒有貼圖 ⇒ null）；列優先、第 0 列 ＝ 圖的最上面（＝ uv 的 v ＝ 0），上傳不翻。
 *  Tim 2026-10-14：透明的地方變成白色、解析度也上不去 —— 之前每個頂點只取一色（texColors），細節只到布料頂點、四周全透明就填白。 */
var SAIL_ATLAS_W = 1024;
function sailAtlas(sails) {
  var rect = [], x = 0, y = 0, rowH = 0, W = 1, Hh = 1, any = false;
  sails.forEach(function (s, k) {
    var tx = s.texture; rect.push(null);
    if (!tx || !tx.rgba || !tx.uv || !tx.w || !tx.h) return;
    var w = tx.w + 2, h = tx.h + 2;
    if (x + w > SAIL_ATLAS_W) { x = 0; y += rowH; rowH = 0; }
    rect[k] = [x + 1, y + 1, tx.w, tx.h]; x += w; rowH = Math.max(rowH, h); W = Math.max(W, x); Hh = Math.max(Hh, y + rowH); any = true;
  });
  if (!any) return null;
  var D = new Uint8Array(W * Hh * 4);
  sails.forEach(function (s, k) {
    var r = rect[k]; if (!r) return;
    var tx = s.texture, b = atob(tx.rgba), am = tx.alpha_min || 0, w = tx.w, h = tx.h;
    if (b.length < w * h * 4) { rect[k] = null; return; }
    for (var yy = -1; yy <= h; yy++) for (var xx = -1; xx <= w; xx++) {
      var sx = clamp(xx, 0, w - 1), sy = clamp(yy, 0, h - 1), o = (sy * w + sx) * 4, d = ((r[1] + yy) * W + r[0] + xx) * 4;
      D[d] = b.charCodeAt(o); D[d + 1] = b.charCodeAt(o + 1); D[d + 2] = b.charCodeAt(o + 2); D[d + 3] = b.charCodeAt(o + 3) >= am ? 255 : 0;
    }
  });
  return { w: W, h: Hh, data: D, rect: rect };
}
/** 一塊布的約束：邊（三角形的邊）＋ 跨點（同一條格線上隔一點的兩點，布不會揉成一團）；靜止長度 ＝ 雕刻作品那一刻的距離。 */
function meshCons(pos, T) {
  var n = pos.length, E = new Map(), ea = [], eb = [], adj = [], te = [], i, j, k;
  for (i = 0; i < n; i++) adj.push([]);
  for (j = 0; j < T.length; j += 3) for (k = 0; k < 3; k++) {
    var a = T[j + k], b = T[j + (k + 1) % 3], kk = a < b ? a * 65536 + b : b * 65536 + a, e = E.get(kk);
    if (e === undefined) { e = ea.length; E.set(kk, e); ea.push(a); eb.push(b); adj[a].push(b); adj[b].push(a); }
    te.push(e);
  }
  var B = new Set(), ba = [], bb = [];
  for (i = 0; i < n; i++) for (j = 0; j < adj[i].length; j++) for (k = j + 1; k < adj[i].length; k++) {
    var x = adj[i][j], y = adj[i][k];
    if (dot(norm(sub(pos[x], pos[i])), norm(sub(pos[y], pos[i]))) > -0.9) continue;
    var kb = x < y ? x * 65536 + y : y * 65536 + x; if (B.has(kb)) continue; B.add(kb); ba.push(x); bb.push(y);
  }
  var p0 = new Float32Array(n * 3), rest = new Float32Array(ea.length), brest = new Float32Array(ba.length);
  pos.forEach(function (w, q) { p0[q * 3] = w[0]; p0[q * 3 + 1] = w[1]; p0[q * 3 + 2] = w[2]; });
  for (i = 0; i < ea.length; i++) rest[i] = len(sub(pos[ea[i]], pos[eb[i]])) * SLACK;
  for (i = 0; i < ba.length; i++) brest[i] = len(sub(pos[ba[i]], pos[bb[i]])) * SLACK;
  return { n: n, p0: p0, tris: T, te: new Uint16Array(te), ea: new Uint16Array(ea), eb: new Uint16Array(eb), rest: rest, ba: new Uint16Array(ba), bb: new Uint16Array(bb), brest: brest };
}
/** 細格 → 粗格：方帆 N×N、三角帆（第 r 列 N−r 點）、N 是單數 ⇒ 取偶數列偶數行；其他形狀 ⇒ 不縮（粗格 ＝ 細格）。
 *  回：idx（粗格點 → 細格點）、tris（粗格三角形）、mi／mw（每個細格點由哪幾個粗格點、各佔多少內插）。 */
function coarseOf(n, T) {
  var N = Math.round(Math.sqrt(n)), M = Math.round((Math.sqrt(8 * n + 1) - 1) / 2), kind = null, off = null, i, j, k;
  function ok(rc) {
    for (j = 0; j < T.length; j += 3) for (k = 0; k < 3; k++) { var a = rc(T[j + k]), b = rc(T[j + (k + 1) % 3]); if (Math.abs(a[0] - b[0]) > 1 || Math.abs(a[1] - b[1]) > 1) return false; }
    return true;
  }
  var sq = function (q) { return [Math.floor(q / N), q % N]; };
  if (N * N === n && N % 2 && ok(sq)) kind = 'sq';
  else if (M * (M + 1) / 2 === n && M % 2) {
    off = []; for (i = 0; i <= M; i++) off.push(i * M - i * (i - 1) / 2);
    var row = new Int32Array(n); for (i = 0; i < M; i++) for (j = off[i]; j < off[i + 1]; j++) row[j] = i;
    var tr = function (q) { return [row[q], q - off[row[q]]]; };
    if (ok(tr)) { kind = 'tri'; N = M; }
  }
  var mi = new Int32Array(n * 4), mw = new Float32Array(n * 4);
  if (!kind) {
    for (i = 0; i < n; i++) { mi[i * 4] = i; mw[i * 4] = 1; }
    return { kind: 'full', idx: Array.from({ length: n }, function (_, q) { return q; }), tris: Array.prototype.slice.call(T), mi: mi, mw: mw };
  }
  var Nc = (N + 1) / 2, idx = [], ct = [], R, C;
  var offc = []; for (R = 0; R <= Nc; R++) offc.push(kind === 'sq' ? R * Nc : R * Nc - R * (R - 1) / 2);
  function rowLen(R) { return kind === 'sq' ? Nc : Nc - R; }
  function fine(r, c) { return kind === 'sq' ? r * N + c : off[r] + c; }
  function cc(r, c) { return offc[r / 2] + c / 2; }                    // 細格 (r, c)（都是偶數）在粗格的編號
  for (R = 0; R < Nc; R++) for (C = 0; C < rowLen(R); C++) idx.push(fine(2 * R, 2 * C));
  for (R = 0; R + 1 < Nc; R++) for (C = 0; C + 1 < rowLen(R); C++) {
    var a = offc[R] + C;
    if (kind === 'sq') { ct.push(a, a + 1, a + Nc + 1, a, a + Nc + 1, a + Nc); continue; }
    ct.push(a, a + 1, offc[R + 1] + C);
    if (C + 2 < rowLen(R)) ct.push(a + 1, offc[R + 1] + C + 1, offc[R + 1] + C);
  }
  for (var r = 0; r < N; r++) for (var c = 0; c < (kind === 'sq' ? N : N - r); c++) {
    var f = fine(r, c) * 4, w = [];
    if (!(r & 1) && !(c & 1)) w = [[r, c]];
    else if (!(r & 1)) w = [[r, c - 1], [r, c + 1]];
    else if (!(c & 1)) w = [[r - 1, c], [r + 1, c]];
    else w = kind === 'sq' ? [[r - 1, c - 1], [r - 1, c + 1], [r + 1, c - 1], [r + 1, c + 1]] : [[r - 1, c + 1], [r + 1, c - 1]];   // 三角帆的對角線是 (r+1, c)–(r, c+1) 那一斜
    w.forEach(function (x, q) { mi[f + q] = cc(x[0], x[1]); mw[f + q] = 1 / w.length; });
  }
  return { kind: kind, idx: idx, tris: ct, mi: mi, mw: mw };
}
/** 布的粗格 ⇒ 細格位置（TASK-0669 從 11_rig_gpu.js 搬來：接觸、碎布、收帆凍結都在算它，畫帆也用）。 */
function clothFine(c, out) {
  var T = c.T, p = c.p, mi = T.mi, mw = T.mw;
  for (var i = 0; i < T.n; i++) {
    var o = i * 4, x = 0, y = 0, z = 0;
    for (var k = 0; k < 4; k++) { var w = mw[o + k]; if (!w) break; var q = mi[o + k] * 3; x += p[q] * w; y += p[q + 1] * w; z += p[q + 2] * w; }
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
  }
  return out;
}
function clothSetup(H, C) {                            // 船型 H 的布模板；暫存區（兩艘、各型共用）照目前最大的那一型配；C ＝ 快取的記錄（06_cache.js：rbox、cloth）
  H.rbox = C ? C.rbox : H.rig.ropes.map(function (r) { return ropeBox(r.pts); });
  var n0 = H.nSail0 === undefined ? H.rig.sails.length : H.nSail0;      // 作品自己的帆（快取只存這幾面）；後面是陣營旗（77_colours.js teamFlagsSetup，每次現算）
  H.cloth = H.rig.sails.map(function (s, k) { if (C && k < n0 && C.cloth[k]) return C.cloth[k]; var t = clothTemplate(H, s); t.ti = k; return t; });   // ti：第幾面帆 ⇒ 貼圖集的哪一格（布片、斷開的那一團也認得）
  H.sailAtlas = sailAtlas(H.rig.sails.concat(H.teamExtra || [])); H.sailTexGL = null;   // teamExtra：陣營旗紅方那份、替換作品旗的藍紅兩份（77_colours.js teamFlagsSetup；畫的時候 sailRect 挑）              // 貼圖集不進快取（照 vxk 現算；GL 貼圖第一次畫才建，11_rig_gpu.js sailTex）
  var mc = 1;                                                            // 畫帆的暫存區（SBV／SBI／SBN／SBP）由 11_rig_gpu.js sailBuf 照當下要畫的配（TASK-0669）
  H.cloth.forEach(function (C) { mc = Math.max(mc, C.sim.n); });
  if (!CACC || CACC.length < mc * 3) { CACC = new Float32Array(mc * 3); CCNT = new Uint8Array(mc); }
}
/** 張開的帆從雕刻作品那一刻的形狀開始（開局、收帆後再張、物理剛打開）。 */
function clothInit(c) {
  c.contactWarm = false;
  c.contactSides = Object.create(null);
  var T = c.T.sim; c.p = Float32Array.from(T.p0); c.q = Float32Array.from(T.p0);
  c.pin = new Uint8Array(T.n); for (var i = 0; i < T.n; i++) c.pin[i] = T.hk[i] ? 1 : 0;
  c.brk = new Uint8Array(T.ea.length); c.bbrk = new Uint8Array(T.ba.length); c.tv = new Uint8Array(c.T.n); c.torn = false; c.loose = false; c.free = 0; c.gone = false; c.npin = -1;
}
/** 帆桁已經追風轉過（m.rot）⇒ 布照作品的形狀、繞帆桁轉同樣的角度開始，速度 0（clothInit 之後；收帆再張、物理開著時才掉下來的帆）。
 *  綁在帆桁上的點照它自己那根；綁在格、繩上的不轉；沒綁的點照這面帆綁最多點的那根（同一根桅的帆桁轉軸在一條線上；憲法號開局 8 秒量到同桅四根 1.049–1.120 rad）。沒綁帆桁的帆（支索帆）不動。
 *  ⛔ 以前照作品的角度重來、釘點卻在轉過的帆桁上（yardPins）⇒ 第一步整面帆被拉過去、往外噴（Tim 2026-10-17：「放帆的一瞬間 帆會往外側噴出一段距離」；
 *    憲法號 main-topsail 帆桁轉 1.084 rad，放帆第一步有一點一步走 127.6 格，平常一步最多 1.87）。 */
function clothBrace(sh, c) {
  var T = c.T.sim, yk = T.yk, cnt = {}, top = -1, i; if (!yk || !sh.yards.some(function (m) { return m.rot; })) return;
  for (i = 0; i < T.n; i++) if (yk[i] >= 0 && (cnt[yk[i]] = (cnt[yk[i]] || 0) + 1) > (cnt[top] || 0)) top = yk[i];
  if (top < 0) return;
  for (i = 0; i < T.n; i++) {
    if (yk[i] < 0 && T.hk[i]) continue;                                // 綁在格、繩上的（course 的帆腳、側邊）照作品的位置
    var m = sh.models[yk[i] >= 0 ? yk[i] : top]; if (!m || !m.rot) continue;
    var o = i * 3, w = rotZ([T.p0[o], T.p0[o + 1], T.p0[o + 2]], m.piv, m.rot);
    c.p[o] = c.q[o] = w[0]; c.p[o + 1] = c.q[o + 1] = w[1];
  }
}
/** 靠的東西還在不在：格（被打掉 ⇒ 不在）、繩（斷了）、模型（飛了）；3 ＝ 帆還算數就在。 */
function holds(sh, s, k, v) { return k === 1 ? hullGp(sh.grid, v) > 0 : k === 2 ? !sh.ropes[v].dead : k === 3 ? !!s && !s.dead : k === 4 ? sh.models[v].alive : false; }
function clothPins(sh, s, c) {
  var T = c.T.sim, n = 0;
  for (var i = 0; i < T.n; i++) if (c.pin[i]) { if (holds(sh, s, T.hk[i], T.hv[i])) n++; else c.pin[i] = 0; }
  c.npin = n;
}
/** 撕開：打到的那一點 r 格內的邊斷掉（布上開一個洞，大一點就裂成兩半）。r：鏈彈 7、實心與爆裂穿過 3。
 *  洞裡那一塊布不是消失：切成布片、照物理飄下去（34_shreds.js shredCut；b ＝ 砲彈）。 */
function tearCloth(sh, s, L, r, b) {
  var c = sh.cl && sh.cl[s.k]; if (!PHYS || !c || !c.p) return;
  var old = Uint8Array.from(c.tv);                                     // 撕之前藏著的（之前的洞）⇒ 只有這一發新藏的才變布片
  var T = c.T.sim, p = c.p, r2 = (r || 7) * (r || 7), bi = 0, bd = 1e9, i;
  for (i = 0; i < T.n; i++) { var dx = p[i * 3] - L[0], dy = p[i * 3 + 1] - L[1], dz = p[i * 3 + 2] - L[2], d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; bi = i; } }   // 照布現在的位置
  var cx = p[bi * 3], cy = p[bi * 3 + 1], cz = p[bi * 3 + 2];
  function near(q) { var dx = p[q * 3] - cx, dy = p[q * 3 + 1] - cy, dz = p[q * 3 + 2] - cz; return dx * dx + dy * dy + dz * dz < r2; }
  for (i = 0; i < T.ea.length; i++) if (near(T.ea[i]) || near(T.eb[i])) c.brk[i] = 1;
  for (i = 0; i < T.ba.length; i++) if (near(T.ba[i]) || near(T.bb[i])) c.bbrk[i] = 1;
  // 畫的那層：碰到斷掉約束的粗格點，從它內插的細格點都不畫（洞的邊緣多吃一圈）。
  // ⛔ 只藏彈點附近的細格點：粗格點間距約 1 m，常常只切斷一個粗格點 —— 它沒了約束一直往下掉，
  //   旁邊沒藏到的細格三角形還從它內插，被拉成一條條直到海裡的布帶（Tim 2026-10-12 截到）。
  var touch = new Uint8Array(T.n), mi = c.T.mi, mw = c.T.mw;
  for (i = 0; i < T.ea.length; i++) if (c.brk[i]) { touch[T.ea[i]] = 1; touch[T.eb[i]] = 1; }
  for (i = 0; i < c.T.n; i++) for (var k = 0; k < 4; k++) { var o = i * 4 + k; if (!mw[o]) break; if (touch[mi[o]]) { c.tv[i] = 1; break; } }
  c.torn = true;
  if (b) shredCut(sh, c, old, b);
}
function solve(ea, eb, rest, brk, p, pin, k) {
  for (var e = 0; e < ea.length; e++) {
    if (brk && brk[e]) continue;
    var a = ea[e], b = eb[e], wa = pin[a] ? 0 : 1, wb = pin[b] ? 0 : 1; if (!(wa + wb)) continue;
    var ia = a * 3, ib = b * 3, dx = p[ib] - p[ia], dy = p[ib + 1] - p[ia + 1], dz = p[ib + 2] - p[ia + 2], l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (l < 1e-9) continue;
    var f = (l - rest[e]) / l * k / (wa + wb);
    if (wa) { p[ia] += dx * f; p[ia + 1] += dy * f; p[ia + 2] += dz * f; }
    if (wb) { p[ib] -= dx * f; p[ib + 1] -= dy * f; p[ib + 2] -= dz * f; }
  }
}
// ── 布的拉伸上限（TASK-0821；Tim 2026-10-22「變得太過Q彈 變形太大了」「是否可以讓布有拉伸極限」「不能像橡膠一樣」）──
// 為什麼：距離約束一步只解 RIG_LV.it 次（高 4 次）⇒ 強風（暴風雨的風 2.2 倍、風壓 ∝ 風速²）壓上去解不回靜止長度，帆被拉成長帶、鬆手又彈回來。
//   量過（暴風雨、兩艘憲法號、物理全開，每面帆每條邊 長度 ÷ 靜止長度）：99 百分位 1.2～3.0 倍、最大 16.7 倍。
// 做法（迭代解完之後，clothStep 最後）：
//   ① 每條邊超過靜止長度 ×（1 ＋ SAIL_STRETCH）⇒ 夾回來（兩端照權重分；釘住的不動）。
//   ② 整面（long-range attachment）：每個布點沿著布（還連著的邊、照靜止長度）到最近一個綁點的距離 D（多源 Dijkstra）⇒
//      離那個綁點的直線距離超過 D ×（1 ＋ SAIL_STRETCH）⇒ 拉回來。綁點 ＝ 現在釘住的點（帆桁、格、繩）＋ 被 sheet 拉住的帆腳；
//      綁點、斷掉的邊、sheet 變了才重算（簽名 c.lraSig）。斷開的那一塊沿著布到不了綁點 ⇒ D 無限大 ⇒ 不拉（照樣掉下去）。
// ⛔ 只給人看：帆的形狀不進戰局（航速照帆的狀態算，不照布）。
var SAIL_STRETCH = DEBUG && Q.has('strain') ? +Q.get('strain') : 0.04;
var SAIL_LIM_IT = DEBUG && Q.has('strainit') ? +Q.get('strainit') : 2;   // 每條邊最多夾幾遍（每小步）
var SAIL_SUB = !(DEBUG && Q.get('sailsub') === '0');                      // 布切小步（clothStep；?debug=1&sailsub=0 ⇒ 照以前一步解 itn 次，對照用）   // 布最多拉長幾成（?debug=1&strain=0 ⇒ 關掉，對照用）
/** 布的鄰接表（照結構邊 ea、eb；同一個模板只建一次）。 */
function clothAdj(T) {
  if (T.adjS) return T;
  var n = T.n, cnt = new Int32Array(n + 1), e;
  for (e = 0; e < T.ea.length; e++) { cnt[T.ea[e] + 1]++; cnt[T.eb[e] + 1]++; }
  for (e = 0; e < n; e++) cnt[e + 1] += cnt[e];
  var at = cnt.slice(0, n), nb = new Int32Array(cnt[n]), ed = new Int32Array(cnt[n]);
  for (e = 0; e < T.ea.length; e++) { var a = T.ea[e], b = T.eb[e]; nb[at[a]] = b; ed[at[a]++] = e; nb[at[b]] = a; ed[at[b]++] = e; }
  T.adjS = cnt; T.adjN = nb; T.adjE = ed; return T;
}
/** 綁點、斷掉的邊、sheet 的簽名（變了 ⇒ 重算 D）。 */
function clothLraSig(sh, c) {
  var h = 0, pin = c.pin, i;
  for (i = 0; i < pin.length; i++) if (pin[i]) h = (h * 31 + i + 1) | 0;
  if (c.torn) for (i = 0; i < c.brk.length; i++) if (c.brk[i]) h = (h * 17 + i + 7) | 0;
  if (c.tt) for (i = 0; i < c.tt.length; i++) { var r = sh.ropes[c.tt[i].j]; if (!r.dead && !(sh.tCut && sh.tCut[c.tt[i].j])) h = (h * 13 + c.tt[i].i + 3) | 0; }
  return h;
}
/** 多源 Dijkstra：每個布點沿著布到最近綁點的距離 c.lraD、是哪一個綁點 c.lraA（到不了 ⇒ -1）。 */
function clothLra(sh, c) {
  var T = clothAdj(c.T.sim), n = T.n, D = c.lraD || (c.lraD = new Float32Array(n)), A = c.lraA || (c.lraA = new Int32Array(n)), i;
  D.fill(Infinity); A.fill(-1);
  var hp = [], hd = [];                                                  // 二元堆積（距離、點）
  function push(d, v) { var k = hp.length; hp.push(v); hd.push(d); while (k > 0) { var pa = (k - 1) >> 1; if (hd[pa] <= d) break; hp[k] = hp[pa]; hd[k] = hd[pa]; k = pa; } hp[k] = v; hd[k] = d; }
  function pop() { var v = hp[0], lv = hp.pop(), ld = hd.pop(), k = 0, m = hp.length; if (m) { while (true) { var l = 2 * k + 1, r = l + 1, s = k; if (l < m && hd[l] < (s === k ? ld : hd[s])) s = l; if (r < m && hd[r] < (s === k ? ld : hd[s])) s = r; if (s === k) break; hp[k] = hp[s]; hd[k] = hd[s]; k = s; } hp[k] = lv; hd[k] = ld; } return v; }
  function seed(v) { if (D[v] > 0) { D[v] = 0; A[v] = v; push(0, v); } }
  for (i = 0; i < n; i++) if (c.pin[i]) seed(i);
  if (c.tt) for (i = 0; i < c.tt.length; i++) { var r = sh.ropes[c.tt[i].j]; if (!r.dead && !(sh.tCut && sh.tCut[c.tt[i].j])) seed(c.tt[i].i); }
  var done = new Uint8Array(n);
  while (hp.length) {
    var u = pop(); if (done[u]) continue; done[u] = 1;
    for (var k = T.adjS[u]; k < T.adjS[u + 1]; k++) {
      var e = T.adjE[k]; if (c.torn && c.brk[e]) continue;
      var v = T.adjN[k], d = D[u] + T.rest[e];
      if (d < D[v]) { D[v] = d; A[v] = A[u]; push(d, v); }
    }
  }
}
/** 拉伸上限（clothStep 迭代之後）：① 每條邊 ② 每個點到它的綁點（見上）。 */
function clothLimit(sh, c) {
  var T = c.T.sim, p = c.p, pin = c.pin, k1 = 1 + SAIL_STRETCH, ea = T.ea, eb = T.eb, rest = T.rest, brk = c.torn ? c.brk : null, e, i, pass, bad;
  for (pass = 0, bad = 1; pass < SAIL_LIM_IT && bad; pass++) for (bad = 0, e = 0; e < ea.length; e++) {   // 相鄰的邊互相拉 ⇒ 一遍夾不完：最多 SAIL_LIM_IT 遍、沒有超過的就停
    if (brk && brk[e]) continue;
    var a = ea[e], b = eb[e], wa = pin[a] ? 0 : 1, wb = pin[b] ? 0 : 1; if (!(wa + wb)) continue;
    var ia = a * 3, ib = b * 3, dx = p[ib] - p[ia], dy = p[ib + 1] - p[ia + 1], dz = p[ib + 2] - p[ia + 2], l2 = dx * dx + dy * dy + dz * dz, lm = rest[e] * k1;
    if (l2 <= lm * lm) continue;
    var l = Math.sqrt(l2), f = (l - lm) / l / (wa + wb); bad++;
    if (wa) { p[ia] += dx * f; p[ia + 1] += dy * f; p[ia + 2] += dz * f; }
    if (wb) { p[ib] -= dx * f; p[ib + 1] -= dy * f; p[ib + 2] -= dz * f; }
  }
  var sg = clothLraSig(sh, c);
  if (c.lraSig !== sg || !c.lraD) { clothLra(sh, c); c.lraSig = sg; }
  var D = c.lraD, A = c.lraA;
  for (i = 0; i < T.n; i++) {
    var an = A[i]; if (an < 0 || an === i || pin[i]) continue;
    var o = i * 3, q = an * 3, x = p[o] - p[q], y = p[o + 1] - p[q + 1], z = p[o + 2] - p[q + 2], d2 = x * x + y * y + z * z, lim = D[i] * k1;
    if (d2 <= lim * lim) continue;
    var s = lim / Math.sqrt(d2); p[o] = p[q] + x * s; p[o + 1] = p[q + 1] + y * s; p[o + 2] = p[q + 2] + z * s;
  }
}
/** 落在格子裡（甲板、船殼）⇒ 退回上一步的位置（上一步本來就在格子裡的不管：繩頭從錨格裡長出來）。 */
function hitGrid(g, p, q, o) {
  if (g.get(Math.floor(p[o]), Math.floor(p[o + 1]), Math.floor(p[o + 2])) && !g.get(Math.floor(q[o]), Math.floor(q[o + 1]), Math.floor(q[o + 2]))) { p[o] = q[o]; p[o + 1] = q[o + 1]; p[o + 2] = q[o + 2]; }
}
function clothStep(sh, c, wl, gv, h) {                 // c.kw：風壓倍率（帆的布片，34_shreds.js；帆 ＝ 1）；c.ev：這一塊幾步走一次（遠方的船放大，physStep）；h：切小步時這一小步幾秒（TASK-0797；沒給 ＝ 一整段）
  var T = c.T.sim, n = T.n, p = c.p, q = c.q, pin = c.pin, tr = T.tris, A = CACC, N = CCNT, HC = h || (c.ev || steps60(rigLv().every)) * DT, inv = 1 / (3 * HC / (SAIL_SUB ? c.itn || rigLv().it : 1)), dmp = decay60(DAMP, HC), kw = KW * (c.kw || 1), i, j, x;
  A.fill(0, 0, n * 3); N.fill(0, 0, n);
  for (j = 0; j < tr.length; j += 3) {           // 風壓：每個三角形沿法線推，大小 ∝（相對風在法線上的分量）²，相對風扣掉布自己的速度
    if (c.torn && (c.brk[T.te[j]] || c.brk[T.te[j + 1]] || c.brk[T.te[j + 2]])) continue;
    var a = tr[j] * 3, b = tr[j + 1] * 3, d = tr[j + 2] * 3;
    var ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[d] - p[a], vy = p[d + 1] - p[a + 1], vz = p[d + 2] - p[a + 2];
    var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l < 1e-9) continue;
    nx /= l; ny /= l; nz /= l;
    var rx = wl[0] - (p[a] - q[a] + p[b] - q[b] + p[d] - q[d]) * inv, ry = wl[1] - (p[a + 1] - q[a + 1] + p[b + 1] - q[b + 1] + p[d + 1] - q[d + 1]) * inv, rz = wl[2] - (p[a + 2] - q[a + 2] + p[b + 2] - q[b + 2] + p[d + 2] - q[d + 2]) * inv;
    var dn = rx * nx + ry * ny + rz * nz, f = kw * dn * Math.abs(dn);
    f *= 1 + FLUTTER * Math.sin((p[a] * 0.9 + p[a + 2]) * 0.06 - SIMT * 5.5);   // 一道一道走過布面的風（不抽亂數）
    var fx = f * nx, fy = f * ny, fz = f * nz;
    A[a] += fx; A[a + 1] += fy; A[a + 2] += fz; A[b] += fx; A[b + 1] += fy; A[b + 2] += fz; A[d] += fx; A[d + 1] += fy; A[d + 2] += fz;
    N[a / 3]++; N[b / 3]++; N[d / 3]++;
  }
  // 速度保留 dmp 照每秒換算（decay60；以前固定 DAMP²，是一步 1/30 秒的值 ⇒ 照畫面格算、遠方降速一步變長時每秒的衰減變弱、布更彈；一步 1/30 秒時跟以前一樣）
  // 小步長（TASK-0821；Macklin 等 2019「Small Steps」）：以前一步走完再解 itn 次 ⇒ 張力一次只往下傳一條邊、強風下解不回來（像橡膠）；
  //   現在同樣的花費切成 itn 小步、每小步解一次（風壓照這一步開頭算一次、每小步共用；速度保留照每秒換算 ⇒ 跟切幾步無關）。SAIL_SUB 0 ⇒ 照以前。
  for (var it = 0, itn = c.itn || rigLv().it, sub = SAIL_SUB ? itn : 1, hs = HC / sub, d2s = hs * hs, dms = sub > 1 ? Math.pow(dmp, 1 / sub) : dmp; it < itn; it++) {
    if (it < sub) for (i = 0; i < n; i++) {
      if (pin[i]) continue;
      var o = i * 3, kk = N[i] ? 1 / N[i] : 0;
      for (x = 0; x < 3; x++) { var cur = p[o + x], vel = (cur - q[o + x]) * dms; q[o + x] = cur; p[o + x] = cur + vel + (A[o + x] * kk + gv[x]) * d2s; }
      if (c.loose) hitGrid(sh.grid, p, q, o);
    }
    solve(T.ea, T.eb, T.rest, c.torn ? c.brk : null, p, pin, 1); if (it & 1) solve(T.ba, T.bb, T.brest, c.torn ? c.bbrk : null, p, pin, 0.5); if (c.tt) tethSolve(sh, c);   // c.tt：帆腳被 sheet 拉住（tethOf）
    if (sub > 1 && SAIL_STRETCH > 0) clothLimit(sh, c);               // 拉伸上限（TASK-0821）：每小步夾一次
  }
  if (sub === 1 && SAIL_STRETCH > 0) clothLimit(sh, c);
}
/** 剛斷的繩 ⇒ 垂下來的繩：重新取樣（每段 ≤ SEG 格，原本的弧度與鬆緊照留），兩端各記著靠什麼；被打斷的從斷點分成兩段。 */
function spawnLoose(sh, r) {
  var src = r.pts, m = src.length / 3, P = [], i, t;
  for (i = 0; i + 1 < m; i++) {
    var a = [src[i * 3], src[i * 3 + 1], src[i * 3 + 2]], b = [src[i * 3 + 3], src[i * 3 + 4], src[i * 3 + 5]], k = Math.max(1, Math.ceil(len(sub(b, a)) / SEG));
    for (t = 0; t < k; t++) P.push(lerp3(a, b, t / k));
  }
  P.push([src[m * 3 - 3], src[m * 3 - 2], src[m * 3 - 1]]);
  function end(an, mk, pr) { return an >= 0 ? [1, an] : mk !== undefined ? [4, mk] : pr !== undefined ? [2, pr] : [0, -1]; }
  var ea = end(r.a, r.ma, r.pa), eb = end(r.b, r.mb, r.pb), parts = [[P, ea, eb]];
  // 不釘在空中（Tim 2026-10-16：「憲法號 應該是帆被打掉後繩子殘留」「不能綁定在空中」）：
  //   ① 帆掉了跟著斷的帆自己的繩（sailLinesDie 標 offSail）⇒ 離帆近的那一端放開。⛔ 以前兩端照 linkRopes 的依靠釘：上層帆的 sheet 只有 0.3 m、兩端都算綁在下一層的帆桁 ⇒ 帆沒了，一小段繩留在帆桁端。
  //   ② 綁格子的那一端：端點 ROPE_FIX_D（0.15 m）內現在真的有格才釘。⛔ 以前照 linkRopes 的錨（0.5 m 內最近的格）釘 ⇒ 斷掉的繩一端停在離木頭 0.2～0.5 m 的空中。
  if (r.offSail) { var sv = r.offSail.verts, dE = [P[0], P[P.length - 1]].map(function (w) { var b = 1e9; for (var k = 0; k < sv.length; k += 3) { var x = sv[k] - w[0], y = sv[k + 1] - w[1], z = sv[k + 2] - w[2]; b = Math.min(b, x * x + y * y + z * z); } return b; });
    if (dE[0] <= dE[1]) ea = [0, -1]; else eb = [0, -1]; parts = [[P, ea, eb]]; }
  if (ea[0] === 1 && !gridTouch(sh.grid, P[0], ROPE_FIX_D)) { ea = [0, -1]; parts = [[P, ea, eb]]; }
  if (eb[0] === 1 && !gridTouch(sh.grid, P[P.length - 1], ROPE_FIX_D)) { eb = [0, -1]; parts = [[P, ea, eb]]; }
  if (r.cutL) {
    var bi = 0, bd = 1e9;
    for (i = 0; i + 1 < P.length; i++) { var d = segDist2(r.cutL, P[i][0], P[i][1], P[i][2], P[i + 1][0], P[i + 1][1], P[i + 1][2]); if (d < bd) { bd = d; bi = i; } }
    parts = [[P.slice(0, bi + 1), ea, [0, -1]], [P.slice(bi + 1), [0, -1], eb]];
  }
  parts.forEach(function (pt) {
    var Q = pt[0], n = Q.length; if (n < 2) return;
    var p = new Float32Array(n * 3), rest = new Float32Array(n - 1);
    Q.forEach(function (w, j) { p[j * 3] = w[0]; p[j * 3 + 1] = w[1]; p[j * 3 + 2] = w[2]; if (j) rest[j - 1] = len(sub(w, Q[j - 1])); });
    var o = { p: p, q: Float32Array.from(p), rest: rest, n: n, pin: new Uint8Array(n), hk: [pt[1][0], pt[2][0]], hv: [pt[1][1], pt[2][1]], col: r.col, free: 0, of: r.of || r };   // of：從哪一條繩垂下來的（帆匠修好那條 ⇒ 把垂著的收掉，47_sailmaker.js）
    o.pin[0] = o.hk[0] ? 1 : 0; o.pin[n - 1] = o.hk[1] ? 1 : 0;
    looseMark(sh, o); ropePins(sh, o); sh.loose.push(o);
  });
  if (sh.loose.length > rigLv().loose) {                                  // 太多 ⇒ 先丟已經整條鬆掉的，再丟最早的
    var drop = sh.loose.findIndex(function (o) { return !o.pin[0] && !o.pin[o.n - 1]; });
    sh.loose.splice(drop >= 0 ? drop : 0, 1);
  }
}
// 釘著的那一端跟著它靠的東西走（Tim 2026-10-19 截圖：「憲法號 帆被打掉後出現浮空纜繩」「帆還沒完全掉(看起來是掉一角落)」）：
//   量到的：上層帆的帆腳被撕掉 ⇒ sheet 放開（tethCut），另一端照舊釘在下一根帆桁的端點；之後船轉向、帆桁跟風轉（0.462 → 0.104 rad），
//   釘點卻停在放開那一刻的位置 ⇒ 離帆桁 2.2–2.3 m 的空中（電腦對電腦 140 m、main-topsail 兩條 sheet）。以前釘住的點每一步都不動（ropeStep pin）。
//   ⇒ 釘在帆桁上（hk 4、模型是 yard）：記下那一刻帆桁轉了多少，之後照帆桁多轉的角度繞它的軸轉（rotZ，跟 yardRopes／clothBrace 同一個轉法）；
//     釘在母繩上（hk 2）：記下母繩最近的那一點，母繩換了形狀（帆桁轉了 yardRopes 換新的 pts）⇒ 跟著那一點。
/** spawnLoose：兩端各記住釘在哪（帆桁的角度／母繩的第幾點）。 */
function looseMark(sh, o) {
  o.fy = [null, null]; o.fr = [null, null];
  for (var e = 0; e < 2; e++) {
    var pi = e ? o.n - 1 : 0, P = [o.p[pi * 3], o.p[pi * 3 + 1], o.p[pi * 3 + 2]];
    if (o.hk[e] === 4) { var m = sh.models[o.hv[e]]; if (m && m.kind === 'yard' && m.piv) o.fy[e] = { P: P, a0: m.rot || 0, a: 0 }; }
    else if (o.hk[e] === 2) {
      var q = sh.ropes[o.hv[e]].pts, bk = 0, bd = 1e18;
      for (var k = 0; k < q.length; k += 3) { var dx = q[k] - P[0], dy = q[k + 1] - P[1], dz = q[k + 2] - P[2], d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; bk = k; } }
      o.fr[e] = { q: q, k: bk };
    }
  }
}
/** 每一步：釘著的端點照帆桁的角度、母繩的形狀搬過去（沒變就不動）。 */
function looseFollow(sh, o) {
  if (!o.fy) return;
  for (var e = 0; e < 2; e++) {
    var pi = e ? o.n - 1 : 0, j = pi * 3, w = null;
    if (!o.pin[pi]) continue;
    var Y = o.fy[e], R = o.fr[e];
    if (Y) { var m = sh.models[o.hv[e]], a = (m.rot || 0) - Y.a0; if (a !== Y.a) { Y.a = a; w = rotZ(Y.P, m.piv, a); } }
    else if (R) { var q = sh.ropes[o.hv[e]].pts; if (q !== R.q) { R.q = q; w = [q[R.k], q[R.k + 1], q[R.k + 2]]; } }
    if (w) { o.p[j] = o.q[j] = w[0]; o.p[j + 1] = o.q[j + 1] = w[1]; o.p[j + 2] = o.q[j + 2] = w[2]; }
  }
}
/** 點 P（格座標）D 格內（量到格的表面）有沒有實心格。 */
function gridTouch(G, P, D) {
  var R = Math.ceil(D) + 1, bx = Math.floor(P[0]), by = Math.floor(P[1]), bz = Math.floor(P[2]);
  for (var dz = -R; dz <= R; dz++) for (var dy = -R; dy <= R; dy++) for (var dx = -R; dx <= R; dx++) {
    var x = bx + dx, y = by + dy, z = bz + dz; if (!G.get(x, y, z)) continue;
    var ex = Math.max(x - P[0], 0, P[0] - x - 1), ey = Math.max(y - P[1], 0, P[1] - y - 1), ez = Math.max(z - P[2], 0, P[2] - z - 1);
    if (ex * ex + ey * ey + ez * ez <= D * D) return true;
  }
  return false;
}
function ropePins(sh, o) {
  if (o.pin[0] && !holds(sh, null, o.hk[0], o.hv[0])) o.pin[0] = 0;
  if (o.pin[o.n - 1] && !holds(sh, null, o.hk[1], o.hv[1])) o.pin[o.n - 1] = 0;
}
function ropeStep(sh, o, wl, gv, dt) {                 // dt：這一次走多久（遠方的船 ＝ 幾步一次 × DT；沒給 ＝ DT）
  dt = dt || DT;
  var p = o.p, q = o.q, n = o.n, pin = o.pin, dt2 = dt * dt, dmp = decay60(DAMP, dt), i, x;   // DAMP 是 60 Hz 一步的（TASK-0798；⛔ 以前照現在的 DT ⇒ 步長一改每秒的阻尼就跟著變）
  for (i = 0; i < n; i++) {
    if (pin[i]) continue;
    var j = i * 3;
    for (x = 0; x < 3; x++) { var cur = p[j + x], vel = (cur - q[j + x]) * dmp; q[j + x] = cur; p[j + x] = cur + vel + (gv[x] + KD * (wl[x] - vel / dt)) * dt2; }
    hitGrid(sh.grid, p, q, j);
  }
  for (var it = 0, itn = rigLv().it; it < itn; it++) for (i = 0; i + 1 < n; i++) {
    var wa = pin[i] ? 0 : 1, wb = pin[i + 1] ? 0 : 1; if (!(wa + wb)) continue;
    var ia = i * 3, ib = ia + 3, dx = p[ib] - p[ia], dy = p[ib + 1] - p[ia + 1], dz = p[ib + 2] - p[ia + 2], l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (l < 1e-9) continue;
    var f = (l - o.rest[i]) / l / (wa + wb);
    if (wa) { p[ia] += dx * f; p[ia + 1] += dy * f; p[ia + 2] += dz * f; }
    if (wb) { p[ib] -= dx * f; p[ib + 1] -= dy * f; p[ib + 2] -= dz * f; }
  }
}
function underWater(sh, p, i) { return wetAt(sh, [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]], { depth: 0.5 }); }   // 繩的第 i 點在海面下 0.5 m（33_flood.js 泡水判定）
/** 每一步：相對風與重力換進船的格座標 → 剛斷的繩變成垂下來的繩 → 每面帆、每條垂下來的繩各走一步；每 0.1 秒量一次靠的東西還在不在。 */
// ── 遠方的船帆與繩降速（Tim 2026-10-14：「可以設定降速模擬，特別是遠方船隻」）──
// 物理設定「遠方帆繩」；每艘每一步照離鏡頭多遠、在不在視野裡給倍率 m（1 ＝ 照常）：
//   布：每 every × m 步走一次（時間間隔跟著放大；最多 RIG_FAR_HC 秒 ⇒ Verlet 的布步長太大會炸開，m 照它截）；垂下來的繩：每 m 步走一次、dt ＝ m × DT。
//   這一段本來就只管畫出來的樣子（不碰 rnd()、不改命中）⇒ 開關不改戰局。鏡頭還沒算過（快轉、無頭對拍）⇒ 照常。
var RIG_FAR = [null, { d1: 150, m1: 2, d2: 1e9, m2: 2, off: 2 }, { d1: 100, m1: 2, d2: 200, m2: 3, off: 4 }], RIG_FAR_HC = 0.1;
function rigFarM(sh) { return evAsk('rigFar', 1, sh); }   // 鏡頭外、遠的船降級（03_camera.js camRigFar 回答；沒有畫面 ⇒ 1 ＝ 不降級）
// ── 照畫面格算（TASK-0799）──
// 有畫面時（90_main.js frame；航行與交戰都是 —— Tim 2026-10-22 選「交戰也照畫面格算」）帆布、垂下來的繩、帆的布片、帆的碰撞 ⇒ 畫面每一格算一次（physFrame），
//   dt ＝ 這一格畫面的時間（快轉也只算畫面的那一段：×8 時布照 ×1 的速度飄 ⇒ 花費照格、不照倍數；慢動作照慢）。
//   照舊每一模擬步算的（physGame）：帆桁追風、掛著的小艇 —— 會改到打中帆桁的那幾下 ⇒ 跟畫面快慢無關。
//   跟帆桁走的繩（yardRopes：每 0.1 秒、帆桁有轉才重算＋重建繩的網格）有畫面時也改成照畫面的 0.1 秒（×8 時每真實秒最多 10 次，不是 80 次）：
//     船員爬帆索照繩的位置走（42_hands.js）⇒ 船員的位置跟畫面走過幾格有關（Tim 2026-10-22：「會影響戰局結果 沒問題的」）。
//   沒有畫面（?demo、__game.run、無頭）⇒ 整段照舊在模擬步裡（physStep），逐位元不變。
//   ⚠ 代價：布的形狀跟畫面走過幾格有關 ⇒ 打中帆的那幾下跟畫面快慢有關（Tim 2026-10-22：「不追求一致性」）。
//   整艘不在畫面裡（03_camera.js camRigSeen；設定「遠方帆繩、船員」照常 ⇒ 不算看不看得到）⇒ 布與垂下來的繩每 RIG_OFF_HC 秒才走一步、一步走完不切小步（不凍結）（Tim 2026-10-22：「不用完全凍結 可以降低模擬步(但每步模擬步長增加)」）；
//   遠方、畫面外（rigFarM > 1）的布迭代減半（c.itn）。
var RIG_OFF_HC = +(DEBUG && Q.get('offhc') || 0.1);                   // 秒：畫面外的布一步最多走多久（量過：0.2 ⇒ 離開 10 秒後最鼓那一點平均 232 格、看得到時 76；0.1 ⇒ 120，轉回來 1 秒內鬆回 67）（上限 ⇒ Verlet 不炸開；超過照 physVis 那一行夾住、不切 —— Tim 2026-10-22「模擬步長也可以設定一個上限(避免炸開)」）；?debug=1&offhc= 量用
var VIS_FRAME = false, PHF_I = 0, PHF_CHK = 0;                      // VIS_FRAME：這一格畫面布照畫面格算（frame 開頭設、結尾清 ⇒ frame 以外一律 false）；PHF_I 畫面格的序號（錯開各面帆）、PHF_CHK 累到 0.1 秒做一次「每 0.1 秒」的那幾項
function physWind(sh) {                                              // 相對風、重力換進船的格座標
  var W = norm(WIND), ws = WIND_SAIL * WIND_K * (1 + GUST[0] * Math.sin(SIMT * 0.9 + sh.phase) + GUST[1] * Math.sin(SIMT * 2.7 + 1.3) + GUST[2] * Math.sin(SIMT * 6.1 + sh.phase * 2)) * WX.wind * WIND_SPD;   // 陣風（不用亂數）；天氣：暴風雨 ×2.2；風速會變（08_weather.js）
  ws = Math.min(ws, WIND_CAP);                                         // 上限（細節設定「風速上限」，預設 30 m/s；Tim 2026-10-15：暴風雨裡帆被吹成螺旋、「上限可以比這個變形幅度稍微小一點就好」⇒ 只夾暴風雨陣風的峰值（沒有上限時可到 50 m/s）；晴天峰值約 23、暴風雨平常約 23 都碰不到）
  return [M4.dir(sh.inv, W[0] * ws - sh.vel[0], W[1] * ws - sh.vel[1], W[2] * ws - sh.vel[2]), M4.dir(sh.inv, 0, -G, 0)];
}
/** 會改戰局的那一段（每一模擬步）：帆桁追風、每 0.1 秒跟帆桁走的繩、掛著的小艇。 */
function physGame(sh, wl, gv, chk) {
  if (sh.yards.length) { braceYards(sh, wl, DT); if (chk) yardRopes(sh); }
  if (sh.hangs) swingHangs(sh, gv);
}
function physStep(sh) {
  var w = physWind(sh), si = Math.round(SIMT / DT), chk = si % everySteps(0.1) === 0;   // chk 每 0.1 秒
  physGame(sh, w[0], w[1], chk);
  physVis(sh, w[0], w[1], si, chk, DT, DT);
}
/** 有畫面時模擬步裡只走帆桁追風、掛著的小艇（布、跟帆桁走的繩在 physFrame）。 */
function physGameStep(sh) { var w = physWind(sh); physGame(sh, w[0], w[1], false); }
/** 畫面這一格（90_main.js frame；VIS_FRAME）：每艘的布、垂下來的繩、布片走 h 秒（hs ＝ 這一格模擬走了多久：落海的布片照它退）。 */
function physFrame(h, hs) {
  var pt0 = performance.now(); PHF_I++; PHF_CHK += h;
  var chk = PHF_CHK >= 0.1 - 1e-9; if (chk) PHF_CHK = 0;
  SHIPS.forEach(function (sh) { if (sh.sink < 40) { var w = physWind(sh); if (chk && sh.yards.length) yardRopes(sh); physVis(sh, w[0], w[1], PHF_I, chk, h, hs, evAsk('rigSeen', true, sh)); } });   // 看不到 ⇒ 步少、每步長（TASK-0802）
  clothContactsRun();
  PHYS_MS = PHYS_MS * 0.98 + (performance.now() - pt0) * 0.02;
}
/** 只給人看的那一段：si ＝ 第幾步（或第幾格畫面）、h ＝ 一步（一格）幾秒、hs ＝ 這一段模擬走了多久（模擬步裡 ＝ DT）。 */
function physVis(sh, wl, gv, si, chk, h, hs, seen) {                 // seen ＝ false：整艘不在畫面裡（physFrame；模擬步裡不給 ⇒ 照看得到算）
  var i, off = seen === false, ev = stepsAt(rigLv().every, h), m = sh.rigM = rigFarM(sh), evk = off ? Math.max(1, Math.floor(RIG_OFF_HC / h + 1e-6)) : ev * Math.max(1, Math.min(m, Math.floor(RIG_FAR_HC / (ev * h) + 1e-6))), mr = off ? evk : m;   // mr：垂下來的繩幾步走一次   // evk：布幾步走一次（遠方放大）；every 照 60 Hz 的步數換（TASK-0798）
  // 布的一小步最多幾秒（TASK-0797）：照 60 Hz 時這塊布一步走多久（every／60 × 遠方倍率，最多 RIG_FAR_HC）⇒ 步長變大（例 0.1 秒一步）時切小步，Verlet 不炸開；60 Hz 時 hc 一定 ≤ hcap ⇒ 不切
  var hc = evk * h, hcap = off ? RIG_OFF_HC : Math.min(RIG_FAR_HC, rigLv().every * DT60 * Math.max(1, m)), ns = !SUBSTEP_OFF && hc > hcap * 1.000001 ? Math.ceil(hc / hcap - 1e-9) : 1;
  if (seen !== undefined && hc > hcap) { hc = hcap; ns = 1; }       // 照畫面格算（physFrame）：超過上限不切小步、這一步只走上限那麼多 ⇒ 布慢下來（減速模擬；Tim 2026-10-22「超過可以不切 減速模擬的概念」）—— 畫面卡、快轉時花費不跟著漲
  var ccOn = PHX.sailhit > 0 && PHX.rig >= 3;                       // 帆的碰撞（09_phx.js；Tim 2026-10-15：選項、預設關、帆與繩「高」才算）
  for (i = 0; i < sh.ropes.length; i++) { var r = sh.ropes[i]; if (r.dead && !r.lz) { r.lz = true; if (!r.moved && !(sh.tCut && sh.tCut[i])) spawnLoose(sh, r); } }   // tCut：帆腳被打掉時已經垂下來了（tethCut）⇒ 不生第二條
  sh.sails.forEach(function (s, k) {
    var c = sh.cl[k];
    var seen = c.seen; c.seen = true;
    if (c.gone) return;
    if (s.dead && !c.loose) {                                         // 物理打開之前就掉了的（late）⇒ 現在才垂下來；收著的時候掉的 ⇒ 不畫
      if (!c.late || s.furled) { c.gone = true; return; }
      clothInit(c); clothBrace(sh, c); c.hidden = false; c.loose = true;
    }
    c.late = false;
    if (s.furled && !s.dead) {                                       // 收帆：物理開著 ⇒ 先演一段收上去（畫面上往帆桁／綁邊收攏，FURL_IN 秒）再藏；判斷照舊立刻算收起來（s.furled：航速、命中、鏈彈）
      if (c.hidden || !c.p || c.loose) { c.hidden = true; c.furlF = null; return; }
      c.furlF = (c.furlF === null || c.furlF === undefined ? 1 : c.furlF) - h / FURL_IN;
      if (c.furlF <= 0) { furlFreeze(sh, c); c.hidden = true; c.furlF = null; sh.rigDirty = true; return; }   // 演完那一格凍結下來照畫、繩留著（furlFreeze）；rigDirty：重做繩（11_rig_gpu.js buildRig）
    } else if (c.furlF !== null && c.furlF !== undefined && !c.hidden) { c.furlF += h / FURL_OUT; if (c.furlF >= 1) c.furlF = null; }   // 張帆（或收到一半又張）：從帆桁放下來
    var reopen = seen && c.hidden === true && !s.furled;               // 開局初次啟用不是重新張帆；makeShip 確實以 hidden:true 建立
    if (c.hidden || !c.p) { c.fz = null; var keep = c.p && c.torn ? { brk: c.brk, bbrk: c.bbrk, tv: c.tv } : null; clothInit(c); clothBrace(sh, c); c.hidden = false; if (keep) { c.brk = keep.brk; c.bbrk = keep.bbrk; c.tv = keep.tv; c.torn = true; } if (reopen) { c.furlF = 0; sh.rigDirty = true; } }   // 收帆再張：形狀重來、破洞留著；從收攏的樣子放下來（furlF 0 → 1）
    if (c.tt === undefined) { var tl = tethOf(sh, s, c); c.tt = tl.length ? tl : null; }
    if (c.tt) for (var ti = 0; ti < c.tt.length; ti++) c.pin[c.tt[ti].i] = 0;   // 帆腳不釘：交給布、被 sheet 拉住（clothInit 每次照 hk 釘回去 ⇒ 每一步放開）
    if (c.tt && c.torn && chk && !c.loose) tethCut(sh, c);                // 帆腳那一塊被打掉 ⇒ 那幾條繩跟帆斷開、垂下來
    if (chk || c.npin < 0) clothPins(sh, s, c);
    if (seen === undefined || (si + k + sh.i + 1) % evk === 0) yardPins(sh, c);   // 照畫面格算時只在這面布要走的那一格放回帆桁（其他格放了也沒人讀；畫面外每 6 格才走一次）
    c.ev = evk; c.itn = m > 1 ? Math.max(1, rigLv().it >> 1) : 0;   // 遠方、畫面外降速的布迭代減半（TASK-0802，Tim 2026-10-22「遠方的布少迭代」；0 ⇒ 照分級）
    if ((si + k + sh.i + 1) % evk === 0) { var t0 = DEBUG ? performance.now() : 0; if (ns === 1) clothStep(sh, c, wl, gv, hc); else for (var cs = 0; cs < ns; cs++) clothStep(sh, c, wl, gv, hc / ns); if (DEBUG) PROF.cloth += performance.now() - t0; }
    if (ccOn && (si + k + sh.i + 1) % evk === 0 && c.p && !c.hidden && !c.gone) CC_Q.push({ sh: sh, c: c });   // 帆的碰撞（TASK-0603）：開了才排、跟布同一步；這一步全部的船走完才照時間預算解（clothContactsRun，50_sim.js）
    if (chk && c.loose && !c.npin) { c.free += 0.1; if (c.free > 12 || underWater(sh, c.p, 0) && underWater(sh, c.p, c.T.sim.n >> 1)) c.gone = true; }
  });
  for (i = 0; i < sh.loose.length; i++) {
    var o = sh.loose[i];
    if (chk) {
      ropePins(sh, o);
      if (!o.pin[0] && !o.pin[o.n - 1]) { o.free += 0.1; if (o.free > 15 || underWater(sh, o.p, 0) && underWater(sh, o.p, o.n - 1)) { sh.loose.splice(i--, 1); continue; } }
    }
    looseFollow(sh, o);                                                  // 釘著的那一端跟著帆桁、母繩走（looseMark）
    if (mr > 1 && (si + i + sh.i) % mr) continue;                        // 遠方：每 m 步走一次（畫面外：跟布同一個節拍）
    var t1 = DEBUG ? performance.now() : 0, rns = !SUBSTEP_OFF && h > DT60 * 1.000001 ? Math.ceil(h / DT60 - 1e-6) : 1, rh = mr * h / rns;   // 垂下來的繩：一小步最多 60 Hz 的一步 × 遠方倍率（TASK-0797；60 Hz ⇒ rns 1、跟以前一樣 m × DT）
    for (var rs = 0; rs < rns; rs++) ropeStep(sh, o, wl, gv, rns === 1 ? mr * h : rh); if (DEBUG) PROF.rope += performance.now() - t1;
  }
  var t2 = DEBUG ? performance.now() : 0; shredStep(sh, wl, gv, si, chk, h, hs); if (DEBUG) PROF.shred += performance.now() - t2;   // 帆的布片（34_shreds.js）
}
/** 開關物理（選單、B 鍵、下方按鈕）：開 ⇒ 帆從雕刻作品那一刻的形狀開始動；之前就斷掉的繩、掉下來的帆也垂下來
 *  （被斷開的那一團帶走的、一開始就不畫的除外）。關 ⇒ 回到靜態。 */
function setPhys(on) {
  PHYS = on;
  if (on && !PHX.rig) PHX.rig = PHX_RIG_LAST; else if (!on && PHX.rig) { PHX_RIG_LAST = PHX.rig; PHX.rig = 0; }   // 物理分級的「帆與繩」跟著走（09_phx.js）
  evEmit('phys', on);                                                  // 按鈕的亮暗、物理分級頁（62_simview.js）
  SHIPS.forEach(function (sh) {
    sh.loose = []; sh.shreds = []; sh.tCut = {};
    if (!on) { (sh.yards || []).forEach(function (m) { m.rot = 0; }); if (sh.yRopes) yardRopes(sh, true); unswingHangs(sh); }   // 關 ⇒ 帆桁回到作品的角度、小艇不擺
    sh.ropes.forEach(function (r) { r.lz = !!(r.never || r.moved); });
    sh.cl.forEach(function (c, k) { c.p = null; c.hidden = true; c.loose = false; c.torn = false; c.gone = !!c.moved; c.late = sh.sails[k].dead; c.fz = null; });
    sh.rigDirty = true;
  });
  if (RUNNING && SHIPS.length) note(SHIPS[PLAYER_I], on ? '帆與繩的物理：開（帆被風吹鼓、斷掉的會垂下來）' : '帆與繩的物理：關（靜態）');
}

// TASK-0603: contacts are solved on the rendered fine triangles. Their barycentric
// corrections are transferred to the coarse degrees of freedom, excluding pins.
// These caches contain geometry only; destroyed body cells/models are checked live.
var CLOTH_CONTACT_MARGIN = 0.12;
// 收帆、張帆的演出（Tim 2026-10-15：「開啟帆繩物理時，收帆放帆是否可以多一小段演出（不影響判斷）」）：只改畫出來的樣子（11_rig_gpu.js sailBuf → furlDraw）。
//   c.furlF ＝ 張開了幾成（1 張開、0 收攏；null ＝ 沒在演）；收帆 FURL_IN 秒、張帆 FURL_OUT 秒。物理照常走、判斷照 s.furled 立刻生效。
var FURL_IN = 1.2, FURL_OUT = 1.6;
/** 收攏點（模板共用；第一次用到才算，用設計那一刻的形狀找最近的）：T.fg[i] ＝ 細格點 i 往哪一個收攏點收，T.fgFloor 第一排留的距離，T.fmv ＝ 不是收攏點的綁點（跟著收）。
 *  帆腳（T.clew：只綁在繩上、旁邊沒有別的綁點的那一點 ＝ sheet 綁的角）一定跟著收（實船的 clewline 把帆腳拉上帆桁）；下帆桁（boom）上的綁點也是（brail 把帆往桅、斜桁收）。
 *  收攏點挑哪一組（Tim 2026-10-16 截圖：「新的收帆算法 無法收這面帆」—— spanker 收完還剩 84%）：照順序試 ① 帆桁 ② 帆桁＋綁在桅、船身上的那一條邊（hk 1／3、旁邊也是綁點）③ 每一個綁點，
 *    挑收到底（f ＝ 0）面積最小的；後面的要小 5% 以上才換（一樣小就照前面的）。
 *  ⛔ 以前固定 ①、其他綁點照原樣不動：spanker 前緣綁在桅上 ⇒ 從桅拉到兩根帆桁的三角形整片撐開（量到 13 艘裡 spanker 類 64–85%）；
 *  ⛔ 固定 ③：側邊綁在繩上的方帆往側邊收（暴風角號 fore-course 62%、拿破崙號上層方帆 19–27%）。
 *  ⛔ 舊的 T.gath 帆腳不收：收到底帆桁下面拉出兩條細長的三角形到帆腳（演完就藏所以看不出來；收好的帆留著一捲 ⇒ 看得到）。 */
function furlGath(T, sh) {
  if (T.fg) return T.fg;
  var cl = T.clew = new Uint8Array(T.n), nb = new Uint8Array(T.n), bm = new Uint8Array(T.n), i;
  for (var ti = 0; ti < T.tris.length; ti += 3) for (var e = 0; e < 3; e++) { var a = T.tris[ti + e], b = T.tris[ti + (e + 1) % 3]; if (T.hk[a] && T.hk[b]) { nb[a] = 1; nb[b] = 1; } }
  for (i = 0; i < T.n; i++) if (T.hk[i] === 2 && !nb[i]) cl[i] = 1;
  if (sh && sh.models) for (i = 0; i < T.n; i++) if (T.hk[i] === 4 && sh.models[T.hv[i]] && sh.models[T.hv[i]].yk === 'boom') bm[i] = 1;
  var yard = [], edge = [], all = [];
  for (i = 0; i < T.n; i++) { if (!T.hk[i] || cl[i] || bm[i]) continue; all.push(i); if (T.hk[i] === 4) yard.push(i); else if ((T.hk[i] === 1 || T.hk[i] === 3) && nb[i]) edge.push(i); }
  var cands = []; if (yard.length) { cands.push(yard); if (edge.length) cands.push(yard.concat(edge)); } if (!cands.length || all.length > cands[cands.length - 1].length) cands.push(all);
  var best = null; cands.forEach(function (S) { var r = furlTry(T, S); if (!best || r.area < best.area * 0.95) best = r; });
  T.fgFloor = best.floor; T.fmv = best.mv; T.fgN = best.S.length;
  return (T.fg = best.g);
}
/** 一組收攏點 S ⇒ 最近的收攏點 g、第一排留的距離 floor、跟著收的綁點 mv、收到底的面積。 */
function furlTry(T, S) {
  var n = T.n, g = new Int32Array(n).fill(-1), floor = new Float32Array(n), mv = new Uint8Array(n), src = new Set(S), i, j, p = T.p0;
  if (S.length) for (i = 0; i < n; i++) { var bd = 1e18; for (j = 0; j < S.length; j++) { var q = S[j], dx = p[i * 3] - p[q * 3], dy = p[i * 3 + 1] - p[q * 3 + 1], dz = p[i * 3 + 2] - p[q * 3 + 2], d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; g[i] = q; } } }
  for (i = 0; i < n; i++) if (T.hk[i] && !src.has(i)) mv[i] = 1;
  // Keep the first material row at its full distance from the fastening.
  // Shrinking every row into the yard's centre buries the furled cloth in wood.
  for (var ti = 0; ti < T.tris.length; ti += 3) for (var e = 0; e < 3; e++) {
    var a = T.tris[ti + e], b = T.tris[ti + (e + 1) % 3];
    if (src.has(a) === src.has(b)) continue;
    var free = src.has(a) ? b : a, target = g[free]; if (target < 0) continue;
    floor[target] = Math.max(floor[target], Math.hypot(p[free * 3] - p[target * 3], p[free * 3 + 1] - p[target * 3 + 1], p[free * 3 + 2] - p[target * 3 + 2]));
  }
  var P = Float32Array.from(p);
  for (i = 0; i < n; i++) {
    var t = g[i]; if (t < 0 || t === i || T.hk[i] && !mv[i]) continue;
    var rest = Math.hypot(p[i * 3] - p[t * 3], p[i * 3 + 1] - p[t * 3 + 1], p[i * 3 + 2] - p[t * 3 + 2]), fr = Math.max(0.04, Math.min(1, floor[t] / (rest || 1)));
    for (var x = 0; x < 3; x++) P[i * 3 + x] = P[t * 3 + x] + (p[i * 3 + x] - p[t * 3 + x]) * fr;
  }
  var A = 0; for (j = 0; j < T.tris.length; j += 3) { var u = T.tris[j] * 3, v = T.tris[j + 1] * 3, w = T.tris[j + 2] * 3, ux = P[v] - P[u], uy = P[v + 1] - P[u + 1], uz = P[v + 2] - P[u + 2], vx = P[w] - P[u], vy = P[w + 1] - P[u + 1], vz = P[w + 2] - P[u + 2]; A += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx); }
  return { S: S, g: g, floor: floor, mv: mv, area: A };
}
/** 畫面上收攏：每個細格點往它的收攏點（furlGath）靠過去，f ＝ 張開幾成（緩動）。 */
function furlDraw(c, P, f, sh) {
  var T = c.T, g = furlGath(T, sh), mv = T.fmv, i;
  var e = f * f * (3 - 2 * f), k = 0.04 + 0.96 * e;                     // 收到底留 4%（一捲布，不是一條線）
  for (i = 0; i < T.n; i++) {
    var a = g[i]; if (a < 0 || a === i || T.hk[i] && !mv[i]) continue; // Rendering must preserve every authored fastening, including rope/body pins.（帆腳、下帆桁除外，見 furlGath）
    var rest = Math.hypot(T.p0[i * 3] - T.p0[a * 3], T.p0[i * 3 + 1] - T.p0[a * 3 + 1], T.p0[i * 3 + 2] - T.p0[a * 3 + 2]);
    var fraction = Math.max(k, Math.min(1, (T.fgFloor[a] || 0) / (rest || 1)));
    for (var ax = 0; ax < 3; ax++) P[i * 3 + ax] = P[a * 3 + ax] + (P[i * 3 + ax] - P[a * 3 + ax]) * fraction;
  }
  return P;
}
// 收好的帆留一捲（Tim 2026-10-16：「收帆完成後帆會完全消失 是否能保持在最後剩一點點帆的狀態(比較寫實) 但是實際上打不到帆布(物理跟原本完全收起來一樣)」）：
//   只是畫：收到底那個樣子（furlDraw f ＝ 0）照設計的形狀算、跟著帆桁轉；判斷照舊 s.furled（航速、命中、鏈彈、帆的碰撞都當它不在）。物理關著也畫。
//   ⛔ 旗不留（降旗 strikeColors 也是 furled）；掉了（s.dead）不留。
function furlKeep(s) { return s.furled && !s.dead && !s.flag; }
/** 收好的那一捲：out ＝ 細格位置（設計的形狀；綁點與往它收的點照那根帆桁現在轉了多少轉）。 */
function furlBundle(sh, c, out) {
  var T = c.T, g = furlGath(T, sh), yk = T.sim.yk, mv = T.fmv, rot = sh && yk && T.sim.n === T.n && sh.yards && sh.yards.some(function (m) { return m.rot; });
  for (var i = 0; i < T.n; i++) {
    var o = i * 3, y = rot ? (T.hk[i] && !mv[i] ? yk[i] : g[i] >= 0 ? yk[g[i]] : -1) : -1, m = y >= 0 ? sh.models[y] : null;
    if (m && m.rot) { var w = rotZ([T.p0[o], T.p0[o + 1], T.p0[o + 2]], m.piv, m.rot); out[o] = w[0]; out[o + 1] = w[1]; out[o + 2] = w[2]; }
    else { out[o] = T.p0[o]; out[o + 1] = T.p0[o + 1]; out[o + 2] = T.p0[o + 2]; }
  }
  return furlDraw(c, out, 0, sh);
}
// 收帆停在演完那一刻（Tim 2026-10-17：「收帆是否可以改為停留在最後一刻的狀態(保留纜索) 物理判定照舊 只影響外觀」「且帆也是維持在最後一刻的狀態」「只要套用到開啟繩帆物理的就好」）：
//   收攏演到底（furlF ≤ 0）那一格畫出來的布 ⇒ c.fz（細格位置）＋每一點跟著哪根帆桁、那時轉了多少（c.fzY／c.fzR）；之後照它畫（帆桁再轉 ⇒ 照差的角度轉），不換成設計形狀的那一捲；
//   帆腳的 sheet、tack 留著、跟著凍結的帆腳（11_rig_gpu.js sailBuf 的 td、buildRig 不藏）。布不再模擬（c.hidden）、判斷照舊 s.furled。
//   只有物理開著才有（物理關著照舊 furlBundle、繩藏起來）；再張帆、開關物理 ⇒ 清掉。
function furlFreeze(sh, c) {
  if (!c.p) return;
  var T = c.T, P = furlDraw(c, clothFine(c, new Float32Array(T.n * 3)), 0, sh), g = furlGath(T, sh), yk = T.sim.yk, mv = T.fmv, Y = new Int16Array(T.n).fill(-1), R = {};
  if (yk && T.sim.n === T.n) for (var i = 0; i < T.n; i++) { var y = T.hk[i] && !mv[i] ? yk[i] : g[i] >= 0 ? yk[g[i]] : -1; Y[i] = y; if (y >= 0 && !(y in R)) R[y] = sh.models[y] ? sh.models[y].rot || 0 : 0; }
  c.fz = P; c.fzY = Y; c.fzR = R;
}
/** 凍結的那一格（out ＝ 細格位置）：帆桁從凍結那時起又轉了多少 ⇒ 那幾點跟著轉。 */
function furlFrozen(sh, c, out) {
  var T = c.T, P = c.fz, Y = c.fzY, R = c.fzR;
  for (var i = 0; i < T.n; i++) {
    var o = i * 3, y = Y ? Y[i] : -1, m = y >= 0 ? sh.models[y] : null, d = m ? (m.rot || 0) - R[y] : 0;
    if (d) { var w = rotZ([P[o], P[o + 1], P[o + 2]], m.piv, d); out[o] = w[0]; out[o + 1] = w[1]; out[o + 2] = w[2]; }
    else { out[o] = P[o]; out[o + 1] = P[o + 1]; out[o + 2] = P[o + 2]; }
  }
  return out;
}
/** 收好的那一捲哪幾點不畫（Tim 2026-10-16 截圖：「且會浮空」—— 收著的帆不會因為帆桁、桅被打掉而算掉了（32_hull.js：收著的帆不怕），那一捲照畫在原處）：
 *  每一點往它的收攏點收（綁點自己 ＝ 自己）；那個綁點靠的東西（格、繩、帆桁）不在了 ⇒ 那一點不畫（碰到它的三角形不畫）。帆的破洞照舊不畫。null ＝ 全畫。 */
function furlLost(sh, s, c) {
  var T = c.T, g = furlGath(T, sh), mv = T.fmv, out = null, ok = {};
  for (var i = 0; i < T.n; i++) {
    var a = T.hk[i] && !mv[i] ? i : g[i], lost = c.torn && c.tv && c.tv[i];
    if (!lost && a >= 0) { var key = T.hk[a] + ':' + T.hv[a]; if (!(key in ok)) ok[key] = holds(sh, s, T.hk[a], T.hv[a]); lost = !ok[key]; }
    if (lost) (out || (out = new Uint8Array(T.n)))[i] = 1;
  }
  return out;
}
// 帆腳跟 sheet 連動（Tim 2026-10-16：「帆跟纜線綁在一起時 物理是否可以連動 目前好像是一起固定在空中的固定點」）：
//   帆腳（furlGath 的 T.clew）不再釘在作品的位置：交給布的物理，只多一條「離 sheet 另一端（綁甲板、下一根帆桁）不超過作品那一刻的距離」⇒ 被風吹得動、被繩拉住。
//   帆自己的每一條繩（s.lines：sheet、tack）端點在帆腳 1 m 內的都算（course 一角有 sheet 也有 tack ⇒ 兩條一起拉）。
//   畫：那幾條繩靠帆腳那一端跟著畫出來的帆腳走（照弧長內插，另一端不動；looseBuf 畫、buildRig 不畫那幾條）。
//   ⛔ 只管畫出來的樣子：繩的 r.pts 不動（打繩照作品的位置判 ⇒ 同一個種子開或關物理照樣走出同一局）。繩斷了 ⇒ 那一條不拉。
var TETH_R = 10;
/** 帆腳的繩（模板共用，第一次用到才算）：[{ i 帆腳, j 繩, ce 靠帆腳那一端（點的序號）, fe 另一端, L 最長距離, t 每一點從另一端算起的弧長比例 }]。 */
function tethOf(sh, s, c) {
  var T = c.T; if (T.teth !== undefined) return T.teth;
  furlGath(T, sh); var list = [];
  // 配方的帆（29_sailrecipe.js clothBindMeta）：帆腳被哪條繩的哪一端拉著照繩的 ends（T.tm）；舊 .vxk ⇒ 照帆自己的繩哪一端離帆腳 TETH_R 內
  var pairs = []; if (T.sim.n === T.n) { if (T.tm) T.tm.forEach(function (x) { if (T.clew[x.i]) pairs.push(x); }); else for (var i0 = 0; i0 < T.n; i0++) if (T.clew[i0]) (s.lines || []).forEach(function (j) { pairs.push({ i: i0, j: j }); }); }
  pairs.forEach(function (pr) {
    var i = pr.i, j = pr.j, q = sh.ropes[j].pts0 || sh.ropes[j].pts, m = q.length / 3; if (m < 2) return;
    function d(k) { return Math.hypot(q[k * 3] - T.p0[i * 3], q[k * 3 + 1] - T.p0[i * 3 + 1], q[k * 3 + 2] - T.p0[i * 3 + 2]); }
    var ce;
    if (pr.ce !== undefined) ce = pr.ce; else { var d0 = d(0), d1 = d(m - 1); if (Math.min(d0, d1) > TETH_R) return; ce = d0 <= d1 ? 0 : m - 1; }
    var fe = m - 1 - ce, t = new Float32Array(m), acc = new Float32Array(m), k;
    for (k = 1; k < m; k++) { var a = fe ? m - 1 - k : k, b = fe ? a + 1 : a - 1; acc[k] = acc[k - 1] + Math.hypot(q[a * 3] - q[b * 3], q[a * 3 + 1] - q[b * 3 + 1], q[a * 3 + 2] - q[b * 3 + 2]); }   // acc[k]：從另一端走到第 k 點（照走的順序）
    for (k = 0; k < m; k++) t[fe ? m - 1 - k : k] = acc[m - 1] > 0 ? acc[k] / acc[m - 1] : 1;
    var es = []; for (k = 0; k < T.sim.ea.length; k++) if (T.sim.ea[k] === i || T.sim.eb[k] === i) es.push(k);   // es：帆腳的布邊（全斷 ⇒ 帆腳跟帆斷開，tethCut）
    list.push({ i: i, j: j, ce: ce, fe: fe, L: d(fe), t: t, es: es, y: tethYard(T) });
  });
  return (T.teth = list);
}
// 帆腳那一塊布被打掉（Tim 2026-10-16 兩張截圖：「發現了繩索浮空」—— 量到：撕掉帆腳的那一塊 ⇒ 帆腳那一點藏起來、布邊全斷，
//   還被 sheet 拉著一路往下掉（三角帆 18–23 m），繩畫到一個看不見的點上；以前帆腳釘著 ⇒ 繩頭停在作品那一點的空中）：
//   ⇒ 那條繩跟帆斷開：不再拉、不再跟著帆腳畫，變成一條垂下來的繩（靠帆腳那一端放開、另一端照原本靠的東西；spawnLoose 的 offSail）。
//   sh.tCut[j]：這艘船這條繩已經斷開了（只是畫：r.dead 不動；之後真的斷了不再生第二條；setPhys 清掉）。
function tethCut(sh, c) {
  for (var k = 0; k < c.tt.length; k++) {
    var t = c.tt[k], r = sh.ropes[t.j]; if (r.dead || sh.tCut && sh.tCut[t.j]) continue;
    var gone = !!c.tv[t.i]; if (!gone) { gone = true; for (var e = 0; e < t.es.length; e++) if (!c.brk[t.es[e]]) { gone = false; break; } }
    if (!gone) continue;
    (sh.tCut || (sh.tCut = {}))[t.j] = 1; sh.rigDirty = true;
    var q = r.pts, ce = t.ce * 3;
    spawnLoose(sh, { pts: q, a: r.a, ma: r.ma, pa: r.pa, b: r.b, mb: r.mb, pb: r.pb, col: r.col, of: r, offSail: { verts: [q[ce], q[ce + 1], q[ce + 2]] } });
  }
}
/** 帆腳離繩的另一端超過 L ⇒ 拉回 L（另一端照繩現在的位置：綁在帆桁上的跟著帆桁轉）。clothStep 每一輪約束之後。 */
// 帆桁轉了 ⇒ sheet 跟著鬆（Tim 2026-10-19：持火號「拋錨會導致帆布出現一塊下拉」「轉彎也會出帆bug」「固定出現在前帆」）：
//   sheet 的長度照「帆腳作品的位置繞這面帆的帆桁轉 rot 之後」到 sheet 另一端的距離，不短於作品的長度 L —— 實船轉帆桁時 sheet 是放出去的。
//   ⛔ 一直照作品的 L：三角帆的帆桁長（持火號前桅 20 m）、追風轉到 ±58° ⇒ 轉過的帆腳離帆腳索樁遠過 L，帆腳被拉回樁那邊，整片布從帆桁扯成一塊拖到甲板。
//   帆桁 ＝ 這面帆綁最多點的那根（tethYard，跟 clothBrace 同一個挑法）；沒綁帆桁、沒轉 ⇒ 照 L（以前那樣）。只是畫面（布），戰局不讀。
function tethYard(T) { var yk = T.sim && T.sim.yk, cnt = {}, top = -1; if (!yk) return -1; for (var i = 0; i < yk.length; i++) if (yk[i] >= 0 && (cnt[yk[i]] = (cnt[yk[i]] || 0) + 1) > (cnt[top] || 0)) top = yk[i]; return top; }
function tethSolve(sh, c) {
  var tt = c.tt, p = c.p, P0 = c.T.sim.p0;
  for (var k = 0; k < tt.length; k++) {
    var t = tt[k], r = sh.ropes[t.j]; if (r.dead || sh.tCut && sh.tCut[t.j]) continue;
    var q = r.pts, f = t.fe * 3, o = t.i * 3, dx = p[o] - q[f], dy = p[o + 1] - q[f + 1], dz = p[o + 2] - q[f + 2], l = Math.sqrt(dx * dx + dy * dy + dz * dz), L = t.L;
    var m = t.y >= 0 ? sh.models[t.y] : null;
    if (m && m.rot) { var w = rotZ([P0[o], P0[o + 1], P0[o + 2]], m.piv, m.rot); L = Math.max(L, Math.hypot(w[0] - q[f], w[1] - q[f + 1], w[2] - q[f + 2])); }   // 帆桁轉了 ⇒ sheet 放出去（見上）
    if (l > L && l > 1e-9) { var s = L / l; p[o] = q[f] + dx * s; p[o + 1] = q[f + 1] + dy * s; p[o + 2] = q[f + 2] + dz * s; }
  }
}
// 效能（ame 2026-10-15，Tim：「接手效能，在她的碰撞做法上加篩選和降頻」；碰撞的做法本身照 Sirius 的）：
//   · 開關：物理設定「帆的碰撞」（09_phx.js），預設關、帆與繩「高」才算；關 ⇒ 一行都不跑。
//   · 排隊＋時間預算：布走的那一步才排（physStep），全部的船走完再解；最久沒解的先解。平均每步最多花 CC_MS 毫秒：
//     一面帆解一次常常就超過（4–6 ms）⇒ 超出的記成欠的（CC_DEBT），之後幾步先還、不解 ⇒ 不會再一步幾百毫秒，也不會每步都多一面帆的時間。
//   · 整面篩：帆的外框碰不到船殼格、模型、繩 ⇒ 整面跳過；模型的矩陣與外框每艘每步算一次（ccModels），不是每面帆各算一次。
//   · 繩：線段清單照 pts 那一份陣列建一次（帆桁轉了 pts 會換新陣列 ⇒ 重建；⛔ 以前每次都建一棵排序的樹）。
//   · 輪數：第一次 CC_PASS[0]、之後每次 CC_PASS[1]（Sirius 原本 48／12；?ccpass=48,12 量正確性用）。
var CC_Q = [], CC_MS = +(Q.get('ccms') || 1.5), CC_DEBT = 0, CC_WALK = 12, CC_REGION = 30, CC_STEP = +(Q.get('ccstep') || 1);   // CC_STEP：一次接觸修正最多把一個點推幾格   // CC_WALK：船殼格往外找出口最多走幾格（1.2 m；帆只會穿進去幾格）
/** 這一步排到的帆，照最久沒解的先解，花到 CC_MS 毫秒為止（至少一面）。50_sim.js：全部的船 physStep 之後。 */
function clothContactsRun() {
  if (!CC_Q.length) return;
  CC_DEBT = Math.max(0, CC_DEBT - CC_MS);
  if (CC_DEBT > 0) { if (DEBUG) PROF.ccQ += CC_Q.length; CC_Q.length = 0; return; }   // 還在還之前超出的時間
  CC_Q.forEach(function (q) { if (!q.sh.T.ccGeometry) { var tg = performance.now(); ccGeometry(q.sh); if (DEBUG) PROF.ccGeo += performance.now() - tg; } });   // 第一次才建（不算進時間預算）
  var si = Math.round(SIMT / DT), t0 = performance.now(), n = 0;
  CC_Q.sort(function (a, b) { return (a.c.ccLast === undefined ? -1 : a.c.ccLast) - (b.c.ccLast === undefined ? -1 : b.c.ccLast); });
  for (var i = 0; i < CC_Q.length && performance.now() - t0 < CC_MS; i++) {
    var q = CC_Q[i], t1 = DEBUG ? performance.now() : 0; clothContacts(q.sh, q.c, t0 + CC_MS); q.c.ccLast = si; n++;   // 輪流：解過（或切到一半）的排到後面；切到一半的下次從 c.ccCur 接著做（⛔ 不排到後面 ⇒ 同一面一直佔著，另一艘的帆輪不到）
    if (DEBUG) PROF.ccMax = Math.max(PROF.ccMax, performance.now() - t1);
    if (DEBUG) { PROF.ccN++; PROF.ccHit += q.c.contactStats ? q.c.contactStats.first : 0; }
  }
  var used = performance.now() - t0; CC_DEBT += Math.max(0, used - CC_MS);
  if (DEBUG) { PROF.cc += used; PROF.ccQ += CC_Q.length; }
  CC_Q.length = 0;
}
/** 這艘船每個還在的模型：矩陣、反矩陣、世界外框（每步算一次，幾面帆共用）。 */
function ccModels(sh, geo) {
  var si = Math.round(SIMT / DT); if (sh.ccMB && sh.ccMB.si === si) return sh.ccMB.list;
  var list = [];
  (sh.models || []).forEach(function (m) {
    if (!m.alive || !geo.mb[m.mesh]) return;
    var matrix = modelLocal(m), b = geo.mb[m.mesh], corners = [];
    for (var k = 0; k < 8; k++) corners.push(M4.pt(matrix, b[k & 1 ? 3 : 0], b[k & 2 ? 4 : 1], b[k & 4 ? 5 : 2]));
    list.push({ m: m, matrix: matrix, inverse: null, box: ccBox(corners) });   // 反矩陣碰得到才算（下面）
  });
  sh.ccMB = { si: si, list: list }; return list;
}
var CC_PASS = (Q.get('ccpass') || '6,1').split(',').map(Number);   // 第一次（剛張開）幾輪、之後每次幾輪；?ccpass=48,12 ＝ Sirius 原本的（量正確性用）
function ccBox(points) {
  var b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  points.forEach(function (p) { for (var a = 0; a < 3; a++) { b[a] = Math.min(b[a], p[a]); b[a + 3] = Math.max(b[a + 3], p[a]); } }); return b;
}
function ccOverlap(a, b, r) { for (var k = 0; k < 3; k++) if (a[k] > b[k + 3] + r || a[k + 3] < b[k] - r) return false; return true; }
function ccTree(items) {
  if (!items.length) return null;
  var b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  items.forEach(function (o) { for (var a = 0; a < 3; a++) { b[a] = Math.min(b[a], o.b[a]); b[a + 3] = Math.max(b[a + 3], o.b[a + 3]); } });
  if (items.length <= 8) return { b: b, items: items };
  var axis = 0; for (var a = 1; a < 3; a++) if (b[a + 3] - b[a] > b[axis + 3] - b[axis]) axis = a;
  items.sort(function (x, y) { return x.b[axis] + x.b[axis + 3] - y.b[axis] - y.b[axis + 3]; });
  var mid = items.length >> 1; return { b: b, l: ccTree(items.slice(0, mid)), r: ccTree(items.slice(mid)) };
}
function ccQuery(tree, b, radius, out) {
  if (!tree || !ccOverlap(tree.b, b, radius)) return;
  if (tree.items) tree.items.forEach(function (o) { if (ccOverlap(o.b, b, radius)) out.push(o); });
  else { ccQuery(tree.l, b, radius, out); ccQuery(tree.r, b, radius, out); }
}
function ccGeometry(sh) {
  // ame：只收帆附近的船殼格（全部的帆在雕刻那一刻的外框、外擴 CC_REGION 格）；模型的三角形樹用到才建（ccMesh）。
  //   ⛔ 以前一開始就走完整艘的格（約 140 萬）、替 180 個模型每個建一棵排序的樹 ⇒ 第一次 2.5 秒。
  var H = sh.T; if (H.ccGeometry) return H.ccGeometry;
  var R = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  (H.cloth || []).forEach(function (t) { for (var i = 0; i < t.n; i++) for (var a = 0; a < 3; a++) { var w = t.p0[i * 3 + a]; if (w < R[a]) R[a] = w; if (w > R[a + 3]) R[a + 3] = w; } });
  for (var a = 0; a < 3; a++) { R[a] -= CC_REGION; R[a + 3] += CC_REGION; }
  var rows = new Map(), boxes = [];
  H.base.each(function (x, y, z) { if (x < R[0] || x > R[3] || y < R[1] || y > R[4] || z < R[2] || z > R[5]) return; var key = x + H.base.sx * z, row = rows.get(key); if (!row) rows.set(key, row = { x: x, z: z, ys: [] }); row.ys.push(y); });
  rows.forEach(function (row) {
    row.ys.sort(function (a, b) { return a - b; }); var start = row.ys[0], end = start;
    for (var j = 1; j <= row.ys.length; j++) { var y = row.ys[j]; if (y !== end + 1) { boxes.push({ b: [row.x, start, row.z, row.x + 1, end + 1, row.z + 1] }); start = y; } end = y; }
  });
  var mb = (H.rig.meshes || []).map(function (m) {           // 每個模型網格的外框（便宜；篩用）
    if (!m.tris || !m.tris.length) return null;
    var b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (var i = 0; i < m.verts.length; i += 3) for (var a2 = 0; a2 < 3; a2++) { var w = m.verts[i + a2]; if (w < b[a2]) b[a2] = w; if (w > b[a2 + 3]) b[a2 + 3] = w; }
    return b;
  });
  return H.ccGeometry = { body: ccTree(boxes), mb: mb, meshes: [], H: H };
}
/** 第 k 個模型網格的三角形樹（用到才建、建了留著）。 */
function ccMesh(geo, k) {
  var t = geo.meshes[k]; if (t !== undefined) return t;
  var m = geo.H.rig.meshes[k], ts = [], volume = 0;
  for (var i = 0; i < m.tris.length; i += 3) { var p = []; for (var j = 0; j < 3; j++) { var v = m.tris[i + j] * 3; p.push([m.verts[v], m.verts[v + 1], m.verts[v + 2]]); } volume += dot(p[0], cross(p[1], p[2])); ts.push({ p: p, b: ccBox(p), id: i / 3 }); }
  t = ccTree(ts); if (t) t.orientation = volume < 0 ? -1 : 1;
  return (geo.meshes[k] = t);
}
function ccBary(p, v) {
  var a = sub(v[1], v[0]), b = sub(v[2], v[0]), q = sub(p, v[0]), aa = dot(a, a), ab = dot(a, b), bb = dot(b, b), den = aa * bb - ab * ab;
  if (Math.abs(den) < 1e-14) return [1 / 3, 1 / 3, 1 / 3];
  var y = (bb * dot(q, a) - ab * dot(q, b)) / den, z = (aa * dot(q, b) - ab * dot(q, a)) / den; return [1 - y - z, y, z];
}
function ccClosest(p, v) {
  var n = norm(cross(sub(v[1], v[0]), sub(v[2], v[0]))), q = sub(p, mul(n, dot(sub(p, v[0]), n))), w = ccBary(q, v);
  if (w.every(function (x) { return x >= 0; })) return { p: q, w: w };
  var best = null;
  for (var i = 0; i < 3; i++) { var j = (i + 1) % 3, d = sub(v[j], v[i]), t = clamp(dot(sub(p, v[i]), d) / (dot(d, d) || 1), 0, 1), x = add(v[i], mul(d, t)), dd = dot(sub(x, p), sub(x, p)); if (!best || dd < best.d) { var b = [0, 0, 0]; b[i] = 1 - t; b[j] = t; best = { p: x, w: b, d: dd }; } } return best;
}
function ccSegmentTri(a, b, v) {
  var d = sub(b, a), e = sub(v[1], v[0]), f = sub(v[2], v[0]), h = cross(d, f), det = dot(e, h); if (Math.abs(det) < 1e-10) return null;
  var s = sub(a, v[0]), u = dot(s, h) / det, q = cross(s, e), w = dot(d, q) / det, t = dot(f, q) / det;
  if (u < -1e-8 || w < -1e-8 || u + w > 1 + 1e-8 || t < 0 || t > 1) return null;
  return { p: add(a, mul(d, t)), w: [1 - u - w, u, w], t: t };
}
function ccTriangleBox(v, b) {
  var c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2], e = [(b[3] - b[0]) / 2, (b[4] - b[1]) / 2, (b[5] - b[2]) / 2], axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], edges = [sub(v[1], v[0]), sub(v[2], v[1]), sub(v[0], v[2])];
  axes.push(cross(edges[0], edges[1])); edges.forEach(function (d) { for (var a = 0; a < 3; a++) axes.push(cross(d, axes[a])); });
  var best = Infinity, normal = null;
  for (var i = 0; i < axes.length; i++) {
    var length = len(axes[i]); if (length < 1e-10) continue; var n = mul(axes[i], 1 / length), p = v.map(function (x) { return dot(sub(x, c), n); }), lo = Math.min.apply(null, p), hi = Math.max.apply(null, p), r = e[0] * Math.abs(n[0]) + e[1] * Math.abs(n[1]) + e[2] * Math.abs(n[2]);
    if (lo > r || hi < -r) return null;
    var plus = r - lo, minus = hi + r, depth = Math.min(plus, minus); if (depth < best) { best = depth; normal = mul(n, plus < minus ? 1 : -1); }
  }
  var q = ccClosest(c, v); return { w: q.w, p: q.p, delta: mul(normal, best + CLOTH_CONTACT_MARGIN) };
}
function ccInside(p, tree) {
  if (!tree || p.some(function (x, a) { return x <= tree.b[a] || x >= tree.b[a + 3]; })) return false;
  var end = [tree.b[3] + 1, p[1] + .000013, p[2] + .000027], faces = [], hits = [];
  ccQuery(tree, ccBox([p, end]), 0, faces);
  faces.forEach(function (f) { var h = ccSegmentTri(p, end, f.p); if (h && h.t > 1e-7) hits.push(h.t); });
  hits.sort(function (a, b) { return a - b; }); return hits.filter(function (t, i) { return !i || Math.abs(t - hits[i - 1]) > 1e-7; }).length % 2 === 1;
}
function ccNearest(p, tree) {
  var best = null;
  function visit(t) {
    if (!t) return; var d = 0; for (var a = 0; a < 3; a++) d += Math.pow(Math.max(t.b[a] - p[a], 0, p[a] - t.b[a + 3]), 2);
    if (best && d > best.d) return;
    if (t.items) t.items.forEach(function (f) { var q = ccClosest(p, f.p), ds = dot(sub(q.p, p), sub(q.p, p)); if (!best || ds < best.d) best = { p: q.p, d: ds, face: f }; });
    else { visit(t.l); visit(t.r); }
  }
  visit(tree); return best;
}
function ccMove(c, ids, weights, delta, mount) {
  var T = c.T, mass = new Map(), denom = 0;
  for (var j = 0; j < 3; j++) for (var k = 0; k < 4; k++) { var at = ids[j] * 4 + k, w = T.mw[at] * weights[j], node = T.mi[at]; if (!w || c.pin[node]) continue; mass.set(node, (mass.get(node) || 0) + w); }
  mass.forEach(function (w) { denom += w * w; }); if (denom < 1e-12) return false;
  var magnitude = len(delta), maxWeight = 0; mass.forEach(function (w) { maxWeight = Math.max(maxWeight, w); });
  var scale = Math.min(1, (c.contactWarm ? 1 : 4) * denom / ((magnitude || 1) * maxWeight));
  var moved = false;
  mass.forEach(function (w, node) {
    var dx = delta[0] * scale * w / denom, dy = delta[1] * scale * w / denom, dz = delta[2] * scale * w / denom, dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var room = CC_STEP - c.ccAcc[node]; if (room <= 1e-4) return;          // 這一次解（clothContacts 一次呼叫）每個點總共最多推 CC_STEP 格（ame：Tim「碰撞會有瞬間帆彈出一大段距離」——
    if (dl > room) { var f = room / dl; dx *= f; dy *= f; dz *= f; dl = room; }   //   一個點一次被推出桅杆 10 格、又被相鄰的六個三角形各推一次 ⇒ 邊拉到 96 格（關碰撞最長 33）；推不完的下一次再推）
    c.ccAcc[node] += dl;
    var d3 = [dx, dy, dz];
    for (var a = 0; a < 3; a++) { var at = node * 3 + a, old = c.p[at], d = d3[a];
    if (Math.abs(d) < 1e-5) continue; c.p[at] += d; var actual = c.p[at] - old;
    if (actual) { c.q[at] += actual; moved = true; }
  } }); return moved;
}
function ccSeparate(c, ids, v, normal, limit, mount) {
  var moved = false;
  for (var j = 0; j < 3; j++) {
    var depth = limit - dot(v[j], normal); if (depth <= 1e-4) continue;
    var w = [0, 0, 0]; w[j] = 1;
    if (ccMove(c, ids, w, mul(normal, depth), mount !== false)) moved = true;
  }
  return moved;
}
function ccBodyPlane(grid, v, cell) {
  var best = null;
  for (var axis = 0; axis < 3; axis++) for (var sign = -1; sign <= 1; sign += 2) {
    var q = cell.slice(), steps = 0;
    while (grid.get(q[0], q[1], q[2]) && steps++ < CC_WALK) q[axis] += sign;   // 往這個方向走到空格（ame：256 ⇒ CC_WALK；帆穿進桅杆沿桅的方向一走就是 256 格 × 每格每個三角形每一輪 ⇒ 一面帆一次 12.7 秒）
    if (steps >= CC_WALK) continue;
    var normal = [0, 0, 0]; normal[axis] = sign;
    var limit = (q[axis] + (sign < 0 ? 1 : 0)) * sign + CLOTH_CONTACT_MARGIN;
    var depth = limit - Math.min.apply(null, v.map(function (p) { return dot(p, normal); }));
    if (!best || depth < best.depth) best = { normal: normal, limit: limit, depth: depth };
  }
  return best;
}
function ccOnSegment(p, a, b) {
  var d = sub(b, a), t = clamp(dot(sub(p, a), d) / (dot(d, d) || 1), 0, 1); return add(a, mul(d, t));
}
function ccPair(a, b, c, d) {
  var u = sub(b, a), v = sub(d, c), w = sub(a, c), aa = dot(u, u), bb = dot(u, v), cc = dot(v, v), dd = dot(u, w), ee = dot(v, w), den = aa * cc - bb * bb;
  var s = den > 1e-12 ? clamp((bb * ee - cc * dd) / den, 0, 1) : 0;
  var t = cc > 1e-12 ? (bb * s + ee) / cc : 0;
  if (t < 0) { t = 0; s = clamp(-dd / (aa || 1), 0, 1); }
  else if (t > 1) { t = 1; s = clamp((bb - dd) / (aa || 1), 0, 1); }
  var p = add(a, mul(u, s)), q = add(c, mul(v, t)); return { p: p, q: q, d: len(sub(p, q)) };
}
function ccCapsule(a, b, v) {
  var crossHit = ccSegmentTri(a, b, v); if (crossHit) return { d: 0, p: crossHit.p, q: crossHit.p };
  var best = null;
  function take(p, q) { var d = len(sub(p, q)); if (!best || d < best.d) best = { d: d, p: p, q: q }; }
  take(ccClosest(a, v).p, a); take(ccClosest(b, v).p, b);
  for (var j = 0; j < 3; j++) { var pair = ccPair(v[j], v[(j + 1) % 3], a, b); take(pair.p, pair.q); }
  return best;
}
function ccClip(poly, axis, bound, sign) {
  var out = [];
  for (var i = 0; i < poly.length; i++) {
    var a = poly[i], b = poly[(i + 1) % poly.length], da = (a[axis] - bound) * sign, db = (b[axis] - bound) * sign;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) out.push(add(a, mul(sub(b, a), da / (da - db))));
  }
  return out;
}
function ccRopeMount(c, ids, v, record, a, b) {
  var T = c.T, r = record.r, radius = record.radius, extent = 2 * radius + CLOTH_CONTACT_MARGIN;
  for (var j = 0; j < 3; j++) {
    var id = ids[j], own = T.hk[id] === 2 && T.hv[id] === record.index;
    var shared = T.hk[id] === 4 && (r.ya === T.hv[id] || r.yb === T.hv[id]) && Math.min(len(sub(v[j], a)), len(sub(v[j], b))) <= radius + CLOTH_CONTACT_MARGIN;
    if (!own && !shared) continue;
    if (!c.pin[id]) continue;
    var contained = true;
    for (var axis = 0; axis < 3 && contained; axis++) for (var sign = -1; sign <= 1 && contained; sign += 2) {
      var poly = ccClip(v, axis, v[j][axis] + sign * extent, sign);
      for (var k = 1; k + 1 < poly.length; k++) if (ccCapsule(a, b, [poly[0], poly[k], poly[k + 1]]).d < radius - 1e-5) { contained = false; break; }
    }
    if (contained) return true;
  }
  return false;
}
// Whole contact sets, rather than a sampled witness, must fit the fastening.
// Rows carry position plus triangle barycentrics through every clipping plane.
function ccClipRows(poly, distance) {
  var out = [];
  for (var i = 0; i < poly.length; i++) {
    var a = poly[i], b = poly[(i + 1) % poly.length], da = distance(a), db = distance(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) out.push(a.map(function (x, k) { return x + (b[k] - x) * da / (da - db); }));
  }
  return out;
}
function ccBoxPolygon(v, cell, inset) {
  inset = inset || 0;
  var poly = v.map(function (p, i) { return p.concat([+(i === 0), +(i === 1), +(i === 2)]); });
  for (var a = 0; a < 3; a++) {
    poly = ccClipRows(poly, function (p) { return p[a] - cell[a] - inset; });
    poly = ccClipRows(poly, function (p) { return cell[a] + 1 - inset - p[a]; });
  }
  return poly;
}
function ccSeams(sh, c) {
  var T = c.T; if (T.ccSeams) return T.ccSeams;
  var edges = new Map(), seams = [];
  for (var i = 0; i < T.tris.length; i += 3) for (var j = 0; j < 3; j++) {
    var a = T.tris[i + j], b = T.tris[i + (j + 1) % 3], key = Math.min(a, b) + ':' + Math.max(a, b), e = edges.get(key);
    if (e) e.count++; else edges.set(key, { a: a, b: b, count: 1 });
  }
  edges.forEach(function (e) {
    if (e.count !== 1 || T.hk[e.a] !== 4 || T.hk[e.b] !== 4 || T.hv[e.a] !== T.hv[e.b]) return;
    var owner = T.hv[e.a], md = sh.T.rig.models[owner], mesh = sh.T.rig.meshes[md.mesh];
    var ma = Array.from(T.p0.slice(e.a * 3, e.a * 3 + 3)), mb = Array.from(T.p0.slice(e.b * 3, e.b * 3 + 3));
    var a = sub(ma, md.origin), b = sub(mb, md.origin), d = sub(b, a), length = len(d); if (length < 1e-7) return;
    var axis = mul(d, 1 / length), radius = 0;
    for (var f = 0; f < mesh.tris.length; f += 3) {
      var poly = [0, 1, 2].map(function (j) { var k = mesh.tris[f + j] * 3; return mesh.verts.slice(k, k + 3); });
      poly = ccClipRows(poly, function (p) { return dot(sub(p, a), axis); });
      poly = ccClipRows(poly, function (p) { return length - dot(sub(p, a), axis); });
      poly.forEach(function (p) { var q = sub(p, a); radius = Math.max(radius, len(sub(q, mul(axis, dot(q, axis))))); });
    }
    if (radius > 1e-7) seams.push({ owner: owner, ia: e.a, ib: e.b, a: a, b: b, ma: ma, mb: mb, radius: radius });
  });
  return (T.ccSeams = seams);
}
function ccSegmentDistance(p, a, b) { return Math.sqrt(segDist2(p, a[0], a[1], a[2], b[0], b[1], b[2])); }
function ccModelContactSet(v, local, model, faces, tree) {
  var points = []; points.complete = true;
  function addPoint(p, w) { points.push(M4.pt(model.matrix, p[0], p[1], p[2]).concat(w)); }
  for (var j = 0; j < 3; j++) if (ccInside(local[j], tree)) { var w = [0, 0, 0]; w[j] = 1; addPoint(local[j], w); }
  faces.forEach(function (face) {
    var faceNormal = norm(cross(sub(face.p[1], face.p[0]), sub(face.p[2], face.p[0])));
    if (local.every(function (p) { return Math.abs(dot(sub(p, face.p[0]), faceNormal)) < 1e-4; })) points.complete = false;
    for (var e = 0; e < 3; e++) {
      var hit = ccSegmentTri(local[e], local[(e + 1) % 3], face.p);
      if (hit) { var w = [0, 0, 0]; w[e] = 1 - hit.t; w[(e + 1) % 3] = hit.t; addPoint(hit.p, w); }
      hit = ccSegmentTri(face.p[e], face.p[(e + 1) % 3], local);
      if (hit) addPoint(hit.p, hit.w);
    }
  });
  // The convex hull of these complete intersection vertices overbounds every
  // positive-area component. Both fastening tests below are convex bounds.
  return points;
}
function ccLocalSeam(sh, c, ids, poly, owner) {
  if (!poly.length || poly.complete === false) return false;
  var T = c.T, material = poly.map(function (p) { var q = [0, 0, 0]; for (var j = 0; j < 3; j++) for (var a = 0; a < 3; a++) q[a] += T.p0[ids[j] * 3 + a] * p[j + 3]; return q; });
  var seams = ccSeams(sh, c), tol = 1e-4;
  for (var i = 0; i < seams.length; i++) {
    var seam = seams[i]; if (seam.owner !== owner || !c.pin[seam.ia] || !c.pin[seam.ib]) continue;
    if (material.some(function (p) { return ccSegmentDistance(p, seam.ma, seam.mb) > seam.radius + tol; })) continue;
    var md = sh.models[owner], inverse = M4.inv(modelLocal(md));
    if (poly.every(function (p) { return ccSegmentDistance(M4.pt(inverse, p[0], p[1], p[2]), seam.a, seam.b) <= seam.radius + tol; })) return true;
  }
  return false;
}
function ccPolygonArea(poly) {
  var area = 0;
  for (var i = 1; i + 1 < poly.length; i++) area += len(cross(sub(poly[i], poly[0]), sub(poly[i + 1], poly[0]))) / 2;
  return area;
}
function ccYardBodyJoint(sh, geo, owner) {
  // A touching cell is a fastening only in the finite six-connected component
  // containing this yard's actual pivot. A remote decorative collision fails.
  var md = sh.models[owner], si = Math.round(SIMT / DT);
  if (!sh.ccJoints || sh.ccJoints.si !== si) sh.ccJoints = { si: si, owners: new Map() };
  var cache = sh.ccJoints.owners; if (cache.has(owner)) return cache.get(owner);
  var component = new Set(); cache.set(owner, component);
  if (!md || !md.alive || md.kind !== 'yard' || !md.piv) return component;
  var matrix = modelLocal(md), inverse = M4.inv(matrix), tree = ccMesh(geo, md.mesh);
  function intersects(cell) {
    if (!sh.grid.get(cell[0], cell[1], cell[2])) return false;
    var center = M4.pt(inverse, cell[0] + .5, cell[1] + .5, cell[2] + .5);
    if (ccInside(center, tree)) return true;
    var corners = [];
    for (var k = 0; k < 8; k++) corners.push(M4.pt(inverse, cell[0] + (k & 1 ? 1 : 0), cell[1] + (k & 2 ? 1 : 0), cell[2] + (k & 4 ? 1 : 0)));
    var faces = []; ccQuery(tree, ccBox(corners), 0, faces);
    return faces.some(function (face) {
      var world = face.p.map(function (p) { return M4.pt(matrix, p[0], p[1], p[2]); });
      return ccPolygonArea(ccBoxPolygon(world, cell, 1e-7)) > 1e-10;
    });
  }
  var seed = md.piv.map(Math.floor); if (!intersects(seed)) return component;
  var queue = [seed], seen = new Set();
  for (var head = 0; head < queue.length; head++) {
    var cell = queue[head], key = cell.join(','); if (seen.has(key)) continue; seen.add(key);
    if (!intersects(cell)) continue;
    component.add(key);
    if (component.size > 4096) { component.clear(); break; } // fail closed on an unexpected large component
    for (var axis = 0; axis < 3; axis++) for (var sign = -1; sign <= 1; sign += 2) { var next = cell.slice(); next[axis] += sign; queue.push(next); }
  }
  return component;
}
function ccBodyMount(sh, c, ids, poly, cell, geo) {
  if (!poly.length) return false;
  var T = c.T, packed = VK.pack(cell[0], cell[1], cell[2]), tol = 1e-4;
  for (var i = 0; i < T.n; i++) if (T.hk[i] === 1 && T.hv[i] === packed && c.pin[i]) {
    var point = Array.from(T.p0.slice(i * 3, i * 3 + 3));
    if (poly.every(function (p) {
      var material = [0, 0, 0]; for (var j = 0; j < 3; j++) for (var a = 0; a < 3; a++) material[a] += T.p0[ids[j] * 3 + a] * p[j + 3];
      return len(sub(p, point)) <= Math.sqrt(3) + tol && len(sub(material, point)) <= Math.sqrt(3) + tol;
    })) return true;
  }
  var seams = ccSeams(sh, c), tested = new Set();
  for (var i = 0; i < seams.length; i++) {
    var owner = seams[i].owner; if (tested.has(owner)) continue; tested.add(owner);
    if (ccLocalSeam(sh, c, ids, poly, owner) && ccYardBodyJoint(sh, geo, owner).has(cell.join(','))) return true;
  }
  return false;
}
function clothContacts(sh, c, deadline) {   // deadline：performance.now() 到這個時間就先停、記下做到哪個三角形（c.ccCur），下次接著做；回傳這一面掃完了沒
  if (!c.p || c.hidden || c.gone || !c.T.mi) return;
  var T = c.T, geo = ccGeometry(sh), fine = c.contactFine || (c.contactFine = new Float32Array(T.n * 3)), contacts = 0, locked = 0;
  if (!c.ccAcc || c.ccAcc.length !== c.p.length / 3) c.ccAcc = new Float32Array(c.p.length / 3); else c.ccAcc.fill(0);   // 每個點這一次推了多少（ccMove）
  clothFine(c, fine);
  var clothBox = ccBox(Array.from({ length: T.n }, function (_, i) { return Array.from(fine.slice(i * 3, i * 3 + 3)); }));
  var models = ccModels(sh, geo).filter(function (m) { return ccOverlap(clothBox, m.box, 3); });
  models.forEach(function (m) { if (!m.inverse) m.inverse = M4.inv(m.matrix); });
  var ropes = sh.ropes.map(function (r, i) { return { r: r, index: i, radius: sh.T.rig.ropes[i].radius || 0 }; }).filter(function (o) { var r = o.r; return !r.dead && ccOverlap(clothBox, r.bb || ccBox([r.pts.slice(0, 3), r.pts.slice(-3)]), 3); });
  ropes.forEach(function (o) { var r = o.r; if (r.ccPts === r.pts) return;
    var segs = []; for (var j = 0; j + 5 < r.pts.length; j += 3) { var a = [r.pts[j], r.pts[j + 1], r.pts[j + 2]], b = [r.pts[j + 3], r.pts[j + 4], r.pts[j + 5]]; segs.push({ a: a, end: b, b: ccBox([a, b]) }); }
    r.ccSegs = segs; r.ccPts = r.pts;
  });
  var bodyNear = []; ccQuery(geo.body, clothBox, CLOTH_CONTACT_MARGIN, bodyNear);
  if (!models.length && !ropes.length && !bodyNear.length) { c.contactStats = { contacts: 0, unsatisfiedPins: 0, first: 0 }; c.contactWarm = true; return; }   // 整面帆的外框碰不到任何東西 ⇒ 不用一個三角形一個三角形查
  var clothCenter = [0, 0, 0]; for (var vi = 0; vi < T.n; vi++) for (var a = 0; a < 3; a++) clothCenter[a] += fine[vi * 3 + a] / T.n;
  if (!T.mountNormal) {
    var sum = [0, 0, 0];
    for (var ti = 0; ti < T.tris.length; ti += 3) { var v = [T.tris[ti], T.tris[ti + 1], T.tris[ti + 2]].map(function (i) { return Array.from(T.p0.slice(i * 3, i * 3 + 3)); }); sum = add(sum, cross(sub(v[1], v[0]), sub(v[2], v[0]))); }
    T.mountNormal = norm(sum);
  }
  var first = -1, cut = false, start = c.ccCur || 0;
  for (var iteration = 0, passes = c.contactWarm ? CC_PASS[1] : CC_PASS[0]; iteration < passes; iteration++) {   // 輪數（ame：48／12 ⇒ CC_PASS；之後每一次跑仍然接著修 ⇒ 幾步內收斂）
    clothFine(c, fine); var moved = false;
    for (var ti = iteration ? 0 : start; ti < T.tris.length; ti += 3) {
      if (deadline && (ti & 63) === 0 && performance.now() > deadline) { c.ccCur = ti; cut = true; break; }   // 時間到 ⇒ 先停（一面帆切成幾段做，一格不會頓）
      var ids = [T.tris[ti], T.tris[ti + 1], T.tris[ti + 2]]; if (c.torn && ids.some(function (v) { return c.tv[v]; })) continue;
      // Read the latest coarse state: neighbouring triangles share degrees of freedom.
      var v = ids.map(function (q) { var p = [0, 0, 0]; for (var k = 0; k < 4; k++) { var at = q * 4 + k, n = T.mi[at] * 3, w = T.mw[at]; for (var a = 0; a < 3; a++) p[a] += c.p[n + a] * w; } return p; }), box = ccBox(v), cells = [];
      if (bodyNear.length) ccQuery(geo.body, box, 0, cells);
      for (var bi = 0; bi < cells.length; bi++) { var b = cells[bi].b;
        for (var x = Math.max(b[0], Math.floor(box[0])); x < Math.min(b[3], Math.ceil(box[3] + 1e-7)); x++) for (var y = Math.max(b[1], Math.floor(box[1])); y < Math.min(b[4], Math.ceil(box[4] + 1e-7)); y++) for (var z = Math.max(b[2], Math.floor(box[2])); z < Math.min(b[5], Math.ceil(box[5] + 1e-7)); z++) {
          if (!sh.grid.get(x, y, z)) continue; var hit = ccTriangleBox(v, [x, y, z, x + 1, y + 1, z + 1]); if (!hit) continue;
          if (ccBodyMount(sh, c, ids, ccBoxPolygon(v, [x, y, z]), [x, y, z], geo)) continue;
          var plane = ccBodyPlane(sh.grid, v, [x, y, z]);
          contacts++; if (plane && ccSeparate(c, ids, v, plane.normal, plane.limit)) moved = true; else locked++;
        }
      }
      for (var mk = 0; mk < models.length; mk++) { var model = models[mk]; if (!ccOverlap(box, model.box, CLOTH_CONTACT_MARGIN)) continue;
        var local = v.map(function (p) { return M4.pt(model.inverse, p[0], p[1], p[2]); }), localBox = ccBox(local), faces = []; ccQuery(ccMesh(geo, model.m.mesh), localBox, CLOTH_CONTACT_MARGIN, faces);
        if (ccSeams(sh, c).some(function (s) { return s.owner === model.m.k; })) {
          var contactSet = ccModelContactSet(v, local, model, faces, ccMesh(geo, model.m.mesh));
          if (ccLocalSeam(sh, c, ids, contactSet, model.m.k)) continue;
        }
        var center = mul(add(add(local[0], local[1]), local[2]), 1 / 3);
        if (ccInside(center, ccMesh(geo, model.m.mesh))) {
          var near = ccNearest(center, ccMesh(geo, model.m.mesh)), direction = norm(sub(near.p, center));
          contacts++; if (ccMove(c, ids, [1 / 3, 1 / 3, 1 / 3], M4.dir(model.matrix,
            direction[0] * (Math.sqrt(near.d) + CLOTH_CONTACT_MARGIN), direction[1] * (Math.sqrt(near.d) + CLOTH_CONTACT_MARGIN), direction[2] * (Math.sqrt(near.d) + CLOTH_CONTACT_MARGIN)), true)) moved = true; else locked++;
          continue;
        }
        for (var fi = 0; fi < faces.length; fi++) { var face = faces[fi].p, crossing = null;
          for (var edge = 0; edge < 3 && !crossing; edge++) { var h = ccSegmentTri(local[edge], local[(edge + 1) % 3], face); if (h) { var w = [0, 0, 0]; w[edge] = 1 - h.t; w[(edge + 1) % 3] = h.t; crossing = { p: h.p, w: w }; } }
          for (var edge = 0; edge < 3 && !crossing; edge++) crossing = ccSegmentTri(face[edge], face[(edge + 1) % 3], local);
          if (!crossing) continue;
          var world = M4.pt(model.matrix, crossing.p[0], crossing.p[1], crossing.p[2]);
          var normal = mul(norm(cross(sub(face[1], face[0]), sub(face[2], face[0]))), ccMesh(geo, model.m.mesh).orientation), depth = Math.max.apply(null, local.map(function (p) { return -dot(sub(p, face[0]), normal); })), delta = M4.dir(model.matrix, normal[0], normal[1], normal[2]);
          contacts++; if (ccSeparate(c, ids, v, norm(delta), dot(world, norm(delta)) + CLOTH_CONTACT_MARGIN)) moved = true; else locked++;
          break; // Recompute shared vertices before another face of the same solid.
        }
      }
      for (var ri = 0; ri < ropes.length; ri++) { var rope = ropes[ri].r, radius = ropes[ri].radius + CLOTH_CONTACT_MARGIN; if (!ccOverlap(box, rope.bb || ccBox([rope.pts.slice(0, 3), rope.pts.slice(-3)]), radius)) continue;
        var segments = rope.ccSegs.filter(function (q) { return ccOverlap(q.b, box, radius); });
        for (var rj = 0; rj < segments.length; rj++) { var a = segments[rj].a, b = segments[rj].end, hit = ccCapsule(a, b, v); if (hit.d >= radius) continue;
          if (ccRopeMount(c, ids, v, ropes[ri], a, b)) continue;
          var d = norm(sub(b, a)), normal = sub(T.mountNormal, mul(d, dot(T.mountNormal, d)));
          if (len(normal) < 1e-7) normal = cross(d, [0, 0, 1]);
          var side = c.contactSides[rope.name];
          if (!side) side = dot(sub(clothCenter, a), normal) < 0 ? -1 : 1;
          for (var j = 0; j < 3; j++) if (c.pin[ids[j]] && len(sub(v[j], ccOnSegment(v[j], a, b))) < radius + 3) {
            var signed = dot(sub(v[j], a), normal); if (Math.abs(signed) > radius) side = c.contactSides[rope.name] = signed < 0 ? -1 : 1;
          }
          normal = mul(normal, side);
          normal = norm(normal);
          contacts++; if (ccSeparate(c, ids, v, normal, dot(a, normal) + radius, false)) moved = true; else locked++;
        }
      }
    }
    if (first < 0) first = contacts;
    if (cut) break;
    c.ccCur = 0;
    if (!moved) break;
  }
  c.contactStats = { contacts: contacts, unsatisfiedPins: locked, first: first < 0 ? 0 : first };
  if (!cut) c.contactWarm = true;
  return !cut;
}

