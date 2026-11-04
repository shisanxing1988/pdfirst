import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../app/toolbox.tsx',import.meta.url),'utf8');
const start=source.indexOf('function buildTextBoxes(');
const end=source.indexOf('\nfunction escapeRegExp',start);
const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const build=new Function(code+'\nreturn buildTextBoxes;')();
const lib={Util:{transform:(_viewport, transform)=>transform}};
const viewport={width:1000,height:1000,transform:[1,0,0,1,0,0]};
const run=(str,x=100,y=100)=>({str,transform:[12,0,0,12,x,y],width:str.length*9,height:12});
const boxes=(items,existing=[])=>build(lib,{items},viewport,1,existing);

test('duplicate overprinted text is not concatenated into the editable value',()=>{
  const result=boxes([run('示例姓名'),run('示例姓名',100.2),run('孖展',400),run('孖展',400.2)]);
  assert.deepEqual(result.map(b=>b.text),['示例姓名','孖展']);
});
test('duplicate individual glyphs are removed before joining the line',()=>{
  assert.equal(boxes([run('号'),run('号'),run('码',114),run('码',114)])[0].text,'号码');
});
test('intentional repetitions at distinct positions and rows are retained',()=>{
  const result=boxes([run('哈'),run('哈',114),run('哈',100,150)]);
  assert.deepEqual(result.map(b=>b.text),['哈哈','哈']);
});
test('existing user edits survive text detection',()=>{
  const original=boxes([run('示例'),run('示例')]);
  const result=boxes([run('示例'),run('示例')],[{...original[0],text:'已修改'}]);
  assert.equal(result[0].text,'已修改');
  assert.equal(result[0].originalText,'示例');
});

test('text bounds follow the actual zoom rather than a fixed 1.35 scale',()=>{
  const scaledLib={Util:{transform:(view,item)=>item.map(value=>value*view[0])}};
  const items=[run('sample')];
  const normal=build(scaledLib,{items},{width:1000,height:1000,transform:[1,0,0,1,0,0]},1,[])[0];
  const zoomed=build(scaledLib,{items},{width:2000,height:2000,transform:[2,0,0,2,0,0]},1,[])[0];
  for(const key of ['xRatio','yRatio','widthRatio','heightRatio','fontSize']) assert.equal(zoomed[key],normal[key]);
});
test('manual color survives page re-detection',()=>{
  const original=boxes([run('示例')]);
  const result=boxes([run('示例')],[{...original[0],color:'#ff0000',autoColor:'#ffffff'}]);
  assert.equal(result[0].color,'#ff0000');
  assert.equal(result[0].autoColor,'#ffffff');
});

test('deleted blocks remain deleted after page detection and retain text for restoration',()=>{
  const original=boxes([run('Sample')]);
  const result=boxes([run('Sample')],[{...original[0],deleted:true}]);
  assert.equal(result[0].deleted,true);
  assert.equal(result[0].text,'Sample');
});

test('name to the left of a slightly higher date remains a separately clickable box',()=>{
 const result=boxes([run('Statement Date 2026',650,100),run('XIAO YONGJIAN',40,102)]);
 assert.equal(result.length,2);
 const name=result.find(b=>b.text==='XIAO YONGJIAN');assert.ok(name);assert.equal(name.xRatio,.04);
 assert.ok(name.widthRatio<.3,'the hit target covers the name, not the right-hand date');
});
