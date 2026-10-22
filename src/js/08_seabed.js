// ───────────────────────── 海圖塊：陸地與海底（TASK-0721） ─────────────────────────
// Tim 2026-10-19：「讓地圖可以匯出到Blockside 在Blockside可以在海岸附近開戰(或小島) 然後地形也可以加入珊瑚礁 暗礁等海底地形 可以先定一出一套通用格式
//   (目前構想是1平方公里作為一格地圖 然後海戰時會載入附近9格地圖 …) 然後整體移動到另一格地圖格時重新載入另一格座標為中心的9格」
// 格式：src/MAP_CHUNK.md。一個海域 ＝ maps/<海域>/area.js（BSMAP.area）＋ 一塊一檔 maps/<海域>/<cx>_<cy>.js（BSMAP.chunk）；全是深海的塊沒有檔。
// 開法：?map=<海域>[&site=<第幾個開戰位置>] —— 世界原點（兩隊正中間）＝ 那個位置；沒給 ?map ⇒ BED ＝ null ⇒ 每一處都走原本那一條（戰局逐位元組不變）。
// 載入：焦點（還在打的船的中心）所在那一塊為中心、載 (2·(ring＋prefetch)＋1)² 塊（預設 5×5，其中 3×3 是「在用的」）；焦點走進別塊 ⇒ 換中心、載新的、丟太遠的。
//   ⛔ 模擬只讀載好的塊：每一步之前看每艘船 margin 公尺內的塊都載好了沒（bedWait）—— 沒有 ⇒ 這一步先不走（畫面迴圈）⇒ 戰局跟載入快慢無關。
//   快轉、無頭（?demo）沒有畫面迴圈可以等 ⇒ 開戰前整個海域一次載完（bedBoot）。
// 外圈用中等塊（BED.mid；2026-10-20，Tim：「鄰近區塊用高精度 遠方用低精度加快載入」）：只有 ?map=@host 而且外面那一頁的海域帶 area.mid（點距，Blocksail 16 m）才開。
//   開戰前只等在用的 ring 圈原精度＋外面到 ring＋prefetch 圈的中等塊（bedFocusMid；以前 5×5 全原精度）；外圈的原精度與再外一圈的中等塊在背景補（bg ⇒ 外面那一頁排在遠景後面）。
//   模擬讀哪一份照規則、不照「先到哪一份」（bedLevels：這一步的焦點 ± ring 與船旁邊 margin ⇒ 原精度，± ring＋prefetch 其他 ⇒ 中等塊）⇒ 戰局跟載入快慢無關；
//   ⚠ 中等塊跟原精度在共用格點上可以差到 1.5 m（生成找海岸線段的格子比較粗）、很窄的沙灘條在 16 m 一點會不見 —— 外圈 1～2.5 km 外，原精度一到畫面就換。
//   檔案海圖、快轉、無頭、外面那一頁沒給 area.mid ⇒ 照上面舊的那一套（戰局逐位元組不變）。
// 焦點 ＝ 旗艦（玩家開的那艘；2026-10-20，Tim：「根據玩家操作的旗艦位置判定」）：沉了／沒有 ⇒ 照舊用還在打的船的中心（bedFocusAt）。
// 海域跟著旗艦走（BED.win；同一天，Tim：「目前規劃是要能根據船的位置動態加載地圖」）：只有 ?map=@host、外面那一頁的海域帶 area.win（窗的半徑，幾塊）才開。
//   以前海域在開戰時就定死（開戰位置 ± 11 塊）⇒ 開出去 11 km 以外什麼都沒有（小地圖那一邊一塊空的、地形沒了）。
//   半徑照畫質（bedWinR：BED_WIN_M 照公尺換塊數，area.win 是外面那一頁給得出的上限；2026-10-22 以前一律 area.win 10 塊 ＝ 21×21 km）。
//   ⇒ 海域 ＝ 旗艦那一塊 ± bedWinR() 塊的窗（也蓋住每艘船 margin 內的塊）；旗艦離窗的中心超過 BED_WIN_SHIFT 塊、窗比 ± area.win 小、有船的 margin 出了窗
//   ⇒ 跟外面那一頁要新的窗 { bsmap: 'need', what: 'win', x, y }，它回 { bsmap: 'win', x, y, chunks, towns? }（chunks：這個窗每一塊有沒有檔，同 area.chunks）
//   ⇒ bedWinApply：照新的範圍重排 BED.has／slot／mslot／lv（塊號、原點都不變 ⇒ 世界座標不動、載好的塊照用），窗外的丟掉（網格、遠景、小地圖照 'bedWin' 跟著換）。
//   ⛔ 戰局跟窗什麼時候到無關：每一步之前每艘船 margin 內的塊都要在窗裡（bedWait 等；平常船離窗邊還有好幾 km 就換了，等不到）；窗外照深海只會出現在 margin 外。
// 查詢（模擬用）：bedHgt(x, z) 海底／地面高度（m，海面 0、水下是負的；雙線性）、bedMat(x, z) 底質（BED_MAT）、bedGrad(x, z) 坡度。海域外、深海塊 ⇒ 深海 area.deep。
// 大漩渦（08_sea.js VX；Tim 2026-10-19：「漏斗內當深海、外面照海圖」）：漏斗的水面深到 −200 m 以下、海圖的深海才 −150 m ⇒ 以前船在漏斗裡每一步都判擱淺、被拆格。
//   解碼時（bedVxBake）把漩渦烤進每一塊的高度：h' ＝ vxH ＋ w·h ＋ (1 − w)·deep —— 離中心 BED_VX_IN·r 以內 w ＝ 0（那一點的水面下 |deep|，底質當深海）、
//   BED_VX_OUT·r 以外 w ＝ 1（水面下幾公尺照海圖；地形跟著漏斗的尾巴一起往下移，離中心 3 km 只移不到 2 m）、中間平滑接上。
//   ⇒ 模擬（擱淺、砲彈打到海底、艦長避淺、錨）跟畫面（海底網格、白沫、樹）讀的是同一份，不用各自改。原始高度留在 C.h0／C.mat0；換天氣（vxInit）⇒ bedVxSync 重烤。
//   沒有漩渦 ⇒ C.h 就是解碼的那一份（戰局逐位元組不變）。⚠ 遠景的粗塊建完網格就丟資料 ⇒ 開戰後才換天氣的話，遠景照舊（離中心 ≥ 2.5 km，漩渦在那裡只差幾公尺）。
// 收塊排隊（2026-10-20；Blocksail 地球儀 → 航海／海戰的轉場要一整段動畫、邊播邊載）：Blockside 是同源 iframe、跟地球儀同一條主執行緒 ⇒ 開場一段長的工作就讓動畫頓住；
//   以前地球儀先做好的 25 塊一口氣到、每則訊息當場解碼＋發 'bedChunk'（擺樹、整地、小地圖）⇒ 停靠金斯敦量到主執行緒整段卡 2.07 s。
//   ⇒ ?map=@host 有畫面迴圈時（BED_SLICE）收到的塊先排隊（BED.inq），畫面迴圈每格照預算 BED_PUMP_MS 處理（bedPump：解碼、放進模擬查的那一份、發 'bedChunk'，至少一塊）；
//   擺樹（63_trees.js treePump）照同一份預算接著做；網格（63_bed_gl.js）本來就每格限量。分頁在背景、畫面迴圈不跑 ⇒ bedPumpLate 用計時器慢慢補。
//   ⛔ 不改戰局：要那一塊的 Promise（bedLoad／bedLoadMid ⇒ bedBoot、bedWait）照舊在「放進 BED.slot／mslot 之後」才 resolve；模擬照舊等 bedWait（要讀的那一份還沒放進去 ⇒ 這一步不走）
//   ⇒ 排隊只影響什麼時候算好。快轉、無頭沒有畫面迴圈可以等 ⇒ 照舊收到就處理（BED_SLICE 假）。
//   預算（BED_BG）是「這一格背景工作還剩幾 ms」：收塊、擺樹、海底網格、遠景、白沫、樹種網格、城鎮的實例共用，各自做一段就扣（bedSpent）；用完（bedBusy）⇒ 留到下一格。
//     城鎮的實例只扣不等（63_towns.js townDraw；TASK-0819）：等的話模型解好了城還要等收塊那一批做完。
//   ⛔ 照「從這一格開始過了多久」算 ⇒ 打起來模擬一格常超過 8 ms，背景的就永遠輪不到。
var BED = null, BED_SLICE = DEMO < 0 && !HEADLESS, BED_PUMP_MS = 8, BED_BG = 0;
/** 這一格背景工作的預算用完了（有畫面迴圈才算；快轉、無頭 ⇒ 永遠沒用完、照舊當場做）。 */
function bedBusy() { return BED_SLICE && BED_BG <= 0; }
/** 背景工作照剩下的預算做到幾點（performance.now()）。 */
function bedT1() { return BED_SLICE ? performance.now() + Math.max(0, BED_BG) : Infinity; }
/** 扣掉一段背景工作花的時間（t0 ＝ 開始時的 performance.now()）。 */
function bedSpent(t0) { BED_BG -= performance.now() - t0; }
var BED_VX_IN = 1.5, BED_VX_OUT = 2.5;                                   // 漩渦半徑 r 的幾倍：以內全是深海、以外全照海圖
var BED_WIN_SHIFT = 0.3;                                                 // 海域跟著旗艦走：旗艦離窗的中心超過半徑的幾成就換窗（以前 3 塊 ／ area.win 10）
var BED_WIN_M = [2000, 4000, 6000];                                      // 窗的半徑（公尺）照畫質的「海圖讀取範圍」（07_gfx.js chartr；Tim 2026-10-22「最高6 km 中 4km 低 2km」）
var BED_VIEW_BACK = 2;                                                   // 讀的先後（外圈的背景預載、遠景）：鏡頭背後那一邊當成遠一倍（Tim 2026-10-20：「外圈地圖讀取優先度 可以根據攝影機視角判斷(看到的部分優先)」）
var BED_MAT = { DEEP: 0, SAND: 1, REEF: 2, SHOAL: 3, ROCK: 4, BEACH: 10, LAND: 11, CLIFF: 12 };
var BED_CFG = Object.assign({ ring: 1, prefetch: 1, margin: 300 }, CFG.map || {});   // config/game.json map：在用幾圈、多預載幾圈、船旁邊多少公尺內一定要載好
// ring、prefetch 的單位是「1024 m 的一圈」（2026-10-22 以前塊一律 1024 m；Tim 同一天「一塊尺寸是否也能縮一半」⇒ Blocksail 的塊改 512 m）：
//   照 A.chunk 換塊數（bedRingN）⇒ 1024 m 的塊（檔案海圖 maps/tortuga）照舊 1 圈、逐位元組不變；512 m 的塊 2 圈 ⇒ 公尺上一樣遠。
var BED_RING_UNIT = 1024;
function bedRingN(v) { return v > 0 ? Math.max(1, Math.round(v * BED_RING_UNIT / BED.A.chunk)) : 0; }
window.BSMAP = {                                                         // 海圖檔（<script>）載進來呼叫這兩支（?map=@host ⇒ 收到外面那一頁回的也照樣叫）
  area: function (o) { if (BED && (BED.host || BED.wantArea === o.id)) BED.gotArea = o; },
  town: function (o) { if (BED && BED.A) TOWNS.pend.push(o); },          // maps/<海域>/towns.js：一座城一筆（63_towns.js townWant 讀完一起收）
  chunk: function (id, cx, cy, b64, coarse, mid) {                       // coarse：粗的遠景塊 ⇒ 只給遠景（⛔ 不進模擬）；mid：外圈的中等塊（BED.mid 公尺一點，只有 @host）
    if (!BED || !BED.A || BED.A.id !== id) return;
    var k = bedKey(cx, cy), w = BED.pend[k], v = BED.peek[k], m = BED.mpend && BED.mpend[k];
    if (mid) { if (m) m(b64); return; }
    if (w && !coarse) w(b64); if (v) v(b64);
  }
};
/** 那一塊畫哪一份：有原精度的畫原精度的，沒有才畫外圈的中等塊（BED.mid）。 */
function bedShowC(k) { return BED.ch[k] || (BED.cm && BED.cm[k]) || null; }
function bedKey(cx, cy) { return cx + '_' + cy; }
function bedScript(src) {
  return new Promise(function (ok, bad) {
    var s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = function () { s.remove(); ok(); }; s.onerror = function () { s.remove(); bad(new Error('載不到 ' + src)); };
    document.head.appendChild(s);
  });
}
// ?map=@host：海圖不讀檔，跟開這一頁的那一頁要（Blocksail 地球儀「就地開戰」：iframe 的父頁或 window.open 的開啟者，照世界地圖當場生成）。
//   這一頁 ⇒ 那一頁：{ bsmap: 'need', what: 'area' | 'chunk', cx, cy, peek }（peek ＝ 遠景要的，可以晚一點）
//   那一頁 ⇒ 這一頁：{ bsmap: 'area', area }、{ bsmap: 'chunk', cx, cy, b64, coarse? }（跟檔案裡 BSMAP.area／BSMAP.chunk 的參數一樣；coarse ＝ 回 peek 的粗塊，只給遠景）、{ bsmap: 'error', what, cx, cy, msg }
//   轉場（03_camera.js camTrans）：這一頁 ⇒ 那一頁 'started'（開戰了、鏡頭停在正上方）、'left'（拉到正上方了；x、z ＝ 我艦在世界的哪裡、shipHdg ＝ 我艦船頭朝哪）；
//                                兩個都帶 hdg ＝ 正上方那一張畫面上方朝哪（度，北 0 順時針）⇒ 地球儀轉過來對齊海岸線；
//                                那一頁 ⇒ 這一頁 'go'（地球儀淡進來了 ⇒ 降下去）、'leave'（要回地球儀 ⇒ 拉上去）
//   城鎮（area.towns 有才要；63_towns.js）：這一頁 ⇒ 那一頁 { bsmap: 'need', what: 'towns' }；那一頁 ⇒ 這一頁 { bsmap: 'towns', towns: [規劃…], kit: 模型的索引 }（出錯 { bsmap: 'error', what: 'towns', msg }）；
//   照索引挑好要用的模型 ⇒ { bsmap: 'need', what: 'townmodels', names: [名…] } ⇒ { bsmap: 'townmodels', models: { 名: { g, lo, png, mesh?（烘好的網格，63_towns.js townModelMesh） } } }（出錯 what: 'townmodels'）。模型只放在外面那一頁（Blocksail world/townkit/）。
//   只收 BED.host 送來的訊息。
function bedGet(cx, cy, peek, mid, bg) {                                // cx ＝ null ⇒ area.js；mid ⇒ 外圈的中等塊（BED.mid 公尺一點）；bg ⇒ 背景預載（外面那一頁排在最後）
  if (!BED.host) return bedScript(cx == null ? 'maps/' + BED.wantArea + '/area.js' : 'maps/' + BED.A.id + '/' + bedKey(cx, cy) + '.js');
  return new Promise(function (ok, bad) {
    var k = cx == null ? 'area' : bedKey(cx, cy) + (peek ? '+' : mid ? '@' : '');
    (BED.ask[k] = BED.ask[k] || []).push([ok, bad]);
    var m = { bsmap: 'need', what: cx == null ? 'area' : 'chunk', cx: cx, cy: cy, peek: !!peek };
    if (mid) m.step = BED.mid; if (bg) m.bg = 1;
    BED.host.postMessage(m, '*');
  });
}
function bedHostMsg(e) {
  var d = e.data; if (!BED || !BED.host || e.source !== BED.host || !d || !d.bsmap) return;
  if (d.bsmap === 'go' || d.bsmap === 'leave') { camTransSet(d.bsmap === 'go' ? 'go' : 'out'); return; }
  if (d.bsmap === 'win' || (d.bsmap === 'error' && d.what === 'win')) {   // 海域的窗（bedWinAsk 要的）
    BED.winP = null;
    if (d.bsmap === 'win') bedWinApply(d); else { BED.winErr = performance.now() + 2000; console.warn('海域的窗：' + (d.msg || '要不到')); }   // 出錯 ⇒ 2 秒後再要
    return;
  }
  if (d.bsmap === 'towns' || (d.bsmap === 'error' && d.what === 'towns')) { townGot(d.towns || [], d.msg, d.kit); return; }   // 城鎮規劃＋模型的索引（63_towns.js；只給人看 ⇒ 不等它）
  if (d.bsmap === 'townmodels' || (d.bsmap === 'error' && d.what === 'townmodels')) { townModelsGot(d.models, d.msg); return; }   // 要用到的城鎮模型（63_towns.js townModels）
  if (d.bsmap === 'chunk' && !d.coarse && BED.inq) { BED.inq.push(d); return; }   // 收塊排隊（檔頭）：畫面迴圈每格照預算處理（bedPump）；遠景的粗塊照舊當場收（只是交回 base64，bedFarStep 自己限量）
  bedHostTake(d);
}
/** 處理外面那一頁回的一則（area、chunk、error）：交給 BSMAP、再 resolve／reject 等它的（bedGet）。 */
function bedHostTake(d) {
  var mid = !d.coarse && BED.mid && d.step === BED.mid, k0 = bedKey(d.cx, d.cy);   // 中等塊：回的訊息帶 step ＝ BED.mid
  var ks = d.bsmap === 'area' || d.what === 'area' ? ['area'] : mid ? [k0 + '@'] : d.coarse ? [k0 + '+'] : [k0, k0 + '+'], err = d.bsmap === 'error' ? new Error('海圖：' + (d.msg || '要不到')) : null;
  if (d.bsmap === 'area') BSMAP.area(d.area);
  else if (d.bsmap === 'chunk' && BED.A) BSMAP.chunk(BED.A.id, d.cx, d.cy, d.b64, !!d.coarse, mid);
  ks.forEach(function (k) { var L = BED.ask[k]; delete BED.ask[k]; (L || []).forEach(function (f) { if (err) f[1](err); else f[0](); }); });
}
/** 排著的塊（bedHostMsg）照預算處理：做到 t1（performance.now()）為止、至少一塊。畫面迴圈每格叫（90_main.js frame，跟擺樹共用一份預算）。 */
function bedPump(t1) {
  var Q = BED && BED.inq; if (!Q) return;
  BED.pumpAt = performance.now(); if (!Q.length) return;
  var t0 = BED.pumpAt;
  do { bedHostTake(Q.shift()); BED.pumped++; } while (Q.length && performance.now() < t1);
  BED.pumpMax = Math.max(BED.pumpMax, performance.now() - t0);
}
/** 畫面迴圈不跑（分頁在背景：rAF 停了）⇒ 計時器補著處理（一次一份預算）。 */
function bedPumpLate() { if (BED.inq.length && performance.now() - BED.pumpAt > 250) bedPump(performance.now() + BED_PUMP_MS); }
/** 告訴外面那一頁（只有 ?map=@host）：'started' ＝ 開戰了（鏡頭停在正上方）、'left' ＝ 拉到正上方了 —— 畫好兩格才送（地球儀照這個淡進／淡出）。 */
function bedHostSay(what, o) {
  if (!BED || !BED.host) return;
  var n = 0;
  (function one() {
    requestAnimationFrame(function () {
      if (what === 'started' && BED.A && !P.bed && ++n < 600) { one(); return; }   // 地形的著色器還在編（63_bed_gl.js bedDraw 先不畫地形）⇒ 等它好了才說：淡進來的那一張要有地形（TASK-0816）
      requestAnimationFrame(function () { BED.host.postMessage(Object.assign({ bsmap: what }, (typeof o === 'function' ? o() : o) || {}), '*'); });   // o 可以是函式：送的那一刻才算
    });
  })();
}
/** 下排的 🌍（template.html #hostBack；Tim 2026-10-20「回到地球儀 我目前想法是 航海模式下 加到下排圓形按鈕」「用emoji的地球儀」）：只有 ?map=@host 才出現（body.bsHost），
 *  點了、按快捷鍵（66_keys.js hostBack，預設 U；71_input.js doAct）⇒ 跟外面那一頁說 'back'（地球儀照它回去：跟它自己那顆「← 回到地球儀」同一條；'started' 帶 back: 1 ⇒ 地球儀就不放它那一顆、免得疊在停格條上）。 */
function bedHostBack(host) { if ($('hostBack')) document.body.classList.add('bsHost'); }
function bedHostBackGo() { if (BED && BED.host && RUNNING) BED.host.postMessage({ bsmap: 'back' }, '*'); }
/** 「回主選單」交給外面那一頁（Tim 2026-10-21「Blocksail是否能override返回主選單按鈕 要回到 … Blocksail/index.html」）：?map=@host ⇒ 跟它說 'menu'
 *  （地球儀照「回到地球儀」那條路先把船搬到開到的地方、存好，再換到 Blocksail 的主選單 index.html）；不是被嵌的 ⇒ false，照舊開這一頁的主選單。 */
function bedHostMenuGo() { if (!BED || !BED.host) return false; BED.host.postMessage({ bsmap: 'menu' }, '*'); return true; }
/** 開機（90_main.js 跟船一起等）：有 ?map ⇒ 讀海域、定原點；快轉／無頭 ⇒ 整個海域載完，不然 ⇒ 開戰位置附近先載好。 */
function bedBoot() {
  var id = Q.get('map'); if (!id) return Promise.resolve();
  var host = id === '@host' ? (window.parent !== window ? window.parent : window.opener) : null;
  if (id === '@host' && !host) return Promise.reject(new Error('?map=@host 要開在 Blocksail 的頁面裡（iframe 或 window.open）'));
  if (!host && !/^[a-z0-9_-]+$/.test(id)) return Promise.reject(new Error('海域名稱只能是小寫英數、底線、連字號：' + id));
  BED = { wantArea: id, host: host, ask: {}, A: null, ch: {}, pend: {}, peek: {}, idx: null, cx: null, cy: null, top: -Infinity, miss: 0, loads: 0, drops: 0,
    mid: 0, cm: {}, mpend: {}, mslot: null, lv: null, mloads: 0,                     // mid：外圈的中等塊（@host 的海域帶 area.mid 才開；見 bedFocus、bedWait）
    win: 0, winP: null, winErr: 0, wins: 0, winMs: 0,                                // win：海域跟著旗艦走（@host 的海域帶 area.win 才開；見 bedWinAsk）
    inq: host && BED_SLICE ? [] : null, pumpAt: 0, pumped: 0, pumpMax: 0 };          // inq：收塊排隊（檔頭；bedPump）
  if (host) { window.addEventListener('message', bedHostMsg); bedHostBack(host); }
  if (BED.inq) setInterval(bedPumpLate, 250);
  return bedGet(null).then(function () {
    var A = BED.gotArea; if (!A) throw new Error((host ? '外面那一頁' : 'maps/' + id + '/area.js') + ' 沒有給 BSMAP.area');
    BED.A = A; BED.G = A.chunk / A.step; BED.n = A.n; BED.nx = A.x[1] - A.x[0] + 1;
    BED.has = new Uint8Array(BED.nx * (A.y[1] - A.y[0] + 1));            // 這一塊有沒有檔（0 ＝ 深海或海域外）
    A.chunks.forEach(function (c) { var i = bedIdx(c[0], c[1]); if (i >= 0) BED.has[i] = c[2] ? 1 : 0; });
    BED.slot = new Array(BED.has.length);                                // 載好的塊照編號放（查詢不用字串）
    if (host && A.mid > A.step && A.chunk % A.mid === 0 && !(DEMO >= 0 || HEADLESS)) {   // 外圈用中等塊（Tim 2026-10-20：「鄰近區塊用高精度 遠方用低精度加快載入」）：外面那一頁說它給得出來才開
      BED.mid = A.mid; BED.mslot = new Array(BED.has.length); BED.lv = new Uint8Array(BED.has.length);
    }
    if (host && A.win > 0 && !(DEMO >= 0 || HEADLESS)) BED.win = A.win | 0;   // 海域跟著旗艦走：外面那一頁說它給得出新的窗才開
    var si = Math.max(0, Math.min((A.sites || []).length - 1, +(Q.get('site') || 0) | 0)), S0 = (A.sites || [])[si];
    BED.site = si; BED.ax = S0 ? S0.x : (A.x[0] + A.x[1] + 1) * A.chunk / 2; BED.az = S0 ? S0.y : (A.y[0] + A.y[1] + 1) * A.chunk / 2;   // 世界原點在海域的哪裡（往東、往南公尺）
    townWant();                                                          // 海域有城（area.towns）⇒ 去要規劃（63_towns.js；只給人看、不等它、無頭不要）
    if (DEMO >= 0 || HEADLESS) return Promise.all(A.chunks.filter(function (c) { return c[2]; }).map(function (c) { return bedLoad(c[0], c[1]); }));
    return bedFocus(0, 0, true).then(function () { if (BED.mid) bedLevels(0, 0); });
  });
}
function bedIdx(cx, cy) { var A = BED.A, i = cx - A.x[0], j = cy - A.y[0]; return i < 0 || j < 0 || i >= BED.nx || cy > A.y[1] ? -1 : j * BED.nx + i; }
function bedLoad(cx, cy, bg) {                                           // bg：背景預載（外面那一頁排在最後；只有 @host 有差）
  var k = bedKey(cx, cy), i = bedIdx(cx, cy);
  if (i < 0 || !BED.has[i] || BED.slot[i] || BED.pend[k]) return BED.pend[k] ? BED.pend[k].p : Promise.resolve();
  var w = function (b64) {
    var j = bedIdx(cx, cy);                                              // 到的時候再算編號：海域的窗換過（bedWinApply）⇒ 編號變了、或已經在窗外（不收）
    if (j < 0 || BED.slot[j]) return;                                    // 已經有了（遠景讀同一塊的那一份檔也會叫到這裡）⇒ 不重來
    var C = bedDecode(b64); if (C.cx !== cx || C.cy !== cy) throw new Error('海圖塊 ' + k + ' 的檔頭寫的是 ' + C.cx + '_' + C.cy);
    BED.slot[j] = C; BED.ch[k] = C; BED.top = Math.max(BED.top, C.max); BED.loads++; evEmit('bedChunk', cx, cy, C);
  };
  BED.pend[k] = w;
  w.p = bedGet(cx, cy, false, false, bg).then(function () { delete BED.pend[k]; }, function (e) { delete BED.pend[k]; throw e; });
  return w.p;
}
/** 外圈的中等塊（BED.mid 公尺一點；只有 @host 的海域帶 area.mid）：放 BED.mslot／BED.cm。模擬照 bedLevels 決定讀哪一份；畫面那一塊沒有原精度的才畫它。 */
function bedLoadMid(cx, cy, bg) {
  var k = bedKey(cx, cy), i = bedIdx(cx, cy);
  if (i < 0 || !BED.has[i] || BED.mslot[i] || BED.mpend[k]) return BED.mpend[k] ? BED.mpend[k].p : Promise.resolve();
  var w = function (b64) {
    var j = bedIdx(cx, cy);                                              // 同 bedLoad：到的時候再算編號
    if (j < 0 || BED.mslot[j]) return;
    var C = bedDecode(b64); if (C.cx !== cx || C.cy !== cy || C.step !== BED.mid) throw new Error('海圖塊 ' + k + '（中等）的檔頭寫的是 ' + C.cx + '_' + C.cy + '、' + C.step + ' m');
    BED.mslot[j] = C; BED.cm[k] = C; BED.top = Math.max(BED.top, C.max); BED.mloads++;
    if (!BED.ch[k]) evEmit('bedChunk', cx, cy, C);                       // 畫面：有原精度的那一份就照舊畫它
  };
  BED.mpend[k] = w;
  w.p = bedGet(cx, cy, false, true, bg).then(function () { delete BED.mpend[k]; }, function (e) { delete BED.mpend[k]; throw e; });
  return w.p;
}
/** 只給畫面（63_bed_gl.js 遠景）：讀一塊的檔、交回 base64 —— ⛔ 不放進 BED.slot／BED.ch（模擬照舊只查 bedLoad 載的、照船旁邊 margin 等）。 */
function bedPeek(cx, cy) {
  var k = bedKey(cx, cy);
  return new Promise(function (ok, bad) {
    BED.peek[k] = function (b64) { delete BED.peek[k]; ok(b64); };
    bedGet(cx, cy, true).then(function () { if (BED.peek[k]) { delete BED.peek[k]; bad(new Error('海圖塊 ' + k + ' 沒有呼叫 BSMAP.chunk')); } }, function (e) { delete BED.peek[k]; bad(e); });
  });
}
/** 解碼一塊（跟世界地圖工具 tools/export_chunks.cjs encodeChunk 一一對應；格式 src/MAP_CHUNK.md）⇒ { cx, cy, n, step, h: Int16Array（分米）, mat: Uint8Array, min, max（公尺）, wd: Uint16Array（內陸水的水深，分米；沒有段 3 ⇒ null） } */
function bedDecode(b64) {
  var bin = atob(b64), b = new Uint8Array(bin.length), p = 4;
  for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  if (b[0] !== 66 || b[1] !== 83 || b[2] !== 67 || b[3] !== 49) throw new Error('不是海圖塊（BSC1）');
  function u() { var v = 0, m = 1, c; do { c = b[p++]; v += (c & 127) * m; m *= 128; } while (c >= 128); return v; }
  function zg(v) { return v & 1 ? -(v + 1) / 2 : v / 2; }
  var ver = u(); if (ver !== 1) throw new Error('海圖塊版本 ' + ver + ' 不認得');
  var cx = zg(u()), cy = zg(u()), n = u(), step = u() / 100, N = n * n, h = new Int16Array(N), mat = new Uint8Array(N), run = 0, mn = 1e9, mx = -1e9;
  for (var j = 0; j < n; j++) for (var x = 0; x < n; x++) {
    var o = j * n + x, d;
    if (run > 0) { run--; d = 0; }
    else { var t = u(); if (t & 1) { run = t >> 1; d = 0; } else d = zg(t >> 1); }
    var L = x ? h[o - 1] : (j ? h[o - n] : 0), pred = x && j ? L + h[o - n] - h[o - n - 1] : L;
    h[o] = pred + d; if (h[o] < mn) mn = h[o]; if (h[o] > mx) mx = h[o];
  }
  for (var k = 0; k < N;) { var v = u(), c = u(); mat.fill(v, k, k + c); k += c; }
  var fo = null, foN = 0, vg = null, vgN = 0, wd = null;                 // 選用的段（MAP_CHUNK.md §4）：1 ＝ 林地覆蓋、2 ＝ 植被（每點長得出哪幾種，位元 ＝ area.vis）、3 ＝ 內陸水；不認得的記號 ⇒ 停（之後的段讀不了）
  while (p < b.length) {
    var tg = u();
    if (tg === 3) {                                                      // 內陸水（TASK-0768）：n² 個水深（分米；水面 ＝ 存的高度 ＋ 水深；0 ＝ 不是內陸水），跟高度、底質同一套點；只給畫面（63_bed_gl.js），⛔ 模擬不讀
      wd = new Uint16Array(N);
      for (k = 0; k < N;) { v = u(); c = u(); wd.fill(v, k, k + c); k += c; }
      continue;
    }
    if (tg !== 1 && tg !== 2) break;
    var sn = u(), sa = tg === 1 ? new Uint8Array(sn * sn) : new Uint32Array(sn * sn);   // 植被：一點最多 32 種（2026-10-19 第三批之後超過 16）
    for (k = 0; k < sa.length;) { v = u(); c = u(); sa.fill(v, k, k + c); k += c; }
    if (tg === 1) { fo = sa; foN = sn; } else { vg = sa; vgN = sn; }
  }
  var C = { cx: cx, cy: cy, n: n, step: step, h: h, mat: mat, h0: h, mat0: mat, min: mn / 10, max: mx / 10, min0: mn / 10, max0: mx / 10, fo: fo, foN: foN, vg: vg, vgN: vgN, wd: wd, vxk: 'none' };
  bedVxBake(C);
  return C;
}
/** 現在的漩渦（沒有 ⇒ 'none'）：烤過的塊記著它，變了才重烤。 */
function bedVxKey() { return VX ? [VX.rv, VX.rc2, VX.D, VX.De, VX.re2].join(',') : 'none'; }
/** 把漩渦烤進一塊的高度與底質（上面的說明）；沒有漩渦 ⇒ 換回原始的那一份。 */
function bedVxBake(C) {
  var key = bedVxKey(); if (C.vxk === key) return false;
  C.vxk = key;
  if (!VX || !BED || !BED.A) { C.h = C.h0; C.mat = C.mat0; C.min = C.min0; C.max = C.max0; return true; }
  var A = BED.A, n = C.n, N = n * n, h = new Int16Array(N), mat = new Uint8Array(C.mat0), mn = 1e9, mx = -1e9;
  var ox = C.cx * A.chunk - BED.ax, oz = C.cy * A.chunk - BED.az, r0 = BED_VX_IN * VX.rv, r1 = BED_VX_OUT * VX.rv;
  for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) {
    var o = j * n + i, x = ox + i * C.step, z = oz + j * C.step, w = bedSmooth(r0, r1, Math.hypot(x, z));
    var v = Math.round((vxH(x, z) + w * C.h0[o] / 10 + (1 - w) * A.deep) * 10);
    h[o] = Math.max(-32768, Math.min(32767, v)); if (w < 0.5) mat[o] = BED_MAT.DEEP;
    if (h[o] < mn) mn = h[o]; if (h[o] > mx) mx = h[o];
  }
  C.h = h; C.mat = mat; C.min = mn / 10; C.max = mx / 10;
  return true;
}
/** smoothstep（a ⇒ 0、b ⇒ 1）。 */
function bedSmooth(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
/** 換了天氣（08_sea.js vxInit 叫）：載好的塊照新的漩渦重烤；有變 ⇒ 重算 BED.top、再發一次 'bedChunk'（海底網格、白沫、樹照新的高度重建）。 */
function bedVxSync() {
  if (!BED || !BED.A || !BED.slot) return;
  var re = [], any = false, all = BED.slot.concat(BED.mslot || []);
  all.forEach(function (C) { if (C && bedVxBake(C)) { any = true; if (bedShowC(bedKey(C.cx, C.cy)) === C) re.push(C); } });   // 中等塊照樣重烤（模擬讀得到）；畫面只重建畫著的那一份
  if (!any) return;
  BED.top = -Infinity; all.forEach(function (C) { if (C) BED.top = Math.max(BED.top, C.max); });
  re.forEach(function (C) { evEmit('bedChunk', C.cx, C.cy, C); });
}
/** 焦點（世界座標）⇒ 換中心：要的塊（中心 ± ring＋prefetch）載進來、不要的（也不在任何船旁邊）丟掉。first ⇒ 回傳等全部載好的 Promise。畫面迴圈每格叫（90_main.js）。 */
function bedFocus(fx, fz, first) {
  var A = BED.A, cx = Math.floor((fx + BED.ax) / A.chunk), cy = Math.floor((fz + BED.az) / A.chunk);
  if (!first && cx === BED.cx && cy === BED.cy) return null;
  BED.cx = cx; BED.cy = cy;
  var R = bedRingN(BED_CFG.ring) + bedRingN(BED_CFG.prefetch), ps = [];
  if (BED.mid) return bedFocusMid(cx, cy, R, fx, fz);
  for (var j = cy - R; j <= cy + R; j++) for (var i = cx - R; i <= cx + R; i++) ps.push(bedLoad(i, j));
  var keep = bedNear();
  Object.keys(BED.ch).forEach(function (k) {
    var C = BED.ch[k]; if (Math.abs(C.cx - cx) <= R && Math.abs(C.cy - cy) <= R || keep[k]) return;
    delete BED.ch[k]; BED.slot[bedIdx(C.cx, C.cy)] = undefined; BED.drops++; evEmit('bedDrop', C.cx, C.cy);
  });
  return Promise.all(ps);
}
/** 開場要等的（也是模擬每一步要讀的）那幾塊：焦點最近的塊角 ± m 公尺 ⇒ [x0, x1, y0, y1]（塊號）。
 *  Tim 2026-10-22「開場要等的塊 可以縮小範圍 先試看看改成36」：原精度 ± BED_NEED_FULL、中等塊 ± BED_NEED_MID ⇒ 512 m 的塊 2×2＋6×6 ＝ 36 塊（以前照 ring 圈：原精度 5×5、中等塊到 9×9 ＝ 81 塊）。
 *  焦點離塊角最多半塊 ⇒ 原精度至少還有半塊（256 m）、中等塊至少 1,280 m；外面照舊背景預載到 ring＋prefetch 圈。 */
var BED_NEED_FULL = 512, BED_NEED_MID = 1536;
function bedNeedBox(fx, fz, m) {
  var A = BED.A, gx = Math.round((fx + BED.ax) / A.chunk), gy = Math.round((fz + BED.az) / A.chunk), h = Math.max(1, Math.ceil(m / A.chunk));
  return [gx - h, gx + h - 1, gy - h, gy + h - 1];
}
function bedInBox(b, i, j) { return i >= b[0] && i <= b[1] && j >= b[2] && j <= b[3]; }
/** 外圈用中等塊（BED.mid）時的換中心：先要「這一步模擬要讀的」—— bedNeedBox 的原精度、中等塊（回傳等它們的 Promise；原精度先、同一種裡鏡頭看得到的先 ——
 *  Tim 2026-10-22「進入航行時優先載入視野範圍部分」）；再背景預載 —— R 圈內的原精度（焦點走過去就變成在用的）、再外一圈的中等塊。
 *  丟：原精度超出 R 圈、中等塊超出 R＋X 圈（X ＝ 1024 m 換成的塊數；都不在任何船旁邊）。 */
function bedFocusMid(cx, cy, R, fx, fz) {
  var X = bedRingN(1), L = [], Fb = bedNeedBox(fx, fz, BED_NEED_FULL), Mb = bedNeedBox(fx, fz, BED_NEED_MID);
  for (var j = cy - R - X; j <= cy + R + X; j++) for (var i = cx - R - X; i <= cx + R + X; i++)
    L.push([i, j, Math.max(Math.abs(i - cx), Math.abs(j - cy)), Math.hypot(i - cx, j - cy) * bedViewK(i, j), bedInBox(Fb, i, j) ? 0 : bedInBox(Mb, i, j) ? 1 : 2]);
  L.sort(function (a, b) { return a[4] - b[4] || a[3] - b[3] || a[1] - b[1] || a[0] - b[0]; });   // 要等的（原精度、中等塊）先，同一種裡照「離焦點 × 鏡頭看不看得到」
  var need = [];
  L.forEach(function (c) { if (c[4] === 0) need.push(bedLoad(c[0], c[1])); else if (c[4] === 1) need.push(bedLoadMid(c[0], c[1])); });
  L.forEach(function (c) { if (c[4] && c[2] <= R) bedLoad(c[0], c[1], true).catch(bedBgErr); else if (c[2] > R) bedLoadMid(c[0], c[1], true).catch(bedBgErr); });
  var keep = bedNear();
  Object.keys(BED.ch).forEach(function (k) {
    var C = BED.ch[k]; if (Math.abs(C.cx - cx) <= R && Math.abs(C.cy - cy) <= R || keep[k]) return;
    delete BED.ch[k]; BED.slot[bedIdx(C.cx, C.cy)] = undefined; BED.drops++;
    if (BED.cm[k]) evEmit('bedChunk', C.cx, C.cy, BED.cm[k]); else evEmit('bedDrop', C.cx, C.cy);   // 還有中等塊 ⇒ 畫面換畫它
  });
  Object.keys(BED.cm).forEach(function (k) {
    var C = BED.cm[k]; if (Math.abs(C.cx - cx) <= R + X && Math.abs(C.cy - cy) <= R + X || keep[k]) return;
    delete BED.cm[k]; BED.mslot[bedIdx(C.cx, C.cy)] = undefined;
    if (!BED.ch[k]) evEmit('bedDrop', C.cx, C.cy);
  });
  return Promise.all(need);
}
function bedBgErr(e) { console.warn('海圖背景預載：' + e.message); }
/** 外圈用中等塊時，模擬每一步讀哪一份（BED.lv：0 ＝ 不讀（深海）、1 ＝ 中等塊、2 ＝ 原精度）——
 *  只照「這一步」的船算：焦點 ＝ 還在打的船的中心（跟 bedFocusAuto 同一條），bedNeedBox 的原精度那幾塊與每艘船 margin 內 ⇒ 2，中等塊那幾塊裡其他的 ⇒ 1（2026-10-22 以前照 ring／ring＋prefetch 圈）。
 *  ⛔ 不看哪一份已經到了：先到的背景預載不會讓模擬提早改讀原精度 ⇒ 戰局跟載入快慢無關（bedWait 等到要讀的那一份到了才走）。回傳缺的塊 [[cx, cy, lv]…]。 */
function bedLevels(fx, fz) {
  var A = BED.A, lv = BED.lv, Fb = bedNeedBox(fx, fz, BED_NEED_FULL), Mb = bedNeedBox(fx, fz, BED_NEED_MID), miss = [];
  lv.fill(0);
  for (var j = Mb[2]; j <= Mb[3]; j++) for (var i = Mb[0]; i <= Mb[1]; i++) { var q = bedIdx(i, j); if (q >= 0) lv[q] = bedInBox(Fb, i, j) ? 2 : 1; }
  var near = bedNear(); Object.keys(near).forEach(function (k) { var q = bedIdx(near[k][0], near[k][1]); if (q >= 0) lv[q] = 2; });
  for (q = 0; q < lv.length; q++) if (lv[q] && BED.has[q] && !(lv[q] === 2 ? BED.slot[q] : BED.mslot[q])) miss.push([A.x[0] + q % BED.nx, A.y[0] + Math.floor(q / BED.nx), lv[q]]);
  return miss;
}
/** 每艘還在的船 margin 公尺內的塊（鍵 ⇒ true）。 */
function bedNear() {
  var A = BED.A, M = BED_CFG.margin, out = {};
  SHIPS.forEach(function (sh) {
    if (sh.sunk) return;
    var e = sh.px + BED.ax, s = sh.pz + BED.az;
    for (var j = Math.floor((s - M) / A.chunk); j <= Math.floor((s + M) / A.chunk); j++)
      for (var i = Math.floor((e - M) / A.chunk); i <= Math.floor((e + M) / A.chunk); i++) out[bedKey(i, j)] = [i, j];
  });
  return out;
}
/** 模擬這一步可不可以走：每艘船 margin 內有檔的塊都載好了 ⇒ false；還沒 ⇒ 叫它載、回 true（畫面迴圈這一格先不走模擬）。 */
function bedWait() {
  if (!BED || !BED.A) return false;
  if (BED.win && bedWinOut()) { bedWinAsk(bedFocusAt()); BED.miss++; return true; }   // 有船的 margin 出了海域的窗 ⇒ 等新的窗（平常換得早，等不到這裡）
  if (BED.mid) {                                                         // 外圈用中等塊：這一步要讀的每一份都到了才走（bedLevels）
    var f = bedFocusAt(), miss = bedLevels(f[0], f[1]);
    miss.forEach(function (c) { (c[2] === 2 ? bedLoad : bedLoadMid)(c[0], c[1]).catch(bedBgErr); });
    if (miss.length) BED.miss++;
    return miss.length > 0;
  }
  var near = bedNear(), wait = false;
  Object.keys(near).forEach(function (k) {
    var c = near[k], i = bedIdx(c[0], c[1]);
    if (i >= 0 && BED.has[i] && !BED.slot[i]) { bedLoad(c[0], c[1]); wait = true; }
  });
  if (wait) BED.miss++;
  return wait;
}
/** 焦點（畫面迴圈每格）：換中心；海域跟著旗艦走 ⇒ 順便看要不要換窗。 */
function bedFocusAuto() {
  if (!BED || !BED.A) return;
  var f = bedFocusAt();
  if (BED.win) bedWinAsk(f);
  bedFocus(f[0], f[1], false);
}
/** 焦點：旗艦（玩家開的那艘）；沉了／沒有 ⇒ 還在打的船的中心（都沒了 ⇒ 鏡頭看的地方）。 */
function bedFocusAt() {
  var me = SHIPS[PLAYER_I];
  if (me && !me.sunk) return [me.px, me.pz];
  var x = 0, z = 0, n = 0;
  SHIPS.forEach(function (sh) { if (!sh.sunk) { x += sh.px; z += sh.pz; n++; } });
  if (!n) { x = CAM.eye[0]; z = CAM.eye[2]; n = 1; }
  return [x / n, z / n];
}
/** 海域跟著旗艦走：這一刻要的窗跟現在的不夠 ⇒ 跟外面那一頁要（一次一個；出錯 2 秒後再要）。 */
function bedWinAsk(f) {
  if (!BED.win || BED.winP || performance.now() < BED.winErr) return;
  var w = bedWinNeed(f); if (!w) return;
  BED.winP = { x: [w[0], w[1]], y: [w[2], w[3]], t: performance.now() };
  BED.host.postMessage({ bsmap: 'need', what: 'win', x: BED.winP.x, y: BED.winP.y }, '*');
}
/** 窗的半徑（塊數）：畫質的「海圖讀取範圍」換成塊數，不超過外面那一頁給的 area.win。換畫質 ⇒ 下一次換窗照新的（變大 ⇒ 現在的窗不夠，馬上換）。 */
function bedWinR() { var g = GFX.chartr != null ? GFX.chartr : BED_WIN_M.length - 1; return Math.max(1, Math.min(BED.win, Math.ceil(BED_WIN_M[g] / BED.A.chunk))); }
/** 要的窗 [x0, x1, y0, y1]：旗艦那一塊 ± bedWinR()，再撐到蓋住每艘船 margin 內的塊；現在的窗還留著 ± (半徑 − 換窗的那幾成) 而且蓋住每艘船、也沒有比要的大一圈以上 ⇒ null（不用換）。 */
function bedWinNeed(f) {
  var A = BED.A, w = bedWinR(), m = w - Math.max(1, Math.round(w * BED_WIN_SHIFT)), cx = Math.floor((f[0] + BED.ax) / A.chunk), cy = Math.floor((f[1] + BED.az) / A.chunk);
  var x0 = cx - w, x1 = cx + w, y0 = cy - w, y1 = cy + w, near = bedNear(), out = false;
  Object.keys(near).forEach(function (k) { var c = near[k]; x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]); if (bedIdx(c[0], c[1]) < 0) out = true; });
  var big = (A.x[1] - A.x[0]) - (x1 - x0) > 2 || (A.y[1] - A.y[0]) - (y1 - y0) > 2;   // 窗比要的大一圈以上（開場的海域照地球儀那一頁的 ±4 km、畫質是「近」2 km；調低了畫質）⇒ 換成小的（窗外的塊、遠景丟掉）
  if (!out && !big && A.x[0] <= cx - m && A.x[1] >= cx + m && A.y[0] <= cy - m && A.y[1] >= cy + m) return null;
  return [x0, x1, y0, y1];
}
/** 讀的先後（排序用的距離倍數）：塊 (cx, cy) 的中心在鏡頭水平朝向的 70° 內、或離鏡頭不到一塊半 ⇒ 1；在背後 ⇒ BED_VIEW_BACK。鏡頭幾乎正下方（轉場俯瞰）⇒ 都算 1。只排先後，⛔ 不影響要不要載。 */
function bedViewK(cx, cy) {
  var e = CAM.eye, l = CAM.look; if (!e || !l) return 1;
  var fx = l[0] - e[0], fz = l[2] - e[2], fl = Math.hypot(fx, fz); if (fl < 1e-3 || fl < 0.2 * Math.abs(l[1] - e[1])) return 1;
  var A = BED.A, x = (cx + 0.5) * A.chunk - BED.ax - e[0], z = (cy + 0.5) * A.chunk - BED.az - e[2], d = Math.hypot(x, z);
  if (d < 768) return 1;                                                // 離鏡頭 768 m 內一律算看得到（以前 1.5 塊 ＝ 1,536 m；Tim 2026-10-22「進入航行時優先載入視野範圍部分」⇒ 開場那 36 塊裡也分得出前後）
  return (x * fx + z * fz) / (d * fl) > 0.34 ? 1 : BED_VIEW_BACK;          // cos 70°
}
/** 有船 margin 內的塊在窗外。 */
function bedWinOut() { var near = bedNear(); return Object.keys(near).some(function (k) { return bedIdx(near[k][0], near[k][1]) < 0; }); }
/** 新的窗到了（{ x, y, chunks, towns? }）：照新的範圍重排 BED.has／slot／mslot／lv（載好的塊照用）；窗外的丟掉（'bedDrop'）；
 *  遠景、小地圖照 'bedWin'（舊的範圍）跟著換；新進來的城去要規劃（townGot 照 id 不收重複的）。 */
function bedWinApply(d) {
  var A = BED.A, t0 = performance.now(); if (!d.x || !d.y || !d.chunks) return;
  var ox = A.x.slice(), oy = A.y.slice(), gone = {};
  A.x = [d.x[0], d.x[1]]; A.y = [d.y[0], d.y[1]]; A.chunks = d.chunks; BED.nx = A.x[1] - A.x[0] + 1;
  var N = BED.nx * (A.y[1] - A.y[0] + 1);
  BED.has = new Uint8Array(N); A.chunks.forEach(function (c) { var i = bedIdx(c[0], c[1]); if (i >= 0) BED.has[i] = c[2] ? 1 : 0; });
  BED.slot = new Array(N); if (BED.mid) { BED.mslot = new Array(N); BED.lv = new Uint8Array(N); }
  Object.keys(BED.ch).forEach(function (k) { var C = BED.ch[k], i = bedIdx(C.cx, C.cy); if (i >= 0 && BED.has[i]) BED.slot[i] = C; else { delete BED.ch[k]; BED.drops++; gone[k] = [C.cx, C.cy]; } });
  Object.keys(BED.cm).forEach(function (k) { var C = BED.cm[k], i = bedIdx(C.cx, C.cy); if (i >= 0 && BED.has[i]) BED.mslot[i] = C; else { delete BED.cm[k]; gone[k] = [C.cx, C.cy]; } });
  Object.keys(gone).forEach(function (k) { evEmit('bedDrop', gone[k][0], gone[k][1]); });
  if (d.towns && d.towns.length) {
    var T = A.towns || [], add = d.towns.filter(function (id) { return T.indexOf(id) < 0; });
    if (add.length) { A.towns = T.concat(add); townWant(); }
  }
  BED.cx = BED.cy = null;                                                // 下一格 bedFocus 照新的窗重排要載、要丟的
  if (BED.mid) { var f = bedFocusAt(); bedLevels(f[0], f[1]); }          // lv 照新的編號馬上重算（模擬每一步之前本來就會算；這裡是給這一格的鏡頭、畫面查高度）
  BED.wins++; BED.winMs = +(performance.now() - t0).toFixed(1);
  evEmit('bedWin', ox, oy);
}
// 查詢：世界 (x, z) ⇒ 那一塊的取樣格（g：海域裡第幾個取樣點，含小數）
function bedCell(x, z) {
  var A = BED.A, gx = (x + BED.ax) / A.step, gz = (z + BED.az) / A.step, cx = Math.floor(gx / BED.G), cy = Math.floor(gz / BED.G), i = bedIdx(cx, cy);
  if (BED.mid) {                                                         // 外圈用中等塊：照 bedLevels 定的那一份讀（⛔ 不是「有哪一份就讀哪一份」）
    var lv = i >= 0 ? BED.lv[i] : 0, M = lv === 2 ? BED.slot[i] : lv === 1 ? BED.mslot[i] : null, s = M ? A.step / M.step : 1;
    return M ? { C: M, u: (gx - cx * BED.G) * s, v: (gz - cy * BED.G) * s } : null;
  }
  var C = i >= 0 ? BED.slot[i] : null;
  return C ? { C: C, u: gx - cx * BED.G, v: gz - cy * BED.G } : null;
}
/** 海底／地面高度（m；海面 0）。 */
function bedHgt(x, z) {
  var q = bedCell(x, z); if (!q) return BED.A.deep + (VX ? vxH(x, z) : 0);   // 大漩渦：深海也在那一點的水面下（bedVxBake）
  var C = q.C, n = C.n, i = Math.min(n - 2, Math.floor(q.u)), j = Math.min(n - 2, Math.floor(q.v)), fu = q.u - i, fv = q.v - j, h = C.h, o = j * n + i;
  return ((h[o] * (1 - fu) + h[o + 1] * fu) * (1 - fv) + (h[o + n] * (1 - fu) + h[o + n + 1] * fu) * fv) / 10;
}
/** 底質（最近的取樣點）。 */
function bedMat(x, z) { var q = bedCell(x, z); if (!q) return BED_MAT.DEEP; var n = q.C.n; return q.C.mat[Math.min(n - 1, Math.round(q.v)) * n + Math.min(n - 1, Math.round(q.u))]; }
/** 坡度 [∂h/∂x, ∂h/∂z]（往高處）。 */
function bedGrad(x, z) { var e = BED.A.step; return [(bedHgt(x + e, z) - bedHgt(x - e, z)) / (2 * e), (bedHgt(x, z + e) - bedHgt(x, z - e)) / (2 * e)]; }
