import { proxy_target_url } from "@findrss/feed-fetch";
import { error_response, json_response } from "../../lib/http.js";
import { rss_fetch_headers, RSS_FETCH_CREDENTIAL_HEADERS } from "../../infra/rss_fetch_headers.js";
import { rss_response_text } from "../../infra/rss_response_text.js";

const preview_bytes = 64 * 1024;

export async function admin_network_test(request) {
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

  const started_at = Date.now();
  const signal = AbortSignal.timeout(timeout_ms);
  const result = { url, timeout_ms, colo: request.cf?.colo || "", elapsed_ms: 0, headers_ms: null,
    requests: [], status: null, status_text: "", headers: {}, body: "", body_bytes: 0, truncated: false, error: "", code: "" };
  let current = url;
  try {
    for (let hop = 0; hop <= 5; hop++) {
      const trace = { url: current, status: null, elapsed_ms: 0 };
      result.requests.push(trace);
      const hop_started_at = Date.now();
      let response;
      try {
        response = await fetch(current, { method: "GET", headers, redirect: "manual", signal });
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
          for (const name of ["cookie", ...RSS_FETCH_CREDENTIAL_HEADERS]) delete headers[name];
        }
        current = next;
        continue;
      }
      const reader = response.body?.getReader();
      if (reader) {
        const chunks = [];
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const remaining = preview_bytes - result.body_bytes;
            chunks.push(value.subarray(0, remaining));
            result.body_bytes += Math.min(value.byteLength, remaining);
            if (value.byteLength > remaining) { result.truncated = true; break; }
          }
        } finally { await reader.cancel(); }
        const bytes = new Uint8Array(result.body_bytes);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        result.body = rss_response_text(bytes.buffer, response.headers.get("Content-Type") || "");
      }
      break;
    }
  } catch (failure) {
    result.code = signal.aborted ? "UPSTREAM_TIMEOUT" : "UPSTREAM_FETCH_FAILED";
    result.error = signal.aborted ? `请求超过 ${timeout_ms / 1000} 秒，已超时` : (failure.message || "上游连接失败");
  }
  result.elapsed_ms = Date.now() - started_at;
  return json_response(result);
}
