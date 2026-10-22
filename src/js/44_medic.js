// ───────────────────────── 醫療艙：預備水手搬傷員、病床、治療（TASK-0568；Tim 2026-10-14） ─────────────────────────
// 開戰時（medInit，makeHands 之後）：每一間醫療艙找「走得到」的病床 —— 床旁邊的走路點，從待命那一層沿梯子連得通（照區域；開戰後梯子斷了 ⇒ 那一趟照實走不到）。
//   人手（Tim 2026-10-14：有病人才派）：一間有病人（躺著或正在送來）才要人 —— max(staff, ⌈病人 ÷ staffPer⌉)（config rooms.medical），沒病人 ＝ 0；
//   從預備水手派（點名時跟補位一起排，pri 1），到了就駐紮在那一間不走動；病人少了，多出來的人放回去當預備水手（還沒到的先放）。
//   ⛔ 以前開戰就照床數派滿：床都走得到之後憲法號要 22 人、餘燼號 29 人（預備水手 40）⇒ 補砲班、搬人都沒人了，傷員躺著等到被打死。
// 受傷倒下（st 1）的人：船上還有走得到、還沒打壞的床 ⇒ 不再 12 秒就消失，等預備水手來搬（pri 1：交戰那一舷的砲班先補）。
//   搬：走到傷員旁（同一層、同一塊）⇒ 扛起來（傷員跟著他走、爬梯子）⇒ 走到床旁 ⇒ 放上床（傷員還是 st 1：照樣會被打、會掉、會淹）。
//   治療：每次點名（0.5 秒）進度 += dt ÷ HEAL_T ×（1 ＋ 那一間的 heal buff）× 人手比例（到崗 ÷ 要的，最多 1）× 床剩下的血量比例；
//   滿了 ⇒ back 的機會治好歸隊（變成預備水手，血量至少 MED_HP × CREW_HP），其他的送下去不回來（st 3，跟以前 12 秒那條一樣）；床空出來。
// 沒有醫療艙／一張床都走不到／HEAL_T ＝ 0 ⇒ 完全照舊（12 秒抬下去）：不派人、不抽 rnd()。
// 手術台（Tim 2026-10-21：「不用這麼複雜 直接上病床治療就好(手術台可以更快治療(300%) 且要求船醫)」）：
//   病床、手術台都是能躺人的家具（config furniture[].hold），傷員一倒下就照距離搬上任何一張空的（不分交戰）。
//   手術台 furniture.table：rate 3 ＝ 躺在上面治療快 3 倍；doc 1 ＝ 那一間要有還能動的船醫才收新的傷員、才照 rate 算（船醫倒下 ⇒ 台上的人照病床的速度治，不搬走）。
//   ⛔ 10-20 那版「開打先上台子、砲停了 rooms.medical.calm 秒才開放病床、再從台子抬去病床」拿掉了（5cb2763）：Tim 嫌太複雜。
var MED_HP = 0.6, MED_UP = 7, MED_NEAR = 14;                  // 歸隊時的血量（× CREW_HP）；扛在肩上抬高幾格；走到傷員／床旁算「到了」的距離（格）
/** 開戰時：醫療艙裡走得到的床（m.med ＝ { lv, cell, who, rate：治療倍數, doc：要船醫 }）、每一間要幾個人手 ⇒ sh.med；一張都沒有 ⇒ null。 */
function medInit(sh) {
  sh.med = null; sh.medSkip = [];                                        // medSkip：排掉的醫療艙與原因（讀數照列，TASK-0572）
  var NV = sh.nav; if (!NV || HEAL_T <= 0 || !sh.rooms) return;
  var F = ROOM_FN.medical || {}, rooms = [];
  sh.rooms.forEach(function (r) {
    if (r.type !== 'medical') return;
    var lv = r.deck ? r.deck.i : lvOf(NV.levels, r.min[2]);              // 房間綁在甲板上（36_rooms.js）
    if (lv < 0) { sh.medSkip.push({ name: r.name, why: '找不到房間在哪一層甲板' }); return; }
    if (NV.reach.indexOf(lv) < 0) { sh.medSkip.push({ name: r.name, why: '走不到（沒有梯子通' + (r.deck ? r.deck.name : '第 ' + lv + ' 層') + '）' }); return; }
    var N = NV.levels[lv].N, beds = [], n = 0, off = 0;
    r.furn.forEach(function (m) {
      if (!m.hold) return;
      n++;
      var ci = navSnap(N, [m.c[0], m.c[1], r.min[2]], 6); if (ci < 0) { off++; return; }
      if (!handRoute(sh, NV.home, lv, m.c[0], m.c[0], undefined, N.reg[ci])) { off++; return; }   // 從待命那一層（哪一塊都行）走得到床旁那一塊
      var Fi = FURN[m.item] || {};
      m.med = { lv: lv, cell: ci, who: null, rate: Fi.rate > 0 ? +Fi.rate : 1, doc: !!Fi.doc }; beds.push(m);
    });
    if (!beds.length) { sh.medSkip.push({ name: r.name, why: n ? '病床 ' + n + ' 張都走不到（床旁那一塊跟梯子不通）' : '沒有病床' }); return; }
    var o = { room: r, lv: lv, beds: beds, far: off, need: 0, have: 0, x: beds[0].c[0] };   // need：點名時照病人數算（medTick）；far：走不到、沒算進來的床
    rooms.push(o); r.med = o;
  });
  NV.ladders.forEach(function (L) { L.q = 0; });                        // handRoute 會記排隊人數；這裡只是試走
  if (rooms.length) medComps(sh);
  if (!rooms.length) return;
  var tbl = 0; rooms.forEach(function (o) { o.beds.forEach(function (m) { if (m.med.doc) tbl++; }); });
  sh.med = { rooms: rooms, back: F.back === undefined ? 1 : F.back, smin: F.staff || 1, sper: F.staffPer || 3, sheal: F.surgeonHeal === undefined ? 0.5 : +F.surgeonHeal, carried: 0, healed: 0, out: 0, t: SIMT, open: true, tbl: tbl };
}
/** 這張現在收不收新的傷員：活著、空著；要船醫的（手術台）那一間要有還能動的船醫（medTick 算的 o.sg）。 */
function medFree(o, m) { return m.alive && !m.med.who && (!m.med.doc || o.sg > 0); }
/** 走得到的範圍：「層:區域」照沒斷的梯子連成幾群 ⇒ NV.comp[層:區域] ＝ 群號。開戰時、每次尋路刷新後（梯子斷了、甲板被打成幾塊）重算；
 *  只走區域與梯子（幾十個點），不找格子上的路。medNeeds 照它判傷員走不走得到床 ⇒ 走不到就不派人去扛（以前扛起來才發現，白跑一趟；TASK-0572）。 */
function medComps(sh) {
  var NV = sh.nav, C = {}, n = 0;
  NV.levels.forEach(function (L, lv) {
    L.N.regs.forEach(function (s, r) {
      if ((lv + ':' + r) in C) return;
      var q = [lv + ':' + r]; C[q[0]] = n;
      for (var i = 0; i < q.length; i++) {
        var u = q[i].split(':'), ul = +u[0], ur = +u[1];
        NV.ladders.forEach(function (Ld) { if (Ld.broken) return; var v = Ld.lo === ul && Ld.ra === ur ? Ld.hi + ':' + Ld.rb : Ld.hi === ul && Ld.rb === ur ? Ld.lo + ':' + Ld.ra : null; if (v && !(v in C)) { C[v] = n; q.push(v); } });
      }
      n++;
    });
  });
  NV.comp = C;
}
/** 那張床現在在哪一群（床旁的走路點被打掉 ⇒ undefined：誰都走不到）。 */
function medComp(NV, m) { var r = NV.levels[m.med.lv].N.reg[m.med.cell]; return r >= 0 ? NV.comp[m.med.lv + ':' + r] : undefined; }
/** 傷員的床位與扛他的人放掉（死了、落水、被放下、床被打壞）。 */
function medRelease(c) {
  if (c.medBed && c.medBed.med && c.medBed.med.who === c) c.medBed.med.who = null;
  if (c.carriedBy) c.pos[2] = c.carriedBy.pos[2];
  c.medBed = null; c.inBed = false; c.carriedBy = null; c.moving = false;
}
/** 倒下的人這一步要不要照舊「12 秒抬下去」：有醫療艙可以送（sh.med.open）、而且這個人搬得到（medOk 還沒判 ⇒ 先等）⇒ 不抬、等人來搬；被扛著 ⇒ 跟著扛他的人。 */
function medHold(sh, c) {
  if (c.carriedBy) {
    var k = c.carriedBy, J = crewAble(k) && k.hand && k.hand.job;
    if (!J || J.who !== c) medRelease(c);                                // 扛他的人倒下、被叫走 ⇒ 放在原地
    else { c.pos = [k.pos[0], k.pos[1], k.pos[2] + MED_UP]; return true; }
  }
  if (c.medBed) return true;
  return !!(sh.med && sh.med.open && c.medOk !== false);
}
/** 每次點名（0.5 秒）：床上的人治療、空出來的床收回、每一間的人手、還有沒有地方送（open）。 */
function medTick(sh) {
  var M = sh.med; if (!M) return;
  var dt = SIMT - M.t, beds = 0; M.t = SIMT;
  M.rooms.forEach(function (o) {
    var pt = 0; o.beds.forEach(function (m) { var w = m.med.who; if (w && w.st === 1 && w.medBed === m && m.alive) pt++; });
    o.need = pt ? Math.max(M.smin, Math.ceil(pt / M.sper)) : 0;           // 有病人才要人
    o.sg = 0; sh.crew.forEach(function (c) { if (c.role === ROLE.SURGEON && crewAble(c) && c.medRoom === o) o.sg++; });   // 船醫（medSurgeons）：在這一間、還能動的
    var hn = Math.max(0, o.need - o.sg);                                 // 要預備水手來的 ＝ 要的 − 船醫（船醫 0 ⇒ 跟以前一樣）
    var mine = sh.crew.filter(function (c) { return c.role === ROLE.HAND && crewAble(c) && c.hand.job && c.hand.job.med === o; });
    if (mine.length > hn) mine.sort(function (a, b) { return (a.hand.job.at ? 1 : 0) - (b.hand.job.at ? 1 : 0); }).slice(0, mine.length - hn).forEach(function (c) { c.hand.job = null; c.hand.legs = []; c.hand.wait = 1; });   // 多出來的放回去（還沒到的先放）
    o.have = 0;
    sh.crew.forEach(function (c) { if (c.role === ROLE.HAND && crewAble(c) && c.hand.job && c.hand.job.med === o && c.hand.job.at) o.have++; });
    var B = roomBuffNow(o.room), hb = (B.heal ? B.heal.v : 0) + (o.sg ? M.sheal : 0), staff = o.need ? Math.min(1, (o.have + o.sg) / o.need) : 1;   // 有船醫 ⇒ 治療快 sheal
    var me = sh.effOn ? effAvg(sh, sh.crew.filter(function (c) { return crewAble(c) && (c.role === ROLE.SURGEON ? c.medRoom === o : c.role === ROLE.HAND && c.hand.job && c.hand.job.med === o && c.hand.job.at); })) : 1;   // 工作效率（TASK-0720，39_eff.js）：這一間到崗的預備水手＋船醫平均；⛔ 沒開 ⇒ 字面上的 1
    o.beds.forEach(function (m) {
      var p = m.med.who;
      if (p && (p.st !== 1 || p.medBed !== m)) { if (p.medBed === m) medRelease(p); m.med.who = p = null; }
      if (!m.alive) { if (p) medRelease(p); m.med.who = null; return; }
      beds++;
      if (!p || !p.inBed) return;
      var rt = m.med.doc && !o.sg ? 1 : m.med.rate;                      // 手術台：船醫在才快 rate 倍（倒下了 ⇒ 照病床）
      p.heal = (p.heal || 0) + dt / HEAL_T * rt * (1 + hb) * staff * me * m.hp / m.hpMax;   // me 乘在 staff 的 Math.min(1, …) 外面（⛔ 放裡面 ⇒ 人到齊時加成被封頂吃掉）
      if (p.heal < 1) return;
      var lv = m.med.lv, ci = m.med.cell;
      medRelease(p);
      if (rnd() < M.back) medBack(sh, p, lv, ci); else { p.st = 3; M.out++; }
    });
  });
  M.open = beds > 0 && sh.crew.some(function (c) { return c.role === ROLE.HAND && crewAble(c); });
}
/** 船醫（TASK-0676；Tim 2026-10-17：「醫療倉可以直接換成護士」→「先把船醫套用上」）：開戰就站在醫療艙裡的床旁，不走動、不補位、火槍打不到（below）；
 *  幾位 ＝ 設施配員（Tim 2026-10-17：「房間(或關鍵設施) 可以自動配對應人員 例如醫療床配一名船醫」；36_rooms.js staffSlots）：走得到的病床、手術台每張配 furniture[].staff.surgeon 位，
 *  照醫療艙的順序一間一位輪著排（每一間先站第一張床，再輪第二張），船隻配置頁的 crew.surgeon 是全船上限；
 *  那一間要的人手先算船醫、不夠的才從預備水手派（預備水手 ＝ 船醫助手）；有船醫在的那一間治療快 sheal（設定檔 rooms.medical.surgeonHeal，預設 0.5 ＝ ＋50%）；
 *  搬傷員選床時有船醫的那幾間優先（同樣走得到的床，沒船醫的多算 MED_DOC 格）。倒下、陣亡 ⇒ 那一間退回只有助手；掉到別層、落水爬回來 ⇒ 當預備水手（同其他職位）。
 *  沒有醫療艙（sh.med ＝ null）⇒ 不上船、不算站不下；上限 0 ⇒ 戰局跟以前一位元不差（不抽 rnd()）；上限 1 ⇒ 跟以前「一位」同一個位置（第一間的第一張床）。 */
var MED_DOC = 300;
function medSurgeons(sh, crew, add) {
  var M = sh.med, cap = sh.cw.surgeon || 0;
  var S = M && cap ? staffSlots(M.rooms.map(function (o) { return o.beds; }), 'surgeon') : [], n = Math.min(cap, S.length);
  sh.surgWant = n; sh.surgSlots = S.length;                              // surgSlots：設施配得到的人數（讀數；被上限截掉的 ＝ surgSlots − surgWant）
  if (!n) return;
  var NV = sh.nav;
  for (var k = 0; k < n; k++) {
    var o = M.rooms[S[k].g], m = S[k].m, N = NV.levels[o.lv].N;
    add(ROLE.SURGEON, navPos(N, m.med.cell), null, 1);
    var c = crew[crew.length - 1]; c.art = ART_NURSE; c.medRoom = o; c.below = true; c.deck = NV.levels[o.lv].key;
  }
}
/** 治好歸隊：變成那一層床旁的預備水手（照常點名補位）；長相照舊。 */
function medBack(sh, c, lv, ci) {
  var NV = sh.nav, N = NV.levels[lv].N;
  sh.wounded--; sh.med.healed++;
  if (c.art === undefined) c.art = c.role;
  c.st = 0; c.t = 0; c.hp = Math.max(c.hp, CREW_HP * MED_HP); c.heal = 0;
  c.role = ROLE.HAND; c.gun = null; c.cart = false; c.walk = null; c.relieved = false; c.pm = null;
  c.pos = navPos(N, ci); c.home = c.pos.slice(); c.deck = NV.levels[lv].key;
  c.hand = { lv: lv, wait: rr(1, 3), legs: [], wp: null, k: 0, climb: null, job: null, to: null };
}
/** 點名時（callHands 排工作之前）：醫療艙要的人手、等著被搬的傷員 ⇒ 加進 need（每一筆 cell ＝ 最後要走到的走路點）。 */
function medNeeds(sh, need) {
  var M = sh.med; if (!M) return;
  var NV = sh.nav, assigned = {};
  sh.crew.forEach(function (c) { if (c.role === ROLE.HAND && crewAble(c) && c.hand.job && c.hand.job.kind === 'staff') { var k = c.hand.job.key; assigned[k] = (assigned[k] || 0) + 1; } });
  M.rooms.forEach(function (o) {
    var n = Math.max(0, o.need - (o.sg || 0)) - (assigned[o.room.name] || 0);   // 船醫先算（medTick o.sg）
    for (var j = 0; j < n; j++) { var b = o.beds[(assigned[o.room.name] || 0) + j] || o.beds[j % o.beds.length]; need.push({ kind: 'staff', key: o.room.name, lv: o.lv, n: 1, x: b.c[0], cell: b.med.cell, med: o, pri: 1 }); }
  });
  var free = [], doc = null; M.rooms.forEach(function (o) { o.beds.forEach(function (m) { if (medFree(o, m)) free.push(m); if (o.sg) (doc = doc || new Set()).add(m); }); });   // doc：有船醫在的那幾間的床（搬的時候優先；沒有船醫 ⇒ null，跟以前一樣）；手術台要船醫在才收（medFree）
  sh.crew.forEach(function (c) {
    if (c.st !== 1 || c.medBed || c.carriedBy) return;
    if (c.medNo) { c.medOk = false; return; }                            // 扛起來才發現走不到床（另一塊）⇒ 不再派人，照舊 12 秒
    var lv = lvAt(sh, c.pos), ci = lv >= 0 && NV.reach.indexOf(lv) >= 0 ? navSnap(NV.levels[lv].N, c.pos, 4) : -1;
    c.medOk = ci >= 0;                                                   // 桅頂、落在走路格外的 ⇒ 搬不到 ⇒ 照舊 12 秒抬下去
    if (ci < 0) return;
    var cw = NV.comp[lv + ':' + NV.levels[lv].N.reg[ci]];
    if (cw === undefined || !M.rooms.some(function (o) { return o.beds.some(function (m) { return m.alive && medComp(NV, m) === cw; }); })) { c.medOk = false; return; }   // 傷員那一群一張活著的床都沒有（梯子斷了、甲板打成兩塊）⇒ 不派人去扛，照舊 12 秒
    if (!free.length) return;                                            // 走得到的床都有人 ⇒ 等
    var bi = -1, bd = 1e9;
    free.forEach(function (m, i) { if (medComp(NV, m) !== cw) return; var d = Math.abs(m.c[0] - c.pos[0]) + 150 * Math.abs(m.med.lv - lv) + (doc && !doc.has(m) ? MED_DOC : 0); if (d < bd) { bd = d; bi = i; } });
    if (bi < 0) return;
    need.push({ kind: 'carry', key: '', lv: lv, n: 1, x: c.pos[0], cell: ci, who: c, bed: free.splice(bi, 1)[0], pri: 1 });
  });
}
/** 派到人了（callHands）：佔床。 */
function medTake(q) {
  if (q.kind !== 'carry') return;
  q.bed.med.who = q.who; q.who.medBed = q.bed;
}
/** 到了（handJoin）：人手 ⇒ 駐紮；搬 ⇒ 扛起來往床走／放上床。不在那一層、離太遠（路斷了）⇒ 放下、這一趟作廢。 */
function medJoin(sh, c) {
  var H = c.hand, J = H.job, NV = sh.nav;
  if (J.kind === 'staff') {
    if (J.at) return;
    if (H.lv !== J.lv) { H.job = null; H.wait = 1; return; }
    J.at = true; c.home = c.pos.slice(); return;
  }
  var p = J.who, m = J.bed, at = J.stage === 'bed' ? navPos(NV.levels[J.lv].N, m.med.cell) : p.pos;
  if (p.st !== 1 || p.medBed !== m || !m.alive || H.lv !== J.lv || Math.hypot(at[0] - c.pos[0], at[1] - c.pos[1]) > MED_NEAR) {
    if (p.medBed === m || p.carriedBy === c) medRelease(p);
    H.job = null; H.wait = 0.5; return;
  }
  if (J.stage !== 'bed') {                                               // 走到傷員旁 ⇒ 扛起來，往床走
    var lv = m.med.lv, N = NV.levels[lv].N, legs = handRoute(sh, H.lv, lv, c.pos[0], m.c[0], handReg(sh, c), N.reg[m.med.cell]);
    if (!legs) { medRelease(p); p.medNo = true; H.job = null; H.wait = 0.5; return; }
    p.carriedBy = c; p.moving = true;
    H.legs = legs.concat([{ w: lv, to: m.med.cell }]); J.stage = 'bed'; J.lv = lv;
    return;
  }
  p.carriedBy = null; p.moving = false; p.inBed = true;                  // 到床旁 ⇒ 放上床
  p.pos = [m.c[0], m.c[1], m.bb[5] - 1]; p.home = p.pos.slice();
  sh.med.carried++;
  H.job = null; H.wait = rr(0.5, 2);
}
/** HUD 一行：醫療艙（床 佔用／走得到、人手、搬下去、治好歸隊）。 */
function medText(sh) {
  var M = sh.med; if (!M) return '';
  var n = 0, used = 0, st = 0, need = 0, tn = 0, tu = 0;
  M.rooms.forEach(function (o) { st += o.have; need += o.need; o.beds.forEach(function (m) { if (!m.alive) return; var u = m.med.who && m.med.who.inBed ? 1 : 0; if (m.med.doc) { tn++; tu += u; } else { n++; used += u; } }); });
  var sg = 0; M.rooms.forEach(function (o) { sg += o.sg || 0; });
  return '　醫療' + (M.tbl ? ' 手術台 ' + tu + '/' + tn : '') + ' 床 ' + used + '/' + n + (sh.surgWant ? '　船醫 ' + sg + '/' + sh.surgWant : '') + '　人手 ' + st + '/' + need + '　搬下 ' + M.carried + '　歸隊 ' + M.healed;
}
/** 讀數（__game.med）。skipped：排掉的醫療艙與原因（一間都沒排進來 ⇒ 只有 skipped，傷員照舊 12 秒抬下去）；沒設醫療艙 ⇒ null。 */
function medInfo(sh) {
  var M = sh.med, skipped = (sh.medSkip || []).slice();
  if (!M) return skipped.length ? { skipped: skipped } : null;
  return { carried: M.carried, healed: M.healed, out: M.out, drowned: sh.bedDrowned || 0, open: M.open, tables: M.tbl, surgeons: { want: sh.surgWant || 0, slots: sh.surgSlots || 0, cap: sh.cw.surgeon || 0 }, rooms: M.rooms.map(function (o) {
    return { name: o.room.name, lv: o.lv, beds: o.beds.length, tables: o.beds.filter(function (m) { return m.med.doc; }).length, tableOn: o.beds.filter(function (m) { return m.med.doc && m.med.who && m.med.who.inBed; }).length, far: o.far, alive: o.beds.filter(function (m) { return m.alive; }).length, inBed: o.beds.filter(function (m) { return m.med.who && m.med.who.inBed; }).length, coming: o.beds.filter(function (m) { return m.med.who && !m.med.who.inBed; }).length, staff: o.have + '/' + o.need, surgeon: o.sg || 0 };
  }), skipped: skipped, waiting: sh.crew.filter(function (c) { return c.st === 1 && !c.medBed && c.medOk !== false; }).length, carrying: sh.crew.filter(function (c) { return c.st === 1 && c.carriedBy; }).length, noRoute: sh.crew.filter(function (c) { return c.medNo; }).length };
}
