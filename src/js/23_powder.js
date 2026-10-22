// ───────────────────────── 彈藥庫與火藥桶（殉爆） ─────────────────────────
// 火藥桶是模型（basecamp 的 -magazine-aft／-fore 子作品，meta {kind:'powder', powder_lb:100}；後 22 桶、前 116 桶），
// 彈藥庫是關聯（meta {kind:'magazine', powder_lb}、固定點 blast ＝ 爆心）。
// 火藥桶的血量在細節設定（預設 675 ＝ 很難殉爆但有機率；拉滿 1000 ＝ 不會爆 ⇒ 完全不扣、不抽亂數 ⇒ 戰局跟沒有火藥桶一樣）。
//   ① 血量歸零 ⇒ 點燃，0.15–0.5 秒後炸（kegBoom）：炸掉半徑 KEG_R 的格、傷旁邊的人、旁邊的模型扣血（火藥桶 ⇒ 連鎖）。
//   ② 同一間彈藥庫炸掉 ≥ 30% 的桶 ⇒ 整間殉爆（magBoom）：剩下的桶一起炸，爆心 ＝ blast 固定點，
//      半徑 ∝ (磅數 × 殉爆威力)^(1/3)（前彈藥庫 11,600 磅、威力 1 ⇒ 9.5 m）。
//   ③ 半徑 ≥ 斷船門檻（8 m × (硬度／2)^0.15（硬度 3 ⇒ 8.5 m））⇒ 船從爆心那一截斷開：橫切一刀，短的那半截變成斷開的一團（漂走、翹起來、沉下去），
//      留下的那半截一定沉（進水速度 0 也沉）、算降旗（不再開砲）。
// 威力是能量 ⇒ 爆炸半徑照立方根縮放：0.25× ⇒ 0.63 倍半徑、4× ⇒ 1.59 倍。
var BOOMS = [], KEG_R = 9, KEG_REACH = 30, KEG_DMG = 300, MAG_R = 95, MAG_LB = 11600, BREAK_R = 80;
// 彈坑分幾步挖（TASK-0531，Tim：卡畫面的事件分散到不同幀）：一次挖掉三十幾萬格要 120–230 ms ⇒ 那一步卡住。
//   區塊照離爆心的距離排好，從爆心往外，每一步挖到 BLAST_STEP 格就停、下一步接著挖（BLASTS，step() 的 stepBlasts）⇒ 爆炸往外擴，三十幾萬格約 9 步（0.15 秒）挖完。
//   碎片照挖到的格抽樣、挖到那一步才噴。人、模型照舊在殉爆那一刻算；斷船（橫切那一刀）與廣播（含打掉幾格）挖完才做。
//   ⛔ 斷船在殉爆那一刻切 ⇒ 還沒挖到的彈坑格被連通判定一起搬進斷開的半截（半截船 27 萬格、上面沒有彈坑，量過）。
//   ⚠ 殉爆之後的戰局跟以前（一步挖完）不一樣；但跟慢動作、特寫開不開無關 ⇒ 開或關同一局。
var BLASTS = [], BLAST_STEP = 40000;
function blastK() { return Math.pow(BLAST_K, 1 / 3); }
/** 這一次爆炸的威力（能量倍率）：1 ± BLAST_V 之間（細節設定的「威力浮動」；0 ⇒ 每次一樣、不抽亂數）。半徑照立方根、傷害照原值乘。 */
function blastRoll() { return BLAST_V > 0 ? rr(1 - BLAST_V, 1 + BLAST_V) : 1; }
/** 這艘船的彈藥庫：關聯 meta kind=magazine ＋ 名字在它底下的火藥桶模型。 */
function makeMags(sh) {
  return (sh.T.h.parts || []).filter(function (p) { return p.meta && p.meta.kind === 'magazine'; }).map(function (p) {
    var kegs = sh.models.filter(function (m) { return m.kind === 'powder' && m.path.indexOf(p.path + '/') === 0; });
    var lb = kegs.reduce(function (a, m) { return a + (+m.meta.powder_lb || 100); }, 0) || +p.meta.powder_lb || 0;
    // 關聯的外框比整艘船還大 ＝ 子作品是整個框（收穫號、維吉尼亞號）⇒ 照庫裡的桶收緊（⛔ 照框 ⇒ 只有一間的船從框的兩端往外找取用點、全找到船外 ⇒ 一個取用點都沒有；電腦瞄彈藥庫的高度也跟著錯）
    var B = sh.T.h.bbox, box = kegs.length && p.box[0] <= B[0] && p.box[3] >= B[3] ? kegs.reduce(function (b, m) { var q = m.bb; return [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.min(b[2], q[2]), Math.max(b[3], q[3]), Math.max(b[4], q[4]), Math.max(b[5], q[5])]; }, [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]) : p.box;
    var bl = (p.points && p.points.blast) || [(box[0] + box[3]) / 2, (box[1] + box[4]) / 2, (box[2] + box[5]) / 2];
    var ho = String(p.meta.hoist === undefined || p.meta.hoist === null ? '' : p.meta.hoist).split(',').map(function (v) { return refPath(sh.T, v.trim()); }).filter(Boolean);   // hoist 可以寫好幾座梯子（逗號分開；makeStations 每一層挑梯頭在那一層的那一座）
    var mag = { name: p.path, pos: p.meta.pos || '', hoist: ho[0] || '', hoists: ho, box: box, blast: bl, pts: p.points || {}, lb: lb, kegs: kegs, boomed: 0, gone: false, lit: false, tur: turOf(sh.T, p.path) };   // tur：在第幾座砲塔裡（砲塔裡的彈藥箱，27_turret.js；-1 ＝ 不在）   // pos：關聯 meta 的前／中／後（TASK-0539）；hoist：火藥從哪座梯子的艙口吊上去（TASK-0632，makeStations）
    kegs.forEach(function (m) { m.mag = mag; });
    return mag;
  });
}
/** 火藥桶被打到（damageModel 轉過來）：拉滿 ＝ 不會爆 ⇒ 不扣。 */
function powderHit(sh, m, dmg) {
  if (powderNever() || m.lit || !m.alive) return;
  m.hp -= dmg;
  if (m.hp <= 0) ignite(sh, m, rr(0.15, 0.5));
}
function ignite(sh, m, delay) {
  if (m.lit || !m.alive) return;
  m.lit = true; BOOMS.push({ t: SIMT + delay, sh: sh, m: m });
  if (m.mag && !m.mag.lit) { m.mag.lit = true; note(sh, '<b style="color:#ffb35a">' + magTag(m.mag) + '彈藥庫起火！</b>', true); }
  if (m.station && !m.station.lit) { m.station.lit = true; note(sh, '<b style="color:#ffb35a">' + m.station.name + '的火藥桶起火！</b>', true); }
}
function stepPowder() {
  for (var i = 0; i < BOOMS.length; i++) { var e = BOOMS[i]; if (e.t > SIMT) continue; BOOMS.splice(i--, 1); kegBoom(e.sh, e.m); }
  for (i = 0; i < SELFB.length; i++) { e = SELFB[i]; if (e.t > SIMT) continue; SELFB.splice(i--, 1); selfBoom(e.sh, e.mag); }
}
// 自爆（遊戲內設定的按鈕；Tim 2026-10-13：相當於重開，但先看煙花）：我艦還在的彈藥庫由小到大一間一間引爆（間隔 SELF_GAP 之間隨機，最大那間最後 ⇒ 通常船斷開；
//   每間的威力照細節設定的「威力浮動」，每次都不一樣），
//   照殉爆走（慢動作與特寫照設定）：炸斷了 ⇒ 照斷船沉；沒斷 ⇒ 照破洞進水（粒子模式看得到水灌進來）、水夠了照常開始沉。
//   ⛔ 以前每炸一間就直接標 sinkingFinal ⇒ 進水不再算（32_hull.js：開始沉之後不算水）⇒ 船照公式往下沉、艙裡一滴水都沒有（Tim 2026-10-15：「自爆好像不會進水，可以走正常殉爆流程嗎」）。
//   不一定會沉（Tim 2026-10-15：「自爆也不一定會沉」）：⛔ 以前最後一間炸完 20 秒還沒開始沉 ⇒ 硬標開始沉；現在照物理（斷了照斷船沉、沒斷看進水）。
//   自爆只記時間點 sh.selfAt（Tim：「自爆標記一個Flag(紀錄時間點)」）；算降旗（出局 ⇒ 換友艦、候補）；結算時 SELF_WIN 秒內沉的算「自爆沉沒」（61_hud.js shipFate）。
var SELF_GAP = [0.6, 1.8], SELFB = [];
function canSelfDestruct() { var sh = SHIPS[PLAYER_I]; return !!(RUNNING && sh && !sh.sunk && !sh.selfD && sh.mags.some(function (m) { return !m.gone; })); }
function selfDestruct() {
  if (!canSelfDestruct()) return false;
  var sh = SHIPS[PLAYER_I]; sh.selfD = true; sh.selfAt = SIMT;
  var t = SIMT;
  sh.mags.filter(function (m) { return !m.gone; }).sort(function (a, b) { return a.lb - b.lb; }).forEach(function (m, k) { if (k) t += rr(SELF_GAP[0], SELF_GAP[1]); SELFB.push({ t: t, sh: sh, mag: m }); });
  note(sh, '<b style="color:#ff9a7a">自爆！</b>', true);
  return true;
}
function selfBoom(sh, mag) {
  magBoom(sh, mag);
  sh.struck = true; sh.fate = '自爆' + (sh.broken ? '（船斷成兩截）' : '');   // 開始沉照殉爆的流程（magBoom：斷了才標）＋破洞進水
}
/** 一桶炸了：小爆炸＋連鎖。 */
function kegBoom(sh, m) {
  if (!m.alive || sh.sink > 40) return;
  m.alive = false;
  var f = blastRoll(), k = blastK() * Math.cbrt(f), w = M4.pt(sh.M, m.c[0], m.c[1], m.c[2]), r = shatter(sh, m.c, [0, 0, 1], KEG_R * k, [0, 6, 0], 220, 1);
  explode(w, sh, r.n);
  crewHurt(sh, m.c, KEG_REACH * 0.4 * k, KEG_REACH * k, null, '殉爆', 300 * BLAST_K * f);
  var reach = KEG_REACH * k;
  sh.models.forEach(function (o) {                                    // 旁邊的模型（火藥桶 ⇒ 連鎖；砲 ⇒ 扣血或飛出去）
    if (!o.alive || o === m) return;
    var d = len(sub(o.c, m.c)); if (d > reach) return;
    var cw = M4.pt(sh.M, o.c[0], o.c[1], o.c[2]);
    damageModel(sh, o, mul(norm(sub(cw, w)), 220 * (1 - d / reach) + 60), KEG_DMG * BLAST_K * f * (1 - 0.75 * d / reach));
  });
  if (m.station) flashCheck(sh, m.c);                                  // 取用點的桶：火光可能順著艙口竄下彈藥庫
  var mag = m.mag;
  if (mag && !mag.gone && ++mag.boomed >= Math.ceil(mag.kegs.length * 0.3)) magBoom(sh, mag);
}
/** 整間彈藥庫殉爆。 */
function magBoom(sh, mag) {
  if (mag.gone || sh.sink > 40) return;
  mag.gone = true; mag.lit = true; sh.boomAt = SIMT;                   // boomAt：結算等它定了才跳（61_hud.js shipSettled）
  mag.kegs.forEach(function (m) { m.alive = false; m.lit = true; });
  BOOMS = BOOMS.filter(function (e) { return e.m.mag !== mag; });
  var f = blastRoll(), k = blastK() * Math.cbrt(f), R = MAG_R * Math.pow(mag.lb / MAG_LB, 1 / 3) * k, c = mag.blast, w = M4.pt(sh.M, c[0], c[1], c[2]);
  // 畫面：火球、碎片往外噴、濃煙往上
  flash(w, [0, 1, 0], 200, true);
  for (var i = 0; i < 160; i++) spawnPt(add(w, [gauss() * R * 0.04, rr(0, R * 0.06), gauss() * R * 0.04]), [gauss() * 14, rr(6, 30), gauss() * 14], rr(0.8, 2.2), [1, rr(0.4, 0.75), 0.12], 0.95, rr(3, 7), rr(6, 12), 2, 1.5, 3);
  smoke(w, [0, 1, 0], 120, true); smoke(add(w, [0, R * 0.05, 0]), [0, 1, 0], 80, true);
  sfx('blast', w, 2); sfx('creak', w, 1.6);
  slowKick(sh, w, R);              // 殉爆的慢動作與特寫（73_slowmo.js；只動畫面的時間與鏡頭）
  // 爆心附近：人、模型
  crewHurt(sh, c, R * 0.85, R * 1.4, null, '殉爆', 1500 * BLAST_K * f);
  sh.models.forEach(function (o) {
    if (!o.alive) return;
    var d = len(sub(o.c, c)); if (d > R * 1.3) return;
    var cw = M4.pt(sh.M, o.c[0], o.c[1], o.c[2]);
    damageModel(sh, o, mul(norm(sub(cw, w)), 300 * (1 - d / (R * 1.3)) + 80), 5000);
  });
  // 斷船（橫切那一刀等彈坑挖完：blastStep）
  var brk = R >= BREAK_R * Math.pow(hard0(sh) / 2, 0.15);   // 硬度 ＝ 船殼硬度 × 全船預設材質（05_material.js）
  sh.struck = sh.struck || brk; sh.broken = sh.broken || brk;
  if (brk) { sh.fate = '殉爆（船斷成兩截）'; sh.sinkingFinal = true; }
  mag.R = R; mag.f = f; mag.removed = 0; mag.broke = brk;
  var job = crater(sh, c, R); job.w = w; job.mag = mag; BLASTS.push(job);
  if (sh.arm) armBlast(sh, c, R, w);                                   // 砲帶的裝甲（24_armor.js）：彈坑碰得到的那幾格這一步就打掉
  blastStep(job);                                                      // 爆心那幾塊這一步就挖（其他的 stepBlasts 接著挖）
  if (PHX.blastnb) blastNear(sh, w, R, f);                            // 旁邊的船（物理設定「殉爆波及」；碰得到才算）
}
/** 殉爆波及旁邊的船（Tim 2026-10-15：「目前殉爆有機會炸到旁邊的船嗎」「看對性能的影響 可以只在有可能炸到時進行判斷 性能優先」）：
 *  同一顆爆炸球（世界座標 w、半徑 R 格）照自己這艘的那一套算在別艘上 —— 人（R × 0.85 內死、R × 1.4 內傷）、模型（R × 1.3 內扣血；火藥桶 ⇒ 可能連鎖殉爆）、彈坑（R，分幾步挖：BLASTS）。
 *  先篩：那艘格子盒的外接球（中心＋半對角線）離爆心比 R × 1.4 還遠 ⇒ 整艘跳過（一行都不多算、不抽亂數 ⇒ 船沒靠近的戰局逐字不變）。
 *  過了篩才換座標；彈坑只走碰得到球的區塊（crater），一塊都沒有 ⇒ 不排。斷船只算殉爆的那艘自己（別艘只挖洞，進水照破口算）。 */
function blastNear(src, w, R, f) {
  var reach = R * 1.4 * S;
  for (var i = 0; i < SHIPS.length; i++) {
    var o = SHIPS[i]; if (o === src || o.sunk || o.sink > 40) continue;
    var B = o.T.base, cc = M4.pt(o.M, B.sx / 2, B.sy / 2, B.sz / 2), rb = 0.5 * S * Math.hypot(B.sx, B.sy, B.sz);
    if (len(sub(cc, w)) > rb + reach) continue;
    var c = toLocal(o, w);
    crewHurt(o, c, R * 0.85, R * 1.4, null, '殉爆波及', 1500 * BLAST_K * f);
    o.models.forEach(function (m) {
      if (!m.alive) return;
      var d = len(sub(m.c, c)); if (d > R * 1.3) return;
      var cw = M4.pt(o.M, m.c[0], m.c[1], m.c[2]);
      damageModel(o, m, mul(norm(sub(cw, w)), 300 * (1 - d / (R * 1.3)) + 80), 5000);
    });
    if (o.arm) armBlast(o, c, R, w);                                   // 砲帶的裝甲（24_armor.js）
    var job = crater(o, c, R); if (!job.ch.length) continue;
    job.w = w; job.src = src; o.boomAt = SIMT; BLASTS.push(job); blastStep(job);
  }
}
/** 每一步（step() 的殉爆排程之後）：還沒挖完的彈坑接著挖。 */
function stepBlasts() {
  for (var i = 0; i < BLASTS.length; i++) if (BLASTS[i].done || BLASTS[i].sh.sink > 40 || blastStep(BLASTS[i])) BLASTS.splice(i--, 1);
}
/** 挖一段：從上次停的那一塊接著，挖到 BLAST_STEP 格（或挖完）。挖到的格照抽樣噴碎片。挖完 ⇒ 廣播（含打掉幾格）、回 true。 */
function blastStep(J) {
  var sh = J.sh, g = sh.grid, c = J.c, R = J.R, n0 = J.n, sample = [];
  while (J.k < J.ch.length && J.n - n0 < BLAST_STEP) {
    var ci = J.ch[J.k++], tab = g.tab[ci]; if (!tab) continue;        // ⛔ 寫入會換掉 g.tab 那一格（共用資料先複製）：照原本那份走，每格只拆一次
    var cx = ci % g.nx, cy = Math.floor(ci / g.nx) % g.ny, cz = Math.floor(ci / (g.nx * g.ny));
    for (var li = 0; li < 4096; li++) {
      var col = tab[li]; if (!col) continue;
      var x = cx * 16 + (li & 15), y = cy * 16 + ((li >> 4) & 15), z = cz * 16 + (li >> 8), dx = x - c[0], dy = y - c[1], dz = z - c[2], d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > R * (0.85 + 0.3 * hash3(x, y, z))) continue;
      if (removeVoxel(sh, x, y, z, d > R * 0.8)) { if (++J.n % J.est === 0) sample.push(x, y, z, col); }
    }
  }
  for (var j = 0; j < sample.length; j += 4) {
    var p = M4.pt(sh.M, sample[j] + 0.5, sample[j + 1] + 0.5, sample[j + 2] + 0.5), dir = norm(sub(p, J.w));
    spawnDebris(p, add(add(mul(dir, rr(8, 40)), [0, rr(4, 22), 0]), sh.vel), sample[j + 3], rr(0.06, 0.16), rr(8, 16));
  }
  spawnPlates(sh, sample, [0, 1, 0], 30, 3, 40);                       // 殉爆：往上噴的木板
  if (J.mag) J.mag.removed = J.n;                                      // J.mag 沒有 ⇒ 被別艘的殉爆波及（blastNear）
  if (J.k < J.ch.length) return false;
  J.done = true;
  if (!J.mag) { if (J.n) note(sh, '<b style="color:#ffb35a">被 ' + J.src.name + ' 的殉爆波及</b>（打掉 ' + J.n.toLocaleString() + ' 格）', true); return true; }
  if (J.mag.broke) breakShip(sh, c[0]);                                   // 彈坑挖完才切（下一步的連通判定把短的那半截變成斷開的一團）
  note(sh, '<b style="color:#ffb35a">' + magTag(J.mag) + '彈藥庫殉爆！</b>（' + J.mag.lb.toLocaleString() + ' 磅、半徑 ' + (R * S).toFixed(1) + ' m、打掉 ' + J.n.toLocaleString() + ' 格）' + (J.mag.broke ? '　船斷成兩截' : ''), true);
  return true;
}
/** 彈坑（邊緣參差：0.85～1.15 倍半徑）的工作：只走有東西、而且碰得到球的區塊（⛔ 照 shatter 的三重迴圈：9.5 m 的球要走兩千八百萬格），
 *  照區塊離爆心最近的距離排（同距離照編號）⇒ blastStep 從爆心往外挖。est：大約每幾格抽一顆碎片（全部約 2,400 顆）。
 *  邊緣那一圈才推連通的種子（裡面的鄰格也都打掉了）。 */
function crater(sh, c, R) {
  var g = sh.grid, ch = [], R2 = R * 1.15, cx0 = Math.max(0, Math.floor((c[0] - R2) / 16)), cx1 = Math.min(g.nx - 1, Math.floor((c[0] + R2) / 16));
  var cy0 = Math.max(0, Math.floor((c[1] - R2) / 16)), cy1 = Math.min(g.ny - 1, Math.floor((c[1] + R2) / 16)), cz0 = Math.max(0, Math.floor((c[2] - R2) / 16)), cz1 = Math.min(g.nz - 1, Math.floor((c[2] + R2) / 16));
  for (var cz = cz0; cz <= cz1; cz++) for (var cy = cy0; cy <= cy1; cy++) for (var cx = cx0; cx <= cx1; cx++) {
    var ci = g.ci(cx, cy, cz); if (!g.tab[ci]) continue;
    var ex = Math.max(cx * 16 - c[0], 0, c[0] - (cx * 16 + 15)), ey = Math.max(cy * 16 - c[1], 0, c[1] - (cy * 16 + 15)), ez = Math.max(cz * 16 - c[2], 0, c[2] - (cz * 16 + 15)), d = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (d <= R2) ch.push([d, ci]);
  }
  ch.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
  return { sh: sh, c: c, R: R, ch: ch.map(function (e) { return e[1]; }), k: 0, n: 0, est: Math.max(1, Math.round(4 / 3 * Math.PI * R * R * R * 0.08 / 2400)) };
}
/** 船從 x ＝ xb 那一截斷開：橫切一刀（切面參差 ±0.5～1.2 m），龍骨的錨只留長的那半截 ⇒ 短的那半截在下一步的連通判定裡變成斷開的一團。 */
function breakShip(sh, xb) {
  var g = sh.grid, cut = 0;
  for (var cz = 0; cz < g.nz; cz++) for (var cy = 0; cy < g.ny; cy++) for (var cx = Math.max(0, Math.floor((xb - 14) / 16)); cx <= Math.min(g.nx - 1, Math.floor((xb + 14) / 16)); cx++) {
    var tab = g.tab[g.ci(cx, cy, cz)]; if (!tab) continue;
    for (var li = 0; li < 4096; li++) {
      if (!tab[li]) continue;
      var x = cx * 16 + (li & 15), y = cy * 16 + ((li >> 4) & 15), z = cz * 16 + (li >> 8);
      if (Math.abs(x - xb) < 5 + 7 * hash3(y >> 2, z >> 2, 977)) { if (removeVoxel(sh, x, y, z, true)) cut++; }
    }
  }
  var keepAft = xb - sh.T.wl0 >= sh.T.wl1 - xb;                               // 留長的那半截
  sh.keel = keepAft ? [0, xb - 15] : [xb + 15, 1 << 12];
  sh.breakX = xb; sh.breakSide = keepAft ? 1 : -1;                     // 斷開的那一團在 +x（船頭）那邊 ⇒ 1
  return cut;
}

// ───────────────────────── 取用點與送藥手（火藥與彈藥的補給） ─────────────────────────
// 史實：火藥桶不離開彈藥庫 —— 砲手長在裡面把火藥裝成藥包，從掛著濕毛氈的小艙口遞出來，送藥童一次一包、裝在皮筒裡跑上砲甲板；
//   彈丸擺在砲旁與艙口邊的彈架上。遊戲為了讓火藥在戰鬥裡「打得到」，兩層甲板（砲甲板、spar deck）在兩間彈藥庫的上方各放一個
//   取用點（3 桶火藥＋彈藥；Tim 2026-10-12），送藥手碰一下火藥桶就算拿了火藥與彈藥（簡化；一次 CARRY_N 份），送到砲旁的藥箱（每門最多 BOX_N 份 × 砲種表 box 發：一份 ＝ box 發，10_ship.js gunBoxK；兩個份數都在細節設定）。
//   砲開火後要從藥箱拿一份才開始裝填；藥箱空了 ⇒ 等送藥手（HUD △）。
// 危險（火藥血量拉滿 ＝ 全都不會爆；預設 675 ⇒ 藥包 203（一般命中要擲到偏高）、火光一次 300，要三次）：藥包（送藥手手上、砲旁藥箱）的血量 ＝ 火藥桶的 30%，吃到一下夠重的就著火爆炸；
//   取用點的桶被打到照火藥桶算；爆炸離取用點 3 m 內 ⇒ 火光竄下艙口：彈藥庫裡靠門最近的 6 桶各扣 300 × 威力 ⇒ 可能整間殉爆。
var CART_K = 0.3, MONKEY_SP = 26, FILL_T = 0.8, FLASH_R = 30, FLASH_DMG = 300, FLASH_CD = 3;
/** 彈藥庫是前／中／後哪一間（照關聯名字：彈藥庫-前／-中／-後；餘燼號只有一間中央的）。 */
/** 彈藥庫叫「前／中／後」：照關聯 meta `pos=fore／mid／aft`（TASK-0539）；沒有 ⇒ 照關聯名裡的字（舊匯出），都沒有 ⇒ 後。 */
var MAG_POS = { fore: '前', mid: '中', aft: '後' };
function magTag(mag) { if (MAG_POS[mag.pos]) return MAG_POS[mag.pos]; return mag.name.indexOf('前') >= 0 ? '前' : mag.name.indexOf('中') >= 0 ? '中' : '後'; }
/** 取用點：每層砲甲板（sh.decks，照砲的高度分，10_ship.js gunDecks）× 每間彈藥庫一個，放在彈藥庫正上方、中線旁一塊平的空地（9×9 格、頭上 8 格空、不碰砲）。
 *  甲板也是一間房（36_rooms.js deckPlan；TASK-0568）：玩家在船隻配置頁擺過那一層 ⇒ 照擺的格子放（每一處 ＝ 三桶；彈藥庫 ＝ x 最近的那間）；沒擺過 ⇒ 照舊自己找（auto ＝ 只照舊找：hullDeckKit 用）。 */
function makeStations(sh, auto) {
  var T = sh.T, BASE = T.base, CY = T.cy;
  var keg = sh.mags.reduce(function (a, m) { return a || m.kegs[0]; }, null); if (!keg || !T.rig.meshes[keg.mesh]) return [];
  // 取用點的三個桶輪流用彈藥庫裡不同樣子的桶（Tim 2026-10-18：「彈藥箱可以有不同外觀(但實際上都能補彈)」）：持火號的希臘火陶罐、弩箭箱⋯⋯ 都一樣能補；只有一種 ⇒ 三個都是它（跟以前一樣）
  //   樣子照桶的模型 meta `store`（補給的種類：greekfire、bolt⋯）分：每一種取第一個桶的網格；沒標的全部算同一種（＝ 第一個桶，跟以前一樣）。
  //   ⛔ 照網格分 ⇒ 憲法號兩間彈藥庫的桶擺法各不同、網格有 11／25 種 ⇒ 取用點換了樣子、外框跟著變，戰局不一樣（量過）
  var KM = [keg.mesh], KS = [(keg.meta && keg.meta.store) || ''];
  sh.mags.forEach(function (m) { m.kegs.forEach(function (k) { var st = (k.meta && k.meta.store) || ''; if (KS.indexOf(st) < 0 && T.rig.meshes[k.mesh] && KM.length < 3) { KS.push(st); KM.push(k.mesh); } }); });
  var KB = KM.map(function (mesh) { var V0 = T.rig.meshes[mesh].verts, a0 = [1e9, 1e9, 1e9], b0 = [-1e9, -1e9, -1e9]; for (var j0 = 0; j0 < V0.length; j0 += 3) for (var q = 0; q < 3; q++) { a0[q] = Math.min(a0[q], V0[j0 + q]); b0[q] = Math.max(b0[q], V0[j0 + q]); } return [a0, b0]; });   // 取用點的桶照哪一間的桶都行（⛔ 只看第一間 ⇒ 第一間沒桶整艘就沒有取用點）；都沒有桶 ⇒ 沒有取用點（匯入檢查報 ✗）
  var guns = sh.models.filter(function (m) { return GUNS[m.kind] || kindProp(m.kind, 'clear'); }), out = [];
  function clear(x, y, z) {
    for (var dy = 0; dy <= 9; dy += 3) for (var dx = 0; dx <= 9; dx += 3) { var zz = standZ(BASE, x + dx, y + dy, z - 1, z + 1, 8); if (zz < 0) return false; }
    return !guns.some(function (m) { var b = m.bb; return x + 11 > b[0] && x - 2 < b[3] && y + 11 > b[1] && y - 2 < b[4] && z + 8 > b[2] && z - 3 < b[5]; });
  }
  /** 從 x0 找一塊空地。dir 0 ⇒ 先在正上方 ±30 格找，找不到再往船頭、船尾兩邊找；dir ±1 ⇒ 只往那一頭找（x0 起算）。 */
  function findSpot(x0, dir, zr) {
    var spot = null, ex, e2, oy;
    if (!dir) for (var r = 0; r <= 30 && !spot; r += 2) for (var s = -1; s <= 1 && !spot; s += 2) for (var dx = -r; dx <= r && !spot; dx += 2) {
      var x = x0 + dx, y = s > 0 ? CY + 6 + (r - Math.abs(dx)) : CY - 15 - (r - Math.abs(dx)), z = standZ(BASE, x + 4, y + 4, zr[0], zr[1], 8);
      if (z >= 0 && clear(x, y, z)) spot = [x, y, z];
    }
    // 正上方沒有甲板（餘燼號的中央彈藥庫在船腰，上甲板那一段是開的）⇒ 沿那一層往船頭、船尾找最近的一塊空地
    // ⛔ 不找 ⇒ 那一層沒有取用點，送藥手只拿自己那一層的（stationFor）⇒ 上甲板 18 門 carronade 打完藥箱的兩發就永遠停了
    for (ex = dir ? 0 : 32; ex <= 400 && !spot; ex += dir ? 2 : 4) for (e2 = -1; e2 <= 1 && !spot; e2 += 2) for (oy = 0; oy < 4 && !spot; oy++) {
      if (dir && e2 !== dir) continue;
      var x2 = x0 + e2 * ex, y2 = [CY + 6, CY - 15, CY + 16, CY - 25][oy], z2 = standZ(BASE, x2 + 4, y2 + 4, zr[0], zr[1], 8);
      if (z2 >= 0 && clear(x2, y2, z2)) spot = [x2, y2, z2];
    }
    return spot;
  }
  // 只有一間彈藥庫（餘燼號的中央彈藥庫）⇒ 每層前後各一個取用點：從彈藥庫前端往船頭、後端往船尾各退 1.6 m 找（Tim 2026-10-13：「取用點分到前後兩處」）。
  //   ⛔ 一層只有一個、疊在彈藥庫正上方 ⇒ 那一層的送藥手全擠在船中段，電腦的瞄準點也在船中段 ⇒ 第一輪齊射就連炸（餘燼號對打 180 秒 2／3 場殉爆、一場第 4.5 秒）。
  //   兩間以上（憲法號前後兩間）⇒ 照舊每間正上方一個。送藥手照要送的那門砲挑最近的取用點（stationFor）⇒ 自然分成前後兩批。
  var MG0 = sh.mags.filter(function (m) { return !(m.tur >= 0); });   // 砲塔裡的彈藥箱另外擺（turStation）⇒ 不算在「只有一間」裡
  function anchors(mag) {
    if (MG0.length !== 1) return [{ x: Math.round(mag.blast[0]), dir: 0, tag: magTag(mag) }];
    return [{ x: Math.round(mag.box[3]) + 16, dir: 1, tag: '前' }, { x: Math.round(mag.box[0]) - 16, dir: -1, tag: '後' }];
  }
  function nearMag(x) { var best = sh.mags[0], bd = 1e9; sh.mags.forEach(function (m) { var d = Math.abs(m.blast[0] - x); if (d < bd) { bd = d; best = m; } }); return best; }
  function inGun(x, y, z) { return guns.some(function (m) { var b = m.bb; return x > b[0] - 2 && x < b[3] + 2 && y > b[1] - 2 && y < b[4] + 2 && z + 8 > b[2] && z - 3 < b[5]; }); }
  // 從艙口吊上去（TASK-0632；Tim 2026-10-16：「我看火藥直接裸露在頂層甲板上 原船設計是如何搬運火藥的」）：彈藥庫關聯 meta hoist=<梯子的路徑>（例 梯子/turret）⇒
  //   梯頭落在哪一層砲甲板，那一層的取用點就是這座梯子：桶擺在梯腳那一層（莫尼特號：住艙甲板，室內）、送藥手在梯頭（砲塔裡、艙口旁）取 ⇒ 火藥從艙口吊上來，⛔ 不擺在露天甲板；
  //   那一層不再照彈藥庫找空地（找不到梯腳的空地或梯頭的站位 ⇒ 照舊找，匯入檢查看得到取用點在哪）。梯子隨時能走（Tim：「讓樓梯隨時都能通行」，砲塔不用轉到右舷對位）。
  //   原船（Greene〈In the Monitor Turret〉）：彈藥庫在住艙甲板、中隔艙壁前的右舷；火藥經甲板與砲塔地板的艙口吊進砲塔。
  //   一間彈藥庫可以寫好幾座梯子（hoist=ladders-1#castle,ladders-1#forecastle；持火號：只有船尾一間藥庫，木塔、艏樓各一座梯子 —— Tim 2026-10-19「繼續完成待辦」：
  //   以前兩層都照彈藥庫往船頭找空地 ⇒ 兩層的取用點疊在木塔同一格、三個桶把木塔內側的走道堵死，木塔的弩砲照直線穿牆送、艏樓的照直線從木塔飛過去）⇒
  //   每一層只用梯頭落在那一層的那一座（下面 hoistPick）；只寫一座 ⇒ 跟以前一樣。
  var HO = [];
  sh.mags.forEach(function (m) { (m.hoists || []).forEach(function (nm) { var L = shipLadders(T).filter(function (l) { return l.name === nm; })[0]; if (L) HO.push({ mag: m, L: L }); }); });
  /** 這一層要吊的：梯頭高度在這一層範圍裡的；同一間有好幾座對得上（艏樓、木塔的高度範圍重疊）⇒ 挑梯頭在這一層甲板（meta）上的那一座，都不在 ⇒ 第一座。 */
  function hoistPick(D) {
    var zr = D.zr, hh = HO.filter(function (h) { var hz = h.L.pts[h.L.pts.length - 1][2]; return hz >= zr[0] - 2 && hz <= zr[1] + 2; });
    return hh.filter(function (h) {
      var same = hh.filter(function (o) { return o.mag === h.mag; }); if (same.length < 2) return true;
      var on = D.meta ? same.filter(function (o) { var p = o.L.pts[o.L.pts.length - 1], d = deckAt(T, p[0], Math.floor(p[2])); return !!d && d.i === D.meta.i; }) : [];
      return h === (on[0] || same[0]);
    });
  }
  function hoistStation(D, h) {
    var foot = h.L.pts[0], head = h.L.pts[h.L.pts.length - 1], spot = null, at = null, r, dx, dy;
    for (r = 0; r <= 24 && !spot; r++) for (dy = -r; dy <= r && !spot; dy++) for (dx = -r; dx <= r && !spot; dx++) {   // 梯腳旁一塊 9×9 的空地（梯子的側板、踏板是實心 ⇒ 自己會避開）
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      var x = Math.floor(foot[0]) + dx - 4, y = Math.floor(foot[1]) + dy - 4, z = standZ(BASE, x + 4, y + 4, foot[2] - 1, foot[2] + 1, 8);
      if (z >= 0 && clear(x, y, z)) spot = [x, y, z];
    }
    for (r = 0; r <= 12 && !at; r++) for (dy = -r; dy <= r && !at; dy++) for (dx = -r; dx <= r && !at; dx++) {   // 梯頭旁站得住、不在砲裡的一格（艙口本身是空的 ⇒ 站在艙口邊）
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      var x2 = Math.floor(head[0]) + dx, y2 = Math.floor(head[1]) + dy, z2 = standZ(BASE, x2, y2, head[2] - 1, head[2] + 1, 8);
      if (z2 >= 0 && !inGun(x2, y2, z2)) at = [x2 + 0.5, y2 + 0.5, z2];
    }
    if (spot && at) build(D, h.mag, D.name + '取用點（' + h.L.name.split('/').pop() + ' 艙口）', spot, at);
  }
  sh.decks.forEach(function (D) {
    var deck = D.key, zr = D.zr, pl = auto ? null : deckPlan(T.id, deckId(D));
    if (pl && pl.items) {                                               // 玩家擺的（驗過：格子、砲班的位置、地面）
      var G = deckGrid(T, D), ok = roomCheck(T, { grid: G }, 'deck', pl.items).items.filter(function (q) { return FURN[q.it] && FURN[q.it].role === 'powder'; });   // 甲板上也擺得了抽水機（45_pumps.js pumpModels）⇒ 這裡只拿火藥桶
      ok.forEach(function (q, k) { var x = G.x0 + q.x * ROOM_TILE, y = G.y0 + q.y * ROOM_TILE; build(D, nearMag(x), D.name + '取用點 ' + (k + 1), [x, y, G.zt[q.x + q.y * G.nx]]); });
      return;
    }
    var n0 = out.length;
    hoistPick(D).forEach(function (h) { hoistStation(D, h); });
    // 這一層有從艙口吊上來的 ⇒ 吊的那幾間不再找空地；沒有 hoist 的彈藥庫照舊找（TASK-0658 哨兵號：甲板上的備便彈藥櫃 ——
    //   原船的火藥從砲塔裡的艙口上來，砲塔那一圈走不穿（TASK-0655）⇒ 甲板上的速射砲要靠櫃子旁的取用點）。⛔ 以前整層 return ⇒ 第二間的取用點不見。
    //   只有一間、或每一間都有 hoist（莫尼特號）⇒ 跟以前一樣。
    sh.mags.forEach(function (m) { if (m.tur >= 0 && m.kegs.length && m.box[2] >= zr[0] - 2 && m.box[2] <= zr[1] + 2) turStation(D, m); });
    var rest = (out.length > n0 ? sh.mags.filter(function (m) { return !m.hoist; }) : sh.mags).filter(function (m) { return !(m.tur >= 0); });
    if (!rest.length) return;
    rest.forEach(function (mag) { anchors(mag).forEach(function (A) {
      var spot = findSpot(A.x, A.dir, zr);
      if (spot) build(D, mag, D.name + A.tag + '取用點', spot);
    }); });
  });
  return out;
  // 砲塔裡的彈藥箱（TASK-0659；Tim 2026-10-16：「砲塔內也要可以放彈藥箱」）：桶就是彈藥箱自己的（不另外擺），送藥手站在箱子旁、砲塔裡站得住、不在砲裡的一格；
  //   取用點跟著砲塔轉（27_turret.js turRiders：st.tur）。照開局的擺法找（砲塔座標 ＝ 開局的船的格座標）。
  function turStation(D, mag) {
    var b = mag.box, cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, at = null, bd = 1e9, TB = T.turrets[mag.tur].box, rk = turRootK(T, mag.tur), NB = navBase(T), RB = navRestB(T, rk);
    // 站得住 ＝ 不轉的甲板上（navBase：砲塔掃過的那一圈是牆 ⇒ 不會找到牆外、也不站進箱子掃過的那一圈）或會轉的甲板上（吊籃：照砲塔座標、腳下是砲塔的格）
    function sz(x, y, z0, z1) { var z = standZ(NB, x, y, z0, z1, 8); if (z >= 0) return z; z = standZ(RB, x, y, z0, z1, 8); return z >= 0 && armDeckK(T, x, y, z - 1) >= 0 ? z : -1; }
    for (var y = Math.floor(b[1]) - 4; y <= Math.ceil(b[4]) + 4; y++) for (var x = Math.floor(b[0]) - 4; x <= Math.ceil(b[3]) + 4; x++) {
      if (x >= b[0] - 1 && x <= b[3] + 1 && y >= b[1] - 1 && y <= b[4] + 1) continue;   // 箱子本身
      if (x < TB[0] || x > TB[3] || y < TB[1] || y > TB[4]) continue;  // 砲塔的框外
      var z = sz(x, y, D.zr[0], D.zr[1]); if (z < 0 || inGun(x, y, z)) continue;
      var d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); if (d < bd) { bd = d; at = [x + 0.5, y + 0.5, z]; }
    }
    if (!at) return;
    var st = { deck: D.key, mag: mag, name: D.name + magTag(mag) + '取用點（砲塔裡）', kegs: mag.kegs, pos: [cx, cy, b[2] + 3], flashT: -9, tur: mag.tur, at: at, slots: [at] };
    [[2, 0], [-2, 0], [0, 2], [0, -2]].forEach(function (o) {
      var x = Math.floor(at[0] + o[0]), y = Math.floor(at[1] + o[1]), z = sz(x, y, at[2] - 1, at[2] + 1);
      if (z >= 0 && !inGun(x, y, z) && !(x >= b[0] && x <= b[3] && y >= b[1] && y <= b[4]) && x >= TB[0] && x <= TB[3] && y >= TB[1] && y <= TB[4]) st.slots.push([x + 0.5, y + 0.5, z]);
    });
    out.push(st);
  }
  function build(D, mag, name, spot, up) {                             // up：吊上來的取用點，送藥手取藥的那一格（梯頭）；桶照樣擺在 spot
      var deck = D.key;
      var st = { deck: deck, mag: mag, name: name, kegs: [], pos: [spot[0] + 4.5, spot[1] + 4.5, spot[2] + 3], flashT: -9 };
      [[0, 0], [5, 0], [0, 5]].forEach(function (o, i) {
        var ki = i % KM.length, kn = KB[ki][0], kx = KB[ki][1];
        var org = [spot[0] + o[0], spot[1] + o[1], spot[2]], bb = [org[0] + kn[0], org[1] + kn[1], org[2] + kn[2], org[0] + kx[0], org[1] + kx[1], org[2] + kx[2]];
        var m = { T: T, k: sh.models.length, name: st.name + '-' + (i + 1), path: st.name + '/' + (i + 1), kind: 'powder', station: st, hp: powderHP(), hpMax: powderHP(), mesh: KM[ki], origin: org, bb: bb, pts: {}, meta: { kind: 'powder', powder_lb: 100 },
          c: [(bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2], foot: VK.pack(org[0] + 2, org[1] + 2, org[2] - 1), alive: true };
        sh.models.push(m); st.kegs.push(m);
      });
      if (up) {                                                         // 吊上來的：在梯頭取（站位 ＝ 梯頭旁站得住、不在砲裡的幾格）
        st.at = up; st.hoist = true;
        st.slots = [up].concat([[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, 2], [2, -2], [-2, -2]].map(function (o) {
          var x = Math.floor(up[0] + o[0]), y = Math.floor(up[1] + o[1]), z = standZ(BASE, x, y, up[2] - 1, up[2] + 1, 8);
          return z < 0 || inGun(x, y, z) ? null : [x + 0.5, y + 0.5, z];
        }).filter(Boolean));
        out.push(st); return;
      }
      st.at = [spot[0] + 5.5, spot[1] + 5.5, spot[2]];                 // 送藥手站在三桶圍出來的那一角
      // 站位：那一角＋桶堆外圍幾格（站得住、不在砲裡）；同時好幾個人來拿 ⇒ 各站一格（⛔ 全站同一點 ⇒ 幾張人疊在一起、姿勢不同，看起來像一個人在抖）
      st.slots = [st.at].concat([[13, 5.5], [5.5, 13], [13, 13], [13, -2], [-2, 13], [5.5, -3], [-3, 5.5], [-3, -3]].map(function (o) {   // 齊射後同一個取用點最多 8 人在路上或在拿
        var x = Math.floor(spot[0] + o[0]), y = Math.floor(spot[1] + o[1]), z = standZ(BASE, x, y, spot[2] - 1, spot[2] + 1, 8);
        return z < 0 || inGun(x, y, z) ? null : [x + 0.5, y + 0.5, z];
      }).filter(Boolean));
      out.push(st);
  }
}
/** 送藥手：每一對砲（同一層、同一個 x 的兩舷）一個，站在那一對砲中間靠中線；砲記著自己的送藥手（g.pm）與放藥箱的位置（g.drop：砲尾後面）。 */
function makeMonkeys(sh, crew, taken, add) {
  var pairs = {}, BASE = sh.T.base, CY = sh.T.cy;
  sh.guns.forEach(function (g) { var k = gunDeck(g) + ':' + Math.round(g.muz[0]); (pairs[k] = pairs[k] || []).push(g); });
  Object.keys(pairs).forEach(function (k, i) {
    var gs = pairs[k], deck = gunDeck(gs[0]), zr = sh.deckZ[deck], x = Math.round(gs[0].muz[0]);
    gs.forEach(function (g) {
      var br = g.model.pts.breech || g.model.c, sg = g.side === 'P' ? -1 : 1;
      var foreAft = Math.abs(g.ax[0]) > Math.abs(g.ax[1]), ex = g.ax[0] > 0 ? 1 : -1;
      var dropX = foreAft ? Math.floor(br[0] - ex * 7) : Math.floor(br[0]) + 3;
      var dropY = foreAft ? Math.floor(br[1]) : Math.floor(br[1] - sg * 7);
      g.drop = standNear(BASE, dropX, dropY, zr[0], zr[1], 12, {}) || (g.spots.length ? g.spots[g.spots.length - 1].at : null);
    });
    // Fore/aft guns: the muzzle can be outside the deck. Spawn behind the breech.
    if (Math.abs(gs[0].ax[0]) > Math.abs(gs[0].ax[1]) && gs[0].model.pts.breech)
      x = Math.round(gs[0].model.pts.breech[0] - (gs[0].ax[0] > 0 ? 6 : -6));
    sh.pmWant += sh.cw.monkeys;                                      // 船員配置：每一對砲幾個（0 ＝ 沒有送藥手，砲旁的藥箱用完就停；2 ＝ 第二個站另一邊）
    for (var m = 0; m < sh.cw.monkeys; m++) {
      var at = standNear(BASE, x, CY + ((i + m) % 2 ? 9 : -9), zr[0], zr[1], 12, taken);
      if (!at && gs[0].model.hd && gs[0].spots.length) {               // 架高的砲塔轉盤（定遠號的露砲台：轉盤比主甲板高 2 m、砲偏中線 5.2 m）⇒ 砲口那一欄靠中線沒有站得住的格 ⇒ 站到那門砲的砲班旁（navBase 連轉盤也算）
        var sp = gs[0].spots[gs[0].spots.length - 1].at; at = standNear(navBase(sh.T), Math.floor(sp[0]), Math.floor(sp[1]), zr[0], zr[1], 12, taken, 8);
      }
      if (!at) continue;
      add(ROLE.POWDER, at, null, 1);
      var c = crew[crew.length - 1]; c.deck = deck; c.guns = gs; c.pm = { st: 'idle', t: 0 }; c.cart = false;
      gs.forEach(function (g) { if (!g.pm) g.pm = c; });             // 砲認第一個（「送藥手倒了的砲」照它判斷）；第二個一樣送這一對
    }
  });
}
/** 別的送藥手已經要送去 g 的份數（在去拿、在拿、拿著送的；拿著的照手上的份數）。 */
function incoming(sh, c, g) {
  var n = 0;
  sh.crew.forEach(function (o) { if (o !== c && o.pm && o.pm.g === g && o.pm.st !== 'idle' && crewAble(o)) n += o.pm.st === 'carry' ? o.cart || 0 : CARRY_N; });
  return n;
}
/** 下一份送去哪門：同一層、走路格上走得到（砲塔那一圈隔開的不算）、還在、藥箱（算上別人已經在送的）沒滿、是自己的或送藥手倒了的砲；先送等著的、空的、有人操作的、自己的、近的。
 *  ⛔ 不算別人在送的 ⇒ 沒有送藥手的砲一缺，整層的送藥手全跑去拿（量到 8 個），沒搶到的拿著藥包站在桶邊等十幾秒。 */
function needGun(sh, c) {
  var best = null, bs = 1e9;
  sh.guns.forEach(function (g) {
    if (!g.alive || !g.drop || gunDeck(g) !== c.deck || g.box >= gunBoxCap(g) || (g.pm && g.pm !== c && crewAble(g.pm))) return;
    if (g.box + incoming(sh, c, g) * gunBoxK(g.type) >= gunBoxCap(g)) return;   // incoming 是份數 ⇒ × box 換成發
    if (!navReach(sh, c.pos, g.drop)) return;                          // 照直線走（monkeyTo）⇒ 隔著砲塔那一圈的砲不送（42_hands.js；Tim 2026-10-17「水手會穿進去」）
    var s = g.box / gunBoxK(g.type) * 10 + (g.needCart ? 0 : 5) + (g.pm === c ? 0 : 3) + (gunRate(g) > 0 ? 0 : 20) + Math.abs(g.muz[0] - c.pos[0]) / 40;
    if (s < bs) { bs = s; best = g; }
  });
  return best;
}
/** 去哪個取用點拿：同一層、彈藥庫還在的，離要送的那門最近的（一間殉爆了 ⇒ 跑另一間）。 */
function stationFor(sh, c, g) { return stationPick(sh, c.deck, g); }
/** 那一層給這門砲的取用點：x 最近的那個（以前就是這樣）—— 但它跟砲尾放藥箱的位置（g.drop）在走路格上不在同一塊、而同一層有別的取用點在同一塊 ⇒ 挑同一塊裡 x 最近的
 *  （TASK-0658 哨兵號：原船的取用點在砲塔那一圈裡（TASK-0655 走不穿），甲板上的速射砲離砲塔比離彈藥櫃近 ⇒ 以前被分到圈裡、照直線穿牆去拿）。
 *  走路格量不到（沒有、snap 不到）⇒ 照 x 最近。匯入檢查（75_shipcheck.js）用同一支。 */
function stationPick(sh, deck, g) {
  var sts = sh.stations.filter(function (st) { return st.deck === deck && !st.mag.gone; }); if (!sts.length) return null;
  function near(L) { return L.reduce(function (a, b) { return Math.abs(b.at[0] - g.muz[0]) < Math.abs(a.at[0] - g.muz[0]) ? b : a; }); }
  var best = near(sts); if (sts.length < 2 || !g.drop || !sh.nav) return best;
  var li = lvAt(sh, g.drop), N = li >= 0 && sh.nav.levels[li] ? sh.nav.levels[li].N : null; if (!N) return best;
  var gi = navSnap(N, g.drop, 4); if (gi < 0) return best;
  function same(st) { if (lvAt(sh, st.at) !== li) return false; var i = navSnap(N, st.at, 4); return i >= 0 && N.reg[i] === N.reg[gi]; }
  if (same(best)) return best;
  var ok = sts.filter(same);
  return ok.length ? near(ok) : best;
}
/** 在取用點站哪一格：別人（去拿、在拿）最少的那格，一樣多挑近的。 */
function slotFor(sh, c, st) {
  var best = st.at, bs = 1e9;
  (st.slots || [st.at]).forEach(function (s) {
    var n = sh.crew.filter(function (o) { return o !== c && o.pm && o.pm.src === st && o.pm.at === s && (o.pm.st === 'fetch' || o.pm.st === 'fill') && crewAble(o); }).length;
    var v = n * 1e4 + Math.hypot(s[0] - c.pos[0], s[1] - c.pos[1]);
    if (v < bs) { bs = v; best = s; }
  });
  return best;
}
/** 走到 to（格座標）；高度跟著甲板。到了回 true。直線走；會轉裝甲的船直線會碰到牆 ⇒ 照走路格一段一段走（42_hands.js navWay；c.mway 記著這一趟，目的地換了才重找）。 */
function monkeyTo(sh, c, to, dt) {
  var M = null, tg = to;
  if (sh.nav && sh.T.armor && sh.T.armor.length) {
    M = c.mway; if (!M || M.to !== to) M = c.mway = { to: to, w: navWay(sh, c.pos, to), k: 0 };
    tg = M.w[M.k];
  }
  var dx = tg[0] - c.pos[0], dy = tg[1] - c.pos[1], l = Math.hypot(dx, dy);
  if (l < 0.6 && M && M.k < M.w.length - 1) { c.pos[0] = tg[0]; c.pos[1] = tg[1]; M.k++; return false; }   // 走到中間那一點 ⇒ 下一段
  if (l < 0.6) { c.pos = to.slice(); c.moving = false; if (M) c.mway = null; return true; }
  var s = Math.min(l, MONKEY_SP * dt); c.pos[0] += dx / l * s; c.pos[1] += dy / l * s; c.moving = true;
  var zr = sh.deckZ[c.deck], z = standZ(sh.T.turDeck ? turStandG(sh) : sh.grid, Math.floor(c.pos[0]), Math.floor(c.pos[1]), zr[0], zr[1], 6); if (z >= 0) c.pos[2] = z;   // 有會轉的甲板 ⇒ 砲塔的格也踩得住（27_turret.js）
  return false;
}
function stepMonkey(sh, c, dt) {
  var P = c.pm; if (!P) return;
  if (sh.struck || sh.sunk) { c.moving = false; return; }
  if (P.st === 'idle') {
    var g = needGun(sh, c), st = g && stationFor(sh, c, g);
    if (!st) { monkeyTo(sh, c, c.home, dt); return; }                  // 都滿了（或沒地方拿）⇒ 回自己那一對砲中間等
    P.st = 'fetch'; P.src = st; P.g = g; P.at = slotFor(sh, c, st);
  }
  if (P.st === 'fetch') {
    if (P.src.mag.gone) { P.st = 'idle'; return; }
    if (monkeyTo(sh, c, P.at, dt)) { P.st = 'fill'; P.t = FILL_T; }
    return;
  }
  if (P.st === 'fill') { c.moving = false; if ((P.t -= sh.qmK !== undefined ? dt * crewEff(sh, c) * sh.qmK : dt * crewEff(sh, c)) <= 0) { c.cart = CARRY_N; P.st = 'carry'; } return; }   // 工作效率（TASK-0720，39_eff.js；沒開 ⇒ × 1）：裝藥包快；搬運是走路、不乘
  if (P.st === 'carry') {
    if (!c.cart) { P.st = 'idle'; return; }                            // 藥包炸掉或掉了
    if (!P.g || !P.g.alive || P.g.box >= gunBoxCap(P.g)) P.g = needGun(sh, c);
    if (!P.g) { monkeyTo(sh, c, c.home, dt); return; }                 // 都滿了 ⇒ 拿著回自己那一對砲中間等（⛔ 不站在桶邊：擋住下一個來拿的）
    if (monkeyTo(sh, c, P.g.drop, dt)) {                               // 放進藥箱（放得下多少放多少）；手上還有 ⇒ 送下一門
      var bk = gunBoxK(P.g.type), put = Math.min(c.cart, Math.ceil((gunBoxCap(P.g) - P.g.box) / bk)); P.g.box = Math.min(gunBoxCap(P.g), P.g.box + put * bk); c.cart -= put;   // 一份 ＝ box 發（砲種表；沒寫 ＝ 1 ⇒ 跟以前一樣）
      if (c.cart <= 0) { c.cart = 0; P.st = 'idle'; } else P.g = null;
    }
  }
}
/** 送藥手手上的藥包吃到一下（damageCrew 轉過來）：夠重 ⇒ 著火爆炸。 */
function cartHit(sh, c, dmg) {
  if (powderNever() || dmg < powderHP() * CART_K) return;
  var n = c.cart; c.cart = 0; cartBoom(sh, [c.pos[0], c.pos[1], c.pos[2] + 9], n, '送藥手手上的藥包炸了');
}
/** 砲旁的藥箱（damageModel 打到砲時轉過來）。 */
function boxHit(sh, g, dmg) {
  if (!(g.box > 0) || powderNever() || dmg < powderHP() * CART_K) return;
  var n = Math.ceil(g.box / gunBoxK(g.type)); g.box = 0; cartBoom(sh, g.model.c, n, sideName(g.side) + GUNS[g.type].short + '旁的藥箱炸了');
}
/** 藥包爆炸（n 份）：小洞、旁邊的人與模型（取用點的桶 ⇒ 連鎖）、可能竄下艙口。 */
function cartBoom(sh, L, n, what) {
  if (sh.sink > 40) return;
  sh.cartN = (sh.cartN || 0) + 1;                                       // 讀數：藥包炸了幾次
  var f = blastRoll(), k = blastK() * Math.cbrt(n * f), w = M4.pt(sh.M, L[0], L[1], L[2]), r = shatter(sh, L, [0, 0, 1], 3.5 * k, [0, 4, 0], 60, 1), reach = 18 * k;
  explode(w, sh, r.n);
  crewHurt(sh, L, 8 * k, 22 * k, null, '火藥', 200 * BLAST_K * f * Math.cbrt(n));
  sh.models.forEach(function (o) {
    if (!o.alive) return;
    var d = len(sub(o.c, L)); if (d > reach) return;
    var cw = M4.pt(sh.M, o.c[0], o.c[1], o.c[2]);
    damageModel(sh, o, mul(norm(sub(cw, w)), 120 * (1 - d / reach) + 40), 150 * BLAST_K * f * Math.cbrt(n) * (1 - 0.75 * d / reach));
  });
  if (what) note(sh, '<b style="color:#ffb35a">' + what + '</b>');
  flashCheck(sh, L);
}
/** 爆炸離取用點 3 m 內 ⇒ 火光順著艙口竄下彈藥庫：靠門最近的 6 桶各扣 300 × 威力（**同一間彈藥庫** 3 秒內只算一次）。
 *  ⛔ 以前照取用點算：下層、上層砲甲板的取用點上下疊著（相距 2.3 m），一次爆炸同時在兩個的 3 m 內 ⇒ 竄下兩次、門邊的桶吃 600
 *  ⇒ 娛樂 450 一次就整間殉爆（「要竄下去幾次才會著」的設計整個沒了）；餘燼號對打第 4.8 秒、憲法號也一樣會中。 */
function flashCheck(sh, L) {
  (sh.stations || []).forEach(function (st) {
    if (st.mag.gone || SIMT - (st.mag.flashT === undefined ? -99 : st.mag.flashT) < FLASH_CD || len(sub(L, st.pos)) > FLASH_R) return;
    st.flashT = st.mag.flashT = SIMT;
    var door = (st.mag.pts && st.mag.pts.door) || st.mag.blast;
    var near = st.mag.kegs.filter(function (m) { return m.alive && !m.lit; }).sort(function (a, b) { return len(sub(a.c, door)) - len(sub(b.c, door)); }).slice(0, 6);
    if (!near.length) return;
    note(sh, '<b style="color:#ff9a7a">火光竄下' + magTag(st.mag) + '彈藥庫的艙口！</b>', true);
    near.forEach(function (m) { powderHit(sh, m, FLASH_DMG * BLAST_K); });
  });
}
