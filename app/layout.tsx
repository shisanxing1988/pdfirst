import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { SiteNav, SiteFooter } from "./site-content";
import "./globals.css";
import VisitTracker from "./visit-tracker";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "pdfirst.com";
  const protocol = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  const origin = `${protocol}://${host}`;
  return {
  metadataBase: new URL(origin),
  title: "PDF 批量骑缝章、合并与图片压缩 | 轻文档工具箱",
  description: "在浏览器中合并 PDF、压缩图片、添加 PDF 骑缝章。提供本地文件处理工具、实用教程与常见问题解答。",
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: "轻文档工具箱", locale: "zh_CN", images: [{ url: `${origin}/og.png`, width: 1536, height: 1024, alt: "轻文档工具箱：PDF 合并、图片压缩、PDF 骑缝章" }] },
  twitter: { card: "summary_large_image", images: [`${origin}/og.png`] },
  icons: {
    icon: [
      { url: "/favicon.ico?v=2", sizes: "16x16 32x32 48x48" },
      { url: "/favicon-48.png?v=2", type: "image/png", sizes: "48x48" },
      { url: "/favicon.svg?v=2", type: "image/svg+xml", sizes: "any" },
    ],
    shortcut: "/favicon.ico?v=2",
    apple: { url: "/apple-touch-icon.png?v=2", sizes: "180x180" },
  },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head>
        <script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9328440079890728"
          crossOrigin="anonymous"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <VisitTracker />
        <SiteNav />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
