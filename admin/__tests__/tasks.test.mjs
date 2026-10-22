import assert from "node:assert/strict";
import test from "node:test";
import { TasksModel } from "../pages/tasks.model.js";
import { realtime_fixture } from "./realtime_fixture.mjs";

const ui = {
  ref: value => ({ value, as(next) { this.value = next; }, set(next) { this.value = next; } }),
  combine: (sources, read) => ({ get value() {
    return read(Object.fromEntries(Object.entries(sources).map(([key, source]) => [key, source.value])));
  } }),
};
const task = { id: "one", title: "刷新快照", status: "running", started_at: Date.now() - 2000, finished_at: 0 };

test("任务默认每页 20 条，先筛选再分页，刷新保留页码，清理和取消后回退有效页", async () => {
  let tasks = Array.from({ length: 41 }, (_, index) => ({ ...task, id: String(index), status: index < 21 ? "running" : "completed" }));
  let calls = 0;
  const model = TasksModel({ ui, fetch_impl: async (_url, options) => {
    calls++;
    if (options.method === "POST") {
      tasks = tasks.map(row => row.id === "20" ? { ...row, status: "cancelled" } : row);
      return Response.json({ task: tasks[20] });
    }
    if (options.method === "DELETE") tasks = tasks.filter(row => row.status !== "completed");
    return Response.json({ tasks });
  } });
  await model.methods.load();
  assert.equal(model.pagination.state.value.page_size, 20);
  assert.equal(model.state.paged_tasks.value.length, 20);
  model.pagination.set_page(2);
  assert.deepEqual(model.state.paged_tasks.value.map(row => row.id), ["40"]);
  assert.equal(calls, 1);
  await model.methods.load();
  assert.equal(model.pagination.state.value.page, 2);
  await model.methods.cleanup();
  assert.equal(model.pagination.page.value, 1);
  model.methods.set_status("running");
  assert.equal(model.pagination.state.value.page, 0);
  assert.equal(model.pagination.state.value.total, 21);
  model.pagination.set_page(1);
  await model.methods.cancel("20");
  assert.equal(model.pagination.page.value, 0);
  assert.equal(model.state.paged_tasks.value.length, 20);
  model.methods.set_status("failed");
  assert.deepEqual(model.state.paged_tasks.value, []);
  assert.equal(model.pagination.state.value.first, 0);
});

test("后台任务通过共享推送更新，首次连接不重复读取，断线恢复补同步，隐藏后停止读取", async () => {
  const realtime = realtime_fixture(); let calls = 0, status = "running";
  const model = TasksModel({ ui, realtime, fetch_impl: async () => {
    calls++; return Response.json({ tasks: [{ ...task, status }] });
  } });
  model.methods.start(); await new Promise(setImmediate);
  await realtime.emit({ type: "realtime.connected", reconnected: false }); assert.equal(calls, 1);
  status = "completed";
  await realtime.emit({ type: "background-tasks.changed" });
  assert.equal(calls, 2); assert.equal(model.state.tasks.value[0].status, "completed");
  await realtime.emit({ type: "realtime.connected", reconnected: true }); assert.equal(calls, 3);
  model.methods.stop(); assert.equal(realtime.listeners.size, 0);
  await realtime.emit({ type: "background-tasks.changed" }); assert.equal(calls, 3);
});

test("任务状态、耗时和取消操作由 Model 维护，取消重复点击只提交一次", async () => {
  let resolve, calls = 0;
  const model = TasksModel({ ui, fetch_impl: async (_url, options) => {
    if (options.method !== "POST") return Response.json({ tasks: [task, { ...task, id: "done", status: "completed" }] });
    calls++; await new Promise(done => { resolve = done; });
    return Response.json({ task: { ...task, status: "cancelled", finished_at: Date.now() } });
  } });
  await model.methods.load();
  assert.equal(model.state.tasks.value[0].status_label, "进行中");
  assert.equal(model.state.tasks.value[0].elapsed_label, "2 秒");
  const cancel = model.methods.cancel("one");
  await model.methods.cancel("one"); await model.methods.cancel("done");
  assert.equal(calls, 1);
  assert.deepEqual(model.state.cancelling.value, ["one"]);
  resolve(); await cancel;
  assert.equal(model.state.tasks.value[0].status_label, "已终止");
  assert.equal(model.state.tasks.value[0].cancellable, false);
});

test("取消失败保留操作入口，加载失败保留旧列表并显示错误", async () => {
  let failed = false;
  const model = TasksModel({ ui, fetch_impl: async (_url, options) => options.method === "POST" || failed
    ? Response.json({ error: "暂时不可用" }, { status: 503 }) : Response.json({ tasks: [task] }) });
  await model.methods.load();
  await model.methods.cancel("one");
  assert.equal(model.state.tasks.value[0].cancellable, true);
  assert.match(model.state.error.value, /暂时不可用/);
  failed = true; await model.methods.load();
  assert.equal(model.state.tasks.value.length, 1);
  assert.equal(model.state.loading.value, false);
});

test("手动加载避免重复请求，停止后忽略迟到响应，并可再次手动加载", async () => {
  let resolve, signal, calls = 0;
  const model = TasksModel({ ui,
    fetch_impl: async (_url, options) => { calls++; signal = options.signal; return new Promise(done => { resolve = done; }); } });
  const first = model.methods.load(); await model.methods.load();
  assert.equal(calls, 1);
  model.methods.stop();
  assert.equal(signal.aborted, true);
  resolve(Response.json({ tasks: [task] })); await first;
  assert.equal(model.state.tasks.value.length, 0);
  const second = model.methods.load(); resolve(Response.json({ tasks: [task] })); await second;
  assert.equal(model.state.tasks.value.length, 1);
  assert.equal(calls, 2);
  model.methods.stop();
});

test("状态筛选覆盖全部状态和空结果，刷新保留筛选，清除后恢复完整列表", async () => {
  const statuses = ["running", "completed", "failed", "cancelled"];
  let tasks = statuses.map(status => ({ ...task, id: status, status }));
  let calls = 0;
  const model = TasksModel({ ui, fetch_impl: async () => { calls++; return Response.json({ tasks }); } });
  await model.methods.load();
  assert.equal(model.state.visible_tasks.value.length, 4);
  for (const status of statuses) {
    model.methods.set_status(status);
    assert.deepEqual(model.state.visible_tasks.value.map(task => task.id), [status]);
  }
  assert.equal(calls, 1);
  model.methods.set_status("unknown");
  assert.equal(model.state.status.value, "cancelled");
  tasks = tasks.filter(task => task.status !== "cancelled");
  await model.methods.load();
  assert.equal(model.state.status.value, "cancelled");
  assert.deepEqual(model.state.visible_tasks.value, []);
  model.methods.set_status("");
  assert.equal(model.state.visible_tasks.value.length, 3);
});

test("终止任务后立即从进行中筛选移除，并出现在已终止筛选中", async () => {
  const model = TasksModel({ ui, fetch_impl: async (_url, options) => options.method === "POST"
    ? Response.json({ task: { ...task, status: "cancelled", finished_at: Date.now() } })
    : Response.json({ tasks: [task] }) });
  await model.methods.load();
  model.methods.set_status("running");
  assert.equal(model.state.visible_tasks.value.length, 1);
  await model.methods.cancel(task.id);
  assert.deepEqual(model.state.visible_tasks.value, []);
  model.methods.set_status("cancelled");
  assert.deepEqual(model.state.visible_tasks.value.map(task => task.id), [task.id]);
});

test("清理成功替换列表并保留筛选，清理期间阻止重复操作", async () => {
  const tasks = [task, ...["completed", "failed", "cancelled"].map(status => ({ ...task, id: status, status }))];
  let resolve;
  const calls = [];
  const model = TasksModel({ ui, fetch_impl: async (url, options) => {
    calls.push([url, options.method || "GET"]);
    if (options.method === "DELETE") return new Promise(done => { resolve = done; });
    return Response.json({ tasks });
  } });
  await model.methods.load();
  model.methods.set_status("failed");
  const pending = model.methods.cleanup();
  assert.equal(model.state.cleaning.value, true);
  await model.methods.cleanup(); await model.methods.load(); await model.methods.cancel(task.id);
  assert.deepEqual(calls, [["/admin/api/background-tasks", "GET"], ["/admin/api/background-tasks", "DELETE"]]);
  resolve(Response.json({ tasks: tasks.filter(task => ["running", "cancelled"].includes(task.status)) }));
  await pending;
  assert.equal(model.state.cleaning.value, false);
  assert.equal(model.state.status.value, "failed");
  assert.deepEqual(model.state.visible_tasks.value, []);
  assert.deepEqual(model.state.tasks.value.map(task => task.status), ["running", "cancelled"]);
});

test("清理失败或响应格式错误保留旧列表并显示错误，允许重试", async () => {
  let response = Response.json({ error: "清理暂时不可用" }, { status: 503 });
  const model = TasksModel({ ui, fetch_impl: async (_url, options) => options.method === "DELETE"
    ? response : Response.json({ tasks: [{ ...task, status: "completed" }] }) });
  await model.methods.load();
  await model.methods.cleanup();
  assert.equal(model.state.tasks.value.length, 1);
  assert.match(model.state.error.value, /清理暂时不可用/);
  assert.equal(model.state.cleaning.value, false);
  response = Response.json({});
  await model.methods.cleanup();
  assert.equal(model.state.tasks.value.length, 1);
  assert.match(model.state.error.value, /格式不正确/);
  response = Response.json({ tasks: [] });
  await model.methods.cleanup();
  assert.deepEqual(model.state.tasks.value, []);
  assert.equal(model.state.error.value, "");
});

test("清理会取消旧刷新，迟到的旧列表不能恢复已删除任务", async () => {
  let resolve, signal;
  const model = TasksModel({ ui, fetch_impl: async (_url, options) => {
    if (options.method === "DELETE") return Response.json({ tasks: [] });
    signal = options.signal;
    return new Promise(done => { resolve = done; });
  } });
  const loading = model.methods.load();
  await model.methods.cleanup();
  assert.equal(signal.aborted, true);
  resolve(Response.json({ tasks: [{ ...task, status: "completed" }] })); await loading;
  assert.deepEqual(model.state.tasks.value, []);
  assert.equal(model.state.loading.value, false);
  assert.equal(model.state.cleaning.value, false);
});
