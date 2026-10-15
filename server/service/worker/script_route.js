import { public_rss_route } from "./rss.js";
import { script_media_response } from "./media_proxy.js";
import { script_output } from "../../lib/script_output.js";

export async function public_script_route(env, request) {
  const response = await public_rss_route(env, request, new URL(request.url).pathname, "raw");
  if (!response.ok) return response;
  const { raw, route, version, headers } = await response.json();
  const result = script_output(route, raw);
  if (result.descriptor) return script_media_response(request, { route, descriptor: result.descriptor, kind: result.kind, version, headers });
  return new Response(request.method === "HEAD" ? null : result.body, { headers: {
    ...headers, "Content-Type": result.content_type, "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
  } });
}
