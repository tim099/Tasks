// ───────────────────────── 戰鬥報表（TASK-0620）─────────────────────────
// Tim 2026-10-15：「可以記錄戰鬥報表，用來分析戰鬥中的問題，例如船員數量曲線、炮數曲線、開炮命中率等需要分析的資料」
// ⛔ 只讀不寫：不抽亂數、不改任何戰局狀態 ⇒ 開著、關著（?report=0）戰局逐位元組相同；?dump=1 沒帶 report=1 ⇒ dump 跟以前逐字相同。
// 記什麼：
//   · 每 0.5 秒（30 步，跟 survey 同一拍）掃每艘的砲：每門砲六種狀態各待了幾秒（跟 HUD 砲圖同一套判法 rptGunState）、第一次「沒了」的時間。
//   · 每 RPT_EVERY 秒一列時間線（欄位見 RPT_COLS）：船員、砲、開火命中、被打、進水、傾斜、航速、帆、出力。
//   · 每一發（fireShot）記是哪一門開的；第一次打中（21_gunnery.js stepBall／impact，跟 sh.hits 同一個點）記打中哪艘、打中什麼：
//     gun 砲 ／ model 其他模型 ／ armor 砲帶的裝甲 ／ hull 船殼；打到友艦另記 ff。
// 看得到的地方：結束畫面「📊 報表」（曲線、表、匯出 JSON／CSV）；?dump=1&report=1 的 #dump 帶同一份（rptData）；__game.report()（?debug=1）。
// 分析多場：src/report.py（無頭跑幾個種子、讀 #dump 的 report ⇒ 每型船的平均曲線、砲啞掉的原因）。
var RPT_ON = Q.get('report') !== '0';                                   // ?report=0：整個不記（量成本的對照組）
var RPT_EVERY = 5;                                                       // 時間線每幾秒一列
var RPT_COLS = ['t', 'able', 'wounded', 'dead', 'swim', 'guns', 'ready', 'reload', 'nocrew', 'powder', 'wet', 'fired', 'hits', 'taken', 'lost', 'water', 'list', 'kn', 'sail', 'power'];
//   able 能打的人（沒受傷、沒落水）／wounded 受傷（含抬下去的）／dead 陣亡（累計）／swim 在水裡還活著／guns 還在的砲
//   ready 可以開（裝好了，只是沒有目標或在等齊射；每門砲的 bear ＝ 其中目標在射界內的秒數 ⇒ ready − bear ＝ 敵艦不在射界）／reload 裝填中／nocrew 人不夠／powder 等火藥（藥箱空了）／wet 泡水
//   fired、hits 累計開火、命中／taken 累計被打中／lost 被打掉的格數／water 進水（噸）／list 橫傾（度）／kn 航速（節）／sail 帆／power 俥鐘（−1～1）
var RPT_ST = ['ready', 'reload', 'nocrew', 'gone', 'powder', 'wet'];   // rptGunState 的六種（數字跟 61_hud.js 的砲圖一樣）
var RPT = null;
function rptReset() { RPT = RPT_ON ? { ships: [], ms: 0, n: 0 } : null; }
/** 這一門砲現在的狀態（跟 61_hud.js 砲圖同一套）：0 可開 1 裝填 2 沒人 3 沒了 4 等火藥 5 泡水。 */
function rptGunState(g) { return !g.alive ? 3 : g.wet ? 5 : gunRate(g) <= 0 ? 2 : g.needCart && !(g.box > 0) ? 4 : g.reload > 0 ? 1 : 0; }
/** 第 i 艘的那一份（第一次用到才建：援軍半路進場也有）。 */
function rptShip(sh) {
  var r = RPT.ships[sh.i];
  if (!r) r = RPT.ships[sh.i] = { id: sh.T.id, name: sh.T.name, team: sh.team, from: +SIMT.toFixed(1), crew0: sh.crew.length, out: null, taken: 0, takenOn: {}, tl: [],
    guns: sh.guns.map(function (g) { return { name: g.name, type: g.type, side: g.side, shots: 0, hits: 0, on: {}, st: [0, 0, 0, 0, 0, 0], bear: 0, bearNo: 0, goneAt: null }; }) };
  return r;
}
/** 每一步（50_sim.js 最後）：每 30 步掃砲的狀態，每 RPT_EVERY 秒記一列。 */
function rptTick() {
  if (!RPT) return;
  var k = Math.round(SIMT / DT), ev = everySteps(0.5); if (k % ev) return;   // 每半秒（60 Hz ＝ 30 步；擬真沙盒降物理 fps 照秒數）
  var t0 = performance.now(), row = k % Math.round(RPT_EVERY / DT) === 0, dt = ev * DT;
  SHIPS.forEach(function (sh) {
    var r = rptShip(sh);
    if (r.out === null && isOut(sh)) r.out = +SIMT.toFixed(1);
    var foe = r.out === null ? foeOf(sh) : null;
    if (r.out === null) sh.guns.forEach(function (g, j) { var G = r.guns[j], s = rptGunState(g); if (!G) return; G.st[s] += dt; if (s === 3 && G.goneAt === null) G.goneAt = +SIMT.toFixed(1);
      if ((s === 0 || s === 2) && foe && foe.center && gunTarget(sh, g, foe.center)) { if (s === 0) G.bear += dt; else G.bearNo += dt; } });   // bearNo：目標在射界內、砲卻沒人（人不夠）的秒數（TASK-0722：閒著的砲班放出去補位，量這一格變少沒）   // bear：可開的時間裡，目標（foeOf）在射界內的秒數（Tim 2026-10-16 查維吉尼亞號：可開 85% 幾乎都是「裝好了、敵艦不在射界」）
    if (row) r.tl.push(rptRow(sh, r));
  });
  RPT.ms += performance.now() - t0; RPT.n++;
}
function rptRow(sh, r) {
  var able = 0, swim = 0, n = [0, 0, 0, 0, 0, 0];
  sh.crew.forEach(function (c) { if (c.swim) { if (!c.swim.dead) swim++; } else if (c.st === 0) able++; });
  sh.guns.forEach(function (g) { n[rptGunState(g)]++; });
  return [Math.round(SIMT), able, sh.wounded, sh.dead, swim, sh.guns.length - n[3], n[0], n[1], n[2], n[4], n[5], sh.fired, sh.hits, r.taken, sh.lost,
    sh.fl ? Math.round(sh.fl.vol * RHO_W) : 0, +(Math.abs(sh.rollA) * 57.3).toFixed(1), +(sh.spd * 1.944).toFixed(1), +sh.sailFrac.toFixed(2), +(sh.power || 0).toFixed(2)];
}
/** 一發砲彈出膛（21_gunnery.js fireShot）：記在那一門上，砲彈帶著它（b.rg）⇒ 打中時算回那一門。 */
function rptOnShot(sh, g, b) {
  if (!RPT) return;
  var G = rptShip(sh).guns[sh.guns.indexOf(g)]; b.rg = g; if (G) G.shots++;
}
/** 這發第一次打中別艘（21_gunnery.js，跟 sh.hits++ 同一個點）：what ＝ gun／model／armor／hull。 */
function rptOnHit(b, sh, what) {
  if (!RPT || !b.rg) return;
  var o = SHIPS[b.owner], G = rptShip(o).guns[o.guns.indexOf(b.rg)], rt = rptShip(sh), w = isFoe(o, sh) ? what : 'ff';
  if (G) { G.hits++; G.on[w] = (G.on[w] || 0) + 1; }
  rt.taken++; rt.takenOn[w] = (rt.takenOn[w] || 0) + 1;
}
/** 艦長的決定（54_helm.js helmSay）：[秒, 種類, 理由]；一艘最多 RPT_HELM_MAX 筆（超過 ⇒ 丟最早的、記丟了幾筆）。只讀：不改戰局。 */
var RPT_HELM_MAX = 400;
function rptOnHelm(sh, kind, text) { if (!RPT) return; var r = rptShip(sh), L = r.helm || (r.helm = []); L.push([+SIMT.toFixed(1), kind, text]); if (L.length > RPT_HELM_MAX) { L.shift(); r.helmDrop = (r.helmDrop || 0) + 1; } }
// 訂閱（TASK-0669：模擬層只發事件，00_events.js）
evOn('rptShot', rptOnShot); evOn('rptHit', rptOnHit); evOn('rptHelm', rptOnHelm); evOn('stepEnd', rptTick, 0);
/** 整份報表（#dump、匯出、畫面都讀這一份）。最後一列補到現在。 */
function rptData() {
  if (!RPT) return null;
  return { v: 1, seed: SEED, t: +SIMT.toFixed(1), every: RPT_EVERY, cols: RPT_COLS, gunStates: RPT_ST, cost: { ticks: RPT.n, ms: +RPT.ms.toFixed(2) },
    ships: SHIPS.map(function (sh) {
      var r = rptShip(sh), tl = r.tl.slice(), now = rptRow(sh, r); if (!tl.length || tl[tl.length - 1][0] !== now[0]) tl.push(now);
      return { i: sh.i, id: r.id, name: r.name, team: r.team, from: r.from, out: r.out, fate: sh.fate || null, crew0: r.crew0, fired: sh.fired, hits: sh.hits, taken: r.taken, takenOn: r.takenOn,
        wounds: sh.wounds, dead: sh.dead, causes: sh.causes || {}, armor: sh.armRes ? Object.assign({}, sh.armRes) : null,   // armor：打在鐵甲上的實心彈 穿／凹／彈、爆裂彈炸在外面幾發（TASK-0621）
        guns: r.guns.map(function (G) { return { name: G.name, type: G.type, side: G.side, shots: G.shots, hits: G.hits, on: G.on, goneAt: G.goneAt, st: G.st.map(function (v) { return +v.toFixed(1); }), bear: +G.bear.toFixed(1), bearNo: +G.bearNo.toFixed(1) }; }),
        tl: tl, helm: r.helm || [], helmDrop: r.helmDrop || 0 };   // helm：艦長的決定（rptHelm）
    }) };
}
/** 匯出：JSON 整份；CSV 一艘一段時間線（欄 ＝ ship,name,team ＋ RPT_COLS）。⛔ 成品不准 fetch ⇒ 用 Blob 下載。 */
function rptSave(kind) {
  var d = rptData(); if (!d) return;
  var txt = kind === 'csv' ? ['ship,name,team,' + d.cols.join(',')].concat([].concat.apply([], d.ships.map(function (s) { return s.tl.map(function (row) { return [s.i, '"' + s.name + '"', s.team].concat(row).join(','); }); }))).join('\n')
    : JSON.stringify(d), a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([kind === 'csv' ? '﻿' + txt : txt], { type: kind === 'csv' ? 'text/csv' : 'application/json' }));
  a.download = 'blockside-report-seed' + SEED + '-' + Math.round(SIMT) + 's.' + kind; document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
// ── 畫面：結束畫面多一顆「📊 報表」⇒ 一頁曲線＋表 ──
function rptColor(d, s) {                                                // 藍方藍、紅方紅；同一隊第幾艘換深淺
  var same = d.ships.filter(function (o) { return o.team === s.team; }), k = same.indexOf(s), L = 62 - Math.min(k, 4) * 9;
  return s.team === 'blue' ? 'hsl(220,90%,' + L + '%)' : 'hsl(2,85%,' + L + '%)';
}
/** 一張曲線：f(ship, row) ⇒ 值；y 軸 0～max（max 沒給 ⇒ 取資料最大）。 */
function rptChart(cv, d, title, f, max, pct) {
  var dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 320, H = 130; cv.width = W * dpr; cv.height = H * dpr;
  var g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
  var T = Math.max(1, d.t), M = max || 0, padL = 40, padB = 16, padT = 24, w = W - padL - 6, h = H - padB - padT;
  if (!max) d.ships.forEach(function (s) { s.tl.forEach(function (row) { M = Math.max(M, f(s, row)); }); });
  if (!(M > 0)) M = pct ? 1 : 10;                                          // 整場都是 0 ⇒ 給個刻度，線貼在底
  g.fillStyle = '#aab'; g.font = '12px sans-serif'; g.fillText(title, padL, 13);
  g.font = '11px sans-serif'; g.strokeStyle = 'rgba(255,255,255,.15)'; g.lineWidth = 1; g.beginPath();
  for (var q = 0; q <= 2; q++) { var y = padT + h * q / 2, v = M * (1 - q / 2); g.moveTo(padL, y); g.lineTo(padL + w, y); g.fillText(pct ? Math.round(v * 100) + '%' : v >= 10 ? Math.round(v).toLocaleString() : String(+v.toFixed(1)), 2, y + 4); }
  g.stroke(); g.fillText(Math.round(T) + ' 秒', padL + w - 34, H - 3);
  d.ships.forEach(function (s) {
    g.strokeStyle = rptColor(d, s); g.lineWidth = 1.6; g.beginPath();
    s.tl.forEach(function (row, j) { var x = padL + w * row[0] / T, y = padT + h * (1 - Math.min(1, f(s, row) / M)); if (j) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
  });
}
function rptShow() {
  var d = rptData(), P = $('rpt'); if (!d) return;
  if (!P) {
    P = document.createElement('div'); P.id = 'rpt';
    P.style.cssText = 'position:absolute;inset:0;z-index:30;display:flex;align-items:flex-start;justify-content:center;overflow:auto;background:rgba(0,0,0,.55);padding:12px 0';
    P.innerHTML = '<div class="card panel" style="width:min(96vw,760px);padding:12px 14px;text-align:left;box-sizing:border-box;background:rgba(12,18,26,.95)"><h3 style="margin:0 0 6px">📊 戰鬥報表</h3>' +
      '<div id="rptL" style="font-size:12px;margin-bottom:6px"></div><div id="rptC"></div><div id="rptT" style="font-size:12px;overflow-x:auto"></div><div id="rptH" style="font-size:12px;margin-top:8px"></div>' +
      '<div style="margin-top:8px"><button id="rptJ">匯出 JSON</button> <button id="rptV">匯出 CSV</button> <button id="rptCL">🧪 匯出船員記錄</button> <button id="rptRL">🪢 匯出帆繩記錄</button> <button id="rptX">關閉</button></div></div>';
    document.body.appendChild(P);
    $('rptJ').onclick = function () { rptSave('json'); }; $('rptV').onclick = function () { rptSave('csv'); }; $('rptX').onclick = function () { P.style.display = 'none'; }; $('rptCL').onclick = tlgSave; $('rptRL').onclick = rlgSave;
  }
  P.style.display = 'flex'; $('rptCL').style.display = TLOG ? '' : 'none'; $('rptRL').style.display = RLOG ? '' : 'none';   // 測試模式、帆繩記錄開著才有（83_testlog.js、85_riglog.js；設定面板那兩項只在 ?debug=1 顯示）
  var I = {}; d.cols.forEach(function (c, j) { I[c] = j; });
  $('rptL').innerHTML = d.ships.map(function (s) { return '<span style="color:' + rptColor(d, s) + '">━ ' + s.i + ' ' + s.name + '</span>'; }).join('　');
  var C = $('rptC'); C.innerHTML = '';
  [['能打的船員', function (s, r) { return r[I.able] / Math.max(1, s.crew0); }, 1, true],
   ['開得動的砲（可開＋裝填＋等火藥）', function (s, r) { return (r[I.ready] + r[I.reload] + r[I.powder]) / Math.max(1, s.guns.length); }, 1, true],
   ['累計命中率', function (s, r) { return r[I.fired] ? r[I.hits] / r[I.fired] : 0; }, 0, true],
   ['被打掉的格數', function (s, r) { return r[I.lost]; }, 0, false],
   ['進水（噸）', function (s, r) { return r[I.water]; }, 0, false]].forEach(function (c) {
    var cv = document.createElement('canvas'); cv.style.cssText = 'display:block;width:100%;height:130px;position:static'; C.appendChild(cv);   // ⚠ canvas 有通用的 absolute inset 0 規則 ⇒ 蓋回 static
    rptChart(cv, d, c[0], c[1], c[2], c[3]);
  });
  function pc(a, b) { return b ? Math.round(a / b * 100) + '%' : '—'; }
  function on(o) { var k = Object.keys(o); return k.length ? k.map(function (w) { return ({ gun: '砲', model: '模型', armor: '裝甲', hull: '船殼', ff: '友艦', uw: '水下' })[w] + ' ' + o[w]; }).join('、') : '—'; }
  var th = 'style="padding:2px 6px;border-bottom:1px solid rgba(255,255,255,.2);white-space:nowrap"', td = 'style="padding:2px 6px;white-space:nowrap"';
  $('rptT').innerHTML = '<table style="border-collapse:collapse;margin-top:6px"><tr>' + ['船', '開火', '命中', '命中率', '打中什麼', '被打中', '傷／亡', '砲沒了', '砲的時間（可開／裝填／沒人／等火藥／泡水）'].map(function (h) { return '<th ' + th + '>' + h + '</th>'; }).join('') + '</tr>' +
    d.ships.map(function (s) {
      var on2 = {}, st = [0, 0, 0, 0, 0, 0], gone = s.guns.filter(function (G) { return G.goneAt !== null; });
      s.guns.forEach(function (G) { Object.keys(G.on).forEach(function (w) { on2[w] = (on2[w] || 0) + G.on[w]; }); G.st.forEach(function (v, j) { st[j] += v; }); });
      var live = st[0] + st[1] + st[2] + st[4] + st[5];
      return '<tr><td ' + td + '><span style="color:' + rptColor(d, s) + '">' + s.i + ' ' + s.name + '</span></td><td ' + td + '>' + s.fired + '</td><td ' + td + '>' + s.hits + '</td><td ' + td + '>' + pc(s.hits, s.fired) + '</td><td ' + td + '>' + on(on2) +
        '</td><td ' + td + '>' + s.taken + '（' + on(s.takenOn) + '）' + (s.armor ? '<br>鐵甲：穿 ' + s.armor.pen + '／凹 ' + s.armor.dent + '／彈 ' + s.armor.rico + '／爆裂彈 ' + s.armor.shell : '') + '</td><td ' + td + '>' + s.wounds + '／' + s.dead + '／' + s.crew0 + '</td><td ' + td + '>' + gone.length + '／' + s.guns.length + (gone.length ? '（最早 ' + Math.min.apply(null, gone.map(function (G) { return G.goneAt; })) + ' 秒）' : '') +
        '</td><td ' + td + '>' + [0, 1, 2, 4, 5].map(function (j) { return pc(st[j], live); }).join('／') + '</td></tr>';
    }).join('') + '</table><div style="color:var(--dim);margin-top:4px">記報表 ' + d.cost.ticks + ' 次、共 ' + d.cost.ms + ' ms；砲的時間只算還在的砲、船出局前。</div>';
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  $('rptH').innerHTML = '<b>🧭 艦長的決定</b>（時間、做了什麼、為什麼；換舷、拉開也會上方廣播）' + d.ships.map(function (s) {
    return '<details style="margin-top:4px"><summary><span style="color:' + rptColor(d, s) + '">' + s.i + ' ' + esc(s.name) + '</span>　' + s.helm.length + ' 筆' + (s.helmDrop ? '（最早的 ' + s.helmDrop + ' 筆沒留）' : '') + '</summary>' +
      '<div style="max-height:220px;overflow:auto;padding-left:8px">' + s.helm.map(function (h) { return '<div><span style="color:var(--dim)">' + h[0].toFixed(1) + ' 秒</span>　' + esc(h[2]) + '</div>'; }).join('') + '</div></details>';
  }).join('');
}
(function () {                                                           // 結束畫面多一顆「📊 報表」（template 那一排按鈕的最前面）
  var c = $('endC'); if (!c || !RPT_ON) return;
  var b = document.createElement('button'); b.id = 'endP'; b.textContent = '📊 報表'; b.onclick = rptShow; c.parentNode.insertBefore(b, c);
})();
rptReset();
