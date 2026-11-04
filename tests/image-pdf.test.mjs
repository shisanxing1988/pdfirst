import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as pdfLib from 'pdf-lib';
import { buildImagePdf, defaultImagePdfLayout, imagePlacement, pageGeometry } from '../app/image-pdf-layout.ts';

const jpeg = new Uint8Array(readFileSync(new URL('./fixtures/layout-test.jpg', import.meta.url)));

test('five photos make two A4 pages with a four-photo layout', async () => {
  const images = Array.from({length:5}, () => ({ bytes: jpeg, width:40, height:20, scale:100 }));
  const blob = await buildImagePdf(images, defaultImagePdfLayout);
  const pdf = await pdfLib.PDFDocument.load(await blob.arrayBuffer());
  assert.equal(blob.type, 'application/pdf');
  assert.equal(pdf.getPageCount(),2);
  assert.ok(Math.abs(pdf.getPage(0).getWidth() - 210 * 72 / 25.4) < 0.01);
  assert.ok(Math.abs(pdf.getPage(0).getHeight() - 297 * 72 / 25.4) < 0.01);
  assert.equal(pdf.getPage(0).node.Resources().lookup(pdfLib.PDFName.of('XObject')).keys().length,4);
  assert.equal(pdf.getPage(1).node.Resources().lookup(pdfLib.PDFName.of('XObject')).keys().length,1);
});

test('image positions follow rows and input order, and resizing keeps the image centered without cropping', () => {
  const layout = { ...defaultImagePdfLayout, landscape:true, margin:15, gap:8 };
  const first = imagePlacement(layout,0,400,200,100);
  const second = imagePlacement(layout,1,400,200,100);
  const third = imagePlacement(layout,2,400,200,100);
  const smaller = imagePlacement(layout,0,400,200,50);
  assert.ok(second.x > first.x);
  assert.ok(third.y > first.y);
  assert.equal(smaller.width, first.width/2);
  assert.equal(smaller.height, first.height/2);
  assert.equal(smaller.x + smaller.width/2, first.x + first.width/2);
  assert.equal(imagePlacement(layout,4,400,200).page,1);
  const geometry = pageGeometry(layout);
  assert.equal(geometry.width,297);
  assert.equal(geometry.height,210);
  assert.ok(first.x>=15 && first.y>=15);
});

test('single photo layout and landscape are reflected in the PDF', async () => {
  const images = Array.from({length:2}, () => ({ bytes: jpeg, width:40, height:20, scale:50 }));
  const blob = await buildImagePdf(images, { ...defaultImagePdfLayout, columns:1, rows:1, landscape:true });
  const pdf = await pdfLib.PDFDocument.load(await blob.arrayBuffer());
  assert.equal(pdf.getPageCount(),2);
  assert.ok(pdf.getPage(0).getWidth() > pdf.getPage(0).getHeight());
});
