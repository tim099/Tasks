// ───────────────────────── 艦長：開船（第一期） ─────────────────────────
// Tim 2026-10-17：「目前感覺敵人的行為非常固定 是否能增加一些戰術性 且自動駕駛情況下 應該套用艦長AI來操控(目前只會轉舵 實際上應該還要操帆&控制前進速度 拋錨等)」
//   「當兩舷火力差太大(一邊被打爛) 應該要嘗試轉到優勢火力測 同時嘗試迴避敵人」「目前的可以當做基礎款保留(只要加上控制船速就好)」
//   「然後還有迴避碰撞 避免遮擋友艦砲線等」「艦長指揮時可以直接改為設定期望速度 在由算法去判斷要如何調整帆&俥鐘」「有動力的船可以倒船」。
// 量到的（改之前，兩艘憲法號電腦對電腦 180 秒）：從第 30 秒起兩艘都把對方擺在右舷正橫、隔 151–153 m 一直繞圈（約 100 秒一圈），全程滿帆、沒換過舷。
//
// 分兩層：
//   ① 艦長（helmThink／helmSteer）：要哪一舷對敵、航向、期望航速 sh.wantV（m/s；Infinity ＝ 能多快就多快、'cruise' ＝ 戰鬥帆＋引擎全速、負的 ＝ 倒退）。
//   ② 航速調節（helmGovern）：照期望航速挑帆裝與俥鐘；只靠帆的船再用「放掉一點風」（sh.throttle）細調。
// 電腦的船、我艦的自動駕駛（SAIL 'auto'）共用；我艦在自動駕駛時按了 W／S（帆）或 E／T、點俥鐘（俥鐘）⇒ 那一樣交回手動（sh.sailHand／teleHand），
//   再切一次自動駕駛才收回來（71_input.js setSailMode）。
// 優先序（31_sailing.js sail）：讓友船、讓敵艦（不撞）＞ 讓開友艦的砲線 ＞ 戰列跟隨 ＞ 艦長。
// ⛔ 不抽 rnd()（艦長的判斷照局勢算）⇒ 其他亂數照舊；但船走的路不一樣了 ⇒ 同一個種子打出另一局（三組對拍的基準換新）。
// 下一期：性格與能力（難度）、搶上風、縱射、追擊、撤退；再下一期：頂風失速、拋錨戰術（拋單側錨甩尾給高級艦長）、指揮官的包夾。
var HELMS = {
  basic: { name: '基礎款', tip: '把敵艦擺在一舷正橫、守開局距離；一舷被打爛就換另一舷；火力差太多就拉開', range: 1.6, swap: 0.7636, evade: 0.7296, evadeOut: 0.8803, think: 1 }   // 自動調參調出來的（TASK-0687 第一次整晚 run，2026-10-18；調之前 1／0.5／0.5／0.65／3）
};
var HELM_BACK_V = 2, HELM_EVADE_OUT = 0.9, HELM_FAR = 1.969, HELM_EVADE_R = 1.0602, HELM_VMIN = 0.8, HELM_BRG_K = 0.5, HELM_BACK_D = 0.45;   // 遠於 1.969 R ⇒ 全速接近；被壓制 ⇒ 距離 × 1.06；最慢 0.8 m/s（舵要有水流）；正橫差 90° ⇒ 期望航速 ± 0.5 m/s；近於 0.45 R 而且敵艦在船頭 ⇒ 有動力的倒退
                                                                         //   FAR／EVADE_R／BRG_K 是自動調參調出來的（TASK-0687，2026-10-18；調之前 1.6／1.4／2）
var HELM_SAIL_T = 8, HELM_GOV_T = 1, HELM_LEAD_T = 40, HELM_TURN_E = 0.6, HELM_TURN_V = 2, HELM_TACK_E = 0.35, HELM_LEAD_MIN = 0.5;   // HELM_LEAD_T：戰列的排頭照幾秒後的距離轉（helmLead）；航向差 > HELM_TURN_E rad ⇒ 排頭全速、跟隨至少 HELM_TURN_V m/s（轉得過來）                                     // 帆裝往下收要「該收」連續 8 秒（往上加馬上）；航速調節每 1 秒想一次
/** 一門砲的火力：砲重 × 有人操作的比例 ÷ 裝填倍率（10_ship.js GUNS：mass 噸、reload）。 */
function helmGunW(g) { var G = GUNS[g.type] || {}; return (+G.mass || 1) * gunRate(g) / (+G.reload || 1); }
/** 一舷的火力（迴旋砲、砲塔 g.mt 兩舷都算）。 */
function helmPower(sh, side) { var p = 0; sh.guns.forEach(function (g) { if (g.alive && (g.mt || g.side === side)) p += helmGunW(g); }); return p; }
function helmOther(side) { return side === 'S' ? 'P' : 'S'; }
// ───────── 武器的射界與射程（Tim 2026-10-18：「需要判斷我方武器射程去指揮船隻」「不是特別處理短射程武器 而是確保船隻保持在能打中敵人的射程內讓武器發揮(通用邏輯)」） ─────────
// 艦長挑「哪個方向對敵」：左舷 P／右舷 S（照舊 helmPower 比兩舷）、船頭 B、船尾 A —— 船頭（船尾）對得到的火力比正橫兩舷對得到的都大（嚴格大於）才拿船頭（船尾）對敵。
//   對得到 ＝ 那個方向落在砲的射界裡（helmCovers：固定砲照砲軸 ± 砲門射界 0.45 rad，同 21_gunnery.js bears；迴旋砲、砲塔一律算）。
// 交戰距離：照舊（開局距離 × range）、但不超過「那個方向的武器打得到的距離」（helmAspectR：照火力排、一半火力打得到的那個射程）。
//   ⇒ 長砲的射程（幾百公尺以上）比交戰距離遠 ⇒ 跟以前一位元都不差；希臘火這種短射程武器的船會靠到打得到為止。
// ⛔ 以前（TASK-0693 第一版）只在 aiRange 裡替砲種表 close 的砲另算：船照舊拿正橫對敵、距離又是射程 × 1.6 ⇒ 船頭的 siphon 永遠對不到。
var HELM_ASP = { S: Math.PI / 2, P: -Math.PI / 2, B: 0, A: Math.PI }, HELM_ASP_NAME = { S: '右舷', P: '左舷', B: '船頭', A: '船尾' }, HELM_EFF_R = 0.8;   // 方向在船的格座標裡的角度（+y ＝ 右舷）；有效射程 ＝ 最大射程的八成
/** 這門砲對不對得到船的 a 方向（rad，格座標：0 船頭、+π/2 右舷）。 */
function helmCovers(g, a) { if (g.mt) return true; var e = a - Math.atan2(g.ax[1], g.ax[0]); return Math.abs(Math.atan2(Math.sin(e), Math.cos(e))) < (g.cone || 0.45); }
/** 對得到 asp 方向的火力（還在的砲）。 */
function helmAspPower(sh, asp, nom) { var p = 0, a = HELM_ASP[asp]; sh.guns.forEach(function (g) { if (g.alive && helmCovers(g, a)) p += nom ? (g.wet ? 0 : (+(GUNS[g.type] || {}).mass || 1) / (+(GUNS[g.type] || {}).reload || 1)) : helmGunW(g); }); return p; }   // nom：照編制（不看人到了沒）
/** 船頭或船尾比正橫火力大 ⇒ 'B'／'A'，不然 'side'（指揮官排戰列用：53_commander.js cmdLine）。 */
function helmAspect(sh) {
  if (helmRamDef(sh.T)) return 'B';                                      // 裝了撞角（關聯 meta kind=ram）⇒ 撞角是主武器、船頭對敵（helmSteerRam）
  // 照編制的火力（還在、沒泡水的砲，⛔ 不看砲班到了沒）：武器朝哪裡是船的設計 —— ⛔ 照 helmGunW（× 砲班）⇒ 開局砲班還沒站好全是 0 ⇒ 'side'，
  //   指揮官第一次下令就把持火號排進戰列當排頭（量過 3 對 3 seed 11：t 0 排頭、t 36 船頭砲班被打散又排成跟隨）。
  var pb = helmAspPower(sh, 'B', true), pa = helmAspPower(sh, 'A', true), ab = Math.max(helmAspPower(sh, 'P', true), helmAspPower(sh, 'S', true)), pe = Math.max(pb, pa);
  return pe > 0 && pe > ab ? (pb >= pa ? 'B' : 'A') : 'side';
}
/** asp 方向的武器打得到多遠（m）：對得到的砲照有效射程由遠到近排、累計到一半火力的那一門的射程；一門都沒有 ⇒ Infinity（不限）。 */
function helmAspectR(sh, asp) {
  var a = HELM_ASP[asp], L = [], tot = 0;
  sh.guns.forEach(function (g) { if (g.alive && helmCovers(g, a) && GUNS[g.type]) { var w = helmGunW(g); L.push([HELM_EFF_R * gunMaxR(GUNS[g.type]), w]); tot += w; } });
  if (!L.length || !(tot > 0)) return Infinity;
  L.sort(function (x, y) { return y[0] - x[0]; });
  for (var i = 0, c = 0; i < L.length; i++) { c += L[i][1]; if (c >= 0.5 * tot) return L[i][0]; }
  return L[L.length - 1][0];
}
/** 艦長的交戰距離（m）：開局距離 × range（被壓制 ⇒ 再 × evadeR，拉開的時候不照武器）；不超過要對敵的那個方向的武器打得到的距離。noEv：不算拉開（砲長的命令用）。 */
function helmRange(sh, st, noEv) {
  var H = HELMS[sh.helm] || HELMS.basic, base = aiRange(sh) * tuneH(sh, H, 'range');
  if (st && st.evade && !noEv) return base * tuneV(sh.team, 'evadeR');
  return Math.min(base, helmAspectR(sh, st && st.present || sh.side || 'S'));
}
/** 大漩渦（TASK-0683；08_sea.js VX）：快沉了才逃離漩渦（Tim 2026-10-17：「可以讓電腦要沉沒時避開就好(因為我想模擬電影場景 在漩渦內戰鬥)」「應該說快沉沒時 觸發逃離漩渦邏輯」）——
 *  吃水（sh.sink：進水＋被眼拖下去的，32_hull.js；4.2 m 開始沉）到 VX_ESC（2.5 m）⇒ 航向順著水流往外斜 60°、帆照全速，開到 1.1 × rv（水流最快那一圈外）就交回艦長；
 *  吃水退回 VX_ESC_OK（1 m）才不再逃。其他時候 ⇒ null（照艦長的，在漩渦裡照常打，眼裡也照打）。
 *  ⛔ 以前照離中心多近就逃（0.65 × rv）：半徑 400 ⇒ 260 m 內一直往外，漏斗裡打不起來。優先序（31_sailing.js sail）：讓友船、讓敵艦（快撞上才出手）＞ 它 ＞ 讓開友艦的砲線。
 *  再加一條邊緣（Tim 2026-10-22：「AI船會直接開到被吸進去 希望至少保持在被吸進去的邊緣(靠近極限時就要觸發逃離)」）：
 *  照現在對地的速度往前推 VX_EDGE_LOOK 秒，會進到 VX.aiR（天氣設定頁「電腦避開半徑」）以內 ⇒ 同一個逃離航向往外開，開到 VX_EDGE_BACK 倍才交回艦長；
 *  aiR ＝ 0 ⇒ 不看邊緣（只有快沉了才逃，跟以前一樣）。下坡衝進來的船（9 m/s）推 8 秒 ＝ 72 m ⇒ 在邊緣外就開始轉。 */
var VX_ESC = 2.5, VX_ESC_OK = 1, VX_ESC_OUT = 1.1, VX_EDGE_LOOK = 8, VX_EDGE_BACK = 1.3;
function vxAvoid(sh) {
  if (!VX || sh.sinkingFinal) return null;
  if (sh.sink >= VX_ESC && !sh.vxEsc) { sh.vxEsc = true; note(sh, '快撐不住了 —— 往漩渦外逃'); } else if (sh.vxEsc && sh.sink <= VX_ESC_OK) sh.vxEsc = false;
  var r = Math.hypot(sh.px, sh.pz); if (r < 1e-3) return null;
  if (VX.aiR > 0) {
    var V = sh.vel || [0, 0, 0], rp = r + Math.min(0, (V[0] * sh.px + V[2] * sh.pz) / r) * VX_EDGE_LOOK, E = Math.max(VX.aiR, vxShipEdge(sh));   // 往中心的那一份速度推 VX_EDGE_LOOK 秒；邊緣取設定值與這艘船自己的較大的
    sh.vxEdgeR = E;
    if (!sh.vxEdge && rp < E) { sh.vxEdge = true; if (!(SIMT - (sh.vxEdgeT || -99) < 30)) { sh.vxEdgeT = SIMT; note(sh, '離漩渦的眼太近 —— 往外開'); } }   // 廣播 30 秒最多一次（在邊緣來回不洗版）
    else if (sh.vxEdge && r >= VX_EDGE_BACK * E) sh.vxEdge = false;
  } else sh.vxEdge = false;
  if (!sh.vxEdge && (!sh.vxEsc || r >= VX_ESC_OUT * VX.rv)) return null;
  sh.wantV = Infinity;
  return vxEscYaw(sh, r);
}
/** 這艘船自己的邊緣（m）：往內的水流（吸力漂移 ＋ 往中心吸的那一份，vxInV）小於這艘船全力往外大約推得動的 VX_CAP_K 倍（31_sailing.js sh.vxCap）的最近半徑。
 *  ⛔ 只用設定的半徑：帆被打掉一半的餘燼號（往外 2.7–3.5 m/s）在 93 m 開始逃，44 秒被拉到 43 m 吸進眼（2 對 2 seed 3）；滿帆的照樣是設定的 80 m。 */
var VX_CAP_UP = Math.SQRT1_2, VX_CAP_K = 0.8;
function vxShipEdge(sh) {
  var c = sh.vxCap; if (!(c >= 0)) return 0;
  for (var r = VX.re; r < VX.rv; r += 5) if (vxInV(r) <= VX_CAP_K * c) return r;
  return VX.rv;
}
/** 往外逃的航向（TASK-0683 2026-10-22）：從「正往外」偏 VX_ESC_TRY 度（正 ＝ 往順著水流那一側），挑第一個不頂風的（離正頂風 ≥ 頂風角 ＋ VX_ESC_WIND）；
 *  有動力（槳、蒸汽）的船不看風 ⇒ 第一個（順水流往外斜 60°，跟以前一樣）。都頂風 ⇒ 離正頂風最遠的那個。
 *  ⛔ 以前固定順水流往外斜 60°：剛好頂風時帆推不動，上坡的重力把船倒著拖進眼（量過：憲法號 −10 m/s 倒退，51 m → 中心 5 秒）。 */
var VX_ESC_TRY = [30, 0, 60, -30, 80, -60, -80], VX_ESC_WIND = 15 / 57.2958;
function vxEscYaw(sh, r) {
  var ux = sh.px / r, uz = sh.pz / r, W = norm(WIND), a = NOGO_DEG / 57.2958 + VX_ESC_WIND, pow = sh.cfg.base > 0 && sh.drive && sh.drive.cap > 0.05, best = null, bo = -1;
  for (var i = 0; i < VX_ESC_TRY.length; i++) {
    var b = VX_ESC_TRY[i] / 57.2958, hx = ux * Math.cos(b) + uz * Math.sin(b), hz = uz * Math.cos(b) - ux * Math.sin(b);   // 正往外 (ux, uz) 往切線 (uz, −ux)（順水流）轉 b
    var y = Math.atan2(-hz, hx), off = Math.acos(clamp(-(hx * W[0] + hz * W[2]), -1, 1));   // fwd(yaw) ＝ (cos yaw, −sin yaw)；off：離正頂風幾 rad
    if (pow || off >= a) return y;
    if (off > bo) { bo = off; best = y; }
  }
  return best;
}
/** 接管航行（TASK-0683 2026-10-22；Tim：「逃離機制是否可以通用化(接管航行的特殊機制) 不一定只用在漩渦 航行變成有多種模式的狀態機(預設 逃離漩渦 其他特殊情況) 可以有優先級」）：
 *  艦長／指揮官定好航向之後（31_sailing.js sail），照 HELM_TAKES 的 pri 由小到大問，第一個回航向的模式接管這一步 ⇒ sh.helmMode ＝ 它的 k、sh.helmModeAt ＝ 從哪一刻開始；
 *  都不接 ⇒ null（預設：照艦長的）。每個模式自己管進出的門檻（漩渦 sh.vxEdge／vxEsc、讓砲線 sh.clearing 都有滯後），表只管誰先。
 *  模式：k、name（詳細資訊「自動操舵・…」）、pri、fn(sh, c) ⇒ 航向（rad）或 null；c ＝ { hc：指揮官的航向（排頭、跟隨、搶上風）, od：命令 }。
 *  新的特殊情況 ＝ 這張表加一列（⛔ 不要再往 31_sailing.js 那一行串 if）。順序：淺水 ＞ 逃離漩渦 ＞ 讓友船 ＞ 讓敵艦 ＞ 讓砲線（以前漩渦排在讓船後面，見 vortex 那一列）；沒有漩渦時漩渦那一列回 null ⇒ 晴天、暴風雨逐位元組不變。
 *  bound(sh, yaw) ⇒ 限制（選填）：別的模式接管時，它還在生效就把航向夾回可以接受的範圍（回原值 ＝ 不管）。接管的是誰照優先級，限制每一個都套。
 *  例：逃離漩渦生效時讓友船、讓敵艦照樣讓，但不准往中心讓（vxBound）—— ⛔ 沒有這一格：讓船的航向正好朝中心，炎羽號從 146 m 被讓進 45 m（2 對 2 seed 3）。 */
var HELM_TAKES = [
  { k: 'bed', name: '避開淺水', pri: 10, fn: function (sh) { return bedAvoid(sh); } },
  { k: 'friend', name: '讓友船', pri: 20, fn: function (sh, c) { return friendAvoid(sh, c.hc && c.od.mode === 'lead' ? helmLeadAvoid(sh) : undefined); } },
  { k: 'foe', name: '讓敵艦', pri: 30, fn: function (sh) { return foeAvoid(sh); } },
  // 逃離漩渦排在讓船前面（2026-10-22）：以前排後面 ⇒ 讓友船、讓敵艦的航向剛好朝中心，炎羽號被讓進 45 m；只靠 bound 壓成切線也不夠（47 m 處切線抵不過往內 3 m/s）。現在只在邊緣接管 ⇒ 不會整場不讓船
  { k: 'vortex', name: '逃離漩渦', pri: 15, fn: function (sh) { return vxAvoid(sh); }, bound: function (sh, y) { return vxBound(sh, y); } },
  { k: 'clear', name: '讓開砲線', pri: 50, fn: function (sh, c) { return c.hc ? null : lineClear(sh); } }   // 照指揮官的航向走的船不讓砲線（以前那一串的 !hc）
].sort(function (a, b) { return a.pri - b.pri; });
var HELM_TAKE_K = {}; HELM_TAKES.forEach(function (T) { HELM_TAKE_K[T.k] = T; });
function helmTakeover(sh, c) {
  var y = null, k = null, i;
  for (i = 0; i < HELM_TAKES.length && y === null; i++) { y = HELM_TAKES[i].fn(sh, c); if (y !== null) k = HELM_TAKES[i].k; }
  if (y !== null) for (i = 0; i < HELM_TAKES.length; i++) if (HELM_TAKES[i].bound && HELM_TAKES[i].k !== k) y = HELM_TAKES[i].bound(sh, y);
  if (c.hc) sh.clearing = null;                                         // 以前那一串：照指揮官的航向 ⇒ 不記著在讓哪一艘的砲線
  if (k !== (sh.helmMode || null)) { sh.helmMode = k; sh.helmModeAt = SIMT; }
  return y;
}
/** 逃離漩渦的限制（HELM_TAKES 的 bound）：正在逃（sh.vxEdge／vxEsc）而航向有往中心的那一份 ⇒ 換成同一側的切線（往外的那一份 0）；沒有漩渦、沒在逃 ⇒ 原值。 */
function vxBound(sh, y) {
  if (!VX || !(sh.vxEdge || sh.vxEsc)) return y;
  var r = Math.hypot(sh.px, sh.pz); if (r < 1e-3) return y;
  var ux = sh.px / r, uz = sh.pz / r, fx = Math.cos(y), fz = -Math.sin(y);   // fwd(yaw) ＝ (cos yaw, −sin yaw)
  if (fx * ux + fz * uz >= 0) return y;
  var t = fx * uz - fz * ux >= 0 ? 1 : -1;                              // 跟原航向同一側的切線：(uz, −ux) 或反過來
  return Math.atan2(t * ux, t * uz);                                     // fwd ＝ t·(uz, −ux) ⇒ yaw ＝ atan2(t·ux, t·uz)
}
/** 避開淺水與陸地（TASK-0721；有海圖才有，沒有 ⇒ null）：往前看 BEDAV_LOOK 那幾個距離，船底（32_ground.js sh.keelY）下面不到 BEDAV_CLR 公尺 ⇒
 *  從小到大試左右 30°、60°…180°，第一個整條看出去都夠深的方向；都不夠 ⇒ 看得最遠的那個。sh.bedAv ＝ 讀數（最後一次讓的時刻、前面多遠就淺了）。 */
var BEDAV_LOOK = [40, 80, 130, 190], BEDAV_CLR = 1.5, BEDAV_TRY = [30, -30, 60, -60, 90, -90, 135, -135, 180];
function bedAvoid(sh) {
  if (!BED || sh.sinkingFinal) return null;
  var lv = function (x, z) { return VX ? vxH(x, z) : 0; };             // 那一點的水面（大漩渦：漏斗；⛔ 照 0 ⇒ 漏斗裡的船吃水算成 200 m，到處都「淺」）
  var need = (sh.keelY !== undefined ? lv(sh.px, sh.pz) - sh.keelY : 6) + BEDAV_CLR;
  function clear(yaw) { var F = fwd(yaw); for (var i = 0; i < BEDAV_LOOK.length; i++) { var d = BEDAV_LOOK[i], x = sh.px + F[0] * d, z = sh.pz + F[2] * d; if (bedHgt(x, z) - lv(x, z) > -need) return d; } return Infinity; }
  var c0 = clear(sh.yaw); if (c0 === Infinity) return null;
  var best = sh.yaw + Math.PI, bd = -1;
  for (var i = 0; i < BEDAV_TRY.length && bd !== Infinity; i++) { var y = sh.yaw + BEDAV_TRY[i] * Math.PI / 180, c = clear(y); if (c > bd) { bd = c; best = y; } }
  sh.bedAv = { t: SIMT, d: c0 };
  return best;
}
/** 艦長想一想（每 think 秒）：要哪一舷對敵、是不是被壓制。回傳 sh.hs ＝ { present, evade, t }。 */
function helmThink(sh, foe) {
  var H = HELMS[sh.helm] || HELMS.basic, st = sh.hs || (sh.hs = { present: null, evade: false, t: -1e9 });
  if (st.present && SIMT - st.t < tuneH(sh, H, 'think')) return st;
  st.t = SIMT;
  // 哪一舷對敵：敵艦現在在哪一舷（sh.side，31_sailing.js chooseSide）就用那一舷；那一舷的火力不到另一舷的 swap ⇒ 轉另一舷過去
  //   （換過去之後敵艦就在強的那一舷 ⇒ 不會來回換；⛔ 以前要那一舷一門都開不了才換）。
  var cur = sh.side || 'S', oth = helmOther(cur), pc = helmPower(sh, cur), po = helmPower(sh, oth);
  var present = pc < tuneH(sh, H, 'swap') * po ? oth : cur;
  var end = helmAspect(sh);                                              // 船頭／船尾對得到的火力比正橫兩舷都大 ⇒ 拿那一頭對敵（持火號的 siphon、槳帆船的艏砲）
  if (end === 'side' && present !== cur && st.present !== present) helmSay(sh, 'side', sideName(cur) + '火力只剩另一舷的 ' + Math.round(pc / Math.max(1e-6, po) * 100) + '% —— 轉' + sideName(present) + '對敵', true);   // ⛔ 船頭對敵的船也比兩舷 ⇒ 朝前的 siphon 照砲軸算成右舷砲、左舷 0% ⇒ 每想一次就報一次「轉右舷對敵」（Tim 2026-10-18 截圖）
  if (end !== 'side' && helmRamDef(sh.T)) { if (st.present !== end) helmSay(sh, 'side', '裝了撞角 —— 撞角對敵（對準它衝、撞完拉開再衝；砲照常開）', true); present = end; }
  else if (end !== 'side') { if (st.present !== end) helmSay(sh, 'side', HELM_ASP_NAME[end] + '對得到的火力比兩舷大（' + helmAspPower(sh, end).toFixed(1) + ' 對 ' + Math.max(helmAspPower(sh, 'P'), helmAspPower(sh, 'S')).toFixed(1) + '）—— ' + HELM_ASP_NAME[end] + '對敵、守在 ' + helmAspectR(sh, end).toFixed(0) + ' m 內', true); present = end; }
  st.present = present;
  // 被壓制：自己最強的那一舷（或那一頭）< evade × 敵艦最強的 ⇒ 拉開距離（強的那一舷照樣對著它）；回到 evadeOut 以上才回原本的距離
  var mine = Math.max(pc, po, helmAspPower(sh, 'B'), helmAspPower(sh, 'A')), theirs = Math.max(helmPower(foe, 'P'), helmPower(foe, 'S'), helmAspPower(foe, 'B'), helmAspPower(foe, 'A')), r = theirs > 0 ? mine / theirs : 9;
  var ev = st.evade ? r < tuneH(sh, H, 'evadeOut') : r < tuneH(sh, H, 'evade');
  // 拉開之後武器還打得到才拉開（拉開是換個距離繼續打；武器打不到那麼遠 ⇒ 拉開 ＝ 不打 ⇒ 照常靠過去打）。長砲的有效射程（700 m 以上）遠過拉開的距離 ⇒ 跟以前一樣。
  //   ⛔ 不管 ⇒ 持火號（siphon 25 m）對憲法號火力只有一成 ⇒ 一開戰就拉開到 370 m，120 秒一發都沒開（量過 seed 3）。
  var reach = helmRamDef(sh.T) ? 0 : helmAspectR(sh, present), evR = aiRange(sh) * tuneH(sh, H, 'range') * tuneV(sh.team, 'evadeR'), stay = ev && reach < evR;
  if (stay !== !!st.stay) { st.stay = stay; if (stay) helmSay(sh, 'evade', '火力只剩敵艦的 ' + Math.round(r * 100) + '%，但拉開到 ' + evR.toFixed(0) + ' m ' + HELM_ASP_NAME[present] + '的武器打不到（' + reach.toFixed(0) + ' m）—— 不拉開、照常靠過去', true); }
  if (stay) ev = false;
  if (ev !== st.evade && !stay) helmSay(sh, 'evade', ev ? '火力只剩敵艦的 ' + Math.round(r * 100) + '%（我 ' + mine.toFixed(0) + ' 對 ' + theirs.toFixed(0) + '）—— 拉開到 ' + tuneV(sh.team, 'evadeR') + ' 倍交戰距離' : '火力回到敵艦的 ' + Math.round(r * 100) + '% —— 回到交戰距離', true);
  st.evade = ev;
  return st;
}
/** 交戰操舵：回傳 { yaw, v }（v ＝ 期望航速 m/s）。航向照舊（敵艦在要的那一舷正橫 ＋ 距離修正，31_sailing.js 原本那一條）；
 *  期望航速（基礎款加上的）：遠了、正在換舷、被壓制又太近 ⇒ 能多快就多快；交戰中 ⇒ 跟敵艦一樣快，敵艦在正橫前面 ⇒ 快一點、落到後面 ⇒ 慢一點（守在正橫，⛔ 以前一直全速 ⇒ 兩艘繞圈）；
 *  太近（< 0.45 R）而且敵艦在船頭前方 60° 內 ⇒ 有動力的倒退（沒有動力的照最慢）。 */
function helmSteer(sh, foe) {
  var H = HELMS[sh.helm] || HELMS.basic, st = helmThink(sh, foe), pres = st.present === 'P' || st.present === 'S' ? st.present : sh.side || 'S', sg = pres === 'P' ? 1 : -1;   // sg：敵艦要在畫面左邊（左舷 P）⇒ +1；pres：船頭／船尾對敵的船被壓制、在拉開時 ⇒ 照敵艦現在在哪一舷
  var dx = foe.px - sh.px, dz = foe.pz - sh.pz, d = Math.hypot(dx, dz) || 1, R = helmRange(sh, st);   // 可調參數（55_tune.js；沒覆寫 ＝ 原本的常數）；不超過武器打得到的距離
  if (!st.evade && (st.present === 'B' || st.present === 'A')) return helmSteerEnd(sh, foe, st.present, d, dx, dz);
  var yaw = (sg > 0 ? Math.atan2(-dx / d, -dz / d) : Math.atan2(dx / d, dz / d)) + sg * clamp((d - R) / R * tuneV(sh.team, 'distK'), st.evade ? -HELM_EVADE_OUT : -tuneV(sh.team, 'pullOut'), tuneV(sh.team, 'cutIn'));   // 遠了往敵艦切（最多 cutIn 1.5 rad）、近了往外拉（最多 pullOut 0.39；被壓制 ⇒ 0.9，⛔ 0.4 ⇒ 30 秒只拉開 18 m）；倍率 distK 0.5（自動調參，調之前 1.2／0.4／1.5）
  var F = fwd(sh.yaw), b = Math.acos(clamp((F[0] * dx + F[2] * dz) / d, -1, 1)) * 57.2958;   // 敵艦離船頭幾度（90 ＝ 正橫）
  var cruise = sh.vCruise > 0 ? sh.vCruise : Infinity, same = Math.cos(foe.yaw - sh.yaw) > 0.5, v;   // cruise：戰鬥帆（有動力 ⇒ 再加引擎）全速（helmGovern 量的）；same：跟敵艦大致同向（60° 內）
  var m;                                                                 // m：現在的打法（決策紀錄用）
  if (d > tuneV(sh.team, 'far') * R) { v = Infinity; m = 'approach'; }
  else if (pres !== sh.side) { v = Infinity; m = 'swap'; }
  else if (st.evade && d < R) { v = Infinity; m = 'evade'; }
  else if (d < HELM_BACK_D * R && b < 60 && sh.cfg.base > 0 && sh.drive && sh.drive.cap > 0.05) { v = -HELM_BACK_V; m = 'back'; }   // 只有帆的船倒不了 ⇒ 照下面（⛔ 也給負的 ⇒ 收帆、放掉風、0 節停在敵艦船頭前：量過 3 對 3 的餘燼號）
  else if (same) { v = Math.max(HELM_VMIN, 0.6 * cruise, Math.max(0, foe.spd) + (90 - b) / 90 * tuneV(sh.team, 'brgK')); m = 'abeam'; }   // 並排同向 ⇒ 守在正橫：跟敵艦一樣快、它在前面 ⇒ 快一點、落後 ⇒ 慢一點（最慢巡航的六成）
  else { v = 'cruise'; m = 'cruise'; }                                                     // 反向、繞圈 ⇒ 巡航：戰鬥帆＋引擎全速（⛔ 也照正橫調 ⇒ 兩艘都看到對方稍微落後、一起慢下來：量過 180 秒掉到 1.9 節、帆收到「收帆」；
                                                                         //   ⛔ 給巡航的航速數字 ⇒ 那是上一次照當時航向量的，轉了向就對不上 ⇒ 帆裝在戰鬥帆與滿帆之間來回換）
  if (m !== sh.hMode && SIMT - (sh.hModeT || -1e9) >= HELM_MODE_T) {   // 打法換了（至少隔 HELM_MODE_T 秒才記下一筆 ⇒ 邊界上抖不洗版）
    sh.hMode = m; sh.hModeT = SIMT;
    helmSay(sh, 'mode', HELM_MODE[m] + '：' + (m === 'approach' ? '距離 ' + d.toFixed(0) + ' m，遠於 ' + tuneV(sh.team, 'far') + ' 倍交戰距離 ' + R.toFixed(0) + ' m —— 全速接近'
      : m === 'swap' ? '敵艦在' + sideName(sh.side) + '、要用' + sideName(pres) + ' —— 全速轉過去'
      : m === 'evade' ? '被壓制、距離 ' + d.toFixed(0) + ' m 近於 ' + R.toFixed(0) + ' m —— 全速拉開'
      : m === 'back' ? '距離 ' + d.toFixed(0) + ' m、敵艦在船頭 ' + b.toFixed(0) + '° —— 倒退 ' + HELM_BACK_V + ' m/s'
      : m === 'abeam' ? '跟敵艦同向並行、敵艦離船頭 ' + b.toFixed(0) + '° —— 調航速守在正橫'
      : '跟敵艦反向或繞圈 —— 戰鬥帆巡航'), false);
  }
  return { yaw: yaw, v: v };
}
/** 船頭（船尾）對敵（helmThink 挑了 'B'／'A'）：航向對準敵艦（船尾 ⇒ 背對）；遠於兩倍射程時照它的航速往前估（最多 HELM_END_LEAD 秒）。
 *  距離照「那一頭的砲口到敵艦船身」量（helmGap），跟那一頭的武器射程（helmAspectR）比 —— ⛔ 照船中心對船中心 ⇒ 持火號的 siphon 在船頭、離中心 15 m，
 *    兩艘 31 m 長的船中心隔 25 m 時船身已經疊在一起（Tim 2026-10-18：兩艘持火號對戰完全不開火）。
 *  航速照「接近率」調：要的接近率 ＝ (距離 − HELM_END_HOLD × 射程) ÷ HELM_END_TAU 秒（最慢 −1.5 m/s），自己的航速 ＝ 它 ＋ 敵艦沿連線離開的速度
 *    ⇒ 對衝時兩艘都會收（⛔ 「跟敵艦一樣快」只對追擊成立：對衝 ⇒ 兩艘都照對方的航速衝，接近率翻倍）；要倒退而且有動力 ⇒ 倒退（最多 HELM_BACK_V）、沒有 ⇒ 最慢。
 *  遠於 HELM_END_FAR 倍射程 ⇒ 全速接近。船尾對敵反過來（太近 ⇒ 拉開）。撞不撞照舊交給讓敵艦（foeAvoid；對自己的目標只往前看 HELM_END_AVT 秒，52_fleet.js friendAvoid）。 */
// 煞得住（Tim 2026-10-18：「目前AI不會用船頭的希臘火」——量過 seed 3：持火號 18 節衝進去、53 m 才喊倒退，12 秒撞上憲法號，碰撞死 32 人、siphon 與船頭弩砲、投石機全被撞飛，之後 107 秒沒有武器可開）：
//   要的接近率再夾在「照煞車距離煞得住」的那一個 —— √(2 × HELM_END_DEC × (距離 − 守住的距離))；全速（far）也要煞得住：現在的接近速度煞到 0 要的距離 ×1.5 還在 守住的距離 之外才全速。
//   HELM_END_DEC：煞車減速度（m/s²；量過持火號收俥減速約 0.3）。帆照急煞收（helmGovern：船頭／船尾接敵、比要的快 HELM_SAIL_URG 以上 ⇒ 帆馬上收，不等 HELM_SAIL_T）。
var HELM_END_LEAD = 10, HELM_END_HOLD = 0.75, HELM_END_TAU = 10, HELM_END_AVT = 3, HELM_END_FAR = 6, HELM_END_TURN = Math.PI / 3, HELM_END_DEC = 0.3, HELM_SAIL_URG = 1.5;
/** 這艘現在是不是船頭／船尾接敵（helmSteerEnd 剛跑過）。 */
function helmEndOn(sh) { return sh.hEndT !== undefined && SIMT - sh.hEndT < 0.5; }
/** asp 那一頭對得到的砲（還在的）砲口的平均點 ⇒ 敵艦船身最近的距離（m）：到敵艦龍骨線（keelLine）的水平距離 − 那一段的半寬；沒有砲 ⇒ 從船的中心量。 */
function helmGap(sh, foe, asp) {
  var a = HELM_ASP[asp], n = 0, mx = 0, my = 0, mz = 0;
  sh.guns.forEach(function (g) { if (g.alive && helmCovers(g, a)) { mx += g.muz[0]; my += g.muz[1]; mz += g.muz[2]; n++; } });
  var p = n ? M4.pt(sh.M, mx / n, my / n, mz / n) : [sh.px, 0, sh.pz], K = keelLine(foe), T = foe.T;
  var ux = K[1][0] - K[0][0], uz = K[1][2] - K[0][2], L2 = ux * ux + uz * uz, t = L2 > 0 ? clamp(((p[0] - K[0][0]) * ux + (p[2] - K[0][2]) * uz) / L2, 0, 1) : 0;
  var x = clamp(Math.round(T.wl0 + (T.wl1 - T.wl0) * t), 0, T.hullTW - 1), hb = (T.hullHB[T.zw * T.hullTW + x] || 20) * S;
  return Math.max(0, Math.hypot(p[0] - K[0][0] - ux * t, p[2] - K[0][2] - uz * t) - hb);
}
// ───────── 繞側（Tim 2026-10-18：「目前AI不會用船頭的希臘火」「自動開火會發射希臘火 但是AI友艦不會」——量過 3 對 3 seed 11：持火號直線衝向敵方戰列，
//   10 秒內被三艘的舷側打掉 53 人與 siphon，整場只開 1 發）─────────
// 船頭／船尾接敵的船（helmSteerEnd）接近時避開敵艦的舷側火力：
//   威脅（helmThreat）＝ 每艘還在的敵艦（HELM_FLANK_R 內）對得到那一點的固定砲火力（helmGunW × 連發數 burst；迴旋砲哪裡都一樣、不影響挑哪裡，不算）；
//     敵艦到那一點的連線隔著我方友艦（friendInLine）⇒ 那艘不算（砲彈先打到友艦）。⛔ helmGunW 本身不改 ⇒ 舷側砲的船戰局不變。
//   我現在的位置、照現在的方位直接衝到射程邊上那一點（HELM_FLANK_END × 射程）都 ≤ HELM_FLANK_K × 候選裡最大 ⇒ 直接衝（照舊）。否則比三種路（一路上取 HELM_FLANK_PATH 點的平均威脅）：
//   · 直接衝；
//   · 繞：繞著敵艦 HELM_FLANK_N 個方位（敵艦的格座標，0 ＝ 它的船頭）的切入點 W(θ) ＝ 敵艦中心 ＋ Rw ×（θ 方向）＋ 敵艦航速 × 前置時間
//     （Rw ＝ clamp(0.7 × 距離, 1.5 × 射程, 距離) ⇒ 一邊繞一邊收近）；終點本身要 ≤ HELM_FLANK_K × 最大，上一次挑的打八折（遲滯）；
//   · 躲到友艦後面（離敵艦那一側 HELM_SHELTER_D m）：比另外兩條的 HELM_SHELTER_K 倍還安全才去。
//   ⛔ 只看終點 ⇒ 開局挑了要橫過三叉戟號船頭三管速射砲的那一點，5 秒死 43 人；照路的平均 ⇒ 開局先躲到友艦後面，5 秒死 6 人（3 對 3 seed 11）。
//   航向對準 W（船尾接敵反過來）；繞 ⇒ 航速照原本那一套（照離敵艦船身的距離、煞得住）；躲 ⇒ 照離掩護點的距離。
// 不繞：附近（HELM_FLANK_R）只有一艘敵艦 ⇒ 直接衝（單挑時繞只會追著它轉過來的舷側跑，量過 siphon 52 → 0 發）；交叉火網（兩艘以上）才繞、才躲。
//   敵艦本身也是船頭／船尾接敵（helmAspect 不是 'side'：另一艘持火號、撞角船）⇒ 照舊正面對衝（⛔ 兩艘都繞 ⇒ 互相繞圈）；已經在射程裡（gap ≤ HELM_FLANK_IN × 射程）。
// 每 HELM_FLANK_DT 秒重算一次（快取 sh.flk）。只有船頭／船尾接敵的船會跑到這裡 ⇒ 舷側砲的船一行都不多算、戰局不變。
var HELM_FLANK_DT = 1, HELM_FLANK_K = 0.3, HELM_FLANK_IN = 1.2, HELM_FLANK_R = 600, HELM_FLANK_N = 36, HELM_FLANK_LEAD = 10, HELM_FLANK_END = 1.5, HELM_SHELTER_D = 35, HELM_SHELTER_K = 0.7, HELM_FLANK_PATH = 5;
/** 敵艦 o 的固定砲對得到世界點 P 的火力（FK：我方友艦的龍骨線；隔著友艦 ⇒ 不算 —— 砲彈會先打到友艦）。 */
function helmThreatOf(o, P, FK) {
  if (FK && FK.length && friendInLine(FK, o.center, P)) return 0;
  var L = toLocal(o, P), a = Math.atan2(L[1] - o.T.cy, L[0] - o.T.cx), w = 0;
  o.guns.forEach(function (g) { if (g.alive && !g.mt && helmCovers(g, a)) w += helmGunW(g) * ((GUNS[g.type] || {}).burst || 1); });   // 連發的砲 × 一份打幾發（⛔ 只照砲重 ⇒ 三叉戟號船頭的三管速射砲看起來很弱，持火號照直線衝它的船頭、10 秒死 53 人）
  return w;
}
/** 世界點 P 被幾艘敵艦的舷側對著（加總；見上）。 */
function helmThreat(sh, P, FK) {
  var w = 0;
  SHIPS.forEach(function (o) { if (isFoe(sh, o) && !isOut(o) && o.M && Math.hypot(o.px - P[0], o.pz - P[2]) < HELM_FLANK_R) w += helmThreatOf(o, P, FK); });
  return w;
}
/** 要不要繞、繞去哪：{ k: 'flank'｜'shelter', w: [x, z] 要去的點（世界）, th 方位（rad，敵艦格座標；掩護 ⇒ 0）, me 我現在的威脅, mx 繞一圈的候選裡最大 } 或 null（直接衝）。 */
function helmFlank(sh, foe, reach, gap, d) {
  var near = SHIPS.filter(function (o) { return isFoe(sh, o) && !isOut(o) && Math.hypot(o.px - sh.px, o.pz - sh.pz) < HELM_FLANK_R; }).length;
  if (near < 2 || helmAspect(foe) !== 'side' || gap <= HELM_FLANK_IN * reach) { sh.flk = null; return null; }   // 一對一 ⇒ 直接衝（煞得住）：⛔ 繞 ⇒ 單挑憲法號時它一直轉舷側對著我、繞到 120 秒 siphon 0 發、死 51 人（直接衝：52 發中 52、死 19）
  var F = sh.flk; if (F && F.foe === foe.i && SIMT - F.t < HELM_FLANK_DT) return F.w ? F : null;
  var FK = friendKeels(sh), me = [sh.px, 0, sh.pz], Lm = toLocal(foe, me), th0 = Math.atan2(Lm[1] - foe.T.cy, Lm[0] - foe.T.cx), tme = helmThreat(sh, me, FK);
  function ring(th, R) { var u = M4.dir(foe.M, Math.cos(th), Math.sin(th), 0), ul = Math.hypot(u[0], u[2]) || 1; return [foe.px + u[0] / ul * R, foe.pz + u[2] / ul * R]; }
  var Rw = clamp(0.7 * d, 1.5 * reach, Math.max(d, 1.5 * reach)), C = [], mx = 0;
  for (var k = 0; k < HELM_FLANK_N; k++) {
    var th = -Math.PI + 2 * Math.PI * k / HELM_FLANK_N, b = ring(th, Rw), T = Math.min(HELM_FLANK_LEAD, Math.hypot(b[0] - sh.px, b[1] - sh.pz) / Math.max(3, Math.abs(sh.spd)));
    var w = [b[0] + foe.vel[0] * T, b[1] + foe.vel[2] * T], t = helmThreat(sh, [w[0], 0, w[1]], FK);
    C.push({ th: th, w: w, t: t }); if (t > mx) mx = t;
  }
  var e = ring(th0, HELM_FLANK_END * reach), tend = helmThreat(sh, [e[0], 0, e[1]], FK), lim = HELM_FLANK_K * mx;   // 照現在的方位直接衝到射程邊上那一點的威脅
  function path(w) { var c = 0; for (var q = 1; q <= HELM_FLANK_PATH; q++) { var f = q / HELM_FLANK_PATH; c += helmThreat(sh, [sh.px + (w[0] - sh.px) * f, 0, sh.pz + (w[1] - sh.pz) * f], FK); } return c / HELM_FLANK_PATH; }   // 一路上的平均威脅（⛔ 只看終點 ⇒ 開局挑了要橫過三叉戟號船頭砲的那一點，5 秒死 43 人）
  var nf = { foe: foe.i, t: SIMT, k: null, w: null, th: 0, me: tme, mx: mx };
  if (mx > 0 && (tme > lim || tend > lim)) {
    var pd = path(e), best = null;                                       // 直接衝那一條路
    C.forEach(function (c) {
      if (c.t > lim) return;
      c.p = path(c.w); var keep = F && F.foe === foe.i && F.k === 'flank' && Math.abs(Math.atan2(Math.sin(c.th - F.th), Math.cos(c.th - F.th))) < 1e-6;
      c.s = c.p * (keep ? 0.8 : 1);                                       // 上一次挑的打八折（遲滯：⛔ 每秒換 ⇒ 敵艦一轉就左右換邊）
      if (!best || c.s < best.s) best = c;
    });
    var sb = null;                                                       // 躲到友艦後面（離敵艦那一側 HELM_SHELTER_D m）
    friendsOf(sh).forEach(function (f) {
      if (isOut(f)) return;
      var ux = f.px - foe.px, uz = f.pz - foe.pz, ul = Math.hypot(ux, uz) || 1, q = [f.px + ux / ul * HELM_SHELTER_D + f.vel[0] * 3, f.pz + uz / ul * HELM_SHELTER_D + f.vel[2] * 3];
      var pq = path(q); if (!sb || pq < sb.p) sb = { w: q, p: pq };
    });
    if (sb && sb.p < HELM_SHELTER_K * Math.min(pd, best ? best.p : Infinity)) { nf.k = 'shelter'; nf.w = sb.w; }
    else if (best && best.p < pd) { nf.k = 'flank'; nf.w = best.w; nf.th = best.th; }   // 繞的那條路比直接衝安全才繞
  }
  sh.flk = nf;
  return nf.w ? nf : null;
}
function helmSteerEnd(sh, foe, asp, d, dx, dz) {
  if (helmRamDef(sh.T)) return helmSteerRam(sh, foe, d, dx, dz);
  var reach = helmAspectR(sh, asp), gap = helmGap(sh, foe, asp), hold = HELM_END_HOLD * reach, vf = (foe.vel[0] * dx + foe.vel[2] * dz) / d, bow = asp === 'B';   // vf：敵艦沿連線離開我的速度
  // 遠了照敵艦的航速往前估（截住它）；兩倍射程內直接對準它 —— ⛔ 一路往前估 10 秒 ⇒ 貼到憲法號旁邊 4 m 時對準的是它前面 40 m，敵艦落在 siphon 的射界（±26°）外，120 秒只開 1 發（量過）
  var T = gap > 2 * reach ? Math.min(HELM_END_LEAD, d / Math.max(1, Math.abs(sh.spd))) : 0, tx = dx + foe.vel[0] * T, tz = dz + foe.vel[2] * T;
  var fk = helmFlank(sh, foe, reach, gap, d);                           // 敵艦的舷側對著我 ⇒ 先繞到它船頭／船尾那一側（helmFlank）
  if (fk) { tx = fk.w[0] - sh.px; tz = fk.w[1] - sh.pz; }
  var yaw = bow ? Math.atan2(-tz, tx) : Math.atan2(tz, -tx), v, m;           // fwd(yaw) ＝ (cos, −sin)
  var canBack = sh.cfg.base > 0 && sh.drive && sh.drive.cap > 0.05;
  var vc = Math.max(0, sh.spd - vf), room = gap - hold;                 // vc：現在的接近速度（自己往前、扣掉敵艦沿連線離開的）；room：離守住的距離還有多遠
  if (bow && gap > HELM_END_FAR * reach && room > 1.5 * vc * vc / (2 * HELM_END_DEC)) { v = Infinity; m = 'close'; }   // 很遠、而且煞得住才全速：⛔ 遠於兩倍射程（50 m）就全速 ⇒ 兩艘持火號各 8 節對衝、3 秒的預判來不及讓，開局撞在一起（量過 seed 3）
  else {
    var c = Math.max(-1.5, (bow ? gap - hold : hold - gap) / HELM_END_TAU);   // 船頭：要的接近率；船尾：要的拉開率（遠了 ⇒ 大、近了收到 0；不設上限 ⇒ 由船的全速封頂）
    if (bow && c > 0) c = Math.min(c, Math.sqrt(2 * HELM_END_DEC * room));   // 煞得住（見 HELM_END_DEC）
    v = bow ? c + vf : c - vf;
    if (v < 0) { v = canBack ? Math.max(-HELM_BACK_V, v) : HELM_VMIN; m = canBack ? 'back' : bow ? 'bow' : 'stern'; }
    else { v = Math.max(HELM_VMIN, v); m = !bow ? 'stern' : gap > reach ? 'close' : 'bow'; }
  }
  if (fk && fk.k === 'shelter') { var ds = Math.hypot(tx, tz); v = clamp(ds / 6, HELM_VMIN, 9); m = 'shelter'; }   // 掩護：照離掩護點的距離（到了就慢慢跟著友艦）
  else if (fk && m !== 'back') m = 'flank';
  // 要大轉向（目標離船頭 ／ 船尾 > HELM_END_TURN）而且有動力 ⇒ 先慢下來（HELM_TURN_V）再轉：槳的差動轉向、慢速時迴轉半徑小。
  //   ⛔ 照全速轉 ⇒ 兩艘持火號擦身而過之後各以 7.7 節、每秒 3.6° 掉頭（迴轉半徑 64 m），掉頭要 50 秒，越離越遠（量過 30 秒拉開到 170 m）
  var tl = fk ? Math.hypot(tx, tz) || 1 : d, F = fwd(sh.yaw), off = Math.acos(clamp((F[0] * (fk ? tx : dx) + F[2] * (fk ? tz : dz)) / tl * (bow ? 1 : -1), -1, 1));   // 繞側 ⇒ 照切入點量（⛔ 照敵艦量 ⇒ 繞側時敵艦本來就不在船頭，一路被壓成 2 m/s）
  if (canBack && off > HELM_END_TURN && v > HELM_TURN_V && gap < 2 * reach) { v = HELM_TURN_V; m = 'turn'; }   // 只在近處（兩倍射程內）：⛔ 遠處也壓到 2 m/s ⇒ 艦隊戰裡敵艦照 4 m/s 走，持火號慢到轉不過來，30 秒目標都在船頭 100° 外、越拉越遠（量過 3 對 3 seed 11）
  sh.endDbg = { gap: +gap.toFixed(1), reach: +reach.toFixed(1), v: v === Infinity ? 'inf' : +v.toFixed(2), flank: fk ? Math.round(fk.th * 57.3) : null };   // 讀數（__game.ships()[i].endDbg）
  sh.hEndT = SIMT;                                                       // 這一步是船頭／船尾接敵（helmEndOn：讓敵艦、避開頂風照它）
  if (m !== sh.hMode && SIMT - (sh.hModeT || -1e9) >= HELM_MODE_T) {
    sh.hMode = m; sh.hModeT = SIMT;
    helmSay(sh, 'mode', HELM_MODE[m] + '：' + HELM_ASP_NAME[asp] + '的砲口離敵艦船身 ' + gap.toFixed(0) + ' m、武器打得到 ' + reach.toFixed(0) + ' m —— '
      + (m === 'shelter' ? '敵艦的舷側對著我（威脅 ' + fk.me.toFixed(1) + '／最多 ' + fk.mx.toFixed(1) + '）、直接衝與繞過去都要挨打 —— 先躲到友艦後面' : m === 'flank' ? '它的舷側對著我（威脅 ' + fk.me.toFixed(1) + '／最多 ' + fk.mx.toFixed(1) + '）、繞到它' + (Math.abs(fk.th) < Math.PI / 2 ? '船頭' : '船尾') + '那一側（離它中線 ' + Math.round(Math.abs(Math.abs(fk.th) < Math.PI / 2 ? fk.th : Math.PI - Math.abs(fk.th)) * 57.3) + '°）再靠過去' : m === 'close' ? '靠過去' : m === 'back' ? '太近、倒退' : m === 'turn' ? '它離' + HELM_ASP_NAME[asp] + ' ' + Math.round(off * 57.3) + '°、先慢下來轉過去' : m === 'bow' ? '對準它、守在 ' + hold.toFixed(0) + ' m' : '背對它、守在 ' + hold.toFixed(0) + ' m'), false);
  }
  return { yaw: yaw, v: v };
}
// ───────── 撞角（Tim 2026-10-18：「防撞設定是否可以每艘船有獨立參數(有的船可以裝備撞角 故意撞敵船)」）─────────
// 撞角 ＝ 一件關聯標 meta kind=ram（造船規格 §9.11；維吉尼亞號的鐵撞角那一種）：撞角是這艘的主武器 ⇒ helmAspect 'B'、指揮官不排戰列、被壓制也不拉開（撞角打不到遠處）。
// 打法（helmSteerRam）：對準敵艦、照它的航速往前估（截住它，最多 RAM_LEAD 秒）全速衝；讓敵艦不讓（foeAvoid）；撞上（31_sailing.js 撞擊事件結束、sh.ramEnd）⇒
//   拉開到兩條龍骨線隔 back_m（meta；預設 RAM_BACK_M）或 RAM_BACK_T 秒（有動力 ⇒ 船頭對著它倒車；只有帆 ⇒ 背對它跑開），再衝下一次；貼上了卻沒撞成（太慢）也一樣。砲照常開（50_sim.js simAi 不管艦長）。撞多狠照撞擊物理（硬度照撞點的材質：鐵撞角撞木船，木船吃虧）。
var RAM_LEAD = 15, RAM_BACK_M = 60, RAM_BACK_T = 25, RAM_HIT_T = 1.5, RAM_TOUCH = 1;
/** 船中水線那一段的半寬（m）。 */
function helmHalfBeam(T) { return (T.hullHB[T.zw * T.hullTW + clamp(Math.round((T.wl0 + T.wl1) / 2), 0, T.hullTW - 1)] || 20) * S; }
/** 船型 T 的撞角：{ tip（格座標：固定點 tip，沒有 ⇒ 船頭中線水線附近最前面那一格）, back（拉開幾 m）, path } 或 null（沒標 kind=ram）。載入時算一次。 */
function helmRamDef(T) {
  if (T.ramDef !== undefined) return T.ramDef;
  var p = (T.h.parts || []).filter(function (q) { return q.meta && q.meta.kind === 'ram'; })[0];
  if (!p) return (T.ramDef = null);
  var tip = p.points && p.points.tip ? p.points.tip.slice() : null;
  if (!tip && T.base) { var G = T.base, y = Math.floor(T.cy); for (var x = G.sx - 1; x >= 0 && !tip; x--) for (var z = T.zw - 15; z <= T.zw + 10; z++) if (G.get(x, y, z)) { tip = [x + 0.5, y + 0.5, z + 0.5]; break; } }
  return (T.ramDef = { tip: tip, back: +p.meta.back_m > 0 ? +p.meta.back_m : RAM_BACK_M, path: p.path || p.name });
}
function helmSteerRam(sh, foe, d, dx, dz) {
  var R = helmRamDef(sh.T), st = sh.ramSt || (sh.ramSt = { back: -1e9 }), yaw, m;
  var hit = sh.ramEnd && sh.ramEnd[foe.i] !== undefined && SIMT - sh.ramEnd[foe.i] < RAM_HIT_T;
  // 貼上了卻沒撞成（船身隔不到 RAM_TOUCH m、這一對沒有撞擊事件、接近速度低於撞擊門檻）⇒ 一樣先拉開、助跑再衝。
  //   ⛔ 不管 ⇒ 維吉尼亞號從正後方追上憲法號（相對 1 m/s，門檻 1.5）船頭頂著它的船尾一直推，60 秒一次都沒撞成（量過 seed 3、風 0.3）
  var kd = segSeg(keelLine(sh)[0], keelLine(sh)[1], keelLine(foe)[0], keelLine(foe)[1]).d, vc = ((sh.vel[0] - foe.vel[0]) * dx + (sh.vel[2] - foe.vel[2]) * dz) / d;   // kd：兩條龍骨線隔多遠（m）；vc：接近速度
  var touch = !hit && !ramOn(sh, foe) && kd < helmHalfBeam(sh.T) + helmHalfBeam(foe.T) + RAM_TOUCH && vc < RAM.v0;   // 船身貼上（兩艘半寬 ＋ RAM_TOUCH）而且接近得比撞擊門檻慢
  var backing = SIMT - st.back < RAM_BACK_T && kd < R.back;
  if (hit && SIMT - st.back > RAM_HIT_T || touch && !backing) {   // 貼著倒車的那一段不再算（⛔ 每 1.5 秒重報一次「沒撞成」）
    st.back = SIMT; helmSay(sh, 'ram', (hit ? '撞上' : '貼上了但太慢、沒撞成 ——') + (foe.i === PLAYER_I ? '我艦' : foe.name) + ' —— 拉開 ' + R.back + ' m 再衝', true); }
  var canBack = sh.cfg.base > 0 && sh.drive && sh.drive.cap > 0.05, v = Infinity;
  if (SIMT - st.back < RAM_BACK_T && kd < R.back) {                     // 拉開到龍骨線隔 back m（或 RAM_BACK_T 秒；剛撞上、剛貼上 ⇒ st.back 剛重設）
    if (canBack) { yaw = Math.atan2(-dz, dx); v = -HELM_BACK_V; } else yaw = Math.atan2(dz, -dx);   // 有動力 ⇒ 船頭照樣對著它倒車退出來（維吉尼亞號撞完坎伯蘭號就是倒車退出來的）；只有帆 ⇒ 背對它跑開
    m = 'ramback';
    // ⛔ 掉頭跑開再掉頭回來 ⇒ 維吉尼亞號（靈活 0.4）一來一回 60 秒以上；⛔ 照中心距 80 m ⇒ 84 m 長的船等於沒分開（量過）
  } else {
    var T = Math.min(RAM_LEAD, d / Math.max(1, Math.abs(sh.spd))), tx = dx + foe.vel[0] * T, tz = dz + foe.vel[2] * T;
    yaw = Math.atan2(-tz, tx); m = 'ram';
  }
  sh.endDbg = { ram: m, d: +d.toFixed(1) }; sh.hEndT = SIMT;
  if (m !== sh.hMode && SIMT - (sh.hModeT || -1e9) >= HELM_MODE_T) { sh.hMode = m; sh.hModeT = SIMT; helmSay(sh, 'mode', HELM_MODE[m] + '：距離 ' + d.toFixed(0) + ' m —— ' + (m === 'ram' ? '對準它、全速衝' : canBack ? '船頭對著它倒車退開' : '背對它全速拉開'), false); }
  return { yaw: yaw, v: v };
}
var HELM_MODE = { approach: '接近', swap: '換舷', evade: '拉開', back: '倒退', abeam: '守正橫', cruise: '巡航', lead: '戰列排頭', line: '戰列跟隨', gauge: '搶上風', close: '船頭接近', bow: '船頭對敵', stern: '船尾對敵', turn: '轉向對敵', flank: '繞側', shelter: '友艦掩護', ram: '衝撞', ramback: '撞完拉開' }, HELM_MODE_T = 4;
/** 指揮官的命令改了打法（排頭、跟隨、搶上風）⇒ 記一筆（跟 helmSteer 的打法同一格 sh.hMode、同一個間隔）。 */
function helmMode(sh, m, text) { if (m !== sh.hMode && SIMT - (sh.hModeT || -1e9) >= HELM_MODE_T) { sh.hMode = m; sh.hModeT = SIMT; helmSay(sh, 'mode', HELM_MODE[m] + '：' + text, false); } }
/** 戰列的排頭（TASK-0679；指揮官 mode 'lead'，53_commander.js cmdLine）：照「整條戰列」開 ——
 *  敵方還在打的船的中心（近了 ⇒ 最近的那艘敵艦）擺在交戰那一舷（od.side）正橫、距離 ＝ 交戰距離（aiRange；照 HELM_LEAD_T 秒後的距離）；
 *  航向照 helmSteer 那一條（遠了往敵方切、近了往外拉），但不換舷、不拉開、不倒退；
 *  期望航速 ＝ 巡航（戰鬥帆＋引擎）× od.pace（隊形還沒排好 ⇒ 0.7 等後面的；⛔ 全速 ⇒ 後面的跟一樣快的船永遠追不上）。 */
function helmLead(sh, od) {
  var L = SHIPS.filter(function (o) { return isFoe(sh, o) && !isOut(o); }); if (!L.length) return null;
  var cx = 0, cz = 0, vx = 0, vz = 0; L.forEach(function (o) { cx += o.px; cz += o.pz; vx += o.vel[0]; vz += o.vel[2]; }); cx /= L.length; cz /= L.length; vx /= L.length; vz /= L.length;
  // 近了（離敵方中心 < 2 × 交戰距離）改照最近的那艘敵艦：⛔ 一直照中心 ⇒ 敵方中心在它排頭後面 135 m，兩個排頭各自把「對方中心」擺在 210 m、自己卻並排在對方排頭旁邊 59 m（量過）
  var nb = null, nd = 1e18; L.forEach(function (o) { var q = Math.hypot(o.px - sh.px, o.pz - sh.pz); if (q < nd) { nd = q; nb = o; } });
  if (Math.hypot(cx - sh.px, cz - sh.pz) < 2 * aiRange(sh) && nb) { cx = nb.px; cz = nb.pz; vx = nb.vel[0]; vz = nb.vel[2]; }
  var n = SHIPS.filter(function (o) { return ORDERS[o.i] && ORDERS[o.i].mode === 'line' && o.team === sh.team && !isOut(o); }).length;
  var sg = od.side === 'P' ? 1 : -1, dx = cx - sh.px, dz = cz - sh.pz, d = Math.hypot(dx, dz) || 1, R = aiRange(sh);
  var LT = tuneV(sh.team, 'leadT'), px = dx + (vx - sh.vel[0]) * LT, pz = dz + (vz - sh.vel[2]) * LT, dp = Math.min(d, Math.hypot(px, pz));   // HELM_LEAD_T 秒後會多近（兩條戰列對著開 ⇒ 早一點轉）
  // 遠了往敵方切（最多 1.0 rad）、近了往外拉（最多 0.9）。⛔ 照 helmSteer 的 −0.4／照現在的距離 ⇒ 兩條戰列對著開、一起轉到同向時已經只隔 20 m，兩條穿插在一起並排走（量過 180 秒：兩個排頭隔 20 m、同航向）
  var yaw = (sg > 0 ? Math.atan2(-dx / d, -dz / d) : Math.atan2(dx / d, dz / d)) + sg * clamp((dp - R) / R * 1.5, -0.9, 1.0);
  if (!sh.noGoTack && n) {                                               // 第一次要搶風：挑航線比較空的那一舷；兩舷都空（友船離航線都在 HELM_TACK_CLR 以外）⇒ 往離自己的隊伍遠的那一舷
    //   航線 ＝ 那一舷的搶風航向（helmNoGo 會給的 up ± a）往前 HELM_TACK_LOOK 公尺；空不空 ＝ 自己這一方的船離那條線最近幾公尺。
    //   ⛔ 只照隊伍的重心 ⇒ 開局橫隊 3 號在排頭右邊 66 m、2、4 號在左邊 ⇒ 重心在左、往右搶，3 號就在航線上 8 m、前方 38 m，14–18 秒擦撞、排頭 5.8 → 0.1 節（量過 wdir=0 藍方）；
    //   ⛔ 往隊伍那一側（以前）⇒ 開局橫隊時排頭橫切過旁邊幾艘的船頭，讓船讓到 4000 步、0.2 節（量過風從船頭來的開局）
    var mx = 0, mz = 0, W0 = norm(WIND), up0 = Math.atan2(W0[2], -W0[0]), a0 = Math.PI - helmBeat(sh) / 57.2958, clr = {};
    SHIPS.forEach(function (o) { var q = ORDERS[o.i]; if (q && q.mode === 'line' && q.head === sh.i && !isOut(o)) { mx += o.px - sh.px; mz += o.pz - sh.pz; } });
    [1, -1].forEach(function (t) {
      var F = fwd(up0 + t * a0), c = Infinity;
      SHIPS.forEach(function (o) { if (o === sh || o.team !== sh.team || isOut(o)) return; var dx = o.px - sh.px, dz = o.pz - sh.pz, al = dx * F[0] + dz * F[2]; if (al > -20 && al < HELM_TACK_LOOK) c = Math.min(c, Math.abs(dx * F[2] - dz * F[0])); });
      clr[t] = c;
    });
    var away = (mx * -W0[2] + mz * W0[0]) > 0 ? -1 : 1;                    // 隊伍在風軸的哪一側（＋ ＝ 風吹去的方向往左轉 90°）⇒ 往另一側
    sh.noGoPref = Math.min(clr[1], clr[-1]) >= HELM_TACK_CLR ? away : clr[1] >= clr[-1] ? 1 : -1;
  }
  yaw = helmNoGo(sh, yaw);
  var cruise = sh.vCruise > 0 ? sh.vCruise : Infinity, v = cruise === Infinity ? Infinity : Math.max(HELM_VMIN, cruise * (od.pace || 1));
  // 等最慢的那艘：跟著自己的（排頭的航跡）裡最慢的滿帆航速 × 0.9；慢到不到自己一半的（帆被打爛）不等，讓它脫隊（⛔ 不等 ⇒ 帆被打掉兩成的隊尾 4.6 節、整條 7.7 節，越拉越遠到 150 m：量過）
  //   每艘的滿帆航速換成「在排頭這個航向」的（照帆速曲線的比例；⛔ 照它自己現在的航向 ⇒ 跟隨的正在頂風轉向、滿帆也只有 1 m/s，排頭跟著等到 0.2 節，整條停住：量過風從船頭來的開局）
  var my = helmPolarAt(sh, sh.yaw), slow = Infinity;
  SHIPS.forEach(function (o) {
    var q = ORDERS[o.i]; if (!(q && q.mode === 'line' && q.head === sh.i && !isOut(o) && o.vFull > 0)) return;
    var vo = o.vFull / Math.max(0.05, helmPolarAt(o, o.yaw)) * my;
    if (!(sh.vFull > 0 && vo < 0.5 * sh.vFull)) slow = Math.min(slow, vo);
  });
  if (slow < Infinity) v = Math.max(HELM_VMIN, Math.min(v, 0.9 * slow));
  if (sh.vFull > 0 && v !== Infinity) v = Math.max(v, HELM_LEAD_MIN * sh.vFull);   // 最慢 ＝ 自己滿帆的一半：⛔ 等到 0.2 節 ⇒ 航跡拉不出來、後面的擠在排頭旁邊互相讓（隊尾讓了 1 萬步），越等越排不起來（量過風從船頭來的開局）
  if (Math.abs(Math.atan2(Math.sin(yaw - sh.yaw), Math.cos(yaw - sh.yaw))) > HELM_TURN_E) v = Infinity;   // 要大轉向 ⇒ 全速（舵靠水流；⛔ 照巡航 × pace ⇒ 頂風時巡航只剩 1.3 m/s、再打七折 ⇒ 0.3 節轉不過來，整條戰列停在那裡：量過風從船頭來的開局）
  sh.leadDbg = { d: Math.round(d), dp: Math.round(dp), R: R, yaw: +yaw.toFixed(2) };   // 讀數（__game.ships()[i].leadDbg）
  helmMode(sh, 'lead', '帶 ' + n + ' 艘排成縱隊，敵方中心擺在' + sideName(od.side) + '、距離 ' + d.toFixed(0) + ' m（要 ' + R.toFixed(0) + ' m）；巡航的 ' + Math.round((od.pace || 1) * 100) + '%' + (od.pace < CMD_PACE ? '（隊形還沒排好，等後面的）' : ''));
  return { yaw: yaw, v: v };
}
/** 排頭要讓的友船（TASK-0679）：自己隊伍裡跟著的只在 40 m 內才讓（讓路是跟隨的事：它們照航跡、會讓排頭）。
 *  ⛔ 每艘都讓 ⇒ 開局橫隊、排頭在中間，往哪一舷搶風都橫切過旁邊那艘的船頭 ⇒ 排頭 30–80 秒一直在讓、48 秒起 0.1 節停住（量過風從船頭來的開局）。 */
function helmLeadAvoid(sh) { return friendsOf(sh).filter(function (o) { var q = ORDERS[o.i]; return !(q && q.mode === 'line' && q.head === sh.i) || Math.hypot(o.px - sh.px, o.pz - sh.pz) < 40; }); }
/** 戰列跟隨（TASK-0679；mode 'line'）：照排頭的航跡、第 od.slot 個間距（53_commander.js cmdHelmWake）；離站位多遠、沿航跡落後多少記在 sh.lineErr／lineLag（指揮官下一次想的時候讀：排好了沒、排頭要不要等）。 */
function helmFollow(sh, ld, od) {
  var hd = od && od.head !== undefined && SHIPS[od.head] && !SHIPS[od.head].sunk ? SHIPS[od.head] : ld, LG = tuneV(sh.team, 'lineGap'), gap = hd === ld ? LG : (od.slot || 1) * LG;   // 照排頭的航跡、第 slot 個間距（排頭沉了 ⇒ 照前一艘）
  var r = cmdHelmWake({ x: sh.px, z: sh.pz, yaw: sh.yaw }, { x: hd.px, z: hd.pz, yaw: hd.yaw, spd: hd.spd }, hd.wake, gap);
  if (r.v !== Infinity && Math.abs(Math.atan2(Math.sin(r.yaw - sh.yaw), Math.cos(r.yaw - sh.yaw))) > HELM_TURN_E) r.v = Math.max(r.v, HELM_TURN_V);   // 要大轉向 ⇒ 至少 HELM_TURN_V（舵要有水流）
  sh.lineErr = r.err; sh.lineLag = r.lag; sh.lineOff = r.off; sh.lineArc = od && od.head !== undefined && hd === SHIPS[od.head] ? r.lag + gap : null;   // 沿排頭航跡離排頭多遠（指揮官照它重排前後；排頭沉了、改跟前一艘 ⇒ 沒有） sh.station = r.station;
  helmMode(sh, 'line', '跟著 ' + ld.name + '（排頭 ' + hd.name + ' 的航跡、第 ' + Math.round(gap / LG) + ' 個間距 ' + gap + ' m）；' + (r.lag > 0 ? '落後站位 ' + r.lag.toFixed(0) + ' m' : '超前 ' + (-r.lag).toFixed(0) + ' m') + '、離航跡 ' + r.off.toFixed(0) + ' m');
  return r;
}
/** 搶風的角度（TASK-0679）：船頭跟「風吹去的方向」夾幾度時往上風走得最快（polar × 往上風的分量），照這艘的逆風性能（cfg.upwind）壓縮過的角度算；
 *  只找到風從船頭 60° 為止（夾角 ≤ 120°）：⛔ 電腦現在不吃頂風失速（31_sailing.js nogo 只算手動）⇒ 帆速曲線在正頂風還有 0.25，再找下去會挑正頂風直衝，那不像帆船。快取在 sh.beatDeg。 */
function helmBeat(sh) {
  var UP = sh.cfg.upwind || 1; if (sh.beatDeg && sh.beatUp === UP) return sh.beatDeg;
  var best = 90, bv = -1;
  for (var deg = 90; deg <= 180 - NOGO_DEG; deg += 0.5) { var dU = UP === 1 ? deg : 90 + (deg - 90) / UP, v = polar(dU) * -Math.cos(deg / 57.2958); if (v > bv) { bv = v; best = deg; } }
  sh.beatUp = UP; return (sh.beatDeg = best);
}
/** 這艘船朝 yaw 時帆速曲線的係數（照它的逆風性能壓縮過的角度；＝ 31_sailing.js sail 的 polarPlay(dU)：娛樂玩法有下限）。 */
function helmPolarAt(o, yaw) { var W = norm(WIND), F = fwd(yaw), UP = o.cfg.upwind || 1, deg = Math.acos(clamp(F[0] * W[0] + F[2] * W[2], -1, 1)) * 57.2958; return polarPlay(UP === 1 || deg <= 90 ? deg : 90 + (deg - 90) / UP); }
/** 航向落在風從船頭 NOGO_DEG（60°）以內 ⇒ 換成近的那一側的搶風航向（helmBeat）。戰列的排頭用（TASK-0679）：
 *  ⛔ 直接對著敵方開 ⇒ 敵方在上風時排頭正頂風（電腦不吃頂風失速、帆速曲線剩 0.25）2.3–2.7 節走 90 秒，後面整條跟著爬（量過風從船頭來的開局）。 */
function helmNoGo(sh, yaw) {
  var W = norm(WIND), F = fwd(yaw), deg = Math.acos(clamp(F[0] * W[0] + F[2] * W[2], -1, 1)) * 57.2958; if (deg <= 180 - NOGO_DEG) { sh.noGoTack = 0; return yaw; }
  var up = Math.atan2(W[2], -W[0]), a = Math.PI - helmBeat(sh) / 57.2958, e = Math.atan2(Math.sin(yaw - up), Math.cos(yaw - up));   // up：正頂風的航向（fwd ＝ −W）
  // 換舷搶風要越過正頂風 HELM_TACK_E 以上才換（⛔ 不留 ⇒ 要的航向在正頂風兩邊晃、排頭一直換舷，掉頭的那一段穿過後面跟上來的船，讓船讓到 3000–4500 步：量過）
  var t = sh.noGoTack || sh.noGoPref || (e >= 0 ? 1 : -1); if (t * e < -HELM_TACK_E - (sh.noGoTack ? 0 : 0.6)) t = -t; sh.noGoTack = t;   // 第一次照偏好的那一舷（要的航向在另一側 0.95 rad 以上才不照）
  return up + t * a;
}
/** 避開頂風（Tim 2026-10-17「可以讓船嘗試轉向避免頂風」「可以參考現實情況如何處置嗎」）：電腦每一艘要的航向（交戰、戰列、搶上風；讓船不算）最後過這一關 ——
 *  · 要的航向落在風從船頭 NOGO_DEG（60°）以內 ⇒ 改成近的那一側的邊（照船現在在正頂風的哪一側；要的在另一側超過 HELM_TACK_E 才換舷）。
 *  · 要轉過正頂風（換舷搶風，tack）但航速不到 HELM_TACK_V ⇒ 改往下風那一邊繞（順風換舷，wear）：現實裡帆船要帶著速度才轉得過頂風，
 *    速度不夠會卡在頂風（missing stays），老水手寧可順風繞一圈。繞過正後方之後要的航向就不再隔著頂風 ⇒ 照常。
 *  ⛔ 不管 ⇒ 戰列的排頭讓船讓進離頂風 46°、視風吃不到（31_drive.js sailWindK）⇒ 6 秒剎到 0.2 節，再加速回來要兩分鐘（量過風從船頭來的開局）。 */
var HELM_TACK_LOOK = 400, HELM_TACK_CLR = 120;                         // 排頭第一次搶風：看航線往前幾公尺、友船離航線幾公尺以外算空（helmLead）
var HELM_TACK_V = 1.5;                                                  // m/s（約 3 節）：低於這個航速不搶風換舷
function helmIrons(sh, yaw) {
  // 有動力（槳、蒸汽）的船在船頭／船尾接敵 ⇒ 不避頂風：動力本來就頂得了風（帆照 helmGovern 收）。⛔ 照避 ⇒ 兩艘持火號擦身而過之後要逆風掉頭，被改成 60° 搶風、各自橫著開走（量過 30 秒拉開到 170 m）
  if (helmEndOn(sh) && sh.cfg.base > 0 && sh.drive && sh.drive.cap > 0.05) { sh.wearing = false; return yaw; }
  var W = norm(WIND), up = Math.atan2(W[2], -W[0]), a = NOGO_DEG / 57.2958;   // up：正頂風的航向（fwd ＝ −W）
  var e = Math.atan2(Math.sin(yaw - up), Math.cos(yaw - up)), c = Math.atan2(Math.sin(sh.yaw - up), Math.cos(sh.yaw - up));   // 要的、現在的：離正頂風幾 rad（正 ＝ yaw 大的那一側）
  if (Math.abs(e) < a) { var t = c >= 0 ? 1 : -1; if (t * e < -HELM_TACK_E) t = -t; e = t * a; yaw = up + e; }
  if (c * e < 0 && Math.abs(e - c) < Math.PI && Math.abs(sh.spd) < HELM_TACK_V) {   // 短的那條路穿過正頂風、速度不夠 ⇒ 往下風轉（離開正頂風那一邊）
    if (!sh.wearing) { sh.wearing = true; helmSay(sh, 'wear', '航速 ' + (sh.spd * 1.944).toFixed(1) + ' 節，轉不過頂風 ⇒ 順風繞過去', false); }
    return sh.yaw + (c >= 0 ? 1 : -1) * 1.0;
  }
  sh.wearing = false;
  return yaw;
}
/** 搶上風（mode 'gauge'）：迎風、往 od.tack 那一側偏 helmBeat 的角度；能多快就多快。 */
function helmGauge(sh, od) {
  var W = norm(WIND), a = Math.PI - helmBeat(sh) / 57.2958, ux = -W[0], uz = -W[2], nx = -W[2], nz = W[0], t = od.tack || 1;   // u：往上風；n：風吹去的方向往左轉 90°（＝ 53_commander.js cmdGauge 的 lat 那一側）
  var hx = ux * Math.cos(a) + nx * t * Math.sin(a), hz = uz * Math.cos(a) + nz * t * Math.sin(a);
  helmMode(sh, 'gauge', '迎風（風從船頭 ' + Math.round(180 - helmBeat(sh)) + '°）往' + (t > 0 ? '左' : '右') + '搶');
  return { yaw: Math.atan2(-hz, hx), v: Infinity };
}
/** 艦長的一個決定：記進戰鬥報表（79_report.js rptHelm：時間、種類、理由）；big ⇒ 也上方廣播（換舷、拉開）。 */
function helmSay(sh, kind, text, big) { if (big) note(sh, '艦長：' + text); rptHelm(sh, kind, text); }
/** 這一段帆（k）還能出多少（0..1，照面積 × 血量，跟 sailFrac 同一個分母）。 */
function helmSetFrac(sh, k) { var a = 0; sh.sails.forEach(function (s) { if (!s.flag && !s.dead && setHas(s, k)) a += s.area * s.hp / s.hpMax; }); return a / sh.sailArea0; }
/** 航速調節（31_sailing.js sail 每一步、算完 vS／vB 之後）：期望航速 sh.wantV ⇒ 帆裝、俥鐘、放掉一點風（sh.helmSpill，下一步乘進 sh.throttle）。
 *  vS：帆在這個航向全部張著、完好時的航速（已經扣掉進水、降旗；不含放慢）；vB：額外動力全速的航速（0 ＝ 沒有）。
 *  每一段帆只靠帆的航速 ≈ vS × 那一段還能出的比例（driveStep：帆推力 k·(vS·frac)²）；帆與引擎一起 ≈ √(帆² ＋ (vB × 俥鐘)²)。
 *  挑法：要的比全帆全速還快 ⇒ 滿帆、全速；有引擎 ⇒ 帆用到「不超過要的」那一段、差的由俥鐘補（倒退 ⇒ 帆全收、俥鐘往後）；只有帆 ⇒ 夠用的最小那一段、再放掉一點風。
 *  帆往上加馬上、往下收要該收連續 HELM_SAIL_T 秒（不來回換）。我艦手動接過去的那一樣不動。 */
function helmGovern(sh, vS, vB) {
  var want = sh.wantV; if (want === null || want === undefined) { sh.helmSpill = 1; return; }
  var me = sh.i === PLAYER_I, useS = hasSails(sh) && !(me && sh.sailHand), useE = vB > 0 && sh.cfg.base > 0 && !(me && sh.teleHand);
  if (SIMT - (sh.govT || -1e9) < HELM_GOV_T) return;
  sh.govT = SIMT;
  var vk = [0, 1, 2, 3].map(function (k) { return vS * helmSetFrac(sh, k); }), k = sh.sailSet, p = sh.power || 0, spill = 1;
  sh.vCruise = Math.hypot(hasSails(sh) ? vk[2] : 0, vB);
  sh.vFull = Math.hypot(hasSails(sh) ? vk[3] : 0, vB);                    // 這個航向能多快（滿帆＋引擎全速；戰列的排頭照最慢的那艘調，helmLead）                 // 巡航：戰鬥帆＋引擎全速（helmSteer 交戰時用；沒有帆 ⇒ 引擎全速）
  if (want === 'cruise') { if (useS) k = 2; p = 1; }                     // 巡航（helmSteer）：戰鬥帆＋引擎全速
  else if (want < 0) { if (useE) { k = useS ? 0 : k; p = want / vB; } else { k = useS ? 1 : k; spill = 0.3; } }
  else if (want >= Math.hypot(vk[3], useE ? vB : 0) * 0.98) { k = 3; p = 1; }
  else if (useE) {
    if (useS) { k = 0; for (var i = 3; i >= 0; i--) if (vk[i] <= want) { k = i; break; } }
    var vs = useS ? vk[k] : vk[sh.sailSet];
    p = vs >= want ? 0 : Math.sqrt(want * want - vs * vs) / vB;
  } else if (useS) {
    k = 3; for (i = 1; i <= 3; i++) if (vk[i] >= want) { k = i; break; }
    spill = vk[k] > 0 ? clamp(want / vk[k], 0.3, 1) : 1;
  }
  if (useS && k !== sh.sailSet) {
    if (k > sh.sailSet) sh.govLow = null;
    else if (sh.govLow === null || sh.govLow === undefined) { sh.govLow = SIMT; k = sh.sailSet; }
    else if (SIMT - sh.govLow < HELM_SAIL_T && !(helmEndOn(sh) && want !== 'cruise' && sh.spd - want > HELM_SAIL_URG)) k = sh.sailSet;   // 船頭／船尾接敵在急煞（比要的快 HELM_SAIL_URG 以上）⇒ 帆馬上收（見 HELM_END_DEC）
    if (k !== sh.sailSet) { helmSay(sh, 'sail', '帆裝 ' + SAILSETS[sh.sailSet] + ' → ' + SAILSETS[k] + '（' + helmWantText(want) + '）', false); sh.govLow = null; if (me) setSails(sh, k); else { sh.sailSet = k; applySailSet(sh); } }
  } else sh.govLow = null;
  if (useE) {
    var best = sh.tele, bd = 1e9; TELE.forEach(function (t, j) { var dd = Math.abs(t - clamp(p, -1, 1)); if (dd < bd - 1e-9) { bd = dd; best = j; } });   // 最接近的那一格
    if (best !== sh.tele) helmSay(sh, 'tele', '俥鐘 ' + TELE_NAME[sh.tele] + ' → ' + TELE_NAME[best] + '（' + helmWantText(want) + '）', false);
    if (best !== sh.tele) { if (me) { var hand = sh.teleHand; teleSet(sh, best); sh.teleHand = hand; } else { sh.tele = best; sh.power = TELE[best]; } }
  }
  sh.helmSpill = useS || !useE ? spill : 1;
}
function helmWantText(w) { return w === 'cruise' ? '巡航：戰鬥帆＋引擎全速' : w === Infinity ? '要全速' : w < 0 ? '要倒退 ' + (-w).toFixed(1) + ' m/s' : '要 ' + (w * 1.944).toFixed(1) + ' 節'; }
/** 讓敵艦（不撞）：跟讓友船同一套（52_fleet.js friendAvoid），對象換成還在的敵艦。 */
function foeAvoid(sh) {
  if (avoidCfg(sh).foe === false) return null;
  if (helmEndOn(sh) && sh.endDbg && sh.endDbg.ram === 'ram') return null;   // 撞角船在衝 ⇒ 不讓敵艦（拉開那一段照讓）                           // 設定檔 cfg.avoid.foe false：裝撞角、要撞上去的船不讓敵艦（52_fleet.js avoidCfg）
  var L = SHIPS.filter(function (o) { return isFoe(sh, o) && !o.sunk && !o.sinkingFinal; }); if (!L.length) return null;
  // 船頭／船尾接敵（helmSteerEnd）⇒ 只往前看 HELM_END_AVT 秒（接近率已經照距離收了）：⛔ 照讓友船的 15 秒 ⇒ 兩艘持火號對衝、龍骨線還隔 97 m 就判成會撞而轉開，永遠進不了 siphon 的 25 m
  return friendAvoid(sh, L, helmEndOn(sh) ? HELM_END_AVT : undefined);
}
// ───────────────────────── 艦長指揮砲長（Tim 2026-10-18：「可以讓艦長指揮炮長(配合策略) 概念跟艦隊指揮官指揮艦長類似」） ─────────────────────────
// 指揮官 → 艦長是「命令」（ORDERS：跟誰、打誰、排第幾），艦長 → 砲長也是：艦長照自己的處境與這一方的策略點名一個瞄準模式，
//   砲長（51_captain.js captainThink）把那個模式的偏好 × GUN_ORD_K 再照局勢挑 ⇒ 命令是加重，不是硬性（局勢分數 0 ⇒ 照樣不打：桅都倒了就不會再打帆具）。
// 先後（前面的先）：
//   被壓制、在拉開（helmThink 的 evade）⇒ 帆具（讓它追不上）；敵艦在拉開 ⇒ 帆具（留住它）；遠於全速接近的距離 ⇒ 帆具（遠距離先拆帆，史料：法國海軍的打法）；
//   近於半個交戰距離 ⇒ 甲板人員；戰列（line）⇒ 砲甲板（對轟、壓它的砲）；集火（focus）⇒ 水線（讓集火的那艘先沉）；其他 ⇒ 不下命令（砲長照自己的性格）。
/** 艦長要砲長打哪裡：{ m（AIM_MODES 其中一個）, why } 或 null。不抽亂數。 */
function helmGunOrder(sh, foe) {
  if (!foe || !foe.center) return null;
  var R = helmRange(sh, sh.hs, true), d = Math.hypot(foe.px - sh.px, foe.pz - sh.pz);   // 不超過武器打得到的距離（長砲 ⇒ 跟以前一樣）
  var sg = sigFor(sh.team), strat = sg && sg.strat || CMD_SIDE[sh.team];
  if (sh.hs && sh.hs.evade) return { m: 'rig', why: '我們火力不如它、在拉開 —— 拆它的帆讓它追不上' };
  if (foe.hs && foe.hs.evade) return { m: 'rig', why: '敵艦在拉開 —— 拆它的帆留住它' };
  if (d > tuneV(sh.team, 'far') * R) return { m: 'rig', why: '還遠（' + d.toFixed(0) + ' m）—— 先拆帆' };
  if (d < 0.5 * R) return { m: 'deck', why: '很近（' + d.toFixed(0) + ' m）—— 掃甲板上的人' };
  if (strat === 'line') return { m: 'hull', why: '戰列對轟 —— 壓它的砲' };
  if (strat === 'focus') return { m: 'water', why: '集火 —— 讓它先沉' };
  return null;
}
