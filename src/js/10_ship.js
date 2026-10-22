// ───────────────────────── 船 ─────────────────────────
// 格 → 船體（公尺）：(x, y, z) ⇒ (S(x−cx), S(z−zw), S(y−cy))。船體 ＝ 世界的軸（+X 船頭、+Y 上、+Z ＝ 右舷）。
// 雕刻引擎的格是另一個手性（面向船頭 +x、上 +z，+y 在右手邊 ＝ 右舷 S：basecamp 的命名、船尾名牌 EMBER 在雕刻引擎的 view 裡讀起來是正的）
// ⇒ 這是一個鏡射（行列式 −1）：船殼的繞序反過來（畫船時 frontFace CW，見 60_render.js shipFace）。
// ⛔ 2026-10-13 以前是 −S(y−cy)（旋轉、不是鏡射）⇒ 整艘船畫成作品的鏡像：EMBER 反著寫、右舷 S 出現在畫面左邊。
function shipBaseMatrix(T) {
  return new Float32Array([S, 0, 0, 0, 0, 0, S, 0, 0, S, 0, 0, -S * T.cx, -S * T.zw, -S * T.cy, 1]);
}
function shipMatrix(sh) {
  var m = trans(sh.px, -sh.sink + sh.lift + (sh.wl || 0) + sh.bob, sh.pz);   // wl：船底的平均水面、bob：船身相對它的起伏（08_sea.js）
  m = M4.mul(m, rotM([0, 1, 0], sh.yaw));
  m = M4.mul(m, rotM([0, 0, 1], sh.pitchA + (sh.pitchW || 0)));
  m = M4.mul(m, rotM([1, 0, 0], sh.rollA + (sh.rollW || 0)));
  return M4.mul(m, shipBaseMatrix(sh.T));
}
function shipCenter(sh) { return M4.pt(sh.M, sh.T.cx, sh.T.cy, sh.T.geo.center); }
function toLocal(sh, p) { return M4.pt(sh.inv, p[0], p[1], p[2]); }

function makeShip(i, team, yaw, pz, T, px) {                          // T：船型（05_hull.js）；px：編隊裡的前後位置（52_fleet.js spawnFleet；沒給 ＝ 0）
  var M = makeShipSteps(i, team, yaw, pz, T, px); stepsRun(M.steps); return M.sh;
}
/** makeShip 拆成幾段（2026-10-20；?start=1 開戰分段做、每段之間讓出一次，見 70_flow.js startStaged）：
 *  模型 ／ 帆桁、裝飾 ／ 砲、甲板、彈藥庫 ／ 取用點 ／ 艙房 ／ 繩（每 ROPE_FIX_N 條）／ 繩的固定檢查（同一型第一次分好幾步算）／ 帆 ／ 帆的繩與桅 ／
 *  走路格（同一型第一次一層一步）／ 船員 ／ 水格（同一型第一次分四步）／ 矩陣與進水 ／ 動力。
 *  一段一段照順序做 ＝ 一口氣做完的同一串程式（中間沒有別人碰戰局：分段時模擬不走、畫面不畫）。做完 M.sh ＝ 那艘船。 */
function makeShipSteps(i, team, yaw, pz, T, px) {
  var M = { sh: null, steps: null }, sh = null;
  M.steps = [function () {                                             // 模型與砲、艙房
  var grid = T.hullG.share(), rsSet = new VK.RegionSet(gl, grid, QIDX);   // T.hullG：船殼（砲帶的裝甲另外一份，24_armor.js armorShip；沒有裝甲 ＝ T.base）
  rsSet.shareFrom(T.pristine);
  sh = {                                                            // cfg：船隻設定（開戰時那一型的值，04_state.js）
    T: T, cfg: cfgCopy(T.id), i: i, team: team, grid: grid, rs: rsSet, yaw: yaw, px: px || 0, pz: pz, sink: 0, sinkV: 0, lift: 0, liftT: 0, rollA: 0, pitchA: 0, rollV: 0, bob: 0,
    phase: rnd() * 6.28, orig: grid.count, flood: new Float32Array(T.sz * 3), lost: 0, seeds: [], impulse: [0, 0, 0],
    guns: [], ropes: [], sails: [], rigDirty: true, lines: null, tris: null, masts: [], aim: null, reloadT: i === PLAYER_I ? modeRule('myReload') : RELOAD,
    fired: 0, hits: 0, salvo: 0, aiWait: rr(1, 3), sunk: false, struck: false, fate: '', silentT: -1, gunsAlive: 0, mastsUp: T.masts.length, sinkingFinal: false,
    spd: 0, spd0: true, yawRate: 0, vel: [0, 0, 0], wakeT: 0, sailFrac: 1, pos: '',
    side: 'S', manual: false, rudder: 0, sailSet: 3, power: 1, bumpT: 0
  };
  if (T.key && T.key !== T.id) { var T0 = HULLT[T.id], c0 = SHIP_CFG[T.id]; sh.cfg.ballast = T0 && c0 && c0.ballast !== undefined && c0.ballast !== T0.ballast0 ? c0.ballast : cfgDefault('ballast', T); }   // 艦隊裡寫了換裝的那一艘（38_fit.js）：壓艙物照自己那一份的預設（換了砲 ⇒ 重量不同）；玩家在配置頁改過那一型的 ⇒ 照改的
  smoothShip(sh);                                                       // 平滑渲染的格：共用船型那一份網格（15_smooth.js）
  // 模型（砲、火藥桶、舵輪）：整個是一塊剛體 —— 被打到扣血，歸零整個飛出去（火藥桶 ⇒ 殉爆，見 23_powder.js），⛔ 不拆格。
  // 種類照 basecamp 給的 meta（TASK-0517）：{kind:'gun', gun:'24l'|'32c'|'18chase'}、{kind:'powder', powder_lb}；舵輪沒有 meta ⇒ 照名字。
  sh.models = (T.rig.models || []).map(function (m, k) {
    var b = m.bbox, kind = modelKind(m), pv = (m.points || {}).pivot;
    var cx = Math.floor((b[0] + b[3]) / 2), cy = Math.floor((b[1] + b[4]) / 2), fz = Math.floor(b[2]) - 1;
    var foot = -1;
    if (kind === 'yard' && pv) foot = anchorNear(T, pv[0], pv[1], pv[2], 8);   // 帆桁：「腳」是轉軸旁最近的那一格桅（桅斷了跟著走、被打掉就掉）；⛔ 往下找：艏斜桅下面是空的，spritsail 一開局就掉
    var st = (m.points || {})['stock-top'];
    if (kind === 'rudder' && st) foot = anchorNear(T, st[0], st[1], st[2], 8);   // 舵：掛在艉柱上 ⇒「腳」是舵頭旁的船尾（⛔ 往下找：舵底在 z 0，腳落到 z −1 ⇒ 開局就掉）
    var hm = m.meta || {};
    if (kind === 'rudder' && !st && isFinite(+hm.hinge_x) && isFinite(+hm.hinge_y) && isFinite(+hm.hinge_z)) {   // 沒有 stock-top、有鉸鏈 meta（炎羽號，2026-10-15 開局就掉）⇒ 沿鉸鏈軸走到舵頂那一高度找船尾
      var az = +hm.axis_z || 1, t = (b[5] - +hm.hinge_z) / az;
      foot = anchorNear(T, +hm.hinge_x + (+hm.axis_x || 0) * t, +hm.hinge_y + (+hm.axis_y || 0) * t, b[5], 8);
    }
    var bl = (m.points || {}).bail;
    if (foot < 0 && bl) foot = anchorNear(T, bl[0], bl[1], bl[2], 8);
    var sa = (m.points || {})['spin-a'];
    if (foot < 0 && hm.spin && sa) foot = anchorNear(T, sa[0], sa[1], sa[2], 8);   // 照參數轉的機件（齒輪、飛輪；kotoko 2026-10-16）：掛在轉軸 spin-a 旁那一格（⛔ 往下找：外框底下是空的機艙 ⇒ 當成吊著的小艇、spin 不收）   // 提著的燈（夜燈號船首像的提燈，固定點 bail ＝ 提環頂、手握的地方）：「腳」是手（⛔ 往下找：底下是海 ⇒ 開局就掉、燈不亮）
    var sfw = (m.points || {})['shaft-fwd'];
    if (foot < 0 && hm.kind === 'propeller' && sfw) foot = anchorNear(T, sfw[0], sfw[1], sfw[2], 8);   // 螺旋槳（TASK-0628）：掛在軸接到船殼的那一格（shaft-fwd）旁 ⇒ 那一段被打斷就掉（⛔ 往下找：底下的 skeg 被打掉也掉、跟軸無關）
    var rg = (m.points || {}).ring;
    if (foot < 0 && hm.kind === 'anchor' && rg) foot = anchorNear(T, rg[0], rg[1], rg[2], 8);   // 錨（meta kind=anchor）：掛在吊錨木上 ⇒「腳」是錨環 ring 旁的那一格（⛔ 往下找：掛在舷外、底下是海 ⇒ 開局就掉；維吉尼亞號 2026-10-15）
    var hg = (m.points || {})['hinge-a'];
    if (foot < 0 && hm.kind === 'door' && hg) foot = anchorNear(T, hg[0], hg[1], hg[2], 8);   // 門、艙蓋（TASK-0638，25_doors.js）：掛在鉸鏈旁的那一格（⛔ 往下找：艙蓋底下就是艙口 ⇒ 腳落到下一層甲板，艙口邊被打掉也不掉）
    if (foot < 0 && hm.kind === 'oar' && pv) foot = anchorNear(T, pv[0], pv[1], pv[2], 8);   // 槳（TASK-0691）：掛在槳座（pivot）旁那一格舷緣 ⇒ 舷緣被打掉就掉（⛔ 往下找：槳伸在舷外、底下是海 ⇒ 開局就掉）
    var hang = false;
    if (foot < 0) { var z0 = fz; while (fz > 0 && !T.hullG.get(cx, cy, fz)) fz--; if (z0 - fz <= 12 || kind !== 'model') foot = VK.pack(cx, cy, fz); else hang = true; }   // 腳下那一格甲板（被打掉 ⇒ 掉下去）
    // 掛著的（吊艇架上的小艇；Tim 2026-10-14：一開場就掉）：底下 1.2 m 內沒有甲板 ⇒ 掛在吊索上（下面 hangFalls 找；吊索全斷才掉）。
    //   ⛔ 照舊往下找 ⇒ 找到海底 z 0 ⇒ 第一次 survey 就掉。foot 暫時是正下方（找到吊索之後換成吊索上端的那一格 ⇒ 吊艇架被打斷帶走時跟著走）
    if (foot < 0) foot = VK.pack(cx, cy, fz);
    var hpm = kind === 'powder' ? powderHP() : DRVP[kind] && DRVP[kind].hpK > 0 ? Math.round(GUN_HP * DRVP[kind].hpK) : kindProp(kind, 'hpK') ? Math.round(GUN_HP * kindProp(kind, 'hpK')) : kind === 'model' ? 1 : Math.round(GUN_HP * (GUNS[kind] && GUNS[kind].hpK || 1) * gunHpK(T, kind, m.name));   // 細節設定的血量；整件一塊的動力件（槳）照道具設定頁的 hpK（31_drive.js DRVP）；規格表 hpK（舵輪 6 成、門 5 成）；帆桁、舵跟砲一樣；砲種表的 hpK ＝ 血量倍率（莫尼特號的鐵甲砲塔 8；Tim 2026-10-15 匯入莫尼特號：一發就打飛不像史實）
    var mt = m.meta || {};
    var o = { T: T, k: k, name: m.name.split('/').pop(), path: m.name, kind: kind, hp: hpm, hpMax: hpm, mesh: m.mesh, origin: m.origin, bb: b, pts: m.points || {}, meta: mt,
      c: [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2], foot: foot, alive: true,
      rot: 0, r0: (+mt.rotate_z_deg || 0) * Math.PI / 180, piv: pv, yk: mt.yard, sail: mt.sail, hang: hang };   // 帆桁：rot ＝ 在作品的角度（r0）之外又轉了多少（追風，30_rig_physics.js）
    if (T.fit && T.fit.was && T.fit.was[m.name]) o.was = T.fit.was[m.name];   // 換了裝的掛點：原本雕的那一門（38_fit.js fitKind0／fitBB0）
    return o;
  });
  }, function () {                                                   // 帆桁、裝飾
  sh.yards = sh.models.filter(function (m) { return m.kind === 'yard' && m.piv; });
  // 裝飾（TASK-0682；05_hull.js decoSplit）：不在 sh.models ⇒ 戰局看不到（重量、命中、殉爆、掉落都不算）。只記腳下那一格（同上面的模型：外框底往下 12 格內的甲板）：
  //   被打掉 ⇒ 不畫（⛔ 不 blowModel：那會抽 rnd()，開／關裝飾戰局就分岔）。k：燈晃的相位（lanternK）。
  //   砲門蓋板（kind=portlid，TASK-0719；62_ports.js）：腳 ＝ 鉸鏈 hinge-a 旁 8 格內的船殼（⛔ 往下找：蓋板伸在舷外、底下是海 ⇒ 腳 −1、永遠畫，鉸鏈旁的船殼被打掉也不掉）；
  //   pts、bb、path 給 62_ports.js 讀（鉸鏈、外框、匯入檢查的名字）。只是讀船型的格子 ⇒ 戰局不變。
  sh.decos = (T.decos || []).map(function (m, k) {
    var b = m.bbox, cx = Math.floor((b[0] + b[3]) / 2), cy = Math.floor((b[1] + b[4]) / 2), z0 = Math.floor(b[2]) - 1, fz = z0, mt = m.meta || {}, hg = mt.kind === 'portlid' && (m.points || {})['hinge-a'];
    while (fz > 0 && z0 - fz < 12 && !T.hullG.get(cx, cy, fz)) fz--;
    return { mesh: m.mesh, origin: m.origin, meta: mt, k: 1000 + k, foot: hg ? anchorNear(T, hg[0], hg[1], hg[2], 8) : T.hullG.get(cx, cy, fz) ? VK.pack(cx, cy, fz) : -1, pts: m.points || {}, bb: b, path: m.name };
  });
  }, function () {                                                   // 砲、砲塔、裝甲、門、甲板、彈藥庫
  // 砲：長砲（24 磅，兩舷各 14）、carronade（32 磅，兩舷各 12）、追擊砲（18 磅，船頭兩舷各 1）都是模型。
  // 砲軸 ＝ 固定點 muzzle − breech（格座標、水平）；砲口 ＝ muzzle 再往外 1.5 格（muzzle 在砲口內膛那一格）。
  // 程式裡的 'S'／'P' 照砲軸（+y ＝ S，跟模型名字一致）＝ 右舷／左舷（shipBaseMatrix 照雕刻引擎的手性鏡射過來）。給人看的走 sideName；A／D 照畫面的左右。
  sh.models.forEach(function (m) {
    if (!GUNS[m.kind]) return;
    var A = gunMuzzle(m);
    sh.guns.push(m.gun = { name: m.name, type: m.kind, side: A.ax[1] >= 0 ? 'S' : 'P', model: m, ax: A.ax, muz: A.muz, muzs: A.muzs, alive: true, reload: rr(0, 1.2), box: BOX_N * gunBoxK(m.kind), needCart: false, safe: !!(m.meta && +m.meta.safe), ammoFix: gunAmmoFix(m, m.kind) });   // box：砲旁藥箱裡的發數（份數 × 砲種表 box）；safe：模型 meta safe=1 ⇒ 開火前看砲線（21_gunnery.js selfBlock）
  });
  sh.guns.forEach(function (g) { gunMountInit(sh, g); });            // 迴旋砲、砲塔（meta mount；21_gunnery.js）—— 沒標的砲不動
  turretShip(sh);                                                       // 砲塔層（kind=turret；27_turret.js）：砲、模型掛上去 —— 沒有 ⇒ 不做事
  armorShip(sh);                                                        // 砲帶的裝甲（kind=armor；24_armor.js）跟著那門砲轉 —— 沒有 ⇒ 不做事
  doorsShip(sh);                                                        // 門、艙蓋（kind=door；25_doors.js）—— 沒有 ⇒ 不做事
  spinShip(sh);                                                         // 照參數轉的子物件（meta spin；26_spin.js，TASK-0640）—— 沒有 ⇒ 不做事
  sh.guns.sort(gunOrder);
  sh.decks = gunDecks(sh); sh.weatherDeck = sh.decks.length ? sh.decks[sh.decks.length - 1].key : null;   // 砲甲板（照砲的高度分層）；最上面那層 ＝ 露天
  sh.deckZ = {}; sh.decks.forEach(function (D) { sh.deckZ[D.key] = D.zr; });
  sh.mags = makeMags(sh);                                                // 彈藥庫（23_powder.js）
  }, function () {                                                   // 取用點
  sh.stations = makeStations(sh);                                        // 兩層甲板的火藥與彈藥取用點（火藥桶也是模型，加在 sh.models 後面）
  }, function () {                                                   // 艙房的家具、抽水機
  return shipRoomSteps(sh);                                              // 一間一步（36_rooms.js）
  }, function () {                                                   // 抽水機
  pumpModels(sh);                                                       // pumpModels：甲板上擺的抽水機（45_pumps.js；TASK-0604）；空艙房與功能艙的家具（36_rooms.js；TASK-0568）：家具也是模型 ⇒ 排在命中的分桶之前
  sh.mIdx = modelIndex(sh.models);
  }, function () {                                                   // 繩
  // 繩與帆：兩端（帆取最高那一排）各找最近的實心格當錨 —— 錨被打掉或跟船分家 ⇒ 繩斷、帆掉
  //   會動的繩（meta anim；26_gunanim.js）寫明 model: 的那一端 ⇒ 不找格、交給 linkRopes 綁模型（⛔ 照找格 ⇒ 木塔上的弩弦兩端都貼著木塔，被綁在船上、跟不了弩砲；其他繩照舊 ⇒ 戰局不變）
  var RS = T.rig.ropes, out = [];                                        // 每 ROPE_FIX_N 條一步（一條兩端各找一次錨）
  for (var a = 0; a < RS.length; a += ROPE_FIX_N) out.push(function (a0) { return function () {
    RS.slice(a0, a0 + ROPE_FIX_N).forEach(function (r) {
      var n = r.pts.length / 3, mv = !!(r.meta && r.meta.anim), md = function (k) { return (mv || (r.fitEnd && r.fitEnd[k])) && r.ends && typeof r.ends[k] === 'string' && r.ends[k].indexOf('model:') === 0; };   // fitEnd：換裝挪過的那一端（38_fit.js）跟會動的繩一樣交給 linkRopes 綁模型
      sh.ropes.push({ pts: r.pts, col: r.color, bb: ropeBox(r.pts), a: md(0) ? -1 : anchorNear(T, r.pts[0], r.pts[1], r.pts[2], 5), b: md(1) ? -1 : anchorNear(T, r.pts[n * 3 - 3], r.pts[n * 3 - 2], r.pts[n * 3 - 1], 5), name: r.name, meta: r.meta || null });
    });
  }; }(a));
  return out.concat([function () { linkRopes(T, sh.ropes, sh.models); }]);
  }, function () {                                                   // 繩的固定檢查（ropeFixCheck：同一型只算一次 ⇒ 第一次照 ropeFixSteps 分好幾步算）
  return ropeFixSteps(T, sh.ropes, sh.models);
  }, function () {
  ropeFixApply(sh);                                                     // 兩端都沒固定（綁在空中）的繩不生成（ropeFixCheck；匯入檢查報 ✗）
  }, function () {                                                   // 帆與桅
  hangFalls(sh); sh.rbin = new Set();
  T.rig.sails.forEach(function (s) {
    var vz = -1e9, ax = 0, ay = 0, az = 0, k = 0, j;
    for (j = 2; j < s.verts.length; j += 3) vz = Math.max(vz, s.verts[j]);
    for (j = 0; j < s.verts.length; j += 3) if (s.verts[j + 2] > vz - 2) { ax += s.verts[j]; ay += s.verts[j + 1]; az += s.verts[j + 2]; k++; }
    var sl = sailAnchors(sh, { verts: s.verts, tris: s.tris, col: s.color, name: s.name, meta: s.meta || null, bb: ropeBox(s.verts) }, [ax / k, ay / k, az / k]);
    if (s.meta && s.meta.team) { sl.as = s.truckCell >= 0 ? [s.truckCell] : []; sl.par = []; sl.a = s.truckCell; }   // 陣營旗（77_colours.js）：靠桅頂那一格（旗桿頂離格子太遠，照上下緣找會找不到）
    sh.sails.push(sl);
  });
  }, function () {                                                   // 帆自己的繩、帆桁、桅
  // 帆自己的繩（`<帆名>.sheet-S`、`.tack-P`…）：帆腳那一端綁在帆上 ⇒ 帆掉了或被帶走，它們跟著斷
  // （⛔ 只靠繩的依靠不夠：sheet 與 tack 互相掛著、另一端綁甲板，帆沒了也還浮在半空）
  sh.sails.forEach(function (s, k) { s.k = k; s.hp = s.hpMax = SAIL_HP; s.lines = []; sh.ropes.forEach(function (r, j) { if (sailRope(r, s.name)) s.lines.push(j); }); });
  sh.sails.forEach(function (s) {
    s.yards = sh.yards.filter(function (y) { return y.sail === s.name; });   // 掛這面帆的帆桁（spanker：gaff＋boom）
    // 帆腳跟著轉的帆桁：topsail 以上 ＝ 下一根（sheet 綁在它兩端）；course ＝ 沒有（綁甲板）；spanker（沒有帆腳，下緣綁 boom）＝ 低的那根
    var f = T.cloth[s.k] ? T.cloth[s.k].foot : -1, low = s.yards.slice().sort(function (a, b) { return a.piv[2] - b.piv[2]; });
    s.footYard = f >= 0 ? sh.models[f] : low.length > 1 ? low[0] : null;
    if (low.length > 1) s.yards = low.reverse();                          // 帆頂那根排第一（打中帆照它轉回作品角度）
  });
  ropeYards(sh); childRopes(sh); childBind(sh);
  sh.ropes.forEach(function (r) { r.never = r.lz = !!r.dead; });        // 一開始就不畫的繩不會變成垂下來的繩（物理，見 physStep）
  sh.cl = T.cloth.map(function (C) { return { T: C, p: null, hidden: true }; }); sh.loose = []; sh.shreds = [];   // shreds：帆的布片（34_shreds.js）
  sh.sails.forEach(function (s) { s.flag = isFlag(s); s.area = s.flag ? 0 : sailArea(s); }); sh.sailArea0 = sh.sails.reduce(function (a, s) { return a + s.area; }, 0) || 1;   // 旗不算推力（面積 0）
  applySailSet(sh);
  T.masts.forEach(function (m) { sh.masts.push({ name: m.name, x: m.x, z0: m.z0, z1: m.z1, orig: m.orig, z0top: m.z0top, up: true }); });
  }, function () {                                                   // 船員的走路格（navBuild：同一型同一層只建一次）先一層一步建好 ⇒ makeCrew 裡的 makeHands 照鍵拿同一份（42_hands.js crewNavSteps）
  return crewNavSteps(sh);
  }, function () {                                                   // 船員
  sh.crew = makeCrew(sh); sh.crew0 = sh.crew.length; sh.wounded = 0; sh.dead = 0; sh.kills = 0; sh.wounds = 0; sh.causes = {};   // kills／wounds：累計（廣播傷亡用；wounded 會在傷者陣亡時減回去）
  }, function () {                                                   // 進水的水格（flType：同一型只算一次 ⇒ 第一次照 flTypeSteps 分三步算）
  var FL = FL_LV[FLOOD_LV]; return FL ? flTypeSteps(T, FL.c) : [];
  }, function () {                                                   // 矩陣、進水、動力
  sh.news = { guns: [], t: -9, k: 0, w: 0, kr: {}, wr: {} };
  sh.M = shipMatrix(sh); sh.inv = M4.inv(sh.M);
  sh.fl = flNew(sh);                                                    // 進水：粒子模式（33_flood.js；公式模式 ⇒ null）
  if (sh.fl && sh.fl.L.room) sh.wrs = wrsInit(sh);                      // 第 4 檔「房間」（TASK-0810）：房間模擬（33_wrsim.js；船型沒有房間 ⇒ null ⇒ 照水格走）
  portsFloodInit(sh);                                                   // 砲口進水（25_doors.js，TASK-0822）：沒有蓋板的砲口當場登記成進水口
  }, function () {
  driveInit(sh);                                                        // 動力源（帆、蒸汽機、魔法）與水阻（31_drive.js，TASK-0630）
  M.sh = sh;
  }];
  return M;
}
// 砲種（meta gun 的代碼 ⇒ 程式裡的種類）：名字、初速（m/s）、裝填倍率、彈大不大（洞大一點）、砲班滿編／最少、重量（噸，浮力用）、每發傷害（DMG 的鍵，細節設定）。
// 長砲 24 磅、carronade 32 磅、追擊砲 18 磅是憲法號的；32 磅長砲是給餘燼號的（basecamp TASK-0519：下層砲甲板 28 門，新做一門）；4 磅砲是夜隼號的（兩舷各 6）。
// hole：實心彈的洞大小倍率（沒寫 ＝ 1；big ＝ 1.25）。
var GUNS = CFG.guns;   // config/game.json 的 guns（TASK-0542）：code、name、short、V 初速（m/s）、reload 裝填倍率、big、hole、crew 砲班滿編、min 最少、mass 重量（噸）
var GUN_CODE = {}; Object.keys(GUNS).forEach(function (k) { GUN_CODE[GUNS[k].code] = k; });
// 武器種類（TASK-0693，持火號）：砲種表的 weapon（現在只有 siphon；弩砲 toxoballistra、投石機 manganikon 的機制還在想）⇒ 模型 meta weapon= 照它分流（優先於 gun=：舊作品 gun 寫的是頂替用的砲種代碼）。
var GUN_WEAPON = {}; Object.keys(GUNS).forEach(function (k) { if (GUNS[k].weapon) GUN_WEAPON[GUNS[k].weapon] = k; });
// 固定彈種：砲種表 ammo（或模型 meta ammo）⇒ 那門砲不管玩家選哪一種都打這一種（現在只有希臘火）；沒寫、或不認得 ⇒ 照選的。
var AMMO_NAME = { solid: 0, shell: 1, chain: 2, greekfire: 3, bolt: 4, firebolt: 5, stone: 6 };
// 弩箭（Tim 2026-10-18：「弩炮目前我想直接做成換皮大炮(只是彈藥不同) 一樣走裝彈 發射流程」）：彈種序號 4，飛行與命中照實心彈（b.ammo ＝ 0、b.bolt 標著畫成一支箭、開火沒有砲煙砲聲），
//   傷害照砲種表的每發傷害（DMG.ballista ＝ 細節設定 dmgbl）。⛔ 不在玩家換彈的三種（AMMO）裡：只給固定彈種的砲（砲種表 ammo=bolt）。持火號的弩砲後來改打火箭（firebolt，下面）。
var AMMO_BOLT = 4;
// 火箭（Tim 2026-10-18：「弩炮改發射火箭(有點燃效果) 不然目前威力太弱了」）：彈種序號 5，飛行與命中照弩箭（實心彈那一套、畫成一支箭），箭頭帶火 ⇒
//   第一次碰到船（模型或船殼）在那一點點火（28_fire.js fireArrowHit）。石彈（投石機；序號 6）：照實心彈飛、命中，畫成一顆灰石頭。兩種都只給固定彈種的砲。
var AMMO_FIRE = 5, AMMO_STONE = 6;
/** 判定照哪一種基本彈（弩箭、火箭、石彈 ⇒ 實心彈 0；其他照原樣）：b.ammo、彈種倍率（04_state.js ammoK）都照它。 */
function ammoBase(a) { return a === AMMO_BOLT || a === AMMO_FIRE || a === AMMO_STONE ? 0 : a; }
/** 機械的武器（弩箭、火箭、石彈）：開火沒有火光、砲煙、後座、砲聲（21_gunnery.js boltFx）。 */
function ammoQuiet(a) { return a === AMMO_BOLT || a === AMMO_FIRE || a === AMMO_STONE; }
// 彈藥量（Tim 2026-10-18：「讓武器支援單獨設定彈藥能存放幾發(目前應該是共用預設2發) 跟共用的是乘數關係(弩炮設定三倍彈藥的話 就是裝填一次可以發射六發 但不是連射)」）：
//   砲種表 box（整數倍率，沒寫 ＝ 1）⇒ 砲旁藥箱放 細節設定「藥箱」份數 × box 發；送藥手一趟的每一份也算 box 發（23_powder.js）。⛔ 不是連發：每一發照樣裝填。
function gunBoxK(type) { var k = GUNS[type] && +GUNS[type].box; return k > 1 ? Math.round(k) : 1; }
function gunBoxCap(g) { return BOX_N * gunBoxK(g.type); }
/** 這種砲打得出哪幾種彈（AMMO 的序號，照輪流的順序）：砲種表 ammo（固定彈種：希臘火、弩箭）⇒ 只有那一種；
 *  ammos（TASK-0828；Tim 2026-10-22「一些鐵甲艦是否沒有鏈彈」）⇒ 只有清單上那幾種（照砲種表寫的順序；認不得的略過）；都沒寫（大砲）⇒ 實心、爆裂、鏈彈。 */
function gunAmmoList(type) {
  var G0 = GUNS[type], a = G0 && G0.ammo;
  if (a !== undefined && AMMO_NAME[a] !== undefined) return [AMMO_NAME[a]];
  var L = G0 && Array.isArray(G0.ammos) ? G0.ammos.map(function (n) { return AMMO_NAME[n]; }).filter(function (i) { return i !== undefined; }) : [];
  return L.length ? L : [0, 1, 2];
}
/** 這艘的主武器（Tim 2026-10-18：「應該只有主武器能換彈種」）：開戰時火力（砲重 ÷ 裝填倍率，跟艦長的 helmGunW 同一把尺、不看人手）加總最大的那一種砲；沒有砲 ⇒ null。快取在 sh.mainGun。
 *  換彈鍵照它的清單輪（61_hud.js ammoOf）；主武器是固定彈種的船（持火號 ⇒ 希臘火）彈種鈕直接顯示那一種。 */
function shipMainGun(sh) {
  if (sh.mainGun !== undefined) return sh.mainGun;
  var w = {}, best = null; sh.guns.forEach(function (g) { var G0 = GUNS[g.type] || {}; w[g.type] = (w[g.type] || 0) + (+G0.mass || 1) / (+G0.reload || 1); });
  Object.keys(w).forEach(function (k) { if (best === null || w[k] > w[best]) best = k; });
  return (sh.mainGun = best);
}
/** 這門砲這一發打哪種彈：固定彈種（ammoFix）⇒ 它；這種砲打得出要的那一種 ⇒ 要的（各種口徑的大砲一起換）；不然 ⇒ 這種砲的第一種。 */
function gunAmmo(g, ammo) { if (g.ammoFix >= 0) return g.ammoFix; var L = gunAmmoList(g.type); return L.indexOf(ammo) >= 0 ? ammo : L[0]; }
function gunAmmoFix(m, type) { var a = (m.meta && m.meta.ammo) || GUNS[type].ammo; return a !== undefined && AMMO_NAME[a] !== undefined ? AMMO_NAME[a] : -1; }
/** 砲甲板：照舷側砲（不含追擊砲）的高度（外框底）分層 —— 排好之後相差 10 格以上就是另一層（甲板有舷弧，同一層前後差 6 格）；
 *  追擊砲再歸到最近的那一層（⛔ 一起排：船尾追擊砲的高度落在兩層之間，會把上下兩層砲甲板接成一層）。
 *  每層：站人的高度範圍 zr（照那一層第一門不是追擊砲的砲：carronade 那層 −6～+3、其他 −8～+5）、名字、最上面那層 ＝ 露天（陸戰隊、砲長的「甲板人員」）。
 *  憲法號：長砲 z 82–86＋追擊砲 88 ／ carronade 105–108 ⇒ 兩層，跟以前照砲種分（長砲＋追擊砲 ／ carronade）一樣；餘燼號兩層砲甲板都是長砲 ⇒ 照種類分不出來。 */
/** 砲軸（水平、單位長）與砲口（muzzle 再往外 1.5 格）：m ＝ 模型（pts、name、c、bb）。 */
function gunMuzzle(m) {                                               // ⛔ 不叫 gunAxis：21_gunnery.js 有一個 gunAxis(sh, g)（世界座標的砲軸），同名的後面那個蓋掉前面
  var mz = m.pts.muzzle, br = m.pts.breech, ax;
  if (mz && br) ax = [mz[0] - br[0], mz[1] - br[1]];
  else { var sg0 = /-P\d*$|-P$/.test(m.name) ? -1 : 1; ax = [0, sg0]; mz = [m.c[0], sg0 > 0 ? m.bb[4] - 0.5 : m.bb[1] + 0.5, m.c[2]]; }   // 沒有固定點（舊的 .vxk）⇒ 外框外緣
  var al = Math.hypot(ax[0], ax[1]) || 1; ax = [ax[0] / al, ax[1] / al];
  var mk = Object.keys(m.pts || {}).filter(function (k) { return /^muzzle-[a-z]$/.test(k); }).sort();   // 多管砲（風暴角號的三管砲：muzzle-a／b／c）⇒ 連發時輪流出彈（21_gunnery.js burstStep）
  return { ax: ax, muz: [mz[0] + ax[0] * 1.5, mz[1] + ax[1] * 1.5, mz[2]], muzs: mk.length ? mk.map(function (k) { var q = m.pts[k]; return [q[0] + ax[0] * 1.5, q[1] + ax[1] * 1.5, q[2]]; }) : null };
}
/** 砲的順序：船頭往船尾、同一個 x 先左舷（砲甲板的「主砲」＝ 每層第一門側舷砲 ⇒ 切高照它；送藥手的分對也照這個順序）。 */
function gunOrder(a, b) { return b.muz[0] - a.muz[0] || a.muz[1] - b.muz[1]; }
function gunDecks(sh) {
  if (hullDecks(sh.T).length) return gunDecksMeta(sh);                 // 有甲板 meta（35_decks.js）⇒ 照 meta 分；沒有 ⇒ 底下照砲的高度分（舊匯出的退路）
  var side = sh.guns.filter(function (g) { return fitKind0(g.model) !== 'chase'; }); if (!side.length) side = sh.guns;   // fitKind0／fitBB0：換了裝的照原本雕的那一門（38_fit.js）
  var zs = side.map(function (g) { return Math.floor(fitBB0(g.model)[2]); }).sort(function (a, b) { return a - b; }), G = [];
  zs.forEach(function (z) { var L = G[G.length - 1]; if (L && z - L.z1 <= 10) L.z1 = z; else G.push({ z0: z, z1: z }); });
  var decks = G.map(function (L, i) { return { key: 'd' + i, z0: L.z0, z1: L.z1, guns: [] }; });
  sh.guns.forEach(function (g) {
    var z = Math.floor(fitBB0(g.model)[2]), D = null, bd = 1e9;
    decks.forEach(function (d) { var dd = z < d.z0 ? d.z0 - z : z > d.z1 ? z - d.z1 : 0; if (dd < bd) { bd = dd; D = d; } });   // 在那一層的範圍裡 ⇒ 0；不在 ⇒ 最近的那一層
    g.deck = D.key; D.guns.push(g);
  });
  var low = decks.length - (decks.length > 1 ? 1 : 0);
  decks.forEach(function (D, i) {
    var main = D.guns.filter(function (g) { return fitKind0(g.model) !== 'chase'; })[0] || D.guns[0], a = Math.floor(fitBB0(main.model)[2]);
    D.zr = fitKind0(main.model) === 'carr' ? [a - 6, a + 3] : [a - 8, a + 5];
    D.weather = i === decks.length - 1;
    D.name = D.weather && decks.length > 1 ? '上甲板' : low === 1 ? '砲甲板' : low === 2 ? (i === 0 ? '下層砲甲板' : '上層砲甲板') : '第 ' + (i + 1) + ' 層砲甲板';
  });
  return decks;
}
/** 照甲板 meta 分砲甲板：每門砲照模型的關聯路徑（甲板-gun/…）找所在的那一層，路徑看不出來 ⇒ 照砲架底的高度（deckAt）；
 *  有砲的那幾層由下往上排成 d0、d1…（名字照 meta），站人的高度範圍照那一層第一門不是追擊砲的砲（同舊的算法）；最上面那層 ＝ 露天（陸戰隊、砲長的「甲板人員」）。 */
function gunDecksMeta(sh) {
  var T = sh.T, by = {}, list = [];
  sh.guns.forEach(function (g) {
    var R0 = g.model.hd && ndRoot(g.model.hd), tb = R0 && T.turrets[R0.k].box;   // 掛在砲塔上（27_turret.js）⇒ 照最外層那座砲塔的底座落在哪一層（⛔ 照砲自己的高度 ⇒ 疊在砲塔頂上的砲找不到甲板、自成一層）
    var d = deckOfPath(T, g.model.path) || (tb && deckAt(T, R0.c[0], Math.floor(tb[2]))) || deckAt(T, g.model.c[0], Math.floor(g.model.bb[2])) || hullDecks(T)[0];
    if (!by[d.i]) { by[d.i] = { meta: d, guns: [] }; list.push(by[d.i]); }
    by[d.i].guns.push(g);
  });
  list.sort(function (a, b) { return a.meta.level - b.meta.level; });
  return list.map(function (L, i) {
    var zs = L.guns.map(function (g) { return Math.floor(g.model.bb[2]); });
    var D = { key: 'd' + i, z0: Math.min.apply(null, zs), z1: Math.max.apply(null, zs), guns: L.guns, meta: L.meta, name: L.meta.name, weather: i === list.length - 1 };
    L.guns.forEach(function (g) { g.deck = D.key; });
    var nc = L.guns.filter(function (g) { return fitKind0(g.model) !== 'chase'; }), up = function (g) { var R0 = g.model.hd && ndRoot(g.model.hd); return !!R0 && g.model.bb[2] > T.turrets[R0.k].box[2] + 3; };   // 疊在砲塔頂上、比底座高的砲（27_turret.js）不拿來切這一層的高度
    var main = nc.filter(function (g) { return !up(g); })[0] || nc[0] || L.guns[0], a = Math.floor(fitBB0(main.model)[2]);
    D.zr = fitKind0(main.model) === 'carr' ? [a - 6, a + 3] : [a - 8, a + 5];
    return D;
  });
}
/** 格座標 P 附近 r 格內有沒有帆桁的網格（照佔用格）⇒ 回那根帆桁的模型編號（T.rig.models 的序號 ＝ sh.models 的序號），沒有 ⇒ -1。 */
function yardNear(T, P, r) {
  var ms = T.rig.models || [];
  for (var k = 0; k < ms.length; k++) {
    var m = ms[k], b = m.bbox; if (!m.meta || m.meta.kind !== 'yard') continue;
    if (P[0] < b[0] - r || P[0] > b[3] + r || P[1] < b[1] - r || P[1] > b[4] + r || P[2] < b[2] - r || P[2] > b[5] + r) continue;
    var oc = T.meshes[m.mesh] && T.meshes[m.mesh].occ; if (!oc) continue;
    var x0 = Math.floor(P[0] - m.origin[0]) + 1, y0 = Math.floor(P[1] - m.origin[1]) + 1, z0 = Math.floor(P[2] - m.origin[2]) + 1;
    for (var dz = -r; dz <= r; dz++) for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
      var x = x0 + dx, y = y0 + dy, z = z0 + dz;
      if (x >= 0 && y >= 0 && z >= 0 && x < oc.nx && y < oc.ny && z < oc.nz && oc.a[x + oc.nx * (y + oc.ny * z)]) return k;
    }
  }
  return -1;
}
/** 繩的兩端各跟著哪根帆桁轉（-1 ＝ 不跟）：端點靠在帆桁上（綁在帆桁上的 brace、lift、footrope，topsail 以上的 sheet…）。
 *  course 的 sheet 與 tack 兩端都不在帆桁上（帆腳綁甲板繩栓）⇒ 不轉，跟帆腳一起留著（clothTemplate 的 clewYard）。同一型的兩艘共用一份（T.ropeYard）。 */
function ropeYards(sh) {
  var T = sh.T;
  if (!T.ropeYard) T.ropeYard = T.rig.ropes.map(function (r) { var n = r.pts.length / 3; return [yardNear(T, [r.pts[0], r.pts[1], r.pts[2]], 3), yardNear(T, [r.pts[n * 3 - 3], r.pts[n * 3 - 2], r.pts[n * 3 - 1]], 3)]; });
  sh.ropes.forEach(function (r, j) { r.pts0 = r.pts; r.ya = T.ropeYard[j][0]; r.yb = T.ropeYard[j][1]; });
  sh.yRopes = sh.ropes.filter(function (r) { return r.ya >= 0 || r.yb >= 0; });
}
/** 子繩（雕刻 TASK-0511：一端寫 `rope:母繩/比例`，ratlines 的每一道）：照 .vxk 的 ends（include=ends；frame ＝ 繩所在那一層）找母繩 ⇒ sh.cRopes ＝ [{ j, e: [{ p: 母繩序號, t: 比例 }|null ×2], d: 往上掛幾層 }]，母繩先排。
 *  Tim 2026-10-17「子纜線會浮空…讓兩端真的綁在母纜線上」：母繩跟著帆桁轉（shroud 上端靠在帆桁的 sling 旁 ⇒ ropeYards 把它當成綁在帆桁上）⇒ 子繩以前留在作品的位置。
 *  沒有 ends 的舊 .vxk ⇒ 空（照以前）。 */
function childRopes(sh) {
  var R = sh.T.rig.ropes, idx = {}, out = [];
  R.forEach(function (r, j) { idx[r.name] = j; });
  R.forEach(function (r, j) {
    var E = r.ends; if (!E) return;
    var fr = r.frame || '', e = [0, 1].map(function (k) {
      var s = E[k]; if (typeof s !== 'string' || s.indexOf('rope:') !== 0) return null;
      var i = s.lastIndexOf('/'), rel = s.slice(5, i), t = +s.slice(i + 1), p = idx[fr ? fr + '/' + rel : rel];
      return p === undefined || !isFinite(t) ? null : { p: p, t: t };
    });
    if (e[0] || e[1]) out.push({ j: j, e: e, d: 0 });
  });
  var by = {}; out.forEach(function (c) { by[c.j] = c; });
  function depth(c, n) { if (n > 8) return 0; var d = 0; c.e.forEach(function (x) { if (x && by[x.p]) d = Math.max(d, depth(by[x.p], n + 1) + 1); }); return d; }
  out.forEach(function (c) { c.d = depth(c, 0); });
  sh.cRopes = out.sort(function (a, b) { return a.d - b.d; });
}
/** 子繩的兩端放回母繩現在的形狀上（沿母繩的長度比，同雕刻的 rope:母繩/比例）；中間的點照兩端之間的比例內插（子繩是拉直的）。
 *  開局、帆桁帶著繩轉（30_rig_physics.js yardRopes）、小艇擺（swingHangs）之後叫。母繩斷了 ⇒ 不動（子繩照 linkRopes 跟著斷）。
 *  只重算母繩動過的（TASK-0673：小艇一擺就整艘重綁 ⇒ 憲法號單步 20–29 ms）：c.k ＝ 上次用的 [母繩 0 的 pts, 母繩 1 的 pts, 自己的 pts]（斷了記 null）——
 *  繩的形狀一律整份換成新的陣列（沒有原地改的）⇒ 三個都是同一個物件 ＝ 算出來跟上次一樣 ⇒ 跳過；跟每次全部重算逐點相同。 */
function childBind(sh) {
  (sh.cRopes || []).forEach(function (c) {
    var r = sh.ropes[c.j]; if (!r || r.dead) return;
    var q0 = c.e[0] && sh.ropes[c.e[0].p], q1 = c.e[1] && sh.ropes[c.e[1].p], k0 = q0 && !q0.dead ? q0.pts : null, k1 = q1 && !q1.dead ? q1.pts : null;
    if (c.k && c.k[0] === k0 && c.k[1] === k1 && c.k[2] === r.pts) return;
    c.k = [k0, k1, r.pts];
    var src = r.pts0 || r.pts, n = src.length / 3; if (n < 2) return;
    var P = [0, 1].map(function (e) {
      var x = c.e[e], q = x && sh.ropes[x.p]; if (!q || q.dead) return null;
      return ropeAtT(q.pts, x.t);
    });
    if (!P[0] && !P[1]) return;
    var A = P[0] || [src[0], src[1], src[2]], B = P[1] || [src[n * 3 - 3], src[n * 3 - 2], src[n * 3 - 1]], out = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) { var t = i / (n - 1); out[i * 3] = A[0] + (B[0] - A[0]) * t; out[i * 3 + 1] = A[1] + (B[1] - A[1]) * t; out[i * 3 + 2] = A[2] + (B[2] - A[2]) * t; }
    r.pts = out; r.bb = ropeBox(out); c.k[2] = out;
  });
}
/** 折線 L（xyz 攤平）上沿長度比 t 的那一點（同雕刻 SCP_SculptRopes.PointAt）。 */
function ropeAtT(L, t) {
  var n = L.length / 3, tot = 0, i, seg = [];
  for (i = 1; i < n; i++) { var s = Math.hypot(L[i * 3] - L[i * 3 - 3], L[i * 3 + 1] - L[i * 3 - 2], L[i * 3 + 2] - L[i * 3 - 1]); seg.push(s); tot += s; }
  if (t <= 0 || tot < 1e-9) return [L[0], L[1], L[2]];
  if (t >= 1) return [L[n * 3 - 3], L[n * 3 - 2], L[n * 3 - 1]];
  var want = t * tot, acc = 0;
  for (i = 0; i < seg.length; i++) {
    if (acc + seg[i] >= want) { var f = seg[i] > 0 ? (want - acc) / seg[i] : 0; return [L[i * 3] + (L[i * 3 + 3] - L[i * 3]) * f, L[i * 3 + 1] + (L[i * 3 + 4] - L[i * 3 + 1]) * f, L[i * 3 + 2] + (L[i * 3 + 5] - L[i * 3 + 2]) * f]; }
    acc += seg[i];
  }
  return [L[n * 3 - 3], L[n * 3 - 2], L[n * 3 - 1]];
}
/** 模型的種類：meta 優先（basecamp TASK-0517：kind／gun），沒有 meta 才照名字（舊的 .vxk；舵輪本來就沒有 meta）。 */
/** 砲的血量加成（Tim 2026-10-21：「強化大口徑炮血量」「有砲塔的炮…目前太容易被打壞炮了 特別是有砲塔的船炮都不多」「40kg門檻」「砲塔裡的炮 額外疊成4倍」
 *  「血量是否可以再額外隨砲的重量(口徑)做線性增長(然後重砲改為1.5倍就好)」「讓不同的炮血量不同」「或是採用開根號處理」）：
 *  倍率 ＝ √(砲重 ÷ 24 磅長砲的 2.5 t)（下限 0.2：弓、迴旋砲這種幾公斤的不會一碰就壞）× 大口徑（砲種表 shot ≥ 40 kg）1.5 × 砲塔層 kind=turret 底下的砲 4，全部疊乘；乘在砲種表的 hpK 上。
 *  24 磅長砲 ＝ 1（跟以前一樣）；例（砲的血量 200）：4 磅 89、32 磅 215、XI 吋 Dahlgren 722（砲塔裡 2,889）、30.5 cm Krupp 砲塔裡 4,648。
 *  ⛔ 迴旋砲座（meta mount=turret｜pivot）不算砲塔：只是會轉的架子、沒有殼。 */
var GUN_HP_REF = 2.5, GUN_HP_MIN = 0.2, GUN_HP_BIG = { shot: 40, k: 1.5 }, GUN_HP_TUR = 4;
function gunHpK(T, kind, path) {
  var g = GUNS[kind]; if (!g) return 1;
  var k = Math.max(GUN_HP_MIN, Math.sqrt((+g.mass || GUN_HP_REF) / GUN_HP_REF));
  if (g.shot >= GUN_HP_BIG.shot) k *= GUN_HP_BIG.k;
  if ((T.turrets || []).some(function (t) { return path.indexOf(t.path + '/') === 0; })) k *= GUN_HP_TUR;
  return k;
}
function modelKind(m) {
  var mt = m.meta || {};
  if (mt.kind === 'gun') return GUN_WEAPON[mt.weapon] || GUN_CODE[mt.gun] || 'long';   // weapon 優先（TASK-0693）；不認得的代碼 ⇒ 當長砲
  if (META_KINDS[mt.kind] && META_KINDS[mt.kind].mk) return mt.kind;   // 規格表標 mk 的（config/meta_kinds.json，TASK-0672）：火藥桶、帆桁、舵輪、舵、門、螺旋槳 —— 以前在下面一行一行寫
  // 以前一行一行寫的那幾個（留著說明為什麼有）：
  //   wheel：餘燼號的舵輪叫「舵輪」、有 meta（⛔ 只照名字 ⇒ 認不出來，船只剩舵柄滑車的 35% 轉向）
  //   rudder：夜隼號的舵是模型（summit：方艉船掛在艉板外）；憲法號、餘燼號的舵是船殼的格子
  //   door：門、艙蓋（TASK-0638；25_doors.js）：血量砲的一半、不擋人、開關只是演出
  //   propeller：螺旋槳（TASK-0628／0630）：血量跟舵一樣（⛔ 一般模型 1 點 ⇒ 一發爆炸彈就把整艘的動力打掉）；照輸出轉（31_drive.js）
  //   wheel 照名字認（TASK-0777 拿掉：Tim 2026-10-21「請不用要rudder判斷 應該要靠meta」）：量過 19 型的舵輪都有 meta kind=wheel；照名字認反而把憲法號、炎羽號的「wheel座」（wheel_stand）、
  //     潮墓號的兩個「wheel-fairlead」（fairlead，排在舵輪前面 ⇒ 舵手站在導索器上）也當成舵輪。只在操舵的開關關掉時照舊（?helmtq=0，對拍用）。
  return /carronade/.test(m.name) ? 'carr' : /chase/.test(m.name) ? 'chase' : /\/砲-[SP]\d+$/.test(m.name) ? 'long' : /wheel/.test(m.name) && !HELM_TQ ? 'wheel' : 'model';
}
/** 模型照 x 分桶（每 16 格一桶，外框外擴 12 格登記）⇒ hitModel 只看砲彈所在那一桶（193 個模型 × 每顆砲彈每個小步全掃太貴）。
 *  桶裡照模型編號排 ⇒ 先碰到誰跟全掃一樣。 */
function modelIndex(models) {
  var idx = [];
  models.forEach(function (m) {
    var x0 = m.ibx ? m.ibx[0] : m.bb[0], x1 = m.ibx ? m.ibx[1] : m.bb[3];   // ibx：掛在砲塔上的模型照掃過的範圍分桶（27_turret.js）
    for (var bx = Math.max(0, Math.floor((x0 - 12) / 16)); bx <= Math.floor((x1 + 12) / 16); bx++) (idx[bx] = idx[bx] || []).push(m);
  });
  return idx;
}
/** 兩端附近沒有實心格的繩（ratline 掛在 shroud 上）⇒ 掛在端點旁邊那條繩上：那條斷了它也斷、那條跟著桅倒它也跟著倒。 */
/** 掛著的模型（m.hang：吊艇架上的小艇）的吊索 ＝ 一端落在它外框（外擴 0.4 m）裡、或綁在它上面的繩 ⇒ m.falls（繩的序號）；
 *  survey（32_hull.js）：吊索全斷 ⇒ 掉下去。foot 換成吊索另一端（上端）的那一格（吊艇架）⇒ 那一截被打斷帶走時跟著走（22_pieces.js）。找不到吊索 ⇒ 照舊（腳下沒東西 ⇒ 掉）。 */
function hangFalls(sh) {
  sh.models.forEach(function (m) {
    if (!m.hang) return;
    var b = m.bb; m.falls = [];
    function inBox(P) { return P[0] > b[0] - 4 && P[0] < b[3] + 4 && P[1] > b[1] - 4 && P[1] < b[4] + 4 && P[2] > b[2] - 4 && P[2] < b[5] + 4; }
    var tops = [];
    sh.ropes.forEach(function (r, j) {
      var n = r.pts.length / 3, A = [r.pts[0], r.pts[1], r.pts[2]], Bp = [r.pts[n * 3 - 3], r.pts[n * 3 - 2], r.pts[n * 3 - 1]];
      var atA = r.ma === m.k || inBox(A), atB = r.mb === m.k || inBox(Bp);
      if (atA === atB) return;                                            // 兩端都不在（別的繩）或都在（小艇自己身上的繩）
      m.falls.push(j); tops.push(atA ? Bp : A); r.pts0 = r.pts0 || r.pts;
      var top = atA ? r.b : r.a; if (top >= 0 && m.falls.length === 1) m.foot = top;
    });
    if (!m.falls.length) { m.falls = null; return; }
    // 擺（30_rig_physics.js swingHangs）：轉軸 ＝ 兩條吊索上端的連線（只有一條 ⇒ 沿船身），吊點 ＝ 第一條的上端，擺長 ＝ 中心到轉軸的距離
    var ax = tops.length > 1 ? sub(tops[1], tops[0]) : [1, 0, 0]; if (len(ax) < 1) ax = [1, 0, 0];
    var v = sub(m.c, tops[0]); ax = norm(ax); var vp = sub(v, mul(ax, dot(v, ax)));
    m.sax = ax; m.spv = tops[0]; m.sL = Math.max(len(vp), 3); m.sw = 0; m.swA = 0; m.psi = 0; m.psiV = 0; m.pw = null;
    (sh.hangs = sh.hangs || []).push(m);
  });
}
// ── 繩的檢查（Tim 2026-10-14：破壞後有浮空的纜線；?ropecheck=1 ＋ ?dump=1 記進 #dump、ropecheck.py 跑很多局寫報告）──
// 浮空 ＝ 繩還活著（沒斷、沒被帶走），可是有一端撐它的東西已經沒了：
//   格：端點附近（作品裡端點到錨的距離 d0 ＋ 1 格，至少 2 格）已經沒有實心格 —— ⛔ 只看錨那一格不夠：錨是端點 0.5 m 內最近的實心格，常常是隔壁的結構
//   模型：那個模型沒了（飛出去、被斷開的那一截帶走）；帆桁（端點在帆桁的網格上，T.ropeYard：帆桁轉、它跟著轉）：同模型；
//   繩：靠的那條繩斷了、或它自己也浮空。
/** 繩 r 的一端（e：0 ＝ 起點、1 ＝ 終點）靠什麼：{ k: 'yard'|'grid'|'model'|'rope'|'none', a（帆桁或模型序號／錨格／繩序號）, d0（端點到錨格中心，格）, P（端點）}。記在繩上。
 *  ⚠ 帆桁優先：端點在帆桁上的繩，錨（0.5 m 內最近的實心格）常常抓到桅 ⇒ 帆桁飛了、被帶走，錨還在 ⇒ 以前不斷（浮空的主因之一）。 */
function ropeEnd(r, e) {
  r.ends = r.ends || [];
  if (r.ends[e]) return r.ends[e];
  var src = r.pts0 || r.pts, n = src.length / 3, i = e ? n - 1 : 0, P = [src[i * 3], src[i * 3 + 1], src[i * 3 + 2]], an = e ? r.b : r.a, o;
  var yk = e ? r.yb : r.ya;
  if (yk >= 0) o = { k: 'yard', a: yk, P: P };
  else if (an >= 0) o = { k: 'grid', a: an, d0: Math.hypot((an & 2047) + 0.5 - P[0], ((an >> 11) & 1023) + 0.5 - P[1], (an >> 21) + 0.5 - P[2]), P: P };
  else if ((e ? r.mb : r.ma) !== undefined) o = { k: 'model', a: e ? r.mb : r.ma, P: P };
  else if ((e ? r.pb : r.pa) !== undefined) o = { k: 'rope', a: e ? r.pb : r.pa, P: P };
  else o = { k: 'none', a: -1, P: P };
  return r.ends[e] = o;
}
/** 8 格一塊（打掉的格記在哪一塊：sh.rbin）。 */
function ropeBin(x, y, z) { return (x >> 3) | ((y >> 3) << 8) | ((z >> 3) << 16); }
/** 那一端現在撐不撐得住：撐得住 ⇒ ''，撐不住 ⇒ 原因。depth：沿著繩往上追幾層（繩掛在繩上）。
 *  near（survey 用）：最近打掉的格所在的塊（含旁邊一圈）⇒ 格那一端只在端點落在裡面時才量（⛔ 每次全量：兩艘約 3 ms，八艘一格卡 12 ms）；不給 ⇒ 全量（讀數）。 */
function ropeEndWhy(sh, r, e, depth, near) {
  var E = ropeEnd(r, e), n = r.pts.length / 3, i = e ? n - 1 : 0, P = [r.pts[i * 3], r.pts[i * 3 + 1], r.pts[i * 3 + 2]];   // 端點照現在的形狀（帆桁轉了、小艇擺了）
  if (E.k === 'grid') {
    if (near !== undefined && (!near || !near.has(ropeBin(Math.floor(P[0]), Math.floor(P[1]), Math.floor(P[2]))))) return '';
    if (!hullGp(sh.grid, E.a)) return '錨格被打掉（應該已經斷）';
    var R = Math.max(2, E.d0 + 1), x0 = Math.floor(P[0]), y0 = Math.floor(P[1]), z0 = Math.floor(P[2]), Ri = Math.ceil(R), dx, dy, dz;
    for (dz = -1; dz <= 1; dz++) for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) if (sh.grid.get(x0 + dx, y0 + dy, z0 + dz)) return '';   // 先看貼著的（大多數繩端埋在格裡）
    for (dz = -Ri; dz <= Ri; dz++) for (dy = -Ri; dy <= Ri; dy++) for (dx = -Ri; dx <= Ri; dx++) {
      if (dx * dx + dy * dy + dz * dz > R * R) continue;
      if (sh.grid.get(x0 + dx, y0 + dy, z0 + dz)) return '';
    }
    return '端點周圍 ' + R.toFixed(1) + ' 格內沒有格了（錨在 ' + E.d0.toFixed(1) + ' 格外、還在）';
  }
  if (E.k === 'model' || E.k === 'yard') { var m = sh.models[E.a]; return !m ? '模型不見了' : m.moved ? '綁的模型被斷開的那一截帶走了（' + m.name + '）' : !m.alive ? '綁的模型沒了（' + m.name + '）' : ''; }
  if (E.k === 'rope') { var q = sh.ropes[E.a]; if (!q || q.dead) return '靠的繩斷了（' + (q ? q.name : E.a) + '）'; return depth > 0 && ropeFloat(sh, q, depth - 1) ? '靠的繩浮空（' + q.name + '）' : ''; }
  return '';
}
/** 繩 r 浮空嗎 ⇒ null 或 { end, why }。 */
function ropeFloat(sh, r, depth, near) {
  if (r.dead || r.moved) return null;
  for (var e = 0; e < 2; e++) { var w = ropeEndWhy(sh, r, e, depth === undefined ? 4 : depth, near); if (w) return { end: e, why: w }; }
  return null;
}
/** 這艘現在浮空的繩：[{ j, name, end, why, kind, P }]。 */
function ropesFloating(sh) {
  var out = [];
  sh.ropes.forEach(function (r, j) { var f = ropeFloat(sh, r); if (f) { var E = ropeEnd(r, f.end); out.push({ j: j, name: r.name, end: f.end, why: f.why, kind: E.k, P: E.P.map(function (v) { return Math.round(v); }) }); } });
  return out;
}
/** 作品本身（開戰那一刻、還沒打）：每一端靠什麼、端點到錨幾格；遠的（> 2 格）與哪裡都不靠的列出來 ⇒ 雕刻那邊可以把繩端拉到碰到東西。 */
function ropeAuditStatic(sh) {
  var kinds = { yard: 0, grid: 0, model: 0, rope: 0, none: 0 }, far = [], none = [];
  sh.ropes.forEach(function (r, j) {
    [0, 1].forEach(function (e) {
      var E = ropeEnd(r, e); kinds[E.k]++;
      if (E.k === 'grid' && E.d0 > 2) far.push({ name: r.name, end: e, d0: +E.d0.toFixed(1), P: E.P.map(Math.round) });
      if (E.k === 'none') none.push({ name: r.name, end: e, P: E.P.map(Math.round) });
    });
  });
  return { ropes: sh.ropes.length, ends: kinds, far: far, none: none, unfixed: sh.ropes.filter(function (r) { return r.unfixed; }).map(function (r) { return { name: r.name, d: r.unfixed.ends.map(function (e) { return e.d; }) }; }), floatAtStart: ropesFloating(sh).map(function (f) { return f.name + '#' + f.end + '：' + f.why; }) };
}
/**
 * 繩兩端綁在哪（TASK-0716；Tim 2026-10-18「遊戲端真的要猜測應該要放在匯入時（檢查、猜測並產生報表）」）：
 * 一端的決定 D ＝ { k: 'turret'｜'yard'｜'model'｜'rope'｜'none', m: 模型 id（沒有 id ⇒ 路徑）, r: 母繩的名字, s: 1 ＝ 端點在帆的頂點上, g: 1 ＝ 照外框猜的模型 }；格子（anchorNear）不在這裡。
 * 檔頭有 rig.ropes[i].bind（admin.py ropebind 匯入時寫的；0 ＝ 那一端綁格子）⇒ 照它套、不猜；沒有（舊 .vxk、還沒跑 ropebind）⇒ 照 ropeDecide 現場算（同一套）。
 */
function linkRopes(T, ropes, models) {
  var rd = ropeRideOf(T), mOf = null, rOf = null;
  function modelFind(v) {
    if (!mOf) { mOf = {}; models.forEach(function (m, k) { if (m.station || m.kind === 'furn') return; var id = m.meta && m.meta.id; if (id && !(('#' + id) in mOf)) mOf['#' + id] = k; if (!(('@' + m.path) in mOf)) mOf['@' + m.path] = k; }); }
    return ('#' + v) in mOf ? mOf['#' + v] : ('@' + v) in mOf ? mOf['@' + v] : -1;
  }
  function ropeFind(v) { if (!rOf) { rOf = {}; ropes.forEach(function (o, j) { if (!(o.name in rOf)) rOf[o.name] = j; }); } return v in rOf ? rOf[v] : -1; }
  ropes.forEach(function (r, i) {
    if (r.a >= 0 && r.b >= 0) return;
    r.par = []; r.mods = [];
    var re = T.rig.ropes[i], saved = re && re.bind, n = r.pts.length / 3, onSail = false;
    [[0, r.a, 'a'], [n - 1, r.b, 'b']].forEach(function (e, ei) {
      if (e[1] >= 0) return;
      var D = saved && saved[ei] ? saved[ei] : ropeDecide(T, ropes, models, i, e[0], rd);
      if (D.s) onSail = true;
      if (D.k === 'turret') r.tur = true;
      else if (D.k === 'yard' || D.k === 'model') { var k = modelFind(D.m); if (k >= 0) { r.mods.push(k); r['m' + e[2]] = k; if (D.g) r.guess = (r.guess || 0) + 1; } }
      else if (D.k === 'rope') { var j = ropeFind(D.r); if (j >= 0 && j !== i) { if (r.par.indexOf(j) < 0) r.par.push(j); r['p' + e[2]] = j; } }
    });
    if (!r.par.length && !r.mods.length && !onSail && !r.tur) r.dead = true;     // 哪裡都不靠（格、繩、模型、帆角、砲塔的殼都沒有）⇒ 不畫
  });
}
/** 一端（第 pi 個點）的決定（見 linkRopes）。順序：砲塔的殼 → 作品寫明的（ends）→ 帆桁（照網格）→ 母繩（≤ 3 格）→ 最後才照外框猜模型。
 *  作品寫明的：model: ⇒ 那個模型（帆桁照網格先認）；rope: ⇒ 只找繩；sail:、固定點（關聯路徑）⇒ 不猜模型（帆桁、繩照找）；座標或沒寫 ⇒ 全部照找，模型放最後。
 *  ⛔ 以前模型排在母繩前面：風暴角號的側支索下端明明接在三眼滑車的繩上，卻被旁邊砲、錨的外框搶走（砲被打掉、錨拋下去支索跟著斷）；
 *     收穫號、持火號寫明綁帆角與繫索樁的帆腳索被猜到船尾燈、槳上（TASK-0716 量的，雕刻端 sub=ropecheck 對照）。 */
function ropeDecide(T, ropes, models, i, pi, rd) {
  var r = ropes[i], re = T.rig.ropes[i], P = [r.pts[pi * 3], r.pts[pi * 3 + 1], r.pts[pi * 3 + 2]], D = { k: 'none' };
  function key(k) { var m = models[k]; return m.meta && m.meta.id ? String(m.meta.id) : m.path; }
  // 綁在帆角上（雕刻的 `sail:帆名/角`：帆腳垂在半空、只靠 sheet 拉住，例：風暴角號 spritsail）⇒ 端點就在帆的頂點上，算有靠（帆掉了它跟著斷：s.lines）
  //   ⛔ 不認 ⇒ 開局就判「哪裡都不靠」死掉、掛在它上面的帆跟著掉（TASK-0579 量到：spritsail-sheet-P／S 開局 dead、spritsail hp 滿血就掉）
  if (T.rig.sails.some(function (s) { var v = s.verts; for (var k = 0; k < v.length; k += 3) { var dx = v[k] - P[0], dy = v[k + 1] - P[1], dz = v[k + 2] - P[2]; if (dx * dx + dy * dy + dz * dz < 4) return true; } return false; })) D.s = 1;
  if (armNear(T, P, 3) >= 0) { D.k = 'turret'; return D; }                // 綁在砲塔的殼上（頂上的艙口邊、吊籃；27_turret.js ropeRideOf：跟著轉）⇒ 算有靠（⛔ 錨 anchorNear 只找船殼 ⇒ 判成綁在空中、開局就不畫）
  var ref = re && re.ends ? re.ends[pi ? 1 : 0] : null;
  var decl = typeof ref !== 'string' ? '' : ref.indexOf('model:') === 0 ? 'model' : ref.indexOf('rope:') === 0 ? 'rope' : ref.indexOf('sail:') === 0 ? 'sail' : /^-?[\d.]+,-?[\d.]+,-?[\d.]+$/.test(ref) ? '' : 'anchor';
  if (decl !== 'rope') {                                                   // 寫明掛在母繩上（橫繩組的每一道）⇒ 只找繩（⛔ 先找模型 ⇒ 哨兵號繩梯中間五道綁到旁邊的 XI 吋砲尾）
    var yk = yardNear(T, P, 3);                                            // 帆桁：照網格（⛔ 照外框：轉過的帆桁外框很大，桅頂附近的 ratline 都會被當成綁在帆桁上）
    if (yk >= 0) { D.k = 'yard'; D.m = key(yk); return D; }
    if (decl === 'model') {                                                // 作品寫明綁在哪個模型（ends model:<模型>/<固定點>；TASK-0715）⇒ 照它，不猜
      var nk = rcpModel(T.rig, re.frame, ref);
      if (nk >= 0 && models[nk] && !models[nk].station && models[nk].kind !== 'yard') { D.k = 'model'; D.m = key(nk); return D; }
    }
  }
  var best = -1, bd = 9;                                                   // 母繩：0.3 公尺內（距離² ＜ 9 格²）
  ropes.forEach(function (o, j) {
    if (j === i || P[0] < o.bb[0] - 3 || P[0] > o.bb[3] + 3 || P[1] < o.bb[1] - 3 || P[1] > o.bb[4] + 3 || P[2] < o.bb[2] - 3 || P[2] > o.bb[5] + 3) return;
    for (var k = 0; k + 5 < o.pts.length; k += 3) { var d = segDist2(P, o.pts[k], o.pts[k + 1], o.pts[k + 2], o.pts[k + 3], o.pts[k + 4], o.pts[k + 5]); if (d < bd) { bd = d; best = j; } }
  });
  if (best >= 0) { D.k = 'rope'; D.r = ropes[best].name; return D; }      // 哪一端掛在哪條繩（垂下來的繩要知道是哪一端鬆了）
  if (decl === '') {                                                       // 座標或沒寫 ⇒ 最後才照外框猜模型（匯入報表列出來；雕刻端 sub=ropecheck 可以改成寫明）
    var mk = -1;
    models.some(function (m, k) { var b = m.bb; if (m.station || m.kind === 'yard' || m.kind === 'furn') return false; if (P[0] > b[0] - 4 && P[0] < b[3] + 4 && P[1] > b[1] - 4 && P[1] < b[4] + 4 && P[2] > b[2] - 4 && P[2] < b[5] + 4) { mk = k; return true; } return false; });
    if (mk >= 0) { D.k = 'model'; D.m = key(mk); D.g = 1; return D; }    // 綁在模型上（舵索綁舵輪）⇒ 模型飛了才斷
  }
  return D;
}
/** 匯入時用（75_shipcheck.js ⇒ admin.py ropebind 寫進檔頭）：每條繩兩端現場算的決定（不看檔頭已有的 bind）；兩端都綁格子 ⇒ null，綁格子的那一端 ⇒ 0。 */
function ropeBindsFresh(sh) {
  var rd = ropeRideOf(sh.T);
  return sh.ropes.map(function (r, i) {
    if (r.a >= 0 && r.b >= 0) return null;
    var n = r.pts.length / 3;
    return [r.a >= 0 ? 0 : ropeDecide(sh.T, sh.ropes, sh.models, i, 0, rd), r.b >= 0 ? 0 : ropeDecide(sh.T, sh.ropes, sh.models, i, n - 1, rd)];
  });
}
// ── 繩的固定檢查（Tim 2026-10-16：「是否能確保纜繩至少要有一端固定到帆或其他固定點(不能綁定在空中)」「不符合的直接再生成時排除 且匯入時要有錯誤報告」）──
// 一條繩至少要有一端「固定」：端點 ROPE_FIX_D 格內貼著實心格（到格的表面）、在帆角上、在帆桁上、碰到模型的外框，或掛在一條合格的繩上（一路傳到不再變）。
// 兩端都不固定 ⇒ 開局就不生成（r.dead、r.unfixed），別的繩、帆不再靠它（不連帶斷）；匯入檢查（75_shipcheck.js）每條報 ✗。只有一端固定 ⇒ 照舊（另一端垂著）。
// ⛔ 不看 linkRopes 的錨：它往外找 0.5 m 內最近的格，兩端都找得到就不再看帆角、模型、繩 ⇒ 離木頭 0.4 m 的端點也算綁好了。
var ROPE_FIX_D = 1.5;                                                   // 格（0.15 m）
/** 端點 P 不看別的繩靠什麼：{ k: 'grid'|'sail'|'yard'|'model'|null, d：到最近實心格表面幾格（附近沒有 ⇒ null）}。 */
function ropeEndSupport(T, models, P) {
  var R = Math.ceil(ROPE_FIX_D) + 1, bx = Math.floor(P[0]), by = Math.floor(P[1]), bz = Math.floor(P[2]), best = 1e9;
  for (var dz = -R; dz <= R; dz++) for (var dy = -R; dy <= R; dy++) for (var dx = -R; dx <= R; dx++) {
    var x = bx + dx, y = by + dy, z = bz + dz; if (!T.hullG.get(x, y, z)) continue;
    var ex = Math.max(x - P[0], 0, P[0] - x - 1), ey = Math.max(y - P[1], 0, P[1] - y - 1), ez = Math.max(z - P[2], 0, P[2] - z - 1);   // 到這一格（單位方塊）表面
    best = Math.min(best, Math.sqrt(ex * ex + ey * ey + ez * ez));
  }
  var d = best < 1e9 ? +best.toFixed(2) : null;
  if (best <= ROPE_FIX_D) return { k: 'grid', d: d };
  if (armNear(T, P, R) >= 0) return { k: 'turret', d: d };            // 砲塔的殼（會轉的；24_armor.js armNear）
  if (T.rig.sails.some(function (s) { var v = s.verts; for (var k = 0; k < v.length; k += 3) { var a = v[k] - P[0], b = v[k + 1] - P[1], c = v[k + 2] - P[2]; if (a * a + b * b + c * c < 4) return true; } return false; })) return { k: 'sail', d: d };   // 帆角（同 linkRopes）
  if (yardNear(T, P, 3) >= 0) return { k: 'yard', d: d };
  if (models.some(function (m) { var b = m.bb; return !m.station && m.kind !== 'yard' && P[0] > b[0] - 2 && P[0] < b[3] + 2 && P[1] > b[1] - 2 && P[1] < b[4] + 2 && P[2] > b[2] - 2 && P[2] < b[5] + 2; })) return { k: 'model', d: d };
  return { k: null, d: d };
}
/** 船型 T 每條繩合不合格（同一型只算一次，T.ropeFix）：合格 ⇒ null；不合格 ⇒ { ends: [{ d }, { d }] }（兩端到最近實心格表面幾格）。 */
function ropeFixCheck(T, ropes, models) {
  if (!(T.ropeFix && T.ropeFix.length === ropes.length)) stepsRun(ropeFixSteps(T, ropes, models));
  return T.ropeFix;
}
/** ropeFixCheck 拆成步驟（2026-10-20；同一型第一次約 0.1 s ⇒ 70_flow.js startStaged 開局分段做）：每 ROPE_FIX_N 條繩一步算兩端靠什麼、一步算兩端附近有哪幾條繩，最後一路傳、存進 T.ropeFix。
 *  已經有了 ⇒ []。照順序做 ＝ 拆之前的 ropeFixCheck。 */
var ROPE_FIX_N = 128;
function ropeFixSteps(T, ropes, models) {
  if (T.ropeFix && T.ropeFix.length === ropes.length) return [];
  var S = [], near = [], out = [], n = ropes.length, a;
  for (a = 0; a < n; a += ROPE_FIX_N) out.push(function (a0) { return function () {
    for (var i = a0; i < Math.min(n, a0 + ROPE_FIX_N); i++) { var r = ropes[i], m = r.pts.length / 3; S.push([0, m - 1].map(function (q) { return ropeEndSupport(T, models, [r.pts[q * 3], r.pts[q * 3 + 1], r.pts[q * 3 + 2]]); })); }
  }; }(a));
  for (a = 0; a < n; a += ROPE_FIX_N) out.push(function (a0) { return function () { for (var i = a0; i < Math.min(n, a0 + ROPE_FIX_N); i++) near.push(ropeNearEnds(ropes, i)); }; }(a));
  out.push(function () {
    var ok = S.map(function (s) { return !!(s[0].k || s[1].k); });
    for (var changed = true; changed;) {                                 // 掛在合格的繩上 ⇒ 也合格（一路傳）
      changed = false;
      ok.forEach(function (v, i) { if (!v && near[i].some(function (L) { return L.some(function (j) { return ok[j]; }); })) { ok[i] = true; changed = true; } });
    }
    T.ropeFix = ok.map(function (v, i) { return v ? null : { ends: S[i].map(function (s) { return { d: s.d }; }) }; });
  });
  return out;
}
/** 第 i 條繩每一端 0.3 m 內（同 linkRopes）有哪幾條繩 ⇒ [[頭那一端的], [尾那一端的]]。 */
function ropeNearEnds(ropes, i) {
  var r = ropes[i], n = r.pts.length / 3;
  return [0, n - 1].map(function (q) {
    var P = [r.pts[q * 3], r.pts[q * 3 + 1], r.pts[q * 3 + 2]], L = [];
    ropes.forEach(function (o, j) {
      if (j === i || P[0] < o.bb[0] - 3 || P[0] > o.bb[3] + 3 || P[1] < o.bb[1] - 3 || P[1] > o.bb[4] + 3 || P[2] < o.bb[2] - 3 || P[2] > o.bb[5] + 3) return;
      for (var k = 0; k + 5 < o.pts.length; k += 3) if (segDist2(P, o.pts[k], o.pts[k + 1], o.pts[k + 2], o.pts[k + 3], o.pts[k + 4], o.pts[k + 5]) < 9) { L.push(j); return; }
    });
    return L;
  });
}
/** 開一艘船（makeShip，linkRopes 之後）：不合格的繩不生成；別的繩對它的依靠拿掉（⛔ 留著 ⇒ 第一次 survey「靠的繩斷了」連帶斷）。 */
function ropeFixApply(sh) {
  var RF = ropeFixCheck(sh.T, sh.ropes, sh.models), bad = {};
  sh.ropes.forEach(function (r, i) { if (RF[i]) { r.dead = true; r.unfixed = RF[i]; bad[i] = 1; } });
  sh.ropes.forEach(function (r) {
    if (r.dead || !r.par) return;
    r.par = r.par.filter(function (j) { return !bad[j]; });
    if (bad[r.pa]) delete r.pa; if (bad[r.pb]) delete r.pb;
  });
}
/** 帆的依靠：最高那一排、最低的前角與後角各找 0.6 公尺內的實心格；找不到就掛在 0.4 公尺內最近的繩（支索）上。 */
function sailAnchors(sh, sail, top) {
  var v = sail.verts, lo = 1e9, fx = null, bx = null, j;
  for (j = 2; j < v.length; j += 3) lo = Math.min(lo, v[j]);
  for (j = 0; j < v.length; j += 3) if (v[j + 2] < lo + 3) { if (!fx || v[j] > fx[0]) fx = [v[j], v[j + 1], v[j + 2]]; if (!bx || v[j] < bx[0]) bx = [v[j], v[j + 1], v[j + 2]]; }
  sail.as = []; sail.par = [];
  [top, fx, bx].forEach(function (P) {
    if (!P) return;
    var a = anchorNear(sh.T, P[0], P[1], P[2], 6);
    if (a >= 0) { if (sail.as.indexOf(a) < 0) sail.as.push(a); return; }
    var best = -1, bd = 16;
    sh.ropes.forEach(function (o, i) {
      if (o.unfixed) return;                                             // 綁在空中、沒生成的繩（ropeFixApply）不能當依靠
      var bb = o.bb; if (P[0] < bb[0] - 4 || P[0] > bb[3] + 4 || P[1] < bb[1] - 4 || P[1] > bb[4] + 4 || P[2] < bb[2] - 4 || P[2] > bb[5] + 4) return;
      for (var k = 0; k + 5 < o.pts.length; k += 3) { var d = segDist2(P, o.pts[k], o.pts[k + 1], o.pts[k + 2], o.pts[k + 3], o.pts[k + 4], o.pts[k + 5]); if (d < bd) { bd = d; best = i; } }
    });
    if (best >= 0 && sail.par.indexOf(best) < 0) sail.par.push(best);
  });
  sail.a = sail.as.length ? sail.as[0] : -1;
  return sail;
}
/** 這條繩（r：{ name, meta }）是不是這面帆自己的（帆腳的 sheet、tack）。
 *  照 meta（TASK-0539，造船規格 §9.1；Tim 2026-10-13「之後依 meta 判斷」）：繩的 meta 有 `sail` ⇒ 就是那面帆的（kind sheet／tack）。
 *  沒有 meta 的舊匯出才照名字：`<帆名>.xxx`（basecamp：憲法號、餘燼號）或 `<帆名>-sheet…`／`<帆名>-tack…`（summit：夜隼號）。
 *  ⛔ 只認 `<帆名>-` ⇒ `fore-topsail-lift-S`、`-brace-`、`-footrope-` 這些帆桁的繩也算進來。量過：新規則在憲法號、餘燼號一條都沒多認到。 */
function sailRope(r, sail) {
  if (r && r.meta && r.meta.sail) return r.meta.sail === sail;
  return sailRopeName(r && r.name, sail);
}
function sailRopeName(name, sail) { if (!name) return false; if (name.indexOf(sail + '.') === 0) return true; if (name.indexOf(sail + '-') !== 0) return false; var r = name.slice(sail.length + 1); return /^(sheet|tack)(-|$)/.test(r); }
function ropeBox(p) {
  var b = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
  for (var j = 0; j < p.length; j += 3) for (var a = 0; a < 3; a++) { if (p[j + a] < b[a]) b[a] = p[j + a]; if (p[j + a] > b[a + 3]) b[a + 3] = p[j + a]; }
  return b;
}
function anchorNear(T, x, y, z, r) {                 // 船型 T 的原始格子裡，(x, y, z) 附近 r 格內最近的實心格（船殼 T.hullG：錨照 sh.grid 查還在不在 ⇒ 不錨在會轉的裝甲上，24_armor.js）
  var bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z), best = -1, bd = 1e9;
  for (var dz = -r; dz <= r; dz++) for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
    if (!T.hullG.get(bx + dx, by + dy, bz + dz)) continue;
    var d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = VK.pack(bx + dx, by + dy, bz + dz); }
  }
  return best;
}
/** 桅（Tim 2026-10-13：照 meta 判斷）：帆桁的 meta `mast`（fore／main／mizzen；bowsprit 不算）⇒ 有哪幾根桅；
 *  那根桅最低的橫帆桁（course／crossjack；沒有 ⇒ 最低一根不是 boom 的）轉軸 (x, z) ⇒ 桅在哪、桅頂平台大約多高（桅頂就在它上面）。
 *  桅身那一段（打斷就倒，32_hull.js survey）＝ 那根帆桁往下 20–40 格（桅頂下面的下桅）；x ＝ 往下 10–40 格、中線上格子最多的那一欄（桅會往後傾）。
 *  z0top ＝ 桅頂水手從這個高度往上找平台（40_crew.js）。
 *  ⛔ 以前從帆的名字推 x、在固定的 z 250–290 找、打斷段三根都是 z 220–240：夜隼號只有一半高 ⇒ 前桅找在 x 223（找到的是別的東西）；
 *  憲法號的後桅頂在 241，250–290 量到的是上桅。改照 meta 之後憲法號、餘燼號的前桅與主桅 x 不變、後桅 195 → 198（下桅）；打斷段變成每根桅自己的高度。
 *  沒有帆桁 meta 的舊 .vxk ⇒ 照以前的辦法（findMastsOld）。 */
function findMasts(T) {
  var CY = T.cy, ys = {}, label = { fore: '前桅', main: '主桅', mizzen: '後桅' }; T.masts = [];
  (T.rig.models || []).forEach(function (m) { var mt = m.meta || {}, pv = (m.points || {}).pivot; if (mt.kind === 'yard' && mt.mast && mt.mast !== 'bowsprit' && pv) (ys[mt.mast] = ys[mt.mast] || []).push({ y: mt.yard, p: pv }); });
  var keys = Object.keys(ys); if (!keys.length) return findMastsOld(T);
  keys.sort(function (a, b) { var o = ['fore', 'main', 'mizzen']; return (o.indexOf(a) + 1 || 9) - (o.indexOf(b) + 1 || 9); });   // 照以前的順序（前、主、後）
  keys.forEach(function (k) {
    var L = ys[k].filter(function (q) { return q.y === 'course' || q.y === 'crossjack'; });
    if (!L.length) L = ys[k].filter(function (q) { return q.y !== 'boom'; }).sort(function (a, b) { return a.p[2] - b.p[2]; });
    if (!L.length) return;
    var P = L[0].p, Lz = Math.floor(P[2]), ax = Math.round(P[0]), mx = ax, bn = 0;
    for (var x = ax - 45; x <= ax + 45; x++) { var c = countBox(T.base, x, CY - 4, Lz - 40, x, CY + 4, Lz - 10); if (c > bn) { bn = c; mx = x; } }
    var z0 = Lz - 40, n = countBox(T.hullG, mx - 8, CY - 8, z0, mx + 8, CY + 8, z0 + 20);   // orig 跟 survey 的 sh.grid 比 ⇒ 照船殼數（24_armor.js）
    if (n > 20) T.masts.push({ name: label[k] || k, x: mx, z0: z0, z1: z0 + 20, orig: n, z0top: Lz });
  });
}
function findMastsOld(T) {  // 桅的 x 從帆的名字推（fore／main／mizzen），探針：桅身中段一小塊
  var acc = {}, CY = T.cy; T.masts = [];
  T.rig.sails.forEach(function (s) {
    var mm = /^(fore|main|mizzen)-(course|topsail|topgallant|royal)$/.exec(s.name); if (!mm) return; var k = mm[1];
    acc[k] = acc[k] || [0, 0];
    for (var j = 0; j < s.verts.length; j += 3) { acc[k][0] += s.verts[j]; acc[k][1]++; }
  });
  var label = { fore: '前桅', main: '主桅', mizzen: '後桅' };
  ['fore', 'main', 'mizzen'].forEach(function (k) {
    if (!acc[k]) return;
    var ax = Math.round(acc[k][0] / acc[k][1]), mx = ax, bn = 0, best = null;
    for (var x = ax - 45; x <= ax + 45; x++) { var c = countBox(T.base, x, CY - 4, 250, x, CY + 4, 290); if (c > bn) { bn = c; mx = x; } }   // 桅身：中線上一根直立的柱子
    for (var z0 = 220; z0 <= 420 && !best; z0 += 20) { var n = countBox(T.hullG, mx - 8, CY - 8, z0, mx + 8, CY + 8, z0 + 20); if (n > 20) best = { z0: z0, n: n }; }
    if (best) T.masts.push({ name: label[k], x: mx, z0: best.z0, z1: best.z0 + 20, orig: best.n });
  });
}
function countBox(g, x0, y0, z0, x1, y1, z1) { var n = 0; for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) for (var z = z0; z <= z1; z++) if (g.get(x, y, z)) n++; return n; }

