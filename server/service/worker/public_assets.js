import { create_api_object_store } from "../../infra/object_store.js";
import { error_response } from "../../lib/http.js";
import { valid_identifier } from "../../lib/identifiers.js";
import { ScriptVersionModel } from "../../domain/script_version.js";
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/x-icon"]);

// 只把这两种资源映射到固定目录，禁止按任意 R2 key 读取 RSS 或其它对象。
function public_asset(path) {
  const avatar = /^\/public\/avatar\/([A-Za-z0-9-]+)(?:\/([A-Za-z0-9-]+))?$/.exec(path);
  if (avatar) return {
    kind: "avatar",
    source_id: avatar[1],
    key: avatar[2] ? `discovery/avatars/${avatar[1]}/${avatar[2]}` : ""
  };
  const script = /^\/public\/scripts\/([^/]+)\/(.+)\.js$/.exec(path);
  if (!script || !valid_identifier(script[1])) return null;
  const version = ScriptVersionModel.parse(script[2], {
    required: true
  });
  if (!(version.ok && version.model.version === script[2]) && !/^objects\/[a-f0-9]{64}$/.test(script[2])) return null;
  return {
    kind: "script",
    key: `scripts/${script[1]}/${script[2]}.js`
  };
}
export async function public_asset_request(request, env, ctx) {
  const url = new URL(request.url);
  const asset = public_asset(url.pathname);
  if (!asset) return error_response("not found", 404);
  if (!["GET", "HEAD"].includes(request.method)) return error_response("method not allowed", 405, {
    Allow: "GET, HEAD"
  });
  const immutable = Boolean(asset.key) || /^[1-9]\d*$/.test(url.searchParams.get("v") || "");
  const cache_url = new URL(url.origin + url.pathname);
  if (!asset.key && immutable) cache_url.searchParams.set("v", url.searchParams.get("v"));
  const cache_key = new Request(cache_url);
  const cache = immutable ? globalThis.caches?.default : null;
  const cached = await cache?.match(cache_key).catch(() => null);
  if (cached) return request.method === "HEAD" ? new Response(null, {
    headers: cached.headers
  }) : cached;
  try {
    let response;
    if (!asset.key) {
      // 旧 SQLite 头像和没有对象指针的调用继续通过 DO 读取。
      response = await env.APPLICATION.fetch("https://internal/_public/discovery/avatars/" + asset.source_id);
      if (!response.ok) return request.method === "HEAD" ? new Response(null, response) : response;
      response = new Response(response.body, response);
    } else {
      const store = create_api_object_store(env);
      if (!store) return error_response("asset storage is unavailable", 503);
      const object = await (request.method === "HEAD" ? store.head(asset.key) : store.get(asset.key));
      if (!object) return error_response("not found", 404);
      const content_type = asset.kind === "avatar" ? object.httpMetadata?.contentType : "application/javascript; charset=utf-8";
      if (asset.kind === "avatar" && !AVATAR_TYPES.has(content_type)) return error_response("invalid avatar content type", 415);
      response = new Response(request.method === "HEAD" ? null : object.body, {
        headers: {
          "Content-Type": content_type,
          "Content-Length": String(object.size),
          ...(object.httpEtag || object.etag ? {
            ETag: object.httpEtag || `"${object.etag}"`
          } : {}),
          ...(asset.kind === "script" ? {
            "Content-Security-Policy": "sandbox; default-src 'none'"
          } : {})
        }
      });
    }
    response.headers.set("Cache-Control", immutable ? IMMUTABLE_CACHE : "public, max-age=60");
    response.headers.set("X-Content-Type-Options", "nosniff");
    if (cache && request.method === "GET") {
      const pending = cache.put(cache_key, response.clone()).catch(() => {});
      if (ctx?.waitUntil) ctx.waitUntil(pending);else await pending;
    }
    return request.method === "HEAD" ? new Response(null, {
      headers: response.headers
    }) : response;
  } catch {
    return error_response("asset storage read failed", 502);
  }
}
