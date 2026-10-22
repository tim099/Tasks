// Injected with Page.addScriptToEvaluateOnNewDocument BEFORE any page script runs (harness.py prepends `window.__HCFG = {...};`).
// 1) determinism: seeded Math.random, virtual clock (performance.now / Date.now), requestAnimationFrame never fires
//    (the harness drives every frame through __game.tick / __game.mask).
// 2) WebGL2 instrumentation on WebGL2RenderingContext.prototype: rare "creation" hooks are always on (labels for programs,
//    framebuffers, VAOs); the per-call counting wrappers are only swapped in for a counted frame (H.count) and swapped
//    back to the native methods afterwards, so timing frames run on the untouched prototype.
// 3) page-side driver helpers (H.ticks, H.cam, H.shot, H.count, H.timeTicks, H.timeRenders).
(function () {
  'use strict';
  if (window.__H) return;
  var CFG = window.__HCFG || {};
  var H = window.__H = { cfg: CFG, raf: 0 };

  // ───────── determinism ─────────
  var rs = (CFG.rseed >>> 0) || 0x2545F491;
  Math.random = function () {                       // mulberry32
    rs = (rs + 0x6D2B79F5) | 0; var t = Math.imul(rs ^ (rs >>> 15), 1 | rs);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  H.rsGet = function () { return rs; };              // cullsweep: replay the same random sequence for the culled and the unculled render
  H.rsSet = function (v) { rs = v | 0; };
  var perf = window.performance, realNow = perf.now.bind(perf), realDateNow = Date.now;
  H.realNow = realNow;
  // clock modes: 'real' (untouched), 'step' (every read advances by clk.inc ms: lets time-sliced loading make progress
  // deterministically), 'frozen' (only the harness advances it, by one 60 Hz frame before each tick; every budget loop
  // inside a frame sees zero elapsed time ⇒ runs to completion ⇒ identical work every run).
  H.clk = { mode: CFG.clock === 'real' ? 'real' : 'step', t: 100000, inc: 0.25, step: 1000 / 60 };
  if (CFG.clock !== 'real') {
    perf.now = function () { var c = H.clk; if (c.mode === 'step') c.t += c.inc; return c.mode === 'real' ? realNow() : c.t; };
    Date.now = function () { var c = H.clk; return c.mode === 'real' ? realDateNow() : 1.7e12 + Math.floor(c.t); };
  }
  if (CFG.noRaf !== false) {
    window.requestAnimationFrame = function () { H.raf++; return H.raf; };
    window.cancelAnimationFrame = function () {};
  }

  // ───────── WebGL instrumentation ─────────
  var GL2 = window.WebGL2RenderingContext; if (!GL2) return;
  var proto = GL2.prototype, G = {}, W = {};
  Object.getOwnPropertyNames(proto).forEach(function (k) {
    var d = Object.getOwnPropertyDescriptor(proto, k);
    if (d && typeof d.value === 'function' && k !== 'constructor') G[k] = d.value;
  });
  H.G = G;
  var PAGE = location.href.split('?')[0].split('#')[0];
  function frames() {
    var lim = Error.stackTraceLimit; Error.stackTraceLimit = 60; var s = new Error().stack || ''; Error.stackTraceLimit = lim;
    var L = s.split('\n'), out = [];
    for (var i = 1; i < L.length; i++) {
      var ln = L[i], m = /^\s*at (?:(.+?) \()?(\S+?):(\d+):(\d+)\)?$/.exec(ln);
      if (m && m[2].split('?')[0].split('#')[0] === PAGE) out.push({ fn: (m[1] || '').replace(/^(?:Object\.|new |async )/, ''), line: +m[3], col: +m[4] });
      else if (m) continue;                                   // injected script frames (this file)
      else { var n = /^\s*at (.+?)(?: \(.*\))?$/.exec(ln); out.push({ fn: n ? n[1] : ln.trim(), nat: 1 }); }
    }
    return out;
  }
  function fnv(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }

  var progId = new WeakMap(), fbId = new WeakMap(), vaoId = new WeakMap(), bufId = new WeakMap();
  H.progs = []; H.fbs = []; H.vaos = 0; H.bufs = 0;
  var C = null;                                            // counters of the frame being counted (null ⇒ not counting)
  function inc(o, k, n) { o[k] = (o[k] || 0) + (n === undefined ? 1 : n); }

  // creation hooks (always installed; rare calls)
  W.linkProgram = function (p) {
    try {
      var sh = G.getAttachedShaders.call(this, p) || [], vs = '', fs = '';
      for (var i = 0; i < sh.length; i++) { var t = G.getShaderParameter.call(this, sh[i], 0x8B4F /*SHADER_TYPE*/), src = G.getShaderSource.call(this, sh[i]) || ''; if (t === 0x8B31) vs = src; else fs = src; }
      var F = frames(), k = 0;
      for (var j = 0; j < F.length; j++) if (/(^|\.)compile$/.test(F[j].fn)) { k = j + 1; break; }
      var id = H.progs.length;
      H.progs.push({ id: id, hash: fnv(vs + '\u0000' + fs), vsHash: fnv(vs), fsHash: fnv(fs), vsLen: vs.length, fsLen: fs.length,
        site: F[k] || null, chain: F.slice(k, k + 6).map(function (f) { return f.fn; }), vsMain: (vs.split('void main')[1] || '').slice(0, 120) });
      progId.set(p, id);
    } catch (e) { H.hookErr = String(e); }
    return G.linkProgram.apply(this, arguments);
  };
  W.createFramebuffer = function () {
    var f = G.createFramebuffer.apply(this, arguments);
    try { var id = H.fbs.length; H.fbs.push({ id: id, frames: frames().slice(0, 6), layer: null, att: [] }); fbId.set(f, id); } catch (e) { H.hookErr = String(e); }
    return f;
  };
  function curFb(gl, target) { return G.getParameter.call(gl, target === 0x8CA8 ? 0x8CAA : 0x8CA6); }
  W.framebufferTextureLayer = function (target, att, tex, level, layer) {
    try { var f = curFb(this, target), id = f ? fbId.get(f) : undefined; if (id !== undefined) { H.fbs[id].layer = layer; H.fbs[id].att.push(['layer', att, layer]); } } catch (e) { }
    return G.framebufferTextureLayer.apply(this, arguments);
  };
  W.framebufferTexture2D = function (target, att) {
    try { var f = curFb(this, target), id = f ? fbId.get(f) : undefined; if (id !== undefined) H.fbs[id].att.push(['tex2d', att]); } catch (e) { }
    return G.framebufferTexture2D.apply(this, arguments);
  };
  W.framebufferRenderbuffer = function (target, att) {
    try { var f = curFb(this, target), id = f ? fbId.get(f) : undefined; if (id !== undefined) H.fbs[id].att.push(['rb', att]); } catch (e) { }
    return G.framebufferRenderbuffer.apply(this, arguments);
  };
  W.createVertexArray = function () { var v = G.createVertexArray.apply(this, arguments); if (v) vaoId.set(v, ++H.vaos); return v; };
  W.createBuffer = function () { var b = G.createBuffer.apply(this, arguments); if (b) bufId.set(b, ++H.bufs); return b; };
  var ALWAYS = Object.keys(W);

  // per-call specials while counting
  function bytesOf(d, off, len) {
    if (typeof d === 'number') return d;
    if (!d) return 0;
    var bpe = d.BYTES_PER_ELEMENT || 1;
    if (len) return len * bpe;
    return (d.byteLength || 0) - (off || 0) * bpe;
  }
  function stackKey() {
    var F = frames(), names = [], leaf = null;
    for (var i = 0; i < F.length; i++) {
      var f = F[i]; if (f.nat) continue;
      if (!leaf) leaf = f;
      if (f.fn) { names.push(f.fn); if (f.fn === 'render') break; }
      if (names.length >= 7) break;
    }
    return { path: names.reverse().join('>'), leaf: leaf ? leaf.line + ':' + leaf.col : '?' };
  }
  function onDraw(gl, name, a) {
    var el = name.indexOf('Elements') >= 0, inst = name.indexOf('Instanced') >= 0;
    var count = name === 'drawRangeElements' ? a[3] : el ? a[1] : a[2];
    var n = inst ? (el ? a[4] : a[3]) : 1;
    var prog = G.getParameter.call(gl, 0x8B8D), fb = G.getParameter.call(gl, 0x8CA6), vp = G.getParameter.call(gl, 0x0BA2), vao = G.getParameter.call(gl, 0x85B5);
    var pid = prog ? (progId.has(prog) ? progId.get(prog) : 'x') : 'none';
    var fk = (fb ? 'fb' + (fbId.has(fb) ? fbId.get(fb) : 'x') : 'canvas') + '@' + vp[2] + 'x' + vp[3];
    var vk = vao ? (vaoId.has(vao) ? vaoId.get(vao) : 'x') : 0;
    var D = C.draws; D.total++; D.verts += count * n;
    if (inst) { D.instCalls++; D.instances += n; }
    inc(D.byFn, name); inc(D.byProg, pid); inc(D.byFb, fk); inc(D.byProgFb, pid + '|' + fk);
    inc(D.mesh, pid + '|' + fk + '|' + vk + '|' + count + '|' + a[0]);   // same program+target+VAO+count ⇒ instancing candidate
    inc(D.vertsByProg, pid, count * n);
    if (C.stack) { var s = stackKey(); inc(D.byPath, s.path); inc(D.byLeaf, s.path + '|' + s.leaf); inc(D.byPathFb, s.path + '|' + fk); inc(D.byPathVerts, s.path, count * n); }
  }
  var SPECIAL = {
    drawArrays: function (gl, a) { onDraw(gl, 'drawArrays', a); },
    drawElements: function (gl, a) { onDraw(gl, 'drawElements', a); },
    drawArraysInstanced: function (gl, a) { onDraw(gl, 'drawArraysInstanced', a); },
    drawElementsInstanced: function (gl, a) { onDraw(gl, 'drawElementsInstanced', a); },
    drawRangeElements: function (gl, a) { onDraw(gl, 'drawRangeElements', a); },
    bufferData: function (gl, a) { C.bytes.bufferData += bytesOf(a[1], a[3], a[4]); },
    bufferSubData: function (gl, a) { C.bytes.bufferSubData += bytesOf(a[2], a[3], a[4]); },
    useProgram: function (gl, a) { var p = a[0]; inc(C.useProg, p ? (progId.has(p) ? progId.get(p) : 'x') : 'null'); },
    bindFramebuffer: function (gl, a) { inc(C.bindFb, a[1] ? 'fb' + (fbId.has(a[1]) ? fbId.get(a[1]) : 'x') : 'canvas'); }
  };
  function uniSpecial(gl) { var p = G.getParameter.call(gl, 0x8B8D); inc(C.uniByProg, p ? (progId.has(p) ? progId.get(p) : 'x') : 'none'); }
  var CW = {};                                               // counting wrappers
  Object.keys(G).forEach(function (k) {
    var f = W[k] || G[k], sp = SPECIAL[k], uni = /^uniform/.test(k) && k !== 'uniformBlockBinding';
    CW[k] = function () {
      if (C) { inc(C.calls, k); if (sp) sp(this, arguments); else if (uni) uniSpecial(this); }
      return f.apply(this, arguments);
    };
  });
  ALWAYS.forEach(function (k) { proto[k] = CW[k]; });     // creation hooks: always (they also count when C is set)
  function glOn() { Object.keys(CW).forEach(function (k) { proto[k] = CW[k]; }); }
  function glOff() { Object.keys(G).forEach(function (k) { proto[k] = ALWAYS.indexOf(k) >= 0 ? CW[k] : G[k]; }); }
  function newC(stack) {
    return { stack: stack, calls: {}, useProg: {}, bindFb: {}, uniByProg: {}, bytes: { bufferData: 0, bufferSubData: 0 },
      draws: { total: 0, verts: 0, instCalls: 0, instances: 0, byFn: {}, byProg: {}, byFb: {}, byProgFb: {}, mesh: {}, byPath: {}, byLeaf: {}, byPathFb: {}, byPathVerts: {}, vertsByProg: {} } };
  }
  /** Count every GL call made while fn runs. stack ⇒ also attribute draws to JS call paths (slow; counting frames only). */
  H.count = function (fn, stack) {
    var r; C = newC(stack !== false); glOn();
    try { r = fn(); } finally { glOff(); }
    var out = C; C = null; out.ret = r; return out;
  };

  // ───────── draw suppression (screenshot renders only; --skip-programs) ─────────
  // While on, every draw* call whose CURRENT_PROGRAM id is in H.skipIds is dropped (the rest of the GL stream is untouched).
  // Used to prove "everything except <these programs> is bit-exact" when one program is allowed to change pixels.
  var DRAWS = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements'];
  H.skipIds = null; H.skipped = 0; H.skipSeen = 0;
  H.skipOn = function (ids) {
    var S = {}; (ids || []).forEach(function (i) { S[i] = 1; }); H.skipIds = S; H.skipped = 0; H.skipSeen = 0;
    DRAWS.forEach(function (k) {
      var g = G[k]; if (!g) return;
      proto[k] = function () {
        H.skipSeen++;
        var p = G.getParameter.call(this, 0x8B8D), id = p && progId.has(p) ? progId.get(p) : -1;
        if (S[id]) { H.skipped++; return; }
        return g.apply(this, arguments);
      };
    });
    return { ids: ids, n: DRAWS.length };
  };
  H.skipOff = function () { DRAWS.forEach(function (k) { if (G[k]) proto[k] = G[k]; }); H.skipIds = null; return { skipped: H.skipped, seen: H.skipSeen }; };

  // ───────── cloth / rope physics-state hash ─────────
  // Raw bits of every physics array (float32/float64/int arrays word by word) plus the scalar state, per category.
  // Fields are an explicit whitelist of SIMULATION state (30_rig_physics.js, 34_shreds.js, 49_burn.js, 76_anchor.js, 22_pieces.js);
  // view-only fields the renderer keeps on owners (ow.sb, tDraw, tKey, vlamps …) are deliberately not read.
  var F64 = new Float64Array(1), U32F = new Uint32Array(F64.buffer);
  function Hs() { this.a = 2166136261 | 0; this.b = 0x3c6ef372 | 0; this.n = 0; }
  Hs.prototype.w = function (x) {
    x = x | 0;
    this.a = Math.imul(this.a ^ x, 16777619);
    var k = Math.imul(x, 0xcc9e2d51); k = (k << 15) | (k >>> 17); k = Math.imul(k, 0x1b873593);
    var b = this.b ^ k; b = (b << 13) | (b >>> 19); this.b = (Math.imul(b, 5) + 0xe6546b64) | 0;
    this.n++;
  };
  Hs.prototype.num = function (v) {
    if (v === undefined) return this.w(0x7fdead01);
    if (v === null) return this.w(0x7fdead02);
    if (typeof v === 'boolean') return this.w(v ? 0x7fdead11 : 0x7fdead10);
    if (typeof v === 'string') { this.w(0x7fdead20 ^ v.length); for (var i = 0; i < v.length; i++) this.w(v.charCodeAt(i)); return; }
    if (typeof v !== 'number') return this.w(0x7fdead03);
    F64[0] = v; this.w(U32F[0]); this.w(U32F[1]);
  };
  Hs.prototype.arr = function (a) {
    if (a === undefined || a === null) return this.num(a);
    if (ArrayBuffer.isView(a)) {
      this.w(0x7fdea000 ^ a.length); this.w(a.BYTES_PER_ELEMENT || 1);
      var i;
      if (a.byteOffset % 4 === 0 && a.byteLength % 4 === 0) { var u = new Uint32Array(a.buffer, a.byteOffset, a.byteLength >> 2); for (i = 0; i < u.length; i++) this.w(u[i]); }
      else { var b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (i = 0; i < b.length; i++) this.w(b[i]); }
      return;
    }
    if (Array.isArray(a)) { this.w(0x7fdeb000 ^ a.length); for (var j = 0; j < a.length; j++) { var x = a[j]; if (x && typeof x === 'object') this.arr(x); else this.num(x); } return; }
    if (typeof a === 'object') { var ks = Object.keys(a).sort(); this.w(0x7fdec000 ^ ks.length); for (var q = 0; q < ks.length; q++) { this.num(ks[q]); var y = a[ks[q]]; if (y && typeof y === 'object') this.arr(y); else this.num(y); } return; }
    this.num(a);
  };
  Hs.prototype.hex = function () { return ('00000000' + (this.a >>> 0).toString(16)).slice(-8) + ('00000000' + (this.b >>> 0).toString(16)).slice(-8); };
  function fields(h, o, arrs, nums) {
    if (!o) { h.num(null); return; }
    for (var i = 0; i < arrs.length; i++) h.arr(o[arrs[i]]);
    for (var j = 0; j < nums.length; j++) h.num(o[nums[j]]);
  }
  var CL_A = ['p', 'q', 'pin', 'brk', 'bbrk', 'tv', 'fz', 'fzY', 'fzR', 'ccAcc'];
  var CL_N = ['hidden', 'gone', 'loose', 'torn', 'late', 'furlF', 'npin', 'free', 'ev', 'moved', 'seen', 'contactWarm'];
  var SH_A = ['p', 'q', 'pin', 'brk', 'bbrk', 'tv', 'rest'];
  var SH_N = ['n', 'torn', 'loose', 'age', 'wet', 'free', 'kw', 'ti'];
  var LO_A = ['p', 'q', 'pin', 'rest', 'hk', 'hv', 'fy', 'fr'];
  var LO_N = ['n', 'free'];
  H.physHash = function () {
    var g = window.__game; if (!g) return null;
    var cat = { sails: new Hs(), burn: new Hs(), shreds: new Hs(), loose: new Hs(), ropes: new Hs(), rig: new Hs(), chains: new Hs(), pieces: new Hs() };
    var cnt = { ships: 0, cloth: 0, live: 0, torn: 0, tornTris: 0, loose: 0, gone: 0, hidden: 0, furling: 0, burnSails: 0, burnPts: 0, shreds: 0, looseRopes: 0, deadRopes: 0, chains: 0, pieces: 0, pieceCl: 0, fly: 0 };
    var SH = g.ships() || [];
    SH.forEach(function (sh) {
      cnt.ships++;
      var cl = sh.cl || [], sails = sh.sails || [];
      cat.sails.w(0x51000000 ^ cl.length);
      cl.forEach(function (c, k) {
        fields(cat.sails, c, CL_A, CL_N); if (!c) return;
        cnt.cloth++;
        if (c.p && !c.hidden && !c.gone) cnt.live++;
        if (c.torn) { cnt.torn++; if (c.tv) for (var i = 0; i < c.tv.length; i++) if (c.tv[i]) cnt.tornTris++; }
        if (c.loose) cnt.loose++; if (c.gone) cnt.gone++; if (c.hidden) cnt.hidden++;
        if (c.furlF !== null && c.furlF !== undefined) cnt.furling++;
      });
      sails.forEach(function (s) {
        cat.burn.num(!!s.dead); cat.burn.num(!!s.furled);
        var F = s.burn; if (!F) { cat.burn.num(null); return; }
        cnt.burnSails++; cat.burn.arr(F.a); cat.burn.arr(F.x); cat.burn.num(F.hf); cat.burn.num(F.lit); cat.burn.num(F.t1);
        if (F.a) for (var i = 0; i < F.a.length; i++) if (F.a[i] < 1e8) cnt.burnPts++;
      });
      var S2 = sh.shreds || []; cat.shreds.w(0x52000000 ^ S2.length); cnt.shreds += S2.length;
      S2.forEach(function (f) { fields(cat.shreds, f, SH_A, SH_N); });
      var L = sh.loose || []; cat.loose.w(0x53000000 ^ L.length); cnt.looseRopes += L.length;
      L.forEach(function (o) { fields(cat.loose, o, LO_A, LO_N); });
      var R = sh.ropes || []; cat.ropes.w(0x54000000 ^ R.length);
      R.forEach(function (r) { cat.ropes.arr(r.pts); cat.ropes.num(!!r.dead); cat.ropes.num(!!r.lz); cat.ropes.num(!!r.moved); if (r.dead) cnt.deadRopes++; });
      (sh.yards || []).forEach(function (m) { cat.rig.num(m.rot); });
      (sh.models || []).forEach(function (m) { if (m && m.hang) { cat.rig.num(m.sw); cat.rig.num(m.swA); cat.rig.num(m.psi); cat.rig.num(m.psiV); cat.rig.num(m.pw); } });
      var A = sh.anc;
      if (A) ['P', 'S'].forEach(function (k) { var a = A[k], ch = a && a.ch; cat.chains.num(a ? a.st : null); if (!ch) { cat.chains.num(null); return; } cnt.chains++; cat.chains.arr(ch.p); cat.chains.arr(ch.q); cat.chains.num(ch.pay); cat.chains.num(!!ch.lost); });
      (sh.chLost || []).forEach(function (ch) { cat.chains.arr(ch.p); cat.chains.arr(ch.q); cat.chains.num(ch.t); });
    });
    var PC = (g.pieces && g.pieces()) || []; cnt.pieces = PC.length; cat.pieces.w(0x55000000 ^ PC.length);
    PC.forEach(function (pc) {
      var C2 = pc.cl || []; cat.pieces.w(C2.length); cnt.pieceCl += C2.length;
      C2.forEach(function (c) { cat.pieces.arr(c.p); cat.pieces.arr(c.tv); cat.pieces.num(!!c.torn); var F = c.bf; if (F) { cat.pieces.arr(F.a); cat.pieces.arr(F.x); } else cat.pieces.num(null); });
      (pc.ropes || []).forEach(function (r) { cat.pieces.arr(r.pts); });
      cat.pieces.arr(pc.M);
    });
    try { cnt.fly = (g.flyState && g.flyState().length) || 0; } catch (e) { cnt.fly = -1; }
    var all = new Hs(), out = {};
    Object.keys(cat).forEach(function (k) { var x = cat[k].hex(); out[k] = x; all.num(k); all.num(x); });
    return { hash: all.hex(), cat: out, cnt: cnt };
  };
  /** battle hash + physics hash at one checkpoint */
  H.check = function (tag) { return { tag: tag, phys: H.physHash() }; };

  // ───────── driver ─────────
  H.gl = function () { return document.getElementById('cv').getContext('webgl2'); };
  H.frozen = function () { if (H.clk.mode !== 'real') H.clk.mode = 'frozen'; return H.clk; };
  H.tick1 = function () { if (H.clk.mode === 'frozen') H.clk.t += H.clk.step; return window.__game.tick(1); };
  H.ticks = function (n) { var r = null; for (var i = 0; i < n; i++) r = H.tick1(); return r; };
  H.sync = function () {                                   // waits for the GPU (gl.finish() in Chrome is only a flush)
    var gl = H.gl(), px = H.px1 || (H.px1 = new Uint8Array(4)), rb = G.getParameter.call(gl, 0x8CAA), pb = G.getParameter.call(gl, 0x88ED);
    if (pb) G.bindBuffer.call(gl, 0x88EB, null);
    G.bindFramebuffer.call(gl, 0x8CA8, null); G.readPixels.call(gl, 0, 0, 1, 1, 0x1908, 0x1401, px); G.bindFramebuffer.call(gl, 0x8CA8, rb);
    if (pb) G.bindBuffer.call(gl, 0x88EB, pb);
  };
  /** Broadside camera on ship spec.ship: fixed (mode 0, no tracking), target = ship centre (or [px, y, pz]), yaw = −ship.yaw + π/2 (+ spec.yawOff).
   *  spec.sail = k ⇒ target = the centre of sail k's authored box (grid coords through sh.M; R3 close-ups of torn sails). */
  H.camFor = function (spec) {
    var sh = window.__game.ships()[spec.ship || 0], c = sh.center && spec.center !== false ? sh.center : [sh.px, spec.y === undefined ? 3 : spec.y, sh.pz];
    var tgt = [c[0], spec.y === undefined ? c[1] : spec.y, c[2]];
    if (spec.sail !== undefined && sh.sails[spec.sail] && sh.M) {
      var b = sh.sails[spec.sail].bb, M = sh.M, x = (b[0] + b[3]) / 2, y = (b[1] + b[4]) / 2, z = (b[2] + b[5]) / 2;
      tgt = [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]];
    }
    return { mode: 0, track: false, follow: null, pan: [0, 0], tgt: tgt, dist: spec.dist || 60, yaw: -sh.yaw + Math.PI / 2 + (spec.yawOff || 0), pitch: spec.pitch === undefined ? 0.1 : spec.pitch };
  };
  H.cam = function (spec) { var o = H.camFor(spec); H.camSpec = spec; window.__game.cam(o); return o; };
  function readCanvas() {                                  // exact pixels of the default framebuffer (preserveDrawingBuffer: true), bottom-up RGBA
    var gl = H.gl(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
    var rb = G.getParameter.call(gl, 0x8CAA), pb = G.getParameter.call(gl, 0x88ED);
    if (pb) G.bindBuffer.call(gl, 0x88EB, null);
    G.bindFramebuffer.call(gl, 0x8CA8, null); G.readPixels.call(gl, 0, 0, w, h, 0x1908, 0x1401, px); G.bindFramebuffer.call(gl, 0x8CA8, rb);
    if (pb) G.bindBuffer.call(gl, 0x88EB, pb);
    return { w: w, h: h, px: px };
  }
  H.shot = function () {
    var r = readCanvas(), px = r.px; H.lastPx = px;
    var s = '', CH = 0x8000; for (var i = 0; i < px.length; i += CH) s += String.fromCharCode.apply(null, px.subarray(i, i + CH));
    return { w: r.w, h: r.h, b64: btoa(s) };
  };
  /** Exact pixels of the reflection target RT.R (null when reflections are off). */
  function readRefl() {
    var gl = H.gl(), RT = window.__rbat && window.__rbat.rt ? window.__rbat.rt() : null, R = RT && RT.R; if (!R) return null;
    var px = new Uint8Array(R.w * R.h * 4), rb = G.getParameter.call(gl, 0x8CAA), pb = G.getParameter.call(gl, 0x88ED);
    if (pb) G.bindBuffer.call(gl, 0x88EB, null);
    G.bindFramebuffer.call(gl, 0x8CA8, R.fb); G.readPixels.call(gl, 0, 0, R.w, R.h, 0x1908, 0x1401, px); G.bindFramebuffer.call(gl, 0x8CA8, rb);
    if (pb) G.bindBuffer.call(gl, 0x88EB, pb);
    return { w: R.w, h: R.h, px: px };
  }
  function pxCmp(a, b) {
    if (!a || !b) return a === b ? { px: 0, max: 0 } : { px: -1, max: -1 };
    var n = 0, mx = 0, A = a.px, B = b.px;
    for (var i = 0; i < A.length; i += 4) { var d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]), Math.abs(A[i + 3] - B[i + 3])); if (d) { n++; if (d > mx) mx = d; } }
    return { px: n, max: mx };
  }
  function b64Of(px) { var s = '', CH = 0x8000; for (var i = 0; i < px.length; i += CH) s += String.fromCharCode.apply(null, px.subarray(i, i + CH)); return btoa(s); }
  /** TASK-0813 cullsweep (off-screen ships not drawn, 60_rbatch.js viewVis): for every step, place the camera (H.camFor spec + pan = metres to
   *  the camera's right, lift = metres up, fwd = metres toward the camera; mask: true ⇒ leave the camera alone, __game.mask()), then render
   *  once to settle, then three times with the same random sequence: culling on, culling off, culling on again. Compares the final canvas and the reflection target
   *  RT.R of on vs off (must be identical) and on vs on (noise). ticks = sim frames before the step (state changes along the sweep).
   *  Returns per step: cs (per owner bits: 16 reflection drawn, 32 main drawn), cm/cr (owners culled), m/r ({px, max} on vs off), nm/nr (on vs on);
   *  the first `keep` failing steps also carry b64 images (main on/off). */
  H.cullSweep = function (steps, keep) {
    var g = window.__game, rb = window.__rbat, out = [], kept = 0, c0 = rb.cull();
    try {
      steps.forEach(function (st, k) {
        if (st.ticks) H.ticks(st.ticks);
        var o = null;
        if (!st.mask) {
          o = H.camFor(st);
          var yw = o.yaw, rx = -Math.sin(yw), rz = Math.cos(yw), fx = Math.cos(yw), fz = Math.sin(yw);
          if (st.pan) { o.tgt[0] += rx * st.pan; o.tgt[2] += rz * st.pan; }
          if (st.fwd) { o.tgt[0] += fx * st.fwd; o.tgt[2] += fz * st.fwd; }
          if (st.lift) o.tgt[1] += st.lift;
        }
        function one(on) { rb.cull(on); H.rsSet(r0); if (o) g.cam(JSON.parse(JSON.stringify(o))); else g.mask(); return { m: readCanvas(), r: readRefl(), s: { cm: rb.stat.cullMn, cr: rb.stat.cullRf } }; }
        var r0 = H.rsGet(); one(true);                    // warm-up render: the first render after sim ticks differs from the next ones (flood blend, remesh budget …)
        var A = one(true), cs = Array.prototype.slice.call(rb.tab.cs, 0, rb.tab.n), B = one(false), C = one(true);
        H.rsSet(r0); rb.cull(c0);
        var e = { k: k, cs: cs, cm: A.s.cm, cr: A.s.cr, m: pxCmp(A.m, B.m), r: pxCmp(A.r, B.r), nm: pxCmp(A.m, C.m), nr: pxCmp(A.r, C.r) };
        if ((e.m.px || e.r.px) && kept < (keep || 0)) { kept++; e.img = { w: A.m.w, h: A.m.h, on: b64Of(A.m.px), off: b64Of(B.m.px) }; }
        out.push(e);
      });
    } finally { rb.cull(c0); }
    return out;
  };
  /** Render the unchanged state again (render() only) and diff against the last H.shot(): GPU run-to-run noise (MSAA is not bit-reproducible here). */
  H.selfNoise = function (k) {
    var out = [];
    for (var j = 0; j < (k || 3); j++) {
      window.__game.mask(); var b = readCanvas().px, a = H.lastPx, mx = 0, n = 0;
      for (var i = 0; i < a.length; i += 4) { var d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])); if (d) { n++; if (d > mx) mx = d; } }
      out.push({ max: mx, px: n });
    }
    return out;
  };
  H.portsSummary = function () {
    return window.__game.ships().map(function (sh, i) {
      var p = window.__game.ports(i); if (!p || !p.L) return null;
      var o = { n: p.L.length, closed: 0, lidMoving: 0, open: 0, gunMoving: 0, runOut: 0, gone: 0 };
      p.L.forEach(function (q) { if (q.gone) o.gone++; var s = q.s; if (s <= 0.001) o.closed++; else if (s < 0.999) o.lidMoving++; else if (s <= 1.001) o.open++; else if (s < 1.999) o.gunMoving++; else o.runOut++; });
      return o;
    });
  };
  function stats(a) { var s = a.slice().sort(function (x, y) { return x - y; }), q = function (p) { return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
    var m = 0; s.forEach(function (v) { m += v; }); return { n: s.length, median: q(0.5), p10: q(0.1), p90: q(0.9), mean: m / Math.max(1, s.length), min: s[0], max: s[s.length - 1] }; }
  H.stats = stats;
  /** n timed frames of __game.tick(1). GPU drained before each frame (untimed) ⇒ cpu = JS + GL submission of that frame;
   *  total = same frame until the GPU finished it (cpu + readPixels(1 px) sync). reaim: re-place the camera every k frames (untimed). */
  H.timeTicks = function (n, reaim) {
    var cpu = [], tot = [], h = null;
    for (var i = 0; i < n; i++) {
      if (reaim && H.camSpec && i % reaim === 0) H.cam(H.camSpec);
      H.sync();
      if (H.clk.mode === 'frozen') H.clk.t += H.clk.step;
      var t0 = realNow(); h = window.__game.tick(1); var t1 = realNow(); H.sync(); var t2 = realNow();
      cpu.push(t1 - t0); tot.push(t2 - t0);
    }
    return { cpu: stats(cpu), total: stats(tot), cpuRaw: cpu, totalRaw: tot, hash: h && h.hash, simt: h && h.simt };
  };
  /** n timed render()-only calls (__game.mask() with no argument = MASK_OFF −1 = default, then render()): no sim step, same state every time. */
  H.timeRenders = function (n) {
    var cpu = [], tot = [];
    for (var i = 0; i < n; i++) {
      H.sync(); var t0 = realNow(); window.__game.mask(); var t1 = realNow(); H.sync(); var t2 = realNow();
      cpu.push(t1 - t0); tot.push(t2 - t0);
    }
    return { cpu: stats(cpu), total: stats(tot), cpuRaw: cpu, totalRaw: tot };
  };
  H.summary = function () {
    return window.__game.ships().map(function (s) {
      return { i: s.i, team: s.team, hull: s.T.id, px: +s.px.toFixed(2), pz: +s.pz.toFixed(2), yaw: +s.yaw.toFixed(4), fired: s.fired || 0, hits: s.hits || 0,
        guns: s.guns.length, models: s.models.length, decos: (s.decos || []).length, lids: (s.decos || []).filter(function (d) { return d.meta && d.meta.kind === 'portlid'; }).length };
    });
  };
})();
