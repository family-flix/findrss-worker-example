import assert from "node:assert/strict";
import test from "node:test";
import { RepositoryDevice } from "../server/repository/device.js";
import { RepositoryCall } from "../server/repository/call.js";
import { ServiceDevice } from "../server/service/durable_object/devices.js";
import { ServiceTask } from "../server/service/durable_object/tasks.js";
import { CallModel } from "../server/domain/call.js";
import { snapshot_store } from "./support/snapshot_store.js";

function fixture(t) {
  const store = snapshot_store();
  t.after(() => store.db.close());
  const devices = new RepositoryDevice(store), calls = new RepositoryCall(store);
  devices.upsert_connection({ device_id: "device", connection_id: "connection", methods_json: '["test"]',
    device_name: "Device", device_os: "test", max_concurrency: 1, connected_at: 1_000_000, last_seen_at: 1_000_000 });
  const socket = { state: { device_id: "device", connection_id: "connection", methods: ["test"] }, sent: [],
    deserializeAttachment() { return structuredClone(this.state); },
    serializeAttachment(value) { this.state = structuredClone(value); },
    send(value) { this.sent.push(JSON.parse(value)); } };
  const ports = { sockets: { get_all: () => [socket] }, route_cache: { stats: () => ({}) } };
  const service = () => {
    const result = new ServiceDevice({ repo: { devices, calls }, ports, app: {} });
    result.record_device_log = async () => {};
    return result;
  };
  return { ...store, devices, calls, socket, ports, service };
}

test("设备活动按五分钟持久化，服务重建和 WebSocket 附件恢复仍保留实时活跃时间", async t => {
  const f = fixture(t);
  let now = 1_020_000;
  t.mock.method(Date, "now", () => now);
  for (let index = 0; index < 14; index++, now += 20_000) {
    await f.service().webSocketMessage(f.socket, '{"type":"client.heartbeat"}');
    assert.equal(f.service().summary().devices[0].last_seen_at, now);
    assert.equal(f.devices.find("device").last_seen_at, 1_000_000);
  }
  await f.service().webSocketMessage(f.socket, '{"type":"client.heartbeat"}');
  assert.equal(f.devices.find("device").last_seen_at, 1_300_000);
  assert.equal(f.socket.sent.length, 15);
  assert.ok(f.socket.sent.every(message => message.type === "client.heartbeat.ack"));
  // 已存在的旧连接没有新附件字段时仍使用数据库时间。
  delete f.socket.state.last_seen_at;
  assert.equal(f.service().summary().devices[0].last_seen_at, now);
});

test("检查点写入失败后重试，离线恢复及时落库，旧连接和重复关闭不能覆盖新状态", async t => {
  const f = fixture(t);
  const original_exec = f.devices.sql.exec;
  let fail = true;
  f.devices.sql = { exec(query, ...args) {
    if (fail && query.includes("UPDATE devices")) throw new Error("storage unavailable");
    return original_exec(query, ...args);
  } };
  let now = 1_300_000;
  t.mock.method(Date, "now", () => now);
  await assert.rejects(f.service().webSocketMessage(f.socket, '{"type":"client.heartbeat"}'), /storage unavailable/);
  fail = false;
  await f.service().webSocketMessage(f.socket, '{"type":"client.heartbeat"}');
  assert.equal(f.devices.find("device").last_seen_at, now);
  f.devices.set_offline("device", "connection", ++now);
  f.devices.set_offline("device", "connection", now + 1);
  assert.equal(f.devices.find("device").disconnected_at, now);
  await f.service().webSocketMessage(f.socket, '{"type":"client.heartbeat"}');
  assert.equal(f.devices.find("device").status, "online");
  assert.equal(f.devices.find("device").disconnected_at, null);
  f.sql.exec("UPDATE devices SET connection_id = 'replacement' WHERE device_id = 'device'");
  f.devices.set_seen("device", "connection", now + 600_000);
  f.devices.set_offline("device", "connection", now + 600_000);
  f.devices.set_stale_offline("device", "connection", now + 600_000);
  assert.equal(f.devices.find("device").last_seen_at, now);
  assert.equal(f.devices.find("device").status, "online");
  f.socket.state.last_seen_at = now + 600_000;
  f.socket.state.connection_id = "replacement";
  f.ports.sockets.get_all = () => [];
  const summary = f.service().summary().devices[0];
  assert.equal(summary.status, "offline");
  assert.equal(summary.last_seen_at, now);
});

test("任务重复确认只续租，心跳即时持久化，错误设备或租约不能修改任务", async t => {
  const f = fixture(t);
  let now = 2_000_000;
  t.mock.method(Date, "now", () => now);
  f.calls.insert({ id: "task", method: "test", publisher_device_id: "publisher", access_token_id: null,
    credit_cost: 0, target_device_id: "device", idempotency_key: null, coalesce_key: null, args_json: "{}", created_at: 1, updated_at: 1 });
  f.calls.assign("task", "device", "lease", now - 1000, 2);
  let transitions = 0, renewals = 0;
  const repo = { calls: { find: id => f.calls.find(id),
    set_running(...args) { transitions++; f.calls.set_running(...args); },
    set_heartbeat(...args) { renewals++; f.calls.set_heartbeat(...args); } } };
  const service = new ServiceTask({ repo, ports: { schedule_alarm: async () => {} }, storage: f.storage,
    app: { devices: { record_device_log() {} } } });
  const message = { type: "task.accept", task_id: "task", lease_token: "lease" };
  await service.accept_task(f.socket, f.socket.state, message);
  await service.accept_task(f.socket, f.socket.state, message);
  assert.equal(transitions, 1);
  assert.equal(renewals, 1);
  assert.equal(f.calls.find("task").lease_expires_at, CallModel.lease_deadline(now));
  now += 20_000;
  await service.heartbeat_task(f.socket, f.socket.state, { ...message, type: "task.heartbeat" });
  assert.equal(renewals, 2);
  assert.equal(f.calls.find("task").lease_expires_at, CallModel.lease_deadline(now));
  assert.equal(f.calls.find("task").updated_at, now);
  await service.accept_task(f.socket, { device_id: "other" }, message);
  await service.heartbeat_task(f.socket, f.socket.state, { ...message, lease_token: "wrong" });
  assert.equal(f.socket.sent.at(-1).type, "task.rejected");
  assert.equal(transitions, 1);
  assert.equal(renewals, 2);
  assert.deepEqual(f.calls.count_by_status().map(row => ({ ...row })), [{ status: "running", count: 1 }]);
});
