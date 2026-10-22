# 《憲法號對轟》空艙房（TASK-0568）：從 VoxelKit/_cache 的 .vxk 找候選艙房、檢查標好的艙房。只讀、不改任何檔。
#   python -I rooms.py scan  --id constitution [--json <out.json>]   找候選：每個「艙房」部件（關聯路徑結尾是 艙房／艙房-鏡像）裡被牆隔開的每一間 ⇒ 最大的全空氣長方體
#   python -I rooms.py check --id constitution [--json <out.json>]   檢查標好的：關聯 meta kind=rooms、固定點 <房名>.min／.max（＋可選 .door）⇒ 尺寸、裡面幾格不是空氣、跟別間重疊幾格、門
# 標法（造船規格 Sculpture_Shipbuilding.md §9.2）：在艙房那件子作品裡加固定點 <房名>.min、<房名>.max（兩個角的那一格，含兩端、只框空氣；
#   地板 ＝ 甲板面上第一層空氣）；那條關聯（與它的鏡像）meta kind=rooms。鏡像的關聯固定點自己會翻過去 ⇒ 一舷標一次。
# 輸出的座標：組裝件（＝ 遊戲的格座標）；scan 另外印「子作品自己的座標」（＝ 組裝件 − 部件外框的起點），給 sub=anchor 直接用。
import argparse, json, os, struct, sys, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.normpath(os.path.join(HERE, '..', 'VoxelKit', '_cache'))
HEAD = 14                       # 頭上要空幾格才算站得住（1.4 m；遊戲 40_crew.js 同一個數）
MIN_W, MIN_D = 8, 8             # 候選至少 0.8 × 0.8 m


def load(path):
    b = zlib.decompress(open(path, 'rb').read(), -15)
    if b[:4] != b'VXK1':
        raise SystemExit('不是 .vxk：' + path)
    n = struct.unpack('<I', b[4:8])[0]
    h = json.loads(b[8:8 + n].decode('utf-8'))
    o = 8 + n
    nc = (len(b) - o) // (6 + 4096)
    co = struct.unpack('<%dH' % (nc * 3), b[o:o + nc * 6])
    o += nc * 6
    ch = {}
    for i in range(nc):
        ch[(co[3 * i], co[3 * i + 1], co[3 * i + 2])] = b[o + i * 4096:o + (i + 1) * 4096]

    def get(x, y, z):
        c = ch.get((x >> 4, y >> 4, z >> 4))
        return c[(x & 15) + 16 * (y & 15) + 256 * (z & 15)] if c else 0
    return h, get


def floor_z(get, x, y, z0, z1):
    """(x, y) 這一柱、z0..z1 − 4 之間最低那一層「腳下實心、頭上 HEAD 格空」的高度；沒有 ⇒ None。
    地板可以就是外框的最底層（腳下那一格在外框外：甲板屬於甲板子作品）；⛔ 頂上 4 格不算（那是上一層甲板的地板）。"""
    for z in range(z0, z1 - 3):
        if get(x, y, z - 1) and not get(x, y, z) and all(not get(x, y, z + k) for k in range(1, HEAD)):
            return z
    return None


def max_rect(cells):
    """2D 格集合裡最大的全滿長方形（直方圖法）⇒ (x0, y0, x1, y1) 含兩端。"""
    if not cells:
        return None
    xs = [c[0] for c in cells]; ys = [c[1] for c in cells]
    X0, X1, Y0, Y1 = min(xs), max(xs), min(ys), max(ys)
    best, bb = 0, None
    hgt = [0] * (X1 - X0 + 1)
    for y in range(Y0, Y1 + 1):
        for i in range(len(hgt)):
            hgt[i] = hgt[i] + 1 if (X0 + i, y) in cells else 0
        st = []
        for i in range(len(hgt) + 1):
            h = hgt[i] if i < len(hgt) else 0
            s = i
            while st and st[-1][1] >= h:
                s, hh = st.pop()
                a = hh * (i - s)
                if a > best:
                    best, bb = a, (X0 + s, y - hh + 1, X0 + i - 1, y)
            st.append((s, h))
    return bb


def ceil_z(get, cells, zf, zmax):
    """這一片地板上方，往上第一層有任何實心的高度 − 1（＝ 艙頂底下那一格）。"""
    for z in range(zf, zmax + 1):
        if any(get(x, y, z) for (x, y) in cells):
            return z - 1
    return zmax


DOOR = 8                        # 往外連續幾格站得住才算門（遊戲 36_rooms.js ROOM_DOOR）


def doors(get, r):
    """長方體 r 的四面牆上、往外連續 DOOR 格都站得住（腳下實心、頭上 HEAD 格空）的格 ⇒ 門洞。
    ⛔ 只看外面那一格 ⇒ 長方體外側還有一點地板（船殼的弧度、最大內接長方形沒框到的角落）也被當成門。"""
    x0, y0, z0, x1, y1, z1 = r

    def st(x, y):
        return get(x, y, z0 - 1) and all(not get(x, y, z0 + k) for k in range(0, HEAD))

    def open_(x, y, dx, dy):
        return all(st(x + dx * k, y + dy * k) for k in range(1, DOOR + 1))
    out = []
    for x in range(x0, x1 + 1):
        if open_(x, y0, 0, -1):
            out.append((x, y0))
        if open_(x, y1, 0, 1):
            out.append((x, y1))
    for y in range(y0, y1 + 1):
        if open_(x0, y, -1, 0):
            out.append((x0, y))
        if open_(x1, y, 1, 0):
            out.append((x1, y))
    return out


def scan(h, get):
    res = []
    for p in h.get('parts', []):
        path = p.get('path') or ''
        if not (path.endswith('艙房') or path.endswith('艙房-鏡像')):
            continue
        bx = p['box']
        # 站人的那一層：外框裡每一柱的地板；照地板高度分組（同一間的地板一樣高）
        fl = {}
        for x in range(bx[0], bx[3] + 1):
            for y in range(bx[1], bx[4] + 1):
                z = floor_z(get, x, y, bx[2], bx[5])
                if z is not None:
                    fl[(x, y)] = z
        # 被牆隔開的每一間：同一層地板、相鄰的格連成一片（外框邊上那一排是門洞，不算 ⇒ 門不會把艙房接到走廊）
        seen, rooms = set(), []
        for c0 in fl:
            if c0 in seen or c0[0] in (bx[0], bx[3]) or c0[1] in (bx[1], bx[4]):
                continue
            comp, st = set(), [c0]
            seen.add(c0)
            while st:
                c = st.pop(); comp.add(c)
                for d in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    n = (c[0] + d[0], c[1] + d[1])
                    if n in fl and n not in seen and fl[n] == fl[c0] and bx[0] < n[0] < bx[3] and bx[1] < n[1] < bx[4]:
                        seen.add(n); st.append(n)
            rect = max_rect(comp)
            if not rect or rect[2] - rect[0] + 1 < MIN_W or rect[3] - rect[1] + 1 < MIN_D:
                continue
            cells = {(x, y) for x in range(rect[0], rect[2] + 1) for y in range(rect[1], rect[3] + 1)}
            zf = fl[c0]
            zt = ceil_z(get, cells, zf, bx[5] + 40)
            rooms.append((rect[0], rect[1], zf, rect[2], rect[3], zt))
        rooms.sort()
        for i, r in enumerate(rooms):
            res.append({'part': path, 'box0': bx[:3], 'name': str(i + 1), 'min': list(r[:3]), 'max': list(r[3:]),
                        'local_min': [r[0] - bx[0], r[1] - bx[1], r[2] - bx[2]], 'local_max': [r[3] - bx[0], r[4] - bx[1], r[5] - bx[2]],
                        'size_m': [round((r[3] - r[0] + 1) * h.get('meters_per_voxel', 0.1), 2), round((r[4] - r[1] + 1) * h.get('meters_per_voxel', 0.1), 2), round((r[5] - r[2] + 1) * h.get('meters_per_voxel', 0.1), 2)],
                        'door_cells': len(doors(get, r))})
    return res


def marked(h):
    """關聯 meta kind=rooms 的固定點 <房名>.min／.max（＋.door）⇒ [{name, min, max, door}]；只有一個角的列出來（⛔ 不默默略過）。"""
    out, bad = [], []
    for p in h.get('parts', []):
        if (p.get('meta') or {}).get('kind') != 'rooms':
            continue
        by = {}
        for k, v in (p.get('points') or {}).items():
            i = k.rfind('.')
            if i < 0:
                continue
            by.setdefault(k[:i], {})[k[i + 1:]] = [int(v[0] // 1), int(v[1] // 1), int(v[2] // 1)]
        for nm, b in sorted(by.items()):
            if 'min' not in b or 'max' not in b:
                if 'min' in b or 'max' in b:
                    bad.append((p.get('path') or '') + '/' + nm + '：只有一個角')
                continue
            a, c = b['min'], b['max']
            out.append({'name': (p.get('path') or '') + '/' + nm, 'min': [min(a[i], c[i]) for i in range(3)], 'max': [max(a[i], c[i]) for i in range(3)], 'door': b.get('door')})
    return out, bad


def check(h, get):
    R, bad = marked(h)
    mpv = h.get('meters_per_voxel', 0.1)
    for r in R:
        x0, y0, z0 = r['min']; x1, y1, z1 = r['max']
        n = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1)
        r['size_m'] = [round((x1 - x0 + 1) * mpv, 2), round((y1 - y0 + 1) * mpv, 2), round((z1 - z0 + 1) * mpv, 2)]
        r['solid'] = sum(1 for x in range(x0, x1 + 1) for y in range(y0, y1 + 1) for z in range(z0, z1 + 1) if get(x, y, z))
        r['cells'] = n
        r['floor_ok'] = sum(1 for x in range(x0, x1 + 1) for y in range(y0, y1 + 1) if get(x, y, z0 - 1))
        r['floor_cells'] = (x1 - x0 + 1) * (y1 - y0 + 1)
        r['door_cells'] = len(doors(get, (x0, y0, z0, x1, y1, z1)))
    for i, a in enumerate(R):
        a['overlap'] = []
        for b in R[:i] + R[i + 1:]:
            o = 1
            for k in range(3):
                o *= max(0, min(a['max'][k], b['max'][k]) - max(a['min'][k], b['min'][k]) + 1)
            if o:
                a['overlap'].append([b['name'], o])
    return R, bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('op', choices=['scan', 'check'])
    ap.add_argument('--id', required=True)
    ap.add_argument('--json')
    a = ap.parse_args()
    p = os.path.join(CACHE, a.id + '.vxk')
    if not os.path.exists(p):
        raise SystemExit('找不到 ' + p)
    h, get = load(p)
    if a.op == 'scan':
        res = scan(h, get)
        lines = ['候選艙房 %d 間（%s；組裝件座標，含兩端；local ＝ 艙房子作品自己的座標）' % (len(res), a.id)]
        for r in res:
            lines.append('  %s #%s  %s–%s  local %s–%s  %.2f×%.2f×%.2f m  門洞 %d 格' % (r['part'], r['name'], r['min'], r['max'], r['local_min'], r['local_max'], *r['size_m'], r['door_cells']))
    else:
        res, bad = check(h, get)
        lines = ['標好的艙房 %d 間（%s）' % (len(res), a.id)]
        for r in res:
            prob = []
            if r['solid']:
                prob.append('裡面有 %d 格不是空氣' % r['solid'])
            if r['floor_ok'] < r['floor_cells'] * 0.9:
                prob.append('地板只有 %d／%d 格（min 的 z 要是甲板面上第一層空氣）' % (r['floor_ok'], r['floor_cells']))
            if r['overlap']:
                prob.append('跟 ' + '、'.join('%s 重疊 %d 格' % (o[0], o[1]) for o in r['overlap']))
            if not r['door_cells'] and not r['door']:
                prob.append('找不到門（四面牆站人那一層都不通）')
            lines.append('  %s %s %s–%s  %.2f×%.2f×%.2f m  門洞 %d 格%s' % ('✗' if prob else '✓', r['name'], r['min'], r['max'], *r['size_m'], r['door_cells'], ('　⚠ ' + '；'.join(prob)) if prob else ''))
        for b in bad:
            lines.append('  ✗ ' + b)
        if not res and not bad:
            lines.append('  （沒有 kind=rooms 的關聯）')
    sys.stdout.buffer.write(('\n'.join(lines) + '\n').encode('utf-8'))
    if a.json:
        json.dump(res, open(a.json, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
