import assert from "node:assert/strict";
import test from "node:test";
import { AdminSocketHub } from "../admin_socket.js";
import { DeviceSocketHub } from "../socket_hub.js";
import { observe_admin_changes } from "../server/service/durable_object/admin_events.js";

function fixture() {
  const sockets = [], timers = [];
  const ctx = { getWebSockets(tag) { return tag === "admin" ? sockets.filter(socket => socket.state.kind === "admin") : sockets; } };
  function socket(topics = []) {
    const value = { state: { kind: "admin", topics, channels: {} }, sent: [],
      serializeAttachment(state) { this.state = structuredClone(state); },
      deserializeAttachment() { return structuredClone(this.state); },
      send(value) { this.sent.push(JSON.parse(value)); }, close() {},
    };
    sockets.push(value); return value;
  }
  const hub = new AdminSocketHub(ctx, { set_timeout(callback) { timers.push(callback); return timers.length; } });
  const command = (socket, value, app = {}) => hub.receive(socket, JSON.stringify(value), app);
  return { hub, socket, command, ctx, timers };
}

test("空闲不读取数据库，变化合并且只推送订阅主题，休眠重建保留订阅", () => {
  const f = fixture(), first = f.socket(["devices.changed"]), second = f.socket(["clips.changed"]);
  let writes = 0;
  const repo = { calls: { set_completed() { writes++; }, find() { assert.fail("推送通知不能额外查询"); } } };
  observe_admin_changes(repo, f.hub);
  repo.calls.set_completed("one", "{}", 1); repo.calls.set_completed("two", "{}", 2);
  assert.equal(writes, 2); assert.equal(f.timers.length, 1); assert.equal(first.sent.length, 0);
  f.timers.shift()();
  assert.deepEqual(first.sent, [{ type: "admin.changed", events: [{ type: "devices.changed", ids: ["one", "two"] }] }]);
  assert.equal(second.sent.length, 0);
  const restarted = new AdminSocketHub(f.ctx, { set_timeout(callback) { f.timers.push(callback); return 1; } });
  restarted.invalidate("clips.changed", "clip"); f.timers.shift()();
  assert.deepEqual(second.sent[0].events, [{ type: "clips.changed", ids: ["clip"] }]);
  assert.equal(first.sent.length, 1);
  assert.deepEqual(new DeviceSocketHub(f.ctx).get_all(), []);
});

test("只观察实际状态变更，设备心跳和成功日志不触发后台整页刷新", () => {
  const f = fixture(), socket = f.socket(["devices.changed", "messages.changed", "device.logs"]);
  const repo = { devices: { set_seen() {}, insert_log() {} }, script_logs: { insert() {} } };
  observe_admin_changes(repo, f.hub);
  repo.devices.set_seen("device", "connection", 1); repo.script_logs.insert({ status: "ok" });
  assert.equal(f.timers.length, 0);
  repo.devices.insert_log({ device_id: "device" }); repo.script_logs.insert({ status: "error" });
  f.timers.shift()();
  assert.deepEqual(socket.sent[0].events.map(event => event.type), ["device.logs", "messages.changed"]);
});

test("异步日志写入成功后通知后台，失败时不产生更新事件", async () => {
  const f = fixture(), socket = f.socket(["device.logs", "messages.changed"]);
  const repo = { devices: { async insert_log(row) { if (row.fail) throw new Error("R2 failed"); return row; } },
    script_logs: { async insert(row) { if (row.fail) throw new Error("R2 failed"); return row; } } };
  observe_admin_changes(repo, f.hub);
  const pending = repo.devices.insert_log({ device_id: "device" });
  assert.equal(f.timers.length, 0);
  assert.deepEqual(await pending, { device_id: "device" });
  await repo.script_logs.insert({ status: "error" });
  f.timers.shift()();
  assert.deepEqual(socket.sent[0].events.map(event => event.type), ["device.logs", "messages.changed"]);
  await assert.rejects(repo.devices.insert_log({ device_id: "device", fail: true }), /R2 failed/);
  await assert.rejects(repo.script_logs.insert({ status: "error", fail: true }), /R2 failed/);
  assert.equal(f.timers.length, 0);
});

test("两个助手在同一连接运行，关闭一个只取消对应任务，休眠后可重建逻辑通道", async () => {
  const f = fixture(), socket = f.socket(), pending = [], signals = [];
  const run = (_input, emit, signal) => {
    signals.push(signal); emit({ type: "delta", text: "hello" });
    return new Promise((resolve, reject) => { signal.addEventListener("abort", () => reject(signal.reason), { once: true }); pending.push(resolve); });
  };
  const work = [];
  const app = { script_agent: { settings: () => ({ configured: true }), run, run_admin: run, wait_until: value => work.push(value) } };
  f.command(socket, { type: "channel.open", channel: "editor", name: "script-agent" }, app);
  f.command(socket, { type: "channel.open", channel: "global", name: "admin-agent" }, app);
  f.command(socket, { type: "channel.message", channel: "editor", data: { type: "run", run_id: "script", revision: 1, script: "", request_url: "", route: "", messages: [{ role: "user", content: "生成脚本" }] } }, app);
  f.command(socket, { type: "channel.message", channel: "global", data: { type: "run", run_id: "admin", pathname: "/admin/discovery", messages: [{ role: "user", content: "查询" }] } }, app);
  assert.equal(signals.length, 2);
  assert.deepEqual(socket.sent.filter(event => event.data?.type === "delta").map(event => event.channel), ["editor", "global"]);
  f.command(socket, { type: "channel.close", channel: "editor" }, app);
  assert.equal(signals[0].aborted, true); assert.equal(signals[1].aborted, false);
  pending[1](); await Promise.all(work);
  f.hub.close(socket);
  const restarted = new AdminSocketHub(f.ctx);
  restarted.receive(socket, JSON.stringify({ type: "channel.message", channel: "global", data: { type: "cancel", run_id: "old" } }), app);
  assert.ok(socket.sent.some(event => event.channel === "global" && event.data?.type === "ready"));
  restarted.close(socket);
});

test("无效订阅和超大消息被拒绝，不能创建任意通道", () => {
  const f = fixture(), socket = f.socket();
  f.command(socket, { type: "subscribe", topics: ["secret"] });
  assert.deepEqual(socket.state.topics, []);
  f.command(socket, { type: "channel.open", channel: "bad", name: "arbitrary" });
  assert.deepEqual(socket.state.channels, {});
  f.hub.receive(socket, "x".repeat(301 * 1024), {});
  assert.equal(socket.sent.at(-1).data.type, "error");
});
