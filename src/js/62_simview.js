// ───────────────────────── 模擬物件給人看的那一半（TASK-0669 第二段） ─────────────────────────
// 區塊職責：裝甲（含會轉的體素件）、碎塊、模型、門、俥鐘、空艙房的除錯外框 —— 模擬檔管它們打掉幾格、在哪、轉多少；這裡管網格、上 GPU、畫、重建、丟。
// 物理意義：以前這些寫在 21_gunnery、24_armor、25_doors、31_drive（俥鐘）、36_rooms（除錯外框）裡，模擬檔因此直接叫 15_smooth、60_render、74_cutaway、81_fps、11_rig_gpu 的函式。
//   現在模擬檔只發事件（00_events.js）：armorShip（開船：每塊掛網格與平滑面）、armCell／cell（打掉一格：附近的區重建）、pieceNew／pieceGone（碎塊）、phys（物理開關）；
//   這裡訂閱（view：無頭時不收 ⇒ 不建網格、不上 GPU）。函式本身照舊（搬家不改內容），誰叫它們寫在每一段的說明裡。
// ⛔ 模擬物件身上還掛著畫的狀態（sh.rs、a.rs、pc.rs、a.smR…）：模擬檔不讀它們；無頭時它們不存在 ⇒ 會碰到的地方（70_flow.js reset、armDispose）先看有沒有。

// ── 裝甲（24_armor.js）──
/** 船型 T 的裝甲上 GPU（05_hull.js「船體網格」那一步，smoothSetup 之後）：每塊一份合併網格與平滑面（開戰時每艘共用，被打到的區才各自重建）。
 *  平滑面的格角碰到船殼（T.hullG）⇒ 釘在格角上（跟拆出來之前一樣：圓筒底那一圈貼著甲板、不往上縮）。 */
function armorMesh(T) {
  (T.armor || []).forEach(function (A) {
    A.rs0 = new VK.RegionSet(gl, A.grid, QIDX); A.rs0.buildAll();
    A.smP = null; if (!T.smRK) return;
    var nx = Math.ceil(T.h.size[0] / SM_R), ny = Math.ceil(T.h.size[1] / SM_R), b = A.bb;
    A.smP = new Map();
    T.smRK.forEach(function (rk) {
      var rx = rk % nx, ry = Math.floor(rk / nx) % ny, rz = Math.floor(rk / (nx * ny));   // 區碰不到這塊的外框（±2 格：surface nets 看鄰格）⇒ 跳過
      if ((rx + 1) * SM_R < b[0] - 2 || rx * SM_R > b[3] + 2 || (ry + 1) * SM_R < b[1] - 2 || ry * SM_R > b[4] + 2 || (rz + 1) * SM_R < b[2] - 2 || rz * SM_R > b[5] + 2) return;
      var m = smBuild(T, A.grid, rk, null, T.hullG, undefined, true); if (m) A.smP.set(rk, m);
    });
    smArena(A.smP);                                                     // 這塊的平滑面接成一份（15_smooth.js，S10）
  });
  (T.props || []).forEach(function (P) {                                // 會轉的體素件（螺旋槳；檔尾）：材質標 smooth（鐵甲）⇒ 整份平滑＋金屬反光（Tim 2026-10-17），方塊網格化跳過它們
    var mt = matInfo(P.mat); P.smP = P.smRK = P.smO = null;
    if (mt.smooth === true) { P.grid.sm = P.grid; P.smO = { SG: P.grid, mm: +mt.metal || 0, mr: isFinite(+mt.rough) && mt.rough !== undefined ? +mt.rough : 0.5 }; P.smRK = smRegions(T, P.grid); P.smP = new Map();
      P.smRK.forEach(function (rk) { var m = smBuild(T, P.grid, rk, null, null, P.smO, true); if (m) P.smP.set(rk, m); }); smArena(P.smP); }
    P.rs0 = new VK.RegionSet(gl, P.grid, QIDX); P.rs0.buildAll();
  });
}
evOn('armorShip', function (sh) {                                     // 開船（24_armor.js armorShip）：每塊共用船型那一份網格與平滑面，被打到的區才各自重建
  sh.arm.forEach(function (a) { if (a.rs) return; a.rs = new VK.RegionSet(gl, a.grid, QIDX); a.rs.shareFrom(a.A.rs0); smShare(a, a.A.smP); });
}, 0, true);
evOn('armCell', function (a, x, y, z) { a.rs.touch(x, y, z); if (a.smD) smTouch(a, x, y, z); }, 0, true);   // 打掉裝甲的一格（24_armor.js armRemove）
/** 畫船殼那一趟（60_render.js drawHulls，cutSet 之後）：每塊照自己的矩陣畫；剖面 uCutL ＝ 裝甲 → 船的格座標（01_gl.js voxFS），畫完放回單位矩陣。
 *  寫 uCutL ⇒ cutSet 記的「已經是關」作廢（prog.cut0，74_cutaway.js）。 */
function armDraw(prog, sh) {
  prog.cut0 = false;
  sh.arm.forEach(function (a) {
    if (a.prop && propGone(a)) return;                                  // 螺旋槳的模型掉了（掛的那一格被打斷）⇒ 不畫（飛出去的是模型的網格，21_gunnery.js blowModel）
    var L = armLocal(a);
    gl.uniformMatrix4fv(prog.u.uModel, false, L ? M4.mul(sh.M, L) : sh.M);
    if (prog.u.uCutL) gl.uniformMatrix4fv(prog.u.uCutL, false, L || CUT_ID);
    rbatHull(a.rs, a.A.rs0);                                            // 沒被打到的區照船型那一塊的合併緩衝一段一次畫（60_rbatch.js，S8）
  });
  if (prog.u.uCutL) gl.uniformMatrix4fv(prog.u.uCutL, false, CUT_ID);
}
// 平滑面：模型那一段的表照 armM(a) 畫（60_rbatch.js rbatShip；螺旋槳掉了 ⇒ 不畫）；P.tri 的剖面照世界座標換回船的格座標（uCutInv ＝ sh.inv）⇒ 轉過也切得對。
/** 重網格化（60_render.js remesh）：方塊照預算、平滑面照 sl 區；回 [剩的預算, 剩的區]。 */
function armRemesh(sh, left, sl) {
  sh.arm.forEach(function (a) {
    if (left > 0 && a.rs.dirty.size) left -= rsFlushSome(a.rs, left);
    if (sl > 0 && a.smD && a.smD.size) sl -= smFlush(a, sl);
  });
  return [left, sl];
}
/** 重開一場（70_flow.js reset）：這艘自己的緩衝丟掉（共用船型的那幾份不動）。 */
function armDispose(sh) {
  if (!sh.arm) return;
  sh.arm.forEach(function (a) { if (a.rs) a.rs.dispose(); if (a.smR) a.smR.forEach(function (m) { if (m.own) smFree(m); }); });
}

// ── 船殼與碎塊（20_shatter.js、22_pieces.js）──
evOn('cell', function (sh, x, y, z, tint) {   // 打掉船殼的一格（20_shatter.js removeVoxel）：附近的區重建；tint ＝ 只換色（燒焦，49_burn.js burnTint、57_core.js）
  sh.rs.touch(x, y, z);
  if (sh.smD && !(tint && !((sh.smO && sh.smO.SG) || sh.T.smG).get(x, y, z))) smTouch(sh, x, y, z);   // 換色的不是平滑格 ⇒ 平滑面一點都不變（形狀只看有沒有格、顏色只取平滑格自己的）⇒ 不重建（光榮號燒木甲板：一格換色就重建一整區 64³，每格畫面 3 區 ≈ 20 ms）
  if (sh.T.glsG && (!tint || sh.T.glsG.get(x, y, z))) glsTouch(sh, x, y, z);   // 玻璃（15_smooth.js）：打掉的格碰到玻璃 ⇒ 玻璃網格重建；換色只看玻璃自己那一格
}, 0, true);
evOn('pieceNew', function (pc) { pc.rs = new VK.RegionSet(gl, pc.grid, QIDX); rsAllDirty(pc.rs); }, 0, true);   // 網格分批建（60_render.js remesh；⛔ buildAll ⇒ 十萬格的半截船那一格卡上百 ms）
evOn('pieceGone', function (pc) { if (pc.rs) pc.rs.dispose(); }, 0, true);   // 沉下去、漂走（50_sim.js step）

// ── 模型網格（05_hull.js「模型網格」那一步；家具 36_rooms.js furnMesh 只算三角形與佔格，第一次畫到才上傳）──
function buildMeshes(H, C) {      // 船型 H 的每份模型網格一個 VAO：三角形展開、平面法線、材質色（P.tri 畫）；C ＝ 快取的 [{ tri, occ }]（06_cache.js）
  H.meshes = []; var keep = [], SK = H.h && H.h.meshShape, first = {};
  (H.rig.meshes || []).forEach(function (m, k) {
    if (H.meshSkip && H.meshSkip[k]) { H.meshes.push(null); keep.push(null); return; }   // 模型、裝飾都沒用到（05_hull.js decoSplit）⇒ 不建、不上 GPU
    var sk = meshShareKey(H, SK, k), f = sk !== null ? first[sk] : undefined;
    if (f !== undefined) {                                               // 同一個形狀、只差起點（TASK-0795）⇒ 跟第一份共用 VAO，差的那一點（dt）畫的時候乘進矩陣（rbatShip 等 meshDtL）
      var m0 = H.rig.meshes[f], up0 = H.meshes[f], occ = C ? C[k].occ : meshOcc(m);
      H.meshes.push({ vao: up0.vao, vbo: up0.vbo, n: up0.n, occ: occ, bb: up0.bb, dt: [m.verts[0] - m0.verts[0], m.verts[1] - m0.verts[1], m.verts[2] - m0.verts[2]], share: f });
      keep.push({ tri: null, occ: occ }); return;                        // 佔格照自己的網格（模擬不知道共用這回事）；bb 照共用的那一份（矩陣已經含 dt）
    }
    var d = C ? C[k] : { tri: meshTriFor(H, k, m), occ: meshOcc(m) };   // meshTriFor：火藥桶這類 render=lathe 的換成車床式（62_lathe.js；佔格照原本的網格）
    if (!C && d.tri.shellTex) d.tex = d.tri.shellTex;                    // 外殼式（62_shell.js）：貼圖跟著存進快取；快取讀回來的 ⇒ 照這一次排的層改頂點
    else if (C && d.tex) shellRelayer(d.tri, d.tex);
    var up = upload(null, d.tri, 9, [[0, 3, 0], [1, 3, 3], [2, 3, 6]]);
    up.occ = d.occ; up.bb = meshBB(d.tri); H.meshes.push(up); keep.push(d);
    if (sk !== null) first[sk] = k;
  });
  if (H.keep) H.keep.models = keep;
}
// ── 只差起點的網格共用一份 GPU 網格（TASK-0795；Tim 2026-10-21「合批邏輯且改變像素結果 這個沒問題 我看過就ok」）──
// 成品的網格池（admin.py pack_html，TASK-0667）把「只差起點」的網格存成同一格＋各自的起點 ⇒ 載入時還原成好幾份（meshPool：一個 (格, 起點) 一份）。
//   火藥桶縮小 0.2 倍、擺在 0.2 格的位置 ⇒ 起點的小數 x、y 各 5 種 ⇒ 一艘 25 份一模一樣的桶 ⇒ 合批（60_rbatch.js 照 VAO 分組）分成 25 組。
// ⇒ 同一格（h.meshShape）、同一種畫法（車床式與否、哪一種參數）的第二份起：VAO 跟第一份共用，記下差的那一點 dt（頂點 ＝ 第一份 ＋ dt），
//   畫的時候模型矩陣右邊多乘 trans(dt)（meshDtL）⇒ 同一型的桶一個 VAO、合批一組；車床式也只算一次。
//   ⛔ 只換畫面：佔格 occ 照自己的網格（家具擋格、站位、砲線不變）。頂點位置換成「矩陣裡加 dt」⇒ 跟原本差浮點捨入（Tim：看過就好）。
/** 第 k 份網格共用的鍵（同一格＋畫法）；不能共用 ⇒ null。 */
function meshShareKey(H, SK, k) {
  if (!SK || k >= SK.length || !(SK[k] >= 0)) return null;
  var L = meshAlgo(H, k);                                               // 同一格、同一種算法（62_lathe.js：車床式、輪式連參數、長桿式）才共用
  return SK[k] + '|' + (!L ? 'V' : L.alg === 'lathe' ? 'L' + L.n + ',' + L.ax : L.alg === 'wheel' ? 'W' + L.n + ',' + L.ax : L.alg === 'pole' ? 'P' : 'S');
}
var MESH_DT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), MESH_DTQ = new Float32Array(16);
/** 同 meshDtL，配置新的一份（?rbchk=1 對拍、觀察模式的高亮：每格少數幾件）。 */
function meshDtM(me, L) { return me && me.dt ? M4.mul(L, trans(me.dt[0], me.dt[1], me.dt[2])) : L; }
/** 模型的局部矩陣 L ⇒ 畫這份網格用的（共用別份的 ⇒ L·trans(dt)，寫進 out（沒給 ⇒ 共用的暫存）；沒共用 ⇒ L 原樣）。 */
function meshDtL(me, L, out) {
  if (!me || !me.dt) return L;
  MESH_DT[12] = me.dt[0]; MESH_DT[13] = me.dt[1]; MESH_DT[14] = me.dt[2];
  return m4Into(out || MESH_DTQ, 0, L, MESH_DT);
}
var MESH_ATTR = [[0, 3, 0], [1, 3, 3], [2, 3, 6]];
/** 還沒上 GPU 的網格（36_rooms.js furnMesh 只留 tri、occ）⇒ 上傳（60_render.js 畫模型前叫）。 */
function meshGpu(me) { var u = upload(null, me.tri, 9, MESH_ATTR); me.vao = u.vao; me.vbo = u.vbo; me.n = u.n; me.bb = meshBB(me.tri); me.tri = null; }
/** 網格自己的包圍盒（模型座標；三角形展開、一個頂點 9 個 float、位置在前 3 個）⇒ [lx, ly, lz, hx, hy, hz]：反射、主畫面一次畫多個判「離得夠不夠開」用（60_rbatch.js rbatBoxes）。 */
function meshBB(t) {
  var b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (var i = 0; i < t.length; i += 9) for (var j = 0; j < 3; j++) { var v = t[i + j]; if (v < b[j]) b[j] = v; if (v > b[3 + j]) b[3 + j] = v; }
  return b[0] <= b[3] ? b : null;
}

// ── 門（25_doors.js）──
/** 畫面那一格（90_main.js frame）：有人經過 ⇒ 開、沒人 ⇒ 關。只寫 m.sw／spv／sax（畫，modelLocal）。 */
function doorsAnim(dt) {
  SHIPS.forEach(function (sh) {
    if (!sh.doors) return;
    sh.doors.forEach(function (d) {
      var m = d.m; if (!m.alive || !d.a) return;
      var near = GFX.door && shPassers(sh, function (p) {                 // 經過 ＝ 正在走、正在爬（站著不動的不算）；第一人稱的玩家也算（81_fps.js shPassers）
        return Math.hypot(p[0] - m.c[0], p[1] - m.c[1]) < DOOR_R && Math.abs(p[2] - d.zt) < DOOR_RZ;
      });
      if (near) d.hold = DOOR_HOLD; else d.hold -= dt;
      d.t = GFX.door ? clamp(d.t + (d.hold > 0 ? 1 : -1) * DOOR_SP * dt, 0, 1) : 0;
      var e = d.t * d.t * (3 - 2 * d.t);                                  // 起步、停下都慢一點
      m.sw = e * d.deg; m.spv = d.a; m.sax = d.ax;
    });
  });
}

// ── 物理開關（30_rig_physics.js setPhys）──
evOn('phys', function () { $('physT').classList.toggle('on', PHYS); }, 0, true);   // 物理設定頁（外殼）自己另外訂

// ── 俥鐘與詳細資訊那一行（31_drive.js；61_hud.js 叫 driveText、teleDraw）──
/** 詳細資訊那一行：額外動力的俥鐘與輸出。 */
function driveText(sh) {
  var D = sh.drive; if (!D || !D.kind) return '';
  var nm = D.kind === 'magic' ? '魔力' : D.kind === 'oar' ? '划槳' : '引擎';
  var pr = D.P.filter(function (p) { return p.ax; });
  return '⚙ ' + TELE_NAME[sh.tele] + '（' + nm + ' ' + Math.round(D.cap * 100) + '%' + (D.cap < 0.98 && Math.abs(D.want || 0) > D.cap + 0.005 ? '・給不足' : '') +
    (pr.length ? '・螺旋槳 ' + pr.map(function (p) { return p.m.alive && !p.m.moved ? Math.round(Math.abs(p.rpm)) + ' rpm' : '沒了'; }).join('／') : '') + '）';
}
/** 羅盤上方那一行俥鐘後面的出力（Tim 2026-10-18「引擎(槳)受損後 是否能額外顯示出力百分比(參考帆)」）：受損了（31_drive.js D.cap ＜ 99.5%：每個動力源「份數 × 完好度」合起來，
 *  引擎、鍋爐、螺旋槳、煙囪、槳都算）才寫「 73%」；完好 ⇒ ''（只讀模擬）。 */
function driveCapText(sh) { var D = sh.drive; return D && D.kind && D.cap < 0.995 ? ' ' + Math.round(D.cap * 100) + '%' : ''; }
// ── 俥鐘（#teleBox：上 E、下 T 兩顆鍵帽夾著 canvas 點陣圖；先畫在低解析度的格子上、放大不平滑 ⇒ 像素風；字照正常解析度蓋上去） ──
// 位置（Tim 2026-10-16：「俥鐘 可以先放到左側按鈕上方 然後可以稍微縮小一些 並且在上下顯示快捷鍵」「橫版的話 就放在左下角吧」）：
//   橫版 ⇒ 畫面左下角（CSS #teleBox；除錯那一行 #tip 上面）；直版手機（≤ 760 px，左邊那組大圓鈕是直的一欄）⇒ 貼在那一欄的正上方（teleFit 每格照按鈕的位置擺）。
var TELE_W = 34, TELE_H = 112, TELE_PX = 2;                              // 畫面上的寬高（CSS px）；點陣的一格 ＝ 2 px
var TELE_NARROW = window.matchMedia ? window.matchMedia('(max-width:760px)') : null;
function teleY(i) { return 10 + (TELE_H - 20) * i / (TELE.length - 1); }  // 第 i 格的高度（CSS px）
/** 直版：貼在左邊那一欄大圓鈕（#helmL）的正上方、置中；橫版：左下角（CSS），下面那排大圓鈕（#ctlRow）伸到左邊、會碰到 ⇒ 抬到那排上面（⛔ 800 px 寬時那排鋪滿整個寬度，俥鐘被 A 蓋住）。 */
function teleFit(box) {
  var L = '', B = '', r;
  if (TELE_NARROW && TELE_NARROW.matches) {
    var h = $('helmL'); if (!h) return;
    r = h.getBoundingClientRect(); var s = stageBox(); L = Math.round(r.left - s.left + (r.width - box.offsetWidth) / 2) + 'px'; B = Math.round(s.bottom - r.top + 6) + 'px';   // left／bottom 是相對 #stage（安全區收過邊，stageBox）
  } else {
    var row = $('ctlRow'); r = row && row.getBoundingClientRect();
    if (r && r.width && r.left - stageBox().left < 12 + (box.offsetWidth || 40) + 8) B = Math.round(stageBox().bottom - r.top + 6) + 'px';
  }
  if (box.style.left !== L || box.style.bottom !== B) { box.style.left = L; box.style.bottom = B; }
}
function teleDraw(sh) {
  var c2 = $('telc'), box = $('teleBox'); if (!c2 || !box) return;
  var show = !!(sh && sh.cfg && sh.cfg.base > 0) && RUNNING;
  if (box.style.display !== (show ? '' : 'none')) box.style.display = show ? '' : 'none';
  if (show) teleFit(box);
  var ob = $('obsB');                                                     // 觀察模式那一行（meadow 7e1f879，72_floodui.js；也在左下角）：俥鐘在 ⇒ 挪到俥鐘右邊、不在 ⇒ 照她的 CSS
  if (ob) { var oL = show ? Math.round(box.getBoundingClientRect().right + 8) + 'px' : ''; if (ob.style.left !== oL) ob.style.left = oL; }
  if (!show) return;
  var dpr = Math.min(window.devicePixelRatio || 1, 2), W = TELE_W, H = TELE_H;
  if (c2.width !== W * dpr || c2.height !== H * dpr) { c2.width = W * dpr; c2.height = H * dpr; }
  var lw = W / TELE_PX, lh = H / TELE_PX, lo = c2.lo || (c2.lo = document.createElement('canvas'));
  if (lo.width !== lw || lo.height !== lh) { lo.width = lw; lo.height = lh; }
  var q = lo.getContext('2d'); q.clearRect(0, 0, lw, lh);
  // 黃銅外框、象牙色面板：前進（上）白底、停俥一條、後退（下）紅底
  q.fillStyle = '#5a3d12'; q.fillRect(0, 0, lw, lh);
  q.fillStyle = '#b8862e'; q.fillRect(1, 1, lw - 2, lh - 2);
  q.fillStyle = '#e8dfc4'; q.fillRect(3, 3, lw - 6, lh - 6);
  var ys = function (i) { return Math.round(teleY(i) / TELE_PX); }, stopI = TELE.indexOf(0) >= 0 ? TELE.indexOf(0) : (TELE.length - 1) / 2;
  q.fillStyle = '#c9493a'; q.fillRect(3, ys(stopI) + 3, lw - 6, lh - 6 - ys(stopI));
  q.fillStyle = '#222'; for (var i = 0; i < TELE.length; i++) q.fillRect(3, ys(i), 4, 1);
  q.fillRect(3, ys(stopI) - 1, lw - 6, 2);
  // 撥桿：黃銅的把手在現在那一格
  var cur = sh.tele, py = ys(cur), lit = performance.now() - (sh.teleT || -1e9) < 250;
  q.fillStyle = '#3b2a0c'; q.fillRect(lw - 6, 3, 2, lh - 6);             // 撥桿的槽（右邊）
  q.fillStyle = lit ? '#fff1a8' : '#e2b13c'; q.fillRect(lw - 9, py - 2, 7, 4);
  q.fillStyle = '#7a5a18'; q.fillRect(lw - 9, py + 2, 7, 1);
  var g = c2.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c2.width, c2.height);
  g.imageSmoothingEnabled = false; g.drawImage(lo, 0, 0, c2.width, c2.height);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.font = 'bold 8px sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
  var LB = ['全', '半', '慢', '微', '停', '微', '慢', '半', '全'];
  for (i = 0; i < TELE.length; i++) { g.fillStyle = i === cur ? '#000' : i > stopI ? '#fff' : '#3a2a10'; g.fillText(TELE.length === 9 ? LB[i] : (Math.round(Math.abs(TELE[i]) * 100) + ''), 7, teleY(i)); }
  var D = sh.drive;
  if (D && D.cap < 0.98) { g.fillStyle = 'rgba(0,0,0,.55)'; var cy = teleY(stopI), up = (cy - teleY(0)) * (1 - Math.sqrt(D.cap)); g.fillRect(3, teleY(0) - 5, 3, up + 1); g.fillRect(3, teleY(TELE.length - 1) + 5 - up, 3, up); }   // 給不出的那幾格（受損）：左邊一條暗的
}
/** 點或拖俥鐘：照按到的高度挑最近的那一格。 */
(function () {
  var c2 = $('telc'); if (!c2) return;
  var down = false;
  function pick(e) {
    var me = SHIPS[PLAYER_I]; if (!me || !RUNNING) return;
    var r = c2.getBoundingClientRect(), y = (e.clientY - r.top) / (r.height || 1) * TELE_H, best = 0, bd = 1e9;
    for (var i = 0; i < TELE.length; i++) { var d = Math.abs(teleY(i) - y); if (d < bd) { bd = d; best = i; } }
    teleSet(me, best);
  }
  c2.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); down = true; try { c2.setPointerCapture(e.pointerId); } catch (x) { } pick(e); });
  c2.addEventListener('pointermove', function (e) { if (down) pick(e); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (ev) { c2.addEventListener(ev, function () { down = false; }); });
})();

// ── 空艙房的除錯外框與名字（36_rooms.js；60_render.js 叫 roomLines、61_hud.js／__game.rooms 叫 roomLabels）──
/** 除錯的外框：每一間 12 條邊（格的外緣：min .. max + 1），船的座標；畫法跟繩一樣（60_render.js）。 */
function roomLines(sh) {
  var L = [], c = [0.35, 0.95, 1];
  sh.rooms.forEach(function (r) {
    var a = r.min, b = [r.max[0] + 1, r.max[1] + 1, r.max[2] + 1], P = [];
    for (var i = 0; i < 8; i++) P.push([i & 1 ? b[0] : a[0], i & 2 ? b[1] : a[1], i & 4 ? b[2] : a[2]]);
    [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(function (e) {
      L.push(P[e[0]][0], P[e[0]][1], P[e[0]][2], c[0], c[1], c[2], P[e[1]][0], P[e[1]][1], P[e[1]][2], c[0], c[1], c[2]);
    });
  });
  sh.roomLines = upload(sh.roomLines, new Float32Array(L), 6, [[0, 3, 0], [2, 3, 3]]);
}
/** 除錯的名字：每一間的中心投到畫面上（每一格 HUD 那一拍更新）。 */
function roomLabels() {
  var box = $('roomLbl');
  if (!ROOMS_DBG) { if (box) box.innerHTML = ''; return; }
  if (!box) { box = document.createElement('div'); box.id = 'roomLbl'; box.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;font:11px sans-serif;color:#7ff;text-shadow:0 0 2px #000,0 0 2px #000'; $('stage').appendChild(box); }
  var sb = stageBox(), W = sb.width, H = sb.height, vp = CAM.vp, html = '';   // 標籤放在 #stage 裡 ⇒ 照它的大小（安全區收過邊）
  SHIPS.forEach(function (sh) {
    if (sh.sunk || !sh.rooms) return;
    sh.rooms.forEach(function (r) {
      var w = M4.pt(sh.M, (r.min[0] + r.max[0] + 1) / 2, (r.min[1] + r.max[1] + 1) / 2, r.max[2] + 1);
      var cx = vp[0] * w[0] + vp[4] * w[1] + vp[8] * w[2] + vp[12], cy = vp[1] * w[0] + vp[5] * w[1] + vp[9] * w[2] + vp[13], cw = vp[3] * w[0] + vp[7] * w[1] + vp[11] * w[2] + vp[15];
      if (cw <= 0.1) return;
      var sx = (cx / cw + 1) / 2 * W, sy = (1 - cy / cw) / 2 * H;
      if (sx < -50 || sx > W + 50 || sy < -20 || sy > H + 20) return;
      html += '<span style="position:absolute;left:' + sx.toFixed(0) + 'px;top:' + sy.toFixed(0) + 'px;transform:translate(-50%,-100%)">' + r.name.split('/').slice(-2).join('/') + (r.type ? '・' + ROOM_FN[r.type].name + ' ' + r.furn.filter(function (m) { return m.alive; }).length + '／' + r.furn.length : '') + '</span>';
    });
  });
  if (box.innerHTML !== html) box.innerHTML = html;
}

// ── 砲長的選單（51_captain.js；71_input.js 細節設定頁叫）──
/** 細節設定的砲長選單：選項 ＝ 隨機 ＋ 各砲長（說明當 title）。 */
function capOptions(sel, v) {
  sel.innerHTML = '<option value="random">隨機</option>' + CAP_KEYS.map(function (k) { return '<option value="' + k + '" title="' + CAPTAINS[k].tip + '">' + CAPTAINS[k].name + '（' + CAPTAINS[k].tip + '）</option>'; }).join('');
  sel.value = v;
}
