// 區塊職責：同一個包裡每支檔「沒被區域宣告遮住、真的指到頂層名字」的引用（TASK-0669：admin.py layers 量模擬層往上咬）。
// 物理意義：照字面搜名字會把區域變數、屬性名（o.start、局部的 C／D）都算成跨檔引用；這裡照函式範圍判（參數、var／let／const、函式名、catch 都算那一層），
//   只留真的解析到頂層名字的；寫入另外標 w（直接）／m（obj.x = …）、呼叫標 c。
// 用法：node --expose-internals js_refs.cjs <檔1> <檔2> …（照包裡的順序）⇒ 印一行 JSON { defs: {名字: 檔}, refs: [[用的檔, 名字, 行, 'r'|'w'|'m'|'c'], …] }
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
function kids(n, fn) {
  for (const k of Object.keys(n)) {
    if (k === 'loc') continue;
    const v = n[k];
    if (Array.isArray(v)) v.forEach(function (x) { if (x && typeof x.type === 'string') fn(x, k); });
    else if (v && typeof v.type === 'string') fn(v, k);
  }
}
function isFn(n) { return n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression'; }
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
const files = process.argv.slice(2), trees = {}, defs = {};
for (const f of files) {
  trees[f] = acorn.parse(fs.readFileSync(f, 'utf8'), { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowReturnOutsideFunction: true });
  const s = new Set(); trees[f].body.forEach(function (x) { declared(x, s); });
  s.forEach(function (nm) { if (!(nm in defs)) defs[nm] = f; });
}
const refs = [];
for (const f of files) {
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
          ((parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && key === 'key' && !parent.computed) ||
          ((parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') && key === 'label') ||
          (parent.type === 'VariableDeclarator' && key === 'id') || (parent.type === 'CatchClause' && key === 'param') ||
          ((parent.type === 'FunctionDeclaration' || parent.type === 'ClassDeclaration' || parent.type === 'ClassExpression') && key === 'id'))) return;
      if (chain.some(function (s) { return s.has(n.name); })) return;
      if (!(n.name in defs)) return;
      const how = parent && parent.type === 'CallExpression' && key === 'callee' ? 'c' :
        parent && ((parent.type === 'AssignmentExpression' && key === 'left') || parent.type === 'UpdateExpression') ? 'w' : 'r';
      refs.push([f, n.name, n.loc.start.line, how]);
      return;
    }
    // obj.X = …／obj.X++ 也算寫（X 是頂層物件時：CAM.yaw = …）
    if ((n.type === 'AssignmentExpression' || n.type === 'UpdateExpression')) {
      let t = n.type === 'AssignmentExpression' ? n.left : n.argument;
      while (t && t.type === 'MemberExpression') t = t.object;
      if (t && t.type === 'Identifier' && t !== (n.left || n.argument) && !chain.some(function (s) { return s.has(t.name); }) && t.name in defs) refs.push([f, t.name, t.loc.start.line, 'm']);
    }
    kids(n, function (c, k) { visit(c, chain, n, k); });
  })(trees[f], [], null, null);
}
console.log(JSON.stringify({ defs: defs, refs: refs }));
