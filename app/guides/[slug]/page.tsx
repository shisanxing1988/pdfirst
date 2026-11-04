import Link from "next/link";
import { notFound } from "next/navigation";
import { ContentPage } from "../../site-content";
import { guides, type GuideSlug } from "../../tool-guides";

function getGuide(slug: string) {
  if (!Object.hasOwn(guides, slug)) notFound();
  return guides[slug as GuideSlug];
}
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = getGuide(slug);
  return { title: `${guide.guideTitle} | 轻文档工具箱`, description: guide.description, alternates: { canonical: `/guides/${slug}` } };
}
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = getGuide(slug);
  return <ContentPage title={guide.guideTitle} intro={guide.intro}><p className="article-date">更新于 2026 年 9 月 7 日 · 轻文档工具箱</p><aside className="example-box"><h2>先看一个实际场景</h2><p>{guide.scenario}</p></aside><h2>一步一步操作</h2><ol className="step-list">{guide.steps.map(([title, text]) => <li key={title}><h3>{title}</h3><p>{text}</p></li>)}</ol><h2>检查结果与处理限制</h2><ul>{guide.tips.map(tip => <li key={tip}>{tip}</li>)}</ul><h2>遇到问题时</h2>{guide.faqs.map(([q, a]) => <section key={q}><h3>{q}</h3><p>{a}</p></section>)}<div className="hero-actions"><Link className="primary-link" href={`/${slug}#workbench`}>打开{guide.title}工具</Link><Link className="text-link" href="/guides">返回教程列表</Link></div><p>仍无法处理？请通过<Link href="/contact">联系页面</Link>提供浏览器版本、文件大小与错误提示，避免发送含敏感信息的原文件。</p></ContentPage>;
}
