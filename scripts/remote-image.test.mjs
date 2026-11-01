import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { remoteImage } from '../admin/remote-image.mjs';

test('external photos are cached locally and arbitrary hosts are never fetched', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'c0ns1d2-photo-'));
  let calls = 0;
  const download = async (url, options) => {
    calls++;
    assert.equal(options.redirect, 'error');
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
  };
  try {
    const url = 'https://aka.doubaocdn.com/test';
    const [first, second] = await Promise.all([remoteImage(directory, url, download), remoteImage(directory, url, download)]);
    assert.deepEqual(first.bytes, second.bytes);
    await remoteImage(directory, url, () => { throw new Error('offline'); });
    assert.equal(calls, 1);
    await assert.rejects(remoteImage(directory, 'https://127.0.0.1/private', download));
    assert.equal(calls, 1);
    await assert.rejects(remoteImage(directory, url + 'invalid', async () => new Response('<html>', {headers:{'content-type':'text/html'}})));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
