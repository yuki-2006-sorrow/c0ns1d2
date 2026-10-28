export const workKinds = { book: '书', film: '电影', game: '游戏' };

export function eventReference(entry) {
  return (entry.id || `${entry.slug}.md`).split(/[\\/]/).pop().replace(/\.md$/, '');
}

export function publicThoughts(events, works, associations) {
  const entries = new Map();
  for (const event of events.filter((entry) => !entry.data.draft)) {
    const slug = event.slug.split('/').pop();
    const reference = eventReference(event);
    entries.set(`event:${reference}`, { type: 'event', id: reference, title: event.data.title, label: '记忆', href: `/events/${encodeURIComponent(slug)}`, summary: event.data.summary });
  }
  for (const work of works.filter((entry) => !entry.data.draft)) {
    const slug = work.slug;
    entries.set(`work:${slug}`, { type: 'work', id: slug, title: work.data.title, label: workKinds[work.data.kind], href: `/works/${encodeURIComponent(slug)}`, summary: work.data.summary });
  }
  return associations.filter((entry) => !entry.data.draft).flatMap((entry) => {
    const data = entry.data;
    const fromKey = `${data.fromType}:${data.fromId}`;
    const toKey = `${data.toType}:${data.toId}`;
    const hasTarget = !!(data.toType || data.toId);
    if (!entries.has(fromKey) || hasTarget && (fromKey === toKey || !entries.has(toKey))) return [];
    const text = entry.body?.trim() || data.note || '';
    return [{ id: entry.slug, entry, origin: entries.get(fromKey), target: hasTarget ? entries.get(toKey) : null, fromKey, toKey: hasTarget ? toKey : '', text, preview: text.replace(/^#{1,6}\s+/gm, '').slice(0,360), title: data.title || text.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').slice(0, 36) || '一段联想', thoughtHref: `/thoughts/${encodeURIComponent(entry.slug)}`, note: data.note || '', excerpt: data.excerpt || '', locator: data.locator || '' }];
  });
}

export function publicConnections(type, id, events, works, associations) {
  const currentKey = `${type}:${id}`;
  return publicThoughts(events, works, associations).filter(thought => thought.fromKey === currentKey || thought.toKey === currentKey).map(thought => {
    const other = thought.fromKey === currentKey ? thought.target : thought.origin;
    return { ...other, ...thought, title: other?.title || thought.title, href: other?.href || thought.thoughtHref, label: other?.label || '联想', reverse: thought.fromKey !== currentKey };
  });
}
