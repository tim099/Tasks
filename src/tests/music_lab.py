# 背景音樂試聽＋量（TASK-0677）：無頭 Chrome 開成品，經 DevTools 協定呼叫 __game.bgmRender（02_music.js：OfflineAudioContext 離線錄），
#   每一首錄三段：只有旋律、只有低音（量音高）、兩聲部（試聽、量音頭），寫成 WAV＋一頁可以直接播的 HTML。
# 量的是錄出來的聲音（⛔ 不是播放器排程的清單 —— 那是同一條路）：
#   音高：每個音取音頭後 60 ms 起、最長 300 ms 的一段，自相關找週期（拋物線內插）⇒ 跟樂譜的音高差幾 cent。
#   音頭：不看樂譜，從音量包絡（5 ms 一格）找突起 ⇒ 再跟樂譜的音頭配對（±30 ms 內）：配到幾個、時間差、照時間擬一條直線 ⇒ 速度差幾 %。
# 用法：python -I -X utf8 src/tests/music_lab.py --tag a [--tunes drunken,rio] [--html <成品>]
# 寫：<out>/<tag>/<曲>_<段>.wav、<out>/<tag>/index.html、<out>/<tag>/report.json。
import argparse, base64, html, importlib.util, io, json, os, shutil, subprocess, tempfile, time, urllib.request, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('ambient_lab', os.path.join(HERE, 'ambient_lab.py')); AL = importlib.util.module_from_spec(spec); spec.loader.exec_module(AL)   # DevTools 的 WebSocket 跟環境音試聽共用
OUT_DIR = os.path.normpath(os.path.join(HERE, '..', '..', 'reports', 'music_lab'))
PORT = 9348


def pcm(data_url):
    raw = base64.b64decode(data_url.split(',', 1)[1])
    with wave.open(io.BytesIO(raw)) as w:
        sr = w.getframerate(); x = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').reshape(-1, w.getnchannels()).astype(np.float64) / 32768
    return sr, x.mean(axis=1), raw


def f0(seg, sr, fexp):
    seg = seg - seg.mean(); n = len(seg)
    ac = np.fft.irfft(np.abs(np.fft.rfft(seg, 2 * n)) ** 2)[:n]
    lo, hi = int(sr / (fexp * 1.9)), int(sr / (fexp / 1.9)) + 1             # 只在 ±1.9 倍裡找（⛔ 不放到整個八度：自相關在兩倍週期也有峰）
    hi = min(hi, n - 2); k = lo + int(np.argmax(ac[lo:hi]))
    a, b, c = ac[k - 1], ac[k], ac[k + 1]; d = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) != 0 else 0
    return sr / (k + d)


def pitches(sr, x, notes):
    out = []
    for t, d, p, v, *_ in notes:
        a = int((t + 0.06) * sr); b = int((t + min(0.06 + 0.3, d * 0.85)) * sr)
        if b - a < int(0.04 * sr): continue                              # 太短（< 40 ms）不量
        fe = 440 * 2 ** ((p - 69) / 12); f = f0(x[a:b], sr, fe)
        out.append([t, p, round(1200 * np.log2(f / fe), 2)])
    return out


def onsets(sr, x, notes):
    hop = int(0.005 * sr); n = len(x) // hop
    env = np.sqrt(np.array([np.mean(x[i * hop:(i + 1) * hop] ** 2) for i in range(n)]) + 1e-12)
    db = 20 * np.log10(env)
    det = []
    for i in range(6, n - 2):                                            # 突起：這一格比前 30 ms 的最低點高 6 dB 以上、而且是附近 20 ms 裡升最快的那一格
        if db[i] - db[i - 6:i].min() < 6: continue
        g = db[i] - db[i - 1]
        if g <= 0 or g < max(db[j] - db[j - 1] for j in range(max(1, i - 2), min(n, i + 3))): continue
        if det and i * hop / sr - det[-1] < 0.04: continue
        det.append(i * hop / sr)
    exp = sorted(set(round(t, 4) for t, d, p, v, *_ in notes))
    pair = []; used = set()
    for t in exp:
        best = None
        for k, s in enumerate(det):
            if k in used or abs(s - t) > 0.03: continue
            if best is None or abs(s - t) < abs(det[best] - t): best = k
        if best is not None: used.add(best); pair.append([t, det[best]])
    P = np.array(pair) if pair else np.zeros((0, 2))
    slope = float(np.polyfit(P[:, 0], P[:, 1], 1)[0]) if len(P) > 2 else None
    err = (P[:, 1] - P[:, 0]) if len(P) else np.zeros(0)
    return {'expected': len(exp), 'detected': len(det), 'matched': len(pair), 'extra': len(det) - len(pair),
            'errMeanMs': round(float(np.mean(err)) * 1000, 1) if len(err) else None, 'errMaxMs': round(float(np.max(np.abs(err - np.mean(err)))) * 1000, 1) if len(err) else None,
            'tempoErrPct': round((slope - 1) * 100, 3) if slope else None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--html', default=AL.OUT_HTML); ap.add_argument('--tag', default='run'); ap.add_argument('--out', default=OUT_DIR); ap.add_argument('--tunes', default='')
    a = ap.parse_args()
    chrome = next(c for c in AL.CHROME if os.path.exists(c))
    url = 'file:///' + a.html.replace('\\', '/') + '?debug=1'
    prof = tempfile.mkdtemp(prefix='muslab_')
    p = subprocess.Popen([chrome, '--headless=new', '--no-first-run', '--user-data-dir=' + prof, '--remote-debugging-port=%d' % PORT, '--remote-allow-origins=*', url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    R = []
    try:
        for _ in range(100):
            try: tabs = json.load(urllib.request.urlopen('http://127.0.0.1:%d/json' % PORT, timeout=2)); break
            except OSError: time.sleep(0.2)
        page = next(t for t in tabs if t.get('type') == 'page'); ws = AL.WS(page['webSocketDebuggerUrl'])
        def ev(expr, aw=False):
            r = ws.call('Runtime.evaluate', {'expression': expr, 'awaitPromise': aw, 'returnByValue': True})['result']
            if 'exceptionDetails' in r: raise RuntimeError(json.dumps(r['exceptionDetails'], ensure_ascii=False)[:800])
            return r['result'].get('value')
        for _ in range(300):
            if ev('typeof (window.__game && __game.bgmRender)') == 'function': break
            time.sleep(0.2)
        ids = a.tunes.split(',') if a.tunes else ev('__game.bgm().tunes')
        for tid in ids:
            for solo, nm in ((0, 'mel'), (1, 'bass'), (None, 'mix')):
                o = {'id': tid};
                if solo is not None: o['solo'] = solo
                R.append([tid, nm, json.loads(ev('__game.bgmRender(%s).then(function (r) { return JSON.stringify(r); })' % json.dumps(o), True))])
    finally:
        p.terminate()
        try: p.wait(10)
        except subprocess.TimeoutExpired: p.kill()
        shutil.rmtree(prof, ignore_errors=True)
    d = os.path.join(a.out, a.tag); os.makedirs(d, exist_ok=True)
    rep = {}; rows = []
    for tid, nm, r in R:
        sr, x, raw = pcm(r['wav']); fn = '%s_%s.wav' % (tid, nm)
        with open(os.path.join(d, fn), 'wb') as f: f.write(raw)
        row = {'peak': r['peak'], 'rmsDb': r['rmsDb'], 'sec': round(len(x) / sr, 2), 'notes': len(r['notes'])}
        if nm in ('mel', 'bass'):
            pc = pitches(sr, x, r['notes']); c = [abs(q[2]) for q in pc]
            row.update({'pitchN': len(pc), 'centMax': max(c) if c else None, 'centMean': round(float(np.mean(c)), 2) if c else None, 'over10': [q for q in pc if abs(q[2]) >= 10][:6]})
        if nm in ('mel', 'mix'): row['onset'] = onsets(sr, x, r['notes'])
        rep.setdefault(tid, {})[nm] = row
        print('%-11s %-4s 峰值 %.3f RMS %6.1f dB  %s' % (tid, nm, r['peak'], r['rmsDb'], json.dumps({k: v for k, v in row.items() if k not in ('peak', 'rmsDb')}, ensure_ascii=False)))
        rows.append('<tr><td>%s</td><td>%s</td><td><audio controls preload="none" src="%s"></audio></td><td><pre>%s</pre></td></tr>' % (tid, nm, fn, html.escape(json.dumps(row, ensure_ascii=False, indent=1))))
    with open(os.path.join(d, 'report.json'), 'w', encoding='utf-8', newline='\n') as f: json.dump(rep, f, ensure_ascii=False, indent=1)
    with open(os.path.join(d, 'index.html'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('<!doctype html><meta charset="utf-8"><title>背景音樂試聽 %s</title><style>body{font:14px sans-serif;margin:16px}td{padding:4px 10px;border-bottom:1px solid #ccc;vertical-align:top}pre{margin:0;font-size:12px}</style><h3>背景音樂試聽（%s）</h3><table>%s</table>' % (a.tag, a.tag, ''.join(rows)))
    print('寫了', os.path.join(d, 'index.html'))


if __name__ == '__main__':
    raise SystemExit(main())
