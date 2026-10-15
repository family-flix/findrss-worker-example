import { public_http_url } from "./proxy_url.js";

const reserved_roots = new Set(["admin", "reader", "discovery", "rss", "atom", "debug", "v1", "api", "health", "mcp", "account", "s", "assets", "timeless"]);

export function validate_script_route_path(route) {
  const first = route.path.split("/")[1];
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(first) || reserved_roots.has(first.toLowerCase())) {
    throw new Error("脚本路由不能占用系统路径或使用动态根路径");
  }
}

export function validate_image_proxy_route(route) {
  validate_script_route_path(route);
  if (!Array.isArray(route.allowed_hosts) || !route.allowed_hosts.length || route.allowed_hosts.length > 32) {
    throw new Error("图片路由必须声明 1–32 个 allowed_hosts");
  }
  for (const host of route.allowed_hosts) {
    if (typeof host !== "string" || host !== host.toLowerCase() || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host) || !public_http_url("https://" + host) || host.endsWith(".internal") || host === "metadata.goog") {
      throw new Error("allowed_hosts 必须是明确的公网域名，不允许通配符或 IP");
    }
  }
}

export function image_proxy_target(route, value) {
  const normalized = public_http_url(value);
  if (!normalized) throw new Error("图片代理目标地址无效");
  const url = new URL(normalized);
  if (url.protocol !== "https:" || url.port || !route.allowed_hosts?.includes(url.hostname)) {
    throw new Error("图片代理目标不在 allowed_hosts 中或不是标准 HTTPS 地址");
  }
  url.hash = "";
  return url.toString();
}

export function image_proxy_descriptor(route, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("图片路由必须返回 { url, headers } 对象");
  const url = image_proxy_target(route, value.url);
  const supplied = value.headers ?? {};
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) throw new Error("图片代理 headers 必须是对象");
  const headers = {};
  for (const [name, text] of Object.entries(supplied)) {
    const key = name.toLowerCase();
    if (!["referer", "user-agent", "accept", "accept-language", "cache-control", "pragma", "priority",
      "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform", "sec-fetch-dest", "sec-fetch-mode",
      "sec-fetch-site", "sec-fetch-storage-access"].includes(key) || typeof text !== "string" || text.length > 2048 || /[\x00-\x1f\x7f]/.test(text)) {
      throw new Error("图片代理请求头无效：" + name);
    }
    headers[key] = text;
  }
  return { url, headers };
}
