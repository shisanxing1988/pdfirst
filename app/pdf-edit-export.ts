import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
// Explicit extension so the tests can import this module with Node's native
// TypeScript stripping, which does not resolve extensionless specifiers.
import { removeTextObjects, type TextRemoval } from './pdf-redaction.ts';

export type ExportText = { pageNumber: number; text: string; xRatio: number; yRatio: number; widthRatio: number; fontSize: number; fontFamily?: string; fontWeight?: number; color?: string };
export type ExportHighlight = { pageNumber: number; xRatio: number; yRatio: number; widthRatio: number; heightRatio: number; color: string };

export async function removeInWorker(data: ArrayBuffer, regions: TextRemoval[]): Promise<ArrayBuffer> {
  if (!regions.length) return data;
  // Vite serves the editor from a generated route in production. A module worker
  // could resolve to file:// in that route and make the entire save fail. Keep the
  // operation in the active page instead: it is deterministic and the saving UI is
  // already blocking while Pdfium edits the source objects.
  const response = await fetch('/pdfium-2.15.1.wasm');
  if (!response.ok) throw new Error('PDF 编辑引擎加载失败，请刷新后重试。');
  return removeTextObjects(data, regions, await response.arrayBuffer());
}

function color(value = '#111827') {
  if (/^#[0-9a-f]{6}$/i.test(value)) return rgb(parseInt(value.slice(1,3),16)/255, parseInt(value.slice(3,5),16)/255, parseInt(value.slice(5,7),16)/255);
  const channels = value.match(/[\d.]+/g)?.map(Number);
  return channels && channels.length >= 3 ? rgb(channels[0]/255, channels[1]/255, channels[2]/255) : rgb(0,0,0);
}

export function wrapPdfText(text: string, width: number, font: PDFFont, size: number) {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const character of Array.from(paragraph)) {
      if (line && font.widthOfTextAtSize(line + character, size) > width) { lines.push(line); line = ''; }
      line += character;
    }
    lines.push(line);
  }
  return lines;
}

// A new text object with a Unicode map is written for every line. Reopening with
// PDF.js recovers the actual text, rather than an image or private editor metadata.
export async function writeEditablePdf(data: ArrayBuffer, texts: ExportText[], highlights: ExportHighlight[], loadCjkFont = async () => {
  const response = await fetch('/fonts/NotoSansSC-Regular.ttf');
  if (!response.ok) throw new Error('中文字体加载失败，请重试。');
  return new Uint8Array(await response.arrayBuffer());
}) {
  const pdf = await PDFDocument.load(data);
  pdf.registerFontkit(fontkit);
  const fonts = new Map<string, PDFFont>();
  async function fontFor(text: ExportText) {
    const bold = (text.fontWeight ?? 400) >= 600;
    const standard = text.fontFamily === 'courier' ? (bold ? StandardFonts.CourierBold : StandardFonts.Courier) : ['times','georgia','serif','song','kai','fangsong'].includes(text.fontFamily ?? '') ? (bold ? StandardFonts.TimesRomanBold : StandardFonts.TimesRoman) : (bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
    let font = fonts.get(standard);
    if (!font) { font = await pdf.embedFont(standard); fonts.set(standard,font); }
    try { font.encodeText(text.text.replace(/[\r\n]/g,'')); return font; }
    catch {
      let cjk = fonts.get('cjk');
      if (!cjk) { cjk = await pdf.embedFont(await loadCjkFont(), { subset: true }); fonts.set('cjk',cjk); }
      // Reject missing glyphs instead of silently writing squares or an image.
      const supported = new Set(cjk.getCharacterSet());
      if (Array.from(text.text).some(char => !'\r\n'.includes(char) && !supported.has(char.codePointAt(0)!))) throw new Error('新增文字包含当前字体不支持的字符，请更换字符后保存。');
      return cjk;
    }
  }
  for (let i=0; i<pdf.getPageCount(); i++) {
    const page = pdf.getPage(i), box = page.getCropBox();
    const rotation = ((page.getRotation().angle % 360) + 360) % 360;
    const rotated = rotation === 90 || rotation === 270;
    const width = rotated ? box.height : box.width, height = rotated ? box.width : box.height;
    const point = (x: number,y: number): [number,number] => rotation === 90 ? [box.x+y,box.y+x] : rotation === 180 ? [box.x+box.width-x,box.y+y] : rotation === 270 ? [box.x+box.width-y,box.y+box.height-x] : [box.x+x,box.y+box.height-y];
    for (const mark of highlights.filter(h=>h.pageNumber===i+1)) {
      const [x,y] = point(mark.xRatio*width,(mark.yRatio+mark.heightRatio)*height);
      page.drawRectangle({x,y,width:mark.widthRatio*width,height:mark.heightRatio*height,rotate:degrees(rotation),color:color(mark.color),opacity:0.45,borderWidth:0});
    }
    for (const text of texts.filter(t=>t.pageNumber===i+1 && t.text.trim())) {
      const font = await fontFor(text), size = text.fontSize;
      const lines = wrapPdfText(text.text,Math.max(1,text.widthRatio*width),font,size);
      // `yRatio` is the visual top edge. PDF drawText takes a baseline; deriving
      // it from the embedded font ascent avoids the downward drift seen after a
      // document is reopened (especially for mixed Chinese/Latin text).
      const ascent = font.heightAtSize(size, { descender: false });
      for (const [index,line] of lines.entries()) {
        if (!line) continue;
        const [x,y] = point(text.xRatio*width,text.yRatio*height+ascent+index*size*1.25);
        page.drawText(line,{x,y,font,size,color:color(text.color),rotate:degrees(rotation)});
      }
    }
  }
  return new Blob([new Uint8Array(await pdf.save())], {type:'application/pdf'});
}
