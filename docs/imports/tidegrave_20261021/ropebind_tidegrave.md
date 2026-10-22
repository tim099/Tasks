# 繩端綁定：潮墓號（tidegrave）

> `python -I admin.py ropebind --id tidegrave` 產生（匯入、重新匯入、metasync、ids 會自己跑）；規則在 `js/10_ship.js` ropeDecide：
> 砲塔的殼 → 作品寫明的（ends：`model:` 那個模型、`rope:` 只找繩、`sail:` 與固定點不猜模型）→ 帆桁 → 母繩（≤ 3 格）→ 最後才照外框猜模型。結果寫進 `.vxk` 的 `rig.ropes[].bind`，遊戲照它綁、不猜。

| 綁在 | 端數 |
|---|---|
| 母繩 | 634 |
| 格子（旁邊 5 格內有實心格） | 212 |
| 模型（作品寫明） | 100 |
| 帆桁 | 43 |
| 只靠帆角 | 15 |
