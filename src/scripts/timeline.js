import { layoutThreadCards, dateThreadPath, eventThreadPath } from '../lib/timeline-threads.mjs';
const { events, mediumMeta } = JSON.parse(document.getElementById('timeline-data').textContent);
// ===== 无限画布时间轴引擎（零依赖） =====
const world = document.getElementById('tl-world');
const info = document.getElementById('tl-info');
const tl = document.getElementById('tl');

const DAY = 86400000;
const SEAL = 360;   // 两端"记忆之外"封锁带宽度（px）
const CARD_H = 190, CARD_GAP_X = 28, CARD_GAP_Y = 44;
let activeEvent = null;

// 日期解析：支持 完整(YYYY-MM-DD) / 部分(YYYY-MM / YYYY) / 未知(?)，未知返回 null
function parseDate(s) {
  s = String(s || '').trim();
  if (!s || s === '?' || s === '未知' || s === '不详') return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) { const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return date.getUTCMonth() === +m[2] - 1 && date.getUTCDate() === +m[3] ? date.getTime() : null; }
  m = s.match(/^(\d{4})-(\d{1,2})/);
  if (m) return +m[2] >= 1 && +m[2] <= 12 ? Date.UTC(+m[1], +m[2] - 1, 1) : null;
  m = s.match(/^(\d{4})/);
  if (m) return Date.UTC(+m[1], 0, 1);
  const t = new Date(s).getTime();
  return isNaN(t) ? null : t;
}
const undatedCount = events.filter((e) => parseDate(e.date) == null).length;
if (undatedCount > 0) {
  const hintEl = document.querySelector('.tl-hint');
  if (hintEl) hintEl.textContent += ` · ${undatedCount} 个日期未知（未显示）`;
}

const list = events
  .map((e) => ({ ...e, medium: mediumMeta[e.medium] ? e.medium : '', t: parseDate(e.date) }))
  .filter((e) => e.t != null)
  .sort((a, b) => a.t - b.t);

// 聚合每个文件夹：名称/显示名/父级/最早/最晚/数量
function withinFolder(child, parent) {
  const visited = new Set();
  while (child && !visited.has(child)) { if (child === parent) return true; visited.add(child); child = mediumMeta[child]?.parent || ''; }
  return false;
}
const folderNames = new Set();
for (const event of list) { let name = event.medium; const visited = new Set(); while (name && mediumMeta[name] && !visited.has(name)) { visited.add(name); folderNames.add(name); name = mediumMeta[name].parent; } }
const allFolders = [...folderNames].map((name) => {
  const evs = list.filter((e) => withinFolder(e.medium, name));
  return {
    name,
    title: (mediumMeta[name] || {}).title || name,
    parent: folderNames.has(mediumMeta[name]?.parent) ? mediumMeta[name].parent : '',
    first: evs[0].t,
    last: evs[evs.length - 1].t,
    count: evs.length,
  };
});

const T0 = list[0]?.t ?? new Date().setHours(0, 0, 0, 0);
const T1 = list[list.length - 1]?.t ?? T0;
const totalDays = (T1 - T0) / DAY + 1;
const dayOf = (t) => (t - T0) / DAY;
const px = (day) => SEAL + day * scale;   // 数据区从 SEAL 开始，两端留出封锁带

let scale = 3;
let scroll = 0;  // 视口左缘对应的 world px（横向）
let scrollY = 0; // 视口上缘对应的 world px（纵向）
let dragging = false;
let lastX = 0;
let lastY = 0;
let raf = 0;
let focused = null;          // 当前聚焦的文件夹 medium（null=根视图）
let expandedSet = new Set(); // 聚焦视图内已展开的子文件夹
const folderHistory = [];
let dragStart = null;
let suppressClick = false;
const firstYear = new Date(T0).getUTCFullYear();
const lastYear = new Date(T1).getUTCFullYear();
function fitContext() {
  const relevant = focused ? list.filter(event => withinFolder(event.medium, focused)) : list;
  if (!relevant.length) { render(); return; }
  const span = Math.max(1, (relevant[relevant.length - 1].t - relevant[0].t) / DAY + 1);
  const padding = Math.min(280, tl.clientWidth - 48) / 2 + 28;
  scale = Math.max(.5, Math.min(55, Math.max(1, tl.clientWidth - padding * 2) / span));
  scroll = Math.max(0, px(dayOf(relevant[0].t)) - padding);
  scrollY = 0;
  render();
}
function zoomAt(factor, anchor = tl.clientWidth / 2) {
  const day = (scroll - SEAL + anchor) / scale;
  scale = Math.max(.5, Math.min(200, scale * factor));
  scroll = day * scale + SEAL - anchor;
  schedule();
}

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0; return h; }
function colorFor(e) {
  if (e.color && e.color !== '#888888') return e.color;
  const key = e.source || (e.persons && e.persons[0]) || e.slug;
  return `hsl(${hash(key) % 360}, 55%, 62%)`;
}
function el(tag, cls, style, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (style) Object.assign(n.style, style);
  if (text != null) n.textContent = text;
  return n;
}

function render() {
  if (!list.length) {
    world.textContent = '暂无已公开且日期明确的记忆';
    info.textContent = '0 个记忆节点';
    return;
  }
  const vw = tl.clientWidth;
  const vh = tl.clientHeight;
  const axisY = Math.max(164, Math.min(260, vh * .36));
  const cardWidth = Math.min(280, vw - 48);
  const worldW = totalDays * scale + SEAL * 2;

  // 横向边界封锁
  scroll = Math.max(0, Math.min(scroll, Math.max(0, worldW - vw, px(dayOf(T1)) - vw * 0.55)));

  world.innerHTML = '';
  world.style.width = worldW + 'px';

  const M = 200;
  const visible = (x) => x >= scroll - M && x <= scroll + vw + M;

  // 两端封锁带
  const sealL = el('div', 'tl-seal', { left: 0, top: 0, width: SEAL + 'px', height: vh + 'px' });
  sealL.appendChild(el('div', 'tl-seal-label', { left: '50%', top: '50%' }, '· 记忆之外 ·'));
  world.appendChild(sealL);
  const sealR = el('div', 'tl-seal', { left: (SEAL + totalDays * scale) + 'px', top: 0, width: SEAL + 'px', height: vh + 'px' });
  sealR.appendChild(el('div', 'tl-seal-label', { left: '50%', top: '50%' }, '· 记忆之外 ·'));
  world.appendChild(sealR);

  // 年份分段 + 标签
  for (let y = firstYear; y <= lastYear; y++) {
    const xs = px(dayOf(Date.UTC(y, 0, 1)));
    const xe = px(dayOf(Date.UTC(y + 1, 0, 1)));
    if (xe < scroll - M || xs > scroll + vw + M) continue;
    const band = el('div', 'tl-year-band', { left: xs + 'px', width: (xe - xs) + 'px', top: 0, height: vh + 'px' });
    if (y % 2 === 0) band.style.background = 'rgba(255,255,255,0.02)';
    world.appendChild(band);
    if (xe - xs > 60) world.appendChild(el('div', 'tl-year', { left: (xs + 12) + 'px', top: (vh * 0.1) + 'px' }, String(y)));
  }

  // 月份刻度
  if (scale * 30 > 55) {
    for (let y = firstYear; y <= lastYear; y++) for (let m = 0; m < 12; m++) {
      const d = Date.UTC(y, m, 1);
      if (d < T0 - DAY * 31 || d > T1 + DAY * 31) continue;
      const x = px(dayOf(d));
      if (!visible(x)) continue;
      world.appendChild(el('div', 'tl-month', { left: x + 'px', top: (axisY - 82) + 'px' }, `${m + 1}月`));
    }
  }

  // 日刻度
  if (scale > 12) {
    for (let d = 0; d <= totalDays; d++) {
      const x = px(d);
      if (!visible(x)) continue;
      world.appendChild(el('div', 'tl-day', { left: x + 'px', top: (axisY - 4) + 'px' }));
    }
  }

  // 主轴
  world.appendChild(el('div', 'tl-axis', { left: SEAL + 'px', top: axisY + 'px', width: totalDays * scale + 'px' }));

  // === 当前上下文（聚焦文件夹后，时间轴上只剩它的内容） ===
  const contextFolders = !focused
    ? allFolders.filter((f) => !f.parent)
    : allFolders.filter((f) => f.parent === focused);
  const contextEvents = !focused
    ? list.filter((e) => !e.medium)
    : list.filter((e) => e.medium === focused);

  // Warm hanging cords attach to exact dates; burgundy cords show chronological order.
  const svgNS = 'http://www.w3.org/2000/svg';
  const cords = document.createElementNS(svgNS, 'svg');
  cords.classList.add('tl-cords');
  cords.setAttribute('aria-hidden', 'true');
  world.appendChild(cords);
  function svgElement(tag, attributes) {
    const node = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  }
  function rope(d, kind, from, to = '') {
    const group = svgElement('g', { class: 'tl-rope tl-rope-' + kind, 'data-from': from, 'data-to': to });
    for (const layer of ['shadow', 'fiber', 'twist']) group.appendChild(svgElement('path', { d, class: 'tl-cord-' + layer }));
    cords.appendChild(group);
    return group;
  }
  function knot(group, x, y) { group.appendChild(svgElement('circle', { cx: x, cy: y, r: 3.2, class: 'tl-knot' })); }
  const showCards = scale > 20 || contextEvents.length <= 12;
  const positions = layoutThreadCards(contextEvents, { xFor: event => px(dayOf(event.t)), axisY, width: cardWidth, height: CARD_H, gapX: CARD_GAP_X, gapY: CARD_GAP_Y });
  const dateLanes = [];
  positions.forEach(position => {
    const { event, anchorX: x, left, width, top } = position;
    const cardCenter = left + width / 2;
    if (!visible(x) && !visible(cardCenter)) return;
    const endY = showCards ? top - 3 : axisY + 36 + (hash(event.slug) % 4) * 18;
    const thread = rope(dateThreadPath(x, axisY + 5, showCards ? cardCenter : x, endY, 8 + hash(event.slug) % 10), 'date', event.slug);
    knot(thread, x, axisY + 4);
    if (!showCards) knot(thread, x, endY);
    const size = event.major ? 12 : 8;
    const dot = el('a', event.major ? 'tl-dot tl-dot-major' : 'tl-dot', { left: (x - size / 2) + 'px', top: (axisY - size / 2) + 'px', width: size + 'px', height: size + 'px' });
    dot.href = '/events/' + encodeURIComponent(event.slug);
    dot.title = event.date + ' · ' + event.title;
    dot.dataset.event = event.slug;
    dot.setAttribute('aria-label', dot.title);
    world.appendChild(dot);
    if (showCards || event.major && scale > 4) {
      let lane = 0;
      const left = x - 48;
      while (dateLanes[lane] != null && dateLanes[lane] > left) ++lane;
      dateLanes[lane] = x + 54;
      const label = el('a', 'tl-date-label', { left: x + 'px', top: (axisY - 34 - lane * 22) + 'px' }, event.date);
      label.href = dot.href;
      label.dataset.event = event.slug;
      label.setAttribute('aria-label', event.date + '，' + event.title);
      world.appendChild(label);
    }
  });
  if (showCards) {
    for (let index = 1; index < positions.length; ++index) {
      const first = positions[index - 1], second = positions[index];
      if (second.left + second.width < scroll - M || first.left > scroll + vw + M) continue;
      const line = eventThreadPath(first, second, { leftBound: scroll + 12, rightBound: scroll + vw - 12 });
      const thread = rope(line.d, 'order', first.event.slug, second.event.slug);
      knot(thread, ...line.from); knot(thread, ...line.to);
    }
  } else {
    for (let index = 1; index < positions.length; ++index) {
      const first = positions[index - 1], second = positions[index];
      if (second.anchorX < scroll - M || first.anchorX > scroll + vw + M) continue;
      const y1 = axisY + 36 + hash(first.event.slug) % 4 * 18;
      const y2 = axisY + 36 + hash(second.event.slug) % 4 * 18;
      rope(dateThreadPath(first.anchorX, y1, second.anchorX, y2, 18), 'order', first.event.slug, second.event.slug);
    }
  }

  // 当前上下文的文件夹 → 区间条（并行分道，跨度越大越粗；点击：根视图=进入，聚焦视图=展开子文件夹）
  {
    const folderArr = contextFolders.slice().sort((a, b) => a.first - b.first);
    const laneEnd = [];
    const baseY = vh * 0.28;
    const laneH = 26;
    for (const f of folderArr) {
      const x1 = px(dayOf(f.first));
      const x2 = px(dayOf(f.last));
      let lane = 0;
      while (laneEnd[lane] != null && laneEnd[lane] > x1) lane++;
      laneEnd[lane] = Math.max(x2, x1 + 210) + 12;
      f.lane = lane;
    }
    for (const f of folderArr) {
      const x1 = px(dayOf(f.first));
      const x2 = px(dayOf(f.last));
      if (x2 < scroll - M || x1 > scroll + vw + M) continue; // 完全在视野外才跳过
      const spanDays = (f.last - f.first) / DAY;
      const h = Math.min(10 + spanDays * 0.06, 22); // 跨度越大越粗
      const y = baseY + f.lane * laneH;
      const w = Math.max(x2 - x1, 200);
      const isOpen = focused === f.name || expandedSet.has(f.name);
      const color = `hsl(${hash(f.name) % 360}, 55%, 60%)`;
      const bar = el('button', 'tl-folder-bar', { left: x1 + 'px', top: (y - h / 2) + 'px', width: w + 'px', height: h + 'px' });
      bar.type = 'button';
      bar.setAttribute('aria-label', `进入 ${f.title}，${f.count} 个事件`);
      bar.style.background = isOpen ? `hsla(${hash(f.name) % 360}, 60%, 60%, 0.4)` : `hsla(${hash(f.name) % 360}, 55%, 60%, 0.15)`;
      bar.style.borderColor = color;
      bar.title = !focused ? `点击进入「${f.title}」` : (expandedSet.has(f.name) ? `点击收起「${f.title}」` : `点击展开「${f.title}」的 ${f.count} 个子事件`);
      bar.style.cursor = 'pointer';
      bar.addEventListener('pointerdown', (e) => { suppressClick = false; e.stopPropagation(); });
      bar.addEventListener('click', () => {
        folderHistory.push({ focused, scale, scroll, scrollY });
        focused = f.name;
        expandedSet.clear();
        fitContext();
      });
      world.appendChild(bar);
      const lbl = el('div', 'tl-folder', { left: (x1 + 6) + 'px', top: y + 'px' }, `📁 ${f.title} · ${f.count}`);
      lbl.style.borderColor = color;
      world.appendChild(lbl);
    }
  }

  // Keep card positions stable when panning, including same-day entries.
  if (showCards) for (const position of positions) {
    const { event, anchorX, left, top, width } = position;
    if (left + width < scroll - M || left > scroll + vw + M) continue;
    const card = el('a', 'tl-card' + (event.major ? ' tl-card-major' : ''), { left: left + 'px', top: top + 'px', width: width + 'px', height: CARD_H + 'px' });
    card.href = '/events/' + encodeURIComponent(event.slug);
    card.dataset.event = event.slug;
    card.setAttribute('aria-label', event.date + ' · ' + event.title);
    card.appendChild(el('div', 'tl-card-date', {}, event.date));
    card.appendChild(el('div', 'tl-card-title', {}, event.title));
    const preview = event.summary || event.persons?.join(' · ');
    if (preview) card.appendChild(el('div', 'tl-card-summary', {}, preview));
    card.appendChild(el('span', 'tl-card-enter', {}, '进入记忆 ↗'));
    world.appendChild(card);
  }

  const cardBottom = showCards ? Math.max(axisY, ...positions.map(position => position.top + CARD_H)) : axisY + 140;
  const worldH = Math.max(vh, cardBottom + 140);
  scrollY = Math.max(0, Math.min(scrollY, worldH - vh));
  world.style.height = worldH + 'px';
  cords.setAttribute('width', worldW); cords.setAttribute('height', worldH);
  sealL.style.height = worldH + 'px';
  sealR.style.height = worldH + 'px';
  world.style.transform = `translate(${-scroll}px, ${-scrollY}px)`;
  highlight(activeEvent);

  // 返回按钮：聚焦时显示
  const backBtn = document.getElementById('tl-back');
  if (backBtn) {
    if (focused) { backBtn.style.display = ''; backBtn.textContent = `← 返回全部（${(mediumMeta[focused] || {}).title || focused}）`; }
    else backBtn.style.display = 'none';
  }

  const level = showCards ? '挂绳卡片' : scale < 2 ? '年份' : scale < 20 ? '月份' : '日';
  info.textContent = focused
    ? `「${(mediumMeta[focused] || {}).title || focused}」内 ${contextEvents.length} 个事件 · ${level}视图`
    : `${list.length} 个记忆节点 · ${level}视图 · ${Math.round(scale * 10) / 10}px/天`;
}

function highlight(slug) {
  activeEvent = slug || null;
  tl.classList.toggle('tl-has-active', !!activeEvent);
  world.querySelectorAll('[data-event]').forEach(node => node.classList.toggle('is-active', node.dataset.event === activeEvent));
  world.querySelectorAll('.tl-rope').forEach(node => node.classList.toggle('is-active', node.dataset.from === activeEvent || node.dataset.to === activeEvent));
}
world.addEventListener('pointerover', event => highlight(event.target.closest('[data-event]')?.dataset.event));
world.addEventListener('pointerleave', () => highlight(document.activeElement.closest('[data-event]')?.dataset.event));
world.addEventListener('focusin', event => highlight(event.target.closest('[data-event]')?.dataset.event));
world.addEventListener('focusout', event => highlight(event.relatedTarget?.closest?.('[data-event]')?.dataset.event));
document.getElementById('tl-order').addEventListener('click', event => {
  const button = event.currentTarget;
  const show = button.getAttribute('aria-pressed') !== 'true';
  button.setAttribute('aria-pressed', String(show));
  tl.classList.toggle('tl-hide-order', !show);
});
function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); }

tl.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; dragging = false; suppressClick = false; dragStart = { x: e.clientX, y: e.clientY }; lastX = e.clientX; lastY = e.clientY; });
tl.addEventListener('pointermove', (e) => {
  if (!dragStart) return;
  if (!dragging) {
    if (Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) < 6) return;
    dragging = true; suppressClick = true; tl.setPointerCapture(e.pointerId);
  }
  scroll -= (e.clientX - lastX);
  scrollY -= (e.clientY - lastY);
  lastX = e.clientX; lastY = e.clientY;
  schedule();
});
tl.addEventListener('pointerup', () => { dragging = false; dragStart = null; });
tl.addEventListener('pointercancel', () => { dragging = false; dragStart = null; });
tl.addEventListener('click', event => { if (suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick = false; } }, true);
tl.addEventListener('wheel', (e) => {
  e.preventDefault();
  const cursorX = e.clientX - tl.getBoundingClientRect().left;
  if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { scroll += e.deltaX || e.deltaY; schedule(); }
  else zoomAt(Math.exp(-e.deltaY * 0.0015), cursorX);
}, { passive: false });

// 底部 UI 栏交互不触发画布拖拽
document.querySelector('.tl-ui').addEventListener('pointerdown', (e) => e.stopPropagation());

// 跳到最近事件（平滑滚动，最新事件居中）
function animateTo(target) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { scroll = target; render(); return; }
  const start = scroll;
  const t0 = performance.now();
  const dur = 450;
  cancelAnimationFrame(raf);
  const step = (now) => {
    const t = Math.min(1, (now - t0) / dur);
    const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    scroll = start + (target - start) * e;
    render();
    if (t < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
document.getElementById('tl-jump-latest').addEventListener('click', () => {
  const vw = tl.clientWidth;
  const relevant = focused ? list.filter(event => withinFolder(event.medium, focused)) : list;
  const latest = relevant[relevant.length - 1];
  if (latest) animateTo(px(dayOf(latest.t)) - vw / 2);
});
document.getElementById('tl-back').addEventListener('click', () => {
  const previous = folderHistory.pop();
  focused = previous?.focused || null;
  if (previous) { scale = previous.scale; scroll = previous.scroll; scrollY = previous.scrollY; }
  expandedSet.clear();
  render();
});

window.addEventListener('resize', schedule);
document.getElementById('tl-fit').onclick = fitContext;
document.getElementById('tl-zoom-in').onclick = () => zoomAt(1.4);
document.getElementById('tl-zoom-out').onclick = () => zoomAt(1 / 1.4);
tl.addEventListener('keydown', event => {
  if (event.target !== tl || event.ctrlKey || event.metaKey || event.altKey) return;
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','Home'].includes(event.key)) event.preventDefault();
  if (event.key === 'ArrowLeft') scroll -= 90;
  if (event.key === 'ArrowRight') scroll += 90;
  if (event.key === 'ArrowUp') scrollY -= 90;
  if (event.key === 'ArrowDown') scrollY += 90;
  if (event.key === '+' || event.key === '=') return zoomAt(1.4);
  if (event.key === '-') return zoomAt(1 / 1.4);
  if (event.key === 'Home') return fitContext();
  schedule();
});
let restored = false;
try {
  const saved = JSON.parse(sessionStorage.getItem('timeline-view') || 'null');
  if (saved && saved.total === list.length && Number.isFinite(saved.scale) && saved.scale >= .5 && saved.scale <= 200 && Number.isFinite(saved.scroll) && Number.isFinite(saved.scrollY) && (!saved.focused || mediumMeta[saved.focused])) {
    scale = saved.scale; scroll = saved.scroll; scrollY = saved.scrollY; focused = saved.focused || null; restored = true;
  }
} catch {}
if (restored) render(); else fitContext();
window.addEventListener('pagehide', () => { try { sessionStorage.setItem('timeline-view', JSON.stringify({ total: list.length, scale, scroll, scrollY, focused })); } catch {} });
