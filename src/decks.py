# 《憲法號對轟》甲板的 meta（TASK-0572）：從每一層甲板子作品自己的 .vxk 量地板（舷弧）與厚度，印出要標在組裝件那條甲板關聯上的 meta。只讀、不改作品。
#   python -I decks.py --vxk 甲板-berth=<甲板子作品.vxk> [--vxk 甲板-gun=<…>] … [--tsv <out.tsv>]
#   甲板子作品先匯出：senate cmd sculpture --arg op=export --arg format=vxk --arg work=<甲板子作品> --arg out=<絕對路徑.vxk>
#   ⚠ 甲板關聯要在組裝件的 0,0,0（子作品的座標 ＝ 組裝件的座標）；三艘船都是。
#   標上去：senate cmd sculpture --arg op=work --arg sub=meta --arg work=<組裝件> --arg persona=<P> --arg file=<out.tsv>（每行 link<TAB>關聯名<TAB>meta-JSON）
# meta（造船規格 §9.3）：kind=deck、deck=<代號>、level（由下往上，0 起）、name（顯示名）、floor（舷弧："x:z,x:z,…"，z ＝ 地板上第一層空氣；點之間線性內插、範圍外 ＝ 這一層沒有甲板）、thick（地板＋底下的樑幾格）。
#   量法：每一欄（x）在中線兩旁 ±4、±10、±16、±22、±28 格各取「這件作品在那一柱最高的實心格 + 1」，取眾數（至少兩點一樣）；前後 9 欄取中位數抹平；
#   再化簡成折線（誤差 ≤ 1 格就不留點）。厚度 ＝ 地板往下連續實心幾格的九成位數（最多 8）。
import argparse, json, os, struct, sys, zlib

NAMES = {'orlop': '底艙甲板', 'berth': '住艙甲板', 'gun': '砲甲板', 'lower': '下層砲甲板', 'upper': '上層砲甲板', 'spar': '上甲板',
         'poop': '船尾樓甲板', 'quarter': '後甲板', 'forecastle': '艏樓甲板', '主': '主甲板', '後': '後甲板'}
CODES = {'主': 'main', '後': 'quarter'}
YS = (-28, -22, -16, -10, -4, 4, 10, 16, 22, 28)


def load(path):
    b = zlib.decompress(open(path, 'rb').read(), -15)
    n = struct.unpack('<I', b[4:8])[0]
    h = json.loads(b[8:8 + n].decode('utf-8')); o = 8 + n
    nc = (len(b) - o) // (6 + 4096)
    co = struct.unpack('<%dH' % (nc * 3), b[o:o + nc * 6]); o += nc * 6
    cols = {}                                         # (x, y) ⇒ 由下往上的實心 z 清單
    for i in range(nc):
        cx, cy, cz = co[3 * i], co[3 * i + 1], co[3 * i + 2]
        blk = b[o + i * 4096:o + (i + 1) * 4096]
        for k, v in enumerate(blk):
            if v:
                x, y, z = cx * 16 + (k & 15), cy * 16 + ((k >> 4) & 15), cz * 16 + (k >> 8)
                cols.setdefault((x, y), []).append(z)
    for v in cols.values():
        v.sort()
    return h, cols


def measure(h, cols):
    CY = h['size'][1] // 2
    xs = sorted({x for (x, y) in cols})
    fl = {}
    for x in range(xs[0], xs[-1] + 1):
        tops = []
        for dy in YS:
            c = cols.get((x, CY + dy))
            if c:
                tops.append(c[-1] + 1)
        best, bn = None, 0
        for z in set(tops):
            n = tops.count(z)
            if n > bn or (n == bn and best is not None and z < best):
                best, bn = z, n
        if best is not None and bn >= 2:
            fl[x] = best
    if not fl:
        return None
    X = sorted(fl)
    sm = {}
    for x in X:
        w = sorted(fl[k] for k in range(x - 4, x + 5) if k in fl)
        sm[x] = w[len(w) // 2]
    pts = [(x, sm[x]) for x in X]

    def dp(a, b):                                     # 化簡：a..b 之間離直線最遠的點超過 1 格才留
        if b - a < 2:
            return [pts[a]]
        (x0, z0), (x1, z1) = pts[a], pts[b]
        far, fi = 0, -1
        for i in range(a + 1, b):
            x, z = pts[i]
            e = abs(z - (z0 + (z1 - z0) * (x - x0) / (x1 - x0)))
            if e > far:
                far, fi = e, i
        if far <= 1:
            return [pts[a]]
        return dp(a, fi) + dp(fi, b)
    poly = dp(0, len(pts) - 1) + [pts[-1]]
    runs = []
    for x in X[::2]:
        for dy in YS:
            c = set(cols.get((x, CY + dy), []))
            r = 0
            while r < 12 and (sm[x] - 1 - r) in c:
                r += 1
            if r:
                runs.append(r)
    runs.sort()
    thick = min(8, runs[int(len(runs) * 0.9)] if runs else 2)
    mid = sorted(z for _, z in pts)[len(pts) // 2]
    return {'poly': poly, 'thick': thick, 'mid': mid, 'x0': X[0], 'x1': X[-1]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--vxk', action='append', required=True, help='關聯名=甲板子作品的 .vxk')
    ap.add_argument('--tsv')
    a = ap.parse_args()
    res = []
    for s in a.vxk:
        link, path = s.split('=', 1)
        h, cols = load(path)
        m = measure(h, cols)
        if not m:
            print('⚠ %s：量不到地板' % link); continue
        res.append((link, m))
    res.sort(key=lambda r: r[1]['mid'])
    lines, out = [], []
    for lv, (link, m) in enumerate(res):
        code = link.split('-', 1)[1] if '-' in link else link
        meta = {'kind': 'deck', 'deck': CODES.get(code, code), 'level': lv, 'name': NAMES.get(code, code),
                'floor': ','.join('%d:%d' % p for p in m['poly']), 'thick': m['thick']}
        lines.append('link\t%s\t%s' % (link, json.dumps(meta, ensure_ascii=False, separators=(',', ':'))))
        out.append('%-10s level %d  中段地板 z %d  x %d–%d  折線 %d 點  厚 %d 格' % (link, lv, m['mid'], m['x0'], m['x1'], len(m['poly']), m['thick']))
    sys.stdout.buffer.write(('\n'.join(out) + '\n').encode('utf-8'))
    if a.tsv:
        open(a.tsv, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines) + '\n')


if __name__ == '__main__':
    main()
