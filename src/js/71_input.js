// ───────────────────────── 輸入 ─────────────────────────
// 這裡只收事件、整理手勢（拖、兩指、滾輪、點一下、鍵），做什麼由控制器決定（71_ctrl.js ctrlDo：第一人稱 → 建造 → 海戰鏡頭，TASK-0668 ②）。
var inDrag = null, PTRS = new Map(), PINCH = null;          // PTRS：按著的指頭（觸控）；兩指（PINCH）⇒ 張合 ＝ 縮放、一起拖 ＝ 平移（同右鍵拖曳；Tim 2026-10-13），不轉鏡頭也不瞄準
function pinchD() { var a = Array.from(PTRS.values()); return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1; }
function pinchM() { var a = Array.from(PTRS.values()); return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 }; }
cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
document.addEventListener('contextmenu', function (e) { if (!/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) e.preventDefault(); });   // 面板、按鈕、說明上長按也不跳選單（輸入框照常）
cv.addEventListener('pointerdown', function (e) {
  try { cv.setPointerCapture(e.pointerId); } catch (x) { }                // 抓住滑鼠（pointer lock，第一人稱）時抓不到指標 ⇒ InvalidStateError（Tim 2026-10-18 回報：皇家號第一人稱）；照樣記指頭
  PTRS.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (PTRS.size === 2) { var m0 = pinchM(); PINCH = { d: pinchD(), dist: CAM.dist, x0: m0.x, y0: m0.y, mx: m0.x, my: m0.y, moved: false }; inDrag = null; return; }
  if (PTRS.size > 2) return;
  inDrag = { x: e.clientX, y: e.clientY, b: e.button, moved: false };
});
cv.addEventListener('pointerdown', function (e) { ctrlEach('down', e); });   // 按下：每個控制器都收（第一人稱抓住滑鼠）
cv.addEventListener('mousedown', function (e) { ctrlEach('mouse', e); });    // 滑鼠鍵（建造：抓住時左鍵拆、右鍵放；⛔ 用 mousedown：按著左鍵再按右鍵不會有第二個 pointerdown）
document.addEventListener('mousemove', function (e) { ctrlEach('look', e); }); // 抓住滑鼠時的移動（第一人稱轉頭）
cv.addEventListener('pointermove', function (e) {
  if (PTRS.has(e.pointerId)) PTRS.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (PINCH && PTRS.size === 2) { ctrlDo('pinch', PINCH, pinchM(), pinchD()); return; }   // 兩指：海戰鏡頭縮放＋平移；第一人稱不動
  if (!inDrag) return;
  var dx = e.clientX - inDrag.x, dy = e.clientY - inDrag.y;
  if (!inDrag.moved && Math.hypot(dx, dy) < 5) return;
  inDrag.moved = true; inDrag.x = e.clientX; inDrag.y = e.clientY;
  ctrlDo('drag', dx, dy, inDrag.b);                                    // 第一人稱：轉頭；海戰鏡頭：繞、右鍵平移
});
function ptrEnd(e) { PTRS.delete(e.pointerId); if (PTRS.size < 2) PINCH = null; }
cv.addEventListener('pointerup', function (e) {
  if (inDrag && !inDrag.moved && !PINCH) ctrlDo('tap', e.clientX, e.clientY, inDrag.b);   // 點一下：海戰鏡頭點船瞄準；第一人稱不瞄準
  inDrag = null; ptrEnd(e);
});
cv.addEventListener('pointercancel', function (e) { inDrag = null; ptrEnd(e); });
cv.addEventListener('wheel', function (e) { e.preventDefault(); ctrlDo('wheel', e.deltaY); }, { passive: false });   // 海戰鏡頭縮放；第一人稱不動
function inPick(cx, cy) {
  var r = cv.getBoundingClientRect(), nx = (cx - r.left) / r.width * 2 - 1, ny = 1 - (cy - r.top) / r.height * 2;
  var a = M4.pt(CAM.inv, nx, ny, -1), bq = CAM.inv, w0 = bq[3] * nx + bq[7] * ny + bq[11] * -1 + bq[15], w1 = bq[3] * nx + bq[7] * ny + bq[11] + bq[15];
  var p0 = mul(M4.pt(CAM.inv, nx, ny, -1), 1 / w0), p1 = mul(M4.pt(CAM.inv, nx, ny, 1), 1 / w1), d = norm(sub(p1, p0));
  var me = SHIPS[PLAYER_I], hit = null, on = null;                   // 除了自己，每艘還浮著的船都射一次（友艦也瞄得到），取最近的那一個（t：沿射線多遠；每艘的公尺／格一樣）
  SHIPS.forEach(function (o) {
    if (o === me || o.sunk) return;
    var oL = toLocal(o, p0), dL = M4.dir(o.inv, d[0], d[1], d[2]), h = VK.raycast(o.grid, oL, dL, 3000);
    if (o.arm) { var ha = armRay(o, oL, dL, 3000); if (ha && (!h || ha.t < h.t)) h = ha; }   // 砲帶的裝甲（24_armor.js）也點得到（換回船的格座標）
    var hs = sailRay(o, oL, dL, h ? h.t : 3000); if (hs) h = hs;         // 帆布也點得到（比船身近才算）
    if (h && (!hit || h.t < hit.t)) { hit = h; on = o; }
  });
  // Tim 2026-10-14：「點海會取消瞄準；點在船身上（也可以瞄友軍，可以變色）就變成那一邊的砲手控」
  //   點到船 ⇒ 瞄準點設在那艘（敵艦 ⇒ 也是我的目標，52_fleet.js pickFoes；友艦 ⇒ 圈變藍、打下去照樣是誤擊）；瞄準模式回到自由。
  //   自動開砲開著 ⇒ 對得到它的那一舷交給玩家（me.hand；空白鍵齊射），另一舷照樣自動（50_sim.js aiSecond）。
  //   點到海 ⇒ 取消瞄準（手動 ⇒ 回到預設的瞄法；自動開砲 ⇒ 回到全自動）。
  if (hit) {
    setAim(me, [hit.x + 0.5, hit.y + 0.5, hit.z + 0.5], on); me.pMode = AIM_P = 'free'; sfx('crack', null, 0.08);
    if (!isFoe(me, on)) note(me, '瞄準友艦 ' + on.name + teamTag(on) + ' —— 打下去一樣會傷到它');
    else if (hit.sail) note(me, '瞄準 ' + on.name + ' 的帆');
    if (AUTOFIRE && !me.hand) { me.hand = true; note(me, '手動瞄準：這一舷你來打（' + keyWord('volley') + '齊射），另一舷照樣自動 —— 點海面回到全自動'); }
  } else if (me.aim) {
    setAim(me, null);
    if (AUTOFIRE && me.hand) { me.hand = false; note(me, '取消瞄準 —— 回到全自動開砲'); } else note(me, '取消瞄準');
  }
}
/** 帆布也點得到（Tim 2026-10-17：「手動瞄準也能瞄準帆布」）：照畫出來的那一面（11_rig_gpu.js sailBuf 同一個判斷）每個三角形量一次射線（兩面都算），取 tMax 以內最近的。
 *  回傳跟 VK.raycast 一樣：x,y,z ＝ 落點 −0.5（pick 會加回去 ⇒ 瞄準點就在布上那一點）、t 以 dL 的長度為單位。
 *  收起來的帆（s.furled，留著的那一捲也是）、掉了的不算 —— 砲彈也打不到它們。只在點的那一下算，不碰戰局。 */
var SAIL_PICK = null;
function sailRay(o, oL, dL, tMax) {
  var bt = tMax, best = null;
  (o.cl || []).forEach(function (c, k) {
    var s = o.sails[k], P; if (!s || s.dead || s.furled) return;
    if (PHYS) {
      if (!c.p || c.hidden || c.gone) return;
      if (!SAIL_PICK || SAIL_PICK.length < c.T.n * 3) SAIL_PICK = new Float32Array(c.T.n * 3);
      P = clothFine(c, SAIL_PICK); if (c.furlF !== null && c.furlF !== undefined) P = furlDraw(c, P, c.furlF, o);   // 張帆收帆演到一半：照畫出來的位置
    } else P = c.T.p0;
    var tr = c.T.tris, tv = c.torn ? c.tv : null;                        // tv：撕開的洞（不畫的細格點）
    for (var j = 0; j < tr.length; j += 3) {
      if (tv && (tv[tr[j]] || tv[tr[j + 1]] || tv[tr[j + 2]])) continue;
      var a = tr[j] * 3, b = tr[j + 1] * 3, e = tr[j + 2] * 3;           // Möller–Trumbore
      var ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[e] - P[a], vy = P[e + 1] - P[a + 1], vz = P[e + 2] - P[a + 2];
      var px = dL[1] * vz - dL[2] * vy, py = dL[2] * vx - dL[0] * vz, pz = dL[0] * vy - dL[1] * vx, det = ux * px + uy * py + uz * pz;
      if (Math.abs(det) < 1e-12) continue;
      var f = 1 / det, sx = oL[0] - P[a], sy = oL[1] - P[a + 1], sz = oL[2] - P[a + 2], u = (sx * px + sy * py + sz * pz) * f;
      if (u < 0 || u > 1) continue;
      var qx = sy * uz - sz * uy, qy = sz * ux - sx * uz, qz = sx * uy - sy * ux, v = (dL[0] * qx + dL[1] * qy + dL[2] * qz) * f;
      if (v < 0 || u + v > 1) continue;
      var t = (vx * qx + vy * qy + vz * qz) * f;
      if (t > 0 && t < bt) { bt = t; best = s; }
    }
  });
  return best ? { x: oL[0] + dL[0] * bt - 0.5, y: oL[1] + dL[1] * bt - 0.5, z: oL[2] + dL[2] * bt - 0.5, t: bt, sail: best } : null;
}
window.addEventListener('keydown', function (e) {
  if (!RUNNING) return;
  if ($('err').style.display === 'flex') { if (e.key === 'Escape') { e.preventDefault(); $('err').style.display = 'none'; } return; }   // 報錯／問題回報彈窗開著（01_gl.js）⇒ 鍵不進遊戲（⛔ 不擋 ⇒ 在回報欄打 R 就回主選單、打 N 就重開）；Esc 關掉它
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;      // 在輸入框裡打字 ⇒ 不當成遊戲的鍵
  var k = e.key.toLowerCase(); if (e.code === 'Space') k = ' ';
  if (k === 'escape') { e.preventDefault(); if (GFXOV.open) { gfxOvClose(); return; } if (FP.on && fpEscEaten()) return; if (HELP.open) helpClose(); else if (FLX) floodClose(); else if (FLX3) xrayToggle(); else gsetToggle(); return; }   // 遊戲內的設定面板
  ctrlDo('key', k, true, e);                                         // 第一人稱（走、爬…；P 停格、O 設定沒吃 ⇒ 往下）→ 建造（快捷欄、轉、拆、放…）→ 海戰的動作（71_ctrl.js）
});
/** 鍵盤按著的時候，畫面上對應的按鈕也亮成按下的顏色（Tim 2026-10-14；跟手指按住同一個 .down）；方向鍵照 A／D／W／S 的按鈕。 */
function kbLit(k, on) { var a = keyAct('battle', k); if (!a) return; [].forEach.call(document.querySelectorAll('.kb[data-act]'), function (b) { if (b.dataset.act === a) b.classList.toggle('down', on); }); }   // 方向鍵照它對應的動作（66_keys.js KEY_FIX）
/** 一個鍵（鍵盤）⇒ 海戰的動作（66_keys.js keyAct：照現在的鍵位；方向鍵固定 ＝ 打舵、帆）。 */
function doKey(k, repeat) { var a = keyAct('battle', k); if (a) doAct(a, repeat); }
/** 一個動作（鍵盤與畫面上的圓鈕共用 ⇒ 手機也能玩；動作表在 66_keys.js KEY_ACTS）。打舵、帆是「按住」：這裡只按下，放開走 actUp。 */
/** 外掛外殼的掛鉤（admin.py shell；2026-10-21）：別的遊戲拿這份成品套自己的外殼（標題、樣式、幾個行為）⇒ 外殼在 window.BS_SHELL 放同名函式；
 *  有、而且沒回 false ⇒ 外殼接手了（true）；沒有外殼、沒有這一個 ⇒ false，照 Blockside 自己的做。現在的掛鉤：menu（回主選單）。 */
function shellCall(k) { var S = window.BS_SHELL, f = S && S[k]; return typeof f === 'function' ? f() !== false : false; }
/** 回主選單（R、設定面板的「回主選單」、結束畫面的「回選單」）：被 Blocksail 嵌著（?map=@host）⇒ 交給它（08_seabed.js bedHostMenuGo）；
 *  外掛外殼（admin.py shell）接手 ⇒ 例 Blocksail 的 battle.html 直接開 ⇒ 回 Blocksail 的主選單；都沒有 ⇒ 停下來、發 flow:menu（Blockside 自己的主選單出來）。 */
function menuGo() {
  if (bedHostMenuGo() || shellCall('menu')) { gsetClose(); helpClose(); return; }
  gsetClose(); helpClose(); flowRun(false); END_AT = 0; END_WAIT = null; evEmit('flow:menu'); $('end').className = '';
}
function doAct(a, repeat) {
  if (!RUNNING) return;
  var me = SHIPS[PLAYER_I];
  if (a === 'volley') { if (!PAUSED && !me.sunk) broadside(me, ammoNow()); }   // 降旗了 ⇒ broadside／fireOne 自己擋；ammoNow：開著自動開砲 ⇒ 砲長照瞄準位置挑（61_hud.js）
  else if (a === 'fire1') { if (!PAUSED && !me.sunk) fireOne(me, ammoNow()); }
  else if (a === 'ammo') ammoNext();                                     // 彈種：一個鍵輪流（61_hud.js ammoNext）
  else if (a === 'aim') { me.pMode = AIM_P = AIM_CYCLE[(AIM_CYCLE.indexOf(me.pMode || 'free') + 1) % AIM_CYCLE.length]; note(me, '瞄準：' + AIM_NAME[me.pMode] + (me.pMode === 'free' ? '（點敵艦設瞄準點）' : '')); }   // 瞄準模式（51_captain.js）
  else if (a === 'cam') camCycle();                                    // 換鏡頭（03_camera.js）
  else if (a === 'pause') { flowPause(!PAUSED); frzShow(); pauseLabel(); }                               // 停格（72_floodui.js：停格時上方一條、進水細節頁）
  else if (a === 'flood') { if (PAUSED) floodToggle(); }                 // 停格時：進水圖表／透視（72_floodui.js）
  else if (a === 'xray') xrayToggle();                                   // 觀察模式：透視（72_floodui.js）、剖面、隱藏甲板（74_cutaway.js）—— 不停格也能切換（Tim 2026-10-16）
  else if (a === 'cut') cutToggle();
  else if (a === 'deck') deckCycle();
  else if (a === 'mute') { muted = !muted; sndApply(); gsetShow(); }
  else if (a === 'help') helpToggle();
  else if (a === 'menu') menuGo();
  else if (a === 'sailMode') sailToggle();   // 一顆切換 自動 ⇄ 手動（Tim 2026-10-15：「改成單鍵」；手動也可以直接打舵）；錨在水裡 ⇒ 先起錨（左右錨拋的也一起）
  else if ((a === 'ancAll' || a === 'ancP' || a === 'ancS') && me && !me.sunk && anchorsOf(me).noAnchor) setSailMode(SAIL === 'off' ? 'manual' : 'off');   // 整艘沒有錨（TASK-0635）：三個錨鍵都是停船 ⇄ 手動
  else if (a === 'ancAll' && me && !me.sunk) {                              // 拋錨／起錨同一顆（Tim 2026-10-15；76_anchor.js anchor6）：兩邊都沒拋 ⇒ 雙錨（拋錨模式、只有我艦）；一邊在水裡 ⇒ 拋另一邊；兩邊都在水裡 ⇒ 起錨
    var a6 = anchor6(me);
    if (a6.act === 'both') setSailMode('off');
    else if (a6.act === 'other') { var am = anchorToggle(me, a6.k, true); if (am) note(me, am + '（兩邊都拋了，再按一次起錨）'); }
    else { if (SAIL === 'off') setSailMode('manual'); var nw = anchorWeighAll(me); note(me, nw ? '起錨（' + nw + '）—— 8 秒收好' : '錨都收著'); }   // 拋錨模式 ⇒ 換手動、我艦的雙錨跟著收
  }
  else if ((a === 'ancP' || a === 'ancS') && RUNNING && me && !me.sunk && !anchorsOf(me).single) { var am = anchorToggle(me, a === 'ancP' ? 'P' : 'S'); if (am) note(me, am + (/^拋/.test(am) ? '（帶著速度只拋一側 ⇒ 繞錨急轉；再按一次起錨）' : '')); }   // 左右錨（76_anchor.js）   // 航行（TASK-0567，Tim 2026-10-14：不用 Tab 循環，三個鍵直接切）
  else if (a === 'hostBack') bedHostBackGo();                                 // 🌍 回到地球儀（只有 ?map=@host；08_seabed.js）
  else if (a === 'settings') gsetToggle();                                    // 設定（Esc 也可以）
  else if (a === 'signals') sigToggle();                                     // 旗號面板（TASK-0679）
  else if (a === 'ruddL' || a === 'ruddR') {   // 打舵：自動中一碰就換手動
    if (SAIL === 'auto') setSailMode('manual'); KEYS[a === 'ruddL' ? 'l' : 'r'] = true;   // 拋錨中 ⇒ 不換模式、繞錨原地轉
  }
  else if ((a === 'teleFwd' || a === 'teleBack') && RUNNING && me && !me.sunk) teleStep(me, a === 'teleFwd' ? -1 : 1);   // 俥鐘（31_drive.js；Tim：「也要支援快捷鍵操作」）：往前撥、往後撥；沒有額外動力的船不動
  else if (a === 'camTrack') setCamTrack(!CAM.track);
  else if (a === 'autoFire') setAutoFire(!AUTOFIRE);
  else if (a === 'phys') setPhys(!PHYS);
  else if (a === 'restart') { gsetClose(); helpClose(); start(); }                                        // 重新開始：同樣的模式、距離、滑桿，不用打完
  else if (a === 'sailUp' || a === 'sailDn') {     // 帆裝
    if (!repeat) { var sd = a === 'sailUp' ? 1 : -1; sailStep(me, sd); KEYS.sw = { d: sd, n: SIMT + SAIL_HOLD }; }   // 按住 ⇒ 1 秒後逐級再切（31_sailing.js sailHold）   // 有額外動力的船：滿帆再加 ⇒ 全速前進、全收再收 ⇒ 倒車（31_sailing.js）
  }
}
function keyUp(k) { var a = keyAct('battle', k); if (a) actUp(a); }
function actUp(a) { if (a === 'ruddL') KEYS.l = false; if (a === 'ruddR') KEYS.r = false; if (KEYS.sw && (a === 'sailUp' ? 1 : a === 'sailDn' ? -1 : 0) === KEYS.sw.d) KEYS.sw = null; }
window.addEventListener('keyup', function (e) { var k = e.key.toLowerCase(); if (e.code === 'Space') k = ' '; ctrlDo('key', k, false, e); });   // fpKey：第一人稱的鍵放開（沒開 ⇒ 只清掉自己按著的、照舊往下走）
window.addEventListener('blur', function () { KEYS.l = KEYS.r = false; KEYS.sw = null; [].forEach.call(document.querySelectorAll('.kb.down'), function (b) { b.classList.remove('down'); }); });   // 切走視窗 ⇒ 收不到 keyup，按下的顏色一起清掉
// iPhone 連點兩下放大（Tim 2026-10-15：「連點角落兩下還是會放大，按控帆按鈕太快就觸發」—— 根上的 touch-action:manipulation iOS 不一定照做）：
// 兩次手指放開相隔 < 350 ms ⇒ 取消第二次的預設動作（＝雙擊縮放）。取消之後瀏覽器不會補 click ⇒ 一般按鈕自己補一個；
// 按住型（data-hold：舵、帆）走 pointer 事件不受影響；輸入框照舊（要能點兩下選字）；遊戲畫面本來就是 touch-action:none（自己處理手勢、不補 click）。
var TAP_T = -1e9;
document.addEventListener('touchend', function (e) {
  var now = e.timeStamp, dbl = now - TAP_T < 350, t = e.target; TAP_T = now;
  if (!dbl || e.touches.length || !t || !t.closest || t === cv || t.closest('input, select, textarea')) return;
  e.preventDefault();
  if (!t.closest('[data-hold]')) { var c = e.changedTouches[0]; t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: c ? c.clientX : 0, clientY: c ? c.clientY : 0 })); }
}, { passive: false });
// 畫面上的圓鈕（下方控制列 .kb、說明裡的 kbd[data-act]）：點 ＝ 做那個海戰動作（鍵照 66_keys.js keyPaint 寫上去）；data-hold 的（打舵、帆）按住才算
[].forEach.call(document.querySelectorAll('[data-act]'), function (b) {
  var k = b.dataset.act;
  if (b.dataset.hold) {
    b.addEventListener('pointerdown', function (e) { e.preventDefault(); b.classList.add('down'); doAct(k, false); try { b.setPointerCapture(e.pointerId); } catch (x) { } });   // 手指滑出按鈕也算按著，放開才鬆舵
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (ev) { b.addEventListener(ev, function () { b.classList.remove('down'); actUp(k); }); });
  } else b.addEventListener('click', function (e) { e.preventDefault(); doAct(k, false); });
});
/** 航行模式（選單與遊戲中同一個）：auto 兩艘自動、manual 我艦手動、off 我艦拋雙錨（只管我艦；31_sailing.js sail）（76_anchor.js；Tim 2026-10-15：停船改叫拋錨）。 */
var SAIL_NAMES = { auto: '自動航行', manual: '手動操舵（{AD} 打舵）', off: '拋錨（雙錨；{AD} 繞錨轉）' };   // {AD}：左右舵的鍵（66_keys.js）
function setSailMode(m) {
  SAIL = m; KEYS.l = KEYS.r = false;
  if (m === 'auto' && SHIPS[PLAYER_I]) SHIPS[PLAYER_I].sailHand = SHIPS[PLAYER_I].teleHand = false;   // 切回自動駕駛 ⇒ 帆、俥鐘也交回艦長（54_helm.js）
  [].forEach.call(document.querySelectorAll('[data-s]'), function (x) { x.classList.toggle('on', x.dataset.s === SAIL); }); sailLabel();
  var noA = RUNNING && SHIPS.length && anchorsOf(SHIPS[PLAYER_I]).noAnchor;
  if (RUNNING && SHIPS.length) note(SHIPS[PLAYER_I], ((m === 'off' && noA ? '停船（這艘沒有錨：帆與引擎不出力、船慢慢停下）' : m === 'off' && anchorsOf(SHIPS[PLAYER_I]).single ? '拋錨（單錨；{AD} 繞錨轉）' : SAIL_NAMES[m]) + (noA ? '（' + keyName('sailMode') + ' 自動／手動切換、' + keyName('ancAll') + ' 停船、再按一次開船）' : '（' + keyName('sailMode') + ' 自動／手動切換、' + keyName('ancAll') + ' 拋錨、再按一次起錨）')).replace(/\{AD\}/g, keyName('ruddL') + '／' + keyName('ruddR')));   // 單錨的船（TASK-0635）
}
/** 自由鏡頭跟不跟著兩艘的中點走（預設跟；鏡頭「看敵艦／看我艦」本來就跟著那一艘）。 */
function setCamTrack(on) {
  camSet({ track: on, trYaw: null, trMe: null });                    // 🎥 那一顆的燈由 camSet 照 track 改
  if (RUNNING && SHIPS.length) note(SHIPS[PLAYER_I], on ? '鏡頭跟著船' : '鏡頭固定（' + keyName('camTrack') + ' 切換）');
}
/** 自動開砲（我艦）：觀戰預設開、其他模式預設關（reset 時照模式設）。 */
function setAutoFire(on) {
  AUTOFIRE = on; $('autoF').classList.toggle('on', on); if (SHIPS[PLAYER_I]) SHIPS[PLAYER_I].hand = false;   // 切換 ⇒ 手動瞄準那一舷也收掉
  if (RUNNING && SHIPS.length) note(SHIPS[PLAYER_I], on ? '自動開砲' : '自己開砲（點敵艦瞄準、' + keyWord('volley') + '齊射）');
}
function sailToggle() { if (RUNNING && SHIPS[PLAYER_I] && SHIPS[PLAYER_I].anc) anchorWeighAll(SHIPS[PLAYER_I]); setSailMode(SAIL === 'auto' ? 'manual' : 'auto'); }   // ☸ 一顆切換（Tim 2026-10-15）：自動 ⇄ 手動；拋錨中 ⇒ 起錨、換自動
$('sailT').onclick = sailToggle;   // 鍵盤（66_keys.js sailMode）同一顆。自動開砲、拋錨是下方的大圓鈕（data-act）
/** 🤖☸ 自動操舵那一顆（Tim 2026-10-15：「開啟時常亮（參考自動開砲），不換 Icon」）：圖示固定，自動 ⇒ 亮（on）；手動、拋錨模式 ⇒ 暗。 */
function sailLabel() { var b = $('sailT'); if (b) b.classList.toggle('on', SAIL === 'auto'); }
$('camT').onclick = function () { setCamTrack(!CAM.track); };
$('physT').onclick = function () { setPhys(!PHYS); };
$('restartB').onclick = function () { if (RUNNING) { gsetClose(); helpClose(); start(); } };
$('boomB').onclick = function () { if (selfDestruct()) { gsetClose(); helpClose(); flowPause(false); } };   // 自爆：關掉設定、解除停格，看煙花（23_powder.js）
// 遊戲內的設定面板（⚙ 設定、Esc）：打開 ⇒ 暫停（關掉回到打開之前的暫停狀態）；畫質、物理效果的檔位跟主選單是同一份（07_gfx.js／09_phx.js）
var GSET = { open: false, paused: false };
function gsetOpen() { if (!RUNNING || GSET.open) return; helpClose(); GSET.open = true; GSET.paused = PAUSED; flowPause(true); $('gset').classList.add('on'); $('gsetBg').classList.add('on'); gsetShow(); }
function gsetClose() { if (!GSET.open) return; GSET.open = false; flowPause(GSET.paused); $('gset').classList.remove('on'); $('gsetBg').classList.remove('on'); }
function gsetToggle() { if (GSET.open) gsetClose(); else gsetOpen(); }
// 畫質設定（核心自己的一層 #gfxov，在 #cover 外面；TASK-0774 第 2 步）：主選單的「畫質設定…」（外殼的 page('gfx')）跟遊戲中設定面板的「畫質設定…」（gfxOvOpen）開的是同一層。
//   遊戲中（Tim 2026-10-21「目前世界地圖模式無法開啟畫質設定頁 請協助加個入口」「應該說入口放這裡」＝ 設定面板（Esc）畫質那一列的「畫質設定…」）：
//     靠右半透明疊在遊戲上（template.html body.gfxov）⇒ 左邊看得到場景，改了下一格就照新的畫；打開時遊戲暫停（跟設定面板一樣），
//     「返回」、右上角的返回、Esc ⇒ 收起來、回到設定面板，畫質那幾項寫回存檔（69_prefs.js prefsSaveOnly：地球儀開船那種網址帶參數的也存）。
//   主選單：整面蓋住主選單；返回 ⇒ 發 gfxov:back（外殼回主選單）。
var GFXOV = { open: false, paused: false };
/** 那一層開／關（只管顯示；主選單那一頁由外殼的 page 叫）。 */
function gfxPanel(on) { var e = $('gfxov'); e.style.display = on ? '' : 'none'; if (on) e.scrollTop = 0; }
function gfxPanelOn() { return $('gfxov').style.display !== 'none'; }
function gfxOvOpen() {
  if (!RUNNING || GFXOV.open) return;
  GFXOV.paused = GSET.open ? GSET.paused : PAUSED; gsetClose(); helpClose(); flowPause(true);
  GFXOV.open = true; document.body.classList.add('gfxov'); gfxPanel(true); gfxShow();
}
function gfxOvClose() {
  if (!GFXOV.open) return;
  GFXOV.open = false; gfxPanel(false); document.body.classList.remove('gfxov');
  prefsSaveOnly(PREF_GFX); flowPause(GFXOV.paused); gsetOpen();
}
/** 返回：遊戲中打開的 ⇒ 回到遊戲的設定面板；主選單打開的 ⇒ 收起來、外殼回主選單。 */
function gfxBack() { if (GFXOV.open) gfxOvClose(); else { gfxPanel(false); evEmit('gfxov:back'); } }
/** 畫質頁（07_gfx.js；#gfxov 那一層）：預設的低／中／高、每一項的按鈕、陰影細項、顯示 FPS。改了立刻生效（render 每一格讀 GFX）。開機時核心自己生一次（主選單那一排是外殼的 gfxMenuUI）。 */
function gfxUI() {
  var box = $('gfxItems');
  function row(it) { return '<div class="row"><label>' + it.name + '</label>' + (it.ord || it.opt.map(function (o, v) { return v; })).map(function (v) { return '<button data-k="' + it.k + '" data-v="' + v + '">' + it.opt[v] + '</button>'; }).join('') + '</div>'; }   // ord：按鈕照這個順序排（值不照順序的那幾項，07_gfx.js）
  // 照分類收起來（07_gfx.js GFX_CATS；Tim 2026-10-21）：<details> 一類一塊，預設收著；陰影那一塊底下是陰影細項（#shkItems 搬進來）、煙與碎片那一塊是兩個滑桿
  var fx = '<div class="row slide"><label for="smokeR">煙消散</label><input type="range" id="smokeR" min="' + SMOKE_LIM[0] + '" max="' + SMOKE_LIM[1] + '" step="0.1" aria-label="煙散得多快（倍數；1 ＝ 原本）"><span id="smokeV"></span></div>'
    + '<div class="row slide"><label for="debR">碎片上限</label><input type="range" id="debR" min="' + DEB_LIM[0] + '" max="' + DEB_LIM[1] + '" step="1000" aria-label="畫面上最多幾顆碎片"><span id="debV"></span></div>';   // 煙：不跟三檔走（07_gfx.js SMOKE_LIM）
  box.innerHTML = GFX_CATS.map(function (c) {
    return '<details class="gcat" data-cat="' + c.k + '"><summary><b>' + c.name + '</b><span class="note" id="gcs-' + c.k + '"></span></summary><div class="gcb" id="gcb-' + c.k + '">' +
      c.items.map(function (k) { return row(gfxItem(k)); }).join('') + (c.extra === 'fx' ? fx : '') + '</div></details>';
  }).join('');
  $('gcb-shadow').appendChild($('shkItems'));                      // 陰影細項（shkUI 底下生）收進陰影那一塊
  [].forEach.call(box.querySelectorAll('button[data-k]'), function (b) { b.onclick = function () { GFX[b.dataset.k] = +b.dataset.v; gfxShow(); }; });
  var sr = $('smokeR'); sr.oninput = function () { SMOKE_K = Math.round(+sr.value * 10) / 10; gfxShow(); };
  var dr2 = $('debR'); dr2.oninput = function () { DEB_CAP = Math.round(+dr2.value); gfxShow(); };
  [].forEach.call(document.querySelectorAll('#gfxPre button'), function (b) { b.onclick = function () { gfxSet(b.dataset.g); gfxShow(); }; });
  var f = $('gfxFps'); f.checked = GFX_FPS; f.onchange = function () { GFX_FPS = f.checked; gfxShow(); };
  $('gfxX').onclick = $('gfxovX').onclick = gfxBack;               // 返回（卡片最下面、右上角）
  shkUI();                                                       // 陰影細項（07_gfx.js SHK_ITEMS）
  gfxShow();
}
function gfxShow() {
  var lv = gfxLevel();
  [].forEach.call(document.querySelectorAll('#gfxPre button'), function (b) { b.className = b.dataset.g === lv ? 'on' : ''; });
  [].forEach.call(document.querySelectorAll('#gfxItems button[data-k]'), function (b) { b.className = GFX[b.dataset.k] === +b.dataset.v ? 'on' : ''; });
  $('debR').value = DEB_CAP; $('debV').textContent = DEB_CAP.toLocaleString() + ' 顆' + (DEB_CAP === DEB_LIM[2] ? '（預設）' : '') + '：超過時先清視野外、遠處、沉在水裡的';
  $('smokeR').value = SMOKE_K; $('smokeV').textContent = SMOKE_K.toFixed(1) + '×' + (SMOKE_K === 1 ? '（原本）' : SMOKE_K === SMOKE_LIM[2] ? '（預設）' : SMOKE_K > 1 ? '（散得快）' : '（留得久）') + '　砲煙約 ' + (2.5 / SMOKE_K).toFixed(1) + '–' + (5.5 / SMOKE_K).toFixed(1) + ' 秒';
  GFX_CATS.forEach(function (c) { var e = $('gcs-' + c.k); if (e) e.textContent = gfxCatSum(c); });   // 每一類收著時看得到的那一行
  $('gfxLv').textContent = '現在：' + GFX_NAME[lv]; $('gfxFps').checked = GFX_FPS; $('fps').className = GFX_FPS ? 'hud on' : 'hud';
  shkShow();
  evEmit('cfg:gfx', lv);                                           // 外殼：主選單那一排、「畫質設定…」鈕（gfxMenuShow）
  if (typeof gsetShow === 'function') gsetShow();
}
/** 畫質頁的「陰影細項」（07_gfx.js SHK_ITEMS；Tim 2026-10-21「概念類似這個」＝ Unity 的 Shadows：最遠距離、段數、分界、交界、顯示分段、分段那一條）：
 *  按鈕（val）一列、滑桿（lim）照 64_cfgkit.js 的樣子；改了立刻生效（60_render.js 每一格照 SHK 配）、跟著存檔（69_prefs.js shk）。
 *  只對分段有用的（cas）單張時變淡、只對單張有用的（one）分段時變淡；段數以外的分界、交界藏起來。 */
function shkUI() {
  var box = $('shkItems');
  box.innerHTML = '<h3>陰影細項</h3><div class="row note">不跟低／中／高走（改了不會變成「自訂」）；改了立刻生效、跟著存檔。調到滿意的，把下面「改過的」那一行告訴開發者就能變成預設。</div>' +
    SHK_ITEMS.map(function (it) {
      var h = it.val ? '<div class="row bt"><label>' + it.name + '</label>' + it.val.map(function (v, i) { return '<button data-shk="' + it.k + '" data-v="' + v + '">' + (it.opt ? it.opt[i] : v + (it.unit || '')) + '</button>'; }).join('') + '</div>' + (it.note ? '<div class="row note gkn">' + it.note + '</div>' : '')
        : cfgSliders([it], 'shk-').replace('<div class="row note gkn"></div>', '').replace('<div class="row note gkn">undefined</div>', '');
      return '<div id="shkR-' + it.k + '">' + h + '</div>' + (it.k === 'b4' ? '<div id="shkBar"></div><div class="row note" id="shkBarN"></div>' : '');
    }).join('') + '<div class="row note" id="shkSt"></div><div class="row"><button id="shkReset">陰影細項回到預設</button></div>';
  [].forEach.call(box.querySelectorAll('button[data-shk]'), function (b) { b.onclick = function () { SHK[b.dataset.shk] = +b.dataset.v; gfxShow(); }; });
  SHK_ITEMS.forEach(function (it) { if (it.val) return; var r = $('shk-' + it.k); r.oninput = function () { var v = shkOk(it, +r.value); if (v !== undefined) SHK[it.k] = v; gfxShow(); }; });
  $('shkReset').onclick = function () { shkReset(); gfxShow(); };
  setInterval(function () { if (gfxPanelOn()) shkStat(); }, 500);   // 讀數（每一格幾毫秒）：頁面開著才更新
}
function shkFmt(it, v) { return it.val ? (it.opt ? it.opt[it.val.indexOf(v)] : v + (it.unit || '')).replace(/（.*$/, '') : (it.int ? String(v) : v.toFixed(it.fix || 2)) + (it.unit || ''); }
function shkShow() {
  if (!$('shkBar')) return;
  var one = SHK.mode === 0;
  [].forEach.call(document.querySelectorAll('#shkItems button[data-shk]'), function (b) { b.className = SHK[b.dataset.shk] === +b.dataset.v ? 'on' : ''; });
  SHK_ITEMS.forEach(function (it) {
    var row = $('shkR-' + it.k);
    row.style.display = it.seg && (it.k[0] === 's' ? it.seg >= SHK.count : it.seg > SHK.count) ? 'none' : '';   // 分界 ＝ 段數 − 1 個、交界 ＝ 段數個（跟 Unity 一樣）
    row.classList.toggle('dim', !!((it.cas && one) || (it.one && !one)));
    if (it.val) return;
    $('shk-' + it.k).value = SHK[it.k]; $('shk-' + it.k + 'V').textContent = cfgShown(function (v) { return shkFmt(it, v); }, SHK[it.k], SHK_DEF[it.k]);
  });
  // 分段那一條（Unity 的 Cascade splits）：每一段一格、寬度照那一段多長；斜線 ＝ 交界（跟下一段混的那一截；最後一段 ＝ 淡掉的那一截）
  var o = shkSplits(), bar = $('shkBar'), prev = 0, col = SHDBG_COL;
  bar.innerHTML = o.far.map(function (f, i) {
    var c = col[i % 4], w = (f - prev) / SHK.dist * 100, b = (f - o.bs[i]) / Math.max(1e-6, f - prev) * 100, h;
    h = '<div style="flex:0 0 ' + w.toFixed(3) + '%;background:rgb(' + c.map(function (v) { return Math.round(v * 200 + 30); }).join(',') + ')" title="第 ' + (i + 1) + ' 段：' + Math.round(prev) + '～' + Math.round(f) + ' m，最後 ' + Math.round(f - o.bs[i]) + ' m 跟' + (i < o.far.length - 1 ? '下一段混' : '沒有影子混（淡掉）') + '"><div class="bl" style="width:' + b.toFixed(2) + '%"></div><span>' + (i + 1) + '</span><span>' + Math.round(f - prev) + ' m</span></div>';
    prev = f; return h;
  }).join('');
  bar.classList.toggle('dim', one);
  $('shkBarN').textContent = '分段：' + o.far.map(function (f, i) { return '第 ' + (i + 1) + ' 段到 ' + Math.round(f) + ' m'; }).join('、') + (one ? '（現在是單張，這一條沒用到）' : '') +
    '；單張的半寬：' + SIMPLE_R.map(function (r) { return Math.round(r * SHK.sR); }).join('／') + ' m（鏡頭拉越遠用越大的那一級）' + (one ? '' : '（現在是分段，沒用到）');
  shkStat();
}
/** 讀數：現在畫的是什麼、每一格幾毫秒（60_render.js shadowDbgText）、改過的（照存檔那一份；告訴開發者就能當預設）。 */
function shkStat() {
  var el = $('shkSt'); if (!el) return;
  var ch = shkSnap(), ks = Object.keys(ch);
  el.style.whiteSpace = 'pre-line';
  el.textContent = (GFX.shadow ? '現在（' + GFX_ITEMS[0].opt[GFX.shadow].replace(/（.*$/, '') + '）：' + (typeof SHM !== 'undefined' && SHM ? shadowDbgText() : '陰影還沒畫') + (SHM && SHM.n < SHK['n' + Math.min(2, GFX.shadow)] ? '（' + SHK['n' + Math.min(2, GFX.shadow)] + '² 超過總量上限 ⇒ 降成 ' + SHM.n + '²）' : '') : '陰影關著（上面「陰影」選低或高）') +
    '\n改過的：' + (ks.length ? ks.map(function (k) { return k + '=' + ch[k]; }).join('　') : '（都是預設）');
}
/** 物理效果的檔位改了（主選單的物理頁、遊戲中的設定面板、__game.phx）：帆與繩換到「關」或從「關」換出來 ⇒ setPhys（跟 B 鍵同一支）；發 cfg:phx（外殼的物理頁點亮）。 */
function phxSync() { if ((PHX.rig > 0) !== PHYS) setPhys(PHX.rig > 0); evEmit('cfg:phx'); if (typeof gsetShow === 'function') gsetShow(); }
// 不給全螢幕時那一行（Tim 2026-10-17：iPhone 照臺北狂飆那樣「加入主畫面」就是全螢幕 ——「iphone支援的操作 不用另外做功能」「純文字也可以」）：
//   iPhone ⇒ 寫怎麼加入主畫面（iOS 自己會用網頁 App 開：沒有網址列與工具列）；別的（沒開全螢幕權限的 iframe…）照舊只說不給。
//   已經從主畫面開（iOS 的 navigator.standalone、manifest 的 display-mode）⇒ 本來就沒有網址列：按鈕亮著、不寫原因。
var FS_APP = navigator.standalone === true || !!(window.matchMedia && window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches);
/** 畫面（#stage）在視窗裡的框：裝置的安全區已經扣掉（template.html :root 的 --sa-*）。HUD 要量「畫面多大」量這個，⛔ 不用 innerWidth／innerHeight（那是整個視窗，含瀏海與 home 條）。 */
function stageBox() { return $('stage').getBoundingClientRect(); }
var FS_WHY = FS_APP ? '' : /iPhone|iPod/.test(navigator.userAgent) ? '（iPhone 的 Safari 不給網頁全螢幕 ⇒ 點「分享」→「加入主畫面」，從主畫面的圖示開就沒有網址列；橫放手機）' : '（這裡不給全螢幕）';
function gsetShow() {
  var gl = gfxLevel(), xl = phxLevel();
  [].forEach.call(document.querySelectorAll('#gset [data-gg]'), function (b) { b.classList.toggle('on', b.dataset.gg === gl); });
  [].forEach.call(document.querySelectorAll('#gset [data-gx]'), function (b) { b.classList.toggle('on', b.dataset.gx === xl); });
  $('gsGfx').textContent = gl === 'custom' ? '（自訂）' : ''; $('gsPhx').textContent = xl === 'custom' ? '（自訂）' : '';
  $('muteT').classList.toggle('on', muted); $('fpsT').classList.toggle('on', GFX_FPS);
  $('slowT').classList.toggle('on', SLOW.on); $('slowCamT').classList.toggle('on', SLOW.cam); $('pslowT').classList.toggle('on', PSLOW.on); $('testT').classList.toggle('on', !!(TLOG && TLOG.off === undefined) || (!TLOG && tlgWanted())); $('testN').textContent = tlgNote(); $('rigT').classList.toggle('on', !!(RLOG && RLOG.off === undefined) || (!RLOG && rlgWanted())); $('rigN').textContent = rlgNote();   // 測試模式（83_testlog.js） $('boomB').classList.toggle('dis', !canSelfDestruct());
  sndShow();                                                          // 音量滑桿（02_music.js）
  $('fullT').classList.toggle('on', fsOn() || FS_APP); $('fullT').classList.toggle('dis', !fsCan() && !FS_APP); $('gsFull').textContent = fsCan() ? '' : FS_WHY;
}
$('setB').onclick = gsetToggle;
// 說明（設定裡的「H 說明」、H、?）：打開 ⇒ 暫停（關掉回到打開之前的暫停狀態，跟設定一樣）；外面蓋一層 #helpBg，點外面、✕、H、Esc 都關（Tim 2026-10-13：手機上不好關說明）
var HELP = { open: false, paused: false };
function helpOpen() { if (!RUNNING || HELP.open) return; gsetClose(); HELP.open = true; HELP.paused = PAUSED; flowPause(true); $('help').classList.add('on'); $('helpBg').classList.add('on'); }
function helpClose() { if (!HELP.open) return; HELP.open = false; flowPause(HELP.paused); $('help').classList.remove('on'); $('helpBg').classList.remove('on'); }
function helpToggle() { if (HELP.open) helpClose(); else helpOpen(); }
$('helpBg').onclick = helpClose; $('helpX').onclick = helpClose; $('helpB').onclick = helpOpen;
$('gsetBg').onclick = gsetClose;                                    // 面板外點一下 ⇒ 關（不會順便瞄準、開砲：底下的東西被這一層蓋住）
$('gsGo').onclick = gsetClose;
$('gsGfxB').onclick = gfxOvOpen;                                     // 畫質設定…（遊戲中；見 gfxOvOpen）
$('menuB').onclick = function () { doAct('menu'); };
$('muteT').onclick = function () { muted = !muted; sndApply(); gsetShow(); };
$('fpsT').onclick = function () { GFX_FPS = !GFX_FPS; gfxShow(); };
// 全螢幕（設定面板的「F11 全螢幕」；Tim 2026-10-13：主要給手機用）：整頁（documentElement）進出全螢幕；畫布大小每一格照量（60_render.js resize）⇒ 不用另外處理。
//   畫廊彈窗的 iframe（sandbox＋allow="fullscreen"，ArtGallery/index.html）進得去（量過：fullscreenEnabled、點了 fs ＝ true、按鈕亮）。
//   不給全螢幕的地方（iPhone 的 Safari 只給影片、沒開 fullscreen 權限的 iframe）⇒ 按鈕變灰、寫原因。Esc 是瀏覽器自己退出全螢幕的鍵（頁面收不到那一下）。
//   「F11」只是提示電腦上按 F11 也能全螢幕（Tim：只是提示）—— 那是瀏覽器自己的全螢幕，頁面不攔（⛔ 攔了要猜瀏覽器的全螢幕開了沒：拿視窗跟螢幕比大小，縮放與無頭 Chrome 都會猜錯）。
//   不存檔：進全螢幕一定要使用者點一下才行，開局自動進不去。
function fsOn() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
function fsCan() { return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled); }
function fsToggle() {
  if (!fsCan()) return;
  var d = document, e = d.documentElement;
  try {
    var r = fsOn() ? (d.exitFullscreen || d.webkitExitFullscreen).call(d) : (e.requestFullscreen || e.webkitRequestFullscreen).call(e, { navigationUI: 'hide' });
    if (r && r.catch) r.catch(function () { gsetShow(); });                          // 被拒（沒有點擊、權限）⇒ 按鈕照實際狀態
  } catch (err) { gsetShow(); }
}
$('fullT').onclick = fsToggle;
['fullscreenchange', 'webkitfullscreenchange'].forEach(function (ev) { document.addEventListener(ev, gsetShow); });   // 進出（含 Esc 退出）⇒ 按鈕跟著亮滅
[].forEach.call(document.querySelectorAll('#gset [data-gg]'), function (b) { b.onclick = function () { gfxSet(b.dataset.gg); gfxShow(); }; });
[].forEach.call(document.querySelectorAll('#gset [data-gx]'), function (b) { b.onclick = function () { phxSet(b.dataset.gx); phxSync(); }; });
$('endA').onclick = start;
gfxUI();                                                          // 畫質那一層（核心）：開機生一次
sndUI();                                                          // 音量滑桿（02_music.js；遊戲內設定面板＋聲音設定頁）：開機綁一次
// 彈種一顆（#ammoB）：帶 data-k="1" ⇒ 點一下 ＝ 按 1（上面那段 [data-k] 的 click）⇒ ammoNext；⛔ 別再另外掛 onclick（會一次換兩種）
/** 旗號面板（TASK-0679；下令走 52_fleet.js sigSet）：🚩（我方艦隊那一欄最上面、鍵 K）開關；只有我方有電腦開的友艦、不是觀戰時才開得了。按鈕照 SIG_LIST，現在的那個亮。 */
function sigCan() { var me = SHIPS[PLAYER_I]; return !!(RUNNING && MODE !== 'eve' && me && SHIPS.some(function (o) { return o !== me && o.team === me.team && !isOut(o); })); }
function sigToggle(on) { var p = $('sigP'); if (!p) return; on = on === undefined ? !p.classList.contains('on') : on; p.classList.toggle('on', !!on && sigCan()); if (p.classList.contains('on')) sigShow(); }
function sigShow() {
  var B = $('sigBtns'); if (!B) return;
  if (!B.children.length) SIG_LIST.forEach(function (it) { var b = document.createElement('button'); b.dataset.sig = it.id; b.title = it.tip; b.textContent = it.ico + ' ' + it.name; b.onclick = function (e) { e.stopPropagation(); sigSet(it.id); }; B.appendChild(b); });
  var cur = SIGNAL ? SIGNAL.strat : 'cmd';
  [].forEach.call(B.children, function (b) { b.className = b.dataset.sig === 'gauge' ? (SIGNAL && SIGNAL.gauge ? 'on' : '') : b.dataset.sig === cur ? 'on' : ''; });
  $('sigNow').textContent = '現在：' + sigText();
}
if ($('sigX')) $('sigX').onclick = function (e) { e.stopPropagation(); sigToggle(false); };
$('endC').onclick = function () { $('end').className = ''; };
$('endR').onclick = menuGo;
// 訂閱（TASK-0669：模擬層只發事件，00_events.js）
evOn('playerTake', function () { KEYS.l = KEYS.r = false; });   // 玩家換船：按住的舵鍵放開（52_fleet.js playerTake）
