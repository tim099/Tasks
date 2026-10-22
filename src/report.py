# 《憲法號對轟》戰鬥報表的多場分析（TASK-0620；報表本身在 js/79_report.js）。只讀、不改東西。
#   跑：python -I report.py [--html <成品>] [--secs 180] [--seeds 1,2,3] [--match virginia,constitution …] [--jobs 3] [--out report.md] [--raw report_raw.json]
#   讀：python -I report.py --files <遊戲裡匯出的 .json> …（結束畫面「📊 報表 → 匯出 JSON」那一份；不跑 Chrome）
# 每局：無頭 Chrome 開成品 ?demo=<秒>&dump=1&report=1&ship=<對陣>&seed=<種子>，讀 #dump 裡的 report。
# 報告照船型（vxk id）彙整，同一型不分藍紅：
#   · 每 30 秒一格的平均曲線：能打的船員（佔開局人數）、開得動的砲（可開＋裝填＋等火藥，佔砲數）、累計命中率、被打掉的格數、進水。
#   · 砲為什麼沒在開：還在的砲、船出局前，六種狀態各佔多少時間（可開／裝填／沒人／等火藥／泡水；可開 ＝ 裝好了但沒有目標或在等齊射）。
#   · 砲被打掉：每局平均幾門、最早第幾秒（中位數）；被打中的落點（砲／模型／裝甲／船殼／友艦）；傷亡原因。
# ⚠ 同時開太多 Chrome 會有一局船沒載完（--jobs 預設 3）；讀不到的那一局照實列在報告裡。
import argparse, html, json, os, re, subprocess, sys, tempfile, shutil, statistics
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_HTML = os.path.normpath(os.path.join(HERE, '..', 'index.html'))
CHROME = [r'C:\Program Files\Google\Chrome\Application\chrome.exe', r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe']
ST = ['可開', '裝填', '沒人', '沒了', '等火藥', '泡水']                 # 跟 79_report.js RPT_ST 同一個順序
ON = {'gun': '砲', 'model': '模型', 'armor': '裝甲', 'hull': '船殼', 'ff': '友艦', 'uw': '水下'}


def run_one(chrome, page, q, budget):
    prof = tempfile.mkdtemp(prefix='report_')
    try:
        url = 'file:///' + page.replace('\\', '/') + '?' + q
        r = subprocess.run([chrome, '--headless=new', '--no-first-run', '--user-data-dir=' + prof, '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                            '--virtual-time-budget=%d' % budget, '--dump-dom', url], capture_output=True, timeout=1800)
        m = re.search(r'<pre id="dump">(.*?)</pre>', r.stdout.decode('utf-8', 'replace'), re.S)
        return json.loads(html.unescape(m.group(1))).get('report') if m else None
    except Exception:
        return None
    finally:
        shutil.rmtree(prof, ignore_errors=True)


def at(tl, I, t):
    """時間線在第 t 秒的那一列（取 ≤ t 的最後一列；船還沒進場 ⇒ None）。"""
    row = None
    for r in tl:
        if r[I['t']] <= t:
            row = r
        else:
            break
    return row


def pct(a, b):
    return '%d%%' % round(a * 100 / b) if b else '—'


def analyse(games, secs):
    """games：[(標籤, report)]；回 markdown。"""
    by = {}
    for tag, R in games:
        I = {c: j for j, c in enumerate(R['cols'])}
        for s in R['ships']:
            by.setdefault((s['id'], s['name']), []).append((tag, R, I, s))
    out = ['# 戰鬥報表彙整', '', '局數 %d：%s' % (len(games), '、'.join(t for t, _ in games)), '']
    grid = list(range(30, secs + 1, 30))                                # 第一列在第 RPT_EVERY 秒 ⇒ 從 30 秒起
    for (sid, name), L in sorted(by.items()):
        out += ['## %s（%s）—— %d 艘次' % (name, sid, len(L)), '']
        fired = sum(s['fired'] for _, _, _, s in L); hits = sum(s['hits'] for _, _, _, s in L)
        out.append('- 開火 %d、命中 %d（%s）；每艘次平均開火 %.1f、被打中 %.1f' % (fired, hits, pct(hits, fired), fired / len(L), sum(s['taken'] for _, _, _, s in L) / len(L)))
        on, ton = {}, {}
        for _, _, _, s in L:
            for g in s['guns']:
                for w, n in g['on'].items():
                    on[w] = on.get(w, 0) + n
            for w, n in s['takenOn'].items():
                ton[w] = ton.get(w, 0) + n
        out.append('- 打中什麼：' + ('、'.join('%s %d' % (ON.get(w, w), n) for w, n in sorted(on.items(), key=lambda x: -x[1])) or '—'))
        out.append('- 被打中在哪：' + ('、'.join('%s %d' % (ON.get(w, w), n) for w, n in sorted(ton.items(), key=lambda x: -x[1])) or '—'))
        st = [0.0] * 6
        for _, _, _, s in L:
            for g in s['guns']:
                for j, v in enumerate(g['st']):
                    st[j] += v
        live = sum(st[j] for j in (0, 1, 2, 4, 5))
        out.append('- 砲的時間（還在的砲、出局前）：' + '／'.join('%s %s' % (ST[j], pct(st[j], live)) for j in (0, 1, 2, 4, 5)))
        bear = sum(g.get('bear', 0) for _, _, _, s in L for g in s['guns'])   # 79_report.js bear：可開的時間裡目標在射界內
        out.append('  - 其中「可開」：目標在射界內 %s、敵艦不在射界 %s（佔可開的時間）' % (pct(bear, st[0]), pct(st[0] - bear, st[0])))
        gone = [g['goneAt'] for _, _, _, s in L for g in s['guns'] if g['goneAt'] is not None]
        first = [min(g['goneAt'] for g in s['guns'] if g['goneAt'] is not None) for _, _, _, s in L if any(g['goneAt'] is not None for g in s['guns'])]
        ng = len(L[0][3]['guns'])
        out.append('- 砲被打掉：每艘次平均 %.1f／%d 門%s' % (len(gone) / len(L), ng, '；第一門被打掉的時間中位數 %.0f 秒（%d 艘次有）' % (statistics.median(first), len(first)) if first else ''))
        cz, wd, dd, c0 = {}, 0, 0, 0
        for _, _, _, s in L:
            wd += s['wounds']; dd += s['dead']; c0 += s['crew0']
            for k, n in s['causes'].items():
                cz[k] = cz.get(k, 0) + n
        out.append('- 傷亡：每艘次受傷 %.1f、陣亡 %.1f（開局 %.0f 人）；原因：%s' % (wd / len(L), dd / len(L), c0 / len(L), '、'.join('%s %d' % kv for kv in sorted(cz.items(), key=lambda x: -x[1])) or '—'))
        out += ['', '| 秒 | 能打的船員 | 開得動的砲 | 累計命中率 | 被打掉的格數 | 進水（噸） | 還在場 |', '|---|---|---|---|---|---|---|']
        for t in grid:
            rows = [(s, at(s['tl'], I, t), I) for _, R, I, s in L if (s['out'] is None or s['out'] >= t)]
            rows = [(s, r, I) for s, r, I in rows if r is not None]
            if not rows:
                out.append('| %d | — | — | — | — | — | 0 |' % t)
                continue
            n = len(rows)
            able = sum(r[I['able']] / max(1, s['crew0']) for s, r, I in rows) / n
            ops = sum((r[I['ready']] + r[I['reload']] + r[I['powder']]) / max(1, len(s['guns'])) for s, r, I in rows) / n
            f2 = sum(r[I['fired']] for s, r, I in rows); h2 = sum(r[I['hits']] for s, r, I in rows)
            out.append('| %d | %s | %s | %s | %.0f | %.0f | %d |' % (t, pct(able, 1), pct(ops, 1), pct(h2, f2), sum(r[I['lost']] for s, r, I in rows) / n, sum(r[I['water']] for s, r, I in rows) / n, n))
        out.append('')
    return '\n'.join(out)


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser(description='戰鬥報表：多場彙整')
    ap.add_argument('--html', default=OUT_HTML)
    ap.add_argument('--secs', type=int, default=180)
    ap.add_argument('--seeds', default='1,2,3')
    ap.add_argument('--match', nargs='*', default=['virginia,constitution', 'constitution,ember'])
    ap.add_argument('--jobs', type=int, default=3)
    ap.add_argument('--files', nargs='*', help='讀遊戲裡匯出的 .json，不跑 Chrome')
    ap.add_argument('--out', default='report.md')
    ap.add_argument('--raw', help='每局的 report 原樣存一份（JSON）')
    a = ap.parse_args()
    games, bad = [], []
    if a.files:
        for p in a.files:
            with open(p, encoding='utf-8') as f:
                games.append((os.path.basename(p), json.load(f)))
        secs = int(max(R['t'] for _, R in games))
    else:
        chrome = next((c for c in CHROME if os.path.exists(c)), None)
        if not chrome:
            sys.exit('找不到 Chrome')
        runs = [(m, s) for m in a.match for s in a.seeds.split(',')]
        def job(rs):
            m, s = rs
            return m, s, run_one(chrome, os.path.abspath(a.html), 'demo=%d&dump=1&report=1&ship=%s&seed=%s' % (a.secs, m, s), a.secs * 1000 + 60000)
        with ThreadPoolExecutor(a.jobs) as ex:
            for m, s, R in ex.map(job, runs):
                (games.append(('%s seed %s' % (m, s), R)) if R else bad.append('%s seed %s' % (m, s)))
        secs = a.secs
    if not games:
        sys.exit('一局都沒讀到報表' + ('（讀不到：%s）' % '、'.join(bad) if bad else ''))
    md = analyse(games, secs) + ('\n⚠ 讀不到報表的局（船沒載完或 Chrome 逾時）：%s\n' % '、'.join(bad) if bad else '')
    with open(a.out, 'w', encoding='utf-8') as f:
        f.write(md)
    if a.raw:
        with open(a.raw, 'w', encoding='utf-8') as f:
            json.dump([{'tag': t, 'report': R} for t, R in games], f, ensure_ascii=False)
    print(md)


if __name__ == '__main__':
    main()
