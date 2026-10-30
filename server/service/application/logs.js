// 两类旁路日志的写入：设备日志与 脚本执行日志。
//
// 设备和脚本共用归一、脱敏及结构化 console 输出；仓储只分配编号，不保存日志正文。
// 状态存储失败时仍输出日志，不能影响任务、设备连接或 Webhook。
//
// 纯依赖注入（只吃 repo），不 import service、不造 Response。
import { DeviceLogModel } from "../../domain/device_log.js";
import { ScriptLogModel } from "../../domain/script_log.js";
import { emit_worker_log } from "../../infra/workers_logs.js";
import { DEVICE_LOG_LEVELS, MAX_RSS_ROUTE_PATH_BYTES } from "../../lib/constants.js";
import { valid_identifier } from "../../lib/identifiers.js";
import { serialize_log_metadata } from "../../lib/log_redact.js";

/**
 * @param {{ devices: { insert_log: (fields: Record<string, unknown>) => unknown } }} repo
 * @param {string} device_id
 * @param {string} category
 * @param {string} event_type
 * @param {string} message
 * @param {{
 *   connection_id?: string | null, direction?: string, level?: string,
 *   task_id?: string | null, method?: string | null, metadata?: unknown, created_at?: number,
 * }} [options]
 * @returns {Promise<void>}
 */
export async function record_device_log(repo, device_id, category, event_type, message, options = {}) {
  if (!valid_identifier(device_id)) return;
  const {
    category: normalized_category,
    direction,
    level
  } = DeviceLogModel.normalize({
    category,
    direction: options.direction,
    level: options.level
  });
  const row = {
    id: 0,
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
    created_at: options.created_at ?? Date.now()
  };
  let stored = row;
  try {
    stored = (await repo.devices.insert_log(row)) || row;
  } catch (error) {
    console.error("failed to allocate device log id", {
      device_id,
      event_type,
      error: error instanceof Error ? error.message : String(error)
    });
  }
  emit_worker_log("device", stored);
}

/**
 * 写入一条脚本执行日志。沿用 record_device_log 的防御式写法：失败只打 console.error，
 * 绝不让日志写入影响 /rss/ 响应；params/query/lines 走 serialize_log_metadata
 * （脱敏 + 64KB 截断）。Webhook 直接使用本次规范化后的记录。
 * @param {{ script_logs: { insert: (fields: Record<string, unknown>) => unknown } }} repo
 * @param {Record<string, unknown>} record
 * @returns {Promise<Record<string, unknown>>}
 */
export async function record_script_log(repo, record) {
  const source = ScriptLogModel.normalize_source(record.source);
  const phase = ScriptLogModel.normalize_phase(record.phase);
  const level = DEVICE_LOG_LEVELS.has(record.level) ? record.level : "error";
  const status = record.status === "ok" ? "ok" : "error";
  const row = {
    id: 0,
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
    device_id: record.device_id === undefined || record.device_id === null ? null : String(record.device_id).slice(0, 128),
    created_at: Number(record.created_at ?? Date.now())
  };
  let stored = row;
  try {
    stored = (await repo.script_logs.insert(row)) || row;
  } catch (error) {
    console.error("failed to allocate script log id", {
      route: String(record.route ?? ""),
      source,
      phase,
      error: error instanceof Error ? error.message : String(error)
    });
  }
  return emit_worker_log("script", stored);
}
