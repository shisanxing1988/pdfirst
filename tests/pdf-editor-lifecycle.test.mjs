import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../app/toolbox.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  useEffect(() => {\n    let cancelled = false;\n    let documentTask:');
const end = source.indexOf('\n  function clearOutputs()', start);
const typedEffects = source.slice(start, end);
const compiled = ts.transpileModule(typedEffects, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  .replaceAll('import("pdfjs-dist/legacy/build/pdf.mjs")', 'Promise.resolve(pdfjsLibMock)');
assert.ok(start >= 0 && end > start);

async function runEditor(textItems) {
  let boxes = [];
  let loads = 0;
  let destroys = 0;
  let renders = 0;
  let dirty = true;
  let slots = [];
  let slot = 0;
  const page = {
    commonObjs: { has: () => false },
    getViewport: () => ({width: 100, height: 100}),
    render: () => { renders++; return { promise: Promise.resolve(), cancel() {} }; },
    getTextContent: async () => ({items: textItems, styles: {}}),
    cleanup() {},
  };
  const pdfjsLibMock = {
    GlobalWorkerOptions: {},
    getDocument: () => {
      loads++;
      return {promise: Promise.resolve({numPages: 1, getPage: async () => page}), destroy: async () => { destroys++; }};
    },
  };
  const names = ['useEffect','pdfjsLibMock','previewUrl','activeTool','editMode','canvasRef','fetch','currentPage','zoom','setCanvasSize','setPdfPageCount','previewingOutput','buildTextBoxes','setPdfTextBoxes','setMessage','setThumbnailUrls','document','blobFromCanvas','pdfTextBackground','pdfTextMaskRect'];
  const invoke = new Function(...names, compiled);
  function render() {
    slot = 0;
    invoke((callback, deps) => {
      const index = slot++;
      const old = slots[index];
      if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) {
        old?.cleanup?.();
        slots[index] = {deps, cleanup: callback()};
      }
    }, pdfjsLibMock, 'blob:test', 'pdf-edit', 'visual', {current: {getContext: () => ({})}},
    async () => ({arrayBuffer: async () => new ArrayBuffer(8)}), 1, 1.35, () => {}, () => {}, false,
    (_lib, content, _viewport, _page, current) => content.items.map(item => ({...item, text: current.find(box => box.id === item.id)?.text ?? item.text})),
    updater => { boxes = updater(boxes); dirty = true; }, () => {}, () => {},
    {createElement: () => ({getContext: () => ({})})}, async () => new Blob(['thumbnail']), () => '#ffffff', () => ({}));
  }
  for (let i = 0; i < 10; i++) {
    if (dirty) { dirty = false; render(); }
    await new Promise(resolve => setImmediate(resolve));
  }
  boxes = boxes.map(box => ({...box, text: 'edited'}));
  render();
  await new Promise(resolve => setImmediate(resolve));
  slots.forEach(effect => effect.cleanup?.());
  return {loads, destroys, renders, boxes};
}

test('PDF text detection settles without reloading the PDF, and typing preserves edits', async () => {
  const result = await runEditor([{id:'1-line-0', text:'original'}]);
  assert.equal(result.loads, 2, 'one page document and one thumbnail document');
  assert.equal(result.renders, 2);
  assert.equal(result.destroys, 2, 'both PDF workers are released');
  assert.equal(result.boxes[0].text, 'edited');
});

test('scanned pages without text also settle and release both PDF documents', async () => {
  const result = await runEditor([]);
  assert.equal(result.loads, 2);
  assert.equal(result.destroys, 2);
  assert.deepEqual(result.boxes, []);
});
