# 區塊職責：Sirius 的水手立繪（ArtGallery/RawImages/sirius_sailor_*_sprite_v1.png，白底）⇒ art/crew.png（單圖：1 欄 × 13 列，每格 96×192，只存一份）。
# 物理意義：遊戲的船員格子：列 ＝ 角色；0 砲手、1 送藥手、2 軍官、3 陸戰隊、4 桅頂水手、5 舵手、6 船長（每艘船第一個軍官畫成船長）、
#           7–12 Sirius 2026-10-17 的六位（護士、木匠、廚師、帆匠、航海士、軍需官；新職位 TASK-0676，還沒接上的列遊戲照職位那一列畫）。
#           人一律朝右、腳底（兩隻靴子的中心）在格子底邊正中。動作由遊戲的程式做（js/41_crew_art.js 的 crewPose），每個角色只要一張站姿。
# 換色（Tim 2026-10-17：匯入時用特殊顏色標記換色區塊、只記錄一份圖、遊戲內由程式上色，之後還能支援多色；頭髮也標，遊戲裡隨機髮色）：
#   · 圖裡只有標記色，換好的顏色不進圖（遊戲載入後才上色，41_crew_art.js crewArt）：
#       布   (L, 0, L)：要換隊色的布（深藍：色相 214–234°、飽和 ≥ 0.36、不亮）；L ＝ 那一點的亮度 ÷ 全部布的中位亮度 × 100
#       頭髮 (0, L, L)：HAIR 寫明的頭髮；L ＝ 那一點的亮度 ÷ 這張頭髮的中位亮度 × 100（每張自己的中位 ⇒ 換成哪一色都是那一色的明暗）
#     L 4 一階、4–252。遊戲：隊色（config/game.json teamCloth）× L／100、髮色（hairColors）× L／100。
#     其他像素保證不撞標記色（G ＝ 0 且 R ＝ B ⇒ G 改 1；R ＝ 0 且 G ＝ B ⇒ R 改 1）。
#   · 頭髮不靠一條顏色規則猜：HAIR 每張寫明頭髮在哪（area）、臉在哪（face，不算）、幾塊一定是頭髮與一定不是的取樣（hair／not）；
#     area 裡、臉以外的點照最近的取樣顏色分（Lab，5 近鄰投票）。座標是那張在身高 1.0 時縮好的像素（w ＝ 那時的寬），身高 0.75 照比例。
#   · 頭髮跟布同色的（辮子、航海士的深藍頭髮）：KEEP 那一塊的布不換隊色。
#   · 印出的「布的中位色」＝ 藍隊在設定檔裡的那一格（藍隊看起來跟原圖一樣）。
# 設計取捨：
#   · 去背：碰到邊的「亮而中性」區塊 ＝ 背景（白底 ≈ (253,253,253)，奶油色襯衫 (253,242,222) 不中性 ⇒ 保留）；
#     被身體圍住的空隙要很白、很平、夠大才算背景（白帽子有明暗）；最後清掉貼著背景的淺色毛邊。
#   · 縮小：原圖是放大過的像素畫（948×1659）⇒ 用面積平均縮到格高的 85%，alpha 再切成 0／255（遊戲用 alpha 去背）。
#   · 調色盤（PNG-8）自己排：0 透明、標記色每一階一格（精確）、其他顏色 k-means（每種顏色份量 √點數 ⇒ 小塊的顏色不被併成灰）。
#   · 道具：陸戰隊的火槍、軍官與船長的劍（拿在身上，不伸出格子）。送藥手是小孩 ⇒ 身高 0.75。
# 用法：python -I make_crew.py [RawImages 的路徑]   （在 art/src/ 底下跑，寫到 ../crew.png；沒給路徑 ⇒ Valhalla/ArtGallery/RawImages）
#       python -I make_crew.py [路徑] --check <png>   （另外存一張檢查圖：頭髮綠、布洋紅）
import os
import sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.cluster.vq import kmeans2
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.normpath(os.path.join(HERE, '..', '..', '..', '..', 'ArtGallery', 'RawImages'))   # Blockside 與 ArtGallery 同在 Valhalla 底下（worktree 裡跑要給路徑）
CW, CH = 96, 192
H_PX = 164                       # 站著的人在格子裡的高度（格高 192 的 85%）
# 列：（立繪, 身高倍率, 道具）
ROWS = [
    ('braid', 1.0, None),          # 0 砲手
    ('chestnut', 0.75, None),      # 1 送藥手（小孩）
    ('first_mate', 1.0, 'sword'),  # 2 軍官
    ('chestnut', 1.0, 'musket'),   # 3 陸戰隊
    ('boatswain', 1.0, None),      # 4 桅頂水手（繩圈）
    ('chestnut', 1.0, None),       # 5 舵手
    ('captain', 1.0, 'sword'),     # 6 船長
    ('surgeon', 1.0, None),        # 7 護士（船醫那張；Tim：醫療艙換成護士）
    ('carpenter', 1.0, None),      # 8 木匠
    ('cook', 1.0, None),           # 9 廚師
    ('sailmaker', 1.0, None),      # 10 帆匠
    ('navigator', 1.0, None),      # 11 航海士
    ('quartermaster', 1.0, None),  # 12 軍需官
]
# 頭髮：w ＝ 身高 1.0 時的寬；方框 (x0, y0, x1, y1)，像素、不含 x1／y1
HAIR = {
    'braid': dict(w=55, area=[(8, 11, 45, 34), (14, 34, 24, 53)], face=[(20, 19, 34, 34)],
                  hair=[(10, 16, 14, 24), (36, 20, 40, 26), (16, 40, 20, 46)], no=[(22, 24, 30, 30), (9, 42, 13, 47)]),
    'chestnut': dict(w=53, area=[(5, 9, 45, 35)], face=[(19, 19, 34, 35)],
                     hair=[(9, 17, 13, 22), (31, 12, 36, 16), (38, 22, 41, 26)], no=[(23, 24, 29, 30), (20, 4, 30, 7), (22, 8, 30, 10)]),
    'first_mate': dict(w=55, area=[(9, 12, 42, 35)], face=[(19, 17, 33, 35)],
                       hair=[(12, 22, 16, 30), (33, 22, 37, 30), (18, 14, 24, 17)], no=[(22, 24, 28, 30), (20, 4, 32, 9)]),
    'boatswain': dict(w=55, area=[(7, 10, 44, 33)], face=[(19, 17, 35, 33)],
                      hair=[(10, 17, 15, 21), (36, 15, 40, 20), (20, 11, 26, 14)], no=[(22, 24, 28, 30), (16, 3, 30, 8)]),
    'captain': dict(w=59, area=[(10, 10, 44, 33)], face=[(22, 17, 36, 33)],
                    hair=[(13, 19, 17, 26), (37, 16, 40, 23), (24, 12, 30, 15)], no=[(26, 24, 32, 30), (16, 3, 26, 7), (20, 8, 34, 10)]),
    'surgeon': dict(w=58, area=[(8, 1, 47, 31)], face=[(25, 13, 38, 31)],
                    hair=[(14, 6, 22, 13), (39, 12, 43, 19), (12, 18, 16, 24)], no=[(27, 22, 33, 28)]),
    'carpenter': dict(w=58, area=[(8, 8, 47, 30)], face=[(23, 15, 39, 30)],
                      hair=[(10, 12, 15, 18), (40, 16, 44, 22), (18, 12, 22, 15)], no=[(27, 22, 33, 28), (18, 3, 30, 8)]),
    'cook': dict(w=55, area=[(6, 9, 46, 33)], face=[(25, 14, 40, 33)],
                 hair=[(9, 17, 14, 22), (39, 14, 44, 22), (36, 9, 40, 12), (8, 22, 12, 27)], no=[(29, 22, 35, 29), (18, 4, 28, 9)]),
    'sailmaker': dict(w=55, area=[(10, 8, 42, 33), (13, 33, 27, 53)], face=[(22, 17, 37, 33)],
                      hair=[(13, 15, 17, 20), (36, 12, 40, 18), (18, 36, 22, 42), (22, 10, 28, 13)],
                      no=[(25, 22, 31, 28), (11, 40, 15, 46), (28, 42, 31, 46), (20, 3, 30, 8)]),
    'navigator': dict(w=55, area=[(10, 12, 42, 30), (11, 30, 19, 33), (32, 30, 41, 35)], face=[(19, 16, 34, 30)],
                      hair=[(12, 15, 16, 22), (35, 16, 39, 24)], no=[(24, 22, 30, 28)]),
    'quartermaster': dict(w=56, area=[(9, 9, 44, 31)], face=[(21, 16, 38, 31)],
                          hair=[(12, 17, 17, 22), (38, 14, 42, 20), (22, 11, 28, 14)], no=[(26, 22, 32, 28), (15, 3, 30, 8)]),
}
HAIR_NAVY = {'braid', 'navigator'}   # 頭髮跟布同色：分頭髮時不先扣掉布
# 不換隊色的區塊（頭髮跟布同色）：人物外框裡的比例座標 (x0, y0, x1, y1)
KEEP = {
    'navigator': [(0.18, 0.073, 0.84, 0.207), (0.60, 0.207, 0.82, 0.226)],   # 深藍頭髮：帽簷下面到肩上（帽子的帶子、外套照換）
    'braid': [(0.15, 0.04, 0.70, 0.25)],                                        # 黑辮子（偏藍紫）：頭的那一段
}
CLOTH_HUE = (214, 234)
CLOTH_SAT = 0.36
CLOTH_VAL = 0.62
L_MID = 100                      # 標記色的 L：中位亮度 ＝ 100
L_STEP = 4                       # L 每 4 一階（調色盤留給其他顏色；亮度差 4% 看不出來）


def cutout(path):
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.int16)
    mn, mx = a.min(axis=2), a.max(axis=2)
    spread = mx - mn
    cand = (mn >= 236) & (spread <= 12)
    lab, n = ndimage.label(cand)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(edge))
    idx = np.arange(1, n + 1)
    sizes = ndimage.sum(np.ones_like(lab), lab, index=idx)
    mean_mn = ndimage.mean(mn, lab, index=idx)
    mean_sp = ndimage.mean(spread, lab, index=idx)
    inner = [i + 1 for i in range(n) if (i + 1) not in edge and sizes[i] >= 300 and mean_mn[i] >= 249 and mean_sp[i] <= 3]
    bg |= np.isin(lab, inner)
    lum = a.mean(axis=2)
    for _ in range(3):
        near = ndimage.binary_dilation(bg, structure=np.ones((3, 3), bool)) & ~bg
        fringe = near & (lum >= 200) & (spread <= 30)
        if not fringe.any():
            break
        bg |= fringe
    return Image.fromarray(np.dstack([a.astype(np.uint8), np.where(bg, 0, 255).astype(np.uint8)]), 'RGBA')


def load(name, scale):
    im = cutout(os.path.join(RAW, 'sirius_sailor_%s_sprite_v1.png' % name))
    im = im.crop(im.getbbox())
    h = round(H_PX * scale)
    w = max(1, round(im.width * h / im.height))
    # 面積平均（先乘 alpha，免得背景的白滲進邊緣），再把 alpha 切成 0／255
    p = np.asarray(im).astype(np.float32)
    p[..., :3] *= p[..., 3:4] / 255
    small = np.asarray(Image.fromarray(p.astype(np.uint8), 'RGBA').resize((w, h), Image.BOX)).astype(np.float32)
    al = small[..., 3:4]
    rgb = np.where(al > 0, small[..., :3] * 255 / np.maximum(al, 1), 0)
    out = np.dstack([np.clip(rgb, 0, 255), np.where(al[..., 0] >= 128, 255, 0)]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def hsv(a):
    f = a[..., :3].astype(np.float32) / 255
    mx, mn = f.max(2), f.min(2)
    d = np.maximum(mx - mn, 1e-6)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    return hue, sat, mx


def cloth_rule(im):
    """深藍的布（色相、飽和、亮度）。"""
    a = np.asarray(im)
    hue, sat, val = hsv(a)
    return (a[..., 3] > 0) & (hue >= CLOTH_HUE[0]) & (hue <= CLOTH_HUE[1]) & (sat >= CLOTH_SAT) & (val <= CLOTH_VAL)


def lab(rgb):
    c = rgb.astype(np.float32) / 255
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    xyz = c @ np.array([[0.4124, 0.2126, 0.0193], [0.3576, 0.7152, 0.1192], [0.1805, 0.0722, 0.9505]], np.float32)
    xyz /= np.array([0.9505, 1.0, 1.089], np.float32)
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def boxes(spec, key, im):
    """HAIR 的方框（身高 1.0 時的像素）⇒ 這一張（可能是 0.75）的遮罩。"""
    sx, sy = im.width / spec['w'], im.height / H_PX
    m = np.zeros((im.height, im.width), bool)
    for x0, y0, x1, y1 in spec.get(key, []):
        m[int(round(y0 * sy)):int(round(y1 * sy)), int(round(x0 * sx)):int(round(x1 * sx))] = True
    return m


def hair_mask(name, im, cloth):
    spec = HAIR.get(name)
    if not spec:
        return np.zeros((im.height, im.width), bool)
    a = np.asarray(im)
    op = a[..., 3] > 0
    L = lab(a[..., :3])
    hs, ns = boxes(spec, 'hair', im) & op, boxes(spec, 'no', im) & op
    pts = np.concatenate([L[hs], L[ns]])
    lbl = np.concatenate([np.ones(hs.sum()), np.zeros(ns.sum())])
    cand = boxes(spec, 'area', im) & ~boxes(spec, 'face', im) & op
    if name not in HAIR_NAVY:
        cand &= ~cloth
    _, nb = cKDTree(pts).query(L[cand], k=5)
    m = np.zeros_like(cand)
    m[cand] = lbl[nb].mean(1) > 0.5
    return m | (hs & (cloth if name in HAIR_NAVY else True))


def cloth_mask(name, im, hair):
    m = cloth_rule(im) & ~hair
    for x0, y0, x1, y1 in KEEP.get(name, []):
        m[round(y0 * im.height):round(y1 * im.height), round(x0 * im.width):round(x1 * im.width)] = False
    return m


def luma(rgb):
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def level(y, mid):
    return np.clip(np.round(y / mid * L_MID / L_STEP) * L_STEP, L_STEP, 252).astype(np.uint8)


def cell(fig, prop):
    """一格：腳底（最下面 14 列不透明像素的平均欄）放在格子底邊正中。"""
    c = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
    a = np.asarray(fig)[..., 3] > 0
    foot = np.nonzero(a[-14:])[1].mean() + 0.5
    x0, y0 = int(round(CW / 2 - foot)), CH - 2 - fig.height
    x0 = min(max(0, x0), CW - fig.width)
    c.alpha_composite(fig, (x0, y0))
    d = ImageDraw.Draw(c)
    w, h = fig.width, fig.height
    if prop == 'musket':                                                # 火槍：直立靠在右手邊
        d.line([(x0 + w * 0.80, y0 + h * 0.97), (x0 + w * 0.86, y0 + h * 0.22)], fill=(75, 54, 33, 255), width=3)
    if prop == 'sword':                                                 # 劍：掛在腰間
        d.line([(x0 + w * 0.70, y0 + h * 0.50), (x0 + w * 0.88, y0 + h * 0.78)], fill=(207, 214, 220, 255), width=2)
    return c


def markers(rgba):
    op = rgba[..., 3] > 0
    r, g, b = rgba[..., 0], rgba[..., 1], rgba[..., 2]
    return op & (g == 0) & (r == b), op & (r == 0) & (g == b)


def to_png8(rgba):
    """調色盤自己排：0 透明、布與頭髮的標記色每一階一格（精確）、其他顏色 k-means ⇒ 存成 PNG-8。"""
    H, W = rgba.shape[:2]
    mc, mh = markers(rgba)
    lc, lh = np.unique(rgba[mc][:, 0]), np.unique(rgba[mh][:, 1])
    rest = (rgba[..., 3] > 0) & ~mc & ~mh
    n_rest = 255 - 1 - len(lc) - len(lh)
    px = rgba[rest][:, :3].astype(np.float32)
    # k-means：每種顏色的份量 ＝ √點數 ⇒ 小塊的顏色（船醫的綠領巾、航海士的青領巾）也分得到格子（median cut 會把它們併成灰）
    u, cnt = np.unique(px, axis=0, return_counts=True)
    c, _ = kmeans2(np.repeat(u, np.ceil(np.sqrt(cnt)).astype(int), axis=0), n_rest, minit='++', iter=30, seed=1)
    qp = np.clip(np.round(c), 0, 255).astype(np.uint8)
    qp[(qp[:, 1] == 0) & (qp[:, 0] == qp[:, 2]), 1] = 1                # 量化後的顏色也不准撞標記色
    qp[(qp[:, 0] == 0) & (qp[:, 1] == qp[:, 2]), 0] = 1
    idx = np.zeros((H, W), np.uint8)
    idx[mc] = np.searchsorted(lc, rgba[mc][:, 0]) + 1
    idx[mh] = np.searchsorted(lh, rgba[mh][:, 1]) + 1 + len(lc)
    idx[rest] = cKDTree(qp.astype(np.float32)).query(px)[1] + 1 + len(lc) + len(lh)
    pal = [0, 0, 0] + [v for l in lc for v in (int(l), 0, int(l))] + [v for l in lh for v in (0, int(l), int(l))] + qp.reshape(-1).tolist()
    out = Image.fromarray(idx, 'P')
    out.putpalette(pal + [0] * (768 - len(pal)))
    out.info['transparency'] = 0
    return out, (len(lc), len(lh), n_rest)


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    global RAW
    args = sys.argv[1:]
    check = None
    if '--check' in args:
        k = args.index('--check'); check = args[k + 1]; del args[k:k + 2]
    if args:
        RAW = args[0]
    figs, cm, hm = {}, {}, {}
    for name, scale, _ in ROWS:
        key = (name, scale)
        if key not in figs:
            figs[key] = load(name, scale)
            hm[key] = hair_mask(name, figs[key], cloth_rule(figs[key]))
            cm[key] = cloth_mask(name, figs[key], hm[key])
    allc = np.concatenate([np.asarray(figs[k])[..., :3][cm[k]].astype(np.float32) for k in figs])
    ymid = float(np.median(luma(allc)))
    blue = np.median(allc, axis=0)
    cells = Image.new('RGBA', (CW, CH * len(ROWS)), (0, 0, 0, 0))
    chk = Image.new('RGBA', (CW * len(ROWS), CH), (0, 0, 0, 0))
    for r, (name, scale, prop) in enumerate(ROWS):
        key = (name, scale)
        a = np.asarray(figs[key]).copy()
        mc, mh = cm[key], hm[key]
        y = luma(a[..., :3].astype(np.float32))
        Lc = level(y, ymid)
        Lh = level(y, float(np.median(y[mh]))) if mh.any() else Lc
        op = a[..., 3] > 0
        a[op & (a[..., 1] == 0) & (a[..., 0] == a[..., 2]), 1] = 1     # 非標記的像素不准長得像標記色
        a[op & (a[..., 0] == 0) & (a[..., 1] == a[..., 2]), 0] = 1
        a[mc, 0] = Lc[mc]; a[mc, 1] = 0; a[mc, 2] = Lc[mc]
        a[mh, 0] = 0; a[mh, 1] = Lh[mh]; a[mh, 2] = Lh[mh]
        cells.alpha_composite(cell(Image.fromarray(a, 'RGBA'), prop), (0, r * CH))
        if check:
            v = np.asarray(figs[key]).copy()
            v[mc, :3] = (v[mc, :3] * 0.3 + np.array([255, 0, 255]) * 0.7).astype(np.uint8)
            v[mh, :3] = (v[mh, :3] * 0.3 + np.array([0, 255, 0]) * 0.7).astype(np.uint8)
            chk.alpha_composite(cell(Image.fromarray(v, 'RGBA'), None), (r * CW, 0))
    rgba = np.asarray(cells).copy()
    out, (nc, nh, nrest) = to_png8(rgba)
    dst = os.path.normpath(os.path.join(HERE, '..', 'crew.png'))
    out.save(dst, optimize=True)
    # 讀回來核：標記色一格不差、其他像素沒有一點撞到標記色
    back = np.asarray(Image.open(dst).convert('RGBA'))
    bc, bh = markers(back)
    mc, mh = markers(rgba)
    assert (bc == mc).all() and (bh == mh).all(), '標記色讀回來位置不一致'
    assert (back[mc][:, 0] == rgba[mc][:, 0]).all() and (back[mh][:, 1] == rgba[mh][:, 1]).all(), '標記色讀回來亮度不一致'
    print('✓ %s（%d×%d，%d 列角色、只存一份，%.1f KB）' % (dst, out.width, out.height, len(ROWS), os.path.getsize(dst) / 1e3))
    print('  標記色：布 %d 階（%d 點）、頭髮 %d 階（%d 點）；其他顏色 %d 格；布的中位亮度 %.1f ⇒ L %d' % (nc, int(mc.sum()), nh, int(mh.sum()), nrest, ymid, L_MID))
    print('  藍隊（布的中位色，設定檔 teamCloth.blue）：[%d, %d, %d]' % tuple(int(round(v)) for v in blue))
    if check:
        chk.resize((chk.width * 2, chk.height * 2), Image.NEAREST).save(check)
        print('  檢查圖：%s（頭髮綠、布洋紅）' % check)


if __name__ == '__main__':
    main()
