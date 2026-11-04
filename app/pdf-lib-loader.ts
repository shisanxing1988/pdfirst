// pdf-lib and fontkit are only needed once the visitor actually processes a PDF
// (merge, split, seal, convert, edit-export). Importing them statically put
// ~1.6 MB into the bundle on every page load — including the landing page, which
// only renders tool cards. Load them on demand, the same way pdfjs-dist and
// tesseract.js are loaded in app/toolbox.tsx.
//
// Both loaders cache their promise, so repeated calls share one network fetch.
export type PdfLib = typeof import('pdf-lib');
// @pdf-lib/fontkit ships a browser build with a default export but its type
// declarations only describe the named `create`, hence the local shape.
type FontkitModule = { create: typeof import('@pdf-lib/fontkit').create };

let pdfLib: Promise<PdfLib> | undefined;
let fontkit: Promise<FontkitModule> | undefined;

export function loadPdfLib(): Promise<PdfLib> {
  pdfLib ??= import('pdf-lib');
  return pdfLib;
}

export function loadFontkit(): Promise<FontkitModule> {
  fontkit ??= import('@pdf-lib/fontkit').then(
    module => (module as { default?: FontkitModule }).default ?? (module as unknown as FontkitModule),
  );
  return fontkit;
}
