// 任務單網頁：列表（篩選／搜尋）＋單張（驗收標準、描述、留言、時間線、母單子單互連）。
// 資料來源二選一，同一份 parse.js 解析：
//   1. tasks.json —— GitHub Pages 上由 Actions 跑 build.mjs 產生（列表欄位），單張再讀 ../tasks/NNNN.md
//   2. 讀不到 tasks.json（本機 `python -m http.server`）⇒ 掃 ../tasks/ 的目錄列表，把每張單都讀進來
import { parseTask, parseChecklist, parseComments, parseTimeline, padId, STATUSES } from './parse.js';

const TASKS_DIR = '../tasks/';
const $app = document.getElementById('app');
const $source = document.getElementById('source');

const STATUS_LABEL = {
  backlog: 'backlog', todo: 'todo', in_progress: 'in_progress',
  in_review: 'in_review', done: 'done', cancelled: 'cancelled',
};

let tasks = [];
const byIndex = new Map();
const children = new Map();
const textCache = new Map();
let lastListHash = '#/';

// ---------- 載入 ----------

async function load() {
  tasks = [];
  byIndex.clear();
  children.clear();
  textCache.clear();
  try {
    const res = await fetch('tasks.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    tasks = data.tasks;
    const when = data.generated_at ? fmtTime(data.generated_at) : '';
    $source.textContent = `索引產生於 ${when}${data.commit ? '（' + data.commit.slice(0, 7) + '）' : ''}`;
  } catch {
    await loadFromDirectory();
  }
  for (const t of tasks) byIndex.set(t.index, t);
  // 子單：母單上的 subtask_indices ∪ 指向它的 epic_id（兩邊有一邊漏寫也接得起來）
  for (const t of tasks) {
    for (const s of t.subtasks) addChild(t.index, s);
    if (t.epic !== null) addChild(t.epic, t.index);
  }
}

function addChild(parent, child) {
  if (!children.has(parent)) children.set(parent, new Set());
  children.get(parent).add(child);
}

async function loadFromDirectory() {
  const res = await fetch(TASKS_DIR, { cache: 'no-cache' });
  if (!res.ok) throw new Error('讀不到 tasks.json，也讀不到 tasks/ 目錄列表');
  const html = await res.text();
  const files = [...new Set([...html.matchAll(/href="(\d+\.md)"/g)].map(m => m[1]))].sort();
  let done = 0;
  const out = new Array(files.length);
  const queue = files.map((f, i) => [f, i]);
  async function worker() {
    while (queue.length) {
      const [f, i] = queue.shift();
      const text = await (await fetch(TASKS_DIR + f, { cache: 'no-cache' })).text();
      textCache.set(f, text);
      out[i] = { file: f, ...parseTask(text).summary };
      if (++done % 50 === 0) $app.innerHTML = `<p class="muted">讀取中… ${done}／${files.length}</p>`;
    }
  }
  await Promise.all(Array.from({ length: 16 }, worker));
  tasks = out.filter(Boolean);
  $source.textContent = `直接讀 tasks/（${tasks.length} 張，${fmtTime(new Date().toISOString())}）`;
}

async function taskText(t) {
  if (textCache.has(t.file)) return textCache.get(t.file);
  const res = await fetch(TASKS_DIR + t.file, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${t.file}：${res.status}`);
  const text = await res.text();
  textCache.set(t.file, text);
  return text;
}

// ---------- 小工具 ----------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function timeTag(iso) {
  return iso ? `<time datetime="${esc(iso)}" title="${esc(iso)}">${esc(fmtTime(iso))}</time>` : '';
}

function badge(status) {
  return `<span class="st st-${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>`;
}

function people(t) {
  return t.participants.map(p => `${esc(p.persona)}<span class="role">${esc(p.role)}</span>`).join(' ');
}

function md(src) {
  if (!src) return '';
  let html;
  if (window.marked && window.DOMPurify) {
    html = DOMPurify.sanitize(marked.parse(src, { gfm: true, breaks: true }));
  } else {
    html = `<pre class="plain">${esc(src)}</pre>`;
  }
  const box = document.createElement('div');
  box.innerHTML = html;
  linkTasks(box);
  return box.innerHTML;
}

// 內文裡的 TASK-0957 變成可以點過去的連結（跳過程式碼與既有連結）
function linkTasks(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement.closest('a, code, pre')) continue;
    if (/TASK-\d+/.test(n.nodeValue)) hits.push(n);
  }
  for (const n of hits) {
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of n.nodeValue.matchAll(/TASK-(\d+)/g)) {
      frag.append(n.nodeValue.slice(last, m.index));
      const a = document.createElement('a');
      a.href = `#/task/${Number(m[1])}`;
      a.textContent = m[0];
      const t = byIndex.get(Number(m[1]));
      if (t) a.title = t.title;
      frag.append(a);
      last = m.index + m[0].length;
    }
    frag.append(n.nodeValue.slice(last));
    n.replaceWith(frag);
  }
}

function taskRef(n) {
  const t = byIndex.get(n);
  if (!t) return `<li><span class="muted">${esc(padId(n))}（找不到這張單）</span></li>`;
  return `<li><a href="#/task/${n}">${esc(t.id || padId(n))}</a> ${badge(t.status)} ${esc(t.title)}</li>`;
}

// ---------- 列表 ----------

function readFilters(hash) {
  const q = new URLSearchParams(hash.split('?')[1] || '');
  return {
    q: q.get('q') || '',
    status: (q.get('status') || '').split(',').filter(Boolean),
    project: q.get('project') || '',
    type: q.get('type') || '',
    who: q.get('who') || '',
    sort: q.get('sort') || 'updated',
  };
}

function writeFilters(f) {
  const q = new URLSearchParams();
  if (f.q) q.set('q', f.q);
  if (f.status.length) q.set('status', f.status.join(','));
  if (f.project) q.set('project', f.project);
  if (f.type) q.set('type', f.type);
  if (f.who) q.set('who', f.who);
  if (f.sort !== 'updated') q.set('sort', f.sort);
  const s = q.toString();
  return '#/' + (s ? '?' + s : '');
}

function options(values, current, allLabel) {
  return `<option value="">${esc(allLabel)}</option>` +
    values.map(v => `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(v)}</option>`).join('');
}

function uniq(list) {
  return [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function matches(t, f) {
  if (f.status.length && !f.status.includes(t.status)) return false;
  if (f.project && (f.project === '（無）' ? t.project : t.project !== f.project)) return false;
  if (f.type && t.type !== f.type) return false;
  if (f.who && t.reporter !== f.who && !t.participants.some(p => p.persona === f.who)) return false;
  if (f.q) {
    const q = f.q.toLowerCase().trim();
    const num = q.match(/^(?:task-)?#?(\d+)$/);
    if (num) return t.index === Number(num[1]) || t.title.toLowerCase().includes(q);
    return q.split(/\s+/).every(w => t.title.toLowerCase().includes(w));
  }
  return true;
}

const SORTS = {
  updated: ['更新時間（新→舊）', (a, b) => b.updated_at.localeCompare(a.updated_at)],
  created: ['開單時間（新→舊）', (a, b) => b.created_at.localeCompare(a.created_at)],
  index: ['單號（大→小）', (a, b) => b.index - a.index],
  index_asc: ['單號（小→大）', (a, b) => a.index - b.index],
};

// 篩選列只畫一次；改條件時只重畫狀態按鈕、張數與列表（打字中重畫輸入框會打斷輸入法選字）
function renderList(hash) {
  lastListHash = hash || '#/';
  const f = readFilters(hash);
  const projects = uniq(tasks.map(t => t.project));
  if (tasks.some(t => !t.project)) projects.push('（無）');

  $app.innerHTML = `
  <section class="filters">
    <input id="q" type="search" placeholder="搜尋標題或單號" value="${esc(f.q)}" autocomplete="off">
    <div class="chips" id="chips"></div>
    <div class="selects">
      <select id="project">${options(projects, f.project, '所有專案')}</select>
      <select id="type">${options(uniq(tasks.map(t => t.type)), f.type, '所有種類')}</select>
      <select id="who">${options(uniq(tasks.flatMap(t => [t.reporter, ...t.participants.map(p => p.persona)])), f.who, '所有人')}</select>
      <select id="sort">${Object.entries(SORTS).map(([k, [label]]) => `<option value="${k}"${k === f.sort ? ' selected' : ''}>${label}</option>`).join('')}</select>
      <a class="clear" href="#/">清除篩選</a>
    </div>
  </section>
  <p class="count muted" id="count"></p>
  <div class="list" role="table">
    <div class="row head" role="row">
      <span>單號</span><span>標題</span><span>狀態</span><span>種類</span><span>專案</span><span>開單</span><span>參與</span><span>更新</span>
    </div>
    <div id="rows"></div>
  </div>`;

  const go = patch => {
    const next = writeFilters({ ...readFilters(location.hash), ...patch });
    history.replaceState(null, '', next);
    lastListHash = next;
    fillList(readFilters(next));
  };
  const $q = document.getElementById('q');
  $q.addEventListener('input', e => { if (!e.isComposing) go({ q: $q.value }); });
  $q.addEventListener('compositionend', () => go({ q: $q.value }));
  for (const id of ['project', 'type', 'who', 'sort']) {
    document.getElementById(id).addEventListener('change', e => go({ [id]: e.target.value }));
  }
  document.getElementById('chips').addEventListener('click', e => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    const s = b.dataset.status;
    const cur = readFilters(location.hash).status;
    go({ status: cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s] });
  });
  fillList(f);
}

function fillList(f) {
  const base = tasks.filter(t => matches(t, { ...f, status: [] }));
  const counts = {};
  for (const t of base) counts[t.status] = (counts[t.status] || 0) + 1;
  const shown = base.filter(t => !f.status.length || f.status.includes(t.status)).sort(SORTS[f.sort]?.[1] || SORTS.updated[1]);
  document.getElementById('chips').innerHTML = STATUSES.map(s =>
    `<button type="button" class="chip st-${s}${f.status.includes(s) ? ' on' : ''}" data-status="${s}" aria-pressed="${f.status.includes(s)}">${s} <b>${counts[s] || 0}</b></button>`).join('');
  document.getElementById('count').textContent = `顯示 ${shown.length}／${tasks.length} 張`;
  document.getElementById('rows').innerHTML = shown.map(rowHtml).join('');
}

function rowHtml(t) {
  const [done, total] = t.ac;
  const kids = children.get(t.index)?.size || 0;
  return `<a class="row" role="row" href="#/task/${t.index}">
    <span class="idx">${esc(t.id || padId(t.index))}</span>
    <span class="title">${esc(t.title)}
      <span class="sub">
        ${total ? `<span class="ac${done === total ? ' full' : ''}" title="驗收標準">☑ ${done}/${total}</span>` : ''}
        ${t.epic !== null ? `<span class="rel" title="母單">↑ ${esc(padId(t.epic))}</span>` : ''}
        ${kids ? `<span class="rel" title="子單">↓ ${kids} 張子單</span>` : ''}
      </span>
    </span>
    <span>${badge(t.status)}</span>
    <span class="type" data-l="種類">${esc(t.type)}</span>
    <span data-l="專案">${esc(t.project)}</span>
    <span data-l="開單">${esc(t.reporter)}</span>
    <span class="who" data-l="參與">${people(t)}</span>
    <span class="time" data-l="更新">${timeTag(t.updated_at)}</span>
  </a>`;
}

// ---------- 單張 ----------

async function renderTask(n) {
  const t = byIndex.get(n);
  if (!t) {
    $app.innerHTML = `<p><a href="${esc(lastListHash)}">← 回列表</a></p><p>找不到 ${esc(padId(n))}。</p>`;
    return;
  }
  $app.innerHTML = `<p class="muted">讀取 ${esc(t.file)}…</p>`;
  let parsed;
  try {
    parsed = parseTask(await taskText(t));
  } catch (e) {
    $app.innerHTML = `<p><a href="${esc(lastListHash)}">← 回列表</a></p><p>讀不到單：${esc(e.message)}</p>`;
    return;
  }
  // 單張畫面以單檔本身為準（索引可能比單檔舊幾分鐘）
  const s = { ...t, ...parsed.summary };
  const sec = parsed.sections;
  const ac = parseChecklist(sec['驗收標準'] || '');
  const comments = parseComments(sec['留言'] || '');
  const timeline = parseTimeline(sec['活動與討論時間線'] || '');
  const kids = [...(children.get(n) || [])].sort((a, b) => a - b);
  const [acDone, acTotal] = s.ac;
  document.title = `${s.id} ${s.title}`;

  const meta = [
    ['種類', esc(s.type)],
    ['優先', esc(s.priority)],
    s.severity && ['嚴重度', esc(s.severity)],
    ['專案', esc(s.project) || '<span class="muted">—</span>'],
    s.milestone && ['里程碑', esc(s.milestone)],
    ['開單', esc(s.reporter)],
    ['參與', people(s) || '<span class="muted">—</span>'],
    ['建立', timeTag(s.created_at)],
    ['更新', timeTag(s.updated_at)],
    s.closed_at && ['結單', timeTag(s.closed_at)],
    s.tags.length && ['標籤', s.tags.map(x => `<span class="tag">${esc(x)}</span>`).join(' ')],
    s.commits.length && ['commit', s.commits.map(x => `<code>${esc(x)}</code>`).join(' ')],
  ].filter(Boolean);

  const rel = [
    s.epic !== null && ['母單', [s.epic]],
    kids.length && [`子單（${kids.filter(k => ['done', 'cancelled'].includes(byIndex.get(k)?.status)).length}／${kids.length} 已收）`, kids],
    s.blocked_by.length && ['被它擋住', s.blocked_by],
    s.blocks.length && ['它擋住', s.blocks],
    s.related_to.length && ['相關', s.related_to],
  ].filter(Boolean);

  $app.innerHTML = `
  <nav class="crumbs"><a href="${esc(lastListHash)}">← 回列表</a>
    <a class="muted" href="${esc(TASKS_DIR + t.file)}" target="_blank" rel="noopener">原始檔 ${esc(t.file)}</a></nav>
  <article class="task">
    <h1><span class="idx">${esc(s.id)}</span> ${esc(s.title)}</h1>
    <p>${badge(s.status)}</p>
    <dl class="meta">${meta.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    ${rel.length ? `<section class="rels">${rel.map(([k, list]) => `<div><h3>${k}</h3><ul>${list.map(taskRef).join('')}</ul></div>`).join('')}</section>` : ''}

    <section><h2>驗收標準 <span class="muted">${acDone}／${acTotal}</span></h2>
      ${ac.pre ? md(ac.pre) : ''}
      ${ac.length ? `<ul class="checks">${ac.map(i => `<li class="${i.done ? 'done' : ''}"><span class="box" role="img" aria-label="${i.done ? '已勾' : '未勾'}">${i.done ? '✓' : ''}</span><div>${md(i.text)}</div></li>`).join('')}</ul>` : '<p class="muted">（沒有驗收標準）</p>'}
    </section>

    <section><h2>任務描述</h2><div class="md">${md(sec['任務描述']) || '<p class="muted">（空）</p>'}</div></section>

    ${sec['結單說明'] ? `<section><h2>結單說明</h2><div class="md">${md(sec['結單說明'])}</div></section>` : ''}

    <section><h2>留言 <span class="muted">${comments.length}</span></h2>
      ${comments.length ? comments.map(c => `<div class="comment" id="c${c.n}">
        <div class="chead"><b>#${c.n}</b> ${esc(c.author)} ${timeTag(c.at)} ${esc(c.extra)}</div>
        <div class="md">${md(c.body)}</div></div>`).join('') : '<p class="muted">（沒有留言）</p>'}
    </section>

    <section><h2>活動與討論時間線</h2>
      <ol class="timeline">${timeline.map(e => `<li><span class="time">${timeTag(e.at)}</span>
        <span>${e.kind ? `<span class="kind st-${esc(e.kind)}">${esc(e.kind)}</span>` : ''}</span>
        <span class="md inline">${md(e.text)}</span></li>`).join('')}</ol>
    </section>
  </article>`;
  window.scrollTo(0, 0);
}

// ---------- 路由 ----------

function route() {
  const hash = location.hash || '#/';
  const m = hash.match(/^#\/task\/(\d+)/);
  if (m) {
    renderTask(Number(m[1]));
  } else {
    document.title = '任務單';
    renderList(hash);
  }
}

async function start() {
  try {
    await load();
  } catch (e) {
    $app.innerHTML = `<p>讀不到任務單：${esc(e.message)}</p>`;
    return;
  }
  route();
}

window.addEventListener('hashchange', route);
document.getElementById('reload').addEventListener('click', start);
start();
