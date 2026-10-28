// Keep the decoded stop frame. Seeking after pause makes the decoder jump back,
// then redraw it on the next click, which looks like a camera twitch.
export function createIntroController({ video, hint, dots, redFlash, onFinish, clock = globalThis }) {
  const HEAD = 1.2;
  const STOPS = [4.1, 8.0];
  const RATE = 1.12;
  let mode = 'stopped';
  let step = 0;
  let version = 0;
  let frameId = null;
  let timer = null;
  let headRequested = false;
  let pendingStart = false;
  const hasVideoFrames = typeof video.requestVideoFrameCallback === 'function';

  function showHint(text) {
    hint.disabled = !text;
    if (text) hint.textContent = text;
    hint.classList.toggle('hide', !text);
  }

  function stopWatching() {
    if (frameId === null) return;
    if (hasVideoFrames) video.cancelVideoFrameCallback(frameId);
    else clock.cancelAnimationFrame(frameId);
    frameId = null;
  }

  function stop() {
    ++version;
    mode = 'stopped';
    pendingStart = false;
    stopWatching();
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
    video.pause();
  }

  function finish() {
    if (mode !== 'play') return;
    mode = 'done';
    stopWatching();
    video.pause();
    showHint(null);
    redFlash.style.transition = 'opacity 0.5s ease';
    redFlash.style.opacity = '1';
    timer = clock.setTimeout(() => { timer = null; onFinish(); }, 700);
  }

  function checkProgress(time) {
    if (mode !== 'play') return;
    if (step === 2) {
      if (video.ended || (Number.isFinite(video.duration) && time >= video.duration - .4)) finish();
    } else if (video.ended || time >= STOPS[step]) {
      mode = 'hold';
      stopWatching();
      video.pause();
      dots[step + 1]?.classList.add('on');
      showHint('点击继续');
    }
  }

  function watch() {
    if (mode !== 'play' || frameId !== null) return;
    const callback = (_, metadata) => {
      frameId = null;
      checkProgress(metadata?.mediaTime ?? video.currentTime);
      watch();
    };
    frameId = hasVideoFrames
      ? video.requestVideoFrameCallback(callback)
      : clock.requestAnimationFrame(callback);
  }

  function play() {
    mode = 'play';
    showHint(null);
    video.playbackRate = RATE;
    const attempt = ++version;
    watch();
    // Browser buffering resumes the same play request by itself. Do not
    // pause/play every animation frame, and ignore promises from an old replay.
    const failed = () => {
      if (attempt !== version || mode !== 'play') return;
      mode = 'retry';
      stopWatching();
      showHint('播放未开始，点击重试');
    };
    try { video.play()?.catch(failed); } catch { failed(); }
  }

  function settleHead() {
    if (mode !== 'preparing' || !headRequested || video.seeking || video.readyState < 2) return;
    video.classList.add('is-ready');
    mode = 'ready';
    if (pendingStart) { pendingStart = false; play(); }
    else showHint('点击开始');
  }

  function prepareHead() {
    if (mode !== 'preparing' || headRequested || video.readyState < 1) return;
    headRequested = true;
    // Only initial preparation/replay seeks, before allowing playback.
    if (Math.abs(video.currentTime - HEAD) > .001) video.currentTime = HEAD;
    settleHead();
  }

  function reset() {
    stop();
    step = 0;
    mode = 'preparing';
    headRequested = false;
    video.classList.remove('is-ready');
    redFlash.style.transition = 'none';
    redFlash.style.opacity = '0';
    dots.forEach((dot, index) => dot.classList.toggle('on', index === 0));
    showHint('正在准备画面…');
    if (video.error) fail();
    else prepareHead();
  }

  function advance() {
    if (mode === 'preparing') {
      pendingStart = true;
      showHint('正在准备，稍候开始…');
    } else if (mode === 'ready' || mode === 'retry') play();
    else if (mode === 'hold') { ++step; play(); }
  }

  function fail() {
    stop();
    showHint('视频暂时无法加载，可直接进入');
    hint.disabled = true;
  }

  video.muted = true;
  video.disablePictureInPicture = true;
  video.addEventListener('loadedmetadata', prepareHead);
  video.addEventListener('loadeddata', settleHead);
  video.addEventListener('seeked', settleHead);
  video.addEventListener('canplay', settleHead);
  video.addEventListener('ended', () => checkProgress(video.currentTime));
  video.addEventListener('error', fail);
  return { advance, reset, stop };
}
