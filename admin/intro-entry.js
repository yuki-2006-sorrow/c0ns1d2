import { createIntroController } from '/intro-controller.js';

const replay = document.getElementById('replay-intro');
if (replay) {
  const dialog = document.createElement('dialog');
  dialog.className = 'intro-dialog';
  dialog.setAttribute('aria-label', '共同留下 · 开场');
  dialog.innerHTML = '<video class="intro-film" data-src="/intro/intro.mp4" poster="/intro/k1.png" muted playsinline preload="none" disablepictureinpicture></video><div class="intro-fade"></div><div class="intro-caption">c0ns1d2 · 共同留下</div><button type="button" class="intro-skip">进入作品 →</button><button type="button" class="intro-hint">点击开始</button><div class="intro-dots" aria-hidden="true"><span class="on"></span><span></span><span></span></div>';
  document.body.append(dialog);
  const video = dialog.querySelector('video'), hint = dialog.querySelector('.intro-hint');
  let prepared = false;
  const controller = createIntroController({video, hint, dots: dialog.querySelectorAll('.intro-dots span'), redFlash: dialog.querySelector('.intro-fade'), onFinish: finish});
  function finish() {
    controller.stop();
    dialog.close();
    try { localStorage.setItem('introPlayed', '1'); } catch {}
  }
  function open() {
    prepared = false;
    hint.textContent = '点击开始'; hint.disabled = false; hint.classList.remove('hide');
    video.classList.remove('is-ready');
    dialog.querySelector('.intro-fade').style.opacity = '0';
    dialog.querySelectorAll('.intro-dots span').forEach((dot,index) => dot.classList.toggle('on',index===0));
    dialog.showModal();
  }
  dialog.addEventListener('click', event => {
    if (event.target.closest('.intro-skip')) return;
    if (!prepared) { controller.reset(); prepared = true; }
    controller.advance();
  });
  dialog.querySelector('.intro-skip').onclick = finish;
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish(); });
  dialog.addEventListener('close', () => controller.stop());
  replay.onclick = open;
  let watched = false;
  try { watched = localStorage.getItem('introPlayed') === '1'; } catch {}
  if (!watched && !matchMedia('(prefers-reduced-motion: reduce)').matches) open();
}
