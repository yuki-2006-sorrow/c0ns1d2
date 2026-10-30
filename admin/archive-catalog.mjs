import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseFm, contentPath } from './content-tools.mjs';

// Read the old files once during setup/migration. Runtime reads use archive.json.
export function importCatalog(root) {
  const catalog = { groups: [], people: [] };
  for (const [folder, key] of [['mediums', 'groups'], ['people', 'people']]) {
    const base = join(root, 'src/content', folder);
    if (!existsSync(base)) continue;
    const walk = directory => {
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, item.name);
        if (item.isSymbolicLink()) throw new Error('原始资料目录不能包含链接');
        if (item.isDirectory()) walk(path);
        else if (item.name.endsWith('.md')) catalog[key].push({ ...parseFm(readFileSync(path, 'utf8')),
          slug: relative(base, path).replaceAll('\\', '/').slice(0, -3), revision: randomUUID() });
      }
    };
    walk(base);
  }
  return catalog;
}

export function originalDetails(root, entry) {
  const folder = { event: 'events', work: 'works', thought: 'associations' }[entry.type];
  if (!folder || !entry.source) return {};
  const path = contentPath(join(root, 'src/content', folder), entry.source);
  return existsSync(path) ? parseFm(readFileSync(path, 'utf8')) : {};
}

export function originalExtras(data, source = '') {
  return { quotes: Array.isArray(data.quotes) ? data.quotes.map(String) : [],
    sourceKind: data.source || (source.startsWith('auto/') ? 'auto' : '') };
}
