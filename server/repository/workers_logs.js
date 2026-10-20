import { WORKERS_LOG_RETENTION_MILLISECONDS as RETENTION_MS } from "../lib/constants.js";

const STATE_KEY = "logs/workers/state.json";
const filter = (key, operation, value) => ({ key, operation, type: typeof value, value });

// 同一个 api DO 串行维护状态；日志正文只保存在 Workers Logs。
export class RepositoryWorkersLogs {
  constructor({ telemetry, object_store, clock = Date.now }) {
    Object.assign(this, { telemetry, object_store, clock });
    this.retention_milliseconds = RETENTION_MS;
    this.tail = Promise.resolve();
    this.state = null;
    this.next_id = 0;
    this.reserved_id = 0;
    this.recent = [];
    this.devices = {
      insert_log: row => this.insert("device", row),
      list_logs: (id, category, before_id, limit) => this.list("device", id, { category, before_id, limit }),
      delete_logs_for: id => this.remove("device", id),
      retention_milliseconds: RETENTION_MS,
    };
    this.scripts = {
      insert: row => this.insert("script", row),
      list_by_route: (id, before_id, limit) => this.list("script", id, { before_id, limit }),
      list_errors: (before_id, limit) => this.list("error", "", { before_id, limit }),
      delete_for_route: id => this.remove("script", id),
      delete_errors_through: id => this.delete_errors_through(id),
      retention_milliseconds: RETENTION_MS,
    };
  }

  run(action) {
    const pending = this.tail.then(async () => {
      if (!this.object_store?.available) throw new Error("日志状态存储不可用");
      if (!this.state) {
        const object = await this.object_store.get(STATE_KEY);
        const state = object ? JSON.parse(await object.text()) : { reserved_id: 0, read_through: 0, deleted: { device: {}, script: {} } };
        if (!state || !Number.isSafeInteger(state.reserved_id) || state.reserved_id < 0
          || !Number.isSafeInteger(state.read_through) || state.read_through < 0
          || ["device", "script"].some(kind => !state.deleted?.[kind] || typeof state.deleted[kind] !== "object" || Array.isArray(state.deleted[kind])
            || Object.values(state.deleted[kind]).some(id => !Number.isSafeInteger(id) || id < 0))) throw new Error("日志状态格式错误");
        this.state = state;
      }
      return action();
    });
    this.tail = pending.catch(() => {});
    return pending;
  }

  async save(state) {
    await this.object_store.put(STATE_KEY, JSON.stringify(state), { httpMetadata: { contentType: "application/json; charset=utf-8" } });
    this.state = state;
  }

  insert(kind, row) {
    return this.run(async () => {
      if (this.next_id >= this.reserved_id) {
        const start = Math.max(this.state.reserved_id + 1, this.clock() * 1000);
        const reserved_id = start + 10000;
        if (!Number.isSafeInteger(reserved_id)) throw new Error("日志编号超出安全范围");
        // 每次只预留编号段，重启不重复；一万条日志只需保存一次小状态文件。
        await this.save({ ...this.state, reserved_id });
        this.next_id = start;
        this.reserved_id = reserved_id;
      }
      const stored = { ...row, id: this.next_id++ };
      this.recent.push({ kind, row: stored, timestamp: this.clock(), bytes: new TextEncoder().encode(JSON.stringify(stored)).length });
      // shortcut: 缓存最多两分钟 / 500 条 / 2 MiB；索引延迟超过窗口时需调整缓存策略。
      this.recent = this.recent.filter(entry => entry.timestamp >= this.clock() - 120000).slice(-500);
      let bytes = this.recent.reduce((sum, entry) => sum + entry.bytes, 0);
      while (bytes > 2 * 1024 * 1024) bytes -= this.recent.shift().bytes;
      return stored;
    });
  }

  visible(kind, row, id, options, state) {
    const type = kind === "device" ? "device" : "script";
    const owner = type === "device" ? row.device_id : row.route;
    const deleted = Object.hasOwn(state.deleted[type], owner) ? state.deleted[type][owner] : 0;
    return Number.isSafeInteger(row.id) && row.id > deleted && Number(row.created_at) >= this.clock() - RETENTION_MS
      && (kind === "error" ? row.status === "error" : owner === id)
      && (options.before_id == null || row.id < options.before_id)
      && (!options.category || row.category === options.category)
      && (type !== "script" || row.status !== "error" || row.id > state.read_through);
  }

  async list(kind, id, options) {
    const state = await this.run(() => this.state);
    const type = kind === "device" ? "device" : "script", to = this.clock();
    const filters = [filter("event", "eq", type === "device" ? "device.log" : "script.exec"), filter("log_version", "eq", 1)];
    if (kind === "error") filters.push(filter("status", "eq", "error"), filter("log_id", "gt", state.read_through));
    else filters.push(filter(type === "device" ? "device_id" : "route", "eq", id));
    if (options.before_id != null) filters.push(filter("log_id", "lt", options.before_id));
    if (options.category) filters.push(filter("category", "eq", options.category));
    const rows = new Map(), times = new Map();
    const collect = (row, timestamp) => {
      if (this.visible(kind, row, id, options, state)) { rows.set(row.id, row); times.set(row.id, timestamp); }
    };
    for (const entry of this.recent) if (entry.kind === type && entry.timestamp >= to - 120000) collect(entry.row, entry.timestamp);
    let offset, previous_time = Infinity;
    const cursors = new Set();
    const size = Math.max(100, options.limit);
    while (true) {
      const events = await this.telemetry.query({ filters, from: to - RETENTION_MS, to, limit: size, offset });
      for (const event of events) {
        let source = event.source;
        if (typeof source === "string") { try { source = JSON.parse(source); } catch { continue; } }
        const service = event.$metadata?.service ?? event.$workers?.scriptName;
        if (service !== this.telemetry.worker_name || source?.event !== (type === "device" ? "device.log" : "script.exec") || source.log_version !== 1) continue;
        collect({ ...source, id: source.log_id }, event.timestamp);
      }
      const sorted = [...rows.keys()].sort((a, b) => b - a);
      const last = events.at(-1);
      if (events.length < size || sorted.length >= options.limit && last.timestamp < times.get(sorted[options.limit - 1])) break;
      const next = last?.$metadata?.id;
      if (!next || cursors.has(next) || !Number.isFinite(last.timestamp) || last.timestamp > previous_time) throw new Error("Cloudflare 日志分页返回无效游标");
      cursors.add(next);
      offset = next; previous_time = last.timestamp;
    }
    return [...rows.values()].sort((a, b) => b.id - a.id).slice(0, options.limit);
  }

  remove(kind, id) {
    return this.run(async () => {
      const marker = Math.max(this.clock() * 1000, this.next_id - 1, this.state.reserved_id);
      await this.save({ ...this.state, reserved_id: marker, deleted: { ...this.state.deleted, [kind]: { ...this.state.deleted[kind], [id]: marker } } });
      this.next_id = this.reserved_id;
    });
  }

  delete_errors_through(id) {
    return this.run(() => this.save({ ...this.state, read_through: Math.max(this.state.read_through, Math.min(id, this.next_id > 0 ? this.next_id - 1 : this.state.reserved_id)) }));
  }
}
