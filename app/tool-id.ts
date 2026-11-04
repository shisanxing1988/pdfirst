const toolIds = ["compress", "convert", "image-pdf", "pdf-merge", "pdf-split", "pdf-compress", "pdf-edit", "pdf-word", "pdf-seal", "word-seal"] as const;
export type ToolId = typeof toolIds[number];
export function resolveToolId(value: string | string[] | undefined): ToolId | undefined {
  return toolIds.find(id => id === value);
}
