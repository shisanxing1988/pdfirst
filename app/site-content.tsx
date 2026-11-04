import Link from "next/link";
import type { ReactNode } from "react";

export const coreTools = [
  { href: "/pdf-merge", title: "PDF 合并", summary: "把分散的材料整理成一份 PDF，先确认顺序，再合并保存。" },
  { href: "/image-compress", title: "图片压缩", summary: "调整图片尺寸与质量，为邮件附件、资料提交和网页配图减负。" },
  { href: "/pdf-seal", title: "PDF 骑缝章", summary: "将章图按页切分，批量添加到 PDF 边缘，并预览核对。" },
];

export function SiteNav() {
  return <header className="site-nav"><Link className="site-brand" href="/"><span className="brand-icon" aria-hidden="true" /><span className="brand-name">轻文档工具箱</span></Link><nav aria-label="主导航"><Link href="/pdf-merge">PDF 合并</Link><Link href="/image-compress">图片压缩</Link><Link href="/pdf-seal">PDF 骑缝章</Link><Link href="/guides">实用教程</Link></nav></header>;
}

export function SiteFooter() {
  return <footer className="site-footer"><div><strong>轻文档工具箱</strong><p>在浏览器里，轻松处理文件。</p></div><nav aria-label="页脚导航"><Link href="/">全部工具</Link><Link href="/guides">实用教程</Link><Link href="/about">关于我们</Link><Link href="/privacy">隐私政策</Link><Link href="/contact">联系我们</Link></nav><p className="footer-note">文件处理在本机浏览器中完成。网站广告及访问数据的处理方式见隐私政策。</p></footer>;
}

export function CoreLinks() {
  return <section className="content-shell core-links"><p className="eyebrow">从一件小事开始</p><h2>工具与使用指南</h2><div className="content-cards">{coreTools.map(tool => <Link className="content-card" href={tool.href} key={tool.href}><h3>{tool.title}</h3><p>{tool.summary}</p><span>打开工具与教程 →</span></Link>)}</div><Link className="text-link" href="/guides">查看全部实用教程 →</Link></section>;
}

export function ContentPage({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return <main className="content-shell prose-page"><Link className="text-link" href="/">首页</Link><p className="eyebrow">轻文档工具箱 · 使用与支持</p><h1>{title}</h1><p className="page-intro">{intro}</p><div className="article-body">{children}</div></main>;
}
