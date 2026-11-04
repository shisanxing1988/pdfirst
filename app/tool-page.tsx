import Link from "next/link";
import Toolbox from "./toolbox";
import { CoreLinks } from "./site-content";
import { guides, type GuideSlug } from "./tool-guides";

export function ToolPage({ slug }: { slug: GuideSlug }) {
  const guide = guides[slug];
  return <main><section className="content-shell tool-hero"><p className="eyebrow">本地处理 · 无需注册</p><h1>{guide.title}</h1><p className="page-intro">{guide.intro}</p><div className="hero-actions"><Link className="primary-link" href="#workbench">开始处理</Link><Link className="text-link" href={`/guides/${slug}`}>阅读完整教程 →</Link></div></section><section id="workbench" aria-label={`${guide.title}操作区`}><Toolbox key={slug} initialTool={guide.tool} embedded /></section><section className="content-shell article-body"><h2>使用步骤</h2><ol className="step-list">{guide.steps.map(([title, text]) => <li key={title}><h3>{title}</h3><p>{text}</p></li>)}</ol><h2>使用前了解</h2><ul>{guide.tips.map(tip => <li key={tip}>{tip}</li>)}</ul><h2>常见问题</h2>{guide.faqs.map(([question, answer]) => <details className="faq" key={question}><summary>{question}</summary><p>{answer}</p></details>)}</section><CoreLinks /></main>;
}
