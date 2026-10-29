// Keep gestures separate from filtering and rope geometry.
export function installTimelineNavigation({ viewport, sheet, mobile, onChange, clock = globalThis }) {
  let scale = 1, gesture = null, suppressClick = false;
  let wheelFrame = null, pendingZoom = null;
  function cancelWheel() {
    if (wheelFrame !== null) clock.cancelAnimationFrame(wheelFrame);
    wheelFrame = null; pendingZoom = null;
  }
  const reset = document.getElementById('tl-scale-reset');
  const less = document.getElementById('tl-scale-less');
  const more = document.getElementById('tl-scale-more');
  function zoom(value, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) {
    cancelWheel();
    if (mobile.matches) return;
    const next = Math.min(1.8, Math.max(.55, value));
    const targetX = (viewport.scrollLeft + x) / scale * next - x;
    const targetY = (viewport.scrollTop + y) / scale * next - y;
    scale = next;
    sheet.style.zoom = String(scale);
    viewport.scrollTo({ left: targetX, top: targetY, behavior: 'instant' });
    reset.textContent = Math.round(scale * 100) + '%';
    less.disabled = scale <= .55; more.disabled = scale >= 1.8;
    onChange();
  }
  less.addEventListener('click', () => zoom(scale / 1.2));
  more.addEventListener('click', () => zoom(scale * 1.2));
  reset.addEventListener('click', () => zoom(1));
  viewport.addEventListener('wheel', event => {
    if (mobile.matches || event.ctrlKey || event.metaKey || event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    event.preventDefault();
    const box = viewport.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
    pendingZoom = { scale: Math.min(1.8, Math.max(.55, (pendingZoom?.scale ?? scale) * Math.exp(-delta * .0015))), x: event.clientX - box.left, y: event.clientY - box.top };
    if (wheelFrame === null) wheelFrame = clock.requestAnimationFrame(() => {
      const next = pendingZoom; wheelFrame = null; pendingZoom = null;
      if (next) zoom(next.scale, next.x, next.y);
    });
  }, { passive: false });
  viewport.addEventListener('pointerdown', event => {
    if (mobile.matches || event.pointerType !== 'mouse' || event.button !== 0) return;
    suppressClick = false;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop, dragging: false };
  });
  viewport.addEventListener('pointermove', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (!gesture.dragging && Math.hypot(dx, dy) < 6) return;
    if (!gesture.dragging) {
      gesture.dragging = true;
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add('is-dragging');
    }
    suppressClick = true;
    viewport.scrollTo({ left: gesture.left - dx, top: gesture.top - dy, behavior: 'instant' });
  });
  function end(event) {
    if (gesture && viewport.hasPointerCapture(gesture.id)) viewport.releasePointerCapture(gesture.id);
    gesture = null;
    viewport.classList.remove('is-dragging');
    if (event.type === 'pointercancel') suppressClick = false;
  }
  viewport.addEventListener('pointerup', end);
  viewport.addEventListener('pointercancel', end);
  viewport.addEventListener('lostpointercapture', end);
  viewport.addEventListener('dragstart', event => event.preventDefault());
  viewport.addEventListener('click', event => {
    if (suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick = false; }
  }, true);
  viewport.addEventListener('dblclick', event => { if (!event.target.closest('a,button')) zoom(1); });
  viewport.addEventListener('keydown', event => {
    if (event.target !== viewport || event.ctrlKey || event.metaKey || event.altKey) return;
    if (['+','=','-','0'].includes(event.key)) {
      event.preventDefault(); zoom(event.key === '0' ? 1 : event.key === '-' ? scale / 1.2 : scale * 1.2);
    }
  });
  mobile.addEventListener('change', () => {
    cancelWheel();
    scale = 1; sheet.style.zoom = '1'; reset.textContent = '100%'; less.disabled = false; more.disabled = false; onChange();
  });
}
