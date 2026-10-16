import { proxy_target_url } from "@findrss/feed-fetch";
import { error_response, json_response } from "../../lib/http.js";
import { rss_fetch_headers, RSS_FETCH_CREDENTIAL_HEADERS } from "../../infra/rss_fetch_headers.js";
import { rss_response_text } from "../../infra/rss_response_text.js";
import { cookie_header } from "../../infra/rss_cookies.js";
import { API_OBJECT_NAME } from "../../lib/constants.js";

const preview_bytes = 64 * 1024;
// shortcut: 媒体预览最多读取 16MB，需要播放更大的媒体时改用流式预览接口。
const media_preview_bytes = 16 * 1024 * 1024;

function response_kind(type, disposition) {
  if (/^attachment\b/i.test(disposition)) return "file";
  if (type.startsWith("image/")) return "img";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (!type || type.startsWith("text/") || /(?:json|xml)$/.test(type) || /^application\/(?:x-)?(?:java|ecma)script$/.test(type)) return "text";
  return "file";
}

function response_file(response, url, type) {
  const disposition = response.headers.get("Content-Disposition") || "";
  const extended = /(?:^|;)\s*filename\*\s*=\s*(?:"([^"\r\n]*)"|([^;\r\n]*))/i.exec(disposition);
  const regular = /(?:^|;)\s*filename\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;]*))/i.exec(disposition);
  let name = regular ? (regular[1] ?? regular[2]).trim().replace(/\\(["\\])/g, "$1") : "";
  if (extended) {
    const encoded = (extended[1] ?? extended[2]).trim();
    const utf8 = /^utf-8'[^']*'(.*)$/i.exec(encoded);
    if (utf8) { try { name = decodeURIComponent(utf8[1]); } catch {} }
  }
  if (!name) {
    name = new URL(url).pathname.split("/").pop() || "未命名文件";
    try { name = decodeURIComponent(name); } catch {}
  }
  const length = response.headers.get("Content-Length");
  const size = length !== null && /^\d+$/.test(length) ? Number(length) : NaN;
  return { name: name.split(/[\\/]/).pop().replace(/[\r\n\0]/g, "") || "未命名文件",
    type: type || "未声明 Content-Type", size_bytes: Number.isSafeInteger(size) ? size : null };
}

async function stored_cookies(env) {
  const response = await env.API.getByName(API_OBJECT_NAME).fetch("https://internal/_admin/cookies");
  if (!response.ok) throw new Error("读取已保存 Cookie 失败，请稍后重试");
  const value = await response.json();
  if (!Array.isArray(value.cookies)) throw new Error("Cookie 接口返回格式不正确");
  return value.cookies;
}

export async function admin_network_cookie_domains(env) {
  try {
    const counts = new Map();
    for (const cookie of await stored_cookies(env)) counts.set(cookie.domain, (counts.get(cookie.domain) || 0) + 1);
    return json_response({ domains: [...counts].sort(([left], [right]) => left.localeCompare(right))
      .map(([domain, count]) => ({ domain, count })) });
  } catch (failure) { return error_response(failure.message || "读取 Cookie 域名失败", 502); }
}

export async function admin_network_test(request, env) {
  if (request.method !== "POST") return error_response("method not allowed", 405, { Allow: "POST" });
  let body;
  try {
    if (Number(request.headers.get("Content-Length")) > 32768) return error_response("请求体超过 32KB", 413);
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 32768) return error_response("请求体超过 32KB", 413);
    body = JSON.parse(text);
  } catch { return error_response("请求体必须是 JSON", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return error_response("请求体必须是 JSON 对象", 400);
  const url = proxy_target_url(body.url);
  if (!url) return error_response("请输入公网 HTTP(S) 网址，仅支持 80 / 443 端口", 400);
  const timeout_ms = body.timeout_ms ?? 10000;
  if (!Number.isInteger(timeout_ms) || timeout_ms < 1000 || timeout_ms > 60000) return error_response("超时须为 1–60 秒", 400);
  let headers;
  try { headers = rss_fetch_headers({ headers: body.headers }); }
  catch (failure) { return error_response(failure.message.replaceAll("fetchText", "网络测试"), 400); }
  if (headers.cookie !== undefined) return error_response("请勾选已保存的 Cookie 域名，不要在请求头中填写 Cookie", 400);
  const domains = body.cookie_domains ?? [];
  if (!Array.isArray(domains) || domains.length > 5000 || domains.some(domain => typeof domain !== "string" || !domain || domain.length > 255 || /[\s/]/.test(domain))) {
    return error_response("Cookie 域名列表无效", 400);
  }
  let cookies = [];
  if (domains.length) {
    try { cookies = await stored_cookies(env); }
    catch (failure) { return error_response(failure.message || "读取已保存 Cookie 失败", 502); }
    const available = new Set(cookies.map(cookie => cookie.domain));
    if (domains.some(domain => !available.has(domain))) return error_response("已选 Cookie 域名不存在，请刷新域名列表", 400);
    const selected = new Set(domains);
    cookies = cookies.filter(cookie => selected.has(cookie.domain));
  }

  const started_at = Date.now();
  const signal = AbortSignal.timeout(timeout_ms);
  const result = { url, timeout_ms, colo: request.cf?.colo || "", elapsed_ms: 0, headers_ms: null,
    requests: [], status: null, status_text: "", headers: {}, body: "", body_bytes: 0, truncated: false, error: "", code: "",
    body_kind: "text", content_type: "", file: null, preview_message: "" };
  let current = url;
  let media;
  try {
    for (let hop = 0; hop <= 5; hop++) {
      const trace = { url: current, status: null, elapsed_ms: 0 };
      result.requests.push(trace);
      const hop_started_at = Date.now();
      let response;
      try {
        const request_cookie = cookie_header(cookies, current);
        response = await fetch(current, { method: "GET", headers: { ...headers, ...(request_cookie ? { Cookie: request_cookie } : {}) }, redirect: "manual", signal });
      } finally { trace.elapsed_ms = Date.now() - hop_started_at; }
      trace.status = response.status;
      result.url = current;
      result.status = response.status;
      result.status_text = response.statusText;
      result.headers = Object.fromEntries(response.headers);
      result.headers_ms = Date.now() - started_at;
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        if (hop === 5) throw new Error("重定向超过 5 次");
        const location = response.headers.get("Location");
        if (!location) throw new Error("重定向缺少 Location");
        const next = proxy_target_url(new URL(location, current).href);
        if (!next) throw new Error("重定向地址不是允许的公网 HTTP(S) 网址");
        if (new URL(next).origin !== new URL(current).origin) {
          for (const name of RSS_FETCH_CREDENTIAL_HEADERS) delete headers[name];
        }
        current = next;
        continue;
      }
      result.content_type = (response.headers.get("Content-Type") || "").split(";", 1)[0].trim().toLowerCase();
      result.body_kind = response_kind(result.content_type, response.headers.get("Content-Disposition") || "");
      result.file = response_file(response, current, result.content_type);
      const is_media = ["img", "video", "audio"].includes(result.body_kind);
      if (is_media && result.file.size_bytes > media_preview_bytes) {
        result.body_kind = "file";
        result.preview_message = "媒体超过 16MB，仅显示文件信息";
      }
      if (is_media && !response.body) {
        result.body_kind = "file";
        result.preview_message = "响应正文为空";
      }
      if (result.body_kind === "file") { await response.body?.cancel(); break; }
      const limit = is_media ? media_preview_bytes : preview_bytes;
      const reader = response.body?.getReader();
      if (reader) {
        const chunks = [];
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const remaining = limit - result.body_bytes;
            chunks.push(value.subarray(0, remaining));
            result.body_bytes += Math.min(value.byteLength, remaining);
            if (value.byteLength > remaining) { result.truncated = true; break; }
          }
        } finally { await reader.cancel(); }
        if (is_media) {
          if (result.truncated) {
            result.body_kind = "file";
            result.preview_message = "媒体超过 16MB，仅显示文件信息";
          } else {
            media = new Blob(chunks, { type: result.content_type });
          }
        } else {
          const bytes = new Uint8Array(result.body_bytes);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
          result.body = rss_response_text(bytes.buffer, response.headers.get("Content-Type") || "");
        }
        if (!result.truncated && result.file.size_bytes === null) result.file.size_bytes = result.body_bytes;
      }
      break;
    }
  } catch (failure) {
    result.code = signal.aborted ? "UPSTREAM_TIMEOUT" : "UPSTREAM_FETCH_FAILED";
    result.error = signal.aborted ? `请求超过 ${timeout_ms / 1000} 秒，已超时` : (failure.message || "上游连接失败");
  }
  result.elapsed_ms = Date.now() - started_at;
  if (media) {
    const form = new FormData();
    form.set("result", JSON.stringify(result));
    form.set("media", media, result.file.name);
    return new Response(form, { headers: { "Cache-Control": "no-store" } });
  }
  return json_response(result);
}
