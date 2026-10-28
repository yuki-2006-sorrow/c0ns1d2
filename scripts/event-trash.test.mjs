import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createEventTrashStore } from '../admin/event-trash-store.mjs';
import { revision } from '../admin/content-tools.mjs';
import { publicThoughts } from '../src/lib/associations.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'c0ns1d2-trash-'));
  const directory = join(root, 'src/content/events');
  const links = [];
  mkdirSync(join(directory, 'auto'), { recursive: true });
  const paths = ['auto/fragment.md', 'manual.md'];
  const sources = paths.map((rel, index) => `---\r\ntitle: "条目 ${index}"\r\ndate: 2024-01-01\r\ndraft: ${index === 0}\r\nmajor: ${index === 1}\r\nimages: ["/photos/shared.png"]\r\nquotes:\r\n  - 原始引文\r\n---\r\n\r\n原文保持不动。\r\n`);
  paths.forEach((rel, index) => writeFileSync(join(directory, rel), sources[index]));
  mkdirSync(join(root, 'public/photos'), { recursive: true });
  writeFileSync(join(root, 'public/photos/shared.png'), 'shared-media');
  const active = () => paths.filter(rel => existsSync(join(directory, rel))).map(rel => ({ slug: basename(rel, '.md') }));
  const store = createEventTrashStore(root, active, () => links);
  const items = () => paths.map(rel => ({ rel, revision: revision(readFileSync(join(directory, rel), 'utf8')) }));
  try { run({ root, directory, paths, sources, store, items, active, links }); }
  finally {
    assert.ok(basename(root).startsWith('c0ns1d2-trash-') && resolve(root).startsWith(resolve(tmpdir())));
    rmSync(root, { recursive: true, force: true });
  }
}

test('batch removal survives restart; restore preserves exact bytes, public flags and shared media', () => fixture(({ root, directory, paths, sources, store, items, active, links }) => {
  assert.deepEqual(store.list(), []);
  const plan = store.plan(items());
  assert.equal(plan[0].draft, true);
  assert.equal(plan[1].draft, false);
  assert.equal(plan[0].photos, 1);
  assert.equal(store.move(items()).count, 2);
  assert.equal(active().length, 0);
  assert.equal(readFileSync(join(root, 'public/photos/shared.png'), 'utf8'), 'shared-media');
  const reopened = createEventTrashStore(root, active, () => links);
  const trash = reopened.list();
  assert.equal(trash.length, 2);
  assert.ok(trash.every(entry => entry.rel && entry.removedAt));
  assert.ok(readdirSync(directory).every(name => name !== '.local-trash'));
  assert.equal(reopened.restore(trash.map(({ id }) => ({ id }))).count, 2);
  paths.forEach((rel, index) => assert.equal(readFileSync(join(directory, rel), 'utf8'), sources[index]));
  assert.deepEqual(reopened.list(), []);
  assert.throws(() => reopened.restore([{ id: trash[0].id }]), /已恢复/);
}));

test('stale batches, invalid paths and duplicate selections never partially remove events', () => fixture(({ root, directory, paths, store, items }) => {
  const stale = items();
  writeFileSync(join(directory, paths[1]), readFileSync(join(directory, paths[1]), 'utf8') + '后来写入');
  assert.throws(() => store.move(stale), /发生变化/);
  assert.ok(paths.every(rel => existsSync(join(directory, rel))));
  assert.deepEqual(store.list(), []);
  assert.throws(() => store.move([{ ...items()[0], revision: '' }]), /发生变化/);
  assert.throws(() => store.move([items()[0], items()[0]]), /重复/);
  assert.throws(() => store.move([{ rel: '../escape.md', revision: 'x' }]), /目录/);
  assert.throws(() => store.move([]), /选择/);
  assert.throws(() => store.restore([{ id: '../../escape' }]), /不正确/);
  assert.equal(existsSync(join(root, '.local-trash')), false);
}));

test('links in either direction, including private targetless thoughts, block the entire batch', () => fixture(({ directory, paths, store, items, links }) => {
  for (const link of [
    { fromType: 'event', fromId: 'fragment', toType: '', toId: '', draft: true },
    { fromType: 'work', fromId: 'book', toType: 'event', toId: 'fragment', draft: false },
  ]) {
    links.splice(0, links.length, link);
    assert.equal(store.plan(items())[0].associations, 1);
    assert.throws(() => store.move(items()), /含有联想/);
    assert.ok(paths.every(rel => existsSync(join(directory, rel))));
    assert.equal(links[0], link);
    assert.deepEqual(store.list(), []);
  }
}));

test('restore refuses both occupied paths and event-ID collisions without partial writes', () => fixture(({ directory, store, items }) => {
  store.move(items());
  const trash = store.list();
  mkdirSync(join(directory, 'different'), { recursive: true });
  // The original path is authoritative even when an externally supplied list omits it.
  writeFileSync(join(directory, trash[1].rel), 'new content');
  assert.throws(() => store.restore(trash.map(({ id }) => ({ id }))), /占用/);
  assert.equal(store.list().length, 2);
  assert.equal(readFileSync(join(directory, trash[1].rel), 'utf8'), 'new content');
  const target = trash.find(entry => entry.rel !== trash[1].rel);
  const blocked = createEventTrashStore(join(directory, '../../..'), () => [{ slug: basename(target.rel, '.md') }], () => []);
  assert.throws(() => blocked.restore([{ id: target.id }]), /标识已被占用/);
  assert.equal(store.list().length, 2);
}));

test('public traversal omits a missing event and its thought page', () => {
  const thought = { slug: 'thought', data: { fromType: 'event', fromId: 'gone', toType: '', toId: '', draft: false } };
  assert.deepEqual(publicThoughts([], [], [thought]), []);
});
