import { removeTextObjects, type TextRemoval } from './pdf-redaction';
self.onmessage = async (event: MessageEvent<{ data: ArrayBuffer; regions: TextRemoval[] }>) => {
  try {
    const response = await fetch('/pdfium-2.15.1.wasm');
    if (!response.ok) throw new Error('PDF 编辑组件加载失败，请重试。');
    const data = await removeTextObjects(event.data.data, event.data.regions, await response.arrayBuffer());
    self.postMessage({ data }, { transfer: [data] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'PDF 原文移除失败。' });
  }
};
