// ───────────────────────── 事件（TASK-0669：模擬與畫面解耦） ─────────────────────────
// 區塊職責：模擬層（船體、物理、船員、模擬與 AI）往上層講話只走這裡 —— 發事件；HUD、報表、慢動作、特效、音效、鏡頭、測試紀錄自己訂閱。
// 物理意義：以前模擬檔直接呼叫 61_hud 的 note、79_report 的 rptHit、12_effects 的 spawnPt……（10-17 量：66 個名字、226 次、60 條檔對檔）⇒ 拆不開、不開畫面就跑不了。
//   下面這幾個名字（note、sfx、spawnPt……）照舊給模擬檔呼叫，但只發事件；真正做事的在各層（hudNote、sfxPlay、fxPt……），載入時 evOn 訂閱。
//   同一件事好幾個人聽 ⇒ 照 order 小的先、同 order 照訂閱的先後 —— 拆之前同一步裡誰先做，拆之後還是誰先做。
// 無頭（?demo=…&headless=1）：view 的訂閱一律不收、不開畫面迴圈、不建網格 ⇒ 不畫、不放特效、不出聲、不廣播；戰局 dump 要跟有畫面那場逐位元相同（TASK-0669 驗收）。
// ⛔ 放在 00_core.js 後面、其他檔前面：03_camera、02_audio 這些比較早載入的檔也要在載入時訂閱。
var EV_SUB = {}, HEADLESS = DEMO >= 0 && Q.get('headless') === '1';
/** 訂閱事件 t：order 小的先（沒給 ＝ 0）；view ＝ 只給人看的（無頭時不收）。 */
function evOn(t, fn, order, view) {
  if (view && HEADLESS) return;
  var L = EV_SUB[t] || (EV_SUB[t] = []), o = order || 0, i = L.length;
  while (i > 0 && L[i - 1].o > o) i--;
  L.splice(i, 0, { f: fn, o: o });
}
/** 發事件 t（最多 10 個參數；同步：回來的時候每個訂閱的都做完了）。 */
function evEmit(t, a, b, c, d, e, f, g, h, i, j) {
  var L = EV_SUB[t]; if (!L) return;
  for (var k = 0; k < L.length; k++) L[k].f(a, b, c, d, e, f, g, h, i, j);
}
/** 問答（TASK-0669 第二段）：模擬層要問上層一個值（例：遠的船帆與繩降級 —— 只有鏡頭知道離多遠）⇒ evAsk(t, 沒人答時的值, 參數)；
 *  上層 evAnswer(t, 函式, view) 回答（一題一個人答；view 的無頭時不收 ⇒ 回沒人答時的值）。 */
var EV_ASK = {};
function evAnswer(t, fn, view) { if (!(view && HEADLESS)) EV_ASK[t] = fn; }
function evAsk(t, d, a, b) { var f = EV_ASK[t]; return f ? f(a, b) : d; }
/** 拿掉事件 t 的訂閱（fn 沒給 ＝ 全部；反向對照與測試用）。回傳拿掉幾個。 */
function evOff(t, fn) {
  var L = EV_SUB[t] || [], n = L.length;
  EV_SUB[t] = fn ? L.filter(function (s) { return s.f !== fn; }) : [];
  return n - EV_SUB[t].length;
}

// ── 模擬層呼叫的名字（只發事件；誰在聽寫在右邊）──
// 只在同一步裡發的事件（不是函式名）：viewStep（每一步只給人看的推進：碎木、煙囪排煙、粒子；12_effects、78_funnel）、
//   survey（每半秒每艘一次：廣播整理；61_hud）、stepEnd（每一步最後：報表、測試紀錄、結束判定；79_report、83_testlog、61_hud）、
//   ballGone（砲彈落地或打中：鏡頭跟著它的話停一下；03_camera）、playerTake（玩家換船：鏡頭、按住的舵鍵；03_camera、71_input）。
//   第二段：viewStepSlow（殉爆慢動作中只推船邊水花；13_water）、cell／armCell（打掉船殼／裝甲的一格：附近的區重建；62_simview）、
//   armorShip（開船：裝甲掛網格；62_simview）、pieceNew／pieceGone（碎塊的網格；62_simview）、phys（物理開關的按鈕；62_simview）、
//   burnAsh（一格燒穿：灰燼與火星；49_burn ⇒ 59_burnfx）。
//   問答：rigFar（遠的船帆與繩降級；03_camera camRigFar）。
function note(sh, text, imp) { evEmit('note', sh, text, imp); }                                  // 廣播（61_hud hudNote）
function newsGun(sh, m, drop) { evEmit('newsGun', sh, m, drop); }                                 // 砲被打飛（61_hud）
function newsCrew(sh, c, dead, cause) { evEmit('newsCrew', sh, c, dead, cause); }                 // 有人倒下（61_hud）
function swimNews(sh, k) { evEmit('swimNews', sh, k); }                                           // 落水的人回來、被撈（61_hud）
function crewShortNote(sh) { evEmit('crewShort', sh); }                                           // 船員站不下（61_hud）
function rptHit(b, sh, what) { evEmit('rptHit', b, sh, what); }                                   // 戰鬥報表（79_report）
function rptShot(sh, g, b) { evEmit('rptShot', sh, g, b); }
function rptHelm(sh, kind, text) { evEmit('rptHelm', sh, kind, text); }
function burnNews(sh, kind, a) { evEmit('burnNews', sh, kind, a); }                               // 著火的廣播（49_burn.js ⇒ 61_hud hudBurnNews）：first 起火、all 全熄、ign／out 一處、thru 燒穿水線下、sail／sailGone／sailOut／sailCut 帆
function slowKick(sh, w, R) { evEmit('blast', sh, w, R); }                                        // 殉爆的慢動作與特寫（73_slowmo）
function tlgEv(sh, c, kind, data) { evEmit('tlgEv', sh, c, kind, data); }                         // 測試模式的船員記錄（83_testlog）
function sfx(kind, at, vol) { evEmit('sfx', kind, at, vol); }                                     // 音效（02_audio sfxPlay）
function spawnDebris(p, v, col, size, life, shape) { evEmit('debris', p, v, col, size, life, shape); }   // 特效（12_effects fx*）
function spawnPlates(sh, removed, vd, sp, per, max, M) { evEmit('plates', sh, removed, vd, sp, per, max, M); }
function spawnPt(p, v, life, col, a, s0, s1, grav, drag, ty) { evEmit('pt', p, v, life, col, a, s0, s1, grav, drag, ty); }
function smoke(p, dir, n, big) { evEmit('smoke', p, dir, n, big); }
function flash(p, dir, n, big) { evEmit('flash', p, dir, n, big); }
function splash(p, big) { evEmit('splash', p, big); }
function wpBump(pa, pb, A, B) { evEmit('wpBump', pa, pb, A, B); }                                // 船邊水花（13_water waterBump）
function wpPour(P, out, rate) { evEmit('wpPour', P, out, rate); }                                 // 艙裡的水往外流（13_water waterPour）
function ptMute(on) { evEmit('ptMute', on); }                                                     // 接下來的 spawnPt 收到也不放（參數的亂數照樣抽完；13_water PT_MUTE）

// ── 核心往外殼（主選單、設定頁）講話（2026-10-21 核心與外殼拆兩包）：核心不碰 #cover，只發事件；外殼（71_input.js 主選單那一段）訂閱 ──
// 事件：boot:say（載入的字；BOOT.say 留一份 ⇒ 晚訂閱的也讀得到）、boot:hull（解析船型的進度）、boot:loaded（編成的船型載好：重畫選單）、
//   boot:ready（可以開戰了）、flow:start（開戰、量測頁接手畫面：收起主選單；uiAway）、flow:menu（回主選單，沒有外掛外殼接手時；menuGo）、
//   weather（換了天氣；setWeather）、pslow（物理減速開關；pslowToggle）。⛔ 照原本的時機做 ⇒ 不標 view（無頭時原本也做）。
var BOOT = { say: '' };
function bootSay(s) { BOOT.say = s; evEmit('boot:say', s); }
