const dialog = document.getElementById('lightbox');
if (dialog instanceof HTMLDialogElement) {
  const pictures = [...document.querySelectorAll('.gallery-img')];
  const image = document.getElementById('lightbox-img');
  const counter = document.getElementById('lightbox-counter');
  const previous = document.getElementById('lightbox-prev');
  const next = document.getElementById('lightbox-next');
  const error = document.getElementById('lightbox-error');
  let index = 0;
  let trigger: EventTarget | null = null;
  let previousOverflow = '';
  const update = () => {
    if (!(image instanceof HTMLImageElement)) return;
    if (error) error.textContent = '';
    image.src = pictures[index].getAttribute('src') || '';
    image.alt = pictures[index].getAttribute('alt') || '事件照片';
    if (counter) counter.textContent = `${index + 1} / ${pictures.length}`;
    if (previous instanceof HTMLButtonElement) previous.disabled = index === 0;
    if (next instanceof HTMLButtonElement) next.disabled = index === pictures.length - 1;
  };
  pictures.forEach((picture, pictureIndex) => picture.closest('button')?.addEventListener('click', event => {
    index = pictureIndex; trigger = event.currentTarget; previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; update(); dialog.showModal();
  }));
  previous?.addEventListener('click', () => { if (index > 0) { index--; update(); } });
  next?.addEventListener('click', () => { if (index < pictures.length - 1) { index++; update(); } });
  document.getElementById('lightbox-close')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); dialog.close(); return; }
    if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); index--; update(); }
    if (event.key === 'ArrowRight' && index < pictures.length - 1) { event.preventDefault(); index++; update(); }
  });
  dialog.addEventListener('close', () => { document.body.style.overflow = previousOverflow; if (trigger instanceof HTMLElement) trigger.focus({ preventScroll: true }); });
  image?.addEventListener('error', () => { if (error) error.textContent = '这张照片暂时无法加载，可切换其他照片'; });
}
