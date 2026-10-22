// ───────────────────────── 帆的配方（TASK-0602 ①；Tim 2026-10-17：「帆是否可以只存固定點&本身尺寸等關鍵資訊 其他在匯入遊戲時在解壓縮出來」
//   「如果計算量大的話 就跟船體一樣 緩存 只算一次 不過要更新緩存」「匯入時可以只包含配方（吹鼓直接用遊戲內的帆繩物理）」
//   「不用刻意接近雕刻引擎 我希望是維持之前遊戲內的帆繩物理」「都不要靠猜 帆跟繩的綁定必須靠 meta」） ─────────────────────────
// 成品裡的帆只有配方（senate export include=recipe ⇒ rig.sails[].recipe：corners 設計位置、names、refs 每個角原樣的參照、pin、bind、res、fullness、frame），
// 沒有雕刻引擎模擬完的頂點；繩帶 ends（include=ends：兩端原樣的參照，例 'sail:main-course/clew_s'、'model:前桅/yard-fore-course/earing-S'）。
// 載入船型時（05_hull.js buildHull 一開頭，比海面遮罩、縮圖、繩的檢查都早）照配方生出「跟以前 vxk 一樣排列」的帆 ⇒ 命中外框、帆靠哪幾格、畫，一行都不用改：
//   ① 切平布：同雕刻引擎 BuildParticles 的格網 —— 四邊形雙線性／三角形重心，(i, j) 照 j 列 i 行排；三角形的切法與繞序一樣（排列對上，匯出端的貼圖 uv 才對得上）。
//   ② 吹鼓：遊戲的帆繩物理那一套（30_rig_physics.js 的 solve、clothStep 的風壓公式與常數）吹 SAILR_SEC 秒 —— ⛔ 不去湊雕刻引擎的形狀：
//      綁住的點（角 pin、bind 的邊）釘在設計位置；ends 指名的帆腳釘在那條繩的端點（繩畫到哪、帆腳就在哪）；沒有繩指名的角讓它自己吹；
//      風 ＝ 從船尾偏右舷吹來（SAILR_WIND）× WIND_SAIL；不讀陣風、SIMT、不抽亂數 ⇒ 同一份配方永遠吹出同一個形狀。
//      開戰之後帆物理開著 ⇒ 照真的風再吹（跟以前一樣）；關著 ⇒ 停在這個形狀。
//   ③ 雙面：同匯出端 TwoSided —— 沿頂點法線 ±SAILR_HALF（正面 n 個、背面 n 個）、三角形照匯出寫的順序；有貼圖 ⇒ uv ＝ (i/res, j/res) 兩面各一份。
//   ④ 綁定照 meta（clothBindMeta，給 30_rig_physics.js clothTemplate 用）：角的 refs 指名模型（model:…）⇒ 綁那個模型；指名部件固定點、座標 ⇒ 綁那個位置上的格；
//      bind 的邊兩頭指名同一個模型 ⇒ 綁那個模型，不然綁那一點上的格；自由的帆腳 ⇒ 綁 ends 指名它的繩（帆腳跟哪根帆桁轉 ＝ 那條繩另一端指名的帆桁）。
//      ⛔ 不照「邊直不直」「3 格內的帆桁」「1 m 內的繩端」猜（那幾段只留給沒有配方的舊 .vxk）。
// 快取（06_cache.js）：生出來的那幾份跟船體同一筆，失效條件照舊（vxk 原文、程式、格式）。量過：憲法號 17 面現算約 0.5 秒 ⇒ 第二次載入照抄。
var SAILR_SEC = 4, SAILR_HC = 1 / 30, SAILR_IT = 4, SAILR_HALF = 0.05, SAILR_WIND = [4.5, -1.5, 0];
function rcpQual(frame, p) { return frame ? frame + '/' + p : p; }
/** 繩的 ends 裡指名帆角的那一端（sail:<帆>/<角>，照繩那一層補前綴）⇒ { '<帆>/<角>': [{ j: 繩, e: ends 的第幾個（0 ＝ pts 的頭、1 ＝ 尾） }] }。 */
function rcpRopeEnds(rig) {
  var M = {};
  (rig.ropes || []).forEach(function (r, j) { (r.ends || []).forEach(function (ref, e) { if (typeof ref !== 'string' || ref.indexOf('sail:') !== 0) return; var k = rcpQual(r.frame, ref.slice(5)); (M[k] = M[k] || []).push({ j: j, e: e }); }); });
  return M;
}
/** 參照 'model:<模型>/<固定點>'（照 frame 補前綴）⇒ 模型編號；不是模型或找不到 ⇒ -1。 */
function rcpModel(rig, frame, ref) {
  if (typeof ref !== 'string' || ref.indexOf('model:') !== 0) return -1;
  var p = rcpQual(frame, ref.slice(6)), i = p.lastIndexOf('/'); if (i < 0) return -1;
  var nm = p.slice(0, i), ms = rig.models || [];
  for (var m = 0; m < ms.length; m++) if (ms[m].name === nm) return m;
  return -1;
}
/** 一面帆的配方 ⇒ { verts, tris, uv, bmeta, cornerIdx }（verts／tris 照匯出端的雙面排列）。
 *  clew[k]：ends 指名角 k 的那條繩的端點（吹鼓時釘在那裡）；null ⇒ 沒有繩指名（綁住的角照設計位置釘、自由的讓它吹）。
 *  bmeta：每個點綁在哪（-1 不綁；k ＝ 角 k；100 + e ＝ bind 的第 e 條邊）—— 給 clothBindMeta。 */
function sailFromRecipe(R, clew) {
  var C = R.corners, nc = C.length, res = Math.max(1, R.res | 0), full = +R.fullness || 1, X = [], UV = [], id = {}, i, j, k;
  function key(a, b) { return a * 4096 + b; }
  function gl(a, b) { var v = id[key(a, b)]; return v === undefined ? -1 : v; }
  for (j = 0; j <= res; j++) for (i = 0; i <= res; i++) {
    if (nc === 3 && i + j > res) continue;
    var u = i / res, v = j / res, P = [0, 0, 0];
    for (k = 0; k < 3; k++) P[k] = nc === 4 ? (1 - u) * (1 - v) * C[0][k] + u * (1 - v) * C[1][k] + u * v * C[2][k] + (1 - u) * v * C[3][k]
      : C[0][k] + (C[1][k] - C[0][k]) * u + (C[2][k] - C[0][k]) * v;
    id[key(i, j)] = X.length / 3; X.push(P[0], P[1], P[2]); UV.push(u, v);
  }
  var n = X.length / 3, T = [];
  function tri(a, b, c) { if (a >= 0 && b >= 0 && c >= 0) T.push(a, b, c); }
  for (j = 0; j < res; j++) for (i = 0; i < res; i++) {
    if (nc === 4) { tri(gl(i, j), gl(i + 1, j), gl(i + 1, j + 1)); tri(gl(i, j), gl(i + 1, j + 1), gl(i, j + 1)); }
    else { if (i + j < res) tri(gl(i, j), gl(i + 1, j), gl(i, j + 1)); if (i + j < res - 1) tri(gl(i + 1, j), gl(i + 1, j + 1), gl(i, j + 1)); }
  }
  // 約束：結構＋剪切（k 1）、彎曲（隔一格，k 0.5，同 clothStep 的跨點那一組）；靜止長度 ＝ 設計距離 × fullness（作者寫的布比框多幾成）
  var ea = [], eb = [], er = [], ba = [], bb = [], br = [];
  function con(a, b, bend) {
    if (a < 0 || b < 0) return;
    var d = Math.hypot(X[a * 3] - X[b * 3], X[a * 3 + 1] - X[b * 3 + 1], X[a * 3 + 2] - X[b * 3 + 2]) * full;
    if (bend) { ba.push(a); bb.push(b); br.push(d); } else { ea.push(a); eb.push(b); er.push(d); }
  }
  for (j = 0; j <= res; j++) for (i = 0; i <= res; i++) {
    var a = gl(i, j); if (a < 0) continue;
    con(a, gl(i + 1, j)); con(a, gl(i, j + 1));
    if (nc === 4) { con(a, gl(i + 1, j + 1)); con(gl(i + 1, j), gl(i, j + 1)); } else con(gl(i + 1, j), gl(i, j + 1));
    con(a, gl(i + 2, j), 1); con(a, gl(i, j + 2), 1); if (nc === 3) con(gl(i + 2, j), gl(i, j + 2), 1);
  }
  // 綁在哪：角（作者標 pin、或接著 bind 的邊；同雕刻引擎 CornerPinned）、bind 的邊（整條）
  var cij = nc === 4 ? [[0, 0], [res, 0], [res, res], [0, res]] : [[0, 0], [res, 0], [0, res]], cornerIdx = cij.map(function (c) { return gl(c[0], c[1]); });
  var bmeta = new Int16Array(n).fill(-1), bind = R.bind || [], pins = R.pin || [];
  bind.forEach(function (e) {
    var a0 = cij[e], a1 = cij[(e + 1) % nc];
    for (var t = 0; t <= res; t++) { var q = gl(a0[0] + Math.trunc((a1[0] - a0[0]) * t / res), a0[1] + Math.trunc((a1[1] - a0[1]) * t / res)); if (q >= 0) bmeta[q] = 100 + e; }
  });
  for (k = 0; k < nc; k++) if (pins[k] || bind.indexOf(k) >= 0 || bind.indexOf((k + nc - 1) % nc) >= 0) bmeta[cornerIdx[k]] = k;
  // 吹鼓（風壓同 clothStep：每個三角形沿法線推 KW ×（相對風在法線上的分量）²，相對風扣掉布自己的速度；每點取平均）
  var p = Float32Array.from(X), pin = new Uint8Array(n);
  for (i = 0; i < n; i++) if (bmeta[i] >= 0) pin[i] = 1;
  cornerIdx.forEach(function (q, k2) {                                  // ends 指名的帆腳 ⇒ 釘在那條繩的端點（繩畫到哪、帆腳就在哪）
    if (pin[q] || !clew || !clew[k2]) return;
    pin[q] = 1; p[q * 3] = clew[k2][0]; p[q * 3 + 1] = clew[k2][1]; p[q * 3 + 2] = clew[k2][2];
  });
  var q0 = Float32Array.from(p), A = new Float32Array(n * 3), N = new Uint8Array(n), wl = norm(SAILR_WIND).map(function (x) { return x * WIND_SAIL / S; });
  var gz = -G / S, dt2 = SAILR_HC * SAILR_HC, inv = 1 / (3 * SAILR_HC), dmp = DAMP * DAMP, steps = Math.round(SAILR_SEC / SAILR_HC);
  var EA = Uint16Array.from(ea), EB = Uint16Array.from(eb), ER = Float32Array.from(er), BA = Uint16Array.from(ba), BB = Uint16Array.from(bb), BR = Float32Array.from(br);
  for (var s = 0; s < steps; s++) {
    A.fill(0); N.fill(0);
    for (j = 0; j < T.length; j += 3) {
      var ia = T[j] * 3, ib = T[j + 1] * 3, ic = T[j + 2] * 3;
      var ux = p[ib] - p[ia], uy = p[ib + 1] - p[ia + 1], uz = p[ib + 2] - p[ia + 2], vx = p[ic] - p[ia], vy = p[ic + 1] - p[ia + 1], vz = p[ic + 2] - p[ia + 2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.sqrt(nx * nx + ny * ny + nz * nz); if (l < 1e-9) continue;
      nx /= l; ny /= l; nz /= l;
      var rx = wl[0] - (p[ia] - q0[ia] + p[ib] - q0[ib] + p[ic] - q0[ic]) * inv, ry = wl[1] - (p[ia + 1] - q0[ia + 1] + p[ib + 1] - q0[ib + 1] + p[ic + 1] - q0[ic + 1]) * inv, rz = wl[2] - (p[ia + 2] - q0[ia + 2] + p[ib + 2] - q0[ib + 2] + p[ic + 2] - q0[ic + 2]) * inv;
      var dn = rx * nx + ry * ny + rz * nz, f = KW * dn * Math.abs(dn), fx = f * nx, fy = f * ny, fz = f * nz;
      A[ia] += fx; A[ia + 1] += fy; A[ia + 2] += fz; A[ib] += fx; A[ib + 1] += fy; A[ib + 2] += fz; A[ic] += fx; A[ic + 1] += fy; A[ic + 2] += fz;
      N[ia / 3]++; N[ib / 3]++; N[ic / 3]++;
    }
    for (i = 0; i < n; i++) {
      if (pin[i]) continue;
      var o = i * 3, kk = N[i] ? 1 / N[i] : 0;
      for (k = 0; k < 3; k++) { var cur = p[o + k], vel = (cur - q0[o + k]) * dmp; q0[o + k] = cur; p[o + k] = cur + vel + (A[o + k] * kk + (k === 2 ? gz : 0)) * dt2; }
    }
    for (var it = 0; it < SAILR_IT; it++) { solve(EA, EB, ER, null, p, pin, 1); if (it & 1) solve(BA, BB, BR, null, p, pin, 0.5); }
  }
  // 雙面（同匯出端 TwoSided）：頂點法線 ＝ 相鄰三角形的面積加權平均
  var Nr = new Float32Array(n * 3);
  for (j = 0; j < T.length; j += 3) {
    var a3 = T[j] * 3, b3 = T[j + 1] * 3, c3 = T[j + 2] * 3;
    var e1x = p[b3] - p[a3], e1y = p[b3 + 1] - p[a3 + 1], e1z = p[b3 + 2] - p[a3 + 2], e2x = p[c3] - p[a3], e2y = p[c3 + 1] - p[a3 + 1], e2z = p[c3 + 2] - p[a3 + 2];
    var cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
    Nr[a3] += cx; Nr[a3 + 1] += cy; Nr[a3 + 2] += cz; Nr[b3] += cx; Nr[b3 + 1] += cy; Nr[b3 + 2] += cz; Nr[c3] += cx; Nr[c3 + 1] += cy; Nr[c3 + 2] += cz;
  }
  var verts = new Array(n * 6);
  for (i = 0; i < n; i++) {
    var o2 = i * 3, L = Math.hypot(Nr[o2], Nr[o2 + 1], Nr[o2 + 2]), mx = L > 1e-12 ? Nr[o2] / L : 0, my = L > 1e-12 ? Nr[o2 + 1] / L : 0, mz = L > 1e-12 ? Nr[o2 + 2] / L : 1;
    verts[o2] = p[o2] + mx * SAILR_HALF; verts[o2 + 1] = p[o2 + 1] + my * SAILR_HALF; verts[o2 + 2] = p[o2 + 2] + mz * SAILR_HALF;
    verts[(n + i) * 3] = p[o2] - mx * SAILR_HALF; verts[(n + i) * 3 + 1] = p[o2 + 1] - my * SAILR_HALF; verts[(n + i) * 3 + 2] = p[o2 + 2] - mz * SAILR_HALF;
  }
  var tris = []; for (j = 0; j < T.length; j += 3) { var ta = T[j], tb = T[j + 1], tc = T[j + 2]; tris.push(tc, tb, ta, n + tb, n + tc, n + ta); }   // 匯出端：正面 (a,b,c) 寫成 (c,b,a)、背面 (n+a,n+c,n+b) 寫成 (n+b,n+c,n+a)
  return { verts: verts, tris: tris, uv: UV.concat(UV), bmeta: Array.from(bmeta), cornerIdx: cornerIdx };
}
/** 載入船型時：有配方的帆照配方生出來（C ＝ 快取的記錄：有就照抄，沒有就現算、留給 cachePut 存）。回：幾面。 */
function sailRecipes(T, C) { var R = sailRecipeInit(); (T.rig.sails || []).forEach(function (s, k) { sailRecipeAt(T, C, k, R); }); return sailRecipeEnd(T, R); }
/** sailRecipes 拆成一面一面（05_hull.js buildHull：每一面之間讓出一次 —— 沒有快取時一面要解約 35 ms，十幾面以前一口氣 0.57 s）。照順序做 ＝ sailRecipes。 */
function sailRecipeInit() { return { out: [], n: 0, M: null }; }
function sailRecipeAt(T, C, k, R) {
  var s = (T.rig.sails || [])[k];
  if (!s.recipe) { R.out.push(null); return; }
  var g = C && C.sails && C.sails[k] && C.sails[k].name === s.name ? C.sails[k] : null;
  if (!g) {
    var M = R.M = R.M || rcpRopeEnds(T.rig);
    var clew = (s.recipe.names || []).map(function (nm) {
      var L = M[s.name + '/' + nm]; if (!L) return null;
      var P = T.rig.ropes[L[0].j].pts, m = P.length; return L[0].e === 0 ? [P[0], P[1], P[2]] : [P[m - 3], P[m - 2], P[m - 1]];
    });
    g = sailFromRecipe(s.recipe, clew);
  }
  if (DEBUG && s.verts && !s.verts0) s.verts0 = s.verts;               // 讀數用（__game.sailDev）：成品還帶著雕刻引擎的頂點時（原格式、改之前的成品）留著比
  s.verts = g.verts; s.tris = g.tris; s.bmeta = g.bmeta; s.cornerIdx = g.cornerIdx;
  if (s.texture) s.texture.uv = g.uv;
  R.out.push({ name: s.name, verts: g.verts, tris: g.tris, uv: g.uv, bmeta: g.bmeta, cornerIdx: g.cornerIdx }); R.n++;
}
function sailRecipeEnd(T, R) {
  if (T.keep) T.keep.sails = R.n ? R.out : null;
  return R.n;
}
/** 布料模板的綁定照 meta（見檔頭 ④）：n ＝ 正面的點數、P(q) ＝ 那一點的位置。回 { hk, hv, clews, clewYard, tm }：
 *  hk：0 不綁、1 格、2 繩、3 找不到靠的（帆還在就綁著）、4 模型（同 clothTemplate）；tm：帆腳被哪條繩的哪一端拉著（給 tethOf，不照距離找）。 */
function clothBindMeta(H, s, n, P) {
  var R = s.recipe, rig = H.rig, nc = R.corners.length, hk = new Int8Array(n), hv = new Int32Array(n).fill(-1), clewYard = {}, tm = [], clews = 0, M = rcpRopeEnds(rig), mod = [], k;
  for (k = 0; k < nc; k++) mod.push(rcpModel(rig, R.frame, (R.refs || [])[k]));
  function cell(q) { var w = P(q), an = anchorNear(H, w[0], w[1], w[2], 6); if (an >= 0) { hk[q] = 1; hv[q] = an; } else hk[q] = 3; }   // 部件固定點、座標 ⇒ 那個位置上的格
  for (var q = 0; q < n; q++) {
    var b = s.bmeta[q]; if (b < 0) continue;
    if (b < 100) { if (mod[b] >= 0) { hk[q] = 4; hv[q] = mod[b]; } else cell(q); }
    else { var e = b - 100, ma = mod[e], mb = mod[(e + 1) % nc]; if (ma >= 0 && ma === mb) { hk[q] = 4; hv[q] = ma; } else cell(q); }
  }
  s.cornerIdx.forEach(function (q, k2) {
    if (hk[q]) return;
    var L = M[s.name + '/' + R.names[k2]]; if (!L) return;              // 沒有繩指名 ⇒ 自由的角（旗的飛邊）
    L.forEach(function (x, t) {
      var r = rig.ropes[x.j], m = r.pts.length / 3;
      if (!t) {
        hk[q] = 2; hv[q] = x.j; clews++;
        var y = rcpModel(rig, r.frame, (r.ends || [])[1 - x.e]); clewYard[q] = y >= 0 && rig.models[y].meta && rig.models[y].meta.kind === 'yard' ? y : -1;   // 帆腳跟哪根帆桁轉 ＝ 那條繩另一端指名的帆桁
      }
      tm.push({ i: q, j: x.j, ce: x.e === 0 ? 0 : m - 1 });
    });
  });
  return { hk: hk, hv: hv, clews: clews, clewYard: clewYard, tm: tm };
}
