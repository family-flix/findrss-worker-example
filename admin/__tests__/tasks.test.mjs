import assert from "node:assert/strict";
import test from "node:test";
import { TasksModel } from "../pages/tasks.model.js";

const ui = { ref: value => ({ value, as(next) { this.value = next; } }) };
const task = { id: "one", title: "刷新快照", status: "running", started_at: Date.now() - 2000, finished_at: 0 };

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
