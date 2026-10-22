// ───────────────────────── 3D 雨滴（暴風雨 × 畫質的「雨滴（3D）」） ─────────────────────────
// Tim 2026-10-13：暴風雨的雨放進 3D 空間（平面的雨絲，不做立體的水滴）；畫質「高」用它取代整個畫面一層的雨（01_gl.js P.rain），
//   而且是畫質設定裡獨立的一項 ⇒ 自訂也能單獨開關（兩種一起開也行）。
// 雨滴住在鏡頭前方一個直立的圓柱裡：圓心 ＝ 鏡頭往看的方向水平推 RD_R × 0.6、半徑 RD_R、從海面到鏡頭上方 RD_TOP 公尺。
//   落速 RD_VY ×（0.88–1.12）＋ 風（風向 × 現在的風速 × RD_WK —— 照風速全斜，暴風雨的風會把雨絲吹到快躺平）；畫成沿速度方向的一條線（長 ＝ 速度 × RD_STREAK 秒）。
//   Tim 2026-10-13：雨絲拉長、落快一點 ⇒ 落速 9 → 15 m/s（比真的雨快：畫面上才看得出是雨）、線長 0.4 → 約 1 m。
//   跑出圓柱（鏡頭移走）⇒ 在圓柱裡重撒；落到海面（seaH）或打到船（格子有東西）⇒ 從頂上重生，鏡頭 30 m 內冒一個小水花（點精靈，RD_SPL 秒；畫質的「雨滴水花」可關）。
//   鏡頭 1.5 m 內與圓柱邊上的淡掉（太近的雨絲會橫過整個畫面、邊上的一進一出會閃）；遠的照霧。
// 每一格畫面走一次（90_main.js frame，畫面的 dt）；停格、說明打開時不動；縮圖（?still=1）不動 ⇒ 同一格畫面。
// 數量：少／中／多 ＝ RD_N（Tim 2026-10-13：原本 3000／6000／12000 太密 ⇒ 減半）。12000 滴量過：每一格走 0.95 ms、填緩衝＋畫 0.87 ms。
// ⛔ 只給人看：自己的亂數 rndR、不碰模擬的狀態（step() 讀不到）⇒ 開關不改戰局。
var RD_N = [0, 1500, 3000, 6000], RD_R = 45, RD_TOP = 28, RD_VY = 15, RD_WK = 0.35, RD_STREAK = 0.07, RD_SPL = 0.22, RS_MAX = 900;
var RD = { n: 0, p: null, k: null, c: [0, 0], top: 30, bot: -1, hi: 8, v: [0, -RD_VY, 0], buf: null, vao: null, vbo: null, drawn: 0 };   // bot／hi：圓柱的底、低於它才查落海（大漩渦照漏斗的水面，見 stepRain）
var RS = { n: 0, p: new Float32Array(RS_MAX * 3), life: new Float32Array(RS_MAX) }, RD_STAT = { hitSea: 0, hitShip: 0 };
PBUF = new Float32Array(PBUF.length + RS_MAX * 9);          // 點精靈的緩衝多留雨的水花（60_render.js 一起畫）
var RNG_R = rngMake('rain', 0x51ED270B, true), rndR = RNG_R.f;          // 雨：固定種子（不跟 SEED；只給人看），開局照樣重設（00_core.js 亂數工廠）
function rdCount() { return WX.rain > 0 ? RD_N[GFX.drops] || 0 : 0; }
function rdGL() {
  P.drop = VK.compile(gl,
    '#version 300 es\nlayout(location=0) in vec3 aP; layout(location=1) in float aA; uniform mat4 uVP; uniform vec3 uEye; out float vA; out float vD;\n' +
    'void main(){ vA=aA; vD=length(aP-uEye); gl_Position=uVP*vec4(aP,1.0); }\n',
    '#version 300 es\nprecision highp float; in float vA; in float vD; uniform vec3 uCol,uFog; uniform float uFogD; out vec4 o;\n' +
    'void main(){ o=vec4(mix(uCol,uFog,1.0-exp(-vD*uFogD)),vA); }\n');
  RD.vao = gl.createVertexArray(); gl.bindVertexArray(RD.vao); RD.vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, RD.vbo);
  RD.buf = new Float32Array(RD_N[RD_N.length - 1] * 8); gl.bufferData(gl.ARRAY_BUFFER, RD.buf.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12);
  gl.bindVertexArray(null);
}
/** 第 i 滴撒在圓柱裡：top ⇒ 從頂上（剛落海、打到船的），否則整段高度隨便一處（開始下雨、鏡頭移走）。 */
function rdSpawn(i, top) {
  var a = rndR() * 6.2832, r = RD_R * Math.sqrt(rndR()), o = i * 3;
  RD.p[o] = RD.c[0] + Math.cos(a) * r; RD.p[o + 2] = RD.c[1] + Math.sin(a) * r;
  RD.p[o + 1] = top ? RD.top - rndR() * 3 : RD.bot + rndR() * (RD.top - RD.bot); RD.k[i] = 0.88 + 0.24 * rndR();
}
function rdSplash(x, y, z) {
  if (!GFX.dropspl) return;
  var e = CAM.eye; if ((x - e[0]) * (x - e[0]) + (z - e[2]) * (z - e[2]) > 900) return;
  var i = RS.n < RS_MAX ? RS.n++ : (rndR() * RS_MAX) | 0;
  RS.p[i * 3] = x; RS.p[i * 3 + 1] = y; RS.p[i * 3 + 2] = z; RS.life[i] = RD_SPL;
}
/** 每一格畫面（停格、縮圖不走）：雨滴往下落、跟著風斜；圓柱跟著鏡頭。 */
function stepRain(dt) {
  var N = rdCount(), i;
  if (!N) { RD.n = RS.n = 0; return; }
  if (!RD.p || RD.p.length < N * 3) { RD.p = new Float32Array(N * 3); RD.k = new Float32Array(N); RD.n = 0; }
  var e = CAM.eye, l = CAM.look || CAM.tgt, dx = l[0] - e[0], dz = l[2] - e[2], dl = Math.hypot(dx, dz) || 1;
  RD.c = [e[0] + dx / dl * RD_R * 0.6, e[2] + dz / dl * RD_R * 0.6];
  // 大漩渦（TASK-0683；Tim 2026-10-22：「大漩渦內(海平面下的漩渦表面) 雨會消失」）：圓柱的底、頂、查落海的高度照圓柱那一帶漏斗的水面（vxH 往外越高 ⇒ 底取內側、門檻取外側）。
  //   ⛔ 照海面 0 ⇒ 鏡頭在 −200 m 的漏斗裡，雨還下在 −1～36 m，整片在頭頂兩百公尺的霧裡。沒有漩渦 ⇒ 底 −1、門檻 8、頂 max(鏡頭, 8) ＋ RD_TOP（跟以前一樣）。
  var wc = 0; RD.bot = -1; RD.hi = 8;
  if (VX) { var rc = Math.hypot(RD.c[0], RD.c[1]), ux = rc > 1e-3 ? RD.c[0] / rc : 1, uz = rc > 1e-3 ? RD.c[1] / rc : 0, rl = Math.max(0, rc - RD_R), rh = rc + RD_R;
    wc = vxH(RD.c[0], RD.c[1]); RD.bot = vxH(ux * rl, uz * rl) - 1; RD.hi = vxH(ux * rh, uz * rh) + 8; RD.wb = seaBound() + 0.5; }
  RD.top = Math.max(e[1], wc + 8) + RD_TOP;
  if (RD.n !== N) { RD.n = N; for (i = 0; i < N; i++) rdSpawn(i, false); }
  var wl = Math.hypot(WIND[0], WIND[2]) || 1, ws = windKnots() / 1.944 * RD_WK, vx = WIND[0] / wl * ws, vz = WIND[2] / wl * ws, R2 = RD_R * RD_R, p = RD.p, cx = RD.c[0], cz = RD.c[1];
  RD.v = [vx, -RD_VY, vz];
  for (i = 0; i < N; i++) {
    var o = i * 3, k = RD.k[i] * dt, x = p[o] + vx * k, y = p[o + 1] - RD_VY * k, z = p[o + 2] + vz * k;
    if ((x - cx) * (x - cx) + (z - cz) * (z - cz) > R2) { rdSpawn(i, false); continue; }
    if (y < RD.hi && (!VX || y < vxH(x, z) + RD.wb)) { var sea = seaH(x, z, SIMT);   // 大漩渦：先拿漏斗的水面＋浪的上限篩（便宜），還在上面就不算整片浪（⛔ 不篩 ⇒ 漏斗裡每滴每格都算，3.0 ms 對暴風雨 0.8 ms）
      if (y < sea) { rdSplash(x, sea, z); RD_STAT.hitSea++; rdSpawn(i, true); continue; } }
    var hit = false;
    for (var s = 0; s < SHIPS.length && !hit; s++) {
      var sh = SHIPS[s], cc = sh.center; if (!cc || (x - cc[0]) * (x - cc[0]) + (y - cc[1]) * (y - cc[1]) + (z - cc[2]) * (z - cc[2]) > sh.rad2) continue;
      var L = M4.pt(sh.inv, x, y, z); if (sh.grid.get(L[0] | 0, L[1] | 0, L[2] | 0)) hit = true;
    }
    if (hit) { rdSplash(x, y, z); RD_STAT.hitShip++; rdSpawn(i, true); continue; }
    p[o] = x; p[o + 1] = y; p[o + 2] = z;
  }
  if (!GFX.dropspl) RS.n = 0;
  for (i = 0; i < RS.n; i++) if ((RS.life[i] -= dt) <= 0) { var j = --RS.n; RS.p.copyWithin(i * 3, j * 3, j * 3 + 3); RS.life[i] = RS.life[j]; i--; }
}
/** 水花（60_render.js 的點精靈那一批）：一個淡白的小圓點，冒一下就散。 */
function rdPushSplash(pushPt) {
  if (!RD.n) return;
  for (var i = 0; i < RS.n; i++) { var f = RS.life[i] / RD_SPL; pushPt([RS.p[i * 3], RS.p[i * 3 + 1] + (1 - f) * 0.2, RS.p[i * 3 + 2]], 0.12 + 0.22 * (1 - f), [0.86, 0.9, 0.95], 0.5 * f); }
}
/** 雨絲（60_render.js，點精靈之後、整個畫面那一層雨之前）：做深度測試（船擋得住）、不寫深度、半透明。顏色照天色（閃電時跟著亮）。 */
function rdDraw() {
  var N = RD.n; if (!N) { RD.drawn = 0; return; }
  var b = RD.buf, p = RD.p, e = CAM.eye, v = RD.v, cx = RD.c[0], cz = RD.c[1], m = 0;
  for (var i = 0; i < N; i++) {
    var o = i * 3, x = p[o], y = p[o + 1], z = p[o + 2], d = Math.hypot(x - e[0], y - e[1], z - e[2]);
    var a = 0.34 * Math.min(1, (d - 1.5) / 3) * Math.min(1, (RD_R - Math.hypot(x - cx, z - cz)) / 6); if (a <= 0) continue;
    var t = RD_STREAK * RD.k[i], q = m * 8;
    b[q] = x; b[q + 1] = y; b[q + 2] = z; b[q + 3] = a; b[q + 4] = x - v[0] * t; b[q + 5] = y - v[1] * t; b[q + 6] = z - v[2] * t; b[q + 7] = a * 0.35; m++;
  }
  RD.drawn = m; if (!m) return;
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
  gl.useProgram(P.drop.prog); setCommon(P.drop); var c = lerp3(SKY, [0.82, 0.86, 0.9], 0.55); gl.uniform3f(P.drop.u.uCol, c[0], c[1], c[2]);
  gl.bindVertexArray(RD.vao); gl.bindBuffer(gl.ARRAY_BUFFER, RD.vbo); gl.bufferSubData(gl.ARRAY_BUFFER, 0, b, 0, m * 8);
  gl.drawArrays(gl.LINES, 0, m * 2); gl.depthMask(true);
}
