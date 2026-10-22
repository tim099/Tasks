# 區塊職責：雕刻作品 → .vxk 封裝檔（瀏覽器端用 voxelkit.js 解碼）。
#           匯出走 senate CLI（⛔ 不直接讀作品的 events —— 關聯、鏡像、草稿怎麼組由 CLI 決定，這裡只收結果）。
# 物理意義：.vxk ＝ deflate-raw（magic 'VXK1'＋header JSON＋非空 16³ 區塊的座標與色值）。
#           1:1 不降採樣：每一格照原座標、原色值。
#           header 帶 checksum（每格雜湊的和，跟順序無關）—— 瀏覽器端解碼後算同一個數，對得上才算逐格相同。
# 失敗處置：CLI 匯出失敗、對拍不過（封裝回讀 ≠ 匯出清單）⇒ 非零結束、不寫輸出檔。
#
# 用法：
#   python -I voxel_export.py --work <作品> --out <檔.vxk> [--rig] [--parts] [--links all|none] [--list <既有匯出清單>]
#   --rig    ：連繩與帆一起（從 export format=obj 拿）
#   --models ：連模型匯入的子模型一起（配 --rig；每個模型＝一份去重過的三角形網格＋外框最小角）
#   --parts  ：各條關聯的外框（路徑、來源作品、box、mirror）—— 給要認得「哪一塊是砲、哪一根是桅」的展品用
#   --meta   ：每條關聯（配 --parts）、每個模型（配 --rig --models）多帶 `meta`（作者貼的 {鍵: 字串或數字}）與 `points`
#              （來源作品的固定點換到本作品座標 {名字: [x,y,z]}，格心）；header 多 `points`（本作品自己的固定點）。
#              來源：`senate cmd sculpture op=export format=parts`（TASK-0517）—— ⛔ 不從給人看的讀數拆字串。不帶 ⇒ header 跟以前逐欄一樣。
#   --senate ：senate 執行檔（預設 PATH 上的 senate；測試新建置時指過去）
import argparse, hashlib, json, os, re, struct, subprocess, sys, tempfile, time, zlib
from collections import Counter

import numpy as np

CHUNK = 16
MAGIC = b'VXK1'
WORKS_ROOT_DEFAULT = 'D:/Unity/Valhalla/Sculpture/works'
M32 = 0xFFFFFFFF
SENATE = 'senate'


def run(args):
    r = subprocess.run([SENATE, 'cmd', 'sculpture'] + args, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return r


def checksum(a):
    """每格雜湊的和（mod 2^32，跟順序無關）。voxelkit.js 的 VoxelKit.checksum 是同一式。"""
    x = a[:, 0].astype(np.uint64); y = a[:, 1].astype(np.uint64); z = a[:, 2].astype(np.uint64); c = a[:, 3].astype(np.uint64)
    h = ((x * 73856093) & M32) ^ ((y * 19349663) & M32) ^ ((z * 83492791) & M32) ^ ((c * 2654435761) & M32)
    return int(h.sum() & M32)


def export_list(work, links, out_txt):
    a = ['--arg', 'op=export', '--arg', 'format=list', '--arg', 'work=' + work, '--arg', 'out=' + out_txt]
    if links:
        a += ['--arg', 'links=' + links]
    r = run(a)
    if r.returncode != 0 or not os.path.exists(out_txt):
        sys.exit('✗ 匯出失敗（%s）：%s' % (work, (r.stdout + r.stderr)[-800:]))


def read_list(path):
    heads = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            if not line.startswith('#'):
                break
            heads.append(line[1:].strip())
    a = np.loadtxt(path, delimiter=',', comments='#', dtype=np.int32, ndmin=2, encoding='utf-8')
    return a, heads


def read_parts(work, works_root):
    """work sub=links 的樹 ⇒ 每條關聯在本作品座標裡的外框。子關聯的 at 相對於父關聯的作品原點（累加）。"""
    r = run(['--arg', 'op=work', '--arg', 'sub=links', '--arg', 'work=' + work])
    if r.returncode != 0:
        sys.exit('✗ 讀不了關聯：' + (r.stdout + r.stderr)[-500:])
    parts, stack = [], []
    for line in r.stdout.splitlines():
        m = re.match(r'^(\s*)- `([^`]+)` → (\S+)《.*?@(-?\d+),(-?\d+),(-?\d+) turn (\d+)( mirror ([xyz]+))?', line)
        if not m:
            continue
        depth = len(m.group(1)) // 2
        at = [int(m.group(4)), int(m.group(5)), int(m.group(6))]
        turn = int(m.group(7))
        stack = stack[:depth]
        base = stack[-1] if stack else [0, 0, 0]
        org = [base[i] + at[i] for i in range(3)]
        stack.append(org)
        j = json.load(open(os.path.join(works_root, m.group(3), 'work.json'), encoding='utf-8'))
        sx, sy, sz = j['size_x'], j['size_y'], j['size_z']
        if turn in (90, 270):
            sx, sy = sy, sx
        parts.append(dict(path=m.group(2), src=m.group(3), turn=turn, mirror=m.group(9) or '',
                          box=[org[0], org[1], org[2], org[0] + sx - 1, org[1] + sy - 1, org[2] + sz - 1]))
    return parts


def read_meta(work, links, tmpdir):
    """部件清單（export format=parts）⇒ (本作品的 points, {關聯路徑: 那一筆}, {模型路徑: 那一筆})。座標已是本作品的格座標。"""
    out = os.path.join(tmpdir, 'parts.json').replace('\\', '/')
    a = ['--arg', 'op=export', '--arg', 'format=parts', '--arg', 'work=' + work, '--arg', 'out=' + out]
    if links:
        a += ['--arg', 'links=' + links]
    r = run(a)
    if r.returncode != 0 or not os.path.exists(out):
        sys.exit('✗ 部件清單匯出失敗（senate 要有 TASK-0517 的 export format=parts）：' + (r.stdout + r.stderr)[-800:])
    j = json.load(open(out, encoding='utf-8'))
    if j.get('format') != 'sculpt-parts' or j.get('version') != 1:
        sys.exit('✗ 部件清單格式不認得：%s v%s' % (j.get('format'), j.get('version')))
    bad = [p['path'] for p in j['links'] + j['models'] if 'points_error' in p]
    if bad:
        sys.exit('✗ 這些部件的固定點讀不了（⛔ 不給空的 points）：' + '、'.join(bad))
    return j.get('points', {}), {p['path']: p for p in j['links']}, {m['path']: m for m in j['models']}


def read_rig(work, tmpdir, with_models=False):
    """繩（每圈取中心當中線）與帆（三角形）—— 從 export obj 拿。region 給一塊空的，只要繩與帆、不要格子。
    with_models：模型匯入的子模型也收（每個模型一份三角形網格＋每面材質色；同樣的網格只存一份）。"""
    d = os.path.join(tmpdir, 'obj')
    os.makedirs(d, exist_ok=True)
    r = run(['--arg', 'op=export', '--arg', 'format=obj', '--arg', 'work=' + work, '--arg', 'region=0..0,0..0,0..0',
             '--arg', 'out_dir=' + d.replace('\\', '/')])
    objs = [f for f in os.listdir(d) if f.endswith('.obj')]
    if r.returncode != 0 or not objs:
        sys.exit('✗ 繩與帆匯出失敗：' + (r.stdout + r.stderr)[-800:])
    objf = os.path.join(d, objs[0])
    mtl, cur = {}, None
    for line in open(objf[:-4] + '.mtl', encoding='utf-8'):
        if line.startswith('newmtl '):
            cur = line.split()[1]
        elif line.startswith('Kd ') and cur:
            mtl[cur] = [round(float(v), 4) for v in line.split()[1:4]]
    objs, V, cur = [], [], None
    for line in open(objf, encoding='utf-8'):
        if line.startswith('o '):
            nm = line.split('#', 1)[1].strip() if '#' in line else line.split()[1]
            cur = dict(kind=line.split()[1].split('_')[0], name=nm, v0=len(V), faces=[], fmtl=[], mtl=None)
            objs.append(cur)
        elif line.startswith('v '):
            X, Y, Z = (float(v) for v in line.split()[1:4])
            V.append((X, Z, Y))                       # obj 是 Y 朝上（x, 高, y）⇒ 換回作品的 (x, y, z)
        elif line.startswith('usemtl ') and cur is not None:
            cur['mtl'] = line.split()[1]
        elif line.startswith('f ') and cur is not None and (cur['kind'] in ('rope', 'sail') or (with_models and cur['kind'] == 'model')):
            cur['faces'].append([int(t.split('/')[0]) - 1 for t in line.split()[1:]])
            cur['fmtl'].append(cur['mtl'])
    V = np.array(V)
    ropes, sails, skipped = [], [], Counter()
    meshes, mesh_key, models = [], {}, []
    for i, o in enumerate(objs):
        v1 = objs[i + 1]['v0'] if i + 1 < len(objs) else len(V)
        pts = V[o['v0']:v1]
        if o['kind'] == 'rope':
            # 每圈 S 點、R 圈、側面 (R−1)·S 個四邊形、沒有封口 ⇒ S ＝ 頂點數 − 面數（細繩 3 點、粗繩 8 點）
            S = len(pts) - len(o['faces'])
            if S < 3 or len(pts) % S or any(len(f) != 4 for f in o['faces']):
                sys.exit('✗ 繩 %s：頂點 %d、面 %d —— 不是「每圈 S 點、側面四邊形、沒有封口」的形狀' % (o['name'], len(pts), len(o['faces'])))
            rings = pts.reshape(-1, S, 3)
            c = rings.mean(axis=1)
            rad = float(np.linalg.norm(rings[0] - c[0], axis=1).mean())
            ropes.append(dict(name=o['name'], color=mtl.get(o['mtl'], [0.2, 0.2, 0.2]), radius=round(rad, 3),
                              pts=np.round(c, 2).reshape(-1).tolist()))
        elif o['kind'] == 'sail':
            tri = []
            for f in o['faces']:
                for k in range(1, len(f) - 1):
                    tri += [f[0] - o['v0'], f[k] - o['v0'], f[k + 1] - o['v0']]
            sails.append(dict(name=o['name'], color=mtl.get(o['mtl'], [0.95, 0.92, 0.85]),
                              verts=np.round(pts, 2).reshape(-1).tolist(), tris=tri))
        elif o['kind'] == 'model' and with_models:
            # 網格存相對於外框最小角的座標（0.01 格）；幾何＋材質一樣的只存一份（24 門 carronade ⇒ 兩舷各一份）
            org = np.floor(pts.min(axis=0))
            rel = np.round(pts - org, 2)
            tri, tm, mats = [], [], []
            for f, m in zip(o['faces'], o['fmtl']):
                c = mtl.get(m, [0.5, 0.5, 0.5])
                if c not in mats:
                    mats.append(c)
                for k in range(1, len(f) - 1):
                    tri += [f[0] - o['v0'], f[k] - o['v0'], f[k + 1] - o['v0']]
                    tm.append(mats.index(c))
            mesh = dict(verts=rel.reshape(-1).tolist(), tris=tri, tmat=tm, mats=mats)
            key = json.dumps(mesh, separators=(',', ':'))
            if key not in mesh_key:
                mesh_key[key] = len(meshes)
                meshes.append(mesh)
            mx = pts.max(axis=0)
            models.append(dict(name=o['name'], mesh=mesh_key[key], origin=[int(v) for v in org],
                               bbox=[round(float(v), 2) for v in list(pts.min(axis=0)) + list(mx)]))
        else:
            skipped[o['kind']] += 1
    rig = dict(ropes=ropes, sails=sails)
    if with_models:
        rig['models'] = models
        rig['meshes'] = meshes
    return rig, dict(skipped)


def pack(a, header):
    keys = a[:, :3] // CHUNK
    order = np.lexsort((keys[:, 0], keys[:, 1], keys[:, 2]))
    a = a[order]; keys = keys[order]
    uk, inv = np.unique(keys, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    data = np.zeros((len(uk), CHUNK ** 3), np.uint8)
    loc = a[:, :3] - keys * CHUNK
    data[inv, loc[:, 0] + CHUNK * loc[:, 1] + CHUNK * CHUNK * loc[:, 2]] = a[:, 3]
    header = dict(header, nchunks=int(len(uk)))
    hj = json.dumps(header, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    raw = MAGIC + struct.pack('<I', len(hj)) + hj + uk.astype('<u2').tobytes() + data.tobytes()
    co = zlib.compressobj(9, zlib.DEFLATED, -15)
    return co.compress(raw) + co.flush(), header


def unpack(blob):
    raw = zlib.decompress(blob, -15)
    if raw[:4] != MAGIC:
        raise ValueError('不是 VXK1')
    n = struct.unpack('<I', raw[4:8])[0]
    h = json.loads(raw[8:8 + n].decode('utf-8'))
    p = 8 + n
    uk = np.frombuffer(raw, '<u2', h['nchunks'] * 3, p).reshape(-1, 3).astype(np.int32)
    p += h['nchunks'] * 6
    data = np.frombuffer(raw, np.uint8, h['nchunks'] * CHUNK ** 3, p).reshape(h['nchunks'], CHUNK ** 3)
    ci, li = np.nonzero(data)
    lx = li % CHUNK; ly = (li // CHUNK) % CHUNK; lz = li // (CHUNK * CHUNK)
    out = np.stack([uk[ci, 0] * CHUNK + lx, uk[ci, 1] * CHUNK + ly, uk[ci, 2] * CHUNK + lz, data[ci, li]], 1).astype(np.int32)
    return h, out


def main():
    sys.stdout.reconfigure(encoding='utf-8')     # -I 會略過 PYTHONIOENCODING；cp950 主控台印不出 ✓
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--links', default='')
    ap.add_argument('--rig', action='store_true')
    ap.add_argument('--parts', action='store_true')
    ap.add_argument('--models', action='store_true', help='連模型匯入的子模型一起（要配 --rig）')
    ap.add_argument('--list', default='', help='用既有的 export format=list 檔（省掉一次匯出）')
    ap.add_argument('--works-root', default=WORKS_ROOT_DEFAULT)
    ap.add_argument('--meta', action='store_true', help='關聯（--parts）與模型（--rig --models）多帶 meta 與 points；header 多 points')
    ap.add_argument('--senate', default='senate', help='senate 執行檔（預設 PATH 上的 senate）')
    o = ap.parse_args()
    global SENATE
    SENATE = o.senate

    t0 = time.time()
    tmp = tempfile.mkdtemp(prefix='vxk_')
    src = o.list
    if not src:
        src = os.path.join(tmp, 'list.txt').replace('\\', '/')
        export_list(o.work, o.links, src)
    a, heads = read_list(src)
    if len(a) == 0:
        sys.exit('✗ 作品沒有任何一格')
    if a[:, 3].min() < 1:
        sys.exit('✗ 有色值 0 的格 —— .vxk 用 0 當「空」，這種作品要先改封裝格式')
    work = json.load(open(os.path.join(o.works_root, o.work, 'work.json'), encoding='utf-8'))
    header = dict(format='vxk', version=1, work=o.work, title=work.get('title', ''), owner=work.get('owner', ''),
                  meters_per_voxel=work.get('meters_per_voxel') or 0.1,
                  size=[work['size_x'], work['size_y'], work['size_z']],
                  bbox=[int(v) for v in a[:, :3].min(0)] + [int(v) for v in a[:, :3].max(0)],
                  chunk=CHUNK, voxels=int(len(a)), checksum=checksum(a), palette='rgb332',
                  colors={str(k): v for k, v in sorted(Counter(a[:, 3].tolist()).items())},
                  source=[h for h in heads if h.startswith('link ')], exported_at=time.strftime('%Y-%m-%dT%H:%M:%S'))
    if o.parts:
        header['parts'] = read_parts(o.work, o.works_root)
    if o.rig:
        rig, skipped = read_rig(o.work, tmp, o.models)
        header['rig'] = rig
        header['rig_skipped'] = skipped
    if o.meta:
        # 平的 meta（{鍵: 字串或數字}）＋ points（{名字: [x,y,z]}）—— ame 2026-10-12 酒館 seq 24096 議定的形狀；對不上路徑就停（⛔ 不靜默少一筆）
        root_pts, by_link, by_model = read_meta(o.work, o.links, tmp)
        header['points'] = root_pts
        for p in header.get('parts', []):
            q = by_link.get(p['path'])
            if q is None:
                sys.exit('✗ 部件清單裡沒有關聯 `%s`' % p['path'])
            p['meta'], p['points'] = q['meta'], q['points']
        for m in header.get('rig', {}).get('models', []):
            q = by_model.get(m['name'])
            if q is None:
                sys.exit('✗ 部件清單裡沒有模型 `%s`' % m['name'])
            m['meta'], m['points'] = q['meta'], q['points']
    blob, header = pack(a, header)

    # 對拍：封裝回讀 ＝ 匯出清單（逐格、逐色）
    h2, b = unpack(blob)
    sa = a[np.lexsort((a[:, 3], a[:, 2], a[:, 1], a[:, 0]))]
    sb = b[np.lexsort((b[:, 3], b[:, 2], b[:, 1], b[:, 0]))]
    if len(sa) != len(sb) or not np.array_equal(sa, sb) or checksum(b) != header['checksum']:
        sys.exit('✗ 對拍不過：封裝回讀 %d 格 vs 匯出 %d 格' % (len(sb), len(sa)))

    os.makedirs(os.path.dirname(os.path.abspath(o.out)), exist_ok=True)
    with open(o.out, 'wb') as f:
        f.write(blob)
    print('✓ %s → %s' % (o.work, o.out))
    print('  格數 %d（%d 色）、非空 %d³ 區塊 %d、checksum %08x' % (header['voxels'], len(header['colors']), CHUNK, header['nchunks'], header['checksum']))
    print('  封裝 %.2f MB（deflate-raw；base64 內嵌後約 %.2f MB）' % (len(blob) / 1e6, len(blob) * 4 / 3 / 1e6))
    if o.rig:
        print('  繩 %d、帆 %d；略過 %s' % (len(header['rig']['ropes']), len(header['rig']['sails']), header['rig_skipped'] or '無'))
        if o.models:
            print('  模型 %d（網格 %d 份，去重後）' % (len(header['rig']['models']), len(header['rig']['meshes'])))
    if o.parts:
        print('  關聯外框 %d 條' % len(header['parts']))
    if o.meta:
        items = header.get('parts', []) + header.get('rig', {}).get('models', [])
        print('  meta：%d 筆帶 meta、固定點 %d 個（本作品 %d）' % (sum(1 for x in items if x['meta']), sum(len(x['points']) for x in items) + len(header['points']), len(header['points'])))
    print('  對拍：封裝回讀 ＝ 匯出清單（逐格、逐色）✓　%.1f 秒' % (time.time() - t0))


if __name__ == '__main__':
    main()
