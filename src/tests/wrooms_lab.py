# 水的房間的報表（TASK-0807；遊戲那側在 js/81_floodlab.js wroomsLab、js/33_wrooms.js）。只讀成品、不改東西。
#   Tim 2026-10-22：「可以額外加上debug資訊輸出排查（寫檔 也可以圖片化輸出模擬結果）」
#   跑：python -I -X utf8 src/tests/wrooms_lab.py [--html <成品>] [--hulls constitution,dingyuan]（不給 ＝ 全部）[--q "dz=6&px=2"] [--tag now] [--out <資料夾>] [-j 3]
# 每艘船：無頭 Chrome 開成品 ?lab=wrooms&ship=<船>&cache=0&<q>（cache=0 ⇒ 每次現算、量得到切了幾 ms），讀 <pre id="lab">。
# 寫：<out>/<tag>/wrooms_<船>.json（讀數、艙房對照，不含圖）、<out>/<tag>/img/<船>_side.png、<船>_z<層>.png、<out>/<tag>/index.html（總表＋每艘的側視、俯視、艙房對照）。
#   圖的顏色：每間房一色（照編號，⛔ 不代表大小）；紅 ＝ 旁邊的接口、黃 ＝ 上下的接口（正上方是別間）、白框 ＝ 作者標的艙房、深灰 ＝ 不是艙內的空氣。
import argparse, base64, html, json, os, re, shutil, subprocess, tempfile
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_HTML = os.path.normpath(os.path.join(HERE, '..', '..', 'index.html'))
OUT_DIR = os.path.normpath(os.path.join(HERE, '..', '..', 'reports', 'wrooms'))
GAME = os.path.normpath(os.path.join(HERE, '..', 'config', 'game.json'))
CHROME = [r'C:\Program Files\Google\Chrome\Application\chrome.exe', r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe']


def run_one(chrome, page, hull, q):
    prof = tempfile.mkdtemp(prefix='wrooms_')
    try:
        url = 'file:///' + page.replace('\\', '/') + '?lab=wrooms&ship=%s&cache=0%s' % (hull, '&' + q if q else '')
        r = subprocess.run([chrome, '--headless=new', '--no-first-run', '--user-data-dir=' + prof, '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                            '--window-size=1280,800', '--virtual-time-budget=120000', '--dump-dom', url], capture_output=True, timeout=600)
        m = re.findall(r'<pre id="lab">(.*?)</pre>', r.stdout.decode('utf-8', 'replace'), re.S)   # 取最後一個（⛔ 註解裡別寫那個標籤的原文）
        return hull, json.loads(html.unescape(m[-1])) if m else None
    finally:
        shutil.rmtree(prof, ignore_errors=True)


def png(d, name, url):
    with open(os.path.join(d, name), 'wb') as f:
        f.write(base64.b64decode(url.split(',', 1)[1]))
    return name


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--html', default=OUT_HTML)
    ap.add_argument('--hulls', default='')
    ap.add_argument('--q', default='')
    ap.add_argument('--tag', default='now')
    ap.add_argument('--out', default=OUT_DIR)
    ap.add_argument('-j', type=int, default=3)
    a = ap.parse_args()
    chrome = next((c for c in CHROME if os.path.exists(c)), None)
    if not chrome:
        raise SystemExit('找不到 Chrome')
    hulls = [h for h in a.hulls.split(',') if h] or [s['id'] for s in json.load(open(GAME, encoding='utf-8'))['ships']]
    d = os.path.join(a.out, a.tag)
    os.makedirs(os.path.join(d, 'img'), exist_ok=True)
    with ThreadPoolExecutor(max_workers=max(1, a.j)) as ex:
        res = list(ex.map(lambda h: run_one(chrome, a.html, h, a.q), hulls))
    rows, secs, LAT, VOL = [], [], [], []
    for hull, R in res:
        if R and not R.get('err'):
            LAT += (R['info'].get('calib') or {}).get('lat', []); VOL += (R['info'].get('calib') or {}).get('vol', [])
        if not R or R.get('err'):
            rows.append('<tr><td>%s</td><td colspan="9">✗ %s</td></tr>' % (html.escape(hull), html.escape((R or {}).get('err', '沒讀到 #lab'))))
            print('✗', hull, (R or {}).get('err', '沒讀到 #lab'))
            continue
        I, C = R['info'], R.get('cabins') or []
        side = png(d, 'img/%s_side.png' % hull, R['side'])
        sl = [(s['z'], png(d, 'img/%s_z%03d.png' % (hull, s['z']), s['img'])) for s in R['slices']]
        R2 = dict(R); R2.pop('side'); R2['slices'] = [s['z'] for s in R['slices']]
        with open(os.path.join(d, 'wrooms_%s.json' % hull), 'w', encoding='utf-8', newline='\n') as f:
            json.dump(R2, f, ensure_ascii=False, indent=1)
        ms = I.get('ms') or {}
        ok = sum(1 for c in C if c['ok'])
        rows.append('<tr><td><a href="#%s">%s</a></td><td>%d</td><td>%d</td><td>%.1f</td><td>%d／%.1f</td><td>%d／%.1f</td><td>%.1f</td><td>%s</td><td>%s</td></tr>' % (
            hull, html.escape(R.get('name') or hull), I['rooms'], I['ge1m3'], I['air'], I['vert']['n'], I['vert']['m2'], I['side']['n'], I['side']['m2'],
            sum(ms.values()), '%d／%d' % (ok, len(C)) if C else '—', html.escape(', '.join(str(v) for v in I['top'][:4]))))
        cab = ''.join('<tr><td>%s</td><td>%d</td><td>%d</td><td>%.3f</td><td>%.2f</td><td>%s</td></tr>' % (html.escape(c['name'].split('/')[-1]), c['air'], c['room'], c['frac'], c['big'], '✓' if c['ok'] else '✗') for c in C)
        secs.append('<h2 id="%s">%s（%s）</h2><p>參數 %s；切了 %s ms；雜湊 %s</p><p>側視（x 往右、z 往上）：<br><img src="%s"></p>%s<details><summary>俯視（每 %d 層）</summary>%s</details>' % (
            hull, html.escape(R.get('name') or hull), hull, html.escape(json.dumps(I.get('par'))), html.escape(json.dumps(ms)), I.get('hash'), side,
            ('<table><tr><th>艙房</th><th>空氣格</th><th>房間</th><th>占幾成</th><th>房間 ÷ 框</th><th></th></tr>%s</table>' % cab) if C else '<p>沒有標艙房</p>',
            R['o']['dz'], ''.join('<p>z %d<br><img src="%s"></p>' % (z, n) for z, n in sl)))
        print('✓', hull, I['rooms'], '間', '艙房 %d／%d' % (ok, len(C)) if C else '')
    def hist(a, edges):                                                    # 校準用的分布：每一格 [下界, 上界) 幾個
        c = [0] * (len(edges) + 1)
        for v in a:
            c[sum(1 for e in edges if v >= e)] += 1
        lab = ['< %g' % edges[0]] + ['%g–%g' % (edges[i], edges[i + 1]) for i in range(len(edges) - 1)] + ['≥ %g' % edges[-1]]
        return lab, c
    def htab(lc):
        return '<table><tr>%s</tr><tr>%s</tr></table>' % (''.join('<th>%s</th>' % l for l in lc[0]), ''.join('<td>%d</td>' % n for n in lc[1]))
    HL, HV = hist(LAT, [0.5, 1, 1.5, 2, 2.5, 3, 4, 6, 10, 20]), hist(VOL, [0.01, 0.1, 0.25, 0.5, 1, 2, 5, 20, 100])
    calib = ('<h2>校準（%d 艘合起來）</h2><p>旁邊的接口：併之前每一對房間的面積（m²；WR_JOIN 照門那一群與大開口之間定）</p>%s'
             '<p>房間大小：併小空腔之前（m³；WR_MIN 照它定）</p>%s') % (len([1 for h, R in res if R and not R.get('err')]), htab(HL), htab(HV))
    print('旁邊接口 m²：', ' '.join('%s:%d' % (l, n) for l, n in zip(*HL)))
    print('房間大小 m³：', ' '.join('%s:%d' % (l, n) for l, n in zip(*HV)))
    page = ('<!doctype html><meta charset="utf-8"><title>水的房間 %s</title><style>body{font:14px sans-serif;background:#1d1d20;color:#ddd}table{border-collapse:collapse}td,th{border:1px solid #555;padding:2px 6px}img{image-rendering:pixelated;max-width:100%%}a{color:#8cf}</style>'
            '<h1>水的房間（%s）</h1><p>紅 ＝ 旁邊的接口、黃 ＝ 上下的接口、白框 ＝ 作者標的艙房、深灰 ＝ 不是艙內的空氣；每間房一色（照編號）。</p>'
            '<table><tr><th>船</th><th>房間</th><th>≥1 m³</th><th>艙內空氣 m³</th><th>上下接口 條／m²</th><th>旁邊接口 條／m²</th><th>切 ms（⚠ 無頭 Chrome 凍住時間 ⇒ 0，要在瀏覽器量）</th><th>艙房自成一間</th><th>最大幾間 m³</th></tr>%s</table>%s%s') % (
        a.tag, a.tag, ''.join(rows), calib, ''.join(secs))
    with open(os.path.join(d, 'index.html'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(page)
    print('→', os.path.join(d, 'index.html'))


if __name__ == '__main__':
    main()
