import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Results change only when a feed refreshes or a vehicle leaves, so most refreshes match the
// last one and get an empty 304. A response's time changes every second, so for a page that
// reads it from the X-Generated-At header, which it says with a header of its own, the tag leaves
// the time out. Pages from before that header read the time from the body, and a 304 would leave
// them an old one, so their tags keep it.
export function sendJson(request: IncomingMessage, response: ServerResponse, body: unknown, status = 200) {
  const text = JSON.stringify(body);
  const { generatedAt, ...rest } = body as { generatedAt?: number };
  const timeless = generatedAt !== undefined && request.headers['x-reads-generated-at'] === '1';
  const etag = `"${createHash('sha1')
    .update(timeless ? JSON.stringify(rest) : text)
    .digest('base64url')
    .slice(0, 16)}"`;
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('ETag', etag);
  if (generatedAt !== undefined) response.setHeader('X-Generated-At', String(generatedAt));
  if (status === 200 && sentTags(request.headers['if-none-match']).includes(etag)) {
    response.writeHead(304).end();
    return;
  }
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(request.method === 'HEAD' ? undefined : text);
}

// The tags in If-None-Match as this server made them. Caddy adds its encoding to a tag it
// compresses ("-gzip") and Cloudflare may mark one weak ("W/"), and the browser sends it back that
// way.
const sentTags = (header: string | undefined) =>
  (header ?? '')
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, '').replace(/-(?:gzip|zstd|br)"$/, '"'));
