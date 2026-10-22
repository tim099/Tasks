# 區塊職責：開發用的 HTML（外部 <script src>＋<script type="application/x-vxk" src>）⇒ 單檔成品（全部內嵌）。
# 物理意義：畫廊展品必須零外部依賴（離線、CDN 掛掉、sandbox iframe 都是靜默失敗）——
#           開發時分檔好改，出貨前由這支一次塞進去；塞完自己檢查一遍。
# 失敗處置：找不到被引用的檔、成品裡還有外部 src／fetch／import／http(s) 資源 ⇒ 非零結束、不寫輸出檔。
#
# 用法：python -I vxk_inline.py <開發用.html> <成品.html>
#   · <script src="相對路徑.js"></script>                          ⇒ 內嵌 JS
#   · <script src="相對路徑.js" data-bundle="名字"></script>（可以很多個）
#       ⇒ 同一個名字的照出現順序接成一段、包進同一個閉包 (function () { 'use strict'; … })()，放在第一個的位置
#         ⇒ 開發時照功能分檔，執行起來仍是同一個作用域（共用變數與函式；不掛到 window）
#   · <script type="application/x-vxk" id="X" src="相對路徑.vxk"></script> ⇒ 內嵌 base64（voxelkit.js 的 VoxelKit.loadEmbedded('X') 讀）
#   · <script type="application/x-asset" id="X" src="相對路徑.png|.json" [data-optional="1"]></script>
#       ⇒ 內嵌 base64＋data-mime（VoxelKit.embeddedImage／embeddedJSON 讀）；optional 的檔不存在 ⇒ 留一個空的 tag（展品用替代品），不擋
import base64, os, re, sys

JS_RE = re.compile(r'<script\s+src="([^"]+)"\s*>\s*</script>')
BUNDLE_RE = re.compile(r'<script\s+src="([^"]+)"\s+data-bundle="([^"]+)"\s*>\s*</script>\n?')
ASSET_RE = re.compile(r'<script\s+type="application/x-asset"\s+id="([^"]+)"\s+src="([^"]+)"(\s+data-optional="1")?\s*>\s*</script>')
MIME = {'.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.json': 'application/json'}
VXK_RE = re.compile(r'<script\s+type="application/x-vxk"\s+id="([^"]+)"\s+src="([^"]+)"\s*>\s*</script>')
BAD = [(re.compile(r'<script[^>]*\ssrc\s*='), '外部 <script src>'),
       (re.compile(r'\bfetch\s*\('), 'fetch('),
       (re.compile(r'\bimport\s*\(|^\s*import\s', re.M), 'import'),
       (re.compile(r'(?:src|href)\s*=\s*["\']?https?:', re.I), '外部 http(s) 資源'),
       (re.compile(r'<link[^>]+rel=["\']?stylesheet', re.I), '外部樣式表')]


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    if len(sys.argv) != 3:
        sys.exit('用法：python -I vxk_inline.py <開發用.html> <成品.html>')
    src, out = sys.argv[1], sys.argv[2]
    base = os.path.dirname(os.path.abspath(src))
    html = open(src, encoding='utf-8').read()
    report = []

    def read(rel, mode='r'):
        p = os.path.normpath(os.path.join(base, rel))
        if not os.path.exists(p):
            sys.exit('✗ 找不到 %s（%s）' % (rel, p))
        return open(p, 'rb').read() if mode == 'rb' else open(p, encoding='utf-8').read()

    def vxk(m):
        b = read(m.group(2), 'rb')
        report.append('  .vxk  #%s ← %s（%.2f MB → base64 %.2f MB）' % (m.group(1), m.group(2), len(b) / 1e6, len(b) * 4 / 3 / 1e6))
        return '<script type="application/x-vxk" id="%s">%s</script>' % (m.group(1), base64.b64encode(b).decode('ascii'))

    def js(m):
        t = read(m.group(1))
        report.append('  JS    ← %s（%d 行）' % (m.group(1), t.count('\n') + 1))
        return '<script>\n' + t.replace('</script', '<\\/script') + '\n</script>'

    def asset(m):
        p = os.path.normpath(os.path.join(base, m.group(2)))
        mime = MIME.get(os.path.splitext(p)[1].lower())
        if not mime:
            sys.exit('✗ 不認得的素材格式：%s（%s）' % (m.group(2), '、'.join(MIME)))
        if not os.path.exists(p):
            if m.group(3):
                report.append('  素材  #%s ← %s（不存在，optional ⇒ 展品用替代品）' % (m.group(1), m.group(2)))
                return '<script type="application/x-asset" id="%s" data-mime="%s"></script>' % (m.group(1), mime)
            sys.exit('✗ 找不到 %s（%s）' % (m.group(2), p))
        b = open(p, 'rb').read()
        if mime == 'application/json':   # 文字素材照 LF 內嵌（TASK-0674）：git checkout 寫 CRLF、admin.py 存檔寫 LF ⇒ 同一份設定建出兩種成品
            b = b.replace(b'\r\n', b'\n')
        report.append('  素材  #%s ← %s（%.1f KB）' % (m.group(1), m.group(2), len(b) / 1e3))
        return '<script type="application/x-asset" id="%s" data-mime="%s">%s</script>' % (m.group(1), mime, base64.b64encode(b).decode('ascii'))

    # bundle：同名的檔接成一段（照出現順序）、包進同一個閉包，放在第一個的位置；其餘的 tag 拿掉
    bundles, seen = {}, set()
    for m in BUNDLE_RE.finditer(html):
        bundles.setdefault(m.group(2), []).append(m.group(1))

    def bundle(m):
        name = m.group(2)
        if name in seen:
            return ''
        seen.add(name)
        parts = []
        for rel in bundles[name]:
            t = read(rel)
            report.append('  JS    ← %s（%d 行，bundle %s）' % (rel, t.count('\n') + 1, name))
            parts.append('// ── %s ──\n%s' % (rel, t.replace('\r\n', '\n').rstrip('\n')))
        body = '\n'.join(parts).replace('</script', '<\\/script')
        return "<script>\n(function () {\n'use strict';\n" + body + '\n})();\n</script>\n'

    html = VXK_RE.sub(vxk, html)
    html = ASSET_RE.sub(asset, html)
    html = BUNDLE_RE.sub(bundle, html)
    html = JS_RE.sub(js, html)
    # 檢查（base64 區塊不參與比對：它只含 A–Z a–z 0–9 + / =，但太長，拿掉再查比較快）
    probe = re.sub(r'<script type="application/x-(?:vxk|asset)" id="[^"]+"[^>]*>[^<]*</script>', '', html)
    bad = [name for rx, name in BAD if rx.search(probe)]
    if bad:
        sys.exit('✗ 成品還有外部依賴：' + '、'.join(bad) + '（未寫入）')
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)
    print('✓ %s → %s（%.2f MB）' % (src, out, os.path.getsize(out) / 1e6))
    print('\n'.join(report))
    print('  零外部依賴：沒有外部 src／fetch／import／http(s) 資源 ✓')


if __name__ == '__main__':
    main()
