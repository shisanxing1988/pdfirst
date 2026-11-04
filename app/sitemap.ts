import type { MetadataRoute } from "next";
export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["", "/pdf-merge", "/image-compress", "/pdf-seal", "/guides", "/guides/pdf-merge", "/guides/image-compress", "/guides/pdf-seal", "/about", "/privacy", "/contact"];
  return routes.map(route => ({ url: `https://pdfirst.com${route}`, lastModified: "2026-09-17" }));
}
