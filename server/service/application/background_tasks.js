import { do_error, DurableObjectError } from "./error.js";
import { valid_identifier } from "../../lib/identifiers.js";
export class ServiceBackgroundTasks {
  constructor({
    repo,
    jobs,
    wait_until,
    notify = () => {}
  }) {
    this.repo = repo;
    this.wait_until = wait_until;
    this.notify = notify;
    this.active = new Map();
    this.jobs = jobs;
  }
  async start(key, descriptor, work) {
    const {
      kind,
      title,
      target,
      source_id = ""
    } = descriptor;
    if (this.jobs && !this.jobs.executing) {
      const task = await this.jobs.enqueue(key, {
        ...descriptor,
        source_id
      });
      return {
        task,
        promise: Promise.resolve({
          task
        })
      };
    }
    if (this.jobs?.executing) {
      const promise = Promise.resolve().then(async () => {
        await this.jobs.assert_current();
        const result = await work(this.jobs.signal);
        if (result?.snapshot?.error) throw new Error(result.snapshot.error);
        return result;
      });
      this.jobs.pending.push(promise);
      return {
        task: this.jobs.value(this.jobs.current),
        promise
      };
    }
    const existing = this.active.get(key);
    if (existing) return {
      task: await this.repo.find(existing.id),
      promise: existing.promise
    };
    const task = {
      id: crypto.randomUUID(),
      kind,
      title,
      target,
      source_id,
      started_at: Date.now()
    };
    await this.repo.insert(task);
    const controller = new AbortController();
    const entry = {
      id: task.id,
      source_id,
      controller,
      promise: null
    };
    entry.promise = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return work(controller.signal);
    }).then(async result => {
      const error = String(result?.snapshot?.error || "").slice(0, 240);
      await this.repo.finish(task.id, error ? "failed" : "completed", error, Date.now());
      return result;
    }, async error => {
      await this.repo.finish(task.id, controller.signal.aborted ? "cancelled" : "failed", String(error.message || error).slice(0, 240), Date.now());
      throw error;
    }).finally(() => {
      this.active.delete(key);
      this.notify(task);
    });
    this.active.set(key, entry);
    this.notify(task);
    this.wait_until?.(entry.promise.catch(() => {}));
    return {
      task: await this.repo.find(task.id),
      promise: entry.promise
    };
  }
  async list(url) {
    if (!url?.searchParams.has("source_ids")) return this.jobs ? this.jobs.list() : {
      tasks: await this.repo.list()
    };
    const source_ids = url.searchParams.get("source_ids").split(",");
    if (source_ids.length > 100 || source_ids.some(id => !valid_identifier(id))) {
      throw do_error("source_ids 必须为 1 到 100 个逗号分隔的有效源 ID", 400);
    }
    return this.jobs ? this.jobs.list([...new Set(source_ids)]) : {
      tasks: await this.repo.running_for_sources([...new Set(source_ids)])
    };
  }
  async is_source_running(source_id) {
    if (this.jobs) return this.jobs.source_running(source_id);
    return [...this.active.values()].some(entry => entry.source_id === source_id);
  }
  async cleanup() {
    if (this.jobs) {
      await this.jobs.store.exec("DELETE FROM jobs WHERE status IN ('completed','failed','cancelled')");
      return this.jobs.list();
    }
    await this.repo.cleanup();
    this.notify(null);
    return await this.list();
  }
  async cancel(id) {
    if (this.jobs) return this.jobs.cancel(id);
    const task = await this.repo.find(id);
    if (!task) throw do_error("任务不存在", 404);
    if (task.status !== "running") return {
      task
    };
    const entry = [...this.active.values()].find(entry => entry.id === id);
    if (!entry) throw do_error("任务已中断，请刷新列表", 409);
    await this.repo.finish(id, "cancelled", "已由管理员终止", Date.now());
    entry.controller.abort(new DurableObjectError("快照刷新已终止", 409));
    this.notify(task);
    return {
      task: await this.repo.find(id)
    };
  }
}
