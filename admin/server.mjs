// c0ns1d2 本地内容编辑后台（零依赖 Node 服务器）
// 运行：node admin/server.mjs  然后打开 http://localhost:4322/
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const EVENTS_DIR = join(ROOT, 'src', 'content', 'events');
const MEDIUMS_DIR = join(ROOT, 'src', 'content', 'mediums');
const PHOTOS_DIR = join(ROOT, 'public', 'photos');
const ADMIN_HTML = join(__dirname, 'admin.html');
const PORT = 4322;
let rebuilding = false;

mkdirSync(PHOTOS_DIR, { recursive: true });
mkdirSync(MEDIUMS_DIR, { recursive: true });

const q = (s) => JSON.stringify(String(s ?? ''));

// 只解析「单行字段」；quotes 等多行字段一律不解析、原样保留，避免死循环
function parseFm(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end < 0) return null;
  const fmText = text.slice(4, end);
  let body = text.slice(end + 4);
  if (body.startsWith('\n')) body = body.slice(1);
  const get = (key) => { const m = fmText.match(new RegExp('^' + key + ':\\s*([^\\r\\n]*)$', 'm')); return m ? m[1].trim() : null; };
  const str = (key, dflt) => { const v = get(key); if (v == null || v === '') return dflt; try { return JSON.parse(v); } catch { return v.replace(/^"|"$/g, ''); } };
  const arr = (key) => {
    const v = get(key);
    if (v == null) return [];
    const inner = v.replace(/^\[/, '').replace(/\]\s*$/, '').trim();
    if (!inner) return [];
    return inner.split(',').map((s) => { s = s.trim(); try { return JSON.parse(s); } catch { return s.replace(/^"|"$/g, ''); } });
  };
  const bool = (key, dflt) => { const v = get(key); return v == null ? dflt : v === 'true'; };
  return {
    title: str('title', ''),
    date: (get('date') || '').replace(/^"|"$/g, ''),
    persons: arr('persons'),
    summary: str('summary', ''),
    category: (get('category') || 'other').replace(/^"|"$/g, ''),
    source: str('source', ''),
    color: str('color', ''),
    parent: str('parent', ''),
    images: arr('images'),
    medium: str('medium', ''),
    draft: bool('draft', false),
    body,
  };
}

function walkEvents(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walkEvents(p));
    else if (f.endsWith('.md')) out.push({ rel: p.slice(EVENTS_DIR.length + 1), path: p });
  }
  return out;
}
function readEvent(rel) {
  const p = join(EVENTS_DIR, rel);
  const text = readFileSync(p, 'utf8');
  const d = parseFm(text);
  d.slug = basename(rel).replace(/\.md$/, '');
  d.rel = rel;
  return d;
}
function listEvents() {
  return walkEvents(EVENTS_DIR).map(({ rel }) => {
    try {
      const d = parseFm(readFileSync(join(EVENTS_DIR, rel), 'utf8'));
      return { rel, slug: basename(rel).replace(/\.md$/, ''), title: d.title, date: d.date, category: d.category, source: d.source, draft: d.draft, images: d.images, persons: d.persons, summary: d.summary, medium: d.medium };
    } catch { return null; }
  }).filter(Boolean);
}

// ---------- 中事件（文件夹） ----------
function listMediums() {
  const counts = {};
  for (const { rel } of walkEvents(EVENTS_DIR)) {
    try {
      const d = parseFm(readFileSync(join(EVENTS_DIR, rel), 'utf8'));
      if (d && d.medium) counts[d.medium] = (counts[d.medium] || 0) + 1;
    } catch {}
  }
  const out = [];
  for (const f of readdirSync(MEDIUMS_DIR)) {
    if (!f.endsWith('.md')) continue;
    const slug = f.replace(/\.md$/, '');
    const d = parseFm(readFileSync(join(MEDIUMS_DIR, f), 'utf8'));
    out.push({ slug, title: d.title, summary: d.summary, color: d.color, parent: d.parent || '', draft: d.draft, count: counts[slug] || 0 });
  }
  out.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh'));
  return out;
}
function saveMedium(data) {
  const title = String(data.title || '').trim();
  let slug = String(data.slug || '').trim();
  if (!slug) slug = title.replace(/[\\/:*?"<>|]/g, '_').trim();
  if (!slug) return { error: '名称不能为空' };
  const fp = join(MEDIUMS_DIR, slug + '.md');
  const setField = (text, key, val) => {
    const re = new RegExp('^' + key + ':[^\\r\\n]*', 'm');
    if (re.test(text)) return text.replace(re, key + ': ' + val);
    const end = text.indexOf('\n---', 3);
    return text.slice(0, end) + '\n' + key + ': ' + val + text.slice(end);
  };
  if (existsSync(fp)) {
    // 改名/改摘要/改父级：只替换字段，保留日期等其余字段
    let text = readFileSync(fp, 'utf8');
    text = setField(text, 'title', q(title));
    text = setField(text, 'summary', q(data.summary || ''));
    text = setField(text, 'parent', q(data.parent || ''));
    if (data.color) text = setField(text, 'color', q(data.color));
    if ('draft' in data) text = setField(text, 'draft', String(data.draft));
    writeFileSync(fp, text, 'utf8');
    return { ok: true, slug };
  }
  const eol = '\n';
  const text = '---' + eol +
    'title: ' + q(title) + eol +
    'summary: ' + q(data.summary || '') + eol +
    'date: ' + (data.date || '2026-01-01') + eol +
    'color: ' + q(data.color || '#4ca1af') + eol +
    'parent: ' + q(data.parent || '') + eol +
    'draft: ' + (data.draft ? 'true' : 'false') + eol +
    '---' + eol;
  writeFileSync(fp, text, 'utf8');
  return { ok: true, slug };
}

// 保存：只替换要改的字段行，其余（quotes/source/color/size/tags 等）原样保留
function saveEvent(rel, edits) {
  const p = join(EVENTS_DIR, rel);
  let text = readFileSync(p, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const setField = (key, val) => {
    const re = new RegExp('^' + key + ':[^\\r\\n]*', 'm');
    if (re.test(text)) text = text.replace(re, key + ': ' + val);
    else {
      const end = text.indexOf('\n---', 3);
      text = text.slice(0, end) + eol + key + ': ' + val + text.slice(end);
    }
  };
  if ('title' in edits) setField('title', q(edits.title));
  if ('date' in edits) setField('date', /^\d{4}-\d{2}-\d{2}$/.test(edits.date) ? edits.date : q(edits.date));
  if ('category' in edits) setField('category', edits.category);
  if ('persons' in edits) setField('persons', '[' + edits.persons.map(q).join(', ') + ']');
  if ('summary' in edits) setField('summary', q(edits.summary));
  if ('images' in edits) setField('images', '[' + edits.images.map(q).join(', ') + ']');
  if ('medium' in edits) setField('medium', q(edits.medium));
  if ('draft' in edits) setField('draft', String(edits.draft));
  if ('body' in edits) {
    const end = text.indexOf('\n---', 3);
    text = text.slice(0, end + 4) + eol + edits.body + eol;
  }
  writeFileSync(p, text, 'utf8');
}

// 新建事件（小事件默认 draft:true）
function createEvent(data) {
  const title = String(data.title || '').trim() || '未命名';
  const date = (data.date || new Date().toISOString().slice(0, 10)).replace(/"/g, '');
  const eol = '\n';
  const dateSlug = date.replace(/[^0-9]/g, '') || 'unknown'; // 文件名里不能有 ? 等特殊字符
  const rel = `manual/manual-${dateSlug}-${Date.now()}.md`;
  const text = '---' + eol +
    'title: ' + q(title) + eol +
    'date: ' + (/^\d{4}-\d{2}-\d{2}$/.test(date) ? date : q(date)) + eol +
    'persons: [' + (data.persons || []).map(q).join(', ') + ']' + eol +
    'summary: ' + q(data.summary || '') + eol +
    'quotes: []' + eol +
    'category: ' + (data.category || 'other') + eol +
    'medium: ' + q(data.medium || '') + eol +
    'images: [' + (data.images || []).map(q).join(', ') + ']' + eol +
    'draft: ' + (data.draft ? 'true' : 'false') + eol +
    '---' + eol + eol +
    (data.body || '') + eol;
  const p = join(EVENTS_DIR, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text, 'utf8');
  return { ok: true, rel };
}

// ---------- HTTP ----------
const send = (res, code, data) => {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
};
const readBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve({}); } });
});

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4',
  '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
};
function serveFile(res, fp) {
  res.writeHead(200, { 'Content-Type': MIME[extname(fp).toLowerCase()] || 'application/octet-stream' });
  res.end(readFileSync(fp));
}
function serveStatic(res, urlPath) {
  const DIST = join(ROOT, 'dist');
  const PUBLIC = join(ROOT, 'public');
  if (urlPath.startsWith('/photos/')) { // 照片直接读 public，上传后立即可见
    const fp = join(PUBLIC, urlPath);
    if (existsSync(fp)) { serveFile(res, fp); return true; }
    const fd = join(DIST, urlPath);
    if (existsSync(fd)) { serveFile(res, fd); return true; }
    return false;
  }
  let p = join(DIST, urlPath);
  if (!p.startsWith(DIST)) return false;
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  else if (!existsSync(p)) {
    if (existsSync(p + '.html')) p = p + '.html';
    else return false;
  }
  serveFile(res, p);
  return true;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
  try {
    if (p === '/admin' || p === '/admin/' || p === '/admin.html') {
      const html = readFileSync(ADMIN_HTML, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    if (p === '/api/events' && req.method === 'GET') return send(res, 200, listEvents());
    if (p === '/api/event' && req.method === 'GET') return send(res, 200, readEvent(url.searchParams.get('rel')));
    if (p === '/api/event' && req.method === 'POST') {
      const b = await readBody(req);
      if (b.rel && existsSync(join(EVENTS_DIR, b.rel))) {
        saveEvent(b.rel, b);
        return send(res, 200, { ok: true });
      }
      return send(res, 200, createEvent(b));
    }
    if (p === '/api/upload' && req.method === 'POST') {
      const b = await readBody(req);
      const name = String(b.filename || 'photo.jpg').replace(/[\\/:*?"<>|]/g, '_');
      const ext = (extname(name) || '.jpg').toLowerCase();
      const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'].includes(ext) ? ext : '.jpg';
      const final = `${Date.now()}-${basename(name, extname(name)).replace(/[^\w\u4e00-\u9fa5-]/g, '_')}${safeExt}`;
      writeFileSync(join(PHOTOS_DIR, final), Buffer.from(b.data, 'base64'));
      return send(res, 200, { url: `/photos/${final}` });
    }
    if (p === '/api/mediums' && req.method === 'GET') return send(res, 200, listMediums());
    if (p === '/api/medium' && req.method === 'POST') {
      const b = await readBody(req);
      return send(res, 200, saveMedium(b));
    }
    if (p === '/api/rebuild' && req.method === 'POST') {
      if (rebuilding) return send(res, 200, { ok: true, note: '已在重建中' });
      rebuilding = true;
      const child = spawn('npm.cmd', ['run', 'build'], { cwd: ROOT, stdio: 'ignore', shell: true });
      child.on('exit', () => { rebuilding = false; });
      child.on('error', (e) => { rebuilding = false; send(res, 500, { error: String(e.message) }); });
      return send(res, 200, { ok: true, note: '构建已触发，稍后刷新预览即可看到' });
    }
    if (serveStatic(res, p)) return;
    res.writeHead(404); res.end('not found');
  } catch (e) {
    send(res, 500, { error: String(e && e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log('c0ns1d2 已启动：');
  console.log(`  网站  http://localhost:${PORT}/`);
  console.log(`  后台  http://localhost:${PORT}/admin`);
});
