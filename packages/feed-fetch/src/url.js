/**
 * 公网 URL 校验。抓取入口从这一层起步，再叠代理专用限制。
 * @param {unknown} value
 * @returns {string | null}
 */
export function public_http_url(value, { allow_loopback = false } = {}) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return null;
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  const hostname = url.hostname.toLowerCase();
  if (allow_loopback && hostname === "127.0.0.1") return url.toString();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return null;
  if (hostname.includes(":")) return null;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (ipv4) {
    const first = Number(ipv4[1]);
    const second = Number(ipv4[2]);
    if (first === 0 || first === 10 || first === 127) return null;
    if (first === 169 && second === 254) return null;
    if (first === 172 && second >= 16 && second <= 31) return null;
    if (first === 192 && second === 168) return null;
  }
  return url.toString();
}

// 云厂商元数据端点；代理出站必须显式拒绝，避免 SSRF 读取实例凭证。
const blocked_proxy_hosts = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "metadata",
]);

/**
 * 代理专用校验：在 public_http_url 基础上收紧端口与元数据主机。
 * @param {unknown} value
 * @returns {string | null}
 */
export function proxy_target_url(value, { allow_loopback = false } = {}) {
  const normalized = public_http_url(value, { allow_loopback });
  if (normalized === null) return null;
  const url = new URL(normalized);
  if (allow_loopback && url.hostname === "127.0.0.1") return normalized;
  if (url.port !== "" && url.port !== "80" && url.port !== "443") return null;
  const hostname = url.hostname.toLowerCase();
  if (hostname.endsWith(".internal")) return null;
  if (blocked_proxy_hosts.has(hostname)) return null;
  return normalized;
}
