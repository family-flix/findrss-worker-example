// 两类旁路日志的写入：设备日志与 脚本执行日志。
//
// 两者都是「归一 + 落库 + 结构化 console 输出」，被 tasks / devices / scripts 三个
// 服务共用，所以放在这里做**唯一**定义。刻意整体 try/catch 只 warn：日志写失败绝不能
// 影响真实业务（调用方常在 transactionSync 里）。
//
// 纯依赖注入（只吃 repo），不 import service、不造 Response。
import { DeviceLogModel } from "../../domain/device_log.js";
import { ScriptLogModel } from "../../domain/script_log.js";
import { emit_script_log } from "../../infra/script_sandbox.js";
import { DEVICE_LOG_LEVELS, MAX_RSS_ROUTE_PATH_BYTES } from "../../lib/constants.js";
import { valid_identifier } from "../../lib/identifiers.js";
import { serialize_log_metadata } from "../../lib/log_redact.js";

/**
 * @param {{ devices: { insert_log: (fields: Record<string, unknown>) => void } }} repo
 * @param {string} device_id
 * @param {string} category
 * @param {string} event_type
 * @param {string} message
 * @param {{
 *   connection_id?: string | null, direction?: string, level?: string,
 *   task_id?: string | null, method?: string | null, metadata?: unknown, created_at?: number,
 * }} [options]
 * @returns {void}
 */
export function record_device_log(repo, device_id, category, event_type, message, options = {}) {
  if (!valid_identifier(device_id)) return;
  const { category: normalized_category, direction, level } = DeviceLogModel.normalize({
    category,
    direction: options.direction,
    level: options.level,
  });
  try {
    repo.devices.insert_log({
      device_id,
      connection_id: options.connection_id || null,
      category: normalized_category,
      event_type: DeviceLogModel.truncate_event_type(event_type),
      direction,
      level,
      task_id: options.task_id || null,
      method: options.method || null,
      message: DeviceLogModel.truncate_message(message, event_type),
      metadata_json: serialize_log_metadata(options.metadata),
      created_at: options.created_at ?? Date.now(),
    });
  } catch (error) {
    console.error("failed to persist device log", {
      device_id,
      event_type,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 写入一条脚本执行日志。沿用 record_device_log 的防御式写法：失败只打 console.error，
 * 绝不让日志写入影响 /rss/ 响应；params/query/lines 走 serialize_log_metadata
 * （脱敏 + 64KB 截断）。结构化 console 输出与 DO 表双写，两者互不影响。
 * @param {{ script_logs: { insert: (fields: Record<string, unknown>) => void } }} repo
 * @param {Record<string, unknown>} record
 * @returns {void}
 */
export function record_script_log(repo, record) {
  const source = ScriptLogModel.normalize_source(record.source);
  const phase = ScriptLogModel.normalize_phase(record.phase);
  const level = DEVICE_LOG_LEVELS.has(record.level) ? record.level : "error";
  const status = record.status === "ok" ? "ok" : "error";
  let persisted = false;
  try {
    repo.script_logs.insert({
      route: String(record.route ?? "").slice(0, 128),
      path: String(record.path ?? "").slice(0, MAX_RSS_ROUTE_PATH_BYTES),
      source,
      method: String(record.method ?? "").slice(0, 16),
      pathname: String(record.pathname ?? "").slice(0, 1024),
      params_json: serialize_log_metadata(record.params),
      query_json: serialize_log_metadata(record.query),
      status,
      phase,
      level,
      message: ScriptLogModel.truncate_message(record.message),
      error_text: ScriptLogModel.truncate_error(record.error_text),
      lines_json: serialize_log_metadata(Array.isArray(record.lines) ? record.lines : []),
      elapsed_ms: Math.max(0, Math.floor(Number(record.elapsed_ms ?? 0))),
      invoked: record.invoked === true ? 1 : 0,
      device_id: record.device_id === undefined || record.device_id === null
        ? null
        : String(record.device_id).slice(0, 128),
      created_at: Number(record.created_at ?? Date.now()),
    });
    persisted = true;
  } catch (error) {
    console.error("failed to persist script log", {
      route: String(record.route ?? ""),
      source,
      phase,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  emit_script_log({ ...record, source, phase, level, status });
  return persisted;
}
