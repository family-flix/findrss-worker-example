import { do_error } from "./application/error.js";
import { rss_route_cache_key } from "../infra/rss_cache.js";
import { snapshot_next_at } from "../lib/snapshot_schedule.js";
import { SourceAddressModel } from "../domain/source_address.js";
import { CallModel } from "../domain/call.js";
export class ServiceJobs {
  constructor({
    store,
    queue,
    app,
    wait_until
  }) {
    Object.assign(this, {
      store,
      queue,
      app,
      wait_until
    });
    this.executing = false;
    this.pending = [];
  }
  async rows(sql, ...values) {
    return (await this.store.exec(sql, ...values)).toArray();
  }
  async enqueue(key, descriptor, dispatch = true) {
    if (!this.queue) throw do_error("缺少 JOBS 队列绑定", 503);
    const id = crypto.randomUUID(),
      now = Date.now();
    await this.store.exec(`INSERT INTO jobs(id,task_key,descriptor_json,status,created_at,available_at)
      VALUES(?,?,?,'queued',?,?) ON CONFLICT DO NOTHING`, id, key, JSON.stringify(descriptor), now, now);
    const task = (await this.rows("SELECT * FROM jobs WHERE id=? OR (task_key=? AND status IN ('queued','running')) ORDER BY created_at DESC LIMIT 1", id, key))[0];
    if (dispatch) this.wait_until(this.dispatch().catch(error => console.warn("任务投递失败，Cron 将重试", error.message)));
    this.notify();
    return this.value(task);
  }
  value(row) {
    return {
      ...JSON.parse(row.descriptor_json),
      id: row.id,
      status: row.status,
      started_at: row.created_at,
      finished_at: row.finished_at,
      error: row.error
    };
  }
  async list(source_ids = null) {
    const rows = source_ids ? await this.rows("SELECT * FROM jobs WHERE status IN ('queued','running') AND json_extract(descriptor_json,'$.source_id') IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC", JSON.stringify(source_ids)) : await this.rows("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100");
    const tasks = rows.map(row => this.value(row));
    return {
      tasks: source_ids ? tasks.filter(task => source_ids.includes(task.source_id) && ['queued', 'running'].includes(task.status)) : tasks
    };
  }
  async is_running(key) {
    return Boolean((await this.rows("SELECT id FROM jobs WHERE task_key=? AND status IN ('queued','running') LIMIT 1", key)).length);
  }
  async active_keys(kind) {
    return new Set((await this.rows("SELECT task_key FROM jobs WHERE task_key GLOB ? AND status IN ('queued','running')", kind + ':*')).map(row => row.task_key));
  }
  async source_running(source_id) {
    return Boolean((await this.rows("SELECT id FROM jobs WHERE status IN ('queued','running') AND json_extract(descriptor_json,'$.source_id')=? LIMIT 1", source_id)).length);
  }
  async cancel_key(key) {
    await this.store.exec("UPDATE jobs SET status='cancelled',finished_at=? WHERE task_key=? AND status IN ('queued','running')", Date.now(), key);
    this.notify();
  }
  async cancel(id) {
    await this.store.exec("UPDATE jobs SET status='cancelled',finished_at=? WHERE id=? AND status IN ('queued','running')", Date.now(), id);
    const row = (await this.rows("SELECT * FROM jobs WHERE id=?", id))[0];
    if (!row) throw do_error("任务不存在", 404);
    this.notify();
    return {
      task: this.value(row)
    };
  }
  notify() {
    this.wait_until(Promise.resolve().then(() => this.app.events?.invalidate('background-tasks.changed')).catch(error => console.warn('任务通知失败', error.message)));
  }
  async dispatch() {
    const now = Date.now();
    await this.store.exec("UPDATE jobs SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,sent_at=NULL,lease_token=NULL,error=CASE WHEN attempts>=3 THEN '执行租约已过期，重试次数已用尽' ELSE error END,finished_at=CASE WHEN attempts>=3 THEN ? ELSE NULL END WHERE status='running' AND lease_until<?", now, now);
    const rows = await this.rows("SELECT id FROM jobs WHERE status='queued' AND available_at<=? AND (sent_at IS NULL OR sent_at<?) ORDER BY available_at LIMIT 50", now, now - 300000);
    for (const row of rows) {
      const claim = await this.store.exec("UPDATE jobs SET sent_at=? WHERE id=? AND status='queued' AND (sent_at IS NULL OR sent_at<?)", now, row.id, now - 300000);
      if (!claim.rowsWritten) continue;
      try {
        await this.queue.send({
          id: row.id
        });
      } catch (error) {
        await this.store.exec("UPDATE jobs SET sent_at=NULL WHERE id=? AND sent_at=?", row.id, now);
        throw error;
      }
    }
  }
  async reschedule(kind, id) {
    let row;
    if (kind === 'discovery') row = (await this.rows(`SELECT d.*,s.attempted_at AS snapshot_attempted_at,s.adaptive_interval
      FROM discovery_sources d LEFT JOIN discovery_source_snapshots s ON s.source_id=d.id WHERE d.id=?`, id))[0];else if (kind === 'rss') row = (await this.rows('SELECT * FROM rss_public_feeds WHERE key=?', id))[0];else row = (await this.rows(`SELECT * FROM ${kind === 'clip' ? 'clips' : 'detections'} WHERE id=?`, id))[0];
    const settings = await this.app.snapshot_settings.settings();
    let due = null;
    if (row && kind === 'rss') {
      const sources = await this.rows('SELECT feed_url FROM discovery_sources WHERE route_pathname=?', row.pathname);
      const managed = sources.some(source => {
        const address = SourceAddressModel(source.feed_url);
        const query = new URL(address.resolve('https://template.invalid')).searchParams;
        return rss_route_cache_key(address.route_pathname, query) === rss_route_cache_key(row.pathname, new URLSearchParams(JSON.parse(row.query_json)));
      });
      if (!managed) due = Number(row.attempted_at || 0) + 600000;
    } else if (row && !(kind === 'discovery' && row.require_token && !SourceAddressModel(row.feed_url).is_route())) due = snapshot_next_at({
      ...row,
      snapshot_attempted_at: row.snapshot_attempted_at ?? row.attempted_at
    }, settings);
    if (due === null) {
      await this.store.exec('DELETE FROM schedules WHERE kind=? AND target_id=?', kind, id);
      return null;
    }
    await this.store.exec(`INSERT INTO schedules(kind,target_id,due_at) VALUES(?,?,?)
      ON CONFLICT(kind,target_id) DO UPDATE SET due_at=excluded.due_at`, kind, id, due);
    return due;
  }
  async rebuild_schedule() {
    for (const [kind, table, column] of [['discovery', 'discovery_sources', 'id'], ['clip', 'clips', 'id'], ['detect', 'detections', 'id'], ['rss', 'rss_public_feeds', 'key']]) for (const row of await this.rows(`SELECT ${column} AS id FROM ${table}`)) await this.reschedule(kind, row.id);
  }
  async schedule_due() {
    for (const row of await this.rows('SELECT * FROM schedules WHERE due_at<=? ORDER BY due_at LIMIT 50', Date.now())) {
      const due = await this.reschedule(row.kind, row.target_id);
      if (due === null || due > Date.now()) continue;
      const key = row.kind === 'rss' ? row.target_id : row.kind + ':' + row.target_id;
      let descriptor;
      if (row.kind === 'rss') {
        const feed = (await this.rows('SELECT * FROM rss_public_feeds WHERE key=?', row.target_id))[0];
        if (feed) descriptor = {
          kind: 'snapshot',
          title: '刷新 RSS 快照',
          target: feed.pathname + '?' + new URLSearchParams(JSON.parse(feed.query_json)),
          public_url: feed.self_url,
          automatic: true
        };
      } else descriptor = {
        kind: row.kind === 'discovery' ? 'snapshot' : row.kind,
        title: '自动刷新',
        target: row.target_id,
        source_id: row.kind === 'discovery' ? row.target_id : '',
        automatic: true
      };
      if (descriptor) await this.enqueue(key, descriptor, false);
      await this.store.exec('UPDATE schedules SET due_at=? WHERE kind=? AND target_id=?', Date.now() + 300000, row.kind, row.target_id);
    }
  }
  async scheduled(at = Date.now()) {
    const errors = [];
    for (const [name, run] of [['调度', () => this.schedule_due()], ['投递', () => this.dispatch()], ['目录', () => this.app.discovery.ensure_catalog()], ['热榜', () => new Date(at).getUTCMinutes() % 5 === 0 ? this.app.hot_snapshots.start() : undefined], ['源码清理', () => this.prune_sources()], ['维护', () => this.maintenance()]]) {
      try {
        await run();
      } catch (error) {
        errors.push(error);
        console.warn('Cron ' + name + '失败', error.message);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Cron 部分任务失败');
  }
  async prune_sources() {
    if (!this.app.scripts?.source_store?.available) return;
    const previous = (await this.store.get('script_prune_cursor')) || '';
    const row = (await this.rows('SELECT route FROM scripts WHERE route>? ORDER BY route LIMIT 1', previous))[0] || (await this.rows('SELECT route FROM scripts ORDER BY route LIMIT 1'))[0];
    if (!row) return;
    try {
      await this.app.scripts.prune_script_objects(row.route);
    } finally {
      await this.store.put('script_prune_cursor', row.route);
    }
  }
  async maintenance() {
    const now = Date.now();
    await this.app.devices.close_unauthorized_connections();
    const expired = await this.app.tasks.repo.calls.list_expired_leases(now);
    if (expired.length) {
      await this.app.tasks.repo.calls.sweep_expired(now, CallModel.MAX_ATTEMPTS);
      for (const row of expired) if (row.attempt_count >= CallModel.MAX_ATTEMPTS) await this.app.tasks.resolve_invoke_waiter(row.id, await this.app.tasks.find_task(row.id));
    }
    if ((await this.rows("SELECT id FROM calls WHERE status='queued' LIMIT 1")).length) await this.app.tasks.dispatch_pending();
    const previous = Number((await this.store.get('maintenance_at')) || 0);
    if (now - previous < 3600000) return;
    await this.app.scripts.preview_assets.prune();
    await this.app.maintenance.prune_retention(now);
    await this.app.maintenance.prune_events(now);
    await this.store.exec("DELETE FROM jobs WHERE status IN ('completed','failed','cancelled') AND finished_at<?", now - 7 * 86400000);
    await this.store.put('maintenance_at', now);
  }
  async automatic_enabled(key) {
    const [prefix, ...parts] = key.split(':');
    if (prefix === 'public-snapshot') return (await this.reschedule('rss', key)) !== null;
    if (!['discovery', 'clip', 'detect'].includes(prefix)) return true;
    const id = parts.join(':');
    const table = prefix === 'discovery' ? 'discovery_sources' : prefix === 'clip' ? 'clips' : 'detections';
    const row = (await this.rows(`SELECT * FROM ${table} WHERE id=?`, id))[0];
    if (!row || prefix === 'discovery' && row.require_token && !SourceAddressModel(row.feed_url).is_route()) return false;
    return snapshot_next_at(row, await this.app.snapshot_settings.settings()) !== null;
  }
  async assert_current() {
    if (!this.current) return;
    const row = (await this.rows("SELECT status,lease_token,lease_until FROM jobs WHERE id=?", this.current.id))[0];
    if (!row || row.status !== 'running' || row.lease_token !== this.token || row.lease_until <= Date.now()) throw do_error("任务已取消或执行租约已失效", 409);
  }
  async consume(id) {
    const token = crypto.randomUUID(),
      now = Date.now();
    const settings = await this.app.snapshot_settings.settings();
    const result = await this.store.exec("UPDATE jobs SET status='running',lease_token=?,lease_until=?,attempts=attempts+1 WHERE id=? AND status='queued' AND available_at<=? AND (SELECT COUNT(*) FROM jobs WHERE status='running' AND lease_until>?)<?", token, now + 900000, id, now, now, settings.max_concurrency);
    if (!result.rowsWritten) {
      const row = (await this.rows('SELECT status FROM jobs WHERE id=?', id))[0];
      return {
        retry: row?.status === 'queued'
      };
    }
    const row = (await this.rows("SELECT * FROM jobs WHERE id=?", id))[0];
    this.executing = true;
    this.current = row;
    this.token = token;
    this.notify();
    this.store.job = {
      id,
      token
    };
    const descriptor = JSON.parse(row.descriptor_json),
      abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(840000)]);
    this.signal = signal;
    let checking = false;
    const monitor = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        await this.assert_current();
      } catch (error) {
        abort.abort(error);
      } finally {
        checking = false;
      }
    }, 5000);
    try {
      if (descriptor.automatic && !(await this.automatic_enabled(row.task_key))) {
        await this.cancel(id);
        return;
      }
      if (row.task_key.startsWith('discovery:')) {
        const result = await this.app.discovery.refresh_discovery_snapshot(descriptor.source_id, descriptor.public_url || '', {
          automatic: descriptor.automatic,
          force: descriptor.force,
          signal
        });
        if (result?.snapshot?.error) throw new Error(result.snapshot.error);
      } else if (row.task_key.startsWith('clip:')) await (await this.app.clips.refresh_task(row.task_key.slice(5), {
        automatic: descriptor.automatic
      })).promise;else if (row.task_key.startsWith('detect:')) await (await this.app.detections.run_task(row.task_key.slice(7), {
        automatic: descriptor.automatic
      })).promise;else if (descriptor.kind === 'hot_snapshot') {
        await this.app.hot_snapshots.start();
        await Promise.all(this.pending);
      } else if (descriptor.kind === 'snapshot') {
        const url = new URL(descriptor.target, 'https://internal');
        await this.app.scripts.serve_rss_route('rss', url.pathname, new Request('https://internal/_admin/feed/rss' + url.pathname + url.search, {
          headers: {
            'X-Feed-Public-URL': descriptor.public_url || ''
          }
        }), {
          refresh: true,
          signal
        });
      } else throw new Error('未知任务类型：' + descriptor.kind);
      await this.assert_current();
      this.store.job = null;
      await this.store.exec("UPDATE jobs SET status='completed',finished_at=?,lease_token=NULL WHERE id=? AND lease_token=?", Date.now(), id, token);
    } catch (error) {
      this.store.job = null;
      const retry = row.attempts < 3;
      await this.store.exec("UPDATE jobs SET status=?,error=?,finished_at=?,available_at=?,sent_at=NULL,lease_token=NULL WHERE id=? AND lease_token=? AND status='running'", retry ? 'queued' : 'failed', String(error.message).slice(0, 1000), retry ? null : Date.now(), Date.now() + 60000 * 2 ** row.attempts, id, token);
      console.warn('后台任务执行失败', id, error.message);
    } finally {
      clearInterval(monitor);
      this.notify();
      this.store.job = null;
      this.executing = false;
      this.current = null;
      this.pending = [];
      const kind = row.task_key.startsWith('discovery:') ? 'discovery' : row.task_key.startsWith('clip:') ? 'clip' : row.task_key.startsWith('detect:') ? 'detect' : '';
      if (kind) await this.reschedule(kind, descriptor.source_id || row.task_key.slice(kind.length + 1));
    }
  }
}
