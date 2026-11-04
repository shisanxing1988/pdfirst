const events = new Set(["page_view", "files_selected", "demo_loaded", "process_start", "process_complete", "process_error", "save_complete", "download_requested"]);
const channels = new Set(["direct", "search", "referral", "zhihu", "xiaohongshu", "wechat", "community", "test"]);
export async function usage(request, dataset) {
  const headers = { "Cache-Control": "no-store" };
  if (request.method !== "POST") return new Response(null, { status: 405, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin) return new Response(null, { status: 403, headers });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return new Response(null, { status: 415, headers });
  // Bound the actual body, including chunked requests.
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400, headers });
  let raw = "";
  let bytes = 0;
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 512) { await reader.cancel(); return new Response(null, { status: 413, headers }); }
    raw += decoder.decode(value, { stream: true });
  }
  raw += decoder.decode();
  let data;
  try { data = JSON.parse(raw); } catch { return new Response(null, { status: 400, headers }); }
  try {
    if (!data || !events.has(data.event) || !["pdf-seal", "site"].includes(data.tool) || !channels.has(data.channel) || typeof data.demo !== "boolean") return new Response(null, { status: 400, headers });
    if (!dataset) return new Response(null, { status: 503, headers });
    await dataset.prepare("INSERT INTO daily_usage (day, event, tool, channel, mode, count) VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT(day, event, tool, channel, mode) DO UPDATE SET count = count + 1")
      .bind(new Date().toISOString().slice(0, 10), data.event, data.tool, data.channel, data.demo ? "demo" : "real").run();
    return new Response(null, { status: 204, headers });
  } catch { return new Response(null, { status: 503, headers }); }
}
