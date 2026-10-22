// ───────────────────────── 陣營旗（Tim 2026-10-15：辨認陣營的旗，參考史實；遊戲專用 ⇒ 位置寫在設定檔，跟雕刻無關） ─────────────────────────
// 史實（帆船時代）：船尾國旗（ensign）是主要的辨識，開火前一定要升真旗；主桅頂的長旗（commissioning pennant）＝ 現役軍艦；
//   開戰時在好幾根桅頂多掛幾面旗（battle ensigns），一面被打掉還有別面。英國海軍分紅、白、藍三色艦隊旗（底色＋左上角聯合旗）。
// Tim 拍板：長旗＋戰鬥旗、仿英國艦隊旗 ⇒ 藍方 ＝ 藍旗（Blue Ensign）、紅方 ＝ 紅旗（Red Ensign）；長旗靠旗桿那段白底紅十字（聖喬治十字）、尾巴是陣營色。作品自己的國旗照留。
// Tim 2026-10-15（第二輪）：「旗子不要綁在原本有旗幟的地方（且直接套用布料）」「跟帆一樣，被打會破」「每艘船要手動定義掛旗的位置，由妳來掛上」
//   「或是陣營旗是否可以直接往上再加一根旗桿」⇒
//   · 位置：旗桿從桅頂往上，旗掛在旗桿頂 ⇒ 比作品原本掛在桅頂的旗高、不搶位置；Tim：「如果加旗桿，是否可以自動掛旗」⇒
//     沒寫設定檔 ⇒ 自動：每根桅頂一根旗桿，主桅（沒有就最高那根）長旗、其他戰鬥旗；大小照桅頂離水面多高（60 m ＝ 1 倍，0.5–1.1）。
//     要覆寫某艘 ⇒ 設定檔 ships[].flags ＝ [{ kind: 'pennant'|'ensign', at: [x, y, z] 桅頂那一格（格座標）, pole: 旗桿幾公尺, scale: 大小倍率 }]。
//     替換作品原本的旗（Tim：「手動設定的話可以設定替換原有旗幟，例如憲法號原本就有美國國旗」）⇒ { kind, replace: '<旗的種類（meta flag）或名字>' }：
//       先找 meta kind=flag、flag ＝ 那個種類的第一面（Tim：作品的旗標 meta、照 meta 認是哪一種），沒有才照名字；
//       布料、位置、被打都照原本那面，只換貼圖（藍方藍旗、紅方紅旗；照原本那面的 uv —— 作品的旗沒有貼圖就換不了，主控台警告）。
//     桅頂 mastTrucks ＝ 那根桅最高的帆桁轉軸往上、沿中線找到的最高一格（桅會往後傾 ⇒ x 跟著格子走）。
//   · 旗面 ＝ 一面帆（合成的，teamFlagsSetup 在載入船型時接在 T.rig.sails 後面）⇒ 跟帆同一套：布料物理、被打扣血、撕破、布片、掉下去、降旗收起來。
//     綁邊（靠旗桿那一邊）明寫釘在桅頂那一格（clothTemplate 的 s.pins；⛔ 不照外緣直不直猜 —— 旗桿頂離格子太遠，猜不到）；
//     桅頂那一格沒了 ⇒ 旗掉（10_ship.js 的 sail.as ＝ 那一格）、旗桿不畫。
//   · 藍、紅兩份貼圖都進貼圖集；船型是兩隊共用的 ⇒ 畫的時候照船的陣營挑那一格（sailRect）。
// ⛔ 會改戰局：旗是帆 ⇒ 砲彈經過會打到、掉的時候抽亂數。?colours=0 ⇒ 不加旗（跟沒有陣營旗之前逐位元組相同）。
var COL_FIELD = { blue: [0.1, 0.14, 0.42], red: [0.72, 0.1, 0.09] }, COL_W = [0.93, 0.92, 0.88], COL_R = [0.78, 0.08, 0.1], COL_UB = [0.1, 0.14, 0.42];
var COL_SIZE = { ensign: [7, 3.6, 14, 7, 64, 32], pennant: [16, 0.7, 24, 2, 128, 8] };   // 長、寬（公尺）、布料沿飛的方向幾格、沿旗桿幾格、貼圖寬高（px）
var COL_ON = Q.get('colours') !== '0';                                   // ?colours=0 ⇒ 不加旗（對照用）
var COL_POLE_W = 0.16, COL_POLE_C = [0.36, 0.27, 0.17];                   // 旗桿粗細（公尺）、顏色
/** 旗面上 (u 沿飛的方向 0 旗桿 → 1 尾、v 沿旗桿 0 上 → 1 下) 的顏色。 */
function colourAt(kind, team, u, v) {
  var F = COL_FIELD[team] || COL_FIELD.blue;
  if (kind === 'pennant') {                                              // 長旗：靠旗桿那一段白底紅十字（聖喬治），之後是陣營色
    var hl = 0.07; if (u > hl) return F;
    return Math.abs(u - hl / 2) < hl * 0.16 || Math.abs(v - 0.5) < 0.17 ? COL_R : COL_W;
  }
  if (u > 0.5 || v > 0.5) return F;                                      // 戰鬥旗：左上角四分之一是聯合旗（1801 年後：聖喬治＋聖安德魯＋聖派翠克，這裡畫成藍底、白斜十字、白邊紅十字）
  var cu = u / 0.5, cv = v / 0.5, d1 = Math.abs(cu - cv), d2 = Math.abs(cu + cv - 1);
  if (Math.abs(cu - 0.5) < 0.09 || Math.abs(cv - 0.5) < 0.12) return COL_R;
  if (Math.abs(cu - 0.5) < 0.17 || Math.abs(cv - 0.5) < 0.22) return COL_W;
  if (Math.min(d1, d2) < 0.11) return COL_W;
  return COL_UB;
}
/** 這一型的桅頂（格座標）：{ fore: [x, y, z], … }。 */
function mastTrucks(T) {
  if (T.trucks) return T.trucks;
  var top = {}, key = { '前桅': 'fore', '主桅': 'main', '後桅': 'mizzen' }, g = T.base, cy = Math.round(T.cy);
  (T.rig.models || []).forEach(function (m) { var mt = m.meta || {}, pv = (m.points || {}).pivot; if (mt.kind === 'yard' && mt.mast && mt.mast !== 'bowsprit' && pv && (!top[mt.mast] || pv[2] > top[mt.mast][2])) top[mt.mast] = pv; });
  T.masts.forEach(function (m) { var k = key[m.name] || m.name; if (!top[k]) top[k] = [m.x, cy, m.z1]; });
  var out = {};
  Object.keys(top).forEach(function (k) {
    var x = Math.round(top[k][0]), z = Math.floor(top[k][2]), best = null, miss = 0;
    for (; z < T.sz && miss < 4; z++) {                                  // 往上一層一層找：中線附近有格 ⇒ 桅還在這一層（x 跟著格子的平均走）
      var sx = 0, n = 0;
      for (var xx = x - 12; xx <= x + 12; xx++) for (var y = cy - 2; y <= cy + 2; y++) if (g.get(xx, y, z)) { sx += xx; n++; }
      if (n) { x = Math.round(sx / n); best = [x, cy, z]; miss = 0; } else miss++;
    }
    if (best) out[k] = best;
  });
  return (T.trucks = out);
}
/** 沒寫設定檔的船：每根桅頂一根旗桿（主桅長旗、其他戰鬥旗），大小照桅頂多高。 */
function autoFlags(T) {
  var tr = mastTrucks(T), ks = Object.keys(tr); if (!ks.length) return [];
  var pm = tr.main ? 'main' : ks.slice().sort(function (a, b) { return tr[b][2] - tr[a][2]; })[0], hz = (tr[pm][2] - T.zw) * S, k = clamp(hz / 60, 0.5, 1.1);
  return ks.map(function (m) { return { kind: m === pm ? 'pennant' : 'ensign', at: tr[m], pole: 4.5 * k, scale: k, mast: m }; });
}
/** 一面旗的貼圖（跟 .vxk 帆的 texture 同一種格式：w×h 的 RGBA、base64）。 */
function colourTex(kind, team, W, H) {
  var b = '';
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) { var c = colourAt(kind, team, (x + 0.5) / W, (y + 0.5) / H); b += String.fromCharCode(Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255), 255); }
  return btoa(b);
}
/** 載入船型時（05_hull.js「桅與帆」那一步、clothSetup 之前）：照設定檔的 flags 生旗（合成的帆，接在 T.rig.sails 後面）。
 *  T.nSail0 ＝ 作品自己的帆有幾面（快取只存這幾面的布料，06_cache.js）；T.teamExtra ＝ 貼圖集排在帆後面的那幾份（陣營旗紅的那份、替換作品旗的藍紅兩份；clothSetup）、
 *  T.teamTex[帆] ＝ { blue, red } 貼圖集的哪一格（sailRect）；T.poles ＝ 旗桿。 */
function teamFlagsSetup(T, info) {
  T.nSail0 = T.rig.sails.length; T.teamTex = {}; T.teamExtra = []; T.poles = [];
  if (!COL_ON) return;
  var defs = info && info.flags || autoFlags(T); if (!defs.length) return;
  T.teamDefs = defs;
  var add = [], red = [], repl = [];
  defs.forEach(function (f, fi) {
    if (f.replace) { repl.push(f); return; }
    var Z = COL_SIZE[f.kind], k = f.scale || 1, Lm = Z[0] * k / S, Hm = Z[1] * k / S, NU = Z[2], NV = Z[3], a = f.at, top = a[2] + (f.pole || 4.5) / S;
    var cell = anchorNear(T, a[0], a[1], a[2], 3), pen = f.kind === 'pennant', verts = [], uv = [], tris = [], pins = [], u, v;
    for (u = 0; u <= NU; u++) for (v = 0; v <= NV; v++) {               // 往船尾飄（−x）、稍微下垂、一點起伏（物理關著時就是這個樣子）
      var uu = u / NU, vv = v / NV, w = pen ? 1 - 0.85 * uu : 1;
      verts.push(a[0] - 1 - Lm * uu, a[1] + Math.sin(uu * 5) * Hm * 0.08 * uu, top - ((vv - 0.5) * w + 0.5) * Hm - Lm * uu * uu * 0.08);
      uv.push(uu, vv);
      if (u === 0) pins.push(v);
    }
    for (u = 0; u < NU; u++) for (v = 0; v < NV; v++) { var p = u * (NV + 1) + v, q = p + NV + 1; tris.push(p, q, q + 1, p, q + 1, p + 1); }
    var nm = 'team-' + f.kind + '-' + fi, col = COL_FIELD.blue;
    red.push([T.nSail0 + add.length, { texture: { w: Z[4], h: Z[5], rgba: colourTex(f.kind, 'red', Z[4], Z[5]), uv: uv, alpha_min: 0 } }]);
    add.push({ name: nm, verts: verts, tris: tris, color: col, meta: { kind: 'flag', flag: pen ? 'pennant' : 'battle', team: 1 }, pins: pins, pinK: cell >= 0 ? 1 : 3, pinV: cell, truckCell: cell,
      texture: { w: Z[4], h: Z[5], rgba: colourTex(f.kind, 'blue', Z[4], Z[5]), uv: uv, alpha_min: 0 } });
    T.poles.push({ at: a, top: top + 0.6, cell: cell });                 // 旗桿：桅頂 → 旗頭上面一點
    for (var q = 0; q < verts.length; q += 3) T.radFlags = Math.max(T.radFlags || 0, Math.hypot(verts[q] - T.cx, verts[q + 1] - T.cy, verts[q + 2] - T.geo.center) * S);   // 離船心最遠多少（32_hull.js：砲彈離船心超過這個就不看這艘）
  });
  T.rig = Object.assign({}, T.rig, { sails: T.rig.sails.concat(add) });   // ⛔ 不改 header 那一份（hullCheck 之類的還要讀作品原本的帆）
  var n = T.rig.sails.length;                                          // 貼圖集：帆（含合成的旗，藍的那份）之後接 teamExtra（clothSetup）
  red.forEach(function (r) { T.teamTex[r[0]] = { blue: r[0], red: n + T.teamExtra.length }; T.teamExtra.push(r[1]); });
  repl.forEach(function (f) {
    var k = -1; T.rig.sails.forEach(function (s, j) { if (j < T.nSail0 && k < 0 && s.meta && s.meta.kind === 'flag' && s.meta.flag === f.replace) k = j; });   // 先照 meta 的種類（造船規格 §9：kind=flag、flag=ensign｜pennant｜jack…）
    if (k < 0) T.rig.sails.forEach(function (s, j) { if (j < T.nSail0 && s.name === f.replace) k = j; });   // 沒有 meta 的舊匯出 ⇒ 照名字
    var s = T.rig.sails[k], tx = s && s.texture;
    if (!tx || !tx.uv) { console.warn('陣營旗：' + T.id + ' 換不了「' + f.replace + '」' + (s ? '（作品的旗沒有貼圖 uv）' : '（找不到這面旗）')); return; }
    var Z = COL_SIZE[f.kind] || COL_SIZE.ensign, uv = tx.uv;
    T.teamTex[k] = { blue: n + T.teamExtra.length, red: n + T.teamExtra.length + 1 };
    T.teamExtra.push({ texture: { w: Z[4], h: Z[5], rgba: colourTex(f.kind, 'blue', Z[4], Z[5]), uv: uv, alpha_min: 0 } }, { texture: { w: Z[4], h: Z[5], rgba: colourTex(f.kind, 'red', Z[4], Z[5]), uv: uv, alpha_min: 0 } });
  });
}
/** 貼圖集的那一格：陣營旗照船的陣營挑藍或紅那份（船型兩隊共用）；替換掉的作品旗也一樣。 */
function sailRect(ow, A, ti) {
  var T = ow.T, m = T && T.teamTex && T.teamTex[ti];
  if (m) return A.rect[(ow.team || (ow.owner && ow.owner.team)) === 'red' ? m.red : m.blue];
  return A.rect[ti];
}
/** 旗桿（每一格畫面；船身格座標）：桅頂那一格還在才畫。降旗旗桿照留（旗收了）。 */
function poleBuf(sh) {
  var P = sh.T.poles; if (!P || !P.length) return;
  var key = '', i;                                                       // 跟以前 map＋join 同一個字串（S11：每格不生陣列、閉包）
  for (i = 0; i < P.length; i++) key += P[i].cell < 0 || hullGp(sh.grid, P[i].cell) > 0 ? '1' : '0';
  if (sh.sink > 40) key += 'x';
  if (sh.poleKey === key) return;
  sh.poleKey = key;
  var out = [], hw = COL_POLE_W / S / 2, c = COL_POLE_C;
  P.forEach(function (p, i) {
    if (key[i] !== '1') return;
    var x = p.at[0], y = p.at[1], z0 = p.at[2], z1 = p.top;
    [[1, 0], [0, 1], [-1, 0], [0, -1]].forEach(function (d) {          // 四面（方的細桿）
      var nx = d[0], ny = d[1], ax = x + (nx ? nx * hw : -hw), ay = y + (ny ? ny * hw : hw), bx = x + (nx ? nx * hw : hw), by = y + (ny ? ny * hw : -hw);
      if (ny) { ax = x + hw * ny; bx = x - hw * ny; ay = by = y + ny * hw; }
      [[ax, ay, z0], [bx, by, z0], [bx, by, z1], [ax, ay, z0], [bx, by, z1], [ax, ay, z1]].forEach(function (q) { out.push(q[0], q[1], q[2], nx, ny, 0, c[0], c[1], c[2]); });
    });
  });
  sh.poleB = upload(sh.poleB, new Float32Array(out), 9, [[0, 3, 0], [1, 3, 3], [2, 3, 6]]);
}
/** 畫旗桿（模型那一趟之後，同一支著色器、受光）：反射（畫質「高」）也畫。旗面是帆，照帆畫（11_rig_gpu.js sailBuf）。 */
function drawColours(prog, pd) {                                      // pd：哪一趟（60_rbatch.js RBAT.pd；鏡頭外的船不畫，viewVis）
  if (prog.u.uGlow) gl.uniform1f(prog.u.uGlow, 0);
  var vb = pd ? pd.b : 0;
  SHIPS.forEach(function (sh, i) {
    var b = sh.poleB; if (!b || !b.n || sh.sink > 40 || (vb && !(RBAT.cs[i] & vb))) return;
    cutSet(prog, sh); gl.uniformMatrix4fv(prog.u.uModel, false, sh.M);
    gl.bindVertexArray(b.vao); gl.drawArrays(gl.TRIANGLES, 0, b.n);
  });
}
