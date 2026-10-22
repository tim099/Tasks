// ───────────────────────── 海戰核心 API（TASK-0709；格式見 src/CORE_API.md） ─────────────────────────
// 外殼（Blockside 的主選單、Blocksail 的海圖）跟核心講話只走這幾個：戰後狀態 coreOut、戰前狀態 CORE_PRE（開局套上）、中途加船 coreAdd。
// ⛔ 都不抽 rnd()：沒帶戰前狀態、沒加船 ⇒ 戰局逐位元組相同；帶了 ⇒ 只是開局的船殼、模型、帆繩、船員不一樣，亂數的順序不變。
var CORE_API = 1;                                 // 改了格式或語意就加一（外殼開局先比：CORE_API.md §1）
var CORE_PRE = corePreHash();                     // { blue: [船的狀態…], red: […] }：照每一方在場的順序對（spawnFleet）；null ⇒ 一般開局
var CORE_LOG = [];                                // 套用時對不上的（船型、指紋、編號）：一行一筆，coreOut().log 帶出去

function coreB64(u8) { var s = ''; for (var i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); }
function coreUnB64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
/** 網址的 #pre=<base64url(UTF-8 JSON)>：外部開戰（?start=1）、無頭對拍（?demo）帶戰前狀態用；沒有、壞了 ⇒ null（壞了記一行）。 */
function corePreHash() {
  var m = /[#&]pre=([^&]+)/.exec(location.hash || ''); if (!m) return null;
  try { var u = coreUnB64(m[1].replace(/-/g, '+').replace(/_/g, '/')); return JSON.parse(new TextDecoder().decode(u)); }
  catch (e) { console.error('#pre 讀不了', e); return null; }
}
var CORE_ROLE = Object.keys(ROLE).sort(function (a, b) { return ROLE[a] - ROLE[b]; });   // 職位編號 ⇒ 名字（存檔寫名字：編號改了照樣對得上）

/** 船殼跟原船的差：只看這艘自己寫過的塊（Grid.own；沒被打過的塊還指著船型那一份）。
 *  每格 [線性索引 x + sx·(y + sy·z) 跟前一格的差 u32 LE, 值 u8（0 ＝ 打掉）]，照線性索引排 ⇒ base64。 */
function coreHullDiff(G, B) {
  var L = [];
  for (var ci = 0; ci < G.tab.length; ci++) {
    if (!G.own[ci]) continue;
    var c = G.tab[ci], b = B.tab[ci], cx = ci % G.nx, cy = Math.floor(ci / G.nx) % G.ny, cz = Math.floor(ci / (G.nx * G.ny));
    for (var li = 0; li < 4096; li++) {
      var v = c ? c[li] : 0, o = b ? b[li] : 0; if (v === o) continue;
      L.push((cx * 16 + (li & 15)) + G.sx * ((cy * 16 + ((li >> 4) & 15)) + G.sy * (cz * 16 + (li >> 8))), v);
    }
  }
  var n = L.length / 2, idx = [], i; for (i = 0; i < n; i++) idx.push(i);
  idx.sort(function (a, b) { return L[a * 2] - L[b * 2]; });
  var u = new Uint8Array(n * 5), dv = new DataView(u.buffer), last = 0, gone = 0;
  idx.forEach(function (k, j) { var p = L[k * 2]; dv.setUint32(j * 5, p - last, true); u[j * 5 + 4] = L[k * 2 + 1]; last = p; if (!L[k * 2 + 1]) gone++; });
  return { n: n, gone: gone, d: coreB64(u) };
}
/** 每個職位：開局幾人（coreSpawned 記的）、現在站得住幾人（st 0）。游到敵艦的人在敵艦的名單上（43_swim.js swimXfer）。 */
function coreCrew(sh) {
  var R = {};
  CORE_ROLE.forEach(function (k) { var n0 = sh.coreN0 ? sh.coreN0[k] || 0 : 0; if (n0) R[k] = { n0: n0, able: 0 }; });
  sh.crew.forEach(function (c) { var k = CORE_ROLE[c.role]; var r = R[k] || (R[k] = { n0: 0, able: 0 }); if (c.st === 0) r.able++; });
  return R;
}
function coreRoleCount(sh) { var o = {}; sh.crew.forEach(function (c) { if (c.st === 0) { var k = CORE_ROLE[c.role]; o[k] = (o[k] || 0) + 1; } }); return o; }

/** 一艘船的戰後狀態（格式 CORE_API.md §2）。只讀：不抽亂數、不改戰局。 */
function coreShipOut(sh) {
  var T = sh.T, fate = sh.broken ? 'broken' : sh.sunk ? 'sunk' : sh.sinkingFinal ? 'sinking' : sh.struck ? 'struck' : 'afloat';
  var models = [], sails = [], ropes = [];
  sh.models.forEach(function (m, k) { if (!m.alive || m.hp !== m.hpMax) models.push({ k: k, id: (m.meta && m.meta.id) || '', kind: m.kind, hp: Math.max(0, +(+m.hp).toFixed(2)), alive: !!m.alive }); });
  sh.sails.forEach(function (s, k) { if (s.dead || s.hp !== s.hpMax) sails.push({ k: k, hp: Math.max(0, +(+s.hp).toFixed(2)), dead: !!s.dead }); });
  sh.ropes.forEach(function (r, k) { if (r.dead) ropes.push(k); });
  return {
    hull: T.key || T.id, sum: T.h.checksum,   // hull：艦隊裡那一項（換了裝 ＝ 船型@換裝表，38_fit.js）
    name: sh.name, team: sh.team, i: sh.i, fate: fate, why: sh.fate || '',
    at: { px: +sh.px.toFixed(2), pz: +sh.pz.toFixed(2), yaw: +sh.yaw.toFixed(4), spd: +sh.spd.toFixed(3) },
    cells: coreHullDiff(sh.grid, T.hullG),
    models: models, sails: sails, ropes: ropes,
    masts: { up: sh.mastsUp, n: sh.masts.length }, guns: { alive: sh.gunsAlive, n: sh.guns.length },
    crew: coreCrew(sh), cas: { dead: sh.dead, wounded: sh.wounded, lostTo: sh.lostTo || 0, gained: sh.gained || 0 },
    used: { fired: sh.fired, hits: sh.hits, cart: sh.cartN || 0, wood: sh.carp ? sh.carp.used || 0 : 0, magGone: sh.mags.filter(function (g) { return g.gone; }).map(function (g) { return g.name; }) }
  };
}
/** 整場的戰後狀態：外殼結算用（Blocksail 交給經營層；Blockside 自己用不到）。半截船（PIECES）不算船。 */
function coreOut() {
  return { api: CORE_API, seed: SEED, t: +SIMT.toFixed(2), over: !!OVER, down: { blue: teamDown('blue'), red: teamDown('red') }, ships: SHIPS.map(coreShipOut), log: CORE_LOG.slice() };
}
/** 上一場的戰後狀態 ⇒ 下一場的戰前狀態：還在海上的（沒沉、沒斷、沒在沉）照每一方原本的順序排；
 *  船員：開局的人數照舊、少掉的（陣亡、傷員、游走的）這一場不在船上 —— 哪些人回來（醫好、補員）是外殼的事，改 crew[職位].out 就好。 */
function corePreFrom(out) {
  var P = { blue: [], red: [] };
  out.ships.forEach(function (s) {
    if (s.fate === 'sunk' || s.fate === 'broken' || s.fate === 'sinking') return;
    var crew = {}; Object.keys(s.crew).forEach(function (k) { var r = s.crew[k]; if (r.n0 - r.able > 0) crew[k] = { out: r.n0 - r.able }; });
    P[s.team].push({ hull: s.hull, sum: s.sum, name: s.name, cells: s.cells, models: s.models, sails: s.sails, ropes: s.ropes, crew: crew });
  });
  return P;
}

/** 把戰前狀態套到剛開好的船上（makeShip 之後、stepShip／survey 之前）：船殼差、打壞的模型、帆、斷的繩、不在船上的船員。
 *  桅倒沒倒、砲還在不在、模型腳下沒了要掉、繩端沒了要斷 ⇒ 交給接著跑的 survey 照格子重推（32_hull.js），不存兩份。
 *  ⛔ 不抽亂數、不放特效（removeVoxel 不給 seeds：上一場斷開的那一團已經不在差裡了；帆不走 dropSail —— 它撒布片要抽亂數）。 */
function coreShipIn(sh, st) {
  var T = sh.T;
  if (!st) return false;
  if (st.hull !== (T.key || T.id)) { CORE_LOG.push(sh.team + '#' + sh.i + '：戰前狀態是 ' + st.hull + '，這艘是 ' + (T.key || T.id) + ' ⇒ 不套'); return false; }
  if (st.sum !== T.h.checksum) { CORE_LOG.push(sh.team + '#' + sh.i + ' ' + T.id + '：船型指紋 ' + st.sum + ' ≠ 現在的 ' + T.h.checksum + '（重新匯入過）⇒ 船殼差不套'); }
  else if (st.cells && st.cells.n) {
    var u = coreUnB64(st.cells.d), dv = new DataView(u.buffer), p = 0, B = T.hullG, G = sh.grid, sx = G.sx, sy = G.sy;
    for (var j = 0; j < st.cells.n; j++) {
      p += dv.getUint32(j * 5, true); var v = u[j * 5 + 4], x = p % sx, y = Math.floor(p / sx) % sy, z = Math.floor(p / (sx * sy));
      if (!v) removeVoxel(sh, x, y, z, false);
      else if (G.get(x, y, z)) { G.set(x, y, z, v); evEmit('cell', sh, x, y, z, true); }   // 換色（燒焦；true ⇒ 不是平滑格就不重建平滑面，62_simview.js）
      else restoreVoxel(sh, x, y, z, v);                                              // 原船沒有、上一場補上的（木匠）
    }
  }
  (st.models || []).forEach(function (q) {
    var m = sh.models[q.k]; if (!m || (q.id && m.meta && m.meta.id && q.id !== m.meta.id)) { CORE_LOG.push(T.id + ' 模型 #' + q.k + ' 對不上（' + q.id + '）'); return; }
    m.hp = q.hp; if (!q.alive) { m.alive = false; m.moved = true; }                    // 上一場飛掉的：這一場一開始就不在（不放碎片、不殉爆）
  });
  (st.sails || []).forEach(function (q) {
    var s = sh.sails[q.k]; if (!s) return; s.hp = q.hp;
    if (q.dead && !s.dead) { s.dead = true; sh.rigDirty = true; sailLinesDie(sh, s); if (sh.cl && sh.cl[s.k]) sh.cl[s.k].gone = true; }
  });
  (st.ropes || []).forEach(function (k) { var r = sh.ropes[k]; if (r && !r.dead) { r.dead = true; sh.rigDirty = true; } });
  var crew = st.crew || {};
  Object.keys(crew).forEach(function (k) {
    var n = crew[k].out | 0, r = ROLE[k]; if (!(n > 0) || r === undefined) return;
    for (var i = sh.crew.length - 1; i >= 0 && n > 0; i--) { var c = sh.crew[i]; if (c.role === r && c.st === 0) { c.st = 3; c.walk = null; c.preOut = true; n--; } }   // 從後面往前：先少的是編號後面的（砲班從最後一門砲）
    if (n > 0) CORE_LOG.push(T.id + ' ' + k + ' 要少 ' + crew[k].out + ' 人、只有那麼多可以少');
  });
  sh.coreIn = true;
  return true;
}
/** 開好一艘（spawnFleet、spawnReserve、coreAdd 都叫）：套戰前狀態、記開局每個職位幾人（coreCrew 的 n0）。 */
function coreSpawned(sh, st) {
  sh.coreN0 = {}; sh.crew.forEach(function (c) { var k = CORE_ROLE[c.role]; sh.coreN0[k] = (sh.coreN0[k] || 0) + 1; });   // 開局編了幾人（含戰前狀態標成不在船上的 ⇒ 下一場照樣算少）
  if (st) coreShipIn(sh, st);
}
function corePreFor(team, j) { return CORE_PRE && CORE_PRE[team] ? CORE_PRE[team][j] || null : null; }

/** 中途加一艘（不重開場景；Blocksail「遇到戰鬥前先切回真實航行，再無縫進入戰鬥」）：o ＝ { team, hull, x, z, yaw?, name?, pre? }。
 *  船型要先載好（loadHull）；yaw 沒給 ⇒ 船頭對著敵方還在打的船的中心。回那艘船（sh.addMs ＝ 這一步花了幾毫秒）。
 *  ⚠ makeShip 會抽亂數（相位、裝填、船員）⇒ 加船那一刻之後的戰局跟沒加的那一場不同 —— 同一個時刻加同一艘，照樣逐位元組重現。 */
function coreAdd(o) {
  var T = HULLT[o.hull]; if (!T || OVER) return null;
  var t0 = performance.now(), yaw = o.yaw;
  if (yaw === undefined) {
    var E = SHIPS.filter(function (s) { return s.team !== o.team && !isOut(s); }), ex = 0, ez = 0;
    E.forEach(function (s) { ex += s.px; ez += s.pz; });
    yaw = E.length ? Math.atan2(-(ez / E.length - o.z), ex / E.length - o.x) : (o.team === 'blue' ? -Math.PI / 2 : Math.PI / 2);
  }
  var sh = makeShip(SHIPS.length, o.team, yaw, o.z, T, o.x); sh.name = o.name || T.name;
  coreSpawned(sh, o.pre || null);
  SHIPS.push(sh); stepShip(sh, 0); survey(sh); pickCaptain(sh); cmdTick(); pickFoes();
  sh.addMs = +(performance.now() - t0).toFixed(1);
  note(sh, '進場' + teamTag(sh), true); crewShortNote(sh);
  return sh;
}
/** ?coreadd=red:monitor@60（無頭對拍用；多艘用逗號）：⇒ [{ team, hull, t }]。 */
function coreAddQ() {
  return (Q.get('coreadd') || '').split(',').filter(Boolean).map(function (s) { var m = /^(blue|red):([\w-]+)@([\d.]+)$/.exec(s); return m ? { team: m[1], hull: m[2], t: +m[3] } : null; }).filter(Boolean);
}
function coreHulls() { return coreAddQ().map(function (a) { return a.hull; }); }
