// ───────────────────────── 剖面與隱藏甲板（觀察模式；Tim 2026-10-13） ─────────────────────────
// 停格條多兩個：✂ 剖面（Z）＝ 船剖成兩半、拿掉靠鏡頭那一半（鏡頭繞過中線就換邊）；☰ 甲板（L）＝ 由上往下一層一層拿掉，
//   拿到只剩船底再按 ⇒ 全部回來（Loop）。兩個可以一起開。繼續（P）⇒ 都保持（跟透視一樣，2026-10-15）；
//   Z、L 不停格也能按（Tim 2026-10-16）⇒ 廣播一行、開著的寫在下方觀察條（72_floodui.js obsNote／obsText）。
// 甲板的切高照舷弧逐欄（x）量（deckCut）：船中段兩旁（中線 ±6、±14 格）站得住的高度出現得夠多 ⇒ 一層，再往船頭船尾一欄一欄跟著走（高低差 4 格內）；
//   拿掉第 k 層 ＝ 那層的地板與底下的樑以上都不畫。最下面那層（船底）不拿。
// 開著時：陰影關掉（拿掉的甲板不該再擋光：剖面圖要看得清楚）；剖面另外不畫船附近的海面與白沫（跟透視一樣，再往鏡頭那一側多拿 XR_CUT ⇒ 從側面看得到水線下）。
//   只拿掉甲板 ⇒ 海照畫（船殼裡的海本來就有遮罩；⛔ 也拿 ⇒ 船邊一圈白色的長方形）。
// 只動畫面：船殼、模型、繩、帆照格座標在著色器裡丟掉（01_gl.js CUT_GLSL）；人：站的那一點在拿掉的那一邊就不畫；碎片、粒子、斷開的那幾團不剖。
var CUTV = { half: false, deck: 0 }, CUT_NAMES = ['住艙甲板', '底艙甲板'], XR_CUT = 300;   // XR_CUT：剖面時海面往鏡頭那一側多拿掉幾格（30 m；60_render.js）
function cutOn() { return CUTV.half || CUTV.deck > 0; }
/** 船型的甲板切高（記在 T 上）：{ W, n（拿得掉的層數）, names, rows（第 k 層的切高，逐欄）, tex（R32F，寬 W、高 n） }。 */
function deckCut(sh) {
  var T = sh.T; if (T.cutD) return T.cutD;
  if (hullDecks(T).length) return T.cutD = deckCutMeta(T);               // 有甲板 meta（35_decks.js）⇒ 照 meta；沒有 ⇒ 底下照舊量（舊匯出的退路）
  var g = T.base, CY = T.cy, W = g.sx, x, z;
  // 往上找到哪：水線上 12 m 與最低那個桅頂平台下 1 m 取低的（⛔ 只到最上層砲甲板 ⇒ 餘燼號的露天甲板、船尾樓上面沒有砲，一按 L 就跳到上層砲甲板；Tim 2026-10-14）
  var top = Math.min(g.sz - 12, T.zw + 120); (T.masts || []).forEach(function (m) { if (m.z0top) top = Math.min(top, m.z0top - 10); });
  var zMax = Math.max(sh.decks.length ? sh.decks[sh.decks.length - 1].zr[1] + 3 : 0, top);
  var FL = [];                                                            // 每一欄站得住的高度（腳下實心、頭上 1 m 空）
  for (x = 0; x < W; x++) {
    var zs = [];
    if (x >= T.hx0 && x <= T.hx1) [-14, -6, 6, 14].forEach(function (dy) {
      var y = CY + dy;
      for (var z = 2; z <= zMax; z++) { if (!g.get(x, y, z - 1) || g.get(x, y, z)) continue; var h = 1; while (h < 10 && !g.get(x, y, z + h)) h++; if (h === 10 && zs.indexOf(z) < 0) zs.push(z); }
    });
    FL.push(zs);
  }
  // 每個高度出現幾欄：整條船身（頭尾各去一成）每 2 欄一數。⛔ 只數船中段 ±30 欄 ⇒ 餘燼號船腰是開的（中央彈藥庫上方），露天甲板與下層砲甲板量不到、按 L 直接跳到上層砲甲板（Tim 2026-10-14）
  var xm = Math.round((T.wl0 + T.wl1) / 2), cnt = {}, ns = 0, xa = Math.round(T.hx0 + (T.hx1 - T.hx0) * 0.1), xb = Math.round(T.hx1 - (T.hx1 - T.hx0) * 0.1);
  for (x = xa; x <= xb; x += 2) { ns++; FL[x].forEach(function (z) { cnt[z] = (cnt[z] || 0) + 1; }); }
  var seeds = [];                                                         // 相差 4 格內併成一層（取出現最多的那個高度），出現在兩成五的欄以上才算
  Object.keys(cnt).map(Number).sort(function (a, b) { return b - a; }).forEach(function (z) {
    var s = seeds[seeds.length - 1];
    if (s && Math.abs(s.z - z) <= 4) { s.n += cnt[z]; s.z1 = z; if (cnt[z] > s.best) { s.best = cnt[z]; s.z = z; } } else seeds.push({ z: z, z1: z, n: cnt[z], best: cnt[z] });   // 跟這一層出現最多的那個高度比（⛔ 跟上一個比 ⇒ 砲架、台階的高度一格一格接起來，整條船身數下來上甲板與上層砲甲板被併成一層）
  });
  seeds = seeds.filter(function (s) { return s.n >= ns * 0.2; });
  var prof = seeds.map(function (s) {                                     // 從離船中最近、量得到這一層的那一欄出發，往船頭、船尾一欄一欄跟著走（找不到 ⇒ 照上一欄的高度延伸）
    var Z = new Float32Array(W).fill(s.z), xs = xm;
    for (var d = 0; d < W; d++) { if ([xm + d, xm - d].some(function (x) { return x >= 0 && x < W && FL[x].some(function (z) { return Math.abs(z - s.z) <= 1; }) && (xs = x, true); })) break; }
    s.xs = xs;
    [1, -1].forEach(function (dir) {
      var cur = s.z;
      for (var x = xs; x >= 0 && x < W; x += dir) {
        var best = null; FL[x].forEach(function (z) { if (Math.abs(z - cur) <= 4 && (best === null || Math.abs(z - cur) < Math.abs(best - cur))) best = z; });
        if (best !== null) cur = best;
        Z[x] = cur;
      }
    });
    return Z;
  });
  var n = Math.max(0, prof.length - 1), rows = [], names = [], low = sh.decks.length ? sh.decks[0].zr[0] : 1e9, below = 0;
  for (var k = 0; k < n; k++) {
    var Z = prof[k], runs = [];                                           // 地板＋底下的樑有多厚：船中段兩旁往下數連續的實心格，取九成的那個（最多 6 格；不切到下一層頭頂 1.2 m）
    for (x = T.hx0; x <= T.hx1; x += 2) [-20, -10, 10, 20].forEach(function (dy) { var y = CY + dy, r = 0; while (r < 8 && g.get(x, y, Z[x] - 1 - r)) r++; if (r) runs.push(r); });
    runs.sort(function (a, b) { return a - b; });
    var dep = Math.min(6, runs.length ? runs[Math.floor(runs.length * 0.9)] : 1), R = new Float32Array(W);
    for (x = 0; x < W; x++) R[x] = Math.max(prof[k + 1][x] + 12, Z[x] - dep);
    rows.push(R);
    var zc = Z[seeds[k].xs], D = sh.decks.filter(function (D) { return zc >= D.zr[0] && zc <= D.zr[1]; })[0];
    names.push(D ? D.name : zc < low ? CUT_NAMES[Math.min(below++, CUT_NAMES.length - 1)] : '第 ' + (k + 1) + ' 層');
  }
  var tex = gl.createTexture(), data = new Float32Array(W * Math.max(1, n));
  rows.forEach(function (R, k) { data.set(R, k * W); });
  gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, W, Math.max(1, n), 0, gl.RED, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.activeTexture(gl.TEXTURE0);
  return T.cutD = { W: W, n: n, names: names, rows: rows, tex: tex, floors: prof.map(function (Z, k) { return Z[seeds[k].xs]; }) };
}
/** 照甲板 meta 的切高：由上往下第 k 次 ＝ 拿掉最上面 k 層 —— 每一欄切在「拿掉的那幾層裡、那一欄有甲板的最低那一層」的地板 − thick（樑也拿掉），
 *  不切進下一層的頭頂 1.2 m；拿掉的那幾層在那一欄都沒有甲板（例：船尾樓只在船尾）⇒ 那一欄不切。 */
function deckCutMeta(T) {
  var g = T.base, W = g.sx, Ds = hullDecks(T).slice().reverse(), n = Ds.length, rows = [], names = [], x;
  for (var k = 0; k < n; k++) {
    var R = new Float32Array(W), below = Ds[k + 1] || null;
    for (x = 0; x < W; x++) {
      var r = 1e9;
      for (var j = 0; j <= k; j++) { var f = deckFloor(Ds[j], x); if (f !== null) r = Math.min(r, f - Ds[j].thick); }
      var bf = below ? deckFloor(below, x) : null; if (r < 1e9 && bf !== null) r = Math.max(r, bf + 12);
      R[x] = r;
    }
    rows.push(R); names.push(Ds[k].name);
  }
  var tex = gl.createTexture(), data = new Float32Array(W * Math.max(1, n));
  rows.forEach(function (R, k) { data.set(R, k * W); });
  gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, W, Math.max(1, n), 0, gl.RED, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.activeTexture(gl.TEXTURE0);
  var xm = Math.round((T.wl0 + T.wl1) / 2);
  return { W: W, n: n, names: names, rows: rows, tex: tex, meta: true, floors: Ds.map(function (d) { var f = deckFloor(d, xm); return f === null ? d.zmin : f; }) };
}
/** 剖哪一邊：鏡頭在中線的哪一邊就拿掉那一邊（+1 ＝ 格 +y）。 */
function cutSide(sh) { return toLocal(sh, CAM.eye)[1] >= sh.T.cy ? 1 : -1; }
/** 畫一艘船（或斷開的那幾團）之前：設好剖面的 uniform。不是兩艘船本身、或沒開 ⇒ 關。
 *  uCutL（船殼的著色器 voxFS）：畫的格子 → 船的格座標，這裡一律放回單位矩陣（砲帶的裝甲畫的時候才換，24_armor.js armDraw）。
 *  prog.cut0：這支程式現在就是「關」（uCutL 單位矩陣、uCut 關）⇒ 再設關不傳（S3；平常每艘每一趟都設一次）。uCut／uCutL 只有這裡與 armDraw 寫（armDraw 清掉它）；
 *  程式不重建、沒有 context lost 的路 ⇒ uniform 跨格都留著。開 ⇒ 照舊整組傳（每艘的 uCut、uCutInv、切高貼圖都不一樣）。 */
var CUT_ID = M4.ident();
function cutSet(prog, ow) {
  var u = prog.u, on = cutOn() && SHIPS.indexOf(ow) >= 0;
  if (!on && prog.cut0) return;
  prog.cut0 = !on;
  if (u.uCutL) gl.uniformMatrix4fv(u.uCutL, false, CUT_ID);
  if (!u.uCut) return;
  if (!on) { gl.uniform4f(u.uCut, 0, 0, -1, 0); return; }
  var D = deckCut(ow);
  gl.uniform4f(u.uCut, ow.T.cy, CUTV.half ? cutSide(ow) : 0, CUTV.deck > 0 && D.n ? Math.min(CUTV.deck, D.n) - 1 : -1, 1);
  if (u.uCutW) gl.uniform2f(u.uCutW, D.W, Math.max(1, D.n));
  if (u.uCutInv) gl.uniformMatrix4fv(u.uCutInv, false, ow.inv);
  gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, D.tex); gl.uniform1i(u.uCutT, 8); gl.activeTexture(gl.TEXTURE0);
}
/** 這個人在拿掉的那一邊？（drawCrew；墜落中的不管） */
function cutHides(sh, c) {
  if (!cutOn() || c.st === 4 || c.st === 5) return false;
  var p = c.pos;
  if (CUTV.half && cutSide(sh) * (p[1] - sh.T.cy) > 0) return true;
  if (CUTV.deck > 0) { var D = deckCut(sh); if (D.n && p[2] >= D.rows[Math.min(CUTV.deck, D.n) - 1][clamp(Math.floor(p[0]), 0, D.W - 1)]) return true; }
  return false;
}
function cutToggle() { if (!RUNNING) return; CUTV.half = !CUTV.half; obsNote('✂ 剖面：' + (CUTV.half ? '開' : '關')); frzShow(); }
/** 甲板：全部 → 拿掉最上面一層 → … → 只剩船底 → 全部（照我艦的層數）。 */
function deckCycle() {
  if (!RUNNING || !SHIPS[PLAYER_I]) return;
  var n = deckCut(SHIPS[PLAYER_I]).n; CUTV.deck = n ? (CUTV.deck + 1) % (n + 1) : 0;
  obsNote(CUTV.deck ? deckLabel().replace('（' + keyName('deck') + '）', '') : '☰ 甲板：全部回來'); frzShow();
}
/** 停格條上「甲板」那顆的字。 */
function deckLabel() {
  var sh = SHIPS[PLAYER_I]; if (!CUTV.deck || !sh) return '☰ 甲板（' + keyName('deck') + '）';
  var D = deckCut(sh), k = Math.min(CUTV.deck, D.n);
  return '☰ ' + (k >= D.n ? '只剩船底' : '拿掉到' + D.names[k - 1]) + '（' + keyName('deck') + '）';
}
$('frzCut').onclick = cutToggle; $('frzDeck').onclick = deckCycle;
