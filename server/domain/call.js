// 调用（calls 行）实体。响应键仍是 `task`，字段名沿用早期设备协议：
// `publisher_id`/`target_client_id`/`assigned_client_id`/`args`/`result` 是别名，
// `*_device_id`/`payload`/`error` 是规范名，同一份数据给两份，避免已发布的设备端改动。
//
// 纯模块，可在 node --test 下直接覆盖。

import { LEASE_MILLISECONDS, MAX_ATTEMPTS, MAX_QUEUED_CALLS } from "../lib/constants.js";

/** 失败原因列的字符上限（与 MAX_BODY_BYTES 无关，留出余量）。 */
const ERROR_MAX_LENGTH = 4000;
/** 设备未给错误原因时的兜底文案。 */
const DEFAULT_ERROR = "task failed";

/**
 * calls 行实体。`args_json`/`result_json` 在这里解析成对象。
 * @param {Record<string, unknown>} [row]
 */
export function CallModel(row) {
  const source = row ?? {};
  const args = JSON.parse(String(source.args_json));
  const result = source.result_json === null ? null : JSON.parse(String(source.result_json));
  const state = Object.freeze({
    id: source.id,
    method: source.method,
    credit_cost: Number(source.credit_cost),
    publisher_device_id: source.publisher_device_id,
    target_device_id: source.target_device_id,
    idempotency_key: source.idempotency_key,
    args,
    status: source.status,
    assigned_device_id: source.assigned_device_id,
    lease_expires_at: source.lease_expires_at,
    attempt_count: source.attempt_count,
    result,
    error_message: source.error_message,
    created_at: source.created_at,
    updated_at: source.updated_at,
    completed_at: source.completed_at,
  });
  return Object.freeze({
    ...state,
    /**
     * 租约是否已过期（用于 alarm 的清理口径）。
     * @param {number} [now]
     * @returns {boolean}
     */
    is_expired: (now = Date.now()) =>
      state.lease_expires_at !== null && Number(state.lease_expires_at) <= now,
    /**
     * 重试次数是否已用完。
     * @returns {boolean}
     */
    attempts_exhausted: () => Number(state.attempt_count) >= MAX_ATTEMPTS,
    toValue: () => ({
      id: state.id,
      method: state.method,
      kind: state.method,
      credit_cost: state.credit_cost,
      publisher_id: state.publisher_device_id,
      publisher_device_id: state.publisher_device_id,
      target_client_id: state.target_device_id,
      target_device_id: state.target_device_id,
      idempotency_key: state.idempotency_key,
      args: state.args,
      payload: state.args,
      status: state.status,
      assigned_client_id: state.assigned_device_id,
      assigned_device_id: state.assigned_device_id,
      lease_expires_at: state.lease_expires_at,
      attempt_count: state.attempt_count,
      result: state.result,
      error: state.error_message,
      created_at: state.created_at,
      updated_at: state.updated_at,
      completed_at: state.completed_at,
    }),
  });
}

CallModel.of = CallModel;
/** 最大尝试次数（含首次派发）。 */
CallModel.MAX_ATTEMPTS = MAX_ATTEMPTS;
/** 租约时长（毫秒）。 */
CallModel.LEASE_MS = LEASE_MILLISECONDS;
/** 排队任务上限。 */
CallModel.MAX_QUEUED = MAX_QUEUED_CALLS;
CallModel.ERROR_MAX_LENGTH = ERROR_MAX_LENGTH;
/** 从 SQLite 行构造。 */
CallModel.fromRow = (row) => CallModel(row);
/**
 * 本次心跳/接收时的租约截止时刻。
 * @param {number} now
 * @returns {number}
 */
CallModel.lease_deadline = (now) => now + LEASE_MILLISECONDS;
/**
 * 行是否属于该设备且租约匹配（设备侧消息的鉴权口径）。
 * @param {Record<string, unknown> | null} row
 * @param {string} device_id
 * @param {unknown} lease_token
 * @returns {boolean}
 */
CallModel.owned_by = (row, device_id, lease_token) =>
  row !== null &&
  (row.status === "assigned" || row.status === "running") &&
  row.assigned_device_id === device_id &&
  row.lease_token === lease_token;
/**
 * 设备上报失败时是否应重新排队：显式 retryable 且还有重试次数。
 * @param {Record<string, unknown>} message
 * @param {Record<string, unknown>} row
 * @returns {boolean}
 */
CallModel.is_retryable = (message, row) =>
  message?.retryable === true && Number(row.attempt_count) < MAX_ATTEMPTS;
/**
 * 截断设备上报的错误原因；缺省回落到 `task failed`。
 * @param {unknown} error
 * @returns {string}
 */
CallModel.truncate_error = (error) =>
  String(error ?? DEFAULT_ERROR).slice(0, ERROR_MAX_LENGTH);
