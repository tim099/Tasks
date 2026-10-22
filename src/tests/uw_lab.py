# 落水彈道的測試場（TASK-0642；遊戲那側在 js/80_lab.js）。只讀成品、不改東西。
#   跑：python -I -X utf8 src/tests/uw_lab.py [--html <成品>] [--hulls virginia,constitution,monitor] [--q "guns=dahl11,long&short=0,5"] [--out <資料夾>] [--jobs 3]
# 每艘靶船：無頭 Chrome 開成品 ?lab=uw&ship=<靶船>,<另一艘>&<q>，讀 <pre id="lab">。
# 寫：<out>/uw_lab.json（每一發原樣，含軌跡）、<out>/uw_lab.md（表）、<out>/uw_<靶船>.svg（側視圖：水平 ＝ 離水線那一點幾公尺，垂直 ＝ 離海面幾公尺）。
import argparse, html, json, os, re, shutil, subprocess, tempfile
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_HTML = os.path.normpath(os.path.join(HERE, '..', '..', 'index.html'))
CHROME = [r'C:\Program Files\Google\Chrome\Application\chrome.exe', r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe']
OTHER = {'constitution': 'ember'}                                      # 另一艘（只是湊滿兩艘、會被移到遠處）；沒寫 ⇒ 憲法號
COL = ['#c0392b', '#2471a3', '#1e8449', '#b9770e', '#7d3c98', '#555555', '#17a589', '#a04000']


def run_one(chrome, page, hull, q):
    prof = tempfile.mkdtemp(prefix='uwlab_')
    try:
        url = 'file:///' + page.replace('\\', '/') + '?lab=uw&ship=%s,%s%s' % (hull, OTHER.get(hull, 'constitution'), '&' + q if q else '')
        r = subprocess.run([chrome, '--headless=new', '--no-first-run', '--user-data-dir=' + prof, '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                            '--virtual-time-budget=600000', '--dump-dom', url], capture_output=True, timeout=1800)
        m = re.findall(r'<pre id="lab">(.*?)</pre>', r.stdout.decode('utf-8', 'replace'), re.S)   # 取最後一個（成品內嵌程式；⛔ 註解裡別寫那個標籤的原文）
        return hull, json.loads(html.unescape(m[-1])) if m else None
    finally:
        shutil.rmtree(prof, ignore_errors=True)


def svg(L, path):
    """側視圖：每種砲一個顏色、每一發一條線；水下那一段實線加粗、空中虛線；× ＝ 打到船殼。只畫離船殼 −6～40 m、海面上 6 m 到水下 8 m。"""
    W, H, x0, x1, y0, y1 = 900, 420, -6.0, 40.0, -8.0, 6.0
    def X(a): return 60 + (x1 - a) / (x1 - x0) * (W - 80)
    def Y(y): return 20 + (y1 - y) / (y1 - y0) * (H - 60)
    o = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" font-family="sans-serif" font-size="12">' % (W, H), '<rect width="100%%" height="100%%" fill="#fff"/>',
         '<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="#d6eaf8"/>' % (60, Y(0), W - 80, Y(y0) - Y(0)),
         '<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="#8d6e63" opacity="0.5"/>' % (X(0), 20, X(x0) - X(0), H - 60)]
    for a in range(0, 41, 5):
        o.append('<line x1="%.1f" y1="20" x2="%.1f" y2="%d" stroke="#ccc"/><text x="%.1f" y="%d" text-anchor="middle">%d</text>' % (X(a), X(a), H - 40, X(a), H - 24, a))
    for y in range(-8, 7, 2):
        o.append('<text x="52" y="%.1f" text-anchor="end">%d</text>' % (Y(y) + 4, y))
    o.append('<text x="%d" y="%d" text-anchor="middle">離水線那一點（m，往船外）　｜　船殼（棕）在右側 0 以內</text>' % (W // 2, H - 6))
    guns = []
    for c in L['cases']:
        if c['gun'] not in guns: guns.append(c['gun'])
    for c in L['cases']:
        col = COL[guns.index(c['gun']) % len(COL)]
        pts = [(a, y, w) for a, y, w in c.get('tr', []) if x0 - 2 <= a <= x1 + 5]
        for (a, y, w), (b, z, w2) in zip(pts, pts[1:]):
            if max(y, z) < y0 - 2 or min(y, z) > y1 + 2: continue
            o.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="%s"%s/>' % (X(a), Y(max(y0 - 1, min(y1 + 1, y))), X(b), Y(max(y0 - 1, min(y1 + 1, z))), col, '2.2' if w2 else '1', '' if w2 else ' stroke-dasharray="4 3"'))
        if c.get('hit'):
            hx, hy = X(c['hit']['at']), Y(-c['hit']['depth'])
            o.append('<text x="%.1f" y="%.1f" fill="%s" text-anchor="middle" font-size="14">×</text>' % (hx, hy + 5, col))
    o.append('<rect x="62" y="21" width="%d" height="40" fill="#fff" opacity="0.88"/>' % (W - 84))   # 圖例底下墊白，不跟線疊在一起
    for k, g in enumerate(guns):
        o.append('<rect x="%d" y="26" width="12" height="12" fill="%s"/><text x="%d" y="36">%s</text>' % (70 + k * 130, COL[k % len(COL)], 86 + k * 130, g))
    o.append('<text x="%d" y="54" fill="#333">%s　R %s m、砲口高 %s m、海況 %s　（虛線 ＝ 空中、粗線 ＝ 水下、× ＝ 打到船殼）</text>' % (70, L['hull'], L['o']['R'], L['o']['h0'], L['sea']))
    o.append('</svg>')
    open(path, 'w', encoding='utf-8').write('\n'.join(o))


def table(L):
    rows = ['| 砲 | 彈重 kg | 落在前面 m | 水漂 m | 入水 m/s | 入水角 ° | 水下走 m | 打到船殼 | 水面下 m | 打到時 m/s | 掉格 | 鐵甲 | 結果 |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|']
    for c in L['cases']:
        if c.get('err'):
            rows.append('| %s | | %s | | | | | ✗ %s | | | | | |' % (c['gun'], c.get('short', ''), c['err'])); continue
        e, h = c.get('entry') or {}, c.get('hit') or {}
        rows.append('| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |' % (
            c['gun'], c['m'], c['short'], c.get('skip', '—'), e.get('v', '—'), e.get('deg', '—'), c['uw'] if c.get('entry') else '—',
            ('水下' if h.get('wet') else '水上') if h else '沒有', h.get('depth', '—') if h else '—', h.get('v', '—') if h else '—', c['removed'], c['res'] or '—', c['end']))
    return '\n'.join(rows)


def main():
    ap = argparse.ArgumentParser(description='落水彈道的測試場')
    ap.add_argument('--html', default=OUT_HTML)
    ap.add_argument('--hulls', default='virginia,constitution,monitor')
    ap.add_argument('--q', default='')
    ap.add_argument('--out', default='.')
    ap.add_argument('--jobs', type=int, default=3)
    a = ap.parse_args()
    chrome = next(c for c in CHROME if os.path.exists(c))
    os.makedirs(a.out, exist_ok=True)
    hulls = [h for h in a.hulls.split(',') if h]
    with ThreadPoolExecutor(a.jobs) as ex:
        res = dict(ex.map(lambda h: run_one(chrome, os.path.abspath(a.html), h, a.q), hulls))
    json.dump(res, open(os.path.join(a.out, 'uw_lab.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    md = ['# 落水彈道的測試場', '', '參數：`%s`' % (a.q or '（預設）'), '']
    for h in hulls:
        L = res.get(h)
        if not L:
            md += ['## %s' % h, '', '✗ 讀不到（船沒載完或頁面出錯）', '']; continue
        svg(L, os.path.join(a.out, 'uw_%s.svg' % h))
        md += ['## %s' % h, '', '浮穩 %s 秒：sink %s、橫傾 %s°、縱傾 %s°；海況 %s' % (L['settle']['t'], L['settle']['sink'], L['settle']['roll'], L['settle']['pitch'], L['sea']), '',
               table(L), '', '共掉 %s 格。' % L['removed'] + ('之後照常走 %s 秒：進水 %s 噸（艙裡現有 %s 噸）、破口 %s、sink %s、橫傾 %s°' % (
                   L['flood']['t'], L['flood']['inTot'], L['flood']['tonnes'], L['flood']['holes'], L['flood']['sink'], L['flood']['roll']) if L.get('flood') else ''), '']
        print('==', h, 'cases', len(L['cases']), 'removed', L['removed'], 'flood', L.get('flood'))
    open(os.path.join(a.out, 'uw_lab.md'), 'w', encoding='utf-8').write('\n'.join(md))


if __name__ == '__main__':
    main()
