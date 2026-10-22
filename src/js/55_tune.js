// ───────────────────────── 可調參數（TASK-0687：艦隊指揮官 AI ① 自動調參） ─────────────────────────
// Tim 2026-10-17：「自動調參（最推薦，先做這個）」。指揮官（53_commander.js）、艦長（54_helm.js）裡影響戰局的常數集中登記在這裡，
//   每一方（藍／紅）可以各自覆寫一組（TUNE.blue／TUNE.red）⇒ 擬真沙盒的工作模式（84_fleetlab.js flabWork）讓「候選」對「基準」打，src/tune.py 用演化法找。
// ⛔ 沒有覆寫（TUNE 兩方都是 null，遊戲平常就是這樣）⇒ 每一個讀的地方拿到的就是原本那個常數 ⇒ 一位元都不差。
// 表：鍵 ⇒ [預設, 下限, 上限, 說明]。預設直接引用原本的常數（54_helm.js 在前面先跑完）；艦長性格表（HELMS）裡有的那幾個鍵照艘的性格讀（tuneH）。
var TUNE_DEF = {
  range: [HELMS.basic.range, 0.6, 1.6, '交戰距離的倍率（× aiRange，開局距離夾 90–220 m；不超過要對敵那一側的武器打得到的距離，54_helm.js helmRange）'],
  swap: [HELMS.basic.swap, 0.2, 0.9, '這一舷火力不到另一舷幾成就換舷'],
  evade: [HELMS.basic.evade, 0.2, 0.9, '自己最強一舷不到敵艦最強一舷幾成 ⇒ 拉開'],
  evadeOut: [HELMS.basic.evadeOut, 0.3, 1.1, '回到幾成以上才回交戰距離'],
  think: [HELMS.basic.think, 1, 10, '艦長幾秒重想一次哪一舷、要不要拉開'],
  far: [HELM_FAR, 1.1, 2.6, '遠於幾倍交戰距離 ⇒ 全速接近'],
  evadeR: [HELM_EVADE_R, 1.0, 2.2, '被壓制時拉開到幾倍交戰距離'],
  cutIn: [1.5, 0.4, 1.5, '太遠時往敵艦切的最大角度（rad）'],
  pullOut: [0.3903, 0.1, 1.0, '太近時往外拉的最大角度（rad）'],
  distK: [0.5, 0.5, 3, '距離差換成航向修正的倍率（(d − R)／R × 它）'],
  brgK: [HELM_BRG_K, 0.5, 4, '守正橫：敵艦偏前 90° ⇒ 期望航速多幾 m/s'],
  leadT: [HELM_LEAD_T, 5, 40, '戰列排頭照幾秒後的距離轉'],
  lineGap: [CMD_LINE_GAP, 70, 160, '戰列前後兩艘中心隔幾公尺'],
  focusW: [0, 0, 1, '集火挑目標：剩的戰力的權重（其餘給距離）']   // ⚠ 53_commander.js cmdFocus 也寫著同一個預設（指揮官跟 2D 沙盒共用，那邊沒有這張表）
};
// 預設值（2026-10-18 起）＝ 第一次整晚 run 調出來的那組（CMA-ES 16 代 × 10，best.json 的 mean）；調之前：range 1、swap 0.5、evade 0.5、evadeOut 0.65、think 3、far 1.6、evadeR 1.4、
//   cutIn 1.2、pullOut 0.4、distK 1.5、brgK 2、leadT 15、lineGap 90、focusW 0.6。讀數在 README「自動調參」。
//   ⚠ 有 8 個撞在上下限（range、think、cutIn、distK、brgK、leadT、lineGap、focusW）⇒ 下一次 run 先放寬範圍。
var TUNE = { blue: null, red: null };                                    // 每一方的覆寫（{ 鍵: 值 }；null ＝ 全照預設）
/** 這一方的這一個參數：有覆寫 ⇒ 覆寫的值，沒有 ⇒ 預設。 */
function tuneV(team, k) { var t = TUNE[team]; return t && t[k] !== undefined ? t[k] : TUNE_DEF[k][0]; }
/** 艦長性格表裡的那一項（H ＝ HELMS[sh.helm]）：這一方有覆寫 ⇒ 覆寫的值，沒有 ⇒ 照這艘的性格。 */
function tuneH(sh, H, k) { var t = TUNE[sh.team]; return t && t[k] !== undefined ? t[k] : H[k]; }
/** 一組覆寫照表夾在上下限裡、丟掉表上沒有的鍵（從網址或工作來的）。 */
function tuneClean(o) {
  if (!o || typeof o !== 'object') return null;
  var r = {}, n = 0; Object.keys(o).forEach(function (k) { var d = TUNE_DEF[k], v = +o[k]; if (d && isFinite(v)) { r[k] = clamp(v, d[1], d[2]); n++; } });
  return n ? r : null;
}
