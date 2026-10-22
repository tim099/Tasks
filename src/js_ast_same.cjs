// 區塊職責：成品去註解（admin.py js_strip，TASK-0667）的驗算 —— 兩份 JS 照 node 內建的 acorn 解析，語法樹（拿掉位置）逐個節點相同才算過。
// 物理意義：去註解只准拿掉註解與空白；字串、正則、運算子被誤砍 ⇒ 語法樹就不一樣（或解析失敗）。跟 admin.py 的掃描器是兩份各自獨立的讀法。
// 用法：node --expose-internals js_ast_same.cjs <原本.js> <去註解.js>   ⇒ 印一行 JSON：{ ok, nodes, why? }；exit 0 ＝ 相同、1 ＝ 不同或解析失敗
// ⛔ 用的是 node 內部的 acorn（--expose-internals）：沒有 node 或 node 拿掉了它 ⇒ admin.py 照「沒驗」寫讀數，不當成過。
'use strict';
const fs = require('fs');
const acorn = require('internal/deps/acorn/acorn/dist/acorn');
function tree(file) {
  const src = fs.readFileSync(file, 'utf8');
  return acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
}
let nodes = 0;
function strip(n) {
  if (Array.isArray(n)) return n.map(strip);
  if (!n || typeof n !== 'object') return n;
  if (n.type) nodes++;
  const o = {};
  for (const k of Object.keys(n)) if (k !== 'start' && k !== 'end' && k !== 'loc' && k !== 'range') o[k] = strip(n[k]);
  return o;
}
try {
  const a = JSON.stringify(strip(tree(process.argv[2]))), na = nodes;
  nodes = 0;
  const b = JSON.stringify(strip(tree(process.argv[3])));
  if (a !== b) {
    let i = 0; while (i < a.length && a[i] === b[i]) i++;
    console.log(JSON.stringify({ ok: false, nodes: na, why: '語法樹不同，第一個差在：' + a.slice(Math.max(0, i - 80), i + 80) + ' ⇔ ' + b.slice(Math.max(0, i - 80), i + 80) }));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, nodes: na }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, nodes: 0, why: '解析失敗：' + e.message }));
  process.exit(1);
}
