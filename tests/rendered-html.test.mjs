import assert from "node:assert/strict";
import test from "node:test";

async function render(route = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${route}`, {
      headers: { accept: "text/html", host: "localhost" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the document toolbox homepage", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>PDF 批量骑缝章、合并与图片压缩 \| 轻文档工具箱<\/title>/i);
  assert.match(html, /轻文档工具箱/);
  assert.match(html, /图片压缩/);
  assert.match(html, /合并 PDF/);
  assert.match(html, /PDF 原文编辑/);
  assert.match(html, /Word 转 PDF 骑缝章/);
});

test("core tool pages render the correct workbench and crawlable instructions", async () => {
  for (const [route, title, control] of [["/pdf-merge", "PDF 合并", "先选择 PDF 文件"], ["/image-compress", "图片压缩", "清晰度"], ["/pdf-seal", "PDF 骑缝章", "上传合同章图片"]]) {
    const response = await render(route);
    assert.equal(response.status, 200, route);
    const html = await response.text();
    assert.ok(html.includes(title), route);
    assert.ok(html.includes(control), `${route}: correct workbench`);
    assert.ok(html.includes("使用步骤"));
    assert.ok(html.includes("常见问题"));
    assert.ok(html.includes(`href="http://localhost${route}"`), `${route}: canonical`);
    assert.ok(html.includes(`href="/guides${route}"`), `${route}: tutorial link`);
  }
});

test("tutorials and support pages are public and contain substantive content", async () => {
  for (const [route, text] of [["/guides", "实用教程"], ["/guides/pdf-merge", "9 页 PDF"], ["/guides/image-compress", "4000"], ["/guides/pdf-seal", "5 页 PDF"], ["/about", "明确功能边界"], ["/privacy", "Google 广告与 Cookie"], ["/contact", "mailto:pgq1988@126.com"]]) {
    const response = await render(route);
    assert.equal(response.status, 200, route);
    const html = await response.text();
    assert.ok(html.includes(text), route);
    assert.match(html, /href="\/privacy"/);
    assert.match(html, /href="\/contact"/);
  }
  const missing = await render("/guides/nonexistent");
  assert.equal(missing.status, 404);
});

test("query-selected image PDF tool renders with PDF controls on the server", async () => {
  const response = await render('/?tool=image-pdf');
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /输出格式：PDF/);
  assert.match(html, /先选择图片文件/);
  assert.doesNotMatch(html, /<option value="image\/webp"/);
});
