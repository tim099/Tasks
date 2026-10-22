# 測試模式的船員記錄（js/83_testlog.js；Tim 2026-10-17「加測試模式&專屬資訊Log 可以知道水手移動路徑等資訊(記錄一整局) 之後也可以用來排查其他Bug」）。只讀、不改東西。
#   跑一局：python -I -X utf8 src/tests/crew_log.py --q "ship=sentinel,virginia&seed=3" --secs 300 --tag sentinel_s3
#     ⇒ 無頭 Chrome 開成品 ?demo=<秒>&dump=1&test=1&<q>，讀 #crewlog（#dump 照舊、不看）。
#   讀匯出檔：python -I -X utf8 src/tests/crew_log.py --files blockside-crewlog-seed3-300s.json --tag mine
#     ⇒ 遊戲裡結束畫面「📊 報表」→「🧪 匯出船員記錄」那一份。
#   寫：reports/crew_log/<tag>/index.html（不入版控；crew_log_view.html 嵌進資料：俯看一層甲板、砲塔那一圈、每個人的路徑，點人看事件）＋ 終端機印摘要。
#   --fail-on-wall：有人走路穿過砲塔那一圈（wall 事件 what=ring）⇒ exit 1（排查「水手穿牆」這一類 bug 時當檢查用；碰進船殼的另外列、不算）。
import argparse, html, json, os, re, subprocess, sys, tempfile, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
CHROME = [r'C:\Program Files\Google\Chrome\Application\chrome.exe', r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe']


def run(page, q, secs):
    chrome = next((c for c in CHROME if os.path.exists(c)), None)
    if not chrome: sys.exit('找不到 Chrome')
    prof = tempfile.mkdtemp(prefix='crewlog_')
    try:
        url = 'file:///' + page.replace('\\', '/') + '?demo=%d&dump=1&test=1&%s' % (secs, q)
        r = subprocess.run([chrome, '--headless=new', '--no-first-run', '--user-data-dir=' + prof, '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                            '--virtual-time-budget=%d' % max(600000, secs * 8000), '--dump-dom', url], capture_output=True, timeout=3600)
        m = re.search(r'<pre id="crewlog">(.*?)</pre>', r.stdout.decode('utf-8', 'replace'), re.S)
        if not m: sys.exit('讀不到 #crewlog（船沒載完、或成品沒有 83_testlog.js）')
        return json.loads(html.unescape(m.group(1)))
    finally:
        shutil.rmtree(prof, ignore_errors=True)


def summary(d):
    roles, out = d['roles'], []
    kinds = {}
    for e in d['ev']: kinds[e[3]] = kinds.get(e[3], 0) + 1
    out.append('seed %s、記 %s–%s 秒、路徑 %d 點（%.0f ms）、事件 %s%s' % (d['seed'], d['from'], d['off'] if d['off'] is not None else d['t'], d['cost']['points'], d['cost']['ms'],
               '／'.join('%s %d' % kv for kv in sorted(kinds.items())), '、路徑在 %s 秒截斷' % d['trunc'] if d['trunc'] else ''))
    ships = {s['i']: s for s in d['ships']}
    walls = [e for e in d['ev'] if e[3] == 'wall']
    for s in d['ships']:
        W = [e for e in walls if e[1] == s['i']]
        out.append('  %d %s：船員 %d、撞牆 %d 次（%d 人）；砲塔那一圈 %s' % (s['i'], s['name'], sum(1 for c in d['crew'] if c['ship0'] == s['i']), len(W), len({e[2] for e in W}),
                   '、'.join('%s 半徑 %s–%s z %s–%s' % (R['path'], R['rIn'], R['r'], R['z0'], R['z1']) for R in s['rings']) or '—'))
    ring = [e for e in walls if e[4]['what'] == 'ring']
    FROM = {'out': '從外面往裡', 'in': '從裡面往外', 'band': '本來就在牆裡', None: '?'}
    by = {}
    for e in ring: by[(e[4].get('ring'), e[4].get('from'))] = by.get((e[4].get('ring'), e[4].get('from')), 0) + 1
    out.append('  走路穿過砲塔那一圈：%d 次%s' % (len(ring), '（' + '、'.join('%s %s %d' % (k[0], FROM[k[1]], n) for k, n in sorted(by.items(), key=lambda kv: -kv[1])) + '）' if by else ''))
    for e in ring[:30]:
        c = d['crew'][e[2]]
        before = [x for x in d['ev'] if x[2] == e[2] and x[0] <= e[0] and x[3] == 'chg'][-1:]
        out.append('    %6.1fs 第 %d 艘 #%d（開局 %s）%s %s 在 %s；前一次變化：%s' % (e[0], e[1], e[2], roles[c['role0']], e[4].get('ring'), FROM[e[4].get('from')], e[4]['at'], json.dumps(before[0][4], ensure_ascii=False) if before else '—'))
    if len(ring) > 30: out.append('    …還有 %d 筆（看報表頁）' % (len(ring) - 30))
    hull = [e for e in walls if e[4]['what'] == 'hull']
    out.append('  身體碰進船殼（小腿和胸口兩格都是殼）：%d 次，照位置歸堆（2 m 一格）最多的幾處：' % len(hull))
    G = {}
    for e in hull: G.setdefault((e[1], int(e[4]['at'][0] // 20), int(e[4]['at'][1] // 20), e[4]['at'][2]), []).append(e)
    for k, L in sorted(G.items(), key=lambda kv: -len(kv[1]))[:8]:
        out.append('    第 %d 艘 x %d–%d、y %d–%d、z %d：%d 次（%d 人）' % (k[0], k[1] * 20, k[1] * 20 + 19, k[2] * 20, k[2] * 20 + 19, k[3], len(L), len({e[2] for e in L})))
    return '\n'.join(out), len(ring)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--html', default=os.path.join(ROOT, 'index.html'))
    ap.add_argument('--q', default='seed=3', help='網址參數（ship=…&seed=… 之類），demo／dump／test 自己會帶')
    ap.add_argument('--secs', type=int, default=180)
    ap.add_argument('--files', nargs='*', help='讀遊戲裡匯出的 JSON（不跑 Chrome）')
    ap.add_argument('--tag', default='latest')
    ap.add_argument('--fail-on-wall', action='store_true')
    a = ap.parse_args()
    logs = [json.load(open(f, encoding='utf-8')) for f in a.files] if a.files else [run(os.path.abspath(a.html), a.q, a.secs)]
    view = open(os.path.join(HERE, 'crew_log_view.html'), encoding='utf-8').read()
    od = os.path.join(ROOT, 'reports', 'crew_log', a.tag); os.makedirs(od, exist_ok=True)
    bad = 0
    for k, d in enumerate(logs):
        txt, n = summary(d); bad += n; print(txt)
        name = 'index.html' if k == 0 else 'log%d.html' % k
        data = json.dumps(d, ensure_ascii=False).replace('</', '<\\/')
        open(os.path.join(od, name), 'w', encoding='utf-8').write(view.replace('/*DATA*/null', data, 1))
        print('  ⇒ ' + os.path.join(od, name))
    if a.fail_on_wall and bad: sys.exit(1)


main()
