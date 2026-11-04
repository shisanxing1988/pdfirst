// Only fixed labels are sent: never file names, document contents or full URLs.
export function track(event: string, tool = "site", demo = false) {
  if (tool !== "pdf-seal" && tool !== "site") return;
  try {
    if (navigator.doNotTrack === "1") return;
    const params = new URLSearchParams(location.search);
    const source = params.get("utm_source") ?? "";
    const allowed = ["zhihu", "xiaohongshu", "wechat", "community", "test"];
    let channel = allowed.includes(source) ? source : "direct";
    if (channel === "direct" && document.referrer) {
      const host = new URL(document.referrer).hostname;
      if (host !== location.hostname) channel = /(^|\.)(google\.[a-z.]+|baidu\.com|bing\.com)$/.test(host) ? "search" : "referral";
    }
    void fetch("/api/usage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, tool, channel, demo }), keepalive: true }).catch(() => {});
  } catch { /* Measurement must never interrupt local file processing. */ }
}
