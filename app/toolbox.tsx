"use client";

import { ChangeEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { track } from "./usage-tracking";
import OutputPreview from "./output-preview";
import ImagePdfEditor from "./image-pdf-editor";
import { buildImagePdf, defaultImagePdfLayout, pageGeometry, type ImagePdfLayout } from "./image-pdf-layout";
// pdf-lib is loaded on demand inside each handler (see app/pdf-lib-loader.ts) so
// the landing page does not ship the PDF engine.
import { loadPdfLib } from "./pdf-lib-loader";

import { removeInWorker, writeEditablePdf, type ExportText } from "./pdf-edit-export";

import type { ToolId } from "./tool-id";
type ToolKind = "image" | "pdf" | "word";
type EditorTool = "select" | "edit-text" | "add-text" | "highlight";
type SealSide = "right" | "left" | "top" | "bottom";

type OutputFile = {
  name: string;
  size: number;
  url: string;
  blob: Blob;
};

type VisualText = {
  id: string;
  text: string;
  xRatio: number;
  yRatio: number;
  pageMode: string;
  pageNumber: number;
  fontSize: number;
  fontFamily: string;
  clarity: number;
  color?: string;
};

type PdfTextBox = {
  id: string;
  pageNumber: number;
  originalText: string;
  text: string;
  xRatio: number;
  yRatio: number;
  editXRatio?: number;
  editYRatio?: number;
  widthRatio: number;
  heightRatio: number;
  fontSize: number;
  editedFontSize?: number;
  editWidthRatio?: number;
  backgroundColor?: string;
  color?: string;
  autoColor?: string;
  deleted?: boolean;
  originalFontFamily?: string;
  fontWeight?: number;
  fontFamily?: string;
  clarity?: number;
};

type HighlightMark = {
  id: string;
  pageNumber: number;
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
  color: string;
};

// 撤销/重做只快照这三个数组；它们的元素在更新时都是整体替换，所以快照只存引用，
// 一次撤销的额外内存是三个数组头。
type EditorSnapshot = { pdfTextBoxes: PdfTextBox[]; visualTexts: VisualText[]; highlights: HighlightMark[] };

const tools: Array<{
  id: ToolId;
  kind: ToolKind;
  title: string;
  tag: string;
  description: string;
  featured?: boolean;
}> = [
  {
    id: "pdf-edit",
    kind: "pdf",
    title: "PDF 原文编辑",
    tag: "主推功能 · 替换文字",
    description: "直接打开 PDF，修改可识别原文，也支持添加批注文字后保存。",
    featured: true,
  },
  {
    id: "pdf-seal",
    kind: "pdf",
    title: "PDF 骑缝章",
    tag: "主推功能 · 合同批量盖章",
    description: "一次选择多份合同，按页切分章图并贴到 PDF 边缘。",
    featured: true,
  },
  {
    id: "compress",
    kind: "image",
    title: "图片压缩",
    tag: "JPG / PNG / WebP",
    description: "在浏览器里压缩图片，不上传服务器。",
  },
  {
    id: "convert",
    kind: "image",
    title: "图片格式转换",
    tag: "WebP / JPG / PNG",
    description: "批量转换常见图片格式，适合公众号、网站和资料整理。",
  },
  {
    id: "image-pdf",
    kind: "image",
    title: "图片转 PDF",
    tag: "多图合成",
    description: "把多张图片按顺序打包成一个 PDF 文件。",
  },
  {
    id: "pdf-merge",
    kind: "pdf",
    title: "合并 PDF",
    tag: "多文件合并",
    description: "把多个 PDF 按上传顺序合并成一个文件。",
  },
  {
    id: "pdf-split",
    kind: "pdf",
    title: "拆分 PDF",
    tag: "逐页导出",
    description: "把一个 PDF 拆成每页一个独立文件。",
  },
  {
    id: "pdf-compress",
    kind: "pdf",
    title: "PDF 轻量压缩",
    tag: "结构优化",
    description: "重新整理 PDF 对象结构。扫描件深度压缩下一阶段接服务端。",
  },
  {
    id: "pdf-word",
    kind: "pdf",
    title: "PDF 转 Word",
    tag: "可编辑文字",
    description: "提取 PDF 文字，扫描件自动识别中英文，生成可编辑的 Word 文档。",
  },
  {
    id: "word-seal",
    kind: "word",
    title: "Word 转 PDF 骑缝章",
    tag: "DOCX 批量盖章",
    description: "一次选择多份 Word 合同，转成 PDF 后统一加骑缝章。",
  },
];

const fontOptions = [
  { value: "system", label: "默认黑体", stack: 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif' },
  { value: "song", label: "宋体", stack: 'SimSun, "Songti SC", serif' },
  { value: "hei", label: "黑体", stack: 'SimHei, "Heiti SC", "Microsoft YaHei", sans-serif' },
  { value: "kai", label: "楷体", stack: 'KaiTi, "Kaiti SC", STKaiti, serif' },
  { value: "fangsong", label: "仿宋", stack: 'FangSong, STFangsong, serif' },
  { value: "yahei", label: "微软雅黑", stack: '"Microsoft YaHei", "PingFang SC", sans-serif' },
  { value: "pingfang", label: "苹方", stack: '"PingFang SC", "Microsoft YaHei", sans-serif' },
  { value: "arial", label: "Arial", stack: 'Arial, Helvetica, sans-serif' },
  { value: "times", label: "Times New Roman", stack: '"Times New Roman", Times, serif' },
  { value: "georgia", label: "Georgia", stack: 'Georgia, serif' },
  { value: "courier", label: "Courier New（等宽）", stack: '"Courier New", monospace' },
  { value: "verdana", label: "Verdana", stack: 'Verdana, sans-serif' },
  { value: "serif", label: "衬线", stack: 'Georgia, "Times New Roman", serif' },
];

function fontStack(value?: string) {
  return fontOptions.find((font) => font.value === value)?.stack ?? fontOptions[0].stack;
}

function effectivePdfFontSize(box: PdfTextBox) {
  return box.editedFontSize ?? box.fontSize;
}

function isPdfTextEdited(box: PdfTextBox) {
  return (
    box.deleted === true ||
    box.text !== box.originalText ||
    box.editXRatio !== undefined ||
    box.editYRatio !== undefined ||
    box.editedFontSize !== undefined ||
    box.editWidthRatio !== undefined ||
    box.fontFamily !== undefined ||
    box.color !== undefined ||
    box.clarity !== undefined
  );
}

function wrapEditorText(text: string, width: number, measure: (value: string) => number) {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    for (const character of Array.from(paragraph)) {
      if (line && measure(line + character) > width) {
        lines.push(line);
        line = "";
      }
      line += character;
    }
    lines.push(line);
  }
  return lines;
}

function pdfEditorLayout(box: PdfTextBox, canvasWidth: number, scale: number, context?: CanvasRenderingContext2D) {
  const widthRatio = Math.max(0.001, Math.min(box.editWidthRatio ?? box.widthRatio, 1 - (box.editXRatio ?? box.xRatio)));
  const fontSize = effectivePdfFontSize(box) * scale;
  // Export mixed CJK text through the bundled font. Use it in the editor too, so
  // the width and baseline the user sees are the same ones saved into the PDF.
  const hasCjk = Array.from(box.text).some((character) => (character.codePointAt(0) ?? 0) > 0xff);
  const family = hasCjk ? '"PdfEditorCJK", sans-serif' : box.fontFamily ? fontStack(box.fontFamily) : box.originalFontFamily ? `${JSON.stringify(box.originalFontFamily)}, ${fontStack()}` : fontStack();
  const font = `${box.fontWeight ?? 400} ${fontSize}px ${family}`;
  const measureContext = context ?? document.createElement("canvas").getContext("2d");
  if (measureContext) measureContext.font = font;
  const lines = wrapEditorText(box.text, widthRatio * canvasWidth, value => measureContext?.measureText(value).width ?? value.length * fontSize);
  return { widthRatio, fontSize, font, family, lines, lineHeight: fontSize * 1.25 };
}

function pdfTextMaskRect(box: PdfTextBox, canvasWidth: number, canvasHeight: number) {
  // PDF text transforms locate the baseline, not the bottom of the ink.
  // Include descenders and antialiased edge pixels without extending across a row.
  const originalX = box.xRatio * canvasWidth;
  const originalY = box.yRatio * canvasHeight;
  const originalWidth = box.widthRatio * canvasWidth;
  const originalHeight = box.heightRatio * canvasHeight;
  const edge = originalHeight * 0.08;
  const descent = originalHeight * 0.25;
  const x = Math.max(0, originalX - edge);
  const y = Math.max(0, originalY - edge);
  const right = Math.min(canvasWidth, originalX + originalWidth + edge);
  const bottom = Math.min(canvasHeight, originalY + originalHeight + descent);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

function pdfTextBackground(canvas: HTMLCanvasElement | null, mask: { x: number; y: number; width: number; height: number }) {
  const context = canvas?.getContext("2d");
  if (!canvas || !context || !mask.width || !mask.height) return "#ffffff";
  const colors = new Map<string, number>();
  // Sample just beyond the left/right edges, where the original glyphs are absent.
  // The most common color avoids treating isolated rules or glyph edges as background.
  for (const side of [-1, 1]) {
    const x = Math.max(0, Math.min(canvas.width - 1, Math.round(side < 0 ? mask.x - 2 : mask.x + mask.width + 2)));
    for (let step = 1; step < 10; step++) {
      const y = Math.max(0, Math.min(canvas.height - 1, Math.round(mask.y + mask.height * step / 10)));
      const [r, g, b, a] = context.getImageData(x, y, 1, 1).data;
      const color = a === 0 ? "#ffffff" : `rgb(${r}, ${g}, ${b})`;
      colors.set(color, (colors.get(color) ?? 0) + 1);
    }
  }
  return [...colors].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "#ffffff";
}

// 采样原文字颜色：在 mask 内找出与背景差异最大的高频颜色。深底白字（银行
// 流水标题等）必须靠它保留白字——contrastTextColor 只会反推深色字。
function pdfTextInkColor(canvas: HTMLCanvasElement | null, mask: { x: number; y: number; width: number; height: number }, background?: string) {
  const context = canvas?.getContext("2d");
  if (!canvas || !context || !mask.width || !mask.height) return undefined;
  const [br = -1, bg = -1, bb = -1] = background?.match(/[\d.]+/g)?.map(Number) ?? [];
  const x0 = Math.max(0, Math.floor(mask.x));
  const y0 = Math.max(0, Math.floor(mask.y));
  const width = Math.min(canvas.width - x0, Math.ceil(mask.width));
  const height = Math.min(canvas.height - y0, Math.ceil(mask.height));
  if (width <= 0 || height <= 0) return undefined;
  const { data } = context.getImageData(x0, y0, width, height);
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const index = (py * width + px) * 4;
      const [r, g, b, a] = [data[index], data[index + 1], data[index + 2], data[index + 3]];
      if (a < 128) continue;
      // 跳过背景及其抗锯齿过渡色，剩下的高频色就是字形本色。
      if (br >= 0 && Math.hypot(r - br, g - bg, b - bb) < 60) continue;
      const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
      const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
      bucket.count += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      buckets.set(key, bucket);
    }
  }
  const best = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
  // 至少 4 个像素聚成一类才可信，避免噪点决定文字颜色。
  if (!best || best.count < 4) return undefined;
  const channel = (sum: number) => Math.round(sum / best.count).toString(16).padStart(2, "0");
  return `#${channel(best.r)}${channel(best.g)}${channel(best.b)}`;
}

function contrastTextColor(background?: string) {
  const channels = background?.match(/\d+/g)?.map(Number);
  if (!channels || channels.length < 3) return "#111827";
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 < 140 ? "#ffffff" : "#111827";
}

function prettySize(size: number) {
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

function fileBaseName(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

function blobFromCanvas(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("图片处理失败，请换一张图片试试。"));
      },
      type,
      quality,
    );
  });
}

async function drawImage(file: File, maxSide: number, background = "#ffffff") {
  let image: ImageBitmap | HTMLImageElement;
  let imageUrl: string | undefined;
  try {
    try {
      image = await createImageBitmap(file);
    } catch {
      imageUrl = URL.createObjectURL(file);
      const fallback = new Image();
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => { fallback.src = ""; reject(new Error("图片读取超时")); }, 20000);
        fallback.onload = () => { window.clearTimeout(timer); resolve(); };
        fallback.onerror = () => { window.clearTimeout(timer); reject(new Error("无法读取图片")); };
        fallback.src = imageUrl!;
      });
      image = fallback;
    }
    try {
      const width = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
      const height = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
      if (!width || !height) throw new Error("图片尺寸无效");
      const scale = Math.min(1, maxSide / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("浏览器不支持图片画布处理");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas;
    } finally {
      if ("close" in image) image.close();
    }
  } catch {
    throw new Error(`无法读取「${file.name}」。请确认文件未损坏；HEIC 等格式请先另存为 JPG 或 PNG 后重试。`);
  } finally {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  }
}

async function readBytes(blob: Blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

function latin1Bytes(value: string) {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

function crc32(bytes: Uint8Array) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function createZip(entries: Array<{ name: string; content: string | Uint8Array }>) {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  const encoder = new TextEncoder();
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) | ((Math.floor(now.getSeconds() / 2) & 0x1f));
  const dosDate = (((now.getFullYear() - 1980) & 0x7f) << 9) | (((now.getMonth() + 1) & 0xf) << 5) | (now.getDate() & 0x1f);

  function uint16(value: number) {
    return [value & 0xff, (value >>> 8) & 0xff];
  }

  function uint32(value: number) {
    return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
  }

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = typeof entry.content === "string" ? encoder.encode(entry.content) : entry.content;
    const checksum = crc32(data);
    const localHeader = new Uint8Array([
      ...uint32(0x04034b50),
      ...uint16(20),
      ...uint16(0),
      ...uint16(0),
      ...uint16(dosTime),
      ...uint16(dosDate),
      ...uint32(checksum),
      ...uint32(data.length),
      ...uint32(data.length),
      ...uint16(nameBytes.length),
      ...uint16(0),
    ]);
    chunks.push(localHeader, nameBytes, data);

    const centralHeader = new Uint8Array([
      ...uint32(0x02014b50),
      ...uint16(20),
      ...uint16(20),
      ...uint16(0),
      ...uint16(0),
      ...uint16(dosTime),
      ...uint16(dosDate),
      ...uint32(checksum),
      ...uint32(data.length),
      ...uint32(data.length),
      ...uint16(nameBytes.length),
      ...uint16(0),
      ...uint16(0),
      ...uint16(0),
      ...uint16(0),
      ...uint32(0),
      ...uint32(offset),
    ]);
    central.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = central.reduce((size, chunk) => size + chunk.length, 0);
  const endRecord = new Uint8Array([
    ...uint32(0x06054b50),
    ...uint16(0),
    ...uint16(0),
    ...uint16(entries.length),
    ...uint16(entries.length),
    ...uint32(centralSize),
    ...uint32(centralOffset),
    ...uint16(0),
  ]);

  return new Blob([...chunks, ...central, endRecord], { type: "application/zip" });
}

function textPagesToDocx(pages: string[]) {
  // XML 1.0 excludes these control characters.
  // eslint-disable-next-line no-control-regex
  const escape = (text: string) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = pages.map((text, index) =>
    `${index ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : ''}${text.split(/\r?\n/).map(line => `<w:p><w:pPr><w:spacing w:after="80"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="宋体"/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">${escape(line)}</w:t></w:r></w:p>`).join('')}`
  ).join('');
  return createZip([
    { name: "[Content_Types].xml", content: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: "_rels/.rels", content: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: "word/document.xml", content: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>` },
  ]);
}

async function pdfToWord(file: File, onProgress: (message: string) => void) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
  const loadingTask = pdfjsLib.getDocument({ data: await file.arrayBuffer() });
  const pdf = await loadingTask.promise;
  let worker: import("tesseract.js").Worker | undefined;
  const pages: string[] = [];
  const reviewPages: number[] = [];
  let currentPage = 0;
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      currentPage = pageNumber;
      onProgress(`正在提取第 ${pageNumber}/${pdf.numPages} 页文字…`);
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        let text = "";
        let previousY: number | undefined;
        let previousEnd = 0;
        for (const item of content.items) {
          if (!("str" in item)) continue;
          const y = item.transform[5];
          const height = Math.max(1, Math.abs(item.height));
          if (previousY !== undefined && Math.abs(y - previousY) > height * 0.5 && !text.endsWith("\n")) text += "\n";
          else if (text && !/\s$/.test(text) && item.transform[4] - previousEnd > height * 0.2) text += " ";
          text += item.str;
          if (item.hasEOL) text += "\n";
          previousY = y;
          previousEnd = item.transform[4] + item.width;
        }
        // Pages without a usable text layer need OCR, including broken font mappings.
        if (!text.trim() || (text.match(/\uFFFD/g)?.length ?? 0) > text.trim().length * 0.1) {
          onProgress(`正在加载中英文识别模型，第 ${pageNumber}/${pdf.numPages} 页…`);
          if (!worker) {
            const { createWorker } = await import("tesseract.js");
            worker = await createWorker(["chi_sim", "eng"], 1, {
              logger: event => onProgress(`正在识别第 ${currentPage}/${pdf.numPages} 页：${Math.round(event.progress * 100)}%（首次需下载识别模型）`),
            });
          }
          const original = page.getViewport({ scale: 1 });
          const scale = Math.min(3, 4096 / Math.max(original.width, original.height));
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          try {
            const context = canvas.getContext("2d");
            if (!context) throw new Error("浏览器不支持 PDF 页面渲染。");
            await page.render({ canvas, canvasContext: context, viewport }).promise;
            const { data } = await worker.recognize(canvas);
            text = data.text;
            if (!text.trim() || data.confidence < 70) reviewPages.push(pageNumber);
          } finally {
            canvas.width = canvas.height = 0;
          }
        }
        pages.push(text.trim());
      } finally {
        page.cleanup();
      }
    }
    if (!pages.some(text => text.trim())) throw new Error("未识别到可编辑文字，请使用更清晰、方向正确的扫描件后重试。");
    return { blob: textPagesToDocx(pages), reviewPages };
  } finally {
    try { await worker?.terminate(); } finally { await loadingTask.destroy(); }
  }
}

async function imagesToPdf(files: File[], maxSide: number, quality: number, layout: ImagePdfLayout, scales: Map<File, number>) {
  const prepared = [];
  for (const file of files) {
    const canvas = await drawImage(file, maxSide);
    try {
      const jpeg = await blobFromCanvas(canvas, "image/jpeg", quality / 100);
      prepared.push({ width: canvas.width, height: canvas.height, bytes: await readBytes(jpeg), scale: scales.get(file) ?? 100 });
    } finally {
      canvas.width = canvas.height = 0;
    }
  }
  return buildImagePdf(prepared, layout);
}


async function mergePdfs(files: File[]) {
  const { PDFDocument } = await loadPdfLib();
  const merged = await PDFDocument.create();
  for (const file of files) {
    const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  const bytes = await merged.save({ useObjectStreams: true });
  return new Blob([bytes], { type: "application/pdf" });
}

async function splitPdf(file: File[]) {
  const { PDFDocument } = await loadPdfLib();
  const sourceFile = file[0];
  const source = await PDFDocument.load(await sourceFile.arrayBuffer(), { ignoreEncryption: true });
  const outputs: OutputFile[] = [];

  for (const pageIndex of source.getPageIndices()) {
    const single = await PDFDocument.create();
    const [page] = await single.copyPages(source, [pageIndex]);
    single.addPage(page);
    const bytes = await single.save({ useObjectStreams: true });
    const blob = new Blob([bytes], { type: "application/pdf" });
    outputs.push({
      name: `${fileBaseName(sourceFile.name)}-page-${pageIndex + 1}.pdf`,
      size: blob.size,
      url: URL.createObjectURL(blob),
      blob,
    });
  }

  return outputs;
}

async function optimizePdf(file: File) {
  const { PDFDocument } = await loadPdfLib();
  const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const target = await PDFDocument.create();
  const pages = await target.copyPages(source, source.getPageIndices());
  pages.forEach((page) => target.addPage(page));
  const bytes = await target.save({ useObjectStreams: true, objectsPerTick: 40 });
  return new Blob([bytes], { type: "application/pdf" });
}

async function canvasToPngBytes(canvas: HTMLCanvasElement) {
  const blob = await blobFromCanvas(canvas, "image/png", 1);
  return readBytes(blob);
}

async function addSeamSealToPdf(
  file: Blob,
  sealFile: File,
  options: { side: SealSide; size: number; offset: number; position: number; opacity: number; rotation: number },
) {
  const { PDFDocument, degrees } = await loadPdfLib();
  const pdf = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const pages = pdf.getPages();
  if (pages.length === 0) throw new Error("PDF 没有可盖章页面。");

  const sealImage = await createImageBitmap(sealFile);
  const verticalSide = options.side === "left" || options.side === "right";
  const fullWidth = verticalSide ? options.size : options.size * (sealImage.width / sealImage.height);
  const fullHeight = verticalSide ? options.size * (sealImage.height / sealImage.width) : options.size;

  for (let index = 0; index < pages.length; index += 1) {
    const sliceCanvas = document.createElement("canvas");
    const sliceContext = sliceCanvas.getContext("2d");
    if (!sliceContext) throw new Error("浏览器不支持印章切分。");

    if (verticalSide) {
      const sourceWidth = sealImage.width / pages.length;
      sliceCanvas.width = Math.max(1, Math.ceil(sourceWidth));
      sliceCanvas.height = sealImage.height;
      sliceContext.drawImage(sealImage, index * sourceWidth, 0, sourceWidth, sealImage.height, 0, 0, sliceCanvas.width, sliceCanvas.height);
    } else {
      const sourceHeight = sealImage.height / pages.length;
      sliceCanvas.width = sealImage.width;
      sliceCanvas.height = Math.max(1, Math.ceil(sourceHeight));
      sliceContext.drawImage(sealImage, 0, index * sourceHeight, sealImage.width, sourceHeight, 0, 0, sliceCanvas.width, sliceCanvas.height);
    }

    const stamp = await pdf.embedPng(await canvasToPngBytes(sliceCanvas));
    const page = pages[index];
    const { width, height } = page.getSize();
    const visibleWidth = verticalSide ? fullWidth / pages.length : fullWidth;
    const visibleHeight = verticalSide ? fullHeight : fullHeight / pages.length;
    const x =
      options.side === "right"
        ? width - visibleWidth - options.offset
        : options.side === "left"
          ? options.offset
          : Math.max(0, Math.min(width - visibleWidth, (width - visibleWidth) * (options.position / 100)));
    const y =
      options.side === "top"
        ? height - visibleHeight - options.offset
        : options.side === "bottom"
          ? options.offset
          : Math.max(0, Math.min(height - visibleHeight, (height - visibleHeight) * (options.position / 100)));

    page.drawImage(stamp, {
      x,
      y,
      width: visibleWidth,
      height: visibleHeight,
      opacity: options.opacity / 100,
      rotate: degrees(options.rotation),
    });
  }

  sealImage.close();
  const bytes = await pdf.save({ useObjectStreams: true });
  return new Blob([bytes], { type: "application/pdf" });
}

async function inflateZipData(data: Uint8Array, compression: number) {
  if (compression === 0) return data;
  if (compression !== 8) throw new Error("暂不支持这个 Word 文件的压缩格式。");
  if (!("DecompressionStream" in window)) throw new Error("当前浏览器不支持直接读取 Word，请先把 Word 另存为 PDF 后盖章。");

  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw" as CompressionFormat));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readDocxEntry(file: Blob, targetPath: string) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocdOffset = -1;

  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 66000); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset < 0) throw new Error("无法读取这个 Word 文件，请确认是 .docx 格式。");
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameLength));

    if (name === targetPath) {
      const localNameLength = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
      const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
      return inflateZipData(bytes.slice(dataOffset, dataOffset + compressedSize), compression);
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error("这个 Word 文件里没有找到正文内容。");
}

function extractDocxParagraphs(xml: string) {
  const documentXml = new DOMParser().parseFromString(xml, "application/xml");
  const paragraphs = Array.from(documentXml.getElementsByTagName("w:p"));

  return paragraphs
    .map((paragraph) => {
      let text = "";
      paragraph.querySelectorAll("w\\:t, t").forEach((node) => {
        text += node.textContent ?? "";
      });
      paragraph.querySelectorAll("w\\:tab, tab").forEach(() => {
        text += "  ";
      });
      return text.trim();
    })
    .filter(Boolean);
}

async function readWordPreview(blob: Blob) {
  const xml = await readDocxEntry(blob, "word/document.xml");
  return extractDocxParagraphs(new TextDecoder().decode(xml));
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  let current = "";

  for (const char of text) {
    const next = current + char;
    if (context.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = char;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines;
}

async function docxToPdf(file: File) {
  const documentXml = await readDocxEntry(file, "word/document.xml");
  const paragraphs = extractDocxParagraphs(new TextDecoder().decode(documentXml));
  if (paragraphs.length === 0) throw new Error("没有读取到 Word 正文内容。");

  const { PDFDocument } = await loadPdfLib();
  const pdf = await PDFDocument.create();
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const canvasWidth = 1240;
  const canvasHeight = 1754;
  const marginX = 110;
  const marginTop = 120;
  const marginBottom = 100;
  const lineHeight = 44;
  const titleSize = 36;
  const bodySize = 28;
  let canvas = document.createElement("canvas");
  let context = canvas.getContext("2d");
  const pageImages: Uint8Array[] = [];
  let y = marginTop;

  function startPage() {
    canvas = document.createElement("canvas");
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不支持 Word 转 PDF 画布。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvasWidth, canvasHeight);
    context.fillStyle = "#111827";
    context.textBaseline = "top";
    context.font = `${bodySize}px Arial, "PingFang SC", "Microsoft YaHei", sans-serif`;
    y = marginTop;
  }

  async function finishPage() {
    if (!context) return;
    const jpg = await blobFromCanvas(canvas, "image/jpeg", 0.92);
    pageImages.push(await readBytes(jpg));
  }

  startPage();

  for (let index = 0; index < paragraphs.length; index += 1) {
    if (!context) throw new Error("浏览器不支持 Word 转 PDF 画布。");
    const isTitle = index === 0 && paragraphs[index].length <= 40;
    context.font = `${isTitle ? titleSize : bodySize}px Arial, "PingFang SC", "Microsoft YaHei", sans-serif`;
    const lines = wrapCanvasText(context, paragraphs[index], canvasWidth - marginX * 2);
    const blockHeight = lines.length * lineHeight + 18;

    if (y + blockHeight > canvasHeight - marginBottom) {
      await finishPage();
      startPage();
      if (!context) throw new Error("浏览器不支持 Word 转 PDF 画布。");
      context.font = `${bodySize}px Arial, "PingFang SC", "Microsoft YaHei", sans-serif`;
    }

    for (const line of lines) {
      context.fillText(line, marginX, y);
      y += lineHeight;
    }
    y += 18;
  }

  await finishPage();

  for (const imageBytes of pageImages) {
    const image = await pdf.embedJpg(imageBytes);
    const page = pdf.addPage([pageWidth, pageHeight]);
    page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
  }

  const bytes = await pdf.save({ useObjectStreams: true });
  return new Blob([bytes], { type: "application/pdf" });
}

async function editPdf(file: File, options: { text: string; pageMode: string; pageNumber: number; fontSize: number }) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const pdf = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const targetPages = options.pageMode === "all" ? pages : [pages[Math.max(0, Math.min(pages.length - 1, options.pageNumber - 1))]];

  targetPages.forEach((page) => {
    const { width, height } = page.getSize();
    page.drawText(options.text, {
      x: Math.max(24, width * 0.08),
      y: Math.max(24, height * 0.1),
      size: options.fontSize,
      font,
      color: rgb(0.12, 0.44, 0.41),
      opacity: 0.88,
    });
  });

  const bytes = await pdf.save({ useObjectStreams: true });
  return new Blob([bytes], { type: "application/pdf" });
}

async function saveVisualEditorPdf(file: File, boxes: PdfTextBox[], notes: VisualText[], highlights: HighlightMark[]) {
  const changedBoxes = boxes.filter(isPdfTextEdited);
  if (!changedBoxes.length && !notes.some(note => note.text.trim()) && !highlights.length) throw new Error("请先修改文字，或添加新文字/高亮。");
  const input = await file.arrayBuffer();
  const { PDFDocument } = await loadPdfLib();
  const pageCount = (await PDFDocument.load(input)).getPageCount();
  const regions = changedBoxes.map(box => ({
    pageNumber: box.pageNumber, xRatio: box.xRatio, yRatio: box.yRatio,
    widthRatio: box.widthRatio, heightRatio: box.heightRatio,
  }));
  const texts: ExportText[] = changedBoxes.filter(box => !box.deleted && box.text.trim()).map(box => ({
    pageNumber: box.pageNumber, text: box.text,
    xRatio: box.editXRatio ?? box.xRatio, yRatio: box.editYRatio ?? box.yRatio,
    widthRatio: box.editWidthRatio ?? box.widthRatio,
    fontSize: effectivePdfFontSize(box), fontFamily: box.fontFamily,
    fontWeight: box.fontWeight, color: box.color ?? box.autoColor ?? contrastTextColor(box.backgroundColor),
    backgroundColor: box.backgroundColor,
    patchRect: { xRatio: box.xRatio, yRatio: box.yRatio, widthRatio: box.widthRatio, heightRatio: box.heightRatio },
  }));
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    for (const note of notes.filter(note => note.pageMode === "all" || note.pageNumber === pageNumber)) {
      texts.push({ pageNumber, text: note.text, xRatio: note.xRatio, yRatio: note.yRatio,
        widthRatio: Math.max(0.01, 1 - note.xRatio), fontSize: note.fontSize,
        fontFamily: note.fontFamily, fontWeight: 700, color: note.color ?? "#1f6f67" });
    }
  }
  return writeEditablePdf(await removeInWorker(input, regions), texts, highlights);
}

function buildTextBoxes(
  pdfjsLib: typeof import("pdfjs-dist/legacy/build/pdf.mjs"),
  textContent: { items: unknown[]; styles?: Record<string, { fontFamily: string }> },
  viewport: { width: number; height: number; transform: number[] },
  pageNumber: number,
  existingBoxes: PdfTextBox[],
) {
  const rawBoxes = textContent.items
    .filter((item): item is typeof item & { str: string; transform: number[]; width: number; height: number; fontName?: string } => typeof item === "object" && item !== null && "str" in item && typeof item.str === "string" && Boolean(item.str.trim()))
    .map((item, index) => {
      const transform = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const fontHeight = Math.max(1, Math.hypot(transform[2], transform[3]));
      const x = transform[4];
      const y = transform[5] - fontHeight;
      const viewportScale = Math.hypot(viewport.transform[0], viewport.transform[1]) || 1;
      const width = item.width > 0 ? item.width * viewportScale : item.str.length * fontHeight * 0.46;
      const height = Math.max(item.height * viewportScale, fontHeight);

      return {
        id: `${pageNumber}-raw-${index}`,
        pageNumber,
        originalText: item.str,
        text: item.str,
        xRatio: Math.max(0, Math.min(1, x / viewport.width)),
        yRatio: Math.max(0, Math.min(1, y / viewport.height)),
        widthRatio: Math.max(0.01, Math.min(1, width / viewport.width)),
        heightRatio: Math.max(0.01, Math.min(1, height / viewport.height)),
        fontSize: fontHeight / viewportScale,
        originalFontFamily: item.fontName ? textContent.styles?.[item.fontName]?.fontFamily : undefined,
        fontWeight: item.fontName && /bold|black|heavy/i.test(textContent.styles?.[item.fontName]?.fontFamily ?? "") ? 700 : 400,
      };
    })
    .sort((a, b) => a.yRatio - b.yRatio || a.xRatio - b.xRatio);

  // Some PDFs paint identical text twice at the same position (for example,
  // simulated bold). Deduplicate those drawing runs before joining a line.
  // Repeated words at distinct positions are intentional and must survive.
  const uniqueBoxes: typeof rawBoxes = [];
  for (const box of rawBoxes) {
    const duplicate = uniqueBoxes.some((other) =>
      other.originalText === box.originalText &&
      Math.abs(other.xRatio - box.xRatio) * viewport.width <= 0.75 &&
      Math.abs(other.yRatio - box.yRatio) * viewport.height <= 0.75 &&
      Math.abs(other.widthRatio - box.widthRatio) * viewport.width <= 0.75 &&
      Math.abs(other.heightRatio - box.heightRatio) * viewport.height <= 0.75
    );
    if (!duplicate) uniqueBoxes.push(box);
  }

  const lines: PdfTextBox[] = [];
  for (const box of uniqueBoxes) {
    const last = lines[lines.length - 1];
    const sameLine = last && Math.abs(last.yRatio - box.yRatio) < 0.006;
    // A slightly lower line in the left column must not merge backwards into
    // the right column (e.g. a name next to a statement date).
    const gap = last ? (box.xRatio - (last.xRatio + last.widthRatio)) * viewport.width : Infinity;
    const closeEnough = last && box.xRatio >= last.xRatio && gap >= -0.75 && gap < Math.min(20, box.fontSize * 1.5);

    if (sameLine && closeEnough) {
      const right = Math.max(last.xRatio + last.widthRatio, box.xRatio + box.widthRatio);
      const bottom = Math.max(last.yRatio + last.heightRatio, box.yRatio + box.heightRatio);
      const needsSpace = /[A-Za-z0-9]$/.test(last.originalText) && /^[A-Za-z0-9]/.test(box.originalText);
      last.originalText = `${last.originalText}${needsSpace ? " " : ""}${box.originalText}`;
      last.text = `${last.text}${needsSpace ? " " : ""}${box.text}`;
      last.widthRatio = right - last.xRatio;
      last.heightRatio = bottom - last.yRatio;
      last.fontSize = Math.max(last.fontSize, box.fontSize);
    } else {
      lines.push({ ...box, id: `${pageNumber}-line-${lines.length}` });
    }
  }

  return lines.map((line) => {
    const existing = existingBoxes.find((box) => box.id === line.id);
    return {
      ...line,
      text: existing?.text ?? line.text,
      editXRatio: existing?.editXRatio,
      editYRatio: existing?.editYRatio,
      editedFontSize: existing?.editedFontSize,
      editWidthRatio: existing?.editWidthRatio,
      deleted: existing?.deleted,
      color: existing?.color,
      autoColor: existing?.autoColor,
      fontFamily: existing?.fontFamily,
      clarity: existing?.clarity,
    };
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapePdfLiteral(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function replaceAllText(value: string, search: string, replacement: string) {
  return value.replace(new RegExp(escapeRegExp(search), "g"), replacement);
}

function replacePdfLiteralStrings(content: string, search: string, replacement: string) {
  let count = 0;
  const literalSearch = escapePdfLiteral(search);
  const literalReplacement = escapePdfLiteral(replacement);
  const direct = replaceAllText(content, literalSearch, literalReplacement);

  if (direct !== content) {
    count += content.split(literalSearch).length - 1;
    content = direct;
  }

  const charByChar = search
    .split("")
    .map((char) => escapePdfLiteral(char))
    .join("\\)\\s*Tj\\s*\\(");
  const charRegex = new RegExp(`\\(${charByChar}\\)`, "g");
  content = content.replace(charRegex, () => {
    count += 1;
    return `(${literalReplacement})`;
  });

  return { content, count };
}

function replacePdfHexStrings(content: string, search: string, replacement: string) {
  const utf8Bytes = new TextEncoder().encode(search);
  const utf8ReplacementBytes = new TextEncoder().encode(replacement);
  const utf16Bytes = new Uint8Array(search.length * 2);
  const utf16ReplacementBytes = new Uint8Array(replacement.length * 2);
  for (let index = 0; index < search.length; index += 1) {
    const code = search.charCodeAt(index);
    utf16Bytes[index * 2] = code >> 8;
    utf16Bytes[index * 2 + 1] = code & 0xff;
  }
  for (let index = 0; index < replacement.length; index += 1) {
    const code = replacement.charCodeAt(index);
    utf16ReplacementBytes[index * 2] = code >> 8;
    utf16ReplacementBytes[index * 2 + 1] = code & 0xff;
  }

  const pairs = [
    [utf8Bytes, utf8ReplacementBytes],
    [utf16Bytes, utf16ReplacementBytes],
  ];
  let count = 0;

  for (const [bytes, replacementBytes] of pairs) {
    const hexSearch = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
    const hexReplacement = Array.from(replacementBytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
    const lowerMatches = content.split(hexSearch).length - 1;
    const upperMatches = content.split(hexSearch.toUpperCase()).length - 1;
    content = replaceAllText(content, hexSearch, hexReplacement);
    content = replaceAllText(content, hexSearch.toUpperCase(), hexReplacement.toUpperCase());
    count += lowerMatches + upperMatches;
  }

  return { content, count };
}

async function replaceOriginalPdfText(file: File, search: string, replacement: string) {
  if (!search.trim()) throw new Error("请输入要查找的原文字。");
  const { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } = await loadPdfLib();
  const pdf = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  let replacements = 0;

  for (const [ref, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;

    try {
      const decoded = decodePDFRawStream(object).decode();
      const content = new TextDecoder("latin1").decode(decoded);
      const literalResult = replacePdfLiteralStrings(content, search, replacement);
      const hexResult = replacePdfHexStrings(literalResult.content, search, replacement);

      if (hexResult.count > 0 || literalResult.count > 0) {
        replacements += hexResult.count + literalResult.count;
        const stream = pdf.context.flateStream(latin1Bytes(hexResult.content));
        stream.dict.set(PDFName.of("Length"), pdf.context.obj(stream.getContentsSize()));
        pdf.context.assign(ref, stream);
      }
    } catch {
      // Some PDF streams are images, masks, or unsupported encodings. They are skipped.
    }
  }

  if (replacements === 0) {
    throw new Error("没有找到可直接替换的原文字。这个 PDF 可能是扫描件、中文复杂编码，或文字被拆成了特殊字形。");
  }

  const bytes = await pdf.save({ useObjectStreams: true });
  return {
    blob: new Blob([bytes], { type: "application/pdf" }),
    replacements,
  };
}

export default function Toolbox({ initialTool, embedded = false }: { initialTool?: ToolId; embedded?: boolean }) {
  const [activeTool, setActiveTool] = useState<ToolId>(initialTool ?? "compress");
  const [workspaceMode, setWorkspaceMode] = useState(Boolean(initialTool));
  const [demoMode, setDemoMode] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [imagePdfLayout, setImagePdfLayout] = useState(defaultImagePdfLayout);
  const [imagePdfScales, setImagePdfScales] = useState<Map<File, number>>(() => new Map());
  const [quality, setQuality] = useState(76);
  const [maxSide, setMaxSide] = useState(1600);
  const [format, setFormat] = useState("image/webp");
  const [editText, setEditText] = useState("");
  const [editMode, setEditMode] = useState("visual");
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [editPageMode, setEditPageMode] = useState("all");
  const [editPageNumber, setEditPageNumber] = useState(1);
  const [editFontSize, setEditFontSize] = useState(22);
  const [editFontFamily, setEditFontFamily] = useState("system");
  const [editColor, setEditColor] = useState("#111827");
  const [sealFile, setSealFile] = useState<File | null>(null);
  const [sealSide, setSealSide] = useState<SealSide>("right");
  const [sealSize, setSealSize] = useState(168);
  const [sealOffset, setSealOffset] = useState(0);
  const [sealPosition, setSealPosition] = useState(50);
  const [sealOpacity, setSealOpacity] = useState(86);
  const [sealRotation, setSealRotation] = useState(0);
  const [previewUrl, setPreviewUrl] = useState("");
  const [editablePdfUrl, setEditablePdfUrl] = useState("");
  const [previewingOutput, setPreviewingOutput] = useState(false);
  const [visualTexts, setVisualTexts] = useState<VisualText[]>([]);
  const [highlights, setHighlights] = useState<HighlightMark[]>([]);
  const [draftHighlight, setDraftHighlight] = useState<HighlightMark | null>(null);
  const [editorTool, setEditorTool] = useState<EditorTool>("edit-text");
  const [selectedTextId, setSelectedTextId] = useState("");
  // 新增文字的 id：进入行内输入状态，双击已有文字框也会进入。
  const [editingVisualTextId, setEditingVisualTextId] = useState("");
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const [placingText, setPlacingText] = useState(false);
  const [pdfTextBoxes, setPdfTextBoxes] = useState<PdfTextBox[]>([]);
  const [thumbnailUrls, setThumbnailUrls] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1.35);
  const [selectedPdfTextId, setSelectedPdfTextId] = useState("");
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [outputs, setOutputs] = useState<OutputFile[]>([]);
  const [outputPreview, setOutputPreview] = useState<OutputFile | null>(null);
  const draggedFile = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initialTool ? "选择文件后，再点击处理按钮生成文件。" : "文件只在你的浏览器里处理。");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const selectedPdfTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const visualTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const sealInputRef = useRef<HTMLInputElement | null>(null);
  const dragTextRef = useRef<{ id: string; dx: number; dy: number; height: number; moved: boolean } | null>(null);
  const dragPdfTextRef = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const highlightDragRef = useRef<{ xRatio: number; yRatio: number } | null>(null);
  const suppressPdfTextClickRef = useRef(false);
  // 撤销栈：在每次会改变页面内容的操作之前记录一次快照。
  const editorHistoryRef = useRef<{ past: EditorSnapshot[]; future: EditorSnapshot[] }>({ past: [], future: [] });
  // 文字输入的撤销采用“首字符才入栈”：聚焦时先存快照，真正改动时才压栈，
  // 避免点进去又没改产生一次无效撤销。
  const pendingSnapshotRef = useRef<EditorSnapshot | null>(null);
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  // clearOutputs / clearPreview 需要在事件回调里读“最新”的列表来释放 Blob URL，
  // 用 ref 镜像避免在 setState updater 里做副作用。
  const outputsRef = useRef<OutputFile[]>([]);
  const previewUrlRef = useRef("");
  const editablePdfUrlRef = useRef("");

  useEffect(() => {
    outputsRef.current = outputs;
    previewUrlRef.current = previewUrl;
    editablePdfUrlRef.current = editablePdfUrl;
  }, [outputs, previewUrl, editablePdfUrl]);

  useEffect(() => {
    if (selectedPdfTextId && selectedPdfTextAreaRef.current) {
      selectedPdfTextAreaRef.current.focus();
      selectedPdfTextAreaRef.current.select();
    }
  }, [selectedPdfTextId]);

  useEffect(() => {
    const area = visualTextAreaRef.current;
    if (!editingVisualTextId || !area) return;
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  }, [editingVisualTextId]);

  // 清空产物/预览：Blob URL 的释放放在事件回调里做（读 ref 镜像），
  // 不在 setState updater 里产生副作用。
  function clearOutputs() {
    const current = outputsRef.current;
    if (current.length > 0) {
      current.forEach((output) => URL.revokeObjectURL(output.url));
      outputsRef.current = [];
    }
    setOutputPreview(null);
    setOutputs([]);
  }

  function clearPreview() {
    const current = previewUrlRef.current;
    if (current && current === editablePdfUrlRef.current) URL.revokeObjectURL(current);
    previewUrlRef.current = "";
    editablePdfUrlRef.current = "";
    setPreviewUrl("");
    setEditablePdfUrl("");
    setPreviewingOutput(false);
    setThumbnailUrls([]);
  }

  function syncHistoryState() {
    setHistoryState({
      canUndo: editorHistoryRef.current.past.length > 0,
      canRedo: editorHistoryRef.current.future.length > 0,
    });
  }

  // 必须在 setState 之前调用：快照记录的是“操作前”的页面状态。
  function recordHistory() {
    const history = editorHistoryRef.current;
    history.past.push({ pdfTextBoxes, visualTexts, highlights });
    if (history.past.length > 60) history.past.shift();
    history.future.length = 0;
    syncHistoryState();
  }

  // —— 文字输入的撤销采用“首字符才入栈”：聚焦时先存快照，真正改动时才压栈，
  // 避免点进去又没改产生一次无效撤销。刚添加的新文字框例外：它的首次输入
  // 不再单独入栈（recordHistory 存的快照已经覆盖了“添加前”的状态），
  // 这样 ⌘Z 一次就能把整个新文字框撤掉。
  const freshTextNoteRef = useRef(false);
  function beginTextEdit() {
    pendingSnapshotRef.current = { pdfTextBoxes, visualTexts, highlights };
  }
  function commitTextChange() {
    if (freshTextNoteRef.current) {
      // 新文字框的首次输入：不入栈，同时清掉待用快照，防止后续按键把
      // 聚焦时的旧快照误压栈（那会造成要按两次撤销）。
      freshTextNoteRef.current = false;
      pendingSnapshotRef.current = null;
      return;
    }
    const snapshot = pendingSnapshotRef.current;
    if (!snapshot) return;
    pendingSnapshotRef.current = null;
    const history = editorHistoryRef.current;
    history.past.push(snapshot);
    if (history.past.length > 60) history.past.shift();
    history.future.length = 0;
    syncHistoryState();
  }
  function cancelTextEdit() {
    pendingSnapshotRef.current = null;
    freshTextNoteRef.current = false;
  }

  function applySnapshot(snapshot: EditorSnapshot) {
    setPdfTextBoxes(snapshot.pdfTextBoxes);
    setVisualTexts(snapshot.visualTexts);
    setHighlights(snapshot.highlights);
    setSelectedPdfTextId("");
    setSelectedTextId("");
    setEditingVisualTextId("");
    setPlacingText(false);
    clearOutputs();
  }

  function undoEditor() {
    const history = editorHistoryRef.current;
    const previous = history.past.pop();
    if (!previous) return;
    history.future.push({ pdfTextBoxes, visualTexts, highlights });
    applySnapshot(previous);
    syncHistoryState();
    setMessage("已撤销上一步。");
  }

  function redoEditor() {
    const history = editorHistoryRef.current;
    const next = history.future.pop();
    if (!next) return;
    history.past.push({ pdfTextBoxes, visualTexts, highlights });
    applySnapshot(next);
    syncHistoryState();
    setMessage("已重做。");
  }

  useEffect(() => {
    undoRef.current = undoEditor;
    redoRef.current = redoEditor;
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const target = event.target as HTMLElement | null;
      // 输入框里交给浏览器原生撤销，否则会把整段输入一次撤掉。
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)) return;
      event.preventDefault();
      if (key === "y" || event.shiftKey) redoRef.current();
      else undoRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const selectedTool = useMemo(() => tools.find((tool) => tool.id === activeTool) ?? tools[0], [activeTool]);
  const isPdfTool = selectedTool.kind === "pdf";
  const isWordTool = selectedTool.kind === "word";
  const selectedVisualText = visualTexts.find((note) => note.id === selectedTextId);
  const currentTextBoxes = pdfTextBoxes.filter((box) => box.pageNumber === currentPage);
  const selectedPdfText = pdfTextBoxes.find((box) => box.id === selectedPdfTextId);
  const styleFontSize = selectedPdfText ? Math.round(effectivePdfFontSize(selectedPdfText)) : selectedVisualText?.fontSize ?? editFontSize;
  const styleFontFamily = selectedPdfText?.fontFamily ?? selectedVisualText?.fontFamily ?? editFontFamily;
  const styleColor = selectedPdfText ? selectedPdfText.color ?? selectedPdfText.autoColor ?? contrastTextColor(selectedPdfText.backgroundColor) : selectedVisualText?.color ?? editColor;
  const ready = files.length > 0;
  const accept = isWordTool ? ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" : isPdfTool ? "application/pdf,.pdf" : "image/*";
  const isEditorWorkspace = !embedded && (workspaceMode || activeTool === "pdf-edit");

  useEffect(() => {
    let cancelled = false;
    let documentTask: import("pdfjs-dist/legacy/build/pdf.mjs").PDFDocumentLoadingTask | undefined;
    let renderTask: import("pdfjs-dist/legacy/build/pdf.mjs").RenderTask | undefined;
    const abort = new AbortController();

    async function renderPdfPage() {
      if (!previewUrl || activeTool !== "pdf-edit" || editMode !== "visual") return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      try {
        const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
        if (cancelled) return;
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
        const data = await fetch(previewUrl, { signal: abort.signal }).then((response) => response.arrayBuffer());
        if (cancelled) return;
        documentTask = pdfjsLib.getDocument({ data });
        const pdf = await documentTask.promise;
        if (cancelled) return;
        const pageNumber = Math.max(1, Math.min(currentPage, pdf.numPages));
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: zoom });
        const context = canvas.getContext("2d");

        if (!context || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        setCanvasSize({ width: viewport.width, height: viewport.height });
        setPdfPageCount(pdf.numPages);
        renderTask = page.render({ canvas, canvasContext: context, viewport });
        await renderTask.promise;

        if (!previewingOutput && !cancelled) {
          const textContent = await page.getTextContent();
          if (cancelled) return;
          for (const [name, style] of Object.entries(textContent.styles)) {
            const font = page.commonObjs.has(name) ? page.commonObjs.get(name) : undefined;
            if (font?.name) style.fontFamily = font.name.replace(/^[A-Z]{6}\+/, "").replace(/-Regular$/i, "");
          }
          // Merge against the latest edits without making edits a render dependency.
          const detectedBoxes = buildTextBoxes(pdfjsLib, textContent, viewport, pageNumber, []).map(box => {
            const mask = pdfTextMaskRect(box, canvas.width, canvas.height);
            const backgroundColor = pdfTextBackground(canvas, mask);
            return { ...box, backgroundColor, autoColor: pdfTextInkColor(canvas, mask, backgroundColor) };
          });
          setPdfTextBoxes((current) => {
            const nextBoxes = buildTextBoxes(pdfjsLib, textContent, viewport, pageNumber, current).map(box => {
              const detected = detectedBoxes.find(item => item.id === box.id);
              return { ...box, backgroundColor: detected?.backgroundColor, autoColor: box.color ? box.autoColor : detected?.autoColor ?? box.autoColor };
            });
            return [...current.filter((box) => box.pageNumber !== pageNumber), ...nextBoxes];
          });
          setMessage(detectedBoxes.length > 0 ? `第 ${pageNumber} 页识别到 ${detectedBoxes.length} 个可编辑文字块。` : "这一页没有识别到可编辑文字块。");
        }
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "PDF 渲染失败，请换个文件试试。");
      } finally {
        await documentTask?.destroy();
        documentTask = undefined;
      }
    }

    void renderPdfPage();
    return () => {
      cancelled = true;
      abort.abort();
      renderTask?.cancel();
    };
  }, [activeTool, currentPage, editMode, previewUrl, previewingOutput, zoom]);

  useEffect(() => {
    let cancelled = false;
    let documentTask: import("pdfjs-dist/legacy/build/pdf.mjs").PDFDocumentLoadingTask | undefined;
    let renderTask: import("pdfjs-dist/legacy/build/pdf.mjs").RenderTask | undefined;
    const abort = new AbortController();
    const createdUrls: string[] = [];

    async function renderThumbnails() {
      if (!previewUrl || activeTool !== "pdf-edit") {
        setThumbnailUrls([]);
        return;
      }
      setThumbnailUrls([]);
      try {
        const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
        if (cancelled) return;
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
        const data = await fetch(previewUrl, { signal: abort.signal }).then((response) => response.arrayBuffer());
        if (cancelled) return;
        documentTask = pdfjsLib.getDocument({ data });
        const pdf = await documentTask.promise;
        const nextUrls: string[] = [];

        for (let pageNumber = 1; pageNumber <= pdf.numPages && !cancelled; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          if (cancelled) break;
          const viewport = page.getViewport({ scale: 0.22 });
          const canvas = document.createElement("canvas");
          try {
            const context = canvas.getContext("2d");
            if (!context) continue;
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            renderTask = page.render({ canvas, canvasContext: context, viewport });
            await renderTask.promise;
            const blob = await blobFromCanvas(canvas, "image/jpeg", 0.72);
            if (cancelled) break;
            const url = URL.createObjectURL(blob);
            createdUrls.push(url);
            nextUrls.push(url);
          } finally {
            canvas.width = canvas.height = 0;
            page.cleanup();
          }
        }

        if (!cancelled) setThumbnailUrls(nextUrls);
      } catch {
        if (!cancelled) setThumbnailUrls([]);
      } finally {
        await documentTask?.destroy();
        documentTask = undefined;
      }
    }

    void renderThumbnails();
    return () => {
      cancelled = true;
      abort.abort();
      renderTask?.cancel();
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [activeTool, previewUrl]);

  function updateOutputName(url: string, name: string) {
    setOutputs((current) => current.map((output) => (output.url === url ? { ...output, name } : output)));
  }

  function previewOutputFile(output: OutputFile) {
    setOutputPreview(output);
  }

  function moveFile(from: number, to: number) {
    if (busy || from === to || from < 0 || to < 0 || from >= files.length || to >= files.length) return;
    setFiles(current => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    clearOutputs();
    setMessage("文件顺序已调整，接下来将按列表顺序处理。");
  }

  function cancelOutputPreview() {
    let nextUrl = editablePdfUrl;
    if (!nextUrl && files[0]) {
      nextUrl = URL.createObjectURL(files[0]);
      setEditablePdfUrl(nextUrl);
    }
    if (!nextUrl) return;
    setPreviewUrl(nextUrl);
    setPreviewingOutput(false);
    setEditorTool("edit-text");
    setSelectedPdfTextId("");
    setSelectedTextId("");
    setPlacingText(false);
    setCurrentPage(1);
    setMessage("已回到可编辑状态，可以继续修改。");
  }

  function startTextPlacement() {
    if (!previewUrl || previewingOutput) return;
    setPlacingText(true);
    setEditorTool("add-text");
    setSelectedPdfTextId("");
    setSelectedTextId("");
    setEditMode("visual");
    setMessage("请在左侧 PDF 页面上点击要放置文字的位置。");
  }

  function stopTextPlacement() {
    setPlacingText(false);
    setEditorTool("edit-text");
    setMessage("已取消添加文字。");
  }

  async function saveOutputFile(output: OutputFile) {
    const fileName = output.name.trim() || "download";
    const windowWithPicker = window as Window & {
      showSaveFilePicker?: (options?: {
        suggestedName?: string;
        types?: Array<{
          description: string;
          accept: Record<string, string[]>;
        }>;
      }) => Promise<{
        createWritable: () => Promise<{
          write: (data: Blob) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    };

    if (windowWithPicker.showSaveFilePicker) {
      try {
        const extension = fileName.includes(".") ? `.${fileName.split(".").pop()}` : "";
        const mimeType = output.blob.type || "application/octet-stream";
        const handle = await windowWithPicker.showSaveFilePicker({
          suggestedName: fileName,
          types: extension
            ? [
                {
                  description: "处理后的文件",
                  accept: { [mimeType]: [extension] },
                },
              ]
            : undefined,
        });
        const writable = await handle.createWritable();
        await writable.write(output.blob);
        await writable.close();
        track("save_complete", activeTool, demoMode);
        setMessage(`已保存：${fileName}`);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setMessage("已取消保存。");
          return;
        }
        setMessage("当前浏览器不能选择保存路径，已切换为手动下载。");
      }
    }

    const link = document.createElement("a");
    link.href = output.url;
    link.download = fileName;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    track("download_requested", activeTool, demoMode);
    link.remove();
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    setFiles(picked);
    setDemoMode(false);
    if (picked.length) track("files_selected", activeTool, false);
    setImagePdfScales(new Map());
    clearOutputs();
    clearPreview();
    setVisualTexts([]);
    setHighlights([]);
    setDraftHighlight(null);
    setEditorTool("edit-text");
    if (activeTool !== "pdf-seal" && activeTool !== "word-seal") setSealFile(null);
    setSelectedTextId("");
    setPlacingText(false);
    setPdfTextBoxes([]);
    setSelectedPdfTextId("");
    setPdfPageCount(0);
    setCurrentPage(1);
    setZoom(1.35);
    if (picked.length > 0 && selectedTool.kind === "pdf") {
      const nextUrl = URL.createObjectURL(picked[0]);
      setEditablePdfUrl(nextUrl);
      setPreviewUrl(nextUrl);
      setPreviewingOutput(false);
    }
    setMessage(
      picked.length
        ? activeTool === "pdf-edit"
          ? "PDF 已打开。点击预览区域添加文字，或切换到原文替换模式。"
          : activeTool === "pdf-seal"
            ? `已选择 ${picked.length} 份 PDF 合同。请继续上传合同章图片并调整骑缝章参数。`
            : activeTool === "word-seal"
              ? `已选择 ${picked.length} 份 Word 合同。请继续上传合同章图片，系统会逐份转成 PDF 再盖骑缝章。`
          : `已选择 ${picked.length} 个文件，请点击下方按钮开始处理。`
        : "文件只在你的浏览器里处理。",
    );
  }

  function selectTool(toolId: ToolId) {
    setActiveTool(toolId);
    setWorkspaceMode(true);
    setFiles([]);
    setImagePdfScales(new Map());
    setSealFile(null);
    clearOutputs();
    clearPreview();
    setVisualTexts([]);
    setHighlights([]);
    setDraftHighlight(null);
    setEditorTool("edit-text");
    setSelectedTextId("");
    setPlacingText(false);
    setPdfTextBoxes([]);
    setSelectedPdfTextId("");
    setPdfPageCount(0);
    setCurrentPage(1);
    setZoom(1.35);
    setMessage("选择文件后，再点击处理按钮生成下载文件。");
  }

  function toolKindLabel(kind: ToolKind) {
    if (kind === "pdf") return "PDF";
    if (kind === "word") return "DOC";
    return "IMG";
  }

  function openToolWorkspace(toolId: ToolId) {
    const url = `${window.location.origin}/?tool=${toolId}`;
    const width = window.screen.availWidth || 1440;
    const height = window.screen.availHeight || 900;
    const opened = window.open(url, "_blank", `popup=yes,width=${width},height=${height},left=0,top=0,resizable=yes,scrollbars=yes`);
    if (opened) {
      opened.moveTo?.(0, 0);
      opened.resizeTo?.(width, height);
      opened.focus();
      return;
    }
    window.location.assign(url);
  }

  function handleSealFile(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null;
    setSealFile(picked);
    setMessage(picked ? "合同章图片已选择，请调整参数后生成骑缝章 PDF。" : "请上传合同章图片。");
  }

  function addVisualText(event: React.MouseEvent<HTMLDivElement>) {
    if (!previewUrl || activeTool !== "pdf-edit" || editMode !== "visual" || !placingText) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const note: VisualText = {
      id: crypto.randomUUID(),
      text: editText,
      xRatio: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      yRatio: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      pageMode: editPageMode,
      pageNumber: editPageNumber,
      fontSize: editFontSize,
      fontFamily: editFontFamily,
      color: editColor,
      clarity: 100,
    };
    recordHistory();
    setVisualTexts((current) => [...current, note]);
    setSelectedTextId(note.id);
    setSelectedPdfTextId("");
    // 落点即进入输入状态：不用再点一次才能打字。
    // 标记为新文字框：首次输入不再单独压撤销栈，⌘Z 一次撤掉整个框。
    freshTextNoteRef.current = true;
    setEditingVisualTextId(note.id);
    setEditText("");
    setPlacingText(false);
    setEditorTool("edit-text");
    setMessage("文字框已放好，直接输入内容；按 Esc 或点击空白处结束，⌘/Ctrl+Z 可撤销。");
  }

  function updateVisualTextText(id: string, text: string) {
    setVisualTexts((current) => current.map((note) => (note.id === id ? { ...note, text } : note)));
  }

  function finishVisualTextEditing(id: string) {
    const wasFresh = freshTextNoteRef.current;
    cancelTextEdit();
    setEditingVisualTextId((current) => (current === id ? "" : current));
    const note = visualTexts.find((item) => item.id === id);
    if (note && !note.text.trim()) {
      // 空文字框不留在页面上，否则导出一个看不见的空对象。
      // 如果这个框是刚添加的（撤销栈顶还存着它的“添加前”快照），一并弹出，
      // 避免留下一次什么都没变的撤销步骤。
      if (wasFresh) editorHistoryRef.current.past.pop();
      syncHistoryState();
      setVisualTexts((current) => current.filter((item) => item.id !== id));
      setSelectedTextId((current) => (current === id ? "" : current));
    }
  }

  function startHighlight(event: React.PointerEvent<HTMLDivElement>) {
    if (!previewUrl || previewingOutput || editorTool !== "highlight") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const xRatio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const yRatio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    event.currentTarget.setPointerCapture(event.pointerId);
    highlightDragRef.current = { xRatio, yRatio };
    setSelectedPdfTextId("");
    setSelectedTextId("");
    setDraftHighlight({
      id: "draft-highlight",
      pageNumber: currentPage,
      xRatio,
      yRatio,
      widthRatio: 0,
      heightRatio: 0,
      color: "#fff200",
    });
  }

  function moveHighlight(event: React.PointerEvent<HTMLDivElement>) {
    const start = highlightDragRef.current;
    if (!start || editorTool !== "highlight") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const xRatio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const yRatio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    setDraftHighlight({
      id: "draft-highlight",
      pageNumber: currentPage,
      xRatio: Math.min(start.xRatio, xRatio),
      yRatio: Math.min(start.yRatio, yRatio),
      widthRatio: Math.abs(xRatio - start.xRatio),
      heightRatio: Math.abs(yRatio - start.yRatio),
      color: "#fff200",
    });
  }

  function finishHighlight(event: React.PointerEvent<HTMLDivElement>) {
    const draft = draftHighlight;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    highlightDragRef.current = null;
    setDraftHighlight(null);
    if (!draft || draft.widthRatio < 0.01 || draft.heightRatio < 0.006) return;
    recordHistory();
    setHighlights((current) => [...current, { ...draft, id: crypto.randomUUID() }]);
    setMessage("已添加高亮标记。");
  }

  function updateSelectedText(updates: Partial<VisualText>) {
    setVisualTexts((current) => current.map((note) => (note.id === selectedTextId ? { ...note, ...updates } : note)));
  }

  function moveVisualText(id: string, xRatio: number, yRatio: number) {
    setVisualTexts((current) =>
      current.map((note) =>
        note.id === id
          ? {
              ...note,
              xRatio: Math.max(0, Math.min(1, xRatio)),
              yRatio: Math.max(0, Math.min(1, yRatio)),
            }
          : note,
      ),
    );
  }

  function removeSelectedText() {
    if (!selectedTextId) return;
    recordHistory();
    setVisualTexts((current) => current.filter((note) => note.id !== selectedTextId));
    setSelectedTextId("");
    clearOutputs();
    setMessage("已删除选中的文字标记。");
  }

  function deleteSelectedPdfText() {
    if (!selectedPdfTextId) return;
    recordHistory();
    setPdfTextBoxes(current => current.map(box => box.id === selectedPdfTextId ? { ...box, deleted: true } : box));
    setSelectedPdfTextId("");
    clearOutputs();
    setMessage("已删除整个文字块。保存 PDF 后生效；可恢复已删除文字块。");
  }

  function finishPdfTextEditing(id: string) {
    setPdfTextBoxes(current => current.map(box => box.id === id && !box.text.trim() ? { ...box, deleted: true } : box));
    if (!pdfTextBoxes.find(box => box.id === id)?.text.trim()) setSelectedPdfTextId(current => current === id ? "" : current);
  }

  function updateSelectedPdfText(text: string) {
    setPdfTextBoxes((current) => current.map((box) => (box.id === selectedPdfTextId ? { ...box, text } : box)));
  }

  function updateTextStyle(updates: { fontSize?: number; fontFamily?: string; clarity?: number; color?: string }) {
    if (selectedPdfTextId) {
      setPdfTextBoxes((current) =>
        current.map((box) =>
          box.id === selectedPdfTextId
            ? {
                ...box,
                editedFontSize: updates.fontSize ?? box.editedFontSize,
                fontFamily: updates.fontFamily ?? box.fontFamily,
                clarity: updates.clarity ?? box.clarity,
                color: updates.color ?? box.color,
              }
            : box,
        ),
      );
    }

    if (selectedTextId) {
      setVisualTexts((current) =>
        current.map((note) =>
          note.id === selectedTextId
            ? {
                ...note,
                fontSize: updates.fontSize ?? note.fontSize,
                fontFamily: updates.fontFamily ?? note.fontFamily,
                clarity: updates.clarity ?? note.clarity,
                color: updates.color ?? note.color,
              }
            : note,
        ),
      );
    }
  }

  function movePdfTextBox(id: string, xRatio: number, yRatio: number) {
    const original = pdfTextBoxes.find(box => box.id === id);
    const targetBackground = original ? pdfTextBackground(canvasRef.current, pdfTextMaskRect({ ...original, xRatio, yRatio }, canvasSize.width, canvasSize.height)) : undefined;
    setPdfTextBoxes((current) =>
      current.map((box) =>
        box.id === id
          ? {
              ...box,
              // 原字色是文字自身的属性，拖到新位置不应被重算覆盖；
              // 只有从未检测过（新增框）时才按新背景反推。
              autoColor: box.autoColor ?? contrastTextColor(targetBackground),
              editXRatio: Math.max(0, Math.min(0.98, xRatio)),
              editYRatio: Math.max(0, Math.min(0.98, yRatio)),
            }
          : box,
      ),
    );
  }

  async function loadSealDemo() {
    setDemoLoading(true);
    try {
      const { PDFDocument } = await loadPdfLib();
      const sampleFiles: File[] = [];
      for (const count of [3, 5]) {
        const pdf = await PDFDocument.create();
        for (let page = 1; page <= count; page++) {
          const sheet = pdf.addPage([595, 842]);
          sheet.drawText("PDFIRST / SAMPLE DOCUMENT", { x: 55, y: 760, size: 22 });
          sheet.drawText("DEMO ONLY - No real contract or company information", { x: 55, y: 715, size: 12 });
          sheet.drawText(`Document: ${count} pages / Page ${page}`, { x: 55, y: 670, size: 14 });
          sheet.drawText("Check the seal slice at the page edge after processing.", { x: 55, y: 620, size: 12 });
        }
        sampleFiles.push(new File([new Uint8Array(await pdf.save())], `示例-${count}页.pdf`, { type: "application/pdf" }));
      }
      const canvas = document.createElement("canvas");
      canvas.width = 240; canvas.height = 160;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("当前浏览器无法创建示例章图。");
      context.strokeStyle = "#c53030"; context.lineWidth = 7;
      context.strokeRect(8, 8, 224, 144);
      context.fillStyle = "#c53030"; context.textAlign = "center";
      context.font = "bold 48px sans-serif"; context.fillText("DEMO", 120, 82);
      context.font = "20px sans-serif"; context.fillText("仅供演示", 120, 123);
      const stamp = await blobFromCanvas(canvas, "image/png", 1);
      clearOutputs(); clearPreview();
      setFiles(sampleFiles); setSealFile(new File([stamp], "DEMO-示例章.png", { type: "image/png" }));
      setSealSide("right"); setSealSize(168); setSealOffset(0); setSealPosition(50); setSealOpacity(86); setSealRotation(0);
      setDemoMode(true); track("demo_loaded", "pdf-seal", true);
      setMessage("已准备 3 页和 5 页示例文档及 DEMO 章图。点击下方生成按钮，再逐页预览效果。");
    } catch {
      setMessage("示例准备失败，请重新尝试，或选择自己的 PDF 与章图。");
    } finally { setDemoLoading(false); }
  }

  async function processFiles() {
    if (!ready) return;
    setBusy(true);
    track("process_start", activeTool, demoMode);
    clearOutputs();

    try {
      if (activeTool === "image-pdf") {
        setMessage(`正在将 ${files.length} 张图片合成 PDF，请稍候…`);
        const pdf = await imagesToPdf(files, Math.max(320, Math.min(4000, maxSide || 1600)), quality, imagePdfLayout, imagePdfScales);
        setOutputs([{ name: "images.pdf", size: pdf.size, url: URL.createObjectURL(pdf), blob: pdf }]);
        setMessage(`已生成 images.pdf（${Math.ceil(files.length / pageGeometry(imagePdfLayout).perPage)} 页）。请在下方点击“预览”查看，或点击“下载 PDF”保存到设备。`);
        return;
      }

      if (activeTool === "pdf-merge") {
        const pdf = await mergePdfs(files);
        setOutputs([{ name: "merged.pdf", size: pdf.size, url: URL.createObjectURL(pdf), blob: pdf }]);
        setMessage("PDF 已合并。可先改文件名，再手动保存。");
        return;
      }

      if (activeTool === "pdf-split") {
        const splitOutputs = await splitPdf(files);
        setOutputs(splitOutputs);
        setMessage(`已拆分成 ${splitOutputs.length} 个页面文件。`);
        return;
      }

      if (activeTool === "pdf-compress") {
        const pdf = await optimizePdf(files[0]);
        setOutputs([{ name: `${fileBaseName(files[0].name)}-optimized.pdf`, size: pdf.size, url: URL.createObjectURL(pdf), blob: pdf }]);
        setMessage("PDF 已重新优化结构。可先改文件名，再手动保存。扫描件深度压缩需要下一阶段服务端引擎。");
        return;
      }

      if (activeTool === "pdf-word") {
        const { blob: docx, reviewPages } = await pdfToWord(files[0], setMessage);
        const output = new Blob([docx], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
        setOutputs([{ name: `${fileBaseName(files[0].name)}.docx`, size: output.size, url: URL.createObjectURL(output), blob: output }]);
        setMessage(`可编辑 Word 已生成，请核对识别文字。${reviewPages.length ? `第 ${reviewPages.join("、")} 页识别置信度较低或未识别到文字，请重点核对原件。` : ""}`);
        return;
      }

      if (activeTool === "pdf-seal") {
        if (!sealFile) throw new Error("请先上传合同章图片，建议使用透明 PNG。");
        const sealedOutputs: OutputFile[] = [];
        let failedCount = 0;
        for (let index = 0; index < files.length; index += 1) {
          const file = files[index];
          setMessage(`正在为第 ${index + 1} / ${files.length} 份 PDF 合同盖骑缝章...`);
          try {
            const pdf = await addSeamSealToPdf(file, sealFile, {
              side: sealSide,
              size: sealSize,
              offset: sealOffset,
              position: sealPosition,
              opacity: sealOpacity,
              rotation: sealRotation,
            });
            sealedOutputs.push({ name: `${fileBaseName(file.name)}-seam-seal.pdf`, size: pdf.size, url: URL.createObjectURL(pdf), blob: pdf });
          } catch {
            failedCount += 1;
          }
        }
        if (sealedOutputs.length === 0) throw new Error("没有合同完成盖章，请确认文件未加密、没有损坏，并重新选择后再试。");
        setOutputs(sealedOutputs);
        track("process_complete", activeTool, demoMode);
        setMessage(`已为 ${sealedOutputs.length} 份 PDF 合同生成骑缝章${failedCount ? `，${failedCount} 份未能处理` : ""}。每份文件都可单独预览、重命名和保存。`);
        return;
      }

      if (activeTool === "word-seal") {
        if (!sealFile) throw new Error("请先上传合同章图片，建议使用透明 PNG。");
        const sealedOutputs: OutputFile[] = [];
        let failedCount = 0;
        for (let index = 0; index < files.length; index += 1) {
          const file = files[index];
          setMessage(`正在处理第 ${index + 1} / ${files.length} 份 Word 合同...`);
          try {
            const convertedPdf = await docxToPdf(file);
            const pdf = await addSeamSealToPdf(convertedPdf, sealFile, {
              side: sealSide,
              size: sealSize,
              offset: sealOffset,
              position: sealPosition,
              opacity: sealOpacity,
              rotation: sealRotation,
            });
            sealedOutputs.push({ name: `${fileBaseName(file.name)}-word-seam-seal.pdf`, size: pdf.size, url: URL.createObjectURL(pdf), blob: pdf });
          } catch {
            failedCount += 1;
          }
        }
        if (sealedOutputs.length === 0) throw new Error("没有合同完成盖章，请确认文件是可读取的 .docx 格式，并重新选择后再试。");
        setOutputs(sealedOutputs);
        setMessage(`已将 ${sealedOutputs.length} 份 Word 合同转成 PDF 并加上骑缝章${failedCount ? `，${failedCount} 份未能处理` : ""}。每份文件都可单独预览、重命名和保存。`);
        return;
      }

      if (activeTool === "pdf-edit") {
        if (editMode === "visual") {
          const editedTextBoxes = pdfTextBoxes.filter(isPdfTextEdited);
          const pdf = await saveVisualEditorPdf(files[0], pdfTextBoxes, visualTexts, highlights);
          const outputUrl = URL.createObjectURL(pdf);
          setOutputs([{ name: `${fileBaseName(files[0].name)}-visual-edited.pdf`, size: pdf.size, url: outputUrl, blob: pdf }]);
          setMessage(editedTextBoxes.length > 0 ? "文字块编辑已生成。左侧仍可继续修改；需要查看最终文件时点下方预览。" : "PDF 已生成。左侧仍可继续修改；需要查看最终文件时点下方预览。");
          return;
        }

        if (editMode === "replace") {
          const result = await replaceOriginalPdfText(files[0], findText, replaceText);
          const outputUrl = URL.createObjectURL(result.blob);
          setOutputs([{ name: `${fileBaseName(files[0].name)}-text-edited.pdf`, size: result.blob.size, url: outputUrl, blob: result.blob }]);
          clearPreview();
          setPreviewUrl(outputUrl);
          setMessage(`已替换 ${result.replacements} 处原文。可先改文件名，再手动保存。`);
          return;
        }

        const pdf = await editPdf(files[0], {
          text: editText.trim() || "Reviewed",
          pageMode: editPageMode,
          pageNumber: editPageNumber,
          fontSize: editFontSize,
        });
        const outputUrl = URL.createObjectURL(pdf);
        setOutputs([{ name: `${fileBaseName(files[0].name)}-edited.pdf`, size: pdf.size, url: outputUrl, blob: pdf }]);
        clearPreview();
        setPreviewUrl(outputUrl);
        setMessage("PDF 已添加文字。可先改文件名，再手动保存。");
        return;
      }

      const nextOutputs: OutputFile[] = [];
      for (const file of files) {
        const canvas = await drawImage(file, maxSide, format === "image/png" ? "transparent" : "#ffffff");
        const type = activeTool === "compress" ? file.type || "image/jpeg" : format;
        const blob = await blobFromCanvas(canvas, type, quality / 100);
        const extension = type.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
        nextOutputs.push({
          name: `${fileBaseName(file.name)}.${extension}`,
          size: blob.size,
          url: URL.createObjectURL(blob),
          blob,
        });
      }
      setOutputs(nextOutputs);
      setMessage(`处理完成：${nextOutputs.length} 个文件。可先改文件名，再手动保存。`);
    } catch (error) {
      track("process_error", activeTool, demoMode);
      setMessage(error instanceof Error ? error.message : "处理失败，请换个文件试试。");
    } finally {
      setBusy(false);
    }
  }

  if (!workspaceMode) {
    return (
      <div className="bg-[#f7f4ee] text-[#18201f]">
        <section className="mx-auto max-w-7xl px-5 py-5 lg:px-8" id="tools">
          <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-end">
            <div>
              <h1 className="text-2xl font-black">工具列表</h1>
            </div>
            <div className="flex gap-2">
              <span className="rounded bg-[#1f6f67] px-3 py-1 text-sm font-black text-white">图片</span>
              <span className="rounded bg-[#18201f] px-3 py-1 text-sm font-black text-white">PDF</span>
              <span className="rounded bg-[#f0b35a] px-3 py-1 text-sm font-black text-[#3a2404]">Word</span>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {tools.map((tool) => (
              <button
                className={`min-h-40 rounded border p-4 text-left transition hover:bg-white hover:shadow-sm ${
                  tool.featured
                    ? "border-[#1f6f67] bg-[#eef7f4] shadow-sm hover:border-[#15524c]"
                    : "border-[#d8d1c3] bg-[#fbfaf6] hover:border-[#1f6f67]"
                }`}
                key={tool.id}
                onClick={() => {
                  const path = ({ "pdf-merge": "/pdf-merge", compress: "/image-compress", "pdf-seal": "/pdf-seal" } as Partial<Record<ToolId, string>>)[tool.id];
                  if (path) window.location.assign(path);
                  else openToolWorkspace(tool.id);
                }}
                type="button"
              >
                <div className="mb-5 flex items-center justify-between">
                  <span className="text-xs font-black uppercase text-[#1f6f67]">{tool.kind}</span>
                  {tool.featured ? (
                    <span
                      aria-label="推荐工具"
                      className="grid h-8 w-8 place-items-center rounded-full bg-[#1f6f67] text-base"
                      title="推荐工具"
                    >
                      👍
                    </span>
                  ) : (
                    <span className="rounded bg-[#e7f0ce] px-2 py-1 text-xs font-bold text-[#3d5621]">{tool.tag}</span>
                  )}
                </div>
                <h3 className="mb-3 text-xl font-black">{tool.title}</h3>
                <p className="text-sm leading-6 text-[#66706c]">{tool.description}</p>
              </button>
            ))}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={`${embedded ? "" : "min-h-screen"} bg-[#f7f4ee] text-[#18201f]`}>
      <section className={`border-b border-[#d8d1c3] ${isEditorWorkspace ? "bg-[#eef2f7]" : "bg-[#fbfaf6]"}`}>
        <div className={embedded ? "mx-auto max-w-5xl px-5 py-6" : isEditorWorkspace ? "mx-auto grid min-h-screen max-w-none gap-0 px-0 py-0 lg:grid-cols-[104px_minmax(0,1fr)]" : "mx-auto grid max-w-7xl gap-8 px-5 py-8 lg:grid-cols-[0.9fr_1.1fr] lg:px-8"}>
          {isEditorWorkspace && (
            <aside className="hidden border-r border-[#163461] bg-[#08245a] px-3 py-4 text-white lg:block">
              <div className="mb-5 grid h-16 place-items-center rounded bg-white/10 text-lg font-black">轻</div>
              <div className="grid gap-2">
                {tools.map((tool) => (
                  <button
                    className={`grid min-h-20 place-items-center rounded px-2 py-3 text-center text-sm font-black transition ${
                      activeTool === tool.id ? "bg-[#355fa8] text-white" : "text-white/86 hover:bg-white/10"
                    }`}
                    key={tool.id}
                    onClick={() => selectTool(tool.id)}
                    type="button"
                  >
                    <span className="text-xl">{toolKindLabel(tool.kind)}</span>
                    <span>{tool.title.replace("PDF ", "").replace("图片", "")}</span>
                  </button>
                ))}
              </div>
            </aside>
          )}

          <div className={embedded || isEditorWorkspace ? "hidden" : "flex flex-col justify-between gap-8"}>
            <header className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 shrink-0 rounded bg-[url(/favicon.svg)] bg-cover" aria-hidden="true" />
                <div>
                  <p className="text-sm text-[#66706c]">PDF + Image Toolkit</p>
                  <h1 className="text-2xl font-black tracking-normal">轻文档工具箱</h1>
                </div>
              </div>
              <a className="rounded border border-[#18201f] px-4 py-2 text-sm font-bold" href="#tools">
                工具列表
              </a>
            </header>

            <div className="max-w-2xl">
              <p className="mb-4 inline-flex rounded bg-[#e7f0ce] px-3 py-1 text-sm font-bold text-[#3d5621]">PDF 核心功能已接入浏览器处理</p>
              <h2 className="text-5xl font-black leading-tight tracking-normal md:text-6xl">
                在线打开 PDF，编辑后保存。
              </h2>
              <p className="mt-5 max-w-xl text-lg leading-8 text-[#4f5a55]">
                支持在页面内预览 PDF，替换文本型 PDF 的可识别原文，或添加批注文字后保存下载。
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="border-t border-[#cfc6b7] pt-3">
                <strong className="block text-2xl">10</strong>
                <span className="text-[#66706c]">可用工具</span>
              </div>
              <div className="border-t border-[#cfc6b7] pt-3">
                <strong className="block text-2xl">0</strong>
                <span className="text-[#66706c]">服务器留存</span>
              </div>
              <div className="border-t border-[#cfc6b7] pt-3">
                <strong className="block text-2xl">2</strong>
                <span className="text-[#66706c]">编辑模式</span>
              </div>
            </div>
          </div>

          <div className={isEditorWorkspace ? "min-w-0 bg-white p-0" : "rounded border border-[#cfc6b7] bg-white p-4 shadow-sm"}>
            <div className={isEditorWorkspace ? "flex min-h-16 items-center justify-between gap-4 border-b border-[#d7dde8] bg-white px-4 py-3" : "mb-4 flex items-center justify-between gap-4 border-b border-[#ebe5da] pb-3"}>
              <div>
                <h3 className="font-black">{workspaceMode ? selectedTool.title : "在线处理台"}</h3>
                <p className="text-sm text-[#66706c]">{selectedTool.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {workspaceMode && !embedded && (
                  <button className="rounded border border-[#cfc6b7] px-3 py-2 text-xs font-black text-[#18201f] hover:border-[#1f6f67]" onClick={() => window.close()} type="button">
                    关闭窗口
                  </button>
                )}
                <span className="rounded bg-[#f0b35a] px-3 py-1 text-xs font-black text-[#3a2404]">可用</span>
              </div>
            </div>

            {activeTool === "pdf-seal" && <div className="mb-4 rounded border border-[#cfc6b7] bg-[#f7f4ee] p-4"><strong>先看效果，再处理自己的合同</strong><p className="my-2 text-sm">准备两份虚构文档和 DEMO 章图，体验批量生成与逐页预览。示例会替换当前所选文件。</p><button type="button" disabled={busy || demoLoading} className="rounded bg-[#1f6f67] px-4 py-2 font-bold text-white disabled:opacity-50" onClick={loadSealDemo}>{demoLoading ? "正在准备示例…" : "用示例试试（3 页 + 5 页）"}</button></div>}

            <div className={isEditorWorkspace ? "grid min-h-[calc(100vh-65px)] gap-0 xl:grid-cols-[minmax(0,1fr)_340px]" : ""}>
              <div className="min-w-0">
                {activeTool !== "pdf-edit" && (
                  <label
                    aria-label={activeTool === "pdf-seal" ? "选择 PDF 合同文件" : activeTool === "word-seal" ? "选择 Word 合同文件" : isWordTool ? "选择 Word 文件" : isPdfTool ? "选择 PDF 文件" : "选择图片文件"}
                    className={`grid min-h-44 cursor-pointer place-items-center rounded border-2 border-dashed p-6 text-center transition hover:border-[#1f6f67] ${
                      files.length > 0 ? "border-[#1f6f67] bg-[#eef7f4]" : "border-[#b9afa0] bg-[#fbfaf6]"
                    }`}
                  >
                    <input aria-label={activeTool === "pdf-seal" ? "选择 PDF 合同文件" : activeTool === "word-seal" ? "选择 Word 合同文件" : isWordTool ? "选择 Word 文件" : isPdfTool ? "选择 PDF 文件" : "选择图片文件"} className="sr-only" disabled={busy} multiple={activeTool !== "pdf-compress" && activeTool !== "pdf-edit"} type="file" accept={accept} onChange={handleFiles} />
                    <span>
                      <strong className="block text-xl">{files.length > 0 ? `已选择 ${files.length} 个文件` : activeTool === "pdf-seal" ? "选择 PDF 合同" : activeTool === "word-seal" ? "选择 Word 合同" : isWordTool ? "选择 Word 文件" : isPdfTool ? "选择 PDF 文件" : "选择图片文件"}</strong>
                      <span className="mt-2 block text-sm text-[#66706c]">
                        {files.length > 0 ? "可以继续点这里重新选择" : activeTool === "pdf-seal" ? "支持一次选择多份 PDF 合同，统一盖同一枚骑缝章" : activeTool === "word-seal" ? "支持一次选择多份 .docx 合同，统一转 PDF 后盖同一枚骑缝章" : isWordTool ? "支持 .docx 文件，先转成 PDF 再盖骑缝章" : isPdfTool ? "支持 PDF 文件，当前仍在浏览器本地处理" : "支持批量选择，当前不上云处理"}
                      </span>
                    </span>
                  </label>
                )}

                {activeTool === "pdf-edit" && (
                  <div className="overflow-hidden bg-[#252a29]">
                    {previewUrl ? (
                      <div>
                        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-[#f7f4ee] px-3 py-3 text-sm">
                          <label className="cursor-pointer rounded border border-[#cfc6b7] bg-white px-3 py-2 font-black text-[#18201f] hover:border-[#1f6f67]">
                            重新上传
                            <input className="sr-only" type="file" accept={accept} onChange={handleFiles} />
                          </label>
                          <button
                            className={`rounded px-3 py-2 font-black ${editorTool === "select" && !previewingOutput ? "bg-[#1f6f67] text-white" : "border border-[#cfc6b7] bg-white text-[#18201f]"}`}
                            disabled={previewingOutput}
                            onClick={() => {
                              setEditorTool("select");
                              setPlacingText(false);
                              setSelectedTextId("");
                              setSelectedPdfTextId("");
                              setMessage("已切换为选择模式。");
                            }}
                            type="button"
                          >
                            选择
                          </button>
                          <button
                            className={`rounded px-3 py-2 font-black ${editorTool === "edit-text" && !previewingOutput ? "bg-[#1f6f67] text-white" : "border border-[#cfc6b7] bg-white text-[#18201f]"}`}
                            disabled={previewingOutput}
                            onClick={() => {
                              setEditorTool("edit-text");
                              setPlacingText(false);
                              setSelectedTextId("");
                              setEditMode("visual");
                              setMessage("点击页面文字即可直接编辑。");
                            }}
                            type="button"
                          >
                            编辑文字
                          </button>
                          <button
                            className={`rounded px-3 py-2 font-black ${editorTool === "add-text" ? "bg-[#f0b35a] text-[#3a2404]" : "border border-[#cfc6b7] bg-white text-[#18201f]"}`}
                            disabled={previewingOutput}
                            onClick={placingText ? stopTextPlacement : startTextPlacement}
                            type="button"
                          >
                            {placingText ? "取消添加" : "添加文字"}
                          </button>
                          <button
                            className={`rounded px-3 py-2 font-black ${editorTool === "highlight" ? "bg-[#fff200] text-[#18201f]" : "border border-[#cfc6b7] bg-white text-[#18201f]"}`}
                            disabled={previewingOutput}
                            onClick={() => {
                              setEditorTool("highlight");
                              setPlacingText(false);
                              setSelectedTextId("");
                              setSelectedPdfTextId("");
                              setMessage("拖拽页面区域即可添加高亮。");
                            }}
                            type="button"
                          >
                            高亮
                          </button>
                          <button type="button" disabled={previewingOutput || (!selectedPdfTextId && !selectedTextId)}
                            className="rounded border border-red-300 px-3 py-2 font-bold text-red-700 disabled:opacity-40"
                            onMouseDown={event => event.preventDefault()}
                            onClick={() => selectedPdfTextId ? deleteSelectedPdfText() : removeSelectedText()}>删除文字框</button>
                          <select
                            className="rounded border border-[#cfc6b7] bg-white px-3 py-2 font-bold disabled:opacity-50"
                            disabled={previewingOutput}
                            value={styleFontFamily}
                            onChange={(event) => {
                              setEditFontFamily(event.target.value);
                              updateTextStyle({ fontFamily: event.target.value });
                            }}
                          >
                            {fontOptions.map((font) => (
                              <option key={font.value} value={font.value}>
                                {font.label}
                              </option>
                            ))}
                          </select>
                          <label className="flex items-center gap-2 rounded border border-[#cfc6b7] bg-white px-3 py-2 font-bold">
                            字号
                            <input
                              className="w-16 bg-transparent outline-none disabled:opacity-50"
                              disabled={previewingOutput}
                              max="72"
                              min="8"
                              type="number"
                              value={styleFontSize}
                              onChange={(event) => {
                                const nextSize = Math.max(8, Math.min(72, Number(event.target.value) || 8));
                                setEditFontSize(nextSize);
                                updateTextStyle({ fontSize: nextSize });
                              }}
                            />
                          </label>
                          <button
                            className="ml-auto rounded bg-[#1f6f67] px-4 py-2 font-black text-white disabled:bg-[#a5aaa6]"
                            disabled={!ready || busy || previewingOutput}
                            onClick={processFiles}
                            type="button"
                          >
                            {busy ? "保存中..." : outputs.length > 0 ? "重新保存" : "保存 PDF"}
                          </button>
                        </div>
                        {activeTool === "pdf-edit" && outputs.length > 0 && (
                          <div className="flex flex-wrap items-center gap-2 rounded border border-[#1f6f67] bg-[#eef7f4] px-3 py-2">
                            <span className="text-sm font-black text-[#15534d]">已生成，可以：</span>
                            {outputs.map((output) => (
                              <div className="ml-auto flex gap-2" key={output.url}>
                                <button
                                  className="rounded border border-[#1f6f67] bg-white px-4 py-2 text-sm font-black text-[#1f6f67] hover:bg-[#e2f1ec]"
                                  onClick={() => previewOutputFile(output)}
                                  type="button"
                                >
                                  预览
                                </button>
                                <button
                                  className="rounded bg-[#1f6f67] px-4 py-2 text-sm font-black text-white hover:bg-[#15534d]"
                                  onClick={() => saveOutputFile(output)}
                                  type="button"
                                >
                                  下载
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex flex-wrap items-center justify-between gap-3 bg-[#18201f] px-3 py-2 text-sm text-white">
                          <button className="rounded border border-white/30 px-3 py-1 font-bold disabled:opacity-40" disabled={currentPage <= 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} type="button">
                            上一页
                          </button>
                          <div className="flex items-center gap-3">
                            <span>
                              第 {currentPage} 页 / 共 {pdfPageCount || 1} 页
                            </span>
                            {previewingOutput && editablePdfUrl && (
                              <button className="rounded bg-[#f0b35a] px-3 py-1 font-black text-[#3a2404]" onClick={cancelOutputPreview} type="button">
                                取消预览，继续编辑
                              </button>
                            )}
                          </div>
                          <button className="rounded border border-white/30 px-3 py-1 font-bold disabled:opacity-40" disabled={pdfPageCount > 0 && currentPage >= pdfPageCount} onClick={() => setCurrentPage((page) => Math.min(pdfPageCount || page + 1, page + 1))} type="button">
                            下一页
                          </button>
                        </div>
                        <div className="grid h-[calc(100vh-142px)] min-h-[680px] grid-cols-[148px_minmax(0,1fr)] bg-[#252a29]">
                          <div className="overflow-y-auto border-r border-[#cbd8ee] bg-[#eaf1ff] p-3">
                            <div className="grid gap-4">
                              {thumbnailUrls.length > 0 ? (
                                thumbnailUrls.map((url, index) => (
                                  <button
                                    className={`rounded border bg-white p-2 shadow-sm transition ${currentPage === index + 1 ? "border-[#1f6f67] ring-2 ring-[#1f6f67]" : "border-white hover:border-[#6f8fc8]"}`}
                                    key={`${url}-${index}`}
                                    onClick={() => setCurrentPage(index + 1)}
                                    type="button"
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img alt={`第 ${index + 1} 页`} className="mx-auto w-full" src={url} />
                                    <span className="mt-2 block text-xs font-black text-[#4f5a55]">{index + 1}</span>
                                  </button>
                                ))
                              ) : (
                                <span className="text-center text-xs font-bold text-[#66706c]">页面加载中</span>
                              )}
                            </div>
                          </div>
                          <div className="relative overflow-auto bg-[#252a29] p-4">
                            <div
                            aria-label="PDF 编辑画布"
                            className={`relative mx-auto bg-white shadow-lg ${editorTool === "highlight" || placingText ? "cursor-crosshair" : ""}`}
                            onClick={(event: MouseEvent<HTMLDivElement>) => {
                              if (editMode === "visual" && editorTool === "add-text" && placingText) addVisualText(event);
                              if (editMode === "visual" && editorTool !== "add-text" && editorTool !== "highlight") {
                                setSelectedPdfTextId("");
                                setSelectedTextId("");
                              }
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                              }
                            }}
                            onPointerDown={startHighlight}
                            onPointerMove={moveHighlight}
                            onPointerUp={finishHighlight}
                            role="button"
                            style={{ width: canvasSize.width || 620, height: canvasSize.height || 820 }}
                            tabIndex={0}
                          >                            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
                            {!previewingOutput &&
                              [...highlights.filter((mark) => mark.pageNumber === currentPage), ...(draftHighlight?.pageNumber === currentPage ? [draftHighlight] : [])].map((mark) => (
                                <div
                                  aria-hidden="true"
                                  className="pointer-events-none absolute"
                                  key={mark.id}
                                  style={{
                                    backgroundColor: mark.color,
                                    height: `${mark.heightRatio * 100}%`,
                                    left: `${mark.xRatio * 100}%`,
                                    opacity: 0.45,
                                    top: `${mark.yRatio * 100}%`,
                                    width: `${mark.widthRatio * 100}%`,
                                  }}
                                />
                              ))}
                            {editMode === "visual" &&
                              !previewingOutput &&
                              currentTextBoxes
                                .filter(isPdfTextEdited)
                                .map((box) => {
                                  const mask = pdfTextMaskRect(box, canvasSize.width, canvasSize.height);
                                  return (
                                    <div
                                      aria-hidden="true"
                                      className="pointer-events-none absolute"
                                      key={`${box.id}-mask`}
                                      style={{
                                        backgroundColor: box.backgroundColor ?? "#ffffff",
                                        left: `${mask.x}px`,
                                        top: `${mask.y}px`,
                                        width: `${mask.width}px`,
                                        height: `${mask.height}px`,
                                      }}
                                    />
                                  );
                                })}
                            {editMode === "visual" &&
                              !previewingOutput &&
                              currentTextBoxes.filter(box => !box.deleted && (box.text.trim() || selectedPdfTextId === box.id)).map((box) => {
                                const changed = isPdfTextEdited(box);
                                const selected = selectedPdfTextId === box.id;
                                const displayXRatio = changed ? (box.editXRatio ?? box.xRatio) : box.xRatio;
                                const displayYRatio = changed ? (box.editYRatio ?? box.yRatio) : box.yRatio;
                                const layout = pdfEditorLayout(box, canvasSize.width, zoom);
                                const displayWidthRatio = layout.widthRatio;
                                const displayHeight = selected || changed ? Math.max(layout.lineHeight, layout.lines.length * layout.lineHeight) + 2 : Math.max(16, box.heightRatio * canvasSize.height);
                                return (
                                  <div
                                    className={`absolute overflow-hidden rounded-sm border ${
                                      selected
                                        ? // 底色跟随采样的原背景色（内联 style 提供），不再强制白底：
                                          // 深底白字的标题选中时必须仍是深底，白底会盖住绿条。
                                          "border-[#f0b35a] ring-2 ring-[#f0b35a]"
                                        : changed
                                          ? "cursor-move touch-none border-transparent bg-transparent text-[#111827]"
                                          : "border-transparent bg-transparent text-transparent hover:border-[#1f6f67]"
                                    }`}
                                    key={box.id}
                                    onClick={(event) => {
                                      if (editorTool === "highlight") return;
                                      if (editorTool === "add-text") return; // 添加模式：不拦截，让点击冒泡到页面去落点
                                      event.stopPropagation();
                                      setEditorTool("edit-text");
                                      if (suppressPdfTextClickRef.current) {
                                        suppressPdfTextClickRef.current = false;
                                        return;
                                      }
                                      setSelectedPdfTextId(box.id);
                                      setSelectedTextId("");
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.target !== event.currentTarget) return;
                                      if (event.key === "Delete" || event.key === "Backspace") {
                                        event.preventDefault(); event.stopPropagation();
                                        recordHistory();
                                        setPdfTextBoxes(current => current.map(item => item.id === box.id ? { ...item, deleted: true } : item));
                                        setSelectedPdfTextId(""); clearOutputs(); return;
                                      }
                                      if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        if (editorTool !== "highlight") {
                                          setSelectedPdfTextId(box.id);
                                          setSelectedTextId("");
                                        }
                                      }
                                    }}
                                    onPointerDown={(event) => {
                                      if (editorTool === "highlight") return;
                                      if (editorTool !== "select" && editorTool !== "edit-text") return;
                                      if (!changed || selected) return;
                                      event.stopPropagation();
                                      const rect = event.currentTarget.getBoundingClientRect();
                                      event.currentTarget.setPointerCapture(event.pointerId);
                                      dragPdfTextRef.current = {
                                        id: box.id,
                                        dx: event.clientX - rect.left,
                                        dy: event.clientY - rect.top,
                                        moved: false,
                                      };
                                      setSelectedTextId("");
                                    }}
                                    onPointerMove={(event) => {
                                      const drag = dragPdfTextRef.current;
                                      const parent = event.currentTarget.parentElement;
                                      if (!drag || drag.id !== box.id || !parent) return;
                                      const parentBox = parent.getBoundingClientRect();
                                      if (!drag.moved) recordHistory();
                                      drag.moved = true;
                                      movePdfTextBox(
                                        box.id,
                                        (event.clientX - parentBox.left - drag.dx) / parentBox.width,
                                        (event.clientY - parentBox.top - drag.dy) / parentBox.height,
                                      );
                                    }}
                                    onPointerUp={(event) => {
                                      const drag = dragPdfTextRef.current;
                                      if (drag?.id === box.id) {
                                        if (drag.moved) {
                                          suppressPdfTextClickRef.current = true;
                                          setMessage("文字块位置已调整。");
                                        }
                                        dragPdfTextRef.current = null;
                                      }
                                      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                                        event.currentTarget.releasePointerCapture(event.pointerId);
                                      }
                                    }}
                                    style={{
                                      left: `${displayXRatio * 100}%`,
                                      top: `${displayYRatio * 100}%`,
                                      width: `${displayWidthRatio * 100}%`,
                                      height: `${displayHeight}px`,
                                      fontFamily: layout.family,
                                      fontWeight: box.fontWeight ?? 400,
                                      fontSize: `${layout.fontSize}px`,
                                      lineHeight: `${layout.lineHeight}px`,
                                      color: selected || changed ? box.color ?? box.autoColor ?? contrastTextColor(box.backgroundColor) : undefined,
                                      backgroundColor: selected ? box.backgroundColor : undefined,
                                      textShadow: "none",
                                    }}
                                    role="button"
                                    tabIndex={0}
                                    title={box.originalText}
                                  >
                                    {selected ? (
                                      <textarea
                                        ref={selectedPdfTextAreaRef}
                                        className="h-full w-full resize-none overflow-hidden whitespace-pre-wrap break-all border-0 bg-transparent p-0 text-[#111827] outline-none"
                                        style={{ font: "inherit", lineHeight: "inherit", color: "inherit", overflowWrap: "anywhere" }}
                                        aria-label="编辑 PDF 文字"
                                        onFocus={beginTextEdit}
                                        onKeyDown={(event) => {
                                          event.stopPropagation();
                                          if (event.key === "Escape") { event.preventDefault(); event.currentTarget.blur(); }
                                          if ((event.key === "Backspace" || event.key === "Delete") && !box.text) { event.preventDefault(); deleteSelectedPdfText(); }
                                        }}
                                        onBlur={(event) => {
                                          cancelTextEdit();
                                          if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) finishPdfTextEditing(box.id);
                                        }}
                                        onClick={(event) => event.stopPropagation()}
                                        onChange={(event) => { commitTextChange(); updateSelectedPdfText(event.target.value); }}
                                        value={box.text}
                                        wrap="soft"
                                      />
                                    ) : (
                                      <button className="h-full w-full overflow-hidden whitespace-pre-wrap break-all p-0 text-left" style={{ font: "inherit", lineHeight: "inherit" }} type="button">
                                        {changed ? layout.lines.join("\n") : box.originalText}
                                      </button>
                                    )}
                                    {selected && <span
                                      role="slider" tabIndex={0} aria-label="文字框宽度"
                                      aria-valuemin={1} aria-valuemax={100} aria-valuenow={Math.round(displayWidthRatio * 100)}
                                      title="拖动调节宽度；左右方向键微调"
                                      className="absolute right-0 top-0 h-full w-2 cursor-ew-resize touch-none bg-amber-400/40"
                                      onClick={event => event.stopPropagation()}
                                      onPointerDown={event => { event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); }}
                                      onPointerMove={event => {
                                        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                                        event.stopPropagation();
                                        const page = event.currentTarget.parentElement?.parentElement?.getBoundingClientRect();
                                        if (!page) return;
                                        const width = Math.max(0.02, Math.min(1 - displayXRatio, (event.clientX - page.left) / page.width - displayXRatio));
                                        setPdfTextBoxes(current => current.map(item => item.id === box.id ? { ...item, editWidthRatio: width } : item));
                                      }}
                                      onPointerUp={event => { event.stopPropagation(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
                                      onKeyDown={event => {
                                        event.stopPropagation();
                                        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                                        event.preventDefault();
                                        const width = Math.max(0.02, Math.min(1 - displayXRatio, displayWidthRatio + (event.key === "ArrowRight" ? 0.01 : -0.01)));
                                        setPdfTextBoxes(current => current.map(item => item.id === box.id ? { ...item, editWidthRatio: width } : item));
                                      }}
                                    />}
                                  </div>
                                );
                              })}
                            {editMode === "visual" &&
                              !previewingOutput &&
                              visualTexts
                                .filter((note) => note.pageMode === "all" || note.pageNumber === currentPage)
                                .map((note) => (
                                  <div
                                    className={`absolute touch-none cursor-move rounded border p-0 text-left font-bold text-[#1f6f67] ${
                                      selectedTextId === note.id ? "border-[#f0b35a] bg-white/90 shadow-sm ring-2 ring-[#f0b35a]" : "border-transparent bg-transparent hover:border-[#1f6f67] hover:bg-white/80"
                                    }`}
                                    key={note.id}
                                    role="button"
                                    tabIndex={0}
                                    title="单击选中，双击编辑文字"
                                    onDoubleClick={(event) => {
                                      if (editorTool === "highlight") return;
                                      if (editorTool === "add-text") return;
                                      event.stopPropagation();
                                      setSelectedTextId(note.id);
                                      setSelectedPdfTextId("");
                                      setEditingVisualTextId(note.id);
                                    }}
                                    onClick={(event) => {
                                      if (editorTool === "highlight") return;
                                      if (editorTool === "add-text") return; // 添加模式：让点击冒泡到页面去落点
                                      event.stopPropagation();
                                      setSelectedTextId(note.id);
                                      setSelectedPdfTextId("");
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.target !== event.currentTarget) return;
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        setSelectedTextId(note.id);
                                        setEditingVisualTextId(note.id);
                                        return;
                                      }
                                      if (event.key === "Delete" || event.key === "Backspace") {
                                        event.preventDefault();
                                        recordHistory();
                                        setVisualTexts(current => current.filter(item => item.id !== note.id));
                                        setSelectedTextId("");
                                        clearOutputs();
                                      }
                                    }}
                                    onPointerDown={(event) => {
                                      if (editorTool === "highlight") return;
                                      // 正在输入时不要开始拖动，否则光标会被抢走。
                                      if (editingVisualTextId === note.id) return;
                                      if (editorTool === "add-text") return; // 添加模式：让点击冒泡到页面去落点
                                      event.stopPropagation();
                                      const parent = event.currentTarget.parentElement;
                                      if (!parent) return;
                                      const box = event.currentTarget.getBoundingClientRect();
                                      event.currentTarget.setPointerCapture(event.pointerId);
                                      dragTextRef.current = {
                                        id: note.id,
                                        dx: event.clientX - box.left,
                                        dy: event.clientY - box.top,
                                        height: box.height,
                                        moved: false,
                                      };
                                      setSelectedTextId(note.id);
                                      setSelectedPdfTextId("");
                                    }}
                                    onPointerMove={(event) => {
                                      const drag = dragTextRef.current;
                                      const parent = event.currentTarget.parentElement;
                                      if (!drag || drag.id !== note.id || !parent) return;
                                      const parentBox = parent.getBoundingClientRect();
                                      if (!drag.moved) recordHistory();
                                      drag.moved = true;
                                      moveVisualText(
                                        note.id,
                                        (event.clientX - parentBox.left - drag.dx) / parentBox.width,
                                        (event.clientY - parentBox.top - drag.dy) / parentBox.height,
                                      );
                                    }}
                                    onPointerUp={(event) => {
                                      const drag = dragTextRef.current;
                                      if (drag?.id === note.id) {
                                        if (drag.moved) setMessage("文字框位置已调整。");
                                        dragTextRef.current = null;
                                      }
                                      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                                        event.currentTarget.releasePointerCapture(event.pointerId);
                                      }
                                    }}
                                    style={{
                                      left: `${note.xRatio * 100}%`,
                                      top: `${note.yRatio * 100}%`,
                                      fontFamily: fontStack(note.fontFamily),
                                      fontSize: `${note.fontSize * zoom}px`,
                                      lineHeight: 1.25,
                                      color: note.color ?? "#1f6f67",
                                      textShadow: "none",
                                    }}
                                  >
                                    {editingVisualTextId === note.id ? (
                                      <textarea
                                        ref={visualTextAreaRef}
                                        aria-label="编辑新增文字"
                                        className="min-h-[1.25em] w-[12em] resize-none overflow-hidden whitespace-pre-wrap break-all rounded-sm border-0 bg-white/95 p-0 outline-none ring-2 ring-[#f0b35a] placeholder:text-[#94a3b8]"
                                        placeholder="输入文字"
                                        style={{ font: "inherit", lineHeight: "inherit", color: "inherit", overflowWrap: "anywhere" }}
                                        value={note.text}
                                        onFocus={beginTextEdit}
                                        onChange={(event) => { commitTextChange(); updateVisualTextText(note.id, event.target.value); }}
                                        onBlur={() => finishVisualTextEditing(note.id)}
                                        onClick={(event) => event.stopPropagation()}
                                        onPointerDown={(event) => event.stopPropagation()}
                                        onDoubleClick={(event) => event.stopPropagation()}
                                        onKeyDown={(event) => {
                                          event.stopPropagation();
                                          if (event.key === "Escape") { event.preventDefault(); event.currentTarget.blur(); }
                                        }}
                                      />
                                    ) : (
                                      note.text || <span className="italic text-[#94a3b8]">双击输入文字</span>
                                    )}
                                  </div>
                                ))}
                          </div>
                            <div className="sticky bottom-4 z-20 mx-auto mt-4 flex w-fit items-center gap-3 rounded border border-[#d7dde8] bg-white px-4 py-2 text-sm font-black text-[#18201f] shadow-lg">
                              <button className="rounded px-2 py-1 hover:bg-[#eef2f7]" disabled={currentPage <= 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} type="button">
                                上一页
                              </button>
                              <span>{currentPage} / {pdfPageCount || 1}</span>
                              <button className="rounded px-2 py-1 hover:bg-[#eef2f7]" disabled={pdfPageCount > 0 && currentPage >= pdfPageCount} onClick={() => setCurrentPage((page) => Math.min(pdfPageCount || page + 1, page + 1))} type="button">
                                下一页
                              </button>
                              <span className="h-5 w-px bg-[#d7dde8]" />
                              <button className="rounded px-2 py-1 hover:bg-[#eef2f7]" onClick={() => setZoom((value) => Math.max(0.8, Number((value - 0.15).toFixed(2))))} type="button">
                                -
                              </button>
                              <span>{Math.round((zoom / 1.35) * 100)}%</span>
                              <button className="rounded px-2 py-1 hover:bg-[#eef2f7]" onClick={() => setZoom((value) => Math.min(2.7, Number((value + 0.15).toFixed(2))))} type="button">
                                +
                              </button>
                            </div>
                        </div>
                      </div>
                      </div>
                    ) : (
                      <div className="grid h-[calc(100vh-80px)] min-h-[720px] place-items-center bg-[#252a29] px-6 text-center text-white">
                        <label aria-label="打开 PDF 文件" className="grid min-h-72 w-full max-w-xl cursor-pointer place-items-center rounded border-2 border-dashed border-white/35 bg-white/5 p-8 transition hover:border-[#f0b35a] hover:bg-white/10">
                          <input aria-label="打开 PDF 文件" className="sr-only" type="file" accept={accept} onChange={handleFiles} />
                          <span>
                            <strong className="block text-3xl">打开 PDF</strong>
                            <span className="mt-3 block text-sm text-[#d7dedb]">选择文件后直接进入大画布编辑</span>
                          </span>
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className={isEditorWorkspace ? "border-l border-[#d7dde8] bg-[#fbfaf6] p-4" : ""}>
            {selectedTool.kind === "image" && (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="text-sm font-bold">
                  清晰度 {quality}%
                  <input className="mt-2 w-full accent-[#1f6f67]" type="range" min="35" max="95" value={quality} onChange={(event) => setQuality(Number(event.target.value))} />
                </label>
                <label className="text-sm font-bold">
                  最大边长
                  <input className="mt-2 w-full rounded border border-[#cfc6b7] px-3 py-2" type="number" min="320" max="4000" value={maxSide} onChange={(event) => setMaxSide(Number(event.target.value))} />
                </label>
                {activeTool !== "image-pdf" && <label className="text-sm font-bold md:col-span-2">
                  输出格式
                  <select className="mt-2 w-full rounded border border-[#cfc6b7] bg-white px-3 py-2" value={format} onChange={(event) => setFormat(event.target.value)}>
                    <option value="image/webp">WebP</option>
                    <option value="image/jpeg">JPG</option>
                    <option value="image/png">PNG</option>
                  </select>
                </label>}
                {activeTool === "image-pdf" && <p className="text-sm text-[#66706c] md:col-span-2">输出格式：PDF。先在下方调整排版并预览，再生成文件。</p>}
              </div>
            )}

            {activeTool === "image-pdf" && <ImagePdfEditor files={files} layout={imagePdfLayout} scales={imagePdfScales} disabled={busy}
              onLayout={layout => { setImagePdfLayout(layout); clearOutputs(); setMessage("排版已更新，确认预览后生成 PDF。"); }}
              onScale={(file, scale) => { setImagePdfScales(current => new Map(current).set(file, scale)); clearOutputs(); setMessage("图片大小已更新，确认预览后生成 PDF。"); }} />}

            {activeTool === "pdf-edit" && (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="text-sm font-bold md:col-span-2">
                  编辑模式
                  <select className="mt-2 w-full rounded border border-[#cfc6b7] bg-white px-3 py-2" value={editMode} onChange={(event) => setEditMode(event.target.value)}>
                    <option value="visual">可视化编辑</option>
                    <option value="replace">替换 PDF 原文</option>
                    <option value="annotation">添加批注文字</option>
                  </select>
                </label>
                {editMode === "visual" ? (
                  <>
                    <div className="flex gap-2 md:col-span-2">
                      <button type="button" disabled={!historyState.canUndo} onClick={undoEditor}
                        className="flex-1 rounded border border-[#cfc6b7] bg-white px-3 py-2 text-sm font-black disabled:opacity-40">
                        撤销
                      </button>
                      <button type="button" disabled={!historyState.canRedo} onClick={redoEditor}
                        className="flex-1 rounded border border-[#cfc6b7] bg-white px-3 py-2 text-sm font-black disabled:opacity-40">
                        重做
                      </button>
                    </div>
                    {selectedPdfText ? (
                      <div className="rounded border border-[#1f6f67] bg-[#eef7f4] p-3 md:col-span-2">
                        <strong className="text-sm">正在页面上编辑文字</strong>
                        <button type="button" onMouseDown={event => event.preventDefault()} onClick={deleteSelectedPdfText} className="mt-2 block rounded border border-red-300 bg-white px-3 py-2 text-sm text-red-700">删除整个文字块</button>
                        <p className="mt-2 text-xs leading-5 text-[#4f5a55]">直接在左侧选中的文字框里输入，修改效果会立即显示在 PDF 页面上。</p>
                      </div>
                    ) : selectedVisualText ? (
                      <div className="rounded border border-[#f0b35a] bg-[#fdf8ee] p-3 md:col-span-2">
                        <strong className="text-sm">正在编辑新增文字</strong>
                        <textarea
                          className="mt-2 w-full resize-y rounded border border-[#cfc6b7] bg-white px-3 py-2 text-sm"
                          rows={3}
                          value={selectedVisualText.text}
                          aria-label="新增文字内容"
                          placeholder="输入要放到页面上的文字"
                          onFocus={beginTextEdit}
                          onChange={event => { commitTextChange(); updateVisualTextText(selectedVisualText.id, event.target.value); }}
                          onBlur={cancelTextEdit}
                        />
                        <button type="button" onClick={removeSelectedText} className="mt-2 rounded border border-red-300 bg-white px-3 py-2 text-sm text-red-700">删除这个文字框</button>
                        <p className="mt-2 text-xs leading-5 text-[#66706c]">也可以直接在左侧的文字框里输入，两边同步。</p>
                      </div>
                    ) : (
                      <div className="rounded border border-[#d8d1c3] bg-[#fbfaf6] p-3 md:col-span-2">
                        <strong className="text-sm">点击左侧 PDF 页面中的文字块开始编辑</strong>
                        <p className="mt-2 text-xs leading-5 text-[#66706c]">如果页面没有出现文字框，说明这个 PDF 可能是扫描件或文字编码过于复杂。点「添加文字到页面」可以在任意位置写新文字，双击文字可以重新编辑。</p>
                      </div>
                    )}
                    {pdfTextBoxes.some(box => box.deleted) && <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => { setPdfTextBoxes(current => current.map(box => box.deleted ? { ...box, deleted: false } : box)); clearOutputs(); setMessage("已恢复删除前的文字块。"); }}>恢复已删除文字块</button>}
                    <label className="text-sm font-bold md:col-span-2">
                      新增文字内容（可选）
                      <input className="mt-2 w-full rounded border border-[#cfc6b7] px-3 py-2" placeholder="留空也行，放好位置后直接输入" value={editText} onChange={(event) => setEditText(event.target.value)} />
                    </label>
                    <label className="text-sm font-bold">
                      字体
                      <select
                        className="mt-2 w-full rounded border border-[#cfc6b7] bg-white px-3 py-2"
                        value={styleFontFamily}
                        onChange={(event) => {
                          setEditFontFamily(event.target.value);
                          updateTextStyle({ fontFamily: event.target.value });
                        }}
                      >
                        {fontOptions.map((font) => (
                          <option key={font.value} value={font.value}>
                            {font.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="text-sm font-bold">
                      <label htmlFor="pdf-text-color">文字颜色</label>
                      <div className="mt-2 flex items-center gap-2">
                        <input id="pdf-text-color" aria-label="文字颜色" type="color" value={styleColor} onChange={event => { setEditColor(event.target.value); updateTextStyle({ color: event.target.value }); }} className="h-10 w-12 cursor-pointer rounded border" />
                        <input aria-label="文字颜色 HEX" key={`${selectedPdfTextId}-${selectedTextId}-${styleColor}`} defaultValue={styleColor} maxLength={7} placeholder="#ffffff" className="w-28 rounded border px-2 py-2 font-mono" onBlur={event => { const color = event.target.value.trim(); if (/^#[0-9a-f]{6}$/i.test(color)) { setEditColor(color); updateTextStyle({ color }); } else event.target.value = styleColor; }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
                      </div>
                    </div>
                    <p className="text-xs text-[#66706c]">字体使用设备已安装字体，缺少时使用替代字体。选中文字后拖动右侧金色边缘调整宽度，文字自动换行；Enter 手动换行。</p>
                    <label className="text-sm font-bold">
                      字号 {styleFontSize}
                      <input
                        className="mt-2 w-full accent-[#1f6f67]"
                        min="8"
                        max="48"
                        type="range"
                        value={styleFontSize}
                        onChange={(event) => {
                          const nextSize = Number(event.target.value);
                          setEditFontSize(nextSize);
                          updateTextStyle({ fontSize: nextSize });
                        }}
                      />
                    </label>

                    <button
                      className={`rounded px-4 py-2 text-sm font-black md:col-span-2 ${
                        placingText ? "bg-[#f0b35a] text-[#3a2404]" : "bg-[#1f6f67] text-white hover:bg-[#15534d]"
                      }`}
                      onClick={() => (placingText ? stopTextPlacement() : startTextPlacement())}
                      type="button"
                    >
                      {placingText ? "取消添加文字" : "添加文字到页面"}
                    </button>
                    <label className="text-sm font-bold">
                      页面
                      <select className="mt-2 w-full rounded border border-[#cfc6b7] bg-white px-3 py-2" value={editPageMode} onChange={(event) => setEditPageMode(event.target.value)}>
                        <option value="single">当前指定页</option>
                        <option value="all">全部页面</option>
                      </select>
                    </label>
                    <label className="text-sm font-bold">
                      页码
                      <input className="mt-2 w-full rounded border border-[#cfc6b7] px-3 py-2 disabled:bg-[#eee8dd]" disabled={editPageMode === "all"} min="1" type="number" value={editPageNumber} onChange={(event) => setEditPageNumber(Number(event.target.value))} />
                    </label>
                    {selectedVisualText && (
                      <div className="rounded border border-[#d8d1c3] bg-[#fbfaf6] p-3 md:col-span-2">
                        <label className="text-sm font-bold">
                          修改选中文字
                          <input className="mt-2 w-full rounded border border-[#cfc6b7] px-3 py-2" value={selectedVisualText.text} onChange={(event) => updateSelectedText({ text: event.target.value })} />
                        </label>
                        <button className="mt-3 rounded border border-[#a33a2d] px-3 py-2 text-sm font-bold text-[#a33a2d]" type="button" onClick={removeSelectedText}>
                          删除选中文字
                        </button>
                      </div>
                    )}
                    <p className="rounded bg-[#fff4dc] px-3 py-2 text-sm leading-6 text-[#6c4a12] md:col-span-2">
                      点击已有文字后会在原位置变成输入框，可直接改并即时看到效果。需要添加新文字时，先点“添加文字到页面”，再点 PDF 页面位置；已添加的文字框可以拖动。
                    </p>
                  </>
                ) : editMode === "replace" ? (
                  <>
                    <label className="text-sm font-bold">
                      查找原文字
                      <input className="mt-2 w-full rounded border border-[#cfc6b7] px-3 py-2" placeholder="例如 Invoice" value={findText} onChange={(event) => setFindText(event.target.value)} />
                    </label>
                    <label className="text-sm font-bold">
                      替换为
                      <input className="mt-2 w-full rounded border border-[#cfc6b7] px-3 py-2" placeholder="例如 Receipt" value={replaceText} onChange={(event) => setReplaceText(event.target.value)} />
                    </label>
                    <p className="rounded bg-[#fff4dc] px-3 py-2 text-sm leading-6 text-[#6c4a12] md:col-span-2">
                      第一版支持文本型 PDF 中可直接识别的原文替换。左侧预览原文件或保存后的新文件；扫描件、复杂中文字体编码、逐字拆分排版可能无法替换。
                    </p>
                  </>
                ) : (
                  <>
                    <label className="text-sm font-bold md:col-span-2">
                      添加文字
                      <input className="mt-2 w-full rounded border border-[#cfc6b7] px-3 py-2" value={editText} onChange={(event) => setEditText(event.target.value)} />
                    </label>
                    <label className="text-sm font-bold">
                      页面
                      <select className="mt-2 w-full rounded border border-[#cfc6b7] bg-white px-3 py-2" value={editPageMode} onChange={(event) => setEditPageMode(event.target.value)}>
                        <option value="all">全部页面</option>
                        <option value="single">指定页面</option>
                      </select>
                    </label>
                    <label className="text-sm font-bold">
                      页码
                      <input className="mt-2 w-full rounded border border-[#cfc6b7] px-3 py-2 disabled:bg-[#eee8dd]" disabled={editPageMode === "all"} min="1" type="number" value={editPageNumber} onChange={(event) => setEditPageNumber(Number(event.target.value))} />
                    </label>
                    <label className="text-sm font-bold md:col-span-2">
                      字号 {editFontSize}
                      <input className="mt-2 w-full accent-[#1f6f67]" min="10" max="72" type="range" value={editFontSize} onChange={(event) => setEditFontSize(Number(event.target.value))} />
                    </label>
                  </>
                )}
              </div>
            )}

            {activeTool === "pdf-compress" && (
              <p className="mt-4 rounded bg-[#fff4dc] px-3 py-2 text-sm leading-6 text-[#6c4a12]">
                当前是浏览器端轻量优化，适合清理结构冗余。扫描件图片重采样压缩需要接入服务端引擎后再做。
              </p>
            )}

            {activeTool === "pdf-word" && (
              <p className="mt-4 rounded bg-[#fff4dc] px-3 py-2 text-sm leading-6 text-[#6c4a12]">
                输出可编辑文字：优先提取原有文本，扫描页自动识别简体中文和英文。保留分页和基本换行，不保留图片、印章或复杂表格版式。首次识别需联网下载模型，文件仍在本机处理；模糊扫描件请核对识别结果。
              </p>
            )}

            {(activeTool === "pdf-seal" || activeTool === "word-seal") && (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <input ref={sealInputRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/*" aria-label="上传合同章图片" onChange={handleSealFile} />
                <button
                  className="grid min-h-32 cursor-pointer place-items-center rounded border-2 border-dashed border-[#b9afa0] bg-[#fbfaf6] p-5 text-center transition hover:border-[#1f6f67] md:col-span-2"
                  onClick={() => sealInputRef.current?.click()}
                  type="button"
                >
                  <span>
                    <strong className="block text-lg">{sealFile ? sealFile.name : "上传合同章图片"}</strong>
                    <span className="mt-2 block text-sm text-[#66706c]">推荐透明 PNG，红章效果最好</span>
                  </span>
                </button>
                <label className="text-sm font-bold">
                  盖章边缘
                  <select className="mt-2 w-full rounded border border-[#cfc6b7] bg-white px-3 py-2" value={sealSide} onChange={(event) => setSealSide(event.target.value as SealSide)}>
                    <option value="right">右侧骑缝</option>
                    <option value="left">左侧骑缝</option>
                    <option value="top">上侧骑缝</option>
                    <option value="bottom">下侧骑缝</option>
                  </select>
                </label>
                <label className="text-sm font-bold">
                  章整体大小 {sealSize}
                  <input className="mt-2 w-full accent-[#1f6f67]" type="range" min="80" max="320" value={sealSize} onChange={(event) => setSealSize(Number(event.target.value))} />
                </label>
                <label className="text-sm font-bold">
                  边缘距离 {sealOffset}
                  <input className="mt-2 w-full accent-[#1f6f67]" type="range" min="-24" max="80" value={sealOffset} onChange={(event) => setSealOffset(Number(event.target.value))} />
                </label>
                <label className="text-sm font-bold">
                  位置 {sealPosition}%
                  <input className="mt-2 w-full accent-[#1f6f67]" type="range" min="0" max="100" value={sealPosition} onChange={(event) => setSealPosition(Number(event.target.value))} />
                </label>
                <label className="text-sm font-bold">
                  透明度 {sealOpacity}%
                  <input className="mt-2 w-full accent-[#1f6f67]" type="range" min="20" max="100" value={sealOpacity} onChange={(event) => setSealOpacity(Number(event.target.value))} />
                </label>
                <label className="text-sm font-bold">
                  旋转 {sealRotation}°
                  <input className="mt-2 w-full accent-[#1f6f67]" type="range" min="-30" max="30" value={sealRotation} onChange={(event) => setSealRotation(Number(event.target.value))} />
                </label>
                <p className="rounded bg-[#fff4dc] px-3 py-2 text-sm leading-6 text-[#6c4a12] md:col-span-2">
                  {activeTool === "word-seal" ? "支持批量选择 Word 合同：每份文件会先生成 PDF，再按各自页数切分同一枚合同章。复杂页眉页脚、表格和图片不会完全还原 Word 原版式。" : "支持批量选择 PDF 合同：每份文件会按各自页数切分同一枚合同章；打印后分别叠放每一份合同的页面，边缘可以拼出完整章。"}
                </p>
              </div>
            )}

            {activeTool !== "pdf-edit" && (
              <button
                className="mt-4 w-full rounded bg-[#1f6f67] px-5 py-3 font-black text-white transition hover:bg-[#15534d] disabled:cursor-not-allowed disabled:bg-[#a5aaa6]"
                disabled={!ready || busy || ((activeTool === "pdf-seal" || activeTool === "word-seal") && !sealFile)}
                onClick={processFiles}
              >
                {busy ? "批量处理中..." : activeTool === "pdf-seal" || activeTool === "word-seal" ? (sealFile ? (activeTool === "word-seal" ? `为 ${files.length || "已选"} 份合同转 PDF 并盖章` : `为 ${files.length || "已选"} 份合同生成骑缝章`) : "先上传合同章图片") : files.length > 0 ? activeTool === "image-pdf" ? `按当前排版生成 PDF（${Math.ceil(files.length / pageGeometry(imagePdfLayout).perPage)} 页）` : "处理已选择文件" : isWordTool ? "先选择 Word 文件" : isPdfTool ? "先选择 PDF 文件" : "先选择图片文件"}
              </button>
            )}

            <p className="mt-3 text-sm text-[#66706c]">{message}</p>
            {files.length > 0 && (
              <div className="mt-3 max-h-64 overflow-auto text-sm text-[#4f5a55]">
                {files.length > 1 && <p className="mb-2 text-xs">拖动文件调整顺序，也可使用上移、下移按钮。按从上到下的顺序处理。</p>}
                {files.map((file, index) => (
                  <div className="flex items-center gap-2 border-t border-[#eee8dd] py-2" key={`${file.name}-${file.size}-${index}`}
                    draggable={!busy && files.length > 1}
                    onDragStart={event => { draggedFile.current = index; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(index)); }}
                    onDragOver={event => { if (!busy && draggedFile.current !== null) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
                    onDrop={event => { event.preventDefault(); if (draggedFile.current !== null) moveFile(draggedFile.current, index); draggedFile.current = null; }}
                    onDragEnd={() => { draggedFile.current = null; }}>
                    <span className="shrink-0 text-[#66706c]">{index + 1}.</span>
                    <span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span>
                    <span className="shrink-0">{prettySize(file.size)}</span>
                    {files.length > 1 && <div className="flex shrink-0 gap-1">
                      <button type="button" aria-label={`上移 ${file.name}`} disabled={busy || index === 0} onClick={() => moveFile(index, index - 1)} className="rounded border px-2 py-2 disabled:opacity-30">↑</button>
                      <button type="button" aria-label={`下移 ${file.name}`} disabled={busy || index === files.length - 1} onClick={() => moveFile(index, index + 1)} className="rounded border px-2 py-2 disabled:opacity-30">↓</button>
                    </div>}
                  </div>
                ))}
              </div>
            )}
            {outputs.length > 0 && (
              <div className="mt-4 max-h-60 overflow-auto rounded bg-[#eef7f4] p-3">
                {outputs.map((output) => (
                  <div className="grid gap-2 border-b border-[#d6ebe3] py-3 last:border-b-0" key={output.url}>
                    <label className="text-xs font-bold text-[#4f5a55]">
                      文件名
                      <input
                        className="mt-1 w-full rounded border border-[#b9d6cd] bg-white px-3 py-2 text-sm font-bold text-[#15534d] outline-none focus:border-[#1f6f67]"
                        onChange={(event) => updateOutputName(output.url, event.target.value)}
                        value={output.name}
                      />
                    </label>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-[#66706c]">{prettySize(output.size)}</span>
                      <div className="flex gap-2">
                          <button className="rounded border border-[#1f6f67] px-4 py-2 text-sm font-black text-[#1f6f67] hover:bg-white" onClick={() => previewOutputFile(output)} type="button">
                            预览
                          </button>
                        <button className="rounded bg-[#1f6f67] px-4 py-2 text-sm font-black text-white hover:bg-[#15534d]" onClick={() => saveOutputFile(output)} type="button">
                          {activeTool === "image-pdf" ? "下载 PDF" : "保存"}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
              </div>
            </div>
          </div>
        </div>
      </section>
      {outputPreview && <OutputPreview key={outputPreview.url} file={outputPreview} readWord={readWordPreview} onClose={() => setOutputPreview(null)} />}
    </div>
  );
}
