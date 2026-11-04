import Link from "next/link";
import { ContentPage } from "../site-content";
export const metadata = { title: "联系我们 | 轻文档工具箱", description: "通过邮箱反馈工具问题、功能建议或隐私相关请求。", alternates: { canonical: "/contact" } };
export default function Page() {
  return <ContentPage title="联系我们" intro="有使用问题、功能建议或隐私相关请求，可以通过邮件联系我们。"><div className="example-box"><p className="eyebrow">联系邮箱</p><Link className="contact-email" href="mailto:pgq1988@126.com">pgq1988@126.com</Link><p>点击邮箱可打开你的邮件应用，也可以复制地址到常用邮箱发送。本站不提供在线工单提交。</p></div><h2>反馈问题时，请附上</h2><ul><li>使用的工具名称与页面地址。</li><li>设备类型、浏览器名称与版本。</li><li>文件格式、大致大小与页数，不必发送原文件。</li><li>出现问题前的操作步骤、页面提示，以及你期望的结果。</li></ul><h2>保护你的文件信息</h2><p>请不要直接发送身份证件、完整合同、个人章图或其他敏感原件。若需要示例，优先使用去除敏感内容的文件或文字描述。</p><h2>隐私相关请求</h2><p>邮件标题可注明“隐私请求”，并说明涉及的邮件往来或其他信息。我们会使用你提供的信息核实并处理请求；本站没有可供查询或找回的文件上传记录。详情见<Link href="/privacy">隐私政策</Link>。</p><h2>发送前也可以看看</h2><p>常见的排序、压缩与章图位置问题，已整理在<Link href="/guides">实用教程</Link>中。</p></ContentPage>;
}
