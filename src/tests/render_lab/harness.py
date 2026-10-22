# Blockside render measurement / comparison harness (headless Chrome + CDP, no third-party packages except numpy + PIL for compare).
# Full documentation: S0_NOTES.md next to this file.
#
#   python -I -X utf8 harness.py probe   [--ports 9371-9379]                      # which GL backend headless Chrome gets for each flag set
#   python -I -X utf8 harness.py measure --html <index.html> --out <dir> [--configs all|base9|extra|stress|<names>] [--repeat 1]
#                                        [--no-timing] [--frames 120] [--renders 240] [--q <extra query>] [--skip-programs P.sail,P.dsail]
#   python -I -X utf8 harness.py ab      --a <old index.html> --b <new index.html> --out <dir> [--repeat 3] [--qa ..] [--qb ..] [--no-timing]
#   python -I -X utf8 harness.py quick   --a <baseline run dir | index.html> --b <new index.html> --out <dir> [--configs ..] [--skip-programs ..]
#   python -I -X utf8 harness.py compare <dirA> <dirB> [--out <dir>]                # pixels + battle/physics hashes + counts + timing; exit 0 exact / 2 differ
#   python -I -X utf8 harness.py report  <dir>
#   python -I -X utf8 harness.py snapshot --src <worktree dir | index.html> --name <name> [--force]
#   python -I -X utf8 harness.py smoke   --html <new index.html> [--base <old index.html>] --out <dir> [--variants ..]
# Every command that launches Chrome takes --ports (e.g. 9371-9379, Track A); --port N is the old form (N..N+9).
#
# Per config: fresh Chrome profile, page loaded with ?debug=1&prefs=0&cache=0 + the config's params; inject.js (added with
# Page.addScriptToEvaluateOnNewDocument) seeds Math.random, swaps in a virtual clock, disables requestAnimationFrame and
# instruments WebGL2. Frames are driven only through __game.tick(1) (one 60 Hz sim step + real frame() incl. render) and
# __game.mask() (render() only).
import argparse, base64, datetime, hashlib, json, math, os, re, shutil, stat, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cdp  # noqa: E402

SCRATCH = os.environ.get('RENDER_LAB_DIR') or os.path.normpath(os.path.join(HERE, '..', '..', '..', 'reports', 'render_lab'))   # 量測的產物（建置快照、跑的結果、Chrome 設定檔）放 reports/（不入版控）；RENDER_LAB_DIR 可以換
PROFILES = os.path.join(SCRATCH, 'chrome_profiles')
BUILDS = os.path.join(SCRATCH, 'builds')
HARNESS_V = 2
BASE_Q = 'debug=1&prefs=0&cache=0'
GC = 'ship=gloire,constitution&start=1&dist=far&seed=3'           # dist=far is not numeric ⇒ the game ignores it (default 140 m); kept to match Blocksail's URL
F8 = 'blue=gloire,gloire,gloire,gloire&red=gloire,gloire,gloire,gloire&start=1&dist=far&seed=3'
BROAD = {'ship': 0, 'dist': 60, 'pitch': 0.1}
# ── the original 9 (byte-for-byte unchanged: their hashes/pixels are the long-running reference) ──
CONFIGS = {
    'gc_low': {'q': GC + '&gfx=low', 'warm': 120, 'cam': BROAD},
    'gc_mid': {'q': GC + '&gfx=mid', 'warm': 120, 'cam': BROAD},
    'gc_high': {'q': GC + '&gfx=high', 'warm': 120, 'cam': BROAD},
    'gc_ultra': {'q': GC + '&gfx=ultra', 'warm': 120, 'cam': BROAD},
    'gc_high_csm': {'q': GC + '&gfx=high&csm=1', 'warm': 120, 'cam': BROAD},          # cascaded shadow maps (4 cascades)
    'fleet8_high': {'q': F8 + '&gfx=high', 'warm': 120, 'cam': {'ship': 0, 'dist': 130, 'pitch': 0.22}},
    # gun ports: ships at action stations (mode=eve ⇒ both sides fire; red opens fire ~5 s, hits from ~6 s). Lids are closed at the
    # start and open by themselves on engagement; at tick 360 every lid is forced open (portsForce(i, 1)) and the shot / counted
    # frame are taken 40 ticks later while lids still swing and guns run out, with smoke, debris and holes around.
    'ports_high': {'q': GC + '&gfx=high&mode=eve', 'warm': 360, 'cam': {'ship': 0, 'dist': 45, 'pitch': 0.08}, 'ports': {'after': 1, 'mid': 40}},
    # reference without any lid: g_port=0 (no port animation) + g_deco=0 (decorations incl. lids not drawn) ⇒ what the lids cost now
    'gc_high_nolids': {'q': GC + '&gfx=high&g_port=0&g_deco=0', 'warm': 120, 'cam': BROAD},   # 名字是 S14 之前的：S14 起蓋板每艘都畫 ⇒ 這一組 ＝ 其他裝飾關、蓋板開著不動
    # lids drawn but not animated: g_port=0 (lids stay open, guns run out, no portsAnim work) with decorations on
    'gc_high_portstatic': {'q': GC + '&gfx=high&g_port=0', 'warm': 120, 'cam': BROAD},
}
BASE9 = ['gc_low', 'gc_mid', 'gc_high', 'gc_ultra', 'gc_high_csm', 'gc_high_nolids', 'gc_high_portstatic', 'fleet8_high', 'ports_high']
# ── extra / stress configs (S0). 'hook' = steps run after warm-up (and after the ports step): a JS expression string, or
#    {'ticks': n} (n more __game.tick(1) frames). 'cam': None = never touch the camera (render through __game.mask()). ──
GC50 = 'ship=gloire,constitution&start=1&dist=50&seed=3'            # 50 m = the URL minimum (config dist [50,1000,140])
# player fires a chain-shot broadside aimed at the centre (grid coords) of sail k of ship 1 (returns how many guns fire)
AIM_SAIL = '(function(){var b=__game.ships()[1].sails[%d].bb; return __game.fire(2, [(b[0]+b[3])/2, (b[1]+b[4])/2, (b[2]+b[5])/2]);})()'
# set the first two set, untorn sails of ship 1 on fire, 5 ignition points each (returns [k, name, points lit])
BURN_SAILS = ('(function(){var sh=__game.ships()[1], r=[]; for (var k=0; k<sh.sails.length && r.length<2; k++) { var s=sh.sails[k], c=sh.cl[k];'
              ' if (s.dead || s.furled || s.flag || (c && c.torn)) continue; var n=0; [3, 151, 307, 457, 613].forEach(function (q) { if (__game.burnSail(1, k, q)) n++; });'
              ' if (n) r.push([k, s.name, n]); } return r;})()')
# dig a 6-voxel ball out of mast m of ship i at the middle of its lowest segment (the mast above falls as a piece)
CUT_MAST = '(function(){var sh=__game.ships()[%d], m=sh.masts[%d]; return __game.dig(%d, m.x, sh.T.cy, (m.z0+m.z1)>>1, 6);})()'
MIX = 'blue=gloire,napoleon&red=constitution,napoleon&start=1&dist=far&seed=3'
EXTRA = {
    # cutaway (legacy path; shadows off while cut): half section, interior models (guns, kegs, furniture) visible
    'gc_high_cut': {'q': GC + '&gfx=high', 'warm': 120, 'cam': {'ship': 0, 'dist': 45, 'pitch': 0.1}, 'hook': ['__game.cut({half: true}), 0']},
    # a long fight: PIECES, FLY, own (damaged) hull + smooth regions, shot-away lids, loose ropes, torn sails
    'eve_late_high': {'q': GC + '&gfx=high&mode=eve', 'warm': 1600, 'cam': {'ship': 0, 'dist': 60, 'pitch': 0.12}},
    'fleet8_csm': {'q': F8 + '&gfx=high&csm=1', 'warm': 120, 'cam': {'ship': 0, 'dist': 130, 'pitch': 0.22}},
    'fleet8_close': {'q': F8 + '&gfx=high', 'warm': 120, 'cam': {'ship': 0, 'dist': 40, 'pitch': 0.1}},
    'gc_high_close': {'q': GC + '&gfx=high', 'warm': 120, 'cam': {'ship': 0, 'dist': 22, 'pitch': 0.06}},
    'gc_low_close': {'q': GC + '&gfx=low', 'warm': 120, 'cam': {'ship': 0, 'dist': 22, 'pitch': 0.06}},
    'gc_low_lids': {'q': GC + '&gfx=low', 'warm': 120, 'cam': {'ship': 1, 'dist': 30, 'pitch': 0.06}},   # 低畫質、鏡頭對憲法號（別艘）：S14 蓋板每艘都畫的改前／改後（不在 all 裡，照名字叫）
    # first person (near 0.05); the harness never places the camera in this config
    'gc_high_fp': {'q': GC + '&gfx=high', 'warm': 120, 'cam': None, 'hook': ['__game.fp(1), 0', {'ticks': 2}]},
    # torn + burning sails + shreds + loose sails/ropes: Constitution (player) fires two chain-shot broadsides aimed at the centres of
    # Gloire's main-topsail and fore-topsail (t 7 s and 15 s), then two set, untorn sails of Gloire are set on fire at 5 points each
    # and burn for 6 s (charred holes, glowing edges); camera on Gloire's rig. Verified: torn 5 sails / 87 fine tris, ~27 shreds,
    # 2 burning sails, loose sails, ~150 loose ropes.
    'rig_torn_burn': {'q': 'ship=constitution,gloire&start=1&dist=far&seed=3&gfx=high', 'warm': 420, 'cam': {'ship': 1, 'dist': 55, 'pitch': 0.25, 'y': 28, 'yawOff': 0.5},
                      'hook': [AIM_SAIL % 5, {'ticks': 500}, AIM_SAIL % 1, {'ticks': 120}, BURN_SAILS, {'ticks': 360}]},
    # R3 (TASK-0791) before/after close-up: the same two chain-shot broadsides as rig_torn_burn (no fire), camera close on Gloire's rig
    'rig_torn_close': {'q': 'ship=constitution,gloire&start=1&dist=far&seed=3&gfx=high', 'warm': 420, 'cam': {'ship': 1, 'dist': 24, 'pitch': 0.2, 'y': 24, 'yawOff': 0.5},
                       'hook': [AIM_SAIL % 5, {'ticks': 500}, AIM_SAIL % 1, {'ticks': 120}]},
    # night (tod=22: moon, lanterns and hull lamps bright, lantern halos)
    'gc_high_night': {'q': GC + '&gfx=high&tod=22', 'warm': 120, 'cam': {'ship': 0, 'dist': 32, 'pitch': 0.12, 'yawOff': -2.3}},
    # pieces + FLY (slow motion off, so the sim keeps stepping after the blast): Constitution's foremast is cut at its foot (falls as a
    # PIECE carrying a sail and its ropes), then her after magazine blows (hull chunks, debris, fire), then a gun is blown off (FLY)
    'pieces_fly_high': {'q': GC + '&gfx=high&slowmo=0&slowcam=0', 'warm': 120, 'cam': {'ship': 1, 'dist': 80, 'pitch': 0.15},
                        'hook': [CUT_MAST % (1, 0, 1), {'ticks': 60}, '__game.ignite(1, 0, "mag"), 0', {'ticks': 45}, '__game.blow(1, "gun")', {'ticks': 20}]},
    # mixed fleet: Gloire + Napoleon (62 port lids) vs Constitution + Napoleon
    'mixed_high': {'q': MIX + '&gfx=high', 'warm': 120, 'cam': {'ship': 0, 'dist': 110, 'pitch': 0.2}},
}
CONFIGS.update(EXTRA)
EXTRA_SET = ['gc_high_cut', 'eve_late_high', 'fleet8_csm', 'fleet8_close', 'gc_high_close', 'gc_low_close', 'gc_high_fp',
             'rig_torn_burn', 'gc_high_night', 'pieces_fly_high', 'mixed_high']
DEFAULT_SET = BASE9 + EXTRA_SET
SETS = {'all': DEFAULT_SET, 'default': DEFAULT_SET, 'base9': BASE9, 'extra': EXTRA_SET,
        'stress': ['rig_torn_burn', 'gc_high_cut', 'gc_high_night', 'pieces_fly_high', 'mixed_high', 'fleet8_csm', 'eve_late_high'],
        'sails': ['gc_high', 'rig_torn_burn', 'eve_late_high', 'fleet8_high', 'pieces_fly_high', 'gc_high_close'],
        'fast': ['gc_low', 'gc_high', 'gc_high_csm', 'ports_high', 'gc_high_cut', 'rig_torn_burn', 'gc_high_night', 'pieces_fly_high']}
# ── cullsweep (TASK-0813: off-screen ships not drawn in the main and reflection passes, 60_rbatch.js viewVis) ──
# Each sweep loads a base config (its q / warm / ports / hook), turns MSAA off, then moves the camera step by step so ships cross the
# screen edges (and the reflection frustum's edges), rendering every step with culling on, off and on again in the same page
# (__H.cullSweep): main canvas and reflection target must be identical on vs off. ticks = sim frames between steps.
def _orbit(spec, n, ticks=0, a0=0.0, a1=2 * math.pi):
    return [dict(spec, yawOff=a0 + (a1 - a0) * i / n, ticks=ticks) for i in range(n)]


def _ramp(spec, key, v0, v1, n, ticks=0):
    return [dict(spec, ticks=ticks, **{key: v0 + (v1 - v0) * i / max(1, n - 1)}) for i in range(n)]


SWEEPS = {
    'f8_orbit': {'base': 'fleet8_high', 'steps': _orbit({'ship': 0, 'dist': 40, 'pitch': 0.1}, 48, ticks=1)},       # neighbours cross left/right
    'f8_tilt': {'base': 'fleet8_high', 'steps': _ramp({'ship': 0, 'dist': 60, 'yawOff': 0.6}, 'pitch', -0.05, 1.35, 30)},   # ships leave top/bottom; steep look-down
    'f8_down': {'base': 'fleet8_high', 'steps': _ramp({'ship': 3, 'dist': 30, 'pitch': 1.1, 'yawOff': 0.3}, 'fwd', -40, 60, 34)},   # ship above the top edge, its mirror image on the water
    'f8_far': {'base': 'fleet8_high', 'steps': _orbit({'ship': 0, 'dist': 260, 'pitch': 0.08}, 36)},
    'gc_pan': {'base': 'gc_high', 'steps': _ramp({'ship': 1, 'dist': 45, 'pitch': 0.1}, 'pan', -140, 140, 41)},
    'gc_lift': {'base': 'gc_high', 'steps': _ramp({'ship': 0, 'dist': 50, 'pitch': 0.05, 'yawOff': 0.4}, 'lift', -30, 80, 23)},
    'gc_inside': {'base': 'gc_high', 'steps': _orbit({'ship': 0, 'dist': 6, 'pitch': 0.02, 'y': 4}, 24)},               # camera in / at the hull (near plane)
    'gc_cut': {'base': 'gc_high_cut', 'steps': _orbit({'ship': 0, 'dist': 45, 'pitch': 0.1}, 24)},                      # cutaway (rbatReplay path)
    'gc_night': {'base': 'gc_high_night', 'steps': _orbit({'ship': 0, 'dist': 32, 'pitch': 0.12}, 24)},
    'pieces': {'base': 'pieces_fly_high', 'steps': _orbit({'ship': 1, 'dist': 50, 'pitch': 0.15}, 32, ticks=1)},         # PIECES + FLY
    'eve_late': {'base': 'eve_late_high', 'steps': _orbit({'ship': 0, 'dist': 50, 'pitch': 0.12}, 24, ticks=2)},         # loose ropes, torn sails, shreds, anchors
    'mixed': {'base': 'mixed_high', 'steps': _orbit({'ship': 0, 'dist': 70, 'pitch': 0.15}, 32)},
    'fp': {'base': 'gc_high_fp', 'steps': [{'mask': True, 'ticks': 1} for _ in range(6)]},                              # first person (game camera)
}
SWEEP_SETS = {'all': list(SWEEPS), 'fast': ['f8_orbit', 'f8_down', 'gc_pan', 'gc_inside', 'pieces']}
PHYS_TAGS = ['warm', 'ports', 'hook', 'post_render', 'count', 'more', 'end']
HASH_TAGS = ['hash_warm', 'hash_ports', 'hash_hook', 'hash_count', 'hash_more', 'hash_end']
MORE_TICKS = 30


# ───────────────────────── ports / Chrome ─────────────────────────
class Ports:
    """A port range owned by one track (Track A 9371-9379, B 9381-9389, merge 9391-9399). Ports are used round-robin;
    a busy port (someone else's Chrome) is skipped, never reused (cdp.Chrome verifies DevToolsActivePort)."""

    def __init__(self, spec):
        self.L = cdp.parse_ports(spec)
        self.k = 0
        self.prof = os.path.join(PROFILES, 'p%d-%d' % (self.L[0], self.L[-1]))

    def open(self, gpu='default', extra=()):
        last = None
        for _ in range(2 * len(self.L)):
            p = self.L[self.k % len(self.L)]
            self.k += 1
            try:
                return cdp.Chrome(p, self.prof, gpu=gpu, extra=extra)
            except cdp.PortBusy as e:
                last = e
                time.sleep(0.2)
        raise RuntimeError('no usable DevTools port in %s (last: %s)' % (self.L, last))


def ports_of(a):
    return Ports(getattr(a, 'ports', None) or getattr(a, 'port', None) or 9361)


# ───────────────────────── page driving ─────────────────────────
def file_url(html, q):
    return 'file:///' + os.path.realpath(html).replace('\\', '/') + ('?' + q if q else '')      # realpath: long names (no 8.3 CRESPI~1)


def load_page(c, html, q, rseed):
    ws = c.ws
    ws.call('Page.enable')
    inj = open(os.path.join(HERE, 'inject.js'), encoding='utf-8').read()
    ws.call('Page.addScriptToEvaluateOnNewDocument', {'source': 'window.__HCFG=%s;\n%s' % (json.dumps({'rseed': rseed}), inj)})
    url = file_url(html, BASE_Q + '&' + q)
    t0 = time.time()
    ws.call('Page.navigate', {'url': url})
    last = None
    while time.time() - t0 < 240:
        try:
            v = ws.eval('(function(){var g=window.__game; if(!g||!window.__H) return null; var f=g.flow(), L=document.getElementById("load");'
                        'return {all: f ? f.all : null, n: f ? f.n : 0, ships: g.ships().length, load: L ? L.textContent : "", err: !!document.querySelector("#err.on, #errBox.on")};})()')
        except RuntimeError as e:
            v = {'exc': str(e)}
        last = v
        if v and v.get('all'):
            return url, round(time.time() - t0, 2), v
        if v and ('載入失敗' in (v.get('load') or '') or '失敗' in (v.get('load') or '')[:8]):
            raise RuntimeError('page failed to load: %s' % v.get('load'))
        time.sleep(0.25)
    raise RuntimeError('timed out waiting for staged start; last state %r' % (last,))


def js(ws, expr):
    return ws.eval(expr)


def jsv(ws, expr):
    """Evaluate an arbitrary expression and bring back a JSON-safe value (circular / huge objects become a short string)."""
    return ws.eval('(function(){var r=(%s); if (r === undefined) return null; try { return JSON.parse(JSON.stringify(r)); } catch (e) { return String(r).slice(0, 200); }})()' % expr)


def place(ws, cam):
    """Fixed harness camera (renders through __game.cam), or with cam None: leave the camera alone and render once (__game.mask())."""
    if cam is None:
        js(ws, '__game.mask(), 0')
        return None
    return js(ws, '__H.cam(%s)' % json.dumps(cam))


def phys(ws):
    return js(ws, '__H.physHash()')


def run_hook(ws, steps):
    out, last = [], None
    for s in steps:
        if isinstance(s, dict) and 'ticks' in s:
            last = json.loads(js(ws, 'JSON.stringify(__H.ticks(%d))' % s['ticks']))
            out.append({'ticks': s['ticks'], 'hash': last.get('hash'), 'simt': last.get('simt')})
        else:
            out.append({'js': s, 'ret': jsv(ws, s)})
    return out, last


def resolve_skip(ws, src, labels):
    """Program ids (in this page) whose harness label is in labels; labels that match nothing are reported."""
    progs = js(ws, '__H.progs')
    pl = prog_labels(src, progs)
    ids = sorted(int(i) for i, lab in pl.items() if lab in labels)
    matched = {}
    for i, lab in pl.items():
        if lab in labels:
            matched.setdefault(lab, []).append(int(i))
    return ids, {'requested': labels, 'matched': matched, 'unmatched': [x for x in labels if x not in matched]}


def run_config(name, cfg, html, src, a, ports, rep, timing, shots=True, q_extra='', skip=None):
    res = {'config': name, 'cfg': cfg, 'harness_v': HARNESS_V, 'q_extra': q_extra or '', 'skip_req': list(skip or [])}
    with ports.open(a.gpu) as c:
        ws = c.ws
        res['port'] = c.port
        res['chrome'] = ws.call('Browser.getVersion').get('product')
        res['gpu_info'] = ws.eval(cdp.gpu_info_js())
        q = cfg['q'] + ('&' + q_extra.lstrip('&') if q_extra else '')
        res['url'], res['load_s'], res['ready'] = load_page(c, html, q, a.rseed)
        js(ws, '__H.frozen(), 0')
        PH = res['phys'] = {}
        P = cfg.get('ports')
        if P and 'before' in P:
            js(ws, 'for (var i = 0; i < __game.ships().length; i++) void __game.portsForce(i, %s); 0' % json.dumps(P['before']))
        res['hash_warm'] = json.loads(js(ws, 'JSON.stringify(__H.ticks(%d))' % cfg['warm']))
        PH['warm'] = phys(ws)
        if P:
            js(ws, 'for (var i = 0; i < __game.ships().length; i++) void __game.portsForce(i, %s); 0' % json.dumps(P['after']))
            res['hash_ports'] = json.loads(js(ws, 'JSON.stringify(__H.ticks(%d))' % P['mid']))
            PH['ports'] = phys(ws)
        if cfg.get('hook'):
            res['hook'], last = run_hook(ws, cfg['hook'])
            if last:
                res['hash_hook'] = last
            PH['hook'] = phys(ws)
        cam = cfg.get('cam')
        res['cam'] = place(ws, cam)
        skip = skip if shots else None                                      # draws are only dropped for the screenshot renders (rep 0)
        if skip:
            ids, res['skip'] = resolve_skip(ws, src, list(skip))
            res['skip']['ids'] = ids
            js(ws, '__H.skipOn(%s), 0' % json.dumps(ids))
            place(ws, cam)                                                  # same state rendered again, now without those programs' draws
        if shots:
            shot = js(ws, '__H.shot()')
            res['shot'] = {'w': shot['w'], 'h': shot['h']}
            res['_px'] = shot['b64']
            res['self_noise'] = js(ws, '__H.selfNoise(3)')                  # same state rendered again: GPU noise of this config
        res['gfx'] = js(ws, '(function(){var g=__game.gfx(); return {level:g.level, gfx:g.gfx, w:g.w, h:g.h, msaa:g.msaa, shadow:g.shadow, refl:g.refl, sea:g.sea};})()')
        aa = res['gfx']['gfx'].get('aa')
        if shots and aa:
            # MSAA is not bit-reproducible on this GPU (repeated render() of the same state differs by a few levels on edges) =>
            # an extra exact shot with MSAA off (same state, same camera), then MSAA back on (targets rebuilt) before counting/timing
            js(ws, '__game.gfx({aa: 0}), __game.mask(), 0')
            sn = js(ws, '__H.shot()')
            res['_px_noaa'] = sn['b64']
            res['self_noise_noaa'] = js(ws, '__H.selfNoise(2)')
        if skip:
            res['skip']['stat'] = js(ws, '__H.skipOff()')
        if shots and aa:
            js(ws, '__game.gfx({aa: %d}), 0' % aa)
            place(ws, cam)
        res['shadow'] = js(ws, '(function(){var s=__game.shadow(); return s && {on:s.on, n:s.n, k:s.k};})()')
        res['ships'] = js(ws, '__H.summary()')
        res['ports'] = js(ws, '__H.portsSummary()')
        # counted frames (instrumented): a render()-only frame at the screenshot state, then one full tick(1) frame
        res['count_render'] = js(ws, '__H.count(function(){ __game.mask(); }, true)')
        PH['post_render'] = phys(ws)                                        # every render so far was render-only ⇒ must equal the last sim checkpoint
        cf = js(ws, '__H.count(function(){ return __H.tick1(); }, true)')
        res['hash_count'] = cf.pop('ret')
        res['count_frame'] = cf
        PH['count'] = phys(ws)
        res['progs'] = js(ws, '__H.progs')
        res['fbs'] = js(ws, '__H.fbs')
        res['hook_err'] = js(ws, '__H.hookErr || null')
        res['hash_more'] = json.loads(js(ws, 'JSON.stringify(__H.ticks(%d))' % MORE_TICKS))
        PH['more'] = phys(ws)
        if timing:
            place(ws, cam)
            t = js(ws, '__H.timeTicks(%d, 30)' % a.frames)
            res['time_tick'] = t
            res['hash_end'] = {'hash': t['hash'], 'simt': t['simt']}
            PH['end'] = phys(ws)
            place(ws, cam)
            res['time_render'] = js(ws, '__H.timeRenders(%d)' % a.renders)
        # debug probes of later steps (S2+): __rbatProbe() (TF exactness of instanced programs), __rbat.stat (rigMiss, matMiss …)
        res['rbat'] = js(ws, '(function(){var o={}; try { if (window.__rbatProbe) o.probe = JSON.parse(JSON.stringify(window.__rbatProbe())); } catch (e) { o.probeErr = String(e && e.stack || e).slice(0, 500); }'
                             ' try { if (window.__rbat && window.__rbat.stat) o.stat = JSON.parse(JSON.stringify(window.__rbat.stat)); } catch (e) { o.statErr = String(e).slice(0, 300); } return o;})()')
        res['ships_end'] = js(ws, '__H.summary()')
        res['raf_requests'] = js(ws, '__H.raf')
        res['clock'] = js(ws, '__H.clk')
    pw = PH.get('hook') or PH.get('ports') or PH.get('warm')
    res['render_wrote_phys'] = bool(pw and PH.get('post_render') and pw['hash'] != PH['post_render']['hash'])
    return res


# ───────────────────────── label resolution (needs the html the stack traces point into) ─────────────────────────
class Src:
    def __init__(self, html):
        txt = open(html, encoding='utf-8', errors='replace').read()
        self.lines = re.split(r'\r\n|\r|\n', txt)
        self.sha1 = hashlib.sha1(txt.encode('utf-8', errors='replace')).hexdigest()

    def before(self, line, col):
        """Text of `line` before 1-based UTF-16 column `col` (V8 stack columns are UTF-16 units)."""
        if not line or line > len(self.lines):
            return ''
        b = self.lines[line - 1].encode('utf-16-le')
        return b[:2 * (col - 1)].decode('utf-16-le', errors='replace')

    def text(self, line):
        return self.lines[line - 1] if line and line <= len(self.lines) else ''

    def lhs(self, line, col):
        t = self.before(line, col)
        t = re.sub(r'[\w$.]*$', '', t).rstrip(' (')
        m = re.search(r'([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(=|:)\s*$', t)
        if not m or t.endswith('==') or t.endswith('!=') or t.endswith('<=') or t.endswith('>='):
            return None, None
        return m.group(1), m.group(2)


def prog_labels(src, progs):
    out = {}
    for p in progs:
        s = p.get('site') or {}
        fn = s.get('fn') or '?'
        name, sep = src.lhs(s.get('line'), s.get('col')) if s.get('line') else (None, None)
        if name and name.startswith('P.'):
            lab = name
        elif name:
            lab = '%s:%s' % (fn, name)
        else:
            lab = '%s@%s' % (fn, p['hash'][:6])
        out[str(p['id'])] = lab
    return out


def fb_labels(src, fbs):
    out = {}
    for f in fbs:
        lab = None
        for fr in f.get('frames') or []:
            if fr.get('nat') or not fr.get('line'):
                continue
            name, sep = src.lhs(fr['line'], fr['col'])
            if name and ('.' in name or sep == ':'):
                lab = name if '.' in name and not name.startswith(('this.', 'o.', 'r.')) else '%s:%s' % (fr.get('fn') or '?', name)
                break
        if not lab:
            fr = next((x for x in f.get('frames') or [] if not x.get('nat')), {})
            lab = '%s@fb' % (fr.get('fn') or '?')
        if f.get('layer') is not None:
            lab += '[L%d]' % f['layer']
        out['fb%d' % f['id']] = lab
    return out


def map_fb_key(fbmap, k):
    # 'fb3@1280x720' / 'canvas@1280x720' / 'fbx@..'
    fb, _, vp = k.partition('@')
    return '%s@%s' % (fbmap.get(fb, fb), vp)


def relabel(d, f):
    out = {}
    for k, v in (d or {}).items():
        nk = f(k)
        out[nk] = out.get(nk, 0) + v
    return dict(sorted(out.items(), key=lambda kv: (-kv[1], kv[0])))


def pass_of_path(path):
    """Coarse pass of a draw from its JS call path: shadow (shadowPass/shadowSimple/csm*), refl (reflPass), main (rest of render), else the path."""
    parts = path.split('>')
    if not parts or parts[0] != 'render':
        return 'outside-render:' + (path or '?')
    inner = parts[1:]
    if any(re.search(r'shadow(?!DebugDraw)|csm', x, re.I) for x in inner):
        return 'shadow'
    if any(re.search(r'refl', x, re.I) for x in inner):
        return 'refl'
    return 'main'


def pass_fn_of_path(path):
    """pass + the drawing function right under the pass (e.g. shadow|drawModels, main|drawHulls, main|render)."""
    parts = path.split('>')
    ps = pass_of_path(path)
    if ps.startswith('outside'):
        return ps
    inner = [x for x in parts[1:] if not re.search(r'shadow(?!DebugDraw)|csm|refl', x, re.I)]
    return '%s|%s' % (ps, inner[0] if inner else 'render')


def analyse(res, src):
    pl = prog_labels(src, res['progs'])
    fl = fb_labels(src, res['fbs'])
    res['prog_labels'] = pl
    res['fb_labels'] = fl
    for key in ('count_render', 'count_frame'):
        C = res.get(key)
        if not C:
            continue
        D = C['draws']
        A = {'draws_total': D['total'], 'verts': D['verts'], 'instanced_calls': D['instCalls'], 'instances': D['instances'], 'by_fn': D['byFn']}
        A['by_program'] = relabel(D['byProg'], lambda k: pl.get(k, 'prog' + k))
        A['by_fb'] = relabel(D['byFb'], lambda k: map_fb_key(fl, k))
        A['by_program_fb'] = relabel(D['byProgFb'], lambda k: pl.get(k.split('|')[0], k.split('|')[0]) + ' | ' + map_fb_key(fl, k.split('|')[1]))
        A['by_path'] = relabel(D['byPath'], lambda k: k)
        A['by_pass'] = relabel(D['byPath'], pass_of_path)
        A['by_pass_fn'] = relabel(D['byPath'], pass_fn_of_path)
        A['by_path_fb'] = relabel(D['byPathFb'], lambda k: k.split('|')[0] + ' | ' + map_fb_key(fl, k.split('|')[1]))
        # vertices (count × instances) per pass / pass|fn / program: must stay identical through every pure-structure step
        A['verts_by_pass'] = relabel(D.get('byPathVerts'), pass_of_path)
        A['verts_by_pass_fn'] = relabel(D.get('byPathVerts'), pass_fn_of_path)
        A['verts_by_program'] = relabel(D.get('vertsByProg'), lambda k: pl.get(k, 'prog' + k))

        def leaf(k):
            path, _, lc = k.partition('|')
            ln, _, col = lc.partition(':')
            t = src.text(int(ln)) if ln.isdigit() else ''
            return '%s | L%s | %s' % (path, ln, t.strip()[:110])
        A['by_leaf'] = relabel(D['byLeaf'], leaf)
        # instancing potential: draws sharing program + target + VAO + vertex count + mode
        groups = {}
        uniq = 0
        reps = []
        for k, n in D['mesh'].items():
            pid, fk, vao, cnt, mode = k.split('|')
            g = groups.setdefault(pl.get(pid, pid) + ' | ' + map_fb_key(fl, fk), {'draws': 0, 'unique_meshes': 0})
            g['draws'] += n
            g['unique_meshes'] += 1
            uniq += 1
            if n > 1:
                reps.append((n, pl.get(pid, pid), map_fb_key(fl, fk), 'vao%s' % vao, int(cnt)))
        for g in groups.values():
            g['mergeable'] = g['draws'] - g['unique_meshes']
        A['instancing'] = {'draws': D['total'], 'unique_prog_target_mesh': uniq, 'mergeable_draws': D['total'] - uniq,
                           'by_group': dict(sorted(groups.items(), key=lambda kv: -kv[1]['mergeable'])),
                           'top_repeated_meshes': [{'n': r[0], 'prog': r[1], 'fb': r[2], 'vao': r[3], 'verts': r[4]} for r in sorted(reps, reverse=True)[:25]]}
        calls = C['calls']
        uni = {k: v for k, v in calls.items() if k.startswith('uniform') and k != 'uniformBlockBinding'}
        A['gl_calls_total'] = sum(calls.values())
        A['other_gl_calls'] = {
            'useProgram': calls.get('useProgram', 0),
            'uniform_total': sum(uni.values()), 'uniform_by_fn': dict(sorted(uni.items(), key=lambda kv: -kv[1])),
            'uniform_by_program': relabel(C['uniByProg'], lambda k: pl.get(k, k)),
            'bindVertexArray': calls.get('bindVertexArray', 0), 'bindBuffer': calls.get('bindBuffer', 0),
            'bufferData': calls.get('bufferData', 0), 'bufferData_bytes': C['bytes']['bufferData'],
            'bufferSubData': calls.get('bufferSubData', 0), 'bufferSubData_bytes': C['bytes']['bufferSubData'],
            'bindFramebuffer': calls.get('bindFramebuffer', 0), 'bindTexture': calls.get('bindTexture', 0), 'activeTexture': calls.get('activeTexture', 0),
            'vertexAttrib*': sum(v for k, v in calls.items() if k.startswith('vertexAttrib') and 'Pointer' not in k),
            'texImage/texSubImage': sum(v for k, v in calls.items() if re.match(r'tex(Sub)?Image', k)),
            'enable/disable': calls.get('enable', 0) + calls.get('disable', 0), 'viewport': calls.get('viewport', 0), 'clear': calls.get('clear', 0),
            'blitFramebuffer': calls.get('blitFramebuffer', 0), 'getParameter': calls.get('getParameter', 0), 'getError': calls.get('getError', 0),
        }
        A['all_calls'] = dict(sorted(calls.items(), key=lambda kv: -kv[1]))
        A['useProgram_by_program'] = relabel(C['useProg'], lambda k: pl.get(k, k))
        A['bindFramebuffer_by_fb'] = relabel(C['bindFb'], lambda k: fl.get(k, k))
        res[key + '_a'] = A
    return res


def save_png(path, w, h, b64):
    import numpy as np
    from PIL import Image
    a = np.frombuffer(base64.b64decode(b64), dtype=np.uint8).reshape(h, w, 4)[::-1]       # readPixels is bottom-up
    Image.fromarray(a.copy(), 'RGBA').save(path, optimize=False, compress_level=6)
    return hashlib.sha1(a.tobytes()).hexdigest()


def fmt_t(t):
    return 'med %.2f p10 %.2f p90 %.2f ms' % (t['median'], t['p10'], t['p90']) if t else '-'


def phys_short(r):
    P = r.get('phys') or {}
    return '/'.join((P[t]['hash'][:8] if P.get(t) else '-') for t in ('warm', 'count', 'more', 'end') if t in P) or '-'


def summary_line(r):
    A = r.get('count_frame_a') or {}
    R = r.get('count_render_a') or {}
    tt = r.get('time_tick') or {}
    tr = r.get('time_render') or {}
    return ('%-18s draws frame %5s (render-only %5s) | GL calls %6s | useProgram %4s uniform* %5s bindVAO %5s | tick cpu %s, +gpu %s | render cpu %s | hash %s/%s/%s | phys %s%s' % (
        r['config'], A.get('draws_total'), R.get('draws_total'), A.get('gl_calls_total'), A.get('other_gl_calls', {}).get('useProgram'),
        A.get('other_gl_calls', {}).get('uniform_total'), A.get('other_gl_calls', {}).get('bindVertexArray'),
        fmt_t(tt.get('cpu')), fmt_t(tt.get('total')), fmt_t(tr.get('cpu')),
        (r.get('hash_warm') or {}).get('hash'), (r.get('hash_count') or {}).get('hash'), (r.get('hash_end') or r.get('hash_more') or {}).get('hash'),
        phys_short(r), ' | RENDER WROTE PHYSICS' if r.get('render_wrote_phys') else ''))


def tstats(a):
    s = sorted(a)
    if not s:
        return None
    q = lambda p: s[min(len(s) - 1, int(p * (len(s) - 1) + 0.5))]
    lo, hi = len(s) // 10, max(len(s) // 10 + 1, len(s) * 9 // 10)
    return {'n': len(s), 'median': q(0.5), 'p10': q(0.1), 'p90': q(0.9), 'mean': sum(s) / len(s), 'tmean': sum(s[lo:hi]) / (hi - lo), 'min': s[0], 'max': s[-1]}


def merge_reps(reps):
    """rep 0 keeps everything; timing samples of all repeats are pooled; per-rep hashes/draws/medians kept for consistency checks."""
    r = reps[0]
    r['reps'] = [{'rep': k, 'hash_warm': (x.get('hash_warm') or {}).get('hash'), 'hash_ports': (x.get('hash_ports') or {}).get('hash'), 'hash_hook': (x.get('hash_hook') or {}).get('hash'),
                  'hash_count': (x.get('hash_count') or {}).get('hash'), 'hash_more': (x.get('hash_more') or {}).get('hash'), 'hash_end': (x.get('hash_end') or {}).get('hash'),
                  'phys': {t: v['hash'] for t, v in (x.get('phys') or {}).items() if v},
                  'render_wrote_phys': x.get('render_wrote_phys'),
                  'draws_frame': x['count_frame']['draws']['total'], 'draws_render': x['count_render']['draws']['total'],
                  'tick_cpu_median': (x.get('time_tick') or {}).get('cpu', {}).get('median'), 'render_cpu_median': (x.get('time_render') or {}).get('cpu', {}).get('median'),
                  'load_s': x.get('load_s'), 'port': x.get('port')} for k, x in enumerate(reps)]
    for key in ('time_tick', 'time_render'):
        if all(x.get(key) for x in reps):
            cpu = [v for x in reps for v in x[key]['cpuRaw']]
            tot = [v for x in reps for v in x[key]['totalRaw']]
            r[key] = {'cpu': tstats(cpu), 'total': tstats(tot), 'cpuRaw': cpu, 'totalRaw': tot, 'hash': reps[0][key].get('hash'), 'simt': reps[0][key].get('simt'), 'repeats': len(reps)}
    return r


def finish_config(r, src, out_dir):
    analyse(r, src)
    os.makedirs(out_dir, exist_ok=True)
    if '_px' in r:
        r['shot']['sha1'] = save_png(os.path.join(out_dir, 'shot.png'), r['shot']['w'], r['shot']['h'], r.pop('_px'))
    if '_px_noaa' in r:
        r['shot']['noaa_sha1'] = save_png(os.path.join(out_dir, 'shot_noaa.png'), r['shot']['w'], r['shot']['h'], r.pop('_px_noaa'))
    with open(os.path.join(out_dir, 'result.json'), 'w', encoding='utf-8') as f:
        json.dump(r, f, ensure_ascii=False, indent=1)
    return r


def config_names(s):
    names = []
    for n in (s or 'all').split(','):
        n = n.strip()
        if not n:
            continue
        for m in SETS.get(n, [n]):
            if m not in CONFIGS:
                raise SystemExit('unknown config %s (have: %s; sets: %s)' % (m, ', '.join(CONFIGS), ', '.join(SETS)))
            if m not in names:
                names.append(m)
    return names


def skip_list(s):
    return [x.strip() for x in (s or '').split(',') if x.strip()]


def new_meta(html, a, names, q_extra='', skip=None, timing=True, repeat=1, skip_extra=None):
    src = Src(html)
    return src, {'html': os.path.abspath(html), 'html_sha1': src.sha1, 'gpu_flags': a.gpu, 'flags': cdp.GPU_FLAGS[a.gpu], 'when': datetime.datetime.now().isoformat(timespec='seconds'),
                 'frames': a.frames, 'renders': a.renders, 'timing': timing, 'repeat': repeat, 'configs': names, 'rseed': a.rseed,
                 'q_extra': q_extra or '', 'skip_programs': list(skip or []), 'skip_extra': list(skip_extra or []), 'ports': cdp.parse_ports(getattr(a, 'ports', None) or getattr(a, 'port', None) or 9361),
                 'harness_v': HARNESS_V, 'snapshot': snapshot_info(html)}


def snapshot_info(html):
    p = os.path.join(os.path.dirname(os.path.abspath(html)), 'SNAPSHOT.json')
    try:
        with open(p, encoding='utf-8') as f:
            s = json.load(f)
        return {k: s.get(k) for k in ('name', 'src', 'git_head', 'git_dirty', 'when')}
    except (OSError, ValueError):
        return None


def one_run(n, html, src, a, ports, rep, timing, q_extra='', skip=None):
    t0 = time.time()
    r = run_config(n, CONFIGS[n], html, src, a, ports, rep, timing, shots=(rep == 0), q_extra=q_extra, skip=skip)
    tt, tr = (r.get('time_tick') or {}).get('cpu'), (r.get('time_render') or {}).get('cpu')
    P = r.get('phys') or {}
    print('    rep %d %-40s hash %s phys %s draws %s tick cpu %s render cpu %s (%.0f s, port %s)%s' % (
        rep, os.path.basename(os.path.dirname(os.path.abspath(html))) + '/' + os.path.basename(html),
        (r.get('hash_end') or r.get('hash_more') or r.get('hash_count') or {}).get('hash'), (P.get('end') or P.get('more') or {}).get('hash', '-')[:8],
        r['count_frame']['draws']['total'], tt and '%.2f' % tt['median'], tr and '%.2f' % tr['median'], time.time() - t0, r.get('port'),
        ' skip %s draws' % ((r.get('skip') or {}).get('stat') or {}).get('skipped') if skip else ''), flush=True)
    return r


def measure_build(html, out, names, a, timing, repeat, q_extra='', skip=None, ports=None, skip_extra=None):
    ports = ports or ports_of(a)
    os.makedirs(out, exist_ok=True)
    src, meta = new_meta(html, a, names, q_extra, skip, timing, repeat, skip_extra)
    eff = list(skip or []) + [x for x in (skip_extra or []) if x not in (skip or [])]
    allres = []
    for n in names:
        print('[%s]' % n, flush=True)
        reps = [one_run(n, html, src, a, ports, rep, timing, q_extra, eff) for rep in range(repeat)]
        r = finish_config(merge_reps(reps), src, os.path.join(out, n))
        meta.setdefault('renderer', (r.get('gpu_info') or {}).get('renderer'))
        meta.setdefault('chrome', r.get('chrome'))
        allres.append(r)
        print('  ' + summary_line(r), flush=True)
    with open(os.path.join(out, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    write_summary(out, allres, meta)
    return out


def cmd_measure(a):
    names = config_names(a.configs)
    measure_build(a.html, a.out, names, a, not a.no_timing, a.repeat, a.q, skip_list(a.skip_programs))


def cmd_ab(a):
    """Interleaved A/B: per config, repeat r runs A then B (even r) or B then A (odd r) => slow drifts of machine load hit both builds alike."""
    names = config_names(a.configs)
    skip = skip_list(a.skip_programs)
    skipB = skip + [x for x in skip_list(a.skip_b) if x not in skip]
    timing = not a.no_timing
    ports = ports_of(a)
    outA, outB = os.path.join(a.out, 'A'), os.path.join(a.out, 'B')
    srcA, metaA = new_meta(a.a, a, names, a.qa, skip, timing, a.repeat)
    srcB, metaB = new_meta(a.b, a, names, a.qb, skip, timing, a.repeat, skip_list(a.skip_b))
    resA, resB = [], []
    for n in names:
        print('[%s]' % n, flush=True)
        RA, RB = [], []
        for rep in range(a.repeat):
            order = [('A', a.a, srcA, a.qa, skip), ('B', a.b, srcB, a.qb, skipB)] if rep % 2 == 0 else [('B', a.b, srcB, a.qb, skipB), ('A', a.a, srcA, a.qa, skip)]
            for tag, html, src, qx, sk in order:
                (RA if tag == 'A' else RB).append(one_run(n, html, src, a, ports, rep, timing, qx, sk))
        for tag, R, src, meta, out, acc in (('A', RA, srcA, metaA, outA, resA), ('B', RB, srcB, metaB, outB, resB)):
            r = finish_config(merge_reps(R), src, os.path.join(out, n))
            meta.setdefault('renderer', (r.get('gpu_info') or {}).get('renderer'))
            meta.setdefault('chrome', r.get('chrome'))
            acc.append(r)
    for meta, out, acc in ((metaA, outA, resA), (metaB, outB, resB)):
        with open(os.path.join(out, 'meta.json'), 'w', encoding='utf-8') as f:
            json.dump(meta, f, ensure_ascii=False, indent=1)
        write_summary(out, acc, meta)
    a2 = argparse.Namespace(a=outA, b=outB, out=os.path.join(a.out, 'compare'))
    return cmd_compare(a2)


def cmd_quick(a):
    """Exactness only (no timing, 1 session per config): B measured, A either a recorded run dir (fast) or an html measured too."""
    skip = skip_list(a.skip_programs)
    ports = ports_of(a)
    if os.path.isdir(a.a):
        dirA = a.a
        ma = json.load(open(os.path.join(dirA, 'meta.json'), encoding='utf-8'))
        names = config_names(a.configs) if a.configs else list(ma['configs'])
        miss = [n for n in names if n not in ma['configs']]
        if miss:
            raise SystemExit('baseline run %s has no %s (record them first or pass --a <html>)' % (dirA, ', '.join(miss)))
        if list(ma.get('skip_programs') or []) != skip:
            raise SystemExit('baseline run %s was recorded with skip_programs %s, not %s: pass --a <baseline index.html> to measure A the same way'
                             % (dirA, ma.get('skip_programs'), skip))
        if (ma.get('q_extra') or '') != (a.qa or ''):
            raise SystemExit('baseline run %s was recorded with extra query %r, not %r' % (dirA, ma.get('q_extra'), a.qa))
    else:
        names = config_names(a.configs)
        dirA = measure_build(a.a, os.path.join(a.out, 'A'), names, a, False, 1, a.qa, skip, ports)
    dirB = measure_build(a.b, os.path.join(a.out, 'B'), names, a, False, 1, a.qb, skip, ports, skip_list(a.skip_b))
    return cmd_compare(argparse.Namespace(a=dirA, b=dirB, out=os.path.join(a.out, 'compare'), configs=','.join(names)))


def compact(r):
    A = r.get('count_frame_a') or {}
    R = r.get('count_render_a') or {}
    o = {'config': r['config'], 'gfx_level': (r.get('gfx') or {}).get('level'), 'canvas': [r['shot']['w'], r['shot']['h']] if r.get('shot') else None,
         'scene': [(r.get('gfx') or {}).get('w'), (r.get('gfx') or {}).get('h')],
         'msaa': (r.get('gfx') or {}).get('msaa'), 'shadow': r.get('shadow'),
         'hash_warm': (r.get('hash_warm') or {}).get('hash'), 'hash_ports': (r.get('hash_ports') or {}).get('hash'), 'hash_hook': (r.get('hash_hook') or {}).get('hash'),
         'hash_count': (r.get('hash_count') or {}).get('hash'), 'hash_more': (r.get('hash_more') or {}).get('hash'), 'hash_end': (r.get('hash_end') or {}).get('hash'),
         'phys': {t: v['hash'] for t, v in (r.get('phys') or {}).items() if v}, 'phys_counts': ((r.get('phys') or {}).get('more') or {}).get('cnt'),
         'render_wrote_phys': r.get('render_wrote_phys'), 'skip': r.get('skip'), 'rbat': r.get('rbat'),
         'simt_end': (r.get('hash_end') or r.get('hash_more') or {}).get('simt'), 'shot_sha1': (r.get('shot') or {}).get('sha1'), 'shot_noaa_sha1': (r.get('shot') or {}).get('noaa_sha1'),
         'self_noise_msaa': r.get('self_noise'), 'self_noise_noaa': r.get('self_noise_noaa'), 'ports': r.get('ports'), 'reps': r.get('reps'),
         'frame': {k: A.get(k) for k in ('draws_total', 'instanced_calls', 'instances', 'verts', 'gl_calls_total', 'by_program', 'by_pass', 'by_pass_fn', 'by_fb', 'verts_by_pass', 'other_gl_calls')},
         'frame_instancing': {k: (A.get('instancing') or {}).get(k) for k in ('draws', 'unique_prog_target_mesh', 'mergeable_draws')},
         'render_only': {k: R.get(k) for k in ('draws_total', 'gl_calls_total', 'by_program', 'by_pass', 'verts_by_pass')},
         'time_tick': {k: (r.get('time_tick') or {}).get(k) for k in ('cpu', 'total', 'repeats')} if r.get('time_tick') else None,
         'time_render': {k: (r.get('time_render') or {}).get(k) for k in ('cpu', 'total', 'repeats')} if r.get('time_render') else None,
         'ships_end': [(s['hull'], s['fired'], s['hits']) for s in r.get('ships_end') or []]}
    return o


def write_summary(out, allres, meta):
    S = {'meta': meta, 'configs': [compact(r) for r in allres]}
    with open(os.path.join(out, 'summary.json'), 'w', encoding='utf-8') as f:
        json.dump(S, f, ensure_ascii=False, indent=1)
    lines = ['html %s (sha1 %s)%s%s' % (meta['html'], meta['html_sha1'][:12], ' | extra query %s' % meta['q_extra'] if meta.get('q_extra') else '',
                                         ' | SKIPPED PROGRAMS %s' % ','.join(meta['skip_programs'] + (meta.get('skip_extra') or [])) if meta.get('skip_programs') or meta.get('skip_extra') else ''),
             'renderer %s | %s | flags %s' % (meta.get('renderer'), meta.get('chrome'), meta.get('flags')), '']
    lines += [summary_line(r) for r in allres]
    for r in allres:
        A = r.get('count_frame_a') or {}
        lines += ['', '== %s  (gfx %s, scene %sx%s, msaa %s, shadow %s)' % (r['config'], (r.get('gfx') or {}).get('level'), (r.get('gfx') or {}).get('w'), (r.get('gfx') or {}).get('h'), (r.get('gfx') or {}).get('msaa'), r.get('shadow'))]
        lines.append('  draws by pass   : ' + json.dumps(A.get('by_pass'), ensure_ascii=False))
        lines.append('  draws by pass|fn: ' + json.dumps(A.get('by_pass_fn'), ensure_ascii=False))
        lines.append('  draws by program: ' + json.dumps(A.get('by_program'), ensure_ascii=False))
        lines.append('  draws by fb     : ' + json.dumps(A.get('by_fb'), ensure_ascii=False))
        lines.append('  verts by pass   : ' + json.dumps(A.get('verts_by_pass'), ensure_ascii=False) + '  (total %s)' % A.get('verts'))
        ins = A.get('instancing') or {}
        lines.append('  instancing: %s draws, %s unique (prog,target,mesh) ⇒ %s mergeable' % (ins.get('draws'), ins.get('unique_prog_target_mesh'), ins.get('mergeable_draws')))
        lines.append('  other GL        : ' + json.dumps({k: v for k, v in (A.get('other_gl_calls') or {}).items() if not isinstance(v, dict)}, ensure_ascii=False))
        pc = ((r.get('phys') or {}).get('more') or {}).get('cnt')
        if pc:
            lines.append('  rig state       : ' + json.dumps(pc, ensure_ascii=False))
        if r.get('skip'):
            lines.append('  skip-programs   : ' + json.dumps({k: r['skip'].get(k) for k in ('matched', 'unmatched', 'stat')}, ensure_ascii=False))
        if r.get('hook'):
            lines.append('  hook            : ' + json.dumps(r['hook'], ensure_ascii=False)[:600])
        if r.get('rbat'):
            lines.append('  rbat            : ' + json.dumps(r['rbat'], ensure_ascii=False)[:600])
    txt = '\n'.join(lines)
    with open(os.path.join(out, 'summary.txt'), 'w', encoding='utf-8') as f:
        f.write(txt + '\n')
    print('\n' + txt)
    print('\nwrote', os.path.join(out, 'summary.json'))


def cmd_report(a):
    meta = json.load(open(os.path.join(a.dir, 'meta.json'), encoding='utf-8'))
    allres = [json.load(open(os.path.join(a.dir, n, 'result.json'), encoding='utf-8')) for n in meta['configs'] if os.path.exists(os.path.join(a.dir, n, 'result.json'))]
    write_summary(a.dir, allres, meta)


# ───────────────────────── compare ─────────────────────────
def dict_diff(a, b):
    keys = sorted(set(a or {}) | set(b or {}), key=lambda k: -max((a or {}).get(k, 0), (b or {}).get(k, 0)))
    return [(k, (a or {}).get(k, 0), (b or {}).get(k, 0)) for k in keys if (a or {}).get(k, 0) != (b or {}).get(k, 0)]


def pct(a, b):
    return '%+.1f%%' % ((b - a) / a * 100) if a else 'n/a'


def px_diff(pa, pb, out_png):
    import numpy as np
    from PIL import Image
    ia = np.asarray(Image.open(pa).convert('RGBA')).astype(np.int16)
    ib = np.asarray(Image.open(pb).convert('RGBA')).astype(np.int16)
    if ia.shape != ib.shape:
        return {'error': 'size %s vs %s' % (ia.shape, ib.shape), 'max_abs_diff': 999, 'diff_pixels': -1}
    d = np.abs(ia - ib)
    dm = d[..., :3].max(axis=2)
    r = {'max_abs_diff': int(dm.max()), 'diff_pixels': int((dm > 0).sum()), 'diff_pixels_gt2': int((dm > 2).sum()), 'diff_pixels_gt8': int((dm > 8).sum()),
         'total_pixels': int(dm.size), 'mean_abs_diff': float(d[..., :3].mean()), 'alpha_max_diff': int(d[..., 3].max())}
    if r['max_abs_diff']:
        mse = float((d[..., :3].astype(np.float64) ** 2).mean())
        r['psnr'] = round(10 * np.log10(255.0 ** 2 / mse), 2) if mse > 0 else None
        vis = np.zeros(ia.shape[:2] + (3,), np.uint8)
        g = (ia[..., :3].mean(axis=2) * 0.35).astype(np.uint8)
        vis[..., 0] = vis[..., 1] = vis[..., 2] = g
        m = dm > 0
        vis[m, 0] = np.clip(64 + dm[m] * 16, 0, 255).astype(np.uint8)
        vis[m, 1] = 0
        vis[m, 2] = 0
        Image.fromarray(vis, 'RGB').save(out_png)
        r['diff_image'] = out_png
    return r


def boot_ci(a, b, stat='median', n=2000, seed=1):
    """95% bootstrap CI of stat(B) - stat(A) in ms (independent resampling of the pooled frame samples)."""
    import numpy as np
    a, b = np.asarray(a, float), np.asarray(b, float)
    if not len(a) or not len(b):
        return None
    rng = np.random.default_rng(seed)
    f = np.median if stat == 'median' else (lambda x, axis: np.percentile(x, 10, axis=axis))
    da = f(a[rng.integers(0, len(a), (n, len(a)))], axis=1)
    db = f(b[rng.integers(0, len(b), (n, len(b)))], axis=1)
    lo, hi = np.percentile(db - da, [2.5, 97.5])
    return [round(float(lo), 3), round(float(hi), 3)]


def sum_key(o, pred):
    """Sum of numeric fields anywhere in o whose key satisfies pred (probe 'mismatch', stat '*Miss')."""
    t = 0
    if isinstance(o, dict):
        for k, v in o.items():
            if isinstance(v, (int, float)) and not isinstance(v, bool) and pred(k):
                t += v
            elif isinstance(v, (dict, list)):
                t += sum_key(v, pred)
    elif isinstance(o, list):
        for v in o:
            t += sum_key(v, pred)
    return t


def rbat_check(r):
    """(ok, text): __rbatProbe mismatches, __rbat.stat misses, probe/stat errors of one result."""
    R = r.get('rbat') or {}
    errs = [R[k] for k in ('probeErr', 'statErr') if R.get(k)]
    mis = sum_key(R.get('probe'), lambda k: k in ('mismatch', 'mismatches'))
    miss = sum_key(R.get('stat'), lambda k: k.endswith('Miss') or k.endswith('miss'))
    has = 'probe' in R or 'stat' in R or errs
    ok = not errs and mis == 0 and miss == 0
    return ok, ('-' if not has else 'ok' if ok else 'probe %s mismatch, %s misses%s' % (mis, miss, (' ERR ' + errs[0][:120]) if errs else ''))


def cmd_compare(a):
    out = a.out or os.path.join(a.b, 'compare_vs_' + os.path.basename(os.path.normpath(a.a)))
    os.makedirs(out, exist_ok=True)
    ma = json.load(open(os.path.join(a.a, 'meta.json'), encoding='utf-8'))
    mb = json.load(open(os.path.join(a.b, 'meta.json'), encoding='utf-8'))
    want = config_names(a.configs) if getattr(a, 'configs', None) else None
    names = [n for n in ma['configs'] if n in mb['configs'] and (want is None or n in want)]
    rep = ['A = %s  (%s, sha1 %s%s)' % (a.a, ma['html'], ma['html_sha1'][:12], ', query +' + ma['q_extra'] if ma.get('q_extra') else ''),
           'B = %s  (%s, sha1 %s%s)' % (a.b, mb['html'], mb['html_sha1'][:12], ', query +' + mb['q_extra'] if mb.get('q_extra') else ''),
           'renderer A %s | B %s' % (ma.get('renderer'), mb.get('renderer'))]
    skA, skB = list(ma.get('skip_programs') or []), list(mb.get('skip_programs') or [])
    if skA or skB:
        rep.append('skip-programs (screenshot renders only): A %s | B %s%s%s' % (skA, skB, ' + B-only %s' % mb.get('skip_extra') if mb.get('skip_extra') else '',
                                                                               '' if skA == skB else '   <-- DIFFERENT: pixel compare is meaningless'))
    rep.append('')
    J = {'A': a.a, 'B': a.b, 'configs': {}}
    ok_all = bool(names)
    table = []
    for n in names:
        ra = json.load(open(os.path.join(a.a, n, 'result.json'), encoding='utf-8'))
        rb = json.load(open(os.path.join(a.b, n, 'result.json'), encoding='utf-8'))
        c = {}
        # pixels: exact on the MSAA-off shot (or the main shot when the config has no MSAA); MSAA shot checked against its own noise
        has_noaa = os.path.exists(os.path.join(a.a, n, 'shot_noaa.png')) and os.path.exists(os.path.join(a.b, n, 'shot_noaa.png'))
        exact_name = 'shot_noaa.png' if has_noaa else 'shot.png'
        c['pixels_exact'] = dict(px_diff(os.path.join(a.a, n, exact_name), os.path.join(a.b, n, exact_name), os.path.join(out, n + '_diff_exact.png')), shot=exact_name)
        same_px = c['pixels_exact']['max_abs_diff'] == 0 and c['pixels_exact'].get('alpha_max_diff', 0) == 0 and skA == skB
        msaa_ok = True
        if has_noaa:
            c['pixels_msaa'] = px_diff(os.path.join(a.a, n, 'shot.png'), os.path.join(a.b, n, 'shot.png'), os.path.join(out, n + '_diff_msaa.png'))
            noise = (ra.get('self_noise') or []) + (rb.get('self_noise') or [])
            env = {'max': max([x['max'] for x in noise] or [0]), 'px': max([x['px'] for x in noise] or [0])}
            c['pixels_msaa']['self_noise_envelope'] = env
            msaa_ok = c['pixels_msaa']['max_abs_diff'] <= env['max'] + 2 and c['pixels_msaa']['diff_pixels'] <= 2 * env['px'] + 200
            c['pixels_msaa']['within_noise'] = msaa_ok
        # battle hashes: every checkpoint both sides have; plus every repeat of both builds agrees per checkpoint
        c['hashes'] = {k: [(ra.get(k) or {}).get('hash'), (rb.get(k) or {}).get('hash')] for k in HASH_TAGS if (ra.get(k) or {}).get('hash') and (rb.get(k) or {}).get('hash')}
        c['hashes_one_side'] = [k for k in HASH_TAGS if bool((ra.get(k) or {}).get('hash')) != bool((rb.get(k) or {}).get('hash'))]
        allreps = (ra.get('reps') or []) + (rb.get('reps') or [])
        rep_bad = [k for k in HASH_TAGS if len(set(x.get(k) for x in allreps if x.get(k))) > 1]
        same_hash = bool(c['hashes']) and all(x == y for x, y in c['hashes'].values()) and not rep_bad
        c['hash_rep_disagree'] = rep_bad
        # physics hashes (cloth / shreds / loose ropes / ropes / chains / pieces) at every common checkpoint, all repeats
        pa, pb = ra.get('phys') or {}, rb.get('phys') or {}
        tags = [t for t in PHYS_TAGS if pa.get(t) and pb.get(t)]
        c['phys'] = {t: [pa[t]['hash'], pb[t]['hash']] for t in tags}
        c['phys_diff_cats'] = {t: [k for k in pa[t]['cat'] if pa[t]['cat'][k] != pb[t]['cat'].get(k)] for t in tags if pa[t]['hash'] != pb[t]['hash']}
        prep_bad = [t for t in tags if len(set((x.get('phys') or {}).get(t) for x in allreps if (x.get('phys') or {}).get(t))) > 1]
        c['phys_rep_disagree'] = prep_bad
        phys_na = not tags
        same_phys = not phys_na and not c['phys_diff_cats'] and not prep_bad
        c['render_wrote_phys'] = [ra.get('render_wrote_phys'), rb.get('render_wrote_phys')]
        # debug probes (S2+)
        okA, txA = rbat_check(ra)
        okB, txB = rbat_check(rb)
        c['rbat'] = {'A': txA, 'B': txB}
        probe_ok = okA and okB
        A, B = ra.get('count_frame_a') or {}, rb.get('count_frame_a') or {}
        RA, RB = ra.get('count_render_a') or {}, rb.get('count_render_a') or {}
        c['draws'] = {'frame': [A.get('draws_total'), B.get('draws_total')], 'render_only': [RA.get('draws_total'), RB.get('draws_total')],
                      'gl_calls': [A.get('gl_calls_total'), B.get('gl_calls_total')], 'verts': [A.get('verts'), B.get('verts')],
                      'by_program': dict_diff(A.get('by_program'), B.get('by_program')), 'by_pass': dict_diff(A.get('by_pass'), B.get('by_pass')),
                      'by_pass_fn': dict_diff(A.get('by_pass_fn'), B.get('by_pass_fn')), 'by_fb': dict_diff(A.get('by_fb'), B.get('by_fb')),
                      'verts_by_pass': dict_diff(A.get('verts_by_pass'), B.get('verts_by_pass'))}
        oa, ob = A.get('other_gl_calls') or {}, B.get('other_gl_calls') or {}
        c['other_gl_calls'] = {k: [oa.get(k), ob.get(k)] for k in sorted(set(oa) | set(ob)) if not isinstance(oa.get(k, ob.get(k)), dict) and oa.get(k) != ob.get(k)}
        tt = {}
        for key in ('time_tick', 'time_render'):
            ta, tb = ra.get(key), rb.get(key)
            if ta and tb:
                tt[key] = {}
                for m in ('cpu', 'total'):
                    sa, sb = ta[m], tb[m]
                    tt[key][m] = {'A': {k: round(sa[k], 3) for k in ('median', 'p10', 'p90', 'tmean')}, 'B': {k: round(sb[k], 3) for k in ('median', 'p10', 'p90', 'tmean')},
                                  'delta_median': pct(sa['median'], sb['median']), 'delta_p10': pct(sa['p10'], sb['p10']),
                                  'ci95_median_ms': boot_ci(ta[m + 'Raw'], tb[m + 'Raw'], 'median'), 'ci95_p10_ms': boot_ci(ta[m + 'Raw'], tb[m + 'Raw'], 'p10'),
                                  'samples': [sa['n'], sb['n']]}
        # session (Chrome launch) is the real unit of noise: per-repeat medians of each build, to see whether the ranges overlap
        rk = {'time_tick': 'tick_cpu_median', 'time_render': 'render_cpu_median'}
        for key in tt:
            tt[key]['rep_medians_cpu'] = {'A': [round(x[rk[key]], 2) for x in ra.get('reps') or [] if x.get(rk[key]) is not None],
                                          'B': [round(x[rk[key]], 2) for x in rb.get('reps') or [] if x.get(rk[key]) is not None]}
        c['timing'] = tt
        exact = same_px and same_hash and msaa_ok and same_phys and probe_ok
        c['verdict'] = {'exact': exact, 'pixels_identical': same_px, 'msaa_within_noise': msaa_ok, 'hash_identical': same_hash, 'phys_identical': same_phys,
                        'phys_na': phys_na, 'probe_ok': probe_ok, 'fewer_draws': (B.get('draws_total') or 0) < (A.get('draws_total') or 0)}
        ok_all = ok_all and exact
        J['configs'][n] = c
        pe = c['pixels_exact']
        line = '== %s: pixels(%s) %s (max %s, %s px%s) ' % (n, exact_name, 'IDENTICAL' if same_px else 'DIFFER', pe.get('max_abs_diff'), pe.get('diff_pixels'),
                                                           ', PSNR %s' % pe.get('psnr') if pe.get('psnr') else '')
        if has_noaa:
            pm = c['pixels_msaa']
            line += '| MSAA shot max %s, %s px (%s; self-noise max %s, %s px) ' % (pm['max_abs_diff'], pm['diff_pixels'], 'ok' if msaa_ok else 'OUTSIDE NOISE', pm['self_noise_envelope']['max'], pm['self_noise_envelope']['px'])
        line += '| hash %s | phys %s | draws %s -> %s (%s), render-only %s -> %s | GL calls %s -> %s | verts %s -> %s' % (
            'same' if same_hash else 'DIFFERENT ' + json.dumps(c['hashes']) + (' reps disagree %s' % rep_bad if rep_bad else ''),
            'n/a' if phys_na else 'same' if same_phys else 'DIFFERENT %s%s' % (json.dumps(c['phys_diff_cats']), ' reps disagree %s' % prep_bad if prep_bad else ''),
            A.get('draws_total'), B.get('draws_total'), pct(A.get('draws_total') or 0, B.get('draws_total') or 0),
            RA.get('draws_total'), RB.get('draws_total'), A.get('gl_calls_total'), B.get('gl_calls_total'), A.get('verts'), B.get('verts'))
        if c['rbat']['A'] != '-' or c['rbat']['B'] != '-':
            line += ' | rbat A %s / B %s' % (c['rbat']['A'], c['rbat']['B'])
        if any(c['render_wrote_phys']):
            line += ' | RENDER WROTE PHYSICS A %s B %s' % tuple(c['render_wrote_phys'])
        rep.append(line)
        for key, t in tt.items():
            rep.append('   %-11s per-repeat cpu medians A %s | B %s' % (key, t['rep_medians_cpu']['A'], t['rep_medians_cpu']['B']))
            for m in ('cpu', 'total'):
                x = t[m]
                rep.append('   %-11s %-5s median %.2f -> %.2f ms (%s, 95%% CI %s ms) | p10 %.2f -> %.2f ms (%s, CI %s) | n %s' % (
                    key, m, x['A']['median'], x['B']['median'], x['delta_median'], x['ci95_median_ms'], x['A']['p10'], x['B']['p10'], x['delta_p10'], x['ci95_p10_ms'], x['samples']))
        for k, x, y in c['draws']['by_program'][:12]:
            rep.append('   draws %-34s %5s -> %5s' % (k, x, y))
        for k, x, y in c['draws']['by_pass_fn'][:14]:
            rep.append('   pass  %-34s %5s -> %5s' % (k, x, y))
        for k, x, y in c['draws']['verts_by_pass']:
            rep.append('   verts %-34s %9s -> %9s' % (k, x, y))
        if c['other_gl_calls']:
            rep.append('   other GL: ' + json.dumps(c['other_gl_calls'], ensure_ascii=False))
        why = []
        if not same_px:
            why.append('pixels %spx max %s' % (pe.get('diff_pixels'), pe.get('max_abs_diff')))
        if not msaa_ok:
            why.append('msaa outside noise')
        if not same_hash:
            why.append('battle hash')
        if not same_phys and not phys_na:
            why.append('phys ' + ','.join(sorted(set(k for v in c['phys_diff_cats'].values() for k in v))) + (' reps' if prep_bad else ''))
        if phys_na:
            why.append('phys n/a')
        if not probe_ok:
            why.append('rbat')
        table.append((n, exact, same_px, msaa_ok if has_noaa else None, same_hash, None if phys_na else same_phys, c['rbat']['B'],
                      '%s -> %s (%+d)' % (A.get('draws_total'), B.get('draws_total'), (B.get('draws_total') or 0) - (A.get('draws_total') or 0)),
                      '%s -> %s' % (A.get('gl_calls_total'), B.get('gl_calls_total')),
                      'same' if A.get('verts') == B.get('verts') else '%s -> %s' % (A.get('verts'), B.get('verts')), why))
    # ── the easy-to-read block ──
    yn = lambda v: '-' if v is None else 'ok' if v else 'DIFF'
    rep += ['', 'EXACT vs A (no-MSAA pixels + battle hashes + physics hashes + rbat probes; MSAA within self-noise):',
            '  %-18s %-6s %-7s %-6s %-7s %-6s %-8s %-22s %-17s %s' % ('config', 'exact', 'pixels', 'msaa', 'battle', 'phys', 'rbat', 'draws (frame)', 'GL calls', 'verts')]
    for t in table:
        rep.append('  %-18s %-6s %-7s %-6s %-7s %-6s %-8s %-22s %-17s %s' % (t[0], 'YES' if t[1] else 'NO', yn(t[2]), yn(t[3]), yn(t[4]), yn(t[5]), t[6][:8], t[7], t[8], t[9]))
    nx = sum(1 for t in table if t[1])
    bad = ['%s[%s]' % (t[0], '; '.join(t[10])) for t in table if not t[1]]
    rep.append('')
    rep.append('ALL PIXELS + HASHES IDENTICAL' if ok_all else 'SOME CONFIGS DIFFER (see above)')
    res_line = ('RESULT: EXACT %d/%d configs (pixels, battle hash, physics hash identical)' % (nx, len(table)) if ok_all else
                'RESULT: DIFFERS %d/%d configs exact; differ: %s' % (nx, len(table), ' '.join(bad) or '(no common configs)'))
    rep.append(res_line)
    J['result'] = res_line
    J['exact'] = ok_all
    txt = '\n'.join(rep)
    with open(os.path.join(out, 'compare.txt'), 'w', encoding='utf-8') as f:
        f.write(txt + '\n')
    with open(os.path.join(out, 'compare.json'), 'w', encoding='utf-8') as f:
        json.dump(J, f, ensure_ascii=False, indent=1)
    print(txt)
    print('\nwrote', out)
    return 0 if ok_all else 2


# ───────────────────────── snapshot ─────────────────────────
SNAP_DIRS = ['ships', 'maps', 'icons']


def _rw(path):
    for root, dirs, files in os.walk(path):
        for f in files:
            try:
                os.chmod(os.path.join(root, f), stat.S_IWRITE | stat.S_IREAD)
            except OSError:
                pass


def git_info(root):
    env = dict(os.environ, GIT_WORK_TREE=root)                           # linked worktree of the Blockside submodule: core.worktree leaks without it
    def g(*args):
        try:
            return subprocess.run(['git', '-C', root] + list(args), env=env, capture_output=True, text=True, encoding='utf-8', timeout=60).stdout.strip()
        except Exception as e:
            return 'ERR %s' % e
    return {'head': g('rev-parse', 'HEAD'), 'head_subject': g('log', '-1', '--format=%s'), 'branch': g('rev-parse', '--abbrev-ref', 'HEAD'),
            'dirty': [x for x in g('status', '--porcelain', '--untracked-files=no').split('\n') if x.strip()]}


def cmd_snapshot(a):
    src = os.path.abspath(a.src)
    root = os.path.dirname(src) if os.path.isfile(src) else src
    if not os.path.isfile(os.path.join(root, 'index.html')):
        raise SystemExit('%s has no index.html' % root)
    if os.path.normcase(os.path.realpath(root)).startswith(os.path.normcase(os.path.realpath(r'D:/Unity/Blocksail/external'))):
        raise SystemExit('refusing to read the shared checkout %s (snapshot your own worktree)' % root)
    dst = a.name if os.path.isabs(a.name) else os.path.join(BUILDS, a.name)
    if os.path.exists(dst):
        if not a.force:
            raise SystemExit('%s exists (use --force to replace)' % dst)
        _rw(dst)
        shutil.rmtree(dst)
    os.makedirs(dst)
    files = {}
    for f in sorted(os.listdir(root)):
        p = os.path.join(root, f)
        if os.path.isfile(p) and (f.endswith('.html') or f.endswith('.webmanifest')):
            shutil.copy2(p, os.path.join(dst, f))
            files[f] = hashlib.sha1(open(p, 'rb').read()).hexdigest()
    for d in SNAP_DIRS + list(a.extra or []):
        p = os.path.join(root, d)
        if os.path.isdir(p):
            shutil.copytree(p, os.path.join(dst, d))
            files[d + '/'] = sum(len(fs) for _, _, fs in os.walk(p))
    gi = git_info(root)
    meta = {'name': os.path.basename(dst), 'src': root, 'when': datetime.datetime.now().isoformat(timespec='seconds'),
            'git_head': gi['head'], 'git_subject': gi['head_subject'], 'git_branch': gi['branch'], 'git_dirty': gi['dirty'], 'files': files}
    with open(os.path.join(dst, 'SNAPSHOT.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    if not a.writable:
        for r, ds, fs in os.walk(dst):
            for f in fs:
                os.chmod(os.path.join(r, f), stat.S_IREAD)
    print('snapshot %s <- %s (HEAD %s %s%s)' % (dst, root, gi['head'][:7], gi['head_subject'][:60], '; DIRTY: %s' % gi['dirty'] if gi['dirty'] else ''))
    print('  index.html sha1 %s' % files.get('index.html'))
    print('  %s' % os.path.join(dst, 'index.html'))
    return 0


# ───────────────────────── smoke ─────────────────────────
GCQ = 'debug=1&prefs=0&cache=0&' + GC
READY_GAME = '!!(window.__game && __game.flow() && __game.flow().all)'
SMOKE = [
    # name, page, query, ready (JS, truthy => ready), then steps ('sleep', s) / ('js', expr) with the real clock and real rAF
    ('menu', 'index.html', 'debug=1&prefs=0&cache=0', '!!window.__vxk', [('sleep', 3)]),
    ('battle', 'index.html', GCQ + '&gfx=high', READY_GAME, [('sleep', 3), ('js', '__game.tick(20), 0'), ('sleep', 1)]),
    ('battle_low', 'index.html', GCQ + '&gfx=low', READY_GAME, [('sleep', 2)]),
    ('battle_csm', 'index.html', GCQ + '&gfx=high&csm=1', READY_GAME, [('sleep', 2)]),
    ('battle_cut', 'index.html', GCQ + '&gfx=high', READY_GAME, [('js', '__game.cut({half: true}), 0'), ('sleep', 2), ('js', '__game.cut({half: false, deck: 1}), 0'), ('sleep', 1)]),
    ('battle_fp', 'index.html', GCQ + '&gfx=high', READY_GAME, [('js', '__game.fp(1), 0'), ('sleep', 2)]),
    ('battle_inst0', 'index.html', GCQ + '&gfx=high&inst=0', READY_GAME, [('sleep', 3)]),
    ('battle_rb0', 'index.html', GCQ + '&gfx=high&rb=0', READY_GAME, [('sleep', 2)]),
    ('battle_chk', 'index.html', GCQ + '&gfx=high&rbchk=1&rigchk=1', READY_GAME, [('sleep', 2)]),
    ('battle_night', 'index.html', GCQ + '&gfx=high&tod=22', READY_GAME, [('sleep', 2)]),
    ('eve_mixed', 'index.html', 'debug=1&prefs=0&cache=0&' + MIX + '&gfx=high&mode=eve', READY_GAME, [('sleep', 4)]),
    ('demo', 'index.html', 'demo=3&dump=1&seed=3&prefs=0&cache=0', '!!document.getElementById("dump")', [('sleep', 1)]),
    ('demo_headless', 'index.html', 'demo=3&dump=1&headless=1&seed=3&prefs=0&cache=0', '!!document.getElementById("dump")', []),
    ('shipcheck', 'index.html', 'shipcheck=gloire&debug=1&cache=0', '!!document.getElementById("shipcheck")', []),
    ('admin_rooms', 'index.html', 'admin=rooms&debug=1&cache=0', '!!window.__vxk', [('sleep', 2)]),
    ('admin_defaults', 'index.html', 'admin=defaults&debug=1&cache=0', '!!window.__vxk', [('sleep', 2)]),
    ('admin_keys', 'index.html', 'admin=keys&debug=1&cache=0', '!!window.__vxk', [('sleep', 2)]),
    ('admin_furn', 'index.html', 'admin=furn&debug=1&cache=0', '!!window.__vxk', [('sleep', 2)]),
    ('fleetlab', 'fleetlab.html', 'nb=2&nr=2&go=1&debug=1&cache=0', '!!window.__vxk', [('sleep', 4)]),
    ('sandbox', 'sandbox.html', '', 'document.readyState === "complete"', [('sleep', 4)]),
    ('admin_html', 'admin.html', '', 'document.readyState === "complete"', [('sleep', 2)]),
]
SMOKE_NAMES = [s[0] for s in SMOKE]


def norm_msg(s):
    s = re.sub(r'file:///[^\s)\'"]*/([^/\s)\'"?#]+)(\?[^\s)\'"]*)?', r'\1', s or '')
    s = re.sub(r'(\.html|\.js)(:\d+){1,2}', r'\1:L', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s[:400]


def smoke_events(events):
    errs, warns = [], []
    for e in events:
        m, p = e.get('method'), e.get('params') or {}
        if m == 'Runtime.exceptionThrown':
            d = p.get('exceptionDetails') or {}
            desc = ((d.get('exception') or {}).get('description') or d.get('text') or '').split('\n')[0]
            errs.append('exception: ' + norm_msg(desc))
        elif m == 'Runtime.consoleAPICalled':
            t = p.get('type')
            txt = ' '.join(str(x.get('value', x.get('description', x.get('type')))) for x in p.get('args') or [])
            if t in ('error', 'assert'):
                errs.append('console.%s: %s' % (t, norm_msg(txt.split('\n')[0])))
            elif t == 'warning':
                warns.append('console.warn: ' + norm_msg(txt.split('\n')[0]))
        elif m == 'Log.entryAdded':
            en = p.get('entry') or {}
            (errs if en.get('level') == 'error' else warns).append('log.%s: %s %s' % (en.get('level'), norm_msg(en.get('text')), norm_msg(os.path.basename(en.get('url') or ''))))
        elif m == 'Inspector.targetCrashed':
            errs.append('page crashed')
    return errs, warns


def smoke_one(ports, a, html, var):
    name, page, q, ready, steps = var
    res = {'variant': name, 'page': page, 'q': q, 'ready': False}
    url = file_url(os.path.join(os.path.dirname(os.path.abspath(html)), page), q)
    t0 = time.time()
    with ports.open(a.gpu) as c:
        ws = c.ws
        for m in ('Page.enable', 'Runtime.enable', 'Log.enable', 'Inspector.enable'):
            try:
                ws.call(m)
            except RuntimeError:
                pass
        ws.call('Page.navigate', {'url': url})
        while time.time() - t0 < a.timeout:
            try:
                if ws.eval('(function(){ try { return !!(%s); } catch (e) { return false; } })()' % ready):
                    res['ready'] = True
                    break
            except RuntimeError:
                pass
            time.sleep(0.3)
        res['ready_s'] = round(time.time() - t0, 1)
        if res['ready']:
            for kind, v in steps:
                if kind == 'sleep':
                    end = time.time() + v
                    while time.time() < end:
                        try:
                            ws.eval('0')
                        except RuntimeError:
                            pass
                        time.sleep(0.25)
                else:
                    try:
                        ws.eval(v)
                    except RuntimeError as e:
                        ws.events.append({'method': 'Runtime.exceptionThrown', 'params': {'exceptionDetails': {'text': 'step %s: %s' % (v, e)}}})
        try:
            res['page'] = ws.eval('(function(){var e=document.querySelector("#err.on, #errBox.on"), L=document.getElementById("load");'
                                  'return {url: location.href.split("?")[0].split("/").pop(), err: e ? e.textContent.slice(0, 300) : null, load: L ? L.textContent.slice(0, 200) : null};})()')
        except RuntimeError as e:
            res['page'] = {'evalErr': str(e)}
        errs, warns = smoke_events(ws.events)
    pg = res.get('page') or {}
    if pg.get('err'):
        errs.append('page error box: ' + norm_msg(pg['err']))
    if '失敗' in (pg.get('load') or ''):
        errs.append('load line: ' + norm_msg(pg['load']))
    if not res['ready']:
        errs.append('not ready after %ss (%s)' % (a.timeout, ready))
    res['errors'], res['warnings'], res['secs'] = errs, warns, round(time.time() - t0, 1)
    return res


def cmd_smoke(a):
    names = [x.strip() for x in (a.variants or ','.join(SMOKE_NAMES)).split(',') if x.strip()]
    V = {s[0]: s for s in SMOKE}
    for n in names:
        if n not in V:
            raise SystemExit('unknown smoke variant %s (have %s)' % (n, ', '.join(SMOKE_NAMES)))
    ports = ports_of(a)
    os.makedirs(a.out, exist_ok=True)
    builds = [('B', a.html)] + ([('A', a.base)] if a.base else [])
    J = {'B': os.path.abspath(a.html), 'A': os.path.abspath(a.base) if a.base else None, 'variants': {}}
    lines = ['B = %s' % J['B'], 'A = %s' % J['A'], '']
    fail = False
    for n in names:
        R = {}
        for tag, html in (builds if len(builds) == 1 else (builds[::-1])):
            R[tag] = smoke_one(ports, a, html, V[n])
        eb = R['B']['errors']
        if 'A' in R:
            ea = R['A']['errors']
            new = [e for e in sorted(set(eb)) if e not in set(ea)]
            gone = [e for e in sorted(set(ea)) if e not in set(eb)]
        else:
            new, gone = sorted(set(eb)), []
        R['new_in_B'], R['gone_in_B'] = new, gone
        J['variants'][n] = R
        bad = bool(new)
        fail = fail or bad
        line = '%-15s %s  B: %d errors %d warnings (ready %ss)%s%s' % (n, 'NEW ERRORS' if bad else 'ok        ', len(eb), len(R['B']['warnings']), R['B'].get('ready_s'),
                                                                        ' | A: %d errors' % len(R['A']['errors']) if 'A' in R else '', ' | gone in B: %d' % len(gone) if gone else '')
        print(line, flush=True)
        lines.append(line)
        for e in new:
            lines.append('    + ' + e)
            print('    + ' + e, flush=True)
    lines.append('')
    lines.append('SMOKE: %s' % ('NEW ERRORS (see +)' if fail else 'no new errors' + (' vs A' if a.base else '')))
    txt = '\n'.join(lines)
    with open(os.path.join(a.out, 'smoke.txt'), 'w', encoding='utf-8') as f:
        f.write(txt + '\n')
    with open(os.path.join(a.out, 'smoke.json'), 'w', encoding='utf-8') as f:
        json.dump(J, f, ensure_ascii=False, indent=1)
    print(lines[-1])
    print('wrote', a.out)
    return 2 if fail else 0


def cmd_cullsweep(a):
    """TASK-0813: frame-by-frame proof that culling off-screen owners changes no pixel (main canvas + reflection target), see SWEEPS."""
    names = SWEEP_SETS.get(a.sweeps or 'all') or [x for x in a.sweeps.split(',') if x]
    bad = [x for x in names if x not in SWEEPS]
    if bad:
        raise SystemExit('unknown sweeps: %s (have %s)' % (bad, ', '.join(SWEEPS)))
    os.makedirs(a.out, exist_ok=True)
    ports, lines, total_bad = ports_of(a), [], 0
    for name in names:
        sw = SWEEPS[name]
        cfg = CONFIGS[sw['base']]
        t0 = time.time()
        with ports.open(a.gpu) as c:
            ws = c.ws
            q = cfg['q'] + ('&' + a.q.lstrip('&') if a.q else '')
            url, load_s, _ = load_page(c, a.html, q, a.rseed)
            js(ws, '__H.frozen(), 0')
            P = cfg.get('ports')
            if P and 'before' in P:
                js(ws, 'for (var i = 0; i < __game.ships().length; i++) void __game.portsForce(i, %s); 0' % json.dumps(P['before']))
            js(ws, 'JSON.stringify(__H.ticks(%d))' % cfg['warm'])
            if P:
                js(ws, 'for (var i = 0; i < __game.ships().length; i++) void __game.portsForce(i, %s); 0' % json.dumps(P['after']))
                js(ws, 'JSON.stringify(__H.ticks(%d))' % P['mid'])
            if cfg.get('hook'):
                run_hook(ws, cfg['hook'])
            js(ws, '__game.gfx({aa: 0}), 0')                                # exact pixels: MSAA is not bit-reproducible on this GPU
            gfx = js(ws, '(function(){var g=__game.gfx(); return {level:g.level, refl:g.refl, w:g.w, h:g.h};})()')
            steps, res = sw['steps'], []
            for i in range(0, len(steps), 6):                              # a few steps per evaluation (each renders 3 times)
                res += js(ws, '__H.cullSweep(%s, %d)' % (json.dumps(steps[i:i + 6]), 2))
        nbad = 0
        for e in res:
            if e['m']['px'] or e['r']['px']:
                nbad += 1
                if e.get('img'):
                    im = e.pop('img')
                    pa, pb = os.path.join(a.out, '%s_%03d_on.png' % (name, e['k'])), os.path.join(a.out, '%s_%03d_off.png' % (name, e['k']))
                    save_png(pa, im['w'], im['h'], im['on']); save_png(pb, im['w'], im['h'], im['off'])
                    px_diff(pa, pb, os.path.join(a.out, '%s_%03d_diff.png' % (name, e['k'])))
        mo_ri = sum(1 for e in res for v in e['cs'] if (v & 48) == 16)       # an owner culled in main but drawn in the reflection
        mi_ro = sum(1 for e in res for v in e['cs'] if (v & 48) == 32)
        both = sum(1 for e in res for v in e['cs'] if (v & 48) == 0)
        noise = sum(1 for e in res if e['nm']['px'] or e['nr']['px'])
        idle = sum(1 for e in res if (e['m']['px'] or e['r']['px']) and not e['cm'] and not e['cr'])   # differs although nothing was culled ⇒ GPU noise (eve_late's sea)
        line = ('%-10s %-16s refl=%s steps %3d  culled main %4d refl %4d  (main-out/refl-in %d, main-in/refl-out %d, both-out %d)  '
                'DIFF %d (with nothing culled %d)  noise %d  %.0fs') % (name, sw['base'], gfx.get('refl'), len(res), sum(e['cm'] for e in res), sum(e['cr'] for e in res),
                                               mo_ri, mi_ro, both, nbad, idle, noise, time.time() - t0)
        print(line, flush=True)
        lines.append(line)
        total_bad += nbad
        with open(os.path.join(a.out, name + '.json'), 'w', encoding='utf-8', newline='\n') as f:
            json.dump({'sweep': name, 'base': sw['base'], 'url': url, 'load_s': load_s, 'gfx': gfx, 'q_extra': a.q, 'steps': steps, 'res': res}, f)
    lines.append('RESULT: %s (%d differing steps)' % ('EXACT' if not total_bad else 'DIFFERS', total_bad))
    print(lines[-1])
    with open(os.path.join(a.out, 'summary.txt'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines) + '\n')
    return 0 if not total_bad else 2


def cmd_probe(a):
    ports = ports_of(a)
    for k in cdp.GPU_FLAGS:
        try:
            with ports.open(k) as c:
                print('%-12s %s' % (k, json.dumps(c.ws.eval(cdp.gpu_info_js()))))
        except Exception as e:
            print('%-12s ERROR %s' % (k, e))


def main():
    ap = argparse.ArgumentParser(description='Blockside render harness (see src/tests/render_lab/RENDER_LAB.md and NOTES.md)')
    sp = ap.add_subparsers(dest='cmd', required=True)

    def common(p, repeat=1):
        p.add_argument('--out', required=True)
        p.add_argument('--configs', default='')
        p.add_argument('--gpu', default='default', choices=list(cdp.GPU_FLAGS))
        p.add_argument('--frames', type=int, default=120)
        p.add_argument('--renders', type=int, default=240)
        p.add_argument('--no-timing', action='store_true')
        p.add_argument('--ports', default='', help='DevTools port range, e.g. 9371-9379 (Track A), 9381-9389 (B), 9391-9399 (merge)')
        p.add_argument('--port', type=int, default=9361, help='old form: base port, uses base..base+9 (ignored when --ports is given)')
        p.add_argument('--rseed', type=int, default=3)
        p.add_argument('--repeat', type=int, default=repeat)
        p.add_argument('--skip-programs', default='', help='program labels whose draws are dropped in the screenshot renders only (both builds), e.g. P.sail,P.dsail')
        p.add_argument('--skip-b', default='', help='(ab/quick) extra labels dropped on the B side only: programs that exist only in B and replace a skipped one of A')
    m = sp.add_parser('measure')
    m.add_argument('--html', required=True)
    m.add_argument('--q', default='', help='extra query appended to every config URL')
    common(m)
    b = sp.add_parser('ab')
    b.add_argument('--a', required=True)
    b.add_argument('--b', required=True)
    b.add_argument('--qa', default='', help='extra query for the A side (e.g. rb=0 to compare one build with itself)')
    b.add_argument('--qb', default='')
    common(b, repeat=3)
    k = sp.add_parser('quick')
    k.add_argument('--a', required=True, help='baseline run dir (recorded measure) or baseline index.html')
    k.add_argument('--b', required=True)
    k.add_argument('--qa', default='')
    k.add_argument('--qb', default='')
    common(k)
    c = sp.add_parser('compare')
    c.add_argument('a')
    c.add_argument('b')
    c.add_argument('--out', default='')
    c.add_argument('--configs', default='')
    r = sp.add_parser('report')
    r.add_argument('dir')
    s = sp.add_parser('snapshot')
    s.add_argument('--src', required=True, help='worktree dir (or its index.html)')
    s.add_argument('--name', required=True, help='dir name under reports/render_lab/builds (or an absolute path)')
    s.add_argument('--force', action='store_true')
    s.add_argument('--writable', action='store_true', help='do not mark the copied files read-only')
    s.add_argument('--extra', action='append', help='another top-level dir to copy')
    sm = sp.add_parser('smoke')
    sm.add_argument('--html', required=True)
    sm.add_argument('--base', default='', help='baseline index.html: fail only on errors that the baseline does not have')
    sm.add_argument('--out', required=True)
    sm.add_argument('--variants', default='')
    sm.add_argument('--timeout', type=float, default=90)
    sm.add_argument('--gpu', default='default', choices=list(cdp.GPU_FLAGS))
    sm.add_argument('--ports', default='')
    sm.add_argument('--port', type=int, default=9361)
    p = sp.add_parser('probe')
    p.add_argument('--ports', default='')
    p.add_argument('--port', type=int, default=9361)
    cw = sp.add_parser('cullsweep', help='TASK-0813: off-screen culling on vs off, frame by frame along camera sweeps (SWEEPS)')
    cw.add_argument('--html', required=True)
    cw.add_argument('--out', required=True)
    cw.add_argument('--sweeps', default='all', help='all | fast | comma list of SWEEPS names')
    cw.add_argument('--q', default='', help='extra query appended to every URL (e.g. inst=0)')
    cw.add_argument('--gpu', default='default', choices=list(cdp.GPU_FLAGS))
    cw.add_argument('--rseed', type=int, default=3)
    cw.add_argument('--ports', default='')
    cw.add_argument('--port', type=int, default=9361)
    a = ap.parse_args()
    if getattr(a, 'ports', None) == '':
        a.ports = None
    return {'measure': cmd_measure, 'ab': cmd_ab, 'quick': cmd_quick, 'compare': cmd_compare, 'report': cmd_report, 'probe': cmd_probe,
            'snapshot': cmd_snapshot, 'smoke': cmd_smoke, 'cullsweep': cmd_cullsweep}[a.cmd](a)


if __name__ == '__main__':
    raise SystemExit(main() or 0)
