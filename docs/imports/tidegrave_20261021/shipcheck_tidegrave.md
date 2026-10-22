# 匯入檢查：潮墓號（tidegrave）

> `python -I admin.py shipcheck --id tidegrave` 產生；規則在 `js/75_shipcheck.js`。開一場（跟憲法號隔最遠、打不到）跑 2 秒量的。
> ✗ 錯誤 ＝ 遊戲裡壞掉；⚠ 警告 ＝ 能動，但照退路或預設跑。修法裡的「造船規格」＝ `senate cmd doc --arg op=show --arg name=Sculpture_Shipbuilding`。

| 砲 | 站不滿的砲 | 船員 | 模型 | 繩 | 帆 | 桅 | 彈藥庫 | 甲板 | 梯子 | 艙房 | 錨 | 水線 z |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 54 | 0 門缺 0 人 | 356 | 194 | 502 | 10（＋陣營旗 3） | 3 | 2（取用點 6） | 6 | 7 | 0 | 左模型＋ring＋hawse、右模型＋ring＋hawse | 52 |

材質（TASK-0616）：全船預設 橡木（oak）1,033,327 格、723.3 噸

平滑渲染（關聯 meta render=smooth，TASK-0616）：—

火藥（送藥手：取用點 → 砲尾藥箱）：54／54 門走得到取用點；最遠 11.6 m（甲板-weather/chase-2，送一趟來回約 9.7 秒）

迴旋砲／砲塔（meta mount；沒標 ＝ 固定）：—

砲塔層（關聯 meta kind=turret；殼、上面的砲與模型、彈藥箱跟著轉，前方 front 對準瞄準方位，TASK-0659）：—

砲帶的裝甲（關聯 meta kind=armor、mount；跟著砲轉、一格一格打掉，TASK-0631）：—

門、艙蓋（模型 meta kind=door、固定點 hinge-a／hinge-b；不擋人、打掉了開口才進水，TASK-0638）：—

砲門蓋板（模型 meta kind=portlid、lid_of、固定點 hinge-a／hinge-b；本身是裝飾，交戰掀蓋推砲、沒事收砲闔蓋，只是畫面，TASK-0719）：48 片（P 24、S 24）；house 4–7 格；close 73–88°；沒有蓋板的砲：gun-50、gun-49、gun-51、gun-53、gun-52、gun-54；畫質「砲門的開關演出」每艘

後座（開火沿砲軸往裡退、裝填快好推出去；模型 meta recoil 格數，0 ＝ 不演；弩箭／火箭／石彈／希臘火不演；只是畫面）：沒有蓋板的砲 6 門（退 9 格）；有蓋板的 48 門（照 house）；不演：沒有；畫質「砲門的開關演出」每艘

照參數轉的子物件（模型 meta spin；舵、舵輪跟著舵角轉，只是畫面，TASK-0640）：舵（rudder × 30°、-30°～30°）；rudder-bearing-moving（rudder × 30°、-30°～30°）；甲板-quarter/舵輪（rudder × 540°、無上限）

裝飾（模型 meta deco=1；載入時拿掉、畫質「裝飾」開著才畫，不算重量、不被打，TASK-0682）：67 個模型（畫質「裝飾」開：畫）；不算重量、不被打

廚房（模型 meta kind=galley；廚師站在爐灶旁、預備水手當伙夫去領飯，TASK-0720）：—

額外動力（TASK-0630；輸出物件 份量；主機／軸／鍋爐 照造船規格 §9.6；槳 §9.10，TASK-0691）：—（沒有 cfg.base）

動力件（TASK-0653；關聯 meta kind=engine／boiler／shaft／steampipe 的格子清單，照剩幾成、通不通算）：—

會轉的體素件（螺旋槳模型 meta kind=propeller 的格子；跟著軸轉、一格一格打掉、推力照剩幾成，TASK-0653 第二段）：—

操舵（TASK-0777；每支舵的鏈 舵令 ⇒ 舵輪／舵柄 meta kind=wheel／tiller（＋舵索 meta steer）⇒ 舵 kind=rudder、份量 helm_share；造船規格 §9.8.1）：舵令 ⇒ 甲板-quarter/舵輪 ⇒ 舵 100%

**✗ 0　⚠ 1**

## ⚠ 警告

- **站不下**：送藥手 站得到 24／25
  - 哪裡：`送藥手`
  - 修法：遊戲那側調船員配置，或甲板上留出站位
