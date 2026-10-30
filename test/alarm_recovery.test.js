import assert from 'node:assert/strict';
import test from 'node:test';
import { d1_fixture } from './support/d1.js';
import { D1Store } from '../server/infra/d1.js';
import { ServiceJobs } from '../server/service/jobs.js';
function fixture(t, options = {}) {
  const db = d1_fixture(),
    pending = [],
    sent = [];
  t.after(async () => {
    await Promise.allSettled(pending);
    db.sql.close();
  });
  const make = () => new ServiceJobs({
    store: new D1Store(db),
    queue: {
      send: async message => sent.push(message)
    },
    wait_until: promise => pending.push(promise),
    app: {
      snapshot_settings: {
        settings: async () => ({
          max_concurrency: 2
        })
      },
      hot_snapshots: {
        start: async () => {}
      },
      ...options
    }
  });
  return {
    db,
    make,
    sent,
    pending,
    jobs: make()
  };
}
const task = {
  kind: 'hot_snapshot',
  title: 'hot',
  target: '/rank/'
};
test('投递失败保留 D1 待办，新的 Cron 实例会补投；并发扫描不重复投递', async t => {
  const f = fixture(t);
  f.jobs.queue.send = async () => {
    throw new Error('Queue unavailable');
  };
  const queued = await f.jobs.enqueue('hot-snapshot', task);
  await Promise.all(f.pending);
  assert.equal(f.db.sql.prepare('SELECT sent_at FROM jobs WHERE id=?').get(queued.id).sent_at, null);
  await Promise.all([f.make().dispatch(), f.make().dispatch()]);
  assert.deepEqual(f.sent, [{
    id: queued.id
  }]);
});
test('消费者崩溃后租约过期重投，旧租约不能提交写入，超过三次记失败', async t => {
  const f = fixture(t),
    queued = await f.jobs.enqueue('hot-snapshot', task, false);
  f.db.sql.prepare("UPDATE jobs SET status='running',attempts=1,lease_token='old',lease_until=? WHERE id=?").run(Date.now() - 1, queued.id);
  const stale = new D1Store(f.db);
  stale.job = {
    id: queued.id,
    token: 'old'
  };
  await assert.rejects(stale.put('late-result', 1), /CHECK constraint/);
  await f.jobs.dispatch();
  assert.equal(f.db.sql.prepare('SELECT status FROM jobs WHERE id=?').get(queued.id).status, 'queued');
  await f.jobs.consume(queued.id);
  assert.equal(f.db.sql.prepare('SELECT status FROM jobs WHERE id=?').get(queued.id).status, 'completed');
  assert.equal(await new D1Store(f.db).get('late-result'), undefined);
  const exhausted = await f.jobs.enqueue('next', task, false);
  f.db.sql.prepare("UPDATE jobs SET status='running',attempts=3,lease_until=? WHERE id=?").run(Date.now() - 1, exhausted.id);
  await f.jobs.dispatch();
  assert.equal(f.db.sql.prepare('SELECT status FROM jobs WHERE id=?').get(exhausted.id).status, 'failed');
});
test('多个 Worker 消费者共用 D1 并发上限，重复消息不会重复执行', async t => {
  const running = [],
    f = fixture(t, {
      hot_snapshots: {
        start: () => new Promise(resolve => running.push(resolve))
      }
    });
  const tasks = await Promise.all(Array.from({
    length: 3
  }, (_, i) => f.jobs.enqueue('hot-' + i, task, false)));
  const a = f.make(),
    b = f.make(),
    c = f.make();
  const first = a.consume(tasks[0].id),
    second = b.consume(tasks[1].id);
  await new Promise(setImmediate);
  assert.equal(running.length, 2);
  assert.deepEqual(await c.consume(tasks[2].id), {
    retry: true
  });
  assert.deepEqual(await c.consume(tasks[0].id), {
    retry: false
  });
  running.splice(0).forEach(resolve => resolve());
  await Promise.all([first, second]);
  const third = c.consume(tasks[2].id);
  await new Promise(setImmediate);
  running.splice(0).forEach(resolve => resolve());
  await third;
  assert.equal(f.db.sql.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status='completed'").get().n, 3);
});
test('取消中的任务不能发布 D1 结果，下一次投递不会重新开始', async t => {
  let release, started;
  const ready = new Promise(resolve => {
    started = resolve;
  });
  const f = fixture(t),
    queued = await f.jobs.enqueue('hot-snapshot', task, false);
  f.jobs.app.hot_snapshots.start = async () => {
    started();
    await new Promise(resolve => {
      release = resolve;
    });
    await f.jobs.store.put('cancelled-result', 1);
  };
  const pending = f.jobs.consume(queued.id);
  await ready;
  await f.make().cancel(queued.id);
  release();
  await pending;
  await f.jobs.consume(queued.id);
  assert.equal(f.db.sql.prepare('SELECT status FROM jobs WHERE id=?').get(queued.id).status, 'cancelled');
  assert.equal(await new D1Store(f.db).get('cancelled-result'), undefined);
});
test('排队后的自动任务重新检查启停与手动规则，Cron 不依赖 DO Alarm', async t => {
  const f = fixture(t);
  f.db.sql.exec(`INSERT INTO clips(id,title,url,selector,enabled,poll_policy_json,created_at,config_version) VALUES('clip','clip','https://example.com','body',0,'{"mode":"manual"}',0,'version')`);
  const queued = await f.jobs.enqueue('clip:clip', {
    kind: 'clip',
    automatic: true,
    target: 'clip'
  }, false);
  await f.jobs.consume(queued.id);
  assert.equal(f.db.sql.prepare('SELECT status FROM jobs WHERE id=?').get(queued.id).status, 'cancelled');
  assert.equal(f.db.sql.prepare("SELECT due_at FROM schedules WHERE target_id='clip'").get(), undefined);
});
test('某个 Cron 步骤失败仍执行后续投递、目录和维护', async t => {
  const f = fixture(t),
    steps = [];
  f.jobs.schedule_due = async () => {
    steps.push('schedule');
    throw new Error('schedule unavailable');
  };
  f.jobs.dispatch = async () => {
    steps.push('dispatch');
  };
  f.jobs.app.discovery = {
    ensure_catalog: async () => {
      steps.push('catalog');
      throw new Error('R2 unavailable');
    }
  };
  f.jobs.app.hot_snapshots = {
    start: async () => steps.push('hot')
  };
  f.jobs.maintenance = async () => steps.push('maintenance');
  await assert.rejects(f.jobs.scheduled(Date.parse('2026-10-30T00:00:00Z')), AggregateError);
  assert.deepEqual(steps, ['schedule', 'dispatch', 'catalog', 'hot', 'maintenance']);
});
test('源码清理游标保存在 D1，新 Cron 实例逐个处理脚本', async t => {
  const visited = [],
    f = fixture(t, {
      scripts: {
        source_store: {
          available: true
        },
        prune_script_objects: async id => visited.push(id)
      }
    });
  f.db.sql.exec("INSERT INTO scripts(route,title,script,metadata_json,created_at,updated_at) VALUES('a','a','','{}',0,0),('b','b','','{}',0,0)");
  await f.jobs.prune_sources();
  await f.make().prune_sources();
  await f.make().prune_sources();
  assert.deepEqual(visited, ['a', 'b', 'a']);
});
test('公开源抓取失败保留快照但任务记为失败并按退避重试', async t => {
  const f = fixture(t, {
    discovery: {
      refresh_discovery_snapshot: async () => ({
        snapshot: {
          error: 'upstream offline'
        }
      })
    }
  });
  const task = await f.jobs.enqueue('discovery:source', {
    kind: 'snapshot',
    source_id: 'source'
  }, false);
  await f.jobs.consume(task.id);
  const row = f.db.sql.prepare('SELECT status,error,available_at FROM jobs WHERE id=?').get(task.id);
  assert.equal(row.status, 'queued');
  assert.equal(row.error, 'upstream offline');
  assert.ok(row.available_at > Date.now());
});
