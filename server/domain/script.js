// 脚本（scripts 行）实体：正文之外的一切都从 `metadata_json` 里取。
// route 元数据由保存时分析写入，Debug 由管理开关配置；坏 JSON 当空对象——宁可列表少几个字段，
// 也不要整个管理页 500（因此 metadata 解析与 route pattern 编译都不抛错）。
//
// 纯模块，可在 node --test 下直接覆盖。

import { MAX_SCRIPTS, MAX_SCRIPT_BYTES } from "../lib/constants.js";
import { RssRoutePatternModel } from "./rss_route.js";
import { script_type } from "../lib/script_type.js";
import { script_platform } from "../lib/discovery_platform.js";
import { script_tags } from "../lib/script_tags.js";

/** 脚本名字符上限。 */
const NAME_MAX_LENGTH = 128;

/**
 * 容错解析 metadata_json：坏 JSON、数组、标量一律归一成空对象。
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function parse_metadata_json(value) {
  let metadata = {};
  try {
    metadata = JSON.parse(String(value || "{}"));
  } catch {}
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    metadata = {};
  }
  return metadata;
}

/**
 * scripts 行实体。`route` 是主键（UUID），`path` 是路由模式，
 * 其余展示字段优先取 metadata、缺失回退到行上的列。
 * @param {Record<string, unknown>} row
 */
export function ScriptModel(row) {
  const source = row ?? {};
  const metadata = parse_metadata_json(source.metadata_json);
  const draft = metadata.draft && (typeof metadata.draft.script === "string" || metadata.draft.source_ref) ? metadata.draft : null;
  const state = Object.freeze({
    id: String(source.route || ""),
    path: String(metadata.path || source.path || ""),
    name: String(metadata.name || source.title || ""),
    url: String(metadata.url || ""),
    platform: Object.freeze(script_platform(metadata.platform)),
    tags: Object.freeze(script_tags(metadata.tags)),
    maintainers: Object.freeze(
      Array.isArray(metadata.maintainers) ? metadata.maintainers.map(value =>
        value && typeof value === "object" ? Object.freeze({ nickname: String(value.nickname || value.name || ""),
          url: String(value.url || ""), avatar: String(value.avatar || "") }) : String(value)) : [],
    ),
    example: String(metadata.example || ""),
    parameters: metadata.parameters && typeof metadata.parameters === "object"
      ? metadata.parameters
      : {},
    description: String(metadata.description || ""),
    routes: Object.freeze(
      (Array.isArray(metadata.routes) ? metadata.routes : [{ ...metadata, path: metadata.path || source.path || "" }])
        .filter(entry => entry && typeof entry === "object")
        .map(({ type, ...entry }, route_index) => Object.freeze({ ...entry, platform: Object.freeze(script_platform(entry.platform ?? metadata.platform)),
          tags: Object.freeze(script_tags(entry.tags ?? metadata.tags)),
          // 兼容已保存的旧图片路由，公开性与返回内容的格式无关。
          public: entry.public === undefined ? type === "image_proxy" : entry.public === true, route_index })),
    ),
    debug: metadata.debug === true,
    version: String(metadata.version || ""),
    published_version: String(metadata.published_version || (metadata.status !== "draft" ? metadata.version || "" : "")),
    published_script: typeof metadata.published_script === "string" ? metadata.published_script
      : metadata.status !== "draft" ? String(source.script || "") : null,
    script_hash: String(metadata.script_hash || ""),
    status: metadata.status === "draft" ? "draft" : "published",
    kind: script_type(source.script, metadata.kind ?? metadata.script_type),
    script: String(source.script || ""),
    draft: draft ? Object.freeze({
      script: String(draft.script || ""),
      version: String(draft.version || ""),
      kind: script_type(draft.script, draft.kind),
      enabled: draft.enabled === undefined ? Number(source.enabled) === 1 : draft.enabled === true,
      debug: draft.debug === true,
      cookie_grant_id: String(draft.cookie_grant_id || ""),
      updated_at: Number(draft.updated_at || 0),
      ...(draft.source_ref ? { source_ref: draft.source_ref } : {}),
    }) : null,
    enabled: Number(source.enabled) === 1,
    created_at: Number(source.created_at || 0),
    updated_at: Number(source.updated_at || 0),
  });
  return Object.freeze({
    ...state,
    script_type: state.kind,
    /**
     * 该脚本的 route 模式；path 非法或缺失时返回 null（不抛错）。
     * @returns {ReturnType<typeof RssRoutePatternModel> | null}
     */
    route_pattern: () => RssRoutePatternModel.fromValue(state.path),
    /** 是否能对外服务（正式、启用且有 route）。 */
    is_servable: () => state.status === "published" && state.enabled && state.path !== "",
    /**
     * 该脚本的 route 是否覆盖给定 pathname。
     * @param {string} pathname
     * @returns {boolean}
     */
    covers: (pathname) => {
      return state.routes.some(entry => RssRoutePatternModel.fromValue(entry.path)?.match(pathname) != null);
    },
    toValue: () => ({
      id: state.id,
      path: state.path,
      name: state.name,
      url: state.url,
      platform: { ...state.platform },
      tags: [...state.tags],
      maintainers: state.maintainers.map(value => typeof value === "object" ? { ...value } : value),
      example: state.example,
      parameters: state.parameters,
      description: state.description,
      ...(metadata.config_schema ? { config_schema: metadata.config_schema } : {}),
      config: metadata.config || {},
      ...(Array.isArray(metadata.routes) ? { routes: state.routes.map(entry => ({ ...entry, platform: { ...entry.platform }, tags: [...entry.tags] })) } : {}),
      cookie_grant_id: String(metadata.cookie_grant_id || ""),
      permissions: metadata.permissions || { cookies: [] },
      debug: state.debug,
      version: state.version,
      published_version: state.published_version,
      published_script: state.published_script,
      script_hash: state.script_hash,
      ...(metadata.source_ref ? { script_bytes: metadata.source_ref.bytes, source_loaded: source.source_loaded === true || source.script !== "" } : {}),
      ...(metadata.current_release_id ? { current_release_id: metadata.current_release_id,
        max_published_version: metadata.max_published_version || state.published_version } : {}),
      status: state.status,
      kind: state.kind,
      script_type: state.kind,
      script: state.script,
      ...(state.draft ? { draft: { ...state.draft } } : {}),
      enabled: state.enabled,
      created_at: state.created_at,
      updated_at: state.updated_at,
    }),
  });
}

ScriptModel.of = ScriptModel;
/** 脚本条数上限。 */
ScriptModel.MAX_SCRIPTS = MAX_SCRIPTS;
/** 脚本源码字节上限。 */
ScriptModel.MAX_BYTES = MAX_SCRIPT_BYTES;
/** 脚本名字符上限。 */
ScriptModel.NAME_MAX_LENGTH = NAME_MAX_LENGTH;
ScriptModel.STATUSES = Object.freeze(["draft", "published"]);
ScriptModel.TYPES = Object.freeze(["hot", "rss", "clip", "detect"]);
/** 从 SQLite 行构造；缺字段一律兜底，绝不抛错。 */
ScriptModel.fromRow = (row) => ScriptModel(row);
ScriptModel.fromValue = (value) => ScriptModel(value);
/**
 * 截断脚本名到列宽。
 * @param {unknown} name
 * @returns {string}
 */
ScriptModel.truncate_name = (name) => String(name ?? "").slice(0, NAME_MAX_LENGTH);
/**
 * 同 path 已存在时的结果。错误文案逐字不变（管理页与测试都依赖）。
 * @param {string} path
 * @returns {{ status: number, message: string }}
 */
ScriptModel.path_conflict_reason = (path) => ({
  status: 409,
  message: "route.path 已存在：" + path,
});
