// ───────────────────────── 停格與進水細節頁（Tim 2026-10-13） ─────────────────────────
// P ＝「停格」（以前叫暫停；停住模擬、照樣能轉鏡頭）：上方出現一條「⏸ 停格中　進水：📊 圖表（I）🔍 透視（X）　▶ 繼續（P）」。設定、說明打開時不出現（它們自己會暫停）。
// 進水細節分兩個開關（Tim 2026-10-13：不然圖表會擋住 3D）—— 圖表只在停格時打得開；繼續 ⇒ 圖表收起、透視（與剖面、甲板）留著（2026-10-15）；
//   透視（X）、剖面（Z）、甲板（L）不停格也能切換（Tim 2026-10-16）：沒停格時切換 ⇒ 上方廣播一行「透視：開／關」，開著的那幾個寫在下方的觀察條（#obsB）：
//   📊 圖表（FLX，I）：數字與剖面的面板，右上 ✕ 也能關；🔍 透視（FLX3，X）：3D 裡的艙內水面與破口隔著船殼看得到，
//   而且船附近的海面與白沫不畫（Tim 2026-10-13：會影響觀察）⇒ 看得到水線下的船殼與破口。
//   兩艘各一段：數字（積水、破口（水下幾個）、進出水、抽水、下沉、傾斜、水的重心、粒子與水格）＋ 側視、俯視的剖面（艙內的水、破口、外面的水面、設計水線）。
//   透視：艙內的水面不做深度測試（33_flood.js flDraw）、破口畫成點（水下紅；水上橙、小而淡 —— 暴風雨打爛的船水上的洞上百個，⛔ 一樣大 ⇒ 糊成一片，flHoleMarks）。
// 公式模式沒有艙內的水 ⇒ 只寫公式的讀數。⛔ 只讀模擬、不改（停格中沒有在走）。
var FLX = false, FLX3 = false, FRZ_ON = false;
/** 每一格（90_main.js frame）：停格條顯示與否；繼續了 ⇒ 進水細節頁收起。 */
function frzShow() {
  var on = RUNNING && PAUSED && !GSET.open && !HELP.open;
  $('frz').classList.toggle('on', on); $('msg').style.visibility = on ? 'hidden' : '';   // 停格條跟上方廣播同一個位置（⛔ 不藏 ⇒ 廣播的字透過半透明的條）
  if (on !== FRZ_ON) { FRZ_ON = on; frzPlace(); }
  if (!on && FLX) floodClose();                                       // 繼續 ⇒ 只收 📊 圖表；🔍 透視、✂ 剖面、☰ 甲板保持（Tim 2026-10-15：「停格中可以切換的觀察模式，是否能在按下繼續後保持（這樣可以在遊戲中維持觀察狀態），除了圖表」）—— 要關 ⇒ 停格再按一次；新開一局 ⇒ obsReset（70_flow.js）
  $('frzFlood').classList.toggle('on', FLX); $('frzX').classList.toggle('on', FLX3);
  $('frzCut').classList.toggle('on', CUTV.half); $('frzDeck').classList.toggle('on', CUTV.deck > 0); $('frzDeck').textContent = deckLabel();
  var ob = $('obsB'), t = RUNNING && !PAUSED && !INSP.on ? obsText() : '';   // 沒停格、觀察模式開著 ⇒ 下方一條提醒（⛔ 停格時停格條已經寫了；設定、說明開著也是停格；船隻觀察的面板自己寫了 ⇒ 不重複，86_inspect.js）
  if (ob) { ob.classList.toggle('on', !!t); if (t && ob.textContent !== t) ob.textContent = t; }
}
/** 停格條跟上方那一塊（#topC：我艦的詳細資訊＋廣播）都在畫面上方正中間（Tim 2026-10-20「停格中跟船隻資訊會重疊」）：
 *  停格條出現、而且蓋到它 ⇒ 那一塊往下挪到停格條底下 6 px；收起 ⇒ 回原位。只在停格開關、換畫面大小時算（⛔ 不每一格量：量位置會逼瀏覽器重排）。
 *  手機（≤ 760 px）停格條本來就在 144 px 那一行、不在最上面 ⇒ 不挪。 */
function frzPlace() {
  var t = $('topC'), f = $('frz'); if (!t || !f) return;
  t.style.top = '';
  if (!FRZ_ON) return;
  var fr = f.getBoundingClientRect(), tr = t.getBoundingClientRect();
  if (fr.top <= tr.top + 1 && fr.bottom > tr.top) t.style.top = (f.offsetTop + f.offsetHeight + 6) + 'px';
}
window.addEventListener('resize', function () { if (FRZ_ON) frzPlace(); });
/** 開著的觀察模式（透視、剖面、甲板）寫成一行；都沒開 ⇒ ''。 */
function obsText() {
  var a = [];
  if (FLX3) a.push('🔍 透視（' + keyName('xray') + '）');
  if (CUTV.half) a.push('✂ 剖面（' + keyName('cut') + '）');
  if (CUTV.deck > 0) a.push(deckLabel());
  return a.join('　');
}
/** 沒停格時切換觀察模式 ⇒ 廣播一行（停格時停格條的按鈕就是回饋）。 */
function obsNote(text) { if (!PAUSED && SHIPS[PLAYER_I]) note(SHIPS[PLAYER_I], text); }
/** 船型 T 在格座標的 [中心 x, 中線 y, 半長, 半寬]（設計水線那一層；透視時拿掉附近海面用，01_gl.js nearShip）。 */
function xrBox(T) {
  if (!T.xrB) { var hb = 0; for (var x = T.wl0; x <= T.wl1; x++) hb = Math.max(hb, T.hullHB[T.zw * T.hullTW + x] || 0); T.xrB = [(T.wl0 + T.wl1) / 2, T.cy, (T.wl1 - T.wl0) / 2, hb]; }
  return T.xrB;
}
/** 新開一局：觀察模式全部收（透視、剖面、隱藏甲板、圖表）。 */
function obsReset() { if (FLX) floodClose(); FLX3 = false; CUTV.half = false; CUTV.deck = 0; }
function xrayToggle() { if (!RUNNING) return; FLX3 = !FLX3; obsNote('🔍 透視：' + (FLX3 ? '開' : '關')); frzShow(); }   // 按了就更新按鈕（⛔ 只靠每一格的 frzShow ⇒ 分頁在背景時按鈕不動）
function floodOpen() { if (!RUNNING || !PAUSED) return; FLX = true; $('floodp').classList.add('on'); floodPanel(); frzShow(); }
function floodClose() { FLX = false; $('floodp').classList.remove('on'); $('frzFlood').classList.remove('on'); }
function floodToggle() { if (FLX) floodClose(); else floodOpen(); }
$('frzFlood').onclick = floodToggle; $('frzX').onclick = xrayToggle;
$('frzGo').onclick = function () { flowPause(false); frzShow(); };
$('floodX').onclick = floodClose;
/** 流量（模擬裡是 m³/s）⇒ 「x 噸／分」：跟抽水同一個單位（Tim 2026-10-18「抽水是否可以用跟進水一樣的單位(或是反過來 進水也用噸/分)」；抽水在設定、滑桿、HUD 都是噸／分）。 */
function flTpm(q) { return (q * RHO_W * 60).toFixed(1) + ' 噸／分'; }
/** 淨進水（33_flood.js：最近 FL_AVG_T 秒的平均，flRates）：「+x 噸／分」水還在變多、「−x 噸／分（在退）」。 */
function flNetText(fl) { var t = flRates(fl).netQ * RHO_W * 60; return Math.abs(t) < 0.05 ? '0 噸／分' : t > 0 ? '+' + t.toFixed(1) + ' 噸／分' : '−' + (-t).toFixed(1) + ' 噸／分（在退）'; }
function fuDeg(a) { return (a * 57.2958).toFixed(1) + '°'; }
/** 填進水細節頁：兩艘各一段，畫完剖面。 */
function floodPanel() {
  var box = $('floodBody');
  box.innerHTML = SHIPS.map(function (sh, k) {
    var fl = sh.fl, who = (k === PLAYER_I ? '我艦' : sh.team === playerTeam() ? '友艦' : '敵艦') + ' ' + sh.name, lines;
    var tilt = '橫傾 ' + fuDeg(sh.rollA) + (sh.rollA > 0.002 ? '（往' + sideName('S') + '）' : sh.rollA < -0.002 ? '（往' + sideName('P') + '）' : '') + '・縱傾 ' + fuDeg(sh.pitchA) + (sh.pitchA < -0.002 ? '（船頭低）' : sh.pitchA > 0.002 ? '（船尾低）' : '');
    if (!fl || sh.broken) {
      lines = '<div>' + (sh.broken ? '斷成兩截 ⇒ 照公式（一定沉）' : '公式模式（物理效果「進水」選粒子才看得到艙內的水）') + '</div>' +
        '<div>水線下打掉 ' + (sh.inflow || 0).toLocaleString() + ' 格・下沉 ' + sh.sink.toFixed(2) + ' m・' + tilt + '</div>';
      return '<div class="fpS"><div class="fpH">' + who + '</div>' + lines + '</div>';
    }
    lines = '<div>艙內積水 <b>' + Math.round(fl.vol * RHO_W).toLocaleString() + ' 噸</b>（' + fl.vol.toFixed(1) + ' m³）・破口 ' + fl.open + ' 處 ' + fl.area.toFixed(2) + ' m²，水下 ' + fl.underN + ' 處 ' + fl.underA.toFixed(2) + ' m²' + (fl.outN ? '，往外流 ' + fl.outN + ' 處' : '') + '</div>' +
      '<div>' + FL_AVG_T + ' 秒平均：進水 ' + flTpm(flRates(fl).inQ) + '・往外流 ' + flTpm(flRates(fl).outQ) + '・抽水 ' + pumpNow(sh).toFixed(1) + ' 噸／分（實際 ' + flTpm(flRates(fl).pumpQ) + '）・<b>淨進水 ' + flNetText(fl) + '</b>・累計 進 ' + Math.round(fl.inTot * RHO_W).toLocaleString() + '／出 ' + Math.round(fl.outTot * RHO_W).toLocaleString() + '／抽掉 ' + Math.round(fl.pumped * RHO_W).toLocaleString() + ' 噸</div>' +
      '<div>下沉 ' + sh.sink.toFixed(2) + ' m（照水該 ' + fl.sinkT.toFixed(2) + '；4.2 m 開始沉）・' + tilt + '</div>' +
      '<div>水的重心：' + (Math.abs(fl.comY) < 0.05 ? '在中線' : '偏' + sideName(fl.comY > 0 ? 'S' : 'P') + ' ' + Math.abs(fl.comY).toFixed(1) + ' m') + '・' + (fl.comX >= 0 ? '偏船頭 ' : '偏船尾 ') + Math.abs(fl.comX).toFixed(1) + ' m・噴進來的水 ' + fl.J.n + ' 顆・水格 ' + fl.actN + ' 格（邊長 ' + (fl.F.c * S).toFixed(1) + ' m）</div>' +
      '<div class="fpL">側視（船頭在右）</div><canvas class="fpC" id="fpS' + k + '"></canvas><div class="fpL">俯視（船頭在右、' + sideName('P') + '在上）</div><canvas class="fpC" id="fpT' + k + '"></canvas>';
    return '<div class="fpS"><div class="fpH">' + who + '</div>' + lines + '</div>';
  }).join('');
  // 剖面等下一格再畫：⛔ 剛換掉 innerHTML 就量 clientWidth ⇒ 第一次打開量到 24 px（量過），剖面縮成一小塊
  requestAnimationFrame(function () { if (FLX) SHIPS.forEach(function (sh, k) { if (sh.fl && !sh.broken && $('fpS' + k)) { fpDraw($('fpS' + k), sh, 0); fpDraw($('fpT' + k), sh, 1); } }); });
}
window.addEventListener('resize', function () { if (FLX) floodPanel(); });
/** 艙內的水的顏色（Tim 2026-10-18「進水顏色深淺差異可以更明顯一點(而且可以有顏色變化 不單純是alpha變化)」）：f ＝ 0～1
 *  ⇒ 淺青 → 天藍 → 深藍 → 深靛紫，顏色與不透明度一起變（FL_RAMP 四個點之間線性內插）。詳細資訊的進水圖（61_hud.js gmapFlood：照水深）、進水細節頁的剖面同一套。 */
var FL_RAMP = [[0, 150, 235, 255, 0.55], [0.3, 60, 180, 240, 0.75], [0.6, 30, 100, 220, 0.88], [1, 70, 25, 150, 0.95]];
var FL_DEPTH_MAX = 4;                                                       // 俯視照水深上色：0 ～ 這麼多公尺（以上一樣深）⇒ 色階的頭到尾
/** f ⇒ [r, g, b, a（0～1）]。 */
function flWaterRGBA(f) {
  f = Math.max(0, Math.min(1, f));
  for (var i = 1; i < FL_RAMP.length; i++) if (f <= FL_RAMP[i][0] || i === FL_RAMP.length - 1) {
    var a = FL_RAMP[i - 1], b = FL_RAMP[i], u = (f - a[0]) / (b[0] - a[0]);
    return [1, 2, 3, 4].map(function (k) { return a[k] + (b[k] - a[k]) * u; });
  }
}
function flWaterCol(f) { var c = flWaterRGBA(f); return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + c[3].toFixed(2) + ')'; }
/** 圖說用的色帶（FL_RAMP 由少到滿）。 */
function flRampCss() { return 'linear-gradient(90deg,' + FL_RAMP.map(function (r) { return 'rgb(' + r[1] + ',' + r[2] + ',' + r[3] + ') ' + Math.round(r[0] * 100) + '%'; }).join(',') + ')'; }
/** 破口的顏色（進水細節頁、詳細資訊的進水圖同一套；33_flood.js flHoleState）：出水綠、在海面下紅、海面上橙。 */
function flHoleCol(fl, h) { return flHoleState(fl, h) === 'out' ? 'rgba(62,224,122,0.95)' : fl.hWet[h] ? 'rgba(255,60,50,0.95)' : 'rgba(255,170,40,0.85)'; }
/** 剖面：view 0 側視（x × z，沿船寬加總）、1 俯視（x × y，沿高度加總）。灰 ＝ 艙內空間、藍 ＝ 水（越滿越深）、紅點 ＝ 水下的破口、橙點 ＝ 水上的、青線 ＝ 外面的水面、虛線 ＝ 設計水線。 */
function fpDraw(cv, sh, view) {
  var fl = sh.fl, F = fl.F, c = F.c, NX = F.NX, NY = F.NY, NZ = F.NZ, NXY = NX * NY, Vc = Math.pow(c * S, 3), A = fl.A, cap = fl.cap;
  var NV = view ? NY : NZ, dpr = Math.min(window.devicePixelRatio || 1, 2), w = cv.clientWidth || 600, h = Math.max(40, Math.round(w * NV / NX));
  cv.style.height = h + 'px'; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  var g = cv.getContext('2d'), cw = cv.width / NX, ch = cv.height / NV, a, b, k;
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, cv.width, cv.height);
  var capS = new Float32Array(NX * NV), watS = new Float32Array(NX * NV);
  for (k = 0; k < F.N; k++) {
    if (!(cap[k] > 0.02)) continue;
    var ix = k % NX, iy = ((k / NX) | 0) % NY, iz = (k / NXY) | 0, j = (view ? iy : iz) * NX + ix;
    capS[j] += cap[k] * Vc; watS[j] += A[k];
  }
  for (b = 0; b < NV; b++) for (a = 0; a < NX; a++) {
    var q = b * NX + a; if (!(capS[q] > 0)) continue;
    var y0 = view ? b * ch : (NV - 1 - b) * ch;                          // 側視：z 往上；俯視（從上往下看、船頭在右）：格 +y（右舷）在下
    var X0 = Math.round(a * cw), X1 = Math.round((a + 1) * cw), Y0 = Math.round(y0), Y1 = Math.round(y0 + ch);   // 貼齊整數像素（⛔ 多畫半格 ⇒ 半透明疊兩次、接縫變深成網格紋）
    g.fillStyle = 'rgba(150,150,140,0.45)'; g.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
    if (watS[q] > 1e-4) { g.fillStyle = flWaterCol(view ? watS[q] / Math.pow(c * S, 2) / FL_DEPTH_MAX : watS[q] / capS[q]); g.fillRect(X0, Y0, X1 - X0, Y1 - Y0); }   // 俯視：水深；側視：那一層裝幾成
  }
  var M = sh.M, px = function (x) { return (x - F.X0) / c * cw; }, pv = function (v) { return view ? (v - F.Y0) / c * ch : cv.height - v / c * ch; };
  if (!view) {
    g.setLineDash([4 * dpr, 4 * dpr]); g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = dpr; g.beginPath(); g.moveTo(0, pv(sh.T.zw)); g.lineTo(cv.width, pv(sh.T.zw)); g.stroke(); g.setLineDash([]);
    g.strokeStyle = 'rgba(80,230,255,0.9)'; g.lineWidth = 1.5 * dpr; g.beginPath();
    for (a = 0; a <= NX; a++) {                                            // 外面的水面（中線上）：那一點的世界水面換回船上的高度
      var x = F.X0 + a * c, W0 = M4.pt(M, x, sh.T.cy, sh.T.zw), hs = seaH(W0[0], W0[2], SIMT), z = (hs - (M[1] * x + M[5] * sh.T.cy + M[13])) / M[9];
      if (a) g.lineTo(px(x), pv(z)); else g.moveTo(px(x), pv(z));
    }
    g.stroke();
  }
  fl.holes.forEach(function (hh) {
    if (!(fl.hA[hh] > 0) || (fl.hPort[hh] >= fl.hA[hh] - 1e-9 && !fl.hWet[hh])) return;   // 只有砲口、在海面上 ⇒ 不畫成破口（TASK-0822）
    var r = Math.max(1.5 * dpr, Math.sqrt(fl.hA[hh]) / 2 / (c * S) * cw * 1.3);   // 照洞的實際大小（⛔ 固定像素 ⇒ 手機上的剖面整排紅點糊成一條）
    g.fillStyle = flHoleCol(fl, hh); g.beginPath(); g.arc(px(fl.hX[hh]), pv(view ? fl.hY[hh] : fl.hZ[hh]), r, 0, 6.2832); g.fill();
  });
}
/** 透視開著：破口在 3D 裡畫成點（不做深度測試 ⇒ 隔著船殼看得到；60_render.js 瞄準圈那一批）。水下的紅、照洞的大小；水上的橙、小而淡。 */
function flHoleMarks(pushPt) {
  SHIPS.forEach(function (sh) {
    var fl = sh.fl; if (!fl || sh.broken || sh.sinkingFinal || sh.sunk) return;
    fl.holes.forEach(function (h) {
      if (!(fl.hA[h] > 0) || (fl.hPort[h] >= fl.hA[h] - 1e-9 && !fl.hWet[h])) return;   // 只有砲口、在海面上 ⇒ 不畫（TASK-0822）
      var P = M4.pt(sh.M, fl.hX[h], fl.hY[h], fl.hZ[h]), st = flHoleState(fl, h);
      if (st === 'out') pushPt(P, 0.2 + Math.sqrt(fl.hA[h]) * 0.6, [0.25, 0.88, 0.48], 0.9);   // 出水 ⇒ 綠
      else if (fl.hWet[h]) pushPt(P, 0.25 + Math.sqrt(fl.hA[h]) * 0.8, [1, 0.25, 0.2], 0.95); else pushPt(P, 0.12 + Math.sqrt(fl.hA[h]) * 0.25, [1, 0.65, 0.15], 0.45);
    });
  });
}
