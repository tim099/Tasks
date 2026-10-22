// ───────────────────────── 一格要畫的模型表（RBAT；render 管線大修 S2）─────────────────────────
// 模型那一段（drawModels：船的模型 → 裝飾 → 平滑面 → 裝甲的平滑面，斷開的那一團的模型，飛出去的模型）一格只整理一次（rbatPrep：frameBegin 裡、prepRig 之後），
//   陰影的每一段、反射、主畫面都照這一張表重播（rbatReplay）⇒ GL 的呼叫跟以前每一趟自己走一遍逐一相同（同樣的判斷、順序、uniform 的值）。
// 一格一張表（rbatPrep）：世界矩陣照以前同一條算式、同一個捨入點（⛔ 不合併乘法、不跨格留：d.L、m.vsl、ancD 原地改，renderLerp 每格換 sh.M，remesh 換 smR）。
//   以前的 modelWorld（WeakMap，每個模型每格一個快取物件、一個閉包）拿掉；斷開的那一團的模型以前每一趟各乘一次，現在一格一次。
// 畫的東西（owner）：0..ns-1 ＝ SHIPS（沉了 sink > 40 的沒有項目）、ns..n-1 ＝ PIECES；cs ＝ 陰影第 k 段畫不畫（第 k 位，60_render.js csmIn 填）。
// 項目（item）照以前畫的順序排；FLY（飛出去的模型）沒有 owner，排在最後（i0[n] 起）。陣列不夠才加倍、之後一直重用（艦隊實驗室最多 FLEET_MAX 艘、斷開的那一團沒有上限）。
// ⛔ 只讀模擬的狀態：表、矩陣都是 RBAT 自己的陣列；meshGpu（家具第一次畫到才上傳）照以前只給要畫的。
// 一次畫多個（instanced；S4 起）：網址的開關（RBAT_ON／RBAT_INST／RBAT_GEO／RBAT_TAU）、uMs 的矩陣 RBAT.pal、能不能用的對拍 __rbatProbe（檔尾）；程式在 01_gl.js（P.triI／P.dtriI）。
var RBAT = {
  f: -1,                                                             // 這張表是第幾次 render()（RFR）
  n: 0, ns: 0, own: [], nPrev: 0,                                    // owner：船、再斷開的那一團
  i0: new Int32Array(17),                                            // 第 o 個的項目 ＝ [i0[o], i0[o + 1])；i0[n] 起是 FLY
  cs: new Uint8Array(16),                                            // 陰影：第 k 段畫不畫（第 k 位；rbatPrep 清、csmIn 填）
  cst: new Uint8Array(16), cp: new Float64Array(48), cR: new Float64Array(16),   // 陰影的外接球（60_render.js csmOwners）：0 不畫（沉了）／1 一定畫（斷開的那一團沒有中心）／2 照球判；中心、半徑
  ni: 0, cap: 0, niPrev: 0,
  cls: null,                                                         // 0 模型、1 裝飾、2 平滑面（一區）、3 裝甲的平滑面（一區）、4 斷開的那一團的模型、5 飛出去的模型
  ow: null, slot: null,                                              // 哪一個 owner（FLY ＝ −1）；第幾個（sh.models／sh.decos／smR 的 Map 裡第幾個／pc.mods／FLY）
  el: null, off: null, cnt: null, vao: [],                           // 畫法：0 drawArrays、1 drawElements（UNSIGNED_INT）；索引從第幾個 byte（平滑面一區一份 ⇒ 0）；幾個頂點／索引；VAO
  glow: null, M: null,                                               // uGlow（燈：lanternK，其他 0；Float64Array ⇒ 存的就是以前傳的那個 double）；世界矩陣（第 i 個在 M[i·16 …]）
  mb: [],                                                            // 模型、裝飾的網格（包圍盒 me.bb；反射、主畫面一次畫多個用，S7）
  ref: [],                                                           // 矩陣從誰算（m／d／sh／裝甲那一塊 a／斷開的那一團的 m／f）：?rbchk=1 對拍用
  // 每一趟（pass descriptor）：b ＝ 只畫 cs 有這一位的 owner（0 ⇒ 全畫）；depth ＝ 只寫深度
  pd: { sh: { name: 'sh', k: 0, b: 0, depth: true }, rf: { name: 'rf', k: -1, b: 0, depth: false }, mn: { name: 'mn', k: -1, b: 0, depth: false } },
  pal: new Float32Array(INST_MAX * 16),                              // 一次畫多個的矩陣（P.triI／P.dtriI 的 uMs）：一批最多 INST_K 個，照 16 個 float 抄 RBAT.M（長度照上限 ⇒ 不用等 programs()）
  gl: {},                                                            // 這裡建的 GL 物件（pb ＝ 對拍的分身程式與轉換回饋的緩衝）記在一處 ⇒ 以後要處理 context lost 照這裡重建
  stat: { f: -1, owners: 0, items: 0, chk: 0, matMiss: 0, itemMiss: 0, rfCull: 0, cullMn: 0, cullRf: 0 },   // 讀數（__rbat.stat）：matMiss／itemMiss ＝ ?rbchk=1 對拍不一樣的項目數（量測工具 > 0 ⇒ 不過）；rfCull ＝ 反射這一格整件在水面下沒送的（S13）；cullMn／cullRf ＝ 這一格主畫面、反射整個不畫的 owner 數（鏡頭外，viewVis）
  cull: Q.get('rb') !== '0' && Q.get('cull') !== '0'                 // 鏡頭外的船不畫（viewVis，TASK-0813）：?cull=0、?rb=0 ⇒ 關；量測工具同一頁開關對拍 ⇒ __rbat.cull = false
};
var RBAT_CHK = Q.get('rbchk') === '1';                             // ?rbchk=1：每格整理完照以前的算式重算一遍、逐位元比（rbatCheck）
// 開關（網址，像 ?lerp=0；量測工具拿同一份成品 A/B 對拍用 —— 不進設定、不進 __game）：?rb=0 全部照以前一個一個畫；?rbinst=0（或 ?inst=0）不用一次畫多個的程式；
//   ?rbgeo=0 同一艘裡不換順序、?rbgeo=1 只換證明不會打平手的（τ）、不給 ⇒ 不管先後；?rbtau=<公尺> 除錯用的 τ（很大 ⇒ 全部算一群；沒給 ⇒ −1 ＝ 照算的）。照它們畫的：陰影（S5，rbatDepth）、反射與主畫面（S7，rbatColour）。
var RBAT_ON = Q.get('rb') !== '0', RBAT_INST = RBAT_ON && Q.get('rbinst') !== '0' && Q.get('inst') !== '0', RBAT_GEO = RBAT_ON && Q.get('rbgeo') !== '0';
var RBAT_TAU = isFinite(parseFloat(Q.get('rbtau'))) ? parseFloat(Q.get('rbtau')) : -1;
var RBAT_LOOSE = RBAT_GEO && Q.get('rbgeo') !== '1';                  // 同一艘裡不管先後（預設；Tim 2026-10-21「驗收主要是看效能是否優化 畫面相關都由我QA」）；?rbgeo=1 ⇒ 照 τ 證明的先後（逐位元組相同）
/** 項目的陣列加倍（整理到一半也行：前面的照抄）。 */
function rbatGrow() {
  var R = RBAT, L = Math.max(256, R.cap * 2);
  function cp(a, b) { if (a) b.set(a); return b; }
  R.cls = cp(R.cls, new Uint8Array(L)); R.ow = cp(R.ow, new Int32Array(L)); R.slot = cp(R.slot, new Int32Array(L)); R.el = cp(R.el, new Uint8Array(L));
  R.off = cp(R.off, new Int32Array(L)); R.cnt = cp(R.cnt, new Int32Array(L)); R.glow = cp(R.glow, new Float64Array(L)); R.M = cp(R.M, new Float32Array(L * 16));
  R.cap = L;
}
/** 加一個項目；W ＝ 世界矩陣（sh.M、f.M、算好的：照抄 16 個值 ⇒ 跟以前直接傳給 uniformMatrix4fv 的一樣）；W ＝ null ⇒ 呼叫的人自己寫 R.M（m4Into；回傳第幾項，⛔ 要在下一次 rbatAdd 之前寫：陣列會加倍換新的）。 */
function rbatAdd(c, o, k, ref, vao, el, off, cnt, glow, W) {
  var R = RBAT, i = R.ni;
  if (i >= R.cap) rbatGrow();
  R.cls[i] = c; R.ow[i] = o; R.slot[i] = k; R.ref[i] = ref; R.mb[i] = null; R.vao[i] = vao; R.el[i] = el; R.off[i] = off; R.cnt[i] = cnt; R.glow[i] = glow;
  if (W) R.M.set(W, i * 16);
  R.ni = i + 1; return i;
}
// ── 矩陣不配置（render 管線大修 S12）──
// 以前每件每格 M4.mul 兩三次（每次一個新的 Float32Array；光榮號 8 艘一格上千個）。現在照同一條算式寫進預先配好的陣列：
//   m4Into ＝ VK M4.mul 的算式一字不改（同樣的乘法、同樣的加法順序、double 算完存進 Float32Array 那一刻捨入）⇒ 每個值逐位元相同；?rbchk=1 每格每件跟 M4.mul 那條比。
//   只有平移的局部矩陣（modelLocal0 走到最後那一行 trans(origin)、沒掛在砲塔上）每件留一份（m.rbL／d.rbL：只給畫面的欄位），每格比 origin（Math.fround 後）變了就重填。
//   T(dv)·L 先進暫存（RBAT_TQ：跟以前內層 M4.mul 同一個捨入點），T(dv) ＝ 單位矩陣、平移 dv（存進 Float32Array ＝ trans 存的那個值）。
var RBAT_TD = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), RBAT_TQ = new Float32Array(16), RBAT_AW = new Float32Array(16);
/** out[o..o+15] ＝ a·b（VK M4.mul 的算式；out 不能是 a、b）。 */
function m4Into(out, o, a, b) {
  for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++)
    out[o + c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return out;
}
/** 只有平移的局部矩陣 ＝ trans(p)：留在 x.rbL（沒有就建、p 變了就重填）。 */
function rbatT(x, p) {
  var L = x.rbL;
  if (!L) { x.rbL = L = trans(p[0], p[1], p[2]); return L; }
  if (L[12] !== Math.fround(p[0]) || L[13] !== Math.fround(p[1]) || L[14] !== Math.fround(p[2])) { L[12] = p[0]; L[13] = p[1]; L[14] = p[2]; }
  return L;
}
/** 模型的局部矩陣：modelLocal(m)；只有平移的那條（modelLocal0 最後一行、沒有 m.hd）⇒ 留著的那一份。判斷照 modelLocal0 的順序（每格重判）。 */
function rbatModelL(m) {
  if (m.swM || m.sw || (m.spinB && m.spinB.mt) || (m.rot && m.piv) || m.hd) return modelLocal(m);
  return rbatT(m, m.origin);
}
// 平滑面那幾區（Map 的 forEach）：照這一個的 this 加（⛔ 每格不生閉包）；slot ＝ 這一項第一區在 Map 裡第幾個（0 ⇒ 這一份網格的第一項：設矩陣、燈熄）
//   船型那一份的合併緩衝（15_smooth.js smArena，S10）：跟上一項同一個 VAO、io 接在它後面 ⇒ 併進上一項（索引數加上去）⇒ 沒被打到的連著幾區一個 drawElements。
var RBAT_SM = { c: 2, o: 0, k: 0, ref: null, W: null };
function rbatSmAdd(m) {
  var S = RBAT_SM, R = RBAT, i = R.ni - 1, io = m.io || 0;
  if (S.k && m.sa && R.vao[i] === m.vao && R.off[i] + R.cnt[i] * 4 === io) { R.cnt[i] += m.n; S.k++; return; }   // S.k > 0 ⇒ 上一項是這一份的
  rbatAdd(S.c, S.o, S.k++, S.ref, m.vao, 1, io, m.n, 0, S.W);
}
/** 一格的表（render → frameBegin，prepRig 之後；一次 render() 一次，RFR）。判斷、順序、算式照以前的 drawModels／smDraw／armSmDraw 原樣抄。 */
function rbatPrep() {
  var R = RBAT, ns = SHIPS.length, n = ns + PIECES.length, o, k;
  if (n + 1 > R.i0.length) {
    var L = Math.max(n + 1, R.i0.length * 2);
    R.i0 = new Int32Array(L); R.cs = new Uint8Array(L); R.cst = new Uint8Array(L); R.cp = new Float64Array(L * 3); R.cR = new Float64Array(L);
  }
  R.f = RFR; R.n = n; R.ns = ns; R.ni = 0;
  for (o = 0; o < n; o++) {
    var ow = o < ns ? SHIPS[o] : PIECES[o - ns];
    R.own[o] = ow; R.cs[o] = 0; R.i0[o] = R.ni;
    if (o < ns) { if (!(ow.sink > 40)) rbatShip(ow, o); }
    else if (ow.mods) rbatPiece(ow, o);
  }
  R.i0[n] = R.ni;
  for (k = 0; k < FLY.length; k++) {                                  // 飛出去的模型（燈熄了、不看陰影的段：以前就沒判）
    var f = FLY[k], me = f.T.meshes[f.mesh]; if (!me || !f.M) continue; if (!me.vao) meshGpu(me);
    R.mb[rbatAdd(5, -1, k, f, me.vao, 0, 0, me.n, 0, meshDtL(me, f.M))] = me;   // meshDtL：共用別份網格的（只差起點，62_simview.js）⇒ 矩陣右邊乘 trans(dt)       // mb：反射判整件在水面下（S13）
  }
  for (o = n; o < R.nPrev; o++) R.own[o] = null;                      // 上一格多的放掉（斷開的那一團沉了、漂走了：不留著它）
  for (k = R.ni; k < R.niPrev; k++) R.vao[k] = R.ref[k] = R.mb[k] = null;
  R.nPrev = n; R.niPrev = R.ni;
  R.stat.f = RFR; R.stat.owners = n; R.stat.items = R.ni;
  if (RBAT_CHK) rbatCheck();
}
/** 一艘：模型 → 裝飾 → 平滑面 → 裝甲的平滑面。 */
function rbatShip(sh, o) {
  var T = sh.T, L = sh.models, k, m, me;
  for (k = 0; k < L.length; k++) {
    m = L[k]; me = T.meshes[m.mesh]; if (!m.alive || !me || (m.vox && !m.moved)) continue; if (!me.vao) meshGpu(me);   // m.vox：螺旋槳畫它自己的格（24_armor.js armDraw）
    var dv = m.ancD || m.vsl;                                         // 只給畫面的位移（格座標，左乘在 modelLocal 外面 ⇒ 帆的碰撞、斷船、打飛都看不到）：錨沒有 vsl、砲沒有 ancD
    var i = rbatAdd(0, o, k, m, me.vao, 0, 0, me.n, isLamp(m) ? lanternK(m) : 0, null), ML = meshDtL(me, rbatModelL(m));   // 取用點的火藥桶是後加的模型，沒有 meta
    if (dv) { RBAT_TD[12] = dv[0]; RBAT_TD[13] = dv[1]; RBAT_TD[14] = dv[2]; ML = m4Into(RBAT_TQ, 0, RBAT_TD, ML); }   // ＝ M4.mul(trans(dv), L)：同一個捨入點
    m4Into(RBAT.M, i * 16, sh.M, ML);
    RBAT.mb[i] = me;   // ancD：拋下去的模型錨，畫在鐵鍊那一端（76_anchor.js chainStep）；vsl：砲門關上時砲往裡縮（62_ports.js，TASK-0719）
  }
  L = sh.decos;
  if (L) for (k = 0; k < L.length; k++) {                             // 裝飾（TASK-0682；畫質「裝飾」關著 ⇒ 不畫）；砲門蓋板：每艘、每個畫質都畫（Tim；S14）——「砲門的開關演出」（62_ports.js portOn）只管演不演，沒輪到的那艘停在模型的樣子（開著、砲推出去）
    var d = L[k]; me = T.meshes[d.mesh];
    if (!me || d.gone || (!GFX.deco && d.meta.kind !== 'portlid') || (d.foot >= 0 && !hullGp(sh.grid, d.foot))) continue; if (!me.vao) meshGpu(me);   // gone：砲門蓋板被打掉了；腳下那一格被打掉 ⇒ 不畫
    i = rbatAdd(1, o, k, d, me.vao, 0, 0, me.n, isLamp(d) ? lanternK(d) : 0, null);
    m4Into(RBAT.M, i * 16, sh.M, meshDtL(me, d.L || rbatT(d, d.origin)));
    RBAT.mb[i] = me;   // L：砲門蓋板繞鉸鏈轉過的擺法（沒在動 ⇒ null ＝ 模型的樣子）
  }
  var S = RBAT_SM; S.o = o;
  if (sh.smR && sh.smR.size) { S.c = 2; S.k = 0; S.ref = sh; S.W = sh.M; sh.smR.forEach(rbatSmAdd); }   // 平滑渲染的格（15_smooth.js）：跟模型同一支著色器
  if (sh.arm) for (k = 0; k < sh.arm.length; k++) {                  // 砲帶的裝甲的平滑面（24_armor.js；螺旋槳掉了 ⇒ 不畫）
    var a = sh.arm[k]; if (!(a.smR && a.smR.size && !(a.prop && propGone(a)))) continue;
    var AL = armLocal(a);                                               // ＝ armM(a)：L ? M4.mul(sh.M, L) : sh.M（每塊一格一次；rbatSmAdd 照抄進每一項）
    S.c = 3; S.k = 0; S.ref = a; S.W = AL ? m4Into(RBAT_AW, 0, a.sh.M, AL) : a.sh.M; a.smR.forEach(rbatSmAdd);
  }
  S.ref = S.W = null;
}
/** 斷開的那一團：跟著它走的模型。 */
function rbatPiece(pc, o) {
  for (var k = 0, L = pc.mods; k < L.length; k++) {
    var m = L[k], me = pc.T.meshes[m.mesh]; if (!me) continue; if (!me.vao) meshGpu(me);
    var ip = rbatAdd(4, o, k, m, me.vao, 0, 0, me.n, 0, null);
    m4Into(RBAT.M, ip * 16, pc.M, meshDtL(me, m.L)); RBAT.mb[ip] = me;
  }
}
/** 照表畫模型那一段（60_render.js drawModels）：prog ＝ 這一趟的程式（P.tri／P.dtri，呼叫的人已經 useProgram＋setCommon）、pd ＝ 哪一趟。
 *  GL 的呼叫照以前的順序：aM 常數 → 每艘（cutSet；模型、裝飾：uModel、uGlow、畫；平滑面、裝甲的平滑面：一份網格開頭 uModel＋uGlow 0、每區畫）
 *  → uGlow 0、cutSet(null) → 斷開的那一團的模型（照陰影的段）→ 飛出去的模型。畫完：prog 還綁著、uGlow 0、剖面關（之後的旗桿、繩、鏈彈照這個畫）。
 *  uGlow 只在值換了才傳（S3）：g ＝ 這一趟上次傳的（每一趟從 NaN 起 ⇒ 第一個一定傳，不靠上一趟、別人留下的）；燈不多 ⇒ 一趟幾乎只傳一兩次。 */
function rbatReplay(prog, pd) {
  var R = RBAT, u = prog.u, M = R.M, b = pd.b, cs = R.cs, ns = R.ns, n = R.n, gu = u.uGlow, g = NaN, o, i, e;
  gl.vertexAttrib2f(3, 0, 0.5);                                         // P.tri 的 aM（金屬度、粗糙度；TASK-0627）：模型的 VAO 沒開這個屬性 ⇒ 讀這個常數 ⇒ 不反光（平滑渲染的 VAO 自己帶）
  for (o = 0; o < ns; o++) {
    var sh = R.own[o];
    if (sh.sink > 40 || (b && !(cs[o] & b))) continue;
    cutSet(prog, sh);                                                   // 剖面與隱藏甲板（74_cutaway.js）
    for (i = R.i0[o], e = R.i0[o + 1]; i < e; i++) {
      if (R.cls[i] < 2) {
        gl.uniformMatrix4fv(u.uModel, false, M, i * 16, 16);
        if (gu && R.glow[i] !== g) gl.uniform1f(gu, g = R.glow[i]);
        gl.bindVertexArray(R.vao[i]); gl.drawArrays(gl.TRIANGLES, 0, R.cnt[i]);
      } else {                                                          // 平滑面：一份網格（這艘的、裝甲的那一塊）第一區設矩陣、燈熄
        if (!R.slot[i]) { gl.uniformMatrix4fv(u.uModel, false, M, i * 16, 16); if (gu && g !== 0) gl.uniform1f(gu, g = 0); }
        gl.bindVertexArray(R.vao[i]); gl.drawElements(gl.TRIANGLES, R.cnt[i], gl.UNSIGNED_INT, R.off[i]);
      }
    }
  }
  if (gu && g !== 0) gl.uniform1f(gu, 0);                              // 斷開的那一團、飛出去的模型：燈熄了（已經是 0 ⇒ 不再傳）
  cutSet(prog, null);
  for (o = ns; o < n; o++) {                                            // 跟著斷開的那一團走的模型
    if (b && !(cs[o] & b)) continue;
    for (i = R.i0[o], e = R.i0[o + 1]; i < e; i++) { gl.uniformMatrix4fv(u.uModel, false, M, i * 16, 16); gl.bindVertexArray(R.vao[i]); gl.drawArrays(gl.TRIANGLES, 0, R.cnt[i]); }
  }
  for (i = R.i0[n], e = R.ni; i < e; i++) { gl.uniformMatrix4fv(u.uModel, false, M, i * 16, 16); gl.bindVertexArray(R.vao[i]); gl.drawArrays(gl.TRIANGLES, 0, R.cnt[i]); }
}
// ── 陰影一次畫多個（render 管線大修 S5）──
// 陰影那一段只寫深度、深度測試 LESS、不混色、偏移照每個三角形自己的頂點算 ⇒ 每一格最後留下的就是最小的那個深度，誰先畫都一樣
//   ⇒ 同一份網格（VAO＋畫法＋起點＋數量）的項目不分哪艘、哪一類（模型、裝飾含砲門蓋板、平滑面、裝甲的平滑面、斷開的那一團、飛出去的）收成一桶，一桶一次畫（P.dtriI，滿 INST_K 個換下一批）。
// 桶一格整理一次（第一段陰影要畫時；表是這一格的）；每一段只挑 cs 有這一位的 owner、FLY 沒有 owner ⇒ 一定畫（以前也沒判；這一段有東西才會走到這裡）
//   ⇒ 畫的項目集合跟以前一個一個畫的一模一樣，頂點的算式是 S4 對拍過的 P.dtriI ⇒ 陰影圖逐位元組相同。
// 桶：同一個 VAO 的串成一列（same；模型一份網格一個 VAO ⇒ 幾乎都只有一桶），桶裡的項目照表的順序串起來（nx）。陣列不夠才加倍、之後一直重用（⛔ 每格不配置）。
var RBAT_BK = { f: -1, n: 0, nPrev: 0, cap: 0, map: new Map(), vao: [], el: null, off: null, cnt: null, h: null, t: null, same: null, nx: new Int32Array(0) };
function rbatBkGrow() {
  var B = RBAT_BK, L = Math.max(64, B.cap * 2);
  function cp(a, b) { if (a) b.set(a); return b; }
  B.el = cp(B.el, new Uint8Array(L)); B.off = cp(B.off, new Int32Array(L)); B.cnt = cp(B.cnt, new Int32Array(L));
  B.h = cp(B.h, new Int32Array(L)); B.t = cp(B.t, new Int32Array(L)); B.same = cp(B.same, new Int32Array(L)); B.cap = L;
}
/** 這一格的桶（一格一次；RFR 換了才重排）。 */
function rbatBuckets() {
  var R = RBAT, B = RBAT_BK, m = B.map, i, j;
  if (B.f === R.f) return B;
  B.f = R.f; B.n = 0; m.clear();
  if (B.nx.length < R.cap) B.nx = new Int32Array(R.cap);
  for (i = 0; i < R.ni; i++) {
    var v = R.vao[i], el = R.el[i], off = R.off[i], cnt = R.cnt[i], j0 = m.get(v);
    for (j = j0 === undefined ? -1 : j0; j >= 0 && !(B.el[j] === el && B.off[j] === off && B.cnt[j] === cnt); j = B.same[j]);
    B.nx[i] = -1;
    if (j < 0) {
      if (B.n >= B.cap) rbatBkGrow();
      j = B.n++; B.vao[j] = v; B.el[j] = el; B.off[j] = off; B.cnt[j] = cnt; B.h[j] = B.t[j] = i;
      B.same[j] = j0 === undefined ? -1 : j0; m.set(v, j);
    } else { B.nx[B.t[j]] = i; B.t[j] = i; }
  }
  for (j = B.n; j < B.nPrev; j++) B.vao[j] = null;                        // 上一格多的放掉（不留著已經換掉的 VAO）
  B.nPrev = B.n;
  return B;
}
/** 陰影第 pd.k 段的模型那一段（取代 drawModels(P.dtri)；60_render.js shadowCasters）：P.dtriI 一桶一次畫。 */
function rbatDepth(pd) {
  var R = RBAT, B = rbatBuckets(), p = P.dtriI, M = R.M, pal = R.pal, cs = R.cs, b = pd.b, K = INST_K, j, i, k, q, s, o;
  gl.useProgram(p.prog); setCommon(p);                                  // uVP ＝ 這一段的矩陣（PASS.vp）
  gl.vertexAttrib2f(3, 0, 0.5);                                         // 第 3 號屬性的常數照以前（rbatReplay 每一趟開頭都設；是 context 的狀態，不是 VAO 的）
  for (j = 0; j < B.n; j++) {
    for (k = 0, i = B.h[j]; i >= 0; i = B.nx[i]) {
      o = R.ow[i]; if (o >= 0 && b && !(cs[o] & b)) continue;
      for (q = 0, s = i * 16; q < 16; q++) pal[k * 16 + q] = M[s + q];
      if (++k === K) { rbatDepthDraw(B, j, p.u, k); k = 0; }
    }
    if (k) rbatDepthDraw(B, j, p.u, k);
  }
}
function rbatDepthDraw(B, j, u, k) {
  gl.uniformMatrix4fv(u.uMs, false, RBAT.pal, 0, k * 16);
  gl.bindVertexArray(B.vao[j]);
  if (B.el[j]) gl.drawElementsInstanced(gl.TRIANGLES, B.cnt[j], gl.UNSIGNED_INT, B.off[j], k);
  else gl.drawArraysInstanced(gl.TRIANGLES, 0, B.cnt[j], k);
}
// ── 反射、主畫面：同一艘裡一次畫多個（render 管線大修 S7；Tim 最早問的砲門蓋板、同型的砲）──
// 主畫面深度 LEQUAL（後畫贏）、反射 LESS（先畫贏）、不混色 ⇒ 換先後只會在「同一個像素兩個深度剛好一樣」時改結果。
//   兩個東西的世界包圍盒相距大於 τ ⇒ 同一條視線穿過它們的兩點至少差 τ ⇒ 深度至少差 8 個 D24 的刻度 ⇒ 不可能打平手（MSAA 的每個取樣點也是）⇒ 誰先畫都一樣。
//   τ ＝ 16·2⁻²⁴·w²／(|c2|·cosmin) ＋ 1 mm：z_ndc ＝ c1 ＋ c2／w（從這一趟的 VP 讀）；w ＝ 兩個盒子在這一趟最大的 clip w（至少近裁切面）；cosmin ＝ 視錐最斜那個角的視線跟正前方夾角的餘弦。
// 排法（一艘一艘，照以前的順序收）：同一份網格＋同一個 uGlow 的收成一組；新來的那一個先把「別組裡有離它 τ 以內的」那幾組畫掉（畫掉的組不再開），再放進自己那一組
//   ⇒ 離得近的兩個（可能打平手）照以前的先後；換了先後的兩個一定離得夠開。一組照放進去的順序一次畫（滿 INST_K 個換下一批）。
//   這艘的模型、裝飾全部畫完才畫平滑面、裝甲的平滑面（照以前一區一區）；斷開的那一團、FLY 照以前的順序，只合連在一起的同一份網格。
// 預設不管先後（RBAT_LOOSE：同一艘裡同一份網格＋同一個 uGlow 全部合一批 ⇒ 只有兩個東西在同一個像素深度剛好一樣時結果可能換；量測工具 20 組量起來畫面照舊）；
//   ?rbgeo=1 ⇒ 照上面 τ 的排法（換了先後的一定離得夠開 ⇒ 逐位元組相同）：看到砲與蓋板交界閃 ⇒ 先試它。
// 剖面開著（cutOn：每艘的剖面 uniform 不一樣）⇒ 照以前一個一個畫（rbatReplay）；正交的鏡頭（轉場）、?rbgeo=0 ⇒ 不換先後（只合連在一起的）。
// 包圍盒：模型、裝飾 ＝ 網格自己的盒子（me.bb，62_simview.js 上傳時算）照這一格的世界矩陣轉（中心 ± |W|·半寬，double，再放寬 1 mm ＋ 座標的 10⁻⁶）；一格算一次。沒有盒子 ⇒ 當成跟誰都近（照以前的先後）。
var RBAT_C = { f: -1, cap: 0, bx: null, w: null, nx: null, gm: new Map(), gn: 0, gV: [], gC: null, gG: null, gO: null, gH: null, gT: null, gS: null, gB: null, gW: null, gE: null, gF: null, tk: 0, tn: 0, inf: true, inf0: true, lo: false, g: NaN, cy: -Infinity };
function rbatCGrow(n) {
  var C = RBAT_C, L = Math.max(256, n, C.cap * 2);
  C.bx = new Float64Array(L * 6); C.w = new Float64Array(L); C.nx = new Int32Array(L);
  C.gC = new Int32Array(L); C.gG = new Float64Array(L); C.gO = new Uint8Array(L); C.gH = new Int32Array(L); C.gT = new Int32Array(L); C.gS = new Int32Array(L); C.gB = new Float64Array(L * 6); C.gW = new Float64Array(L); C.gE = new Uint8Array(L); C.gF = new Int32Array(L);
  C.f = -1; C.cap = L;
}
/** 這一格模型、裝飾的世界包圍盒（一格一次）。 */
function rbatBoxes() {
  var R = RBAT, C = RBAT_C, M = R.M, i, j;
  if (C.cap < R.ni) rbatCGrow(R.ni);
  if (C.f === R.f) return;
  C.f = R.f;
  for (i = 0; i < R.ni; i++) {
    var b = R.cls[i] < 2 && R.mb[i] && R.mb[i].bb, o = i * 6;
    if (!b) { C.bx[o] = C.bx[o + 1] = C.bx[o + 2] = -Infinity; C.bx[o + 3] = C.bx[o + 4] = C.bx[o + 5] = Infinity; continue; }
    var s = i * 16, cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, cz = (b[2] + b[5]) / 2, ex = (b[3] - b[0]) / 2, ey = (b[4] - b[1]) / 2, ez = (b[5] - b[2]) / 2;
    for (j = 0; j < 3; j++) {
      var c = M[s + j] * cx + M[s + 4 + j] * cy + M[s + 8 + j] * cz + M[s + 12 + j], e = Math.abs(M[s + j]) * ex + Math.abs(M[s + 4 + j]) * ey + Math.abs(M[s + 8 + j]) * ez;
      var pad = 1e-3 + 1e-6 * (Math.abs(c) + e);
      C.bx[o + j] = c - e - pad; C.bx[o + 3 + j] = c + e + pad;
    }
  }
}
/** 這一趟的 τ 係數（C.tk：τ ＝ tk·w² ＋ 1 mm；C.tn：近裁切面；C.inf：不換先後）。VP ＝ P·V（V 剛體、可能帶鏡射）：第 4 列 ＝ −V 的第 3 列、第 3 列 ＝ A·V 第 3 列 ＋ B·e4 ⇒ c1 ＝ −A、c2 ＝ B、近 ＝ B／(A − 1)。 */
function rbatTau(V) {
  var C = RBAT_C, r3 = Math.hypot(V[3], V[7], V[11]);
  C.inf = !RBAT_GEO || r3 < 1e-6;                                          // ?rbgeo=0、正交（第 4 列沒有 xyz）⇒ 不換先後
  if (C.inf) return;
  var a = Math.abs(V[3]) >= Math.abs(V[7]) ? (Math.abs(V[3]) >= Math.abs(V[11]) ? 0 : 8) : (Math.abs(V[7]) >= Math.abs(V[11]) ? 4 : 8);   // 第 4 列最大的那一格（⇒ A 從這一格讀）
  var A = -V[a + 2] / V[a + 3], B = V[14] + A * V[15], p0 = Math.hypot(V[0], V[4], V[8]) / r3, p1 = Math.hypot(V[1], V[5], V[9]) / r3;
  var cosmin = 1 / Math.sqrt(1 + 1 / (p0 * p0) + 1 / (p1 * p1));
  C.tn = B / (A - 1); C.tk = 16 * Math.pow(2, -24) / (Math.abs(B) * cosmin);
  if (RBAT_TAU >= 0) C.tk = -1;                                             // ?rbtau=<公尺>：除錯用的固定 τ
  if (!(C.tn > 0) || !isFinite(C.tk)) C.inf = true;                          // 讀不出來 ⇒ 不換先後
}
/** 第 i 項在這一趟最大的 clip w（盒子 8 個角；至少近裁切面）。 */
function rbatW(V, i) {
  var b = RBAT_C.bx, o = i * 6, w = V[15];
  for (var j = 0; j < 3; j++) { var k = V[j * 4 + 3]; w += Math.max(k * b[o + j], k * b[o + 3 + j]); }
  return isFinite(w) ? Math.max(w, RBAT_C.tn) : Infinity;
}
/** 兩個盒子（bx 第 i 個、第 j 個；或 gB 第 g 組）近不近：相距 ≤ τ(max w)。 */
function rbatNear(A, a, B, b, w) {
  var C = RBAT_C, t = C.tk < 0 ? RBAT_TAU : C.tk * w * w + 1e-3, d2 = 0;
  if (!isFinite(t)) return true;
  for (var j = 0; j < 3; j++) { var g = Math.max(A[a + j] - B[b + 3 + j], B[b + j] - A[a + 3 + j], 0); d2 += g * g; }
  return !(d2 > t * t);
}
/** 第 g 組裡有沒有離第 i 項 τ 以內的（先看整組的盒子）。 */
function rbatNearG(g, i) {
  var C = RBAT_C, wi = C.w[i], j;
  if (C.inf) return true;
  if (!rbatNear(C.gB, g * 6, C.bx, i * 6, Math.max(C.gW[g], wi))) return false;
  for (j = C.gH[g]; j >= 0; j = C.nx[j]) if (rbatNear(C.bx, j * 6, C.bx, i * 6, Math.max(C.w[j], wi))) return true;
  return false;
}
/** 畫第 g 組（P.triI，滿 INST_K 個換下一批）：模型、裝飾 drawArrays；平滑面（gE）drawElements 從 gF 個 byte 起（S6：跨船的平滑面也收組）。 */
function rbatFlush(g) {
  var R = RBAT, C = RBAT_C, M = R.M, pal = R.pal, u = P.triI.u, K = INST_K, k = 0, i, q, s, el = C.gE[g], off = C.gF[g];
  C.gO[g] = 0;
  if (C.gH[g] < 0) return;                                               // 只有鏡頭外那幾艘的（rbatGRes 開的、沒放項目）⇒ 什麼都不送
  if (C.gG[g] !== C.g) gl.uniform1f(u.uGlow, C.g = C.gG[g]);
  gl.bindVertexArray(C.gV[g]);
  for (i = C.gH[g]; i >= 0; i = C.nx[i]) {
    for (q = 0, s = i * 16; q < 16; q++) pal[k * 16 + q] = M[s + q];
    if (++k === K || C.nx[i] < 0) {
      gl.uniformMatrix4fv(u.uMs, false, pal, 0, k * 16);
      if (el) gl.drawElementsInstanced(gl.TRIANGLES, C.gC[g], gl.UNSIGNED_INT, off, k); else gl.drawArraysInstanced(gl.TRIANGLES, 0, C.gC[g], k);
      k = 0;
    }
  }
}
/** 收組：開始一段（geo ＝ false ⇒ 只合連在一起的：斷開的那一團、FLY）→ 一項一項 rbatGAdd → rbatGEnd 把還開著的組畫掉。 */
function rbatGBegin(geo) {
  var C = RBAT_C;
  C.inf0 = C.inf; C.lo = RBAT_LOOSE && geo;                                // lo：不管先後
  if (!geo) C.inf = true;
  C.gn = 0; C.gm.clear();
}
/** 第 i 項放進它那一組（同一個 VAO、畫法、起點、數量、uGlow）；照 τ 排的時候先把別組裡離它近的畫掉。 */
function rbatGAdd(i, V) {
  var R = RBAT, C = RBAT_C, m = C.gm, g, H, v = R.vao[i], n = R.cnt[i], gw = R.glow[i], el = R.el[i], off = R.off[i], j0;
  if (C.cy > -Infinity && R.mb[i] && rbatUnder(i, C.cy)) { R.stat.rfCull++; return; }   // 反射：整件在水面下 ⇒ 不送（S13）
  j0 = m.get(v);                                                         // 同一個 VAO 的組串成一列（gS），找自己那一組不用掃全部
  if (!C.inf) C.w[i] = rbatW(V, i);
  for (H = j0 === undefined ? -1 : j0; H >= 0 && !(C.gO[H] && C.gC[H] === n && C.gG[H] === gw && C.gE[H] === el && C.gF[H] === off); H = C.gS[H]);
  if (!C.lo) for (g = 0; g < C.gn; g++) if (g !== H && C.gO[g] && rbatNearG(g, i)) rbatFlush(g);
  C.nx[i] = -1;
  if (H < 0) {
    H = C.gn++; C.gV[H] = v; C.gC[H] = n; C.gG[H] = gw; C.gE[H] = el; C.gF[H] = off; C.gO[H] = 1; C.gH[H] = C.gT[H] = i; C.gW[H] = C.w[i];
    C.gS[H] = j0 === undefined ? -1 : j0; m.set(v, H);
    if (!C.inf) for (var q = 0; q < 6; q++) C.gB[H * 6 + q] = C.bx[i * 6 + q];   // ⛔ subarray：每組一個新物件
  } else {
    if (C.gH[H] < 0) C.gH[H] = i; else C.nx[C.gT[H]] = i;               // 組是 rbatGRes 開的、還沒有項目 ⇒ 這一項是第一個
    C.gT[H] = i;
    if (!C.inf) { var B = C.gB, o = H * 6, b = C.bx, p = i * 6; C.gW[H] = Math.max(C.gW[H], C.w[i]); for (var j = 0; j < 3; j++) { B[o + j] = Math.min(B[o + j], b[p + j]); B[o + 3 + j] = Math.max(B[o + 3 + j], b[p + 3 + j]); } }
  }
}
/** 鏡頭外那一艘的第 i 項（不管先後的那條，viewVis 判看不到）：它那一組照樣開（還沒有就開一個空的）、項目不放 ⇒ 組的先後跟全畫時一模一樣
 *  ⇒ 看得到的船畫的先後不變（不同網格剛好同深度的那幾個像素也一樣），一艘船進出畫面邊緣時別艘不會閃。水面下的（S13）照 rbatGAdd 先跳過、不開組。 */
function rbatGRes(i) {
  var R = RBAT, C = RBAT_C, m = C.gm, v = R.vao[i], n = R.cnt[i], gw = R.glow[i], el = R.el[i], off = R.off[i], j0, H;
  if (C.cy > -Infinity && R.mb[i] && rbatUnder(i, C.cy)) return;
  j0 = m.get(v);
  for (H = j0 === undefined ? -1 : j0; H >= 0 && !(C.gO[H] && C.gC[H] === n && C.gG[H] === gw && C.gE[H] === el && C.gF[H] === off); H = C.gS[H]);
  if (H >= 0) return;
  H = C.gn++; C.gV[H] = v; C.gC[H] = n; C.gG[H] = gw; C.gE[H] = el; C.gF[H] = off; C.gO[H] = 1; C.gH[H] = C.gT[H] = -1; C.gW[H] = 0;
  C.gS[H] = j0 === undefined ? -1 : j0; m.set(v, H);
}
function rbatGEnd() {
  var C = RBAT_C, g;
  for (g = 0; g < C.gn; g++) if (C.gO[g]) rbatFlush(g);
  for (g = 0; g < C.gn; g++) C.gV[g] = null;
  C.gm.clear(); C.inf = C.inf0;
}
// ── 反射跳過整件在水面下的（render 管線大修 S13）──
// 反射那一趟裁切面是水平的 y ＝ PASS.clip（reflPass 設 0），著色器第一句 if (vW.y < uClip) discard ⇒ 一件模型的每個頂點都在裁切面下面 ⇒ 每個片段都丟掉、什麼都沒寫
//   ⇒ 整件不送，畫面一樣。最高點 ＝ 網格的包圍盒（me.bb）照這一件這一格的世界矩陣轉（含 vsl、ancD、船的傾斜），double 算；再留 2 cm。
//   只裁模型、裝飾、斷開的那一團的模型、飛出去的（有 mb 的）；船殼、平滑面的合併段不裁（裁了會把一段切碎）。只在一次畫多個的路徑（?inst=0 ⇒ 照舊全送）。
/** 第 i 項整件在 y 以下（世界座標）。 */
function rbatUnder(i, y) {
  var b = RBAT.mb[i].bb, M = RBAT.M, s = i * 16, top, j, k;
  if (!b) return false;
  for (top = M[s + 13], j = 0; j < 3; j++) { k = M[s + 1 + 4 * j]; top += Math.max(k * b[j], k * b[3 + j]); }
  return top < y;
}
/** 一段 [i0, i1) 照上面的排法收組、畫。 */
function rbatGroups(i0, i1, geo, V) { rbatGBegin(geo); for (var i = i0; i < i1; i++) rbatGAdd(i, V); rbatGEnd(); }
/** 反射、主畫面的模型那一段（取代 rbatReplay(P.tri)；60_render.js drawModels）：P.triI。畫完：P.tri 綁回去、剖面關（之後的旗桿、繩、鏈彈照這個畫；P.tri 的 uGlow 沒動過 ⇒ 還是 0）。
 *  不管先後（預設，S6）：所有船的模型、裝飾、平滑面、裝甲的平滑面一起收組 ⇒ 同型的船同一份網格（同一段平滑面）不分哪艘一次畫。
 *    換先後只在兩個東西同一個像素深度剛好一樣時改結果（不透明、不混色）；每艘的 uniform 在這一段一樣（剖面關、uLit 1），矩陣、uGlow 照每一項 ⇒ 跨船合得起來。
 *  ?rbgeo=1（照 τ 證明的先後，S7）、?rbgeo=0（不換先後）：一艘一艘 —— 模型、裝飾收組，平滑面照以前一區一區。 */
function rbatColour(pd) {
  var R = RBAT, C = RBAT_C, p = P.triI, u = p.u, M = R.M, pal = R.pal, V = PASS.vp || CAM.vp, ns = R.ns, b = pd.b, cs = R.cs, o, i, e;   // b：這一趟只畫 cs 有這一位的（鏡頭外的不畫，viewVis；0 ⇒ 全畫）
  if (C.cap < R.ni) rbatCGrow(R.ni);                                    // 組、串列的陣列（不夠才加倍）
  if (RBAT_LOOSE) C.inf = true; else { rbatBoxes(); rbatTau(V); }       // 不管先後 ⇒ 不用包圍盒、τ
  C.g = NaN;
  C.cy = pd === R.pd.rf && PASS.clip > -1e8 ? PASS.clip - 0.02 : -Infinity;   // 反射：整件在水面下的不送（S13）
  if (C.cy > -Infinity) R.stat.rfCull = 0;
  gl.useProgram(p.prog); setCommon(p); gl.uniform1f(u.uLit, 1); cutSet(p, null);
  gl.vertexAttrib2f(3, 0, 0.5);                                           // 第 3 號屬性的常數照以前（見 rbatReplay）
  if (RBAT_LOOSE) {
    rbatGBegin(true);
    for (o = 0; o < ns; o++) if (R.own[o].sink <= 40) {
      if (b && !(cs[o] & b)) { for (i = R.i0[o], e = R.i0[o + 1]; i < e; i++) rbatGRes(i); continue; }   // 鏡頭外：組照樣開（先後不變）、不放項目
      for (i = R.i0[o], e = R.i0[o + 1]; i < e; i++) rbatGAdd(i, V);
    }
    rbatGEnd();
  } else for (o = 0; o < ns; o++) {
    if (R.own[o].sink > 40 || (b && !(cs[o] & b))) continue;
    for (i = R.i0[o], e = R.i0[o + 1]; i < e && R.cls[i] < 2; i++);
    rbatGroups(R.i0[o], i, true, V);                                      // 模型、裝飾
    for (; i < e; i++) {                                                  // 平滑面、裝甲的平滑面：照以前一區一區（一份網格第一區換矩陣、燈熄）
      if (!R.slot[i]) { for (var q = 0, s = i * 16; q < 16; q++) pal[q] = M[s + q]; gl.uniformMatrix4fv(u.uMs, false, pal, 0, 16); if (C.g !== 0) gl.uniform1f(u.uGlow, C.g = 0); }
      gl.bindVertexArray(R.vao[i]); gl.drawElementsInstanced(gl.TRIANGLES, R.cnt[i], gl.UNSIGNED_INT, R.off[i], 1);
    }
  }
  rbatGBegin(false);                                                      // 斷開的那一團的模型、FLY（燈熄：glow 都是 0；只合連在一起的 ⇒ 跳過鏡頭外那一團的，剩下的先後照舊）
  for (i = R.i0[ns], e = R.ni; i < e; i++) { o = R.ow[i]; if (o >= 0 && b && !(cs[o] & b)) continue; rbatGAdd(i, V); }   // FLY（o ＝ −1）一定畫
  rbatGEnd();
  C.cy = -Infinity;
  gl.useProgram(P.tri.prog); cutSet(P.tri, null);
}

// ── 鏡頭外的船不畫（TASK-0813；Tim 2026-10-22 從 TASK-0792 的延後清單選的：量到八艘近看 4080 −28～−39%、內顯 −13～−22%）──
// 反射、主畫面：一個 owner（船、斷開的那一團）這一格畫的每一樣東西包成一個保守的世界外框；外框整個在這一趟視錐某一面的外面
//   ⇒ 它畫的每個三角形、每條線的每個頂點都在那一面外面 ⇒ 全部被裁掉、一個片段都不寫 ⇒ 不送，畫面一樣（量測工具 cullsweep：同一頁開、關逐格比）。
// 外框（vvOwner）＝ 格子的外框（船殼、平滑面、玻璃都在格子裡：0..sx／sy／sz 外擴 1 格）
//   ∪ 這一份上傳的帆、繩、繩梯的管、垂繩、鐵鍊、旗桿、建造與艙房的線的頂點外框（lb：11_rig_gpu.js upload／sailBuf／looseBuf 上傳時記的，格座標）—— 這些都照 ow.M 畫
//   ∪ 模型、裝飾、斷開的那一團的模型：網格的盒子（me.bb）照這一格表裡的世界矩陣（RBAT.M：含 ancD 拋下去的錨、vsl、砲塔、只差起點的 dt）
//   ∪ 裝甲、砲塔、螺旋槳：那一塊的格子照 armM（跟 armDraw、armSmDraw 同一個矩陣）。外框照矩陣轉（中心 ± |W|·半寬，double），再放寬 1 mm ＋ 座標的 10⁻⁶。
// 視錐（vvPlanes）＝ 主畫面 CAM.vp、反射 CAM.vp·MIRROR（reflPass 同一條：y 那一行變號）的六個面（正規化）；反射多一面水面（reflPass 的 PASS.clip ＝ 0：著色器丟掉 y < 0 的片段）。
//   外框到某一面的距離 < −2 cm ⇒ 看不到。海讀反射圖時的擾動（≤ 0.035 個畫面）只是換讀反射圖哪一個像素：反射圖裡本來就沒畫到它 ⇒ 不用留邊。
// 不剔的：陰影（看不到的船，影子照樣落進畫面）；全部船一次送的（船員：上限照船的順序排 ⇒ 少一艘別艘的人會換；碎片、粒子、光暈、浪花、鏈彈）；
//   燈（照亮別艘）、艙內的水（網格照算、讀數要用）、FLY（沒有 owner）、第一人稱站的那一艘。
// 判完寫在 RBAT.cs 的第 4、5 位（第 0–3 位是陰影的段：csmOwners 在這之前清、填），pd.rf.b／pd.mn.b 設成那一位
//   ⇒ drawHulls（含裝甲）、drawSails、rbatReplay 照原本的判斷就跳過；rbatColour、drawColours、繩那一圈、玻璃另外判。render() 畫完 b 設回 0（這一格以外沒人照它畫）。
// ?cull=0、?rb=0、__rbat.cull(false) ⇒ b ＝ 0 ＝ 以前全畫。⛔ 只畫面：外框、位元都是 RBAT 自己的，模擬不讀（camShipSee 是鏡頭自己的判斷，跟這裡無關）。
var VV_RF = 16, VV_MN = 32, VV_PAD = 0.02;
var VV = { pl: new Float64Array(28 * 2), L: new Float64Array(6), B: new Float64Array(6), W: new Float32Array(16) };   // pl：主畫面 6 面＋反射 7 面（每面 4 個）；L：格座標的外框；B：世界外框；W：裝甲的矩陣
/** 這一格每個 owner 反射、主畫面看不看得到（render：shadowMats 之後、reflPass 之前；鏡頭、內插過的 sh.M、這一格的表都定了）。 */
function viewVis() {
  var R = RBAT, pr = R.pd.rf, pm = R.pd.mn, vp = CAM.vp, P = VV.pl, cm = 0, cr = 0, o, j;
  R.stat.cullMn = R.stat.cullRf = 0;
  if (!R.cull || !vp) { pr.b = pm.b = 0; return; }                         // 關著、鏡頭還沒算過 ⇒ 全畫
  pr.b = VV_RF; pm.b = VV_MN;
  vvPlanes(P, 0, vp, 1); vvPlanes(P, 28, vp, -1);
  P[52] = 0; P[53] = 1; P[54] = 0; P[55] = 0;                             // 反射的第 7 面：水面 y ≥ 0（reflPass 的 PASS.clip）
  for (o = 0; o < R.n; o++) {
    var ow = R.own[o], v = VV_RF | VV_MN;
    if (ow && !(ow.sink > 40) && !(FP.on && FP.sh === ow) && vvOwner(o, ow)) {
      for (j = 0; j < 6; j++) if (vvOut(P, j * 4)) { v &= ~VV_MN; cm++; break; }
      for (j = 0; j < 7; j++) if (vvOut(P, 28 + j * 4)) { v &= ~VV_RF; cr++; break; }
    }
    R.cs[o] |= v;
  }
  R.stat.cullMn = cm; R.stat.cullRf = cr;
}
/** VP 的六個面寫進 P[o..o+23]（a·x ＋ b·y ＋ c·z ＋ d ≥ 0 在裡面、正規化）；sy ＝ −1 ⇒ VP·MIRROR 的（y 那一行變號）。 */
function vvPlanes(P, o, m, sy) {
  for (var i = 0; i < 3; i++) for (var s = -1; s <= 1; s += 2) {
    var a = m[3] + s * m[i], b = (m[7] + s * m[4 + i]) * sy, c = m[11] + s * m[8 + i], d = m[15] + s * m[12 + i], l = Math.hypot(a, b, c) || 1, k = o + (i * 2 + (s + 1) / 2) * 4;
    P[k] = a / l; P[k + 1] = b / l; P[k + 2] = c / l; P[k + 3] = d / l;
  }
}
/** 世界外框（VV.B）整個在第 k 面外面超過 VV_PAD。 */
function vvOut(P, k) {
  var B = VV.B, a = P[k], b = P[k + 1], c = P[k + 2];
  return a * (a > 0 ? B[3] : B[0]) + b * (b > 0 ? B[4] : B[1]) + c * (c > 0 ? B[5] : B[2]) + P[k + 3] < -VV_PAD;
}
/** 格座標的外框 L 併進 lb（上傳時記的；沒有頂點 ⇒ 不動）。 */
function vvUnionLb(L, x) {
  var b = x && x.n && x.lb; if (!b || !(b[0] <= b[3])) return;
  for (var j = 0; j < 3; j++) { if (b[j] < L[j]) L[j] = b[j]; if (b[3 + j] > L[3 + j]) L[3 + j] = b[3 + j]; }
}
/** 盒子 b（局部座標）照矩陣 W（從第 s 個 float 起）轉成世界外框，併進 VV.B。 */
function vvUnionXf(W, s, b) {
  var B = VV.B, cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, cz = (b[2] + b[5]) / 2, ex = (b[3] - b[0]) / 2, ey = (b[4] - b[1]) / 2, ez = (b[5] - b[2]) / 2;
  for (var j = 0; j < 3; j++) {
    var c = W[s + j] * cx + W[s + 4 + j] * cy + W[s + 8 + j] * cz + W[s + 12 + j], e = Math.abs(W[s + j]) * ex + Math.abs(W[s + 4 + j]) * ey + Math.abs(W[s + 8 + j]) * ez;
    var pad = 1e-3 + 1e-6 * (Math.abs(c) + e);
    if (c - e - pad < B[j]) B[j] = c - e - pad; if (c + e + pad > B[3 + j]) B[3 + j] = c + e + pad;
  }
}
/** 第 o 個 owner 這一格畫的每一樣東西的世界外框 ⇒ VV.B；算不出來（沒有格子、矩陣）⇒ false（當成看得到）。 */
function vvOwner(o, ow) {
  var R = RBAT, B = VV.B, L = VV.L, G = ow.grid, i, e, k;
  if (!G || !ow.M) return false;
  B[0] = B[1] = B[2] = Infinity; B[3] = B[4] = B[5] = -Infinity;
  L[0] = L[1] = L[2] = -1; L[3] = G.sx + 1; L[4] = G.sy + 1; L[5] = G.sz + 1;   // 船殼、平滑面（surface nets 的點在格子外擴一格以內）、玻璃
  vvUnionLb(L, ow.sb); vvUnionLb(L, ow.lines); vvUnionLb(L, ow.ropeT); vvUnionLb(L, ow.ll); vvUnionLb(L, ow.chain); vvUnionLb(L, ow.poleB); vvUnionLb(L, ow.bldLines); vvUnionLb(L, ow.roomLines);
  vvUnionXf(ow.M, 0, L);
  for (i = R.i0[o], e = R.i0[o + 1]; i < e; i++) { var me = R.mb[i]; if (me && me.bb) vvUnionXf(R.M, i * 16, me.bb); }   // 模型、裝飾、斷開的那一團的模型（平滑面的項目沒有 mb：在格子或裝甲的外框裡）
  if (ow.arm) for (k = 0; k < ow.arm.length; k++) {                      // 裝甲、砲塔、螺旋槳（掉了的螺旋槳照算：保守）
    var a = ow.arm[k], g = a.grid, AL = armLocal(a); if (!g) continue;
    L[0] = L[1] = L[2] = -1; L[3] = g.sx + 1; L[4] = g.sy + 1; L[5] = g.sz + 1;
    vvUnionXf(AL ? m4Into(VV.W, 0, ow.M, AL) : ow.M, 0, L);
  }
  return B[0] <= B[3];
}
// ── 船殼的合併緩衝（arena；S8）──
// 船型的船殼（T.pristine）、裝甲與螺旋槳（A.rs0）載入時一區一份 VBO（VoxelKit RegionSet，64³ 一區）；開戰的每艘 shareFrom 借用那幾份，被打到的區才自己建（own）。
//   以前每艘每一趟照 Map 一區一個 drawElements（光榮號 137 區）。現在第一次畫到時把那幾份 VBO 照 Map 的順序在 GPU 上接成一份（copyBufferSubData：位元組照抄），
//   每一趟把這艘活的 Map 切成一段一段：還在借用、在合併緩衝裡又接得上的那幾區 ⇒ 一次 drawElements；自己建的區照以前用它自己的 VAO。
//   同一支程式、同一組 uniform、同樣的頂點位元組、同樣的三角形順序（QIDX 是絕對索引：從第 q0 個四邊形的索引開始 ＝ 頂點 4·q0）⇒ 畫面不變。
// ⛔ 不改 VoxelKit：只讀公開的欄位（regions 的 vao／vbo／n／own、QIDX.buf／ensure）；flush 的頂點格式對不上 ⇒ 不建、照以前畫。
//   T.pristine、A.rs0 載入後不再 flush（每艘改的是自己那一份）⇒ 一型建一次；借用的區被 flush 換成 own（Map 裡位置不變）、清空的刪掉、重新長出來的排到最後 ⇒ 每一趟照活的 Map 切，不跨格留。
// 每型多一份 GPU 記憶體（光榮號約 5 MB；Tim 已同意）；?rbarena=0（或 ?rb=0）⇒ 照以前一區一區畫。
var RBAT_ARENA = RBAT_ON && Q.get('rbarena') !== '0';
var RBAT_AR = { fmt: -1, m: new Map(), A: null, s: 0, e: -1 };          // fmt：flush 的格式對不對（−1 還沒看）；m：rs0 → 合併緩衝（null ＝ 建不了）；A、s、e：這一趟正在接的那一段（第 s 到 e 個四邊形；e < 0 ＝ 沒有）
function rbatArenaFmt() {
  var H = RBAT_AR;
  if (H.fmt < 0) H.fmt = /vertexAttribIPointer\(\s*0\s*,\s*4\s*,\s*\w+\.UNSIGNED_SHORT\s*,\s*8\s*,\s*0\s*\)/.test(String(VK.RegionSet.prototype.flush)) ? 1 : 0;
  return H.fmt === 1;
}
/** rs0 的合併緩衝（第一次畫到才建）：{ vbo, vao, q：區的 VBO → 從第幾個四邊形起, n }；建不了 ⇒ null（之後照以前畫）。 */
function rbatArena(rs0) {
  var A = RBAT_AR.m.get(rs0);
  if (A !== undefined) return A;
  A = null;
  var n = 0, q = new Map(), ok = rbatArenaFmt();                         // 一型只走一次 ⇒ 下面的閉包無所謂
  rs0.regions.forEach(function (r) { if (r.own !== true || q.has(r.vbo)) ok = false; q.set(r.vbo, n); n += r.n; });
  if (ok && n > 0 && n === rs0.quads()) {
    QIDX.ensure(n);                                                       // 先加長（ensure 會解開現在綁的 VAO、重設同一個 buffer）⇒ 再建 VAO
    var vbo = gl.createBuffer(), vao = gl.createVertexArray();
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, vbo); gl.bufferData(gl.COPY_WRITE_BUFFER, n * 32, gl.STATIC_DRAW);   // 一個四邊形 4 頂點 × 8 bytes
    rs0.regions.forEach(function (r) { gl.bindBuffer(gl.COPY_READ_BUFFER, r.vbo); gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, q.get(r.vbo) * 32, r.n * 32); });
    gl.bindBuffer(gl.COPY_READ_BUFFER, null); gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);         // 格式照 VoxelKit flush 那一份
    gl.enableVertexAttribArray(0); gl.vertexAttribIPointer(0, 4, gl.UNSIGNED_SHORT, 8, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, QIDX.buf); gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null);
    A = { vbo: vbo, vao: vao, q: q, n: n };
    (RBAT.gl.ar || (RBAT.gl.ar = [])).push(A);
  }
  RBAT_AR.m.set(rs0, A);
  return A;
}
/** 畫一份 RegionSet（取代 rs.draw()：drawHulls 的船殼、armDraw 的裝甲與螺旋槳）；rs0 ＝ 它借用的那一份。畫完 VAO 解開（同 rs.draw）。 */
function rbatHull(rs, rs0) {
  var A = RBAT_ARENA && rs0 ? rbatArena(rs0) : null, H = RBAT_AR;
  if (!A) { rs.draw(); return; }
  H.A = A; H.e = -1;
  rs.regions.forEach(rbatHullR);                                          // ⛔ 每格不生閉包
  rbatHullEnd(); gl.bindVertexArray(null); H.A = null;
}
function rbatHullR(r) {                                                // 上一段畫掉那一步寫在這裡、不叫 rbatHullEnd：陰影那一趟的呼叫已經很深，再深一層量測工具就認不出是 render 裡畫的
  var H = RBAT_AR, q = r.own ? undefined : H.A.q.get(r.vbo);
  if (q !== undefined && q === H.e) { H.e += r.n; return; }             // 借用、又接在上一段後面 ⇒ 併進去
  if (H.e >= 0) { gl.bindVertexArray(H.A.vao); gl.drawElements(gl.TRIANGLES, (H.e - H.s) * 6, gl.UNSIGNED_INT, H.s * 24); H.e = -1; }
  if (q !== undefined) { H.s = q; H.e = q + r.n; return; }
  gl.bindVertexArray(r.vao); gl.drawElements(gl.TRIANGLES, r.n * 6, gl.UNSIGNED_INT, 0);   // 自己建的區（被打到過）：照以前
}
function rbatHullEnd() {
  var H = RBAT_AR; if (H.e < 0) return;
  gl.bindVertexArray(H.A.vao); gl.drawElements(gl.TRIANGLES, (H.e - H.s) * 6, gl.UNSIGNED_INT, H.s * 24); H.e = -1;   // 一個四邊形 6 個索引 × 4 bytes
}
/** 除錯：每份合併緩衝跟它抄的那幾份 VBO 逐位元組比（getBufferSubData）⇒ { arenas, regions, quads, miss }。 */
function rbatArenaCheck() {
  var out = { arenas: 0, regions: 0, quads: 0, miss: 0 };
  RBAT_AR.m.forEach(function (A, rs0) {
    if (!A) return; out.arenas++;
    var all = new Uint8Array(A.n * 32);
    gl.bindBuffer(gl.COPY_READ_BUFFER, A.vbo); gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, all);
    rs0.regions.forEach(function (r) {
      var one = new Uint8Array(r.n * 32), o = A.q.get(r.vbo) * 32;
      gl.bindBuffer(gl.COPY_READ_BUFFER, r.vbo); gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, one);
      for (var j = 0; j < one.length; j++) if (one[j] !== all[o + j]) { out.miss++; break; }
      out.regions++; out.quads += r.n;
    });
  });
  gl.bindBuffer(gl.COPY_READ_BUFFER, null);
  return out;
}
/** ?rbchk=1：照以前 drawModels／smDraw／armSmDraw 的迴圈與算式（每個矩陣重新乘一次）再走一遍，跟表逐項比：
 *  同一個東西、同一個順序、VAO／頂點數／uGlow 一樣（不一樣 ⇒ itemMiss）；矩陣 16 個 float 逐位元相同（不一樣 ⇒ matMiss）。只在 render() 裡、整理完馬上比（之後 renderLerp 會把 sh.M 換回去）。 */
function rbatCheck() {
  var R = RBAT, S = R.stat, q = 0, A = R.M && new Uint32Array(R.M.buffer), o;   // R.M：第一個項目才配（主選單、還沒有船 ⇒ null，下面也不會讀到）
  function one(c, ow, ref, me, glow, W, off) {
    if (q >= R.ni) { S.itemMiss++; q++; return; }
    if (R.cls[q] !== c || R.ow[q] !== ow || R.ref[q] !== ref || R.vao[q] !== me.vao || R.off[q] !== (off || 0) || R.cnt[q] !== me.n || R.glow[q] !== glow) S.itemMiss++;
    var w = W instanceof Float32Array ? W : new Float32Array(W), B = new Uint32Array(w.buffer, w.byteOffset, 16);
    for (var j = 0; j < 16; j++) if (A[q * 16 + j] !== B[j]) { S.matMiss++; break; }
    S.chk++; q++;
  }
  function sm(c, ow, ref, mp, W) {                                      // 平滑面：照以前一區一項，合併緩衝裡接得上的併成一項（同 rbatSmAdd，獨立再算一次）
    var p = null;
    mp.forEach(function (m) {
      var io = m.io || 0;
      if (p && m.sa && p.vao === m.vao && p.off + p.n * 4 === io) { p.n += m.n; return; }
      if (p) one(c, ow, ref, p, 0, W, p.off);
      p = { vao: m.vao, n: m.n, off: io };
    });
    if (p) one(c, ow, ref, p, 0, W, p.off);
  }
  SHIPS.forEach(function (sh, i) {
    if (sh.sink > 40) return;
    sh.models.forEach(function (m) {
      var me = sh.T.meshes[m.mesh]; if (!m.alive || !me || (m.vox && !m.moved)) return;
      var dv = m.ancD || m.vsl;
      one(0, i, m, me, isLamp(m) ? lanternK(m) : 0, M4.mul(sh.M, dv ? M4.mul(trans(dv[0], dv[1], dv[2]), meshDtM(me, modelLocal(m))) : meshDtM(me, modelLocal(m))));
    });
    (sh.decos || []).forEach(function (d) {
      var me = sh.T.meshes[d.mesh]; if (!me || d.gone || (!GFX.deco && d.meta.kind !== 'portlid') || (d.foot >= 0 && !hullGp(sh.grid, d.foot))) return;
      one(1, i, d, me, isLamp(d) ? lanternK(d) : 0, M4.mul(sh.M, meshDtM(me, d.L || trans(d.origin[0], d.origin[1], d.origin[2]))));
    });
    if (sh.smR && sh.smR.size) sm(2, i, sh, sh.smR, sh.M);
    if (sh.arm) sh.arm.forEach(function (a) { if (a.smR && a.smR.size && !(a.prop && propGone(a))) sm(3, i, a, a.smR, armM(a)); });
  });
  PIECES.forEach(function (pc, j) { (pc.mods || []).forEach(function (m) { var me = pc.T.meshes[m.mesh]; if (me) one(4, R.ns + j, m, me, 0, M4.mul(pc.M, meshDtM(me, m.L))); }); });
  FLY.forEach(function (f) { var me = f.T.meshes[f.mesh]; if (me && f.M) one(5, -1, f, me, 0, meshDtM(me, f.M)); });
  if (q !== R.ni) S.itemMiss++;
  for (o = 0; o <= R.n; o++) if (R.i0[o] > (o < R.n ? R.i0[o + 1] : R.ni)) S.itemMiss++;   // 每個 owner 的範圍接得起來
}
// ── 一次畫多個的程式對拍（render 管線大修 S4；?debug=1 才有 window.__rbatProbe，量測工具每一組最後叫一次；S5–S7 用 P.triI／P.dtriI 之前的閘門）──
// P.triI／P.dtriI 只差「uModel 從 uMs[gl_InstanceID] 讀」（01_gl.js instVS）；GLSL 不保證動態索引編出一樣的算式 ⇒ 量，不猜：
//   兩對各連一份轉換回饋（transform feedback）的分身 —— 同一串原始碼（TRI_VS＋TRI_FS 抓 gl_Position、vW、vN、vC、vM；DTRI_VS＋只寫深度 抓 gl_Position），
//   光柵化關掉（RASTERIZER_DISCARD）、照 POINTS 畫 ⇒ 每個頂點進去一次、出來一筆。這一格表裡的每一項：舊的 uModel＋drawArrays、新的 uMs＋drawArraysInstanced，
//   抓出來的照 Uint32 逐一比 ⇒ 每支 { items, verts, mismatch（不一樣的頂點數）, maxUlp }（量測工具：mismatch > 0 ⇒ 不過）。
//   排法 ＝ 之後真的一次畫多個的排法：同一個 VAO 的項目照表的順序放進 uMs 的第 0、1、2…格，滿 INST_K 個換下一批（0..K−1 輪著用）；舊的照同一個順序一個一個畫。
//   頂點數：模型、裝飾、斷開的那一團、FLY ＝ me.n；平滑面 ＝ 那一區的頂點（m.verts；共用的那一份 smShare 沒抄 ⇒ 照緩衝的大小 ÷ 44 bytes）。
//   分身是另外連的一份 ⇒ 很強的證據、不是證明；最後照量測工具的畫面（無 MSAA 逐像素）。只在量測那台（ANGLE D3D11、RTX 2060）證過，別的後端要再跑一次。
//   動到的 GL 狀態（程式、VAO、轉換回饋、ARRAY_BUFFER、RASTERIZER_DISCARD、畫的 framebuffer、第 3 號屬性的常數）跑完照原樣放回去；⛔ 不寫模擬、不改表。
/** 轉換回饋的分身：同一串原始碼、連結前指定要抓的輸出（照順序接在一起）；連不起來 ⇒ null。uniform 照 VK.compile 收（setCommon 照樣能給）。 */
function rbatTfLink(vs, fs, vary) {
  var p = gl.createProgram(), u = {}, i, n, S = [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].map(function (a) { var s = gl.createShader(a[0]); gl.shaderSource(s, a[1]); gl.compileShader(s); gl.attachShader(p, s); return s; });
  gl.transformFeedbackVaryings(p, vary, gl.INTERLEAVED_ATTRIBS); gl.linkProgram(p);
  S.forEach(function (s) { gl.deleteShader(s); });                     // 連完才放（還掛在程式上 ⇒ 程式放掉時一起放）
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { gl.deleteProgram(p); return null; }
  for (i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) { var a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, a.name); }
  return { prog: p, u: u };
}
/** 一對分身（L 舊的、I 一次畫多個的），w ＝ 一個頂點抓幾個 float。抓不到 gl_Position（有的驅動不給）⇒ 只抓其他的（vW 一樣 ＋ 同一個 uVP ⇒ gl_Position 一樣），pos ＝ false。 */
function rbatTfPair(vs, fs, vary) {
  var o = { pos: true, L: rbatTfLink(vs, fs, vary), I: null, w: 0 };
  if (!o.L && vary.length > 1) { o.pos = false; vary = vary.slice(1); o.L = rbatTfLink(vs, fs, vary); }
  if (o.L) o.I = rbatTfLink(instVS(vs), fs, vary);
  if (!o.L || !o.I) throw new Error('__rbatProbe：轉換回饋的分身連不起來（' + vary.join(',') + '）');
  vary.forEach(function (v) { o.w += v === 'gl_Position' ? 4 : 3; });
  o.L.w = o.I.w = o.w; return o;
}
/** 第 i 項（平滑面）那一區的頂點數；表是上一次 render() 的、那一區已經換掉（重建、smFree）⇒ 0（不比）。RG：Map ⇒ 照順序的陣列（同一份 Map 只轉一次）。 */
function rbatPbVerts(i, RG) {
  var R = RBAT, mp = R.ref[i] && R.ref[i].smR, a = mp && RG.get(mp), m;
  if (mp && !a) RG.set(mp, a = Array.from(mp.values()));
  m = a && a[R.slot[i]]; if (!m || m.vao !== R.vao[i]) return 0;
  if (m.sa) return m.sa.verts;                                          // 合併緩衝（15_smooth.js smArena）：POINTS 從 0 畫 ⇒ 整份的頂點
  if (m.verts) return m.verts;
  gl.bindBuffer(gl.ARRAY_BUFFER, m.vb); return gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE) / 44;   // 一個頂點 11 個 float（15_smooth.js smBuild）
}
/** 一段轉換回饋：T 這支分身把 C[c0..c1) 每一批畫一次（inst ⇒ uMs＋一次畫多個；不然 uModel 一個一個），抓到的讀進 dst ⇒ 回讀了幾個 Uint32。neg ⇒ 第一批第一個矩陣差 1 個 ULP（反向：要抓得到）。 */
function rbatPbRun(T, inst, C, c0, c1, dst, neg) {
  var R = RBAT, M = R.M, pal = R.pal, u = T.u, n = 0, c, j, q, b, s;
  gl.useProgram(T.prog); setCommon(T);                                 // uVP 兩邊一樣（PASS.vp || CAM.vp）；取樣器照 setCommon 放第 4、8 號（⛔ 都在第 0 號 ⇒ 兩種取樣器同一號，畫不出來）
  gl.beginTransformFeedback(gl.POINTS);
  for (c = c0; c < c1; c++) {
    b = C[c]; gl.bindVertexArray(b.vao);
    if (inst) {
      for (j = 0; j < b.it.length; j++) for (q = 0, s = b.it[j] * 16; q < 16; q++) pal[j * 16 + q] = M[s + q];
      if (neg && c === c0) new Uint32Array(pal.buffer, 48, 1)[0] ^= 1;   // 平移 x 的最後一位
      gl.uniformMatrix4fv(u.uMs, false, pal, 0, 16 * b.it.length); gl.drawArraysInstanced(gl.POINTS, 0, b.nv, b.it.length);
    } else for (j = 0; j < b.it.length; j++) { gl.uniformMatrix4fv(u.uModel, false, M, b.it[j] * 16, 16); gl.drawArrays(gl.POINTS, 0, b.nv); }
    n += b.nv * b.it.length;
  }
  gl.endTransformFeedback();
  var e = gl.getError(); if (e) throw new Error('__rbatProbe：GL 錯誤 0x' + e.toString(16) + '（' + (inst ? '一次畫多個' : '舊的') + '那一段）');   // ⛔ 沒畫成 ⇒ 緩衝裡是上一段的，比起來會「一樣」
  gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, dst, 0, n * T.w);
  return n * T.w;
}
/** 比兩段抓到的（nw 個 Uint32，一個頂點 w 個）：不一樣的頂點數、最大差幾個 ULP（照 float 的順序把位元換成整數再相減）累加進 r。 */
function rbatPbCmp(A, B, nw, w, r) {
  for (var j = 0, v = -1; j < nw; j++) {
    var a = A[j], b = B[j]; if (a === b) continue;
    if ((j / w | 0) !== v) { v = j / w | 0; r.mismatch++; }
    var d = Math.abs((a & 0x80000000 ? -(a & 0x7fffffff) : a) - (b & 0x80000000 ? -(b & 0x7fffffff) : b)); if (d > r.maxUlp) r.maxUlp = d;
  }
}
/** window.__rbatProbe(neg)：這一格的表（上一次 render() 整理的）全部比一次（見上）。 */
function rbatProbe(neg) {
  var R = RBAT, out = { K: INST_K, items: 0, stale: 0, err0: 0, triI: null, dtriI: null };
  if (!R.ni) return out;
  var s0 = { prog: gl.getParameter(gl.CURRENT_PROGRAM), vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING), tf: gl.getParameter(gl.TRANSFORM_FEEDBACK_BINDING),
    tfb: gl.getParameter(gl.TRANSFORM_FEEDBACK_BUFFER_BINDING), ab: gl.getParameter(gl.ARRAY_BUFFER_BINDING), fb: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),
    rd: gl.isEnabled(gl.RASTERIZER_DISCARD), a3: gl.getVertexAttrib(3, gl.CURRENT_VERTEX_ATTRIB) }, pb = null, i;
  out.err0 = gl.getError();                                            // 之前留下的錯（清掉 ⇒ 下面每一段才判得準；遊戲本身不讀 getError）
  try {
    // 一批一批：同一個 VAO、照表的順序，滿 INST_K 個換下一批；C ＝ 每一批照第一次出現的順序
    var G = new Map(), RG = new Map(), C = [], big = 0, sl = 0;
    for (i = 0; i < R.ni; i++) {
      var c = R.cls[i], vao = R.vao[i], nv = c === 2 || c === 3 ? rbatPbVerts(i, RG) : R.cnt[i], L = G.get(vao), b = L && L[L.length - 1];
      if (!nv || !gl.isVertexArray(vao) || (b && b.nv !== nv)) { out.stale++; continue; }
      if (!b || b.it.length === INST_K) { if (!L) G.set(vao, L = []); L.push(b = { vao: vao, nv: nv, it: [] }); C.push(b); }
      b.it.push(i); out.items++; big = Math.max(big, b.it.length * nv); sl = Math.max(sl, b.it.length);
    }
    pb = R.gl.pb || (R.gl.pb = { tri: rbatTfPair(TRI_VS, TRI_FS, ['gl_Position', 'vW', 'vN', 'vC', 'vM']), dtri: rbatTfPair(DTRI_VS, DEPTH_ONLY_FS, ['gl_Position']),   // DEPTH_ONLY_FS ＝ programs() 的 NOFS（同一串）
      tf: gl.createTransformFeedback(), buf: gl.createBuffer(), cap: 0, A: null, B: null, on: false });
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, pb.tf); gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, pb.buf); pb.on = true;
    var cap = Math.max(big, 1 << 18) * pb.tri.w;                         // 一個緩衝：最大的一批放得下、小的湊一段（少讀回幾次）
    if (pb.cap < cap) { gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, cap * 4, gl.DYNAMIC_COPY); pb.A = new Uint32Array(cap); pb.B = new Uint32Array(cap); pb.cap = cap; }
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null); gl.enable(gl.RASTERIZER_DISCARD); gl.vertexAttrib2f(3, 0, 0.5);   // aM 常數照 rbatReplay（模型的 VAO 沒開第 3 號）
    [['triI', P.triI, pb.tri], ['dtriI', P.dtriI, pb.dtri]].forEach(function (x) {
      var T = x[2], r = out[x[0]] = { linked: !!x[1], pos: T.pos, items: out.items, verts: 0, mismatch: 0, maxUlp: 0, slots: sl }, per = Math.floor(pb.cap / T.w), c0 = 0, c1, n;
      while (c0 < C.length) {
        for (c1 = c0, n = 0; c1 < C.length && (c1 === c0 || n + C[c1].nv * C[c1].it.length <= per); c1++) n += C[c1].nv * C[c1].it.length;
        var nw = rbatPbRun(T.L, false, C, c0, c1, pb.A);
        if (rbatPbRun(T.I, true, C, c0, c1, pb.B, neg && !c0) !== nw) throw new Error('__rbatProbe：兩段抓的數量不一樣');
        rbatPbCmp(pb.A, pb.B, nw, T.w, r); r.verts += n; c0 = c1;
      }
    });
  } finally {
    if (gl.getParameter(gl.TRANSFORM_FEEDBACK_ACTIVE)) gl.endTransformFeedback();
    if (pb && pb.on) { gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null); pb.on = false; }
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, s0.tf); gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, s0.tfb);
    if (!s0.rd) gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, s0.fb); gl.bindBuffer(gl.ARRAY_BUFFER, s0.ab); gl.bindVertexArray(s0.vao); gl.useProgram(s0.prog);
    if (s0.a3 instanceof Float32Array) gl.vertexAttrib4fv(3, s0.a3);
  }
  return out;
}
// 除錯（?debug=1）：__rbat.stat 讀數；__rbat.check() ＝ 畫一格、那一格整理完就對拍（回 stat）；__rbatProbe() ＝ 一次畫多個的程式對拍（見上）
//   __rbat.cull(v)：鏡頭外的船不畫 開／關（不給 ⇒ 只回現在的；量測工具 cullsweep 同一頁開關逐格比）；__rbat.rt() ＝ 畫面的 framebuffer（RT：讀反射圖 RT.R）
if (DEBUG) window.__rbat = { stat: RBAT.stat, tab: RBAT, check: function () { var c = RBAT_CHK; RBAT_CHK = true; try { render(); } finally { RBAT_CHK = c; } return RBAT.stat; }, arenaCheck: rbatArenaCheck,
  cull: function (v) { if (v !== undefined) RBAT.cull = !!v; return RBAT.cull; }, rt: function () { return RT; } };
if (DEBUG) window.__rbatProbe = rbatProbe;
