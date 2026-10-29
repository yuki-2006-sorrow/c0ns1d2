import { selectTimeline, hasChronologicalOrder } from '../lib/timeline-model.mjs';
import { dateThreadPath, eventThreadPath } from '../lib/timeline-threads.mjs';
import { installTimelineNavigation } from './timeline-navigation.js';

const model = JSON.parse(document.getElementById('timeline-data').textContent);
const root = document.getElementById('tl');
const viewport = document.getElementById('tl-scroll');
const sheet = document.getElementById('tl-sheet');
const svg = document.getElementById('tl-cords');
const groupSelect = document.getElementById('tl-group');
const items = new Map([...document.querySelectorAll('.tl-item')].map(node => [node.dataset.event, node]));
const mobile = matchMedia('(max-width: 760px)');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const storageKey = 'memory-scroll-v3:' + (model.viewKey || 'public');
const defaultYear = model.years.filter(year => year !== 'undated').at(-1) || model.years[0] || 'all';
let saved = null;
try { saved = JSON.parse(sessionStorage.getItem(storageKey)); } catch {}
const url = new URL(location.href);
const explicitView = url.searchParams.has('year') || url.searchParams.has('group');
let year = explicitView ? url.searchParams.get('year') || 'all' : saved?.year || defaultYear;
let group = explicitView ? url.searchParams.get('group') || '' : saved?.group || '';
if (!['all', ...model.years].includes(year)) year = defaultYear;
if (!model.groups.includes(group)) group = '';
let visible = [];
let active = '';
let drawFrame = 0;
let geometryKey = '';
let saveTimer = 0;
const svgNS = 'http://www.w3.org/2000/svg';

function element(tag, attributes) {
  const node = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function rope(d, kind, from, to, endpoints, uncertain = false) {
  const node = element('g', { class: 'tl-rope tl-rope-' + kind + (uncertain ? ' is-uncertain' : ''), 'data-from': from, 'data-to': to || '' });
  for (const layer of ['shadow', 'fiber', 'twist']) node.append(element('path', { d, class: 'tl-cord-' + layer }));
  for (const point of endpoints) node.append(element('circle', { cx: point.x, cy: point.y, r: 3, class: 'tl-knot' }));
  svg.append(node);
}

function highlight(slug = '') {
  active = slug;
  if (active) root.dataset.active = active; else delete root.dataset.active;
  svg.querySelectorAll('.tl-rope').forEach(node => node.classList.toggle('is-active', node.dataset.from === active || node.dataset.to === active));
}

function draw() {
  drawFrame = 0;
  if (!visible.length) { geometryKey = ''; svg.replaceChildren(); updatePaging(); return; }
  const origin = sheet.getBoundingClientRect();
  const visualScale = origin.width / sheet.offsetWidth || 1;
  const boxes = visible.map(event => {
    const item = items.get(event.slug);
    const card = item.querySelector('.tl-card').getBoundingClientRect();
    const date = item.querySelector('.tl-date').getBoundingClientRect();
    return {
      event, left: (card.left - origin.left) / visualScale, right: (card.right - origin.left) / visualScale,
      top: (card.top - origin.top) / visualScale, bottom: (card.bottom - origin.top) / visualScale,
      dateY: (date.top - origin.top + date.height / 2) / visualScale,
    };
  });
  const nextKey = JSON.stringify([sheet.offsetWidth, sheet.offsetHeight, mobile.matches, boxes.map(box => [box.event.slug, box.left, box.right, box.top, box.bottom, box.dateY])]);
  if (nextKey === geometryKey) { updatePaging(); return; }
  geometryKey = nextKey;
  svg.replaceChildren();
  svg.setAttribute('width', String(sheet.offsetWidth));
  svg.setAttribute('height', String(sheet.offsetHeight));
  const first = boxes[0], last = boxes.at(-1);
  const rail = mobile.matches
    ? 'M 12 ' + first.dateY + ' L 12 ' + last.bottom
    : 'M 12 56 L ' + (sheet.offsetWidth - 12) + ' 56';
  svg.append(element('path', { d: rail, class: 'tl-axis' }));
  boxes.forEach((box, index) => {
    const anchor = mobile.matches ? { x: 12, y: box.dateY } : { x: (box.left + box.right) / 2, y: 56 };
    const pin = mobile.matches ? { x: box.left, y: box.top + 30 } : { x: anchor.x, y: box.top };
    rope(dateThreadPath(anchor, pin, mobile.matches), 'date', box.event.slug, '', [anchor, pin]);
    if (index > 0 && boxes[index - 1].event.time.start !== null && box.event.time.start !== null) {
      const connection = eventThreadPath(boxes[index - 1], box, mobile.matches);
      rope(connection.d, 'order', boxes[index - 1].event.slug, box.event.slug, [connection.from, connection.to], !hasChronologicalOrder(boxes[index - 1].event, box.event));
    }
  });
  highlight(active);
  updatePaging();
}
function scheduleDraw() {
  if (!drawFrame) drawFrame = requestAnimationFrame(draw);
}
function updatePaging() {
  document.getElementById('tl-prev').disabled = viewport.scrollLeft <= 2 || !visible.length;
  document.getElementById('tl-next').disabled = viewport.scrollLeft + viewport.clientWidth >= viewport.scrollWidth - 2 || !visible.length;
  document.getElementById('tl-latest').disabled = !visible.length;
}
function remember() {
  const record = { year, group, left: viewport.scrollLeft, top: window.scrollY, mobile: mobile.matches };
  try { sessionStorage.setItem(storageKey, JSON.stringify(record)); } catch {}
}
function rememberSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(remember, 120); }

function render({ reset = true } = {}) {
  visible = selectTimeline(model.entries, year, group);
  const included = new Set(visible.map(event => event.slug));
  for (const [slug, node] of items) node.hidden = !included.has(slug);
  document.querySelectorAll('[data-year]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.year === year)));
  if (groupSelect) groupSelect.value = group;
  const yearLabel = year === 'all' ? '全部时间' : year === 'undated' ? '日期未定' : year;
  document.getElementById('tl-info').textContent = yearLabel + ' · ' + visible.length + ' 段记忆';
  document.getElementById('tl-empty').hidden = visible.length > 0;
  document.getElementById('tl-reset').hidden = model.entries.length === 0 || year === 'all' && !group;
  sheet.hidden = !visible.length;
  updatePaging();
  highlight();
  if (reset) {
    viewport.scrollLeft = 0;
    const next = new URL(location.href);
    next.searchParams.set('year', year);
    if (group) next.searchParams.set('group', group); else next.searchParams.delete('group');
    history.replaceState(null, '', next);
    remember();
  }
  scheduleDraw();
}
document.querySelectorAll('[data-year]').forEach(button => button.addEventListener('click', () => { year = button.dataset.year; render(); }));
groupSelect?.addEventListener('change', () => { group = groupSelect.value; render(); });
document.getElementById('tl-reset').addEventListener('click', () => { year = 'all'; group = ''; render(); });
function turn(direction) {
  viewport.scrollBy({ left: direction * Math.max(356, viewport.clientWidth * .8), behavior: reduced.matches ? 'instant' : 'smooth' });
}
document.getElementById('tl-prev').addEventListener('click', () => turn(-1));
document.getElementById('tl-next').addEventListener('click', () => turn(1));
document.getElementById('tl-latest').addEventListener('click', () => {
  const latest = [...visible].reverse().find(event => event.time.start !== null) || visible.at(-1);
  if (!latest) return;
  const card = items.get(latest.slug).querySelector('.tl-card');
  card.scrollIntoView({ behavior: reduced.matches ? 'instant' : 'smooth', block: mobile.matches ? 'center' : 'nearest', inline: 'center' });
  card.focus({ preventScroll: true });
});
viewport.addEventListener('scroll', () => { updatePaging(); rememberSoon(); }, { passive: true });
window.addEventListener('scroll', rememberSoon, { passive: true });
viewport.addEventListener('keydown', event => {
  if (event.target !== viewport || mobile.matches || event.ctrlKey || event.metaKey || event.altKey) return;
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') turn(event.key === 'ArrowLeft' ? -1 : 1);
  else viewport.scrollTo({ left: event.key === 'Home' ? 0 : viewport.scrollWidth, behavior: reduced.matches ? 'instant' : 'smooth' });
});
viewport.addEventListener('pointerover', event => { if (event.pointerType !== 'touch') highlight(event.target.closest('.tl-item')?.dataset.event); });
viewport.addEventListener('pointerleave', () => highlight(document.activeElement.closest('.tl-item')?.dataset.event));
viewport.addEventListener('focusin', event => highlight(event.target.closest('.tl-item')?.dataset.event));
viewport.addEventListener('focusout', event => highlight(event.relatedTarget?.closest?.('.tl-item')?.dataset.event));
document.querySelectorAll('.tl-photo img').forEach(image => {
  const check = () => { if (image.complete && image.naturalWidth === 0) image.parentElement.classList.add('is-missing'); };
  image.addEventListener('error', check);
  image.addEventListener('load', () => image.parentElement.classList.remove('is-missing'));
  check();
});
document.querySelector('.tl-controls').hidden = false;
document.querySelector('.tl-paging').hidden = false;
root.dataset.enhanced = '';
installTimelineNavigation({ viewport, sheet, mobile, onChange: scheduleDraw });
render({ reset: false });
new ResizeObserver(scheduleDraw).observe(sheet);
mobile.addEventListener('change', () => { viewport.scrollLeft = 0; scheduleDraw(); });
document.fonts?.ready.then(scheduleDraw);
requestAnimationFrame(() => {
  // Explicit links select a view; returning from a card restores the last reading position.
  if (saved && saved.year === year && saved.group === group && saved.mobile === mobile.matches) {
    if (Number.isFinite(saved.left)) viewport.scrollLeft = saved.left;
    if (Number.isFinite(saved.top)) window.scrollTo({ top: saved.top, behavior: 'instant' });
  }
  updatePaging();
});
window.addEventListener('pagehide', remember);
