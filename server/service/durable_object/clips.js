import { ClipModel } from "../../domain/clip.js";
import { sanitize_clip_html, render_clip_document } from "../../infra/clip_html.js";
import { snapshot_next_at, snapshot_policy } from "../../lib/snapshot_schedule.js";
import { learn_poll_interval } from "../../lib/poll_schedule.js";
import { sha256_hex } from "../../lib/crypto.js";
import { do_error, do_result } from "./error.js";

export class ServiceClip {
  constructor({ repo, storage, object_store = null, load_snapshot = null, background_tasks,
    snapshot_settings = () => null, schedule_alarm = async () => {} }) {
    Object.assign(this, { repo, storage, object_store, load_snapshot, background_tasks, snapshot_settings, schedule_alarm });
    this.pending = new Map();
  }
  next_at(row) {
    if (row.enabled && !row.attempted_at) return 0;
    return snapshot_next_at({ ...row, snapshot_attempted_at: row.attempted_at }, this.snapshot_settings());
  }
  value(row) {
    return { ...ClipModel(row).toValue(), next_snapshot_at: this.next_at(row),
      poll_effective: snapshot_policy(row, this.snapshot_settings()), refreshing: this.pending.has(row.id) };
  }
  list() { return { clips: this.repo.list().map(row => this.value(row)), renderer_available: Boolean(this.load_snapshot) }; }
  find(id) {
    const row = this.repo.find(id);
    if (!row) throw do_error("剪藏记录不存在", 404);
    return row;
  }
  input(body) {
    const checked = ClipModel.validate(body);
    if (!checked.ok) throw do_error(checked.error, 400);
    return checked.fields;
  }
  async create(body) {
    const fields = this.input(body), id = crypto.randomUUID(), now = Date.now();
    this.storage.transactionSync(() => {
      if (this.repo.count() >= ClipModel.MAX_RECORDS) throw do_error("最多保存 100 条剪藏，请先删除不需要的记录", 409);
      this.repo.insert({ ...fields, id, created_at: now, poll_updated_at: 0, config_version: crypto.randomUUID() });
    });
    const task = this.load_snapshot && fields.enabled && this.pending.size < this.concurrency() ? this.refresh_task(id).task : null;
    await this.schedule_alarm();
    return do_result({ clip: this.value(this.find(id)), task }, 201);
  }
  async update(id, body) {
    const before = this.find(id), fields = this.input({ ...ClipModel(before).toValue(), ...body });
    this.repo.update({ ...fields, id, config_version: crypto.randomUUID(),
      poll_updated_at: fields.poll_policy_json === before.poll_policy_json ? before.poll_updated_at : Date.now() });
    await this.schedule_alarm();
    return { clip: this.value(this.find(id)) };
  }
  concurrency() { return this.snapshot_settings()?.max_concurrency || 4; }
  refresh_task(id, { automatic = false } = {}) {
    const row = this.find(id);
    if (!this.load_snapshot) throw do_error("请配置 CF_BROWSER_ACCOUNT_ID 和 CF_BROWSER_API_TOKEN 后刷新", 503);
    const existing = this.pending.get(id);
    if (existing) return existing;
    if (this.pending.size >= this.concurrency()) throw do_error("剪藏采集任务已满，请稍后重试", 409);
    this.repo.attempt(id, Date.now());
    const task = this.background_tasks.start("clip:" + id, { kind: "clip", title: "剪藏快照：" + row.title, target: row.url },
      async signal => {
        try {
          const result = await this.load_snapshot(row, signal);
          signal.throwIfAborted();
          return await this.save(row, result, signal, automatic);
        } catch (error) {
          this.repo.failure(id, String(error.message || "剪藏刷新失败").slice(0, 240), row.config_version);
          throw error;
        }
      });
    this.pending.set(id, task);
    // Wait for BackgroundTasks to release its key before allowing another refresh.
    task.promise.finally(async () => {
      if (this.pending.get(id) === task) this.pending.delete(id);
      await this.schedule_alarm();
    }).catch(() => {});
    return task;
  }
  refresh(id) { return do_result({ task: this.refresh_task(id).task }, 202); }
  next_snapshot_at() {
    if (!this.load_snapshot || this.pending.size >= this.concurrency()) return null;
    const due = this.repo.list().filter(row => !this.pending.has(row.id)).map(row => this.next_at(row)).filter(at => at !== null);
    return due.length ? Math.max(Date.now() + 5000, Math.min(...due)) : null;
  }
  async refresh_due_snapshots() {
    if (!this.load_snapshot) return;
    const due = this.repo.list().map(row => ({ row, at: this.next_at(row) }))
      .filter(({ row, at }) => at !== null && at <= Date.now() && !this.pending.has(row.id)).sort((a, b) => a.at - b.at);
    const tasks = [];
    for (const { row } of due) {
      if (this.pending.size >= this.concurrency()) break;
      tasks.push(this.refresh_task(row.id, { automatic: true }).promise);
    }
    await Promise.allSettled(tasks);
  }
  async save(before, body, signal, automatic = false) {
    const id = before.id;
    let html;
    try { html = sanitize_clip_html(body.html); } catch (error) { throw do_error(error.message, 502); }
    const number = (value, max) => Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : 0;
    const stats = body.stats && typeof body.stats === "object" ? body.stats : {};
    const object_key = this.object_store ? `clips/${id}/${crypto.randomUUID()}.html` : "";
    const byte_size = new TextEncoder().encode(html).length;
    const fingerprint = await sha256_hex(html);
    const policy = snapshot_policy(before, this.snapshot_settings());
    const adaptive_interval = policy.mode === "adaptive" ? learn_poll_interval(policy, before.adaptive_interval,
      { first: !before.saved_at, manual: !automatic, new_count: Number(before.fingerprint !== fingerprint) }) : 0;
    if (!object_key && byte_size > 512 * 1024) throw do_error("超过 512KB 的剪藏需要配置 API_STORAGE 对象存储", 413);
    if (object_key) {
      try { await this.object_store.put(object_key, html, { httpMetadata: { contentType: "text/html; charset=utf-8" } }); }
      catch { throw do_error("剪藏存储失败，请重试", 502); }
    }
    let previous;
    try {
      this.storage.transactionSync(() => {
        signal?.throwIfAborted();
        previous = this.find(id);
        if (previous.config_version !== before.config_version) throw do_error("剪藏规则已变更，跳过旧采集结果", 409);
        this.repo.save({ id, html: object_key ? "" : html, object_key, byte_size,
          node: String(stats.node || "").slice(0, 200), width: number(stats.width, 32767), height: number(stats.height, 32767),
          image_missing: number(stats.image_missing, 6000), saved_at: Math.max(Date.now(), previous.saved_at + 1), fingerprint, adaptive_interval });
      });
    } catch (error) { await this.cleanup(object_key); throw error; }
    const result = { clip: this.value(this.find(id)) };
    await this.cleanup(previous.object_key);
    return result;
  }
  async document(id) {
    const row = this.find(id);
    if (!row.saved_at) throw do_error("剪藏尚未采集完成", 404);
    let html = row.html;
    if (row.object_key) {
      if (!this.object_store) throw do_error("剪藏对象存储不可用", 503);
      try {
        const object = await this.object_store.get(row.object_key);
        if (!object) throw new Error();
        html = await object.text();
      } catch { throw do_error("剪藏内容读取失败", 502); }
      const current = this.repo.find(id);
      if (!current || current.object_key !== row.object_key) throw do_error("剪藏已变更，请刷新", 404);
    }
    return render_clip_document(row, html);
  }
  async delete(id) {
    const row = this.find(id);
    const task = this.pending.get(id);
    if (task) this.background_tasks.cancel(task.task.id);
    this.repo.delete(id);
    await this.cleanup(row.object_key);
    await this.schedule_alarm();
    return { deleted: true };
  }
  async cleanup(key) {
    if (key && this.object_store) {
      try { await this.object_store.delete(key); } catch (error) { console.warn("clip object cleanup failed", error.message); }
    }
  }
}
