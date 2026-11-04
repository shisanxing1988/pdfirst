import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../app/toolbox.tsx',import.meta.url),'utf8');
const section=source.slice(source.indexOf('function wrapEditorText('),source.indexOf('function pdfTextMaskRect('));
const code=ts.transpileModule(section,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const {wrapEditorText,pdfEditorLayout}=new Function('effectivePdfFontSize','fontStack',code+';return {wrapEditorText,pdfEditorLayout};')(box=>box.editedFontSize??box.fontSize,()=> 'Arial');
const measure=s=>Array.from(s).length*10;
test('spaces, consecutive spaces, blank lines and explicit newlines are retained',()=>{
  const text='A  B\n\n中文 C ';
  assert.deepEqual(wrapEditorText(text,1000,measure),['A  B','','中文 C ']);
});
test('narrow boxes wrap Chinese and long words without dropping characters',()=>{
  assert.deepEqual(wrapEditorText('中文测试ABCD',30,measure),['中文测','试AB','CD']);
  assert.equal(wrapEditorText('A  B C',20,measure).join(''),'A  B C');
  assert.deepEqual(wrapEditorText('😀😀',10,measure),['😀','😀']);
});
test('resizing changes line breaks and increasing width restores a single line',()=>{
  const context={measureText:s=>({width:measure(s)})};
  const box={text:'abcdefgh',widthRatio:0.8,xRatio:0.1,fontSize:10};
  assert.deepEqual(pdfEditorLayout(box,100,1,context).lines,['abcdefgh']);
  assert.deepEqual(pdfEditorLayout({...box,editWidthRatio:0.3},100,1,context).lines,['abc','def','gh']);
});
test('export and preview share scaled line spacing and wrapping',()=>{
  const box={text:'abcdefgh',widthRatio:0.3,xRatio:0.1,fontSize:10};
  const small=pdfEditorLayout(box,100,1,{measureText:s=>({width:measure(s)})});
  const large=pdfEditorLayout(box,200,2,{measureText:s=>({width:measure(s)*2})});
  assert.deepEqual(small.lines,large.lines);
  assert.equal(large.lineHeight,small.lineHeight*2);
});
test('text input space and Enter events are not intercepted by the box keyboard handler',()=>{
  const start=source.indexOf('if (event.target !== event.currentTarget) return;');
  assert.ok(start>=0);
  const end=source.indexOf('\n                                    }}',start);
  const handler=new Function('event','setSelectedPdfTextId','setSelectedTextId','editorTool','box',source.slice(start,end));
  for(const key of [' ','Enter']) {
    let prevented=false;
    handler({key,target:{},currentTarget:{},preventDefault:()=>{prevented=true;}},()=>{},()=>{},'edit-text',{id:'test'});
    assert.equal(prevented,false);
  }
});
