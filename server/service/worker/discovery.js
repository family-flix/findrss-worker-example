// 外层 Worker 侧的处理函数：只碰 env 与 Request/Response，不 import DO 类。
// 订阅广场公开端点：{{hostname}} 模板展开与来源类型/头像的只读转发。
import { SourceAddressModel } from "../../domain/source_address.js";
import { API_OBJECT_NAME } from "../../lib/constants.js";
import { DISCOVERY_CATEGORIES } from "../../lib/constants.js";
import { error_response, json_response } from "../../lib/http.js";
import { valid_identifier } from "../../lib/identifiers.js";
import { DiscoverySourceModel } from "../../domain/discovery_source.js";
import { discovery_feed_defaults, discovery_feed_preview, fetch_discovery_feed, fetch_discovery_avatar } from "../../infra/feed_fetch.js";
import { public_script_route } from "./script_route.js";
import { FINDRSS_LOGO_PNG } from "../../lib/brand.js";

export async function admin_discovery_preview(env, request) {
  let body;
  try {
    const text = await request.text();
    if (text.length > 4096) return error_response("request body is too large", 413);
    body = JSON.parse(text);
  } catch { return error_response("invalid JSON", 400); }
  const origin = feed_hostname_origin(env);
  const address = String(body?.feed_url ?? "").trim();
  const is_template = address.startsWith(SourceAddressModel.HOST_TOKEN);
  const template_error = "模板订阅源地址必须以 {{hostname}}/rss/ 或 {{hostname}}/atom/ 开头";
  if (is_template && !/^\{\{hostname\}\}\/(rss|atom)\//.test(address)) {
    return error_response(template_error, 400);
  }
  const internal_preview = body?.include_feed === true && /^\/(rss|atom)\//.test(address);
  const script_id = body?.include_feed === true ? String(body.script_id || "") : "";
  if (script_id && !valid_identifier(script_id)) return error_response("脚本 ID 无效", 400);
  let feed_url, target;
  try {
    feed_url = internal_preview ? new URL(address, origin || new URL(request.url).origin).href
      : SourceAddressModel.resolve_feed_url(address, origin);
    target = new URL(feed_url);
  } catch { return error_response("订阅源地址无效或未配置 FINDRSS_HOSTNAME", 400); }
  const route = /^\/(rss|atom)(\/.*)$/.exec(target.pathname);
  if (is_template && !route) return error_response(template_error, 400);
  let xml;
  if (route && (internal_preview || origin && target.origin === new URL(origin).origin)) {
    const internal = new URL("https://internal/_admin/feed/" + route[1] + route[2]);
    internal.search = target.search;
    const response = await env.API.getByName(API_OBJECT_NAME).fetch(new Request(internal, {
      headers: { "X-Feed-Public-URL": feed_url, "X-RSS-Preview-Script-ID": script_id },
    }));
    if (!response.ok) return response;
    xml = await response.text();
  } else {
    const result = await fetch_discovery_feed(feed_url);
    if (result.error) return error_response(result.error, 502);
    xml = result.xml;
  }
  try {
    if (body?.include_feed === true) return json_response({ feed_url, xml, feed: discovery_feed_preview(xml, feed_url) });
    const defaults = discovery_feed_defaults(xml, feed_url);
    defaults.source_type = DiscoverySourceModel.infer_type(feed_url);
    const category_labels = { recommended: "推荐", technology: "科技", development: "开发",
      business: "商业", science: "科学", design: "设计", life: "生活" };
    defaults.category = [...DISCOVERY_CATEGORIES].find((category) =>
      defaults.tags.some((tag) => tag.toLowerCase() === category || tag === category_labels[category]),
    ) ?? "recommended";
    let avatar = null;
    let avatar_error = "";
    if (defaults.avatar_url) {
      try {
        avatar = await fetch_discovery_avatar(defaults.avatar_url, {
          local_origin: new URL(origin || request.url).origin,
          fetch_local: (url, options) => new URL(url).pathname === "/findrss-logo.png"
            ? Promise.resolve(new Response(FINDRSS_LOGO_PNG, { headers: { "Content-Type": "image/png" } }))
            : public_script_route(env, new Request(url, options)),
        });
      }
      catch (error) { avatar_error = error.message; }
    }
    return json_response({ feed_url, defaults, avatar, avatar_error });
  } catch (error) {
    const message = error.message || "订阅源解析失败";
    return body?.include_feed === true ? json_response({ error: message, feed_url, xml }, 422) : error_response(message, 422);
  }
}

/**
 * 归一 FINDRSS_HOSTNAME 为完整 origin：纯 hostname 默认补 https://，尾斜杠去掉。
 * @param {Env} env
 * @returns {string}
 */
export function feed_hostname_origin(env) {
  const configured = (String(env.FINDRSS_HOSTNAME ?? "").trim()
    || String(env.FEED_HOSTNAME ?? "").trim()).replace(/\/+$/, "");
  if (configured === "") return "";
  return /^https?:\/\//i.test(configured) ? configured : "https://" + configured;
}

/**
 * 把目录响应里的 `{{hostname}}` 模板按当前环境的 FINDRSS_HOSTNAME 展开成绝对地址。
 * `keep_template` 为 true 时额外保留存储原文 `feed_url_template`：管理页编辑表单要靠它
 * 原样回填，否则编辑一次模板源就会被固化成当前环境的绝对地址。未配置 FINDRSS_HOSTNAME、
 * 响应不是 JSON 或既没有 sources 也没有 source 字段时原样返回。
 * @param {Response} response
 * @param {string} origin
 * @param {boolean} keep_template
 * @returns {Promise<Response>}
 */
export async function resolve_discovery_source_feed_urls(response, origin, keep_template) {
  if (origin === "" || !response.ok) {
    return response;
  }
  const payload = await response.clone().json().catch(() => null);
  if (payload === null || typeof payload !== "object") {
    return response;
  }
  const sources = Array.isArray(payload.sources) ? payload.sources : null;
  const single = payload.source !== null && typeof payload.source === "object" ? payload.source : null;
  if (sources === null && single === null) {
    return response;
  }
  for (const source of sources ?? [single]) {
    if (source === null || typeof source !== "object") continue;
    const stored = String(source.feed_url ?? "");
    if (keep_template) source.feed_url_template = stored;
    source.feed_url = SourceAddressModel.resolve_feed_url(stored, origin);
  }
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  return new Response(JSON.stringify(payload), {
    status: response.status,
    headers,
  });
}

/**
 * @param {Env} env
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function public_discovery_sources(env, request) {
  const object = env.API.getByName(API_OBJECT_NAME);
  const source_url = new URL(request.url);
  const internal_url = new URL("https://internal/_public/discovery/sources");
  internal_url.search = source_url.search;
  const forwarded = new Request(internal_url, request);
  forwarded.headers.set("X-Feed-Public-URL", feed_hostname_origin(env) || source_url.origin);
  const response = await object.fetch(forwarded);
  // 公开目录也要替换模板，但不回传存储原文——那是管理端的编辑态字段。
  return resolve_discovery_source_feed_urls(response, feed_hostname_origin(env), false);
}

export async function public_discovery_catalog(env) {
  return env.API.getByName(API_OBJECT_NAME).fetch(new Request("https://internal/_public/discovery/catalog", {
    headers: { "X-Feed-Public-URL": feed_hostname_origin(env) },
  }));
}

/**
 * 广场详情页（`/s/<id>`）的数据：单条源 + 同类源。
 * 与列表端点共用模板展开——详情页上的 `feed_url` 必须是能直接订阅的绝对地址。
 * @param {Env} env
 * @param {string} source_id
 * @returns {Promise<Response>}
 */
export async function public_discovery_source(env, source_id) {
  const object = env.API.getByName(API_OBJECT_NAME);
  const response = await object.fetch(new Request("https://internal/_public/discovery/sources/" + source_id, {
    headers: { "X-Feed-Public-URL": feed_hostname_origin(env) },
  }));
  return resolve_discovery_source_feed_urls(response, feed_hostname_origin(env), false);
}

/**
 * 公开头像按原样转发：响应是图片二进制，不能套 json_response。
 * @param {Env} env
 * @param {string} source_id
 * @returns {Promise<Response>}
 */
export async function public_discovery_avatar(env, source_id) {
  const object = env.API.getByName(API_OBJECT_NAME);
  return object.fetch("https://internal/_public/discovery/avatars/" + source_id);
}
