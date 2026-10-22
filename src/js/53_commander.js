// ───────────────────────── 艦隊指揮官（TASK-0551） ─────────────────────────
// Tim 2026-10-14：「加一個艦隊指揮官 AI 用來制定全局策略」「我方友艦也聽我方指揮官」。
// ⛔ 這一檔是純邏輯：只讀「局勢」、只回「命令」，不碰遊戲的全域變數 ⇒ 遊戲（52_fleet.js cmdTick）與 2D 沙盒（sandbox）載入同一份。
//
// 局勢 view：{ t（秒）, wind: [x, z]（風吹去的方向，單位向量）, side（'blue'／'red'：替哪一方想）, ships: [s…] }
//   s：{ id, team, x, z, yaw（船頭 ＝ [cos, −sin]）, spd（m/s）, hp（船殼 0..1）, guns（砲 0..1）, crew（人 0..1）, mass（開戰排水量）, len（水線長 m）,
//        out（沉了、在沉、降旗）, cmd（指揮得動：玩家自己開的那艘 ⇒ false）, tgt（現在打的那艘 id；玩家那艘照它自己的）}
//   view 選填（TASK-0679；沒給 ⇒ 跟以前一樣，沙盒就沒給）：R（交戰距離 m）、gauge（這一方要不要搶上風）、signal（玩家的旗號：{ strat, lead, focus, gauge }，蓋過設定的策略）；
//   s.lerr、s.llag、s.larc、s.loff（戰列跟隨：離站位多遠、沿航跡落後多少、沿排頭航跡離排頭多遠、離航跡多遠 m，遊戲上一步量的）。
//   s.asp（選填）：這艘的武器主要朝哪裡 —— 'B' 船頭／'A' 船尾（比正橫兩舷火力大）／'side'；沒給 ＝ 'side'（54_helm.js helmAspect）。
// 命令 orders：{ [id]: { target（打哪艘 id；null ⇒ 照船自己挑）, mode, leader（戰列：跟著誰；站位每一步照它現在的位置算）, throttle（油門；沒寫 ＝ 1）,
//   side（排頭：交戰的那一舷 'P'／'S'）, pace（排頭：巡航的幾成）, tack（搶上風：往風軸哪一側搶，±1）} }
//   mode：'engage' 交戰 ／ 'line' 戰列跟隨（遊戲：cmdHelmWake 跟前一艘的航跡；沙盒：cmdHelmLine）／ 'lead' 戰列的排頭（遊戲 54_helm.js helmLead；沙盒當交戰）／ 'gauge' 搶上風（helmGauge）
// 記憶 mem：每一方一份（配對、集火的目標、戰列的順序、搶上風的進度），下一次想的時候接著用 ⇒ 不會每想一次就整個換一套；換策略、換旗號 ⇒ 除了搶上風都重來。
var CMD_STRATS = ['free', 'pair', 'focus', 'line', 'auto'];
var CMD_NAMES = { free: '各自為戰', pair: '一對一配對', focus: '集火', line: '戰列', auto: '推演' };   // 推演（TASK-0688）：每 30 秒把配對／集火／戰列各往前推 90 秒、挑最好的（56_rollout.js rollStrat）
var CMD_LINE_GAP = 70;                                                   // 戰列：前後兩艘的中心隔多遠（m；憲法號水線長 55 m ⇒ 頭尾隔 15 m）；自動調參調出來的（TASK-0687，2026-10-18，撞在下限 70；調之前 90）
// 搶上風（TASK-0679）：我方中心比敵方中心多上風 CMD_GAUGE_UP ⇒ 搶到；CMD_GAUGE_MAX 秒沒搶到、或敵我最近的兩艘近於 CMD_GAUGE_NEAR × 交戰距離 ⇒ 不搶了、接戰。
//   往風軸哪一側搶：敵方中心在哪一側就往哪一側（離風軸 CMD_GAUGE_SIDE 以內不換邊 ⇒ 不會一直換舷搶風）。
var CMD_GAUGE_UP = 150, CMD_GAUGE_MAX = 240, CMD_GAUGE_NEAR = 1.5, CMD_GAUGE_SIDE = 120;
// 戰列的排頭（TASK-0679）：期望航速 ＝ 巡航 × pace（隊形還沒排好 ⇒ CMD_PACE_FORM 等後面的跟上）；跟隨（cmdHelmWake）：沿航跡往前 CMD_WAKE_LA 那一點開、落後 1 m ⇒ 快 CMD_WAKE_K m/s
var CMD_PACE = 0.9, CMD_PACE_FORM = 0.7, CMD_WAKE_LA = 40, CMD_WAKE_K = 0.04, CMD_WAKE_VMIN = 0.8, CMD_WAKE_FAR = 80, CMD_WAKE_AWAY = 0.5;   // AWAY：在排頭旁邊或前面時往遠離排頭那邊偏多少（跟排頭航向合成；0.5 ≈ 27°）

function cmdDist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
function cmdStrength(s) { return 0.5 * s.hp + 0.3 * s.guns + 0.2 * s.crew; }   // 還剩多少戰力（0..1）
/** 可調參數（TASK-0687）：這一方的覆寫（cmdView 帶進來的 view.tune，存在 mem.tn）有這一鍵 ⇒ 用它，沒有 ⇒ d（原本的常數）。2D 沙盒沒有覆寫 ⇒ 一律 d。 */
function cmdTune(mem, k, d) { var t = mem.tn; return t && t[k] !== undefined ? t[k] : d; }
function cmdCenter(L) { var x = 0, z = 0; L.forEach(function (s) { x += s.x; z += s.z; }); return L.length ? { x: x / L.length, z: z / L.length } : null; }

/** 替 view.side 那一方想一次。strat：CMD_STRATS 其中一個；free ⇒ 不下命令（船照自己的：最近的敵艦）。
 *  玩家的旗號（view.signal）蓋過 strat：成戰列跟我 ⇒ 排頭 ＝ 玩家那艘；集火我的目標 ⇒ 集火那艘。搶上風（view.gauge 或旗號的 gauge）疊在任何策略上（cmdGauge）。 */
function cmdThink(view, strat, mem) {
  var own = view.ships.filter(function (s) { return s.team === view.side && !s.out; });
  var foes = view.ships.filter(function (s) { return s.team !== view.side && !s.out; });
  var orders = {}, sig = view.signal || null;
  if (sig && CMD_NAMES[sig.strat]) strat = sig.strat;
  if (!CMD_NAMES[strat]) strat = 'free';
  if (strat === 'auto') strat = typeof rollStrat === 'function' ? rollStrat(view, mem) : 'pair';   // 推演 ⇒ 這一次照挑中的那個想（56_rollout.js；玩家的旗號照樣蓋過它）
  var key = sig ? 'sig:' + strat + ':' + sig.lead + ':' + sig.focus : 'cfg:' + strat;
  if (mem.key !== key) { var g = mem.gauge, rl = mem.roll; Object.keys(mem).forEach(function (k) { delete mem[k]; }); mem.key = key; if (g) mem.gauge = g; if (rl) mem.roll = rl; }   // 換策略、換旗號 ⇒ 配對、集火、戰列重來（搶上風、推演的進度留著）
  mem.tn = view.tune || null;                                            // 這一方的可調參數覆寫（55_tune.js；平常 null）
  if (!own.length || !foes.length) return orders;
  if (strat === 'pair') cmdPair(own, foes, mem, orders);
  else if (strat === 'focus') cmdFocus(own, foes, mem, orders, sig ? sig.focus : null);
  else if (strat === 'line') cmdLine(own, foes, mem, orders, view, sig ? sig.lead : null);
  if (sig && sig.gauge !== undefined && sig.gauge !== null ? sig.gauge : view.gauge) cmdGauge(view, own, foes, mem, orders, strat);
  own.forEach(function (s) { if (!s.cmd) delete orders[s.id]; });          // 玩家自己開的那艘不下命令（但算在配對、戰列裡）
  return orders;
}

/** 一對一配對：每艘敵艦最多分到 ⌈我方艘數 ÷ 敵方艘數⌉ 艘（⇒ 不會三艘圍一艘、另一艘沒人管）。
 *  原本的配對還有效（目標沒出局、沒超過上限）就留著；其他的照「距離 ＋ 那艘已經有幾艘在打 × 300 m」最小的貪心補上（先補離敵人近的）。
 *  玩家那艘（cmd false）照它自己正在打的算進去。 */
function cmdPair(own, foes, mem, orders) {
  var cap = Math.ceil(own.length / foes.length), load = {}, asg = mem.pair || {}, ids = foes.map(function (f) { return f.id; });
  foes.forEach(function (f) { load[f.id] = 0; });
  var free = [];
  own.forEach(function (s) {
    var t = !s.cmd && s.tgt !== undefined && s.tgt !== null ? s.tgt : asg[s.id];
    if (t !== undefined && ids.indexOf(t) >= 0 && load[t] < cap) { load[t]++; asg[s.id] = t; } else free.push(s);
  });
  free.sort(function (a, b) { return Math.min.apply(null, foes.map(function (f) { return cmdDist(a, f); })) - Math.min.apply(null, foes.map(function (f) { return cmdDist(b, f); })) || a.id - b.id; });
  free.forEach(function (s) {
    var best = null, bc = 1e18;
    foes.forEach(function (f) { if (load[f.id] >= cap) return; var c = cmdDist(s, f) + 300 * load[f.id]; if (c < bc - 1e-9) { bc = c; best = f; } });
    if (!best) foes.forEach(function (f) { var c = cmdDist(s, f) + 300 * load[f.id]; if (c < bc - 1e-9) { bc = c; best = f; } });
    asg[s.id] = best.id; load[best.id]++;
  });
  mem.pair = asg;
  own.forEach(function (s) { orders[s.id] = { target: asg[s.id], mode: 'engage' }; });
}

/** 集火：全隊打同一艘 —— 敵艦裡「剩的戰力 × 0.6 ＋ 離我方中心的距離 ÷ 1000 × 0.4」最小的（弱又近）；打到它出局才換。 */
function cmdFocus(own, foes, mem, orders, want) {                         // want：玩家旗號「集火我的目標」指定的那艘（出局了 ⇒ 照上面的挑）
  var ids = foes.map(function (f) { return f.id; });
  if (want !== null && want !== undefined && ids.indexOf(want) >= 0 && mem.focus === undefined) mem.focus = want;
  if (mem.focus === undefined || ids.indexOf(mem.focus) < 0) {
    var c = cmdCenter(own), best = null, bs = 1e18, fw = cmdTune(mem, 'focusW', 0);   // fw：剩的戰力的權重，其餘給距離；0 ＝ 挑離我方中心最近的（自動調參，TASK-0687 2026-10-18；調之前 0.6）
    foes.forEach(function (f) { var sc = fw * cmdStrength(f) + (1 - fw) * cmdDist(c, f) / 1000; if (sc < bs - 1e-9) { bs = sc; best = f; } });
    mem.focus = best.id;
  }
  own.forEach(function (s) { orders[s.id] = { target: mem.focus, mode: 'engage' }; });
}

/** 戰列：旗艦（開戰排水量最大、還在打的；玩家旗號「成戰列跟我」⇒ 玩家那艘）帶頭；其他的排成縱隊，各自跟著前一艘（遊戲：照它的航跡 cmdHelmWake；沙盒：船尾 cmdHelmLine）。
 *  順序記在 mem.line（新進場的接到尾巴、出局的拿掉 ⇒ 後面的往前補）。每艘打離自己最近的敵艦（全隊用朝敵那一舷：跟著前一艘的航跡走，舷側自然朝同一邊）。
 *  排頭（TASK-0679，mode 'lead'）：照「整條戰列」開 —— 敵方中心擺在交戰那一舷（mem.side）、不換舷、不拉開；巡航 × pace（還沒排好 ⇒ 慢一點）。
 *    交戰那一舷：敵方中心在排頭的哪一舷；遠（> 2.5 × 交戰距離）而且明顯在一側的時候才重看 ⇒ 接戰之後定下來，掉頭時整條不換舷。
 *    ⛔ 以前排頭照一艘船的打法交戰（54_helm.js helmSteer：換舷、拉開、繞敵艦一艘轉圈）⇒ 後面的跟不上：量過 4 對 4、800 m，紅方跟隨 1.4–3 節、離站位 75–243 m。
 *  只有一艘 ⇒ 照舊交戰（沒有戰列可帶，跟以前一位元都不差）。 */
/** 戰列的排頭（沒有旗號指定時）：開局是橫隊 ⇒ 一齊轉向（turn together）—— 挑橫隊最外側、往外轉比較不頂風的那一端當排頭，交戰那一舷照往外轉的方向定（mem.side）；
 *  其他船一開始就都在它後面，只要橫著收攏，不用誰往後退。不是橫隊（前後拉得比左右長 1/1.5 以上）⇒ 照舊挑最重的。挑了就記住（mem.pick），出局了才重挑。
 *  ⛔ 照重量挑（以前）⇒ 4 艘一樣重 ⇒ 照編號，排頭剛好在橫隊第 2 個位置，不管往哪一舷轉都有船擋在航線上（開局頂風那一方：14–18 秒擦撞、排頭 5.8 → 0.1 節；
 *    改讓法、改超前的判準都只消掉擦撞，四個種子隊形平均沒變好：量過 wdir=0 種子 1797／11／22／33）。 */
function cmdLinePick(own, view, mem) {
  var hv = own.slice().sort(function (a, b) { return b.mass - a.mass || a.id - b.id; })[0];
  if (own.length < 2) return hv;
  var c = cmdCenter(own), fx = 0, fz = 0;
  own.forEach(function (s) { fx += Math.cos(s.yaw); fz -= Math.sin(s.yaw); });          // 平均船頭方向（fwd ＝ (cos yaw, −sin yaw)）
  var fl = Math.hypot(fx, fz); if (fl < 1e-6) return hv; fx /= fl; fz /= fl;
  var lx = fz, lz = -fx, lo = null, hi = null, a0 = 1e9, a1 = -1e9;                  // l：往左（yaw ＋ 90°）
  own.forEach(function (s) { var l = (s.x - c.x) * lx + (s.z - c.z) * lz, a = (s.x - c.x) * fx + (s.z - c.z) * fz; if (!lo || l < lo.l) lo = { s: s, l: l }; if (!hi || l > hi.l) hi = { s: s, l: l }; a0 = Math.min(a0, a); a1 = Math.max(a1, a); });
  if (hi.l - lo.l < 1 || hi.l - lo.l < 1.5 * (a1 - a0)) return hv;
  var W = view && view.wind, offL = 0, offR = 0;                                    // 往外轉之後（往左 ⇒ 左端那艘、往右 ⇒ 右端）離正頂風幾 rad：大的比較好
  if (W) { var wl = Math.hypot(W[0], W[1]) || 1, cu = Math.max(-1, Math.min(1, -(lx * W[0] + lz * W[1]) / wl)); offL = Math.acos(cu); offR = Math.acos(-cu); }
  var useL = Math.abs(offL - offR) > 0.2 ? offL > offR : hi.s.mass > lo.s.mass || hi.s.mass === lo.s.mass && hi.s.id < lo.s.id;
  mem.side = useL ? 'S' : 'P';                                                     // 往左轉 ⇒ 敵方落在右舷
  return useL ? hi.s : lo.s;
}
function cmdLine(own, foes, mem, orders, view, leadId) {
  // 武器朝船頭（船尾）的船（s.asp 'B'／'A'：持火號的 siphon、槳帆船的艏砲）不排進戰列 —— 戰列是兩舷對轟，跟著航跡走它的武器永遠對不到；
  //   改成各自交戰（mode 'engage'）打離自己最近的敵艦，艦長照自己的武器靠過去（Tim 2026-10-18：「艦隊指揮官的邏輯 需要判斷我方武器射程去指揮船隻」）。
  function near0(s) { var b = null, bd = 1e18; foes.forEach(function (f) { var d = cmdDist(s, f); if (d < bd) { bd = d; b = f; } }); return b; }
  own.filter(function (s) { return s.asp === 'B' || s.asp === 'A'; }).forEach(function (s) { orders[s.id] = { target: near0(s).id, mode: 'engage' }; });
  own = own.filter(function (s) { return s.asp !== 'B' && s.asp !== 'A'; });
  if (!own.length) return;
  if (leadId !== null && leadId !== undefined && !own.some(function (s) { return s.id === leadId; })) leadId = null;   // 玩家旗號「成戰列跟我」、玩家那艘卻是船頭接敵的 ⇒ 照平常挑排頭
  var lead = own.filter(function (s) { return s.id === leadId; })[0] || own.filter(function (s) { return s.id === mem.pick; })[0];
  if (!lead) { lead = cmdLinePick(own, view, mem); mem.pick = lead.id; }
  var L = (mem.line || []).filter(function (id) { return id !== lead.id && own.some(function (s) { return s.id === id; }); });
  // 新排進來的（開局整條、候補進場）：一艘一艘接 —— 離隊尾那艘「船尾後面一個間距」最近的先接（TASK-0679；⛔ 照編號 ⇒ 開局橫隊時第 2 艘跟在排頭左邊、第 3 艘跟第 2 艘卻在排頭右邊，整條交叉）
  var rest = own.filter(function (s) { return s.id !== lead.id && L.indexOf(s.id) < 0; });
  while (rest.length) {
    var tail = L.length ? own.filter(function (o) { return o.id === L[L.length - 1]; })[0] : lead, LG = cmdTune(mem, 'lineGap', CMD_LINE_GAP), bx = tail.x - Math.cos(tail.yaw) * LG, bz = tail.z + Math.sin(tail.yaw) * LG;
    rest.sort(function (a, b) { return Math.hypot(a.x - bx, a.z - bz) - Math.hypot(b.x - bx, b.z - bz) || a.id - b.id; });
    L.push(rest.shift().id);
  }
  // 照實際的前後重排（遊戲量的 larc：沿排頭航跡離排頭多遠）：後面的已經跑到前面一艘前面 30 m 以上 ⇒ 對調（⛔ 照開局排的順序 ⇒ 隊尾那艘先切進航跡、擋在前一個站位的船前面，
  //   兩艘並排 23 m 互相讓船，一艘離站位 98 m 卡住：量過紅方 120–180 秒）
  for (var sw = 0; sw < L.length; sw++) for (var q = 0; q + 1 < L.length; q++) {
    var A = own.filter(function (o) { return o.id === L[q]; })[0], B = own.filter(function (o) { return o.id === L[q + 1]; })[0];
    if (A.larc !== undefined && A.larc !== null && B.larc !== undefined && B.larc !== null && A.loff < 30 && B.loff < 30 && B.larc < A.larc - 30) { L[q] = B.id; L[q + 1] = A.id; }   // 兩艘都在航跡上（離航跡 < 30 m）才算數：⛔ 還在旁邊排的時候投影出來的位置不準 ⇒ 一直對調、兩艘讓來讓去（量過：藍方整條倒過來、兩艘各讓 4800–5300 步）
  }
  mem.line = L;
  function near(s) { var b = null, bd = 1e18; foes.forEach(function (f) { var d = cmdDist(s, f); if (d < bd) { bd = d; b = f; } }); return b; }
  var prev = lead, err = 0, lag = 0, nl = 0;
  L.forEach(function (id) {
    var s = own.filter(function (o) { return o.id === id; })[0];
    orders[id] = { target: near(s).id, mode: 'line', leader: prev.id, head: lead.id, slot: L.indexOf(id) + 1 };   // 站位每一步現算（遊戲：排頭的航跡上第 slot 個間距 cmdHelmWake；沙盒：前一艘的船尾 cmdHelmLine）
    err += s.lerr !== undefined && s.lerr !== null ? s.lerr : cmdDist(s, cmdHelmLine(s, prev).station);   // 遊戲量的（離航跡上的站位）；沒有 ⇒ 舊的站位
    if (s.llag !== undefined && s.llag !== null) { lag += s.llag; nl++; }
    prev = s;
  });
  err = L.length ? err / L.length : 0; mem.lineErr = err; lag = nl ? lag / nl : null; mem.lineLag = lag;
  // 排頭：隊形還沒排好（跟隨的平均離站位 > 60 m）⇒ 0.75 等後面的跟上（⛔ 全速 ⇒ 大家一樣快，後面的永遠追不上：量過 4 艘 40 秒，第 3、4 艘離站位 185 → 208、249 → 264 m；
  //   ⛔ 0.5 ⇒ 頂風時整隊一起爬）—— throttle 給沙盒；遊戲的排頭照 pace（期望航速）
  if (!L.length) { orders[lead.id] = { target: near(lead).id, mode: 'engage', throttle: 1 }; return; }
  var E = cmdCenter(foes), R = view && view.R || 150, dE = cmdDist(lead, E) || 1;
  var k = (Math.sin(lead.yaw) * (E.x - lead.x) + Math.cos(lead.yaw) * (E.z - lead.z)) / dE;   // ＝ 31_sailing.js chooseSide：右舷那一側的分量
  if (!mem.side || dE > 2.5 * R && Math.abs(k) > 0.3) mem.side = k >= 0 ? 'S' : 'P';
  // 排頭的快慢照「沿航跡落後多少」（遊戲量的 llag；沒有 ⇒ 照離站位）：後面的落後 ⇒ 慢一點等；在旁邊或超前（開局橫隊）⇒ 全速往前拉開，後面的才排得進航跡
  //   （⛔ 照離站位 ⇒ 開局橫隊時跟隨的「離站位 150 m」但其實在排頭旁邊 ⇒ 排頭放慢、旁邊的也放慢，整隊 1.5 節排不起來：量過 113 秒）
  var pace = lag === null ? (err > 60 ? CMD_PACE_FORM : CMD_PACE) : lag > 60 ? CMD_PACE_FORM : lag < -20 ? 1 : CMD_PACE;
  orders[lead.id] = { target: near(lead).id, mode: 'lead', side: mem.side, pace: pace, throttle: err > 60 ? 0.75 : 1 };
}
/** 搶上風（TASK-0679；帆船時代的 weather gauge：在上風的一方決定什麼時候、從哪裡壓過去接戰）：
 *  還沒搶到 ⇒ 全隊（戰列 ⇒ 排頭，後面的照航跡跟）迎風往敵方那一側搶（mode 'gauge'、tack；航向在遊戲那側照帆速曲線算，54_helm.js helmGauge）；
 *  搶到（我方中心比敵方多上風 CMD_GAUGE_UP）／時間到（CMD_GAUGE_MAX 秒）／敵我已經接近（最近兩艘 < CMD_GAUGE_NEAR × 交戰距離）⇒ 不再搶，照策略接戰（只搶一次）。
 *  進度 mem.gauge：{ st：'beat' 搶風中／'done' 搶到／'timeout'／'near', t0, tack, up（上風差 m）, near（最近兩艘 m）}。 */
function cmdGauge(view, own, foes, mem, orders, strat) {
  var G = mem.gauge || (mem.gauge = { st: 'beat', t0: view.t, tack: 0 });
  if (G.st !== 'beat') return;
  var O = cmdCenter(own), E = cmdCenter(foes), W = view.wind, R = view.R || 150, nr = 1e9;
  own.forEach(function (s) { foes.forEach(function (f) { nr = Math.min(nr, cmdDist(s, f)); }); });
  G.up = -((O.x - E.x) * W[0] + (O.z - E.z) * W[1]);                      // 我方比敵方多上風幾 m（W ＝ 風吹去的方向）
  G.near = nr;
  var lat = (E.x - O.x) * -W[1] + (E.z - O.z) * W[0];                    // 敵方在風軸的哪一側（＋ ＝ 風吹去的方向往左轉 90° 那一側）
  if (G.up >= CMD_GAUGE_UP) G.st = 'done';
  else if (view.t - G.t0 > CMD_GAUGE_MAX) G.st = 'timeout';
  else if (nr < CMD_GAUGE_NEAR * R) G.st = 'near';
  if (G.st !== 'beat') { G.tEnd = view.t; return; }
  if (!G.tack || Math.abs(lat) > CMD_GAUGE_SIDE && (lat > 0 ? 1 : -1) !== G.tack) G.tack = lat >= 0 ? 1 : -1;
  own.forEach(function (s) {
    var o = orders[s.id];
    if (strat === 'line' && o && o.mode === 'line') return;              // 戰列：後面的照前一艘的航跡跟（排頭在哪裡換舷，後面的就在哪裡換）
    orders[s.id] = { target: o ? o.target : null, mode: 'gauge', tack: G.tack };
  });
}
/** 戰列跟隨（TASK-0679，遊戲用；沙盒照舊 cmdHelmLine）：跟著前一艘的航跡 —— 實船的戰列是「依序在同一點轉」，不是跟著前一艘現在的船尾。
 *  lead、wake：跟著誰、它走過的點（[x, z]，舊 → 新；最後一點 ＝ 它現在的位置）；比 gap 短 ⇒ 從最舊那一點沿最早那一段往後延長（開局還沒走出航跡）。
 *  遊戲裡跟的是排頭（gap ＝ 第幾艘 × CMD_LINE_GAP；整條走同一條航跡），⛔ 跟前一艘 ⇒ 前一艘自己還在排、在繞，一路傳下去隊尾永遠排不進去（量過）。
 *  站位 ＝ 航跡上離它 gap 的那一點。自己投影到航跡上（最近的那一段）⇒ 往前 max(CMD_WAKE_LA, 離航跡) 那一點開（純追蹤：從旁邊斜切進隊形、到了就順著走）。
 *  期望航速 v（m/s）：沿航跡落後站位 lag ⇒ 前一艘的航速 ＋ lag × CMD_WAKE_K（最慢 CMD_WAKE_VMIN：舵要有水流）；落後 CMD_WAKE_FAR 以上、或離航跡 60 m 以上又落後 ⇒ Infinity（全速）。
 *  ⛔ 以前跟「前一艘現在的船尾往後 90 m」⇒ 前一艘一轉向，站位整個甩到另一邊，後面的切內角追、又撞上讓船；快慢用放掉風硬拉（throttle）⇒ 帆裝不動、一放就掉到 1 節以下。
 *  s、lead：{ x, z, yaw, spd }。回傳 { yaw, v, station, err（離站位直線 m）, lag（沿航跡落後 m，負 ＝ 超前）, off（離航跡 m）}。 */
function cmdHelmWake(s, lead, wake, gap) {
  gap = gap || CMD_LINE_GAP;
  var P = (wake || []).slice(); P.push([lead.x, lead.z]);
  var n = P.length, c = new Array(n), i; c[n - 1] = 0;
  for (i = n - 2; i >= 0; i--) c[i] = c[i + 1] + Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
  var bx, bz;                                                            // 最舊那一點往後延長的方向
  if (n >= 2 && c[0] > 1e-6) { var j = 0; while (j < n - 2 && Math.hypot(P[j + 1][0] - P[0][0], P[j + 1][1] - P[0][1]) < 1e-6) j++; var lx = P[0][0] - P[j + 1][0], lz = P[0][1] - P[j + 1][1], ll = Math.hypot(lx, lz) || 1; bx = lx / ll; bz = lz / ll; }
  else { bx = -Math.cos(lead.yaw); bz = Math.sin(lead.yaw); }
  function at(a) {                                                       // 航跡上離前一艘 a（m）的那一點
    if (a <= 0) return [P[n - 1][0], P[n - 1][1]];
    if (a >= c[0]) return [P[0][0] + bx * (a - c[0]), P[0][1] + bz * (a - c[0])];
    for (var k = n - 2; k >= 0; k--) if (c[k] >= a) { var f = (a - c[k + 1]) / ((c[k] - c[k + 1]) || 1); return [P[k + 1][0] + (P[k][0] - P[k + 1][0]) * f, P[k + 1][1] + (P[k][1] - P[k + 1][1]) * f]; }
    return [P[0][0], P[0][1]];
  }
  // 投影：每一段（含往後延長的那一段，長 1000 m）找最近的點
  var bd = 1e18, ba = 0, qx = P[n - 1][0], qz = P[n - 1][1];
  function seg(ax, az, ca, ex, ez, ce) {                                 // 線段 a（航跡長 ca）→ e（ce）
    var ux = ex - ax, uz = ez - az, L2 = ux * ux + uz * uz, t = L2 > 0 ? Math.max(0, Math.min(1, ((s.x - ax) * ux + (s.z - az) * uz) / L2)) : 0;
    var px = ax + ux * t, pz = az + uz * t, d = Math.hypot(s.x - px, s.z - pz); if (d < bd) { bd = d; ba = ca + (ce - ca) * t; qx = px; qz = pz; }
  }
  for (i = 0; i < n - 1; i++) seg(P[i][0], P[i][1], c[i], P[i + 1][0], P[i + 1][1], c[i + 1]);
  seg(P[0][0] + bx * 1000, P[0][1] + bz * 1000, c[0] + 1000, P[0][0], P[0][1], c[0]);
  if (n === 1) { bd = Math.hypot(s.x - P[0][0], s.z - P[0][1]); ba = 0; }
  var st = at(gap), lag = ba - gap, la = Math.max(CMD_WAKE_LA, bd), tg = at(Math.max(0, ba - la)), yaw, v;
  if (lag < -Math.max(30, 0.5 * bd) && bd > 30) {                       // 超前站位比離航跡的一半還多（開局橫隊在排頭旁邊）才算；⛔ 只看 lag < 0 ⇒ 沿航跡已經到了、只是橫向離航跡 224 m 的那艘也被當成「在旁邊」，0.8 m/s 爬 3 分鐘（量過 wdir=0 藍方 181 秒：lag −2、離航跡 224 m、1.8 節）
    // 在航跡旁邊、而且還沒落到站位後面（開局橫隊）⇒ 慢下來讓排頭往前拉開，船頭跟排頭同向、往航跡偏（最多 35°）；落到站位後面就照下面追
    // ⛔ 往前面的追蹤點開 ⇒ 一直跟它並排（量過：橫隊開局 113 秒，第 3、4 艘並排在旁邊 150–185 m、1.5 節）；
    // ⛔ 掉頭往站位後面開 ⇒ 一路橫切別艘的航線、讓船讓到每艘 3000–5000 步（50–80 秒），離站位反而 100–160 m（量過）
    var fx = Math.cos(lead.yaw), fz = -Math.sin(lead.yaw), wx = (qx - s.x) / bd, wz = (qz - s.z) / bd, k = Math.min(0.7, bd / 100);
    if (ba < CMD_WAKE_LA) {                                              // 投影落在排頭身上（在排頭旁邊或前面）⇒ 往航跡偏 ＝ 往排頭身上開 ⇒ 改成往遠離排頭那邊偏
      var dl = Math.hypot(s.x - lead.x, s.z - lead.z) || 1; wx = (s.x - lead.x) / dl; wz = (s.z - lead.z) / dl; k = CMD_WAKE_AWAY;
    }   // ⛔ 照舊 ⇒ 開局橫隊、排到隊尾的那艘在排頭另一舷 66 m，排頭往那一舷搶風、它又往排頭偏 ⇒ 14 秒擦撞，排頭 5.8 → 0.1 節、整條耗掉（量過 wdir=0 藍方）
    yaw = Math.atan2(-(fz + wz * k), fx + wx * k);
    v = CMD_WAKE_VMIN;                                                   // ⛔ 試過 0.4 m/s（往後退快三成）⇒ 種子 22 接戰時排頭急轉、後面的被判成超前就停在 0.4 m/s，兩方都掉到 0.8–1.5 節（量過）
  } else {
    yaw = ba - la <= 0 && lag < 0 ? lead.yaw : Math.atan2(-(tg[1] - s.z), tg[0] - s.x);   // 追到前一艘正後方、貼著航跡又超前一點 ⇒ 跟它同向
    v = lag > CMD_WAKE_FAR || bd > 60 && lag > 0 ? Infinity : Math.max(CMD_WAKE_VMIN, (lead.spd || 0) + lag * CMD_WAKE_K);
  }
  return { yaw: yaw, v: v, station: st, err: Math.hypot(s.x - st[0], s.z - st[1]), lag: lag, off: bd };
}

/** 戰列跟隨的舵與油門（遊戲與沙盒共用；每一步照前一艘「現在」的位置算 ⇒ 命令只記跟著誰，⛔ 站位在想的那一刻算 ⇒ 3 秒內前一艘走了十幾公尺、站位就過時）：
 *  站位 ＝ 前一艘往它船尾方向退 CMD_LINE_GAP；往「站位再往前 60 m」那一點開（⇒ 從後面追上來時斜著切進隊形、到了就順著前一艘的航向）；
 *  超過站位 ⇒ 放慢；落後 ⇒ 全速。s、lead：{ x, z, yaw }。回傳 { yaw, throttle, station }。 */
function cmdHelmLine(s, lead) {
  var fx = Math.cos(lead.yaw), fz = -Math.sin(lead.yaw), st = [lead.x - fx * CMD_LINE_GAP, lead.z - fz * CMD_LINE_GAP];
  var px = st[0] + fx * 60, pz = st[1] + fz * 60;
  var yaw = Math.atan2(-(pz - s.z), px - s.x);
  var ahead = (s.x - st[0]) * fx + (s.z - st[1]) * fz;                       // 正 ＝ 超過站位
  var same = Math.cos(s.yaw) * fx - Math.sin(s.yaw) * fz > 0.5;              // 船頭跟前一艘大致同向（60° 內）
  // 超前（而且同向）⇒ 不掉頭：跟前一艘平行、放慢，等它過去；落後或方向不同 ⇒ 往追蹤點開、全速。
  // ⛔ 不看同不同向 ⇒ 前一艘掉頭之後，本來在後面的變成「超前」⇒ 放慢，其實它該全速掉頭（量過：整隊 0.04–1 節爬）；
  // ⛔ 超前也往後面的追蹤點開 ⇒ 舵一直想掉頭、又被放慢 ⇒ 舵靠航速才轉得動（最慢 0.012 rad/s），卡在原地（量過：離站位 200 m、0.03 節）。
  if (same && ahead > 5) return { yaw: lead.yaw, throttle: ahead > 25 ? 0.35 : 0.7, station: st };
  return { yaw: yaw, throttle: 1, station: st };
}
