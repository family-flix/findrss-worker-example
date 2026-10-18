import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../server/durable_object.js", import.meta.url), "utf8");
const methods = vm.runInNewContext("(class {" + source.slice(source.indexOf("  async alarm()"), source.lastIndexOf("\n}")) + "})", {
  CallModel: { MAX_ATTEMPTS: 3 },
  console: { warn() {} },
}).prototype;

for (const stage of ["cleanup", "dispatch", "statistics"]) {
  test(`${stage} 失败仍执行订阅源抓取并安排下一次 alarm`, async () => {
    const failure = new Error(stage + " failed");
    const calls = [], pending = [];
    const fail = name => { if (stage === name) throw failure; };
    const object = {
      maintain_alarm: methods.maintain_alarm,
      repo: { calls: { list_expired_leases: () => [], sweep_expired() {} } },
      ctx: { waitUntil: promise => pending.push(promise) },
      app: {
        scripts: { prune_script_objects: async () => {}, refresh_due_snapshots: async () => { calls.push("xml"); } },
        devices: { close_unauthorized_connections() {} },
        maintenance: { prune_retention() { fail("cleanup"); }, prune_events() {} },
        tasks: { async dispatch_pending() { fail("dispatch"); } },
        statistics: { refresh_snapshot() { fail("statistics"); } },
        discovery: {
          refresh_due_snapshots: async () => { calls.push("discovery"); },
          ensure_catalog: async () => {},
        },
      },
      schedule_alarm: async () => { calls.push("schedule"); },
    };
    await methods.alarm.call(object).catch(error => assert.equal(error, failure));
    await Promise.all(pending);
    assert.ok(calls.includes("discovery"));
    assert.ok(calls.includes("xml"));
    assert.ok(calls.includes("schedule"));
  });
}

test("抓取入口同步抛错不阻止其他抓取及重新安排 alarm", async () => {
  const calls = [], pending = [];
  const object = {
    maintain_alarm: methods.maintain_alarm,
    repo: { calls: { list_expired_leases: () => [], sweep_expired() {} } },
    ctx: { waitUntil: promise => pending.push(promise) },
    app: {
      scripts: { prune_script_objects: async () => {}, refresh_due_snapshots: async () => { calls.push("xml"); } },
      devices: { close_unauthorized_connections() {} },
      maintenance: { prune_retention() {}, prune_events() {} },
      tasks: { async dispatch_pending() {} },
      statistics: { refresh_snapshot() {} },
      discovery: { refresh_due_snapshots() { throw new Error("schedule failed"); }, ensure_catalog: async () => {} },
    },
    schedule_alarm: async () => { calls.push("schedule"); },
  };
  await methods.alarm.call(object);
  await Promise.all(pending);
  assert.deepEqual(calls, ["xml", "schedule"]);
});

function request_fixture() {
  let now = 1000, scheduled = 0, catalog = 0, discovery = 0, xml = 0, fail = false;
  const pending = [];
  const fetch = vm.runInNewContext("({" + source.match(/  async fetch\(request\) \{[\s\S]*?\n  \}/)[0] + "}).fetch", {
    route: () => "ok", URL, Date: { now: () => now }, console: { warn() {} },
  });
  const object = {
    discovery_alarm_started: false, discovery_alarm_checked_at: 0,
    app: { discovery: { ensure_catalog: async () => { catalog++; }, refresh_due_snapshots: async () => { discovery++; } },
      scripts: { refresh_due_snapshots: async () => { xml++; } } },
    ctx: { waitUntil: promise => pending.push(promise) },
    async schedule_alarm() { scheduled++; if (fail) throw new Error("storage unavailable"); },
  };
  return {
    object, set_now: value => { now = value; }, set_fail: value => { fail = value; },
    get scheduled() { return scheduled; }, get catalog() { return catalog; },
    get discovery() { return discovery; }, get xml() { return xml; },
    async request() {
      assert.equal(await fetch.call(object, new Request("https://internal/_admin/background-tasks")), "ok");
      await Promise.all(pending.splice(0));
    },
  };
}

test("普通列表请求每分钟重新检查调度，恢复丢失的 alarm 且不重复初始化目录", async () => {
  const f = request_fixture();
  await f.request(); assert.equal(f.scheduled, 1); assert.equal(f.catalog, 1);
  await f.request(); assert.equal(f.scheduled, 1);
  f.set_now(61000);
  await f.request(); assert.equal(f.scheduled, 2); assert.equal(f.catalog, 1);
});

test("普通请求每分钟兜底启动到期抓取，不依赖 alarm 真正唤醒且不重复触发", async () => {
  const f = request_fixture();
  await f.request();
  assert.equal(f.discovery, 1); assert.equal(f.xml, 1);
  await f.request();
  assert.equal(f.discovery, 1); assert.equal(f.xml, 1);
  f.set_now(61000);
  await f.request();
  assert.equal(f.discovery, 2); assert.equal(f.xml, 2);
  assert.equal(f.catalog, 1);
});

test("兜底抓取入口失败不影响 API 响应、其他抓取和后续恢复", async () => {
  const f = request_fixture();
  f.object.app.discovery.refresh_due_snapshots = () => { throw new Error("抓取入口异常"); };
  await f.request();
  assert.equal(f.xml, 1);
  assert.equal(f.scheduled, 1);
  f.object.app.discovery.refresh_due_snapshots = async () => {};
  f.set_now(61000);
  await f.request();
  assert.equal(f.xml, 2);
});

test("滞留超过一分钟的过期 alarm 重新登记，未来和刚到期的 alarm 不被推迟", async () => {
  const now = Date.now(), writes = [];
  let current = now - 120000;
  const object = {
    repo: { calls: { min_lease_expires_at: () => null }, device_tokens: { min_expires_at: () => null } },
    app: { discovery: { next_snapshot_at: () => now + 5000 }, scripts: { next_snapshot_at: () => null },
      statistics: { next_snapshot_at: () => now + 3600000 } },
    ctx: { storage: { getAlarm: async () => current, setAlarm: async value => { writes.push(value); current = value; } } },
  };
  // 只执行真实 schedule_alarm；补齐其常量依赖，不运行 Cloudflare DO 壳。
  const schedule = vm.runInNewContext("({" + source.slice(source.lastIndexOf("  async schedule_alarm()"), source.lastIndexOf("\n}")) + "}).schedule_alarm",
    { Date: { now: () => now }, MAINTENANCE_MILLISECONDS: 86400000 });
  await schedule.call(object);
  assert.deepEqual(writes, [now + 5000]);
  current = now + 3000;
  await schedule.call(object);
  current = now - 1000;
  await schedule.call(object);
  assert.equal(writes.length, 1);
});

test("首次安排 alarm 失败后，下次请求能够重试", async () => {
  const f = request_fixture(); f.set_fail(true);
  await f.request(); assert.equal(f.scheduled, 1); assert.equal(f.object.discovery_alarm_started, false);
  f.set_fail(false);
  await f.request(); assert.equal(f.scheduled, 2); assert.equal(f.object.discovery_alarm_started, true);
});
