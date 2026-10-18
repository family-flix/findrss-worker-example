import { do_error, DurableObjectError } from "./error.js";
import { valid_identifier } from "../../lib/identifiers.js";

export class ServiceBackgroundTasks {
  constructor({ repo, wait_until, notify = () => {} }) {
    this.repo = repo;
    this.wait_until = wait_until;
    this.notify = notify;
    this.active = new Map();
    this.repo.interrupt(Date.now());
  }

  start(key, { kind, title, target, source_id = "" }, work) {
    const existing = this.active.get(key);
    if (existing) return { task: this.repo.find(existing.id), promise: existing.promise };
    const task = { id: crypto.randomUUID(), kind, title, target, source_id, started_at: Date.now() };
    this.repo.insert(task);
    const controller = new AbortController();
    const entry = { id: task.id, source_id, controller, promise: null };
    entry.promise = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return work(controller.signal);
    }).then(result => {
      const error = String(result?.snapshot?.error || "").slice(0, 240);
      this.repo.finish(task.id, error ? "failed" : "completed", error, Date.now());
      return result;
    }, error => {
      this.repo.finish(task.id, controller.signal.aborted ? "cancelled" : "failed", String(error.message || error).slice(0, 240), Date.now());
      throw error;
    }).finally(() => { this.active.delete(key); this.notify(task); });
    this.active.set(key, entry);
    this.notify(task);
    this.wait_until?.(entry.promise.catch(() => {}));
    return { task: this.repo.find(task.id), promise: entry.promise };
  }

  list(url) {
    if (!url?.searchParams.has("source_ids")) return { tasks: this.repo.list() };
    const source_ids = url.searchParams.get("source_ids").split(",");
    if (source_ids.length > 100 || source_ids.some(id => !valid_identifier(id))) {
      throw do_error("source_ids 必须为 1 到 100 个逗号分隔的有效源 ID", 400);
    }
    return { tasks: this.repo.running_for_sources([...new Set(source_ids)]) };
  }
  is_source_running(source_id) {
    return [...this.active.values()].some(entry => entry.source_id === source_id);
  }
  cleanup() {
    this.repo.cleanup();
    this.notify(null);
    return this.list();
  }
  cancel(id) {
    const task = this.repo.find(id);
    if (!task) throw do_error("任务不存在", 404);
    if (task.status !== "running") return { task };
    const entry = [...this.active.values()].find(entry => entry.id === id);
    if (!entry) throw do_error("任务已中断，请刷新列表", 409);
    this.repo.finish(id, "cancelled", "已由管理员终止", Date.now());
    entry.controller.abort(new DurableObjectError("快照刷新已终止", 409));
    this.notify(task);
    return { task: this.repo.find(id) };
  }
}
