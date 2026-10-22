// ───────────────────────── 砲塔層（TASK-0659；Tim 2026-10-16）─────────────────────────
// Tim：「讓砲塔本身只是一層殼 上面可以放置炮(跟在船體上放炮一樣) 讓炮跟著砲塔轉」「取代目前把炮塔綁在炮上的機制(因為這樣強制只能一個砲塔裝一門炮
//   且實際上可能可以在炮塔上額外加裝炮塔」「炮塔可以根據目前的瞄準資訊自行旋轉到對應方向 炮塔本身也是可以體素破壞的子物件」
//   「直接設定一個砲塔前方方向 然後把前方朝向瞄準方位就好 不要過於複雜的計算(特別是子砲塔跟上面的炮可能也有旋轉能力)」
//   「砲塔內也要可以放彈藥箱」「會跟著轉的部分(砲塔吊籃) 如果砲塔是直接覆蓋一片甲板區(底下甲板不會跟著動) 就只有砲塔頂部會是一塊跟著轉的甲板」
// 標法（雕刻作品的關聯 meta）：kind=turret、arc／fire／rate／cone（跟砲的 mount=turret 同一套：度、度／秒；沒寫 ⇒ 一整圈、20°／秒、砲管射界 4°）。
//   轉軸 ＝ 砲塔作品的固定點 pivot（沒有 ⇒ 外框底面中心）；前方 ＝ 固定點 front（從轉軸往 front 那個方向；沒有 ⇒ 船頭 +x，匯入檢查報）。
//   ⇒ 砲塔只把「前方」轉向瞄準方位（不看上面的砲朝哪）。固定點跟著作品的鏡像、轉向換算（senate 匯出就換好）。
//   子樹（路徑在它底下）裡的：格子 ＝ 殼（24_armor.js 拆出來、跟著轉、一格一格打掉，跟 kind=armor 同一套）；外部模型 ＝ 跟著轉（砲照砲的標法：kind=gun …）；
//   彈藥庫（kind=magazine，彈藥箱）＝ 跟著轉、取用點在砲塔裡（23_powder.js makeStations）；子樹裡再一個 kind=turret ＝ 疊在上面的砲塔（照最近的那一層分）。
//   上面的砲自己也標 mount=turret｜pivot ⇒ 掛在砲塔底下再轉一層（照自己的砲軸對準）；沒標 ⇒ 固定在砲塔上（砲管射界照砲塔的 cone）。
// 節點（每艘 sh.tur[k]、砲的 g.mt）：c 轉軸（開局的船的格座標）、yaw、up（上一層；沒有 ＝ 直接在船上）。只繞鉛直軸轉 ⇒ 疊幾層都是平面上的轉＋平移：
//   ndOut（砲塔座標 → 船的格座標）／ndIn（反過來）／ndMat（矩陣）。開局 yaw 0 ⇒ 砲塔座標 ＝ 開局的船的格座標（模型的 origin、外框、站位都照它）。
// 每一步（21_gunnery.js mountStep → turretStep）：先記下跟著轉的東西在砲塔座標的位置 → 由外往內照瞄準點轉（轉速、arc、fire、死角遲滯照 turretAim）→ 再換回船的座標。
//   跟著轉的：砲的砲口、砲軸、砲班站位與站在上面的人、放藥箱的位置；模型（畫、被打中照砲塔座標比外框、中心 m.c）；砲塔裡的取用點；
//   站在砲塔自己的格上的人（吊籃的地板、砲塔頂：turDeckAt）與他們走到一半的路。⛔ 罩在甲板上的砲塔（莫尼特號）：底下那片甲板不轉、站在上面的人也不轉。
// 會轉的甲板（走路格，42_hands.js navBuild）：一點的腳下是砲塔的格 ⇒ 那一點照砲塔座標記（N.rot）、找路照砲塔座標找，navPos／navSnap 換回船的座標。
//   那一點的頭上照砲塔座標看（同一座砲塔掃過的那一圈不擋 ⇒ 吊籃上的彈藥箱照它現在的樣子擋）；腳下是不轉的甲板 ⇒ 照舊（砲塔掃過的那一圈是牆，TASK-0655）。
// 停：子樹裡的砲全滅 ⇒ 停在最後的角度（Tim：第一版砲全滅才停；轉台卡住以後再說）。
// 舊標法照舊：砲自己標 mount=turret｜pivot、裝甲 kind=armor mount=<砲> ⇒ 一門砲一座（gunMountInit）；那門砲在 kind=turret 底下 ⇒ 掛在那座底下。
/** 度的清單（'−150,150'）⇒ 弧度；沒寫、寫壞 ⇒ d。跟 gunMountInit 的 list 同一個寫法。 */
function turList(s, d) {
  var D = Math.PI / 180, a = String(s === undefined ? d : s).split(',').map(function (v) { return +v * D; }).filter(isFinite);
  return a.length ? a : String(d).split(',').map(function (v) { return +v * D; });
}
/** 船型 T：kind=turret 的關聯 ⇒ T.turrets（由外往內：上一層排在前面）。armorSetup（24_armor.js）一開始呼叫；有問題的寫進 T.armBad（匯入檢查報）。 */
function turretSetup(T) {
  var D = Math.PI / 180;
  var P = (T.h.parts || []).filter(function (p) { return p.meta && p.meta.kind === 'turret'; }).sort(function (a, b) { return a.path.split('/').length - b.path.split('/').length; });
  T.turrets = P.map(function (p, k) {
    var mt = p.meta, b = p.box || [0, 0, 0, 0, 0, 0], pts = p.points || {}, up = -1;
    for (var j = 0; j < k; j++) if (p.path.indexOf(P[j].path + '/') === 0) up = j;   // 由外往內排 ⇒ 最後一個對上的 ＝ 最近的那一層
    var c = pts.pivot ? [pts.pivot[0], pts.pivot[1], pts.pivot[2]] : [(b[0] + b[3] + 1) / 2, (b[1] + b[4] + 1) / 2, b[2]];
    var fr = pts.front, f0 = fr ? Math.atan2(fr[1] - c[1], fr[0] - c[0]) : 0;
    if (!pts.pivot) T.armBad.push({ lv: 'warn', where: p.path, msg: '砲塔沒有固定點 pivot ⇒ 轉軸照外框底面的中心', fix: '砲塔作品登記固定點 pivot（轉軸；造船規格 §4.8）' });
    if (!fr) T.armBad.push({ lv: 'warn', where: p.path, msg: '砲塔沒有固定點 front ⇒ 前方當成船頭（+x）', fix: '砲塔作品登記固定點 front（從轉軸往砲塔前方的一點；造船規格 §4.8）' });
    return { k: k, path: p.path, up: up, c: c, f0: f0, arc: turList(mt.arc, '-180,180'), fire: turList(mt.fire !== undefined ? mt.fire : mt.arc, '-180,180'),
      rate: (+mt.rate > 0 ? +mt.rate : 20) * D, cone: (+mt.cone > 0 ? +mt.cone : 4) * D, box: b, meta: mt };
  });
}
/** 路徑 path 在哪一座砲塔底下（最近的那一層；不在 ⇒ -1）。 */
function turOf(T, path) {
  var k = -1, Ts = T.turrets || [];
  for (var i = 0; i < Ts.length; i++) if (path.indexOf(Ts[i].path + '/') === 0) k = i;
  return k;
}
// ── 節點的座標換算（砲塔座標 ⇄ 船的格座標）──
/** 砲塔座標 p → 船的格座標（自己轉、再一層一層往外）。 */
function ndOut(N, p) { var q = N.yaw ? rotZ(p, N.c, N.yaw) : p; return N.up ? ndOut(N.up, q) : q; }
/** 船的格座標 p → 砲塔座標（先解外層、再解自己）；dir ⇒ 方向（不平移）。 */
function ndIn(N, p, dir) { var q = N.up ? ndIn(N.up, p, dir) : p; return N.yaw ? rotZ(q, dir ? [0, 0, 0] : N.c, -N.yaw) : q; }
/** 砲塔座標 → 船的格座標的矩陣（都沒轉 ⇒ null）。 */
function ndMat(N) {
  var L = N.yaw ? M4.mul(M4.mul(trans(N.c[0], N.c[1], N.c[2]), rotM([0, 0, 1], N.yaw)), trans(-N.c[0], -N.c[1], -N.c[2])) : null, U = N.up ? ndMat(N.up) : null;
  return U && L ? M4.mul(U, L) : U || L;
}
/** 一路轉了多少（自己＋外面每一層）。 */
function ndYaw(N) { return N.yaw + (N.up ? ndYaw(N.up) : 0); }
/** 這一串（自己、外面每一層）現在的角度 ⇒ 陣列；ndYawsSet 設回去（第一人稱照「上一格畫面的角度」換算，81_fps.js fpRide）。 */
function ndYaws(N) { var a = []; for (; N; N = N.up) a.push(N.yaw); return a; }
function ndYawsSet(N, a) { for (var i = 0; N; N = N.up, i++) N.yaw = a[i]; }
/** 最外層那一座。 */
function ndRoot(N) { while (N.up) N = N.up; return N; }
/** N 在不在 A 底下（或就是 A）。 */
function ndHas(N, A) { for (; N; N = N.up) if (N === A) return true; return false; }
/** 轉軸由外往內（armRing 算掃過的那一圈用）。 */
function ndPivots(N) { var a = []; for (; N; N = N.up) a.unshift(N.c); return a; }
/** 這門砲掛在哪個節點（自己會轉 ⇒ 自己的 g.mt；固定在砲塔上 ⇒ 那座砲塔；都不是 ⇒ null）。 */
function gunNode(g) { return g.mt || g.hd || null; }
/** 開一艘船（10_ship.js makeShip：gunMountInit 之後、armorShip 之前）：sh.tur、砲與模型掛上去。沒有砲塔 ⇒ sh.tur 不設（一行都不多算）。 */
function turretShip(sh) {
  var T = sh.T; if (!T.turrets || !T.turrets.length) return;
  sh.tur = T.turrets.map(function (d) {
    return { isTur: true, def: d, k: d.k, path: d.path, c: d.c.slice(), f0: d.f0, arc: d.arc, fire: d.fire, rate: d.rate, full: d.arc[d.arc.length - 1] - d.arc[0] >= 2 * Math.PI - 1e-6,
      cone: d.cone, yaw: 0, yawT: 0, up: null, guns: [], models: [], depth: 0 };
  });
  sh.tur.forEach(function (N) { if (N.def.up >= 0) { N.up = sh.tur[N.def.up]; N.depth = N.up.depth + 1; } });
  sh.models.forEach(function (m) {
    var k = turOf(T, m.path); if (k < 0) return;
    var N = sh.tur[k]; m.hd = N; m.c0 = m.c.slice(); N.models.push(m);
    var R0 = ndRoot(N), R = 0;                                            // 分桶（modelIndex）照掃過的範圍：離最外層轉軸最遠的那個角 ⇒ x ± 它
    [[m.bb[0], m.bb[1]], [m.bb[3], m.bb[1]], [m.bb[0], m.bb[4]], [m.bb[3], m.bb[4]]].forEach(function (q) { R = Math.max(R, Math.hypot(q[0] - R0.c[0], q[1] - R0.c[1])); });
    m.ibx = [R0.c[0] - R, R0.c[0] + R];
  });
  sh.guns.forEach(function (g) {
    var N = g.model.hd; if (!N) return;
    if (g.mt) { g.mt.up = N; g.mt.g = g; }                                            // 自己會轉的砲 ⇒ 掛在砲塔底下再轉一層
    else { g.hd = N; g.ax0 = g.ax.slice(); g.muz0 = g.muz.slice(); g.muzs0 = g.muzs ? g.muzs.map(function (q) { return q.slice(); }) : null; g.cone = +(g.model.meta || {}).cone > 0 ? +g.model.meta.cone * Math.PI / 180 : N.cone; }
    for (var n = N; n; n = n.up) n.guns.push(g);                        // 子樹裡全部的砲（全滅 ⇒ 停）
  });
  // 由外往內排（外層先轉，裡面的照外層轉過之後的角度瞄）；自己會轉、又掛在砲塔上的砲排在最後（21_gunnery.js 舊的那一段不再管它們）
  sh.turN = sh.tur.slice().sort(function (a, b) { return a.depth - b.depth; }).concat(sh.guns.filter(function (g) { return g.mt && g.mt.up; }).map(function (g) { return g.mt; }));
  sh.turG = sh.guns.filter(function (g) { return g.hd || (g.mt && g.mt.up); });
}
/** 這門砲照砲塔現在的角度擺好（砲口、砲軸）：固定在砲塔上的照砲塔；自己會轉、掛在砲塔上的先照自己轉、再照砲塔。 */
function turGunPose(g) {
  var M = g.mt, N = g.hd, ax;
  if (M) {
    var back = function (q) { return [q[0] - M.ax0[0] * M.sl, q[1] - M.ax0[1] * M.sl, q[2]]; };
    g.muz = ndOut(M.up, mountRot(back(M.muz0), M.c, M.yaw)); if (M.muzs0) g.muzs = M.muzs0.map(function (q) { return ndOut(M.up, mountRot(back(q), M.c, M.yaw)); });
    ax = rotZ([M.ax0[0], M.ax0[1], 0], [0, 0, 0], ndYaw(M));
  } else {
    g.muz = ndOut(N, g.muz0); if (g.muzs0) g.muzs = g.muzs0.map(function (q) { return ndOut(N, q); });
    ax = rotZ([g.ax0[0], g.ax0[1], 0], [0, 0, 0], ndYaw(N));
  }
  g.ax = [ax[0], ax[1]];
}
/** 船的格座標 p 站在哪一座砲塔自己的格上（腳下那一格，照現在的角度；不在 ⇒ -1）。 */
function turDeckAt(sh, p) {
  if (!sh.arm || !sh.tur) return -1;
  for (var i = 0; i < sh.arm.length; i++) {
    var a = sh.arm[i], N = a.nd; if (!N || !N.isTur || a.prop) continue;
    var R0 = ndRoot(N), Rg = a.A.ring; if (Rg && Math.hypot(p[0] - R0.c[0], p[1] - R0.c[1]) > Rg.r + 1) continue;
    var Q = ndIn(N, [p[0], p[1], p[2] - 0.5]); if (a.grid.get(Math.floor(Q[0]), Math.floor(Q[1]), Math.floor(Q[2]))) return N.k;
  }
  return -1;
}
/** 站得住看的格子（有會轉的甲板的船：送藥手走路的高度）：船殼＋砲塔的格（照現在的角度）。 */
function turStandG(sh) {
  var g = sh.grid;
  return sh.turSG || (sh.turSG = { sx: g.sx, sy: g.sy, sz: g.sz, get: function (x, y, z) { return sh.grid.get(x, y, z) || (armAt(sh, [x + 0.5, y + 0.5, z + 0.5]) ? 1 : 0); } });
}
/** 跟著轉的東西：[{ N, o, k, q（砲塔座標） }]（o[k] 是一點；o[k] ＝ 一串點 ⇒ 每一點各一筆，i）。 */
function turRiders(sh) {
  var R = [], seen = new Set();
  function put(N, o, k, i) { var p = i === undefined ? o[k] : o[k][i]; if (p) R.push({ N: N, o: o, k: k, i: i, q: ndIn(N, p) }); }
  (sh.turG || []).forEach(function (g) {                                // 砲的站位、站在上面的人、放藥箱的位置：跟著那門砲（自己會轉的 ⇒ 照自己的節點，跟舊的 mountStep 一樣）
    var N = gunNode(g);
    (g.spots || []).forEach(function (s) { put(N, s, 'at'); var c = s.who; if (c && c.gun === g && !c.walk && c.st === 0 && !seen.has(c)) { seen.add(c); put(N, c, 'pos'); put(N, c, 'home'); } });
    if (g.drop) put(N, g, 'drop');
  });
  (sh.stations || []).forEach(function (st) { var N = st.tur >= 0 && sh.tur[st.tur]; if (!N) return; put(N, st, 'at'); put(N, st, 'pos'); (st.slots || []).forEach(function (s, i) { put(N, st.slots, i); }); });
  (sh.crew || []).forEach(function (c) {                                // 站在砲塔自己的格上的人（吊籃、砲塔頂）與他們走到一半的路
    if (c.st > 1 || seen.has(c) || c.st === 4) return;
    var k = turDeckAt(sh, c.pos); if (k < 0) return;
    var N = sh.tur[k]; seen.add(c); put(N, c, 'pos'); put(N, c, 'home');
    if (c.walk) put(N, c.walk, 'to');
    var H = c.hand; if (H && H.wp) for (var i = H.k || 0; i < H.wp.length; i++) put(N, H.wp, i);
  });
  return R;
}
/** 砲塔這一步（mountStep 開頭；L ＝ 瞄準點，船的格座標；沒有 ⇒ null）。 */
function turretStep(sh, dt, L) {
  var R = turRiders(sh), moved = false;
  sh.turN.forEach(function (N) { if (turTurn(N, L, dt)) moved = true; });
  if (!moved) return;
  R.forEach(function (r) { var p = ndOut(r.N, r.q); if (r.i === undefined) r.o[r.k] = p; else r.o[r.k][r.i] = p; });
  turPose(sh);
}
/** 模型、砲照現在的角度擺好（turretStep、除錯的 __game.turret 設角度之後）。 */
function turPose(sh) {
  sh.tur.forEach(function (N) { N.models.forEach(function (m) { m.c = ndOut(N, m.c0); }); });
  (sh.mags || []).forEach(function (g) { if (g.tur >= 0) { g.blast0 = g.blast0 || g.blast.slice(); g.blast = ndOut(sh.tur[g.tur], g.blast0); } });   // 砲塔裡的彈藥箱：殉爆的爆心跟著轉（⛔ 照開局的位置 ⇒ 轉過之後在別的地方炸）
  sh.turG.forEach(turGunPose);
  ropeRideStep(sh);                                                     // 綁在砲塔上的繩、繩梯跟著轉／拉伸
}
// ── 跟著砲塔轉的繩、繩梯（Tim 2026-10-17：「繩梯直接綁在頂部開口」「優化繩梯支援旋轉(旋轉後兩端仍然連通)」「也可以被拉伸(有彈性)」）──
// 每條繩的兩端各自綁在哪：照雕刻的寫法（r.ends，相對於繩所在那一層 r.frame；匯出 include=ends）——
//   x,y,z ⇒ 繩所在那一層；固定點、關聯/…/固定點、model:… ⇒ 那個路徑；落在哪一座砲塔底下（turOf，最近的那一層；船身 ⇒ −1）。
//   rope:母繩/比例（橫繩組的每一道、子繩）⇒ 母繩兩端照比例混。⇒ 一端 ＝ 幾座的權重 [[k, w], …]。
// 畫、被打斷都照現在的位置：每一點 ＝ 兩端的換算照它沿繩的位置 t 內插 —— 兩端同一座 ⇒ 整條跟著轉（剛體，一點都不變形）；
//   不同（一頭在砲塔、一頭在甲板／別座砲塔）⇒ 中間被拉長、縮短（有彈性）。
// 船型上沒有任何一條綁在砲塔上 ⇒ T.ropeRide ＝ null ⇒ 一行都不多算、戰局逐位元組不變。
/** 船型 T 每條繩兩端的權重（同一型算一次）：[[E0, E1] | null, …]；整艘都沒有 ⇒ null。 */
function ropeRideOf(T) {
  if (T.ropeRide !== undefined) return T.ropeRide;
  var R = (T.rig && T.rig.ropes) || [], idx = {}, memo = [], any = false;
  if (!(T.turrets || []).length || !R.length) return (T.ropeRide = null);
  function full(fr, n) { return fr ? fr + '/' + n : n; }
  R.forEach(function (r, j) { idx[full(r.frame || '', r.name)] = j; });
  function endW(r, ref, seen) {
    var fr = r.frame || '';
    if (typeof ref !== 'string') return [[turOf(T, full(fr, '_')), 1]];
    if (ref.indexOf('rope:') === 0) {                                    // 掛在母繩上：母繩兩端照比例混
      var s = ref.slice(5), i = s.lastIndexOf('/'), u = clamp(+s.slice(i + 1) || 0, 0, 1), j = idx[full(fr, s.slice(0, i))];
      if (j === undefined || seen[j]) return [[turOf(T, full(fr, '_')), 1]];
      var E = ends(j, seen), out = [];
      E[0].forEach(function (a) { out.push([a[0], a[1] * (1 - u)]); }); E[1].forEach(function (a) { out.push([a[0], a[1] * u]); });
      return out;
    }
    if (/^-?[\d.]+,-?[\d.]+,-?[\d.]+$/.test(ref)) return [[turOf(T, full(fr, '_')), 1]];   // 座標 ⇒ 繩所在那一層
    return [[turOf(T, full(fr, ref.replace(/^(model|sail):/, ''))), 1]];
  }
  function ends(j, seen) {
    if (memo[j]) return memo[j];
    var r = R[j], s2 = Object.assign({}, seen); s2[j] = 1;
    var e = r.ends || [], E = [endW(r, e[0], s2), endW(r, e[1], s2)];
    E = E.map(function (L) { var m = {}; L.forEach(function (a) { m[a[0]] = (m[a[0]] || 0) + a[1]; }); return Object.keys(m).map(function (k) { return [+k, m[k]]; }).filter(function (a) { return a[1] > 1e-9; }); });
    return (memo[j] = E);
  }
  var out = R.map(function (r, j) {
    var E = ends(j, {}); if (!E[0].some(function (a) { return a[0] >= 0; }) && !E[1].some(function (a) { return a[0] >= 0; })) return null;
    any = true; return E;
  });
  return (T.ropeRide = any ? out : null);
}
/** 一點 p（開局的船的格座標）照一端的權重換到現在（船身 ⇒ 原地；砲塔 ⇒ 照那一座現在的角度）。 */
function rideAt(sh, E, p) {
  if (E.length === 1) return E[0][0] < 0 ? p : ndOut(sh.tur[E[0][0]], p);
  var x = 0, y = 0, z = 0;
  E.forEach(function (a) { var q = a[0] < 0 ? p : ndOut(sh.tur[a[0]], p); x += q[0] * a[1]; y += q[1] * a[1]; z += q[2] * a[1]; });
  return [x, y, z];
}
/** 第 j 條繩上的一點 p（沿繩的位置 t：0 ＝ 第一端、1 ＝ 第二端）現在在哪。 */
function rideRope(sh, j, p, t) {
  var E = sh.T.ropeRide[j]; if (!E) return p;
  var a = rideAt(sh, E[0], p), b = E[0] === E[1] ? a : rideAt(sh, E[1], p);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
/** 綁在砲塔上的繩梯（R ＝ { j：[最低一道, 最高一道] 是第幾條繩, z0, z1：梯腳、梯頭的高度 }）上的一點 p（開局的船的格座標）現在在哪：
 *  最低、最高那一道各照它們現在的換法換過去，照高度在兩者之間內插 —— 兩道同一座砲塔 ⇒ 整座跟著轉；一頭在砲塔、一頭在甲板 ⇒ 中間拉長、縮短。
 *  第一人稱（81_fps.js）、預備水手（42_hands.js stepHand）爬的時候都照它（梯腳、梯頭、爬到一半的人）。 */
function ladRide(sh, R, p) {
  if (!R) return p;
  var a = rideRope(sh, R.j[0], p, 0.5), b = rideRope(sh, R.j[1], p, 0.5), s = R.z1 !== R.z0 ? clamp((p[2] - R.z0) / (R.z1 - R.z0), 0, 1) : 0;
  return [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
}
/** 一座繩梯（shipLadders 的一項）綁不綁在砲塔上：綁 ⇒ ladRide 用的 R；不綁 ⇒ null。 */
function ladRideOf(T, l, z0, z1) { var RR = ropeRideOf(T); return RR && l.ri && (RR[l.ri[0]] || RR[l.ri[1]]) ? { j: l.ri, z0: z0, z1: z1 } : null; }
/** 砲塔轉過（turPose）：綁在砲塔上的繩照現在的角度重擺（畫 ⇒ rigDirty；被打斷 cutRig 照 r.pts、r.bb）。 */
function ropeRideStep(sh) {
  var R = ropeRideOf(sh.T); if (!R) return;
  for (var j = 0; j < R.length; j++) {
    var r = sh.ropes[j]; if (!R[j] || !r || r.dead) continue;
    var P0 = r.pts0 || (r.pts0 = r.pts), n = P0.length / 3, P = new Array(P0.length);   // ⛔ 不改 P0：開局那一份跟船型共用
    for (var i = 0; i < n; i++) { var q = rideRope(sh, j, [P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2]], n > 1 ? i / (n - 1) : 0); P[i * 3] = q[0]; P[i * 3 + 1] = q[1]; P[i * 3 + 2] = q[2]; }
    r.pts = P; r.bb = ropeBox(P);
  }
  sh.rigDirty = true;
}
/** 一個節點這一步轉多少（砲塔：前方對準瞄準方位；自己會轉、掛在砲塔上的砲：照舊的 mountStep 一樣挑砲門／照 arc、fire 轉）。回：有沒有動。 */
function turTurn(N, L, dt) {
  if (!L) return false;
  var g = N.isTur ? null : N.g; if (N.isTur ? !N.guns.some(function (q) { return q.alive; }) : !g || !g.alive) return false;   // 砲全滅 ⇒ 停在最後的角度
  var Lp = N.up ? ndIn(N.up, L) : L, rel = Math.atan2(Lp[1] - N.c[1], Lp[0] - N.c[0]) - (N.isTur ? N.f0 : Math.atan2(N.ax0[1], N.ax0[0]));
  rel = Math.atan2(Math.sin(rel), Math.cos(rel));
  if (N.ports) {
    var best = N.yawT, bd = Math.abs(Math.atan2(Math.sin(rel - N.yawT), Math.cos(rel - N.yawT)));
    N.ports.forEach(function (p) { var d = Math.abs(Math.atan2(Math.sin(rel - p), Math.cos(rel - p))); if (d < bd - 0.1) { bd = d; best = p; } });
    N.yawT = best;
  } else N.yawT = turretAim(N, rel);
  var d = N.yawT - N.yaw, sl0 = N.sl || 0;
  if (Math.abs(d) < 1e-6 && !N.sl) return false;
  if (N.runin !== undefined) {                                          // 換砲門：先拉進來、到了推出去（跟舊的 mountStep 一樣）
    if (Math.abs(d) >= 1e-6 && N.sl < N.runin) { N.sl = Math.min(N.runin, N.sl + MOUNT_RUN * dt); d = 0; }
    else if (Math.abs(d) < 1e-6) N.sl = Math.max(0, N.sl - MOUNT_RUN * dt);
  }
  N.yaw += clamp(d, -N.rate * dt, N.rate * dt); if (Math.abs(N.yawT - N.yaw) < 1e-6) N.yaw = N.yawT;
  if (N.full && Math.abs(N.yaw) > Math.PI) { var w = N.yaw > 0 ? -2 * Math.PI : 2 * Math.PI; N.yaw += w; N.yawT += w; }
  if (g) { g.model.rot = N.yaw; if (N.sl !== sl0) g.model.gsl = N.sl ? [-N.ax0[0] * N.sl, -N.ax0[1] * N.sl] : null; }
  return true;
}
/** 除錯（90_main.js __game.turret）：把第 k 座砲塔直接設成 yaw（弧度），跟著轉的東西一起換。 */
function turretSet(sh, k, yaw) {
  var N = sh.tur && sh.tur[k]; if (!N) return false;
  var R = turRiders(sh); N.yaw = N.yawT = yaw;
  R.forEach(function (r) { var p = ndOut(r.N, r.q); if (r.i === undefined) r.o[r.k] = p; else r.o[r.k][r.i] = p; });
  turPose(sh); return true;
}
/** 匯入檢查的讀數（75_shipcheck.js）：每座 ＝ 路徑、在哪一座上面、轉軸、前方、arc／fire、轉速、上面幾門砲、殼幾格。 */
function turretSummary(sh) {
  if (!sh.tur) return '';
  var dg = function (a) { return Math.round(a * 57.2958); };
  return sh.tur.map(function (N) {
    var A = (sh.T.armor || []).filter(function (q) { return q.tur === N.k; })[0], own = N.guns.filter(function (g) { return gunNode(g) === N || (g.mt && g.mt.up === N); });
    return N.path + (N.up ? '（疊在 ' + N.up.path + ' 上）' : '') + '：轉軸 ' + N.c.map(function (v) { return +v.toFixed(1); }).join(',') + '、前方 ' + dg(N.f0) + '°、轉 ' + dg(N.arc[0]) + '～' + dg(N.arc[N.arc.length - 1]) + '°' +
      (N.fire[0] !== N.arc[0] || N.fire[N.fire.length - 1] !== N.arc[N.arc.length - 1] ? '（開火 ' + dg(N.fire[0]) + '～' + dg(N.fire[N.fire.length - 1]) + '°）' : '') + '、' + dg(N.rate) + '°／秒、砲 ' + own.length + ' 門' +
      (N.guns.length > own.length ? '（含上面的砲塔共 ' + N.guns.length + ' 門）' : '') + '、殼 ' + (A ? A.n.toLocaleString('en') + ' 格' : '0 格') + (N.models.length > own.length ? '、跟著轉的模型 ' + N.models.length + ' 個' : '');
  }).join('；');
}
