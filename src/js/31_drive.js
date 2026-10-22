// ───────────────────────── 動力（TASK-0630；Tim 2026-10-15「把船隻速度算法重新規範化 根據動力來源(帆 蒸汽機 魔法(幽靈船)) 去推動船」） ─────────────────────────
// 每艘船一份動力源清單（sh.drive.P，driveInit 開戰時建）：
//   · 帆（sail）：每面帆一個，作用點 ＝ 那面帆的面積中心（格座標；作品的姿勢，帆桁轉的不算）。完好度 ＝ 帆的血量（掉了 0；收著的不出力、不算受損）。
//   · 蒸汽機（steam）：輸出物件 ＝ 螺旋槳模型（meta kind=propeller，作用點 ＝ 固定點 hub，幾個就分幾份）；沒有 ⇒ 船尾中線、水線下 1.5 m（T.wl0 往內 4 格）。
//       完好度 ＝ 螺旋槳還在（模型）／船尾那一塊格子還剩幾成（退路，±10 格的方塊，每半秒數一次）×（0.5 ＋ 0.5 × 煙囪還在幾成；沒有煙囪 ⇒ ×1）
//       × 動力的那一條鏈（有標才算；造船規格 §9.6）：主機 → 軸 → 螺旋槳，鍋爐供汽 —— 見下面「動力源與輸出物件」。
//   · 魔法（magic，幽靈船；ships[].drive = "magic"）：當成蒸汽機 ⇒ 作用點 ＝ 船（中線、T.cx）；完好度 ＝ 船殼還剩幾成（grid.count／orig）——
//       船上有標 kind=engine 的部件（TASK-0680：風暴角號船長室的管風琴）⇒ 改照那幾件的完好度（動力件的曲線，同蒸汽機的主機），船殼別處打壞不影響。
//   有額外動力（cfg.base > 0）才有蒸汽機／魔法；種類照 ships[].drive（沒寫 ⇒ steam）。
// 推力與加速度（每一步，sail() 呼叫 driveStep）：
//   每個動力源有一個「單獨推動時的航速」v（帆：舊公式的滿帆航速 × 帆的比例；額外動力：cfg.base 節 × 俥鐘），推力 F ＝ k·v²，水阻 ＝ k·v|v|
//   ⇒ 最高航速 ＝ √Σv²：跟以前「帆² ＋ 額外動力²」的合成一模一樣（Tim 2026-10-14 的「兩者動力相加」）⇒ 預設設定下最高航速不變；變的是怎麼加減速。
//   k（水阻係數，kN／(m/s)²）＝ drive.kDrag × 排水量^⅔（噸）—— 照憲法號校準：舊的一階追速（時間常數 20 秒）從 0 到 90% 約 46 秒，這裡同一艘也約 46 秒。
//   加速度 ＝ (ΣF − 水阻) ÷ (實際質量 × 細節設定「加速慣性」)；實際質量 ＝ 開戰時的重量 − 打掉的（massLost）＋ 艙內進水（粒子模式 fl.vol；公式模式照下沉換算）。
//   ⇒ 船越重、最高航速越低，加速越慢（τ ∝ 質量 ÷ (k·v)）；進水越多越難加速。
//   錨咬著、拋錨（6）、電腦讓開友艦砲線（throttle < 1）而且比該有的快 ⇒ 照舊 6 秒內收到該有的航速（下錨、轉帆擋風；⛔ 只靠水阻 ⇒ 戰列跟不上指揮官的油門）。
// 受損降輸出：帆照血量（舊的 sailFrac 一樣）；額外動力 ⇒ 每個動力源的完好度合起來是「現在最多出得了幾成推力」，俥鐘要的超過就給到上限（Tim：「會嘗試按照全動力去給輸出(不超過目前最大輸出)」）。
// 力矩（Tim：「帆透過桅杆 會有力矩 且會受風向影響」）：帆除了往前推，還有往下風推的側向力（推力 × drive.side × |sin 相對風向|）；
//   以「完好時的配置」當平衡點（這一段帆都在時的面積中心、所有螺旋槳都在時的推力中心）⇒ 只有受損的不平衡才轉船：
//   前面的帆被打掉 ⇒ 帆的中心往後 ⇒ 船尾被推往下風 ⇒ 船頭往上風偏（迎風偏轉）；雙螺旋槳打掉一邊 ⇒ 往壞的那一邊偏。
//   大小 ＝ 「吃掉幾成舵效」：(力矩 ÷ (總推力 × 水線長／4)) × 最大轉向率 × 細節設定「帆的力矩」（夾 ±1.5 倍）；舵照舊可以修回來。
// 俥鐘（額外動力的控制；Tim：「拆成兩套」「額外動力…模擬俥鐘的介面(用點陣圖)」「放在羅盤右側」→ 2026-10-16 改「左側按鈕上方」「橫版的話 就放在左下角吧」「也要支援快捷鍵操作」）：drive.tele 9 格（航速的比例：前進全速…停俥…後退全速）；
//   E ＝ 往前撥一格、T ＝ 往後撥一格；點或拖俥鐘（橫版在畫面左下角、直版在左邊那一欄大圓鈕上方）。推力 ＝ 比例² × 全推力（航速 ∝ 比例）。電腦的船一直全速前進（跟以前一樣）。
// 不抽 rnd()、不讀畫面的設定 ⇒ 同一個種子、同一份設定照樣逐字重現（但戰局跟改之前不一樣：加減速、受損的偏轉都變了）。
// 動力源與輸出物件（Tim 2026-10-15：「可以有多個動力源綁訂到一個動力輸出物件(例如 螺旋槳) 然後物件可以有meta根據輸出動力調整轉速」；2026-10-16「接下來希望可以串上螺旋槳」）：
//   動力源 ＝ 主機（關聯 meta kind=engine，固定點 core；份量照 ihp ＞ nhp ＞ 1）；輸出物件 ＝ 螺旋槳（上面那幾個 steam 項）。都照造船規格 §9.6 的 meta，沒標 ⇒ 照舊（一具看不見的主機推全部的輸出）。
//   綁法：主機 meta propeller（＝ 螺旋槳模型的名字或路徑）⇒ 照它；否則有軸（kind=shaft，aft、fwd）⇒ 軸的 aft 離哪個螺旋槳的 hub（或 shaft-fwd）最近就接哪個、主機接 fwd 離 core 最近的那根軸；
//     都沒有 ⇒ 平分給每個輸出物件。⇒ 多具主機可以推同一個螺旋槳（推力在螺旋槳合起來），一具主機也可以分給好幾個。
//   壞了沒有（每半秒、跟 survey 一起）：主機 core、每座鍋爐 boiler-n、軸 aft／fwd 旁 ±8 格的格子剩不到開局的一半 ⇒ 那一件壞了（規格的建議判法；開局就 0 格 ⇒ 量不出來、當作好的）。
//     主機壞 ⇒ 它那一份沒了；軸斷 ⇒ 接在那根軸上的螺旋槳收不到；鍋爐 ⇒ 全船的蒸汽照還在的座數打折（每組鍋爐都供給每具主機）；螺旋槳（模型）被打飛 ⇒ 綁在它上面的動力出不來。
//   煙（78_funnel.js）：主機全壞 ⇒ 每根煙囪停煙；某組鍋爐全壞 ⇒ 它 meta funnel 那根停煙。
//   轉速（畫面）：螺旋槳照自己那一份推力轉 —— 推力 ∝ 轉速² ⇒ 轉速 ＝ rpm_max × √(推力 ÷ 完好時全速的推力)，倒車反轉；1.5 秒內跟上（DRV_SPIN_T）。
//     rpm_max ＝ 螺旋槳模型 meta rpm_max（沒有 ⇒ drive.rpm，預設 80 —— ⚠ 不是史料）。轉法照規格：往前走時照右手定則繞 +axis 轉、繞固定點 hub；借小艇擺動那一套（modelLocal 的 m.sw／spv／sax）畫。
//     只給人看：轉角不回到模擬裡（被打中、碰撞照舊用模型外框）。
// 傳輸鏈（TASK-0691；Tim 2026-10-18：「動力有點像一個傳輸鍊 可以是A => B => C => D 也可以直接A包含全部」「B => C就是傳輸鍊的一環」「鍊上每一個節點都可以提供動力(也可以不提供)」
//   「單節點的話 就是同時提供動力 也同時輸出」）：每個額外動力項（輸出物件）一條鏈 p.chain ＝ 從第一節到輸出那一節，每一節 { ok 傳得過去幾成, out 自己出多少力（份量的幾成）}；
//   傳到輸出的 ＝ (((第一節出力) × 第二節完好 ＋ 第二節出力) × 第三節完好 ＋ …) × 輸出那一節完好 ＋ 輸出那一節出力（drvChain）。種類只決定每一節的 ok／out 怎麼算（drvLinks）：
//   · 蒸汽：鍋爐（出力 ＝ 全船的蒸汽）⇒ 主機（推這個輸出物件的那幾具，完好的份量 ÷ 完好時的份量）⇒ 軸（傳得到幾成）⇒ 螺旋槳／船尾（還在幾成）；沒標的節省略；最後 ×（0.5 ＋ 0.5 × 煙囪還在幾成）。
//   · 魔法：一節（管風琴那幾件的完好度，或船殼還剩幾成）—— 自己出力、自己輸出（看不見的輸出）。
//   · 槳（模型 meta kind=oar，造船規格 §9.10）：一節 ＝ 整條鏈 —— 出力 ＝ 槳還在 × 槳手到崗比例（40_crew.js 槳手，倒下 ⇒ 預備水手補；42_hands.js）；不接主機、不接軸。
//     有槳的船（cfg.base > 0）⇒ 額外動力 ＝ 槳（drive.kind 'oar'）：每支槳一項、作用點 ＝ 槳座 pivot、份量 ＝ 槳手數 ÷ 全船槳手數 ⇒ 推力、受損、偏轉（一舷的槳打掉 ⇒ 往那一舷偏）都照上面同一套。
//     俥鐘照用：前進全速 ＝ 衝刺划、停俥 ＝ 停槳、後退 ＝ 倒划；槳頻 ∝ 俥鐘（OAR_SPM 每分鐘幾下）。⚠ 同一艘有槳又有螺旋槳 ⇒ 只算槳（還沒有這種船、份量怎麼分沒定）。
//   划槳動畫（只是畫面：m.swM，modelLocal 照它畫；模擬照靜止的外框；?oaranim=0 關掉 ⇒ 戰局逐位元組相同）：一下 ＝ 繞槳座的直立軸前後掃（stroke_deg）＋ 回槳時繞沿船身的水平軸把槳葉抬出水（dip_deg）；
//     同一艘船同一個節奏（D.oph）、倒划反著走；沒人划（到崗 0）、斷掉的槳不動。
// 差動轉向（TASK-0691；Tim 2026-10-18：「船有左右側動力的話(包含雙螺旋槳) 轉彎時可以停掉一邊動力(甚至倒車)加速轉彎(自動化的 不用手動操作)」）：
//   兩舷都有輸出（槳、偏離中線 3 格以上的螺旋槳）、往前划／開 ⇒ 內側那一舷（舵角正 ＝ 往左舷轉 ⇒ 左舷）的推力 × (1 − 2 × |舵角|)，夾 −0.5…1：
//   舵打一半 ⇒ 內側停、打滿 ⇒ 內側倒車一半。力矩照舊從推力的不平衡來（driveYaw）；玩家、電腦都一樣（照 sh.rudder）。
//   划槳的畫面跟著（oarAnim）：內側那一舷的槳頻 × 同一個倍率 ⇒ 舵打一半停槳、打滿倒划。
//   只有一舷、中線單螺旋槳 ⇒ 不作用（戰局不變）。設定檔 drive.diff: false 或網址 ?drvdiff=0 關掉。
//   ⚠ TASK-0777 起（操舵的開關開著）差動照舵令、停俥倒車也作用、力矩另外記 ⇒ 見下面「操舵」那一段；這一段只在開關關掉時照舊。
// ⏳ 第二版（TASK-0630 驗收）：繩帆物理開著時用布上的風壓算帆的推力（各檔一個乘數）、物件重量預先算好、風洞沙盒。
var DRIVE_CFG = CFG.drive || {};
var DRV_KD = +DRIVE_CFG.kDrag || 0.0615, DRV_SIDE = DRIVE_CFG.side === undefined ? 0.6 : +DRIVE_CFG.side;
var TELE = DRIVE_CFG.tele || [1, 0.6, 0.35, 0.15, 0, -0.15, -0.35, -0.6, -1];
var TELE_NAME = DRIVE_CFG.teleNames || ['前進全速', '前進半速', '前進慢速', '前進微速', '停俥', '後退微速', '後退慢速', '後退半速', '後退全速'];
var TELE_FULL = TELE.indexOf(1) >= 0 ? TELE.indexOf(1) : 0;               // 開局：全速前進（跟以前額外動力一直開著一樣）
var DRV_RPM0 = +DRIVE_CFG.rpm > 0 ? +DRIVE_CFG.rpm : 80, DRV_SPIN_T = 1.5, DRV_PART_R = 8;
var DRV_DIFF = DRIVE_CFG.diff !== false && Q.get('drvdiff') !== '0', DRV_SIDE_MIN = 3;   // 差動轉向（見檔頭）；偏離中線幾格才算一舷
var OAR_SPM = +DRIVE_CFG.oarSpm > 0 ? +DRIVE_CFG.oarSpm : 26, OAR_ANIM = Q.get('oaranim') !== '0';   // 槳全速時每分鐘划幾下（⚠ 估的：槳帆船巡航約 20–26 下、衝刺 30 以上）；?oaranim=0 ⇒ 不畫划槳（對拍用）   // 螺旋槳預設最高轉速（rpm；⚠ 不是史料）、轉速跟上的時間常數（秒）、部件壞了沒有數幾格（±格）
// ── 動力件（TASK-0653；Tim 2026-10-16：「不是直接根據該子模組當前剩下多少voxel計算嗎? 另外更新頻率1s應該就夠了」「鍋爐可能剩50%就沒動力了」
//    「槳軸是否可以是類似mc紅石電路概念的東西 傳遞動力」「被打細了傳得比較少 可能可以是每隔能傳遞多少動力(類似電線粗細與電流量關係)」）──
// 雕刻的關聯 meta kind engine／boiler／shaft／steampipe，匯出時 admin.py drive_cells 把那一件的格子清單寫進檔頭 parts[].cellRuns（整艘船格座標的線性編號，連續段）。
//   格子照舊在船殼裡（畫面、被打、進水都不變）；遊戲只是記得哪幾格是它的 ⇒ 每 DRV_PART_T 秒照實數：
//   · 體素件（engine、boiler）：還剩幾成 r ＝ 現在還在的格 ÷ 開局的格 ⇒ 輸出 ＝ 曲線（DRVP[種類].lo 以下 0、hi 以上 1、中間直線）；
//     鍋爐每一座再看中心那一格泡沒泡在艙內的水裡（33_flood.js wetAt inner ＝ DRVP.boiler.wet）⇒ 泡水那一座熄火。
//   · 傳動件（shaft fwd→aft、steampipe from→to）：從一端到另一端、互不共用格子的路最多幾條（26 鄰的最大流 ＝ 最細的那一截）× 每格傳幾成（DRVP[種類].cell），夾 0…1；
//     cell ＝ 0 ⇒ 只看通不通。開局就傳不滿（雕得細）⇒ 照開局當滿載（匯入檢查報）；開局就不通 ⇒ 判不了、當作一直通（匯入檢查報）。
//     蒸汽管接最近的那一組鍋爐（from 離鍋爐最近）：那一組的蒸汽 × 蒸汽管傳得到的；沒有蒸汽管的組照舊直接供汽。
//   全船的蒸汽 ＝ Σ 每一組（座數 × 輸出 × 乾的座數比 × 蒸汽管）÷ Σ 座數；主機的份量 × 主機的輸出；接在軸上的輸出物件 × 軸傳得到的。
// 沒有 cellRuns 的件 ⇒ 照舊（固定點旁 ±DRV_PART_R 格剩一半以上 ＝ 好的、每 0.5 秒）⇒ 沒標的船戰局一位元不動。參數在道具設定頁「動力件」（67_furncfg.js）。
var DRVP_DEF = { engine: { name: '主機', lo: 0.4, hi: 1 }, boiler: { name: '鍋爐', lo: 0.5, hi: 0.8, wet: 0.5 }, shaft: { name: '螺旋槳軸', cell: 0.15 }, steampipe: { name: '蒸汽管', cell: 0.15 }, propeller: { name: '螺旋槳', lo: 0.2, hi: 0.9 }, oar: { name: '槳', hpK: 0.9 } };   // propeller：會轉的體素件（24_armor.js propSetup；第二段）。oar：整支一塊（規格表 drv=hp），血量 ＝ GUN_HP × hpK（10_ship.js；Tim 2026-10-18「槳太脆弱了 是否可以加到三倍血量(且可以作為道具設定頁定調整血量 參考螺旋槳)」：0.3 → 0.9）
var DRVP = {}; Object.keys(DRVP_DEF).forEach(function (k) { DRVP[k] = Object.assign({}, DRVP_DEF[k], (CFG.drvparts || {})[k] || {}); });
// 動力件檢查的開關（Tim 2026-10-17：「動力件檢查我感覺可以先關閉」）：關（預設）⇒ 戰鬥中不數主機、鍋爐、軸、蒸汽管還剩幾成（都當完好、鍋爐不會泡水熄火、煙囪不停煙）；
//   螺旋槳照自己的格、沒標動力件的船（舊判法 ±DRV_PART_R 格）也一起關；魔法動力源有實體的（TASK-0680 風暴角號的管風琴：在船長室、打得到）照常數。設定檔 drive.partCheck: true 或網址 ?drvcheck=1 打開；匯入檢查照舊列。
var DRV_CHECK = Q.has('drvcheck') ? Q.get('drvcheck') === '1' : DRIVE_CFG.partCheck === true;
var DRV_PART_T = 1, DRV_END_R = 4;                                      // 秒（每兩次 survey）；傳動件兩端：固定點 4 格內的格算端點
/** 檔頭的 cellRuns ⇒ 格座標 [x, y, z, …]（Int16Array）。 */
function drvCells(T, runs) {
  var sx = T.h.size[0], sy = T.h.size[1], out = [], at = 0;
  for (var k = 0; k + 1 < runs.length; k += 2) {
    var s = at + runs[k], c = runs[k + 1];
    for (var j = 0; j < c; j++) { var i = s + j, z = Math.floor(i / (sx * sy)), r = i - z * sx * sy, y = Math.floor(r / sx); out.push(r - y * sx, y, z); }
    at = s + c;
  }
  return new Int16Array(out);
}
function drvLeft(G, C) { var n = 0; for (var i = 0; i < C.length; i += 3) if (G.get(C[i], C[i + 1], C[i + 2])) n++; return n; }
/** 體素件：還剩幾成 ⇒ 輸出（0…1）。 */
function drvCurve(kind, r) { var P = DRVP[kind]; return P && P.hi > P.lo ? clamp((r - P.lo) / (P.hi - P.lo), 0, 1) : (r > 0 ? 1 : 0); }
/** 傳動件要幾條路才算傳滿（cell ＝ 0 ⇒ 1：只看通不通）。 */
function drvNeed(kind) { var c = +(DRVP[kind] || {}).cell; return c > 0 ? Math.ceil(1 / c - 1e-9) : 1; }
/** 傳動件：照 G 現在還在的格子，從 a 端到 b 端互不共用格子的路最多幾條（找到 need 條就停）。每一格容量 1（拆成進、出兩點），26 鄰。 */
function drvFlow(G, C, a, b, need) {
  var n = 0, id = new Map(), X = [], i, k;
  for (i = 0; i < C.length; i += 3) { if (!G.get(C[i], C[i + 1], C[i + 2])) continue; id.set(C[i] + 2048 * (C[i + 1] + 2048 * C[i + 2]), n); X.push(C[i], C[i + 1], C[i + 2]); n++; }
  if (!n) return 0;
  function ends(p) {                                                     // 端點：固定點 DRV_END_R 格內的格；都沒有 ⇒ 最近的那一格
    var L = [], bd = 1e18, bi = -1;
    for (var j = 0; j < n; j++) { var dx = X[3 * j] - p[0], dy = X[3 * j + 1] - p[1], dz = X[3 * j + 2] - p[2], d = dx * dx + dy * dy + dz * dz; if (d <= DRV_END_R * DRV_END_R) L.push(j); if (d < bd) { bd = d; bi = j; } }
    return L.length ? L : [bi];
  }
  var S = 2 * n, T = 2 * n + 1, N = 2 * n + 2, head = new Int32Array(N).fill(-1), to = [], cap = [], nxt = [];
  function edge(u, v, c) { to.push(v); cap.push(c); nxt.push(head[u]); head[u] = to.length - 1; to.push(u); cap.push(0); nxt.push(head[v]); head[v] = to.length - 1; }
  for (i = 0; i < n; i++) {
    edge(2 * i, 2 * i + 1, 1);                                           // 進 → 出（這一格只能走一次）
    for (var dz = -1; dz <= 1; dz++) for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      if (!dx && !dy && !dz) continue;
      var j = id.get((X[3 * i] + dx) + 2048 * ((X[3 * i + 1] + dy) + 2048 * (X[3 * i + 2] + dz)));
      if (j !== undefined) edge(2 * i + 1, 2 * j, 1);
    }
  }
  ends(a).forEach(function (j) { edge(S, 2 * j, 1); });
  ends(b).forEach(function (j) { edge(2 * j + 1, T, 1); });
  var flow = 0, prev = new Int32Array(N);
  while (flow < need) {                                                  // 找一條增廣路（BFS）
    prev.fill(-1); prev[S] = -2; var q = [S], h = 0;
    while (h < q.length && prev[T] === -1) { var u = q[h++]; for (k = head[u]; k >= 0; k = nxt[k]) if (cap[k] > 0 && prev[to[k]] === -1) { prev[to[k]] = k; q.push(to[k]); } }
    if (prev[T] === -1) break;
    for (var v = T; v !== S; v = to[prev[v] ^ 1]) { cap[prev[v]]--; cap[prev[v] ^ 1]++; }
    flow++;
  }
  return flow;
}
/** 傳動件現在傳得到幾成（0…1）：路數 × 每格傳幾成；開局就傳不滿 ⇒ 照開局的路數當滿載。
 *  memo（這艘船自己的那一筆，C.SH[]／C.SP[]；⛔ 不能記在 s 上 ⇒ 同型的船共用 s）：格子還在哪幾格跟上次一樣 ⇒ 路數一定一樣、不重算最大流
 *  （TASK-0673：一條軸一次約 4 ms、每秒每條都算 ⇒ 4 對 4 的 survey 一半時間在這裡）。 */
function drvTrans(G, s, kind, memo) {
  var need = drvNeed(kind), f0 = s.flow0 && s.flow0[need]; if (f0 === undefined) return 1;
  if (!(f0 > 0)) return 1;                                              // 開局就不通 ⇒ 判不了（匯入檢查報）
  var k = Math.min(need, f0);
  if (memo && drvSame(G, s.cells, memo) && memo.flowK === k) return memo.flowR;
  var r = clamp(drvFlow(G, s.cells, s.a, s.b, k) / k, 0, 1);
  if (memo) { memo.flowK = k; memo.flowR = r; }
  return r;
}
/** 格子清單 C 還在的那幾格跟 memo 上次記的一樣嗎（順手記下這一次的）。第一次 ⇒ false。 */
function drvSame(G, C, memo) {
  var P = memo.pres, same = !!P;
  if (!P) P = memo.pres = new Uint8Array(C.length / 3);
  for (var i = 0, j = 0; i < C.length; i += 3, j++) { var u = G.get(C[i], C[i + 1], C[i + 2]) ? 1 : 0; if (u !== P[j]) { P[j] = u; same = false; } }
  return same;
}
/** 一面帆的面積中心（格座標；雙層布的兩層一起算，中心不變）。 */
function sailCentroid(s) {
  var v = s.verts, A = 0, cx = 0, cy = 0, cz = 0;
  for (var j = 0; j < s.tris.length; j += 3) {
    var a = s.tris[j] * 3, b = s.tris[j + 1] * 3, d = s.tris[j + 2] * 3;
    var w = len(cross([v[b] - v[a], v[b + 1] - v[a + 1], v[b + 2] - v[a + 2]], [v[d] - v[a], v[d + 1] - v[a + 1], v[d + 2] - v[a + 2]])) / 2;
    A += w; cx += w * (v[a] + v[b] + v[d]) / 3; cy += w * (v[a + 1] + v[b + 1] + v[d + 1]) / 3; cz += w * (v[a + 2] + v[b + 2] + v[d + 2]) / 3;
  }
  return A > 0 ? [cx / A, cy / A, cz / A] : [s.bb ? (s.bb[0] + s.bb[3]) / 2 : 0, s.bb ? (s.bb[1] + s.bb[4]) / 2 : 0, s.bb ? (s.bb[2] + s.bb[5]) / 2 : 0];
}
/** 船尾退路的完好度：作用點 ±10 格方塊裡的格子數。 */
function driveCount(G, p) {
  var x = Math.floor(p[0]), y = Math.floor(p[1]), z = Math.floor(p[2]), n = 0;
  for (var dz = -10; dz <= 10; dz++) for (var dy = -10; dy <= 10; dy++) for (var dx = -10; dx <= 10; dx++) if (G.get(x + dx, y + dy, z + dz)) n++;
  return n;
}
/** 部件固定點旁 ±DRV_PART_R 格的格子數（主機、鍋爐、軸壞了沒有）。 */
function drvCount(G, p) {
  var x = Math.floor(p[0]), y = Math.floor(p[1]), z = Math.floor(p[2]), r = DRV_PART_R, n = 0;
  for (var dz = -r; dz <= r; dz++) for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) if (G.get(x + dx, y + dy, z + dz)) n++;
  return n;
}
/** 船型 T 的動力部件（造船規格 §9.6；關聯 meta，固定點已經是格心；載入時算一次）：主機、鍋爐（每座一點）、軸。 */
function drvParts(T) {
  if (T.drvParts) return T.drvParts;
  var E = [], B = [], SH = [], SP = [], cells = false;
  function cl(q, o) { if (q.cellRuns && q.cellRuns.length) { o.cells = drvCells(T, q.cellRuns); cells = true; } return o; }
  (T.h.parts || []).forEach(function (q) {
    var m = q.meta, pt = q.points || {}; if (!m) return;
    if (m.kind === 'engine' && pt.core) E.push(cl(q, { name: q.path, p: pt.core.slice(), w: +m.ihp > 0 ? +m.ihp : +m.nhp > 0 ? +m.nhp : 1, prop: refPath(T, m.propeller) }));
    else if (m.kind === 'boiler') {
      var seats = [], nb = Math.max(1, Math.round(+m.boilers || 1));
      for (var j = 1; j <= nb; j++) if (pt['boiler-' + j]) seats.push(pt['boiler-' + j].slice());
      if (!seats.length && pt.uptake) seats.push(pt.uptake.slice());
      if (seats.length) B.push(cl(q, { name: q.path, seats: seats, funnel: refPath(T, m.funnel), up: pt.uptake ? pt.uptake.slice() : seats[0] }));
    } else if (m.kind === 'shaft' && pt.aft && pt.fwd) SH.push(cl(q, { name: q.path, aft: pt.aft.slice(), fwd: pt.fwd.slice(), a: pt.fwd.slice(), b: pt.aft.slice(), kind: 'shaft' }));   // 傳動：主機那頭（fwd）→ 螺旋槳那頭（aft）
    else if (m.kind === 'steampipe' && pt.from && pt.to) SP.push(cl(q, { name: q.path, a: pt.from.slice(), b: pt.to.slice(), kind: 'steampipe' }));   // 蒸汽管（TASK-0653）：鍋爐那頭 from → 主機那頭 to
  });
  var G0 = T.hullG || T.base;                                             // 開局的格子：船殼（24_armor.js 把會轉的裝甲拆出去 ⇒ T.hullG；sh.grid 也是從它來的）；沒有 ⇒ 整艘
  E.forEach(function (e) { e.n0 = drvCount(G0, e.p); });
  B.forEach(function (b) { b.n0 = b.seats.map(function (p) { return drvCount(G0, p); }); });
  SH.forEach(function (s) { s.n0 = [drvCount(G0, s.aft), drvCount(G0, s.fwd)]; });
  E.concat(B, SH, SP).forEach(function (o) { if (o.cells) o.c0 = drvLeft(G0, o.cells); });   // 開局有幾格（armorSetup 拆出去的不算）
  SH.concat(SP).forEach(function (o) { if (o.cells) drvTube(G0, o); });   // 穿過船殼的那一段借船殼的格（見 drvTube）
  SP.forEach(function (p) { var bi = -1, bd = 1e18; B.forEach(function (b, j) { b.seats.concat([b.up]).forEach(function (s) { var d = drvD2(s, p.a); if (d < bd) { bd = d; bi = j; } }); }); p.boiler = bi; });
  return (T.drvParts = { E: E, B: B, SH: SH, SP: SP, cells: cells });
}
/** 傳動件穿過船殼的那一段（三艘鐵甲艦的軸都是：船尾柱、隔艙壁那幾格算船殼的、不算軸的 ⇒ 軸的格子斷成兩截、開局就「不通」）：
 *  沿兩端固定點的連線（a → b），照軸自己的粗細（每一截格數的中位數 A ⇒ 半徑 √(A／π)＋0.25）把連線上開局就在的格借進來。
 *  借來的格被打掉 ＝ 軸管被打爛 ⇒ 一樣傳不過去。o.cells 換成自己的＋借來的；o.tubeN ＝ 借了幾格（匯入檢查報）。 */
function drvTube(G, o) {
  var a = o.a, b = o.b, u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = len(u), C = o.cells; o.tubeN = 0;
  if (!(L > 0)) return;
  u = [u[0] / L, u[1] / L, u[2] / L];
  function tr(x, y, z) { var px = x + 0.5 - a[0], py = y + 0.5 - a[1], pz = z + 0.5 - a[2], t = px * u[0] + py * u[1] + pz * u[2], qx = px - t * u[0], qy = py - t * u[1], qz = pz - t * u[2]; return [t, Math.sqrt(qx * qx + qy * qy + qz * qz)]; }
  var cnt = {}, own = new Set(), i;
  for (i = 0; i < C.length; i += 3) { own.add(C[i] + 2048 * (C[i + 1] + 2048 * C[i + 2])); var q = tr(C[i], C[i + 1], C[i + 2]); if (q[0] >= 0 && q[0] <= L) { var k = Math.floor(q[0]); cnt[k] = (cnt[k] || 0) + 1; } }
  var A = Object.keys(cnt).map(function (k) { return cnt[k]; }).sort(function (p, q) { return p - q; });
  if (!A.length) return;
  var R = clamp(Math.sqrt(A[A.length >> 1] / Math.PI) + 0.25, 0.75, 8), add = [];
  var x0 = Math.floor(Math.min(a[0], b[0]) - R), x1 = Math.ceil(Math.max(a[0], b[0]) + R), y0 = Math.floor(Math.min(a[1], b[1]) - R), y1 = Math.ceil(Math.max(a[1], b[1]) + R), z0 = Math.floor(Math.min(a[2], b[2]) - R), z1 = Math.ceil(Math.max(a[2], b[2]) + R);
  for (var z = z0; z <= z1; z++) for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
    if (own.has(x + 2048 * (y + 2048 * z)) || !G.get(x, y, z)) continue;
    var w = tr(x, y, z); if (w[0] >= 0 && w[0] <= L && w[1] <= R) add.push(x, y, z);
  }
  if (!add.length) return;
  var N = new Int16Array(C.length + add.length); N.set(C); N.set(add, C.length);
  o.cells = N; o.tubeN = add.length / 3;
}
/** 傳動件開局的路數（照 need 封頂；每一種 need 記一次 ⇒ 道具設定改了「每格傳幾成」也對）。 */
function drvFlow0(T, s, need) { s.flow0 = s.flow0 || {}; if (s.flow0[need] === undefined) s.flow0[need] = s.cells ? drvFlow(T.hullG || T.base, s.cells, s.a, s.b, need) : 0; return s.flow0[need]; }
function drvD2(a, b) { var x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return x * x + y * y + z * z; }
function drvUp(n, n0) { return !(n0 > 0) || n * 2 >= n0; }               // 剩一半以上 ＝ 好的；開局就 0 格 ⇒ 量不出來、當作好的
/** 綁定（driveInit 呼叫；steam 輸出物件都建好之後）：每個輸出物件接哪根軸、每具主機推哪幾個輸出物件 ⇒ 每個輸出物件完好時分到的份量 w。 */
function drvBind(sh, outs) {
  var PT = drvParts(sh.T), C = { E: [], SH: [], B: [], fnOff: null };
  outs.forEach(function (o) {                                             // 軸：aft 離 hub（或 shaft-fwd）最近、24 格以內
    var at = o.m ? o.m.pts['shaft-fwd'] || o.p : o.p, best = -1, bd = 24 * 24;
    PT.SH.forEach(function (s, j) { var d = drvD2(s.aft, at); if (d < bd) { bd = d; best = j; } });
    o.shaft = best;
  });
  PT.SH.forEach(function (s) { C.SH.push({ s: s, ok: 1 }); });
  PT.B.forEach(function (b) { C.B.push({ b: b, ok: b.seats.map(function () { return 1; }), out: 1 }); });
  C.SP = PT.SP.map(function (p) { return { p: p, ok: 1 }; }); C.cells = PT.cells; C.steam = 1;
  if (PT.cells) PT.SH.concat(PT.SP).forEach(function (s) { drvFlow0(sh.T, s, drvNeed(s.kind)); });
  var W = PT.E.reduce(function (a, e) { return a + e.w; }, 0);
  PT.E.forEach(function (e) {
    var to = [];
    if (e.prop) outs.forEach(function (o, j) { if (o.m && (o.m.path === e.prop || o.m.name === e.prop)) to.push(j); });
    if (!to.length && PT.SH.length) {                                     // 接 fwd 離 core 最近的那根軸 ⇒ 那根軸上的輸出物件
      var bs = -1, bd = 1e18;
      PT.SH.forEach(function (s, j) { var d = drvD2(s.fwd, e.p); if (d < bd) { bd = d; bs = j; } });
      outs.forEach(function (o, j) { if (o.shaft === bs) to.push(j); });
    }
    if (!to.length) outs.forEach(function (o, j) { to.push(j); });
    C.E.push({ e: e, f: e.w / W, to: to, ok: 1 });
  });
  outs.forEach(function (o, j) {
    o.j = j;
    o.w = C.E.length ? C.E.reduce(function (a, c) { return a + (c.to.indexOf(j) >= 0 ? c.f / c.to.length : 0); }, 0) : 1 / outs.length;
    o.rpmMax = o.m && +o.m.meta.rpm_max > 0 ? +o.m.meta.rpm_max : DRV_RPM0; o.rpm = 0; o.ang = 0;
    if (o.m && !o.m.hang) { var mt = o.m.meta, ax = norm([+mt.axis_x || 0, +mt.axis_y || 0, +mt.axis_z || 0]); o.ax = len(ax) > 0.5 ? ax : [1, 0, 0]; }
  });
  return C;
}
/** 開戰時（makeShip 最後）：建動力源清單、水阻係數。 */
function driveInit(sh) {
  var T = sh.T, P = [], info = hullInfo(T.id) || {};
  sh.sails.forEach(function (s) { if (s.flag || !s.area) return; var c = sailCentroid(s); P.push({ kind: 'sail', s: s, p: c, w: 1, F: 0, Fy: 0, ok: 1 }); });
  var base = +sh.cfg.base || 0, oars = sh.models.filter(function (m) { return m.kind === 'oar' && m.pts.pivot; });
  var kind = base > 0 ? (oars.length ? 'oar' : info.drive === 'magic' ? 'magic' : 'steam') : null;   // 有槳 ⇒ 額外動力 ＝ 槳（TASK-0691）
  if (base > 0) {
    if (kind === 'oar') {                                                 // 每支槳一項：作用點 ＝ 槳座、份量 ＝ 槳手數 ÷ 全船槳手數
      var nr = oars.reduce(function (a, m) { return a + oarRowers(m); }, 0);
      oars.forEach(function (m) { P.push({ kind: 'oar', m: m, p: m.pts.pivot.slice(), w: oarRowers(m) / nr, F: 0, Fy: 0, ok: 1, rw0: oarRowers(m), rw: 0, alive0: true, out: m.name, sg: oarSide(sh, m) }); });
    } else if (kind === 'magic') P.push({ kind: 'magic', p: [T.cx, T.cy, T.zw], w: 1, F: 0, Fy: 0, ok: 1 });
    else {
      var props = sh.models.filter(function (m) { return m.meta && m.meta.kind === 'propeller'; });
      if (props.length) props.forEach(function (m) { var h = m.pts.hub || m.c; P.push({ kind: 'steam', m: m, p: h.slice(), w: 1 / props.length, F: 0, Fy: 0, ok: 1, out: m.name }); });
      else if (drvParts(T).SH.length) drvParts(T).SH.forEach(function (s, j, A) { P.push({ kind: 'steam', p: s.aft.slice(), w: 1 / A.length, F: 0, Fy: 0, ok: 1, n0: driveCount(T.hullG || T.base, s.aft), stern: true, out: s.name + '（螺旋槳是格子）' }); });   // 有軸、螺旋槳不是模型（拿破崙號）⇒ 推力在軸的 aft 端
      else { var sp = [T.wl0 + 4, T.cy, Math.max(2, T.zw - 15)]; P.push({ kind: 'steam', p: sp, w: 1, F: 0, Fy: 0, ok: 1, n0: driveCount(T.hullG || T.base, sp), stern: true, out: '船尾' }); }
    }
  }
  var magicE = base > 0 && info.drive === 'magic' && drvParts(T).E.length > 0;   // 魔法動力源有實體（TASK-0680，Tim 2026-10-17「直接讓管風琴等於動力源」：風暴角號船長室的管風琴標 kind=engine）⇒ 也走動力件那一條；沒標 ⇒ 照舊用整艘船殼
  var chain = base > 0 && kind !== 'oar' && (!(info.drive === 'magic') || magicE) ? drvBind(sh, P.filter(function (p) { return p.kind === (magicE ? 'magic' : 'steam'); })) : null;
  var sides = {}; P.forEach(function (p) { if (p.kind === 'sail' || p.kind === 'magic') return; var dy = p.p[1] - T.cy; p.sd = p.sg || (Math.abs(dy) > DRV_SIDE_MIN ? (dy > 0 ? 1 : -1) : 0); if (p.sd) sides[p.sd] = 1; });   // 哪一舷（差動轉向）
  var R = HELM_TQ ? helmItems(sh) : null; if (R) R.forEach(function (p) { P.push(p); });   // 操舵（TASK-0777）：舵也是動力清單的一項（見「操舵」那一段）
  sh.drive = { P: P, R: R, C: chain, kind: kind, oph: 0, ophS: [0, 0], dfk: 1, dfs: 0, dif: !!(sides[1] && sides[-1]), k: DRV_KD * Math.pow(Math.max(1, T.disp || 1), 2 / 3),
    L: Math.max(5, ((T.wl1 || T.hx1) - (T.wl0 || T.hx0)) * S), M: null, W: 0, cap: 1, Fx: 0, drag: 0, a: 0, tq: 0, om: 0, vT: 0, tqD: 0, dS: 0, dS1: 0, eff: 1 };
  sh.tele = TELE_FULL; sh.power = base > 0 ? TELE[sh.tele] : 0;
}
/** 艙內積水（噸）：粒子模式 ＝ fl.vol（還在算的時候）；其他（公式模式、斷了、開始沉）⇒ 照下沉量用浮力表換算（跟 floodPct 同一套）。 */
function shipWaterT(sh) {
  if (sh.fl && !sh.broken && !sh.sinkingFinal && !sh.sunk) return sh.fl.vol * RHO_W;
  if (!(sh.sink > 0) || !sh.T.hyd) return 0;
  var base = sh.T.disp - (sh.mass0 || shipT(sh)) + massLost(sh), L0 = liftFor(sh.T, base);
  return L0 === null ? 0 : Math.max(0, base - tonsAt(sh.T, L0 - sh.sink));
}
/** 每半秒（survey）：實際質量、每個額外動力源的完好度。 */
function driveSurvey(sh) {
  var D = sh.drive; if (!D) return;
  var m0 = sh.mass0 || shipT(sh);
  D.W = shipWaterT(sh); D.M = Math.max(1, m0 - massLost(sh) + D.W); if (D.M0 === undefined) D.M0 = D.M;   // M0：開戰時的質量（操舵的轉動慣量照它校準，TASK-0777）
  var F = funnelsOf(sh.T), fu = 1;                                          // ⛔ 不用 funnelUp：它的快取由 funnelSmoke 更新、慢動作時不跑 ⇒ 戰局會跟著顯示設定變（審查 2026-10-16）
  if (F.length) { var up = 0; F.forEach(function (f) { if (f.model ? sh.models.some(function (q) { return q.path === f.model && q.alive && !q.moved; }) : f.n0 > 0 && funnelCount(sh.grid, f.p) * 2 >= f.n0) up++; }); fu = up / F.length; }
  D.fu = fu;
  var C = D.C, bk = 1, G = sh.grid, cut = [];
  var chk = DRV_CHECK || D.kind === 'magic';                              // 魔法動力源有實體（TASK-0680：管風琴，打得到）⇒ 照常數；開關只管蒸汽那條鏈
  if (C && C.cells) { D.partN = (D.partN || 0) + 1; if (chk && D.partN % 2 === 1) drvPartsTick(sh, C, cut); bk = C.steam; }   // 動力件（TASK-0653）：每 1 秒（survey 每 0.5 秒、隔一次）；檢查關著 ⇒ 都當完好（DRV_CHECK）
  if (C && C.cells) C.fnOff = chk ? drvFunnelsOff(sh, C) : null;
  else if (C && chk) {                                                          // 動力的那一條鏈：主機、軸、鍋爐（沒標 ⇒ 都是空的、這一段什麼都不改）
    C.E.forEach(function (c) { var u = drvUp(drvCount(G, c.e.p), c.e.n0) ? 1 : 0; if (c.ok && !u) cut.push('主機'); c.ok = u; });
    C.SH.forEach(function (c) { var u = drvUp(drvCount(G, c.s.aft), c.s.n0[0]) && drvUp(drvCount(G, c.s.fwd), c.s.n0[1]) ? 1 : 0; if (c.ok && !u) cut.push('螺旋槳軸'); c.ok = u; });
    var on = 0, all = 0;
    C.B.forEach(function (c) { c.b.seats.forEach(function (p, j) { var u = drvUp(drvCount(G, p), c.b.n0[j]) ? 1 : 0; if (c.ok[j] && !u) cut.push('鍋爐'); c.ok[j] = u; on += u; all++; }); });
    if (all) bk = on / all;
    var F = funnelsOf(sh.T), eAll = C.E.length > 0 && !C.E.some(function (c) { return c.ok; });
    C.fnOff = F.length && (eAll || C.B.length) ? F.map(function (f) {    // 主機全壞 ⇒ 每根停煙；通這根煙囪的鍋爐全壞 ⇒ 這根停煙
      if (eAll) return true;
      var B2 = C.B.filter(function (c) { return c.b.funnel === f.name; });
      return B2.length > 0 && !B2.some(function (c) { return c.ok.some(function (u) { return u; }); });
    }) : null;
  }
  var rw = D.kind === 'oar' ? oarManned(sh) : null;
  D.P.forEach(function (p) {
    if (p.kind === 'rudder' && !p.m && p.n0 > 0) p.ro = drvUp(driveCount(sh.grid, p.p), p.n0) ? 1 : 0;   // 看不見的舵：船尾那一塊格子剩一半以上 ＝ 還在
    if (p.kind === 'sail' || p.kind === 'rudder') return;                // 舵的鏈每一步算（helmEff）
    p.chain = drvLinks(sh, p, C, bk, rw, cut);
    var v = drvChain(p.chain);
    p.ok = p.kind === 'magic' ? clamp(v, 0, 1) : p.kind === 'steam' ? v * (0.5 + 0.5 * fu) : v;   // 蒸汽：煙囪（排煙）照舊乘在整條鏈上
  });
  if (cut.length && !sh.sunk && D.kind === 'magic' && C) note(sh, C.E.map(function (c) { return c.e.name; }).join('、') + '被打壞了 ⇒ 魔力只剩 ' + Math.round(clamp(D.P.reduce(function (a, p) { return a + (p.kind === 'magic' ? p.ok : 0); }, 0), 0, 1) * 100) + '%');
  if (cut.length && !sh.sunk && D.kind === 'oar') note(sh, '槳被打斷了 ⇒ 划槳只剩 ' + Math.round(clamp(D.P.reduce(function (a, p) { return a + (p.kind === 'oar' ? p.w * p.ok : 0); }, 0), 0, 1) * 100) + '%');
  if (cut.length && !sh.sunk && D.kind === 'steam') note(sh, cut.filter(function (v, j) { return cut.indexOf(v) === j; }).join('、') + '被打壞了 ⇒ 額外動力只剩 ' + Math.round(clamp(D.P.reduce(function (a, p) { return a + (p.kind === 'steam' ? p.w * p.ok : 0); }, 0), 0, 1) * 100) + '%');
}
/** 傳輸鏈（TASK-0691；見檔頭）：從輸出那一節往回算 ⇒ 每一節出的力乘上它後面每一節的完好度 ＝ (((第一節出力) × 第二節完好 ＋ 第二節出力) × …)。 */
function drvChain(L) { var acc = 0, R = 1; for (var i = L.length - 1; i >= 0; i--) { acc += L[i].out * R; R *= L[i].ok; } return acc; }
/** 一個額外動力項的鏈（每半秒，driveSurvey）：[{ name, ok, out }]，第一節在前、輸出在最後；壞掉的那一刻記進 cut（廣播）。
 *  rw：每支槳現在幾個槳手在崗（oarManned）；bk：全船的蒸汽（動力件、或舊判法的鍋爐座數比）。 */
function drvLinks(sh, p, C, bk, rw, cut) {
  if (p.kind === 'magic') {                                             // 一節：有實體的魔法動力源（kind=engine，例：管風琴）照那幾件的完好度（同主機的曲線）；沒有 ⇒ 船殼還剩幾成
    if (C && C.E.length) { var gm = 0; C.E.forEach(function (c) { if (c.ok && c.to.indexOf(p.j) >= 0) gm += c.f / c.to.length * c.ok; }); return [{ name: C.E.map(function (c) { return c.e.name; }).join('、'), ok: 1, out: p.w > 0 ? gm / p.w : 0 }]; }
    return [{ name: '船殼', ok: 1, out: clamp(sh.grid.count / (sh.orig || 1), 0, 1) }];
  }
  if (p.kind === 'oar') {                                               // 一節 ＝ 整條鏈：槳還在 × 槳手到崗比例
    var m = p.m, up = m.alive && !m.moved;
    if (p.alive0 && !up) cut.push('槳'); p.alive0 = up;
    p.rw = rw ? rw.get(m) || 0 : 0;
    return [{ name: m.name, ok: up ? 1 : 0, out: up ? Math.min(1, p.rw / p.rw0) : 0 }];
  }
  var alive = p.m ? p.m.alive && !p.m.moved : true;                     // 蒸汽：鍋爐 ⇒ 主機 ⇒ 軸 ⇒ 螺旋槳（船尾）
  var own = p.m ? (alive ? 1 : 0) : p.n0 ? clamp(driveCount(sh.grid, p.p) / p.n0, 0, 1) : 1;
  if (alive && p.m && p.m.vox) { p.left = propLeft(p.m.vox); own *= drvCurve('propeller', p.left); if (own <= 0) alive = false; }   // 螺旋槳有自己的格（TASK-0653 第二段）：推力照剩幾成套曲線（葉片打光 ⇒ 0）
  if (p.m && p.alive0 !== undefined && p.alive0 && !alive) cut.push('螺旋槳');
  p.alive0 = alive;
  var L = [{ name: '鍋爐', ok: 1, out: C ? bk : 1 }];
  if (C && C.E.length) {                                                // 這個輸出物件收得到幾成：推它的每具主機（還在、軸沒斷）的份量 ÷ 完好時的份量
    var got = 0;
    C.E.forEach(function (c) { if (c.ok && c.to.indexOf(p.j) >= 0) got += c.f / c.to.length * c.ok; });   // c.ok：0／1（舊判法）或 0…1（動力件的曲線）
    L.push({ name: '主機', ok: p.w > 0 ? got / p.w : 0, out: 0 });
  }
  if (C && p.shaft >= 0 && C.SH[p.shaft]) L.push({ name: C.SH[p.shaft].s.name, ok: C.SH[p.shaft].ok || 0, out: 0 });   // 軸：0／1（舊判法）或 0…1（傳得到幾成）
  L.push({ name: p.out || '輸出', ok: own, out: 0 });
  return L;
}
/** 槳手數（meta rowers，至少 1）。 */
function oarRowers(m) { return Math.max(1, Math.round(+(m.meta || {}).rowers || 1)); }
/** 槳在哪一舷（+1 右舷 S ＝ 格 +y、−1 左舷 P）：meta side，沒寫 ⇒ 照槳座在中線哪一邊。 */
function oarSide(sh, m) { var sd = String((m.meta || {}).side || '').toUpperCase(); return sd === 'S' ? 1 : sd === 'P' ? -1 : m.pts.pivot[1] >= sh.T.cy ? 1 : -1; }
/** 每支槳現在幾個槳手在崗（還能動、不在走路；40_crew.js 槳手 c.oar ＝ 那支槳的模型）。 */
function oarManned(sh) { var M = new Map(); sh.crew.forEach(function (c) { if (c.role === ROLE.OAR && crewAble(c) && !c.walk && c.oar) M.set(c.oar, (M.get(c.oar) || 0) + 1); }); return M; }
/** 划槳（畫面；driveStep 每一步）：每一舷一個相位 D.ophS（[左舷, 右舷]；D.oph ＝ 右舷，舊的讀法），槳頻 ∝ 俥鐘（倒划反著走）；φ 0…0.5 槳葉在水裡往後掃（出力）、0.5…1 抬出水往前回槳。
 *  差動轉向（Tim 2026-10-18「轉彎時 一側的槳是否可以反向划」）：內側那一舷的槳頻再 × D.dfk（推力的同一個倍率）⇒ 舵打一半內側停槳、打滿內側倒划（槳反著掃）。
 *  每支槳：繞槳座直立軸掃 ±stroke_deg（右舷照 +、左舷照 −，槳葉往船尾 ＝ 出力）、繞沿船身的軸抬 dip_deg ⇒ m.swM（modelLocal 照它畫）；沒人划、斷了 ⇒ 平放不動。 */
function oarAnim(sh, D, dt) {
  var r0 = (sh.sunk || sh.struck ? 0 : (sh.power || 0)) * OAR_SPM / 60 * dt;
  if (HELM_TQ && D.sideF) r0 = sh.sunk || sh.struck ? 0 : OAR_SPM / 60 * dt;   // 操舵（TASK-0777）：每一舷照自己那一份推力划（推力 ∝ 槳頻² ⇒ 槳頻 ＝ ±√推力）⇒ 停俥打舵也看得到一舷前划、一舷倒划
  [-1, 1].forEach(function (sd, j) { var f = HELM_TQ && D.sideF ? Math.sign(D.sideF[j]) * Math.sqrt(Math.abs(D.sideF[j])) : sd === D.dfs ? D.dfk : 1; D.ophS[j] += r0 * f; D.ophS[j] -= Math.floor(D.ophS[j]); });
  D.oph = D.ophS[1];
  D.P.forEach(function (p) {
    if (p.kind !== 'oar') return;
    var m = p.m, t = 2 * Math.PI * D.ophS[p.sg > 0 ? 1 : 0]; m.oph = D.ophS[p.sg > 0 ? 1 : 0];
    if (!m.alive || m.moved || !(p.ok > 0)) { m.swM = null; return; }
    var mt = m.meta || {}, A = (+mt.stroke_deg > 0 ? +mt.stroke_deg : 30) / 57.2958, Lf = (+mt.dip_deg > 0 ? +mt.dip_deg : 12) / 57.2958;
    var th = -p.sg * A * Math.cos(t), al = p.sg * Lf * Math.max(0, -Math.sin(t));
    m.spv = m.pts.pivot; m.swM = M4.mul(rotM([0, 0, 1], th), rotM([1, 0, 0], al));
  });
}
/** 動力件（每 1 秒；見檔頭「動力件」）：主機、鍋爐照剩幾成＋曲線、鍋爐泡水、軸與蒸汽管照傳得到幾成 ⇒ C.E[].ok、C.B[].out／ok、C.SH[].ok、C.SP[].ok、C.steam；壞掉的那一刻記進 cut（廣播）。 */
function drvPartsTick(sh, C, cut) {
  var G = sh.grid;
  C.E.forEach(function (c) { var e = c.e, r = e.cells && e.c0 ? drvLeft(G, e.cells) / e.c0 : null, u = e.cells ? drvCurve('engine', r === null ? 1 : r) : (drvUp(drvCount(G, e.p), e.n0) ? 1 : 0); if (c.ok > 0 && u <= 0) cut.push('主機'); c.ok = u; c.r = r; });
  C.SH.forEach(function (c) { var s = c.s, u = s.cells ? drvTrans(G, s, 'shaft', c) : (drvUp(drvCount(G, s.aft), s.n0[0]) && drvUp(drvCount(G, s.fwd), s.n0[1]) ? 1 : 0); if (c.ok > 0 && u <= 0) cut.push('螺旋槳軸'); c.ok = u; });
  C.SP.forEach(function (c) { var u = c.p.cells ? drvTrans(G, c.p, 'steampipe', c) : 1; if (c.ok > 0 && u <= 0) cut.push('蒸汽管'); c.ok = u; });
  var num = 0, den = 0, wetIn = +DRVP.boiler.wet > 0 ? +DRVP.boiler.wet : 0;
  C.B.forEach(function (c, gi) {
    var b = c.b, r = b.cells && b.c0 ? drvLeft(G, b.cells) / b.c0 : null, out = b.cells ? drvCurve('boiler', r === null ? 1 : r) : 1, wet = 0;
    b.seats.forEach(function (p, j) {
      var w = wetIn > 0 && wetAt(sh, p, { sea: false, inner: wetIn }), up = b.cells ? out > 0 : drvUp(drvCount(G, p), b.n0[j]);
      if (w) wet++;
      var u = up && !w ? 1 : 0; if (c.ok[j] && !u) cut.push(w ? '鍋爐（淹水熄火）' : '鍋爐'); c.ok[j] = u;
    });
    var dry = c.ok.reduce(function (a, u) { return a + u; }, 0) / b.seats.length;
    var pipe = C.SP.filter(function (q) { return q.p.boiler === gi; }), link = pipe.length ? Math.min(1, pipe.reduce(function (a, q) { return a + q.ok; }, 0)) : 1;
    c.r = r; c.wet = wet; c.link = link; c.out = (b.cells ? out : 1) * dry;
    num += b.seats.length * c.out * link; den += b.seats.length;
  });
  C.steam = den ? num / den : 1;
}
/** 煙囪停煙（動力件那一條）：主機全壞 ⇒ 每根停；通這根煙囪的鍋爐組全部沒蒸汽 ⇒ 這根停（同舊判法）。 */
function drvFunnelsOff(sh, C) {
  var F = funnelsOf(sh.T), eAll = C.E.length > 0 && !C.E.some(function (c) { return c.ok > 0; });
  return F.length && (eAll || C.B.length) ? F.map(function (f) { if (eAll) return true; var B2 = C.B.filter(function (c) { return c.b.funnel === f.name; }); return B2.length > 0 && !B2.some(function (c) { return c.out > 0; }); }) : null;
}
/** 俥鐘撥一格（d：−1 往前、+1 往後；E／T、點俥鐘）。 */
function teleStep(sh, d) { if (!sh || !(sh.cfg.base > 0)) return; teleSet(sh, sh.tele + d); }
function teleSet(sh, i) {
  if (!sh || !(sh.cfg.base > 0)) return;
  i = clamp(Math.round(i), 0, TELE.length - 1); sh.teleHand = true; if (i === sh.tele) return;   // teleHand：玩家自己撥了俥鐘 ⇒ 自動駕駛不再替他撥（54_helm.js helmGovern 自己撥時會還原）
  sh.tele = i; sh.power = TELE[i]; sh.teleT = performance.now();
  var D = sh.drive, cap = D ? D.cap : 1;
  note(sh, '俥鐘：' + TELE_NAME[i] + (cap < 0.98 && Math.abs(TELE[i]) > Math.sqrt(cap) + 0.005 ? '（' + (D.kind === 'magic' ? '魔力' : D.kind === 'oar' ? '划槳' : '引擎') + '只剩 ' + Math.round(cap * 100) + '% 推力）' : ''));
}
/** 每一步（sail() 裡，算完舊公式的「單獨推動時的航速」之後）：推力、水阻、加速度 ⇒ sh.spd；力矩記在 D.tq（轉向率在 driveYaw，舵算完才知道 rmax）。
 *  vS：帆在這一段、全部完好時的航速（舊公式 target ÷ sailFrac 的那一份；0 ＝ 帆不出力）；vB：額外動力全速的航速（m/s；0 ＝ 沒有或不出力）；
 *  brake：錨咬著、拋錨 ⇒ 6 秒內停。 */
/** 帆的推力照視風（TASK-0639；Tim 2026-10-16：「帆提供的速度要考慮到船目前的相對速度(不能跑的比風速快)」→「加成是讓帆的推力加成(但推力應該是相對於風速的)」「推力改成照船上感受到的風（視風）算」）：
 *  帆推力的倍率 0…1（乘在 k·v² 上；v ＝ 帆單獨推得到的航速，航速倍率照舊乘在裡面 ＝ 推力的加成）。
 *  視風 A ＝ 真風（羅盤上的風速 Vw ＝ windKnots ÷ 1.944，往風吹去的方向）− 船速（往船頭）；α ＝ 視風從哪裡來、離船頭幾度（0 ＝ 正頂風、180 ＝ 正後方）。
 *  倍率 ＝ (|A|／|A₀|)² × 吃得到風(α)／吃得到風(α₀)，夾在 0…1 ——
 *    · A₀ ＝ 航速倍率 ＝ 船隻設定預設（LIM.speed，1.5）的船、在這個風向用帆單獨跑到的航速（sh.vS1，31_sailing.js）時的視風 ⇒ 預設設定的船（寫實玩法）跑到那個航速時倍率剛好 1（航速不變）；
 *      比預設快的加成（娛樂 ×1.4、夜隼號的 3）才被視風限住（Tim 2026-10-16）。
 *    · 吃得到風：視風從船頭 50° 以內來 ⇒ 0（帆桁最多轉 40°，30_rig_physics.js BRACE_MAX ⇒ 帆被吹回來）、75° 以外 ⇒ 1，中間平滑。
 *  ⇒ 航速倍率高的船越跑越快 ⇒ 視風往船頭轉、順風時視風變小 ⇒ 推力掉 ⇒ 停在帆還吃得到風的航速；跑不贏風（帆看起來不會被反吹）。
 *  基準點自己就吃不到風（往風裡開、POLAR 照舊給 0.25 的那一段；逆風性能 upwind 高的船更常落在這裡）⇒ 照舊，只是船速比基準快之後推力照 ((Vw − 船速)／(Vw − 基準))² 掉、追上風速 ⇒ 0：
 *    頂風怎麼走照舊由頂風失速管，但光靠帆跑不贏風（⛔ 只照舊 ⇒ 夜隼號（逆風 ×3）離正頂風 60° 光靠帆 20.7 節、風 17.5 節）。
 *  ⛔ 341bfec 只限「沿風那一份」⇒ 夜隼號（航速 ×3、娛樂 ×1.4）橫風、側順風光靠帆比風快，視風從船頭來、帆被反吹。 */
var SAIL_AW0 = 50, SAIL_AW1 = 75;                                       // 視風離船頭幾度開始吃得到風、幾度吃滿（度）
function sailCatch(a) { var t = clamp((a - SAIL_AW0) / (SAIL_AW1 - SAIL_AW0), 0, 1); return t * t * (3 - 2 * t); }
function apparent(Vw, deg, v) { var r = deg / 57.2958, ax = Vw * Math.cos(r) - v, ay = Vw * Math.sin(r), l = Math.hypot(ax, ay); return [l, l > 1e-6 ? Math.acos(clamp(-ax / l, -1, 1)) * 57.2958 : 0]; }   // [視風大小, 從離船頭幾度來]
function sailWindK(sh, v, deg) { return sailWindKAt(windKnots() / 1.944, deg, sh.spd, sh.vS1 || 0); }
/** 同上、不靠船：真風 Vw（m/s）、船頭跟風吹去的方向夾 deg、船速 s、視風基準 v1（sh.vS1）。 */
function sailWindKAt(Vw, deg, s, v1) {
  if (!(Vw > 0)) return 0;
  var R = apparent(Vw, deg, v1), c0 = sailCatch(R[1]);
  if (c0 < 0.02 || R[0] < 1e-3) { if (s <= v1 || Vw - v1 < 0.1) return s < Vw ? 1 : 0; var r = (Vw - s) / (Vw - v1); return clamp(r * r, 0, 1) * (s < Vw ? 1 : 0); }
  var A = apparent(Vw, deg, s), q = A[0] / R[0];
  return clamp(q * q * sailCatch(A[1]) / c0, 0, 1);
}
/** 穩定航速（m/s）：driveStep 的 vT 在帆全張、完好、俥鐘全速時停在哪 —— k·v² ＝ k·vS²·sailWindKAt(v) ＋ k·vB²，照 v 二分（右邊隨 v 變小）。
 *  Blocksail 地球儀的海圖模式照它算的表開（72_shippick.js spkChart；TASK-0803）⇒ 推進的公式只住這裡，改了地球儀跟著對。 */
function driveSteady(vS, vB, deg, Vw, v1) {
  var lo = 0, hi = Math.hypot(vS, vB);
  for (var i = 0; i < 40; i++) { var v = (lo + hi) / 2; if (vS * vS * sailWindKAt(Vw, deg, v, v1) + vB * vB > v * v) lo = v; else hi = v; }
  return (lo + hi) / 2;
}
function driveStep(sh, dt, vS, vB, deg, brake) {
  var D = sh.drive; if (!D) return;
  if (D.M === null) driveSurvey(sh);
  var k = D.k, P = D.P, i, p;
  // 帆：總推力 ＝ k·(vS × sailFrac)²（跟舊公式同一個最高航速），照每面「面積 × 血量」分給每一面；側向力往下風
  var lee = 0;
  if (vS > 0) { var Wl = M4.dir(sh.inv, WIND[0], 0, WIND[2]); lee = Wl[1] > 0 ? 1 : Wl[1] < 0 ? -1 : 0; }   // 風吹去的方向在格 +y（右舷）⇒ 下風在右舷
  var sideK = DRV_SIDE * Math.abs(Math.sin(deg / 57.2958)), sumA = 0, sumOn = 0, rx = 0, ry = 0, ra = 0;
  for (i = 0; i < P.length; i++) {
    p = P[i]; if (p.kind !== 'sail') continue;
    var s = p.s, on = !s.dead && !s.furled, inSet = setHas(s, sh.sailSet);
    p.ok = s.dead ? 0 : s.hp / s.hpMax;
    p.on = on; p.wA = on ? s.area * s.hp / s.hpMax : 0; sumOn += p.wA;
    if (inSet) { rx += s.area * p.p[0]; ry += s.area * p.p[1]; ra += s.area; }   // 完好時這一段帆的中心（平衡點）
    sumA += s.area;
  }
  var frac = sumA > 0 ? sumOn / sh.sailArea0 : 0, Fs = vS > 0 ? k * (vS * frac) * (vS * frac) * sailWindK(sh, vS * frac, deg) : 0, Fx = 0, Tq = 0, Fabs = 0;   // sailWindK：船跑得比風快 ⇒ 帆不推（TASK-0639）
  if (ra > 0) { rx /= ra; ry /= ra; }
  for (i = 0; i < P.length; i++) {
    p = P[i]; if (p.kind !== 'sail') continue;
    p.F = sumOn > 0 ? Fs * p.wA / sumOn : 0; p.Fy = p.F * sideK * lee;
    Fx += p.F; Fabs += p.F;
    Tq += (p.p[0] - rx) * S * p.Fy - (p.p[1] - ry) * S * p.F;            // 船頭往右舷轉的力矩（kN·m）：前面往右推、或右舷那一邊往前推 ⇒ 正（格座標是左手系，照這個寫）
  }
  // 額外動力：俥鐘要的推力（比例² × 全推力），完好度合起來是上限；照每個動力源的「份數 × 完好度」分
  var cap = 0, eq = 0, ex = 0, ey = 0, ew = 0;
  for (i = 0; i < P.length; i++) { p = P[i]; if (p.kind === 'sail' || p.kind === 'rudder') continue; cap += p.w * p.ok; ex += p.w * p.p[0]; ey += p.w * p.p[1]; ew += p.w; }
  D.cap = cap;
  if (ew > 0) { ex /= ew; ey /= ew; }
  var r = sh.power || 0, want = r * Math.abs(r), give = vB > 0 ? Math.sign(want) * Math.min(Math.abs(want), cap) : 0, Fe = give * k * vB * vB;
  if (HELM_TQ) Tq += helmDiffStep(sh, D, P, give, cap, k * vB * vB, ey, vB > 0);   // 操舵（TASK-0777）：差動照舵令、停俥倒車也作用；兩舷不平衡的那一份另記在 D.tqD（見「操舵」）
  else {
  var dif = D.dif && DRV_DIFF && give > 0 ? clamp(sh.rudder || 0, -1, 1) : 0;
  D.dfk = dif ? clamp(1 - 2 * Math.abs(dif), -0.5, 1) : 1; D.dfs = dif > 0 ? -1 : dif < 0 ? 1 : 0;   // 內側那一舷（−1 左舷、+1 右舷）出幾成 ⇒ 划槳的畫面照它（oarAnim）
  for (i = 0; i < P.length; i++) {
    p = P[i]; if (p.kind === 'sail') continue;
    p.F = cap > 0 ? Fe * p.w * p.ok / cap : 0; p.Fy = 0;
    if (dif && p.sd * dif < 0) p.F *= D.dfk;                            // 差動轉向：內側那一舷減出力、打滿倒車（見檔頭）
    Fx += p.F; Fabs += Math.abs(p.F);
    Tq -= (p.p[1] - ey) * S * p.F;
  }
  }
  if (HELM_TQ) for (i = 0; i < P.length; i++) { p = P[i]; if (p.kind === 'sail' || p.kind === 'rudder') continue; Fx += p.F; Fabs += Math.abs(p.F); }
  if (sh.navF !== undefined) Fx *= sh.navF;                             // 航海士（TASK-0825，39_duty.js）：推力 ×(1 ＋ 航速 %)² ⇒ 最高航速 ×(1 ＋ 航速 %)；沒有動力 ⇒ 0 × 倍數 ＝ 0（不憑空生出動力）。沒有航海士的船 ⇒ 不乘
  D.Fx = Fx; D.give = give; D.want = want;
  var Ff = k * vB * vB;                                                   // 螺旋槳轉速（畫面）：自己那一份推力 ÷ 完好時全速分到的推力 ⇒ √ ⇒ × rpm_max
  for (i = 0; i < P.length; i++) {
    p = P[i]; if (!p.ax || !p.m) continue;
    var live = p.m.alive && !p.m.moved, tr = live && Ff > 0 && p.w > 0 ? p.F / (Ff * p.w) : 0;
    p.rpm += ((tr >= 0 ? 1 : -1) * Math.sqrt(Math.abs(tr)) * p.rpmMax - p.rpm) * Math.min(1, dt / DRV_SPIN_T);
    if (!live) continue;
    p.ang += p.rpm * dt * Math.PI / 30; if (p.ang > Math.PI) p.ang -= 2 * Math.PI; else if (p.ang < -Math.PI) p.ang += 2 * Math.PI;
    if (!p.m.spinB) { p.m.spv = p.m.pts.hub || p.p; p.m.sax = p.ax; p.m.sw = p.ang; }   // 螺旋槳寫了 meta spin ⇒ 照 26_spin.js 轉（TASK-0640）。modelLocal 的「繞 spv、沿 sax 轉 sw」（小艇擺動那一套；21_gunnery.js）
  }
  if (D.kind === 'oar' && OAR_ANIM) oarAnim(sh, D, dt);                 // 划槳（只是畫面）
  if (VX) { var Fg = D.M * vxSlopeAcc(sh); if (Fg < 0 && Fx > 0 && Math.hypot(sh.px, sh.pz) >= VX.trap) Fg = Math.max(Fg, -VX_UPHILL * Fx); Fx += Fg; }   // 大漩渦的下坡加速（08_sea.js）：重力沿著船頭的那一份當成推力（t × m/s² ＝ kN）；
  //   眼外（逃不掉的範圍 ＝ 眼）上坡最多吃掉 VX_UPHILL 的推力（Tim：「讓真的不可逃逸範圍只有中心一小圈」⛔ 不夾 ⇒ 深 250 m 時 r 164 m 往外斜 60° 終端 −11.3 節，快沉了也爬不出去）
  var vT = Fx >= 0 ? Math.sqrt(Fx / k) : -Math.sqrt(-Fx / k); D.vT = vT;   // 只靠這些推力最後會到的航速
  if (sh.spd0) { sh.spd = vT; sh.spd0 = false; }                          // 開局就在走
  var M = D.M * (DRV_INERTIA || 1);
  if (brake) { sh.spd += (0 - sh.spd) * Math.min(1, dt / 6); D.a = 0; }     // 錨咬著、拋錨 ⇒ 照舊 6 秒內停下
  else if ((sh.throttle || 1) < 1 && sh.spd > vT && !(deg > 180 - NOGO_DEG)) { sh.spd += (vT - sh.spd) * Math.min(1, dt / 6); D.a = 0; }   // 電腦放慢（讓砲線、戰列等後面的）⇒ 轉帆擋風，6 秒內收到該有的航速
  //   船頭在頂風扇區（離正頂風 NOGO_DEG 以內）不算：帆吃不到風、vT 掉到 0 ⇒ 照水阻滑行（⛔ 也 6 秒剎住 ⇒ 排頭讓船讓進頂風，4.2 節 6 秒剎到 0.4 節：量過）。
  //   ⛔ 改成「只剎油門放掉的那一段（spd ≤ vT／油門）」⇒ 順風開局 12 節的排頭變成滑行、慢不下來等後面的，順風那一方的戰列散掉（0.6／11／27 m → 22／138／186 m：量過）
  else {
    D.drag = k * sh.spd * Math.abs(sh.spd);
    D.a = (Fx - D.drag) / M;
    var nv = sh.spd + D.a * dt;
    if ((sh.spd - vT) * (nv - vT) < 0) nv = vT;                             // 不衝過頭（Euler 一步越過平衡點 ⇒ 停在平衡點）
    sh.spd = nv;
  }
  D.tq = Tq; D.Fabs = Fabs; D.brake = brake;
}
/** 力矩 ⇒ 轉向率（rad/s，加在舵給的轉向率上）：吃掉幾成舵效 ＝ 力矩 ÷ (總推力 × 水線長／4)，夾 ±1.5，× 最大轉向率 × 細節設定「帆的力矩」。
 *  yaw 變大 ＝ 船頭往左舷 ⇒ 往右舷轉的力矩取負。錨咬著、拋錨、沉了 ⇒ 0。 */
function driveYaw(sh, rmax) {
  var D = sh.drive; if (!D) return 0;
  var ref = (D.Fabs || 0) * D.L / 4, om = ref > 1e-6 && !D.brake && !sh.sunk ? -clamp(D.tq / ref, -1.5, 1.5) * rmax * DRV_TQ : 0;
  D.om = om;
  return om;
}
// ───────────────────────── 操舵（TASK-0777；Tim 2026-10-21：「請不用要rudder判斷 應該要靠meta」「這邊的規則可以規範化 參考動力元件(甚至整合成一套系統)」
//   「希望跟動力系統整合 把轉向當成一種力(力矩) 且動力系統有左右來源時(兩邊的槳) 本身也會提供轉向力矩」） ─────────────────────────
// 舵是動力清單的一項（sh.drive.P 裡 kind 'rudder'，也收在 D.R）：每支舵（模型 kind=rudder）一項，作用點 ＝ 舵頭 stock-top；沒有舵模型 ⇒ 一支看不見的舵在船尾中線（完好度照船尾那一塊格子，同蒸汽的退路）。
//   份量 ＝ meta helm_share（沒寫 ⇒ 平分）⇒ 兩支舵（槳帆船）壞一支只掉一半（Tim：「有的船有兩個舵(獎帆船) 損失性能就用總數去算」）。
//   鏈（drvChain，同動力）：舵令（出力 1）⇒ 舵輪／舵柄（模型 kind=wheel／tiller；meta rudder ＝ 舵的名字 ⇒ 只接那一支，沒寫 ⇒ 接每一支；
//     中間節：模型 meta steer（舵索、導索器）⇒ 跟操作端算同一節：操作端或中間節壞了 ⇒ 這一節剩 1 − 舵輪的損失）⇒ 舵（還在 1、打掉 1 − 舵的損失）。
//   損失（Tim：「歷史損失40% 娛樂多一個乘數 預設損失是歷史的一半(20%)」「舵被打掉…寫實損失 100%，娛樂另外乘一個數(50%)」「舵輪影響的是舵的性能(因此是乘算)」）：
//     舵輪 WHEEL_LOSS（寫實 40%）、舵 RUDDER_LOSS（寫實 100%），娛樂再 × FUN.helmloss（0.5）⇒ 預設：舵輪沒了剩 80%、舵沒了剩 50%、兩樣都沒了 0.8 × 0.5 ＝ 40%。
//     舵效（sh.drive.eff，羅盤上方 ☸）＝ Σ 份量 × 鏈 × 娛樂加成「舵效」FUN.helmeff（Tim：「娛樂模式可以有舵效加乘(參考原本的轉彎性能加乘)」；預設 ×1）；
//     乘在舵給的轉向率上，不影響差動（差動照舵令，不經過舵輪）。沒有舵輪模型的船（舵柄畫在舵上）⇒ 鏈上沒有那一節。
// 轉向 ＝ 力矩 ÷ 阻尼，加上轉動慣量（Tim：1「轉動慣量」）：
//   轉動慣量 I ＝ 實際質量 M（含進水、扣掉打掉的；driveSurvey）×（迴轉半徑 drive.gyr × 水線長）²（預設 0.25 L）。
//   阻尼 N（kN·m 每 rad/s）＝ 開戰時的 I ÷（2 × 細節設定「迴轉慣性」）⇒ 完好、沒進水時反應時間 I／N 跟以前一樣（2 秒）；進水變重 ⇒ 反應慢、打掉變輕 ⇒ 反應快。
//   力矩（yaw 變大 ＝ 船頭往左舷為正）：
//     · 舵 ＝ N × 舵角 × 最大轉向率 × 舵效 ⇒ 穩定的轉向率跟以前一模一樣（低速舵效 RUD_LOW 照留：Tim 2「要 確保遊戲性」；舵效 0 ⇒ 連它也沒了）；
//     · 帆的不平衡、兩舷推力的不平衡（受損）＝ N × 比例 × 舵的最大轉向率（完好）× 細節設定「帆的力矩」；比例 ＝ D.tq（kN·m，driveStep）÷（總推力 × 水線長／4），夾 ±1.5（跟以前 driveYaw 同一把尺）。
//       ⛔ 照力矩 ÷ N 直接算：憲法號前桅的帆全被打掉，偏轉從 5.2°/s（25 秒 62°）掉到 0.3°/s（30 秒 6°）—— 遊戲的舵效比真船快，N 照它校準 ⇒ 物理力矩除下去太小（量過）。
//     · 差動 ＝ N × 比例 × DIFF_K × 舵的最大轉向率（完好、同一個航速）：每型換算成舵的幾成（Tim 2026-10-21 選「每型換算成舵的幾成」；「獎帆船可以單純靠動力轉彎(其他有左右側動力的船都可以)」）。
//       比例 ＝ 兩舷推力差的力矩 D.tqD ÷ 完好、全速前進、打滿時的那個力矩（物理只管方向與受損：一舷槳斷、槳手倒下、划得慢 ⇒ 變小）；DIFF_K ＝ 細節設定「差動的力矩」（寫實預設 0.5 ⇒ 打滿 ＝ 舵的一半）× 娛樂加成「差動」FUN.diff（1.2 ⇒ 0.6）。
//       Tim：「讓舵效跟之前的接近或好一點」「歷史模式可以貼近歷史 娛樂模式加上buff維持手感」⇒ 娛樂 0.6：五型（槳、明輪）划槳打滿都 ≥ 改之前（0.5 時 punt 慢 6%，量過）。
//       ⛔ 照力矩 ÷ N 直接算（第一版）：轉動慣量 ∝ 質量 × 長²，大加雷 reale 舵沒了只剩 0.6°/s、蘇士奎哈納號 0.2°/s，持火號 dromon 卻比舵還快（量過）。
//   ⇒ 轉向率每一步往 Σ力矩 ÷ N 追，時間常數 I ÷ N（舊的「轉向率追舵」換成這個；錨咬著繞錨原地轉照舊）。
// 差動（照舵令 u ＝ 舵角 ×（倒退 −1）＝ 要往哪邊轉；Tim 3「要」：停俥、倒車也作用）：兩舷都有輸出的船（D.dif），每一舷的推力（全速的幾成，有號）：
//   往前 ≥ DIFF_P0 ⇒ 內側 × (1 − 2|u|)，夾 −0.5（跟以前一樣）；倒車 ≤ −DIFF_P0 ⇒ 另一舷（倒車時往後推的那一舷減）× 同一個倍率；
//   中間（停俥）⇒ 內側 − |u| × DIFF_P0、外側 ＋ |u| × DIFF_P0（一舷倒划一舷前划 ⇒ 原地轉；DIFF_P0 ＝ 0.5 ⇒ 打滿是全速打滿的 2/3）。兩段在 ±DIFF_P0 接得上（力矩一樣、只有合力跳）。
//   力臂：槳照槳葉 blade（水推的是槳葉；四型量過槳葉離中線是槳座的 2.6 倍），螺旋槳照轉軸中心。倒退要往後超過 HELM_REV 才算（helmRev）。
// 電腦（31_sailing.js）：要的轉向率夾在「舵 ＋ 差動打滿」的轉向率以內，舵角 ＝ 要的 ÷ 那個上限 ⇒ 舵沒了照樣靠差動轉。
// 開關：設定檔 drive.helmTq: false 或網址 ?helmtq=0 ⇒ 全部照舊（helmK、driveYaw、只往前的差動；對拍用）。
var HELM_TQ = DRIVE_CFG.helmTq !== false && Q.get('helmtq') !== '0';
var HELM_GYR = +DRIVE_CFG.gyr > 0 ? +DRIVE_CFG.gyr : 0.25;
var DIFF_P0 = +DRIVE_CFG.diffP0 > 0 ? +DRIVE_CFG.diffP0 : 0.5;           // 推力的幾成：比它小 ＝ 停俥那一段
/** 開戰（driveInit）：舵的清單（見上）。 */
function helmItems(sh) {
  var T = sh.T, M = sh.models;
  var rud = M.filter(function (m) { return m.kind === 'rudder'; }), ops = M.filter(function (m) { return m.kind === 'wheel' || m.kind === 'tiller'; });
  var lks = M.filter(function (m) { var v = (m.meta || {}).steer; return v !== undefined && v !== '' && v !== '0' && v !== 0 && v !== false; });
  var R = rud.length ? rud.map(function (m) { return { kind: 'rudder', m: m, p: (m.pts['stock-top'] || m.c).slice(), out: m.name }; })
    : [{ kind: 'rudder', m: null, p: [T.wl0 + 4, T.cy, Math.max(2, T.zw - 15)], out: '船尾（看不見的舵）' }];
  function named(m, r) { return !!r && (m.name === r || m.path === r || m.name.slice(-r.length - 1) === '/' + r); }
  function bound(L, p) { var B = p.m ? L.filter(function (q) { return named(p.m, (q.meta || {}).rudder); }) : []; return B.length ? B : L.filter(function (q) { return !(q.meta || {}).rudder; }); }
  var W = R.map(function (p) { var v = p.m ? +(p.m.meta || {}).helm_share : NaN; return v > 0 ? v : 1; }), sw = W.reduce(function (a, v) { return a + v; }, 0);
  R.forEach(function (p, j) {
    p.w = W[j] / sw; p.ok = 1; p.F = 0; p.Fy = 0; p.sd = 0; p.ops = bound(ops, p); p.lks = bound(lks, p); p.ro = 1;
    if (!p.m) p.n0 = driveCount(T.hullG || T.base, p.p);
  });
  return R;
}
function helmLossK() { return PLAY === 'fun' ? FUN.helmloss : 1; }
/** 舵效（每一步；31_sailing.js、52_fleet.js）：Σ 份量 × 鏈（舵令 ⇒ 舵輪／舵柄 ⇒ 舵）× 娛樂加成「舵效」。沒有清單（開關關掉）⇒ 1。 */
function helmEff(sh) {
  var D = sh.drive; if (!D || !D.R) return 1;
  var k = helmLossK(), Lw = clamp(WHEEL_LOSS * k, 0, 1), Lr = clamp(RUDDER_LOSS * k, 0, 1), e = 0;
  function up(m) { return m.alive && !m.moved; }
  D.R.forEach(function (p) {
    var fo = p.ops.length ? p.ops.filter(up).length / p.ops.length : 1, fl = p.lks.every(up) ? 1 : 0, ro = p.m ? (up(p.m) ? 1 : 0) : p.ro;   // 操作端並聯（照還在幾成）、舵索串聯（斷一個就傳不過去；⛔ 照比例：兩個導索器打掉一個只掉一半，量過）
    var L = [{ name: '舵令', ok: 1, out: 1 }];
    if (p.ops.length || p.lks.length) L.push({ name: p.ops.concat(p.lks).map(function (m) { return m.name.split('/').pop(); }).join('＋'), ok: 1 - Lw * (1 - fo * fl), out: 0 });
    L.push({ name: p.out, ok: 1 - Lr * (1 - ro), out: 0 });
    p.chain = L; p.ok = drvChain(L); e += p.w * p.ok;
  });
  D.effC = e; D.eff = e * playK('helmeff');                            // effC：只看鏈（受損）；eff：乘上娛樂加成（☸ 顯示的、轉向用的）
  return D.eff;
}
/** 差動（driveStep，開關開著）：每個額外動力項的推力 p.F（照舵令，見上）；回傳不算差動的兩舷不平衡力矩（受損），
 *  差動那一份記在 D.tqD（kN·m）、比例 D.dS ＝ D.tqD ÷ 完好全速打滿的力矩 D.tqRef、現在打滿的比例 D.dS1（電腦估上限用）、每一舷的推力 D.sideF（划槳畫面）。 */
function helmDiffStep(sh, D, P, give, cap, Ff, ey, on) {
  var dif = D.dif && DRV_DIFF && on, u = dif ? clamp(sh.rudder || 0, -1, 1) * (helmRev(sh) ? -1 : 1) : 0, Tq = 0, Td = 0, Td1 = 0, Tr = 0, SF = [give, give];
  for (var i = 0; i < P.length; i++) {
    var p = P[i]; if (p.kind === 'sail' || p.kind === 'rudder') continue;
    var c = cap > 0 ? Ff * p.w * p.ok / cap : 0, f = helmSideF(give, cap, p.sd, u);
    var arm = ((p.kind === 'oar' && p.m.pts.blade ? p.m.pts.blade[1] : p.p[1]) - ey) * S;   // 力臂：槳照槳葉（水推的是槳葉；量過四型槳葉離中線是槳座的 2.6 倍），螺旋槳照轉軸中心
    p.F = f * c; p.Fy = 0;
    Tq -= arm * give * c; Td -= arm * (f - give) * c;
    if (dif) { Td1 -= arm * (helmSideF(give, cap, p.sd, 1) - give) * c; Tr -= arm * (helmSideF(1, 1, p.sd, 1) - 1) * Ff * p.w; }   // Tr：完好（ok 1）、全速前進、打滿
    if (p.sd) SF[p.sd > 0 ? 1 : 0] = f;
  }
  Tr = Math.abs(Tr);
  D.tqD = Td; D.tqRef = Tr; D.dS = Tr > 1e-9 ? Td / Tr : 0; D.dS1 = Tr > 1e-9 ? Math.abs(Td1) / Tr : 0; D.sideF = SF; D.dfu = u; D.dfk = 1; D.dfs = 0;
  return Tq;
}
/** 一舷的推力（全速的幾成，有號）：g ＝ 俥鐘要的（夾在上限內）、sd 哪一舷、u 舵令（見上）。 */
function helmSideF(g, cap, sd, u) {
  if (!u || !sd) return g;
  var a = Math.abs(u), s = u > 0 ? 1 : -1, m = clamp(1 - 2 * a, -0.5, 1);
  if (g >= DIFF_P0) return sd === -s ? g * m : g;
  if (g <= -DIFF_P0) return sd === s ? g * m : g;
  return clamp(g + (sd === -s ? -a : a) * DIFF_P0, -cap, cap);
}
/** 倒退（舵效反過來）：開關開著 ⇒ 往後超過 HELM_REV 才算（⛔ 照 sh.spd < 0：停著時航速是一個很小的負數（__game.helm 印到小數點後三位是 0，但 sh.spd < 0 成立），就把舵與差動一起反過來 ⇒ fusta 原地轉按左舵往右轉，量過）；關著 ⇒ 照舊 sh.spd < 0。 */
var HELM_REV = 0.1;                                                     // m/s
function helmRev(sh) { return HELM_TQ ? sh.spd < -HELM_REV : sh.spd < 0; }
/** 阻尼 N（kN·m 每 rad/s；見上）。 */
function helmN(sh) { var D = sh.drive, R = HELM_GYR * D.L; return (D.M0 || D.M || 1) * R * R / (2 * DRV_TURN); }
/** 差動打滿時的轉向率（rad/s，電腦估上限用；31_sailing.js）：rmaxB ＝ 舵完好時的最大轉向率（這個航速）。 */
function helmDifRate(sh, rmaxB) { var D = sh.drive; return D && D.dS1 > 0 && !D.brake && !sh.sunk ? D.dS1 * DIFF_K * playK('diff') * rmaxB : 0; }
/** 轉向率的一步（31_sailing.js，開關開著）：rate ＝ 舵（與頂風失速的推開）給的轉向率；rmaxB ＝ 舵完好時的最大轉向率（差動照它換算）；pin ＝ 停船、繞錨原地轉 ⇒ 照舊的 2 秒追。 */
function helmYaw(sh, rate, dt, pin, rmaxB) {
  var D = sh.drive;
  if (pin || !D || D.M === null) { sh.yawRate += (rate - sh.yawRate) * Math.min(1, dt / (2 * DRV_TURN)); if (D) D.om = 0; return; }
  var N = helmN(sh), R = HELM_GYR * D.L, I = (D.M || D.M0 || 1) * R * R, Tt = I / N, live = !D.brake && !sh.sunk;
  var ref = (D.Fabs || 0) * D.L / 4, oS = live && ref > 1e-6 ? -clamp((D.tq || 0) / ref, -1.5, 1.5) * rmaxB * DRV_TQ : 0, oD = live ? -(D.dS || 0) * DIFF_K * playK('diff') * rmaxB : 0;   // 轉向率（rad/s）：帆與動力的不平衡、差動（都換算成舵的幾成）
  if (D.R) { var we = D.R.reduce(function (a, p) { return a + p.w * p.ok; }, 0); D.R.forEach(function (p) { var arm = Math.abs(p.p[0] - sh.T.cx) * S; p.Fy = arm > 0.5 && we > 0 ? rate * N * p.w * p.ok / we / arm : 0; }); }   // 每支舵的側向力（kN；讀數）＝ 它那一份舵的力矩 ÷ 離船中心的距離
  D.N = N; D.I = I; D.Tt = Tt; D.rmaxB = rmaxB; D.tqR = rate * N; D.tqS = oS * N; D.tqDf = oD * N; D.om = oS + oD;
  sh.yawRate += (rate + D.om - sh.yawRate) * Math.min(1, dt / Tt);
}
/** 讀數（__game.drive、詳細資訊）：每個動力源的種類、完好度、推力（kN）。 */
function driveInfo(sh) {
  var D = sh.drive; if (!D) return null;
  return { kind: D.kind, k: +D.k.toFixed(3), massT: D.M === null ? null : Math.round(D.M), waterT: Math.round(D.W), cap: +D.cap.toFixed(3), tele: sh.tele, power: sh.power, want: +(D.want || 0).toFixed(3), give: +(D.give || 0).toFixed(3),
    dif: D.dif, Fx: +D.Fx.toFixed(1), drag: +D.drag.toFixed(1), a: +D.a.toFixed(4), vTkn: +(D.vT * 1.9438).toFixed(2), tq: Math.round(D.tq), omDeg: +(D.om * 57.2958).toFixed(3), funnels: D.fu === undefined ? null : +D.fu.toFixed(2),
    P: D.P.map(function (p) { return { kind: p.kind, name: p.s ? p.s.name : p.out || '', at: p.p.map(function (v) { return Math.round(v); }), ok: +(p.ok || 0).toFixed(2), on: p.kind === 'sail' ? !!p.on : undefined, F: +p.F.toFixed(1), Fy: +p.Fy.toFixed(1),
      w: p.kind === 'sail' ? undefined : +p.w.toFixed(3), rpm: p.ax ? +p.rpm.toFixed(1) : undefined, left: p.left === undefined ? undefined : +p.left.toFixed(3), shaft: p.shaft >= 0 && D.C ? D.C.SH[p.shaft].s.name : undefined, rowers: p.kind === 'oar' ? p.rw + '／' + p.rw0 : undefined, side: p.sg ? (p.sg > 0 ? 'S' : 'P') : undefined,
      chain: p.chain ? p.chain.map(function (n) { return n.name + ' ' + (+n.ok).toFixed(2) + (n.out ? ' +' + (+n.out).toFixed(2) : ''); }).join(' ⇒ ') : undefined }; }),
    chain: D.C ? { engines: D.C.E.map(function (c) { return { name: c.e.name, share: +c.f.toFixed(3), to: c.to, ok: +(+c.ok).toFixed(3), r: c.r == null ? undefined : +c.r.toFixed(3) }; }), shafts: D.C.SH.map(function (c) { return { name: c.s.name, ok: +(+c.ok).toFixed(3) }; }),
      boilers: D.C.B.map(function (c) { return { name: c.b.name, funnel: c.b.funnel, ok: c.ok.slice(), r: c.r == null ? undefined : +c.r.toFixed(3), out: c.out == null ? undefined : +c.out.toFixed(3), wet: c.wet, link: c.link }; }),
      pipes: (D.C.SP || []).map(function (c) { return { name: c.p.name, ok: +(+c.ok).toFixed(3) }; }), steam: +(+D.C.steam).toFixed(3), funnelsOff: D.C.fnOff ? D.C.fnOff.slice() : null } : null };   // r ＝ 還剩幾成（動力件，TASK-0653）
}
