// ───────────────────────── 船員（billboard） ─────────────────────────
// 一個人 ＝ 一張面向鏡頭、但永遠直立的貼圖。位置存格座標（腳底那一格的上緣），畫的時候用船的矩陣換到世界。
// 砲要有人操作：人數 < 最少人數就不能開；裝填速度 ∝ (人數／滿編)^0.85。死傷的人不再操作；
// 人不夠時，倖存者集中到還開得動的砲 ⇒ 其餘的砲沒人操作（HUD ○）。調度見 reassign。
var ROLE = { GUN: 0, POWDER: 1, OFFICER: 2, MARINE: 3, TOP: 4, HELM: 5, HAND: 6, SURGEON: 7, CARPENTER: 8, SAILMAKER: 9, OAR: 10, COOK: 11, NAVIGATOR: 12, QUARTERMASTER: 13 }, NROLE = 6;   // NROLE：貼圖照職位的列數（HAND 預備水手沒有自己那一列，畫成砲手；42_hands.js）
var FR = { IDLE: 0, WORK_A: 1, WORK_B: 2, FIRE: 3, RUN_A: 4, RUN_B: 5, WOUNDED: 6, DEAD: 7 }, NFR = 8;
// 砲班：滿編／最少照砲種表（GUNS 的 crew／min，10_ship.js）—— 兩舷各一班；24 磅長砲一班 12 人＋送藥童 ⇒ 一個人物約兩人
// Tim 2026-10-12：砲班減一人（長砲 6 → 5、追擊砲 4 → 3），多出來的去搬火藥與彈藥（送藥手，23_powder.js）；射速照舊（裝填 ∝ 在崗／滿編）
var ROLE_NAME = ['砲手', '送藥手', '軍官', '陸戰隊', '桅頂水手', '舵手', '水手', '船醫', '木匠', '帆匠', '槳手', '廚師', '航海士', '軍需官'];   // 廚師（TASK-0720，45_galley.js）：貼圖用 ART_COOK 那一列   // 帆匠（47_sailmaker.js）；槳手（TASK-0691）：貼圖照砲手那一列（c.art）   // 船醫（TASK-0676）：貼圖用 ART_NURSE 那一列（44_medic.js medSurgeons）
var ART_CAPTAIN = 6, NART = 13;                   // 貼圖的列：0–5 照職位，6 船長（每艘船第一個軍官；職位照舊是軍官），7–12 Sirius 的六位（下一行）
var ART_NURSE = 7, ART_CARPENTER = 8, ART_COOK = 9, ART_SAILMAKER = 10, ART_NAVIGATOR = 11, ART_QUARTERMASTER = 12;   // 新職位（TASK-0676）的貼圖列；職位接上之前沒有人用
function standZ(g, x, y, z0, z1, head) {          // (x, y) 這一柱裡，z0..z1 之間可以站的高度（腳下實心、頭上 head 格空）；沒有 ⇒ -1
  for (var z = z1; z >= z0; z--) {
    if (!g.get(x, y, z - 1) || g.get(x, y, z)) continue;
    var ok = true;
    for (var h = 1; h < head; h++) if (g.get(x, y, z + h)) { ok = false; break; }
    if (ok) return z;
  }
  return -1;
}
var CREW_BLOCK = [];                               // 站位要避開的模型（砲、舵輪）：外框外擴 1 格、而且高度對得上那一層甲板
// 比一層甲板高的模型（舵：船底一路到下層砲甲板）只看站的那一段（腳到頭，CREW_SLAB 格）佔了哪裡。
// ⛔ 照整個外框 ⇒ 舵改成模型之後（2026-10-16 重匯），舵葉的寬（5.5 m）佔掉餘燼號下層兩門船尾追擊砲的站位（2／3 人）；矮的照舊用外框 ⇒ 其他模型一位元不動
var CREW_TALL = 20, CREW_SLAB = 14;
function blockFoot(M, z) {                         // 模型 M 在 z..z+CREW_SLAB 那一段的佔用格外框 [x0, y0, x1, y1]（格座標；網格 occ 已外擴 1 格）；那一段沒有 ⇒ null；沒有 occ ⇒ true（照外框）
  var C = M.footZ || (M.footZ = {}); if (C[z] !== undefined) return C[z];
  var oc = M.T.meshes && M.T.meshes[M.mesh] && M.T.meshes[M.mesh].occ; if (!oc || !M.origin) return (C[z] = true);
  var o = M.origin, lo = [1e9, 1e9], hi = [-1e9, -1e9];
  for (var k = Math.max(0, z - o[2] + 1); k < oc.nz && o[2] + k - 1 <= z + CREW_SLAB; k++)
    for (var j = 0; j < oc.ny; j++) for (var i = 0; i < oc.nx; i++) if (oc.a[i + oc.nx * (j + oc.ny * k)]) {
      lo[0] = Math.min(lo[0], i); lo[1] = Math.min(lo[1], j); hi[0] = Math.max(hi[0], i); hi[1] = Math.max(hi[1], j);
    }
  return (C[z] = lo[0] > hi[0] ? null : [o[0] + lo[0] - 1, o[1] + lo[1] - 1, o[0] + hi[0] - 1, o[1] + hi[1] - 1]);
}
function blocked(x, y, z) {
  for (var i = 0; i < CREW_BLOCK.length; i++) {
    var M = CREW_BLOCK[i], b = M.bb;
    if (x >= Math.floor(b[0]) - 1 && x <= Math.ceil(b[3]) + 1 && y >= Math.floor(b[1]) - 1 && y <= Math.ceil(b[4]) + 1 && z >= b[2] - 3 && z <= b[5]) {
      if (b[5] - b[2] <= CREW_TALL) return true;
      var f = blockFoot(M, z);
      if (f === true || (f && x >= f[0] && x <= f[2] && y >= f[1] && y <= f[3])) return true;
    }
  }
  return false;
}
function standNear(g, x, y, z0, z1, head, taken, rmax) {   // (x, y) 附近 rmax 格內（沒給 ＝ 4）找一個可以站、還沒人站、不在模型裡的位置
  for (var r = 0; r <= (rmax || 4); r++) for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    var k = (x + dx) + ',' + (y + dy); if (taken[k]) continue;
    var z = standZ(g, x + dx, y + dy, z0, z1, head);
    if (z >= 0 && !blocked(x + dx, y + dy, z)) { taken[k] = 1; return [x + dx + 0.5, y + dy + 0.5, z]; }
  }
  return null;
}
/** 船員站位、走路格要避開的模型（makeCrew 一開始設成 CREW_BLOCK；42_hands.js crewNavSteps 先建走路格也照它）。
 *  規格表 block：取用點的桶在甲板上 ⇒ 要避（彈藥庫裡的不擋）；門、艙蓋 ＝ 通道（25_doors.js）⇒ 不避。 */
function crewBlockOf(sh) { return sh.models.filter(function (m) { var b = kindProp(m.kind, 'block', true); return b === true || (b === 'station' && !!m.station); }); }
function makeCrew(sh) {
  var g = navBase(sh.T), CY = sh.T.cy, HULL_X0 = sh.T.hx0, HULL_X1 = sh.T.hx1, taken = {}, crew = [];
  sh.cw = shipCrew(sh.T.id); sh.pmWant = 0;                          // 船員配置（05_hull.js：預設 ← 船隻配置頁）；pmWant：送藥手該有幾個（23_powder.js makeMonkeys 數）
  // ⛔ 以前用平面的 taken 標模型外框：長砲改成模型之後，砲甲板的砲把上面 spar deck 的站位也佔掉了；火藥桶（艙底）更把大半個平面佔掉
  CREW_BLOCK = crewBlockOf(sh);
  function add(role, at, gun, face) { if (at) crew.push({ role: role, home: at, pos: at.slice(), gun: gun, face: face || 1, st: 0, t: rnd() * 10, walk: null, fireT: 0, shotT: rr(2, 6), lost: 0, hp: CREW_HP, hitT: 0 }); }
  sh.guns.forEach(function (gn) {
    var b = gn.model.bb.map(Math.floor), z0, z1, i, n = Math.min(gunCrew(sh.cw, gn.type), GUN_CREW_MAX);   // 砲班滿編（船隻配置；預設 ＝ 砲種表）
    var k0 = fitKind0(gn.model);                                        // 站的高度照原本雕的那一門（換了裝 ⇒ 底對齊，甲板還是那一層；38_fit.js）
    if (k0 === 'chase') { z0 = b[2] - 3; z1 = b[2] + 3; }
    else if (k0 === 'carr') { z0 = b[2] - 6; z1 = b[2] + 3; }
    else { z0 = b[2] - 8; z1 = b[2] + 3; }                            // 長砲（24、32 磅）
    var tn = gn.hd || (gn.mt && gn.mt.up);                             // 掛在砲塔上（27_turret.js）⇒ 站在砲塔底座那一層（⛔ 照砲的高度往下 8 格 ⇒ 莫尼特號兩個砲手站進砲塔底下的艙口梯井、踩在梯子上）
    if (tn) { var tb = sh.T.turrets[tn.k].box; z0 = Math.floor(tb[2]) - 1; z1 = Math.floor(tb[2]) + 3; }
    var cx = Math.floor((b[0] + b[3]) / 2), sg = gn.side === 'P' ? -1 : 1, y0 = sg > 0 ? b[1] : b[4], spots;
    if (Math.abs(gn.ax[0]) <= Math.abs(gn.ax[1])) {
      // 往舷外開的砲（舷側砲、偏正橫的追擊砲）：砲的兩側（沿 x）、砲尾後面（inboard：S 那一舷的砲是 y 小的那邊、P 那一舷的砲是 y 大的那邊）
      spots = [[b[0] - 3, y0 + 10 * sg], [b[3] + 3, y0 + 10 * sg], [b[0] - 3, y0 + 4 * sg], [b[3] + 3, y0 + 4 * sg], [b[0] - 2, y0 - 3 * sg], [b[3] + 2, y0 - 3 * sg], [cx, y0 - 6 * sg], [cx - 5, y0 - 10 * sg]];
    } else {
      // 往船頭／船尾開的砲（餘燼號的船尾追擊砲：砲軸 −170°～−175°）：同一個排法轉 90° —— 砲的兩側（沿 y）、砲尾往船裡那一頭（沿 x）。
      // ⛔ 照上面那組排 ⇒ 站位落在船尾板外面或砲身上，四門船尾追擊砲各只找到 1 個位置、一個砲手都分不到（0／3），永遠開不了
      var ex = gn.ax[0] > 0 ? 1 : -1, x0 = ex > 0 ? b[0] : b[3], cyg = Math.floor((b[1] + b[4]) / 2);
      spots = [[x0 + 10 * ex, b[1] - 3], [x0 + 10 * ex, b[4] + 3], [x0 + 4 * ex, b[1] - 3], [x0 + 4 * ex, b[4] + 3], [x0 - 3 * ex, b[1] - 2], [x0 - 3 * ex, b[4] + 2], [x0 - 6 * ex, cyg], [x0 - 10 * ex, cyg - 5]];
    }
    gn.crewFull = n; gn.crewMin = GUNS[gn.type].min; gn.crewStd = GUNS[gn.type].crew; gn.spots = [];   // crewStd：射速照砲種表的人數算（多的人是替補，gunRate）
    for (i = 0; i < n; i++) {
      var at = standNear(g, spots[i][0], spots[i][1], z0, z1, 14, taken);
      if (!at) continue;
      add(ROLE.GUN, at, gn, 1); var c = crew[crew.length - 1]; c.deck = gunDeck(gn); c.side = gn.side; gn.spots.push({ at: at, who: c });
    }
    var want = tn ? n : Math.min(n, gn.crewMin);                       // 砲塔上的砲（27_turret.js）⇒ 補到滿編（砲塔裡擠，照排法常常只站得到幾個；舊船照舊補到開得動就停）
    if (gn.spots.length < want) {                  // 站不到開得動的人數（三叉戟號船頭：6 磅砲擠在三叉戟砲旁邊，兩側被它的模型與砲班佔掉，各只站得到 1 個 ⇒ 開局就是灰的）
      var gy = Math.floor((b[1] + b[4]) / 2);                          //   ⇒ 補到最少人數為止：以砲為中心往外找同一層站得住、沒被佔的格（放寬到 3 m）；照舊找得到的砲不走這裡 ⇒ 其他船一位元不動
      for (i = gn.spots.length; i < n && gn.spots.length < want; i++) {
        var at2 = standNear(g, cx, gy, z0, z1, 14, taken, 30); if (!at2) break;
        add(ROLE.GUN, at2, gn, 1); var c2 = crew[crew.length - 1]; c2.deck = gunDeck(gn); c2.side = gn.side; gn.spots.push({ at: at2, who: c2 });
      }
    }
    if (gn.spots[1]) gn.spots[1].who.rammer = true;                  // 只給畫用：裝填時拿推彈桿的那一個（41_crew_art.js 手持物）
  });
  oarCrew(sh, g, taken, crew, add);                                   // 槳手（TASK-0691）：每支槳 meta rowers 個，坐在槳座往船裡那一側
  // 送藥手：每一對砲（同一個 x 的兩舷）一個，從那一層的取用點搬火藥與彈藥到要裝填的砲（23_powder.js makeMonkeys／stepMonkey）
  makeMonkeys(sh, crew, taken, add);
  // spar deck 的高度：從 carronade 推；陸戰隊沿 S 那一舷（格 +y）的舷牆、軍官在後甲板、舵手在舵輪旁
  var carr = sh.models.filter(function (m) { return fitKind0(m) === 'carr'; }).map(function (m) { return m.was ? { bb: m.was.bb } : m; }), wheel = sh.models.filter(function (m) { return m.kind === 'wheel'; })[0];
  var GZ = sh.T.geo, CW = sh.cw, sz0 = carr.length ? Math.floor(carr[0].bb[2]) - 6 : GZ.spar ? GZ.spar[0] : 100, sz1 = carr.length || !GZ.spar ? sz0 + 9 : GZ.spar[1];   // 沒有 carronade ⇒ 船型給的高度（05_hull.js GEO0；夜隼號主甲板到後甲板）
  for (var x = HULL_X0 + GZ.marines[0]; x < HULL_X1 - GZ.marines[1] && crew.filter(function (c) { return c.role === ROLE.MARINE; }).length < CW.marines; x += CW.marineGap) {   // 每 marineGap 格一個、最多 marines 個（船員配置）
    // 從中線往外走到舷牆前一格（⛔ 從外往裡掃會先碰到舷外的 channels 平台）
    var last = -1, m0 = sz0, m1 = sz1;
    if (GZ.spar) {   // 船型給了站人的範圍（夜隼號 z 28–47：主甲板到後甲板，舷側的繫繩欄、錨鏈台頂也在裡面 ⇒ 陸戰隊站到船殼外 y 113–116）⇒ 只看這一段甲板 −1～+2 格
      var zd = -1; for (var z = sz0; z <= sz1 && zd < 0; z++) if (standZ(g, x, CY + 10, z, z, 14) >= 0) zd = z;   // 最低那一層 ＝ 甲板（甲板上的東西都比它高）
      if (zd < 0) continue; m0 = zd - 1; m1 = zd + 2;
    }
    for (var y = CY + 4; y < CY + 80; y++) { if (standZ(g, x, y, m0, m1, 14) >= 0) last = y; else if (last >= 0) break; }
    if (last >= 0) add(ROLE.MARINE, standNear(g, x, last - 2, m0, m1, 14, taken), null, 1);
  }
  var qx = wheel ? Math.floor(wheel.c[0]) : HULL_X0 + 160, offP = [[qx + 22, CY + 8], [qx + 30, CY - 6], [qx + 40, CY + 14], [qx + 14, CY - 12], [qx + 48, CY - 2], [qx + 22, CY - 20], [qx + 36, CY + 22], [qx + 56, CY + 10]];   // 後四個給船隻配置頁多調的
  var offN = CW.shelter ? Math.min(1, CW.officers) : CW.officers;    // 船員避開露天甲板（shelter）：露天只留船長，其他的開完預備水手再擺到甲板下（下面）
  offP.slice(0, offN).forEach(function (p) { add(ROLE.OFFICER, standNear(g, p[0], p[1], sz0, sz1, 14, taken), null, 1); });
  if (wheel) { var wx = Math.floor(wheel.bb[0]) - 3; [[wx, CY + 3], [wx, CY - 3], [wx - 5, CY + 7], [wx - 5, CY - 7]].slice(0, CW.helm).forEach(function (p) { add(ROLE.HELM, standNear(g, p[0], p[1], sz0, sz1, 14, taken), null, -1); }); }   // 舵輪後面（⛔ 舵輪中心往後 4 格還在舵輪的外框裡 ⇒ 以前一個舵手都站不上去）
  // 桅頂：每根桅最低的那層平台（從那根桅最低的橫帆桁往上，第一層有 6 個以上站得住的點；沒有帆桁 meta ⇒ 從 z 200）上分散站四個人；頭頂 1.4 m 空（同一般站位）。
  //   憲法號：前桅 263、主桅 286、後桅 241（帆桁 254／276／232 ⇒ 跟以前從 200 找一樣）；夜隼號：前桅 127、主桅 137。
  //   ⛔ 從 250 找 ⇒ 跳過後桅的桅頂；⛔ 不夠四個就往上找 ⇒ 站到 377–465 的高處橫桁上；⛔ 頭頂只看 0.6 m
  var TOP_A = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15], TOP_R = [12, 15, 9, 18];   // 角度照「先對角、再補中間」排 ⇒ 四個人分散在平台四周
  function topSpot(m, k, r, z) {
    var a = k / 16 * 6.2832, px = Math.round(m.x + Math.cos(a) * r), py = Math.round(CY + Math.sin(a) * r);
    if (taken[px + ',' + py + ',' + z] || !g.get(px, py, z - 1) || g.get(px, py, z)) return null;
    for (var h = 1; h < 14; h++) if (g.get(px, py, z + h)) return null;
    return [px, py];
  }
  if (CW.top > 0) sh.masts.forEach(function (m) {
    for (var z = m.z0top || 200; z < 470; z++) {
      var n = 0; TOP_A.forEach(function (k) { TOP_R.forEach(function (r) { if (topSpot(m, k, r, z)) n++; }); });
      if (n < 6) continue;
      var found = 0;
      TOP_A.forEach(function (k) {
        for (var i = 0; i < TOP_R.length && found < CW.top; i++) { var p = topSpot(m, k, TOP_R[i], z); if (p) { taken[p[0] + ',' + p[1] + ',' + z] = 1; add(ROLE.TOP, [p[0] + 0.5, p[1] + 0.5, z], null, 1); found++; return; } }
      });
      return;
    }
  });
  makeHands(sh, crew, add); carpInit(sh, crew, add); smInit(sh, crew, add);   // smInit：帆匠（47_sailmaker.js；木匠之後）   // carpInit：木匠（46_carpenter.js；要走路格 ⇒ 預備水手之後）                                          // 預備水手：最後才生（數量 0 ⇒ 跟以前一樣，rnd() 一個都不多抽）
  crew.forEach(function (c) { if (c.role === ROLE.OAR) c.deck = sh.nav ? sh.nav.levels[Math.max(0, lvAt(sh, c.home))].key : sh.weatherDeck; });   // 槳手在哪一層（火槍只打露天那一層的：musket）   // carpInit：木匠（46_carpenter.js；要走路格 ⇒ 預備水手之後）                                          // 預備水手：最後才生（數量 0 ⇒ 跟以前一樣，rnd() 一個都不多抽）
  if (offN < CW.officers) {                                          // shelter：船長以外的軍官在預備水手待命的那一層（42_hands.js shelterSpots；沒有走路格 ⇒ 照舊站露天甲板）
    var below = shelterSpots(sh, CW.officers - offN);
    offP.slice(offN, CW.officers).forEach(function (p, k) { add(ROLE.OFFICER, below[k] || standNear(g, p[0], p[1], sz0, sz1, 14, taken), null, 1); if (below[k]) crew[crew.length - 1].below = true; });   // below：在甲板下 ⇒ 火槍打不到（musket）
  }
  crew.filter(function (c) { return c.role === ROLE.OFFICER; }).forEach(function (c, k) { c.rank = k; if (!k) c.art = ART_CAPTAIN; });   // 階級照順序：船長（換貼圖）、大副、二副、三副、見習軍官（廣播用，61_hud.js newsCrew）
  medInit(sh); medSurgeons(sh, crew, add); pumpInit(sh);                                         // pumpInit：人力抽水機旁的走路點（45_pumps.js）；醫療艙走得到的床、要幾個人手（44_medic.js；沒有 ⇒ sh.med ＝ null，照舊）
  galleyInit(sh); galleyCooks(sh, crew, add); galleyMess(sh, crew);
  dutyCrew(sh, crew, add, g, taken, wheel, qx, sz0, sz1); effInit(sh);   // 航海士、軍需官（TASK-0825，39_duty.js）：add() 抽 rnd() ⇒ 最後才生（人數 0 ⇒ 什麼都不做，戰局一位元不動）   // 廚房（TASK-0720，45_galley.js）：有 kind=galley 的爐灶才生廚師、分桌（add() 抽 rnd() ⇒ 放在最後：只有有廚房的船、只從這裡之後錯位）；工作效率（39_eff.js）
  // 站不下的（船隻配置頁調多了、船小）⇒ 記著，開戰時上方廣播一行（52_fleet.js crewShortNote）；⛔ 不默默少人
  function cnt(r) { return crew.filter(function (c) { return c.role === r; }).length; }
  //   ⚠ 預設本來就有站不下的（憲法號陸戰隊 11／12、送藥手 26／27；夜隼號陸戰隊 2／12）：開戰只報玩家改過的那幾項（61_hud.js crewShortNote），全部照實列在船隻配置頁（CREW_SEEN）
  sh.crewShort = [['砲班', sh.guns.reduce(function (a, gn) { return a + gn.crewFull; }, 0), cnt(ROLE.GUN), 'guns'], ['送藥手', sh.pmWant, cnt(ROLE.POWDER), 'monkeys'], ['軍官', CW.officers, cnt(ROLE.OFFICER), 'officers'],
    ['舵手', wheel ? CW.helm : 0, cnt(ROLE.HELM), 'helm'], ['陸戰隊', CW.marines, cnt(ROLE.MARINE), 'marines'], ['桅頂水手', CW.top * sh.masts.length, cnt(ROLE.TOP), 'top'], ['預備水手', CW.hands, cnt(ROLE.HAND), 'hands'], ['船醫', sh.surgWant || 0, cnt(ROLE.SURGEON), 'surgeon'], ['航海士', sh.navWant || 0, cnt(ROLE.NAVIGATOR), 'navigator'], ['軍需官', sh.qmWant || 0, cnt(ROLE.QUARTERMASTER), 'quartermaster'], ['槳手', sh.oarWant || 0, cnt(ROLE.OAR), 'oars'], ['木匠', sh.carpWant || 0, cnt(ROLE.CARPENTER), 'carpenter'], ['帆匠', sh.smWant || 0, cnt(ROLE.SAILMAKER), 'sailmaker'], ['廚師', sh.cookWant || 0, cnt(ROLE.COOK), 'cook']].filter(function (r) { return r[2] < r[1]; });
  CREW_SEEN[sh.T.id] = { n: crew.length, short: sh.crewShort, sig: crewSig(CW) };
  return crew;
}
function crewAble(c) { return c.st === 0; }
/** 槳手（TASK-0691）：每支槳（模型 meta kind=oar、有槳座 pivot）meta rowers 個（至少 1）；坐在槳座往船裡那一側 ——
 *  有固定點 seat ⇒ 從那裡排；沒有 ⇒ 從槳座往船裡 1 m（槳葉端 blade 的反方向；沒有 blade ⇒ 往中線）。多個人沿槳柄每 0.6 m 一個（長槳好幾個人划一支）。
 *  站不下 ⇒ 少幾個就是那支槳到崗比例少幾成（開戰時廣播、匯入檢查報）。 */
function oarCrew(sh, g, taken, crew, add) {
  var n0 = 0;
  sh.models.forEach(function (m) {
    if (m.kind !== 'oar' || !m.pts.pivot) return;
    var pv = m.pts.pivot, bl = m.pts.blade, n = oarRowers(m); n0 += n;
    var dx = bl ? pv[0] - bl[0] : 0, dy = bl ? pv[1] - bl[1] : sh.T.cy - pv[1], dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;   // 往船裡（平面）
    var s0 = m.pts.seat || [pv[0] + dx * 10, pv[1] + dy * 10, pv[2]], z0 = Math.floor(Math.min(s0[2], pv[2])) - 14, z1 = Math.floor(Math.max(s0[2], pv[2])) + 2;
    for (var i = 0; i < n; i++) {
      var at = standNear(g, Math.floor(s0[0] + dx * 6 * i), Math.floor(s0[1] + dy * 6 * i), z0, z1, 14, taken, 6); if (!at) continue;
      add(ROLE.OAR, at, null, 1); var c = crew[crew.length - 1]; c.oar = m; c.art = ROLE.GUN;
    }
  });
  sh.oarWant = n0;
}
/** 每門砲現在有幾個人在崗（走過去的路上不算）。 */
function manning(sh) {
  sh.guns.forEach(function (g) { g.manned = 0; });
  sh.crew.forEach(function (c) { if (crewAble(c) && c.gun && !c.walk) c.gun.manned++; });
  if (!sh.effOn) return;                                               // 工作效率（TASK-0720，39_eff.js）：g.eff ＝ 在崗砲班的平均（裝填乘它，32_hull.js）；⛔ 沒開的船不算、不設
  sh.guns.forEach(function (g) { g.effS = 0; });
  sh.crew.forEach(function (c) { if (crewAble(c) && c.gun && !c.walk) c.gun.effS += crewEff(sh, c); });
  sh.guns.forEach(function (g) { g.eff = g.manned ? g.effS / g.manned : 1; });
}
/** 重新分派（每半秒），每層甲板各自來：
 *  ① 開得動的砲（在崗 ≥ crewMin）留著，人不動；
 *  ② 開不了的砲照在崗人數多到少，向「最近的空閒的人、或同樣開不了的砲」借人，借到能開就留下 ⇒ 人只走到隔壁幾門；
 *  ③ 借不夠的砲人放出來；空閒的人夠一整門才去開空砲，剩下的補滿留下的砲（都挑最近的）。
 *  只有換砲的人才走路。每層砲甲板（照砲的高度分，sh.decks）各自調度：憲法號 ＝ 砲甲板（長砲＋追擊砲）／上甲板（carronade）。 */
function reassign(sh) {
  sh.crew.forEach(function (c) { if (c.gun && (!crewAble(c) || !c.gun.alive || c.gun.wet)) leaveGun(c); });   // wet：砲口泡在水裡（43_swim.js）
  var ds2 = []; sh.decks.forEach(function (D) { ds2.push([D.key, 'S'], [D.key, 'P']); });
  ds2.forEach(function (ds) {                                          // 每層甲板、每一舷各自調度
    var deck = ds[0], side = ds[1];
    var gs = sh.guns.filter(function (g) { return g.alive && !g.wet && g.side === side && gunDeck(g) === deck; });
    var men = sh.crew.filter(function (c) { return crewAble(c) && c.role === ROLE.GUN && c.deck === deck && c.side === side; });
    var cur = new Map(); gs.forEach(function (g) { cur.set(g, 0); });
    men.forEach(function (c) { if (c.gun) cur.set(c.gun, cur.get(c.gun) + 1); });
    var kept = new Set(gs.filter(function (g) { return cur.get(g) >= g.crewMin; }));
    function short(c) { return !c.gun || (!kept.has(c.gun) && cur.get(c.gun) < c.gun.crewMin); }
    function move(c, g) {                        // c 換到 g
      if (c.gun) { cur.set(c.gun, cur.get(c.gun) - 1); leaveGun(c); }
      c.gun = g; cur.set(g, cur.get(g) + 1); goToGun(sh, c, g);
    }
    // 換砲的人照直線走（goToGun）⇒ 只借走路格上走得到的（42_hands.js navReach；砲塔那一圈隔開的不借：吊籃裡的砲班不去補甲板上的砲，反過來也是）。沒有會轉裝甲的船 ⇒ 一律走得到（跟以前一樣）
    var walled = !!(sh.nav && sh.T.armor && sh.T.armor.length);
    function can(c, g) { return !walled || navReach(sh, c.pos, gunNavAt(sh, g)); }
    function nearest(list, g) { var bi = -1, bd = 1e9; list.forEach(function (c, i) { if (!can(c, g)) return; var d = Math.abs(g.muz[0] - c.pos[0]); if (d < bd) { bd = d; bi = i; } }); return bi < 0 ? null : list.splice(bi, 1)[0]; }
    function fill(list, g, n) { for (var k = 0; cur.get(g) < n && list.length && k < 64; k++) { var c = nearest(list, g); if (!c) break; move(c, g); } }   // 防呆：上限 64、借光或沒有走得到的就停
    gs.filter(function (g) { return !kept.has(g) && cur.get(g) > 0; })
      .sort(function (a, b) { return cur.get(b) - cur.get(a) || gs.indexOf(a) - gs.indexOf(b); })
      .forEach(function (g) {
        if (!cur.get(g)) return;                                           // 已經被別門借光
        var pool = men.filter(function (c) { return c.gun !== g && short(c) && can(c, g); });
        if (cur.get(g) + pool.length < g.crewMin) return;                  // 借不夠 ⇒ 這門是借出去的那一方
        fill(pool, g, g.crewMin);                                          // 上一行已經先數過夠不夠
        kept.add(g);
      });
    men.forEach(function (c) { if (c.gun && !kept.has(c.gun)) { cur.set(c.gun, cur.get(c.gun) - 1); leaveGun(c); } });
    var free = men.filter(function (c) { return !c.gun; });
    gs.forEach(function (g) {
      if (kept.has(g) || free.filter(function (c) { return can(c, g); }).length < g.crewMin) return;
      fill(free, g, g.crewMin);
      kept.add(g);
    });
    kept.forEach(function (g) { fill(free, g, g.crewFull); });
    if (walled) free.forEach(function (c) { if (!c.gun && !c.walk && !gs.some(function (g) { return can(c, g); })) toHand(sh, c); });   // 這一塊沒有活著的砲了（砲塔裡的砲全被打掉）⇒ 改當預備水手、走梯子去別處補（42_hands.js toHand）
  });
  if (sh.nav && sh.T.armor && sh.T.armor.length) sh.crew.forEach(function (c) {   // 送藥手同理：同一層走得到的砲全沒了、手上沒藥包 ⇒ 預備水手
    if (c.role !== ROLE.POWDER || !crewAble(c) || !c.pm || c.pm.st !== 'idle' || c.cart) return;
    if (!sh.guns.some(function (g) { return g.alive && g.drop && gunDeck(g) === c.deck && navReach(sh, c.pos, g.drop); })) toHand(sh, c);
  });
}
function gunDeck(g) { return g.deck; }                  // 那門砲在哪一層（10_ship.js gunDecks）
/** 砲班要走去的那一點（換砲 navReach 用）：第一個在走路格上量得到的站位（砲房前半的站位常落在會轉的甲板外、snap 不到）⇒ 放藥箱的位置 ⇒ 砲口。 */
function gunNavAt(sh, g) {
  var sp = (g.spots || []).filter(function (s) { return navRegAt(sh, s.at); })[0];
  return sp ? sp.at : g.drop || g.muz;
}
/** 離開原本那門砲：站位讓出來（⛔ 不清 ⇒ 幾輪之後每個站位都被兩個人佔著）。 */
function leaveGun(c) {
  if (c.gun && c.gun.spots) c.gun.spots.forEach(function (s) { if (s.who === c) s.who = null; });
  c.gun = null;
}
/** 走去新砲：挑一個沒人、腳下還有甲板的站位；都沒有 ⇒ 在第一個站位附近重新找站得住的格（⛔ 退路不能落在砲身裡）。 */
function goToGun(sh, c, g) {
  var spot = (g.spots || []).filter(function (s) {
    if (s.who && crewAble(s.who) && s.who.gun === g) return false;
    var x = Math.floor(s.at[0]), y = Math.floor(s.at[1]);
    return countBox(sh.grid, x - 1, y - 1, s.at[2] - 1, x + 1, y + 1, s.at[2] - 1) > 0;
  })[0];
  var to = spot ? spot.at : null;
  if (!to && g.spots && g.spots.length) { var a = g.spots[0].at; to = standNear(navG(sh), Math.floor(a[0]), Math.floor(a[1]), a[2] - 2, a[2] + 2, 14, {}); }   // navG：砲塔的裝甲掃過的那一圈擋人（24_armor.js；沒有裝甲 ＝ sh.grid）
  if (!to) to = c.pos;
  if (spot) spot.who = c;
  c.walk = { to: to.slice(), sp: 18, w: navWay(sh, c.pos, to.slice()), k: 0 };   // w：一段一段走的點（會轉裝甲的船繞過砲塔那一圈；42_hands.js navWay）；其他船 ＝ [to]，照以前直線
}
/** 這一點附近的人扣血（r 格數）：rKill 內吃滿基準傷害 base，rKill～rWound 從 0.55 遞減到 0.1，再乘 0.6～1.4 的隨機。
 *  base ＝ 1.4 × 每發傷害 × 彈種對人倍率（crewBase）⇒ 24 磅實心 140：rKill 內約 85% 當場陣亡（跟以前的 0.85 對齊）。
 *  dir（格座標的單位向量）給了 ⇒ 前方（碎屑噴的方向）的範圍拉長。list：只看這幾個人（砲彈掠過，21_gunnery.js ballNear 先挑好的；沒給 ⇒ 全船）。 */
function crewHurt(sh, L, rKill, rWound, dir, cause, base, list) {
  var n = 0;
  (list || sh.crew).forEach(function (c) {
    if (c.st > 1) return;
    var d = sub([c.pos[0], c.pos[1], c.pos[2] + 9], L), dist = len(d);
    if (dir) { var along = dot(d, dir); if (along > 0) dist = Math.sqrt(Math.max(0, dist * dist - along * along * 0.75)); }  // 前方的碎屑錐
    if (dist >= Math.max(rKill, rWound)) return;
    if (sh.arm && armBetween(sh, L, [c.pos[0], c.pos[1], c.pos[2] + 9])) return;   // 隔著裝甲（砲塔的牆）⇒ 擋住（24_armor.js；沒有裝甲的船不看）
    var f =dist < rKill ? 1 : 0.55 - 0.45 * (dist - rKill) / (rWound - rKill);
    damageCrew(sh, c, base * f * rr(0.6, 1.4), cause); n++;
  });
  return n;
}
/** 船員扣血：歸零 ⇒ 照死亡率（CREW_DEATH %）當場陣亡，沒中 ⇒ 變成傷員、剩一口氣（HP 1；之後再被打到歸零再判一次）；
 *  掉到一半以下受傷倒下（原本的傷員，照舊）；一半以上照常作戰，只閃紅。
 *  Tim 2026-10-16：「HP歸零後會額外根據死亡率判斷 如果死亡率是30% 代表70%會變成傷員」「預設死亡率50%」「原本的傷員機制保留」。
 *  死亡率 100 ⇒ 不抽亂數、一律陣亡（跟以前逐位元組相同）；0 ⇒ 不抽、一律變傷員（只有溺水、落水、醫療艙抬下去才會少人）。 */
function damageCrew(sh, c, dmg, cause) {
  if (c.st > 1 || !(dmg > 0)) return;
  if (c.cart) cartHit(sh, c, dmg);                   // 手上的藥包：吃到夠重的一下就著火（23_powder.js）
  c.hp -= dmg; c.hitT = 0.4;
  if (c.hp <= 0) {
    if (CREW_DEATH >= 100 || (CREW_DEATH > 0 && rnd() * 100 < CREW_DEATH)) killCrew(sh, c, cause);
    else { c.hp = 1; woundCrew(sh, c, cause); }                      // 已經是傷員 ⇒ 照舊是傷員（woundCrew 只收站著的）
  }
  else if (c.hp < CREW_HP * 0.5 && c.st === 0) woundCrew(sh, c, cause);
}
function woundCrew(sh, c, cause) { if (c.st !== 0) return; c.st = 1; c.t = 0; c.walk = null; c.cart = false; c.moving = false; sh.wounded++; sh.wounds++; sh.causes[cause] = (sh.causes[cause] || 0) + 1; newsCrew(sh, c, false, cause); tlgEv(sh, c, 'wound', cause); }
function killCrew(sh, c, cause) {
  if (c.st >= 2) return;
  if (c.st === 1) sh.wounded--;
  c.fromW = c.st === 1;                               // 只給畫用：從跪著倒下（不是從站直倒）
  c.st = 2; c.t = 0; c.walk = null; c.cart = false; c.moving = false; c.hp = Math.min(c.hp, 0); sh.dead++; sh.kills++; sh.causes[cause] = (sh.causes[cause] || 0) + 1; newsCrew(sh, c, true, cause); tlgEv(sh, c, 'dead', cause);
}
/** 掉下去：腳下那一格沒了（甲板被打穿、桅頂跟著桅倒）⇒ 換成世界座標的落體，落水算失蹤（亡）。 */
function crewFall(sh, c, v) {
  if (c.st >= 2 && c.st !== 2) return;
  var w = M4.pt(sh.M, c.pos[0], c.pos[1], c.pos[2]);
  if (c.st < 2 && DROWN_T > 0) { if (c.st === 1) { sh.wounded--; c.hurtSwim = true; } c.fellAlive = true; }   // 落水求生（43_swim.js）：先不算陣亡，落到水裡變成在游
  else if (c.st < 2) { if (c.st === 1) sh.wounded--; sh.dead++; sh.kills++; sh.causes['落水'] = (sh.causes['落水'] || 0) + 1; newsCrew(sh, c, true, '落水'); }
  c.st = 4; c.fw = w; c.fv = add(v || [gauss(), rr(0, 2), gauss()], sh.vel); c.t = 0; c.walk = null; c.cart = false; c.moving = false;
}
/** 站著的地方腳下被打穿（32_hull.js survey）：同一柱往下還有船裡的一層接得住 ⇒ 落在那一層（摔傷照高度），不是穿過船殼掉進海裡。
 *  Tim 2026-10-16（TASK-0637）：莫尼特號砲塔的地板（0.3 m 的甲板）被打穿 ⇒ 砲手照世界座標一路掉到海面、溺死（seed 1–4 每場 3–9 人）。
 *  接得住 ＝ 下面那幾層（42_hands.js 的走路格，由上往下）在這一點 2 點內有站得住的點、而且那一點腳下現在還有格；都沒有（掉出船外、船沒有走路格）⇒ 照舊 fall（落水）。
 *  落地之後：砲班、送藥手、舵手、陸戰隊、桅頂水手換成那一層的預備水手 ⇒ 照常點名、爬梯子回去補位（42_hands.js callHands）；
 *  軍官留原職（降旗看軍官還在不在）；預備水手照新的那一層重新找路；傷員只換位置。 */
function fallIn(sh, c) {
  var NV = sh.nav, x = c.pos[0], y = c.pos[1], z0 = c.pos[2];
  if (!NV || c.inBed) { crewFall(sh, c); return; }
  for (var lv = NV.levels.length - 1; lv >= 0; lv--) {
    var N = NV.levels[lv].N, i = navSnap(N, [x, y, NV.levels[lv].zr[0]], 2); if (i < 0) continue;
    var p = navPos(N, i); if (p[2] > z0 - 4) continue;                  // 同一層（腳邊的洞）、比腳還高 ⇒ 不是落點
    if (!countBox(sh.grid, Math.floor(p[0]) - 1, Math.floor(p[1]) - 1, p[2] - 1, Math.floor(p[0]) + 1, Math.floor(p[1]) + 1, p[2] - 1)) continue;   // 那一層這裡也被打穿了 ⇒ 再往下
    landIn(sh, c, lv, p, (z0 - p[2]) * S);
    return;
  }
  crewFall(sh, c);
}
var FALL_H0 = 2, FALL_K = 30;                       // 摔傷：高度 h 公尺 ⇒ 扣 (h − 2) × 30（3 m 30、5 m 90、10 m 240）
function landIn(sh, c, lv, p, h) {
  var NV = sh.nav, r = c.role, home0 = c.home;
  tlgEv(sh, c, 'fallIn', { from: c.pos.map(function (v) { return +v.toFixed(1); }), to: p.map(function (v) { return +v.toFixed(1); }), h: +h.toFixed(1) });   // 測試模式（83_testlog.js）
  c.pos = p.slice(); c.home = p.slice(); c.walk = null; c.moving = false; sh.fellIn = (sh.fellIn || 0) + 1;
  if (h > FALL_H0) damageCrew(sh, c, (h - FALL_H0) * FALL_K, '摔落');
  if (c.st !== 0) return;                                                // 摔死、摔傷：倒在那一層
  if (r === ROLE.OFFICER) { c.below = true; return; }                  // 掉到甲板下的軍官：火槍打不到（musket）
  if (r === ROLE.HAND || r === ROLE.CARPENTER || r === ROLE.SAILMAKER) {   // 木匠、帆匠照預備水手（修的工作作廢，下一次點名重挑）
    var H = c.hand; H.lv = lv; H.legs = []; H.wp = null; H.climb = null; H.wait = rr(0.5, 1.5);
    if (H.job && (H.job.kind === 'helm' || H.job.kind === 'oar') && H.job.who) H.job.who.relieved = false;   // 去補舵手的路斷了 ⇒ 那個位置重新等人
    if (H.job && H.job.kind !== 'staff' && H.job.kind !== 'carry') H.job = null;   // 醫療艙的工作照留：medJoin 自己看層對不對
    c.deck = NV.levels[lv].key; return;
  }
  if (c.art === undefined) c.art = r;                                    // 貼圖照原本的職位那一列
  if (r === ROLE.GUN) leaveGun(c);
  if (r === ROLE.POWDER) { (c.guns || []).forEach(function (g) { if (g.pm === c) g.pm = null; }); c.fellPm = { deck: c.deck, guns: c.guns || [], home: home0 }; c.pm = null; c.cart = false; }   // 補上來的送藥手接它的砲（handJoin）
  if (r === ROLE.HELM) c.helmHome = home0;
  if (r === ROLE.OAR) { c.oarHome = home0; c.oarOf = c.oar; c.oar = null; }   // 槳手的位子：預備水手照它補（callHands）             // 舵手的站位：預備水手照它補（callHands）
  c.backRole = r === ROLE.MARINE ? r : undefined;
  c.role = ROLE.HAND; c.gun = null; c.deck = NV.levels[lv].key;
  c.hand = { lv: lv, wait: rr(1, 3), legs: [], wp: null, k: 0, climb: null, job: null, to: null };
}
function stepCrew(sh, dt) {
  sh.navN = HAND_PATHS;                                 // 預備水手這一步還能找幾次路（42_hands.js）
  sh.crew.forEach(function (c) {
    c.t += dt; if (c.hitT > 0) c.hitT -= dt;            // hitT：被打中但沒倒下的閃紅
    if (c.st === 4) {                                   // 落體
      c.fv[1] -= G * dt; c.fw = add(c.fw, mul(c.fv, dt));
      if (c.fw[1] < seaH(c.fw[0], c.fw[2], SIMT)) { if (!c.splashed) { c.splashed = true; splash(c.fw, false); } if (c.fellAlive) { c.fellAlive = false; toSwim(sh, c, [c.fw[0], c.fw[1] - 1.2, c.fw[2]]); } else c.st = 3; }
      return;
    }
    if (c.st === 5) { stepSwim(sh, c, dt); return; }      // 在水裡（43_swim.js）
    if (c.st === 1) { if (!(sh.med && medHold(sh, c)) && c.t > 12) c.st = 3; return; }   // 傷者被抬下去；有醫療艙送得到 ⇒ 等預備水手搬、被扛著跟著走（44_medic.js）
    if (c.st !== 0) return;
    if (c.role === ROLE.HAND || c.role === ROLE.CARPENTER || c.role === ROLE.SAILMAKER) { stepHand(sh, c, dt); return; }   // 木匠走路照預備水手（46_carpenter.js）   // 預備水手：走路、爬梯子、補位（42_hands.js）
    if (c.walk) {
      var W = c.walk, wt = W.w ? W.w[W.k] : W.to, d = sub(wt, c.pos), l = Math.hypot(d[0], d[1]);
      if (l < 0.6 && W.w && W.k < W.w.length - 1) { c.pos[0] = wt[0]; c.pos[1] = wt[1]; W.k++; }   // 走到中間那一點 ⇒ 下一段
      else if (l < 0.6) { c.pos = W.to.slice(); c.home = c.pos.slice(); c.walk = null; }
      else { var s = Math.min(l, W.sp * dt); c.pos[0] += d[0] / l * s; c.pos[1] += d[1] / l * s; }
    } else if (c.role === ROLE.POWDER) stepMonkey(sh, c, dt);   // 送藥手：取用點 ⇄ 砲
    if ((c.role === ROLE.MARINE || c.role === ROLE.TOP) && !sh.sunk && !sh.struck && (modeRule('othersAct') || sh.i === PLAYER_I)) {   // 陸戰隊與桅頂水手：火槍（沙盒的敵艦不還手）
      c.shotT -= dt * crewEff(sh, c); c.fireT -= dt;                   // 工作效率（TASK-0720，39_eff.js；沒開 ⇒ × 1）：上膛快；fireT 是動畫，不乘
      if (c.shotT <= 0) { c.shotT = rr(4, 8); musket(sh, c); }
    }
  });
  if (sh.xfer) swimXfer(sh);                            // 游到敵艦的人換名單（43_swim.js；跑完 forEach 才換）
}
/** 火槍：打對方露天的人（spar deck、桅頂），距離越遠越難中。
 *  最大射程 MUSKET_R（細節設定「火槍射程」，04_state.js；TASK-0633：以前沒有上限、命中率保底 1% ⇒ 28 km 外照樣打死軍官）：
 *  射程內看不到人 ⇒ 不開槍（不冒煙、不抽亂數）。射程內有人 ⇒ 照原本的順序挑一個、照 musketP 算命中（一槍照舊抽一次）。 */
function musket(sh, c) {
  var foe = foeOf(sh), w = M4.pt(sh.M, c.pos[0], c.pos[1], c.pos[2] + 14);
  if (!foe) return;
  var cand = foe.crew.filter(function (o) { return o.st === 0 && !o.below && (o.role !== ROLE.GUN && o.role !== ROLE.POWDER && o.role !== ROLE.HAND && o.role !== ROLE.CARPENTER && o.role !== ROLE.SAILMAKER && o.role !== ROLE.OAR || o.deck === foe.weatherDeck); });   // 露天的人（最上面那層砲甲板的砲班、走到那一層的預備水手也算）
  if (foe.arm) { var wL = M4.pt(foe.inv, w[0], w[1], w[2]); cand = cand.filter(function (o) { return !armBetween(foe, wL, [o.pos[0], o.pos[1], o.pos[2] + 9]); }); }   // 躲在裝甲後面（砲塔裡）的看不到（24_armor.js）
  var near = [];                                                       // 射程內的：[人, 距離 m]
  cand.forEach(function (o) { var d = len(sub(M4.pt(foe.M, o.pos[0], o.pos[1], o.pos[2]), w)); if (d <= MUSKET_R) near.push([o, d]); });
  if (!near.length) return;
  c.fireT = 0.4;
  spawnPt(w, [WIND[0] * 0.3, 0.4, WIND[2] * 0.3], rr(1.5, 2.5) / smokeK(), [0.85, 0.85, 0.85], 0.35, 0.3, 1.4, -0.03, 0.8);
  var t = near[(rnd() * near.length) | 0], o = t[0], dist = t[1];
  if (rnd() < musketP(sh, c, dist)) damageCrew(foe, o, rr(40, 125), '火槍');   // 血量 100 時約三成一槍斃命（跟以前的 0.3 對齊）
}
/** 火槍命中率（TASK-0633；以前 clamp(0.05 × 100 ÷ 距離, 1%, 12%)）：彈著照常態分布散開，打中露出來那一塊的機率。
 *  散布 s ＝ 距離 × √(sigma² ＋ (sway × 自己的船轉得多快)²)（弧度；sway 秒：手跟不上甲板晃的那一下）；
 *  露出來的 w × h 公尺（甲板上的人躲在舷牆後面只露上半身 h；桅頂往下看看得到整個人 hTop）⇒ erf(w ÷ 2√2s) × erf(h ÷ 2√2s)。
 *  sigma 0.013：1811 年倫敦那次試射（Brown Bess 打一整排步兵大小的木板，100／200／300 碼中 53／30／23%）照板高 1.8 m 反推 0.012–0.014。
 *  不晃的時候：10 m 95%、25 m 49%、50 m 17%、100 m 4.6%、200 m 1.2%、300 m 0.5%（桅頂往下 100 m 7.1%）。參數在設定檔 musket。 */
var MUSKET = Object.assign({ sigma: 0.013, w: 0.5, h: 1.0, hTop: 1.6, sway: 0.15 }, CFG.musket || {});
function musketP(sh, c, dist) {
  var V = sh.wv, om = (V ? Math.sqrt(V.rv * V.rv + V.pv * V.pv) : 0) + Math.abs(sh.rollV || 0);   // 自己的船：浪的橫搖＋縱搖、破洞的傾斜（rad/s）
  return musketHit(dist, c.role === ROLE.TOP ? MUSKET.hTop : MUSKET.h, om);
}
/** 距離 dist m、露出來 MUSKET.w × h m、自己的船轉 om rad/s ⇒ 命中率（細節設定的「火槍射程」說明也照它算）。 */
function musketHit(dist, h, om) {
  var sm = MUSKET.sway * om, s = dist * Math.sqrt(MUSKET.sigma * MUSKET.sigma + sm * sm), k = 1 / (2 * Math.SQRT2 * Math.max(s, 1e-6));
  return musketErf(MUSKET.w * k) * musketErf(h * k);
}
/** erf（Abramowitz & Stegun 7.1.26，誤差 < 1.5e-7）；x ≥ 0。 */
function musketErf(x) { var t = 1 / (1 + 0.3275911 * x); return 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); }
/** 一門砲：在崗的人數決定能不能開、裝填多快。 */
function gunRate(g) { return g.wet ? 0 : g.manned >= g.crewMin ? Math.pow(Math.min(1, g.manned / (g.crewStd || g.crewFull)), 0.85) : 0; }   // 照砲種表的人數：滿編調多 ⇒ 多的是替補、射速不再變快；調少 ⇒ 開得動但慢

