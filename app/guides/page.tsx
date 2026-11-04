import Link from "next/link";
import { ContentPage } from "../site-content";
import { guides } from "../tool-guides";
export const metadata = { title: "实用教程 | 轻文档工具箱", description: "PDF 合并、图片压缩与 PDF 骑缝章的具体操作示例、参数说明和排错指南。", alternates: { canonical: "/guides" } };
export default function Page() {
  return <ContentPage title="实用教程" intro="从具体的文件处理任务出发，了解操作步骤、检查方法和工具边界。"><div className="content-cards">{Object.entries(guides).map(([slug, guide]) => <Link className="content-card" key={slug} href={`/guides/${slug}`}><p className="eyebrow">{guide.title}</p><h2>{guide.guideTitle}</h2><p>{guide.intro}</p><span>阅读教程 →</span></Link>)}</div></ContentPage>;
}
