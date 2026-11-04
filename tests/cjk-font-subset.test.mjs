import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import { CJK_FULL_FONT, CJK_SUBSET_FONT, writeEditablePdf } from '../app/pdf-edit-export.ts';

const subsetPath = 'public/fonts/NotoSansSC-8105-v1.ttf';
const subsetWoff2Path = 'public/fonts/NotoSansSC-8105-v1.woff2';
const fullPath = 'public/fonts/NotoSansSC-Regular-full.ttf';
const charset = path => new Set(fontkit.create(readFileSync(path)).characterSet);
const MB = 1048576;

// The editor downloads these on every first use of a CJK text box, so a silent
// regression back to the 10 MB full font is a real user-facing cost.
test('CJK subset stays small and still covers the standard character table', () => {
  const subset = charset(subsetPath);
  const ttfSize = statSync(subsetPath).size;
  const woff2Size = statSync(subsetWoff2Path).size;
  assert.ok(ttfSize < 3 * MB, `subset ttf is ${(ttfSize / MB).toFixed(2)} MB, expected < 3 MB`);
  assert.ok(woff2Size < ttfSize, 'woff2 must be smaller than the ttf it was built from');

  // Every character of 通用规范汉字表 (3500 + 3000 + 1605) must be present.
  for (const level of [1, 2, 3]) {
    const text = readFileSync(`scripts/font-charset/level-${level}.txt`, 'utf8');
    const missing = [...text].filter(char => !/\s/.test(char)).filter(char => !subset.has(char.codePointAt(0)));
    assert.deepEqual(missing, [], `level ${level} characters missing from the subset`);
  }
  // ASCII, CJK punctuation and fullwidth forms carry most edited text.
  for (const char of 'AZaz09 .,:;!?%()[]-+/\\"\'' + '，。、；：？！“”‘’（）《》【】…—·　０Ａａ') {
    assert.ok(subset.has(char.codePointAt(0)), `subset lacks ${JSON.stringify(char)}`);
  }
});

test('the full font stays a superset, so rare characters remain shippable', () => {
  const subset = charset(subsetPath);
  const full = charset(fullPath);
  const missing = [...subset].filter(codepoint => !full.has(codepoint));
  assert.deepEqual(missing, [], 'every subset character must exist in the full font');
  assert.ok(full.size - subset.size > 10000, 'the full font is expected to add a lot of headroom');
});

test('text outside the subset falls back to the full font instead of failing', async () => {
  const subset = charset(subsetPath);
  const full = charset(fullPath);
  // Latin Extended-A (Ā) is in the full font but was deliberately left out of
  // the subset; it stands in for any character a document might still need.
  const rare = [...full].find(codepoint => !subset.has(codepoint) && codepoint < 0x10000);
  assert.ok(rare, 'no character outside the subset to test with');

  const loads = [];
  const template = await PDFDocument.create();
  template.addPage([400, 300]).drawText('ORIGINAL', { x: 40, y: 220, size: 12 });
  const result = await writeEditablePdf(
    (await template.save()).buffer,
    [{ pageNumber: 1, text: `编辑${String.fromCodePoint(rare)}测试`, xRatio: 0.1, yRatio: 0.3, widthRatio: 0.8, fontSize: 12 }],
    [],
    async () => { loads.push('subset'); return new Uint8Array(readFileSync(subsetPath)); },
    async () => { loads.push('full'); return new Uint8Array(readFileSync(fullPath)); },
  );
  assert.deepEqual(loads, ['subset', 'full'], 'expected the subset to be tried first, then the full font');

  const output = await PDFDocument.load(await result.arrayBuffer());
  assert.equal(output.getPageCount(), 1);
});

test('text inside the subset never downloads the full font', async () => {
  const loads = [];
  const template = await PDFDocument.create();
  template.addPage([400, 300]).drawText('ORIGINAL', { x: 40, y: 220, size: 12 });
  await writeEditablePdf(
    (await template.save()).buffer,
    [{ pageNumber: 1, text: '普通中文标题 2026', xRatio: 0.1, yRatio: 0.3, widthRatio: 0.8, fontSize: 12 }],
    [],
    async () => { loads.push('subset'); return new Uint8Array(readFileSync(subsetPath)); },
    async () => { loads.push('full'); return new Uint8Array(readFileSync(fullPath)); },
  );
  assert.deepEqual(loads, ['subset'], 'common Chinese text must not trigger the 10 MB fallback');
});

test('font URLs stay in sync with the files on disk and the stylesheet', () => {
  for (const url of [CJK_SUBSET_FONT, CJK_FULL_FONT]) {
    assert.ok(statSync(`public${url}`).isFile(), `${url} does not exist in public/`);
  }
  const css = readFileSync('app/globals.css', 'utf8');
  const woff2 = subsetWoff2Path.replace('public', '');
  assert.ok(css.includes(woff2), `app/globals.css does not reference ${woff2}`);
  assert.ok(css.includes(CJK_SUBSET_FONT), 'the editor preview must use the same font file as the export');

  const headers = readFileSync('public/_headers', 'utf8');
  for (const url of [CJK_SUBSET_FONT, CJK_FULL_FONT, woff2]) {
    assert.ok(headers.includes(url), `public/_headers has no cache rule for ${url}`);
  }
  assert.ok(headers.includes('/_next/static/*'), 'public/_headers must keep the vinext immutable rule');
});
