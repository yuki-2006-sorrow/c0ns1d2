import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slug as githubSlug } from 'github-slugger';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, process.argv[2] || 'dist');

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = join(directory, entry.name);
    return entry.isDirectory() ? files(target) : [target];
  });
}

const events = files(join(root, 'src/content/events')).filter((file) => file.endsWith('.md')).map((file) => {
  const text = readFileSync(file, 'utf8').replace(/\r/g, '');
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1];
  assert.notEqual(frontmatter, undefined, `Missing frontmatter: ${file}`);
  const flag = frontmatter.match(/^draft:[ \t]*(.*)$/m)?.[1].trim();
  assert.ok(flag === undefined || flag === 'true' || flag === 'false', `Unsupported draft flag: ${file}`);
  return { id: basename(file, '.md'), slug: githubSlug(basename(file, '.md')), draft: flag !== 'false' };
});

assert.equal(new Set(events.map((event) => event.slug)).size, events.length, 'Duplicate event route slugs');
assert.ok(existsSync(dist), 'Run npm run build first');
const artifacts = files(dist);
const publicSlugs = new Set(events.filter((event) => !event.draft).map((event) => event.slug));
const eventPages = artifacts.filter((file) => file.startsWith(join(dist, 'events') + '/') || file.startsWith(join(dist, 'events') + '\\'))
  .filter((file) => file.endsWith('.html') && file !== join(dist, 'events/index.html'));
assert.equal(eventPages.length, publicSlugs.size, 'Unexpected event page count');
for (const slug of publicSlugs) {
  assert.ok(existsSync(join(dist, 'events', slug, 'index.html')), `Missing published page: ${slug}`);
}

// Content in auto/ still uses a flat public event route, including tag links.
for (const page of artifacts.filter(file => file.startsWith(join(dist, 'tags') + '/') || file.startsWith(join(dist, 'tags') + '\\'))) {
  if (!page.endsWith('.html')) continue;
  const html = readFileSync(page, 'utf8');
  for (const match of html.matchAll(/href="\/events\/([^"]+)"/g)) {
    const target = decodeURIComponent(match[1]).replace(/\/$/, '');
    assert.ok(publicSlugs.has(target), `Invalid event link in tag page: ${page} -> ${target}`);
  }
}

const output = artifacts.filter((file) => /\.(html|js|json|map)$/.test(file))
  .map((file) => readFileSync(file, 'utf8')).join('\n');
for (const event of events.filter((entry) => entry.draft)) {
  assert.ok(!output.includes(event.id) && !output.includes(event.slug) && !output.includes(encodeURIComponent(event.slug)), `Draft identifier in public output: ${event.slug}`);
}
const draftsPage = join(dist, 'drafts/index.html');
if (existsSync(draftsPage)) {
  assert.ok(!readFileSync(draftsPage, 'utf8').includes('class="draft-card"'), 'Draft browser content in production');
}
console.log(`Public build verified: ${publicSlugs.size} published events, ${events.length - publicSlugs.size} drafts excluded.`);

function records(collection) {
  const directory = join(root, 'src/content', collection);
  if (!existsSync(directory)) return [];
  return files(directory).filter(file => file.endsWith('.md')).map(file => {
    const source = readFileSync(file, 'utf8').replace(/\r/g, '');
    const frontmatter = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1];
    assert.notEqual(frontmatter, undefined, `Missing frontmatter: ${file}`);
    const data = Object.fromEntries(frontmatter.split('\n').filter(Boolean).map(line => {
      const separator = line.indexOf(':');
      return [line.slice(0, separator), JSON.parse(line.slice(separator + 1).trim())];
    }));
    return { ...data, id: basename(file, '.md') };
  });
}
const works = records('works');
const publicWorks = new Set(works.filter(work => work.draft === false).map(work => work.id));
const workPages = artifacts.filter(file => file.startsWith(join(dist, 'works') + '/') || file.startsWith(join(dist, 'works') + '\\'))
  .filter(file => file.endsWith('.html') && file !== join(dist, 'works/index.html'));
assert.equal(workPages.length, publicWorks.size, 'Unexpected or cached work routes');
for (const work of works) {
  const page = join(dist, 'works', work.id, 'index.html');
  assert.equal(existsSync(page), publicWorks.has(work.id), `Unexpected work visibility: ${work.id}`);
  if (!publicWorks.has(work.id)) assert.ok(!output.includes(work.id), `Draft work in public output: ${work.id}`);
}
const publicKeys = new Set(events.filter(event => !event.draft).map(event => `event:${event.id}`).concat([...publicWorks].map(id => `work:${id}`)));
let visibleThoughtCount = 0;
for (const association of records('associations')) {
  const from = `${association.fromType}:${association.fromId}`;
  const to = `${association.toType}:${association.toId}`;
  const hasTarget = !!(association.toType || association.toId);
  const hasOrigin = !!(association.fromType || association.fromId);
  const visible = association.draft === false && (!hasOrigin || publicKeys.has(from)) && (!hasTarget || from !== to && publicKeys.has(to));
  if (visible) visibleThoughtCount++;
  assert.equal(output.includes(association.id), visible, `Unexpected association visibility: ${association.id}`);
  assert.equal(existsSync(join(dist, 'thoughts', association.id, 'index.html')), visible, `Unexpected thought route: ${association.id}`);
}
const thoughtPages = artifacts.filter(file => file.startsWith(join(dist, 'thoughts') + '/') || file.startsWith(join(dist, 'thoughts') + '\\')).filter(file => file.endsWith('.html') && file !== join(dist, 'thoughts/index.html'));
assert.equal(thoughtPages.length, visibleThoughtCount, 'Unexpected or cached thought pages');
console.log(`Works and manual associations verified: ${publicWorks.size} published works.`);
