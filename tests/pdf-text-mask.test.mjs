import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../app/toolbox.tsx',import.meta.url),'utf8');
const start=source.indexOf('function pdfTextMaskRect(');
const end=source.indexOf('\nfunction prettySize',start);
const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const rect=new Function(code+'\nreturn pdfTextMaskRect;')();
const box={xRatio:0.05,yRatio:0.2,widthRatio:0.16,heightRatio:0.02};
test('editing the first table field does not erase the next column',()=>{
  const mask=rect(box,1000,1400);
  assert.ok(mask.x < 50 && mask.y < 280);
  assert.ok(mask.x + mask.width > 210);
  assert.ok(mask.y + mask.height >= 315, "include descenders below the baseline");
  assert.ok(mask.x+mask.width<350,'adjacent field begins at x=350');
});
test('moving or extending edited text does not enlarge the original erasure area',()=>{
  assert.deepEqual(rect({...box,editXRatio:0.5,text:'a very long replacement'},1000,1400),rect(box,1000,1400));
});
test('preview and export scale the same original text rectangle',()=>{
  const preview=rect(box,1000,1400);
  const exported=rect(box,2000,2800);
  for(const key of ['x','y','width','height']) assert.equal(exported[key],preview[key]*2);
});
test('masks are clipped at the page edge',()=>{
  const mask=rect({...box,xRatio:0.95,yRatio:0.99},1000,1000);
  assert.equal(mask.x+mask.width,1000);
  assert.equal(mask.y+mask.height,1000);
});
