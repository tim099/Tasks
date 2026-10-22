// ───────────────────────── 工作效率（TASK-0720；Tim 2026-10-19） ─────────────────────────
// Tim 2026-10-19：「水手可以到廚房吃飯獲得buff(可以加一個水手工作效率數值 基礎1 吃飯加成 可以有其他因素影響)」
// 每個船員一個倍數 c.eff：基礎 1 ＝ EFF_PARTS 各項相乘，夾在 [EFF_MIN, EFF_MAX]。這一版只有「吃過飯」一項（45_galley.js）；
//   之後的疲勞、受傷、士氣 ⇒ 在 EFF_PARTS 多寫一筆（on：哪艘船有開這一項；k：那個人這一項的倍數；text：給第一人稱、HUD 的一句）。
// 每半秒（32_hull.js survey，galleyTick 之後、callHands 之前）effTick 重算一次；乘點每一步只讀現成的 c.eff，不在 1/60 秒的迴圈裡重算。
// 乘在「站著做」的那一段：裝填（32_hull.js、g.eff ＝ 在崗砲班的平均，40_crew.js manning）、送藥手裝藥包（23_powder.js）、人力抽水（45_pumps.js）、
//   醫療（44_medic.js）、木匠修補與拿木材（46_carpenter.js）、帆匠補帆與拿帆布（47_sailmaker.js）、救火（49_burn.js）、火槍（40_crew.js）、廚師做飯（45_galley.js）。
//   ⛔ 走路、爬梯、游泳不乘（梯子排隊、點名的距離估計會跟著動）；槳這一版不乘（31_drive.js 的輸出 ≤ 1 封頂）。
// ⛔ 沒有任何一項開著的船（sh.effOn false：開戰時 effInit 算一次）⇒ crewEff／effAvg 回字面上的 1，乘點乘的就是 1
//   （IEEE 754：x × 1、x ÷ 1 捨入後就是 x；ECMAScript 每個 *、/ 各自捨入、不合併成 FMA）⇒ 沒有廚房的船戰局一位元不動。
var EFF_MIN = 0.2, EFF_MAX = 3;
var EFF_PARTS = [
  // ⛔ k／text 包一層 function：分檔載入（沒建置的 template.html）時 45_galley.js 還沒跑，直接寫 galleyMealK 會存成 undefined
  { id: 'meal', name: '吃過飯', on: function (sh) { return !!sh.galley; }, k: function (sh, c) { return galleyMealK(sh, c); }, text: function (sh, c) { return galleyMealText(sh, c); } }   // 45_galley.js
  // 之後：{ id: 'tired', name: '疲勞', on: …, k: …, text: … }、受傷、士氣 —— 只在這裡多一筆
];
/** 開戰時（40_crew.js makeCrew 最後，galleyInit 之後）：這艘有沒有任何一項開著；開著 ⇒ effRk 記裝填的加權倍數（32_hull.js：[Σ dt·gunRate·g.eff, Σ dt·gunRate]，讀數 rk）。 */
function effInit(sh) { sh.effOn = EFF_PARTS.some(function (p) { return p.on(sh); }); if (sh.effOn) sh.effRk = [0, 0]; }
/** 那個人現在的倍數（各項相乘、夾在 EFF_MIN～EFF_MAX）。 */
function effCalc(sh, c) {
  var e = 1;
  for (var i = 0; i < EFF_PARTS.length; i++) if (EFF_PARTS[i].on(sh)) e *= EFF_PARTS[i].k(sh, c);
  return Math.min(EFF_MAX, Math.max(EFF_MIN, e));
}
/** 每半秒（32_hull.js survey）：全船重算 c.eff；沒開 ⇒ 什麼都不做。 */
function effTick(sh) { if (!sh.effOn) return; sh.crew.forEach(function (c) { c.eff = effCalc(sh, c); }); }
/** 乘點讀的：那個人的倍數。⛔ 沒開 ⇒ 字面上的 1（不先算再乘）。 */
function crewEff(sh, c) { return sh.effOn && c.eff !== undefined ? c.eff : 1; }
/** 一組人的平均倍數（抽水、醫療：照到崗的人平均）；沒開、沒人 ⇒ 1。 */
function effAvg(sh, L) {
  if (!sh.effOn || !L.length) return 1;
  var s = 0; L.forEach(function (c) { s += crewEff(sh, c); });
  return s / L.length;
}
/** 給第一人稱、HUD 的一句：「×1.06（吃過 1 分 12 秒前）」；沒開 ⇒ ''。 */
function effText(sh, c) {
  if (!sh.effOn) return '';
  var t = []; EFF_PARTS.forEach(function (p) { if (p.on(sh)) { var s = p.text(sh, c); if (s) t.push(s); } });
  return '×' + crewEff(sh, c).toFixed(2) + (t.length ? '（' + t.join('、') + '）' : '');
}
