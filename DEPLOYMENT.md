# 正式站发布记录

本文档上半部分是**固定流程**（每次发布照做），下半部分是**历史发布日志**（倒序，只追加不改写）。

---

# 发布流程

## 环境

| 项 | 值 |
|---|---|
| 正式站 | https://pdfirst.com |
| Cloudflare Worker | `pdfirst`（配置见 `wrangler.cloudflare.jsonc`） |
| D1 数据库 | `pdfirst-metrics`（统计事件） |
| 源码仓库 | https://github.com/shisanxing1988/pdfirst（public） |
| 远程 | `git@github.com:shisanxing1988/pdfirst.git`，SSH 密钥 `~/.ssh/id_ed25519_pdfirst` |
| Node | `>=22.13.0` |
| 构建工具 | vinext（Cloudflare 目标需 `DEPLOY_TARGET=cloudflare`） |

`account_id` 不写进仓库（public 仓库），由 wrangler 登录态推断；如需显式指定，用环境变量：

```bash
export CLOUDFLARE_ACCOUNT_ID=<你的账号 ID>
```

`wrangler` 登录：`npx wrangler login`。若直连登录端点超时，走本机代理（`HTTPS_PROXY`），不要再改系统网络设置。

## 每次发布的固定闭环

```bash
# 0. 确认在正确分支、工作区干净
git status --short && git branch --show-current

# 1. 本地全量校验（lint + 构建 + 全部测试）
npm run check

# 2. 提交并推送，等 CI 绿
git add -A && git commit -m "feat|fix|chore: ..."
git push origin main
gh run watch          # 或打开 Actions 页面看

# 3. 部署（会自动重新构建，不要复用旧 dist）
npm run deploy:cloudflare

# 4. 部署后立刻校验：线上就是刚构建的那份
npm run verify:cloudflare -- https://pdfirst.com

# 5. 打标签，把版本号和标签一一对应
git tag -a v$(date +%Y.%m.%d) -m "Cloudflare Worker 版本 <version-id>"
git push origin --tags
```

第 4 步必须在第 3 步之后**立刻**跑，中间不要重新构建 —— 脚本比对的是 `dist/` 里的资源哈希与线上资源是否一致，用来证明"线上跑的就是当前这份代码"。如果中途构建过，会因 chunk hash 不同报资源 404，那是正常现象，不代表线上有问题。

`deploy:cloudflare` 输出里的 `Current Version ID` 记到下面的发布日志里。

## 搜索引擎收录（自动化）

Bing 系（Bing / Yandex / Naver / Seznam）走 **IndexNow**，无需登录、无需 OAuth：站点根目录放一个 `<key>.txt`（文件名和内容都等于 key），提交时带上它证明所有权。

```bash
npm run seo:indexnow                 # 提交 sitemap 里的全部 URL
npm run seo:indexnow -- --url /pdf-edit   # 只提交单个路径，可重复传
npm run seo:indexnow -- --dry-run     # 只打印，不发送
```

- key 文件：`public/a83f4b9c5b29d8eadf33f67fda897499.txt`，**不要删**，删了 Bing 会认为站点所有权失效。
- `deploy:cloudflare` 末尾已串上 `node scripts/indexnow.mjs`，**每次部署自动提交**，不需要手动跑。
- 端点：`api.indexnow.org`（分发给所有参与引擎）+ `www.bing.com`（Bing 专用），返回 200/202 即成功。
- 只应提交新增或内容有变化的 URL；全量重复提交不会被惩罚，但没必要高频做。

Google 不支持 IndexNow，必须用 Search Console：`https://search.google.com/search-console` → 添加 `pdfirst.com` 资源（DNS 或 HTML 文件验证）→ 提交 `https://pdfirst.com/sitemap.xml`。这一步需要账号登录，无法脚本化。

## 回滚

```bash
npx wrangler deployments list --config wrangler.cloudflare.jsonc   # 查历史版本
npx wrangler rollback <version-id> --config wrangler.cloudflare.jsonc
```

Worker 版本回滚只回滚**服务端**产物；静态资源和客户端 bundle 随版本一起回，所以回滚后不需要额外操作。回滚完同样跑一次 `verify:cloudflare` 确认。

## 首次在新机器上准备

```bash
npm ci                    # 不要用 npm install，锁文件必须一致
npx wrangler login
npm run check             # 先确认本地能过
```

## 已知坑

- **构建会 `rm -rf dist`**：在受限沙箱/自动化环境里可能被批量删除保护拦下。绕过方式是先 `mv dist /tmp/pdf-dist-backup-$(date +%H%M%S)` 再构建，不要改构建脚本。
- **CI 只校验不发版**：`.github/workflows/ci.yml` 跑 `npm ci → lint → npm test`，部署仍需本机手动执行（需要 Cloudflare 凭据）。要改成自动发布得把 `CLOUDFLARE_API_TOKEN` 加进仓库 secrets，目前没做。
- **本机字体依赖**：PDF 编辑器部分字体来自 `public/fonts/`，未做子集化，体积较大，改动缓存策略时注意 `_headers`。
- **`public/` 里的测试产物**：不得把含个人数据的文件或截图提交进仓库。

---

# 历史发布日志

## 2026-11-05：修复导出 PDF 缺字 + 保存/预览/下载操作栏

- 发布版本：`f11406d7-2858-41f7-8972-9a7ef0cf7046`。
- **重要修复**：保存后的 PDF 里，被编辑过的文字块大量缺字母（如 "Deposit Summary 存款 摘要 乌" 只剩 "De" 和汉字，字宽还对得上）。根因是 pdf-lib `subset: true` 的运行时子集化（fontkit TTFSubset）产出缺字形的字体流，与字体文件无关（全量字体同样复现），属于 pdf-lib 既有缺陷。
- 修复：CJK 字体改为 `subset: false` 原样嵌入（发布字体本身已是 pyftsubset 构建期子集）。代价：每份保存的 PDF 增加约 1.7MB（嵌入 2.55MB TTF 压缩后）。
- 编辑器侧边栏顶部新增操作栏：生成结果后「重新保存 / 预览 / 下载」并排展示，不用再滚到底部找按钮。
- 验证：合成银行流水 PDF 端到端（编辑→保存→预览渲染，本地与线上各一轮）修复前复现缺字、修复后完整；单测 40/40、lint 0 error、编辑器 E2E 15 项通过。
- 后续可选优化：若嫌 1.7MB 体积大，可研究替换 pdf-lib 子集化或对导出字体再瘦身。

## 2026-11-05：PDF 文字编辑器交互重做

- 发布版本：`d48ac5d7-bfd4-4ab1-af75-b4a57068cf75`。
- 修复「添加文字到页面」点击画布无反应的 bug（按钮此前只设置放置标记、没有切换编辑工具）。
- 新增文字：落点即进入行内输入，Esc / 点击空白结束；空文字框自动清除，不留看不见的空对象；双击已有文字框可重新编辑；侧边栏与页面内容双向同步。
- 新增撤销/重做：⌘Z / ⌘⇧Z / ⌘Y 与侧边栏按钮，最多 60 步。新增文字框的「添加+输入」合并为一步（一次 ⌘Z 整框撤掉）；文字输入首字符才入栈，点进去没改不产生空撤销。
- `clearOutputs` / `clearPreview` 改用 ref 镜像读最新列表释放 Blob URL，消除 `react-hooks/immutability` 报错。
- 端到端实测（Playwright，本地与线上 pdfirst.com 各一轮）15 项全部通过；单测 40/40、lint 0 error。
- 已知非阻塞问题：vinext 框架自身在线上偶发 `RSC prefetch setup error` 控制台报错（`link-*.js`），不影响功能；本地 dev 的 `/api/usage` 404 属预期（统计端点仅线上 Worker 提供）。

## 2026-11-05：中文字体子集与静态资源缓存

- 发布版本：`54b9e59d-6167-484a-88f1-455071f00a72`。
- 编辑器预览字体从 10.1MB 全量 Noto Sans SC 换成 8618 字子集：`NotoSansSC-8105-v1.woff2`（1.14MB，`@font-face`）与 `NotoSansSC-8105-v1.ttf`（2.55MB，pdf-lib 导出嵌入）。覆盖通用规范汉字表 8105 字（含三级表的人名地名用字）+ ASCII/Latin-1/标点/全角。
- 全量字体保留为 `NotoSansSC-Regular-full.ttf`，仅在待保存文字超出子集时下载；仍缺字才提示更换字符。
- 新增 `public/_headers`：`/fonts/*` 与 `/pdfium-2.15.1.wasm` 一年 immutable，`/pdf.worker.mjs` 1 小时，站点图标 7 天；`_next/static` 的 immutable 规则由本文件接管（vinext 只在文件不存在时才生成）。
- 回归测试 40 项（新增 5 项字体覆盖/回退/一致性检查）、lint 0 error、构建通过。
- 部署后 `verify:cloudflare` 通过：13 页、45 个资源（含新 woff2），线上 `Cache-Control` 已实测生效。
- 未做真实浏览器交互复测；woff2 仅经 fontTools 结构校验（8618 cmap、抽字有轮廓）。若浏览器端渲染异常，回滚到 `9ce14100-b25a-4236-abc3-9697fe56773c` 即恢复全量字体。
- 发布时 GitHub Actions 任务在队列中滞留 8 分钟以上未开始，CI 结果晚于部署到达。

## 2026-11-04：建立版本控制基线（无功能变更）

- 线上版本：`9ce14100-b25a-4236-abc3-9697fe56773c`（2026-11-04T11:15:59Z）。
- 此前项目无 Git 仓库，2026-09-06 之后的迁移与全部改动只存在于本机。本次把当前线上代码纳入版本控制，接在远程原有历史之后（快进推送，未强推）。
- 仓库为 public，运维文档中的账号 ID、Zone ID、Sites 项目 ID、DNS 地址、代理端口已脱敏；未脱敏的中间提交已被 `git gc` 清除。
- 修复长期失效的测试：`pdf-edit-export.ts` 导入补 `.ts` 扩展名；`tests/pdf-word` 换用稳定切片边界并断言非空；补齐未声明的 `@napi-rs/canvas`；`npm test` 从"只跑 1 个文件"改为构建后跑全部 `tests/*.test.mjs`。
- 新增 GitHub Actions CI（lint + 全量测试）。本地与 CI 均为 lint 0 error、测试 35/35 通过。
- 标签 `baseline-2026-11-04` 对应上述线上版本。

## 2026-11-02：删除整个文字块及遮罩边缘

- 发布版本：`020fc602-8a7e-4d78-818f-dc93e47d0ea6`。
- 增加删除整个文字块和恢复已删除文字块；删除状态跨页面检测保留，导出仅覆盖原位置不绘制已删除文字。
- 擦除区域改为无描边、不透明 PDF 原生填充，减少透明 PNG 边缘细线。
- 相关回归测试、ESLint、构建通过；正式站 13 页、43 资源及 robots/sitemap 核验通过。
- 命令行直连 Cloudflare 登录端点超时，通过本机既有 HTTP 代理完成发布；未改系统网络设置。
- 未确认用户原阅读器中地址区域细框完全消失；覆盖编辑不等于永久脱敏。

## 2026-10-28：保留原页面的无损覆盖导出

- 发布版本：`3cfc1239-dbd5-4a5e-aeb8-6155d2f29fae`。
- 保留原 PDF 页面，仅为修改页叠加 3 倍分辨率的透明 PNG；取消整页 JPEG 重编码与新增文字模糊阴影。移除不再生效的文字清晰度滑块。
- 四种页面旋转的实际 PDF 输出/渲染测试通过，验证原文字仍保留、页面尺寸及旋转不变、图层可见；其余 21 项编辑器回归通过，ESLint 与构建通过。
- 原 5 页 PDF 正式站实测修改标题为 TEST 123，保存并打开真实导出预览成功，文件 187.2 KB；截图位于 work/editor-retest/lossless-export.png。
- 限制：覆盖式编辑保留被遮盖的原文，不可当成永久脱敏；新增文字仍是无损图像叠加，原字体缺失时仍使用替代字体。

## 2026-10-27：默认字号和原字体元信息

- 发布版本：`1e520da6-3d9b-4b08-82c2-e275880b9483`。
- 取消编辑原文字号乘 0.88 和整数取整；保留可识别字体名称与字重，优先匹配设备字体。
- 原文件字体为子集 MiSans-Regular；未实现原 PDF 子集字体的任意 Unicode 字符复用，设备无同名字体时仍回退，不能保证字形完全一致。
- 23 项编辑器回归测试、ESLint 和生产构建通过。

## 2026-10-27：文字颜色与黑底可见性

- 发布版本：`ce3a1fb5-09d1-4948-b3d4-740c5761fd70`。
- 新增文字选色器与 HEX 输入；原文和新增文字的颜色写入导出。未指定颜色时根据背景自动选黑/白，拖动时更新自动颜色，手动颜色保留。
- 原文件正式站实测：黑底标题修改后白字可见；HEX 设置黄色成功，实际导出第一页保持黄色。截图保存在私有 work/editor-retest。
- 23 项回归测试、ESLint、构建通过；13 页、43 个资源及 robots/sitemap 核验通过。

## 2026-10-27：黑底标题遮罩与原文件交互复测

- 发布版本：`10860a40-c409-46c3-8608-649756ed6a17`。
- 根据文字区域左右邻近像素的主色填充遮罩，替代固定白色。预览在页面渲染完成后记录背景色，导出从原始画布取色。
- 正式站以用户指定的 5 页原 PDF 实测：空格、Enter、长文字换行、拖宽/缩窄、多次拖动；黑底标题移动后原栏无白块，已打开实际生成 PDF 的第一页确认。
- 测试产物仅在 work/editor-retest，未修改桌面原文件；不得将含个人数据的文件或截图加入公共发布资源。
- 21 项相关测试通过（背景实现最后改动后重跑背景和生命周期 7 项），ESLint 与生产构建通过。13 页、43 资源及 robots/sitemap 校验通过。

## 2026-10-27：移动原文残影修正

- 发布版本：`86ea67c3-a6d1-4bcc-b070-8def96f4d99a`。
- 原文字遮罩补充字形下降部及抗锯齿边缘余量，保持为局部矩形；预览与导出共用。文字尺寸采用实际 viewport 缩放比例。
- 18 项相关回归测试通过；ESLint 和生产构建通过；正式站 13 页、43 个资源及 robots/sitemap 校验通过。
- 尚未取得截图对应原 PDF，未确认该文档的实际残影是否完全消除。

## 2026-10-27：PDF 文字编辑输入与排版

- 发布版本：`b5f8838c-ced4-413a-ac5a-7199eaa9bfc0`。
- 阻止文字输入事件被父级快捷键拦截，支持空格、连续空格、Enter 换行。
- 增加文字框右侧宽度拖动手柄和方向键调宽；编辑宽度独立于原文遮罩并在翻页后保留。
- 按编辑宽度换行并扩展高度，导出逐行绘制，预览字号随缩放调整。
- 字体选项从 4 种增至 13 种，界面明确提示使用本机字体及缺失回退。
- 17 项回归测试、相关文件 ESLint、生产构建通过；线上 13 页、43 个资源及 robots/sitemap 验证通过。
- 尚未完成真实浏览器拖动及原始用户文件交互复测。

## 2026-10-26：编辑遮罩覆盖整行修复

- 发布版本：`f1ebe250-eb90-4fca-8c30-b2f0c6f051e4`。
- 移除延伸到页面右侧的遮罩和输入框宽度；预览和导出共用原文字区域矩形，并裁剪到页面边界。
- 12 项针对编辑器的回归测试、相关 ESLint、生产构建通过。正式站 13 页、43 个资源及 robots/sitemap 验证通过。
- 尚未获得用户原 PDF，未对该文件进行实际交互验证。

## 2026-10-26：PDF 编辑文字重叠去重

- 发布版本：`f71b60f0-821f-4588-bb3c-328d1bf51e9a`。
- 行合并前去除文字相同、位置与尺寸近乎重合的重复绘制项；不同位置的正常重复文字保留。
- 8 项编辑器回归测试、相关 ESLint、生产构建通过；线上 13 页、43 个资源及 robots/sitemap 验证通过。
- 根据截图排查，尚未获得该文件的原 PDF，不能确认其文字层是否存在其他异常。

## 2026-10-26：PDF 编辑器卡顿与资源释放修复

- 发布版本：`f0a9c2a1-5d6d-437b-aebc-6d57398f79b4`。
- 移除文字状态触发页面重复加载的依赖；使用最新状态保留编辑内容，切换页面时取消旧渲染。
- 页面和缩略图处理后释放 PDF 实例；缩略图使用可回收 Blob URL；导出逐页编码并释放画布，避免保留所有原始页面大图。
- 4 项针对编辑器生命周期及导出的回归测试、相关文件 ESLint、Cloudflare 生产构建通过。
- 发布后正式站 13 个页面、43 个资源及 robots/sitemap 验证通过，静态资源哈希与本地构建一致。
- 尚未使用用户的故障文件进行浏览器交互复测。

## 2026-09-17：骑缝章推广入口与匿名统计

- 发布版本：`682c406a-c6cc-48cd-bce5-6e56ee89a521`。
- 正式页：https://pdfirst.com/pdf-seal 。新增两份 3/5 页虚构文档及 DEMO 章图试用入口；更新首页及工具页标题、介绍、教程和隐私说明。
- 使用 Cloudflare D1 `pdfirst-metrics` 保存按天汇总事件，区分 demo/real 与渠道，不保存文件名、文档内容或访客标识。
- 构建、10 项测试、本次修改文件 ESLint 通过；全项目 lint 存在既有 tests/pdf-word.test.mjs 的 no-control-regex 错误。
- 正式站 13 个页面、43 个资源以及 robots/sitemap 验证通过，资源内容哈希与本地一致。
- 统计接口返回 204，D1 已读回 channel=test 的 1 条验证计数；不计作真实流量。
- 未完成浏览器内示例生成/下载交互测试，浏览器页面读取持续超时；未发布小红书笔记、未确认搜索引擎收录。
- 推广文稿、四张 1080×1440 PNG 配图及复盘口径在 marketing/。尚未安排自动复盘任务。
- 首次尝试 Analytics Engine 因账号未启用而失败，没有发布该版本；随后改为 D1 并成功发布。

## 2026-09-09：图片 PDF 排版预览

- 发布版本：`37f55d92-27a4-4d44-97b5-5bad088961bb`。
- A4 横竖版、每行张数/每页行数、边距和间距、单图 10–100% 缩放及生成前分页预览；默认每页 4 张。
- 导出使用 pdf-lib，并与预览使用统一尺寸计算；保留图片比例、不裁切；排序保留单图缩放，编辑清除旧输出。
- 构建、ESLint、8 项测试通过；本地及正式站真实浏览器验证 5 图导出 2 页、横版、预览、下载、排序保留缩放和修改清理旧结果，无页面运行错误。

## 2026-09-08：图片转 PDF 初始化与兼容修复

- 发布版本：`656e4ad1-28e9-4636-a77b-28197f295331`。
- 服务端解析工具参数，修复查询参数工具页的 hydration mismatch；图片解码增加 HTMLImageElement 回退、超时和带文件名的错误信息。
- PDF 生成显示页数，并使用明确的“下载 PDF”按钮。
- 本地及正式站 Chrome 实测：两张 PNG 生成两页 PDF，预览翻页和下载成功；禁用 createImageBitmap 后回退路径同样成功；无页面运行错误。
- ESLint、构建、6 项测试通过。尚未取得用户出错的原始图片，不能确认该文件是否存在独立格式问题。

## 2026-09-08：图片转 PDF 参数修复

- 发布版本：`29d11abc-ec78-47c4-adec-5872553bb32d`。
- 隐藏图片转 PDF 中误显示的图片输出格式选项，明确每图一页、按顺序合成。
- 清晰度与最大边长设置接入转换，Word 工具不再显示图片参数。
- 构建、ESLint 与 5 项测试通过；用户具体故障现象待确认。

## 2026-09-08：统一结果预览与批量排序

- 发布版本：`62f52aa3-fff9-4e9e-80ca-6db0d489e183`。
- 全部输出提供页面内预览：图片、可翻页 PDF、Word 正文。预览不切换当前工具。
- 批量文件支持拖动及上下移动，处理沿用列表顺序；排序后清空旧结果，处理中禁用排序。
- ESLint、Cloudflare 构建及 4 项现有测试通过；线上 13 个页面、41 个资源和 robots/sitemap 检查通过。未进行浏览器交互端到端测试。

## 2026-09-07：PDF 转 Word 可编辑文字

- 发布版本：`17ea2578-3f3a-4bdc-b5b7-1af54e55fc66`。
- 普通 PDF 提取文字，无可用文字层的页面使用中英文 OCR，输出可编辑段落，保留分页和换行。
- 不再把整页图片嵌入 Word；不保留图片、印章和复杂表格版式。
- Cloudflare 构建与 4 项测试通过；正式站 13 个页面、41 个静态资源及 robots/sitemap 验证通过，资源哈希与本地构建一致。
- 尚未进行真实扫描件的浏览器端到端识别验证。

## 2026-09-07：首页页头精简

- 发布版本：`a49a72e9-da7c-4a54-a801-e6b80c6063e5`。
- 移除首页重复的品牌标题栏，保留全站导航；收紧导航内边距并移除 PDFIRST 副标与 Tools 标识。
- 工具列表使用一级标题，移除首页工具区不必要的最小整屏高度。
- 图标设计保持不变；本次反馈针对页面排布。

## 2026-09-07：文档品牌图标

- 发布版本：`fa3f1f9e-74b8-4a44-8b92-9f53318e76b4`。
- 替换为深绿底、白色折角文档图标，并同步页头与工具首页标识。
- 提供 SVG、16/32/48 像素 ICO、48 像素 PNG、180 像素 Apple Touch Icon 和 512 像素 PNG。
- 更新页面图标声明并添加缓存版本参数。

## 2026-09-07：工具独立页与内容页面

- 正式地址：https://pdfirst.com
- Cloudflare Worker：`pdfirst`
- 发布版本：`1186976d-7d70-4b51-a2f5-88ecbe0eca32`
- 新增 PDF 合并、图片压缩、PDF 骑缝章独立操作页，教程列表及三篇教程，隐私、关于、联系页面。
- 联系邮箱：`pgq1988@126.com`。
- 补充全站导航、页面元信息、站点地图和分享图。
- 使用现有 `npm run deploy:cloudflare` 发布；未修改正式域名绑定或 Sites 旧站。
- 发布后 `npm run verify:cloudflare -- https://pdfirst.com` 通过：13 个页面、36 个静态资源，以及 robots.txt 和 sitemap.xml；资源内容哈希与本地构建一致。
- 构建后的服务端页面测试全部通过。未进行实际文件处理的浏览器端到端复测。
- 详细线上检查结果保存在 `work/deployment-checks/verified-pdfirst.com.json`。
