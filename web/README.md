# 任務單網頁

看 `tasks/*.md` 的純靜態網頁：列表（狀態／專案／種類／人篩選、搜尋標題或單號、排序）＋單張
（驗收標準勾了沒、任務描述、結單說明、留言、活動時間線；母單、子單、擋住／被擋、相關都能點過去）。

| 檔案 | 做什麼 |
|---|---|
| `index.html`、`app.js`、`style.css` | 網頁本身（hash 路由：`#/?status=todo&project=Blocksail`、`#/task/960`） |
| `parse.js` | 單檔解析（frontmatter＋章節）。瀏覽器與 `build.mjs` 共用這一份 |
| `build.mjs` | 產生列表索引 `tasks.json`（Actions 用；本機不用跑） |
| `package.json` | 只是讓 Node 把 `parse.js` 當 ES module 載入，沒有相依套件 |

## 資料怎麼來、為什麼這樣選

**選 GitHub Actions 部署**（`.github/workflows/pages.yml`），不選「把 branch 直接當 Pages」：

- 列表要先知道有哪些單。Pages 不給目錄列表；從瀏覽器打 GitHub API 列檔案有每小時 60 次的上限。
  所以要一份索引 `tasks.json`。
- 這份索引**不 commit 回 repo**：寫單端（`senate cmd task`）每寫一筆就自動推 master，
  Actions 若也往 master 回寫，兩邊會互搶，寫單端的推送會被 non-fast-forward 擋下。
  ⇒ Actions 每次 push 都重產索引，只放進部署產物（`upload-pages-artifact` → `deploy-pages`）。
- 結果：寫單 ⇒ 自動推 ⇒ Actions 重建（約一分鐘）⇒ 網頁就是新的。沒有人要手動更新任何東西。
  連推好幾筆時 `concurrency` 只留最新那一次。
- 單張頁一律讀單檔本身（`tasks/NNNN.md`），不讀索引。

## GitHub Pages 怎麼開

1. repo **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**
   （不是 “Deploy from a branch”，所以不用指定 branch／資料夾）。
2. 推上 master 之後，workflow「Pages」會自己跑；也可以在 Actions 頁手動 Run workflow。
3. 網址：`https://tim099.github.io/Tasks/`（會轉到 `web/`）。

部署出來的結構跟 repo 一樣：`/web/`（網頁＋`tasks.json`）、`/tasks/`（單檔）。

## 本機看

在 repo 根目錄：

```bash
python -m http.server 8000
```

開 <http://127.0.0.1:8000/web/>。本機沒有 `tasks.json` 時，網頁會直接掃 `tasks/` 的目錄列表、
把每張單讀進來（約 1000 張，一兩秒），所以永遠是磁碟上的最新狀態。按右上「重新整理」重讀。

⚠ Windows 上請用 `127.0.0.1`：用 `localhost` 時每個請求可能先試 IPv6 才退回，上千個檔會慢很多。

想在本機看索引模式：`node web/build.mjs --out web/tasks.json`（已列入 `.gitignore`；看完刪掉，不然它會一直是舊的）。

## 單檔格式改了怎麼辦

章節只認 `parse.js` 的 `SECTIONS`（任務描述裡也有 `## 要什麼` 這種二級標題，所以不是見 `##` 就切）。
寫單端新增章節或改欄位時，改 `parse.js` 一處即可，網頁與索引同步。
