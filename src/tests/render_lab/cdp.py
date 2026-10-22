# Minimal Chrome DevTools Protocol client (stdlib only), same approach as Blockside src/tests/ambient_lab.py:
# launch Chrome --headless=new with --remote-debugging-port, talk CDP over a raw websocket.
import base64, json, os, shutil, socket, struct, subprocess, tempfile, time, urllib.parse, urllib.request

CHROME = [r'C:\Program Files\Google\Chrome\Application\chrome.exe', r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe']

# GPU flag sets tried by `probe`; 'default' is what measure uses unless --gpu says otherwise.
GPU_FLAGS = {
    'default': [],
    'd3d11': ['--use-angle=d3d11'],
    'd3d11-gpu': ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
    'gl': ['--use-angle=gl'],
    'swiftshader': ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
}


class PortBusy(RuntimeError):
    pass


def parse_ports(spec, default_base=9361):
    """'9371-9379' / '9371,9373' / '9371' (a single base => base..base+9, the old --port behaviour) -> list of ports."""
    spec = str(spec or default_base).strip()
    out = []
    for part in spec.split(','):
        part = part.strip()
        if not part:
            continue
        if '-' in part:
            a, b = part.split('-', 1)
            out += list(range(int(a), int(b) + 1))
        else:
            out.append(int(part))
    if len(out) == 1 and ',' not in spec and '-' not in spec:
        out = list(range(out[0], out[0] + 10))
    return out


class WS:
    def __init__(self, url, timeout=900):
        u = urllib.parse.urlparse(url)
        self.s = socket.create_connection((u.hostname, u.port), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall(('GET %s HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                        'Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n' % (u.path, u.hostname, u.port, key)).encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            buf += self.s.recv(4096)
        self.rest = buf.split(b'\r\n\r\n', 1)[1]
        self.n = 0
        self.events = []

    def _read(self, k):
        while len(self.rest) < k:
            c = self.s.recv(1 << 20)
            if not c:
                raise IOError('DevTools connection closed')
            self.rest += c
        out, self.rest = self.rest[:k], self.rest[k:]
        return out

    def send(self, obj):
        data = json.dumps(obj).encode()
        mask = os.urandom(4)
        n = len(data)
        if n < 126:
            hdr = struct.pack('!BB', 0x81, 0x80 | n)
        elif n < 65536:
            hdr = struct.pack('!BBH', 0x81, 0x80 | 126, n)
        else:
            hdr = struct.pack('!BBQ', 0x81, 0x80 | 127, n)
        # XOR mask in bulk (bytes(...) per byte is slow for big payloads)
        m = (mask * (n // 4 + 1))[:n]
        masked = (int.from_bytes(data, 'little') ^ int.from_bytes(m, 'little')).to_bytes(n, 'little') if n else b''
        self.s.sendall(hdr + mask + masked)

    def recv(self):
        msg = b''
        while True:
            b0, b1 = self._read(2)
            n = b1 & 0x7f
            if n == 126:
                n = struct.unpack('!H', self._read(2))[0]
            elif n == 127:
                n = struct.unpack('!Q', self._read(8))[0]
            msg += self._read(n)
            if b0 & 0x80:
                return json.loads(msg.decode('utf-8'))

    def call(self, method, params=None):
        self.n += 1
        self.send({'id': self.n, 'method': method, 'params': params or {}})
        while True:
            r = self.recv()
            if r.get('id') == self.n:
                if 'error' in r:
                    raise RuntimeError('%s failed: %s' % (method, r['error']))
                return r.get('result', {})
            self.events.append(r)

    def eval(self, expr, await_promise=False, timeout_ms=None):
        p = {'expression': expr, 'returnByValue': True, 'awaitPromise': await_promise}
        if timeout_ms:
            p['timeout'] = timeout_ms
        r = self.call('Runtime.evaluate', p)
        if 'exceptionDetails' in r:
            ed = r['exceptionDetails']
            desc = (ed.get('exception') or {}).get('description') or ed.get('text')
            raise RuntimeError('page exception: %s' % desc)
        return r['result'].get('value')


def port_free(port):
    """True when nothing listens on 127.0.0.1:port (another session's Chrome would answer DevTools there => never reuse it)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.settimeout(0.3)
        if s.connect_ex(('127.0.0.1', port)) == 0:
            return False
    finally:
        s.close()
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(('127.0.0.1', port))
        return True
    except OSError:
        return False
    finally:
        s.close()


class Chrome:
    """One headless Chrome with its own fresh profile; .ws is the page websocket.
    The DevTools port is checked free before launch, and afterwards the browser answering on it must report our own
    process id (SystemInfo.getProcessInfo), so a port that is (or becomes) owned by someone else's Chrome is never driven."""

    def __init__(self, port, profile_root, gpu='default', width=1280, height=720, extra=()):
        self.chrome = next(c for c in CHROME if os.path.exists(c))
        os.makedirs(profile_root, exist_ok=True)
        if not port_free(port):
            raise PortBusy('port %d is in use (another Chrome / session?)' % port)
        self.prof = tempfile.mkdtemp(prefix='prof_', dir=profile_root)
        self.port = port
        args = [self.chrome, '--headless=new', '--no-first-run', '--no-default-browser-check',
                '--user-data-dir=' + self.prof, '--remote-debugging-port=%d' % port, '--remote-allow-origins=*',
                '--window-size=%d,%d' % (width, height), '--force-device-scale-factor=1',
                '--mute-audio', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
                '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
                '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion',
                '--allow-file-access-from-files'] + GPU_FLAGS[gpu] + list(extra) + ['about:blank']
        self.args = args
        self.p = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.ws = None
        tabs = None
        for _ in range(150):
            if self.p.poll() is not None:                 # our Chrome died (e.g. could not bind the port)
                break
            try:
                tabs = json.load(urllib.request.urlopen('http://127.0.0.1:%d/json' % port, timeout=2))
                if any(t.get('type') == 'page' for t in tabs):
                    break
            except OSError:
                pass
            time.sleep(0.2)
        if not tabs or self.p.poll() is not None:
            self.close()
            raise PortBusy('Chrome did not open DevTools on port %d (exit %r)' % (port, self.p.poll()))
        # the browser answering on this port must be OUR process (pid), never another session's Chrome that grabbed the port
        try:
            ver = json.load(urllib.request.urlopen('http://127.0.0.1:%d/json/version' % port, timeout=5))
            bw = WS(ver['webSocketDebuggerUrl'], timeout=20)
            try:
                pi = bw.call('SystemInfo.getProcessInfo').get('processInfo') or []
            finally:
                bw.s.close()
            pids = [x.get('id') for x in pi if x.get('type') == 'browser']
        except Exception as e:
            self.close()
            raise PortBusy('could not verify the browser on port %d: %s' % (port, e))
        if self.p.pid not in pids:
            self.close()
            raise PortBusy('port %d answers for another browser (pid %s, ours %s)' % (port, pids, self.p.pid))
        page = next(t for t in tabs if t.get('type') == 'page')
        self.ws = WS(page['webSocketDebuggerUrl'])

    def close(self):
        try:
            if self.ws:
                self.ws.s.close()
        except Exception:
            pass
        self.p.terminate()
        try:
            self.p.wait(10)
        except subprocess.TimeoutExpired:
            self.p.kill()
        for _ in range(10):
            shutil.rmtree(self.prof, ignore_errors=True)
            if not os.path.exists(self.prof):
                break
            time.sleep(0.3)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()


def gpu_info_js():
    return r'''(function(){
  var c = document.createElement('canvas'), g = c.getContext('webgl2');
  if (!g) return {webgl2: false};
  var e = g.getExtension('WEBGL_debug_renderer_info');
  return {webgl2: true, vendor: e ? g.getParameter(e.UNMASKED_VENDOR_WEBGL) : g.getParameter(g.VENDOR),
          renderer: e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER),
          version: g.getParameter(g.VERSION), maxSamples: g.getParameter(g.MAX_SAMPLES), maxTex: g.getParameter(g.MAX_TEXTURE_SIZE)};
})()'''
