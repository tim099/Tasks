// ───────────────────────── 環境音：風、浪、暴風雨的雨（TASK-0663） ─────────────────────────
// Tim 2026-10-17：「是否可以用程式模擬雨聲&浪聲」「雨聲用在暴風雨場景」「還有風聲」。跟 02_audio.js 同一套：噪音＋濾波器，沒有音檔。
//   風：粉紅噪音 → 帶通（中心 AMB_WIND_F0＋AMB_WIND_FK × w、Q 0.9）；w ＝ 風速 ÷ AMB_WIND_REF（風速 ＝ WIND_SAIL × WX.wind × WIND_SPD，m/s；
//       ⛔ 不乘 WIND_K：那是帆的風壓設定、不是真的風）。兩道慢的正弦（0.31／0.13 Hz）推音量 ⇒ 一陣一陣；w 過 0.5 ⇒ 多一條索具的呼嘯（窄帶通，音高跟著風）。
//       左右：風從哪邊來（鏡頭的右手 · 風來的方向）⇒ 偏那一邊。
//   浪：棕噪音 → 低通；三道不成整數比的慢正弦（0.083／0.131／0.057 Hz）同時推低通的頻率與音量 ⇒ 一波一波、不是固定節拍；浪頭多一層高通的嘶聲（同一組正弦）。
//       音量 × 海況（WX.sea 的 0.8 次方）× 鏡頭離海面的高度（1 ／（1 ＋ 高 ÷ 30 m））。
//   雨（只在 WX.rain，⛔ 晴天整條不建）：白噪音 → 高通 1.2 kHz → 低通 7 kHz 的沙沙底＋隨機排的雨滴（每顆 4–12 ms 的噪音、帶通 1.5–5 kHz），每秒 AMB_DROPS 顆；
//       一道 0.05 Hz 的正弦推雨勢（大一陣小一陣）。
//   船艙裡（第一人稱、眼睛那一柱往上有實心 ⇒ 頭上有甲板）：三條一起過低通 AMB_HOLD_F、音量 × AMB_HOLD_G ⇒ 悶在船殼外。
// 純聲音：⛔ 不抽 rnd()、不用 Math.random（自己的 LCG）⇒ 戰局的亂數一位元都不動；靜音（M）⇒ 音量 0、節點照跑。
// 同一份建圖給 OfflineAudioContext 用（ambRender）⇒ 無頭模式也錄得出 WAV（src/tests/ambient_lab.py），給人試聽、前後對照。
// AMB_WIND_G：風（含索具呼嘯）的總音量 —— Tim 2026-10-17「那風聲調小一些」⇒ 1 → 0.5（−6 dB）
var AMB_WIND_G = 0.5;
var AMB_WIND_REF = 25, AMB_WIND_F0 = 260, AMB_WIND_FK = 620, AMB_DROPS = 26, AMB_HOLD_F = 600, AMB_HOLD_G = 0.5, AMB_TC = 0.6;
var AMB = null, AMB_SEED = 1234567, AMB_COVER_T = 0;

function ambRand() { AMB_SEED = (Math.imul(AMB_SEED, 1103515245) + 12345) & 0x7fffffff; return AMB_SEED / 0x7fffffff; }
/** 噪音緩衝（4 秒、循環播）：kind ＝ 'white'｜'pink'（Paul Kellet 的濾波）｜'brown'（積分、漏一點）。 */
/** 噪音的循環緩衝（4 秒）：同一個 AudioContext 每種只做一次（一種約 15～20 ms；換天氣重建環境音、開戰分段先做好 ⇒ 都拿同一份，內容照種子一樣）。 */
function ambNoise(ac, kind) { var C = ac.ambN || (ac.ambN = {}); return C[kind] || (C[kind] = ambNoiseMake(ac, kind)); }
function ambNoiseMake(ac, kind) {
  var n = ac.sampleRate * 4, b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0), s = kind === 'pink' ? 777 : kind === 'brown' ? 4242 : 99;
  var b0 = 0, b1 = 0, b2 = 0, br = 0, i, w, mx = 0;
  for (i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; w = s / 0x3fffffff - 1;
    if (kind === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = b0 + b1 + b2 + w * 0.1848; }
    else if (kind === 'brown') { br = (br + 0.02 * w) * 0.998; d[i] = br; }
    else d[i] = w;
    if (Math.abs(d[i]) > mx) mx = Math.abs(d[i]);
  }
  for (i = 0; i < n; i++) d[i] /= mx || 1;
  var f = Math.min(2000, n >> 2);                                      // 頭尾交叉淡化 ⇒ 循環接縫不會「喀」一聲
  for (i = 0; i < f; i++) { var k = i / f; d[n - f + i] = d[n - f + i] * (1 - k) + d[i] * k; }
  return b;
}
function ambLoop(ac, buf) { var s = ac.createBufferSource(); s.buffer = buf; s.loop = true; s.loopEnd = buf.duration - Math.min(2000, buf.length >> 2) / ac.sampleRate; return s; }
function ambLfo(ac, hz, depth, dest, ph) {                             // 慢的正弦 × depth 加到 dest（AudioParam）上
  var o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = hz; g.gain.value = depth; o.connect(g); g.connect(dest);
  if (ph) { var dl = ac.createDelay(1 / hz); dl.delayTime.value = (ph % 1) / hz; o.disconnect(); o.connect(dl); dl.connect(g); }
  return o;
}
/** 建整張圖（ac 可以是 OfflineAudioContext）：rain ＝ 要不要建雨那一條。回 { set(p, t, tc), drops(t0, t1, lv) }。 */
function ambBuild(ac, dest, rain) {
  var A = { ac: ac, osc: [], src: [], rain: !!rain }, W = ambNoise(ac, 'white'), Pk = ambNoise(ac, 'pink'), Br = ambNoise(ac, 'brown');
  A.white = W;
  A.bus = ac.createGain(); A.muff = ac.createBiquadFilter(); A.muff.type = 'lowpass'; A.muff.frequency.value = 18000; A.muff.Q.value = 0.5;
  A.bus.connect(A.muff); A.muff.connect(dest);
  // 風
  var ws = ambLoop(ac, Pk); A.wbp = ac.createBiquadFilter(); A.wbp.type = 'bandpass'; A.wbp.Q.value = 0.9;
  A.wg = ac.createGain(); A.wg.gain.value = 0; A.wgust = ac.createGain(); A.wgust.gain.value = 1;
  A.pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
  ws.connect(A.wbp); A.wbp.connect(A.wgust); A.wgust.connect(A.wg); A.wg.connect(A.pan || A.bus); if (A.pan) A.pan.connect(A.bus);
  A.osc.push(ambLfo(ac, 0.31, 0.22, A.wgust.gain), ambLfo(ac, 0.13, 0.3, A.wgust.gain, 0.4), ambLfo(ac, 0.21, 90, A.wbp.frequency, 0.7));
  var hs = ambLoop(ac, W); A.whbp = ac.createBiquadFilter(); A.whbp.type = 'bandpass'; A.whbp.Q.value = 14; A.whg = ac.createGain(); A.whg.gain.value = 0;
  hs.connect(A.whbp); A.whbp.connect(A.whg); A.whg.connect(A.wgust);
  A.osc.push(ambLfo(ac, 0.17, 120, A.whbp.frequency, 0.2));
  A.src.push(ws, hs);
  // 浪
  var vs = ambLoop(ac, Br); A.vlp = ac.createBiquadFilter(); A.vlp.type = 'lowpass'; A.vlp.Q.value = 0.7; A.vlp.frequency.value = 450;
  A.vswell = ac.createGain(); A.vswell.gain.value = 1; A.vg = ac.createGain(); A.vg.gain.value = 0;
  vs.connect(A.vlp); A.vlp.connect(A.vswell); A.vswell.connect(A.vg); A.vg.connect(A.bus);
  var cs = ambLoop(ac, W); A.vhp = ac.createBiquadFilter(); A.vhp.type = 'highpass'; A.vhp.frequency.value = 2600; A.vcrest = ac.createGain(); A.vcrest.gain.value = 0;
  cs.connect(A.vhp); A.vhp.connect(A.vcrest); A.vcrest.connect(A.vg);
  [[0.083, 0, 0.45, 260, 0.05], [0.131, 0.37, 0.3, 160, 0.035], [0.057, 0.71, 0.25, 120, 0.03]].forEach(function (L) {   // 頻率、相位、推音量、推低通（Hz）、推浪頭嘶聲
    A.osc.push(ambLfo(ac, L[0], L[2], A.vswell.gain, L[1]), ambLfo(ac, L[0], L[3], A.vlp.frequency, L[1]), ambLfo(ac, L[0], L[4], A.vcrest.gain, L[1]));
  });
  A.src.push(vs, cs);
  // 雨（只在暴風雨）
  if (rain) {
    var rs = ambLoop(ac, W), hp = ac.createBiquadFilter(), lp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200; lp.type = 'lowpass'; lp.frequency.value = 7000;
    A.rg = ac.createGain(); A.rg.gain.value = 0; A.rsw = ac.createGain(); A.rsw.gain.value = 1;
    rs.connect(hp); hp.connect(lp); lp.connect(A.rsw); A.rsw.connect(A.rg); A.rg.connect(A.bus);
    A.dg = ac.createGain(); A.dg.gain.value = 0; A.dg.connect(A.bus);            // 雨滴的總音量（跟 rg 一起設）
    A.osc.push(ambLfo(ac, 0.05, 0.3, A.rsw.gain, 0.15));
    A.src.push(rs);
  }
  A.osc.forEach(function (o) { o.start(); }); A.src.forEach(function (s) { s.start(); });
  A.dropT = 0;
  return A;
}
/** 照參數設目標值：p ＝ { w（風 0–1.5）, pan（−1–1）, sea（海況倍率）, hgt（鏡頭離海面 m）, rain（0–1）, hold（0／1）, vol（總音量） }；tc ＝ 時間常數（0 ⇒ 立刻）。 */
function ambSet(A, p, t, tc) {
  function to(par, v) { if (tc > 0) par.setTargetAtTime(v, t, tc); else par.setValueAtTime(v, t); }
  var w = clamp(p.w, 0, 1.6), vol = p.vol, sea = Math.pow(Math.max(p.sea, 0), 0.8), hatt = 1 / (1 + Math.max(0, p.hgt) / 30);
  to(A.wg.gain, vol * AMB_WIND_G * (0.04 + 0.3 * Math.pow(w, 1.5)));
  to(A.wbp.frequency, AMB_WIND_F0 + AMB_WIND_FK * w);
  to(A.whg.gain, vol * AMB_WIND_G * 0.5 * Math.pow(Math.max(0, w - 0.5), 2));
  to(A.whbp.frequency, 700 + 900 * w);
  if (A.pan) to(A.pan.pan, clamp(p.pan, -1, 1) * 0.45);
  to(A.vg.gain, vol * 0.055 * sea * hatt);   // 量過（ambient_lab）：0.5 ⇒ 海況 1 一條就 −12.8 dB、撞到 master 的限制器（−14 dB）、把風跟砲聲一起壓扁
  if (A.rain) { var r = clamp(p.rain, 0, 1); to(A.rg.gain, vol * 0.04 * r); to(A.dg.gain, vol * 0.12 * r); A.rainLv = r; }
  to(A.muff.frequency, p.hold ? AMB_HOLD_F : 18000); to(A.bus.gain, p.hold ? AMB_HOLD_G : 1);
}
/** 排 [t0, t1) 之間的雨滴（即時：每一格往前排 0.25 秒；離線：一次排完）。 */
function ambDrops(A, t0, t1) {
  if (!A.rain || !(A.rainLv > 0)) { A.dropT = t1; return; }
  var ac = A.ac, t = Math.max(A.dropT, t0);
  while (true) {
    t += -Math.log(1 - ambRand() * 0.999) / (AMB_DROPS * A.rainLv);   // 卜瓦松：間隔照指數分布
    if (t >= t1) break;
    var s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), d = 0.004 + 0.008 * ambRand(), a = 0.15 + 0.85 * ambRand() * ambRand();
    s.buffer = A.white; f.type = 'bandpass'; f.frequency.value = 1500 + 3500 * ambRand(); f.Q.value = 1.5 + 3 * ambRand();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.0015); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    s.connect(f); f.connect(g); g.connect(A.dg); s.start(t, ambRand() * 3); s.stop(t + d + 0.01);
  }
  A.dropT = t1;
}
/** 現在的參數（遊戲裡）：風、風從哪邊來、海況、鏡頭高度、雨、在不在船艙裡、靜音。 */
function ambParams() {
  var wv = WIND_SAIL * WX.wind * WIND_SPD, pan = 0;
  var lk = CAM.look || CAM.tgt;
  if (CAM.eye && lk) {                                                 // 鏡頭的右手（水平：前 × 上 ＝ (−fz, fx)）· 風來的方向（−WIND）
    var fx = lk[0] - CAM.eye[0], fz = lk[2] - CAM.eye[2], fl = Math.hypot(fx, fz) || 1, wl = Math.hypot(WIND[0], WIND[2]) || 1;
    pan = (-fz / fl) * (-WIND[0] / wl) + (fx / fl) * (-WIND[2] / wl);
  }
  return { w: wv / AMB_WIND_REF, pan: pan, sea: WX.sea, hgt: CAM.eye ? CAM.eye[1] : 10, rain: WX.rain ? 1 : 0, hold: ambCovered(), vol: muted ? 0 : 1 };
}
/** 第一人稱、眼睛那一柱往上有實心 ⇒ 頭上有甲板（每 0.25 秒看一次）。 */
function ambCovered() {
  if (!FP.on || !FP.sh || !FP.c || !FP.sh.grid) return 0;
  var now = performance.now(); if (now - AMB_COVER_T < 250) return AMB.hold0; AMB_COVER_T = now;
  var g = FP.sh.grid, x = Math.floor(FP.c.pos[0]), y = Math.floor(FP.c.pos[1]), z = Math.floor(FP.c.pos[2]) + FP_EYE, hit = 0;
  for (var h = 1; h < 200 && !hit; h++) if (g.get(x, y, z + h)) hit = 1;
  return (AMB.hold0 = hit);
}
/** 每一格畫面（90_main.js frame）：還沒有聲音（按開始之前、demo）⇒ 什麼都不做。天氣換了（雨要不要建）⇒ 重建。 */
function ambFrame() {
  if (!AC) return;
  if (AMB && AMB.rain !== !!WX.rain) { try { AMB.bus.disconnect(); AMB.osc.concat(AMB.src).forEach(function (n) { n.stop(); }); } catch (e) { } AMB = null; }
  if (!AMB) { AMB = ambBuild(AC, AC.ambBus || master, WX.rain > 0); AMB.hold0 = 0; ambSet(AMB, ambParams(), AC.currentTime, 0); return; }   // AC.ambBus：環境音那條音量線（02_audio.js、TASK-0677）
  var now = AC.currentTime; ambSet(AMB, ambParams(), now, AMB_TC); ambDrops(AMB, now, now + 0.25);
}
/** 試聽集（__game.ambLab；src/tests/ambient_lab.py）：預設四段，各 sec 秒；?cases=名字:w:sea:rain:hold;… 換掉。回 Promise<[{ name, peak, rmsDb, wav }]>。 */
var AMB_CASES = [['晴・微風', 0.3, 1, 0, 0], ['晴・強風', 0.75, 1, 0, 0], ['暴風雨', 1.1, 2.5, 1, 0], ['暴風雨・船艙裡', 1.1, 2.5, 1, 1]];
function ambLab(q) {
  var sec = +(q.get('sec') || 10), cs = q.has('cases') ? q.get('cases').split(';').filter(function (s) { return s; }).map(function (s) { var a = s.split(':'); return [a[0], +a[1], +a[2], +a[3], +a[4]]; }) : AMB_CASES, out = [];
  return cs.reduce(function (pr, c) {
    return pr.then(function () { return ambRender({ sec: sec, w: c[1], sea: c[2], rain: c[3], hold: c[4] }).then(function (r) { r.name = c[0]; out.push(r); }); });
  }, Promise.resolve()).then(function () { return out; });
}
/** 離線錄一段（無頭模式的試聽、前後對照）：o ＝ { sec, w, pan, sea, hgt, rain, hold }；回 Promise<data URL（16 位元雙聲道 WAV）>。 */
function ambRender(o) {
  var sec = o.sec || 8, sr = 44100, oc = new OfflineAudioContext(2, Math.round(sr * sec), sr), lim = oc.createDynamicsCompressor();
  lim.threshold.value = -14; lim.knee.value = 4; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.25;   // 跟遊戲的 master 同一個限制器（02_audio.js）
  var mg = oc.createGain(); mg.gain.value = 0.8; mg.connect(lim); lim.connect(oc.destination);
  AMB_SEED = 1234567; var A = ambBuild(oc, mg, o.rain > 0);
  ambSet(A, { w: o.w, pan: o.pan || 0, sea: o.sea, hgt: o.hgt === undefined ? 6 : o.hgt, rain: o.rain || 0, hold: o.hold ? 1 : 0, vol: 1 }, 0, 0);
  ambDrops(A, 0, sec);
  return oc.startRendering().then(function (buf) { var r = audioWav(buf); r.o = o; return r; });   // WAV 編碼跟 bgmRender 共用（02_audio.js audioWav）
}
