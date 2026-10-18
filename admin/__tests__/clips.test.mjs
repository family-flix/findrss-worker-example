import assert from "node:assert/strict";
import test from "node:test";
import { ClipsModel, clip_embed } from "../pages/clips.model.js";
import { realtime_fixture } from "./realtime_fixture.mjs";

const ui = { ref: value => ({ value, as(next) { this.value = next; }, set(next) { this.value = next; } }) };
const timers = { setTimeout: () => 1, clearTimeout() {} };
const clip = { id: "one", title: '天气 "<卡片>"', path: "/clips/one", url: "https://example.com/weather", selector: "#weather", width: 320, height: 180, saved_at: 1, enabled: true, poll_policy: { mode: "inherit" } };
function fixture(fetch_impl) { return ClipsModel({ ui, timers, origin: "https://feeds.example", fetch_impl }); }

test("剪藏仅在变化与重连时更新，合并请求期间的推送，离开页面取消订阅", async () => {
  const realtime = realtime_fixture(); let calls = 0, finish;
  const model = ClipsModel({ ui, realtime, fetch_impl: async () => {
    calls++;
    if (calls === 2) await new Promise(resolve => { finish = resolve; });
    return Response.json({ clips: [{ ...clip, saved_at: calls }], renderer_available: true });
  } });
  model.methods.start(); await new Promise(setImmediate);
  assert.equal(calls, 1);
  await realtime.emit({ type: "realtime.connected", reconnected: false }); assert.equal(calls, 1);
  await realtime.emit({ type: "clips.changed" }); assert.equal(calls, 2);
  await realtime.emit({ type: "clips.changed" }); assert.equal(calls, 2);
  finish(); await new Promise(setImmediate); assert.equal(calls, 3);
  await realtime.emit({ type: "realtime.connected", reconnected: true }); assert.equal(calls, 4);
  model.methods.stop(); assert.equal(realtime.listeners.size, 0);
  await realtime.emit({ type: "clips.changed" }); assert.equal(calls, 4);
});

test("剪藏嵌入代码使用固定公开链接，转义标题，禁用脚本", () => {
  const embed = clip_embed(clip, "https://feeds.example");
  assert.match(embed, /src="https:\/\/feeds.example\/clips\/one"/);
  assert.match(embed, /width="320" height="180"/);
  assert.match(embed, /&quot;&lt;卡片&gt;&quot;/);
  assert.match(embed, / sandbox /);
  assert.doesNotMatch(embed, /allow-scripts|admin\/api/);
});

test("创建前校验规则，成功保存后加入列表，暂停与刷新均保持链接", async () => {
  const calls = [];
  const model = fixture(async (path, options = {}) => {
    calls.push([path, options]);
    if (options.method === "POST" && !path.endsWith("/snapshot")) return Response.json({ clip });
    if (options.method === "PATCH") return Response.json({ clip: { ...clip, enabled: false } });
    if (path.endsWith("/snapshot")) return Response.json({ task: { id: "job" } });
    return Response.json({ clips: [clip], renderer_available: true });
  });
  model.methods.open(); await model.methods.save();
  assert.equal(calls.length, 0); assert.match(model.state.form_error.value, /名称/);
  for (const [key, value] of Object.entries({ title: "天气", url: clip.url, selector: clip.selector })) model.methods.set(key, value);
  await model.methods.save();
  assert.equal(model.state.form_open.value, false);
  assert.equal(model.state.clips.value[0].id, clip.id);
  const body = JSON.parse(calls[0][1].body);
  assert.deepEqual(body.poll_policy, { mode: "inherit" });
  assert.equal(body.viewport_width, 1440);
  await model.methods.action(clip, "toggle");
  assert.equal(model.state.clips.value[0].enabled, false);
  assert.equal(model.methods.link(clip), "https://feeds.example/clips/one");
  await model.methods.action(clip, "refresh");
  assert.equal(model.state.clips.value[0].refreshing, true);
  assert.equal(calls.at(-1)[0], "/admin/api/clips/one/snapshot");
});

test("加载错误保留旧列表，停止后忽略迟到响应，重进页面可重新加载", async () => {
  let finish, fail = false, delayed = false;
  const model = fixture(async () => {
    if (delayed) return new Promise(resolve => { finish = resolve; });
    return fail ? Response.json({ error: "offline" }, { status: 503 }) : Response.json({ clips: [clip], renderer_available: false });
  });
  await model.methods.load(); assert.equal(model.state.renderer_available.value, false);
  fail = true; await model.methods.load();
  assert.equal(model.state.clips.value.length, 1); assert.equal(model.state.error.value, "offline");
  delayed = true; const pending = model.methods.load(); model.methods.stop();
  finish(Response.json({ clips: [], renderer_available: true })); await pending;
  assert.equal(model.state.clips.value.length, 1);
  delayed = false; fail = false; await model.methods.load();
  assert.equal(model.state.clips.value[0].id, clip.id);
});

test("编辑保留 ID 与刷新规则，重复保存只提交一次，离开后不应用迟到结果", async () => {
  let finish, count = 0;
  const model = fixture(async (_path, options) => {
    if (options.method === "PATCH") { count++; return new Promise(resolve => { finish = resolve; }); }
    return Response.json({ clips: [clip], renderer_available: true });
  });
  model.methods.open({ ...clip, poll_policy: { mode: "interval", interval: 300 } });
  model.methods.preview(clip);
  model.methods.set("title", "updated");
  const saving = model.methods.save(); await model.methods.save();
  assert.equal(count, 1); assert.equal(model.state.editing_id.value, clip.id);
  model.methods.stop(); finish(Response.json({ clip: { ...clip, title: "updated" } })); await saving;
  assert.equal(model.state.clips.value.length, 0); assert.equal(model.state.busy.value, false);
  assert.equal(model.state.form_open.value, false); assert.equal(model.state.selected.value, null);
});
