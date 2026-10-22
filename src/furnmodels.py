"""道具的模型（TASK-0569）：雕刻作品匯出的 .vxk（目錄作品：一件道具一個外部模型、meta kind=furniture、item=<道具代號>）⇒ src/js/37_furnmodels.js（FURN_MODEL）。

  python -I src/furnmodels.py <目錄作品的 .vxk> [更多 .vxk…]

- 網格照檔裡的（0.1 m 一單位、相對模型原點；雕刻引擎匯出時已經乘上放上船的縮放），座標取到 1/1000、顏色取到 1/10000。
- 同一個 item 出現兩次 ⇒ 後面的蓋前面的；沒有 meta.item 的模型略過。
- 遊戲端：36_rooms.js furnMesh 有 FURN_MODEL[item] 就用模型，沒有才照舊拼方塊（furnBoxes）。
- 輸出照 item 排序、固定格式 ⇒ 同一份輸入兩次逐位元組相同。
目前的來源：Sculpture 的 basecamp-medbay-furniture-01m（病床、手術台、藥箱）；重匯：
  senate cmd sculpture --arg op=export --arg work=basecamp-medbay-furniture-01m --arg format=vxk --arg include=rig,models,parts,meta --arg out=<絕對路徑>
"""
import json, os, struct, sys, zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'js', '37_furnmodels.js')


def read_vxk(path):
    raw = zlib.decompress(open(path, 'rb').read(), -15)
    if raw[:4] != b'VXK1': raise SystemExit('%s：不是 VXK1' % path)
    hn = struct.unpack('<I', raw[4:8])[0]
    return json.loads(raw[8:8 + hn].decode('utf-8'))


def r(v, k): return round(float(v), k)


def main(paths):
    got, src = {}, []
    for p in paths:
        h = read_vxk(p)
        rig = h.get('rig') or {}
        meshes = rig.get('meshes') or []
        n = 0
        for mdl in rig.get('models') or []:
            meta = mdl.get('meta') or {}
            it = meta.get('item')
            if meta.get('kind') != 'furniture' or not it: continue
            m = meshes[mdl['mesh']]
            v = m['verts']
            size = [r(max(v[k::3]), 3) for k in range(3)]
            o = mdl.get('origin') or [0, 0, 0]
            got[it] = dict(name=mdl.get('name') or it, size=size,
                           verts=[r(x, 3) for x in v], tris=[int(x) for x in m['tris']], tmat=[int(x) for x in m['tmat']],
                           mats=[[r(c, 4) for c in col[:3]] for col in m['mats']],
                           pts={k: [r(a - b, 3) for a, b in zip(pt, o)] for k, pt in sorted((mdl.get('points') or {}).items())})
            n += 1
        src.append('%s（%s，%d 件）' % (h.get('work') or os.path.basename(p), str(h.get('checksum') or '')[:16], n))
    if not got: raise SystemExit('沒有任何 kind=furniture 的模型')
    body = ',\n'.join('  %s: %s' % (json.dumps(k), json.dumps(got[k], ensure_ascii=False, separators=(',', ':'))) for k in sorted(got))
    js = ('// ───────────────────────── 道具的模型（TASK-0569；src/furnmodels.py 產生，⛔ 不要手改） ─────────────────────────\n'
          '// 來源：' + '；'.join(src) + '\n'
          '// 每件：size 外框（0.1 m 格）、verts／tris／tmat／mats（36_rooms.js furnMesh 照這個畫、算佔用格）、pts 固定點（相對模型原點；lie 躺的地方、head 枕頭、work-n 站著做事的地板格）。\n'
          'var FURN_MODEL = {\n' + body + '\n};\n')
    open(OUT, 'w', encoding='utf-8', newline='\n').write(js)
    print('✓ %s：%s（%d 位元組）' % (os.path.relpath(OUT), '、'.join('%s %s 三角形 %d' % (k, got[k]['size'], len(got[k]['tris']) // 3) for k in sorted(got)), len(js.encode('utf-8'))))


if __name__ == '__main__':
    if len(sys.argv) < 2: raise SystemExit(__doc__)
    main(sys.argv[1:])
