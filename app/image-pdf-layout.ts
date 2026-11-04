import { PDFDocument } from "pdf-lib";

export type ImagePdfLayout = {
  landscape: boolean;
  columns: number;
  rows: number;
  margin: number;
  gap: number;
};
export const defaultImagePdfLayout: ImagePdfLayout = { landscape: false, columns: 2, rows: 2, margin: 10, gap: 5 };

export function pageGeometry(layout: ImagePdfLayout) {
  const width = layout.landscape ? 297 : 210;
  const height = layout.landscape ? 210 : 297;
  const columns = Math.max(1, Math.min(4, Math.round(layout.columns)));
  const rows = Math.max(1, Math.min(4, Math.round(layout.rows)));
  const margin = Math.max(0, Math.min(30, layout.margin));
  const gap = Math.max(0, Math.min(15, layout.gap));
  return { width, height, columns, rows, margin, gap, perPage: columns * rows,
    cellWidth: (width - margin * 2 - gap * (columns - 1)) / columns,
    cellHeight: (height - margin * 2 - gap * (rows - 1)) / rows };
}

export function imagePlacement(layout: ImagePdfLayout, index: number, width: number, height: number, percent = 100) {
  const geometry = pageGeometry(layout);
  const slot = index % geometry.perPage;
  const scale = Math.min(geometry.cellWidth / width, geometry.cellHeight / height) * Math.max(10, Math.min(100, percent)) / 100;
  const imageWidth = width * scale;
  const imageHeight = height * scale;
  return {
    page: Math.floor(index / geometry.perPage),
    x: geometry.margin + (slot % geometry.columns) * (geometry.cellWidth + geometry.gap) + (geometry.cellWidth - imageWidth) / 2,
    y: geometry.margin + Math.floor(slot / geometry.columns) * (geometry.cellHeight + geometry.gap) + (geometry.cellHeight - imageHeight) / 2,
    width: imageWidth, height: imageHeight,
  };
}

export async function buildImagePdf(images: Array<{ bytes: Uint8Array; width: number; height: number; scale: number }>, layout: ImagePdfLayout) {
  if (!images.length) throw new Error("请先选择图片。");
  const pdf = await PDFDocument.create();
  const geometry = pageGeometry(layout);
  const pointsPerMm = 72 / 25.4;
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const rect = imagePlacement(layout, index, image.width, image.height, image.scale);
    if (index % geometry.perPage === 0) pdf.addPage([geometry.width * pointsPerMm, geometry.height * pointsPerMm]);
    const embedded = await pdf.embedJpg(image.bytes);
    pdf.getPage(rect.page).drawImage(embedded, {
      x: rect.x * pointsPerMm,
      y: (geometry.height - rect.y - rect.height) * pointsPerMm,
      width: rect.width * pointsPerMm, height: rect.height * pointsPerMm,
    });
  }
  return new Blob([new Uint8Array(await pdf.save())], { type: "application/pdf" });
}
