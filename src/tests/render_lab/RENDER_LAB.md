# render_lab：畫面改動的量測與對拍（2026-10-21，render 管線大修用）

無頭 Chrome（真的 GPU）開成品，同一個種子、同一個鏡頭、固定的時鐘，量：
- **畫面**：每組設定拍一張無 MSAA 的（逐位元組可重現）＋一張照畫質的（MSAA 不能重現，只比自己的雜訊）；
- **模擬**：戰局雜湊、帆繩的物理雜湊（每個檢查點）——「只改畫面」的關卡；
- **數量**：每格的 draw call（照程式、照 pass）、GL 呼叫、頂點數、上傳的位元組；
- **時間**：`tick(1)` 與只畫不走模擬的那一格（雜訊大，交錯量）。

| 檔 | 做什麼 |
|---|---|
| `harness.py` | 指令：`measure`／`ab`（兩版交錯量）／`quick`（只對拍，不量時間）／`compare`／`report`／`snapshot`（把 worktree 的成品凍成一份）／`smoke`（各頁面、各網址開關開起來有沒有新的錯）／`cullsweep`（鏡頭外的船不畫：鏡頭一步一步掃過畫面邊緣，同一頁剔除開、關逐格比主畫面與反射圖，TASK-0813）／`probe` |
| `cdp.py` | 最小的 Chrome 除錯協定用戶端（不加依賴；確認接到的是自己開的 Chrome，不會去動別人的） |
| `inject.js` | 頁面腳本之前塞進去：亂數照種子、時鐘固定、rAF 停掉（只照 `__game.tick` 走）、包 WebGL 的呼叫來數、物理雜湊、`--skip-programs` |
| `playtest.py` | 真的時鐘、真的 rAF 玩一輪：主選單按開戰、開砲、長時間的對戰、換船、剖面、觀察模式勾部件高亮、`?inst=0&sailk=0` |
| `NOTES.md` | 全部的指令、旗標、20 組設定（含帆撕破＋燒起來、剖面、夜裡的燈、斷開的一團、混合艦隊）、比對的輸出怎麼讀（英文） |

產物放 `reports/render_lab/`（不進版控；`RENDER_LAB_DIR` 可以換）。在 Blockside 根目錄跑，例：

```
python -I -X utf8 src/tests/render_lab/harness.py snapshot --src . --name mine
python -I -X utf8 src/tests/render_lab/harness.py quick --a reports/render_lab/runs/base_<sha> --b reports/render_lab/builds/mine/index.html --out reports/render_lab/runs/mine_quick
python -I -X utf8 src/tests/render_lab/harness.py smoke --html reports/render_lab/builds/mine/index.html --base reports/render_lab/builds/base_<sha>/index.html --out reports/render_lab/runs/mine_smoke
python -I -X utf8 src/tests/render_lab/playtest.py reports/render_lab/builds/mine/index.html
python -I -X utf8 src/tests/render_lab/harness.py cullsweep --html reports/render_lab/builds/mine/index.html --out reports/render_lab/runs/mine_sweep [--sweeps fast] [--q inst=0]
```

`-X utf8`：頁面的字是中文、主控台是 cp950。逐位元組只在 Chrome＋ANGLE D3D11 驗過（`--gpu default`）。怎麼用在 render 管線大修見任務單 TASK-0781「怎麼接著做」。
