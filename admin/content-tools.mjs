import yaml from 'js-yaml';
import { createHash } from 'node:crypto';
import { relative, resolve, isAbsolute } from 'node:path';

export function splitContent(text) {
  const match = text.match(/^\uFEFF?---\r*\n([\s\S]*?)\r*\n---(?:\r*\n|$)/);
  if (!match) throw new Error('内容文件缺少有效的元数据');
  return { header: match[1], body: text.slice(match[0].length), eol: text.includes('\r\n') ? '\r\n' : '\n' };
}

export function parseFm(text) {
  const { header, body } = splitContent(text);
  const data = yaml.load(header.replace(/\r/g, '')) || {};
  const string = key => data[key] == null ? '' : String(data[key]);
  const array = key => Array.isArray(data[key]) ? data[key].map(String) : [];
  return { ...data, title: string('title'), date: data.date instanceof Date ? data.date.toISOString().slice(0, 10) : string('date'), persons: array('persons'), summary: string('summary'), category: string('category') || 'other', source: string('source'), color: string('color'), parent: string('parent'), images: array('images'), medium: string('medium'), major: data.major === true, draft: data.draft !== false, body };
}

export function reviseContent(text, fields, body) {
  const parts = splitContent(text);
  const lines = parts.header.replace(/\r/g, '').split('\n');
  for (const [key, value] of Object.entries(fields)) {
    const start = lines.findIndex(line => line.startsWith(key + ':'));
    const replacement = `${key}: ${JSON.stringify(value)}`;
    if (start < 0) lines.push(replacement);
    else {
      let end = start + 1;
      while (end < lines.length && /^(?:[ \t]+\S|[ \t]*$|-\s)/.test(lines[end])) end++;
      lines.splice(start, end - start, replacement);
    }
  }
  return '---' + parts.eol + lines.join(parts.eol) + parts.eol + '---' + parts.eol + (body === undefined ? parts.body : body);
}

export function revision(text) { return createHash('sha256').update(text).digest('hex'); }

export function contentPath(root, name) {
  if (typeof name !== 'string' || !name.endsWith('.md') || name.includes('\0')) throw new Error('文件路径不正确');
  const target = resolve(root, name);
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('文件不在内容目录中');
  return target;
}

export function validateDate(value) {
  const date = String(value || '').trim();
  if (['?', '未知', '不详'].includes(date)) return '?';
  const match = date.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (!match) throw new Error('日期请填写 年 / 年-月 / 年-月-日，未知写 ?');
  const year = Number(match[1]), month = Number(match[2] || 1), day = Number(match[3] || 1);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (year < 1000 || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new Error('日期不存在，请检查月份和天数');
  return date;
}

export function validateEvent(input) {
  const fields = {};
  for (const key of ['title', 'summary', 'body', 'medium']) if (key in input) {
    if (typeof input[key] !== 'string') throw new Error('文字内容格式不正确');
    fields[key] = key === 'title' ? input[key].trim() : input[key];
  }
  if ('title' in fields && !fields.title) throw new Error('请填写事件标题');
  if ('date' in input) fields.date = validateDate(input.date);
  if ('category' in input) {
    if (!['core', 'food', 'exam', 'other'].includes(input.category)) throw new Error('分类不正确');
    fields.category = input.category;
  }
  for (const key of ['persons', 'images']) if (key in input) {
    if (!Array.isArray(input[key]) || input[key].some(value => typeof value !== 'string')) throw new Error('人物或照片列表格式不正确');
    fields[key] = [...new Set(input[key])];
  }
  for (const key of ['draft', 'major']) if (key in input) {
    if (typeof input[key] !== 'boolean') throw new Error('公开和精选状态格式不正确');
    fields[key] = input[key];
  }
  return fields;
}
