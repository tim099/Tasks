// ───────────────────────── 控制器（TASK-0668 ②：操作與鏡頭拆成控制器） ─────────────────────────
// 71_input.js 只收事件、把手勢整理好（拖、兩指、滾輪、點一下、鍵），交給這裡；每個控制器管一種操作，照優先序（pri 大的先）一個一個問，
//   處理函式回 true ＝ 接住了、不往下傳；沒有那一個函式或回 false ⇒ 下一個。每個控制器自己看自己開著沒（fpKey 關著也要收放開的鍵 ⇒ 不先篩）。
// 疊法：海戰鏡頭（orbit，永遠在最底下）← 第一人稱（fp，疊在海戰或建造上）← 建造（build，疊在第一人稱上，只多吃它自己的鍵與滑鼠）。
//   鍵盤：第一人稱的鍵 → 建造的鍵 → 海戰的動作（跟拆之前同一個順序）；第一人稱沒吃的（P 停格、O 設定…）照樣落到海戰。
//   滑鼠：拖曳（fp 轉頭 ／ orbit 繞、右鍵平移）、兩指（fp 不動 ／ orbit 縮放＋平移）、滾輪（fp 不動 ／ orbit 縮放）、點一下（fp 不瞄準 ／ orbit 點船瞄準）、
//   按下（broadcast：每個都收 —— fp 抓住滑鼠、build 抓住時左鍵拆右鍵放）、抓住時的移動（fp 轉頭）。
//   每一格畫面（90_main.js frame）：每個控制器的 frame（第一人稱走、爬、退出判斷；建造的準心）—— 關著也叫（它們自己收尾，例：bldFrame 拿掉 #stage.bld）。
// 加一種操作 ＝ ctrlAdd 一份（不用改 71_input.js 的事件）。ctrlTop() ＝ 現在最上面開著的那一個（讀數；__game.ctrl）。
var CTRLS = [];
function ctrlAdd(c) { CTRLS.push(c); CTRLS.sort(function (a, b) { return b.pri - a.pri; }); }
/** 照優先序問：第一個回 true 的接住 ⇒ 回那個控制器；沒人接 ⇒ null。 */
function ctrlDo(ev, a, b, c) { for (var i = 0; i < CTRLS.length; i++) { var f = CTRLS[i][ev]; if (f && f(a, b, c)) return CTRLS[i]; } return null; }
/** 每個都叫（不看回傳）。 */
function ctrlEach(ev, a, b) { for (var i = 0; i < CTRLS.length; i++) { var f = CTRLS[i][ev]; if (f) f(a, b); } }
function ctrlTop() { for (var i = 0; i < CTRLS.length; i++) if (CTRLS[i].on()) return CTRLS[i].name; return null; }
function ctrlFrame(dt) { ctrlEach('frame', dt); }

// 海戰鏡頭：繞著船轉、右鍵（或兩指）平移、滾輪（或兩指張合）縮放、點船瞄準；海戰的鍵（66_keys.js battle）。
ctrlAdd({ name: 'orbit', pri: 0, on: function () { return true; },
  key: function (k, down, e) {
    if (!down) { kbLit(k, false); keyUp(k); return true; }
    var ba = keyAct('battle', k);                                       // 海戰的動作（66_keys.js 鍵位）
    if (!modeRule('battleKeys') && ba !== 'pause' && ba !== 'settings' && ba !== 'cam' && !(modeRule('observe') && (ba === 'cut' || ba === 'deck' || ba === 'xray'))) return true;   // 玩法規則 battleKeys（04_modes.js；建造、觀察）：開砲、轉舵那些鍵不作用；觀察照樣切剖面、甲板、透視
    if (ba) e.preventDefault();
    kbLit(k, true); doKey(k, e.repeat); return true;
  },
  drag: function (dx, dy, btn) { if (btn === 2) camPanBy(dx, dy); else camOrbit(dx, dy); return true; },
  pinch: function (P, m, d) {
    camSet({ dist: clamp(P.dist * P.d / d, 12, 900) });
    if (!P.moved && Math.hypot(m.x - P.x0, m.y - P.y0) < 8) return true;   // 兩指中點移了 8 px 以上才開始平移（⛔ 不設門檻 ⇒ 只是張合時手指晃一下畫面也跟著跑）
    P.moved = true; camPanBy(m.x - P.mx, m.y - P.my); P.mx = m.x; P.my = m.y; return true;
  },
  wheel: function (dy) { camSet({ dist: clamp(CAM.dist * Math.pow(1.0015, dy), 12, 900) }); return true; },
  tap: function (x, y, btn) { if (btn === 0 && RUNNING) inPick(x, y); return true; }
});
// 第一人稱（81_fps.js）：鍵（走、跳、爬、跟隨…；fpKey 關著也收放開的鍵）、拖曳轉頭、抓住滑鼠；吃掉縮放、平移、點一下瞄準。
ctrlAdd({ name: 'fp', pri: 20, on: function () { return FP.on; },
  key: function (k, down, e) { if (!fpKey(k, down)) return false; e.preventDefault(); return true; },
  drag: function (dx, dy) { if (!FP.on) return false; fpLook(dx, dy); return true; },
  pinch: function () { return FP.on; },                                 // 兩指不縮放、不平移
  wheel: function () { return FP.on; },
  tap: function () { return FP.on; },                                   // 點一下不瞄準
  down: function (e) { if (FP.on && e.pointerType === 'mouse' && e.button === 0 && !PAUSED) fpLock(); },
  look: function (e) {                                                  // 單一事件超過 FP_SPIKE px ⇒ 丟掉（Windows 上 Chrome 抓住滑鼠時偶爾回一個上百 px 的假位移 ⇒ 視角一下甩好幾十度；本機沒重現到，TASK-0700 的保險）
    var mx = e.movementX || 0, my = e.movementY || 0;
    if (FP.on && fpLocked() && Math.abs(mx) <= FP_SPIKE && Math.abs(my) <= FP_SPIKE) fpLook(mx * FP_MOUSE_K, my * FP_MOUSE_K);
  },
  frame: function (dt) { fpFrame(dt); }
});
// 建造（82_build.js）：疊在第一人稱上 —— 快捷欄、轉、拆、放、目錄、碰撞的鍵；抓住滑鼠時左鍵拆、右鍵放（跟 Minecraft 一樣）。
ctrlAdd({ name: 'build', pri: 10, on: function () { return BLD.on && FP.on; },
  key: function (k, down, e) { if (!bldKey(k, down)) return false; if (down) e.preventDefault(); return true; },
  mouse: function (e) { if (!BLD.on || !FP.on || !fpLocked()) return; if (e.button === 0) bldDo(true); else if (e.button === 2) bldDo(false); },
  frame: function () { bldFrame(); }
});
// 船隻觀察（86_inspect.js）：只有每一格（面板的開關跟著鍵、勾了的部件掛名字）；鍵、滑鼠照海戰鏡頭（繞、縮放、平移）。
ctrlAdd({ name: 'inspect', pri: 5, on: function () { return INSP.on; }, frame: function () { inspFrame(); } });
