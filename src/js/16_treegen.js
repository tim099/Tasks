// ───────────────────────── 樹（程序生成；只給人看，Tim 2026-10-19） ─────────────────────────
// Tim：「嘗試用程序生成樹木吧(需要是通用架構) 樹本身也是透過程序生成(定義跟 枝幹 樹葉等) 讓樹有隨機性 然後可以支援不同樹種(保留擴充性 先做一種就好)」
//      「接著嘗試加入新樹種(椰子樹) 以及其他加勒比海常見植物吧」（TASK-0725）
// 樹種一張表（TREE_SPECIES）：一棵樹 ＝ 樹幹 ＋ 一層一層的枝（每一層從上一層的枝幹長出來）＋（選用）支柱根 ＋ 樹葉。
//   加一種樹 ＝ 在表裡加一筆（形狀全在參數裡，程式不分樹種）；樹葉的長法照 leaf.kind 分派（TREE_LEAF）：
//   cluster ＝ 一團一團的葉簇（長在最後一層枝尖）、frond ＝ 棕櫚的羽狀葉（從樹幹頂一圈長出來、往下垂）、rosette ＝ 蓮座葉（龍舌蘭：從地面一圈長出來）、
//   fan ＝ 扇葉、cap ＝ 柱頭（仙人掌）、paddle ＝ 寬葉（香蕉）、pad ＝ 莖節（刺梨仙人掌）、tuft ＝ 草叢（海燕麥）。
// treeSkel(種, 種子, 第幾棵) ⇒ 骨架（枝幹的折線、半徑、枝尖）；treeMesh(骨架, 細度) ⇒ 網格：
//   細度 0 ＝ 細的（近景）、1 ＝ 低模（中景：枝少一層、葉子少、管子邊數少）；遠景的貼圖由 63_trees.js 照細的那一份拍。
// 同一個骨架出兩種細度 ⇒ 換細度時輪廓不跳。亂數一律 treeRng（自己的種子）：⛔ 不抽戰局的 rnd()（樹只給人看，開不開樹戰局逐位元組相同）。
// 網格：頂點 10 個 float ＝ 位置 3、法線 3、顏色 3、搖晃權重 1（0 ＝ 樹根不動、1 ＝ 葉尖晃最多）；索引 Uint16。模型座標：樹根在原點、y 朝上、單位公尺。
// place（63_trees.js 照它擺）：spacing 公尺一個候選點；alt ＝ 海拔帶 [開始長, 長滿, 開始變少, 沒有]（公尺，中間照直線漸變）；slopeMax 坡度（tan）；
//   mats ＝ 底質 ⇒ 權重（BED_MAT：1 淺海沙底、10 沙灘、11 陸地、12 岩壁；沒寫 ＝ 不長）；dens 最密幾成；flat ＝ [R, dh]：往東西南北各 R 公尺那四點的高低差（連這一點）不超過 dh 公尺才長（要一大片平的）；
//   forest ＝ 跟林地覆蓋走多少（1 ＝ 只長在林子裡、0 ＝ 不管、負的 ＝ 避開林子）；clump ＝ 一叢一叢的大小（公尺）；patch ＝ [片的大小, 門檻]（成片長、片外沒有）；
//   scale 放大；face 1 ＝ 往下坡（通常是海）歪；shell 0 ＝ 不算進遠處的樹冠殼（太矮）；view ＝ 超過幾公尺就不畫（小植物）；sink ＝ 埋進地面幾公尺（沒寫 0.3；坡上的樹根不浮空 —— 半公尺高的小植物寫小一點）。
var TREE_SPECIES = {
  broadleaf: {
    name: '闊葉樹',                                                     // 加勒比海島上的熱帶闊葉林（桃花心木那一類的輪廓）：矮壯、樹冠寬
    height: [8, 14],                                                    // 樹幹（含樹冠）高，公尺（每棵隨機）
    trunk: { r: [0.22, 0.34], taper: 0.45, bend: 0.12, segs: 6, sides: [7, 4], lean: 0.08, col: [0.33, 0.25, 0.17], top: 0.62 },   // top：樹幹長到總高的幾成（上面是樹冠）
    levels: [                                                           // 分枝：n 枝、長在母枝的 from 那一段、跟母枝夾 angle 度、長 len × 母枝長、粗 r × 母枝在那裡的粗、up 往上翹
      { n: [4, 6], from: [0.45, 1.0], angle: [38, 62], len: [0.55, 0.75], r: 0.55, bend: 0.18, up: 0.25, segs: 4, sides: [5, 3] },
      { n: [3, 4], from: [0.35, 0.95], angle: [28, 52], len: [0.45, 0.65], r: 0.5, bend: 0.22, up: 0.12, segs: 3, sides: [3, 0] }   // sides 0 ＝ 低模不畫這一層
    ],
    leaf: { kind: 'cluster', per: [2, 3], size: [1.3, 2.1], flat: 0.7, col: [0.21, 0.37, 0.14], vary: 0.14, along: 0.35 },   // 每個枝尖 per 團、團的半徑 size 公尺、扁一點（flat）、along：沿最後一段往回也長；（選用）stretch 沿枝拉長、jit 位置抖幾倍、tint 換色
    place: { spacing: 9, alt: [2.5, 8.5, 500, 750], slopeMax: 0.65, mats: { 11: 1 }, dens: 1, forest: 1, clump: 60, scale: [0.8, 1.2] },
    variants: 6                                                         // 每種先生幾棵不同的（實例照位置挑一棵、再轉、再縮放）
  },
  palm: {
    name: '椰子樹',                                                     // Cocos nucifera：細長、彎的樹幹往海那一側歪，頂上一圈羽狀葉往下垂；沙灘與海邊低地
    height: [9, 16],
    trunk: { r: [0.16, 0.21], taper: 0.72, bend: 0.035, segs: 10, sides: [8, 5], lean: [0.3, 0.65], up: 0.55, flare: 1.6, col: [0.58, 0.52, 0.42], top: 1 },   // lean [a, b] ＝ 往模型 +x 歪（擺的時候轉到下坡）、up 往上彎回來、flare 樹根粗幾倍
    levels: [],
    leaf: { kind: 'frond', n: [15, 21], len: [3.6, 5.0], w: 0.62, hang: 0.55, droop: [0.9, 1.5], rise: [8, 62], dead: 0.14, segs: [10, 4], col: [0.29, 0.42, 0.14], vary: 0.12, deadCol: [0.47, 0.37, 0.22], nuts: [2, 7], nutCol: [0.40, 0.38, 0.13] },
    place: { spacing: 13, alt: [0.5, 1.4, 14, 40], slopeMax: 0.35, mats: { 10: 1, 11: 0.55 }, dens: 0.62, forest: -0.35, clump: 90, scale: [0.85, 1.15], face: 1 },
    variants: 6
  },
  seagrape: {
    name: '海葡萄',                                                     // Coccoloba uvifera：沙灘後面的矮灌木，圓葉、有幾團轉紅
    height: [2.6, 4.4],
    trunk: { r: [0.08, 0.12], taper: 0.5, bend: 0.3, segs: 3, sides: [5, 3], lean: 0.35, col: [0.42, 0.35, 0.29], top: 0.3, crown: 0.75 },   // crown：第一層枝的長 ＝ 總高 × crown（沒寫 ＝ 照樹冠那一段）
    levels: [{ n: [3, 5], from: [0.05, 1.0], angle: [48, 78], len: [0.8, 1.2], r: 0.75, bend: 0.3, up: 0.12, segs: 3, sides: [4, 0] }],
    leaf: { kind: 'cluster', per: [1, 2], size: [0.85, 1.3], flat: 0.72, col: [0.35, 0.47, 0.18], vary: 0.18, along: 0.5, tint: [0.16, [0.52, 0.30, 0.16]] },   // tint：[幾成的葉團, 顏色]
    place: { spacing: 6, alt: [0.7, 1.5, 6, 14], slopeMax: 0.45, mats: { 10: 1, 11: 0.45 }, dens: 0.5, forest: -0.2, clump: 35, scale: [0.8, 1.25], view: 700 },
    variants: 4
  },
  mangrove: {
    name: '紅樹',                                                       // Rhizophora mangle：海邊平坦的淺水與泥灘，一圈支柱根插進水裡、深綠樹冠，成片長
    height: [5, 8],
    trunk: { r: [0.12, 0.17], taper: 0.5, bend: 0.15, segs: 4, sides: [6, 4], lean: 0.1, col: [0.36, 0.31, 0.26], top: 0.48 },
    roots: { n: [8, 12], from: [0.1, 0.32], reach: [1.3, 2.7], arch: 0.45, r: 0.32, segs: 4, sides: [4, 3] },   // 支柱根：從樹幹 from 那一段往外拱 reach 公尺插進地面
    levels: [
      { n: [5, 7], from: [0.3, 1.0], angle: [42, 72], len: [0.5, 0.75], r: 0.55, bend: 0.2, up: 0.15, segs: 3, sides: [4, 3] },
      { n: [2, 3], from: [0.4, 0.95], angle: [30, 50], len: [0.45, 0.6], r: 0.5, bend: 0.25, up: 0.1, segs: 2, sides: [3, 0] }
    ],
    leaf: { kind: 'cluster', per: [2, 3], size: [1.0, 1.5], flat: 0.62, col: [0.18, 0.35, 0.14], vary: 0.1, along: 0.35 },
    // 不長在一般的沙灘上（Blocksail 1b2ea27 之後岸邊跨岸連續 ⇒ 沙灘水邊也落在紅樹的海拔帶裡、坡度又緩，成片的雜訊裡會沿水邊長一排）：
    //   底質不收沙灘（10）、四周 30 m 高低差不超過 1.2 m（紅樹林的泥灘、瀉湖邊那種一大片平的；沙灘是後面爬高、前面變深 ⇒ 2 m 上下）
    place: { spacing: 5, alt: [-0.8, -0.4, 0.6, 1.5], slopeMax: 0.08, mats: { 1: 1, 11: 0.8 }, flat: [30, 1.2], dens: 0.9, forest: 0, clump: 25, patch: [380, 0.6], scale: [0.85, 1.2] },
    variants: 4
  },
  agave: {
    name: '龍舌蘭',                                                     // Agave：乾的坡地、岩地上一叢蓮座葉；少數抽出高高的花梗、頂上一簇一簇黃花
    height: [0.9, 1.4],                                                 // 葉長
    trunk: { r: [0.1, 0.1], taper: 1, bend: 0, segs: 1, sides: [0, 0], lean: 0, col: [0.4, 0.4, 0.3], top: 0.05 },
    levels: [],
    leaf: { kind: 'rosette', n: [16, 24], len: [0.75, 1.1], w: 0.18, rise: [14, 80], droop: 0.45, col: [0.45, 0.57, 0.48], vary: 0.1, edge: [0.70, 0.66, 0.38],
            stalk: { v: [2], h: [3.2, 4.4], r: 0.07, col: [0.48, 0.43, 0.27], arms: [6, 9], flower: [0.80, 0.66, 0.20] } },   // stalk.v：第幾棵抽花梗
    place: { spacing: 7, alt: [3, 12, 700, 1100], slopeMax: 0.95, mats: { 11: 1, 12: 0.6 }, dens: 0.4, forest: -0.85, clump: 30, scale: [0.8, 1.3], shell: 0, view: 380 },
    variants: 5
  },
  pine: {
    name: '加勒比松',                                                   // Pinus caribaea：高地（古巴、伊斯帕尼奧拉、巴哈馬的松林）；筆直的樹幹、上半截稀疏的樹冠
    height: [15, 23],
    trunk: { r: [0.2, 0.3], taper: 0.3, bend: 0.05, segs: 7, sides: [7, 4], lean: 0.04, col: [0.39, 0.25, 0.18], top: 0.96, crown: 0.24 },
    levels: [
      { n: [9, 13], from: [0.5, 1.0], angle: [68, 95], len: [0.55, 1.0], r: 0.35, bend: 0.15, up: 0.32, segs: 3, sides: [4, 3] },
      { n: [2, 3], from: [0.4, 1.0], angle: [25, 45], len: [0.35, 0.55], r: 0.5, bend: 0.2, up: 0.25, segs: 2, sides: [3, 0] }
    ],
    leaf: { kind: 'cluster', per: [3, 4], size: [0.42, 0.62], flat: 1, stretch: 2.3, jit: 0.35, col: [0.17, 0.31, 0.20], vary: 0.1, along: 0.55 },   // 松針：枝尖一束一束（沿枝的方向拉長 stretch 倍、jit 抖得少）
    place: { spacing: 10, alt: [260, 520, 1800, 2400], slopeMax: 0.8, mats: { 11: 1, 12: 0.3 }, dens: 1, forest: 1, clump: 60, scale: [0.8, 1.15] },
    variants: 4
  },
  // ── 2026-10-19 第二批（Tim：「接著新增更多植物吧」）：大王椰子、木棉、柱狀仙人掌、樹蕨、扇葉棕櫚 ──
  royalpalm: {
    name: '大王椰子',                                                   // Roystonea：光滑灰白的柱狀樹幹（中段鼓起）、頂上一截綠色的葉鞘（crownshaft）、羽狀葉不留枯葉；平原、谷地、疏林
    height: [15, 24],
    trunk: { r: [0.26, 0.32], taper: 0.75, bend: 0.015, segs: 12, sides: [9, 5], lean: 0.03, col: [0.68, 0.66, 0.62], top: 1, flare: 1.4, bulge: [0.45, 0.22], shaft: [0.14, [0.34, 0.5, 0.24]] },   // bulge：[在樹幹的哪裡, 粗幾成]；shaft：[頂上幾成, 顏色]（葉鞘）
    levels: [],
    leaf: { kind: 'frond', n: [13, 17], len: [3.6, 4.6], w: 0.6, hang: 0.45, droop: [0.7, 1.1], rise: [5, 70], dead: 0, segs: [10, 4], col: [0.27, 0.42, 0.14], vary: 0.1, deadCol: [0.47, 0.37, 0.22], nuts: [0, 0], nutCol: [0, 0, 0] },
    place: { spacing: 22, alt: [3, 10, 300, 600], slopeMax: 0.3, mats: { 11: 1 }, dens: 0.3, forest: -0.4, clump: 150, scale: [0.85, 1.15], shell: 0 },
    variants: 4
  },
  ceiba: {
    name: '木棉（吉貝）',                                               // Ceiba pentandra：冒出林子的巨樹 —— 板根、灰白樹幹、高處幾乎水平攤開的寬樹冠
    height: [24, 34],
    trunk: { r: [0.7, 0.95], taper: 0.45, bend: 0.06, segs: 7, sides: [9, 5], lean: 0.04, col: [0.56, 0.54, 0.49], top: 0.7, crown: 0.42 },
    roots: { n: [5, 7], from: [0.02, 0.07], reach: [2.0, 3.6], arch: -0.3, r: 0.55, segs: 3, sides: [4, 3] },   // 板根：低、短、粗（arch 負的 ⇒ 幾乎直的斜下去）
    levels: [
      { n: [5, 7], from: [0.75, 1.0], angle: [68, 85], len: [0.75, 1.0], r: 0.45, bend: 0.12, up: 0.06, segs: 4, sides: [6, 4] },
      { n: [3, 4], from: [0.35, 0.95], angle: [30, 55], len: [0.4, 0.6], r: 0.5, bend: 0.2, up: 0.08, segs: 3, sides: [4, 0] }
    ],
    leaf: { kind: 'cluster', per: [2, 3], size: [1.8, 2.6], flat: 0.45, col: [0.24, 0.40, 0.16], vary: 0.12, along: 0.4 },
    place: { spacing: 70, alt: [5, 20, 400, 700], slopeMax: 0.4, mats: { 11: 1 }, dens: 0.5, forest: 0.3, clump: 200, scale: [0.85, 1.15], shell: 0 },
    variants: 4
  },
  cactus: {
    name: '柱狀仙人掌',                                                 // Pilosocereus／Stenocereus（乾的島、背風坡、石灰岩地）：從低處分出好幾根往上長的稜柱，柱頭圓的
    height: [2.6, 4.6],
    trunk: { r: [0.16, 0.2], taper: 0.95, bend: 0.04, segs: 2, sides: [10, 6], lean: 0.06, col: [0.42, 0.55, 0.40], top: 0.22, crown: 0.75, ribs: 0.12 },   // ribs：稜（相鄰兩邊一凸一凹幾成）
    levels: [{ n: [3, 7], from: [0.3, 1.0], angle: [55, 80], len: [0.75, 1.05], r: 0.85, taper: 0.85, bend: 0.03, up: 1.0, segs: 4, sides: [10, 6], ribs: 0.12 }],   // taper：枝尖剩幾成粗（沒寫 ＝ 0.35）
    leaf: { kind: 'cap' },
    place: { spacing: 9, alt: [2, 6, 450, 800], slopeMax: 0.8, mats: { 11: 1, 12: 0.7, 10: 0.3 }, dens: 0.18, forest: -0.95, clump: 40, scale: [0.75, 1.25], shell: 0, view: 600 },
    variants: 5
  },
  treefern: {
    name: '樹蕨',                                                       // Cyathea（大安地列斯群島濕潤的山地、雲霧林）：細的深色樹幹、頂上一圈羽狀蕨葉、下面掛一圈枯葉
    height: [3.5, 7],
    trunk: { r: [0.09, 0.12], taper: 0.85, bend: 0.06, segs: 6, sides: [6, 4], lean: 0.12, col: [0.25, 0.19, 0.14], top: 1 },
    levels: [],
    leaf: { kind: 'frond', n: [10, 14], len: [1.8, 2.7], w: 0.75, hang: 0.25, droop: [1.0, 1.5], rise: [10, 60], dead: 0.3, segs: [10, 4], col: [0.25, 0.46, 0.15], vary: 0.12, deadCol: [0.42, 0.30, 0.17], nuts: [0, 0], nutCol: [0, 0, 0] },
    place: { spacing: 7, alt: [350, 650, 1800, 2400], slopeMax: 0.9, mats: { 11: 1 }, dens: 0.55, forest: 0.8, clump: 45, scale: [0.85, 1.2] },
    variants: 4
  },
  thatchpalm: {
    name: '扇葉棕櫚',                                                   // Coccothrinax／Thrinax（茅草棕、銀棕；沿岸的石灰岩地、沙地）：細的樹幹、頂上一團圓扇形的葉
    height: [3, 7],
    trunk: { r: [0.08, 0.11], taper: 0.85, bend: 0.05, segs: 6, sides: [6, 4], lean: [0.05, 0.2], up: 0.1, col: [0.52, 0.47, 0.40], top: 1 },
    levels: [],
    leaf: { kind: 'fan', n: [11, 16], stalk: [0.7, 1.2], r: [0.55, 0.8], arc: 270, rays: [16, 8], rise: [15, 75], cup: 0.25, col: [0.33, 0.47, 0.30], vary: 0.1 },   // fan：葉柄長 stalk、扇的半徑 r、張開幾度 arc、幾根肋 rays（細／低模）、往上捲 cup
    place: { spacing: 10, alt: [1, 3, 80, 200], slopeMax: 0.5, mats: { 10: 0.5, 11: 1, 12: 0.6 }, dens: 0.25, forest: -0.4, clump: 60, scale: [0.85, 1.2], shell: 0, view: 900 },
    variants: 4
  },
  // ── 2026-10-19 第三批（Tim：「接著繼續新增植物吧」）：香蕉、刺梨仙人掌、土耳其頭仙人掌、毒番石榴、愈瘡木、海燕麥 ──
  banana: {
    name: '香蕉／大蕉',                                                 // Musa（1516 年西班牙人帶進伊斯帕尼奧拉；菜園、莊園、溪谷）：綠色的假莖、頂上一圈長橢圓的大葉（被風撕成一條一條）、外圈垂著枯葉；少數掛一串果
    height: [2.4, 3.8],                                                 // 假莖高
    trunk: { r: [0.15, 0.2], taper: 0.65, bend: 0.03, segs: 4, sides: [8, 5], lean: 0.05, col: [0.42, 0.45, 0.26], top: 1, flare: 1.3 },
    levels: [],
    leaf: { kind: 'paddle', n: [8, 12], len: [2.2, 3.0], w: 0.17, rise: [8, 62], droop: [1.0, 1.6], hang: 0.15, dead: 0.2, tear: 0.2, segs: [8, 4], col: [0.30, 0.50, 0.17], vary: 0.1, deadCol: [0.45, 0.38, 0.22],
            bunch: { v: [1, 3], len: 1.6, col: [0.36, 0.48, 0.16], bud: [0.42, 0.14, 0.20] } },   // w：葉片半寬 ＝ 葉長 × w；tear：細的那一份有幾成的段撕開；bunch.v：第幾棵掛果
    place: { spacing: 11, alt: [3, 10, 400, 700], slopeMax: 0.45, mats: { 11: 1 }, dens: 0.42, forest: 0.2, clump: 30, patch: [600, 0.68], scale: [0.85, 1.2], shell: 0 },
    variants: 4
  },
  opuntia: {
    name: '刺梨仙人掌',                                                 // Opuntia（O. dillenii、O. stricta：乾的海岸、沙地、石灰岩地）：一片一片扁的橢圓莖節接著長，頂上有紅紫的果、黃花
    height: [1.0, 1.6],
    trunk: { r: [0.05, 0.05], taper: 1, bend: 0, segs: 1, sides: [0, 0], lean: 0, col: [0.40, 0.52, 0.30], top: 0.02 },
    levels: [],
    leaf: { kind: 'pad', base: [2, 3], kids: [1, 2.2], depth: [3, 4], len: [0.3, 0.42], w: 0.75, thick: 0.035, col: [0.40, 0.54, 0.30], vary: 0.1, fruit: [0.35, [0.58, 0.16, 0.30], [0.86, 0.74, 0.22]] },   // base 片從地面長、每片長 kids 片、depth 層；fruit：[最上一層幾成有, 果的顏色, 花的顏色]
    place: { spacing: 10, alt: [1, 4, 400, 700], slopeMax: 0.8, mats: { 10: 0.6, 11: 1, 12: 0.7 }, dens: 0.27, forest: -0.9, clump: 35, scale: [0.8, 1.3], shell: 0, view: 350, sink: 0.12 },
    variants: 4
  },
  melocactus: {
    name: '土耳其頭仙人掌',                                             // Melocactus intortus（巴哈馬南部、特克斯與凱科斯 —— 群島因它得名、波多黎各、小安地列斯；海邊的岩地）：一顆有稜的綠球、頂上一截紅色的花座
    height: [0.3, 0.45],
    trunk: { r: [0.15, 0.2], taper: 1, bend: 0.02, segs: 6, sides: [20, 10], lean: 0.03, col: [0.36, 0.52, 0.38], top: 1, ribs: 0.12, round: 1 },   // round：圓球的輪廓（上下收、中間最寬）
    levels: [],
    leaf: { kind: 'cap', r: 0.5, flat: 1.7, col: [0.62, 0.20, 0.22] },   // cap 的 r：蓋子半徑 ÷ 尖端粗（沒寫 1.05）、flat 上下拉長、col（沒寫 ＝ 樹幹色）
    place: { spacing: 9, alt: [1, 3, 150, 300], slopeMax: 0.9, mats: { 10: 0.4, 11: 1, 12: 1 }, dens: 0.32, forest: -0.95, clump: 25, scale: [0.8, 1.3], shell: 0, view: 250, sink: 0.06 },
    variants: 3
  },
  manchineel: {
    name: '毒番石榴',                                                   // Hippomane mancinella（「死亡小蘋果」：沙灘後面、紅樹林邊；樹汁、果子都有毒，水手上岸的第一個警告）：矮壯、亮綠的圓樹冠
    height: [6, 11],
    trunk: { r: [0.18, 0.28], taper: 0.45, bend: 0.2, segs: 5, sides: [7, 4], lean: 0.15, col: [0.45, 0.40, 0.33], top: 0.45 },
    levels: [
      { n: [4, 6], from: [0.35, 1.0], angle: [40, 70], len: [0.55, 0.8], r: 0.55, bend: 0.2, up: 0.15, segs: 3, sides: [5, 3] },
      { n: [3, 4], from: [0.35, 0.95], angle: [30, 55], len: [0.45, 0.6], r: 0.5, bend: 0.22, up: 0.1, segs: 3, sides: [3, 0] }
    ],
    leaf: { kind: 'cluster', per: [2, 3], size: [1.0, 1.6], flat: 0.75, col: [0.26, 0.45, 0.16], vary: 0.1, along: 0.4 },
    place: { spacing: 14, alt: [1.0, 2.0, 12, 30], slopeMax: 0.4, mats: { 10: 0.6, 11: 1 }, dens: 0.35, forest: -0.2, clump: 60, scale: [0.85, 1.2] },
    variants: 4
  },
  lignumvitae: {
    name: '愈瘡木',                                                     // Guaiacum officinale（乾的低地林；世上最硬最重的木頭之一 —— 帆船的滑車輪、軸承）：矮、彎的樹幹、深綠的密樹冠、開藍紫色的花
    height: [4, 8],
    trunk: { r: [0.12, 0.2], taper: 0.5, bend: 0.3, segs: 4, sides: [6, 4], lean: 0.2, col: [0.48, 0.45, 0.40], top: 0.35, crown: 0.6 },
    levels: [
      { n: [3, 5], from: [0.2, 1.0], angle: [30, 60], len: [0.6, 0.9], r: 0.6, bend: 0.35, up: 0.15, segs: 3, sides: [5, 3] },
      { n: [3, 4], from: [0.3, 0.95], angle: [30, 55], len: [0.45, 0.65], r: 0.5, bend: 0.3, up: 0.1, segs: 3, sides: [3, 0] }
    ],
    leaf: { kind: 'cluster', per: [2, 3], size: [0.8, 1.2], flat: 0.8, col: [0.16, 0.30, 0.13], vary: 0.1, along: 0.4, tint: [0.15, [0.34, 0.36, 0.60]] },
    place: { spacing: 12, alt: [3, 10, 250, 450], slopeMax: 0.6, mats: { 11: 1, 12: 0.4 }, dens: 0.22, forest: 0.1, clump: 70, scale: [0.85, 1.15] },
    variants: 3
  },
  seaoats: {
    name: '海燕麥',                                                     // Uniola paniculata（巴哈馬、古巴北岸的沙丘）：一叢一叢細長的葉往外拱，抽出幾根細莖、頂上垂著扁扁的穗
    height: [0.7, 1.1],                                                 // 葉長
    trunk: { r: [0.03, 0.03], taper: 1, bend: 0, segs: 1, sides: [0, 0], lean: 0, col: [0.55, 0.50, 0.32], top: 0.02 },
    levels: [],
    leaf: { kind: 'tuft', n: [22, 32], len: [0.6, 1.0], w: 0.032, rise: [30, 82], droop: 0.9, col: [0.42, 0.50, 0.26], tip: [0.66, 0.60, 0.38], vary: 0.12,
            stalk: { n: [1, 4], h: [1.3, 1.7], col: [0.62, 0.55, 0.36], seed: [0.70, 0.62, 0.40] } },   // w：葉寬（公尺）；tip：葉尖的顏色；stalk.h：花莖高 ÷ 葉長
    place: { spacing: 3, alt: [0.8, 1.6, 6, 12], slopeMax: 0.5, mats: { 10: 1 }, dens: 0.55, forest: -0.6, clump: 20, scale: [0.8, 1.25], shell: 0, view: 220, sink: 0.12 },
    variants: 3
  }
};

/** 有種子的亂數（mulberry32）：⇒ 回一個函式，每叫一次回 [0, 1)。 */
function treeRng(seed) {
  var a = seed >>> 0;
  return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function treeIn(R, a) { return a[0] + (a[1] - a[0]) * R(); }
function treeNorm(v) { var l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
/** 跟 d 垂直的兩個單位向量（建管子的環、轉分枝的方向）。 */
function treePerp(d) {
  var a = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  var u = treeNorm([a[1] * d[2] - a[2] * d[1], a[2] * d[0] - a[0] * d[2], a[0] * d[1] - a[1] * d[0]]);
  return [u, [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]]];
}
function treeCross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
/** 骨架的第 lv 層參數：−1 樹幹、−2 支柱根、0… 分枝。 */
function treeLv(S, lv) { return lv === -1 ? S.trunk : lv === -2 ? S.roots : S.levels[lv]; }

/** 骨架：{ sp, v, h, br: [{ pts, r0, r1, lv, par }], tips: [{ p, d, br }] }。lv −1 ＝ 樹幹、−2 ＝ 支柱根；par ＝ 母枝在 br 裡的編號。 */
function treeSkel(sp, seed, v) {
  var S = TREE_SPECIES[sp], R = treeRng(seed), h = treeIn(R, S.height), out = { sp: sp, v: v | 0, h: h, br: [], tips: [] }, T = S.trunk;
  var lean = T.lean && T.lean.length ? [treeIn(R, T.lean), 1, (R() - 0.5) * 0.2] : [(R() - 0.5) * 2 * T.lean, 1, (R() - 0.5) * 2 * T.lean];
  grow(-1, [0, 0, 0], treeNorm(lean), h * T.top, treeIn(R, T.r), -1);
  if (S.roots) roots();
  return out;
  function grow(lv, p0, dir, len, r0, par) {
    var L = treeLv(S, lv), segs = L.segs, pts = [p0], d = dir, p = p0;
    for (var s = 1; s <= segs; s++) {
      var b = L.bend;
      d = treeNorm([d[0] + (R() - 0.5) * 2 * b, d[1] + (R() - 0.5) * 2 * b + (L.up || 0) / segs, d[2] + (R() - 0.5) * 2 * b]);
      p = [p[0] + d[0] * len / segs, p[1] + d[1] * len / segs, p[2] + d[2] * len / segs]; pts.push(p);
    }
    var me = out.br.length, r1 = r0 * (L.taper != null ? L.taper : 0.35);   // 樹幹照 trunk.taper；分枝沒寫 ⇒ 0.35（仙人掌的柱子寫 0.85）
    out.br.push({ pts: pts, r0: r0, r1: r1, lv: lv, par: par, len: len });
    var nx = lv + 1;
    if (nx >= S.levels.length) { out.tips.push({ p: p, d: d, br: me, len: len }); return; }
    var C = S.levels[nx], n = Math.round(treeIn(R, C.n)), az0 = R() * 6.2832;
    if (lv < 0) out.tips.push({ p: p, d: d, br: me, len: len * 0.3, top: true });   // 樹幹頂：也長一團（樹冠中間不空）
    for (var k = 0; k < n; k++) {
      var f = C.from[0] + (C.from[1] - C.from[0]) * (k + 0.3 + 0.4 * R()) / n, at = treeAt(pts, f), rr = r0 + (r1 - r0) * f;
      var pd = treeNorm([pts[Math.min(segs, Math.floor(f * segs) + 1)][0] - pts[Math.floor(f * segs)][0], pts[Math.min(segs, Math.floor(f * segs) + 1)][1] - pts[Math.floor(f * segs)][1], pts[Math.min(segs, Math.floor(f * segs) + 1)][2] - pts[Math.floor(f * segs)][2]]);
      var az = az0 + k * 2.39996 + (R() - 0.5) * 0.6, an = treeIn(R, C.angle) * Math.PI / 180, B = treePerp(pd), ca = Math.cos(az), sa = Math.sin(az);
      var side = [B[0][0] * ca + B[1][0] * sa, B[0][1] * ca + B[1][1] * sa, B[0][2] * ca + B[1][2] * sa];
      var cd = treeNorm([pd[0] * Math.cos(an) + side[0] * Math.sin(an), pd[1] * Math.cos(an) + side[1] * Math.sin(an) + C.up, pd[2] * Math.cos(an) + side[2] * Math.sin(an)]);
      var cl = (lv < 0 ? (T.crown ? h * T.crown : h * (1 - T.top) * 1.6) : len) * treeIn(R, C.len) * (1 - 0.3 * f);
      grow(nx, at, cd, cl, rr * C.r, me);
    }
  }
  // 支柱根：從樹幹 from 那一段（照總高）往外一圈拱出去、插進地面（二次曲線：起點 → 往外往上的控制點 → 地面）
  function roots() {
    var Rt = S.roots, tr = out.br[0], n = Math.round(treeIn(R, Rt.n)), az0 = R() * 6.2832;
    for (var k = 0; k < n; k++) {
      var f = treeIn(R, Rt.from), s0 = treeAt(tr.pts, f / T.top), az = az0 + k * 6.2832 / n + (R() - 0.5) * 0.5, ox = Math.cos(az), oz = Math.sin(az), re = treeIn(R, Rt.reach);
      var c = [s0[0] + ox * re * 0.45, s0[1] + Rt.arch * s0[1] + 0.25, s0[2] + oz * re * 0.45], e = [s0[0] + ox * re, -0.15 - 0.25 * R(), s0[2] + oz * re], pts = [];
      for (var s = 0; s <= Rt.segs; s++) { var t = s / Rt.segs, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), cc = t * t; pts.push([a * s0[0] + b * c[0] + cc * e[0], a * s0[1] + b * c[1] + cc * e[1], a * s0[2] + b * c[2] + cc * e[2]]); }
      var r0 = (tr.r0 + (tr.r1 - tr.r0) * f / T.top) * Rt.r;
      out.br.push({ pts: pts, r0: r0, r1: r0 * 0.8, lv: -2, par: 0, len: re });
    }
  }
}
/** 折線上 f（0～1，照段數平分）那一點。 */
function treeAt(pts, f) {
  var n = pts.length - 1, x = Math.max(0, Math.min(n - 1e-6, f * n)), i = Math.floor(x), t = x - i, a = pts[i], b = pts[i + 1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** 骨架 ⇒ 網格。lod 0 細、1 低模。⇒ { V: Float32Array（10 個一組）, I: Uint16Array, h（最高點）, w（最寬的半寬，遠景貼圖的框用） }。 */
function treeMesh(K, lod) {
  var S = TREE_SPECIES[K.sp], R = treeRng(K.br.length * 7919 + Math.round(K.h * 100) + lod), V = [], I = [], w = 0, top = 0;
  function vert(p, n, c, sw) { V.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], sw); w = Math.max(w, Math.abs(p[0]), Math.abs(p[2])); top = Math.max(top, p[1]); return V.length / 10 - 1; }
  var M = { S: S, K: K, lod: lod, R: R, V: V, I: I, vert: vert };
  K.br.forEach(function (b) {
    var L = treeLv(S, b.lv), sides = L.sides[lod]; if (!sides) return;
    treeTube(M, b.pts, b.r0, b.r1, sides, S.trunk.col, 0.9 + 0.2 * R(), b.lv, L);
  });
  TREE_LEAF[S.leaf.kind](M);
  return { V: new Float32Array(V), I: new Uint16Array(I), h: Math.max(K.h, top), w: w };
}
/** 一根管子（枝幹、根、花梗）：折線 P、半徑 r0 ⇒ r1、sides 邊；kc 深淺；lv 決定搖晃權重（−1 樹幹根部最暗）；
 *  L（那一層的參數，可以沒有）：flare 根部粗幾倍、bulge [位置, 粗幾成]（大王椰子中段鼓起）、shaft [頂上幾成, 顏色]（葉鞘）、ribs 稜（相鄰兩邊一凸一凹）、round 圓球的輪廓（土耳其頭仙人掌）。 */
function treeTube(M, P, r0, r1, sides, col, kc, lv, L) {
  var n = P.length, base = M.V.length / 10, K = M.K, flare = L && L.flare, rd = L && L.round, bg = L && L.bulge, sh = L && L.shaft, rb = L && L.ribs || 0, B = null;
  for (var i = 0; i < n; i++) {
    var d = treeNorm(i < n - 1 ? [P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1], P[i + 1][2] - P[i][2]] : [P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1], P[i][2] - P[i - 1][2]]);
    // 每一圈的基準沿著管子平移（上一圈的 u 投影到這一圈的切面）：以前每圈各自 treePerp ⇒ 方向的 y 跨過 0.9 那一圈換了參考軸、整圈轉一個角度
    //   ⇒ 那一段管子扭成一個細腰（椰子樹幹往一邊歪、越往上越直，6 棵有 4 棵在根部或半腰凹一塊；Tim 2026-10-20 截圖）
    var u0 = B && B[0], k0 = B ? u0[0] * d[0] + u0[1] * d[1] + u0[2] * d[2] : 1;
    if (Math.abs(k0) > 0.99) B = treePerp(d);                              // 第一圈、或轉超過 80° 左右（上一圈的 u 幾乎順著這一圈）⇒ 照舊挑
    else { var u = treeNorm([u0[0] - d[0] * k0, u0[1] - d[1] * k0, u0[2] - d[2] * k0]); B = [u, treeCross(d, u)]; }   // treePerp 也是 [u, d × u] ⇒ 三角形的方向不變
    var t = i / (n - 1), r = (r0 + (r1 - r0) * t) * (flare ? 1 + (flare - 1) * Math.pow(1 - t, 5) : 1);
    if (rd) r *= Math.pow(Math.sin(Math.PI * (0.12 + 0.8 * t)), 0.6);
    if (bg) r *= 1 + bg[1] * Math.exp(-((t - bg[0]) / 0.18) * ((t - bg[0]) / 0.18));
    var cc = col; if (sh && t > 1 - sh[0]) { cc = sh[1]; r *= 1.08; }
    var sw = Math.min(1, Math.max(0, (P[i][1] / K.h) * 0.6 + (lv + 1) * 0.15)), dk = lv === -1 && i === 0 ? 0.75 : 1;
    for (var s = 0; s < sides; s++) {
      var a = s / sides * 6.2832, nn = [B[0][0] * Math.cos(a) + B[1][0] * Math.sin(a), B[0][1] * Math.cos(a) + B[1][1] * Math.sin(a), B[0][2] * Math.cos(a) + B[1][2] * Math.sin(a)], rs = r * (1 + (s % 2 ? -rb : rb));
      M.vert([P[i][0] + nn[0] * rs, P[i][1] + nn[1] * rs, P[i][2] + nn[2] * rs], nn, [cc[0] * kc * dk, cc[1] * kc * dk, cc[2] * kc * dk], sw);
    }
  }
  for (i = 0; i < n - 1; i++) for (s = 0; s < sides; s++) {
    var a0 = base + i * sides + s, a1 = base + i * sides + (s + 1) % sides, b0 = a0 + sides, b1 = a1 + sides;
    M.I.push(a0, b0, a1, a1, b0, b1);
  }
}
/** 一顆小球（葉簇、椰子、花）：二十面體，半徑 r、y 扁 flat；ax ＋ st ＝ 沿 ax 拉長 st 倍（松針一束一束）；法線照 out（樹冠中心往外）混一半；下半部暗一點。 */
function treeBall(M, c, r, flat, col, sw, out, ax, st) {
  var base = M.V.length / 10, R = M.R;
  TREE_ICO.P.forEach(function (p) {
    var j = 0.82 + 0.36 * R(), q = [c[0] + p[0] * r * j, c[1] + p[1] * r * j * flat, c[2] + p[2] * r * j];
    if (ax) { var a = (p[0] * ax[0] + p[1] * ax[1] + p[2] * ax[2]) * r * j * (st - 1); q = [q[0] + ax[0] * a, q[1] + ax[1] * a, q[2] + ax[2] * a]; }
    var n = out ? treeNorm([p[0] + out[0], p[1] * 1.2 + out[1], p[2] + out[2]]) : p, dk = 0.72 + 0.28 * (p[1] * 0.5 + 0.5);
    M.vert(q, n, [col[0] * dk, col[1] * dk, col[2] * dk], sw);
  });
  for (var f = 0; f < TREE_ICO.F.length; f++) M.I.push(base + TREE_ICO.F[f]);
}
/** 一顆照自己方向的橢球（仙人掌的莖節）：二十面體，軸 ax ＝ [三個單位向量]、半徑 r ＝ [三個]；法線照橢球（÷ 半徑）；下半部暗一點。 */
function treeBlob(M, c, ax, r, col, sw) {
  var base = M.V.length / 10, R = M.R;
  TREE_ICO.P.forEach(function (p) {
    var j = 0.92 + 0.16 * R(), q = [c[0], c[1], c[2]], nn = [0, 0, 0];
    for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) { q[b] += ax[a][b] * p[a] * r[a] * j; nn[b] += ax[a][b] * p[a] / r[a]; }
    nn = treeNorm(nn); var dk = 0.75 + 0.25 * (nn[1] * 0.5 + 0.5);
    M.vert(q, nn, [col[0] * dk, col[1] * dk, col[2] * dk], sw);
  });
  for (var f = 0; f < TREE_ICO.F.length; f++) M.I.push(base + TREE_ICO.F[f]);
}
/** 一片三角形（兩面都畫；法線朝上那一面、再往上偏 up ⇒ 薄葉不會一面全黑）。 */
function treeTri(M, a, b, c, col, sw, up) {
  var n = treeNorm(treeCross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
  if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
  n = treeNorm([n[0], n[1] + up, n[2]]);
  var i0 = M.vert(a, n, col, sw[0]); M.vert(b, n, col, sw[1]); M.vert(c, n, col, sw[2]); M.I.push(i0, i0 + 1, i0 + 2);
}
// 葉簇近看的細節（Tim 2026-10-20：「是否可以給樹葉近距離時 一些貼圖細化 椰子樹不用」「用算法去生成 不用太細(有風格化就好 不追求寫實風)」）：
//   葉簇（cluster）的頂點把搖晃權重加上這個數當旗標（權重本身 0～1）⇒ 著色器（63_trees.js）拆回來、只在這些頂點畫葉片；羽狀葉（椰子樹）、仙人掌、香蕉等不加 ⇒ 照舊。
var TREE_LEAF_DET = 2;
// 樹葉的長法（leaf.kind ⇒ 函式(M)）：加一種（針葉 needle…）＝ 在這裡加一個。
var TREE_ICO = (function () {                                            // 正二十面體（12 點、20 面；葉簇、椰子、花的底）
  var t = (1 + Math.sqrt(5)) / 2, P = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(treeNorm);
  var F = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
  return { P: P, F: F };
})();
var TREE_LEAF = {
  /** 葉簇：細 ⇒ 每個枝尖 per 團（沿最後一段往回也長）；低模 ⇒ 每根母枝的枝尖併成一大團（中心 ＝ 平均、半徑涵蓋）。
   *  一團 ＝ 扁一點的二十面體、每個頂點抖一點；法線一半照團、一半照「從樹冠中心往外」⇒ 整個樹冠像一顆柔和的球；tint ＝ 有幾成的團換顏色（海葡萄轉紅的葉）。 */
  cluster: function (M) {
    var K = M.K, Lf = M.S.leaf, R = M.R, blobs = [];
    if (M.lod === 0) K.tips.forEach(function (t) {
      var b = K.br[t.br], m = Math.round(treeIn(R, Lf.per)) + (t.top ? 1 : 0);
      for (var j = 0; j < m; j++) { var q = treeAt(b.pts, 1 - Lf.along * R()), jt = Lf.jit || 1; blobs.push({ c: [q[0] + (R() - 0.5) * 1.2 * jt, q[1] + (R() - 0.2) * 0.8 * jt, q[2] + (R() - 0.5) * 1.2 * jt], r: treeIn(R, Lf.size), ax: t.d }); }
    });
    else {
      var G = {};
      K.tips.forEach(function (t) { var k = t.top ? 'top' : K.br[t.br].par; (G[k] = G[k] || []).push(t.p); });
      Object.keys(G).forEach(function (k) {
        var L = G[k], c = [0, 0, 0]; L.forEach(function (p) { c[0] += p[0] / L.length; c[1] += p[1] / L.length; c[2] += p[2] / L.length; });
        var r = 0; L.forEach(function (p) { r = Math.max(r, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])); });
        blobs.push({ c: c, r: r * 0.8 + Lf.size[1] });
      });
    }
    var mid = [0, K.h * 0.7, 0];
    blobs.forEach(function (bl) {
      var k = 1 + (R() - 0.5) * 2 * Lf.vary, c0 = [Lf.col[0] * k, Lf.col[1] * (1 + (R() - 0.5) * Lf.vary), Lf.col[2] * k];
      if (Lf.tint && R() < Lf.tint[0]) { var tc = Lf.tint[1], m = 0.5 + 0.5 * R(); c0 = [c0[0] + (tc[0] - c0[0]) * m, c0[1] + (tc[1] - c0[1]) * m, c0[2] + (tc[2] - c0[2]) * m]; }
      var out = treeNorm([bl.c[0] - mid[0], (bl.c[1] - mid[1]) * 0.6 + 0.4, bl.c[2] - mid[2]]);
      treeBall(M, bl.c, bl.r, Lf.flat, c0, Math.min(1, 0.55 + 0.45 * bl.c[1] / K.h) + TREE_LEAF_DET, out, Lf.stretch && bl.ax ? bl.ax : null, Lf.stretch);   // ＋TREE_LEAF_DET：近看畫葉片細節（63_trees.js TREE_FS）
    });
  },
  /** 棕櫚的羽狀葉：從樹幹頂一圈長出 n 片（照黃金角轉；越晚長的越往外、越垂；最外面 dead 成是垂下來的枯葉）。
   *  一片 ＝ 一根葉軸（往外、照 droop 一段一段往下彎）＋ 兩側的小葉：細的每段兩對三角形（底在葉軸上、尖往前往外往下 ⇒ 一根一根、中間有縫）；
   *  低模每段兩條往下折的帶子（V 字）。葉軸最前面 12% 是光的葉柄。細的另外掛幾顆椰子；中間一顆球蓋住葉子的根。 */
  frond: function (M) {
    var K = M.K, Lf = M.S.leaf, R = M.R, lod = M.lod, c = K.tips[0].p, n = Math.round(treeIn(R, Lf.n) * (lod ? 0.65 : 1)), segs = Lf.segs[lod];
    for (var f = 0; f < n; f++) {
      var u = (f + 0.5) / n, dead = u > 1 - Lf.dead, az = f * 2.39996 + (R() - 0.5) * 0.5;
      var el = dead ? -(48 + 25 * R()) : Lf.rise[1] + (Lf.rise[0] - Lf.rise[1]) * u / (1 - Lf.dead) + (R() - 0.5) * 14;
      el *= Math.PI / 180;
      var L = treeIn(R, Lf.len) * (dead ? 0.8 : u < 0.15 ? 0.78 : 1), dr = treeIn(R, Lf.droop) * (dead ? 0.25 : 1), k = 1 + (R() - 0.5) * 2 * Lf.vary;
      var col = dead ? Lf.deadCol : [Lf.col[0] * k, Lf.col[1] * (1 + (R() - 0.5) * Lf.vary), Lf.col[2] * k];
      var d = [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)], p = [c[0] + d[0] * 0.18, c[1] + d[1] * 0.18 - 0.1, c[2] + d[2] * 0.18], P = [p];
      for (var s = 1; s <= segs; s++) { d = treeNorm([d[0], d[1] - dr / segs, d[2]]); p = [p[0] + d[0] * L / segs, p[1] + d[1] * L / segs, p[2] + d[2] * L / segs]; P.push(p); }
      var side = treeNorm(treeCross([Math.cos(az), 0, Math.sin(az)], [0, 1, 0])), W = Lf.w * L / 4.3;
      var wid = function (t) { return t < 0.12 ? 0 : W * Math.pow(Math.sin(Math.PI * Math.min(1, (t - 0.12) / 0.86)), 0.55); };
      var edge = function (t, sg, ext) { var q = treeAt(P, Math.min(1, t)), w = wid(t) * ext; return [q[0] + side[0] * w * sg, q[1] - w * Lf.hang, q[2] + side[2] * w * sg]; };
      if (lod === 0) {
        for (var h2 = 0; h2 < segs * 2; h2++) {
          var t0 = h2 / (segs * 2), t1 = (h2 + 1) / (segs * 2), tm = Math.min(1, t1 + 0.6 / segs); if (wid(t1) <= 0) continue;
          var A = treeAt(P, t0), B = treeAt(P, t1), swA = 0.4 + 0.6 * t0, swX = 0.4 + 0.6 * tm;
          treeTri(M, A, B, edge(tm, 1, 1), col, [swA, swA, swX], 0.6);
          treeTri(M, A, B, edge(tm, -1, 1), col, [swA, swA, swX], 0.6);
        }
      } else {
        for (s = 0; s < segs; s++) {
          var a0 = s / segs, a1 = (s + 1) / segs, C0 = P[s], C1 = P[s + 1], sw0 = 0.4 + 0.6 * a0, sw1 = 0.4 + 0.6 * a1;
          [1, -1].forEach(function (sg) { var E0 = edge(a0, sg, 1), E1 = edge(a1, sg, 1); treeTri(M, C0, C1, E1, col, [sw0, sw1, sw1], 0.6); treeTri(M, C0, E1, E0, col, [sw0, sw1, sw0], 0.6); });
        }
      }
    }
    treeBall(M, [c[0], c[1] - 0.12, c[2]], 0.3, 1.2, [0.40, 0.40, 0.24], 0.35, null);
    if (lod === 0) {
      var m = Math.round(treeIn(R, Lf.nuts)), a = R() * 6.2832;
      for (var j = 0; j < m; j++) {
        a += 2.39996; var kc = 0.8 + 0.4 * R(), q = [c[0] + Math.cos(a) * (0.3 + 0.12 * R()), c[1] - 0.45 - 0.3 * R(), c[2] + Math.sin(a) * (0.3 + 0.12 * R())];
        treeBall(M, q, 0.14, 1.15, [Lf.nutCol[0] * kc, Lf.nutCol[1] * kc, Lf.nutCol[2] * kc], 0.3, null);
      }
    }
  },
  /** 扇葉（扇葉棕櫚）：從樹幹頂一圈長出 n 片（照黃金角轉；越外面越平、越垂）；一片 ＝ 一根葉柄 ＋ 葉柄末端一面圓扇（arc 度、rays 根肋 ⇒ 一片片三角形，
   *  細的那一份肋尖一長一短 ⇒ 扇緣裂開）；扇面往上捲一點（cup）、兩側往下垂。中間一顆球蓋住葉柄的根。 */
  fan: function (M) {
    var K = M.K, Lf = M.S.leaf, R = M.R, lod = M.lod, c = K.tips[0].p, n = Math.round(treeIn(R, Lf.n) * (lod ? 0.6 : 1)), nr = Lf.rays[lod], A = Lf.arc * Math.PI / 180;
    for (var f = 0; f < n; f++) {
      var u = (f + 0.5) / n, az = f * 2.39996 + (R() - 0.5) * 0.5, el = (Lf.rise[1] + (Lf.rise[0] - Lf.rise[1]) * u + (R() - 0.5) * 12) * Math.PI / 180;
      var d = [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)], sl = treeIn(R, Lf.stalk), E = [c[0] + d[0] * sl, c[1] + d[1] * sl, c[2] + d[2] * sl];
      var k = 1 + (R() - 0.5) * 2 * Lf.vary, col = [Lf.col[0] * k, Lf.col[1] * k, Lf.col[2] * k], rr = treeIn(R, Lf.r);
      var s = treeNorm(treeCross([Math.cos(az), 0, Math.sin(az)], [0, 1, 0])), fw = treeNorm([d[0], d[1] * 0.5 + 0.15, d[2]]), nm = treeNorm(treeCross(fw, s));
      if (nm[1] < 0) nm = [-nm[0], -nm[1], -nm[2]];
      if (!lod) treeTube(M, [c, E], 0.025, 0.018, 3, [col[0] * 0.8, col[1] * 0.8, col[2] * 0.8], 1, 0, null);
      var pts = [];
      for (var q = 0; q <= nr; q++) {
        var ph = -A / 2 + A * q / nr, cph = Math.cos(ph), sph = Math.sin(ph), ext = !lod && q % 2 ? 0.8 : 1, cu = Lf.cup * rr * Math.abs(sph), dr = 0.18 * rr * (1 - cph);
        pts.push([E[0] + rr * ext * (cph * fw[0] + sph * s[0]) + nm[0] * cu, E[1] + rr * ext * (cph * fw[1] + sph * s[1]) + nm[1] * cu - dr, E[2] + rr * ext * (cph * fw[2] + sph * s[2]) + nm[2] * cu]);
      }
      for (q = 0; q < nr; q++) treeTri(M, E, pts[q], pts[q + 1], col, [0.5, 0.9, 0.9], 0.5);
    }
    treeBall(M, [c[0], c[1] - 0.05, c[2]], 0.17, 1.2, [0.42, 0.38, 0.28], 0.3, null);
  },
  /** 柱頭（仙人掌）：每個枝尖（含樹幹頂）一顆圓的蓋子，半徑 ＝ 那一根在尖端的粗 × r（沒寫 1.05）；flat 上下拉長（沒寫 0.9）；col 沒寫 ＝ 樹幹色（土耳其頭仙人掌：紅色的花座）。 */
  cap: function (M) {
    var K = M.K, Lf = M.S.leaf, col = Lf.col || M.S.trunk.col, k = Lf.col ? 1 : 0.97;
    K.tips.forEach(function (t) { var b = K.br[t.br]; treeBall(M, t.p, b.r1 * (Lf.r || 1.05), Lf.flat || 0.9, [col[0] * k, col[1] * k, col[2] * k], 0.3, null); });
  },
  /** 寬葉（香蕉、大蕉）：從假莖頂一圈長出 n 片長橢圓的大葉（照黃金角轉；越晚長的越往外、越垂；最外面 dead 成是貼著假莖垂下的枯葉）。
   *  一片 ＝ 一根中肋（往外、照 droop 一段一段往下彎；前面 15% 是葉柄）＋ 兩側的葉片（每段一個四邊形，往下垂 hang）；
   *  細的那一份照 tear 有幾成的段撕開（那一段的外緣兩頭往中間縮 ⇒ 葉緣一道一道 V 字的裂口）。
   *  bunch.v 列的那幾棵掛一串果：從頂上往外彎、垂下的果軸，上半截一圈一圈的果（沿果軸拉長的小球），最下面一顆紫紅的花苞。 */
  paddle: function (M) {
    var K = M.K, Lf = M.S.leaf, R = M.R, lod = M.lod, c = K.tips[0].p, n = Math.round(treeIn(R, Lf.n) * (lod ? 0.7 : 1)), segs = Lf.segs[lod];
    for (var f = 0; f < n; f++) {
      var u = (f + 0.5) / n, dead = u > 1 - Lf.dead, az = f * 2.39996 + (R() - 0.5) * 0.5;
      var el = (dead ? -(62 + 18 * R()) : Lf.rise[1] + (Lf.rise[0] - Lf.rise[1]) * u / (1 - Lf.dead) + (R() - 0.5) * 12) * Math.PI / 180;
      var L = treeIn(R, Lf.len) * (dead ? 0.7 : 1), dr = treeIn(R, Lf.droop) * (dead ? 0.2 : 1), k = 1 + (R() - 0.5) * 2 * Lf.vary;
      var col = dead ? Lf.deadCol : [Lf.col[0] * k, Lf.col[1] * (1 + (R() - 0.5) * Lf.vary), Lf.col[2] * k];
      var d = [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)], p = [c[0] + d[0] * 0.08, c[1] - 0.05, c[2] + d[2] * 0.08], P = [p];
      for (var s = 1; s <= segs; s++) { d = treeNorm([d[0], d[1] - dr / segs, d[2]]); p = [p[0] + d[0] * L / segs, p[1] + d[1] * L / segs, p[2] + d[2] * L / segs]; P.push(p); }
      var side = treeNorm(treeCross([Math.cos(az), 0, Math.sin(az)], [0, 1, 0])), W = Lf.w * L * (dead ? 0.6 : 1);
      var wid = function (t) { return t <= 0.15 ? 0 : W * Math.pow(Math.sin(Math.PI * Math.min(1, (t - 0.15) / 0.85)), 0.5); };
      var edge = function (t, sg) { var q = treeAt(P, Math.min(1, t)), w = wid(t); return [q[0] + side[0] * w * sg, q[1] - w * Lf.hang, q[2] + side[2] * w * sg]; };
      for (s = 0; s < segs; s++) {
        var a0 = s / segs, a1 = (s + 1) / segs, C0 = P[s], C1 = P[s + 1], sw0 = 0.3 + 0.7 * a0, sw1 = 0.3 + 0.7 * a1; if (wid(a1) <= 0 && wid(a0) <= 0) continue;
        [1, -1].forEach(function (sg) {
          var tr = !lod && !dead && R() < Lf.tear, E0 = edge(tr ? a0 + 0.14 / segs : a0, sg), E1 = edge(tr ? a1 - 0.14 / segs : a1, sg);
          treeTri(M, C0, C1, E1, col, [sw0, sw1, sw1], 0.5); treeTri(M, C0, E1, E0, col, [sw0, sw1, sw0], 0.5);
        });
      }
    }
    treeBall(M, [c[0], c[1] - 0.1, c[2]], 0.22, 1.4, [0.36, 0.42, 0.22], 0.3, null);   // 葉鞘包住的頂
    var B = Lf.bunch; if (!B || B.v.indexOf(K.v) < 0) return;
    var ba = R() * 6.2832, bx = Math.cos(ba), bz = Math.sin(ba), P2 = [];
    for (s = 0; s <= 6; s++) { var t = s / 6, ang = t * 2.4; P2.push([c[0] + bx * Math.sin(ang) * B.len * 0.35, c[1] - 0.1 + Math.cos(ang) * B.len * 0.3 - t * B.len * 0.45, c[2] + bz * Math.sin(ang) * B.len * 0.35]); }   // 往外拱、再垂下
    treeTube(M, P2, 0.035, 0.025, lod ? 3 : 5, [0.40, 0.42, 0.24], 1, 0, null);
    var nh = lod ? 2 : 5;
    for (var h = 0; h < nh; h++) {
      var o = treeAt(P2, 0.45 + 0.35 * h / nh), ax = treeNorm([P2[6][0] - P2[3][0], P2[6][1] - P2[3][1], P2[6][2] - P2[3][2]]);
      if (lod) { treeBall(M, o, 0.2, 1.3, B.col, 0.4, null); continue; }
      for (var q = 0; q < 7; q++) { var qa = q / 7 * 6.2832 + h, qo = [o[0] + Math.cos(qa) * 0.14, o[1] + 0.05, o[2] + Math.sin(qa) * 0.14]; treeBall(M, qo, 0.06, 1, B.col, 0.4, null, treeNorm([Math.cos(qa), 1.2, Math.sin(qa)]), 2.6); }
    }
    var e = P2[6]; treeBall(M, [e[0], e[1] - 0.1, e[2]], 0.09, 1, B.bud, 0.45, null, [0, 1, 0], 1.8);
  },
  /** 莖節（刺梨仙人掌）：從地面長出 base 片扁的橢圓莖節、每片頂上的邊再長出 kids 片（取整數前的小數 ＝ 多長一片的機率），一共 depth 層；
   *  一片 ＝ 扁的二十面體（寬 len × w、高 len、厚 thick；照它自己的方向）；新長的往外、往上、照母節的平面轉一點 ⇒ 歪歪扭扭的一叢。
   *  形狀照這一棵自己的種子（細、低模同一叢 ⇒ 換細度輪廓不跳）；細的那一份最上一層 fruit[0] 成的莖節頂上一顆果（紅紫）或一朵花（黃）。 */
  pad: function (M) {
    var K = M.K, Lf = M.S.leaf, R = M.R, G = treeRng(K.v * 7919 + Math.round(K.h * 1000) + 17), D = Math.round(treeIn(G, Lf.depth)), sc = K.h / 1.3;
    function one(b0, up, nm, lv) {
      var len = treeIn(G, Lf.len) * sc * (1 - 0.12 * lv), sd = treeNorm(treeCross(up, nm)), c = [b0[0] + up[0] * len * 0.48, b0[1] + up[1] * len * 0.48, b0[2] + up[2] * len * 0.48];
      var k = 1 + (G() - 0.5) * 2 * Lf.vary, col = [Lf.col[0] * k, Lf.col[1] * k, Lf.col[2] * k];
      treeBlob(M, c, [sd, up, nm], [len * Lf.w * 0.5, len * 0.5, Lf.thick * sc], col, Math.min(1, 0.15 + 0.2 * lv));
      var top = [c[0] + up[0] * len * 0.46, c[1] + up[1] * len * 0.46, c[2] + up[2] * len * 0.46];
      if (lv + 1 >= D) {
        var fr = G() < Lf.fruit[0], fo = (G() - 0.5) * len * Lf.w * 0.6, fl = G() < 0.4;   // 細、低模都抽 ⇒ 兩份的形狀一樣
        if (fr && !M.lod) { treeBall(M, [top[0] + sd[0] * fo, top[1] + sd[1] * fo + 0.02, top[2] + sd[2] * fo], fl ? 0.045 : 0.035, fl ? 0.6 : 1.3, fl ? Lf.fruit[2] : Lf.fruit[1], 0.4, null); }
        return;
      }
      var m = Math.floor(Lf.kids[0] + (Lf.kids[1] - Lf.kids[0]) * G() + G() * 0.5);
      for (var j = 0; j < m; j++) {
        var off = m > 1 ? (j / (m - 1) - 0.5) * 0.7 : (G() - 0.5) * 0.4, a = (off * 1.3 + (G() - 0.5) * 0.5), ca = Math.cos(a), sa = Math.sin(a);
        var u2 = treeNorm([up[0] * ca + sd[0] * sa, up[1] * ca + sd[1] * sa + 0.4, up[2] * ca + sd[2] * sa]), tw = (G() - 0.5) * 1.2;   // 在母節的平面裡往旁邊歪、往上拉一點；再繞自己轉 tw
        var s2 = treeNorm(treeCross(u2, nm)), n2 = treeNorm([nm[0] * Math.cos(tw) + s2[0] * Math.sin(tw), nm[1] * Math.cos(tw) + s2[1] * Math.sin(tw), nm[2] * Math.cos(tw) + s2[2] * Math.sin(tw)]);
        var at = [top[0] + sd[0] * off * len * Lf.w, top[1] + sd[1] * off * len * Lf.w - len * 0.06, top[2] + sd[2] * off * len * Lf.w];
        one(at, u2, n2, lv + 1);
      }
    }
    var nb = Math.round(treeIn(G, Lf.base)), az0 = G() * 6.2832;
    for (var b = 0; b < nb; b++) {
      var az = az0 + b * 6.2832 / nb + (G() - 0.5) * 0.8, tl = (10 + 30 * G()) * Math.PI / 180, up = [Math.cos(az) * Math.sin(tl), Math.cos(tl), Math.sin(az) * Math.sin(tl)];
      var hz = treeNorm(treeCross(up, [0, 1, 0])), tw = (G() - 0.5) * 1.6, nm = treeNorm(treeCross(hz, up));
      nm = treeNorm([nm[0] * Math.cos(tw) + hz[0] * Math.sin(tw), nm[1] * Math.cos(tw) + hz[1] * Math.sin(tw), nm[2] * Math.cos(tw) + hz[2] * Math.sin(tw)]);
      one([Math.cos(az) * 0.05, -0.04, Math.sin(az) * 0.05], up, nm, 0);
    }
  },
  /** 草叢（海燕麥）：從地面長出 n 片細長的葉（照黃金角轉；裡面的直、外面的往外拱、尖端垂下）；一片 ＝ 一條越來越窄的帶子（葉尖的顏色漸變成 tip）。
   *  細的那一份另外抽 stalk.n 根花莖：直的細莖，上半截兩邊交錯垂著扁扁的穗（沿下垂方向拉長的小球）。 */
  tuft: function (M) {
    var K = M.K, Lf = M.S.leaf, R = M.R, lod = M.lod, n = Math.round(treeIn(R, Lf.n) * (lod ? 0.45 : 1)), segs = lod ? 2 : 4;
    for (var f = 0; f < n; f++) {
      var u = (f + 0.5) / n, az = f * 2.39996 + (R() - 0.5) * 0.5, el = (Lf.rise[1] + (Lf.rise[0] - Lf.rise[1]) * u + (R() - 0.5) * 14) * Math.PI / 180;
      var L = K.h * treeIn(R, Lf.len) * (0.7 + 0.3 * u), k = 1 + (R() - 0.5) * 2 * Lf.vary, W = Lf.w * (lod ? 1.6 : 1);
      var d = [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)], p = [Math.cos(az) * 0.04, 0, Math.sin(az) * 0.04], P = [p];
      for (var s = 1; s <= segs; s++) { d = treeNorm([d[0], d[1] - Lf.droop * (0.4 + u) / segs, d[2]]); p = [p[0] + d[0] * L / segs, p[1] + d[1] * L / segs, p[2] + d[2] * L / segs]; P.push(p); }
      var sd = treeNorm(treeCross([Math.cos(az), 0, Math.sin(az)], [0, 1, 0])), tw = (R() - 0.5) * 0.8;
      sd = treeNorm([sd[0] * Math.cos(tw), Math.sin(tw), sd[2] * Math.cos(tw)]);   // 葉面繞葉軸轉一點 ⇒ 不是每片都正對同一邊
      for (s = 0; s < segs; s++) {
        var t0 = s / segs, t1 = (s + 1) / segs, w0 = W * (1 - t0 * 0.85), w1 = W * (1 - t1 * 0.85) * (s === segs - 1 ? 0 : 1), A = P[s], B = P[s + 1];
        var c0 = [Lf.col[0] * k + (Lf.tip[0] - Lf.col[0]) * t0, Lf.col[1] * k + (Lf.tip[1] - Lf.col[1]) * t0, Lf.col[2] * k + (Lf.tip[2] - Lf.col[2]) * t0];
        var A0 = [A[0] - sd[0] * w0, A[1] - sd[1] * w0, A[2] - sd[2] * w0], A1 = [A[0] + sd[0] * w0, A[1] + sd[1] * w0, A[2] + sd[2] * w0];
        var B0 = [B[0] - sd[0] * w1, B[1] - sd[1] * w1, B[2] - sd[2] * w1], B1 = [B[0] + sd[0] * w1, B[1] + sd[1] * w1, B[2] + sd[2] * w1];
        treeTri(M, A0, A1, B1, c0, [t0, t0, t1], 0.6); if (w1 > 0) treeTri(M, A0, B1, B0, c0, [t0, t1, t1], 0.6);
      }
    }
    var St = Lf.stalk; if (!St || lod) return;
    var ns = Math.round(treeIn(R, St.n));
    for (var j = 0; j < ns; j++) {
      var a = R() * 6.2832, H = K.h * treeIn(R, St.h), lx = Math.cos(a) * H * 0.12, lz = Math.sin(a) * H * 0.12, top = [lx, H, lz];
      treeTube(M, [[0, 0, 0], [lx * 0.4, H * 0.5, lz * 0.4], top], 0.008, 0.005, 3, St.col, 1, 0, null);
      for (var q = 0; q < 9; q++) {
        var t = 0.62 + 0.38 * q / 9, o = [lx * (0.4 + 0.6 * (t - 0.5) * 2), H * t, lz * (0.4 + 0.6 * (t - 0.5) * 2)], sg = q % 2 ? 1 : -1, ox = -Math.sin(a) * sg, oz = Math.cos(a) * sg;
        var e = [o[0] + ox * 0.07, o[1] - 0.09, o[2] + oz * 0.07], m2 = [o[0] + ox * 0.035, o[1] - 0.045, o[2] + oz * 0.035], wx = Math.cos(a) * 0.022, wz = Math.sin(a) * 0.022;   // 一個穗 ＝ 一片菱形（兩個三角形）
        treeTri(M, o, [m2[0] + wx, m2[1], m2[2] + wz], e, St.seed, [1, 1, 1], 0.5); treeTri(M, o, e, [m2[0] - wx, m2[1], m2[2] - wz], St.seed, [1, 1, 1], 0.5);
      }
    }
  },
  /** 蓮座葉（龍舌蘭）：從地面一圈長出 n 片厚葉（裡面的直立、外面的攤開往下彎）；一片 ＝ 一根中線 ＋ 兩邊往上翹的邊（槽形）、尖端收成一點；邊緣偏黃。
   *  stalk.v 列的那幾棵抽一根花梗：管子往上、上半截伸出一圈短枝、枝尖一簇黃花。 */
  rosette: function (M) {
    var K = M.K, Lf = M.S.leaf, R = M.R, lod = M.lod, c = K.tips[0].p, n = Math.round(treeIn(R, Lf.n) * (lod ? 0.5 : 1)), segs = lod ? 2 : 4;
    for (var f = 0; f < n; f++) {
      var u = (f + 0.5) / n, az = f * 2.39996 + (R() - 0.5) * 0.4, el = (Lf.rise[1] + (Lf.rise[0] - Lf.rise[1]) * u + (R() - 0.5) * 10) * Math.PI / 180;
      var L = K.h * treeIn(R, Lf.len) * (0.6 + 0.4 * u), k = 1 + (R() - 0.5) * 2 * Lf.vary, col = [Lf.col[0] * k, Lf.col[1] * k, Lf.col[2] * k], ec = [Lf.edge[0] * k, Lf.edge[1] * k, Lf.edge[2] * k];
      var d = [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)], p = [c[0], c[1], c[2]], P = [p];
      for (var s = 1; s <= segs; s++) { d = treeNorm([d[0], d[1] - Lf.droop * (1 - u * 0.5) / segs, d[2]]); p = [p[0] + d[0] * L / segs, p[1] + d[1] * L / segs, p[2] + d[2] * L / segs]; P.push(p); }
      var side = treeNorm(treeCross([Math.cos(az), 0, Math.sin(az)], [0, 1, 0])), W = Lf.w * K.h;
      for (s = 0; s < segs; s++) {
        var w0 = W * (1 - s / segs), w1 = W * (1 - (s + 1) / segs), C0 = P[s], C1 = P[s + 1], sw0 = 0.1 * s / segs, sw1 = 0.1 * (s + 1) / segs;
        [1, -1].forEach(function (sg) {
          var E0 = [C0[0] + side[0] * w0 * sg, C0[1] + w0 * 0.45, C0[2] + side[2] * w0 * sg], E1 = [C1[0] + side[0] * w1 * sg, C1[1] + w1 * 0.45, C1[2] + side[2] * w1 * sg];
          treeTri(M, C0, C1, E1, col, [sw0, sw1, sw1], 0.3); treeTri(M, C0, E1, E0, s === segs - 1 ? col : ec, [sw0, sw1, sw0], 0.3);
        });
      }
    }
    var St = Lf.stalk; if (!St || St.v.indexOf(K.v) < 0) return;
    var H = K.h * treeIn(R, St.h), P2 = [c], q = c.slice(), dd = [(R() - 0.5) * 0.12, 1, (R() - 0.5) * 0.12];
    for (s = 1; s <= 5; s++) { dd = treeNorm([dd[0] + (R() - 0.5) * 0.06, dd[1], dd[2] + (R() - 0.5) * 0.06]); q = [q[0] + dd[0] * H / 5, q[1] + dd[1] * H / 5, q[2] + dd[2] * H / 5]; P2.push(q); }
    treeTube(M, P2, St.r, St.r * 0.4, lod ? 3 : 5, St.col, 1, 0, null);
    var na = Math.round(treeIn(R, St.arms));
    for (var a = 0; a < na; a++) {
      var t = 0.62 + 0.36 * a / na, o = treeAt(P2, t), ang = a * 2.39996, al = (0.75 - 0.4 * (t - 0.62) / 0.36) * K.h * 0.5, e = [o[0] + Math.cos(ang) * al, o[1] + al * 0.35, o[2] + Math.sin(ang) * al];
      if (!lod) treeTube(M, [o, e], St.r * 0.4, St.r * 0.25, 3, St.col, 1, 0, null);
      treeBall(M, [e[0], e[1] + 0.08, e[2]], 0.16 + 0.08 * R(), 0.8, St.flower, 0.6, null);
    }
  }
};
