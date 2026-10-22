// Regression checks for physical fastening ownership and immutable cloth pins.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = {
  Q: new URLSearchParams(), performance,
  norm: p => { const l = Math.hypot(...p) || 1; return p.map(x => x / l); },
  add: (a, b) => a.slice(0, 3).map((x, i) => x + b[i]),
  sub: (a, b) => a.slice(0, 3).map((x, i) => x - b[i]),
  mul: (a, s) => a.slice(0, 3).map(x => x * s),
  dot: (a, b) => a.slice(0, 3).reduce((s, x, i) => s + x * b[i], 0),
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: p => Math.hypot(...p.slice(0, 3)), clamp: (x, lo, hi) => Math.max(lo, Math.min(hi, x)),
  M4: { inv: x => x, pt: (_, ...p) => p }, modelLocal: () => null,
  VK: { pack: (x, y, z) => x + (y << 10) + (z << 20) }, SIMT: 0, DT: 1 / 60,
};
C.segDist2 = (p, ...q) => {
  const a = q.slice(0, 3), b = q.slice(3), d = C.sub(b, a);
  const t = C.clamp(C.dot(C.sub(p, a), d) / (C.dot(d, d) || 1), 0, 1);
  return C.len(C.sub(p, C.add(a, C.mul(d, t)))) ** 2;
};
vm.createContext(C);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/30_rig_physics.js'), 'utf8'), C);

const cube = {
  verts: [-2, -.5, -.5, 2, -.5, -.5, 2, .5, -.5, -2, .5, -.5,
    -2, -.5, .5, 2, -.5, .5, 2, .5, .5, -2, .5, .5],
  tris: [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7],
};
const md = { k: 0, mesh: 0, origin: [0, 0, 0], kind: 'yard', alive: true, piv: [.1, .1, .1] };
const H = { rig: { models: [md], meshes: [cube] } };
const sh = { T: H, models: [md], grid: { get: (x, y, z) => +(y === 0 && z === 0 && (x === 0 || x === -2)) } };
const T = { n: 4, p0: [-2, 0, 0, 2, 0, 0, -2, 10, 0, 2, 10, 0],
  tris: [0, 2, 1, 1, 2, 3], hk: [4, 4, 0, 0], hv: [0, 0, -1, -1] };
const c = { T, pin: [1, 1, 0, 0] };
const seam = C.ccSeams(sh, c)[0];
assert.ok(Math.abs(seam.radius - Math.SQRT1_2) < 1e-10, 'band comes from the actual square section');
const contact = [[-1, .2, 0, .48, .5, .02]];
assert.equal(C.ccLocalSeam(sh, c, [0, 1, 2], contact, 0), true);
assert.equal(C.ccLocalSeam(sh, c, [0, 1, 2], contact, 1), false, 'a different owner is rejected');
assert.equal(C.ccLocalSeam(sh, c, [0, 1, 2], [[-1, .2, 0, 0, 0, 1]], 0), false,
  'a free foot folding back to the yard is not a seam');
assert.equal(C.ccLocalSeam(sh, c, [0, 1, 2], contact.concat([[-1, .2, 0, 0, 0, 1]]), 0), false,
  'the entire contact set must fit, not its first witness');
contact.complete = false;
assert.equal(C.ccLocalSeam(sh, c, [0, 1, 2], contact, 0), false, 'incomplete coplanar evidence fails closed');
delete contact.complete;
c.pin[0] = 0;
assert.equal(C.ccLocalSeam(sh, c, [0, 1, 2], contact, 0), false, 'a released fastening is rejected');
c.pin[0] = 1;

const geo = { H, meshes: [] };
const joint = C.ccYardBodyJoint(sh, geo, 0);
assert.ok(joint.has('0,0,0'));
assert.ok(!joint.has('-2,0,0'), 'a disconnected body intersection is not the pivot fastening');

const mi = new Uint16Array(12), mw = new Float32Array(12);
mi[0] = 0; mw[0] = 1; mi[4] = 1; mw[4] = 1e-5;
const moving = { T: { mi, mw }, p: new Float32Array(6), q: new Float32Array(6),
  pin: [1, 0], ccAcc: new Float32Array(2), contactWarm: false };
for (let i = 0; i < 20; i++) C.ccMove(moving, [0, 1, 2], [1, 1, 0], [100, 0, 0], true);
assert.deepEqual(Array.from(moving.p.slice(0, 3)), [0, 0, 0], 'even mount=true never moves a pin');
assert.ok(moving.p[3] <= C.CC_STEP + 1e-6, 'tiny weights and repeated adjacent contacts obey the total step bound');
const folded = { T: { n: 5, p0: [-2, 0, 0, 2, 0, 0, -2, 0, -4, 2, 0, -4, -2, 0, -20],
  hk: [4, 4, 0, 0, 0], tris: [0, 2, 1, 1, 2, 3, 2, 4, 3] } };
const bundle = C.furlDraw(folded, Float32Array.from(folded.T.p0), 0);
assert.deepEqual(Array.from(bundle.slice(0, 6)), folded.T.p0.slice(0, 6), 'gathering preserves the fastened edge');
assert.equal(bundle[8], -4, 'gathering keeps one full material row outside the yard centre');
assert.equal(bundle[14], -4, 'the remaining cloth gathers at that row, not inside the wood');
assert.deepEqual(Array.from(C.furlDraw(folded, Float32Array.from(folded.T.p0), 1)), folded.T.p0,
  'fully deployed geometry is unchanged');
for (const kind of [1, 2, 3]) {
  const mixed = { T: { n: 3, p0: [0, 0, 0, 0, 0, -8, 0, 0, -16],
    hk: [4, kind, 0], tris: [0, 1, 2] } };
  const rendered = C.furlDraw(mixed, Float32Array.from(mixed.T.p0), 0);
  assert.deepEqual(Array.from(rendered.slice(3, 6)), mixed.T.p0.slice(3, 6),
    'gathering must also preserve body and rope fastening kind ' + kind);
}
console.log('PASS: immutable pins, bounded corrections, local seam ownership, finite pivot joint, exterior gathering row');
