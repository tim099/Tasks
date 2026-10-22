// ───────────────────────── 斷開的一團：倒下、落水 ─────────────────────────
function isAnchor(x, y, z) { return z <= 12; }   // 龍骨（龍骨是直的 ⇒ 整條都在最底下）
function integrity(sh) {
  if (!sh.seeds.length) return;
  var seeds = sh.seeds; sh.seeds = [];
  var anchor = sh.keel ? function (x, y, z) { return z <= 12 && x >= sh.keel[0] && x <= sh.keel[1]; } : isAnchor;   // 船斷成兩截之後：龍骨的錨只留長的那半截（23_powder.js breakShip）
  var pieces = VK.detached(sh.grid, seeds, anchor, 900000);
  pieces.forEach(function (pc) { spawnPiece(sh, pc); });
}
function spawnPiece(sh, pc) {
  var n = pc.length, i, x, y, z, c;
  if (n < 40) {                                               // 小碎塊直接變碎屑
    for (i = 0; i < n; i++) { x = pc[i] & 2047; y = (pc[i] >> 11) & 1023; z = pc[i] >> 21; c = removeVoxel(sh, x, y, z, false);
      if (c) spawnDebris(M4.pt(sh.M, x + 0.5, y + 0.5, z + 0.5), add([gauss(), rr(-0.5, 1), gauss()], sh.vel), c, rr(0.06, 0.1), rr(8, 16)); }
    return;
  }
  var g = new VK.Grid([sh.T.base.sx, sh.T.base.sy, sh.T.base.sz]), sx = 0, sy = 0, sz = 0, minz = 1e9, set = new Set();
  for (i = 0; i < n; i++) {
    x = pc[i] & 2047; y = (pc[i] >> 11) & 1023; z = pc[i] >> 21; c = removeVoxel(sh, x, y, z, false);
    if (!c) continue; g.set(x, y, z, c); sx += x; sy += y; sz += z; if (z < minz) minz = z; set.add(pc[i]);
  }
  var px = 0, py = 0, pz = 0, pn = 0;
  for (i = 0; i < n; i++) { z = pc[i] >> 21; if (z <= minz + 2) { px += (pc[i] & 2047); py += (pc[i] >> 11) & 1023; pz += z; pn++; } }
  var M0 = sh.M, c0 = M4.pt(M0, sx / n + 0.5, sy / n + 0.5, sz / n + 0.5), pivot = M4.pt(M0, px / pn + 0.5, py / pn + 0.5, pz / pn);
  var imp = sh.impulse; imp = [imp[0], 0, imp[2]]; if (len(imp) < 1e-6) imp = [rnd() - 0.5, 0, rnd() - 0.5];
  var axis = norm(cross([0, 1, 0], norm(imp)));
  var piece = { T: sh.T, team: sh.team, grid: g, M0: M0, c0: c0, c: c0.slice(), R: M4.ident(), v: [0, 0, 0], w: mul(axis, rr(0.18, 0.35)), pivot: pivot, n: n,
    hinge: c0[1] - pivot[1] > 2.5, t: 0, wet: false, ropes: [], cl: [], rigDirty: true, lines: null, mods: [] };
  if (sh.keel && n > 60000) {                                 // 斷成兩截的那半截船：不繞斷口倒 —— 帶著船速漂、斷口那頭往下、慢慢沉
    var fw = M4.dir(sh.M, 1, 0, 0), sideK = (sx / n) > sh.breakX ? 1 : -1;
    piece.hinge = false; piece.hull = norm(mul(cross([fw[0], 0, fw[2]], [0, 1, 0]), sideK)); piece.v = sh.vel.slice();
  }
  // 繩與帆跟著走：兩端都在這一團 ⇒ 帶走（moved：不變成垂下來的繩）；只有一端 ⇒ 斷
  var moved = new Set();
  sh.ropes.forEach(function (r, j) {
    if (r.dead || r.par) return;
    var ia = set.has(r.a), ib = set.has(r.b);
    if (ia && ib) { piece.ropes.push({ pts: r.pts, col: r.col, bb: r.bb }); r.dead = true; r.moved = true; moved.add(j); }
    else if (ia || ib) r.dead = true;
  });
  sh.ropes.forEach(function (r, j) {
    if (r.dead || !r.par) return;
    var ends = [r.a, r.b].filter(function (a) { return a >= 0; });
    if (r.par.length && r.par.every(function (k) { return moved.has(k); }) && ends.every(function (a) { return set.has(a); })) { piece.ropes.push({ pts: r.pts, col: r.col, bb: r.bb }); r.dead = true; r.moved = true; moved.add(j); }
    else if (r.par.some(function (k) { return moved.has(k); }) || ends.some(function (a) { return set.has(a); })) r.dead = true;
  });
  sh.sails.forEach(function (s) {           // 依靠全在這一團（格在、掛的繩也被帶走）⇒ 跟著倒；只有一部分 ⇒ 掉下來
    if (s.dead) return;
    if (!s.furled && s.par.some(function (j) { return sh.ropes[j].dead && !moved.has(j); })) { dropSail(sh, s); return; }   // 掛的支索這一下斷了（沒被帶走）⇒ 現在就掉，不等下一次 survey；收著的帆不怕
    var inA = s.as.filter(function (a) { return set.has(a); }).length, inP = s.par.filter(function (j) { return moved.has(j); }).length;
    if (!inA && !inP) return;
    if (inA === s.as.length && inP === s.par.length) {
      s.dead = true; sailLinesDie(sh, s);
      var c = sh.cl[s.k];                                               // 帶著現在的形狀走（物理開著 ⇒ 被風吹鼓的那一刻）
      if (!s.furled) piece.cl.push({ T: c.T, p: PHYS && c.p ? Float32Array.from(c.p) : null, torn: !!c.torn, tv: c.tv, bf: s.burn || null });   // bf：燒過的帆（49_burn.js）⇒ 帶走的那面照樣畫焦痕、還在燒的照樣燒完（11_rig_gpu.js）
      c.gone = c.moved = true;
    }
    else dropSail(sh, s);
  });
  sh.crew.forEach(function (c) { if (c.st < 3 && set.has(VK.pack(Math.floor(c.pos[0]), Math.floor(c.pos[1]), c.pos[2] - 1))) crewFall(sh, c, mul(axis, 2)); });
  sh.models.forEach(function (m) {                            // 腳下那一格在這一團裡的模型（砲、舵輪）跟著走（⛔ 不跟 ⇒ 下一次 survey 從漂走的半截船裡直直掉進海裡）
    if (!m.alive || !set.has(m.foot)) return;
    m.alive = false; m.moved = true; piece.mods.push({ mesh: m.mesh, L: modelLocal(m) });
    sh.guns.forEach(function (g) { if (g.model === m) g.alive = false; });
  });
  piece.sh = sh; piece.pivotL = M4.pt(sh.inv, pivot[0], pivot[1], pivot[2]);
  sh.rigDirty = true;
  PIECES.push(piece); evEmit('pieceNew', piece);                       // 網格分批建（62_simview.js；只給人看）
  if (n > 3000) { sfx('creak', c0, 1.4); note(sh, piece.hull ? '船斷成兩截！' : c0[1] - pivot[1] > 8 ? '桅杆斷了！' : '一大塊船體脫落', !!piece.hull); }
}
/** 倒下的那一團掃過甲板：沿著它倒下的那條線（斷口 → 2 倍重心距離）1.5 公尺內的人被壓到。 */
function crush(pc, r) {
  if (!pc.sh) return;
  var sh = pc.sh, a = pc.pivot, b = add(pc.pivot, mul(r, 2));
  sh.crew.forEach(function (c) {
    if (c.st > 1) return;
    var w = M4.pt(sh.M, c.pos[0], c.pos[1], c.pos[2] + 9);
    if (segDist2(w, a[0], a[1], a[2], b[0], b[1], b[2]) < 2.25) damageCrew(sh, c, 120 * rr(0.6, 1.4), '倒下的桅');   // 血量 100 時約七成壓死
  });
}
/** 位移上限（TASK-0797）：碎塊一小步最多走 PIECE_CAP 公尺（落水那一下不衝太深、繞斷口倒不一步轉過頭）；60 Hz ⇒ 不切。 */
var PIECE_CAP = 0.5;
function stepPiece(pc, dt) {
  var r = pc.hinge ? Math.sqrt(dot(sub(pc.c, pc.pivot), sub(pc.c, pc.pivot))) : 0, d = (pc.v ? len(pc.v) : 0) + (pc.w ? len(pc.w) * r : 0);
  var n = subSteps(d * dt, PIECE_CAP, dt, true);
  if (n === 1) return stepPiece1(pc, dt);
  for (var i = 0; i < n; i++) if (!stepPiece1(pc, dt / n)) return false;
  return true;
}
function stepPiece1(pc, dt) {
  pc.t += dt;
  var g = [0, -G, 0];
  if (pc.hull) {                                                // 斷開的半截船：水平慢慢停下、斷口那頭往下翹（最多約 35°）、往下沉越來越快
    pc.v[0] *= 1 - 0.12 * dt; pc.v[2] *= 1 - 0.12 * dt; pc.v[1] = -Math.min(1.6, 0.12 + pc.t * 0.025);
    pc.c = add(pc.c, mul(pc.v, dt));
    var ang = Math.min(0.6, pc.t * 0.035) + Math.max(0, pc.t - 17) * 0.01;
    pc.R = rotM(pc.hull, ang);
    if (!pc.wet) { pc.wet = true; for (var k2 = 0; k2 < 6; k2++) splash(add(pc.c, [gauss() * 6, 0, gauss() * 6]), true); }
    pc.M = M4.mul(M4.mul(M4.mul(trans(pc.c[0], pc.c[1], pc.c[2]), pc.R), trans(-pc.c0[0], -pc.c0[1], -pc.c0[2])), pc.M0);
    return pc.c[1] > (VX ? vxH(pc.c[0], pc.c[2]) : 0) - 60 && pc.t < 150;   // 大漩渦：照漏斗那裡的水面算多深
  }
  if (pc.hinge) {                                               // 繞斷口倒：細棒繞端點 α ＝ (r × g)·3／(4|r|²)
    if (pc.sh) { var np = M4.pt(pc.sh.M, pc.pivotL[0], pc.pivotL[1], pc.pivotL[2]); pc.c = add(pc.c, sub(np, pc.pivot)); pc.pivot = np; }   // 斷口跟著船走（船在航行）
    var r = sub(pc.c, pc.pivot), r2 = dot(r, r), alpha = mul(cross(r, g), 3 / (4 * r2));
    pc.w = add(pc.w, mul(alpha, dt));
    var ang = len(pc.w) * dt;
    if (ang > 0) { var Rm = rotM(pc.w, ang); r = M4.dir(Rm, r[0], r[1], r[2]); pc.c = add(pc.pivot, r); pc.R = M4.mul(Rm, pc.R); }
    var tilt = Math.acos(clamp(r[1] / Math.sqrt(r2), -1, 1));
    if (tilt > 1.25 || pc.t > 6) { pc.hinge = false; pc.v = add(cross(pc.w, r), pc.sh ? pc.sh.vel : [0, 0, 0]); crush(pc, r); }
  } else {
    pc.v = add(pc.v, mul(g, dt));
    var sea = seaH(pc.c[0], pc.c[2], SIMT);
    if (pc.c[1] < sea) {
      var float = sea + (pc.t < 40 ? -0.6 : -0.6 - (pc.t - 40) * 0.8);                     // 浮在水面 40 秒，之後慢慢沉
      pc.v[1] += ((float - pc.c[1]) * 3 - pc.v[1] * 2.5) * dt + G * dt;
      if (VX) { var cf = vxFlow(pc.c[0], pc.c[2]), dk = 1 - 1.6 * dt; pc.v = [cf[0] + (pc.v[0] - cf[0]) * dk, pc.v[1] * dk, cf[1] + (pc.v[2] - cf[1]) * dk]; }   // 大漩渦（08_sea.js）：水平的阻力照「對水」的速度 ⇒ 漂著的碎片跟著水流繞
      else pc.v = mul(pc.v, 1 - 1.6 * dt);
      pc.w = mul(pc.w, 1 - 1.8 * dt);
      if (!pc.wet) { pc.wet = true; for (var k = 0; k < Math.min(6, 1 + pc.n / 8000); k++) splash(add(pc.c, [gauss() * 4, 0, gauss() * 4]), true); } }
    pc.c = add(pc.c, mul(pc.v, dt));
    var a2 = len(pc.w) * dt; if (a2 > 0) pc.R = M4.mul(rotM(pc.w, a2), pc.R);
  }
  pc.M = M4.mul(M4.mul(M4.mul(trans(pc.c[0], pc.c[1], pc.c[2]), pc.R), trans(-pc.c0[0], -pc.c0[1], -pc.c0[2])), pc.M0);
  return pc.c[1] > (VX ? vxH(pc.c[0], pc.c[2]) : 0) - 40 && pc.t < 120;   // 大漩渦：照漏斗那裡的水面算多深（⛔ 照 0 ⇒ 深 75 m 的漏斗裡碎片一出現就拿掉）
}

