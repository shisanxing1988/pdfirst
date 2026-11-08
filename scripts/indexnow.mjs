#!/usr/bin/env node
// 把站点 URL 提交给 Bing / Yandex / Naver 等搜索引擎（IndexNow 协议）。
// 无需登录、无需 OAuth：靠根目录的 <key>.txt 证明站点所有权。
//
// 用法：
//   node scripts/indexnow.mjs                 # 提交 sitemap 里的全部 URL
//   node scripts/indexnow.mjs --url /pdf-edit # 只提交一个路径（可重复多次）
//   node scripts/indexnow.mjs --dry-run       # 只打印不发送
//
// Google 不支持 IndexNow，仍需 Search Console；本脚本只解决 Bing 系。

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = process.env.SITE_ORIGIN ?? 'https://pdfirst.com';

// key 文件名就是 key 本身，内容也必须完全一致。
function findKey() {
  if (process.env.INDEXNOW_KEY) return process.env.INDEXNOW_KEY;
  const candidates = readdirSync(join(root, 'public'))
    .filter((name) => /^[0-9a-f]{32}\.txt$/i.test(name));
  if (!candidates.length) throw new Error('public/ 下没有 IndexNow key 文件，先运行一次生成脚本。');
  const file = candidates[0];
  const key = readFileSync(join(root, 'public', file), 'utf8').trim();
  return key;
}

function args() {
  const argv = process.argv.slice(2);
  const urls = [];
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--url') urls.push(argv[i + 1]);
    else if (argv[i] === '--dry-run') dryRun = true;
  }
  return { urls, dryRun };
}

async function sitemapUrls() {
  const response = await fetch(`${ORIGIN}/sitemap.xml`);
  if (!response.ok) throw new Error(`拉取 sitemap 失败：${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) => match[1]);
}

const key = findKey();
const { urls, dryRun } = args();
const targets = urls.length
  ? urls.map((url) => (url.startsWith('http') ? url : `${ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`))
  : await sitemapUrls();

if (!targets.length) throw new Error('没有可提交的 URL。');
console.log(`IndexNow key: ${key}`);
console.log(`待提交 ${targets.length} 个 URL：`);
for (const url of targets) console.log(`  ${url}`);

if (dryRun) {
  console.log('--dry-run：未发送。');
  process.exit(0);
}

const payload = {
  host: new URL(ORIGIN).host,
  key,
  keyLocation: `${ORIGIN}/${key}.txt`,
  urlList: targets,
};

// api.indexnow.org 会把提交分发给所有参与引擎（含 Bing）；bing.com 单独再发一次，
// 两个端点任意一个失败都不影响另一个。
const endpoints = ['https://api.indexnow.org/indexnow', 'https://www.bing.com/indexnow'];
let ok = 0;
for (const endpoint of endpoints) {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    });
    const body = (await response.text()).slice(0, 200);
    const success = response.status === 200 || response.status === 202;
    if (success) ok += 1;
    console.log(`${endpoint} -> ${response.status}${body ? ` ${body}` : ''}`);
  } catch (error) {
    console.log(`${endpoint} -> 失败：${error instanceof Error ? error.message : error}`);
  }
}

// 200/202 都表示已接收：202 是"已接受，待引擎处理"。
if (!ok) {
  console.error('所有端点都失败。确认 key 文件已随站点部署（' + `${ORIGIN}/${key}.txt` + '）。');
  process.exit(1);
}
console.log(`提交完成（${ok}/${endpoints.length} 个端点成功）。Bing 通常几分钟到几天内抓取。`);
