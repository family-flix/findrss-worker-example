import assert from 'node:assert/strict';
import test from 'node:test';
import { d1_fixture } from './support/d1.js';
import { D1Store } from '../server/infra/d1.js';
import { ServiceJobs } from '../server/service/jobs.js';
function fixture(t, options = {}) {
  const db = d1_fixture(),
    pending = [];
  t.after(async () => {
    await Promise.allSettled(pending);
    db.sql.close();
  });
  const make = () => new ServiceJobs({
    store: new D1Store(db),
    run_job: (id, signal) => make().consume(id, signal),
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
    pending,
    jobs: make()
  };
}
const task = {
  kind: 'hot_snapshot',
  title: 'hot',
  target: '/rank/'
};
test('自动刷新任务保留来源名称和地址，重启后仍能识别定义源、剪藏及检测', async t => {
  const f = fixture(t);
  f.db.sql.exec("INSERT INTO discovery_sources(id,title,feed_url,category,created_at,updated_at) VALUES('source','测试定义源','{{hostname}}/rss/demo','',0,0)");
  f.db.sql.exec("INSERT INTO clips(id,title,url,selector,config_version,created_at) VALUES('clip','测试剪藏','https://example.com/article','body','v',0),('script-clip','脚本剪藏','https://example.com/page','body','v',0)");
  f.db.sql.exec("UPDATE clips SET script_url='/clip/demo' WHERE id='script-clip'");
  f.db.sql.exec("INSERT INTO detections(id,title,script_id,script_url,config_version,created_at) VALUES('detect','测试检测','script','/detect/demo','v',0)");
  await f.jobs.schedule_due();
  const { tasks } = await f.make().list();
  assert.equal(tasks.length, 4);
  for (const [key, title, target, source_id] of [
    ['discovery:source', '测试定义源', '{{hostname}}/rss/demo', 'source'],
    ['clip:clip', '测试剪藏', 'https://example.com/article', ''],
    ['clip:script-clip', '脚本剪藏', '/clip/demo', ''],
    ['detect:detect', '测试检测', '/detect/demo', '']
  ]) {
    const row = f.db.sql.prepare('SELECT id FROM jobs WHERE task_key=?').get(key);
    const task = tasks.find(task => task.id === row.id);
    assert.equal(task.title, '自动刷新：' + title);
    assert.equal(task.target, target);
    assert.equal(task.source_id, source_id);
    assert.equal(task.automatic, true);
    assert.equal(task.status, 'queued');
  }
  await f.jobs.schedule_due();
  assert.equal((await f.jobs.list()).tasks.length, 4);
});
test('没有 Queue 绑定也能持久化任务，由新的 Cron 直接执行；重叠扫描不重复执行', async t => {
  let executed = 0;
  const f = fixture(t, { hot_snapshots: { start: async () => { executed++; } } });
  const queued = await f.jobs.enqueue('hot-snapshot', task);
  assert.equal((await f.jobs.enqueue('hot-snapshot', task)).id, queued.id);
  await Promise.all(f.pending);
  assert.equal(executed, 0);
  assert.equal(f.db.sql.prepare('SELECT status FROM jobs WHERE id=?').get(queued.id).status, 'queued');
  f.db.sql.prepare('UPDATE jobs SET sent_at=? WHERE id=?').run(Date.now(), queued.id);
  await Promise.all([f.make().dispatch(), f.make().dispatch()]);
  assert.equal(executed, 1);
  assert.equal(f.db.sql.prepare('SELECT status,attempts FROM jobs WHERE id=?').get(queued.id).status, 'completed');
});
test('Cron 中断后租约过期直接重试，旧租约不能提交写入，超过三次记失败', async t => {
  const f = fixture(t),
    queued = await f.jobs.enqueue('hot-snapshot', task);
  f.db.sql.prepare("UPDATE jobs SET status='running',attempts=1,lease_token='old',lease_until=? WHERE id=?").run(Date.now() - 1, queued.id);
  const stale = new D1Store(f.db);
  stale.job = {
    id: queued.id,
    token: 'old'
  };
  await assert.rejects(stale.put('late-result', 1), /CHECK constraint/);
  await f.jobs.dispatch();
  assert.equal(f.db.sql.prepare('SELECT status FROM jobs WHERE id=?').get(queued.id).status, 'completed');
  assert.equal(f.db.sql.prepare('SELECT attempts FROM jobs WHERE id=?').get(queued.id).attempts, 2);
  assert.equal(f.db.sql.prepare('SELECT error FROM jobs WHERE id=?').get(queued.id).error, '');
  await assert.rejects(stale.put('late-result', 1), /CHECK constraint/);
  assert.equal(await new D1Store(f.db).get('late-result'), undefined);
  const exhausted = await f.jobs.enqueue('next', task);
  f.db.sql.prepare("UPDATE jobs SET status='running',attempts=3,lease_until=? WHERE id=?").run(Date.now() - 1, exhausted.id);
  await f.jobs.dispatch();
  assert.equal(f.db.sql.prepare('SELECT status FROM jobs WHERE id=?').get(exhausted.id).status, 'failed');
});
test('多个 Cron 执行者共用 D1 并发上限，同一任务不会重复执行', async t => {
  const running = [],
    f = fixture(t, {
      hot_snapshots: {
        start: () => new Promise(resolve => running.push(resolve))
      }
    });
  const tasks = await Promise.all(Array.from({
    length: 3
  }, (_, i) => f.jobs.enqueue('hot-' + i, task)));
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
test('取消中的任务不能发布 D1 结果，下一轮领取不会重新开始', async t => {
  let release, started;
  const ready = new Promise(resolve => {
    started = resolve;
  });
  const f = fixture(t),
    queued = await f.jobs.enqueue('hot-snapshot', task);
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
  });
  await f.jobs.consume(queued.id);
  assert.equal(f.db.sql.prepare('SELECT status FROM jobs WHERE id=?').get(queued.id).status, 'cancelled');
  assert.equal(f.db.sql.prepare("SELECT due_at FROM schedules WHERE target_id='clip'").get(), undefined);
});
test('某个 Cron 步骤失败仍维护目录和设备，最后执行当轮任务', async t => {
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
  assert.deepEqual(steps, ['schedule', 'catalog', 'hot', 'maintenance', 'dispatch']);
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
  });
  await f.jobs.consume(task.id);
  const row = f.db.sql.prepare('SELECT status,error,available_at FROM jobs WHERE id=?').get(task.id);
  assert.equal(row.status, 'queued');
  assert.equal(row.error, 'upstream offline');
  assert.ok(row.available_at > Date.now());
  await f.jobs.dispatch();
  assert.equal(f.db.sql.prepare('SELECT attempts FROM jobs WHERE id=?').get(task.id).attempts, 1);
});

test('Cron 并发执行整批任务，每个任务独立持有租约，单个失败不阻塞后续任务', async t => {
  let running = 0, peak = 0;
  const f = fixture(t);
  const run_job = f.jobs.run_job;
  f.jobs.run_job = async (id, signal) => {
    running++;
    peak = Math.max(peak, running);
    try { return await run_job(id, signal); } finally { running--; }
  };
  await Promise.all(Array.from({ length: 8 }, (_, index) => f.jobs.enqueue('hot-' + index, task)));
  await f.jobs.enqueue('invalid', { kind: 'invalid' });
  await f.jobs.dispatch();
  assert.equal(peak, 2);
  assert.equal(f.db.sql.prepare("SELECT count(*) AS n FROM jobs WHERE status='completed'").get().n, 8);
  assert.equal(f.db.sql.prepare("SELECT attempts FROM jobs WHERE task_key='invalid'").get().attempts, 1);
  assert.equal(f.jobs.store.job, undefined);
  assert.equal(f.jobs.executing, false);
});

test('Cron 超过领取时间后保留剩余待办，下轮继续；全局并发已满时不增加执行次数', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const f = fixture(t);
  f.jobs.app.snapshot_settings.settings = async () => ({ max_concurrency: 1 });
  const run_job = f.jobs.run_job;
  f.jobs.run_job = async (...args) => {
    const result = await run_job(...args);
    now += 51000;
    return result;
  };
  for (let index = 0; index < 3; index++) await f.jobs.enqueue('hot-' + index, task);
  await f.jobs.dispatch();
  assert.equal(f.db.sql.prepare("SELECT count(*) AS n FROM jobs WHERE status='queued'").get().n, 2);
  await f.make().dispatch();
  assert.equal(f.db.sql.prepare("SELECT count(*) AS n FROM jobs WHERE status='completed'").get().n, 3);

  const queued = await f.jobs.enqueue('waiting', task);
  f.db.sql.prepare("UPDATE jobs SET status='running',lease_until=? WHERE task_key IN ('hot-0','hot-1')").run(now + 900000);
  await f.make().dispatch();
  assert.equal(f.db.sql.prepare('SELECT attempts FROM jobs WHERE id=?').get(queued.id).attempts, 0);
});

test('Cron 每轮最多执行 50 条任务，剩余任务持久化到下一轮', async t => {
  const f = fixture(t);
  for (let index = 0; index < 55; index++) await f.jobs.enqueue('hot-' + index, task);
  await f.jobs.dispatch();
  assert.equal(f.db.sql.prepare("SELECT count(*) AS n FROM jobs WHERE status='completed'").get().n, 50);
  assert.equal(f.db.sql.prepare("SELECT count(*) AS n FROM jobs WHERE status='queued' AND attempts=0").get().n, 5);
  await f.make().dispatch();
  assert.equal(f.db.sql.prepare("SELECT count(*) AS n FROM jobs WHERE status='completed'").get().n, 55);
});

test('Cron 截止信号传入执行链路，超时按退避重试且不再领取后续任务', async t => {
  const controller = new AbortController();
  const f = fixture(t, { discovery: { refresh_discovery_snapshot: async (_id, _url, { signal }) => {
    controller.abort(new DOMException('Cron 执行超时', 'TimeoutError'));
    signal.throwIfAborted();
  } } });
  const current = await f.jobs.enqueue('discovery:source', { kind: 'snapshot', source_id: 'source' });
  await f.jobs.dispatch(controller.signal);
  const row = f.db.sql.prepare('SELECT status,error,attempts FROM jobs WHERE id=?').get(current.id);
  assert.equal(row.status, 'queued');
  assert.equal(row.attempts, 1);
  assert.equal(row.error, 'Cron 执行超时');
  const queued = await f.jobs.enqueue('after-timeout', task);
  await f.jobs.dispatch(controller.signal);
  assert.equal(f.db.sql.prepare('SELECT attempts FROM jobs WHERE id=?').get(queued.id).attempts, 0);
});
