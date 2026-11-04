import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../app/toolbox.tsx',import.meta.url),'utf8');
const code=ts.transpileModule(source.slice(source.indexOf('function pdfTextBackground('),source.indexOf('\nfunction prettySize')),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const background=new Function(code+';return pdfTextBackground;')();
const mask={x:20,y:20,width:100,height:15};
function canvas(color){return {width:300,height:300,getContext:()=>({getImageData:()=>({data:color})})};}
test('black title bar erasure keeps the dark background',()=>{assert.equal(background(canvas([15,18,17,255]),mask),'rgb(15, 18, 17)');});
test('white and colored fields keep their surrounding colors',()=>{
  assert.equal(background(canvas([255,255,255,255]),mask),'rgb(255, 255, 255)');
  assert.equal(background(canvas([240,230,210,255]),mask),'rgb(240, 230, 210)');
});
test('isolated edge pixels do not replace the dominant background',()=>{
  let calls=0;
  const target={width:300,height:300,getContext:()=>({getImageData:()=>({data:++calls<4?[255,255,255,255]:[15,18,17,255]})})};
  assert.equal(background(target,mask),'rgb(15, 18, 17)');
});
const colorCode=ts.transpileModule(source.slice(source.indexOf('function contrastTextColor('),source.indexOf('\nfunction prettySize')),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const contrast=new Function(colorCode+';return contrastTextColor;')();
test('unedited color stays legible on dark and light backgrounds',()=>{
  assert.equal(contrast('rgb(15, 18, 17)'),'#ffffff');
  assert.equal(contrast('rgb(255, 255, 255)'),'#111827');
  assert.equal(contrast(undefined),'#111827');
});
