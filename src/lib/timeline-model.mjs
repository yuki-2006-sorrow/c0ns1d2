// The archive's content model stays independent from its visual coordinates.
export function timelineDate(value) {
  const raw = String(value ?? '').trim();
  const match = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(raw);
  if (!match || +match[1] < 100) return { label: raw && !['?', '未知', '不详'].includes(raw) ? raw : '日期未定', year: 'undated', start: null, end: null };
  const year = +match[1], month = +(match[2] || 1), day = +(match[3] || 1);
  const start = Date.UTC(year, month - 1, day);
  const date = new Date(start);
  if (month < 1 || month > 12 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return { label: raw + ' · 待确认', year: 'undated', start: null, end: null };
  const end = match[3] ? start : match[2] ? Date.UTC(year, month, 0) : Date.UTC(year, 11, 31);
  const label = match[3] ? year + '.' + String(month).padStart(2, '0') + '.' + String(day).padStart(2, '0') : match[2] ? year + '.' + String(month).padStart(2, '0') + ' · 月份记忆' : year + ' · 年份记忆';
  return { label, year: String(year), start, end };
}

export function folderTrail(id, folders) {
  const trail = [], visited = new Set();
  while (id && folders[id] && !visited.has(id)) {
    visited.add(id);
    trail.unshift({ id, title: folders[id].title });
    id = folders[id].parent;
  }
  return trail;
}

export function prepareTimeline(events, folders = {}) {
  const entries = events.map(event => ({
    ...event,
    time: timelineDate(event.date),
    medium: folders[event.medium] ? event.medium : '',
    trail: folderTrail(event.medium, folders),
  })).sort((a, b) => (a.time.start ?? Infinity) - (b.time.start ?? Infinity) || a.slug.localeCompare(b.slug));
  const years = [...new Set(entries.map(event => event.time.year))].sort((a, b) => a === 'undated' ? 1 : b === 'undated' ? -1 : Number(a) - Number(b));
  const groups = Object.keys(folders).map(id => ({
    id,
    title: folderTrail(id, folders).map(folder => folder.title).join(' / '),
    count: entries.filter(event => event.trail.some(folder => folder.id === id)).length,
  })).filter(group => group.count).sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
  return { entries, years, groups };
}

export function selectTimeline(entries, year = 'all', group = '') {
  return entries.filter(event => (year === 'all' || event.time.year === year) && (!group || event.trail.some(folder => folder.id === group)));
}

// A vague year/month or two memories on the same day do not establish exact order.
export function hasChronologicalOrder(first, second) {
  return first.time.end !== null && second.time.start !== null && first.time.end < second.time.start;
}
