// ───────────────────────── 鏡頭 ─────────────────────────
var CAM = { fogK: 1, yaw: 2.2, pitch: 0.24, dist: 175, tgt: [0, 6, 0], eye: [0, 0, 0], vp: null, inv: null, mode: 4, follow: null, hold: 0, w: 1, h: 1, track: true, aoff: 0, pan: [0, 0], see: null };
/** 跟船的鏡頭看哪一艘：看敵艦（2）⇒ 我艦的目標；看我艦（3）⇒ CAM.see（詳細資訊的「🎥 看這艘」；Tim 2026-10-14）或我艦；追砲彈沒在追（1）⇒ 我艦。 */
function camShip() {
  var me = SHIPS[PLAYER_I];
  if (CAM.mode === 2) return foeOf(me) || me;
  if (CAM.mode === 3 && CAM.see && SHIPS.indexOf(CAM.see) >= 0) return CAM.see;
  return me;
}
/** 跟船的鏡頭的平移（右鍵拖曳、兩指拖曳；Tim 2026-10-14：拖完不要換成自由鏡頭）：CAM.pan ＝ [往船頭, 往右舷] 公尺，照那艘船的方向 ⇒ 船轉彎偏移跟著轉。換鏡頭（C）、重新開始 ⇒ 歸零。 */
function camPan(sh) { if (!sh || (!CAM.pan[0] && !CAM.pan[1])) return [0, 0, 0]; var F = fwd(sh.yaw); return [F[0] * CAM.pan[0] - F[2] * CAM.pan[1], 0, F[2] * CAM.pan[0] + F[0] * CAM.pan[1]]; }
var CAM_NAMES = ['自由鏡頭', '追砲彈', '看敵艦', '看我艦', '我艦→敵艦'];
var CAM_ORDER = [4, 0, 1, 2, 3];                 // C 鍵循環的順序：我艦→敵艦 → 自由 → 追砲彈 → 看敵艦 → 看我艦（開局預設，朝敵艦；70_flow.js）
// 畫面內插（Tim 2026-10-15：「60 fps 可是畫面一直抖動（鏡頭跟隨我艦）」）：模擬固定一步 DT，畫面每一格累積的時間有零頭 ⇒ 有的格跑 0 步、有的跑 2 步
//   （120 Hz 的手機 ⇒ 一格動一格不動），船一頓一頓地跳，鏡頭又是平滑跟著 ⇒ 船在畫面上抖。
//   ⇒ 鏡頭、畫、HUD 這一段（90_main.js frame）把每艘的矩陣、反矩陣、船心、航向換成「上一步 → 這一步」照 a ＝ 累積到下一步的比例內插的，畫完換回來。
//   ⛔ 只是畫面：模擬照舊用自己的（換回來之後才走下一步）。慢一步（最多 1／60 秒）是內插的代價。?lerp=0 ⇒ 不內插（對照）。
var LERP_ON = Q.get('lerp') !== '0';
function renderLerp(on, a) {
  SHIPS.forEach(function (sh) {
    if (!on) { if (sh.Ms) { sh.M = sh.Ms; sh.inv = sh.Is; sh.center = sh.Cs; sh.yaw = sh.Ys; sh.Ms = null; } return; }
    if (!LERP_ON || !sh.Mp || !(a < 1)) return;
    var M = new Float32Array(16), P = sh.Mp, N = sh.M, dy = Math.atan2(Math.sin(sh.yaw - sh.yawP), Math.cos(sh.yaw - sh.yawP));
    for (var i = 0; i < 16; i++) M[i] = P[i] + (N[i] - P[i]) * a;     // 一步之間轉得很少 ⇒ 逐格內插就夠（不重新正交化）
    sh.Ms = N; sh.Is = sh.inv; sh.Cs = sh.center; sh.Ys = sh.yaw;
    sh.M = M; sh.inv = M4.inv(M); sh.yaw = sh.yawP + dy * a; sh.center = shipCenter(sh);
  });
}
/** 有海圖（08_seabed.js）：鏡頭不鑽進地裡 —— 眼睛至少在那一點的地面／海底上 2 m（TASK-0721）。只動畫面，模擬不讀 CAM。 */
function camBed(e) { if (BED && BED.A) { var b = bedHgt(e[0], e[2]) + 2; if (e[1] < b) e[1] = b; } return e; }
// 轉場（Blocksail 地球儀 ⇄ 海戰，只有 ?map=@host；Tim 2026-10-19：「地球儀模式時攝影機拉近 … 逐漸靠近海面後就轉場戰鬥」「返回地球儀時也用轉場 鏡頭變成俯瞰 然後拉遠變回地球儀」）
//   CAM.tr ＝ { dir: 'in' | 'out', t, dur, H, hold }：
//   'in'  開戰時停在世界原點正上方 H 公尺、往下俯視、北朝上（跟地球儀那一張同一個方向 ⇒ 地球儀不用轉）；hold 到外面那一頁說 'go'，dur 秒降到平常的鏡頭，降的前六成轉到平常的鏡頭水平朝的方向。
//   'out' 從現在的鏡頭 dur 秒拉成我艦正上方 H 公尺俯視、停住，拉的後六成轉回北朝上；到了 ⇒ 告訴外面那一頁 'left'（我艦在哪），地球儀接著拉遠。
//   轉的那一段在這一頁（Tim 2026-10-20「移除地球儀階段的旋轉 改成在進入航海場景後才轉 離場也是先轉好再回地球儀」）；以前正上方那一張照平常的鏡頭方向、地球儀轉過來對齊。
//   只換畫面用的眼睛與矩陣：平常的鏡頭照樣每格算（CAM.trSave 存著、下一格先換回來）⇒ 降完接得上；模擬不讀 CAM。
function camUpdate(dt) {
  if (CAM.trSave) { CAM.eye = CAM.trSave[0]; CAM.look = CAM.trSave[1]; CAM.trSave = null; }
  camMove(dt);
  if (CAM.tr) camTrans(dt);
}
function camTrans(dt) {
  var T = CAM.tr, me = SHIPS[PLAYER_I];
  if (!T.hold) T.t = Math.min(T.dur, T.t + Math.min(dt, 0.05));
  var u = T.dur ? T.t / T.dur : 1, s = u * u * (3 - 2 * u), c;
  if (T.dir === 'in') { c = [0, 0, 0]; s = 1 - s; }                       // s：1 ＝ 正上方、0 ＝ 平常的鏡頭
  else { if (!T.c) T.c = me ? shipCenter(me).slice() : [0, 0, 0]; c = T.c; }
  var eN = CAM.eye, lN = CAM.look || c, h0 = Math.max(eN[1], 5);
  // 畫面上方朝哪（水平）：平常的鏡頭朝的方向（每格照現在的算；方位角 aF，北 0、順時針，東 ＝ +x、北 ＝ −z）⇄ 北，照 w 轉近的那一邊（w：1 ＝ 北）
  var fx = lN[0] - eN[0], fz = lN[2] - eN[2], aF = Math.hypot(fx, fz) > 1e-3 ? Math.atan2(fx, -fz) : 0;
  var w = T.dir === 'in' ? 1 - camTrEase(u / 0.6) : camTrEase((u - 0.4) / 0.6), aU = aF * (1 - w), g = [Math.sin(aU), -Math.cos(aU)];
  var eye = [eN[0] + (c[0] - eN[0]) * s, h0 * Math.pow(T.H / h0, s), eN[2] + (c[2] - eN[2]) * s];   // 高度照比例變（像地球儀的縮放）
  var look = [lN[0] + (c[0] - lN[0]) * s, lN[1] * (1 - s), lN[2] + (c[2] - lN[2]) * s];
  var up = [g[0] * s, 1 - s, g[1] * s], uL = Math.hypot(up[0], up[1], up[2]); up[0] /= uL; up[1] /= uL; up[2] /= uL;   // 越往上越朝 g ⇒ 正上方時畫面上方 ＝ g（交接那一張 ＝ 北）
  if (s > 0.999) { eye[0] = c[0]; eye[2] = c[2] + 0.01; }
  CAM.fogK = 1 - s * (1 - Math.min(1, 0.3 / (0.0016 * T.H)));           // 拉高時霧淡掉：正上方時從那個高度往下看大約剩兩成五（照原本的霧，1,200 m 就八成五是霧，看不到海）
  CAM.trSave = [CAM.eye, CAM.look]; CAM.eye = eye; CAM.look = look;
  var proj = M4.persp(0.9, CAM.w / CAM.h, 0.5, Math.max(5000, T.H * 1.5));
  CAM.vp = M4.mul(proj, M4.lookAt(eye, look, up)); CAM.inv = M4.inv(CAM.vp);
  if (T.t >= T.dur && !T.hold) {
    if (T.dir === 'in') { CAM.tr = null; CAM.fogK = 1; $('stage').classList.remove('trans'); }
    else if (!T.said) { T.said = true; bedHostSay('left', { x: c[0], z: c[2], tod: todNow(), hdg: camTransHdg(), shipHdg: me ? (Math.atan2(Math.cos(me.yaw), Math.sin(me.yaw)) * 180 / Math.PI + 360) % 360 : null }); }   // shipHdg：我艦船頭的方位角（fwd(yaw) ＝ [cos, 0, −sin] ⇒ 東 cos、北 sin）
  }
}
/** 轉場時模擬先不走（只有 ?map=@host；90_main.js frame）——地球儀上的船要跟這艘疊在一起，船不能先開走：
 *  · 開戰時鏡頭還停在正上方等外面那一頁說 'go'（Tim 2026-10-20「鏡頭降下前 先暫停模擬(確保重疊)」）：地球儀照 'started' 的位置與船頭擺船；
 *  · 回地球儀（'leave' 之後鏡頭往上拉，之後這一頁就關了）：'left' 報的是鏡頭開始拉時我艦在哪 ⇒ 拉的那兩秒船還在開，淡出時地球儀上的船差一截、跳一下（Tim 同一天「fadeout之前可以先把地球儀上船的位置對齊嗎」）。 */
function camTransHeld() { return !!(CAM.tr && (CAM.tr.dir === 'in' ? CAM.tr.hold : CAM.tr.dir === 'out')); }
/** 轉場時正上方那一張「畫面上方」的方位角（度；北 0、順時針）—— 一律北朝上 ⇒ 0（'started'、'left' 的 hdg 照舊帶，地球儀不用轉）。 */
function camTransHdg() { return 0; }
/** 轉場轉向的進度：0 ⇒ 1 慢進慢出（x 超出 0～1 ⇒ 夾住）。 */
function camTrEase(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
/** 外面那一頁叫的（08_seabed.js bedHostMsg）：'in' 開戰時先停在正上方；'go' 開始降；'out' 拉上去。 */
function camTransSet(dir, o) {
  if (dir === 'go') { if (CAM.tr && CAM.tr.dir === 'in') CAM.tr.hold = false; return; }
  CAM.tr = Object.assign({ dir: dir, t: 0, dur: dir === 'in' ? 2.6 : 2.2, H: BED && BED.A && BED.A.trH || 1200, hold: dir === 'in' }, o || {});   // 多高：海域的 trH（外面那一頁照離岸多遠給 ⇒ 看得到海岸線）
  $('stage').classList.add('trans');                                     // 介面先藏起來（降完才回來）
}
function camMove(dt) {
  if (FP.on && fpCam()) return;                                       // 第一人稱：鏡頭在船長的眼睛（81_fps.js）
  // 我艦→敵艦（預設，mode 4）：注視點 ＝ 我艦中心（略高），鏡頭在我艦背對敵艦的那一側 ⇒ 畫面中間是我艦、敵艦在它後方；
  // 兩艘繞著彼此轉時鏡頭跟著轉。拖曳改的是相對這條視線的角度（aoff）與俯仰，滾輪改遠近。沒有敵艦 ⇒ 看船頭方向。
  if (CAM.mode === 4 && SHIPS.length) {
    var m4 = SHIPS[PLAYER_I], f4 = foeOf(m4), c4 = shipCenter(m4), fc = f4 && shipCenter(f4);   // 照現在（內插過）的矩陣算（⛔ .center 是模擬那一步存的）
    var a4 = fc && Math.hypot(fc[0] - c4[0], fc[2] - c4[2]) > 1 ? Math.atan2(fc[2] - c4[2], fc[0] - c4[0]) : Math.atan2(-Math.sin(m4.yaw), Math.cos(m4.yaw));
    var o4 = camPan(m4), y4 = a4 + Math.PI + CAM.aoff, t4 = [c4[0] + o4[0], c4[1] + 4, c4[2] + o4[2]];
    var e4 = [t4[0] + Math.cos(y4) * Math.cos(CAM.pitch) * CAM.dist, t4[1] + Math.sin(CAM.pitch) * CAM.dist, t4[2] + Math.sin(y4) * Math.cos(CAM.pitch) * CAM.dist];
    var e4s = seaH(e4[0], e4[2], SIMT) + 1.5; if (e4[1] < e4s) e4[1] = e4s;          // 鏡頭不鑽到浪底下
    camBed(e4);
    var k4 = CAM.snap ? 1 : 1 - Math.exp(-dt * 4); CAM.snap = false;
    CAM.eye = camBed(lerp3(CAM.eye, e4, k4)); CAM.look = lerp3(CAM.look || t4, t4, k4); CAM.trMe = CAM.trYaw = null;
    var pr4 = M4.persp(0.9, CAM.w / CAM.h, 0.5, 5000); CAM.vp = M4.mul(pr4, M4.lookAt(CAM.eye, CAM.look, [0, 1, 0])); CAM.inv = M4.inv(CAM.vp);
    return;
  }
  // 鏡頭跟船（預設；V 關掉 ⇒ 固定在世界上）：跟著那艘移動、旋轉 —— 拖曳改的是相對船頭的角度、偏移與遠近。
  // 自由鏡頭的注視點照我艦平移＋繞我艦中心轉；鏡頭角度跟著被看的那艘轉（看敵艦 ⇒ 敵艦，其他 ⇒ 我艦）。
  // ⛔ 跟兩艘的中點：兩艘繞著中點轉圈 ⇒ 中點幾乎不動，看起來像沒在跟。
  // 角度慣例：鏡頭 yaw 是 (x, z) 平面上 atan2(z, x)；船頭方向的這個角 ＝ −sh.yaw ⇒ 船 yaw 增 Δ，鏡頭 yaw 減 Δ。
  // 只有我艦一艘（⛵ 航海、🔨 建造）也跟（Tim 2026-10-20「目前看我艦 有時候鏡頭不會跟著轉(偶發)」：以前要 2 艘以上 ⇒ 航海模式船轉、鏡頭一直不轉）。
  if (SHIPS.length && CAM.track) {
    var me = SHIPS[PLAYER_I], mc = shipCenter(me);
    if (CAM.trMe) {
      var d0 = -(me.yaw - CAM.trMe.yaw), c0 = Math.cos(d0), s0 = Math.sin(d0), ox = CAM.tgt[0] - CAM.trMe.c[0], oz = CAM.tgt[2] - CAM.trMe.c[2];
      CAM.tgt[0] = mc[0] + ox * c0 - oz * s0; CAM.tgt[2] = mc[2] + ox * s0 + oz * c0;
    }
    CAM.trMe = { yaw: me.yaw, c: mc.slice() };
    var ts = camShip() || me;
    if (CAM.trYaw && CAM.trYaw.i === ts.i) CAM.yaw -= ts.yaw - CAM.trYaw.yaw;
    CAM.trYaw = { i: ts.i, yaw: ts.yaw };
  } else CAM.trMe = CAM.trYaw = null;
  var tgt = CAM.tgt, dist = CAM.dist, yaw = CAM.yaw, pitch = CAM.pitch, eye;
  if (CAM.mode === 1 && CAM.follow) {
    var b = CAM.follow, vd = norm(b.v);
    eye = camBed(add(sub(b.p, mul(vd, 9)), [0, 2.2, 0])); tgt = add(b.p, mul(vd, 25));
    CAM.eye = camBed(lerp3(CAM.eye, eye, 1 - Math.exp(-dt * 10))); CAM.look = lerp3(CAM.look || tgt, tgt, 1 - Math.exp(-dt * 10));
  } else {
    if (CAM.mode >= 1 && CAM.mode <= 3) { var sh = camShip(); if (sh) tgt = add(shipCenter(sh), camPan(sh)); }   // 追砲彈沒有在追的 ⇒ 跟看我艦一樣
    eye = [tgt[0] + Math.cos(yaw) * Math.cos(pitch) * dist, tgt[1] + Math.sin(pitch) * dist, tgt[2] + Math.sin(yaw) * Math.cos(pitch) * dist];
    var eys = seaH(eye[0], eye[2], SIMT) + 1.5; if (eye[1] < eys) eye[1] = eys;
    camBed(eye);
    var k = CAM.snap ? 1 : 1 - Math.exp(-dt * 6); CAM.snap = false;
    CAM.eye = camBed(lerp3(CAM.eye, eye, k)); CAM.look = lerp3(CAM.look || tgt, tgt, k);
  }
  var proj = M4.persp(0.9, CAM.w / CAM.h, 0.5, 5000), view = M4.lookAt(CAM.eye, CAM.look, [0, 1, 0]);
  CAM.vp = M4.mul(proj, view); CAM.inv = M4.inv(CAM.vp);
}
// 追砲彈（mode 1；Tim 2026-10-13）：只追我艦打的（觀戰也是）；追著的那顆打中或落水才換（落點停 1.2 秒，CAM.hold）。
//   挑下一顆的時機：這輪齊射打完（最新那顆飛了 BALL_SETTLE 秒）或最舊那顆飛了 BALL_WAIT 秒（連續開火時不等到天荒地老）；
//   挑哪顆：照現在的位置與速度往前推算（重力、打水漂同 stepBall；敵艦照現在的船速平移），會打中敵艦的優先、其中離命中最久的那顆；
//   都不中 ⇒ 只追剛開出去的（飛不到 BALL_FRESH 秒）；連這也沒有 ⇒ 落點停完就回去看我艦（CAM.follow ＝ null，鏡頭照看我艦平滑移過去），等下一輪
//   （⛔ 追一顆快落水的不中彈 ⇒ 看不到東西；⛔ 停在落點等 ⇒ 不開砲就一直看著水面，Tim 2026-10-13）。
//   每顆只推算一次（BALL_PRED；一次最多約 20 ms，⛔ 每一格重算會卡）。
//   ⛔ 以前每開一砲就切到新那顆 ⇒ 齊射時鏡頭一直跳、追的那顆還沒打中就換掉；觀戰還會追到敵艦的砲彈。
//   只在畫面這一層跑（frame），不抽 rnd()、不改狀態 ⇒ 戰局不受影響。
var BALL_SETTLE = 0.25, BALL_WAIT = 1.2, BALL_FRESH = 0.6, BALL_PRED = new WeakMap();
/** 砲彈 b 照現在的速度飛下去，幾秒後打中別艘（格或模型；開砲那艘以外最早打中的那艘）；不會中 ⇒ null。 */
function ballPredict(b) {
  var best = null;
  SHIPS.forEach(function (o) { if (o.i === b.owner) return; var t = ballPredictOn(b, o); if (t !== null && (best === null || t < best)) best = t; });
  return best;
}
function ballPredictOn(b, foe) {
  if (!foe || !foe.center || !foe.inv || foe.sunk) return null;
  var p = b.p.slice(), v = b.v.slice(), bounced = b.bounced, h = 1 / 1500, M = foe.inv, c = foe.center, fv = foe.vel || [0, 0, 0], g = foe.grid;
  for (var t = 0; t < 12 - b.age; t += h) {                            // 每步約 0.1 m（初速 175 m/s）
    v[1] -= G * h; p[0] += v[0] * h; p[1] += v[1] * h; p[2] += v[2] * h;
    var sea = seaH(p[0], p[2], SIMT + t);
    if (p[1] < sea) {
      var sp = len(v);
      if (b.ammo === 0 && !bounced && Math.asin(-v[1] / sp) < 0.11 && sp > 90) { v[1] = -v[1] * 0.45; v[0] *= 0.7; v[2] *= 0.7; p[1] = sea + 0.01; bounced = true; continue; }
      return null;
    }
    var x = p[0] - fv[0] * t, y = p[1], z = p[2] - fv[2] * t, dx = x - c[0], dy = y - c[1], dz = z - c[2];   // 換到敵艦「現在」的座標（它照船速平移）
    if (dx * dx + dy * dy + dz * dz > foe.rad2) continue;
    var L = [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]];
    if (g.get(L[0] | 0, L[1] | 0, L[2] | 0) || hitModel(foe, L, b.ammo === 2 ? 10 : 1.5, null) || (foe.arm && armAt(foe, L))) return t;   // armAt：砲帶的裝甲（24_armor.js）
  }
  return null;
}
/** 每一格（frame）：追著的那顆沒了 ⇒ 落點停 CAM.hold 秒；之後挑下一顆，沒有就看我艦。debug：__game.camFollow(dt) 手動推進（預覽窗格在背景時 rAF 會停）。 */
function camFollow(dt) {
  if (CAM.mode !== 1) return;
  var f = CAM.follow;
  if (f && f.alive) return;                                            // 追著的那顆還在飛 ⇒ 不換
  if (f && CAM.hold > 0) { CAM.hold -= dt; return; }                   // 落點停一下（50_sim.js 在那顆沒了的時候設）
  CAM.follow = pickBall();                                             // 沒有值得追的 ⇒ null（回去看我艦）
}
/** 下一顆要追的砲彈（還不到挑的時候 ⇒ null）。 */
function pickBall() {
  var mine = BALLS.filter(function (b) { return b.alive && b.owner === PLAYER_I; });
  if (!mine.length) return null;
  var young = 1e9, old = 0; mine.forEach(function (b) { young = Math.min(young, b.age); old = Math.max(old, b.age); });
  if (young < BALL_SETTLE && old < BALL_WAIT) return null;             // 這輪齊射還在開
  var best = null, bt = -1, fresh = null;
  mine.forEach(function (b) {
    if (!BALL_PRED.has(b)) BALL_PRED.set(b, { at: b.age, t: ballPredict(b) });
    var pr = BALL_PRED.get(b), left = pr.t === null ? null : pr.t - (b.age - pr.at);   // 離命中還有幾秒
    if (left !== null && left > 0.05 && left > bt) { bt = left; best = b; }
    if (b.age < BALL_FRESH) fresh = b;
  });
  CAM.pick = { n: mine.length, hit: !!best, t: best ? +bt.toFixed(2) : null };   // 讀數（__game.camera）
  return best || fresh;
}
// 訂閱（TASK-0669：模擬層只發事件，00_events.js）
evOn('ballGone', function (b) { if (CAM.follow === b) CAM.hold = 1.2; }, 0, true);   // 跟著的那顆落地或打中 ⇒ 停 1.2 秒再回來（50_sim.js step）
evOn('playerTake', function (nw) { CAM.trMe = CAM.trYaw = null; if (CAM.see === nw) CAM.see = null; }, 0, true);   // 玩家換船（52_fleet.js playerTake）：跟船的角度重算；正在「🎥 看著」那艘 ⇒ 改成看我艦那一種（就是它）
/** 遠的船、鏡頭外的船：帆與繩的物理隔幾步才算一次（30_rig_physics.js rigFarM 問的；RIG_FAR 在那裡、照 PHX.rigfar）。TASK-0669 從 30 搬來：只有鏡頭知道離多遠、看不看得到。 */
function camRigFar(sh) { return camFarM(sh, RIG_FAR[PHX.rigfar]); }
/** 遠的船、鏡頭外的船：船員隔幾步才走一次（50_sim.js simFarM 問的；SIM_FAR 在那裡、同一個設定 PHX.rigfar；TASK-0802）。 */
function camSimFar(sh) { return camFarM(sh, SIM_FAR[PHX.rigfar]); }
/** 這艘離鏡頭多遠、在不在畫面裡（外接球大概碰到畫面）；鏡頭還沒算過（快轉、無頭對拍）⇒ null。 */
function camShipSee(sh) {
  var e = CAM.eye, vp = CAM.vp; if (!e || !vp) return null;
  var B = sh.T.base, R = 0.5 * S * Math.hypot(B.sx, B.sy, B.sz), c = M4.pt(sh.M, B.sx / 2, B.sy / 2, B.sz / 2), d = Math.hypot(c[0] - e[0], c[1] - e[1], c[2] - e[2]);
  var cw = vp[3] * c[0] + vp[7] * c[1] + vp[11] * c[2] + vp[15], vis = d < R;
  if (!vis && cw > 0.1) { var k = 1 + 2 * R / cw, x = (vp[0] * c[0] + vp[4] * c[1] + vp[8] * c[2] + vp[12]) / cw, y = (vp[1] * c[0] + vp[5] * c[1] + vp[9] * c[2] + vp[13]) / cw; vis = Math.abs(x) < k && Math.abs(y) < k; }   // 外接球大概碰到畫面
  return { d: d, vis: vis };
}
/** 照表 F 給倍率：離鏡頭 d1 以內 1、d1–d2 m1、d2 以外 m2；整艘不在畫面裡 ⇒ 至少 off。表沒給、鏡頭還沒算過 ⇒ 1。 */
function camFarM(sh, F) { var v = F ? camShipSee(sh) : null; if (!v) return 1; var m = v.d > F.d2 ? F.m2 : v.d > F.d1 ? F.m1 : 1; return v.vis ? m : Math.max(m, F.off); }
/** 帆與繩要不要算（30_rig_physics.js physFrame 問的；TASK-0802，Tim 2026-10-22「畫面外的布凍結」）：整艘不在畫面裡 ⇒ 不算；設定「遠方帆繩、船員」照常、鏡頭還沒算過 ⇒ 照算。 */
function camRigSeen(sh) { if (!PHX.rigfar) return true; var v = camShipSee(sh); return !v || v.vis; }
evAnswer('rigFar', camRigFar, true);
evAnswer('simFar', camSimFar, true);
evAnswer('rigSeen', camRigSeen, true);

// ── 鏡頭只由這一支檔寫（TASK-0669 ③；以前輸入、開局、HUD、慢動作、第一人稱、測試場 9 支檔直接寫 CAM）：其他檔要動鏡頭 ⇒ 叫下面這些；admin.py 建置擋別的檔直接寫 CAM。
/** 開局（70_flow.js reset）：鏡頭擺到開局的位置；?cam= 給了 ⇒ 那個固定機位。 */
function camStart() {
  CAM.mode = 0; CAM.follow = null; CAM.trMe = CAM.trYaw = null; CAM.pan = [0, 0]; CAM.see = null; CAM.dist = DIST * 1.05 + 40; CAM.tgt = [0, 8, 0]; CAM.yaw = 2.2; CAM.pitch = 0.22; CAM.snap = true;
  if (!CAMQ) {                                                         // 預設：看我艦（鎖定我艦、拖曳自己轉），開局那一刻擺在我艦背對敵艦那一側 ⇒ 朝敵艦看（Tim 2026-10-15；以前是「我艦→敵艦」一直跟著兩艘的連線轉）
    var cm = SHIPS[PLAYER_I], cf = cm && foeOf(cm), a0 = cm && cf ? Math.atan2(cf.center[2] - cm.center[2], cf.center[0] - cm.center[0]) : 0;
    CAM.mode = 3; CAM.yaw = a0 + Math.PI + 0.35; CAM.aoff = 0.35; CAM.dist = 78; CAM.pitch = 0.2;   // ?cam= 給了 ⇒ 那個固定機位
  }
  if (CAMQ === 'close') { CAM.dist = 85; CAM.tgt = [10, 9, -DIST / 2 + 12]; CAM.yaw = 1.95; CAM.pitch = 0.16; }
  if (CAMQ === 'blue') { CAM.dist = 88; CAM.tgt = [4, 12, DIST / 2 - 10]; CAM.yaw = -1.8; CAM.pitch = 0.15; }
  if (CAMQ === 'deck') { CAM.mode = 4; CAM.aoff = +(Q.get('aoff') || 0.3); CAM.dist = +(Q.get('dist') || 56); CAM.pitch = +(Q.get('pitch') || 0.3); }   // 縮圖：跟著我艦、近一點高一點 ⇒ 看得到甲板上的人
  if (CAMQ === 'high') { CAM.dist = DIST + 120; CAM.yaw = 2.5; CAM.pitch = 0.62; }
}
/** 平移（右鍵拖曳、兩指拖曳）：鏡頭照原本的（Tim 2026-10-14：⛔ 以前一拖就換成自由鏡頭）。dx／dy ＝ 螢幕像素。
 *  自由鏡頭 ⇒ 移注視點；跟船的鏡頭 ⇒ 移 CAM.pan（相對那艘船的方向，03_camera.js camPan）。追砲彈正在追 ⇒ 不動。 */
function camPanBy(dx, dy) {
  var fw = norm([CAM.look[0] - CAM.eye[0], 0, CAM.look[2] - CAM.eye[2]]), rt = [-fw[2], 0, fw[0]], k = CAM.dist * 0.0018, d = add(mul(rt, -dx * k), mul(fw, dy * k));
  if (CAM.mode === 0) { CAM.tgt = add(CAM.tgt, d); return; }
  if (CAM.mode === 1 && CAM.follow) return;
  var sh = camShip(); if (!sh) return;
  var F = fwd(sh.yaw); CAM.pan[0] += d[0] * F[0] + d[2] * F[2]; CAM.pan[1] += -d[0] * F[2] + d[2] * F[0];
}
/** 轉（左鍵拖曳；71_input.js）：dx／dy ＝ 螢幕像素。追砲彈 ⇒ 換成自由鏡頭；我艦→敵艦 ⇒ 轉偏角。 */
function camOrbit(dx, dy) { if (CAM.mode === 1) CAM.mode = 0; if (CAM.mode === 4) CAM.aoff += dx * 0.006; else CAM.yaw += dx * 0.006; CAM.pitch = clamp(CAM.pitch + dy * 0.005, 0.02, 1.45); }
/** C 鍵：照 CAM_ORDER 換下一種鏡頭。 */
function camCycle() { CAM.mode = CAM_ORDER[(CAM_ORDER.indexOf(CAM.mode) + 1) % CAM_ORDER.length]; CAM.follow = null; CAM.pan = [0, 0]; CAM.see = null; if (CAM.mode === 2 || CAM.mode === 3) { CAM.dist = 75; } else if (CAM.mode === 0) CAM.dist = DIST + 40; else if (CAM.mode === 4) { CAM.dist = 78; CAM.aoff = 0.35; } }
/** 「🎥 看這艘」（詳細資訊的標題列；Tim 2026-10-14）：鏡頭換成看那一艘（看我艦那一種：跟著它、繞著它轉，拖曳、平移、縮放照舊）；資訊不收。按 C 換鏡頭 ⇒ 回到照常的循環。 */
function camSee(o) { if (!o) return; CAM.mode = 3; CAM.follow = null; CAM.pan = [0, 0]; CAM.see = o.i === PLAYER_I ? null : o; CAM.dist = 75; CAM.trYaw = null; }
/** 畫面大小（60_render.js resize）：場景照這個大小畫。 */
function camSize(w, h) { CAM.w = w; CAM.h = h; }
/** 一次寫好幾格（照給的順序一個一個寫）：慢動作的特寫與還原、第一人稱、測試場、主控台 __game.cam。 */
function camSet(o) {
  for (var k in o) CAM[k] = o[k];
  if ('track' in o && $('camT')) $('camT').classList.toggle('on', !!o.track);   // 🎥 跟船那一顆照實際的（殉爆特寫也會關跟船 —— 以前只有 V／那一顆會改燈 ⇒ 特寫把跟船關掉、燈還亮著）
}
