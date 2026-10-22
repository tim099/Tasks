// ───────────────────────── 主迴圈 ─────────────────────────
var loopLast = 0, loopAcc = 0, FPS = 60, fpsT = 0;
function frame(ts, noRaf) {                                         // noRaf：__game.live 同步呼叫（不再排下一格，⛔ 排了 ⇒ 兩條畫面迴圈、模擬走兩倍快）
  if (LAB_FLEET) { flabFrame(ts); if (!noRaf) requestAnimationFrame(frame); return; }   // 擬真沙盒：模擬自己排（84_fleetlab.js），這裡只畫（俯視圖；看實景時才畫 3D）
  var f0 = PF ? performance.now() : 0;                                // 逐幀分段計時（?debug=1）
  if (BED) { BED_BG = BED_PUMP_MS; var pb0 = performance.now(); bedPump(bedT1()); bedSpent(pb0); townRegrade(); treePump(); }   // 收進來的海圖塊、規劃晚到要重新整地的塊、擺樹：每格照同一份背景預算做（08_seabed.js、63_towns.js、63_trees.js）—— 模擬這一格要不要等（bedWait）照放好的算
  if (FLOW_STAGE) { loopLast = ts; if (!noRaf) requestAnimationFrame(frame); return; }   // 開戰分段做到一半（70_flow.js startStaged）：只收塊、擺樹，不畫、不走 ⇒ 不會碰到做到一半的船
  var dt = loopLast ? Math.min(0.1, (ts - loopLast) / 1000) : DT_BASE, hv = 0, hsv = 0; loopLast = ts;   // hv：帆與繩照畫面格算時這一格走幾秒（TASK-0799）
  FPS = FPS * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
  if (RUNNING && !PAUSED) {
    var sk = Math.min(slowTick(dt), pslowTick(dt)) * SIM_SPEED; SLOW_VIS = sk < 1;   // × SIM_SPEED：設定的模擬速度（< 1 ⇒ 碎木、煙、水花照慢動作那一套照畫面的時間走，不會一頓一頓）
      // 殉爆的慢動作、物理減速（73_slowmo.js）：模擬一步照舊 DT，只是每格累積的時間 × 倍率（取比較慢的）
    loopAcc += dt * sk; var n = 0, st0 = performance.now();
    var nMax = SIM_SPEED > 1 ? Math.ceil(4 * SIM_SPEED) : 4;            // 一格畫面最多走幾步：快轉（> 1 倍）照倍率放寬，不然 60 FPS 時最多 4 倍
    if (BED) bedFocusAuto();                                            // 海圖（08_seabed.js）：焦點走進別塊 ⇒ 換中心重載
    VIS_FRAME = PHYS;                                                   // 布照畫面格算（30_rig_physics.js physFrame；TASK-0799，交戰也是：Tim 2026-10-22）—— 這一格開頭判一次，整格同一種算法
    while (n < nMax && loopAcc >= (DT = sailDt())) { if (bedWait() || camTransHeld()) { loopAcc = 0; break; } VIEW_HOLD = loopAcc >= 2 * DT && n + 1 < nMax; simStep(); loopAcc -= DT; n++; }   // 船旁邊的海圖塊還沒載好 ⇒ 這一格先不走（戰局跟載入快慢無關）；VIEW_HOLD：後面還有步 ⇒ 只給人看的留到最後一步一次推（50_sim.js）；sailDt：每一步之前挑這一步多長（航行快轉 ⇒ 粗步長，TASK-0800）
    VIEW_HOLD = false;
    if (n) pslowMeasure((performance.now() - st0) / n);                // 一步平均幾毫秒（物理減速照它算）
    if (n === nMax) loopAcc = 0;
    if (VIS_FRAME) { hv = Math.min(dt * Math.min(sk, 1), RIG_FAR_HC); hsv = n * DT; }   // 布走畫面的時間（快轉 ⇒ 照 ×1 飄、花費照格；慢動作照慢）；hsv：這一格模擬走了多久（落海的布片照它退）
    if (SLOW_VIS) { if (PF) PF.t = performance.now(); slowVisStep(dt * sk); if (PF) pfLap('slowvis'); }
    SLOW_VIS = false;                                                 // 快轉（__game.run）不經過這裡 ⇒ 照常在 step() 走
    doorsAnim(dt * sk);                                               // 門的開關（25_doors.js）：只改畫面 ⇒ 在畫面這一格算、照模擬的速度走（慢動作跟著慢）
    portsAnim();                                                      // 砲門（TASK-0719，62_ports.js）：只改畫面；自己照 SIMT 走（慢動作、模擬速度跟著）；沒有蓋板的砲演後座（recoilShip）；畫質「砲門的開關演出」關 ⇒ 一次判斷就回
  }
  if (PF) PF.t = performance.now();
  if (hv > 0) { physFrame(hv, hsv); if (PF) pfLap('phys'); }
  VIS_FRAME = false;                                                  // frame 以外（?demo、__game.run）一律整段在模擬步裡算
  camFollow(dt);                                                      // 追砲彈（03_camera.js）
  if (!PAUSED && !STILL) stepRain(dt);                                // 3D 雨滴（14_rain.js）：照畫面的時間走；停格、縮圖不動
  ambFrame();                                                         // 環境音：風、浪、暴風雨的雨（02_ambient.js；還沒有聲音 ⇒ 什麼都不做）
  bgmFrame();                                                         // 背景音樂（02_music.js，TASK-0677）：主選單也放
  if (PF) pfLap('rain');
  remesh(RM_BUDGET);                                                  // 重網格化，每格有預算（60_render.js）
  if (PF) pfLap('flush');
  renderLerp(true, RUNNING ? loopAcc / DT : 1);                           // 畫面內插（03_camera.js）：鏡頭、畫、HUD 用兩步之間的位置，畫完換回模擬的
  ctrlFrame(dt);                                                                  // 控制器（71_ctrl.js）：第一人稱走、爬、退出判斷（81_fps.js）、建造的準心（82_build.js）；沒開 ⇒ 什麼都不做
  camUpdate(dt); render(); if (PF) pfLap('render'); hudFrame(dt); frzShow(); slowShow();
  renderLerp(false);                        // 停格條（72_floodui.js）
  if (PF) { pfLap('hud'); pfEnd(f0, RUNNING && !PAUSED ? n : 0); }
  if (GFX_FPS && (fpsT -= dt) <= 0) { fpsT = 0.5; $('fps').textContent = 'FPS ' + Math.round(FPS) + '　畫質 ' + GFX_NAME[gfxLevel()] + '　' + CAM.w + '×' + CAM.h + (RT && RT.s ? '　MSAA ' + RT.s + '×' : ''); }   // 畫質設定頁的「顯示 FPS」
  if (!noRaf) requestAnimationFrame(frame);
}

// ───────────────────────── 載入 ─────────────────────────
if (DEBUG) window.__game = {
  start: function (mode, dist) { flowMode(mode || 'pve'); DIST = dist || DIST; start(); },
  fleet: function (spec, mode) {   // 多船（TASK-0537）：spec ＝ [{ team: 'blue'|'red', hull: 'constitution'|… }]，第一艘是我艦；船型要先載好（loadHull）；null ⇒ 回到兩艘
    FLEET_DBG = spec; flowMode(mode || 'eve'); start();
    return SHIPS.map(function (s) { return { i: s.i, team: s.team, hull: s.T.key || s.T.id, px: s.px, pz: s.pz, foe: s.foe ? s.foe.i : null }; });
  },
  loadHull: function (id) { return loadHull(id).then(function (T) { return T.id; }); },
  core: { api: CORE_API, out: coreOut, preFrom: corePreFrom, add: coreAdd, pre: function (P) { CORE_PRE = P || null; return !!CORE_PRE; } },   // 海戰核心 API（TASK-0709，57_core.js；src/CORE_API.md）：pre 設下一場開局的戰前狀態（start／fleet 之後生效）
  foes: function () { return SHIPS.map(function (s) { return { i: s.i, team: s.team, foe: s.foe ? s.foe.i : null, aimOn: s.aimOn ? s.aimOn.i : null, ff: s.ff || 0, ffOut: s.ffOut || 0, ffHold: s.ffHold || 0, avoid: s.avoidN || 0, clear: s.clearN || 0, salvo: s.salvo, salvo2: s.salvo2 || 0, hits: s.hits, sunk: s.sunk, struck: s.struck, x: +s.px.toFixed(1), z: +s.pz.toFixed(1) }; }); },
  mask: function (k) { MASK_OFF = k === undefined ? -1 : k; render(); return MASK_OFF; },   // 船艙遮罩（60_render.js）：關掉第 k 艘的、畫一格
  /** 指揮官（TASK-0551）：cmd('line', 'pair') ⇒ 換兩方的策略（下一次開戰／下一次想生效）；orders() ⇒ 每艘現在的命令與目標。 */
  cmd: function (b, r) { if (CMD_NAMES[b]) CMD_SIDE.blue = b; if (CMD_NAMES[r]) CMD_SIDE.red = r; return CMD_SIDE; },
  /** TASK-0679：搶上風開關 gauge(我方, 敵方)（true／false，沒給 ＝ 不改）；旗號 signal(id)（52_fleet.js SIG_LIST 的 id；沒給 ⇒ 只讀）；指揮官的記憶 cmdMem()（搶上風的進度 gauge、戰列的順序 line、隊形誤差 lineErr）。 */
  gauge: function (b, r) { if (b !== undefined && b !== null) CMD_GAUGE.blue = !!b; if (r !== undefined && r !== null) CMD_GAUGE.red = !!r; return CMD_GAUGE; },
  signal: function (id) { if (id) sigSet(id); return { sig: SIGNAL, text: sigText(), can: sigCan() }; },
  cmdMem: function () { return JSON.parse(JSON.stringify(CMD_MEM)); },
  orders: function () { return SHIPS.map(function (s) { var o = ORDERS[s.i]; return { i: s.i, team: s.team, out: isOut(s), order: o ? o.mode + '→' + o.target + (o.leader !== undefined ? ' 跟' + o.leader : '') : null, foe: s.foe ? s.foe.i : null, station: s.station ? [Math.round(s.station[0]), Math.round(s.station[1])] : null, x: Math.round(s.px), z: Math.round(s.pz), yaw: +s.yaw.toFixed(2) }; }); },
  gpu: function () { render(); function ix(L) { return L.map(function (s) { return s.i; }); } return { max: MAX_SHIPS, masks: GFX.masks, mask: ix(MSLOTS), noMask: ix(MSLOTS.rest), layers: SHM.layers, shadowN: SHM.n, hullLayers: HULLA.key, err: gl.getError() }; },   // GPU 的格（60_render.js gpuSlots：船艙遮罩）
  shadow: function () { render(); return SHM ? { on: SHM.on, n: SHM.n, k: SHM.k, land: SHM.stOn, splits: SHM.splits.map(function (v) { return +v.toFixed(1); }), cs: SHM.cs.map(function (c) { return { r: c.r, C: c.C.map(function (v) { return +v.toFixed(1); }), off: +c.off.toFixed(3), t: +c.t.toFixed(2) }; }), ms: SHM.stat.ms, redraws: SHM.stat.redraws, last: SHM.stat.last } : null; },   // 陰影（60_render.js shadowPass）：幾段、每段的遠端、範圍、這一格畫陰影花幾毫秒、靜態那一層重畫過幾次與上一次
  cut: function (o) { if (o) for (var k in o) CUTV[k] = o[k]; render(); return CUTV; },     // 剖面與隱藏甲板（74_cutaway.js）：{ half, deck }
  menuFleet: function (F) { if (F) { FLEET_SET = fleetTrim(F.map(function (L) { return L.slice(); })); fleetUI(); pickShip(); } return { set: FLEET_SET, spec: fleetSpec(), html: [$('fleet0').innerHTML.length, $('fleet1').innerHTML.length] }; },
  prefs: function (p) { if (p) prefsApply(p); return prefsSnap(); },   // 存檔：套進去（有給）⇒ 現在跟預設不一樣的那幾項（69_prefs.js；?prefs=0 時不碰瀏覽器的存檔）
  ev: function (t, off) { if (off) return evOff(t); var o = {}; for (var k in EV_SUB) if (!t || k === t) o[k] = EV_SUB[k].length; return o; },   // 事件（00_events.js）：每個事件幾個訂閱；off ⇒ 拿掉事件 t 的訂閱（反向對照：拿掉 note ⇒ 照打、沒有廣播）
  /** 砲門（TASK-0719；62_ports.js）：ports(i) ⇒ 第 i 艘每片蓋板的 s（0 關、1 開／砲縮著、2 砲推出去）、want、gone、house…；portsForce(i, 0｜1｜null) ⇒ 寫 sh.portWant（截圖、宣傳片用；null ⇒ 照規則）。 */
  ports: function (i) { var sh = SHIPS[i || 0]; if (sh && sh.ports === undefined && GFX.port) sh.ports = portsBuild(sh); return portsDbg(sh); },
  portsForce: function (i, v) { var sh = SHIPS[i || 0]; if (sh) sh.portWant = v === undefined ? null : v; return this.ports(i); },
  /** 畫面迴圈的反向對照（TASK-0719；⛔ ?demo、run() 不經過 frame() ⇒ 量不到畫面那一格的演出）：同步叫 n 次 frame()，每格 dt ＝ DT（loopLast 歸零）⇒ 沒有慢動作時每格剛好一步；
   *  回走了幾步、模擬秒、戰局雜湊（每艘的位置、航向、格數、下沉、命中、開火、死傷、砲剩幾門，加上砲彈、碎塊數與戰局亂數 RNG_B 的狀態；照宣傳片 director.js trHash 的 FNV-1a）。g_port＝0／1、g_deco＝0／1 要一樣。 */
  simFar: function () { return SHIPS.map(function (s) { return { i: s.i, m: s.simM || 1, rig: s.rigM || 1, crewN: s.crewN || 0 }; }); },   // 遠方與視線外降級（TASK-0802）：船員幾步走一次、帆布幾步、船員走過幾次
  chartSail: function (id) { return spkChart(id || SHIPS[PLAYER_I].T.id, SHIP_CARDS[id || SHIPS[PLAYER_I].T.id]); },   // Blocksail 海圖模式算航速的那幾個數（72_shippick.js spkChart；TASK-0803）
  wind: function (rot, s0) { if (rot !== undefined && rot !== null) { WIND_ROT = rot * Math.PI / 180; SEA_A = WIND_ROT; } if (s0 !== undefined && s0 !== null) WIND_S0 = clamp(s0, 0.3, 3); stepWind(SIMT); return { rot: +(WIND_ROT * 180 / Math.PI).toFixed(2), s0: WIND_S0, spd: +WIND_SPD.toFixed(3), knots: +windKnots().toFixed(2), to: WIND.slice() }; },   // 換風（08_weather.js；跟 ?wdir=／?wspd= 同一套，戰鬥中換；Blocksail 海圖模式量帆速曲線用，TASK-0803）
  speed: function (x) { if (x !== undefined) simSpeedSet(x); return SIM_SPEED; },   // 模擬速度（73_slowmo.js；上限照 SIM_SPEED_MAX，?simmax= 放寬）
  tick: function (n) {
    var s0 = SIM_N, t0 = performance.now(); loopAcc = 0;
    for (var i = 0; i < (n || 1); i++) { loopLast = 0; frame(performance.now(), true); }
    var s = 'r' + RNG_B.s + 'b' + BALLS.length + 'p' + PIECES.length;
    SHIPS.forEach(function (sh) { s += '|' + sh.px.toFixed(4) + ',' + sh.pz.toFixed(4) + ',' + sh.yaw.toFixed(5) + ',' + sh.grid.count + ',' + (sh.sink || 0).toFixed(4) + ',' + (sh.hits || 0) + ',' + (sh.fired || 0) + ',' + (sh.dead || 0) + ',' + sh.guns.filter(function (g) { return g.alive; }).length; });
    var h = 2166136261; for (var k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); }
    return { frames: n || 1, steps: SIM_N - s0, simt: +SIMT.toFixed(3), ms: Math.round(performance.now() - t0), hash: (h >>> 0).toString(16) };
  },
  run: function (sec) { DT = DT_BASE; var n = Math.round(sec / DT), H5 = everySteps(0.5); for (var i = 0; i < n; i++) { simStep(); if (i % H5 === H5 - 1) remesh(Infinity); } remesh(Infinity); camUpdate(1); render(); hudFrame(1); PF.cur = {}; return this.stats(); },   // PF.cur：快轉的不算進下一格畫面
  fire: function (ammo, aim) { var me = SHIPS[PLAYER_I]; if (aim) setAim(me, aim); return broadside(me, ammo || 0); },
  take: function (i) { return playerTakeShip(SHIPS[i]); },
  drive: function (i, o) { var sh = SHIPS[i || 0]; if (o && 'tele' in o) teleSet(sh, o.tele); if (o && 'power' in o) sh.power = o.power; return driveInfo(sh); },   // 動力（31_drive.js）：每個動力源的完好度、推力、力矩；{ tele: 格 } 撥俥鐘          // 改操控第 i 艘（52_fleet.js；敵艦要 Debug 模式）
  one: function (ammo, aim) { var me = SHIPS[PLAYER_I]; if (aim) setAim(me, aim); fireOne(me, ammo || 0); return BALLS.length; },
  /** 點一下瞄準（71_input.js pick）：給螢幕座標；或給 [i, x, y, z]（第 i 艘的格座標）⇒ 先照現在的鏡頭投影到螢幕再點。回傳點的位置、瞄準點（格座標）與點到哪艘。 */
  pick: function (cx, cy) {
    if (Array.isArray(cx)) { var o = SHIPS[cx[0]], w = M4.pt(o.M, cx[1], cx[2], cx[3]), r = cv.getBoundingClientRect(), q = CAM.vp, cw = q[3] * w[0] + q[7] * w[1] + q[11] * w[2] + q[15], c = M4.pt(q, w[0], w[1], w[2]); cx = r.left + (c[0] / cw + 1) / 2 * r.width; cy = r.top + (1 - c[1] / cw) / 2 * r.height; }
    inPick(cx, cy); var me = SHIPS[PLAYER_I]; return { cx: cx, cy: cy, aim: me.aim, on: me.aimOn ? me.aimOn.i : null };
  },
  ships: function () { return SHIPS; }, balls: function () { return BALLS; }, pieces: function () { return PIECES; },
  /** 船隻碰撞（31_sailing.js collide）：shipHit() ⇒ 檔位、HIT_PROF、每個船型的取樣數與算了幾 ms；shipHit(i, j, lv) ⇒ 照第 i、j 艘現在的位置（先重算矩陣）量那一檔：
   *  lv 0 ⇒ 龍骨線最近距離（m，< 14 ＝ 撞）；1–3 ⇒ 互相落進去的點數（0 ＝ 沒撞）。只量、不推。 */
  shipHit: function (i, j, lv, brute) {
    if (i === undefined) { var smp = {}; SHIPS.forEach(function (s) { if (s.T.hit) for (var k in s.T.hit) smp[s.T.id + '/' + k] = { n: s.T.hit[k].n, ms: s.T.hit[k].ms }; }); return { shiphit: PHX.shiphit, shipfric: PHX.shipfric, prof: Object.assign({}, HIT_PROF), samples: smp }; }
    var A = SHIPS[i], B = SHIPS[j];
    [A, B].forEach(function (s) { s.M = shipMatrix(s); s.inv = M4.inv(s.M); s.center = shipCenter(s); });
    if (!lv) { var ka = keelPts(A), kb = keelPts(B), d = 1e9; ka.forEach(function (a) { kb.forEach(function (b) { d = Math.min(d, Math.hypot(a[0] - b[0], a[2] - b[2])); }); }); return +d.toFixed(3); }
    var L = SHIPHIT_LV[lv]; HIT_BRUTE = !!brute; var r = hitCount(A, B, L, [0, 0, 0]) + hitCount(B, A, L, [0, 0, 0]); HIT_BRUTE = false; return r;
  },
  dig: function (i, x, y, z, r) { var sh = SHIPS[i || 0], n = 0; for (var a = -r; a <= r; a++) for (var b = -r; b <= r; b++) for (var c = -r; c <= r; c++) if (a * a + b * b + c * c <= r * r && removeVoxel(sh, x + a, y + b, z + c, true)) n++; sh.rs.update && sh.rs.update(); return n; },   // 除錯：在格座標挖一個球（照 removeVoxel：尋路的髒區、進水照常記）
  ladders: function (i) { var H = SHIPS[i || 0].nav; return H ? H.ladders.map(function (L) { return { name: L.name, steps: L.steps, ia: navPos(H.levels[L.lo].N, L.ia), broken: L.broken }; }) : null; },
  /** 第 i 艘每一門砲：名字、砲種、砲軸（格座標水平、+x 船頭）、HUD 放哪（61_hud.js gunDir：bow 羅盤上、stern 羅盤下、side 兩舷貼邊）。 */
  /** 第 i 艘沒了的模型（砲、桶以外）：名字、種類（meta kind）、腳在哪 ⇒ 抓「一開場就掉」。 */
  /** 繩的檢查（10_ship.js ropesFloating／ropeAuditStatic）：第 i 艘現在浮空的繩；static ⇒ 作品本身的讀數。 */
  ropes: function (i, stat) { var sh = SHIPS[i || 0]; return stat ? ropeAuditStatic(sh) : ropesFloating(sh); },
  hangs: function (i) { return SHIPS[i || 0].models.filter(function (m) { return m.hang; }).map(function (m) { return m.path + (m.sax ? ' 擺 ' + (m.sw * 57.3).toFixed(1) + '°（擺長 ' + (m.sL * S).toFixed(2) + ' m）' : '') + ' falls ' + (m.falls ? m.falls.map(function (j) { var r = SHIPS[i || 0].ropes[j]; return r.name + (r.dead ? '×' : ''); }).join(',') : '（沒有）') + (m.alive ? '' : ' 掉了'); }); },
  lostModels: function (i) { return SHIPS[i || 0].models.filter(function (m) { return !m.alive && !GUNS[m.kind] && !kindProp(m.kind, 'noFall'); }).map(function (m) { return m.path + ' ' + (m.meta.kind || m.kind) + ' foot z ' + (m.foot >> 21); }); },
  gunDirs: function (i) { return SHIPS[i || 0].guns.map(function (g) { return [g.name.split('/').pop(), g.type, g.ax.map(function (v) { return +v.toFixed(2); }), gunDir(g)]; }); },
  /** 艙房的擺法（TASK-0568；船型要先載好）：每一間的格子（nx×ny、門口走道幾格、站不住幾格）、type ⇒ 那個類型自動擺滿的結果、now ⇒ 現在照擺法擺上的；ms ＝ 全部算一次幾毫秒（不記）。 */
  roomPlans: function (id, type) {
    var T = HULLT[id || CFG_ID]; if (!T) return null;
    var t0 = performance.now(), out = hullRooms(T).map(function (r) {
      r.autoC = null; var G = roomGrid(T, r), a = type ? roomAuto(T, r, type) : null, I = roomItems(T, r, roomPlan(T.id, r.name)), n = [0, 0, 0];
      for (var k = 0; k < G.s.length; k++) n[G.s[k]]++;
      function it(L) { return L.map(function (q) { return q.it + '@' + q.x + ',' + q.y + (q.r ? 'r' : ''); }).join(' '); }
      return { name: r.name, g: G.nx + 'x' + G.ny, aisle: n[2], wall: n[0], auto: a ? (a.items ? it(a.items) : a.why) : undefined, type: I.type, now: it(I.items), bad: I.bad, buff: I.type ? buffText(roomBuff(I.type, I.items.map(function (q) { return q.it; }))) : '' };
    });
    return { ms: +(performance.now() - t0).toFixed(1), rooms: out };
  },
  /** 改一間的擺法（v：null ＝ 空著、{ type } ＝ 自動擺滿、{ type, items } ＝ 自訂）⇒ 照驗過的擺上去的結果。 */
  roomSet: function (id, name, v) { (SHIP_ROOMS[id] = SHIP_ROOMS[id] || {})[name] = v; if (SLIDERS_SHOW) SLIDERS_SHOW(); var T = HULLT[id], r = T && hullRooms(T).filter(function (x) { return x.name === name; })[0]; return r ? roomItems(T, r, roomPlan(id, name)) : null; },
  /** 打第 i 艘那一間的第 k 件物品 dmg 點（跟砲同一套 damageModel；歸零 ⇒ 飛出去）⇒ 那一間打完的讀數。 */
  blow: function (i, name, sp) {   // 打掉第 i 艘名字含 name 的第一個模型（照 21_gunnery.js blowModel 的演出：blowStyle；TASK-0751）；sp ＝ 砲彈速度 m/s（預設 400，從 +y 舷打過來）⇒ 回 FLY 那一筆的初速與角速度
    var sh = SHIPS[i || 0], m = sh.models.filter(function (o) { return o.alive && (o.name === name || o.path.indexOf(name) >= 0); })[0]; if (!m) return null;
    blowModel(sh, m, M4.dir(sh.M, 0, -(sp || 400), 0), false); var f = FLY[FLY.length - 1];
    return { path: m.path, kind: m.kind, style: blowStyle(m), v: f.v.map(function (x) { return +x.toFixed(2); }), w: f.w.map(function (x) { return +x.toFixed(2); }), shipV: sh.vel.map(function (x) { return +x.toFixed(2); }) };
  },
  helm: function (i) { var sh = SHIPS[i || 0], D = sh.drive; if (HELM_TQ && D && D.R) { var e = helmEff(sh), f = function (v, n) { return v === undefined ? null : +(+v).toFixed(n); };   // 操舵（TASK-0777，31_drive.js）：舵效、每支舵的鏈、力矩（kN·m，yaw 變大 ＝ 往左舷為正）、阻尼 N、轉動慣量 I、反應時間、轉向率（°/s）
      return { eff: f(e, 4), loss: { wheel: WHEEL_LOSS, rudder: RUDDER_LOSS, k: helmLossK() }, rudder: f(sh.rudder, 3), u: f(D.dfu, 3), dif: D.dif, spd: f(sh.spd, 3), massT: f(D.M, 1), M0: f(D.M0, 1), N: f(D.N, 1), I: f(D.I, 1), T: f(D.Tt, 3),
        tqR: f(D.tqR, 1), tqS: f(D.tqS, 1), tqD: f(D.tqDf, 1), dS: f(D.dS, 3), dS1: f(D.dS1, 3), tqRef: f(D.tqRef, 1), effC: f(D.effC, 4), difRate: f(helmDifRate(sh, D.rmaxB || 0) * 57.2958, 3), yawDeg: f(sh.yawRate * 57.2958, 3), side: D.sideF ? D.sideF.map(function (v) { return f(v, 3); }) : null,
        R: D.R.map(function (q) { return { name: q.out, w: f(q.w, 3), ok: f(q.ok, 4), Fy: f(q.Fy, 1), chain: (q.chain || []).map(function (n) { return n.name + ' ' + (+n.ok).toFixed(2); }).join(' ⇒ ') }; }) }; }
    return { k: +helmK(sh).toFixed(4), lost: HELM_LOST, fun: playK('helm'), wheel: sh.models.filter(function (m) { return m.kind === 'wheel'; }).map(function (m) { return m.alive; }), rudder: sh.models.filter(function (m) { return m.kind === 'rudder'; }).map(function (m) { return m.alive; }) }; },   // 操舵性能（31_sailing.js helmK：乘在最大轉向率上）
  flyState: function () { return FLY.map(function (f) { return { t: +f.t.toFixed(2), y: +f.c[1].toFixed(2), rest: !!f.rest, wet: f.wet, land: !!f.land }; }); },
  /** 位移上限的反向對照（TASK-0797）：第 i 艘中段（照中線 ±10 m 裡最低的那一面甲板）上方 h 公尺放一個掉落物、往下 vy m/s（走真的 stepFly）；回放的位置。之後 flyState() 看停住（rest）還是落水（wet）。 */
  dropTest: function (i, h, vy) {
    var sh = SHIPS[i || 0], T = sh.T, y = Math.round(T.cy), best = null;
    for (var x = Math.round(T.cx - 10 / S); x <= T.cx + 10 / S; x += 5) { var z = T.sz - 1; while (z > 0 && !sh.grid.get(x, y, z)) z--; if (z > T.zw && (!best || z < best[1])) best = [x, z]; }
    if (!best) return null;
    var c0 = M4.pt(sh.M, best[0] + 0.5, y + 0.5, best[1] + 1 + h / S);
    FLY.push({ T: T, mesh: sh.models[0].mesh, M0: trans(c0[0], c0[1], c0[2]), c0: c0, c: c0.slice(), R: M4.ident(), t: 0, wet: false, v: add(sh.vel, [0, -vy, 0]), w: [0, 0, 0], sh: sh, land: true });
    return { x: best[0], deckZ: best[1], y0: +c0[1].toFixed(2) };
  },
  furnHit: function (i, name, k, dmg) { var sh = SHIPS[i], o = sh.rooms.filter(function (r) { return r.name === name; })[0], m = o.furn[k]; damageModel(sh, m, [0, 5, 0], dmg); var B = roomBuffNow(o); return { item: m.item, hp: m.hp, alive: m.alive, buff: buffText(B), cap: +roomCap(o).toFixed(2), eff: +roomEff(o).toFixed(2) }; },
  roomPlace: function (id, name, type, items, p) { var T = HULLT[id], r = hullRooms(T).filter(function (x) { return x.name === name; })[0]; return placeOk(roomGrid(T, r), type, items, p); },
  med: function (i) { return medInfo(SHIPS[i || 0]); },
  carp: function (i) { return carpInfo(SHIPS[i || 0]); }, duty: function (i) { return dutyInfo(SHIPS[i || 0]); },   // 航海士、軍需官（39_duty.js；TASK-0825）
  sm: function (i) { return smInfo(SHIPS[i || 0]); }, dmg: function (i) { return dmgInfo(SHIPS[i || 0]); },   // 損壞表（48_damage.js；只讀 —— 木匠、帆匠點名時才重掃）       // 帆匠與帆布櫃（47_sailmaker.js）   // 木匠與木工台（46_carpenter.js）
  burn: function (i) { return burnInfo(SHIPS[i || 0]); },   // 著火（49_burn.js）：燒著幾格、火場、救火的人、每面著過火的帆；沒著過火 ⇒ null
  burnAt: function (i, x, y, z) { var sh = SHIPS[i || 0], B = burnOf(sh); burnCatch(sh, B, x, y, z, 1, 1e9); burnFlush(sh, B, true); return B.n; },   // 點第 i 艘的 (x, y, z)（照樣要有一面露在乾空氣裡、材質會燒）⇒ 燒著幾格
  burnSail: function (i, k, q) { var sh = SHIPS[i || 0]; return burnSailAt(sh, sh.sails[k], q || 0); },   // 第 i 艘第 k 面帆從第 q 點燒起來
  galley: function (i, op) { var sh = SHIPS[i || 0]; if (op === 'kill') galleyKill(sh); return galleyInfo(sh); },   // 廚房（45_galley.js；TASK-0720）：{ cooks, stock, made, served, going, eff, fed, rk, effT, news, stoves[{…why}], skip }；沒有廚房 ⇒ 排掉的原因或 null；(i, 'kill') ＝ 把那艘的廚師全打倒（量斷炊）
  pumps: function (i) { return pumpInfo(SHIPS[i || 0]); },   // 抽水（45_pumps.js）：基礎、現在全船幾噸／分、每台抽水機的狀態與原因   // 醫療艙（44_medic.js）：每一間的床、人手、搬下去、治好歸隊
  rooms: function (on) { if (on !== undefined) { ROOMS_DBG = !!on; if (!on) roomLabels(); } return roomsInfo(); },   // 空艙房（36_rooms.js）：讀數；給 true／false ⇒ 開關外框與名字
  shipsIO: { exp: function () { return shipsExport(); }, imp: function (o) { var n = shipsImport(o); SLIDERS_SHOW && SLIDERS_SHOW(); return n; }, crew: function (id) { return shipCrew(id); }, seen: function () { return CREW_SEEN; } },   // 船隻配置的匯出入（TASK-0570；量的時候不必真的下載檔案）
  fp: function (on, to, yaw) { if (on !== undefined && on !== null) fpSet(!!on); if (yaw !== undefined && FP.on) { FP.yaw = yaw; FP.pitch = 0; } if (to === 'lad' && FP.lads && FP.lads.length) to = FP.lads[0].up[0]; if (to && FP.c) { var sz = -1; for (var dz = 0; dz <= 12 && sz < 0; dz++) { sz = standZ(fpG(FP.sh), Math.floor(to[0]), Math.floor(to[1]), to[2] - dz, to[2] + dz, NAV_HEAD); } if (sz >= 0) { FP.c.pos = [to[0], to[1], sz]; FP.ez = null; FP.jz = FP.jv = 0; FP.v = [0, 0]; FP.climb = null; } } var c = FP.c; return { on: FP.on, mode: FP.mode, eo: +FP.eo.toFixed(2), paused: PAUSED, fol: FP.fol ? { role: FP.fol.role, pos: FP.fol.pos.map(function (v) { return +v.toFixed(2); }) } : null, jz: +FP.jz.toFixed(2), ez: FP.ez === null ? null : +FP.ez.toFixed(2), v: FP.v.map(function (x) { return +x.toFixed(2); }), pos: c ? c.pos.map(function (v) { return +v.toFixed(2); }) : null, yaw: +FP.yaw.toFixed(3), pitch: +FP.pitch.toFixed(3), near: FP.near ? { name: FP.near.name, up: FP.near.up } : null, climb: FP.climb ? FP.climb.k : null, lads: (FP.lads || []).map(function (L) { return L.name + ' ' + L.up[0].join(',') + '→' + L.up[L.up.length - 1].join(','); }), mv: Object.assign({}, FP.mv) }; },   // 第一人稱（81_fps.js）：讀數；fp(1)／fp(0) 開關；fp(null, [x,y,z]｜'lad') 瞬移（'lad' ＝ 第一座梯子的梯腳；貼到 ±12 格內最近的地板，找不到就不移 —— ⛔ 懸空 ⇒ survey 判成掉下去、摔傷）—— 量的時候用
  fpRun: function (sec) { for (var t = 0; t < sec; t += 1 / 60) fpFrame(1 / 60); return this.fp(); },   // 第一人稱照每秒 60 格推 sec 秒（畫面迴圈不跑時量走路用：預覽窗格藏著、無頭瀏覽器；TASK-0655）
  fpMap: function (r) {   // 第一人稱：船長周圍 ±r 格每一柱站不站得住（照 81_fps.js fpStand；. 站不住、數字 ＝ 腳底比現在高幾格、@ 自己）—— 量的時候用
    if (!FP.on) return null; r = r || 10; var c = FP.c, g = fpG(FP.sh), z = Math.floor(c.pos[2]), x0 = Math.floor(c.pos[0]), y0 = Math.floor(c.pos[1]), rows = [];
    for (var y = y0 - r; y <= y0 + r; y++) { var s = ''; for (var x = x0 - r; x <= x0 + r; x++) { var h = fpStand(g, x, y, z); s += x === x0 && y === y0 ? '@' : h < 0 ? '.' : String.fromCharCode(48 + Math.max(0, Math.min(9, h - z + 4))); } rows.push(s); }
    return rows;
  },
  camera: function () { return { mode: CAM.mode, follow: CAM.follow ? { age: +CAM.follow.age.toFixed(2), owner: CAM.follow.owner, alive: CAM.follow.alive } : null, pick: CAM.pick || null, track: CAM.track, yaw: CAM.yaw, dist: CAM.dist, tgt: CAM.tgt.slice(), eye: CAM.eye.slice() }; },
  strike: function (o) { for (var k in o) STRIKE[k] = o[k]; return { rules: STRIKE, text: strikeText() }; },
  /** 量降旗用：第 i 艘還能動的人照順序倒下，直到死傷比例到 frac（role 給了只倒那個職位）；下一次 survey 才判降旗。 */
  casualty: function (i, frac, role) {
    var sh = SHIPS[i], need = Math.ceil(sh.crew0 * frac) - (sh.crew0 - sh.crew.filter(crewAble).length);
    sh.crew.forEach(function (c) { if (need > 0 && crewAble(c) && (role === undefined || c.role === role)) { killCrew(sh, c, '量測'); need--; } });
    return sh.crew.filter(crewAble).length;
  },
  /** 畫質（07_gfx.js）：給 level（low／mid／high）或 { shadow: 2, … } 就換；回傳現在的設定與管線的讀數。 */
  gfx: function (o) { if (typeof o === 'string') gfxSet(o); else if (o) for (var k in o) GFX[k] = o[k]; if (o) gfxShow(); return { level: gfxLevel(), gfx: JSON.parse(JSON.stringify(GFX)), w: CAM.w, h: CAM.h, msaa: RT ? RT.s : null, shadow: SHM ? SHM.n : null, refl: RT && RT.R ? [RT.R.w, RT.R.h] : null, sea: SEAG ? { lv: SEAG.lv, verts: SEAG.verts, tris: SEAG.n / 3 } : null }; },
  /** 天氣（08_weather.js）：給 id（clear／storm／maelstrom）就換；回傳現在的天氣。 */
  weather: function (id) { if (id) setWeather(id); return { id: WX_ID, wx: WX, wind: WIND.slice(), from: +bearing(-WIND[0], -WIND[2]).toFixed(1), spd: +WIND_SPD.toFixed(3), knots: +windKnots().toFixed(1) }; },
  /** 浪（08_sea.js）：(x, z) 的水面高度（t 不給 ＝ 現在）；sea() ＝ 浪的設定。 */
  sea: function (x, z, t) { return x === undefined ? { k: SEA_K, waves: WAVES } : seaH(x, z, t === undefined ? SIMT : t); },
  camFollow: function (dt) { camFollow(dt); return CAM.follow; },
  ctrl: function () { return { top: ctrlTop(), list: CTRLS.map(function (c) { return c.name + (c.on() ? '' : '（關）'); }) }; },   // 控制器（71_ctrl.js）：現在最上面的、由上往下
  predict: function (b) { return ballPredict(b); },
  cam: function (o) { camSet(o); camSet({ snap: true }); camUpdate(1); render(); },
  townProsp: function (v, id) { var r = townProspSet(v, id); if (RUNNING) render(); return r; },   // 城牆等級試看（63_towns.js townProspSet；v ＝ 繁榮度 0～1、null 回預設，id 沒給 ⇒ 每一座；開場前只改值，開場後畫一格）⇒ [{ id, tier, prosp, lv, kits }]
  town: function (at, on) { if (on !== undefined) { TOWNS.on = !!on; render(); } return BED && BED.A ? townStat(at) : null; },   // 城鎮的讀數（63_towns.js townStat；at ＝ [x, z] ⇒ 那一點的畫面高度、模擬高度、清不清樹；on ⇒ 開關畫不畫（量畫一格多少 ms 用））
  trees: function (sp, n, at) { return treeFind(sp, n, at); },   // 找樹（63_trees.js treeFind）：那一種最靠近 at（[x, z]；沒給 ⇒ 鏡頭）的 n 棵
  // 海圖（TASK-0721；08_seabed.js、32_ground.js）：載了哪幾塊、換過幾次中心、等過幾次；每艘的擱淺讀數；q ＝ [x, z] ⇒ 那一點的高度與底質
  inland: function (on) { if (on !== undefined) { BEDWAT.on = !!on; render(); } return BEDWAT.on; },   // 內陸水與低於海平面的乾地的遮罩一起開關（63_bed_gl.js；同一格開／關對照畫面用）
  chart: function () { return chartInfo(); },                                  // 小地圖（63_chart.js）：開了沒、範圍、吃水門檻、底圖幾塊、畫面上的位置
  flow: function () { return FLOW_ST; },                               // ?start=1 分段開戰（70_flow.js startStaged）：幾步、最久一步、每一步幾 ms、全部幾 ms
  bed: function (q) { if (!BED || !BED.A) return null; return { area: BED.A.id, site: BED.site, origin: [BED.ax, BED.az], center: [BED.cx, BED.cy], loaded: Object.keys(BED.ch).sort(), loads: BED.loads, drops: BED.drops, waits: BED.miss,
    mid: BED.mid ? { step: BED.mid, loaded: Object.keys(BED.cm).sort(), loads: BED.mloads, lv: [1, 2].map(function (v) { var n = 0; for (var q = 0; q < BED.lv.length; q++) if (BED.lv[q] === v && BED.has[q]) n++; return n; }) } : null,   // 外圈的中等塊：載了哪幾塊、模擬讀中等／原精度的各幾塊
    meshes: Object.keys(BEDGL).length,                                   // （以前寫在上一行的註解後面 ⇒ 沒出來）
    win: BED.win ? { r: bedWinR(), max: BED.win, km: +(bedWinR() * BED.A.chunk / 1000).toFixed(2), x: BED.A.x, y: BED.A.y, wins: BED.wins, ms: BED.winMs, asking: !!BED.winP } : null,   // 海域跟著旗艦走：現在的窗（塊號）、換過幾次、上次重排幾 ms、在要新的窗
    pump: BED.inq ? { q: BED.inq.length, n: BED.pumped, max: +BED.pumpMax.toFixed(1) } : null,   // 收塊排隊（08_seabed.js bedPump）：還排著幾則、處理過幾則、一格最久幾 ms
    trees: treeStat(),
    draw: { n: BEDDRAW.n, cull: BEDDRAW.cull, tris: BEDDRAW.tris },   // 上一格：畫了幾塊、視錐外剔掉幾塊、畫了幾個三角形（63_bed_gl.js bedDraw）
    shadow: SHM ? { land: SHM.stOn, redraws: SHM.stat.redraws, last: SHM.stat.last } : null,   // 陰影的靜態那一層（60_render.js csmStatic）：有沒有、重畫過幾次、上一次（範圍、地形幾塊、樹幾棵、城幾個實例、毫秒）；全部看 __game.shadow()
    far: { tiles: BEDFAR.n, left: BEDFAR.todo ? BEDFAR.todo.length + BEDFAR.fly + BEDFAR.ready.length : null, fly: BEDFAR.fly, fail: BEDFAR.fail, kb: Math.round(BEDFAR.bytes / 1024), ms: +BEDFAR.ms.toFixed(1), drawn: Object.keys(BEDFAR.g).filter(function (k) { return !BEDGL[k]; }).length },
    inland: { on: BEDWAT.on, meshes: Object.keys(BEDGL).filter(function (k) { return BEDGL[k].w; }).length, far: Object.keys(BEDFAR.g).filter(function (k) { return BEDFAR.g[k].w; }).length, n: BEDWAT.n, tris: BEDWAT.tris,   // 內陸水（63_bed_gl.js）：細的、遠景各幾塊有水面網格；上一格畫了幾塊、幾個三角形
      dry: { on: BEDDRY.on, chunks: Object.keys(BEDDRY.c).filter(function (k) { return BEDDRY.c[k]; }).length, cells: BEDDRY.cells, cut: BEDDRY.cut, builds: BEDDRY.builds, ms: BEDDRY.ms, worker: BEDDRYW.ok } },   // 低於海平面的乾地的遮罩：幾塊、幾格（32 m）、重建幾次
    foam: { n: BEDFOAM.N, builds: BEDFOAM.builds, ms: +BEDFOAM.ms.toFixed(1), eye: CAM.eye.map(function (v) { return +v.toFixed(1); }), ground: +bedHgt(CAM.eye[0], CAM.eye[2]).toFixed(1) },
    at: q ? { h: +bedHgt(q[0], q[1]).toFixed(2), mat: bedMat(q[0], q[1]) } : undefined,
    ships: SHIPS.map(function (sh) { return { name: sh.name, px: +sh.px.toFixed(1), pz: +sh.pz.toFixed(1), keelY: sh.keelY === undefined ? null : +sh.keelY.toFixed(2), grnd: sh.grnd ? { m: sh.grnd.m, pen: +sh.grnd.pen.toFixed(2), lost: sh.grnd.lost } : null, lost: sh.grndLost || 0, av: sh.bedAv ? { t: +sh.bedAv.t.toFixed(1), d: sh.bedAv.d } : null }; }) }; },
  seaDbg: function (o) { SEA_DBG = o || {}; render(); return SEA_DBG; },   // 海面試驗場（src/tests/sea_lab.py）：{ det, an, … } 覆寫著色器的那幾格；{} ⇒ 照畫質
  phys: function (on) { if (on !== undefined) setPhys(!!on); return PHYS; },
  /** 進水（33_flood.js，粒子模式）：第 i 艘的水量、破口、進出水、抽水、粒子、重心、該下沉多少；公式模式 ⇒ null。 */
  flood: function (i, o) {
    if (o && 'hide' in o) FL_HIDE = !!o.hide;
    if (o && o.gm > 0) FL_GM = o.gm;                                   // 調穩心高（量傾斜用）
    var sh = SHIPS[i || 0]; return sh.fl ? flReadout(sh) : null;   // 讀數在 33_flood.js flReadout（進水報表 81_floodlab.js 共用）
  },
  /** 量進水用：第 i 艘在格 (x, z) 那一舷（side 0 ＝ 格 +y、1 ＝ −y）的船殼打一個半徑 r 格的洞（從最外那一格往艙內打穿）。回打掉幾格。 */
  // 除錯（TASK-0616）：從船外對著格座標 (x, z) 那一欄水平射一發（side 同 hole：真 ＝ 從 y 小的那一舷），只跑這一顆砲彈（船不動）⇒ 打掉幾格、穿多深、出來剩多快（木頭／鐵甲打同一點比）
  /** 從船外水平打一發到 (x, z) 那一欄的船殼（gun：砲種 key 或 code；ammo：彈種）。ang（度）：沿船長方向斜著打（0 ＝ 正橫）。
   *  回：mat 表面材質、removed 掉幾格、deep 鑽多深（m）、out 出來剩多快、res 鐵甲那一下是 pen 穿／dent 凹／rico 彈（TASK-0621）。 */
  /** 落水彈道的測試場（80_lab.js，TASK-0642）：o 同網址 ?lab=uw 的參數 ⇒ 每一發的落水點、水下走多遠、打到船殼多深、軌跡。⛔ 會重開一局。 */
  lab: function (o) { return uwLab(o); },
  /** 沙盒進水報表（81_floodlab.js，TASK-0654）：o 同網址 ?lab=flood 的參數 ⇒ 每 every 秒一筆讀數＋接縫分類＋截圖。⛔ 會重開一局。 */
  floodLab: function (o) { return floodLab(o); },
  wsim: function (i, o) { var sh = SHIPS[i || 0]; if (!sh || !sh.wrs) return null; var s = sh.wrs, W = s.W, r = wrsRead(sh); if (o && o.ops) { r.opsList = []; for (var k = 0; k < s.NO; k++) if (s.ost[k]) r.opsList.push({ i: k, t: s.O.T[k] ? 'side' : 'deck', a: s.oa[k], b: s.ob[k], z: s.O.Z[k], m2: +(s.O.N[k] * S * S).toFixed(2), at: [s.O.X[k], s.O.Y[k]], st: s.ost[k] > 0 ? 'a→b' : 'b→a', q: +s.oq[k].toFixed(4), door: s.odoor[k] }); r.tops = s.tops.map(function (t) { return { door: t.d, room: t.r, m2: +t.ar.toFixed(2), q: +t.q.toFixed(4) }; }); r.doors = []; for (k = 0; k < s.NO; k++) if (s.odoor[k] >= 0) r.doors.push({ op: k, door: s.odoor[k], m2: +(s.O.N[k] * S * S).toFixed(2) }); }
    if (o && o.brx) { var V3 = S * S * S, rv = function (q) { var t = 0; for (var c = W.roomCol0[q]; c < W.roomCol0[q + 1]; c++) t += s.su[c]; return { room: q, m3: +(W.roomVox[q] * V3).toFixed(2), water: +(t / s.upm).toFixed(2) }; };   // 破口對到哪一間、那一間的接口通到哪幾間（多大、裝了多少）
      r.brx = []; s.br.forEach(function (b) { if (b.r < 0) return; var e = rv(b.r); e.at = [b.x, b.y, b.z]; e.col = { j: b.j, ca: +(s.ca[b.j]).toFixed(3), u: s.su[b.j], cap: s.cap[b.j], hw: +s.hw[b.j].toFixed(3), lv: +s.lv[b.j].toFixed(3), rl: +s.rl[b.r].toFixed(3), q: +b.q.toFixed(4), ar: b.ar }; e.ops = []; for (var k2 = 0; k2 < s.NO; k2++) if (s.oa[k2] === b.r || s.ob[k2] === b.r) { var q2 = s.oa[k2] === b.r ? s.ob[k2] : s.oa[k2], f2 = rv(q2); f2.op = k2; f2.t = s.O.T[k2] ? 'side' : 'deck'; f2.z = s.O.Z[k2]; f2.m2 = +(s.O.N[k2] * S * S).toFixed(2); f2.at = [s.O.X[k2], s.O.Y[k2]]; e.ops.push(f2); } r.brx.push(e); }); }
    if (o && o.opc) { var oc = { side: [0, 0, 0], deck: [0, 0, 0], sideM2: [0, 0, 0], deckM2: [0, 0, 0] };   // 接口的中心那一格屬於哪一間：[兩間之一, 別間, 不是艙內的空氣]（照面數加權的 m² 另計）
      for (k = 0; k < W.opT.length; k++) { var rr0 = wrRoomAt(W, Math.floor(W.opX[k]), Math.floor(W.opY[k]), W.opZ[k]), rr1 = W.opT[k] ? rr0 : wrRoomAt(W, Math.floor(W.opX[k]), Math.floor(W.opY[k]), W.opZ[k] + 1), ok2 = rr0 === W.opA[k] || rr0 === W.opB[k] || rr1 === W.opA[k] || rr1 === W.opB[k], c3 = ok2 ? 0 : rr0 >= 0 || rr1 >= 0 ? 1 : 2, t3 = W.opT[k] ? 'side' : 'deck'; oc[t3][c3]++; oc[t3 + 'M2'][c3] += W.opN[k] * S * S; }
      oc.sideM2 = oc.sideM2.map(function (v) { return +v.toFixed(1); }); oc.deckM2 = oc.deckM2.map(function (v) { return +v.toFixed(1); }); oc.split = [W.opT.length, s.NO]; r.opc = oc; }
    return r; },   // 房間模擬（TASK-0808，33_wrsim.js）：讀數；o.ops ⇒ 每個在流的開口（拆過的，wrsOpenings；模擬層記的靜止／流出／流入，畫面只讀這份）、門與艙蓋對到哪個開口；o.brx ⇒ 破口那一間通到哪幾間；o.opc ⇒ 烘焙的接口重心那一格屬於哪一間（拆之前的毛病）、拆成幾個
  wrwater: function (i, o) { if (o && o.vol !== undefined) WRV_ON = !!+o.vol; var sh = SHIPS[i || 0]; if (!sh || !sh.wrw) return null; if (o && o.vol !== undefined) { var wv = sh.wrw.wv, V = sh.T.wrvV; return { on: WRV_ON, draw: wrvOn(sh, sh.wrw), wet: wv ? wv.wet : 0, full: wv ? wv.full : 0, box: wv ? [Array.from(wv.b0), Array.from(wv.b1)] : null, tex: V ? [V.nx, V.ny, V.nz, V.mb] : null }; }   /* o.vol ＝ 0／1：透視的水改不改成體積（WRV_ON，63_wrwater_gl.js）⇒ 回體積的讀數 */ if (o && o.probe) return wrwProbe(sh); var me = sh.wrw, R = []; if (o && o.ripple) (me.rip = me.rip || []).push([o.ripple[0], o.ripple[1], SIMT, o.ripple[2] || 1]); for (var r = 0; r < me.h.length; r++) if (me.h[r] === me.h[r]) R.push({ r: r, m3: +(Math.round(me.U[r]) / WR_U * S * S * S).toFixed(2), h: +me.h[r].toFixed(3) }); return { st: me.st, rooms: R, rip: (me.rip || []).map(function (q) { return [+(q[0] * S).toFixed(1), +(q[1] * S).toFixed(1), +(SIMT - q[2]).toFixed(2), +q[3].toFixed(2)]; }) }; },   // 房間的水面（TASK-0811，63_wrwater_gl.js）：讀數＋每間有水的房 m³、水面世界高度、漣漪 [x, y（m）, 幾秒前, 強度]；o.ripple ＝ [x, y（格）, 強度] 手動丟一圈（看細波）
  wrooms: function (i, o) { var T = typeof i === 'string' ? HULLT[i] : (SHIPS[i || 0] || {}).T || HULLT[myHull()], r = wrInfo(T); if (r && o && o.cabins) r.cabins = wrCabins(T); return r; },
  wroomsLab: function (i, o) { return wroomsLab(typeof i === 'string' ? HULLT[i] : (SHIPS[i || 0] || {}).T || HULLT[myHull()], o); },   // 水的房間的報表（同 ?lab=wrooms）：讀數、艙房對照、側視與俯視圖（data URL）   // i：第幾艘或船型 id（先 loadHull）；{ cabins: 1 } ⇒ 再跟作者標的艙房比   // 水的房間（33_wrooms.js，TASK-0807）：幾間、開口、切了幾 ms、是不是快取讀回的、雜湊（⛔ rooms 是艙房，36_rooms.js）
  flHoles: function (i) { var sh = SHIPS[i || 0]; return sh.fl ? flHoleInfo(sh) : null; },   // 每個破口：在不在海面下、流量、進水／出水／沒在流（33_flood.js flHoleState）
  floodView: function (o) { return floodView(o); },                   // 換鏡頭再拍一張（81_floodlab.js）
  /** 環境音試聽（02_ambient.js，TASK-0663）：q ＝ 'sec=10&cases=名字:w:sea:rain:hold;…' ⇒ Promise<[{ name, peak, rmsDb, wav }]>（src/tests/ambient_lab.py 經 DevTools 呼叫）。 */
  ambLab: function (q) { return ambLab(new URLSearchParams(q || '')); },
  bgmRender: function (o) { return bgmRender(o || {}); },                // 背景音樂離線錄（02_music.js；src/tests/music_lab.py）
  bgm: function () { return { snd: JSON.parse(JSON.stringify(SND)), tune: BGM ? BGM.tn.id : null, pass: BGM ? BGM.pass : null, forced: !!(BGM && BGM.forced), bus: AC && AC.bgmBus ? +AC.bgmBus.gain.value.toFixed(4) : null, sfxBus: AC && AC.sfxBus ? +AC.sfxBus.gain.value.toFixed(4) : null, ambBus: AC && AC.ambBus ? +AC.ambBus.gain.value.toFixed(4) : null, fight: AC ? +(AC.currentTime - SND_FIGHT).toFixed(1) : null, tunes: TUNES.map(function (t) { return t.id; }), themes: THEMES.map(function (t) { return t.id; }), theme: (bgmTheme() || {}).id || null }; },   // 聲音的讀數：三條音量線、正在放哪首
  /** 遊戲裡那一份環境音現在的值（還沒有聲音 ⇒ null）：風、浪、雨的音量、風的頻率、悶掉的低通、左右、在不在船艙裡。 */
  amb: function () { if (!AMB) return null; var r = function (v) { return +v.toFixed(4); }; return { ctx: AC.state, rain: AMB.rain, wind: r(AMB.wg.gain.value), windHz: r(AMB.wbp.frequency.value), sea: r(AMB.vg.gain.value), rainG: AMB.rain ? r(AMB.rg.gain.value) : 0, muff: r(AMB.muff.frequency.value), pan: AMB.pan ? r(AMB.pan.pan.value) : 0, hold: AMB.hold0, p: ambParams() }; },
  shot: function (i, x, z, side, gun, ammo, ang) {
    var sh = SHIPS[i || 0], B = sh.T.base, s = side ? 1 : -1, y0 = -1, y, GS = GUNS[gun] || Object.keys(GUNS).map(function (k) { return GUNS[k]; }).filter(function (g) { return g.code === gun; })[0] || GUNS.long;
    if (side) { for (y = 0; y < sh.T.cy; y++) if (sh.grid.get(x, y, z)) { y0 = y; break; } } else { for (y = B.sy - 1; y > sh.T.cy; y--) if (sh.grid.get(x, y, z)) { y0 = y; break; } }
    if (y0 < 0) return null;
    var dx = 30 * Math.tan((ang || 0) * Math.PI / 180), p = M4.pt(sh.M, x + 0.5 - dx, y0 - s * 30, z + 0.5), q = M4.pt(sh.M, x + 0.5, y0, z + 0.5), d = norm(sub(q, p)), n0 = sh.grid.count, mat = sh.T.matIds[sh.T.matG ? sh.T.matG.get(x, y0, z) : 0];
    var A0 = JSON.stringify(sh.armRes || {});
    var b = { p: p, v: add(mul(d, GS.V), sh.vel), owner: SHIPS.length > 1 ? 1 - (i || 0) : 0, ammo: ammo || 0, trav: 0, alive: true, age: 0, bounced: false, big: GS.big, hole: GS.hole, dmg: 0, m: GS.shot, dbg: [] }, deep = 0, k;
    for (k = 0; k < 600 && b.alive; k++) { stepBall(b, DT / 4); var L = toLocal(sh, b.p); if (b.alive && L[1] >= 0 && L[1] < B.sy) deep = Math.max(deep, s * (L[1] - y0)); }
    sh.rs.flush();
    var A1 = sh.armRes || {}, a0 = JSON.parse(A0), res = ['pen', 'dent', 'rico', 'shell'].filter(function (k2) { return (A1[k2] || 0) > (a0[k2] || 0); }).join('+') || null;
    return { mat: mat, skin: y0, removed: n0 - sh.grid.count, deep: +(deep * S).toFixed(2), out: b.alive ? +len(b.v).toFixed(0) : 0, V: GS.V, res: res, uw: !!b.wet, dbg: b.dbg };
  },
  /** 砲帶的裝甲（TASK-0631；24_armor.js）：第 i 艘每一塊 —— 那門砲、現在轉了幾度、還剩幾格／原本幾格、砲口沿砲軸碰到裝甲幾格（armBlock；0 ＝ 在砲門裡）；船殼幾格、重量。沒有裝甲 ⇒ null。
   *  o.yaw（度）⇒ 先把那門砲直接轉到那個角度（量測用：不照轉速；砲軸、砲口、模型、站位跟 mountStep 一樣轉，下一步 mountStep 照瞄準點接著轉）。
   *  o.shot ＝ [方位（度；船的格座標繞轉軸，0 ＝ +x 船頭、90 ＝ +y 右舷）, 高 z, 砲種, 彈種] ⇒ 從 6 m 外水平朝轉軸射一發（船不動、只跑這一顆）：打掉幾格裝甲、船殼少幾格、出來剩多快。 */
  /** 螺旋槳（會轉的體素件，TASK-0653 第二段；24_armor.js propSetup）：第 i 艘每一個 —— 還剩幾格／原本幾格、還剩幾成、轉角、掉了沒。沒有 ⇒ null。
   *  o.shot ＝ [z 偏移（格，相對 hub）, 砲種, 彈種, 從哪一舷（0 ＝ 從 +y 往 −y 打）] ⇒ 從 3 m 外水平朝第一個螺旋槳的 hub 那一欄射一發（船不動、只跑這一顆）。
   *  起點在水下 ⇒ 當作已經跳過水漂（bounced；不然一步就被放回水面）；落水就沒的彈（輕的實心彈、爆裂彈、鏈彈）打不到，要用大口徑實心彈（例 11d）。 */
  prop: function (i, o) {
    var sh = SHIPS[i || 0], A = (sh && sh.arm || []).filter(function (a) { return a.prop; }), out = {}; if (!A.length) return null;
    if (o && o.shot) {
      var a = A[0], h = a.A.hub, s = o.shot[3] ? -1 : 1, z = h[2] + (+o.shot[0] || 0), GS = GUNS[o.shot[1]] || Object.keys(GUNS).map(function (k3) { return GUNS[k3]; }).filter(function (g) { return g.code === o.shot[1]; })[0] || GUNS.long;
      var p = M4.pt(sh.M, h[0], h[1] + s * 30, z), q = M4.pt(sh.M, h[0], h[1], z), d = norm(sub(q, p)), n0 = a.grid.count, h0 = sh.grid.count;
      var b = { p: p, v: add(mul(d, GS.V), sh.vel), owner: SHIPS.length > 1 ? 1 - (i || 0) : 0, ammo: o.shot[2] || 0, trav: 0, alive: true, age: 0, bounced: true, big: GS.big, hole: GS.hole, dmg: 0, m: GS.shot, dbg: [] };
      var L0 = toLocal(sh, b.p), Lk = L0;
      for (var k = 0; k < 600 && b.alive; k++) { stepBall(b, DT / 4); if (b.alive) Lk = toLocal(sh, b.p); }
      out.shot = { removed: n0 - a.grid.count, hull: h0 - sh.grid.count, out: b.alive ? +len(b.v).toFixed(0) : 0, uw: !!b.wet, steps: k, from: L0.map(Math.round), last: Lk.map(Math.round) };
    }
    out.props = A.map(function (a) { return { name: a.A.name, n: a.grid.count, n0: a.A.n, left: +propLeft(a).toFixed(3), sw: a.m && a.m.sw ? +a.m.sw.toFixed(3) : 0, gone: propGone(a), mat: a.A.mat }; });
    return out;
  },
  armor: function (i, o) {
    var sh = SHIPS[i || 0], D = Math.PI / 180, out = {}; if (!sh || !sh.arm) return null;
    if (o && o.yaw !== undefined) sh.arm.forEach(function (a) {
      var g = a.g, M = g && g.mt; if (!M || M.up) return;               // 掛在砲塔上的（27_turret.js）⇒ 用 __game.turret 設
      var y = o.yaw * D, da = y - M.yaw, ax = M4.dir(rotM([0, 0, 1], y), M.ax0[0], M.ax0[1], 0);
      M.yaw = M.yawT = y; g.model.rot = y; g.ax = [ax[0], ax[1]];
      g.muz = mountRot(M.muz0, M.c, y); if (M.muzs0) g.muzs = M.muzs0.map(function (q) { return mountRot(q, M.c, y); });
      if (g.drop) g.drop = mountRot(g.drop, M.c, da);
      (g.spots || []).forEach(function (s) { s.at = mountRot(s.at, M.c, da); var c = s.who; if (c && c.gun === g && !c.walk && c.st === 0) { c.pos = mountRot(c.pos, M.c, da); if (c.home) c.home = mountRot(c.home, M.c, da); } });
    });
    if (o && o.shot) {
      var a = sh.arm[0], b0 = a.A.bb, c = a.nd ? a.nd.c : [(b0[0] + b0[3]) / 2, (b0[1] + b0[4]) / 2, b0[2]], ang = o.shot[0] * D, z = o.shot[1] + 0.5, GS = GUNS[o.shot[2]] || Object.keys(GUNS).map(function (k3) { return GUNS[k3]; }).filter(function (g3) { return g3.code === o.shot[2]; })[0] || GUNS.long;   // 砲種 key 或 code（以前寫 '24l' 其實查不到、落到第一種）
      var p = M4.pt(sh.M, c[0] + Math.cos(ang) * 60, c[1] + Math.sin(ang) * 60, z), q = M4.pt(sh.M, c[0], c[1], z), d = norm(sub(q, p)), n0 = sh.grid.count, a0 = armCount(sh);
      var b = { p: p, v: add(mul(d, GS.V), sh.vel), owner: SHIPS.length > 1 ? 1 - (i || 0) : 0, ammo: o.shot[3] || 0, trav: 0, alive: true, age: 0, bounced: false, big: GS.big, hole: GS.hole, dmg: 0, m: GS.shot }, A0 = JSON.stringify(sh.armRes || {});
      for (var k = 0; k < 600 && b.alive; k++) stepBall(b, DT / 4);
      sh.rs.flush(); sh.arm.forEach(function (e) { e.rs.flush(); });
      var A1 = sh.armRes || {}, a00 = JSON.parse(A0);
      out.shot = { armRemoved: a0 - armCount(sh), hullRemoved: n0 - sh.grid.count, out: b.alive ? +len(b.v).toFixed(0) : 0, V: GS.V,
        res: ['pen', 'dent', 'rico', 'shell'].filter(function (k2) { return (A1[k2] || 0) > (a00[k2] || 0); }).join('+') || null };   // 鐵甲那一下：穿／凹／彈（TASK-0621）
    }
    out.arm = sh.arm.map(function (a) { return { mount: a.A.mount, yaw: +(armYaw(a) / D).toFixed(2), n: a.grid.count, n0: a.A.n, lost: a.lost, blk: armBlock(a), gun: a.g ? a.g.alive : a.nd && a.nd.isTur ? a.nd.guns.filter(function (q) { return q.alive; }).length : null, smooth: a.smR ? a.smR.size : 0 }; });
    out.hull = sh.grid.count; out.orig = sh.orig; out.armN0 = sh.armN0; out.mass0 = +shipT(sh).toFixed(3); out.voxLost = +voxLostT(sh).toFixed(4); out.massLost = +massLost(sh).toFixed(4); out.lost = sh.lost;
    return out;
  },
  /** 砲塔層（TASK-0659；27_turret.js）：{ k, yaw（度）} ⇒ 把第 k 座直接設成那個角度（跟著轉的一起換）。回每一座的角度、上面的砲（砲口、砲軸、能不能開）、會不會轉的甲板。 */
  turret: function (i, o) {
    var sh = SHIPS[i || 0], D = Math.PI / 180; if (!sh || !sh.tur) return null;
    if (o && o.k !== undefined && o.yaw !== undefined) turretSet(sh, o.k, o.yaw * D);
    var nav = null, between = null;
    if (o && o.between && sh.arm) between = o.between.map(function (s) { return armBetween(sh, s[0], s[1]); });   // 線段 [a, b]（船的格座標）中間隔著裝甲／砲盾嗎（hurt 擋人那一支）
    if (o && o.nav && sh.nav) nav = sh.nav.levels.map(function (L) {   // 會轉的甲板的走路格：每一點 navPos（照現在的角度換出去）→ navSnap 找回來，是不是同一點
      var N = L.N; if (!N.rot) return null; var n = 0, ok = 0, bad = [];
      for (var i = 0; i < N.rot.length; i++) { if (!N.rot[i] || !N.ok[i]) continue; n++; var P = navPos(N, i), j = navSnap(N, P, 0); if (j === i) ok++; else if (bad.length < 5) bad.push([i, j, P.map(function (v) { return +v.toFixed(1); })]); }
      return { level: L.name, n: n, ok: ok, bad: bad };
    });
    var r3 = function (p) { return p ? p.map(function (v) { return +v.toFixed(2); }) : null; };
    return { deck: !!sh.T.turDeck, tur: sh.tur.map(function (N) {
      return { path: N.path, up: N.up ? N.up.path : null, yaw: +(N.yaw / D).toFixed(2), yawT: +(N.yawT / D).toFixed(2), total: +(ndYaw(N) / D).toFixed(2), f0: +(N.f0 / D).toFixed(1), models: N.models.length,
        guns: N.guns.map(function (g) { return { path: g.model.path, alive: g.alive, own: !!g.mt, yaw: g.mt ? +(g.mt.yaw / D).toFixed(2) : null, muz: r3(g.muz), ax: r3(g.ax), fireOk: mountFireOk(g), cone: +((g.cone || 0.45) / D).toFixed(1), spots: (g.spots || []).length, drop: r3(g.drop) }; }) };
    }), nav: nav, between: between, stations: sh.stations.filter(function (st) { return st.tur >= 0; }).map(function (st) { return { name: st.name, at: r3(st.at), tur: st.tur }; }) };
  },
  hole: function (i, x, z, side, r) { return labHole(SHIPS[i || 0], x, z, side, r); },   // 81_floodlab.js（進水報表共用）
  /** 船邊水花（13_water.js）：現在的檔、水滴與白沫各幾顆、開局以來生了幾顆。{ hide: true } ⇒ 照算、不畫（量繪製成本）。 */
  /** 逐幀分段計時（TASK-0531）：最慢的 top 格（預設 8）各段幾 ms、這一格走了幾步模擬；{ clear: true } ⇒ 清掉重記；{ sum: true } ⇒ 再附上全部格的各段總和與平均。 */
  /** 照真的畫面迴圈跑 sec 秒模擬（同步呼叫 frame()，dt ＝ 實際經過的時間 ⇒ 追趕迴圈補幾步跟真的玩一樣；預覽分頁在背景時 rAF 停也量得到）。finish ⇒ 每格 gl.finish()（把 GPU 的時間也算進去）。 */
  live: function (sec, finish) {
    var end = SIMT + sec, n = 0, t0 = performance.now(); loopLast = 0;
    while (SIMT < end && n < sec * 400) { frame(performance.now(), true); if (finish) gl.finish(); n++; }
    return { frames: n, ms: Math.round(performance.now() - t0), simt: +SIMT.toFixed(2), fps: +(n / ((performance.now() - t0) / 1000)).toFixed(1) };
  },
  frames: function (o) {
    o = o || {}; if (o.clear) { PF.ring = []; PF.cur = {}; return 'cleared'; }
    var R = PF.ring, f2 = function (x) { return +x.toFixed(1); }, fmt = function (c) { var r = { simt: f2(c.simt), total: f2(c.total), steps: c.steps }; Object.keys(c).filter(function (k) { return ['simt', 'total', 'steps'].indexOf(k) < 0 && c[k] >= 0.5; }).sort(function (a, b) { return c[b] - c[a]; }).forEach(function (k) { r[k] = f2(c[k]); }); return r; };
    var top = R.slice().sort(function (a, b) { return b.total - a.total; }).slice(0, o.top || 8).map(fmt), out = { frames: R.length, top: top };
    if (o.sum) { var s = {}; R.forEach(function (c) { for (var k in c) if (k !== 'simt' && k !== 'steps') s[k] = (s[k] || 0) + c[k]; }); for (var k in s) s[k] = f2(s[k] / Math.max(1, R.length)); out.avg = s; }
    return out;
  },
  /** 殉爆的慢動作與特寫（73_slowmo.js）：給 { on, cam } 就改設定；回現在的倍率、狀態、殉爆幾次。 */
  /** 畫面每一塊花多少（gl.finish 連 GPU 一起算；只重畫、不走模擬）：全部、拿掉碎片、拿掉斷開的那幾團、陰影關、反射關、船員不畫 ⇒ 每格 ms。 */
  rprof: function (k) { k = k || 3; function t() { var s = performance.now(); for (var i = 0; i < k; i++) { render(); gl.finish(); } return +((performance.now() - s) / k).toFixed(1); }
    var pl = 0; for (var q = 0; q < D.n; q++) if (D.sh[q]) pl++;
    var r = { debris: D.n, plates: pl, pieces: PIECES.length, pts: PT.n, ships: SHIPS.length, all: t() }, dn = D.n; D.n = 0; r.noDebris = t(); D.n = dn;
    var pc = PIECES.splice(0, PIECES.length); r.noPieces = t(); Array.prototype.push.apply(PIECES, pc);
    var g0 = GFX.shadow; GFX.shadow = 0; r.noShadow = t(); GFX.shadow = g0; g0 = GFX.refl; GFX.refl = 0; r.noRefl = t(); GFX.refl = g0; r.again = t(); return r; },
  pslow: function (o) { if (o && 'budget' in o) PSLOW.budget = +o.budget; if (o && 'on' in o) { PSLOW.on = !!o.on; if (!PSLOW.on) PSLOW.ts = 1; gsetShow(); } return { on: PSLOW.on, ts: +PSLOW.ts.toFixed(3), ms: +PSLOW.ms.toFixed(2), load: +(PSLOW.ms * 60 / 1000).toFixed(3), budget: PSLOW.budget, min: PSLOW_MIN }; },   // 物理減速（73_slowmo.js）
  slow: function (o) { if (o) { if ('on' in o) SLOW.on = !!o.on; if ('cam' in o) SLOW.cam = !!o.cam; gsetShow(); } return { on: SLOW.on, cam: SLOW.cam, active: SLOW.active, ts: +SLOW.ts.toFixed(3), min: SLOW.min, hold: SLOW.hold, t: +SLOW.t.toFixed(2), kicks: SLOW.kicks, camHeld: !!SLOW.camSave }; },
  /** 3D 雨滴（14_rain.js）：現在幾滴、上一格畫了幾條、水花幾個、開了以來落海與打到船幾次。{ bench: n } ⇒ 量 n 格（走一格＋填緩衝畫一次）各花幾 ms。 */
  rain: function (o) {
    var b = null; if (o && o.bench) { var t0 = performance.now(), i; for (i = 0; i < o.bench; i++) stepRain(1 / 60); var t1 = performance.now(); for (i = 0; i < o.bench; i++) rdDraw(); gl.finish(); b = { step: +((t1 - t0) / o.bench).toFixed(3), draw: +((performance.now() - t1) / o.bench).toFixed(3) }; }
    return { bench: b, lv: GFX.drops, n: RD.n, drawn: RD.drawn, splash: RS.n, hit: { sea: RD_STAT.hitSea, ship: RD_STAT.hitShip }, v: RD.v.map(function (x) { return +x.toFixed(2); }), top: +RD.top.toFixed(1), bot: +RD.bot.toFixed(1), hi: +RD.hi.toFixed(1),
      near: (function () { var e = CAM.eye, c = 0; for (var i = 0; i < RD.n; i++) if (Math.hypot(RD.p[i * 3] - e[0], RD.p[i * 3 + 1] - e[1], RD.p[i * 3 + 2] - e[2]) < 40) c++; return c; })() }; },   // near：離鏡頭 40 m 內幾滴（大漩渦的雨在不在鏡頭旁邊）
  water: function (o) { if (o && 'hide' in o) WP_HIDE = !!o.hide; return { lv: PHX.water, spray: WS.n, foam: WF.n, emitted: { spray: WP_STAT.spray, foam: WP_STAT.foam }, src: WP_STAT.src }; },
  /** 物理效果（09_phx.js）：給 level（full／high／mid／low）或 { rig: 1, … } 就換；回傳現在的設定。 */
  phx: function (o) { if (typeof o === 'string') phxSet(o); else if (o) for (var k in o) PHX[k] = o[k]; if (o) phxSync(); return { level: phxLevel(), phx: JSON.parse(JSON.stringify(PHX)), phys: PHYS, rig: rigLv(), debris: DEB_KS[PHX.debris], fx: FX_KS[PHX.fx] }; },
  /** 帆桁追風的讀數：相對風吹去的方向、每根帆桁現在離正橫幾度（作品的角度＋追風轉的）。 */
  yards: function (i) { var sh = SHIPS[i || 0]; return { psi: sh.psi === undefined ? null : +(sh.psi * 57.3).toFixed(1), side: sh.braceSide || 0, ropes: sh.yRopes.length,
    yards: sh.yards.map(function (m) { return { name: m.name, kind: m.yk, deg: +((m.r0 + m.rot) * 57.3).toFixed(1), rot: +(m.rot * 57.3).toFixed(1), alive: m.alive }; }) }; },
  /** 量殉爆用：第 i 艘的第 k 間彈藥庫（0 後、1 前）。how：'keg' 點一桶（連鎖照血量走）、'mag' 整間直接殉爆。 */
  ignite: function (i, k, how) {
    var sh = SHIPS[i], mag = sh.mags[k]; if (!mag) return null;
    if (how === 'mag') magBoom(sh, mag); else { var m = mag.kegs.filter(function (x) { return x.alive; })[0]; if (m) ignite(sh, m, 0); }
    return this.powder(i);
  },
  /** 砲長的讀數：每艘的砲長、現在的模式、換過幾次、各模式的局勢分數。 */
  captain: function () { return SHIPS.map(function (sh) { var foe = foeOf(sh), v = {}; AIM_MODES.forEach(function (m) { v[m] = +aimValue(foe, m).toFixed(2); }); return { cap: sh.cap, mode: sh.aimMode, switches: sh.modes || 0, pMode: sh.pMode, value: v }; }); },
  /** 手持物的讀數：上一格畫了幾件、每艘現在誰拿著什麼。 */
  items: function () { return { drawn: ITEMS_N, ships: SHIPS.map(function (sh) { var r = {}; sh.crew.forEach(function (c) { var it = heldItem(sh, c, crewFrame(sh, c)); if (it) r[it.id] = (r[it.id] || 0) + 1; }); return r; }) }; },
  powder: function (i) { var sh = SHIPS[i]; return { never: powderNever(), hp: powderHP(), blast: BLAST_K, broken: !!sh.broken, cartBooms: sh.cartN || 0, keel: sh.keel || null, fate: sh.fate,
    mags: sh.mags.map(function (g) { return { name: g.name, lb: g.lb, kegs: g.kegs.length, alive: g.kegs.filter(function (m) { return m.alive; }).length, boomed: g.boomed, gone: g.gone, R: g.R ? +(g.R * S).toFixed(2) : 0, removed: g.removed || 0, broke: !!g.broke }; }),
    pieces: PIECES.map(function (p) { return { n: p.n, hull: !!p.hull, mods: (p.mods || []).length, y: +p.c[1].toFixed(2) }; }),
    stations: sh.stations.map(function (st) { return { name: st.name, at: st.at, kegs: st.kegs.filter(function (m) { return m.alive; }).length }; }) }; },
  /** 預備水手的讀數（42_hands.js）：走得到的甲板（走路格幾點、分成幾片）、梯子（兩頭在哪一層、爬過幾次）、人在哪一層、在做什麼、派了幾次、補上幾個。 */
  /** 走路格上一點是第幾層、哪一塊（42_hands.js navRegAt）；給兩點 ⇒ 再回直線走的人走不走得到（navReach）—— 量的時候用。 */
  riglog: function () { return rlgData(); },   // 帆繩記錄（85_riglog.js；?riglog=1 或設定面板的開關）
  crewlog: function () { return tlgData(); },   // 測試模式的船員記錄（83_testlog.js；?test=1 或設定面板的開關）
  navReg: function (i, p, q) { var sh = SHIPS[i || 0]; return q ? { a: navRegAt(sh, p), b: navRegAt(sh, q), reach: navReach(sh, p, q) } : navRegAt(sh, p); },
  hands: function (i) {
    var sh = SHIPS[i || 0], H = sh.nav; if (!H) return null;
    var hs = sh.crew.filter(function (c) { return c.role === ROLE.HAND; }), st = {}, on = {};
    hs.forEach(function (c) { var k = c.st ? 'down' : c.hand.climb ? 'climb' : c.hand.job ? 'job-' + c.hand.job.kind : c.hand.wp || c.hand.legs.length ? 'walk' : 'wait'; st[k] = (st[k] || 0) + 1; if (!c.st) { var n = H.levels[c.hand.lv].key; on[n] = (on[n] || 0) + 1; } });
    return { n: hs.length, states: st, on: on, called: H.called, joined: H.joined, ms: +H.ms.toFixed(1), home: H.levels[H.home].key, reach: H.reach.map(function (j) { return H.levels[j].key; }), gun0: H.gun0, pm0: H.pm0, helm0: H.helm0,
      levels: H.levels.map(function (L) { return { key: L.key, name: L.name, zr: L.zr, meta: !!L.deck, cells: L.N.cells.length, regs: L.N.regs, own: !!L.own }; }),
      ladders: H.ladders.map(function (L) { return { name: L.name, from: H.levels[L.lo].key + ':' + L.ra, to: H.levels[L.hi].key + ':' + L.rb, x: Math.round(L.x), used: L.n, broken: L.broken }; }),
      path: { n: H.pathN || 0, ms: +(H.pathMs || 0).toFixed(1) },
      idle: Object.keys(sh.idleG || {}).filter(function (k) { return sh.idleG[k].on; }), idleN: sh.idleN || 0, fromGun: sh.crew.filter(function (c) { return c.idleFrom; }).length,   // 閒著的砲班（TASK-0722 gunIdle）：哪幾組放出去了、放過幾人次、現在還記著從砲班來的
      refresh: { re: NAV_RE, n: H.refreshN || 0, ms: +(H.refreshMs || 0).toFixed(1), dirty: H.dirty, log: H.log } };   // 尋路動態更新（TASK-0572）
  },
  /** 落水求生的讀數（43_swim.js）：現在在水裡幾個（浮上來中／在游／在踩水／溺水沉下去中）、累計落水、救上來、溺水、被敵艦撈走／撈起敵艦的、名單上幾個人。 */
  swim: function (i) {
    var sh = SHIPS[i || 0], st = {};
    sh.crew.forEach(function (c) { if (c.st !== 5) return; var k = c.swim.dead ? 'sinking' : c.fv[1] > 0 ? 'rising' : c.fv[0] || c.fv[2] ? 'swimming' : 'treading'; st[k] = (st[k] || 0) + 1; });
    return { now: st, total: sh.swims || 0, saved: sh.saved || 0, drowned: sh.causes['溺水'] || 0, lostTo: sh.lostTo || 0, gained: sh.gained || 0, crew: sh.crew.length, drownT: DROWN_T };
  },
  /** 量落水用：第 i 艘最上面那層甲板上還能動的人，挑最靠舷邊的 n 個推下海（往舷外 3 m/s）。 */
  overboard: function (i, n) {
    var sh = SHIPS[i || 0], cy = sh.T.cy, out = sh.crew.filter(function (c) { return c.st === 0 && c.pos[2] >= sh.deckZ[sh.weatherDeck][0]; })
      .sort(function (a, b) { return Math.abs(b.pos[1] - cy) - Math.abs(a.pos[1] - cy); }).slice(0, n || 1);
    out.forEach(function (c) { var s = c.pos[1] >= cy ? 1 : -1; crewFall(sh, c, add(mul(norm(M4.dir(sh.M, 0, s, 0)), 3), [0, 2, 0])); });
    return out.length;
  },
  /** 補給的讀數：送藥手各自在做什麼、每門砲的藥箱。 */
  supply: function (i) { var sh = SHIPS[i]; var pm = sh.crew.filter(function (c) { return c.role === ROLE.POWDER; });
    return { monkeys: pm.length, able: pm.filter(crewAble).length, states: pm.reduce(function (a, c) { var s = c.st ? 'down' : c.pm.st; a[s] = (a[s] || 0) + 1; return a; }, {}),
      boxes: sh.guns.map(function (g) { return g.alive ? g.box : '✕'; }).join(''), waiting: sh.guns.filter(function (g) { return g.alive && g.needCart && !(g.box > 0); }).length, noDrop: sh.guns.filter(function (g) { return !g.drop; }).length }; },
  /** 鐵鍊（76_anchor.js）：第 i 艘每條鍊子的狀態、放出多長、這一步碰到船殼幾次（hit）、推完還穿在船殼裡幾節（pen 這一步／平均／最多；?chainhit=0 ⇒ 不推）、錨那一端的位置；ms ＝ 全部鍊子每一步平均幾毫秒。 */
  /** 帆的配方（TASK-0602 ①；29_sailrecipe.js）：第 i 艘每面照配方生的帆，跟成品裡雕刻引擎的頂點（還帶著才比得了）逐點差多少格；billow ＝ 最鼓那一點離四角平面幾格（兩邊各一個）。 */
  sailDev: function (i) {
    var T = SHIPS[i || 0].T;
    function bil(v, s) { var c = s.recipe.corners, n0 = c.length, cx = 0, cy = 0, cz = 0; c.forEach(function (p) { cx += p[0] / n0; cy += p[1] / n0; cz += p[2] / n0; });
      var nx = 0, ny = 0, nz = 0; for (var k = 0; k < n0; k++) { var a = c[k], b = c[(k + 1) % n0]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); }
      var L = Math.hypot(nx, ny, nz) || 1, m = 0; for (var q = 0; q < v.length / 2; q += 3) { var d = ((v[q] - cx) * nx + (v[q + 1] - cy) * ny + (v[q + 2] - cz) * nz) / L; if (Math.abs(d) > Math.abs(m)) m = d; } return +m.toFixed(1); }
    return { recipes: T.sailRecipes, ms: T.ms.sails, sails: T.rig.sails.filter(function (s) { return s.recipe; }).map(function (s) {
      var a = s.verts, b = s.verts0, r = { name: s.name, res: s.recipe.res, n: a.length / 6, billow: bil(a, s) };
      if (b) { var n = Math.min(a.length, b.length) / 6, mx = 0, sm = 0; for (var k = 0; k < n * 3; k += 3) { var d = Math.hypot(a[k] - b[k], a[k + 1] - b[k + 1], a[k + 2] - b[k + 2]); mx = Math.max(mx, d); sm += d; } r.same = a.length === b.length; r.maxDev = +mx.toFixed(1); r.meanDev = +(sm / n).toFixed(1); r.billow0 = bil(b, s); }
      return r; }) };
  },
  chains: function (i, reset) {
    var sh = SHIPS[i || 0], A = sh.anc, r = { ms: CH_PROF.steps ? +(CH_PROF.ms / CH_PROF.steps).toFixed(4) : 0, hit: CHAIN_HIT, lost: (sh.chLost || []).length };
    if (A) ['P', 'S'].forEach(function (k) { var c = A[k].ch; r[k] = c ? { st: A[k].st, pay: +c.pay.toFixed(1), hit: c.hit, pen: c.pen, penAvg: +(c.penSum / Math.max(1, c.steps)).toFixed(2), penMax: c.penMax, end: [c.p[CHAIN_SEG * 3], c.p[CHAIN_SEG * 3 + 1], c.p[CHAIN_SEG * 3 + 2]].map(function (v) { return +v.toFixed(1); }), y: [].filter.call(c.p, function (v, j) { return j % 3 === 1; }).map(function (v) { return +v.toFixed(1); }) } : A[k].st; });
    if (reset) CH_PROF = { ms: 0, steps: 0 };
    return r;
  },
  /** 帆的碰撞（TASK-0603）只數不推：每艘每面張著的帆，第一輪找到幾個接觸（三角形 × 碰到的船殼格／模型面／繩段）＝ 這一刻還穿著多少；量完把帆放回原樣。 */
  ccCount: function () { var keep = CC_PASS; CC_PASS = [1, 1]; var out = SHIPS.map(function (sh) { var n = 0, lk = 0, sails = 0; (sh.cl || []).forEach(function (c, k) { if (!c || sh.sails[k].furled || !c.p || c.hidden || c.gone || !c.T.mi) return; var p = Float32Array.from(c.p), q = Float32Array.from(c.q), w = c.contactWarm, cur = c.ccCur; c.ccCur = 0; clothContacts(sh, c); n += c.contactStats ? c.contactStats.first : 0; lk += c.contactStats ? c.contactStats.unsatisfiedPins : 0; sails++; c.p.set(p); c.q.set(q); c.contactWarm = w; c.ccCur = cur; }); return { hull: sh.T.id, sails: sails, contacts: n, locked: lk }; }); CC_PASS = keep; return out; },
  prof: function (reset) { var r = { cloth: +PROF.cloth.toFixed(1), rope: +PROF.rope.toFixed(1), shred: +PROF.shred.toFixed(1), buf: +PROF.buf.toFixed(1), cc: +PROF.cc.toFixed(1), ccN: PROF.ccN, ccHit: PROF.ccHit, ccQ: PROF.ccQ, ccMax: +PROF.ccMax.toFixed(1), flVis: FL_VISN ? +(FL_VISMS / FL_VISN).toFixed(3) : 0, flVisN: FL_VISN, perStep: +PHYS_MS.toFixed(3), survey: { n: SV_PROF.n, st: +SV_PROF.st.toFixed(1), cf: +SV_PROF.cf.toFixed(1), tk: +SV_PROF.tk.toFixed(1) } }; if (reset) SV_PROF = { n: 0, st: 0, cf: 0, tk: 0 }; if (reset) PROF = { cloth: 0, rope: 0, shred: 0, buf: 0, cc: 0, ccN: 0, ccHit: 0, ccQ: 0, ccMax: 0, ccGeo: 0 }; return r; },   // cc／ccN／ccHit：帆的碰撞（TASK-0603）
  /** 帆的命中判定（21_gunnery.js cutRig；只量不動）：第 i 艘第 k 面帆，彈點 L（格座標）照布現在的形狀算不算打中（cloth；沒在模擬 ⇒ null）、照作品的帆形算不算（work）。chain ⇒ 鏈彈的距離。 */
  sailHit: function (i, k, L, chain) {
    var sh = SHIPS[i || 0], s = sh.sails[k], v = s.verts, sb = s.bb, rb = chain ? 8 : 4, rs2 = chain ? 64 : 16, cl = clothLive(sh, s);
    var y0 = s.yards && s.yards[0], aH = y0 ? y0.rot : 0, aF = s.footYard ? s.footYard.rot : 0, a = aF + (aH - aF) * clamp((L[2] - sb[2]) / Math.max(1, sb[5] - sb[2]), 0, 1), Ls = y0 && a ? rotZ(L, y0.piv, -a) : L, w = false;
    for (var j = 0; j < v.length; j += chain ? 9 : 3) { var dx = v[j] - Ls[0], dy = v[j + 1] - Ls[1], dz = v[j + 2] - Ls[2]; if (dx * dx + dy * dy + dz * dz < rs2) { w = true; break; } }
    return { cloth: cl ? clothNear(cl, L, rb) : null, work: w };
  },
  /** 帆與繩的讀數：每面帆最鼓的那一點離雕刻作品形狀多遠（格）、還綁著幾個點、垂下來的繩幾條。 */
  cloth: function (i) {
    var sh = SHIPS[i || 0];
    return { templates: sh.T.cloth.map(function (T) { return { name: T.name, n: T.n, sim: T.sim.n, grid: T.grid, simEdges: T.sim.ea.length, simPins: Array.prototype.filter.call(T.sim.hk, function (x) { return x; }).length, pins: T.pins, clews: T.clews, sides: T.sides }; }),
      sails: sh.cl.map(function (c, k) {
        var d = 0, P0 = c.T.sim.p0; if (c.p) for (var j = 0; j < c.T.sim.n * 3; j += 3) d = Math.max(d, Math.hypot(c.p[j] - P0[j], c.p[j + 1] - P0[j + 1], c.p[j + 2] - P0[j + 2]));
        return { name: c.T.name, live: !!c.p && !c.hidden && !c.gone, loose: !!c.loose, torn: !!c.torn, pins: c.npin, maxMove: +d.toFixed(2) };
      }),
      loose: sh.loose.length, loosePinned: sh.loose.filter(function (o) { return o.pin[0] || o.pin[o.n - 1]; }).length, loosePts: sh.loose.reduce(function (a, o) { return a + o.n; }, 0),
      shreds: (sh.shreds || []).length, shredWet: (sh.shreds || []).filter(function (f) { return f.wet; }).length, shredPts: (sh.shreds || []).reduce(function (a, f) { return a + f.n; }, 0), shredCut: SH_STAT.cut, shredTris: SH_STAT.tris };   // 布片（34_shreds.js）：現在幾片、落水幾片、開局以來切了幾片
  },
  report: function () { return rptData(); },                          // 戰鬥報表（79_report.js）：整份；?report=0 ⇒ null
  stats: function () { return { t: +SIMT.toFixed(2), ships: SHIPS.map(function (s) { return { lost: s.lost, count: s.grid.count, quads: s.rs.quads(), sink: +s.sink.toFixed(3), lift: +s.lift.toFixed(3), massLost: +massLost(s).toFixed(1), mass0: Math.round(s.mass0 || 0), roll: +s.rollA.toFixed(3), inflow: s.inflow, water: s.fl ? +(s.fl.vol * RHO_W).toFixed(1) : undefined, guns: s.gunsAlive, masts: s.masts.map(function (m) { return m.name + (m.up ? '✓' : '✗'); }).join(' '), fired: s.fired, hits: s.hits, ropesDead: s.ropes.filter(function (r) { return r.dead; }).length, sailsDead: s.sails.filter(function (x) { return x.dead; }).length,
    crew: s.crew0, able: s.able, wounded: s.wounded, dead: s.dead, causes: s.causes, manned: s.gunsManned, struck: s.struck, fate: s.fate,
    knots: +(s.spd * 1.944).toFixed(2), yaw: +s.yaw.toFixed(3), x: +s.px.toFixed(1), z: +s.pz.toFixed(1), sail: +s.sailFrac.toFixed(3), point: s.pos,
    side: s.side, manual: s.manual, rudder: +s.rudder.toFixed(2), sailSet: SAILSETS[s.sailSet] }; }), over: OVER, end: OVER ? $('endT').textContent : '', pieces: PIECES.map(function (p) { return p.n; }), debris: D.n, pts: PT.n, balls: BALLS.length, masts: SHIPS.length ? SHIPS[0].T.masts : [] }; }
};
/** 讀數的一段：這艘船是讀快取還是現場解析（06_cache.js）。 */
function cacheText(st) { return !st ? '' : st.hit ? '（讀快取 ' + (st.readMs / 1000).toFixed(2) + ' 秒）' : '（現場解析；' + st.why + '）'; }
if (DEBUG) {
  /** 快取對拍：船型 id 讀回的那幾份 ＝ 現在這份程式現場算的？逐位元組比（船體網格每個區塊、模型網格的頂點與佔用格、海面遮罩、浮力表、布模板）。 */
  window.__game.hullCheck = function (id) {
    var T = HULLT[id || myHull()]; if (!T) return null;
    function same(a, b) {
      if (a === b) return true;
      if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) { if (a.length !== b.length || a.constructor !== b.constructor) return false; for (var i = 0; i < a.length; i++) if (a[i] !== b[i] && !(a[i] !== a[i] && b[i] !== b[i])) return false; return true; }
      if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return a !== a && b !== b;
      var ka = Object.keys(a), kb = Object.keys(b); if (ka.length !== kb.length) return false;
      return ka.every(function (k) { return same(a[k], b[k]); });
    }
    var g = T.hullG, r = { id: T.id, cached: T.cached, chunks: 0, chunkDiff: 0, quads: T.pristine.quads() };   // 合併網格照船殼（砲帶的裝甲拆掉之後，24_armor.js）
    for (var cz = 0; cz < g.nz; cz++) for (var cy = 0; cy < g.ny; cy++) for (var cx = 0; cx < g.nx; cx++) {
      var i = g.ci(cx, cy, cz); if (g.tab[i] === null) continue;
      var m = VK.meshChunk(g, cx, cy, cz), c = T.pristine.meshes.get(i); r.chunks++;
      if (!(m ? c && same(m, c) : !c)) r.chunkDiff++;
    }
    r.hullMask = same(hullMask(T), T.hullHB);
    var H = { base: T.base, zw: T.zw }; hydrostatics(H); r.hyd = same(H.hyd, T.hyd) && H.disp === T.disp;
    r.models = (T.rig.meshes || []).map(function (m, k) {
      var sf = T.meshes[k] && T.meshes[k].share, tri = sf !== undefined ? meshTriFor(T, sf, T.rig.meshes[sf]) : meshTriFor(T, k, m), got = new Float32Array(tri.length); gl.bindBuffer(gl.ARRAY_BUFFER, T.meshes[k].vbo); gl.getBufferSubData(gl.ARRAY_BUFFER, 0, got);   // 共用別份的（只差起點）⇒ 照那一份比
      return same(tri, got) && same(meshOcc(m), T.meshes[k].occ);
    }).filter(function (ok) { return !ok; }).length + ' 份不同／' + (T.rig.meshes || []).length;
    r.rbox = same(T.rig.ropes.map(function (rp) { return ropeBox(rp.pts); }), T.rbox);
    r.cloth = T.rig.sails.map(function (s, k) { return same(clothTemplate(T, s), T.cloth[k]); }).filter(function (ok) { return !ok; }).length + ' 面不同／' + T.rig.sails.length;
    return r;
  };
}
var loadT0 = performance.now();
function loadSay(s) { bootSay(s); }   // 主選單的那一行字（外殼；00_events.js boot:say）
loadSay('解碼船體…');
// GL 的著色器、共用網格（2026-10-20）：?map=@host 開在 Blocksail 地球儀的 iframe 裡、跟它同一條主執行緒 ⇒ 載入頁面那一段（解析＋執行整包程式）越短越好；
//   有畫面迴圈（BED_SLICE）⇒ 一樣一樣分開做、每樣之間讓出一次（yieldUI），做完才開畫面迴圈、開始載船；快轉、無頭、?pick ⇒ 照舊當場做。
var GL_STEPS = [programs, geometry, wpGL, flGL, rdGL, bbSetup, function () { QIDX = new VK.QuadIndex(gl); }];
var GL_READY = BED_SLICE && !PICK_HOST ? GL_STEPS.reduce(function (p, f) { return p.then(yieldUI).then(function () { f(); }); }, Promise.resolve()) : (stepsRun(GL_STEPS), Promise.resolve());
hullSay = function (s) { evEmit('boot:hull', '解析' + s); };   // 解析中：開戰鈕寫進度（設定照樣能調）
if (!HEADLESS && !PICK_HOST) GL_READY.then(function () { requestAnimationFrame(frame); });   // 無頭（00_events.js）不開畫面迴圈；解析中也畫（天、海；船載好才有）
/** 編成裡的船全部進了 HULLT 才放行：等完一輪再照**現在的**編成看一次，還有不在的 ⇒ 再等一輪。
 *  ⛔ 只等開頭那一份名單：解析中主選單換了我艦（pickShip）⇒ 名單裡的都回來了，HULLT[我艦] 卻還沒有
 *  ⇒ 下面讀 T.h ⇒「載入失敗：Cannot read properties of undefined (reading 'h')」（Tim 2026-10-20 回報；重現：?prefs=0&cache=0&blue=dromon&red=dromon，一進主選單把我艦換成拿破崙號）。 */
function fleetLoaded() {
  var ids = fleetHulls().concat(coreHulls());                       // coreHulls：?coreadd= 要中途加的船（57_core.js）
  return Promise.all(ids.map(loadHull)).then(function () { return fleetHulls().concat(coreHulls()).every(function (id) { return HULLT[id]; }) ? null : fleetLoaded(); });
}
if (PICK_HOST) pickBoot();                                          // ?pick=@host（72_shippick.js）：只開選船彈窗，不載編成、不開主選單
else GL_READY.then(yieldUI).then(function () {                     // 先讓主選單畫出來，再開始解析
  return Promise.all([fleetLoaded(), bedBoot()]);                   // 只載編成裡的船（預設兩艘都是憲法號 ⇒ 一份）＋海圖（?map，08_seabed.js）
}).then(function () {
  var T = HULLT[myHull()], h = T.h, chk = T.chk;
  evEmit('boot:loaded');                     // ?start=1：主選單不會出來 ⇒ 先不重畫（回到主選單時才補，71_input.js coverShow）
  var line = '1:1 ' + T.name + ' ' + chk.voxels.toLocaleString() + ' 格 checksum ' + chk.checksum.toString(16) + (chk.ok ? '（＝ 封裝檔 header，逐格相同 ✓）' : '（✗ 跟封裝檔對不上：' + h.voxels + '／' + h.checksum.toString(16) + '）') +
    '\n合併後 ' + T.pristine.quads().toLocaleString() + ' 個四邊形、繩 ' + T.rig.ropes.length + '、帆 ' + T.rig.sails.length + '、桅 ' + T.masts.length +
    '\n解碼 ' + (T.decodeMs / 1000).toFixed(2) + ' 秒、網格化 ' + (T.meshMs / 1000).toFixed(2) + ' 秒' + cacheText(hullInfo(T.id).cache) +
    '\n設定：' + PREFS.state;
  loadSay(line); window.__vxk = { verify: chk, quads: T.pristine.quads(), masts: T.masts.length, decodeMs: +T.decodeMs.toFixed(1), meshMs: +T.meshMs.toFixed(1), ms: T.ms,
    cache: hullInfo(T.id).cache, prefs: PREFS.state,
    deco: { on: !!GFX.deco, n: T.decoN || 0, drawn: GFX.deco ? T.decoN || 0 : (T.decos || []).filter(function (d) { return d.meta && d.meta.kind === 'portlid'; }).length, meshes: T.meshes.filter(Boolean).length, tris: T.meshes.reduce(function (a, m) { return a + (m && m.n ? m.n / 3 : 0); }, 0) } };   // 裝飾（TASK-0682）：開關、作品裡幾件、畫幾件（一律載入，關著 ⇒ 只剩砲門蓋板：每艘、每個畫質都畫，S14）、建了幾份模型網格、三角形
  loadArt().then(function (why) { line += '\n素材：' + why; loadSay(line); window.__vxk.art = why; if (HUD_ART) hudArt(); });
  if (!chk.ok) { glFail('船體資料跟封裝檔對不上，停下來（不畫半艘船）。\n' + line); return; }
  evEmit('boot:ready');
  if (Q.has('shipcheck')) { shipCheck(Q.get('shipcheck')); return; }
  if (LAB_FLEET) { flabInit(); return; }                                // 擬真沙盒（84_fleetlab.js）   // 匯入檢查（75_shipcheck.js；admin.py check 用無頭 Chrome 讀）
  if (Q.get('lab') === 'flood') { var FR = floodLab(flLabOpts()), fp = document.createElement('pre'); fp.id = 'lab'; document.body.appendChild(fp); fp.textContent = JSON.stringify(FR); uiAway(); return; }   // 沙盒進水報表（81_floodlab.js；src/tests/flood_lab.py）
  if (Q.get('lab') === 'wrooms') { var WO = {}; ['dz', 'px'].forEach(function (k) { if (Q.has(k)) WO[k] = +Q.get(k); }); var WR = wroomsLab(T, WO), wp = document.createElement('pre'); wp.id = 'lab'; document.body.appendChild(wp); wp.textContent = JSON.stringify(WR); uiAway(); return; }   // 水的房間的報表（81_floodlab.js wroomsLab；src/tests/wrooms_lab.py 讀 #lab）
  if (Q.get('lab') === 'wdrop') { var DO = {}; ['hz', 'k', 'per'].forEach(function (k) { if (Q.has(k)) DO[k] = +Q.get(k); }); var DR = wdropLab(DO), dp = document.createElement('pre'); dp.id = 'lab'; document.body.appendChild(dp); dp.textContent = JSON.stringify(DR); uiAway(); return; }   // 粒子不穿甲板（81_floodlab.js wdropLab；TASK-0808）
  if (Q.get('lab') === 'wslosh') { var SO = {}; ['hz', 'room', 'depth', 'slope', 'dur'].forEach(function (k) { if (Q.has(k)) SO[k] = +Q.get(k); }); if (Q.has('wsimo')) SO.wsimo = Q.get('wsimo').split(',').filter(function (w) { return w; }); var SR = wsloshLab(SO), sp2 = document.createElement('pre'); sp2.id = 'lab'; document.body.appendChild(sp2); sp2.textContent = JSON.stringify(SR); uiAway(); return; }   // 高度場在 0.1 秒一步穩不穩（81_floodlab.js wsloshLab；TASK-0808 驗收第 2 格）
  if (Q.get('lab') === 'wpair') { var PO = {}; ['hz', 'op', 'ha', 'hb', 'dur'].forEach(function (k) { if (Q.has(k)) PO[k] = +Q.get(k); }); var PR = wpairLab(PO), pp2 = document.createElement('pre'); pp2.id = 'lab'; document.body.appendChild(pp2); pp2.textContent = JSON.stringify(PR); uiAway(); return; }   // 夾到拉平 ⇒ 不來回穿越（81_floodlab.js wpairLab；TASK-0808 驗收第 8 格）
  if (Q.get('lab') === 'uw') { var LR = uwLab(labOpts()), lp = document.createElement('pre'); lp.id = 'lab'; document.body.appendChild(lp); lp.textContent = JSON.stringify(LR); uiAway(); return; }   // 落水彈道的測試場（80_lab.js；src/tests/uw_lab.py 讀 #lab）
  if (DEMO >= 0) {                                             // 快轉：電腦對電腦、固定步長；?mode= 換玩法（TASK-0668 對拍對戰、沙盒用；沒給 ＝ 觀戰）
    flowMode(Object.prototype.hasOwnProperty.call(MODE_RULES, Q.get('mode')) ? Q.get('mode') : 'eve'); reset(); flowRun(true);
    var steps = Math.round(DEMO / DT), phys = PHYS, from = Math.max(0, steps - everySteps(6)), H5 = everySteps(0.5);   // H5：半秒幾步（60 Hz ＝ 以前寫死的 30；TASK-0798）     // 帆與繩只畫最後那一格 ⇒ 物理只在最後 6 秒跑（不影響戰局）
    if (phys && from > 0) setPhys(false);
    // ?dump=1：每半秒記每艘的最大橫傾、開始沉／沉沒／降旗的時間，跑完寫進頁面（#dump；無頭 Chrome --dump-dom 讀，量進水模式用）
    var rec = Q.get('dump') === '1' ? SHIPS.map(function () { return { maxList: 0, maxPre: 0, maxSinkPre: 0, final: null, sunk: null, struck: null }; }) : null, downAt = { blue: null, red: null };
    var PFB = rec && Q.get('prof') === '1' ? { n: 0, ms: 0, max: 0 } : null;   // ?prof=1：物理那 6 秒每步花多久（step 整個）＋ PROF（帆的碰撞 TASK-0603 量效能用；不加這個參數 ⇒ dump 跟以前一樣）
    var CQ = Q.get('core') === '1' ? { add: coreAddQ(), added: [] } : null;   // ?core=1：跑完寫戰後狀態（#core，57_core.js）；?coreadd=red:monitor@60 到那一秒中途加船
    var RC = rec && Q.get('ropecheck') === '1' ? SHIPS.map(function (sh) { return { hull: sh.T.id, stat: ropeAuditStatic(sh), seen: {}, float: [] }; }) : null;   // 繩的檢查（ropecheck.py）
    for (var i = 0; i < steps; i++) {
      if (phys && i === from && from > 0) setPhys(true);
      if (PFB && i === from) PROF = { cloth: 0, rope: 0, shred: 0, buf: 0, cc: 0, ccN: 0, ccHit: 0, ccQ: 0, ccMax: 0, ccGeo: 0 };
      if (CQ) CQ.add.forEach(function (a) { if (!a.done && SIMT >= a.t) { a.done = true; var me = SHIPS.filter(function (s) { return s.team === a.team; })[0] || SHIPS[0], pre = SHIPS.map(function (s) { return [s.px, s.pz, s.yaw, s.grid.count, s.sink]; });
        var nw = coreAdd({ team: a.team, hull: a.hull, x: me.px + 250, z: me.pz + (a.team === 'blue' ? 150 : -150) }); if (nw && rec) rec.push({ maxList: 0, maxPre: 0, maxSinkPre: 0, final: null, sunk: null, struck: null });   // ?dump 的每艘紀錄：開局就定好長度 ⇒ 加的那艘補一筆
        var post = SHIPS.slice(0, pre.length).map(function (s) { return [s.px, s.pz, s.yaw, s.grid.count, s.sink]; });
        CQ.added.push({ t: +SIMT.toFixed(2), hull: a.hull, team: a.team, i: nw ? nw.i : -1, ms: nw ? nw.addMs : null, same: JSON.stringify(pre) === JSON.stringify(post) }); } });
      var tb0 = PFB && i >= from ? performance.now() : 0; simStep(); if (PFB && i >= from) { var tb1 = performance.now() - tb0; PFB.n++; PFB.ms += tb1; PFB.max = Math.max(PFB.max, tb1); }
      if (i % H5 === H5 - 1 && !HEADLESS) remesh(Infinity);   // 無頭：不建網格（00_events.js）
      if (rec && i % H5 === H5 - 1) SHIPS.forEach(function (sh, k) { var r = rec[k]; r.maxList = Math.max(r.maxList, Math.abs(sh.rollA)); if (!sh.sinkingFinal) { r.maxPre = Math.max(r.maxPre, Math.abs(sh.rollA)); r.maxSinkPre = Math.max(r.maxSinkPre, sh.sink); r.maxPctPre = Math.max(r.maxPctPre || 0, floodPct(sh)); } if (sh.sinkingFinal && r.final === null) r.final = +SIMT.toFixed(1); if (sh.sunk && r.sunk === null) r.sunk = +SIMT.toFixed(1); if (sh.struck && r.struck === null) r.struck = +SIMT.toFixed(1); });
      if (rec && i % H5 === H5 - 1) SHIPS.forEach(function (sh, k) { var r = rec[k]; if (!isOut(sh)) { r.modeT = r.modeT || {}; r.modeT[sh.aimMode || '-'] = (r.modeT[sh.aimMode || '-'] || 0) + 0.5; } });
      // 每 10 秒一筆：[秒, 帆 sailFrac, 倒桅, 打中幾發, 航速, 砲剩幾成, 人剩幾成, 離最近還在打的敵艦 m]（沙盒照這個校準）
      if (rec && i % 600 === 599) { var CVt = cmdView('blue').ships;
        SHIPS.forEach(function (sh, k) { var nf = SHIPS.reduce(function (a, o) { return isFoe(sh, o) && !isOut(o) ? Math.min(a, Math.hypot(o.px - sh.px, o.pz - sh.pz)) : a; }, 1e9);
          (rec[k].tl = rec[k].tl || []).push([Math.round(SIMT), +sh.sailFrac.toFixed(3), sh.masts.filter(function (m) { return !m.up; }).length, sh.hits, +sh.spd.toFixed(2), +CVt[k].guns.toFixed(3), +CVt[k].crew.toFixed(3), nf < 1e9 ? Math.round(nf) : null]); }); }
      if (rec && i % H5 === H5 - 1) ['blue', 'red'].forEach(function (tm) { if (downAt[tm] === null && teamDown(tm)) downAt[tm] = +SIMT.toFixed(1); });
      if (RC && i % H5 === H5 - 1) SHIPS.forEach(function (sh, k) { if (sh.sink > 40) return; ropesFloating(sh).forEach(function (f) { var key = f.name + '#' + f.end; if (RC[k].seen[key]) return; RC[k].seen[key] = 1; RC[k].float.push({ t: +SIMT.toFixed(1), name: f.name, end: f.end, kind: f.kind, why: f.why, P: f.P }); }); });
    }
    if (!HEADLESS) remesh(Infinity); flowRun(false); uiAway();
    if (TLOG && Q.get('test') === '1') { var pre4 = document.createElement('pre'); pre4.id = 'crewlog'; document.body.appendChild(pre4); pre4.textContent = JSON.stringify(tlgData()); }   // 測試模式（83_testlog.js；src/tests/crew_log.py 讀）：另外一塊，#dump 照舊
    if (CQ) { var pre5 = document.createElement('pre'); pre5.id = 'core'; document.body.appendChild(pre5); var CO = coreOut(); CO.added = CQ.added; pre5.textContent = JSON.stringify(CO); }
    if (RC) { var pre2 = document.createElement('pre'); pre2.id = 'ropecheck'; document.body.appendChild(pre2); pre2.textContent = JSON.stringify(RC.map(function (c) { return { hull: c.hull, stat: c.stat, float: c.float }; })); }
    if (rec) { var pre = document.createElement('pre'); pre.id = 'dump'; document.body.appendChild(pre);
      var CV = cmdView('blue').ships, pow = { blue: 0, red: 0 }; CV.forEach(function (v) { if (!v.out) pow[v.team] += cmdStrength(v); });
      if (PFB) { var pre3 = document.createElement('pre'); pre3.id = 'prof'; document.body.appendChild(pre3); pre3.textContent = JSON.stringify({ steps: PFB.n, msStep: +(PFB.ms / Math.max(1, PFB.n)).toFixed(3), maxStep: +PFB.max.toFixed(2), cloth: +PROF.cloth.toFixed(1), cc: +PROF.cc.toFixed(1), ccN: PROF.ccN, ccHit: PROF.ccHit, ccQ: PROF.ccQ, ccMax: +PROF.ccMax.toFixed(2), ccGeo: +PROF.ccGeo.toFixed(1) }); }
      pre.textContent = JSON.stringify({ seed: SEED, t: +SIMT.toFixed(1), flood: FLOOD_LV, wind: { rot: +(WIND_ROT * 57.2958).toFixed(1), s0: +WIND_S0.toFixed(3) }, cmd: CMD_SIDE, down: downAt, pow: { blue: +pow.blue.toFixed(3), red: +pow.red.toFixed(3) }, ships: SHIPS.map(function (sh, k) { var r = rec[k];
        return Object.assign({ team: sh.team, str: CV[k].out ? 0 : +cmdStrength(CV[k]).toFixed(3), maxListDeg: +(r.maxList * 57.3).toFixed(1), maxPreDeg: +(r.maxPre * 57.3).toFixed(1), maxSinkPre: +r.maxSinkPre.toFixed(2), maxPctPre: Math.round((r.maxPctPre || 0) * 100), final: r.final, sunk: r.sunk, struck: r.struck, fate: sh.fate, lost: sh.lost, hits: sh.hits, dead: sh.dead, cart: sh.cartN || 0, magGone: sh.mags.filter(function (m) { return m.gone; }).length, mastsDown: sh.masts.filter(function (m) { return !m.up; }).length, sink: +sh.sink.toFixed(2), water: sh.fl ? Math.round(sh.fl.vol * RHO_W) : null, area: sh.fl ? +sh.fl.area.toFixed(1) : null, inflow: sh.inflow, sail: +sh.sailFrac.toFixed(3), fired: sh.fired, fireDn: sh.fireDn || 0, fireUp: sh.fireUp || 0, hitDn: sh.hitDn || 0, hitUp: sh.hitUp || 0, modeT: r.modeT || {}, tl: r.tl || [] }, sh.med ? { med: { carried: sh.med.carried, healed: sh.med.healed, out: sh.med.out } } : {}, sh.carp ? { carp: { lad: sh.carp.lad, holes: sh.carp.holes, cells: sh.carp.cells } } : {}, sh.sm ? { sm: { sails: sh.sm.sails, hp: sh.sm.hp, ropes: sh.sm.ropes } } : {},
          sh.galley ? { galley: galleyDump(sh) } : {},   // galley：有廚房才有（45_galley.js；TASK-0720）；?galley=0、沒有廚房 ⇒ 沒有這一節
          sh.idleN ? { idleN: sh.idleN } : {},   // 閒著的砲班調去補位幾人次（TASK-0722；沒調過 ⇒ 不寫 ⇒ dump 跟以前一樣）
          sh.burn ? { burn: { ign: sh.burn.ignN, out: sh.burn.outN, gone: sh.burn.goneN, thru: sh.burn.thruN, peak: sh.burn.maxN, now: sh.burn.n, sails: sh.burn.sailN, sailGone: sh.burn.sailGoneN, sailOut: sh.burn.sailOutN } } : {},   // burn：著過火才有（49_burn.js）
          Q.get('cas') === '1' ? { cas: { wounds: sh.wounds, dead: sh.dead, gunCrewHit: sh.gunCrewHit || 0, causes: sh.causes } } : {}); }) });   // med：有醫療艙才有；cas：?cas=1 才有（傷亡與原因，量 TASK-0568 砲班受傷）—— 都沒有 ⇒ 跟以前逐字相同
      if (Q.get('report') === '1') { var dj = JSON.parse(pre.textContent); dj.report = rptData(); pre.textContent = JSON.stringify(dj); } }   // ?report=1：帶戰鬥報表（79_report.js；src/report.py 讀它）—— 沒帶 ⇒ 跟以前逐字相同
    window.__vxk.demo = { t: SIMT, lost: SHIPS.map(function (s) { return s.lost; }), pieces: PIECES.length, debris: D.n };
  } else {
    // 選單後面先擺好兩艘船當背景；?start=1（外部開戰，70_flow.js）跳過主選單 ⇒ 不擺（開戰時 reset 本來就再擺一次；以前擺兩次、跟開戰擠在同一段卡 0.4 s）
    if (START_Q) startWhenReady();
    else reset();
  }
}).catch(function (e) { glFail('載入失敗：' + (e && e.message || e)); console.error(e); });
