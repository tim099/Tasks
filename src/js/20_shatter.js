// ───────────────────────── 拆格：砲彈打碎船殼 ─────────────────────────
var HARD = { 36: 3.5, 146: 3.5 };   // 鐵（砲身、錨、鑄鐵灰）比木頭難打穿
function removeVoxel(sh, x, y, z, seeds) {
  var c = sh.grid.set(x, y, z, 0);
  if (c <= 0) return 0;
  evEmit('cell', sh, x, y, z); sh.lost++;                               // 網格、平滑面附近的區重建（62_simview.js；只給人看）
  if (z < sh.T.sz) { sh.flood[z * 3]++; sh.flood[z * 3 + 1] += y > sh.T.cy ? 1 : -1; sh.flood[z * 3 + 2] += x > sh.T.cx ? 1 : -1; }
  if (sh.fl) floodTouch(sh, x, y, z);                                   // 粒子模式：水格與破口待重算（33_flood.js）
  if (NAV_RE > 0 && sh.nav) navDirty(sh, x, y, z);
  if (sh.rbin) sh.rbin.add(ropeBin(x, y, z));                             // 繩的檢查只看打掉的格附近（32_hull.js survey、10_ship.js ropeFloat）                       // 尋路動態更新：那幾層記成髒了（42_hands.js；TASK-0572）
  if (seeds) { var s = sh.seeds; s.push(VK.pack(x + 1, y, z), VK.pack(x - 1, y, z), VK.pack(x, y + 1, z), VK.pack(x, y - 1, z), VK.pack(x, y, z + 1), VK.pack(x, y, z - 1)); }
  return c;
}
/** 一塊被打碎：形狀不規則（順著船長方向的木紋拉長、邊緣參差）、外緣有幾條順紋裂開；碎屑往砲彈前進的方向噴。回：打掉幾格的「硬度和」。
 *  ab：打的是砲帶的裝甲（24_armor.js；c、dirL 已經換到它的格座標）⇒ 拆它的格（armRemove）、碎屑照它的矩陣噴；沒給 ＝ 船殼（跟以前一模一樣）。
 *  ⛔ 不叫 a：下面順紋裂開那一段 var a（角度）會蓋掉它（同一個函式作用域）。 */
function shatter(sh, c, dirL, R, velW, debrisCap, grainK, ab) {
  var g = ab ? ab.grid : sh.grid, cost = 0, n = 0, rI = Math.ceil(R * 1.6), cx = Math.floor(c[0]), cy = Math.floor(c[1]), cz = Math.floor(c[2]);
  var removed = [];
  for (var dz = -rI; dz <= rI; dz++) for (var dy = -rI; dy <= rI; dy++) for (var dx = -rI; dx <= rI; dx++) {
    var x = cx + dx, y = cy + dy, z = cz + dz, d = Math.sqrt(dx * dx * grainK + dy * dy + dz * dz);
    if (d > R * (0.6 + 0.62 * hash3(x, y, z))) continue;
    var col = ab ? armRemove(sh, ab, x, y, z) : removeVoxel(sh, x, y, z, true);
    if (col) { cost += (HARD[col] || 1) * matK(sh, x, y, z); n++; removed.push(x, y, z, col); }   // 每格的消耗 × 那一格的材質（05_material.js）
  }
  // 順紋裂開：外緣挑幾點，沿船長方向把同色的那一條撕掉
  for (var k = 0; k < 3 && n > 8; k++) {
    var a = rnd() * 6.2832, rx = cx + Math.round(Math.cos(a) * R * 1.25), rzz = cz + Math.round(Math.sin(a) * R * 0.9), ry = cy, base = 0;
    for (var dyy = 0; dyy < 5 && !base; dyy++) { ry = cy + [0, 1, -1, 2, -2][dyy]; base = g.get(rx, ry, rzz); }
    if (!base) continue;
    var dirx = Math.cos(a) < 0 ? -1 : 1, L = (rr(3, 11)) | 0;
    for (var t = 0; t < L; t++) { var xx = rx + dirx * t; if (g.get(xx, ry, rzz) !== base) break; var cc = ab ? armRemove(sh, ab, xx, ry, rzz) : removeVoxel(sh, xx, ry, rzz, true); if (cc) { removed.push(xx, ry, rzz, cc); cost += matK(sh, xx, ry, rzz); n++; } }
  }
  // 碎屑
  var keep = removed.length / 4, pr = Math.min(1, debrisCap / Math.max(1, keep)), sp = len(velW), vd = norm(velW), Mw = ab ? armM(ab) : sh.M;
  for (var j = 0; j < removed.length; j += 4) {
    if (rnd() > pr) continue;
    var w = M4.pt(Mw, removed[j] + 0.5, removed[j + 1] + 0.5, removed[j + 2] + 0.5);
    var v = add(add(mul(vd, sp * rr(0.03, 0.2)), [gauss() * 3.2, rr(0.5, 5), gauss() * 3.2]), sh.vel);
    spawnDebris(w, v, removed[j + 3], rr(0.05, 0.11), rr(6, 14));
  }
  spawnPlates(sh, removed, vd, sp, 18, 4, Mw);                         // 片狀的碎塊（12_effects.js；只抽碎木的亂數）
  sh.impulse = add(sh.impulse, mul(vd, n));
  return { cost: cost, n: n };
}

