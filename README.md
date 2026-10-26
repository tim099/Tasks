# 📋 任務單 (Tasks)

網頁版本 https://tim099.github.io/Tasks/

哼，這裡是大家的任務單倉庫 —— 誰開了什麼單、做到哪一步、驗收勾了幾格、誰留了什麼話，全都記在這裡。
想看進度就直接開上面那個網頁，別再來問本小姐「那張單現在怎樣了」。

## 🔍 網頁怎麼看 (How to View)

1. **列表**：每張單的單號、標題、狀態、種類、專案、開單人、參與者、更新時間，一眼看完。
   - 狀態按鈕可以多選（backlog／todo／in_progress／in_review／done／cancelled），按鈕上的數字是目前條件下的張數。
   - 專案、種類、人（開單或參與）下拉篩選；搜尋框打標題關鍵字或單號（`960`、`TASK-0960` 都行）。
   - 標題底下的 `☑ 5/6` 是驗收標準勾了幾格，`↑ TASK-0957` 是母單，`↓ N 張子單` 是底下有幾張子單。
2. **單張**：點進去看完整內容 —— 驗收標準（勾了沒一眼看得出來）、任務描述、結單說明、留言、活動時間線。
   - 母單、子單、擋住／被擋、相關的單都能直接點過去；內文裡寫到的 `TASK-0957` 也會變成連結。
   - 右上角「原始檔」開的是那張單的 `.md` 本身。
3. **網址帶得住狀態**：篩選條件會留在網址上，可以直接貼給別人。
   - [`…/Tasks/web/#/?status=todo,in_progress&project=Blocksail`](https://tim099.github.io/Tasks/web/#/?status=todo,in_progress&project=Blocksail) —— Blocksail 還沒做完的單
   - [`…/Tasks/web/#/?who=kotoko&sort=index`](https://tim099.github.io/Tasks/web/#/?who=kotoko&sort=index) —— kotoko 開的或參與的，照單號排
   - [`…/Tasks/web/#/task/960`](https://tim099.github.io/Tasks/web/#/task/960) —— 直接開到 TASK-0960
4. **一律是最新的**：`senate cmd task` 寫單之後會自動 commit 並推上來，GitHub Actions 再自己重建網頁，
   大約一分鐘就會反映。**不用任何人手動更新**。開著的頁面按右上「重新整理」就會重讀。

## 📁 倉庫裡有什麼 (Contents)

| 位置 | 是什麼 |
|---|---|
| `tasks/NNNN.md` | 一張單一個檔：frontmatter（狀態、參與者、母單子單、commit…）＋「驗收標準／任務描述／結單說明／留言／活動與討論時間線」幾個章節 |
| `_index.txt` | 寫單端的單號計數（最後一張的號碼） |
| `web/` | 任務單網頁（純靜態，零建置；說明在 [`web/README.md`](web/README.md)） |
| `.github/workflows/pages.yml` | 每次 push 重建並部署 GitHub Pages |

⚠ **不准手改 `tasks/*.md`！** 開單、認領、勾驗收、留言、結單一律走 `senate cmd task`，
怎麼用看 `scp-task` 這個 skill。手改的單不會進時間線，也對不上寫單端的狀態機。

## 🖥️ 本機看 (Local)

在這個 repo 的根目錄：

```bash
python -m http.server 8000
```

開 <http://127.0.0.1:8000/web/>。本機不用先建索引 —— 網頁會直接讀 `tasks/` 底下的每一張單，
所以看到的永遠是磁碟上的最新狀態。

⚠ Windows 上請用 `127.0.0.1`，別用 `localhost`：每個請求可能先試 IPv6 才退回，上千張單會慢很多。

## 🚀 部署 (Deploy)

- GitHub Pages 的 **Source 是「GitHub Actions」**（Settings → Pages），不是從 branch 直接發佈。
- 列表用的索引 `tasks.json` 由 Actions 產生、只放進部署產物，**不會 commit 回 repo** ——
  回寫會跟寫單端的自動推送互搶 master。理由與細節看 [`web/README.md`](web/README.md)。
