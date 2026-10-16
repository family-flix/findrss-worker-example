import { do_error, DurableObjectError } from "./error.js";

export class ServiceBackgroundTasks {
  constructor({ repo, wait_until }) {
    this.repo = repo;
    this.wait_until = wait_until;
    this.active = new Map();
    this.repo.interrupt(Date.now());
  }

  start(key, { kind, title, target }, work) {
    const existing = this.active.get(key);
    if (existing) return { task: this.repo.find(existing.id), promise: existing.promise };
    const task = { id: crypto.randomUUID(), kind, title, target, started_at: Date.now() };
    this.repo.insert(task);
    const controller = new AbortController();
    const entry = { id: task.id, controller, promise: null };
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
    }).finally(() => this.active.delete(key));
    this.active.set(key, entry);
    this.wait_until?.(entry.promise.catch(() => {}));
    return { task: this.repo.find(task.id), promise: entry.promise };
  }

  list() { return { tasks: this.repo.list() }; }
  cancel(id) {
    const task = this.repo.find(id);
    if (!task) throw do_error("任务不存在", 404);
    if (task.status !== "running") return { task };
    const entry = [...this.active.values()].find(entry => entry.id === id);
    if (!entry) throw do_error("任务已中断，请刷新列表", 409);
    this.repo.finish(id, "cancelled", "已由管理员终止", Date.now());
    entry.controller.abort(new DurableObjectError("快照刷新已终止", 409));
    return { task: this.repo.find(id) };
  }
}
