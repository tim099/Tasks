// ───────────────────────── 海浪（TASK-0522） ─────────────────────────
// 物理與畫面共用同一組浪（WAVES）：水面高度 h(x, z, t) ＝ SEA_K × Σ a·sin(kx·x ＋ kz·z − ω·t ＋ φ)，深水色散 ω ＝ √(g·k)。
//   浪向跟著風（WIND，開局固定）：主浪順風，其他幾道偏一點 ⇒ 海面不會整片一條一條。SEA_K ＝ 細節設定的「浪」（0 ＝ 平靜的海）。
//   WAVES 照載入時的風（WIND0）建一次；每一場開局的風向不同（08_weather.js windInit）⇒ 整組浪跟著轉 SEA_A（rad）：
//   水面高度在 p 點 ＝ 原本那組浪在「p 反轉 SEA_A」那一點的高度、坡度再轉回來。SEA_A ＝ 0 ⇒ 跟以前逐位元組相同。
//   著色器是同一個轉法（uniform uSeaA，setCommon 給；⛔ 沒給的程式預設 0 ＝ 不轉，浪不會塌）。
var SEA_A = 0;
// 用到水面高度的（seaH）：砲彈落水與打水漂（21_gunnery.js；03_camera.js 的推算）、碎片與斷開的一團浮沉（12／21／22）、
//   落水的人（40）、垂到水裡的繩（30）、航跡（31）、船的起伏與搖晃（stepWaves，32_hull.js 每步呼叫）。
// 船的起伏：船底 5（船長）× 2（兩舷）個點的水面擬合一個平面 ⇒ 平均高度、縱向坡度、橫向坡度，彈簧阻尼跟過去（船有慣性）。
//   短浪在 54 m 的船長上被平均掉，長浪才搖得動船。sh.wl ＝ 船底的平均水面（絕對高度）、sh.bob ＝ 船身相對它的起伏（彈簧的落後量）
//   ⇒ 進水、電腦瞄水線那些「水線在船上的哪一層」照舊用 sink − lift − bob（相對的），船的矩陣多加 sh.wl（10_ship.js shipMatrix）。
// 畫面（60_render.js 的海面網格）頂點照同一個 h 位移，法線在片段裡照解析的坡度算；細的漣漪只在法線裡、跟畫質走 ——
//   ⛔ 漣漪不進物理 ⇒ 畫質不改戰局。⛔ 相位寫死、不抽 rnd() ⇒ 浪不打亂亂數的順序。
// 七道：波長之間不是整數比、方向左右交錯（⛔ 四道整齊的浪 ⇒ 海面一格一格的重複紋路，Tim 2026-10-13）
var WAVES = [                                   // a 振幅（m，再乘 SEA_K）、L 波長（m）、d 偏離風向幾度、ph 相位
  { a: 0.40, L: 78, d: 0, ph: 0.0 },              // 主浪（週期 7.1 秒）：搖得動整艘船
  { a: 0.24, L: 51, d: 31, ph: 1.7 },
  { a: 0.19, L: 37, d: -23, ph: 4.1 },
  { a: 0.12, L: 26.5, d: 52, ph: 2.3 },
  { a: 0.09, L: 19, d: -61, ph: 5.2 },
  { a: 0.06, L: 13.3, d: 14, ph: 0.9 },
  { a: 0.04, L: 9.1, d: -38, ph: 3.6 }];          // 最短的：船上感覺不到，只看得到
(function () {
  var wa = Math.atan2(WIND[2], WIND[0]);
  WAVES.forEach(function (w) { var k = 2 * Math.PI / w.L, a = wa + w.d * Math.PI / 180; w.kx = Math.cos(a) * k; w.kz = Math.sin(a) * k; w.w = Math.sqrt(G * k); });
})();
// ───────────────────────── 大漩渦（TASK-0683） ─────────────────────────
// Tim 2026-10-17：「是否能做出加勒比海盜3中的大漩渦天候」「暴風雨+海中央大漩渦(在敵我中間)」。只有天氣「大漩渦」（08_weather.js maelstrom 的 vortex）有；
//   其他天氣 VX ＝ null ⇒ 每一處都走原本那一條（晴天、暴風雨逐位元組不變）。⛔ 不抽 rnd()。
// 中心 ＝ 世界原點（兩隊正中間）。大小、深度、水流照天氣設定頁（08_weather.js WXK_ITEMS；Tim 2026-10-17「半徑再放大2倍 然後更深一點 水流快一些」
//   「或是開一個天氣設定頁(參考船隻設定) 可以設定不同天氣參數」）：水流最快的那一圈 rv（預設 190 m；開局兩隊就排在這一圈上，52_fleet.js vxPlace）。
//   ⚠ 以前 rv 照開局距離（DIST/2 ＋ 25，預設 95）；現在是設定頁的公尺數，跟開局距離無關。
// 地形（進 seaH ⇒ 物理與畫面同一個式子；著色器在下面 SEA_GLSL 的 vxH／vxG）：h ＝ −D·rc²／(r² ＋ rc²) —— 中間深 D，往外照 1/r² 淡掉（不用截斷：1 km 外剩幾公分）。
//   rc ＝ 寬窄 × rv。預設（rv 190、D 75、寬窄 0.6）：開局的船（r 190）水面 −20 m、坡度 9°；最陡在 r ＝ rc/√3（23°）。
//   船：船底十個點擬合一個平面（stepWaves）⇒ 自己沉進漏斗、往內側傾，不用另外寫。
// 水流（不改水面，帶著東西走：船 31_sailing.js、碎片 22_pieces.js、落水的人 43_swim.js）：從上往下看逆時針繞中心，
//   切向 v_t ＝ V·2q／(1 ＋ q²)（q ＝ r／rv：在 rv 最快 V、往外照 1/r 淡掉），再往中心吸 inflow × v_t。
// 眼（r < eye，預設 42 m）：船被往下拖、像進水一樣慢慢吃水，吃到 4.2 m 才開始沉（vxDrag；⛔ 以前一進眼就判開始沉 ⇒ 我艦馬上換下一艘）。
var VX = null;
/** 開局（70_flow.js reset）、換天氣（setWeather）、天氣設定頁改了：照天氣的 vortex 建漩渦；天氣沒有 vortex ⇒ null。
 *  vortex：r 半徑（m）、depth 深度（m）、width 寬窄（rc ／ r）、v 水流（節）、inflow 往中心吸（切向的幾成）、eye 眼（m，最多 0.8 r）。 */
function vxInit() {
  var o = WX.vortex; if (!o) { VX = null; bedVxSync(); return; }   // 海圖照漩渦重烤（08_seabed.js；沒有海圖、漩渦沒變 ⇒ 什麼都不做）
  var rv = o.r, rc = o.width * rv;
  VX = { rv: rv, rc2: rc * rc, D: o.depth, V: o.v / 1.9438, IN: o.inflow, re: Math.min(o.eye, 0.8 * rv), pull: o.pull, gulp: o.gulp || 0, hold: o.hold || 0, eyeSuck: o.eyeSuck || 0, grav: o.grav, suck: o.suck, suckR: o.suckR, suckP: o.suckP, turn: o.turn, spin: (o.spin || 0) * Math.PI / 180, aiR: o.aiR || 0 };   // aiR：電腦避開半徑（54_helm.js vxAvoid）
  VX.De = o.eyeDepth; VX.re2 = VX.re * VX.re; VX.trap = VX.re;   // 逃不掉的範圍 ＝ 眼（Tim：「逃不掉範圍 不用特別設定」；31_drive.js 上坡減免只在這一圈外）   // 眼的喉部：再往下 De（寬 ＝ 眼的半徑）
  VX.r0min = 3 * VX.re;                           // 開局最近離中心多遠（52_fleet.js vxPlace：照主選單的距離排；Tim「起始可以在漩渦中」）          // 開局那一圈（52_fleet.js vxPlace；Tim「起始可以在漩渦中」）：最近是眼的 3 倍（電腦避開眼的那一圈是 2.5 倍，54_helm.js vxAvoid）
  bedVxSync();
}
/** 眼把船往下拖（TASK-0683；Tim 2026-10-17：「漩渦中心是否可以不要強制沈船(或天氣候台可以開關是否沉 但希望是像進水一樣慢慢沉 不要直接判定沉船(會秒切下一台船)」）：
 *  船在眼裡 ⇒ 每秒多吃水 VX.pull 公尺（sh.vxSink；32_hull.js 加在吃水上，粒子模式也一樣 ⇒ 砲門壓到水下照樣進水）；吃到 4.2 m 跟進水同一條線開始沉。
 *  出了眼 ⇒ 每秒浮回 VX_RISE。pull ＝ 0（天氣設定頁）⇒ 不拖（只繞）。回這一步吃水要變多少（m）。
 *  再一次（Tim 2026-10-22：「掉到底部時 目前會一直旋轉但保持好幾秒完全沒有往下吸的感覺 直到瞬間沉沒」「希望被吸住到沉沒期間船體逐漸往下(直到完全到水中時 沉沒)」）：
 *  往下拖的速度照已經被拖了多深越來越快（vxPullV：pull × (1 ＋ 深度／VX_PULL_K)）⇒ 一進眼就看得到往下、越到後面越快；開始沉之後同一條式子接著拖（32_hull.js），
 *  ⛔ 不再換成「眼吞沉船」的加速度（以前 4.2 m 之後 1.5 秒就判沉沒）。整艘沒進水裡（vxSunkAt）才算沉沒。
 *  再一次（Tim 2026-10-22：「眼往下拖 目前拖太久了 大約掉下去後就可以開始往下拖」）：pull 預設 0.3 → 0.4 m/秒、被拖的深度直接加在吃水上（32_hull.js；⛔ 粒子模式以前跟進水一起慢慢跟 ⇒ 第 1 秒只 0.07 m）；
 *  被眼拖沉的開始沉之後也照這裡接著拖（eaten），整艘進水的判準改成「拖下去的深度 ≥ 船頂」（翹起那一頭留在水面，見 vxOffset）⇒ 進眼到沉沒約 7 秒（以前 19 秒）。 */
var VX_RISE = 0.1, VX_PULL_K = 2;
function vxPullV(d) { return VX.pull * (1 + Math.max(0, d) / VX_PULL_K); }
function vxDrag(sh, dt) {
  var v0 = sh.vxSink || 0, inEye = Math.hypot(sh.px, sh.pz) < VX.re, v = (inEye || sh.vxEaten) && VX.pull > 0 ? v0 + vxPullV(v0) * dt : Math.max(0, v0 - VX_RISE * dt);
  if (inEye && VX.pull > 0 && !sh.vxIn) { note(sh, '被捲進漩渦的中心 —— 船身被往下拖，快開出去！', true); if (!v0) sh.vxEnd = vxLowEnd(sh); }
  sh.vxIn = inEye && VX.pull > 0; sh.vxSink = v; return v - v0;
}
/** 被眼拖下去時哪一頭先下去（Tim 2026-10-22：「最好是一端被拉下去的沉沒效果更好(船頭或船尾)」）：剛進眼那一刻，船頭、船尾哪一頭的水面低 ⇒ 那一頭（−1 船頭、＋1 船尾；縱搖正 ＝ 船頭抬起）。
 *  vxTip：照被拖了多深（d）把那一頭往下壓，拖到船頂的 VX_TIP_D 時就到 VX_TIP（先拉那一頭、整艘後下去）。⛔ 不抽 rnd()（照水面決定）。
 *  支點在翹起的那一頭（Tim 2026-10-22：「讓先掉下去的一角(船頭或船尾) 先被往下拉」）：縱傾是繞船中間轉 ⇒ 另外多吃水 半長 × sin 縱傾（vxOffset）
 *  ⇒ 翹起那一頭一直留在原本的水面、只有先進眼那一頭被拉下去（22° 時那一頭比平常深約 2 × 半長 × sin 22°，憲法號約 32 m）。⛔ 繞中間 ⇒ 另一頭同時翹起十幾公尺，像整艘在翹、不像被拉。 */
var VX_TIP = 22 * Math.PI / 180, VX_TIP_D = 0.5, VX_TIP_RATE = 1.2;
function vxLowEnd(sh) {
  var F = fwd(sh.yaw), h = 0.4 * (sh.T.hx1 - sh.T.hx0) * S;
  return vxH(sh.px + F[0] * h, sh.pz + F[2] * h) <= vxH(sh.px - F[0] * h, sh.pz - F[2] * h) ? -1 : 1;
}
function vxHullTop(sh) { var z = sh.T.zw + 60; (sh.decks || []).forEach(function (D) { z = Math.max(z, D.zr[1]); }); return (z - sh.T.zw) * S + 1.5; }   // 最上層甲板 ＋ 舷牆約 1.5 m（沒有甲板資料 ⇒ 6 m）
function vxTip(sh, d) { return (sh.vxEnd || -1) * VX_TIP * clamp(d / (VX_TIP_D * vxHullTop(sh)), 0, 1); }
/** 眼加在吃水上的那一份（m）：拖下去的深度 ＋ 讓翹起那一頭留在水面的那一段（半長 × |sin 縱傾|）；沒被拖 ⇒ 0。32_hull.js 每步照它的變化量加減。 */
function vxOffset(sh) { var d = sh.vxSink || 0; return d > 0 || sh.vxEaten ? d + 0.5 * (sh.T.hx1 - sh.T.hx0) * S * Math.abs(Math.sin(sh.pitchA || 0)) : 0; }
/** 被眼拖沉的船：整艘進到水裡（最上層甲板＋舷牆，加上翹起來那一頭高出的那一段）才算沉沒（32_hull.js；⛔ 以前照一般沉船的 9 m）。
 *  吃水裡已經含 vxOffset 那一段 ⇒ 等於「拖下去的深度（加進水）≥ 船頂」。 */
function vxSunkAt(sh) { return vxHullTop(sh) + 0.5 * (sh.T.hx1 - sh.T.hx0) * S * Math.abs(Math.sin(sh.pitchA || 0)); }
/** 漩渦的水面（m，負 ＝ 往下凹）。 */
//   ＋ 眼的喉部（Tim 2026-10-17「眼可以更深一點(後台也可調參數)」）：−De·re²／(r² ＋ re²)，re ＝ 眼的半徑 ⇒ 中心總深 D ＋ De（預設 75 ＋ 60）、眼的邊上多 De／2。
function vxH(x, z) { var r2 = x * x + z * z; return -VX.D * VX.rc2 / (r2 + VX.rc2) - VX.De * VX.re2 / (r2 + VX.re2); }
/** 那一點的水流（m/s，[x, z]）；沒有漩渦 ⇒ null。逆時針（從上往下看）＝ 繞 +y 轉正角 ⇒ 切線 (z, −x)／r。 */
/** 漩渦水面的坡度（∂h/∂x, ∂h/∂z；h 往中心凹 ⇒ 坡度朝外，−坡度 ＝ 往下坡 ＝ 往中心）。 */
function vxGrad(x, z) { var r2 = x * x + z * z, a = VX.rc2 + r2, b = VX.re2 + r2, k = 2 * (VX.D * VX.rc2 / (a * a) + VX.De * VX.re2 / (b * b)); return [k * x, k * z]; }
/** 下坡加速（Tim 2026-10-17：「是否可以讓往下時加速(重力位能) 往下時加速」）：重力沿著船頭方向的那一份 × grav（天氣設定頁）⇒ m/s²（正 ＝ 往前推：順著坡往下開變快、往上開變慢）。
 *  31_drive.js driveStep 換成推力（× 質量）加進 Fx ⇒ 終端航速、加速度、不衝過頭都照同一套。 */
function vxSlopeAcc(sh) { if (!VX || !(VX.grav > 0)) return 0; var g = vxGrad(sh.px, sh.pz), F = fwd(sh.yaw); return -VX.grav * G * (g[0] * F[0] + g[1] * F[2]); }
/** 漩渦吸力（Tim：「同時漩渦要有吸力(參數可調)」「可以把外圈吸力調弱一些 中心強一些」「或是可以有一個頁面可調參數 來控制吸力變化」）：
 *  往中心的加速度 ＝ suck × g × VX_SUCK_K × f(r)，f ＝ 1／(1 ＋ (r／suckR)^suckP) × r／(r ＋ 5)（中心最強、離中心 suckR 剩一半、suckP 越大外圈掉得越乾脆；正中心 5 m 內收到 0 ⇒ 不在中心點亂跳），
 *  積成船的漂移速度 sh.vxD（m/s，[x, z]），水的阻力每秒消掉 VX_DRIFT_DRAG ⇒ 終端 ≈ 加速度／0.3（vxSuckV）。跟船頭方向無關（下坡加速另算）。31_sailing.js 加進 sh.vel。
 *  ⛔ 第四版照坡度算 ⇒ 外圈的坡也陡，開局那一圈就被拉 2.6 m/s。 */
var VX_DRIFT_DRAG = 0.3, VX_SUCK_K = 1.2;
function vxSuckF(r, R, P) { return r / (r + 5) / (1 + Math.pow(r / R, P)); }
/** 吸力的終端漂移（m/s）：那一圈靜止的船最後會被拉多快（天氣設定頁的讀數；o ＝ vortex 設定）。 */
function vxSuckV(o, r) { return (o.suck > 0 ? o.suck : 0) * G * VX_SUCK_K * vxSuckF(r, o.suckR, o.suckP) / VX_DRIFT_DRAG; }
/** 眼裡自旋（Tim 2026-10-17：「被吸到底部時是否可以給一個強大的旋轉力度(讓船自旋 然後往下吸) 開參數到設定頁吧」）：這一步船頭要多轉幾 rad ——
 *  眼的邊上（r ＝ re）0、往裡線性加到一半以內全速 VX.spin（rad/秒；跟水流同向 ＝ 從上往下看逆時針 ＝ yaw 變大）。31_sailing.js 直接加在 yaw 上（⛔ 不經 yawRate ⇒ 舵抵不掉）。 */
/** 繞行轉向（Tim 2026-10-17：「讓漩渦的轉向力 讓船頭會往內轉(目前因為慣性 會往外偏)」「希望做到的效果是船可以繞行漩渦」）：這一步船頭要多轉幾 rad ——
 *  照船自己的速度（船頭 × 航速）繞中心的角速度 (z·vx − x·vz)／r²（＝ 剛好沿著這一圈繞要轉的量；順著水流或逆著都照它的方向）× turn，
 *  超過 rv 照 1／(1 ＋ (r／rv)⁴) 淡掉。直接加在 yaw 上（舵照樣能改，艦長要別的航向會自己打回去）。 */
function vxTurn(sh, dt) {
  if (!(VX.turn > 0)) return 0;
  var x = sh.px, z = sh.pz, r2 = x * x + z * z; if (r2 < 1) return 0;
  var F = fwd(sh.yaw), vx = F[0] * sh.spd, vz = F[2] * sh.spd, q = r2 / (VX.rv * VX.rv);
  return VX.turn / (1 + q * q) * (z * vx - x * vz) / r2 * dt;
}
var VX_UPHILL = 0.5;                                                   // 眼外（逃不掉的範圍 ＝ 眼），上坡最多吃掉幾成推力（31_drive.js）
/** 眼的束縛（Tim 2026-10-18：「我衝向漩渦眼 被吸進去高速旋轉後 無傷的被甩出來了」）：這一步船速剩幾成 ——
 *  眼的邊上 1、往裡線性加到一半以內每秒吃掉 VX.hold（31_sailing.js 乘在 sh.spd 上，driveStep 之後）⇒ 衝進來的船幾秒內停下、引擎和帆在裡面推不起速度 ⇒ 逃不掉（逃不掉的範圍 ＝ 眼）。
 *  ⛔ 沒有它：順著坡衝下去 27–30 節，半徑 42 m 的眼一兩秒就穿過去；吸力（最多約 3 m/s）抵不過、往下拖要 28 秒，自旋只轉船頭不扣船速 ⇒ 轉一轉從另一邊滑出去。 */
function vxHold(sh, dt) { if (!(VX.hold > 0)) return 1; var r = Math.hypot(sh.px, sh.pz); return r >= VX.re ? 1 : Math.max(0, 1 - VX.hold * clamp(2 * (1 - r / VX.re), 0, 1) * dt); }
function vxSpin(sh, dt) { if (!(VX.spin > 0)) return 0; var r = Math.hypot(sh.px, sh.pz); return r >= VX.re ? 0 : VX.spin * clamp(2 * (1 - r / VX.re), 0, 1) * dt; }
/** 離中心 r 公尺時往中心的水流（m/s）：吸力的終端漂移（vxSuckV）＋ 切向水流往中心的那一份（VX.IN）；眼的吸力不算（眼外）。54_helm.js vxShipEdge 用。 */
function vxInV(r) { var q = r / VX.rv; return vxSuckV(VX, r) + VX.IN * VX.V * 2 * q / (1 + q * q); }
function vxDrift(sh, dt) {
  var D = sh.vxD || (sh.vxD = [0, 0]), r = Math.hypot(sh.px, sh.pz), f = Math.max(0, 1 - VX_DRIFT_DRAG * dt);
  var a = r > 1e-3 ? (VX.suck > 0 ? VX.suck : 0) * G * VX_SUCK_K * vxSuckF(r, VX.suckR, VX.suckP) / r : 0;   // ÷ r ⇒ 乘上 (x, z) 就是往中心的單位向量
  D[0] = (D[0] - a * sh.px * dt) * f; D[1] = (D[1] - a * sh.pz * dt) * f; return D;
}
function vxFlow(x, z) {
  if (!VX) return null;
  var r = Math.hypot(x, z); if (r < 1e-3) return [0, 0];
  var q = r / VX.rv, vt = VX.V * 2 * q / (1 + q * q), ux = x / r, uz = z / r;
  // 眼的吸力（Tim 2026-10-18「眼的吸力要更強」）：眼裡另外一股直接往中心的水流 VX.eyeSuck（m/s）—— 眼的邊上 0、四分之一深處全力、正中心 8 m 內收掉（不在中心點亂跳）；船、碎片、落水的人都吃
  var ve = VX.eyeSuck > 0 && r < VX.re ? VX.eyeSuck * clamp((VX.re - r) / (0.25 * VX.re), 0, 1) * Math.min(1, r / 8) : 0;
  return [vt * (uz - VX.IN * ux) - ve * ux, vt * (-ux - VX.IN * uz) - ve * uz];
}
/** 順著水流的船頭方向（yaw；fwd(yaw) ＝ 切線）：開局用（52_fleet.js spawnFleet）。 */
function vxTangentYaw(x, z) { var r = Math.hypot(x, z) || 1; return Math.atan2(x / r, z / r); }
/** 水面高度（世界座標 x, z、時間 t）。 */
function seaH(x, z, t) {
  if (!(SEA_K > 0)) return VX ? vxH(x, z) : 0;
  var c = Math.cos(SEA_A), s = Math.sin(SEA_A), rx = c * x + s * z, rz = c * z - s * x, h = 0;
  for (var i = 0; i < WAVES.length; i++) { var w = WAVES[i]; h += w.a * Math.sin(w.kx * rx + w.kz * rz - w.w * t + w.ph); }
  h = h * SEA_K * WX.sea;                       // 天氣（08_weather.js）：暴風雨 ×2.5；晴天 ×1（逐位元組不變）
  return VX ? h + vxH(x, z) : h;                // 大漩渦：凹下去的那一份疊在浪上
}
/** 水面高度的上限（m）：|seaH| 一定不超過它（TASK-0673）—— 泡水判定先比它，離海面夠遠的點不用算七道浪。
 *  振幅照 seaH 同一個加法順序加、同一個乘法順序乘 ⇒ 捨入只會讓 seaH 比它小（再多留 1e-6 m）；量不準的情況（浪 ≤ 0、天氣倍率 < 0）給 Infinity ＝ 照算。
 *  大漩渦只會往下凹 ⇒ 上限照舊；下限另外看 seaLow。 */
var SEA_AMP = WAVES.reduce(function (s, w) { return s + w.a; }, 0);
function seaBound() { return SEA_K > 0 && WX.sea >= 0 ? SEA_AMP * SEA_K * WX.sea + 1e-6 : Infinity; }
/** 水面高度的下限（m）：seaH 一定不低於它。沒有漩渦 ＝ −seaBound()；有 ⇒ 再往下 D（⛔ 不扣 ⇒ 漏斗裡甲板上的水手「比最低的浪谷還低」被判成溺水，33_flood.js）。 */
function seaLow() { var b = seaBound(); return VX ? -b - VX.D - VX.De - 1e-6 : -b; }
// 著色器用的同一組浪（常數照 WAVES 生成；uSeaK、uSeaT 在 setCommon 給）。seaH ＝ 高度，seaG ＝ 坡度（∂h/∂x, ∂h/∂z）；
// seaHs ＝ 照網格間距 s 拿掉太短的浪（⛔ 頂點間距比波長的 1/4 還粗 ⇒ 鋸齒、浪在網格上游動）；
// seaGf ＝ 照一個像素在海面上多寬（fp，公尺）淡掉太短的浪的坡度（⛔ 不淡 ⇒ 遠處的浪比像素還細，疊出規則的疊紋）。
var SEA_GLSL = (function () {
  var f = function (v) { var s = (+v).toPrecision(9); return s.indexOf('.') < 0 && s.indexOf('e') < 0 ? s + '.0' : s; };
  var h = [], g = [], hs = [], gf = [];
  WAVES.forEach(function (w) {
    var arg = 'dot(p,vec2(' + f(w.kx) + ',' + f(w.kz) + '))-' + f(w.w) + '*uSeaT+' + f(w.ph);
    h.push(f(w.a) + '*sin(' + arg + ')');
    g.push(f(w.a) + '*cos(' + arg + ')*vec2(' + f(w.kx) + ',' + f(w.kz) + ')');
    hs.push(f(w.a) + '*(1.0-smoothstep(' + f(w.L * 0.18) + ',' + f(w.L * 0.3) + ',s))*sin(' + arg + ')');
    gf.push(f(w.a) + '*(1.0-smoothstep(' + f(w.L * 0.25) + ',' + f(w.L * 0.6) + ',fp))*cos(' + arg + ')*vec2(' + f(w.kx) + ',' + f(w.kz) + ')');
  });
  // 大漩渦（VX，上面）：uVx ＝ (D, rc², rv, V)；D ＝ 0 ⇒ 沒有（vxH、vxG 回 0：晴天、暴風雨的畫面不變）。q ＝ 世界座標（漩渦不跟著浪轉）
  //   uVe ＝ (眼的深度, 眼的半徑²)：眼那一段喉部（vxH 的第二項）
  return 'uniform float uSeaK, uSeaT, uSeaA; uniform vec4 uVx; uniform vec2 uVe;\n' +
    'vec2 seaP(vec2 p){ float c=cos(uSeaA), s=sin(uSeaA); return vec2(c*p.x+s*p.y,c*p.y-s*p.x); }\n' +   // 世界 ⇒ 原本那組浪的座標（反轉 uSeaA）
    'vec2 seaV(vec2 g){ float c=cos(uSeaA), s=sin(uSeaA); return vec2(c*g.x-s*g.y,s*g.x+c*g.y); }\n' +   // 坡度轉回世界
    'float vxH(vec2 q){ return uVx.x>0.0 ? -uVx.x*uVx.y/(dot(q,q)+uVx.y)-uVe.x*uVe.y/(dot(q,q)+uVe.y) : 0.0; }\n' +
    'vec2 vxG(vec2 q){ if(uVx.x<=0.0) return vec2(0.0); float d=dot(q,q)+uVx.y, e=dot(q,q)+uVe.y; return q*(2.0*uVx.x*uVx.y/(d*d)+2.0*uVe.x*uVe.y/(e*e)); }\n' +
    'float seaH(vec2 q){ vec2 p=seaP(q); return uSeaK*(' + h.join('+') + ')+vxH(q); }\n' +
    'vec2 seaG(vec2 q){ vec2 p=seaP(q); return seaV(uSeaK*(' + g.join('+') + '))+vxG(q); }\n' +
    'float seaHs(vec2 q,float s){ vec2 p=seaP(q); return uSeaK*(' + hs.join('+') + ')+vxH(q); }\n' +
    'vec2 seaGf(vec2 q,float fp){ vec2 p=seaP(q); return seaV(uSeaK*(' + gf.join('+') + '))+vxG(q); }\n' +
    '#define SEA_WA (' + f(Math.atan2(WIND[2], WIND[0])) + '+uSeaA)\n';
})();
// 彈簧 [k, c]（k ＝ ωn²、c ＝ 2ζωn）：起伏、縱搖週期 2.5 秒、阻尼比 0.6 ⇒ 長浪（6.9 秒）幾乎同相跟著走；橫搖週期 5 秒、阻尼比 0.35 ⇒ 會晃、會落後一點。
//   ⛔ 起伏設成 5 秒（照巡防艦的固有週期）⇒ 跟主浪差不多快、落後 60°，船身對水面的上下跟浪本身一樣大（量過：相對 0.33 m 對浪 0.32 m），看起來像沒在跟
var WV_K = { h: [6.25, 3.0], p: [6.25, 3.0], r: [1.44, 0.84] };
/** 每步：船底的水面擬合平面 ⇒ 船的起伏、縱搖、橫搖（彈簧阻尼跟過去）。開戰第一步直接放在目標上（不從平的海晃過去）。 */
function stepWaves(sh, dt) {
  var T = sh.T, Lh = (T.hx1 - T.hx0) * S, c = sh.center || [sh.px, 0, sh.pz], F = fwd(sh.yaw), Z = [Math.sin(sh.yaw), 0, Math.cos(sh.yaw)];   // Z：船體 +Z（格 +y、右舷）在世界的方向
  var n = 0, hm = 0, su = 0, uu = 0, sw = 0, ww = 0;
  for (var a = -2; a <= 2; a++) for (var b = -1; b <= 1; b += 2) {
    var u = a * 0.2 * Lh, w = b * 0.1 * Lh, h = seaH(c[0] + F[0] * u + Z[0] * w, c[2] + F[2] * u + Z[2] * w, SIMT);
    hm += h; su += u * h; uu += u * u; sw += w * h; ww += w * w; n++;
  }
  hm /= n;
  // 大漩渦：開始沉了 ⇒ 1 秒內把水面換成船中心那一點的（Tim 2026-10-17：「沈船會在漩渦底部浮很久」「我對漩渦眼的預期是 沈船會在幾秒內被吸走(沉掉)」）——
  //   ⛔ 照十個點的平均 ⇒ 眼的喉部（半徑 42 m）比船（87 m）窄，平均是 −322 m、中心是 −350 m ⇒ 沉了的船懸在喉底上面 28 m，沉 40 m 才消失（約 30 秒）
  if (VX && sh.sinkingFinal) { sh.vxB = Math.min(1, (sh.vxB || 0) + dt); var hc = seaH(c[0], c[2], SIMT); if (hc < hm) hm += (hc - hm) * sh.vxB; }
  var tp = Math.atan(su / uu), tr = -Math.atan(sw / ww);              // 縱搖正 ＝ 船頭（格 +x）抬起；橫搖正 ＝ 船體 +Z 那舷往下 ⇒ 水在 +Z 那邊高就取負
  var V = sh.wv;
  if (!V) V = sh.wv = { h: hm, hv: 0, p: tp, pv: 0, r: tr, rv: 0 };
  V.hv += (WV_K.h[0] * (hm - V.h) - WV_K.h[1] * V.hv) * dt; V.h += V.hv * dt;
  V.pv += (WV_K.p[0] * (tp - V.p) - WV_K.p[1] * V.pv) * dt; V.p += V.pv * dt;
  V.rv += (WV_K.r[0] * (tr - V.r) - WV_K.r[1] * V.rv) * dt; V.r += V.rv * dt;
  sh.wl = hm; sh.bob = V.h - hm; sh.pitchW = V.p; sh.rollW = V.r;
}
