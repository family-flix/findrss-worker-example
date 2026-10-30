import { async_map } from "../../lib/async_array.js";
import { ClipModel } from "../../domain/clip.js";
import { sanitize_clip_html, render_clip_document } from "../../infra/clip_html.js";
import { snapshot_next_at, snapshot_policy } from "../../lib/snapshot_schedule.js";
import { learn_poll_interval } from "../../lib/poll_schedule.js";
import { sha256_hex } from "../../lib/crypto.js";
import { do_error, do_result } from "./error.js";
export class ServiceClip {
  constructor({
    repo,
    storage,
    object_store = null,
    load_snapshot = null,
    background_tasks,
    snapshot_settings = () => null,
    schedule_alarm = async () => {},
    script_routes = () => [],
    validate_script = () => {}
  }) {
    Object.assign(this, {
      repo,
      storage,
      object_store,
      load_snapshot,
      background_tasks,
      snapshot_settings,
      schedule_alarm,
      script_routes,
      validate_script
    });
    this.pending = new Map();
  }
  async next_at(row) {
    if (row.enabled && !row.attempted_at) return 0;
    return snapshot_next_at({
      ...row,
      snapshot_attempted_at: row.attempted_at
    }, await this.snapshot_settings());
  }
  async value(row, active = null) {
    return {
      ...ClipModel(row).toValue(),
      next_snapshot_at: await this.next_at(row),
      poll_effective: snapshot_policy(row, await this.snapshot_settings()),
      refreshing: active ? active.has("clip:" + row.id) : this.background_tasks?.jobs ? await this.background_tasks.jobs.is_running("clip:" + row.id) : this.pending.has(row.id)
    };
  }
  async list() {
    const active = this.background_tasks?.jobs ? await this.background_tasks.jobs.active_keys("clip") : null;
    return {
      clips: await async_map(await this.repo.list(), async row => await this.value(row, active)),
      scripts: await this.script_routes(),
      renderer_available: Boolean(this.load_snapshot)
    };
  }
  async find(id) {
    const row = await this.repo.find(id);
    if (!row) throw do_error("剪藏记录不存在", 404);
    return row;
  }
  async input(body) {
    const checked = ClipModel.validate(body);
    if (!checked.ok) throw do_error(checked.error, 400);
    await this.validate_script(checked.fields);
    return checked.fields;
  }
  async create(body) {
    const fields = await this.input(body),
      id = crypto.randomUUID(),
      now = Date.now();
    await this.storage.transaction(async () => {
      if ((await this.repo.count()) >= ClipModel.MAX_RECORDS) throw do_error("最多保存 100 条剪藏，请先删除不需要的记录", 409);
      await this.repo.insert({
        ...fields,
        id,
        created_at: now,
        poll_updated_at: 0,
        config_version: crypto.randomUUID()
      });
    });
    const task = this.load_snapshot && fields.enabled && this.pending.size < (await this.concurrency()) ? (await this.refresh_task(id)).task : null;
    await this.schedule_alarm();
    return do_result({
      clip: await this.value(await this.find(id)),
      task
    }, 201);
  }
  async update(id, body) {
    const before = await this.find(id),
      fields = await this.input({
        ...ClipModel(before).toValue(),
        ...body
      });
    if (fields.script_id === before.script_id && fields.script_url === before.script_url) fields.url = before.url;
    await this.repo.update({
      ...fields,
      id,
      config_version: crypto.randomUUID(),
      poll_updated_at: fields.poll_policy_json === before.poll_policy_json ? before.poll_updated_at : Date.now()
    });
    await this.schedule_alarm();
    return {
      clip: await this.value(await this.find(id))
    };
  }
  async concurrency() {
    return (await this.snapshot_settings())?.max_concurrency || 4;
  }
  async refresh_task(id, {
    automatic = false
  } = {}) {
    const row = await this.find(id);
    if (!this.load_snapshot) throw do_error("请配置 Worker 的 BROWSER 绑定后刷新", 503);
    const existing = this.pending.get(id);
    if (existing) return existing;
    if (this.pending.size >= (await this.concurrency())) throw do_error("剪藏采集任务已满，请稍后重试", 409);
    await this.repo.attempt(id, Date.now());
    const task = await this.background_tasks.start("clip:" + id, {
      kind: "clip",
      title: "剪藏快照：" + row.title,
      target: row.script_url || row.url,
      automatic
    }, async signal => {
      try {
        const result = await this.load_snapshot(row, signal);
        signal.throwIfAborted();
        return await this.save(row, result, signal, automatic);
      } catch (error) {
        await this.repo.failure(id, String(error.message || "剪藏刷新失败").slice(0, 240), row.config_version);
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
  async refresh(id) {
    return do_result({
      task: (await this.refresh_task(id)).task
    }, 202);
  }
  async next_snapshot_at() {
    if (!this.load_snapshot || this.pending.size >= (await this.concurrency())) return null;
    const due = (await async_map((await this.repo.list()).filter(row => !this.pending.has(row.id)), async row => await this.next_at(row))).filter(at => at !== null);
    return due.length ? Math.max(Date.now() + 5000, Math.min(...due)) : null;
  }
  async refresh_due_snapshots() {
    if (!this.load_snapshot) return;
    const due = (await async_map(await this.repo.list(), async row => ({
      row,
      at: await this.next_at(row)
    }))).filter(({
      row,
      at
    }) => at !== null && at <= Date.now() && !this.pending.has(row.id)).sort((a, b) => a.at - b.at);
    const tasks = [];
    for (const {
      row
    } of due) {
      if (this.pending.size >= (await this.concurrency())) break;
      tasks.push((await this.refresh_task(row.id, {
        automatic: true
      })).promise);
    }
    await Promise.allSettled(tasks);
  }
  async save(before, body, signal, automatic = false) {
    const id = before.id;
    let html;
    try {
      html = sanitize_clip_html(body.html);
    } catch (error) {
      throw do_error(error.message, 502);
    }
    const number = (value, max) => Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : 0;
    const stats = body.stats && typeof body.stats === "object" ? body.stats : {};
    const object_key = this.object_store ? `clips/${id}/${crypto.randomUUID()}.html` : "";
    const byte_size = new TextEncoder().encode(html).length;
    const fingerprint = await sha256_hex(html);
    const policy = snapshot_policy(before, await this.snapshot_settings());
    const adaptive_interval = policy.mode === "adaptive" ? learn_poll_interval(policy, before.adaptive_interval, {
      first: !before.saved_at,
      manual: !automatic,
      new_count: Number(before.fingerprint !== fingerprint)
    }) : 0;
    if (!object_key && byte_size > 512 * 1024) throw do_error("超过 512KB 的剪藏需要配置 API_STORAGE 对象存储", 413);
    if (object_key) {
      try {
        await this.object_store.put(object_key, html, {
          httpMetadata: {
            contentType: "text/html; charset=utf-8"
          }
        });
      } catch {
        throw do_error("剪藏存储失败，请重试", 502);
      }
    }
    let previous;
    try {
      await this.storage.transaction(async () => {
        signal?.throwIfAborted();
        await body.assert_current?.();
        previous = await this.find(id);
        if (previous.config_version !== before.config_version) throw do_error("剪藏规则已变更，跳过旧采集结果", 409);
        await this.repo.save({
          id,
          url: body.link,
          html: object_key ? "" : html,
          object_key,
          byte_size,
          node: String(stats.node || "").slice(0, 200),
          width: number(stats.width, 32767),
          height: number(stats.height, 32767),
          image_missing: number(stats.image_missing, 6000),
          saved_at: Math.max(Date.now(), previous.saved_at + 1),
          fingerprint,
          adaptive_interval
        });
      });
    } catch (error) {
      await this.cleanup(object_key);
      throw error;
    }
    const result = {
      clip: await this.value(await this.find(id))
    };
    await this.cleanup(previous.object_key);
    return result;
  }
  async document(id) {
    const row = await this.find(id);
    if (!row.saved_at) throw do_error("剪藏尚未采集完成", 404);
    let html = row.html;
    if (row.object_key) {
      if (!this.object_store) throw do_error("剪藏对象存储不可用", 503);
      try {
        const object = await this.object_store.get(row.object_key);
        if (!object) throw new Error();
        html = await object.text();
      } catch {
        throw do_error("剪藏内容读取失败", 502);
      }
      const current = await this.repo.find(id);
      if (!current || current.object_key !== row.object_key) throw do_error("剪藏已变更，请刷新", 404);
    }
    return render_clip_document(row, html);
  }
  async delete(id) {
    const row = await this.find(id);
    const task = this.pending.get(id);
    if (this.background_tasks?.jobs) await this.background_tasks.jobs.cancel_key("clip:" + id);else if (task) await this.background_tasks.cancel(task.task.id);
    await this.repo.delete(id);
    await this.cleanup(row.object_key);
    await this.schedule_alarm();
    return {
      deleted: true
    };
  }
  async cleanup(key) {
    if (key && this.object_store) {
      try {
        await this.object_store.delete(key);
      } catch (error) {
        console.warn("clip object cleanup failed", error.message);
      }
    }
  }
}
