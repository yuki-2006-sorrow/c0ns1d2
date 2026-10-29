import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIntroController } from '../src/scripts/intro-controller.js';
import { serveVideo } from '../admin/media-response.mjs';

function fixture({ fallback = false } = {}) {
  const frames = new Map(), timers = new Map();
  let sequence = 0;
  const classes = () => {
    const names = new Set();
    return { add: name => names.add(name), remove: name => names.delete(name), contains: name => names.has(name), toggle(name, active) { if (active) names.add(name); else names.delete(name); } };
  };
  const clock = {
    requestAnimationFrame(callback) { frames.set(++sequence, callback); return sequence; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback) { timers.set(++sequence, callback); return sequence; },
    clearTimeout(id) { timers.delete(id); },
  };
  class Video extends EventTarget {
    time = 0; seeks = []; plays = 0; pauses = 0;
    readyState = 4; paused = true; seeking = false; ended = false; duration = 12.083333;
    classList = classes();
    get currentTime() { return this.time; }
    set currentTime(time) { this.seeks.push(time); this.time = time; this.seeking = true; }
    play() { ++this.plays; this.paused = false; return this.nextPlay || Promise.resolve(); }
    pause() { ++this.pauses; this.paused = true; }
    requestVideoFrameCallback(callback) { return clock.requestAnimationFrame(callback); }
    cancelVideoFrameCallback(id) { clock.cancelAnimationFrame(id); }
    prepared() { this.seeking = false; this.dispatchEvent(new Event('seeked')); }
    frame(time) {
      this.time = time + .01;
      const callbacks = [...frames.values()]; frames.clear();
      callbacks.forEach(callback => callback(0, { mediaTime: time }));
    }
  }
  const video = new Video();
  if (fallback) video.requestVideoFrameCallback = undefined;
  const hint = { classList: classes(), textContent: '', disabled: false };
  const redFlash = { style: {} };
  let finished = 0;
  const intro = createIntroController({ video, hint, dots: [0,1,2].map(() => ({ classList: classes() })), redFlash, clock, onFinish: () => ++finished });
  return { intro, video, hint, frames, timers, redFlash, finished: () => finished };
}

test('three clicks keep the displayed stop frames without backward seeks or buffer pause loops', () => {
  const { intro, video, hint, frames, timers, finished } = fixture();
  intro.reset(); video.prepared();
  assert.equal(hint.textContent, '点击开始');
  intro.advance(); intro.advance(); // double click must not skip a stage
  video.readyState = 2;
  const pauses = video.pauses;
  video.frame(2.0); video.frame(3.0);
  assert.equal(video.pauses, pauses, 'buffering is managed by the browser');
  video.frame(4.12);
  assert.equal(video.paused, true);
  assert.equal(video.currentTime, 4.13, 'keep the actual decoded frame');
  assert.equal(frames.size, 0, 'no idle frame loop');
  intro.advance(); video.frame(8.02);
  assert.equal(hint.textContent, '点击继续');
  intro.advance(); video.frame(11.8);
  assert.equal(video.plays, 3);
  assert.deepEqual(video.seeks, [1.2], 'only prepare/replay may seek');
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.equal(finished(), 1);
});

test('video is requested only when the intro is opened and buffering keeps the current play request', () => {
  const {intro,video,hint}=fixture();
  let loads=0;
  video.dataset={src:'/intro/intro.mp4'};video.getAttribute=()=>video.src||null;video.load=()=>++loads;
  assert.equal(loads,0);
  intro.reset();video.prepared();intro.advance();
  assert.equal(loads,1);assert.equal(video.src,'/intro/intro.mp4');
  video.dispatchEvent(new Event('waiting'));
  assert.match(hint.textContent,/缓冲/);assert.equal(hint.disabled,true);
  video.dispatchEvent(new Event('playing'));
  assert.equal(hint.classList.contains('hide'),true);assert.equal(video.plays,1);
  intro.reset();assert.equal(loads,1);
});

test('an early click waits for the prepared frame; a late loadeddata cannot rewind playback', () => {
  const { intro, video, hint } = fixture();
  video.readyState = 0;
  intro.reset(); intro.advance();
  assert.equal(video.plays, 0);
  video.readyState = 1; video.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(video.plays, 0);
  video.readyState = 3; video.prepared();
  assert.equal(video.plays, 1);
  video.frame(2.4);
  video.dispatchEvent(new Event('loadeddata'));
  assert.deepEqual(video.seeks, [1.2]);
  assert.equal(video.paused, false);
  assert.equal(hint.classList.contains('hide'), true);
});

test('replay cancels the previous finale timer and ignores aborted old play promises', async () => {
  const { intro, video, hint, timers } = fixture();
  let rejectOld;
  video.nextPlay = new Promise((_, reject) => { rejectOld = reject; });
  intro.reset(); video.prepared(); intro.advance();
  intro.stop(); intro.reset(); video.prepared();
  video.nextPlay = null;
  intro.advance();
  rejectOld(new Error('old play interrupted by replay'));
  await Promise.resolve();
  assert.equal(hint.classList.contains('hide'), true);
  video.frame(4.12); intro.advance(); video.frame(8.02); intro.advance(); video.frame(11.8);
  assert.equal(timers.size, 1);
  intro.stop(); intro.reset(); video.prepared();
  assert.equal(timers.size, 0, 'old transition must not hide the replay');
  assert.equal(hint.textContent, '点击开始');
});

test('fallback browsers pause without seeking and failed play retries the same stage', async () => {
  const { intro, video, hint, frames } = fixture({ fallback: true });
  intro.reset(); video.prepared();
  video.nextPlay = Promise.reject(new Error('play failed'));
  intro.advance(); await Promise.resolve();
  assert.equal(frames.size, 0);
  assert.equal(hint.textContent, '播放未开始，点击重试');
  video.nextPlay = null; intro.advance(); video.frame(4.12);
  assert.equal(hint.textContent, '点击继续');
  assert.deepEqual(video.seeks, [1.2]);
});

test('video server supports exact byte ranges, suffix/open ranges, HEAD and invalid ranges', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'c0ns1d2-video-'));
  const path = join(directory, 'sample.mp4');
  writeFileSync(path, '0123456789');
  const server = createServer((req, res) => serveVideo(req, res, path));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const whole = await fetch(origin);
    assert.equal(whole.headers.get('accept-ranges'), 'bytes');
    assert.equal(whole.headers.get('content-length'), '10');
    assert.equal(await whole.text(), '0123456789');
    for (const [range, expected, contentRange] of [['bytes=2-4','234','bytes 2-4/10'],['bytes=7-','789','bytes 7-9/10'],['bytes=-3','789','bytes 7-9/10']]) {
      const response = await fetch(origin, { headers: { Range: range } });
      assert.equal(response.status, 206);
      assert.equal(response.headers.get('content-range'), contentRange);
      assert.equal(await response.text(), expected);
    }
    const head = await fetch(origin, { method: 'HEAD', headers: { Range: 'bytes=2-4' } });
    assert.equal(head.status, 206); assert.equal(await head.text(), '');
    for (const range of ['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=0-1,3-4', 'bytes=-']) {
      const response = await fetch(origin, { headers: { Range: range } });
      assert.equal(response.status, 416);
      assert.equal(response.headers.get('content-range'), 'bytes */10');
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
