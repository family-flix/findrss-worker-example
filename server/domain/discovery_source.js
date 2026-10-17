// 订阅源目录域：订阅源实体、头像实体，以及「来源类型」与「头像」两条纯逻辑。
//
// 来源类型按 feed_url 预判：自有脚本源的 /rss|/atom/<route> 前缀直接暴露了它抓的是什么
// （wxmp. 开头的是公众号，wxchannels. 开头的是视频号），普通 RSS 地址一律算网站。
// 管理页可以手改，所以这里只负责「没给值时的默认」。
//
// 头像只接受五种光栅图格式，故意不支持 SVG：同源直开 SVG 可以执行脚本。
//
// 纯模块，不依赖 lib/http（校验失败只回 `{ ok: false, error: { status, message } }`，
// 由调用方（组合根）负责换成 Response）。

import { DISCOVERY_CATEGORIES, DISCOVERY_CATEGORY_TAGS, DISCOVERY_PLATFORM_LABELS, DISCOVERY_RELATED_LIMIT, MAX_DISCOVERY_SOURCES } from "../lib/constants.js";
import { public_http_url } from "../lib/proxy_url.js";
import { SourceAddressModel } from "./source_address.js";
import { CreditModel } from "./credits.js";
import { stored_poll_policy } from "../lib/snapshot_schedule.js";
import { parse_poll_policy } from "../lib/poll_schedule.js";

const DISCOVERY_SOURCE_TYPES = new Set(Object.keys(DISCOVERY_PLATFORM_LABELS));
const MAX_DISCOVERY_AVATAR_BYTES = 5 * 1024 * 1024;
/** 登记 / 修改请求体上限。 */
const MAX_BODY_BYTES = 16 * 1024;

/** `tags_json` 列 → 字符串数组；坏 JSON / 非数组降级成空数组。 */
function tags_from_json(value) {
  try {
    const parsed = JSON.parse(String(value ?? ""));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function social_urls_from_source(source) {
  const values = Array.isArray(source.social_urls) ? source.social_urls
    : tags_from_json(source.social_urls_json);
  if (!values.length && !Array.isArray(source.social_urls) && source.social_url) return [String(source.social_url)];
  return [...new Set(values.filter(value => typeof value === "string").map(value => value.trim()).filter(Boolean))];
}

/**
 * 订阅源头像实体：`path()` 给出带版本号的同源相对路径（无头像时为空串），
 * `sniff()` 按文件头魔数判断上传图片的类型。
 * @param {{ source_id?: unknown, updated_at?: unknown }} [state]
 */
export function SourceAvatarModel(state) {
  const source = state ?? {};
  const state_ = Object.freeze({
    source_id: String(source.source_id ?? ""),
    updated_at: Number(source.updated_at ?? 0),
  });
  return Object.freeze({
    ...state_,
    /** 是否已设置头像。 */
    has: () => state_.updated_at > 0,
    path: () => SourceAvatarModel.path(state_.source_id, state_.updated_at),
    toValue: () => ({
      source_id: state_.source_id,
      updated_at: state_.updated_at,
      url: SourceAvatarModel.path(state_.source_id, state_.updated_at),
    }),
  });
}

SourceAvatarModel.MAX_BYTES = MAX_DISCOVERY_AVATAR_BYTES;
SourceAvatarModel.of = SourceAvatarModel;
/** 从 `discovery_sources` 行（或 `discovery_source_avatars` 行）构造。 */
SourceAvatarModel.fromRow = (row) => SourceAvatarModel({
  source_id: row?.id ?? row?.source_id,
  updated_at: row?.avatar_updated_at ?? row?.updated_at,
});
/**
 * 头像的对外地址。返回**同源相对路径**，两个前端各自在自己的 origin 上代理它；
 * URL 带 `?v=<ts>`，所以响应可以安全地长缓存。
 * @param {string} source_id
 * @param {number} avatar_updated_at
 * @returns {string}
 */
SourceAvatarModel.path = (source_id, avatar_updated_at) => {
  const updated_at = Number(avatar_updated_at || 0);
  if (!(updated_at > 0)) return "";
  return `/api/avatar/${source_id}?v=${updated_at}`;
};
/**
 * 按文件头魔数判断图片类型；不认识的返回空串（调用方据此回 415）。
 * 只覆盖 png/jpeg/webp/gif/ico 五种光栅格式。
 *
 * 与 `xiaoxunrss-worker/src/domain/file_icon.js` 的 `sniff_file_icon_content_type` 是
 * **两份必须一起改**的镜像（两个 worker 不共享源码，刻意重复）。改这里要同步改那里。
 * @param {Uint8Array | ArrayBuffer} bytes
 * @returns {"" | "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "image/x-icon"}
 */
SourceAvatarModel.sniff = (bytes) => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view.length < 12) return "";
  if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4e && view[3] === 0x47) {
    return "image/png";
  }
  if (view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) return "image/jpeg";
  if (
    view[0] === 0x52 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x46 &&
    view[8] === 0x57 && view[9] === 0x45 && view[10] === 0x42 && view[11] === 0x50
  ) {
    return "image/webp";
  }
  if (view[0] === 0x47 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x38) {
    return "image/gif";
  }
  if (
    view[0] === 0 && view[1] === 0 && view[2] === 1 && view[3] === 0 &&
    (view[4] !== 0 || view[5] !== 0) && view.length >= 6 + (view[4] + view[5] * 256) * 16
  ) {
    return "image/x-icon";
  }
  return "";
};

/**
 * 订阅源实体。同一套归一同时吃两种形状：
 *   - SQLite 行（`fromRow`）：`tags_json` 列、0/1 的 `enabled`/`require_token`、
 *     `avatar_updated_at`。
 *   - 请求体（`fromValue` / `validate` 的结果）：`tags` 数组、真正的布尔。
 * `toValue()` 与旧的 `discovery_source_value(row)` 逐字节一致。
 * @param {Record<string, unknown>} [state]
 */
export function DiscoverySourceModel(state) {
  const source = state ?? {};
  const social_urls = social_urls_from_source(source);
  const state_ = Object.freeze({
    id: String(source.id ?? ""),
    title: String(source.title ?? ""),
    description: String(source.description ?? ""),
    website: String(source.website ?? ""),
    social_url: social_urls[0] || "",
    social_urls: Object.freeze(social_urls),
    feed_url: String(source.feed_url ?? ""),
    category: String(source.category ?? ""),
    tags: Object.freeze(Array.isArray(source.tags) ? source.tags.map(String) : tags_from_json(source.tags_json)),
    enabled: typeof source.enabled === "boolean" ? source.enabled : Number(source.enabled) === 1,
    require_token: typeof source.require_token === "boolean"
      ? source.require_token
      : Number(source.require_token) === 1,
    credit_cost: Number(source.credit_cost ?? CreditModel.DEFAULT_COST),
    sort_order: Number(source.sort_order ?? 0),
    source_type: String(source.source_type || "website"),
    poll_policy: source.poll_policy || stored_poll_policy(source.poll_policy_json),
    avatar_updated_at: Number(source.avatar_updated_at ?? 0),
    created_at: Number(source.created_at ?? 0),
    updated_at: Number(source.updated_at ?? 0),
  });
  const avatar_url = DiscoverySourceModel.avatar_url(state_.id, state_.avatar_updated_at);
  return Object.freeze({
    ...state_,
    /** 旧分类作为标签兼容读取，存储原文不变。 */
    discovery_tags: () => [...new Set([...state_.tags, DISCOVERY_CATEGORY_TAGS[state_.category]].filter(Boolean))],
    /** 组合出的头像实体。 */
    avatar: () => SourceAvatarModel({ source_id: state_.id, updated_at: state_.avatar_updated_at }),
    /**
     * 该源是否让给定 route pathname 公开。三种要求同时满足：启用、不要求 token、
     * 地址的 route pathname 匹配（query 与 format 都忽略）。
     * @param {string} route_pathname
     * @returns {boolean}
     */
    is_public_route: (route_pathname) =>
      state_.enabled &&
      !state_.require_token &&
      SourceAddressModel(state_.feed_url).matches(route_pathname),
    toValue: () => ({
      id: state_.id,
      title: state_.title,
      description: state_.description,
      website: state_.website,
      social_url: state_.social_url,
      social_urls: [...state_.social_urls],
      feed_url: state_.feed_url,
      category: state_.category,
      tags: [...state_.tags],
      enabled: state_.enabled,
      require_token: state_.require_token,
      credit_cost: state_.credit_cost,
      sort_order: state_.sort_order,
      source_type: state_.source_type,
      poll_policy: state_.poll_policy,
      avatar_url,
      created_at: state_.created_at,
      updated_at: state_.updated_at,
    }),
  });
}

DiscoverySourceModel.TYPES = DISCOVERY_SOURCE_TYPES;
DiscoverySourceModel.MAX_BODY_BYTES = MAX_BODY_BYTES;
/** 目录条数上限。 */
DiscoverySourceModel.MAX_SOURCES = MAX_DISCOVERY_SOURCES;
/** 详情页「同类订阅源」条数。 */
DiscoverySourceModel.MAX_RELATED = DISCOVERY_RELATED_LIMIT;
DiscoverySourceModel.of = DiscoverySourceModel;
/** 从 SQLite 行构造。 */
DiscoverySourceModel.fromRow = (row) => DiscoverySourceModel(row);
/** 从请求体构造（只在已校验后使用）。 */
DiscoverySourceModel.fromValue = (body) => DiscoverySourceModel(body);
/** feed_url 已存在（新建或改名撞车）时的结果。文案逐字不变。 */
DiscoverySourceModel.duplicate_reason = () => ({
  status: 409,
  message: "discovery source already exists",
});
/**
 * PATCH 合并语义：请求体里出现过的字段覆盖旧值，缺省的沿用旧值。
 * 返回可直接交给 `validate` 的候选对象（仍是原始值，未归一）。
 * @param {ReturnType<typeof DiscoverySourceModel>} current
 * @param {Record<string, unknown>} body
 * @returns {Record<string, unknown>}
 */
DiscoverySourceModel.merge_for_patch = (current, body) => {
  const source = body ?? {};
  return {
    title: source.title ?? String(current.title),
    description: source.description ?? String(current.description),
    website: source.website ?? String(current.website),
    social_url: source.social_url ?? current.social_url,
    social_urls: source.social_urls !== undefined ? source.social_urls
      : source.social_url !== undefined ? (source.social_url === "" ? [] : [source.social_url]) : [...current.social_urls],
    feed_url: source.feed_url ?? String(current.feed_url),
    category: source.category ?? String(current.category),
    tags: source.tags ?? [...current.tags],
    enabled: source.enabled ?? Boolean(current.enabled),
    require_token: source.require_token ?? Boolean(current.require_token),
    credit_cost: source.credit_cost === undefined ? current.credit_cost : source.credit_cost,
    sort_order: source.sort_order ?? Number(current.sort_order),
    source_type: source.source_type ?? String(current.source_type),
    poll_policy: source.poll_policy === undefined ? current.poll_policy : source.poll_policy,
  };
};
/** 无头像时为空串。 */
DiscoverySourceModel.avatar_url = (source_id, avatar_updated_at) =>
  SourceAvatarModel.path(source_id, avatar_updated_at);
/**
 * 从 feed_url 推断来源类型。`{{hostname}}` 模板先用占位 origin 归一，再取
 * `/rss|/atom/` 之后的第一个路径段：脚本源的路由约定把抓取目标写在首段
 * （`/wxmp/<account>`、`/wxchannels/<id>`）。认不出来的一律网站。
 * @param {string} feed_url
 * @returns {string}
 */
DiscoverySourceModel.infer_type = (feed_url) => {
  if (typeof feed_url !== "string" || feed_url === "") return "website";
  const candidate = SourceAddressModel.feed_url_template(feed_url) ?? feed_url;
  let pathname;
  try {
    pathname = new URL(candidate).pathname;
  } catch {
    return "website";
  }
  const match = /^\/(?:rss|atom)\/([^/]+)/.exec(pathname);
  if (match === null) return "website";
  let segment;
  try {
    segment = decodeURIComponent(match[1]);
  } catch {
    return "website";
  }
  return DISCOVERY_SOURCE_TYPES.has(segment) ? segment : "website";
};

// 订阅源管理：登记校验与请求体解析。
/** 校验失败一律 400（`parseBody` 的解析/超限错误才用别的状态码）。 */
const invalid = (message) => ({ ok: false, error: { status: 400, message } });

/**
 * 校验登记/修改请求体，返回可直接落库的 `DiscoverySourceModel`。
 * 错误文案保持逐字不变（管理页与测试都依赖）。
 * @param {Record<string, unknown>} body
 * @returns {{ ok: true, model: ReturnType<typeof DiscoverySourceModel> }
 *   | { ok: false, error: { status: number, message: string } }}
 */
DiscoverySourceModel.validate = (body, source_types = DISCOVERY_SOURCE_TYPES, inferred_type) => {
  let poll_policy;
  try { poll_policy = parse_poll_policy(body.poll_policy === undefined ? { mode: "inherit" } : body.poll_policy); }
  catch (error) { return invalid(error.message); }
  if (body.title !== undefined && typeof body.title !== "string") {
    return invalid("title must be a string");
  }
  const title = String(body.title ?? "").trim();
  if (title.length < 1 || title.length > 128 || /[\r\n]/.test(title)) {
    return invalid("title must be 1 to 128 characters without newlines");
  }
  if (body.description !== undefined && typeof body.description !== "string") {
    return invalid("description must be a string");
  }
  const description = String(body.description ?? "").trim();
  if (description.length > 1000 || /\r|\n\n\n/.test(description)) {
    return invalid("description format is invalid");
  }
  if (body.website !== undefined && typeof body.website !== "string") {
    return invalid("website must be a string");
  }
  const website_value = String(body.website ?? "").trim();
  const website = website_value === "" ? "" : public_http_url(website_value);
  if (website_value !== "" && website === null) {
    return invalid("website must be a public HTTP(S) URL");
  }
  if (body.social_url !== undefined && typeof body.social_url !== "string") {
    return invalid("social_url must be a string");
  }
  if (body.social_urls !== undefined && (!Array.isArray(body.social_urls) || body.social_urls.some(value => typeof value !== "string"))) {
    return invalid("social_urls must be an array of strings");
  }
  const social_urls = [];
  for (const value of body.social_urls ?? [body.social_url ?? ""]) {
    if (!value.trim()) continue;
    const url = public_http_url(value.trim());
    if (url === null) return invalid("social_urls must contain public HTTP(S) URLs");
    if (!social_urls.includes(url)) social_urls.push(url);
  }
  if (body.feed_url !== undefined && typeof body.feed_url !== "string") {
    return invalid("feed_url must be a string");
  }
  const feed_url_input = String(body.feed_url ?? "").trim();
  const feed_url_template = SourceAddressModel.feed_url_template(feed_url_input);
  let feed_url;
  if (feed_url_template !== null) {
    // 模板写法只用于自有 /rss/、/atom/ 脚本源：替换占位 origin 后复用公网校验，存储保留原文。
    const resolved = public_http_url(feed_url_template);
    if (resolved === null) {
      return invalid("feed_url template must resolve to a public HTTP(S) URL");
    }
    const resolved_pathname = new URL(resolved).pathname;
    if (!resolved_pathname.startsWith("/rss/") && !resolved_pathname.startsWith("/atom/")) {
      return invalid("feed_url template must point to a /rss/ or /atom/ route");
    }
    feed_url = feed_url_input;
  } else {
    feed_url = public_http_url(feed_url_input);
    if (feed_url === null) {
      return invalid("feed_url must be a public HTTP(S) URL");
    }
  }
  const parsed_feed_url = new URL(feed_url_template ?? feed_url);
  if (
    (parsed_feed_url.pathname.startsWith("/rss/") || parsed_feed_url.pathname.startsWith("/atom/")) &&
    parsed_feed_url.searchParams.has("token")
  ) {
    return invalid("/rss/ and /atom/ feed_url must not contain a token query parameter");
  }
  if (body.category !== undefined && typeof body.category !== "string") {
    return invalid("category must be a string");
  }
  const category = String(body.category ?? "");
  if (category !== "" && !DISCOVERY_CATEGORIES.has(category)) {
    return invalid("invalid category");
  }
  if (
    body.tags !== undefined &&
    !Array.isArray(body.tags) &&
    typeof body.tags !== "string"
  ) {
    return invalid("tags must be an array or comma-separated string");
  }
  const tags_source = typeof body.tags === "string"
    ? body.tags.split(",")
    : Array.isArray(body.tags) ? body.tags : [];
  const tags = tags_source
    .map((tag) => String(tag).trim())
    .filter((tag) => tag !== "");
  // 无分类的源多留一格，容纳旧数据的 12 个标签加原分类。
  const max_tags = category === "" ? 13 : 12;
  if (tags.length > max_tags || tags.some((tag) => tag.length > 32 || /[\r\n]/.test(tag))) {
    return invalid("each tag must be 1 to 32 characters without newlines");
  }
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    return invalid("enabled must be a boolean");
  }
  const enabled = body.enabled === undefined ? true : body.enabled;
  if (body.require_token !== undefined && typeof body.require_token !== "boolean") {
    return invalid("require_token must be a boolean");
  }
  const require_token = body.require_token === undefined ? true : body.require_token;
  const credit_cost = body.credit_cost === undefined ? CreditModel.DEFAULT_COST : body.credit_cost;
  if (!Number.isInteger(credit_cost) || credit_cost < 0 || credit_cost > CreditModel.MAX_BALANCE) {
    return invalid("credit_cost must be an integer between 0 and " + CreditModel.MAX_BALANCE);
  }
  if (body.sort_order !== undefined && !Number.isInteger(body.sort_order)) {
    return invalid("sort_order must be an integer");
  }
  const sort_order = body.sort_order === undefined ? 0 : body.sort_order;
  if (Math.abs(sort_order) > 1_000_000) {
    return invalid("sort_order must be between -1000000 and 1000000");
  }
  if (body.source_type !== undefined && typeof body.source_type !== "string") {
    return invalid("source_type must be a string");
  }
  // 缺省按 feed_url 预判（PATCH 走合并后的 candidate，永远带着旧值，所以只在新建时生效）。
  const source_type = body.source_type === undefined || body.source_type === ""
    ? inferred_type ?? DiscoverySourceModel.infer_type(feed_url)
    : body.source_type;
  if (!source_types.has(source_type)) {
    return invalid("invalid source_type");
  }
  return {
    ok: true,
    model: DiscoverySourceModel({
      title,
      description,
      website,
      social_urls,
      feed_url,
      category,
      tags,
      enabled,
      require_token,
      credit_cost,
      sort_order,
      source_type,
      poll_policy,
    }),
  };
};

/**
 * 读请求体并校验：超限 413、坏 JSON 400，其余交给 `validate`。
 * @param {Request} request
 * @returns {Promise<{ ok: true, model: ReturnType<typeof DiscoverySourceModel> }
 *   | { ok: false, error: { status: number, message: string } }>}
 */
DiscoverySourceModel.parseBody = async (request, validate = DiscoverySourceModel.validate) => {
  const content_length = Number(request.headers.get("Content-Length") ?? "0");
  if (content_length > MAX_BODY_BYTES) {
    return { ok: false, error: { status: 413, message: "request body is too large" } };
  }
  /** @type {unknown} */
  let body;
  try {
    body = await request.json();
  } catch {
    return { ok: false, error: { status: 400, message: "invalid JSON" } };
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: { status: 400, message: "invalid JSON body" } };
  }
  return validate(/** @type {Record<string, unknown>} */ (body));
};
