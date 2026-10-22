# 艦隊指揮官 AI 的自動調參（TASK-0687；Tim 2026-10-17「自動調參（最推薦，先做這個）」）。
#   可調的參數表在 js/55_tune.js（TUNE_DEF；這裡從頁面讀，不另抄一份）；每一方可以各自覆寫一組 ⇒「候選」對「基準（全照預設）」打。
#   一場 ＝ 擬真沙盒（84_fleetlab.js）跑遊戲本體的模擬、不畫畫面；這裡開 N 個無頭 Chrome（file:/// 開成品），用 Chrome 的除錯協定（CDP）塞工作、讀結果
#   （頁面不自己連線：成品零外部依賴）。
#
# 跑：
#   python -I tune.py bench [--workers 4] [--suite base] [--seeds 2]        基準對基準：量每小時幾場、分數的雜訊（應該在 0 附近）
#   python -I tune.py run   [--workers 4] [--gens 12] [--lam 10] [--sigma 0.2] [--suite base] [--seeds 1]   CMA-ES 找參數
#   python -I tune.py check --params best.json [--workers 4] [--suite base] [--seeds 6] [--seed0 1000]     留出的種子上驗（沒用來調的）
#   python -I tune.py check --cand-strat auto [--workers 1] ...      候選那一方換一個策略（例：auto ＝ 推演，TASK-0688）對基準照場景的策略打；--params 可以不給（覆寫全照預設）
#   共同：--hz 20（物理步長；60 ＝ 跟遊戲逐步相同、慢 3 倍）--tmax 300（時限秒）--play fun|real --out <資料夾>（預設暫存資料夾）--html <成品>
#         --normal：Chrome 用一般優先權（預設閒置優先權 ⇒ 有人在用電腦就讓路；Tim 2026-10-17「目前PC太卡了」「晚上休息時再慢慢跑」）
# 量過（2026-10-17，24 核的那台、旁邊還開著別的 Chrome）：2 個工作者每小時 114 場、6 個 243–388 場（每個 3.3 倍速）、12 個 200 場（每個 1.4 倍速，CPU 滿了）⇒ 6 個左右就到頂。
# 分數（候選那一方看）：(候選剩的戰力 − 基準剩的戰力) ÷ 每方艘數，−1…1；戰力 ＝ flabResult 的 pow（cmdStrength 加總，跟 #dump 同一把尺）。
#   每個場景兩邊各當一次（候選當藍、當紅）⇒ 開局位置、風向的偏差抵掉。
# 輸出（--out）：matches.jsonl（每一場：場景、哪一方是候選、覆寫、結果）、gens.jsonl（每一代：平均、最好的、參數）、best.json（最好的那組覆寫）。
import argparse, base64, json, math, os, queue, random, shutil, socket, struct, subprocess, sys, tempfile, threading, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_HTML = os.path.normpath(os.path.join(HERE, '..', 'index.html'))
CHROME = [r'C:\Program Files\Google\Chrome\Application\chrome.exe', r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe']

# 評測組：一個場景 ＝ 每方幾艘、船型、兩方用的策略（同一個）、開局距離。風向照種子輪（0／90／180／270）、風速 1。
SUITES = {
    'base': [
        {'n': 1, 'hull': 'constitution', 'strat': 'pair', 'dist': 200},
        {'n': 2, 'hull': 'constitution', 'strat': 'pair', 'dist': 400},
        {'n': 3, 'hull': 'constitution', 'strat': 'focus', 'dist': 600},
        {'n': 3, 'hull': 'constitution', 'strat': 'line', 'dist': 800},
    ],
    'small': [
        {'n': 1, 'hull': 'constitution', 'strat': 'pair', 'dist': 200},
        {'n': 2, 'hull': 'constitution', 'strat': 'pair', 'dist': 400},
    ],
}


# ── 最小的 WebSocket 用戶端（CDP 用；標準函式庫，不加依賴） ──
class WS:
    def __init__(self, url, timeout=60):
        assert url.startswith('ws://')
        hp, path = url[5:].split('/', 1)
        host, port = hp.split(':')
        self.s = socket.create_connection((host, int(port)), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall(('GET /%s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n' % (path, hp, key)).encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            c = self.s.recv(4096)
            if not c:
                raise IOError('websocket 握手斷線')
            buf += c
        head, self.rest = buf.split(b'\r\n\r\n', 1)
        if b' 101 ' not in head.split(b'\r\n')[0]:
            raise IOError('websocket 握手失敗：' + head.split(b'\r\n')[0].decode('latin1'))

    def _read(self, n):
        out = self.rest[:n]; self.rest = self.rest[n:]
        while len(out) < n:
            c = self.s.recv(max(65536, n - len(out)))
            if not c:
                raise IOError('websocket 斷線')
            out += c
        if len(out) > n:
            self.rest = out[n:] + self.rest; out = out[:n]
        return out

    def send(self, text):
        p = text.encode('utf-8'); m = os.urandom(4); L = len(p)
        h = bytes([0x81]) + (bytes([0x80 | L]) if L < 126 else bytes([0x80 | 126]) + struct.pack('>H', L) if L < 65536 else bytes([0x80 | 127]) + struct.pack('>Q', L))
        self.s.sendall(h + m + bytes(b ^ m[i & 3] for i, b in enumerate(p)))

    def recv(self):
        msg = b''
        while True:
            b0, b1 = self._read(2)
            op, L = b0 & 15, b1 & 127
            if L == 126: L = struct.unpack('>H', self._read(2))[0]
            elif L == 127: L = struct.unpack('>Q', self._read(8))[0]
            mk = self._read(4) if b1 & 128 else None
            p = self._read(L)
            if mk: p = bytes(b ^ mk[i & 3] for i, b in enumerate(p))
            if op == 9:                                                     # ping ⇒ pong
                self.s.sendall(bytes([0x8A, 0x80 | len(p)]) + b'\0\0\0\0' + p); continue
            if op == 8:
                raise IOError('websocket 被關')
            msg += p
            if b0 & 128:
                return msg.decode('utf-8')

    def close(self):
        try: self.s.close()
        except Exception: pass


def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


class Worker:
    """一個無頭 Chrome ＋ 它那一頁的 CDP 連線。"""
    def __init__(self, k, chrome, url, idle=True):
        self.k, self.chrome, self.url, self.p, self.ws, self.prof, self.mid, self.idle = k, chrome, url, None, None, None, 0, idle

    def start(self):
        self.stop()
        self.prof = tempfile.mkdtemp(prefix='tune_w%d_' % self.k); port = free_port()
        self.p = subprocess.Popen([self.chrome, '--headless=new', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + self.prof,
                                   '--remote-debugging-port=%d' % port, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio',
                                   '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
                                   self.url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                  creationflags=getattr(subprocess, 'IDLE_PRIORITY_CLASS', 0) if self.idle else 0)   # 閒置優先權（子程序跟著）：有人在用電腦就讓路（Tim 2026-10-17「目前PC太卡了」）
        t0 = time.time()
        while True:                                                         # 等除錯埠起來、找到那一頁
            try:
                L = json.loads(urllib.request.urlopen('http://127.0.0.1:%d/json/list' % port, timeout=2).read())
                pg = [t for t in L if t.get('type') == 'page' and 'index.html' in t.get('url', '')]
                if pg:
                    self.ws = WS(pg[0]['webSocketDebuggerUrl']); break
            except Exception:
                pass
            if time.time() - t0 > 60:
                raise IOError('工作者 %d：Chrome 60 秒內沒起來' % self.k)
            time.sleep(0.5)
        while not self.ev("!!(window.__game && __game.flab && __game.flab.job)"):   # 等頁面載完（船型、沙盒）
            if time.time() - t0 > 240:
                raise IOError('工作者 %d：頁面 240 秒內沒載完' % self.k)
            time.sleep(1)

    def ev(self, expr, await_promise=False):
        self.mid += 1
        self.ws.send(json.dumps({'id': self.mid, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'returnByValue': True, 'awaitPromise': await_promise}}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get('id') == self.mid:
                r = m.get('result', {})
                if 'exceptionDetails' in r:
                    raise RuntimeError(json.dumps(r['exceptionDetails'])[:400])
                return r.get('result', {}).get('value')

    def stop(self):
        if self.ws: self.ws.close(); self.ws = None
        if self.p:                                                          # 整棵程序樹一起收（⛔ 只 kill 主程序 ⇒ renderer、GPU 那些子程序留著吃 CPU：量過 6 個工作者留下 30 個）
            try:
                if os.name == 'nt': subprocess.run(['taskkill', '/PID', str(self.p.pid), '/T', '/F'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
                else: self.p.kill()
                self.p.wait(10)
            except Exception: pass
            self.p = None
        if self.prof: shutil.rmtree(self.prof, ignore_errors=True); self.prof = None


class Pool:
    """N 個工作者；run(jobs) ⇒ 每份工作的結果（照原本的順序）。出錯、逾時 ⇒ 重開那個工作者、那份工作重發（最多 3 次）。"""
    def __init__(self, n, chrome, url, job_timeout, log, idle=True):
        self.ws = [Worker(k, chrome, url, idle) for k in range(n)]; self.job_timeout = job_timeout; self.log = log
        self.n_done = 0; self.sim_s = 0.0; self.t0 = time.time()

    def run(self, jobs, on_done=None):
        q = queue.Queue(); res = [None] * len(jobs); lock = threading.Lock()
        for i, j in enumerate(jobs): q.put((i, j, 0))

        def loop(w):
            while True:
                try: i, j, tries = q.get_nowait()
                except queue.Empty: return
                try:
                    if w.p is None or w.p.poll() is not None: w.start()
                    w.ev('__game.flab.job(%s)' % json.dumps(j), True); t0 = time.time()
                    while True:
                        d = w.ev("(function(){ var d = __game.flab.done(); return window.__flabErr ? { err: window.__flabErr } : d && d.id === %s ? d : null; })()" % json.dumps(j['id']))
                        if d and d.get('err'): raise RuntimeError('頁面出錯：' + d['err'])
                        if d: break
                        if time.time() - t0 > self.job_timeout: raise RuntimeError('逾時 %d 秒' % self.job_timeout)
                        time.sleep(0.5)
                    with lock:
                        res[i] = d; self.n_done += 1; self.sim_s += d['res']['t']
                        if on_done: on_done(j, d)                       # 一場打完就寫（⛔ 整批跑完才寫 ⇒ 2026-10-18 白天那輪中途停掉，跑了一個多小時一筆都沒留下）
                except Exception as e:
                    self.log('⚠ 工作者 %d、工作 %s（第 %d 次）：%s ⇒ 重開' % (w.k, j['id'], tries + 1, str(e)[:200]))
                    w.stop()
                    if tries < 2: q.put((i, j, tries + 1))
                    else:
                        self.log('✗ 工作 %s 放棄' % j['id'])
                        if on_done:
                            with lock: on_done(j, None)                 # 放棄的那場也留一列（以前整批寫時 res 是 None 也照寫）

        T = [threading.Thread(target=loop, args=(w,), daemon=True) for w in self.ws]
        for t in T: t.start()
        for t in T: t.join()
        return res

    def close(self):
        profs = [w.prof for w in self.ws if w.prof]
        for w in self.ws: w.stop()
        # 補掃：照設定檔資料夾找還活著的 Chrome（⛔ 只靠 taskkill /T：2026-10-18 整晚那次 check 收尾漏了 4 棵 32 個程序，單獨測 taskkill 三次都乾淨，根因沒抓到）
        if os.name == 'nt' and profs:
            q = ' -or '.join("$_.CommandLine -like '*%s*'" % os.path.basename(p) for p in profs)
            try:
                r = subprocess.run(['powershell', '-NoProfile', '-Command', "$p = @(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { %s }); $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; $p.Count" % q],
                                   capture_output=True, text=True, timeout=120)
                n = int((r.stdout.strip() or '0').splitlines()[-1])
                if n:
                    self.log('⚠ 收尾：taskkill 之後還有 %d 個 Chrome 程序活著 ⇒ 照設定檔資料夾補收' % n); time.sleep(2)
            except Exception as e:
                self.log('⚠ 收尾補掃失敗：%s' % str(e)[:200])
            for p in profs: shutil.rmtree(p, ignore_errors=True)

    def rate(self):
        h = (time.time() - self.t0) / 3600
        return self.n_done / h if h > 0 else 0


def scen_jobs(suite, seeds, seed0, cand, hz, tmax, tag, cstrat=None):
    """一組參數（cand：覆寫 dict）對基準的全部工作：每個場景 × 每個種子 × 候選當藍／當紅。cstrat：候選那一方改用的策略（None ＝ 照場景）。"""
    J = []
    for si, sc in enumerate(SUITES[suite]):
        for k in range(seeds):
            seed = seed0 + k
            for side in ('blue', 'red'):
                p = {'blue': {'n': sc['n'], 'hull': sc['hull'], 'strat': sc['strat'], 'gauge': False}, 'red': {'n': sc['n'], 'hull': sc['hull'], 'strat': sc['strat'], 'gauge': False},
                     'dist': sc['dist'], 'wdir': (seed * 90) % 360, 'wspd': 1, 'seed': seed, 'hz': hz, 'tmax': tmax}
                tune = {'blue': cand if side == 'blue' else None, 'red': cand if side == 'red' else None}
                if cstrat: p[side]['strat'] = cstrat
                J.append({'id': '%s-s%d-%d-%s' % (tag, si, seed, side), 'p': p, 'tune': tune, 'side': side, 'scen': si, 'n': sc['n']})
    return J


def score(job, d):
    """候選那一方看的分數：(候選剩的戰力 − 基準剩的戰力) ÷ 每方艘數。"""
    if not d: return None
    r = d['res']; me = job['side']; ot = 'red' if me == 'blue' else 'blue'
    return (r['pow'][me] - r['pow'][ot]) / job['n']


def summarize(jobs, res):
    S = [score(j, d) for j, d in zip(jobs, res)]; S = [s for s in S if s is not None]
    win = sum(1 for j, d in zip(jobs, res) if d and d['res']['winner'] == j['side']); lose = sum(1 for j, d in zip(jobs, res) if d and d['res']['winner'] and d['res']['winner'] != j['side'])
    m = sum(S) / len(S) if S else float('nan'); sd = (sum((s - m) ** 2 for s in S) / max(1, len(S) - 1)) ** 0.5 if len(S) > 1 else float('nan')
    return {'n': len(S), 'mean': m, 'se': sd / max(1, len(S)) ** 0.5 if S else float('nan'), 'win': win, 'lose': lose, 'missing': len(jobs) - len(S)}


class Out:
    def __init__(self, path):
        self.dir = path or os.path.join(tempfile.gettempdir(), 'blockside_tune', time.strftime('%Y%m%d-%H%M%S'))
        os.makedirs(self.dir, exist_ok=True)
        self.mf = open(os.path.join(self.dir, 'matches.jsonl'), 'a', encoding='utf-8'); self.gf = open(os.path.join(self.dir, 'gens.jsonl'), 'a', encoding='utf-8')
        self.lf = open(os.path.join(self.dir, 'log.txt'), 'a', encoding='utf-8')

    def log(self, s):
        line = time.strftime('%H:%M:%S ') + s; print(line, flush=True); self.lf.write(line + '\n'); self.lf.flush()

    def match1(self, j, d):
        self.matches([j], [d])

    def matches(self, jobs, res):
        for j, d in zip(jobs, res):
            self.mf.write(json.dumps({'job': {k: j[k] for k in ('id', 'side', 'scen', 'n', 'tune', 'p')}, 'score': score(j, d), 'res': d and d['res'], 'applied': d and d['tune']}, ensure_ascii=False) + '\n')
        self.mf.flush()

    def gen(self, o):
        self.gf.write(json.dumps(o, ensure_ascii=False) + '\n'); self.gf.flush()


def get_def(pool):
    w = pool.ws[0]
    if w.p is None: w.start()
    D = w.ev('__game.flab.tuneDef()')
    return [(k, v[0], v[1], v[2], v[3]) for k, v in D.items()]


def cmd_bench(a, pool, out):
    jobs = scen_jobs(a.suite, a.seeds, a.seed0, None, a.hz, a.tmax, 'bench')
    t0 = time.time(); res = pool.run(jobs, out.match1); dt = time.time() - t0
    S = summarize(jobs, res)
    sim = sum(d['res']['t'] for d in res if d)
    out.log('基準對基準：%d 場（缺 %d）、%.0f 秒、每小時 %.0f 場、模擬 %.0f 秒（%.1f 倍速 × %d 工作者）；分數平均 %+.3f ± %.3f（應該在 0 附近）、藍贏 %d／紅贏 %d'
            % (S['n'], S['missing'], dt, S['n'] / dt * 3600, sim, sim / dt / len(pool.ws), len(pool.ws), S['mean'], S['se'],
               sum(1 for d in res if d and d['res']['winner'] == 'blue'), sum(1 for d in res if d and d['res']['winner'] == 'red')))
    for si, sc in enumerate(SUITES[a.suite]):
        R = [d['res'] for j, d in zip(jobs, res) if d and j['scen'] == si]
        out.log('  場景 %d（%d 對 %d %s %s %d m）：平均 %.0f 秒、每場 %.0f 秒實際' % (si, sc['n'], sc['n'], sc['hull'], sc['strat'], sc['dist'], sum(r['t'] for r in R) / max(1, len(R)), sum(r['ms'] for r in R) / 1000 / max(1, len(R))))


def cmd_run(a, pool, out):
    import numpy as np
    D = get_def(pool); keys = [d[0] for d in D]; lo = np.array([d[2] for d in D], float); hi = np.array([d[3] for d in D], float); x0 = np.array([d[1] for d in D], float)
    out.log('參數表（js/55_tune.js）：' + '、'.join('%s=%g［%g, %g］' % (d[0], d[1], d[2], d[3]) for d in D))
    n = len(keys); lam = a.lam; mu = lam // 2
    w = np.log(mu + 0.5) - np.log(np.arange(1, mu + 1)); w /= w.sum(); mueff = 1 / (w ** 2).sum()
    cc = (4 + mueff / n) / (n + 4 + 2 * mueff / n); cs = (mueff + 2) / (n + mueff + 5); c1 = 2 / ((n + 1.3) ** 2 + mueff)
    cmu = min(1 - c1, 2 * (mueff - 2 + 1 / mueff) / ((n + 2) ** 2 + mueff)); damps = 1 + 2 * max(0, math.sqrt((mueff - 1) / (n + 1)) - 1) + cs; chiN = n ** 0.5 * (1 - 1 / (4 * n) + 1 / (21 * n * n))
    m = (x0 - lo) / (hi - lo); sigma = a.sigma; C = np.eye(n); pc = np.zeros(n); ps = np.zeros(n); rng = np.random.default_rng(a.rseed)
    best = (-1e9, None)

    def to_params(z):
        v = lo + np.clip(z, 0, 1) * (hi - lo)
        return {k: round(float(x), 4) for k, x in zip(keys, v)}

    for g in range(a.gens):
        Dm, Bm = np.linalg.eigh(C); Dm = np.sqrt(np.maximum(Dm, 1e-20)); Z = rng.standard_normal((lam, n)); Y = Z @ np.diag(Dm) @ Bm.T; X = m + sigma * Y
        cands = [to_params(x) for x in X]; seed0 = a.seed0 + g * a.seeds                     # 每一代換一批種子（同一代的候選用同一批 ⇒ 比得公平）
        jobs = []; owner = []
        for ci, c in enumerate(cands):
            J = scen_jobs(a.suite, a.seeds, seed0, c, a.hz, a.tmax, 'g%d-c%d' % (g, ci)); jobs += J; owner += [ci] * len(J)
        t0 = time.time(); res = pool.run(jobs, out.match1)
        F = []
        for ci in range(lam):
            S = summarize([j for j, o in zip(jobs, owner) if o == ci], [d for d, o in zip(res, owner) if o == ci]); F.append(S)
        fit = np.array([f['mean'] if f['n'] else -1 for f in F]); order = np.argsort(-fit)
        if fit[order[0]] > best[0]: best = (float(fit[order[0]]), cands[order[0]])
        out.gen({'gen': g, 'seed0': seed0, 'sigma': sigma, 'mean_params': to_params(m), 'fit': [F[i] for i in range(lam)], 'cands': cands, 'best_gen': cands[order[0]], 'best_fit': float(fit[order[0]])})
        out.log('第 %d 代：%d 場 %.0f 秒；分數 最好 %+.3f、中位 %+.3f、最差 %+.3f；σ %.3f；每小時 %.0f 場' % (g, len(jobs), time.time() - t0, fit[order[0]], float(np.median(fit)), fit[order[-1]], sigma, pool.rate()))
        out.log('   最好的：' + '、'.join('%s=%g' % (k, v) for k, v in cands[order[0]].items() if abs(v - dict((d[0], d[1]) for d in D)[k]) > 1e-9))
        sel = X[order[:mu]]; ysel = (sel - m) / sigma; m_old = m; m = w @ sel
        Cinvsqrt = Bm @ np.diag(1 / Dm) @ Bm.T
        ps = (1 - cs) * ps + math.sqrt(cs * (2 - cs) * mueff) * Cinvsqrt @ ((m - m_old) / sigma)
        hsig = np.linalg.norm(ps) / math.sqrt(1 - (1 - cs) ** (2 * (g + 1))) / chiN < 1.4 + 2 / (n + 1)
        pc = (1 - cc) * pc + hsig * math.sqrt(cc * (2 - cc) * mueff) * (m - m_old) / sigma
        C = (1 - c1 - cmu) * C + c1 * (np.outer(pc, pc) + (1 - hsig) * cc * (2 - cc) * C) + cmu * (ysel.T * w) @ ysel
        sigma *= math.exp((cs / damps) * (np.linalg.norm(ps) / chiN - 1))
        json.dump({'mean': to_params(m), 'best_seen': best[1], 'best_seen_fit': best[0], 'gen': g}, open(os.path.join(out.dir, 'best.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    out.log('完成：分佈的中心（建議拿去 check 的那組）寫在 %s/best.json 的 mean；單代最好的 best_seen 分數 %+.3f（同一批種子上量的，偏樂觀）' % (out.dir, best[0]))


def cmd_check(a, pool, out):
    if a.params: P = json.load(open(a.params, encoding='utf-8')); cand = P.get(a.key) if a.key in P else P
    elif a.cand_strat: cand = None
    else: sys.exit('check 要 --params（或 --cand-strat）')
    jobs = scen_jobs(a.suite, a.seeds, a.seed0, cand, a.hz, a.tmax, 'check', a.cand_strat); res = pool.run(jobs, out.match1); S = summarize(jobs, res)
    out.log('驗證（種子 %d–%d，沒用來調的）：%d 場（缺 %d）分數 %+.3f ± %.3f（95%% 約 ±%.3f）、候選贏 %d／輸 %d'
            % (a.seed0, a.seed0 + a.seeds - 1, S['n'], S['missing'], S['mean'], S['se'], 1.96 * S['se'], S['win'], S['lose']))
    E = [e for j, d in zip(jobs, res) if d and d['res'].get('roll') and d['res']['roll'].get(j['side']) for e in d['res']['roll'][j['side']]['errs']]
    if E: out.log('推演的預測落差（90 秒後 預測 − 實際，TASK-0688）：%d 筆、平均 %+.3f、絕對值平均 %.3f' % (len(E), sum(e[1] - e[2] for e in E) / len(E), sum(abs(e[1] - e[2]) for e in E) / len(E)))
    for si, sc in enumerate(SUITES[a.suite]):
        J = [(j, d) for j, d in zip(jobs, res) if j['scen'] == si]; s = summarize([x[0] for x in J], [x[1] for x in J])
        out.log('  場景 %d（%d 對 %d %s %s %d m）：%+.3f ± %.3f、贏 %d／輸 %d' % (si, sc['n'], sc['n'], sc['hull'], sc['strat'], sc['dist'], s['mean'], s['se'], s['win'], s['lose']))


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser(description='艦隊指揮官 AI 的自動調參（TASK-0687）')
    ap.add_argument('cmd', choices=['bench', 'run', 'check'])
    ap.add_argument('--workers', type=int, default=4); ap.add_argument('--suite', default='base', choices=sorted(SUITES)); ap.add_argument('--seeds', type=int, default=None)
    ap.add_argument('--seed0', type=int, default=None); ap.add_argument('--hz', type=int, default=20); ap.add_argument('--tmax', type=float, default=300)
    ap.add_argument('--gens', type=int, default=12); ap.add_argument('--lam', type=int, default=10); ap.add_argument('--sigma', type=float, default=0.2); ap.add_argument('--rseed', type=int, default=1)
    ap.add_argument('--params'); ap.add_argument('--key', default='mean'); ap.add_argument('--play', default='fun', choices=['fun', 'real'])
    ap.add_argument('--out'); ap.add_argument('--html', default=OUT_HTML); ap.add_argument('--chrome'); ap.add_argument('--job-timeout', type=int, default=1800); ap.add_argument('--normal', action='store_true')
    ap.add_argument('--cand-strat', default=None, help='候選那一方改用的指揮官策略（free／pair／focus／line／auto）；不給 ＝ 照場景')
    a = ap.parse_args()
    if a.seeds is None: a.seeds = {'bench': 2, 'run': 1, 'check': 6}[a.cmd]
    if a.seed0 is None: a.seed0 = {'bench': 1, 'run': 1, 'check': 1000}[a.cmd]                # check 預設用 1000 起的種子：run 用的是 1 起，不重疊
    chrome = a.chrome or next((c for c in CHROME if os.path.exists(c)), None)
    if not chrome: sys.exit('找不到 Chrome（--chrome 指定）')
    url = 'file:///' + os.path.abspath(a.html).replace('\\', '/') + '?lab=fleet&debug=1&prefs=0&play=' + a.play
    out = Out(a.out); out.log('%s：%d 個工作者、評測組 %s、%d Hz、時限 %g 秒、玩法 %s；輸出 %s' % (a.cmd, a.workers, a.suite, a.hz, a.tmax, a.play, out.dir))
    json.dump(vars(a), open(os.path.join(out.dir, 'args_%s.json' % a.cmd), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    pool = Pool(a.workers, chrome, url, a.job_timeout, out.log, not a.normal)
    try:
        {'bench': cmd_bench, 'run': cmd_run, 'check': cmd_check}[a.cmd](a, pool, out)
    finally:
        pool.close()


if __name__ == '__main__':
    main()
