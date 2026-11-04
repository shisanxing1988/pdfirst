import test from 'node:test';
import assert from 'node:assert/strict';
import { usage } from '../worker/usage.mjs';
const event = { event: 'process_complete', tool: 'pdf-seal', channel: 'xiaohongshu', demo: false };
function request(data, origin = 'https://pdfirst.com') {
  return new Request('https://pdfirst.com/api/usage', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(data) });
}
test('records fixed dimensions only, ignoring document details', async () => {
  let point;
  const response = await usage(request({ ...event, filename: 'private.pdf', content: 'private content' }), { prepare() { return { bind(...values) { point = values; return { async run() {} }; } }; } });
  assert.equal(response.status, 204);
  assert.deepEqual(point.slice(1), ['process_complete', 'pdf-seal', 'xiaohongshu', 'real']);
  assert.ok(!JSON.stringify(point).includes('private'));
});
test('rejects foreign origins, unknown labels, oversized bodies and unavailable storage', async () => {
  const dataset = { prepare() { throw new Error('must not write'); } };
  assert.equal((await usage(request(event, 'https://elsewhere.test'), dataset)).status, 403);
  assert.equal((await usage(request({ ...event, channel: 'private-name' }), dataset)).status, 400);
  assert.equal((await usage(request({ ...event, extra: 'x'.repeat(600) }), dataset)).status, 413);
  assert.equal((await usage(request(event), undefined)).status, 503);
});
