// ───────────────────────── 砲帶的裝甲（TASK-0631；Tim 2026-10-16：砲可以帶額外的裝甲（格子的子模組）—— 跟著砲轉、一格一格打掉、材質照材質表的鐵；第一個用的是莫尼特號的砲塔圓筒與頂）─────────────────────────
// 標法（雕刻作品的關聯 meta）：kind=armor、mount=<砲模型的路徑>（那門砲要有 meta mount=pivot｜turret，21_gunnery.js gunMountInit）；material、render 照舊（05_material.js、15_smooth.js）。
//   哪幾格：.vxk 檔頭 parts[].box（那個關聯在船上的外框，senate 匯出；⛔ 兩端都含 [x0, y0, z0, x1, y1, z1]：莫尼特號的圓筒 269–333 ＝ 65 格）裡的格全部算 ——
//   外框裡不能有別的關聯的格（匯入檢查照材質對不對得上抓一部分）。同一門砲的幾個關聯（莫尼特號：圓筒＋頂）合成一塊。
// 載入（armorSetup，05_hull.js buildHull：verify 與材質之後 ⇒ checksum 照整艘比、材質層與總重含裝甲）：
//   T.armor[k] ＝ { mount 那門砲的路徑, parts, grid（只有裝甲的格；座標 ＝ 船的格座標、轉 0 的樣子）, bb, n, t }；
//   T.hullG ＝ 船殼（T.base 拿掉裝甲；沒有裝甲 ⇒ 就是 T.base 那一份）：每艘的 sh.grid、合併網格、平滑面、進水的水格與破口、繩與模型的錨、桅照它。
//   T.base 照舊是整艘（含裝甲）：浮力表、甲板切高、艙房、羅盤的小船照它、浮力跟以前一樣（打掉不重算 —— 船殼也是）；
//   站位、走路格、第一人稱照 navBase／navG ＝ 再加上裝甲掃過的那一圈（TASK-0655，見 armRing；Tim：進砲塔只走住艙甲板的梯子艙口，TASK-0632）。
//   ⛔ 沒有 mount、找不到那門砲、那門砲不會轉 ⇒ 不拆：照舊是船殼的一部分、不轉（T.armBad，匯入檢查報）。
// 每艘（armorShip，10_ship.js makeShip，砲的迴旋設好之後）：sh.arm[k] ＝ { grid（共用、打掉才複製那一塊）, rs, 平滑面, g 那門砲 }；
//   轉 ＝ g.mt.yaw 繞 g.mt.c（跟砲的模型 modelLocal 同一個 rotM ⇒ 砲口永遠在砲門裡）；砲被打飛 ⇒ 停在最後的角度（mountStep 不再轉它）。
// 打中（21_gunnery.js stepBall）：船殼那一格是空的才看裝甲 —— 彈點反轉 yaw 換到裝甲的座標查格；打到 ⇒ 同一套 impact／shatter／slab（多帶一個 a）：
//   硬度、洞的大小照材質層（裝甲的格座標就是它原本的位置 ⇒ T.matG 直接查）、碎屑照裝甲的矩陣噴；傷人、模型扣血照船的座標。砲自己的血照舊（hitModel 先看）。
//   殉爆（23_powder.js）：彈坑碰得到 ⇒ 裝甲那幾格同一步打掉（armBlast；一塊才一萬多格，不分步）。
// 重量：T.voxT0 已含裝甲；打掉的照材質算減重（05_material.js voxLostT）。船體 %（sh.grid.count ／ sh.orig）只看船殼 ⇒ 開戰時 100%。
// 畫：drawHulls 畫完船殼接著畫（62_simview.js armDraw）、平滑面在模型那一段（60_rbatch.js rbatShip）；剖面照船的格座標切（方塊：uCutL ＝ 裝甲 → 船的格座標，01_gl.js voxFS；平滑面照 uCutInv 本來就是）。
// ⛔ 沒做：裝甲不會斷開漂走（打穿成兩半也照樣跟著砲轉）、碎屑落地／雨滴／船隻擦撞／除錯的 shot・hole 不看裝甲。
/** 船型 T：找 kind=armor 的關聯、拆出來（見檔頭）。 */
function armorSetup(T) {
  T.armor = []; T.armBad = []; T.hullG = T.base;
  turretSetup(T);                                                        // 砲塔層（kind=turret，27_turret.js）：殼在下面拆（舊的 kind=armor 先拆）
  var by = {}, models = T.rig.models || [], keys = [];
  (T.h.parts || []).forEach(function (p) {
    var mt = p.meta || {}; if (mt.kind !== 'armor') return;
    function bad(lv, msg, fix) { T.armBad.push({ lv: lv, where: p.path, msg: msg, fix: fix }); }
    var mw = mt.mount_of !== undefined ? 'mount_of=' + mt.mount_of : 'mount=' + mt.mount;   // 跟著哪門砲：mount_of=<砲的 id>（TASK-0715）；舊寫法 mount=<砲模型的路徑>
    mt = Object.assign({}, mt, { mount: mt.mount_of !== undefined ? refPath(T, mt.mount_of) : mt.mount });   // ⇒ 下面照舊比路徑（refPath 找不到 ⇒ ''）
    if (!mt.mount && mt.mount_of === undefined && turOf(T, p.path) >= 0) return;                    // 砲塔底下的 kind=armor（沒寫 mount）⇒ 那座砲塔的殼（下面一起拆）
    if (!mt.mount && mt.mount_of === undefined) { bad('warn', 'kind=armor 沒有 mount_of ⇒ 照舊是船殼（不轉）', '關聯 meta mount_of=<砲的 id>（那門砲的 meta 要有 mount=turret｜pivot；造船規格 §12）'); return; }
    var m = mt.mount ? models.filter(function (q) { return q.name === mt.mount; })[0] : null, gm = (m && m.meta) || {};
    if (!m) { bad('error', mw + ' 找不到這個模型 ⇒ 照舊是船殼（不轉）', 'mount_of 寫砲的 id（例：gun-3；造船規格 §12）'); return; }
    if (gm.kind !== 'gun' || (gm.mount !== 'pivot' && gm.mount !== 'turret')) { bad('error', 'mount=' + mt.mount + ' 不是會轉的砲（要 meta kind=gun、mount=turret｜pivot）⇒ 照舊是船殼（不轉）', '那門砲的模型標 mount=turret（或 pivot），或拿掉這個關聯的 mount'); return; }
    if (!p.box || p.box.length !== 6) { bad('error', '檔頭沒有這個關聯的外框（box）⇒ 拆不出來、照舊是船殼', '重新匯出（senate 匯出會寫 parts[].box）'); return; }
    if (!by[mt.mount]) { by[mt.mount] = []; keys.push(mt.mount); }
    by[mt.mount].push(p);
  });
  keys.forEach(function (mount) {
    var G = new VK.Grid(T.h.size), parts = [], bb = [1e9, 1e9, 1e9, -1, -1, -1], n = 0, t = 0, B = T.base, MG = T.matG;
    by[mount].forEach(function (p) {
      var b = p.box, want = p.meta.material || null, P = { path: p.path, material: want, render: p.meta.render || '', n: 0, sm: 0, badMat: 0 };
      var x0 = Math.max(0, Math.floor(b[0])), y0 = Math.max(0, Math.floor(b[1])), z0 = Math.max(0, Math.floor(b[2])), x1 = Math.min(B.sx - 1, Math.floor(b[3])), y1 = Math.min(B.sy - 1, Math.floor(b[4])), z1 = Math.min(B.sz - 1, Math.floor(b[5]));   // 兩端都含
      for (var z = z0; z <= z1; z++) for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
        var c = B.get(x, y, z); if (!c || G.get(x, y, z)) continue;     // 兩個關聯的外框疊在一起 ⇒ 先列的那個拿
        if (T.hullG === B) T.hullG = B.share();                          // 共用 T.base 的資料，拆的那幾塊才複製
        G.set(x, y, z, c); T.hullG.set(x, y, z, 0); P.n++;
        var mi = MG ? MG.get(x, y, z) : 0; t += T.matT[mi];
        if (T.smG && T.smG.get(x, y, z)) P.sm++;
        if (want && T.matIds[mi] !== matMapped(T, want)) P.badMat++;
        if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (z < bb[2]) bb[2] = z; if (x > bb[3]) bb[3] = x; if (y > bb[4]) bb[4] = y; if (z > bb[5]) bb[5] = z;
      }
      if (!P.n) T.armBad.push({ lv: 'warn', where: p.path, msg: '外框裡沒有格（空的裝甲）', fix: '確認關聯的外框（parts[].box）框到裝甲的格，或拿掉 kind=armor' });
      if (P.badMat) T.armBad.push({ lv: 'warn', where: p.path, msg: '外框裡有 ' + P.badMat.toLocaleString('en') + ' 格的材質不是 ' + want + '（混了別的關聯的格？）⇒ 照它們自己的材質、一起跟著砲轉', fix: '外框裡只放這個關聯的格（別的關聯移出外框），或把材質標成一樣（造船規格 §9.5）' });
      parts.push(P); n += P.n;
    });
    if (!n) return;
    G.sm = B.sm;                                                         // 平滑渲染的旗標（不會變 ⇒ 共用船型那一份；VoxelKit 的方塊網格化跳過它們）
    T.armor.push({ k: T.armor.length, mount: mount, parts: parts, grid: G, bb: bb, n: n, t: t, rootK: turRootK(T, turOf(T, mount)) });
  });
  // 砲塔的殼（27_turret.js）：外框（parts[].box，砲塔作品的框）裡、還沒被拆走的格（舊的 kind=armor、裡面那一層砲塔先拿）⇒ 由內往外拆
  for (var ti = (T.turrets || []).length - 1; ti >= 0; ti--) {
    var TD = T.turrets[ti], b = TD.box, G = new VK.Grid(T.h.size), bb = [1e9, 1e9, 1e9, -1, -1, -1], t = 0, B = T.base, MG = T.matG, want = TD.meta.material || null;
    var P = { path: TD.path, material: want, render: TD.meta.render || '', n: 0, sm: 0, badMat: 0 };
    var x0 = Math.max(0, Math.floor(b[0])), y0 = Math.max(0, Math.floor(b[1])), z0 = Math.max(0, Math.floor(b[2])), x1 = Math.min(B.sx - 1, Math.floor(b[3])), y1 = Math.min(B.sy - 1, Math.floor(b[4])), z1 = Math.min(B.sz - 1, Math.floor(b[5]));   // 兩端都含
    for (var z = z0; z <= z1; z++) for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      var c = B.get(x, y, z); if (!c || (T.hullG !== B && !T.hullG.get(x, y, z))) continue;   // 已經拆走（別的裝甲、裡面那層砲塔）⇒ 不再拿
      if (T.hullG === B) T.hullG = B.share();
      G.set(x, y, z, c); T.hullG.set(x, y, z, 0); P.n++;
      var mi = MG ? MG.get(x, y, z) : 0; t += T.matT[mi];
      if (T.smG && T.smG.get(x, y, z)) P.sm++;
      if (want && T.matIds[mi] !== matMapped(T, want)) P.badMat++;
      if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (z < bb[2]) bb[2] = z; if (x > bb[3]) bb[3] = x; if (y > bb[4]) bb[4] = y; if (z > bb[5]) bb[5] = z;
    }
    if (!P.n) { T.armBad.push({ lv: 'warn', where: TD.path, msg: '砲塔的外框裡沒有格（沒有殼）⇒ 只有上面的模型跟著轉', fix: '確認砲塔作品的框框到殼的格（造船規格 §4.8）' }); continue; }
    if (P.badMat) T.armBad.push({ lv: 'warn', where: TD.path, msg: '砲塔外框裡有 ' + P.badMat.toLocaleString('en') + ' 格的材質不是 ' + want + ' ⇒ 照它們自己的材質、一起跟著轉', fix: '砲塔外框裡只放砲塔的格，或把材質標成一樣' });
    G.sm = B.sm;
    T.armor.push({ k: T.armor.length, mount: TD.path, tur: ti, parts: [P], grid: G, bb: bb, n: P.n, t: t, rootK: turRootK(T, ti) });
  }
  propSetup(T);                                                          // 會轉的體素件（螺旋槳；檔尾）
}
/** 開一艘船（10_ship.js makeShip，gunMountInit 之後）：每塊裝甲一份（共用船型那一份格子與網格）。沒有裝甲 ⇒ sh.arm 不設（一行都不多算）。 */
function armorShip(sh) {
  var T = sh.T, P = propShip(sh);                                       // 會轉的體素件（螺旋槳；檔尾）也排在 sh.arm 裡（a.prop）：打到、畫、重網格化同一套
  if (!T.armor || !T.armor.length) { if (P.length) { sh.arm = P; sh.armN0 = 0; evEmit('armorShip', sh); } return; }
  sh.arm = T.armor.map(function (A) {
    var tu = A.tur !== undefined, g = tu ? null : (sh.mounts || []).filter(function (q) { return q.model.path === A.mount; })[0] || null, grid = A.grid.share();
    var nd = tu ? (sh.tur ? sh.tur[A.tur] : null) : g ? g.mt : null;    // 跟著哪個節點轉：砲塔的殼 ⇒ 那座砲塔（27_turret.js）；舊的 kind=armor ⇒ 那門砲的迴旋
    var a = { A: A, T: T, sh: sh, g: g, nd: nd, grid: grid, pin: T.hullG, lost: 0 };
    if (nd) armRing(A, ndPivots(nd));                                  // 掃過的那一圈（走路看的牆；TASK-0655）：船型第一艘算一次（疊在砲塔上的照每一層的轉軸）
    return a;
  });
  armDeckZf(T);
  sh.armN0 = T.armor.reduce(function (s, A) { return s + A.n; }, 0);   // 開戰時裝甲幾格（重量：32_hull.js shipT、05_material.js voxLostT）；螺旋槳不算（重量照模型）
  if (P.length) sh.arm = sh.arm.concat(P);
  evEmit('armorShip', sh);                                              // 每塊的網格與平滑面掛上去（62_simview.js；只給人看）
}
/** 裝甲現在轉了多少（跟著的那個節點一路的角度：那門砲的 g.mt.yaw、砲塔；沒有 ⇒ 0）。 */
function armYaw(a) { return a.nd ? ndYaw(a.nd) : 0; }
/** 裝甲的格座標 → 船的格座標（跟 modelLocal 同一個矩陣：平移到轉軸、繞 z 轉、平移回來；疊在砲塔上 ⇒ 再一層一層往外，27_turret.js ndMat）；沒轉 ⇒ null。 */
function armLocal(a) { if (a.prop) return propLocal(a); return a.nd ? ndMat(a.nd) : null; }
/** 世界矩陣（sh.M 照當下的：模擬那一步、或畫面內插過的）。 */
function armM(a) { var L = armLocal(a); return L ? M4.mul(a.sh.M, L) : a.sh.M; }
/** 船的格座標 p → 裝甲的格座標（反轉 yaw）；dir ⇒ 方向（不平移）。 */
function armIn(a, p, dir) { if (a.prop) return propXf(a, p, dir, true); return a.nd ? ndIn(a.nd, p, dir) : p; }
/** 裝甲的格座標 → 船的格座標。 */
function armOut(a, p) { if (a.prop) return propXf(a, p, false, false); return a.nd ? ndOut(a.nd, p) : p; }
/** 船的格座標 L 落在哪一塊裝甲的格裡（沒有 ⇒ null）。 */
function armAt(sh, L) {
  for (var i = 0; i < sh.arm.length; i++) {
    var a = sh.arm[i];
    if (a.prop && (propGone(a) || drvD2(L, a.A.hub) > a.A.R2)) continue;   // 螺旋槳：模型掉了、或離 hub 比最遠那一格還遠（繞 hub 轉，距離不變）⇒ 不用轉換
    var Q = armIn(a, L); if (a.grid.get(Math.floor(Q[0]), Math.floor(Q[1]), Math.floor(Q[2]))) return a;
  }
  return null;
}
/** 人員傷害擋不擋得住（TASK-0637；Tim 2026-10-16：「炮塔裝甲對內部炮組的防護力好像不太夠」）：船的格座標 a → b 這一段有沒有穿過裝甲（現在的角度、打掉的不算）。
 *  40_crew.js hurt（爆風、碎片、砲彈掠過、殉爆）、musket（火槍）用：穿過 ⇒ 那個人不受傷。每 0.5 格量一點；a 落在的那一格不算（爆點常在裝甲表面那一格裡：
 *  莫尼特號的牆只有 2 格厚，再多讓 ⇒ 牆外炸開的照樣穿進來）。牆被打穿、從砲門、頂的格柵縫看得到 ⇒ 照樣打得到。沒有裝甲的船不呼叫。 */
function armBetween(sh, a, b) {
  var d = sub(b, a), l = len(d); if (l < 1) return false;
  for (var i = 0; i < sh.arm.length; i++) {
    var ar = sh.arm[i]; if (ar.prop) continue;                           // 螺旋槳（水線下、船外）不擋人
    var bb = ar.A.bb, Qa = armIn(ar, a), Qb = armIn(ar, b);
    if (Math.max(Qa[0], Qb[0]) < bb[0] - 1 || Math.min(Qa[0], Qb[0]) > bb[3] + 1 || Math.max(Qa[1], Qb[1]) < bb[1] - 1 || Math.min(Qa[1], Qb[1]) > bb[4] + 1 || Math.max(Qa[2], Qb[2]) < bb[2] - 1 || Math.min(Qa[2], Qb[2]) > bb[5] + 1) continue;   // 這一段碰不到這塊的外框
    var ax = Math.floor(Qa[0]), ay = Math.floor(Qa[1]), az = Math.floor(Qa[2]);
    for (var t = 0.5; t < l; t += 0.5) {
      var k = t / l, x = Math.floor(Qa[0] + (Qb[0] - Qa[0]) * k), y = Math.floor(Qa[1] + (Qb[1] - Qa[1]) * k), z = Math.floor(Qa[2] + (Qb[2] - Qa[2]) * k);
      if ((x !== ax || y !== ay || z !== az) && ar.grid.get(x, y, z)) return true;
    }
  }
  return false;
}
// 砲口（TASK-0644；Tim 2026-10-16：「炮塔有開射擊口 很容易被打到炮」「判斷砲彈路徑 只打中炮口的可以減少對炮組傷害」）：
//   砲彈先碰到帶裝甲的那門砲（21_gunnery.js stepBall：hitModel 比裝甲先看）⇒ 碰到的那一點在不在裝甲的內面外側（＝ 砲門裡、或伸出去的那一段）。
//   內面 ＝ 從轉軸（g.mt.c）水平往外，每一層（z）每個方位（64 份）第一格裝甲的距離（armPolar：照開局的形狀，打掉不改；每個船型算一次）。
//   砲門那個方位那一層是空的 ⇒ 看左右 4 份、再上下 3 層（砲門兩旁、上下的牆）；都沒有（那個方向本來就沒裝甲）⇒ 不算砲口。
//   砲口 ⇒ damageModel／blowModel 傷人改從碰到的那一點算（隔著裝甲的照 hurt 的 armBetween 擋掉）、不引爆砲旁的藥箱、砲班另外吃的那一份 × pen.muzzle。
var ARM_BINS = 64;
function armPolar(a) {
  var A = a.A; if (A.pol) return A.pol;
  var c = a.nd.c, bb = A.bb, G = A.grid, pol = {};
  for (var z = bb[2]; z <= bb[5]; z++) {
    var row = null;
    for (var y = bb[1]; y <= bb[4]; y++) for (var x = bb[0]; x <= bb[3]; x++) {
      if (!G.get(x, y, z)) continue;
      var dx = x + 0.5 - c[0], dy = y + 0.5 - c[1], d = Math.hypot(dx, dy), k = Math.floor((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) * ARM_BINS) % ARM_BINS;
      row = row || (pol[z] = new Float32Array(ARM_BINS).fill(Infinity));
      if (d < row[k]) row[k] = d;
    }
  }
  return (A.pol = pol);
}
/** 船的格座標 L 在 m 那門砲的裝甲內面外側？（沒有裝甲、那門砲沒帶裝甲 ⇒ false） */
function armMuzzle(sh, m, L) {
  for (var i = 0; i < sh.arm.length; i++) {
    var a = sh.arm[i]; if (!armOwns(a, m)) continue;
    var pol = armPolar(a), c = a.nd.c, Q = armIn(a, L), dx = Q[0] - c[0], dy = Q[1] - c[1], d = Math.hypot(dx, dy);
    var k = Math.floor((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) * ARM_BINS) % ARM_BINS, z0 = Math.floor(Q[2]), rin = Infinity;
    for (var dz = 0; dz <= 3 && rin === Infinity; dz++) for (var s = dz ? -1 : 1; s <= 1 && rin === Infinity; s += 2) {
      var row = pol[z0 + s * dz]; if (!row) continue;
      for (var j = 0; j <= 4; j++) { rin = Math.min(rin, row[(k + j) % ARM_BINS], row[(k - j + ARM_BINS) % ARM_BINS]); if (rin < Infinity) break; }
    }
    return rin < Infinity && d >= rin - 0.5;
  }
  return false;
}
/** 這塊裝甲是不是 m 那門砲的（舊的：mount 那門砲；砲塔的殼：砲掛在那座砲塔、或它上面的砲塔上）。 */
function armOwns(a, m) { return a.g ? a.g.model === m : !!(a.nd && a.nd.isTur && m.gun && gunNode(m.gun) && ndHas(gunNode(m.gun), a.nd)); }
/** 裝甲原本的位置 (x, y, z)（裝甲的格座標）還有沒有格（重量照材質層的座標數）。 */
function armGet(sh, x, y, z) { for (var i = 0; i < sh.arm.length; i++) if (!sh.arm[i].prop && sh.arm[i].grid.get(x, y, z)) return 1; return 0; }   // 螺旋槳不算（重量照模型）
function armCount(sh) { var n = 0; for (var i = 0; i < sh.arm.length; i++) if (!sh.arm[i].prop) n += sh.arm[i].grid.count; return n; }
// 掃過的那一圈（TASK-0655；Tim 2026-10-16：「砲塔做成無法通行(這個應該要是通用規格)」「雖然會旋轉 但實際上有一圈物理阻隔通行」）：
//   會轉的裝甲每一格繞轉軸掃出一圈 ⇒ 每一層（z）記下掃到的半徑（1／ARM_RK 格一份；一格掃到格心距離 ± 0.71 格）；走路看的格子（navBase／navG）在那些半徑上一律算實心。
//   莫尼特號：圓筒那幾層 ＝ 內緣到外緣一整環（砲門跟著轉、不留縫），頂 ＝ 整個圓。照開局的形狀算、每個船型一次（A.ring）；被打掉的格第一版不打開那一圈（砲塔還在就照樣擋）。
//   出入只走圈裡的艙口梯（莫尼特號：梯子/turret，住艙甲板 → 砲塔底下的艙口）；圈裡沒有梯子 ⇒ 匯入檢查警告（75_shipcheck.js）。
//   用的：第一人稱（81_fps.js）、船員的走路格與站位（42_hands.js navBuild／navRefresh、40_crew.js makeCrew／goToGun）。⛔ 沒用：火藥桶、取用點（23_powder.js 照舊看 T.base）。
var ARM_RK = 2;
/** 船型的一塊裝甲 A 繞 cs（轉軸由外往內，船的格座標；一個 ＝ 那門砲、那座砲塔的轉軸）掃過的那一圈（armorShip 第一艘算、存在 A.ring）。
 *  疊在砲塔上的（27_turret.js）：每一層都能一整圈轉 ⇒ 一格離最外層轉軸的距離落在 [max(0, 2·最長那一段 − 總長), 總長]（一串轉軸＋格心連成的折線）；只有一層 ＝ 格心到轉軸那一段。 */
function armRing(A, cs) {
  if (A.ring) return A.ring;
  if (typeof cs[0] === 'number') cs = [cs];
  var c = cs[0], cl = cs[cs.length - 1], s0 = 0, m0 = 0;
  for (var i = 1; i < cs.length; i++) { var l = Math.hypot(cs[i][0] - cs[i - 1][0], cs[i][1] - cs[i - 1][1]); s0 += l; m0 = Math.max(m0, l); }
  var bb = A.bb, G = A.grid, rows = {}, rmax = 0, x, y, z;
  var far = s0 + Math.max(Math.hypot(bb[0] - cl[0], bb[1] - cl[1]), Math.hypot(bb[3] + 1 - cl[0], bb[1] - cl[1]), Math.hypot(bb[0] - cl[0], bb[4] + 1 - cl[1]), Math.hypot(bb[3] + 1 - cl[0], bb[4] + 1 - cl[1])), N = Math.ceil((far + 1) * ARM_RK) + 1;
  for (z = bb[2]; z <= bb[5]; z++) for (y = bb[1]; y <= bb[4]; y++) for (x = bb[0]; x <= bb[3]; x++) {
    if (!G.get(x, y, z)) continue;
    var d = Math.hypot(x + 0.5 - cl[0], y + 0.5 - cl[1]), hi = s0 + d, lo = Math.max(0, 2 * Math.max(m0, d) - hi), row = rows[z] || (rows[z] = new Uint8Array(N));
    for (var k = Math.max(0, Math.floor((lo - 0.71) * ARM_RK)), k1 = Math.min(N - 1, Math.floor((hi + 0.71) * ARM_RK)); k <= k1; k++) row[k] = 1;
    if (hi + 0.71 > rmax) rmax = hi + 0.71;
  }
  return (A.ring = { c: [c[0], c[1]], z0: bb[2], z1: bb[5], rows: rows, r: rmax });
}
/** (x, y, z)（船的格座標）在不在哪一塊裝甲掃過的那一圈裡（沒有圈的那塊 ⇒ 照它原本的格）。rk 給了 ⇒ 最外層是第 rk 座砲塔的那幾塊不算（會轉的甲板照砲塔座標看自己那一串）。 */
function armWall(T, x, y, z, rk) {
  for (var i = 0; i < T.armor.length; i++) {
    var A = T.armor[i], R = A.ring;
    if (rk !== undefined && A.rootK === rk) continue;
    if (A.tur !== undefined && T.turZf && z >= T.turZf[x + y * T.base.sx] && T.turZr[x + y * T.base.sx] === A.rootK) continue;   // 站在這座砲塔自己的地板上（吊籃）⇒ 照砲塔座標看，掃過的那一圈不擋（armDeckZf）
    if (!R) { if (A.grid.get(x, y, z)) return 1; continue; }
    if (z < R.z0 || z > R.z1) continue;
    var row = R.rows[z]; if (!row) continue;
    var d = Math.hypot(x + 0.5 - R.c[0], y + 0.5 - R.c[1]);
    if (d <= R.r && row[Math.floor(d * ARM_RK)]) return 1;
  }
  return 0;
}
/** 那一圈在 z0 往上 h 層裡的內緣半徑（格；圈裡站人的地方 ＝ 比它近）：匯入檢查、讀數用。沒有 ⇒ 0。 */
function armRingIn(R, z0, h) {
  var best = Infinity;
  for (var z = z0; z < z0 + h; z++) { var row = R.rows[z]; if (!row) continue; for (var k = 0; k < row.length; k++) if (row[k]) { best = Math.min(best, k / ARM_RK); break; } }
  return best === Infinity ? 0 : best;
}
/** 開戰時的走路格、站位看的格子（42_hands.js navBuild、40_crew.js makeCrew）：T.base ＋ 會轉的裝甲掃過的那一圈；沒有裝甲 ⇒ 就是 T.base。 */
function navBase(T) {
  if (!T.armor || !T.armor.length) return T.base;
  var B = T.base;
  return T.navB || (T.navB = { sx: B.sx, sy: B.sy, sz: B.sz, get: function (x, y, z) { return B.get(x, y, z) || armWall(T, x, y, z); } });
}
/** 走路格、站位看的格子（42_hands.js navRefresh、40_crew.js goToGun、81_fps.js 第一人稱）：船殼（打掉的照現在）＋裝甲掃過的那一圈（不轉、打掉也照樣擋：見上面）。 */
function navG(sh) {
  if (!sh.arm) return sh.grid;
  var g = sh.grid, T = sh.T;
  return sh.navG || (sh.navG = { sx: g.sx, sy: g.sy, sz: g.sz, get: function (x, y, z) { return sh.grid.get(x, y, z) ? 1 : armWall(T, x, y, z); } });
}
/** P（開局的船的格座標）r 格內有沒有砲塔（kind=turret）的殼：有 ⇒ 那一塊是第幾座砲塔（A.tur）；沒有 ⇒ −1。繩綁在砲塔上（10_ship.js linkRopes、ropeEndSupport）。 */
function armNear(T, P, r) {
  var bx = Math.floor(P[0]), by = Math.floor(P[1]), bz = Math.floor(P[2]);
  for (var i = 0; i < (T.armor || []).length; i++) {
    var A = T.armor[i], b = A.bb; if (A.tur === undefined || bx < b[0] - r || bx > b[3] + r || by < b[1] - r || by > b[4] + r || bz < b[2] - r || bz > b[5] + r) continue;
    for (var dz = -r; dz <= r; dz++) for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) if (A.grid.get(bx + dx, by + dy, bz + dz)) return A.tur;
  }
  return -1;
}
// 第一人稱站上砲塔（Tim 2026-10-17：繩梯「上下跑塔上方那一塊」）：navG 把整座砲塔當成它掃過的那一圈（轉一圈的樣子，旋轉對稱）、
//   站在砲塔自己的地板上方那幾柱（吊籃上）整柱都不擋 ⇒ 吊籃上方的砲塔頂是空的、站不上去（量過：哨兵號主砲塔頂除了吊籃外圈那一環，teleport 都找不到地板）。
//   fpG：那幾柱照砲塔現在的角度轉回砲塔座標、看砲塔真的格（殼、頂、吊籃、疊在上面的砲房，各照自己的節點；打掉的照這艘的）；其他照 navG。
/** (x, y, z)（船現在的格座標）在不在某座砲塔自己的地板上方：在 ⇒ { k：最外層第幾座, a：那一點是哪一塊殼的格（沒有 ⇒ null）}；不在 ⇒ null。 */
function turCell(sh, x, y, z) {
  var T = sh.T, B = T.base; if (!T.turZf || !sh.tur) return null;
  var P = [x + 0.5, y + 0.5, z + 0.5];
  for (var k = 0; k < sh.tur.length; k++) {
    var N = sh.tur[k]; if (N.up || !N.isTur) continue;
    var q = ndIn(N, P), qx = Math.floor(q[0]), qy = Math.floor(q[1]); if (qx < 0 || qy < 0 || qx >= B.sx || qy >= B.sy) continue;
    var i = qx + qy * B.sx; if (T.turZr[i] !== k || z < T.turZf[i]) continue;
    for (var j = 0; j < sh.arm.length; j++) {
      var a = sh.arm[j]; if (a.A.rootK !== k || !a.nd) continue;
      var qq = a.nd === N ? q : ndIn(a.nd, P); if (a.grid.get(Math.floor(qq[0]), Math.floor(qq[1]), Math.floor(qq[2]))) return { k: k, a: a };
    }
    return { k: k, a: null };
  }
  return null;
}
/** 第一人稱的格（81_fps.js）：沒有砲塔層 ⇒ navG；有 ⇒ 砲塔自己的地板上方照 turCell，其他照 navG（船殼＋掃過的那一圈）。 */
function fpG(sh) {
  if (!sh.arm || !sh.T.turZf) return navG(sh);
  var g = sh.grid, T = sh.T;
  return sh.fpG || (sh.fpG = { sx: g.sx, sy: g.sy, sz: g.sz, get: function (x, y, z) {
    if (sh.grid.get(x, y, z)) return 1;
    var c = turCell(sh, x, y, z); return c ? (c.a ? 1 : 0) : armWall(T, x, y, z);
  } });
}
// 會轉的甲板（27_turret.js；42_hands.js navBuild／navRefresh）：腳下是砲塔自己的格的那幾點照砲塔座標看 ——
//   船殼＋殼（開局的樣子／這艘打掉之後的；殼的格座標 ＝ 砲塔座標）＋別座砲塔掃過的那一圈（自己這一串不算）。
/** 砲塔自己的地板（吊籃、砲塔頂；27_turret.js「會轉的甲板」）：每一柱 (x, y) 最低那一個「砲塔的格、上面是空的」再往上一格 ⇒ T.turZf（站的高度）、T.turZr（最外層第幾座）。
 *  那一柱在那個高度以上，那一串砲塔掃過的那一圈不算牆（armWall）——站在吊籃上的人跟著轉，吊籃上的東西照開局的位置擋（T.base）。罩在甲板上的砲塔（莫尼特號）裡面沒有砲塔的地板 ⇒ 只有頂上那一層，走路格碰不到。
 *  船型第一艘算一次（armorShip）。 */
function armDeckZf(T) {
  if (T.turZf !== undefined) return; T.turZf = null;
  var B = T.base, Zf = null, Zr = null;
  T.armor.forEach(function (A) {
    if (A.tur === undefined) return;
    var b = A.bb;
    for (var y = b[1]; y <= b[4]; y++) for (var x = b[0]; x <= b[3]; x++) for (var z = b[2]; z <= b[5]; z++) {
      if (!A.grid.get(x, y, z) || B.get(x, y, z + 1)) continue;
      if (!Zf) { Zf = new Int16Array(B.sx * B.sy).fill(32767); Zr = new Int16Array(B.sx * B.sy).fill(-1); }
      var i = x + y * B.sx; if (z + 1 < Zf[i]) { Zf[i] = z + 1; Zr[i] = A.rootK; }
      break;                                                             // 這一柱最低的那一個就好
    }
  });
  T.turZf = Zf; T.turZr = Zr;
}
/** 第 k 座砲塔最外層是第幾座（不在砲塔上 ⇒ -1）。 */
function turRootK(T, k) { if (k < 0) return -1; while (T.turrets[k].up >= 0) k = T.turrets[k].up; return k; }
/** (x, y, z)（開局的船的格座標）是哪一座砲塔的殼（照開局的樣子；不是 ⇒ -1）。 */
function armDeckK(T, x, y, z) { for (var i = 0; i < T.armor.length; i++) { var A = T.armor[i]; if (A.tur !== undefined && A.grid.get(x, y, z)) return A.tur; } return -1; }
/** 開戰時（船型共用）：最外層第 rk 座砲塔那一串的會轉的甲板看的格子。 */
function navRestB(T, rk) {
  var C = T.navRB || (T.navRB = {}); if (C[rk]) return C[rk];
  var B = T.base; return (C[rk] = { sx: B.sx, sy: B.sy, sz: B.sz, get: function (x, y, z) { return B.get(x, y, z) || armWall(T, x, y, z, rk); } });
}
/** 這艘（打掉之後的）：最外層第 rk 座砲塔那一串的會轉的甲板看的格子。 */
function navRestG(sh, rk) {
  var C = sh.navRG || (sh.navRG = {}); if (C[rk]) return C[rk];
  var g = sh.grid, T = sh.T;
  return (C[rk] = { sx: g.sx, sy: g.sy, sz: g.sz, get: function (x, y, z) { if (sh.grid.get(x, y, z)) return 1; for (var i = 0; i < sh.arm.length; i++) if (!sh.arm[i].prop && sh.arm[i].grid.get(x, y, z)) return 1; return armWall(T, x, y, z, rk); } });
}
/** 打掉裝甲的一格（20_shatter.js removeVoxel 的裝甲版：不進水、不推連通的種子；砲塔的殼 ⇒ 會轉的甲板那幾點重算走路格，照砲塔座標）。回：原本的色（0 ＝ 本來就沒有）。 */
function armRemove(sh, a, x, y, z) {
  var c = a.grid.set(x, y, z, 0);
  if (c <= 0) return 0;
  evEmit('armCell', a, x, y, z); a.lost++; sh.lost++;               // 網格、平滑面附近的區重建（62_simview.js；只給人看）
  if (a.A.tur !== undefined && sh.T.turDeck && NAV_RE > 0 && sh.nav) navDirty(sh, x, y, z);
  return c;
}
/** 殉爆的彈坑（23_powder.js；c ＝ 爆心的船的格座標、R 格、w 世界座標）碰得到的裝甲：跟 blastStep 同一個參差的球，這一步就打掉；碎屑只抽碎木的亂數（戰局的 rnd() 不動）。 */
function armBlast(sh, c, R, w) {
  if (!sh.arm) return 0;
  var n = 0, R2 = R * 1.15;
  sh.arm.forEach(function (a) {
    if (a.prop && propGone(a)) return;
    var Q = armIn(a, c), b = a.A.bb, removed = [];
    var x0 = Math.max(b[0], Math.floor(Q[0] - R2)), x1 = Math.min(b[3], Math.ceil(Q[0] + R2)), y0 = Math.max(b[1], Math.floor(Q[1] - R2)), y1 = Math.min(b[4], Math.ceil(Q[1] + R2)), z0 = Math.max(b[2], Math.floor(Q[2] - R2)), z1 = Math.min(b[5], Math.ceil(Q[2] + R2));
    for (var z = z0; z <= z1; z++) for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      if (!a.grid.get(x, y, z)) continue;
      var dx = x - Q[0], dy = y - Q[1], dz = z - Q[2];
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) > R * (0.85 + 0.3 * hash3(x, y, z))) continue;
      var col = armRemove(sh, a, x, y, z); if (col) { n++; removed.push(x, y, z, col); }
    }
    if (!removed.length) return;
    var Mw = armM(a), k = Math.max(1, Math.round(removed.length / 4 / 60));
    for (var j = 0; j < removed.length; j += 4 * k) {
      var p = M4.pt(Mw, removed[j] + 0.5, removed[j + 1] + 0.5, removed[j + 2] + 0.5), dir = norm(sub(p, w));
      spawnDebris(p, add(add(mul(dir, rD(8, 40)), [0, rD(4, 22), 0]), sh.vel), removed[j + 3], rD(0.06, 0.16), rD(8, 16));
    }
    spawnPlates(sh, removed, [0, 1, 0], 30, 3, 20, Mw);
  });
  return n;
}
/** 點選瞄準（71_input.js pick）：射線也打裝甲（換到它的座標打、碰到的那一格換回船的格座標；回傳的 x、y、z 跟 VK.raycast 一樣 ＋0.5 ＝ 格心）。 */
function armRay(o, oL, dL, tMax) {
  var best = null;
  o.arm.forEach(function (a) {
    var h = VK.raycast(a.grid, armIn(a, oL), armIn(a, dL, true), tMax); if (!h || (best && h.t >= best.t)) return;
    var P = armOut(a, [h.x + 0.5, h.y + 0.5, h.z + 0.5]); best = { x: P[0] - 0.5, y: P[1] - 0.5, z: P[2] - 0.5, t: h.t, c: h.c };
  });
  return best;
}
/** 砲口在不在砲門裡：每個砲口（g.muzs，沒有 ⇒ g.muz）沿砲軸從砲口往後 2 格、往外走到裝甲外框外面，每 0.25 格量一點，換到裝甲的座標碰到幾格（0 ＝ 穿過砲門）。
 *  匯入檢查、?debug=1 的 __game.armor 量（Tim 的驗收：轉到哪個角度兩個砲口都在砲門裡）。 */
function armBlock(a) {
  var gs = a.g ? [a.g] : a.nd && a.nd.isTur ? a.nd.guns : null; if (!gs || !gs.length) return null;   // 砲塔的殼（27_turret.js）⇒ 上面每一門砲的每個砲口
  var b = a.A.bb, far = Math.hypot(b[3] - b[0], b[4] - b[1]) + 4, out = [];
  gs.forEach(function (g) {
    var ax = g.ax;
    (g.muzs || [g.muz]).forEach(function (m) {
      var hit = 0;
      for (var t = -2; t <= far; t += 0.25) { var Q = armIn(a, [m[0] + ax[0] * t, m[1] + ax[1] * t, m[2]]); if (a.grid.get(Math.floor(Q[0]), Math.floor(Q[1]), Math.floor(Q[2]))) hit++; }
      out.push(hit);
    });
  });
  return out;
}
/** 讀數（匯入檢查 info.armor）：每塊 ＝ 那門砲：每個關聯幾格（材質、平滑幾格）、合計幾格幾噸。 */
function armSummary(T) {
  if (!T.armor || !T.armor.length) return '';
  return T.armor.map(function (A) {
    return A.mount + (A.tur !== undefined ? '（砲塔的殼）' : '') + '：' + A.parts.map(function (P) { return P.path + ' ' + P.n.toLocaleString('en') + ' 格（' + (P.material ? matInfo(P.material).name : '材質照預設') + (P.sm ? '、平滑 ' + P.sm.toLocaleString('en') : '') + '）'; }).join('＋') +
      ' ＝ ' + A.n.toLocaleString('en') + ' 格、' + A.t.toFixed(1) + ' 噸，跟著' + (A.tur !== undefined ? '砲塔' : '砲') + '轉';
  }).join('；') + '（船殼 ' + T.hullG.count.toLocaleString('en') + ' 格）';
}
// ── 會轉的體素件（TASK-0653 第二段；Tim 2026-10-16：「鍋爐 & 軸 & 螺旋槳屬於這類 且可以根據剩餘體素去做運算」）──
// 螺旋槳（外部模型 meta kind=propeller）：.vxk 裡只有三角形網格 ⇒ 匯出時 admin.py prop_vox 把來源作品的格子寫進 rig.models[].vox（船的格座標的外框＋連續段＋每格的色）。
// 這裡把它變成自己一份格子，排進 sh.arm（a.prop）跟裝甲走同一套：
//   打到（21_gunnery.js stepBall：船殼那一格是空的才看 armAt）⇒ 一格一格打掉（impact／shatter 帶 ab）、碎屑照它轉過的矩陣噴；
//   硬度照它自己的材質（模型 meta material；沒有 ⇒ iron）、可是當鑄件（pen 0：不凹不彈、照硬度打洞）：T.pmG 只蓋在船殼沒有格的位置（05_material.js matK／matAt 先看它）；
//   轉 ＝ 模型的 spin（31_drive.js 每一步給 m.spv／m.sax／m.sw：繞 hub、沿軸）；推力 × 曲線（還剩幾成 ＝ 現在的格 ÷ 開局的格；DRVP.propeller，道具設定頁「動力件」）。
//   模型本身照舊在：掛在 shaft-fwd 旁那一格、那一段被打斷就掉（blowModel 飛出去的是模型的網格）⇒ 掉了這份格子就不畫、不打；
//   模型的網格不畫（60_render.js drawModels）、不扣血（21_gunnery.js hitModel、damageModel 跳過）。
// 平滑：材質標 smooth（預設 iron）⇒ 整份畫成平滑面＋金屬反光（Tim 2026-10-17；armorMesh 建、打掉照區重建）。
// ⛔ 沒做：打斷的葉片不會飛出去（打掉的格照碎屑噴）、轉的時候不碰船殼。沒有 vox 的螺旋槳 ⇒ 照舊是模型（扣血）。
/** 船型 T：有 vox 的模型 ⇒ T.props[] ＝ { k 模型編號, name, grid（船的格座標）, bb, n 開局幾格, hub, R2（離 hub 最遠那一格的距離²）, mat }；T.pmG／T.pmI ＝ 材質（見檔頭）。 */
function propSetup(T) {
  T.props = []; T.pmG = null; T.pmI = [null];
  var S0 = T.h.size, B = T.base;
  (T.rig.models || []).forEach(function (m, k) {
    var V = m.vox, mt = m.meta || {}; if (!V || !V.runs || !V.s || !V.o || !V.c) return;
    var G = new VK.Grid(S0), o = V.o, s = V.s, bin = atob(V.c), at = 0, i = 0, n = 0, bb = [1e9, 1e9, 1e9, -1, -1, -1];
    var mat = matKnown(mt.material) ? mt.material : MATS.iron ? 'iron' : T.mat0, pi = T.pmI.length;
    T.pmG = T.pmG || new VK.Grid(S0);
    for (var r = 0; r + 1 < V.runs.length; r += 2) {
      var st = at + V.runs[r], c = V.runs[r + 1];
      for (var j = 0; j < c; j++, i++) {
        var q = st + j, z = Math.floor(q / (s[0] * s[1])), w = q - z * s[0] * s[1], y = Math.floor(w / s[0]), x = w - y * s[0], col = bin.charCodeAt(i);
        x += o[0]; y += o[1]; z += o[2];
        if (!col || x < 0 || y < 0 || z < 0 || x >= S0[0] || y >= S0[1] || z >= S0[2]) continue;
        G.set(x, y, z, col); n++;
        if (!B.get(x, y, z)) T.pmG.set(x, y, z, pi);                   // 跟船殼疊在一起的那幾格：硬度照船殼（打到的先是船殼）
        if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (z < bb[2]) bb[2] = z; if (x > bb[3]) bb[3] = x; if (y > bb[4]) bb[4] = y; if (z > bb[5]) bb[5] = z;
      }
      at = st + c;
    }
    if (!n) return;
    var hub = (m.points || {}).hub || [(bb[0] + bb[3] + 1) / 2, (bb[1] + bb[4] + 1) / 2, (bb[2] + bb[5] + 1) / 2], R2 = 0;
    for (var cz = 0; cz < 2; cz++) for (var cy = 0; cy < 2; cy++) for (var cx = 0; cx < 2; cx++) R2 = Math.max(R2, drvD2([bb[3 * cx] + cx, bb[1 + 3 * cy] + cy, bb[2 + 3 * cz] + cz], hub));
    T.pmI.push(Object.assign({}, matInfo(mat), { pen: 0 }));            // 鑄件（脆）：硬度照材質（洞小一點），⛔ 不走鐵甲的凹／彈／穿（葉片從側面量有 9 格厚 ⇒ 當成 0.9 m 鐵甲、一格都打不掉）
    T.props.push({ k: k, mount: m.name, name: m.name, grid: G, bb: bb, n: n, hub: hub.slice(), R2: (Math.sqrt(R2) + 1.5) * (Math.sqrt(R2) + 1.5), mat: mat });
  });
  if (!T.props.length) T.pmG = null;
}
/** 開一艘船（armorShip）：每個螺旋槳一份（共用船型那一份格子與網格，打到的區才各自重建）；模型記著它（m.vox）。 */
function propShip(sh) {
  var T = sh.T; if (!T.props || !T.props.length) return [];
  return T.props.map(function (P) {
    var m = sh.models[P.k], grid = P.grid.share();
    var a = { A: P, T: T, sh: sh, g: null, prop: true, m: m, grid: grid, pin: P.smO ? null : T.hullG, lost: 0, smRK: P.smRK, smO: P.smO };   // smRK／smO：平滑的螺旋槳自己那幾區與選項（15_smooth.js smTouch／smFlush）；不釘船殼（它會轉）
    if (m) m.vox = a;
    return a;
  });
}
/** 螺旋槳的模型掉了（打飛、掛的那一格被打斷、跟著斷開的那一團走了）⇒ 這份格子不畫、不打。 */
function propGone(a) { var m = a.m; return !m || !m.alive || !!m.moved; }
/** 螺旋槳的格座標 → 船的格座標：繞 m.spv、沿 m.sax 轉 m.sw（同 modelLocal 的 spin 那一條）；沒轉 ⇒ null。轉角變了才重算（a.Lc、反矩陣 a.Li）。 */
function propLocal(a) {
  var m = a.m; if (!m || !m.sw || !m.sax) return null;
  if (a.swL !== m.sw || a.axL !== m.sax) {
    var q = m.spv || a.A.hub;
    a.Lc = M4.mul(M4.mul(trans(q[0], q[1], q[2]), rotM(m.sax, m.sw)), trans(-q[0], -q[1], -q[2])); a.Li = M4.inv(a.Lc); a.swL = m.sw; a.axL = m.sax;
  }
  return a.Lc;
}
/** inv ⇒ 船的格座標 p → 螺旋槳的格座標；不然反過來。dir ⇒ 方向（不平移）。 */
function propXf(a, p, dir, inv) { var L = propLocal(a); if (!L) return p; var M = inv ? a.Li : L; return dir ? M4.dir(M, p[0], p[1], p[2]) : M4.pt(M, p[0], p[1], p[2]); }
/** 還剩幾成（0…1）。 */
function propLeft(a) { return a.A.n ? a.grid.count / a.A.n : 1; }
/** 讀數（匯入檢查）：每個螺旋槳幾格、材質；有螺旋槳模型卻沒有格子 ⇒ 另外列。 */
function propSummary(sh) {
  var T = sh.T, L = (T.props || []).map(function (P) { return P.name + ' ' + P.n.toLocaleString('en') + ' 格（' + matInfo(P.mat).name + '）'; });
  sh.models.forEach(function (m) { if (m.meta && m.meta.kind === 'propeller' && !m.vox) L.push(m.path + '（沒有格子 ⇒ 照舊是模型、扣血）'); });
  return L.join('；');
}
