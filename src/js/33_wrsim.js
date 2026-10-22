// ───────────────────────── 水的房間：模擬（TASK-0808；TASK-0804 研究報告 §6） ─────────────────────────
// Tim 2026-10-22：「只要模擬水在各艙室之間的流動就好（同時要考慮船隻傾斜 艙室之間的連接面 小洞流速慢）」「以及船外流入的水（也可能流出 要看實際水的高低差）」
//   「房間本身存水位（容量 看目前有多少顆粒子）」「大房間 可能不同位置會有水位差」「水晃動會真的影響傾斜 這個很好」
//   「水模擬要跟物理模擬一樣 支援低Hz」「結果不用一致」「但是儘可能接近（至少要考慮到步長）」。
// 第一階段（這一支）：只在進水報表裡跟細檔並排跑（81_floodlab.js wsim=1），⛔ 不接到船上（TASK-0810），戰局一位元不動。
// 狀態（sh.wrs）：每一段（33_wrooms.js 的 0.5 m 分欄，上下兩段的合併欄拆開，見 ⓙ）裝幾單位 su（Int32，33_wrwater.js 的尺：一格空氣 WR_U 單位）；對外的 u ＝ 每個烘焙的欄加總。⛔ 沒有別的水量 ⇒ 守恆逐單位相等（進 − 出 ＝ 段的總和 ＋ 飛行中）。
// 每一步（照秒數；步長 dt 超過穩定上限就切小步，wrsStep）：
//   ① 破口（sea ↔ 房）：跟細檔同一條式子 FL_C·A·√(2g·水頭)·流量滑桿（33_flood.js flTick 第 1 段）；外面照浪的水面、裡面照破口那一欄的水面；雙向。
//   ② 接口（房 ↔ 房）：每一條橫帶（33_wrooms.js 的接口，每一層一條，面積 ＝ 面數 × S²）照兩邊那一欄水面的世界高度：
//      高的那邊淹過帶底 ⇒ FL_C·A·淹過的比例·√(2g·(高 − max(低, 帶中)))；兩邊都淹過帶底 ⇒ 最多流到兩邊拉平（夾到拉平，驗收第 8 條）；
//      上下的接口（艙口、甲板破洞）：上面那間的水面高過開口 ⇒ 往下流（下面那間的水沒到開口 ⇒ 自由落下）。
//   ③ 房間內（高度場）：相鄰兩欄之間一條「虛擬管」，流量照兩欄水面的世界高度差加速（dQ/dt ＝ g·水深·Δh，⇒ 波速 √(g·水深)），WRS_DAMP 阻尼；
//      流出照那一欄有的水量縮放（不會變負）。⇒ 船斜了水往低的那邊流、大房間有水位差、晃動有傳播時間。
//   每一個流量都照秒數乘這一小步的長度；零頭（不到 1 單位）留在每條邊、每個接口自己的累加器帶到下一步 ⇒ 不偏、守恆。
//   ④ 自由落下（Tim 2026-10-22「房間之間的洞用粒子模擬流動（且會根據重力往下流）」，驗收第 4 條）：破口、接口、艙口流過去的那一邊水面沒淹到開口 ⇒
//      那一小步流過去的水變成一顆粒子（帶那幾單位），照船上的重力落下；每一小步沿著線段一格一格走（DDA，⛔ 不穿甲板）：碰到實心的格 ⇒ 放進前一格那一間；
//      進到某一間某一欄的水面以下 ⇒ 放進那一欄。下游已經淹過開口 ⇒ 直接搬、不生粒子。飛行中的單位也記帳（Jtot）。
// 反向對照的開關（sh.wrs.opt；進水報表 wsimo=nocfl,noclamp,nodda,level）：nocfl 不切小步、noclamp 接口不夾到拉平、nodda 粒子只看終點那一格、level 每一步之後每間房瞬間拉平（不用高度場）。
// 第二版（審查 wf_065a867f-b0b 與過程圖 81_floodlab.js wsimPic 量出來的；第一版 900 秒只灌到 735–859 m³、參考 1,421，溢出 3,379 m³ 全記成流回海裡）：
//   ⓐ 開口照相連拆開（wrsOpenings）：烘焙把同一對房、同一層的面併成一個接口、只記重心 ⇒ 左右舷兩扇門、兩個艙口的重心落在中線的梁上、牆裡、別間
//      ⇒ 兩邊那一欄、落水的起點都不對：橫的粒子方向是 0、落回上游，下游永遠是乾的 ⇒ 每一小步照 Torricelli 全速打轉（落地是進水的 17 倍）。
//      拆完每一塊取離它重心最近的那一面：兩邊各一格 ⇒ 那兩欄、落水從下游那一格出發、橫的照面的法線噴。
//   ⓑ 粒子的重力 M4.dir(sh.inv, 0, −G, 0)（sh.inv 已經帶 1/S；⛔ 以前多除一次 S ⇒ 10 g）。
//   ⓒ 落地：落點那一間 → 原本要去的那一欄（都最多裝到落點的高度：落下來的水沒有水頭）→ 放回出發那一間（照出發時的水頭）→ 停在落點等（WRS_JWAIT 秒）→ 破口噴進來的當作沒進來、其他的塞回出發那一欄（超過容量，dbg.over）；
//      ⛔ 不再記成流回海裡（只有出了船才算出）、不再往正上方 12 格瞬移。
//   ⓓ 拉平的額度每一對房、每一小步一份（⛔ 以前每一層的帶各夾各的 ⇒ 一扇門二十層搬二十倍），每一對欄也一份（照兩欄的水面面積：水是放進那一欄的；⛔ 只照房間 ⇒ 0.1 秒一步 300 秒來回穿越 115 萬次，加了 34 萬）；搬不動的流量不存在累加器（⛔ 以前留著、下次一口氣放）。
//   ⓔ 水頭照「有效水面」lv：那一欄滿了 ⇒ 那一間沒滿的欄最高的水面；整間滿 ⇒ 往上的開口（門擋住的不算）那幾間的水面。
//   ⓕ 虛擬管：dQ/dt ＝ g·水深·Δh·（管寬 ÷ 管長），管寬照兩欄底面積小的那個（⛔ 以前多乘一個欄寬）；wrsPut 一欄一欄裝到滿（⛔ 以前只試一欄）；DDA 走到線段終點就停。
//   以下三條是改完 ⓐ–ⓕ 之後照過程圖、每個開口的淨流量（81_floodlab.js wsimPic ops／mvs）再量出來的（底艙與艙底空腔、夾在底艙中間的小艙繞圈）：
//   ⓖ 開口送水最多送到下游那一間裝滿（rf 扣掉飛行中要去的 fly；⛔ 以前照水頭全速送、裝不下再從往上的開口溢回上游）。破口不設限（底艙滿了水要往上淹）。
//   ⓗ 上下的開口也會往上推：下面那間的有效水面高過開口、也高過上面那間 ⇒ 從底下灌上去（例：底艙連著上一層的水，夾在中間的小艙從底下灌滿）。
//   ⓘ 房間的水面 rl 照水面面積加權平均（⛔ 取最高的 ⇒ 同一間在不同開口讀到不同水頭，三個開口就繞成一圈）；欄滿了、房間沒滿 ⇒ 照 rl，不取欄頂。
//   ⓙ 上下兩段的合併欄拆開（wrsSegs，Tim 2026-10-22「拆吧 只改模擬內部」）：烘焙的一欄中間有幾層 0 格（甲板）⇒ 上下兩塊不相通的空間、一個水位表示不了 ⇒ 照連續有空氣的那幾層切成段，模擬每一段當一欄；管子只接同一間、相鄰兩欄、高度有重疊的兩段，管口只開在重疊的那一截；開口、破口、落水照高度找那一段。對外 sh.wrs.u 照烘焙的欄加總（wrsAgg；畫面不用改）。
//      ⛔ 以前一欄一個水位：下段灌滿時水位一跳一個甲板厚、推給鄰欄、退回來又掉下去 ⇒ 封閉的第 1 間 0.1 秒一步 90 秒不衰減 200–240 m³/s、水面 RMS 0.36 m；拆完 ⇒ 約 5 m³/s、RMS 3–5 mm（進水報表 ?lab=wslosh）。
// 還沒做：抽水。⚠ 上段有水、下段沒滿時，對外加總的 u 會畫在下段裡（畫面一欄只有一個水面）。
// ⛔ 只讀船的姿態、破口、門；不抽 rnd()。
var WRS_SEA_DT = 1 / 30, WRS_NEWBR = 64, WRS_DAMP = 0.5, WRS_CFL = 0.45, WRS_NMAX = 32, WRS_JN = 4096, WRS_JLIFE = 6, WRS_JWAIT = 2, WRS_JRISE = 1.5;                     // WRS_SEA_DT ＝ 破口外面的海面幾秒重算一次（照秒數；同細檔每 2 步）；WRS_NEWBR ＝ 一步最多替幾個新破口找房間（殉爆一次幾千塊，每塊最多查 1,720 格 ⇒ 分幾步做，同細檔 dn；TASK-0810）；虛擬管每秒的阻尼；一小步最多走欄寬 × WRS_CFL ÷ 波速；一步最多切幾小步；WRS_JWAIT ＝ 粒子放不下時停在落點等幾秒（秒，照秒數不照步數）；WRS_JRISE ＝ 粒子落進水池時，那一間的平均水面一秒最多漲幾公尺
/** 開一艘的房間模擬（要有烘焙好的房間 T.wrm）。 */
function wrsInit(sh) {
  var T = sh.T, W0 = T.wrm; if (!W0) return null;
  var G = wrsSegs(T), W = G.W, X = G.X, n = W.colRoom.length, n0 = W0.colRoom.length, C = W.c, NCK = W.NCX * W.NCY, idx = new Map(), j, k, i;   // 模擬照「段」走（wrsSegs：上下兩段的合併欄拆開；W、X 跟烘焙的表同一個形狀）；對外的 u 照烘焙的欄加總（wrsAgg）
  for (j = 0; j < n0; j++) idx.set(W0.colRoom[j] * NCK + W0.colCX[j] * W0.NCY + W0.colCY[j], j);   // (房, 欄 x, 欄 y) ⇒ 烘焙的欄；第幾段照高度找（wrsSegNear／wrsSegAt）
  var cap = new Int32Array(n), zf = new Float32Array(n), ca = new Float32Array(n), gp = new Uint8Array(n), ea = [], eb = [];
  for (j = 0; j < n; j++) {
    var r = W.colRoom[j], cx = W.colCX[j], cy = W.colCY[j], z0 = W.colZ0[j], z1 = z0 + W.colNZ[j];
    for (var e0 = 0; e0 < 2; e0++) {                                     // 管子：同一間、相鄰那一欄（x ＋ 1、y ＋ 1）裡高度跟這一段有重疊的每一段（⛔ 以前一欄一條 ⇒ 上下兩段的合併欄下段灌滿時水位一跳一個甲板厚，推給鄰欄、退回來又掉下去：封閉的第 1 間 0.1 秒一步 90 秒不衰減 200–240 m³/s）
      var nx = cx + (e0 ? 0 : 1), ny = cy + (e0 ? 1 : 0); if (nx >= W.NCX || ny >= W.NCY) continue;
      var q0 = idx.get(r * NCK + nx * W.NCY + ny); if (q0 === undefined) continue;
      for (k = G.col0[q0]; k < G.col0[q0 + 1]; k++) if (Math.min(z1, W.colZ0[k] + W.colNZ[k]) > Math.max(z0, W.colZ0[k])) { ea.push(j); eb.push(k); }
    }
    cap[j] = wrColCap(W, X, j); zf[j] = wrColZ(W, X, j, 0);
    for (var d0 = 0, o0 = W.colOff[j], cm = 0; d0 < W.colNZ[j]; d0++) cm = Math.max(cm, W.cnt[o0 + d0]);
    ca[j] = cm * S * S;                                                  // 這一段的底面積（最寬那一層，m²）：虛擬管的寬照它（窄的邊欄流得慢 ⇒ 一小步灌不爆）
    gp[j] = G.gp[G.par[j]];                                              // 這一段來自上下兩段的合併欄（反向對照 noGapPipe）
  }
  /** 第 r 間在 (x, y, z)（格座標）那一段；那裡沒有這間的欄 ⇒ 這間最近的一段（照水平距離＋離那一段的高度）。 */
  function colAt(r, x, y, z) {
    var cx = clamp(Math.floor((x - W.x0) / C), 0, W.NCX - 1), cy = clamp(Math.floor((y - W.ylo) / C), 0, W.NCY - 1), q = idx.get(r * NCK + cx * W.NCY + cy);
    if (q !== undefined) return wrsSegNear(G, q, z);
    var best = -1, bd = Infinity; for (q = W.roomCol0[r]; q < W.roomCol0[r + 1]; q++) { var dx = X.cx[q] - x, dy = X.cy[q] - y, dz = wrsSegDz(W, q, z), dd = dx * dx + dy * dy + dz * dz; if (dd < bd) { bd = dd; best = q; } }
    return best;
  }
  // 開口：烘焙的接口照相連拆開（wrsOpenings，一型船算一次）；每個開口代表的那一面兩邊各一格 ⇒ 那兩欄（上下的：a ＝ 下面那間、b ＝ 上面那間）
  var O = wrsOpenings(T), NO = O.n, oa = new Int32Array(NO), ob = new Int32Array(NO), ja = new Int32Array(NO), jb = new Int32Array(NO), NR = W.roomVox.length, up = [];
  for (i = 0; i < NR; i++) up.push([]);
  for (i = 0; i < NO; i++) {
    oa[i] = O.A[i]; ob[i] = O.B[i];
    var qa = idx.get(O.A[i] * NCK + Math.floor((O.ax[i] - W.x0) / C) * W.NCY + Math.floor((O.ay[i] - W.ylo) / C)), qb = idx.get(O.B[i] * NCK + Math.floor((O.bx[i] - W.x0) / C) * W.NCY + Math.floor((O.by[i] - W.ylo) / C));
    var za = O.Z[i] + 0.5, zb = O.T[i] ? za : za + 1;                    // 那一面兩邊的格：旁邊的同一層；上下的 a 在 Z、b 在 Z ＋ 1 ⇒ 那一欄裡含這一格的那一段
    ja[i] = qa !== undefined ? wrsSegNear(G, qa, za) : colAt(O.A[i], O.ax[i] + 0.5, O.ay[i] + 0.5, za); jb[i] = qb !== undefined ? wrsSegNear(G, qb, zb) : colAt(O.B[i], O.bx[i] + 0.5, O.by[i] + 0.5, zb);
    if (!O.T[i]) up[O.A[i]].push(i);                                     // 每間往上的開口（整間滿 ⇒ 從這幾個溢上去、水壓頭也看這幾個）
  }
  // 門、艙蓋（25_doors.js；Tim 2026-10-22「不分開關都擋水」「只有被打壞才進水」）：門框那幾格（＋ 1 格）底下、甲板那一層的上下開口 ⇒ 那幾個開口掛著那扇門；
  //   框底下沒有 ⇒ 1.5 m 內最近的那一個；都沒有（甲板上的艙口通到船外）⇒ 記成「通到甲板上面」的開口（門沒了 ⇒ 照破口算：外面的水面高過開口才進）
  var odoor = new Int16Array(NO).fill(-1), tops = [];
  (sh.doors || []).forEach(function (d, di) {
    if (!d.cells.length) return;
    var n0 = d.cells.length / 2, sx = 0, sy = 0, hit = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, q2;
    for (var q = 0; q < d.cells.length; q += 2) { sx += d.cells[q]; sy += d.cells[q + 1]; x0 = Math.min(x0, d.cells[q]); x1 = Math.max(x1, d.cells[q]); y0 = Math.min(y0, d.cells[q + 1]); y1 = Math.max(y1, d.cells[q + 1]); }
    sx = sx / n0 + 0.5; sy = sy / n0 + 0.5;
    for (q2 = 0; q2 < NO; q2++) if (!O.T[q2] && Math.abs(O.Z[q2] + 1 - d.zt) <= 1 && O.X[q2] >= x0 - 1 && O.X[q2] <= x1 + 2 && O.Y[q2] >= y0 - 1 && O.Y[q2] <= y1 + 2) { odoor[q2] = di; hit++; }
    if (hit) return;
    var best = -1, bd = 15 * 15; for (q2 = 0; q2 < NO; q2++) if (!O.T[q2] && Math.abs(O.Z[q2] + 1 - d.zt) <= 1) { var dd = (O.X[q2] - sx) * (O.X[q2] - sx) + (O.Y[q2] - sy) * (O.Y[q2] - sy); if (dd < bd) { bd = dd; best = q2; } }
    if (best >= 0) { odoor[best] = di; return; }
    var rb = -1; for (var dz = 0; dz <= 3 && rb < 0; dz++) rb = wrRoomAt(W, Math.floor(sx), Math.floor(sy), d.zt - dz);
    if (rb >= 0) tops.push({ d: di, r: rb, j: colAt(rb, sx, sy, d.zt - 0.5), x: sx, y: sy, z: d.zt + 1, ar: n0 * S * S, acc: 0, q: 0 });
  });
  return { W: W, X: X, G: G, n: n, su: new Int32Array(n), u: new Int32Array(n0), cap: cap, zf: zf, ca: ca, gp: gp,
    E: { n: ea.length, a: Int32Array.from(ea), b: Int32Array.from(eb), f: new Float64Array(ea.length), ac: new Float64Array(ea.length) }, kout: new Float64Array(n), hw: new Float64Array(n), zs: new Float64Array(n), lv: new Float64Array(n), K: new Float64Array(n),
    O: O, NO: NO, oa: oa, ob: ob, ja: ja, jb: jb, up: up, oacc: new Float64Array(NO), oq: new Float32Array(NO), ost: new Int8Array(NO), odoor: odoor, tops: tops, bud: new Map(), emO: new Float64Array(NO), upO: new Float64Array(NO), mvO: new Float64Array(NO), putSeen: new Int32Array(NR), putN: 0, crO: new Int32Array(NO), xs: new Int32Array(NO), xd: new Int32Array(NO), xk: new Uint8Array(NO), xcl: new Int32Array(128), xself: 0, xselfB: 0, xsk: new Int32Array(16), xsO: new Int32Array(NO), xover: 0, xoO: new Int32Array(NO), dA: { breach: 0, open: 0, jets: 0, pipe: 0 }, wk: { surf: 0, body: 0, open: 0, pipe: 0, put: 0, take: 0, jet: 0, dda: 0, near: 0, sort: 0, sea: 0 },
    idx: idx, NCK: NCK, J: { n: 0, p: new Float32Array(3 * WRS_JN), v: new Float32Array(3 * WRS_JN), u: new Int32Array(WRS_JN), src: new Int32Array(WRS_JN), life: new Float32Array(WRS_JN), hd: new Float32Array(WRS_JN), dst: new Int32Array(WRS_JN), fr: new Int32Array(WRS_JN), wt: new Float32Array(WRS_JN) }, Jtot: 0, jet: 0, opt: {},
    br: new Map(), aR: new Float64Array(NR), rl: new Float64Array(NR), rn: new Int32Array(NR), rf: new Float64Array(NR), fly: new Float64Array(NR), rFH: new Float64Array(NR).fill(-1e9), fpar: new Int32Array(NR), fa: new Float64Array(NR), fh: new Float64Array(NR), NR: NR, upm: WR_U / (S * S * S), inTot: 0, outTot: 0, sub: 0, ms: 0, steps: 0, cross: 0,
    dbg: { out: 0, noroom: 0, spill: 0, todst: 0, back: 0, undo: 0, wait: 0, over: 0, life: 0, solid: 0, water: 0, emitB: 0, emitS: 0, emitD: 0 } };
}
/** 每一欄的水面：zs（格座標）、hw（世界高度；沒水 ⇒ 地板）；每間房的水面面積 aR（m²，有水沒滿的欄在水面那一層的格數）；回最深的水（m）。
 *  有效水面 lv（破口、開口的水頭都照它）：沒水 ⇒ −1e9；沒滿 ⇒ hw；那一欄滿了 ⇒ 那一間沒滿、有水的欄的平均水面 rl（沒有這種欄 ⇒ 欄頂）（照水面面積加權；⛔ 取最高的 ⇒ 大房間水面不平時，同一間在不同開口讀到不同的水頭 ⇒ 三個開口就能繞成一圈）；整間滿 ⇒ 那一塊連通水體的水壓 rFH（wrsBody；沒有接出去的 ⇒ 欄頂）。 */
function wrsSurf(s, M) {
  var W = s.W, X = s.X, n = s.n, u = s.su, dmax = 0, S2 = S * S, NR = s.NR, r, j, k, nv = 0;
  s.surfN = (s.surfN | 0) + 1;                                           // 水面重算了 ⇒ 每間房照水面排的順序作廢（wrsOrd）
  s.Ms = M;
  if (!s.rnD) {                                                          // 乾的房間的常數（全乾 ⇒ 每一段都「沒滿」、還裝得下整段）
    s.rnD = new Int32Array(NR); s.rfD = new Float64Array(NR); s.inAct = new Int32Array(NR); s.hwAt = new Int32Array(NR); s.act = []; s.allA = true;
    for (j = 0; j < n; j++) if (s.cap[j] > 0) { r = W.colRoom[j]; s.rnD[r]++; s.rfD[r] += s.cap[j]; }
    s.lv.fill(-1e9); s.zs.set(s.zf);
    var eA0 = s.E.a, ne0 = s.E.n, e0 = 0; s.eR0 = new Int32Array(NR + 1);   // 每間房的管子：E.a 照段的編號排（wrsInit）、段照房間排 ⇒ 一間一段連續的
    for (r = 0; r <= NR; r++) { var jr = r < NR ? W.roomCol0[r] : n; while (e0 < ne0 && eA0[e0] < jr) e0++; s.eR0[r] = e0; }
  }
  // 只算「上一小步有水」＋「之後被放過水」的房間（s.act；wrsPut、粒子塞回出發那一欄會補進來）；其他房間全乾 ⇒ 統計是常數、水面高度用到才算（wrsRoomHw）
  // ⛔ 以前每一小步全船兩萬段都算一遍，八個洞只濕幾間 ⇒ 水面這段比細檔整步還貴（TASK-0810）。第一次（含進水報表開場直接灌水）全船算。
  var cand = s.allA ? null : s.act, nc = cand ? cand.length : NR, act = [];
  for (r = 0; r < NR; r++) { s.aR[r] = 0; s.rl[r] = 0; s.rn[r] = s.rnD[r]; s.rf[r] = s.rfD[r]; }
  for (k = 0; k < nc; k++) {
    r = cand ? cand[k] : k; s.rn[r] = 0; s.rf[r] = 0; var wet = false;
    for (j = W.roomCol0[r]; j < W.roomCol0[r + 1]; j++) {
      nv++;
      var z = u[j] > 0 ? wrColZ(W, X, j, u[j]) : s.zf[j];
      s.zs[j] = z; s.hw[j] = M[1] * X.cx[j] + M[5] * X.cy[j] + M[9] * z + M[13];
      r = W.colRoom[j]; if (u[j] < s.cap[j]) { s.rn[r]++; s.rf[r] += s.cap[j] - u[j]; }   // rf ＝ 這間還裝得下幾單位
      if (u[j] > 0) { var d = (z - s.zf[j]) * S; if (d > dmax) dmax = d; if (u[j] < s.cap[j]) { var l = Math.min(W.colNZ[j] - 1, Math.floor(z - W.colZ0[j])); var al = W.cnt[W.colOff[j] + l] * S2; s.aR[r] += al; s.rl[r] += s.hw[j] * al; } }
      if (u[j] > 0) wet = true;
    }
    s.hwAt[r] = s.surfN;
    if (wet) { act.push(r); s.inAct[r] = s.surfN; } else if (s.eR0) s.E.f.fill(0, s.eR0[r], s.eR0[r + 1]);   // 乾了 ⇒ 管子的流量歸零（同以前：兩邊都沒水的管子 ef ＝ 0）
  }
  s.wk.surf += 2 * nv + NR;                                              // 計算量（每一步做了幾次工；wrsWork）
  for (r = 0; r < NR; r++) s.rl[r] = s.aR[r] > 0 ? s.rl[r] / s.aR[r] : -1e9;
  wrsBody(s, M);                                                         // 灌滿的房間 ⇒ 連通的水體、一個水壓（rFH）
  for (k = 0; k < nc; k++) {
    r = cand ? cand[k] : k;
    for (j = W.roomCol0[r]; j < W.roomCol0[r + 1]; j++) {
      if (u[j] <= 0) { s.lv[j] = -1e9; continue; }
      if (u[j] < s.cap[j]) { s.lv[j] = s.hw[j]; continue; }
      s.lv[j] = s.rn[r] ? (s.rl[r] > -1e8 ? s.rl[r] : s.hw[j]) : (s.rFH[r] > -1e8 ? s.rFH[r] : s.hw[j]);   // 房間沒滿：照它的水面（⛔ 不取欄頂：窄的邊欄一點水就滿、欄頂比水面高一截 ⇒ 旁邊每一層的帶都往外推、繞回來）
    }
  }
  s.act = act; s.allA = false;
  return dmax;
}
/** 這一小步沒算到的（那時全乾的）房間：每一段照乾的算水面高度（同 wrsSurf 的 u ＝ 0）。放水、排序、管子用到才算。 */
function wrsRoomHw(s, r) {
  if (s.hwAt[r] === s.surfN) return;
  var W = s.W, X = s.X, M = s.Ms; s.hwAt[r] = s.surfN;
  for (var j = W.roomCol0[r]; j < W.roomCol0[r + 1]; j++) { var z = s.zf[j]; s.zs[j] = z; s.hw[j] = M[1] * X.cx[j] + M[5] * X.cy[j] + M[9] * z + M[13]; }
}
/** 第 r 間這一小步被放了水 ⇒ 補進要算的房間（管子、下一小步的水面）。 */
function wrsTouch(s, r) { if (s.inAct && s.inAct[r] !== s.surfN) { s.inAct[r] = s.surfN; s.act.push(r); } }
/** 把 nu 單位放進第 r 間（先放 j 那一欄；滿了 ⇒ 這間水面最低、沒滿的那一欄；整間滿了 ⇒ 從往上的開口溢到上面那間，水頭 head 要高過開口）。回放不下的單位。 */
function wrsPut(s, M, j, nu, head, depth) {
  var W = s.W, u = s.su, O = s.O, X = s.X, lim = function (c) { return head > -1e8 ? Math.min(s.cap[c], Math.floor(wrColUnits(W, X, c, (head - (M[1] * X.cx[c] + M[5] * X.cy[c] + M[13])) / M[9]))) : s.cap[c]; };   // 每一欄最多裝到水頭那個高度（破口 ＝ 海面、開口 ＝ 上游的水面、粒子 ＝ 帶著的上游水頭；沒給水頭 ⇒ 裝到滿）；⛔ 以前裝到滿 ⇒ 下游那一欄滿了就放到那間別的欄，可能高過水頭、灌到海面以上，900 秒比參考解的最大水量多 16–20%
  var a = Math.min(nu, lim(j) - u[j]);
  wrsTouch(s, W.colRoom[j]);                                             // 這間被放了水 ⇒ 管子、下一小步的水面要算（wrsSurf）
  if (a > 0) { u[j] += a; nu -= a; } if (nu <= 0) return 0;              // ⚠ 那一欄可能超過容量（落地塞回出發那一欄）⇒ a 會是負的，不能加
  var r = W.colRoom[j], q;
  if (!depth) s.putN = (s.putN | 0) + 1;                                 // 這一次放水的戳記：同一次放水試過（裝滿了）的房間不再進去（⛔ 以前往上溢會一層一層把每個開口都再試一次 ⇒ 上面幾間都滿了就是開口數的四次方，900 秒跑不完）
  if (s.putSeen[r] === s.putN) return nu;
  s.putSeen[r] = s.putN;
  var satS = s.satS || (s.satS = new Int32Array(s.NR)), satH = s.satH || (s.satH = new Float64Array(s.NR)), hk = head > -1e8 ? head : Infinity, n1 = nu;   // 這一小步這間在水頭 satH 以下已經一格都放不進去（沒拿過水）⇒ 直接往上溢（⛔ 以前每一份都把整間走完、再掃一趟：沉船裝到海面之後幾百顆粒子落地 ⇒ 一步兩百多萬次工）
  if (!(satS[r] === s.surfN && hk <= satH[r])) {
    var od = wrsOrd(s, r, 0), pos = W.roomCol0[r], pe = W.roomCol0[r + 1], p0 = pos;   // 這間照水面由低到高排好（每一小步排一次）⇒ 往下走就是「水面最低、沒滿的那一欄」（⛔ 以前每一欄都整間掃一趟、最多九趟：殉爆幾千顆粒子落地 ⇒ 一步 258 萬次工）
    for (var it = 0; it < 8 && nu > 0; it++) {                             // 這間水面最低、沒滿的欄先裝（⛔ 以前只試一欄就放棄）；八欄之後照順序裝到滿
      var best = -1;
      for (; pos < pe; pos++) { q = od[pos]; if (u[q] < s.cap[q] && u[q] < lim(q)) { best = q; break; } }
      if (best < 0) break;
      a = Math.min(nu, lim(best) - u[best]); u[best] += a; nu -= a;
    }
    s.wk.put += pos - p0 + 1;
    if (nu > 0) s.wk.put += W.roomCol0[r + 1] - W.roomCol0[r];
    for (q = W.roomCol0[r]; q < W.roomCol0[r + 1] && nu > 0; q++) if (u[q] < s.cap[q]) { var lq = lim(q); if (u[q] < lq) { a = Math.min(nu, lq - u[q]); u[q] += a; nu -= a; } }
    if (nu === n1) { if (satS[r] !== s.surfN) { satS[r] = s.surfN; satH[r] = hk; } else if (hk > satH[r]) satH[r] = hk; }
  }
  if (nu <= 0 || (depth | 0) > 4) return nu;
  for (var k = 0, L = s.up[r]; k < L.length && nu > 0; k++) {          // 整間滿了：往上的開口、門沒擋、水頭高過開口、上面那一欄的水面比水頭低 ⇒ 溢上去
    var i = L[k], jb = s.jb[i]; if (s.odoor[i] >= 0 && wrsDoorShut(s, i)) continue;
    var wz = M[1] * O.X[i] + M[5] * O.Y[i] + M[9] * (O.Z[i] + 1) + M[13];
    if (head > wz && (u[jb] === 0 || s.hw[jb] < head)) { var n0 = nu; nu = wrsPut(s, M, jb, nu, head, (depth | 0) + 1); s.upO[i] += n0 - nu; }   // 除錯：每個開口往上溢了多少（過程圖）
  }
  return nu;
}
/** 從第 j 段拿走 nu 單位（wrsPut 的反向），回拿到幾單位。那一段沒滿 ⇒ 從它自己的水面拿；
 *  滿了、房間沒滿 ⇒ 從這間水面最高、沒滿的段拿，每一段最多拿到平均水面 rl（水從水面以下的開口流出去 ⇒ 整間的水面一起降）；整間滿 ⇒ 從頂最高的段拿（空氣從最上面進來）；拿不夠 ⇒ 那一段自己。
 *  ⛔ 以前一律從那一段拿：滿的那一段水位照整間的平均（lv ＝ rl）、夾到拉平也照整間的水面面積，一拿就不滿、水位改照它自己窄窄的水面、一下掉很多 ⇒ 下一小步兩邊反過來（驗收第 8 格，0.1 秒一步 300 秒：開口自己衝過頭 4.5 萬次，前 12 筆全是這種）。opt.takeCol ⇒ 舊做法（反向對照）。 */
function wrsTake(s, M, j, nu) {
  var u = s.su, W = s.W, X = s.X, a;
  if (nu <= 0) return 0;
  if (s.satS) s.satS[W.colRoom[j]] = 0;                                  // 拿了水 ⇒ 這間又有空位（wrsPut 的「放不進去」作廢）
  if (u[j] < s.cap[j] || s.opt.takeCol) { a = Math.min(nu, u[j]); u[j] -= a; return a; }
  var r = W.colRoom[j], full = !s.rn[r], got = 0, q, od = wrsOrd(s, r, 1), pos = W.roomCol0[r], pe = W.roomCol0[r + 1], p0 = pos;   // 照水面由高到低排好（同 wrsPut）；拿過的不再拿 ＝ 往下走
  for (var it = 0; it < 8 && got < nu; it++) {
    var best = -1;
    for (; pos < pe; pos++) { q = od[pos]; if (u[q] > 0 && (full || u[q] < s.cap[q])) { best = q; pos++; break; } }
    if (best < 0) break;
    var room = full ? u[best] : Math.max(0, u[best] - Math.ceil(wrColUnits(W, X, best, (s.rl[r] - (M[1] * X.cx[best] + M[5] * X.cy[best] + M[13])) / M[9])));   // 最多拿到平均水面
    a = Math.min(nu - got, Math.max(full ? 0 : 1, room), u[best]); u[best] -= a; got += a;
  }
  s.wk.take += pos - p0 + 1;
  if (got < nu && !full && s.aR[r] > 0) {                               // 水面平的時候每一段到平均水面只剩一點 ⇒ 剩下的照每一段的水面面積一起拿（整間的水面一起降；⛔ 以前回頭從那一段自己拿 ⇒ 挖一個洞、下一小步兩邊反過來）
    var rest = nu - got;
    for (q = W.roomCol0[r]; q < W.roomCol0[r + 1] && got < nu; q++) if (u[q] > 0 && u[q] < s.cap[q]) { a = Math.min(nu - got, u[q], Math.ceil(rest * wrsColA(s, q) / s.aR[r])); u[q] -= a; got += a; }
    s.wk.take += W.roomCol0[r + 1] - W.roomCol0[r];
  }
  if (got < nu) { a = Math.min(nu - got, u[j]); u[j] -= a; got += a; }
  return got;
}
/** 第 r 間的段照水面（hw）排好的順序：desc 0 ⇒ 由低到高、1 ⇒ 由高到低；一樣高照段的編號（同以前整間掃、取第一個嚴格最低／最高）。
 *  每一小步（wrsSurf 重算水面）第一次用到才排；一小步裡水面不重算 ⇒ 放水、拿水照它往下走跟每次整間掃挑出來的一樣（TASK-0810）。 */
function wrsOrd(s, r, desc) {
  var W = s.W, st = desc ? (s.odSt || (s.odSt = new Int32Array(s.NR))) : (s.oaSt || (s.oaSt = new Int32Array(s.NR))), A = desc ? (s.odA || (s.odA = new Int32Array(s.n))) : (s.oaA || (s.oaA = new Int32Array(s.n)));
  if (st[r] === s.surfN) return A;
  st[r] = s.surfN; wrsRoomHw(s, r);
  var p0 = W.roomCol0[r], p1 = W.roomCol0[r + 1], hw = s.hw, i;
  for (i = p0; i < p1; i++) A[i] = i;
  var B = A.subarray(p0, p1);
  if (desc) B.sort(function (a, b) { return hw[b] - hw[a] || a - b; }); else B.sort(function (a, b) { return hw[a] - hw[b] || a - b; });
  s.wk.sort += (p1 - p0) * 4;                                             // 計算量：排一次照 m × log m 粗估
  return A;
}
/** 除錯：高過海面的水有幾單位（每一欄：裝的單位 − 裝到那一欄正上方海面那個高度要幾單位，正的才算）。 */
function wrsAbove(s, M) {
  var W = s.W, X = s.X, t = 0;
  for (var j = 0; j < s.n; j++) {
    if (!s.su[j]) continue;
    var P = M4.pt(M, X.cx[j], X.cy[j], W.colZ0[j]), zs = (seaH(P[0], P[2], SIMT) - (M[1] * X.cx[j] + M[5] * X.cy[j] + M[13])) / M[9], a = s.su[j] - wrColUnits(W, X, j, zs);
    if (a > 0) t += a;
  }
  return t;
}
/** 第 j 欄的水面面積（m²：水面那一層有幾格；滿了 ⇒ 那一間的水面面積，水是從整間的水面補過來的）。 */
function wrsColA(s, j) {
  var W = s.W; if (s.su[j] >= s.cap[j]) return Math.max(0.25, s.aR[W.colRoom[j]]);
  var l = clamp(Math.floor(s.zs[j] - W.colZ0[j]), 0, W.colNZ[j] - 1);
  return Math.max(S * S, W.cnt[W.colOff[j] + l] * S * S);
}
/** 第 r 間水面最低、沒滿的那一欄（都滿了 ⇒ dflt）。 */
function wrsColLow(s, r, dflt) {
  wrsRoomHw(s, r);
  var W = s.W, best = -1, bh = Infinity; s.wk.near += W.roomCol0[r + 1] - W.roomCol0[r];
  for (var q = W.roomCol0[r]; q < W.roomCol0[r + 1]; q++) if (s.su[q] < s.cap[q] && s.hw[q] < bh) { bh = s.hw[q]; best = q; }
  return best >= 0 ? best : dflt;
}
/** 第 r 間離 (x, y)（格座標）最近的一段（給了 z ⇒ 也照離那一段的高度）。從 (x, y) 那一格往外一圈一圈找（欄表 s.idx），
 *  那一圈的格離 (x, y) 最近也比找到的遠 ⇒ 停；一樣近取編號小的 ⇒ 跟整間掃挑出來的一樣（⛔ 以前整間掃：沉船幾百顆粒子落地 ⇒ 一步二十萬次工；TASK-0810）。 */
function wrsColNear(s, r, x, y, z) {
  var W = s.W, X = s.X, G = s.G, C = W.c, NCX = W.NCX, NCY = W.NCY, idx = s.idx, base = r * s.NCK, best = -1, bd = Infinity, nv = 0;
  var cx0 = clamp(Math.floor((x - W.x0) / C), 0, NCX - 1), cy0 = clamp(Math.floor((y - W.ylo) / C), 0, NCY - 1), KM = Math.max(NCX, NCY);
  function cell(i, j) {
    if (i < 0 || j < 0 || i >= NCX || j >= NCY) return;
    var ax = W.x0 + i * C, ay = W.ylo + j * C, ex = x < ax ? ax - x : x > ax + C ? x - ax - C : 0, ey = y < ay ? ay - y : y > ay + C ? y - ay - C : 0;
    if (ex * ex + ey * ey > bd) return;                                  // 這一格裡的段離得一定比找到的遠
    var q0 = idx.get(base + i * NCY + j); if (q0 === undefined) return;
    for (var q = G.col0[q0]; q < G.col0[q0 + 1]; q++) { nv++; var dx = X.cx[q] - x, dy = X.cy[q] - y, dz = z === undefined ? 0 : wrsSegDz(W, q, z), dd = dx * dx + dy * dy + dz * dz; if (dd < bd || (dd === bd && q < best)) { bd = dd; best = q; } }
  }
  for (var k = 0; k <= KM; k++) {
    var lb = (k - 1) * C; if (k >= 2 && lb * lb > bd) break;
    nv += 8 * k + 1;
    if (!k) { cell(cx0, cy0); continue; }
    for (var a = -k; a <= k; a++) { cell(cx0 + a, cy0 - k); cell(cx0 + a, cy0 + k); }
    for (a = -k + 1; a <= k - 1; a++) { cell(cx0 - k, cy0 + a); cell(cx0 + k, cy0 + a); }
  }
  s.wk.near += nv;
  return best;
}
/** 接口 i 掛的門還在 ⇒ 擋水（⛔ 不讀開關演出：門的開關只是畫面）。 */
function wrsDoorShut(s, i) { var d = s.sh && s.sh.doors ? s.sh.doors[s.odoor[i]] : null; return !!(d && d.m.alive); }
/** 走一步（dt 秒；照秒數）。fl ＝ 細檔（破口的位置、面積照它的，進水報表並排跑；TASK-0810 接到船上之後改讀船自己的破口）。 */
function wrsStep(sh, dt, fl) {
  var s = sh.wrs; if (!s || !(dt > 0)) return;
  s.sh = sh;
  var t0 = performance.now(), wk0 = wrsWork(s), W = s.W, O = s.O, M = sh.M, u = s.su, n = s.n, upm = s.upm, fk = sh.cfg.flood / LIM.flood[2], L = W.c * S, D = s.dbg, i, j, k;
  var tm = s.tm || (s.tm = { surf: 0, xc: 0, br: 0, open: 0, jet: 0, pipe: 0 }), tq = t0;   // 每一段的牆鐘（ms，累計；wrsRead tmStep）
  var dmax = wrsSurf(s, M), ns = s.opt.nocfl ? 1 : Math.min(WRS_NMAX, Math.max(1, Math.ceil(dt / (WRS_CFL * L / Math.sqrt(G * Math.max(dmax, 0.05)))))), h = dt / ns;
  tq = wrsTm(tm, 'surf', tq); s.sub = ns; s.steps++; wrsXcheck(s); tq = wrsTm(tm, 'xc', tq);
  // 破口：照細檔的破口清單（位置、面積、哪一舷），第一次碰到就找進去那一間（從破口往艙裡走）
  var hs = [];
  if (fl && s.opt.fixA && s.fixH) hs = s.fixH;                          // 反向對照（驗收第 10 格，wsimo=fixA）：破口的清單、面積停在第一次看到的那一刻（⛔ 細檔的破口面積什麼時候縮跟真實時間有關 ⇒ 兩次跑從那裡開始不同）
  else if (fl) for (var nNew = 0, k = 0; k < fl.holes.length; k++) {
    var hh = fl.holes[k], ar = fl.hA[hh]; if (!(ar > 0)) continue;
    var b = s.br.get(hh);
    if (!b) {
      if (nNew++ >= WRS_NEWBR) continue;                                 // 這一步找夠了 ⇒ 下一步再找
      var F = fl.F, side = (hh / (F.NX * F.NZ)) | 0, sg = side ? 1 : -1, rr = -1, x = Math.floor(fl.hX[hh]), z = Math.floor(fl.hZ[hh]), y0 = Math.floor(fl.hYi[hh]), yf = y0;
      for (var dy = 0; dy < 40 && rr < 0; dy++) for (var dz = 0; dz <= 2 && rr < 0; dz++) { rr = wrRoomAt(W, x, y0 + sg * dy, z + dz); yf = y0 + sg * dy; }
      var zf2 = z; for (var dz2 = 1; dz2 <= 40 && rr < 0; dz2++) for (var dy2 = 0; dy2 < 40 && rr < 0; dy2++) { rr = wrRoomAt(W, x, y0 + sg * dy2, z - dz2); yf = y0 + sg * dy2; zf2 = z - dz2; }   // 平著找不到（破口後面那一層不是房間：例如松島號砲廓的牆是裝甲、房間照拆掉裝甲的船殼切 ⇒ 那一層跟外面通）⇒ 往下找（水會落下去；TASK-0822）   // 從破口往艙裡（+sg）走，碰到的第一間
      b = { r: rr, j: rr >= 0 ? wrsColNear(s, rr, x + 0.5, yf + 0.5, (rr >= 0 && zf2 < z ? zf2 : z) + 0.5) : -1, acc: 0, q: 0, x: x + 0.5, y: yf + 0.5, z: z + 0.5, sg: sg, a0: ar };
      s.br.set(hh, b);
    }
    if (b.j >= 0) hs.push(hh, b);
  }
  if (fl && s.opt.fixA && !s.fixH && hs.length) s.fixH = hs;
  for (var sub = 0; sub < ns; sub++) {
    if (sub) { tq = performance.now(); wrsSurf(s, M); tq = wrsTm(tm, 'surf', tq); wrsXcheck(s); tq = wrsTm(tm, 'xc', tq); }
    if (s.opt.jetsOnly) { wrsJets(sh, s, h); continue; }
    var ab = s.opt.above ? wrsAbove(s, M) : 0, ab2;                       // 除錯（wsimo=above）：每一段讓高過海面的水多了多少               // 只走粒子（進水報表 wdrop：量落點）
    // ① 破口
    var bkR = [], bkL = [], bst = s.bkS = (s.bkS | 0) + 1, bkN = s.bkN || (s.bkN = new Int32Array(s.NR)), bkH = s.bkH || (s.bkH = new Float64Array(s.NR)), bkJ = s.bkJ || (s.bkJ = new Int32Array(s.NR)), bkU = s.bkU || (s.bkU = new Float64Array(s.NR));
    for (k = 0; k < hs.length; k += 2) {
      var hh2 = hs[k], br = hs[k + 1], P = M4.pt(M, fl.hX[hh2], fl.hY[hh2], fl.hZ[hh2]), jj = br.j, bA = s.opt.fixA ? br.a0 : fl.hA[hh2];
      if (br.tH === undefined || SIMT - br.tH >= WRS_SEA_DT - 1e-9) { br.hO = seaH(P[0], P[2], SIMT); br.tH = SIMT; s.wk.sea++; }   // 外面的海面：每 1/30 秒重算一次（⛔ 以前每個破口每一小步都算浪：殉爆三千塊破口 ⇒ 破口那段一步 6 ms）
      var hOut = br.hO, hIn = s.lv[jj];                                    // 裡面：破口那一欄的有效水面（整間滿 ⇒ 那一塊連通水體的水壓，wrsBody）
      br.hOut = hOut; br.py = P[1];                                       // 下一小步算連通水體用（破口 ＝ 通海的那一頭）（wrsSurf）
      var d = Math.max(hOut, P[1]) - Math.max(hIn, P[1]), q = 0;
      if (d > 0.001) q = FL_C * bA * Math.sqrt(2 * G * d) * fk; else if (d < -0.001) q = -FL_C * bA * Math.sqrt(2 * G * -d) * fk;
      br.acc += q * h * upm; var nu = br.acc > 0 ? Math.floor(br.acc) : Math.ceil(br.acc);
      if (nu > 0 && hIn < P[1] - 0.05 && wrsEmit(s, br.x, br.y, br.z, 0, br.sg * Math.sqrt(2 * G * d) / S, 0, nu, jj, Math.max(hOut, P[1]), -1)) { br.acc -= nu; s.inTot += nu; D.emitB += nu; }   // 裡面的水沒淹到破口 ⇒ 噴進來、落下（粒子；帶著外面的水頭）
      else if (nu > 0 && s.opt.nobkt) { var left = wrsPut(s, M, jj, nu, hOut); nu -= left; br.acc = left ? 0 : br.acc - nu; s.inTot += nu; }   // 反向對照（wsimo=nobkt）：每個破口各放一次（以前的做法）
      else if (nu > 0) {                                                  // 放進去：同一間的破口這一小步合起來放一次（下面）；⛔ 以前每個破口各放一次 ⇒ 殉爆三千多塊破口、每塊放不下就掃整間 ⇒ 一步 2,500 萬次工、52 ms
        var rq = W.colRoom[jj]; if (bkN[rq] !== bst) { bkN[rq] = bst; bkH[rq] = hOut; bkJ[rq] = jj; bkU[rq] = 0; bkR.push(rq); } else if (hOut > bkH[rq]) bkH[rq] = hOut;
        bkU[rq] += nu; bkL.push(br, nu); br.ar = bA; continue;
      }
      else if (nu < 0) { var take = wrsTake(s, M, jj, Math.min(-nu, u[jj])); br.acc = take < -nu ? 0 : br.acc + take; s.outTot += take; s.brOut = (s.brOut || 0) + take; nu = -take; }
      br.q = nu / (h * upm); br.ar = bA;
      if (!s.first && nu > 0) s.first = { dt: dt, h: h, units: nu };     // 第一次有水進來的那一小步（驗收第 6 條：同一個狀態走一步，1/30 秒是 1/60 秒的兩倍）                                              // 這一小步實際進（＋）出（−）的 m³/s
    }
    for (k = 0; k < bkR.length; k++) { var rq2 = bkR[k], tot2 = bkU[rq2], lf2 = wrsPut(s, M, bkJ[rq2], tot2, bkH[rq2]); bkU[rq2] = tot2 - lf2; s.inTot += tot2 - lf2; }   // 每一間放一次（從第一個破口那一段放、水頭取這幾個破口外面最高的）；bkU ⇒ 放進去了幾單位
    for (k = 0; k < bkL.length; k += 2) {                                 // 放進去的照破口的順序分回去（放不下的那幾個 ⇒ 零頭歸零，同以前）
      var br3 = bkL[k], nu3 = bkL[k + 1], rq3 = W.colRoom[br3.j], g3 = Math.min(nu3, bkU[rq3]); bkU[rq3] -= g3;
      br3.acc = g3 < nu3 ? 0 : br3.acc - nu3; br3.q = g3 / (h * upm);
      if (!s.first && g3 > 0) s.first = { dt: dt, h: h, units: g3 };
    }
    for (k = 0; k < s.tops.length; k++) {                                 // 門沒了的甲板開口：外面的水面高過開口 ⇒ 灌進來（同 25_doors.js doorInflow）
      var tp = s.tops[k], dd2 = sh.doors[tp.d]; tp.q = 0; if (!dd2 || dd2.m.alive) continue;
      var P2 = M4.pt(M, tp.x, tp.y, tp.z), dh2 = seaH(P2[0], P2[2], SIMT) - P2[1]; if (dh2 <= 0.001) continue;
      tp.acc += FL_C * tp.ar * Math.sqrt(2 * G * dh2) * fk * h * upm; var nt = Math.floor(tp.acc); if (nt <= 0) continue;
      var lt = wrsPut(s, M, tp.j, nt, P2[1] + dh2); tp.acc = lt ? 0 : tp.acc - nt; s.inTot += nt - lt; tp.q = (nt - lt) / (h * upm);
    }
    tq = wrsTm(tm, 'br', tq);
    if (s.opt.above) { ab2 = wrsAbove(s, M); s.dA.breach += ab2 - ab; ab = ab2; }
    // ② 開口（拆過的，wrsOpenings）：兩邊各一欄 ja／jb、水頭照有效水面 lv
    s.bud.clear();                                                        // 拉平的額度：每一對房（上游 → 下游）這一小步一份（⛔ 以前每一層的帶各夾各的 ⇒ 一扇門二十層搬二十倍）
    s.wk.open += s.NO;
    for (i = 0; i < s.NO; i++) {
      var A = s.ja[i], B = s.jb[i], ox = O.X[i], oy = O.Y[i], ar2 = O.N[i] * S * S, Qv = 0, src = -1, dst = -1, hu = 0, hd = 0, wb = 0, wt = 0, bk = -1, bu = 0, ck = 0, cu = 0, up = false;
      s.oq[i] = 0; s.ost[i] = 0;
      if (s.opt.onlyOp !== undefined && i !== s.opt.onlyOp) { s.oacc[i] = 0; continue; }   // 反向對照（進水報表 wpair）：只開這一個開口
      if ((s.odoor[i] >= 0 && wrsDoorShut(s, i)) || (u[A] === 0 && u[B] === 0)) { s.oacc[i] = 0; continue; }   // 門、艙蓋還在 ⇒ 不流
      var base = M[1] * ox + M[5] * oy + M[13], lA = s.lv[A], lB = s.lv[B];
      if (O.T[i]) {                                                        // 旁邊的帶：帶底 wb、帶頂 wt
        wb = base + M[9] * O.Z[i]; wt = wb + M[9];
        if (lA >= lB) { src = A; dst = B; } else { src = B; dst = A; }
        hu = Math.max(lA, lB); hd = Math.min(lA, lB); if (hu <= wb + 1e-4) { s.oacc[i] = 0; continue; }
        var fs = clamp((hu - wb) / Math.max(1e-6, wt - wb), 0, 1), head = hu - Math.max(hd, 0.5 * (wb + wt)); if (head <= 1e-4) { s.oacc[i] = 0; continue; }
        Qv = FL_C * ar2 * fs * Math.sqrt(2 * G * head) * h;
      } else {                                                             // 上下的：A 下面、B 上面；開口 wb ＝ wt ＝ 那一面的高度
        wb = wt = base + M[9] * (O.Z[i] + 1);
        if (lA > wt + 1e-4 && lA > lB + 1e-4) {                            // 下面那間的有效水面高過開口、也高過上面那間 ⇒ 水壓往上推（例：底艙灌滿、連著上一層的水 ⇒ 夾在中間的小艙從底下灌滿；⛔ 以前只會往下流 ⇒ 小艙一直是乾的、上面的水一直落進去再被搬回去，繞圈）
          up = true; hu = lA; hd = lB; var head3 = lA - Math.max(lB, wt); if (head3 <= 1e-4) { s.oacc[i] = 0; continue; }
          src = A; dst = B; Qv = FL_C * ar2 * Math.sqrt(2 * G * head3) * h;
        } else {
          if (lB <= wt + 1e-4) { s.oacc[i] = 0; continue; }
          hu = lB; hd = lA; var head2 = hu - Math.max(lA, wt); if (head2 <= 1e-4) { s.oacc[i] = 0; continue; }
          src = B; dst = A; Qv = FL_C * ar2 * Math.sqrt(2 * G * head2) * h;
        }
      }
      var Q0 = Qv;
      if (hd > wb && !s.opt.noclamp) {                                     // 下游淹過開口 ⇒ 最多搬到兩間拉平（驗收第 8 條）：這一對房這一小步剩下的額度
        var rS = W.colRoom[src], rD = W.colRoom[dst]; bk = rS * s.NR + rD; bu = s.bud.get(bk);
        if (bu === undefined) { var aS = Math.max(0.25, s.aR[rS]), aD = Math.max(0.25, s.aR[rD]); bu = Math.max(0, hu - hd) * aS * aD / (aS + aD); }
        Qv = Math.min(Qv, bu);
        ck = -1 - (src * s.n + dst); cu = s.bud.get(ck);                    // 兩欄之間也只搬到拉平：水是放進那一欄的（⛔ 只照兩間房的水面面積夾 ⇒ 欄比房間小很多、一下衝過頭、下一小步流回來：0.1 秒一步 300 秒來回穿越 115 萬次）
        if (cu === undefined) { var cS = wrsColA(s, src), cD = wrsColA(s, dst); cu = Math.max(0, hu - hd) * cS * cD / (cS + cD); }
        Qv = Math.min(Qv, cu);
      }
      var rD2 = W.colRoom[dst], free = s.rf[rD2] - s.fly[rD2];          // 下游那一間還裝得下多少（扣掉飛行中要去的）：裝滿了 ⇒ 不流（⛔ 以前照水頭全速送、裝不下再從往上的開口溢回上游 ⇒ 底艙與艙底空腔之間繞圈）
      if (free < 1) { s.oacc[i] = 0; if (bk >= 0) s.bud.set(bk, bu); continue; }
      var sgn = src === A ? 1 : -1;                                        // ＋ ⇒ a → b、− ⇒ b → a（上下的：a 下 b 上 ⇒ 往下流是 −）
      s.oacc[i] = s.oacc[i] * sgn > 0 ? s.oacc[i] : 0;                    // 方向換了 ⇒ 零頭歸零
      s.oacc[i] += sgn * Qv * upm;
      var mv = Math.min(Math.floor(Math.abs(s.oacc[i])), u[src], Math.floor(free));
      if (mv > 0 && hd > wb && !s.opt.noclamp && !s.opt.eqStale) mv = Math.min(mv, wrsEqUnits(s, M, src, dst, mv));   // 照兩欄當下的水量再夾一次（⛔ 只照這一小步開頭的水位夾：同一小步前面的開口已經動過這兩欄 ⇒ 0.1 秒一步 300 秒、搬完當下兩邊反過來 11 萬次）；opt.eqStale ⇒ 舊做法 if (mv <= 0) { if (bk >= 0) { s.bud.set(bk, bu); s.bud.set(ck, cu); } continue; }
      var fall = !up && s.lv[dst] <= wb, lf = 0, em = false;                                   // 下游的水面沒淹到開口 ⇒ 自由落下（粒子）
      if (fall) {                                                          // 起點 ＝ 下游那一側的那一格（上下的：開口正下方那一格）；旁邊的照面的法線（上游那格 → 下游那格）噴出去
        var dA = dst === A, ex = dA ? O.ax[i] : O.bx[i], ey = dA ? O.ay[i] : O.by[i], nx = O.T[i] ? ex - (dA ? O.bx[i] : O.ax[i]) : 0, ny = O.T[i] ? ey - (dA ? O.by[i] : O.ay[i]) : 0;
        var sp = O.T[i] ? Math.sqrt(2 * G * Math.max(0, hu - 0.5 * (wb + wt))) / S : 0;   // 粒子帶的水頭：那一欄的水面跟出發那一間的平均水面取低的（⛔ 照那一欄 ⇒ 從水丘噴出去的水帶著丘頂的高度，落點那一間也被墊高、高過海面）
        if (wrsEmit(s, ex + 0.5, ey + 0.5, O.Z[i] + 0.5, nx * sp, ny * sp, 0, mv, src, s.rl[W.colRoom[src]] > -1e8 ? Math.min(hu, s.rl[W.colRoom[src]]) : hu, dst, rD2)) { em = true; if (O.T[i]) D.emitS += mv; else D.emitD += mv; s.emO[i] += mv; if (s.opt.above && hu > 0.02 + seaH(M[0] * ox + M[4] * oy + M[8] * O.Z[i] + M[12], M[2] * ox + M[6] * oy + M[10] * O.Z[i] + M[14], SIMT)) { D.hiE = (D.hiE || 0) + mv; var kk = (s.su[src] >= s.cap[src] ? (s.rn[W.colRoom[src]] ? 'colFull' : (s.rFH[W.colRoom[src]] > -1e8 ? 'body' : 'bodyNone')) : 'open'); D['hi_' + kk] = (D['hi_' + kk] || 0) + mv; } } else lf = wrsPut(s, M, dst, mv, hu);
      } else lf = wrsPut(s, M, dst, mv, hu);
      mv -= lf; wrsTake(s, M, src, mv); if (!em) s.rf[rD2] -= mv;        // 直接放進去的扣這一小步的空位（飛出去的記在 fly）
      s.oacc[i] = lf ? 0 : (s.oacc[i] - sgn * mv) % 1;                    // 搬不動的不存著（⛔ 以前留在累加器、下次一口氣放）
      if (bk >= 0) { s.bud.set(bk, bu - mv / upm); s.bud.set(ck, cu - mv / upm); }
      s.oq[i] = sgn * mv / (h * upm); s.mvO[i] += sgn * mv;               // 除錯：每個開口淨搬了多少（＋ a → b；過程圖）
      if (mv && s.olast && s.olast[i] && s.olast[i] !== sgn) { s.cross++; s.crO[i]++; }   // 流向翻過來（驗收第 8 條：不夾到拉平 ⇒ 兩邊水位來回穿越）
      if (mv) (s.olast || (s.olast = new Int8Array(s.NO)))[i] = sgn; s.ost[i] = mv ? sgn : 0;
      // 驗收第 8 格的尺 ①：這個開口搬完當下，照兩欄現在的水量重算兩邊的水面（⛔ 以前照兩欄的水面面積線性估：wrsPut 下游那一欄最多裝到上游的水頭、多的放到別欄 ⇒ 高估下游漲多少，量出假的衝過頭）
      if (mv && !em && hd > wb) { var dself = wrsLvNow(s, M, src) - wrsLvNow(s, M, dst); if (dself < -0.01) s.xsk[(s.rn[W.colRoom[src]] ? 0 : 1) | (s.rn[rD2] ? 0 : 2) | (up ? 4 : 0) | (O.T[i] ? 8 : 0)]++;   // 分類：1 上游整間滿、2 下游整間滿、4 往上推、8 旁邊的開口
      if (dself < -0.01 && !s.rn[W.colRoom[src]] && !s.rn[rD2]) s.xselfB++; else if (dself < -0.01) { s.xself++; s.xsO[i]++; if (s.opt.xdbg && (s.xdbg || (s.xdbg = [])).length < 20) s.xdbg.push({ i: i, T: O.T[i], Q0: +(Q0 * upm).toFixed(1), Qv: +(Qv * upm).toFixed(1), cu: cu === undefined ? null : +(cu * upm).toFixed(1), bu: bk >= 0 ? +(bu * upm).toFixed(1) : null, mv: mv, mvAll: mv + lf, lf: lf, hu: +hu.toFixed(4), hd: +hd.toFixed(4), cS: +wrsColA(s, src).toFixed(3), cD: +wrsColA(s, dst).toFixed(3), uS: u[src], capS: s.cap[src], uD: u[dst], capD: s.cap[dst], up: up, dself: +dself.toFixed(4) }); } }   // 驗收第 8 格的尺 ①：只算這個開口自己這一步搬的量（兩欄的水面面積），兩邊會不會反過來超過 1 cm ⇒ 這個開口自己衝過頭（夾子管的就是這一份）
      if (mv && !em) { s.xs[i] = src + 1; s.xd[i] = dst; s.xk[i] = (Qv < Q0 ? 1 : 0) | (u[src] >= s.cap[src] ? 2 : 0) | (u[dst] >= s.cap[dst] ? 4 : 0) | (O.T[i] ? 0 : 8) | (s.rn[W.colRoom[src]] ? 0 : 16) | (s.rn[rD2] ? 0 : 32) | (hd > wb ? 64 : 0); }   // 除錯：穿越照這一次搬的情況分類（1 夾子有作用、2 上游那一段滿、4 下游那一段滿、8 上下的開口、16 上游整間滿、32 下游整間滿、64 下游淹過開口）                // 驗收第 8 格的尺：下一小步讀兩邊的水面（wrsXcheck）
    }
    tq = wrsTm(tm, 'open', tq);
    if (s.opt.above) { ab2 = wrsAbove(s, M); s.dA.open += ab2 - ab; ab = ab2; }
    tq = performance.now(); wrsJets(sh, s, h); tq = wrsTm(tm, 'jet', tq);                                                    // ④ 飛行中的粒子
    if (s.opt.above) { ab2 = wrsAbove(s, M); s.dA.jets += ab2 - ab; ab = ab2; }
    wrsPipes(s, M, h);                                                    // ③ 房間內：虛擬管
    tq = wrsTm(tm, 'pipe', tq);
    if (s.opt.above) { ab2 = wrsAbove(s, M); s.dA.pipe += ab2 - ab; }
  }
  if (s.opt.level) for (var rl = 0, U0 = new Float64Array(s.NR); rl < 1; rl++) {   // 反向對照：每一步之後每間房瞬間拉平（驗收第 3 條的「房間內瞬間拉平」）
    for (j = 0; j < n; j++) U0[W.colRoom[j]] += u[j];
    for (var r2 = 0; r2 < s.NR; r2++) if (U0[r2] > 0) wrLevelRoom(W, s.X, M, r2, U0[r2], u);
  }
  wrsAgg(s);
  var dwk = wrsWork(s) - wk0; s.wkMax = Math.max(s.wkMax || 0, dwk); s.wkLast = dwk;
  s.ms = performance.now() - t0; s.msTot = (s.msTot || 0) + s.ms; s.msMax = Math.max(s.msMax || 0, s.ms);   // 牆鐘（要開著窗格量；無頭的 performance.now 不準）
}
/** ③ 房間內：虛擬管（每一小步；h 秒）。同一間、相鄰兩欄、高度有重疊的兩段之間照水面差流（wrsInit 的管子 E）。 */
function wrsPipes(s, M, h) {
  var W = s.W, u = s.su, n = s.n, upm = s.upm, L = W.c * S, j, k;
  var E = s.E, ef = E.f, eac = E.ac, K = s.K, ko = s.kout, damp = Math.max(0, 1 - WRS_DAMP * h);
  var act = s.act, na = act.length, R0 = W.roomCol0, eR0 = s.eR0, r, ia;   // 只走要算的房間（wrsSurf 的 s.act：有水的＋這一小步被放了水的；管子都在同一間裡）
  for (ia = 0; ia < na; ia++) wrsRoomHw(s, act[ia]);                  // 這一小步才被放水的房間：水面高度照乾的（同以前 wrsSurf 算的）
  var nE = 0, nS = 0; for (ia = 0; ia < na; ia++) { nE += eR0[act[ia] + 1] - eR0[act[ia]]; nS += R0[act[ia] + 1] - R0[act[ia]]; }
  s.wk.pipe += 3 * nE + nS;   // 每一條管子 ＝ 同一間、相鄰兩欄、高度有重疊的兩段（wrsInit）
  for (ia = 0; ia < na; ia++) for (r = act[ia], k = eR0[r]; k < eR0[r + 1]; k++) {
    var ja2 = E.a[k], jb2 = E.b[k];
    if (u[ja2] === 0 && u[jb2] === 0) { ef[k] = 0; continue; }
    if (s.opt.noGapPipe && (s.gp[ja2] || s.gp[jb2])) { ef[k] = 0; continue; }   // 反向對照（wsimo=noGapPipe）：接到上下兩段合併欄（拆過的段）的管子關掉
    var hj = s.hw[ja2], hk = s.hw[jb2], sill = Math.max(hj - (s.zs[ja2] - s.zf[ja2]) * M[9], hk - (s.zs[jb2] - s.zf[jb2]) * M[9]);
    var wtop = Math.min(hj + (W.colZ0[ja2] + W.colNZ[ja2] - s.zs[ja2]) * M[9], hk + (W.colZ0[jb2] + W.colNZ[jb2] - s.zs[jb2]) * M[9]), dep = Math.min(Math.max(hj, hk), wtop) - sill;   // 管口只開在兩段高度重疊的那一截（地板高的那個到頂低的那個）
    if (dep <= 0) { ef[k] = 0; continue; }
    var fv = ef[k] * damp + h * G * dep * (hj - hk) * Math.min(s.ca[ja2], s.ca[jb2]) / (L * L);   // m³/s：dQ/dt ＝ g·水深·Δh·管寬 ÷ 管長；管長 ＝ 欄寬 L、管寬 ＝ 兩段底面積小的那個 ÷ L（整欄 ⇒ L；⛔ 以前多乘一個 L）
    if ((fv > 0 && u[jb2] >= s.cap[jb2]) || (fv < 0 && u[ja2] >= s.cap[ja2])) fv = 0;   // 收的那一段滿了
    ef[k] = fv;
  }
  for (ia = 0; ia < na; ia++) for (r = act[ia], j = R0[r]; j < R0[r + 1]; j++) ko[j] = 0;
  for (ia = 0; ia < na; ia++) for (r = act[ia], k = eR0[r]; k < eR0[r + 1]; k++) { if (ef[k] > 0) ko[E.a[k]] += ef[k]; else if (ef[k] < 0) ko[E.b[k]] -= ef[k]; }
  for (ia = 0; ia < na; ia++) for (r = act[ia], j = R0[r]; j < R0[r + 1]; j++) { if (!u[j]) { K[j] = 0; continue; } var v = u[j] / upm; K[j] = ko[j] * h > v ? v / (ko[j] * h) : 1; }   // 流出照有的水縮放（不會變負）
  for (ia = 0; ia < na; ia++) for (r = act[ia], k = eR0[r]; k < eR0[r + 1]; k++) {
    var fv2 = ef[k]; if (!fv2) continue;
    var ja3 = E.a[k], jb3 = E.b[k];
    fv2 *= fv2 > 0 ? K[ja3] : K[jb3]; ef[k] = fv2;
    eac[k] += fv2 * h * upm;
    var m = eac[k] > 0 ? Math.floor(eac[k]) : Math.ceil(eac[k]);
    if (m > 0) { m = Math.max(0, Math.min(m, u[ja3], s.cap[jb3] - u[jb3])); u[ja3] -= m; u[jb3] += m; eac[k] -= m; }
    else if (m < 0) { m = Math.max(0, Math.min(-m, u[jb3], s.cap[ja3] - u[ja3])); u[jb3] -= m; u[ja3] += m; eac[k] += m; }
    if (Math.abs(eac[k]) >= 1) eac[k] %= 1;                              // 搬不動的不存著
  }
}
/** 計算量（TASK-0808：每一步花多久改量做了幾次工 —— 決定性、不受 CPU 忙不忙、分頁凍不凍影響）：掃過幾段（wrsSurf）、水體（wrsBody）、開口、管子（每條三趟）、放水與拿水掃過的段、粒子、粒子走過的格。 */
/** 牆鐘基準（wsimo=bench）：在現在的狀態原地重跑，20 批各 10 次取最快那一批 ⇒ 每次幾 ms。⚠ 白天機器忙時連取最快的也會差 2 倍（同一場 t 68 → 128 秒）⇒ 比快慢只能在同一場裡新舊交錯量，⛔ 不能拿兩場的數字比（2026-10-22：以為快了一倍，同一場一量舊版反而快一點）。 */
function wrsBench(sh) {
  var s = sh.wrs, M = sh.M, o = {};
  function bt(f) { var best = Infinity; for (var b = 0; b < 20; b++) { var t = performance.now(); for (var k = 0; k < 10; k++) f(); best = Math.min(best, (performance.now() - t) / 10); } return +best.toFixed(4); }
  o.surf = bt(function () { wrsSurf(s, M); });                           // 含 wrsBody
  o.body = bt(function () { wrsBody(s, M); });
  var E = s.E, u0 = s.su.slice(), f0 = E.f.slice(), a0 = E.ac.slice(), wk0 = s.wk.pipe;   // 管子會搬水 ⇒ 每次從同一份狀態開始、跑完還原（1/60 秒一小步）
  o.pipe = bt(function () { s.su.set(u0); E.f.set(f0); E.ac.set(a0); wrsPipes(s, M, 1 / 60); });
  o.copy = bt(function () { s.su.set(u0); E.f.set(f0); E.ac.set(a0); });   // 還原本身花多久（pipe 要扣掉）
  s.su.set(u0); E.f.set(f0); E.ac.set(a0); s.wk.pipe = wk0;
  return o;
}
function wrsTm(tm, k, t) { var n = performance.now(); tm[k] += n - t; return n; }
/** 抽水（TASK-0810，33_flood.js flRoomStep）：抽 nu 單位，從水面最低的那一間抽（那一間有水的段照各自的水量一起抽 ⇒ 不在一欄挖洞）；不夠 ⇒ 下一間，最多三間。回抽到幾單位。 */
function wrsPump(s, nu) {
  var W = s.W, u = s.su, got = 0, tried = [], it, j, q;
  for (it = 0; it < 3 && got < nu; it++) {
    var best = -1, bh = Infinity;
    for (j = 0; j < s.n; j++) if (u[j] > 0 && s.hw[j] < bh && tried.indexOf(W.colRoom[j]) < 0) { bh = s.hw[j]; best = j; }
    if (best < 0) break;
    var r = W.colRoom[best], Ur = 0; tried.push(r);
    for (q = W.roomCol0[r]; q < W.roomCol0[r + 1]; q++) Ur += u[q];
    var rest = Math.min(nu - got, Ur);
    for (q = W.roomCol0[r]; q < W.roomCol0[r + 1] && got < nu; q++) if (u[q] > 0) { var a = Math.min(u[q], nu - got, Math.ceil(rest * u[q] / Ur)); u[q] -= a; got += a; }
  }
  if (got) { s.outPump = (s.outPump || 0) + got; wrsAgg(s); }
  return got;
}
function wrsWork(s) { var w = s.wk; return w.surf + w.body + w.open + w.pipe + w.put + w.take + w.jet + w.dda + w.near + w.sort + w.sea; }
/** 對外的水量（sh.wrs.u：每個烘焙的欄裝幾單位 ＝ 它每一段加起來；63_wrwater_gl.js 照它畫）。⚠ 上段有水、下段沒滿時加起來會畫在下段裡（畫面只有一個水面）。 */
function wrsAgg(s) { var u = s.u, su = s.su, P = s.G.par; u.fill(0); for (var k = 0; k < s.n; k++) u[P[k]] += su[k]; }
/** 第 j 段現在的有效水面（同 wrsSurf 的 lv，但照現在的水量重算那一段；整段滿 ⇒ 照這一小步開頭那一間的 lv 不變：整間的平均水面、相連水體的水壓）。 */
function wrsLvNow(s, M, j) {
  var u = s.su[j]; if (u <= 0) return -1e9; if (u >= s.cap[j]) return s.lv[j];
  var X = s.X; return M[1] * X.cx[j] + M[5] * X.cy[j] + M[9] * wrColZ(s.W, X, j, u) + M[13];
}
/** 從 a 段搬 m 單位到 b 段之後兩邊的水面會不會反過來 ⇒ 最多能搬幾單位（≤ mx；二分）。滿的那一段照它的 lv 不變（上游：wrsTake 從整間的水面拿；下游：wrsPut 放到別欄、往上溢），
 *  沒滿的照它自己的水量（下游當作全部收進那一段 ⇒ 漲得最多，保守）。 */
function wrsEqUnits(s, M, a, b, mx) {
  var W = s.W, X = s.X, ua = s.su[a], ub = s.su[b], fa = ua >= s.cap[a], fb = ub >= s.cap[b];
  function lvA(m) { if (fa) return s.lv[a]; var u = ua - m; return u <= 0 ? -1e9 : M[1] * X.cx[a] + M[5] * X.cy[a] + M[9] * wrColZ(W, X, a, u) + M[13]; }
  function lvB(m) { if (fb) return s.lv[b]; var u = Math.min(s.cap[b], ub + m); return M[1] * X.cx[b] + M[5] * X.cy[b] + M[9] * wrColZ(W, X, b, u) + M[13]; }
  if (lvA(mx) >= lvB(mx)) return mx;
  if (lvA(0) <= lvB(0)) return 0;
  var lo = 0, hi = mx;
  while (hi - lo > 1) { var md = (lo + hi) >> 1; if (lvA(md) >= lvB(md)) lo = md; else hi = md; }
  return lo;
}
/** 驗收第 8 格的尺：上一小步直接搬過水的開口，這一小步讀到兩邊的有效水面反過來、差超過 1 cm ⇒ 真的穿越一次（⛔ 只數流向翻過來 cross ⇒ 高度場自己的晃動、別的開口也算進去）。 */
function wrsXcheck(s) {
  for (var i = 0; i < s.NO; i++) { var a = s.xs[i]; if (!a) continue; s.xs[i] = 0; if (s.lv[a - 1] - s.lv[s.xd[i]] < -0.01) { s.xover++; s.xoO[i]++; s.xcl[s.xk[i]]++; } }
}
/** 灌滿的部分當成連通的水體（Tim 2026-10-22「水壓可以參考連通管原理 側面也可以傳遞水壓(可以把灌滿的部分視為連通水體計算)」）：
 *  整間灌滿的房間，經過開口（旁邊、上下都算；門、艙蓋擋住的不算）連到另一間也灌滿的 ⇒ 同一塊水體（union-find）；
 *  一塊水體一個水壓 rFH（世界高度）＝ 接出去的每一頭照面積加權平均（Kirchhoff，流量當線性近似）：
 *    · 通到沒滿的房間的開口：那一間在開口那一欄的水面，低於開口（乾、或水沒淹到）⇒ 開口的高度（水從這裡自由流出）；
 *    · 破口：外面的海面（照破口面積）。⇒ 封死的整間（只通海）水壓 ＝ 海面、不再進水；有出口 ⇒ 介於海面與出口之間，水從海進、從出口出（連通管）。
 *  ⛔ 以前一間一間看：整間滿 ⇒ 照往上的開口那幾間最高的那一欄 ⇒ 上面那間局部鼓起來的地方變成水壓、再往上推平 ⇒ 只升不降，900 秒高過海面、比參考解多 16–20%。
 *  出口（那一邊沒淹過開口）像單向閥：只有比水體水壓低的才算（⛔ 全算 ⇒ 高處的出口把平均拉高、水體把水推到海面以上：30／10 Hz 900 秒高過海面 1.6 m）。
 *  沒有一頭有水的（只剩出口、全被門擋住、或接的都是灌滿的）⇒ −1e9（呼叫的人取欄頂）。 */
function wrsBody(s, M) {
  var W = s.W, O = s.O, u = s.su, NR = s.NR, par = s.fpar, i, r;
  s.wk.body += 2 * s.NO + 6 * NR;
  for (r = 0; r < NR; r++) { par[r] = r; s.fa[r] = 0; s.fh[r] = 0; }
  function fd(a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }
  for (i = 0; i < s.NO; i++) {
    var a1 = s.oa[i], b1 = s.ob[i]; if (s.rn[a1] || s.rn[b1] || (s.odoor[i] >= 0 && wrsDoorShut(s, i))) continue;
    var x1 = fd(a1), y1 = fd(b1); if (x1 !== y1) par[Math.max(x1, y1)] = Math.min(x1, y1);
  }
  var A = s.fAt || (s.fAt = []), na = 0, it, H = s.fH || (s.fH = new Float64Array(NR));
  function at(c, ar, h, out) { var e = A[na] || (A[na] = [0, 0, 0, 0]); e[0] = c; e[1] = ar; e[2] = h; e[3] = out; na++; }
  for (i = 0; i < s.NO; i++) {                                           // 接出去的每一頭：[水體, 面積, 水位, 是不是出口]
    var fa = !s.rn[s.oa[i]], fb = !s.rn[s.ob[i]]; if (fa === fb || (s.odoor[i] >= 0 && wrsDoorShut(s, i))) continue;
    var F = fa ? s.oa[i] : s.ob[i], jR = fa ? s.jb[i] : s.ja[i], base = M[1] * O.X[i] + M[5] * O.Y[i] + M[13];
    var zo = base + M[9] * (O.T[i] ? O.Z[i] + 0.5 : O.Z[i] + 1), hR = u[jR] > 0 ? s.hw[jR] : -1e9;
    if (hR > zo) at(fd(F), O.N[i] * S * S, hR, 0); else at(fd(F), O.N[i] * S * S, zo, 1);   // 那一邊的水淹過開口 ⇒ 一頭水位；沒淹過 ⇒ 出口（自由流出，水位 ＝ 開口高度）
  }
  s.br.forEach(function (b) { if (b.j < 0 || !(b.ar > 0) || b.hOut === undefined) return; var F2 = W.colRoom[b.j]; if (s.rn[F2]) return; if (b.hOut > b.py) at(fd(F2), b.ar, b.hOut, 0); else at(fd(F2), b.ar, b.py, 1); });   // 破口：海面淹過 ⇒ 一頭（海）、沒淹過 ⇒ 出口
  for (r = 0; r < NR; r++) H[r] = 1e9;                                   // 出口像單向閥：只有低於水體水壓的才流 ⇒ 先只算有水的那幾頭，再把低於它的出口加進來重算，幾次就穩
  for (it = 0; it < 4; it++) {
    for (r = 0; r < NR; r++) { s.fa[r] = 0; s.fh[r] = 0; }
    for (var e2 = 0; e2 < na; e2++) { var E = A[e2]; if (E[3] && !(it && E[2] < H[E[0]])) continue; s.fa[E[0]] += E[1]; s.fh[E[0]] += E[1] * E[2]; }
    for (r = 0; r < NR; r++) H[r] = s.fa[r] > 0 ? s.fh[r] / s.fa[r] : -1e9;
  }
  for (r = 0; r < NR; r++) { if (s.rn[r]) { s.rFH[r] = -1e9; continue; } s.rFH[r] = H[fd(r)]; }
}
/** 讀數：水量（m³，含飛行中的粒子；跟參考解比的是艙內全部的水）、水的重心（不含飛行中的）（m，離船型中線，同 33_flood.js fl.comX／comY）、照它算的傾斜目標（floodTilt）、破口與接口的流量。 */
function wrsRead(sh) {
  var s = sh.wrs; if (!s) return null;
  var W = s.W, X = s.X, u = s.su, tot = 0, mx = 0, my = 0, cx = sh.T.cx, cy = sh.T.cy;
  for (var j = 0; j < s.n; j++) if (u[j]) { tot += u[j]; mx += u[j] * (X.cx[j] - cx); my += u[j] * (X.cy[j] - cy); }
  var vol = tot / s.upm, k = { vol: vol, comX: tot ? mx / tot * S : 0, comY: tot ? my / tot * S : 0 }, tl = floodTilt(sh, k);
  var nin = 0, nout = 0, nst = 0; for (var i = 0; i < s.NO; i++) { if (s.ost[i] > 0) nout++; else if (s.ost[i] < 0) nin++; else nst++; }
  var rs = 0, rn = 0, rmax = 0;                                          // 高度場粗不粗（驗收第 2 條）：同一間相鄰兩欄都有水、水面差的平均與最大（m）
  for (var e = 0; e < s.E.n; e++) { var j2 = s.E.a[e], nb = s.E.b[e]; if (!u[j2] || !u[nb] || u[j2] >= s.cap[j2] || u[nb] >= s.cap[nb]) continue; var dd = Math.abs(s.hw[j2] - s.hw[nb]); rs += dd; rn++; if (dd > rmax) rmax = dd; }
  for (var hsh = 2166136261, j3 = 0; j3 < s.n; j3++) hsh = Math.imul(hsh ^ u[j3], 16777619);   // 狀態雜湊（驗收第 10 格：兩次跑逐秒比）：每一欄的單位 ＋ 飛行中
  hsh = Math.imul(hsh ^ s.Jtot, 16777619); hsh = Math.imul(hsh ^ s.J.n, 16777619);
  var brs = []; s.br.forEach(function (b) { if (b.j >= 0) brs.push([+(b.ar || 0).toFixed(3), +b.q.toFixed(4)]); });
  return { vol: +((tot + s.Jtot) / s.upm).toFixed(3), hash: (hsh >>> 0).toString(16), xself: s.xself, xselfB: s.xselfB, xsk: Array.from(s.xsk), wk: Object.keys(s.wk).reduce(function (o, k) { o[k] = s.steps ? Math.round(s.wk[k] / s.steps) : 0; return o; }, {}), wkStep: s.steps ? Math.round(wrsWork(s) / s.steps) : 0, wkMax: s.wkMax || 0, tmStep: s.tm && s.steps ? Object.keys(s.tm).reduce(function (o, k) { o[k] = +(s.tm[k] / s.steps).toFixed(3); return o; }, {}) : null, msStep: s.steps ? +((s.msTot || 0) / s.steps).toFixed(3) : 0, msMax: +(s.msMax || 0).toFixed(2), xdbg: s.xdbg, xover: s.xover, xcl: (function () { var L = []; for (var c = 0; c < 128; c++) if (s.xcl[c]) L.push([c, s.xcl[c]]); return L.sort(function (x, y) { return y[1] - x[1]; }); })(), xTop: (function () { var L = []; for (var q = 0; q < s.NO; q++) if (s.xoO[q]) L.push(q); L.sort(function (x, y) { return s.xoO[y] - s.xoO[x]; }); return L.slice(0, 8).map(function (q) { return [q, s.O.T[q] ? 'side' : 'deck', s.oa[q], s.ob[q], s.O.Z[q], s.xoO[q]]; }); })(), rough: rn ? +(rs / rn).toFixed(4) : 0, roughMax: +rmax.toFixed(3), cross: s.cross, first: s.first || null, br: brs, comX: +k.comX.toFixed(2), comY: +k.comY.toFixed(2), roll: +tl[0].toFixed(4), pitch: +tl[1].toFixed(4), inTot: +(s.inTot / s.upm).toFixed(3), outTot: +(s.outTot / s.upm).toFixed(3),
    cons: tot + s.Jtot - s.inTot + s.outTot, dbg: s.dbg ? Object.keys(s.dbg).reduce(function (o, k) { o[k] = +(s.dbg[k] / s.upm).toFixed(2); return o; }, {}) : null, brOut: +((s.brOut || 0) / s.upm).toFixed(2), spillR: s.spillR ? Object.keys(s.spillR).map(function (r) { return [+r, +(s.spillR[r] / s.upm).toFixed(2), +(W.roomVox[r] * S * S * S).toFixed(2)]; }) : null, crossTop: (function () { var L = []; for (var q = 0; q < s.NO; q++) if (s.crO[q]) L.push(q); L.sort(function (x, y) { return s.crO[y] - s.crO[x]; }); return L.slice(0, 8).map(function (q) { return [q, s.O.T[q] ? 'side' : 'deck', s.oa[q], s.ob[q], s.O.Z[q], s.crO[q], s.su[s.ja[q]] >= s.cap[s.ja[q]] ? 'aFull' : 'a', s.su[s.jb[q]] >= s.cap[s.jb[q]] ? 'bFull' : 'b']; }); })(), dA: s.opt.above ? Object.keys(s.dA).reduce(function (o, k) { o[k] = +(s.dA[k] / s.upm).toFixed(2); return o; }, {}) : undefined, jets: s.J.n, jetM3: +(s.Jtot / s.upm).toFixed(3), sub: s.sub, ms: +s.ms.toFixed(2), ops: [nst, nout, nin] };
}
/** 生一顆粒子（格座標、格／秒、單位；src ＝ 從哪一欄出來的，落點放不下時放回去；hd ＝ 上游的水頭（世界高度），落點那一間滿了照它往上溢）。滿了 ⇒ 回 false（呼叫的人直接搬）。 */
function wrsEmit(s, x, y, z, vx, vy, vz, nu, src, hd, dst, fr) {
  var J = s.J; if (J.n >= WRS_JN || nu <= 0) return false;
  var o = J.n * 3; J.p[o] = x; J.p[o + 1] = y; J.p[o + 2] = z; J.v[o] = vx; J.v[o + 1] = vy; J.v[o + 2] = vz; J.u[J.n] = nu; J.src[J.n] = src; J.life[J.n] = WRS_JLIFE; J.hd[J.n] = hd === undefined ? -1e9 : hd; J.dst[J.n] = dst === undefined ? -3 : dst; J.fr[J.n] = fr === undefined ? -1 : fr; J.wt[J.n] = 0; if (fr >= 0) s.fly[fr] += nu; J.n++;
  s.Jtot += nu; s.jet += nu; return true;
}
/** 飛行中的粒子走 h 秒：照船上的重力加速；線段一格一格走（DDA）⇒ 實心 ⇒ 放進前一格那一間；某一欄的水面以下 ⇒ 放進那一欄；出了船 ⇒ 回海裡（記成出）。
 *  放不下 ⇒ 見檔頭 ⓒ（落點那一間 → 原本要去的那一欄 → 出發那一間 → 停著等 → 當作沒進來／塞回）；⛔ 只有出了船才記成出。 */
function wrsJets(sh, s, h) {
  var J = s.J; if (!J.n) return;
  s.wk.jet += J.n;
  var W = s.W, M = sh.M, gL = M4.dir(sh.inv, 0, -G, 0), grid = sh.grid, D = s.dbg;   // 格／秒²（sh.inv 已經帶 1/S，同 33_flood.js floodStep；⛔ 以前多除一次 S ⇒ 10 g）
  for (var i = 0; i < J.n; i++) {
    var o = i * 3, x0 = J.p[o], y0 = J.p[o + 1], z0 = J.p[o + 2];
    J.v[o] += gL[0] * h; J.v[o + 1] += gL[1] * h; J.v[o + 2] += gL[2] * h; J.life[i] -= h;
    var x1 = x0 + J.v[o] * h, y1 = y0 + J.v[o + 1] * h, z1 = z0 + J.v[o + 2] * h, hit = wrsWalk(s, grid, x0, y0, z0, x1, y1, z1);
    if (!hit && J.life[i] > 0) { J.p[o] = x1; J.p[o + 1] = y1; J.p[o + 2] = z1; continue; }
    var nu = J.u[i], X = hit ? s.wx : Math.floor(x1), Y = hit ? s.wy : Math.floor(y1), Z = hit ? s.wz : Math.floor(z1), r = -1, sj = J.src[i];
    if (hit !== 3) for (var dz = 0; dz <= 3 && r < 0; dz++) r = wrRoomAt(W, X, Y, Z + dz);   // 落點那一格（不是艙內的空氣 ⇒ 往上找）
    if (r < 0 && hit !== 3) r = wrsRoomNear(W, X, Y, Z, sj >= 0 ? W.colRoom[sj] : -1);   // 還沒有 ⇒ 附近照距離找
    if (!hit) D.life += nu; else if (hit === 1) D.solid += nu; else if (hit === 2) D.water += nu;
    if (s.landLog) s.landLog.push(sj, r);                                // 落點紀錄（進水報表 wdrop）
    var left = nu;
    var hL = Math.min(J.hd[i], Math.max(M[1] * (X + 0.5) + M[5] * (Y + 0.5) + M[9] * (Z + 1) + M[13], r >= 0 && s.rl[r] > -1e8 ? s.rl[r] + WRS_JRISE * h : -1e9));   // 落下來的水沒有水頭了：落進水池 ⇒ 最多裝到落點那一格的頂、或那一間的平均水面再高一點（照秒數；水池慢慢漲），也不高過出發那一邊（⛔ 照出發那一邊的水頭 ⇒ 從水丘落下的水把落點那一間也堆成水丘、一路傳、高過海面：30 Hz 900 秒多 7%，wsimo=above 量到全是粒子這一段；⛔ 只到落點那一格 ⇒ 落在乾的地板上一次只能放一層，其餘退回出發那一間，900 秒退了 5,227 m³）
    if (r >= 0) left = wrsPut(s, M, wrsColNear(s, r, X + 0.5, Y + 0.5, Z + 0.5), nu, hL);   // 落點那一間（整間滿了 ⇒ 從往上的開口溢，一樣不高過落點）
    else if (hit === 3) D.out += nu; else D.noroom += nu;
    var dj = J.dst[i];
    if (left && hit !== 3 && dj >= 0) { var l1 = wrsPut(s, M, dj, left, hL); D.todst += left - l1; left = l1; }   // 放不下、找不到 ⇒ 原本要去的那一欄
    if (left && hit !== 3 && sj >= 0) { var l2 = wrsPut(s, M, wrsColLow(s, W.colRoom[sj], sj), left, J.hd[i]); D.back += left - l2; left = l2; }   // 再不行 ⇒ 放回出發那一間的水池（水面最低、沒滿的那一欄先；照粒子帶的上游水頭限高、滿了照它往上溢；⛔ 不限高 ⇒ 裝到高過海面的欄：30 Hz 900 秒有一欄高過海面 1.6 m；⛔ 先放出發那一欄 ⇒ 破口那一欄堆到海面那麼高）
    if (left && hit !== 3 && (sj >= 0 || dj === -1) && J.wt[i] < WRS_JWAIT) {   // 還是放不下 ⇒ 停在落點等（下一小步再試；⛔ 以前直接塞成超過容量，30 Hz 900 秒塞了 47 m³，之後被管子搬開變成多出來的水、高過海面）
      var put = nu - left; s.Jtot -= put; if (J.fr[i] >= 0) s.fly[J.fr[i]] -= put;
      J.u[i] = left; J.p[o] = X + 0.5; J.p[o + 1] = Y + 0.5; J.p[o + 2] = Z + 0.5; J.v[o] = J.v[o + 1] = J.v[o + 2] = 0; J.wt[i] += h; J.life[i] = WRS_JLIFE; D.wait += left; continue;
    }
    if (left && hit !== 3 && dj === -1) { s.inTot -= left; D.undo += left; left = 0; }   // 破口噴進來的放不下 ⇒ 當作沒進來（不記成出）
    if (left && hit !== 3 && sj >= 0) { wrsTouch(s, W.colRoom[sj]); s.su[sj] += left; D.over += left; if (s.spillAt) s.spillAt.push(X, Y, Z, left); left = 0; }   // 再放不下 ⇒ 塞回出發那一欄（超過容量；過程圖 81_floodlab.js wsimPic 記落點）
    if (left) { s.outTot += left; if (hit !== 3) { D.spill += left; var SR = s.spillR || (s.spillR = {}); SR[r] = (SR[r] || 0) + left; } }   // 出了船 ⇒ 回海裡（記成出）；只剩進水報表 wdrop 的粒子（src < 0）會走到 spill
    s.Jtot -= nu; if (J.fr[i] >= 0) s.fly[J.fr[i]] -= nu;               // 落地了 ⇒ 不再算「飛行中要去那一間」
    var e = --J.n; if (i !== e) { J.p.copyWithin(o, e * 3, e * 3 + 3); J.v.copyWithin(o, e * 3, e * 3 + 3); J.u[i] = J.u[e]; J.src[i] = J.src[e]; J.life[i] = J.life[e]; J.hd[i] = J.hd[e]; J.dst[i] = J.dst[e]; J.fr[i] = J.fr[e]; J.wt[i] = J.wt[e]; } i--;
  }
}
/** 落點附近（一圈一圈到 3 格）照距離找房間；同樣近 ⇒ 出發的那一間（pref）。找不到 ⇒ −1。 */
function wrsRoomNear(W, X, Y, Z, pref) {
  for (var rd = 1; rd <= 3; rd++) {
    var best = -1, bd = Infinity;
    for (var ax = -rd; ax <= rd; ax++) for (var ay = -rd; ay <= rd; ay++) for (var az = -1; az <= 3; az++) {
      var r = wrRoomAt(W, X + ax, Y + ay, Z + az); if (r < 0) continue;
      var d = ax * ax + ay * ay + az * az; if (d < bd || (d === bd && r === pref)) { bd = d; best = r; }
    }
    if (best >= 0) return best;
  }
  return -1;
}
/** 接口拆成真的開口（一型船算一次，存 T.wrso；⛔ 不改烘焙、不進快取）。
 *  烘焙（33_wrooms.js wrMerge addOp）把同一對房、同一層的面併成一個接口、只記重心 ⇒ 兩個艙口、左右舷兩扇門的重心落在中線的梁上、牆裡、別間（審查 wf_065a867f-b0b；過程圖：溢出的落點排在中線上）。
 *  這裡把房間的每一面重新列一次、照接口分好，每個接口再照相連拆成幾塊（同一層、相鄰 ≤ 1 格；上下的另照「哪一間在下面」分開），每一塊一個開口：
 *    T 類型（0 上下、1 旁邊）、A／B（上下的：A 下 B 上；旁邊的：烘焙的 opA／opB）、Z 層、N 面數、
 *    代表的那一面（離那一塊重心最近）：ax／ay ＝ A 那一側的格、bx／by ＝ B 那一側的格（上下的兩個一樣）、X／Y ＝ 面的中心（格座標）、P ＝ 來自烘焙的第幾個接口。
 *  每一面都分到一塊 ⇒ 每個接口拆完的面數加起來 ＝ opN（wrsOpenCheck 量）。 */
function wrsOpenings(T) {
  if (T.wrso) return T.wrso;
  var W = T.wrm, NO = W.opT.length, NM = W.roomVox.length, Z = W.zTop, nxv = W.nxv, key = new Map(), i, z, xi;
  for (i = 0; i < NO; i++) key.set(((W.opT[i] * NM + W.opA[i]) * NM + W.opB[i]) * Z + W.opZ[i], i);
  var F = []; for (i = 0; i < NO; i++) F.push([]);                      // 每個接口的面：[A 那一側的 x, y, B 那一側的 x, y, 下面是不是 A]
  function face(t, ra, rb, zz, xa, ya, xb, yb) {
    if (ra === rb) return;
    var a = Math.min(ra, rb), b = ra + rb - a, o = key.get(((t * NM + a) * NM + b) * Z + zz); if (o === undefined) return;
    if (ra === a) F[o].push(xa, ya, xb, yb, 1); else F[o].push(xb, yb, xa, ya, 0);   // 上下的：ra ＝ 下面那間 ⇒ 最後一格 ＝ 下面是不是 A
  }
  for (z = 0; z < Z; z++) for (xi = 0; xi < nxv; xi++) {
    var k = z * nxv + xi, x = W.x0 + xi, i0 = W.rowS[k], i1 = W.rowS[k + 1], j, j1, r, r2;
    for (i = i0; i + 1 < i1; i++) if (W.ry1[i] + 1 === W.ry0[i + 1]) face(1, W.regRoom[W.runReg[i]], W.regRoom[W.runReg[i + 1]], z, x, W.ry1[i], x, W.ry0[i + 1]);   // 同一排、y 相鄰
    if (xi + 1 < nxv) for (i = i0, j = W.rowS[k + 1], j1 = W.rowS[k + 2]; i < i1 && j < j1;) {   // x 相鄰（下一排同一層）
      var lo = Math.max(W.ry0[i], W.ry0[j]), hi = Math.min(W.ry1[i], W.ry1[j]);
      if (lo <= hi && (r = W.regRoom[W.runReg[i]]) !== (r2 = W.regRoom[W.runReg[j]])) for (var y = lo; y <= hi; y++) face(1, r, r2, z, x, y, x + 1, y);
      if (W.ry1[i] < W.ry1[j]) i++; else j++;
    }
    if (z + 1 < Z) for (i = i0, j = W.rowS[k + nxv], j1 = W.rowS[k + nxv + 1]; i < i1 && j < j1;) {   // 上下（這一格在 z、正上方在 z ＋ 1）
      var lo2 = Math.max(W.ry0[i], W.ry0[j]), hi2 = Math.min(W.ry1[i], W.ry1[j]);
      if (lo2 <= hi2 && (r = W.regRoom[W.runReg[i]]) !== (r2 = W.regRoom[W.runReg[j]])) for (var y2 = lo2; y2 <= hi2; y2++) face(0, r, r2, z, x, y2, x, y2);
      if (W.ry1[i] < W.ry1[j]) i++; else j++;
    }
  }
  var O = { T: [], A: [], B: [], Z: [], N: [], X: [], Y: [], ax: [], ay: [], bx: [], by: [], P: [] }, par = null;
  function find(a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }
  for (i = 0; i < NO; i++) {
    var f = F[i], m = f.length / 5, at = new Map(), q, d;
    par = new Int32Array(m); for (q = 0; q < m; q++) par[q] = q;
    for (q = 0; q < m; q++) {                                            // 相鄰：面的中心（× 2 ⇒ 整數）差 ≤ 2、上下的同一個方向
      var X2 = f[5 * q] + f[5 * q + 2] + 1, Y2 = f[5 * q + 1] + f[5 * q + 3] + 1, kk = (X2 * 8192 + Y2) * 2 + (W.opT[i] ? 0 : f[5 * q + 4]);
      for (var dx = -2; dx <= 2; dx++) for (var dy = -2; dy <= 2; dy++) {
        var nb = at.get(((X2 + dx) * 8192 + Y2 + dy) * 2 + (W.opT[i] ? 0 : f[5 * q + 4]));
        if (nb !== undefined) { var ra2 = find(q), rb2 = find(nb); if (ra2 !== rb2) par[Math.max(ra2, rb2)] = Math.min(ra2, rb2); }
      }
      at.set(kk, q);
    }
    var g = new Map();                                                   // 每一塊：面數、重心
    for (q = 0; q < m; q++) { var rt = find(q), e = g.get(rt); if (!e) g.set(rt, e = [0, 0, 0, -1, Infinity]); e[0]++; e[1] += f[5 * q] + f[5 * q + 2] + 1; e[2] += f[5 * q + 1] + f[5 * q + 3] + 1; }
    for (q = 0; q < m; q++) { var e2 = g.get(find(q)), cx2 = e2[1] / e2[0], cy2 = e2[2] / e2[0], ddx = f[5 * q] + f[5 * q + 2] + 1 - cx2, ddy = f[5 * q + 1] + f[5 * q + 3] + 1 - cy2; d = ddx * ddx + ddy * ddy; if (d < e2[4]) { e2[4] = d; e2[3] = q; } }
    Array.from(g.keys()).sort(function (a, b) { return a - b; }).forEach(function (rt2) {
      var e3 = g.get(rt2), p = e3[3], lowA = W.opT[i] ? 1 : f[5 * p + 4];
      O.T.push(W.opT[i]); O.Z.push(W.opZ[i]); O.N.push(e3[0]); O.P.push(i);
      O.A.push(lowA ? W.opA[i] : W.opB[i]); O.B.push(lowA ? W.opB[i] : W.opA[i]);
      var ax = f[5 * p], ay = f[5 * p + 1], bx = f[5 * p + 2], by = f[5 * p + 3];
      if (!lowA) { var t1 = ax; ax = bx; bx = t1; t1 = ay; ay = by; by = t1; }
      O.ax.push(ax); O.ay.push(ay); O.bx.push(bx); O.by.push(by); O.X.push((ax + bx + 1) / 2); O.Y.push((ay + by + 1) / 2);
    });
  }
  ['T', 'Z', 'N', 'A', 'B', 'ax', 'ay', 'bx', 'by', 'P'].forEach(function (k2) { O[k2] = Int32Array.from(O[k2]); });
  O.X = Float32Array.from(O.X); O.Y = Float32Array.from(O.Y); O.n = O.T.length;
  return (T.wrso = O);
}
/** 上下兩段的合併欄拆開（一型船算一次，存 T.wrsg；⛔ 不改烘焙、不進快取）。
 *  烘焙的一欄（33_wrooms.js：WR_C × WR_C 格、這間房每一層有幾格空氣）中間可能有幾層 0 格（甲板）⇒ 同一欄是上下兩塊不相通的空間，一個水位表示不了：
 *  下段灌滿時水位一跳一個甲板厚、推給鄰欄、退回來又掉下去（封閉的第 1 間 0.1 秒一步 90 秒不衰減 200–240 m³/s；接到它的管子關掉 ⇒ 1.5–2.8）。
 *  這裡照「連續有空氣的那幾層」切成段，每一段當一欄：回 { W, X（跟烘焙的 T.wrm、wrxOf 同一個形狀，wrColZ／wrColUnits／wrLevelRoom 照用；房間、網格這些照烘焙的），
 *  par（段 ⇒ 烘焙的第幾欄）、col0（烘焙的第 j 欄的段 ＝ col0[j] .. col0[j + 1] − 1，由下往上）、gp（烘焙的那一欄有沒有拆）}。 */
function wrsSegs(T) {
  if (T.wrsg) return T.wrsg;
  var W0 = T.wrm, X0 = wrxOf(T), n0 = W0.colRoom.length, par = [], z0 = [], nz = [], off = [], cnt = [], col0 = new Int32Array(n0 + 1), gp = new Uint8Array(n0), j, l, q;
  for (j = 0; j < n0; j++) {
    col0[j] = par.length;
    var o = W0.colOff[j], l0 = -1, ns = 0, N = W0.colNZ[j];
    for (l = 0; l <= N; l++) {
      var c = l < N ? W0.cnt[o + l] : 0;
      if (c && l0 < 0) l0 = l;
      else if (!c && l0 >= 0) { par.push(j); z0.push(W0.colZ0[j] + l0); nz.push(l - l0); off.push(cnt.length); for (q = l0; q < l; q++) cnt.push(W0.cnt[o + q]); l0 = -1; ns++; }
    }
    if (!ns) { par.push(j); z0.push(W0.colZ0[j]); nz.push(N); off.push(cnt.length); for (q = 0; q < N; q++) cnt.push(W0.cnt[o + q]); }   // 整欄沒有空氣（不該有）⇒ 照原樣一段
    if (ns > 1) gp[j] = 1;
  }
  col0[n0] = par.length;
  var n = par.length, W = Object.create(W0), P = Int32Array.from(par), rc0 = new Int32Array(W0.roomCol0.length);
  for (q = 0; q < rc0.length; q++) rc0[q] = col0[W0.roomCol0[q]];      // 烘焙的欄照房間排好 ⇒ 段也是
  W.colRoom = new Int32Array(n); W.colCX = new Int32Array(n); W.colCY = new Int32Array(n);
  for (q = 0; q < n; q++) { W.colRoom[q] = W0.colRoom[P[q]]; W.colCX[q] = W0.colCX[P[q]]; W.colCY[q] = W0.colCY[P[q]]; }
  W.colZ0 = Int32Array.from(z0); W.colNZ = Int32Array.from(nz); off.push(cnt.length); W.colOff = Int32Array.from(off); W.cnt = Int32Array.from(cnt); W.roomCol0 = rc0;
  var pre = new Int32Array(cnt.length + n), cx = new Float32Array(n), cy = new Float32Array(n);
  for (q = 0; q < n; q++) {
    var o2 = W.colOff[q], p2 = o2 + q, a = 0; pre[p2] = 0;
    for (l = 0; l < W.colNZ[q]; l++) { a += W.cnt[o2 + l] * WR_U; pre[p2 + l + 1] = a; }
    cx[q] = X0.cx[P[q]]; cy[q] = X0.cy[P[q]];
  }
  return (T.wrsg = { W: W, X: { pre: pre, cx: cx, cy: cy }, par: P, col0: col0, gp: gp, n0: n0 });
}
/** 第 k 段離高度 z（格座標）多遠（在那一段裡 ⇒ 0）。 */
function wrsSegDz(W, k, z) { var a = W.colZ0[k], b = a + W.colNZ[k]; return z < a ? a - z : z > b ? z - b : 0; }
/** 烘焙的第 q 欄裡離高度 z 最近的那一段。 */
function wrsSegNear(G, q, z) { var best = G.col0[q], bd = Infinity; for (var k = G.col0[q]; k < G.col0[q + 1]; k++) { var d = wrsSegDz(G.W, k, z); if (d < bd) { bd = d; best = k; } } return best; }
/** 烘焙的第 q 欄裡含高度 z 的那一段（沒有 ⇒ −1）。 */
function wrsSegAt(G, q, z) { for (var k = G.col0[q]; k < G.col0[q + 1]; k++) if (z >= G.W.colZ0[k] && z < G.W.colZ0[k] + G.W.colNZ[k]) return k; return -1; }
/** 線段 (x0,y0,z0) → (x1,y1,z1) 一格一格走（Amanatides–Woo）：回 0 沒碰到、1 實心（s.wx/wy/wz ＝ 前一格）、2 進到水面以下（那一格）、3 出了船。opt.nodda ⇒ 只看終點那一格（反向對照）。 */
function wrsWalk(s, grid, x0, y0, z0, x1, y1, z1) {
  var W = s.W, X = Math.floor(x0), Y = Math.floor(y0), Z = Math.floor(z0), X1 = Math.floor(x1), Y1 = Math.floor(y1), Z1 = Math.floor(z1);
  if (s.opt.nodda) { X = X1; Y = Y1; Z = Z1; return wrsCell(s, grid, X, Y, Z, X, Y, Z); }
  var dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  var tx = dx ? ((sx > 0 ? X + 1 - x0 : x0 - X) / Math.abs(dx)) : Infinity, ty = dy ? ((sy > 0 ? Y + 1 - y0 : y0 - Y) / Math.abs(dy)) : Infinity, tz = dz ? ((sz > 0 ? Z + 1 - z0 : z0 - Z) / Math.abs(dz)) : Infinity;
  var ddx = dx ? 1 / Math.abs(dx) : Infinity, ddy = dy ? 1 / Math.abs(dy) : Infinity, ddz = dz ? 1 / Math.abs(dz) : Infinity, px = X, py = Y, pz = Z;
  for (var k = 0; k < 64 && (X !== X1 || Y !== Y1 || Z !== Z1); k++) {
    if (Math.min(tx, ty, tz) > 1) break;                                 // 下一個跨格在線段外（⛔ 以前只看「到終點那一格了沒」：同值時會走岔、一路走 64 格）
    px = X; py = Y; pz = Z;
    if (tx <= ty && tx <= tz) { X += sx; tx += ddx; } else if (ty <= tz) { Y += sy; ty += ddy; } else { Z += sz; tz += ddz; }
    s.wk.dda++; var c = wrsCell(s, grid, X, Y, Z, px, py, pz); if (c) return c;
  }
  return 0;
}
/** 粒子進到 (X,Y,Z) 那一格：實心 ⇒ 1（落點 ＝ 前一格 p）、某一欄水面以下 ⇒ 2、出了船 ⇒ 3、空氣 ⇒ 0。落點記在 s.wx／wy／wz。 */
function wrsCell(s, grid, X, Y, Z, px, py, pz) {
  var W = s.W;
  if (X < W.x0 || X >= W.x0 + W.nxv || Y < W.ylo || Y >= W.ylo + W.ny || Z < 0) { s.wx = px; s.wy = py; s.wz = pz; return 3; }
  if (Z < W.zTop && grid.get(X, Y, Z)) { s.wx = px; s.wy = py; s.wz = pz; return 1; }
  var r = wrRoomAt(W, X, Y, Z); if (r < 0) return 0;
  var C = W.c, q = s.idx.get(r * s.NCK + Math.floor((X - W.x0) / C) * W.NCY + Math.floor((Y - W.ylo) / C)), j = q === undefined ? -1 : wrsSegAt(s.G, q, Z + 0.5);   // 那一欄裡含這一格的那一段
  if (j >= 0 && s.su[j] > 0 && Z + 0.5 < s.zs[j]) {
    if (s.su[j] >= s.cap[j] && !s.rn[r]) { s.wx = px; s.wy = py; s.wz = pz; return 1; }   // 整間灌滿（灌滿的空腔）⇒ 打在它頂上的水面 ⇒ 落點 ＝ 前一格（上面那一間）；只有那一欄滿 ⇒ 落進這間（wrsPut 放到沒滿的欄）
    s.wx = X; s.wy = Y; s.wz = Z; return 2;
  }
  return 0;
}
