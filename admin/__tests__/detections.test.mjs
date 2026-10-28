import assert from "node:assert/strict";
import test from "node:test";
import { DetectionsModel } from "../pages/detections.model.js";
import { realtime_fixture } from "./realtime_fixture.mjs";

const ui = { ref: value => ({ value, as(next) { this.value = next; }, set(next) { this.value = next; } }) };
const row = { id: "one", title: "正文检测", script_id: "source", script_url: "/web/text/detect", enabled: true, status: "changed", change_count: 1, poll_policy: { mode: "inherit" } };
const scripts = [{ id: "source", name: "检测脚本", routes: [{ example: "/web/text/detect?url=https%3A%2F%2Fexample.com" }] }];
const result = { kind: "detect", status: "changed", snapshot: { body: { type: "content", value: "新内容" } }, changes: [{ id: "change", type: "content.updated", target: "body", before: "旧内容", after: "新内容" }], matches: [{ id: "rule", label: "正文变化" }] };

test("内容检测选择脚本及具体参数，创建前校验并保存周期", async () => {
  const calls = [];
  const model = DetectionsModel({ ui, fetch_impl: async (url, options = {}) => {
    calls.push([url, options]);
    return Response.json(options.method === "POST" ? { detection: row } : { detections: [row], scripts });
  } });
  await model.methods.load(); model.methods.open();
  assert.equal(model.state.script_options.value[0].label, "检测脚本");
  await model.methods.save(); assert.equal(calls.length, 1); assert.match(model.state.form_error.value, /名称/);
  model.methods.set("title", "检测"); model.methods.set("script_id", "source");
  assert.equal(model.state.script_url.value, scripts[0].routes[0].example);
  await model.methods.save();
  const body = JSON.parse(calls.find(([, options]) => options.method === "POST")[1].body);
  assert.equal(body.script_id, "source"); assert.deepEqual(body.poll_policy, { mode: "inherit" });
  assert.equal(model.state.form_open.value, false);
});

test("检测历史展示类型、前后值和规则命中，支持复制完整结果", async () => {
  const model = DetectionsModel({ ui, fetch_impl: async url => Response.json(String(url).endsWith("/runs")
    ? { runs: [{ id: "run", status: "changed", observed_at: 1000 }] } : result) });
  await model.methods.history(row);
  assert.equal(model.state.runs.value[0].status_label, "发现变化");
  assert.equal(model.state.events.value[0].title, "正文更新 · body");
  assert.match(model.state.events.value[0].text, /旧内容/);
  assert.equal(model.state.matches.value[0].label, "正文变化");
  assert.deepEqual(JSON.parse(model.state.result_text.value), result);
  model.methods.close_history(); assert.equal(model.state.detail.value, null);
});

test("历史切换和离开页面忽略迟到响应，实时推送触发刷新", async () => {
  let finish;
  const realtime = realtime_fixture(); let loads = 0;
  const model = DetectionsModel({ ui, realtime, fetch_impl: async url => {
    if (String(url).endsWith("/slow")) return new Promise(resolve => { finish = resolve; });
    if (String(url).endsWith("/runs")) return Response.json({ runs: [] });
    if (String(url).endsWith("/fast")) return Response.json(result);
    loads++; return Response.json({ detections: [row], scripts });
  } });
  model.methods.start(); await new Promise(setImmediate); assert.equal(loads, 1);
  await realtime.emit({ type: "detections.changed" }); assert.equal(loads, 2);
  await model.methods.history(row);
  const slow = model.methods.detail("slow"); await model.methods.detail("fast");
  finish(Response.json({ ...result, changes: [] })); await slow;
  assert.equal(model.state.events.value.length, 1);
  model.methods.stop(); assert.equal(realtime.listeners.size, 0);
});

test("暂停、重置与执行使用独立操作，重复提交只发送一次", async () => {
  const calls = []; let finish;
  const model = DetectionsModel({ ui, fetch_impl: async (url, options = {}) => {
    if (options.method) { calls.push([url, options]); if (String(url).endsWith("/run")) return new Promise(resolve => { finish = resolve; }); }
    return Response.json({ detections: [row], scripts });
  } });
  await model.methods.action(row, "toggle"); assert.deepEqual(JSON.parse(calls[0][1].body), { enabled: false });
  await model.methods.action(row, "reset"); assert.equal(calls[1][0], "/admin/api/detections/one/reset");
  const first = model.methods.action(row, "run"); await model.methods.action(row, "run");
  assert.equal(calls.length, 3); finish(Response.json({ task: { id: "job" } })); await first;
});

test("大量变更分页渲染且完整 JSON 保留所有事件", async () => {
  const changes = Array.from({ length: 101 }, (_, index) => ({ id: String(index), type: "field.updated", target: "fields", path: "/n" + index, before: 0, after: 1 }));
  const model = DetectionsModel({ ui, fetch_impl: async url => Response.json(String(url).endsWith("/runs") ? { runs: [{ id: "run", status: "changed", observed_at: 1000 }] } : { ...result, changes }) });
  await model.methods.history(row);
  assert.equal(model.state.events.value.length, 50); assert.equal(model.state.event_pages.value, 3);
  model.methods.next_events(); assert.equal(model.state.events.value[0].id, "50");
  model.methods.next_events(); assert.equal(model.state.events.value.length, 1);
  assert.equal(JSON.parse(model.state.result_text.value).changes.length, 101);
});
