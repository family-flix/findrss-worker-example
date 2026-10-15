// 脚本执行日志域：查询归一化 + 日志行实体。
// 纯模块，不依赖 Cloudflare API，也不依赖 lib/http（校验失败只回数据，不回 Response）。
//
// `ScriptLogQueryModel.fromQuery` 是 `/logs` 的入口闸门，
// `ScriptLogModel.fromRow` 把 `script_logs` 行反序列化成响应值。
// 纯模块，可在 node --test 下直接覆盖。

import {
  MAX_DEVICE_LOG_MESSAGE_LENGTH,
  MAX_SCRIPT_LOG_ERROR_LENGTH,
  SCRIPT_LOG_PHASES,
  SCRIPT_LOG_SOURCES,
} from "../lib/constants.js";

/** 默认每页条数。 */
const DEFAULT_SCRIPT_LOG_LIMIT = 50;
/** 每页条数上限。 */
const MAX_SCRIPT_LOG_LIMIT = 200;
/** route 是 scripts.route（UUID），此处只做长度与空白兜底。 */
const MAX_ROUTE_LENGTH = 128;

/**
 * 反序列化一个 JSON 字段；坏 JSON 或类型不符时降级为 fallback，绝不抛错。
 * @param {unknown} value
 * @param {unknown} fallback
 * @param {(parsed: unknown) => boolean} valid
 * @returns {unknown}
 */
function parse_log_json(value, fallback, valid) {
  try {
    const parsed = JSON.parse(String(value ?? ""));
    return valid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/**
 * `/logs` 查询实体：route / limit / before_id 三个已归一化的入参。
 * route 必填（走 query 而非路径段，避免把 UUID 塞进路径正则），limit 夹到
 * [1, 上限]，before_id 必须是正整数。校验规则挂在 `fromQuery` 静态方法上。
 * @param {{ route?: unknown, limit?: unknown, before_id?: unknown }} [state]
 */
export function ScriptLogQueryModel(state) {
  const source = state ?? {};
  const before_id = source.before_id === null || source.before_id === undefined
    ? null
    : Number(source.before_id);
  const state_ = Object.freeze({
    route: String(source.route ?? ""),
    limit: Number(source.limit ?? DEFAULT_SCRIPT_LOG_LIMIT),
    before_id,
  });
  return Object.freeze({
    ...state_,
    toValue: () => ({ route: state_.route, limit: state_.limit, before_id: state_.before_id }),
  });
}

ScriptLogQueryModel.DEFAULT_LIMIT = DEFAULT_SCRIPT_LOG_LIMIT;
ScriptLogQueryModel.MAX_LIMIT = MAX_SCRIPT_LOG_LIMIT;
ScriptLogQueryModel.MAX_ROUTE_LENGTH = MAX_ROUTE_LENGTH;
ScriptLogQueryModel.of = ScriptLogQueryModel;
/**
 * 归一化 `/logs` 查询参数。非法输入返回 `{ ok: false, error: { status: 400, message } }`，
 * 调用方据此回 400。错误文案保持逐字不变（测试锁死）。
 * @param {URL} url
 * @returns {{ ok: true, model: ReturnType<typeof ScriptLogQueryModel> }
 *   | { ok: false, error: { status: number, message: string } }}
 */
ScriptLogQueryModel.fromQuery = (url, { require_route = true } = {}) => {
  const route = (url.searchParams.get("route") ?? "").trim();
  if (require_route && route === "") {
    return { ok: false, error: { status: 400, message: "route 不能为空" } };
  }
  if (route.length > MAX_ROUTE_LENGTH) {
    return { ok: false, error: { status: 400, message: "route 过长" } };
  }
  const limit_value = Number(url.searchParams.get("limit") ?? DEFAULT_SCRIPT_LOG_LIMIT);
  const limit = Number.isFinite(limit_value)
    ? Math.max(1, Math.min(MAX_SCRIPT_LOG_LIMIT, Math.floor(limit_value)))
    : DEFAULT_SCRIPT_LOG_LIMIT;
  const before_value = url.searchParams.get("before_id");
  if (before_value !== null && before_value !== "") {
    const before_id = Number(before_value);
    if (!Number.isSafeInteger(before_id) || before_id <= 0) {
      return { ok: false, error: { status: 400, message: "invalid before_id" } };
    }
    return { ok: true, model: ScriptLogQueryModel({ route, limit, before_id }) };
  }
  return { ok: true, model: ScriptLogQueryModel({ route, limit, before_id: null }) };
};

/**
 * script_logs 行实体：`params`/`query`/`lines` 从 `*_json` 反序列化，
 * 坏 JSON 一律降级（`{}` / `[]`），绝不抛错。
 * @param {Record<string, unknown>} [row]
 */
export function ScriptLogModel(row) {
  const source = row ?? {};
  const is_object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const state = Object.freeze({
    id: Number(source.id),
    route: String(source.route ?? ""),
    path: String(source.path ?? ""),
    source: String(source.source ?? ""),
    method: String(source.method ?? ""),
    pathname: String(source.pathname ?? ""),
    params: parse_log_json(source.params_json, {}, is_object),
    query: parse_log_json(source.query_json, {}, is_object),
    status: String(source.status ?? ""),
    phase: String(source.phase ?? ""),
    level: String(source.level ?? ""),
    message: String(source.message ?? ""),
    error_text: String(source.error_text ?? ""),
    lines: parse_log_json(source.lines_json, [], Array.isArray),
    elapsed_ms: Number(source.elapsed_ms ?? 0),
    invoked: Number(source.invoked ?? 0) === 1,
    device_id: source.device_id === null || source.device_id === undefined ? null : String(source.device_id),
    created_at: Number(source.created_at ?? 0),
  });
  return Object.freeze({
    ...state,
    toValue: () => ({
      id: state.id,
      route: state.route,
      path: state.path,
      source: state.source,
      method: state.method,
      pathname: state.pathname,
      params: state.params,
      query: state.query,
      status: state.status,
      phase: state.phase,
      level: state.level,
      message: state.message,
      error_text: state.error_text,
      lines: state.lines,
      elapsed_ms: state.elapsed_ms,
      invoked: state.invoked,
      device_id: state.device_id,
      created_at: state.created_at,
    }),
  });
}

ScriptLogModel.of = ScriptLogModel;
/** 从 SQLite 行构造。 */
ScriptLogModel.fromRow = (row) => ScriptLogModel(row);
/**
 * 归一日志来源：不认识的一律算真实请求。
 * @param {unknown} value
 * @returns {string}
 */
ScriptLogModel.normalize_source = (value) => {
  const source = String(value ?? "");
  return SCRIPT_LOG_SOURCES.has(source) ? source : "request";
};
/**
 * 归一失败相位：不认识的一律算运行时。
 * @param {unknown} value
 * @returns {string}
 */
ScriptLogModel.normalize_phase = (value) => {
  const phase = String(value ?? "");
  return SCRIPT_LOG_PHASES.has(phase) ? phase : "runtime";
};
/**
 * 截断错误正文到列宽。
 * @param {unknown} value
 * @returns {string}
 */
ScriptLogModel.truncate_error = (value) =>
  String(value ?? "").slice(0, MAX_SCRIPT_LOG_ERROR_LENGTH);
/**
 * 截断日志消息到列宽。
 * @param {unknown} value
 * @returns {string}
 */
ScriptLogModel.truncate_message = (value) =>
  String(value ?? "").slice(0, MAX_DEVICE_LOG_MESSAGE_LENGTH);
