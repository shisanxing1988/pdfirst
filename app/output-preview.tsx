"use client";

import { useEffect, useRef, useState } from "react";

type PreviewFile = { name: string; url: string; blob: Blob };

export default function OutputPreview({ file, readWord, onClose }: {
  file: PreviewFile;
  readWord: (blob: Blob) => Promise<string[]>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!file.blob.type.startsWith("image/"));
  const isPdf = file.blob.type === "application/pdf";
  const isImage = file.blob.type.startsWith("image/");

  useEffect(() => { dialog.current?.showModal(); }, []);

  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    async function load() {
      if (isImage) return;
      if (!isPdf) {
        const text = await readWord(file.blob);
        if (!cancelled) { setParagraphs(text); setLoading(false); }
        return;
      }
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      if (cancelled) return;
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
      const data = await file.blob.arrayBuffer();
      if (cancelled) return;
      const task = pdfjs.getDocument({ data });
      dispose = () => { void task.destroy(); };
      const pdf = await task.promise;
      if (cancelled) return;
      setCount(pdf.numPages);
      const pdfPage = await pdf.getPage(page);
      if (cancelled || !canvas.current) return;
      const viewport = pdfPage.getViewport({ scale: 1.5 });
      const target = canvas.current;
      target.width = Math.ceil(viewport.width);
      target.height = Math.ceil(viewport.height);
      const context = target.getContext("2d");
      if (!context) throw new Error("浏览器无法显示 PDF 预览。");
      await pdfPage.render({ canvas: target, canvasContext: context, viewport }).promise;
      if (!cancelled) setLoading(false);
    }
    void load().catch(() => { if (!cancelled) { setError("预览加载失败，请保存文件后查看。"); setLoading(false); } });
    return () => { cancelled = true; dispose?.(); };
  }, [file.blob, isImage, isPdf, page, readWord]);

  return <dialog ref={dialog} onCancel={onClose} onClose={onClose} aria-labelledby="output-preview-title" className="fixed inset-0 m-auto max-h-[92vh] w-[min(960px,94vw)] max-w-none rounded-xl border border-[#d6ebe3] bg-[#f7f8f5] p-0 text-[#18201f] shadow-xl backdrop:bg-black/50">
    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-white p-4">
      <h2 id="output-preview-title" className="min-w-0 break-all font-bold">{file.name}</h2>
      <button type="button" onClick={onClose} className="shrink-0 rounded border px-4 py-2">关闭预览</button>
    </div>
    <div className="overflow-auto p-4">
      {isPdf && <div className="mb-3 flex items-center justify-center gap-4">
        <button type="button" disabled={loading || page <= 1} onClick={() => { setLoading(true); setError(""); setPage(value => value - 1); }} className="rounded border px-3 py-2 disabled:opacity-40">上一页</button>
        <span>第 {page} / {count || "…"} 页</span>
        <button type="button" disabled={loading || page >= count} onClick={() => { setLoading(true); setError(""); setPage(value => value + 1); }} className="rounded border px-3 py-2 disabled:opacity-40">下一页</button>
      </div>}
      {loading && <p role="status" className="py-4 text-center">正在加载预览…</p>}
      {error && <p role="alert" className="py-4 text-center">{error}</p>}
      {isPdf ? <canvas ref={canvas} aria-label={`PDF 第 ${page} 页预览`} className={`mx-auto h-auto max-w-full bg-white ${loading || error ? "hidden" : ""}`} /> : isImage ?
        // eslint-disable-next-line @next/next/no-img-element
        <img src={file.url} alt={file.name} onError={() => setError("图片预览失败，请保存文件后查看。")} className="mx-auto h-auto max-w-full object-contain" /> :
        <><p className="mb-3 text-sm text-[#66706c]">Word 正文预览，实际分页与样式请以 Word 打开结果为准。</p><div className="space-y-3 whitespace-pre-wrap break-words bg-white p-6">{paragraphs.map((text, index) => <p key={index}>{text || "\u00a0"}</p>)}</div></>}
    </div>
  </dialog>;
}
