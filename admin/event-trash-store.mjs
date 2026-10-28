import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { contentPath, parseFm, revision } from './content-tools.mjs';

// Kept outside Astro's content tree and out of Git. Media are never removed here.
export function createEventTrashStore(root, listEvents, listAssociations) {
  const eventsDirectory = join(root, 'src/content/events');
  const trashDirectory = join(root, '.local-trash/events');
  const slug = rel => basename(rel).replace(/\.md$/, '');
  function directory(id) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('回收站记录不正确');
    return join(trashDirectory, id);
  }
  function selection(items) {
    if (!Array.isArray(items) || !items.length || items.length > 1000) throw new Error('请先选择事件');
    if (items.some(item => !item || typeof item !== 'object')) throw new Error('事件选择不正确');
  }
  function plan(items) {
    selection(items);
    const seen = new Set();
    const associations = listAssociations();
    return items.map(item => {
      const path = contentPath(eventsDirectory, item.rel);
      if (seen.has(path.toLowerCase())) throw new Error('不能重复选择事件');
      seen.add(path.toLowerCase());
      const source = readFileSync(path, 'utf8');
      if (!item.revision || item.revision !== revision(source)) throw new Error('事件已发生变化，请刷新列表后重新选择');
      const data = parseFm(source);
      const links = associations.filter(link => link.fromType === 'event' && link.fromId === slug(item.rel) || link.toType === 'event' && link.toId === slug(item.rel));
      return { rel: item.rel, revision: revision(source), title: data.title, date: data.date, draft: data.draft, photos: data.images.length, associations: links.length };
    });
  }
  function move(items) {
    const prepared = plan(items);
    if (prepared.some(item => item.associations)) throw new Error('所选事件含有联想，请先取消勾选这些事件；本次没有移除任何事件');
    const records = prepared.map(item => ({ ...item, id: randomUUID(), removedAt: new Date().toISOString() }));
    // Validate the whole batch before moving anything; roll back on a filesystem failure.
    for (const record of records) {
      mkdirSync(directory(record.id), { recursive: true });
      writeFileSync(join(directory(record.id), 'record.json'), JSON.stringify(record, null, 2), { flag: 'wx' });
    }
    const moved = [];
    try {
      for (const record of records) {
        renameSync(contentPath(eventsDirectory, record.rel), join(directory(record.id), 'event.md'));
        moved.push(record);
      }
    } catch (error) {
      for (const record of moved.reverse()) renameSync(join(directory(record.id), 'event.md'), contentPath(eventsDirectory, record.rel));
      throw error;
    }
    return { ok: true, count: records.length };
  }
  function list() {
    if (!existsSync(trashDirectory)) return [];
    return readdirSync(trashDirectory).flatMap(id => {
      const folder = directory(id);
      if (!existsSync(join(folder, 'event.md'))) return [];
      const record = JSON.parse(readFileSync(join(folder, 'record.json'), 'utf8'));
      const data = parseFm(readFileSync(join(folder, 'event.md'), 'utf8'));
      return [{ id, rel: record.rel, removedAt: record.removedAt, title: data.title, date: data.date, summary: data.summary, photos: data.images.length, draft: data.draft }];
    }).sort((a, b) => b.removedAt.localeCompare(a.removedAt));
  }
  function restore(items) {
    selection(items);
    const seen = new Set();
    const slugs = new Set(listEvents().map(event => event.slug.toLowerCase()));
    const records = items.map(item => {
      const folder = directory(item.id);
      if (seen.has(item.id)) throw new Error('不能重复选择记录');
      seen.add(item.id);
      if (!existsSync(join(folder, 'event.md'))) throw new Error('记录已恢复，请刷新回收站');
      const record = JSON.parse(readFileSync(join(folder, 'record.json'), 'utf8'));
      const target = contentPath(eventsDirectory, record.rel);
      const key = slug(record.rel).toLowerCase();
      if (existsSync(target) || slugs.has(key)) throw new Error(`“${record.title}”的原位置或事件标识已被占用，本次未恢复任何事件`);
      slugs.add(key);
      return { folder, target };
    });
    const restored = [];
    try {
      for (const record of records) {
        mkdirSync(dirname(record.target), { recursive: true });
        renameSync(join(record.folder, 'event.md'), record.target);
        restored.push(record);
      }
    } catch (error) {
      for (const record of restored.reverse()) renameSync(record.target, join(record.folder, 'event.md'));
      throw error;
    }
    return { ok: true, count: records.length };
  }
  return { list, plan, move, restore };
}
