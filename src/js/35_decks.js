// ───────────────────────── 甲板（TASK-0572） ─────────────────────────
// 甲板照雕刻作品的 meta 判定（Tim 2026-10-14：不要直接測量甲板層高）：組裝件裡那條甲板關聯 meta kind=deck、deck=<代號>、level（由下往上）、name、
//   floor（舷弧 "x:z,x:z,…"：z ＝ 地板上第一層空氣，點之間線性內插，範圍外 ＝ 這一層在那裡沒有甲板）、thick（地板＋底下的樑幾格）。
//   walk（可選，同 floor 的寫法）：人走的那一層面不是地板的地方（槳帆船：甲板上排滿划手座，人走中央走道 coursier，比地板高 0.9 m）⇒ 走路格照它（42_hands.js navZ），
//     判層、停格、艙房照舊照 floor；walk 範圍外照 floor。沒寫 ⇒ 跟以前一模一樣（Tim 2026-10-18 皇家號「送藥手…一起修復」）。
//   造船規格 Sculpture_Shipbuilding.md §9.3；量一次寫進 meta：decks.py；同步進 .vxk：admin.py metasync。
// 結構（Tim）：甲板 → 房間 → 功能物品（床、砲）；甲板本身也是一個大房間（砲直接擺在甲板上）。房間照關聯路徑綁在甲板上（甲板-berth/艙房 ⇒ 甲板-berth）。
// 用到的地方：砲甲板的名字與分組（10_ship.js gunDecks）、預備水手走得到的層（42_hands.js navLevels／navBuild）、停格的「甲板（L）」（74_cutaway.js deckCut）、艙房屬於哪一層（36_rooms.js）。
// 沒有甲板 meta 的舊匯出 ⇒ hullDecks 回 []，各處照舊自己量（退路）。
/** 那一型的甲板（由下往上；記在船型上）：[{ path, id, level, name, floor: [[x, z], …], walk: [[x, z], …]｜null, thick, x0, x1, zmin, zmax }]。 */
function hullDecks(T) {
  if (T.decksM) return T.decksM;
  var out = [];
  (T.h.parts || []).forEach(function (p) {
    var m = p.meta; if (!m || m.kind !== 'deck' || typeof m.floor !== 'string') return;
    function pl(v) { return String(v).split(',').map(function (s) { var a = s.split(':'); return [+a[0], +a[1]]; }).filter(function (q) { return isFinite(q[0]) && isFinite(q[1]); }).sort(function (a, b) { return a[0] - b[0]; }); }
    var F = pl(m.floor), W = typeof m.walk === 'string' ? pl(m.walk) : [];
    if (!F.length) return;
    var zs = F.map(function (q) { return q[1]; });
    out.push({ path: p.path || '', id: m.deck || p.path, level: +m.level || 0, name: m.name || p.path, floor: F, walk: W.length ? W : null, thick: +m.thick || 4, x0: F[0][0], x1: F[F.length - 1][0], zmin: Math.min.apply(null, zs), zmax: Math.max.apply(null, zs) });
  });
  out.sort(function (a, b) { return a.level - b.level || a.zmin - b.zmin; });
  out.forEach(function (d, i) { d.i = i; });
  return T.decksM = out;
}
/** 那一層在 x 的地板高度（地板上第一層空氣）；那裡沒有這一層 ⇒ null。 */
function deckFloor(d, x) { return x < d.x0 - 0.5 || x > d.x1 + 0.5 ? null : polyZ(d.floor, x); }
function polyZ(F, x) {
  for (var i = 1; i < F.length; i++) if (x <= F[i][0]) { var a = F[i - 1], b = F[i], t = b[0] === a[0] ? 0 : (x - a[0]) / (b[0] - a[0]); return Math.round(a[1] + (b[1] - a[1]) * t); }
  return F[F.length - 1][1];
}
/** 走路格的高度（42_hands.js navZ）：有 walk、x 在 walk 範圍裡 ⇒ 照 walk；否則照 floor。 */
function deckWalk(d, x) { var W = d.walk; return W && x >= W[0][0] - 0.5 && x <= W[W.length - 1][0] + 0.5 ? polyZ(W, x) : deckFloor(d, x); }
/** (x, z) 站在哪一層：那一欄地板在 z 以下最近的那一層（離地板 −3～+20 格）；沒有 ⇒ null。 */
function deckAt(T, x, z) {
  var best = null, bd = 1e9;
  hullDecks(T).forEach(function (d) { var f = deckFloor(d, x); if (f === null) return; var dz = z - f; if (dz >= -3 && dz <= 20 && Math.abs(dz) < bd) { bd = Math.abs(dz); best = d; } });
  return best;
}
/** 關聯路徑（甲板-berth/艙房、甲板-gun/砲-S01…）屬於哪一層：路徑開頭是哪一層甲板的關聯路徑。 */
function deckOfPath(T, path) {
  var best = null;
  hullDecks(T).forEach(function (d) { if (path === d.path || path.indexOf(d.path + '/') === 0) best = d; });
  return best;
}
