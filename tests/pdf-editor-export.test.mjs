import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {createCanvas} from '@napi-rs/canvas';
import {removeTextObjects} from '../app/pdf-redaction.ts';
import {writeEditablePdf} from '../app/pdf-edit-export.ts';
const wasm=readFileSync('public/pdfium-2.15.1.wasm');
const loadFont=async()=>new Uint8Array(readFileSync('public/fonts/NotoSansSC-8105-v1.ttf'));
const buffer=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
const open=async data=>{const task=pdfjs.getDocument({data:new Uint8Array(data),standardFontDataUrl:process.cwd()+'/node_modules/pdfjs-dist/standard_fonts/'});return {task,pdf:await task.promise};};

test('delete and replace nested text, preserve name, backgrounds and Unicode across two save/reopen cycles',async()=>{
 const template=await PDFDocument.create();const nested=template.addPage([400,300]);
 nested.drawRectangle({x:20,y:170,width:330,height:70,color:rgb(0.9,0.95,0.8)});
 nested.drawText('KEEP NAME',{x:40,y:250,size:12});
 nested.drawText('DELETE OLD ADDRESS',{x:40,y:200,size:12});
 nested.drawText('REPLACE THIS',{x:40,y:180,size:12});
 const original=await PDFDocument.create();const embedded=await original.embedPage(nested);
 original.addPage([400,300]).drawPage(embedded);
 original.addPage([400,300]).drawText('UNTOUCHED PAGE',{x:40,y:200,size:12});
 const bytes=await original.save();
 const clean=await removeTextObjects(buffer(bytes),[{pageNumber:1,xRatio:.1,yRatio:88/300,widthRatio:.5,heightRatio:12/300},{pageNumber:1,xRatio:.1,yRatio:108/300,widthRatio:.5,heightRatio:12/300}],buffer(wasm));
 const output=await writeEditablePdf(clean,[{pageNumber:1,text:'新地址 TEST 2026',xRatio:.1,yRatio:108/300,widthRatio:.8,fontSize:12}],[],loadFont);
 const {task,pdf}=await open(await output.arrayBuffer());
 const page=await pdf.getPage(1);const strings=(await page.getTextContent()).items.map(i=>i.str).join('');
 assert.ok(strings.includes('KEEP NAME'));assert.ok(strings.includes('新地址 TEST 2026'));assert.ok(!strings.includes('DELETE'));assert.ok(!strings.includes('REPLACE'));
 assert.ok((await (await pdf.getPage(2)).getTextContent()).items.some(i=>i.str==='UNTOUCHED PAGE'));
 const view=page.getViewport({scale:1}),canvas=createCanvas(view.width,view.height);
 await page.render({canvas,canvasContext:canvas.getContext('2d'),viewport:view}).promise;
 const pixel=[...canvas.getContext('2d').getImageData(25,65,1,1).data];assert.ok(pixel[0]>200&&pixel[2]<230,'background rectangle survives');
 await task.destroy();
 const reopened=await removeTextObjects(await output.arrayBuffer(),[{pageNumber:1,xRatio:.1,yRatio:108/300,widthRatio:.8,heightRatio:12/300}],buffer(wasm));
 const second=await writeEditablePdf(reopened,[{pageNumber:1,text:'第二次修改 OK',xRatio:.1,yRatio:108/300,widthRatio:.8,fontSize:12}],[],loadFont);
 const secondDoc=await open(await second.arrayBuffer());
 const text=(await (await secondDoc.pdf.getPage(1)).getTextContent()).items.map(i=>i.str).join('');
 assert.ok(text.includes('KEEP NAME'));assert.ok(text.includes('第二次修改 OK'));assert.ok(!text.includes('新地址'));await secondDoc.task.destroy();
});

test('edits retain dimensions and rotation and are real text rather than image overlays',async()=>{
 const original=await PDFDocument.create();
 for (const rotation of [0,90,180,270]) {const page=original.addPage([400,300]);page.setRotation(degrees(rotation));page.drawText('ORIGINAL',{x:40,y:220,size:14});}
 const input=await original.save();const initial=await open(buffer(input));const regions=[];
 for(let i=1;i<=4;i++){const page=await initial.pdf.getPage(i);const viewport=page.getViewport({scale:1});const item=(await page.getTextContent()).items.find(t=>t.str==='ORIGINAL');
 const [a,b,c,d,e,f]=pdfjs.Util.transform(viewport.transform,item.transform);
 // Use four corners for a rotated glyph run, in displayed page coordinates.
 const length=item.width/Math.hypot(a,b);const corners=[[e,f],[e+a*length,f+b*length],[e-c,f-d],[e+a*length-c,f+b*length-d]];
 const xs=corners.map(v=>v[0]),ys=corners.map(v=>v[1]);
 regions.push({pageNumber:i,xRatio:Math.min(...xs)/viewport.width,yRatio:Math.min(...ys)/viewport.height,widthRatio:(Math.max(...xs)-Math.min(...xs))/viewport.width,heightRatio:(Math.max(...ys)-Math.min(...ys))/viewport.height});}
 await initial.task.destroy();
 const clean=await removeTextObjects(buffer(input),regions,buffer(wasm));
 const result=await writeEditablePdf(clean,[1,2,3,4].map(pageNumber=>({pageNumber,text:'EDITABLE NEW',xRatio:.2,yRatio:.4,widthRatio:.7,fontSize:14,color:'#ff0000'})),[]);
 const out=await PDFDocument.load(await result.arrayBuffer());
 const rendered=await open(await result.arrayBuffer());
 for(let i=0;i<4;i++){
 assert.deepEqual(out.getPage(i).getSize(),{width:400,height:300});assert.equal(out.getPage(i).getRotation().angle,i*90);
 const page=await rendered.pdf.getPage(i+1);const text=(await page.getTextContent()).items.map(i=>i.str).join('');assert.ok(text.includes('EDITABLE NEW'));assert.ok(!text.includes('ORIGINAL'));
 const viewport=page.getViewport({scale:1}),canvas=createCanvas(viewport.width,viewport.height);await page.render({canvas,canvasContext:canvas.getContext('2d'),viewport}).promise;
 const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let red=0;for(let j=0;j<pixels.length;j+=4)if(pixels[j]>150&&pixels[j+1]<100&&pixels[j+2]<100)red++;assert.ok(red>20);
 }
 await rendered.task.destroy();
});
