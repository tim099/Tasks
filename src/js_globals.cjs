// 區塊職責：每支 JS 檔的頂層宣告（function、var／let／const、class；解構也拆開）—— admin.py 建置前擋「同一個包裡兩支檔定義同一個名字」（TASK-0671）。
// 物理意義：包（data-bundle）裡的檔接成同一個閉包；兩支檔定義同一個頂層名字 ⇒ 後面的靜悄悄蓋掉前面的（10-15：78_funnel 的 rndF 蓋掉 33_flood 的 rndF，對拍中段分岔）。
// 用法：node --expose-internals js_globals.cjs <檔1> <檔2> …   ⇒ 印一行 JSON：{ 檔: [[名字, 行], …] }；解析失敗 ⇒ { 檔: { err } }
// ⛔ 用 node 內部的 acorn（--expose-internals）：沒有 node ⇒ admin.py 照「沒驗」寫讀數，不當成過。
'use strict';
const fs = require('fs');
const acorn = require('internal/deps/acorn/acorn/dist/acorn');
function names(p, out) {
  if (!p) return;
  if (p.type === 'Identifier') out.push(p);
  else if (p.type === 'ObjectPattern') p.properties.forEach(function (q) { names(q.type === 'RestElement' ? q.argument : q.value, out); });
  else if (p.type === 'ArrayPattern') p.elements.forEach(function (q) { names(q, out); });
  else if (p.type === 'RestElement') names(p.argument, out);
  else if (p.type === 'AssignmentPattern') names(p.left, out);
}
// --writes：這幾支檔是同一個包（同一個閉包）⇒ 另外列「寫入一個哪裡都沒宣告的名字」（區域變數忘了 var：嚴格模式下執行到才報錯；
//   寫到 window 本來就有的名字（name、status…）連錯都不報）。範圍照函式算（參數、var／let／const／class、函式名、catch 參數都算進那個函式；
//   區塊範圍當成函式範圍 ⇒ 只會少報、不會亂報）；最外層 ＝ 整個包的頂層名字。
// --retired a,b,c：這幾個名字改名了（admin.py RENAMED）⇒ 另外列「還在用舊名字、而且沒被區域宣告遮住」的地方（別人的分支合進來還在叫舊名 ⇒ 執行到才 ReferenceError）。
const writes = process.argv[2] === '--writes';
const retired = process.argv[2] === '--retired' ? new Set(process.argv[3].split(',').filter(Boolean)) : null;
const files = process.argv.slice(writes ? 3 : retired ? 4 : 2);
function kids(n, fn) {
  for (const k of Object.keys(n)) {
    if (k === 'loc') continue;
    const v = n[k];
    if (Array.isArray(v)) v.forEach(function (x) { if (x && typeof x.type === 'string') fn(x, k); });
    else if (v && typeof v.type === 'string') fn(v, k);
  }
}
function isFn(n) { return n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression'; }
/** 一個函式（或整支檔）自己宣告的名字：不進到裡面的函式（但裡面那個函式的名字算這一層的）。 */
function declared(body, set) {
  (function walk(n) {
    if (n.type === 'VariableDeclaration') n.declarations.forEach(function (d) { const L = []; names(d.id, L); L.forEach(function (id) { set.add(id.name); }); });
    if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') && n.id) set.add(n.id.name);
    if (n.type === 'CatchClause' && n.param) { const L = []; names(n.param, L); L.forEach(function (id) { set.add(id.name); }); }
    if (isFn(n) || n.type === 'ClassExpression') return;
    kids(n, walk);
  })(body);
  return set;
}
const res = {}, trees = {};
for (const f of files) {
  try {
    const t = acorn.parse(fs.readFileSync(f, 'utf8'), { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowReturnOutsideFunction: true });
    trees[f] = t;
    const L = [];
    for (const s of t.body) {
      const ids = [];
      if ((s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') && s.id) ids.push(s.id);
      else if (s.type === 'VariableDeclaration') s.declarations.forEach(function (d) { names(d.id, ids); });
      ids.forEach(function (id) { L.push([id.name, id.loc.start.line]); });
    }
    res[f] = L;
  } catch (e) {
    res[f] = { err: e.message };
  }
}
if (retired) {
  const old = [];
  for (const f of files) {
    if (!trees[f]) continue;
    (function visit(n, chain, parent, key) {
      if (isFn(n)) {
        const own = new Set();
        if (n.id && n.type === 'FunctionExpression') own.add(n.id.name);
        n.params.forEach(function (p) { const L = []; names(p, L); L.forEach(function (id) { own.add(id.name); }); });
        if (n.type !== 'ArrowFunctionExpression') own.add('arguments');
        declared(n.body, own);
        n.params.forEach(function (p) { if (p.type === 'AssignmentPattern') visit(p.right, chain.concat([own]), p, 'right'); });
        visit(n.body, chain.concat([own]), n, 'body');
        return;
      }
      if (n.type === 'Identifier') {
        if (parent && ((parent.type === 'MemberExpression' && key === 'property' && !parent.computed) ||
            ((parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && key === 'key' && !parent.computed && !parent.shorthand) ||
            ((parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') && key === 'label') ||
            (parent.type === 'CatchClause' && key === 'param'))) return;
        if (retired.has(n.name) && !chain.some(function (s) { return s.has(n.name); })) old.push([f, n.loc.start.line, n.name]);
        return;
      }
      kids(n, function (c, k) { visit(c, chain, n, k); });
    })(trees[f], [], null, null);
  }
  console.log(JSON.stringify({ old: old }));
  process.exit(0);
}
if (!writes) { console.log(JSON.stringify(res)); process.exit(0); }
const top = new Set();
for (const f of files) if (trees[f]) trees[f].body.forEach(function (s) { declared(s, top); });
const bad = [];
for (const f of files) {
  if (!trees[f]) continue;
  (function visit(n, chain) {
    if (isFn(n)) {
      const own = new Set();
      if (n.id && n.type === 'FunctionExpression') own.add(n.id.name);
      n.params.forEach(function (p) { const L = []; names(p, L); L.forEach(function (id) { own.add(id.name); }); });
      if (n.type !== 'ArrowFunctionExpression') own.add('arguments');
      n.params.forEach(function (p) { visit(p, chain.concat([own])); });
      declared(n.body, own);
      visit(n.body, chain.concat([own]));
      return;
    }
    const tgt = [];
    if (n.type === 'AssignmentExpression') names(n.left, tgt);
    else if (n.type === 'UpdateExpression') names(n.argument, tgt);
    else if ((n.type === 'ForInStatement' || n.type === 'ForOfStatement') && n.left.type !== 'VariableDeclaration') names(n.left, tgt);
    tgt.forEach(function (id) {
      if (!chain.some(function (s) { return s.has(id.name); }) && !top.has(id.name)) bad.push([f, id.loc.start.line, id.name]);
    });
    kids(n, function (c) { visit(c, chain); });
  })(trees[f], []);
}
console.log(JSON.stringify({ top: top.size, bad: bad }));
