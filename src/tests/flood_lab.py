# 沙盒進水報表（TASK-0654；遊戲那側在 js/81_floodlab.js）。只讀成品、不改東西。
#   Tim 2026-10-16：「沙盒可以做專門的報表紀錄水的變化細節與畫面對應 方便比對」
#   跑：python -I -X utf8 src/tests/flood_lab.py [--html <成品>] [--hulls constitution,virginia] [--phx mid,full] [--q "dur=60&every=10&xray=1&fpitch=1.0&fdist=38"] [--tag before] [--out <資料夾>] [--jobs 3]
# 每艘船 × 每一檔：無頭 Chrome 開成品 ?lab=flood&ship=<船>,<另一艘>&phx=<檔>&<q>，讀 <pre id="lab">（每一筆讀數＋同一刻的截圖）。
# 寫：<out>/<tag>/flood_<船>_<檔>.json（讀數，不含截圖）、<out>/<tag>/img/<船>_<檔>_<t>.jpg、<out>/<tag>/index.html（每一筆一列：截圖｜讀數｜接縫分類）。
#   兩次（改前 before、改後 after）同一組參數 ⇒ index.html 並排比；--compare before,after 另外寫 <out>/compare.html（同一刻左右對照）。
import argparse, base64, html, json, os, re, shutil, subprocess, tempfile
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_HTML = os.path.normpath(os.path.join(HERE, '..', '..', 'index.html'))
OUT_DIR = os.path.normpath(os.path.join(HERE, '..', '..', 'reports', 'flood_lab'))
CHROME = [r'C:\Program Files\Google\Chrome\Application\chrome.exe', r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe']
OTHER = {'constitution': 'ember'}                                      # 另一艘（只是湊滿兩艘、會被移到遠處）；沒寫 ⇒ 憲法號
SEAM = [('pools', '池'), ('step', '兩池之間（側）'), ('open', '懸空的邊'), ('wall', '貼牆'), ('join', '接起來'), ('cutTops', '船殼邊切掉的塊'), ('cutPieces', '切掉的小片'), ('outTops', '整塊沒畫')]


def run_one(chrome, page, hull, phx, q):
    prof = tempfile.mkdtemp(prefix='floodlab_')
    try:
        q = q if re.search(r'(^|&)seed=', q or '') else ('seed=3&' + (q or '')).rstrip('&')   # ⛔ 沒帶種子 ⇒ 每次開都是隨機的一局，改前改後對不起來
        url = 'file:///' + page.replace('\\', '/') + '?lab=flood&ship=%s,%s&phx=%s%s' % (hull, OTHER.get(hull, 'constitution'), phx, '&' + q if q else '')
        r = subprocess.run([chrome, '--headless=new', '--no-first-run', '--user-data-dir=' + prof, '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                            '--window-size=1280,800', '--virtual-time-budget=600000', '--dump-dom', url], capture_output=True, timeout=1800)
        m = re.findall(r'<pre id="lab">(.*?)</pre>', r.stdout.decode('utf-8', 'replace'), re.S)   # 取最後一個（成品內嵌程式；⛔ 註解裡別寫那個標籤的原文）
        return hull, phx, json.loads(html.unescape(m[-1])) if m else None
    finally:
        shutil.rmtree(prof, ignore_errors=True)


def save(R, hull, phx, d):
    os.makedirs(os.path.join(d, 'img'), exist_ok=True)
    rows = []
    for r in R['rows']:
        name = 'img/%s_%s_%05.1f.jpg' % (hull, phx, r['t'])
        with open(os.path.join(d, name), 'wb') as f:
            f.write(base64.b64decode(r['img'].split(',', 1)[1]))
        r2 = dict(r); r2['img'] = name
        if r.get('map'):                                                  # 接縫地圖（81_floodlab.js flabMap）
            mname = 'img/%s_%s_%05.1f_map.png' % (hull, phx, r['t'])
            with open(os.path.join(d, mname), 'wb') as f:
                f.write(base64.b64decode(r['map'].split(',', 1)[1]))
            r2['map'] = mname
        rows.append(r2)
    R2 = dict(R); R2['rows'] = rows
    if R.get('wpic'):                                                   # 房間模擬的過程圖（81_floodlab.js wsimPic）：每一組三張 ⇒ img/、另寫 wsim_<船>_<檔>.html（拖拉看過程）
        pics = []
        for w in R['wpic']:
            w2 = dict(w)
            for k in ('side', 'fill', 'press', 'top'):
                name = 'img/wsim_%s_%s_%06.1f_%s.png' % (hull, phx, w['t'], k)
                with open(os.path.join(d, name), 'wb') as f:
                    f.write(base64.b64decode(w[k].split(',', 1)[1]))
                w2[k] = name
            pics.append(w2)
        R2['wpic'] = pics
        player(pics, hull, phx, d)
    with open(os.path.join(d, 'flood_%s_%s.json' % (hull, phx)), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(R2, f, ensure_ascii=False, indent=1)
    return R2


def player(pics, hull, phx, d):
    # 一頁：拖拉（或 ←→、播放）看每一組的側視、裝了幾成、俯視；下面是那一刻的讀數與房間表
    J = json.dumps([{'t': w['t'], 'side': w['side'], 'fill': w['fill'], 'press': w.get('press'), 'top': w['top'], 'rooms': w['rooms'], 'n': w.get('nRooms'), 'no': w.get('spillNo'),
                     'r': {k: (w.get('r') or {}).get(k) for k in ('vol', 'inTot', 'outTot', 'brOut', 'jets', 'jetM3', 'dbg', 'sub', 'ms', 'cross', 'cons')}} for w in pics], ensure_ascii=False)
    o = ['<!doctype html><meta charset="utf-8"><title>房間模擬過程 %s %s</title>' % (html.escape(hull), html.escape(phx)), CSS,
         '<style>img{image-rendering:pixelated;max-width:100%}#bar{position:sticky;top:0;background:#fff;padding:6px 0}</style>',
         '<h2>%s・%s 房間模擬過程（%d 組）</h2>' % (html.escape(hull), html.escape(phx), len(pics)),
         '<p>側視：x 往右、z 往上；底色 ＝ 那一排最多的那一間（房間色調暗）、藍 ＝ 那一排有幾成在水面以下。裝了幾成：灰 乾、青 → 黃 一部分、紅 整間滿。俯視：x 往右、y 往下。'
         '標記：紅十字 破口、黃點 飛行中的粒子、洋紅 這一段溢出（記成流回海裡）的落點。</p>',
         '<div id="bar"><input id="s" type="range" min="0" max="%d" value="0" style="width:70%%"> <button id="p">播放</button> <b id="t"></b></div>' % (len(pics) - 1),
         '<h3>側視（水）</h3><img id="iside"><h3>側視（每一間裝了幾成）</h3><img id="ifill"><h3>側視（水壓：淺黃 → 深紅 ＝ 0 → 2 m 水頭；洋紅 ＝ 水壓高過海面）</h3><img id="ipress"><h3>俯視（水）</h3><img id="itop"><pre id="info"></pre>',
         '<script>var P=%s,s=document.getElementById("s"),tm=null;' % J,
         'function show(i){var w=P[i];["side","fill","press","top"].forEach(function(k){document.getElementById("i"+k).src=w[k];});'
         'document.getElementById("t").textContent="t "+w.t+" s";'
         'document.getElementById("info").textContent="讀數 "+JSON.stringify(w.r)+"\\n沒落進房間的溢出 "+w.no+" m³\\n房間（共 "+w.n+" 間有水或溢出）[房, 容積 m³, 水 m³, 幾成, 這一段溢出 m³]\\n"+w.rooms.map(function(x){return JSON.stringify(x);}).join("\\n");}',
         's.oninput=function(){show(+s.value);};document.onkeydown=function(e){if(e.key=="ArrowRight")s.value=Math.min(P.length-1,+s.value+1);else if(e.key=="ArrowLeft")s.value=Math.max(0,+s.value-1);else return;show(+s.value);};',
         'document.getElementById("p").onclick=function(){if(tm){clearInterval(tm);tm=null;return;}tm=setInterval(function(){var v=(+s.value+1)%P.length;s.value=v;show(v);},400);};show(0);</script>']
    with open(os.path.join(d, 'wsim_%s_%s.html' % (hull, phx)), 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(o))


def table(R2):
    o = ['<h2>%s・進水 %s（水格 %s 格）</h2>' % (html.escape(R2['hull']), R2.get('lv'), R2.get('c')),
         '<p>洞：%s</p>' % '；'.join(('殉爆 %s 號彈藥庫（%s）' % (h['boom'], h['mag'])) if 'boom' in h else 'x %s z %s %s舷 r %s（打掉 %s 格）' % (h['x'], h['z'], '−y' if h['side'] else '+y', h['r'], h['removed']) for h in R2.get('holes', []))]
    if R2.get('err'):
        return '\n'.join(o + ['<p style="color:#c00">%s</p>' % html.escape(R2['err'])])
    o.append('<table><tr><th>截圖</th><th>t（秒）</th><th>水（m³）</th><th>高出海面</th><th>進／出（m³/s）</th><th>水格</th><th>網格</th><th>接縫</th></tr>')
    for r in R2['rows']:
        fl, me, st = r['fl'] or {}, r.get('mesh') or {}, r.get('seam') or {}
        seam = '<br>'.join('%s %s' % (lab, st.get(k, '')) for k, lab in SEAM) + ('<br>兩池水面差 中位 %s m、最大 %s m' % (st.get('dhMed'), st.get('dhMax')) if st else '')
        mp = '<br><img src="%s" style="max-width:420px;image-rendering:pixelated">' % r['map'] if r.get('map') else ''
        o.append(('<tr><td><a href="%s"><img src="%s" width="420"></a>' % (r['img'], r['img'])) + mp + ('</td><td>%s</td><td>%s</td><td>%s</td><td>%s／%s</td><td>%s</td><td>%s 三角形<br>%s 片<br>%s ms<br>水幕 %s 道<br>側面 %s・水瀑 %s</td><td>%s</td></tr>' % (
            r['t'], fl.get('m3'), '%s m<br>%s 格、%s m³' % ((r.get('ex') or {}).get('max', '—'), (r.get('ex') or {}).get('n', '—'), (r.get('ex') or {}).get('vol', '—')), fl.get('inQ'), fl.get('outQ'), fl.get('cells'), me.get('tris', '—'), me.get('quads', '—'), me.get('ms', '—'), me.get('falls', '—'), me.get('sides', '—'), me.get('spill', '—'), seam)))
    o.append('</table><p>接縫地圖：方塊顏色 ＝ 哪一池（同一池同色）、紅 ＝ 整塊沒畫、橘框 ＝ 船殼邊切掉幾片、洋紅點 ＝ 有水但太薄沒畫；綠粗線 ＝ 兩池交界、黃線 ＝ 懸空的邊。</p>')
    return '\n'.join(o)


CSS = '<style>body{font-family:sans-serif;margin:16px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px;vertical-align:top;font-size:13px}img{display:block}</style>'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--html', default=OUT_HTML)
    ap.add_argument('--hulls', default='constitution')
    ap.add_argument('--phx', default='mid')
    ap.add_argument('--q', default='')
    ap.add_argument('--tag', default='run')
    ap.add_argument('--out', default=OUT_DIR)
    ap.add_argument('--jobs', type=int, default=3)
    ap.add_argument('--compare', default='')
    a = ap.parse_args()
    if a.compare:                                                       # 兩個 tag 同一刻左右對照
        t0, t1 = a.compare.split(',')
        o = ['<!doctype html><meta charset="utf-8"><title>進水報表對照 %s ｜ %s</title>' % (t0, t1), CSS]
        for fn in sorted(os.listdir(os.path.join(a.out, t0))):
            if not fn.endswith('.json') or not os.path.exists(os.path.join(a.out, t1, fn)):
                continue
            A, B = [json.load(open(os.path.join(a.out, t, fn), encoding='utf-8')) for t in (t0, t1)]
            o.append('<h2>%s・進水 %s</h2><table><tr><th>t</th><th>%s</th><th>%s</th></tr>' % (A['hull'], A.get('lv'), t0, t1))
            for ra, rb in zip(A['rows'], B['rows']):
                def cell(r, t):
                    st, me = r.get('seam') or {}, r.get('mesh') or {}
                    return '<td><img src="%s/%s" width="480"><br>池 %s・兩池之間 %s・懸空 %s・整塊沒畫 %s｜%s 三角形、%s ms</td>' % (t, r['img'], st.get('pools'), st.get('step'), st.get('open'), st.get('outTops'), me.get('tris'), me.get('ms'))
                o.append('<tr><td>%s</td>%s%s</tr>' % (ra['t'], cell(ra, t0), cell(rb, t1)))
            o.append('</table>')
        with open(os.path.join(a.out, 'compare.html'), 'w', encoding='utf-8', newline='\n') as f:
            f.write('\n'.join(o))
        print('寫了', os.path.join(a.out, 'compare.html')); return
    chrome = next(c for c in CHROME if os.path.exists(c))
    d = os.path.join(a.out, a.tag)
    os.makedirs(d, exist_ok=True)
    jobs = [(h, p) for h in a.hulls.split(',') for p in a.phx.split(',')]
    with ThreadPoolExecutor(a.jobs) as ex:
        res = list(ex.map(lambda hp: run_one(chrome, os.path.abspath(a.html), hp[0], hp[1], a.q), jobs))
    parts = ['<!doctype html><meta charset="utf-8"><title>進水報表 %s</title>' % html.escape(a.tag), CSS, '<h1>進水報表 %s</h1><p>參數：%s</p>' % (html.escape(a.tag), html.escape(a.q or '（預設）'))]
    for hull, phx, R in res:
        if not R:
            parts.append('<h2>%s・%s：沒讀到結果</h2>' % (hull, phx)); print(hull, phx, '沒讀到結果'); continue
        R2 = save(R, hull, phx, d); parts.append(table(R2))
        for r in R2['rows']:
            st, me = r.get('seam') or {}, r.get('mesh') or {}
            ex = r.get('ex') or {}
            print(hull, phx, 't', r['t'], 'm3', (r['fl'] or {}).get('m3'), '高出海面', ex.get('max'), 'm（%s 格、%s m³）' % (ex.get('n'), ex.get('vol')), '池', st.get('pools'), '兩池之間', st.get('step'), '懸空', st.get('open'), '切', st.get('cutTops'), '整塊沒畫', st.get('outTops'), '三角形', me.get('tris'), 'ms', me.get('ms'))
    with open(os.path.join(d, 'index.html'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(parts))
    for hull, phx, R in res:                                            # 每秒一筆（81_floodlab.js trace／flabEx）：t、水、進、出、艙內最高水面 − 海面、高出海面的水、下沉
        if R and R.get('trace'):
            print(hull, phx, 'trace t/m3/進/出/高出/高出m3/sink:', ' '.join('%s:%s/%s/%s/%s/%s/%s' % tuple(x) for x in R['trace']))
    for hull, phx, R in res:                                            # 房間模擬的過程（wsimPic）：每一組一行
        for w in (R or {}).get('wpic') or []:
            r = w.get('r') or {}
            print(hull, phx, 'wsim t', w['t'], 'vol', r.get('vol'), 'in', r.get('inTot'), 'out', r.get('outTot'), 'jets', r.get('jets'), 'dbg', r.get('dbg'), 'top', w['rooms'][:4])
    print('寫了', os.path.join(d, 'index.html'))


if __name__ == '__main__':
    main()
