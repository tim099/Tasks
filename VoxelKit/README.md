# VoxelKit —— 雕刻作品進 HTML 展品

把一件雕刻作品（含關聯、繩、帆）變成可以內嵌在單一 HTML 裡、瀏覽器能畫也能改的格子。這一份是 2026-10-15 從 ArtGallery/VoxelKit（853b4e7）複製給 Blockside 用的；ArtGallery 的影片（`HtmlVideos/`）用的是那邊那一份。

| 檔 | 做什麼 |
|---|---|
| **`senate cmd sculpture op=export format=vxk`** | ⭐ 作品 → `.vxk` 的**主要生產端**（TASK-0518）：senate 直接封，`include=rig,models,parts,meta` 對應下面 Python 的四個旗標；一次讀完、不經過 list／obj 檔 ⇒ 沒有「兩次匯出之間作品被改過」的洞。寫檔前同樣回讀對拍。規則見 Senate `Docs/Workflows/Sculpture.md` §9.4.10。 |
| `voxel_export.py` | 作品 → `.vxk`（舊的生產端，**留著當對拍**）：`senate cmd sculpture` 匯出 `format=list`（每一格）；`--rig` 再從 `format=obj` 拿繩與帆；`--models` 連模型匯入的子模型（三角形網格）；`--parts` 記各條關聯的外框。寫檔前把封裝回讀、跟匯出清單逐格比對，對不上就不寫。 |
| `vxk_compare.py` | 兩份 `.vxk` 對拍（解開之後比：格子逐格逐色、header 逐欄；浮點那幾格給容差；不比壓縮後的位元組與 exported_at）。`--tamper` ＝ 反向對照（改一格再比，一定要報不同）。 |
| `voxelkit.js` | 瀏覽器端（全域 `VoxelKit`）：解碼、稀疏網格、網格化、WebGL2 算繪、射線、連通。零外部依賴。 |
| `vxk_inline.py` | 開發用 HTML → 單檔成品：把 `<script src>`、`.vxk` 與素材（`x-asset`：png／webp／jpg／json）塞進去，再檢查成品沒有外部 src／fetch／import／http(s) 資源。 |
| `_cache/` | 匯出的暫存與 `.vxk`（不入版控；用 `voxel_export.py` 重產）。 |

```bash
senate cmd sculpture --arg op=export --arg format=vxk --arg work=<作品> --arg out=<絕對路徑>/_cache/<名>.vxk [--arg include=rig,models,parts,meta] [--arg links=all|none]
python -I voxel_export.py --work <作品> --out _cache/<名>.vxk [--rig [--models]] [--parts] [--meta] [--links all|none] [--list <既有匯出清單>] [--senate <exe>]   # 對拍用
python -I vxk_compare.py _cache/<a>.vxk _cache/<b>.vxk [--tamper]
python -I vxk_inline.py <開發用.html> <成品.html>
```

- 對拍實測（憲法號組裝件、2026-10-12）：兩個生產端的 vxk_compare 相同，而且**每一個數都相等**（不是只在容差內）；兩份都過 voxelkit.js 的 `verify`。⚠ 唯一刻意不同：senate 那支的繩／帆／模型也照 `links=` 選（Python 的 obj 那一趟沒帶 links）。

- ⚠ `--list` 只省掉格子那一次匯出；繩、帆、模型、外框照樣即時讀作品 ⇒ 作品在兩次之間改過（別人還在造）就會對不起來。出貨前不帶 `--list` 整份重匯。

開發用 HTML 裡的寫法：

```html
<script src="../../../VoxelKit/voxelkit.js"></script>
<script type="application/x-vxk" id="ship" src="../../../VoxelKit/_cache/constitution.vxk"></script>
<script type="application/x-asset" id="art-crew" src="art/crew.png" data-optional="1"></script>
```

`data-optional="1"` 的素材檔不存在 ⇒ 成品留一個空的 tag，展品用替代品（⛔ 不擋建置）；沒有 optional 的找不到就擋。

## `.vxk` 格式

deflate-raw 壓過的一段位元組：

```text
'VXK1' ＋ uint32 header 長度 ＋ header（UTF-8 JSON）
＋ 非空 16³ 區塊的座標 nchunks × (uint16 cx, cy, cz)
＋ 區塊內容      nchunks × 4096 bytes（索引 x + 16y + 256z；0 ＝ 空，其餘 ＝ 色值）
```

- **1:1**：每一格照原座標、原色值，⛔ 不降採樣。色值 0 被當成「空」⇒ 有 0 號色的作品匯出時會被擋下。
- **header**：`work`、`size`、`bbox`、`meters_per_voxel`、`voxels`、`checksum`、`colors`、`source`（每條關聯的版本）；`--parts` 加 `parts`（路徑、來源作品、box、mirror）；`--rig` 加 `rig.ropes`（中線點）與 `rig.sails`（三角形）。
- **meta 與固定點**（`--meta`，TASK-0517；要 senate 有 `export format=parts`）：`parts[]` 每條關聯、`rig.models[]` 每個模型多兩欄 —— `meta`（作者貼的平的 `{鍵: 字串或數字}`，例 `kind=gun`、`gun=24l`、`powder_lb=9000`）與 `points`（來源作品的固定點換到本作品座標 `{名字: [x,y,z]}`，格心）；header 多 `points`（本作品自己的固定點）。砲軸 ＝ `points.muzzle − points.breech`、彈藥庫爆心 ＝ `points.blast`。部件清單裡找不到某條關聯／某個模型、或某個部件的固定點讀不了 ⇒ 停下（⛔ 不靜默少一筆）。不帶 `--meta` ⇒ header 跟以前逐欄一樣。`--senate` 指定 senate 執行檔（測新建置用；預設 PATH 上的）。
- **帆與繩的 meta、繩的兩端**（TASK-0539，只有 senate 那支產）：`include=meta` ⇒ `rig.sails[]`、`rig.ropes[]` **有 meta 才**多一個 `meta`（例 帆 `{kind:'sail', mast:'fore', sail:'topsail'}`、旗 `{kind:'flag', flag:'ensign'}`、繩 `{kind:'sheet', sail:'fore-topsail'}`；鍵的定義在 Senate `Docs/Workflows/Sculpture_Shipbuilding.md` §9.1）⇒ 沒標的作品逐欄照舊；`include=ends`（配 rig）⇒ 每條繩多 `frame`（繩所在那一層的關聯路徑，組裝件自己 ＝ ""）與 `ends`（兩端原樣的參照，相對於 frame）。⚠ `voxel_export.py` 不產這兩段 ⇒ 跟 senate 那支對拍會不同。
- **模型**（`--models`）：`rig.meshes[]`（`verts` 相對於外框最小角、`tris`、每個三角形的材質 `tmat` → `mats` 的 RGB）與 `rig.models[]`（`name`、`mesh`、`origin` ＝ 外框最小角取整、`bbox`）。幾何＋材質完全相同的網格只存一份（憲法號 26 個模型 ⇒ 6 份）。沒帶 `--models` 時模型的數量記在 `rig_skipped`。
  換色的擺放（雕刻端模型的 `recolor`，TASK-0584）：網格照**換之前**的色去重 ⇒ 跟原色的擺放共用同一份；擺放上多一欄 `mats`（跟那份網格的 `mats` 一一對應、同長度），畫這個擺放時拿它代替網格的 `mats`。沒換色的擺放沒有這一欄。遊戲載入時展開（`src/js/05_hull.js` `modelMats`）；`vxk_compare.py` 比的是擺放實際畫的色。⚠ 檔頭 `version` 不變（讀取端從來不看它）—— 舊的讀取器會畫成原色，所以讀取端與 `.vxk` 要一起換。
- **checksum**：每格 `(x·73856093) ^ (y·19349663) ^ (z·83492791) ^ (c·2654435761)`（各取低 32 位）加總 mod 2³²，跟順序無關。`VoxelKit.verify(grid, header)` 算同一個數 —— 還沒動過的網格要等於 header，等於才算逐格相同。
- 座標一律是作品的格座標（x 船長、y 船寬、z 高）。世界座標怎麼擺由展品給模型矩陣；從格座標換到 Y 朝上時，要用行列式 +1 的換法（例：`(x, z, −y)`），不然面的繞序會翻。

## `voxelkit.js` 的 API

| 名字 | 做什麼 |
|---|---|
| `loadEmbedded(id)` | 讀 `<script type="application/x-vxk" id="…">base64</script>` ⇒ `Promise<{header, chunks}>`（需要 `DecompressionStream`） |
| `embeddedImage(id)`／`embeddedJSON(id)` | 讀 `x-asset` 素材 ⇒ `Promise<Image\|null>`／物件或 `null`（沒交、解不開 ⇒ null，展品自己決定替代品） |
| `Grid.fromModel(m)`／`grid.share()` | 稀疏網格；`share()` 跟原本那份共用資料，誰先改哪一塊誰才複製（copy-on-write） |
| `grid.get／set／each`、`verify(grid, header)` | 讀寫一格、走全部、逐格對拍 |
| `RegionSet(gl, grid, quadIndex)` | GPU 端：區塊內同色面合併（greedy），64³ 一區一個 VAO；`touch(x,y,z)` 標髒、`flush()` 重建、`shareFrom(other)` 先借用另一份的區（被改到的區才自己建）、`draw()` |
| `VOXEL_VS／VOXEL_FS`、`compile` | 體素著色器（RGB332 解色、格線、每格明暗、霧、水下變色）；uniform：`uModel uVP uSun uEye uFog uSky uGround uFogD uWater uTint` |
| `raycast(grid, o, d, tMax)` | 格座標裡的射線，第一個非空格 |
| `detached(grid, seeds, isAnchor, budget)` | 從種子往外找：碰不到錨點的那幾團 ⇒ 斷開了（例：打斷的桅杆）。先往下找，超過 budget 格就當連著 |
| `M4`、`pack(x,y,z)` | 矩陣（column-major）與座標打包（x \| y<<10 \| z<<20，每軸 < 1024） |

⚠ 著色器別寫巢狀三元運算 —— Windows 的 D3D11 後端會編譯失敗（無頭 Chrome 的軟體算繪照常，截圖看不出來）。
