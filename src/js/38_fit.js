// ───────────────────────── 可換零件：掛點＋換裝表（TASK-0713／0714；Tim 2026-10-18） ─────────────────────────
// Tim：「原本的砲變成類似砲位的標記」「零件替換後維持原本的序號（等於多一個 Slot 表示這門砲目前實際用什麼型號）」「其他物件也用類似的概念去設計」。
// 掛點 ＝ 作品裡原本雕的那一件（路徑、序號、id 都不變）；換裝表 ＝ { 掛點的 id: 換成哪一種 }（第一段只有砲：值 ＝ 砲種表 config guns 的鍵）。
//   沒換 ⇒ 一位元都不動（fitApply 不做事）⇒ 戰局跟以前逐位元相同。
//   換了 ⇒ 載入船型的時候（05_hull.js buildHull，拆裝飾之前）把那個掛點的模型換成零件：網格、固定點、外框、meta 的砲種照零件，擺在掛點的座標系上；
//     之後讀 rig.models 的（砲、砲班站位、家具擋格、重量 ⇒ 壓艙物、命中、繩）全部照新的走，不用知道有換裝這回事。
// 零件從哪來（零件表 config parts.guns ＝ { 砲種: { 砲架類別: '<船 id>#<模型 id>' } }，admin.py parts 照 _cache 產生）：
//   這艘船自己就有那一種、同一類的砲 ⇒ 用自己的（長得一樣）；沒有 ⇒ 照零件表載那一艘的船檔、拿那一門（同一艘只載一次）。
//   ⛔ 不把每一種砲的網格另存一份進成品：22 種壓起來 ~120 KB（成品 +6%）；船檔裡本來就有，照引用拿 ⇒ 成品只多零件表那幾行。
// 掛點的座標系（砲）：砲軸 ＝ 固定點 breech → muzzle（水平）；水平的對齊點 ＝ 砲口 muzzle（舷側砲：砲口對著砲門）、迴旋砲／旋轉砲座 ＝ pivot（兩邊都有才用）；
//   高度 ＝ 外框底（砲架放在甲板上）。左右舷的砲是鏡像（eye-aft 在砲軸的哪一邊）⇒ 零件跟掛點不同邊 ⇒ 照砲軸鏡射（三角形繞序跟著翻），不是轉 180°（⛔ 轉 ⇒ 船尾那條滑車繩接到船頭那一邊）。
// 類別：砲架 ＝ meta mount（沒寫 ＝ 舷側砲架 carriage；pivot ＝ 迴旋砲、turret ＝ 旋轉砲座）；只裝得下同一類。弩砲、投石機、弓、希臘火（砲種表 weapon）這一段不換（弦、弓這些繩是那艘船自己的）。
// 放不放得下：零件在砲的座標系裡的長、寬、高 ≤ 掛點的 ×(1 ＋ FIT_TOL) ＋ FIT_PAD 格；掛點 meta fits=<砲種,…> ⇒ 只收那幾種（不看大小）。
//   放不下、類別不合、零件表沒有 ⇒ 不換、照原本雕的那一門，原因記在 T.fit.bad（開戰時廣播、匯入檢查列出來）。
// 繩：兩端寫明 model:<掛點路徑>/<固定點> 的那一端，照同名固定點的位移挪過去（整條照離那一端的長度遞減：那一端移滿、另一端不動）；零件沒有那個固定點 ⇒ 那條繩拿掉（carronade 沒有 train ⇒ 沒有後拉滑車）。
// 換裝表從哪來（fitOf）：出廠 ships[].fit ⊕ 玩家的 SHIP_FIT[船型]（存檔、匯出入跟船員配置一起；69_prefs.js）；
//   艦隊裡寫 `<船型>@<掛點>=<砲種>;<掛點>=<砲種>`（網址 ?blue=constitution@gun-2=carr）⇒ 出廠 ⊕ 這一份（不看玩家存檔）⇒ 同一型兩艘可以換得不一樣：船型照「型＋換裝表」各建一份（HULLT 的鍵 ＝ 那一串）。
// 第二段（TASK-0713；本來就是模型的零件）：槳、舵、螺旋槳、舵輪、燈、提燈、小艇、絞盤、羅經櫃、舵輪架、格柵、裝飾 —— 掛點的種類 FIT_KINDS（照 meta kind；裝飾 ＝ 沒有 kind、標了 deco）。
//   值 ＝ 零件表那一件 '<船 id>#<模型 id>'（config parts.<kind> ＝ { 參照: 名字 }，admin.py parts 產生；同一種 kind 才收）；'*' ＝ 原本雕的；'' ＝ 拆空（燈、提燈、小艇、格柵、裝飾，或掛點 meta optional=1）。
//   座標系：ax 兩個固定點定方向（沒有 ⇒ 照作品的方向，不轉）；at 對齊點（兩邊都有 ⇒ 三軸對齊那一點；沒有 ⇒ 外框底面中心）；槳照 meta side 分左右舷（不同邊 ⇒ 鏡射）。
//   meta：零件的（種類的參數：槳手幾人、划幅、舵角上限、葉數、轉的參數…），掛點自己的留著（id、槳的 side／bank、fits、optional）；
//   meta 裡的座標（舵的 hinge_*、轉軸 spin_pivot_*）照零件一起挪，方向（axis_*、spin_axis_*）照一起轉。
//   ⛔ 不當掛點：帆桁（帆裝）、火藥桶（火藥庫的存量）、門與砲門蓋板（跟船殼開口綁死）、導纜器、齒輪、爐灶。
// 第四段（TASK-0793；Tim 2026-10-21「接上」）：已經是模型的錨（kind=anchor，17 艘）；錨的關聯（憲法號、餘燼號、三叉戟號：載入時 76_anchor.js anchorParts 才拆成模型 ⇒ 拆好再換，見 fitAncSwap）。
var FIT_PARTS = (CFG.parts && CFG.parts.guns) || {};
var FIT_KINDS = {
  oar: { ax: ['pivot', 'blade'], at: 'pivot', side: 'side', keep: ['side', 'bank'], name: '槳' },
  rudder: { at: 'stock-top', name: '舵' },
  propeller: { at: 'hub', name: '螺旋槳' },
  wheel: { ax: ['hub-aft', 'hub-fore'], at: 'hub-aft', name: '舵輪' },
  wheel_stand: { name: '舵輪架' },
  light: { at: 'bail', opt: 1, name: '燈' },
  lantern: { opt: 1, name: '提燈' },
  boat: { ax: ['ring-aft', 'ring-fwd'], opt: 1, name: '小艇' },
  capstan: { name: '絞盤' },
  binnacle: { name: '羅經櫃' },
  grating: { opt: 1, name: '格柵' },
  deco: { opt: 1, name: '裝飾' },
  engine: { at: 'core', zb: 1, vox: 1, cy: 1, keep: ['propeller'], name: '主機' },   // 第四段（TASK-0793）：自帶格子的模型（規格表 vox=hull；見 fitHullVox）。主機中心 core 水平對齊、外框底對齊（坐在同一層地板上）；meta propeller（推哪一個螺旋槳）留掛點的
  boiler: { zb: 1, vox: 1, cy: 1, keep: ['funnel'], name: '鍋爐' },   // 外框底面中心對齊（⛔ 照煙道口 uptake：前後兩組共用一個煙道口的船（蘇士奎哈納號）⇒ 換進後面那一格的跑到前面那一組身上）；cy：對齊點在中線哪一邊（離中線 3 格以上才算）跟掛點不同 ⇒ 照中線鏡射（一舷一座、另一舷鏡像的主機、鍋爐）   // 煙道口 uptake 水平對齊（接煙囪的那一點）、外框底對齊；meta funnel（通哪一根煙囪）留掛點的
  anchor: { ax: ['fluke-a', 'fluke-b'], at: 'ring', keep: ['hawse'], name: '錨' }   // 第四段（TASK-0793）：已經是模型的錨。錨環 ring 對齊（鐵鍊綁、掛在吊錨木上的那一點：10_ship.js 腳、76_anchor.js 鍊子從這裡出來）；兩爪 fluke-a→b 定方向；meta hawse（錨鏈孔，船殼的座標）留掛點的
};
var FIT_KEEP = ['id', 'kind', 'fits', 'optional'];                     // 掛點自己的 meta（換了照樣留）
var FIT_GEO_PT = ['hinge', 'spin_pivot'], FIT_GEO_VEC = ['axis', 'spin_axis'];   // meta 裡的座標（_x／_y／_z）：點、方向
var FIT_TOL = 0.15, FIT_PAD = 2;                                         // 放得下：長寬高 ≤ 掛點的 ×1.15 ＋ 2 格
var SHIP_FIT = {};                                                       // 玩家的換裝表：船型 ⇒ { 掛點 id: 砲種 }（跟出廠的不一樣的那幾格；值 ＝ 原本雕的那一種 ⇒ 換回原樣）
var FIT_SRC = {};                                                        // 零件來源：'<船 id>#<模型 id>' ⇒ Promise<零件|null>（同一門只載一次）
/** 艦隊裡的一項（船型、或 船型@換裝表）⇒ 船型 id。 */
function hullBase(key) { key = String(key); var i = key.indexOf('@'); return i < 0 ? key : key.slice(0, i); }
/** 'gun-2=carr;oar-3=dromon#oar-7;light-1=' ⇒ { 'gun-2': 'carr', … }（寫法不對的那一格不收）。
 *  砲種認不認得、能不能換 ⇒ 留給 fitApply 判、照實報（⛔ 在這裡就丟掉 ⇒ 寫錯一個字什麼都看不到）。 */
function fitParse(s) {
  var F = {};
  String(s || '').split(';').forEach(function (w) { var i = w.indexOf('='), k = w.slice(0, i), t = w.slice(i + 1); if (i > 0 && ID_RX.test(k) && FIT_VAL_RX.test(t)) F[k] = t; });
  return F;
}
var FIT_VAL_RX = /^(?:[a-z][a-z0-9_]*(?:#[a-z0-9_.\/-]+)?|\*|)$/;          // 砲種、'<船 id>#<模型 id>'、'*'（原本）、''（拆空）
/** 換裝表 ⇒ 一串（照掛點排；空的 ⇒ ''）。 */
function fitSpec(F) { return Object.keys(F || {}).sort().map(function (k) { return k + '=' + F[k]; }).join(';'); }
/** 這一項（船型或 船型@換裝表）實際用的換裝表：出廠 ⊕（玩家存檔｜寫在項目裡的那一份）。 */
function fitOf(key) {
  key = String(key); var id = hullBase(key), at = key.indexOf('@'), H = HULL_KNOWN.filter(function (h) { return h.id === id; })[0];
  return Object.assign({}, (H && H.fit) || {}, at < 0 ? SHIP_FIT[id] || {} : fitParse(key.slice(at + 1)));
}
/** 砲架類別。 */
function fitClass(m) { var v = m.meta && m.meta.mount; return v ? String(v) : 'carriage'; }
/** 一門砲的座標系：對齊點 a（水平）、底 z、砲軸角 th、哪一邊（eye-aft 等在砲軸的左／右：+1／−1，看不出來 ＝ 0）。 */
function fitFrame(m, piv) {
  var P = m.points || {}, mz = P.muzzle, br = P.breech;
  if (!mz || !br) return null;
  var th = Math.atan2(mz[1] - br[1], mz[0] - br[0]), a = piv && P.pivot ? P.pivot : mz, sd = 0;
  ['eye-aft', 'eye-fwd', 'train', 'cascabel'].some(function (k) {
    var q = P[k]; if (!q) return false;
    var c = Math.cos(th) * (q[1] - br[1]) - Math.sin(th) * (q[0] - br[0]);
    if (Math.abs(c) < 0.25) return false;
    sd = (k === 'eye-fwd' ? -1 : 1) * (c > 0 ? 1 : -1); return true;
  });
  return { a: a, z: m.bbox[2], th: th, sd: sd };
}
/** 網格沒有頂點（主機、鍋爐：成品裡網格拿掉了，admin.py vox_strip）⇒ 外框的 8 個角（相對 origin，跟頂點同一種寫法）；有 ⇒ 頂點。
 *  外框 ＝ vox 的外框 ＝ 網格的外框（20 艘量過逐格相同）、這兩種不轉（沒有 ax）⇒ 量出來的長寬高、擺好的外框跟照網格的一樣。 */
function fitVerts(m, mesh) {
  if (mesh.verts.length || !m.bbox) return mesh.verts;
  var b = m.bbox, o = m.origin, V = [];
  for (var k = 0; k < 8; k++) V.push(b[k & 1 ? 3 : 0] - o[0], b[k & 2 ? 4 : 1] - o[1], b[k & 4 ? 5 : 2] - o[2]);
  return V;
}
/** 砲的座標系裡的外框（長 ＝ 沿砲軸、寬、高）。 */
function fitDims(m, mesh, f) {
  var V = fitVerts(m, mesh), o = m.origin, c = Math.cos(f.th), s = Math.sin(f.th), x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (var i = 0; i < V.length; i += 3) {
    var dx = o[0] + V[i] - f.a[0], dy = o[1] + V[i + 1] - f.a[1], u = dx * c + dy * s, v = -dx * s + dy * c, z = o[2] + V[i + 2];
    if (u < x0) x0 = u; if (u > x1) x1 = u; if (v < y0) y0 = v; if (v > y1) y1 = v; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return [x1 - x0, y1 - y0, z1 - z0];
}
/** 零件（一門砲）⇒ 掛點的座標系：回一支 p ⇒ 新座標。 */
function fitXf(fp, fs, mir) {
  var cp = Math.cos(fp.th), sp = Math.sin(fp.th), cs = Math.cos(fs.th), ss = Math.sin(fs.th);
  return function (p) {
    var dx = p[0] - fp.a[0], dy = p[1] - fp.a[1], u = dx * cp + dy * sp, v = -dx * sp + dy * cp;
    if (mir) v = -v;
    return [fs.a[0] + u * cs - v * ss, fs.a[1] + u * ss + v * cs, fs.z + p[2] - fp.z];
  };
}
/** 這艘自己的那一種、同一類的砲（有 breech、muzzle 的第一門）⇒ 零件；沒有 ⇒ null。 */
function fitOwnPart(h, type, cls) {
  var M = h.rig.meshes, m = (h.rig.models || []).filter(function (q) { return q.meta && q.meta.kind === 'gun' && modelKind(q) === type && fitClass(q) === cls && q.points && q.points.muzzle && q.points.breech; })[0];
  return m ? { m: m, mesh: M[m.mesh], from: '這艘' } : null;
}
/** 零件表那一門（'<船 id>#<模型 id>'）⇒ Promise<零件|null>：載那艘的船檔、拿那一門（網格複製一份；換色的擺放照它的 mats）。 */
function fitLoadPart(ref) {
  if (FIT_SRC[ref]) return FIT_SRC[ref];
  var i = ref.indexOf('#'), sid = ref.slice(0, i), mid = ref.slice(i + 1), H = HULL_KNOWN.filter(function (h) { return h.id === sid; })[0];
  if (!H || !VK.hasEmbedded(H.el)) return (FIT_SRC[ref] = Promise.resolve(null));
  return (FIT_SRC[ref] = VK.loadEmbedded(H.el).then(meshPool).then(function (model) {
    var h = model.header, m = ((h.rig && h.rig.models) || []).filter(function (q) { return q.meta && String(q.meta.id) === mid; })[0];
    if (!m) return null;
    return fitCopyPart(m, h.rig.meshes[m.mesh], H.name, h.size[1] / 2);
  }).catch(function () { return null; }));
}
/** 一件零件抄一份（外框、固定點、meta 複製；網格照參照、換色的擺放照它的 mats）。 */
function fitCopyPart(m, me, from, cy) {
  return { m: { name: m.name, origin: m.origin.slice(), bbox: m.bbox.slice(), points: JSON.parse(JSON.stringify(m.points || {})), meta: Object.assign({}, m.meta), deco: isDeco(m), vox: m.vox || null }, mesh: { verts: me.verts, tris: me.tris, tmat: me.tmat, mats: m.mats || me.mats }, from: from, cy: cy };
}
/** 換裝表裡要從別艘拿的零件先載好（loadHull 在 buildHull 之前呼叫）⇒ Promise<{ '<砲種>|<類別>': 零件 }>。 */
function fitLoad(h, F, ship) {
  var need = {}, models = (h.rig && h.rig.models) || [], own = {};
  Object.keys(F).forEach(function (sid) {
    var m = models.filter(function (q) { return q.meta && String(q.meta.id) === sid; })[0] || fitAncRel(h, sid), t = F[sid];
    if (!m) return;
    if (t.indexOf('#') > 0) {                                             // 第二段：零件表的參照
      if (t.split('#')[0] === ship) { var q = models.filter(function (x) { return x.meta && String(x.meta.id) === t.slice(t.indexOf('#') + 1); })[0]; if (q) own[t] = fitCopyPart(q, h.rig.meshes[q.mesh], '這艘', h.size[1] / 2); }
      else need[t] = t;
      return;
    }
    if (fitKindOf(m) !== 'gun' || modelKind(m) === t) return;
    var cls = fitClass(m), k = t + '|' + cls;
    if (need[k] !== undefined || fitOwnPart(h, t, cls)) return;
    need[k] = (FIT_PARTS[t] || {})[cls] || '';
  });
  var keys = Object.keys(need), out = own;
  return Promise.all(keys.map(function (k) { return need[k] ? fitLoadPart(need[k]) : Promise.resolve(null); })).then(function (L) { keys.forEach(function (k, i) { if (L[i]) out[k] = L[i]; }); return out; });
}
/** 換裝（buildHull 一開頭，modelMats 之後、拆裝飾之前）：h 是這一份船型自己解出來的檔頭（改了不會影響別份）。
 *  回 { spec, done: [{ slot, path, from, to, src }], bad: [{ slot, path, to, why }], gone: [{ slot, path, kind }] }；F 是空的 ⇒ 不做事（一位元都不動）。 */
function fitApply(h, F, ext) {
  var R = { spec: fitSpec(F), done: [], bad: [], gone: [] };
  var keys = Object.keys(F || {}).sort(); if (!keys.length) return R;
  var rig = h.rig, models = rig.models || [], drop = {}, rm = [];
  keys.forEach(function (sid) {
    var t = F[sid], m = models.filter(function (q) { return q.meta && String(q.meta.id) === sid; })[0];
    function bad(why) { R.bad.push({ slot: sid, path: m ? m.name : '', to: t, why: why }); }
    if (!m) { var ar = fitAncRel(h, sid); if (ar) return fitAncNote(ar, sid, t, ext, R); }   // 錨的關聯（anchorParts 拆好模型才擺；fitAncSwap）
    if (!m) return bad('船上沒有這個掛點');
    if (t === '*') return;                                                // 原本雕的那一件（蓋掉出廠換裝表的那一格用）
    var k = fitKindOf(m);
    if (!k) return bad('這一件不是可以換的零件（' + (m.meta.kind ? 'kind=' + m.meta.kind : '沒有 kind') + '）');
    if (k === 'gun') return fitGun(h, m, sid, t, ext, R, drop, bad);
    var K = FIT_KINDS[k];
    if (t === '') {                                                       // 拆空（燈、小艇、格柵、裝飾；或掛點 meta optional=1）
      if (!(K.opt || +m.meta.optional)) return bad('這一種不能拆空');
      rm.push(m); fitRopesOff(rig, m, drop); R.gone.push({ slot: sid, path: m.name, kind: k }); return;
    }
    var P = fitRefPart(h, t, ext); if (!P) return bad('零件表沒有 ' + t);
    if (fitKindOf(P.m) !== k) return bad(t + ' 是 ' + (fitKindOf(P.m) || '別的') + '，掛點是 ' + k + '（只換同一種）');
    if (k === 'engine' && fitOrgan(m) !== fitOrgan(P.m)) return bad(fitOrgan(m) ? '管風琴（魔法動力源）不換成蒸汽主機' : t + ' 是管風琴（魔法動力源），不換進蒸汽主機的位置');
    var fits = m.meta.fits ? String(m.meta.fits).split(',').map(function (w) { return w.trim(); }) : null;
    var have = {}; Object.keys(m.points || {}).forEach(function (n) { if (P.m.points && P.m.points[n]) have[n] = 1; });
    var fs = fitFrameK(m, K, have), fp = fitFrameK(P.m, K, have);
    if (fits) { if (fits.indexOf(t) < 0) return bad('掛點 fits=' + m.meta.fits + ' 不收 ' + t); }
    else { var why = fitTooBig(fitDims(m, rig.meshes[m.mesh], fs), fitDims(P.m, P.mesh, fp)); if (why) return bad(why); }
    var sk = K.side, mir = !!(sk && m.meta[sk] && P.m.meta && P.m.meta[sk] && m.meta[sk] !== P.m.meta[sk]);
    if (K.cy) { var ys = fitSideY(fs.a[1] - h.size[1] / 2), yp = fitSideY(fp.a[1] - (P.cy === undefined ? h.size[1] / 2 : P.cy)); mir = ys !== 0 && yp !== 0 && ys !== yp; }
    if (K.vox) { if (!P.m.vox) return bad(t + ' 沒有自己的格子（rig.models[].vox；python -I admin.py metasync --id ' + t.split('#')[0] + '）'); if (!m.vox) return bad('掛點沒有自己的格子（換不掉：船殼裡那一塊不知道是哪幾格）'); }
    if (K.vox) { (R.vox0 = R.vox0 || {})[sid] = { vox: m.vox, meta: m.meta, points: m.points, bbox: m.bbox }; m.vox = fitVoxMove(P.m.vox, fitXf(fp, fs, mir), mir); }   // 格子跟著挪（只有平移：這兩種不轉）；原本的留著 ⇒ fitHullVox 放不進船殼時換回來
    fitPlace(rig, m, P, fitXf(fp, fs, mir), mir, drop);
    var mt = {}; Object.keys(P.m.meta || {}).forEach(function (q) { mt[q] = P.m.meta[q]; });
    FIT_KEEP.concat(K.keep || []).forEach(function (q) { delete mt[q]; if (m.meta[q] !== undefined) mt[q] = m.meta[q]; });
    fitMetaGeo(mt, fp, fs, mir);
    m.meta = mt;
    R.done.push({ slot: sid, path: m.name, from: k, to: t, src: P.from, mirror: mir });
  });
  if (rm.length) rig.models = rig.models.filter(function (q) { return rm.indexOf(q) < 0; });
  if (Object.keys(drop).length) { rig.ropes = rig.ropes.filter(function (r, i) { return !drop[i]; }); R.ropesDropped = Object.keys(drop).length; }
  return R;
}

/** 砲（第一段）：值 ＝ 砲種表的鍵。 */
function fitGun(h, m, sid, t, ext, R, drop, bad) {
  var rig = h.rig, t0 = modelKind(m); if (t0 === t) return;
  if (!GUNS[t] || GUNS[t].weapon) return bad(GUNS[t] ? '這一段只換火砲（' + GUNS[t].name + '不換）' : '砲種表沒有 ' + t);
  if (GUNS[t0] && GUNS[t0].weapon) return bad('掛點上是' + GUNS[t0].name + '（這一段只換火砲）');
  var cls = fitClass(m), P = fitOwnPart(h, t, cls) || (ext || {})[t + '|' + cls];
  if (!P) return bad('零件表沒有' + fitClsName(cls) + '的' + GUNS[t].name);
  var piv = cls !== 'carriage', fs = fitFrame(m, piv), fp = fitFrame(P.m, piv);
  if (!fs || !fp) return bad((fs ? '零件' : '掛點') + '沒有固定點 breech、muzzle（看不出砲軸）');
  var fits = m.meta.fits ? String(m.meta.fits).split(',').map(function (w) { return w.trim(); }) : null;
  if (fits) { if (fits.indexOf(t) < 0) return bad('掛點 fits=' + m.meta.fits + ' 不收' + GUNS[t].name); }
  else { var why = fitTooBig(fitDims(m, rig.meshes[m.mesh], fs), fitDims(P.m, P.mesh, fp)); if (why) return bad(why); }
  var mir = fs.sd !== 0 && fp.sd !== 0 && fs.sd !== fp.sd;
  (R.was = R.was || {})[m.name] = { kind: t0, bb: m.bbox.slice() };     // 原本雕的那一門（種類、外框）：甲板在哪、站人的高度是船的事，照原本的算（fitKind0／fitBB0）
  fitPlace(rig, m, P, fitXf(fp, fs, mir), mir, drop);
  var mt = Object.assign({}, m.meta); delete mt.gun; delete mt.weapon; delete mt.ammo;
  ['gun', 'weapon', 'ammo'].forEach(function (k2) { if (P.m.meta && P.m.meta[k2] !== undefined) mt[k2] = P.m.meta[k2]; });
  m.meta = mt;
  R.done.push({ slot: sid, path: m.name, from: t0, to: t, src: P.from, mirror: mir });
}
/** 長寬高（零件 dp、掛點 ds）⇒ 放不下的原因（放得下 ⇒ ''）。 */
function fitTooBig(ds, dp) {
  var nm = ['長', '寬', '高'];
  for (var j = 0; j < 3; j++) if (dp[j] > ds[j] * (1 + FIT_TOL) + FIT_PAD) return '放不下：' + nm[j] + ' ' + dp[j].toFixed(1) + ' 格 > 掛點的 ' + ds[j].toFixed(1) + ' 格（容許 ×' + (1 + FIT_TOL) + ' ＋' + FIT_PAD + '）';
  return '';
}
/** 把零件 P 照 X 擺到掛點 m：網格（新的一份，接在 rig.meshes 後面）、固定點、外框、起點；繩寫明綁在 m 某個固定點的那一端照同名固定點挪（零件沒有那一點 ⇒ 那條繩記進 drop）。 */
function fitPlace(rig, m, P, X, mir, drop) {
  var V = P.mesh.verts, o = P.m.origin, W = new Array(V.length), lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9], i, k, B = fitVerts(P.m, P.mesh);
  for (i = 0; i < B.length; i += 3) { var q = X([o[0] + B[i], o[1] + B[i + 1], o[2] + B[i + 2]]); for (k = 0; k < 3; k++) { if (V.length) W[i + k] = q[k]; if (q[k] < lo[k]) lo[k] = q[k]; if (q[k] > hi[k]) hi[k] = q[k]; } }   // 網格拿掉了的（主機、鍋爐）⇒ 外框照它的 8 個角、網格照舊是空的
  var og = [Math.floor(lo[0]), Math.floor(lo[1]), Math.floor(lo[2])];
  for (i = 0; i < W.length; i += 3) for (k = 0; k < 3; k++) W[i + k] -= og[k];
  var Tr = P.mesh.tris; if (mir) { Tr = Tr.slice(); for (i = 0; i < Tr.length; i += 3) { var a = Tr[i + 1]; Tr[i + 1] = Tr[i + 2]; Tr[i + 2] = a; } }   // 鏡射 ⇒ 繞序翻過來
  var pts = {}, old = m.points || {};
  Object.keys(P.m.points || {}).forEach(function (n) { pts[n] = X(P.m.points[n]); });
  var pre = 'model:' + m.name + '/';
  (rig.ropes || []).forEach(function (r, ri) {
    (r.ends || []).forEach(function (e, ei) {
      if (typeof e !== 'string' || e.indexOf(pre) !== 0) return;
      var pn = e.slice(pre.length), a0 = old[pn], a1 = pts[pn];
      if (!a0 || !a1) { drop[ri] = 1; return; }
      fitRopeMove(r, ei, [a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]]);
      (r.fitEnd = r.fitEnd || [false, false])[ei] = true;                   // 這一端跟著零件：開船時不找格當錨（10_ship.js），照作品寫的綁在零件上（⛔ 找格 ⇒ carronade 的砲尾貼著舷牆，兩端都被當成綁在船殼上）
    });
  });
  m.mesh = rig.meshes.length; rig.meshes.push({ verts: W, tris: Tr, tmat: P.mesh.tmat, mats: P.mesh.mats });
  m.origin = og; m.bbox = [lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]]; m.points = pts; delete m.mats;
}
/** 拆空：寫明綁在 m 上的繩（ends model:<m>/…）一起拿掉。 */
function fitRopesOff(rig, m, drop) {
  var pre = 'model:' + m.name + '/';
  (rig.ropes || []).forEach(function (r, ri) { if ((r.ends || []).some(function (e) { return typeof e === 'string' && e.indexOf(pre) === 0; })) drop[ri] = 1; });
}
/** meta 裡的座標（hinge_*、spin_pivot_*：點）與方向（axis_*、spin_axis_*）照零件一起挪、轉。 */
function fitMetaGeo(mt, fp, fs, mir) {
  var X = fitXf(fp, fs, mir);
  function v3(k) { var x = +mt[k + '_x'], y = +mt[k + '_y'], z = +mt[k + '_z']; return isFinite(x) && isFinite(y) && isFinite(z) && mt[k + '_x'] !== undefined ? [x, y, z] : null; }
  function put(k, p) { mt[k + '_x'] = +p[0].toFixed(4); mt[k + '_y'] = +p[1].toFixed(4); mt[k + '_z'] = +p[2].toFixed(4); }
  FIT_GEO_PT.forEach(function (k) { var p = v3(k); if (p) put(k, X(p)); });
  FIT_GEO_VEC.forEach(function (k) {
    var v = v3(k); if (!v) return;
    var cp = Math.cos(fp.th), sp = Math.sin(fp.th), u = v[0] * cp + v[1] * sp, w = -v[0] * sp + v[1] * cp; if (mir) w = -w;
    var cs = Math.cos(fs.th), ss = Math.sin(fs.th); put(k, [u * cs - w * ss, u * ss + w * cs, v[2]]);
  });
}
/** 主機是不是管風琴（魔法動力源，風暴角號；meta engine=organ）。 */
function fitOrgan(m) { return !!(m.meta && m.meta.engine === 'organ'); }
/** 換了主機 ⇒ 額外動力全速航速的倍率（31_sailing.js：cfg.base × 這個）：推力 ∝ 航速²、功率 ＝ 推力 × 航速 ∝ 航速³ ⇒ 倍率 ＝ ∛(換後每具主機 ihp 合計 ÷ 換前)。
 *  沒換主機、或有一具沒寫 ihp（比不了）⇒ 1（T.fit.powWhy 寫原因）。 */
function fitPowK(T) { return (T && T.fit && T.fit.powK) || 1; }
/** 對齊點在中線哪一邊（離中線 3 格以內 ＝ 0）。 */
function fitSideY(dy) { return Math.abs(dy) < 3 ? 0 : dy > 0 ? 1 : -1; }
/** 自帶格子的模型的格子（rig.models[].vox ＝ { o 外框最小角, s 大小, runs, c 顏色 }）照 X 擺（X 只有平移、或平移＋y 鏡射（mir）：這兩種不轉）：
 *  外框兩個角照 X 換過去取最小角；鏡射 ⇒ 每一格在外框裡 y 翻過來（顏色跟著那一格）。 */
function fitVoxMove(v, X, mir) {
  var a = X(v.o), b = X([v.o[0] + v.s[0], v.o[1] + v.s[1], v.o[2] + v.s[2]]), o = [0, 1, 2].map(function (k) { return Math.round(Math.min(a[k], b[k])); });
  if (!mir) return { o: o, s: v.s.slice(), runs: v.runs, c: v.c };
  var bin = atob(v.c), sx = v.s[0], sy = v.s[1], L = [], at = 0, n = 0, k, j;
  for (k = 0; k + 1 < v.runs.length; k += 2) { var s0 = at + v.runs[k], c = v.runs[k + 1]; for (j = 0; j < c; j++) { var i = s0 + j, z = Math.floor(i / (sx * sy)), r = i - z * sx * sy, y = Math.floor(r / sx), x = r - y * sx; L.push([x + sx * ((sy - 1 - y) + sy * z), bin.charCodeAt(n++)]); } at = s0 + c; }
  L.sort(function (p, q) { return p[0] - q[0]; });
  var R = [], cs = '', e = 0; k = 0;
  while (k < L.length) { j = k; while (j + 1 < L.length && L[j + 1][0] === L[j][0] + 1) j++; R.push(L[k][0] - e, j - k + 1); e = L[j][0] + 1; k = j + 1; }
  for (k = 0; k < L.length; k++) cs += String.fromCharCode(L[k][1]);
  return { o: o, s: v.s.slice(), runs: R, c: btoa(cs) };
}
// ── 自帶格子的模型放回船殼（TASK-0793；Tim 2026-10-21「主機、鍋爐要不要改成自帶格子的模型 ⇒ 改」） ──
// 主機、鍋爐（規格表 vox=hull）以前是關聯：格子跟船殼攤平成一份，換不掉。改成外部模型（作品裡 work sub=model，跟關聯同一份子作品、同一個位置），
//   admin.py 匯出時把來源作品的格子寫進 rig.models[].vox（同螺旋槳；鏡像照網格判）。
// 載入時（buildHull「格子」那一步，checksum 對完、材質之前）把它的格子放回船殼：
//   · 格子：照 vox 寫進 T.base（顏色照它；跟船殼重疊的格 ⇒ 換成它的，跟關聯攤平時後面那一條蓋前面一樣）；
//   · 材質、平滑：檔頭的材質層 h.materials 與 render 層照模型 meta material、render 把這幾格改掉（沒寫 ⇒ 全船預設、沒有 render），
//     材質名照字母排（跟 senate 匯出的一樣）⇒ 之後 05_material.js 照舊讀，鐵、鍋爐的硬度、重量、自動平滑都跟關聯一樣；
//   · 動力件：補一條關聯進 h.parts（路徑、meta、固定點照模型，cellRuns 照放進去的格）⇒ 31_drive.js 照舊數剩幾成、泡沒泡水；
//   · 模型本身從 rig.models 拿掉（網格不建）⇒ 不算模型的重量、不當模型被打飛。
// ⇒ 沒換裝的船，格子、材質、平滑、動力件跟改成模型之前的關聯一樣（admin.py 對拍：同一艘改之前的 .vxk）。
// 換裝（fitApply）：掛點的 vox 換成零件的（照對齊點平移）；放進去的格跟船殼重疊超過 FIT_VOX_OVL（不含原本那一件的格：那一塊已經空出來）⇒ 不換、照原本的（T.fit.bad）。
var FIT_VOX_OVL = 0.03;
var HULLV_KINDS = Object.keys(META_KINDS).filter(function (k) { return META_KINDS[k].vox === 'hull'; });
/** 檔頭的一層段落（材質 h.materials、render h.render：{ ids, runs: [跟上一段結尾差幾, 長度, 索引（1 起）] }）改掉幾格 ⇒ 新的一層（不動原本那一份）。
 *  E ＝ [線性編號, 名字（'' ＝ 拿掉）, …]（同一格後面的蓋前面的）。名字照字母排、索引 1 起；線性編號相連而且同一種的併成一段（跟 senate 匯出的一樣）。空的 ⇒ null。
 *  ⛔ 不整層展開成 Map（光榮號 56 萬格 ⇒ 400 ms）：舊的段落照順序走一遍、跟排好的改動合併。 */
function fitLayerEdit(Ly, E) {
  var old = Ly && Ly.ids && Ly.runs ? Ly : { ids: [], runs: [] }, nm = old.ids.slice(), ix = {}, i, k;
  nm.forEach(function (id, j) { ix[id] = j + 1; });
  var n = E.length / 2, ord = new Int32Array(n);
  for (i = 0; i < n; i++) { ord[i] = i; if (E[2 * i + 1] && !ix[E[2 * i + 1]]) { nm.push(E[2 * i + 1]); ix[E[2 * i + 1]] = nm.length; } }
  ord.sort(function (a, b) { return E[2 * a] - E[2 * b] || a - b; });
  var eL = [], eV = [];                                                    // 改動：照線性編號排好、同一格留最後那一筆
  for (k = 0; k < n; k++) { var q = ord[k], li = E[2 * q], v = E[2 * q + 1] ? ix[E[2 * q + 1]] : 0; if (eL.length && eL[eL.length - 1] === li) eV[eV.length - 1] = v; else { eL.push(li); eV.push(v); } }
  var srt = nm.slice().sort(), re = new Int32Array(nm.length + 1);       // 索引照字母重排
  nm.forEach(function (id, j) { re[j + 1] = srt.indexOf(id) + 1; });
  var R = [], end = -1, cur = 0, st = 0, at = 0, e = 0;
  function put(a, b, v) {                                                  // [a, b) 這幾格 ＝ v（照線性編號遞增送進來；接得上、同一種 ⇒ 併成一段）
    if (!v || b <= a) return;
    if (cur === v && end === a) { end = b; return; }
    if (cur) { R.push(st - at, end - st, cur); at = end; }
    cur = v; st = a; end = b;
  }
  var OR = old.runs, oat = 0;
  for (k = 0; k + 2 < OR.length; k += 3) {
    var s0 = oat + OR[k], s1 = s0 + OR[k + 1], v0 = re[OR[k + 2]], x = s0; oat = s1;
    while (e < eL.length && eL[e] < s0) { put(eL[e], eL[e] + 1, re[eV[e]]); e++; }
    while (e < eL.length && eL[e] < s1) { put(x, eL[e], v0); put(eL[e], eL[e] + 1, re[eV[e]]); x = eL[e] + 1; e++; }
    put(x, s1, v0);
  }
  while (e < eL.length) { put(eL[e], eL[e] + 1, re[eV[e]]); e++; }
  if (cur) R.push(st - at, end - st, cur);
  if (!R.length) return null;
  var used = {}; for (k = 2; k < R.length; k += 3) used[R[k]] = 1;
  var ids = srt.filter(function (_, j) { return used[j + 1]; }), sq = {}; srt.forEach(function (id, j) { sq[j + 1] = ids.indexOf(id) + 1; });
  for (k = 2; k < R.length; k += 3) R[k] = sq[R[k]];
  return { ids: ids, runs: R };
}
/** 一件的 vox ⇒ [線性編號, 顏色, …]（在船的格子外的不收）。 */
function fitVoxCells(v, size) {
  var bin = atob(v.c), out = [], at = 0, n = 0, sx = v.s[0], sy = v.s[1];
  for (var k = 0; k + 1 < v.runs.length; k += 2) {
    var s0 = at + v.runs[k], c = v.runs[k + 1];
    for (var j = 0; j < c; j++) {
      var i = s0 + j, z = Math.floor(i / (sx * sy)), r = i - z * sx * sy, y = Math.floor(r / sx), x = r - y * sx;
      x += v.o[0]; y += v.o[1]; z += v.o[2];
      var col = bin.charCodeAt(n++);
      if (x >= 0 && y >= 0 && z >= 0 && x < size[0] && y < size[1] && z < size[2]) out.push(x + size[0] * (y + size[1] * z), col);
    }
    at = s0 + c;
  }
  return out;
}
/** 放回船殼（buildHull 「格子」那一步，VK.verify 之後、hullMaterials 之前）。T.hullVox ＝ [{ path, kind, n 格, ovl 跟船殼重疊幾格 }]。 */
function fitHullVox(T) {
  var h = T.h, rig = T.rig, L = (rig.models || []).filter(function (m) { return m.meta && HULLV_KINDS.indexOf(m.meta.kind) >= 0 && m.vox; });
  T.hullVox = []; if (!L.length) return;
  var G = T.base, sz = h.size, sxy = sz[0] * sz[1], MA = [], RE = [], V0 = T.fit && T.fit.vox0 || {};
  function xyz(li) { var z = Math.floor(li / sxy), r = li - z * sxy, y = Math.floor(r / sz[0]); return [r - y * sz[0], y, z]; }
  var C = L.map(function (m) { return fitVoxCells(m.vox, sz); });
  L.forEach(function (m, k) {                                             // 換了裝的：先看放不放得進去（重疊太多 ⇒ 換回原本的）：船殼 ＋ 別的主機、鍋爐（照它們現在的格；換回去的照換回去之後的）
    var sid = String(m.meta.id), o = V0[sid]; if (!o) return;
    var own = new Set(); fitVoxCells(o.vox, sz).forEach(function (v, i) { if (!(i & 1)) own.add(v); });
    var oth = new Set(); C.forEach(function (A2, k2) { if (k2 !== k) for (var j = 0; j < A2.length; j += 2) oth.add(A2[j]); });
    var A = C[k], ov = 0; for (var i = 0; i < A.length; i += 2) { var p = xyz(A[i]); if (oth.has(A[i]) || G.get(p[0], p[1], p[2]) && !own.has(A[i])) ov++; }
    if (ov <= FIT_VOX_OVL * A.length / 2) return;
    var d = T.fit.done.filter(function (q) { return q.slot === sid; })[0];
    T.fit.done = T.fit.done.filter(function (q) { return q !== d; });
    T.fit.bad.push({ slot: sid, path: m.name, to: d ? d.to : '', why: '放不進船殼：' + ov + '／' + A.length / 2 + ' 格跟船殼重疊（容許 ' + Math.round(FIT_VOX_OVL * 100) + '%）' });
    m.vox = o.vox; m.meta = o.meta; m.points = o.points; m.bbox = o.bbox; C[k] = fitVoxCells(o.vox, sz);
  });
  var parts = h.parts = h.parts || [], skip = T.meshSkip = T.meshSkip || {}, used = {};
  L.forEach(function (m, k) {
    var A = C[k], mat = m.meta.material ? String(m.meta.material) : '', rd = m.meta.render ? String(m.meta.render) : '', idx = [], ov = 0, lo = [1e9, 1e9, 1e9], hi = [-1, -1, -1];
    for (var i = 0; i < A.length; i += 2) {
      var li = A[i], p = xyz(li);
      if (G.get(p[0], p[1], p[2])) ov++;
      G.set(p[0], p[1], p[2], A[i + 1] || 1);
      MA.push(li, mat); RE.push(li, rd);
      idx.push(li); for (var a = 0; a < 3; a++) { if (p[a] < lo[a]) lo[a] = p[a]; if (p[a] > hi[a]) hi[a] = p[a]; }
    }
    idx.sort(function (a, b) { return a - b; });
    var runs = [], at = 0, j0 = 0;
    while (j0 < idx.length) { var j1 = j0; while (j1 + 1 < idx.length && idx[j1 + 1] === idx[j1] + 1) j1++; runs.push(idx[j0] - at, j1 - j0 + 1); at = idx[j1] + 1; j0 = j1 + 1; }
    var q = { path: m.name, src: m.name, box: idx.length ? lo.concat(hi) : [0, 0, 0, 0, 0, 0], meta: m.meta, points: m.points || {}, cellRuns: runs, hullVox: true };
    parts.push(q);
    if (T.ids && m.meta.id && T.ids.by[String(m.meta.id)] && T.ids.by[String(m.meta.id)].q === m) T.ids.by[String(m.meta.id)] = { what: 'link', q: q, path: m.name };
    T.hullVox.push({ path: m.name, kind: m.meta.kind, n: idx.length, ovl: ov });
  });
  rig.models = rig.models.filter(function (m) { return L.indexOf(m) < 0; });
  T.hullVoxM = L;                                                         // 放回船殼的模型（配置頁的掛點照它列：72_fitui.js fitSlots）
  var E = L.filter(function (m) { return m.meta.kind === 'engine'; }), sw = E.some(function (m) { return V0[String(m.meta.id)]; });
  if (sw && T.fit) {
    var a0 = 0, a1 = 0, miss = [];
    E.forEach(function (m) { var o = V0[String(m.meta.id)], i1 = +m.meta.ihp, i0 = o ? +o.meta.ihp : i1; if (!(i0 > 0 && i1 > 0)) miss.push(m.name); a0 += i0; a1 += i1; });
    if (miss.length) T.fit.powWhy = '主機的馬力比不了（' + miss.join('、') + ' 沒寫 ihp）⇒ 航速照原本';
    else { T.fit.powK = Math.cbrt(a1 / a0); T.fit.pow = [a0, a1]; }
  }
  rig.models.forEach(function (m) { used[m.mesh] = 1; }); (T.decos || []).forEach(function (m) { used[m.mesh] = 1; });
  L.forEach(function (m) { if (!used[m.mesh]) skip[m.mesh] = 1; });     // 網格不建（同裝飾拆掉之後沒人用的）
  h.materials = fitLayerEdit(h.materials, MA); h.render = fitLayerEdit(h.render, RE);
}
// ── 錨的關聯當掛點（TASK-0793；Tim 2026-10-21「713 & 793 全包」） ──
// 憲法號、餘燼號（basecamp）、三叉戟號（gura）的錨是關聯：格子跟船殼攤平成一份，載入時 76_anchor.js anchorParts 才把那幾格從船殼（T.hullG）拿掉、外露的面做成一份模型。
//   ⇒ 換裝表那一格的 id 是錨的關聯（檔頭 parts，meta kind=anchor、有 cells）：fitApply 先記下來（T.fit.anc[路徑]），
//      anchorParts 拆好那一份模型之後（fitAncSwap）照模型錨同一套座標系（ring 對齊、fluke-a→b 定方向）換成零件表那一件。
//   船殼那幾格照樣拿掉（原本的錨不在了）；T.base 照舊整艘（浮力、站位不變，同沒換的時候）；模型的重量照種類（05_hull.js modelT）⇒ 換了也一樣。
//   ⛔ 不收進零件表：拆出來的那一份只有開局才有（檔頭沒有網格）⇒ 別艘換不到它。
/** 錨的關聯（檔頭 parts：meta kind=anchor、id ＝ sid、有 cells）；沒有 ⇒ null。 */
function fitAncRel(h, sid) {
  return (h.parts || []).filter(function (p) { return p.meta && p.meta.kind === 'anchor' && String(p.meta.id) === sid && p.cells; })[0] || null;
}
/** fitApply：錨的關聯那一格先看值對不對、零件有沒有載到，記進 R.anc（擺放等 anchorParts 拆好模型）。 */
function fitAncNote(p, sid, t, ext, R) {
  function bad(why) { R.bad.push({ slot: sid, path: p.path, to: t, why: why }); }
  if (t === '*') return;
  if (t === '') return bad('這一種不能拆空');
  var P = fitRefPart(null, t, ext); if (!P) return bad('零件表沒有 ' + t);
  if (fitKindOf(P.m) !== 'anchor') return bad(t + ' 是 ' + (fitKindOf(P.m) || '別的') + '，掛點是 anchor（只換同一種）');
  (R.anc = R.anc || {})[p.path] = { slot: sid, to: t, P: P };
}
/** anchorParts 拆好錨的關聯那一份模型 m 之後：換裝表有這一格 ⇒ 照第二段同一套擺上零件（放不下 ⇒ 照原本拆出來的那一份，T.fit.bad）。 */
function fitAncSwap(T, m) {
  var A = T.fit && T.fit.anc && T.fit.anc[m.name]; if (!A) return;
  var K = FIT_KINDS.anchor, P = A.P, rig = T.rig, drop = {}, have = {};
  function bad(why) { T.fit.bad.push({ slot: A.slot, path: m.name, to: A.to, why: why }); }
  Object.keys(m.points || {}).forEach(function (n) { if (P.m.points && P.m.points[n]) have[n] = 1; });
  var fs = fitFrameK(m, K, have), fp = fitFrameK(P.m, K, have);
  if (m.meta.fits) { if (String(m.meta.fits).split(',').map(function (w) { return w.trim(); }).indexOf(A.to) < 0) return bad('掛點 fits=' + m.meta.fits + ' 不收 ' + A.to); }
  else { var why = fitTooBig(fitDims(m, rig.meshes[m.mesh], fs), fitDims(P.m, P.mesh, fp)); if (why) return bad(why); }
  fitPlace(rig, m, P, fitXf(fp, fs, false), false, drop);
  var mt = {}; Object.keys(P.m.meta || {}).forEach(function (q) { mt[q] = P.m.meta[q]; });
  FIT_KEEP.concat(K.keep || []).forEach(function (q) { delete mt[q]; if (m.meta[q] !== undefined) mt[q] = m.meta[q]; });
  fitMetaGeo(mt, fp, fs, false);
  m.meta = mt;
  T.fit.done.push({ slot: A.slot, path: m.name, from: 'anchor', to: A.to, src: P.from, mirror: false });
  var nd = Object.keys(drop).length;
  if (nd) { rig.ropes = rig.ropes.filter(function (r, i) { return !drop[i]; }); T.fit.ropesDropped = (T.fit.ropesDropped || 0) + nd; }
}
/** 零件表那一件（'<船 id>#<模型 id>'）⇒ fitLoad 先載好的（ext[ref]）。 */
function fitRefPart(h, ref, ext) { return (ext || {})[ref] || null; }
/** 掛點是哪一種（砲 ＝ 'gun'；FIT_KINDS 的鍵；不能換 ⇒ ''）。零件抄來的那一份 m.deco 已經算好。 */
function fitKindOf(m) {
  var k = m.meta && m.meta.kind;
  if (k === 'gun') return 'gun';
  if (k) return FIT_KINDS[k] && k !== 'deco' ? k : '';
  return (m.deco !== undefined ? m.deco : isDeco(m)) ? 'deco' : '';
}
/** 一件的座標系（砲以外）：have ＝ 掛點與零件都有的固定點（兩邊照同一套）。 */
function fitFrameK(m, K, have) {
  var P = m.points || {}, b = m.bbox, th = 0;
  if (K.ax && have[K.ax[0]] && have[K.ax[1]]) { var p0 = P[K.ax[0]], p1 = P[K.ax[1]]; th = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]); }
  if (K.at && have[K.at]) return { a: P[K.at], z: K.zb ? b[2] : P[K.at][2], th: th, sd: 0 };
  return { a: [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2], z: b[2], th: th, sd: 0 };
}
function fitClsName(c) { return c === 'carriage' ? '舷側砲架' : c === 'pivot' ? '迴旋砲架' : c === 'turret' ? '旋轉砲座' : c; }
/** 照砲的種類、外框猜甲板的地方（10_ship.js gunDecks 切層、站人的高度；40_crew.js 砲班站的高度、spar deck 的高度）：換了裝的掛點照原本雕的那一門
 *  （⛔ 照新的 ⇒ 砲甲板上換成一門 carronade，陸戰隊就照它的高度去找 spar deck、站到砲甲板上；高度底是對齊的，差在「carronade 那層甲板離砲架底多遠」這種照種類的猜法）。
 *  m ＝ sh.models 的一件（makeShip 照 T.fit.was 掛 m.was）；沒換 ＝ 自己。 */
function fitKind0(m) { return m.was ? m.was.kind : m.kind; }
function fitBB0(m) { return m.was ? m.was.bb : m.bb; }
/** 繩的一端（ei：0 ＝ 起點、1 ＝ 終點）挪 d：整條照離那一端的長度遞減（那一端移滿、另一端不動）。 */
function fitRopeMove(r, ei, d) {
  var p = r.pts, n = p.length / 3; if (n < 2) return;
  var acc = [0], L = 0, i;
  for (i = 1; i < n; i++) { L += Math.hypot(p[i * 3] - p[i * 3 - 3], p[i * 3 + 1] - p[i * 3 - 2], p[i * 3 + 2] - p[i * 3 - 1]); acc.push(L); }
  var q = p.slice();
  for (i = 0; i < n; i++) { var w = L > 0 ? (ei === 0 ? 1 - acc[i] / L : acc[i] / L) : 1; q[i * 3] += d[0] * w; q[i * 3 + 1] += d[1] * w; q[i * 3 + 2] += d[2] * w; }
  r.pts = q;
}
/** 換裝的廣播（開戰時每一份船型一次；61_hud.js hudCrewShort 旁邊）：沒換成的那幾門。 */
function fitText(T) {
  var B = T.fit && T.fit.bad; if (!B || !B.length) return '';
  return '換裝沒換成（' + T.name + '）：' + B.map(function (b) { return b.slot + '→' + fitValName(b.to) + '（' + b.why + '）'; }).join('、');
}
/** 換裝表的一個值給人看的名字。 */
function fitValName(v) {
  if (v === '') return '拆掉';
  if (v === '*') return '原本的';
  if (GUNS[v]) return GUNS[v].name;
  var k = Object.keys(FIT_KINDS).filter(function (q) { return CFG.parts && CFG.parts[q] && CFG.parts[q][v]; })[0];
  return k ? CFG.parts[k][v] : v;
}
/** 存檔／匯出：玩家的換裝表（每一型跟出廠不一樣的那幾格）。 */
function fitSnap() { var o = {}; Object.keys(SHIP_FIT).forEach(function (id) { var d = SHIP_FIT[id]; if (d && Object.keys(d).length) o[id] = Object.assign({}, d); }); return o; }
/** 存檔／匯入 ⇒ SHIP_FIT（看得懂的那幾格才收；網址艦隊寫了換裝的那幾艘不看它）。換了 ⇒ fitDirty。 */
function fitApplyPrefs(p) {
  if (!p || typeof p !== 'object') return;
  Object.keys(p).forEach(function (id) {
    var d = p[id]; if (!HULL_KNOWN.some(function (h) { return h.id === id; }) || !d || typeof d !== 'object') return;
    var F = fitParse(Object.keys(d).map(function (k) { return k + '=' + d[k]; }).join(';')), was = fitSpec(fitOf(id));
    if (Object.keys(F).length) SHIP_FIT[id] = F; else delete SHIP_FIT[id];
    if (fitSpec(fitOf(id)) !== was) fitDirty(id);
  });
}
/** 那一型的換裝表換了（匯入、之後的配置頁）：已經載好的那一份船型丟掉、照新的重載（⛔ 不丟 ⇒ 開戰還是舊的砲）；
 *  壓艙物還是那一份的預設（沒自己調過）⇒ 一起清掉，新的船型載好再照它的預設（04_state.js shipCfg）。開頁時讀存檔那一次還沒載任何船 ⇒ 不做事。 */
function fitDirty(id) {
  if (!HULLS[id]) return;
  var T0 = HULLT[id], c = SHIP_CFG[id];
  delete HULLS[id]; delete HULLT[id];
  if (c && T0 && c.ballast === T0.ballast0) delete c.ballast;
  loadHull(id).then(function () { evEmit('hullReload', id); });          // 重載好了 ⇒ 船隻配置頁重畫（71_input.js：卡片的排水量、砲數、船員）
}
