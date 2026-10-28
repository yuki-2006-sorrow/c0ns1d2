import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import test from 'node:test';
import { createAssociationStore } from '../admin/association-store.mjs';
import { publicConnections, publicThoughts } from '../src/lib/associations.mjs';
import { parseFm, reviseContent, validateDate, contentPath } from '../admin/content-tools.mjs';
import { contentPreview } from '../src/lib/content-preview.mjs';

test('manual works and associations persist, validate references, and remain private by default', () => {
  const root = mkdtempSync(join(tmpdir(), 'c0ns1d2-associations-'));
  try {
    const store = createAssociationStore(root, () => [{ slug: 'memory-a' }, { slug: 'memory-b' }]);
    const saved = store.saveWork({ title: '测试：书名与逗号, 引号"', kind: 'book', body: '第一段\n\n第二段' });
    let work = store.listWorks()[0];
    assert.equal(work.id, saved.id);
    assert.equal(work.draft, true);
    assert.ok(work.body.includes('第一段\n\n第二段'));
    const link = store.saveAssociation({ fromType: 'event', fromId: 'memory-a', toType: 'work', toId: saved.id });
    assert.equal(store.listAssociations()[0].draft, true);
    assert.equal(store.listAssociations()[0].note, '');
    assert.throws(() => store.saveAssociation({ fromType: 'work', fromId: saved.id, toType: 'event', toId: 'memory-a' }), /已有联想/);
    assert.throws(() => store.saveAssociation({ fromType: 'event', fromId: 'missing', toType: 'work', toId: saved.id }), /不存在/);
    assert.throws(() => store.saveAssociation({ fromType: 'event', fromId: 'memory-a', toType: 'event', toId: 'memory-a' }), /另一条/);
    assert.throws(() => store.saveWork({ title: 'test', kind: 'book', id: '../escape' }), /标识/);
    assert.throws(() => store.saveWork({ title: 'test', kind: 'book', cover: 'javascript:alert(1)' }), /封面/);
    assert.throws(() => store.saveWork({ title: 'test', kind: 'other' }), /请选择/);
    assert.throws(() => store.saveWork({ title: 'test', kind: 'film', draft: 'false' }), /布尔/);
    store.saveWork({ ...work, draft: false });
    assert.throws(() => store.saveWork({ ...work, title: '旧窗口的修改' }), /其他窗口/);
    store.saveAssociation({ ...store.listAssociations()[0], id: link.id, draft: false, note: '随手记下\n后来补充', excerpt: '片段', locator: '某章' });
    const restored = createAssociationStore(root, () => [{ slug: 'memory-a' }]);
    assert.equal(restored.listWorks()[0].draft, false);
    assert.equal(restored.listAssociations()[0].note, '随手记下\n后来补充');
    store.saveAssociation({ ...store.listAssociations()[0], draft: true });
    assert.equal(store.listAssociations()[0].draft, true);
  } finally {
    assert.ok(basename(root).startsWith('c0ns1d2-associations-'));
    rmSync(root, { recursive: true, force: true });
  }
});

test('public traversal is symmetric and never exposes draft links or either private endpoint', () => {
  const events = [{ slug: 'auto/memory-a', data: { title: '记忆', draft: false } }, { slug: 'private-event', data: { title: '未公开记忆', draft: true } }];
  const works = [{ slug: 'book', data: { title: '书', kind: 'book', draft: false } }, { slug: 'private-work', data: { title: '未公开书', kind: 'book', draft: true } }];
  const association = { slug: 'link', data: { fromType: 'event', fromId: 'memory-a', toType: 'work', toId: 'book', note: '', excerpt: '', locator: '', draft: false } };
  assert.equal(publicConnections('event', 'memory-a', events, works, [association])[0].title, '书');
  assert.equal(publicConnections('event', 'memory-a', events, works, [association])[0].id, 'link');
  assert.equal(publicConnections('work', 'book', events, works, [association])[0].title, '记忆');
  assert.deepEqual(publicConnections('event', 'memory-a', events, works, []), []);
  for (const changes of [{ draft: true }, { toId: 'private-work' }, { fromId: 'private-event' }, { toId: 'deleted-work' }]) {
    assert.deepEqual(publicConnections('event', 'memory-a', events, works, [{ ...association, data: { ...association.data, ...changes } }]), []);
  }
  assert.deepEqual(publicConnections('event', 'private-event', events, works, [association]), []);
  assert.equal(publicConnections('event', 'memory-a', events, [{ ...works[0], data: { ...works[0].data, draft: true } }], [association]).length, 0);
  const namedEvent = { id: 'auto/Memory A.md', slug: 'auto/memory-a', data: { title: '旧事件', draft: false } };
  const namedLink = { ...association, data: { ...association.data, fromId: 'Memory A' } };
  assert.equal(publicConnections('work', 'book', [namedEvent], works, [namedLink])[0].href, '/events/memory-a');
  assert.equal(publicConnections('event', 'Memory A', [namedEvent], works, [namedLink]).length, 1);
});

test('legacy multiline fields survive editing and date validation rejects impossible dates', () => {
  const source = '---\r\ntitle: 原标题\r\ndate: 2026-01-01\r\npersons: ["甲,乙", 丙]\r\nimages:\r\n  - https://example.com/a.png\r\n  - https://example.com/b.png\r\nquotes:\r\n  - 第一段\r\n  - 第二段\r\nsummary: |\r\n  原摘要\r\nsource: 原始记录\r\n---\r\n\r\n正文含有 title: 不应被替换\r\n';
  const original = parseFm(source);
  assert.deepEqual(original.persons, ['甲,乙', '丙']);
  assert.equal(original.images.length, 2);
  const result = parseFm(reviseContent(source, { title: '修改标题', images: [original.images[1]], summary: '新摘要' }));
  assert.equal(result.title, '修改标题');
  assert.equal(result.images.length, 1);
  assert.deepEqual(result.quotes, original.quotes);
  assert.equal(result.source, original.source);
  assert.equal(result.body, original.body);
  assert.equal(validateDate('2024-02-29'), '2024-02-29');
  assert.equal(validateDate('2024'), '2024');
  assert.equal(validateDate('?'), '?');
  assert.throws(() => validateDate('2026-02-30'), /不存在/);
  assert.throws(() => validateDate('2026-13'), /不存在/);
  assert.throws(() => contentPath(join(tmpdir(), 'content'), '../escape.md'), /目录/);
});

test('a long thought can exist before any target and later acquire one without replacing other writing', () => {
  const root = mkdtempSync(join(tmpdir(), 'c0ns1d2-associations-'));
  try {
    const store = createAssociationStore(root, () => [{slug:'memory'}]);
    const body = '# 一段很长的想法\n\n' + '想到这里，又有了新的念头。\n'.repeat(1400);
    const saved = store.saveAssociation({fromType:'event',fromId:'memory',body});
    let thought = store.listAssociations().find(entry => entry.id === saved.id);
    assert.equal(thought.toType, ''); assert.equal(thought.toId, ''); assert.equal(thought.draft, true); assert.equal(thought.body, body);
    const work = store.saveWork({title:'作品',kind:'book',draft:false});
    store.saveAssociation({...thought,toType:'work',toId:work.id});
    thought = store.listAssociations()[0];
    store.saveAssociation({fromType:'event',fromId:'memory',toType:'work',toId:work.id,body:'另一次阅读后想到的不同事情'});
    assert.equal(store.listAssociations().length, 2);
    assert.throws(() => store.saveAssociation({fromType:'event',fromId:'memory'}), /先记下/);
    const events = [{slug:'memory',data:{title:'记忆',draft:false}}];
    const orphan = {slug:'free-thought',body,data:{fromType:'event',fromId:'memory',toType:'',toId:'',draft:false}};
    assert.equal(publicThoughts(events,[],[orphan]).length, 1);
    assert.equal(publicConnections('event','memory',events,[],[orphan])[0].href, '/thoughts/free-thought');
    assert.equal(publicThoughts([{...events[0],data:{...events[0].data,draft:true}}],[],[orphan]).length, 0);
  } finally { assert.ok(basename(root).startsWith('c0ns1d2-associations-')); rmSync(root,{recursive:true,force:true}); }
});

test('standalone thoughts remain private by default and can later reference a public work', () => {
  const root = mkdtempSync(join(tmpdir(), 'c0ns1d2-associations-'));
  try {
    const store = createAssociationStore(root, () => []);
    const saved = store.saveAssociation({ body: '今天只想记下一句话。' });
    const thought = store.listAssociations().find(entry => entry.id === saved.id);
    assert.equal(thought.fromType, ''); assert.equal(thought.fromId, ''); assert.equal(thought.draft, true);
    assert.throws(() => store.saveAssociation({ fromType: 'event', body: '缺少完整起点' }), /完整/);
    assert.throws(() => store.saveAssociation({}), /先记下/);
    const entry = { slug: saved.id, body: thought.body, data: thought };
    assert.deepEqual(publicThoughts([], [], [entry]), []);
    const published = { ...entry, data: { ...thought, draft: false } };
    assert.equal(publicThoughts([], [], [published])[0].origin, null);
    const work = store.saveWork({ title: '一本书', kind: 'book' });
    store.saveAssociation({ ...thought, toType: 'work', toId: work.id, draft: false });
    const linked = { ...entry, data: store.listAssociations()[0] };
    const works = [{ slug: work.id, data: { title: '一本书', kind: 'book', draft: true } }];
    assert.deepEqual(publicThoughts([], works, [linked]), []);
    works[0].data.draft = false;
    assert.equal(publicConnections('work', work.id, [], works, [linked])[0].thoughtHref, '/thoughts/' + saved.id);
  } finally { assert.ok(basename(root).startsWith('c0ns1d2-associations-')); rmSync(root, { recursive: true, force: true }); }
});

test('list previews use body text without changing an explicit introduction or returning raw Markdown', () => {
  assert.equal(contentPreview(' 手写介绍 ', '# 原文'), '手写介绍');
  assert.equal(contentPreview('', '# 某一天\n\n![照片](/photos/a.png)\n\n想到 **一段话**，以及[一部作品](/works/a)。'), '某一天 想到 一段话，以及一部作品。');
  assert.equal(contentPreview('', ''), '');
  assert.equal(contentPreview('', 'abcdef', 3), 'abc…');
});
