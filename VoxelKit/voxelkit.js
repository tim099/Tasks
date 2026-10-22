/* VoxelKit —— 雕刻作品的瀏覽器端：.vxk 解碼、稀疏網格、網格化、WebGL2 算繪、射線、連通。
 * 區塊職責：把 voxel_export.py 產的 .vxk（deflate-raw）變成可以畫、可以改的格子。零外部依賴。
 * 物理意義：座標一律是作品的格座標（x 船長、y 船寬、z 高），1 格 ＝ header.meters_per_voxel 公尺；
 *           世界座標怎麼擺由呼叫端給模型矩陣（格 → 世界）。
 * 設計取捨：
 *   · 網格是「16³ 區塊表」：只存非空區塊；兩份 Grid 可以共用同一份資料，誰先改哪一塊誰才複製（copy-on-write）。
 *   · 網格化以區塊為單位做同色面合併（greedy），GPU 緩衝以 64³ 為一區（少 draw call、改一格只重組一區）。
 *   · 頂點 8 bytes：uvec4(x, y, z, 法線 | 色值<<3)；色值在著色器裡照 RGB332 解。
 * 失敗處置：解碼對不上（magic、長度）⇒ 丟例外，⛔ 不畫半艘船；checksum 由呼叫端比（VoxelKit.verify）。
 */
(function (root) {
  'use strict';
  var CH = 16, CH3 = 4096, PAD = 18, PAD2 = 324;

  // ───────────────────────── 調色盤與 checksum ─────────────────────────
  function rgb332(i) { return [((i >> 5) & 7) * 255 / 7 | 0, ((i >> 2) & 7) * 255 / 7 | 0, (i & 3) * 255 / 3 | 0]; }
  function hashVoxel(x, y, z, c) {   // voxel_export.py 的 checksum 是同一式（mod 2^32）
    return (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791) ^ Math.imul(c, 2654435761 | 0)) >>> 0;
  }

  // ───────────────────────── 解碼 ─────────────────────────
  function b64ToBytes(s) {
    var bin = atob(s.replace(/\s+/g, '')), n = bin.length, u = new Uint8Array(n);
    for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function inflateRaw(u8) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('這個瀏覽器沒有 DecompressionStream（deflate-raw）'));
    var s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(s).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function parse(raw) {
    if (raw[0] !== 86 || raw[1] !== 88 || raw[2] !== 75 || raw[3] !== 49) throw new Error('不是 VXK1 封裝');
    var dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    var hn = dv.getUint32(4, true);
    var header = JSON.parse(new TextDecoder().decode(raw.subarray(8, 8 + hn)));
    var n = header.nchunks, p = 8 + hn;
    if (header.mirror) return { header: header, chunks: unmirror(header, raw, dv, p) };
    if (header.variant) return { header: header, chunks: null, variantAt: { raw: raw, dv: dv, p: p } };   // 改裝船：格子是跟原船的差 ⇒ decode 解了原船再套（unvariant）
    if (raw.length !== p + n * 6 + n * CH3) throw new Error('VXK1 長度不對：' + raw.length + ' ≠ ' + (p + n * 6 + n * CH3));
    var keys = new Uint16Array(n * 3);
    for (var i = 0; i < n * 3; i++) keys[i] = dv.getUint16(p + i * 2, true);
    p += n * 6;
    var chunks = [];
    for (i = 0; i < n; i++) chunks.push({ cx: keys[i * 3], cy: keys[i * 3 + 1], cz: keys[i * 3 + 2], data: raw.subarray(p + i * CH3, p + (i + 1) * CH3) });
    return { header: header, chunks: chunks };
  }
  /**
   * 成品壓縮的格子鏡射＋diff（TASK-0602；Blockside admin.py grid_mirror_pack／grid_mirror_unpack 是同一個算法）：
   * 格子那一段 ＝ 一半（2y ≤ s 的格，塊格式同原檔：mirror.nhalf 塊的鍵 ＋ 資料）＋ diff（線性索引 x＋sx·(y＋sy·z) 的差值 u32 ＋ 顏色 u8；顏色 0 ＝ 刪掉）。
   * 還原：一半照放、2y < s 的格鏡到 s − y（出界的不放）、套 diff、照 (cx, cy, cz) 字典序排、全空的塊不留 ⇒ 跟原檔的塊一位元組不差（admin.py 寫出去前驗過）。
   */
  function unmirror(header, raw, dv, p) {
    var M = header.mirror, s = M.s, nh = M.nhalf, nd = M.ndiff, sx = header.size[0], sy = header.size[1];
    var nx = Math.ceil(sx / CH), ny = Math.ceil(sy / CH), tab = new Map(), i, li;
    function chunk(x, y, z) {
      var k = (x >> 4) + nx * ((y >> 4) + ny * (z >> 4)), c = tab.get(k);
      if (!c) { c = new Uint8Array(CH3); tab.set(k, c); }
      return c;
    }
    var hk = [];
    for (i = 0; i < nh * 3; i++) hk.push(dv.getUint16(p + i * 2, true));
    var q = p + nh * 6;
    for (i = 0; i < nh; i++) {
      var d = raw.subarray(q + i * CH3, q + (i + 1) * CH3), bx = hk[i * 3] * CH, by = hk[i * 3 + 1] * CH, bz = hk[i * 3 + 2] * CH;
      for (li = 0; li < CH3; li++) {
        var v = d[li]; if (!v) continue;
        var x = bx + (li & 15), y = by + ((li >> 4) & 15), z = bz + (li >> 8);
        chunk(x, y, z)[li] = v;
        var ym = s - y;
        if (2 * y < s && ym < sy) chunk(x, ym, z)[(x & 15) | ((ym & 15) << 4) | ((z & 15) << 8)] = v;
      }
    }
    q += nh * CH3;
    var at = 0;
    for (i = 0; i < nd; i++) {
      at += dv.getUint32(q + i * 4, true);
      var cz = Math.floor(at / (sx * sy)), r = at - cz * sx * sy, cy = Math.floor(r / sx), cx = r - cy * sx;
      chunk(cx, cy, cz)[(cx & 15) | ((cy & 15) << 4) | ((cz & 15) << 8)] = raw[q + nd * 4 + i];
    }
    if (q + nd * 5 !== raw.length) throw new Error('VXK1 鏡射段長度不對：' + raw.length + ' ≠ ' + (q + nd * 5));
    var out = [];
    tab.forEach(function (c, k) {
      for (li = 0; li < CH3; li++) if (c[li]) break;
      if (li === CH3) return;                                                // 全空（diff 刪光了）⇒ 原檔沒有這一塊
      var cx = k % nx, cy = Math.floor(k / nx) % ny, cz = Math.floor(k / (nx * ny));
      out.push({ cx: cx, cy: cy, cz: cz, data: c });
    });
    out.sort(function (a, b) { return a.cx - b.cx || a.cy - b.cy || a.cz - b.cz; });   // voxel_export.pack 的順序（np.unique 照 (cx, cy, cz) 字典序）
    if (out.length !== header.nchunks) throw new Error('VXK1 鏡射還原出 ' + out.length + ' 塊，header 說 ' + header.nchunks + ' 塊');
    return out;
  }
  /**
   * 成品壓縮的改裝船（TASK-0657；Blockside admin.py grid_variant_pack／grid_variant_unpack 是同一個算法）：header.variant ＝ { el: 原船的內嵌標籤, ndiff }，
   * 格子那一段 ＝ 跟原船（照它自己的讀法還原好的格子）的差：線性索引 x＋sx·(y＋sy·z) 的差值 u32 × ndiff ＋ 顏色 u8 × ndiff（顏色 0 ＝ 刪掉）。
   * 原船的 sx、sy 跟改裝船一樣（admin.py 驗過；sz 可以不同）。還原：原船的塊複製一份、套 diff、全空的塊不留、照 (cx, cy, cz) 字典序 ⇒ 跟改裝船原檔的塊一位元組不差。
   */
  function unvariant(r, base) {
    var header = r.header, V = header.variant, nd = V.ndiff, sx = header.size[0], sy = header.size[1], raw = r.variantAt.raw, dv = r.variantAt.dv, q = r.variantAt.p;
    if (base.header.size[0] !== sx || base.header.size[1] !== sy) throw new Error('改裝船的原船 #' + V.el + ' 尺寸 ' + base.header.size + ' 跟改裝船 ' + header.size + ' 的 x、y 不一樣');
    if (q + nd * 5 !== raw.length) throw new Error('VXK1 改裝船段長度不對：' + raw.length + ' ≠ ' + (q + nd * 5));
    var nx = Math.ceil(sx / CH), ny = Math.ceil(sy / CH), tab = new Map(), i, li;
    base.chunks.forEach(function (c) { tab.set(c.cx + nx * (c.cy + ny * c.cz), new Uint8Array(c.data)); });   // ⛔ 複製：原船的塊還要給原船用
    var at = 0;
    for (i = 0; i < nd; i++) {
      at += dv.getUint32(q + i * 4, true);
      var cz = Math.floor(at / (sx * sy)), rr = at - cz * sx * sy, cy = Math.floor(rr / sx), cx = rr - cy * sx;
      var k = (cx >> 4) + nx * ((cy >> 4) + ny * (cz >> 4)), c = tab.get(k);
      if (!c) { c = new Uint8Array(CH3); tab.set(k, c); }
      c[(cx & 15) | ((cy & 15) << 4) | ((cz & 15) << 8)] = raw[q + nd * 4 + i];
    }
    var out = [];
    tab.forEach(function (c, k) {
      for (li = 0; li < CH3; li++) if (c[li]) break;
      if (li === CH3) return;
      out.push({ cx: k % nx, cy: Math.floor(k / nx) % ny, cz: Math.floor(k / (nx * ny)), data: c });
    });
    out.sort(function (a, b) { return a.cx - b.cx || a.cy - b.cy || a.cz - b.cz; });
    if (out.length !== header.nchunks) throw new Error('VXK1 改裝船還原出 ' + out.length + ' 塊，header 說 ' + header.nchunks + ' 塊');
    return { header: header, chunks: out };
  }
  /**
   * 成品裡改裝船跟原船相同的檔頭欄（TASK-0667；Blockside admin.py header_shared／header_unshare 是同一個算法）：header.vh ＝ { el: 原船的內嵌標籤, k: [路徑, …] }，
   * 路徑 ＝ 一串鍵（只走物件）；那幾欄從原船（照它自己的讀法解好的檔頭）放回來、拿掉 vh。原船每次都是新解的一份 ⇒ 直接拿它的物件、不用複製。
   */
  function unshare(header, base) {
    header.vh.k.forEach(function (p) {
      var a = header, b = base;
      for (var i = 0; i < p.length - 1; i++) { if (!a[p[i]]) a[p[i]] = {}; a = a[p[i]]; b = b[p[i]]; }
      a[p[p.length - 1]] = b[p[p.length - 1]];
    });
    delete header.vh;
  }
  function decode(u8) {
    return inflateRaw(u8).then(parse).then(function (r) {
      var V = r.header.vh, el = r.variantAt ? r.header.variant.el : V ? V.el : null;
      if (!el) return r;
      return loadEmbedded(el).then(function (base) {                   // 原船照它自己的讀法（鏡射、再上一層的改裝船都行）
        if (V) unshare(r.header, base.header);
        return r.variantAt ? unvariant(r, base) : r;
      });
    });
  }
  /** <script type="application/x-asset" id="…" data-mime="…">base64</script>（vxk_inline.py 填的）；空的（optional 素材沒交）⇒ null。 */
  function embedded(id) {
    var el = document.getElementById(id); if (!el) return null;
    var t = el.textContent.replace(/\s+/g, '');
    return t ? { mime: el.getAttribute('data-mime') || 'application/octet-stream', b64: t } : null;
  }
  /** 內嵌的圖 ⇒ Promise<Image|null>（沒有或解不開 ⇒ null，呼叫端用替代品）。 */
  function embeddedImage(id) {
    var e = embedded(id); if (!e) return Promise.resolve(null);
    return new Promise(function (res) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = function () { res(null); }; im.src = 'data:' + e.mime + ';base64,' + e.b64; });
  }
  /** 內嵌的 JSON ⇒ 物件（沒有或解不開 ⇒ null）。 */
  function embeddedJSON(id) {
    var e = embedded(id); if (!e) return null;
    try { return JSON.parse(new TextDecoder().decode(b64ToBytes(e.b64))); } catch (x) { return null; }
  }
  /**
   * 拆檔的成品（Blockside admin.py build 預設；Tim 2026-10-20「index.html變成入口」）：船不內嵌，入口有一張清單（JSON、元素 id 是 vxk-ships：
   * { 標籤: 雜湊 }；⛔ 這裡不寫出完整的標籤 —— 建置照字串找它，註解裡有一模一樣的會被當成清單），每艘一個檔 ships/<標籤>.js
   * （內容 VoxelKit.ship("<標籤>", [段, 段, …], "<雜湊>")：同一條 deflate-raw 串流照結構切段、每段各自 base64 —— 各段解開接起來就是以前內嵌的那一份；為什麼切見 admin.py「船檔分段」）。
   * 要用才用 <script> 載（⛔ 不用 fetch：直接開 index.html（file://）時 fetch 讀不到旁邊的檔，<script> 讀得到；同 maps/ 的海圖塊），網址帶 ?v=<雜湊> 擋舊快取；
   * 載進來的雜湊跟清單對不上 ⇒ 不是同一次建置的（舊入口配新 ships/、或反過來）⇒ 明說、不用。
   * 路徑照頁面自己的網址算 ⇒ 被別的頁面用 iframe 開（Blocksail 的 external/Blockside/index.html）照樣找得到它旁邊的 ships/。
   */
  var SHIPS = null, SHIP_DATA = {}, SHIP_HASH = {}, SHIP_P = {};
  function shipIndex() {
    if (!SHIPS) { var e = document.getElementById('vxk-ships'); try { SHIPS = e ? JSON.parse(e.textContent) : {}; } catch (x) { SHIPS = {}; } }
    return SHIPS;
  }
  /** 船檔載進來時呼叫（ships/<標籤>.js 裡就這一行）；data ＝ base64 一整條，或一段一段的清單；h ＝ 內容雜湊。 */
  function ship(id, data, h) { SHIP_DATA[id] = data; SHIP_HASH[id] = h; }
  /** 這一艘有沒有資料（內嵌，或清單上有）。 */
  function hasEmbedded(id) { return !!document.getElementById(id) || !!shipIndex()[id]; }
  /** 這一艘資料的指紋字串（不用載）：內嵌 ⇒ 原文；拆檔 ⇒ 清單上的雜湊（內容雜湊，內容變了它一定變）。給快取當鍵（06_cache.js）。 */
  function embeddedKey(id) { var el = document.getElementById(id), h = shipIndex()[id]; return el ? el.textContent : h ? 'ships:' + h : ''; }
  /** base64 一整條或一段一段 ⇒ 位元組（段 ⇒ 各自解、照順序接起來）。 */
  function piecesToBytes(d) {
    if (typeof d === 'string') return b64ToBytes(d);
    var P = d.map(b64ToBytes), n = 0, i; for (i = 0; i < P.length; i++) n += P[i].length;
    var u = new Uint8Array(n); for (i = 0, n = 0; i < P.length; i++) { u.set(P[i], n); n += P[i].length; }
    return u;
  }
  /** 入口過期（TASK-0829；Tim 2026-10-22「開單並照建議做自動重載」）：船檔的雜湊跟清單對不上 ⇒ 多半是部署之前就開著的頁、或快取裡的舊入口
   *  （測試站 index.html 是 max-age=600；Pages 不看 ?v=，舊入口要的網址照樣回新的船檔 —— 量過）⇒ 重新整理一次（瀏覽器重新整理時主頁面會向伺服器重新驗證 ⇒ 拿到新的入口）。
   *  ⛔ 不先用 fetch 帶 cache:'reload' 換快取：成品零外部依賴（vxk_inline.py 擋這個呼叫），⛔ 也不改用 XHR 繞過那道守衛。
   *  只試一次 ＝ sessionStorage 記住這一對雜湊（清單要的 > 檔是的）；重載後還是同一對 ⇒ 回 false、照舊報錯（⛔ 無限重整）。
   *  不重載（回 false）：不是 http(s)（file:// 直接開的成品）、sessionStorage 讀寫失敗（隱私模式擋掉 ⇒ 記不住試過沒）。
   *  被別的頁面用 iframe 開（Blocksail battle.html）⇒ location 是 iframe 自己的 ⇒ 只重載它。回 true ⇒ 那個 Promise 不結束（頁面要重載了）。 */
  function staleReload(want, got) {
    if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return false;
    var key = 'vxk-stale:' + location.pathname, tag = want + '>' + got;
    try { if (sessionStorage.getItem(key) === tag) return false; sessionStorage.setItem(key, tag); } catch (x) { return false; }
    try {
      var d = document.createElement('div');
      d.textContent = '測試站剛更新（這一頁的入口是舊的）⇒ 重新載入…';
      d.style.cssText = 'position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);z-index:99999;padding:14px 22px;border-radius:10px;background:rgba(20,30,50,.92);color:#fff;font:16px sans-serif';
      (document.body || document.documentElement).appendChild(d);
    } catch (x) { }
    setTimeout(function () { location.reload(); }, 600);                // 讓那一句先畫出來
    return true;
  }
  /** 這一艘壓縮過的位元組 ⇒ Promise（內嵌的直接給；拆檔的第一次要的時候載那個檔，同一艘只載一次）。 */
  function embeddedBytes(id) {
    var el = document.getElementById(id); if (el) return Promise.resolve(b64ToBytes(el.textContent));
    var h = shipIndex()[id];
    if (SHIP_DATA[id] && SHIP_HASH[id] === h) return Promise.resolve(piecesToBytes(SHIP_DATA[id]));
    if (!h) return Promise.reject(new Error('找不到內嵌的 .vxk：#' + id));
    return SHIP_P[id] || (SHIP_P[id] = new Promise(function (res, rej) {
      var s = document.createElement('script'), src = ((root.BS_SHELL && root.BS_SHELL.ships) || '') + 'ships/' + id + '.js';   // 外掛外殼（admin.py shell）的頁不在 Blockside 根目錄 ⇒ 船檔照它給的前綴
      function bad(msg) { delete SHIP_P[id]; rej(new Error(msg)); }
      s.onload = function () {
        if (!SHIP_DATA[id]) bad(src + ' 載進來了，裡面卻不是 #' + id);
        else if (SHIP_HASH[id] !== h) { if (!staleReload(h, SHIP_HASH[id])) bad(src + ' 跟這個 index.html 不是同一次建置的（清單要 ' + h + '，檔是 ' + SHIP_HASH[id] + '）⇒ 入口跟 ships/ 要同一版'); }
        else res(piecesToBytes(SHIP_DATA[id]));
      };
      s.onerror = function () { bad('載不到 ' + src + '（成品拆檔了：搬成品要連 ships/ 一起；舊的版本用 python -I src/admin.py snapshot <版本> <資料夾> 取出）'); };
      s.src = src + '?v=' + h; document.head.appendChild(s);
    }));
  }
  /** <script type="application/x-vxk" id="…">base64</script>（vxk_inline.py 填進去的），或拆檔的船檔 ⇒ 模型。 */
  function loadEmbedded(id) {
    return embeddedBytes(id).then(decode);
  }

  // ───────────────────────── 稀疏網格 ─────────────────────────
  function Grid(size) {
    this.sx = size[0]; this.sy = size[1]; this.sz = size[2];
    this.nx = Math.ceil(this.sx / CH); this.ny = Math.ceil(this.sy / CH); this.nz = Math.ceil(this.sz / CH);
    this.tab = new Array(this.nx * this.ny * this.nz).fill(null);
    this.own = new Uint8Array(this.tab.length);    // 1 ＝ 這份 Grid 自己的（可以直接寫）
    this.count = 0;
    this.sm = null;                                // 平滑渲染的旗標網格（呼叫端給；meshChunk 不出那些格的方塊面）
    this.gl = null;                                // 透明格的旗標網格（呼叫端給；meshChunk 不出那些格的方塊面、也不讓它們擋住旁邊格子的面 ⇒ 呼叫端另外畫成半透明）
    this.cv = new Uint32Array(this.tab.length);    // 每一塊改過幾次、整份改過幾次（ver）：呼叫端記下來比 ⇒ 知道哪幾塊變了（Blockside 05_material.js voxLostT 只重數變過的塊）
    this.ver = 0;
  }
  Grid.fromModel = function (model) {
    var g = new Grid(model.header.size);
    model.chunks.forEach(function (c) { g.tab[g.ci(c.cx, c.cy, c.cz)] = c.data; });
    g.count = model.header.voxels;
    return g;
  };
  /** 共用同一份資料的另一份網格（之後各改各的）。 */
  Grid.prototype.share = function () {
    var g = new Grid([this.sx, this.sy, this.sz]);
    g.tab = this.tab.slice(); g.count = this.count; g.sm = this.sm; g.gl = this.gl;   // sm：平滑渲染的旗標、gl：透明格的旗標（不會變 ⇒ 共用同一份）
    return g;
  };
  Grid.prototype.ci = function (cx, cy, cz) { return cx + this.nx * (cy + this.ny * cz); };
  Grid.prototype.get = function (x, y, z) {
    if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return 0;
    var c = this.tab[(x >> 4) + this.nx * ((y >> 4) + this.ny * (z >> 4))];
    return c === null ? 0 : c[(x & 15) | ((y & 15) << 4) | ((z & 15) << 8)];
  };
  /** 寫一格，回舊值。界外 ⇒ 不寫、回 -1。 */
  Grid.prototype.set = function (x, y, z, v) {
    if (x < 0 || y < 0 || z < 0 || x >= this.sx || y >= this.sy || z >= this.sz) return -1;
    var i = (x >> 4) + this.nx * ((y >> 4) + this.ny * (z >> 4)), c = this.tab[i];
    var li = (x & 15) | ((y & 15) << 4) | ((z & 15) << 8);
    if (c === null) { if (!v) return 0; c = this.tab[i] = new Uint8Array(CH3); this.own[i] = 1; }
    else if (!this.own[i]) { if (c[li] === v) return v; c = this.tab[i] = new Uint8Array(c); this.own[i] = 1; }
    var old = c[li];
    if (old !== v) { c[li] = v; this.count += (v ? 1 : 0) - (old ? 1 : 0); this.cv[i]++; this.ver++; }
    return old;
  };
  /** 每格走一次（cb(x, y, z, c)）。 */
  Grid.prototype.each = function (cb) {
    for (var cz = 0; cz < this.nz; cz++) for (var cy = 0; cy < this.ny; cy++) for (var cx = 0; cx < this.nx; cx++) {
      var c = this.tab[this.ci(cx, cy, cz)];
      if (c === null) continue;
      for (var li = 0; li < CH3; li++) if (c[li]) cb(cx * CH + (li & 15), cy * CH + ((li >> 4) & 15), cz * CH + (li >> 8), c[li]);
    }
  };
  /** 逐格 checksum 與格數 ⇒ 跟 header 比（還沒動過的網格才該相等）。 */
  function verify(grid, header) {
    var sum = 0, n = 0;
    grid.each(function (x, y, z, c) { sum = (sum + hashVoxel(x, y, z, c)) >>> 0; n++; });
    return { voxels: n, checksum: sum, ok: n === header.voxels && sum === header.checksum };
  }

  // ───────────────────────── 網格化（區塊內同色面合併） ─────────────────────────
  var pad = new Uint8Array(PAD * PAD * PAD), spad = new Uint8Array(PAD * PAD * PAD), gpad = new Uint8Array(PAD * PAD * PAD), mask = new Int16Array(CH * CH);
  // 軸 a 的面：u、v 取讓 (u, v, a) 成右手系的兩軸
  var UAX = [1, 2, 0], VAX = [2, 0, 1], P = [0, 0, 0];
  /** 一個區塊的四邊形 ⇒ Uint16Array（每頂點 x,y,z,packed；每四邊形 4 頂點）。空 ⇒ null。 */
  function meshChunk(grid, cx, cy, cz) {
    var c = grid.tab[grid.ci(cx, cy, cz)];
    if (c === null) return null;
    var x0 = cx * CH, y0 = cy * CH, z0 = cz * CH, x, y, z;
    // 填 18³（含鄰居一層）：內部直接抄，外框一格一格問網格
    pad.fill(0);
    for (z = 0; z < CH; z++) for (y = 0; y < CH; y++) {
      var src = (y << 4) | (z << 8), dst = 1 + (y + 1) * PAD + (z + 1) * PAD2;
      for (x = 0; x < CH; x++) pad[dst + x] = c[src + x];
    }
    // 平滑渲染的格（grid.sm：同尺寸的旗標網格，非 0 ＝ 這一格由呼叫端另外畫成平滑面）：自己不出方塊面，但照樣擋住旁邊格子的面（⇒ 兩種接在一起不露縫）
    var sc = grid.sm ? grid.sm.tab[grid.ci(cx, cy, cz)] : null;
    if (sc) for (z = 0; z < CH; z++) for (y = 0; y < CH; y++) {
      var ss = (y << 4) | (z << 8), sd = 1 + (y + 1) * PAD + (z + 1) * PAD2;
      for (x = 0; x < CH; x++) spad[sd + x] = sc[ss + x];
    }
    for (var a = 0; a < 3; a++) for (var s = -1; s <= CH; s += CH + 1) for (var p = -1; p <= CH; p++) for (var q = -1; q <= CH; q++) {
      var lx, ly, lz;
      if (a === 0) { lx = s; ly = p; lz = q; } else if (a === 1) { lx = p; ly = s; lz = q; } else { lx = p; ly = q; lz = s; }
      pad[(lx + 1) + (ly + 1) * PAD + (lz + 1) * PAD2] = grid.get(x0 + lx, y0 + ly, z0 + lz);
    }
    // 透明格（grid.gl：同尺寸的旗標網格，非 0 ＝ 這一格由呼叫端另外畫成半透明）：自己不出方塊面，也不擋旁邊格子的面（⇒ 透過它看得到後面）。
    //   18³ 裡（含鄰居一層）一格都沒有 ⇒ gp ＝ null，照沒有透明格那一條（輸出一位元不差）；先看周圍 27 塊有沒有透明格的塊，沒有就不逐格問
    var gp = null, G = grid.gl, near = false;
    if (G) for (var dz = -1; dz <= 1 && !near; dz++) for (var dy = -1; dy <= 1 && !near; dy++) for (var dx = -1; dx <= 1; dx++) {
      var qx = cx + dx, qy = cy + dy, qz = cz + dz;
      if (qx >= 0 && qy >= 0 && qz >= 0 && qx < G.nx && qy < G.ny && qz < G.nz && G.tab[G.ci(qx, qy, qz)]) { near = true; break; }
    }
    if (near) {
      var any = false;
      gpad.fill(0);
      for (z = -1; z <= CH; z++) for (y = -1; y <= CH; y++) for (x = -1; x <= CH; x++) {
        var gv = G.get(x0 + x, y0 + y, z0 + z); if (gv) { gpad[(x + 1) + (y + 1) * PAD + (z + 1) * PAD2] = 1; any = true; }
      }
      if (any) gp = gpad;
    }
    var out = [], st = [1, PAD, PAD2];
    for (a = 0; a < 3; a++) {
      var ua = UAX[a], va = VAX[a], sa = st[a], su = st[ua], sv = st[va], B = 1 + PAD + PAD2;
      for (var sgn = 1; sgn >= -1; sgn -= 2) {
        var nrm = a * 2 + (sgn > 0 ? 0 : 1), off = sgn * st[a];
        for (var d = 0; d < CH; d++) {
          var any = false, row0 = B + d * sa;
          for (var v = 0; v < CH; v++) for (var u = 0, pi = row0 + v * sv; u < CH; u++, pi += su) {
            var col = pad[pi], m = (col && !pad[pi + off] && !(sc && spad[pi])) ? col : 0;
            if (gp && col) m = (!gp[pi] && (!pad[pi + off] || gp[pi + off]) && !(sc && spad[pi])) ? col : 0;   // 透明格：自己不出面；旁邊是透明格 ⇒ 照空氣出面
            mask[u + v * CH] = m; if (m) any = true;
          }
          if (!any) continue;
          var plane = (a === 0 ? x0 : a === 1 ? y0 : z0) + d + (sgn > 0 ? 1 : 0);
          var bu = (ua === 0 ? x0 : ua === 1 ? y0 : z0), bv = (va === 0 ? x0 : va === 1 ? y0 : z0);
          for (v = 0; v < CH; v++) for (u = 0; u < CH;) {
            var k = mask[u + v * CH];
            if (!k) { u++; continue; }
            var w = 1; while (u + w < CH && mask[u + w + v * CH] === k) w++;
            var h = 1, ok = true;
            while (v + h < CH && ok) { for (var t = 0; t < w; t++) if (mask[u + t + (v + h) * CH] !== k) { ok = false; break; } if (ok) h++; }
            for (var hh = 0; hh < h; hh++) for (t = 0; t < w; t++) mask[u + t + (v + hh) * CH] = 0;
            var U0 = bu + u, V0 = bv + v, U1 = U0 + w, V1 = V0 + h, pk = nrm | (k << 3);
            var cs = sgn > 0 ? [U0, V0, U1, V0, U1, V1, U0, V1] : [U0, V0, U0, V1, U1, V1, U1, V0];
            for (var e = 0; e < 4; e++) {
              P[a] = plane; P[ua] = cs[e * 2]; P[va] = cs[e * 2 + 1];
              out.push(P[0], P[1], P[2], pk);
            }
            u += w;
          }
        }
      }
    }
    return out.length ? new Uint16Array(out) : null;
  }

  // ───────────────────────── 矩陣（column-major，WebGL 慣例） ─────────────────────────
  var M4 = {
    ident: function () { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
    mul: function (a, b) {
      var o = new Float32Array(16);
      for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++)
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      return o;
    },
    persp: function (fovy, asp, n, f) {
      var t = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
      o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o;
    },
    lookAt: function (e, c, up) {
      var zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2], l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
      var xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx; l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
      var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
        -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
    },
    inv: function (m) {
      var o = new Float32Array(16), a = m;
      var b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5];
      var b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6], b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12];
      var b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
      var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06; det = 1 / det;
      o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
      o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
      o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
      o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
      o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
      o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
      o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
      o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
      return o;
    },
    pt: function (m, x, y, z) { return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]; },
    dir: function (m, x, y, z) { return [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z]; }
  };

  // ───────────────────────── 射線（格座標；Amanatides–Woo） ─────────────────────────
  /** 從 o 沿 d（不必單位化）走到 tMax（以 d 的長度為單位），第一個非空格 ⇒ {x,y,z,t,c,face}；沒碰到 ⇒ null。 */
  function raycast(grid, o, d, tMax) {
    var t0 = 0, t1 = tMax, lo = [0, 0, 0], hi = [grid.sx, grid.sy, grid.sz];
    for (var a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-12) { if (o[a] < lo[a] || o[a] >= hi[a]) return null; continue; }
      var ta = (lo[a] - o[a]) / d[a], tb = (hi[a] - o[a]) / d[a];
      if (ta > tb) { var s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) return null;
    }
    var t = t0 + 1e-6, p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    var c = [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])], step = [0, 0, 0], tN = [0, 0, 0], tD = [0, 0, 0], face = -1;
    for (a = 0; a < 3; a++) {
      c[a] = Math.min(hi[a] - 1, Math.max(0, c[a]));
      step[a] = d[a] > 0 ? 1 : -1;
      tD[a] = Math.abs(d[a]) < 1e-12 ? Infinity : Math.abs(1 / d[a]);
      tN[a] = Math.abs(d[a]) < 1e-12 ? Infinity : ((d[a] > 0 ? c[a] + 1 : c[a]) - o[a]) / d[a];
    }
    for (var it = 0; it < 8192; it++) {
      var v = grid.get(c[0], c[1], c[2]);
      if (v) return { x: c[0], y: c[1], z: c[2], t: t, c: v, face: face };
      var m = tN[0] < tN[1] ? (tN[0] < tN[2] ? 0 : 2) : (tN[1] < tN[2] ? 1 : 2);
      t = tN[m]; if (t > t1) return null;
      c[m] += step[m]; tN[m] += tD[m]; face = m * 2 + (step[m] > 0 ? 1 : 0);
      if (c[m] < 0 || c[m] >= hi[m]) return null;
    }
    return null;
  }

  // ───────────────────────── 連通：哪些格跟錨點斷開了 ─────────────────────────
  /**
   * seeds：被打掉那些格的鄰格（打包 x | y<<10 | z<<20）。從每顆種子往外找，先往下（z 小）走：
   * 碰到錨點、或碰到已知連著的格 ⇒ 連著；找完都沒碰到 ⇒ 這一團斷開了。
   * budget：一團超過這麼多格就當連著（⛔ 不讓一次判定卡住畫面 —— 代價是極大的一塊不會掉）。
   * 回：斷開的每一團（Int32Array，打包座標）。
   */
  function detached(grid, seeds, isAnchor, budget) {
    var vis = new Map(), pieces = [];
    function mk(x, y, z) {
      var i = (x >> 4) + grid.nx * ((y >> 4) + grid.ny * (z >> 4)), m = vis.get(i);
      if (!m) { m = new Uint8Array(CH3); vis.set(i, m); }
      return m;
    }
    function getv(x, y, z) { var m = vis.get((x >> 4) + grid.nx * ((y >> 4) + grid.ny * (z >> 4))); return m ? m[(x & 15) | ((y & 15) << 4) | ((z & 15) << 8)] : 0; }
    function setv(x, y, z, v) { mk(x, y, z)[(x & 15) | ((y & 15) << 4) | ((z & 15) << 8)] = v; }
    var NB = [[0, 0, 1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, -1]];   // 往下最後推 ⇒ 最先彈出
    var stack = new Int32Array(1 << 16), list = [];
    for (var si = 0; si < seeds.length; si++) {
      var s = seeds[si], sx = s & 2047, sy = (s >> 11) & 1023, sz = s >> 21;
      if (!grid.get(sx, sy, sz) || getv(sx, sy, sz)) continue;
      var sp = 0, conn = false; list.length = 0;
      stack[sp++] = s; setv(sx, sy, sz, 2); list.push(s);
      outer: while (sp) {
        var p = stack[--sp], x = p & 2047, y = (p >> 11) & 1023, z = p >> 21;
        if (isAnchor(x, y, z)) { conn = true; break; }
        for (var k = 0; k < 6; k++) {
          var nx = x + NB[k][0], ny = y + NB[k][1], nz = z + NB[k][2];
          if (!grid.get(nx, ny, nz)) continue;
          var mv = getv(nx, ny, nz);
          if (mv === 1) { conn = true; break outer; }
          if (mv) continue;
          setv(nx, ny, nz, 2);
          var q = nx | (ny << 11) | (nz << 21);
          if (sp >= stack.length) { var ns = new Int32Array(stack.length * 2); ns.set(stack); stack = ns; }
          stack[sp++] = q; list.push(q);
        }
        if (list.length > budget) { conn = true; break; }
      }
      for (var j = 0; j < list.length; j++) { var r = list[j]; setv(r & 2047, (r >> 11) & 1023, r >> 21, conn ? 1 : 3); }
      if (!conn) pieces.push(Int32Array.from(list));
    }
    return pieces;
  }

  // ───────────────────────── WebGL2 ─────────────────────────
  function compile(gl, vs, fs) {
    function sh(t, src) {
      var s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('著色器編譯失敗：' + gl.getShaderInfoLog(s) + '\n' + src.split('\n').slice(0, 3).join('\n'));
      return s;
    }
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('著色器連結失敗：' + gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i), nm = info.name.replace(/\[0\]$/, ''); u[nm] = gl.getUniformLocation(p, info.name); }
    return { prog: p, u: u };
  }

  // 體素著色器：格座標進、世界座標出；邊線與每格明暗是在片段裡從格座標算的（合併過的大面也看得到一格一格）
  var VOXEL_VS = '#version 300 es\n' +
    'layout(location=0) in uvec4 aV;\n' +
    'uniform mat4 uModel, uVP;\n' +
    'out vec3 vL; out vec3 vW; flat out uint vN; flat out uint vC;\n' +
    'void main(){ vec3 p=vec3(aV.xyz); vL=p; vec4 w=uModel*vec4(p,1.0); vW=w.xyz; vN=aV.w&7u; vC=(aV.w>>3u)&255u; gl_Position=uVP*w; }\n';
  var VOXEL_FS = '#version 300 es\nprecision highp float;\n' +
    'in vec3 vL; in vec3 vW; flat in uint vN; flat in uint vC;\n' +
    'uniform mat4 uModel; uniform vec3 uSun, uEye, uFog, uSky, uGround; uniform float uFogD, uWater, uTint;\n' +
    'out vec4 o;\n' +
    'const vec3 NT[6]=vec3[6](vec3(1,0,0),vec3(-1,0,0),vec3(0,1,0),vec3(0,-1,0),vec3(0,0,1),vec3(0,0,-1));\n' +
    'float h3(vec3 p){ return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453); }\n' +
    'void main(){\n' +
    '  vec3 nl=NT[int(vN)]; vec3 n=normalize(mat3(uModel)*nl);\n' +
    '  vec3 base=vec3(float((vC>>5u)&7u)/7.0, float((vC>>2u)&7u)/7.0, float(vC&3u)/3.0);\n' +
    '  vec3 cell=floor(vL-nl*0.5); base*=0.92+0.16*h3(cell);\n' +
    '  vec3 f=fract(vL); vec3 e=min(f,1.0-f); float ed=min(e.x,e.y);\n' +
    '  if(vN<2u){ ed=min(e.y,e.z); } else if(vN<4u){ ed=min(e.x,e.z); }\n' +
    '  base*=mix(0.82,1.0,smoothstep(0.0,0.09,ed));\n' +
    '  float di=max(dot(n,uSun),0.0); vec3 amb=mix(uGround,uSky,n.y*0.5+0.5);\n' +
    '  vec3 c=base*(amb*0.62+vec3(1.0,0.96,0.88)*di*0.78);\n' +
    '  if(vW.y<uWater){ float dd=clamp((uWater-vW.y)*0.12,0.0,1.0); c=mix(c,vec3(0.04,0.18,0.22),0.35+0.55*dd); }\n' +
    '  c=mix(c,vec3(1.0,0.45,0.2),uTint);\n' +
    '  float fd=length(vW-uEye); c=mix(c,uFog,1.0-exp(-fd*uFogD));\n' +
    '  o=vec4(c,1.0);\n' +
    '}\n';

  /**
   * RegionSet：一份 Grid 的 GPU 端。區塊網格快取在 meshes（區塊索引 → Uint16Array|null），
   * 64³ 一區上傳成一個 VAO。share(other) 讓第二份網格先借用第一份的區（被改到的區才自己建）。
   */
  function RegionSet(gl, grid, quadIbo) {
    this.gl = gl; this.grid = grid; this.ibo = quadIbo;
    this.meshes = new Map(); this.regions = new Map(); this.dirty = new Set(); this.dirtyRegions = new Set();
    this.rx = Math.ceil(grid.nx / 4); this.ry = Math.ceil(grid.ny / 4);
  }
  RegionSet.prototype.rkey = function (cx, cy, cz) { return (cx >> 2) + this.rx * ((cy >> 2) + this.ry * (cz >> 2)); };
  RegionSet.prototype.buildAll = function () {
    var g = this.grid;
    for (var cz = 0; cz < g.nz; cz++) for (var cy = 0; cy < g.ny; cy++) for (var cx = 0; cx < g.nx; cx++) {
      var i = g.ci(cx, cy, cz); if (g.tab[i] === null) continue;
      this.meshes.set(i, meshChunk(g, cx, cy, cz)); this.dirtyRegions.add(this.rkey(cx, cy, cz));
    }
    this.flush();
  };
  /** 跟另一份（同一份資料長出來的）共用網格與區；之後被改到的才各自重建。 */
  RegionSet.prototype.shareFrom = function (o) {
    var self = this;
    o.meshes.forEach(function (m, k) { self.meshes.set(k, m); });
    o.regions.forEach(function (r, k) { self.regions.set(k, { vao: r.vao, vbo: r.vbo, n: r.n, own: false }); });
  };
  /** 一格改了 ⇒ 它的區塊（貼邊的話連鄰區塊）要重網格化。 */
  RegionSet.prototype.touch = function (x, y, z) {
    var g = this.grid, cx = x >> 4, cy = y >> 4, cz = z >> 4, lx = x & 15, ly = y & 15, lz = z & 15;
    this.dirty.add(g.ci(cx, cy, cz));
    if (lx === 0 && cx > 0) this.dirty.add(g.ci(cx - 1, cy, cz)); if (lx === 15 && cx < g.nx - 1) this.dirty.add(g.ci(cx + 1, cy, cz));
    if (ly === 0 && cy > 0) this.dirty.add(g.ci(cx, cy - 1, cz)); if (ly === 15 && cy < g.ny - 1) this.dirty.add(g.ci(cx, cy + 1, cz));
    if (lz === 0 && cz > 0) this.dirty.add(g.ci(cx, cy, cz - 1)); if (lz === 15 && cz < g.nz - 1) this.dirty.add(g.ci(cx, cy, cz + 1));
  };
  RegionSet.prototype.flush = function () {
    var g = this.grid, self = this;
    this.dirty.forEach(function (i) {
      var cx = i % g.nx, cy = Math.floor(i / g.nx) % g.ny, cz = Math.floor(i / (g.nx * g.ny));
      self.meshes.set(i, meshChunk(g, cx, cy, cz)); self.dirtyRegions.add(self.rkey(cx, cy, cz));
    });
    this.dirty.clear();
    var gl = this.gl;
    this.dirtyRegions.forEach(function (rk) {
      var rx = rk % self.rx, ry = Math.floor(rk / self.rx) % self.ry, rz = Math.floor(rk / (self.rx * self.ry));
      var parts = [], len = 0;
      for (var cz = rz * 4; cz < Math.min(g.nz, rz * 4 + 4); cz++) for (var cy = ry * 4; cy < Math.min(g.ny, ry * 4 + 4); cy++)
        for (var cx = rx * 4; cx < Math.min(g.nx, rx * 4 + 4); cx++) { var m = self.meshes.get(g.ci(cx, cy, cz)); if (m) { parts.push(m); len += m.length; } }
      var r = self.regions.get(rk);
      if (!len) { if (r && r.own) { gl.deleteBuffer(r.vbo); gl.deleteVertexArray(r.vao); } self.regions.delete(rk); return; }
      var all = new Uint16Array(len), o = 0;
      parts.forEach(function (m) { all.set(m, o); o += m.length; });
      if (!r || !r.own) {
        r = { vao: gl.createVertexArray(), vbo: gl.createBuffer(), n: 0, own: true };
        gl.bindVertexArray(r.vao); gl.bindBuffer(gl.ARRAY_BUFFER, r.vbo);
        gl.enableVertexAttribArray(0); gl.vertexAttribIPointer(0, 4, gl.UNSIGNED_SHORT, 8, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, self.ibo.buf); gl.bindVertexArray(null);
        self.regions.set(rk, r);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, r.vbo); gl.bufferData(gl.ARRAY_BUFFER, all, gl.DYNAMIC_DRAW);
      r.n = len / 16; self.ibo.ensure(r.n);
    });
    this.dirtyRegions.clear();
  };
  RegionSet.prototype.quads = function () { var n = 0; this.regions.forEach(function (r) { n += r.n; }); return n; };
  RegionSet.prototype.draw = function () {
    var gl = this.gl;
    this.regions.forEach(function (r) { gl.bindVertexArray(r.vao); gl.drawElements(gl.TRIANGLES, r.n * 6, gl.UNSIGNED_INT, 0); });
    gl.bindVertexArray(null);
  };
  RegionSet.prototype.dispose = function () {
    var gl = this.gl;
    this.regions.forEach(function (r) { if (r.own) { gl.deleteBuffer(r.vbo); gl.deleteVertexArray(r.vao); } });
    this.regions.clear();
  };

  /** 共用的四邊形索引（0,1,2,0,2,3, 4,5,6,…）；不夠長就就地加長（同一個 buffer 物件 ⇒ 各 VAO 的綁定不用重設）。 */
  function QuadIndex(gl) { this.gl = gl; this.buf = gl.createBuffer(); this.cap = 0; this.ensure(1 << 16); }
  QuadIndex.prototype.ensure = function (n) {
    if (n <= this.cap) return;
    var cap = Math.max(n, this.cap * 2), a = new Uint32Array(cap * 6);
    for (var i = 0; i < cap; i++) { var b = i * 4, o = i * 6; a[o] = b; a[o + 1] = b + 1; a[o + 2] = b + 2; a[o + 3] = b; a[o + 4] = b + 2; a[o + 5] = b + 3; }
    var gl = this.gl; gl.bindVertexArray(null); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, a, gl.STATIC_DRAW);
    this.cap = cap;
  };

  root.VoxelKit = {
    CHUNK: CH, rgb332: rgb332, hashVoxel: hashVoxel,
    b64ToBytes: b64ToBytes, inflateRaw: inflateRaw, parse: parse, decode: decode, loadEmbedded: loadEmbedded,
    ship: ship, hasEmbedded: hasEmbedded, embeddedKey: embeddedKey, embeddedBytes: embeddedBytes,
    embeddedImage: embeddedImage, embeddedJSON: embeddedJSON,
    Grid: Grid, verify: verify, meshChunk: meshChunk, M4: M4, raycast: raycast, detached: detached,
    compile: compile, VOXEL_VS: VOXEL_VS, VOXEL_FS: VOXEL_FS, RegionSet: RegionSet, QuadIndex: QuadIndex,
    pack: function (x, y, z) { return x | (y << 11) | (z << 21); },   // 格座標壓成一個整數：x 11 位元（0–2047）、y、z 各 10 位元（kotoko 2026-10-15：以前 x 只有 10 位元 ⇒ 拿破崙號 jib-boom 到 x 1098，殉爆斷船時那一段找不到、留在空中）
  };
})(typeof window !== 'undefined' ? window : this);
