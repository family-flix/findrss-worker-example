import assert from "node:assert/strict";
import test from "node:test";
import { RepositoryBackgroundTasks } from "../server/repository/background_tasks.js";
import { ServiceBackgroundTasks } from "../server/service/durable_object/background_tasks.js";
import { ServiceDiscovery } from "../server/service/durable_object/discovery.js";
import { ServiceTask } from "../server/service/durable_object/tasks.js";
import { RssRouteCache } from "../server/infra/rss_cache.js";
import { snapshot_store } from "./support/snapshot_store.js";
import { register } from "node:module";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { route } = await import("../durable_object_router.js");
const { execute_script, compile_script_module } = await import("../server/infra/script_sandbox.js");

function fixture(t) {
  const store = snapshot_store();
  t.after(() => store.db.close());
  const repo = new RepositoryBackgroundTasks(store);
  return { ...store, tasks_repo: repo, tasks: new ServiceBackgroundTasks({ repo, wait_until: promise => promise.catch(() => {}) }) };
}
const descriptor = { kind: "snapshot", title: "刷新快照：测试", target: "https://example.com/feed" };

test("后台任务合并并发，记录成功与失败，已完成任务重复终止不改变结果", async t => {
  const f = fixture(t);
  let resolve;
  const first = f.tasks.start("one", descriptor, () => new Promise(done => { resolve = done; }));
  const second = f.tasks.start("one", descriptor, () => assert.fail("不应重复执行"));
  assert.equal(first.task.id, second.task.id);
  assert.equal(first.task.status, "running");
  await new Promise(setImmediate);
  resolve({ snapshot: { error: "" } });
  await first.promise;
  assert.equal(f.tasks.cancel(first.task.id).task.status, "completed");
  assert.ok(f.tasks_repo.find(first.task.id).finished_at >= first.task.started_at);
  const failed = f.tasks.start("two", descriptor, () => { throw new Error("offline"); });
  await assert.rejects(failed.promise, /offline/);
  assert.equal(f.tasks_repo.find(failed.task.id).status, "failed");
  const snapshot_error = f.tasks.start("three", descriptor, async () => ({ snapshot: { error: "抓取失败" } }));
  await snapshot_error.promise;
  assert.equal(f.tasks_repo.find(snapshot_error.task.id).status, "failed");
  assert.throws(() => f.tasks.cancel("missing"), { status: 404 });
});

test("取消进行中任务传播信号，迟到结果不能将已终止状态改回完成", async t => {
  const f = fixture(t);
  let resolve, signal;
  const pending = f.tasks.start("one", descriptor, value => { signal = value; return new Promise(done => { resolve = done; }); });
  await new Promise(setImmediate);
  assert.equal(f.tasks.cancel(pending.task.id).task.status, "cancelled");
  assert.equal(signal.aborted, true);
  resolve({}); await pending.promise;
  assert.equal(f.tasks_repo.find(pending.task.id).status, "cancelled");
  const queued = f.tasks.start("queued", descriptor, () => assert.fail("取消后不能开始执行"));
  f.tasks.cancel(queued.task.id);
  await assert.rejects(queued.promise, /已终止/);
});

test("终止订阅源刷新保留上次快照，迟到文章不保存也不发布目录", async t => {
  const f = fixture(t);
  const source = { id: "source", title: "测试源", feed_url: "https://example.com/rss" };
  const previous = { saved_at: 1234, articles_json: '[{"title":"旧文章"}]' };
  let resolve, signal;
  const discovery = new ServiceDiscovery({ background_tasks: f.tasks, repo: { discovery: {
    find: () => source, snapshot_get: () => previous, snapshot_attempt() {},
    snapshot_save() { assert.fail("取消后不能保存"); },
  } }, load_snapshot: (_source, _origin, value) => { signal = value; return new Promise(done => { resolve = done; }); } });
  discovery.publish_catalog = () => assert.fail("取消后不能发布");
  const pending = discovery.snapshot_task(source.id);
  await new Promise(setImmediate);
  f.tasks.cancel(pending.task.id);
  assert.equal(signal.aborted, true);
  resolve({ articles: [{ title: "新文章" }] });
  await assert.rejects(pending.promise, /已终止/);
  assert.equal(previous.saved_at, 1234);
  assert.equal(discovery.snapshot_pending.size, 0);
});

test("取消生成和 R2 上传中的 XML，保留旧指针与缓存并清理新对象", async t => {
  const f = fixture(t);
  const cache = new RssRouteCache(1000, 100, { store: f.repo, object_store: f.object_store });
  const key = "public-snapshot:/cancel";
  const result = title => ({ output: title, invoked: false, rendered: new Map([["rss\n", title]]) });
  await cache.run(key, Date.now(), async () => result("旧内容"));
  const old_key = f.repo.read(key).object_key;
  const old_keys = [...f.bucket.objects.keys()];
  let resolve;
  const controller = new AbortController();
  const generating = cache.run(key, Date.now(), () => new Promise(done => { resolve = done; }), { force: true, signal: controller.signal });
  await new Promise(setImmediate); controller.abort(new Error("已终止")); resolve(result("迟到内容"));
  await assert.rejects(generating, /已终止/);
  const uploading_controller = new AbortController();
  const put = f.object_store.put.bind(f.object_store);
  f.object_store.put = async (...args) => { await put(...args); uploading_controller.abort(new Error("上传时终止")); };
  await assert.rejects(cache.run(key, Date.now(), async () => result("新内容"), { force: true, signal: uploading_controller.signal }), /上传时终止/);
  assert.equal(f.repo.read(key).object_key, old_key);
  assert.deepEqual([...f.bucket.objects.keys()], old_keys);
  assert.equal((await cache.resolve(key, Date.now())).rendered.get("rss\n"), "旧内容");
});

test("任务记录限制最近 100 条，重启后进行中任务标记为中断", async t => {
  const f = fixture(t);
  for (let index = 0; index < 105; index++) await f.tasks.start(String(index), descriptor, async () => {}).promise;
  assert.equal(f.tasks_repo.list().length, 100);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM background_tasks").get().count, 100);
  f.tasks_repo.insert({ id: "interrupted", ...descriptor, started_at: Date.now() });
  new ServiceBackgroundTasks({ repo: f.tasks_repo });
  assert.equal(f.tasks_repo.find("interrupted").status, "failed");
  assert.match(f.tasks_repo.find("interrupted").error, /重启/);
});

test("终止刷新只清理本次设备等待器，不影响共享调用的其他等待者", async () => {
  const service = new ServiceTask({ repo: { calls: { find: () => ({ id: "one", status: "running" }) } }, ports: {}, app: {}, storage: {} });
  const controller = new AbortController();
  const first = service.wait_for_invoke("one", 10000, controller.signal);
  const second = service.wait_for_invoke("one", 10000);
  assert.equal(service.waiters.get("one").size, 2);
  controller.abort(new Error("已终止"));
  await assert.rejects(first, /已终止/);
  assert.equal(service.waiters.get("one").size, 1);
  service.resolve_invoke_waiter("one", { status: "completed" });
  assert.equal((await second).status, "completed");
  assert.equal(service.waiters.size, 0);
});

test("异步刷新返回 202 和任务信息，列表与终止接口校验方法和任务存在性", async t => {
  const f = fixture(t);
  let resolve;
  const app = { background_tasks: f.tasks, discovery: {
    snapshot_task: () => f.tasks.start("source", descriptor, () => new Promise(done => { resolve = done; })),
    refresh_discovery_snapshot: async () => ({ snapshot: { saved_at: 1, articles: [] } }),
  } };
  const request = new Request("https://internal/_admin/discovery/sources/one/snapshot", { method: "POST", headers: { Prefer: "respond-async" } });
  const response = await route(request, app);
  assert.equal(response.status, 202);
  const { task } = await response.json();
  assert.equal(task.status, "running");
  const list = await route(new Request("https://internal/_admin/background-tasks"), app);
  assert.equal((await list.json()).tasks[0].id, task.id);
  assert.equal((await route(new Request("https://internal/_admin/background-tasks", { method: "POST" }), app)).status, 405);
  const cancel_url = "https://internal/_admin/background-tasks/" + task.id + "/cancel";
  assert.equal((await route(new Request(cancel_url), app)).status, 405);
  assert.equal((await (await route(new Request(cancel_url, { method: "POST" }), app)).json()).task.status, "cancelled");
  assert.equal((await route(new Request("https://internal/_admin/background-tasks/missing/cancel", { method: "POST" }), app)).status, 404);
  resolve({}); await new Promise(setImmediate);
  const synchronous = await route(new Request(request, { headers: {} }), app);
  assert.equal(synchronous.status, 200);
  assert.equal((await synchronous.json()).snapshot.saved_at, 1);
});

test("终止信号取消真实 QuickJS 脚本的上游请求并释放沙箱", async t => {
  const controller = new AbortController();
  let started, upstream_signal;
  const upstream_started = new Promise(resolve => { started = resolve; });
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    upstream_signal = options.signal;
    started();
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
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
