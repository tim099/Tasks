// ───────────────────────── 船型快取（IndexedDB；Tim 2026-10-13：緩存船隻解析結果，加速下次啟動） ─────────────────────────
// 存的是載入時算一次、之後不改的東西：船體網格（每個區塊的四邊形）、模型網格（三角形＋佔用格）、海面遮罩、浮力表、帆的布模板、水的房間（33_wrooms.js，TASK-0807）。
//   格子本身不存：解碼很快（憲法號約 70 ms），而且 checksum 要照解出來的格子比（VK.verify）。
//   GPU 那一半（上傳、VAO）每次照樣做，只省 CPU 算的那一半。量過（2026-10-13，PC）：船體網格 CPU 240 ms，讀回同一份 6.8 MB 約 19 ms。
// 一型一筆（鍵 ＝ 船的 id）；兩艘同型共用那一筆。換裝（38_fit.js）：鍵 ＝ 艦隊裡那一項（船型@換裝表），換裝表也算進 vxk 的雜湊（出廠、存檔改了 ⇒ 舊的那筆不用）。
// 失效：那筆記錄的 vxk（內嵌 .vxk 原文的雜湊：basecamp 每次重匯都會變，繩／帆／模型改了也會變）、code（頁面裡 JS 原文的雜湊：
//   產生網格的程式改了也要清）、fmt（快取格式）任何一個對不上 ⇒ 不用、現場解析完蓋掉它。
// 存不了（畫廊彈窗的 iframe 只開 allow-scripts：不透明來源，一碰 indexedDB 就丟錯；無痕模式；配額滿）⇒ 照常現場解析，不壞。
// ?cache=0 ⇒ 不讀也不寫（量現場解析的時間用）。
var CACHE_DB = 'ame_constitution_broadside', CACHE_FMT = 1, CACHE_ON = Q.get('cache') !== '0';
/** FNV-1a 32 位元（字串照 UTF-16 碼位）。 */
function cacheFnv(s) { var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
// 程式版本 ＝ 頁面上所有內嵌 JS 的原文（VoxelKit ＋ 遊戲本體）：改了任何一行都會換 ⇒ 寧可多清，不拿舊程式算的網格
//   載入時只收原文（字串照參照，不花時間）、第一次讀快取才算雜湊（cacheCode；2.6 MB 約 25 ms，以前算在載入頁面那一段裡 —— 2026-10-20 開場切段）⇒ 值跟以前一樣
var CODE_SRC = [].map.call(document.scripts, function (el) { return !el.type || /javascript/i.test(el.type) ? el.textContent : ''; }), CODE_VER = null;
function cacheCode() { if (CODE_VER === null) { CODE_VER = cacheFnv(CODE_SRC.join('\n')); CODE_SRC = null; } return CODE_VER; }
var cacheDB = null;
/** 開資料庫 ⇒ Promise<IDBDatabase|null>（開不了 ⇒ null；1.5 秒沒回也當開不了）。 */
function cacheOpen() {
  if (cacheDB) return cacheDB;
  return (cacheDB = new Promise(function (res) {
    var done = false; function ok(v) { if (!done) { done = true; res(v); } }
    setTimeout(function () { ok(null); }, 1500);
    try {
      var q = indexedDB.open(CACHE_DB, 1);
      q.onupgradeneeded = function () { q.result.createObjectStore('hull'); };
      q.onsuccess = function () { ok(q.result); };
      q.onerror = q.onblocked = function () { ok(null); };
    } catch (e) { ok(null); }
  }));
}
/** 那艘船的快取 ⇒ Promise<記錄|null>（從不 reject）。info.cache 留讀數：key、讀了多久、為什麼沒用。 */
function cacheGet(info, key, F) {
  // 改裝船（TASK-0657）：格子存成跟原船的差 ⇒ 原船改了、差卻一樣（兩艘一起長了同樣的格）也要換鍵 ⇒ 鍵把原船那一路的內嵌原文也算進去
  //   拆檔的成品：船還沒載 ⇒ 用清單上的內容雜湊（VK.embeddedKey；內嵌的照舊是原文）
  var txt = VK.embeddedKey(info.el);
  for (var vb = info, vn = 0; vb && vb.variant_of && vn < 8; vn++) { vb = hullInfo(vb.variant_of); txt += '|' + (vb ? VK.embeddedKey(vb.el) : ''); }
  key = key === undefined ? info.id : String(key);
  var fs = fitSpec(F); if (fs) txt += '|fit:' + fs;                        // 換了裝 ⇒ 模型網格不一樣
  var st = { vxk: cacheFnv(txt), code: cacheCode(), hit: false, why: '', key: key };
  if (key === info.id) info.cache = st; else (info.cacheFit = info.cacheFit || {})[key] = st;   // 讀數（90_main.js）照船型那一份；換裝的另外放   // 裝飾的網格一律建（05_hull.js decoSplit）⇒ 跟畫質無關、一份
  if (!CACHE_ON) { st.why = '?cache=0'; return Promise.resolve(null); }
  var t0 = performance.now();
  return cacheOpen().then(function (db) {
    if (!db) { st.why = '存不了（這個頁面不能用 IndexedDB）'; return null; }
    return new Promise(function (res) {
      try {
        var q = db.transaction('hull').objectStore('hull').get(key);
        q.onsuccess = function () {
          var r = q.result; st.readMs = performance.now() - t0;
          if (!r) st.why = '還沒有快取';
          else if (r.fmt !== CACHE_FMT || r.vxk !== st.vxk || r.code !== st.code) st.why = '快取過期（' + [r.fmt !== CACHE_FMT && '格式', r.vxk !== st.vxk && '船', r.code !== st.code && '程式'].filter(Boolean).join('、') + '換了）';
          else { st.hit = true; res(r); return; }
          res(null);
        };
        q.onerror = function () { st.why = '讀不了'; res(null); };
      } catch (e) { st.why = '讀不了'; res(null); }
    });
  });
}
/** 現場解析完的船型 ⇒ 存一筆（蓋掉舊的）。在背景做，失敗只記讀數。 */
function cachePut(T, info) {
  var st = T.key && T.key !== info.id ? (info.cacheFit || {})[T.key] : info.cache; if (!st) return;
  if (!CACHE_ON || st.hit || !T.keep) return;
  // ?start=1（Blocksail 地球儀開的；2026-10-20）：寫快取（IndexedDB 的 put 當場把整份記錄複製一遍，約 0.7 s）等開完戰、轉場拉下來了才寫（最多等 CACHE_LATE_S 秒）⇒ 不卡轉場動畫
  if (START_Q && BED_SLICE && !T.keepLate) { T.keepLate = performance.now(); cacheLater(T, info); return; }
  var g = T.base, ms = T.pristine.meshes, idx = [], n = 0;
  ms.forEach(function (m, i) { if (m) { idx.push(i, m.length); n += m.length; } });
  var all = new Uint16Array(n), o = 0;
  for (var k = 0; k < idx.length; k += 2) { all.set(ms.get(idx[k]), o); o += idx[k + 1]; }
  var rec = { fmt: CACHE_FMT, vxk: st.vxk, code: st.code, voxels: T.h.voxels, checksum: T.h.checksum, at: Date.now(), nx: g.nx, ny: g.ny,
    mesh: { all: all, idx: new Int32Array(idx) }, models: T.keep.models, hb: T.hullHB, hyd: T.hyd, disp: T.disp, rbox: T.rbox, sails: T.keep.sails || null, wrm: T.keep.wrm || null,cloth: T.nSail0 === undefined ? T.cloth : T.cloth.slice(0, T.nSail0) };   // 陣營旗的布不存（照設定檔每次現算）
  T.keep = null;
  cacheOpen().then(function (db) {
    if (!db) return;
    try {
      var t0 = performance.now(), tx = db.transaction('hull', 'readwrite');
      tx.objectStore('hull').put(rec, st.key || info.id);
      tx.oncomplete = function () { st.saved = true; st.saveMs = performance.now() - t0; };
      tx.onerror = tx.onabort = function () { st.saved = false; st.why = '存不了：' + (tx.error && tx.error.name || '?'); };
    } catch (e) { st.saved = false; st.why = '存不了：' + (e && e.name || e); }
  });
}
var CACHE_LATE_S = 30;
/** cachePut 晚一點：開戰了、轉場（03_camera.js CAM.tr）結束了才寫；等太久（分頁在背景、一直沒開戰）就照寫。 */
function cacheLater(T, info) {
  if (RUNNING && !FLOW_STAGE && !CAM.tr || performance.now() - T.keepLate > CACHE_LATE_S * 1000) { cachePut(T, info); return; }
  setTimeout(function () { cacheLater(T, info); }, 500);
}
/** 快取的船體網格 ⇒ RegionSet（跟 buildAll 同一份結果：每個區塊的四邊形，之後照樣 flush 上傳）。 */
function meshesFromCache(rs, M) {
  var g = rs.grid, o = 0;
  for (var k = 0; k < M.idx.length; k += 2) {
    var i = M.idx[k], n = M.idx[k + 1];
    rs.meshes.set(i, M.all.subarray(o, o + n)); o += n;
    rs.dirtyRegions.add(rs.rkey(i % g.nx, Math.floor(i / g.nx) % g.ny, Math.floor(i / (g.nx * g.ny))));
  }
  rs.flush();
}
