"use client";

import { useEffect, useRef, useState } from "react";
import { pageGeometry, type ImagePdfLayout } from "./image-pdf-layout";

function Photo({ file, scale }: { file: File; scale: number }) {
  const image = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState<File | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    if (image.current) image.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return <>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img ref={image} alt={file.name} draggable={false} onError={() => setFailed(file)} className="h-full w-full object-contain" style={{ transform: `scale(${scale / 100})` }} />
    {failed === file && <span className="absolute inset-0 grid place-items-center bg-white p-2 text-xs text-red-700">无法预览此图片，请换成 JPG 或 PNG</span>}
  </>;
}

export default function ImagePdfEditor({ files, layout, scales, disabled, onLayout, onScale }: {
  files: File[];
  layout: ImagePdfLayout;
  scales: Map<File, number>;
  disabled: boolean;
  onLayout: (layout: ImagePdfLayout) => void;
  onScale: (file: File, scale: number) => void;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const [selected, setSelected] = useState<File | null>(null);
  const geometry = pageGeometry(layout);
  const total = Math.ceil(files.length / geometry.perPage);
  const page = Math.min(pageIndex, Math.max(0, total - 1));
  const currentFiles = files.slice(page * geometry.perPage, (page + 1) * geometry.perPage);
  const selectedFile = selected && currentFiles.includes(selected) ? selected : currentFiles[0];
  const scale = selectedFile ? scales.get(selectedFile) ?? 100 : 100;
  const control = "mt-1 w-full rounded border border-[#cfc6b7] bg-white px-3 py-2";
  return <section aria-label="图片 PDF 排版" className="mt-5 rounded-lg border border-[#cfc6b7] bg-[#f5f7f4] p-4">
    <h3 className="font-black">先排版，再生成 PDF</h3>
    <p className="mt-1 text-sm text-[#66706c]">A4 纸张，图片完整显示、不裁切。点击预览中的图片可单独缩放；下方文件列表可调整顺序。</p>
    <fieldset disabled={disabled} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-sm font-bold">纸张方向<select className={control} value={layout.landscape ? "landscape" : "portrait"} onChange={event => onLayout({ ...layout, landscape: event.target.value === "landscape" })}><option value="portrait">A4 竖版</option><option value="landscape">A4 横版</option></select></label>
      <label className="text-sm font-bold">每行图片<select className={control} value={layout.columns} onChange={event => onLayout({ ...layout, columns: Number(event.target.value) })}>{[1,2,3,4].map(n => <option value={n} key={n}>{n} 张</option>)}</select></label>
      <label className="text-sm font-bold">每页行数<select className={control} value={layout.rows} onChange={event => onLayout({ ...layout, rows: Number(event.target.value) })}>{[1,2,3,4].map(n => <option value={n} key={n}>{n} 行</option>)}</select></label>
      <label className="text-sm font-bold">页边距 {layout.margin} mm<input className="mt-3 w-full accent-[#1f6f67]" type="range" min="0" max="30" value={layout.margin} onChange={event => onLayout({ ...layout, margin: Number(event.target.value) })} /></label>
      <label className="text-sm font-bold">图片间距 {layout.gap} mm<input className="mt-3 w-full accent-[#1f6f67]" type="range" min="0" max="15" value={layout.gap} onChange={event => onLayout({ ...layout, gap: Number(event.target.value) })} /></label>
      <label className="text-sm font-bold">选中图片大小 {scale}%<input className="mt-3 w-full accent-[#1f6f67]" type="range" min="10" max="100" value={scale} disabled={!selectedFile || disabled} onChange={event => { if (selectedFile) onScale(selectedFile, Number(event.target.value)); }} /><span className="block truncate text-xs font-normal" title={selectedFile?.name}>{selectedFile?.name ?? "先选择图片"}</span></label>
    </fieldset>
    <p role="status" className="my-4 font-bold text-[#15534d]">{files.length} 张图片 · 每页最多 {geometry.perPage} 张 · 共 {total} 页</p>
    {total > 0 ? <>
      <div className="mb-3 flex items-center justify-center gap-4">
        <button type="button" className="rounded border px-3 py-2 disabled:opacity-30" disabled={page === 0 || disabled} onClick={() => setPageIndex(page - 1)}>上一张预览页</button>
        <span>{page + 1} / {total}</span>
        <button type="button" className="rounded border px-3 py-2 disabled:opacity-30" disabled={page + 1 >= total || disabled} onClick={() => setPageIndex(page + 1)}>下一张预览页</button>
      </div>
      <div aria-label={`排版预览第 ${page + 1} 页`} className="relative mx-auto w-full max-w-xl bg-white shadow" style={{ aspectRatio: `${geometry.width} / ${geometry.height}` }}>
        {currentFiles.map((file, slot) => <button key={`${page}-${slot}-${file.name}`} type="button" aria-label={`调整图片 ${page * geometry.perPage + slot + 1}：${file.name}`} aria-pressed={file === selectedFile} disabled={disabled} onClick={() => setSelected(file)} className={`absolute p-0 ${file === selectedFile ? "outline outline-2 outline-[#1f6f67]" : "outline outline-1 outline-dashed outline-[#ddd]"}`} style={{
          left: `${(geometry.margin + (slot % geometry.columns) * (geometry.cellWidth + geometry.gap)) / geometry.width * 100}%`,
          top: `${(geometry.margin + Math.floor(slot / geometry.columns) * (geometry.cellHeight + geometry.gap)) / geometry.height * 100}%`,
          width: `${geometry.cellWidth / geometry.width * 100}%`, height: `${geometry.cellHeight / geometry.height * 100}%`,
        }}><Photo file={file} scale={scales.get(file) ?? 100} /></button>)}
      </div>
      <p className="mt-3 text-center text-xs text-[#66706c]">虚线和选中边框仅用于编辑，不会出现在 PDF 中。100% 表示等比例适应格子。</p>
    </> : <p className="rounded border border-dashed p-8 text-center text-sm">选择图片后，这里会显示分页排版预览。</p>}
  </section>;
}
