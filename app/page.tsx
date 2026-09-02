"use client";

import { ChangeEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { decodePDFRawStream, PDFDocument, PDFName, PDFRawStream, StandardFonts, rgb } from "pdf-lib";

type ToolId = "compress" | "convert" | "image-pdf" | "pdf-merge" | "pdf-split" | "pdf-compress" | "pdf-edit";
type ToolKind = "image" | "pdf";

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
};

type PdfTextBox = {
  id: string;
  pageNumber: number;
  originalText: string;
  text: string;
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
  fontSize: number;
};

const tools: Array<{
  id: ToolId;
  kind: ToolKind;
  title: string;
  tag: string;
  description: string;
}> = [
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
    id: "pdf-edit",
    kind: "pdf",
    title: "PDF 原文编辑",
    tag: "替换文字",
    description: "替换文本型 PDF 中可识别的原始文字，也支持添加批注文字。",
  },
];

const imageTools = tools.filter((tool) => tool.kind === "image");
const pdfTools = tools.filter((tool) => tool.kind === "pdf");

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
  const image = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext("2d");

  if (!ctx) throw new Error("浏览器不支持图片画布处理。");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  return canvas;
}

async function readBytes(blob: Blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

function textBytes(value: string) {
  return new TextEncoder().encode(value);
}

function latin1Bytes(value: string) {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

async function imagesToPdf(files: File[]) {
  const prepared = [];

  for (const file of files) {
    const canvas = await drawImage(file, 1600);
    const jpeg = await blobFromCanvas(canvas, "image/jpeg", 0.9);
    prepared.push({
      width: canvas.width,
      height: canvas.height,
      bytes: await readBytes(jpeg),
    });
  }

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let length = 0;
  const add = (chunk: Uint8Array) => {
    chunks.push(chunk);
    length += chunk.length;
  };
  const addText = (value: string) => add(textBytes(value));
  const addObject = (id: number, body: string) => {
    offsets[id] = length;
    addText(`${id} 0 obj\n${body}\nendobj\n`);
  };
  const addStream = (id: number, dict: string, stream: Uint8Array) => {
    offsets[id] = length;
    addText(`${id} 0 obj\n${dict}\nstream\n`);
    add(stream);
    addText("\nendstream\nendobj\n");
  };

  addText("%PDF-1.4\n");
  const pageIds = prepared.map((_, index) => 3 + index * 3);
  addObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
  addObject(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${prepared.length} >>`);

  prepared.forEach((image, index) => {
    const pageId = 3 + index * 3;
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const content = textBytes(`q\n${image.width} 0 0 ${image.height} 0 0 cm\n/Im${index} Do\nQ\n`);

    addObject(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${image.width} ${image.height}] /Resources << /XObject << /Im${index} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    addStream(contentId, `<< /Length ${content.length} >>`, content);
    addStream(
      imageId,
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>`,
      image.bytes,
    );
  });

  const xrefStart = length;
  addText(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (let id = 1; id < offsets.length; id += 1) {
    addText(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  }
  addText(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

  return new Blob(chunks, { type: "application/pdf" });
}

function canvasesToPdf(canvases: HTMLCanvasElement[]) {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  const images = canvases.map((canvas) => ({
    width: canvas.width,
    height: canvas.height,
    bytesPromise: blobFromCanvas(canvas, "image/jpeg", 0.92).then(readBytes),
  }));

  return Promise.all(images.map((image) => image.bytesPromise)).then((imageBytes) => {
    let length = 0;
    const add = (chunk: Uint8Array) => {
      chunks.push(chunk);
      length += chunk.length;
    };
    const addText = (value: string) => add(textBytes(value));
    const addObject = (id: number, body: string) => {
      offsets[id] = length;
      addText(`${id} 0 obj\n${body}\nendobj\n`);
    };
    const addStream = (id: number, dict: string, stream: Uint8Array) => {
      offsets[id] = length;
      addText(`${id} 0 obj\n${dict}\nstream\n`);
      add(stream);
      addText("\nendstream\nendobj\n");
    };

    addText("%PDF-1.4\n");
    const pageIds = canvases.map((_, index) => 3 + index * 3);
    addObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
    addObject(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${canvases.length} >>`);

    canvases.forEach((canvas, index) => {
      const pageId = 3 + index * 3;
      const contentId = pageId + 1;
      const imageId = pageId + 2;
      const content = textBytes(`q\n${canvas.width} 0 0 ${canvas.height} 0 0 cm\n/Im${index} Do\nQ\n`);

      addObject(
        pageId,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${canvas.width} ${canvas.height}] /Resources << /XObject << /Im${index} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      );
      addStream(contentId, `<< /Length ${content.length} >>`, content);
      addStream(
        imageId,
        `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes[index].length} >>`,
        imageBytes[index],
      );
    });

    const xrefStart = length;
    addText(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
    for (let id = 1; id < offsets.length; id += 1) {
      addText(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
    }
    addText(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

    return new Blob(chunks, { type: "application/pdf" });
  });
}

async function mergePdfs(files: File[]) {
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
  const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const target = await PDFDocument.create();
  const pages = await target.copyPages(source, source.getPageIndices());
  pages.forEach((page) => target.addPage(page));
  const bytes = await target.save({ useObjectStreams: true, objectsPerTick: 40 });
  return new Blob([bytes], { type: "application/pdf" });
}

async function editPdf(file: File, options: { text: string; pageMode: string; pageNumber: number; fontSize: number }) {
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

async function saveVisualPdfEdits(file: File, notes: VisualText[]) {
  if (notes.length === 0) throw new Error("请先在 PDF 预览区域点击添加文字。");
  const pdf = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();

  notes.forEach((note) => {
    const targetPages = note.pageMode === "all" ? pages : [pages[Math.max(0, Math.min(pages.length - 1, note.pageNumber - 1))]];
    targetPages.forEach((page) => {
      const { width, height } = page.getSize();
      page.drawText(note.text, {
        x: Math.max(12, Math.min(width - 24, note.xRatio * width)),
        y: Math.max(12, Math.min(height - 24, height - note.yRatio * height)),
        size: note.fontSize,
        font,
        color: rgb(0.12, 0.44, 0.41),
        opacity: 0.9,
      });
    });
  });

  const bytes = await pdf.save({ useObjectStreams: true });
  return new Blob([bytes], { type: "application/pdf" });
}

async function saveSelectedTextEdits(file: File, boxes: PdfTextBox[]) {
  const changed = boxes.filter((box) => box.text !== box.originalText);
  if (changed.length === 0) throw new Error("请先点击 PDF 里的文字并修改内容。");

  const pdf = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();

  changed.forEach((box) => {
    const page = pages[box.pageNumber - 1];
    if (!page) return;
    const { width, height } = page.getSize();
    const x = box.xRatio * width;
    const top = box.yRatio * height;
    const rectWidth = Math.max(16, box.widthRatio * width);
    const rectHeight = Math.max(box.fontSize * 1.25, box.heightRatio * height);
    const y = height - top - rectHeight;

    page.drawRectangle({
      x: Math.max(0, x - 1),
      y: Math.max(0, y - 2),
      width: Math.min(width - x, rectWidth + 8),
      height: rectHeight + 4,
      color: rgb(1, 1, 1),
      opacity: 1,
    });
    page.drawText(box.text || " ", {
      x,
      y: Math.max(0, y + 2),
      size: Math.max(8, Math.min(72, box.fontSize)),
      font,
      color: rgb(0.05, 0.08, 0.08),
    });
  });

  const bytes = await pdf.save({ useObjectStreams: true });
  return new Blob([bytes], { type: "application/pdf" });
}

async function saveVisualEditorPdf(file: File, boxes: PdfTextBox[], notes: VisualText[]) {
  const changedBoxes = boxes.filter((box) => box.text !== box.originalText);
  if (changedBoxes.length === 0 && notes.length === 0) throw new Error("请先点击 PDF 里的文字并修改内容，或添加新文字。");

  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const canvases: HTMLCanvasElement[] = [];
  const scale = 1.6;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不支持 PDF 页面渲染。");

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, canvasContext: context, viewport }).promise;

    changedBoxes
      .filter((box) => box.pageNumber === pageNumber)
      .forEach((box) => {
        const x = box.xRatio * canvas.width;
        const y = box.yRatio * canvas.height;
        const width = Math.max(18, Math.max(box.widthRatio, 0.98 - box.xRatio) * canvas.width);
        const height = Math.max(box.fontSize * scale * 1.4, box.heightRatio * canvas.height);
        context.fillStyle = "#ffffff";
        context.fillRect(Math.max(0, x - 2), Math.max(0, y - 2), width + 12, height + 4);
        context.fillStyle = "#111827";
        context.font = `${Math.max(10, Math.round(box.fontSize * scale))}px Arial, "PingFang SC", "Microsoft YaHei", sans-serif`;
        context.textBaseline = "top";
        context.fillText(box.text || " ", x, y);
      });

    notes
      .filter((note) => note.pageMode === "all" || note.pageNumber === pageNumber)
      .forEach((note) => {
        context.fillStyle = "#1f6f67";
        context.font = `700 ${Math.max(10, Math.round(note.fontSize * scale))}px Arial, "PingFang SC", "Microsoft YaHei", sans-serif`;
        context.textBaseline = "top";
        context.fillText(note.text || " ", note.xRatio * canvas.width, note.yRatio * canvas.height);
      });

    canvases.push(canvas);
  }

  return canvasesToPdf(canvases);
}

function buildTextBoxes(
  pdfjsLib: typeof import("pdfjs-dist/legacy/build/pdf.mjs"),
  textContent: { items: unknown[] },
  viewport: { width: number; height: number; transform: number[] },
  pageNumber: number,
  existingBoxes: PdfTextBox[],
) {
  const rawBoxes = textContent.items
    .filter((item): item is typeof item & { str: string; transform: number[]; width: number; height: number } => "str" in item && Boolean(item.str.trim()))
    .map((item, index) => {
      const transform = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const fontHeight = Math.max(8, Math.hypot(transform[2], transform[3]));
      const x = transform[4];
      const y = transform[5] - fontHeight;
      const width = Math.max(item.width * 1.35, item.str.length * fontHeight * 0.46);
      const height = Math.max(item.height * 1.35, fontHeight);

      return {
        id: `${pageNumber}-raw-${index}`,
        pageNumber,
        originalText: item.str,
        text: item.str,
        xRatio: Math.max(0, Math.min(1, x / viewport.width)),
        yRatio: Math.max(0, Math.min(1, y / viewport.height)),
        widthRatio: Math.max(0.01, Math.min(1, width / viewport.width)),
        heightRatio: Math.max(0.01, Math.min(1, height / viewport.height)),
        fontSize: Math.max(8, Math.round(fontHeight / 1.35)),
      };
    })
    .sort((a, b) => a.yRatio - b.yRatio || a.xRatio - b.xRatio);

  const lines: PdfTextBox[] = [];
  for (const box of rawBoxes) {
    const last = lines[lines.length - 1];
    const sameLine = last && Math.abs(last.yRatio - box.yRatio) < 0.006;
    const closeEnough = last && box.xRatio - (last.xRatio + last.widthRatio) < 0.035;

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

  return lines.map((line) => ({
    ...line,
    text: existingBoxes.find((box) => box.id === line.id)?.text ?? line.text,
  }));
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

export default function Home() {
  const [activeTool, setActiveTool] = useState<ToolId>("compress");
  const [files, setFiles] = useState<File[]>([]);
  const [quality, setQuality] = useState(76);
  const [maxSide, setMaxSide] = useState(1600);
  const [format, setFormat] = useState("image/webp");
  const [editText, setEditText] = useState("请输入文字");
  const [editMode, setEditMode] = useState("visual");
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [editPageMode, setEditPageMode] = useState("all");
  const [editPageNumber, setEditPageNumber] = useState(1);
  const [editFontSize, setEditFontSize] = useState(22);
  const [previewUrl, setPreviewUrl] = useState("");
  const [visualTexts, setVisualTexts] = useState<VisualText[]>([]);
  const [selectedTextId, setSelectedTextId] = useState("");
  const [placingText, setPlacingText] = useState(false);
  const [pdfTextBoxes, setPdfTextBoxes] = useState<PdfTextBox[]>([]);
  const [selectedPdfTextId, setSelectedPdfTextId] = useState("");
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [outputs, setOutputs] = useState<OutputFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("文件只在你的浏览器里处理。");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragTextRef = useRef<{ id: string; dx: number; dy: number; height: number; moved: boolean } | null>(null);

  const selectedTool = useMemo(() => tools.find((tool) => tool.id === activeTool) ?? tools[0], [activeTool]);
  const isPdfTool = selectedTool.kind === "pdf";
  const selectedVisualText = visualTexts.find((note) => note.id === selectedTextId);
  const currentTextBoxes = pdfTextBoxes.filter((box) => box.pageNumber === currentPage);
  const selectedPdfText = pdfTextBoxes.find((box) => box.id === selectedPdfTextId);
  const ready = files.length > 0;
  const accept = isPdfTool ? "application/pdf,.pdf" : "image/*";

  useEffect(() => {
    let cancelled = false;

    async function renderPdfPage() {
      if (!files[0] || activeTool !== "pdf-edit" || editMode !== "visual") return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      try {
        const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
        const data = await files[0].arrayBuffer();
        const documentTask = pdfjsLib.getDocument({ data });
        const pdf = await documentTask.promise;
        const pageNumber = Math.max(1, Math.min(currentPage, pdf.numPages));
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.35 });
        const context = canvas.getContext("2d");

        if (!context || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        setCanvasSize({ width: viewport.width, height: viewport.height });
        setPdfPageCount(pdf.numPages);
        await page.render({ canvas, canvasContext: context, viewport }).promise;

        const textContent = await page.getTextContent();
        const nextBoxes = buildTextBoxes(pdfjsLib, textContent, viewport, pageNumber, pdfTextBoxes);

        if (!cancelled) {
          setPdfTextBoxes((current) => [
            ...current.filter((box) => box.pageNumber !== pageNumber),
            ...nextBoxes,
          ]);
          setMessage(nextBoxes.length > 0 ? `第 ${pageNumber} 页识别到 ${nextBoxes.length} 个可编辑文字块。` : "这一页没有识别到可编辑文字块。");
        }
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "PDF 渲染失败，请换个文件试试。");
      }
    }

    renderPdfPage();
    return () => {
      cancelled = true;
    };
  }, [activeTool, currentPage, editMode, files]);

  function clearOutputs() {
    setOutputs((current) => {
      current.forEach((output) => URL.revokeObjectURL(output.url));
      return [];
    });
  }

  function clearPreview() {
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
  }

  function updateOutputName(url: string, name: string) {
    setOutputs((current) => current.map((output) => (output.url === url ? { ...output, name } : output)));
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
    link.remove();
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    setFiles(picked);
    clearOutputs();
    clearPreview();
    setVisualTexts([]);
    setSelectedTextId("");
    setPlacingText(false);
    setPdfTextBoxes([]);
    setSelectedPdfTextId("");
    setPdfPageCount(0);
    setCurrentPage(1);
    if (picked.length > 0 && selectedTool.kind === "pdf") {
      setPreviewUrl(URL.createObjectURL(picked[0]));
    }
    setMessage(
      picked.length
        ? activeTool === "pdf-edit"
          ? "PDF 已打开。点击预览区域添加文字，或切换到原文替换模式。"
          : `已选择 ${picked.length} 个文件，请点击下方按钮开始处理。`
        : "文件只在你的浏览器里处理。",
    );
  }

  function selectTool(toolId: ToolId) {
    setActiveTool(toolId);
    setFiles([]);
    clearOutputs();
    clearPreview();
    setVisualTexts([]);
    setSelectedTextId("");
    setPlacingText(false);
    setPdfTextBoxes([]);
    setSelectedPdfTextId("");
    setPdfPageCount(0);
    setCurrentPage(1);
    setMessage("选择文件后，再点击处理按钮生成下载文件。");
  }

  function addVisualText(event: React.MouseEvent<HTMLDivElement>) {
    if (!previewUrl || activeTool !== "pdf-edit" || editMode !== "visual" || !placingText) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const note: VisualText = {
      id: crypto.randomUUID(),
      text: editText.trim() || "请输入文字",
      xRatio: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      yRatio: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      pageMode: editPageMode,
      pageNumber: editPageNumber,
      fontSize: editFontSize,
    };
    setVisualTexts((current) => [...current, note]);
    setSelectedTextId("");
    setMessage("已在页面上添加文字。需要调整时可拖动文字框，或点击文字后修改。");
    setPlacingText(false);
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
    setVisualTexts((current) => current.filter((note) => note.id !== selectedTextId));
    setSelectedTextId("");
    setMessage("已删除选中的文字标记。");
  }

  function updateSelectedPdfText(text: string) {
    setPdfTextBoxes((current) => current.map((box) => (box.id === selectedPdfTextId ? { ...box, text } : box)));
  }

  async function processFiles() {
    if (!ready) return;
    setBusy(true);
    clearOutputs();

    try {
      if (activeTool === "image-pdf") {
        const pdf = await imagesToPdf(files);
        setOutputs([{ name: "images.pdf", size: pdf.size, url: URL.createObjectURL(pdf), blob: pdf }]);
        setMessage("PDF 已生成。可先改文件名，再手动保存。");
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

      if (activeTool === "pdf-edit") {
        if (editMode === "visual") {
          const editedTextBoxes = pdfTextBoxes.filter((box) => box.text !== box.originalText);
          const pdf = await saveVisualEditorPdf(files[0], pdfTextBoxes, visualTexts);
          const outputUrl = URL.createObjectURL(pdf);
          setOutputs([{ name: `${fileBaseName(files[0].name)}-visual-edited.pdf`, size: pdf.size, url: outputUrl, blob: pdf }]);
          clearPreview();
          setPreviewUrl(outputUrl);
          setMessage(editedTextBoxes.length > 0 ? "文字块编辑已生成，新文件已在左侧预览。可先改文件名，再手动保存。" : "PDF 已生成，新文件已在左侧预览。可先改文件名，再手动保存。");
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
      setMessage(error instanceof Error ? error.message : "处理失败，请换个文件试试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f4ee] text-[#18201f]">
      <section className="border-b border-[#d8d1c3] bg-[#fbfaf6]">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-8 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
          <div className="flex flex-col justify-between gap-8">
            <header className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded bg-[#1f6f67] text-lg font-black text-white">P</div>
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
                <strong className="block text-2xl">7</strong>
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

          <div className={`rounded border border-[#cfc6b7] bg-white p-4 shadow-sm ${activeTool === "pdf-edit" ? "lg:col-span-2" : ""}`}>
            <div className="mb-4 flex items-center justify-between gap-4 border-b border-[#ebe5da] pb-3">
              <div>
                <h3 className="font-black">在线处理台</h3>
                <p className="text-sm text-[#66706c]">{selectedTool.description}</p>
              </div>
              <span className="shrink-0 rounded bg-[#f0b35a] px-3 py-1 text-xs font-black text-[#3a2404]">可用</span>
            </div>

            <div className={activeTool === "pdf-edit" ? "grid gap-4 xl:grid-cols-[1.2fr_0.8fr]" : ""}>
              <div>
                <label
                  className={`grid min-h-44 cursor-pointer place-items-center rounded border-2 border-dashed p-6 text-center transition hover:border-[#1f6f67] ${
                    files.length > 0 ? "border-[#1f6f67] bg-[#eef7f4]" : "border-[#b9afa0] bg-[#fbfaf6]"
                  }`}
                >
                  <input className="sr-only" multiple={activeTool !== "pdf-compress" && activeTool !== "pdf-edit"} type="file" accept={accept} onChange={handleFiles} />
                  <span>
                    <strong className="block text-xl">{files.length > 0 ? `已选择 ${files.length} 个文件` : isPdfTool ? "选择 PDF 文件" : "选择图片文件"}</strong>
                    <span className="mt-2 block text-sm text-[#66706c]">
                      {files.length > 0 ? "可以继续点这里重新选择" : isPdfTool ? "支持 PDF 文件，当前仍在浏览器本地处理" : "支持批量选择，当前不上云处理"}
                    </span>
                  </span>
                </label>

                {activeTool === "pdf-edit" && (
                  <div className="mt-4 overflow-hidden rounded border border-[#d8d1c3] bg-[#252a29]">
                    {previewUrl ? (
                      <div>
                        <div className="flex items-center justify-between gap-3 bg-[#18201f] px-3 py-2 text-sm text-white">
                          <button className="rounded border border-white/30 px-3 py-1 font-bold disabled:opacity-40" disabled={currentPage <= 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} type="button">
                            上一页
                          </button>
                          <span>
                            第 {currentPage} 页 / 共 {pdfPageCount || 1} 页
                          </span>
                          <button className="rounded border border-white/30 px-3 py-1 font-bold disabled:opacity-40" disabled={pdfPageCount > 0 && currentPage >= pdfPageCount} onClick={() => setCurrentPage((page) => Math.min(pdfPageCount || page + 1, page + 1))} type="button">
                            下一页
                          </button>
                        </div>
                        <div className="h-[560px] overflow-auto bg-[#252a29] p-4">
                          <div
                            className={`relative mx-auto bg-white shadow-lg ${placingText ? "cursor-crosshair" : ""}`}
                            onClick={(event: MouseEvent<HTMLDivElement>) => {
                              if (editMode === "visual" && placingText) addVisualText(event);
                              if (editMode === "visual" && !placingText) {
                                setSelectedPdfTextId("");
                                setSelectedTextId("");
                              }
                            }}
                            style={{ width: canvasSize.width || 620, height: canvasSize.height || 820 }}
                          >
                            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
                            {editMode === "visual" &&
                              currentTextBoxes.map((box) => {
                                const changed = box.text !== box.originalText;
                                const selected = selectedPdfTextId === box.id;
                                const displayWidthRatio = selected || changed ? Math.max(box.widthRatio, 0.98 - box.xRatio) : box.widthRatio;
                                return (
                                  <div
                                    className={`absolute overflow-hidden rounded-sm border ${
                                      selected
                                        ? "border-[#f0b35a] bg-white text-[#111827] ring-2 ring-[#f0b35a]"
                                        : changed
                                          ? "border-transparent bg-white text-[#111827]"
                                          : "border-transparent bg-[#e7f0ce]/10 text-transparent hover:border-[#1f6f67] hover:bg-[#e7f0ce]/40"
                                    }`}
                                    key={box.id}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setSelectedPdfTextId(box.id);
                                      setSelectedTextId("");
                                    }}
                                    style={{
                                      left: `${box.xRatio * 100}%`,
                                      top: `${box.yRatio * 100}%`,
                                      width: `${displayWidthRatio * 100}%`,
                                      height: `${Math.max(18, box.heightRatio * canvasSize.height)}px`,
                                      fontSize: `${Math.max(10, box.fontSize * 1.35)}px`,
                                    }}
                                    title={box.originalText}
                                  >
                                    {selected ? (
                                      <textarea
                                        autoFocus
                                        className="h-full w-full resize-none border-0 bg-transparent px-1 py-0 leading-tight text-[#111827] outline-none"
                                        onClick={(event) => event.stopPropagation()}
                                        onChange={(event) => updateSelectedPdfText(event.target.value)}
                                        value={box.text}
                                      />
                                    ) : (
                                      <button className="h-full w-full px-1 py-0 text-left leading-tight" type="button">
                                        {changed ? box.text : box.originalText}
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            {editMode === "visual" &&
                              visualTexts
                                .filter((note) => note.pageMode === "all" || note.pageNumber === currentPage)
                                .map((note) => (
                                  <button
                                    className={`absolute max-w-56 touch-none -translate-y-1/2 cursor-move rounded border px-2 py-1 text-left font-bold text-[#1f6f67] ${
                                      selectedTextId === note.id ? "border-[#f0b35a] bg-white/90 shadow-sm ring-2 ring-[#f0b35a]" : "border-transparent bg-transparent hover:border-[#1f6f67] hover:bg-white/80"
                                    }`}
                                    key={note.id}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setSelectedTextId(note.id);
                                      setSelectedPdfTextId("");
                                    }}
                                    onPointerDown={(event) => {
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
                                      drag.moved = true;
                                      moveVisualText(
                                        note.id,
                                        (event.clientX - parentBox.left - drag.dx) / parentBox.width,
                                        (event.clientY - parentBox.top - drag.dy + drag.height / 2) / parentBox.height,
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
                                      fontSize: `${Math.min(24, Math.max(12, note.fontSize * 0.72))}px`,
                                    }}
                                    type="button"
                                  >
                                    {note.text}
                                  </button>
                                ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="grid h-[560px] place-items-center px-6 text-center text-white">
                        <div>
                          <strong className="block text-2xl">打开一个 PDF</strong>
                          <span className="mt-2 block text-sm text-[#d7dedb]">选择文件后会在这里预览，再点击页面添加文字。</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
            {!isPdfTool && (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="text-sm font-bold">
                  清晰度 {quality}%
                  <input className="mt-2 w-full accent-[#1f6f67]" type="range" min="35" max="95" value={quality} onChange={(event) => setQuality(Number(event.target.value))} />
                </label>
                <label className="text-sm font-bold">
                  最大边长
                  <input className="mt-2 w-full rounded border border-[#cfc6b7] px-3 py-2" type="number" min="320" max="4000" value={maxSide} onChange={(event) => setMaxSide(Number(event.target.value))} />
                </label>
                <label className="text-sm font-bold md:col-span-2">
                  输出格式
                  <select className="mt-2 w-full rounded border border-[#cfc6b7] bg-white px-3 py-2" value={format} onChange={(event) => setFormat(event.target.value)}>
                    <option value="image/webp">WebP</option>
                    <option value="image/jpeg">JPG</option>
                    <option value="image/png">PNG</option>
                  </select>
                </label>
              </div>
            )}

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
                    {selectedPdfText ? (
                      <div className="rounded border border-[#1f6f67] bg-[#eef7f4] p-3 md:col-span-2">
                        <strong className="text-sm">正在页面上编辑文字</strong>
                        <p className="mt-2 text-xs leading-5 text-[#4f5a55]">直接在左侧选中的文字框里输入，修改效果会立即显示在 PDF 页面上。</p>
                      </div>
                    ) : (
                      <div className="rounded border border-[#d8d1c3] bg-[#fbfaf6] p-3 md:col-span-2">
                        <strong className="text-sm">点击左侧 PDF 页面中的文字块开始编辑</strong>
                        <p className="mt-2 text-xs leading-5 text-[#66706c]">如果页面没有出现文字框，说明这个 PDF 可能是扫描件或文字编码过于复杂。</p>
                      </div>
                    )}
                    <label className="text-sm font-bold md:col-span-2">
                      新增文字内容
                      <input className="mt-2 w-full rounded border border-[#cfc6b7] px-3 py-2" value={editText} onChange={(event) => setEditText(event.target.value)} />
                    </label>
                    <button
                      className={`rounded px-4 py-2 text-sm font-black md:col-span-2 ${
                        placingText ? "bg-[#f0b35a] text-[#3a2404]" : "bg-[#1f6f67] text-white hover:bg-[#15534d]"
                      }`}
                      onClick={() => {
                        setPlacingText((current) => !current);
                        setSelectedPdfTextId("");
                        setMessage(placingText ? "已取消添加文字。" : "请在左侧 PDF 页面上点击要放置文字的位置。");
                      }}
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
                    <label className="text-sm font-bold md:col-span-2">
                      字号 {editFontSize}
                      <input className="mt-2 w-full accent-[#1f6f67]" min="10" max="72" type="range" value={editFontSize} onChange={(event) => setEditFontSize(Number(event.target.value))} />
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

            <button
              className="mt-4 w-full rounded bg-[#1f6f67] px-5 py-3 font-black text-white transition hover:bg-[#15534d] disabled:cursor-not-allowed disabled:bg-[#a5aaa6]"
              disabled={!ready || busy}
              onClick={processFiles}
            >
              {busy ? "处理中..." : files.length > 0 ? (activeTool === "pdf-edit" ? "保存 PDF" : "处理已选择文件") : isPdfTool ? "先选择 PDF 文件" : "先选择图片文件"}
            </button>

            <p className="mt-3 text-sm text-[#66706c]">{message}</p>
            {files.length > 0 && (
              <div className="mt-3 max-h-28 overflow-auto text-sm text-[#4f5a55]">
                {files.map((file) => (
                  <div className="flex justify-between gap-4 border-t border-[#eee8dd] py-2" key={`${file.name}-${file.size}`}>
                    <span className="truncate">{file.name}</span>
                    <span>{prettySize(file.size)}</span>
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
                      <button className="rounded bg-[#1f6f67] px-4 py-2 text-sm font-black text-white hover:bg-[#15534d]" onClick={() => saveOutputFile(output)} type="button">
                        保存
                      </button>
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

      <section className="mx-auto max-w-7xl px-5 py-8 lg:px-8" id="tools">
        <div className="mb-5 flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <p className="text-sm font-bold text-[#1f6f67]">Tools</p>
            <h2 className="text-3xl font-black">工具列表</h2>
          </div>
          <p className="max-w-xl text-sm leading-6 text-[#66706c]">
            目前优先做浏览器端可完成的高频功能。更强的扫描件压缩、OCR、可视化拖拽编辑会进入服务端增强版。
          </p>
        </div>

        <div className="mb-4 flex gap-2">
          <span className="rounded bg-[#1f6f67] px-3 py-1 text-sm font-black text-white">图片</span>
          <span className="rounded bg-[#18201f] px-3 py-1 text-sm font-black text-white">PDF</span>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[...imageTools, ...pdfTools].map((tool) => (
            <button
              className={`min-h-40 rounded border p-4 text-left transition ${
                activeTool === tool.id ? "border-[#1f6f67] bg-white shadow-sm" : "border-[#d8d1c3] bg-[#fbfaf6] hover:border-[#1f6f67]"
              }`}
              key={tool.id}
              onClick={() => selectTool(tool.id)}
            >
              <span className={`mb-4 inline-flex rounded px-2 py-1 text-xs font-black ${tool.kind === "pdf" ? "bg-[#e4ecff] text-[#203b75]" : "bg-[#e7f0ce] text-[#3d5621]"}`}>
                {tool.tag}
              </span>
              <strong className="block text-xl">{tool.title}</strong>
              <span className="mt-2 block text-sm leading-6 text-[#66706c]">{tool.description}</span>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
