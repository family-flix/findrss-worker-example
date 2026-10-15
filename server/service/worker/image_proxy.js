import { sha256_hex } from "../../lib/crypto.js";
import { error_response } from "../../lib/http.js";
import { fetch_script_image } from "../../infra/image_proxy.js";

export async function script_image_response(request, { route, descriptor, version, headers }) {
  const url = new URL(request.url);
  const cache_url = new URL("/_image-cache/" + await sha256_hex(JSON.stringify([version, descriptor])), url.origin);
  const cache_key = new Request(cache_url);
  const shared = headers["Cache-Control"].startsWith("public,");
  const cache = shared ? globalThis.caches?.default : null;
  const cached = cache ? await cache.match(cache_key).catch(() => null) : null;
  if (cached) return request.method === "HEAD" ? new Response(null, { headers: cached.headers }) : cached;
  try {
    const image = await fetch_script_image(route, descriptor);
    const result = new Response(image.body, { headers: {
      "Content-Type": image.content_type, "Cache-Control": shared ? "public, max-age=7776000, immutable" : headers["Cache-Control"],
      "X-Content-Type-Options": "nosniff", "Content-Length": String(image.body.byteLength),
    } });
    if (cache) await cache.put(cache_key, result.clone()).catch(() => {});
    return request.method === "HEAD" ? new Response(null, { headers: result.headers }) : result;
  } catch {
    return error_response("image upstream failed", 502);
  }
}
