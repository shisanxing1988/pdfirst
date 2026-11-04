import Link from "next/link";
import { ContentPage, CoreLinks } from "../site-content";
export const metadata = { title: "关于我们 | 轻文档工具箱", description: "了解轻文档工具箱的用途、本地文件处理方式与功能边界。", alternates: { canonical: "/about" } };
export default function Page() {
  return <><ContentPage title="关于轻文档工具箱" intro="把常用的文档处理做得更轻一些，让整理文件成为一件顺手的小事。"><h2>我们做什么</h2><p>轻文档工具箱面向需要整理 PDF、图片和 Word 文件的中文用户，提供 PDF 合并与拆分、图片压缩与格式转换、PDF 编辑以及骑缝章等轻量工具。你可以从一个具体任务开始，不需要先注册账户。</p><h2>文件如何处理</h2><p>当前工具的文件处理在本机浏览器中完成。你选择的文件由页面读取并生成结果，本站的处理功能不会把文件上传到服务器。处理速度与可处理的文件大小取决于你的设备、浏览器和文件本身。</p><p>文件本地处理不意味着浏览网站没有网络请求。网页资源、托管服务和 Google 广告可能涉及访问数据，详情请阅读<Link href="/privacy">隐私政策</Link>。</p><h2>明确功能边界</h2><p>我们尽量在每个工具旁说明输出方式和限制。例如，图片压缩不保证固定压缩比例；PDF 转 Word 输出可编辑文字，扫描件自动识别中英文，但不保留图片及复杂版式，识别结果需要核对；骑缝章工具添加章图，不提供数字签名或身份验证。</p><h2>反馈帮助我们改进</h2><p>如果某一步难以理解、输出结果异常，或你希望增加某个功能，请发送邮件至 <Link href="mailto:pgq1988@126.com">pgq1988@126.com</Link>。提供具体操作步骤与不含敏感内容的示例说明，更有助于定位问题。</p></ContentPage><CoreLinks /></>;
}
