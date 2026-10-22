# 環境音試聽（TASK-0663）：無頭 Chrome 開成品，經 DevTools 協定呼叫 ambLab（02_ambient.js：OfflineAudioContext 離線錄）⇒ 每一段寫成 WAV＋一頁可以直接播的 HTML。
# 用法：python -I -X utf8 src/tests/ambient_lab.py --tag a [--sec 10] [--cases "名字:w:sea:rain:hold;…"]
# 寫：<out>/<tag>/<序號>_<名字>.wav、<out>/<tag>/index.html（每一段：播放器｜參數｜峰值｜RMS dB）。
# ⛔ 不用 --dump-dom：離線錄音在音訊執行緒上跑，無頭模式的虛擬時間不等它（量過：頁面載入 3 秒就 dump、#lab 還沒寫）⇒ 改走 Runtime.evaluate（awaitPromise）。
#   DevTools 的 WebSocket 只用標準函式庫（socket）寫最小的一段：送一個文字訊框、收到回應（可能分好幾個訊框、好幾 MB）。
import argparse, base64, html, json, os, re, shutil, socket, struct, subprocess, tempfile, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = [r'C:\Program Files\Google\Chrome\Application\chrome.exe', r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe']
OUT_HTML = os.path.normpath(os.path.join(HERE, '..', '..', 'index.html'))
OUT_DIR = os.path.normpath(os.path.join(HERE, '..', '..', 'reports', 'ambient_lab'))
PORT = 9347


class WS:
    def __init__(self, url):
        u = urllib.parse.urlparse(url)
        self.s = socket.create_connection((u.hostname, u.port), timeout=600)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall(('GET %s HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n' % (u.path, u.hostname, u.port, key)).encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            buf += self.s.recv(4096)
        self.rest = buf.split(b'\r\n\r\n', 1)[1]
        self.n = 0

    def _read(self, k):
        while len(self.rest) < k:
            c = self.s.recv(1 << 20)
            if not c:
                raise IOError('DevTools 連線斷了')
            self.rest += c
        out, self.rest = self.rest[:k], self.rest[k:]
        return out

    def send(self, obj):
        data = json.dumps(obj).encode(); mask = os.urandom(4); n = len(data)
        hdr = struct.pack('!B', 0x81) + (struct.pack('!B', 0x80 | n) if n < 126 else struct.pack('!BH', 0x80 | 126, n) if n < 65536 else struct.pack('!BQ', 0x80 | 127, n))
        self.s.sendall(hdr + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv(self):
        msg = b''
        while True:
            b0, b1 = self._read(2)
            n = b1 & 0x7f
            if n == 126: n = struct.unpack('!H', self._read(2))[0]
            elif n == 127: n = struct.unpack('!Q', self._read(8))[0]
            msg += self._read(n)
            if b0 & 0x80: return json.loads(msg.decode('utf-8'))

    def call(self, method, params):
        self.n += 1; self.send({'id': self.n, 'method': method, 'params': params})
        while True:
            r = self.recv()
            if r.get('id') == self.n: return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--html', default=OUT_HTML)
    ap.add_argument('--tag', default='run')
    ap.add_argument('--out', default=OUT_DIR)
    ap.add_argument('--sec', type=float, default=10)
    ap.add_argument('--cases', default='')
    a = ap.parse_args()
    chrome = next(c for c in CHROME if os.path.exists(c))
    q = 'sec=%g' % a.sec + ('&cases=' + urllib.parse.quote(a.cases) if a.cases else '')
    url = 'file:///' + a.html.replace('\\', '/') + '?debug=1'               # __game 只在 debug=1 才掛（成品的程式整包在一個閉包裡，ambLab 不在 window 上）
    prof = tempfile.mkdtemp(prefix='amblab_')
    p = subprocess.Popen([chrome, '--headless=new', '--no-first-run', '--user-data-dir=' + prof, '--remote-debugging-port=%d' % PORT, '--remote-allow-origins=*', url],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                tabs = json.load(urllib.request.urlopen('http://127.0.0.1:%d/json' % PORT, timeout=2)); break
            except OSError:
                time.sleep(0.2)
        page = next(t for t in tabs if t.get('type') == 'page')
        ws = WS(page['webSocketDebuggerUrl'])
        for _ in range(300):                                            # 等成品載入（__game.ambLab 掛好）
            if ws.call('Runtime.evaluate', {'expression': 'typeof (window.__game && __game.ambLab)', 'returnByValue': True})['result']['result'].get('value') == 'function': break
            time.sleep(0.2)
        r = ws.call('Runtime.evaluate', {'expression': '__game.ambLab(%s).then(function (R) { return JSON.stringify(R); })' % json.dumps(q), 'awaitPromise': True, 'returnByValue': True})
        if 'exceptionDetails' in r.get('result', {}):
            print('頁面丟出例外：', json.dumps(r['result']['exceptionDetails'], ensure_ascii=False)[:800]); return 1
        R = json.loads(r['result']['result']['value'])
    finally:
        p.terminate()
        try: p.wait(10)
        except subprocess.TimeoutExpired: p.kill()
        shutil.rmtree(prof, ignore_errors=True)
    d = os.path.join(a.out, a.tag); os.makedirs(d, exist_ok=True)
    rows = []
    for k, c in enumerate(R):
        name = '%02d_%s.wav' % (k + 1, re.sub(r'[\\/:*?"<>|・ ]+', '_', c['name']))
        with open(os.path.join(d, name), 'wb') as f:
            f.write(base64.b64decode(c['wav'].split(',', 1)[1]))
        o = c['o']
        print('%-14s w %-5s sea %-4s rain %s hold %s  峰值 %.3f  RMS %s dB  %s' % (c['name'], o.get('w'), o.get('sea'), o.get('rain'), o.get('hold'), c['peak'], c['rmsDb'], name))
        rows.append('<tr><td>%s</td><td><audio controls preload="none" src="%s"></audio></td><td>w %s・海況 %s・雨 %s・船艙 %s</td><td>%.3f</td><td>%s</td></tr>' % (
            html.escape(c['name']), name, o.get('w'), o.get('sea'), o.get('rain'), o.get('hold'), c['peak'], c['rmsDb']))
    with open(os.path.join(d, 'index.html'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('<!doctype html><meta charset="utf-8"><title>環境音試聽 %s</title><style>body{font:14px sans-serif;margin:16px}td,th{padding:4px 10px;border-bottom:1px solid #ccc}</style>'
                '<h3>環境音試聽（%s，每段 %g 秒）</h3><table><tr><th>段落</th><th>播放</th><th>參數</th><th>峰值</th><th>RMS dB</th></tr>%s</table>' % (a.tag, a.tag, a.sec, ''.join(rows)))
    print('寫了', os.path.join(d, 'index.html'))


if __name__ == '__main__':
    raise SystemExit(main())
