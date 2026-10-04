import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { test } from 'node:test';
import { sendJson } from './json.ts';

// Sends a body as the server would, a second apart each time, and returns the status and headers.
function send(body: object, headers: Record<string, string> = {}) {
  const sent: { status?: number; headers: Record<string, string> } = { headers: {} };
  const response = {
    setHeader: (name: string, value: string) => void (sent.headers[name.toLowerCase()] = value),
    writeHead(status: number) {
      sent.status = status;
      return { end: () => {} };
    },
  } as unknown as ServerResponse;
  sendJson({ method: 'GET', headers } as IncomingMessage, response, body);
  return sent;
}

const READS = { 'x-reads-generated-at': '1' };

test('a page that reads the time from its header gets a 304 for the same data sent a second later', () => {
  const first = send({ generatedAt: 100, groups: [1] }, READS);
  const tag = first.headers.etag!;
  deepStrictEqual([first.status, first.headers['x-generated-at']], [200, '100']);
  const later = send({ generatedAt: 101, groups: [1] }, { ...READS, 'if-none-match': tag });
  deepStrictEqual([later.status, later.headers['x-generated-at']], [304, '101']);
  // As Caddy and Cloudflare send the tag back after compressing.
  strictEqual(send({ generatedAt: 102, groups: [1] }, { ...READS, 'if-none-match': `W/${tag.replace(/"$/, '-gzip"')}` }).status, 304);
  strictEqual(send({ generatedAt: 103, groups: [2] }, { ...READS, 'if-none-match': tag }).status, 200);
});

test('a page from before the header keeps tags that change with the time, so it never gets an old one back', () => {
  const tag = send({ generatedAt: 100, groups: [1] }).headers.etag!;
  strictEqual(send({ generatedAt: 100, groups: [1] }, { 'if-none-match': tag }).status, 304);
  strictEqual(send({ generatedAt: 101, groups: [1] }, { 'if-none-match': tag }).status, 200);
});
