import assert from 'node:assert/strict';
const origin = 'https://pdfirst.com';
const response = await fetch(`${origin}/api/usage`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ event: 'page_view', tool: 'pdf-seal', channel: 'test', demo: true }), signal: AbortSignal.timeout(20000) });
assert.equal(response.status, 204);
console.log('Test-channel usage event accepted (204). Verify daily_usage in D1; excludes real traffic.');
