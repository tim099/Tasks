// ───────────────────────── 航海士與軍需官（TASK-0825；TASK-0676 拆出） ─────────────────────────
// Tim 2026-10-22（0676 拍板 #4）：航海士「目前想法是可以增加船隻航行性能(航速 轉彎等) 採用加成(動力全無時不會憑空生出動力)」、軍需官「送藥變快」、
//   倒下或陣亡之後「軍官頂替打折」。
// 人數：船隻配置頁 crew.navigator／crew.quartermaster（0–1；0 ＝ 沒有這個職位、戰局跟以前一位元不差）。貼圖：ART_NAVIGATOR、ART_QUARTERMASTER（Sirius 的圖）。
//   · 航海士站在後甲板舵輪旁（露天，會被火槍打）；沒有舵輪 ⇒ 站在軍官那一帶。
//   · 軍需官站在彈藥庫的取用點旁（第一個取用點，往船裡讓開 4 格，不佔送藥手的位子）；沒有彈藥庫（沒有取用點）⇒ 不上船。
//     頭上有遮蔽（45_galley.js galleyRoof）⇒ 甲板下、火槍打不到；槳帆船的取用點在露天甲板 ⇒ 打得到。
//   · 都不走動（照船醫、廚師）；掉到別層、落水爬回來 ⇒ 當預備水手（40_crew.js landIn 的通用處理）⇒ 不算在崗。
// 加成（設定檔 duty；admin.py DUTY_NUMS；後台可調）：
//   · 航海士在崗 ⇒ 推進力 × (1 ＋ navSpd ÷ 100)²（推力 ∝ 航速² ⇒ 最高航速 ×(1 ＋ navSpd%)；31_drive.js driveStep 乘在帆、蒸汽、槳加總的推力上 ⇒
//     帆全收、動力全無時推力 0 × 任何倍數 ＝ 0，不會憑空生出動力）、最大轉向率 × (1 ＋ navTurn ÷ 100)（31_sailing.js rmax、rmaxB 一起）。
//   · 軍需官在崗 ⇒ 送藥手在取用點裝藥包的那幾秒 × (1 ＋ qmFill ÷ 100) 倍快（23_powder.js 'fill'）。
//   · 不在崗（受傷、陣亡、落水、掉到別層）⇒ 還有軍官能動（船長、大副…）⇒ 加成 × standIn（預設一半）；軍官也全倒 ⇒ 沒有加成。
// 每半秒（32_hull.js survey，effTick 之後）dutyTick 重算 sh.navF／sh.navT／sh.qmK；乘點只讀現成的值。
// ⛔ 這艘沒有航海士（人數 0、或站不下）⇒ sh.navF／navT 是 undefined ⇒ 乘點整段跳過（不乘 1）；軍需官同理 ⇒ 戰局一位元不動。
//   有這兩位的船：生人的時候 add() 抽 rnd() ⇒ 放在 makeCrew 最後（廚房分桌之後），其他職位的站位、亂數順序都不變。
var DUTY = CFG.duty || { navSpd: 10, navTurn: 20, qmFill: 30, standIn: 0.5 };
/** 開戰時（40_crew.js makeCrew 最後）：生航海士、軍需官。g ＝ 站人的格、wheel ＝ 舵輪模型、qx ＝ 後甲板（軍官站位的基準 x）、sz0／sz1 ＝ 露天甲板站人的高度。 */
function dutyCrew(sh, crew, add, g, taken, wheel, qx, sz0, sz1) {
  var CW = sh.cw, CY = sh.T.cy; sh.navWant = 0; sh.qmWant = 0; sh.duty = null;
  if (CW.navigator > 0) {
    sh.navWant = 1;
    var wx = wheel ? Math.floor(wheel.c[0]) : qx + 8, at = null;
    [[wx, CY + 10], [wx, CY - 10], [wx + 6, CY + 12], [wx + 6, CY - 12]].forEach(function (p) { if (!at) at = standNear(g, p[0], p[1], sz0, sz1, 14, taken); });   // 舵輪的兩側（右舷先）
    if (at) { add(ROLE.NAVIGATOR, at, null, 1); var c = crew[crew.length - 1]; c.art = ART_NAVIGATOR; dutyOf(sh).nav = c; }
  }
  var st = (sh.stations || [])[0];
  if (CW.quartermaster > 0 && st) {
    sh.qmWant = 1;
    var zr = sh.deckZ[st.deck], BASE = sh.T.base, s0 = st.at, sg = s0[1] > CY ? -1 : 1, q = null;
    [[0, 4], [4, 4], [-4, 4], [0, 8]].forEach(function (d) { if (!q) q = standNear(BASE, Math.floor(s0[0] + d[0]), Math.floor(s0[1] + sg * d[1]), zr[0], zr[1], 12, taken); });   // 取用點往船裡讓開（不佔送藥手裝藥包的位子）
    if (q) { add(ROLE.QUARTERMASTER, q, null, 1); var c2 = crew[crew.length - 1]; c2.art = ART_QUARTERMASTER; c2.deck = st.deck; c2.below = galleyRoof(navBase(sh.T), c2.pos); dutyOf(sh).qm = c2; }   // below：頭上有遮蔽 ⇒ 火槍打不到（40_crew.js musket；槳帆船的取用點在露天甲板 ⇒ 打得到）
  }
  if (sh.duty) dutyTick(sh);
}
function dutyOf(sh) { return sh.duty || (sh.duty = { nav: null, qm: null, navS: '', qmS: '' }); }
/** 這位在不在崗：能動、還在原本那一層（掉下去、落水爬回來 ⇒ 40_crew.js 改成預備水手，role 變了）。 */
function dutyAt(c, role) { return !!c && c.role === role && crewAble(c); }
/** 頂替的倍數：還有軍官能動 ⇒ standIn；軍官也全倒 ⇒ 0。 */
function dutyStandIn(sh) { return sh.crew.some(function (o) { return o.role === ROLE.OFFICER && crewAble(o); }) ? DUTY.standIn : 0; }
/** 每半秒（32_hull.js survey）：在崗 ⇒ 全加成、不在崗 ⇒ 軍官頂替打折、都沒有 ⇒ 1。⛔ 沒有那個職位的船不寫（乘點跳過）。 */
function dutyTick(sh) {
  var D = sh.duty; if (!D) return;
  var si = -1;
  if (D.nav) {
    var kn = dutyAt(D.nav, ROLE.NAVIGATOR) ? 1 : (si = dutyStandIn(sh)), v = 1 + DUTY.navSpd / 100 * kn;
    sh.navF = v * v; sh.navT = 1 + DUTY.navTurn / 100 * kn; D.navS = kn === 1 ? '航海士在崗' : kn > 0 ? '軍官代航海士' : '航海士不在';
  }
  if (D.qm) {
    var kq = dutyAt(D.qm, ROLE.QUARTERMASTER) ? 1 : si >= 0 ? si : dutyStandIn(sh);
    sh.qmK = 1 + DUTY.qmFill / 100 * kq; D.qmS = kq === 1 ? '軍需官在崗' : kq > 0 ? '軍官代軍需官' : '軍需官不在';
  }
}
/** HUD 一段（61_hud.js 詳細資訊的船員那一行）：「🧭 航海士在崗 航速 +10% 轉向 +20%　📦 軍需官在崗 送藥 +30%」；兩位都沒有 ⇒ ''。 */
function dutyText(sh) {
  var D = sh.duty; if (!D) return '';
  function pc(x) { return (x >= 1 ? '+' : '') + Math.round((x - 1) * 100) + '%'; }
  return (D.nav ? '　🧭 ' + D.navS + ' 航速 ' + pc(Math.sqrt(sh.navF)) + ' 轉向 ' + pc(sh.navT) : '') + (D.qm ? '　📦 ' + D.qmS + ' 送藥 ' + pc(sh.qmK) : '');
}
/** 第一人稱跟著的那位是航海士／軍需官 ⇒ 職位後面補「（在崗：航速 +10%、轉向 +20%）」；其他人 ⇒ ''。 */
function dutyWho(sh, c) {
  var D = sh.duty; if (!D) return '';
  if (c === D.nav) return dutyAt(c, ROLE.NAVIGATOR) ? '（在崗：航速 +' + DUTY.navSpd + '%、轉向 +' + DUTY.navTurn + '%）' : '';
  if (c === D.qm) return dutyAt(c, ROLE.QUARTERMASTER) ? '（在崗：送藥 +' + DUTY.qmFill + '%）' : '';
  return '';
}
/** 讀數（__game.duty）：誰在崗、倍數。 */
function dutyInfo(sh) {
  var D = sh.duty; if (!D) return { nav: null, qm: null, want: [sh.navWant || 0, sh.qmWant || 0] };
  return { want: [sh.navWant, sh.qmWant], nav: D.nav ? { st: D.nav.st, role: ROLE_NAME[D.nav.role], at: D.nav.pos.slice(), on: D.navS, F: sh.navF, T: sh.navT } : null,
    qm: D.qm ? { st: D.qm.st, role: ROLE_NAME[D.qm.role], at: D.qm.pos.slice(), on: D.qmS, K: sh.qmK } : null };
}
