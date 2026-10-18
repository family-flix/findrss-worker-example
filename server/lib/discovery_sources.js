// 纯逻辑，**两端共用**：SSR（Worker）与 hydrate（浏览器）都跑这一份，
// 所以这里的每个函数都必须是确定性的、且不依赖任何 DOM/Worker 专有 API。

import { DISCOVERY_PLATFORM_LABELS } from "./constants.js";
import { discovery_platform_label } from "./discovery_platform.js";

export const source_type_labels = DISCOVERY_PLATFORM_LABELS;

/** @param {unknown} value */
export function safe_http_url(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return "";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

/**
 * API 头像地址归一为同源路径；其他头像仅接受 HTTPS 或站内相对路径。
 * @param {unknown} value
 */
export function safe_avatar_url(value) {
  if (typeof value !== "string") return "";
  const path = value.trim();
  if (/^https?:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      if (url.username || url.password || path.length > 2048) return "";
      if (/^\/public\/avatar\/[A-Za-z0-9-]+(?:\/[A-Za-z0-9-]+)?$/.test(url.pathname)) return url.pathname + url.search;
      const avatar = /^\/(?:api\/avatar|discovery\/avatars)\/([A-Za-z0-9-]+)$/.exec(url.pathname);
      if (avatar) return `/api/avatar/${avatar[1]}${url.search}`;
      return url.protocol === "https:" ? url.href : "";
    } catch { return ""; }
  }
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u0020]/.test(path) || path.length > 2048) return "";
  return path;
}

/* 首页与详情页共用实体表；其余实体原样保留，不猜。 */
const html_entities = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * 去标签 + 收空白 + 截断。**必须与浏览器端逐字一致**，否则 SSR 出的文本节点
 * 和 hydrate 后计算的文本会对不上。因此这里刻意不用 `document.createElement`
 * （Worker 里没有 DOM），改用固定实体表做解码。
 * @param {unknown} value
 * @param {number} limit
 */
export function plain_text(value, limit = 420) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#\d+|[a-zA-Z]+);/g, (match, name) => {
      if (name.startsWith("#")) {
        const code = Number(name.slice(1));
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      return Object.prototype.hasOwnProperty.call(html_entities, name) ? html_entities[name] : match;
    })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

/** @param {unknown} value */
export function format_count(value) {
  const number = Number(value || 0);
  if (number >= 10000) return (number / 10000).toFixed(number >= 100000 ? 0 : 1) + " 万订阅";
  return number + " 订阅";
}

/**
 * 来源显示名称；图形由视图加载同源 SVG。空串表示没有已知来源，整个徽标不渲染。
 * @param {string} source_type
 */
export function source_type_label(source_type) {
  return source_type ? discovery_platform_label(String(source_type)) : "";
}

/**
 * 「公开订阅源」= 自有 `/rss/`、`/atom/` 路由且没要求 token。这是广场卡片上的公开性
 * 徽标、以及 `/s/<id>` 详情页上唯一一句真话的来源，**只能有一份实现**。
 * @param {string} feed_url
 * @param {unknown} require_token
 */
export function source_is_public(feed_url, require_token) {
  let is_api_rss_source = false;
  try {
    const url = new URL(String(feed_url));
    is_api_rss_source = url.pathname.startsWith("/rss/") || url.pathname.startsWith("/atom/");
  } catch {
    is_api_rss_source = false;
  }
  return is_api_rss_source && require_token !== true;
}

/**
 * 管理端目录里的一行（`discovery_sources`）→ 广场卡片形状。
 * 白名单式：不在这里列出的字段不会流到前端。**不能省 source_type / avatar_url**，
 * 否则卡片拿不到来源徽标与头像。
 * @param {Record<string, unknown>} source
 */
export function managed_source_result(source) {
  const feed_url = String(source.feed_url || "");
  return {
    title: String(source.title || "未命名订阅源"),
    description: String(source.description || "").slice(0, 500),
    website: String(source.website || ""),
    feed_url,
    language: "",
    category: String(source.category || ""),
    topics: Array.isArray(source.tags) ? source.tags.map(String) : [],
    subscribers: 0,
    velocity: 0,
    last_updated: Number(source.updated_at || 0),
    managed: true,
    public: source_is_public(feed_url, source.require_token),
    source_id: String(source.id || ""),
    source_type: String(source.source_type || ""),
    avatar_url: String(source.avatar_url || ""),
  };
}

/**
 * 把接口返回的一条源归一成页面共用的形状。**详情页与卡片共用这一份**，
 * 所以既要认 `discovery_sources` 的原样行（`id` / `tags` / `require_token`，
 * `/s/<id>` 走这条），也要认搜索结果的 Feedly 形状（`source_id` / `topics`）。
 * @param {Record<string, unknown>} item
 */
export function normalize_source(item) {
  const feed_url = safe_http_url(item.feed_url);
  if (!feed_url) return null;
  const tags = Array.isArray(item.tags) ? item.tags : Array.isArray(item.topics) ? item.topics : [];
  return {
    id: String(item.id || item.source_id || ""),
    title: String(item.title || "未命名订阅源").slice(0, 160),
    description: plain_text(item.description, 260),
    website: safe_http_url(item.website),
    feed_url,
    language: String(item.language || "").slice(0, 12).toUpperCase(),
    subscribers: Number(item.subscribers || 0),
    tags: tags.map(String).slice(0, 13),
    category: String(item.category || ""),
    managed: item.managed === true,
    // 卡片形状（managed_source_result）已经算好了 public，别拿 require_token 覆盖它。
    public: typeof item.public === "boolean" ? item.public : source_is_public(feed_url, item.require_token),
    source_type: String(item.source_type || ""),
    avatar_url: safe_avatar_url(item.avatar_url),
  };
}

/**
 * 展示用的主机名：优先网站地址，退回订阅地址。两条路径都是已经过 `safe_http_url` 的。
 * @param {{ website: string, feed_url: string }} source
 */
export function source_hostname(source) {
  try {
    return new URL(source.website || source.feed_url).hostname;
  } catch {
    return "";
  }
}
