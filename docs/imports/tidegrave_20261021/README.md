# 潮墓號：2026-10-21新VXK接入

Tim本輪要求「540 完成(含子單) 然後 把新的 VXK 接進遊戲」。TASK-0540與9張子單均已done；手動帆動態邊界由委託人收束，歷史FAIL與限制保留，未改寫成全部自動測試PASS。工作記憶歸檔3099e78，狀態提交5d0897e。

## 匯入內容

從Blockside dev `24ea27f`開隔離worktree，使用當前未修改的`python -I -X utf8 src/admin.py reimport --id tidegrave --work sirius-tidegrave-01m-assembly`。本次只更新潮墓號的船檔、入口manifest與VXK指紋；game.json、物理／渲染程式及其他19艘船檔未改。

作者Sculpture提交b5bfb12：新增固定環座及活動短軸／止推肩，來源4800/3528格、1cm來源格搭顯式scale.1；船體守色移除20格水線上孔，原7428格舵保留。1,033,327格，checksum83f4c007，17部件、241模型、502繩、10帆。

來源候選SHA256 `9a5780caee1df71a635e0b34b376933ec30e94996467a35e042c3b408959286b`。遊戲匯入檔SHA及比較見import_compare.json：靜態body位元組、241模型/網格及10帆逐值相同；502繩只加遊戲產生的bind，464條含新增綁定。其餘header差異為匯出時間與admin寫入的部件cellRuns等衍生資料。雜湊不同不代表船格或索具被移動。

## 實際驗證

- 建置內建還原驗算：20艘、938份網格逐三角相同，格子與header可還原；成品去註解AST513758節點相同。
- shipcheck：0錯誤、1警告，54砲、356船員、7梯、6甲板、2彈藥庫，送藥取用點54/54可達。舵與rudder-bearing-moving均rudder×30°、±30°，舵輪×540°。
- 唯一警告是既有送藥手站位24/25，保留原船員配置；它不是新增支承的meta或轉動錯誤。完整原始報告與繩端綁定讀數附在本目錄。
- 合回dev後再確認srccheck，推dev測試站；正式main/release不變。Blocksail須同步核心pointer並用admin shell重套battle/shell.json，讓海戰頁引用同版船檔。

這份匯入驗證不另宣稱全帆連續動態已通過；依Tim本輪驗收決定收束船舶任務。
