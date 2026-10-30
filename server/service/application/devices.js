import { async_filter, async_map } from "../../lib/async_array.js"; // 设备接入、设备状态、设备日志与设备管理动作。
//
// 只回数据或抛 DurableObjectError，绝不造 Response（router 是唯一翻译点）；唯一例外是
// WebSocket 101：本服务只负责登记 server socket 并把 client socket 交回调用方，
// `new Response(101)` 留在 DO 壳里（见计划里的 4 处特例）。
import { DeviceLogModel } from "../../domain/device_log.js";
import { DeviceModel } from "../../domain/device_capacity.js";
import { DEVICE_LOG_CATEGORIES, MAX_BODY_BYTES, RETENTION_MILLISECONDS } from "../../lib/constants.js";
import { valid_identifier } from "../../lib/identifiers.js";
import { socket_attachment } from "../../infra/device_socket.js";
import { do_error } from "./error.js";
import { record_device_log } from "./logs.js";
export class ServiceDevice {
  /**
   * @param {{ repo: Record<string, any>, ports: Record<string, any>, app: Record<string, any> }} deps
   */
  constructor({
    repo,
    ports,
    app
  }) {
    this.repo = repo;
    this.ports = ports;
    /** 兄弟服务注册表（tasks 的 dispatch_pending / fail_device_tasks）。 */
    this.app = app;
  }

  /**
   * @param {WebSocket} socket
   * @param {string | ArrayBuffer} message
   * @returns {Promise<void>}
   */
  async webSocketMessage(socket, message) {
    const attachment = socket_attachment(socket);
    if (attachment === null) {
      await socket.close(1008, "missing client attachment");
      return;
    }
    if (this.app.device_tokens && !(await this.app.device_tokens.is_active(attachment.device_token_id))) {
      await this.close_unauthorized_connections();
      return;
    }
    await this.record_device_activity(socket, attachment);
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    if (text.length > MAX_BODY_BYTES) {
      await socket.send(JSON.stringify({
        type: "error",
        error: "message is too large"
      }));
      this.record_device_log(attachment.device_id, "system", "protocol.message_rejected", "拒绝过大的设备消息", {
        connection_id: attachment.connection_id,
        direction: "inbound",
        level: "warn",
        metadata: {
          message_length: text.length,
          reason: "message is too large"
        }
      });
      return;
    }

    /** @type {ClientMessage} */
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      await socket.send(JSON.stringify({
        type: "error",
        error: "invalid JSON"
      }));
      this.record_device_log(attachment.device_id, "system", "protocol.message_rejected", "拒绝无法解析的设备消息", {
        connection_id: attachment.connection_id,
        direction: "inbound",
        level: "warn",
        metadata: {
          message_length: text.length,
          reason: "invalid JSON"
        }
      });
      return;
    }
    switch (value.type) {
      case "client.heartbeat":
        await socket.send(JSON.stringify({
          type: "client.heartbeat.ack",
          at: Date.now()
        }));
        this.record_device_log(attachment.device_id, "heartbeat", "heartbeat.connection", "收到连接心跳并已响应", {
          connection_id: attachment.connection_id,
          direction: "inbound",
          metadata: {
            request: value,
            response_type: "client.heartbeat.ack"
          }
        });
        return;
      case "task.accept":
        await this.app.tasks.accept_task(socket, attachment, value);
        return;
      case "task.heartbeat":
        await this.app.tasks.heartbeat_task(socket, attachment, value);
        return;
      case "task.complete":
        await this.app.tasks.complete_task(socket, attachment, value);
        return;
      case "task.fail":
        await this.app.tasks.fail_task(socket, attachment, value);
        return;
      default:
        await socket.send(JSON.stringify({
          type: "error",
          error: "unknown message type"
        }));
        this.record_device_log(attachment.device_id, "system", "protocol.message_rejected", "拒绝未知类型的设备消息", {
          connection_id: attachment.connection_id,
          direction: "inbound",
          level: "warn",
          task_id: value.task_id,
          metadata: {
            request: value,
            reason: "unknown message type"
          }
        });
    }
  }

  /**
   * @param {WebSocket} socket
   * @param {number} code
   * @param {string} reason
   * @param {boolean} was_clean
   * @returns {Promise<void>}
   */
  async webSocketClose(socket, code, reason, was_clean) {
    await this.mark_device_offline(socket, "connection.closed", "设备连接已关闭", {
      code,
      reason,
      was_clean
    });
    await socket.close(code, reason || (was_clean ? "closed" : "connection lost"));
  }

  /**
   * @param {WebSocket} socket
   * @returns {Promise<void>}
   */
  async webSocketError(socket) {
    await this.mark_device_offline(socket, "connection.error", "设备连接发生错误", {});
    await socket.close(1011, "websocket error");
  }

  /**
   * @param {WebSocket} socket
   * @param {import("../../infra/device_socket.js").SocketAttachment} attachment
   * @returns {void}
   */
  async record_device_activity(socket, attachment) {
    const now = Date.now();
    // 附件随 WebSocket 休眠恢复；SQL 只保存检查点，实时状态从附件读取。
    attachment.last_seen_at = now;
    await socket.serializeAttachment(attachment);
    await this.repo.devices.set_seen(attachment.device_id, attachment.connection_id, now);
  }

  /**
   * @param {WebSocket} socket
   * @param {string} event_type
   * @param {string} message
   * @param {unknown} metadata
   * @returns {void}
   */
  async mark_device_offline(socket, event_type, message, metadata) {
    const attachment = socket_attachment(socket);
    if (attachment === null) {
      return;
    }
    const now = Date.now();
    await this.repo.devices.set_offline(attachment.device_id, attachment.connection_id, now);
    this.record_device_log(attachment.device_id, "connection", event_type, message, {
      connection_id: attachment.connection_id,
      direction: "internal",
      level: event_type === "connection.error" ? "error" : "info",
      metadata,
      created_at: now
    });
  }

  /**
   * 登记新连接并回 client socket（101 Response 由 DO 壳组装）。
   * @param {Request} request
   * @returns {Promise<{ client: WebSocket }>}
   */
  async prepare_connection(request) {
    const device_token_id = request.headers.get("X-Api-Device-Token-ID") || "";
    if (this.app.device_tokens && !(await this.app.device_tokens.is_active(device_token_id))) throw do_error("unauthorized", 401);
    const device_id = request.headers.get("X-Api-Device-ID")?.trim() ?? "";
    if (!valid_identifier(device_id)) {
      throw do_error("invalid X-Api-Device-ID", 400);
    }
    const existing_device = await this.repo.devices.find_disabled(device_id);
    if (existing_device !== undefined && Number(existing_device.disabled) === 1) {
      this.record_device_log(device_id, "connection", "connection.device_disabled", "设备已被管理员禁用，连接被拒绝", {
        direction: "inbound",
        level: "warn"
      });
      throw do_error("device is disabled", 403);
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      this.record_device_log(device_id, "connection", "connection.upgrade_rejected", "连接请求不是 WebSocket Upgrade，已拒绝", {
        direction: "inbound",
        level: "warn"
      });
      throw do_error("websocket upgrade required", 426);
    }
    const device_name = DeviceModel.truncate_name(request.headers.get("X-Api-Device-Name"), device_id);
    const requested_device_os = (request.headers.get("X-Api-Device-OS") ?? "unknown").trim().slice(0, 32);
    const device_os = valid_identifier(requested_device_os) ? requested_device_os : "unknown";
    const max_concurrency = DeviceModel.normalize_concurrency(request.headers.get("X-Api-Max-Concurrency"));
    const methods = (request.headers.get("X-Api-Methods") ?? "").split(",").map(item => item.trim()).filter((item, index, values) => valid_identifier(item) && values.indexOf(item) === index).slice(0, 64);
    const connection_id = crypto.randomUUID();
    const connected_at = Date.now();
    const attachment = {
      device_id,
      device_token_id,
      connection_id,
      methods,
      device_name,
      device_os,
      max_concurrency,
      connected_at
    };
    await this.repo.devices.upsert_connection({
      ...attachment,
      methods_json: JSON.stringify(methods),
      last_seen_at: connected_at
    });
    return attachment;
  }

  /** @returns {Record<string, unknown>} */
  async summary() {
    await this.close_unauthorized_connections();
    /** @type {TaskCountRow[]} */
    const task_counts = await this.repo.calls.count_by_status();
    /** @type {import("../../infra/device_socket.js").SocketAttachment[]} */
    const active_devices = await async_filter((await this.ports.sockets.get_all()).map(socket_attachment), async item => item !== null && (!this.app.device_tokens || (await this.app.device_tokens.is_active(item.device_token_id))));
    const active_connections = new Map(active_devices.map(device => [device.connection_id, device]));
    /** @type {DeviceLoadRow[]} */
    const load_rows = await this.repo.devices.list_load_counts();
    const active_counts = new Map(load_rows.map(row => [row.assigned_device_id, Number(row.active_count)]));
    /** @type {DeviceRegistryRow[]} */
    const registry_rows = await this.repo.devices.list_registry();
    const now = Date.now();
    const devices = await async_map(registry_rows, async row => {
      const disabled = Number(row.disabled) === 1;
      const active_connection = active_connections.get(row.connection_id);
      const online = !disabled && active_connection !== undefined;
      const active_tasks = active_counts.get(row.device_id) ?? 0;
      const max_concurrency = DeviceModel.normalize_concurrency(row.max_concurrency);
      if (!online && row.status === "online") {
        await this.repo.devices.set_stale_offline(row.device_id, row.connection_id, now);
        this.record_device_log(row.device_id, "connection", "connection.stale", "连接已不存在，设备状态已修正为离线", {
          connection_id: row.connection_id,
          direction: "internal",
          level: "warn",
          created_at: now
        });
      }
      return {
        device_id: row.device_id,
        device_name: row.device_name || row.device_id,
        device_os: row.device_os || "unknown",
        methods: DeviceModel.parse_methods(row.methods_json),
        connected_at: row.connected_at,
        last_seen_at: online ? Math.max(row.last_seen_at, active_connection.last_seen_at || 0) : row.last_seen_at,
        disconnected_at: online ? null : row.disconnected_at ?? now,
        active_tasks,
        max_concurrency,
        status: disabled ? "disabled" : online ? active_tasks > 0 ? "busy" : "online" : "offline",
        disabled
      };
    });
    const methods = [...new Set(devices.filter(device => device.status === "online" || device.status === "busy").flatMap(device => device.methods))].sort();
    // route_cache 的命中分布：进程内计数（DO 被驱逐后从零开始），用来判断
    // 「高并发下到底有多少请求真的落到了脚本/设备」——压测时看的那个数。
    return {
      devices,
      methods,
      task_counts,
      route_cache: await this.ports.route_cache.stats()
    };
  }

  /**
   * 设备日志写入的唯一入口（归一 + 落库 + console 输出，见 logs.js）。
   * @param {string} device_id
   * @param {string} category
   * @param {string} event_type
   * @param {string} message
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<void>}
   */
  record_device_log(device_id, category, event_type, message, options = {}) {
    const pending = record_device_log(this.repo, device_id, category, event_type, message, options);
    this.ports.wait_until?.(pending);
    return pending;
  }
  async close_unauthorized_connections() {
    if (!this.app.device_tokens) return;
    for (const socket of await this.ports.sockets.get_all()) {
      const attachment = socket_attachment(socket);
      if (!attachment || (await this.app.device_tokens.is_active(attachment.device_token_id))) continue;
      await this.mark_device_offline(socket, "connection.token_invalid", "设备 Token 已失效，连接已关闭", {});
      await this.ports.sockets.close(socket, 1008, "device token expired or revoked; reconnect required");
    }
  }

  /**
   * @param {URL} url
   * @param {string} device_id
   * @returns {Promise<Record<string, unknown>>}
   */
  async list_device_logs(url, device_id) {
    /** @type {DeviceRegistryRow | undefined} */
    const device = await this.repo.devices.find(device_id);
    if (device === undefined) {
      throw do_error("device not found", 404);
    }
    const limit = DeviceLogModel.clamp_limit(url.searchParams.get("limit"));
    const before_value = url.searchParams.get("before_id");
    const before_id = before_value === null || before_value === "" ? null : Number(before_value);
    if (before_id !== null && (!Number.isSafeInteger(before_id) || before_id <= 0)) {
      throw do_error("invalid before_id", 400);
    }
    const category = (url.searchParams.get("category") ?? "").trim();
    if (category !== "" && !DEVICE_LOG_CATEGORIES.has(category)) {
      throw do_error("invalid category", 400);
    }

    /** @type {DeviceLogRow[]} */
    let rows;
    try {
      rows = await this.repo.devices.list_logs(device_id, category, before_id, limit + 1);
    } catch (error) {
      throw do_error(error.message, 503);
    }
    const has_more = rows.length > limit;
    const page = has_more ? rows.slice(0, limit) : rows;
    return {
      device: {
        device_id: device.device_id,
        device_name: device.device_name || device.device_id,
        device_os: device.device_os || "unknown"
      },
      logs: page.map(row => DeviceLogModel.fromRow(row).toValue()),
      has_more,
      next_before_id: has_more && page.length > 0 ? page[page.length - 1].id : null,
      retention_milliseconds: this.repo.devices.retention_milliseconds ?? RETENTION_MILLISECONDS
    };
  }

  /** @param {string} device_id @returns {void} */
  async close_device_sockets(device_id) {
    for (const socket of await this.ports.sockets.get_for_device(device_id)) {
      await this.ports.sockets.close(socket, 1000, "closed by admin");
    }
  }

  /**
   * @param {string} device_id
   * @returns {Promise<Record<string, unknown>>}
   */
  async reset_device(device_id) {
    const device = await this.repo.devices.find(device_id);
    if (device === undefined) {
      throw do_error("device not found", 404);
    }
    const {
      tasks
    } = await this.app.tasks.fail_device_tasks(device_id, "response.admin_reset", "管理员强制终止了设备上的调用", "task force reset by admin");
    this.record_device_log(device_id, "system", "system.admin_reset", "管理员执行了设备强制重置", {
      direction: "internal",
      level: tasks.length > 0 ? "warn" : "info",
      metadata: {
        reset_count: tasks.length
      },
      created_at: Date.now()
    });
    await this.ports.schedule_alarm();
    return {
      device_id,
      reset_count: tasks.length,
      tasks
    };
  }

  /**
   * @param {string} device_id
   * @param {boolean} disabled
   * @returns {Promise<Record<string, unknown>>}
   */
  async set_device_disabled(device_id, disabled) {
    const device = await this.repo.devices.find(device_id);
    if (device === undefined) {
      throw do_error("device not found", 404);
    }
    const next_disabled = disabled ? 1 : 0;
    if (Number(device.disabled) === next_disabled) {
      return {
        device_id,
        disabled: next_disabled === 1,
        failed_count: 0
      };
    }
    let failed_count = 0;
    if (next_disabled === 1) {
      const {
        count
      } = await this.app.tasks.fail_device_tasks(device_id, "response.admin_disabled", "管理员禁用设备，调用已强制终止", "task force reset by admin");
      failed_count = count;
      await this.close_device_sockets(device_id);
    }
    await this.repo.devices.set_disabled(device_id, next_disabled === 1);
    this.record_device_log(device_id, "system", next_disabled === 1 ? "system.admin_disabled" : "system.admin_enabled", next_disabled === 1 ? "管理员禁用了设备" : "管理员解除了设备禁用", {
      direction: "internal",
      level: next_disabled === 1 ? "warn" : "info",
      metadata: {
        failed_count
      },
      created_at: Date.now()
    });
    await this.ports.schedule_alarm();
    return {
      device_id,
      disabled: next_disabled === 1,
      failed_count
    };
  }

  /**
   * @param {string} device_id
   * @returns {Promise<Record<string, unknown>>}
   */
  async delete_device(device_id) {
    const device = await this.repo.devices.find(device_id);
    if (device === undefined) {
      throw do_error("device not found", 404);
    }
    await this.repo.devices.delete_logs_for(device_id);
    const {
      count
    } = await this.app.tasks.fail_device_tasks(device_id, "response.admin_deleted", "管理员删除设备，调用已强制终止", "task force reset by admin");
    await this.close_device_sockets(device_id);
    await this.repo.devices.delete(device_id);
    await this.ports.schedule_alarm();
    return {
      device_id,
      deleted: true,
      failed_count: count
    };
  }
}
