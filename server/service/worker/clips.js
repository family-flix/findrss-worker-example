import { API_OBJECT_NAME } from "../../lib/constants.js";
import { error_response } from "../../lib/http.js";
import { do_error } from "../durable_object/error.js";

// Count streamed bytes too: Content-Length can be absent or inaccurate after proxying.
export async function read_clip_json(request, max_bytes) {
  if (Number(request.headers.get("Content-Length")) > max_bytes) throw do_error("剪藏数据过大", 413);
  const reader = request.body?.getReader();
  if (!reader) throw do_error("缺少剪藏数据", 400);
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max_bytes) { await reader.cancel(); throw do_error("剪藏数据过大", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw do_error("剪藏数据不是有效 JSON", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw do_error("剪藏数据格式错误", 400);
  return body;
}

export async function public_clip_request(request, env, id) {
  const allowed = ["GET", "HEAD"];
  if (!allowed.includes(request.method)) return error_response("method not allowed", 405,
    { Allow: allowed.join(", ") });
  return env.API.getByName(API_OBJECT_NAME).fetch(new Request(`https://internal/_public/clips/${id}`, request));
}

export function admin_clip_request(request, env) {
  if (request.method !== "GET" && request.headers.has("Origin") && request.headers.get("Origin") !== new URL(request.url).origin) {
    return error_response("origin rejected", 403);
  }
  const target = new URL(request.url);
  const forwarded = new Request("https://internal" + target.pathname.replace("/admin/api/", "/_admin/"), request);
  return env.API.getByName(API_OBJECT_NAME).fetch(forwarded);
}
