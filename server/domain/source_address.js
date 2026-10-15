// 订阅源地址（feed_url）的解析与模板展开。
//
// `{{hostname}}` 模板变量：管理员按 `{{hostname}}/rss/<路由>` 存储自有源，
// API 响应公开目录时按环境的 FINDRSS_HOSTNAME 替换为实际 origin。
// `/rss/<route>` 与 `/atom/<route>` 前缀指向同一条 route，格式只决定序列化。
//
// 纯模块，可在 node --test 下直接覆盖。

/** 模板变量字面量。 */
const HOST_TOKEN = "{{hostname}}";
/** 模板替换的占位 origin，用于复用标准 URL 解析。 */
const template_origin = "https://template.invalid";

/**
 * 模板地址替换为占位 origin 后的绝对 URL，用于复用现有 URL 校验；
 * 非模板或 remainder 无法构成合法 URL 时返回 null。
 * @param {string} feed_url
 * @returns {string | null}
 */
function feed_url_template(feed_url) {
  if (typeof feed_url !== "string" || !feed_url.startsWith(HOST_TOKEN)) {
    return null;
  }
  try {
    return new URL(template_origin + feed_url.slice(HOST_TOKEN.length)).toString();
  } catch {
    return null;
  }
}

/**
 * 把模板前缀替换为实际 origin 并归一化；非模板地址原样返回。
 * @param {string} feed_url
 * @param {string} origin
 * @returns {string}
 */
function resolve_feed_url(feed_url, origin) {
  if (typeof feed_url !== "string" || !feed_url.startsWith(HOST_TOKEN)) {
    return feed_url;
  }
  const base = typeof origin === "string" ? origin.replace(/\/+$/, "") : origin;
  try {
    return new URL(base + feed_url.slice(HOST_TOKEN.length)).toString();
  } catch {
    return feed_url;
  }
}

/**
 * Parse an administrator-configured RSS route address. Hosts are intentionally
 * ignored because managed sources are deployed on both production and dev hosts;
 * `{{hostname}}` templates are normalized to a placeholder origin first.
 * Both `/rss/<route>` and `/atom/<route>` prefixes map to the same route; the
 * returned format only selects the serializer, not the route identity.
 * @param {string} feed_url
 * @returns {{ route_pathname: string, format: "rss" | "atom" } | null}
 */
function parse_route_address(feed_url) {
  if (typeof feed_url !== "string") return null;
  const candidate = feed_url_template(feed_url) ?? feed_url;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  const format = url.pathname.startsWith("/atom/") ? "atom"
    : url.pathname.startsWith("/rss/") ? "rss"
    : null;
  if (format === null) return null;
  if ([...url.searchParams.keys()].some((name) => name === "token")) return null;
  let route_pathname;
  try {
    route_pathname = decodeURIComponent(url.pathname.slice(("/" + format).length));
  } catch {
    return null;
  }
  return { route_pathname, format };
}

/**
 * 订阅源地址实体：把 feed_url 解析成路由身份（route pathname + 格式），
 * 并提供模板展开与按 pathname 匹配的行为。地址无法识别为脚本路由时
 * `is_route()` 为 false，`route_pathname` 为空串、`format` 为 null。
 * @param {string} feed_url
 */
export function SourceAddressModel(feed_url) {
  const raw = typeof feed_url === "string" ? feed_url : "";
  const parsed = parse_route_address(raw);
  const state = Object.freeze({
    /** 原始地址字符串（未展开模板）。 */
    raw,
    /** 是否以 `{{hostname}}` 模板开头。 */
    is_template: raw.startsWith(HOST_TOKEN),
    /** 路由 pathname（`/rss/`、`/atom/` 前缀与 host 已剥离）；不可识别时为空串。 */
    route_pathname: parsed === null ? "" : parsed.route_pathname,
    /** 序列化格式；不可识别时为 null。 */
    format: parsed === null ? null : parsed.format,
  });
  return Object.freeze({
    ...state,
    /** 是否是受支持的 `/rss|/atom/<route>` 地址。 */
    is_route: () => parsed !== null,
    /**
     * 是否与给定 route pathname 相同（只看 route，忽略 query 与 `/rss`、`/atom` 前缀）。
     * @param {string} route_pathname
     * @returns {boolean}
     */
    matches: (route_pathname) => {
      if (parsed === null || typeof route_pathname !== "string") return false;
      let decoded;
      try {
        decoded = decodeURIComponent(route_pathname);
      } catch {
        return false;
      }
      return state.route_pathname === decoded;
    },
    /**
     * 模板地址展开为实际 origin；非模板或 origin 非法时原样返回。
     * @param {string} origin
     * @returns {string}
     */
    resolve: (origin) => resolve_feed_url(raw, origin),
    /** 解析结果（路由身份）。 */
    toValue: () => ({ route_pathname: state.route_pathname, format: state.format }),
  });
}

/** 模板变量字面量（`{{hostname}}`）。 */
SourceAddressModel.HOST_TOKEN = HOST_TOKEN;
SourceAddressModel.of = SourceAddressModel;
SourceAddressModel.fromValue = (value) => SourceAddressModel(value);
/** 模板地址 → 占位 origin 的绝对 URL；非模板/非法返回 null。 */
SourceAddressModel.feed_url_template = (feed_url) => feed_url_template(feed_url);
/** 模板地址 → 实际 origin；非模板/非法原样返回。 */
SourceAddressModel.resolve_feed_url = (feed_url, origin) => resolve_feed_url(feed_url, origin);
