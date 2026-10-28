import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

// Exercise the real MP4, not the empty-media fixture used by the editor checks.
const origin = process.env.INTRO_ORIGIN || 'http://127.0.0.1:4323';
const profile = mkdtempSync(join(tmpdir(), 'c0ns1d2-intro-'));
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let chrome, socket;
async function until(check, label, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const result = await check();
    if (result) return result;
    await sleep(80);
  }
  throw new Error('Timeout: ' + label);
}

try {
  chrome = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--mute-audio',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  const port = await until(() => existsSync(join(profile, 'DevToolsActivePort')) && readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0], 'Chrome');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (!pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['https://*'] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.mediaTrace = [];
    const time = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {...time, set(value) {
      window.mediaTrace.push({kind:'seek',from:time.get.call(this),to:value});
      return time.set.call(this,value);
    }});
    for (const name of ['play','pause']) {
      const original = HTMLMediaElement.prototype[name];
      HTMLMediaElement.prototype[name] = function(...args) {
        window.mediaTrace.push({kind:name,time:this.currentTime,readyState:this.readyState});
        return original.apply(this,args);
      };
    }
  ` });
  await send('Page.navigate', { url: origin + '/' });
  await until(() => evaluate(`!!document.getElementById('introVideo') && document.readyState === 'complete'`), 'homepage');
  const state = () => evaluate(`(() => {const v=document.getElementById('introVideo');return {time:v.currentTime,duration:v.duration,readyState:v.readyState,error:v.error?.message,paused:v.paused,seeking:v.seeking,hint:document.getElementById('cHint').textContent,hidden:document.getElementById('cHint').classList.contains('hide'),gallery:document.getElementById('mainView').classList.contains('visible')};})()`);
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const waitHold = target => until(async () => {
    const s = await state();
    // Video-frame callbacks can run just before the frame's presentation time.
    return s.paused && !s.seeking && !s.hidden && s.time >= target - .05 && s.time < target + .18 && s;
  }, 'hold at ' + target).catch(async error => { console.log('Unexpected state:', await state(), await evaluate('window.mediaTrace')); throw error; });
  await waitHold(1.2);
  await evaluate('window.mediaTrace = []');
  await click('#cHint');
  console.log('First stop:', await waitHold(4.1));
  await click('#cHint');
  console.log('Second stop:', await waitHold(8.0));
  const trace = await evaluate('window.mediaTrace');
  console.log('Playback trace:', JSON.stringify(trace));
  assert.deepEqual(trace.filter(event => event.kind === 'seek'), [], 'Pausing at a stop must not seek backwards and decode a second frame');
  assert.equal(trace.filter(event => event.kind === 'play').length, 2, 'One play request per click');
  await click('#cHint');
  await until(() => evaluate(`document.getElementById('redFlash').style.opacity === '1'`), 'finale');
  await click('#introSkip');
  await click('#replayIntro');
  await waitHold(1.2);
  await sleep(1000);
  assert.equal((await state()).gallery, false, 'Previous finale timeout must not interrupt replay');
  await click('#introSkip');
  await click('#replayIntro');
  await waitHold(1.2);
  await click('#cHint');
  await until(async () => (await state()).time > 1.5, 'play before skip');
  await click('#introSkip');
  await click('#replayIntro');
  await waitHold(1.2);
  await click('#cHint');
  await waitHold(4.1);
  await click('#cHint');
  await waitHold(8.0);
  await click('#cHint');
  await until(async () => (await state()).gallery, 'natural transition to memory cards');
  assert.equal(await evaluate(`document.getElementById('mainView').inert`), false);
  assert.equal(await evaluate(`localStorage.getItem('introPlayed')`), '1');
  assert.deepEqual(errors, [], 'Browser runtime errors');
  console.log('Intro verified: actual MP4; no stop-point seeks or repeated play; replay after finale/skip; natural transition to memory cards.');
} finally {
  socket?.close();
  chrome?.kill();
  await sleep(1000);
  assert.ok(basename(profile).startsWith('c0ns1d2-intro-'));
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
