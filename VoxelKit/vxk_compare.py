# 區塊職責：兩份 .vxk 對拍（TASK-0518）—— senate 直接產的（C#，export format=vxk）跟 voxel_export.py 產的，解開之後比。
# 物理意義：比的是「解開之後」—— 格子逐格逐色、header 逐欄；⛔ 不比壓縮後的位元組（deflate 實作不同就會不同；ame 2026-10-12 酒館 seq 24096）。
#           容差只給浮點那幾格（ame 點的三格）：繩中線與網格頂點 0.01 格取整的邊界、顏色 0.0001；模型網格比內容，再比去重後的份數。
#           exported_at 不比（每次匯出不同）。header 多出或少了欄位一律報。
# 用法：python -I vxk_compare.py <a.vxk> <b.vxk> [--tamper] [--max 20]
#   --tamper：反向對照 —— 把 b 解開後的第一格換個色再比，⛔ 這時一定要報不同（不然這支對拍永遠是綠的）
# 結束碼：0 ＝ 相同（容差內）；1 ＝ 不同（印出前 --max 筆）。
import argparse, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voxel_export as V

TOL_PT = 0.011        # 0.01 取整的邊界（兩邊各取一次 ⇒ 最多差 0.01）
TOL_COLOR = 1e-4
TOL_RADIUS = 0.002
TOL_POINT = 1e-3      # 固定點（兩邊都是同一個公式算的，只差浮點）
SKIP = {'exported_at'}


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('a'); ap.add_argument('b')
    ap.add_argument('--tamper', action='store_true')
    ap.add_argument('--max', type=int, default=20)
    o = ap.parse_args()
    ha, va = V.unpack(open(o.a, 'rb').read())
    hb, vb = V.unpack(open(o.b, 'rb').read())
    if o.tamper and len(vb):
        vb = vb.copy()
        vb[0, 3] = 1 if vb[0, 3] != 1 else 2
        print('⚠ --tamper：b 的 (%d,%d,%d) 換成色 %d（反向對照：這一趟一定要報不同）' % (vb[0, 0], vb[0, 1], vb[0, 2], vb[0, 3]))
    diffs = []
    def d(msg):
        diffs.append(msg)

    # 格子
    sa = va[np.lexsort((va[:, 3], va[:, 2], va[:, 1], va[:, 0]))]
    sb = vb[np.lexsort((vb[:, 3], vb[:, 2], vb[:, 1], vb[:, 0]))]
    if len(sa) != len(sb):
        d('格數 %d vs %d' % (len(sa), len(sb)))
    elif not np.array_equal(sa, sb):
        bad = np.nonzero((sa != sb).any(axis=1))[0]
        d('格子不同 %d 格（第一格 a %s vs b %s）' % (len(bad), sa[bad[0]].tolist(), sb[bad[0]].tolist()))
    if V.checksum(sb) != hb['checksum']:
        d('b 的格子 checksum %08x ≠ header %08x' % (V.checksum(sb), hb['checksum']))

    # header
    keys = (set(ha) | set(hb)) - SKIP
    for k in sorted(keys):
        if k not in ha or k not in hb:
            d('header 欄位 `%s` 只在 %s' % (k, 'a' if k in ha else 'b')); continue
        if k == 'parts':
            cmp_parts(ha[k], hb[k], d)
        elif k == 'rig':
            cmp_rig(ha[k], hb[k], d)
        elif k == 'points':
            cmp_points('header', ha[k], hb[k], d)
        elif k == 'meters_per_voxel':
            if abs(ha[k] - hb[k]) > 1e-9: d('meters_per_voxel %r vs %r' % (ha[k], hb[k]))
        elif ha[k] != hb[k]:
            d('header `%s`：%s vs %s' % (k, short(ha[k]), short(hb[k])))

    print('a：%s（%d 格）\nb：%s（%d 格）' % (o.a, len(va), o.b, len(vb)))
    if diffs:
        print('✗ 不同 %d 處（前 %d）：' % (len(diffs), min(o.max, len(diffs))))
        for x in diffs[:o.max]:
            print('  - ' + x)
        sys.exit(1)
    rig = ha.get('rig', {})
    print('✓ 相同（容差內）：格子 %d、header %d 欄（不比 exported_at）%s%s' % (
        len(va), len(keys),
        '；繩 %d、帆 %d、模型 %d（網格 %d 份）' % (len(rig.get('ropes', [])), len(rig.get('sails', [])), len(rig.get('models', [])), len(rig.get('meshes', []))) if rig else '',
        '；關聯 %d' % len(ha['parts']) if 'parts' in ha else ''))


def short(x):
    s = repr(x)
    return s if len(s) < 120 else s[:117] + '…'


def near(a, b, tol):
    a = np.asarray(a, float); b = np.asarray(b, float)
    return a.shape == b.shape and (a.size == 0 or float(np.abs(a - b).max()) <= tol)


def by(lst, key):
    out = {}
    for x in lst:
        out[x[key]] = x
    return out


def cmp_points(where, a, b, d):
    if set(a) != set(b):
        d('%s 固定點名字不同：只在 a %s、只在 b %s' % (where, sorted(set(a) - set(b)), sorted(set(b) - set(a)))); return
    for k in a:
        if not near(a[k], b[k], TOL_POINT):
            d('%s 固定點 `%s`：%s vs %s' % (where, k, a[k], b[k]))


def cmp_meta_points(where, a, b, d):
    if ('meta' in a) != ('meta' in b) or a.get('meta') != b.get('meta'):
        d('%s meta：%s vs %s' % (where, a.get('meta'), b.get('meta')))
    if ('points' in a) != ('points' in b):
        d('%s points 只在 %s' % (where, 'a' if 'points' in a else 'b'))
    elif 'points' in a:
        cmp_points(where, a['points'], b['points'], d)


def cmp_parts(pa, pb, d):
    A, B = by(pa, 'path'), by(pb, 'path')
    if [x['path'] for x in pa] != [x['path'] for x in pb]:
        d('parts 路徑或順序不同：只在 a %s、只在 b %s' % (sorted(set(A) - set(B))[:5], sorted(set(B) - set(A))[:5]))
    for k in A:
        if k not in B: continue
        for f in ('src', 'turn', 'mirror', 'box'):
            if A[k].get(f) != B[k].get(f):
                d('parts `%s` %s：%s vs %s' % (k, f, A[k].get(f), B[k].get(f)))
        cmp_meta_points('parts `%s`' % k, A[k], B[k], d)


def cmp_rig(ra, rb, d):
    if set(ra) != set(rb):
        d('rig 欄位：%s vs %s' % (sorted(ra), sorted(rb)))
    for kind, fields in (('ropes', None), ('sails', None)):
        A, B = by(ra.get(kind, []), 'name'), by(rb.get(kind, []), 'name')
        if [x['name'] for x in ra.get(kind, [])] != [x['name'] for x in rb.get(kind, [])]:
            d('rig.%s 名字或順序不同（%d vs %d）' % (kind, len(A), len(B)))
        for k in A:
            if k not in B: continue
            a, b = A[k], B[k]
            if not near(a['color'], b['color'], TOL_COLOR): d('%s `%s` color %s vs %s' % (kind, k, a['color'], b['color']))
            if kind == 'ropes':
                if abs(a['radius'] - b['radius']) > TOL_RADIUS: d('rope `%s` radius %s vs %s' % (k, a['radius'], b['radius']))
                if not near(a['pts'], b['pts'], TOL_PT): d('rope `%s` 中線（%d vs %d 個數）差超過 %.3f' % (k, len(a['pts']), len(b['pts']), TOL_PT))
            else:
                if a['tris'] != b['tris']: d('sail `%s` 三角形不同' % k)
                if not near(a['verts'], b['verts'], TOL_PT): d('sail `%s` 頂點（%d vs %d 個數）差超過 %.3f' % (k, len(a['verts']), len(b['verts']), TOL_PT))
            # meta 也要比（2026-10-19：持火號帆段 set 1 → 3 只改了 meta ⇒ 被判「內容相同」、admin.py reimport 不換 .vxk，遊戲一直是舊的帆段）。
            #   ⛔ 不比 bind（admin.py ropebind 匯入後才寫進 _cache 那一份，雕刻作品剛匯出的沒有 ⇒ 每次都會判不同）。
            if ('meta' in a) != ('meta' in b) or a.get('meta') != b.get('meta'): d('%s `%s` meta：%s vs %s' % (kind[:-1], k, a.get('meta'), b.get('meta')))
    if 'models' in ra or 'models' in rb:
        ma, mb = ra.get('models', []), rb.get('models', [])
        if len(ra.get('meshes', [])) != len(rb.get('meshes', [])):
            d('去重後的網格份數 %d vs %d' % (len(ra.get('meshes', [])), len(rb.get('meshes', []))))
        A, B = by(ma, 'name'), by(mb, 'name')
        if [x['name'] for x in ma] != [x['name'] for x in mb]:
            d('rig.models 名字或順序不同（%d vs %d）' % (len(A), len(B)))
        share_a, share_b = {}, {}
        for k in A:
            if k not in B: continue
            a, b = A[k], B[k]
            if a['origin'] != b['origin']: d('model `%s` origin %s vs %s' % (k, a['origin'], b['origin']))
            if not near(a['bbox'], b['bbox'], TOL_PT): d('model `%s` bbox %s vs %s' % (k, a['bbox'], b['bbox']))
            share_a.setdefault(a['mesh'], set()).add(k); share_b.setdefault(b['mesh'], set()).add(k)
            xa, xb = ra['meshes'][a['mesh']], rb['meshes'][b['mesh']]
            if xa['tris'] != xb['tris'] or xa['tmat'] != xb['tmat']: d('model `%s` 網格的三角形／材質索引不同' % k)
            if not near(xa['verts'], xb['verts'], TOL_PT): d('model `%s` 網格頂點差超過 %.3f' % (k, TOL_PT))
            if not near(xa['mats'], xb['mats'], TOL_COLOR): d('model `%s` 網格材質色不同' % k)
            # 換色的擺放（TASK-0584）：擺放上的 mats 代替網格的 mats ⇒ 比「這個擺放實際畫的色」；有沒有這一欄也要一樣（⛔ 只比網格 ⇒ 改了換色會被判「內容相同」、reimport 不換 .vxk）
            if ('mats' in a) != ('mats' in b): d('model `%s` 換色 mats：%s vs %s' % (k, 'mats' in a, 'mats' in b))
            elif 'mats' in a and not near(a['mats'], b['mats'], TOL_COLOR): d('model `%s` 換色 mats 不同' % k)
            # 自帶格子（Blockside admin.py prop_vox：螺旋槳、主機、鍋爐的 vox）：⛔ 不比 ⇒ 松島號的主機補上格子也被判「內容相同」、reimport 不換 .vxk（2026-10-21）
            if a.get('vox') != b.get('vox'): d('model `%s` vox（自帶格子）：%s vs %s' % (k, 'vox' in a and '%s+%s' % (a['vox'].get('o'), a['vox'].get('s')), 'vox' in b and '%s+%s' % (b['vox'].get('o'), b['vox'].get('s'))))
            cmp_meta_points('model `%s`' % k, a, b, d)
        # 去重的鍵：哪幾個模型共用一份網格要一樣
        ga = sorted(sorted(s) for s in share_a.values()); gb = sorted(sorted(s) for s in share_b.values())
        if ga != gb: d('模型共用網格的分組不同（a %d 組、b %d 組）' % (len(ga), len(gb)))


if __name__ == '__main__':
    main()
