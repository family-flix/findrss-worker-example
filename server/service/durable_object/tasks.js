// 调用任务的生命周期：创建/排队/下发/租约心跳/完成/失败，以及 /invoke 的同步等待。
//
// 只回数据或抛 DurableObjectError，绝不造 Response（router 是唯一翻译点）。
// `invoke_waiters` 是本服务独占的实例字段：只有 invoke/wait_for_invoke/resolve_invoke_waiter/
// complete_task/fail_task/fail_device_tasks（以及 alarm 的 sweep 回调）碰它。
import { ActivityEventModel } from "../../domain/activity_log.js";
import { AccessTokenModel } from "../../domain/access_token.js";
import { CallModel } from "../../domain/call.js";
import { CreditModel } from "../../domain/credits.js";
import { DeviceModel, DevicePoolModel } from "../../domain/device_capacity.js";
import { socket_attachment } from "../../infra/device_socket.js";
import { COALESCE_KEY_HEADER, CREDIT_SUBJECT_HEADER, INVOKE_TIMEOUT_MILLISECONDS, MAX_BODY_BYTES, MAX_COALESCE_KEY_LENGTH } from "../../lib/constants.js";
import { valid_identifier } from "../../lib/identifiers.js";
import { do_error, do_result } from "./error.js";

export class ServiceTask {
  /**
   * @param {{ repo: Record<string, any>, ports: Record<string, any>, storage: DurableObjectStorage, app: Record<string, any> }} deps
   */
  constructor({ repo, ports, storage, app }) {
    this.repo = repo;
    this.ports = ports;
    this.storage = storage;
    /** 兄弟服务注册表（devices 的 record_device_log）。 */
    this.app = app;
    /**
     * 一条任务可以有**多个**等待者：合并（`COALESCE_KEY_HEADER`）让后来的请求挂到同一条
     * 在飞任务上，超时重试也会再挂一次。所以是 task_id → Set，不是 task_id → 单个桩。
     * 单桩会互相覆盖——先到的那个永远等不到结果（它的 setTimeout 到点才醒，被当成超时）。
     * @type {Map<string, Set<{ resolve: (row: unknown) => void, timeout_id: ReturnType<typeof setTimeout> }>>}
     */
    this.waiters = new Map();
  }

  /**
   * @param {Request} request
   * @param {number} [timeout_milliseconds]
   * @returns {Promise<unknown>}
   */
  async invoke(request, timeout_milliseconds = INVOKE_TIMEOUT_MILLISECONDS, resume = false) {
    const deadline = Date.now() + timeout_milliseconds;
    // create_task 的成功体是 do_result 信封（201 创建 / 200 幂等重放）；失败一律抛
    // DurableObjectError（402 余额不足等），由 router 翻译，这里原样向上冒泡。
    const created = /** @type {{ task?: { id?: string }, credits?: { charged?: number, balance?: number } }} */ (
      (await this.create_task(request, resume, !resume)).data
    );
    const task_id = String(created.task?.id ?? "");
    if (!/^[A-Za-z0-9-]{1,128}$/.test(task_id)) {
      throw do_error("failed to create invoke task", 500);
    }
    const credit_balance = Number.isInteger(created.credits?.balance)
      ? Number(created.credits.balance)
      : null;
    const invoke_headers = credit_balance === null
      ? {}
      : {
          ...CreditModel.headers(credit_balance),
          "X-Api-Credits-Charged": String(created.credits?.charged ?? 0),
        };

    const remaining_milliseconds = Math.max(0, deadline - Date.now());
    const row = await this.wait_for_invoke(task_id, remaining_milliseconds);
    if (row === null) {
      throw do_error(
        "invoke timed out after " + Math.round(timeout_milliseconds / 1000) + " seconds",
        504,
        {},
        { ...invoke_headers, "X-FindRSS-Task-ID": task_id,
          "X-FindRSS-Task-State": this.repo.calls.find(task_id)?.status ?? "queued",
          "Retry-After": "5" });
    }
    if (row.status === "failed") {
      throw do_error(row.error_message ?? "invoke failed", 502, {}, invoke_headers);
    }
    if (row.status !== "completed") {
      throw do_error("invoke ended without a result", 500, {}, invoke_headers);
    }
    try {
      return do_result(
        row.result_json === null ? null : JSON.parse(row.result_json),
        200,
        invoke_headers);
    } catch {
      throw do_error("invoke returned invalid JSON", 502, {}, invoke_headers);
    }
  }

  /**
   * @param {string} task_id
   * @param {number} timeout_milliseconds
   * @returns {Promise<any>}
   */
  wait_for_invoke(task_id, timeout_milliseconds) {
    const existing = this.find_task(task_id);
    if (existing === null || existing.status === "completed" || existing.status === "failed") {
      return Promise.resolve(existing);
    }
    if (timeout_milliseconds <= 0) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      /** @type {Set<{ resolve: (row: unknown) => void, timeout_id: ReturnType<typeof setTimeout> }>} */
      let group = this.waiters.get(task_id);
      if (group === undefined) {
        group = new Set();
        this.waiters.set(task_id, group);
      }
      // 先建桩、后赋定时器：回调要引用桩自己。到点只摘自己那一格——同一条任务上可能还有
      // 别的等待者（合并/重试），不能一起清，否则后来者会被前一个的超时误伤。
      const waiter = { resolve, timeout_id: 0 };
      waiter.timeout_id = setTimeout(() => {
        group.delete(waiter);
        if (group.size === 0) this.waiters.delete(task_id);
        resolve(null);
      }, timeout_milliseconds);
      group.add(waiter);

      const current = this.find_task(task_id);
      if (current === null || current.status === "completed" || current.status === "failed") {
        this.resolve_invoke_waiter(task_id, current);
      }
    });
  }

  /**
   * 任务落定：一次性唤醒该任务上的**所有**等待者。
   * @param {string} task_id
   * @param {any} row
   * @returns {void}
   */
  resolve_invoke_waiter(task_id, row) {
    const group = this.waiters.get(task_id);
    if (group === undefined) {
      return;
    }
    this.waiters.delete(task_id);
    for (const waiter of group) {
      clearTimeout(waiter.timeout_id);
      waiter.resolve(row);
    }
  }

  /**
   * @param {string} task_id
   * @returns {any}
   */
  find_task(task_id) {
    return this.repo.calls.find(task_id) ?? null;
  }

  /**
   * @param {Request} request
   * @param {boolean} [allow_idempotency_key]
   * @param {boolean} [require_online_device] 同步调用在创建前要求在线方法提供者。
   * @returns {Promise<import("./error.js").DurableObjectResult>}
   */
  async create_task(request, allow_idempotency_key = true, require_online_device = false) {
    const publisher_device_id = (
      request.headers.get("X-Api-Authenticated-Publisher-ID") ??
      request.headers.get("X-Api-Publisher-ID") ??
      request.headers.get("X-Api-Device-ID") ??
      ""
    ).trim();
    if (!valid_identifier(publisher_device_id)) {
      throw do_error("invalid X-Api-Device-ID", 400);
    }
    const access_token_id = (request.headers.get("X-Api-Access-Token-ID") ?? "").trim();
    if (
      access_token_id !== "" &&
      (!valid_identifier(access_token_id) || publisher_device_id !== "caller:" + access_token_id)
    ) {
      throw do_error("unauthorized", 401);
    }
    const content_length = Number(request.headers.get("Content-Length") ?? "0");
    if (content_length > MAX_BODY_BYTES) {
      throw do_error("request body is too large", 413);
    }

    /** @type {CreateTaskBody} */
    let body;
    try {
      body = await request.json();
    } catch {
      throw do_error("invalid JSON", 400);
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw do_error("invalid JSON body", 400);
    }
    const requested_method = body.method ?? body.kind ?? "";
    const method = typeof requested_method === "string" ? requested_method.trim() : "";
    if (!valid_identifier(method)) {
      throw do_error("invalid method", 400);
    }
    const requested_target_device_id = body.target_device_id ?? body.target_client_id ?? "";
    if (typeof requested_target_device_id !== "string") {
      throw do_error("invalid target_device_id", 400);
    }
    const target_device_id =
      requested_target_device_id.trim();
    if (target_device_id !== "" && !valid_identifier(target_device_id)) {
      throw do_error("invalid target_device_id", 400);
    }
    if (
      allow_idempotency_key &&
      body.idempotency_key !== undefined &&
      typeof body.idempotency_key !== "string"
    ) {
      throw do_error("invalid idempotency_key", 400);
    }
    const idempotency_key = allow_idempotency_key
      ? (body.idempotency_key ?? "").trim()
      : "";
    if (idempotency_key.length > 128) {
      throw do_error("idempotency_key is too long", 400);
    }
    const args = body.args ?? body.payload ?? {};
    if (args === null || typeof args !== "object" || Array.isArray(args)) {
      throw do_error("args must be an object", 400);
    }
    const args_json = JSON.stringify(args);
    if (args_json.length > MAX_BODY_BYTES) {
      throw do_error("args is too large", 413);
    }
    // 扣费归因标签的最后一跳：外部直连 /invoke 也可能带这个头，但只能影响自己那一行账本。
    const credit_subject = ActivityEventModel.subject(request.headers.get(CREDIT_SUBJECT_HEADER) ?? "");
    // 合并键：可选的「同一次请求级操作」标识（RSS 路径传路由缓存键）。超长直接放弃合并
    // ——截断会把两个不同的键并成一个，比不合并糟得多。
    const requested_coalesce_key = (request.headers.get(COALESCE_KEY_HEADER) ?? "").trim();
    const coalesce_key =
      requested_coalesce_key !== "" && requested_coalesce_key.length <= MAX_COALESCE_KEY_LENGTH
        ? requested_coalesce_key
        : "";

    if (target_device_id !== "") {
      /** @type {DeviceRegistryRow | undefined} */
      const target_device = this.repo.devices.find(target_device_id);
      if (target_device === undefined) {
        throw do_error("target device is not registered", 404);
      }
      if (DeviceModel.is_disabled(target_device)) {
        this.app.devices.record_device_log(
          target_device_id,
          "call",
          "call.rejected",
          "目标设备已被管理员禁用，调用已拒绝",
          {
            direction: "internal",
            level: "warn",
            method,
            metadata: { publisher_device_id, args, reason: "device disabled" },
          });
        throw do_error("target device is disabled", 409);
      }
      if (!DeviceModel.supports(target_device.methods_json, method)) {
        this.app.devices.record_device_log(
          target_device_id,
          "call",
          "call.rejected",
          "设备不支持请求的方法，调用已拒绝",
          {
            direction: "internal",
            level: "warn",
            method,
            metadata: { publisher_device_id, args, reason: "unsupported method" },
          });
        throw do_error("target device does not provide method " + method, 409);
      }
    }

    const now = Date.now();
    const task_id = crypto.randomUUID();
    const credit_cost = CreditModel.free_for(access_token_id) ? 0 : CreditModel.cost_for(method);
    const creation = this.storage.transactionSync(() => {
      const access_token = access_token_id === ""
        ? undefined
        : this.repo.access_tokens.find(access_token_id);
      if (
        access_token_id !== "" &&
        (access_token === undefined || !AccessTokenModel.fromRow(access_token).is_active_at(now))
      ) {
        return { error: "unauthorized" };
      }
      if (idempotency_key !== "") {
        /** @type {CallRow | undefined} */
        const existing = this.repo.calls.find_by_idempotency(publisher_device_id, idempotency_key);
        if (existing !== undefined) {
          return {
            row: existing,
            replay: true,
            balance: access_token === undefined ? null : Number(access_token.credit_balance),
          };
        }
      }
      // 合并：同一次请求级操作已经有一条在飞的同参调用时，挂到它上面等结果。
      // 必须排在 count_queued/余额检查**之前**——原调用方已经付过费、也已经占过一个队位，
      // 后来的请求只是搭车，不该再被这两个闸门拦一次。
      if (coalesce_key !== "") {
        /** @type {CallRow | undefined} */
        const inflight = this.repo.calls.find_inflight_by_coalesce(
          coalesce_key,
          publisher_device_id,
          method,
          args_json);
        if (inflight !== undefined) {
          return {
            row: inflight,
            replay: true,
            coalesced: true,
            balance: access_token === undefined ? null : Number(access_token.credit_balance),
          };
        }
      }
      // 同步调用不能靠离线队列等待设备上线；忙碌的在线设备仍可排队。
      // 放在重放/合并之后、扣费之前，保留已有任务与异步提交的语义。
      if (require_online_device) {
        const sockets = target_device_id
          ? this.ports.sockets.get_for_device(target_device_id)
          : this.ports.sockets.get_for_method(method);
        const online = sockets.some((socket) => {
          const attachment = socket_attachment(socket);
          return attachment !== null && attachment.methods.includes(method) &&
            (!this.app.device_tokens || this.app.device_tokens.is_active(attachment.device_token_id)) &&
            !DeviceModel.is_disabled(this.repo.devices.find(attachment.device_id));
        });
        if (!online) return { error: "unavailable" };
      }
      if (this.repo.calls.count_queued() >= CallModel.MAX_QUEUED) {
        return { error: "overloaded" };
      }
      const current_balance = access_token === undefined
        ? null
        : Number(access_token.credit_balance);
      if (!CreditModel.can_spend(current_balance, credit_cost)) {
        return { error: "insufficient_credits", balance: current_balance };
      }
      const balance_after = current_balance === null ? null : current_balance - credit_cost;
      if (access_token !== undefined) {
        this.repo.access_tokens.set_balance_used(
          access_token_id,
          balance_after,
          credit_cost);
      }
      this.repo.calls.insert({
        id: task_id,
        method,
        publisher_device_id,
        access_token_id: access_token_id || null,
        credit_cost,
        target_device_id: target_device_id || null,
        idempotency_key: idempotency_key || null,
        coalesce_key: coalesce_key || null,
        args_json,
        created_at: now,
        updated_at: now,
      });
      if (access_token !== undefined) {
        this.repo.credit.insert({
          id: crypto.randomUUID(),
          access_token_id,
          task_id,
          type: "charge",
          amount: -credit_cost,
          balance_after,
          method,
          subject: credit_subject,
          note: "API call",
          created_at: now,
        });
      }
      return {
        row: /** @type {CallRow} */ (this.find_task(task_id)),
        replay: false,
        balance: balance_after,
      };
    });
    if (creation.error === "unauthorized") {
      throw do_error("unauthorized", 401);
    }
    if (creation.error === "unavailable") {
      throw do_error("服务不可用：没有在线设备支持方法 " + method, 503);
    }
    if (creation.error === "overloaded") {
      throw do_error("device task queue is full", 429, {}, { "Retry-After": "1" });
    }
    if (creation.error === "insufficient_credits") {
      if (target_device_id !== "") {
        this.app.devices.record_device_log(
          target_device_id,
          "call",
          "call.rejected",
          "调用方积分不足，调用未创建",
          {
            direction: "internal",
            level: "warn",
            method,
            metadata: {
              publisher_device_id,
              required_credits: credit_cost,
              balance: creation.balance,
            },
          });
      }
      throw do_error(
        "insufficient credits",
        402,
        { required: credit_cost, balance: creation.balance },
        CreditModel.headers(creation.balance));
    }
    if (creation.replay) {
      const replay_device_id = creation.row.assigned_device_id ?? target_device_id;
      // 合并命中不写设备日志：一次冷缓存压测里合并命中会有成百上千次，而每一次都不是
      // 设备相关的事件（没有下发、没有结果），逐条记录只会把 device_logs 冲垮。
      if (creation.coalesced !== true && replay_device_id !== "") {
        this.app.devices.record_device_log(
          replay_device_id,
          "call",
          "call.idempotent_replay",
          "返回已有调用，未重复创建任务",
          {
            direction: "internal",
            task_id: creation.row.id,
            method: creation.row.method,
            metadata: {
              publisher_device_id,
              idempotency_key,
              status: creation.row.status,
            },
          });
      }
      const replay_publisher_is_device = this.repo.devices.is_registered(publisher_device_id);
      if (creation.coalesced !== true && replay_publisher_is_device && replay_device_id !== publisher_device_id) {
        this.app.devices.record_device_log(
          publisher_device_id,
          "call",
          "call.idempotent_replay",
          "设备发布的调用命中已有任务",
          {
            direction: "outbound",
            task_id: creation.row.id,
            method: creation.row.method,
            metadata: {
              target_device_id: creation.row.target_device_id,
              idempotency_key,
              status: creation.row.status,
            },
          });
      }
      return do_result(
        {
          task: CallModel.fromRow(creation.row).toValue(),
          idempotent_replay: true,
          coalesced: creation.coalesced === true,
          credits: { charged: 0, balance: creation.balance },
        },
        200,
        CreditModel.headers(creation.balance));
    }
    const publisher_is_device = this.repo.devices.is_registered(publisher_device_id);
    if (publisher_is_device) {
      this.app.devices.record_device_log(
        publisher_device_id,
        "call",
        "call.published",
        "设备已发布调用",
        {
          direction: "outbound",
          task_id,
          method,
          metadata: {
            target_device_id: target_device_id || null,
            idempotency_key: idempotency_key || null,
            args,
          },
        });
    }
    if (target_device_id !== "") {
      this.app.devices.record_device_log(
        target_device_id,
        "call",
        "call.queued",
        "收到定向调用并进入等待队列",
        {
          direction: "inbound",
          task_id: task_id,
          method,
          metadata: {
            publisher_device_id,
            idempotency_key: idempotency_key || null,
            args,
          },
        });
    }
    await this.dispatch_pending();
    await this.ports.schedule_alarm();
    return do_result(
      {
        task: CallModel.fromRow(creation.row).toValue(),
        credits: { charged: credit_cost, balance: creation.balance },
      },
      201,
      CreditModel.headers(creation.balance));
  }

  /**
   * @param {Request} request
   * @param {URL} url
   * @returns {Record<string, unknown>}
   */
  list_tasks(request, url) {
    const publisher_device_id = (
      request.headers.get("X-Api-Authenticated-Publisher-ID") ??
      url.searchParams.get("publisher_device_id") ??
      url.searchParams.get("publisher_id") ??
      ""
    ).trim();
    const status = (url.searchParams.get("status") ?? "").trim();
    const limit_value = Number(url.searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(limit_value) ? Math.max(1, Math.min(200, limit_value)) : 50;

    /** @type {CallRow[]} */
    const rows = this.repo.calls.list(publisher_device_id, status, limit);
    return { tasks: rows.map((row) => CallModel.fromRow(row).toValue()) }
  }

  /**
   * @param {Request} request
   * @param {string} task_id
   * @returns {Record<string, unknown>}
   */
  get_task(request, task_id) {
    const row = this.find_task(task_id);
    const publisher_device_id = (
      request.headers.get("X-Api-Authenticated-Publisher-ID") ?? ""
    ).trim();
    if (
      row === null ||
      (publisher_device_id !== "" && row.publisher_device_id !== publisher_device_id)
    ) {
      throw do_error("task not found", 404);
    }
    return { task: CallModel.fromRow(row).toValue() }
  }

  /**
   * 把指定设备上未完成的调用标记为失败，并通知发布方。
   * @param {string} device_id
   * @param {string} event_type
   * @param {string} message
   * @param {string} error_message
   * @returns {{ tasks: Record<string, unknown>[], count: number }}
   */
  fail_device_tasks(device_id, event_type, message, error_message) {
    /** @type {CallRow[]} */
    const rows = this.repo.calls.list_active_for_device(device_id);
    const now = Date.now();
    this.repo.calls.fail_for_device(device_id, error_message, now);

    /** @type {Record<string, unknown>[]} */
    const tasks = [];
    for (const row of rows) {
      const failed = this.find_task(row.id);
      if (failed === null) continue;
      tasks.push(CallModel.fromRow(failed).toValue());
      this.app.devices.record_device_log(
        device_id,
        "response",
        event_type,
        message,
        {
          direction: "internal",
          level: "error",
          task_id: failed.id,
          method: failed.method,
          metadata: { error: failed.error_message },
          created_at: now,
        });
      this.resolve_invoke_waiter(failed.id, failed);
      this.send_to_device(failed.publisher_device_id, {
        type: "task.failed",
        task: CallModel.fromRow(failed).toValue(),
      });
    }
    return { tasks, count: tasks.length };
  }

  /**
   * @param {WebSocket} socket
   * @param {import("../../infra/device_socket.js").SocketAttachment} attachment
   * @param {ClientMessage} message
   * @returns {Promise<void>}
   */
  async accept_task(socket, attachment, message) {
    const row = this.owned_task(attachment.device_id, message);
    if (row === null) {
      socket.send(JSON.stringify({ type: "task.rejected", task_id: message.task_id }));
      this.app.devices.record_device_log(
        attachment.device_id,
        "call",
        "call.accept_rejected",
        "设备确认的调用不属于当前连接，已拒绝",
        {
          connection_id: attachment.connection_id,
          direction: "inbound",
          level: "warn",
          task_id: message.task_id,
          metadata: { request_type: message.type },
        });
      return;
    }
    const now = Date.now();
    this.repo.calls.set_running(row.id, CallModel.lease_deadline(now), now);
    socket.send(JSON.stringify({ type: "task.accepted", task_id: row.id }));
    this.app.devices.record_device_log(
      attachment.device_id,
      "call",
      "call.accepted",
      "设备已接收调用并开始执行",
      {
        connection_id: attachment.connection_id,
        direction: "inbound",
        task_id: row.id,
        method: row.method,
        metadata: {
          attempt_count: row.attempt_count,
          lease_expires_at: CallModel.lease_deadline(now),
        },
        created_at: now,
      });
    await this.ports.schedule_alarm();
  }

  /**
   * @param {WebSocket} socket
   * @param {import("../../infra/device_socket.js").SocketAttachment} attachment
   * @param {ClientMessage} message
   * @returns {Promise<void>}
   */
  async heartbeat_task(socket, attachment, message) {
    const row = this.owned_task(attachment.device_id, message);
    if (row === null) {
      socket.send(JSON.stringify({ type: "task.rejected", task_id: message.task_id }));
      this.app.devices.record_device_log(
        attachment.device_id,
        "heartbeat",
        "heartbeat.task_rejected",
        "调用心跳与当前租约不匹配，已拒绝",
        {
          connection_id: attachment.connection_id,
          direction: "inbound",
          level: "warn",
          task_id: message.task_id,
        });
      return;
    }
    const now = Date.now();
    this.repo.calls.set_heartbeat(row.id, CallModel.lease_deadline(now), now);
    socket.send(JSON.stringify({ type: "task.heartbeat.ack", task_id: row.id }));
    this.app.devices.record_device_log(
      attachment.device_id,
      "heartbeat",
      "heartbeat.task",
      "收到调用心跳并续期租约",
      {
        connection_id: attachment.connection_id,
        direction: "inbound",
        task_id: row.id,
        method: row.method,
        metadata: { lease_expires_at: CallModel.lease_deadline(now) },
        created_at: now,
      });
    await this.ports.schedule_alarm();
  }

  /**
   * @param {WebSocket} socket
   * @param {import("../../infra/device_socket.js").SocketAttachment} attachment
   * @param {ClientMessage} message
   * @returns {Promise<void>}
   */
  async complete_task(socket, attachment, message) {
    const existing = message.task_id ? this.find_task(message.task_id) : null;
    if (
      existing !== null &&
      existing.status === "completed" &&
      existing.assigned_device_id === attachment.device_id &&
      existing.lease_token === message.lease_token
    ) {
      socket.send(JSON.stringify({ type: "task.ack", task_id: existing.id }));
      this.app.devices.record_device_log(
        attachment.device_id,
        "response",
        "response.duplicate",
        "收到重复的成功响应并再次确认",
        {
          connection_id: attachment.connection_id,
          direction: "inbound",
          level: "warn",
          task_id: existing.id,
          method: existing.method,
        });
      return;
    }
    const row = this.owned_task(attachment.device_id, message);
    if (row === null) {
      socket.send(JSON.stringify({ type: "task.rejected", task_id: message.task_id }));
      this.app.devices.record_device_log(
        attachment.device_id,
        "response",
        "response.rejected",
        "调用响应与当前租约不匹配，已拒绝",
        {
          connection_id: attachment.connection_id,
          direction: "inbound",
          level: "warn",
          task_id: message.task_id,
        });
      return;
    }
    const result_json = JSON.stringify(message.result ?? null);
    if (result_json.length > MAX_BODY_BYTES) {
      socket.send(JSON.stringify({ type: "task.rejected", task_id: row.id, error: "result is too large" }));
      this.app.devices.record_device_log(
        attachment.device_id,
        "response",
        "response.rejected",
        "设备响应过大，已拒绝",
        {
          connection_id: attachment.connection_id,
          direction: "inbound",
          level: "error",
          task_id: row.id,
          method: row.method,
          metadata: { result_length: result_json.length, reason: "result is too large" },
        });
      return;
    }
    const now = Date.now();
    this.repo.calls.set_completed(row.id, result_json, now);
    const completed = /** @type {CallRow} */ (this.find_task(row.id));
    this.resolve_invoke_waiter(completed.id, completed);
    socket.send(JSON.stringify({ type: "task.ack", task_id: row.id }));
    this.app.devices.record_device_log(
      attachment.device_id,
      "response",
      "response.completed",
      "设备已返回成功响应",
      {
        connection_id: attachment.connection_id,
        direction: "inbound",
        task_id: completed.id,
        method: completed.method,
        metadata: {
          result: message.result ?? null,
          attempt_count: completed.attempt_count,
          elapsed_milliseconds: now - completed.created_at,
        },
        created_at: now,
      });
    this.send_to_device(completed.publisher_device_id, {
      type: "task.completed",
      task: CallModel.fromRow(completed).toValue(),
    });
    await this.dispatch_pending();
    await this.ports.schedule_alarm();
  }

  /**
   * @param {WebSocket} socket
   * @param {import("../../infra/device_socket.js").SocketAttachment} attachment
   * @param {ClientMessage} message
   * @returns {Promise<void>}
   */
  async fail_task(socket, attachment, message) {
    const row = this.owned_task(attachment.device_id, message);
    if (row === null) {
      socket.send(JSON.stringify({ type: "task.rejected", task_id: message.task_id }));
      this.app.devices.record_device_log(
        attachment.device_id,
        "response",
        "response.rejected",
        "调用失败响应与当前租约不匹配，已拒绝",
        {
          connection_id: attachment.connection_id,
          direction: "inbound",
          level: "warn",
          task_id: message.task_id,
        });
      return;
    }
    const now = Date.now();
    const retryable = CallModel.is_retryable(message, row);
    if (retryable) {
      this.repo.calls.set_requeued(row.id, CallModel.truncate_error(message.error), now);
      socket.send(JSON.stringify({ type: "task.ack", task_id: row.id, requeued: true }));
      this.app.devices.record_device_log(
        attachment.device_id,
        "response",
        "response.failed_retryable",
        "设备返回可重试失败，调用已重新排队",
        {
          connection_id: attachment.connection_id,
          direction: "inbound",
          level: "warn",
          task_id: row.id,
          method: row.method,
          metadata: {
            error: message.error ?? "task failed",
            retryable: true,
            attempt_count: row.attempt_count,
          },
          created_at: now,
        });
    } else {
      this.repo.calls.set_failed(row.id, CallModel.truncate_error(message.error), now);
      const failed = /** @type {CallRow} */ (this.find_task(row.id));
      this.resolve_invoke_waiter(failed.id, failed);
      socket.send(JSON.stringify({ type: "task.ack", task_id: row.id }));
      this.app.devices.record_device_log(
        attachment.device_id,
        "response",
        "response.failed",
        "设备返回失败响应，调用已终止",
        {
          connection_id: attachment.connection_id,
          direction: "inbound",
          level: "error",
          task_id: failed.id,
          method: failed.method,
          metadata: {
            error: failed.error_message,
            retryable: message.retryable === true,
            attempt_count: failed.attempt_count,
          },
          created_at: now,
        });
      this.send_to_device(failed.publisher_device_id, {
        type: "task.failed",
        task: CallModel.fromRow(failed).toValue(),
      });
    }
    await this.dispatch_pending();
    await this.ports.schedule_alarm();
  }

  /**
   * @param {string} device_id
   * @param {ClientMessage} message
   * @returns {any}
   */
  owned_task(device_id, message) {
    if (!message.task_id || !message.lease_token) {
      return null;
    }
    const row = this.find_task(message.task_id);
    if (
      row === null ||
      (row.status !== "assigned" && row.status !== "running") ||
      row.assigned_device_id !== device_id ||
      row.lease_token !== message.lease_token
    ) {
      return null;
    }
    return row;
  }

  /** @returns {Promise<void>} */
  async dispatch_pending() {
    this.app.devices?.close_unauthorized_connections?.();
    const connected_devices = this.ports.sockets
      .get_all()
      .map(socket_attachment)
      .filter((attachment) => attachment !== null && (!this.app.device_tokens || this.app.device_tokens.is_active(attachment.device_token_id)));
    if (connected_devices.length === 0) return;
    // 逐设备点查在飞数，而不是全表 GROUP BY：dispatch_pending 在每个
    // create/complete/heartbeat/fail 上都会跑，而那条聚合要扫整张 calls 表。
    // 只需要**在线**设备的数（离线设备的行根本不在候选里），各走一次
    // calls_device_load 索引。
    /** @type {Map<string, number>} */
    const active_counts = new Map();
    for (const attachment of connected_devices) {
      if (active_counts.has(attachment.device_id)) continue;
      active_counts.set(
        attachment.device_id,
        this.repo.devices.count_active_for_device(attachment.device_id));
    }
    let available_slots = DevicePoolModel.available_slots(connected_devices, active_counts);
    if (available_slots === 0) return;

    // 条数上限从固定的 1000 降到「空闲槽位数」（单设备并发 1 时就是 1 条）。
    /** @type {CallRow[]} */
    const queued = this.repo.calls.list_dispatchable(
      [...new Set(connected_devices.map((attachment) => attachment.device_id))],
      [...new Set(connected_devices.flatMap((attachment) => attachment.methods))],
      available_slots);

    for (const row of queued) {
      if (available_slots === 0) break;
      const sockets = row.target_device_id
        ? this.ports.sockets.get_for_device(row.target_device_id)
        : this.ports.sockets.get_for_method(row.method);
      const candidates = sockets.flatMap((socket) => {
        const attachment = socket_attachment(socket);
        return attachment === null || !attachment.methods.includes(row.method) ||
          (this.app.device_tokens && !this.app.device_tokens.is_active(attachment.device_token_id))
          ? []
          : [{ socket, attachment, device_id: attachment.device_id, max_concurrency: attachment.max_concurrency }];
      });
      const candidate = DevicePoolModel(candidates, active_counts).pick();
      if (candidate === null) {
        continue;
      }
      const { socket, attachment } = candidate;

      const now = Date.now();
      const lease_token = crypto.randomUUID();
      this.repo.calls.assign(
        row.id,
        attachment.device_id,
        lease_token,
        CallModel.lease_deadline(now),
        now);
      const assigned = /** @type {CallRow} */ (this.find_task(row.id));
      try {
        socket.send(
          JSON.stringify({
            type: "task.assigned",
            task: CallModel.fromRow(assigned).toValue(),
            lease_token,
            lease_milliseconds: CallModel.LEASE_MS,
          }));
        this.app.devices.record_device_log(
          attachment.device_id,
          "call",
          "call.assigned",
          "调用已下发到设备",
          {
            connection_id: attachment.connection_id,
            direction: "outbound",
            task_id: assigned.id,
            method: assigned.method,
            metadata: {
              publisher_device_id: assigned.publisher_device_id,
              target_device_id: assigned.target_device_id,
              args: JSON.parse(assigned.args_json),
              attempt_count: assigned.attempt_count,
              lease_expires_at: assigned.lease_expires_at,
            },
            created_at: now,
          });
        active_counts.set(
          attachment.device_id,
          (active_counts.get(attachment.device_id) ?? 0) + 1);
        available_slots -= 1;
      } catch (error) {
        this.repo.calls.release(row.id, Date.now());
        this.app.devices.record_device_log(
          attachment.device_id,
          "call",
          "call.delivery_failed",
          "调用下发失败，任务已重新排队",
          {
            connection_id: attachment.connection_id,
            direction: "outbound",
            level: "error",
            task_id: row.id,
            method: row.method,
            metadata: {
              error: error instanceof Error ? error.message : String(error),
            },
          });
        const active_count = active_counts.get(attachment.device_id) ?? 0;
        available_slots -= Math.max(0, candidate.max_concurrency - active_count);
        active_counts.set(attachment.device_id, candidate.max_concurrency);
      }
    }
  }

  /**
   * @param {string} device_id
   * @param {unknown} value
   * @returns {void}
   */
  send_to_device(device_id, value) {
    for (const socket of this.ports.sockets.get_for_device(device_id)) {
      const attachment = socket_attachment(socket);
      if (this.app.device_tokens && !this.app.device_tokens.is_active(attachment?.device_token_id)) continue;
      try {
        this.ports.sockets.send(socket, value);
        this.app.devices.record_device_log(
          device_id,
          "response",
          "response.notification_sent",
          "调用状态通知已发送到发布设备",
          {
            connection_id: attachment?.connection_id,
            direction: "outbound",
            task_id: value?.task?.id,
            method: value?.task?.method,
            metadata: { notification: value },
          });
      } catch (error) {
        // Persisted task state remains available for polling after reconnect.
        this.app.devices.record_device_log(
          device_id,
          "response",
          "response.notification_failed",
          "调用状态通知发送失败，发布设备可通过查询恢复",
          {
            connection_id: attachment?.connection_id,
            direction: "outbound",
            level: "error",
            task_id: value?.task?.id,
            method: value?.task?.method,
            metadata: {
              error: error instanceof Error ? error.message : String(error),
              notification_type: value?.type,
            },
          });
      }
    }
  }
}
