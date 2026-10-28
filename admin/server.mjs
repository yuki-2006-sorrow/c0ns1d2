// c0ns1d2 本地内容编辑后台（零依赖 Node 服务器）
// 运行：node admin/server.mjs  然后打开 http://localhost:4322/
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname, basename, dirname, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createAssociationStore } from './association-store.mjs';
import { parseFm, reviseContent, revision, contentPath, validateEvent } from './content-tools.mjs';
import { slug as githubSlug } from 'github-slugger';
import { serveVideo } from './media-response.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const EVENTS_DIR = join(ROOT, 'src', 'content', 'events');
const MEDIUMS_DIR = join(ROOT, 'src', 'content', 'mediums');
const PHOTOS_DIR = join(ROOT, 'public', 'photos');
const ADMIN_HTML = join(__dirname, 'admin.html');
const PORT = Number(process.env.PORT || 4322);
const buildStatus = { state: 'idle', queued: false, error: '' };

mkdirSync(PHOTOS_DIR, { recursive: true });
mkdirSync(MEDIUMS_DIR, { recursive: true });

const q = (s) => JSON.stringify(String(s ?? ''));


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
  const p = contentPath(EVENTS_DIR, rel);
  const text = readFileSync(p, 'utf8');
  const d = parseFm(text);
  d.slug = basename(rel).replace(/\.md$/, '');
  d.rel = rel;
  d.revision = revision(text);
  d.url = `/events/${encodeURIComponent(githubSlug(d.slug))}`;
  return d;
}
function listEvents() {
  return walkEvents(EVENTS_DIR).map(({ rel }) => {
    try {
      const d = parseFm(readFileSync(join(EVENTS_DIR, rel), 'utf8'));
      return { rel, slug: basename(rel).replace(/\.md$/, ''), title: d.title, date: d.date, category: d.category, source: d.source, draft: d.draft, major: d.major, images: d.images, persons: d.persons, summary: d.summary, medium: d.medium };
    } catch { return null; }
  }).filter(Boolean);
}

const associationStore = createAssociationStore(ROOT, listEvents);

function rebuild() {
  if (buildStatus.state === 'running') {
    buildStatus.queued = true;
    return;
  }
  buildStatus.state = 'running';
  buildStatus.error = '';
  let log = '';
  let settled = false;
  const child = spawn('npm.cmd', ['run', 'build'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: true, windowsHide: true });
  const collect = (chunk) => { log = (log + chunk.toString()).slice(-8000); };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const finish = (error) => {
    if (settled) return;
    settled = true;
    buildStatus.state = error ? 'failed' : 'idle';
    buildStatus.error = error;
    if (buildStatus.queued) {
      buildStatus.queued = false;
      rebuild();
    }
  };
  child.on('close', (code) => finish(code === 0 ? '' : log || `构建退出码 ${code}`));
  child.on('error', (error) => finish(error.message));
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
  if (!slug || !title) throw new Error('名称不能为空');
  const fp = contentPath(MEDIUMS_DIR, slug + '.md');
  const parent = String(data.parent || '');
  const folders = new Map(listMediums().map(folder => [folder.slug, folder.parent]));
  if (parent && !folders.has(parent)) throw new Error('父文件夹不存在');
  const visited = new Set([slug]);
  let ancestor = parent;
  while (ancestor) {
    if (visited.has(ancestor)) throw new Error('文件夹不能放进自己或自己的子文件夹');
    visited.add(ancestor);
    ancestor = folders.get(ancestor) || '';
  }
  if (existsSync(fp)) {
    // 改名/改摘要/改父级：只替换字段，保留日期等其余字段
    const fields = { title, summary: String(data.summary || ''), parent };
    if (data.color) fields.color = data.color;
    if ('draft' in data) fields.draft = data.draft;
    writeFileSync(fp, reviseContent(readFileSync(fp, 'utf8'), fields), 'utf8');
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
  const p = contentPath(EVENTS_DIR, rel);
  const text = readFileSync(p, 'utf8');
  if (edits.revision && edits.revision !== revision(text)) throw new Error('文件已在其他窗口修改，请先复制当前文字，再重新打开该事件');
  const { body, ...fields } = validateEvent(edits);
  writeFileSync(p, reviseContent(text, fields, body), 'utf8');
}

// 新建事件（小事件默认 draft:true）
function createEvent(data) {
  data = validateEvent(data);
  const title = String(data.title || '').trim() || '未命名';
  const date = (data.date || new Date().toISOString().slice(0, 10)).replace(/"/g, '');
  const eol = '\n';
  const dateSlug = date.replace(/[^0-9]/g, '') || 'unknown'; // 文件名里不能有 ? 等特殊字符
  const rel = `manual/manual-${dateSlug}-${randomUUID()}.md`;
  const text = '---' + eol +
    'title: ' + q(title) + eol +
    'date: ' + (/^\d{4}-\d{2}-\d{2}$/.test(date) ? date : q(date)) + eol +
    'persons: [' + (data.persons || []).map(q).join(', ') + ']' + eol +
    'summary: ' + q(data.summary || '') + eol +
    'quotes: []' + eol +
    'category: ' + (data.category || 'other') + eol +
    'medium: ' + q(data.medium || '') + eol +
    'images: [' + (data.images || []).map(q).join(', ') + ']' + eol +
    'draft: ' + (data.draft === false ? 'false' : 'true') + eol +
    'major: ' + (data.major === true ? 'true' : 'false') + eol +
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
const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => { size += chunk.length; if (size <= 16 * 1024 * 1024) chunks.push(chunk); });
  req.on('error', reject);
  req.on('end', () => {
    if (size > 16 * 1024 * 1024) return reject(new Error('文件过大，请选择不超过 10MB 的照片'));
    try { const data = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error(); resolve(data); }
    catch { reject(new Error('请求内容不完整，请重试')); }
  });
});

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4',
  '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
};
function serveFile(res, fp, req) {
  if (req && extname(fp).toLowerCase() === '.mp4') return serveVideo(req, res, fp);
  res.writeHead(200, { 'Content-Type': MIME[extname(fp).toLowerCase()] || 'application/octet-stream' });
  res.end(readFileSync(fp));
}
function serveStatic(req, res, urlPath) {
  const DIST = join(ROOT, 'dist');
  const PUBLIC = join(ROOT, 'public');
  if (urlPath.startsWith('/photos/')) { // 照片直接读 public，上传后立即可见
    const fp = resolve(PUBLIC, '.' + urlPath);
    if (relative(PHOTOS_DIR, fp).startsWith('..') || isAbsolute(relative(PHOTOS_DIR, fp))) return false;
    if (existsSync(fp)) { serveFile(res, fp); return true; }
    const fd = join(DIST, urlPath);
    if (existsSync(fd)) { serveFile(res, fd); return true; }
    return false;
  }
  let p = resolve(DIST, '.' + urlPath);
  if (relative(DIST, p).startsWith('..') || isAbsolute(relative(DIST, p))) return false;
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  else if (!existsSync(p)) {
    if (existsSync(p + '.html')) p = p + '.html';
    else return false;
  }
  serveFile(res, p, req);
  return true;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { return send(res, 400, { error: '页面地址不完整' }); }
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
  try {
    if (p === '/admin/associations.js' && req.method === 'GET') return serveFile(res, join(__dirname, 'associations.js'));
    if (p === '/admin/editor.js' && req.method === 'GET') return serveFile(res, join(__dirname, 'editor.js'));
    if (p === '/admin/writing.js' && req.method === 'GET') return serveFile(res, join(__dirname, 'writing.js'));
    if (p === '/api/works' && req.method === 'GET') return send(res, 200, associationStore.listWorks());
    if (p === '/api/associations' && req.method === 'GET') return send(res, 200, associationStore.listAssociations());
    if ((p === '/api/work' || p === '/api/association') && req.method === 'POST') {
      const data = await readBody(req);
      try {
        return send(res, 200, p === '/api/work' ? associationStore.saveWork(data) : associationStore.saveAssociation(data));
      } catch (error) {
        return send(res, 400, { error: error.message });
      }
    }
    if (p === '/admin' || p === '/admin/' || p === '/admin.html') {
      const html = readFileSync(ADMIN_HTML, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    if (p === '/api/events' && req.method === 'GET') return send(res, 200, listEvents());
    if (p === '/api/event' && req.method === 'GET') return send(res, 200, readEvent(url.searchParams.get('rel')));
    if (p === '/api/event' && req.method === 'POST') {
      const b = await readBody(req);
      if (b.rel) {
        saveEvent(b.rel, b);
        return send(res, 200, { ok: true, revision: readEvent(b.rel).revision });
      }
      const result = createEvent(b);
      return send(res, 200, { ...result, revision: readEvent(result.rel).revision });
    }
    if (p === '/api/upload' && req.method === 'POST') {
      const b = await readBody(req);
      if (typeof b.data !== 'string' || !b.data || !/^[A-Za-z0-9+/=\s]+$/.test(b.data)) throw new Error('照片内容不完整，请重新选择');
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
      rebuild();
      return send(res, 200, { ok: true, ...buildStatus });
    }
    if (p === '/api/build-status' && req.method === 'GET') return send(res, 200, buildStatus);
    if (serveStatic(req, res, p)) return;
    res.writeHead(404); res.end('not found');
  } catch (e) {
    send(res, 400, { error: String(e && e.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const activePort = server.address().port;
  console.log('c0ns1d2 已启动：');
  console.log(`  网站  http://localhost:${activePort}/`);
  console.log(`  后台  http://localhost:${activePort}/admin`);
});
