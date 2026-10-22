// ───────────────────────── 繩與帆的 GPU 緩衝 ─────────────────────────
function buildRig(owner) {          // 還綁著的繩（靜態，照雕刻作品的形狀）；帆在 sailBuf、垂下來的繩在 looseBuf
  var L = [], hide = {};
  (owner.sails || []).forEach(function (s, k) {                       // 收起來的帆，它自己的繩（s.lines：sheet、tack…）不畫（Tim 2026-10-15：收帆後會浮空）；物理開著 ⇒ 收攏演完、帆真的藏起來才藏。只是不畫：判斷照舊
    if (!s.furled || s.dead || !s.lines) return; var c = owner.cl && owner.cl[k];
    if (PHYS && c && c.p && !c.hidden) return;
    if (PHYS && c && c.fz && !c.gone && !c.loose) return;               // 收帆停在演完那一刻（30_rig_physics.js furlFreeze）⇒ 繩留著
    s.lines.forEach(function (j) { hide[j] = 1; });
  });
  var tj = PHYS && owner.tJ, tc = PHYS && owner.tCut;                  // 跟著帆腳走的 sheet、tack（30_rig_physics.js tethOf）：looseBuf 每一格畫；tCut：帆腳被打掉、已經垂下來的（tethCut）
  var CR = owner.crew && owner.T ? climbRopes(owner.T) : null, TB = CR ? [] : null;   // 繩梯的繩畫成管子（climbRopes）
  owner.ropes.forEach(function (r, j) {
    if (r.dead || hide[j] || tj && tj[j] || tc && tc[j]) return;
    if (CR && CR[j]) { ropeTube(TB, r.pts, r.col, Math.max(ROPE_TUBE_MIN, owner.T.rig.ropes[j].radius || 0)); return; }
    for (var j = 0; j + 5 < r.pts.length; j += 3) L.push(r.pts[j], r.pts[j + 1], r.pts[j + 2], r.col[0], r.col[1], r.col[2], r.pts[j + 3], r.pts[j + 4], r.pts[j + 5], r.col[0], r.col[1], r.col[2]);
  });
  owner.lines = upload(owner.lines, new Float32Array(L), 6, [[0, 3, 0], [2, 3, 3]]);
  if (TB) owner.ropeT = upload(owner.ropeT, new Float32Array(TB), 6, [[0, 3, 0], [2, 3, 3]]);   // 60_render.js 跟線同一趟畫（三角形）
  owner.rigDirty = false;
}
// 繩梯的繩畫成實心的細管（Tim 2026-10-17：「繩梯的繩子可以粗一點」）：一般的繩照舊一條線（1 像素，雕刻的粗細只拿來算碰撞）；
//   繩梯 ＝ 橫繩組 climb 的每一道（meta climb）＋它掛的那兩根母繩（每一道的端點 rope:母繩/比例）⇒ 照雕刻的粗細（radius，格；最細 ROPE_TUBE_MIN）畫六角管、不打光（顏色同線）。
var ROPE_TUBE_MIN = 0.15, ROPE_TUBE_SIDES = 6;
/** 船型 T 的繩梯是哪幾條繩（{ j: 1 }；沒有 ⇒ null；同一型算一次）。 */
function climbRopes(T) {
  if (T.climbR !== undefined) return T.climbR;
  var R = (T.rig && T.rig.ropes) || [], idx = {}, S = null;
  function full(fr, n) { return fr ? fr + '/' + n : n; }
  R.forEach(function (r, j) { idx[full(r.frame || '', r.name)] = j; });
  R.forEach(function (r, j) {
    if (!r.meta || !+r.meta.climb) return;
    (S = S || {})[j] = 1;
    (r.ends || []).forEach(function (e) { if (typeof e !== 'string' || e.indexOf('rope:') !== 0) return; var q = e.slice(5), i = q.lastIndexOf('/'), k = idx[full(r.frame || '', q.slice(0, i))]; if (k !== undefined) S[k] = 1; });
  });
  return (T.climbR = S);
}
/** 一條繩（pts：格座標，三個一組）畫成半徑 w 的六角管，三角形推進 TB（位置 3、色 3）。 */
function ropeTube(TB, P, col, w) {
  for (var i = 0; i + 5 < P.length; i += 3) {
    var a = [P[i], P[i + 1], P[i + 2]], b = [P[i + 3], P[i + 4], P[i + 5]], d = sub(b, a), dl = len(d); if (dl < 1e-6) continue;
    d = mul(d, 1 / dl);
    var u = Math.abs(d[2]) > 0.9 ? [1, 0, 0] : norm([d[1], -d[0], 0]), v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]], R = [];
    for (var k = 0; k <= ROPE_TUBE_SIDES; k++) { var t = k / ROPE_TUBE_SIDES * 6.28319, o = add(mul(u, Math.cos(t) * w), mul(v, Math.sin(t) * w)); R.push(o); }
    for (k = 0; k < ROPE_TUBE_SIDES; k++) {
      var p0 = add(a, R[k]), p1 = add(a, R[k + 1]), q0 = add(b, R[k]), q1 = add(b, R[k + 1]);
      [p0, p1, q1, p0, q1, q0].forEach(function (p) { TB.push(p[0], p[1], p[2], col[0], col[1], col[2]); });
    }
  }
}
/** 帆的網格（一個 owner 一份，索引畫）：頂點法線 ＝ 相鄰三角形的面積加權平均 ⇒ 布是圓的，不是一面一面的。
 *  關物理 ⇒ 位置就是雕刻作品那一刻（T.p0），只在 rigDirty 時重做；開物理 ⇒ 模擬走過一步才重做（沒走的那一格照用上一份：rigSame、60_render.js prepRig）。
 *  帆的布片（34_shreds.js）接在帆後面、同一個緩衝 ⇒ 陰影、反射照帆畫。
 *  動、靜分兩份（render 管線大修 R1；Tim：「只有被破壞時重算網格」）：重做時只算、只傳動的那份（位置、法線：ow.sb.vbo，bufferSubData）；
 *    靜的（色、貼圖集的 uv、著火、雜訊座標：ow.sb.sbo）與索引（ow.sb.ebo）只在變的那一刻傳變的那一段（sailBuf 的 put 跟上一次每一面的樣子 ow.sb.L 比）：
 *    撕開、收好那一捲少了幾點 ⇒ 從那一面起的索引；著火、撲滅、貼圖集、陣營換了 ⇒ 那一面的靜的；畫的帆換了（藏起來、掉了、布片新增或拿掉）⇒ 從那一面起整段。
 *    整面不畫的帆（藏起來、掉了、收起來沒留那一捲）本來就不在緩衝裡：不算位置、不傳、不畫（Tim：「整張帆被破壞除外(就不用算了)」）⇒ 畫的永遠是一段、一個 owner 一個 drawElements。
 *  第二層（R2；Tim「帆繩可以用骨骼動畫概念」「甚至也不用重建 可以參考著火 讓被破壞的部分變成透明」）：動的那份改由 GPU 寫（SAILK）——
 *    CPU 每一步只把細格位置（物理的粒子就是細格點：30_rig_physics.js contact-fine ⇒ 直接抄 c.p）傳成一張浮點貼圖，GPU 照三角形表、鄰接表算法線（同樣的三角形順序、跳過撕開的）寫進 ow.sb.vbo；
 *    索引一律是全部三角形：撕開、收好那一捲少了幾點 ⇒ 只改那幾個三角形（三角形表的「還在」、索引的三點疊成一點 ⇒ 面積 0、不出像素），不重排。著色器 P.sail／P.dsail 一字沒改；?sailk=0 照 R1。 */
// 頂點：動的 ＝ 位置 3、法線 3；靜的 ＝ 色 3、貼圖集的 uv 2（TASK-0579；沒有貼圖 ⇒ u ＝ −1，著色器照色畫）、著火 4（TASK-0717：火燒到的時間 a、撲滅的時間 x —— 49_burn.js s.burn，
//   沒燒過 ＝ BURN_NEVER ⇒ 著色器那一段整個跳過；雜訊座標 ＝ 作品形狀的 ((x＋y)·S, z·S) 公尺 ⇒ 布被吹動時焦痕跟著布、不會滑）、
//   毛邊 3（R3，sailRagH：離洞幾圈、毛邊的雜訊座標 u／v（這一面最攤開的兩個軸，以細格為單位）；布片照第一次畫到時的形狀 sailShredG0）。
var SBV = null, SBI = null, SBN = null, SBP = null, SBD = null, SB_STRIDE = 18, SB_DW = 6, SB_SW = 12, SAIL_UNIT = 9, SAIL_DUMMY = null;
// 帆破洞的毛邊（render 管線大修 R3，TASK-0791）：?sailrag=0 ⇒ 照以前（離洞幾圈全是 SAIL_RAG_FAR、布片沒有雜訊座標、撕開只改索引）。
var SAIL_RAG_ON = Q.get('sailrag') !== '0', SAIL_RAG_FAR = 2, SAIL_RAG_SH = 0.35, SAIL_RAG_G0 = new WeakMap();
// 跟帆身斷開的那幾塊不畫（sailIsland；Tim 2026-10-21「完全脫離部分應該要消失(中間都被打成透明了) 可以跟火燒一起處理」）：?sailisl=0 ⇒ 照畫。
var SAIL_ISL_ON = Q.get('sailisl') !== '0', SAIL_ISL = new WeakMap();
/** 帆的貼圖集（30_rig_physics.js sailAtlas）⇒ GL 貼圖（第一次畫才建，記在船型上）；沒有 ⇒ 1×1 的空貼圖（取樣器一定要綁一張）。 */
function sailTex(T) {
  if (T && T.sailAtlas && !T.sailTexGL) {
    var A = T.sailAtlas, t = T.sailTexGL = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, A.w, A.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, A.data);
    [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST); });   // 像素畫：一格一格（⛔ LINEAR ⇒ 洞的邊緣跟隔壁的色混在一起）
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE); });
  }
  if (T && T.sailTexGL) return T.sailTexGL;
  if (!SAIL_DUMMY) { SAIL_DUMMY = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, SAIL_DUMMY); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255])); }
  return SAIL_DUMMY;
}
/** 這一格畫哪幾面帆、哪幾片布片：每一面叫一次 put(o, T, P, n, tris, col, tv, vc, uv, r, bF, g0, rg, th)，回這一格跟著帆腳畫的繩 { td, tk }（looseBuf）。
 *  o：布（sh.cl[k]）或布片本身、T：它的模板；P：細格位置（暫存區 SBP，下一面就蓋掉）；tv：不畫的細格點（撕開的洞、收好那一捲少的、跟帆身斷開的那幾塊 sailIsland）；vc：每個頂點的顏色（沒有貼圖集時的退路，
 *  30_rig_physics.js texColors）；uv＋r：貼圖集的那一格；bF：著火（s.burn）、g0：雜訊座標用的作品形狀；rg：1 ＝ 布片（外緣整圈是撕下來的邊，sailRagH）；
 *  th：物理上的洞（撕開的、收好那一捲少的；不含 sailIsland 藏的）⇒ 毛邊照它算。
 *  sailBuf（動靜分開傳）與 sailFill（?rigchk=1 對拍用的整份）共用 ⇒ 畫哪幾面、位置怎麼算只有一份。
 *  raw（R2）：細格就是物理的粒子（sailIdent）、沒在演收帆 ⇒ P 直接是 c.p（不抄一份；put 只讀）。 */
function sailWalk(ow, put, raw) {
  var isShip = !!ow.crew, F = isShip && PHYS && ow.shreds && ow.shreds.length ? ow.shreds : null, A = ow.T && ow.T.sailAtlas, m1 = 1;
  (ow.cl || []).forEach(function (c) { m1 = Math.max(m1, c.T.n); });
  if (F) F.forEach(function (f) { m1 = Math.max(m1, f.n); });
  if (!SBN || SBN.length < m1 * 3) { SBN = new Float32Array(m1 * 3); SBP = new Float32Array(m1 * 3); }
  var td = [], tk = '';                                                  // 這一格跟著帆腳畫的繩（looseBuf）
  (ow.cl || []).forEach(function (c, k) {
    var P;
    if (isShip) {
      var s = ow.sails[k], keep = furlKeep(s) && (PHYS ? !c.gone && !c.loose && (!c.p || c.hidden) : true);   // 收好的帆留一捲（30_rig_physics.js furlBundle；只是畫）
      if (!keep && (PHYS ? (!c.p || c.hidden || c.gone) : (s.dead || s.furled))) return;
      var frz = keep && PHYS && c.fz;                                    // 物理開著、收攏演完過 ⇒ 停在演完那一刻（30_rig_physics.js furlFreeze）；沒演過（開局就收著）⇒ 照舊那一捲
      if (keep) { P = frz ? furlFrozen(ow, c, SBP) : furlBundle(ow, c, SBP); var lost = furlLost(ow, s, c); }   // lost：靠的帆桁、格不在了的那幾點不畫（30_rig_physics.js furlLost）
      if (frz && c.tt) c.tt.forEach(function (t) { if (ow.ropes[t.j].dead || ow.tCut && ow.tCut[t.j] || lost && lost[t.i]) return; var o = t.i * 3; td.push({ t: t, x: P[o], y: P[o + 1], z: P[o + 2] }); tk += t.j + ','; });   // 帆腳的繩跟著凍結的帆腳
    }
    if (!P) P = (PHYS || !isShip) && c.p ? (isShip && c.furlF !== null && c.furlF !== undefined ? furlDraw(c, clothFine(c, SBP), c.furlF, ow) : raw && sailIdent(c.T) ? c.p : clothFine(c, SBP)) : c.T.p0;   // furlDraw：收帆張帆的演出（30_rig_physics.js）
    if (isShip && PHYS && c.tt && c.p && !c.hidden && !c.gone && !c.loose) c.tt.forEach(function (t) { if (ow.ropes[t.j].dead || ow.tCut && ow.tCut[t.j]) return; var o = t.i * 3; td.push({ t: t, x: P[o], y: P[o + 1], z: P[o + 2] }); tk += t.j + ','; });   // 畫出來的帆腳（收帆演出時也是）
    var tv0 = keep ? lost : c.torn ? c.tv : null, bF = isShip ? ow.sails[k].burn : c.bf;   // 斷開那一團帶走的帆：c.bf（22_pieces.js）
    put(c, c.T, P, c.T.n, c.T.tris, c.T.col, SAIL_ISL_ON ? sailIsland(c, c.T.n, c.T.tris, tv0, bF) : tv0, c.T.vcol, c.T.uv, A && c.T.ti !== undefined ? sailRect(ow, A, c.T.ti) : null, bF, c.T.p0, 0, tv0);
  });
  if (F) F.forEach(function (f) { put(f, f.T, f.p, f.n, f.T.sim.tris, f.col, null, null, f.uv, A && f.uv && f.ti !== undefined ? sailRect(ow, A, f.ti) : null, null, SAIL_RAG_ON ? sailShredG0(f) : null, 1, null); });   // 布片：有貼圖的帆撕下來的照原處的圖（34_shreds.js shredCut 記 uv）
  return { td: td, tk: tk };
}
/** ?rigchk=1 對拍用：以前那一份 —— 整份重填暫存區（SBV 頂點 SB_NV 個 × 15、SBI 索引 SB_NI 個），回 { td, tk }。只讀、不傳 GPU（rigChk 拿來跟 GPU 上那一份比）。 */
var SB_NV = 0, SB_NI = 0;
function sailFill(ow) {
  var nv = 0, ni = 0, mv = 0, mi = 0, A = ow.T && ow.T.sailAtlas;
  (ow.cl || []).forEach(function (c) { mv += c.T.n; mi += c.T.tris.length; });
  if (ow.crew && PHYS && ow.shreds) ow.shreds.forEach(function (f) { mv += f.n; mi += f.T.sim.tris.length; });
  if (!SBV || SBV.length < mv * SB_STRIDE) SBV = new Float32Array(Math.ceil(Math.max(1, mv) * 1.33) * SB_STRIDE);
  if (!SBI || SBI.length < mi) SBI = new Uint32Array(Math.ceil(Math.max(1, mi) * 1.33));
  var f = sailWalk(ow, function (o, T, p, n, tr, col, tv, vc, uv, r, bF, g0, rg, th) {
    var base = nv, j, i, H = SAIL_RAG_ON ? sailRagH(tr, n, th, rg, g0) : null;
    SBN.fill(0, 0, n * 3);
    for (j = 0; j < tr.length; j += 3) {
      if (tv && (tv[tr[j]] || tv[tr[j + 1]] || tv[tr[j + 2]])) continue;
      var a = tr[j] * 3, b = tr[j + 1] * 3, d = tr[j + 2] * 3;
      var ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[d] - p[a], vy = p[d + 1] - p[a + 1], vz = p[d + 2] - p[a + 2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      SBN[a] += nx; SBN[a + 1] += ny; SBN[a + 2] += nz; SBN[b] += nx; SBN[b + 1] += ny; SBN[b + 2] += nz; SBN[d] += nx; SBN[d + 1] += ny; SBN[d + 2] += nz;
      SBI[ni++] = base + tr[j]; SBI[ni++] = base + tr[j + 1]; SBI[ni++] = base + tr[j + 2];
    }
    for (i = 0; i < n; i++) {
      var o6 = (base + i) * SB_STRIDE, q = i * 3;
      SBV[o6] = p[q]; SBV[o6 + 1] = p[q + 1]; SBV[o6 + 2] = p[q + 2]; SBV[o6 + 3] = SBN[q]; SBV[o6 + 4] = SBN[q + 1]; SBV[o6 + 5] = SBN[q + 2];
      if (vc) { SBV[o6 + 6] = vc[q]; SBV[o6 + 7] = vc[q + 1]; SBV[o6 + 8] = vc[q + 2]; } else { SBV[o6 + 6] = col[0]; SBV[o6 + 7] = col[1]; SBV[o6 + 8] = col[2]; }
      if (uv && r) { SBV[o6 + 9] = (r[0] + uv[i * 2] * r[2]) / A.w; SBV[o6 + 10] = (r[1] + uv[i * 2 + 1] * r[3]) / A.h; } else { SBV[o6 + 9] = -1; SBV[o6 + 10] = -1; }
      if (bF) { SBV[o6 + 11] = bF.a[i]; SBV[o6 + 12] = bF.x[i]; } else { SBV[o6 + 11] = BURN_NEVER; SBV[o6 + 12] = BURN_NEVER; }
      if (g0) { SBV[o6 + 13] = (g0[q] + g0[q + 1]) * S; SBV[o6 + 14] = g0[q + 2] * S; } else { SBV[o6 + 13] = 0; SBV[o6 + 14] = 0; }
      if (H) { SBV[o6 + 15] = H[q]; SBV[o6 + 16] = H[q + 1]; SBV[o6 + 17] = H[q + 2]; } else { SBV[o6 + 15] = SAIL_RAG_FAR; SBV[o6 + 16] = 0; SBV[o6 + 17] = 0; }
    }
    nv += n;
  });
  SB_NV = nv; SB_NI = ni;
  return f;
}
/** 帆的緩衝（動靜分開，見上）：動的照現在的狀態整份重算、重傳；靜的與索引跟上一次每一面的樣子（ow.sb.L）比，只重填、只傳變的那一段。
 *  ow.sb.SV／IV：靜的、索引在 CPU 的那一份（傳一段要從它拿；不夠就加大三成、GPU 那份整份重配）；gs／gi／gd：GPU 上靜的、索引、動的配了多大。
 *  算的式子、順序跟以前一模一樣（sailFill 那一份；?rigchk=1 每一格逐位元對拍）⇒ 畫出來一位元不差。tDraw／tKey／tJ／rigDirty 的副作用照舊。
 *  K（R2，SAILK.on）：位置抄進 SKP、三角形表／鄰接表／索引交給 sailKUp、法線 GPU 算（只有法線跟 R1 差浮點捨入）。 */
function sailBuf(ow) {
  var K = SAILK.on(), B = ow.sb, A = ow.T && ow.T.sailAtlas, mv = 0, np = 0, nv = 0, ni = 0, nt = 0, vm = 0, s0 = -1, i0 = -1, RG = [], KD = [], j;   // s0：從第幾面起靜的整段重填；i0：從第幾面起索引重填；RG：只重填靜的那幾段（頂點起點、個數）；R2：nt 三角形數、vm 一點最多幾個三角形共用、KD 面沒換只換了不畫哪幾點的那幾面
  if (!B) {
    B = ow.sb = { vao: gl.createVertexArray(), vbo: gl.createBuffer(), sbo: gl.createBuffer(), ebo: gl.createBuffer(), n: 0, nv: 0, L: [], SV: new Float32Array(0), IV: new Uint32Array(0), gs: 0, gi: 0, gd: 0 };
    gl.bindVertexArray(B.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, B.vbo); [[0, 0, 3], [1, 3, 3]].forEach(function (a) { gl.enableVertexAttribArray(a[0]); gl.vertexAttribPointer(a[0], a[2], gl.FLOAT, false, SB_DW * 4, a[1] * 4); });
    gl.bindBuffer(gl.ARRAY_BUFFER, B.sbo); [[2, 0, 3], [3, 3, 2], [4, 5, 4], [5, 9, 3]].forEach(function (a) { gl.enableVertexAttribArray(a[0]); gl.vertexAttribPointer(a[0], a[2], gl.FLOAT, false, SB_SW * 4, a[1] * 4); });
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, B.ebo); gl.bindVertexArray(null);
  }
  // 暫存區照這一艘現在要畫的配、不夠就加大三成（TASK-0669：以前開局時 30_rig_physics.js clothSetup 照最大那一型先配 ⇒ 物理檔碰畫的緩衝）
  (ow.cl || []).forEach(function (c) { mv += c.T.n; });
  if (ow.crew && PHYS && ow.shreds) ow.shreds.forEach(function (f) { mv += f.n; });
  if (K) { if (!SKP || SKP.length < Math.ceil(Math.max(1, mv) / SAILK.W) * SAILK.W * 3) SKP = new Float32Array(Math.ceil(Math.max(1, mv) * 1.33 / SAILK.W) * SAILK.W * 3); }   // 整列整列傳 ⇒ 配到整列
  else if (!SBD || SBD.length < mv * SB_DW) SBD = new Float32Array(Math.ceil(Math.max(1, mv) * 1.33) * SB_DW);
  var L = B.L, f = sailWalk(ow, put, K), td = f.td, tk = f.tk;
  L.length = np;                                                         // 後面沒了的那幾面（最後一面藏起來、最舊的布片拿掉）：不畫就好（畫 B.n 個索引）
  if (ow.crew) { ow.tDraw = td; if (tk !== (ow.tKey || '')) { ow.tKey = tk; ow.tJ = {}; td.forEach(function (d) { ow.tJ[d.t.j] = 1; }); ow.rigDirty = true; } }   // 換了哪幾條 ⇒ 下一格 buildRig 重做（不畫那幾條）
  var SV = B.SV, IV = B.IV, vcap = SV.length / SB_SW;
  if (B.gs !== SV.length) { gl.bindBuffer(gl.ARRAY_BUFFER, B.sbo); gl.bufferData(gl.ARRAY_BUFFER, SV, gl.STATIC_DRAW); B.gs = SV.length; }
  else if (s0 >= 0 || RG.length) {
    gl.bindBuffer(gl.ARRAY_BUFFER, B.sbo);
    for (j = 0; j < RG.length; j += 2) gl.bufferSubData(gl.ARRAY_BUFFER, RG[j] * SB_SW * 4, SV, RG[j] * SB_SW, RG[j + 1] * SB_SW);
    if (s0 >= 0 && nv > L[s0].vb) gl.bufferSubData(gl.ARRAY_BUFFER, L[s0].vb * SB_SW * 4, SV, L[s0].vb * SB_SW, (nv - L[s0].vb) * SB_SW);
  }
  if (K) sailKUp(B, nv, nt, vm, s0, KD, vcap);                         // R2：三角形表、鄰接表、索引變的那一段，位置傳上去，GPU 寫動的那份
  else {
    if (B.gi !== IV.length) { gl.bindVertexArray(B.vao); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, IV, gl.STATIC_DRAW); gl.bindVertexArray(null); B.gi = IV.length; }   // 索引是 VAO 的狀態 ⇒ 先綁自己的 VAO
    else if (i0 >= 0 && ni > L[i0].ib) { gl.bindVertexArray(B.vao); gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, L[i0].ib * 4, IV, L[i0].ib, ni - L[i0].ib); gl.bindVertexArray(null); }
    gl.bindBuffer(gl.ARRAY_BUFFER, B.vbo);
    if (B.gd !== vcap) { gl.bufferData(gl.ARRAY_BUFFER, vcap * SB_DW * 4, gl.DYNAMIC_DRAW); B.gd = vcap; }   // 跟靜的一樣大（加大才重配）
    if (nv) gl.bufferSubData(gl.ARRAY_BUFFER, 0, SBD, 0, nv * SB_DW);
  }
  B.n = K ? nt * 3 : ni; B.nv = nv;
  B.lb = vtxBox(B.lb, K ? SKP : SBD, K ? 3 : SB_DW, nv * (K ? 3 : SB_DW));   // 這一份的頂點外框（格座標；鏡頭外的船不畫，60_rbatch.js viewVis）：布、布片、旗、鬆掉的帆都在裡面
  if (RIG_CHK) {
    ow.sbChk = { d: K ? null : SBD.slice(0, nv * SB_DW), tk: tk };      // 對拍用：這一次傳上去的動的那一份（R2：GPU 寫的，rigChk 讀回來）
    var sc = rigStat(); sc.sbDyn = (sc.sbDyn || 0) + 1; if (s0 >= 0 || RG.length) sc.sbStat = (sc.sbStat || 0) + 1; if (K ? s0 >= 0 || KD.length : i0 >= 0) sc.sbIdx = (sc.sbIdx || 0) + 1;   // 重做幾次、其中靜的、索引傳了幾次
  }
  function put(o, T, p, n, tr, col, tv, vc, uv, r, bF, g0, rg, th) {
    var q = L[np] || (L[np] = { o: null }), base = nv, j, i, x;
    if (s0 < 0 && (q.o !== o || q.T !== T || q.n !== n)) s0 = np;      // 畫的帆換了 ⇒ 從這一面起頂點全挪了：靜的、索引整段重填
    var st = s0 >= 0, dc = st || !sailDropSame(q.d, tv, n);
    if (dc) { if (i0 < 0) i0 = np; q.d = tv ? sailDropCopy(q.d, tv, n) : null; if (K && !st) KD.push(np); }   // 撕開、收好那一捲少了幾點 ⇒ 從這一面起索引重填（頂點不動）；R2：只改這一面變了的那幾個三角形
    if (st || dc && SAIL_RAG_ON || q.r !== r || q.A !== A || q.bf !== bF || bF && sailBurnNew(B.SV, base, n, bF)) {   // 著火（燒到的時間、撲滅）、貼圖集、陣營換了、撕開（R3：離洞幾圈）⇒ 這一面的靜的重填
      if (B.SV.length < (base + n) * SB_SW) { x = new Float32Array(Math.ceil((base + n) * 1.33) * SB_SW); x.set(B.SV.subarray(0, base * SB_SW)); B.SV = x; }
      var Z = B.SV, H = SAIL_RAG_ON ? sailRagH(tr, n, th, rg, g0) : null;
      for (i = 0; i < n; i++) {
        var w = (base + i) * SB_SW, k = i * 3;
        if (vc) { Z[w] = vc[k]; Z[w + 1] = vc[k + 1]; Z[w + 2] = vc[k + 2]; } else { Z[w] = col[0]; Z[w + 1] = col[1]; Z[w + 2] = col[2]; }
        if (uv && r) { Z[w + 3] = (r[0] + uv[i * 2] * r[2]) / A.w; Z[w + 4] = (r[1] + uv[i * 2 + 1] * r[3]) / A.h; } else { Z[w + 3] = -1; Z[w + 4] = -1; }
        if (bF) { Z[w + 5] = bF.a[i]; Z[w + 6] = bF.x[i]; } else { Z[w + 5] = BURN_NEVER; Z[w + 6] = BURN_NEVER; }
        if (g0) { Z[w + 7] = (g0[k] + g0[k + 1]) * S; Z[w + 8] = g0[k + 2] * S; } else { Z[w + 7] = 0; Z[w + 8] = 0; }
        if (H) { Z[w + 9] = H[k]; Z[w + 10] = H[k + 1]; Z[w + 11] = H[k + 2]; } else { Z[w + 9] = SAIL_RAG_FAR; Z[w + 10] = 0; Z[w + 11] = 0; }
      }
      if (!st) { if (RG.length && RG[RG.length - 2] + RG[RG.length - 1] === base) RG[RG.length - 1] += n; else RG.push(base, n); }   // 挨著的併成一段
    }
    q.o = o; q.T = T; q.n = n; q.r = r; q.A = A; q.bf = bF; q.vb = base; q.ib = ni;
    if (K) {                                                             // R2：位置照抄（只讀 p）；法線不算（GPU）、索引不排（sailKUp）
      q.tr = tr; q.tb = nt; nt += tr.length / 3; x = sailAdj(tr, n).vm; if (x > vm) vm = x;
      SKP.set(p.length === n * 3 ? p : p.subarray(0, n * 3), base * 3);
      nv += n; np++; return;
    }
    var iw = i0 >= 0, N = SBN, D = SBD;
    if (iw && B.IV.length < ni + tr.length) { x = new Uint32Array(Math.ceil((ni + tr.length) * 1.33)); x.set(B.IV.subarray(0, ni)); B.IV = x; }
    var I = B.IV;
    N.fill(0, 0, n * 3);
    for (j = 0; j < tr.length; j += 3) {                                 // 法線：照舊跳過撕開的三角形、同樣的順序加（Float32 累加 ⇒ 順序一換就差一位元）
      if (tv && (tv[tr[j]] || tv[tr[j + 1]] || tv[tr[j + 2]])) continue;
      var a = tr[j] * 3, b = tr[j + 1] * 3, d = tr[j + 2] * 3;
      var ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[d] - p[a], vy = p[d + 1] - p[a + 1], vz = p[d + 2] - p[a + 2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      N[a] += nx; N[a + 1] += ny; N[a + 2] += nz; N[b] += nx; N[b + 1] += ny; N[b + 2] += nz; N[d] += nx; N[d + 1] += ny; N[d + 2] += nz;
      if (iw) { I[ni] = base + tr[j]; I[ni + 1] = base + tr[j + 1]; I[ni + 2] = base + tr[j + 2]; }
      ni += 3;
    }
    for (i = 0; i < n; i++) { var o6 = (base + i) * SB_DW, k3 = i * 3; D[o6] = p[k3]; D[o6 + 1] = p[k3 + 1]; D[o6 + 2] = p[k3 + 2]; D[o6 + 3] = N[k3]; D[o6 + 4] = N[k3 + 1]; D[o6 + 5] = N[k3 + 2]; }
    nv += n; np++;
  }
}
/** 不畫的細格點（tv：撕開的洞、收好那一捲少的；null ＝ 全畫）跟上一次記的 d 一樣。照 truthy 比（畫的時候也是照 truthy 跳）。 */
function sailDropSame(d, tv, n) {
  if (!d || !tv) return !d && !tv;
  for (var i = 0; i < n; i++) if (d[i] !== (tv[i] ? 1 : 0)) return false;
  return true;
}
function sailDropCopy(d, tv, n) {
  if (!d || d.length !== n) d = new Uint8Array(n);
  for (var i = 0; i < n; i++) d[i] = tv[i] ? 1 : 0;
  return d;
}
/** 著火（s.burn：起火、延燒、撲滅都改同一份的 a／x）跟靜的那一份（base 起 n 個頂點）記的不一樣 ⇒ true。都是 Float32 ⇒ 直接比。 */
function sailBurnNew(Z, base, n, bF) {
  for (var i = 0, w = base * SB_SW + 5; i < n; i++, w += SB_SW) if (Z[w] !== bF.a[i] || Z[w + 1] !== bF.x[i]) return true;
  return false;
}
/** 帆破洞的毛邊（render 管線大修 R3，TASK-0791；Tim「帆破洞邊緣可以一起做嗎(參考火燒 做出撕裂感)」「確保物理模擬維持原本的(只是顯示優化)」）：
 *  每一點三個數（三角形 tr、n 點；著色器 01_gl.js RAG_GLSL 內插後照雜訊決定吃多深、太近就 discard）——
 *    離洞幾圈：洞邊 ＝ 還畫、但所在的三角形有一點不畫（tv）的點 ⇒ 0；跟洞邊同一個還在的三角形 ⇒ 1；更遠 SAIL_RAG_FAR（著色器整段跳過）。
 *      rg（布片：整片是撕下來的）⇒ 外緣（只屬於一個三角形的邊）的點 0、其他 1 ÷ SAIL_RAG_SH（吃的深度只有洞邊的 SAIL_RAG_SH 倍：布片本來就小，吃一整圈會變一團黑）；
 *      沒有不在外緣的點（小布片）⇒ null（不套）。
 *    u、v：雜訊座標 ＝ g0（作品形狀／布片第一次畫到時的形狀）在這一面攤得最開的兩個軸上、除以平均邊長 ⇒ 以細格為單位
 *      （橫帆、縱帆都有兩個軸；細格大小不同的帆，毛邊大小跟著格走）。g0 沒有 ⇒ 0（沒有雜訊）。
 *  沒有洞、不是布片 ⇒ null（全部 SAIL_RAG_FAR）。只在撕開、畫的帆換了那一刻算（sailBuf 靜的那一份重填時）；只讀 tv、g0 與模板，⛔ 不寫模擬的狀態。 */
function sailRagH(tr, n, tv, rg, g0) {
  var h = null, j, k, a, b, c, e0;
  if (tv) {
    for (j = 0; j < tr.length; j += 3) {
      a = tr[j]; b = tr[j + 1]; c = tr[j + 2]; if (!(tv[a] || tv[b] || tv[c])) continue;
      if (!h) h = new Float32Array(n * 3).fill(SAIL_RAG_FAR);
      if (!tv[a]) h[a * 3] = 0; if (!tv[b]) h[b * 3] = 0; if (!tv[c]) h[c * 3] = 0;
    }
  } else if (rg) {
    var E = new Map();                                                   // 邊（小號 × n ＋ 大號）⇒ 幾個三角形用它
    for (j = 0; j < tr.length; j += 3) for (k = 0; k < 3; k++) { a = tr[j + k]; b = tr[j + (k + 1) % 3]; e0 = a < b ? a * n + b : b * n + a; E.set(e0, (E.get(e0) || 0) + 1); }
    E.forEach(function (m, e) { if (m !== 1) return; if (!h) h = new Float32Array(n * 3).fill(1 / SAIL_RAG_SH); h[Math.floor(e / n) * 3] = 0; h[(e % n) * 3] = 0; });   // 外緣 0、其他 1 ÷ SAIL_RAG_SH ⇒ 吃的深度只有洞邊的 SAIL_RAG_SH 倍
    for (j = 0, k = 0; h && j < n; j++) if (h[j * 3]) k++;
    if (!k) return null;                                                 // 每一點都在外緣（小布片多半這樣）⇒ 照點內插量不出「離邊多遠」（整片一樣遠 ⇒ 不是整片被吃光、就是整片變黑）⇒ 不套
  }
  if (!h) return null;
  if (tv) for (j = 0; j < tr.length; j += 3) {                           // 第二圈：跟洞邊同一個還在的三角形
    a = tr[j] * 3; b = tr[j + 1] * 3; c = tr[j + 2] * 3; if (tv[tr[j]] || tv[tr[j + 1]] || tv[tr[j + 2]]) continue;
    if (h[a] < 1 || h[b] < 1 || h[c] < 1) { if (h[a] > 1) h[a] = 1; if (h[b] > 1) h[b] = 1; if (h[c] > 1) h[c] = 1; }
  }
  if (!g0) { for (j = 0; j < n; j++) h[j * 3 + 1] = h[j * 3 + 2] = 0; return h; }
  var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], el = 0, ne = 0, i1 = 0, i2 = 1;
  for (j = 0; j < n; j++) for (k = 0; k < 3; k++) { var x = g0[j * 3 + k]; if (x < lo[k]) lo[k] = x; if (x > hi[k]) hi[k] = x; }
  var ex = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];                // 攤得最開的兩個軸（三個範圍裡最小的那個不要）
  if (ex[0] <= ex[1] && ex[0] <= ex[2]) { i1 = 1; i2 = 2; } else if (ex[1] <= ex[2]) { i1 = 0; i2 = 2; }
  for (j = 0; j < tr.length; j += 3) { a = tr[j] * 3; b = tr[j + 1] * 3; el += Math.hypot(g0[a] - g0[b], g0[a + 1] - g0[b + 1], g0[a + 2] - g0[b + 2]); ne++; }
  el = ne && el > 1e-6 ? ne / el : 0;                                    // 1 ÷ 平均邊長
  for (j = 0; j < n; j++) { h[j * 3 + 1] = g0[j * 3 + i1] * el; h[j * 3 + 2] = g0[j * 3 + i2] * el; }
  return h;
}
/** 布片的雜訊座標：第一次畫到時的形狀（細格座標，跟帆的 T.p0 同一種）⇒ 毛邊跟著布片飄、不會滑。記在畫的這一側（WeakMap），⛔ 不寫布片（模擬的狀態）。 */
function sailShredG0(f) {
  var g = SAIL_RAG_G0.get(f);
  if (!g) { g = Float32Array.from(f.p.subarray(0, f.n * 3)); SAIL_RAG_G0.set(f, g); }
  return g;
}
/** 跟帆身斷開的那幾塊（Tim 2026-10-21 截圖：一塊布浮在半空，四周都是洞 —— 「完全脫離部分應該要消失(中間都被打成透明了) 可以跟火燒一起處理」）：
 *  燒穿的洞、毛邊吃掉的布只在著色器裡不畫（物理上那塊布還連著：燒不斷約束、毛邊不讀物理）⇒ 被圍起來的那一塊照樣跟著帆動、看起來浮在空中。
 *  看得到的點 ＝ 不是物理的洞（tv）、沒燒穿（(min(現在, x) − a) ≥ 燒穿要的秒數 ⇒ 燒穿，跟 49_burn.js burnSail 的洞、著色器 bnB 不加雜訊的那一條同一把尺；
 *    著色器的時間就是 SIMT）、毛邊開著時不在洞邊上（洞邊那一點著色器多半吃掉）。
 *  物理上連在一起（模擬沒斷的約束 o.brk；沒有約束可讀 ⇒ 還在的三角形）的每一團裡，看得到的點照「兩點都看得到的邊」連成幾塊，留點數最多的那一塊，
 *  其他幾塊的點併進不畫的點（三角形照舊疊成一點）。物理上就斷開的（撕成兩半）各自是一團、各留各的。回不畫的點（tv 原樣，或 tv ∪ 斷開的那幾塊）。
 *  只在輸入換了才重算：tv 的內容、o.brk 這一份、s.burn 這一份、燒穿的點數（燒穿只會變多：撲滅停住、再點著接著燒、補帆換一份新的）⇒ 燒著的帆每次重做數一次燒穿幾點（O(n)，跟 burnSail 同一圈）。
 *  ⛔ 只是不畫：不寫布、不寫 s.burn、沒有 rnd；推力、血量照模擬（燒掉的面積照 49_burn.js）。 */
function sailIsland(o, n, tr, tv, bF) {
  if (!tv && !bF) return tv;
  var T = BURN.sailBurn, t = SIMT, nb = 0, i, j;
  if (bF) for (i = 0; i < n; i++) if (Math.min(t, bF.x[i]) - bF.a[i] >= T) nb++;
  var C = SAIL_ISL.get(o);
  if (C && C.bf === bF && C.br === o.brk && C.nb === nb && sailDropSame(C.d, tv, n)) return C.out;   // brk 只在撕開（跟 tv 一起）、clothInit（換一份）改
  var t0 = performance.now(), vis = new Uint8Array(n), pv = new Int32Array(n), pr = new Int32Array(n), a, b, c, out = tv, hide = 0;
  function fd(P, x) { while (P[x] !== x) { P[x] = P[P[x]]; x = P[x]; } return x; }
  function un(P, x, y) { x = fd(P, x); y = fd(P, y); if (x !== y) P[x] = y; }
  for (i = 0; i < n; i++) { pv[i] = i; vis[i] = !(tv && tv[i]) && !(bF && Math.min(t, bF.x[i]) - bF.a[i] >= T) ? 1 : 0; }
  if (tv && SAIL_RAG_ON) for (j = 0; j < tr.length; j += 3) { a = tr[j]; b = tr[j + 1]; c = tr[j + 2]; if (tv[a] || tv[b] || tv[c]) vis[a] = vis[b] = vis[c] = 0; }   // 洞邊（sailRagH 的 0）
  for (j = 0; j < tr.length; j += 3) {                                   // 看得到的連著：還在的三角形、兩點都看得到的邊
    a = tr[j]; b = tr[j + 1]; c = tr[j + 2]; if (tv && (tv[a] || tv[b] || tv[c])) continue;
    if (vis[a] && vis[b]) un(pv, a, b); if (vis[a] && vis[c]) un(pv, a, c); if (vis[b] && vis[c]) un(pv, b, c);
  }
  // 物理上連著：照模擬的約束（沒斷的邊 o.T.sim.ea／eb、o.brk；細格照權重最重的那一個粒子 o.T.mi 對過去）—— 撕開時兩個洞中間夾著的那一條布，
  //   點都在洞邊上、三角形都不畫，約束卻還沒斷 ⇒ 還掛在帆身上。沒有約束可讀（模板沒有 sim、布沒有 brk）⇒ 照還在的三角形連。
  var S = o.T && o.T.sim, br = o.brk, mi = o.T && o.T.mi;
  if (S && S.ea && br && mi) {
    var pc = new Int32Array(S.n); for (i = 0; i < S.n; i++) pc[i] = i;
    for (j = 0; j < S.ea.length; j++) if (!br[j]) un(pc, S.ea[j], S.eb[j]);
    for (i = 0; i < n; i++) pr[i] = fd(pc, mi[i * 4]);
  } else {
    for (i = 0; i < n; i++) pr[i] = i;
    for (j = 0; j < tr.length; j += 3) { a = tr[j]; b = tr[j + 1]; c = tr[j + 2]; if (tv && (tv[a] || tv[b] || tv[c])) continue; un(pr, a, b); un(pr, a, c); }
    for (i = 0; i < n; i++) pr[i] = fd(pr, i);
  }
  var sz = new Int32Array(n), best = new Int32Array(Math.max(n, S ? S.n : 0)).fill(-1), bs = new Int32Array(best.length);   // best／bs 照物理的那一團（粒子或細格的編號）
  for (i = 0; i < n; i++) if (vis[i]) sz[fd(pv, i)]++;
  for (i = 0; i < n; i++) if (vis[i]) { var r = fd(pv, i), q = pr[i]; if (sz[r] > bs[q]) { bs[q] = sz[r]; best[q] = r; } }
  for (i = 0; i < n; i++) if (vis[i] && fd(pv, i) !== best[pr[i]]) { if (out === tv) out = tv ? Uint8Array.from(tv) : new Uint8Array(n); out[i] = 1; hide++; }
  SAIL_ISL.set(o, { bf: bF, br: o.brk, nb: nb, d: tv ? sailDropCopy(null, tv, n) : null, out: out });
  if (DEBUG) { var st = rigStat(); st.islRuns = (st.islRuns || 0) + 1; st.islMs = (st.islMs || 0) + performance.now() - t0; st.islHide = (st.islHide || 0) + hide; if (hide) st.islFaces = (st.islFaces || 0) + 1; }   // 量：算了幾次、共幾毫秒、藏了幾點
  return out;
}
// ── 帆的第二層（render 管線大修 R2）：骨架的概念 —— 物理的粒子是骨頭、細格點照固定的權重跟著（現在權重全是 1：30_rig_physics.js contact-fine，粒子就是細格點）。
//   每一步 CPU 只傳位置（SKP → 貼圖 0 號，RGB32F，一個 owner 一張、一點一格，每列 SAILK.W 點）；GPU 一次 transform feedback（P.sailK）每一點：
//   位置照抄、法線 ＝ 它所在的每個三角形（鄰接表，跟 CPU 一樣照三角形順序）還在的那幾個的面法線加起來 ⇒ 寫進 ow.sb.vbo（跟 R1 一樣 6 個 float）⇒ P.sail／P.dsail 照舊用索引畫。
//   三角形表（貼圖 1 號，RGBA32UI：三點、還在不在）、鄰接表（貼圖 2 號，R32UI：每點 vs 格三角形編號，空的 ＝ 0xFFFFFFFF）、索引：畫的帆換了才從那一面起重寫；
//   撕開、收好那一捲少了幾點 ⇒ 只改變了的那幾個三角形（不在的索引三點疊成一點 ⇒ 面積 0、不出像素；跟 R1 拿掉那個三角形畫出來一樣）。
//   位置跟 R1 一位元不差（抄的、陰影也一樣）；法線是 GPU 的 float32（R1 是 JS 的 float64 再存 float32）⇒ 打光差一點捨入。
//   沒有 transform feedback／整數貼圖／貼圖單元不夠（編不過 ⇒ P.sailK ＝ null）或 ?sailk=0 ⇒ 照 R1。⛔ 只讀 c.p、c.tv、模板：不寫模擬的狀態。
var SAILK_OFF = Q.get('sailk') === '0', SKP = null;
var SAILK = {
  W: 1024, U: [15, 16, 17], tf: null, vao: null, adj: new WeakMap(), idf: new WeakMap(), rb: null,   // U：位置、三角形表、鄰接表綁的貼圖單元（其他程式用到 14 為止）；adj／idf：模板的鄰接表、細格是不是就是粒子（只算一次）
  on: function () { return !!P.sailK && !SAILK_OFF; },
  /** 編 transform feedback 的程式（varyings 要在 link 之前給 ⇒ 不能用 VK.compile）；取樣器固定 U。 */
  compile: function (vs, fs, out) {
    if (gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) <= SAILK.U[2] || gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) < 3) throw new Error('貼圖單元不夠');
    function sh(t, src) { var s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    var p = gl.createProgram(), u = {}, n, i;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.transformFeedbackVaryings(p, out, gl.INTERLEAVED_ATTRIBS); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (i = 0; i < n; i++) { var a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
    gl.useProgram(p); gl.uniform1i(u.uKP, SAILK.U[0]); gl.uniform1i(u.uKT, SAILK.U[1]); gl.uniform1i(u.uKA, SAILK.U[2]); gl.useProgram(null);
    return { prog: p, u: u };
  },
  /** GPU 算這個 owner 的 nv 點（位置、法線）寫進 B.vbo。只在 prepRig 裡（所有趟之前）；用完 GL 狀態還原（不綁 TF、不丟光柵、VAO null）。 */
  run: function (B, nv) {
    var p = P.sailK, k = B.k, U = SAILK.U, j;
    if (!SAILK.tf) { SAILK.tf = gl.createTransformFeedback(); SAILK.vao = gl.createVertexArray(); }   // 沒有頂點屬性（全從貼圖拿，gl_VertexID）
    gl.useProgram(p.prog); gl.uniform1ui(p.u.uKV, k.vs);
    for (j = 0; j < 3; j++) { gl.activeTexture(gl.TEXTURE0 + U[j]); gl.bindTexture(gl.TEXTURE_2D, k.tex[j]); }
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.RASTERIZER_DISCARD); gl.bindVertexArray(SAILK.vao); gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, SAILK.tf);
    gl.bindBufferRange(gl.TRANSFORM_FEEDBACK_BUFFER, 0, B.vbo, 0, nv * SB_DW * 4);   // ⛔ B.vbo 這時不能綁在別處（ARRAY_BUFFER、正綁著的 VAO）⇒ sailKUp 配完就解開
    gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS, 0, nv); gl.endTransformFeedback();
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null); gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);   // 解開 ⇒ 畫帆時 B.vbo 只是 VAO 的頂點
    gl.bindVertexArray(null); gl.disable(gl.RASTERIZER_DISCARD);
  }
};
// 每一點：位置照抄；法線 ＝ 鄰接表裡還在的三角形的 (b−a)×(c−a) 照順序加（＝ sailBuf R1 的 N，只是 float32）。kAt：一列 1024 點（SAILK.W）。
var SAILK_VS = '#version 300 es\nuniform highp sampler2D uKP; uniform highp usampler2D uKT; uniform highp usampler2D uKA; uniform uint uKV; out vec3 kP; out vec3 kN;\n' +
  'ivec2 kAt(uint i){ return ivec2(int(i&1023u),int(i>>10u)); }\n' +
  'vec3 kPos(uint i){ return texelFetch(uKP,kAt(i),0).xyz; }\n' +
  'void main(){ uint v=uint(gl_VertexID), e=v*uKV; vec3 n=vec3(0.0);\n' +
  ' for(uint s=0u;s<uKV;s++){ uint t=texelFetch(uKA,kAt(e+s),0).r; if(t==0xFFFFFFFFu) break; uvec4 T=texelFetch(uKT,kAt(t),0); if(T.w==0u) continue;\n' +
  '  vec3 a=kPos(T.x), u=kPos(T.y)-a, w=kPos(T.z)-a; n+=vec3(u.y*w.z-u.z*w.y,u.z*w.x-u.x*w.z,u.x*w.y-u.y*w.x); }\n' +
  ' kP=kPos(v); kN=n; gl_Position=vec4(0.0,0.0,0.0,1.0); }\n';
var SAILK_FS = '#version 300 es\nprecision highp float; out vec4 o; void main(){ o=vec4(0.0); }\n';
/** 模板的細格就是物理的粒子（每點只靠自己、權重 1；粒子數 ＝ 細格數）⇒ 位置直接拿 c.p（clothFine 抄出來一樣）。 */
function sailIdent(T) {
  var r = SAILK.idf.get(T); if (r !== undefined) return r;
  var mi = T.mi, mw = T.mw, i; r = !!(mi && mw && T.sim && T.sim.n === T.n);
  for (i = 0; r && i < T.n; i++) if (mi[i * 4] !== i || mw[i * 4] !== 1 || mw[i * 4 + 1]) r = false;
  SAILK.idf.set(T, r); return r;
}
/** 模板（三角形 tr、n 點）的鄰接表：每點所在的三角形（照三角形順序；一個三角形同一點出現兩次就記兩次 ＝ CPU 加兩次）。{ vm：一點最多幾個、c：每點幾個、l：每點 vm 格 }。 */
function sailAdj(tr, n) {
  var a = SAILK.adj.get(tr); if (a) return a;
  var c = new Uint16Array(n), vm = 1, i, t;
  for (i = 0; i < tr.length; i++) if (++c[tr[i]] > vm) vm = c[tr[i]];
  var l = new Uint32Array(n * vm); c.fill(0);
  for (t = 0; t < tr.length; t++) { i = tr[t]; l[i * vm + c[i]++] = (t / 3) | 0; }
  a = { vm: vm, c: c, l: l }; SAILK.adj.set(tr, a); return a;
}
/** R2 每一次重做：畫的帆換了（s0）⇒ 從那一面起三角形表與索引重寫（鄰接表每點格數變多 ⇒ 整份）；KD 那幾面只改變了的三角形；位置傳上去；GPU 寫動的那份。
 *  CPU 留一份（三角形表 TV、鄰接表 AV、索引 B.IV）⇒ 只傳變的那幾列。貼圖照列配（加大三成）、不夠才重配（整份傳）。 */
function sailKUp(B, nv, nt, vm, s0, KD, vcap) {
  var k = B.k, L = B.L, W = SAILK.W, a0 = s0, R = [Infinity, -1], j, r, x;
  if (!k && !nv) return;                                                 // 還沒畫過帆（斷開的那一團多半沒帶帆）⇒ 不配貼圖
  if (!k) k = B.k = { tex: [gl.createTexture(), gl.createTexture(), gl.createTexture()], rows: [0, 0, 0], TV: new Uint32Array(0), AV: new Uint32Array(0), vs: 0 };
  if (vm > k.vs) { k.vs = vm; a0 = 0; }
  var vs = k.vs, TV = k.TV, AV = k.AV, IV = B.IV;
  if (TV.length < nt * 4) { x = new Uint32Array(Math.ceil(nt * 1.33 / W) * W * 4); x.set(TV); TV = k.TV = x; }
  if (AV.length < nv * vs) { x = new Uint32Array(Math.ceil(nv * vs * 1.33 / W) * W); x.set(AV); AV = k.AV = x; }
  if (IV.length < nt * 3) { x = new Uint32Array(Math.ceil(nt * 1.33) * 3); x.set(IV); IV = B.IV = x; }
  if (s0 >= 0) for (j = s0; j < L.length; j++) sailKTri(L[j], TV, IV);
  if (a0 >= 0) for (j = a0; j < L.length; j++) sailKAdj(L[j], AV, vs);
  for (j = 0; j < KD.length; j++) sailKLive(L[KD[j]], TV, IV, R);
  r = TV.length / 4 / W;
  if (k.rows[1] !== r) { sailKTex(k, 1, gl.RGBA32UI, gl.RGBA_INTEGER, gl.UNSIGNED_INT, r, TV); }
  else { if (s0 >= 0) sailKSub(k, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, 4, TV, L[s0].tb, nt); if (R[1] >= 0) sailKSub(k, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, 4, TV, R[0], R[1] + 1); }
  r = AV.length / W;
  if (k.rows[2] !== r) sailKTex(k, 2, gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT, r, AV);
  else if (a0 >= 0) sailKSub(k, 2, gl.RED_INTEGER, gl.UNSIGNED_INT, 1, AV, L[a0].vb * vs, nv * vs);
  if (B.gi !== IV.length) { gl.bindVertexArray(B.vao); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, IV, gl.STATIC_DRAW); gl.bindVertexArray(null); B.gi = IV.length; }   // 索引是 VAO 的狀態 ⇒ 先綁自己的 VAO
  else if (s0 >= 0 || R[1] >= 0) {
    gl.bindVertexArray(B.vao);
    if (s0 >= 0 && nt > L[s0].tb) gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, L[s0].tb * 12, IV, L[s0].tb * 3, (nt - L[s0].tb) * 3);
    if (R[1] >= 0) gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, R[0] * 12, IV, R[0] * 3, (R[1] + 1 - R[0]) * 3);
    gl.bindVertexArray(null);
  }
  r = Math.ceil(vcap / W);
  if (k.rows[0] !== r) sailKTex(k, 0, gl.RGB32F, gl.RGB, gl.FLOAT, r, null);
  if (nv) {                                                              // 位置：整列一次、最後不滿的那一列另一次（只傳 nv 點）
    var full = Math.floor(nv / W), rest = nv - full * W;
    gl.activeTexture(gl.TEXTURE0 + SAILK.U[0]); gl.bindTexture(gl.TEXTURE_2D, k.tex[0]);
    if (full) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, full, gl.RGB, gl.FLOAT, SKP, 0);
    if (rest) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, full, rest, 1, gl.RGB, gl.FLOAT, SKP, full * W * 3);
    gl.activeTexture(gl.TEXTURE0);
  }
  if (B.gd !== vcap) { gl.bindBuffer(gl.ARRAY_BUFFER, B.vbo); gl.bufferData(gl.ARRAY_BUFFER, vcap * SB_DW * 4, gl.DYNAMIC_COPY); gl.bindBuffer(gl.ARRAY_BUFFER, null); B.gd = vcap; }
  if (nv) SAILK.run(B, nv);
}
/** 一面（sailBuf 的 L[j]：vb 頂點起點、tb 三角形起點、tr、d 不畫的點）的三角形表與索引整段重寫。 */
function sailKTri(q, TV, IV) {
  var tr = q.tr, d = q.d, b = q.vb, w = q.tb, t;
  for (t = 0; t < tr.length; t += 3, w++) {
    var a = b + tr[t], e = b + tr[t + 1], c = b + tr[t + 2], on = !(d && (d[tr[t]] || d[tr[t + 1]] || d[tr[t + 2]]));
    TV[w * 4] = a; TV[w * 4 + 1] = e; TV[w * 4 + 2] = c; TV[w * 4 + 3] = on ? 1 : 0;
    IV[w * 3] = a; IV[w * 3 + 1] = on ? e : a; IV[w * 3 + 2] = on ? c : a;   // 不在 ⇒ 三點疊成一點
  }
}
/** 一面不畫的點換了（面沒換）：只改「還在」變了的三角形；R ＝ 變了的三角形編號範圍（累計）。 */
function sailKLive(q, TV, IV, R) {
  var tr = q.tr, d = q.d, b = q.vb, w = q.tb, t;
  for (t = 0; t < tr.length; t += 3, w++) {
    var on = d && (d[tr[t]] || d[tr[t + 1]] || d[tr[t + 2]]) ? 0 : 1;
    if (TV[w * 4 + 3] === on) continue;
    TV[w * 4 + 3] = on; IV[w * 3 + 1] = on ? b + tr[t + 1] : b + tr[t]; IV[w * 3 + 2] = on ? b + tr[t + 2] : b + tr[t];
    if (w < R[0]) R[0] = w; if (w > R[1]) R[1] = w;
  }
}
/** 一面的鄰接表（每點 vs 格：它所在的三角形的編號，照順序；空的 0xFFFFFFFF）。 */
function sailKAdj(q, AV, vs) {
  var a = sailAdj(q.tr, q.n), b = q.vb, i, s;
  for (i = 0; i < q.n; i++) for (s = 0; s < vs; s++) AV[(b + i) * vs + s] = s < a.c[i] ? q.tb + a.l[i * a.vm + s] : 0xFFFFFFFF;
}
/** 第 j 張貼圖重配 rows 列（data：整份；null ＝ 只配）。整數、浮點貼圖都要 NEAREST（不然不完整、texelFetch 讀到 0）。 */
function sailKTex(k, j, ifmt, fmt, type, rows, data) {
  gl.activeTexture(gl.TEXTURE0 + SAILK.U[j]); gl.bindTexture(gl.TEXTURE_2D, k.tex[j]);
  gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, SAILK.W, rows, 0, fmt, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.activeTexture(gl.TEXTURE0); k.rows[j] = rows;
}
/** 第 j 張貼圖傳 [e0, e1) 那幾格所在的整列（cp：一格幾個數）。 */
function sailKSub(k, j, fmt, type, cp, data, e0, e1) {
  var W = SAILK.W, r0 = Math.floor(e0 / W), r1 = Math.ceil(e1 / W); if (r1 <= r0) return;
  gl.activeTexture(gl.TEXTURE0 + SAILK.U[j]); gl.bindTexture(gl.TEXTURE_2D, k.tex[j]);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r0, W, r1 - r0, fmt, type, data, r0 * W * cp);
  gl.activeTexture(gl.TEXTURE0);
}
/** 細格的位置：照權重從物理的粗格內插（粗格就是細格 ⇒ 原樣）。 */
/** 垂下來的繩（物理開著才有）：模擬走過才重做（60_render.js prepRig）。暫存區 LBV 不夠就加大三成（以前每一格一份新的陣列）；
 *  照舊是 float64 算完才寫進 Float32Array（＝ 以前 new Float32Array(L) 的那一次轉換）⇒ 傳上去的位元組一樣。
 *  GPU 那份配到 LBV 那麼大、之後 bufferSubData（不夠才重配；R1）。 */
var LBV = null;
/** 填 LBV（td：跟著帆腳畫的繩，sailWalk 的）⇒ 填了幾個 float。 */
function looseFill(sh, td) {
  var need = 0, n = 0, j, k;
  for (j = 0; j < sh.loose.length; j++) need += Math.max(0, sh.loose[j].n - 1) * 12;
  for (j = 0; j < td.length; j++) need += Math.max(0, Math.ceil(sh.ropes[td[j].t.j].pts.length / 3) - 1) * 12;
  if (!LBV || LBV.length < need) LBV = new Float32Array(Math.ceil(Math.max(1, need) * 1.33));
  var L = LBV;
  for (j = 0; j < sh.loose.length; j++) {
    var o = sh.loose[j], p = o.p, c = o.col;
    for (var i = 0; i + 1 < o.n; i++) { var a = i * 3; L[n++] = p[a]; L[n++] = p[a + 1]; L[n++] = p[a + 2]; L[n++] = c[0]; L[n++] = c[1]; L[n++] = c[2]; L[n++] = p[a + 3]; L[n++] = p[a + 4]; L[n++] = p[a + 5]; L[n++] = c[0]; L[n++] = c[1]; L[n++] = c[2]; }
  }
  for (j = 0; j < td.length; j++) {                                     // 跟著帆腳走的 sheet、tack（sailBuf 記的畫出來的帆腳）：靠帆腳那一端移到帆腳、另一端不動、中間照弧長內插
    var d = td[j], t = d.t, r = sh.ropes[t.j], q = r.pts, cc = r.col, e = t.ce * 3, mx = d.x - q[e], my = d.y - q[e + 1], mz = d.z - q[e + 2], m = q.length / 3, px = 0, py = 0, pz = 0;
    for (k = 0; k < m; k++) {
      var w = t.t[k], x = q[k * 3] + mx * w, y = q[k * 3 + 1] + my * w, z = q[k * 3 + 2] + mz * w;
      if (k) { L[n++] = px; L[n++] = py; L[n++] = pz; L[n++] = cc[0]; L[n++] = cc[1]; L[n++] = cc[2]; L[n++] = x; L[n++] = y; L[n++] = z; L[n++] = cc[0]; L[n++] = cc[1]; L[n++] = cc[2]; }
      px = x; py = y; pz = z;
    }
  }
  return n;
}
function looseBuf(sh) {
  var n = looseFill(sh, sh.tDraw || []), o = sh.ll;
  if (!o) {
    o = sh.ll = { vao: gl.createVertexArray(), vbo: gl.createBuffer(), n: 0, cap: 0 }; gl.bindVertexArray(o.vao); gl.bindBuffer(gl.ARRAY_BUFFER, o.vbo);
    [[0, 3, 0], [2, 3, 3]].forEach(function (a) { gl.enableVertexAttribArray(a[0]); gl.vertexAttribPointer(a[0], a[1], gl.FLOAT, false, 6 * 4, a[2] * 4); }); gl.bindVertexArray(null);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, o.vbo);
  if (o.cap < n) { o.cap = LBV.length; gl.bufferData(gl.ARRAY_BUFFER, o.cap * 4, gl.DYNAMIC_DRAW); }
  if (n) gl.bufferSubData(gl.ARRAY_BUFFER, 0, LBV, 0, n);
  o.n = n / 6; o.lb = vtxBox(o.lb, LBV, 6, n);
  if (RIG_CHK) sh.llChk = LBV.slice(0, n);
}
// 帆與垂繩的緩衝什麼時候重做（60_render.js prepRig）：物理開著的船，照模擬每走一步重做；這一格沒走模擬（暫停、慢動作、高更新率的空格、__game.cam／cut 這種只畫一格的）
//   ⇒ 輸入一個都沒變 ⇒ 上一份照用。輸入 ＝ 布、布片、垂繩、燒到的時間（都只在模擬那一步改，或改的地方設 rigDirty：setPhys、收帆張帆、降旗、帆匠、著火、57_core）。
//   rigSame 再多比一串（不只 SIMT）：物理開關、貼圖集、船殼格數（收好那一捲靠的格）、每面帆的狀態與陣列換過沒 ⇒ 除錯工具在模擬外改了也照樣重做。
//   ?rigchk=1（DEBUG）：每一格照以前整份重填的那一份（sailFill、looseFill）再填一次、跟 GPU 上那一份逐位元比（沒重做的那一格驗 rigSame、重做的那一格驗動靜分開只傳變的那一段），
//   不一樣 ⇒ __rbat.stat.rigMiss ＋1（rigChk 對拍的次數；sbDyn／sbStat／sbIdx：帆重做幾次、其中靜的、索引傳了幾次）。
var RIG_CHK = DEBUG && Q.get('rigchk') === '1', RK = null, RK_N = 0, RK_SAME = true;
function rkPut(v) { if (RK[RK_N] !== v) { RK[RK_N] = v; RK_SAME = false; } RK_N++; }
/** 這一格帆與垂繩的輸入跟上一次重做時一樣 ⇒ true；不一樣 ⇒ 記下這一格的（ow.sbK）、回 false。只在物理開著的船上叫（每一格都叫，才記得住重做那一刻的）。 */
function rigSame(ow) {
  RK = ow.sbK || (ow.sbK = []); RK_N = 0; RK_SAME = true;
  rkPut(SIMT); rkPut(PHYS); rkPut(ow.T && ow.T.sailAtlas); rkPut(ow.grid && ow.grid.count); rkPut(ow.cl); rkPut(ow.sails);
  rkPut(ow.shreds); rkPut(ow.shreds && ow.shreds.length); rkPut(ow.loose); rkPut(ow.loose && ow.loose.length); rkPut(ow.tCut);
  var C = ow.cl || [], S = ow.sails || [];
  for (var k = 0; k < C.length; k++) {
    var c = C[k], s = S[k];
    rkPut(c); rkPut(c.p); rkPut(c.hidden); rkPut(c.gone); rkPut(c.loose); rkPut(c.fz); rkPut(c.furlF); rkPut(c.torn); rkPut(c.tv); rkPut(c.tt);
    rkPut(s); rkPut(s && s.furled); rkPut(s && s.dead); rkPut(s && s.burn);
  }
  if (RK.length !== RK_N) { RK.length = RK_N; RK_SAME = false; }
  return RK_SAME && !!ow.sb;
}
function rigStat() { var R = window.__rbat || (window.__rbat = {}); return R.stat || (R.stat = {}); }
/** 兩份 float／int 陣列的前 n 個逐位元一樣（b 剛好 n 個）。 */
function rigEq(a, b, n) {
  if (b.length !== n) return false;
  var A = new Uint32Array(a.buffer, a.byteOffset, n), B = new Uint32Array(b.buffer, b.byteOffset, n);
  for (var i = 0; i < n; i++) if (A[i] !== B[i]) return false;
  return true;
}
/** ?rigchk=1：照現在的狀態用以前整份重填的那一份再填一次（不傳、不改 tDraw／tKey／rigDirty），跟 GPU 上那一份比（帆：動的 ＝ 上一次傳的、靜的與索引 ＝ CPU 那一份）。
 *  live：物理開著的船 ⇒ 垂繩也比。 */
function rigChk(ow, live) {
  var K = ow.sbChk, st = rigStat(), bad = !K || !ow.sb || live && !ow.llChk;
  if (!bad) {
    var f = sailFill(ow);
    bad = f.tk !== K.tk || !(SAILK.on() ? sailEqK(ow.sb, st) : sailEq(ow.sb, K.d));
    if (!bad && live) { var nl = looseFill(ow, f.td); bad = !rigEq(LBV, ow.llChk, nl); }   // 先填（填的時候 LBV 可能換一份大的）才拿 LBV
  }
  st.rigChk = (st.rigChk || 0) + 1; st.rigMiss = (st.rigMiss || 0) + (bad ? 1 : 0);
}
/** 帆：GPU 上那一份（動的 D、靜的 B.SV、索引 B.IV）跟 sailFill 剛填好的（SBV、SBI）逐位元一樣。 */
function sailEq(B, D) {
  var nv = SB_NV, ni = SB_NI, v, k;
  if (B.nv !== nv || B.n !== ni || D.length !== nv * SB_DW || !rigEq(SBI, B.IV.subarray(0, ni), ni)) return false;
  var X = new Uint32Array(SBV.buffer, 0, nv * SB_STRIDE), Y = new Uint32Array(D.buffer, D.byteOffset, nv * SB_DW), Z = new Uint32Array(B.SV.buffer, 0, nv * SB_SW);
  for (v = 0; v < nv; v++) {
    for (k = 0; k < SB_DW; k++) if (X[v * SB_STRIDE + k] !== Y[v * SB_DW + k]) return false;
    for (k = 0; k < SB_SW; k++) if (X[v * SB_STRIDE + SB_DW + k] !== Z[v * SB_SW + k]) return false;
  }
  return true;
}
/** R2 對拍（sailFill 剛填好的 SBV／SBI）：索引拿掉三點疊成一點的那幾個 ＝ SBI；靜的逐位元；動的從 GPU 讀回來（同步讀，只有 ?rigchk=1）——
 *  位置要相等（c.p 的 −0 抄過來還是 −0、clothFine 會變 +0 ⇒ 照數值比）；法線照角度記（st.nrmN 比了幾點、nrmMax 最大幾度、nrmBig 超過 NRM_BIG 度的點數；兩邊都 0 ⇒ 不算）。 */
var NRM_BIG = 1;
function sailEqK(B, st) {
  var nv = SB_NV, ni = SB_NI, I = B.IV, k = 0, t, v, c;
  if (B.nv !== nv) return false;
  for (t = 0; t < B.n; t += 3) {
    if (I[t] === I[t + 1] && I[t] === I[t + 2]) continue;
    if (k >= ni || I[t] !== SBI[k] || I[t + 1] !== SBI[k + 1] || I[t + 2] !== SBI[k + 2]) return false;
    k += 3;
  }
  if (k !== ni) return false;
  var X = new Uint32Array(SBV.buffer, 0, nv * SB_STRIDE), Z = new Uint32Array(B.SV.buffer, 0, nv * SB_SW);
  for (v = 0; v < nv; v++) for (c = 0; c < SB_SW; c++) if (X[v * SB_STRIDE + SB_DW + c] !== Z[v * SB_SW + c]) return false;
  if (!nv) return true;
  var D = SAILK.rb && SAILK.rb.length >= nv * SB_DW ? SAILK.rb : (SAILK.rb = new Float32Array(Math.max(1, nv) * SB_DW)), mx = st.nrmMax || 0, big = 0;
  gl.bindBuffer(gl.COPY_READ_BUFFER, B.vbo); gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, D, 0, nv * SB_DW); gl.bindBuffer(gl.COPY_READ_BUFFER, null);
  for (v = 0; v < nv; v++) {
    var o = v * SB_STRIDE, d = v * SB_DW;
    if (SBV[o] !== D[d] || SBV[o + 1] !== D[d + 1] || SBV[o + 2] !== D[d + 2]) return false;
    var ax = SBV[o + 3], ay = SBV[o + 4], az = SBV[o + 5], bx = D[d + 3], by = D[d + 4], bz = D[d + 5], la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
    if (!la && !lb) continue;
    var g = la && lb ? Math.acos(Math.min(1, Math.max(-1, (ax * bx + ay * by + az * bz) / (la * lb)))) * 180 / Math.PI : 180;
    st.nrmN = (st.nrmN || 0) + 1; if (g > mx) mx = g; if (g > NRM_BIG) big++;
  }
  st.nrmMax = mx; st.nrmBig = (st.nrmBig || 0) + big;
  return true;
}
function upload(o, data, stride, attrs) {
  if (!o) { o = { vao: gl.createVertexArray(), vbo: gl.createBuffer(), n: 0 }; gl.bindVertexArray(o.vao); gl.bindBuffer(gl.ARRAY_BUFFER, o.vbo);
    attrs.forEach(function (a) { gl.enableVertexAttribArray(a[0]); gl.vertexAttribPointer(a[0], a[1], gl.FLOAT, false, stride * 4, a[2] * 4); }); gl.bindVertexArray(null); }
  gl.bindBuffer(gl.ARRAY_BUFFER, o.vbo); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW); o.n = data.length / stride;
  o.lb = vtxBox(o.lb, data, stride, data.length);                         // 頂點外框（第 0 號屬性 ＝ 位置；繩、鐵鍊、旗桿這些 ⇒ 鏡頭外的船不畫，60_rbatch.js viewVis）
  return o;
}
/** 頂點的外框：每 st 個 float 一個頂點、前 3 個是位置，只看前 len 個 float ⇒ lb（[x0, y0, z0, x1, y1, z1]，double；沒給就建）；沒有頂點 ⇒ lb[0] ＝ Infinity。 */
function vtxBox(lb, A, st, len) {
  var x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity, v;
  for (var i = 0; i + 2 < len; i += st) {
    v = A[i]; if (v < x0) x0 = v; if (v > x1) x1 = v;
    v = A[i + 1]; if (v < y0) y0 = v; if (v > y1) y1 = v;
    v = A[i + 2]; if (v < z0) z0 = v; if (v > z1) z1 = v;
  }
  lb = lb || new Float64Array(6);
  lb[0] = x0; lb[1] = y0; lb[2] = z0; lb[3] = x1; lb[4] = y1; lb[5] = z1;
  return lb;
}

