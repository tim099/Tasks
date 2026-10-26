// 任務單（tasks/NNNN.md）的解析 —— 瀏覽器與 Node（build.mjs）共用同一份，不另寫第二把尺。
// 單的格式由 Senate 的 `senate cmd task` 寫出：YAML 風格的 frontmatter ＋ 固定幾個「## 」章節。
// ⚠ 任務描述裡面也常有「## 要什麼」這種二級標題，所以章節只認下面這幾個名字，不是見 ## 就切。

export const SECTIONS = ['驗收標準', '任務描述', '結單說明', '留言', '活動與討論時間線'];

export const STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'];

// "TASK-0957" / "957" / 957 ⇒ 957；空的 ⇒ null
export function taskNum(v) {
  if (v === null || v === undefined) return null;
  const m = String(v).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

export function padId(n) {
  return 'TASK-' + String(n).padStart(4, '0');
}

function scalar(raw) {
  const v = raw.trim();
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    return inner ? inner.split(',').map(s => unquote(s.trim())) : [];
  }
  return unquote(v);
}

function unquote(v) {
  if (v.length >= 2 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) return v.slice(1, -1);
  return v;
}

// 只吃寫入端會寫的那幾種形狀：`key: 值`、`key: [a, b]`、`key:` 底下接 `  - k: v` 物件清單
export function parseFrontmatter(src) {
  const out = {};
  const blank = new Set();
  let listKey = null;
  for (const line of src.split('\n')) {
    if (!line.trim()) continue;
    const item = line.match(/^\s+-\s+(\w+):\s?(.*)$/);
    if (item && listKey) {
      out[listKey].push({ [item[1]]: scalar(item[2]) });
      continue;
    }
    const cont = line.match(/^\s+(\w+):\s?(.*)$/);
    if (cont && listKey && out[listKey].length) {
      out[listKey].at(-1)[cont[1]] = scalar(cont[2]);
      continue;
    }
    const kv = line.match(/^(\w+):\s?(.*)$/);
    if (!kv) continue;
    if (kv[2].trim() === '') {
      // 空值：可能是空欄位，也可能底下接清單；先開陣列，最後沒接到清單項的改回空字串
      listKey = kv[1];
      out[listKey] = [];
      blank.add(listKey);
      continue;
    }
    listKey = null;
    out[kv[1]] = scalar(kv[2]);
  }
  for (const k of blank) if (out[k].length === 0) out[k] = '';
  return out;
}

function nums(v) {
  return (Array.isArray(v) ? v : []).map(taskNum).filter(n => n !== null);
}

// 列表要用的欄位（tasks.json 一張單一筆）
export function summarize(fm, sections) {
  const ac = parseChecklist(sections['驗收標準'] || '');
  return {
    index: taskNum(fm.index ?? fm.id),
    id: fm.id || '',
    title: fm.title || '',
    type: fm.type || '',
    priority: fm.priority || '',
    severity: fm.severity || '',
    status: fm.status || '',
    project: fm.project || '',
    milestone: fm.milestone || '',
    reporter: fm.reporter || '',
    participants: (Array.isArray(fm.participants) ? fm.participants : []).map(p => ({ persona: p.persona || '', role: p.role || '' })),
    epic: taskNum(fm.epic_id),
    subtasks: nums(fm.subtask_indices),
    blocked_by: nums(fm.blocked_by),
    blocks: nums(fm.blocks),
    related_to: nums(fm.related_to),
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    commits: Array.isArray(fm.commit_shas) ? fm.commit_shas : [],
    created_at: fm.created_at || '',
    updated_at: fm.updated_at || '',
    closed_at: fm.closed_at || '',
    ac: [ac.filter(i => i.done).length, ac.length],
  };
}

export function parseTask(text) {
  text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  let fmSrc = '', body = text;
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---\n', 4);
    if (end >= 0) {
      fmSrc = text.slice(4, end);
      body = text.slice(end + 5);
    }
  }
  const fm = parseFrontmatter(fmSrc);
  const sections = splitSections(body);
  return { fm, sections, summary: summarize(fm, sections) };
}

// 每個章節名取它在檔裡的位置（驗收標準／任務描述取第一個，其餘取最後一個 ——
// 描述裡偶爾會引用到後面的章節名），再照位置排序切段，不假設章節順序。
export function splitSections(body) {
  const lines = body.split('\n');
  const pos = {};
  lines.forEach((l, i) => {
    const m = l.match(/^## (.+?)\s*$/);
    if (!m || !SECTIONS.includes(m[1])) return;
    const first = m[1] === '驗收標準' || m[1] === '任務描述';
    if (first && pos[m[1]] !== undefined) return;
    pos[m[1]] = i;
  });
  // 描述開始之後才算數的章節（結單說明／留言／時間線）不能早於任務描述
  const descAt = pos['任務描述'] ?? -1;
  for (const k of ['結單說明', '留言', '活動與討論時間線']) {
    if (pos[k] !== undefined && pos[k] < descAt) delete pos[k];
  }
  const order = Object.entries(pos).sort((a, b) => a[1] - b[1]);
  const out = {};
  const firstAt = order.length ? order[0][1] : lines.length;
  out._head = lines.slice(0, firstAt).join('\n');
  order.forEach(([name, at], i) => {
    const end = i + 1 < order.length ? order[i + 1][1] : lines.length;
    out[name] = lines.slice(at + 1, end).join('\n').trim();
  });
  return out;
}

// `- [ ] 文字` / `- [x] 文字`，之後到下一格之前的非空行都併進上一格
export function parseChecklist(src) {
  const items = [];
  let pre = [];
  for (const line of src.split('\n')) {
    const m = line.match(/^[-*] \[([ xX])\] ?(.*)$/);
    if (m) {
      items.push({ done: m[1] !== ' ', text: m[2] });
      continue;
    }
    if (items.length && line.trim()) {
      items.at(-1).text += '\n' + line;
    } else if (!items.length && line.trim()) {
      pre.push(line);
    }
  }
  items.pre = pre.join('\n');
  return items;
}

// `### 💬 #1 kotoko 2026-10-25T20:50:17.825Z` 開頭一則
export function parseComments(src) {
  const out = [];
  for (const line of src.split('\n')) {
    const m = line.match(/^### 💬 #(\d+)\s+(\S+)\s+(\S+)\s*(.*)$/);
    if (m) {
      out.push({ n: Number(m[1]), author: m[2], at: m[3], extra: m[4], body: '' });
    } else if (out.length) {
      out.at(-1).body += line + '\n';
    }
  }
  for (const c of out) c.body = c.body.trim();
  return out;
}

// `- 2026-10-25T15:40:31.777Z　`todo`　由 basecamp 開單`（中間是全形空白）；
// 最早期的單（0001 那一批）還有沒有 `kind`、直接 `[persona] 文字` 的行
export function parseTimeline(src) {
  const out = [];
  for (const line of src.split('\n')) {
    const m = line.match(/^- (\d{4}-\d\d-\d\dT\S+)[\s　]+(?:`([^`]+)`[\s　]+)?(.*)$/);
    if (m) out.push({ at: m[1], kind: m[2] || '', text: m[3] });
    else if (line.startsWith('- ')) out.push({ at: '', kind: '', text: line.slice(2) });
    else if (out.length && line.trim()) out.at(-1).text += '\n' + line.trim();
  }
  return out;
}
