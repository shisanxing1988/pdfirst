import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const origin = new URL(process.argv[2] ?? 'https://pdfirst.com');
assert.equal(origin.protocol, 'https:');
const results = [];
async function request(route) {
  const response = await fetch(new URL(route, origin), { redirect: 'manual', signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, `${route}: HTTP ${response.status}`);
  return response;
}
const pages = [
  ['/', '合并 PDF'], ['/?tool=pdf-edit', '合并 PDF'], ['/?tool=pdf-seal', '合并 PDF'],
  ['/pdf-merge', '使用步骤'], ['/image-compress', '清晰度'], ['/pdf-seal', '上传合同章图片'],
  ['/guides', '实用教程'], ['/guides/pdf-merge', '9 页 PDF'],
  ['/guides/image-compress', '4000'], ['/guides/pdf-seal', '5 页 PDF'],
  ['/about', '明确功能边界'], ['/privacy', 'Google 广告与 Cookie'],
  ['/contact', 'mailto:pgq1988@126.com'],
];
for (const [route, expected] of pages) {
  const response = await request(route);
  const html = await response.text();
  assert.match(html, /<title>[^<]*轻文档工具箱<\/title>/);
  assert.ok(html.includes(expected), `${route}: missing page content`);
  assert.doesNotMatch(html, /\/Users\/|\/signin-with-chatgpt/);
  results.push({ route, status: 200, bytes: Buffer.byteLength(html) });
}
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? files(path.join(directory, e.name)) : [path.join(directory, e.name)]))).flat();
}
const hash = data => createHash('sha256').update(data).digest('hex');
const assets = (await files('dist/client')).filter(f => /\.(?:js|mjs|css|woff2|svg|png|ico|txt)$/.test(f));
assert.ok(assets.includes('dist/client/pdf.worker.mjs'), 'PDF renderer missing from build');
for (let index = 0; index < assets.length; index += 4) {
  await Promise.all(assets.slice(index, index + 4).map(async file => {
    const route = '/' + path.relative('dist/client', file);
    const response = await request(route);
    const remote = Buffer.from(await response.arrayBuffer());
    assert.equal(hash(remote), hash(await readFile(file)), `Asset mismatch: ${route}`);
    results.push({ route, status: 200, bytes: remote.length });
  }));
}
await mkdir('work/deployment-checks', { recursive: true });
for (const [route, expected] of [['/robots.txt', 'sitemap.xml'], ['/sitemap.xml', 'https://pdfirst.com/pdf-merge']]) {
  const response = await request(route);
  assert.ok((await response.text()).includes(expected), route);
  results.push({ route, status: 200 });
}
await writeFile(`work/deployment-checks/verified-${origin.hostname}.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ origin: origin.origin, pages: pages.length, assets: assets.length, allPassed: true }, null, 2));
