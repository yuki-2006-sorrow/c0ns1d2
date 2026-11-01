import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const pending = new Map();
export async function remoteImage(directory, reference, download = fetch) {
  const url = new URL(reference);
  // Only the existing archive CDN is fetched by the server. Never follow redirects.
  if (url.protocol !== 'https:' || url.hostname !== 'aka.doubaocdn.com' || url.port || url.username || url.password)
    throw new Error('外部照片来源尚不支持本地保存，请重新上传原图');
  const cache = join(directory, 'image-cache');
  const target = join(cache, createHash('sha256').update(reference).digest('hex') + '.json');
  if (existsSync(target)) {
    const saved = JSON.parse(readFileSync(target, 'utf8'));
    return { type: saved.type, bytes: Buffer.from(saved.data, 'base64') };
  }
  if (pending.has(target)) return pending.get(target);
  const task = (async () => {
    const response = await download(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
    const type = response.headers.get('content-type')?.split(';')[0];
    if (!response.ok || !['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(type)) {
      await response.body?.cancel();
      throw new Error('外部照片无法读取，请重新上传原图');
    }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 20 * 1024 * 1024) throw new Error('外部照片超过20MB，请重新上传原图');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    mkdirSync(cache, { recursive: true });
    writeFileSync(target + '.tmp', JSON.stringify({ type, data: bytes.toString('base64') }), { mode: 0o600 });
    renameSync(target + '.tmp', target);
    return { type, bytes };
  })();
  pending.set(target, task);
  try { return await task; } finally { pending.delete(target); }
}
