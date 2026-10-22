# 區塊職責：《憲法號對轟》的設定後台（TASK-0542）—— config/game.json（各項設定的初始值、船隻清單）的唯一寫入端：
#           驗設定、照船隻清單改寫 template.html 的船標籤、重建單檔成品、匯入新船、重新匯入舊船；serve 開一頁本機後台（同一組函式）。
# 物理意義：遊戲建置時把 game.json 內嵌進成品（js/00_config.js 讀成 CFG）⇒ 改預設 ＝ 改這份檔再重建，不是改 js。
#           船的 .vxk 由 senate 從雕刻作品匯出到 VoxelKit/_cache/（不入版控），vxk_inline.py 內嵌進成品。
# 失敗處置：設定不合法 ⇒ 列出每一格錯在哪、不寫檔；匯出／建置失敗 ⇒ 原樣印出那支工具的輸出、非零結束；
#           重新匯入失敗 ⇒ 舊的 .vxk 不動（新的先寫到 .new，成功才換上，舊的留成 .prev）。
#           _cache 跟指紋（config/vxk_lock.json）對不上 ⇒ 建置前從版控的成品換回，換不回就擋下（cache_guard）。
#
# 用法（在這個資料夾）：
#   python -I admin.py serve [--port 8642] [--open]  開設定後台（只聽 127.0.0.1）⇒ 瀏覽器開 http://127.0.0.1:8642/（--open 自動開；已經開著 ⇒ 只開頁面）
#     一鍵：雙擊 Blockside 根目錄的 admin.cmd（＝ serve --open）
#   python -I admin.py check                      驗 config/game.json
#   python -I admin.py build                      照設定重建 ../index.html（Blockside 根目錄 ＝ GitHub Pages 的首頁）
#   python -I admin.py build --code [--base <版>]  只重建程式（入口 index.html；船檔 ships/ 照舊）—— 沒有 VoxelKit/_cache 的機器用，船變了就擋（見「只重建程式」）
#   python -I admin.py shell <外殼設定> [--check]  外掛外殼：拿建好的成品套別的遊戲的外殼寫成另一頁（見「外掛外殼」）
#   python -I admin.py layers [--shell]           分層讀數：模擬層直接用到上層的名字；--shell ＝ 核心直接用到外殼（主選單、設定頁；SHELL_UI）的名字、直接碰 #cover 的 DOM
#   python -I admin.py reseg                      船檔照現在的切法重切（ship_segments 改了、這台沒有 _cache 時；解回來逐位元組相同才寫，見「船檔重切」）
#   python -I admin.py import --work <雕刻作品 ID> --id <船的代號> --name <名字>   匯入新船（匯出 .vxk、登記、重建）
#   python -I admin.py metasync --id <船的代號>   只同步 meta 與固定點（作品改了 meta、加了固定點，格子不動；TASK-0572）
#   python -I admin.py reimport --id <船的代號> [--work <作品 ID>]                 重新匯入（換新的 .vxk、印跟上一版的差別、重建）
#   python -I admin.py cache                      _cache/ 缺的、跟指紋不同的 .vxk 從版控那份成品裡解回來（換機器、只改程式時用；建置也會自己做）
#   python -I admin.py ids --id <船的代號> [--dry]  物件 id：發號、指名別的部件的 meta 換成 id、寫回雕刻作品再 metasync（TASK-0715；造船規格 §12）
#   python -I admin.py ropebind [--id <船的代號>]   繩端綁定：成品算好每條繩兩端綁在哪、寫進 .vxk 檔頭、出報表（TASK-0716；匯入、重新匯入、metasync、ids 會自己跑）
#   python -I admin.py cells --id <船的代號>      只寫動力件與梯子的格子清單（meta、格子不動；TASK-0676 木匠照它還原整件梯子）
#   python -I admin.py relock --id <船的代號>     指紋改成 _cache 現在那份（手動換過 .vxk 時；平常匯入／重新匯入／metasync 會自己更新）
#   加 --no-build：匯入／重新匯入之後不重建
import argparse, base64, hashlib, json, math, os, posixpath, re, shutil, socket, struct, subprocess, sys, urllib.request, webbrowser, zlib
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
CFG_P = os.path.join(HERE, 'config', 'game.json')
TPL = os.path.join(HERE, 'template.html')
OUT = os.path.normpath(os.path.join(HERE, '..', 'index.html'))   # 成品在 Blockside 根目錄（GitHub Pages 發的就是這一份）
PAGE = os.path.normpath(os.path.join(HERE, '..', 'admin.html'))
VKD = os.path.normpath(os.path.join(HERE, '..', 'VoxelKit'))   # Blockside 自己帶一份 VoxelKit（2026-10-15 從 ArtGallery/VoxelKit 複製，853b4e7）
CACHE = os.path.join(VKD, '_cache')
INLINE = os.path.join(VKD, 'vxk_inline.py')
SHIPS_A, SHIPS_B = '—— ships 開始 -->\n', '<!-- ships 結束 -->'


# ───────────────────────── _cache 的指紋（.vxk 跟版控對得上才建） ─────────────────────────
# _cache 不入版控、建置直接讀它 ⇒ 它落後了（別的工作區 reimport／metasync 過、只拿到版控的成品）建置不會叫，成品默默換成舊船
#   （2026-10-14 bc1dfd9：艙房、甲板 meta 全掉）。⇒ 每艘 .vxk 的 sha1 記在 config/vxk_lock.json（入版控），建置前比：
#   對得上 ⇒ 照建；對不上 ⇒ 版控的成品裡內嵌的那份對得上指紋就自動換回（原檔留成 .stale）；也對不上 ⇒ 擋下不建（⛔ 不猜哪一份才對）。
#   匯入／重新匯入／metasync 寫了 .vxk 就更新指紋；要改用 _cache 現在那份（例如手動換過檔）⇒ relock。
LOCK_P = os.path.join(HERE, 'config', 'vxk_lock.json')
MUSIC_JS = os.path.join(HERE, 'js', '02_music.js')


def theme_ids():
    """船的主題曲（TASK-0681）：js/02_music.js 的 THEMES 裡有哪些 id（ships[].theme 要是其中一個）。照原文抓 `var THEMES = [` 到下一個 `];` 之間的 `{ id: '…'` —— 抓不到 ⇒ 空（每艘寫了 theme 的都會報錯，不會靜靜放過）。"""
    try:
        t = open(MUSIC_JS, encoding='utf-8').read()
    except OSError:
        return []
    m = re.search(r'^var THEMES = \[(.*?)^\];', t, re.S | re.M)
    return re.findall(r"^  \{ id: '([a-z0-9_-]+)'", m.group(1), re.M) if m else []




def sha1_bytes(b):
    return hashlib.sha1(b).hexdigest()


def vxk_fp(blob):
    """.vxk 的內容指紋（TASK-0586）：header（拿掉 exported_at、照鍵排序）＋格子那一段的 sha1，前面加 c:。
    ⛔ 不用整個檔的 sha1：同一件作品換一台機器重新匯出，匯出時間不同、壓縮串也可能不同 ⇒ 檔案雜湊一定不同，
    就沒辦法拿來「比對來源」（換機器時 _cache 是空的，只能從雕刻作品重新匯出）。跟 VoxelKit/vxk_compare.py 一樣只不比 exported_at。"""
    raw = zlib.decompress(blob, -15)
    n = struct.unpack('<I', raw[4:8])[0]
    h = json.loads(raw[8:8 + n].decode('utf-8'))
    h.pop('exported_at', None)
    hb = json.dumps(h, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    return 'c:' + sha1_bytes(hb + raw[8 + n:])


def file_fp(path):
    return vxk_fp(open(path, 'rb').read()) if os.path.exists(path) else None


def lock_load():
    if not os.path.exists(LOCK_P):
        return {}
    return json.load(open(LOCK_P, encoding='utf-8'))


def lock_save(L):
    with open(LOCK_P, 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(L, ensure_ascii=False, indent=1, sort_keys=True) + '\n')


def lock_put(vxk):
    """_cache 那份 .vxk 寫好之後：指紋換成它。"""
    L = lock_load()
    L[vxk] = file_fp(os.path.join(CACHE, vxk))
    lock_save(L)
    return '  指紋 %s ← %s（config/vxk_lock.json，要跟成品一起提交）' % (vxk, L[vxk][:12])


def built_vxk(html, el):
    m = re.search(r'<script type="application/x-vxk" id="%s">([^<]*)</script>' % re.escape(el), html)
    return base64.b64decode(m.group(1)) if m else None


def cache_guard():
    """建置前：_cache 的每艘 .vxk 對指紋（見上）。回傳要印的行；對不上又換不回 ⇒ Fail。"""
    cfg, L, log, html, dirty = load(), lock_load(), [], None, False
    os.makedirs(CACHE, exist_ok=True)
    for s in cfg['ships']:
        p, want = os.path.join(CACHE, s['vxk']), L.get(s['vxk'])
        if want and not want.startswith('c:') and os.path.exists(p) and sha1_bytes(open(p, 'rb').read()) == want:
            want = L[s['vxk']] = file_fp(p)              # 舊指紋（整個檔的 sha1）對得上 ⇒ 換成內容指紋（TASK-0586）
            dirty = True
            log.append('  指紋 %s：換成內容指紋 %s（舊的是整個檔的 sha1）' % (s['vxk'], want[:14]))
        have = file_fp(p)
        if want is None:                                 # 還沒登記（這個機制之前的船）⇒ 照 _cache 現在那份登記
            if have:
                L[s['vxk']], dirty = have, True
                log.append('  指紋 %s：第一次登記 %s（照 _cache 現在那份）' % (s['vxk'], have[:14]))
            continue
        if have == want:
            continue
        if not os.path.exists(p):
            raise Fail('%s：_cache 沒有這艘（換了機器？）⇒ python -I admin.py cache（從雕刻作品重新匯出、跟指紋比）' % s['vxk'])
        if html is None:
            html = open(OUT, encoding='utf-8').read() if os.path.exists(OUT) else ''
        b = built_vxk(html, s['el'])                     # 原格式的成品（build --raw）才換得回；壓縮版的網格換成了池子 ⇒ 指紋一定不同
        if b is not None and vxk_fp(b) == want:
            if have:
                shutil.copy2(p, p + '.stale')
            open(p, 'wb').write(b)
            log.append('  ↺ %s：_cache %s 跟指紋 %s 不同 ⇒ 從版控的成品換回%s' % (s['vxk'], (have or '（沒有）')[:12], want[:12], '（原檔留成 %s.stale）' % s['vxk'] if have else ''))
            continue
        raise Fail('%s：_cache %s 跟指紋 %s 不同，成品裡內嵌的也不是指紋那一份 ⇒ 不建（會把船換成別的版本）。\n'
                   '  要用 _cache 現在這份 ⇒ python -I admin.py relock --id %s；要雕刻作品的最新版 ⇒ python -I admin.py reimport --id %s'
                   % (s['vxk'], (have or '（沒有）')[:12], want[:12], s['id'], s['id']))
    if dirty:
        lock_save(L)
    return log


def act_relock(sid):
    cfg = load()
    s = next((x for x in cfg['ships'] if x['id'] == sid), None)
    if not s:
        raise Fail('沒有代號 %s 的船' % sid)
    if not os.path.exists(os.path.join(CACHE, s['vxk'])):
        raise Fail('_cache 沒有 ' + s['vxk'])
    return [lock_put(s['vxk'])]


def act_authors():
    """建造者（Tim 2026-10-15）：每艘船照 _cache 那份 .vxk 檔頭的 owner 記 ships[].author（匯入／重新匯入會自己記；這一支補以前匯入的船）。
    只改不一樣的；檔頭沒有 owner ⇒ 不動、照實列出來。⛔ 不重建（改的只是設定檔，下一次建置才進成品）。"""
    cfg = load()
    log, n = [], 0
    for s in cfg['ships']:
        info = vxk_info(os.path.join(CACHE, s['vxk']))
        own = (info or {}).get('owner')
        if not own:
            log.append('  ⚠ %s（%s）：%s' % (s['name'], s['id'], '_cache 沒有 ' + s['vxk'] if not info else '.vxk 檔頭沒有 owner ⇒ 不動'))
        elif s.get('author') == own:
            log.append('  ＝ %s（%s）：%s' % (s['name'], s['id'], own))
        else:
            log.append('  ✓ %s（%s）：%s → %s' % (s['name'], s['id'], s.get('author') or '（沒記）', own))
            s['author'] = own
            n += 1
    if n:
        save(cfg)
    return ['建造者（ships[].author ← .vxk 檔頭 owner）：改了 %d 艘' % n] + log

MENU = {'play': ('fun', 'real'), 'mode': ('pve', 'eve', 'sandbox', 'observe'), 'sail': ('auto', 'manual', 'off'),
        'gfx': ('low', 'mid', 'high', 'ultra'), 'phx': ('full', 'high', 'mid', 'low')}
SHIP_CFG_KEYS = ('hard', 'flood', 'gunw', 'speed', 'agile', 'upwind', 'base', 'pump', 'avoid')          # 每艘船的船隻設定（壓艙物照船算，不在這裡）；avoid：防撞參數（物件，不是滑桿；js/52_fleet.js avoidCfg）
MAT_ID = r'[a-z][a-z0-9_]{0,31}'                                                      # 材質 ID（TASK-0616）：雕刻作品關聯的 meta material 照它認

def mat_mix_err(mid, mids):
    """混合材質 ID（遊戲 05_material.js matMix；Tim 2026-10-21）：`iron*0.1`、`iron*0.5+oak*0.5`，成分是材質表的 ID 或 air、比例 0～1、加起來 ≤ 1、第一個不是 air。
    純 ID 也收（要在 mids 裡）。回錯誤字串；對 ⇒ None。"""
    if not isinstance(mid, str) or not mid:
        return '要是字串'
    if '*' not in mid and '+' not in mid:
        return None if mid in mids else '材質表沒有 %s' % mid
    tot = 0.0
    for k, q in enumerate(mid.split('+')):
        m = re.fullmatch(r'(' + MAT_ID + r')(?:\*(\d*\.?\d+))?', q)
        if not m:
            return '成分 %s 要寫成 <材質 ID>*<比例>' % q
        f = 1.0 if m.group(2) is None else float(m.group(2))
        if not 0 < f <= 1:
            return '成分 %s 的比例要在 0～1' % q
        if m.group(1) != 'air' and m.group(1) not in mids:
            return '材質表沒有 %s' % m.group(1)
        if k == 0 and m.group(1) == 'air':
            return '第一個成分不能是 air（外觀照第一個成分）'
        tot += f
    return None if tot <= 1 + 1e-9 else '比例加起來 %.3g，要 ≤ 1（沒寫滿的是空氣）' % tot
MAT_KINDS = ('wood', 'metal', 'other')                                               # 材質的分類（後台分組、之後燃燒照它）
MAT_NUMS = (('density', 0.05, 25, '比重（一格 0.1 m ＝ 1 公升 ⇒ 每格幾 kg；橡木 0.7）'), ('hard', 0.05, 50, '硬度倍率（乘在船隻設定的船殼硬度上；橡木 1）'),
            ('flammable', 0, 1, '易燃性（0 ＝ 不會燒、1 ＝ 一點就著；著火照它點、照它燒多久，js/49_burn.js）'))
# 著火（TASK-0717；js/49_burn.js 讀 CFG.burn，⛔ js 裡沒有第二份）：(鍵, 下限, 上限, 說明)；多的鍵、少的鍵都擋
BURN_NUMS = (('tick', 0.05, 2, '一拍幾秒（每格延燒、燒穿、救火照這個節奏）'), ('pace', 0.05, 4, '燒的快慢倍率（熱度、燒穿、延燒、竄火、帆；潑水與下雨照真的時間）'),
             ('ign', 1, 30, '希臘火潑開的點火半徑（格）'), ('ignP', 0, 1, '點火機率（× 材質的 flammable）'), ('ignMax', 1, 2000, '一發最多點著幾格'),
             ('h0', 0.05, 1, '延燒過去的格一開始的熱度（0–1；希臘火點的 ＝ 1）'), ('grow', 0, 5, '熱度每秒長多少（× flammable）'),
             ('spread', 0, 50, '滿熱度時每秒往鄰格試幾次'), ('up', 0, 20, '往上延燒的權重（橫向 ＝ 1）'), ('down', 0, 20, '往下延燒的權重'),
             ('jump', 0, 5, '火苗竄上一層的機率／秒（滿熱度）'), ('jumpZ', 2, 60, '火苗往上竄幾格內'),
             ('life', 1, 600, '橡木滿熱度燒穿要幾秒（× (1.5 − flammable)）'), ('reK', 0, 1, '焦過的格再著火的機率倍率'),
             ('max', 1, 100000, '每艘同時最多燒著幾格'), ('outMax', 1, 5000, '每拍最多燒穿幾格'), ('tintMax', 1, 20000, '每拍最多換色幾格（重建網格的量）'),
             ('crewPer', 1, 2000, '每幾格派一個人救火'), ('crewSpot', 0, 40, '每個火場最多幾個人'), ('crewShip', 0, 200, '每艘最多幾個人救火'),
             ('reach', 1, 100, '站的地方跟火的高度差（格）'), ('douse', 0, 500, '一個人每秒潑掉多少（熱度 × 格）'),
             ('hurt', 0, 200, '火場旁的人每秒燒傷（滿熱度，HP）'), ('hurtR', 0, 100, '燒傷的半徑（格，再加 √格數）'),
             ('keg', 0, 2000, '火場旁的火藥桶每秒扣多少（滿熱度）'), ('kegR', 0, 100, '烤火藥桶的半徑（格，再加 √格數）'),
             ('rain', 0, 10, '露天的格淋雨每秒降多少熱度（暴風雨）'), ('flameK', 0, 50, '火焰高度（格）＝ flameK × √格數（燒到帆）'), ('sailCatch', 0, 10, '火焰碰到帆的著火率／秒'),
             ('sailR', 0, 100, '希臘火潑開時點著帆的半徑（格）'), ('sailV', 0.01, 10, '帆上的火每秒燒多遠（m，橫向）'), ('sailUp', 0, 20, '往上燒快幾倍（垂直時 1＋sailUp）'),
             ('sailBurn', 0.5, 120, '火燒到之後幾秒燒穿成洞'), ('sailHp', 0, 5, '洞的面積比例 × 這個 ⇒ 扣幾成血量'), ('sailDrop', 0.05, 1, '燒掉幾成帆就掉'),
             ('sailJump', 0, 1, '燒口跳到旁邊那面帆的機率'), ('sailJumpR', 0, 100, '跳到旁邊的帆的距離（格）'),
             ('sailCrew', 0, 20, '每面著火的帆派幾個人'), ('cutT', 0, 120, '站到帆底下幾秒才潑熄／割下來'), ('sailReach', 0, 300, '帆腳離露天甲板幾格內潑得到（再高 ⇒ 割下來）'),
             ('rainSail', 0, 5, '下雨熄掉帆火的機率／秒（暴風雨）'),
             ('wetPer', 0, 2000, '潑濕：一個人（或一條水帶的一份）罩得住幾格不延燒、不重新著火'),
             ('hoseK', 0, 100, '一條水帶滿出水 ＝ 幾個人提水桶'), ('hoseR', 0, 1000, '水帶多長（格，平面距離）'), ('hoseZ', 0, 200, '水帶上下夠得到幾格'),
             ('engCrew', 0, 40, '內建消防泵幾個人搖（0 ＝ 沒有內建消防泵）'))
# 廚房（TASK-0720；js/45_galley.js 讀 CFG.galley，⛔ js 裡沒有第二份；加成的 % 在 lim.galley 滑桿）：(鍵, 下限, 上限, 整數?, 說明)；多的鍵、少的鍵都擋
IDLE_NUMS = (('arc', 0, 90, '閒著的砲班（TASK-0722）：射界外再多看幾度'), ('r', 0, 10, '射程的幾倍內都沒有敵艦才算閒著（0 ＝ 關掉：砲班一直守著自己的砲）'),
             ('t', 0.5, 30, '每幾秒判斷一次'), ('hold', 0, 120, '連續閒著幾秒才把砲手放出去當預備水手'))
# 火槍命中率（TASK-0633；js/40_crew.js musketP，沒寫的鍵照程式裡的預設；射程是另一格 lim.musket）
MUSKET_NUMS = (('sigma', 0.001, 0.2, '散布（弧度；1811 年 Brown Bess 試射反推 0.013）'), ('w', 0.1, 3, '露出來的寬（m）'),
               ('h', 0.1, 3, '甲板上的人露出來的高（m；舷牆後面只露上半身）'), ('hTop', 0.1, 3, '從桅頂往下看露出來的高（m）'),
               ('sway', 0, 2, '自己的船晃的影響（秒：散布多 sway × 船轉得多快 rad/s）'))
GALLEY_NUMS = (('cooks', 1, 4, True, '每座爐灶幾位廚師（全船上限 ＝ 船員配置 crew.cook）'), ('cookT', 1, 120, False, '一位效率 1 的廚師做好一鍋（一桌的份）要幾秒'),
               ('stock', 1, 40, True, '爐灶旁最多放幾鍋（開戰時是滿的）'), ('mess', 1, 40, True, '一桌幾個人物（伙夫一趟領一桌的飯）'),
               ('go', 1, 20, True, '同時最多幾個伙夫在路上或在領'), ('fetchT', 0, 30, False, '伙夫在爐灶旁盛飯要站幾秒'), ('waitT', 0, 120, False, '沒鍋可領最多等幾秒'),
               ('hold', 0, 600, False, '吃完滿加成維持幾秒（過了就算餓、開始派伙夫）'), ('fade', 0, 600, False, '之後線性退回 1 要幾秒'),
               ('start', 0, 1, True, '1 ＝ 開局算剛吃過'), ('douse', 0, 1, True, '1 ＝ 史實模式：敵艦進 dousR 內就熄火（不做新的，現成的照領）'), ('dousR', 50, 5000, False, '熄火距離（m）'))
# 航海士、軍需官的加成（TASK-0825；js/39_duty.js 讀 CFG.duty，⛔ js 裡只有沒寫時的同一組預設）：(鍵, 下限, 上限, 說明)；多的鍵、少的鍵都擋
DUTY_NUMS = (('navSpd', 0, 50, '航海士在崗：最高航速加幾 %（推力照平方乘；沒有動力 ⇒ 不會動）'), ('navTurn', 0, 100, '航海士在崗：最大轉向率加幾 %'),
             ('qmFill', 0, 200, '軍需官在崗：送藥手在取用點裝藥包快幾 %'), ('standIn', 0, 1, '航海士／軍需官不在崗、還有軍官能動 ⇒ 加成剩幾成（0 ＝ 不頂替）'))
MAT_OPT = (('metal', 0, 1, '金屬度（選填；0 ＝ 不反光、1 ＝ 金屬：太陽高光＋天空反射；TASK-0627）'), ('rough', 0, 1, '粗糙度（選填；0 ＝ 鏡面、1 ＝ 很霧；沒寫 ＝ 0.5）'),
           ('clear', 0, 0.95, '透明度（選填；0 ＝ 不透明、0.95 ＝ 幾乎看不見；寫了 ⇒ 這種材質的格畫成半透明的平面、看得到後面，反光照 rough 走同一條光滑表面（菲涅耳＋太陽高光）。TASK-0753 玻璃 glass）'),
           ('pen', 1, 5000, '擊穿門檻（選填；每格板厚要幾 kJ，船殼硬度倍率 1 時；寫了 ⇒ 實心彈照能量與入射角判穿／凹／彈，TASK-0621）'))
MAT_BOOL = (('smooth', '平滑（選填 true／false；true ⇒ 這種材質的格沒寫 render 也畫成平滑面＋金屬反光，螺旋槳整份平滑；關聯明寫 render=voxel 照方塊。Tim 2026-10-17：鐵甲、鍋爐開，包銅皮不開）'),)
CREW = {'officers': (0, 8, True), 'helm': (0, 4, True), 'marines': (0, 60, True), 'marineGap': (5, 200, True),
        'top': (0, 8, True), 'monkeys': (0, 2, True), 'handsK': (0, 4, False), 'shelter': (0, 1, True),   # shelter：船員避開露天甲板（TASK-0637；0／1）
        'surgeon': (0, 60, True), 'carpenter': (1, 20, True), 'sailmaker': (1, 20, True), 'cook': (0, 4, True), 'navigator': (0, 1, True), 'quartermaster': (0, 1, True)}   # 航海士、軍需官（TASK-0825，js/39_duty.js）   # 廚師（TASK-0720；有廚房 kind=galley 的船才上船）   # 帆匠（TASK-0699）                                           # 木匠（TASK-0676 ②）                                                                       # 船醫（TASK-0676；有醫療艙才上船）
CREW_SHIP = {'hands': (0, 120, True)}          # 只在每艘船寫（TASK-0570 船隻配置頁的預設）：預備水手人數；沒寫 ＝ lim.hands × handsK
GUN_CREW_MAX = 8                               # 砲班滿編上限（砲旁的站位；遊戲 05_hull.js GUN_CREW_MAX）
GEO_PAIRS = ('marines', 'aimZ', 'deckAim', 'rigAim')
GEO_NUMS = ('center', 'aim')


# ───────────────────────── 讀寫 ─────────────────────────
def load(path=CFG_P):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def dumps(o, ind=0):
    """JSON：純量的陣列、只含純量的短物件寫在一行（diff 好讀）；其餘照縮排。數字照 Python repr（跟 JS 的 JSON.stringify 同一個最短表示）。"""
    pad, pad1 = '  ' * ind, '  ' * (ind + 1)

    def flat(v):
        return not isinstance(v, (dict, list)) or (isinstance(v, list) and all(not isinstance(x, (dict, list)) for x in v))
    if isinstance(o, list):
        if all(flat(x) for x in o):
            return json.dumps(o, ensure_ascii=False, separators=(', ', ': '))
        return '[\n' + ',\n'.join(pad1 + dumps(x, ind + 1) for x in o) + '\n' + pad + ']'
    if isinstance(o, dict):
        one = json.dumps(o, ensure_ascii=False, separators=(', ', ': '))
        if all(flat(v) for v in o.values()) and len(one) + len(pad) < 150:
            return one
        return '{\n' + ',\n'.join(pad1 + json.dumps(k, ensure_ascii=False) + ': ' + dumps(v, ind + 1) for k, v in o.items()) + '\n' + pad + '}'
    return json.dumps(o, ensure_ascii=False)


def save(cfg):
    tmp = CFG_P + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        f.write(dumps(cfg) + '\n')
    os.replace(tmp, CFG_P)


# ───────────────────────── 驗設定 ─────────────────────────
def isnum(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def isint(v):
    return isnum(v) and float(v).is_integer()


def validate(cfg, prev=None):
    """回傳錯誤清單（空 ＝ 合法）。prev：磁碟上原本那份 ⇒ 原本有的鍵不能少（遊戲每一個都會讀）。"""
    E = []

    def err(p, m):
        E.append('%s：%s' % (p, m))
    if not isinstance(cfg, dict):
        return ['整份：不是物件']
    if cfg.get('v') != 1:
        err('v', '要是 1')
    L = cfg.get('limits') or {}
    ms = L.get('maxShips')
    if not (isint(ms) and 2 <= ms <= 16):
        err('limits.maxShips', '2～16 的整數（同時在場最多幾艘；著色器的陣列照它配）')
        ms = 16
    if not (isint(L.get('maskNear')) and 1 <= L.get('maskNear') <= ms):
        err('limits.maskNear', '1～同時在場上限 的整數')
    if not (isint(L.get('fleetMax')) and 2 <= L.get('fleetMax') <= 99):
        err('limits.fleetMax', '2～99 的整數（編成最多幾艘）')
    M = cfg.get('menu') or {}
    for k, opts in MENU.items():
        if M.get(k) not in opts:
            err('menu.' + k, '要是 ' + '／'.join(opts) + ' 其中一個')
    lim = cfg.get('lim')
    if not isinstance(lim, dict) or not lim:
        err('lim', '要是非空物件')
        lim = {}
    for k, r in lim.items():
        if not (isinstance(r, list) and len(r) == 3 and all(isnum(x) for x in r)):
            err('lim.' + k, '要是 [下限, 上限, 預設] 三個數字')
        elif not (r[0] <= r[2] <= r[1]):
            err('lim.' + k, '要 下限 ≤ 預設 ≤ 上限（%s）' % r)
    d = cfg.get('dist')
    if not (isinstance(d, list) and len(d) == 3 and all(isint(x) for x in d) and 1 <= d[0] <= d[2] <= d[1]):
        err('dist', '要是 [下限, 上限, 預設] 三個整數、下限 ≤ 預設 ≤ 上限')
    A = cfg.get('ammo') or {}
    al = A.get('lim')
    if not (isinstance(al, list) and len(al) == 2 and all(isint(x) for x in al) and 0 <= al[0] <= al[1]):
        err('ammo.lim', '要是 [下限, 上限] 兩個整數')
        al = [0, 1e9]
    ak = A.get('k')
    if not (isinstance(ak, list) and len(ak) == 3 and all(isinstance(r, list) and len(r) == 3 and all(isint(x) and al[0] <= x <= al[1] for x in r) for r in ak)):
        err('ammo.k', '要是 3×3 的整數（列 ＝ 實心／爆裂／鏈彈，欄 ＝ 對砲／對帆／對人），每格在 ammo.lim 裡')
    FI = cfg.get('fire')                                                                # 希臘火（TASK-0693；js/28_fire.js）
    if not (isinstance(FI, dict) and isinstance(FI.get('k'), list) and len(FI['k']) == 3 and all(isint(x) and 0 <= x <= 1000 for x in FI['k'])):
        err('fire.k', '要是三個整數（對砲／對帆／對人，%；0～1000）')
    elif not (isnum(FI.get('r')) and 1 <= FI['r'] <= 60):
        err('fire.r', '潑開的半徑（格，1～60）')
    BU = cfg.get('burn')                                                                # 著火（TASK-0717；js/49_burn.js）
    if not isinstance(BU, dict):
        err('burn', '要是物件（著火的參數，見 admin.py BURN_NUMS）')
    else:
        for f, lo, hi, what in BURN_NUMS:
            v = BU.get(f)
            if not (isnum(v) and lo <= v <= hi):
                err('burn.' + f, '%s（%s～%s）' % (what, lo, hi))
        for f in BU:
            if f not in [x[0] for x in BURN_NUMS]:
                err('burn.' + f, '不認得的鍵（admin.py BURN_NUMS 沒有）')
    DU = cfg.get('duty')                                                                # 航海士、軍需官（TASK-0825；js/39_duty.js）
    if not isinstance(DU, dict):
        err('duty', '要是物件（航海士、軍需官的加成，見 admin.py DUTY_NUMS）')
    else:
        for f, lo, hi, what in DUTY_NUMS:
            x = DU.get(f)
            if isinstance(x, bool) or not isinstance(x, (int, float)) or not lo <= x <= hi:
                err('duty.' + f, '%s（%s～%s 的數字）' % (what, lo, hi))
        for f in DU:
            if f not in [x[0] for x in DUTY_NUMS]:
                err('duty.' + f, '不認得的鍵（admin.py DUTY_NUMS 沒有）')
    GA = cfg.get('galley')                                                              # 廚房（TASK-0720；js/45_galley.js）
    if not isinstance(GA, dict):
        err('galley', '要是物件（廚房的參數，見 admin.py GALLEY_NUMS）')
    else:
        for f, lo, hi, it, what in GALLEY_NUMS:
            v = GA.get(f)
            if not ((isint(v) if it else isnum(v)) and lo <= v <= hi):
                err('galley.' + f, '%s（%s～%s 的%s）' % (what, lo, hi, '整數' if it else '數字'))
        for f in GA:
            if f not in [x[0] for x in GALLEY_NUMS]:
                err('galley.' + f, '不認得的鍵（admin.py GALLEY_NUMS 沒有）')
    ID = cfg.get('idle')                                                                # 閒著的砲班當預備水手（TASK-0722；js/42_hands.js gunIdle）
    if not isinstance(ID, dict):
        err('idle', '要是物件（閒著的砲班的參數，見 admin.py IDLE_NUMS）')
    else:
        for f, lo, hi, what in IDLE_NUMS:
            v = ID.get(f)
            if not (isnum(v) and lo <= v <= hi):
                err('idle.' + f, '%s（%s～%s）' % (what, lo, hi))
        for f in ID:
            if f not in [x[0] for x in IDLE_NUMS]:
                err('idle.' + f, '不認得的鍵（admin.py IDLE_NUMS 沒有）')
    MK = cfg.get('musket')                                                              # 火槍命中率（TASK-0633；js/40_crew.js musketP）：選填，寫了就驗
    if MK is not None:
        if not isinstance(MK, dict):
            err('musket', '要是物件（火槍命中率的參數，見 admin.py MUSKET_NUMS）')
        else:
            for f, lo, hi, what in MUSKET_NUMS:
                if f in MK and not (isnum(MK[f]) and lo <= MK[f] <= hi):
                    err('musket.' + f, '%s（%s～%s）' % (what, lo, hi))
            for f in MK:
                if f not in [x[0] for x in MUSKET_NUMS]:
                    err('musket.' + f, '不認得的鍵（admin.py MUSKET_NUMS 沒有）')
    G = cfg.get('guns')
    if not isinstance(G, dict) or not G:
        err('guns', '要是非空物件')
        G = {}
    codes = set()
    for k, g in G.items():
        p = 'guns.' + k
        if not isinstance(g, dict):
            err(p, '要是物件')
            continue
        for f in ('code', 'name', 'short'):
            if not (isinstance(g.get(f), str) and g.get(f)):
                err(p + '.' + f, '要是非空字串')
        if g.get('code') in codes:
            err(p + '.code', '跟別的砲種重複（雕刻作品的 meta gun 照它認）')
        codes.add(g.get('code'))
        for f in ('V', 'reload'):
            if not (isnum(g.get(f)) and g.get(f) > 0):
                err(p + '.' + f, '要是正數')
        if not (isnum(g.get('mass')) and g.get('mass') >= 0):
            err(p + '.mass', '要是 ≥ 0 的數字（噸）')
        if not isinstance(g.get('big'), bool):
            err(p + '.big', '要是 true／false')
        if 'hole' in g and not (isnum(g['hole']) and g['hole'] > 0):
            err(p + '.hole', '要是正數（沒寫 ＝ 1）')
        if 'shot' in g and not (isnum(g['shot']) and 0.1 <= g['shot'] <= 500):
            err(p + '.shot', '彈重：0.1～500 kg（沒寫 ＝ pen.ref；能量 ＝ ½ × 彈重 × 初速²，TASK-0621）')
        if 'hpK' in g and not (isnum(g['hpK']) and 0.1 <= g['hpK'] <= 20):
            err(p + '.hpK', '血量倍率：0.1～20（沒寫 ＝ 1；鐵甲砲塔這種整座的才調）')
        if 'burst' in g and not (isint(g['burst']) and 1 <= g['burst'] <= 20):
            err(p + '.burst', '連發：一份彈藥打幾發，1～20 的整數（沒寫 ＝ 1）')
        if 'burstGap' in g and not (isnum(g['burstGap']) and 0.02 <= g['burstGap'] <= 2):
            err(p + '.burstGap', '連發間隔：0.02～2 秒（沒寫 ＝ 0.15）')
        if 'box' in g and not (isint(g['box']) and 1 <= g['box'] <= 10):
            err(p + '.box', '彈藥量倍率：1～10 的整數（砲旁藥箱放 細節設定的份數 × 它；沒寫 ＝ 1）')
        if 'elev' in g and not (isnum(g['elev']) and 5 <= g['elev'] <= 85):
            err(p + '.elev', '最大仰角：5～85 度（沒寫 ＝ 15 度）')
        if 'lob' in g and not isinstance(g['lob'], bool):
            err(p + '.lob', '曲射：true／false（true ⇒ 走高的那條拋物線，投石機、臼砲）')
        if not (isint(g.get('crew')) and 1 <= g.get('crew') <= 8):
            err(p + '.crew', '1～8 的整數（砲旁的站位只有 8 個）')
        elif not (isint(g.get('min')) and 1 <= g.get('min') <= g.get('crew')):
            err(p + '.min', '1～滿編 的整數')

    def geo(gx, p, full):
        if not isinstance(gx, dict):
            err(p, '要是物件')
            return
        for k, v in gx.items():
            if k == 'spar':
                if v is not None and not (isinstance(v, list) and len(v) == 2 and all(isint(x) for x in v) and v[0] <= v[1]):
                    err(p + '.spar', 'null 或 [z0, z1] 兩個整數')
            elif k in GEO_PAIRS:
                if not (isinstance(v, list) and len(v) == 2 and all(isnum(x) for x in v) and (k == 'marines' or v[0] <= v[1])):
                    err(p + '.' + k, '要是兩個數字' + ('' if k == 'marines' else '、前 ≤ 後'))
            elif k in GEO_NUMS:
                if not isnum(v):
                    err(p + '.' + k, '要是數字')
            else:
                err(p + '.' + k, '不認得的鍵')
        if full:
            for k in ('spar',) + GEO_PAIRS + GEO_NUMS:
                if k not in gx:
                    err(p + '.' + k, '缺')

    def crew(cx, p, full):
        if not isinstance(cx, dict):
            err(p, '要是物件')
            return
        for k, v in cx.items():
            if k == 'guns' and not full:           # 每艘船的砲班滿編 { 砲種: 人 }（TASK-0570）：最少 ＝ 砲種表的 min
                if not isinstance(v, dict):
                    err(p + '.guns', '要是物件')
                    continue
                G = cfg.get('guns') if isinstance(cfg.get('guns'), dict) else {}
                for t, n in v.items():
                    g = G.get(t)
                    if not isinstance(g, dict):
                        err(p + '.guns.' + t, '不認得的砲種')
                    elif not (isint(n) and isint(g.get('min')) and g['min'] <= n <= GUN_CREW_MAX):
                        err(p + '.guns.' + t, '%s～%s 的整數' % (g.get('min'), GUN_CREW_MAX))
                continue
            spec = CREW.get(k) or (None if full else CREW_SHIP.get(k))
            if not spec:
                err(p + '.' + k, '不認得的鍵')
                continue
            lo, hi, it = spec
            if not ((isint(v) if it else isnum(v)) and lo <= v <= hi):
                err(p + '.' + k, '%s～%s 的%s' % (lo, hi, '整數' if it else '數字'))
        if full:
            for k in CREW:
                if k not in cx:
                    err(p + '.' + k, '缺')
    geo(cfg.get('geo0'), 'geo0', True)
    crew(cfg.get('crew0'), 'crew0', True)
    FU, RT = cfg.get('furniture') or {}, cfg.get('rooms') or {}
    for fid, f in FU.items():                            # 道具的數字（js/67_furncfg.js 調得到的那幾格；遊戲照它擺、算抽水、治療）
        for k, lo, hi in (('tpm', 0, 120), ('crew', 1, 12), ('cap', 0, 300), ('hold', 1, 4), ('rate', 1, 10), ('doc', 0, 1), ('hp', 10, 1000)):   # rate：躺在上面治療快幾倍、doc：要船醫才收傷員（手術台；js/44_medic.js）
            if isinstance(f, dict) and k in f and not (isnum(f[k]) and lo <= f[k] <= hi):
                err('furniture.%s.%s' % (fid, k), '%s～%s 的數字' % (lo, hi))
        if isinstance(f, dict) and 'auto' in f and not (isint(f['auto']) and 1 <= f['auto'] <= 4):
            err('furniture.%s.auto' % fid, '1～4 的整數（每船至少幾張）')
        if isinstance(f, dict) and 'autoDeck' in f and not (isint(f['autoDeck']) and 0 <= f['autoDeck'] <= 4):   # 抽水機（TASK-0604；js/45_pumps.js pumpFill）：甲板是自動的時候擺幾台
            err('furniture.%s.autoDeck' % fid, '0～4 的整數（甲板是自動的時候每船擺幾台；0 ＝ 不擺）')
        for k, lo, hi in (('wood', 0, 20000), ('cloth', 0, 20000), ('carry', 10, 2000)):   # 木工台的木材（js/46_carpenter.js）、帆布櫃的帆布（js/47_sailmaker.js）
            if isinstance(f, dict) and k in f and not (isint(f[k]) and lo <= f[k] <= hi):
                err('furniture.%s.%s' % (fid, k), '%s～%s 的整數' % (lo, hi))
        hb = (f.get('buff') or {}).get('heal') if isinstance(f, dict) else None
        if hb is not None and not (isnum(hb) and 0 <= hb <= 1):
            err('furniture.%s.buff.heal' % fid, '0～1（治療速度加成）')
        st = f.get('staff') if isinstance(f, dict) else None                # 設施配員（TASK-0676；js/36_rooms.js staffSlots）：{ 職位: 每件幾位 }
        if st is not None and not (isinstance(st, dict) and all(k in ('surgeon', 'carpenter', 'sailmaker') and isint(v) and (1 if k in ('carpenter', 'sailmaker') else 0) <= v <= 4 for k, v in st.items())):
            err('furniture.%s.staff' % fid, '{ surgeon: 0～4、carpenter: 1～4、sailmaker: 1～4 的整數 }（每件配幾位；木匠、帆匠每船至少一位）')
    PT = cfg.get('parts')                                 # 零件表（TASK-0714；admin.py parts 寫的）：{ guns: { 砲種: { 砲架類別: '<船 id>#<模型 id>' } } }
    if PT is not None:
        G0 = cfg.get('guns') if isinstance(cfg.get('guns'), dict) else {}
        SID = {x.get('id') for x in (cfg.get('ships') or []) if isinstance(x, dict)}
        PG = PT.get('guns') if isinstance(PT, dict) else None
        if not (isinstance(PT, dict) and set(PT) <= {'guns'} | set(FIT_KINDS) and isinstance(PG, dict)):
            err('parts', '零件表 { guns: { 砲種: { 砲架類別: "<船 id>#<模型 id>" } }, <kind>: { "<船 id>#<模型 id>": 名字 } }（python -I admin.py parts 寫的，別手改）')
        else:
            for t, v in PG.items():
                if t not in G0 or not isinstance(v, dict) or not all(isinstance(r, str) and r.count('#') == 1 and r.split('#')[0] in SID and ID_RE.fullmatch(r.split('#')[1]) for r in v.values()):
                    err('parts.guns.' + str(t), '砲種要在 guns 裡，值 { 砲架類別: "<船 id>#<模型 id>" }、船要在 ships 裡（python -I admin.py parts 重產）')
            for k in set(PT) - {'guns'}:
                v = PT[k]
                if not (isinstance(v, dict) and all(isinstance(r, str) and r.count('#') == 1 and r.split('#')[0] in SID and isinstance(n, str) for r, n in v.items())):
                    err('parts.' + k, '{ "<船 id>#<模型 id>": 名字 }、船要在 ships 裡（python -I admin.py parts 重產）')
    KY = cfg.get('keys')                                  # 鍵位的出廠預設（js/66_keys.js：{ 動作: 鍵 }；動作的清單在遊戲裡 ⇒ 這裡只驗形狀，認不得的動作遊戲不收）
    if KY is not None:
        if not isinstance(KY, dict):
            err('keys', '要是 { 動作: 鍵 }')
        else:
            for a, k in KY.items():
                if not (isinstance(k, str) and 1 <= len(k) <= 12) or re.match(r'^(escape|arrow(up|down|left|right)|tab|capslock|meta|os|control|contextmenu|f\d+|\?)$', k):
                    err('keys.%s' % a, '一個鍵（KeyboardEvent.key 小寫，空白鍵 ＝ " "；Esc、方向鍵、Tab、F1–F12 不能綁）')
    RP = cfg.get('report')                                 # 問題回報送到 Discord（js/01_gl.js errPost；Tim 2026-10-18「幫我額外傳送資訊到這個Discord webhook」）：webhook 空 ⇒ 沒有「送出回報」
    if RP is not None:
        if not isinstance(RP, dict):
            err('report', '要是 { webhook, cooldown, perSession }')
        else:
            for k in RP:
                if k not in ('webhook', 'cooldown', 'perSession'):
                    err('report.' + k, '不認得的鍵（webhook、cooldown、perSession）')
            wh = RP.get('webhook')
            if wh and not (isinstance(wh, str) and wh.startswith('x1:') and HOOK_RE.match(hook_dec(wh))):
                err('report.webhook', '要是加密過的 Discord webhook（x1:…；在設定後台貼明文網址，存檔時自動加密）；空字串 ＝ 不送'
                    if isinstance(wh, str) and HOOK_RE.match(wh) else '解不開或不是 Discord webhook 網址（https://discord.com/api/webhooks/<id>/<token>）；空字串 ＝ 不送')
            if 'cooldown' in RP and not (isnum(RP['cooldown']) and 10 <= RP['cooldown'] <= 3600):
                err('report.cooldown', '兩次送出至少隔幾秒：10～3600')
            if 'perSession' in RP and not (isint(RP['perSession']) and 1 <= RP['perSession'] <= 50):
                err('report.perSession', '開一次遊戲最多送幾則：1～50')
    for kd, f in (cfg.get('drvparts') or {}).items():     # 動力件（TASK-0653；js/31_drive.js DRVP、67_furncfg.js DRV_ITEMS）
        if kd not in DRV_KINDS + VOXM_KINDS + HPM_KINDS or not isinstance(f, dict):
            err('drvparts.%s' % kd, '種類只有 ' + '／'.join(DRV_KINDS + VOXM_KINDS + HPM_KINDS))
            continue
        for k, lo, hi in (('lo', 0, 0.95), ('hi', 0.05, 1), ('wet', 0, 1), ('cell', 0, 1), ('hpK', 0.1, 5)):
            if k in f and not (isnum(f[k]) and lo <= f[k] <= hi):
                err('drvparts.%s.%s' % (kd, k), '%s～%s 的數字' % (lo, hi))
        if isnum(f.get('lo')) and isnum(f.get('hi')) and not f['lo'] < f['hi']:
            err('drvparts.%s' % kd, 'lo（剩幾成就沒力）要小於 hi（剩幾成還是全力）')
    for sec, most in (('teamCloth', 8), ('hairColors', 16)):   # 船員換色（js/41_crew_art.js：隊色照船的 team、髮色每人挑一個；著色器的表最多 8 隊、16 色）
        T = cfg.get(sec)
        if T is None:
            continue
        if not (isinstance(T, dict) and 1 <= len(T) <= most):
            err(sec, '要是 { 英文 ID: [R, G, B] }，1～%d 個' % most)
            continue
        for k, c in T.items():
            if not (re.match(r'^[a-z][a-z0-9_]*$', k) and isinstance(c, list) and len(c) == 3 and all(isint(x) and 0 <= x <= 255 for x in c)):
                err('%s.%s' % (sec, k), 'ID 英文小寫；顏色 [R, G, B] 各 0～255 的整數')

    def rooms(rm, p):
        # 甲板與艙房的預設（TASK-0568；遊戲 36_rooms.js）：{ 房名: '類型'（艙房自動擺滿）｜{ type, items: [{ it, x, y, r }] }（自訂；甲板 type=deck）}
        #   房名、格子要船型才驗得了 ⇒ 這裡只驗形狀；開戰時遊戲照格子再驗一次（擺不下的不擺）
        if not isinstance(rm, dict):
            return err(p, '要是物件 { 房名: 類型或擺法 }')
        for k, v in rm.items():
            q = p + '.' + k
            if isinstance(v, str):
                if v not in RT or RT[v].get('deck'):
                    err(q, '不認得的艙房類型 %s（rooms 裡的：%s）' % (v, '、'.join(x for x in RT if not RT[x].get('deck'))))
                continue
            if not (isinstance(v, dict) and v.get('type') in RT and isinstance(v.get('items'), list)):
                err(q, "要是類型字串或 { type, items }")
                continue
            for j, it in enumerate(v['items']):
                if not (isinstance(it, dict) and it.get('it') in FU and isint(it.get('x')) and isint(it.get('y')) and 0 <= it['x'] < 400 and 0 <= it['y'] < 400 and it.get('r', 0) in (0, 1)):
                    err('%s.items[%d]' % (q, j), '{ it: 物品, x, y: 0～399 的整數, r: 0 或 1 }')
                elif RT[v['type']].get('items') and it['it'] not in RT[v['type']]['items']:
                    err('%s.items[%d]' % (q, j), '%s 不能擺在 %s' % (it['it'], v['type']))
    DV = cfg.get('drive')                                # 動力（TASK-0630，31_drive.js）：kDrag 水阻係數、side 帆的側向力、tele 俥鐘每一格的航速比例、teleNames 名字
    if DV is not None:
        if not isinstance(DV, dict):
            err('drive', '要是物件')
        else:
            if 'kDrag' in DV and not (isnum(DV['kDrag']) and DV['kDrag'] > 0):
                err('drive.kDrag', '正數（水阻係數：k ＝ kDrag × 排水量^⅔）')
            if 'side' in DV and not (isnum(DV['side']) and 0 <= DV['side'] <= 3):
                err('drive.side', '0～3（帆的側向力 ＝ 推力 × side × |sin 相對風向|）')
            T = DV.get('tele')
            if T is not None and not (isinstance(T, list) and len(T) >= 2 and all(isnum(x) and -1 <= x <= 1 for x in T) and 1 in T):
                err('drive.tele', '俥鐘每一格的航速比例：−1～1 的數字清單，要有 1（全速前進）')
            N = DV.get('teleNames')
            if N is not None and not (isinstance(N, list) and isinstance(T, list) and len(N) == len(T) and all(isinstance(x, str) and x for x in N)):
                err('drive.teleNames', '跟 tele 一樣多個名字')
            if 'partCheck' in DV and not isinstance(DV['partCheck'], bool):
                err('drive.partCheck', 'true／false（動力件檢查：戰鬥中數主機、鍋爐、軸還剩幾成；預設關，TASK-0673）')
    PN = cfg.get('pen', {})                              # 實心彈與爆裂彈照能量算（TASK-0621；js/21_gunnery.js 的 PEN）：沒寫的鍵照程式裡的預設
    if not isinstance(PN, dict):
        err('pen', '要是物件')
    else:
        for f, lo, hi, what in (('lo', 0, 5, '擊穿機率曲線的下緣（比值低於它 ⇒ 0）'), ('hi', 0.1, 10, '上緣（比值高於它 ⇒ 必穿）'), ('k', 0.2, 10, '曲線的次方（越大 ⇒ 下緣附近越難）'),
                                ('rico', 30, 89, '彈開的入射角（度，跟法線的夾角）'), ('wood', 0.05, 20, '打木頭每消耗一單位扣幾 kJ（船殼硬度倍率 1）'), ('splinter', 1, 1000, '碎片傷人的基準能量（kJ）'),
                                ('shellR', 1, 20, '爆裂彈的爆炸半徑（格；24 磅、船殼硬度倍率 1 的橡木）'), ('shellHard', 0, 2, '爆炸半徑照硬度打折的次方'), ('ref', 0.1, 500, '沒寫彈重的砲當幾 kg'),
                                ('uwMin', 0, 500, '落水後繼續走的最小彈重（kg；TASK-0642）'), ('uwDrag', 0.001, 1, '水的阻力（每走 1 m 速度 × e^(−uwDrag／半徑)）'),
                                ('muzzle', 0, 1, '帶裝甲的砲被打中砲口、砲被打飛時砲班另外吃的那一份的倍率（TASK-0644）')):
            if f in PN and not (isnum(PN[f]) and lo <= PN[f] <= hi):
                err('pen.' + f, '%s：%s～%s' % (what, lo, hi))
        for f in PN:
            if f not in ('lo', 'hi', 'k', 'rico', 'wood', 'splinter', 'shellR', 'shellHard', 'ref', 'uwMin', 'uwDrag', 'muzzle'):
                err('pen.' + f, '不認得的鍵')
        if isnum(PN.get('lo', 0.4)) and isnum(PN.get('hi', 1.3)) and PN.get('lo', 0.4) >= PN.get('hi', 1.3):
            err('pen.hi', '要大於 lo')
    MT = cfg.get('materials')                            # 材質表（TASK-0616）：{ default: ID, list: { ID: { name, kind, density, hard, flammable } } }；ID 英文小寫，雕刻那側關聯 meta material 寫它
    MIDS = set()
    THEME_IDS = theme_ids()
    if not (isinstance(MT, dict) and isinstance(MT.get('list'), dict) and MT['list']):
        err('materials', '要是 { default: 材質 ID, list: { ID: 參數 } }，list 至少一種')
    else:
        for k, m in MT['list'].items():
            p = 'materials.list.' + k
            if not re.fullmatch(MAT_ID, k):
                err(p, '材質 ID：小寫英文開頭、只有小寫英文數字底線（雕刻作品的 meta material 照它認）')
            MIDS.add(k)
            if not isinstance(m, dict):
                err(p, '要是物件')
                continue
            if not (isinstance(m.get('name'), str) and m['name'].strip()):
                err(p + '.name', '要有顯示名')
            if m.get('kind') not in MAT_KINDS:
                err(p + '.kind', '要是 ' + '／'.join(MAT_KINDS) + ' 其中一個（分類）')
            for f, lo, hi, what in MAT_NUMS:
                if not (isnum(m.get(f)) and lo <= m[f] <= hi):
                    err(p + '.' + f, '%s：%s～%s' % (what, lo, hi))
            for f, lo, hi, what in MAT_OPT:
                if f in m and not (isnum(m[f]) and lo <= m[f] <= hi):
                    err(p + '.' + f, '%s：%s～%s' % (what, lo, hi))
            for f, what in MAT_BOOL:
                if f in m and not isinstance(m[f], bool):
                    err(p + '.' + f, what)
            for f in m:
                if f not in ('name', 'kind') and f not in [x[0] for x in MAT_NUMS + MAT_OPT + MAT_BOOL]:
                    err(p + '.' + f, '不認得的鍵')
        if MT.get('default') not in MIDS:
            err('materials.default', '要是材質表裡的一種（沒寫材質的船、子作品都用它）')
    S = cfg.get('ships')
    if not (isinstance(S, list) and S):
        err('ships', '至少要有一艘')
        S = []
    # 改裝船（TASK-0657）：原船要在清單裡（打包時格子存成跟它的差 ⇒ 兩艘要一起匯入）、不成環
    byid = {s.get('id'): s for s in S if isinstance(s, dict)}
    for s in S:
        if not (isinstance(s, dict) and isinstance(s.get('variant_of'), str) and s['variant_of'] != s.get('id')):
            continue
        seen, cur = [s.get('id')], s
        while isinstance(cur.get('variant_of'), str):
            nxt = byid.get(cur['variant_of'])
            if nxt is None:
                err('ships[%s].variant_of' % s.get('id'), '原船 %s 不在船隻清單裡 ⇒ 先匯入原船（改裝船存成跟它的差，兩艘要一起在）' % cur['variant_of'])
                break
            if nxt.get('id') in seen:
                err('ships[%s].variant_of' % s.get('id'), '原船成環：%s' % ' → '.join(seen + [nxt.get('id')]))
                break
            seen.append(nxt.get('id'))
            cur = nxt
    ids, els = set(), set()
    for i, s in enumerate(S):
        p = 'ships[%d]' % i
        if not isinstance(s, dict):
            err(p, '要是物件')
            continue
        p = 'ships[%s]' % s.get('id', i)
        if not (isinstance(s.get('id'), str) and re.fullmatch(r'[a-z][a-z0-9_]{0,31}', s['id'])):
            err(p + '.id', '小寫英文開頭、只有小寫英文數字底線（網址 ?blue= 與存檔用它）')
        elif s['id'] in ids:
            err(p + '.id', '重複')
        ids.add(s.get('id'))
        if not (isinstance(s.get('el'), str) and re.fullmatch(r'[a-z][a-z0-9-]{0,47}', s['el'])):
            err(p + '.el', '內嵌標籤的 id：小寫英文開頭、只有小寫英文數字與 -')
        elif s['el'] in els or s['el'] in ('game-config',):
            err(p + '.el', '重複')
        els.add(s.get('el'))
        if not (isinstance(s.get('name'), str) and s['name'].strip()):
            err(p + '.name', '要有名字')
        if not (isinstance(s.get('vxk'), str) and re.fullmatch(r'[A-Za-z0-9_.-]+\.vxk', s['vxk'])):
            err(p + '.vxk', '_cache 裡的檔名（xxx.vxk）')
        if not isinstance(s.get('work', ''), str):
            err(p + '.work', '雕刻作品 ID（字串）')
        if 'material' in s and mat_mix_err(s['material'], MIDS):
            err(p + '.material', '全船預設材質要是材質表裡的一種（%s）或混合材質（%s）；沒寫 ＝ materials.default' % ('、'.join(sorted(MIDS)), mat_mix_err(s['material'], MIDS)))
        if 'matMap' in s:                                # 這一艘遊戲裡換掉的材質（作品不動；05_material.js hullMaterials）：{ 作品裡的材質 ID: 換成的材質（可以是混合材質）}
            if not (isinstance(s['matMap'], dict) and s['matMap']):
                err(p + '.matMap', '要是 { 材質 ID: 換成的材質 }，至少一筆')
            else:
                for k, v in s['matMap'].items():
                    if not re.fullmatch(MAT_ID, k):
                        err(p + '.matMap.' + k, '鍵要是作品裡的材質 ID')
                    elif mat_mix_err(v, MIDS):
                        err(p + '.matMap.' + k, mat_mix_err(v, MIDS))
        if 'zw0' in s and not (isint(s['zw0']) and s['zw0'] > 0):
            err(p + '.zw0', '正整數（作品沒有水線 meta 時的設計水線）')
        if 'drive' in s and s['drive'] not in ('steam', 'magic'):
            err(p + '.drive', '額外動力的種類：steam（蒸汽機，預設）或 magic（魔法／幽靈船）；沒有額外動力（cfg.base）就不用寫')
        if 'theme' in s and not (isinstance(s['theme'], str) and s['theme'] in THEME_IDS):
            err(p + '.theme', '主題曲的 id（js/02_music.js 的 THEMES：%s；TASK-0681）' % ('、'.join(THEME_IDS) or '—'))
        if 'fireEngine' in s and s['fireEngine'] is not False:
            err(p + '.fireEngine', '只能寫 false（這艘沒有內建消防泵：古代的槳帆船；沒寫 ＝ 有，49_burn.js）')
        if 'author' in s and not (isinstance(s['author'], str) and s['author'].strip()):
            err(p + '.author', '建造者（雕刻作品的作者；匯入時從 .vxk 檔頭 owner 記，沒有就不寫這個鍵）')
        if 'variant_of' in s and not (isinstance(s['variant_of'], str) and s['variant_of'] != s.get('id')):
            err(p + '.variant_of', '原船的 id（改裝船，TASK-0657；字串、不能是自己）')
        if 'idNext' in s and not (isinstance(s['idNext'], dict) and all(re.fullmatch(r'[a-z][a-z0-9_]*', k) and isint(v) and v >= 1 for k, v in s['idNext'].items())):
            err(p + '.idNext', '物件 id 每一類的下一號 { 類別: 正整數 }（admin.py ids 寫的，TASK-0715；別手改）')
        if 'fit' in s:                                     # 出廠的換裝表（TASK-0714；js/38_fit.js）：{ 掛點的 id: 砲種 }；掛點在不在、放不放得下要載船才知道 ⇒ 匯入檢查報
            G0 = cfg.get('guns') if isinstance(cfg.get('guns'), dict) else {}
            def fit_ok(v):
                return (v in G0 and not (G0[v] or {}).get('weapon')) or v in ('', '*') or (isinstance(v, str) and re.fullmatch(r'[a-z][a-z0-9_]*#[a-z0-9_./-]+', v) is not None)
            if not (isinstance(s['fit'], dict) and all(isinstance(k, str) and ID_RE.fullmatch(k) and isinstance(v, str) and fit_ok(v) for k, v in s['fit'].items())):
                err(p + '.fit', '換裝表 { 掛點的 id（例 gun-3）: 砲種（guns 的鍵；弩砲這類不換）｜"<船 id>#<模型 id>"（零件表 parts.<kind>）｜"*"（原本雕的）｜""（拆空）}（TASK-0713／0714）')
        for k, v in (s.get('cfg') or {}).items():
            if k not in SHIP_CFG_KEYS:
                err(p + '.cfg.' + k, '不認得的鍵（%s）' % '、'.join(SHIP_CFG_KEYS))
            elif k == 'avoid':
                if not isinstance(v, dict):
                    err(p + '.cfg.avoid', '防撞參數是物件：{ near（m）, hard（m）, t（秒）, foe（false ＝ 不讓敵艦）}，沒寫的照預設')
                else:
                    for ak, av in v.items():
                        if ak in ('near', 'hard', 't'):
                            if not (isnum(av) and 0 < av <= 200):
                                err(p + '.cfg.avoid.' + ak, '正的數字（m／秒，≤ 200）')
                        elif ak == 'foe':
                            if not isinstance(av, bool):
                                err(p + '.cfg.avoid.foe', 'true／false（false ＝ 裝撞角、要撞上去：不讓敵艦）')
                        else:
                            err(p + '.cfg.avoid.' + ak, '不認得的鍵（near、hard、t、foe）')
            elif k in lim and isinstance(lim[k], list) and len(lim[k]) == 3 and not (isnum(v) and lim[k][0] <= v <= lim[k][1]):
                err(p + '.cfg.' + k, '要在滑桿範圍 %s～%s 裡' % (lim[k][0], lim[k][1]))
        if 'geo' in s:
            geo(s['geo'], p + '.geo', False)
        if 'crew' in s:
            crew(s['crew'], p + '.crew', False)
        if 'rooms' in s:
            rooms(s['rooms'], p + '.rooms')
        if 'flags' in s:   # 陣營旗（77_colours.js）：[{kind: pennant／ensign, at: [x, y, z] 桅頂那一格, pole: 旗桿公尺, scale: 大小倍率} 或 {kind, replace: 作品裡那面旗的名字}]；沒寫 ⇒ 每根桅頂自動一根旗桿（主桅長旗、其他戰鬥旗）
            L = s['flags']
            if not (isinstance(L, list) and len(L) <= 8):
                err(p + '.flags', '最多 8 面的清單（空清單 ＝ 這艘不掛陣營旗）')
            else:
                for j, q in enumerate(L):
                    qp = '%s.flags[%d]' % (p, j)
                    if not (isinstance(q, dict) and q.get('kind') in ('pennant', 'ensign')):
                        err(qp + '.kind', 'pennant（長旗）或 ensign（戰鬥旗）')
                        continue
                    if 'replace' in q:
                        if not (isinstance(q['replace'], str) and q['replace'].strip()):
                            err(qp + '.replace', '作品裡那面旗的名字（例：ensign）—— 布料照原本那面，只換成陣營旗的貼圖')
                        continue
                    if not (isinstance(q.get('at'), list) and len(q['at']) == 3 and all(isnum(v) for v in q['at'])):
                        err(qp + '.at', '[x, y, z]（桅頂那一格的格座標，旗桿從這裡往上），或改給 replace')
                    if 'pole' in q and not (isnum(q['pole']) and 0.5 <= q['pole'] <= 12):
                        err(qp + '.pole', '旗桿長 0.5～12 公尺')
                    if 'scale' in q and not (isnum(q['scale']) and 0.2 <= q['scale'] <= 3):
                        err(qp + '.scale', '大小倍率 0.2～3')
        if 'lamps' in s:   # 船殼上的燈（格子做的；60_render.js vlampSet）：[{at: [x, y, z], r: 半徑幾格, color: 發光的格子 rgb332 代碼, rgb: [r, g, b] 光色 0～1}]，最多 4 盞
            L = s['lamps']
            if not (isinstance(L, list) and len(L) <= 4):
                err(p + '.lamps', '最多 4 盞的清單')
            else:
                for j, q in enumerate(L):
                    qp = '%s.lamps[%d]' % (p, j)
                    if not (isinstance(q, dict) and isinstance(q.get('at'), list) and len(q['at']) == 3 and all(isnum(v) for v in q['at'])):
                        err(qp + '.at', '[x, y, z]（船的格座標）')
                    elif not (isnum(q.get('r')) and 0 < q['r'] <= 30):
                        err(qp + '.r', '半徑 0～30 格')
                    elif not (isint(q.get('color')) and 0 <= q['color'] <= 255):
                        err(qp + '.color', '發光的格子顏色（rgb332 代碼 0～255）')
                    elif not (isinstance(q.get('rgb'), list) and len(q['rgb']) == 3 and all(isnum(v) and 0 <= v <= 2 for v in q['rgb'])):
                        err(qp + '.rgb', '光色 [r, g, b]，0～2')
    if prev:
        for sec in ('limits', 'menu', 'lim', 'guns', 'geo0', 'crew0', 'fire', 'burn', 'galley', 'duty', 'idle'):
            for k in (prev.get(sec) or {}):
                if k not in (cfg.get(sec) or {}):
                    err(sec + '.' + k, '原本有、這份少了（遊戲會讀它）')
    return E


# ───────────────────────── 船：template 標籤、.vxk ─────────────────────────
def ship_tags(cfg):
    return ''.join('<script type="application/x-vxk" id="%s" src="../VoxelKit/_cache/%s"></script>\n' % (s['el'], s['vxk']) for s in cfg['ships'])


def sync_template(cfg):
    """template.html 的船標籤照 ships 改寫（兩個註解記號中間那一段）。回傳有沒有改。"""
    t = open(TPL, encoding='utf-8').read()
    a, b = t.find(SHIPS_A), t.find(SHIPS_B)
    if a < 0 or b < a:
        raise RuntimeError('template.html 找不到船標籤的記號（%s … %s）' % (SHIPS_A.strip(), SHIPS_B))
    a += len(SHIPS_A)
    nt = t[:a] + ship_tags(cfg) + t[b:]
    if nt == t:
        return False
    with open(TPL, 'w', encoding='utf-8', newline='\n') as f:
        f.write(nt)
    return True


def vxk_header(raw):
    """.vxk（raw deflate：'VXK1'、header 長度、header JSON、格子…）只解到 header 為止（格子不解 ⇒ 不用整份解壓）。格式見 VoxelKit/voxel_export.py pack／unpack。"""
    d, buf, tail = zlib.decompressobj(-15), b'', raw

    def need(n):
        nonlocal buf, tail
        while len(buf) < n:
            chunk = d.decompress(tail, n - len(buf))
            tail = d.unconsumed_tail
            if not chunk:
                raise ValueError('.vxk 太短')
            buf += chunk
    need(8)
    if buf[:4] != b'VXK1':
        raise ValueError('不是 VXK1')
    n = struct.unpack('<I', buf[4:8])[0]
    need(8 + n)
    return json.loads(buf[8:8 + n].decode('utf-8'))


def vxk_info(path):
    """.vxk 的 header 讀數：格數、checksum、尺寸、繩帆模型數、作品 ID、作者（owner：雕刻作品的作者 persona，senate 匯出時寫的）、匯出時間、檔案雜湊。"""
    if not os.path.exists(path):
        return None
    raw = open(path, 'rb').read()
    h = vxk_header(raw)
    rig = h.get('rig') or {}
    return {'voxels': h.get('voxels'), 'checksum': h.get('checksum'), 'size': h.get('size'), 'meters_per_voxel': h.get('meters_per_voxel'),
            'ropes': len(rig.get('ropes') or []), 'sails': len(rig.get('sails') or []), 'models': len(rig.get('models') or []),
            'parts': len(h.get('parts') or []), 'work': h.get('work'), 'owner': h.get('owner'), 'exported_at': h.get('exported_at'), 'materials': (h.get('materials') or {}).get('ids') or [],
            'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()[:12]}


DIFF_KEYS = (('voxels', '格數'), ('checksum', 'checksum'), ('size', '尺寸'), ('ropes', '繩'), ('sails', '帆'), ('models', '模型'),
             ('parts', '零件'), ('meters_per_voxel', '公尺／格'), ('work', '作品'), ('exported_at', '匯出時間'), ('bytes', '檔案大小'), ('sha256', '檔案雜湊'))


def vxk_diff(a, b):
    out = []
    for k, name in DIFF_KEYS:
        va, vb = (a or {}).get(k), (b or {}).get(k)
        if va == vb:
            out.append('  %s：%s（沒變）' % (name, va))
        elif isnum(va) and isnum(vb) and k not in ('checksum',):
            out.append('  %s：%s → %s（%+d）' % (name, va, vb, vb - va))
        else:
            out.append('  %s：%s → %s' % (name, va, vb))
    return out


def run(cmd, cwd=HERE):
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return p.returncode, (p.stdout or '') + (p.stderr or '')


def export(work, dest):
    """senate 從雕刻作品匯出 .vxk（連繩、帆、模型、零件外框、meta）。"""
    senate = shutil.which('senate')
    if not senate:
        raise RuntimeError('找不到 senate（匯出 .vxk 要它）')
    code, out = run([senate, 'cmd', 'sculpture', '--arg', 'op=export', '--arg', 'format=vxk', '--arg', 'work=' + work,
                     '--arg', 'include=rig,models,parts,meta,ends,recipe', '--arg', 'out=' + os.path.abspath(dest)])   # ends：繩兩端的參照（帆腳綁哪條繩照它）；recipe：帆的配方（TASK-0602 ①：成品只存配方，遊戲照配方生帆）
    if code != 0 or not os.path.exists(dest):
        raise RuntimeError('匯出失敗（exit %d）：\n%s' % (code, out.strip()))
    raw = zlib.decompress(open(dest, 'rb').read(), -15)
    n = struct.unpack('<I', raw[4:8])[0]
    h = json.loads(raw[8:8 + n].decode('utf-8'))
    log, dl = anchor_cells(h), drive_cells(h)
    pl = prop_vox(h, parts_models(h.get('work') or work))
    if log is not None or dl is not None or pl is not None:
        vxk_write(dest, h, raw[8 + n:])
        out += '\n' + '\n'.join((log or []) + (dl or []) + (pl or []))
    return out


def vxk_write(path, h, body):
    """header 換掉、格子那一段原樣（同 metasync 的寫法）。"""
    hb = json.dumps(h, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    co = zlib.compressobj(9, zlib.DEFLATED, -15)
    open(path + '.tmp', 'wb').write(co.compress(b'VXK1' + struct.pack('<I', len(hb)) + hb + body) + co.flush())
    os.replace(path + '.tmp', path)


def anchor_cells(h):
    """錨的關聯（meta kind=anchor；TASK-0601，Tim 2026-10-16「直接改meta 因為這是遊戲內功能 不影響雕刻作品本身」）：
    關聯的格子在 .vxk 裡跟船殼攤平成一份，遊戲分不出哪幾格是錨 ⇒ 把來源作品的格子（senate export format=list）照關聯的外框與 mirror 換好，
    寫進那條關聯的 cells（base64：每格 x、y、z 各一個位元組，相對外框的最小角）；遊戲開局照它把錨拆出船殼、當成模型錨（76_anchor.js anchorParts）。
    ⛔ turn 不是 0、mirror 不是空或 y、外框任一邊超過 256 格 ⇒ 不寫（遊戲照舊當船殼的一部分，匯入檢查會報）。
    回：None ＝ header 沒變；不然 ＝ 讀數（每條一行）。"""
    log, changed, src = [], False, {}
    senate = shutil.which('senate')
    for q in h.get('parts', []) or []:
        want = (q.get('meta') or {}).get('kind') == 'anchor'
        cells, why = None, ''
        b, w = q.get('box'), q.get('src')
        if want and not (b and len(b) == 6 and w):
            why = '檔頭沒有外框或來源作品'
        elif want and q.get('turn', 0) not in (0, None):
            why = 'turn=%s（只認 0）' % q.get('turn')
        elif want and q.get('mirror', '') not in ('', 'y'):
            why = 'mirror=%s（只認空或 y）' % q.get('mirror')
        elif want:
            sx, sy, sz = int(b[3] - b[0] + 1), int(b[4] - b[1] + 1), int(b[5] - b[2] + 1)
            if max(sx, sy, sz) > 256:
                why = '外框超過 256 格'
            elif not senate:
                why = '找不到 senate'
            else:
                if w not in src:
                    tmp = os.path.join(CACHE, '_cells_%s.txt' % hashlib.sha1(w.encode('utf-8')).hexdigest()[:10])
                    code, out = run([senate, 'cmd', 'sculpture', '--arg', 'op=export', '--arg', 'format=list', '--arg', 'work=' + w, '--arg', 'out=' + os.path.abspath(tmp)])
                    L = []
                    if code == 0 and os.path.exists(tmp):
                        L = [tuple(int(v) for v in ln.split(',')[:3]) for ln in open(tmp, encoding='utf-8') if ln[:1].isdigit()]
                        os.remove(tmp)
                    src[w] = L
                L = src[w]
                if not L:
                    why = '來源作品 %s 匯不出格子清單' % w
                elif any(not (0 <= x < sx and 0 <= y < sy and 0 <= z < sz) for x, y, z in L):
                    why = '來源作品的格子超出關聯的外框（%d×%d×%d）' % (sx, sy, sz)
                else:
                    flip = q.get('mirror') == 'y'
                    cells = base64.b64encode(bytes(v for x, y, z in L for v in (x, sy - 1 - y if flip else y, z))).decode('ascii')
        if why:
            log.append('⚠ 錨 %s：%s ⇒ 不拆（照舊是船殼）' % (q.get('path'), why))
        if q.get('cells') != cells:
            changed = True
            if cells is None:
                q.pop('cells', None)
            else:
                q['cells'] = cells
        if cells:
            log.append('錨 %s：%d 格（%s%s）' % (q.get('path'), len(base64.b64decode(cells)) // 3, w, '，mirror=y' if q.get('mirror') == 'y' else ''))
    return log if changed else None


META_P = os.path.join(HERE, 'config', 'meta_kinds.json')               # 雕刻 meta 的 kind 規格表（TASK-0672）：遊戲內嵌（#meta-kinds）、這裡照它的 drv 分動力件


def meta_kinds():
    """規格表的 kinds（kind ⇒ { name, on, keys, need, use, doc, game, mk, drv }）。"""
    return json.load(open(META_P, encoding='utf-8'))['kinds']


DRV_KINDS = tuple(k for k, v in meta_kinds().items() if v.get('drv') == 'part')
CELL_KINDS = DRV_KINDS + ('ladders', 'ladder')       # 寫格子清單 parts[].cellRuns 的關聯：動力件＋梯子（TASK-0676：木匠照它把整件梯子還原，Tim「可以單純是還原該子模組(梯子)」）   # 動力件（TASK-0653；遊戲 31_drive.js 照格子算剩幾成、通不通）：規格表 drv=part（主機、鍋爐、軸、蒸汽管）


HPM_KINDS = tuple(k for k, v in meta_kinds().items() if v.get('drv') == 'hp')     # 整件一塊的動力件（規格表 drv=hp：槳）：不匯出格子，血量倍率 drvparts.<種類>.hpK（道具設定頁）
VOXM_KINDS = tuple(k for k, v in meta_kinds().items() if v.get('drv') == 'vox')   # 會轉的體素件（TASK-0653 第二段；遊戲 24_armor.js propSetup）：規格表 drv=vox（螺旋槳）；這幾種模型匯出時多帶來源作品的格子
HULLV_KINDS = tuple(k for k, v in meta_kinds().items() if v.get('vox') == 'hull')   # 自帶格子的模型（TASK-0793：主機、鍋爐；規格表 vox=hull）：匯出時一樣帶來源作品的格子（prop_vox），遊戲載入時放回船殼（38_fit.js fitHullVox）


def parts_models(work):
    """部件清單（senate export format=parts）的模型 ⇒ {路徑: 那一筆（work、box、meta、points）}；拿不到 ⇒ {}。"""
    senate = shutil.which('senate')
    if not senate or not work:
        return {}
    tmp = os.path.join(CACHE, '_pm_%s.json' % hashlib.sha1(work.encode('utf-8')).hexdigest()[:10])
    code, _ = run([senate, 'cmd', 'sculpture', '--arg', 'op=export', '--arg', 'format=parts', '--arg', 'work=' + work, '--arg', 'out=' + os.path.abspath(tmp)])
    if code != 0 or not os.path.exists(tmp):
        return {}
    try:
        return {q['path']: q for q in json.load(open(tmp, encoding='utf-8')).get('models', [])}
    finally:
        os.remove(tmp)


def prop_vox(h, PM):
    """會轉的體素件（Tim 2026-10-16：「鍋爐 & 軸 & 螺旋槳屬於這類 且可以根據剩餘體素去做運算」；TASK-0653 第二段）：
    meta kind ＝ VOXM_KINDS 的外部模型，在 .vxk 裡只有三角形網格 ⇒ 把來源作品的格子（senate export format=list，帶顏色）照模型的外框搬到船的格座標，
    寫進 rig.models[].vox ＝ { o: 外框最小角, s: 外框大小, runs: [跟上一段結尾差幾, 長度, …]（外框裡的線性編號 x＋sx·(y＋sy·z)）, c: 每格的顏色（base64，一格一個位元組） }。
    遊戲開局照它把螺旋槳變成自己一份格子（跟著軸轉、一格一格打掉、推力照剩幾成；24_armor.js propSetup）；沒有 vox ⇒ 照舊是模型（扣血）。
    ⛔ 只認平移（模型 rotate 0、scale 1：來源作品格子的外框大小要跟模型的外框一樣），不然不寫。
    自帶格子的模型（HULLV_KINDS：主機、鍋爐；TASK-0793）也走這裡；它們可以 mirror（一舷做好、另一舷鏡像）⇒ 部件清單不說有沒有翻 ⇒ 照模型的網格判（vox_flip）。
    回：None ＝ header 沒變；不然 ＝ 讀數。"""
    log, changed = [], False
    senate = shutil.which('senate')
    meshes = (h.get('rig') or {}).get('meshes') or []
    for m in (h.get('rig') or {}).get('models', []) or []:
        kind = (m.get('meta') or {}).get('kind')
        if kind not in VOXM_KINDS + HULLV_KINDS:
            continue
        q, why, vox = PM.get(m.get('name')) or {}, '', None
        w, b = q.get('work'), m.get('bbox')
        if not senate:
            why = '找不到 senate'
        elif not w or q.get('source') not in (None, 'work'):
            why = '部件清單裡找不到這個模型的來源作品（外部 obj 不帶格子）'
        elif not (b and len(b) == 6):
            why = '檔頭沒有模型的外框'
        else:
            tmp = os.path.join(CACHE, '_vox_%s.txt' % hashlib.sha1(w.encode('utf-8')).hexdigest()[:10])
            code, _ = run([senate, 'cmd', 'sculpture', '--arg', 'op=export', '--arg', 'format=list', '--arg', 'work=' + w, '--arg', 'out=' + os.path.abspath(tmp)])
            L = []
            if code == 0 and os.path.exists(tmp):
                L = [tuple(int(v) for v in ln.split(',')[:4]) for ln in open(tmp, encoding='utf-8') if ln[:1].isdigit()]
                os.remove(tmp)
            if not L:
                why = '來源作品 %s 匯不出格子清單' % w
            else:
                lo = [min(c[a] for c in L) for a in range(3)]
                hi = [max(c[a] for c in L) for a in range(3)]
                o = [int(math.floor(b[a] + 1e-6)) for a in range(3)]
                sz = [hi[a] - lo[a] + 1 for a in range(3)]
                ext = [int(round(b[a + 3] - b[a])) for a in range(3)]
                fl = None
                if sz != ext:
                    why = '來源作品的格子外框 %s 跟模型外框 %s 不一樣大（有旋轉、縮放？）' % ('×'.join(map(str, sz)), '×'.join(map(str, ext)))
                else:
                    fl, sc = vox_flip(L, lo, sz, o, m, meshes) if kind in HULLV_KINDS else ('', None)
                    if fl is None:
                        why = '照模型的網格判不出有沒有鏡像（%s）' % sc
                if not why:
                    L = [(sz[0] - 1 - (c[0] - lo[0]) + lo[0] if 'x' in fl else c[0], sz[1] - 1 - (c[1] - lo[1]) + lo[1] if 'y' in fl else c[1], c[2], c[3]) for c in L]
                    cells = sorted(((c[0] - lo[0]) + sz[0] * ((c[1] - lo[1]) + sz[1] * (c[2] - lo[2])), c[3]) for c in L)
                    runs, cols, end, i = [], bytearray(), 0, 0
                    while i < len(cells):
                        j = i
                        while j + 1 < len(cells) and cells[j + 1][0] == cells[j][0] + 1:
                            j += 1
                        runs += [cells[i][0] - end, j - i + 1]
                        end = cells[j][0] + 1
                        i = j + 1
                    for _, c in cells:
                        cols.append(c & 255)
                    vox = {'o': o, 's': sz, 'runs': runs, 'c': base64.b64encode(bytes(cols)).decode('ascii')}
        if vox is None:
            log.append('  ⚠ %s（%s）：沒有寫格子 —— %s ⇒ 遊戲照舊當模型（扣血）' % (m.get('name'), kind, why))
        else:
            log.append('  %s（%s）：%d 格（%s%s）寫進 vox' % (m.get('name'), kind, len(L), w, '，mirror ' + fl if fl else ''))
        if m.get('vox') != vox:
            if vox is None:
                m.pop('vox', None)
            else:
                m['vox'] = vox
            changed = True
    return log if changed else None


def vox_flip(L, lo, sz, o, m, meshes):
    """自帶格子的模型有沒有鏡像（TASK-0793）：來源作品的格子照「不翻／翻 y／翻 x」三種放到模型的外框，看模型網格的頂點（obj 匯出的方塊角）有幾成落在格子的角上。
    最高的那一種要 ≥ 98%、而且比第二高多 2 個百分點以上（或者只有它 100%），不然判不出來（回 None）。回 (''｜'y'｜'x', 讀數)。"""
    M = meshes[m['mesh']] if isinstance(m.get('mesh'), int) and m['mesh'] < len(meshes) else None
    V, og = (M or {}).get('verts') or [], m.get('origin') or [0, 0, 0]
    if not V:
        return None, '模型沒有網格'
    step = max(1, len(V) // 3 // 4000)
    P = [(V[i] + og[0], V[i + 1] + og[1], V[i + 2] + og[2]) for i in range(0, len(V) - 2, 3 * step)]
    score, sets = {}, {}
    for fl in ('', 'y', 'x'):
        S = set()
        for c in L:
            x, y, z = c[0] - lo[0], c[1] - lo[1], c[2] - lo[2]
            if 'x' in fl:
                x = sz[0] - 1 - x
            if 'y' in fl:
                y = sz[1] - 1 - y
            S.add((o[0] + x, o[1] + y, o[2] + z))
        hit = 0
        for v in P:
            b0 = [int(math.floor(t + 1e-6)) for t in v]
            if any((b0[0] - dx, b0[1] - dy, b0[2] - dz) in S for dx in (0, 1) for dy in (0, 1) for dz in (0, 1)):
                hit += 1
        score[fl], sets[fl] = hit / len(P), S
    best = sorted(score, key=lambda k: -score[k])
    txt = '、'.join('%s %.1f%%' % (k or '不翻', 100 * score[k]) for k in best)
    if score[best[0]] >= 0.98 and all(sets[k] == sets[best[0]] for k in best if score[best[0]] - score[k] < 0.02):   # 對稱的件：翻不翻都一樣 ⇒ 照「不翻」那一種（一樣的格）
        return ('' if sets[''] == sets[best[0]] else best[0]), txt
    if score[best[0]] == 1 and score[best[1]] < 1:                       # 對的那一種每個頂點都落在格角上（網格就是那些格做的）⇒ 只有它 100% 就是它（松島號的主機前後幾乎對稱：不翻 100%、翻 x 99.8%）
        return best[0], txt
    if score[best[0]] < 0.98 or score[best[0]] - score[best[1]] < 0.02:
        return None, txt
    return best[0], txt


def drive_cells(h):
    """動力件（關聯 meta kind ＝ DRV_KINDS；TASK-0653，Tim 2026-10-16：「不是直接根據該子模組當前剩下多少voxel計算嗎」）：
    關聯的格子在 .vxk 裡跟船殼攤平成一份 ⇒ 把來源作品的格子（senate export format=list）照關聯的外框與 mirror 換成整艘船的格座標，
    照線性編號（x ＋ 寬 ×（y ＋ 深 × z））排好、寫成連續段 parts[].cellRuns ＝ [跟上一段結尾差幾, 長度, …]（同材質層的段落；⛔ 錨的 cells 一格一個位元組、外框不能超過 256 格，
    這幾件的外框常常是整艘船 ⇒ 不能用）。遊戲開局照它記哪幾格是那一件（31_drive.js）。
    ⛔ turn 不是 0、mirror 不是空或 y ⇒ 不寫（遊戲退回舊判法：固定點旁 ±8 格）。回：None ＝ header 沒變；不然 ＝ 讀數（每條一行）。"""
    log, changed, src = [], False, {}
    senate = shutil.which('senate')
    SX, SY, SZ = (h.get('size') or [0, 0, 0])[:3]
    for q in h.get('parts', []) or []:
        kind = (q.get('meta') or {}).get('kind')
        if kind not in CELL_KINDS:
            continue
        what = '動力件' if kind in DRV_KINDS else '梯子'
        runs, why = None, ''
        b, w = q.get('box'), q.get('src')
        if not (b and len(b) == 6 and w):
            why = '檔頭沒有外框或來源作品'
        elif q.get('turn', 0) not in (0, None):
            why = 'turn=%s（只認 0）' % q.get('turn')
        elif q.get('mirror', '') not in ('', 'y'):
            why = 'mirror=%s（只認空或 y）' % q.get('mirror')
        elif not senate:
            why = '找不到 senate'
        else:
            if w not in src:
                tmp = os.path.join(CACHE, '_cells_%s.txt' % hashlib.sha1(w.encode('utf-8')).hexdigest()[:10])
                code, out = run([senate, 'cmd', 'sculpture', '--arg', 'op=export', '--arg', 'format=list', '--arg', 'work=' + w, '--arg', 'out=' + os.path.abspath(tmp)])
                L = []
                if code == 0 and os.path.exists(tmp):
                    L = [tuple(int(v) for v in ln.split(',')[:3]) for ln in open(tmp, encoding='utf-8') if ln[:1].isdigit()]
                    os.remove(tmp)
                src[w] = L
            L = src[w]
            sy = int(b[4] - b[1] + 1)
            flip = q.get('mirror') == 'y'
            idx = sorted({(int(b[0]) + x) + SX * ((int(b[1]) + (sy - 1 - y if flip else y)) + SY * (int(b[2]) + z)) for x, y, z in L
                          if 0 <= int(b[0]) + x < SX and 0 <= int(b[1]) + (sy - 1 - y if flip else y) < SY and 0 <= int(b[2]) + z < SZ})
            if not idx:
                why = '來源作品 %s 匯不出格子清單（或全在船外）' % w
            else:
                runs, end, i = [], 0, 0
                while i < len(idx):
                    j = i
                    while j + 1 < len(idx) and idx[j + 1] == idx[j] + 1:
                        j += 1
                    runs += [idx[i] - end, j - i + 1]
                    end = idx[j] + 1
                    i = j + 1
        if why:
            log.append('⚠ %s %s（%s）：%s ⇒ 不寫格子清單（%s）' % (what, q.get('path'), kind, why, '遊戲照固定點旁 ±8 格判' if what == '動力件' else '木匠只補踏板'))
        if q.get('cellRuns') != runs:
            changed = True
            if runs is None:
                q.pop('cellRuns', None)
            else:
                q['cellRuns'] = runs
        if runs:
            log.append('%s %s（%s）：%d 格、%d 段（%s%s）' % (what, q.get('path'), kind, sum(runs[1::2]), len(runs) // 2, w, '，mirror=y' if q.get('mirror') == 'y' else ''))
    return log if changed else None


# ───────────────────────── 物件 id（TASK-0715；造船規格 §12） ─────────────────────────
# 每件關聯（部件）、外部模型一個可讀的固定 id：`<類別>-<序號>`（類別 ＝ meta kind；沒有 kind 的關聯 part、模型 model），寫在它自己的 meta `id`。
#   改裝船自己加的：`<船的代號>.<類別>-<序號>`；原船那一棵（改裝船裡關聯到原船組裝件的那一條底下）沿用原船的 id，不在這裡發。
#   一條關聯裡有好幾座的（梯子、艙房）不另外發：`<關聯 id>#<座名>`。繩、帆：名字在一艘船裡本來就唯一、又不是路徑 ⇒ 先用名字。
# 下一號記在設定檔 ships[].idNext（{類別: 下一號}）⇒ 刪掉的號不重用。
# 指名別的部件的 meta（規格表 meta_kinds.json 每一類的 refs：欄位 ⇒ 能指哪幾類、舊寫法是哪個鍵）從路徑換成 id；舊路徑照遊戲 metaRebase 的規矩找（自己那一層往上）。
# 寫回作品走 senate sculpture op=work sub=meta（批次檔；meta 不限作者，造船規格 Sculpture.md「sub=meta」）；之後 metasync 帶進 _cache。
ID_RE = re.compile(r'(?:([a-z][a-z0-9_]*)\.)?([a-z][a-z0-9_]*)-([1-9][0-9]*)')


def id_kind(meta, what):
    k = str((meta or {}).get('kind') or '')
    return k if re.fullmatch(r'[a-z][a-z0-9_]*', k) else what


def parts_json(work):
    """部件清單（senate export format=parts）整份：{links, models, …}。拿不到 ⇒ Fail。"""
    senate = shutil.which('senate')
    if not senate:
        raise Fail('找不到 senate')
    tmp = os.path.join(CACHE, '_pj_%s.json' % hashlib.sha1(work.encode('utf-8')).hexdigest()[:10])
    code, out = run([senate, 'cmd', 'sculpture', '--arg', 'op=export', '--arg', 'format=parts', '--arg', 'work=' + work, '--arg', 'out=' + os.path.abspath(tmp)])
    if code != 0 or not os.path.exists(tmp):
        raise Fail('部件清單匯出失敗（%s，exit %d）：\n%s' % (work, code, out.strip()[-600:]))
    try:
        return json.load(open(tmp, encoding='utf-8'))
    finally:
        os.remove(tmp)


def id_records(PJ):
    """部件清單 ⇒ 每一件 [{what: link／model, path, name（在它所在作品裡的名字）, holder（它所在的作品）, meta, points}]，照部件清單的順序（關聯先、模型後）。"""
    L = {q['path']: q for q in PJ.get('links', [])}
    out = []
    for q in PJ.get('links', []):
        par, _, nm = q['path'].rpartition('/')
        out.append({'what': 'link', 'path': q['path'], 'name': nm, 'holder': L[par]['work'] if par else PJ['work'], 'meta': q.get('meta') or {}, 'points': q.get('points') or {}})
    for q in PJ.get('models', []):
        fr = q.get('frame') or ''
        out.append({'what': 'model', 'path': q['path'], 'name': q['name'], 'holder': L[fr]['work'] if fr else PJ['work'], 'meta': q.get('meta') or {}, 'points': q.get('points') or {}})
    return out


def id_refspec():
    """規格表的 refs：{kind: {欄位: {to: [類別…], old: 舊鍵}}}。"""
    return {k: v['refs'] for k, v in meta_kinds().items() if v.get('refs')}


def id_plan(cfg, sid, PJ):
    """這艘要發的號與要換的關聯（不寫任何東西）。回 (writes {作品: [(part, 名字, meta 增量)]}, idNext, 讀數, 問題)。"""
    s = next(x for x in cfg['ships'] if x['id'] == sid)
    R = id_records(PJ)
    ns = ''
    base_pre = None                                    # 改裝船：關聯到原船組裝件的那一條（它底下的沿用原船的 id）
    if s.get('variant_of'):
        b = next((x for x in cfg['ships'] if x['id'] == s['variant_of']), None)
        L0 = [q for q in PJ.get('links', []) if b and q.get('work') == b.get('work')]
        if len(L0) != 1:
            raise Fail('%s 是 %s 的改裝船，可是部件清單裡關聯到原船組裝件（%s）的有 %d 條（要剛好 1 條）' % (sid, s['variant_of'], b and b.get('work'), len(L0)))
        ns, base_pre = sid + '.', L0[0]['path'] + '/'
    own = [r for r in R if not (base_pre and r['path'].startswith(base_pre))]
    nxt = dict(s.get('idNext') or {})
    top = {}
    probs = []
    seen = {}
    for r in R:                                        # 已經有的 id：撞號、格式不對都報；序號頂到哪
        v = r['meta'].get('id')
        if v is None:
            continue
        m = ID_RE.fullmatch(str(v))
        if not m:
            probs.append('✗ %s 的 id=%s 格式不對（要 <類別>-<序號>）' % (r['path'], v))
            continue
        rk = (r['holder'], r['what'], r['name'])
        if v in seen and seen[v][1] != rk:             # 同一筆紀錄經好幾條關聯（同一件子作品關聯兩次）不算撞號：遊戲照 <關聯 id>/<內部 id> 分開
            probs.append('✗ id 撞號：%s 與 %s 都是 %s' % (seen[v][0], r['path'], v))
        seen.setdefault(v, (r['path'], rk))
        if (m.group(1) or '') + '.' == ns or (not m.group(1) and not ns):
            top[m.group(2)] = max(top.get(m.group(2), 0), int(m.group(3)))
    want, byrec = {}, {}
    for r in own:                                      # 沒有 id 的發號（照部件清單的順序）
        if r['meta'].get('id') is not None:
            continue
        rk = (r['holder'], r['what'], r['name'])       # 同一件子作品被關聯好幾次（哨兵號兩個彈藥櫃）⇒ 同一筆紀錄只發一個號；遊戲照 <關聯 id>/<內部 id> 分開（造船規格 §12.2）
        if rk in byrec:
            want[r['path']] = byrec[rk]
            continue
        k = id_kind(r['meta'], 'part' if r['what'] == 'link' else 'model')
        n = max(nxt.get(k, 1), top.get(k, 0) + 1)
        want[r['path']] = byrec[rk] = ns + '%s-%d' % (k, n)
        nxt[k] = n + 1
    if base_pre:
        miss = [r['path'] for r in R if r['path'].startswith(base_pre) and r['meta'].get('id') is None]
        if miss:
            probs.append('✗ 原船 %s 那一棵還有 %d 件沒有 id ⇒ 先跑 admin.py ids --id %s（例：%s）' % (s['variant_of'], len(miss), s['variant_of'], '、'.join(miss[:4])))
    idof = {r['path']: (want.get(r['path']) or r['meta'].get('id')) for r in R}
    kind_of = {r['path']: id_kind(r['meta'], '') for r in R}
    # 舊寫法的路徑 ⇒ 完整路徑（遊戲 metaRebase 同一條規矩：本身就是 ⇒ 不動；不然自己那一層往上、最近的先）；梯子 ＝ <關聯>/<梯名>
    P = set(idof)
    lad = {}
    for r in R:
        if r['what'] == 'link':
            for k in r['points']:
                i = k.rfind('.')
                if i > 0:
                    lad[r['path'] + '/' + k[:i]] = r['path']

    def full(path, v):
        if v in P or v in lad:
            return v
        a = path.split('/')
        for i in range(len(a) - 1, 0, -1):
            c = '/'.join(a[:i]) + '/' + v
            if c in P or c in lad:
                return c
        return None
    spec = id_refspec()
    conv = {}
    for r in own:
        for f, sp in (spec.get(kind_of[r['path']]) or {}).items():
            old = sp.get('old', f)
            if old != f and r['meta'].get(f) is not None:
                continue                                   # 新鍵已經寫了
            v = r['meta'].get(old)
            if v is None or (old == f and isinstance(v, str) and ('#' in v or ID_RE.fullmatch(v))):
                continue                                   # 沒寫、或已經是 id 寫法
            fp = full(r['path'], str(v))
            if fp is None:
                probs.append('✗ %s 的 %s=%s 找不到這個部件（換不成 id，照舊）' % (r['path'], old, v))
                continue
            if fp in lad:
                tgt, tk = idof.get(lad[fp]) + '#' + fp[len(lad[fp]) + 1:], 'ladders#'
            else:
                tgt, tk = idof.get(fp), kind_of.get(fp)
            if tk not in sp['to']:
                probs.append('✗ %s 的 %s=%s 指到的是 %s，規格表只收 %s' % (r['path'], old, v, tk or '（沒有 kind）', '、'.join(sp['to'])))
                continue
            d = conv.setdefault(r['path'], {})
            d[f] = tgt
            if old != f:
                d[old] = None
    writes, done = {}, {}
    for r in own:
        d = {}
        if r['path'] in want:
            d['id'] = want[r['path']]
        d.update(conv.get(r['path'], {}))
        if not d:
            continue
        rk = (r['holder'], r['what'], r['name'])
        if rk in done:                                 # 同一筆紀錄經兩條關聯 ⇒ 只寫一次（兩條的增量要一樣）
            if done[rk] != d:
                probs.append('✗ %s 跟經別條關聯的同一筆紀錄要寫的不一樣：%s ≠ %s' % (r['path'], done[rk], d))
            continue
        done[rk] = d
        writes.setdefault(r['holder'], []).append((r['what'], r['name'], d, r['path']))
    dup = [r['path'] for r in own if (r['holder'], r['what'], r['name']) in done and not any(w[3] == r['path'] for w in writes.get(r['holder'], []))]
    log = ['ids %s：%d 件、已有 id %d、這次發 %d、關聯換成 id %d 格%s' % (sid, len(R), len(seen), len(set(want.values())), sum(len([k for k in d if d[k] is not None]) for d in conv.values()),
                                                         ('（改裝船：原船 %s 那一棵沿用）' % s['variant_of']) if base_pre else '')]
    if dup:
        log.append('  同一筆紀錄經好幾條關聯（只寫一次、遊戲照 <關聯 id>/<內部 id> 分開）%d 件：%s' % (len(dup), '、'.join(dup[:6])))
    apply = {}                                         # 檔頭照路徑要補的（跟寫回作品的同一份增量；同一筆紀錄經好幾條關聯 ⇒ 每條路徑各補一次）
    for r in own:
        d = dict({'id': want[r['path']]} if r['path'] in want else {}, **conv.get(r['path'], {}))
        if d:
            apply[r['path']] = d
    return writes, nxt, log, probs, apply


def act_ids(sid, dry=False, build=True):
    """物件 id（TASK-0715）：發號、指名別的部件的 meta 換成 id、寫回雕刻作品（sub=meta 批次），再 metasync 帶進 _cache。dry ＝ 只列要做什麼、不寫。"""
    cfg = load()
    s = next((x for x in cfg['ships'] if x['id'] == sid), None)
    if not s:
        raise Fail('設定檔沒有這艘：' + sid)
    writes, nxt, log, probs, apply = id_plan(cfg, sid, parts_json(s['work']))
    log += probs
    if any(p.startswith('✗ 原船') or p.startswith('✗ id 撞號') for p in probs):
        raise Fail('\n'.join(log + ['⛔ 擋下：一筆都沒寫']))
    for w, L in writes.items():
        log.append('  %s：%d 筆' % (w, len(L)))
        for what, nm, d, path in L[:3 if not dry else 400]:
            log.append('    %s %s ⇐ %s' % (what, path, json.dumps(d, ensure_ascii=False)))
    if dry:
        return log + ['（dry：一筆都沒寫）']
    if not writes:                                     # 作品裡都有了 ⇒ 只把 _cache 的檔頭對齊作品（改裝船裡原船那一棵也是）
        return log + ['＝ 作品裡沒有要寫的'] + id_apply(s, parts_json(s['work']))
    senate = shutil.which('senate')
    for w, L in writes.items():
        tmp = os.path.join(CACHE, '_ids_%s.tsv' % hashlib.sha1(w.encode('utf-8')).hexdigest()[:10])
        with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
            for what, nm, d, path in L:
                f.write('%s\t%s\t%s\n' % (what, nm, json.dumps(d, ensure_ascii=False)))
        code, out = run([senate, 'cmd', 'sculpture', '--arg', 'op=work', '--arg', 'sub=meta', '--arg', 'work=' + w, '--arg', 'persona=ame', '--arg', 'file=' + os.path.abspath(tmp)])
        os.remove(tmp)
        if code != 0:
            raise Fail('\n'.join(log + ['✗ 寫回 %s 失敗（exit %d；前面的作品已經寫了）：' % (w, code), out.strip()[-800:]]))
    cfg = load()
    next(x for x in cfg['ships'] if x['id'] == sid)['idNext'] = dict(sorted(nxt.items()))
    save(cfg)
    log.append('✓ 寫回 %d 件作品；下一號記在 ships[%s].idNext' % (len(writes), sid))
    log += id_apply(s, parts_json(s['work']))
    if build:
        log += act_build()
        log += act_ropebind([sid])
        log += act_shipcheck([sid])
    return log


def id_keys():
    """id 與指名別的部件的 meta 鍵（規格表 refs 的新鍵與舊鍵）。"""
    K = {'id'}
    for R in id_refspec().values():
        for f, sp in R.items():
            K |= {f, sp.get('old', f)}
    return K


def id_apply(s, PJ):
    """作品（部件清單，寫回之後重讀的）裡的 id 與指名鍵照路徑同步進 _cache 那份 .vxk 的檔頭（關聯 parts[].path、模型 rig.models[].name）；
    改裝船裡原船那一棵也一樣（路徑對得上就同步）。
    ⛔ 不走 metasync：它會把作品裡別人還沒匯進來的 meta 改動一起帶進來 ⇒ 戰局變了分不出是誰。這裡只動 id_keys() 那幾個鍵。"""
    path = os.path.join(CACHE, s['vxk'])
    raw = zlib.decompress(open(path, 'rb').read(), -15)
    n = struct.unpack('<I', raw[4:8])[0]
    h = json.loads(raw[8:8 + n].decode('utf-8'))
    K = id_keys()
    src = {r['path']: r['meta'] for r in id_records(PJ)}
    hit, miss = 0, 0
    for q in list(h.get('parts', [])) + list((h.get('rig') or {}).get('models', [])):
        sm = src.get(q.get('path') or q.get('name'))
        if sm is None:
            continue
        m = dict(q.get('meta') or {})
        before = dict(m)
        for k in K:
            if k in sm:
                m[k] = sm[k]
            else:
                m.pop(k, None)
        if m != before:
            q['meta'] = dict(sorted(m.items()))
            hit += 1
    hp = {q.get('path') for q in h.get('parts', [])} | {q.get('name') for q in (h.get('rig') or {}).get('models', [])}
    miss = len([p for p, m in src.items() if 'id' in m and p not in hp])
    if hit:
        vxk_write(path, h, raw[8 + n:])
    return ['✓ _cache %s 的檔頭同步了 %d 件的 id／指名%s' % (s['vxk'], hit, '（⚠ %d 件作品裡有、.vxk 還沒有 ⇒ 要 reimport 才帶得進來）' % miss if miss else '')] + ([lock_put(s['vxk'])] if hit else [])


# ───────────────────────── 動作（CLI 與後台頁共用） ─────────────────────────
class Fail(Exception):
    pass


def act_metasync(sid, build=True):
    """只同步 meta 與固定點（TASK-0572）：從雕刻作品匯出部件清單，把每條關聯的 meta、points 換進 _cache 那份 .vxk 的 header（路徑對得上的才換）；
    錨的關聯（meta kind=anchor）補 cells（anchor_cells，TASK-0601）。
    外部模型也一樣（TASK-0640：舵、舵輪的 spin meta 寫在模型上）—— header 的 rig.models[].name ＝ 部件清單 models[].path，只換 meta、points；
    格子、繩、帆、模型的網格與擺放一位元都不動 ⇒ 作品的船體改過也不會被帶進來（要換船體走 reimport）。對不上的路徑列出來（⛔ 不默默略過）。"""
    cfg = load()
    s = next((x for x in cfg['ships'] if x['id'] == sid), None)
    if not s:
        raise Fail('設定檔沒有這艘：' + sid)
    path = os.path.join(CACHE, s['vxk'])
    if not os.path.exists(path):
        raise Fail('_cache 沒有 ' + s['vxk'] + '（先 python -I admin.py cache）')
    senate = shutil.which('senate')
    if not senate:
        raise Fail('找不到 senate')
    tmp = os.path.join(CACHE, '_parts_' + sid + '.json')
    code, out = run([senate, 'cmd', 'sculpture', '--arg', 'op=export', '--arg', 'format=parts', '--arg', 'work=' + s['work'], '--arg', 'out=' + os.path.abspath(tmp)])
    if code != 0 or not os.path.exists(tmp):
        raise Fail('部件清單匯出失敗（exit %d）：' + chr(10) + '%s' % (code, out.strip()))
    PJ = json.load(open(tmp, encoding='utf-8'))
    P = {q['path']: q for q in PJ.get('links', [])}
    PM = {q['path']: q for q in PJ.get('models', [])}
    os.remove(tmp)
    raw = zlib.decompress(open(path, 'rb').read(), -15)
    n = struct.unpack('<I', raw[4:8])[0]
    h = json.loads(raw[8:8 + n].decode('utf-8'))
    ch, miss = [], []
    for q in h.get('parts', []):
        src = P.get(q.get('path'))
        if not src:
            miss.append(q.get('path'))
            continue
        m, pt = src.get('meta') or {}, src.get('points') or {}
        if (q.get('meta') or {}) != m or (q.get('points') or {}) != pt:
            ch.append(q['path'])
            q['meta'], q['points'] = m, pt
    new = sorted(set(P) - {q.get('path') for q in h.get('parts', [])})
    chm, mmiss = [], []                                  # 外部模型（TASK-0640）
    for q in (h.get('rig') or {}).get('models', []):
        src = PM.get(q.get('name'))
        if not src:
            mmiss.append(q.get('name'))
            continue
        m, pt = src.get('meta') or {}, src.get('points') or {}
        if (q.get('meta') or {}) != m or (q.get('points') or {}) != pt:
            chm.append(q['name'])
            q['meta'], q['points'] = m, pt
    mnew = sorted(set(PM) - {q.get('name') for q in (h.get('rig') or {}).get('models', [])})
    ac = anchor_cells(h)                                 # 錨的關聯（meta kind=anchor；TASK-0601）：來源作品的格子寫進 cells
    dc = drive_cells(h)                                  # 動力件（TASK-0653）：來源作品的格子寫進 cellRuns
    pv = prop_vox(h, PM)                                 # 會轉的體素件（螺旋槳；TASK-0653 第二段）：來源作品的格子寫進 rig.models[].vox
    log = ['metasync %s：%d 條關聯換了 meta／固定點%s' % (sid, len(ch), ('：' + '、'.join(ch)) if ch else '')]
    log.append('metasync %s：%d 個模型換了 meta／固定點%s' % (sid, len(chm), ('：' + '、'.join(chm)) if chm else ''))
    if mmiss:
        log.append('⚠ .vxk 有、作品裡沒有的模型 %d 個（照舊）：%s' % (len(mmiss), '、'.join(mmiss)))
    if mnew:
        log.append('⚠ 作品裡新加、.vxk 還沒有的模型 %d 個（要 reimport 才帶得進來）：%s' % (len(mnew), '、'.join(mnew)))
    log += (ac or []) + (dc or []) + (pv or [])
    ch += chm + (['cells'] if ac is not None else []) + (['cellRuns'] if dc is not None else []) + (['vox'] if pv is not None else [])
    if miss:
        log.append('⚠ .vxk 有、作品裡沒有的關聯 %d 條（照舊）：%s' % (len(miss), '、'.join(miss)))
    if new:
        log.append('⚠ 作品裡新加、.vxk 還沒有的關聯 %d 條（要 reimport 才帶得進來）：%s' % (len(new), '、'.join(new)))
    if ch:
        hb = json.dumps(h, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        body = b'VXK1' + struct.pack('<I', len(hb)) + hb + raw[8 + n:]
        co = zlib.compressobj(9, zlib.DEFLATED, -15)
        open(path + '.tmp', 'wb').write(co.compress(body) + co.flush())
        os.replace(path + '.tmp', path)
        log.append(lock_put(s['vxk']))
        if build:
            log += act_build()
            log += act_ropebind([sid])                   # 繩端綁定（TASK-0716）：模型的 id、meta 變了 ⇒ 重算
            log += act_shipcheck([sid])                  # meta 改了 ⇒ 順手檢查一次（只讀）
    return log


def act_cells(sid, build=True):
    """只寫格子清單（TASK-0676）：動力件與梯子的關聯 parts[].cellRuns 照來源作品重算（drive_cells），meta、固定點、格子一位元都不動
    （⛔ 不走 metasync：那會把作品上別人還沒定案的 meta 一起帶進來）。寫了 ⇒ 更新指紋。"""
    cfg = load()
    s = next((x for x in cfg['ships'] if x['id'] == sid), None)
    if not s:
        raise Fail('設定檔沒有這艘：' + sid)
    path = os.path.join(CACHE, s['vxk'])
    if not os.path.exists(path):
        raise Fail('_cache 沒有 ' + s['vxk'] + '（先 python -I admin.py cache）')
    raw = zlib.decompress(open(path, 'rb').read(), -15)
    n = struct.unpack('<I', raw[4:8])[0]
    h = json.loads(raw[8:8 + n].decode('utf-8'))
    dc = drive_cells(h)
    if dc is None:
        return ['cells %s：格子清單沒變' % sid]
    vxk_write(path, h, raw[8 + n:])
    log = ['cells %s：' % sid] + ['  ' + x for x in dc] + [lock_put(s['vxk'])]
    if build:
        log += act_build()
    return log


def act_check():
    E = validate(load())
    if E:
        raise Fail('設定不合法：\n' + '\n'.join('  ✗ ' + e for e in E))
    return ['✓ config/game.json 合法（%d 艘船、%d 個滑桿、%d 種砲）' % (len(load()['ships']), len(load()['lim']), len(load()['guns']))]


REPORTS = os.path.normpath(os.path.join(HERE, '..', 'reports'))   # 匯入檢查的報告（不入版控）
CHROMES = [r'C:\Program Files\Google\Chrome\Application\chrome.exe', r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe']


META_ON = ('model', 'link', 'sail', 'rope')


def act_metaspec(doc_path=None):
    """meta 規格表（config/meta_kinds.json，TASK-0672）對拍三樣東西 ⇒ 不一致的列出來（exit 非 0）：
    ① 規格表本身（每一列欄位齊、on 只有 model／link／sail／rope、game 指到的檔存在）；
    ② 船隻清單每一艘的 _cache 檔頭：用到、規格表沒有的 kind，掛的地方（模型／關聯／帆／繩）規格表沒寫的；
    ③ 造船規格（Senate 文件 Sculpture_Shipbuilding；senate cmd doc 讀，或 --doc 給檔案）：§9 那張 kind 表的每一列規格表要有、
       規格表寫了 doc 的每一個 kind 文件裡要出現（`kind=<k>` 或表格那一格）、need 的固定點要寫在文件裡（表格那一列或那一節）。"""
    K, E, log = meta_kinds(), [], []
    for k, v in K.items():
        for f in ('name', 'on', 'keys', 'need', 'use', 'doc', 'game'):
            if f not in v:
                E.append('規格表 %s：少了 %s' % (k, f))
        if not set(v.get('on') or []) <= set(META_ON) or not v.get('on'):
            E.append('規格表 %s：on 只能是 %s' % (k, '／'.join(META_ON)))
        for g in v.get('game') or []:
            if not os.path.exists(os.path.join(HERE, 'js', g)):
                E.append('規格表 %s：game 的 %s 不存在' % (k, g))
        for f, ok, what in (('hpK', lambda x: isnum(x) and 0 < x <= 20, '0～20 的數字'), ('block', lambda x: x in (True, False, 'station'), 'true／false／"station"'),
                            ('clear', lambda x: isinstance(x, bool), 'true／false'), ('safe', lambda x: isinstance(x, bool), 'true／false'),
                            ('noFall', lambda x: isinstance(x, bool), 'true／false'), ('anim', lambda x: isinstance(x, bool), 'true／false'),
                            ('deco', lambda x: isinstance(x, bool), 'true／false'), ('blow', lambda x: x in ('fly', 'fall'), 'fly／fall')):   # 遊戲屬性（TASK-0672 ②；js/00_config.js kindProp）；deco ＝ kind 本身就是裝飾（TASK-0719 砲門蓋板，js/05_hull.js isDeco）
            if f in v and not ok(v[f]):
                E.append('規格表 %s：%s 要是 %s' % (k, f, what))
        for f, sp in (v.get('refs') or {}).items():          # 指名別的部件（TASK-0715）：鍵要在 keys、to 指的 kind 要在規格表（<kind># ＝ 那一類關聯裡的一座）
            if f not in (v.get('keys') or []) or sp.get('old', f) not in (v.get('keys') or []):
                E.append('規格表 %s：refs 的 %s（舊鍵 %s）要列在 keys' % (k, f, sp.get('old', f)))
            for t in sp.get('to') or [None]:
                if not t or t.rstrip('#') not in K:
                    E.append('規格表 %s：refs.%s.to 的 %s 規格表沒有' % (k, f, t))
            if 'list' in sp and not isinstance(sp['list'], bool):   # list：可以指好幾件（逗號分開；彈藥庫 hoist）
                E.append('規格表 %s：refs.%s.list 要是 true／false' % (k, f))
    log.append('① 規格表：%d 個 kind' % len(K))
    seen = {}
    for sh in load()['ships']:
        if not os.path.exists(os.path.join(CACHE, sh['vxk'])):
            continue
        h, _ = _cache_raw(sh)
        rig = h.get('rig') or {}
        for on, L in (('link', h.get('parts')), ('model', rig.get('models')), ('sail', rig.get('sails')), ('rope', rig.get('ropes'))):
            for q in L or []:
                k = ((q or {}).get('meta') or {}).get('kind') if isinstance(q, dict) else None
                if k:
                    seen.setdefault((k, on), set()).add(sh['id'])
    for (k, on), ids in sorted(seen.items()):
        if k not in K:
            E.append('船：kind=%s（%s）規格表沒有 —— %s' % (k, on, '、'.join(sorted(ids))))
        elif on not in K[k]['on']:
            E.append('船：kind=%s 掛在 %s 上，規格表寫 %s —— %s' % (k, on, '／'.join(K[k]['on']), '、'.join(sorted(ids))))
    log.append('② 船：%d 艘用到 %d 個 kind' % (len(load()['ships']), len({k for k, _ in seen})))
    if doc_path:
        doc = open(doc_path, encoding='utf-8').read()
    else:
        senate = shutil.which('senate')
        if not senate:
            log.append('③ 造船規格：沒對（找不到 senate；或給 --doc <檔案>）')
            doc = None
        else:
            r = subprocess.run([senate, 'cmd', 'doc', '--arg', 'op=show', '--arg', 'name=Sculpture_Shipbuilding'], capture_output=True, text=True, encoding='utf-8')
            doc = r.stdout if r.returncode == 0 else None
            if doc is None:
                log.append('③ 造船規格：沒對（senate cmd doc 讀不到：exit %d）' % r.returncode)
    if doc:
        i = doc.find('## 9. ')
        j = doc.find('\n- ', i) if i >= 0 else -1
        table = doc[i:j] if i >= 0 else ''
        rows = dict(re.findall(r'^\| `([a-z_]+)`[^|]*\|(.*)$', table, re.M))
        for k in rows:
            if k not in K:
                E.append('造船規格 §9 表有 kind=%s，規格表沒有' % k)
        for k, v in K.items():
            if not v.get('doc'):
                continue
            if k not in rows and not re.search(r'kind=%s\b' % re.escape(k), doc) and ('`%s`' % k) not in doc:
                E.append('規格表 %s（doc %s）：造船規格裡找不到 kind=%s' % (k, v['doc'], k))
                continue
            text = rows.get(k, '') + ' ' + ' '.join(m for m in re.findall(r'[^\n]*kind=%s\b[^\n]*' % re.escape(k), doc))
            for pt in v.get('need') or []:
                bare = pt.replace('<名>', '')
                if bare not in text:
                    E.append('規格表 %s：need 的固定點 %s 造船規格裡那一列／提到 kind=%s 的地方沒寫' % (k, pt, k))
        log.append('③ 造船規格：§9 表 %d 列；規格表寫了 doc 的 %d 個 kind 都對過' % (len(rows), sum(1 for v in K.values() if v.get('doc'))))
    if E:
        raise Fail('\n'.join(log) + '\nmeta 規格表對不上：\n' + '\n'.join('  ✗ ' + e for e in E))
    return log + ['✓ meta 規格表跟船、造船規格一致']


def shipcheck_page(chrome, sid):
    """無頭 Chrome 跑成品的 ?shipcheck=<船>，回頁面寫出來的結果（JSON）；沒跑完 ⇒ None。"""
    import html as _html, tempfile
    prof = tempfile.mkdtemp(prefix='shipcheck_')
    try:
        url = 'file:///' + OUT.replace('\\', '/') + '?shipcheck=' + sid   # 風在頁面裡固定（js/75_shipcheck.js WIND_FIX）⇒ 誰開、從哪裡開都一樣
        r = subprocess.run([chrome, '--headless=new', '--no-first-run', '--user-data-dir=' + prof, '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
                            '--virtual-time-budget=300000', '--dump-dom', url], capture_output=True, timeout=900)
        ms = re.findall(r'<pre id="shipcheck">(.*?)</pre>', r.stdout.decode('utf-8', 'replace'), re.S)
        return json.loads(_html.unescape(ms[-1])) if ms else None   # 最後一個 ＝ 頁面寫出來的那個（⛔ 第一個可能是內嵌程式裡的字串）
    except Exception:
        return None
    finally:
        shutil.rmtree(prof, ignore_errors=True)


ROPEBIND_KIND = {'grid': '格子（旁邊 5 格內有實心格）', 'turret': '砲塔的殼', 'yard': '帆桁', 'model': '模型（作品寫明）', 'guess': '模型（照外框猜）', 'rope': '母繩', 'sail': '只靠帆角', 'none': '哪裡都不靠'}


def act_ropebind(ids=None, build=True):
    """繩端綁定（TASK-0716；Tim 2026-10-18「遊戲端真的要猜測應該要放在匯入時（檢查、猜測並產生報表）」）：
    跑成品的 ?shipcheck=<船>，拿遊戲照同一套規則現場算的每條繩兩端綁在哪（R.binds；js/10_ship.js ropeDecide），寫進 _cache 那份 .vxk 的 rig.ropes[i].bind
    ⇒ 遊戲照它套、不猜（js/10_ship.js linkRopes）；出報表 reports/ropebind_<船>.md（每一類幾端、照外框猜的模型、哪裡都不靠的一端）。
    要先建過（成品裡的船 ＝ _cache 那份）；檔頭變了 ⇒ 更新指紋，build 為真就重建。"""
    cfg = load()
    ids = ids or [s['id'] for s in cfg['ships']]
    chrome = next((c for c in CHROMES if os.path.exists(c)), None)
    if not chrome:
        return ['⚠ 繩端綁定沒跑：找不到 Chrome（' + '、'.join(CHROMES) + '）']
    os.makedirs(REPORTS, exist_ok=True)
    log, dirty = [], False
    for sid in ids:
        s = next((x for x in cfg['ships'] if x['id'] == sid), None)
        R = shipcheck_page(chrome, sid) if s else None
        B = R.get('binds') if R else None
        if B is None:
            log.append('  ✗ %s：繩端綁定讀不到結果（無頭 Chrome 沒跑完、或成品比 _cache 舊 ⇒ 先 build）' % sid)
            continue
        path = os.path.join(CACHE, s['vxk'])
        raw = zlib.decompress(open(path, 'rb').read(), -15)
        n = struct.unpack('<I', raw[4:8])[0]
        h = json.loads(raw[8:8 + n].decode('utf-8'))
        RP = (h.get('rig') or {}).get('ropes') or []
        if len(B) != len(RP):
            log.append('  ✗ %s：成品裡 %d 條繩、_cache 那份 %d 條 ⇒ 成品比 _cache 舊，先 build 再跑' % (sid, len(B), len(RP)))
            continue
        changed, cnt, guess, none = 0, {}, [], []
        for r, b in zip(RP, B):
            if b is None:
                if 'bind' in r:
                    del r['bind']
                    changed += 1
                cnt['grid'] = cnt.get('grid', 0) + 2
                continue
            if r.get('bind') != b:
                r['bind'] = b
                changed += 1
            for e, d in enumerate(b):
                if d == 0:
                    k = 'grid'
                elif d['k'] == 'none':
                    k = 'sail' if d.get('s') else 'none'
                else:
                    k = 'guess' if d.get('g') else d['k']
                cnt[k] = cnt.get(k, 0) + 1
                ref = (r.get('ends') or [None, None])[e]
                if k == 'guess':
                    guess.append((r.get('name'), e, d.get('m'), ref))
                if k == 'none':
                    none.append((r.get('name'), e, ref))
        md = ['# 繩端綁定：%s（%s）' % (s['name'], sid), '',
              '> `python -I admin.py ropebind --id %s` 產生（匯入、重新匯入、metasync、ids 會自己跑）；規則在 `js/10_ship.js` ropeDecide：' % sid,
              '> 砲塔的殼 → 作品寫明的（ends：`model:` 那個模型、`rope:` 只找繩、`sail:` 與固定點不猜模型）→ 帆桁 → 母繩（≤ 3 格）→ 最後才照外框猜模型。結果寫進 `.vxk` 的 `rig.ropes[].bind`，遊戲照它綁、不猜。', '',
              '| 綁在 | 端數 |', '|---|---|'] + ['| %s | %d |' % (ROPEBIND_KIND.get(k, k), v) for k, v in sorted(cnt.items(), key=lambda kv: -kv[1])] + ['']
        if guess:
            md += ['## 照外框猜的模型（作品沒寫綁哪裡）', '', '雕刻端可以跑 `senate cmd sculpture --arg op=work --arg sub=ropecheck --arg work=%s` 對照、改成寫明。' % s['work'], '',
                   '| 繩 | 端 | 作品寫的 | 猜到 |', '|---|---|---|---|'] + ['| `%s` | %s | `%s` | `%s` |' % (nm, 'from' if e == 0 else 'to', ref, m) for nm, e, m, ref in guess] + ['']
        if none:
            md += ['## 哪裡都不靠的一端', '', '另一端有靠就照常畫（垂著）；兩端都不靠的繩開局就不畫。', '',
                   '| 繩 | 端 | 作品寫的 |', '|---|---|---|'] + ['| `%s` | %s | `%s` |' % (nm, 'from' if e == 0 else 'to', ref) for nm, e, ref in none] + ['']
        rp = os.path.join(REPORTS, 'ropebind_%s.md' % sid)
        open(rp, 'w', encoding='utf-8').write('\n'.join(md))
        if changed:
            vxk_write(path, h, raw[8 + n:])
            log.append(lock_put(s['vxk']))
            dirty = True
        log.append('  %s %s（%s）：繩 %d 條、檔頭改了 %d 條；照外框猜 %d 端、不靠 %d 端 ⇒ %s' % ('⚠' if guess else '✓', s['name'], sid, len(RP), changed, len(guess), len(none), rp))
    if dirty and build:
        log += act_build()
    return ['繩端綁定：'] + log


def act_shipcheck(ids=None):
    """匯入檢查（Tim 2026-10-15：缺 meta、砲位擠到砲班站不滿 ⇒ 匯入時就報出來，方便修）。
    規則住在遊戲裡（js/75_shipcheck.js，?shipcheck=<船>）：遊戲自己知道缺了什麼會退回什麼 ⇒ 這裡只用無頭 Chrome 跑成品、把結果寫成報告。
    ids 不給 ⇒ 船隻清單每一艘。報告：reports/shipcheck_<船>.md（同樣的問題併成一筆、列出是哪些部件）。"""
    cfg = load()
    ids = ids or [s['id'] for s in cfg['ships']]
    chrome = next((c for c in CHROMES if os.path.exists(c)), None)
    if not chrome:
        return ['⚠ 匯入檢查沒跑：找不到 Chrome（' + '、'.join(CHROMES) + '）']
    if not os.path.exists(OUT):
        return ['⚠ 匯入檢查沒跑：還沒有成品（先 build）']
    os.makedirs(REPORTS, exist_ok=True)
    log, cards = [], {}
    for sid in ids:
        R = shipcheck_page(chrome, sid)
        if not R:
            log.append('  ✗ %s：匯入檢查讀不到結果（無頭 Chrome 沒跑完）' % sid)
            continue
        groups = {}
        for i in R['issues']:
            k = (i['lv'], i['what'], i['msg'], i['fix'])
            groups.setdefault(k, []).append(i['where'])
        ne = sum(len(w) for k, w in groups.items() if k[0] == 'error')
        nw = sum(len(w) for k, w in groups.items() if k[0] == 'warn')
        I = R['info']
        md = ['# 匯入檢查：%s（%s）' % (I.get('name', sid), sid), '',
              '> `python -I admin.py shipcheck --id %s` 產生；規則在 `js/75_shipcheck.js`。開一場（跟憲法號隔最遠、打不到）跑 %s 秒量的。' % (sid, R['t']),
              '> ✗ 錯誤 ＝ 遊戲裡壞掉；⚠ 警告 ＝ 能動，但照退路或預設跑。修法裡的「造船規格」＝ `senate cmd doc --arg op=show --arg name=Sculpture_Shipbuilding`。', '',
              '| 砲 | 站不滿的砲 | 船員 | 模型 | 繩 | 帆 | 桅 | 彈藥庫 | 甲板 | 梯子 | 艙房 | 錨 | 水線 z |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
              '| %s | %s 門缺 %s 人 | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |' % (I['guns'], I['gunShort']['guns'], I['gunShort']['people'], I['crew'], I['models'], I['ropes'], '%s%s' % (I['sails'], '（＋陣營旗 %d）' % I['teamFlags'] if I.get('teamFlags') else ''), I['masts'], '%s（取用點 %s）' % (I['mags'], I.get('stations', '—')), len(I['decks']), I['ladders'], I['rooms'], I.get('anchors', '—'), I['zw']), '',
              '材質（TASK-0616）：' + (I.get('materials') or '—'), '',
              '平滑渲染（關聯 meta render=smooth，TASK-0616）：' + (I.get('smooth') or '—'), '',
              '火藥（送藥手：取用點 → 砲尾藥箱）：' + (I.get('powder') or '—'), '',
              '迴旋砲／砲塔（meta mount；沒標 ＝ 固定）：' + (I.get('mounts') or '—'), '',
              '砲塔層（關聯 meta kind=turret；殼、上面的砲與模型、彈藥箱跟著轉，前方 front 對準瞄準方位，TASK-0659）：' + (I.get('turrets') or '—'), '',
              '砲帶的裝甲（關聯 meta kind=armor、mount；跟著砲轉、一格一格打掉，TASK-0631）：' + (I.get('armor') or '—'), '',
              '門、艙蓋（模型 meta kind=door、固定點 hinge-a／hinge-b；不擋人、打掉了開口才進水，TASK-0638）：' + (I.get('doors') or '—'), '',
              '砲門蓋板（模型 meta kind=portlid、lid_of、固定點 hinge-a／hinge-b；本身是裝飾，交戰掀蓋推砲、沒事收砲闔蓋，只是畫面，TASK-0719）：' + (I.get('ports') or '—'), '',
              '後座（開火沿砲軸往裡退、裝填快好推出去；模型 meta recoil 格數，0 ＝ 不演；弩箭／火箭／石彈／希臘火不演；只是畫面）：' + (I.get('recoil') or '—'), '',
              '照參數轉的子物件（模型 meta spin；舵、舵輪跟著舵角轉，只是畫面，TASK-0640）：' + (I.get('spins') or '—'), '',
              '裝飾（模型 meta deco=1；載入時拿掉、畫質「裝飾」開著才畫，不算重量、不被打，TASK-0682）：' + (I.get('deco') or '—'), '',
              '廚房（模型 meta kind=galley；廚師站在爐灶旁、預備水手當伙夫去領飯，TASK-0720）：' + (I.get('galley') or '—'), '',
              '額外動力（TASK-0630；輸出物件 份量；主機／軸／鍋爐 照造船規格 §9.6；槳 §9.10，TASK-0691）：' + (I.get('drive') or '—（沒有 cfg.base）'), '',
              '動力件（TASK-0653；關聯 meta kind=engine／boiler／shaft／steampipe 的格子清單，照剩幾成、通不通算）：' + (I.get('drvparts') or '—'), '',
              '會轉的體素件（螺旋槳模型 meta kind=propeller 的格子；跟著軸轉、一格一格打掉、推力照剩幾成，TASK-0653 第二段）：' + (I.get('props') or '—'), '',
              '操舵（TASK-0777；每支舵的鏈 舵令 ⇒ 舵輪／舵柄 meta kind=wheel／tiller（＋舵索 meta steer）⇒ 舵 kind=rudder、份量 helm_share；造船規格 §9.8.1）：' + (I.get('helm') or '—（操舵的開關關著）'), '',
              '**✗ %d　⚠ %d**' % (ne, nw), '']
        for lv, title in (('error', '## ✗ 錯誤'), ('warn', '## ⚠ 警告')):
            ks = [k for k in groups if k[0] == lv]
            if not ks:
                continue
            md += [title, '']
            for k in ks:
                w = groups[k]
                md.append('- **%s**%s：%s' % (k[1], '（×%d）' % len(w) if len(w) > 1 else '', k[2]))
                md.append('  - 哪裡：' + '、'.join('`%s`' % x for x in w))
                md.append('  - 修法：' + k[3])
            md.append('')
        if not groups:
            md += ['✓ 沒有發現問題', '']
        path = os.path.join(REPORTS, 'shipcheck_%s.md' % sid)
        open(path, 'w', encoding='utf-8').write('\n'.join(md))
        log.append('  %s %s（%s）：✗ %d　⚠ %d ⇒ %s' % ('✗' if ne else '⚠' if nw else '✓', I.get('name', sid), sid, ne, nw, path))
        if R.get('card'):
            cards[sid] = R['card']
    if cards:
        log.append('  ' + cards_write(cards))
    return ['匯入檢查：'] + log


CARDS_P = os.path.join(HERE, 'config', 'ship_cards.json')   # 選船彈窗的卡片（js/72_shippick.js；建置時內嵌成 #ship-cards）：shipcheck 量出來的（js/75_shipcheck.js shipCard），⛔ 不手改


def cards_write(new):
    """shipcheck 量到的卡片併進 config/ship_cards.json（量到哪幾艘換哪幾艘；船隻清單沒有的拿掉）。內容沒變 ⇒ 不寫（免得每次 shipcheck 都多一筆 diff）。"""
    old = json.load(open(CARDS_P, encoding='utf-8')) if os.path.exists(CARDS_P) else {}
    ids = [s['id'] for s in load()['ships']]
    C = {k: v for k, v in (old.get('ships') or {}).items() if k in ids}
    C.update(new)
    out = {'about': '選船彈窗的卡片（主選單；js/72_shippick.js）：每艘船開戰那一刻量的排水量、水線長、砲、齊射彈重、動力、帆、船員。admin.py shipcheck 產生（js/75_shipcheck.js shipCard），不要手改。',
           'ships': {k: C[k] for k in ids if k in C}}
    if out == old:
        return '卡片沒變（config/ship_cards.json）'
    with open(CARDS_P, 'w', encoding='utf-8', newline='\n') as f:
        f.write('{\n  "about": %s,\n  "ships": {\n%s\n  }\n}\n' % (json.dumps(out['about'], ensure_ascii=False),
                ',\n'.join('    %s: %s' % (json.dumps(k), json.dumps(v, ensure_ascii=False, separators=(', ', ': '))) for k, v in out['ships'].items())))
    miss = [k for k in ids if k not in out['ships']]
    return '卡片寫進 config/ship_cards.json（%d 艘%s；重建之後選船彈窗才看得到）' % (len(out['ships']), '；還沒量：' + '、'.join(miss) if miss else '')


# 頂層短名（TASK-0671）：4 字以內的小寫頂層名字（step、last、hurt…）⇒ 區域變數忘了 var 就蓋到它、讀的人也猜不到是哪支檔的 ⇒ 加模組字首。
#   留著的（大家共用的詞彙，改了會跟每一條分支撞）照類列在 SHORT_OK；新加的短名不在裡面 ⇒ 不建置（加字首，或真的是共用詞彙就寫進來）。
SHORT_OK = {
    'add', 'sub', 'mul', 'dot', 'len', 'norm', 'fwd', 'rotM', 'rotZ',                      # 向量數學（00_core、31_sailing、21_gunnery）
    'gl', 'cv',                                                                             # WebGL 的 context 與畫布（01_gl）
    'rnd', 'rr', 'rD', 'rndD', 'rndX', 'rrX', 'rndW', 'rgW', 'gsW', 'rndR', 'rndF', 'rgF',  # 亂數工廠的別名（00_core rngMake；每條一個字母）
    'rndC', 'rgC', 'gsC', 'rgFn',
    'note', 'sfx', 'evOn',                                                                  # 事件（00_events）
    'seaH', 'matK', 'lvAt', 'lvOf', 'navG', 'navZ', 'ndIn', 'armM', 'fpG', 'fpUI', 'fpsT',  # 已經帶模組字首的（sea、mat、lv、nav、nd、arm、fp、fps…）
    'fsOn', 'fxPt', 'flGL', 'flPd', 'rdGL', 'wpGL', 'wpLv', 'smRk', 'mkFB', 'mkRB', 'penP',
    'ramK', 'wlZ', 'deg3', 'fGet', 'fPut', 'vxH',
}
SHORT_RX = re.compile(r'[a-z][a-zA-Z0-9]{0,3}$')
# 改過名的（TASK-0671，2026-10-17）：舊名 ⇒ 新名。別人的分支合進來還在用舊名（沒被區域宣告遮住）⇒ 不建置、告訴他新名字（⛔ 不擋 ⇒ 執行到才 ReferenceError）。
RENAMED = {'last': 'loopLast', 'acc': 'loopAcc', 't0': 'loadT0', 'say': 'loadSay', 'drag': 'inDrag', 'pick': 'inPick', 'deg': 'fuDeg', 'hud': 'hudFrame',
           'step': 'simStep', 'ai': 'simAi', 'gp': 'hullGp', 'slab': 'gunSlab', 'fnv': 'cacheFnv', 'qnum': 'stateQnum', 'fail': 'glFail', 'kill': 'fxKill',
           'fall': 'crewFall', 'hurt': 'crewHurt', 'able': 'crewAble', 'sail': 'sailShip',
           'rs': 'RNG.battle（00_core 亂數工廠）', 'rsD': 'RNG.debris', 'rsX': 'RNG.fx', 'rsW': 'RNG.water', 'rsR': 'RNG.rain', 'rsF': 'RNG.flood', 'rsC': 'RNG.cloth',
           'rsFn': 'RNG.funnel', 'RSD0': 'RNG.debris.salt', 'RSX0': 'RNG.fx.salt', 'RSW0': 'RNG.water.salt', 'RSF0': 'RNG.flood.salt', 'RSC0': 'RNG.cloth.salt',
           'RSFN0': 'RNG.funnel.salt'}


def bundle_names_check():
    """TASK-0671：同一個包（data-bundle）裡兩個地方定義同一個頂層名字 ⇒ 擋下、不建置（後面的會靜悄悄蓋掉前面的；10-15 的 rndF）。
    頂層宣告照 node 內建的 acorn 讀（src/js_globals.cjs：function、var／let／const、class，解構也拆開）；同一支檔裡定義兩次也算。
    頁面：template.html（遊戲）＋ sandbox.html（指揮官沙盒，有的話）；不同包的同名不算（各自一個閉包）。沒有 node ⇒ 讀數寫「沒驗」，照建。"""
    node = shutil.which('node')
    if not node:
        return ['⚠ 頂層同名：沒驗（找不到 node）']
    pages = [TPL] + [x for x in [os.path.join(HERE, 'sandbox.html')] if os.path.exists(x)]
    bundles = {}
    for pg in pages:
        for rel, name in re.findall(r'<script\s+src="([^"]+)"\s+data-bundle="([^"]+)"', open(pg, encoding='utf-8').read()):
            L = bundles.setdefault((os.path.basename(pg), name), [])
            if rel not in L:
                L.append(rel)
    files = sorted({rel for L in bundles.values() for rel in L})
    r = subprocess.run([node, '--expose-internals', os.path.join(HERE, 'js_globals.cjs')] + [os.path.join(HERE, f) for f in files],
                       capture_output=True, text=True, encoding='utf-8', cwd=HERE)
    try:
        G = {os.path.relpath(k, HERE).replace(os.sep, '/'): v for k, v in json.loads(r.stdout.strip().splitlines()[-1]).items()}
    except Exception:
        raise Fail('頂層同名檢查讀不到結果：%s' % (r.stdout + r.stderr).strip()[-300:])
    bad = [f for f in files if isinstance(G.get(f), dict)]
    if bad:
        raise Fail('頂層同名檢查：解析失敗（不建置）：\n' + '\n'.join('  ✗ %s：%s' % (f, G[f]['err']) for f in bad))
    E, n = [], 0
    for (pg, name), L in bundles.items():
        seen = {}
        for f in L:
            for nm, line in G[f]:
                n += 1
                if nm in seen:
                    E.append('%s 包「%s」：%s 在 %s:%d 跟 %s:%d 都有定義' % (pg, name, nm, seen[nm][0], seen[nm][1], f, line))
                else:
                    seen[nm] = (f, line)
    if E:
        raise Fail('頂層同名（同一個包裡後面的會蓋掉前面的，不建置；改名或加模組字首）：\n' + '\n'.join('  ✗ ' + e for e in E))
    S = sorted({(nm, f, line) for f in files for nm, line in G[f] if SHORT_RX.match(nm) and nm not in SHORT_OK})
    if S:
        raise Fail('頂層短名（4 字以內的小寫；加模組字首，或真的是共用詞彙就寫進 admin.py SHORT_OK）：\n' + '\n'.join('  ✗ %s（%s:%d）' % x for x in S))
    O = []
    for (pg, name), L in bundles.items():
        r = subprocess.run([node, '--expose-internals', os.path.join(HERE, 'js_globals.cjs'), '--retired', ','.join(RENAMED)] + [os.path.join(HERE, f) for f in L],
                           capture_output=True, text=True, encoding='utf-8', cwd=HERE)
        try:
            old = json.loads(r.stdout.strip().splitlines()[-1])['old']
        except Exception:
            raise Fail('舊名字的檢查讀不到結果：%s' % (r.stdout + r.stderr).strip()[-300:])
        O += ['%s:%d 還在用 %s ⇒ 改名叫 %s' % (os.path.relpath(f, HERE).replace(os.sep, '/'), line, nm, RENAMED[nm]) for f, line, nm in old]
    if O:
        raise Fail('用到改過名的頂層名字（TASK-0671；不建置）：\n' + '\n'.join('  ✗ ' + o for o in sorted(set(O))))
    # 沒宣告就寫入：區域變數忘了 var ⇒ 嚴格模式下執行到才報錯；剛好跟 window 上的名字（name、status…）同名 ⇒ 連錯都不報、寫到 window 上
    W = []
    for (pg, name), L in bundles.items():
        r = subprocess.run([node, '--expose-internals', os.path.join(HERE, 'js_globals.cjs'), '--writes'] + [os.path.join(HERE, f) for f in L],
                           capture_output=True, text=True, encoding='utf-8', cwd=HERE)
        try:
            bad = json.loads(r.stdout.strip().splitlines()[-1])['bad']
        except Exception:
            raise Fail('沒宣告就寫入的檢查讀不到結果：%s' % (r.stdout + r.stderr).strip()[-300:])
        W += ['%s 包「%s」：%s:%d 寫入 %s，可是哪裡都沒宣告' % (pg, name, os.path.relpath(f, HERE).replace(os.sep, '/'), line, nm) for f, line, nm in bad]
    if W:
        raise Fail('沒宣告就寫入（多半是忘了 var；不建置）：\n' + '\n'.join('  ✗ ' + w for w in W))
    return ['✓ 頂層同名：%d 個包、%d 支檔、%d 個頂層名字，沒有重複；沒宣告就寫入：0；新的短名：0；用到改過名的：0（acorn）' % (len(bundles), len(files), n)]


# ───────────────────────── 共用狀態只由擁有者寫（TASK-0669 ③） ─────────────────────────
# 鏡頭 CAM 只由 03_camera.js 寫（其他檔叫 camStart／camPanBy／camOrbit／camCycle／camSee／camSize／camSet）；
# 在跑 RUNNING、停格 PAUSED、玩法 MODE 只由 70_flow.js 寫（其他檔叫 flowRun／flowPause／flowMode）。
# 寫 ＝ 直接指派（MODE = …、RUNNING++）或寫它的欄位（CAM.yaw = …、CAM.pan[0] += …、CAM[k] = …）；照作用域判（src/js_refs.cjs），區域同名的不算。
OWNED = {'CAM': '03_camera.js', 'RUNNING': '70_flow.js', 'PAUSED': '70_flow.js', 'MODE': '70_flow.js'}


def owner_check():
    """別的檔直接寫 OWNED 裡的共用狀態 ⇒ 不建置（印出哪一行、該叫誰）。沒有 node ⇒ 讀數寫「沒驗」。"""
    node = shutil.which('node')
    if not node:
        return ['⚠ 共用狀態的擁有者：沒驗（找不到 node）']
    files = re.findall(r'<script\s+src="(js/[^"]+)"\s+data-bundle="game"', open(TPL, encoding='utf-8').read())
    r = subprocess.run([node, '--expose-internals', os.path.join(HERE, 'js_refs.cjs')] + [os.path.join(HERE, f) for f in files],
                       capture_output=True, text=True, encoding='utf-8', cwd=HERE)
    try:
        d = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        raise Fail('共用狀態的擁有者檢查讀不到結果：%s' % (r.stdout + r.stderr).strip()[-300:])
    E = sorted({'%s:%d 寫了 %s ⇒ 只有 %s 能寫（叫它的函式）' % (os.path.relpath(f, HERE).replace(os.sep, '/'), line, nm, OWNED[nm])
                for f, nm, line, how in d['refs'] if nm in OWNED and how in ('w', 'm') and os.path.basename(f) != OWNED[nm]})
    if E:
        raise Fail('共用狀態只由擁有者寫（TASK-0669；不建置）：\n' + '\n'.join('  ✗ ' + e for e in E))
    return ['✓ 共用狀態的擁有者：%s 只有擁有者寫' % '、'.join('%s（%s）' % (k, v) for k, v in OWNED.items())]


# ───────────────────────── 分層讀數（TASK-0669：模擬與畫面解耦） ─────────────────────────
# 模擬層 ＝ 20–54 號檔（船體、物理、船員、模擬與 AI；41_crew_art 是畫船員貼圖 ⇒ 算畫面）；上層 ＝ 60 號以後＋下面那幾支畫面、聲音、鏡頭的檔。
# 76_anchor、78_funnel 編號在後面、職責是模擬（拋錨、煙囪通不通）⇒ 不算上層（不改檔名：會跟大家的分支撞）。
# 模擬層要叫上層 ⇒ 00_events.js 加一個發事件的名字、讓上層訂閱（README 00_events.js 那一列）；這裡列出還沒拆的。
LAYER_VIEW = ('02_audio.js', '02_ambient.js', '02_music.js', '03_camera.js', '11_rig_gpu.js', '12_effects.js', '13_water.js', '14_rain.js', '15_smooth.js', '41_crew_art.js')
LAYER_SIMX = ('76_anchor.js', '78_funnel.js')


def act_layers(src=None):
    """模擬層直接用到上層的名字（照作用域判：src/js_refs.cjs）⇒ 每個名字：定義在哪、誰用了幾次。src ＝ 另一份 src 目錄（量別的版本）。"""
    node = shutil.which('node')
    if not node:
        raise Fail('找不到 node（src/js_refs.cjs 要它）')
    root = os.path.abspath(src) if src else HERE
    files = re.findall(r'<script\s+src="(js/[^"]+)"\s+data-bundle="game"', open(os.path.join(root, 'template.html'), encoding='utf-8').read())
    r = subprocess.run([node, '--expose-internals', os.path.join(HERE, 'js_refs.cjs')] + [os.path.join(root, f) for f in files],
                       capture_output=True, text=True, encoding='utf-8', cwd=root)
    try:
        d = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        raise Fail('js_refs.cjs 讀不到結果：%s' % (r.stdout + r.stderr).strip()[-300:])
    b = os.path.basename
    sim = lambda f: 20 <= int(b(f)[:2]) <= 54 and b(f) not in LAYER_VIEW
    up = lambda f: (int(b(f)[:2]) >= 60 and b(f) not in LAYER_SIMX) or b(f) in LAYER_VIEW
    res = {}
    for f, nm, line, how in d['refs']:
        df = d['defs'][nm]
        if sim(f) and up(df) and df != f:
            res.setdefault((b(df), nm), {}).setdefault(b(f)[:-3], []).append(line)
    log = ['模擬層（20–54 號檔）直接用到上層的名字（%s）：' % (src or 'src')]
    for (df, nm), U in sorted(res.items()):
        log.append('  %-15s %-16s %s' % (df, nm, '  '.join('%s:%s' % (u, ','.join(map(str, L))) for u, L in sorted(U.items()))))
    n, e = sum(len(L) for U in res.values() for L in U.values()), len({(u, df) for (df, nm), U in res.items() for u in U})
    return log + ['名字 %d 個、引用 %d 次、檔對檔 %d 條' % (len(res), n, e)]


# ───────────────────────── 核心與外殼（主選單、設定頁）的讀數（2026-10-21：核心與外殼拆兩包的第 0 步） ─────────────────────────
# 外殼 ＝ Blockside 自己的主選單、設定頁、開發後台頁（#cover 裡的那些卡）；核心 ＝ 其他（海戰：船、海、陰影、物理、HUD、遊戲中的面板、選船彈窗 72_shippick）。
# 目標：依賴只往下 —— 外殼叫核心 OK；核心叫外殼的名字、核心碰 #cover 裡的 DOM ⇒ 都要拆成事件（00_events.js）或外殼自己掛，拆完這兩個數字是 0。
# 還沒搬檔之前外殼跟核心寫在同一支檔裡 ⇒ SHELL_UI：整支是外殼的檔 ⇒ None；一支檔裡的幾段 ⇒ [(起, 迄), …]：
#   起 ＝ 那一段第一行裡的一段字（含這一行）、迄 ＝ 下一段（核心）第一行裡的一段字（不含；None ＝ 到檔尾）。用字不用行號 ⇒ 別人改了前面，行號跑掉照樣量得準；
#   字找不到或不只一行 ⇒ 讀數停下來說哪一個（改 SHELL_UI，不要猜）。
# 只是讀數、不擋建置（拆完才變閘門）。量法：頂層名字照作用域判（src/js_refs.cjs）；DOM 照字面掃 $('id')、getElementById('id')、querySelector(All)('…#id…')。
SHELL_UI = {
    '64_cfgkit.js': None,                                                      # 設定頁的共用框架（cfgSnap 之後搬進核心）
    '65_ask.js': None,                                                         # 確認彈窗（只有設定頁在用）
    '66_keys.js': [('function keyExport', None)],                              # 鍵位頁（鍵位資料在前面、留核心）
    '67_furncfg.js': [('function furnExport', None)],                          # 道具頁
    '68_guncfg.js': [('function gunsExport', None)],                           # 砲的設定頁
    '69_prefs.js': [('/** 出廠預設值（設定後台跳轉開的', 'function prefNum')],  # 出廠預設值後台頁 admDefUI
    '71_input.js': [('var DISCORD_URL', "$('muteT').onclick"),                 # 主選單的 Discord
                    ('/** 主選單的玩法鈕', '/** 旗號面板（TASK-0679'),           # 主選單、sliders()（細節、船隻配置、天氣…）、畫質頁、物理頁、編成、指揮官、搶上風
                    ('/** 細節設定：候補補位', "$('endC').onclick"),            # 候補、距離、開戰鈕
                    ('var COVER_LATE', '// 訂閱（TASK-0669')],                  # 回到主選單 coverShow
}


def shell_ranges(root, files):
    """SHELL_UI ⇒ { 檔名: [(第一行, 最後一行), …] }（1 起算、含兩端）。"""
    out = {}
    for f in files:
        k = os.path.basename(f)
        if k not in SHELL_UI:
            continue
        L = open(os.path.join(root, f), encoding='utf-8').read().rstrip('\n').split('\n')
        if SHELL_UI[k] is None:
            out[k] = [(1, len(L))]
            continue

        def at(s):
            hit = [i + 1 for i, t in enumerate(L) if s in t]
            if len(hit) != 1:
                raise Fail('SHELL_UI：%s 裡「%s」%s ⇒ 改 admin.py 的 SHELL_UI' % (k, s, '找不到' if not hit else '有 %d 行（%s）' % (len(hit), ','.join(map(str, hit)))))
            return hit[0]
        out[k] = [(at(a), at(z) - 1 if z else len(L)) for a, z in SHELL_UI[k]]
    return out


def cover_ids(html):
    """template.html 裡 <div id="cover"> 那一整塊（含它自己）的每個 id。"""
    i = html.index('<div id="cover">')
    depth, ids = 0, []
    for m in re.finditer(r'<(/?)(\w+)\b[^>]*>', html[i:]):         # 每個標籤（id 照收）；div 照開關數層數，數回 0 ＝ #cover 關了
        ids += re.findall(r'\bid="([^"]+)"', m.group(0))
        if m.group(2) == 'div':
            depth += -1 if m.group(1) else 1
            if not depth:
                break
    return set(ids)


DOM_RX = re.compile(r"""\$\('([\w-]+)'\)|getElementById\('([\w-]+)'\)|querySelector(?:All)?\('([^']+)'\)""")


def act_shell_layers(src=None):
    """核心直接叫外殼的名字、核心直接碰 #cover 裡的 DOM（照 SHELL_UI 分）⇒ 每一個：定義／元素、誰用在哪幾行。src ＝ 另一份 src 目錄（量別的版本）。"""
    node = shutil.which('node')
    if not node:
        raise Fail('找不到 node（src/js_refs.cjs、js_globals.cjs 要它）')
    root = os.path.abspath(src) if src else HERE
    tpl = open(os.path.join(root, 'template.html'), encoding='utf-8').read()
    files = re.findall(r'<script\s+src="(js/[^"]+)"\s+data-bundle="game"', tpl)
    paths = [os.path.join(root, f) for f in files]
    got = []
    for tool in ('js_refs.cjs', 'js_globals.cjs'):
        r = subprocess.run([node, '--expose-internals', os.path.join(HERE, tool)] + paths, capture_output=True, text=True, encoding='utf-8', cwd=root)
        try:
            got.append(json.loads(r.stdout.strip().splitlines()[-1]))
        except Exception:
            raise Fail('%s 讀不到結果：%s' % (tool, (r.stdout + r.stderr).strip()[-300:]))
    d, g = got
    b = os.path.basename
    R = shell_ranges(root, files)
    shell = lambda f, line: any(a <= line <= z for a, z in R.get(b(f), ()))
    defl = {(b(f), nm): line for f, L in g.items() if isinstance(L, list) for nm, line in L}
    names = {}
    for f, nm, line, how in d['refs']:
        df = d['defs'].get(nm)
        if df and shell(df, defl.get((b(df), nm), 0)) and not shell(f, line):
            names.setdefault((b(df), nm, defl.get((b(df), nm))), {}).setdefault(b(f)[:-3], set()).add(line)
    ids, dom = cover_ids(tpl), {}
    for f in files:
        for n, t in enumerate(open(os.path.join(root, f), encoding='utf-8'), 1):
            if shell(f, n):
                continue
            for m in DOM_RX.finditer(t):
                for k in ([m.group(1) or m.group(2)] if not m.group(3) else re.findall(r'#([\w-]+)', m.group(3))):
                    if k in ids:
                        dom.setdefault((b(f), k), []).append(n)
    log = ['外殼（SHELL_UI；%s）：%s' % (src or 'src', '、'.join('%s %s' % (k, '整支' if SHELL_UI[k] is None else ','.join('%d–%d' % ab for ab in v)) for k, v in sorted(R.items()))),
           '核心直接叫外殼的名字（定義 ⇐ 核心的檔:行）：']
    for (df, nm, dl), U in sorted(names.items()):
        log.append('  %-15s %-16s @%-5s ⇐ %s' % (df, nm, dl, '  '.join('%s:%s' % (u, ','.join(map(str, sorted(L)))) for u, L in sorted(U.items()))))
    log.append('核心直接碰 #cover 裡的 DOM（#cover 共 %d 個 id；檔 元素 ⇐ 行）：' % len(ids))
    for (f, k), L in sorted(dom.items()):
        log.append('  %-15s #%-12s ⇐ %s' % (f, k, ','.join(map(str, L))))
    nn = sum(len(L) for U in names.values() for L in U.values())
    return log + ['核心 → 外殼：名字 %d 個、引用 %d 次；碰 #cover 的 DOM：%d 處（%d 個 id、%d 支檔）—— 拆完兩個都是 0' %
                  (len(names), nn, sum(len(L) for L in dom.values()), len({k for f, k in dom}), len({f for f, k in dom}))]


# ───────────────────────── 成品記住來源（TASK-0674） ─────────────────────────
# 10-16 出過事：共用工作區建成品時包進別人改到一半的 js ⇒ 成品跟任何一版提交的來源都對不上，可是看不出來。
# ⇒ 成品裡放一份來源清單（<script type="application/json" id="blockside-src">）：template.html 與它引用的每一支檔各記一個指紋；
#   .vxk 不入版控 ⇒ 改記 config/vxk_lock.json 裡那艘的指紋（_cache 跟指紋不同時 cache_guard 已經擋了）；文字檔照 LF 算 ⇒ 跟 checkout 的換行無關。
# srccheck 照同一套從工作區／暫存區（--staged）／某一版（--rev）重算、跟那一份成品比 ⇒ 對不上就列出哪幾支檔不同。
# 只管「成品是不是照這些來源建的」：建置程式（admin.py、vxk_inline.py）不算來源 —— 它們改了、成品沒重建，成品仍是照這些來源建的（只是舊做法）。
SRC_EL = 'blockside-src'
SRC_RE = re.compile(r'<script type="application/json" id="%s">([^<]*)</script>' % SRC_EL)
SRC_TEXT = ('.js', '.cjs', '.json', '.html', '.css', '.glsl', '.md', '.txt')
SRC_LOCK = 'src/config/vxk_lock.json'
ROOT = os.path.normpath(os.path.join(HERE, '..'))


def src_manifest(read):
    """來源清單 {'fp': 總指紋, 'files': {根目錄的相對路徑: 指紋前 12 碼}}。read(相對路徑) ⇒ bytes；不存在 ⇒ None。"""
    tpl = read('src/template.html')
    if tpl is None:
        raise Fail('讀不到 src/template.html')
    lock = json.loads((read(SRC_LOCK) or b'{}').decode('utf-8'))
    files = {}

    def put(p, b):
        if b is None:
            files[p] = '（不存在）'
            return
        if p.endswith(SRC_TEXT):
            b = b.replace(b'\r\n', b'\n')
        files[p] = sha1_bytes(b)[:12]
    put('src/template.html', tpl)
    for rel in re.findall(r'<script\b[^>]*\ssrc="([^"]+)"', tpl.decode('utf-8')):
        p = posixpath.normpath(posixpath.join('src', rel))
        if p in files:
            continue
        if p.endswith('.vxk'):
            files[p] = 'lock ' + (lock.get(posixpath.basename(p)) or '（沒有指紋）')[:14]
        else:
            put(p, read(p))
    fp = sha1_bytes('\n'.join('%s %s' % (k, files[k]) for k in sorted(files)).encode('utf-8'))[:16]
    return {'fp': fp, 'files': files}


def work_read(p):
    f = os.path.join(ROOT, *p.split('/'))
    return open(f, 'rb').read() if os.path.isfile(f) else None


class GitRead:
    """git cat-file --batch 讀某一版（pre ＝ '<rev>:'）或暫存區（pre ＝ ':'）的檔；不存在 ⇒ None。"""
    def __init__(self, pre):
        self.pre = pre
        self.p = subprocess.Popen(['git', 'cat-file', '--batch'], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def __call__(self, path):
        self.p.stdin.write((self.pre + path + '\n').encode('utf-8'))
        self.p.stdin.flush()
        head = self.p.stdout.readline().decode('utf-8', 'replace').split()
        if len(head) != 3 or head[1] != 'blob':
            return None
        b = self.p.stdout.read(int(head[2]))
        self.p.stdout.read(1)
        return b

    def close(self):
        self.p.stdin.close()
        self.p.wait()


def src_of(html):
    """成品裡的來源清單；舊版建的（沒有）⇒ None。"""
    m = SRC_RE.search(html)
    return json.loads(m.group(1)) if m else None


def src_stamp_html(html, M):
    """來源清單 M 接在成品的 <meta charset> 同一行後面（舊的先拿掉；不多一行 ⇒ 錯誤訊息的行號照舊；charset 仍在前 1024 位元組）。"""
    html = SRC_RE.sub('', html)
    at = html.index('<meta charset="utf-8">') + len('<meta charset="utf-8">')
    tag = '<script type="application/json" id="%s">%s</script>' % (SRC_EL, json.dumps(M, ensure_ascii=False, sort_keys=True, separators=(',', ':')))
    return html[:at] + tag + html[at:]


def src_stamp():
    """建置最後一步：照工作區算來源清單、記進成品（src_stamp_html）。"""
    M = src_manifest(work_read)
    html = src_stamp_html(open(OUT, encoding='utf-8').read(), M)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)
    return ['✓ 成品記下來源：指紋 %s（%d 支檔；python -I src/admin.py srccheck 對得回來）' % (M['fp'], len(M['files']))]


def src_diff(have, want):
    """兩份來源清單差在哪幾支檔。"""
    a, b = (have or {}).get('files', {}), want['files']
    return ['%s：成品 %s ／ 來源 %s' % (k, a.get(k, '（沒有）'), b.get(k, '（沒有）')) for k in sorted(set(a) | set(b)) if a.get(k) != b.get(k)]


def src_check_one(read, what):
    """read 讀得到的那一份成品跟同一份來源比。回傳 (對不對得上, 讀數)。"""
    prod = read('index.html')
    have = src_of(prod.decode('utf-8')) if prod is not None else None
    want = src_manifest(read)
    if have is None:
        return False, ['✗ %s：成品沒有來源清單（舊版 admin.py 建的，或沒有成品）⇒ python -I src/admin.py build' % what]
    if have.get('fp') != want['fp']:
        return False, ['✗ %s：成品跟來源對不上（成品 %s ／ 來源 %s）⇒ python -I src/admin.py build 重建再提交：' % (what, have.get('fp'), want['fp'])] + \
            ['    ' + x for x in src_diff(have, want)]
    html, bad = prod.decode('utf-8'), []                        # 拆檔的成品：清單上的船檔都要在、內容要跟檔名的雜湊對得上
    idx = ships_index(html)
    for el in idx:
        try:
            ship_data(html, el, read)
        except Fail as e:
            bad.append(str(e))
    if bad:
        return False, ['✗ %s：成品的船檔對不上 ⇒ python -I src/admin.py build、ships/ 跟 index.html 一起提交（git add -A ships index.html）：' % what] + ['    ' + x for x in bad]
    return True, ['✓ %s：成品照這份來源建的（指紋 %s、%d 支檔%s）' % (what, want['fp'], len(want['files']), '；船檔 %d 個都在、雜湊對得上' % len(idx) if idx else '')]


def act_snapshot(rev, to):
    """某一版的成品 ⇒ 資料夾：index.html ＋ 它清單上的船檔（拆檔之前的版本只有 index.html）。"""
    r = GitRead(rev + ':')
    try:
        prod = r('index.html')
        if prod is None:
            raise Fail('%s 沒有 index.html' % rev)
        idx = ships_index(prod.decode('utf-8'))
        got = {}
        for el, h in idx.items():
            b = r(ship_file(el))
            if b is None:
                raise Fail('%s 的清單上有 %s，那一版沒有這個檔' % (rev, ship_file(el)))
            got[ship_file(el)] = b
    finally:
        r.close()
    os.makedirs(to, exist_ok=True)
    open(os.path.join(to, 'index.html'), 'wb').write(prod)
    for rel, b in got.items():
        os.makedirs(os.path.join(to, 'ships'), exist_ok=True)
        open(os.path.join(to, *rel.split('/')), 'wb').write(b)
    return ['✓ %s 的成品 ⇒ %s（index.html%s）' % (rev, to, '＋船檔 %d 個' % len(got) if got else '，一個檔')]


def act_srccheck(staged=False, rev=None, hook=None):
    """TASK-0674：成品跟來源對不對得上。
    沒給 ⇒ 工作區；--staged ⇒ 暫存區（提交前）；--rev ⇒ 那一版。
    --hook pre-commit：提交裡有成品 ⇒ 任何分支都要對得上；只動來源 ⇒ dev、main 上要對得上，其他分支照慣例可以（合進 dev 前照合併後的來源重建）。
    --hook pre-push：推到 dev、main 的那一版要對得上（fast-forward 合併不經過 pre-commit，擋在這裡）。"""
    if hook == 'pre-push':
        log, ok = [], True
        for line in sys.stdin.read().splitlines():
            f = line.split()
            if len(f) != 4 or f[2] not in ('refs/heads/dev', 'refs/heads/main') or set(f[1]) == {'0'}:
                continue
            r = GitRead(f[1] + ':')
            try:
                good, out = src_check_one(r, '推到 %s 的 %s' % (f[2][11:], f[1][:7]))
            finally:
                r.close()
            ok, log = ok and good, log + out
        if not ok:
            raise Fail('\n'.join(log + ['（推送擋下了；成品重建、提交之後再推）']))
        return log or ['（這次沒有推到 dev、main，不檢查成品）']
    if rev or staged:
        r = GitRead((rev + ':') if rev else ':')
        try:
            if hook == 'pre-commit':
                return src_hook_commit(r)
            good, out = src_check_one(r, '%s' % (rev or '暫存區'))
        finally:
            r.close()
    else:
        good, out = src_check_one(work_read, '工作區')
    if not good:
        raise Fail('\n'.join(out))
    return out


def act_hooks():
    """裝鉤子：core.hooksPath ＝ .githooks（相對路徑 ⇒ 每個 worktree 用自己 checkout 出來的那兩支；還沒有 .githooks 的舊分支 ⇒ git 找不到鉤子、照常提交）。
    已經設成別的 ⇒ 不蓋掉；.git/hooks 裡原本有的鉤子（不是 .sample）會失效 ⇒ 有的話先擋下、列出來。"""
    code, cur = run(['git', 'config', '--get', 'core.hooksPath'], cwd=ROOT)
    cur = cur.strip()
    if cur == '.githooks':
        return ['✓ 已經裝了（core.hooksPath ＝ .githooks）']
    if cur:
        raise Fail('core.hooksPath 已經是 %s ⇒ 不蓋掉（要換自己改）' % cur)
    code, common = run(['git', 'rev-parse', '--git-common-dir'], cwd=ROOT)
    hd = os.path.join(ROOT, common.strip(), 'hooks')
    old = [f for f in (os.listdir(hd) if os.path.isdir(hd) else []) if not f.endswith('.sample')]
    if old:
        raise Fail('%s 裡已經有鉤子（%s）⇒ 改 core.hooksPath 會讓它們失效，不裝' % (hd, '、'.join(old)))
    code, out = run(['git', 'config', 'core.hooksPath', '.githooks'], cwd=ROOT)
    if code != 0:
        raise Fail('git config 失敗：' + out.strip())
    return ['✓ 裝好了：core.hooksPath ＝ .githooks（提交前 pre-commit、推送前 pre-push 都會跑 srccheck）']


def src_hook_commit(r):
    code, names = run(['git', 'diff', '--cached', '--name-only'], cwd=ROOT)
    names = set(names.split())
    want = src_manifest(r)
    srcs = names & (set(want['files']) | {SRC_LOCK})
    prod = 'index.html' in names or any(n.startswith('ships/') for n in names)
    if not prod and not srcs:
        return []
    code, br = run(['git', 'symbolic-ref', '--short', '-q', 'HEAD'], cwd=ROOT)
    br = br.strip()
    if not prod and br not in ('dev', 'main'):
        return ['· 成品檢查：這次只動了來源（%d 支）、成品沒重建 —— 分支 %s 上可以；合進 dev 之前要照合併後的來源重建' % (len(srcs), br or '（沒有）')]
    good, out = src_check_one(r, '這次提交（分支 %s）' % (br or '（沒有）'))
    if not good:
        raise Fail('\n'.join(out + ['（提交擋下了）']))
    return out


def act_build(pack=True, single=False):   # pack：壓縮版（預設，TASK-0583）；False ＝ 原格式（build --raw）；single：壓縮版但不拆檔（build --single）
    cfg = load()
    E = validate(cfg)
    if E:
        raise Fail('設定不合法，不建置：\n' + '\n'.join('  ✗ ' + e for e in E))
    log = cache_guard() + ['template.html 的船標籤' + ('照設定改寫了' if sync_template(cfg) else '跟設定一致')]
    miss = [s['vxk'] for s in cfg['ships'] if not os.path.exists(os.path.join(CACHE, s['vxk']))]
    if miss:
        raise Fail('VoxelKit/_cache/ 少了 %s ⇒ 先 python -I admin.py cache（從成品解回）或 reimport' % '、'.join(miss))
    log += bundle_names_check()
    log += owner_check()
    code, out = run([sys.executable, '-I', INLINE, TPL, OUT])
    log.append(out.strip())
    if code != 0:
        raise Fail('\n'.join(log) + '\n✗ 建置失敗（exit %d）' % code)
    if pack:
        log += pack_html(OUT, not single)
        log += js_strip_html(OUT)
    else:
        ships_sync(os.path.dirname(OUT), {})                 # 原格式（船內嵌）⇒ ships/ 裡的船檔都是舊的
    return log + src_stamp()


# ───────────────────────── 外掛外殼（shell：別的遊戲拿這份成品套自己的外殼；2026-10-21） ─────────────────────────
# 核心只有一份（ROADMAP：Blockside 是核心，別的遊戲把它當 submodule 引用）⇒ 不重走建置：拿建好的拆檔成品（入口；船檔 ships/ 共用、不複製）套外殼寫成另一頁。
# 外殼設定（JSON，路徑都相對於這個檔）：
#   out    寫到哪（必填）            core   哪一份成品（不給 ⇒ 這個 repo 的 index.html）
#   title  <title> 與主畫面的名字      ships  船檔的網址前綴（out 那一頁看到的 Blockside 根目錄，例 "external/Blockside/"；船檔 ＝ 前綴 + ships/<標籤>.js）
#   icon   主畫面圖示的網址（不給 ⇒ 前綴 + Blockside 的）  js、css  外殼的檔（清單；照順序）
# 怎麼套（⛔ 核心的行號一行都不動：錯誤回報、srccheck 照成品的行號）：
#   · <title>、主畫面名字換掉；Blockside 的 manifest 拿掉（換成空字串，行還在）；圖示換網址。
#   · </head> 前面同一行加 <script id="bs-shell">window.BS_SHELL={ships, name, stamp}</script> —— 核心開機就要（voxelkit.js 載船檔照 ships）⇒ 放在核心前面、一行。
#   · 外殼的 css、js 接在 </body> 前面（核心後面 ⇒ 前面的行號不變；掛鉤是用到的那一刻才讀 window.BS_SHELL，見 js/71_input.js shellCall）。
#   · stamp ＝ { core: 成品的來源指紋, shell: 外殼設定與 js、css 的 sha1 前 12 碼 } ⇒ --check 照同一條路重做一次、跟 out 比（核心換了、外殼改了 ⇒ 舊了）。
SHELL_ID = 'bs-shell'


def shell_html(path):
    """外殼設定 path ⇒ (那一頁的全文, out 的路徑, stamp)。"""
    p = os.path.abspath(path)
    d = os.path.dirname(p)
    raw = open(p, 'rb').read()
    try:
        S = json.loads(raw.decode('utf-8'))
    except ValueError as e:
        raise Fail('外殼設定不是 JSON：%s（%s）' % (path, e))
    if not isinstance(S, dict) or not isinstance(S.get('out'), str) or not S['out']:
        raise Fail('外殼設定要有 out（寫到哪）：%s' % path)
    at = lambda q: os.path.normpath(os.path.join(d, q))
    core = at(S['core']) if S.get('core') else OUT
    html = open(core, encoding='utf-8', newline='').read()
    have = src_of(html)
    if not have or not SHIPS_TAG_RX.search(html):
        raise Fail('%s 不是拆檔的成品（沒有來源清單或船清單）⇒ 先 python -I src/admin.py build' % core)
    h = hashlib.sha1(raw)
    parts = []
    for kind in ('css', 'js'):
        for q in S.get(kind) or []:
            b = open(at(q), 'rb').read()
            h.update(b'\0' + q.encode('utf-8') + b'\0' + b)
            t = b.decode('utf-8').replace('</', '<\\/')            # 外殼的內容不能提早關掉標籤
            parts.append(('<style data-shell="%s">%s</style>' if kind == 'css' else '<script data-shell="%s">%s</script>') % (q, t))
    pre, ships = S.get('ships') or '', S.get('ships') or ''
    stamp = {'core': have['fp'], 'shell': h.hexdigest()[:12]}
    cfg = {'ships': ships, 'name': S.get('title') or '', 'stamp': stamp}
    esc = lambda v: v.replace('&', '&amp;').replace('<', '&lt;').replace('"', '&quot;')
    if S.get('title'):
        html = re.sub(r'<title>[^<]*</title>', lambda m: '<title>%s</title>' % esc(S['title']), html, count=1)
        html = re.sub(r'(<meta name="apple-mobile-web-app-title" content=")[^"]*(")', lambda m: m.group(1) + esc(S['title']) + m.group(2), html, count=1)
    html = html.replace('<link rel="manifest" href="manifest.webmanifest">', '', 1)
    html = html.replace('href="icons/apple-touch-icon.png"', 'href="%s"' % esc(S.get('icon') or pre + 'icons/apple-touch-icon.png'), 1)
    i = html.index('</head>')
    html = html[:i] + '<script id="%s">window.BS_SHELL=%s;</script>' % (SHELL_ID, json.dumps(cfg, ensure_ascii=False, sort_keys=True).replace('</', '<\\/')) + html[i:]
    j = html.rindex('</body>')
    html = html[:j] + ''.join(parts) + html[j:]
    return html, at(S['out']), stamp


def act_shell(path, check=False):
    """shell：套外殼寫成另一頁；check ⇒ 只比（舊了 ⇒ Fail，寫出來的不動）。"""
    html, out, stamp = shell_html(path)
    cur = open(out, encoding='utf-8', newline='').read() if os.path.isfile(out) else None
    if check:
        if cur != html:
            raise Fail('%s 舊了（核心 %s、外殼 %s）⇒ python -I <Blockside>/src/admin.py shell %s' % (out, stamp['core'], stamp['shell'], path))
        return ['✓ %s 是最新的（核心 %s、外殼 %s）' % (out, stamp['core'], stamp['shell'])]
    if cur == html:
        return ['· %s 本來就是最新的（核心 %s、外殼 %s）' % (out, stamp['core'], stamp['shell'])]
    with open(out, 'w', encoding='utf-8', newline='') as f:
        f.write(html)
    return ['✓ 寫了 %s（%.2f MB；核心 %s、外殼 %s）' % (out, len(html.encode('utf-8')) / 1048576, stamp['core'], stamp['shell'])]


# ───────────────────────── 只重建程式（build --code：沒有 VoxelKit/_cache 的機器；2026-10-20） ─────────────────────────
# 拆檔之後船檔 ships/ 只跟船有關：程式、版面、設定、素材改了，船檔一個位元組都不用變 ⇒ 沒有 _cache（cache_guard 擋下、整份建置跑不了）的機器
#   也照正式建置的同一條路重建入口：vxk_inline.py 內嵌 ⇒ js_strip_html 去註解（語法樹驗算）⇒ 記來源指紋；
#   只差在船標籤先換掉 —— 第一艘換成成品裡現在那份船清單、其他拿掉（換行留著），跟 pack_html 拆檔寫出來的一樣（清單在第一艘前面、船標籤拿掉）。
# 兩道關，過不了就擋（成品不動）：
#   ① 船沒變：template 的船標籤跟設定一致；船隻清單（代號、標籤、.vxk、改裝船的原船）跟成品是照它建的那一版一樣、順序跟成品的船清單一樣；
#      每艘 .vxk 的指紋跟成品記的一樣；清單上的船檔都在、雜湊對得上 ⇒ 船檔照舊就是對的。
#   ② 這個做法 ＝ 正式建置：成品是照它建的那一版（成品記的來源指紋 ＝ 那一版的來源；預設試 HEAD、合併中再試 MERGE_HEAD，或 --base 指定）的來源
#      照同一條路重做一次，要跟現在的成品逐位元組相同 —— 建置程式（vxk_inline.py、去註解、拆檔）改過、或成品不是這樣建的 ⇒ 對不上 ⇒ 要在有 _cache 的機器整份建置。
#   都過了才照工作區的來源寫 index.html（跟現在一樣 ⇒ 不寫），最後 srccheck。
CODE_VXK_RX = re.compile(r'<script\s+type="application/x-vxk"\s+id="([^"]+)"\s+src="([^"]+)"\s*>\s*</script>')   # 同 vxk_inline.py 的 VXK_RE


def code_html(read, ships_tag, log=None):
    """read（根目錄的相對路徑 ⇒ bytes｜None）讀得到的那一份來源，走正式建置同一條路、船標籤換成 ships_tag ⇒ (入口全文：去好註解、記好來源指紋, 來源清單)。"""
    import tempfile
    M = src_manifest(read)
    with tempfile.TemporaryDirectory() as td:
        for p, fp in M['files'].items():                     # template 與它引用的每一支檔照原位元組放進暫存資料夾（.vxk 不要；不存在的 optional 素材 vxk_inline 自己處理）
            if fp.startswith('lock ') or fp == '（不存在）':
                continue
            f = os.path.join(td, *p.split('/'))
            os.makedirs(os.path.dirname(f), exist_ok=True)
            with open(f, 'wb') as fh:
                fh.write(read(p))
        n = [0]

        def tag(mt):
            n[0] += 1
            return ships_tag if n[0] == 1 else ''
        tpl = CODE_VXK_RX.sub(tag, read('src/template.html').decode('utf-8'))
        tf, of = os.path.join(td, 'src', 'template.html'), os.path.join(td, 'index.html')
        with open(tf, 'w', encoding='utf-8', newline='') as fh:
            fh.write(tpl)
        code, out = run([sys.executable, '-I', INLINE, tf, of])
        if code != 0:
            raise Fail(out.strip() + '\n✗ 內嵌失敗（exit %d）' % code)
        L = js_strip_html(of)
        if log is not None:
            log += L
        html = open(of, encoding='utf-8', newline='').read()
    return src_stamp_html(html, M), M


def code_base(fp, base=None):
    """成品是照哪一版建的：來源指紋 ＝ fp 的那一版（--base 給的；不給 ⇒ HEAD，合併中再試 MERGE_HEAD）；都不是 ⇒ None。"""
    revs = [base] if base else ['HEAD'] + (['MERGE_HEAD'] if run(['git', 'rev-parse', '-q', '--verify', 'MERGE_HEAD'], cwd=ROOT)[0] == 0 else [])
    for rev in revs:
        r = GitRead(rev + ':')
        try:
            if src_manifest(r)['fp'] == fp:
                return rev
        except Fail:
            pass
        finally:
            r.close()
    return None


def act_build_code(base=None):
    """build --code：只重建程式（入口 index.html；船檔 ships/ 照舊）—— 沒有 VoxelKit/_cache 的機器用；兩道關見上面。"""
    cfg = load()
    E = validate(cfg)
    if E:
        raise Fail('設定不合法，不建置：\n' + '\n'.join('  ✗ ' + e for e in E))
    full = ' ⇒ 要整份建置：在有 VoxelKit/_cache 的機器 python -I src/admin.py build'
    t = open(TPL, encoding='utf-8').read()
    a, b = t.find(SHIPS_A), t.find(SHIPS_B)
    if a < 0 or b < a or t[a + len(SHIPS_A):b] != ship_tags(cfg):
        raise Fail('template.html 的船標籤跟 config/game.json 的船隻清單不一致' + full)
    html0 = open(OUT, encoding='utf-8', newline='').read()
    m, idx, have = SHIPS_TAG_RX.search(html0), ships_index(html0), src_of(html0)
    if not m or not idx:
        raise Fail('成品不是拆檔的（沒有船清單 #%s）⇒ --code 只換得了拆檔成品的入口' % SHIPS_EL)
    if not have:
        raise Fail('成品沒有來源清單 ⇒ 不知道它是照哪一版建的' + full)
    els = [s['el'] for s in cfg['ships']]
    if els != list(idx):
        raise Fail('船隻清單（%s）跟成品的船清單（%s）不一樣%s' % ('、'.join(els), '、'.join(idx), full))
    for el in idx:
        ship_data(html0, el)                                    # 船檔都在、內容跟雜湊對得上（不然 Fail）
    want = src_manifest(work_read)
    vx = lambda F: {k: v for k, v in F.items() if k.endswith('.vxk')}
    bad = sorted(k for k in set(vx(have['files'])) | set(vx(want['files'])) if have['files'].get(k) != want['files'].get(k))
    if bad:
        raise Fail('.vxk 的指紋跟成品記的不一樣（%s）%s' % ('、'.join(posixpath.basename(k) for k in bad), full))
    rev = code_base(have['fp'], base)
    if not rev:
        raise Fail('成品的來源指紋 %s 對不到 %s 的來源 ⇒ 用 --base <版> 指定成品是照哪一版建的' % (have['fp'], base or 'HEAD／MERGE_HEAD'))
    ships_tag = m.group(0) + '\n'

    def sig(c):
        byid = {s['id']: s['el'] for s in c['ships']}
        return [(s['id'], s['el'], s['vxk'], byid.get(s.get('variant_of'))) for s in c['ships']]
    r = GitRead(rev + ':')
    try:
        if sig(json.loads(r('src/config/game.json').decode('utf-8'))) != sig(cfg):
            raise Fail('船隻清單（代號、標籤、.vxk、改裝船的原船）跟 %s 不一樣%s' % (rev, full))
        h0, _ = code_html(r, ships_tag)
    finally:
        r.close()
    if h0 != html0:
        i = next((k for k in range(min(len(h0), len(html0))) if h0[k] != html0[k]), min(len(h0), len(html0)))
        raise Fail('照 %s 的來源走同一條路重做，跟現在的成品不一樣（第 %d 行起）⇒ 建置程式改過、或成品不是這樣建的%s' % (rev, html0.count('\n', 0, i) + 1, full))
    log = bundle_names_check() + owner_check()
    log.append('✓ 船沒變：%d 艘的標籤、.vxk 指紋、改裝船的原船都跟 %s 一樣，船檔都在、雜湊對得上' % (len(idx), rev))
    log.append('✓ 照 %s 的來源走同一條路重做 ⇒ 跟現在的成品逐位元組相同（這個做法 ＝ 正式建置）' % rev)
    h1, M1 = code_html(work_read, ships_tag, log)
    if h1 == html0:
        log.append('· 工作區的來源跟 %s 一樣 ⇒ 成品不用換' % rev)
    else:
        with open(OUT, 'w', encoding='utf-8', newline='') as f:
            f.write(h1)
        log.append('✓ 只重建程式：入口 index.html 換了（來源指紋 %s → %s）；船檔 ships/ 照舊 %d 個' % (have['fp'], M1['fp'], len(idx)))
    return log + act_srccheck()


# ───────────────────────── 船檔重切（reseg：船檔分段的切法改了、這台沒有 _cache；2026-10-20） ─────────────────────────
# 船檔裡就是建置時的原文（檔頭 JSON ＋ 格子），切法（ship_segments）只決定怎麼切 ⇒ 不用 _cache 也重切得了：
#   照入口清單讀每艘船檔（雜湊對得上才讀）⇒ 解回原文 ⇒ 檔頭 JSON 讀進來再寫回去要逐位元組相同（不然不保證切得跟建置一樣）⇒ ship_pieces 重切
#   ⇒ 新的一份解回來要跟原文逐位元組相同 ⇒ 才寫船檔、換入口清單上的雜湊（入口別的地方一個字都不動）；最後 srccheck。
# 重切的 ＝ 有 _cache 的機器整份建置會寫的：同一份檔頭與格子、同一支 ship_pieces（zlib 同一版 ⇒ 逐位元組相同）。
# 只換切法：解回來的原文不變 ⇒ 遊戲、build --code、srccheck 照舊；船的內容要變（匯入、metasync…）還是要整份建置。

def act_reseg():
    """reseg：船檔照現在的切法重切（見上面）。"""
    html = open(OUT, encoding='utf-8', newline='').read()
    m, idx = SHIPS_TAG_RX.search(html), ships_index(html)
    if not m or not idx:
        raise Fail('成品不是拆檔的（沒有船清單 #%s）⇒ 沒有船檔可以重切' % SHIPS_EL)
    files, new, log, n0, n1 = {}, {}, [], 0, 0
    for el, hx in idx.items():
        f = ship_file(el)
        raw = zlib.decompress(ship_data(html, el), -15)
        n = struct.unpack('<I', raw[4:8])[0] if raw[:4] == b'VXK1' and len(raw) >= 8 else -1
        if n < 0 or len(raw) < 8 + n:
            raise Fail('%s 解開不是 VXK1（或檔頭長度對不上）' % f)
        hb = raw[8:8 + n]
        h = json.loads(hb.decode('utf-8'))
        if _jb(h) != hb:
            raise Fail('%s 的檔頭 JSON 讀進來再寫回去跟原本不一樣 ⇒ 不保證切得跟建置一樣，不重切' % f)
        P = ship_pieces(h, raw[8 + n:])
        if zlib.decompress(b''.join(base64.b64decode(p) for p in P), -15) != raw:
            raise Fail('%s 重切後解回來跟原本不一樣（什麼都沒寫）' % f)
        new[el] = ship_hash(P)
        old = work_read(f)
        t = ship_text(el, P, new[el])
        n0, n1 = n0 + len(old), n1 + len(t)
        if new[el] != hx:
            files[f] = t
        log.append('  %s：%d → %d 段、%d → %d KB%s' % (el, old.count(b'\n') - 2, len(P), len(old) // 1024, len(t) // 1024, '' if new[el] != hx else '（本來就是這樣切，不動）'))
    if not files:
        return log + ['· %d 艘的船檔本來就是現在的切法 ⇒ 什麼都沒寫' % len(idx)]
    for f, t in files.items():
        with open(os.path.join(ROOT, *f.split('/')), 'w', encoding='utf-8', newline='\n') as fh:
            fh.write(t)
    with open(OUT, 'w', encoding='utf-8', newline='') as fh:
        fh.write(html[:m.start(1)] + json.dumps(new, separators=(',', ':')) + html[m.end(1):])
    log.append('✓ 重切 %d 艘（解回來跟原本逐位元組相同）：船檔合計 %.2f → %.2f MB；入口只換了船清單上的雜湊' % (len(files), n0 / 1048576, n1 / 1048576))
    return log + act_srccheck()

# ───────────────────────── 壓縮版成品（預設；build --raw ＝ 原格式。Tim 2026-10-14，TASK-0583：雕刻作品與匯出的 .vxk 格式不變，匯進遊戲才壓縮） ─────────────────────────
# 量過（六艘、壓縮後）：格子合計約 0.87 MB，模型網格（砲、燈、舵輪…的三角形，header 的 rig.meshes）約 3.50 MB ⇒ 大頭是網格：
#   ① 同一份網格（同一門砲的模型）在幾艘船上各存一份 —— 161 種裡 55 種出現在兩艘以上 ⇒ 成品裡收成一個池子（<script id="vxk-meshes">），每艘只記編號；
#   ② 頂點逐角存（三角形的每一角一個頂點）⇒ 同一點只存一次、照順序存差值（整數 ×100：座標全是 0.01 的倍數，量過誤差 ≤ 4e-12）、三角形的索引也存差值。
#   兩招一起：網格 3.50 → 0.85 MB。格子、繩、帆照原樣。
# 只動成品裡內嵌的那一份：_cache 的 .vxk、指紋（vxk_lock.json）不動；遊戲讀的時候還原（05_hull.js meshPool），三角形一個一個比過、對不上的那一份照原樣留在船裡。
# ⛔ 壓縮過的成品解不回原檔（cache 會擋）：_cache 掉了要 reimport。
#
# 拆檔（Tim 2026-10-20：「如果變成拆檔案呢(index.html變成入口)」；repo 變肥的分析見 src/REPO_SIZE.md）：
#   以前全部船共用一個池子（#vxk-meshes），照第一次出現的順序編號 ⇒ 加一個網格，池子整份重存、後面每艘船檔頭的編號跟著位移、整艘重存
#   （dev 主線 287 版：池子 46.7 MiB、沒換的船被連累 47.0 MiB，比真的換船的 37.2 MiB 還多）。
#   現在每艘船帶自己的池子（header.mpool ＝ {q, meshes}，編號只在這艘船裡）⇒ 一艘船的資料只跟它自己有關；
#   成品預設拆檔：入口 index.html 只留程式和一張清單 <script type="application/json" id="vxk-ships">{ 標籤: 雜湊 }</script>，
#   每艘一個檔 ships/<標籤>.js（內容 VoxelKit.ship("<標籤>",[段…],"<雜湊>")，見下面「船檔分段」）；遊戲要用才用 <script> 載（voxelkit.js embeddedBytes），網址帶 ?v=<雜湊> 擋舊快取。
#   雜湊 ＝ 內容的 sha1 前 10 碼，入口清單一份、船檔裡一份：載進來對不上 ⇒ 明說「不是同一次建置的」（舊的入口配上新的 ships/），不會悄悄混用。
#   ⛔ 檔名不帶雜湊：git 打包時照路徑最後十幾個字元把同一個檔的各版排在一起找差異 ⇒ 檔名每版都換，同一艘船的新舊版排不到一起、分段省下來的又吃回去。
#   build --single ＝ 照舊一個檔（船內嵌；封存、要單一檔案的地方用），--raw ＝ 原格式。
#   船檔分段（同一天量的：dev 主線 287 版、291 次船檔重存裡 206 次只有檔頭變了 —— meta、繩端綁定、id；格子很少動）：
#     一艘壓成一整條 ⇒ 改一欄也整艘重存（同一段歷史 107.9 MiB）；照結構切段、各自 base64 一行 ⇒ git 只存變了的那幾段（17.5 MiB）。
#     壓法：同一條 deflate 串流，段跟段之間 Z_FULL_FLUSH（清掉字典、對齊位元組 ⇒ 每段的壓縮位元組只看那一段；gzip --rsyncable 同一招）；
#     每段各自 base64（⛔ 整條一起 base64 ⇒ 前面一段長度一變，後面全部錯位）。讀的時候各段解 base64、接起來 ＝ 一條普通的 deflate-raw ⇒ inflate、parse 照舊。
#     細切（ship_segments；同一天晚上。第一版檔頭一欄一段、格子一段 ⇒ 繩改一個數，整個 rig.ropes 那段重存 60–90 KB；改一格，整個格子那段重存 60 KB）：
#       一段壓縮後約 SEG_T（4 KB）。檔頭頂層一欄一段、rig／mpool 一個子欄一段（同第一版）；再往下壓縮後超過 SEG_T 的才切（_vsegs）：
#         物件一欄一段、陣列幾個元素一組（自己就超過的元素自己成段、再往下切 ⇒ 網格池的大網格 v、t 各自幾千個數一組）。
#       格子（_gsegs）：塊的鍵一段、4096 位元組的塊幾塊一組；鏡射／改裝船的 diff 幾筆一組（索引差值、顏色各自一段）。
#       分組照內容定切點（_cuts；content-defined chunking，rsync、restic 同一招）：元素後面切不切只看它自己的鍵 —— 繩、模型、零件看名字，
#         數字陣列看連續三個數，塊看塊座標，diff 看格子索引 ⇒ 改了、插了一個，只動它那一組（頂多連帶隔壁一組）；照個數切的話插一條繩，後面每組都換。
#       大小用估的（壓縮等級 6，比 9 快五倍；只定切點，出貨照樣 9）；一組實際壓起來超過 2×SEG_T ⇒ 只在那一組裡再切。
#       量（餘燼號，每種改法隨機六處、git 打包後一版的平均）：見 src/REPO_SIZE.md §0。船檔合計比整條壓大 3.6%（第一版 3.4%）。
#     切法改了、這台沒有 _cache ⇒ reseg（從船檔自己解回原文重切、驗算；見「船檔重切」）。⛔ 切點、壓出來的位元組都跟 zlib 版本有關：換了 zlib 的實作，船檔整份換一次。
POOL_EL = 'vxk-meshes'                                       # 舊的共用池子（拆檔之前的成品才有；現在只拿來擋「已經壓過」）
POOL_Q = 100
SHIPS_EL = 'vxk-ships'                                       # 入口裡的船清單
SHIP_RX = r'(<script type="application/x-vxk" id="[^"]+">)([^<]*)(</script>)'
SHIP_NAME_RX = re.compile(r'^[A-Za-z0-9_-]+\.js$')
SEG_T = 4096                                                 # 細切：一段壓縮後的目標位元組
SEG_LV = 6                                                   # 估大小用的壓縮等級（只拿來定切點；出貨照樣 9）
SEG_BLK = 65536                                              # 估壓縮比：每這麼多位元組一塊各自壓


def _jb(v):
    return json.dumps(v, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def _zn(b):
    """估：b 壓縮後幾位元組（等級 SEG_LV；只拿來定切點）。"""
    c = zlib.compressobj(SEG_LV, zlib.DEFLATED, -15)
    return len(c.compress(b)) + len(c.flush())


def _zr(parts):
    """估：一串 bytes 接起來、每 SEG_BLK 位元組一塊各自壓 ⇒ 壓縮後／壓縮前（一組只有幾 KB：整串一起壓的比例會低估一組的大小）。"""
    c = r = n = 0
    blk = []
    for p in parts:
        blk.append(p)
        n += len(p)
        if n >= SEG_BLK:
            c, r, blk, n = c + _zn(b''.join(blk)), r + n, [], 0
    if blk:
        c, r = c + _zn(b''.join(blk)), r + n
    return c / r if r else 1.0


def _cuts(keys, sizes, zs):
    """分組（照內容定切點）：元素 i 後面是切點 ⇔ crc32(鍵 i) < 大小 i／SEG_T（平均一組 SEG_T）；這組還不到 SEG_T/4 ⇒ 不切（太碎壓不好）。
    一組壓起來（zs(a, e) ＝ 第 a 到 e−1 個元素一段壓縮後的位元組）超過 2×SEG_T ⇒ 從組裡最像切點的地方（crc32／大小最小；一樣 ⇒ 靠中間）再切，切到不超過。
    切不切只看那個元素自己、再切只看那一組 ⇒ 改了、插了一個元素，只動它那一組（頂多連帶隔壁一組），後面的組不會跟著錯位。回傳每組的結尾（不含）。"""
    n = len(keys)
    q = [zlib.crc32(k) * SEG_T / (s * 4294967296) if s > 0 else math.inf for k, s in zip(keys, sizes)]   # < 1 ⇒ 切點
    P = [0.0]
    for s in sizes:
        P.append(P[-1] + s)
    ends, a = [], 0
    for i in range(n - 1):
        if q[i] < 1 and P[i + 1] - P[a] >= SEG_T / 4:
            ends.append(i + 1)
            a = i + 1
    out, a = [], 0
    for e in ends + [n]:
        st = [(a, e)]
        while st:
            x, y = st.pop()
            if y - x < 2 or zs(x, y) <= 2 * SEG_T:
                out.append(y)
                continue
            mid = (P[x] + P[y]) / 2
            m = min(range(x, y - 1), key=lambda i: (q[i], abs(P[i + 1] - mid)))
            st += [(m + 1, y), (x, m + 1)]
        a = e
    return out


def _ekey(x):
    """陣列元素的鍵（_cuts 只看它）：物件 ⇒ name／path／id（繩改了數字、換了綁定，鍵不變 ⇒ 切點不動）；
    沒有名字的物件（網格池的網格）⇒ 各欄的名字與長度（動了頂點，鍵不變）；其他 ⇒ 整個元素。"""
    if isinstance(x, dict):
        for k in ('name', 'path', 'id'):
            if isinstance(x.get(k), str):
                return x[k].encode('utf-8')
        return ';'.join('%s:%d' % (k, len(y)) if isinstance(y, (list, dict, str)) else k for k, y in x.items()).encode('utf-8')
    return _jb(x)


def _dsegs(d, sub):
    """物件一欄一段：sub(鍵, 值) 切好的段，第一段前面接 {"鍵": 或 ,"鍵":，最後一段後面接 }。"""
    out = []
    for j, (k, x) in enumerate(d.items()):
        s = sub(k, x)
        s[0] = (b'{' if j == 0 else b',') + _jb(k) + b':' + s[0]
        out += s
    out[-1] += b'}'
    return out


def _vsegs(v):
    """_jb(v) 切成段（接起來 ＝ _jb(v)）：壓縮後不到 SEG_T ⇒ 一段；物件 ⇒ 一欄一段（各欄再切）；
    陣列 ⇒ 幾個元素一組（_cuts；鍵：物件看名字、數字看連續三個數），自己就超過 SEG_T 的元素自己成段、往下切（網格池的大網格 ⇒ v、t 各自分組）。"""
    b = _jb(v)
    if len(b) <= SEG_T or _zn(b) <= SEG_T:
        return [b]
    if isinstance(v, dict):
        return _dsegs(v, lambda k, x: _vsegs(x))
    if not isinstance(v, list) or len(v) < 2:
        return [b]
    if all(type(x) in (int, float) for x in v):
        E = b[1:-1].split(b',')                              # 數字陣列：JSON 裡的逗號只當分隔
        K = [b','.join(E[max(0, i - 2):i + 1]) for i in range(len(E))]
        big = [False] * len(E)
    else:
        E = [_jb(x) for x in v]
        K = [_ekey(x) for x in v]
        big = [len(e) > SEG_T and _zn(e) > SEG_T for e in E]
    r = _zr(E)
    out, i = [], 0
    while i < len(E):
        if big[i]:
            out.append(_vsegs(v[i]))
            i += 1
            continue
        j = i
        while j < len(E) and not big[j]:
            j += 1
        a = i
        for e in _cuts(K[i:j], [(len(x) + 1) * r for x in E[i:j]], lambda x, y: _zn(b','.join(E[i + x:i + y]))):
            out.append([b','.join(E[a:i + e])])
            a = i + e
        i = j
    S = []
    for t, s in enumerate(out):
        s[0] = (b'[' if t == 0 else b',') + s[0]
        S += s
    S[-1] += b']'
    return S


def _segs(h):
    """檔頭切段：頂層一欄一段、rig／mpool 一個子欄一段（小欄常常單獨變：checksum、exported_at…）；再往下照 _vsegs。"""
    return _dsegs(h, lambda k, x: _dsegs(x, lambda k2, y: _vsegs(y)) if k in ('rig', 'mpool') and isinstance(x, dict) and x else _vsegs(x))


def _gsegs(h, grid):
    """格子那一段切段（接起來 ＝ grid）。格式照檔頭認：塊 ＝ 鍵 u16×3 × n ＋ 資料 4096 位元組 × n（鏡射 ⇒ 一半的塊、n ＝ nhalf）；
    鏡射、改裝船後面接 diff ＝ 索引差值 u32 × nd ＋ 顏色 u8 × nd（改裝船只有 diff）；長度對不上（不認得的格式）⇒ 整段一段。
    鍵一段；資料幾塊一組（_cuts：鍵 ＝ 塊座標，大小 ＝ 那塊各自壓的大小）；diff 幾筆一組（鍵 ＝ 格子的索引），差值、顏色照同一組切。"""
    V, M = h.get('variant'), h.get('mirror')
    nc, nd = (0, V['ndiff']) if V else (M['nhalf'], M['ndiff']) if M else (h.get('nchunks') or 0, 0)
    if len(grid) != nc * 4102 + nd * 5:
        return [grid]
    out = [grid[:nc * 6]]
    D = [grid[nc * 6 + i * 4096:nc * 6 + (i + 1) * 4096] for i in range(nc)]
    if D:
        al = [_zn(x) for x in D]
        r = _zr(D) * nc * 4096 / sum(al)                     # 各自壓的大小 ⇒ 換算成一組裡的大小
        a = 0
        for e in _cuts([grid[i * 6:i * 6 + 6] for i in range(nc)], [x * r for x in al], lambda x, y: _zn(b''.join(D[x:y]))):
            out.append(b''.join(D[a:e]))
            a = e
    if nd:
        p = nc * 4102
        dl, dc, at, K = grid[p:p + nd * 4], grid[p + nd * 4:], 0, []
        for d in struct.unpack('<%dI' % nd, dl):
            at += d
            K.append(struct.pack('<Q', at))
        E = _cuts(K, [(_zn(dl) + _zn(dc)) / nd] * nd, lambda x, y: max(_zn(dl[x * 4:y * 4]), _zn(dc[x:y])))
        for w, X in ((4, dl), (1, dc)):
            a = 0
            for e in E:
                out.append(X[a * w:e * w])
                a = e
    return [x for x in out if x]


def ship_segments(h, grid):
    """一艘船 ⇒ 段（bytes 的清單；接起來 ＝ b'VXK1' ＋ 檔頭長度 ＋ 檔頭 JSON ＋ 格子，跟以前整條壓的那一份原文一樣）。"""
    S = _segs(h)
    hb = b''.join(S)
    if hb != _jb(h):
        raise Fail('檔頭切段接回去跟原本不一樣（_segs）')
    G = _gsegs(h, grid)
    if b''.join(G) != grid:
        raise Fail('格子切段接回去跟原本不一樣（_gsegs）')
    S[0] = b'VXK1' + struct.pack('<I', len(hb)) + S[0]
    return S + G


def ship_pieces(h, grid):
    """段 ⇒ 每段壓縮後的 base64（同一條 deflate 串流，段之間 Z_FULL_FLUSH）。"""
    S = ship_segments(h, grid)
    c = zlib.compressobj(9, zlib.DEFLATED, -15)
    return [base64.b64encode(c.compress(s) + c.flush(zlib.Z_FULL_FLUSH if i < len(S) - 1 else zlib.Z_FINISH)).decode('ascii') for i, s in enumerate(S)]


def ship_text(el, pieces, h):
    """船檔的內容：一段一行（git 存得到差異；.gitattributes 讓 diff 不印內容）、最後是內容雜湊（載的時候跟入口清單比）。"""
    return 'VoxelKit.ship(%s,[\n%s\n],"%s");\n' % (json.dumps(el), ',\n'.join('"%s"' % p for p in pieces), h)


def ship_hash(pieces):
    return hashlib.sha1('\n'.join(pieces).encode('ascii')).hexdigest()[:10]


def ship_file(el):
    """船檔的相對路徑（跟入口同一層的 ships/）。"""
    return 'ships/%s.js' % el


SHIPS_TAG_RX = re.compile(r'<script type="application/json" id="%s">(\{(?:"[^<]*)?\})</script>' % SHIPS_EL)   # 內容一定是 JSON 物件 ⇒ 程式註解裡提到這個標籤不會被當成清單


def ships_index(html):
    """入口的船清單 { 標籤: 雜湊 }；不是拆檔的成品 ⇒ {}。"""
    m = SHIPS_TAG_RX.search(html)
    return json.loads(m.group(1)) if m else {}


def ship_data(html, el, read=None):
    """成品裡那一艘壓縮過的位元組（deflate-raw；zlib.decompress(…, -15) 解）：內嵌的（--single、--raw）或清單指的船檔（拆檔：各段解 base64、接起來）。
    read(相對路徑) ⇒ bytes｜None（不給 ⇒ 讀工作區）。沒有這一艘 ⇒ None；清單有、檔不在或內容跟檔名對不上 ⇒ Fail。"""
    mt = re.search(r'<script type="application/x-vxk" id="%s">([^<]*)</script>' % re.escape(el), html)
    if mt:
        return base64.b64decode(mt.group(1))
    h = ships_index(html).get(el)
    if not h:
        return None
    f = ship_file(el)
    b = (read or work_read)(f)
    if b is None:
        raise Fail('清單上的 %s 不在' % f)
    t = b.decode('utf-8', 'replace').strip()
    try:
        if not (t.startswith('VoxelKit.ship(') and t.endswith(');')):
            raise ValueError
        e, P, hx = json.loads('[' + t[len('VoxelKit.ship('):-2] + ']')
    except ValueError:
        raise Fail('%s 的內容不是 VoxelKit.ship("<標籤>",[段…],"<雜湊>");' % f)
    if e != el:
        raise Fail('%s 裡面是 #%s，不是 #%s' % (f, e, el))
    if hx != h:
        raise Fail('%s 不是同一次建置的（入口清單要 %s，檔是 %s）' % (f, h, hx))
    if ship_hash(P) != h:
        raise Fail('%s 的內容跟它寫的雜湊 %s 對不上（被改過？）' % (f, h))
    return b''.join(base64.b64decode(p) for p in P)


def ships_sync(root, files):
    """船檔寫進 <root>/ships/：files ＝ { 相對路徑: 內容 }；ships/ 裡不在 files 的船檔（船隻清單拿掉的船）拿掉。回 (寫了幾個, 拿掉幾個)。"""
    d = os.path.join(root, 'ships')
    old = [f for f in os.listdir(d) if f.endswith('.js')] if os.path.isdir(d) else []   # ships/ 只放建置寫的船檔 ⇒ 不在這次清單上的 .js 都是舊的
    if files:
        os.makedirs(d, exist_ok=True)
    for rel, t in files.items():
        with open(os.path.join(root, *rel.split('/')), 'w', encoding='utf-8', newline='\n') as f:
            f.write(t)
    gone = [f for f in old if 'ships/' + f not in files]
    for f in gone:
        os.remove(os.path.join(d, f))
    return len(files), len(gone)


def _deflate(b):
    c = zlib.compressobj(9, zlib.DEFLATED, -15)
    return c.compress(b) + c.flush()


def mesh_pack(m):
    """一份網格 ⇒ 池子裡那一格（同一點只存一次、差值）；還原不回原樣（不是 0.01 的倍數）⇒ None。"""
    V, idx, U, remap = m['verts'], {}, [], []
    for i in range(0, len(V), 3):
        k = (round(V[i] * POOL_Q), round(V[i + 1] * POOL_Q), round(V[i + 2] * POOL_Q))
        if k[0] / POOL_Q != V[i] or k[1] / POOL_Q != V[i + 1] or k[2] / POOL_Q != V[i + 2]:
            return None
        if k not in idx:
            idx[k] = len(U)
            U.append(k)
        remap.append(idx[k])
    v, p = [], (0, 0, 0)
    for q in U:
        v += [q[0] - p[0], q[1] - p[1], q[2] - p[2]]
        p = q
    t, pt = [], 0
    for i in m['tris']:
        x = remap[i]
        t.append(x - pt)
        pt = x
    return {'v': v, 't': t, 'tmat': m['tmat'], 'mats': m['mats']}


def pool_entry(P, ref):
    """網格的引用 { pool: i, o?: [x, y, z] } ⇒ 池子那一格；有 o ⇒ 起點換成 o（差值編碼的第一個頂點；只差起點的網格共用一格，TASK-0667）。"""
    e = P['meshes'][ref['pool']]
    return dict(e, v=list(ref['o']) + e['v'][3:]) if 'o' in ref else e


def mesh_unpack(e):
    """池子裡那一格 ⇒ 網格（跟 05_hull.js meshPoolMesh 同一個算法；驗算用）。"""
    V, p = [], [0, 0, 0]
    for i in range(0, len(e['v']), 3):
        p = [p[0] + e['v'][i], p[1] + e['v'][i + 1], p[2] + e['v'][i + 2]]
        V += [p[0] / POOL_Q, p[1] / POOL_Q, p[2] / POOL_Q]
    T, x = [], 0
    for d in e['t']:
        x += d
        T.append(x)
    return {'verts': V, 'tris': T, 'tmat': e['tmat'], 'mats': e['mats']}


# ── 格子：左右鏡射＋diff（TASK-0602；Tim 2026-10-15「船體如果是左右對稱的 是否可以只存一半然後鏡射解壓縮」「不對稱部分如果很少 可以鏡射後 額外保存diff」）──
# 量過（七艘前的六艘、壓縮後）：格子 852 KB → 一半＋diff 485 KB；不對稱的格 三叉戟號 67（名牌）、夜隼號 0、風暴角號 43,898（8 %，照樣划算）。
# 格式（只在成品裡；_cache 的 .vxk 不動）：header.mirror ＝ {s, nhalf, ndiff}，鏡面 y ↔ s − y；格子那一段換成
#   一半（2y ≤ s 的格，照 voxel_export.pack 的塊格式：nhalf 塊的鍵 u16×3 ＋ 4096 位元組）＋ diff（線性索引 x＋sx·(y＋sy·z) 的差值 u32 × ndiff ＋ 顏色 u8 × ndiff；顏色 0 ＝ 刪掉）。
# 還原（voxelkit.js parse 同一個算法）：一半照放、2y < s 的格鏡到 s − y（出界的不放）、套 diff、照 (cx, cy, cz) 排序、全空的塊不留 ⇒ 跟原檔一位元組不差（pack_verify 比）。
# 壓起來沒有比較小（例：對不上的太多）⇒ 不用，照原樣存。

def _grid_cells(grid, nch):
    import numpy as np
    keys = np.frombuffer(grid, '<u2', nch * 3).reshape(-1, 3).astype(np.int64)
    data = np.frombuffer(grid, np.uint8, nch * 4096, nch * 6).reshape(nch, 4096)
    ci, li = np.nonzero(data)
    return (keys[ci, 0] * 16 + (li & 15), keys[ci, 1] * 16 + ((li >> 4) & 15), keys[ci, 2] * 16 + (li >> 8), data[ci, li].astype(np.int64))


def _grid_chunks(x, y, z, c):
    """格 ⇒ 塊（跟 VoxelKit/voxel_export.pack 同一個排法：鍵照 (cx, cy, cz) 字典序）⇒ (塊數, 鍵與資料的位元組)。"""
    import numpy as np
    k = np.stack([x // 16, y // 16, z // 16], 1)
    uk, inv = np.unique(k, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    data = np.zeros((len(uk), 4096), np.uint8)
    data[inv, (x % 16) + 16 * (y % 16) + 256 * (z % 16)] = c
    return len(uk), uk.astype('<u2').tobytes() + data.tobytes()


def grid_mirror_pack(h, grid):
    """一艘的格子那一段 ⇒ (mirror 欄, 新的格子那一段)；沒有比較小 ⇒ None。"""
    import numpy as np
    sx, sy, _ = h['size']
    x, y, z, c = _grid_cells(grid, h['nchunks'])
    if not len(x):
        return None
    lin = x + sx * (y + sy * z)
    key = np.sort(lin * 256 + c)
    best = None
    for s in range(int(y.min() + y.max()) - 3, int(y.min() + y.max()) + 4):     # 鏡面：照「鏡過去顏色也一樣」的格最多的那一個
        ym = s - y
        ok = (ym >= 0) & (ym < sy)
        same = int(np.isin((x + sx * (ym + sy * z)) * 256 + c, key)[ok].sum())
        if best is None or same > best[1]:
            best = (s, same)
    s = best[0]
    hf = 2 * y <= s
    src = (2 * y < s) & (s - y < sy)
    pred = np.sort((x[src] + sx * ((s - y[src]) + sy * z[src])) * 256 + c[src])     # 一半鏡過去「應該有」的格
    far = np.sort(lin[~hf] * 256 + c[~hf])                                          # 另一半實際有的格
    add = far[~np.isin(far, pred)]                                                  # 多出來或換色 ⇒ 照實際的顏色
    dele = np.setdiff1d(pred // 256, far // 256)                                    # 鏡過去有、其實是空的 ⇒ 顏色 0
    diff = np.concatenate([add, dele * 256])
    diff = diff[np.argsort(diff // 256, kind='stable')]
    di = diff // 256
    nh, hb = _grid_chunks(x[hf], y[hf], z[hf], c[hf])
    body = hb + np.diff(np.concatenate([[0], di])).astype('<u4').tobytes() + (diff % 256).astype(np.uint8).tobytes()
    if len(_deflate(body)) >= len(_deflate(grid)):
        return None
    return {'s': int(s), 'nhalf': int(nh), 'ndiff': int(len(diff))}, body


def grid_mirror_unpack(h, body):
    """grid_mirror_pack 的反向（跟 voxelkit.js parse 的還原同一個算法；驗算用）⇒ 原本的格子那一段。"""
    import numpy as np
    M = h['mirror']
    sx, sy, _ = h['size']
    s, nh, nd = M['s'], M['nhalf'], M['ndiff']
    x, y, z, c = _grid_cells(body, nh)
    p = nh * 6 + nh * 4096
    di = np.cumsum(np.frombuffer(body, '<u4', nd, p).astype(np.int64))
    dc = np.frombuffer(body, np.uint8, nd, p + nd * 4).astype(np.int64)
    src = (2 * y < s) & (s - y < sy)
    cell = {}
    lin = x + sx * (y + sy * z)
    for a, b in zip(lin.tolist(), c.tolist()):
        cell[a] = b
    for a, b in zip((x[src] + sx * ((s - y[src]) + sy * z[src])).tolist(), c[src].tolist()):
        cell[a] = b
    for a, b in zip(di.tolist(), dc.tolist()):
        if b:
            cell[a] = b
        else:
            cell.pop(a, None)
    L = np.fromiter(cell.keys(), np.int64, len(cell))
    C = np.fromiter(cell.values(), np.int64, len(cell))
    n, b = _grid_chunks(L % sx, (L // sx) % sy, L // (sx * sy), C)
    return n, b


# ── 格子：改裝船存成跟原船的差（TASK-0657；Tim 2026-10-16「可以把一艘船當成子作品概念去做改裝船(減少資料量)」「只要記錄diff的部分(不過匯入時就要兩個一起匯入)」）──
# 格式（只在成品裡；_cache 的 .vxk 不動）：header.variant ＝ {el: 原船的內嵌標籤, ndiff}；格子那一段 ＝ 跟原船 _cache 原檔的格子的差
#   （線性索引 x＋sx·(y＋sy·z) 的差值 u32 × ndiff ＋ 顏色 u8 × ndiff；多的、換色的照改裝船的色，原船有、改裝船沒有的顏色 0）。
# 還原（voxelkit.js unvariant 同一個算法）：原船照它自己的讀法還原 ⇒ 複製、套 diff、全空的塊不留、照 (cx, cy, cz) 排序 ⇒ 跟原檔一位元組不差（pack_verify 比）。
# 原船、改裝船的 sx、sy 要一樣（線性索引才對得上；sz 可以不同）；壓起來沒有比較小 ⇒ 不用。原船重新匯入 ⇒ 下一次 build 照當下的兩份重算。

def grid_variant_pack(h, grid, h0, grid0, el0):
    """改裝船的格子那一段 ⇒ (variant 欄, 新的格子那一段)；x、y 尺寸跟原船不一樣 ⇒ None。"""
    import numpy as np
    sx, sy, _ = h['size']
    if h0['size'][0] != sx or h0['size'][1] != sy:
        return None
    x, y, z, c = _grid_cells(grid, h['nchunks'])
    x0, y0, z0, c0 = _grid_cells(grid0, h0['nchunks'])
    lin, lin0 = x + sx * (y + sy * z), x0 + sx * (y0 + sy * z0)
    k = lin * 256 + c
    add = k[~np.isin(k, lin0 * 256 + c0)]                                           # 多出來或換色 ⇒ 照改裝船的顏色
    dele = np.setdiff1d(lin0, lin)                                                   # 原船有、改裝船沒有 ⇒ 顏色 0
    diff = np.concatenate([add, dele * 256])
    diff = diff[np.argsort(diff // 256, kind='stable')]
    di = diff // 256
    body = np.diff(np.concatenate([[0], di])).astype('<u4').tobytes() + (diff % 256).astype(np.uint8).tobytes()
    return {'el': el0, 'ndiff': int(len(diff))}, body


def grid_variant_unpack(h, body, h0, grid0):
    """grid_variant_pack 的反向（跟 voxelkit.js unvariant 同一個算法；驗算用）⇒ 原本的格子那一段（塊數, 位元組）。grid0 ＝ 原船還原好的格子那一段。"""
    import numpy as np
    sx, sy, _ = h['size']
    nd = h['variant']['ndiff']
    if len(body) != nd * 5:
        raise Fail('改裝船段長度 %d ≠ %d' % (len(body), nd * 5))
    di = np.cumsum(np.frombuffer(body, '<u4', nd, 0).astype(np.int64))
    dc = np.frombuffer(body, np.uint8, nd, nd * 4).astype(np.int64)
    x0, y0, z0, c0 = _grid_cells(grid0, h0['nchunks'])
    cell = dict(zip((x0 + sx * (y0 + sy * z0)).tolist(), c0.tolist()))
    for a, b in zip(di.tolist(), dc.tolist()):
        if b:
            cell[a] = b
        else:
            cell.pop(a, None)
    L = np.fromiter(cell.keys(), np.int64, len(cell))
    C = np.fromiter(cell.values(), np.int64, len(cell))
    return _grid_chunks(L % sx, (L // sx) % sy, L // (sx * sy), C)


# ── 檔頭：改裝船跟原船相同的欄位不存（TASK-0667 ①；Tim 2026-10-17「哨兵號這種用其他船當子模組的改造模式 能省下多少空間」→「重構時重點處理這一塊」）──
# 格式（只在成品裡）：header.vh ＝ {el: 原船的內嵌標籤, k: [路徑, …]}，路徑 ＝ 一串鍵（只走物件、不走陣列：['render', 'runs']）；那幾欄從改裝船的檔頭拿掉。
# 比的是兩艘都處理好的檔頭（帆只留配方、網格換成池子編號之後）；兩邊寫成 JSON 逐字相同才算（⛔ 不用 ==：Python 的 True == 1、1 == 1.0，JS 分得出來）。
# 還原（voxelkit.js unshare 同一個算法）：原船照它自己的讀法解（原船自己是改裝船 ⇒ 先還原它的）⇒ 照路徑把那幾欄放回改裝船；pack_verify 照同一個讀法比 _cache 原檔。
VH_SKIP = {'size', 'nchunks', 'variant', 'mirror', 'mesh_pool', 'vh', 'checksum', 'voxels'}   # 頂層這幾欄是改裝船自己的（或太小）
VH_MIN = 32                                                                                     # 比這個短（JSON 位元組）的欄不值得記路徑


def _js(v):
    return json.dumps(v, ensure_ascii=False, separators=(',', ':'))


def header_shared(h, h0, pre=()):
    """改裝船檔頭 h 跟原船 h0 逐字相同的欄 ⇒ 路徑清單（物件不同 ⇒ 往下一層找）。"""
    out = []
    for k in h:
        if (not pre and k in VH_SKIP) or k not in h0:
            continue
        a, b = h[k], h0[k]
        if isinstance(a, dict) and isinstance(b, dict) and _js(a) != _js(b):
            out += header_shared(a, b, pre + (k,))
        elif _js(a) == _js(b) and len(_js(a).encode('utf-8')) >= VH_MIN:
            out.append(list(pre + (k,)))
    return out


def header_drop(h, p):
    for k in p[:-1]:
        h = h[k]
    del h[p[-1]]


def header_unshare(h, h0):
    """header_shared 的反向（跟 voxelkit.js unshare 同一個算法）：照 h['vh'] 的路徑從原船 h0 放回來、拿掉 vh。"""
    for p in h.pop('vh')['k']:
        a, b = h, h0
        for k in p[:-1]:
            a, b = a.setdefault(k, {}), b[k]
        a[p[-1]] = json.loads(_js(b[p[-1]]))


def _emb_header(html, el, depth=0, read=None):
    """成品裡的那一艘（內嵌或船檔，見 ship_data）⇒ 照遊戲的讀法還原好的檔頭（vh 照原船放回；原船自己有 vh ⇒ 先還原它的）。"""
    if depth > 8:
        raise Fail('改裝船的原船鏈太長（成環？）：#%s' % el)
    b = ship_data(html, el, read)
    if b is None:
        raise Fail('成品裡沒有 #%s' % el)
    a = zlib.decompress(b, -15)
    na = struct.unpack('<I', a[4:8])[0]
    h = json.loads(a[8:8 + na].decode('utf-8'))
    if h.get('vh'):
        header_unshare(h, _emb_header(html, h['vh']['el'], depth + 1, read))
    return h


def _cache_raw(s):
    """一艘的 _cache 原檔 ⇒ (header, 格子那一段)。"""
    b = zlib.decompress(open(os.path.join(CACHE, s['vxk']), 'rb').read(), -15)
    n = struct.unpack('<I', b[4:8])[0]
    return json.loads(b[8:8 + n].decode('utf-8')), b[8 + n:]


def same_tris(a, b):
    """兩份網格的三角形一個一個比：每一角的座標、材質都一樣（頂點的編號可以不同）。"""
    if len(a['tris']) != len(b['tris']) or a['tmat'] != b['tmat'] or a['mats'] != b['mats']:
        return False
    va, vb = a['verts'], b['verts']
    for ia, ib in zip(a['tris'], b['tris']):
        if va[ia * 3:ia * 3 + 3] != vb[ib * 3:ib * 3 + 3]:
            return False
    return True


def pack_html(path, split=True):
    """成品（vxk_inline.py 嵌好的）⇒ 壓縮版：每艘的網格換成它自己池子（header.mpool）的編號。
    split（預設）⇒ 船拆成 ships/<標籤>.js（分段）、入口留船清單；False（build --single）⇒ 船照舊內嵌、一個檔。回傳讀數。"""
    html = open(path, encoding='utf-8').read()
    if 'id="%s"' % POOL_EL in html or SHIPS_TAG_RX.search(html):
        raise Fail('成品已經壓過了（有 #%s 或 #%s）' % (POOL_EL, SHIPS_EL))
    log, keep, mirrors, moved, npool, files, index = [], 0, [], 0, 0, {}, {}
    size0 = len(html.encode('utf-8'))
    ships = load()['ships']
    byel, byid = {s['el']: s for s in ships}, {s['id']: s for s in ships}

    def one(mt):
        nonlocal keep, moved, npool
        if len(mt.group(2)) < 64:   # 程式註解裡的「<script type="application/x-vxk" id="…">base64</script>」不是船
            return mt.group(0)
        raw = zlib.decompress(base64.b64decode(mt.group(2)), -15)
        n = struct.unpack('<I', raw[4:8])[0]
        h = json.loads(raw[8:8 + n].decode('utf-8'))
        rs = sail_strip(h)                                       # TASK-0602 ①：有配方的帆只留配方（遊戲照配方生帆，js/29_sailrecipe.js）
        rs += vox_strip(h)                                       # TASK-0793：主機、鍋爐（自帶格子的模型）的網格拿掉（遊戲照 vox 放回船殼、網格不建）
        ms = (h.get('rig') or {}).get('meshes')
        if ms:
            out, pool, where, shape = [], [], {}, {}             # 池子只在這艘船裡（編號照這艘船裡第一次出現的順序）
            for m in ms:
                key = hashlib.sha1(json.dumps(m, separators=(',', ':')).encode()).hexdigest()
                if key not in where:
                    e = mesh_pack(m)
                    if e is None or not same_tris(m, mesh_unpack(e)):
                        where[key] = None
                    else:
                        # TASK-0667：只差起點的網格（同一種砲擺在不同位置：差值編碼只有第一個頂點不同）共用池子的同一格，引用帶自己的起點 o
                        sk = hashlib.sha1(json.dumps([e['v'][3:], e['t'], e['tmat'], e['mats']], separators=(',', ':')).encode()).hexdigest()
                        if sk not in shape:
                            shape[sk] = len(pool)
                            pool.append(e)
                        i = shape[sk]
                        where[key] = {'pool': i} if pool[i]['v'][:3] == e['v'][:3] else {'pool': i, 'o': e['v'][:3]}
                if where[key] is None:
                    out.append(m)
                    keep += 1
                else:
                    out.append(dict(where[key]))
                    moved += 'o' in where[key]
            h['rig']['meshes'] = out
            if pool:
                h['mpool'] = {'q': POOL_Q, 'meshes': pool}
                npool += len(pool)
        grid = raw[8 + n:]
        g0 = len(_deflate(grid))
        el = re.search(r'id="([^"]+)"', mt.group(1)).group(1)
        mr = grid_mirror_pack(h, grid)                        # TASK-0602：格子鏡射＋diff（沒有比較小 ⇒ None，照原樣）
        vr = None
        sv = byel.get(el)
        if sv and sv.get('variant_of') in byid:              # TASK-0657：改裝船 ⇒ 跟原船的差；比鏡射（或原樣）小才用
            s0 = byid[sv['variant_of']]
            h0, g0raw = _cache_raw(s0)
            vr = grid_variant_pack(h, grid, h0, g0raw, s0['el'])
            if vr and len(_deflate(vr[1])) >= len(_deflate(mr[1] if mr else grid)):
                vr = None
        if vr:
            h['variant'], grid = vr
            mr = None
        elif mr:
            h['mirror'], grid = mr
        mirrors.append((el, h.get('mirror'), g0, len(_deflate(grid)), h.get('variant')))
        items.append({'el': el, 'h': h, 'grid': grid, 'mt': mt, 'changed': bool(ms or mr or vr or rs), 'base': byid[sv['variant_of']]['el'] if sv and sv.get('variant_of') in byid else None})
        return '\x00SHIP%d\x00' % (len(items) - 1)                # 檔頭共用（TASK-0667）要等每艘都處理完才比得了 ⇒ 先佔位，最後一起寫

    items = []
    RX = SHIP_RX
    first = next(mt for mt in re.finditer(RX, html) if len(mt.group(2)) >= 64).start()   # 船清單放在第一艘船前面（⛔ 照字串找第一個：voxelkit.js 的註解裡就有一模一樣的標籤 ⇒ 清單插進程式中間）
    html2 = html[:first] + '\x00POOL\x00' + html[first:]
    html2, k = re.subn(RX, one, html2)
    proc = {it['el']: it['h'] for it in items}
    shared = []
    for it in items:                                          # 先全部比完（比的是處理好、還沒拿掉任何欄位的檔頭）再拿掉 ⇒ 原船自己也是改裝船時照樣對
        if it['base'] in proc:
            P = header_shared(it['h'], proc[it['base']])
            if P:
                it['vh'] = {'el': it['base'], 'k': P}
    for it in items:
        if it.get('vh'):
            n0 = len(json.dumps(it['h'], ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
            for p in it['vh']['k']:
                header_drop(it['h'], p)
            it['h']['vh'] = it['vh']
            shared.append((it['el'], it['base'], it['vh']['k'], n0 - len(json.dumps(it['h'], ensure_ascii=False, separators=(',', ':')).encode('utf-8'))))
            it['changed'] = True

    def emit(m):
        it = items[int(m.group(1))]
        mt = it['mt']
        if split:                                               # 船檔：照結構分段（見上面「船檔分段」）
            P = ship_pieces(it['h'], it['grid'])
            hx = ship_hash(P)
            index[it['el']] = hx
            files[ship_file(it['el'])] = ship_text(it['el'], P, hx)
            return ''                                           # 標籤拿掉、換行留著 ⇒ 後面的行號不變
        if not it['changed']:
            return mt.group(0)
        hb = _jb(it['h'])
        b = base64.b64encode(_deflate(b'VXK1' + struct.pack('<I', len(hb)) + hb + it['grid'])).decode('ascii')
        return mt.group(1) + b + mt.group(3)
    html2 = re.sub('\x00SHIP(\\d+)\x00', emit, html2)
    k = sum(1 for mt in re.finditer(RX, html) if len(mt.group(2)) >= 64)
    tag = '<script type="application/json" id="%s">%s</script>\n' % (SHIPS_EL, json.dumps(index, separators=(',', ':'))) if split else ''
    html2 = html2.replace('\x00POOL\x00', tag, 1)
    nv, E = pack_verify(html2, lambda rel: files[rel].encode('utf-8') if rel in files else None)   # 寫出去之前：照遊戲的讀法還原、跟 _cache 原檔逐個比（對不上 ⇒ 不寫，舊成品留著）
    if E:
        raise Fail('壓縮版還原出來跟原檔對不上（成品沒寫）：\n' + '\n'.join('  ✗ ' + e for e in E[:12]))
    log.append('✓ 網格池：每艘船自己一個，合計 %d 份；只差起點的網格共用同一格 ⇒ %d 個引用帶自己的起點（TASK-0667）' % (npool, moved))
    log.append('✓ 還原驗算：%d 艘、%d 份網格的三角形跟 _cache 原檔逐個相同，格子、繩、帆一位元組不差（有配方的帆只存配方，頂點由遊戲照配方生，不在這裡比）' % (k, nv))
    for el, M, g0, g1, V in mirrors:
        what = ('改裝船：跟原船 #%s 差 %d 格' % (V['el'], V['ndiff'])) if V else ('鏡射 y ↔ %d − y、一半 %d 塊、diff %d 格' % (M['s'], M['nhalf'], M['ndiff'])) if M else '照原樣（鏡射沒有比較小）'
        log.append('  格子 %s：%s　%d KB → %d KB' % (el, what, g0 // 1024, g1 // 1024))
    for el, el0, P, dn in shared:
        log.append('  檔頭 %s：跟原船 #%s 相同的 %d 欄不存（%s）⇒ 少 %d KB（壓縮前）' % (el, el0, len(P), '、'.join('.'.join(p) for p in P[:8]) + ('…' if len(P) > 8 else ''), dn // 1024))
    open(path, 'w', encoding='utf-8', newline='').write(html2)
    nw, ng = ships_sync(os.path.dirname(path), files)
    size1 = len(html2.encode('utf-8'))
    sf = sum(len(t) for t in files.values())
    log.append('✓ 壓縮版：%d 艘%s；%s' % (k, '（網格照原樣留在船裡 %d 份）' % keep if keep else '',
        '拆檔：入口 %.2f MB ＋ ships/ %d 個檔 %.2f MB（一艘 %d–%d KB；拿掉舊的 %d 個）⇒ 合計 %.2f MB（內嵌原格式 %.2f MB）' % (
            size1 / 1048576, nw, sf / 1048576, min(len(t) for t in files.values()) // 1024, max(len(t) for t in files.values()) // 1024, ng,
            (size1 + sf) / 1048576, size0 / 1048576) if split else
        '一個檔（--single）%.2f MB（內嵌原格式 %.2f MB）' % (size1 / 1048576, size0 / 1048576)))
    return log


# ───────────────────────── 成品去註解（TASK-0667，Tim 2026-10-17：成品瘦身）─────────────────────────
# 只動成品（壓縮版）裡內嵌的程式（<script> 不帶屬性的那幾段：voxelkit.js、遊戲閉包）；原始碼的註解照留，build --raw 也照留。
# 拿掉：註解、行首縮排、行尾空白、行內連續空白縮成一格。⛔ 換行一個都不拿 ⇒ 成品的行號跟去註解前一樣（錯誤訊息照樣對得到原本那一行）；
#   每支檔開頭那一行「// ── js/xx.js ──」照留（照行號找是哪一支檔）。
# 掃描器照 JS 的讀法分：字串、正則、註解、其他；'/' 是正則還是除號照前一個字（運算子、左括號、return 這類關鍵字之後 ⇒ 正則）。
# 驗算（寫回去之前）：node 內建的 acorn 把去註解前後各解析一次，語法樹（拿掉位置）逐個節點相同才寫（js_ast_same.cjs，另一份獨立的讀法）；
#   沒有 node ⇒ 照寫、讀數明寫「沒驗」。樣板字串（反引號）遊戲沒用 ⇒ 碰到就擋（不猜它的 ${} 怎麼巢狀）。
JS_RX_AFTER = {'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await'}
JS_KEEP_LINE = '// ── '


def js_strip(src):
    """一段 JS ⇒ 去掉註解與多餘空白（換行全留）。"""
    out, i, n = [], 0, len(src)
    last, word = '', ''                                   # 前一個有意義的字：'' 開頭、'id' 名字（word）、'num'、'str'、'rx' 正則、其他 ＝ 那個符號
    at_line = True
    while i < n:
        c = src[i]
        if c == '\r':
            i += 1
            continue
        if c == '\n':
            while out and out[-1] == ' ':
                out.pop()
            out.append('\n')
            i += 1
            while i < n and src[i] in ' \t':
                i += 1
            at_line = True
            continue
        if c in ' \t':
            j = i
            while j < n and src[j] in ' \t':
                j += 1
            if out and out[-1] not in ' \n':
                out.append(' ')
            i = j
            continue
        if src.startswith('//', i):
            j = src.find('\n', i)
            j = n if j < 0 else j
            if at_line and src.startswith(JS_KEEP_LINE, i):
                out.append(src[i:j].rstrip())
            i = j
            continue
        if src.startswith('/*', i):
            j = src.find('*/', i + 2)
            if j < 0:
                raise Fail('去註解：/* 沒有結尾（第 %d 行）' % (src.count('\n', 0, i) + 1))
            k = src.count('\n', i, j)
            if k:
                while out and out[-1] == ' ':
                    out.pop()
                out.append('\n' * k)
                at_line = True
            elif out and out[-1] not in ' \n':
                out.append(' ')
            i = j + 2
            continue
        at_line = False
        if c in '\'"':
            j = i + 1
            while j < n and src[j] != c:
                if src[j] == '\\':
                    j += 1
                elif src[j] == '\n':
                    raise Fail('去註解：字串沒有結尾（第 %d 行）' % (src.count('\n', 0, i) + 1))
                j += 1
            out.append(src[i:j + 1])
            last, i = 'str', j + 1
            continue
        if c == '`':
            raise Fail('去註解：碰到樣板字串（第 %d 行）—— 遊戲沒用、掃描器不認 ⇒ 擋下（要用就先把掃描器補上）' % (src.count('\n', 0, i) + 1))
        if c == '/':
            rx = last in ('',) or (last == 'id' and word in JS_RX_AFTER) or (last not in ('id', 'num', 'str', 'rx') and last not in (')', ']'))
            if rx:
                j, cls = i + 1, False
                while j < n:
                    d = src[j]
                    if d == '\\':
                        j += 2
                        continue
                    if d == '\n':
                        raise Fail('去註解：正則沒有結尾（第 %d 行）' % (src.count('\n', 0, i) + 1))
                    if d == '[':
                        cls = True
                    elif d == ']':
                        cls = False
                    elif d == '/' and not cls:
                        break
                    j += 1
                j += 1
                while j < n and (src[j].isalnum() or src[j] == '_'):
                    j += 1
                out.append(src[i:j])
                last, i = 'rx', j
                continue
            out.append(c)
            last, i = c, i + 1
            continue
        if c.isalpha() or c in '_$' or ord(c) > 127:
            j = i + 1
            while j < n and (src[j].isalnum() or src[j] in '_$' or ord(src[j]) > 127):
                j += 1
            word = src[i:j]
            out.append(word)
            last, i = 'id', j
            continue
        if c.isdigit() or (c == '.' and i + 1 < n and src[i + 1].isdigit()):
            j = i + 1
            while j < n and (src[j].isalnum() or src[j] in '._' or (src[j] in '+-' and src[j - 1] in 'eE' and not src[i:j].lower().startswith('0x'))):
                j += 1
            out.append(src[i:j])
            last, i = 'num', j
            continue
        out.append(c)
        last, i = c, i + 1
    return ''.join(out)


def js_strip_html(path):
    """成品裡每段 <script>（不帶屬性：程式本體）去註解；驗算過才寫回。回傳讀數。"""
    import tempfile
    html = open(path, encoding='utf-8').read()
    parts, log = [], []

    def one(mt):
        a = mt.group(1)
        b = js_strip(a)
        if a.count('\n') != b.count('\n'):
            raise Fail('去註解：行數 %d → %d（應該一樣）' % (a.count('\n'), b.count('\n')))
        parts.append((a, b))
        return '<script>' + b + '</script>'

    html2 = re.sub(r'<script>(.*?)</script>', one, html, flags=re.S)
    node = shutil.which('node')
    checked = 0
    if node:
        with tempfile.TemporaryDirectory() as td:
            for k, (a, b) in enumerate(parts):
                fa, fb = os.path.join(td, '%d_a.js' % k), os.path.join(td, '%d_b.js' % k)
                open(fa, 'w', encoding='utf-8', newline='').write(a.replace('<\\/script', '</script'))
                open(fb, 'w', encoding='utf-8', newline='').write(b.replace('<\\/script', '</script'))
                r = subprocess.run([node, '--expose-internals', os.path.join(HERE, 'js_ast_same.cjs'), fa, fb], capture_output=True, text=True, encoding='utf-8')
                try:
                    res = json.loads(r.stdout.strip().splitlines()[-1])
                except Exception:
                    res = {'ok': False, 'why': (r.stdout + r.stderr).strip()[-300:]}
                if not res.get('ok'):
                    raise Fail('去註解的驗算沒過（成品照去註解前的留著）：第 %d 段 %s' % (k + 1, res.get('why')))
                checked += res.get('nodes', 0)
    open(path, 'w', encoding='utf-8', newline='').write(html2)
    a0, b0 = sum(len(a.encode('utf-8')) for a, _ in parts), sum(len(b.encode('utf-8')) for _, b in parts)
    log.append('✓ 成品去註解：%d 段程式 %.2f MB → %.2f MB（行數不變）；%s' % (
        len(parts), a0 / 1048576, b0 / 1048576, '語法樹逐點相同（acorn，%d 個節點）' % checked if node else '⚠ 沒驗（找不到 node）'))
    log.append('✓ 成品 %.2f MB' % (len(html2.encode('utf-8')) / 1048576))
    return log


def sail_strip(h):
    """TASK-0602 ①（Tim 2026-10-17：「匯入時可以只包含配方（吹鼓直接用遊戲內的帆繩物理）」）：有 recipe 的帆拿掉雕刻引擎模擬完的 verts、tris、貼圖的 uv ——
    遊戲載入時照配方生出來（js/29_sailrecipe.js）。回：拿掉了幾面。_cache 的原檔照留（量偏差、舊讀者用）。"""
    n = 0
    for s in (h.get('rig') or {}).get('sails') or []:
        if 'recipe' not in s:
            continue
        s.pop('verts', None)
        s.pop('tris', None)
        if isinstance(s.get('texture'), dict):
            s['texture'].pop('uv', None)
        n += 1
    return n


def vox_strip(h):
    """自帶格子的模型（HULLV_KINDS：主機、鍋爐；TASK-0793，Tim 2026-10-21「全包」）：遊戲載入時照 vox 把格子放回船殼、模型拿掉、網格不建（js/38_fit.js fitHullVox），
    網格只在換裝時拿來量長寬高、擺外框 ⇒ 那兩件改照模型的外框（bbox ＝ vox 的外框 ＝ 網格的外框，20 艘量過逐格相同）⇒ 只給這種模型用的網格換成空的。
    別的模型也用同一份網格 ⇒ 照留。回：拿掉了幾份。_cache 的原檔照留（vox_flip 照網格判鏡像要用）。"""
    rig = h.get('rig') or {}
    ms, use, n = rig.get('meshes') or [], {}, 0
    for m in rig.get('models') or []:
        use.setdefault(m.get('mesh'), []).append(m)
    for i, L in use.items():
        if isinstance(i, int) and 0 <= i < len(ms) and isinstance(ms[i], dict) and ms[i].get('verts') and all((x.get('meta') or {}).get('kind') in HULLV_KINDS and x.get('vox') for x in L):
            ms[i] = {'verts': [], 'tris': [], 'tmat': [], 'mats': ms[i].get('mats') or []}
            n += 1
    return n


def pack_verify(html, read=None):
    """壓縮版成品 ⇒ 每艘照遊戲的讀法還原（池子編號 ⇒ 那艘船自己池子 header.mpool 的那一格 ⇒ mesh_unpack），跟 _cache 原檔比：
    網格的三角形逐個相同；header 其他欄位相同；格子那一段一位元組不差。回傳 (比了幾份網格, 錯誤清單)。原格式的成品 ⇒ 只比格子與 header。
    拆檔的成品：船從清單指的檔讀（read(相對路徑) ⇒ bytes｜None；不給 ⇒ 讀工作區）。"""
    n, E = 0, []
    for s in load()['ships']:
        try:
            dz = ship_data(html, s['el'], read)
        except Fail as e:
            E.append('%s：%s' % (s['id'], e))
            continue
        if dz is None:
            E.append('%s：成品裡沒有 #%s' % (s['id'], s['el']))
            continue
        a = zlib.decompress(dz, -15)
        b = zlib.decompress(open(os.path.join(CACHE, s['vxk']), 'rb').read(), -15)
        na, nb = struct.unpack('<I', a[4:8])[0], struct.unpack('<I', b[4:8])[0]
        ha, hb = json.loads(a[8:8 + na].decode('utf-8')), json.loads(b[8:8 + nb].decode('utf-8'))
        ga = a[8 + na:]
        if ha.get('vh'):                                        # TASK-0667：跟原船相同的檔頭欄 ⇒ 照遊戲的讀法從原船（成品裡內嵌的那一份，還原好的）放回來
            try:
                header_unshare(ha, _emb_header(html, ha['vh']['el'], read=read))
            except (Fail, KeyError, TypeError) as e:
                E.append('%s：檔頭從原船放回來失敗（%s）' % (s['id'], e))
                continue
        if ha.get('variant'):                                   # TASK-0657：改裝船 ⇒ 原船的原檔＋差（原船自己的成品另外在它那一輪比）
            s0 = next((x for x in load()['ships'] if x['el'] == ha['variant']['el']), None)
            if s0 is None:
                E.append('%s：改裝船的原船 #%s 不在船隻清單裡' % (s['id'], ha['variant']['el']))
                continue
            h0, g0raw = _cache_raw(s0)
            nc, ga = grid_variant_unpack(ha, ga, h0, g0raw)
            ha.pop('variant')
            if nc != ha.get('nchunks'):
                E.append('%s：改裝船還原出 %d 塊，header 說 %s 塊' % (s['id'], nc, ha.get('nchunks')))
        if ha.get('mirror'):                                    # TASK-0602：格子鏡射＋diff ⇒ 照遊戲的讀法（voxelkit.js parse）還原再比
            nc, ga = grid_mirror_unpack(ha, ga)
            ha.pop('mirror')
            if nc != ha.get('nchunks'):
                E.append('%s：鏡射還原出 %d 塊，header 說 %s 塊' % (s['id'], nc, ha.get('nchunks')))
        if ga != b[8 + nb:]:
            E.append('%s：格子那一段跟原檔不一樣' % s['id'])
        vox_strip(hb)                                           # 主機、鍋爐的網格：成品裡是空的 ⇒ 原檔那一份也換成空的再比
        ma, mb = (ha.get('rig') or {}).get('meshes') or [], (hb.get('rig') or {}).get('meshes') or []
        P = ha.pop('mpool', None)
        if P is not None:
            ma = [mesh_unpack(pool_entry(P, x)) if isinstance(x, dict) and 'pool' in x else x for x in ma]
        elif any(isinstance(x, dict) and 'pool' in x for x in ma):
            E.append('%s：網格是池子編號，檔頭卻沒有 mpool' % s['id'])
            continue
        if len(ma) != len(mb):
            E.append('%s：網格 %d 份，原檔 %d 份' % (s['id'], len(ma), len(mb)))
            continue
        for i, (x, y) in enumerate(zip(ma, mb)):
            n += 1
            if not same_tris(x, y):
                E.append('%s：第 %d 份網格的三角形跟原檔不一樣' % (s['id'], i))
        if ha.get('rig'):
            ha['rig'] = dict(ha['rig'], meshes=None)
        if hb.get('rig'):
            hb['rig'] = dict(hb['rig'], meshes=None)
        sail_strip(hb)                                          # 有配方的帆：成品本來就沒有 verts／tris／uv（遊戲照配方生）⇒ 原檔那一份也拿掉再比，其他欄位照樣逐欄相同
        if ha != hb:
            E.append('%s：header（網格以外）跟原檔不一樣' % s['id'])
    return n, E


def act_verify():
    """成品 ⇒ 跟 _cache 原檔比（壓縮版照遊戲的讀法還原）。"""
    if not os.path.exists(OUT):
        raise Fail('還沒有成品（先 build）')
    html = open(OUT, encoding='utf-8').read()
    n, E = pack_verify(html)
    if E:
        raise Fail('成品跟 _cache 原檔對不上：\n' + '\n'.join('  ✗ ' + e for e in E[:20]))
    return ['✓ 成品（%s）跟 _cache 原檔相同：%d 份網格的三角形逐個比過，格子、header 一致' % ('拆檔' if ships_index(html) else '一個檔', n)]



def act_cache(every=False):
    """_cache 的 .vxk 從雕刻作品重新匯出、跟指紋（config/vxk_lock.json，入版控）比（TASK-0586：.vxk 不入版控 ⇒ 換一台機器 _cache 是空的）。
    預設只補缺的；every（cache --all）⇒ 每艘都比 ＝ 比對來源：雕刻作品現在這份跟上次建置用的是不是同一份。
    對得上 ⇒ 放進 _cache；對不上（作品之後又改過）⇒ ⛔ 不蓋 _cache、不改指紋，新匯出的留成 <船>.vxk.source，說是哪一艘、要用新的就 reimport。
    （以前從成品內嵌的那份解回；壓縮版（TASK-0583，預設）的網格換成了池子，解不回原檔 ⇒ 改成從來源重新匯出。）"""
    cfg, L, log, bad = load(), lock_load(), [], []
    os.makedirs(CACHE, exist_ok=True)
    for s in cfg['ships']:
        p, want = os.path.join(CACHE, s['vxk']), L.get(s['vxk'])
        if os.path.exists(p) and not every:
            log.append('  %s：已有（只補缺的；每艘都跟作品比 ⇒ cache --all）' % s['vxk'])
            continue
        if not s.get('work'):
            bad.append(s['vxk'])
            log.append('  ✗ %s：設定檔沒寫是哪件雕刻作品（ships[].work）⇒ reimport --id %s --work <作品>' % (s['vxk'], s['id']))
            continue
        tmp = p + '.source'
        try:
            export(s['work'], tmp)
        except RuntimeError as e:
            bad.append(s['vxk'])
            log.append('  ✗ %s：從 %s 匯出失敗：%s' % (s['vxk'], s['work'], str(e).strip().splitlines()[-1] if str(e).strip() else e))
            continue
        got, have = file_fp(tmp), file_fp(p)
        if want and not want.startswith('c:'):
            bad.append(s['vxk'])
            log.append('  ✗ %s：指紋還是舊格式（整個檔的 sha1，比不了重新匯出的）⇒ 先在有 _cache 的機器 build 一次（會換成內容指紋）再提交' % s['vxk'])
        elif want is None or got == want:
            if have == got:
                os.remove(tmp)
                log.append('  ✓ %s：作品 %s 跟指紋同一份，_cache 本來就是這份' % (s['vxk'], s['work']))
            else:
                os.replace(tmp, p)
                log.append('  ✓ %s：從作品 %s 重新匯出，%s ⇒ 放進 _cache' % (s['vxk'], s['work'], '跟指紋同一份' if want else '還沒有指紋（照這份登記）'))
                if want is None:
                    log.append(lock_put(s['vxk']))
        else:
            bad.append(s['vxk'])
            log.append('  ✗ %s：作品 %s 變過了 —— 指紋 %s、作品現在 %s ⇒ _cache 不動（新匯出的留在 %s.source）；要用作品現在這份 ⇒ python -I admin.py reimport --id %s'
                       % (s['vxk'], s['work'], want[:14], got[:14], s['vxk'], s['id']))
    if bad:
        raise Fail('\n'.join(log) + '\n✗ %d 艘跟指紋對不上：%s' % (len(bad), '、'.join(bad)))
    return log


def act_import(work, sid, name, build=True, variant_of=None):
    cfg = load()
    work, sid, name = (work or '').strip(), (sid or '').strip(), (name or '').strip()
    if not work:
        raise Fail('要給雕刻作品 ID')
    if any(s['id'] == sid for s in cfg['ships']):
        raise Fail('已經有代號 %s 的船 ⇒ 要換新版本用「重新匯入」' % sid)
    ship = {'id': sid, 'el': 'ship-' + sid.replace('_', '-'), 'name': name, 'vxk': sid + '.vxk', 'work': work}
    if variant_of:                                             # 改裝船（TASK-0657）：原船要已經在清單裡（validate 擋）
        ship['variant_of'] = variant_of.strip()
        base = next((x for x in cfg['ships'] if x['id'] == ship['variant_of']), None)
        if base:                                               # 船隻設定照原船開始（航速、動力、geo、船員配置…；名字、檔案、作者是自己的）
            for k, v in base.items():
                if k not in ('id', 'el', 'name', 'vxk', 'work', 'author', 'variant_of', 'names'):
                    ship[k] = json.loads(json.dumps(v))
    E = validate(dict(cfg, ships=cfg['ships'] + [ship]))
    if E:
        raise Fail('\n'.join('✗ ' + e for e in E))
    dest = os.path.join(CACHE, ship['vxk'])
    if os.path.exists(dest):
        raise Fail('_cache 已經有 %s（不是這份清單裡的船）⇒ 先搬走或換代號' % ship['vxk'])
    os.makedirs(CACHE, exist_ok=True)
    try:
        export(work, dest)
    except RuntimeError as e:
        raise Fail(str(e))
    info = vxk_info(dest)
    log = ['✓ 匯出 %s ← %s' % (ship['vxk'], work)] + ['  %s：%s' % (n, info.get(k)) for k, n in DIFF_KEYS] + [lock_put(ship['vxk'])]
    if info.get('owner'):                                # 建造者（Tim 2026-10-15）：.vxk 檔頭的 owner ＝ 雕刻作品的作者 ⇒ 船隻配置頁顯示
        ship['author'] = info['owner']
        log.append('  建造者：%s（.vxk 檔頭 owner）' % info['owner'])
    else:
        log.append('  ⚠ .vxk 檔頭沒有 owner ⇒ 不記建造者（船隻配置頁不顯示）')
    ref = vxk_info(os.path.join(CACHE, cfg['ships'][0]['vxk']))
    if ref and ref.get('meters_per_voxel') != info.get('meters_per_voxel'):
        log.append('⚠ 比例 %s 公尺／格，跟 %s 的 %s 不一樣 ⇒ 遊戲不會同時載這兩艘（模擬只吃同一個比例）' % (info.get('meters_per_voxel'), cfg['ships'][0]['name'], ref.get('meters_per_voxel')))
    cfg['ships'].append(ship)
    save(cfg)
    log.append('✓ 登記進船隻清單：%s（%s）—— 航速、靈活、船員照預設，要調到後台的船隻設定' % (name, sid))
    if build:
        log += act_build()
        log += act_ropebind([sid])                       # 繩端綁定（TASK-0716）：匯入時算好寫進檔頭、出報表
        log += act_shipcheck([sid])                      # 匯入檢查：缺 meta、砲班站不滿、開場就掉的（只讀）
    return log


def act_reimport(sid, work=None, build=True):
    cfg = load()
    s = next((x for x in cfg['ships'] if x['id'] == sid), None)
    if not s:
        raise Fail('沒有代號 %s 的船' % sid)
    dest = os.path.join(CACHE, s['vxk'])
    old = vxk_info(dest)
    work = (work or '').strip() or s.get('work') or (old or {}).get('work')
    if not work:
        raise Fail('不知道 %s 是哪件雕刻作品 ⇒ 帶 --work' % s['name'])
    os.makedirs(CACHE, exist_ok=True)
    tmp = dest + '.new'
    try:
        export(work, tmp)
    except RuntimeError as e:
        raise Fail(str(e))
    new = vxk_info(tmp)
    log = ['%s（%s）← %s　上一版 → 這一版：' % (s['name'], s['vxk'], work)] + vxk_diff(old, new)
    if old and old['sha256'] == new['sha256']:
        os.remove(tmp)
        log.append('＝ 檔案逐位元組相同 ⇒ 不換、不重建')
        return log
    if old:                                              # 差在哪：VoxelKit 的對拍（格子逐格逐色、header 逐欄；exported_at 不比）
        code, out = run([sys.executable, '-I', os.path.join(VKD, 'vxk_compare.py'), dest, tmp, '--max', '12'], cwd=VKD)
        log += ['  內容對拍（vxk_compare.py）：'] + ['    ' + l for l in out.strip().splitlines()[2:]] if code in (0, 1) else ['  ⚠ vxk_compare.py 跑不起來（exit %d）：%s' % (code, out.strip()[-300:])]
        if code == 0:                                    # 只差匯出時間 ⇒ 換了只會讓成品多一份 diff、戰局一位元都不變
            os.remove(tmp)
            log.append('＝ 內容相同（只差匯出時間）⇒ 不換、不重建')
            return log
        os.replace(dest, dest + '.prev')
    os.replace(tmp, dest)
    log.append('✓ 換上新的 .vxk（上一版留成 %s.prev）' % s['vxk'])
    log.append(lock_put(s['vxk']))
    dirty = False
    if s.get('work') != work:
        s['work'] = work
        dirty = True
    if new.get('owner') and s.get('author') != new['owner']:   # 建造者跟著 .vxk 檔頭的 owner 走（換了作者的作品、或以前匯入時還沒記）
        log.append('  建造者：%s → %s' % (s.get('author') or '（沒記）', new['owner']))
        s['author'] = new['owner']
        dirty = True
    if dirty:
        save(cfg)
    if build:
        log += act_build()
        log += act_ropebind([sid])                       # 繩端綁定（TASK-0716）：新的 .vxk 沒有 bind ⇒ 算好寫進去
        log += act_shipcheck([sid])                      # 匯入檢查（只讀）
    return log


def vxk_guns(path, guns):
    """這艘船各砲種幾門（後台的砲設定頁、船隻卡片用）：模型 meta kind=gun 的 gun 代號 ⇒ 砲種 key（跟遊戲 10_ship.js modelKind 同一套：不認得的代號當長砲）。
    沒有 meta 的舊模型照名字（carronade／chase／…/砲-S1）認。讀不到 ⇒ None。"""
    if not os.path.exists(path):
        return None
    try:
        h = vxk_header(open(path, 'rb').read())
    except Exception:
        return None
    code = {g.get('code'): k for k, g in guns.items()}
    out = {}
    for m in (h.get('rig') or {}).get('models') or []:
        mt, nm = m.get('meta') or {}, m.get('name') or ''
        if mt.get('kind') == 'gun':
            k = code.get(mt.get('gun'), 'long')
        elif mt.get('kind'):
            continue
        else:
            k = 'carr' if 'carronade' in nm else 'chase' if 'chase' in nm else 'long' if re.search(r'/砲-[SP]\d+$', nm) else None
        if k:
            out[k] = out.get(k, 0) + 1
    return out


# ── 零件表（TASK-0714；js/38_fit.js）：換裝要用的砲從哪一艘拿 ──
# 每一種砲（砲種表的鍵；弩砲這類 weapon 不收）× 砲架類別（meta mount；沒寫 ＝ carriage）一門：照 ships 的順序、模型的順序，第一門有 id、有固定點 breech 與 muzzle 的。
# 只記「哪一艘的哪一門」（⛔ 不把網格另存一份：船檔裡本來就有，22 種另存 ~120 KB ＝ 成品 +6%）；遊戲要用才載那艘的船檔。重匯拿掉了那一門 ⇒ check 會叫，重跑 parts。
FIT_KINDS = ('oar', 'rudder', 'propeller', 'wheel', 'wheel_stand', 'light', 'lantern', 'boat', 'capstan', 'binnacle', 'grating', 'deco', 'anchor', 'engine', 'boiler')   # js/38_fit.js FIT_KINDS（第二段：本來就是模型的零件；第四段 TASK-0793：錨、自帶格子的主機與鍋爐）


def fit_deco(mt):
    v = mt.get('deco')
    return v not in (None, '', 0, '0', False)


def parts_scan(cfg):
    G = cfg.get('guns') or {}
    code = {g.get('code'): k for k, g in G.items()}
    wpn = {g['weapon']: k for k, g in G.items() if g.get('weapon')}
    out, other, seen = {}, {}, {}
    for s in cfg['ships']:
        p = os.path.join(CACHE, s.get('vxk') or '')
        if not s.get('vxk') or not os.path.exists(p):
            continue
        h = vxk_header(open(p, 'rb').read())
        for m in (h.get('rig') or {}).get('models') or []:
            mt, pts = m.get('meta') or {}, m.get('points') or {}
            if mt.get('kind') != 'gun' or not mt.get('id') or 'muzzle' not in pts or 'breech' not in pts:
                continue
            t = wpn.get(mt.get('weapon')) or code.get(mt.get('gun'), 'long')
            if (G.get(t) or {}).get('weapon'):
                continue
            out.setdefault(t, {}).setdefault(str(mt.get('mount') or 'carriage'), '%s#%s' % (s['id'], mt['id']))
        M = (h.get('rig') or {}).get('meshes') or []
        for m in (h.get('rig') or {}).get('models') or []:          # 第二段：每一種 kind 不同長相的每一件（網格＋換色＋固定點名字一樣的只收第一件）
            mt = m.get('meta') or {}
            k = mt.get('kind') or ('deco' if fit_deco(mt) else '')
            if k not in FIT_KINDS or not mt.get('id') or (k == 'engine' and mt.get('engine') == 'organ'):   # 管風琴（魔法動力源）不當零件（js/38_fit.js fitOrgan）
                continue
            me = M[m['mesh']] if isinstance(m.get('mesh'), int) and m['mesh'] < len(M) else None
            if not me:
                continue
            sig = hashlib.sha1(json.dumps([me.get('verts'), me.get('tris'), m.get('mats') or me.get('mats'), sorted((m.get('points') or {}).keys())], separators=(',', ':')).encode()).hexdigest()
            if sig in seen.setdefault(k, set()):
                continue
            seen[k].add(sig)
            other.setdefault(k, {})['%s#%s' % (s['id'], mt['id'])] = '%s・%s' % (s.get('name', s['id']), m['name'].split('/')[-1])
    o = {'guns': {t: dict(sorted(v.items())) for t, v in sorted(out.items())}}
    for k in FIT_KINDS:
        if other.get(k):
            o[k] = other[k]
    return o


def act_parts(check=False):
    cfg = load()
    new, old = parts_scan(cfg), cfg.get('parts')
    G = cfg.get('guns') or {}
    lines = ['  %s（%s）：%s' % (t, (G.get(t) or {}).get('name', '?'), '、'.join('%s %s' % (c, r) for c, r in v.items())) for t, v in new['guns'].items()]
    lines += ['  %s：%d 件' % (k, len(new[k])) for k in FIT_KINDS if k in new]
    miss = [t for t, g in G.items() if not g.get('weapon') and t not in new['guns']]
    lines += ['  （船上都沒有、換不進來：%s）' % '、'.join(miss)] if miss else []
    if new == old:
        return ['✓ 零件表跟 _cache 對得上（%d 種砲）' % len(new['guns'])] + lines
    if check:
        raise Fail('\n'.join(['✗ 零件表 config parts 跟 _cache 對不上（重匯拿掉了、或多了一種砲）⇒ python -I admin.py parts'] + lines))
    cfg['parts'] = new
    save(cfg)
    return ['✓ 零件表寫進 config/game.json parts（%d 種砲；重建才吃得到）' % len(new['guns'])] + lines


def act_state():
    cfg = load()
    code, committed = run(['git', 'show', 'HEAD:./config/game.json'])
    infos = {}
    for s in cfg['ships']:
        p = os.path.join(CACHE, s['vxk'])
        infos[s['id']] = vxk_info(p)
        if infos[s['id']] is not None:
            infos[s['id']]['guns'] = vxk_guns(p, cfg.get('guns') or {})   # 各砲種幾門（後台的砲設定頁，TASK-0621）
    return {'config': cfg, 'committed': json.loads(committed) if code == 0 else None,
            'ships': infos,
            'built': os.path.getmtime(OUT) if os.path.exists(OUT) else None, 'saved': os.path.getmtime(CFG_P),
            'paths': {'config': CFG_P, 'out': OUT, 'cache': CACHE}}


def act_defaults(lim):
    """出廠預設值（Tim 2026-10-15：「用一樣的頁面去設定出廠預設值」）：遊戲的細節設定頁（/game?admin=defaults）送來 { 鍵: 值 } ⇒ 只改 lim[鍵] 的第三格（預設），上下限不動；照樣過 validate 才存。"""
    if not isinstance(lim, dict) or not lim:
        raise Fail('沒有要改的預設值')
    prev = load()
    new = json.loads(json.dumps(prev))
    L, log, bad = new.get('lim') or {}, [], []
    for k, v in lim.items():
        if k not in L or not isnum(v):
            bad.append(k)
            continue
        lo, hi, d = L[k][0], L[k][1], L[k][2]
        if not (lo <= v <= hi):
            bad.append('%s（%s 不在 %s～%s）' % (k, v, lo, hi))
            continue
        if v != d:
            L[k][2] = v
            log.append('  %s：%s → %s' % (k, d, v))
    if bad:
        raise Fail('這幾項不是滑桿的鍵或超出範圍，整批沒有存：' + '、'.join(bad))
    if not log:
        return ['（預設值都一樣，沒有存）']
    E = validate(new, prev)
    if E:
        raise Fail('設定不合法，沒有存：\n' + '\n'.join('  ✗ ' + e for e in E))
    save(new)
    return ['✓ 出廠預設改了 %d 項（config/game.json lim；重建之後遊戲才吃得到）：' % len(log)] + log


FURN_KEYS = ('tpm', 'crew', 'cap', 'hold', 'rate', 'doc', 'hp', 'buff.heal', 'staff.surgeon', 'staff.carpenter', 'staff.sailmaker', 'auto', 'autoDeck', 'wood', 'cloth', 'carry')            # 道具設定頁（js/67_furncfg.js FURN_ITEMS）調得到的那幾格
DRVP_KEYS = ('lo', 'hi', 'wet', 'cell', 'hpK')                                  # 同一頁的動力件（DRV_ITEMS ⇒ config drvparts）

# 問題回報的 Discord webhook（Tim 2026-10-18「那妳先把網址加密在填吧(工具直接填加密後的)」）：game.json 只存 x1:<base64url>，遊戲（js/01_gl.js hookDec）解開。
#   ⚠ 是混淆、不是加密：遊戲自己要解得開 ⇒ 鑰匙跟著成品公開。擋的是掃 repo 找 webhook 的機器人與順手一瞥，擋不住有心翻程式的人。
#   x1 ＝ UTF-8 位元組逐位 XOR HOOK_KEY（循環）再 base64url（不補 =）。鑰匙兩處：這裡、js/01_gl.js HOOK_KEY（⛔ 改一邊另一邊解不開 ⇒ 遊戲沒有「送出回報」）。
HOOK_KEY = b'Blockside/report/x1'
HOOK_RE = re.compile(r'^https://(discord|discordapp)\.com/api/webhooks/\d+/[A-Za-z0-9_-]+$')


def hook_enc(url):
    b = url.encode('utf-8')
    return 'x1:' + base64.urlsafe_b64encode(bytes(c ^ HOOK_KEY[i % len(HOOK_KEY)] for i, c in enumerate(b))).decode('ascii').rstrip('=')


def hook_dec(s):
    try:
        t = s[3:]
        b = base64.urlsafe_b64decode(t + '=' * (-len(t) % 4))
        return bytes(c ^ HOOK_KEY[i % len(HOOK_KEY)] for i, c in enumerate(b)).decode('utf-8')
    except Exception:
        return ''


def act_keys(keys):
    """鍵位的出廠預設值（Tim 2026-10-17：「不是後台 而是遊戲中(後台可以設定預設值)」）：遊戲的鍵位設定頁（/game?admin=keys，js/66_keys.js）送來 { 動作: 鍵 }
    ⇒ 蓋進 config/game.json 的 keys（沒有就建）；照樣過 validate 才存。同一個模式撞鍵由遊戲那頁先對調好（這裡不知道動作屬於哪個模式）。"""
    if not isinstance(keys, dict) or not keys:
        raise Fail('沒有要改的鍵')
    prev = load()
    new = json.loads(json.dumps(prev))
    K, log = new.get('keys') or {}, []
    for a, k in keys.items():
        if not isinstance(a, str) or not isinstance(k, str):
            raise Fail('格式不對：' + repr(a))
        if K.get(a) != k:
            log.append('  %s：%s → %s' % (a, json.dumps(K.get(a), ensure_ascii=False), json.dumps(k, ensure_ascii=False)))
            K[a] = k
    if not log:
        return ['（鍵位的預設都一樣，沒有存）']
    new['keys'] = K
    E = validate(new, prev)
    if E:
        raise Fail('設定不合法，沒有存：\n' + '\n'.join('  ✗ ' + e for e in E))
    save(new)
    return ['✓ 鍵位的出廠預設改了 %d 個（config/game.json keys；重建之後遊戲才吃得到）：' % len(log)] + log


def act_furniture(furn, drv=None):
    """道具的出廠預設值（Tim 2026-10-16：「一樣是開發後台調預設 玩家後台套同一個UI」）：遊戲的道具設定頁（/game?admin=furn）送來 { 道具: { 鍵: 值 } }
    ⇒ 改 furniture[道具][鍵]（buff.heal ＝ furniture[道具].buff.heal）；只認 FURN_KEYS、而且那一種本來就有那一格；照樣過 validate 才存。
    drv ＝ 同一頁的動力件 { 種類: { 鍵: 值 } } ⇒ 改 drvparts[種類][鍵]（只認 DRVP_KEYS、那一種本來就有那一格）。"""
    furn, drv = furn or {}, drv or {}
    if not isinstance(furn, dict) or not isinstance(drv, dict) or not (furn or drv):
        raise Fail('沒有要改的道具')
    prev = load()
    new = json.loads(json.dumps(prev))
    FU, log, bad = new.get('furniture') or {}, [], []
    DP = new.get('drvparts') or {}
    for kd, kv in drv.items():
        if kd not in DP or not isinstance(kv, dict):
            bad.append('drv:' + str(kd))
            continue
        for k, v in kv.items():
            if k not in DRVP_KEYS or k not in DP[kd] or not isnum(v) or v < 0:
                bad.append('drv:%s.%s' % (kd, k))
                continue
            if DP[kd][k] != v:
                log.append('  %s（%s，動力件）%s：%s → %s' % (kd, DP[kd].get('name', ''), k, DP[kd][k], v))
                DP[kd][k] = v
    for fid, kv in furn.items():
        if fid not in FU or not isinstance(kv, dict):
            bad.append(str(fid))
            continue
        for k, v in kv.items():
            path = k.split('.')
            box = FU[fid].get(path[0]) if len(path) > 1 else FU[fid]
            leaf = path[-1]
            if k not in FURN_KEYS or not isinstance(box, dict) or leaf not in box or not isnum(v) or v < 0:
                bad.append('%s.%s' % (fid, k))
                continue
            if box[leaf] != v:
                log.append('  %s（%s）%s：%s → %s' % (fid, FU[fid].get('name', ''), k, box[leaf], v))
                box[leaf] = v
    if bad:
        raise Fail('這幾項不是道具設定調得到的格，整批沒有存：' + '、'.join(bad))
    if not log:
        return ['（道具的預設都一樣，沒有存）']
    E = validate(new, prev)
    if E:
        raise Fail('設定不合法，沒有存：\n' + '\n'.join('  ✗ ' + e for e in E))
    save(new)
    return ['✓ 道具的出廠預設改了 %d 項（config/game.json furniture、drvparts；重建之後遊戲才吃得到）：' % len(log)] + log


def act_hook(url):
    """admin.py hook：明文網址（標準輸入）⇒ x1:… 寫進 config/game.json 的 report.webhook —— 只換那一格的字（其他排版不動）；照樣過 validate。印出來的只有解開後的 id 與 token 長度。"""
    url = (url or '').strip()
    if url and not HOOK_RE.match(url):
        raise Fail('不是 Discord webhook 網址（https://discord.com/api/webhooks/<id>/<token>），沒有存')
    enc = hook_enc(url) if url else ''
    if url and hook_dec(enc) != url:
        raise Fail('加密後解不回原文（HOOK_KEY 壞了？），沒有存')
    text = open(CFG_P, encoding='utf-8').read()
    rx = re.compile(r'("report"\s*:\s*\{[^{}]*?"webhook"\s*:\s*)"[^"]*"')
    if not rx.search(text):
        raise Fail('config/game.json 找不到 report.webhook 那一格（先在設定後台存一次「問題回報」）')
    new_text = rx.sub(lambda m: m.group(1) + json.dumps(enc), text, count=1)
    new = json.loads(new_text)
    E = validate(new, load())
    if E:
        raise Fail('設定不合法，沒有存：\n' + '\n'.join('  ✗ ' + e for e in E))
    with open(CFG_P, 'w', encoding='utf-8', newline='') as f:
        f.write(new_text)
    if not url:
        return ['✓ 清掉了 report.webhook（遊戲不再有「送出回報」；重建之後生效）']
    hid = url.rstrip('/').split('/')[-2]
    return ['✓ report.webhook ＝ 加密後的網址（webhook id %s、token %d 字；解開驗過 ＝ 原文）—— 重建之後遊戲才有「送出回報」' % (hid, len(url.rsplit('/', 1)[1]))]


def act_save(new):
    prev = load()
    RP = new.get('report') if isinstance(new, dict) else None
    if isinstance(RP, dict) and isinstance(RP.get('webhook'), str) and HOOK_RE.match(RP['webhook'].strip()):
        RP['webhook'] = hook_enc(RP['webhook'].strip())    # 設定後台貼的明文 ⇒ 存成 x1:…（見 hook_enc）；明文不落地
    E = validate(new, prev)
    if E:
        raise Fail('設定不合法，沒有存：\n' + '\n'.join('  ✗ ' + e for e in E))
    save(new)
    return ['✓ 存了 config/game.json（重建之後遊戲才吃得到）']


# ───────────────────────── 本機後台 ─────────────────────────
class Exclusive(HTTPServer):
    """埠被佔就綁不上。⛔ HTTPServer 預設開 SO_REUSEADDR：Windows 上那是「可以搶別人正在聽的埠」⇒ 第二次雙擊捷徑會再開一個、兩個一起聽（量過）。"""
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def serve(port, do_open=False):
    hosts = {'127.0.0.1:%d' % port, 'localhost:%d' % port}

    class H(BaseHTTPRequestHandler):
        timeout = 10                                 # 一次只服務一個連線（Exclusive）⇒ 瀏覽器預先開好、不送請求的連線（Chrome preconnect）會把整個後台卡住；閒置 10 秒就放掉

        def log_message(self, fmt, *a):
            sys.stderr.write('  %s %s\n' % (self.command, self.path))

        def send(self, code, body, ctype='application/json; charset=utf-8'):
            b = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(b)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(b)

        def guard(self, write):
            # 只認本機、寫入要帶自訂標頭（別的網頁的表單送不出它；跨來源的 fetch 會先問 OPTIONS，這裡不答）
            if self.headers.get('Host') not in hosts:
                self.send(403, {'ok': False, 'log': ['只接受 127.0.0.1／localhost']})
                return False
            if write and self.headers.get('X-Admin') != '1':
                self.send(403, {'ok': False, 'log': ['缺 X-Admin 標頭']})
                return False
            return True

        def body(self):
            n = int(self.headers.get('Content-Length') or 0)
            return json.loads(self.rfile.read(n).decode('utf-8') or '{}')

        def do_GET(self):
            if not self.guard(False):
                return
            if self.path == '/favicon.ico':
                return self.send(204, b'', 'image/x-icon')
            path = self.path.split('?')[0]
            if path in ('/', '/index.html'):
                return self.send(200, open(PAGE, 'rb').read(), 'text/html; charset=utf-8')
            if path == '/game':                      # 後台嵌的甲板與艙房編輯器（成品 ?admin=rooms；要船型的格子 ⇒ 用建好的成品）；出廠預設值（?admin=defaults：細節設定頁）
                if not os.path.exists(OUT):
                    return self.send(404, {'ok': False, 'log': ['還沒建置成品']})
                return self.send(200, open(OUT, 'rb').read(), 'text/html; charset=utf-8')
            if path.startswith('/ships/') and SHIP_NAME_RX.match(path[7:]):    # 拆檔的成品：/game 那一頁照相對路徑要的船檔
                p = os.path.join(ROOT, 'ships', path[7:])
                if os.path.isfile(p):
                    return self.send(200, open(p, 'rb').read(), 'text/javascript; charset=utf-8')
            if self.path == '/api/state':
                return self.send(200, dict(act_state(), ok=True))
            self.send(404, {'ok': False, 'log': ['沒有這一頁']})

        def do_PUT(self):
            self.do_POST()

        def do_POST(self):
            if not self.guard(True):
                return
            try:
                b = self.body()
                if self.path == '/api/config':
                    log = act_save(b.get('config'))
                elif self.path == '/api/defaults':
                    log = act_defaults(b.get('lim'))
                elif self.path == '/api/keys':
                    log = act_keys(b.get('keys'))
                elif self.path == '/api/furniture':
                    log = act_furniture(b.get('furn'), b.get('drv'))
                elif self.path == '/api/build':
                    log = act_build()
                elif self.path == '/api/import':
                    log = act_import(b.get('work'), b.get('id'), b.get('name'))
                elif self.path == '/api/reimport':
                    log = act_reimport(b.get('id'), b.get('work'))
                elif self.path == '/api/cache':
                    log = act_cache()
                else:
                    return self.send(404, {'ok': False, 'log': ['沒有這個動作']})
                self.send(200, {'ok': True, 'log': log})
            except Fail as e:
                self.send(400, {'ok': False, 'log': [str(e)]})
            except Exception as e:                       # 工具本身的錯：原樣回報，伺服器不停
                self.send(500, {'ok': False, 'log': ['%s: %s' % (type(e).__name__, e)]})

    url = 'http://127.0.0.1:%d/' % port
    try:
        srv = Exclusive(('127.0.0.1', port), H)         # 一次一個請求 ⇒ 存檔、建置、匯入不會同時寫
    except OSError:
        # 埠被佔：是已經開著的設定後台 ⇒ 只開頁面（雙擊捷徑兩次不會報錯）；是別的程式 ⇒ 說清楚、換埠
        try:
            with urllib.request.urlopen(url + 'api/state', timeout=5) as r:
                mine = json.loads(r.read().decode('utf-8')).get('ok') is True
        except Exception:
            mine = False
        if not mine:
            raise Fail('埠 %d 被別的程式佔了 ⇒ 帶 --port <別的埠>' % port)
        print('設定後台已經開著：%s' % url, flush=True)
        if do_open:
            webbrowser.open(url)
        return
    print('設定後台：%s　（Ctrl+C 或關掉這個視窗就結束；只聽本機）' % url, flush=True)
    if do_open:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser(description='《憲法號對轟》設定後台（TASK-0542）')
    sp = ap.add_subparsers(dest='op', required=True)
    sp.add_parser('check')
    s = sp.add_parser('metaspec', help='meta 規格表（config/meta_kinds.json）對拍：規格表本身、每艘船用到的 kind、造船規格文件（TASK-0672）')
    s.add_argument('--doc', help='造船規格的檔案（不給 ⇒ senate cmd doc 讀）')
    s = sp.add_parser('shipcheck', help='匯入檢查：缺 meta、砲班站不滿、開場就掉的 ⇒ reports/shipcheck_<船>.md（import／reimport／metasync 之後會自動跑）')
    s.add_argument('--id', action='append', help='哪一艘（可以給好幾次）；不給 ＝ 每一艘')
    s = sp.add_parser('build')
    s.add_argument('--raw', action='store_true', help='原格式（不壓縮、船內嵌）；預設是壓縮版：每艘船的模型網格收成它自己的池子（同一份只存一次、頂點去重＋差值），_cache 不動')
    s.add_argument('--single', action='store_true', help='壓縮版但不拆檔：船照舊內嵌在 index.html（一個檔；封存、要單一檔案的地方用）。預設拆成入口＋ships/')
    s.add_argument('--code', action='store_true', help='只重建程式：入口 index.html 照工作區的來源重建、船檔 ships/ 照舊 —— 沒有 VoxelKit/_cache 的機器用；船變了、或照同一條路重做不出現在的成品 ⇒ 擋下')
    s.add_argument('--base', help='--code：成品是照哪一版建的（不給 ⇒ HEAD，合併中再試 MERGE_HEAD）')
    s = sp.add_parser('shell', help='外掛外殼：拿建好的成品（入口；船檔共用）套別的遊戲的外殼（標題、樣式、掛鉤）寫成另一頁 —— 例 Blocksail 的 battle.html；格式見 admin.py「外掛外殼」')
    s.add_argument('cfg', help='外殼設定（JSON；裡面的路徑相對於它）')
    s.add_argument('--check', action='store_true', help='只比：那一頁是不是照現在的成品與外殼做的（舊了 ⇒ exit 1）')
    sp.add_parser('reseg', help='船檔照現在的切法重切（不用 _cache：從船檔自己解回原文重切、解回來逐位元組相同才寫、換入口清單上的雜湊）—— 只有 ship_segments 的切法改了才要')
    s = sp.add_parser('snapshot', help='某一版的成品（入口＋它清單上的船檔）取出到一個資料夾：拆檔之後 git show <版本>:index.html 只拿得到入口（對拍的對照組用這個）')
    s.add_argument('rev', help='commit、分支名')
    s.add_argument('to', help='資料夾（會寫 index.html、ships/）')
    sp.add_parser('verify', help='成品跟 _cache 原檔比（壓縮版照遊戲的讀法還原）')
    s = sp.add_parser('srccheck', help='成品跟來源對不對得上（TASK-0674）：成品裡的來源清單 vs 照工作區／暫存區／某一版重算')
    g = s.add_mutually_exclusive_group()
    g.add_argument('--staged', action='store_true', help='比暫存區（要提交的那一份）')
    g.add_argument('--rev', help='比某一版（commit、分支名都可以）')
    s.add_argument('--hook', choices=['pre-commit', 'pre-push'], help='git 鉤子用（.githooks/ 裡的兩支）')
    s = sp.add_parser('layers', help='模擬層（20–54 號檔）直接用到上層的名字（TASK-0669；node 照作用域判）')
    s.add_argument('--src', help='另一份 src 目錄（量別的版本）')
    s.add_argument('--shell', action='store_true', help='改量核心直接用到外殼（主選單、設定頁；SHELL_UI）的名字、直接碰 #cover 裡的 DOM')
    sp.add_parser('hooks', help='裝提交前／推送前的成品檢查：git config core.hooksPath .githooks（這個 repo 的每個 worktree 共用）')
    s = sp.add_parser('cache', help='_cache 缺的 .vxk 從雕刻作品重新匯出、跟指紋比；--all 每艘都比（比對來源）')
    s.add_argument('--all', action='store_true')
    sp.add_parser('fmt')
    s = sp.add_parser('serve')
    s.add_argument('--port', type=int, default=8642)
    s.add_argument('--open', action='store_true', help='開好之後用預設瀏覽器打開後台頁')
    s = sp.add_parser('import')
    s.add_argument('--work', required=True)
    s.add_argument('--id', required=True)
    s.add_argument('--name', required=True)
    s.add_argument('--variant-of', help='改裝船：原船的代號（TASK-0657；成品裡格子存成跟原船的差，原船要先匯入）')
    s.add_argument('--no-build', action='store_true')
    s = sp.add_parser('metasync', help='只同步 meta 與固定點（格子不動）')
    s.add_argument('--id', required=True)
    s.add_argument('--no-build', action='store_true')
    s = sp.add_parser('cells', help='只寫動力件與梯子的格子清單（parts[].cellRuns；meta、格子不動）')
    s.add_argument('--id', required=True)
    s.add_argument('--no-build', action='store_true')
    s = sp.add_parser('ids', help='物件 id（TASK-0715；造船規格 §12）：每件關聯、模型發一個 <類別>-<序號>、指名別的部件的 meta 換成 id、寫回雕刻作品，再 metasync')
    s.add_argument('--id', action='append', required=True, help='哪一艘（可以給好幾次；改裝船排在原船後面）')
    s.add_argument('--dry', action='store_true', help='只列要發的號與要換的關聯，一筆都不寫')
    s.add_argument('--no-build', action='store_true')
    s = sp.add_parser('ropebind', help='繩端綁定（TASK-0716）：先建置、跑成品算每條繩兩端綁在哪寫進 .vxk 檔頭（遊戲照它、不猜）、出 reports/ropebind_<船>.md；檔頭變了再建置')
    s.add_argument('--id', action='append', help='哪一艘（可以給好幾次）；不給 ＝ 每一艘')
    s = sp.add_parser('relock', help='指紋改成 _cache 現在那份')
    s.add_argument('--id', required=True)
    s = sp.add_parser('parts', help='零件表（TASK-0714）：換裝用的砲從哪一艘拿（每一種砲 × 砲架類別一門），照 _cache 寫進 config/game.json parts；--check 只比')
    s.add_argument('--check', action='store_true')
    sp.add_parser('authors', help='建造者：每艘船照 _cache 那份 .vxk 檔頭的 owner 記 ships[].author（補以前匯入的船；不重建）')
    s = sp.add_parser('reimport')
    s.add_argument('--id', required=True)
    s.add_argument('--work')
    s.add_argument('--no-build', action='store_true')
    sp.add_parser('hook', help='問題回報的 Discord webhook：從標準輸入讀明文網址（貼上、Enter；⛔ 不收參數 ⇒ 不留在指令歷史）⇒ 加密成 x1:… 寫進 config/game.json report.webhook（只換那一格）；空白一行 ＝ 清掉')
    o = ap.parse_args()
    try:
        if o.op == 'serve':
            return serve(o.port, o.open)
        if o.op == 'check':
            log = act_check()
        elif o.op == 'metaspec':
            log = act_metaspec(o.doc)
        elif o.op == 'shipcheck':
            log = act_shipcheck(o.id)
        elif o.op == 'build':
            if o.code and (o.raw or o.single):
                raise Fail('--code 不能跟 --raw、--single 一起用（--code 只換拆檔成品的入口）')
            if o.base and not o.code:
                raise Fail('--base 只給 --code 用')
            log = act_build_code(o.base) if o.code else act_build(not o.raw, o.single)
        elif o.op == 'reseg':
            log = act_reseg()
        elif o.op == 'shell':
            log = act_shell(o.cfg, o.check)
        elif o.op == 'snapshot':
            log = act_snapshot(o.rev, o.to)
        elif o.op == 'verify':
            log = act_verify()
        elif o.op == 'srccheck':
            log = act_srccheck(o.staged or o.hook == 'pre-commit', o.rev, o.hook)
        elif o.op == 'hooks':
            log = act_hooks()
        elif o.op == 'layers':
            log = act_shell_layers(o.src) if o.shell else act_layers(o.src)
        elif o.op == 'cache':
            log = act_cache(o.all)
        elif o.op == 'fmt':
            cfg = load()
            E = validate(cfg)
            if E:
                raise Fail('設定不合法：\n' + '\n'.join('  ✗ ' + e for e in E))
            save(cfg)
            log = ['✓ 重新排版 config/game.json']
        elif o.op == 'relock':
            log = act_relock(o.id)
        elif o.op == 'authors':
            log = act_authors()
        elif o.op == 'parts':
            log = act_parts(o.check)
        elif o.op == 'metasync':
            log = act_metasync(o.id, not o.no_build)
        elif o.op == 'ids':
            log = []
            for i in o.id:
                log += act_ids(i, o.dry, not o.no_build and i == o.id[-1])
        elif o.op == 'ropebind':
            log = act_build() + act_ropebind(o.id)
        elif o.op == 'cells':
            log = act_cells(o.id, not o.no_build)
        elif o.op == 'import':
            log = act_import(o.work, o.id, o.name, not o.no_build, o.variant_of)
        elif o.op == 'hook':
            if sys.stdin.isatty():
                print('貼上 Discord webhook 網址後按 Enter（空白 ＝ 清掉）：', end='', flush=True)
            log = act_hook(sys.stdin.readline())
        else:
            log = act_reimport(o.id, o.work, not o.no_build)
    except Fail as e:
        print(str(e))
        sys.exit(1)
    print('\n'.join(log))


if __name__ == '__main__':
    main()
