// ───────────────────────── 音效（按下開始後才建；沒有聲音也完整） ─────────────────────────
var AC = null, master = null, noiseBuf = null, muted = false;
// 爆音（Tim 2026-10-15：「目前爆炸太頻繁會爆音」）：以前每個聲音各自接 master、沒有上限 ⇒ 一次齊射幾十門＋殉爆＋碎裂疊起來加總 > 1 ⇒ 削波。兩層：
//   ① master 後面一個限制器（DynamicsCompressor：門檻 −14 dB、比 20、起 2 ms、放 250 ms）⇒ 疊再多也壓在 0 dBFS 以下；
//   ② 同時發聲：同一種在 SFX_WIN 秒內最多 SFX_SAME 個（人耳分不出來、只是更大聲）、全部最多 SFX_MAX 個還在響 ⇒ 多的不放（只是聲音；不碰模擬的亂數）。
var SFX_MAX = 24, SFX_SAME = 3, SFX_WIN = 0.06, SFX_END = [], SFX_RECENT = {};
function initAudio() {
  if (AC || DEMO >= 0) return;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = 0.8;
    var lim = AC.createDynamicsCompressor(); lim.threshold.value = -14; lim.knee.value = 4; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.25;
    master.connect(lim); lim.connect(AC.destination); AC.lim = lim;
    ['sfxBus', 'ambBus', 'bgmBus'].forEach(function (k) { var b = AC.createGain(); b.gain.value = 0; b.connect(master); AC[k] = b; });   // 三條音量線（TASK-0677，聲音設定頁）：音效／環境音（02_ambient.js）／背景音樂（02_music.js）；值照 SND（sndApply）
    sndApply();
    var n = AC.sampleRate * 2; noiseBuf = AC.createBuffer(1, n, AC.sampleRate);
    var d = noiseBuf.getChannelData(0), s = 22222;
    for (var i = 0; i < n; i++) { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; d[i] = s / 0x3fffffff - 1; }
  } catch (e) { AC = null; }
}
function sfxPlay(kind, at, vol) {
  if (!AC || muted) return;
  if (kind === 'boom' || kind === 'blast') SND_FIGHT = AC.currentTime;     // 開砲、爆炸 ⇒ 交戰中（02_music.js：BGM「交戰時小聲一點」那一檔 × BGM_DUCK）
  var dist = at ? len(sub(at, CAM.eye)) : 0, v = (vol || 1) / (1 + dist / 70);
  if (v < 0.01) return;
  var now = AC.currentTime, rec = SFX_RECENT[kind] || (SFX_RECENT[kind] = []);
  while (SFX_END.length && SFX_END[0] < now) SFX_END.shift();
  while (rec.length && rec[0] < now - SFX_WIN) rec.shift();
  if (rec.length >= SFX_SAME || SFX_END.length >= SFX_MAX) return;     // 同一種剛放過好幾個、或已經太多聲音在響 ⇒ 這一個不放
  rec.push(now);
  var t = AC.currentTime + Math.min(0.25, dist / 340) * 0.5, g = AC.createGain(); g.connect(AC.sfxBus);
  var src = AC.createBufferSource(); src.buffer = noiseBuf; src.playbackRate.value = 0.6 + Math.random() * 0.5;
  var f = AC.createBiquadFilter(); src.connect(f); f.connect(g);
  function env(a, d) { var e = t + d + 0.05, k = SFX_END.length; while (k > 0 && SFX_END[k - 1] > e) k--; SFX_END.splice(k, 0, e); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a * v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d); src.start(t, Math.random()); src.stop(t + d + 0.05); }
  if (kind === 'boom') {
    f.type = 'lowpass'; f.frequency.setValueAtTime(1400, t); f.frequency.exponentialRampToValueAtTime(90, t + 0.9); env(1.1, 1.3);
    var o = AC.createOscillator(), og = AC.createGain(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.6);
    og.gain.setValueAtTime(0.9 * v, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.7); o.connect(og); og.connect(AC.sfxBus); o.start(t); o.stop(t + 0.75);
  } else if (kind === 'crack') { f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 900; f.Q.value = 0.8; env(1.4, 0.35); }
  else if (kind === 'splash') { f.type = 'highpass'; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(2500, t + 0.5); env(0.6, 0.8); }
  else if (kind === 'blast') { f.type = 'lowpass'; f.frequency.setValueAtTime(2400, t); f.frequency.exponentialRampToValueAtTime(60, t + 1.8); env(1.6, 2.2); }
  else if (kind === 'thunder') { f.type = 'lowpass'; f.frequency.setValueAtTime(260, t); f.frequency.exponentialRampToValueAtTime(40, t + 3.2); env(1.5, 3.6); }   // 暴風雨的雷（08_weather.js）
  else if (kind === 'knock') { f.type = 'bandpass'; f.frequency.value = 1500 + Math.random() * 500; f.Q.value = 3; env(1.2, 0.07); }   // 木匠的槌子敲下去（41_crew_art.js carpHitFx；TASK-0676）：短、硬的一聲木頭
  else if (kind === 'creak') { f.type = 'lowpass'; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(80, t + 2.5); env(1.2, 2.8); }
}

/** 離線錄好的 AudioBuffer ⇒ { peak, rmsDb, wav（data URL，16 位元雙聲道） }（02_ambient.js ambRender、02_music.js bgmRender 共用）。 */
function audioWav(buf) {
  var n = buf.length, sr = buf.sampleRate, L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L, pk = 0, ss = 0, i;
  var out = new DataView(new ArrayBuffer(44 + n * 4));
  function str(p, s) { for (var k = 0; k < s.length; k++) out.setUint8(p + k, s.charCodeAt(k)); }
  str(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); str(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, n * 4, true);
  for (i = 0; i < n; i++) {
    var l = clamp(L[i], -1, 1), r = clamp(R[i], -1, 1); pk = Math.max(pk, Math.abs(l), Math.abs(r)); ss += l * l + r * r;
    out.setInt16(44 + i * 4, l * 32767, true); out.setInt16(46 + i * 4, r * 32767, true);
  }
  var u8 = new Uint8Array(out.buffer), bin = '', CH = 0x8000;
  for (i = 0; i < u8.length; i += CH) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return { peak: +pk.toFixed(3), rmsDb: +(10 * Math.log10(ss / (2 * n) + 1e-12)).toFixed(1), wav: 'data:audio/wav;base64,' + btoa(bin) };
}
// 訂閱（TASK-0669：模擬層只發事件，00_events.js）
evOn('sfx', sfxPlay, 0, true);
