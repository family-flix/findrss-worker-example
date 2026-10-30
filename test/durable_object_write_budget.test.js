import assert from "node:assert/strict";
import test from "node:test";
import { RepositoryDevice } from "../server/repository/device.js";
import { RepositoryCall } from "../server/repository/call.js";
import { RepositoryAccessToken } from "../server/repository/access_token.js";
import { RepositoryDeviceToken } from "../server/repository/device_token.js";
import { RepositoryMcpToken } from "../server/repository/mcp_token.js";
import { RepositoryDiscoverySource } from "../server/repository/discovery_source.js";
import { RepositoryClip } from "../server/repository/clip.js";
import { ServiceDevice } from "../server/service/application/devices.js";
import { ServiceTask } from "../server/service/application/tasks.js";
import { CallModel } from "../server/domain/call.js";
import { snapshot_store } from "./support/snapshot_store.js";
for (const [table, Repository, seed] of [["access_tokens", RepositoryAccessToken, "INSERT INTO access_tokens(id,user_id,name,token_hash,token_hint,created_at) VALUES ('token','user','Token','hash','hint',1)"], ["device_tokens", RepositoryDeviceToken, "INSERT INTO device_tokens(id,name,token_hash,token_hint,encrypted_token,created_at) VALUES ('token','Token','hash','hint','encrypted',1)"], ["mcp_tokens", RepositoryMcpToken, "INSERT INTO mcp_tokens(id,name,token_hash,token_hint,scopes_json,resource,created_at,expires_at) VALUES ('token','Token','hash','hint','[]','https://example.com/mcp',1,9999999999999)"]]) test(table + " 使用时间五分钟最多写一次，重建不重置限流，写入失败可重试", async t => {
  const store = snapshot_store();
  t.after(async () => await store.db.close());
  store.db.exec(seed);
  let writes = 0,
    fail = false;
  const sql = {
    exec(query, ...args) {
      if (fail) throw new Error("storage unavailable");
      writes += Number(store.db.prepare(query).run(...args).changes);
    }
  };
  for (let index = 0; index < 1000; index++) await new Repository({
    sql
  }).set_last_used("token", 1000000);
  assert.equal(writes, 1);
  await new Repository({
    sql
  }).set_last_used("token", 1299999);
  assert.equal(writes, 1);
  await new Repository({
    sql
  }).set_last_used("token", 1300000);
  assert.equal(writes, 2);
  fail = true;
  await assert.rejects(async () => await new Repository({
    sql
  }).set_last_used("token", 1600000), /storage unavailable/);
  fail = false;
  await new Repository({
    sql
  }).set_last_used("token", 1600000);
  assert.equal(writes, 3);
  assert.equal(store.db.prepare("SELECT last_used_at FROM " + table + " WHERE id = 'token'").get().last_used_at, 1600000);
});
test("重复抓取错误与未变化的学习间隔不写库，保留成功快照并拒绝旧地址及旧配置", async t => {
  const store = snapshot_store();
  t.after(async () => await store.db.close());
  store.db.exec("INSERT INTO discovery_source_snapshots(source_id,feed_url,articles_json,saved_at) VALUES ('source','https://example.com/feed','[{\"title\":\"previous\"}]',123)");
  store.db.exec("INSERT INTO clips(id,title,url,selector,config_version,created_at) VALUES ('clip','Clip','https://example.com','main','current',1)");
  let writes = 0;
  const sql = {
    exec(query, ...args) {
      writes += Number(store.db.prepare(query).run(...args).changes);
    }
  };
  const sources = new RepositoryDiscoverySource({
      sql
    }),
    clips = new RepositoryClip({
      sql
    });
  for (let index = 0; index < 1000; index++) {
    await sources.snapshot_save('source', 'https://example.com/feed', [], 0, 'offline');
    await sources.snapshot_adaptive('source', 600);
    await clips.failure('clip', 'offline', 'current');
  }
  assert.equal(writes, 3);
  await sources.snapshot_save('source', 'https://example.com/old', [], 0, 'old feed');
  await clips.failure('clip', 'old config', 'previous');
  assert.equal(writes, 3);
  const snapshot = await new RepositoryDiscoverySource(store).snapshot_get('source');
  assert.equal(snapshot.articles_json, '[{"title":"previous"}]');
  assert.equal(snapshot.saved_at, 123);
  assert.equal(snapshot.adaptive_interval, 600);
  await sources.snapshot_save('source', 'https://example.com/feed', [], 0, 'new failure');
  await clips.failure('clip', 'new failure', 'current');
  assert.equal(writes, 5);
});
async function fixture(t) {
  const store = snapshot_store();
  t.after(async () => await store.db.close());
  const devices = new RepositoryDevice(store),
    calls = new RepositoryCall(store);
  await devices.upsert_connection({
    device_id: "device",
    connection_id: "connection",
    methods_json: '["test"]',
    device_name: "Device",
    device_os: "test",
    max_concurrency: 1,
    connected_at: 1_000_000,
    last_seen_at: 1_000_000
  });
  const socket = {
    state: {
      device_id: "device",
      connection_id: "connection",
      methods: ["test"]
    },
    sent: [],
    deserializeAttachment() {
      return structuredClone(this.state);
    },
    serializeAttachment(value) {
      this.state = structuredClone(value);
    },
    send(value) {
      this.sent.push(JSON.parse(value));
    }
  };
  const ports = {
    sockets: {
      get_all: () => [socket]
    },
    route_cache: {
      stats: () => ({})
    }
  };
  const service = () => {
    const result = new ServiceDevice({
      repo: {
        devices,
        calls
      },
      ports,
      app: {}
    });
    result.record_device_log = async () => {};
    return result;
  };
  return {
    ...store,
    devices,
    calls,
    socket,
    ports,
    service
  };
}
test("设备活动按五分钟持久化，服务重建和 WebSocket 附件恢复仍保留实时活跃时间", async t => {
  const f = await fixture(t);
  let now = 1_020_000;
  t.mock.method(Date, "now", () => now);
  for (let index = 0; index < 14; index++, now += 20_000) {
    await f.service().webSocketMessage(f.socket, '{"type":"client.heartbeat"}');
    assert.equal((await f.service().summary()).devices[0].last_seen_at, now);
    assert.equal((await f.devices.find("device")).last_seen_at, 1_000_000);
  }
  await f.service().webSocketMessage(f.socket, '{"type":"client.heartbeat"}');
  assert.equal((await f.devices.find("device")).last_seen_at, 1_300_000);
  assert.equal(f.socket.sent.length, 15);
  assert.ok(f.socket.sent.every(message => message.type === "client.heartbeat.ack"));
  // 已存在的旧连接没有新附件字段时仍使用数据库时间。
  delete f.socket.state.last_seen_at;
  assert.equal((await f.service().summary()).devices[0].last_seen_at, now);
});
test("检查点写入失败后重试，离线恢复及时落库，旧连接和重复关闭不能覆盖新状态", async t => {
  const f = await fixture(t);
  const original_exec = f.devices.sql.exec;
  let fail = true;
  f.devices.sql = {
    exec(query, ...args) {
      if (fail && query.includes("UPDATE devices")) throw new Error("storage unavailable");
      return original_exec(query, ...args);
    }
  };
  let now = 1_300_000;
  t.mock.method(Date, "now", () => now);
  await assert.rejects(f.service().webSocketMessage(f.socket, '{"type":"client.heartbeat"}'), /storage unavailable/);
  fail = false;
  await f.service().webSocketMessage(f.socket, '{"type":"client.heartbeat"}');
  assert.equal((await f.devices.find("device")).last_seen_at, now);
  await f.devices.set_offline("device", "connection", ++now);
  await f.devices.set_offline("device", "connection", now + 1);
  assert.equal((await f.devices.find("device")).disconnected_at, now);
  await f.service().webSocketMessage(f.socket, '{"type":"client.heartbeat"}');
  assert.equal((await f.devices.find("device")).status, "online");
  assert.equal((await f.devices.find("device")).disconnected_at, null);
  f.sql.exec("UPDATE devices SET connection_id = 'replacement' WHERE device_id = 'device'");
  await f.devices.set_seen("device", "connection", now + 600_000);
  await f.devices.set_offline("device", "connection", now + 600_000);
  await f.devices.set_stale_offline("device", "connection", now + 600_000);
  assert.equal((await f.devices.find("device")).last_seen_at, now);
  assert.equal((await f.devices.find("device")).status, "online");
  f.socket.state.last_seen_at = now + 600_000;
  f.socket.state.connection_id = "replacement";
  f.ports.sockets.get_all = () => [];
  const summary = (await f.service().summary()).devices[0];
  assert.equal(summary.status, "offline");
  assert.equal(summary.last_seen_at, now);
});
test("任务重复确认只续租，心跳即时持久化，错误设备或租约不能修改任务", async t => {
  const f = await fixture(t);
  let now = 2_000_000;
  t.mock.method(Date, "now", () => now);
  await f.calls.insert({
    id: "task",
    method: "test",
    publisher_device_id: "publisher",
    access_token_id: null,
    credit_cost: 0,
    target_device_id: "device",
    idempotency_key: null,
    coalesce_key: null,
    args_json: "{}",
    created_at: 1,
    updated_at: 1
  });
  await f.calls.assign("task", "device", "lease", now - 1000, 2);
  let transitions = 0,
    renewals = 0;
  const repo = {
    calls: {
      find: async id => await f.calls.find(id),
      async set_running(...args) {
        transitions++;
        await f.calls.set_running(...args);
      },
      async set_heartbeat(...args) {
        renewals++;
        await f.calls.set_heartbeat(...args);
      }
    }
  };
  const service = new ServiceTask({
    repo,
    ports: {
      schedule_alarm: async () => {}
    },
    storage: f.storage,
    app: {
      devices: {
        record_device_log() {}
      }
    }
  });
  const message = {
    type: "task.accept",
    task_id: "task",
    lease_token: "lease"
  };
  await service.accept_task(f.socket, f.socket.state, message);
  await service.accept_task(f.socket, f.socket.state, message);
  assert.equal(transitions, 1);
  assert.equal(renewals, 1);
  assert.equal((await f.calls.find("task")).lease_expires_at, CallModel.lease_deadline(now));
  now += 20_000;
  await service.heartbeat_task(f.socket, f.socket.state, {
    ...message,
    type: "task.heartbeat"
  });
  assert.equal(renewals, 2);
  assert.equal((await f.calls.find("task")).lease_expires_at, CallModel.lease_deadline(now));
  assert.equal((await f.calls.find("task")).updated_at, now);
  await service.accept_task(f.socket, {
    device_id: "other"
  }, message);
  await service.heartbeat_task(f.socket, f.socket.state, {
    ...message,
    lease_token: "wrong"
  });
  assert.equal(f.socket.sent.at(-1).type, "task.rejected");
  assert.equal(transitions, 1);
  assert.equal(renewals, 2);
  assert.deepEqual((await f.calls.count_by_status()).map(row => ({
    ...row
  })), [{
    status: "running",
    count: 1
  }]);
});
