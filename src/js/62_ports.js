// ───────────────────────── 砲門（TASK-0719；Tim 2026-10-19：「炮門可以開關(關閉時炮往內縮)」「可以加一個當炮口水線下時關閉炮門機制(必免進水)」；2026-10-21：「炮門在所有畫質下都預設顯示」「炮門開關選項多一個可以設定只顯示我艦(低畫質下預設這個)」）─────────────────────────
// 標法（雕刻作品的模型 meta；造船規格 §9.12、§9 kind 表 portlid 那一列）：kind=portlid（規格表 deco: true ⇒ 本身就是裝飾，05_hull.js isDeco；meta 不用另寫 deco=1）；
//   固定點 hinge-a、hinge-b（上緣的鉸鏈軸上兩點，蓋板子作品裡登記；軸 ＝ b − a、右手定則正轉 ＝ 往上掀；轉軸就是 .vxk 裡的固定點本身 —— 匯出時已經是格心，⛔ 照 25_doors.js 再加 0.5，見 portLid）；
//   lid_of=<砲的物件 id>（哪一門砲的蓋板；規格表 refs ⇒ 匯入檢查驗得到。⛔ 不照距離找最近的：船頭船尾的砲偏 10°，最近的不一定是自己那門）；
//   close_deg（從模型的樣子反轉幾度關上，預設 90）；house（關之前砲沿砲軸往船裡拉幾格，只是畫面；沒寫 ⇒ 照幾何算 portHouse）。
//   ⚠ 跟 door 相反：模型畫的是「開著」（水平往外伸）—— 這一項關掉、主選單、還沒開戰時就是這個樣子（砲推出去、蓋板開著，跟沒有蓋板的船一樣），觀測頁也不穿模。
// 三件事，各自分開：
//   · 戰局：一個值都不讀這裡。蓋板是裝飾（05_hull.js decoSplit 載入時從 rig.models 拿掉：不算重量、不擋彈、不抽亂數）；一律載入；畫質「砲門的開關演出」沒輪到這艘（portOn）⇒ 不演。
//     模擬那一條（砲口這一刻在海面下就不開）在 21_gunnery.js fireGun／burstStep（E1），跟這裡無關。
//   · 演出（畫面那一格：90_main.js frame 的 portsAnim，只在打仗中、沒暫停時跑；⛔ 不在 step() 裡、不抽亂數、不呼叫 foeOf）：
//     每 PORT_DT 秒（照 SIMT）照戰局現有的狀態判一次要開還是要關 —— 交戰中（射程 × PORT_RK、砲軸 ±PORT_ARC 內有還在打的敵艦，或 PORT_FIRED 秒內開過火；脫離 PORT_HOLD 秒才關）、
//     砲口乾著（g.wet 或 wetAt 照浪；乾了 PORT_DRY 秒才准再開）、沒降旗、沒在沉 ⇒ 開；sh.portWant（0 關、1 開）不是 null ⇒ 照它（只給宣傳片、除錯：遊戲裡沒有地方寫它）。
//     一片蓋板一個值 s ∈ [0, 2]：0–1 蓋板（0 關、1 開）、1–2 砲（1 縮著、2 推出）⇒「先掀蓋再推砲；先收砲再放蓋」（Falconer 1780，history §1.3）；從船頭往船尾每片晚 PORT_RANK 秒（泡水那一片不等）。
//     砲實際推出多少 ＝ (s − 1) × portLoad(g)：開火後被後座推進來、裝填剩 PORT_LOADQ 秒才推出去（跟 26_gunanim.js gunPhase 同一套讀法：SIMT、g.firedAt、g.reload）。
//     寫的只有畫面的欄位：蓋板 d.L（60_render.js 照它畫）、d.gone；砲 m.vsl（畫的時候左乘的位移；⛔ modelLocal 一行都不動 ⇒ 帆的碰撞、斷船、打飛的 M0 都看不到，g.muz 也不動）。
//   · 打得壞（照戰局現有的狀態推，蓋板本身不吃砲彈；kaguya 2026-10-19 拍板 B 案）：鉸鏈旁那一格船殼沒了（d.foot，10_ship.js）／關上時貼著的那一圈船殼掉了 PORT_RING 格以上／
//     蓋板沒全開（s < 1）時那門砲被打中或打飛 ⇒ 蓋板沒了（不畫）、之後 s 至少 1 ＝ 那個砲門一直開著（木匠補好船殼也不回來）。砲打飛時蓋板全開著 ⇒ 蓋板留著、一直開著（沒人關了）。
// 畫質「砲門的開關演出」（GFX.port：0 關、1 每艘、2 只有我艦；07_gfx.js）：一艘一艘看 portOn —— 沒輪到 ⇒ 蓋板開著、砲推出去，都不動（從演切到不演那一格清一次 portsOffShip）。
//   蓋板每艘、每個畫質都畫，不看「裝飾」也不看這一項（60_rbatch.js rbatShip；render 管線大修 S14 —— Tim 2026-10-21「炮門在所有畫質下都預設顯示」「實際看過炮門的重要性太高了(演出差很多)」，之後 Tim 發現低畫質別艘沒有蓋板）；
//   這一項只管演不演：輪到的船演，沒輪到的船停在模型的樣子（蓋板開著、砲推出去）。「只有我艦」＝ SHIPS[PLAYER_I]：換船（52_fleet.js playerTake）⇒ 下一格原本那艘清回去、新的那艘 snap。
//   （10-19 到 10-21：蓋板跟著「裝飾」走、低畫質不畫不演；10-21 起輪到的才不看「裝飾」、沒輪到的照「裝飾」—— S14 起一律畫）
// 後座（Tim 2026-10-20：「另外是否可以讓沒有炮門的炮 也有後座力呢」「不過要注意排除弩炮 投石機等(要根據meta判斷)」）：沒有蓋板的砲，
//   開火照同一條曲線（portLoad：GUN_SNAP 秒退到底、裝填剩 PORT_LOADQ 秒推出去）沿砲軸往船裡退 recoilDist 格 —— 只寫 m.vsl，跟蓋板那一段同一個欄位、同一個畫質項（GFX.port）。
//   退多少（recoilDist，照模型 meta）：meta recoil（格；0 ＝ 不演）先看 ⇒ 固定彈種（meta ammo，沒寫照 weapon／gun 對到的砲種表 ammo）是弩箭、火箭、石彈（ammoQuiet）、希臘火 ⇒ 不演（沒有火藥）
//   ⇒ 砲管長（固定點 muzzle → breech）× RECOIL_K、至少 PORT_HOUSE0 格；沒有固定點 ⇒ PORT_HOUSE0。
var RECOIL_K = 0.3;                                                    // 砲管長的三成（蘇士奎哈納號 8 吋砲 28.5 格 ⇒ 9 格，跟照蓋板量的 house 8–9 一樣）
var PORT_DT = 0.25, PORT_SNAP = 0.5;                                   // 每 0.25 模擬秒判一次開關；兩格之間 SIMT 往回走或一次跳超過 0.5 秒（換局、宣傳片拖時間、切幕）⇒ 直接擺成該有的樣子（snap）、不演
var PORT_UP = 0.8, PORT_RUN = 1.6, PORT_IN = 1.2, PORT_DOWN = 0.5, PORT_RANK = 0.1;   // 掀蓋、推砲出去、收砲、放蓋各幾秒（history §4.3：一人拉繩 2–3 秒、6–8 人推砲 5–10 秒，壓縮過）；依序掀起每片隔幾秒（演出的設計值；17 片排完 1.6 秒）
var PORT_RK = 1.2, PORT_ARC = 70 * Math.PI / 180, PORT_FIRED = 15, PORT_HOLD = 10, PORT_DRY = 3;   // 交戰：射程 × 1.2、砲軸 ±70°（比 bears 的 ±26° 寬 ⇒ 敵艦還在船頭斜前方就先備好）、15 秒內開過火；脫離 10 秒才關；乾了 3 秒才准再開（暴風雨的浪一打就開開關關）
var PORT_LOADQ = 1.6, PORT_RING = 4, PORT_HOUSE0 = 4, PORT_CLOSE0 = 90;   // 裝填剩 1.6 秒才推出去；四周的船殼掉 4 格 ⇒ 蓋板沒了；照幾何算的 house 至少 4 格（1–3 號開火時也看得到後座）；close_deg 沒寫 ⇒ 90°
var PORT_DEPTH = 0.25, PORT_EDGE = 0.02;                                  // 穿模的取樣點：從表面往實心那一邊挪 0.25 格、邊上的點往三角形重心挪 0.02 格（portPts）

/** 第一次碰到這艘船（portsAnim、__game.ports）：sh.decos 裡 kind=portlid 的蓋板配到砲。一片都沒有（或都配不到）⇒ null。
 *  鉸鏈缺、lid_of 配不到砲、兩片指同一門砲（留第一片）的那幾片不演（畫成模型的樣子；匯入檢查報 ✗，portsIssues）。 */
function portsBuild(sh) { var R = {}; stepsRun(portsSteps(sh, R)); return R.out; }
/** portsBuild 拆成步驟（2026-10-20；70_flow.js 開戰分段先建好 sh.ports，一艘約 0.05～0.19 s）：蓋板一片一片、做滿 12 ms 一步（stepsLoop），最後排順序 ⇒ R.out。照順序做 ＝ 拆之前的 portsBuild。 */
function portsSteps(sh, R) {
  var D = (sh.decos || []).filter(function (d) { return d.meta.kind === 'portlid'; }), L = [], used = [], out = [];
  R.out = null; if (!D.length) return out;
  out.push(stepsLoop(0, D.length, function (i) { var P = portLid(sh, D[i]); if (!P.hc || !P.g || used.indexOf(P.g) >= 0) return; used.push(P.g); L.push(P); }, 12));
  out.push(function () {
    if (!L.length) return;
    ['S', 'P'].forEach(function (sd) {                                   // 依序掀起：每一舷照砲口的 x 從船頭往船尾（跟 10_ship.js gunOrder 同一個方向）
      L.filter(function (P) { return P.g.side === sd; }).sort(function (a, b) { return b.g.muz[0] - a.g.muz[0]; }).forEach(function (P, k) { P.rank = k; });
    });
    R.out = { L: L, t: null, next: 0, ph: (sh.i % 8) / 8 * PORT_DT, cnt: -1, rest: false, fired: -1, fly: -1, cntF: -1 };   // ph：每艘錯開判斷的那一格（⛔ 同一格一起判 ⇒ 8 艘光榮號那一格多 0.5 ms）；cnt：上次判斷時船殼剩幾格（沒變 ⇒ 不用重數鉸鏈與四周）；
    // rest／fired／fly／cntF：每一片都停著了沒、上一格的開火數、FLY 的長度、船殼格數（portsShip：沒事的那一格整艘跳過）
  });
  return out;
}
/** 一片蓋板（portsBuild、portsIssues、portsSummary 共用）：配到的砲 g、鉸鏈 hc（hinge-a 格心）與軸 ax、往外的水平方向 u（鉸鏈 → 開著的蓋板中心）、
 *  關的角度 cdeg（弧度）、house、關上時貼著的那一圈船殼 ring（VK.pack；portGone 數掉了幾格）。 */
function portLid(sh, d) {
  var mt = d.meta, a = d.pts['hinge-a'], b = d.pts['hinge-b'], path = refPath(sh.T, mt.lid_of);
  var g = path ? sh.guns.filter(function (q) { return q.model.path === path; })[0] || null : null;   // lid_of：物件 id（或舊的路徑寫法）⇒ 路徑 ⇒ 那門砲（05_hull.js refPath；找不到 ⇒ ''）
  var cd = mt.close_deg !== undefined && mt.close_deg !== '' && isFinite(+mt.close_deg) ? +mt.close_deg : PORT_CLOSE0;
  var P = { d: d, g: g, hc: null, ax: null, u: null, cdeg: cd * Math.PI / 180, house: 0, rank: 0, ring: [], s: 1, want: -1, go: 0, lastEng: -1e9, wetT: -1e9,
    hp0: g ? g.model.hp : 0, fired0: g ? g.firedAt : undefined, gone: false, dead: false, ka: undefined, kr: undefined, kx: 0, ky: 0 };
  if (a && b && len(sub(b, a)) > 0.5) { P.hc = a.slice(); P.ax = norm(sub(b, a)); }   // 轉軸 ＝ 固定點本身：.vxk 的固定點匯出時已經是格心（蓋板 hinge-a 0,0,0 掛在 334,284,106 ⇒ 334.5,284.5,106.5），雕刻端 check_portlids.py 也繞這一點量 close_deg、house。
  // ⛔ 照 25_doors.js 再加 0.5：轉軸偏到格角 ⇒ 關上的蓋板 S 舷高一格、P 舷往船裡一格（光榮號真的蓋板量過：P 舷 30% 落進船殼、S／P 兩舷讀數對不起來）
  if (!P.hc || !g) return P;
  var bb = d.bb, ux = (bb[0] + bb[3]) / 2 - P.hc[0], uy = (bb[1] + bb[4]) / 2 - P.hc[1], ua = ux * P.ax[0] + uy * P.ax[1];
  ux -= P.ax[0] * ua; uy -= P.ax[1] * ua; var ul = Math.hypot(ux, uy);   // 鉸鏈 → 開著的蓋板中心，拿掉沿鉸鏈的那一段（hinge-a 在蓋板的一端，⛔ 直接相減 ⇒ 斜 42°）
  P.ul = ul;                                                          // 匯入檢查 portsIssues 的「中心在鉸鏈下面幾格」照它縮（小蓋板關上本來就低不到 3 格）
  P.u =ul > 0.5 ? [ux / ul, uy / ul, 0] : [g.ax[0], g.ax[1], 0];       // 往外：開著的蓋板從鉸鏈往外伸（14–17 號照 rz 轉過，⛔ 不用砲軸：1、2 號的砲往船尾偏 10°）
  P.house = +mt.house > 0 ? +mt.house : portHouse(sh, P).house;
  P.ring = portRing(sh, P);
  return P;
}
/** 蓋板的擺法（船的格座標）：從模型的樣子（開著）繞鉸鏈反轉 ang（弧度；ang ＝ cdeg ⇒ 關上）。跟門同一條路（21_gunnery.js modelLocal0 的 sw），只是寫在 deco 那一筆的 d.L。 */
function portMat(P, ang) {
  var h = P.hc, o = P.d.origin;
  return M4.mul(M4.mul(M4.mul(trans(h[0], h[1], h[2]), rotM(P.ax, -ang)), trans(-h[0], -h[1], -h[2])), trans(o[0], o[1], o[2]));
}
/** 同一個擺法、直接寫進 out（畫面那一格 portPose 用；匯入檢查照舊用 portMat）：⛔ 每格配矩陣 ⇒ 8 艘一起收砲闔蓋時 272 片每格各配 8 個 Float32Array，回收那一格多 2 ms 以上。
 *  T(h)·R(ax, −ang)·T(o − h)：旋轉照 rotM 那一條公式（P.ax 已經是單位向量），平移 ＝ h ＋ R·(o − h)；跟 portMat 只差 float32 的捨入。 */
function portMatTo(P, ang, out) {
  var h = P.hc, o = P.d.origin, x = P.ax[0], y = P.ax[1], z = P.ax[2], c = Math.cos(-ang), s = Math.sin(-ang), t = 1 - c;
  var r0 = t * x * x + c, r1 = t * x * y + s * z, r2 = t * x * z - s * y, r4 = t * x * y - s * z, r5 = t * y * y + c, r6 = t * y * z + s * x, r8 = t * x * z + s * y, r9 = t * y * z - s * x, r10 = t * z * z + c;
  var px = o[0] - h[0], py = o[1] - h[1], pz = o[2] - h[2];
  out[0] = r0; out[1] = r1; out[2] = r2; out[3] = 0; out[4] = r4; out[5] = r5; out[6] = r6; out[7] = 0; out[8] = r8; out[9] = r9; out[10] = r10; out[11] = 0;
  out[12] = h[0] + r0 * px + r4 * py + r8 * pz; out[13] = h[1] + r1 * px + r5 * py + r9 * pz; out[14] = h[2] + r2 * px + r6 * py + r10 * pz; out[15] = 1;
  return out;
}
/** 網格的取樣點（模型座標；三角形每 0.4 格一點，往實心那一邊挪 PORT_DEPTH 格 ⇒ 落在模型自己的格裡）。照網格編號快取在船型上（T.portPts；只給畫面與匯入檢查）。
 *  往哪一邊照網格的有號體積決定：遊戲的網格 cross(e1, e2) 朝實心那一邊（有號體積是負的：蓋板 −264、砲 −1049、舵 −6710，量過）。
 *  ⛔ 照 21_gunnery.js meshOcc 的 −n × 0.5：取樣點落在模型外面半格（meshOcc 再外擴一格，所以看不出來）⇒ 關上的蓋板吃進船殼、跟縮回去的砲多碰一格（光榮號真的蓋板：✗ 26 條）。
 *  PORT_DEPTH ＝ 0.25：最細的模型是 0.5 倍（砲）⇒ 落在那一格的正中；邊上的點再往三角形重心挪 PORT_EDGE 格（⛔ 剛好落在格線上 ⇒ floor 算到隔壁那一格：砲口那一面跟關上的蓋板只是貼著，也會算成碰到）。 */
function portPts(T, k) {
  var C = T.portPts || (T.portPts = {}); if (C[k]) return C[k];
  var m = T.rig && T.rig.meshes && T.rig.meshes[k], out = [];
  if (m && m.verts && m.tris) {
    var v = m.verts, vol = 0, j;
    for (j = 0; j < m.tris.length; j += 3) {                           // 有號體積（×6）：負 ⇒ cross(e1, e2) 朝裡
      var a = m.tris[j] * 3, b = m.tris[j + 1] * 3, c = m.tris[j + 2] * 3;
      vol += v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
    }
    var din = vol < 0 ? PORT_DEPTH : -PORT_DEPTH;
    for (j = 0; j < m.tris.length; j += 3) {
      var A = m.tris[j] * 3, B = m.tris[j + 1] * 3, Cc = m.tris[j + 2] * 3;
      var e1 = [v[B] - v[A], v[B + 1] - v[A + 1], v[B + 2] - v[A + 2]], e2 = [v[Cc] - v[A], v[Cc + 1] - v[A + 1], v[Cc + 2] - v[A + 2]], n = norm(cross(e1, e2));
      var gx = (e1[0] + e2[0]) / 3, gy = (e1[1] + e2[1]) / 3, gz = (e1[2] + e2[2]) / 3;   // 重心（相對 A）
      var st = Math.max(1, Math.ceil(Math.max(len(e1), len(e2), len(sub(e1, e2))) / 0.4));
      for (var p = 0; p <= st; p++) for (var q = 0; q <= st - p; q++) {
        var s = p / st, w = q / st, x = e1[0] * s + e2[0] * w, y = e1[1] * s + e2[1] * w, z = e1[2] * s + e2[2] * w;
        var dx = gx - x, dy = gy - y, dz = gz - z, dl = Math.hypot(dx, dy, dz), f = dl > PORT_EDGE ? PORT_EDGE / dl : 1;
        out.push(v[A] + x + dx * f + n[0] * din, v[A + 1] + y + dy * f + n[1] * din, v[A + 2] + z + dz * f + n[2] * din);
      }
    }
  }
  return (C[k] = out);
}
function portKey(x, y, z) { return (Math.floor(x) + 512) + 1024 * ((Math.floor(y) + 512) + 1024 * (Math.floor(z) + 512)); }
/** 網格佔的格（取樣點落的那幾格；⛔ 不外擴：meshOcc 外擴一格 ⇒ house 6、至少縮 5.75 的砲門會被當成穿過蓋板）。快取在 T.portCells。 */
function portCells(T, k) {
  var C = T.portCells || (T.portCells = {}); if (C[k]) return C[k];
  var p = portPts(T, k), S = new Set();
  for (var i = 0; i < p.length; i += 3) S.add(portKey(p[i], p[i + 1], p[i + 2]));
  return (C[k] = S);
}
/** 蓋板轉 ang、砲沿砲軸往裡拉 r 格時，蓋板有幾個取樣點落在砲的格子裡（0 ＝ 不穿模）。砲照它現在的 modelLocal（迴旋砲、砲塔上的也對）。 */
function portHits(sh, P, ang, r) {
  var g = P.g, m = g.model, lp = portPts(sh.T, P.d.mesh), gc = portCells(sh.T, m.mesh), n = 0;
  var C = M4.mul(M4.inv(M4.mul(trans(-g.ax[0] * r, -g.ax[1] * r, 0), modelLocal(m))), portMat(P, ang));   // 蓋板的模型座標 ⇒ 砲的模型座標
  for (var i = 0; i < lp.length; i += 3) { var q = M4.pt(C, lp[i], lp[i + 1], lp[i + 2]); if (gc.has(portKey(q[0], q[1], q[2]))) n++; }
  return n;
}
/** 照幾何算 house：關上的蓋板不碰到縮回去的砲，最少要拉幾格（每 0.25 格試一次，到 20 格為止）⇒ house ＝ max(ceil(至少), PORT_HOUSE0)。
 *  ⚠ 砲班站位（40_crew.js）有一個人站在砲外框後面 6 格：拉太多砲尾就畫進那個人身上（光榮號照算的 6，⛔ 不用統一的 8）。 */
function portHouse(sh, P) {
  for (var r = 0; r <= 20; r += 0.25) if (!portHits(sh, P, P.cdeg, r)) return { min: r, house: Math.max(Math.ceil(r - 1e-9), PORT_HOUSE0) };
  return { min: null, house: 20 };
}
/** 關上時貼著的那一圈船殼（約 42 格：蓋板每邊比開口大一格）：關著的蓋板每個取樣點往船裡（−u）走 1–4 格，碰到的第一格船殼（T.hullG；開口那一片刻穿了 ⇒ 碰不到）。 */
function portRing(sh, P) {
  var L = portMat(P, P.cdeg), lp = portPts(sh.T, P.d.mesh), u = P.u, G = sh.T.hullG, seen = {}, R = [];
  for (var i = 0; i < lp.length; i += 3) {
    var q = M4.pt(L, lp[i], lp[i + 1], lp[i + 2]);
    for (var k = 1; k <= 4; k++) {
      var x = Math.floor(q[0] - u[0] * k), y = Math.floor(q[1] - u[1] * k), z = Math.floor(q[2]);
      if (!G.get(x, y, z)) continue;
      var c = VK.pack(x, y, z); if (!seen[c]) { seen[c] = 1; R.push(c); } break;
    }
  }
  return R;
}
/** 關上的蓋板落進船殼實心的比例（匯入檢查：close_deg 太大 ⇒ 穿進船殼）。 */
function portSolid(sh, P, ang) {
  var L = portMat(P, ang), lp = portPts(sh.T, P.d.mesh), G = sh.T.hullG, n = 0;
  for (var i = 0; i < lp.length; i += 3) { var q = M4.pt(L, lp[i], lp[i + 1], lp[i + 2]); if (G.get(Math.floor(q[0]), Math.floor(q[1]), Math.floor(q[2]))) n++; }
  return lp.length ? n / (lp.length / 3) : 0;
}
/** 砲推出去了幾成（0 縮著 … 1 推出）—— 只讀模擬的狀態：開火後 GUN_SNAP 秒內被後座推進來；裝填中剩 PORT_LOADQ 秒才推出去（等藥箱、沒人時 reload 不倒數 ⇒ 一直待在裡面）；裝好 ⇒ 推出去。 */
function portLoad(g) {
  var u = g.firedAt === undefined ? 1e9 : SIMT - g.firedAt;
  if (u >= 0 && u < GUN_SNAP) { var e = 1 - u / GUN_SNAP; return e * e; }   // 1 − easeOut：一開火就往裡退、到底慢下來
  if (g.reload > 0) { var q = clamp(g.reload / PORT_LOADQ, 0, 1); return 1 - q * q * (3 - 2 * q); }
  return 1;
}
/** 這門砲在不在交戰：還在打的敵艦（isFoe、沒出局）在射程 × PORT_RK 內、而且在砲軸 ±PORT_ARC 內（從砲口量到敵艦中心）。只讀（⛔ 不叫 foeOf：還沒定的時候它會跑 pickFoes）。 */
function portEngaged(sh, g, foes) {
  if (!foes.length) return false;
  var w = M4.pt(sh.M, g.muz[0], g.muz[1], g.muz[2]), ax = gunAxis(sh, g), R = PORT_RK * gunMaxR(GUNS[g.type]), a0 = Math.atan2(ax[2], ax[0]);
  for (var i = 0; i < foes.length; i++) {
    var o = foes[i], c = o.center || [o.px, 0, o.pz], dx = c[0] - w[0], dz = c[2] - w[2];
    if (dx * dx + dz * dz > R * R) continue;
    var a = Math.atan2(dz, dx) - a0; if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) <= PORT_ARC) return true;
  }
  return false;
}
/** 畫面那一格（90_main.js frame，只在打仗中、沒暫停時；宣傳片在 trDraw 的 render() 前叫）。不吃 dt：照 SIMT 走（慢動作、模擬速度自動跟著；往回或跳太遠 ⇒ snap）。 */
function portsAnim() {
  for (var i = 0; i < SHIPS.length; i++) {
    var sh = SHIPS[i]; if (!sh.M) continue;
    if (!portOn(sh)) { if (sh.portLive) portsOffShip(sh); continue; }   // 沒輪到（關、或「只有我艦」的別艘）：上一格還在演 ⇒ 清一次
    sh.portLive = true;                                                // 輪到 ⇒ 演（蓋板本來就每艘都畫：60_rbatch.js rbatShip，S14）
    if (sh.ports === undefined) sh.ports = portsBuild(sh);             // 懶建（沒有蓋板 ⇒ null）
    if (sh.ports) portsShip(sh, sh.ports);
    if (sh.recoil === undefined) sh.recoil = recoilBuild(sh);          // 懶建（一門會退的砲都沒有 ⇒ null）
    if (sh.recoil) recoilShip(sh, sh.recoil);
  }
}
/** 這艘演不演砲門與後座（畫質「砲門的開關演出」：0 關、1 每艘、2 只有我艦 SHIPS[PLAYER_I]）。蓋板畫不畫不看它（每艘都畫；60_rbatch.js rbatShip，S14）。 */
function portOn(sh) { return GFX.port === 1 || (GFX.port === 2 && sh === SHIPS[PLAYER_I]); }
/** 這門砲開火往裡退幾格（見檔頭「後座」；有蓋板的砲照它的 house，portPose）。0 ＝ 不演。 */
function recoilDist(g) {
  var mt = g.model.meta || {};
  if (mt.recoil !== undefined && mt.recoil !== '' && isFinite(+mt.recoil)) return Math.max(0, +mt.recoil);
  if (g.ammoFix >= 0 && (ammoQuiet(g.ammoFix) || g.ammoFix === AMMO_GF)) return 0;   // 弩砲、投石機、希臘火：沒有火藥 ⇒ 沒有後座（同 21_gunnery.js 開火的火光、砲煙）
  var mz = g.model.pts && g.model.pts.muzzle, br = g.model.pts && g.model.pts.breech;
  return mz && br ? Math.max(PORT_HOUSE0, Math.round(len(sub(mz, br)) * RECOIL_K)) : PORT_HOUSE0;
}
/** 一艘的後座清單 L：沒有蓋板（或蓋板配不到砲）的砲；一門都沒有 ⇒ null。有蓋板的砲照 portPose 演（同一個 m.vsl）。 */
function recoilBuild(sh) {
  var lid = [], L = [];
  if (sh.ports) sh.ports.L.forEach(function (P) { lid.push(P.g); });
  sh.guns.forEach(function (g) {
    if (lid.indexOf(g) >= 0) return;
    var r = recoilDist(g); if (r > 0) L.push({ g: g, r: r, kr: undefined, kx: 0, ky: 0, vb: null });
  });
  return L.length ? { L: L, fired: -1, rest: false } : null;
}
/** 一艘的一格：sh.fired 沒變、而且每一門都推出去了（位移 0）⇒ 整艘跳過（開火才會讓它再動：g.firedAt 只在 fireGun 跟 sh.fired 一起改）。 */
function recoilShip(sh, R) {
  if (sh.fired === R.fired && R.rest) return;
  R.fired = sh.fired;
  var rest = true;
  for (var i = 0; i < R.L.length; i++) { if (recoilPose(R.L[i])) rest = false; }
  R.rest = rest;
}
/** 一門的位移（值變了才寫）：m.vsl ＝ −砲軸 × 退幾格 × (1 − 推出去幾成)。回傳還在動（位移不是 0）。 */
function recoilPose(I) {
  var g = I.g, m = g.model, r = g.alive && g.firedAt !== undefined ? I.r * (1 - portLoad(g)) : 0;   // 還沒開過火 ⇒ 推出去（開局的 reload 是亂數 0–1.2 秒，⛔ 照 portLoad ⇒ 一開場整排縮著再推出去）
  if (r !== I.kr || (r > 0 && (g.ax[0] !== I.kx || g.ax[1] !== I.ky))) {   // 迴旋砲的砲軸會轉 ⇒ 軸變了也重算
    I.kr = r; I.kx = g.ax[0]; I.ky = g.ax[1];
    if (r > 0) { var v = I.vb || (I.vb = [0, 0, 0]); v[0] = -g.ax[0] * r; v[1] = -g.ax[1] * r; m.vsl = v; } else m.vsl = null;
  }
  return r > 0;
}
/** 這艘從演切到不演（畫質項關掉、「只有我艦」換了船）：蓋板回模型的樣子（開著）、砲回原姿勢（推出去）⇒ 不停在動到一半；下次輪到從 snap 開始。被打掉的蓋板照舊不畫。 */
function portsOffShip(sh) {
  sh.portLive = false;
  if (sh.ports) {
    sh.ports.t = null;
    sh.ports.L.forEach(function (P) { P.d.L = null; P.g.model.vsl = null; P.ka = P.kr = undefined; });
  }
  var R = sh.recoil;
  if (R) { R.L.forEach(function (I) { if (I.kr !== undefined && I.g.model.vsl === I.vb) I.g.model.vsl = null; I.kr = undefined; }); R.rest = false; }
}
/** 畫質「砲門的開關演出」三檔的名字（匯入檢查的讀數）。 */
function portMode() { return ['關', '每艘', '只有我艦'][GFX.port] || '關'; }
/** 一艘的一格。停著的那幾片跳過（P.rest；見 portRest）：8 艘光榮號 272 片，每格每片都走一次 portMove／portPose ⇒ 在畫面迴圈裡量 0.10–0.14 ms（同一段單獨連跑只要 0.02 ms：
 *  模擬、畫面跑完快取都換掉了，每片要碰 P、d、g、模型四個物件）⇒ 只看「這一格可能有片要動」的那幾艘、那幾片。
 *  poke ＝ 這一格可能有片要動：剛判斷過（want、gone 變了）、開過火（sh.fired：g.firedAt 只在 fireGun 跟它一起改）、有模型被打飛（blowModel 推進 FLY）、
 *  船殼少了（斷船帶走的砲 alive ＝ false，22_pieces.js）⇒ 每一片都看一次；沒有 poke ⇒ 停著的那幾片跳過，每一片都停著 ⇒ 整艘跳過。跳過的那幾格 portMove／portPose 本來就什麼都不會改 ⇒ 畫面逐格相同。 */
function portsShip(sh, PS) {
  var t = SIMT, snap = PS.t === null || t < PS.t || t - PS.t > PORT_SNAP, dt = snap ? 0 : t - PS.t; PS.t = t;
  var dec = snap || t >= PS.next;
  if (dec) { PS.next = t + PORT_DT + (snap ? PS.ph : 0); portsDecide(sh, PS, t, snap); }
  var poke = dec || sh.fired !== PS.fired || FLY.length !== PS.fly || sh.grid.count !== PS.cntF;
  PS.fired = sh.fired; PS.fly = FLY.length; PS.cntF = sh.grid.count;
  if (!poke && PS.rest) return;
  var rest = true;
  for (var i = 0; i < PS.L.length; i++) {
    var P = PS.L[i]; if (!poke && P.rest) continue;
    portMove(P, dt, t); portPose(P); P.rest = portRest(P, t); if (!P.rest) rest = false;
  }
  PS.rest = rest;
}
/** 這一片停著了沒 ⇒ 沒有 poke 的那幾格 portMove／portPose 都不會改任何東西：s 到了目標（等著輪到的不算）、而且砲那一段的位移不會自己變 ——
 *  s ≤ 1（砲縮著 ⇒ 位移 ＝ house）；或砲推出去、後座過了、而且裝好了（位移 0）或離推出去還遠（裝填剩 ≥ PORT_LOADQ ＋ 2 × PORT_DT 秒 ⇒ 位移 ＝ house：
 *  gunRate ≤ 1 ⇒ 兩次判斷之間最多倒數 PORT_DT 秒多一點，下一次判斷（poke）時再看）。打飛了 ⇒ 不再動。迴旋砲、砲塔上的砲（g.mt：砲軸會轉）不停。 */
function portRest(P, t) {
  var g = P.g;
  if (P.dead) return true;
  if (g.mt || P.s !== Math.max(P.want > 0 ? 2 : 0, P.gone ? 1 : 0)) return false;
  if (P.s <= 1) return true;
  if (t - g.firedAt < GUN_SNAP) return false;
  return !(g.reload > 0) || g.reload >= PORT_LOADQ + 2 * PORT_DT;
}
/** 每 PORT_DT 秒：每片要開還是要關（只讀戰局：敵艦、射程、砲口泡水、降旗、在沉）、被打掉了沒。snap ⇒ 直接擺好（開局第一格：敵艦都在遠處 ⇒ 一開始就關著，不會整排演一次關上）。 */
function portsDecide(sh, PS, t, snap) {
  var foes = SHIPS.filter(function (o) { return isFoe(sh, o) && !isOut(o); }), down = sh.struck || sh.sinkingFinal || sh.sunk, ov = sh.portWant, cut = sh.grid.count !== PS.cnt;
  PS.cnt = sh.grid.count;
  var sc = shipCenter(sh);
  if (PS.R === undefined) {                                             // 第一次：最遠的射程 × PORT_RK、砲口離船中心最遠幾公尺（船是剛體 ⇒ 不變）
    PS.R = 0; PS.mr = 0;
    PS.L.forEach(function (P) { var w = M4.pt(sh.M, P.g.muz[0], P.g.muz[1], P.g.muz[2]); PS.R = Math.max(PS.R, PORT_RK * gunMaxR(GUNS[P.g.type])); PS.mr = Math.max(PS.mr, Math.hypot(w[0] - sc[0], w[1] - sc[1], w[2] - sc[2])); });
  }
  var RR = PS.R + PS.mr + 1;                                            // 離船中心比這還遠的敵艦，離每一門砲的砲口都超過射程 × PORT_RK ⇒ portEngaged 一定是 false：先拿掉（結果一樣，接近的那一段 34 門不用逐門算）
  foes = foes.filter(function (o) { var c = o.center || [o.px, 0, o.pz], dx = c[0] - sc[0], dz = c[2] - sc[2]; return dx * dx + dz * dz <= RR * RR; });
  PS.L.forEach(function (P) {
    var g = P.g;
    if (!P.gone && portGone(sh, P, cut)) P.gone = true;
    if (!g.alive) { if (!P.dead) { P.dead = true; if (P.s < 1) P.gone = true; } return; }   // 打飛了：portMove 那一條（蓋板留著就一直開著）；這裡是保險 —— 那一格沒有 poke（portsShip）、停著的那片沒走 portMove 也看得到
    var wet = g.wet || wetAt(sh, g.muz);                                // 砲口在海面下（照浪；跟模擬泡水、E1 同一個點 ⇒ Tim「炮口水線下時關閉」）
    if (wet) P.wetT = t;
    if (t - g.firedAt < PORT_FIRED || portEngaged(sh, g, foes)) P.lastEng = t;
    var w = ov !== undefined && ov !== null ? (+ov > 0 ? 1 : 0) : !down && t - P.lastEng < PORT_HOLD && t - P.wetT >= PORT_DRY ? 1 : 0;
    if (w !== P.want) { P.want = w; P.go = snap || (wet && !w) ? t : t + P.rank * PORT_RANK; }   // 泡水那一片不等，馬上關
    if (snap) { P.s = Math.max(w ? 2 : 0, P.gone || P.dead ? 1 : 0); P.fired0 = g.firedAt; }
  });
}
/** 被打掉了沒（照戰局現有的狀態推；見檔頭）。砲被打飛那一刻在 portMove 判（⛔ 等到這裡：那一格 s 已經被夾到 1 以上）。 */
function portGone(sh, P, cut) {                                        // cut：船殼的格數跟上次判斷時不一樣（沒變 ⇒ 鉸鏈、四周不用重數）
  var d = P.d, m = P.g.model;
  if (cut && portCut(sh.grid, P)) {                                     // 再加一道：鉸鏈與四周落在的那幾塊從上次重數之後改過（⛔ 打仗時每次判斷船殼幾乎都少了格 ⇒ 34 片 × 四周 66–103 格每 0.25 秒全部重數，8 艘一格多 0.03 ms）
    if (d.foot >= 0 && !hullGp(sh.grid, d.foot)) return true;           // 鉸鏈旁那一格船殼沒了（跟著斷開的那一團走了也算）
    for (var i = 0, n = 0; i < P.ring.length; i++) if (!hullGp(sh.grid, P.ring[i]) && ++n >= PORT_RING) return true;   // 四周那一圈掉了 4 格以上
  }
  if (m.hp !== P.hp0) { var hit = m.hp < P.hp0; P.hp0 = m.hp; if (hit && P.s < 1 && P.g.alive) return true; }   // 蓋板沒全開時那門砲被打中 ⇒ 砲彈是穿過蓋板才打到的
  return false;
}
/** 鉸鏈旁那一格與四周那一圈落在的那幾塊（VoxelKit 網格 16³ 一塊），從上次重數之後有沒有改過：G.cv 是每一塊改過幾次（只會加）⇒ 加總變了 ＝ 改過。
 *  沒改過 ⇒ 那幾格跟上次重數時一模一樣、結果也一樣（上次沒掉 ⇒ 這次也沒掉）⇒ 不用重數。換了一份網格（G 不是同一個）⇒ 重數。 */
function portCut(G, P) {
  if (!G.cv) return true;
  var K = P.ck;
  if (!K) {
    K = P.ck = [];
    var add = function (p) { var x = p & 2047, y = (p >> 11) & 1023, z = p >> 21, i = (x >> 4) + G.nx * ((y >> 4) + G.ny * (z >> 4)); if (K.indexOf(i) < 0) K.push(i); };   // 格座標壓法見 VK.pack（hullGp 同一套）
    if (P.d.foot >= 0) add(P.d.foot);
    P.ring.forEach(add);
  }
  for (var j = 0, v = 0; j < K.length; j++) v += G.cv[K[j]];
  if (P.cg === G && P.cs === v) return false;
  P.cg = G; P.cs = v; return true;
}
/** 每格：s 往目標走（段落見 PORT_UP…；只有 want 改了、輪到這一片（P.go）才動）。 */
function portMove(P, dt, t) {
  var g = P.g;
  if (!g.alive && !P.dead) { P.dead = true; if (P.s < 1) P.gone = true; }   // 砲被打飛：蓋板沒全開 ⇒ 一起沒了；全開著 ⇒ 留著、一直開著
  var lo = P.gone || P.dead ? 1 : 0;
  if (g.firedAt !== P.fired0) { P.fired0 = g.firedAt; if (P.s < 2) P.s = 2; }   // 新的一發 ⇒ 開火那一刻一定是開著的（保險：開火要 bears，開蓋的範圍比射界寬，正常碰不到）
  if (P.s < lo) P.s = lo;
  if (P.dead || !(dt > 0) || t < P.go) return;
  var tgt = Math.max(P.want > 0 ? 2 : 0, lo);
  if (tgt < P.s) P.s = Math.min(P.s, 1 + clamp(P.s - 1, 0, 1) * portLoad(g));   // 要關：砲已經在裡面（剛開過火、在裝填）⇒ 不空等收砲，直接放蓋
  for (var left = dt, k = 0; left > 1e-9 && P.s !== tgt && k < 4; k++) {
    var up = tgt > P.s, sec = up ? (P.s < 1 ? PORT_UP : PORT_RUN) : (P.s > 1 ? PORT_IN : PORT_DOWN);
    var edge = up ? (P.s < 1 ? Math.min(1, tgt) : tgt) : (P.s > 1 ? Math.max(1, tgt) : tgt), need = Math.abs(edge - P.s) * sec;
    if (need <= left) { P.s = edge; left -= need; } else { P.s += (up ? left : -left) / sec; left = 0; }
  }
}
/** 寫畫面的欄位（值變了才重算矩陣）：蓋板 d.L（開著 ⇒ null ＝ 模型的樣子）、d.gone；砲 m.vsl ＝ −砲軸 × house × (1 − 推出去幾成)（推出去 ⇒ null ＝ 原姿勢）。 */
function portPose(P) {
  var d = P.d, g = P.g, m = g.model;
  if (d.gone !== P.gone) d.gone = P.gone;
  var e = clamp(P.s, 0, 1), ang = P.gone ? 0 : P.cdeg * (1 - e * e * (3 - 2 * e));
  if (ang !== P.ka) { P.ka = ang; d.L = ang ? portMatTo(P, ang, P.Lb || (P.Lb = new Float32Array(16))) : null; }   // 每片一個自己的矩陣，在動的時候原地改（60_render.js 每格現讀現乘，不留著）
  var r = g.alive ? P.house * (1 - clamp(P.s - 1, 0, 1) * portLoad(g)) : 0;
  if (r !== P.kr || (r > 0 && (g.ax[0] !== P.kx || g.ax[1] !== P.ky))) {   // 迴旋砲的砲軸會轉 ⇒ 軸變了也重算
    P.kr = r; P.kx = g.ax[0]; P.ky = g.ax[1];
    if (r > 0) { var v = P.vb || (P.vb = [0, 0, 0]); v[0] = -g.ax[0] * r; v[1] = -g.ax[1] * r; m.vsl = v; } else m.vsl = null;
  }
}
/** 匯入檢查（75_shipcheck.js）：每片蓋板的標法與幾何（造船規格 §9.12）。沒有蓋板的船一行都不多算。 */
function portsIssues(sh, add) {
  var D = (sh.decos || []).filter(function (d) { return d.meta.kind === 'portlid'; }), used = [];
  D.forEach(function (d) {
    var P = portLid(sh, d), mt = d.meta, where = d.path || '（蓋板）';
    if (!P.hc) { add('error', '砲門', where, '沒有固定點 hinge-a／hinge-b（或兩點重疊）⇒ 不演出、腳往正下方找（底下是海 ⇒ 永遠畫，鉸鏈旁的船殼被打掉也不掉）', '蓋板子作品登記 hinge-a 0,0,0、hinge-b 11,0,0（上緣鉸鏈軸上兩點；造船規格 §9.12）'); return; }
    if (!P.g) {
      if (mt.lid_of === undefined || mt.lid_of === '') add('error', '砲門', where, '沒寫 lid_of ⇒ 不知道是哪一門砲的蓋板、蓋板不動', 'meta lid_of=<那門砲的物件 id>（先跑 python -I admin.py ids；造船規格 §9.12）');
      else if (refPath(sh.T, mt.lid_of)) add('error', '砲門', where, 'lid_of=' + mt.lid_of + ' 指到的不是這艘船上的砲 ⇒ 蓋板不動', 'lid_of 寫這一片自己那門砲的 id');   // id 找不到、kind 不對：上面「物件 id」那一段報（規格表 refs）
      return;
    }
    if (used.indexOf(P.g) >= 0) { add('error', '砲門', where, '跟另一片蓋板指同一門砲（lid_of=' + mt.lid_of + '）⇒ 只演第一片', '每門砲一片蓋板：lid_of 改成這一片自己那門砲'); return; }
    used.push(P.g);
    var tag = where + '（' + (P.g.model.meta.id || P.g.name.split('/').pop()) + '）', dg = Math.round(P.cdeg * 1800 / Math.PI) / 10;
    var lp = portPts(sh.T, d.mesh), Lc = portMat(P, P.cdeg), c = [0, 0, 0], np = lp.length / 3;
    for (var i = 0; i < lp.length; i += 3) { var q = M4.pt(Lc, lp[i], lp[i + 1], lp[i + 2]); c[0] += q[0] / np; c[1] += q[1] / np; c[2] += q[2] / np; }
    // 下限 ＝ min(3, 鉸鏈到開著的蓋板中心 × 0.5)：關對了中心低 ≈ ul × sin(close)、翻反了是負的；固定 3 格 ⇒ 夜隼號 7 格高的蓋板（ul 3、close 80° ⇒ 低 2.86–3.04）關對了也報 ✗（TASK-0736）。光榮號 11 格長 ⇒ ul 5（開著的中心 5.5 − 鉸鏈格心 0.5）⇒ 下限 2.5，它的讀數 4.64–5.02（verify_portlids.json）⇒ 結果不變
    var dn = P.hc[2] - c[2], dmin = Math.min(3, 0.5 * P.ul), inb = false;
    for (var k2 = 0; k2 <= 8 && !inb; k2++) if (sh.T.hullG.get(Math.floor(c[0] + P.u[0] * k2), Math.floor(c[1] + P.u[1] * k2), Math.floor(c[2]))) inb = true;   // 從關著的蓋板中心往外走 8 格碰到船殼 ⇒ 中心在船殼外表面的內側（⛔ 只比鉸鏈的 y：船尾外張的砲門 close 118° 本來就往裡收 2–3 格）
    if (np && (dn < dmin || inb)) add('error', '砲門', tag, '關的方向不對：反轉 close_deg ' + dg + '° 之後蓋板中心' + (dn < dmin ? '沒在鉸鏈下面 ' + dmin.toFixed(1) + ' 格以下（低 ' + dn.toFixed(1) + ' 格）⇒ 關上時往上翻' : '在船殼外表面的內側 ⇒ 往船裡關'), 'P 舷用了 mirror=y（a→b 沒跟著反過來）⇒ 改 rotate=0,0,180−rz、at.y ＝ 401 − hinge y；往船裡 ⇒ close_deg 太大（造船規格 §9.12）');
    var hc = portHits(sh, P, P.cdeg, P.house);
    if (hc) { var H = portHouse(sh, P); add('error', '砲門', tag, '關上時穿過縮回去的砲：' + hc + ' 個取樣點（house ' + P.house + ' 格）', H.min === null ? '拉 20 格還是碰到 ⇒ 擺法跑掉了（蓋板不在那門砲的砲門上）' : '加大 house：照幾何至少拉 ' + H.min + ' 格 ⇒ house=' + (Math.ceil(H.min - 1e-9) + 1) + '（再加 1 格）'); }
    var ho = portHits(sh, P, 0, 0);
    if (ho) add('warn', '砲門', tag, '開著（模型的樣子）跟推出去的砲重疊 ' + ho + ' 個取樣點 ⇒ 低畫質、觀測頁看得到穿模', '應該是 0：蓋板的擺法跑掉了（照造船規格 §9.12 的 at／rotate 重擺）');
    var fr = portSolid(sh, P, P.cdeg);
    if (fr > 0.05) { var sg = null; for (var a2 = dg - 0.5; a2 >= dg - 40 && sg === null; a2 -= 0.5) if (portSolid(sh, P, a2 * Math.PI / 180) <= 0.05) sg = a2;
      add('warn', '砲門', tag, '關上時 ' + Math.round(fr * 100) + '% 的取樣點落進船殼實心 ⇒ close_deg ' + dg + '° 太大（穿進船殼）', sg === null ? '改小 close_deg（照外表面的斜度）' : '改小 close_deg：' + sg + '° 時 ≤ 5%'); }
    if (d.foot < 0) add('warn', '砲門', where, 'hinge-a 旁 8 格內找不到船殼 ⇒ 鉸鏈旁的船殼被打掉也不會掉', 'hinge-a 貼著船殼外表面（蓋板上緣那一排、靠船殼那一格）');
    if (!(mt.close_deg !== undefined && mt.close_deg !== '' && isFinite(+mt.close_deg))) add('warn', '砲門', where, '沒寫 close_deg ⇒ 照 ' + PORT_CLOSE0 + '°', 'meta close_deg=<90 ＋ 外表面沿 z 的斜度>（造船規格 §9.12）');
    if (!(+mt.house > 0)) add('warn', '砲門', where, '沒寫 house ⇒ 照幾何算 ' + P.house + ' 格', 'meta house=' + P.house + '（算好寫進去，免得每次開船現場算）');
  });
}
/** 匯入檢查的讀數一行（75_shipcheck.js R.info.ports）。沒有蓋板 ⇒ ''。 */
function portsSummary(sh) {
  var D = (sh.decos || []).filter(function (d) { return d.meta.kind === 'portlid'; }); if (!D.length) return '';
  var L = [], used = []; D.forEach(function (d) { var P = portLid(sh, d); if (P.hc && P.g && used.indexOf(P.g) < 0) { used.push(P.g); L.push(P); } });
  var ns = L.filter(function (P) { return P.g.side === 'S'; }).length, hs = L.map(function (P) { return P.house; }), cs = L.map(function (P) { return Math.round(P.cdeg * 180 / Math.PI); });
  var rg = function (a) { return a.length ? Math.min.apply(null, a) + (Math.max.apply(null, a) > Math.min.apply(null, a) ? '–' + Math.max.apply(null, a) : '') : '—'; };
  var no = sh.guns.filter(function (g) { return used.indexOf(g) < 0; }).map(function (g) { var mt = g.model.meta || {}; return (mt.id || g.name.split('/').pop()) + (mt.deck ? '（' + mt.deck + '）' : ''); });
  return D.length + ' 片' + (L.length < D.length ? '（演得動的 ' + L.length + '）' : '') + '（P ' + (L.length - ns) + '、S ' + ns + '）；house ' + rg(hs) + ' 格；close ' + rg(cs) + '°'
    + '；沒有蓋板的砲：' + (no.length ? no.join('、') : '沒有') + '；畫質「砲門的開關演出」' + portMode() + (GFX.port === 1 ? '' : '（沒輪到的船：蓋板開著不動）');
}
/** 匯入檢查的讀數一行（75_shipcheck.js R.info.recoil）：沒有蓋板的砲幾門演後座、退幾格；照 meta 不演的（recoil=0、弩箭／火箭／石彈／希臘火）列出來。沒有砲 ⇒ ''。 */
function recoilSummary(sh) {
  if (!sh.guns.length) return '';
  var lid = []; (sh.decos || []).forEach(function (d) { if (d.meta.kind === 'portlid') { var P = portLid(sh, d); if (P.hc && P.g) lid.push(P.g); } });
  var rs = [], no = [];
  sh.guns.forEach(function (g) {
    if (lid.indexOf(g) >= 0) return;
    var r = recoilDist(g), mt = g.model.meta || {};
    if (r > 0) rs.push(r); else no.push((mt.id || g.name.split('/').pop()) + '（' + (mt.recoil !== undefined && mt.recoil !== '' && isFinite(+mt.recoil) ? 'recoil=' + mt.recoil : g.type) + '）');
  });
  var lo = rs.length ? Math.min.apply(null, rs) : 0, hi = rs.length ? Math.max.apply(null, rs) : 0;
  return '沒有蓋板的砲 ' + rs.length + ' 門' + (rs.length ? '（退 ' + lo + (hi > lo ? '–' + hi : '') + ' 格）' : '') + '；有蓋板的 ' + lid.length + ' 門（照 house）；不演：' + (no.length ? no.join('、') : '沒有')
    + '；畫質「砲門的開關演出」' + portMode();
}
/** 除錯（__game.ports）：每片的 s／want／gone 等。 */
function portsDbg(sh) {
  if (!sh) return null;
  var PS = sh.ports || null;
  return { on: portOn(sh), want: sh.portWant === undefined ? null : sh.portWant, wetShot: sh.wetShot || 0, n: PS ? PS.L.length : 0, L: PS ? PS.L.map(function (P) {
    var v = P.g.model.vsl;
    return { gun: P.g.model.meta.id || P.g.name.split('/').pop(), side: P.g.side, rank: P.rank, s: +P.s.toFixed(3), want: P.want, gone: P.gone, dead: P.dead, house: P.house, close: Math.round(P.cdeg * 1800 / Math.PI) / 10,
      ring: P.ring.length, lost: P.ring.filter(function (p) { return !hullGp(sh.grid, p); }).length, load: +portLoad(P.g).toFixed(2), pull: v ? +Math.hypot(v[0], v[1]).toFixed(2) : 0, ang: +((P.ka || 0) * 180 / Math.PI).toFixed(1) };
  }) : [] };
}
