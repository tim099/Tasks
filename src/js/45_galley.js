// ───────────────────────── 廚房與廚師（TASK-0720；Tim 2026-10-19） ─────────────────────────
// Tim 2026-10-19：「然後可以加入廚房 廚師(可以先做簡易功能) 水手可以到廚房吃飯獲得buff(可以加一個水手工作效率數值 基礎1 吃飯加成 可以有其他因素影響)」
// 廚房 ＝ 雕刻的外部模型 meta kind=galley（爐灶；造船規格 §9.13；config/meta_kinds.json mk ⇒ 10_ship.js modelKind 直接回 galley：血量 GUN_HP、會被打、算重量）。
//   ⛔ 不讀 T.decos：裝飾的爐灶（deco=1，拿破崙號、潮墓號）照舊是裝飾 —— 讀了戰局會跟著畫質設定走。
// 廚師（ROLE.COOK，40_crew.js）：每座爐灶 galley.cooks 位、全船上限 crew.cook；開戰就站在爐灶旁、不走動（照船醫 44_medic.js medSurgeons）；
//   倒下、陣亡 ⇒ 不補（斷炊，〔K5〕）；掉到別層、落水爬回來 ⇒ 當預備水手（40_crew.js landIn 的通用處理）。
// 做飯：每次點名（0.5 秒，32_hull.js survey）爐灶能做飯 ⇒ 進度 += dt ÷ cookT × Σ 在崗廚師的 crewEff × 爐灶血量比；滿 1 ⇒ 多一鍋（最多 stock 鍋，開戰時是滿的）。
//   不能做飯：打壞了（鍋打翻 ⇒ 現成的也沒了）、泡在水裡、降旗、沒有廚師、熄火備戰（galley.douse 1 而且敵艦在 dousR m 內；預設關，〔K1〕）。
// 吃飯照史實的「伙夫領飯」（Leech 1843 第二章、Masefield 1905 第五章、Boteler 1688）：開戰時把船員（軍官、廚師除外）照生成的順序每 galley.mess 個切成一桌
//   （生成的順序砲班先 ⇒ 一桌大多是同一段的砲班）；這桌吃過 hold 秒 ⇒ 算餓 ⇒ 點名時派一個閒著的預備水手當伙夫（pri 3：所有補位之後），
//   走到爐灶旁站 fetchT 秒領一鍋 ⇒ 整桌都算吃過（c.fedT ＝ 那一刻；砲班不用離開砲位）；沒鍋可領最多再等 waitT 秒。領完照常閒晃（〔K4〕）。
//   補位不夠人 ⇒ 還沒走到爐灶、沒在爬梯子的伙夫叫回去（galleyPull，照 45_pumps.js 叫回醫療艙值班的人）。
// 加成（39_eff.js 的「吃過飯」那一項）：吃過 hold 秒內 ×(1 ＋ lim.galley %)，之後 fade 秒線性退回 1；從沒吃過 ⇒ 1；⛔ 不會低於 1（〔K6〕）。開局 galley.start 1 ⇒ 全員剛吃過。
//   加成跟著人走（存的是 c.fedT，不是桌）：補進砲班、換船都帶著；換到沒有廚房的船 ⇒ crewEff 回 1（39_eff.js 擋在 sh.effOn）。
// 沒有廚房／lim.galley 0／沒有走路格／crew.cook 0／爐灶都走不到 ⇒ sh.galley ＝ null（原因記在 sh.galleySkip）：不生廚師、不派人、不抽 rnd() ⇒ 戰局一位元不動。
// ⛔ 整支不抽戰局亂數（rnd()／rr()），也不開新的亂數流：輪桌照「多久沒吃 → 桌號」、派人照 callHands 原本「最近的閒人」、站位照固定順序找面。
var GALLEY = CFG.galley, GALLEY_NEAR = 14;                              // GALLEY_NEAR：伙夫走到領飯那一點幾格內才算到（路斷了、被擠開 ⇒ 這一趟作廢）
/** 開戰時（40_crew.js makeCrew，pumpInit 之後）：船上 kind=galley 的模型 ⇒ 每座爐灶的那一層、四周站得住又走得到的面（廚師站第一個面、伙夫在第二個面領飯，只有一面 ⇒ 共用）。 */
function galleyInit(sh) {
  sh.galley = null; sh.galleySkip = [];
  var ms = sh.models.filter(function (m) { return m.kind === 'galley'; }); if (!ms.length) return;   // 沒有廚房 ⇒ 什麼都不做
  var why = !(GALLEY_PCT > 0) ? '廚房加成 0（細節設定關掉）' : !sh.nav ? '這艘沒有走路格（沒有預備水手）' : !(sh.cw.cook > 0) ? '廚師上限 0（船員配置）' : '';
  if (why) { ms.forEach(function (m) { sh.galleySkip.push({ name: m.path, why: why }); }); return; }
  var NV = sh.nav, list = [];
  ms.forEach(function (m) {
    var b = m.bb, cx = m.c[0], cy = m.c[1], lv = lvAt(sh, [cx, cy, b[2]]);   // ⚠ 照 deckAt 看 x（光榮號：爐灶在艏樓底下，艏樓與上甲板的高度會重疊）
    if (lv < 0 || NV.reach.indexOf(lv) < 0) { sh.galleySkip.push({ name: m.path, why: '那一層甲板走不到' }); return; }
    var N = NV.levels[lv].N, faces = [];
    // 外框外 2 格的四個面中點，照固定順序試：−x（船尾面；光榮號的爐門）→ +x → −y → +y；每一點 3 點內找走路點、要從待命那一層走得到
    [[b[0] - 2, cy], [b[3] + 2, cy], [cx, b[1] - 2], [cx, b[4] + 2]].forEach(function (p) {
      var ci = navSnap(N, [p[0], p[1], b[2]], 3); if (ci < 0 || faces.indexOf(ci) >= 0) return;
      if (handRoute(sh, NV.home, lv, cx, cx, undefined, N.reg[ci])) faces.push(ci);
    });
    if (!faces.length) { sh.galleySkip.push({ name: m.path, why: '爐灶四周走不到（四個面都沒有連得到待命那一層的走路點）' }); return; }
    list.push({ m: m, i: list.length, lv: lv, faces: faces, cell: faces[0], pick: faces.length > 1 ? faces[1] : faces[0], cooks: [], stock: GALLEY.stock, prog: 0, made: 0, served: 0, lost: 0, miss: 0, on: 0, cooking: false, why: '' });
  });
  NV.ladders.forEach(function (L) { L.q = 0; });                        // handRoute 會記排隊人數；這裡只是試走（同 45_pumps.js pumpInit）
  if (!list.length) return;
  sh.galley = { list: list, mess: [], t: SIMT, made: 0, served: 0, pulled: 0, going: 0, out: 0, effT: [], effNext: SIMT, news: {} };
}
/** 開戰時（galleyInit 之後）：廚師 —— 每一座先配一位、再輪第二位（照 36_rooms.js staffSlots 的精神），全船最多 crew.cook 位。⛔ add() 抽 2 次 rnd() ⇒ 只在有廚房的船、makeCrew 最後才生。 */
function galleyCooks(sh, crew, add) {
  var G = sh.galley; sh.cookWant = 0; if (!G) return;
  var S = [], NV = sh.nav, g = navBase(sh.T);
  for (var j = 0; j < GALLEY.cooks; j++) G.list.forEach(function (s) { S.push(s); });
  var n = Math.min(sh.cw.cook, S.length); sh.cookWant = n;
  for (var k = 0; k < n; k++) {
    var s = S[k], N = NV.levels[s.lv].N, F = s.faces.length > 1 ? s.faces.filter(function (ci, i) { return i !== 1; }) : s.faces;   // 第二個面留給伙夫領飯
    add(ROLE.COOK, navPos(N, F[s.cooks.length % F.length]), null, 1);
    var c = crew[crew.length - 1]; c.art = ART_COOK; c.gal = s; c.deck = NV.levels[s.lv].key; c.below = galleyRoof(g, c.pos); s.cooks.push(c);   // below：頭上有遮蔽 ⇒ 火槍打不到（40_crew.js musket）
  }
}
/** 頭頂往上 40 格內有沒有實心（有 ⇒ 在甲板下，火槍打不到）。光榮號的爐灶在艏樓底下：z 137 就是艏樓甲板。 */
function galleyRoof(g, p) { var x = Math.floor(p[0]), y = Math.floor(p[1]); for (var z = p[2] + 14; z <= p[2] + 40; z++) if (g.get(x, y, z)) return true; return false; }
/** 開戰時（galleyCooks 之後）：桌 —— 船員（軍官、廚師除外）照生成的順序每 galley.mess 個一桌；開局 galley.start 1 ⇒ 每一桌、每個人都算剛吃過。 */
function galleyMess(sh, crew) {
  var G = sh.galley; if (!G) return;
  var M = null;
  crew.forEach(function (c) {
    if (c.role === ROLE.OFFICER || c.role === ROLE.COOK) return;
    if (!M || M.who.length >= GALLEY.mess) G.mess.push(M = { k: G.mess.length, fed: GALLEY.start ? SIMT : -1e9, n: 0, busy: false, who: [] });
    M.who.push(c); c.mess = M; if (GALLEY.start) c.fedT = SIMT;
  });
}
/** 熄火備戰（galley.douse 1）：有沒有還在打的敵艦在 r m 內。 */
function galleyFoeNear(sh, r) { return SHIPS.some(function (o) { return isFoe(sh, o) && !isOut(o) && Math.hypot(o.px - sh.px, o.pz - sh.pz) <= r; }); }
/** 每次點名（0.5 秒，32_hull.js survey；callHands、effTick 之前）：爐灶做飯、每一桌有沒有伙夫在路上（從預備水手的 hand.job 重數 ⇒ 人倒下、路斷了自然清掉）、效率的時間線。 */
function galleyTick(sh) {
  var G = sh.galley; if (!G) return;
  var dt = SIMT - G.t; G.t = SIMT;
  var hot = GALLEY.douse ? galleyFoeNear(sh, GALLEY.dousR) : false;
  G.list.forEach(function (S) {
    var m = S.m, cooks = sh.crew.filter(function (c) { return c.role === ROLE.COOK && c.gal === S && crewAble(c); });
    if (m.alive) wetLatch(S, wetAt(sh, [m.c[0], m.c[1], m.origin[2] + 1], { inner: PUMP_WET_IN }));   // 泡水：照抽水機（連兩次在水裡才算、連兩次乾了才回來；33_flood.js）
    else if (S.stock) { S.lost += S.stock; S.stock = 0; S.prog = 0; }    // 打壞了 ⇒ 鍋打翻了
    S.on = cooks.length;
    S.cooking = m.alive && !S.wet && !sh.struck && !sh.sunk && !hot && cooks.length > 0;
    S.why = !m.alive ? '爐灶打壞了' : S.wet ? '泡在水裡' : sh.struck || sh.sunk ? '降旗' : hot ? '熄火（備戰）' : !cooks.length ? '廚師倒下' : '';
    if (!S.cooking) return;
    cooks.forEach(function (c) { c.fedT = SIMT; });                     // 廚師一直在試吃：自己一直是吃飽的
    if (S.stock >= GALLEY.stock) { S.prog = 0; return; }                 // 放滿了 ⇒ 不囤進度
    var e = 0; cooks.forEach(function (c) { e += crewEff(sh, c); });
    S.prog += dt / GALLEY.cookT * e * Math.max(0, m.hp / m.hpMax);
    while (S.prog >= 1 && S.stock < GALLEY.stock) { S.prog -= 1; S.stock++; S.made++; G.made++; }
  });
  G.mess.forEach(function (M) { M.busy = false; });
  G.going = 0; G.out = 0;
  sh.crew.forEach(function (c) {
    var J = c.role === ROLE.HAND && crewAble(c) && c.hand && c.hand.job; if (!J || J.kind !== 'eat') return;
    J.mess.busy = true; G.out++; if (!J.at) G.going++;                    // going：還沒走到爐灶的（42_hands.js callHands 照它判斷要不要提早 return）
  });
  // 廣播用（61_hud.js hudGalleyNews 讀、每件報一次）：爐灶全打壞 broke／廚師都倒下 cook／斷炊 out（沒有一座能做飯、現成的鍋也沒了），各記第一次的時刻
  var NW = G.news, now = +SIMT.toFixed(1);
  if (NW.broke === undefined && G.list.every(function (S) { return !S.m.alive; })) NW.broke = now;
  if (NW.cook === undefined && G.list.every(function (S) { return !S.on; })) NW.cook = now;
  if (NW.out === undefined && !G.list.some(function (S) { return S.cooking || S.stock > 0; })) NW.out = now;
  if (SIMT >= G.effNext) { G.effNext += 30; G.effT.push([Math.round(SIMT), +galleyAvg(sh, true).toFixed(3)]); }   // 讀數：每 30 秒一筆全船平均效率
}
/** 全船還能動的人的平均效率（fresh ⇒ 照現在重算，不等 effTick）。 */
function galleyAvg(sh, fresh) {
  var s = 0, n = 0; sh.crew.forEach(function (c) { if (!crewAble(c)) return; s += fresh ? effCalc(sh, c) : crewEff(sh, c); n++; });
  return n ? s / n : 1;
}
/** 吃過飯的倍數（39_eff.js EFF_PARTS 的 k）：1 ＋ lim.galley % × 剩下的加成比例。 */
function galleyMealK(sh, c) { return 1 + GALLEY_PCT / 100 * galleyMealF(c); }
/** 剩下的加成比例：吃過 hold 秒內 1、之後 fade 秒線性降到 0；從沒吃過 ⇒ 0。 */
function galleyMealF(c) {
  if (c.fedT === undefined) return 0;
  var t = SIMT - c.fedT, H = GALLEY.hold, F = GALLEY.fade;
  if (t <= H) return 1;
  if (!(F > 0) || t >= H + F) return 0;
  return 1 - (t - H) / F;
}
/** 給人看的一句（39_eff.js effText）：「吃過 1 分 12 秒前」。 */
function galleyMealText(sh, c) {
  if (c.fedT === undefined) return '還沒吃過';
  var t = Math.max(0, Math.round(SIMT - c.fedT));
  return '吃過 ' + (t >= 60 ? Math.floor(t / 60) + ' 分 ' : '') + (t % 60) + ' 秒前';
}
/** 伙夫去哪一座領：還在、領飯那一點還能走，能做飯或有現成的鍋；鍋多的先、同樣多照順序。 */
function galleyPick(sh) {
  var G = sh.galley, best = null;
  G.list.forEach(function (S) {
    if (!S.m.alive || !sh.nav.levels[S.lv].N.ok[S.pick] || !(S.cooking || S.stock > 0)) return;
    if (!best || S.stock > best.stock) best = S;
  });
  return best;
}
/** 點名時（42_hands.js callHands，排序之前）：餓的桌 ⇒ 派伙夫（pri 3：所有補位之後）。同時最多 go 個；照「多久沒吃（fed 早的先）→ 桌號」輪。
 *  斷炊（沒有一座能做飯）⇒ 只派現成的鍋夠領的那幾個（⛔ 讓人白跑）。 */
function galleyNeeds(sh, need) {
  var G = sh.galley; if (!G) return;
  var n = GALLEY.go - G.out; if (n <= 0) return;
  if (!G.list.some(function (S) { return S.cooking; })) n = Math.min(n, G.list.reduce(function (a, S) { return a + S.stock; }, 0) - G.out);
  if (n <= 0) return;
  var H = G.mess.filter(function (M) { return !M.busy && SIMT - M.fed >= GALLEY.hold && M.who.some(crewAble); }).sort(function (a, b) { return a.fed - b.fed || a.k - b.k; });
  for (var i = 0; i < H.length && i < n; i++) {
    var S = galleyPick(sh); if (!S) return;
    need.push({ kind: 'eat', key: 'm' + H[i].k, lv: S.lv, n: 1, x: S.m.c[0], cell: S.pick, pri: 3, mess: H[i], gal: S });
  }
}
/** 點名的派工迴圈跑完之後（42_hands.js callHands）：交戰要補的位（pri < 3）比閒人多 ⇒ 還沒走到爐灶、沒在爬梯子的伙夫叫回去（下一次點名就是閒人）。
 *  idle0：迴圈開始前的閒人數（sort 讓 pri < 3 的先吃掉閒人 ⇒ 缺額 ＝ Σ n − idle0）。已經到爐灶的不叫：最多幾秒就領完了。 */
function galleyPull(sh, need, idle0) {
  var G = sh.galley; if (!G) return;
  var want = 0; need.forEach(function (q) { if (q.pri < 3) want += q.n; });
  var unmet = want - idle0; if (unmet <= 0) return;
  sh.crew.filter(function (c) { return c.role === ROLE.HAND && crewAble(c) && c.hand.job && c.hand.job.kind === 'eat' && !c.hand.job.at && !c.hand.climb; }).slice(0, unmet)
    .forEach(function (c) { c.hand.job = null; c.hand.legs = []; c.hand.wait = 0; G.pulled++; });
}
/** 到了（42_hands.js handJoin）：站 fetchT 秒 ⇒ 有鍋就領（整桌算吃過）；沒鍋最多再等 waitT 秒。不在那一層、離領飯那一點太遠（路斷了）、爐灶打壞了 ⇒ 這一趟作廢。 */
function galleyJoin(sh, c) {
  var H = c.hand, J = H.job, S = J.gal, M = J.mess;
  if (!J.at) {
    var q = navPos(sh.nav.levels[S.lv].N, S.pick);
    if (H.lv !== J.lv || !S.m.alive || Math.hypot(q[0] - c.pos[0], q[1] - c.pos[1]) > GALLEY_NEAR) { H.job = null; H.wait = 1; return; }
    J.at = SIMT; c.home = c.pos.slice(); return;
  }
  if (!S.m.alive) { H.job = null; H.wait = 0.5; return; }
  var t = SIMT - J.at; if (t < GALLEY.fetchT) return;
  if (S.stock >= 1) {
    S.stock--; S.served++; sh.galley.served++; M.fed = SIMT; M.n++;
    M.who.forEach(function (o) { o.fedT = SIMT; }); c.fedT = SIMT;     // 整桌都算吃過（伙夫自己也是：他可能是別桌的）
    H.job = null; H.wait = 1; return;
  }
  if (t >= GALLEY.fetchT + GALLEY.waitT) { S.miss++; H.job = null; H.wait = 1; }   // 等不到 ⇒ 作廢（這一桌下一次點名再派）
}
/** HUD 一段（61_hud.js 詳細資訊的船員那一行）：「🍲 廚房 鍋 4／6　伙夫 2　效率 ×1.07（吃過 214／306）」；沒有廚房 ⇒ ''。 */
function galleyText(sh) {
  var G = sh.galley; if (!G) return '';
  var st = 0, cap = 0, why = '', fed = 0, n = 0;
  G.list.forEach(function (S) { st += S.stock; cap += GALLEY.stock; if (!why && S.why) why = S.why; });
  if (!why && !st && !G.list.some(function (S) { return S.cooking; })) why = '斷炊';
  sh.crew.forEach(function (c) { if (!crewAble(c) || c.role === ROLE.OFFICER) return; n++; if (galleyMealF(c) > 0) fed++; });
  return '　🍲 廚房 鍋 ' + st + '／' + cap + '　伙夫 ' + G.out + '　效率 ×' + galleyAvg(sh, false).toFixed(2) + '（吃過 ' + fed + '／' + n + '）' + (why ? '　' + why : '');
}
/** 讀數（__game.galley，⚠ 只在 ?debug=1；?dump 的 galley 一節照 galleyDump）：沒有廚房 ⇒ 排掉的原因或 null。
 *  rk ＝ 裝填的加權平均倍數 Σ dt·gunRate·g.eff ÷ Σ dt·gunRate（32_hull.js 只在 sh.effOn 時累加）；effT ＝ 每 30 秒一筆 [秒, 全船平均效率]。 */
function galleyInfo(sh) {
  var G = sh.galley, skip = (sh.galleySkip || []).slice();
  if (!G) return skip.length ? { skip: skip } : null;
  var fed = 0; sh.crew.forEach(function (c) { if (crewAble(c) && c.role !== ROLE.OFFICER && galleyMealF(c) > 0) fed++; });
  var rk = sh.effRk && sh.effRk[1] > 0 ? +(sh.effRk[0] / sh.effRk[1]).toFixed(4) : null;
  return { cooks: G.list.reduce(function (a, S) { return a + S.on; }, 0) + '/' + (sh.cookWant || 0), made: G.made, served: G.served, stock: G.list.reduce(function (a, S) { return a + S.stock; }, 0),
    going: G.going, out: G.out, pulled: G.pulled, eff: +galleyAvg(sh, false).toFixed(3), fed: fed, mess: G.mess.length, rk: rk, effT: G.effT, news: G.news,
    stoves: G.list.map(function (S) { return { name: S.m.path, alive: S.m.alive, hp: S.m.hp, lv: S.lv, faces: S.faces.length, cooks: S.on + '/' + S.cooks.length, stock: S.stock, prog: +S.prog.toFixed(2), made: S.made, served: S.served, lost: S.lost, miss: S.miss, why: S.why }; }), skip: skip };
}
/** ?dump 的 galley 一節（90_main.js；有廚房才有）：galleyInfo 的數字那幾欄（不帶每座爐灶、排掉的原因）。 */
function galleyDump(sh) {
  var I = galleyInfo(sh);
  return { cooks: I.cooks, made: I.made, served: I.served, stock: I.stock, miss: sh.galley.list.reduce(function (a, S) { return a + S.miss; }, 0), pulled: I.pulled, eff: I.eff, fed: I.fed, mess: I.mess, rk: I.rk, effT: I.effT };
}
/** 量斷炊用（__game.galley(i, 'kill')，⚠ 只在 ?debug=1）：這艘的廚師全部倒下 ⇒ 還剩幾位。 */
function galleyKill(sh) {
  if (!sh.galley) return 0;
  sh.crew.forEach(function (c) { if (c.role === ROLE.COOK && c.st < 2) killCrew(sh, c, '測試'); });
  return sh.crew.filter(function (c) { return c.role === ROLE.COOK && crewAble(c); }).length;
}
