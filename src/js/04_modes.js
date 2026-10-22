// ───────────────────────── 玩法規則表（TASK-0668） ─────────────────────────
// 區塊職責：每種玩法（MODE，04_state.js）一份規則：其他船動不動手、船隊怎麼組、判不判勝負、自動開砲的預設、開局提示、我艦停不停、海戰的鍵、我艦的裝填……
// 物理意義：以前每個檔各自寫 MODE === 'sandbox'（「沙盒的敵艦不還手」在 4 支檔各寫一次）⇒ 現在都問 modeRule(鍵)；
//   加一種玩法 ＝ 這張表加一份（只寫跟 MODE_BASE 不一樣的格）＋要的話加控制器；主選單的玩法鈕照這張表生（71_input.js modeButtons），存檔照它認（69_prefs.js）。
// ⛔ 操作與鏡頭（第三人稱／第一人稱／建造游標）是另一條軸，不放這張表（0668 第二段：控制器）；建造的介面本身在 82_build.js。
// 失敗處置：MODE 不在表裡（舊存檔、打錯字）⇒ 照 pve。
var MODE_BASE = {
  menu: true,          // Blockside 主選單有沒有這顆鈕（也是存檔認不認）
  url: true,           // 網址 ?mode= 認不認（Blocksail 的海戰頁、地球儀照網址帶玩法；TASK-0776 跟 menu 拆開：建造、航海只給 Blocksail ⇒ 主選單不列、網址照認）
  observe: false,      // 船隻觀察的面板（86_inspect.js：剖面、甲板、透視、部件清單勾選高亮）；剖面、甲板、透視的鍵在 battleKeys 關著時照樣作用
  othersAct: true,     // 我艦以外的船動不動手：電腦轉舵開砲（50_sim.js ai）、陸戰隊與桅頂開槍（40_crew.js）、舉槍的姿勢（41_crew_art.js）
  fleet: 'menu',       // 船隊：'menu' ＝ 照主選單的兩邊艦隊；'first' ＝ 只生我方第一艘（52_fleet.js fleetSpec）
  judge: true,         // 判勝負、結算（61_hud.js checkEnd）
  autoFire: false,     // 自動開砲的預設（換了玩法才套；70_flow.js reset）
  hint: true,          // 開局提示「點敵艦設瞄準點…」（70_flow.js start）
  stopOwn: false,      // 我艦停在原地（跟拋錨同一條；31_sailing.js）
  battleKeys: true,    // 開砲、轉舵那些海戰的鍵作用（false ⇒ 只剩停格、設定、鏡頭；71_input.js）
  myReload: RELOAD,    // 我艦的裝填秒數基準（10_ship.js、52_fleet.js 換船時跟著換）
  fpLock: false,       // 固定第一人稱：🎥、Y 不能離開（81_fps.js fpBuildLock）
  build: false,        // 建造介面（82_build.js bldEnter）
  chart: false,        // 小地圖（海圖，63_chart.js；要有 ?map）
  origin: false        // 我艦開局停在原點（海圖的開戰位置 ＝ 外面給的起點），船頭照 ?hdg=（羅盤度數；沒給 ＝ 往北）；⛔ 不照開局距離退開（52_fleet.js spawnFleet）
};
var MODE_RULES = {
  pve: { name: '對戰電腦' },
  eve: { name: '觀戰（自動開砲）', autoFire: true },
  sandbox: { name: '沙盒（敵艦不還手）', othersAct: false, judge: false, myReload: RELOAD_SANDBOX },
  // 船隻觀察（TASK-0776；Tim 2026-10-21「加一個船隻觀察頁面 可以切換剖視圖 & 甲板 作為一種模式(參考 建造 航海)」）：只有我艦、停在原地、不開砲 ⇒ 觀察面板（86_inspect.js）
  observe: { name: '🔍 船隻觀察', fleet: 'first', judge: false, hint: false, stopOwn: true, battleKeys: false, observe: true },
  // 建造、航海只給 Blocksail（Tim 2026-10-21「Blockside入口不顯示建造&航海(這兩個是給Blocksail使用的)」）：主選單不列、存檔不認，網址 ?mode=build／sail 照認
  build: { name: '🔨 建造', menu: false, fleet: 'first', judge: false, hint: false, stopOwn: true, battleKeys: false, fpLock: true, build: true },
  // 航海（Blocksail 地球儀的「⛵ 航海」，2026-10-19；Tim：「單船、沒有敵艦，其他跟戰鬥一樣」）：只有我艦、不判勝負、停在外面給的起點（城鎮的港口外）
  sail: { name: '⛵ 航海', menu: false, fleet: 'first', judge: false, hint: false, origin: true, chart: true }
};
Object.keys(MODE_RULES).forEach(function (m) { for (var k in MODE_BASE) if (!(k in MODE_RULES[m])) MODE_RULES[m][k] = MODE_BASE[k]; });
// ?mode=<玩法>（外部開戰用：Blocksail 的開戰設定，2026-10-18）：一般遊玩也照網址選玩法（表裡 url 的才認；沒給 ⇒ 照設定檔、存檔）。?demo 照舊在 90_main.js 自己選。
var MODE_Q = DEMO < 0 && Object.prototype.hasOwnProperty.call(MODE_RULES, Q.get('mode')) && MODE_RULES[Q.get('mode')].url ? Q.get('mode') : null;
if (MODE_Q) flowMode(MODE_Q);
/** 現在這個玩法的規則 k。 */
function modeRule(k) { return (MODE_RULES[MODE] || MODE_RULES.pve)[k]; }
