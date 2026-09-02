"use client";

import { ChangeEvent, useMemo, useState } from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type ToolId = "compress" | "convert" | "image-pdf" | "pdf-merge" | "pdf-split" | "pdf-compress" | "pdf-edit";
type ToolKind = "image" | "pdf";

type OutputFile = {
  name: string;
  size: number;
  url: string;
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
    title: "PDF 在线编辑",
    tag: "添加文字",
    description: "给 PDF 指定页或全部页面添加文字、签名备注或水印。",
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

export default function Home() {
  const [activeTool, setActiveTool] = useState<ToolId>("compress");
  const [files, setFiles] = useState<File[]>([]);
  const [quality, setQuality] = useState(76);
  const [maxSide, setMaxSide] = useState(1600);
  const [format, setFormat] = useState("image/webp");
  const [editText, setEditText] = useState("Reviewed");
  const [editPageMode, setEditPageMode] = useState("all");
  const [editPageNumber, setEditPageNumber] = useState(1);
  const [editFontSize, setEditFontSize] = useState(22);
  const [outputs, setOutputs] = useState<OutputFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("文件只在你的浏览器里处理。");

  const selectedTool = useMemo(() => tools.find((tool) => tool.id === activeTool) ?? tools[0], [activeTool]);
  const isPdfTool = selectedTool.kind === "pdf";
  const ready = files.length > 0;
  const accept = isPdfTool ? "application/pdf,.pdf" : "image/*";

  function clearOutputs() {
    setOutputs((current) => {
      current.forEach((output) => URL.revokeObjectURL(output.url));
      return [];
    });
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    setFiles(picked);
    clearOutputs();
    setMessage(picked.length ? `已选择 ${picked.length} 个文件，请点击下方按钮开始处理。` : "文件只在你的浏览器里处理。");
  }

  function selectTool(toolId: ToolId) {
    setActiveTool(toolId);
    setFiles([]);
    clearOutputs();
    setMessage("选择文件后，再点击处理按钮生成下载文件。");
  }

  async function processFiles() {
    if (!ready) return;
    setBusy(true);
    clearOutputs();

    try {
      if (activeTool === "image-pdf") {
        const pdf = await imagesToPdf(files);
        setOutputs([{ name: "images.pdf", size: pdf.size, url: URL.createObjectURL(pdf) }]);
        setMessage("PDF 已生成，可以下载。");
        return;
      }

      if (activeTool === "pdf-merge") {
        const pdf = await mergePdfs(files);
        setOutputs([{ name: "merged.pdf", size: pdf.size, url: URL.createObjectURL(pdf) }]);
        setMessage("PDF 已合并，可以下载。");
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
        setOutputs([{ name: `${fileBaseName(files[0].name)}-optimized.pdf`, size: pdf.size, url: URL.createObjectURL(pdf) }]);
        setMessage("PDF 已重新优化结构，可以下载。扫描件深度压缩需要下一阶段服务端引擎。");
        return;
      }

      if (activeTool === "pdf-edit") {
        const pdf = await editPdf(files[0], {
          text: editText.trim() || "Reviewed",
          pageMode: editPageMode,
          pageNumber: editPageNumber,
          fontSize: editFontSize,
        });
        setOutputs([{ name: `${fileBaseName(files[0].name)}-edited.pdf`, size: pdf.size, url: URL.createObjectURL(pdf) }]);
        setMessage("PDF 已添加文字，可以下载。");
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
        });
      }
      setOutputs(nextOutputs);
      setMessage(`处理完成：${nextOutputs.length} 个文件。`);
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
                PDF 和图片，上传后就能处理。
              </h2>
              <p className="mt-5 max-w-xl text-lg leading-8 text-[#4f5a55]">
                支持图片压缩、图片格式转换、图片转 PDF、PDF 合并、PDF 拆分、PDF 轻量压缩和 PDF 在线添加文字。
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
                <strong className="block text-2xl">1</strong>
                <span className="text-[#66706c]">在线编辑项</span>
              </div>
            </div>
          </div>

          <div className="rounded border border-[#cfc6b7] bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-4 border-b border-[#ebe5da] pb-3">
              <div>
                <h3 className="font-black">在线处理台</h3>
                <p className="text-sm text-[#66706c]">{selectedTool.description}</p>
              </div>
              <span className="shrink-0 rounded bg-[#f0b35a] px-3 py-1 text-xs font-black text-[#3a2404]">可用</span>
            </div>

            <label
              className={`grid min-h-44 cursor-pointer place-items-center rounded border-2 border-dashed p-6 text-center transition hover:border-[#1f6f67] ${
                files.length > 0 ? "border-[#1f6f67] bg-[#eef7f4]" : "border-[#b9afa0] bg-[#fbfaf6]"
              }`}
            >
              <input className="sr-only" multiple={activeTool !== "pdf-compress" && activeTool !== "pdf-edit"} type="file" accept={accept} onChange={handleFiles} />
              <span>
                <strong className="block text-xl">{files.length > 0 ? `已选择 ${files.length} 个文件` : isPdfTool ? "选择 PDF 文件" : "选择图片文件"}</strong>
                <span className="mt-2 block text-sm text-[#66706c]">
                  {files.length > 0 ? "可以继续点这里重新选择，或点击下方按钮处理" : isPdfTool ? "支持 PDF 文件，当前仍在浏览器本地处理" : "支持批量选择，当前不上云处理"}
                </span>
              </span>
            </label>

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
              {busy ? "处理中..." : files.length > 0 ? "处理已选择文件" : isPdfTool ? "先选择 PDF 文件" : "先选择图片文件"}
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
              <div className="mt-4 max-h-44 overflow-auto rounded bg-[#eef7f4] p-3">
                {outputs.map((output) => (
                  <a className="flex justify-between gap-4 border-b border-[#d6ebe3] py-2 font-bold text-[#15534d] last:border-b-0" download={output.name} href={output.url} key={output.url}>
                    <span className="truncate">下载 {output.name}</span>
                    <span>{prettySize(output.size)}</span>
                  </a>
                ))}
              </div>
            )}
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
