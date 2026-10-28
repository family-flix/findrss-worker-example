import { SCRIPT_FETCH_TIMEOUT_MS } from "../lib/constants.js";

// Cookie 可供受信脚本临时覆盖；宿主将其限制在请求初始 origin。
const allowed_headers = new Set([
  "accept", "accept-language", "user-agent", "referer", "cache-control", "pragma",
  "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform", "sec-fetch-dest",
  "sec-fetch-mode", "sec-fetch-site", "sec-fetch-user", "upgrade-insecure-requests",
  "x-requested-with", "priority", "cookie",
  "content-type", "origin", "authorization", "x-csrf-token", "x-csrftoken",
  "x-ig-app-id", "x-fb-friendly-name",
  "x-twitter-active-user", "x-twitter-auth-type", "x-twitter-client-language",
  "kww", "profile_referer",
  "x-app-id", "x-app-token", "x-sdk-int", "x-sdk-locale",
  "x-app-version", "x-api-version", "x-app-code",
  "client-version", "server-version", "x-xsrf-token",
  "x-goog-api-key", "access-token",
]);
export const RSS_FETCH_CREDENTIAL_HEADERS = ["authorization", "x-csrf-token", "x-csrftoken", "kww", "x-app-token", "x-xsrf-token", "x-goog-api-key", "access-token"];
const cookie_header_names = new Map([["uifid", "UIFID"], ["kww", "kwfv1"], ["x-csrf-token", "ct0"], ["x-csrftoken", "csrftoken"], ["x-xsrf-token", "XSRF-TOKEN"]]);
export function rss_fetch_timeout(options) {
  const timeout_ms = options?.timeout_ms === undefined ? SCRIPT_FETCH_TIMEOUT_MS : options.timeout_ms;
  if (!Number.isInteger(timeout_ms) || timeout_ms < 1 || timeout_ms > SCRIPT_FETCH_TIMEOUT_MS) throw new Error("fetchText timeout_ms 必须为 1–10000 的整数");
  return timeout_ms;
}
export function rss_fetch_request(options) {
  const method = options?.method === undefined ? "GET" : options.method;
  if (typeof method !== "string" || !["GET", "POST"].includes(method.toUpperCase())) throw new Error("fetchText method 只支持 GET 或 POST");
  const body = options?.body;
  if (body !== undefined && (typeof body !== "string" || new TextEncoder().encode(body).byteLength > 128 * 1024)) throw new Error("fetchText body 必须为不超过 128KB 的字符串");
  if (body !== undefined && method.toUpperCase() !== "POST") throw new Error("fetchText GET 不允许 body");
  return { method: method.toUpperCase(), body };
}
export function rss_fetch_headers(options) {
  const headers = { "user-agent": "findrss-script/1.0", accept: "*/*" };
  if (options === null || options === undefined) return headers;
  if (typeof options !== "object" || Array.isArray(options)) throw new Error("fetchText options 必须是对象");
  if (options.headers === undefined) return headers;
  if (options.headers === null || typeof options.headers !== "object" || Array.isArray(options.headers)) throw new Error("fetchText headers 必须是对象");
  let bytes = 0;
  for (const [name, value] of Object.entries(options.headers)) {
    const key = name.toLowerCase();
    if (!allowed_headers.has(key)) throw new Error("fetchText 不允许自定义请求头：" + name);
    if (typeof value !== "string" || /[\r\n\0]/.test(value) || value.length > 4096) throw new Error("fetchText 请求头值无效：" + name);
    bytes += name.length + value.length;
    if (bytes > 16384) throw new Error("fetchText 请求头过大");
    headers[key] = value;
  }
  return headers;
}

// 站点协议需要的派生头只取自当前目标 URL 匹配的 Cookie，脚本无法读取 Cookie 本体。
export function rss_cookie_headers(options, request_cookie) {
  if (options?.cookie_headers === undefined) return {};
  const mapping = options.cookie_headers;
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw new Error('fetchText cookie_headers 必须是对象');
  const headers = {};
  for (const [name, cookie_name] of Object.entries(mapping)) {
    const key = name.toLowerCase();
    if (!cookie_header_names.has(key) || cookie_header_names.get(key) !== cookie_name) throw new Error('fetchText 不支持的 Cookie 派生请求头：' + name);
    const match = String(request_cookie || '').split(';').map(pair => pair.trim()).find(pair => pair.startsWith(cookie_name + '='));
    if (match) {
      const value = match.slice(cookie_name.length + 1);
      if (/[\r\n\0]/.test(value) || value.length > 4096) throw new Error('fetchText Cookie 派生请求头值无效');
      headers[key] = value;
    }
  }
  return headers;
}
