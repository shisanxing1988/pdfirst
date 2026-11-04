import { init } from '@embedpdf/pdfium';
import { PdfiumNative } from '@embedpdf/engines/pdfium';

export type TextRemoval = { pageNumber: number; xRatio: number; yRatio: number; widthRatio: number; heightRatio: number };

// This operates on text objects, including nested Form XObjects. Images, rules,
// backgrounds and unrelated text are retained. No document bytes leave the browser.
export async function removeTextObjects(data: ArrayBuffer, regions: TextRemoval[], wasmBinary: ArrayBuffer) {
  const engine = new PdfiumNative(await init({ wasmBinary }), { fontFallback: null });
  try {
    const doc = await engine.openDocumentBuffer({ id: 'edit', content: data }).toPromise();
    try {
      for (const page of doc.pages) {
        const boxes = regions.filter(region => region.pageNumber === page.index + 1);
        if (!boxes.length) continue;
        const rects = boxes.map(box => ({
          origin: { x: box.xRatio * page.size.width, y: box.yRatio * page.size.height },
          size: { width: box.widthRatio * page.size.width, height: box.heightRatio * page.size.height },
        }));
        const changed = await engine.redactTextInRects(doc, page, rects, { recurseForms: true, drawBlackBoxes: false }).toPromise();
        if (!changed) throw new Error(`第 ${page.index + 1} 页无法移除原文字，未生成覆盖式文件。请使用原始 PDF 重试。`);
      }
      return await engine.saveAsCopy(doc).toPromise() as ArrayBuffer;
    } finally { await engine.closeDocument(doc).toPromise(); }
  } finally { await engine.destroy().toPromise(); }
}
