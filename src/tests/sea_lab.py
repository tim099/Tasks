# 海面試驗場（Tim 2026-10-17「分析海面吧 是否可以用noise避免這種重複紋路」）：無頭 Chrome 開成品，同一個種子、同一刻、同一個鏡頭拍海面，
#   每一組覆寫（__game.seaDbg：det 漣漪道數、an 解析浪的法線倍率、以及之後加的雜訊參數）各拍一張，量「重不重複」：
#   ① 自相關：亮度（去平均、Hann 窗）跟自己平移後比 ⇒ 離中心 ≥ 8 px 的最高峰（0–1；越高 ＝ 越像一格一格重複）
#   ② 頻譜集中：|FFT|² 最強的 50 格占全部（拿掉 |f| < 3 的低頻）的比例（越高 ＝ 能量越集中在幾道正弦 ＝ 越規則）
#   量的是拍出來的畫面（⛔ 不是公式），只取畫面下 55%（海面、沒有天空）。
# 用法：python -I -X utf8 src/tests/sea_lab.py --tag a [--cases <JSON 檔>] [--html <成品>]
#   cases：[{ "name", "gfx": "high", "dbg": {…}, "cam": "graze"|"mid"|{tgt,yaw,pitch,dist} }]；不給 ⇒ 預設三組 × 兩個鏡頭。
import argparse, base64, importlib.util, io, json, os, shutil, subprocess, tempfile, time, urllib.request
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('ambient_lab', os.path.join(HERE, 'ambient_lab.py')); AL = importlib.util.module_from_spec(spec); spec.loader.exec_module(AL)
OUT_DIR = os.path.normpath(os.path.join(HERE, '..', '..', 'reports', 'sea_lab'))
PORT = 9351
CAMS = {'graze': {'tgt': [600, 0, 600], 'yaw': -2.356, 'pitch': 0.10, 'dist': 90},   # 低角度看遠
        'mid': {'tgt': [600, 0, 600], 'yaw': -2.356, 'pitch': 0.32, 'dist': 60},     # 斜一點看中景（Tim 截圖那種菱形格子）
        'top': {'tgt': [600, 0, 600], 'yaw': -2.356, 'pitch': 1.45, 'dist': 45}}     # 幾乎正上方：沒有透視 ⇒ 世界裡的格子在頻譜上是乾淨的峰（斜看的時候遠近間距不同、峰被抹開）
BANDS = {'graze': (300, 560), 'mid': (170, 470), 'top': (60, 740)}                   # 量哪幾列（800 高的畫面；紋路最明顯的那一段）
DEF = [{'name': 'cur', 'gfx': 'high', 'dbg': {}}, {'name': 'noDet', 'gfx': 'high', 'dbg': {'det': 0}}, {'name': 'detOnly', 'gfx': 'high', 'dbg': {'an': 0}}]


def gblur(a, s):
    """可分離的高斯模糊（邊緣照邊緣延伸）。"""
    r = int(3 * s); k = np.exp(-0.5 * (np.arange(-r, r + 1) / s) ** 2); k /= k.sum()
    b = np.pad(a, ((r, r), (r, r)), mode='edge')
    b = np.apply_along_axis(lambda v: np.convolve(v, k, mode='valid'), 1, b)
    return np.apply_along_axis(lambda v: np.convolve(v, k, mode='valid'), 0, b)


def metrics(img, band):
    """band ＝ (上, 下) 列：只量有紋路的那一段。先高通（減掉 σ 10 px 的模糊）⇒ 遠近的亮度漸層不算 —— ⛔ 第一版沒高通：漸層自己跟自己像，連沒有漣漪的都量到 0.998。"""
    a = np.asarray(img.convert('L'), dtype=np.float64)[band[0]:band[1], :]
    a = a - gblur(a, 10)
    a = a - a.mean(); wy = np.hanning(a.shape[0])[:, None]; wx = np.hanning(a.shape[1])[None, :]; a = a * wy * wx
    P = np.abs(np.fft.fft2(a)) ** 2
    ac = np.fft.fftshift(np.real(np.fft.ifft2(P))); cy, cx = np.array(ac.shape) // 2; ac = ac / ac[cy, cx]
    yy, xx = np.ogrid[:ac.shape[0], :ac.shape[1]]; r = np.hypot(yy - cy, xx - cx)
    Ps = np.fft.fftshift(P); Ps[r < 3] = 0; flat = np.sort(Ps.ravel())[::-1]
    # 「重複」＝ 自相關離開中心之後**掉下去又回來**的峰（⛔ 第二版拿 r ≥ 6 的最大值：橫向拉長的亮紋平移 6 px 幾乎不變 ⇒ 量到的是拉長，不是重複）：
    #   3×3 的局部最大、離中心 ≥ 6 px、從中心連過去的直線上最低點比它低 0.15 以上 ⇒ 算一個二次峰；回報最高的那個（沒有 ⇒ 0）。
    best = 0.0; H2, W2 = ac.shape
    loc = (ac >= np.roll(ac, 1, 0)) & (ac >= np.roll(ac, -1, 0)) & (ac >= np.roll(ac, 1, 1)) & (ac >= np.roll(ac, -1, 1)) & (r >= 6) & (ac > 0.05)
    for y, x in zip(*np.nonzero(loc)):
        v = ac[y, x]
        if v <= best: continue
        n = int(max(abs(y - cy), abs(x - cx))) + 1; ys = np.linspace(cy, y, n * 2).round().astype(int); xs = np.linspace(cx, x, n * 2).round().astype(int)
        if ac[ys, xs].min() < v - 0.15: best = float(v)
    return {'acPeak': round(best, 4), 'top50': round(float(flat[:50].sum() / flat.sum()), 4), 'hpStd': round(float(a.std()), 3)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--html', default=AL.OUT_HTML); ap.add_argument('--tag', default='run'); ap.add_argument('--out', default=OUT_DIR); ap.add_argument('--cases', default='')
    ap.add_argument('--cams', default='graze,mid'); ap.add_argument('--t', type=float, default=4)
    a = ap.parse_args()
    cases = json.load(open(a.cases, encoding='utf-8')) if a.cases else DEF
    chrome = next(c for c in AL.CHROME if os.path.exists(c))
    url = 'file:///' + a.html.replace('\\', '/') + '?debug=1&seed=3'
    prof = tempfile.mkdtemp(prefix='sealab_')
    p = subprocess.Popen([chrome, '--headless=new', '--no-first-run', '--user-data-dir=' + prof, '--remote-debugging-port=%d' % PORT, '--remote-allow-origins=*',
                          '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800', url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    shots = []
    try:
        for _ in range(100):
            try: tabs = json.load(urllib.request.urlopen('http://127.0.0.1:%d/json' % PORT, timeout=2)); break
            except OSError: time.sleep(0.2)
        ws = AL.WS(next(t for t in tabs if t.get('type') == 'page')['webSocketDebuggerUrl'])
        def ev(expr):
            r = ws.call('Runtime.evaluate', {'expression': expr, 'awaitPromise': True, 'returnByValue': True})['result']
            if 'exceptionDetails' in r: raise RuntimeError(json.dumps(r['exceptionDetails'], ensure_ascii=False)[:800])
            return r['result'].get('value')
        for _ in range(300):
            if ev('typeof (window.__game && __game.seaDbg)') == 'function': break
            time.sleep(0.2)
        for k in range(120):                                             # 船型還在載入 ⇒ 開局會丟錯（spawnFleet 讀不到船型）⇒ 等一下再試
            try: ev("__game.start('sandbox'); 1"); break
            except RuntimeError:
                if k == 119: raise
                time.sleep(0.5)
        ev('__game.run(%g); 1' % a.t)
        for c in cases:
            for cn in a.cams.split(','):
                cam = dict(CAMS[cn]) if isinstance(c.get('cam', cn), str) else c['cam']
                js = "__game.gfx(%s); __game.seaDbg(%s); __game.cam(Object.assign({mode:0, track:false}, %s)); __game.cam({}); document.getElementById('cv').toDataURL('image/png')" % (
                    json.dumps(c.get('gfx', 'high')), json.dumps(c.get('dbg', {})), json.dumps(cam))
                shots.append([c['name'], cn, ev(js)])
        ev('__game.seaDbg({}); 1')
    finally:
        p.terminate()
        try: p.wait(10)
        except subprocess.TimeoutExpired: p.kill()
        shutil.rmtree(prof, ignore_errors=True)
    d = os.path.join(a.out, a.tag); os.makedirs(d, exist_ok=True); rep = []; rows = []
    for name, cn, url in shots:
        img = Image.open(io.BytesIO(base64.b64decode(url.split(',', 1)[1]))).convert('RGB'); fn = '%s_%s.png' % (name, cn); img.save(os.path.join(d, fn))
        m = metrics(img, BANDS[cn]); m.update({'name': name, 'cam': cn, 'img': fn}); rep.append(m)
        print('%-12s %-6s 自相關峰 %.4f  頻譜前50格 %.4f  高通標準差 %.3f  %s' % (name, cn, m['acPeak'], m['top50'], m['hpStd'], fn))
        rows.append('<tr><td>%s<br>%s</td><td><img src="%s" width="640"></td><td><pre>%s</pre></td></tr>' % (name, cn, fn, json.dumps(m, indent=1)))
    with open(os.path.join(d, 'report.json'), 'w', encoding='utf-8', newline='\n') as f: json.dump(rep, f, indent=1)
    with open(os.path.join(d, 'index.html'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('<!doctype html><meta charset="utf-8"><title>海面試驗場 %s</title><style>body{font:14px sans-serif;margin:16px}td{padding:4px 10px;border-bottom:1px solid #ccc;vertical-align:top}</style><table>%s</table>' % (a.tag, ''.join(rows)))
    print('寫了', os.path.join(d, 'index.html'))


if __name__ == '__main__':
    raise SystemExit(main())
