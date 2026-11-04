// Document processing happens in the browser. Serve the app without Sites
// authentication, storage, or the unused template image transformation service.
import handler from "vinext/server/app-router-entry";
import { usage } from "./usage.mjs";
export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    if (new URL(request.url).pathname === "/api/usage") return usage(request, env.METRICS);
    return handler.fetch(request, env, ctx);
  },
};
