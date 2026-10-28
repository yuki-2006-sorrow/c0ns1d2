import { createReadStream, statSync } from 'node:fs';

// Video seeking needs byte ranges; returning the entire file for a Range
// request can make the browser abandon the seek and redraw the first frame.
export function serveVideo(req, res, path) {
  const size = statSync(path).size;
  const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' };
  let start = 0, end = size - 1, status = 200;
  if (req.headers.range) {
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range && (range[1] || range[2])) {
      start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    } else start = -1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': '0' });
      return res.end();
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = String(Math.max(0, end - start + 1));
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || !size) return res.end();
  const stream = createReadStream(path, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}
