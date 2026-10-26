// 產生列表索引 tasks.json：讀 tasks/*.md，每張單留列表要用的欄位。
// GitHub Actions（.github/workflows/pages.yml）每次 push 都跑這支，產物只進 Pages、不 commit 回 repo。
// 本機不需要跑：用 `python -m http.server` 開時，網頁讀不到 tasks.json 會直接掃 tasks/ 目錄。
//
//   node web/build.mjs --out <輸出檔> [--tasks <tasks 目錄>]
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTask } from './parse.js';

const args = process.argv.slice(2);
const opt = k => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = opt('--out');
if (!out) {
  console.error('usage: node web/build.mjs --out <path> [--tasks <dir>]');
  process.exit(2);
}
const tasksDir = resolve(opt('--tasks') ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'tasks'));

const files = readdirSync(tasksDir).filter(f => /^\d+\.md$/.test(f)).sort();
const tasks = [];
const bad = [];
for (const f of files) {
  const { summary } = parseTask(readFileSync(join(tasksDir, f), 'utf8'));
  if (summary.index === null || !summary.title) bad.push(f);
  tasks.push({ file: f, ...summary });
}

const index = {
  generated_at: new Date().toISOString(),
  commit: process.env.GITHUB_SHA || '',
  tasks,
};
mkdirSync(dirname(resolve(out)), { recursive: true });
writeFileSync(out, JSON.stringify(index));

const byStatus = {};
for (const t of tasks) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
console.log(`tasks.json: ${tasks.length} 張（${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join('、')}）⇒ ${out}`);
if (bad.length) console.log(`⚠ 讀不到單號或標題：${bad.join(', ')}`);
