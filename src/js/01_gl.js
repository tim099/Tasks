// ───────────────────────── WebGL ─────────────────────────
var cv = $('cv'), gl = cv.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });   // 反鋸齒自己做（MSAA framebuffer，畫質設定；60_render.js targets）
function glFail(msg) { bootSay(msg); errShow(msg); }
// ── 報錯彈窗與回報（Tim 2026-10-18：「是否可以加一個彈窗(可關閉) 以及一個回報錯誤按鈕(可以填錯誤內容 然後寄email…(包含報錯訊息與玩家的回報內容)」）──
// glFail 與沒接住的錯誤（window error／unhandledrejection）都開這個彈窗；同一則訊息只自己跳一次（關掉之後不再煩人）。
// 「回報錯誤」⇒ 多一格讓玩家寫發生什麼事；「寄出」⇒ mailto: 打開玩家的郵件程式（⛔ 成品不准 fetch：admin.py vxk_inline 檢查）：
//   主旨帶訊息開頭，內文 ＝ 錯誤訊息（最多 ERR_MAX 字，信太長有的郵件程式打不開）＋ 玩家寫的 ＋ 遊戲狀態（errState）＋ 網址、時間、瀏覽器、成品的來源指紋。寄不寄由玩家決定。
//   「複製內容」⇒ 同一份文字放進剪貼簿（郵件程式打不開、或想貼到 Discord 的時候用）。
// 寄不出去（Tim 2026-10-18「我發現沒跳出郵件程式…排查一下為何沒有辦法發信」）：
//   ① 網址太長：中文 encodeURIComponent 一個字 9 個字元，那一封回報的 mailto 網址 2575 字 ⇒ Windows 上交給郵件程式的網址超過約 2083 字就開不起來，也不報錯。
//   ② 那台電腦 mailto 的預設程式指到一個查不到註冊的 App（登錄檔 UrlAssociations\mailto 的 ProgId）⇒ 一樣什麼都不跳。
//   ⇒「寄出」先把完整內容複製起來；網址超過 ERR_URL ⇒ 信裡只放短版（玩家寫的、錯誤第一行、版本）＋「完整內容在剪貼簿，貼上」；
//     1.5 秒內視窗沒失焦（郵件程式沒搶到前景）⇒ 彈窗裡寫「沒跳出郵件程式」與收件地址。
// 手動回報（主選單「問題回報…」，Tim 2026-10-18）：errShow(null) ⇒ 標題「問題回報」、沒有錯誤訊息、直接打開填寫欄；內文的錯誤訊息寫「手動回報」。
// 送到 Discord（Tim 2026-10-18「幫我額外傳送資訊到這個Discord webhook吧」，參考其他遊戲：按一下就送到開發者）：config report.webhook 有填才出「送出回報」。
//   ⚠ 這是成品裡唯一一處連網：玩家按了才送、送不出去就照實說（沒網路、被擋）並指向「寄出」「複製內容」；不送也不影響遊戲（零外部依賴照舊成立）。
//     用 XMLHttpRequest（Discord 的 webhook 回 CORS 允許 persona9999.github.io ⇒ 讀得到結果）；multipart：payload_json（短訊息）＋ report.txt（完整內容）＋ 截圖（可選，JPEG）。
//   ⚠ webhook 網址在成品裡看得到 ⇒ 誰都能拿去送訊息：allowed_mentions 全關（不會 @ 人）、內容截長、兩次至少隔 report.cooldown 秒、開一次遊戲最多 report.perSession 則、同一份不重送；
//     被濫用 ⇒ 在 Discord 重建 webhook、換 game.json 那一格。
var ERR_MAIL = 'tim11251994@gmail.com', ERR_MAX = 1500, ERR_URL = 1900, ERR_SEEN = {}, ERR_NOW = '';
//   設定檔存的是 x1:…（admin.py hook_enc；Tim 2026-10-18「把網址加密在填」）⇒ hookDec 解開。⚠ 混淆不是加密：鑰匙就在這裡（擋掃 repo 的機器人與順手一瞥）。
var HOOK_KEY = 'Blockside/report/x1';                                   // ⛔ 跟 admin.py HOOK_KEY 同一串（改一邊另一邊解不開 ⇒ 沒有「送出回報」）
function hookDec(s) {
  if (typeof s !== 'string' || s.indexOf('x1:') !== 0) return '';
  try {
    var b = atob(s.slice(3).replace(/-/g, '+').replace(/_/g, '/')), u = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i) ^ HOOK_KEY.charCodeAt(i % HOOK_KEY.length);
    return new TextDecoder().decode(u);
  } catch (e) { return ''; }
}
var ERR_RP = CFG.report || {}, ERR_HOOK = hookDec(ERR_RP.webhook);
if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(ERR_HOOK)) ERR_HOOK = '';
var ERR_POST = { n: 0, t: -1e9, sent: {} };
function errShow(msg) {
  var e = $('err'); if (!e) return;
  var hand = msg === null;
  msg = hand ? '' : String(msg); if (!hand) ERR_SEEN[msg] = 1; ERR_NOW = msg;
  $('errH').textContent = hand ? '問題回報' : '出錯了'; $('errMsg').hidden = hand;
  $('errMsg').textContent = msg; $('errRep').hidden = !hand; $('errSend').hidden = !hand; $('errCopy').hidden = !hand; $('errPost').hidden = !hand || !ERR_HOOK; $('errRepB').hidden = hand; $('errTxt').value = '';
  $('errNote').textContent = (ERR_HOOK ? '按「送出回報」直接送給開發者（Discord）：上面的錯誤訊息、這段文字、遊戲狀態（玩法、編成、畫質、裝置…）與截圖。送不出去 ⇒ 用「寄出」或「複製內容」。'
    : '按「寄出」會先把完整內容（上面的錯誤訊息、這段文字、遊戲狀態：玩法、編成、畫質、裝置…）複製起來，再打開你的郵件程式；寄不寄由你決定。') + '郵件程式沒跳出來 ⇒ 把複製的內容貼到信裡寄到 ' + ERR_MAIL + '，或貼到 Discord。';
  $('errHint').hidden = true; $('errShotL').hidden = !ERR_HOOK; $('errPost').disabled = false;
  $('errPost').className = ERR_HOOK ? 'pri' : ''; $('errSend').className = ERR_HOOK ? '' : 'pri';
  e.style.display = 'flex';
  if (hand) $('errTxt').focus();
}
function errFp() { try { return JSON.parse(document.getElementById('blockside-src').textContent).fp; } catch (x) { return '?'; } }   // 成品的來源指紋（admin.py src_stamp）
/** 遊戲狀態（Tim 2026-10-18：「錯誤回報可以打包遊戲內其他參數資訊一起回傳」）：一行一項，每一行各自 try（載入一半出錯 ⇒ 讀不到的寫原因，其他照寫）；存檔那一行不列 v（版本號，每次都有）。 */
function errState() {
  function L(k, f) { try { return k + '：' + f(); } catch (x) { return k + '：（讀不到：' + (x && x.message || x) + '）'; } }
  var st = function (s) { return s.sunk ? '沉' : s.sinkingFinal ? '沉沒中' : s.struck ? '降旗' : ''; };
  return [
    L('遊戲', function () { return MODE + '／' + PLAY + '／' + (RUNNING ? '打仗中 ' + SIMT.toFixed(1) + ' 秒' + (PAUSED ? '（暫停）' : '') : '主選單') + '／種子 ' + SEED; }),
    L('編成', function () { return '我方 ' + FLEET_SET[0].join(',') + '｜敵方 ' + FLEET_SET[1].join(',') + '／同時在場 ' + FIELD_N + '／補位 ' + REINF_MODE; }),
    L('場上', function () { return (SHIPS.map(function (s) { return (s.i === PLAYER_I ? '*' : '') + s.T.id + (s.team === 'blue' ? '藍' : '紅') + st(s); }).join(' ') || '（沒有）') + '／候補 藍 ' + RESERVE.blue.length + '、紅 ' + RESERVE.red.length; }),
    L('畫質', function () { return gfxLevel() + '（裝飾' + (GFX.deco ? '開' : '關') + '、解析度 ' + GFX.res + '）／物理 ' + phxLevel() + '／天氣 ' + WX_ID; }),
    L('存檔', function () { var k = Object.keys(prefsSnap()).filter(function (x) { return x !== 'v'; }); return (PREFS.read ? '有讀' : '沒讀') + '；改過 ' + k.length + ' 項' + (k.length ? '：' + k.join(',').slice(0, 300) : ''); }),
    L('載入', function () { var v = window.__vxk; return v ? '解碼 ' + v.decodeMs + ' ms、網格 ' + v.meshMs + ' ms、快取' + (v.cache && v.cache.hit ? '有' : '沒有') : '還沒載完'; }),
    L('裝置', function () { return '螢幕 ' + screen.width + '×' + screen.height + '、視窗 ' + innerWidth + '×' + innerHeight + '、DPR ' + devicePixelRatio + '、核心 ' + (navigator.hardwareConcurrency || '?') + '、記憶體 ' + (navigator.deviceMemory || '?') + ' GB、觸控 ' + (navigator.maxTouchPoints || 0); }),
    L('GPU', function () { if (!gl) return '沒有 WebGL2'; var x = gl.getExtension('WEBGL_debug_renderer_info'); return x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); }),
    L('JS 記憶體', function () { var m = performance.memory; return m ? Math.round(m.usedJSHeapSize / 1048576) + ' / ' + Math.round(m.jsHeapSizeLimit / 1048576) + ' MB' : '（這個瀏覽器不給）'; })
  ].join('\n');
}
/** 回報的內文（寄信、複製同一份）。 */
function errBody() {
  var msg = !ERR_NOW ? '（手動回報，沒有錯誤訊息）' : ERR_NOW.length > ERR_MAX ? ERR_NOW.slice(0, ERR_MAX) + '…（後面截掉 ' + (ERR_NOW.length - ERR_MAX) + ' 字）' : ERR_NOW;
  return '錯誤訊息：\n' + msg + '\n\n玩家回報：\n' + ($('errTxt').value.trim() || '（沒寫）') + '\n\n遊戲狀態：\n' + errState() +
    '\n\n網址：' + location.href + '\n時間：' + new Date().toISOString() + '\n瀏覽器：' + navigator.userAgent + '\n版本：' + errFp();
}
/** mailto 網址（主旨＋內文）；太長 ⇒ 內文換短版（玩家寫的、錯誤第一行、版本；完整的在剪貼簿）。回傳 [網址, 有沒有換短版]。 */
function errMailUrl(body) {
  var said = $('errTxt').value.trim();
  var subj = ERR_NOW ? 'Blockside 錯誤回報：' + ERR_NOW.split('\n')[0].slice(0, 60) : 'Blockside 問題回報：' + (said.split('\n')[0].slice(0, 40) || '（手動）');
  function url(b) { return 'mailto:' + ERR_MAIL + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(b); }
  var u = url(body); if (u.length <= ERR_URL) return [u, false];
  var head = '（完整內容太長、郵件程式收不下 —— 已複製到剪貼簿，請在這裡按 Ctrl+V 貼上）\n\n玩家回報：\n' + (said || '（沒寫）') +
    (ERR_NOW ? '\n\n錯誤：' + ERR_NOW.split('\n')[0].slice(0, 120) : '') + '\n版本：' + errFp();
  u = url(head);
  while (u.length > ERR_URL && head.length > 40) { head = head.slice(0, Math.floor(head.length * 0.8)) + '…'; u = url(head); }   // 玩家寫了很長一段 ⇒ 再縮（剪貼簿裡有全文）
  return [u, true];
}
/** 放進剪貼簿 ⇒ done(成功沒)。 */
function errClip(t, done) {
  if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t).then(function () { done(true); }, function () { done(false); }); return; }
  var a = $('errTxt'), v = a.value; a.value = t; a.select(); var r = false; try { r = document.execCommand('copy'); } catch (x) {} a.value = v; done(r);   // 舊瀏覽器：借輸入格選起來複製
}
function errMail() {
  var body = errBody(), U = errMailUrl(body), hint = $('errHint'), left = false;
  function onBlur() { left = true; }
  window.addEventListener('blur', onBlur);
  errClip(body, function (ok) {
    location.href = U[0];
    setTimeout(function () {
      window.removeEventListener('blur', onBlur);
      hint.hidden = false;
      hint.textContent = left ? '已交給郵件程式' + (U[1] ? '（信裡是短版，完整內容' + (ok ? '已複製，請貼進信裡' : '複製不了，請按「複製內容」') + '）' : '') + '；在郵件程式裡按傳送才會寄出。'
        : '沒跳出郵件程式？（這台電腦可能沒設定預設的郵件程式）⇒ ' + (ok ? '完整內容已複製' : '請先按「複製內容」') + '，貼到信裡寄到 ' + ERR_MAIL + '，或貼到 Discord。';
    }, 1500);
  });
}
function errCopy() {
  var b = $('errCopy');
  errClip(errBody(), function (r) { b.textContent = r ? '已複製' : '複製不了'; setTimeout(function () { b.textContent = '複製內容'; }, 1500); });
}
/** 送到 Discord（見檔頭）：短訊息（2000 字內）＋ report.txt（完整內容）＋ 截圖（勾了才附；畫布保留了上一格 ⇒ toBlob 拿得到彈窗後面的畫面）。結果寫進 errHint。 */
function errPost() {
  var hint = $('errHint'), b = $('errPost'), body = errBody(), now = performance.now() / 1000, cd = +ERR_RP.cooldown > 0 ? +ERR_RP.cooldown : 60, mx = +ERR_RP.perSession > 0 ? +ERR_RP.perSession : 5;
  function say(t) { hint.hidden = false; hint.textContent = t; }
  if (!ERR_HOOK) return;
  var key = ($('errTxt').value.trim() + '|' + ERR_NOW).slice(0, 4000);
  if (ERR_POST.sent[key]) { say('這一則已經送過了。'); return; }
  if (ERR_POST.n >= mx) { say('這次開遊戲已經送了 ' + mx + ' 則 ⇒ 請用「複製內容」貼到 Discord。'); return; }
  if (now - ERR_POST.t < cd) { say('送太快了 —— 再等 ' + Math.ceil(cd - (now - ERR_POST.t)) + ' 秒。'); return; }
  b.disabled = true; say('送出中…');
  var said = $('errTxt').value.trim(), head = (ERR_NOW ? '🐞 **錯誤回報**' : '📝 **問題回報**') + '（版本 ' + errFp() + '）';
  var msg = head + '\n> ' + (said || '（沒寫）').slice(0, 900).replace(/\n/g, '\n> ') + (ERR_NOW ? '\n```\n' + ERR_NOW.split('\n').slice(0, 3).join('\n').slice(0, 600).replace(/```/g, "'''") + '\n```' : '');
  var shot = $('errShot').checked;
  function send(img) {
    var fd = new FormData();
    fd.append('payload_json', JSON.stringify({ username: 'Blockside 回報', content: msg.slice(0, 1990), allowed_mentions: { parse: [] } }));
    fd.append('files[0]', new Blob([body], { type: 'text/plain;charset=utf-8' }), 'report.txt');
    if (img) fd.append('files[1]', img, 'screenshot.jpg');
    var x = new XMLHttpRequest();
    x.open('POST', ERR_HOOK + '?wait=true'); x.timeout = 20000;
    x.onload = function () {
      if (x.status >= 200 && x.status < 300) { ERR_POST.n++; ERR_POST.t = performance.now() / 1000; ERR_POST.sent[key] = 1; say('✓ 已送出，謝謝回報！（Discord' + (img ? '，含截圖' : '') + '）'); return; }
      b.disabled = false; say('✗ 送不出去（HTTP ' + x.status + (x.status === 429 ? '：送太多了，等一下再試' : '') + '）⇒ 請用「寄出」或「複製內容」。');
    };
    x.onerror = x.ontimeout = function () { b.disabled = false; say('✗ 送不出去（沒有網路、或被瀏覽器擋下）⇒ 請用「寄出」或「複製內容」。'); };
    x.send(fd);
  }
  if (shot && cv.toBlob) { try { cv.toBlob(function (img) { send(img); }, 'image/jpeg', 0.85); return; } catch (e) { } }   // 畫布被汙染之類拿不到 ⇒ 不附截圖照送
  send(null);
}
$('errX').onclick = function () { $('err').style.display = 'none'; };
$('errRepB').onclick = function () { $('errRep').hidden = false; $('errSend').hidden = false; $('errCopy').hidden = false; $('errPost').hidden = !ERR_HOOK; $('errRepB').hidden = true; $('errTxt').focus(); };
$('errSend').onclick = errMail; $('errCopy').onclick = errCopy; $('errPost').onclick = errPost;
$('gsRep').onclick = function () { errShow(null); };   // 遊戲內設定（⚙，暫停中）「問題回報」：手動回報（沒有錯誤訊息）；主選單的「問題回報…」由外殼接（71_input.js）
function errAuto(m) { m = String(m || ''); if (!m || m === 'Script error.' || /ResizeObserver/.test(m) || ERR_SEEN[m] || $('err').style.display === 'flex') return; errShow(m); }   // 跨網域的「Script error.」、ResizeObserver 的警告不跳；開著的不換掉（glFail 之後的 throw 不蓋掉那一句好懂的）
window.addEventListener('error', function (ev) { errAuto(ev.error && ev.error.stack ? ev.error.message + '\n' + ev.error.stack : ev.message); });
window.addEventListener('unhandledrejection', function (ev) { var r = ev.reason; errAuto(r && r.stack ? (r.message || r) + '\n' + r.stack : r); });
if (!gl) { glFail('這個瀏覽器沒有 WebGL2，畫不出來。'); throw new Error('no WebGL2'); }   // 拆檔後這裡是閉包的頂層：throw ＝ 原本的 return（停下來）

var P = {};
var SEA_SHORE = [0.0, 3.0, 0.12];                                       // 岸邊浪變小（P.water；TASK-0818）：水深幾公尺起變小、幾公尺以上照舊；岸上海面壓低幾公尺
// 不卡畫面的著色器（TASK-0816）：KHR_parallel_shader_compile ⇒ 先送出編譯、連結（glProgStart），每格問好了沒（glProgReady），好了才拿（glProgEnd：跟 VK.compile 一樣的 { prog, u }、編不過照樣丟錯）。
//   以前第一次畫城鎮時一口氣編 5 支、等到編完（VK.compile 問 COMPILE_STATUS ⇒ 主執行緒等驅動）：皇家港外進航海 +4.6 秒那一格 633 ms。沒有這個擴充 ⇒ glProgReady 一律 true（照舊等）。
var GL_PAR = gl && gl.getExtension('KHR_parallel_shader_compile');
function glProgStart(vs, fs) {
  var p = gl.createProgram(), S = [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].map(function (a) { var s = gl.createShader(a[0]); gl.shaderSource(s, a[1]); gl.compileShader(s); gl.attachShader(p, s); return s; });
  gl.linkProgram(p); return { p: p, S: S, src: [vs, fs] };
}
function glProgReady(J) { return !GL_PAR || gl.getProgramParameter(J.p, GL_PAR.COMPLETION_STATUS_KHR); }
function glProgEnd(J) {
  var p = J.p, u = {}, i, n;
  J.S.forEach(function (s, k) { if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('著色器編譯失敗：' + gl.getShaderInfoLog(s) + '\n' + J.src[k].split('\n').slice(0, 3).join('\n')); });
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('著色器連結失敗：' + gl.getProgramInfoLog(p));
  for (i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) { var a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, a.name); }
  return { prog: p, u: u };
}
// 先送出、晚點拿（同一串原始碼）：GL_WARM ⇒ VK.compile 遇到送出過的那一串 ⇒ 直接拿（已經編好就不等）；glProgTry ⇒ 還沒編好回 null（呼叫的那一格先不畫）。
//   GL_BATCH（programs()）：這段時間 VK.compile 只送出、回一個空的 { prog, u }，整批送完才一支一支拿 ⇒ 驅動同時編，不是一支等完再下一支。
//   皇家港外進航海（2026-10-22，改之前）：著色器一共 5.0 秒 —— 地形 P.bed 一支 2.6 秒（第一次 bedDraw）、開機那一批 1.1 秒、城鎮 0.6 秒；都在地球儀往下飛的那幾秒裡（同一條執行緒）。
var GL_WARM = {}, GL_BATCH = null;
function glWarm(vs, fs) { var k = vs + '\u0000' + fs; return GL_WARM[k] || (GL_WARM[k] = glProgStart(vs, fs)); }
function glProgTry(vs, fs) { var k = vs + '\u0000' + fs, J = glWarm(vs, fs); if (!glProgReady(J)) return null; delete GL_WARM[k]; return glProgEnd(J); }
(function () {
  var c0 = VK.compile;
  VK.compile = function (g, vs, fs) {
    if (g !== gl) return c0(g, vs, fs);
    var k = vs + '\u0000' + fs, J = GL_WARM[k];
    if (J) { delete GL_WARM[k]; return glProgEnd(J); }
    if (GL_BATCH && GL_PAR) { var o = { prog: null, u: null }; GL_BATCH.push([glProgStart(vs, fs), o]); return o; }
    return c0(g, vs, fs);
  };
})();
// 陰影（畫質；60_render.js shadowPass）：照鏡頭切成幾段距離（cascade，Tim 2026-10-20「改用其他遊戲常見的 shadow cascades 取代每艘船自己的陰影(且陸地也吃得到)」「基於Camera配置陰影」）：
//   一段一層（太陽方向的正交投影 uShM[k]，罩住那一段視錐），船、地形、樹、城鎮都畫在裡面；全部放在同一個深度貼圖陣列 uShA（固定第 4 號）。
//   收的那一點照離鏡頭多深（沿鏡頭往前的方向 uCsF、從 uCsE 量）挑第一個「遠端 uCsD[k] 比它深」的那一段；從 uCsL[k] 到遠端那一截跟下一段混（畫質頁的「交界」；最後一段 ⇒ 淡成沒有影子），
//   ⇒ 交界看不到一條線、超過陰影距離不是一刀切掉。uCsN ＝ 幾段（0 ＝ 不查）。
//   每段自己的沿法線推出去 uCsO[k]（約 1.5 個陰影圖格子，公尺）與深度偏差 uCsB[k]（照那一段的格子大小換成公尺、再換成那一段的深度單位）
//   ⇒ 近的那段格子細、推得少（影子貼著船身、樹根），遠的那段格子粗、推得多（⛔ 不推 ⇒ 平面上自己遮自己的條紋）。
//   uShOn ＝ 0 關、1 柔邊 4 點、2 柔邊 9 點（畫質頁「低／高：柔邊取樣」），每一點相隔 uShSoft 格（「柔邊寬度」）；陽光越斜推越遠（呼叫端把法線乘 1～3 倍：斜面在陰影圖上一格跨的深度大）。
// uClip：反射那一趟丟掉水面以下的（平常是 −10⁹）。
// uSunK：直射光的強度（天氣；晴天 1）—— 收陰影的地方都乘 shadowK，順便乘在這裡。
// 低於海平面的乾地（63_bed_gl.js BEDDRY；TASK-0768）：海與遠海的著色器照這張遮罩（32 m 一格、蓋整個海域的窗）丟掉 0 m 的海面 —— 恩里基約湖 −40 m 的湖岸、湖面不被海蓋住。
//   uDryOn ＝ 0（沒有這種地的海域、沒有海圖）⇒ 一律 false ⇒ 畫面逐位元組不變。
var BED_DRY_GLSL = 'uniform float uDryOn; uniform vec4 uDryR; uniform sampler2D uDryT;\n' +
  'bool bedDry(vec2 p){ if(uDryOn<0.5) return false; vec2 u=(p-uDryR.xy)/uDryR.zw; return u.x>0.0&&u.y>0.0&&u.x<1.0&&u.y<1.0&&textureLod(uDryT,u,0.0).r>0.5; }\n';
var DEPTH_ONLY_FS = '#version 300 es\nprecision highp float; void main(){}\n';   // 只寫深度（陰影的靜態那一層：地形、樹、城鎮拿自己的頂點著色器配這一支；60_render.js csmStatic）
var CSM_MAX = 4, NS_MK = String(MASK_NEAR);                             // 陰影最多幾段（60_render.js CSM_N）、船艙遮罩的陣列長度照 MASK_NEAR（00_core.js）
var SHADOW_GLSL = 'uniform highp sampler2DArrayShadow uShA; uniform mat4 uShM[' + CSM_MAX + ']; uniform float uShOn, uShPx, uClip, uSunK; uniform int uCsN;\n' +
  'uniform float uCsD[' + CSM_MAX + '], uCsL[' + CSM_MAX + '], uCsO[' + CSM_MAX + '], uCsB[' + CSM_MAX + ']; uniform vec3 uCsE, uCsF; uniform float uShSoft, uShE0, uShTr;\n' +
  'float shOne(int k, vec3 w, float bz){ vec4 p=uShM[k]*vec4(w,1.0); vec3 q=p.xyz*0.5+0.5;\n' +
  '  if(q.x<0.002||q.y<0.002||q.x>0.998||q.y>0.998||q.z>0.999) return 1.0; q.z-=bz; float L=float(k);\n' +
  // 柔邊（PCF；其他遊戲常見的做法，Tim 2026-10-20「有時候陰影會閃爍」「是否有辦法參考其他遊戲作法改善」）：每一點是硬體的 2×2 比較（雙線性）；
  //   低 ＝ 2×2 點（相隔 1 格 ⇒ 約 3×3 格的軟邊）、高 ＝ 3×3 點（約 4×4 格）⇒ 船在格子上移動時影子的邊不會一格一格地爬
  '  float e=uShPx*uShSoft; if(uShOn<1.5) return 0.25*(texture(uShA,vec4(q.xy+vec2(-0.5,-0.5)*e,L,q.z))+texture(uShA,vec4(q.xy+vec2(0.5,-0.5)*e,L,q.z))+texture(uShA,vec4(q.xy+vec2(-0.5,0.5)*e,L,q.z))+texture(uShA,vec4(q.xy+vec2(0.5,0.5)*e,L,q.z)));\n' +
  '  float s=0.0; for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) s+=texture(uShA,vec4(q.xy+vec2(float(x),float(y))*e,L,q.z)); return s/9.0; }\n' +
  // uShEdge（單張陰影，60_render.js shadowSimple）：範圍最外面那一圈（85%～98%）淡掉 ⇒ 範圍外的影子不是一刀切掉；照鏡頭分段時 0（段的範圍比要用的大一圈）
  'uniform float uShEdge; float shAt(int k, vec3 w, vec3 n){ vec4 p=uShM[k]*vec4(w,1.0); float ed=max(abs(p.x),abs(p.y)); return mix(shOne(k,w+n*uCsO[k],uCsB[k]),1.0,uShEdge*smoothstep(uShE0,0.98,ed)); }\n' +
  'float shadowK(vec3 w, vec3 n){ if(uShOn<0.5||uCsN<1) return uSunK; float d=dot(w-uCsE,uCsF); int k=-1;\n' +
  ' for(int i=0;i<' + CSM_MAX + ';i++){ if(i>=uCsN) break; if(d<uCsD[i]){ k=i; break; } }\n' +
  ' if(k<0) return uSunK; float s=shAt(k,w,n), t=smoothstep(uCsL[k],uCsD[k],d);\n' +
  ' if(t>0.0) s=mix(s,k+1<uCsN?shAt(k+1,w,n):1.0,t); return s*uSunK; }\n';
// 船艙遮罩（海、船邊水花的白沫共用；要有 in vec3 vW）：那一點換到船的格座標，落在原本船殼的外形裡 ⇒ 呼叫端丟掉（HULL_HIT）。
//   遮罩照船型一層（uHullA：R8 貼圖陣列，每層 ＝ 那一型每個 (x, z) 船殼的半寬；固定第 1 號；60_render.js hullArr）；
//   格（60_render.js gpuSlots：視野裡最近的 GFX.masks 艘，最多 MASK_NEAR）：uInv[k]（世界 → 格）、uHullK[k] ＝ (那一型的寬, 高, 中線 y, 第幾層)、
//   uHide[k] ＝ 那艘還沒開始沉（60_render.js hullUniforms）。沒用到的那幾格 uHide 0 ⇒ 一比就跳過、不取樣。uNM ＝ 用到幾格（透視 nearAny 也照它）。
var HULL_GLSL = 'uniform mat4 uInv[' + NS_MK + ']; uniform float uHide[' + NS_MK + ']; uniform highp sampler2DArray uHullA; uniform vec4 uHullK[' + NS_MK + ']; uniform int uNM;\n' +
  'bool inHull(int k){ vec4 K=uHullK[k]; vec4 l=uInv[k]*vec4(vW,1.0); if(l.x<0.0||l.z<0.0||l.x>=K.x||l.z>=K.y) return false; float hb=texelFetch(uHullA,ivec3(int(l.x),int(l.z),int(K.w)),0).r*255.0; return hb>0.0 && abs(l.y-K.z)<hb; }\n' +
  'bool hullHit(){ for(int k=0;k<' + NS_MK + ';k++) if(uHide[k]>0.5&&inHull(k)) return true; return false; }\n';
var HULL_HIT = 'hullHit()';                                              // 落在哪一艘的船艙裡
// 剖面與隱藏甲板（停格；74_cutaway.js）：照船的格座標丟掉 —— uCut ＝ (中線 y, 剖哪一邊 ±1（0 ＝ 不剖）, 拿掉到第幾層（−1 ＝ 不拿）, 開關)；
//   uCutT：那艘船型每一層的切高（R32F，寬 ＝ 格的 x、高 ＝ 層；照舷弧逐欄），uCutW.x ＝ 寬。模型、繩、帆另給 uCutInv（世界 → 格）。
//   uCutT 一律指第 8 號（setCommon；沒開時綁 1×1 的空貼圖）：⛔ 預設的第 0 號 ⇒ 那一號綁著正在畫的畫布的貼圖時，整次繪製被丟掉（Feedback loop，量到 203 筆警告）——
//   就算分支沒走到，驅動照樣檢查程式裡每一個取樣器。
var CUT_GLSL = 'uniform highp sampler2D uCutT; uniform vec4 uCut; uniform vec2 uCutW;\n' +
  'bool cutOut(vec3 l){ if(uCut.w<0.5) return false; if(uCut.y*(l.y-uCut.x)>0.0) return true;\n' +
  '  return uCut.z>=0.0 && l.z>=texelFetch(uCutT,ivec2(clamp(int(floor(l.x)),0,int(uCutW.x)-1),int(uCut.z)),0).r; }\n';
// 點光源（Tim 2026-10-14「點燈」：夜燈號船首像的提燈 meta kind=light、餘燼號船尾的燈籠 kind=lantern；60_render.js lampsUpdate）：
//   最多 LAMP_N 盞（離鏡頭近的先）；uLP ＝ 世界座標＋照得到幾公尺、uLC ＝ 顏色×亮度。照亮船殼（voxFS）與模型（P.tri）：距離平方衰減到半徑為 0、朝著燈的面亮一點。⛔ 不投影子。
// 船殼上的燈（格子做的，不是模型；config/game.json ships[].lamps，Tim 2026-10-14：風暴角號船尾的燈改發綠光）：那艘船畫的時候 uVG ＝ 燈的中心（船的格座標）＋半徑、
//   uVGC ＝ 光色＋格子的顏色代碼（rgb332）⇒ 半徑內、顏色對得上的格子發光（60_render.js drawHulls 每艘設；斷開的那一團 ⇒ 0 盞）。
var VLAMP_N = 4, LAMP_N = 8, LAMP_GLSL = 'uniform vec4 uLP[' + LAMP_N + ']; uniform vec4 uLC[' + LAMP_N + ']; uniform int uLN; uniform vec4 uVG[' + VLAMP_N + ']; uniform vec4 uVGC[' + VLAMP_N + ']; uniform int uVGN; uniform float uVGK;\n' +
  'vec3 lampK(vec3 w, vec3 n){ vec3 s=vec3(0.0); for(int i=0;i<' + LAMP_N + ';i++){ if(i>=uLN) break; vec3 L=uLP[i].xyz-w; float d=length(L), a=clamp(1.0-d/uLP[i].w,0.0,1.0);\n' +
  ' s+=uLC[i].rgb*a*a*(0.35+0.65*max(dot(n,L/max(d,0.001)),0.0)); } return s; }\n';
// 帆燒起來（TASK-0717；Tim 2026-10-18「帆也可以燒起來(可以嘗試真的燒掉帆的演出 出現邊緣焦黑以及逐漸燒掉)」）：每個頂點帶 aF ＝ (火燒到的時間 a, 撲滅的時間 x, 雜訊座標 u, v)
//   （11_rig_gpu.js sailBuf ← 49_burn.js s.burn；沒燒過 a ＝ 1e6 ⇒ 整段跳過、跟以前一模一樣）。
//   燒的進度 b ＝ (min(現在, x) − a) ÷ uFireT（燒到穿要幾秒，burn.sailBurn）＋ 兩層雜訊（邊緣不是直線）：b ＞ 1 ⇒ 洞（discard，陰影那一支也是）；
//   −0.3～0.05 焦黃、0.05～0.8 焦黑、0.7 以上還在燒（現在 ＜ x）⇒ 燒口一圈火紅（em，加在打光後、霧之前）。⛔ 用 if，不寫巢狀的三元（D3D11 編不過）。
var BURN_GLSL = 'uniform float uFireT;\n' +
  'float bnH(vec2 q){ return fract(sin(dot(q,vec2(127.1,311.7)))*43758.5453); }\n' +
  'float bnN(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(bnH(i),bnH(i+vec2(1.0,0.0)),f.x),mix(bnH(i+vec2(0.0,1.0)),bnH(i+vec2(1.0,1.0)),f.x),f.y); }\n' +
  'float bnB(vec4 F,float t){ return (min(t,F.y)-F.x)/uFireT+(bnN(F.zw*1.6)-0.5)*0.55+(bnN(F.zw*5.1)-0.5)*0.2; }\n';
// 帆破洞的毛邊（render 管線大修 R3，TASK-0791；Tim 2026-10-21「帆破洞邊緣可以一起做嗎(參考火燒 做出撕裂感)」）：每個頂點帶 aH ＝ (離洞幾圈, u, v)
//   （11_rig_gpu.js sailRagH：洞邊上的點 0、隔一個三角形 1、更遠 SAIL_RAG_FAR ⇒ 整段跳過；布片的外緣 SAIL_RAG_SH；u、v ＝ 這一面攤得最開的兩個軸、以細格為單位
//   ⇒ 布被吹動時毛邊跟著布、不會滑，毛邊大小跟著格走）。
//   吃多深 w ＝ 慢的雜訊（兩格多一個起伏：邊有的地方咬得深、有的淺）＋ 兩層快的（半格、六分之一格：紗）；e ＝ 內插的離洞幾圈 − w：
//   e ＜ 0 ⇒ 洞（discard，陰影那一支同一條）；0～RAG_BAND ⇒ 散開的紗：暗一點、偏黃。離洞越遠 e 越大 ⇒ 吃掉的都連著洞（不會在布中間開小孔）。
//   ⛔ 只吃掉還在的布（不在的三角形照舊疊成一點、不畫）⇒ 洞只會變大、不會補起來；吃最深 0.74 格（平均 0.3 格），不到第二圈。
var RAG_BAND = '0.08';
var RAG_GLSL = 'float rgE(vec3 H){ vec2 q=H.yz; return H.x-(0.06+0.5*bnN(q*0.45)+(bnN(q*2.3+vec2(17.0,3.0))-0.5)*0.24+(bnN(q*6.5+vec2(5.0,41.0))-0.5)*0.12); }\n';
// 一次畫多個（instanced；render 管線大修 S4）：P.triI／P.dtriI ＝ P.tri／P.dtri 的頂點著色器只換「uModel 從哪裡來」—— uMs[gl_InstanceID]（第幾個就讀第幾格），
//   算式一個字不動、片段著色器同一串（uGlow 照舊是 uniform：燈不一樣的分開畫）；屬性、VAO 不動（沒有 divisor、不加 VAO）。gl_InstanceID 每次畫都從 0 起（WebGL2 沒有 base instance）。
//   一次最多 INST_K 個：uMs 一個 mat4 佔 4 格，留 16 格給 uVP 與其他 ⇒ 照 MAX_VERTEX_UNIFORM_VECTORS（WebGL2 最低 256 ⇒ 60；量測那台 4095 ⇒ 上限 64）。
//   ⛔ GLSL 不保證動態索引的陣列跟單一個 uniform 編出一樣的算式 ⇒ 用之前先量：60_rbatch.js __rbatProbe（轉換回饋逐位元比）＋ 量測工具的畫面。
//   ⛔ 不准為了對上去改 P.tri／P.dtri 的原始碼（每個用它的地方的畫面都會變）。
var INST_MAX = 64, INST_K = 16;
var TRI_VS = '', TRI_FS = '', DTRI_VS = '';                              // P.tri、P.dtri 的原始碼（programs() 給值：SEA_GLSL 在後面的檔）；一次畫多個、對拍的分身都拿同一串
/** P.tri／P.dtri 的頂點著色器 ⇒ 一次畫多個的那一份：'uniform mat4 uModel,uVP;' 換成 uMs[INST_K]、main 一開頭 uModel ＝ uMs[gl_InstanceID]，其他一個字不動。
 *  兩段各要剛好一處；不是 ⇒ 丟出去（programs() 接住 ⇒ 那一支是 null、照舊一個一個畫）。 */
function instVS(s) {
  var a = 'uniform mat4 uModel,uVP;', b = 'void main(){ ';
  if (s.split(a).length !== 2 || s.split(b).length !== 2) throw new Error('instVS：「' + a + '」「' + b + '」要各剛好一處');
  return s.replace(a, 'uniform mat4 uMs[' + INST_K + '],uVP;').replace(b, b + 'mat4 uModel=uMs[gl_InstanceID]; ');
}
function programs() {
  GL_BATCH = [];                                                         // 整批送出、最後才拿（見 GL_BATCH）
  var cd = gl.createTexture(); gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, cd);   // 第 8 號：剖面切高的空貼圖（見 CUT_GLSL）
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array([1e9]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.activeTexture(gl.TEXTURE0);
  if (!SHELLT.tex) shellTexInit();                                       // 第 18 號：外殼式的貼圖陣列（62_shell.js；先給 1 層空的）
  P.vox = VK.compile(gl, VK.VOXEL_VS, voxFS());
  P.deb = VK.compile(gl,
    '#version 300 es\nlayout(location=0) in vec3 aP; layout(location=1) in vec3 aN; layout(location=2) in vec4 iP; layout(location=3) in vec4 iQ; layout(location=4) in float iC;\n' +
    'uniform mat4 uVP; out vec3 vN; out vec3 vW; flat out float vC;\n' +
    'vec3 rq(vec4 q, vec3 v){ return v+2.0*cross(q.xyz, cross(q.xyz,v)+q.w*v); }\n' +
    'void main(){ float k=floor(iC/256.0); vec3 sc=k<0.5?vec3(1.0):k<1.5?vec3(3.2,1.1,0.22):k<2.5?vec3(2.3,1.5,0.22):vec3(4.6,0.8,0.25);\n' +   // DEB_SHAPES：形狀 ＝ iC 的 256 以上（12_effects.js D.sh）；片狀的碎塊長寬厚
    ' vec3 w=iP.xyz+rq(iQ,aP*iP.w*sc); vW=w; vN=rq(iQ,aN); vC=iC-k*256.0; gl_Position=uVP*vec4(w,1.0); }\n',
    '#version 300 es\nprecision highp float;\n' + SEA_GLSL + 'in vec3 vN; in vec3 vW; flat in float vC; uniform vec3 uSun,uEye,uFog,uSky,uGround; uniform float uFogD,uLum; out vec4 o;\n' +
    'void main(){ uint c=uint(vC+0.5); vec3 b=vec3(float((c>>5u)&7u)/7.0,float((c>>2u)&7u)/7.0,float(c&3u)/3.0); vec3 n=normalize(vN);\n' +
    ' vec3 col=b*(mix(uGround,uSky,n.y*0.5+0.5)*0.62+vec3(1.0,0.96,0.88)*max(dot(n,uSun),0.0)*0.78);\n' +
    ' col*=uLum; float fd=length(vW-uEye); o=vec4(mix(col,uFog,1.0-exp(-fd*uFogD)),1.0); }\n');
  TRI_VS =                                                               // 模型（P.tri；一次畫多個的 P.triI 也是這一串，見 instVS）
    '#version 300 es\nlayout(location=0) in vec3 aP; layout(location=1) in vec3 aN; layout(location=2) in vec3 aC; layout(location=3) in vec3 aM; uniform mat4 uModel,uVP; out vec3 vN; out vec3 vW; out vec3 vC; out vec3 vM;\n' +
    'void main(){ vec4 w=uModel*vec4(aP,1.0); vW=w.xyz; vN=mat3(uModel)*aN; vC=aC; vM=aM; gl_Position=uVP*w; }\n';
  TRI_FS =
    '#version 300 es\nprecision highp float;\n' + SEA_GLSL + SHADOW_GLSL + CUT_GLSL + LAMP_GLSL + 'in vec3 vN; in vec3 vW; in vec3 vC; in vec3 vM; uniform vec3 uSun,uEye,uFog,uSky,uGround; uniform float uFogD,uLit,uGlow,uGls; uniform mat4 uCutInv; uniform highp sampler2DArray uMdlT; out vec4 o;\n' +
    // 外殼式的貼圖（TASK-0820；62_shell.js）：頂點色欄 (−1−u, v, 層) ⇒ 照第 18 號的貼圖陣列取色（textureLod：分支裡不用隱含導數；沒有 mipmap）；其他照頂點色（bc ＝ vC ⇒ 畫面不變）
    'void main(){ if(vW.y<uClip) discard; if(uCut.w>0.5 && cutOut((uCutInv*vec4(vW,1.0)).xyz)) discard; vec3 bc=vC; if(vC.x<-0.5) bc=textureLod(uMdlT,vec3(-vC.x-1.0,vC.y,vC.z),0.0).rgb; vec3 n=normalize(vN); float sd=dot(n,uSun), d=abs(sd); vec3 col=bc; float ga=1.0;\n' +
    ' if(uLit>0.5){ float sk=shadowK(vW,(sd<0.0?-n:n)*(3.0-2.0*d)); d*=sk; col=bc*(mix(uGround,uSky,0.6)*0.65+vec3(1.0,0.96,0.88)*d*0.7);\n' +
    // 金屬（TASK-0627；材質表 metal／rough ⇒ 平滑渲染的頂點帶 vM）：天空／海面的反射（菲涅耳：斜看更亮）＋太陽的鏡面高光（照陰影）；vM.x 0 ⇒ 跟以前一樣
    '  if(vM.x>0.001){ vec3 v=normalize(uEye-vW), r=reflect(-v,n); float ro=clamp(vM.y,0.05,1.0), fr=0.04+0.96*pow(1.0-abs(dot(n,v)),5.0);\n' +
    '   vec3 env=mix(uFog*0.5,mix(uFog,uSky,0.55)*1.2,smoothstep(-0.2,0.35,r.y)); vec3 sp=vec3(1.0,0.96,0.88)*pow(max(dot(n,normalize(uSun+v)),0.0),mix(120.0,6.0,ro))*step(0.0,sd)*sk*(2.0-1.5*ro);\n' +
    '   col=mix(col,col*0.35+env*mix(vec3(0.85),bc,0.4)*(0.5+0.5*fr),vM.x*(0.85-0.5*ro))+sp*vM.x; }\n' +
    // 玻璃（TASK-0753；15_smooth.js glsDraw 開 uGls，vM.z ＝ 材質表 clear）：同一套天空／海平線反射與太陽高光，法線翻向看的那一面；
    //   反射照菲涅耳（正看淡、斜看亮）× 光滑度；alpha ＝ 1 − 透明度 ×（1 − 反射），高光蓋上去 ⇒ 正看透出後面、斜看像鏡子。uGls 0 ⇒ 整段跳過（alpha 1）
    '  if(uGls>0.5){ vec3 v=normalize(uEye-vW), gn=dot(n,v)<0.0?-n:n, r=reflect(-v,gn); float ro=clamp(vM.y,0.02,1.0), fr=0.04+0.96*pow(1.0-max(dot(gn,v),0.0),5.0), rk=mix(0.12,1.0,fr)*(1.0-0.7*ro);\n' +
    '   vec3 env=mix(uFog*0.5,mix(uFog,uSky,0.55)*1.2,smoothstep(-0.2,0.35,r.y)); float hs=pow(max(dot(gn,normalize(uSun+v)),0.0),mix(400.0,8.0,ro))*step(0.0,dot(gn,uSun))*sk*(2.0-1.5*ro);\n' +
    '   col=mix(col,env,rk)+vec3(1.0,0.96,0.88)*hs; ga=clamp(1.0-vM.z*(1.0-rk)+hs,0.0,1.0); } }\n' +
    ' if(uLN>0) col+=bc*lampK(vW,n);\n' +                                 // 點光源
    // 燈籠（meta kind=lantern；drawModels 設 uGlow）：只有琥珀色的燈罩發光（色 245 ＝ 1, .71, .33）—— 金框（248，藍 0）、暗紅（128）照常受光
    ' if(uGlow>0.0) col=mix(col,bc*1.2+vec3(0.3,0.14,0.0),uGlow*step(0.9,bc.r)*step(0.2,bc.b)*step(bc.b,0.5));\n' +
    ' float fd=length(vW-uEye); o=vec4(mix(col,uFog,1.0-exp(-fd*uFogD)),ga); }\n';
  P.tri = VK.compile(gl, TRI_VS, TRI_FS);
  // 帆：頂點法線（平滑，不是一個三角形一個平面）；法線翻向看的那一面；包覆光（背光面不死黑、明暗過渡慢）＋太陽在帆後面時布透出暖光
  // 有貼圖的帆（TASK-0579）：aT ＝ 貼圖集的 uv（11_rig_gpu.js sailBuf；u < 0 ＝ 沒有貼圖，照頂點色）；片段照貼圖取色、alpha < 0.5（已照 alpha_min 二值化）⇒ discard ＝ 洞
  P.sail = VK.compile(gl,
    '#version 300 es\nlayout(location=0) in vec3 aP; layout(location=1) in vec3 aN; layout(location=2) in vec3 aC; layout(location=3) in vec2 aT; layout(location=4) in vec4 aF; layout(location=5) in vec3 aH; uniform mat4 uModel,uVP; out vec3 vN; out vec3 vW; out vec3 vC; out vec2 vT; out vec4 vF; out vec3 vH;\n' +
    'void main(){ vec4 w=uModel*vec4(aP,1.0); vW=w.xyz; vN=mat3(uModel)*aN; vC=aC; vT=aT; vF=aF; vH=aH; gl_Position=uVP*w; }\n',
    '#version 300 es\nprecision highp float;\n' + SEA_GLSL + SHADOW_GLSL + CUT_GLSL + BURN_GLSL + RAG_GLSL + 'in vec3 vN; in vec3 vW; in vec3 vC; in vec2 vT; in vec4 vF; in vec3 vH; uniform vec3 uSun,uEye,uFog,uSky,uGround; uniform float uFogD; uniform mat4 uCutInv; uniform sampler2D uSailT; out vec4 o;\n' +
    'void main(){ if(vW.y<uClip) discard; vec3 bc=vC; if(vT.x>=0.0){ vec4 t=texture(uSailT,vT); if(t.a<0.5) discard; bc=t.rgb; }\n' +
    ' if(vH.x<1.9){ float e=rgE(vH); if(e<0.0) discard; bc=mix(bc*vec3(0.72,0.66,0.55),bc,smoothstep(0.0,' + RAG_BAND + ',e)); }\n' +
    ' vec3 em=vec3(0.0); if(vF.x<5e5){ float b=bnB(vF,uSeaT); if(b>1.0) discard;\n' +
    '  if(b>-0.3){ bc=mix(bc,vec3(0.32,0.2,0.1),smoothstep(-0.3,0.05,b)*0.6); bc=mix(bc,vec3(0.045,0.035,0.03),smoothstep(0.05,0.8,b));\n' +
    '   if(uSeaT<vF.y && b>0.55) em=vec3(1.0,0.36,0.06)*smoothstep(0.7,0.97,b)*(1.1+0.7*bnN(vF.zw*7.0+vec2(0.0,uSeaT*2.3))); } }\n' +
    ' if(uCut.w>0.5 && cutOut((uCutInv*vec4(vW,1.0)).xyz)) discard; vec3 n=normalize(vN); if(!gl_FrontFacing) n=-n; float s=dot(n,uSun), sk=shadowK(vW,(s<0.0?-n:n)*(3.0-2.0*abs(s)));\n' +
    ' float lit=max(s,0.0)*0.45*sk+(s*0.5+0.5)*0.32*(0.55+0.45*sk); float thru=max(-s,0.0)*0.30*sk;\n' +
    ' vec3 col=bc*(mix(uGround,uSky,n.y*0.5+0.5)*0.62+vec3(1.0,0.96,0.88)*lit)+bc*vec3(1.0,0.88,0.66)*thru; col+=em;\n' +
    ' float fd=length(vW-uEye); o=vec4(mix(col,uFog,1.0-exp(-fd*uFogD)),1.0); }\n');
  P.pt = VK.compile(gl,
    '#version 300 es\nlayout(location=0) in vec3 aP; layout(location=1) in float aS; layout(location=2) in vec4 aC; layout(location=3) in float aT; uniform mat4 uVP; uniform float uPx; out vec4 vC; out float vT; out float vR;\n' +
    'void main(){ vec4 c=uVP*vec4(aP,1.0); gl_Position=c; gl_PointSize=clamp(aS*uPx/max(c.w,0.1),1.0,256.0); vC=aC; vT=aT; vR=aP.y*0.9+aT*1.7; }\n',
    // 類型 4（vT ≥ 16）＝ 帆的布片：程式畫的菱形，角度跟著高度轉、側過來時變窄（像在翻）；fx.png 沒有這一列 ⇒ 一律程式畫
    '#version 300 es\nprecision highp float; in vec4 vC; in float vT; in float vR; uniform sampler2D uFx; uniform float uUseFx; out vec4 o;\n' +
    'void main(){ if(vT>=16.0){ vec2 d=gl_PointCoord*2.0-1.0; float cr=cos(vR), sr=sin(vR); vec2 q=vec2(cr*d.x-sr*d.y, sr*d.x+cr*d.y);\n' +
    '   float fl=0.3+0.7*abs(sin(vR*0.7)); if(abs(q.x)/(0.95*fl)+abs(q.y)/(0.5+0.12*(vT-16.0))>1.0) discard; o=vec4(vC.rgb*(0.75+0.25*fl),vC.a); return; }\n' +
    ' if(uUseFx>0.5 && vT>=0.0){ float ty=floor(vT/4.0), va=vT-ty*4.0; vec4 t=texture(uFx,(vec2(va,ty)+gl_PointCoord)/4.0); if(t.a<0.02) discard; o=vec4(t.rgb,t.a*vC.a); return; }\n' +
    ' vec2 d=gl_PointCoord*2.0-1.0; float r=dot(d,d); if(r>1.0) discard; float a=vC.a*(1.0-r*r); o=vec4(vC.rgb*(1.0-0.25*r),a); }\n');
  // 海：跟著鏡頭的同心圓網格（60_render.js seaGrid；aP ＝ 離中心的 x、z 與那一圈的網格間距），頂點照浪位移（08_sea.js；比網格粗的浪拿掉、1 km 外放平）；
  //   法線在片段裡照解析的坡度算（seaG，遠處淡掉）＋細的漣漪 uDet 道（畫質）—— 漣漪只在畫面上，不進物理。
  // 岸邊浪變小（TASK-0818；Tim 2026-10-22「海浪往外還會有一段 斷掉的海水在岸上 且會閃爍」）：以前浪照深海的高度一路起伏到岸上 ⇒ 平的沙灘一下被浪頭蓋住一塊、一下露出來（斷開的海、閃）。
  //   ⇒ 照水深（海底高度貼圖 uBedT，跟岸邊白沫同一張、8 m 一格）把浪的高度與斜率縮小（vK）：水深 ≥ SEA_SHORE[1] 照舊，越淺越小，岸上（水深 ≤ SEA_SHORE[0]）平的；
  //   岸上再壓低 SEA_SHORE[2] 公尺 ⇒ 0 m 上下的沙灘不跟平的海面搶深度。只給人看：船、浮力、模擬照舊讀 JS 的 seaH。沒有海圖、貼圖外 ⇒ 照舊（vK 1）。
  P.water = VK.compile(gl,
    '#version 300 es\nlayout(location=0) in vec3 aP; uniform mat4 uVP; uniform vec2 uC; uniform float uBedOn; uniform vec4 uBedR; uniform sampler2D uBedT;\n' + SEA_GLSL +
    'out vec3 vW; out float vK; void main(){ vec2 p=uC+aP.xy; float k=1.0;\n' +
    ' if(uBedOn>0.5){ vec2 bu=((p-uBedR.xy)/uBedR.z+0.5)/uBedR.w; if(bu.x>0.0&&bu.y>0.0&&bu.x<1.0&&bu.y<1.0) k=smoothstep(' + SEA_SHORE[0].toFixed(2) + ',' + SEA_SHORE[1].toFixed(2) + ',-textureLod(uBedT,bu,0.0).r); }\n' +
    ' float h=seaHs(p,aP.z)*(1.0-smoothstep(900.0,1600.0,length(aP.xy)))*k-(1.0-k)*' + SEA_SHORE[2].toFixed(2) + '; vK=k; vW=vec3(p.x,h,p.y); gl_Position=uVP*vec4(vW,1.0); }\n',
    '#version 300 es\nprecision highp float; in vec3 vW; in float vK; uniform vec3 uEye,uSun,uFog,uSky; uniform float uFogD,uDet,uAn,uNzP,uReflOn,uRefr,uFoam,uRefrD,uRefrK,uBedOn; uniform vec2 uView; uniform vec4 uBedR; uniform sampler2D uRefl,uScene,uSceneD,uBedT; out vec4 o;\n' + SEA_GLSL + SHADOW_GLSL + BED_DRY_GLSL +
    // 反射（uReflOn）：RT.R 是鏡像過來的船，照螢幕座標＋法線擾動讀，沒畫到的地方（a ＝ 0）照舊是天空。
    // 折射（uRefr）：0 不透明、1 半透明（底下的照舊混進來）、2 讀 RT.B（畫海之前的場景）：照法線擾動、照水的厚度（兩個深度相減）吸收成海的顏色。
    'float linZ(float d){ float z=d*2.0-1.0; return 5000.0/(5000.5-z*4999.5); }\n' +
    // 船艙裡不畫海（HULL_GLSL）：海面那一點落在原本船殼的外形裡 ⇒ 丟掉
    HULL_GLSL +
    // 細浪（只在畫面）：uDet 道，波長從 7 m 往下每道 ×0.8 再亂一點、方向在風向 ±70° 亂撒、相位亂撒（雜湊，不抽亂數）⇒ 不成整數比、不會一格一格重複；
    // 每道照像素寬 fp 淡掉（遠處自動變平滑，不疊紋）；再乘一層慢慢飄的雜訊 ⇒ 海面一塊皺、一塊平（陣風吹過的樣子）。
    'float hs1(float n){ return fract(sin(n*12.9898)*43758.5453); }\n' +
    'float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); float a=hs1(dot(i,vec2(1.0,57.0))), b=hs1(dot(i+vec2(1.0,0.0),vec2(1.0,57.0))), c=hs1(dot(i+vec2(0.0,1.0),vec2(1.0,57.0))), d=hs1(dot(i+vec2(1.0,1.0),vec2(1.0,57.0))); return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }\n' +
    // 打散重複（Tim 2026-10-17「是否可以用noise避免這種重複紋路」）：一堆直的正弦疊起來 ⇒ 干涉點排成固定的菱形格子；以前唯一的雜訊只乘振幅、不動波峰 ⇒ 格子照舊。
    //   ⇒ 每一道各自加一層相位雜訊（uNzP 圈，尺度 0.15／m ≈ 6.7 m、慢慢飄）：哪裡疊在一起每一塊都不一樣，每道的譜線抹成一條帶。只在畫面上，⛔ 不進物理。
    //   量的（世界座標的坡度場、6 個時刻；tools 見 TASK 單）：二次自相關峰 8 道 0.79 → 0.29、14 道 0.76 → 0.28。
    //   ⛔ 試過、不用的：全部一起扭曲（domain warp 3 m）⇒ 每一道一起彎、畫出指紋一樣的等高線；每道振幅雜訊＋扭曲 ⇒ 14 道時二次峰沒降（0.73–0.77）。
    'vec2 detail(vec2 p,float fp){ vec2 g=vec2(0.0); float L=7.0, st=0.07;\n' +
    '  for(int i=0;i<16;i++){ if(float(i)>=uDet) break; float fi=float(i)+1.0; float l=L*(0.85+0.3*hs1(fi*3.1)); float k=6.2832/l, a=SEA_WA+(hs1(fi*7.7)-0.5)*2.4; vec2 d=vec2(cos(a),sin(a));\n' +
    '    float ph=hs1(fi*5.3)*6.2832+uNzP*6.2832*(vn(p*0.15+vec2(fi*17.3,fi*7.1)+uSeaT*0.011)-0.5);\n' +
    '    g+=d*st*(1.0-smoothstep(0.25*l,0.6*l,fp))*cos(dot(p,d)*k-sqrt(9.81*k)*uSeaT+ph); L*=0.8; st*=0.88; }\n' +
    '  return g*(0.45+1.1*vn(p*0.025+vec2(uSeaT*0.013,uSeaT*0.007))); }\n' +
    // 停格的「🔍 透視」（72_floodui.js）：船附近的海面不畫 ⇒ 看得到水線下的船殼與破口。uXb ＝ 那艘船型在格座標的中心與半長、半寬（xrBox），再往外 6 m（60 格）；uXr ＝ 0 ⇒ 照原本畫
    'uniform float uXr; uniform vec4 uXb[' + NS_MK + ']; bool nearShip(int k){ vec4 b=uXb[k]; vec4 l=uInv[k]*vec4(vW,1.0); vec2 q=abs(l.xy-b.xy)-b.zw; return length(max(q,vec2(0.0)))<60.0; }\n' +
    'bool nearAny(){ for(int k=0;k<' + NS_MK + ';k++){ if(k>=uNM) break; if(nearShip(k)) return true; } return false; }\n' +
    'void main(){ if(' + HULL_HIT + ') discard; if(uXr>0.5&&nearAny()) discard; if(bedDry(vW.xz)) discard; vec2 p=vW.xz; float fd0=length(vW-uEye); float k0=1.0-smoothstep(300.0,1400.0,fd0), k1=1.0-smoothstep(60.0,260.0,fd0), k2=1.0-smoothstep(25.0,110.0,fd0);\n' +
    ' vec2 dd=fwidth(vW.xz); float fp=max(dd.x,dd.y);\n' +
    ' vec2 g=uAn*seaGf(p,fp)*vK+detail(p,fp);\n' +                     // 浪的斜率照岸邊縮小（vK，見上面頂點那一段）；細浪照舊
    ' vec3 n=normalize(vec3(-g.x,1.0,-g.y)); vec3 v=normalize(uEye-vW); float fr=0.04+0.96*pow(1.0-max(dot(n,v),0.0),5.0);\n' +
    ' vec3 r=reflect(-v,n); vec3 sky=mix(uFog,uSky,clamp(r.y*1.6,0.0,1.0)); vec2 sc=gl_FragCoord.xy/uView; float sk=shadowK(vW,vec3(0.0,1.0,0.0));\n' +
    ' if(uReflOn>0.5){ vec4 rc=textureLod(uRefl,sc+n.xz*0.035,0.0); sky=mix(sky,rc.rgb,rc.a); }\n' +
    ' float sp=pow(max(dot(r,uSun),0.0),180.0)*1.6*sk; float fd=length(vW-uEye), a=mix(0.86,1.0,clamp(fd/600.0,0.0,1.0));\n' +
    ' vec3 deep=vec3(0.03,0.16,0.21)*mix(0.72,1.0,sk);\n' +
    ' if(uRefr<0.5) a=1.0; else if(uRefr>1.5){ float zw=linZ(gl_FragCoord.z); vec2 off=n.xz*0.045; float zs=linZ(textureLod(uSceneD,sc+off,0.0).r);\n' +
    '   if(zs<zw){ off=vec2(0.0); zs=linZ(textureLod(uSceneD,sc,0.0).r); } float th=max(zs-zw,0.0);\n' +
    '   vec3 under=textureLod(uScene,sc+off,0.0).rgb*vec3(0.55,0.86,0.92); deep=mix(deep,under,exp(-th*uRefrK)*clamp(1.0-fd/uRefrD,0.0,1.0)); a=1.0; }\n' +
    ' vec3 c=mix(deep,sky,fr)+vec3(1.0,0.92,0.75)*sp;\n' +
    // 白沫（天氣：暴風雨）：浪頭（高度在全部振幅的 40% 以上）照一層慢慢飄的雜訊碎成一塊一塊；晴天 uFoam ＝ 0 ⇒ 整段跳過（畫面逐位元組不變）
    //   大漩渦：浪頭照浪本身的高度判（扣掉漩渦凹下去的那一份；⛔ 不扣 ⇒ 漏斗裡一律比 40% 低、整片沒有白沫）
    ' if(uFoam>0.0){ float hn=(seaH(p)-vxH(p))/max(uSeaK*1.14,1e-3); float fm=smoothstep(0.4,0.8,hn)*smoothstep(0.3,0.7,vn(p*0.16+vec2(uSeaT*0.05,0.0)))+0.25*smoothstep(0.6,0.9,vn(p*0.9-vec2(0.0,uSeaT*0.2)))*smoothstep(0.2,0.6,hn);\n' +
    '   c=mix(c,vec3(0.82,0.86,0.88)*(0.55+0.45*uSunK),clamp(fm,0.0,1.0)*0.8*uFoam*(1.0-smoothstep(200.0,900.0,fd))); }\n' +
    // 大漩渦（08_sea.js VX；uVx.x ＝ 深度，0 ⇒ 整段跳過）：漏斗壁上 5 條對數螺旋的白沫（照水流的方向一起轉：從上往下看逆時針 ⇒ atan(z, x) 變小），
    //   用雜訊碎成一段一段；越往中心越暗（眼是一個黑洞）。只在畫面上。
    ' if(uVx.x>0.0){ float r=length(p), q=r/uVx.z, th=atan(p.y,p.x); float ph=5.0*(th+uSeaT*uVx.w/uVx.z)+7.0*log(max(r,1.0));\n' +
    '   float arm=smoothstep(0.35,0.95,sin(ph))*smoothstep(0.25,0.75,vn(p*0.07+vec2(uSeaT*0.03,0.0)));\n' +
    '   float band=smoothstep(0.12,0.4,q)*(1.0-smoothstep(1.4,2.6,q));\n' +
    '   c=mix(c,vec3(0.82,0.86,0.88)*(0.55+0.45*uSunK),clamp(arm*band,0.0,1.0)*0.75*(1.0-smoothstep(250.0,1000.0,fd)));\n' +
    '   c=mix(c,vec3(0.01,0.04,0.06),(1.0-smoothstep(0.08,0.35,q))*0.85); }\n' +
    // 岸邊的白沫（有海圖才有，TASK-0721；63_bed_gl.js BEDFOAM）：水深 ＝ 這一點的海面（含浪）− 海底（uBedT：8 m 一格的高度，uBedR ＝ 第 0 格的世界 x、z、間距、格數）。
    //   水邊一條亮線（< 0.5 m）＋往岸邊推的一道一道浪花（照水深的正弦、隨時間往淺處走；1.5 m 內 —— 2 m 內 ⇒ 大片淺礁坪整片都是條紋），用兩層雜訊碎開；1.2 km 外淡掉。只在畫面上。
    //   亮線照「旁邊一格（8 m）內最淺的」⇒ 峭壁腳下（水深一下子 10 m 以上、< 2 m 的那一圈不到一格）也有一圈浪花拍岸。
    //   bd ＝ 這一點的水深（給最後那一段「深水看不到底」；−1 ＝ 沒有海圖、1e4 ＝ 在這張高度貼圖外面，當深海）
    ' float bd=-1.0; if(uBedOn>0.5){ vec2 bu=((p-uBedR.xy)/uBedR.z+0.5)/uBedR.w; if(bu.x>0.0&&bu.y>0.0&&bu.x<1.0&&bu.y<1.0){ float dep=vW.y-textureLod(uBedT,bu,0.0).r; bd=dep;\n' +
    // 淺水看得見底（Tim 2026-10-19 珊瑚礁的顏色）：中畫質的海面是一層 86% 不透明的顏色（高畫質才照水深透出水下）⇒ 水深 0.5～8 m 那一段照水深變透（最透 0.4），礁、沙洲的顏色透得出來；低畫質照舊不透
    '   if(uRefr>0.5&&uRefr<1.5&&dep>0.0) a=min(a,mix(0.4,a,smoothstep(0.5,8.0,dep)));\n' +
    '   float dn=dep; if(dep<60.0){ vec2 e=vec2(1.0/uBedR.w,0.0); dn=min(dep,vW.y-max(max(textureLod(uBedT,bu+e.xy,0.0).r,textureLod(uBedT,bu-e.xy,0.0).r),max(textureLod(uBedT,bu+e.yx,0.0).r,textureLod(uBedT,bu-e.yx,0.0).r))); }\n' +
    '   if(dn<0.5||dep<1.6&&dep>-0.5){ float nz=vn(p*0.11+vec2(uSeaT*0.04,-uSeaT*0.03)); float ln=1.0-smoothstep(0.05,0.5,dn);\n' +
    '     float sw=smoothstep(0.7,0.97,sin(dep*4.0+uSeaT*1.7+nz*5.0))*(1.0-smoothstep(0.6,1.6,dep));\n' +
    '     float fm=clamp(ln*0.9+sw*0.6,0.0,1.0)*smoothstep(0.2,0.6,0.55*vn(p*0.45+vec2(0.0,uSeaT*0.15))+0.6*nz)*(1.0-smoothstep(400.0,1200.0,fd));\n' +
    '     c=mix(c,vec3(0.86,0.9,0.92)*(0.55+0.45*uSunK),fm*0.85); a=mix(a,1.0,fm); } } else bd=1e4; }\n' +
    ' c=mix(c,uFog,1.0-exp(-fd*uFogD));\n' +
    // 深水看不到底（中畫質、有海圖；2026-10-20 Blocksail 進航海／海戰降到船旁邊：海一塊深一塊淺，直邊沿著 1 km 的海圖塊）：
    //   中畫質的海面 86% 不透明（a），後面畫了什麼就透出 1 − a —— 有檔的塊有海底網格（深海那一段在 −150 m）⇒ 透出暗的海底；
    //   全是深海的塊（area.chunks 第三欄 0）沒有網格 ⇒ 透出天空在地平線以下的霧色（HORIZON ＝ uFog；沒有海圖時整片海也是這樣）⇒ 塊的邊上一條直的色差（量的：暗 9～12 階）。
    //   ⇒ 透出來的海底最多 exp(−uRefrK·水深)（跟高畫質同一個吸收），多的那一份照「後面是霧色」算進來（a 跟著加）：
    //   水深 16 m 內 exp(−0.12·水深) ≥ 0.14 ≥ 1 − a ⇒ 一點都不變（礁、沙洲、淺灘照舊）；−150 m 只剩 1e-8 ⇒ 深海不管後面有沒有網格都跟沒有海圖時的海同一個顏色。
    //   低畫質不透明、高畫質照水深吸收 ⇒ 本來就連續，不動；沒有海圖 ⇒ bd ＝ −1 整段跳過（算式跟以前一樣）。深水的 a 變 1 ⇒ 畫布不再透出頁面底色（以前約 8%，差 1～2 階）。
    ' if(uRefr>0.5&&uRefr<1.5&&bd>0.0&&a<1.0){ float wd=max(0.0,1.0-exp(-uRefrK*bd)/(1.0-a)); if(wd>0.0){ float a2=a+(1.0-a)*wd; c=(a*c+(1.0-a)*wd*uFog)/a2; a=a2; } }\n' +
    ' o=vec4(c,a); }\n');
  // 雨（天氣 × 畫質的「雨」）：整個畫面一層斜的雨絲，三層遠近（越近越粗越快）；欄位照雜湊挑哪幾欄有雨、每欄的相位亂撒。鏡頭轉的時候雨絲跟著水平滑（uYaw）。
  P.rain = VK.compile(gl, '#version 300 es\nlayout(location=0) in vec2 aP; void main(){ gl_Position=vec4(aP,0.0,1.0); }\n',
    '#version 300 es\nprecision highp float; uniform float uT,uRain,uYaw; uniform vec2 uView; out vec4 o;\n' +
    'float h1(float n){ return fract(sin(n*12.9898)*43758.5453); }\n' +
    'float lay(vec2 uv,float sc,float sp,float th){ vec2 q=uv*sc; q.x+=q.y*0.16; float col=floor(q.x), h=h1(col+sc*17.0); if(h<th) return 0.0;\n' +
    '  float y=fract(q.y*0.05+uT*sp*(0.75+0.5*h)+h*7.0); float w=1.0-smoothstep(0.0,0.12,abs(fract(q.x)-0.5)); return w*smoothstep(0.0,0.1,y)*smoothstep(0.4,0.12,y); }\n' +
    'void main(){ vec2 uv=gl_FragCoord.xy/uView.y; uv.x+=uYaw*0.5; float th=1.0-0.55*uRain;\n' +
    ' float a=lay(uv,90.0,1.6,th)*0.35+lay(uv,55.0,1.25,th)*0.5+lay(uv,32.0,0.95,th)*0.65; o=vec4(vec3(0.78,0.82,0.86),clamp(a,0.0,1.0)*0.45*uRain); }\n');
  // 只寫深度（陰影圖）：體素照 VoxelKit 的頂點著色器、模型與帆共用一支
  var NOFS = '#version 300 es\nprecision highp float; void main(){}\n';
  P.dvox = VK.compile(gl, VK.VOXEL_VS, NOFS);
  DTRI_VS = '#version 300 es\nlayout(location=0) in vec3 aP; uniform mat4 uModel,uVP; void main(){ gl_Position=uVP*(uModel*vec4(aP,1.0)); }\n';
  P.dtri = VK.compile(gl, DTRI_VS, NOFS);
  // 帆的陰影（TASK-0579）：貼圖的洞不投影子（同 P.sail 的 discard）；燒穿的洞也是（TASK-0717，BURN_GLSL）；破洞的毛邊也是（R3，RAG_GLSL）
  P.dsail = VK.compile(gl, '#version 300 es\nlayout(location=0) in vec3 aP; layout(location=3) in vec2 aT; layout(location=4) in vec4 aF; layout(location=5) in vec3 aH; uniform mat4 uModel,uVP; out vec2 vT; out vec4 vF; out vec3 vH; void main(){ vT=aT; vF=aF; vH=aH; gl_Position=uVP*(uModel*vec4(aP,1.0)); }\n',
    '#version 300 es\nprecision highp float; in vec2 vT; in vec4 vF; in vec3 vH; uniform sampler2D uSailT; uniform float uSeaT;\n' + BURN_GLSL + RAG_GLSL + 'void main(){ if(vT.x>=0.0 && texture(uSailT,vT).a<0.5) discard; if(vF.x<5e5 && bnB(vF,uSeaT)>1.0) discard; if(vH.x<1.9 && rgE(vH)<0.0) discard; }\n');
  // 帆的位置與法線由 GPU 算（render 管線大修 R2；11_rig_gpu.js SAILK）：transform feedback 寫進帆的動的那份。編不過 ⇒ null ⇒ 照 R1 在 CPU 算
  try { P.sailK = SAILK.compile(SAILK_VS, SAILK_FS, ['kP', 'kN']); } catch (e) { P.sailK = null; console.warn('帆的法線改回 CPU 算：' + (e && e.message)); }
  P.sky = VK.compile(gl,
    '#version 300 es\nlayout(location=0) in vec2 aP; uniform mat4 uInv; out vec3 vD; void main(){ vec4 a=uInv*vec4(aP,1.0,1.0); vD=a.xyz/a.w; gl_Position=vec4(aP,0.9999,1.0); }\n',
    '#version 300 es\nprecision highp float; in vec3 vD; uniform vec3 uEye,uSun,uFog,uSky,uSunC; uniform float uNight; out vec4 o;\n' +
    'void main(){ vec3 d=normalize(vD-uEye); float h=clamp(d.y,0.0,1.0); vec3 c=mix(uFog,uSky,pow(h,0.55)); float s=max(dot(d,uSun),0.0);\n' +
    ' c+=uSunC*(pow(s,600.0)*3.0+pow(s,12.0)*0.18);\n' +
    // 星星（世界時間的夜晚，08_weather.js TOD_NIGHT）：方向切成 420 格一點、千分之二點五的格子有一顆，亮度不一；貼近地平線淡掉
    ' if(uNight>0.01&&d.y>0.0){ float r=fract(sin(dot(floor(d*420.0),vec3(12.9898,78.233,37.719)))*43758.5453); c+=vec3(0.9,0.92,1.0)*step(0.9975,r)*(0.4+0.6*fract(r*977.0))*uNight*smoothstep(0.0,0.25,d.y); }\n' +
    ' if(d.y<0.0) c=uFog; o=vec4(c,1.0); }\n');
  // 破洞底下的海（TASK-0643；Tim 2026-10-16「船如果被打穿甲板跟船殼 因為海面在船範圍內被Clipping 會導致破洞可以直接看到空氣」）：
  //   海在原本的船殼外形裡一律丟掉（hullHit：船艙裡不要看起來積了一層水）⇒ 船底被打穿時，從洞往下看什麼都沒打到 ⇒ 以前看到天空在地平線以下的霧色（淺灰白）。
  //   這一趟畫在海之後（60_render.js abyssDraw）：全螢幕一個三角形、深度 0.9999、深度測試 LESS ⇒ 只落在深度還是清空值（什麼都沒畫到：海、船、天空都沒寫深度的地方）的像素；
  //   再把那條視線跟海平面（y 0）的交點丟進同一個 hullHit ⇒ 只有「海在這裡被丟掉」的那一塊塗深海色（海的 deep，取陰影那一端 0.72）。
  //   ⛔ v1 改天空在地平線以下一律畫深海色 ⇒ 中等折射（海面帶一點透明、疊在背景上）整片海變暗（近處 55,82,93 → 30,59,73）—— 平常看海也變了，退掉。
  P.abyss = VK.compile(gl,
    '#version 300 es\nlayout(location=0) in vec2 aP; uniform mat4 uCamInv; out vec3 vD; void main(){ vec4 a=uCamInv*vec4(aP,1.0,1.0); vD=a.xyz/a.w; gl_Position=vec4(aP,0.9999,1.0); }\n',
    '#version 300 es\nprecision highp float; in vec3 vD; uniform vec3 uEye; uniform float uAbY; out vec4 o; vec3 vW;\n' + HULL_GLSL +
    'void main(){ vec3 d=normalize(vD-uEye); if(d.y>-1e-4||uEye.y<=uAbY) discard; vW=uEye+d*((uAbY-uEye.y)/d.y); if(!' + HULL_HIT + ') discard; o=vec4(vec3(0.03,0.16,0.21)*0.72,1.0); }\n');
  // 一次畫多個（見 instVS）：編不起來（驅動不收、uniform 不夠）⇒ null ⇒ 那一支照舊一個一個畫。放最後：前面每一支程式的建立順序不變
  INST_K = clamp(Math.floor((gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS) - 16) / 4), 16, INST_MAX);
  try { P.triI = VK.compile(gl, instVS(TRI_VS), TRI_FS); } catch (e) { P.triI = null; console.warn('P.triI 沒編起來（模型照舊一個一個畫）：' + e.message); }
  try { P.dtriI = VK.compile(gl, instVS(DTRI_VS), NOFS); } catch (e) { P.dtriI = null; console.warn('P.dtriI 沒編起來（陰影照舊一個一個畫）：' + e.message); }
  var B = GL_BATCH, bad = null; GL_BATCH = null;
  B.forEach(function (b) { try { Object.assign(b[1], glProgEnd(b[0])); } catch (e) { b[1].err = e; } });
  if (P.triI && P.triI.err) { console.warn('P.triI 沒編起來（模型照舊一個一個畫）：' + P.triI.err.message); P.triI = null; }
  if (P.dtriI && P.dtriI.err) { console.warn('P.dtriI 沒編起來（陰影照舊一個一個畫）：' + P.dtriI.err.message); P.dtriI = null; }
  B.forEach(function (b) { if (b[1].err && b[1] !== P.triI && b[1] !== P.dtriI && !bad) bad = b[1].err; }); if (bad) throw bad;
  if (Q.get('map')) { glWarm(BED_VS, bedFS()); glWarm(BED_VS, DEPTH_ONLY_FS); }   // 有海圖 ⇒ 地形那兩支先送出（第一次 bedDraw 才編 ⇒ 一格 2.6 秒）
}
function setCommon(p) {
  var u = p.u;
  if (u.uVP) gl.uniformMatrix4fv(u.uVP, false, PASS.vp || CAM.vp);          // PASS：反射、陰影那一趟換掉（60_render.js）
  if (u.uSun) gl.uniform3fv(u.uSun, SUN);
  if (u.uEye) gl.uniform3fv(u.uEye, PASS.eye || CAM.eye);
  if (u.uFog) gl.uniform3fv(u.uFog, HORIZON);
  if (u.uSky) gl.uniform3fv(u.uSky, SKY);
  if (u.uGround) gl.uniform3fv(u.uGround, GROUND);
  if (u.uFogD) gl.uniform1f(u.uFogD, WX.fog * CAM.fogK);        // 霧（天氣：晴 0.0016、暴風雨 0.0042）；CAM.fogK：轉場拉高時淡掉（03_camera.js camTrans）
  if (u.uWater) gl.uniform1f(u.uWater, 0.0);
  if (u.uTint) gl.uniform1f(u.uTint, 0.0);
  if (u.uSeaK) gl.uniform1f(u.uSeaK, SEA_K * WX.sea);                  // 浪（08_sea.js）：大小、時間（模擬時間 ⇒ 暫停時浪也停）
  if (u.uSeaT) gl.uniform1f(u.uSeaT, SIMT);
  if (u.uSeaA) gl.uniform1f(u.uSeaA, SEA_A);                           // 這一場的風轉了多少，浪跟著轉（08_sea.js）
  if (u.uVx) { if (VX) gl.uniform4f(u.uVx, VX.D, VX.rc2, VX.rv, VX.V); else gl.uniform4f(u.uVx, 0, 1, 1, 0); }   // 大漩渦（08_sea.js VX）：D ＝ 0 ⇒ 沒有
  if (u.uVe) { if (VX) gl.uniform2f(u.uVe, VX.De, VX.re2); else gl.uniform2f(u.uVe, 0, 1); }   // 眼的喉部（深度、半徑²）
  if (u.uClip) gl.uniform1f(u.uClip, PASS.clip);
  if (u.uCutT) gl.uniform1i(u.uCutT, 8);                       // 剖面的切高貼圖（74_cutaway.js）：固定第 8 號
  if (u.uMdlT) gl.uniform1i(u.uMdlT, 18);                      // 外殼式的貼圖陣列（62_shell.js SHELLT）：固定第 18 號
  if (u.uBkK) gl.uniform3fv(u.uBkK, todBakeK());                  // 遠景貼圖的光照倍數（08_weather.js todBakeK：世界時間的夜晚只剩月光；沒開 ⇒ 1）
  if (u.uSunK) gl.uniform1f(u.uSunK, wxSun());                   // 天氣（08_weather.js）：陽光、水手與碎木的亮度、白沫
  if (u.uLum) gl.uniform1f(u.uLum, wxLum());
  if (u.uLN) { gl.uniform1i(u.uLN, LAMPS.n); if (LAMPS.n) { gl.uniform4fv(u.uLP, LAMPS.p); gl.uniform4fv(u.uLC, LAMPS.c); } }   // 點光源（60_render.js lampsUpdate；沒有 uLN 的著色器 ＝ 陰影那一趟 ⇒ 不給）
  if (u.uTLG) townLampSet(u);                                  // 城裡的點光源（63_towns.js 夜裡的燈：分組表第 13 號、燈的資料第 14 號）
  if (u.uFoam) gl.uniform1f(u.uFoam, WX.foam);
  if (u.uNM) gl.uniform1i(u.uNM, MSLOTS.length);               // 船艙遮罩、透視用到幾格
  if (u.uShOn) {                                              // 陰影圖陣列綁在第 4 號（60_render.js render 開頭綁）；每一段的矩陣、遠端、偏移一次給（沒用到的段 ＝ FAR_M）
    gl.uniform1f(u.uShOn, PASS.sh && GFX.shadow ? (SHK['p' + Math.min(2, GFX.shadow)] === 9 ? 2 : 1) : 0);   // 柔邊取樣：畫質頁「低／高：柔邊取樣」（07_gfx.js SHK）
    gl.uniform1i(u.uShA, 4); gl.uniformMatrix4fv(u.uShM, false, SHM.mats); gl.uniform1f(u.uShPx, 1 / SHM.n);
    gl.uniform1i(u.uCsN, SHM.on ? SHM.k : 0); gl.uniform1fv(u.uCsD, SHM.csD); gl.uniform1fv(u.uCsL, SHM.csL); gl.uniform1fv(u.uCsO, SHM.csO); gl.uniform1fv(u.uCsB, SHM.csB);   // 60_render.js shadowMats
    gl.uniform3fv(u.uCsE, SHM.eye); gl.uniform3fv(u.uCsF, SHM.fw); gl.uniform1f(u.uShEdge, CSM_SIMPLE ? 1 : 0);
    gl.uniform1f(u.uShSoft, SHK.soft); gl.uniform1f(u.uShE0, SHK.edge); gl.uniform1f(u.uShTr, TREE_LOD[1] - 50);   // 柔邊寬度、單張的邊緣淡出、樹收影子到多遠（立體樹的距離 − 50 m：畫質的「立體樹的距離」）
  }
}
// 水線下不染海水色（Tim 2026-10-16「莫尼特號艙內有一層水 但是實際上沒有進水」→「拿掉船身與模型的水線下水色，交給海面」）：
//   船殼、模型、繩、帆以前在浪的水面以下一律混海水色（船殼 35–90%、其他 60%）⇒ 從艙裡（第一人稱）、從艙口往下看，沒進水的艙也像積了一層水。
//   隔著海面看水下那一段，交給海的著色器自己（中畫質：海面帶一點透明疊上去；高畫質：照水深把後面的東西染成海水色；低畫質的海不透明，本來就看不到水下）。
//   VoxelKit 那一份的水下著色（uWater）整段拿掉（⛔ 不改 VoxelKit：別的作品也用）。船員的看板圖只染泡在水裡的（41_crew_art.js vS < 0），不動。
/** 船殼的著色器：VoxelKit 那一份＋這個遊戲要的（陰影、點光源、剖面；水下不染色，見上）。⛔ 不改 VoxelKit（別的作品也用）；找不到要換的那一段 ⇒ 照原本的畫。 */
function voxFS() {
  var s = VK.VOXEL_FS, a = 'out vec4 o;', b = 'if(vW.y<uWater){ float dd=clamp((uWater-vW.y)*0.12,0.0,1.0); c=mix(c,vec3(0.04,0.18,0.22),0.35+0.55*dd); }', c = 'float di=max(dot(n,uSun),0.0);', d = 'void main(){', e = 'vec3 c=base*(amb*0.62+vec3(1.0,0.96,0.88)*di*0.78);';
  if ([a, b, c, d, e].some(function (x) { return s.indexOf(x) < 0; })) { console.warn('VoxelKit 的體素著色器改過了：船殼不跟著浪著色、不收陰影、不吃點光源'); return s; }
  return s.replace(e, e + ' if(uLN>0) c+=base*lampK(vW,n); if(uVGN>0){ for(int i=0;i<' + VLAMP_N + ';i++){ if(i>=uVGN) break; if(abs(float(vC)-uVGC[i].w)<0.5 && distance(vL,uVG[i].xyz)<uVG[i].w) c=mix(c,base*0.35+uVGC[i].rgb*1.15,uVGK); } }').replace(a, SEA_GLSL + SHADOW_GLSL + CUT_GLSL + LAMP_GLSL + a).replace(b, '')
    .replace(c, 'float di=max(dot(n,uSun),0.0); if(di>0.0) di*=shadowK(vW,n*(3.0-2.0*di));').replace(d, d + ' if(vW.y<uClip) discard; if(cutOut((uCutL*vec4(vL,1.0)).xyz)) discard;')   // cutOut：剖面與隱藏甲板（vL ＝ 格座標）
    .replace(a, 'uniform mat4 uCutL;\n' + a);   // uCutL：畫的那份格子 → 船的格座標（船殼 ＝ 單位矩陣，cutSet 設；砲帶的裝甲 ＝ 它轉過的那個，24_armor.js armDraw）⇒ 轉過的裝甲照船的座標切
}

