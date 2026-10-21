// 设备 WebSocket 附件（`socket.deserializeAttachment()`）的归一化。
//
// 这是**唯一**的定义处：`DeviceSocketHub` 与各 service 都从这里 import，
// 严禁再复制一份。它只依赖 `domain/device_capacity.js`（infra→domain 合法）。
//
// 纯函数，可在 node --test 下直接覆盖。

import { DeviceModel } from "../domain/device_capacity.js";

/**
 * @typedef {Object} SocketAttachment
 * @property {string} device_id
 * @property {string} [device_token_id]
 * @property {string} [client_id]
 * @property {string} connection_id
 * @property {string[]} methods
 * @property {string[]} [capabilities]
 * @property {string} device_name
 * @property {string} device_os
 * @property {number} max_concurrency
 * @property {number} [connected_at]
 * @property {number} [last_seen_at]
 */

/**
 * @param {WebSocket} socket
 * @returns {SocketAttachment | null}
 */
export function socket_attachment(socket) {
  try {
    /** @type {SocketAttachment | null} */
    const value = socket.deserializeAttachment();
    if (!value?.device_id && value?.client_id) {
      value.device_id = value.client_id;
    }
    if (!value?.device_id) return null;
    value.methods = Array.isArray(value.methods)
      ? value.methods
      : Array.isArray(value.capabilities)
        ? value.capabilities
        : [];
    value.max_concurrency = DeviceModel.normalize_concurrency(value.max_concurrency);
    return value;
  } catch {
    return null;
  }
}
