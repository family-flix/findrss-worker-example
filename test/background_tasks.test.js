import assert from "node:assert/strict";
import test from "node:test";
import { RepositoryBackgroundTasks } from "../server/repository/background_tasks.js";
import { ServiceBackgroundTasks } from "../server/service/application/background_tasks.js";
import { ServiceDiscovery } from "../server/service/application/discovery.js";
import { ServiceTask } from "../server/service/application/tasks.js";
import { RssRouteCache, rss_route_cache_key } from "../server/infra/rss_cache.js";
import { RepositoryDiscoverySource } from "../server/repository/discovery_source.js";
import { DISCOVERY_CATALOG_KEY } from "../server/lib/discovery_catalog.js";
import { snapshot_store } from "./support/snapshot_store.js";
import { register } from "node:module";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const {
  route
} = await import("../application_router.js");
const {
  execute_script,
  compile_script_module
} = await import("../server/infra/script_sandbox.js");
function fixture(t) {
  const store = snapshot_store();
  t.after(async () => await store.db.close());
  const repo = new RepositoryBackgroundTasks(store);
  return {
    ...store,
    tasks_repo: repo,
    tasks: new ServiceBackgroundTasks({
      repo,
      wait_until: promise => promise.catch(() => {})
    })
  };
}
const descriptor = {
  kind: "snapshot",
  title: "刷新快照：测试",
  target: "https://example.com/feed"
};
test("静态发布失败仍返回最新 XML 和文章快照，抓取任务成功且目录可自动重试", async t => {
  const f = fixture(t),
    metadata = new Map();
  const discovery_repo = new RepositoryDiscoverySource({
    sql: f.sql
  });
  f.sql.exec("INSERT INTO discovery_sources (id, title, feed_url, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", "source", "测试源", "{{hostname}}/rss/demo", "", 1, 1);
  const cache = new RssRouteCache(undefined, undefined, {
    store: f.repo,
    object_store: f.object_store
  });
  const key = "public-snapshot:" + rss_route_cache_key("/demo", []);
  let calls = 0;
  const discovery = new ServiceDiscovery({
    background_tasks: f.tasks,
    repo: {
      discovery: discovery_repo
    },
    route_cache: cache,
    storage: {
      get: async key => metadata.get(key),
      put: async (key, value) => metadata.set(key, value),
      delete: async key => metadata.delete(key)
    },
    object_store: f.object_store,
    render_catalog: JSON.stringify,
    schedule_alarm: async () => {},
    load_snapshot: async () => {
      calls++;
      await cache.run(key, Date.now(), async () => ({
        output: "{}",
        invoked: false,
        rendered: new Map([["rss\n", "<rss/>"], ["atom\n", "<feed/>"]])
      }), {
        force: true
      });
      f.bucket.fail_next({
        op: "put"
      });
      return {
        articles: [{
          title: "新文章"
        }]
      };
    }
  });
  const pending = await discovery.snapshot_task("source");
  const result = await pending.promise;
  assert.equal(result.cache.status, "fresh");
  assert.ok(result.cache.saved_at > 0);
  assert.equal(result.cache.refreshing, false);
  assert.equal(result.snapshot.error, "");
  assert.equal(result.snapshot.articles[0].title, "新文章");
  assert.match(result.catalog_error, /静态发布失败/);
  assert.equal((await f.tasks_repo.find(pending.task.id)).status, "completed");
  assert.equal(metadata.get("discovery_catalog_dirty"), true);
  assert.ok(discovery.catalog_retry_at >= Date.now());
  const restored = new RssRouteCache(undefined, undefined, {
    store: f.repo,
    object_store: f.object_store
  });
  assert.equal(await (await restored.resolve(key, Date.now())).rendered.get("rss\n"), "<rss/>");
  assert.equal((await restored.inspect(key)).saved_at, result.cache.saved_at);
  await discovery.publish_catalog();
  assert.ok(await f.object_store.get(DISCOVERY_CATALOG_KEY));
  assert.equal(metadata.has("discovery_catalog_dirty"), false);
  assert.equal(calls, 1);
  discovery.load_snapshot = async () => {
    throw new Error("XML 抓取失败");
  };
  f.bucket.fail_next({
    op: "put"
  });
  const failed = await discovery.snapshot_task("source");
  const stale = await failed.promise;
  assert.equal(stale.snapshot.error, "XML 抓取失败");
  assert.match(stale.catalog_error, /静态发布失败/);
  assert.equal(stale.cache.saved_at, result.cache.saved_at);
  assert.equal((await f.tasks_repo.find(failed.task.id)).status, "failed");
  assert.equal((await f.tasks_repo.find(failed.task.id)).error, "XML 抓取失败");
});
test("后台任务开始、终止、结束与清理通知实时订阅，结束通知发生在释放运行状态之后", async t => {
  const f = fixture(t),
    events = [];
  f.tasks.notify = async task => events.push({
    task,
    active: task ? await f.tasks.is_source_running(task.source_id) : false
  });
  const work = await f.tasks.start("notify", {
    ...descriptor,
    source_id: "source"
  }, signal => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), {
    once: true
  })));
  await new Promise(setImmediate);
  assert.equal(events.length, 1);
  assert.equal(events[0].active, true);
  await f.tasks.cancel(work.task.id);
  assert.equal(events.length, 2);
  await assert.rejects(work.promise);
  assert.equal(events.length, 3);
  assert.equal(events[2].active, false);
  await f.tasks.cleanup();
  assert.equal(events.length, 4);
  assert.equal(events[3].task, null);
});
test("后台任务合并并发，记录成功与失败，已完成任务重复终止不改变结果", async t => {
  const f = fixture(t);
  let resolve;
  const first = await f.tasks.start("one", descriptor, () => new Promise(done => {
    resolve = done;
  }));
  const second = await f.tasks.start("one", descriptor, () => assert.fail("不应重复执行"));
  assert.equal(first.task.id, second.task.id);
  assert.equal(first.task.status, "running");
  await new Promise(setImmediate);
  resolve({
    snapshot: {
      error: ""
    }
  });
  await first.promise;
  assert.equal((await f.tasks.cancel(first.task.id)).task.status, "completed");
  assert.ok((await f.tasks_repo.find(first.task.id)).finished_at >= first.task.started_at);
  const failed = await f.tasks.start("two", descriptor, () => {
    throw new Error("offline");
  });
  await assert.rejects(failed.promise, /offline/);
  assert.equal((await f.tasks_repo.find(failed.task.id)).status, "failed");
  const snapshot_error = await f.tasks.start("three", descriptor, async () => ({
    snapshot: {
      error: "抓取失败"
    }
  }));
  await snapshot_error.promise;
  assert.equal((await f.tasks_repo.find(snapshot_error.task.id)).status, "failed");
  await assert.rejects(async () => await f.tasks.cancel("missing"), {
    status: 404
  });
});
test("补抓识别不同任务键下正在生成 XML 的源，不重复启动抓取", async t => {
  const f = fixture(t);
  let finish;
  const pending = await f.tasks.start("public-snapshot:/xml", {
    ...descriptor,
    source_id: "source"
  }, () => new Promise(resolve => {
    finish = resolve;
  }));
  assert.equal(await f.tasks.is_source_running("source"), true);
  const discovery = new ServiceDiscovery({
    background_tasks: f.tasks,
    repo: {},
    load_snapshot: () => assert.fail("运行中源不能重复抓取")
  });
  discovery.scheduled_sources = () => [{
    id: "source",
    next_at: Date.now() - 6 * 3600000
  }];
  assert.deepEqual(await discovery.recover_overdue_snapshots(), {
    matched_count: 1,
    queued_count: 0,
    skipped_count: 1
  });
  await new Promise(setImmediate);
  finish({});
  await pending.promise;
  assert.equal(await f.tasks.is_source_running("source"), false);
});
test("取消进行中任务传播信号，迟到结果不能将已终止状态改回完成", async t => {
  const f = fixture(t);
  let resolve, signal;
  const pending = await f.tasks.start("one", descriptor, value => {
    signal = value;
    return new Promise(done => {
      resolve = done;
    });
  });
  await new Promise(setImmediate);
  assert.equal((await f.tasks.cancel(pending.task.id)).task.status, "cancelled");
  assert.equal(signal.aborted, true);
  resolve({});
  await pending.promise;
  assert.equal((await f.tasks_repo.find(pending.task.id)).status, "cancelled");
});
test("终止订阅源刷新保留上次快照，迟到文章不保存也不发布目录", async t => {
  const f = fixture(t);
  const source = {
    id: "source",
    title: "测试源",
    feed_url: "https://example.com/rss"
  };
  const previous = {
    saved_at: 1234,
    articles_json: '[{"title":"旧文章"}]'
  };
  let resolve, signal;
  const discovery = new ServiceDiscovery({
    background_tasks: f.tasks,
    repo: {
      discovery: {
        find: () => source,
        snapshot_get: () => previous,
        snapshot_attempt() {},
        snapshot_save() {
          assert.fail("取消后不能保存");
        }
      }
    },
    load_snapshot: (_source, _origin, value) => {
      signal = value;
      return new Promise(done => {
        resolve = done;
      });
    }
  });
  discovery.publish_catalog = () => assert.fail("取消后不能发布");
  const pending = await discovery.snapshot_task(source.id);
  assert.equal(pending.task.source_id, source.id);
  await new Promise(setImmediate);
  await f.tasks.cancel(pending.task.id);
  assert.equal(signal.aborted, true);
  resolve({
    articles: [{
      title: "新文章"
    }]
  });
  await assert.rejects(pending.promise, /已终止/);
  assert.equal(previous.saved_at, 1234);
  assert.equal(discovery.snapshot_pending.size, 0);
});
test("按源 ID 批量查询仅返回匹配的进行中任务，不受最近 100 条限制", async t => {
  const f = fixture(t);
  // 地址相同的不同源不能互相匹配，同一源的多个任务都需要返回。
  for (let index = 0; index < 105; index++) {
    await f.tasks_repo.insert({
      id: String(index),
      ...descriptor,
      source_id: "source-" + index,
      started_at: index
    });
  }
  await f.tasks_repo.insert({
    id: "duplicate",
    ...descriptor,
    source_id: "source-0",
    started_at: 110
  });
  for (const [id, status] of [["1", "completed"], ["2", "failed"], ["3", "cancelled"]]) {
    await f.tasks_repo.finish(id, status, "", 200);
  }
  assert.equal((await f.tasks_repo.list()).some(task => task.id === "0"), false);
  const app = {
    background_tasks: f.tasks
  };
  const response = await route(new Request("https://internal/_admin/background-tasks?source_ids=source-0,source-1,source-2,source-3,source-4,source-0,missing"), app);
  assert.equal(response.status, 200);
  const {
    tasks
  } = await response.json();
  assert.deepEqual(tasks.map(task => task.id), ["duplicate", "4", "0"]);
  assert.deepEqual(tasks.map(task => task.source_id), ["source-0", "source-4", "source-0"]);
  assert.deepEqual(await f.tasks_repo.running_for_sources([]), []);
  assert.deepEqual((await (await route(new Request("https://internal/_admin/background-tasks?source_ids=missing"), app)).json()).tasks, []);
  for (const invalid of ["", "source-0,", "bad id", "' OR 1=1--", "a".repeat(129), Array(101).fill("one").join(",")]) {
    assert.equal((await route(new Request("https://internal/_admin/background-tasks?source_ids=" + encodeURIComponent(invalid)), app)).status, 400, invalid);
  }
});
test("取消生成和 R2 上传中的 XML，保留旧指针与缓存并清理新对象", async t => {
  const f = fixture(t);
  const cache = new RssRouteCache(1000, 100, {
    store: f.repo,
    object_store: f.object_store
  });
  const key = "public-snapshot:/cancel";
  const result = title => ({
    output: title,
    invoked: false,
    rendered: new Map([["rss\n", title]])
  });
  await cache.run(key, Date.now(), async () => result("旧内容"));
  const old_key = (await f.repo.read(key)).object_key;
  const old_keys = [...f.bucket.objects.keys()];
  let resolve;
  const controller = new AbortController();
  const generating = cache.run(key, Date.now(), () => new Promise(done => {
    resolve = done;
  }), {
    force: true,
    signal: controller.signal
  });
  await new Promise(setImmediate);
  controller.abort(new Error("已终止"));
  resolve(result("迟到内容"));
  await assert.rejects(generating, /已终止/);
  const uploading_controller = new AbortController();
  const put = await f.object_store.put.bind(f.object_store);
  f.object_store.put = async (...args) => {
    await put(...args);
    uploading_controller.abort(new Error("上传时终止"));
  };
  await assert.rejects(cache.run(key, Date.now(), async () => result("新内容"), {
    force: true,
    signal: uploading_controller.signal
  }), /上传时终止/);
  assert.equal((await f.repo.read(key)).object_key, old_key);
  assert.deepEqual([...f.bucket.objects.keys()], old_keys);
  assert.equal(await (await cache.resolve(key, Date.now())).rendered.get("rss\n"), "旧内容");
});
test("进程内测试任务限制最近 100 条，新服务实例不修改其他执行中的任务", async t => {
  const f = fixture(t);
  for (let index = 0; index < 105; index++) await (await f.tasks.start(String(index), descriptor, async () => {})).promise;
  assert.equal((await f.tasks_repo.list()).length, 100);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM background_tasks").get().count, 100);
  await f.tasks_repo.insert({
    id: "interrupted",
    ...descriptor,
    started_at: Date.now()
  });
  new ServiceBackgroundTasks({
    repo: f.tasks_repo
  });
  assert.equal((await f.tasks_repo.find("interrupted")).status, "running");
});
test("任务保留边界复用扫描，时间倒退、同毫秒、重启及清理后仍保留正确记录", async t => {
  const f = fixture(t);
  const expected = [];
  let scans = 0;
  const sql = {
    exec(query, ...args) {
      if (query.startsWith("SELECT started_at, rowid FROM background_tasks ORDER BY")) scans++;
      return f.sql.exec(query, ...args);
    }
  };
  let repo = new RepositoryBackgroundTasks({
    sql
  });
  for (let index = 0; index < 250; index++) {
    if (index === 125) repo = new RepositoryBackgroundTasks({
      sql
    });
    const started_at = index % 3 === 0 ? 1 : Math.floor(index / 2);
    await repo.insert({
      id: "boundary-" + index,
      ...descriptor,
      started_at
    });
    const rowid = f.db.prepare("SELECT rowid FROM background_tasks WHERE id = ?").get("boundary-" + index).rowid;
    expected.push({
      id: "boundary-" + index,
      started_at,
      rowid,
      status: "running"
    });
    const sorted = [...expected].sort((a, b) => b.started_at - a.started_at || b.rowid - a.rowid);
    if (sorted.length >= 100) {
      const keep = new Set(sorted.slice(0, 100).map(row => row.id));
      for (let i = expected.length - 1; i >= 0; i--) {
        if (expected[i].status !== "running" && !keep.has(expected[i].id)) expected.splice(i, 1);
      }
    }
    if (index % 4 !== 0) {
      await repo.finish("boundary-" + index, "completed", "", 1000);
      (await expected.find(row => row.id === "boundary-" + index)).status = "completed";
    }
    assert.deepEqual(f.db.prepare("SELECT id FROM background_tasks ORDER BY id").all().map(row => row.id), expected.map(row => row.id).sort());
  }
  assert.equal(scans, 2);
  await repo.cleanup();
  await repo.insert({
    id: "after-cleanup",
    ...descriptor,
    started_at: 0
  });
  assert.equal(scans, 3);
  assert.equal((await repo.find("after-cleanup")).status, "running");
});
test("清理接口从数据库移除所有已完成和失败任务，包括列表之外的记录，保留其他状态", async t => {
  const f = fixture(t);
  for (let index = 0; index < 106; index++) {
    await f.tasks_repo.insert({
      id: String(index),
      ...descriptor,
      started_at: index
    });
  }
  await f.tasks_repo.finish("0", "completed", "", 200);
  await f.tasks_repo.finish("1", "failed", "offline", 200);
  await f.tasks_repo.finish("2", "cancelled", "已终止", 200);
  assert.ok((await f.tasks_repo.list()).every(task => task.status === "running"));
  const response = await route(new Request("https://internal/_admin/background-tasks", {
    method: "DELETE"
  }), {
    background_tasks: f.tasks
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).tasks.length, 100);
  assert.equal(await f.tasks_repo.find("0"), undefined);
  assert.equal(await f.tasks_repo.find("1"), undefined);
  assert.equal((await f.tasks_repo.find("2")).status, "cancelled");
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM background_tasks").get().count, 104);
  assert.deepEqual(await f.tasks.cleanup(), await f.tasks.list());
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM background_tasks").get().count, 104);
});
test("清理任务记录不终止正在运行的任务，清理后仍可正常完成", async t => {
  const f = fixture(t);
  let resolve, signal;
  const pending = await f.tasks.start("pending", descriptor, value => {
    signal = value;
    return new Promise(done => {
      resolve = done;
    });
  });
  await new Promise(setImmediate);
  await f.tasks.cleanup();
  assert.equal(signal.aborted, false);
  assert.equal((await f.tasks_repo.find(pending.task.id)).status, "running");
  resolve({});
  await pending.promise;
  assert.equal((await f.tasks_repo.find(pending.task.id)).status, "completed");
  await f.tasks.cleanup();
  assert.equal(await f.tasks_repo.find(pending.task.id), undefined);
});
test("异步刷新返回 202 和任务信息，列表与终止接口校验方法和任务存在性", async t => {
  const f = fixture(t);
  let resolve;
  const app = {
    background_tasks: f.tasks,
    discovery: {
      snapshot_task: async () => await f.tasks.start("source", descriptor, () => new Promise(done => {
        resolve = done;
      })),
      refresh_discovery_snapshot: async () => ({
        snapshot: {
          saved_at: 1,
          articles: []
        }
      })
    }
  };
  const request = new Request("https://internal/_admin/discovery/sources/one/snapshot", {
    method: "POST",
    headers: {
      Prefer: "respond-async"
    }
  });
  const response = await route(request, app);
  assert.equal(response.status, 202);
  const {
    task
  } = await response.json();
  assert.equal(task.status, "running");
  const list = await route(new Request("https://internal/_admin/background-tasks"), app);
  assert.equal((await list.json()).tasks[0].id, task.id);
  assert.equal((await route(new Request("https://internal/_admin/background-tasks", {
    method: "POST"
  }), app)).status, 405);
  const cancel_url = "https://internal/_admin/background-tasks/" + task.id + "/cancel";
  assert.equal((await route(new Request(cancel_url), app)).status, 405);
  assert.equal((await (await route(new Request(cancel_url, {
    method: "POST"
  }), app)).json()).task.status, "cancelled");
  assert.equal((await route(new Request("https://internal/_admin/background-tasks/missing/cancel", {
    method: "POST"
  }), app)).status, 404);
  resolve({});
  await new Promise(setImmediate);
  const synchronous = await route(new Request(request, {
    headers: {}
  }), app);
  assert.equal(synchronous.status, 200);
  assert.equal((await synchronous.json()).snapshot.saved_at, 1);
});
test("终止信号取消真实 QuickJS 脚本的上游请求并释放沙箱", async t => {
  const controller = new AbortController();
  let started, upstream_signal;
  const upstream_started = new Promise(resolve => {
    started = resolve;
  });
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    upstream_signal = options.signal;
    started();
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), {
      once: true
    }));
  });
  const script = `export const route = { path: "/cancel", name: "测试", example: "/cancel", url: "example.com", maintainers: [], parameters: {}, description: "", async handler(ctx) {
    const response = await ctx.fetchText("https://example.com/rss");
    if (response.error) return response;
    return Result.Ok({ title: "测试", items: [] });
  } };`;
  const compiled = await compile_script_module(script);
  assert.equal(compiled.error, "");
  const pending = execute_script(script, compiled.metadata, null, undefined, [], "", null, controller.signal);
  const rejected = assert.rejects(pending, /快照刷新已终止/);
  await upstream_started;
  controller.abort(new Error("快照刷新已终止"));
  await rejected;
  assert.equal(upstream_signal.aborted, true);
});
