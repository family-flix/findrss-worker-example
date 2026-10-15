// 设备日志（device_logs 行）实体。
//
// 与 `serialize_log_metadata` 配对：写进库的一定是合法 JSON，读出来仍容错一次，
// 坏了要给管理页一个可解释的 metadata 而不是抛错。
//
// 纯模块，可在 node --test 下直接覆盖。

import {
  DEFAULT_DEVICE_LOG_LIMIT,
  DEVICE_LOG_CATEGORIES,
  DEVICE_LOG_DIRECTIONS,
  DEVICE_LOG_LEVELS,
  MAX_DEVICE_LOG_LIMIT,
  MAX_DEVICE_LOG_MESSAGE_LENGTH,
} from "../lib/constants.js";

/** event_type 列的字符上限。 */
const EVENT_TYPE_MAX_LENGTH = 128;

/**
 * device_logs 行实体。`metadata` 是解析后的对象，不吐 `metadata_json` 原文。
 * @param {Record<string, unknown>} [row]
 */
export function DeviceLogModel(row) {
  const source = row ?? {};
  let metadata = {};
  try {
    metadata = JSON.parse(String(source.metadata_json));
  } catch {
    metadata = { serialization_error: "invalid stored metadata" };
  }
  const state = Object.freeze({
    id: Number(source.id),
    device_id: source.device_id,
    connection_id: source.connection_id,
    category: source.category,
    event_type: source.event_type,
    direction: source.direction,
    level: source.level,
    task_id: source.task_id,
    method: source.method,
    message: source.message,
    metadata,
    created_at: source.created_at,
  });
  return Object.freeze({
    ...state,
    toValue: () => ({
      id: state.id,
      device_id: state.device_id,
      connection_id: state.connection_id,
      category: state.category,
      event_type: state.event_type,
      direction: state.direction,
      level: state.level,
      task_id: state.task_id,
      method: state.method,
      message: state.message,
      metadata: state.metadata,
      created_at: state.created_at,
    }),
  });
}

DeviceLogModel.of = DeviceLogModel;
DeviceLogModel.DEFAULT_LIMIT = DEFAULT_DEVICE_LOG_LIMIT;
DeviceLogModel.MAX_LIMIT = MAX_DEVICE_LOG_LIMIT;
DeviceLogModel.MESSAGE_MAX_LENGTH = MAX_DEVICE_LOG_MESSAGE_LENGTH;
DeviceLogModel.EVENT_TYPE_MAX_LENGTH = EVENT_TYPE_MAX_LENGTH;
/** 从 SQLite 行构造。 */
DeviceLogModel.fromRow = (row) => DeviceLogModel(row);
/**
 * 归一 category/direction/level：不认识的一律回落到 system/internal/info。
 * @param {{ category?: unknown, direction?: unknown, level?: unknown }} [input]
 * @returns {{ category: string, direction: string, level: string }}
 */
DeviceLogModel.normalize = (input) => {
  const source = input ?? {};
  const category = String(source.category ?? "");
  const direction = String(source.direction ?? "");
  const level = String(source.level ?? "");
  return {
    category: DEVICE_LOG_CATEGORIES.has(category) ? category : "system",
    direction: DEVICE_LOG_DIRECTIONS.has(direction) ? direction : "internal",
    level: DEVICE_LOG_LEVELS.has(level) ? level : "info",
  };
};
/**
 * 截断日志正文；空值回落到 event_type，再空则用兜底文案。
 * @param {unknown} message
 * @param {unknown} event_type
 * @returns {string}
 */
DeviceLogModel.truncate_message = (message, event_type) =>
  String(message || event_type || "设备事件").slice(0, MAX_DEVICE_LOG_MESSAGE_LENGTH);
/**
 * 截断事件类型。
 * @param {unknown} event_type
 * @returns {string}
 */
DeviceLogModel.truncate_event_type = (event_type) =>
  String(event_type || "system.event").slice(0, EVENT_TYPE_MAX_LENGTH);
/**
 * 归一每页条数：非法/缺省取默认，其余夹到 [1, 上限]。
 * @param {unknown} value
 * @returns {number}
 */
DeviceLogModel.clamp_limit = (value) => {
  const number = Number(value ?? DEFAULT_DEVICE_LOG_LIMIT);
  return Number.isFinite(number)
    ? Math.max(1, Math.min(MAX_DEVICE_LOG_LIMIT, Math.floor(number)))
    : DEFAULT_DEVICE_LOG_LIMIT;
};
