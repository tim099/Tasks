# 實際玩一輪（真的時鐘、真的 rAF）：從主選單按開戰、打一陣、開砲、換船、剖面、觀察模式勾部件高亮、低畫質、帆撕破燒起來。
# 用法：python -I -X utf8 src/tests/render_lab/playtest.py <建置的 index.html> [--ports 9391-9399]
import argparse, importlib.util, json, os, sys, types

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('harness', os.path.join(HERE, 'harness.py'))
HN = importlib.util.module_from_spec(spec); sys.modules['harness'] = HN; spec.loader.exec_module(HN)

READY = HN.READY_GAME
GO_READY = '!!window.__vxk && document.getElementById("go") && !document.getElementById("go").disabled'
# 開戰了沒：照模擬時間與船數（__game.flow() 只記 ?start=1 分段開戰的進度，主選單按開戰走 start() 一口氣做完 ⇒ 一直是 null；0607026 之後）
CHECK_BATTLE = '(function(){ var s = __game.stats(); if (!(s.ships.length && s.t > 0)) throw new Error("battle did not start (t=" + s.t + ", ships=" + s.ships.length + ")"); return 1; })()'
INSP_ON = ('(function(){ var c = document.querySelector("#inspP input[type=checkbox][data-g]:not([data-m])"); if (!c) throw new Error("no observe-mode checkbox");'
           ' c.checked = true; c.dispatchEvent(new Event("change")); return document.querySelectorAll("#inspP input:checked").length; })()')
VARIANTS = [
    ('menu_play', 'index.html', 'debug=1&prefs=0&cache=0', GO_READY,
     [('js', 'document.getElementById("go").click(), 0'), ('sleep', 10), ('js', CHECK_BATTLE), ('js', '__game.tick(120), 0'), ('sleep', 3)]),
    ('low_fire', 'index.html', 'debug=1&prefs=0&cache=0&gfx=low&start=1&ship=gloire,constitution&seed=5', READY,
     [('sleep', 2), ('js', '__game.fire(0), 0'), ('sleep', 3), ('js', '__game.tick(600), 0'), ('js', '__game.fire(1), 0'), ('sleep', 3)]),
    ('eve_long', 'index.html', 'debug=1&prefs=0&cache=0&mode=eve&start=1&blue=gloire,napoleon&red=constitution,gloire&gfx=high', READY,
     [('js', '__game.tick(1800), 0'), ('sleep', 2), ('js', '__game.take(1), 0'), ('sleep', 2), ('js', '__game.cut({half: true}), 0'), ('sleep', 2),
      ('js', '__game.cut({half: false}), 0'), ('js', '__game.tick(600), 0'), ('sleep', 2)]),
    ('observe_hi', 'index.html', 'debug=1&prefs=0&cache=0&mode=observe&start=1&ship=gloire&gfx=high', READY,
     [('sleep', 2), ('js', INSP_ON), ('sleep', 3), ('js', '__game.tick(10), 0'), ('sleep', 1)]),
    ('sails_inst0_sailk0', 'index.html', 'debug=1&prefs=0&cache=0&mode=eve&start=1&ship=gloire,constitution&gfx=high&inst=0&sailk=0', READY,
     [('js', '__game.tick(900), 0'), ('sleep', 3)]),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('html')
    ap.add_argument('--ports', default='9391-9399')
    ap.add_argument('--timeout', type=float, default=120)
    a = ap.parse_args()
    a.gpu = 'default'
    ports = HN.ports_of(a)
    out, bad = [], 0
    for v in VARIANTS:
        r = HN.smoke_one(ports, a, a.html, v)
        out.append(r)
        bad += len(r['errors'])
        print('%-20s ready=%s %5.1fs errors=%d %s' % (v[0], r['ready'], r['secs'], len(r['errors']), ' | '.join(r['errors'])[:300]))
        for w in r['warnings'][:3]:
            print('    warn:', w[:200])
    rd = os.path.join(HN.SCRATCH, 'runs'); os.makedirs(rd, exist_ok=True)
    json.dump(out, open(os.path.join(rd, 'playtest_%s.json' % os.path.basename(os.path.dirname(os.path.abspath(a.html)))), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('PLAYTEST:', 'OK' if not bad else 'ERRORS %d' % bad)
    return 0 if not bad else 2


if __name__ == '__main__':
    sys.exit(main())
