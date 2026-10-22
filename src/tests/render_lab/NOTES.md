# S0 — measurement harness v2 (Blockside render plan)

Written during the 2026-10-21 render work (S0). Outputs (builds, runs, Chrome profiles) go to `reports/render_lab/` (git-ignored), so the baselines named below (`base_e991baa`, ...) are NOT in the repo: record a fresh baseline of the commit you start from before comparing (see task TASK-0781, section 怎麼接著做).

```
python -I -X utf8 src/tests/render_lab/harness.py <command> ...      # run from the Blockside root; H below = reports/render_lab (RENDER_LAB_DIR overrides)      # -I: isolated; -X utf8: page text is Chinese, console is cp950
```

Files: `harness.py` (driver, compare, snapshot, smoke), `cdp.py` (stdlib CDP client, port safety),
`inject.js` (determinism, GL instrumentation, physics hash, draw skipping).

## Baseline (frozen at Blockside e991baa)

| what | path |
|---|---|
| frozen build (index.html + sandbox/fleetlab/admin.html + ships/ + maps/ + icons/ + manifest, files read-only) | `$H/builds/base_e991baa/index.html` (index.html sha1 `0eb8ffc8a03f…`; `SNAPSHOT.json` records HEAD e991baa, branch claude/render-batch, clean) |
| recorded baseline run, all 20 configs, `--repeat 2`, with timing | `$H/runs/base_e991baa/` (`summary.txt`, `summary.json`, `<config>/{result.json, shot.png, shot_noaa.png}`; log `$H/runs/base_e991baa.log`) |
| same-build A=B check (quick, all 20 configs vs the recorded run) | `$H/runs/s0_ab_e991baa/compare/compare.txt` |
| baseline with sails suppressed (`--skip-programs P.sail,P.dsail`, no timing) — for Track B R2 | `$H/runs/base_e991baa_nosail/` |
| A=B check of the suppressed-sails mode | `$H/runs/s0_ab_e991baa_nosail/compare/compare.txt` |
| smoke reference (all variants, baseline vs itself) | `$H/runs/s0_smoke_e991baa/smoke.txt` |

The old baseline `builds/base_add56a9_0737dec053d1` / `runs/baseline_add56a9` is pre-S0 (no physics hashes, 9 configs) — do not use it any more.

## Rules (from plan_overrides.md, repeated because they matter for every run)

- Only headless Chrome launched by this harness. Never the in-app Browser pane / Claude_Browser / Claude in Chrome tools.
- Ports per track: **Track A 9371-9379**, **Track B 9381-9389**, **merge / visual / final 9391-9399**. Always pass `--ports`.
- Output dirs per track: `$H/runs/<track>_<step>` (e.g. `runs/A_S3`, `runs/B_R1`). Builds: `$H/builds/<track>_<step>`.
- Never read or snapshot `D:/Unity/Blocksail/external/Blockside` (snapshot refuses it). Snapshot your own worktree.
- Before git / build in a linked worktree: `export GIT_WORK_TREE=<your worktree>` (snapshot does this itself for its git queries).

## Per-step workflow

```
export GIT_WORK_TREE=D:/Unity/Blocksail/.claude/worktrees/blockside-render       # (Track B: .../blockside-rig)
cd $GIT_WORK_TREE && git checkout -- index.html && python -I src/admin.py build --code
python -I -X utf8 src/tests/render_lab/harness.py snapshot --src $GIT_WORK_TREE --name A_S3            # -> $H/builds/A_S3/index.html (+ SNAPSHOT.json with HEAD/dirty)
# exactness vs the frozen baseline (no timing; ~15-30 s per config, all 20 configs ~8 min):
python -I -X utf8 src/tests/render_lab/harness.py quick --a $H/runs/base_e991baa --b $H/builds/A_S3/index.html --out $H/runs/A_S3_quick --ports 9371-9379
#   -> last line "RESULT: EXACT 20/20 configs ..." and exit code 0; otherwise "RESULT: DIFFERS ..." and exit 2
# exactness vs the previous step (both measured):
python -I -X utf8 src/tests/render_lab/harness.py quick --a $H/builds/A_S2/index.html --b $H/builds/A_S3/index.html --out $H/runs/A_S3_vsS2 --configs fast --ports 9371-9379
# timing claim (interleaved A/B, repeat >= 3):
python -I -X utf8 src/tests/render_lab/harness.py ab --a $H/builds/base_e991baa/index.html --b $H/builds/A_S3/index.html --out $H/runs/A_S3_ab --repeat 3 --configs gc_high,gc_high_csm,fleet8_high --ports 9371-9379
# no new console errors on the other pages:
python -I -X utf8 src/tests/render_lab/harness.py smoke --html $H/builds/A_S3/index.html --base $H/builds/base_e991baa/index.html --out $H/runs/A_S3_smoke --ports 9371-9379
```

## Commands and flags

Common flags of `measure` / `ab` / `quick`:

| flag | meaning |
|---|---|
| `--configs X` | comma list of config names and/or set names: `all` (= default, 20 configs), `base9` (the original 9), `extra` (11 new), `stress` (rig_torn_burn, gc_high_cut, gc_high_night, pieces_fly_high, mixed_high, fleet8_csm, eve_late_high), `sails` (gc_high, rig_torn_burn, eve_late_high, fleet8_high, pieces_fly_high, gc_high_close), `fast` (8 quick ones covering every path: gc_low, gc_high, gc_high_csm, ports_high, gc_high_cut, rig_torn_burn, gc_high_night, pieces_fly_high) |
| `--ports 9371-9379` | DevTools port range (also `9371,9373` or a single base `9371` = 9371..9380). Ports are used round-robin. A port that already answers is skipped, and after launch the browser on the port must report OUR Chrome's pid (`SystemInfo.getProcessInfo`), so a run can never drive another session's Chrome. Chrome profiles go to `$H/chrome_profiles/p<first>-<last>/` (one dir per range; each run's profile is deleted after use). `--port N` is the old form. |
| `--repeat N` | sessions per config (fresh Chrome each). Shots only in rep 0; hashes/draws of every rep are cross-checked. Default 1 (`ab`: 3). |
| `--no-timing` | skip the timed frames (`quick` never times). |
| `--frames 120 --renders 240` | timed `tick(1)` frames / timed render-only calls per session. |
| `--skip-programs P.sail,P.dsail` | drop the draw calls of these program labels **in the screenshot renders only** (both builds alike; counts and timing untouched). Labels are the harness labels (`P.x` from `P.x = VK.compile(`; others `fn:name`). Proves "everything except these programs is bit-exact". Result json `skip`: matched ids per label, unmatched labels, `{skipped, seen}` draws. compare refuses (pixels = DIFF) when A and B used different skip sets. |
| `--gpu default` | `default` (ANGLE D3D11 on the RTX 2060 — the only backend where bit-exactness was established), `d3d11`, `d3d11-gpu`, `gl`, `swiftshader`. |
| `--rseed 3` | Math.random seed (mulberry32). |

Commands:

- `measure --html <index.html> --out <dir> [--q <extra query>]` — measure one build. `--q` appends to every config URL (e.g. `rb=0`).
  Writes `<dir>/meta.json`, `summary.txt`, `summary.json`, `<config>/result.json`, `shot.png`, `shot_noaa.png`.
- `ab --a <A.html> --b <B.html> --out <dir> [--qa ..] [--qb ..]` — interleaved A,B / B,A per config and repeat (timing), then compare.
  `--qa/--qb`: extra query on one side only, so one build can be compared with itself (`--qb rb=0`, `rbinst=0`, `rbgeo=0`, `rbtau=1e9`).
- `quick --a <recorded run dir | A.html> --b <B.html> --out <dir> [--qa ..] [--qb ..]` — exactness only: no timing, 1 session per config.
  With a run dir as A only B is measured (fast; the run dir must contain the requested configs and have the same skip set / extra query,
  otherwise it refuses); with an html both are measured. Then compare -> `<dir>/compare/compare.txt`.
- `compare <dirA> <dirB> [--out <dir>] [--configs ..]` — exit code 0 = every common config exact, 2 = something differs.
- `report <dir>` — reprint a measured dir's summary.
- `snapshot --src <worktree | index.html> --name <name> [--force] [--writable] [--extra <dir>]` — copy every top-level `*.html`,
  `manifest.webmanifest`, `ships/`, `maps/`, `icons/` (+ `--extra` dirs) to `$H/builds/<name>/` (or an absolute path), files read-only,
  plus `SNAPSHOT.json` (src, git HEAD, subject, branch, dirty files, sha1 of each html). `--force` replaces an existing snapshot.
- `smoke --html <B.html> [--base <A.html>] --out <dir> [--variants a,b] [--timeout 90]` — loads page variants headless with the real clock
  and real rAF (no inject), collects `Runtime.exceptionThrown`, `console.error/assert`, `Log.entryAdded` errors, page crashes, the page's own
  error box (`#err.on/#errBox.on`) and a `失敗` load line, plus "not ready within timeout". Messages are normalised (file paths -> basename,
  line:col -> `:L`). With `--base` it fails (exit 2) only on errors the base build does not have; without it every error counts.
  Variants: `menu`, `battle` (+ `tick(20)`), `battle_low`, `battle_csm`, `battle_cut` (half cut then deck 1), `battle_fp`, `battle_inst0`
  (`?inst=0`), `battle_rb0` (`?rb=0`), `battle_chk` (`?rbchk=1&rigchk=1`), `battle_night` (`tod=22`), `eve_mixed` (gloire+napoleon vs
  constitution+napoleon, eve), `demo` (`?demo=3&dump=1`, renders once), `demo_headless` (`&headless=1`, never renders), `shipcheck`
  (`?shipcheck=gloire`, waits for `#shipcheck`), `admin_rooms/defaults/keys/furn` (`index.html?admin=...`), `fleetlab`
  (`fleetlab.html?nb=2&nr=2&go=1` -> `index.html?lab=fleet`), `sandbox` (`sandbox.html`), `admin_html` (`admin.html`; its
  `net::ERR_FILE_NOT_FOUND` under file:// is expected and present in the baseline too). Unknown URL params are harmless (the game ignores them).
  Baseline: 0 errors in every variant except admin_html (that one file:// fetch); battles print 2 console warnings (Gloire ladder decks).
- `cullsweep --html <B.html> --out <dir> [--sweeps all|fast|a,b] [--q ..]` — TASK-0813 (off-screen owners not drawn in the main and
  reflection passes, `60_rbatch.js viewVis`). Each sweep in `SWEEPS` loads a base config (its q / warm / ports / hook), turns MSAA off and
  moves the camera step by step (orbit `yawOff`, `pitch` tilt, `pan` / `fwd` / `lift` of the target in metres, `ticks` sim frames between
  steps, `mask` = game camera e.g. first person). Every step (`__H.cullSweep`) renders once to settle, then three times with the same
  Math.random state: culling on, off (`__rbat.cull(false)`), on again; the canvas and the reflection target `RT.R` (`__rbat.rt()`) of on vs
  off must be identical. Per sweep it prints the owners culled in main / reflection, the owner-frames culled in one pass only (main-out /
  refl-in is the mirror-image case), DIFF steps (first two failing steps also get `_on/_off/_diff.png`), DIFF steps where nothing was
  culled (= GPU noise) and on-vs-on noise. `eve_late` has the known sea noise (about 1,100-1,700 px off by 1, moving between runs, also in
  steps with nothing culled); every other sweep is exact. Mutation check (2026-10-22): culling boxes that reach 40 m into the frustum is
  caught (42 differing steps in f8_orbit, gc_pan, f8_down); 5 m is not (the boxes are loose: only box, no geometry, inside).
- `probe` — which GL backend each `--gpu` flag set gives.

## What one config session does (run_config)

1. Fresh Chrome profile, URL `?debug=1&prefs=0&cache=0&<config q>[&<extra q>]`; inject.js before page scripts: seeded Math.random, virtual
   clock (step mode while loading, frozen after start: +1/60 s before each `tick(1)`), rAF stubbed, WebGL creation hooks.
2. `warm` ticks -> **hash_warm**, **phys warm**. `ports` step if any -> hash_ports, phys ports. `hook` steps if any -> hash_hook (last tick
   step), phys hook. Hook JS return values are kept in `result.json` `hook` (e.g. guns fired, sails lit, voxels dug).
3. Camera: `H.cam(spec)` (fixed, mode 0, no tracking, target = ship centre or `y` (or `sail: k` = the centre of sail k's authored box,
   through sh.M), yaw = -ship.yaw + pi/2 + `yawOff`, pitch, dist) or, for
   `cam: None` (first person), `__game.mask()` only.
4. Shots (rep 0): `shot.png` as configured (MSAA when on), self-noise (3 re-renders), then MSAA off -> `shot_noaa.png` (bit-exact),
   self-noise again, MSAA back. With `--skip-programs` the draw filter is on for exactly these renders.
5. Counted render-only frame -> **phys post_render** (every render so far was render-only, so it must equal the last sim checkpoint;
   `render_wrote_phys` is set when it does not) -> counted `tick(1)` frame -> **hash_count**, **phys count**.
6. `MORE_TICKS` = 30 more ticks -> **hash_more**, **phys more** (a later checkpoint that quick runs have too).
7. Timing (not in quick): 120 timed `tick(1)` (camera re-placed every 30, untimed) -> **hash_end**, **phys end**; 240 timed render-only calls.
8. Debug probes of later steps: if `window.__rbatProbe` exists its return value is stored (`rbat.probe`); if `window.__rbat.stat` exists it is
   stored (`rbat.stat`). compare fails on any numeric field named `mismatch`/`mismatches` > 0 anywhere in the probe result, any field ending
   in `Miss`/`miss` > 0 in the stat (rigMiss, matMiss, ...), or an exception from either (`probeErr`/`statErr`).
   Contract for S2/S4/S9 authors: `__rbatProbe()` returns e.g. `{triI: {items, verts, mismatch, maxUlp}, dtriI: {...}}`; `__rbat.stat` holds counters like `{rigMiss: 0, matMiss: 0}`.

### Physics-state hash (inject.js `H.physHash()`)

64-bit (FNV-1a 32 + a murmur-style 32 over 32-bit words) of the raw bytes of every physics typed array plus the scalar state, per category
(explicit whitelist of SIMULATION fields — renderer-owned fields such as `ow.sb`, `tDraw`, `tKey`, `vlamps` are not read):

| category | fields |
|---|---|
| sails | every ship's `sh.cl[k]`: `p q pin brk bbrk tv fz fzY fzR ccAcc` + `hidden gone loose torn late furlF npin free ev moved seen contactWarm` |
| burn | every sail: `dead furled`, `s.burn.{a, x, hf, lit, t1}` |
| shreds | `sh.shreds[]`: `p q pin brk bbrk tv rest` + `n torn loose age wet free kw ti` |
| loose | `sh.loose[]` (hanging ropes): `p q pin rest hk hv fy fr` + `n free` |
| ropes | `sh.ropes[]`: `pts dead lz moved` |
| rig | yards `m.rot`; hanging models `sw swA psi psiV pw` |
| chains | anchor chains `sh.anc.{P,S}`: `st`, `ch.{p, q, pay, lost}`; `sh.chLost[]` |
| pieces | `PIECES[]`: carried sails `cl[].{p, tv, torn, bf.a, bf.x}`, carried ropes `pts`, matrix `M` |

Checkpoints: warm, ports, hook, post_render, count, more, end (whichever the config/mode has). compare: every checkpoint both sides have must
be equal, and every repeat of both builds must agree; the report names the differing categories. Counts (`cnt`: cloth, live, torn, tornTris,
loose, gone, hidden, furling, burnSails, burnPts, shreds, looseRopes, deadRopes, chains, pieces, pieceCl, fly) are printed as "rig state".

### compare output

`compare.txt`: per config the old detailed lines (pixels, MSAA vs self-noise, hashes, draws, per-program / per-pass deltas, timing) plus
`phys same|DIFFERENT {checkpoint: [categories]}`, `verts A -> B`, `verts <pass>` deltas, `rbat` and `RENDER WROTE PHYSICS` when relevant;
then the block

```
EXACT vs A (no-MSAA pixels + battle hashes + physics hashes + rbat probes; MSAA within self-noise):
  config             exact  pixels  msaa   battle  phys   rbat     draws (frame)          GL calls          verts
  gc_high            YES    ok      ok     ok      ok     -        2804 -> 2804 (+0)      8841 -> 8841      same
...
RESULT: EXACT 20/20 configs (pixels, battle hash, physics hash identical)
```

or `RESULT: DIFFERS 18/20 configs exact; differ: gc_high[pixels 1234px max 3] fleet8_high[phys sails]`. Draw / GL-call / vertex counts are
reported, not judged (refactor steps are expected to change draws; "verts" must stay `same` for pure-structure steps). Exit 0 / 2.
Diff images: `<out>/<config>_diff_exact.png` (red = differing pixels), `<config>_diff_msaa.png`; PSNR is printed when pixels differ.

## Configs

URL bases: `GC = ship=gloire,constitution&start=1&dist=far&seed=3` (dist=far is ignored => 140 m), `F8` = 4 Gloires vs 4 Gloires.
The original 9 are byte-for-byte unchanged (their warm/count hashes equal the pre-S0 harness: 7892f005 / 54262d62 for the gc_* ones).

| config | URL / warm | camera | covers |
|---|---|---|---|
| gc_low, gc_mid, gc_high, gc_ultra | GC&gfx=… / 120 | broadside ship 0, 60 m | presets (low: no MSAA, no shadow/refl) |
| gc_high_csm | GC&gfx=high&csm=1 / 120 | same | 4 cascades |
| gc_high_nolids | …&g_port=0&g_deco=0 | same | no decos; lids are drawn (open, static) since S14 — the name predates S14 |
| gc_high_portstatic | …&g_port=0 | same | lids drawn, not animated |
| fleet8_high | F8&gfx=high / 120 | ship 0, 130 m, pitch .22 | 8 ships |
| ports_high | GC&gfx=high&mode=eve / 360 + ports open + 40 | ship 0, 45 m | lids swinging, guns running out, combat |
| **gc_high_cut** | GC&gfx=high / 120, hook `__game.cut({half: true})` | ship 0, 45 m | cutaway (legacy path, shadows off), interior models visible |
| **eve_late_high** | GC&gfx=high&mode=eve / 1600 | ship 0, 60 m, pitch .12 | long fight: torn sails (3), loose sails, ~190 loose ropes, FLY, damaged hull/smooth regions |
| **fleet8_csm** | F8&gfx=high&csm=1 / 120 | ship 0, 130 m | fleet + cascades (~21k draws) |
| **fleet8_close** | F8&gfx=high / 120 | ship 0, 40 m | neighbours near the camera |
| **gc_high_close** | GC&gfx=high / 120 | ship 0, 22 m, pitch .06 | lids, guns, lamps large on screen |
| **gc_low_close** | GC&gfx=low / 120 | same | low preset close up (lid step) |
| **gc_high_fp** | GC&gfx=high / 120, hook `__game.fp(1)` + 2 ticks | none (first person, near 0.05) | first person |
| **rig_torn_burn** | `ship=constitution,gloire&…&gfx=high` / 420; hook: chain broadside aimed at Gloire's main-topsail, 500 ticks, chain broadside at fore-topsail, 120 ticks, 2 set untorn sails of Gloire lit at 5 points each, 360 ticks | Gloire, 55 m, pitch .25, y 28, yawOff .5 | **torn (5 sails, 87 fine tris) + burning (2 sails, charred holes) + ~26 shreds + loose sails + ~150 loose ropes** |
| **rig_torn_close** | as rig_torn_burn without the fire (420; chain broadside at main-topsail, 500 ticks, at fore-topsail, 120 ticks) | Gloire, 24 m, pitch .2, y 24, yawOff .5 | R3 (TASK-0791) before/after close-up of torn sail edges; not in any set |
| **gc_high_night** | GC&gfx=high&tod=22 / 120 | ship 0, 32 m, pitch .12, yawOff -2.3 | night: moon, stars, lanterns + halos, lamps lighting the deck |
| **pieces_fly_high** | GC&gfx=high&slowmo=0&slowcam=0 / 120; hook: Constitution's foremast dug at its foot (falls as a PIECE carrying a sail and 76 ropes), 60 ticks, after magazine blown, 45 ticks, a gun blown off, 20 ticks | ship 1, 80 m | PIECES with carried sail/ropes, FLY (~12), explosion, debris, loose sails/ropes |
| **mixed_high** | `blue=gloire,napoleon&red=constitution,napoleon&…&gfx=high` / 120 | ship 0, 110 m, pitch .2 | 3 hull types incl. Napoleon (62 lids) |

Notes: slow motion is off in pieces_fly_high only (a magazine blast otherwise freezes the sim for the whole hook). The URL dist is clamped
to >= 50 m. rig_torn_burn uses Constitution as the player because `__game.fire` fires the player's broadside (Gloire's guns do not bear
at the start); aiming at a sail's bb centre is what reliably tears sails (unaimed chain shot mostly cuts ropes).

## Determinism (verified on the baseline e991baa)

- Recorded baseline `runs/base_e991baa` (2 sessions per config, timing on): in all 20 configs both repeats give identical battle hashes at
  every checkpoint, identical physics hashes at every checkpoint, identical draw counts. `render_wrote_phys` is false everywhere (render()
  does not touch cloth / rope / chain / piece state at baseline).
- Same-build A=B, a third independent session per config: `quick --a runs/base_e991baa --b builds/base_e991baa/index.html` ->
  `runs/s0_ab_e991baa/compare/compare.txt`: **RESULT: EXACT 20/20 configs** (no-MSAA pixels max diff 0, battle + physics hashes equal,
  MSAA shots within self-noise, draw / GL-call / vertex counts equal). No stress config had to be dropped.
- Suppressed-sails mode: `runs/base_e991baa_nosail` (all 20, `--skip-programs P.sail,P.dsail`) vs a new session ->
  `runs/s0_ab_e991baa_nosail/compare/compare.txt`: **RESULT: EXACT 20/20**.
- Negative check: the same build with `--qb p_rig=2` (cloth solver level only) -> `phys DIFFERENT {"warm": ["sails"], ...}`, battle hash
  same, exit 2 (`runs/s0_dev/neg_phys`). `ab` path checked with `--qb rb=0` (`runs/s0_dev/ab1`, exact).
- Smoke, baseline vs itself: `runs/s0_smoke_e991baa/smoke.txt`: no new errors (21 variants; only admin.html's file:// fetch error, in both).
- The original 9 configs keep the pre-S0 hashes (hash_warm/hash_count gc_* 7892f005/54262d62, fleet8 4d8ebfa7/ce2fd976, ports
  820d5579/e78c1e36), so v2 drives them exactly as v1 did.
- Note: the cloth simulation is camera dependent by design (30_rig_physics.js `rigFarM`: far / off-screen ships step their cloth less
  often), so physics hashes differ between configs that differ only in camera (gc_high vs gc_high_close end-checkpoint). Within a config
  the camera is fixed, so this is deterministic; a render change that altered `CAM` / the frustum would show up as a physics difference.

Durations on this machine: a recorded run of all 20 configs with `--repeat 2` and timing ≈ 15 min; `quick` vs a recorded run (all 20,
B only) ≈ 5 min; quick with `--a <html>` ≈ 10 min; `--configs fast` ≈ 2-4 min; smoke with `--base` ≈ 7 min. eve_late_high (1600 warm
ticks) and rig_torn_burn (1400 ticks) are the slowest single configs (~35-40 s); fleet configs ~30 s.

### Baseline reference numbers (counted tick frame; `runs/base_e991baa/summary.txt` has everything)

| config | draws | per pass | battle hash warm/hook/count/end | phys end | verts |
|---|---|---|---|---|---|
| gc_low | 910 | main 910 | 7892f005/-/54262d62/123ac94f | 7b11807f | 6393253 |
| gc_mid | 2148 | main 946 / shadow 928 / refl 274 | 7892f005/-/54262d62/123ac94f | 7b11807f | 14876988 |
| gc_high | 2804 | main 946 / refl 930 / shadow 928 | 7892f005/-/54262d62/123ac94f | 7b11807f | 19250571 |
| gc_ultra | 2804 | main 946 / refl 930 / shadow 928 | 7892f005/-/54262d62/123ac94f | 7b11807f | 19250571 |
| gc_high_csm | 4660 | shadow 2784 / main 946 / refl 930 | 7892f005/-/54262d62/123ac94f | 7b11807f | 31733217 |
| gc_high_nolids | 2597 | main 877 / refl 861 / shadow 859 | 7892f005/-/54262d62/123ac94f | 7b11807f | 19175115 |
| gc_high_portstatic | 2804 | main 946 / refl 930 / shadow 928 | 7892f005/-/54262d62/123ac94f | 7b11807f | 19250571 |
| fleet8_high | 12056 | main 4048 / refl 4008 / shadow 4000 | 4d8ebfa7/-/ce2fd976/a649e8e4 | 8b742b48 | 91613893 |
| ports_high | 2806 | main 948 / refl 930 / shadow 928 | 820d5579/-/e78c1e36/cf8691f7 | 2d417748 | 19511874 |
| gc_high_cut | 1874 | main 944 / refl 930 | 7892f005/-/54262d62/123ac94f | 0ca59500 | 12936190 |
| eve_late_high | 2785 | main 941 / refl 923 / shadow 921 | ca71137c/-/e482c8a9/ac0fef52 | d4a8aab3 | 19803427 |
| fleet8_csm | 21056 | shadow 13000 / main 4048 / refl 4008 | 4d8ebfa7/-/ce2fd976/a649e8e4 | 8b742b48 | 159644425 |
| fleet8_close | 12056 | main 4048 / refl 4008 / shadow 4000 | 4d8ebfa7/-/ce2fd976/a649e8e4 | 508dfb26 | 91613893 |
| gc_high_close | 2804 | main 946 / refl 930 / shadow 928 | 7892f005/-/54262d62/123ac94f | 524bcbd7 | 19250571 |
| gc_low_close | 910 | main 910 | 7892f005/-/54262d62/123ac94f | 524bcbd7 | 6393253 |
| gc_high_fp | 2804 | main 946 / refl 930 / shadow 928 | 7892f005/65b80c4a/fa7ea01c/cdc48684 | dd674a4e | 19252005 |
| rig_torn_burn | 2790 | main 942 / refl 925 / shadow 923 | 5fb9ea07/6acbcf3f/f8e0cf47/9c50ab8c | f15035ba | 19667749 |
| gc_high_night | 2804 | main 946 / refl 930 / shadow 928 | 7892f005/-/54262d62/123ac94f | 524bcbd7 | 19250571 |
| pieces_fly_high | 2743 | main 929 / refl 908 / shadow 906 | 7892f005/4bd7b706/c9102358/ebdb4a25 | 7ab6a0b1 | 19735923 |
| mixed_high | 6678 | main 2242 / refl 2220 / shadow 2216 | 94d139e5/-/697c422d/d3d9cf2f | 1bb51abd | 45006462 |

## Tips

- Track B (R2, sails allowed to change): prove everything else exact with
  `quick --a $H/runs/base_e991baa_nosail --b <B> --skip-programs P.sail,P.dsail [--skip-b P.<newSailProg>,...]`
  (`--skip-b`: programs that exist only in B and replace a skipped one; the recorded run's skip set must equal `--skip-programs`).
  Then the sail pixel stats: `quick --a $H/runs/base_e991baa --b <B> --configs sails` -> per config max / count / mean_abs_diff / PSNR in
  compare.json `pixels_exact`, diff PNGs in `<out>/compare/`, before/after shots in `$H/runs/base_e991baa/<cfg>/` and `<out>/B/<cfg>/`.
- One build against itself with a switch: `ab --a X --b X --qb rb=0 --no-timing --repeat 1` (or `quick --a X.html --b X.html --qb rb=0`).
- The physics hash is the gate for "rendering never writes simulation state": a `phys DIFFERENT` with `battle same` means a render-side
  write into cloth/rope/chain/piece state (or a changed camera/frustum feeding `rigFarM`).
- Adding a config: append to `EXTRA` + `EXTRA_SET` in harness.py, record it on the baseline (`measure --configs <new> --repeat 2` into a
  new run dir, or re-record), and verify A=B with quick before using it.
- `(dev helper, not kept) <html> <query> <steps.json>` is a small dev helper used to design the hooks (load with inject, run JS / ticks / shots).
- Scratch output of S0 development: `$H/runs/s0_dev/` (not a reference).
