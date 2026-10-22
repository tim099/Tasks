# 《憲法號對轟》繩的檢查：破壞之後有沒有浮空的纜線（Tim 2026-10-14）。跑很多局無頭 Chrome（成品 ?demo=<秒>&dump=1&ropecheck=1），彙整成報告。只讀、不改東西。
#   python -I ropecheck.py [--html <成品>] [--secs 150] [--seeds 1,2,3] [--match constitution,ember ember,falcon …] [--jobs 3] [--out ropecheck_report.md]
# 浮空的判斷在遊戲裡（js/10_ship.js ropesFloating）：繩還活著，可是有一端撐它的東西沒了 ——
#   帆桁／模型：沒了（飛出去、被斷開的那一截帶走）；格：端點附近（作品裡端點到錨的距離 ＋ 1 格，至少 2 格）已經沒有實心格；繩：靠的那條繩斷了或也浮空。
# 每局每半秒量一次，每條繩只記第一次（幾秒、哪一端、原因）。報告：每一型 作品本身的讀數（每一端靠什麼、端點離錨 > 2 格的）＋ 打起來浮空的（照原因分、照繩名數幾局）。
# ⚠ 同時開太多 Chrome 會有一局船沒載完（--jobs 預設 3）；讀不到 #ropecheck 的那一局照實列在報告裡。
import argparse, html, json, os, re, subprocess, sys, tempfile, shutil
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_HTML = os.path.normpath(os.path.join(HERE, '..', 'index.html'))
CHROME = [r'C:\Program Files\Google\Chrome\Application\chrome.exe', r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe']


def run_one(chrome, page, q, budget):
    prof = tempfile.mkdtemp(prefix='ropecheck_')
    try:
        url = 'file:///' + page.replace('\\', '/') + '?' + q
        r = subprocess.run([chrome, '--headless=new', '--no-first-run', '--user-data-dir=' + prof, '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                            '--virtual-time-budget=%d' % budget, '--dump-dom', url], capture_output=True, timeout=900)
        dom = r.stdout.decode('utf-8', 'replace')
        m = re.search(r'<pre id="ropecheck">(.*?)</pre>', dom, re.S)
        return json.loads(html.unescape(m.group(1))) if m else None
    except Exception as e:
        return None
    finally:
        shutil.rmtree(prof, ignore_errors=True)


def cat(why):
    for k, v in (('被斷開的那一截帶走', 'A 綁的模型／帆桁被斷開的那一截帶走（繩沒跟著斷）'), ('綁的模型沒了', 'B 綁的模型／帆桁沒了（繩沒跟著斷）'),
                 ('格內沒有格', 'C 端點附近的格都被打掉了，錨（較遠的另一格）還在'), ('錨格被打掉', 'D 錨格被打掉了（照理已經斷，量的那一刻還沒輪到）'),
                 ('靠的繩斷了', 'E 靠的繩斷了（繩掛在繩上，還沒輪到它斷）'), ('靠的繩浮空', 'F 靠的繩浮空（跟著上面那一條）')):
        if k in why:
            return v
    return 'G 其他：' + why


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser(description='繩的檢查：破壞後浮空的纜線')
    ap.add_argument('--html', default=OUT_HTML)
    ap.add_argument('--secs', type=int, default=150)
    ap.add_argument('--seeds', default='1,2,3')
    ap.add_argument('--match', nargs='*', default=['constitution,ember', 'ember,constitution', 'falcon,constitution', 'ember,falcon'])
    ap.add_argument('--jobs', type=int, default=3)
    ap.add_argument('--out', default='ropecheck_report.md')
    a = ap.parse_args()
    chrome = next((c for c in CHROME if os.path.exists(c)), None)
    if not chrome:
        sys.exit('找不到 Chrome')
    runs = [(m, s) for m in a.match for s in a.seeds.split(',')]
    def job(rs):
        m, s = rs
        return m, s, run_one(chrome, os.path.abspath(a.html), 'demo=%d&dump=1&ropecheck=1&ship=%s&seed=%s' % (a.secs, m, s), a.secs * 1000 + 60000)
    with ThreadPoolExecutor(a.jobs) as ex:
        res = list(ex.map(job, runs))
    stat, dyn, bad, nrun = {}, {}, [], {}
    for m, s, R in res:
        if not R:
            bad.append('%s seed %s' % (m, s)); continue
        for sh in R:
            h = sh['hull']; stat.setdefault(h, sh['stat']); nrun[h] = nrun.get(h, 0) + 1
            for f in sh['float']:
                d = dyn.setdefault(h, {}).setdefault(cat(f['why']), {})
                e = d.setdefault(f['name'] + ' #' + str(f['end']), {'n': 0, 't': [], 'why': f['why'], 'P': f['P'], 'kind': f['kind']})
                e['n'] += 1; e['t'].append(f['t'])
    L = ['# 繩的檢查報告（浮空的纜線）', '',
         '- 成品：`%s`' % (os.path.relpath(a.html, HERE) if os.path.splitdrive(os.path.abspath(a.html))[0].lower() == os.path.splitdrive(HERE)[0].lower() else os.path.abspath(a.html)).replace('\\', '/'),   # 不同磁碟 ⇒ relpath 會丟錯（成品放在 C:、工具在 D:）
         '- 每局 %d 秒；對戰：%s；種子：%s；共 %d 局（讀不到 %d 局%s）' % (a.secs, '、'.join(a.match), a.seeds, len(runs), len(bad), '：' + '、'.join(bad) if bad else ''),
         '- 浮空 ＝ 繩還活著，可是有一端撐它的東西沒了（判斷在 js/10_ship.js ropesFloating）。每局每半秒量一次，每條繩只記第一次。', '']
    total = sum(e['n'] for h in dyn for c in dyn[h] for e in dyn[h][c].values())
    L.append('**結果：%s**' % ('沒有浮空的繩 ✓' if not total else '%d 次浮空（照繩數，每局每條算一次）' % total))
    L.append('')
    for h in sorted(stat):
        st = stat[h]
        L += ['## %s（%d 局）' % (h, nrun.get(h, 0)), '',
              '作品本身：%d 條繩；每一端靠什麼 —— %s。開戰那一刻浮空：%d。端點離錨 > 2 格的端：%d（下面列前 20；遊戲照「離錨的距離 ＋ 1 格」判斷，不會因為這個誤判，但雕刻那邊把繩端拉到碰到東西比較穩）。' % (
                  st['ropes'], '、'.join('%s %d' % (k, v) for k, v in st['ends'].items()), len(st['floatAtStart']), len(st['far'])), '']
        if st['far']:
            L += ['| 繩 | 端 | 離錨（格） | 端點（格座標） |', '|---|---|---|---|'] + ['| %s | %d | %s | %s |' % (f['name'], f['end'], f['d0'], ','.join(map(str, f['P']))) for f in sorted(st['far'], key=lambda f: -f['d0'])[:20]] + ['']
        D = dyn.get(h, {})
        if not D:
            L += ['打起來：沒有浮空的繩 ✓', '']
            continue
        for c in sorted(D):
            es = sorted(D[c].items(), key=lambda kv: (-kv[1]['n'], kv[0]))
            L += ['### %s（%d 條）' % (c, len(es)), '', '| 繩 #端 | 幾局 | 最早幾秒 | 原因 | 端點 |', '|---|---|---|---|---|']
            L += ['| %s | %d | %.1f | %s | %s |' % (k, e['n'], min(e['t']), e['why'], ','.join(map(str, e['P']))) for k, e in es[:40]]
            if len(es) > 40:
                L.append('| …還有 %d 條 | | | | |' % (len(es) - 40))
            L.append('')
    open(a.out, 'w', encoding='utf-8', newline='\n').write('\n'.join(L) + '\n')
    print('寫了 %s：%d 局（讀不到 %d）、浮空 %d 次' % (a.out, len(runs), len(bad), total))


if __name__ == '__main__':
    main()
