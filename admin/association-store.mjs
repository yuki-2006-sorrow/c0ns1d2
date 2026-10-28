import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

const kinds = new Set(['book', 'film', 'game']);
const types = new Set(['event', 'work']);
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;

function text(value, name, limit = 12000) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > limit) throw new Error(`${name}格式不正确或过长`);
  return value.trim();
}

function flag(value) {
  if (value !== undefined && typeof value !== 'boolean') throw new Error('公开状态必须是布尔值');
  return value !== false;
}

export function createAssociationStore(root, listEvents) {
  const directories = { works: join(root, 'src/content/works'), associations: join(root, 'src/content/associations') };
  function list(collection) {
    const directory = directories[collection];
    if (!existsSync(directory)) return [];
    return readdirSync(directory).filter((name) => name.endsWith('.md')).map((name) => {
      const source = readFileSync(join(directory, name), 'utf8').replace(/\r/g, '');
      const match = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
      if (!match) throw new Error(`无法读取 ${collection}/${name}`);
      const data = Object.fromEntries(match[1].split('\n').filter(Boolean).map((line) => {
        const separator = line.indexOf(':');
        return [line.slice(0, separator), JSON.parse(line.slice(separator + 1).trim())];
      }));
      return { ...data, id: name.slice(0, -3), revision: createHash('sha256').update(source).digest('hex'), body: source.slice(match[0].length).replace(/^\n/, '').replace(/\n$/, '') };
    });
  }
  function save(collection, data, expectedRevision) {
    const id = data.id || `${collection === 'works' ? 'work' : 'association'}-${randomUUID()}`;
    if (!idPattern.test(id)) throw new Error('条目标识不正确');
    const directory = directories[collection];
    const target = join(directory, `${id}.md`);
    if (data.id && !existsSync(target)) throw new Error('条目不存在，请刷新后重试');
    if (expectedRevision && existsSync(target) && expectedRevision !== createHash('sha256').update(readFileSync(target, 'utf8').replace(/\r/g, '')).digest('hex')) throw new Error('条目已在其他窗口修改，请先保留当前文字并重新打开');
    mkdirSync(directory, { recursive: true });
    const { body = '', id: ignored, ...fields } = data;
    const source = '---\n' + Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n') + '\n---\n\n' + body + '\n';
    const temporary = join(directory, `${id}.${randomUUID()}.tmp`);
    writeFileSync(temporary, source, 'utf8');
    renameSync(temporary, target);
    return { ok: true, id, revision: createHash('sha256').update(source).digest('hex') };
  }
  function saveWork(input) {
    const title = text(input.title, '标题', 300);
    if (!title) throw new Error('请填写作品标题');
    if (!kinds.has(input.kind)) throw new Error('请选择书、电影或游戏');
    const cover = text(input.cover, '封面', 2000);
    if (cover && !/^https:\/\/[^\s]+$/.test(cover) && !/^\/photos\/[\w%\u4e00-\u9fff.-]+$/.test(cover)) throw new Error('封面请使用 https 地址或已上传的 /photos/ 图片');
    return save('works', { id: input.id, title, kind: input.kind, creator: text(input.creator, '作者/创作者', 300), year: text(input.year, '年份', 40), cover, summary: text(input.summary, '简介'), draft: flag(input.draft), body: text(input.body, '正文', 100000) }, input.revision);
  }
  function saveAssociation(input) {
    const fromType = input.fromType || '';
    const fromId = text(input.fromId, '起点', 300);
    const hasOrigin = !!(fromType || fromId);
    if (hasOrigin && (!types.has(fromType) || !fromId)) throw new Error('请选择完整的出发记录，或暂时留空');
    const toId = text(input.toId, '终点', 300);
    const toType = input.toType || '';
    const hasTarget = !!(toType || toId);
    if (hasTarget && (!types.has(toType) || !toId)) throw new Error('请选择完整的关联条目，或暂时留空');
    if (hasTarget && fromType === toType && fromId === toId) throw new Error('请选择另一条记忆或作品');
    const lookup = { event: new Set(listEvents().map((entry) => entry.slug)), work: new Set(list('works').map((entry) => entry.id)) };
    if (hasOrigin && !lookup[fromType].has(fromId) || hasTarget && !lookup[toType].has(toId)) throw new Error('关联条目不存在，请先保存条目');
    const title = text(input.title, '标题', 300);
    text(input.body, '联想正文', 100000);
    const body = input.body || '';
    const note = text(input.note, '随记', 100000);
    const excerpt = text(input.excerpt, '片段', 30000);
    if ((!hasTarget || !hasOrigin) && !title && !body.trim() && !note && !excerpt) throw new Error('先记下一点想法，或从一段记录中选择关联');
    if (hasTarget && !title && !body.trim() && !note && !excerpt) {
      const duplicate = list('associations').find(entry => entry.id !== input.id && !entry.title && !entry.body?.trim() && !entry.note && !entry.excerpt && ((entry.fromType === input.fromType && entry.fromId === fromId && entry.toType === toType && entry.toId === toId) || (entry.fromType === toType && entry.fromId === toId && entry.toType === input.fromType && entry.toId === fromId)));
      if (duplicate) throw new Error('这两个条目已有联想，请编辑原记录');
    }
    return save('associations', { id: input.id, title, fromType, fromId, toType, toId, note, excerpt, locator: text(input.locator, '片段位置', 300), draft: flag(input.draft), body }, input.revision);
  }
  return { listWorks: () => list('works'), listAssociations: () => list('associations'), saveWork, saveAssociation };
}
