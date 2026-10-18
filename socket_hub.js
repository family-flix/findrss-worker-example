// 设备 WebSocket 的接入点：把 Durable Object 的 `ctx.getWebSockets` /
// `ctx.acceptWebSocket` 与 socket 自身的 `send` / `close` 收在一处。
//
// 组合根只 new 一次并作为 `ports.sockets` 注入；service 与 handler 都走它，
// 不再直接碰 `ctx` 的 socket API。附件解析在 `infra/device_socket.js`。

/**
 * @param {DurableObjectState} ctx
 */
export class DeviceSocketHub {
  constructor(ctx) {
    this.ctx = ctx;
  }

  /** @returns {WebSocket[]} */
  get_all() {
    return this.ctx.getWebSockets().filter(socket => socket.deserializeAttachment?.()?.kind !== "admin");
  }

  /** @param {string} device_id @returns {WebSocket[]} */
  get_for_device(device_id) {
    return this.ctx.getWebSockets(`client:${device_id}`);
  }

  /** @param {string} method @returns {WebSocket[]} */
  get_for_method(method) {
    return this.ctx.getWebSockets(`method:${method}`);
  }

  /**
   * @param {WebSocket} socket
   * @param {string[]} tags
   * @returns {void}
   */
  accept(socket, tags) {
    this.ctx.acceptWebSocket(socket, tags);
  }

  /**
   * @param {WebSocket} socket
   * @param {number} code
   * @param {string} reason
   * @returns {void}
   */
  close(socket, code, reason) {
    socket.close(code, reason);
  }

  /**
   * @param {WebSocket} socket
   * @param {unknown} value
   * @returns {void}
   */
  send(socket, value) {
    socket.send(JSON.stringify(value));
  }
}
