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
// Discord（主選單；Tim 2026-10-17）：新分頁開（從主畫面開的 ⇒ iOS 交給 Safari）。畫廊彈窗的 iframe 沒開 allow-popups ⇒ 開不了，照樣不擋遊戲。
var DISCORD_URL = 'https://discord.gg/XuHkBFN9r';
$('discordB').onclick = function () { window.open(DISCORD_URL, '_blank', 'noopener'); };
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
// 彈種一顆（#ammoB）：帶 data-k="1" ⇒ 點一下 ＝ 按 1（上面那段 [data-k] 的 click）⇒ ammoNext；⛔ 別再另外掛 onclick（會一次換兩種）
/** 主選單的玩法鈕：照玩法規則表（04_modes.js MODE_RULES）裡 menu 的那幾份生、照表的順序（TASK-0668：加一種玩法不用改這裡）。 */
function modeButtons() {
  $('modes').innerHTML = Object.keys(MODE_RULES).filter(function (m) { return MODE_RULES[m].menu; }).map(function (m) { return '<button data-m="' + m + '">' + MODE_RULES[m].name + '</button>'; }).join('');
  [].forEach.call(document.querySelectorAll('#modes button'), function (b) { b.onclick = function () { flowMode(b.dataset.m); [].forEach.call(document.querySelectorAll('#modes button'), function (x) { x.className = x === b ? 'on' : ''; }); }; });
}
modeButtons();
/** 選單：滑桿的上下限從 LIM 來；數值只在使用者動了那一條時才從滑桿讀回（⛔ 一開頭就讀回 ⇒ 網址給的 0.33 被 step 吃成 0.35）。
 *  船殼、砲、帆、火藥桶、航行、降旗的滑桿在「細節設定」那一頁（從主選單進）；主選單只留一行摘要（#detV）。 */
/** 模型（砲、火藥桶）的總重（噸）：照匯出的模型清單＋取用點的 12 桶（細節設定的例子用；開戰時每艘照自己的模型算）。 */
var CFG_ID = myHull();                             // 細節設定的「船隻設定」正在編輯哪一型
var SLIDERS_SHOW = null;                               // 載入完（HYD 算好）再顯示一次 ⇒ 減重上浮的例子有數字
function sliders() {
  var lf = $('ballast'), f = $('flood'), h = $('hard'), c = $('cas'), sp = $('speed'), ag = $('agile'), uw = $('upwind'), gh = $('gunhp'), gw = $('gunw'), sl = $('sailhp'), ph = $('powderhp'), bl = $('blast'), bv = $('blastv'), ch = $('crewhp'), cd = $('crewdeath');
  var bx = $('box'), cy = $('carry'), wk = $('wind'), wc = $('windcap'), dr = $('drown');
  var st = $('stall'), fs = $('funspeed'), fa = $('funagile'), fl = $('funstall'), fp = $('funpowder'), fh = $('funhard'), se = $('sea'), whl = $('wheelloss'), rdl = $('rudderloss'), dtq = $('difftq'), fhl = $('funhelmloss'), fhe = $('funhelmeff'), fdf = $('fundiff');   // 頂風失速、娛樂加成、浪
  [[se, 'sea'], [st, 'stall'], [fs, 'funspeed'], [fa, 'funagile'], [fl, 'funstall'], [fp, 'funpowder'], [fh, 'funhard'], [whl, 'wheelloss'], [rdl, 'rudderloss'], [dtq, 'difftq'], [fhl, 'funhelmloss'], [fhe, 'funhelmeff'], [fdf, 'fundiff']].forEach(function (e) { e[0].min = LIM[e[1]][0]; e[0].max = LIM[e[1]][1]; });
  dr.min = LIM.drown[0]; dr.max = LIM.drown[1];
  bx.min = LIM.box[0]; bx.max = LIM.box[1]; cy.min = LIM.carry[0]; cy.max = LIM.carry[1]; wk.min = LIM.wind[0]; wk.max = LIM.wind[1]; wc.min = LIM.windcap[0]; wc.max = LIM.windcap[1]; ['inertia', 'turninert', 'sailtq'].forEach(function (k) { $(k).min = LIM[k][0]; $(k).max = LIM[k][1]; });   // 動力的手感（31_drive.js）
  // 硬度跨 40 倍 ⇒ 對數刻度：滑桿 0..1 ↔ 硬度 LIM 下限 × (上限／下限)^v
  var hk = Math.log(LIM.hard[1] / LIM.hard[0]);
  lf.min = LIM.ballast[0]; lf.max = LIM.ballast[1]; gw.min = LIM.gunw[0]; gw.max = LIM.gunw[1];
  f.min = LIM.flood[0]; f.max = LIM.flood[1]; h.min = 0; h.max = 1; h.step = 0.005; c.min = LIM.cas[0] * 100; c.max = LIM.cas[1] * 100;
  sp.min = LIM.speed[0]; sp.max = LIM.speed[1]; ag.min = LIM.agile[0]; ag.max = LIM.agile[1]; uw.min = LIM.upwind[0]; uw.max = LIM.upwind[1]; var bs = $('base'); bs.min = LIM.base[0]; bs.max = LIM.base[1]; $('pump').min = LIM.pump[0]; $('pump').max = LIM.pump[1];
  gh.min = LIM.gunhp[0]; gh.max = LIM.gunhp[1]; sl.min = LIM.sailhp[0]; sl.max = LIM.sailhp[1]; ph.min = LIM.powderhp[0]; ph.max = LIM.powderhp[1];
  bl.min = LIM.blast[0]; bl.max = LIM.blast[1]; bv.min = LIM.blastv[0] * 100; bv.max = LIM.blastv[1] * 100; ch.min = LIM.crewhp[0]; ch.max = LIM.crewhp[1]; cd.min = LIM.crewdeath[0]; cd.max = LIM.crewdeath[1];
  function am(r, k) { return $('am-' + r + '-' + k); }
  function C() { return shipCfg(CFG_ID); }             // 正在編輯的那一型（船隻配置頁）
  // 船員（船隻配置頁；TASK-0570）：每一項一條滑桿；砲班照砲種各一條（這一型沒有的砲種藏起來）。改了寫進 SHIP_CREW（05_hull.js），存檔跟著存（69_prefs.js）
  var CR = {}, crBox = $('crewItems');
  CREW_ITEMS.concat([{ k: 'oar' }, { k: 'gh' }], Object.keys(GUNS).map(function (t) { return { k: 'g-' + t, gun: t, name: GUNS[t].name, lim: [GUNS[t].min, GUN_CREW_MAX] }; })).forEach(function (it) {
    var row = document.createElement('div');
    if (it.k === 'gh') { row.className = 'row note'; row.textContent = '砲班（每門砲幾個人）'; crBox.appendChild(row); return; }
    if (it.k === 'oar') { row.className = 'row slide'; row.id = 'cr-oarR'; row.innerHTML = '<label>槳手</label><span></span><span id="cr-oarV"></span>'; crBox.appendChild(row); return; }   // 只顯示：人數照船上每支槳的 meta rowers（TASK-0691），這一頁不調
    row.className = 'row slide';
    row.innerHTML = '<label for="cr-' + it.k + '">' + it.name + '</label><input type="range" id="cr-' + it.k + '" step="1" min="' + it.lim[0] + '" max="' + it.lim[1] + '"><span id="cr-' + it.k + 'V"></span>';
    crBox.appendChild(row);
    var el = row.querySelector('input');
    el.oninput = function () { var p = SHIP_CREW[CFG_ID] = SHIP_CREW[CFG_ID] || {}, v = Math.round(+el.value); if (it.gun) (p.guns = p.guns || {})[it.gun] = v; else p[it.k] = v; show(); };
    CR[it.k] = { it: it, el: el, row: row };
  });
  /** 這一型的砲（照砲種）、幾根桅、有沒有舵輪：船型載好才知道（沒載 ⇒ null）。 */
  function hullCounts(id) {
    var T = HULLT[id]; if (!T) return null;
    var g = {}, n = 0, wheel = false, oars = 0, rowers = 0, rk = [], gal = 0;
    (T.rig.models || []).forEach(function (m) {
      var k = modelKind(m); if (GUNS[k]) { g[k] = (g[k] || 0) + 1; n++; } if (k === 'wheel') wheel = true; if (k === 'galley') gal++;   // 廚房的爐灶（模型 meta kind=galley；45_galley.js）
      if ((m.meta || {}).kind === 'oar' && (m.points || {}).pivot) { var r = oarRowers(m); oars++; rowers += r; if (rk.indexOf(r) < 0) rk.push(r); }   // 槳：跟開戰時 oarCrew 同一條（有槳座才算）
    });
    return { guns: g, n: n, masts: T.masts.length, wheel: wheel, oars: oars, rowers: rowers, rk: rk.sort(function (a, b) { return a - b; }), galley: gal };
  }
  /** 全船人數（跟船員那一節的合計同一條算法）。 */
  function crewTotal(cw, hc) { var g = 0; Object.keys(GUNS).forEach(function (t) { g += gunCrew(cw, t) * (hc.guns[t] || 0); }); return g + Math.ceil(hc.n / 2) * cw.monkeys + cw.officers + (hc.wheel ? cw.helm : 0) + cw.marines + cw.top * hc.masts + cw.hands + hc.rowers; }
  /** 船隻配置頁最上面（Tim 2026-10-14）：大圓鈕（61_hud.js badgeDraw）＋排水量、航速（順風／側順風／逆風，照這一型的航速與逆風性能、玩法的加成；標準風、滿帆）、砲、船員、靈活與硬度。 */
  function shipCardShow() {
    var T = HULLT[CFG_ID], h = hullInfo(CFG_ID), el = $('shipCardT'); badgeDraw($('shipCardC'), T);   // 不寫艦名：右邊那一欄第一行就是（Tim 2026-10-17）
    if (!T) { el.innerHTML = '<div class="h">' + (h ? h.name : CFG_ID) + '</div><div class="n">船型載入中…</div>'; return; }
    var c = shipCfg(CFG_ID), hc = hullCounts(CFG_ID), kn = VMAX * c.speed * playK('speed') * 1.9438, UP = c.upwind || 1, dz = 180 - NOGO_DEG, stall = 180 - (UP === 1 ? dz : 90 + (dz - 90) * UP);
    var gl = Object.keys(GUNS).filter(function (t) { return hc.guns[t]; }).map(function (t) { return (GUNS[t].short || GUNS[t].name).trim() + ' ' + hc.guns[t]; }).join('、');
    // 開戰時的排水量（Tim 2026-10-17「額外顯示實際遊戲開場的排水量(加上炮重&其他配件重)」）：浮著的船排開的水 ＝ 自己的重量（32_hull.js hullT0，跟開戰時的 sh.mass0 同一套）；
    //   跟設計水線差多少 ⇒ 開戰時浮高／吃水深幾公尺（liftFor）
    var W = hullT0(T, c), L = liftFor(T, T.disp - W.all) || 0, t0 = function (v) { return Math.round(v).toLocaleString(); };
    // 沒有帆（莫尼特號；Tim 2026-10-17「實戰中實際上是固定6節(沒有帆)」）：遊戲裡帆的推力 × sailFrac ＝ 0 ⇒ 只寫額外動力（以前照帆的公式算出順風 12.2 節）
    var sails = T.rig.sails.some(function (s) { return !isFlag(s); }), B = (+c.base || 0) * playK('speed');   // 額外動力也吃娛樂加成（31_sailing.js vB）
    el.innerHTML = '<div class="h">' + h.name + '</div>' +
      (h.author ? '建造者 <b>' + h.author + '</b><br>' : '') +   // Tim 2026-10-15：船的作者（ships[].author ← 匯入時 .vxk 檔頭的 owner）
      '排水量 <b>' + t0(W.all) + '</b> 噸<span class="n">（開戰時）</span>・設計水線 <b>' + t0(T.disp) + '</b> 噸<br>' +
      '<span class="n">開戰時 ＝ 格子 ' + t0(W.vox) + '＋砲 ' + t0(W.gun) + '＋火藥桶 ' + t0(W.keg) + '＋壓艙物 ' + t0(W.ballast) + ' 噸' +
        (Math.abs(L) >= 0.005 ? ' ⇒ 比設計水線' + (L > 0 ? '浮高 ' : '吃水深 ') + Math.abs(L).toFixed(2) + ' m' : ' ⇒ 剛好在設計水線') + '</span><br>' +
      (sails ? '航速 順風 <b>' + Math.hypot(kn * polar(0), B).toFixed(1) + '</b>・側順風 <b>' + Math.hypot(kn, B).toFixed(1) + '</b>（最快）・逆風 <b>' + Math.hypot(kn * polar(dz), B).toFixed(1) + '</b> 節<br>' +
        (B ? '額外動力 <b>' + B.toFixed(1) + '</b> 節<span class="n">（推力跟帆相加 ⇒ 上面三格 ＝ √(帆² ＋ 額外動力²)：不看風向與帆，頂風、收帆也走得動；帆段滿帆再加 ＝ 全速前進（開）、全收再收 ＝ 倒車）</span><br>' : '') +
        '<span class="n">標準風、滿帆；逆風 ＝ 離風 ' + Math.round(stall) + '° 時（再頂就開始失速）' + (PLAY === 'fun' ? '；含娛樂玩法的加成' : '') + '</span><br>'
      : '航速 <b>' + B.toFixed(1) + '</b> 節<span class="n">（沒有帆：只靠額外動力，不看風向；全速前進時' + (PLAY === 'fun' ? '；含娛樂玩法的加成' : '') + '）</span><br>') +
      '砲 <b>' + hc.n + '</b> 門<span class="n">（' + gl + '）</span><br>' +
      '船員 約 <b>' + crewTotal(shipCrew(CFG_ID), hc) + '</b> 人<span class="n">（含預備水手 ' + shipCrew(CFG_ID).hands + '）</span><br>' +
      '靈活 <b>×' + (+c.agile).toFixed(2) + '</b>・船殼硬度 <b>×' + (+c.hard).toFixed(2) + '</b>・桅 <b>' + hc.masts + '</b> 根<br>' +
      '材質 ' + matSummary(T).map(function (m) { return '<b>' + m.name + '</b>' + (T.matIds.length > 1 ? ' ' + Math.round(m.voxels / T.base.count * 100) + '%' : '') + (m.hard !== 1 ? '（硬度 ×' + m.hard + '）' : ''); }).join('・') +
      '<span class="n">（格子 ' + Math.round(T.voxT0).toLocaleString() + ' 噸）</span>';   // TASK-0616：全船預設＋關聯 meta material（05_material.js）
  }
  function rankList(n) { var r = OFFICER_RANKS.slice(0, n); if (n > OFFICER_RANKS.length) r.push('見習軍官 ' + (n - OFFICER_RANKS.length)); return r.join('、'); }
  // 艙房（船隻配置頁；TASK-0568）：這一型標好的空艙房一間一列 —— 房間類型（放不下必要件的那個選項不能選、寫出原因）、擺了什麼、buff；
  //   「擺設…」打開那一間的俯視格子編輯器（#roomEd；0.5 m 一格）：挑物品、點格子擺（物品的中心在點的那一格）、轉 90°、拿掉、自動擺滿、清空。
  //   改了寫進 SHIP_ROOMS（36_rooms.js），存檔跟著存（69_prefs.js）。自動擺滿的那一間第一次被改 ⇒ 先把自動擺的那一份抄下來再改。
  //   甲板也是一間（Tim 2026-10-14）：每一層砲甲板一列，只擺火藥桶（取用點）；沒擺過 ＝ 自動（照舊的那幾處）。RE.d ＝ 編輯的是甲板。
  var RE = { i: -1, d: false, it: '', r: 0, del: false, hover: null, msg: '' }, ITEM_COL = { bed: '#d8cba4', table: '#9a7552', medkit: '#c04a40', keg: '#7a5230', pump: '#6f9fc4', spump: '#8a8f99' };
  function roomName(r) { return (r.deck ? r.deck.name + ' ' : '') + r.name.split('/').slice(-2).join(' ').replace('艙房-鏡像', '左').replace('艙房', '右'); }
  var ADM_SENT = {};                                                 // 後台模式：每一型上一次送回後台的預設（一樣就不送）
  function roomSet(name, v) { (SHIP_ROOMS[CFG_ID] = SHIP_ROOMS[CFG_ID] || {})[name] = v; if (ADMIN_ROOMS) ADM_SENT[CFG_ID] = ADM_SENT[CFG_ID] || ''; }
  /** 後台模式：使用者改過的那一型 ⇒ 把預設送回後台（後台照收、標成還沒存）。 */
  function roomsAdminPost() {
    if (!ADMIN_ROOMS || ADM_SENT[CFG_ID] === undefined || !HULLT[CFG_ID]) return;
    var o = roomsDefaultSnap(CFG_ID), s = JSON.stringify(o);
    if (s === ADM_SENT[CFG_ID]) return;
    var w = admWin(); if (!w) return;                             // 不是從設定後台開的 ⇒ 不送（ADM_SENT 不記，連上之前改的照樣算沒送過）
    ADM_SENT[CFG_ID] = s; try { w.postMessage({ kind: 'cb-rooms', id: CFG_ID, rooms: o }, location.origin); } catch (e) { /* 後台關了 */ }
  }
  function itemsText(items) { var n = {}; items.forEach(function (q) { n[q.it] = (n[q.it] || 0) + 1; }); return Object.keys(n).map(function (it) { return FURN[it].name + ' ' + n[it]; }).join('、'); }
  function furnNote(it) { var f = FURN[it], b = f.buff || {}; return f.role === 'powder' ? '一處三桶' : f.role === 'bench' ? '配木匠 ' + furnStaff(it, 'carpenter') + ' 位' : f.role === 'loft' ? '配帆匠 ' + furnStaff(it, 'sailmaker') + ' 位' : f.role === 'pump' ? '抽水 ' + f.tpm + ' 噸／分' + (f.power === 'steam' ? '、靠鍋爐' : '、' + (f.crew || 1) + ' 人搖') + (f.place === 'well' ? '、主桅旁中線' : '、中線') : f.hold ? '躺 ' + f.hold + ' 人' : Object.keys(b).map(function (k) { return (BUFF_NAMES[k] || k) + ' +' + Math.round(b[k] * 100) + '%'; }).join('、'); }
  function roomsPut() {
    var box = $('roomItems'), T = HULLT[CFG_ID], R = T ? hullRooms(T) : [], html = '';
    R.forEach(function (r, i) {
      var opts = '<option value="">空著</option>' + Object.keys(ROOM_FN).filter(function (k) { return !ROOM_FN[k].deck; }).map(function (k) {
        var a = roomAuto(T, r, k);
        return '<option value="' + k + '"' + (a.items ? '' : ' disabled') + '>' + ROOM_FN[k].name + (a.items ? '' : '（' + a.why + '）') + '</option>';
      }).join('');
      html += '<div class="rm"><label for="rm-' + i + '">' + roomName(r) + '</label><select id="rm-' + i + '" data-i="' + i + '">' + opts + '</select><button data-e="' + i + '">擺設…</button><span class="rs" id="rm-' + i + 'V"></span></div>';
    });
    box.innerHTML = html;
    var kit = T ? hullDeckKit(T) : { decks: [] };
    $('deckItems').innerHTML = kit.decks.map(function (D, i) { return '<div class="rm"><label>' + D.name + '</label><button data-d="' + i + '">擺設…</button><span class="rs" id="dk-' + i + 'V"></span></div>'; }).join('');
    [].forEach.call($('deckItems').querySelectorAll('button[data-d]'), function (b) { b.onclick = function () { var i = +b.dataset.d, same = RE.d && RE.i === i; RE.d = true; RE.i = same ? -1 : i; RE.it = ''; RE.del = false; RE.msg = ''; RE.hover = null; show(); if (RE.i >= 0) $('roomEd').scrollIntoView({ block: 'nearest' }); }; });
    [].forEach.call(box.querySelectorAll('select'), function (s) {
      var r = R[+s.dataset.i], pl = roomPlan(CFG_ID, r.name);
      s.value = pl ? pl.type : '';
      if (s.selectedOptions[0] && s.selectedOptions[0].disabled) s.value = '';
      s.onchange = function () { roomSet(r.name, s.value ? { type: s.value } : null); RE.it = ''; RE.msg = ''; show(); };
    });
    [].forEach.call(box.querySelectorAll('button[data-e]'), function (b) { b.onclick = function () { var i = +b.dataset.e, same = !RE.d && RE.i === i; RE.d = false; RE.i = same ? -1 : i; RE.it = ''; RE.del = false; RE.msg = ''; RE.hover = null; show(); if (RE.i >= 0) $('roomEd').scrollIntoView({ block: 'nearest' }); }; });
    if (RE.i >= (RE.d ? kit.decks.length : R.length)) RE.i = -1;
  }
  function roomsShow() {
    var T = HULLT[CFG_ID], R = T ? hullRooms(T) : [], n = {}, reach = T ? deckReach(T) : null;
    R.forEach(function (r, i) {
      var I = roomItems(T, r, roomPlan(CFG_ID, r.name)), el = $('rm-' + i + 'V'), b = document.querySelector('#roomItems button[data-e="' + i + '"]');
      var sz = ((r.max[0] - r.min[0] + 1) * S).toFixed(1) + '×' + ((r.max[1] - r.min[1] + 1) * S).toFixed(1) + ' m';
      var far = reach && r.deck && !reach[r.deck.i] ? '　⚠ 走不到（沒有梯子通' + r.deck.name + '）' : '';   // TASK-0572：艙房綁在甲板上（走不到 ⇒ 傷員送不過去）
      if (b) { b.style.display = I.type ? '' : 'none'; b.className = !RE.d && RE.i === i ? 'on' : ''; }
      if (!el) return;
      if (!I.type) { el.textContent = sz + far; return; }
      var its = I.items.map(function (q) { return q.it; }), B = roomBuff(I.type, its), lack = roomLack(I.type, its);
      if (!lack) n[I.type] = (n[I.type] || 0) + 1;
      el.textContent = sz + '・' + (I.auto ? '自動擺滿：' : '自訂：') + (itemsText(I.items) || '沒有物品') + (Object.keys(B).length ? '・' + buffText(B) : '') + (lack ? '　⚠ 缺必要件（' + lack + '）⇒ 不能用' : '') + (I.bad.length ? '　⚠ 存的擺法有 ' + I.bad.length + ' 件擺不下（沒擺）' : '') + far;
    });
    (T ? hullDeckKit(T).decks : []).forEach(function (D, i) {
      var I = deckItems(T, D, deckPlan(CFG_ID, D.id)), el = $('dk-' + i + 'V'), b = document.querySelector('#deckItems button[data-d="' + i + '"]');
      if (b) b.className = RE.d && RE.i === i ? 'on' : '';
      var nk = I.items.filter(function (q) { return FURN[q.it].role === 'powder'; }).length, oth = itemsText(I.items.filter(function (q) { return FURN[q.it].role !== 'powder'; }));   // 抽水機、木工台、帆布櫃照名字各數（⛔ 以前「不是火藥 ＝ 抽水機」⇒ 木工台＋帆布櫃被寫成「抽水機 2 台」）
      if (el) el.textContent = (I.auto ? '自動：' : '自訂：') + '取用點 ' + nk + ' 處（每處三桶）' + (oth ? '・' + oth : '') + (nk ? '' : '　⚠ 這一層的送藥手沒地方拿火藥') + (I.bad.length ? '　⚠ 存的擺法有 ' + I.bad.length + ' 處擺不下（沒擺）' : '');
    });
    $('roomSum').textContent = !T ? '船型載入後列得出艙房。' : !R.length ? '這一型還沒標空艙房（造船規格 §9.2：艙房子作品的固定點 <房名>.min／.max、關聯 meta kind=rooms）。'
      : R.length + ' 間空艙房' + (Object.keys(n).length ? '：' + Object.keys(n).map(function (f) { return ROOM_FN[f].name + ' ' + n[f] + ' 間'; }).join('、') : '，都空著') + '。選了類型就自動擺滿（先擺必要件、再擺加強件、剩下的空間多擺）；「擺設…」自己擺。門口留一格走道。' + (ROOMFN_Q ? '　⚠ 網址 ?roomfn= 蓋過' : '');
    roomEdShow(); roomsAdminPost();
  }
  /** 編輯器裡那一間：{ T, name（擺法的鍵）, label, G, pl（擺法）, I（實際擺上的）}；沒有打開 ⇒ null。 */
  function roomEdCur() {
    var T = HULLT[CFG_ID]; if (!T || RE.i < 0) return null;
    if (RE.d) { var D = hullDeckKit(T).decks[RE.i]; if (!D) return null; var dp = deckPlan(CFG_ID, D.id); return { T: T, name: D.id, label: D.name, G: deckGrid(T, D), pl: dp, I: deckItems(T, D, dp) }; }
    var r = hullRooms(T)[RE.i], pl = r && roomPlan(CFG_ID, r.name);
    return pl ? { T: T, name: r.name, label: roomName(r), G: roomGrid(T, r), pl: pl, I: roomItems(T, r, pl) } : null;
  }
  function roomEdShow() {
    var ed = $('roomEd'), E = roomEdCur();
    if (!E) { ed.style.display = 'none'; RE.i = -1; document.body.classList.remove('roomEdOn'); return; }
    ed.style.display = ''; document.body.classList.add('roomEdOn');            // 打開 ⇒ 接近全螢幕的浮層（Tim：拉寬、儘量不要捲軸）
    var F = ROOM_FN[E.pl.type], its = E.I.items.map(function (q) { return q.it; }), B = roomBuff(E.pl.type, its), lack = roomLack(E.pl.type, its), cap = 0;
    if (!RE.it || F.items.indexOf(RE.it) < 0) RE.it = F.items[0];
    E.I.items.forEach(function (q) { cap += FURN[q.it].hold || 0; });
    $('roomEdT').textContent = E.label + '・' + F.name + '（' + E.G.nx + '×' + E.G.ny + ' 格，一格 0.5 m）' + (E.I.auto ? (RE.d ? '・自動（照舊的取用點' + (E.I.pumps ? '＋抽水機 ' + E.I.pumps + ' 台' : '') + '）' : '・自動擺滿') : '・自訂');
    $('roomEdA').textContent = RE.d ? '回到自動' : '自動擺滿';
    $('roomEdPm').style.display = RE.d && F.items.some(function (it) { return FURN[it] && FURN[it].role === 'pump'; }) ? '' : 'none';   // 擺滿抽水機（TASK-0604；45_pumps.js pumpFillMax）：只有甲板
    $('roomEdP').innerHTML = F.items.map(function (it) { return '<button data-it="' + it + '"' + (RE.it === it && !RE.del ? ' class="on"' : '') + '>' + FURN[it].name + '（' + furnNote(it) + '）</button>'; }).join('') +
      '<button data-rot="1">轉 90°（' + (RE.r ? '橫過船身' : '順著船身') + '）</button><button data-del="1"' + (RE.del ? ' class="on"' : '') + '>拿掉</button>';
    [].forEach.call($('roomEdP').querySelectorAll('button'), function (b) {
      b.onclick = function () { if (b.dataset.it) { RE.it = b.dataset.it; RE.del = false; } else if (b.dataset.rot) RE.r = 1 - RE.r; else RE.del = !RE.del; RE.msg = ''; roomEdShow(); };
    });
    var npE = E.I.items.filter(function (q) { return FURN[q.it].role === 'pump'; }).length;
    $('roomEdV').innerHTML = (RE.d && npE ? '抽水機 ' + npE + ' 台：加在基礎抽水量上；人力的艙裡有水才派預備水手去搖，蒸汽的靠鍋爐；被打壞、泡水就停。選到抽水機時，調暗的格不能擺（泵井在主桅腳、泵管走中線）。<br>' : '') + (RE.d ? '取用點 ' + E.I.items.filter(function (q) { return FURN[q.it].role === 'powder'; }).length + ' 處：送藥手到最近的一處拿火藥與彈藥（彈藥庫 ＝ 離它最近的那間）；被打到會殉爆。深紅 ＝ 砲班的位置（不能擺）。' : '') + (cap ? '容納 ' + cap + ' 人' : '') + (Object.keys(B).length ? (cap ? '・' : '') + buffText(B) : '') + (lack ? '　<b style="color:#ff9a7a">缺必要件（' + lack + '）⇒ 這一間不能用</b>' : '') +
      (E.I.bad.length ? '<br>⚠ 存的擺法這幾件擺不下（沒擺）：' + E.I.bad.join('；') : '') + (E.I.why ? '<br>⚠ ' + E.I.why : '') + (RE.msg ? '<br>' + RE.msg : '') + (ROOMFN_Q ? '<br>⚠ 網址 ?roomfn= 蓋過：這裡改的開戰時不會用' : '');
    var L = roomEdLay(E.G);
    $('roomEdL').textContent = (L.rot ? '↑ 船頭；左 ＝ 左舷、右 ＝ 右舷' : '← 船尾　船頭 →；上 ＝ 左舷、下 ＝ 右舷') + '。綠 ＝ 可以擺、' + (RE.d ? '深紅 ＝ 砲班的位置' : '黃 ＝ 門口走道') + '（不能擺）、深色 ＝ 站不住。物品的中心擺在點的那一格' + (RE.d ? '。' : '；每一件都要有一邊從門口走得到。');
    roomEdDraw(E);
  }
  /** 格子怎麼畫：一格幾 px、要不要轉（窄的螢幕上，長的甲板改成船頭朝上 ⇒ 往下捲、不用左右捲）。 */
  function roomEdLay(G) {
    var W = Math.max(200, ($('roomEd').clientWidth || innerWidth) - 24), a = Math.floor(W / G.nx), b = Math.floor(W / G.ny);
    if (a < 9 && G.nx > G.ny && b > a) return { rot: true, cs: Math.min(40, b) };
    return { rot: false, cs: Math.max(6, Math.min(40, a)) };
  }
  /** 物品的中心落在 (i, j) 那一格 ⇒ 最小角。 */
  function roomEdAt(it, r, i, j) { var t = itemTiles(it, r); return { it: it, x: i - Math.floor((t[0] - 1) / 2), y: j - Math.floor((t[1] - 1) / 2), r: r }; }
  function roomEdHit(items, i, j) { return items.filter(function (q) { var t = itemTiles(q.it, q.r); return i >= q.x && i < q.x + t[0] && j >= q.y && j < q.y + t[1]; })[0] || null; }
  function roomEdDraw(E) {
    var cv = $('roomEdC'), G = E.G, L = roomEdLay(G), cs = L.cs, dpr = window.devicePixelRatio || 1, W = (L.rot ? G.ny : G.nx) * cs, H = (L.rot ? G.nx : G.ny) * cs;
    cv.style.width = W + 'px'; cv.style.height = H + 'px'; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.lay = L;
    var x = cv.getContext('2d'), i, j; x.setTransform(dpr, 0, 0, dpr, 0, 0);
    /** 格子（i, j）起、寬 wi 格、高 hj 格的那一塊 ⇒ 畫面上的 [x, y, w, h]（轉了 ⇒ 船頭朝上：畫面的列 ＝ nx − 1 − i、欄 ＝ j）。 */
    function R(i0, j0, wi, hj) { return L.rot ? [j0 * cs, (G.nx - i0 - wi) * cs, hj * cs, wi * cs] : [i0 * cs, j0 * cs, wi * cs, hj * cs]; }
    for (j = 0; j < G.ny; j++) for (i = 0; i < G.nx; i++) { var s = G.s[i + j * G.nx], r = R(i, j, 1, 1); x.fillStyle = s === 0 ? '#20252c' : s === 2 ? '#5d5530' : s === 3 ? '#4e2a26' : '#3b4a3a'; x.fillRect(r[0], r[1], r[2], r[3]); }
    var PF = !RE.del && FURN[RE.it] && FURN[RE.it].place;             // 抽水機（45_pumps.js）：選到它 ⇒ 位置規則外的格調暗（主桅旁中線、蒸汽的只有蒸汽船）
    if (PF) { x.fillStyle = 'rgba(0,0,0,.55)'; for (j = 0; j < G.ny; j++) for (i = 0; i < G.nx; i++) if (G.s[i + j * G.nx] === 1 && pumpPlaceWhy(G, roomEdAt(RE.it, RE.r, i, j))) { var r3 = R(i, j, 1, 1); x.fillRect(r3[0], r3[1], r3[2], r3[3]); } }
    if (cs >= 6) {
      x.strokeStyle = 'rgba(255,255,255,.12)'; x.lineWidth = 1; x.beginPath();
      for (i = 0; i <= W / cs; i++) { x.moveTo(i * cs + 0.5, 0); x.lineTo(i * cs + 0.5, H); }
      for (j = 0; j <= H / cs; j++) { x.moveTo(0, j * cs + 0.5); x.lineTo(W, j * cs + 0.5); }
      x.stroke();
    }
    var hit = RE.hover && RE.del ? roomEdHit(E.I.items, RE.hover[0], RE.hover[1]) : null;
    x.font = Math.max(9, Math.min(13, cs * 0.45)) + 'px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    E.I.items.forEach(function (q) {
      var t = itemTiles(q.it, q.r), r = R(q.x, q.y, t[0], t[1]);
      x.fillStyle = ITEM_COL[q.it] || '#aaa'; x.fillRect(r[0] + 2, r[1] + 2, r[2] - 4, r[3] - 4);
      x.strokeStyle = q === hit ? '#ff5040' : 'rgba(0,0,0,.6)'; x.lineWidth = q === hit ? 3 : 1; x.strokeRect(r[0] + 2, r[1] + 2, r[2] - 4, r[3] - 4);
      x.fillStyle = q.it === 'keg' ? '#f2dcb8' : '#111'; if (Math.min(r[2], r[3]) > 14 && Math.max(r[2], r[3]) > 22) x.fillText(q.it === 'keg' ? '桶' : FURN[q.it].name, r[0] + r[2] / 2, r[1] + r[3] / 2);
    });
    if (RE.hover && !RE.del) {
      var q = roomEdAt(RE.it, RE.r, RE.hover[0], RE.hover[1]), t = itemTiles(q.it, q.r), ok = !placeOk(G, E.pl.type, E.I.items, q), r2 = R(q.x, q.y, t[0], t[1]);
      x.fillStyle = ok ? 'rgba(120,255,140,.35)' : 'rgba(255,90,70,.35)'; x.fillRect(r2[0], r2[1], r2[2], r2[3]);
      x.strokeStyle = ok ? '#7f8' : '#f65'; x.lineWidth = 2; x.strokeRect(r2[0] + 1, r2[1] + 1, r2[2] - 2, r2[3] - 2);
    }
  }
  function roomEdTile(ev) {
    var cv = $('roomEdC'), b = cv.getBoundingClientRect(), L = cv.lay || { cs: 20 }, c = Math.floor((ev.clientX - b.left) / L.cs), rw = Math.floor((ev.clientY - b.top) / L.cs), E = roomEdCur();
    return L.rot && E ? [E.G.nx - 1 - rw, c] : [c, rw];
  }
  $('roomEdC').onpointermove = function (ev) { var E = roomEdCur(); if (!E) return; var h = roomEdTile(ev); if (!RE.hover || h[0] !== RE.hover[0] || h[1] !== RE.hover[1]) { RE.hover = h; roomEdDraw(E); } };
  $('roomEdC').onpointerleave = function () { var E = roomEdCur(); RE.hover = null; if (E) roomEdDraw(E); };
  $('roomEdC').onclick = function (ev) {
    var E = roomEdCur(); if (!E) return;
    var h = roomEdTile(ev), cur = E.I.items.map(function (q) { return { it: q.it, x: q.x, y: q.y, r: q.r }; }), hit = roomEdHit(cur, h[0], h[1]);
    RE.hover = h;
    if (RE.del) { if (!hit) { RE.msg = '這格沒有物品'; roomEdShow(); return; } cur.splice(cur.indexOf(hit), 1); RE.msg = '拿掉了' + FURN[hit.it].name; }
    else if (hit) { RE.msg = '這格已經有' + FURN[hit.it].name + '（要拿掉：按「拿掉」再點它）'; roomEdShow(); return; }
    else {
      var q = roomEdAt(RE.it, RE.r, h[0], h[1]), why = placeOk(E.G, E.pl.type, cur, q);
      if (why) { RE.msg = '<b style="color:#ff9a7a">放不下：' + why + '</b>'; roomEdShow(); return; }
      cur.push(q); RE.msg = '擺上' + FURN[q.it].name;
    }
    roomSet(E.name, { type: E.pl.type, items: cur }); show();
  };
  $('roomEdA').onclick = function () {
    var E = roomEdCur(); if (!E) return;
    if (RE.d) { roomSet(E.name, { type: 'deck' }); RE.msg = '回到自動（照舊的取用點；道具設定「每船自動擺幾台」不是 0 的抽水機也照它擺）'; }   // 甲板的自動 ＝ 沒有 items（⇒ 開戰時照舊找、戰局跟沒改過一樣；蓋過設定檔的自訂預設）
    else { roomSet(E.name, { type: E.pl.type }); RE.msg = '自動擺滿了'; }
    show();
  };
  // 擺滿抽水機（TASK-0604）：照位置規則（主桅旁中線；蒸汽的只有蒸汽船）把每一種擺到全船上限，扣掉別層、這一層已經擺的 ⇒ 存成這一層的自訂擺法（多的自己拿掉）
  $('roomEdPm').onclick = function () {
    var E = roomEdCur(); if (!E || !RE.d) return;
    var DK = hullDeckKit(E.T).decks, cur = E.I.items.map(function (q) { return { it: q.it, x: q.x, y: q.y, r: q.r }; }), have = {};
    function cnt(L) { L.forEach(function (q) { if (FURN[q.it] && FURN[q.it].role === 'pump') have[q.it] = (have[q.it] || 0) + 1; }); }
    DK.forEach(function (X, k) { if (k !== RE.i) cnt(deckItems(E.T, X, deckPlan(CFG_ID, X.id)).items); }); cnt(cur);
    var got = pumpFillMax(E.T, DK[RE.i], cur, have), n = 0, txt = Object.keys(got).filter(function (it) { return got[it]; }).map(function (it) { n += got[it]; return FURN[it].name + ' ' + got[it] + ' 台'; }).join('、');
    if (!n) { RE.msg = '沒有再擺上抽水機（已經到全船上限，或這一層的主桅旁中線擺不下）'; roomEdShow(); return; }
    roomSet(E.name, { type: 'deck', items: cur }); RE.msg = '擺上' + txt + '（擺到全船上限' + (got.pump ? '；人力的每台要 ' + FURN.pump.crew + ' 人搖' : '') + '，多的按「拿掉」）'; show();
  };
  $('roomEdZ').onclick = function () { var E = roomEdCur(); if (!E) return; roomSet(E.name, { type: E.pl.type, items: [] }); RE.msg = '清空了'; show(); };
  $('roomEdX').onclick = $('roomEdX2').onclick = function () { RE.i = -1; show(); };
  window.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && RE.i >= 0) { RE.i = -1; show(); } });
  window.addEventListener('resize', function () { if (RE.i >= 0) roomEdShow(); });
  // 後台模式（?admin=rooms）：只開船隻配置頁的甲板與艙房；後台送來設定檔的預設（{ kind:'cb-defaults', rooms: { 船型: ships[].rooms } }）⇒ 換掉預設、清掉這裡改的
  if (ADMIN_ROOMS) {
    $('shipp').classList.add('admin');
    window.addEventListener('message', function (ev) {
      if (ev.origin !== location.origin || !ev.data || ev.data.kind !== 'cb-defaults') return;
      HULL_KNOWN.forEach(function (h) { h.rooms = ev.data.rooms[h.id] || undefined; });
      Object.keys(SHIP_ROOMS).forEach(function (k) { delete SHIP_ROOMS[k]; }); ADM_SENT = {};
      put(); show();
    });
  }
  function crewPut() {
    var cw = shipCrew(CFG_ID), hc = hullCounts(CFG_ID);
    Object.keys(CR).forEach(function (key) { var e = CR[key]; e.el.value = e.it.gun ? gunCrew(cw, e.it.gun) : cw[e.it.k]; if (e.it.gun) e.row.style.display = !hc || hc.guns[e.it.gun] ? '' : 'none'; });
  }
  function crewShow() {
    var cw = shipCrew(CFG_ID), d = crewDefault(CFG_ID), hc = hullCounts(CFG_ID);
    function v(key, txt, x, x0) { $('cr-' + key + 'V').textContent = txt + (x === x0 ? '' : '　（預設 ' + x0 + '）'); }
    var n = cw.officers; v('officers', n + ' 人' + (n ? '（' + rankList(n) + '）' : '（沒有軍官：沒人指揮，瞄準變散）'), n, d.officers);
    n = cw.helm; v('helm', n + ' 人' + (hc && !hc.wheel ? '（這型沒有舵輪 ⇒ 不站人）' : '（站在舵輪後面；倒下時預備水手會補）'), n, d.helm);
    n = cw.marines; v('marines', n + ' 人（沿右舷舷牆站，用火槍打敵艦露天的人）', n, d.marines);
    n = cw.top; v('top', n + ' 人 × ' + (hc ? hc.masts + ' 根桅 ＝ ' + n * hc.masts : '每根桅'), n, d.top);
    n = cw.monkeys; v('monkeys', n ? n + ' 人 × 每一對砲' + (hc ? '（約 ' + Math.ceil(hc.n / 2) + ' 對）' : '') + '：從取用點搬火藥與彈藥' : '0（沒有：砲旁的藥箱用完就停）', n, d.monkeys);
    n = cw.hands; v('hands', n + ' 人（在住艙甲板待命，缺人手時補位）' + (Q.has('hands') ? '　⚠ 網址 ?hands= 蓋過' : ''), n, d.hands);
    n = cw.carpenter; var cp = hullStaff(CFG_ID, 'carpenter');   // 設施配員：木工台每張配幾位 ⇒ 這型擺了幾張（每船至少 1 張，不夠自動補）
    v('carpenter', n ? '上限 ' + n + ' 人：木工台每張配 ' + furnStaff(benchIt() || '', 'carpenter') + ' 位' + (cp === null ? '' : '（這型 ' + cp + ' 位' + (cp > n ? ' ⇒ 上限截到 ' + n : '') + '）') + '；開戰時生在木工台旁；修斷掉的梯子 —— 整件還原、補甲板破洞 —— 先補把甲板打成兩塊的；跟預備水手一樣在船裡走動' : '0（沒有：梯子、甲板打壞了就一直壞著）', n, d.carpenter);
    n = cw.sailmaker; var smn = hullStaff(CFG_ID, 'sailmaker');   // 設施配員：帆布櫃每件配幾位 ⇒ 這型擺了幾件（每船至少 1 件，不夠自動補）
    v('sailmaker', n ? '上限 ' + n + ' 人：帆布櫃每件配 ' + furnStaff(loftIt() || '', 'sailmaker') + ' 位' + (smn === null ? '' : '（這型 ' + smn + ' 位' + (smn > n ? ' ⇒ 上限截到 ' + n : '') + '）') + '；開戰時生在帆布櫃旁；還掛著的破帆走到帆底下修 —— 血量、斷在帆那一端的繩、破洞一次修好；整面掉了不補；帆布用完回櫃拿' : '0（沒有）', n, d.sailmaker);
    n = cw.surgeon; var sg = hullStaff(CFG_ID, 'surgeon');   // 設施配員（36_rooms.js staffSlots）：病床每張配幾位 ⇒ 這型擺了幾張；上限截掉的照實寫
    v('surgeon', n ? '上限 ' + n + ' 人：病床每張配 ' + furnStaff('bed', 'surgeon') + ' 位' + (sg === null ? '' : '（這型 ' + sg + ' 位' + (sg > n ? ' ⇒ 上限截到 ' + n : '') + '；走不到的床不配）') + '；開戰就站在床旁；醫療艙要的人手先算船醫、不夠才派預備水手；有船醫的那一間治療快 50%；沒設醫療艙的船不上船' : '0（沒有：醫療艙照舊只靠預備水手）', n, d.surgeon);
    n = cw.cook; var gk = hc ? hc.galley * GALLEY.cooks : null;   // 廚師（TASK-0720，45_galley.js）：爐灶（模型 meta kind=galley）每座配 galley.cooks 位，上限截掉的照實寫
    v('cook', n ? '上限 ' + n + ' 人：爐灶每座配 ' + GALLEY.cooks + ' 位' + (gk === null ? '' : hc.galley ? '（這型 ' + hc.galley + ' 座 ⇒ ' + Math.min(n, gk) + ' 位' + (gk > n ? '，上限截到 ' + n : '') + '）' : '（這型沒有廚房 ⇒ 不上船）') + '；有廚房（kind=galley）的船才上船，開戰就站在爐灶旁做飯，預備水手輪流當伙夫去領；倒下不補 ⇒ 存糧吃完就斷炊' + (GALLEY_PCT > 0 ? '' : '　⚠ 細節設定「廚房加成」是 0 ⇒ 不開廚房') : '0（不開廚房：沒有廚師、沒人吃飯，工作效率一直是 ×1）', n, d.cook);
    n = cw.navigator; v('navigator', n ? '1 人：站在後甲板舵輪旁；在崗 ⇒ 航速 +' + DUTY.navSpd + '%、轉向 +' + DUTY.navTurn + '%（倒下 ⇒ 還有軍官時剩 ' + Math.round(DUTY.standIn * 100) + '%）' : '沒有（航速、轉向照原本的）', n, d.navigator);   // 39_duty.js（TASK-0825）
    n = cw.quartermaster; v('quartermaster', n ? '1 人：站在彈藥庫的取用點旁；在崗 ⇒ 送藥手裝藥包快 ' + DUTY.qmFill + '%（倒下 ⇒ 還有軍官時剩 ' + Math.round(DUTY.standIn * 100) + '%；沒有彈藥庫的船不上船）' : '沒有（送藥照原本的）', n, d.quartermaster);
    $('cr-oarR').style.display = hc && !hc.oars ? 'none' : '';   // 沒有槳的船藏起來
    $('cr-oarV').textContent = !hc ? '船型載入後才知道' : hc.rowers + ' 人：' + hc.oars + ' 支槳 × 每支 ' + hc.rk.join('–') + ' 人（照船上每支槳的設定，這一頁不調）；坐在槳座內側划；倒下時預備水手照位子補；一支槳到崗幾成就出幾成力';
    n = cw.shelter ? 1 : 0; v('shelter', n ? '開：預備水手不上露天甲板閒晃（只上去補位）、船長以外的軍官待在甲板下' : '關：預備水手偶爾上露天甲板走動、軍官站在露天甲板', n, d.shelter ? 1 : 0);
    var gsum = 0;
    Object.keys(GUNS).forEach(function (t) {
      var x = gunCrew(cw, t), std = GUNS[t].crew, c = hc ? hc.guns[t] || 0 : 0; gsum += x * c;
      v('g-' + t, x + ' 人' + (hc ? ' × ' + c + ' 門 ＝ ' + x * c : '') + '（' + (x < std ? '標準 ' + std + '：人少裝填慢' : x > std ? '標準 ' + std + '：多的 ' + (x - std) + ' 人是替補' : '標準') + '；最少 ' + GUNS[t].min + ' 人才開得動）', x, gunCrew(d, t));
    });
    if (hc) {
      var pm = Math.ceil(hc.n / 2) * cw.monkeys, hl = hc.wheel ? cw.helm : 0, tp = cw.top * hc.masts, tot = gsum + pm + cw.officers + hl + cw.marines + tp + cw.hands + hc.rowers;
      var seen = CREW_SEEN[CFG_ID], ss = !seen ? '這一型還沒上過船：站不站得下，開戰時才知道（站不下的那一項會在上方廣播）。'
        : seen.sig !== crewSig(cw) ? '改過之後還沒開過戰：站不站得下，下一場開戰時才知道（站不下的那一項會在上方廣播）。'
        : '上一場實際上船 ' + seen.n + ' 人' + (seen.short.length ? '；站位不夠、站不下的：' + seen.short.map(function (r) { return r[0] + ' ' + r[2] + '／' + r[1]; }).join('、') + '。' : '，全部站得下。');
      $('crewSum').textContent = '全船約 ' + tot + ' 人：砲班 ' + gsum + '、送藥手約 ' + pm + '、軍官 ' + cw.officers + '、舵手 ' + hl + '、陸戰隊 ' + cw.marines + '、桅頂 ' + tp + (hc.rowers ? '、槳手 ' + hc.rowers : '') + '、預備水手 ' + cw.hands + '。' + ss;
    } else $('crewSum').textContent = '船型載入後算得出全船人數。';
    shipCardShow();
    $('shipSt').textContent = PREFS.write ? '改了就自動存在這個瀏覽器（重新整理、下次打開都還在）；換瀏覽器或裝置：用下面的匯出、匯入。'
      : '⚠ 這一頁現在存不了' + (PREFS.state ? '（' + PREFS.state + '）' : '（網址帶了設定參數、或是在畫廊的彈窗裡）') + ' —— 要留住請用下面的「匯出」。';
  }
  function put() {                                     // 變數 ⇒ 滑桿位置（開頭、重設預設值、換編輯的船時）
    var k = C(); $('cfgShip').textContent = (hullInfo(CFG_ID) || {}).name || CFG_ID;
    lf.value = k.ballast !== undefined ? k.ballast : LIM.ballast[2]; f.value = k.flood; h.value = Math.log(k.hard / LIM.hard[0]) / hk; c.value = STRIKE.cas * 100; sp.value = k.speed; ag.value = k.agile; uw.value = k.upwind; $('base').value = k.base || 0; $('pump').value = k.pump;
    gh.value = GUN_HP; gw.value = k.gunw; sl.value = SAIL_HP; ph.value = POWDER_HP; bl.value = BLAST_K; bv.value = Math.round(BLAST_V * 100); ch.value = CREW_HP;
    bx.value = BOX_N; cy.value = CARRY_N; wk.value = WIND_K; wc.value = WIND_CAP; $('inertia').value = DRV_INERTIA; $('turninert').value = DRV_TURN; $('sailtq').value = DRV_TQ; dr.value = DROWN_T; $('navre').value = NAV_RE; $('heal').value = HEAL_T; $('musket').value = MUSKET_R; $('sailfix').value = SAILFIX_T; $('burn').value = BURN_PCT; $('galley').value = GALLEY_PCT; $('gcrew').checked = GUN_CREW_HURT; $('dbg').checked = DBG_SET;
    se.value = SEA_K; st.value = STALL_K; fs.value = FUN.speed; fa.value = FUN.agile; fl.value = FUN.stall; fp.value = FUN.powder; fh.value = FUN.hard; whl.value = WHEEL_LOSS; rdl.value = RUDDER_LOSS; dtq.value = DIFF_K; fhl.value = FUN.helmloss; fhe.value = FUN.helmeff; fdf.value = FUN.diff;
    for (var r = 0; r < 3; r++) for (var k = 0; k < 3; k++) am(r, k).value = AMMO_K[r][k];
    ['guns', 'masts', 'officers'].forEach(function (k) { $('st-' + k).checked = STRIKE[k]; });
    [0, 1].forEach(function (i) { $('cap' + i).value = CAP_SET[i]; });
    crewPut(); roomsPut();
  }
  function show() {
    var K = C(), SPEEDK = K.speed, AGILK = K.agile, FLOOD = K.flood, HARDK = K.hard, GUNW_K = K.gunw, BALLAST_T = K.ballast !== undefined ? K.ballast : LIM.ballast[2];   // 正在編輯的那一型
    var fun = PLAY === 'fun' ? '（娛樂：' : '（', SPE = SPEEDK * playK('speed'), AGE = AGILK * playK('agile');   // 娛樂 ⇒ 括號裡寫乘過加成的實際值
    $('speedV').textContent = SPEEDK.toFixed(2) + '×' + fun + '最快約 ' + (VMAX * SPE * 1.944).toFixed(0) + ' 節）';
    $('agileV').textContent = AGILK.toFixed(2) + '×' + fun + '滿帆側風約 ' + ((0.012 + 0.016 * VMAX * 0.92) * AGE * 57.3).toFixed(1) + '°/秒）';
    var BKV = K.base || 0; $('baseV').textContent = BKV ? BKV.toFixed(1) + ' 節（' + (PLAY === 'fun' ? '娛樂：實際 ' + (BKV * playK('speed')).toFixed(1) + ' 節；' : '') + '推力跟帆相加：實際 ＝ √(帆² ＋ 額外動力²)；不看風向、風速、帆，頂風、收帆也走得動；帆段滿帆再加 ＝ 全速前進才開、全收再收 ＝ 倒車）' : '0（沒有：照帆與風走）';
    var UPK = K.upwind; $('upwindV').textContent = UPK.toFixed(2) + '×（' + (UPK === 1 ? '照舊：' : '') + '風從船頭 ' + (90 - (90 - NOGO_DEG) * UPK).toFixed(0) + '° 開始失速、' + (90 - (90 - NOGO_FULL) * UPK).toFixed(0) + '° 全失速（手動操舵）；近迎風轉向最多 ×' + UPK.toFixed(2) + '）';
    var SK = STALL_K * playK('stall'), WA = WAVES.reduce(function (a, w) { return a + w.a; }, 0) * SEA_K;   // WA：幾道浪疊在一起最高的那一下（振幅）
    $('seaV').textContent = SEA_K <= 0 ? '0（平靜）' : SEA_K.toFixed(2) + '×（浪高最多約 ' + (WA * 2).toFixed(1) + ' m，主浪週期 ' + (2 * Math.PI / WAVES[0].w).toFixed(1) + ' 秒）';
    $('stallV').textContent = Math.round(STALL_K * 100) + '%' + (PLAY === 'fun' ? '（娛樂：實際 ' + Math.round(SK * 100) + '%）' : '') + (SK <= 0 ? '（不會失速）' : SK >= 0.95 ? '（寫實）' : '');
    var HLk = PLAY === 'fun' ? FUN.helmloss : 1, HLw = Math.min(1, WHEEL_LOSS * HLk), HLr = Math.min(1, RUDDER_LOSS * HLk);   // 操舵（TASK-0777）：損失 ⇒ 舵效剩幾成
    $('wheellossV').textContent = '損失 ' + Math.round(WHEEL_LOSS * 100) + '%' + (PLAY === 'fun' ? '（娛樂：實際 ' + Math.round(HLw * 100) + '%）' : '') + ' ⇒ 舵效剩 ' + Math.round((1 - HLw) * 100) + '%';
    $('rudderlossV').textContent = '損失 ' + Math.round(RUDDER_LOSS * 100) + '%' + (PLAY === 'fun' ? '（娛樂：實際 ' + Math.round(HLr * 100) + '%）' : '') + ' ⇒ 舵效剩 ' + Math.round((1 - HLr) * 100) + '%（兩樣都沒了 ' + Math.round((1 - HLw) * (1 - HLr) * 100) + '%）';
    $('difftqV').textContent = DIFF_K <= 0 ? '0（兩舷推力差不轉船）' : '舵的 ' + Math.round(DIFF_K * 100) + '%' + (PLAY === 'fun' ? '（娛樂：實際 ' + Math.round(DIFF_K * FUN.diff * 100) + '%）' : ''); $('fundiffV').textContent = FUN.diff.toFixed(2) + '×'; $('funhelmlossV').textContent = FUN.helmloss.toFixed(2) + '×'; $('funhelmeffV').textContent = FUN.helmeff.toFixed(2) + '×';
    $('funspeedV').textContent = FUN.speed.toFixed(2) + '×'; $('funagileV').textContent = FUN.agile.toFixed(2) + '×'; $('funstallV').textContent = FUN.stall.toFixed(2) + '×';
    $('funhardV').textContent = FUN.hard.toFixed(2) + '×（鐵甲的擊穿門檻：寫實 ' + Math.round(MATS.iron ? MATS.iron.pen || 0 : 0) + ' ⇒ 娛樂 ' + Math.round((MATS.iron ? MATS.iron.pen || 0 : 0) * FUN.hard) + ' kJ／格；木頭不變）';
    $('funpowderV').textContent = FUN.powder.toFixed(2) + '×' + (powderNever() ? '（火藥拉滿：不會爆）' : '（火藥血量 ' + POWDER_HP + ' ⇒ ' + Math.round(POWDER_HP * FUN.powder) + '）');
    var PU = K.pump; $('pumpV').textContent = PU.toFixed(1) + ' 噸／分' + (PU === cfgBase('pump', CFG_ID) ? '（預設：照排水量）' : '') + (PU <= 0 ? '（不抽水）' : '');
    $('floodV').textContent = FLOOD === 0 ? '0×（不會沉）' : FLOOD.toFixed(2) + '×' + (FLOOD < 0.5 ? '（慢）' : FLOOD < 1.2 ? '' : '（快）');
    var HT = HULLT[CFG_ID], m0 = HT ? hullT0(HT, { ballast: BALLAST_T, gunw: GUNW_K }).all : 0, l0 = liftFor(HT, HT ? HT.disp - m0 : 0), lx = liftFor(HT, HT ? HT.disp - m0 + 70 : 0);   // 照我艦的船型   // 開戰時浮在哪；例子：再打掉 10 萬格（70 噸）
    var gm = 0, kinds = {}; if (HT) (HT.rig.models || []).forEach(function (m) { var k = modelKind(m); if (GUNS[k]) { gm += GUNS[k].mass * GUNW_K; kinds[k] = 1; } });
    $('gunwV').textContent = GUNW_K.toFixed(2) + '×（' + Object.keys(GUNS).filter(function (k) { return !HT || kinds[k]; }).map(function (k) { return GUNS[k].name + ' ' + (GUNS[k].mass * GUNW_K).toFixed(1) + ' 噸'; }).join('、') + (gm ? '；全部 ' + Math.round(gm) + ' 噸' : '') + '）';
    $('ballastV').textContent = BALLAST_T + ' 噸' + (l0 === null ? '' : '（' + HT.name + ' ' + Math.round(m0).toLocaleString() + ' 噸 ⇒ ' + (Math.abs(l0) < 0.05 ? '剛好在設計水線' : l0 > 0 ? '浮高 ' + l0.toFixed(1) + ' m' : '吃水深 ' + (-l0).toFixed(1) + ' m') + '；打掉 10 萬格再浮 ' + (lx - l0).toFixed(2) + ' m）');
    $('hardV').textContent = HARDK.toFixed(2) + '×' + (HARDK === 1 ? '（只看材質）' : HARDK < 0.5 ? '（容易打穿）' : HARDK > 3 ? '（幾乎打不穿）' : HARDK > 1 ? '（比材質硬）' : '（比材質軟）');
    function shots(hp, dmg) { return dmg > 0 ? Math.ceil(hp / dmg - 1e-9) : '∞'; }
    $('gunhpV').textContent = GUN_HP + '（24 磅實心 ' + shots(GUN_HP, DMG.long * ammoK(0, VS_GUN)) + ' 發、舵輪 ' + Math.round(GUN_HP * 0.6) + '）';
    $('sailhpV').textContent = SAIL_HP + '（24 磅鏈彈 ' + shots(SAIL_HP, DMG.long * ammoK(2, VS_SAIL)) + ' 發）';
    $('crewhpV').textContent = CREW_HP + (CREW_HP === LIM.crewhp[2] ? '' : CREW_HP > LIM.crewhp[2] ? '（耐打）' : '（脆）');
    $('crewdeathV').textContent = CREW_DEATH + '%（HP 歸零：' + (CREW_DEATH >= 100 ? '一律陣亡' : CREW_DEATH <= 0 ? '一律變成傷員' : CREW_DEATH + '% 陣亡、' + (100 - CREW_DEATH) + '% 變成傷員') + '）';
    $('powderhpV').textContent = powderNever() ? '拉滿（不會爆）' : POWDER_HP + (PLAY === 'fun' ? '（娛樂：實際 ' + powderHP() + '）' : '') + (powderHP() >= 600 ? '（很難殉爆，' : powderHP() >= 250 ? '（偶爾殉爆，' : '（很容易殉爆，') + '藥包 ' + Math.round(powderHP() * CART_K) + '）';   // 照實際的（娛樂乘過加成）；300 量過六艘一艘殉爆 ⇒ 偶爾
    $('blastV').textContent = BLAST_K.toFixed(2) + '×（前彈藥庫半徑約 ' + (MAG_R * Math.pow(BLAST_K, 1 / 3) * (S || 0.1)).toFixed(1) + ' m）';
    var r0 = MAG_R * Math.pow(BLAST_K * (1 - BLAST_V), 1 / 3) * (S || 0.1), r1 = MAG_R * Math.pow(BLAST_K * (1 + BLAST_V), 1 / 3) * (S || 0.1);
    $('blastvV').textContent = BLAST_V <= 0 ? '0（每次一樣）' : '±' + Math.round(BLAST_V * 100) + '%（前彈藥庫半徑 ' + r0.toFixed(1) + '～' + r1.toFixed(1) + ' m）';
    var bxK = Object.keys(GUNS).filter(function (k) { return gunBoxK(k) > 1; }).map(function (k) { return GUNS[k].short + ' × ' + gunBoxK(k); }); $('boxV').textContent = BOX_N + ' 份（開戰時裝滿' + (bxK.length ? '；' + bxK.join('、') : '') + '）';   // 砲種表 box：那種武器一份算幾發（10_ship.js gunBoxK）
    $('healV').textContent = HEAL_T ? '約 ' + HEAL_T + ' 秒（預備水手把傷員搬到醫療艙的病床；手術台快 3 倍（要船醫）、藥箱加快，人手不足變慢；治好的回來當預備水手）' : '0（關：傷員照舊 12 秒抬下去，不搬、不治）';
    $('musketV').textContent = MUSKET_R + ' m（射程內看不到人就不開槍；射程內命中率照距離，船不晃、甲板對甲板：25 m 約 ' + (musketHit(25, MUSKET.h, 0) * 100).toFixed(0) + '%、100 m 約 ' + (musketHit(100, MUSKET.h, 0) * 100).toFixed(1) + '%、' + MUSKET_R + ' m 約 ' + (musketHit(MUSKET_R, MUSKET.h, 0) * 100).toFixed(1) + '%；船晃得兇更低）';
    $('sailfixV').textContent = SAILFIX_T + ' 秒（一面帆從滿血打到快掉，帆匠站在帆底下修這麼久；照缺的血量比例算，接一條繩多 ' + SM_ROPE_T + ' 秒；修完一次補回：血量、繩、破洞）';
    $('burnV').textContent = BURN_PCT ? BURN_PCT + '%（希臘火點著的木頭往外燒、燒久了燒穿（水線下會進水）；帆也會燒出洞、燒掉；預備水手去潑水）' : '0（不點火：希臘火照以前只燒人、撕帆、燒細繩）';
    $('galleyV').textContent = GALLEY_PCT ? '×' + (1 + GALLEY_PCT / 100).toFixed(2) + '（吃過飯的人裝填、抽水、修補、救火、治療快 ' + GALLEY_PCT + '%；吃完 ' + GALLEY.hold + ' 秒內滿的、之後 ' + GALLEY.fade + ' 秒慢慢退回 ×1；下一場開戰才決定開不開廚房）' : '0（關：不開廚房、不生廚師，有爐灶的船照沒有廚房跑）';
    $('navreV').textContent = NAV_RE > 0 ? '每 ' + NAV_RE + ' 秒（這段時間裡有甲板、梯子被打壞才重算那幾層：打成兩塊不通 ⇒ 分開找路、梯子斷了 ⇒ 改走別座）' : '關（走路格照開戰時的船：甲板打穿了照樣走過去）';
    $('drownV').textContent = DROWN_T ? '約 ' + DROWN_T + ' 秒（浮上水面、往自己的船游，爬回來當預備水手；受傷的減半）' : '0（關：落水當場算陣亡、淹到的跟著船沉）';
    $('windcapV').textContent = WIND_CAP + ' m/s（暴風雨陣風最大約 ' + Math.round(WIND_SAIL * WIND_K * (1 + GUST[0] + GUST[1] + GUST[2]) * 2.2 * 1.5) + ' m/s ⇒ ' + (WIND_SAIL * WIND_K * (1 + GUST[0] + GUST[1] + GUST[2]) * 2.2 * 1.5 > WIND_CAP ? '會被夾住' : '不會碰到') + '）';
    $('inertiaV').textContent = DRV_INERTIA.toFixed(2) + '×（質量的倍率：加減速' + (DRV_INERTIA > 1.01 ? '慢 ' + DRV_INERTIA.toFixed(2) + ' 倍' : DRV_INERTIA < 0.99 ? '快 ' + (1 / DRV_INERTIA).toFixed(2) + ' 倍' : '照校準') + '）'; $('turninertV').textContent = DRV_TURN.toFixed(2) + '×（轉向追舵 ' + (2 * DRV_TURN).toFixed(1) + ' 秒）'; $('sailtqV').textContent = DRV_TQ.toFixed(2) + '×' + (DRV_TQ === 0 ? '（受損不偏）' : '');
    $('windV').textContent = WIND_K.toFixed(2) + '×（帆上的風約 ' + (WIND_SAIL * WIND_K).toFixed(0) + ' m/s，陣風 ±' + Math.round(GUST[0] * 100) + '%）';
    $('carryV').textContent = CARRY_N + ' 份' + (CARRY_N > BOX_N ? '（比藥箱多 ⇒ 一趟送好幾門）' : '');
    $('casV').textContent = STRIKE.cas >= 1 ? '100%（全員倒下才停）' : Math.round(STRIKE.cas * 100) + '%';
    $('strikeV').textContent = strikeText();
    var amDef = AMMO_K.every(function (r, i) { return r.every(function (v, j) { return v === AMMO_K0[i][j]; }); });
    $('detV').textContent = '玩法 ' + (PLAY === 'fun' ? '娛樂（航速 ×' + FUN.speed.toFixed(2) + '、靈活 ×' + FUN.agile.toFixed(2) + '、頂風失速 ' + Math.round(SK * 100) + '%）' : '寫實（頂風失速 ' + Math.round(SK * 100) + '%）') + '・天氣 ' + WX.name + '・浪 ' + (SEA_K > 0 ? SEA_K.toFixed(2) + '×' : '平靜') + '・' + fleetHulls().map(function (id) { var c = shipCfg(id), hi = hullInfo(id); return (hi ? hi.name : id) + '：硬度 ' + c.hard.toFixed(1) + '×・進水 ' + c.flood.toFixed(2) + '×・抽水 ' + c.pump.toFixed(1) + ' 噸／分・壓艙物 ' + (c.ballast !== undefined ? c.ballast + ' 噸' : '（載入後）') + '・砲重 ' + c.gunw.toFixed(2) + '×・航速 ' + c.speed.toFixed(2) + '×・靈活 ' + c.agile.toFixed(2) + '×・逆風 ' + c.upwind.toFixed(2) + '×・預備水手 ' + shipCrew(id).hands; }).join('；') + '・血量 砲 ' + GUN_HP + '／帆 ' + SAIL_HP + '／船員 ' + CREW_HP +
      '・傷害 ' + DMG.long + '／' + DMG.long32 + '／' + DMG.carr + '／' + DMG.chase + '／' + DMG.long4 + '／' + DMG.long12 + '／' + DMG.long18 + '／' + DMG.long6 + '／' + DMG.chase3 + (amDef ? '' : '・彈種倍率已改') + '・藥箱 ' + BOX_N + '、一次搬 ' + CARRY_N + '・溺水 ' + (DROWN_T ? DROWN_T + ' 秒' : '關') +
      '・火藥桶 ' + (powderNever() ? '不會爆' : '血量 ' + powderHP() + '、殉爆 ' + BLAST_K.toFixed(2) + '×' + (BLAST_V > 0 ? ' ±' + Math.round(BLAST_V * 100) + '%' : '')) + '・砲長 ' + CAP_SET.map(function (k) { return CAPTAINS[k] ? CAPTAINS[k].name : '隨機'; }).join('／') + '・' + strikeText();
    crewShow(); roomsShow(); fitShow(CFG_ID, $('fitItems'), $('fitSum'));   // 換裝（72_fitui.js；TASK-0713）
  }
  lf.oninput = function () { C().ballast = Math.round(+lf.value); show(); };
  f.oninput = function () { C().flood = +f.value; show(); };
  sp.oninput = function () { C().speed = +sp.value; show(); };
  ag.oninput = function () { C().agile = +ag.value; show(); };
  uw.oninput = function () { C().upwind = +uw.value; show(); };
  $('base').oninput = function () { C().base = +$('base').value; show(); };
  $('pump').oninput = function () { C().pump = +$('pump').value; show(); };   // 基礎抽水量（噸／分；33_flood.js pumpK）   // 額外動力（31_sailing.js；設定鍵照舊叫 base）
  h.oninput = function () { C().hard = Math.round(LIM.hard[0] * Math.exp(h.value * hk) * 20) / 20; show(); };   // 倍率：0.05 一格（1 ＝ 只看材質）
  c.oninput = function () { STRIKE.cas = c.value / 100; show(); };
  gh.oninput = function () { GUN_HP = Math.round(+gh.value); show(); };
  gw.oninput = function () { C().gunw = +gw.value; show(); };
  sl.oninput = function () { SAIL_HP = Math.round(+sl.value); show(); };
  ph.oninput = function () { POWDER_HP = Math.round(+ph.value); show(); };
  bl.oninput = function () { BLAST_K = +bl.value; show(); };
  bv.oninput = function () { BLAST_V = Math.round(+bv.value) / 100; show(); };
  ch.oninput = function () { CREW_HP = Math.round(+ch.value); show(); };
  cd.oninput = function () { CREW_DEATH = Math.round(+cd.value); show(); };
  bx.oninput = function () { BOX_N = Math.round(+bx.value); show(); };
  cy.oninput = function () { CARRY_N = Math.round(+cy.value); show(); };
  dr.oninput = function () { DROWN_T = Math.round(+dr.value); show(); };
  var nr = $('navre'); nr.min = LIM.navre[0]; nr.max = LIM.navre[1];       // 尋路動態更新（TASK-0572）
  nr.oninput = function () { NAV_RE = +nr.value; show(); };
  var hl = $('heal'); hl.min = LIM.heal[0]; hl.max = LIM.heal[1];          // 醫療艙的治療時間（TASK-0568）
  hl.oninput = function () { HEAL_T = Math.round(+hl.value); show(); };
  var mk = $('musket'); mk.min = LIM.musket[0]; mk.max = LIM.musket[1];   // 火槍射程（TASK-0633）
  mk.oninput = function () { MUSKET_R = Math.round(+mk.value); show(); };
  var sf = $('sailfix'); sf.min = LIM.sailfix[0]; sf.max = LIM.sailfix[1];   // 帆匠補帆時間（TASK-0699）
  sf.oninput = function () { SAILFIX_T = Math.round(+sf.value); show(); };
  var bu = $('burn'); bu.min = LIM.burn[0]; bu.max = LIM.burn[1];       // 火勢（TASK-0717）
  bu.oninput = function () { BURN_PCT = Math.round(+bu.value); show(); };
  var ga = $('galley'); ga.min = LIM.galley[0]; ga.max = LIM.galley[1];   // 廚房加成（TASK-0720）
  ga.oninput = function () { GALLEY_PCT = Math.round(+ga.value); show(); };
  $('gcrew').onchange = function () { GUN_CREW_HURT = $('gcrew').checked; show(); };
  $('dbg').onchange = function () { DBG_SET = $('dbg').checked; show(); };   // Debug 模式（04_state.js dbgOn）：遊戲中也生效   // 砲被打飛 ⇒ 砲班跟著受傷（TASK-0568）
  st.oninput = function () { STALL_K = +st.value; show(); };
  whl.oninput = function () { WHEEL_LOSS = +whl.value; show(); }; rdl.oninput = function () { RUDDER_LOSS = +rdl.value; show(); }; dtq.oninput = function () { DIFF_K = +dtq.value; show(); }; fhl.oninput = function () { FUN.helmloss = +fhl.value; show(); }; fhe.oninput = function () { FUN.helmeff = +fhe.value; show(); }; fdf.oninput = function () { FUN.diff = +fdf.value; show(); };   // 操舵（TASK-0777，31_drive.js）
  se.oninput = function () { SEA_K = +se.value; show(); };
  fs.oninput = function () { FUN.speed = +fs.value; show(); }; fa.oninput = function () { FUN.agile = +fa.value; show(); }; fl.oninput = function () { FUN.stall = +fl.value; show(); }; fp.oninput = function () { FUN.powder = +fp.value; show(); }; fh.oninput = function () { FUN.hard = +fh.value; show(); };
  wk.oninput = function () { WIND_K = +wk.value; show(); };
  wc.oninput = function () { WIND_CAP = +wc.value; show(); };
  $('inertia').oninput = function () { DRV_INERTIA = +$('inertia').value; show(); }; $('turninert').oninput = function () { DRV_TURN = +$('turninert').value; show(); }; $('sailtq').oninput = function () { DRV_TQ = +$('sailtq').value; show(); };   // 每一步讀 ⇒ 遊戲中也能調          // 物理是每一步讀 ⇒ 遊戲中也能調（只管畫面）
  for (var r = 0; r < 3; r++) for (var k = 0; k < 3; k++) (function (r, k) {
    var el = am(r, k);
    el.oninput = function () { var v = parseFloat(el.value); if (isFinite(v)) { AMMO_K[r][k] = clamp(Math.round(v), AMMO_LIM[0], AMMO_LIM[1]); show(); } };
    el.onchange = function () { el.value = AMMO_K[r][k]; };          // 打了界外或空白 ⇒ 回到夾過的值
  })(r, k);
  ['guns', 'masts', 'officers'].forEach(function (k) { var b = $('st-' + k); b.onchange = function () { STRIKE[k] = b.checked; show(); }; });
  [0, 1].forEach(function (i) { var s = $('cap' + i); capOptions(s, CAP_SET[i]); s.onchange = function () { CAP_SET[i] = s.value; show(); }; });   // 砲長
  // 船隻設定：編輯哪一型 —— 跟編成同一個選船彈窗（72_shippick.js；選到還沒載的船 ⇒ 先載，壓艙物的預設要船型才算得出來）
  $('cfgShip').onclick = function () { spkOpen({ title: '船隻配置：編輯哪一型', cur: CFG_ID, pick: function (id) { CFG_ID = id; loadHull(CFG_ID).then(function () { put(); show(); }); put(); show(); } }); };
  fleetUI();                                                     // 主選單：艦隊編成
  // 細節設定那一頁：主選單 ⇄ 細節設定（同一個 #cover 裡兩張卡片，一次顯示一張）
  function page(w) { $('detail').style.display = w === 'det' ? '' : 'none'; gfxPanel(w === 'gfx'); $('phxp').style.display = w === 'phx' ? '' : 'none'; $('shipp').style.display = w === 'ship' ? '' : 'none'; $('gunp').style.display = w === 'gun' ? '' : 'none'; $('furnp').style.display = w === 'furn' ? '' : 'none'; $('keysp').style.display = w === 'keys' ? '' : 'none'; $('sndp').style.display = w === 'snd' ? '' : 'none'; if ($('wqp')) $('wqp').style.display = w === 'wq' ? '' : 'none'; if (w !== 'keys') KEY_WAIT = null; document.querySelector('#cover .card:not(#detail):not(#gfxp):not(#phxp):not(#shipp):not(#gunp):not(#furnp):not(#keysp):not(#sndp):not(#wqp)').style.display = w ? 'none' : ''; $('cover').scrollTop = 0; $('pgX').classList.toggle('on', !!w && !ADMIN_ROOMS); }   // w：'' 主選單、'det' 細節設定、'gfx' 畫質設定、'phx' 物理設定、'ship' 船隻配置、'gun' 砲的設定、'furn' 道具設定（67_furncfg.js）
  evOn('gfxov:back', function () { page(''); });                 // 畫質那一層（核心）在主選單按返回 ⇒ 回主選單
  [].forEach.call(document.querySelectorAll('#plays button'), function (b) { b.onclick = function () { setPlay(b.dataset.p); show(); }; });   // 主選單：玩法
  $('detB').onclick = function () { page('det'); };
  $('detX').onclick = function () { page(''); };
  $('gfxB').onclick = function () { page('gfx'); };
  $('phxB').onclick = function () { page('phx'); };
  $('phxX').onclick = function () { page(''); };
  $('shipB').onclick = function () { page('ship'); loadHull(CFG_ID).then(function () { put(); show(); }); };   // 船隻配置：先載那一型（砲數、桅數、壓艙物的預設要船型）
  if (ADMIN_DEF) admDefUI(page);                                 // 出廠預設值（?admin=defaults）：直接開細節設定頁
  if (ADMIN_ROOMS) {                                              // 甲板與艙房編輯器：後台開的分頁（TASK-0647；舊的 iframe 也認）
    $('shipB').onclick();
    var aw = admWin();
    if (aw) { try { aw.postMessage({ kind: 'cb-ready' }, location.origin); } catch (e) { /* 後台關了 */ } }
    else { var wn = document.createElement('p'); wn.className = 'admWarn'; wn.style.cssText = 'color:#f9a;margin:6px 0'; wn.textContent = '⚠ 找不到設定後台：要從設定後台最上面的「甲板與艙房編輯器…」開這一頁；直接開的改了也不會送回去'; $('shipp').insertBefore(wn, $('shipp').firstChild); }
  }
  $('shipX').onclick = function () { page(''); };
  $('gunB').onclick = function () { page('gun'); gunShow(); };   // 砲的設定（68_guncfg.js）
  // 天氣設定（TASK-0683；Tim 2026-10-17「或是開一個天氣設定頁(參考船隻設定) 可以設定不同天氣參數(大漩渦半徑 轉速 深度等放裡面)」）：描述表 08_weather.js WXK_ITEMS，整頁照 64_cfgkit.js cfgPage 生
  function wqBtn() { var b = $('wqB'), n = wxkChanged(); b.textContent = n ? '天氣設定（改過）…' : '天氣設定…'; b.className = n ? 'on' : ''; }
  var WQ = cfgPage({ id: 'wq', title: '天氣設定', sub: '暴風雨與大漩渦的參數（晴天不在這裡）。下一場開始生效；主選單背景的大漩渦馬上跟著變。',
    items: WXK_ITEMS, get: wxkGet, def: wxkDef, set: function (k, v) { wxkSet(k, v); wqBtn(); }, reset: function () { wxkReset(); wqBtn(); },
    kind: 'weather', file: 'blockside_weather', what: '天氣設定', back: function () { page(''); } });
  // 吸力讀數（Tim 2026-10-17「或是可以有一個頁面可調參數 來控制吸力變化」）：照現在的設定算各處的終端漂移（08_sea.js vxSuckV），改滑桿就跟著變
  var wqS = document.createElement('div'); wqS.className = 'row note'; wqS.id = 'wqSuck'; $('wqItems').appendChild(wqS);
  function wqSuck() { var o = WEATHERS.maelstrom.vortex; wqS.textContent = '吸力（靜止的船最後被拉多快）：' + [10, 50, 100, 200, 400].map(function (r) { return r + ' m ' + vxSuckV(o, r).toFixed(2); }).join('・') + ' m/s'; }
  [].forEach.call($('wqItems').querySelectorAll('input[type=range]'), function (r) { r.addEventListener('input', wqSuck); });
  $('wqB').onclick = function () { page('wq'); WQ.show(); wqSuck(); };
  wqBtn(); wqSuck();
  $('gunX').onclick = function () { page(''); };
  $('furnB').onclick = function () { page('furn'); furnShow(); };   // 道具設定（67_furncfg.js）
  $('furnX').onclick = function () { page(''); };
  $('keysB').onclick = function () { page('keys'); keysShow(); };   // 鍵位設定（66_keys.js）
  $('keysX').onclick = function () { page(''); };
  sndUI();                                                       // 聲音設定的滑桿與按鈕（主選單那一頁＋遊戲內設定面板，02_music.js）
  $('sndB').onclick = function () { page('snd'); sndShow(); };   // 聲音設定（02_music.js，TASK-0677）
  $('sndX').onclick = function () { page(''); };
  $('pgX').onclick = function () { RE.i = -1; show(); page(''); };   // 右上角的返回（每一頁同一顆）
  function shipReset(id) {                             // 一型回到預設：船員、艙房的擺法、換裝、壓艙物、性能
    delete SHIP_CREW[id]; delete SHIP_ROOMS[id]; delete PREF_BALLAST[id];
    if (SHIP_FIT[id]) { delete SHIP_FIT[id]; fitDirty(id); }            // 換裝回出廠（38_fit.js）：已經載好的船型丟掉重載
    var c = shipCfg(id); SHIP_KEYS.forEach(function (k) { c[k] = k === 'ballast' ? (HULLT[id] ? HULLT[id].ballast0 : undefined) : cfgBase(k, id); });
  }
  cfgKit('ship', {                                     // 那一排按鈕（64_cfgkit.js）；這一型回到預設按兩下（Tim：編起來很花時間 ⇒ 不要一按就沒了）
    one: { idle: '這一型回到預設', arm: function () { var hi = hullInfo(CFG_ID); return '再按一次：' + (hi ? hi.name : CFG_ID) + '的船員、艙房、換裝與性能都回到預設'; }, run: function () { shipReset(CFG_ID); } },
    all: { title: '船隻配置全部回到預設', body: '每一型船（不只正在看的這一型）的船員、艙房擺設、換裝、壓艙物與性能都回到預設。改過的會不見；要留的話先按「匯出…」。',
      run: function () {                               // 每一型（設定檔裡的船＋存檔裡有、這份成品沒有的）
        var ids = {}; CFG.ships.forEach(function (s) { ids[s.id] = 1; }); [SHIP_CFG, SHIP_CREW, SHIP_ROOMS, SHIP_FIT, PREF_BALLAST].forEach(function (m) { Object.keys(m).forEach(function (id) { ids[id] = 1; }); });
        Object.keys(ids).forEach(shipReset); return '已全部回到預設（' + CFG.ships.length + ' 型船）。';
      } },
    kind: 'ships', file: 'constitution_broadside_ships', expSay: '每一型的船員與性能', exp: function () { var o = shipsExport(); return { cfg: o.cfg, crew: o.crew, rooms: o.rooms, fit: o.fit }; },   // 69_prefs.js shipsExport（fit：換裝表，38_fit.js）
    imp: shipsImport, what: '船隻配置', unit: '型船', show: function () { put(); show(); }
  });
  $('allR').onclick = function () {                    // 主選單的全部回到預設：刪掉這台瀏覽器的存檔、重新載入 ⇒ 每一項都照程式與設定檔的預設（網址帶的參數照舊優先）
    askOk('全部回到預設', '主選單的選擇（模式、玩法、艦隊、航行、距離、天氣、畫質、物理效果）、細節設定、船隻配置、砲的設定、道具設定、鍵位，全部回到預設：這台瀏覽器裡的存檔會刪掉，頁面重新載入。要留的話先到各設定頁按「匯出…」。', '全部回到預設', function () {
      PREFS.write = false;                               // ⛔ 關頁時的自動存檔會把現在的設定又寫回去（69_prefs.js）
      try { window.localStorage.removeItem(PREFS_KEY); } catch (e) { /* 這一頁不能用 localStorage（畫廊彈窗）⇒ 本來就沒有存檔 */ }
      location.reload();
    });
  };
  askUI();                                             // 確認彈窗（65_ask.js）：⛔ 要比 keysUI 先掛（鍵盤的捕獲階段照掛的先後）
  gfxMenuUI(); phxUI(); gunUI(); gunShow(); furnUI(page); furnShow(); keysUI(page); keysShow();
  if (ADMIN_FURN) { page('furn'); furnShow(); }
  if (ADMIN_KEYS) { page('keys'); keysShow(); }                   // 鍵位的出廠預設值（?admin=keys）：直接開鍵位設定頁（66_keys.js keysAdmUI）                   // 道具的出廠預設值（?admin=furn）：直接開道具設定頁（67_furncfg.js furnAdmUI 接存檔、重建）
  $('detR').onclick = function () {                    // 重設預設值：LIM 的第三格、降旗全不勾
    // 船隻配置頁（每一型的船員與性能）不跟著重設：那一頁有自己的「這一型回到預設」（TASK-0570：編起來很花時間）
    GUN_HP = LIM.gunhp[2]; SAIL_HP = LIM.sailhp[2]; POWDER_HP = LIM.powderhp[2]; BLAST_K = LIM.blast[2]; BLAST_V = LIM.blastv[2]; CREW_HP = LIM.crewhp[2]; CREW_DEATH = LIM.crewdeath[2];
    BOX_N = LIM.box[2]; CARRY_N = LIM.carry[2]; WIND_K = LIM.wind[2]; WIND_CAP = LIM.windcap[2]; DRV_INERTIA = LIM.inertia[2]; DRV_TURN = LIM.turninert[2]; DRV_TQ = LIM.sailtq[2]; HANDS = LIM.hands[2]; DROWN_T = LIM.drown[2]; NAV_RE = LIM.navre[2]; HEAL_T = LIM.heal[2]; MUSKET_R = LIM.musket[2]; SAILFIX_T = LIM.sailfix[2]; BURN_PCT = LIM.burn[2]; GALLEY_PCT = LIM.galley[2]; GUN_CREW_HURT = true; DBG_SET = false;
    AMMO_K = AMMO_K0.map(function (r) { return r.slice(); });
    SEA_K = LIM.sea[2]; STALL_K = LIM.stall[2]; FUN.speed = LIM.funspeed[2]; FUN.agile = LIM.funagile[2]; FUN.stall = LIM.funstall[2]; FUN.powder = LIM.funpowder[2]; WHEEL_LOSS = LIM.wheelloss[2]; RUDDER_LOSS = LIM.rudderloss[2]; DIFF_K = LIM.difftq[2]; FUN.helmloss = LIM.funhelmloss[2]; FUN.helmeff = LIM.funhelmeff[2]; FUN.diff = LIM.fundiff[2];
    STRIKE.cas = LIM.cas[2]; STRIKE.guns = STRIKE.masts = STRIKE.officers = false; CAP_SET = ['random', 'random'];
    put(); show(); prefsReset();                         // 存檔跟著清（69_prefs.js：只剩主選單的選擇）
  };
  window.addEventListener('keydown', function (e) { if (!RUNNING && e.key === 'Escape' && ($('detail').style.display !== 'none' || gfxPanelOn() || $('phxp').style.display !== 'none' || $('shipp').style.display !== 'none' || $('gunp').style.display !== 'none' || $('furnp').style.display !== 'none' || ($('keysp').style.display !== 'none' && !KEY_WAIT))) page(''); });   // 鍵位設定頁正在等新鍵 ⇒ Esc 是取消（66_keys.js），不關頁
  put(); if (START_Q) yieldUI().then(show); else show();                // ?start=1：主選單的說明文字與船卡（show 約 0.03 s）晚一個工作再畫（不擠在載入頁面那一段）
  SLIDERS_SHOW = function () { put(); show(); };
  evOn('hullReload', function () { put(); show(); }, 0, true);           // 換裝改了、那一型重載好了（38_fit.js fitDirty）⇒ 卡片照新的船型畫
}
/** 主選單的畫質那一排（低／中／高／全開＋「畫質設定…」）：畫質頁本身是核心那一層（gfxUI）；這裡只接按鈕、照 cfg:gfx 點亮（TASK-0774）。 */
function gfxMenuUI() {
  [].forEach.call(document.querySelectorAll('#gfxs button[data-g]'), function (b) { b.onclick = function () { gfxSet(b.dataset.g); gfxShow(); }; });
  gfxMenuShow(gfxLevel());
}
function gfxMenuShow(lv) {
  [].forEach.call(document.querySelectorAll('#gfxs button[data-g]'), function (b) { b.className = b.dataset.g === lv ? 'on' : ''; });
  var gb = $('gfxB'); gb.textContent = lv === 'custom' ? '自訂（畫質設定…）' : '畫質設定…'; gb.className = lv === 'custom' ? 'on' : '';
}
evOn('cfg:gfx', gfxMenuShow);
/** 物理效果（09_phx.js）：主選單的全開／高／中／低、物理設定頁每一項的按鈕。帆與繩換到「關」或從「關」換出來 ⇒ setPhys（跟 B 鍵同一支）。 */
function phxUI() {
  var box = $('phxItems');
  box.innerHTML = PHX_ITEMS.map(function (it) {
    return '<div class="row"><label>' + it.name + '</label>' + it.opt.map(function (o, v) { return '<button data-k="' + it.k + '" data-v="' + v + '">' + o + '</button>'; }).join('') + '</div>' + (it.k === 'shipdmg' ? ramRows() : '');   // 碰撞傷害底下：它的數值（ramRows）
  }).join('') + '<div class="row"><label>物理減速</label><button data-pslow="0">關</button><button data-pslow="1">開（計算量大時放慢模擬）</button></div>'   // 不跟四檔走（73_slowmo.js PSLOW）
    + '<div class="row slide"><label for="pslowR">減速門檻</label><input type="range" id="pslowR" min="' + LIM.pslowb[0] + '" max="' + LIM.pslowb[1] + '" step="0.05" aria-label="模擬最多佔真實時間幾成，超過就放慢"><span id="pslowV"></span></div>';
  [].forEach.call(box.querySelectorAll('button[data-k]'), function (b) { b.onclick = function () { PHX[b.dataset.k] = +b.dataset.v; phxSync(); }; });
  [].forEach.call(box.querySelectorAll('button[data-pslow]'), function (b) { b.onclick = function () { if ((b.dataset.pslow === '1') !== PSLOW.on) pslowToggle(); }; });
  var pr = $('pslowR'); pr.oninput = function () { PSLOW.budget = Math.round(+pr.value * 100) / 100; phxShow(); };
  RAM_UI.forEach(function (u) { var el = $('ram_' + u.k); el.oninput = function () { RAM[u.k] = ramFrom(u, +el.value); phxShow(); }; });
  [].forEach.call(document.querySelectorAll('#phxs button[data-x], #phxPre button'), function (b) { b.onclick = function () { phxSet(b.dataset.x); phxSync(); }; });
  phxShow();
}
/** 碰撞傷害的數值（TASK-0652；Tim 2026-10-16：「數值可以開成設定頁面Slider嗎(開啟碰撞傷害後才顯示)」）：接在「碰撞傷害」那一列底下，開關關著 ⇒ 整塊藏起來（phxShow）。
 *  k ＝ RAM 的欄位、q ＝ 設定檔 lim 與網址的鍵、st ＝ 步長；txt ＝ 數值後面那一段說明；log ⇒ 滑桿照對數走（傷害倍率 0.2–100：Tim 2026-10-16「傷害倍率上限可以調整到100x嗎」—— 線性的話 1 附近幾乎調不動），數值照大小取整（< 2 每 0.05、< 10 每 0.1、< 30 每 0.5、其他每 1）。 */
var RAM_UI = [
  { k: 'v0', q: 'ramv', name: '撞擊門檻', st: 0.1, txt: function (x) { return x.toFixed(1) + ' m/s（約 ' + (x * 1.944).toFixed(1) + ' 節）：沿接觸方向接近得比這快才算撞擊'; } },
  { k: 'k', q: 'ramk', name: '撞擊傷害倍率', st: 0.01, log: true, txt: function (x) { return '× ' + (x < 10 ? x.toFixed(2) : x.toFixed(x < 30 ? 1 : 0)) + '：撞掉多少格（速度照物理，不跟著變）'; } },
  { k: 'e', q: 'rame', name: '彈力係數', st: 0.05, txt: function (x) { return x.toFixed(2) + (x ? '：撞完反彈（恢復係數；沿接觸方向彈回 ' + Math.round(x * 100) + '% 的接近速度、拿去撞壞的能量剩 ' + Math.round((1 - x * x) * 100) + '%）' : '：不反彈（完全非彈性，撞完一起走）'); } },   // Tim 2026-10-16：「是否可以有加彈力系數(撞擊後反彈)」
  { k: 'side', q: 'ramside', name: '側撞有效質量', st: 0.5, txt: function (x) { return '× ' + x.toFixed(1) + '：被側面撞的船沿接觸方向多難推動（水擋著橫向）；越大 ⇒ 撞人的那艘停得越乾脆'; } }];
/** 滑桿的位置 ⇄ 數值（log 那一條照 log10）。 */
function ramPos(u, x) { return u.log ? Math.log10(x) : x; }
function ramFrom(u, v) {
  var L = LIM[u.q]; if (!u.log) return clamp(Math.round(v / u.st) * u.st, L[0], L[1]);
  var x = Math.pow(10, v), s = x < 2 ? 0.05 : x < 10 ? 0.1 : x < 30 ? 0.5 : 1; return clamp(Math.round(x / s) * s, L[0], L[1]);
}
function ramRows() {
  return '<div id="ramBox">' + RAM_UI.map(function (u) { var L = LIM[u.q]; return '<div class="row slide"><label for="ram_' + u.k + '">' + u.name + '</label><input type="range" id="ram_' + u.k + '" min="' + ramPos(u, L[0]) + '" max="' + ramPos(u, L[1]) + '" step="' + (u.log ? 'any' : u.st) + '" aria-label="' + u.name + '"><span id="ram_' + u.k + 'V"></span></div>'; }).join('') + '</div>';
}
function phxShow() {
  var lv = phxLevel();
  [].forEach.call(document.querySelectorAll('#phxs button[data-x], #phxPre button'), function (b) { b.className = b.dataset.x === lv ? 'on' : ''; });
  var pb = $('phxB'); pb.textContent = lv === 'custom' ? '自訂（物理設定…）' : '物理設定…'; pb.className = lv === 'custom' ? 'on' : '';
  [].forEach.call(document.querySelectorAll('#phxItems button[data-k]'), function (b) { b.className = PHX[b.dataset.k] === +b.dataset.v ? 'on' : ''; });
  [].forEach.call(document.querySelectorAll('#phxItems button[data-pslow]'), function (b) { b.className = (b.dataset.pslow === '1') === PSLOW.on ? 'on' : ''; });
  $('pslowR').value = PSLOW.budget; $('pslowV').textContent = '模擬最多佔 ' + Math.round(PSLOW.budget * 100) + '% 的時間' + (PSLOW.budget === LIM.pslowb[2] ? '（預設）' : '') + '：越低越早放慢、畫面越順' + (PSLOW.on ? '' : '（物理減速關著）');
  $('phxLv').textContent = '現在：' + PHX_NAME[lv];
  if ($('ramBox')) { $('ramBox').style.display = PHX.shipdmg ? '' : 'none'; RAM_UI.forEach(function (u) { var x = RAM[u.k]; $('ram_' + u.k).value = ramPos(u, x); $('ram_' + u.k + 'V').textContent = u.txt(x) + (Math.abs(x - LIM[u.q][2]) < 1e-9 ? '（預設）' : ''); }); }
  if (typeof gsetShow === 'function') gsetShow();
}
/** 玩法：娛樂／寫實（04_state.js 的 PLAY）＋主選單按鈕的亮燈。航行每一步都讀（playK）；按鈕在主選單，沒開戰時才按得到。 */
function setPlay(p) { PLAY = p === 'real' ? 'real' : 'fun'; [].forEach.call(document.querySelectorAll('#plays button'), function (x) { x.className = x.dataset.p === PLAY ? 'on' : ''; }); }
/** 選單列船：HULL_LIST 的每一艘。 */
function hullOptions(sel, v) { sel.innerHTML = HULL_LIST.map(function (h) { return '<option value="' + h.id + '">' + h.name + '</option>'; }).join(''); sel.value = v; }
/** 主選單的艦隊編成（TASK-0537）：我方、敵方各一列，每艘一個選單；第二艘起有 ×（拿掉）；＋ 加一艘（照那一邊最後一艘的船型），合計到 MAX_SHIPS 就停用。
 *  我方第一艘 ＝ 我艦。改了就重建這兩列。 */
function fleetUI() {
  var full = FLEET_SET[0].length + FLEET_SET[1].length >= FLEET_MAX;
  [0, 1].forEach(function (s) {
    var box = $('fleet' + s), L = FLEET_SET[s];
    box.innerHTML = L.map(function (id, j) {
      var lab = s === 0 ? (j ? '友艦 ' + j : '我艦') : '敵艦 ' + (j + 1);
      var h = hullInfo(id);
      return '<span class="fs"><button class="fsb" data-s="' + s + '" data-j="' + j + '" aria-label="' + lab + '的船：' + (h ? h.name : id) + '（點了選船）" title="' + lab + '">' + (h ? h.name : id) + '</button>' + (j ? '<button class="fx" data-s="' + s + '" data-j="' + j + '" aria-label="拿掉' + lab + '">×</button>' : '') + '</span>';
    }).join('') + '<button class="fa" data-s="' + s + '" aria-label="' + (s ? '加一艘敵艦' : '加一艘友艦') + '"' + (full ? ' disabled' : '') + '>＋</button>';
    [].forEach.call(box.querySelectorAll('button.fsb'), function (b) {
      var j = +b.dataset.j;
      b.onclick = function () { spkOpen({ title: '選船：' + (s === 0 ? (j ? '友艦 ' + j : '我艦') : '敵艦 ' + (j + 1)), cur: L[j], pick: function (id) { pickShip(s, j, id); fleetUI(); } }); };
    });   // 選船彈窗（72_shippick.js；Tim 2026-10-18：下拉選單換成按鈕＋彈窗分類）
    [].forEach.call(box.querySelectorAll('button.fx'), function (b) { b.onclick = function () { L.splice(+b.dataset.j, 1); fleetUI(); pickShip(); }; });
    box.querySelector('button.fa').onclick = function () { if (FLEET_SET[0].length + FLEET_SET[1].length < FLEET_MAX) { L.push(L[L.length - 1]); fleetUI(); pickShip(); } };
  });
  var sp = fieldSplit(fleetSpec()), fb = sp.field.filter(function (f) { return f.team === 'blue'; }).length, fr = sp.field.length - fb;   // 開局誰上場（52_fleet.js）
  $('fleetN').textContent = FLEET_SET[0].length + ' 對 ' + FLEET_SET[1].length + (full ? '（編成上限 ' + FLEET_MAX + ' 艘）' : '') +
    (sp.reserve.blue.length || sp.reserve.red.length ? '　⇒ 開局 ' + fb + ' 對 ' + fr + ' 上場，候補 ' + sp.reserve.blue.length + '／' + sp.reserve.red.length + ' 艘（' + REINF_NAMES[REINF_MODE] + '）' : '');
}
/** 主選單換船（s 那一邊第 j 艘換成 id；不給 ⇒ 只是艘數變了）：還沒載的先載（開戰鈕暫時停用），載好就把背景的船換掉；細節設定跟著編輯我艦那一型。 */
function pickShip(s, j, id) {
  if (id) { FLEET_SET[s][j] = id; if (s === 0 && j === 0) CFG_ID = id; }
  var need = fleetHulls().filter(function (h) { return !HULLT[h]; });
  var go = $('go'); go.disabled = true; go.textContent = need.length ? '載入' + hullInfo(need[0]).name + '…' : '編隊中…';
  Promise.all(fleetHulls().map(loadHull)).then(function () {
    if (fleetHulls().some(function (h) { return !HULLT[h]; })) return;     // 又換了一艘、還在載
    go.disabled = false; go.textContent = '開戰';
    if (!RUNNING) reset();                                                  // 選單後面的兩艘換成選到的船
    if (SLIDERS_SHOW) SLIDERS_SHOW();
  }).catch(function (e) { go.textContent = '載不了：' + (e && e.message || e); console.error(e); });
}
// 外殼訂閱核心的事件（00_events.js；2026-10-21 核心與外殼拆兩包：核心不碰 #cover，主選單自己點亮、自己顯示）—— ⛔ 要在下一行 setWeather 之前訂好
evOn('boot:say', function (s) { $('load').textContent = s; });             // 載入的字（glFail、90_main.js loadSay）
if (BOOT.say) $('load').textContent = BOOT.say;                             // 訂閱之前就說過的（01_gl.js 開機就失敗）
evOn('boot:hull', function (s) { var go = $('go'); if (go.disabled) go.textContent = s; });   // 解析中：開戰鈕寫進度（設定照樣能調）
evOn('boot:loaded', function () { if (SLIDERS_SHOW && !START_Q) SLIDERS_SHOW(); });           // ?start=1：主選單不會出來 ⇒ 先不重畫（回到主選單時才補，coverShow）
evOn('boot:ready', function () { $('go').disabled = false; $('go').textContent = '開戰'; });
evOn('flow:start', function () { $('cover').style.display = 'none'; });   // 開戰、量測頁（70_flow.js uiAway）
evOn('flow:menu', coverShow);                                               // 回主選單（menuGo）
evOn('weather', function () { [].forEach.call(document.querySelectorAll('#wxs button'), function (b) { b.className = b.dataset.w === WX_ID ? 'on' : ''; }); });
evOn('phys', function () { if ($('phxB')) phxShow(); }, 0, true);          // 物理開關（62_simview.js 那一個之後）
evOn('pslow', function () { phxShow(); });                                  // 物理減速（73_slowmo.js pslowToggle）
evOn('cfg:phx', phxShow);                                                   // 物理檔位改了（phxSync）
$('repB').onclick = function () { errShow(null); };                         // 主選單「問題回報…」：手動回報（沒有錯誤訊息；01_gl.js errShow）
sliders(); setPlay(PLAY); setWeather(WX_ID);
[].forEach.call(document.querySelectorAll('#wxs button'), function (b) { b.onclick = function () { setWeather(b.dataset.w); if (SLIDERS_SHOW) SLIDERS_SHOW(); }; });   // 主選單：天氣（08_weather.js）
/** 主選單：同時在場（滑桿 2～MAX_SHIPS，52_fleet.js FIELD_N）；編成超過它的照候補規則進場。 */
function fieldShow() { var f = $('field'); f.value = FIELD_N; $('fieldV').textContent = FIELD_N + ' 艘'; if ($('fleetN')) fleetUI(); }
(function () { var f = $('field'); f.min = 2; f.max = MAX_SHIPS; f.oninput = function () { FIELD_N = Math.round(+f.value); fieldShow(); }; fieldShow(); })();
/** 細節設定：艦隊指揮官（52_fleet.js CMD_SIDE；策略在 53_commander.js）。 */
function cmdShow() { [].forEach.call(document.querySelectorAll('.cmds'), function (row) { [].forEach.call(row.querySelectorAll('button'), function (b) { b.className = b.dataset.c === CMD_SIDE[row.dataset.side] ? 'on' : ''; }); }); }
[].forEach.call(document.querySelectorAll('.cmds'), function (row) { [].forEach.call(row.querySelectorAll('button'), function (b) { b.onclick = function () { CMD_SIDE[row.dataset.side] = b.dataset.c; cmdShow(); }; }); });
cmdShow();
/** 細節設定：搶上風（52_fleet.js CMD_GAUGE；TASK-0679）每一方一顆開關。 */
function gaugeShow() { [].forEach.call(document.querySelectorAll('#gauges button'), function (b) { b.className = CMD_GAUGE[b.dataset.side] ? 'on' : ''; }); }
[].forEach.call(document.querySelectorAll('#gauges button'), function (b) { b.onclick = function () { CMD_GAUGE[b.dataset.side] = !CMD_GAUGE[b.dataset.side]; gaugeShow(); }; });
gaugeShow();
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
/** 細節設定：候補補位（52_fleet.js REINF_MODE）。 */
function reinfShow() { [].forEach.call(document.querySelectorAll('#reinfs button'), function (b) { b.className = b.dataset.r === REINF_MODE ? 'on' : ''; }); if ($('fleetN')) fleetUI(); }
[].forEach.call(document.querySelectorAll('#reinfs button'), function (b) { b.onclick = function () { REINF_MODE = b.dataset.r; reinfShow(); }; });
reinfShow();
/** 主選單：開局距離（滑桿，04_state.js LIM_DIST）。開局才用 ⇒ 改了下一場生效。 */
function distShow() { var d = $('dist'); d.value = DIST; $('distV').textContent = DIST + ' m（船頭到船頭）'; }
(function () { var d = $('dist'); d.min = LIM_DIST[0]; d.max = LIM_DIST[1]; d.oninput = function () { DIST = Math.round(+d.value); distShow(); }; distShow(); })();
[].forEach.call(document.querySelectorAll('#sails button'), function (b) { b.onclick = function () { setSailMode(b.dataset.s); }; });
[].forEach.call(document.querySelectorAll('#modes button'), function (b) { b.className = b.dataset.m === MODE ? 'on' : ''; });   // 模式的預設照設定檔（menu.mode）
setSailMode(SAIL); setCamTrack(true); $('physT').classList.toggle('on', PHYS);
$('go').onclick = start;
$('endC').onclick = function () { $('end').className = ''; };
$('endR').onclick = menuGo;
/** 回到主選單（'menu'、結束畫面的「主選單」）：?start=1 開場時沒照載好的船型重畫主選單（90_main.js：主選單不會出來 ⇒ 不佔開場）⇒ 第一次回來才補畫。 */
var COVER_LATE = START_Q;
function coverShow() { $('cover').style.display = ''; if (COVER_LATE && SLIDERS_SHOW) { COVER_LATE = false; SLIDERS_SHOW(); } }
// 訂閱（TASK-0669：模擬層只發事件，00_events.js）
evOn('playerTake', function () { KEYS.l = KEYS.r = false; });   // 玩家換船：按住的舵鍵放開（52_fleet.js playerTake）
