# Cloudflare 独立托管迁移

更新日期：2026-09-07。

## 当前状态

- 已发布并验证的新站：https://preview.pdfirst.com/
- Cloudflare 默认地址：https://pdfirst.shisanxing1988.workers.dev/ （本次本机网络访问超时，使用测试域名验证）。
- 正式域名：https://pdfirst.com/ 。已成功直接绑定到自己账号中的 `pdfirst` Worker。
- 已使用限定域名的 DNS Token 备份并移除两条旧 A 记录；Cloudflare 已自动建立 Worker 管理的代理记录。
- 已解除 Sites 上的 `pdfirst.com` 绑定，复查 Sites 自定义域名列表为空。
- 公共 DNS 校验通过后，本机使用的 `223.5.5.5` 曾返回旧 Sites 地址，随后已刷新；当前本机直连 HTTPS 返回 200。系统 HTTP 代理仍复现旧地址的 `1034`，已保留原有 Wi-Fi 代理例外并追加 `pdfirst.com`，让本站直连。原例外列表备份在 `work/cloudflare-migration/proxy-bypass-before.txt`。浏览器恢复状态仍需用户刷新确认。
- Sites 项目和第 41 版保留，未删除或重新部署旧站。
- `wrangler.cloudflare.jsonc` 中正式域名和测试域名的直接绑定均已部署成功。

## 资源与备份

| 项目 | 值 |
| --- | --- |
| Cloudflare 账号 | `REDACTED`（32 位账号 ID，见本地部署记录） |
| pdfirst.com Zone | `REDACTED` |
| Worker | `pdfirst` |
| 已验证的新站版本 | `08455a1b-d5eb-4798-a742-5c36a8f534d0` |
| 迁移前账号中已有的 Worker 版本 | `f978d01a-296a-49ea-8b89-35acabdda367` |
| Sites 项目 | `REDACTED` |
| Sites 版本 | `41` |
| Sites 源码提交 | `30def8fe8a1c4fdd8ea67fb28821db8eb5e592fc` |
| Sites 原始入口（本次自动请求被安全规则拦截） | https://qingwendang-tools.xyj19881122.chatgpt.site/ |

本机备份在 `work/cloudflare-migration/`（Git 忽略，不含登录 Token）：

- `sites-v41-source.tar.gz`：迁移前完整 Git 源码快照。
- `zones-before.json`、`worker-domains-before.json`、`routes-before.json`：迁移前控制面信息。
- `existing-worker-settings.json`：原有 Cloudflare Worker 设置。
- `verified-preview.pdfirst.com.json`：测试域名逐项校验结果。
- `dns-apex-original.json`：切换前真实 DNS 备份，包含两条 A 记录（Cloudflare 代理地址）、均为 DNS only、TTL 自动，以及原记录 ID。
- `dns-apex-before.json`：早期权限错误响应，**不是有效 DNS 备份**。
- `../deployment-checks/verified-pdfirst.com.json`：正式域名 3 个页面及 22 个资源的验证结果。
- `verify-public-dns.mjs`：在本机系统解析缓存未刷新时使用公共 DNS 运行相同校验，保持正常 HTTPS 校验。

## 发布与验证

```bash
npm run deploy:cloudflare
npm run verify:cloudflare -- https://preview.pdfirst.com
npm run verify:cloudflare -- https://pdfirst.com
```

`deploy:cloudflare` 使用自己的 Cloudflare 账号构建并发布，不调用 Sites。
`npm run build` 保留原 Sites 构建方式，`.openai/hosting.json` 和 Sites 版本未修改。

本次通过：

- Cloudflare 构建、Wrangler 打包与线上部署；Worker 启动时间 18 毫秒。
- 现有首页服务端渲染测试。
- 本次新增/修改代码的 ESLint 检查。
- 测试域名的首页、PDF 编辑入口、PDF 骑缝章入口均返回 HTTPS 200。
- 22 个脚本、样式、字体、图标与 PDF.js Worker 资源，远程内容 SHA-256 与本地构建一致。
- 清除迁移自旧目录的字体缓存，并重新下载字体，消除旧本地绝对路径。

验证范围：页面与资源验证不是实际文件转换的完整浏览器端到端测试。浏览器自动控制连接反复超时，未据此声称文件转换全部复测。全项目 TypeScript 检查另有原有 `app/page.tsx` 的 BlobPart/类型收窄及旧 Worker 模板类型错误；本次未修改这些产品逻辑。

## 正式切换记录（已完成）

1. 获得仅限 `pdfirst.com` 的 DNS 读取/编辑权限，或通过已登录的 Cloudflare 控制台操作。
2. 备份根域名现有 DNS 记录的内容、类型、TTL、代理状态和记录 ID。
3. 仅移除妨碍 Worker 直接域名绑定的根域名记录，保留邮件及验证等其他记录。
4. 用已验证的构建绑定正式域名：`wrangler triggers deploy --config dist/server/wrangler.json`。
5. 如原 Sites 自定义域名仍优先接管流量，再解除 Sites 上的 `pdfirst.com` 绑定；保留 Sites 项目、版本与原始入口。
6. 用 `npm run verify:cloudflare -- https://pdfirst.com` 核对页面与全部资源；同时确认旧站仍保留。

不能只增加 `pdfirst.com/*` 路由：本次实际检测仍经过 Sites 的 Cloudflare for SaaS 入口并返回其 403 页面。

## 回退

建议观察至少 14 天再决定是否清理旧站；未安排自动删除。

### 回退 Cloudflare 中的网站版本

已验证版本可通过下列命令恢复（不会恢复 Sites 托管或 DNS）：

```bash
npx wrangler rollback 08455a1b-d5eb-4798-a742-5c36a8f534d0 --config wrangler.cloudflare.jsonc
```

### 切回 Sites 托管

1. 先确认原 Sites 版本和原始入口可用。
2. 如 Sites 域名绑定已解除，重新添加 `pdfirst.com`，按 Sites 返回值恢复验证记录。
3. 解除自己的 Worker 对 `pdfirst.com` 的直接绑定，恢复切换前备份的 DNS 记录。
4. 刷新 Sites 域名验证并检查 HTTPS 和页面访问。

切换前真实 DNS 已保存为 `work/cloudflare-migration/dns-apex-original.json`。移除自己的 Worker 正式域名绑定后，可运行 `node work/cloudflare-migration/dns.mjs restore` 恢复这两条原记录；该脚本会拒绝覆盖未预期的新地址记录。Sites 上原域名绑定已解除，回退必须重新添加并按最新返回值验证；原绑定 ID 不可再用。

直接绑定会改变 DNS。**不能仅删除 Worker 绑定就认为已经切回旧站**，必须完成 DNS 与 Sites 域名验证恢复。
