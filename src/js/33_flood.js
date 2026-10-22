// ───────────────────────── 進水：粒子模式（TASK-0525） ─────────────────────────
// 兩種模式（Tim 2026-10-13）：物理效果的「進水」第 0 檔 ＝ 公式（32_hull.js：水線下破洞數 × √水深）；1–3 檔 ＝ 粒子（粗／中／細）。全開 ＝ 細。
// 粒子模式：進水量、下沉、傾斜完全由艙內的水決定 ——
//   · 破口：船殼最外那一層被打掉、而且往艙內一路通到原本是空的地方（flHoleRedo），每 c × c 格算一塊（面積 ＝ 通的格數 × S²）。
//     流量照 Torricelli：FL_C × 面積 × √(2g × 水頭差) × 滑桿／預設（細節設定的「進水速度」；預設 0.35 ⇒ ×1 ＝ 物理的流量）。
//     水頭差 ＝ 外面的水面（seaH，照浪）減艙內在那個洞的水面，兩邊都不低於洞本身 ⇒ 浮出水面的洞不進水；艙內的水比外面高 ⇒ 往外流。
//   · 流進來的水是粒子（每顆帶 vj m³）：從洞往艙內噴（初速 √(2g × 水頭差)），照重力在船的座標裡落下，碰到船體或水面就併進水格。粒子滿了 ⇒ 直接併進洞旁那一格。
//   · 水格（每格 c 格見方，存水量 m³）：往下流（照那一格最密的那一層開著幾成：甲板擋、艙口與破洞讓水下去）；滿了往上擠；
//     往旁邊流照水面的世界高度（船的矩陣，含傾斜與浪的搖晃）⇒ 船一傾斜，水往低的那一舷跑，再把船壓得更斜（自由液面）。
//   · 抽水機：每秒從最低的那一層水抽掉 FL_PUMP × pumpK ×（滑桿／預設）m³（FL_PUMP ＝ 每分鐘 18 噸海水：四台鏈式抽水機全力抽；pumpK ＝ 那一型的基礎抽水量 cfg.pump／18，TASK-0604）。
//     ⛔ 照公式那邊的抽水換算（0.004 m/s × 水線面積 ≈ 每秒 0.84 m³）⇒ 比水線附近那幾個洞進得還快，戰鬥 420 秒艙裡一滴水都留不住（量過）。
//   · 船：艙內的水 ＝ 加上去的重量 ⇒ 照浮力表（32_hull.js liftFor）算多吃水多少，sh.sink 照它慢慢跟過去（FL_TAU 秒）；
//     水的重心偏哪一舷 ⇒ 往那邊傾斜（穩心高 FL_GM，見下）、偏船頭船尾 ⇒ 縱傾（FL_GML）；上限跟公式一樣（開始沉之前 0.21 rad、縱傾 0.07）。
//     開始沉（下沉 4.2 m）之後照舊加速沉下去；斷成兩截照舊（公式，一定沉）。
// 精細等級 FL_LV：c 水格邊長幾格、ev 幾步算一次水格、jn 粒子上限（每艘）、vj 每顆帶多少 m³、dn 每次最多重算幾格被打壞的水格與破口。
// 戰局：自己的亂數 rndF（開局重設）；各檔水格不同 ⇒ 各檔是各自的一局（同一個種子各自逐字重現）。⛔ 不碰 rnd()、不讀畫面的設定。
//   進水模式開戰時決定（FLOOD_LV，70_flow.js），戰鬥中改了下一場生效。
var FL_LV = [null, { c: 10, ev: 4, jn: 300, vj: 0.25, dn: 120 }, { c: 7, ev: 2, jn: 800, vj: 0.08, dn: 200 }, { c: 5, ev: 2, jn: 2000, vj: 0.03, dn: 300 }, { c: 5, ev: 2, jn: 0, vj: 0.03, dn: 300, room: true }];
// 第 4 檔「房間」（TASK-0810）：破口照細檔的格（c 5）切、記；水不走水格與粒子 ⇒ flRoomStep 交給房間模擬（33_wrsim.js wrsStep），讀數（vol、comX／Y、進出、抽水）寫回 fl ⇒ 下沉與傾斜（32_hull.js）照舊讀 fl。
//   船型沒有房間（T.wrm）⇒ wrsInit 回 null ⇒ 這一檔照細檔的水格走（jn 0：粒子直接併進水格）。
// FL_GM 穩心高（Tim 2026-10-13：傾斜收一點）：1.1 m（巡防艦的量級）⇒ 水往低的那一舷跑（自由液面），一舷有洞積 200 噸就斜到上限 12°、兩舷都有洞也一樣；
//   4 m ⇒ 一舷有洞 180／380／600／840 噸時 1.9°／4.7°／8.4°／12°，兩舷都有洞 1,140 噸才 3.7°（沙盒 60 秒量的；2 m、3 m 還是很快頂到上限，5 m 一舷 830 噸才 8.3°）。
// FL_PUMP（Tim 2026-10-18「統一都改成 噸 分顯示吧」）：抽水量的設定是噸／分 ⇒ 換成 m³/s 要除海水密度（PUMP_REF 噸／分 ÷ 60 ÷ RHO_W ≈ 0.293）。
//   ⛔ 以前寫死 0.3（把 1 m³ 當 1 噸）⇒ 設定 18 噸／分、實際抽 18.45 噸／分，進水細節頁「抽水 18.0（實際 18.4）」對不上。
var FL_C = 1.0, FL_PUMP = PUMP_REF / 60 / RHO_W, FL_GM = 4, FL_GML = 60, FL_TAU = 2;
var FL_HIDE = false, FLOOD_LV = 0;
var RNG_F = rngMake('flood', 0x3C6EF372), rndF = RNG_F.f, rgF = RNG_F.r;   // 進水粒子（00_core.js 亂數工廠）
/** 船型 T 的水格（邊長 c 格；第一次用到時算，掛在 T.flc[c]）：兩舷船殼最外那一格（yP／yM，每個 (x, z)）、每格能裝多少（cap：艙內空的比例）、往下通多少（pd：最密那一層開著的比例）。
 *  照船殼 T.hullG（砲帶的裝甲拆掉之後，24_armor.js；沒有裝甲 ＝ T.base）：⛔ 照含裝甲的 ⇒ 砲塔圓筒當成外殼，sh.grid 裡沒有它 ⇒ flHoleRedo 一量就是破口。 */
function flType(T, c) {
  var K = T.flc || (T.flc = {}); if (!K[c]) stepsRun(flTypeSteps(T, c));
  return K[c];
}
/** flType 拆成幾步（兩舷的船殼、艙內格數、實心格數（照區塊層分段）、每格的量；同一型第一次約 0.1 s ⇒ 70_flow.js startStaged 開局分段做）。已經有了 ⇒ []。照順序做 ＝ 拆之前的 flType。 */
/** 船型 T 的船殼內側（水格 flTypeSteps 與水的房間 33_wrooms.js 共用一份；TASK-0807 從 flTypeSteps 第一步搬出來，算法一字不改）：
 *  每個 (x, z) 兩舷船殼最外那一格 yP／yM（沒有 ⇒ −1；艙內 ＝ yM < y < yP）、範圍 x0–x1、zTop、ylo–yhi。掛在 T.flSkin；⛔ yP／yM 算完不改（兩邊共用）。 */
function flSkin(T) {
  if (T.flSkin) return T.flSkin;
  var B = T.hullG, zTop = Math.min(B.sz, T.zw + 46), x0 = Math.max(0, T.wl0 - 4), x1 = Math.min(B.sx - 1, T.wl1 + 4), cy = T.cy, TW = T.hullTW, HB = T.hullHB, x, y, z;
  var nxv = x1 - x0 + 1, yP = new Int16Array(nxv * zTop).fill(-1), yM = new Int16Array(nxv * zTop).fill(-1), ylo = 1e9, yhi = -1;
  for (z = 0; z < Math.min(zTop, T.hullTH); z++) for (x = x0; x <= x1; x++) {
    var hb = HB[z * TW + x]; if (!hb) continue;
    var k = z * nxv + x - x0;
    for (y = Math.min(B.sy - 1, Math.ceil(cy + hb)); y > cy; y--) if (B.get(x, y, z)) { yP[k] = y; break; }
    for (y = Math.max(0, Math.floor(cy - hb - 1)); y < cy; y++) if (B.get(x, y, z)) { yM[k] = y; break; }
    if (yP[k] < 0 || yM[k] < 0) { yP[k] = yM[k] = -1; continue; }
    if (yM[k] < ylo) ylo = yM[k]; if (yP[k] > yhi) yhi = yP[k];
  }
  return T.flSkin = { B: B, zTop: zTop, x0: x0, x1: x1, nxv: nxv, yP: yP, yM: yM, ylo: ylo, yhi: yhi };
}
function flTypeSteps(T, c) {
  var K = T.flc || (T.flc = {}); if (K[c]) return [];
  var B, zTop, x0, x1, nxv, yP, yM, ylo, yhi, x, y, z, NX, NY, NZ, N, F, intC, solC, intL, solL;
  return [function () {
    var K0 = flSkin(T); B = K0.B; zTop = K0.zTop; x0 = K0.x0; x1 = K0.x1; nxv = K0.nxv; yP = K0.yP; yM = K0.yM; ylo = K0.ylo; yhi = K0.yhi;
  }, function () {
    NX = Math.ceil(nxv / c), NY = Math.ceil((yhi - ylo + 1) / c), NZ = Math.ceil(zTop / c), N = NX * NY * NZ;
    F = { c: c, X0: x0, Y0: ylo, NX: NX, NY: NY, NZ: NZ, N: N, nxv: nxv, zTop: zTop, yP: yP, yM: yM, cap: new Float32Array(N), pd: new Float32Array(N), op: new Float32Array(N * c), ol: new Float32Array(N * c) };   // op：每格每一層空著幾格（水照層疊上去：畫水面、flPd）；ol：那一層開著幾成（那一層沒有艙內 ⇒ −1）
    intC = new Int32Array(N), solC = new Int32Array(N), intL = new Int32Array(N * c), solL = new Int32Array(N * c);
    for (z = 0; z < zTop; z++) for (x = x0; x <= x1; x++) {
      var kk = z * nxv + x - x0, a = yM[kk] + 1, b = yP[kk] - 1; if (yP[kk] < 0 || b < a) continue;
      var cxi = ((x - x0) / c) | 0, czi = (z / c) | 0, lz = z % c;
      for (var cyi = ((a - ylo) / c) | 0; cyi <= (((b - ylo) / c) | 0); cyi++) {
        var lo = Math.max(a, ylo + cyi * c), hi = Math.min(b, ylo + cyi * c + c - 1), cell = (czi * NY + cyi) * NX + cxi;
        intC[cell] += hi - lo + 1; intL[cell * c + lz] += hi - lo + 1;
      }
    }
  }, function () {                                                     // 實心格數：整份格子照區塊層分段走（B.each 的順序；只是計數 ⇒ 跟先後無關）
    function cell(x, y, z) {
      if (z >= zTop || x < x0 || x > x1) return;
      var kk = z * nxv + x - x0; if (!(y > yM[kk] && y < yP[kk])) return;
      var cl = (((z / c) | 0) * NY + (((y - ylo) / c) | 0)) * NX + (((x - x0) / c) | 0); solC[cl]++; solL[cl * c + z % c]++;
    }
    return [stepsLoop(0, B.nz, function (cz) { gridEachZ(B, cz, cell); }, 15)];
  }, function () {
    for (var i = 0; i < N; i++) {
      F.cap[i] = (intC[i] - solC[i]) / (c * c * c);
      var p = 1, any = false;
      for (var l = 0; l < c; l++) { var il = intL[i * c + l]; F.op[i * c + l] = il - solL[i * c + l]; F.ol[i * c + l] = il > 0 ? (il - solL[i * c + l]) / il : -1; if (il > 0) { any = true; p = Math.min(p, (il - solL[i * c + l]) / il); } }
      F.pd[i] = any ? p : 0;
    }
    K[c] = F;
  }];
}
/** 開一艘船的進水狀態（makeShip；公式模式 ⇒ null）。 */
function flNew(sh) {
  var L = FL_LV[FLOOD_LV]; if (!L) return null;
  var F = flType(sh.T, L.c), N = F.N, H = 2 * F.NX * F.NZ;
  return { L: L, F: F, cap: F.cap.slice(), pd: F.pd.slice(), op: F.op.slice(), ol: F.ol.slice(), A: new Float32Array(N), on: new Uint8Array(N), act: new Int32Array(4096), actN: 0, dmark: new Uint8Array(N), dirty: [],
    hA: new Float32Array(H), hX: new Float32Array(H), hY: new Float32Array(H), hZ: new Float32Array(H), hYi: new Float32Array(H), hAcc: new Float32Array(H), hPort: new Float32Array(H), hmark: new Uint8Array(H), hon: new Uint8Array(H), hdirty: [], holes: [], hWet: new Uint8Array(H), hQ: new Float32Array(H),   // 每個破口上一次算的狀態（flHoleState）：hWet 在海面下、hQ 流量 m³/s（＋進水、−出水、0 沒在流）
    J: { n: 0, p: new Float32Array(L.jn * 3), v: new Float32Array(L.jn * 3), vol: new Float32Array(L.jn), life: new Float32Array(L.jn) },
    vol: 0, area: 0, open: 0, inQ: 0, outQ: 0, pumpQ: 0, netQ: 0, underN: 0, underA: 0, outN: 0, avg: null, avgAcc: { t: 0, inQ: 0, outQ: 0, pumpQ: 0 }, inTot: 0, outTot: 0, pumped: 0, comX: 0, comY: 0, sinkT: 0, step: 0, gen: 0, mesh: null,
    dq: new Float32Array(N), dqOn: new Uint8Array(N), dqL: [], dqT: 0, fo: new Map(),   // dq…：往下流的量（只給畫面的水幕，flFalls；⛔ 模擬不讀）；fo：每一格往下流的開口在哪（快取）
    lq: new Float32Array(N * 4), lqT: 0 };                               // lq：每一格往前後左右流了多少（只給畫面的水瀑，flSides；⛔ 模擬不讀）
}
function flAct(fl, i) {
  if (fl.on[i]) return; fl.on[i] = 1;
  if (fl.actN >= fl.act.length) { var a = new Int32Array(fl.act.length * 2); a.set(fl.act); fl.act = a; }
  fl.act[fl.actN++] = i;
}
/** 打掉一格（20_shatter.js removeVoxel）：那一格所在的水格、靠近船殼的話那一塊破口，記下來待重算。 */
function floodTouch(sh, x, y, z) {
  var fl = sh.fl, F = fl.F, c = F.c;
  if (z >= F.zTop || z < 0 || x < F.X0 || x >= F.X0 + F.nxv) return;
  var iy = ((y - F.Y0) / c) | 0, bx = ((x - F.X0) / c) | 0, bz = (z / c) | 0;
  if (y >= F.Y0 && iy < F.NY) { var i = (bz * F.NY + iy) * F.NX + bx; if (!fl.dmark[i]) { fl.dmark[i] = 1; fl.dirty.push(i); } }
  var k = z * F.nxv + x - F.X0, yp = F.yP[k]; if (yp < 0) return;
  var side = Math.abs(y - yp) <= Math.abs(y - F.yM[k]) ? 0 : 1, d = side ? y - F.yM[k] : yp - y;
  if (d > 30 || d < -2) return;
  var h = (side * F.NX + bx) * F.NZ + bz; if (!fl.hmark[h]) { fl.hmark[h] = 1; fl.hdirty.push(h); }
}
/** 被打壞的水格重算（照現在的格）：能裝多少、往下通多少。 */
function flCellRedo(sh, fl, i) {
  var F = fl.F, c = F.c, ix = i % F.NX, iy = ((i / F.NX) | 0) % F.NY, iz = (i / (F.NX * F.NY)) | 0, Gd = sh.grid, it = 0, st = 0, p = 1, any = false;
  for (var l = 0; l < c; l++) {
    var z = iz * c + l, il = 0, sl = 0; fl.op[i * c + l] = 0; fl.ol[i * c + l] = -1; if (z >= F.zTop) continue;
    for (var dx = 0; dx < c; dx++) {
      var x = F.X0 + ix * c + dx; if (x - F.X0 >= F.nxv) break;
      var k = z * F.nxv + x - F.X0; if (F.yP[k] < 0) continue;
      var a = Math.max(F.yM[k] + 1, F.Y0 + iy * c), b = Math.min(F.yP[k] - 1, F.Y0 + iy * c + c - 1);
      for (var y = a; y <= b; y++) { il++; if (Gd.get(x, y, z)) sl++; }
    }
    fl.op[i * c + l] = il - sl; fl.ol[i * c + l] = il > 0 ? (il - sl) / il : -1; it += il; st += sl; if (il > 0) { any = true; p = Math.min(p, (il - sl) / il); }
  }
  fl.cap[i] = (it - st) / (c * c * c); fl.pd[i] = any ? p : 0;
  fl.fo.delete(i);                                                        // 水幕的開口照新的格重找（只給畫面）
  if (fl.cutS && flGone(fl, ix)) flDrop(fl, i);                           // 斷開那一截（flCut）：那一團的格被拿走時照樣會記髒 ⇒ 重算完照舊拿掉
}
/** 一塊破口重算：c × c 個船殼最外的點，每點從外往裡走，先碰到還在的格 ⇒ 不通；先走到原本是空的（艙內）⇒ 通；砲口（fl.portAt，TASK-0822）⇒ 通。面積 ＝ 通的點數 × S²，記下中心與艙內那一側。 */
function flHoleRedo(sh, fl, h) {
  var F = fl.F, c = F.c, side = (h / (F.NX * F.NZ)) | 0, r = h % (F.NX * F.NZ), bx = (r / F.NZ) | 0, bz = r % F.NZ, Gd = sh.grid, B = sh.T.hullG, s = side ? 1 : -1;
  if (fl.cutS && flGone(fl, bx)) { fl.hA[h] = 0; return; }               // 斷開那一截的船殼不算破口（flCut）
  var n = 0, np = 0, sx = 0, sy = 0, sz = 0, si = 0;
  for (var dz = 0; dz < c; dz++) for (var dx = 0; dx < c; dx++) {
    var x = F.X0 + bx * c + dx, z = bz * c + dz; if (x - F.X0 >= F.nxv || z >= F.zTop) continue;
    var pk = fl.portAt ? fl.portAt.get((side * F.nxv + x - F.X0) * F.zTop + z) : undefined;   // 砲口（25_doors.js portOpen：沒有蓋板、或蓋板被打壞了）⇒ 原本就開著
    if (pk !== undefined) { n++; np++; sx += x; sy += pk; sz += z; si += pk + s * 4; continue; }
    var k = z * F.nxv + x - F.X0, y0 = side ? F.yM[k] : F.yP[k]; if (y0 < 0) continue;
    for (var t = 0; t < 30; t++) { var y = y0 + s * t; if (Gd.get(x, y, z)) break; if (!B.get(x, y, z)) { n++; sx += x; sy += y0; sz += z; si += y; break; } }
  }
  fl.hA[h] = n * S * S; fl.hPort[h] = np * S * S;                        // hPort：這一塊裡砲口那一份（整塊都是砲口、又在海面上 ⇒ 不算破口：讀數、畫面）
  if (n) { fl.hX[h] = sx / n + 0.5; fl.hY[h] = sy / n + 0.5; fl.hZ[h] = sz / n + 0.5; fl.hYi[h] = si / n + 0.5; if (!fl.hon[h]) { fl.hon[h] = 1; fl.holes.push(h); } }
}
/** 第 i 格的水往下流得過去幾成：從這一格最下面那層往上、到水（W 格，照層疊）淹到的那一層為止，每層開著幾成取最小（Tim 2026-10-15：「水會跑到平頂上(且高出海平面) 應該要流下去才對」）。
 *  ⛔ 以前（pd）整格每一層取最小 ⇒ 格子上半截有頂板、甲板 ⇒ 0 ⇒ 天花板底下那兩層的水永遠下不去（維吉尼亞號砲廓頂底下：船晃、下沉過之後留在高處，比海面還高）。
 *  水上面的頂板不算；水底下（或水本身那一層）有甲板 ⇒ 照舊擋住。 */
function flPd(fl, i, W) {
  var c = fl.F.c, o = i * c, p = 1, any = false;
  for (var l = 0; l < c; l++) { var f = fl.ol[o + l]; if (f < 0) continue; any = true; if (f < p) p = f; var n = fl.op[o + l]; if (n > 0) { if (W <= n) break; W -= n; } }
  return any ? p : 0;
}
/** 這一格（格座標）在不在船殼外形裡面（照船型的外形 F.yM／F.yP，⛔ 不看打壞了沒）。 */
function flInHull(F, x, y, z) {
  if (z < 0 || z >= F.zTop || x < F.X0 || x >= F.X0 + F.nxv) return false;
  var k = z * F.nxv + x - F.X0; return F.yP[k] >= 0 && y > F.yM[k] && y < F.yP[k];
}
/** 艙內那一點 (x, y, z)（格座標）所在的水格；不在格子範圍 ⇒ −1。 */
function flCell(F, x, y, z) {
  var ix = Math.floor((x - F.X0) / F.c), iy = Math.floor((y - F.Y0) / F.c), iz = Math.floor(z / F.c);
  if (ix < 0 || iy < 0 || iz < 0 || ix >= F.NX || iy >= F.NY || iz >= F.NZ) return -1;
  return (iz * F.NY + iy) * F.NX + ix;
}
// ── 泡水判定（通用；Tim 2026-10-16：「可以把泡水判定抽成通用API嗎」）──
// 船上的東西泡沒泡水都問這兩支：砲口（43_swim.js gunWet）、船員的頭與躺著的臉（43_swim.js crewWet）、抽水機與鍋爐（45_pumps.js）、垂下來的繩（30_rig_physics.js underWater）、碎帆（34_shreds.js shredWet）。
//   wetAt(sh, p, o)：船 sh 上的一點 p（格座標）泡在水裡嗎。o（都可以不給）：
//     sea   看海面（預設 true）：世界座標在海面（跟著浪，08_sea.js seaH）下面；depth ＝ 要在海面下多深才算（m，預設 0）；touch ＝ 剛好碰到海面也算（≤，碎帆用）。
//     inner 看艙內的水（0–1，預設不看）：那一格的水滿了這麼多成就算（粒子模式 33_flood.js；公式模式看不到艙內的水 ⇒ 這一項永遠不算）。
//     兩項都開 ⇒ 任一項成立就算。
//   wetLatch(o, under, n)：遲滯（n 預設 2）—— o.wetN 計數，連 n 次 under 才變成泡水（o.wet ＝ true）、連 n 次乾了才回來；回 1 ＝ 這一次變成泡水、−1 ＝ 這一次乾了、0 ＝ 沒變。
//     ⛔ 一次就算 ⇒ 浪打上甲板一下、船搖一下就停（抽水機 2026-10-16 量到：莫尼特號的甲板幾乎貼著水面）。
function wetAt(sh, p, o) {
  o = o || {};
  if (o.sea !== false) {
    var w = M4.pt(sh.M, p[0], p[1], p[2]), d = o.depth || 0, bd = seaBound();   // 先比海面的上下限（08_sea.js seaBound；TASK-0673：drownCheck 每個船員一次、八艘擠在同一步 30 ms）⇒ 結果不變
    if (w[1] < seaLow() - d) return true;                               //   比最低的浪谷還低 ⇒ 一定在水下（大漩渦：再往下漏斗的深度，08_sea.js seaLow）
    if (w[1] <= bd - d) { var h = seaH(w[0], w[2], SIMT) - d; if (o.touch ? w[1] <= h : w[1] < h) return true; }   //   比最高的浪頭還高 ⇒ 一定不在水下，不用算
  }
  if (!(o.inner > 0)) return false;
  var fl = sh.fl, i = fl ? flCell(fl.F, p[0], p[1], p[2]) : -1;
  return i >= 0 && fl.cap[i] > 0.02 && fl.A[i] >= o.inner * fl.cap[i] * Math.pow(fl.F.c * S, 3);
}
function wetLatch(o, under, n) {
  n = n || 2;
  o.wetN = under ? Math.min(n, (o.wetN || 0) + 1) : Math.max(0, (o.wetN || 0) - 1);
  if (!o.wet && o.wetN >= n) { o.wet = true; return 1; }
  if (o.wet && o.wetN === 0) { o.wet = false; return -1; }
  return 0;
}
/** 一艘船的進水讀數（__game.flood 與進水報表 81_floodlab.js 共用同一份）。 */
/** 破口 h 現在是進水 'in'、出水 'out'（艙內的水比洞口外面的水面高 ⇒ 往外流；Tim 2026-10-18「就是破口高於海面」），還是沒在流 'dry'（上一次 floodStep 算的，sh.fl.hQ）。
 *  Tim 2026-10-18「可以放到邏輯層嗎(知道每個破口是在進水或出水)」「這樣所有需要這個資訊的地方都能取用」：畫面（詳細資訊的進水圖、進水細節頁、透視的破口點）都讀這裡，不再各自重算海面。 */
// 讀數都在模擬裡記好、畫面直接拿（Tim 2026-10-18「這些資訊都可以在模擬層紀錄(顯示層直接取用)」）：每次 floodStep ——
//   inQ／outQ 進、出水，pumpQ 實際抽掉的，netQ 淨進水（＝ inQ − outQ − pumpQ；正 ⇒ 水還在變多），全是 m³/s；
//   open／area 破口幾處、多大，underN／underA 海面下的，outN 出水的；每個破口 hWet、hQ（flHoleState）。⛔ 模擬只記、不讀。
// 流量的平均（Tim 2026-10-18「進水的刷新可以慢一點(目前跳動太快)」「可以取一段時間內的平均?」「除了積水」「水下 外流也是即時顯示」）：
//   進水、出水、實際抽、淨進水每次 floodStep 都跟著浪跳 ⇒ 照時間加權累加，滿 FL_AVG_T 秒（模擬時間）結算一次 ⇒ fl.avg ＝ { inQ, outQ, pumpQ, netQ }（m³/s）。
//   畫面的流量讀 fl.avg（flRates：還沒滿第一段 ⇒ 用即時的）；積水、破口幾處多大、水下、出水幾處照舊即時。⛔ 模擬只記、不讀。
var FL_AVG_T = 2;
function flAvgStep(fl, dt) {
  var a = fl.avgAcc; a.t += dt; a.inQ += fl.inQ * dt; a.outQ += fl.outQ * dt; a.pumpQ += fl.pumpQ * dt;
  if (a.t < FL_AVG_T) return;
  var o = { inQ: a.inQ / a.t, outQ: a.outQ / a.t, pumpQ: a.pumpQ / a.t }; o.netQ = o.inQ - o.outQ - o.pumpQ;
  fl.avg = o; a.t = a.inQ = a.outQ = a.pumpQ = 0;
}
/** 畫面讀的流量：最近一段 FL_AVG_T 秒的平均；還沒有 ⇒ 即時的。 */
function flRates(fl) { return fl.avg || fl; }
function flHoleState(fl, h) { var q = fl.hQ[h]; return q > 1e-6 ? 'in' : q < -1e-6 ? 'out' : 'dry'; }
/** 每個破口（還開著的）：{ x, y, z（船的格座標）, area m², wet 在海面下, q 流量 m³/s, st 'in'｜'out'｜'dry' } —— __game.flHoles(i)。 */
function flHoleInfo(sh) {
  var fl = sh.fl; if (!fl) return null;
  return fl.holes.filter(function (h) { return fl.hA[h] > 0; }).map(function (h) { return { x: +fl.hX[h].toFixed(1), y: +fl.hY[h].toFixed(1), z: +fl.hZ[h].toFixed(1), area: +fl.hA[h].toFixed(3), wet: !!fl.hWet[h], q: +fl.hQ[h].toFixed(3), st: flHoleState(fl, h) }; });
}
function flReadout(sh) {
  var fl = sh.fl;
  var cells = 0; for (var t = 0; t < fl.actN; t++) if (fl.A[fl.act[t]] > 0) cells++;
  return { lv: FLOOD_LV, c: fl.F.c, grid: [fl.F.NX, fl.F.NY, fl.F.NZ], m3: +fl.vol.toFixed(3), t: +(fl.vol * RHO_W).toFixed(2), cells: cells, jets: fl.J.n, holes: fl.open, area: +fl.area.toFixed(3),
    inQ: +fl.inQ.toFixed(3), outQ: +fl.outQ.toFixed(3), inTot: +fl.inTot.toFixed(2), outTot: +fl.outTot.toFixed(2), pumped: +fl.pumped.toFixed(2), lost: +(fl.lost || 0).toFixed(3), back: +(fl.back || 0).toFixed(2),
    comX: +fl.comX.toFixed(2), comY: +fl.comY.toFixed(2), sinkT: +fl.sinkT.toFixed(3), sink: +sh.sink.toFixed(3), roll: +sh.rollA.toFixed(4), pitch: +sh.pitchA.toFixed(4), dirty: fl.dirty.length + fl.hdirty.length };
}
/** 水併進第 i 格（那一格裝不了水 ⇒ 往上找三格）—— 照容量放（TASK-0662）：
 *  · 每一格最多裝到「外面的海面」那麼高（那一格正上方的 seaH，照浪）：從洞進來的水靠的是外面的水壓，不會比海面高；
 *  · 那一格滿了 ⇒ 往上（上面那一格通得上去，同 flTick 滿了往上擠）一直到水面；被甲板擋住 ⇒ 旁邊四格（同一層）有空的；
 *  · 四周都滿了 ⇒ 這份水進不來（回到海裡，fl.back；flTick 從進水量扣掉）。
 *  ⛔ 以前不看滿了沒：粒子撞到滿的格就併進上一格（多半也是滿的）⇒ 殉爆（大破口、粒子一直撞進泡在水裡的格）t 9–24 倒進去的 8,005 m³ 有 99% 倒進滿的格，
 *     又擠不上去（上面是甲板）⇒ 格子裝到容量的 30 倍、水面照裝了幾成算 ⇒ 艙內水面高出海面 28 m、16 秒就沉（Tim 2026-10-16：「破口在海平面上的部分 碰到模擬水把水吸上去?」；沙盒 ?lab=flood&boom=0 量的）。 */
function flDeposit(sh, fl, i, v) {
  var F = fl.F, c = F.c, NXY = F.NX * F.NY, N = F.N, A = fl.A, cap = fl.cap, Vc = Math.pow(c * S, 3), S3 = S * S * S, hc = c * S, M = sh.M, lim = 1, t, j, r, m;
  function room(k) {                                                     // 第 k 格還裝得下多少（裝到海面為止）；lim ＝ 海面淹到這一格的幾成
    var ix = k % F.NX, iy = ((k / F.NX) | 0) % F.NY, iz = (k / NXY) | 0, P = M4.pt(M, F.X0 + (ix + 0.5) * c, F.Y0 + (iy + 0.5) * c, iz * c);
    lim = clamp((seaH(P[0], P[2], SIMT) - P[1]) / hc, 0, 1); return lim * cap[k] * Vc - A[k];
  }
  for (t = 0; t < 4 && i >= 0 && i < N && !(cap[i] > 0.02); t++) i += NXY;
  if (!(i >= 0 && i < N && cap[i] > 0.02)) { fl.lost = (fl.lost || 0) + v; return; }
  for (j = i, t = 0; v > 1e-9 && t < 32; t++) {
    r = room(j); if (r > 0) { m = Math.min(v, r); A[j] += m; v -= m; flAct(fl, j); }
    var u = j + NXY; if (v <= 1e-9 || lim < 1 || u >= N || !(cap[u] > 0.02) || !(flPd(fl, u, A[u] / S3) > 0.02)) break;   // 海面在這一格裡 ⇒ 再上去就比海面高
    j = u;
  }
  if (v > 1e-9) {
    var ix = j % F.NX, iy = ((j / F.NX) | 0) % F.NY;
    for (var nb = 0; nb < 4 && v > 1e-9; nb++) {
      var k = nb === 0 ? (ix > 0 ? j - 1 : -1) : nb === 1 ? (ix < F.NX - 1 ? j + 1 : -1) : nb === 2 ? (iy > 0 ? j - F.NX : -1) : (iy < F.NY - 1 ? j + F.NX : -1);
      if (k < 0 || !(cap[k] > 0.02)) continue;
      r = room(k); if (r > 0) { m = Math.min(v, r); A[k] += m; v -= m; flAct(fl, k); }
    }
  }
  if (v > 1e-9) fl.back = (fl.back || 0) + v;
}
/** 斷成兩截、開始沉的船（Tim 2026-10-15：「斷成兩截、開始沉的船也繼續算進水給人看（只改畫面與讀數，沉的速度照舊），沉完就停」）：
 *  照樣跑 floodStep（水灌進去、讀數有積水與破口），但 ——
 *  · 下沉照舊（32_hull.js：開始沉之後照公式、不看水）；傾斜照「開始沉那一刻」的水（fl.keep，floodTilt 讀它）⇒ 船的動作一位元都不變；
 *  · 亂數用這艘自己的一串（fl.rsV）⇒ 不動到全場共用的那一條（RNG_F），別艘的進水照舊；
 *  · 沉沒（sh.sunk）就不再跑（⛔ 以前照算 ⇒ 沉掉的船積到 8 萬噸、白耗 CPU）。 */
function floodVis(sh, fl, dt) {
  if (!fl.keep) fl.keep = { vol: fl.vol, comX: fl.comX, comY: fl.comY };
  if (!flVisSlot(sh, fl)) return;                                         // 同時在算的已經 FL_VIS_N 艘 ⇒ 這艘照以前（不算、不畫）
  if (sh.broken && sh.breakX !== undefined && !fl.cutS) flCut(sh, fl);   // keep 先留 ⇒ 拿掉那一截的水不動到傾斜
  var r = RNG_F.s; RNG_F.s = fl.rsV === undefined ? (SEED ^ RNG_F.salt ^ Math.imul(0x9E3779B9, sh.i + 1)) : fl.rsV;
  var t0 = DEBUG ? performance.now() : 0; floodStep(sh, fl, dt); if (DEBUG) { FL_VISMS += performance.now() - t0; FL_VISN++; }
  fl.rsV = RNG_F.s; RNG_F.s = r; fl.vis = true;
}
var FL_VISMS = 0, FL_VISN = 0;
/** 同時好幾艘在沉（TASK-0617）：同時最多算 FL_VIS_N 艘；開始沉那一刻已經有 FL_VIS_N 艘在算 ⇒ 這艘一直照以前（不算水、不畫水，讀數照公式那一套），⛔ 之後有空位也不補（半路才開始灌看起來不對）。
 *  每艘第一次進 floodVis 時決定一次（fl.visOn），照 SHIPS 的順序 ⇒ 同一個種子每次都一樣；⛔ 不看鏡頭遠近（dump 的積水要逐字重現）。
 *  ⛔ 輪流算（每一步算 N 艘、dt 累積起來補）省不到：花費跟灌進來的水量走、不跟步數走 ⇒ 量過八艘一起斷，每一步的總花費一樣（見 README）。 */
var FL_VIS_N = Q.has('flvisn') ? Math.max(1, parseInt(Q.get('flvisn'), 10) || 2) : 2;   // ?flvisn=：量花費用（99 ＝ 不設上限）
function flVisSlot(sh, fl) {
  if (fl.visOn !== undefined) return fl.visOn;
  var n = 0;
  for (var k = 0; k < SHIPS.length; k++) { var o = SHIPS[k]; if (o !== sh && o.fl && o.fl.visOn && !o.sunk) n++; }
  return fl.visOn = n < FL_VIS_N;
}
/** 斷成兩截（23_powder.js breakShip 記 breakX、breakSide：斷開那一團在 +x ⇒ 1）：斷開那一截整格整格拿掉 —— 沒水、裝不了水、船殼不算破口、還在飛的粒子丟掉（TASK-0617）。
 *  那一截是 22_pieces.js 另外的一團、自己漂走沉下去 ⇒ ⛔ 不拿掉的話水照 sh.M 畫在它原本的位置（截圖量過：前彈藥庫殉爆、斷船 4 秒後整條船長都還是水）。
 *  格整個在斷口外才算（跨斷口那一格留著 ⇒ 斷口那一帶船殼打掉的洞照樣進水）。只在 floodVis 裡（斷船之後才跑；⛔ 船的動作不讀這些）。 */
function flGone(fl, ix) { var F = fl.F, x0 = F.X0 + ix * F.c; return fl.cutS > 0 ? x0 >= fl.cutX : x0 + F.c - 1 <= fl.cutX; }
function flDrop(fl, i) { var c = fl.F.c; fl.A[i] = 0; fl.cap[i] = 0; fl.pd[i] = 0; for (var l = 0; l < c; l++) { fl.op[i * c + l] = 0; fl.ol[i * c + l] = -1; } fl.fo.delete(i); }
function flCut(sh, fl) {
  var F = fl.F, NX = F.NX, i, h; fl.cutX = sh.breakX; fl.cutS = sh.breakSide;
  for (i = 0; i < F.N; i++) if (flGone(fl, i % NX)) flDrop(fl, i);
  for (h = 0; h < fl.hA.length; h++) if (fl.hA[h] > 0 && flGone(fl, ((h % (NX * F.NZ)) / F.NZ) | 0)) { fl.hA[h] = 0; fl.hQ[h] = 0; }
  var J = fl.J;
  for (i = 0; i < J.n; i++) {
    if (!flGone(fl, Math.floor((J.p[i * 3] - F.X0) / F.c))) continue;
    var j = --J.n; if (i !== j) { J.p.copyWithin(i * 3, j * 3, j * 3 + 3); J.v.copyWithin(i * 3, j * 3, j * 3 + 3); J.vol[i] = J.vol[j]; J.life[i] = J.life[j]; } i--;
  }
}
/** 抽水的倍率（TASK-0604）：那一型的基礎抽水量（噸／分，cfg.pump）÷ PUMP_REF。⛔ 沒有 pump（舊存檔、外部傳進來的 cfg）⇒ 1（照以前）。 */
function pumpK(sh) { var p = sh.cfg.pump, x = sh.pumps ? sh.pumps.x : 0; return (p === undefined || !isFinite(p) ? PUMP_REF : p + x) / PUMP_REF; }   // x：甲板上擺的抽水機另外加的（45_pumps.js；沒擺 ⇒ 0 ⇒ 一位元不動）
/** 每一步（32_hull.js stepShip，粒子模式）：粒子飛、每 ev 步算一次水格（破口進出水、往下往旁邊流、抽水、讀數）。 */
/** 進水一步；牆鐘記在 fl.ms／fl.msN（每艘各記；進水報表並排比各檔的花費，TASK-0810）。 */
function floodStep(sh, fl, dt) { var t0 = performance.now(); floodStep0(sh, fl, dt); fl.ms = (fl.ms || 0) + performance.now() - t0; fl.msN = (fl.msN | 0) + 1; }
function floodStep0(sh, fl, dt) {
  if (!(dt > 0)) return;
  if (fl.L.room && sh.wrs) { flRoomStep(sh, fl, dt); return; }       // 第 4 檔「房間」（TASK-0810）
  var F = fl.F, L = fl.L, J = fl.J, Vc = Math.pow(F.c * S, 3), gL = M4.dir(sh.inv, 0, -G, 0), i, o;
  // 粒子：照重力（船的座標，格／秒²）落下；碰到船體、滿的水格、出界或活太久 ⇒ 併進上一個位置的水格
  var gl = Math.hypot(gL[0], gL[1], gL[2]);
  for (i = 0; i < J.n; i++) {
    o = i * 3;
    // 位移上限（TASK-0797）：每一小步最多走 1 格 ⇒ 步長變大時不會一步穿過一格厚的甲板（60 Hz ⇒ ns 1，跟以前一樣）
    var ns = subSteps((Math.hypot(J.v[o], J.v[o + 1], J.v[o + 2]) + 0.5 * gl * dt) * dt, 1, dt), h = ns === 1 ? dt : dt / ns, gone = false;
    for (var s = 0; s < ns && !gone; s++) {
      var px = J.p[o], py = J.p[o + 1], pz = J.p[o + 2], c0 = flCell(F, px, py, pz);
      J.v[o] += gL[0] * h; J.v[o + 1] += gL[1] * h; J.v[o + 2] += gL[2] * h;
      J.p[o] += J.v[o] * h; J.p[o + 1] += J.v[o + 1] * h; J.p[o + 2] += J.v[o + 2] * h; J.life[i] -= h;
      var c1 = flCell(F, J.p[o], J.p[o + 1], J.p[o + 2]);
      if (J.life[i] <= 0 || c1 < 0 || sh.grid.get(Math.floor(J.p[o]), Math.floor(J.p[o + 1]), Math.floor(J.p[o + 2])) || fl.A[c1] >= fl.cap[c1] * Vc * 0.95) {
        flDeposit(sh, fl, c0 >= 0 ? c0 : c1, J.vol[i]);
        var j = --J.n;
        if (i !== j) { J.p.copyWithin(o, j * 3, j * 3 + 3); J.v.copyWithin(o, j * 3, j * 3 + 3); J.vol[i] = J.vol[j]; J.life[i] = J.life[j]; }
        i--; gone = true;
      }
    }
  }
  var ev = steps60(L.ev);                                                        // 幾步算一次水格：照 60 Hz 的步數換（TASK-0798）
  if (++fl.step % ev) return;
  flTick(sh, fl, dt * ev);
}
/** 第 4 檔「房間」（TASK-0810）：每一步走房間模擬（33_wrsim.js wrsStep，破口照 fl 的清單）；每 ev 步重算被打壞的破口、抽水、讀數寫回 fl（同 flTick 的欄位 ⇒ 下沉、傾斜、讀數頁照舊）。
 *  ⛔ 水格（fl.A）不用：被打壞的水格不重算（記髒的清掉就好）；畫面照房間畫（63_flood_gl.js ⇒ 63_wrwater_gl.js wrwMesh 讀 sh.wrs）。 */
function flRoomStep(sh, fl, dt) {
  var s = sh.wrs, L = fl.L, F = fl.F, M = sh.M, upm = s.upm, k;
  wrsStep(sh, dt, fl);
  var ev = steps60(L.ev);
  if (++fl.step % ev) return;
  var dtc = dt * ev, fk = sh.cfg.flood / LIM.flood[2];
  while (fl.dirty.length) fl.dmark[fl.dirty.pop()] = 0;                  // 水格不用 ⇒ 不重算
  for (k = 0; k < L.dn && fl.hdirty.length; k++) { var hd = fl.hdirty.shift(); fl.hmark[hd] = 0; flHoleRedo(sh, fl, hd); }
  var area = 0, open = 0, uN = 0, uA = 0, oN = 0;                       // 破口的讀數（同 flTick ①：海面下幾處、多大、出水幾處；只有砲口又在海面上的不算）
  for (k = 0; k < fl.holes.length; k++) {
    var h = fl.holes[k], ar = fl.hA[h]; if (!(ar > 0)) { fl.hQ[h] = 0; continue; }
    var P = M4.pt(M, fl.hX[h], fl.hY[h], fl.hZ[h]), b = s.br.get(h), q = b && b.j >= 0 ? b.q : 0;
    fl.hWet[h] = P[1] < seaH(P[0], P[2], SIMT) ? 1 : 0; fl.hQ[h] = q;
    if (fl.hWet[h]) { uN++; uA += ar; }
    if (fl.hWet[h] || fl.hPort[h] < ar - 1e-9) { area += ar; open++; }
    if (q < -1e-6) oN++;
  }
  for (k = 0; k < s.tops.length; k++) { var tp = s.tops[k]; if (tp.q > 0) { area += tp.ar; open++; } }   // 門沒了的甲板開口（同 doorInflow）
  var in0 = fl.rIn === undefined ? 0 : fl.rIn, out0 = fl.rOut === undefined ? 0 : fl.rOut;
  fl.rIn = s.inTot; fl.rOut = s.outTot;
  fl.inQ = (s.inTot - in0) / upm / dtc; fl.outQ = (s.outTot - out0) / upm / dtc; fl.inTot = s.inTot / upm; fl.outTot = s.outTot / upm;
  fl.area = area; fl.open = open; fl.underN = uN; fl.underA = uA; fl.outN = oN;
  s.pAcc = (s.pAcc || 0) + FL_PUMP * pumpK(sh) * fk * dtc * upm;        // 抽水（同 flTick ③：從最低的水抽）
  var np = Math.floor(s.pAcc), got = np > 0 ? wrsPump(s, np) : 0; s.pAcc = got < np ? 0 : s.pAcc - np;   // 抽不到（艙裡沒水）的不存著
  fl.pumped += got / upm; fl.pumpQ = got / upm / dtc; fl.netQ = fl.inQ - fl.outQ - fl.pumpQ;
  flAvgStep(fl, dtc);
  var X = s.X, u = s.su, J = s.J, cx = sh.T.cx, cy = sh.T.cy, tot = 0, mx = 0, my = 0, j;   // 水量、重心（格座標離船型中線 ⇒ 公尺；飛行中的照它現在的位置）
  for (j = 0; j < s.n; j++) if (u[j]) { tot += u[j]; mx += u[j] * (X.cx[j] - cx); my += u[j] * (X.cy[j] - cy); }
  for (j = 0; j < J.n; j++) { tot += J.u[j]; mx += J.u[j] * (J.p[j * 3] - cx); my += J.u[j] * (J.p[j * 3 + 1] - cy); }
  fl.vol = tot / upm; fl.comX = tot ? mx / tot * S : 0; fl.comY = tot ? my / tot * S : 0; fl.gen++;
}
function flTick(sh, fl, dtc) {
  var S3 = S * S * S, F = fl.F, L = fl.L, J = fl.J, c = F.c, NX = F.NX, NY = F.NY, NXY = NX * NY, N = F.N, A = fl.A, cap = fl.cap, pd = fl.pd, M = sh.M, Vc = Math.pow(c * S, 3), hc = c * S, fk = sh.cfg.flood / LIM.flood[2], i, k, m;   // 滑桿／預設：預設 ⇒ 物理的流量
  // 0. 被打壞的水格、破口（每次最多 dn 個 ⇒ 一發殉爆不會卡一下）
  for (k = 0; k < L.dn && fl.dirty.length; k++) { i = fl.dirty.shift(); fl.dmark[i] = 0; flCellRedo(sh, fl, i); }
  for (k = 0; k < L.dn && fl.hdirty.length; k++) { var hd = fl.hdirty.shift(); fl.hmark[hd] = 0; flHoleRedo(sh, fl, hd); }
  // 水面的世界高度：格 (ix, iy, iz) 的底 ＋ 裝了幾成 × 格高
  var h0 = M[1] * (F.X0 + 0.5 * c) + M[5] * (F.Y0 + 0.5 * c) + M[13], dhx = M[1] * c, dhy = M[5] * c, dhz = M[9] * c;
  function head(i) { var ix = i % NX, iy = ((i / NX) | 0) % NY, iz = (i / NXY) | 0; return h0 + ix * dhx + iy * dhy + iz * dhz + (cap[i] > 0 ? A[i] / (cap[i] * Vc) : 0) * hc; }
  // 1. 破口：外面的水面 vs 艙內在洞那裡的水面（都不低於洞）⇒ 進或出
  var inQ = 0, outQ = 0, area = 0, open = 0, uN = 0, uA = 0, oN = 0;   // uN／uA：海面下的破口幾處、多大；oN：出水的幾處
  for (k = 0; k < fl.holes.length; k++) {
    var h = fl.holes[k], ar = fl.hA[h]; if (!(ar > 0)) { fl.hQ[h] = 0; continue; }
    var side = (h / (NX * F.NZ)) | 0, s = side ? 1 : -1, P = M4.pt(M, fl.hX[h], fl.hY[h], fl.hZ[h]), hOut = seaH(P[0], P[2], SIMT);
    var ci = flCell(F, fl.hX[h], fl.hYi[h] + s * 0.5 * c, fl.hZ[h]), hIn = -1e9;
    if (ci >= 0 && !(cap[ci] > 0.02)) { var ci2 = flCell(F, fl.hX[h], fl.hYi[h] + s * 1.5 * c, fl.hZ[h]); if (ci2 >= 0 && cap[ci2] > 0.02) ci = ci2; }   // 洞口那一格裝不了水（船殼占滿）⇒ 再往裡一格
    // 艙內在洞那裡的水面：從洞口那一格往上，一格裝了九成以上、上面那一格也有水 ⇒ 再往上（⛔ 以前九成八：滿的格常常只有九成五〜九成七（粒子撞到九成五就算滿、旁邊流拉平）⇒ 停在深處、水頭差多算 6 m）
    if (ci >= 0 && A[ci] > 1e-6) { var q = ci; while (q + NXY < N && A[q] >= cap[q] * Vc * 0.9 && A[q + NXY] > 1e-6) q += NXY; hIn = head(q); }
    var d = Math.max(hOut, P[1]) - Math.max(hIn, P[1]);
    fl.hWet[h] = P[1] < hOut ? 1 : 0; fl.hQ[h] = 0; if (fl.hWet[h]) { uN++; uA += ar; }
    if (fl.hWet[h] || fl.hPort[h] < ar - 1e-9) { area += ar; open++; }        // 只有砲口、在海面上 ⇒ 船殼本來就開著的口，不算破口（TASK-0822）                     // 破口的狀態（flHoleState；底下進水／出水時填流量）
    if (d > 0.001) {
      var dv = FL_C * ar * Math.sqrt(2 * G * d) * fk * dtc; inQ += dv; fl.hQ[h] = dv / dtc;
      fl.hAcc[h] += dv;
      var sp = Math.sqrt(2 * G * d) / S;                                        // 噴進來的速度（格／秒）
      for (var nJ = 0; fl.hAcc[h] >= L.vj && nJ < ACC_CAP * 16; nJ++) {  // 防呆：一步最多 4096 份（≈ 80 m³ 以上才會碰到；00_core.js accFix）
        fl.hAcc[h] -= L.vj;
        if (J.n < L.jn) {
          var jo = J.n * 3; J.p[jo] = fl.hX[h] + rgF(-0.4, 0.4) * c; J.p[jo + 1] = fl.hYi[h] + s; J.p[jo + 2] = fl.hZ[h] + rgF(-0.4, 0.4) * c;
          J.v[jo] = rgF(-0.25, 0.25) * sp; J.v[jo + 1] = s * rgF(0.5, 1.0) * sp; J.v[jo + 2] = rgF(-0.1, 0.25) * sp; J.vol[J.n] = L.vj; J.life[J.n] = 3; J.n++;
        } else if (ci >= 0) flDeposit(sh, fl, ci, L.vj);
      }
      accFix(fl.hAcc, h, L.vj, '進水');
    } else if (d < -0.001 && ci >= 0) {
      var ov = Math.min(FL_C * ar * Math.sqrt(2 * G * -d) * fk * dtc, A[ci]); A[ci] -= ov; outQ += ov; fl.hQ[h] = -ov / dtc; oN++;
      if (PHX.water && ov > 0.01) wpPour(P, M4.dir(M, 0, -s, 0), ov / dtc);    // 往外流：只給人看（13_water.js，自己的亂數）
    }
  }
  if (fl.tops) { var dq = doorInflow(sh, fl, dtc, head); inQ += dq[0]; area += dq[1]; open += dq[2]; }   // 門沒了的開口（25_doors.js；沒有門的船沒有 fl.tops）
  var bk = (fl.back || 0) - (fl.back0 || 0); fl.back0 = fl.back || 0; inQ = Math.max(0, inQ - bk);   // 進不來的（flDeposit 四周都滿了）不算進水 ⇒ 讀數是真的灌進來的量
  fl.inQ = inQ / dtc; fl.outQ = outQ / dtc; fl.inTot += inQ; fl.outTot += outQ; fl.area = area; fl.open = open; fl.underN = uN; fl.underA = uA; fl.outN = oN;
  // 2. 水格：往下（照這一格往下通幾成）、滿了往上擠、往旁邊（照水面的世界高度；來回換方向走 ⇒ 不偏一邊）
  var n0 = fl.actN, act = fl.act, dir = fl.gen & 1, t, j;
  for (t = 0; t < n0; t++) {
    i = act[t]; var a = A[i]; if (a <= 1e-7) continue;
    var pdi = i >= NXY ? flPd(fl, i, a / S3) : 0;                          // 往下通幾成：只看水那一層以下（flPd）
    if (pdi > 0.02) { j = i - NXY; var room = cap[j] * Vc - A[j]; if (room > 0) { m = Math.min(a, room) * Math.min(1, pdi * 4); A[i] -= m; A[j] += m; flAct(fl, j); if (!fl.dqOn[i]) { fl.dqOn[i] = 1; fl.dqL.push(i); } fl.dq[i] += m; } }   // dq：往下流了多少（只記，水幕用）
    var ex = A[i] - cap[i] * Vc;
    if (ex > 1e-6 && i + NXY < N && cap[i + NXY] > 0.02 && flPd(fl, i + NXY, A[i + NXY] / S3) > 0.02) { A[i] -= ex; A[i + NXY] += ex; flAct(fl, i + NXY); }
  }
  for (t = 0; t < n0; t++) {
    i = act[dir ? n0 - 1 - t : t]; if (A[i] <= 1e-7 || !(cap[i] > 0.02) || A[i] / (cap[i] * Vc) < 0.03) continue;
    var hi = head(i), ix = i % NX, iy = ((i / NX) | 0) % NY;
    for (var nb = 0; nb < 4; nb++) {
      j = nb === 0 ? (ix > 0 ? i - 1 : -1) : nb === 1 ? (ix < NX - 1 ? i + 1 : -1) : nb === 2 ? (iy > 0 ? i - NX : -1) : (iy < NY - 1 ? i + NX : -1);
      if (j < 0 || !(cap[j] > 0.02)) continue;
      var dh = hi - head(j); if (dh <= 1e-4) continue;
      m = Math.min(0.5 * dh / hc * Math.min(cap[i], cap[j]) * Vc * 0.25, A[i] * 0.25);
      m = Math.min(m, cap[j] * Vc - A[j]); if (!(m > 0)) continue;     // 不往滿的格流（⛔ 以前會：船一縱傾，兩格都滿、水面照格頂算 ⇒ 高的流進低的、擠上去 ⇒ 水沿著斜的天花板爬到海面以上）
      A[i] -= m; A[j] += m; flAct(fl, j); hi = head(i);
      fl.lq[i * 4 + nb] += m;                                            // lq：往旁邊流了多少（只記，水瀑用：flSides；⛔ 模擬不讀）
    }
  }
  // 3. 抽水：從最低的那幾層抽（⛔ act 要重拿：上面 flAct 可能換過一條更長的陣列）
  act = fl.act;
  var need = FL_PUMP * pumpK(sh) * fk * dtc, lowz = 1e9, p0 = fl.pumped;
  for (t = 0; t < fl.actN; t++) if (A[act[t]] > 1e-7) lowz = Math.min(lowz, (act[t] / NXY) | 0);
  for (var zz = lowz; zz < lowz + 3 && need > 0 && lowz < 1e9; zz++) for (t = 0; t < fl.actN && need > 0; t++) {
    i = act[t]; if (((i / NXY) | 0) !== zz || A[i] <= 0) continue; m = Math.min(A[i], need); A[i] -= m; need -= m; fl.pumped += m;
  }
  fl.pumpQ = (fl.pumped - p0) / dtc; fl.netQ = fl.inQ - fl.outQ - fl.pumpQ;
  flAvgStep(fl, dtc);   // 實際抽掉的（m³/s；艙裡沒水 ⇒ 比抽水機的量少）；淨進水 ＝ 進 − 出 − 實際抽（Tim 2026-10-18「實際進水速度(進水-抽水)」）
  // 4. 收掉空的格；讀數：水量、重心（公尺，離船型中線：x 往船頭、y 往格 +y 那一舷為正）
  var w = 0, mx = 0, my = 0, keep = 0, cx = sh.T.cx, cy = sh.T.cy;
  for (t = 0; t < fl.actN; t++) {
    i = act[t];
    if (A[i] <= 1e-7) { A[i] = 0; fl.on[i] = 0; continue; }
    act[keep++] = i; w += A[i];
    mx += A[i] * (F.X0 + ((i % NX) + 0.5) * c - cx); my += A[i] * (F.Y0 + ((((i / NX) | 0) % NY) + 0.5) * c - cy);
  }
  fl.actN = keep;
  for (t = 0; t < J.n; t++) { w += J.vol[t]; mx += J.vol[t] * (J.p[t * 3] - cx); my += J.vol[t] * (J.p[t * 3 + 1] - cy); }
  fl.vol = w; fl.comX = w > 0 ? mx / w * S : 0; fl.comY = w > 0 ? my / w * S : 0; fl.gen++; fl.dqT += dtc; fl.lqT += dtc;
}
/** 艙內的水 ⇒ 該多吃水多少（m）：浮力表上「少掉的重量 − 水」跟「少掉的重量」的差。 */
function floodSinkT(sh, fl) {
  if (sh.flBase === undefined) return 0;
  var W = fl.vol * RHO_W, a = liftFor(sh.T, sh.flBase), b = liftFor(sh.T, sh.flBase - W);
  return fl.sinkT = a === null || b === null ? 0 : Math.max(0, a - b);
}
/** 水的重心 ⇒ 橫傾、縱傾的目標（rad；正負跟公式一樣：水在格 +y 那一舷 ⇒ 正 ⇒ 那一舷（右舷）往下；水在船頭 ⇒ 負 ⇒ 船頭往下）。 */
function floodTilt(sh, fl) {
  var k = fl.keep || fl;                                              // 開始沉之後照那一刻的水（floodVis 留的 keep）⇒ 水照樣灌給人看，船怎麼斜跟以前一模一樣
  var W = k.vol * RHO_W, D = (sh.mass0 || shipT(sh)) + W, lim = sh.sinkingFinal ? 0.55 : 0.21;
  return [clamp(Math.atan(W * k.comY / (D * FL_GM)), -lim, lim), -clamp(Math.atan(W * k.comX / (D * FL_GML)), -0.07, 0.07)];
}
