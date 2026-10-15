// 纯逻辑，**两端共用**（SSR 与 hydrate 各跑一遍都不该有差别），也不依赖 DOM/Worker
// 专有 API。这里只管「订阅地址能不能抓」，
// 与具体的源形状（徽标、分类、头像）无关，后者见 `sources.js`。

export const preview_byte_limit = 512 * 1024;
export const upstream_timeout_ms = 10000;
export const search_query_max_length = 100;

/**
 * 回环/链路本地/私网 hostname 或 IPv6 字面量；is_public_feed_url 的 SSRF 校验拒绝这些地址。
 * @param {string} hostname
 * @returns {boolean}
 */
export function hostname_is_private(hostname) {
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    return true;
  }
  if (hostname.includes(":")) {
    return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (ipv4) {
    const [first, second] = ipv4.slice(1, 3).map(Number);
    if (first === 0 || first === 10 || first === 127) return true;
    if (first === 169 && second === 254) return true;
    if (first === 172) return second >= 16 && second <= 31;
    if (first === 192) return second === 168;
    return false;
  }
  return false;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
export function is_public_feed_url(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return false;
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }
  if (url.username !== "" || url.password !== "") {
    return false;
  }
  return !hostname_is_private(url.hostname.toLowerCase());
}

/**
 * 同域或私网地址的 `/rss/`、`/atom/` 是本站（或本地 API）代理的脚本源：预览经 Service
 * Binding 直连，不走公网校验（本地 127.0.0.1 也可达），避免线上公网自回环；
 * 公网域名的 `/rss/`、`/atom/` 路径可能是任意外部源，仍走公网抓取。
 * @param {URL} target
 * @param {URL} request_url
 * @returns {boolean}
 */
export function preview_via_api(target, request_url) {
  if (!target.pathname.startsWith("/rss/") && !target.pathname.startsWith("/atom/")) {
    return false;
  }
  return target.host === request_url.host || hostname_is_private(target.hostname.toLowerCase());
}
