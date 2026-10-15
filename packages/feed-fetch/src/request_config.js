import { proxy_target_url } from "./url.js";

const default_user_agent = "xiaoxunrss-worker/1.0";
const field_limits = Object.freeze({
  user_agent: 512,
  referer: 1024,
  cookie: 4096,
  accept_language: 256,
});

const byte_length = (value) => new TextEncoder().encode(value).length;

function truncate_bytes(value, limit) {
  if (byte_length(value) <= limit) return value;
  let result = "";
  let used = 0;
  for (const character of value) {
    const size = byte_length(character);
    if (used + size > limit) break;
    result += character;
    used += size;
  }
  return result;
}

function clean_header_value(value, limit) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed.includes("\r") || trimmed.includes("\n")) return "";
  return truncate_bytes(trimmed, limit);
}

function header_name_allowed(name) {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return false;
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(trimmed)) return false;
  const lower = trimmed.toLowerCase();
  if (["host", "content-length", "transfer-encoding", "connection", "upgrade", "expect", "te"].includes(lower)) {
    return false;
  }
  return !lower.startsWith("proxy-") && !lower.startsWith("x-forwarded-");
}

function normalize_custom_headers(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of raw) {
    if (result.length >= 20) break;
    if (entry === null || typeof entry !== "object") continue;
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!header_name_allowed(name)) continue;
    const lower = name.toLowerCase();
    if (seen.has(lower)) continue;
    const value = clean_header_value(entry.value, 2048);
    if (value === "") continue;
    seen.add(lower);
    result.push({ name, value });
  }
  return result;
}

function normalize_header_block(raw) {
  const source = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const headers = {
    user_agent: clean_header_value(source.user_agent, field_limits.user_agent),
    referer: clean_header_value(source.referer, field_limits.referer),
    cookie: clean_header_value(source.cookie, field_limits.cookie),
    accept_language: clean_header_value(source.accept_language, field_limits.accept_language),
    custom: normalize_custom_headers(source.custom),
  };
  const total_bytes = () => byte_length(headers.user_agent) + byte_length(headers.referer) +
    byte_length(headers.cookie) + byte_length(headers.accept_language) +
    headers.custom.reduce((sum, entry) => sum + byte_length(entry.name) + byte_length(entry.value), 0);
  while (headers.custom.length > 0 && total_bytes() > 16 * 1024) headers.custom.pop();
  return headers;
}

function normalize_extra_query(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of raw) {
    if (result.length >= 20) break;
    if (entry === null || typeof entry !== "object") continue;
    const name = clean_header_value(entry.name, 200);
    if (name === "" || seen.has(name)) continue;
    seen.add(name);
    result.push({ name, value: clean_header_value(entry.value, 512) });
  }
  return result;
}

function clean_selector(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return text.includes("\r") || text.includes("\n") ? "" : text.slice(0, 200);
}

function normalize_rules(raw) {
  const source = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const remove_selectors = [];
  for (const value of Array.isArray(source.remove_selectors) ? source.remove_selectors : []) {
    if (remove_selectors.length >= 40) break;
    const selector = clean_selector(value);
    if (selector !== "" && !remove_selectors.includes(selector)) remove_selectors.push(selector);
  }
  return { content_selector: clean_selector(source.content_selector), remove_selectors };
}

/** 防御性归一抓取真正消费的配置；展示、调度和 AI 设置不进入共享包。 */
export function normalize_fetch_context(settings_raw, options_raw) {
  const settings_source = settings_raw !== null && typeof settings_raw === "object" ? settings_raw : {};
  const options_source = options_raw !== null && typeof options_raw === "object" ? options_raw : {};
  const proxy_value = typeof options_source.proxy === "string" ? options_source.proxy.trim() : "";
  const proxy = proxy_value !== "" && !proxy_value.includes("\r") && !proxy_value.includes("\n") &&
    /^https?:\/\//i.test(proxy_value) ? truncate_bytes(proxy_value, 512) : "";
  return {
    settings: { headers: normalize_header_block(settings_source.headers) },
    options: {
      extra_query: normalize_extra_query(options_source.extra_query),
      proxy,
      headers: normalize_header_block(options_source.headers),
      article_headers_mode: options_source.article_headers_mode === "custom" ? "custom" : "inherit",
      article_headers: normalize_header_block(options_source.article_headers),
      rules: normalize_rules(options_source.rules),
    },
  };
}

function resolve_template(value, target_url) {
  if (value === "") return "";
  let origin = "";
  try {
    origin = new URL(target_url).origin;
  } catch {}
  return value.replaceAll("{{origin}}", origin).replaceAll("{{url}}", target_url);
}

function request_headers(settings, source, target_url, cross_origin) {
  const base = settings.headers;
  const result = { "user-agent": source.user_agent || base.user_agent || default_user_agent };
  const referer = resolve_template(source.referer || base.referer, target_url);
  if (referer !== "") result.referer = referer;
  const cookie = source.cookie || base.cookie;
  if (cookie !== "") result.cookie = cookie;
  const accept_language = source.accept_language || base.accept_language;
  if (accept_language !== "") result["accept-language"] = accept_language;
  const custom = new Map();
  for (const entry of base.custom) custom.set(entry.name.toLowerCase(), entry.value);
  for (const entry of source.custom) custom.set(entry.name.toLowerCase(), entry.value);
  for (const [name, value] of custom) if (!(name in result)) result[name] = value;
  if (cross_origin) {
    delete result.cookie;
    delete result.authorization;
  }
  return result;
}

export const source_request_headers = (context, target_url, cross_origin) =>
  request_headers(context.settings, context.options.headers, target_url, cross_origin);

export const source_article_headers = (context, target_url, cross_origin) =>
  request_headers(
    context.settings,
    context.options.article_headers_mode === "custom"
      ? context.options.article_headers
      : context.options.headers,
    target_url,
    cross_origin,
  );

export function apply_extra_query(target_url, extra_query) {
  const url = new URL(target_url);
  for (const entry of extra_query) url.searchParams.set(entry.name, entry.value);
  return url.toString();
}

export function apply_proxy_template(template, target_url) {
  if (template === "") return "";
  return proxy_target_url(
    template
      .replaceAll("{{url_encoded}}", encodeURIComponent(target_url))
      .replaceAll("{{url}}", target_url),
  );
}
