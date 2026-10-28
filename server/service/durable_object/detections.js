import { DetectionModel } from "../../domain/detection.js";
import { normalize_detect_result, DETECT_RESULT_BYTES } from "../../lib/detect.js";
import { snapshot_next_at, snapshot_policy } from "../../lib/snapshot_schedule.js";
import { learn_poll_interval } from "../../lib/poll_schedule.js";
import { do_error, do_result } from "./error.js";

export class ServiceDetection {
  constructor({ repo, storage, object_store = null, load_snapshot, script_routes, validate_script, background_tasks,
    snapshot_settings = () => null, schedule_alarm = async () => {} }) {
    Object.assign(this, { repo, storage, object_store, load_snapshot, script_routes, validate_script, background_tasks, snapshot_settings, schedule_alarm });
    this.pending = new Map();
  }
  find(id) { const row = this.repo.find(id); if (!row) throw do_error("检测任务不存在", 404); return row; }
  next_at(row) {
    if (snapshot_policy(row, this.snapshot_settings()).mode === "manual") return null;
    if (row.enabled && !row.attempted_at) return 0;
    return snapshot_next_at({ ...row, snapshot_attempted_at: row.attempted_at }, this.snapshot_settings());
  }
  value(row) { return { ...DetectionModel(row).toValue(), next_run_at: this.next_at(row), running: this.pending.has(row.id), poll_effective: snapshot_policy(row, this.snapshot_settings()) }; }
  list() { return { detections: this.repo.list().map(row => this.value(row)), scripts: this.script_routes() }; }
  fields(body) { const result = DetectionModel.validate(body); if (!result.ok) throw do_error(result.error, 400); return result.fields; }
  async create(body) {
    const fields = this.fields(body); this.validate_script(fields);
    const id = crypto.randomUUID(), now = Date.now();
    this.storage.transactionSync(() => {
      if (this.repo.count() >= DetectionModel.MAX_RECORDS) throw do_error("最多保存 100 条检测任务", 409);
      this.repo.insert({ ...fields, id, config_version: crypto.randomUUID(), created_at: now });
    });
    const task = fields.enabled && snapshot_policy(fields, this.snapshot_settings()).mode !== "manual" && this.pending.size < this.concurrency() ? this.run_task(id).task : null;
    await this.schedule_alarm();
    return do_result({ detection: this.value(this.find(id)), task }, 201);
  }
  async update(id, body) {
    const before = this.find(id), fields = this.fields({ ...DetectionModel(before).toValue(), ...body });
    const changed = fields.script_id !== before.script_id || fields.script_url !== before.script_url;
    if (fields.enabled || changed) this.validate_script(fields);
    this.repo.update({ ...fields, id, baseline_id: changed ? "" : before.baseline_id, config_version: crypto.randomUUID(),
      poll_updated_at: fields.poll_policy_json === before.poll_policy_json ? before.poll_updated_at : Date.now() });
    await this.schedule_alarm();
    return { detection: this.value(this.find(id)) };
  }
  async reset(id) {
    const row = this.find(id);
    this.repo.update({ ...row, baseline_id: "", config_version: crypto.randomUUID() });
    await this.schedule_alarm(); return { detection: this.value(this.find(id)) };
  }
  concurrency() { return this.snapshot_settings()?.max_concurrency || 4; }
  run_task(id, { automatic = false } = {}) {
    const row = this.find(id);
    if (this.pending.has(id)) return this.pending.get(id);
    if (this.pending.size >= this.concurrency()) throw do_error("检测任务已满，请稍后重试", 409);
    this.repo.attempt(id, Date.now());
    const task = this.background_tasks.start("detect:" + id, { kind: "detect", title: "内容检测：" + row.title, target: row.script_url }, async signal => {
      try {
        const previous = row.baseline_id ? await this.result(id, row.baseline_id) : null;
        signal.throwIfAborted();
        const value = await this.load_snapshot(row, previous, signal);
        signal.throwIfAborted();
        return await this.save(row, value, previous, signal, automatic);
      } catch (error) {
        if (!signal.aborted && this.repo.find(id)?.config_version === row.config_version) { this.save_error(row, error); await this.prune(id); }
        throw error;
      }
    });
    this.pending.set(id, task);
    task.promise.finally(async () => { if (this.pending.get(id) === task) this.pending.delete(id); await this.schedule_alarm(); }).catch(() => {});
    return task;
  }
  run(id) { return do_result({ task: this.run_task(id).task }, 202); }
  async save(before, raw, previous, signal, automatic) {
    const baseline = previous && previous.context_key === raw.context_key ? previous : null;
    const value = normalize_detect_result(raw, baseline), id = crypto.randomUUID();
    const now = Math.max(Date.now(), (this.find(before.id).saved_at || 0) + 1);
    Object.assign(value, { id, observed_at: new Date(now).toISOString(), context_key: raw.context_key || "" });
    value.changes = value.changes.map((change, index) => ({ ...change, id: id + ":" + index }));
    const text = JSON.stringify(value);
    if (new TextEncoder().encode(text).length > DETECT_RESULT_BYTES) throw do_error("检测结果过大", 413);
    if (!this.object_store && new TextEncoder().encode(text).length > 65536) throw do_error("超过 64KB 的检测历史需要 API_STORAGE 对象存储", 413);
    const object_key = this.object_store ? `detections/${before.id}/${id}.json` : "";
    if (object_key) {
      try { await this.object_store.put(object_key, text, { httpMetadata: { contentType: "application/json; charset=utf-8" } }); }
      catch (error) { await this.cleanup(object_key); throw do_error("检测历史写入失败：" + String(error.message || error).slice(0, 200), 502); }
    }
    try {
      this.storage.transactionSync(() => {
        signal?.throwIfAborted(); raw.assert_current?.();
        const current = this.find(before.id);
        if (current.config_version !== before.config_version || current.baseline_id !== before.baseline_id) throw do_error("检测规则或基线已变更，跳过旧结果", 409);
        this.repo.insert_run({ id, detection_id: before.id, status: value.status, observed_at: now, previous_id: value.previous_id,
          object_key, body_json: object_key ? "" : text, change_count: value.changes.length, match_count: value.matches.length });
        const policy = snapshot_policy(before, this.snapshot_settings());
        this.repo.save({ id: before.id, baseline_id: value.status === "inconclusive" ? current.baseline_id : id,
          last_run_id: id, saved_at: now, error: value.status === "inconclusive" ? value.issues.map(issue => issue.reason).join("；").slice(0, 1000) : "",
          adaptive_interval: policy.mode === "adaptive" ? learn_poll_interval(policy, before.adaptive_interval,
            { first: !before.baseline_id, manual: !automatic, failed: value.status === "inconclusive", new_count: value.changes.length }) : 0 });
      });
    } catch (error) { await this.cleanup(object_key); throw error; }
    await this.prune(before.id);
    return { detection: this.value(this.find(before.id)), result: value };
  }
  save_error(before, error) {
    const id = crypto.randomUUID(), now = Math.max(Date.now(), (this.find(before.id).saved_at || 0) + 1);
    const message = String(error.message || "检测失败").slice(0, 1000);
    const value = { kind: "detect", schema_version: 1, id, status: "error", previous_id: before.baseline_id || null,
      observed_at: new Date(now).toISOString(), error: message, snapshot: null, changes: [], matches: [] };
    this.storage.transactionSync(() => {
      const row = this.find(before.id);
      if (row.config_version !== before.config_version) return;
      this.repo.insert_run({ id, detection_id: before.id, status: "error", observed_at: now, previous_id: row.baseline_id, body_json: JSON.stringify(value), error: message });
      this.repo.save({ id: before.id, baseline_id: row.baseline_id, last_run_id: id, saved_at: now, error: message, adaptive_interval: row.adaptive_interval });
    });
  }
  history(id) {
    const row = this.find(id), runs = this.repo.runs(id);
    if (row.baseline_id && !runs.some(run => run.id === row.baseline_id)) {
      const baseline = this.repo.run(id, row.baseline_id);
      if (baseline) {
        const { id, status, observed_at, previous_id, change_count, match_count, error } = baseline;
        runs.push({ id, status, observed_at, previous_id, change_count, match_count, error });
      }
    }
    return { detection: this.value(row), runs: runs.map(run => ({ ...run, is_baseline: run.id === row.baseline_id })) };
  }
  async result(id, run_id) {
    this.find(id);
    const row = this.repo.run(id, run_id);
    if (!row) throw do_error("检测历史不存在", 404);
    let text = row.body_json;
    if (row.object_key) {
      if (!this.object_store) throw do_error("检测对象存储不可用", 503);
      const object = await this.object_store.get(row.object_key);
      if (!object || object.size > DETECT_RESULT_BYTES) throw do_error("检测历史缺失或过大", 502);
      text = await object.text();
    }
    if (new TextEncoder().encode(text).length > DETECT_RESULT_BYTES) throw do_error("检测历史过大", 502);
    let result;
    try { result = JSON.parse(text); } catch { throw do_error("检测历史格式错误", 502); }
    if (!result || result.kind !== "detect" || result.schema_version !== 1 || result.id !== run_id || result.status !== row.status) throw do_error("检测历史与索引不一致", 502);
    if (!this.repo.find(id) || !this.repo.run(id, run_id)) throw do_error("检测历史已变更", 404);
    return result;
  }
  next_snapshot_at() {
    if (this.pending.size >= this.concurrency()) return null;
    const times = this.repo.list().filter(row => !this.pending.has(row.id)).map(row => this.next_at(row)).filter(at => at !== null);
    return times.length ? Math.max(Date.now() + 5000, Math.min(...times)) : null;
  }
  async refresh_due_snapshots() {
    const due = this.repo.list().map(row => ({ row, at: this.next_at(row) })).filter(({ row, at }) => at !== null && at <= Date.now() && !this.pending.has(row.id)).sort((a, b) => a.at - b.at);
    const tasks = [];
    for (const { row } of due) { if (this.pending.size >= this.concurrency()) break; tasks.push(this.run_task(row.id, { automatic: true }).promise); }
    await Promise.allSettled(tasks);
  }
  async prune(id) {
    const row = this.repo.find(id); if (!row) return;
    for (const old of this.repo.expired(id, row.baseline_id)) { this.repo.delete_run(old.id); await this.cleanup(old.object_key); }
  }
  async delete(id) {
    this.find(id); const task = this.pending.get(id);
    if (task) this.background_tasks.cancel(task.task.id);
    const objects = this.repo.objects(id);
    this.storage.transactionSync(() => this.repo.delete(id));
    for (const { object_key } of objects) await this.cleanup(object_key);
    await this.schedule_alarm(); return { deleted: true };
  }
  async cleanup(key) { if (key && this.object_store) try { await this.object_store.delete(key); } catch (error) { console.warn("detection cleanup failed", error.message); } }
}
