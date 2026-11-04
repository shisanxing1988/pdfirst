import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../app/toolbox.tsx', import.meta.url), 'utf8');
// Slice the self-contained helpers (crc32 -> createZip -> textPagesToDocx).
// Fail loudly if the boundaries move, instead of silently transpiling an empty string.
const start = source.indexOf('function crc32(');
const end = source.indexOf('async function pdfToWord(');
assert.ok(start > 0 && end > start, 'expected crc32 and pdfToWord markers in app/toolbox.tsx');
const helpers = source.slice(start, end);
assert.ok(helpers.includes('function createZip(') && helpers.includes('function textPagesToDocx('), 'helper slice must contain createZip and textPagesToDocx');
const { outputText } = ts.transpileModule(helpers, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
const convert = runInNewContext(`${outputText}\ntextPagesToDocx`, { Blob, Uint8Array, TextEncoder });

test('Word contains editable Chinese and English, escaped XML and page breaks, without page images', async () => {
  const bytes = new Uint8Array(await convert(['中文合同 A & B <test>\n第二行\u0001', 'Second page']).arrayBuffer());
  const view = new DataView(bytes.buffer);
  const entries = new Map();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    entries.set(name, new TextDecoder().decode(bytes.slice(start, start + size)));
    offset = start + size;
  }
  const xml = entries.get('word/document.xml');
  assert.ok(entries.has('[Content_Types].xml'));
  assert.ok(entries.has('_rels/.rels'));
  assert.match(xml, /<w:t xml:space="preserve">中文合同 A &amp; B &lt;test&gt;<\/w:t>/);
  assert.match(xml, /第二行<\/w:t>/);
  assert.match(xml, /<w:br w:type="page"\/>/);
  assert.match(xml, /Second page/);
  assert.doesNotMatch(xml, /w:drawing/);
  assert.ok(!xml.includes(String.fromCharCode(1)), 'control characters are stripped from XML');
  assert.ok([...entries.keys()].every(name => !name.includes('media/')));
});
