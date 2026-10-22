// ───────────────────────── 拋錨（TASK-0601；Tim 2026-10-15：停船改叫拋錨、要有戰局效果 —— 船停住、可以繞錨轉向；
//   左右錨分開拋（錨被打壞就不能按）；只拋單邊做急轉（《黑帆》裡只拋一側錨，船繞錨甩過去）） ─────────────────────────
// 每艘兩個錨（P 左舷、S 右舷），錨鏈孔 ＝ 錨掛著的地方（錨的模型或關聯的中心；這一型找不到錨 ⇒ 船頭兩側，打不壞）。
//   狀態：up 收著 → drop 往下沉（ANC_FALL 秒）→ down 落底咬住 → weigh 起錨（ANC_WEIGH 秒，鍊子收短：船被平移拉近、每秒最多 ANC_HAUL，航向不動；不夠的由錨被拖過來）→ up。
//   起錨中鍊子收到剩下不到水深（第 3.6 秒）⇒ 錨離底（anchorFree）：不再拴著船、帆與引擎照常出力（Tim 2026-10-16「只要錨拔起船就可以開始動了」），錨照樣吊上來到第 8 秒。
//   落底的點 ＝ 放開那一刻錨鏈孔正下方（海面上的 x、z，海底在水線下 ANC_DEPTH）；鍊長 ANC_CHAIN ⇒ 錨鏈孔離錨的水平距離最多 ANC_REACH。
// 約束（down）：錨鏈孔超過 ANC_REACH ⇒ 拉回圓周上；船身當剛體繞錨鏈孔轉（船心照動量走、船頭被拴住 ⇒ 往前的動量變成轉向）：
//   帶著速度只拋一側 ⇒ 鍊子一拉緊，船頭被拴在那一側、船尾甩出去 ＝ 急轉；兩側都拋 ⇒ 停住，A／D 原地慢慢轉（ANC_PIVOT）、電腦照舊轉舷側對敵。
//   拉緊的時候每秒掉 1／ANC_DRAG 的速度（鍊子拖著）；鍊子要船轉得比 ANC_YAWMAX 快 ⇒ 錨在海底被拖著走（船只轉到上限、每秒掉 1／ANC_DRAGX）。錨被打壞（模型沒了、關聯的格少了一半）⇒ 那一側斷鍊、船放開，不能再拋。
// ⛔ 戰局不抽 rnd()（只有錨入水的水花抽，見 chainSolve）；沒拋錨的船一位元都不動（sh.anc 只有拋過才建）。
// 單錨的船（TASK-0635；Tim 2026-10-16：「只有一個錨的情況下 會自動補上另一邊的錨 且會歪掉」「只有單錨時 隱藏左右錨 只保留拋錨操作」）：
//   兩舷只找到一個真的錨（模型或關聯）⇒ 另一舷標 none（不補、拋不了），A.single ＝ 有錨的那一舷；左右錨（7／8）的按鈕藏起來、按鍵不理，6 只拋這一個。
//   ⛔ 以前另一舷照船頭的預設點補一個（水線上 25 格、bowHalf 寬）⇒ 莫尼特號那個補出來的左錨在水線上 2.5 m、中線往左 2 m 的半空，鐵鍊從空中垂下去。
//   錨剛好在中線（外框中心 y ＝ T.cy）⇒ 算右舷（以前兩舷都不算 ⇒ 兩舷都補）。
//   整艘都沒有錨（夜隼號、風暴角號；Tim 2026-10-16：「不隱藏按鈕」「功能變成停船」）⇒ 兩舷都 none、A.noAnchor：6／7／8 照樣顯示（圖示 🛑），
//   按哪一顆都是切換停船（SAIL 'off'：帆與引擎不出力、船慢慢停下（時間常數 6 秒）、舵放正；31_sailing.js）⇄ 手動。⛔ 以前兩舷照船頭的預設點補兩個、打不壞。
// 水深照海圖（Tim 2026-10-19：「讓Blockside的拋錨實際根據海底深度去拋(太深的話就訂一個上限 主要是處理淺灘拋錨 另外要注意大漩渦天氣的處理)」）：
//   有海圖（?map，08_seabed.js BED）⇒ 錨落在那一點真的海底（bedHgt），水深上限 ANC_DEPTH（比它深 ⇒ 照以前，在水線下 ANC_DEPTH 咬住）；海底高出水面（岸上）⇒ 水深 0、錨落在地上。
//   水深 d ⇒ 錨鏈孔離錨最遠 √(鍊長² − d²)（淺 ⇒ 鍊子平躺的多，繞錨的圈大）、下沉 ANC_FALL·√(d／ANC_DEPTH) 秒（最少 0.35 倍）、起錨時鍊子收到剩 d 就離底（淺 ⇒ 晚一點才拔起來）。
//   錨被拖著走（拖錨、起錨）⇒ 照新的那一點重量水深。
//   大漩渦（08_sea.js VX）⇒ 水深從那一點漏斗的水面量（Tim 2026-10-18「漩渦內拋錨會飛到天上」那一條）；有海圖 ⇒ 海圖已經照漩渦烤過（08_seabed.js bedVxBake：漏斗內是深海、外面水深照海圖），一樣照真的海底。
//   沒有海圖 ⇒ 水深一律 ANC_DEPTH，每一步的數字跟以前一樣（戰局逐位元組不變）。
var ANC_DEPTH = 20, ANC_CHAIN = 36, ANC_REACH = Math.sqrt(ANC_CHAIN * ANC_CHAIN - ANC_DEPTH * ANC_DEPTH), ANC_FALL = 4, ANC_WEIGH = 8, ANC_DRAG = 8, ANC_DRAGX = 2.5, ANC_PIVOT = 0.06, ANC_YAWMAX = 0.5, ANC_HAUL = 1;   // 公尺、秒、rad/s、m/s（ANC_DEPTH ＝ 水深上限）
/** 錨在 (x, z) 會落到多低（世界 y）：水面（大漩渦 ＝ 漏斗那一點、其他 ＝ 0）下 ANC_DEPTH；有海圖 ⇒ 真的海底，最深到那裡（岸上 ⇒ 地面）。 */
function anchorLv(x, z) { return VX ? vxH(x, z) : 0; }
function anchorFloor(x, z) {
  var lv = anchorLv(x, z);
  return BED && BED.A ? Math.max(bedHgt(x, z), lv - ANC_DEPTH) : lv - ANC_DEPTH;
}
/** 照錨現在的落點（a.A）定水深 a.dep 與鍊子拉得多遠 a.reach（拋下去、被拖著走之後都重量）。 */
function anchorSeat(a) {
  var d = BED && BED.A ? Math.max(0, anchorLv(a.A[0], a.A[1]) - anchorFloor(a.A[0], a.A[1])) : ANC_DEPTH;   // 水深 ＝ 那一點的水面 − 落點；沒有海圖 ⇒ 剛好 ANC_DEPTH（⛔ 大漩渦裡相減一次會差一點點浮點 ⇒ 戰局不再逐位元組相同）
  a.dep = d; a.reach = Math.sqrt(ANC_CHAIN * ANC_CHAIN - d * d);
}
/** 下沉要幾秒：水深上限那麼深 ⇒ ANC_FALL（跟以前一樣），淺 ⇒ 照 √ 比例短，最少 0.35 倍。 */
function anchorFallT(d) { return ANC_FALL * Math.max(0.35, Math.sqrt(d / ANC_DEPTH)); }
/** 這艘的兩個錨（第一次要用才建）：錨鏈孔的格座標、是哪個部件（模型／關聯／沒有）。 */
function anchorsOf(sh) {
  if (sh.anc) return sh.anc;
  var T = sh.T, out = {};
  ['P', 'S'].forEach(function (k) {
    var sg = k === 'S' ? 1 : -1, a = { side: k, st: 'up', A: null, t: 0, m: null, part: null, hx: T.wl1 - 12, hy: T.cy + sg * Math.max(4, T.bowHalf - 2), hz: T.zw + 25, broken: false };   // hz：鐵鍊從哪個高度出來（畫用）
    var m = sh.models.filter(function (q) { return q.meta && q.meta.kind === 'anchor' && ((q.c[1] - T.cy) * sg > 0 || (k === 'S' && q.c[1] === T.cy)); })[0];   // 剛好在中線 ⇒ 算右舷
    var p = !m && (T.h.parts || []).filter(function (q) { var y = (q.box ? (q.box[1] + q.box[4]) / 2 : 0) - T.cy; return /錨/.test(q.path || '') && q.box && (y * sg > 0 || (k === 'S' && y === 0)); })[0];
    if (m) { a.m = m; var rg = m.pts && m.pts.ring; if (rg) { a.hx = rg[0]; a.hy = rg[1]; a.hz = rg[2]; } else { a.hx = m.c[0]; a.hy = m.c[1]; a.hz = m.bb[5]; } }   // 錨環 ring（造船規格 §9 anchor）：鐵鍊綁的地方；沒有 ⇒ 模型頂的中心
    else if (p) {                                                        // 關聯（格子）：開局記下它的格（每 4 格取 1），之後少了一半 ⇒ 打壞
      var b = p.box, cells = [];
      for (var x = b[0]; x <= b[3]; x += 2) for (var y = b[1]; y <= b[4]; y += 2) for (var z = b[2]; z <= b[5]; z += 1) if (T.base.get(x, y, z)) cells.push(x, y, z);
      a.part = { path: p.path, cells: cells }; a.hx = (b[0] + b[3]) / 2; a.hy = (b[1] + b[4]) / 2; a.hz = b[5];
    }
    a.rx = a.hx; a.ry = a.hy; a.rz = a.hz;                              // 錨這一端（ring）：鐵鍊接在這裡、模型錨照它搬到鍊子尾巴
    var hw = null; (T.h.parts || []).some(function (q) { return (hw = q.points && q.points['hawse-' + k]); });
    var hm = !hw && a.m && typeof a.m.meta.hawse === 'string' ? a.m.meta.hawse.split(',').map(Number) : null;   // 船殼沒登記 ⇒ 錨自己的 meta hawse（"x,y,z"；TASK-0601：固定點只有作者能登記、meta 誰都能標）
    if (!hw && hm && hm.length === 3 && hm.every(isFinite)) hw = hm;
    if (hw) { a.hx = hw[0]; a.hy = hw[1]; a.hz = hw[2]; a.hw = true; }   // 錨鏈孔 hawse-P／S（船殼固定點，各船登記）：鐵鍊從這裡出來、船繞這一點被拴住；沒登記 ⇒ 跟以前一樣用錨那一點
    out[k] = a;
  });
  var real = ['P', 'S'].filter(function (k) { return out[k].m || out[k].part; });
  if (real.length === 1) { out[real[0] === 'P' ? 'S' : 'P'].none = true; out.single = real[0]; }   // 單錨：另一舷不補（TASK-0635）
  else if (!real.length) { out.P.none = out.S.none = true; out.noAnchor = true; }                  // 整艘沒有錨：6／7／8 變成停船
  return (sh.anc = out);
}
/** 錨的關聯拆成模型錨（TASK-0601；Tim 2026-10-16：「有些船(憲法號) 會出現拋錨後船體上還有錨 … 直接改meta 因為這是遊戲內功能 不影響雕刻作品本身」）。
 *  憲法號、餘燼號、三叉戟號的錨是關聯：格子跟船殼攤平成一份 ⇒ 拋下去只能在鍊尾另外畫一個簡單的錨，船上那團格子不動。
 *  關聯標 meta kind=anchor ⇒ admin.py（anchor_cells）把來源作品的格子照外框與 mirror 換好、寫進檔頭 parts[].cells（base64，每格 x、y、z 各一位元組，相對外框的最小角）；
 *  這裡（05_hull.js 格子那一步、armorSetup 之後）照它把那幾格從船殼拿掉（T.hullG；T.base 照舊整艘 ⇒ 浮力、站位不變，同裝甲），
 *  外露的面做成一份模型網格、接在 T.rig.meshes／T.rig.models 後面 ⇒ 之後跟模型錨走同一條路：拋下去整隻搬到鍊尾（ancD）、被打照模型扣血、打飛、腳是 ring 旁的格。
 *  ⛔ 船上那幾格不在（少了 2% 以上）⇒ 不拆、照舊是船殼（T.ancBad，匯入檢查報）。 */
function anchorParts(T) {
  T.ancBad = [];
  (T.h.parts || []).forEach(function (p) {
    var mt = p.meta || {}; if (mt.kind !== 'anchor') return;
    function bad(msg, fix) { T.ancBad.push({ lv: 'warn', where: p.path, msg: msg, fix: fix }); }
    if (!p.cells || !p.box) { bad('錨的關聯（meta kind=anchor）檔頭沒有 cells ⇒ 照舊是船殼（拋下去船上那團格子不動）', 'python -I admin.py metasync --id ' + T.id + '（會從來源作品補 cells）'); return; }
    var bin = atob(p.cells), n = bin.length / 3 | 0, b = p.box, X0 = Math.floor(b[0]), Y0 = Math.floor(b[1]), Z0 = Math.floor(b[2]);
    var nx = Math.floor(b[3]) - X0 + 1, ny = Math.floor(b[4]) - Y0 + 1, nz = Math.floor(b[5]) - Z0 + 1, occ = new Uint8Array(nx * ny * nz), C = [], miss = 0, i;
    for (i = 0; i < n; i++) {
      var cx = bin.charCodeAt(3 * i), cy = bin.charCodeAt(3 * i + 1), cz = bin.charCodeAt(3 * i + 2), c = T.base.get(X0 + cx, Y0 + cy, Z0 + cz);
      if (!c || cx >= nx || cy >= ny || cz >= nz) { miss++; continue; }
      occ[cx + nx * (cy + ny * cz)] = 1; C.push(cx, cy, cz, c);
    }
    if (!C.length || miss > n * 0.02) { bad('cells 跟船上的格對不上（' + miss + '／' + n + ' 格不在）⇒ 照舊是船殼', '作品改過 ⇒ python -I admin.py reimport --id ' + T.id); return; }
    if (T.hullG === T.base) T.hullG = T.base.share();                   // 共用 T.base 的資料，拆的那幾塊才複製（同 armorSetup）
    var verts = [], tris = [], tmat = [], mats = [], mi = {}, lo = [1e9, 1e9, 1e9], hi = [-1, -1, -1];
    var F = [[1, 0, 0, [1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], [-1, 0, 0, [0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], [0, 1, 0, [0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
             [0, -1, 0, [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], [0, 0, 1, [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], [0, 0, -1, [0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]];   // 六個面：法線、四個角（從外面看逆時針 ⇒ 右手法線朝外）
    function inA(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && occ[x + nx * (y + ny * z)] === 1; }
    for (i = 0; i < C.length; i += 4) {
      var x = C[i], y = C[i + 1], z = C[i + 2], col = C[i + 3];
      T.hullG.set(X0 + x, Y0 + y, Z0 + z, 0);
      if (mi[col] === undefined) { var rgb = VK.rgb332(col); mi[col] = mats.length; mats.push([+(rgb[0] / 255).toFixed(4), +(rgb[1] / 255).toFixed(4), +(rgb[2] / 255).toFixed(4)]); }
      lo = [Math.min(lo[0], x), Math.min(lo[1], y), Math.min(lo[2], z)]; hi = [Math.max(hi[0], x), Math.max(hi[1], y), Math.max(hi[2], z)];
      F.forEach(function (f) {
        if (inA(x + f[0], y + f[1], z + f[2])) return;                  // 只畫外露的面（貼著船殼的那一面照畫：船殼那邊拆掉之後也露出來）
        var v0 = verts.length / 3;
        for (var q = 3; q < 7; q++) verts.push(x + f[q][0], y + f[q][1], z + f[q][2]);
        tris.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3); tmat.push(mi[col], mi[col]);
      });
    }
    T.rig = T.rig || {}; T.rig.meshes = T.rig.meshes || []; T.rig.models = T.rig.models || [];
    T.rig.models.push({ name: p.path, mesh: T.rig.meshes.length, origin: [X0, Y0, Z0], bbox: [X0 + lo[0], Y0 + lo[1], Z0 + lo[2], X0 + hi[0] + 1, Y0 + hi[1] + 1, Z0 + hi[2] + 1],
      meta: mt, points: p.points || {}, fromPart: C.length / 4 });       // fromPart：拆了幾格（匯入檢查顯示用）
    T.rig.meshes.push({ verts: verts, tris: tris, tmat: tmat, mats: mats });
    fitAncSwap(T, T.rig.models[T.rig.models.length - 1]);             // 換裝表換了這一隻（38_fit.js；TASK-0793）⇒ 拆好的這一份換成零件表那一件
  });
}
function anchorAlive(sh, a) {
  if (a.broken) return false;
  if (a.m) return a.m.alive;
  if (a.part) { var C = a.part.cells, n = 0; for (var i = 0; i < C.length; i += 3) if (sh.grid.get(C[i], C[i + 1], C[i + 2])) n++; return n * 2 >= C.length / 3; }
  return true;
}
/** 錨鏈孔在世界的水平位置（x、z）—— 照 (px, pz, yaw) 算（shipMatrix 的水平部分）。 */
function hawseXZ(sh, a, px, pz, yaw) {
  var lx = S * (a.hx - sh.T.cx), lz = S * (a.hy - sh.T.cy), c = Math.cos(yaw), s = Math.sin(yaw);
  return [px + lx * c + lz * s, pz - lx * s + lz * c];
}
/** 拋（up ⇒ drop）或起（drop／down ⇒ weigh）。回傳發生了什麼（給廣播）。 */
function anchorToggle(sh, k, want) {
  var A = anchorsOf(sh), a = A[k], nm = A.single ? '錨' : k === 'P' ? '左錨' : '右錨';
  if (a.none) return '';                                                // 單錨的船：沒有錨的那一舷（TASK-0635）
  if (want === undefined) want = a.st === 'up';
  if (want) {
    if (a.st !== 'up') return '';
    if (!anchorAlive(sh, a)) { a.broken = true; return nm + '打壞了，拋不了'; }
    var h = hawseXZ(sh, a, sh.px, sh.pz, sh.yaw), R = a.hw ? M4.pt(sh.M, a.rx, a.ry, a.rz) : null;
    a.A = R ? [R[0], R[2]] : h; a.y0 = R ? R[1] : null; anchorSeat(a); a.fall = anchorFallT(a.dep); a.st = 'drop'; a.t = SIMT + a.fall;   // 水深照落點（海圖）；有錨鏈孔 ⇒ 錨從自己掛的地方（ring，吊錨架）直直落下去，鍊子從錨鏈孔放出；沒有 ⇒ 照舊從錨鏈孔正下方
    return '拋' + nm;
  }
  if (a.st === 'drop' || a.st === 'down') { a.st = 'weigh'; a.t0 = SIMT; a.t = SIMT + ANC_WEIGH; a.free = false; return '起' + nm; }   // free：離底那一句廣播報過沒（anchorStep）
  return '';
}
/** 起錨：還在水裡的（drop／down）都開始收；回傳收了哪幾個（給廣播）。 */
function anchorWeighAll(sh) {
  var A = sh.anc; if (!A) return '';
  return ['P', 'S'].filter(function (k) { return anchorToggle(sh, k, false); }).map(function (k) { return A.single ? '錨' : k === 'P' ? '左錨' : '右錨'; }).join('、');
}
function anchorAny(sh, st) { var A = sh.anc; return !!A && (A.P.st === st || A.S.st === st); }
/** 6（拋錨／起錨同一顆）按下去是起錨嗎：拋錨模式、或有錨在水裡（下沉中、咬著）。 */
function anchorWet(sh) { return (SAIL === 'off' && sh.i === PLAYER_I) || anchorAny(sh, 'drop') || anchorAny(sh, 'down'); }
/** 6 這一下要做什麼（Tim 2026-10-15：「已經有一邊拋錨時，按下拋錨仍然是拋另一邊錨；兩邊都拋錨時才是起錨」）：
 *  'both' 兩邊都沒在水裡 ⇒ 拋雙錨（拋錨模式）；'other' 一邊在水裡、另一邊還拋得了 ⇒ 拋另一邊（k ＝ 哪一邊）；'weigh' 其他（兩邊都在水裡、或另一邊打壞了）⇒ 起錨。 */
function anchor6(sh) {
  var A = anchorsOf(sh), wet = ['P', 'S'].filter(function (k) { return A[k].st === 'drop' || A[k].st === 'down'; });
  var free = ['P', 'S'].filter(function (k) { return A[k].st === 'up' && !A[k].none && !A[k].broken && anchorAlive(sh, A[k]); });
  if (SAIL === 'off' && sh.i === PLAYER_I) return { act: 'weigh' };
  if (!wet.length) return { act: anchorAny(sh, 'weigh') ? 'weigh' : 'both' };
  if (wet.length === 1 && free.length) return { act: 'other', k: free[0] };
  return { act: 'weigh' };
}
/** 錨離底了沒（起錨中，鍊子收到剩下不到水深 ⇒ 鍊子直上直下、錨被拔起來）。Tim 2026-10-16：「只要錨拔起船就可以開始動了(現在要等完全收錨才會動)」。
 *  鍊長 36 m、水深 20 m、起錨 8 秒 ⇒ 起錨第 3.6 秒離底；之後錨只是吊上來（鐵鍊照畫），船不再被拴著。水深照海圖（a.dep）：淺灘 5 m ⇒ 第 6.9 秒才離底。 */
function anchorFree(a) { return a.st === 'weigh' && ANC_CHAIN * clamp((a.t - SIMT) / ANC_WEIGH, 0, 1) <= (a.dep === undefined ? ANC_DEPTH : a.dep); }
/** 有錨咬著（落底、起錨中還沒離底）⇒ 船不再靠帆、引擎走（target 0）。⛔ 以前起錨中一律算咬著 ⇒ 要等 8 秒整個收好才能動。 */
function anchorHeld(sh) { var A = sh.anc; return !!A && ['P', 'S'].some(function (k) { var a = A[k]; return a && (a.st === 'down' || a.st === 'weigh' && !anchorFree(a)); }); }
/** 每一步（sail() 走完位置之後）：沉到底、起完、打壞斷鍊；咬著的錨把錨鏈孔拉回鍊長以內、船身繞錨鏈孔轉。回傳有沒有拉緊。 */
function anchorStep(sh, dt, px0, pz0) {
  var A = sh.anc; if (!A) return false;
  var taut = false, drag = false, tot = sh.yawRate * dt, lim = Math.max(ANC_YAWMAX * dt, Math.abs(tot));   // tot：這一步航向總共變多少（sail() 照轉動慣性已經轉了 yawRate·dt）—— 上限算總的，⛔ 只限約束那一段 ⇒ 慣性再加一次，15 m/s 轉到 44°/s
  ['P', 'S'].forEach(function (k) {
    var a = A[k], nm = A.single ? '錨' : k === 'P' ? '左錨' : '右錨';
    if (a.st === 'up') return;
    if (!anchorAlive(sh, a)) { a.broken = true; a.st = 'up'; a.A = null; chainCut(sh, a); if (sh.i === PLAYER_I) note(sh, nm + '被打壞了，鍊子斷了'); return; }
    if (a.st === 'drop' && SIMT >= a.t) { a.st = 'down'; if (sh.i === PLAYER_I) note(sh, nm + '落底咬住了' + (BED && BED.A ? '（水深 ' + (a.dep >= ANC_DEPTH ? ANC_DEPTH + ' m 以上，鍊子只放到這麼深' : a.dep.toFixed(1) + ' m') + '）' : '')); }   // 有海圖 ⇒ 報水深
    if (a.st === 'weigh' && SIMT >= a.t) { a.st = 'up'; a.A = null; if (sh.i === PLAYER_I) note(sh, nm + '起好了'); return; }
    if (a.st !== 'down' && a.st !== 'weigh') return;
    if (anchorFree(a)) { if (!a.free) { a.free = true; if (sh.i === PLAYER_I) note(sh, nm + '離底了，船可以走了'); } return; }   // 錨拔起來了 ⇒ 不再拴著船（鍊子照收、錨照吊上來）
    var R0 = a.reach === undefined ? ANC_REACH : a.reach, r = a.st === 'weigh' ? R0 * clamp((a.t - SIMT) / ANC_WEIGH, 0, 1) : R0;   // 起錨：鍊子一路收短 ⇒ 船被拉向錨；R0 照落點的水深（海圖）
    var H = hawseXZ(sh, a, sh.px, sh.pz, sh.yaw), dx = H[0] - a.A[0], dz = H[1] - a.A[1], d = Math.hypot(dx, dz);
    if (d <= r || d < 1e-6) return;
    taut = true;
    if (a.st === 'weigh') {                                             // 起錨：船只被平移拉近（每秒最多 ANC_HAUL 公尺、航向不動），剩下的由錨在海底被拖向錨鏈孔補
      var mv = Math.min(d - r, ANC_HAUL * dt), sl = d - r - mv;         //   ⛔ 以前跟咬著一樣用旋轉約束 ⇒ 鍊長收到 0、錨鏈孔被硬拉到錨正上方 ⇒ 單拋左錨轉好再起，8 秒船被轉 107°（Tim 2026-10-15「收錨過程中憑空給一股很大的轉向力」）
      sh.px -= dx / d * mv; sh.pz -= dz / d * mv; a.A = [a.A[0] + dx / d * sl, a.A[1] + dz / d * sl]; anchorSeat(a);   //   雙錨一起起 ⇒ 兩條各拉一點、錨各自被拖，不會互相扯；錨被拖到新的一點 ⇒ 重量水深
      return;
    }
    var Hn = [a.A[0] + dx / d * r, a.A[1] + dz / d * r];                // 錨鏈孔拉回圓周上
    var lx = S * (a.hx - sh.T.cx), lz = S * (a.hy - sh.T.cy), L = Math.hypot(lx, lz);
    var thW = Math.atan2(H[1] - sh.pz, H[0] - sh.px);                   // 船心 → 錨鏈孔 的方向：現在；turn(P) ＝ 錨鏈孔拉到 P 的話這個方向轉多少
    function turn(P) { var t = Math.atan2(P[1] - sh.pz, P[0] - sh.px) - thW; return Math.atan2(Math.sin(t), Math.cos(t)); }
    var dA = turn(Hn);
    if (Math.abs(tot - dA) > lim) {                                     // 拉得太猛（高速、或下沉那幾秒已經跑出鍊長）⇒ 錨在海底被拖著走：船只轉到上限，剩下那一段由錨過來補
      var lo = 0, hi = 1;                                               //   ⛔ 以前整段一步拉回 ⇒ 9 m/s 拋單錨，落底那一步航向跳 271°（Tim 2026-10-15「高船速時會發生很誇張的旋轉」）
      for (var it = 0; it < 12; it++) { var mid = (lo + hi) / 2; if (Math.abs(tot - turn([H[0] + (Hn[0] - H[0]) * mid, H[1] + (Hn[1] - H[1]) * mid])) <= lim) lo = mid; else hi = mid; }
      Hn = [H[0] + (Hn[0] - H[0]) * lo, H[1] + (Hn[1] - H[1]) * lo]; dA = turn(Hn);
      var ex = Hn[0] - a.A[0], ez = Hn[1] - a.A[1], el = Math.hypot(ex, ez);
      a.A = [Hn[0] - ex / el * r, Hn[1] - ez / el * r]; a.slip = (a.slip || 0) + el - r; drag = true; anchorSeat(a);   // 錨沿著鍊子的方向被拖過來，錨鏈孔剛好在鍊長上；拖到新的一點 ⇒ 重量水深（拖進深水 ⇒ 鍊子能拉的變短）
    }
    var thN = thW + dA;
    sh.yaw -= dA;                                                      // 世界的角度 ＝ 船身座標的角度 − yaw ⇒ 方向轉了 dA ＝ yaw 少 dA
    sh.px = Hn[0] - L * Math.cos(thN); sh.pz = Hn[1] - L * Math.sin(thN);   // 船心沿著那條線、離錨鏈孔還是原本的距離（剛體）
    tot -= dA;
  });
  if (taut) {                                                           // 動量留著、只被鍊子拖慢（⛔ 用船心被拉回後的位移重算速度 ⇒ 錨在正後方時速度一步歸零，船停死、一度都不轉）
    if (Math.abs(sh.spd) >= 0.6) sh.yawRate = clamp(tot / dt, -ANC_YAWMAX, ANC_YAWMAX);   //   轉動慣性 ＝ 這一步實際轉的（夾在上限內）；繞錨原地轉（< 0.6 m/s，31_sailing.js）⇒ 不改，照 A／D 給的
    //   ⛔ 原地轉也改 ⇒ 雙錨兩條都繃著時約束每一步把 A／D 轉的抵銷回去、慣性歸零 ⇒ 按住 A 10 秒轉 0°（1267b53 的回歸，以前 27.6°）
    sh.spd *= Math.max(0, 1 - dt / (drag ? ANC_DRAGX : ANC_DRAG));     //   ⇒ 下一步照舊往前走，約束再把那一段位移轉成旋轉：偏得越多轉得越快 ＝ 船尾甩出去；錨被拖著 ⇒ 掉得快
    sh.vel = mul(fwd(sh.yaw), sh.spd);
  }
  return taut;
}
/** 下方 6／7／8 的大圓鈕：咬著或下沉中 ⇒ 亮（on）、打壞 ⇒ 灰掉（dis，按了只會說拋不了）。每次 HUD 更新看一次（收著時被打掉也要灰）。
 *  6 ＝ 拋錨／起錨同一顆：有錨在水裡 ⇒ 亮、寫「起錨」；正在收 ⇒「起錨中」。 */
function anchorChips(me) {
  if (!me) return;
  var A = anchorsOf(me), w = anchorWet(me), b6 = $('ancAll');
  if (A.noAnchor) {                                                     // 整艘沒有錨：三顆都是停船（🛑；停著 ⇒ 亮）
    var st = SAIL === 'off';
    [b6, $('ancP'), $('ancS')].forEach(function (el) {
      if (!el) return; if (el.style.display) el.style.display = '';
      el.classList.toggle('on', st); el.classList.remove('dis');
      var sp = el.querySelector('i'); if (sp && sp.textContent !== '🛑') sp.textContent = '🛑';
    });
    return;
  }
  var aa = A.single ? '⚓' : '⚓⚓';                                       // 單錨：6 的圖示一個錨（TASK-0635）
  if (b6) { var a6 = anchor6(me).act; b6.classList.toggle('on', w); var l6 = a6 === 'weigh' && w ? aa + '⬆' : a6 === 'weigh' ? aa + '⏳' : aa, s6 = b6.querySelector('i'); if (s6 && s6.textContent !== l6) s6.textContent = l6; }   // 圖示（Tim 2026-10-15：兩個錨 ＝ 兩邊一起下）：⚓⚓ 拋（一邊在水裡 ⇒ 亮、按了拋另一邊）、⚓⚓⬆ 按了起錨、⚓⚓⏳ 起錨中
  ['P', 'S'].forEach(function (k) {
    var a = A[k], el = $('anc' + k); if (!el) return;
    var hid = A.single ? 'none' : ''; if (el.style.display !== hid) el.style.display = hid;   // 單錨：左右錨兩顆藏起來，只留 6（Tim：「只有單錨時 隱藏左右錨 只保留拋錨操作」）
    if (A.single) return;
    if (!a.broken && a.st === 'up' && !anchorAlive(me, a)) a.broken = true;
    el.classList.toggle('on', a.st === 'drop' || a.st === 'down'); el.classList.toggle('dis', a.broken);
    var an = k === 'P' ? '◀⚓' : '⚓▶', lb = an + (a.broken ? '✖' : a.st === 'drop' || a.st === 'down' ? '⬆' : a.st === 'weigh' ? '⏳' : '');   // 圖示：◀⚓ 左錨／⚓▶ 右錨，後面接 ⬆ 在水裡（按了起錨）、⏳ 起錨中、✖ 錨壞了
    var sp = el.querySelector('i'); if (sp && sp.textContent !== lb) sp.textContent = lb;
  });
}
/** 鐵鍊（TASK-0601；Tim 2026-10-15：繩的變體 —— 比較重、跟船體碰撞）：每條 CHAIN_SEG 節的質點鍊（Verlet），世界座標、每一步跟著船走（50_sim.js：stepShip 更新完 sh.M 之後）。
 *  ⛔ 只是畫面：不抽 rnd()、不回頭改船（戰局照 anchorStep 的鍊長約束）⇒ 拋不拋錨都不影響逐位元組。
 *  兩端：錨鏈孔（船身格座標 hx、hy、hz ⇒ 每一步照 sh.M 釘住）；錨 ——
 *    下沉中（drop）⇒ 從錨鏈孔落到海底（照時間，先慢後快）、鍊子跟著放出（放出長度 ＝ 鍊長 × 時間，追不上錨就照兩端的距離）；
 *    咬著（down）⇒ 釘在海底的錨點（a.A；拖錨時跟著移）；起錨中（weigh）⇒ 鍊子照時間收短、錨放開（很重：約束時只動 CH_ANCW 份），先在海底被拖過來、再被吊起來。
 *  物理：沒有風阻；水下（y 低於那一點的水面：0，大漩渦是漏斗的水面）浮力扣掉 1／7.8（鐵）、阻尼大（CH_DMPW）；約束 CHAIN_IT 次（幾乎不能伸長）；海底 ＝ anchorFloor（有海圖照地形），碰到就停住（磨擦：水平速度留 30%）。
 *  碰撞（只碰自己的船殼，Tim 拍板：不碰別艘）：每個質點、每一節的中點換到船身格座標查格；在格子裡 ⇒ 沿橫向（離中線的方向）推到最近的空格、速度吃掉七成。
 *    錨鏈孔旁的前兩節不查（錨鏈孔就在錨那團格子上 ⇒ 一定在格子裡）。?chainhit=0 ⇒ 不推（只數穿進去幾節，對照用）。
 *  斷鍊（錨被打壞）⇒ 那條鍊子兩端都放開、往下沉，CH_LOST 秒後拿掉（sh.chLost）。 */
var CHAIN_SEG = 24, CHAIN_IT = 12, CH_DMPA = 0.995, CH_DMPW = 0.96, CH_GW = G * (1 - 1 / 7.8), CH_ANCW = 0.15, CH_LOST = 10;
var CHAIN_HIT = Q.get('chainhit') !== '0', CH_PROF = { ms: 0, steps: 0 };
var CHAIN_C = [[0.2, 0.2, 0.22], [0.38, 0.37, 0.36]], CH_LINKS = 3, CH_LINK_W = 0.14;   // 每一節幾環（1.5 m ⇒ 一環 0.5 m）、環的半寬（公尺）
function chainNew(sh, a) {
  var W = M4.pt(sh.M, a.hx, a.hy, a.hz), n = CHAIN_SEG + 1, p = new Float64Array(n * 3);
  for (var i = 0; i < n; i++) { p[i * 3] = W[0]; p[i * 3 + 1] = W[1]; p[i * 3 + 2] = W[2]; }
  return { p: p, q: Float64Array.from(p), pay: 0, pen: 0, penSum: 0, penMax: 0, steps: 0, lost: false, t: 0 };
}
/** 一個點在不在船殼裡（換到格座標查格）；推 ⇒ 沿橫向推到最近的空格，回傳推完的世界座標（推不出去 ⇒ null）。 */
function chainHull(sh, x, y, z, push) {
  var l = M4.pt(sh.inv, x, y, z), gx = Math.floor(l[0]), gy = Math.floor(l[1]), gz = Math.floor(l[2]), g = sh.grid;
  if (!g.get(gx, gy, gz)) return false;
  if (!push) return true;
  var sg = l[1] >= sh.T.cy ? 1 : -1;
  for (var s = 1; s <= 60; s++) if (!g.get(gx, gy + sg * s, gz)) return M4.pt(sh.M, l[0], gy + sg * s + 0.5, l[2]);
  return true;
}
function chainSolve(sh, a, c, dt) {
  // 水面高度（大漩渦：漏斗那裡的水面，08_sea.js vxH；Tim 2026-10-18「漩渦內拋錨會飛到天上」⛔ 照 0 ⇒ 船在 −180 m，海底 −20 m 在頭頂上，錨鏈一路掛到天上）；沒有漩渦 ⇒ 0（跟以前一樣）
  //   海底 ＝ anchorFloor（大漩渦：漏斗的水面下 ANC_DEPTH；有海圖：真的海底，最深到 −ANC_DEPTH；都沒有：−ANC_DEPTH）
  var lv = function (x, z) { return VX ? vxH(x, z) : 0; };
  var N = CHAIN_SEG, p = c.p, q = c.q, sb = c.lost ? anchorFloor(p[N * 3], p[N * 3 + 2]) : anchorFloor(a.A[0], a.A[1]), W = null, E = null, i, o, it;   // sb：錨那一點的海底
  if (!c.lost) {
    W = M4.pt(sh.M, a.hx, a.hy, a.hz);
    if (a.st === 'drop') {
      var f = clamp(1 - (a.t - SIMT) / (a.fall || ANC_FALL), 0, 1); var y0 = a.y0 === null || a.y0 === undefined ? W[1] : a.y0; E = [a.A[0], y0 + (sb - y0) * Math.pow(f, 1.6), a.A[1]]; c.pay = Math.max(ANC_CHAIN * f, Math.hypot(E[0] - W[0], E[1] - W[1], E[2] - W[2]));
      if (!c.splash && E[1] <= seaH(E[0], E[2], SIMT)) { c.splash = true; splash(E, false); }   // 錨入水那一刻（抽亂數 ⇒ 只有拋了錨的局）
    }
    else if (a.st === 'down') { E = [a.A[0], sb, a.A[1]]; c.pay = Math.max(ANC_CHAIN, Math.hypot(E[0] - W[0], E[1] - W[1], E[2] - W[2])); }
    else c.pay = ANC_CHAIN * clamp((a.t - SIMT) / ANC_WEIGH, 0, 1);
  }
  var rest = Math.max(c.pay / N, 0.01), dt2 = dt * dt;
  for (i = 0; i <= N; i++) {                                            // 走一步（釘住的兩端等一下直接放）
    o = i * 3; var wet = p[o + 1] < lv(p[o], p[o + 2]), d = decay60(wet ? CH_DMPW : CH_DMPA, dt);   // 阻尼是 60 Hz 一步的（TASK-0798）
    var vx = (p[o] - q[o]) * d, vy = (p[o + 1] - q[o + 1]) * d, vz = (p[o + 2] - q[o + 2]) * d;
    q[o] = p[o]; q[o + 1] = p[o + 1]; q[o + 2] = p[o + 2];
    p[o] += vx; p[o + 1] += vy - (wet ? CH_GW : G) * dt2; p[o + 2] += vz;
  }
  function pin() { if (W) { p[0] = W[0]; p[1] = W[1]; p[2] = W[2]; } if (E) { o = N * 3; p[o] = E[0]; p[o + 1] = E[1]; p[o + 2] = E[2]; } }
  pin();
  for (it = 0; it < CHAIN_IT; it++) {
    for (i = 0; i < N; i++) {
      var wa = i === 0 && W ? 0 : 1, wb = i + 1 === N ? (E ? 0 : c.lost ? 1 : CH_ANCW) : 1; if (!(wa + wb)) continue;
      var ia = i * 3, ib = ia + 3, dx = p[ib] - p[ia], dy = p[ib + 1] - p[ia + 1], dz = p[ib + 2] - p[ia + 2], l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (l < 1e-9) continue;
      var k = (l - rest) / l / (wa + wb);
      if (wa) { p[ia] += dx * k * wa; p[ia + 1] += dy * k * wa; p[ia + 2] += dz * k * wa; }
      if (wb) { p[ib] -= dx * k * wb; p[ib + 1] -= dy * k * wb; p[ib + 2] -= dz * k * wb; }
    }
    pin();
  }
  var hit = 0, pen = 0;
  for (i = W ? 2 : 0; i <= N; i++) {                                    // 船殼：質點與每一節的中點
    o = i * 3;
    var sbo = VX || (BED && BED.A) ? anchorFloor(p[o], p[o + 2]) : sb;   // 這一節底下的海底（大漩渦：跟著漏斗；海圖：跟著地形）
    if (p[o + 1] < sbo) { p[o + 1] = sbo; q[o] = p[o] - (p[o] - q[o]) * 0.3; q[o + 1] = sbo; q[o + 2] = p[o + 2] - (p[o + 2] - q[o + 2]) * 0.3; }   // 海底：停住、水平留三成
    var h = chainHull(sh, p[o], p[o + 1], p[o + 2], CHAIN_HIT && !(i === N && E));
    if (h) { hit++; if (h !== true) { q[o] = h[0] - (p[o] - q[o]) * 0.3; q[o + 1] = h[1] - (p[o + 1] - q[o + 1]) * 0.3; q[o + 2] = h[2] - (p[o + 2] - q[o + 2]) * 0.3; p[o] = h[0]; p[o + 1] = h[1]; p[o + 2] = h[2]; } }
    if (i === N) break;
    var mx = (p[o] + p[o + 3]) / 2, my = (p[o + 1] + p[o + 4]) / 2, mz = (p[o + 2] + p[o + 5]) / 2, hm = chainHull(sh, mx, my, mz, CHAIN_HIT);
    if (hm) { hit++; if (hm !== true) { var ex = hm[0] - mx, ey = hm[1] - my, ez = hm[2] - mz; [o, o + 3].forEach(function (j) { if ((j === 0 && W) || (j === N * 3 && E)) return; p[j] += ex; p[j + 1] += ey; p[j + 2] += ez; q[j] += ex; q[j + 1] += ey; q[j + 2] += ez; }); } }
  }
  pin();
  for (i = W ? 2 : 0; i < N; i++) { o = i * 3; if (chainHull(sh, p[o + 3], p[o + 4], p[o + 5], false) || chainHull(sh, (p[o] + p[o + 3]) / 2, (p[o + 1] + p[o + 4]) / 2, (p[o + 2] + p[o + 5]) / 2, false)) pen++; }   // 推完還穿在船殼裡的節數（讀數）
  c.hit = hit; c.pen = pen; c.penSum += pen; c.penMax = Math.max(c.penMax, pen); c.steps++;
}
/** 每一步（50_sim.js，stepShip 之後 ⇒ sh.M 是這一步的）：在水裡的錨各一條、斷掉的往下沉。 */
function chainStep(sh, dt) {
  var ns = !SUBSTEP_OFF && dt > DT60 * 1.000001 ? Math.ceil(dt / DT60 - 1e-6) : 1;            // 步長變大 ⇒ 一小步最多 60 Hz 的一步（TASK-0797；Verlet 的鍊子步長大了會甩開）
  if (ns > 1) { for (var s = 0; s < ns; s++) chainStep(sh, dt / ns); return; }
  var A = sh.anc, t0 = performance.now();
  ['P', 'S'].forEach(function (k) {
    var a = A[k];
    if (a.st === 'up') { a.ch = null; if (a.m) a.m.ancD = null; return; }
    var c = a.ch || (a.ch = chainNew(sh, a));
    chainSolve(sh, a, c, dt);
    if (a.m) { var e = M4.pt(sh.inv, c.p[CHAIN_SEG * 3], c.p[CHAIN_SEG * 3 + 1], c.p[CHAIN_SEG * 3 + 2]); a.m.ancD = [e[0] - a.rx, e[1] - a.ry, e[2] - a.rz]; }   // 模型錨：整個搬到鍊子那一端畫、ring 落在鍊尾（60_render.js drawModels；沒有 ring ⇒ 模型頂的中心）
  });
  if (sh.chLost) for (var i = 0; i < sh.chLost.length; i++) { var c2 = sh.chLost[i]; if (SIMT > c2.t) { sh.chLost.splice(i--, 1); continue; } chainSolve(sh, null, c2, dt); }
  CH_PROF.ms += performance.now() - t0; CH_PROF.steps++;
}
/** 錨被打壞 ⇒ 那條鍊子放開、沉下去。 */
function chainCut(sh, a) {
  if (!a.ch) return;
  a.ch.lost = true; a.ch.t = SIMT + CH_LOST; (sh.chLost || (sh.chLost = [])).push(a.ch); a.ch = null;
  if (a.m) a.m.ancD = null;
}
/** 畫（每一格畫面重做）：鍊子的質點換到船身格座標（跟繩同一套 uModel），每一節分三環（菱形、相鄰轉 90°、深淺交錯 ⇒ 近看是一環扣一環）；錨是關聯（格子）或找不到 ⇒ 鍊子那一端畫一個線條的錨（錨桿、兩爪、橫桿）。 */
function chainBuf(sh) {
  var A = sh.anc, L = [], C = [];
  if (A) ['P', 'S'].forEach(function (k) { if (A[k].ch) C.push([A[k].ch, !A[k].m]); });
  (sh.chLost || []).forEach(function (c) { C.push([c, false]); });
  if (!C.length && !(sh.chain && sh.chain.n)) return;                 // 沒有鍊子放出去、上一份也是空的 ⇒ 不再每一格傳一份空的（60_render.js 照 n 畫）
  C.forEach(function (cc) {
    var c = cc[0], p = c.p, N = CHAIN_SEG, P = [], i;
    for (i = 0; i <= N; i++) P.push(M4.pt(sh.inv, p[i * 3], p[i * 3 + 1], p[i * 3 + 2]));
    var hw = CH_LINK_W / S;                                             // 環的半寬（格）
    for (i = 0; i < N; i++) chainLinks(L, P[i], P[i + 1], CH_LINKS, hw, 2, i * CH_LINKS);   // 船身格座標：+z 是上
    if (!cc[1]) return;
    var e = [p[N * 3], p[N * 3 + 1], p[N * 3 + 2]], dv = [e[0] - p[N * 3 - 3], e[1] - p[N * 3 - 2], e[2] - p[N * 3 - 1]], dl = Math.hypot(dv[0], dv[1], dv[2]);   // 錨：錨環在鍊子那一端，錨桿順著最後一節往外
    dv = dl > 0.05 ? [dv[0] / dl, dv[1] / dl, dv[2] / dl] : [0, -1, 0];
    var sd = Math.abs(dv[1]) > 0.9 ? [1, 0, 0] : norm([-dv[2], 0, dv[0]]), up = norm([dv[1] * sd[2] - dv[2] * sd[1], dv[2] * sd[0] - dv[0] * sd[2], dv[0] * sd[1] - dv[1] * sd[0]]);
    function w(t, s, u) { return M4.pt(sh.inv, e[0] + dv[0] * t + sd[0] * s + up[0] * u, e[1] + dv[1] * t + sd[1] * s + up[1] * u, e[2] + dv[2] * t + sd[2] * s + up[2] * u); }
    var ic = [0.16, 0.16, 0.18];
    [[w(0, 0, 0), w(3.6, 0, 0)], [w(3.6, 0, 0), w(2.7, 1.3, 0)], [w(3.6, 0, 0), w(2.7, -1.3, 0)], [w(2.7, 1.3, 0), w(2.4, 1.6, 0)], [w(2.7, -1.3, 0), w(2.4, -1.6, 0)], [w(0.4, 0, 1.5), w(0.4, 0, -1.5)]].forEach(function (s) {
      L.push(s[0][0], s[0][1], s[0][2], ic[0], ic[1], ic[2], s[1][0], s[1][1], s[1][2], ic[0], ic[1], ic[2]);
    });
  });
  sh.chain = upload(sh.chain, new Float32Array(L), 6, [[0, 3, 0], [2, 3, 3]]);
}
/** 一段鍊子 A→B 分 n 環推進 L（線段＋色）：菱形（頭、一側、尾、另一側），相鄰兩環轉 90° 交錯、深淺交錯（CHAIN_C）。
 *  hw：環的半寬（跟 A、B 同單位）；up：哪一軸是上（船身格座標 2、世界 1）；k0：第一環的編號（接著上一段交錯）。錨鍊（chainBuf）與鏈彈（csBuf）共用。 */
function chainLinks(L, A, B, n, hw, up, k0) {
  var d = sub(B, A), dl = len(d); if (dl < 1e-6) return;
  d = mul(d, 1 / dl);
  var n1 = Math.abs(d[up]) > 0.9 ? [1, 0, 0] : up === 2 ? norm([d[1], -d[0], 0]) : norm([-d[2], 0, d[0]]), n2 = [d[1] * n1[2] - d[2] * n1[1], d[2] * n1[0] - d[0] * n1[2], d[0] * n1[1] - d[1] * n1[0]];
  for (var j = 0; j < n; j++) {
    var a = lerp3(A, B, j / n), b = lerp3(A, B, (j + 1) / n), m = lerp3(a, b, 0.5), k = k0 + j, u = k & 1 ? n2 : n1, col = CHAIN_C[k & 1];
    var s1 = add(m, mul(u, hw)), s2 = add(m, mul(u, -hw));
    [[a, s1], [s1, b], [b, s2], [s2, a]].forEach(function (e) { L.push(e[0][0], e[0][1], e[0][2], col[0], col[1], col[2], e[1][0], e[1][1], e[1][2], col[0], col[1], col[2]); });
  }
}
/** 鏈彈的鐵鍊（21_gunnery.js csBar）：每一顆鏈彈，兩顆彈之間一條錨鍊那樣的鍊子（世界座標、每一格畫面重做）。兩顆彈本身照砲彈的點畫（60_render.js）。
 *  環比錨鍊細、短（CS_LINK 公尺一環、半寬 CS_LINK_W）—— 鏈彈的鍊子是一門砲塞得進去的那種。
 *  鍊子是鬆的（Tim 2026-10-17：「轉起來有點像棍子而非鐵鍊(兩條拉成直線了)」）：比兩顆彈的距離長 CS_SLACK 倍 ⇒ 垂成一道弧（垂度照弧長與弦長的拋物線近似）；
 *  弧往後拖（風阻：飛行的反方向）、也落後旋轉（轉的反方向），弧的方向來回擺、再疊一道 S 形的抖 ⇒ 轉起來是一條甩著的鍊子。只是畫：命中照舊是兩顆彈之間那一根（csBar）。 */
var CS_LINK = 0.3, CS_LINK_W = 0.07, CS_SLACK = 1.2, CSL = null, CS_ID = null;   // CS_ID：畫的時候的 uModel（單位矩陣，60_render.js）
function csBuf() {
  var L = [], r = 0.1;                                                   // r：鍊子從彈的表面接出去（彈半徑大約）
  BALLS.forEach(function (b) {
    if (b.ammo !== 2 || !b.alive) return;
    var w = csBar(b), h = CS_HALF - r, A = [b.p[0] - w[0] * h, b.p[1] - w[1] * h, b.p[2] - w[2] * h], B = [b.p[0] + w[0] * h, b.p[1] + w[1] * h, b.p[2] + w[2] * h];
    var c = 2 * h, sag = Math.sqrt(0.375 * c * c * (CS_SLACK - 1)), n = Math.max(4, Math.round(c * CS_SLACK / CS_LINK)), ph = b.ph || 0;
    var vl = len(b.v) || 1, bk = mul(b.v, -1 / vl), tg = norm(cross(bk, w));   // bk：往後（飛行的反方向）；tg：垂直鍊子與飛行方向（± 旋轉的切向）
    var sw = 0.45 * Math.sin(b.age * 9 + ph), bd = add(mul(bk, Math.cos(0.9 + sw)), mul(tg, Math.sin(0.9 + sw)));   // 弧的方向：後拖與落後旋轉之間，來回擺
    var sd = norm(cross(w, bd)), wob = 0.14 * Math.sin(b.age * 14 + ph * 2), P = [];   // sd：S 形抖的方向
    for (var i = 0; i <= n; i++) { var t = i / n, k = sag * 4 * t * (1 - t), q = wob * Math.sin(6.28319 * t); P.push(add(lerp3(A, B, t), add(mul(bd, k), mul(sd, q)))); }
    for (i = 0; i < n; i++) chainLinks(L, P[i], P[i + 1], 1, CS_LINK_W, 1, i);
  });
  CSL = upload(CSL, new Float32Array(L), 6, [[0, 3, 0], [2, 3, 3]]);
  return CSL;
}
/** HUD 一段：兩個錨的狀態。 */
function anchorText(sh) {
  var A = sh.anc; if (!A) return '';
  var w = { up: '', drop: '下沉中', down: '咬住', weigh: '起錨中' }, dp = BED && BED.A;   // 有海圖 ⇒ 咬住的錨後面寫水深
  return ['P', 'S'].map(function (k) { var a = A[k], nm = A.single ? '錨' : k === 'P' ? '左錨' : '右錨'; return a.broken ? nm + '×' : w[a.st] ? nm + w[a.st] + (dp && a.st === 'down' && a.dep !== undefined ? ' ' + (a.dep >= ANC_DEPTH ? '≥' + ANC_DEPTH : a.dep.toFixed(1)) + ' m' : '') : ''; }).filter(Boolean).join('　');
}
