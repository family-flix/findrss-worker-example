import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { WorkersLogs, emit_worker_log } from "../server/infra/workers_logs.js";
import { WORKERS_LOG_RETENTION_MILLISECONDS } from "../server/lib/constants.js";
import { RepositoryWorkersLogs } from "../server/repository/workers_logs.js";
import { snapshot_store } from "./support/snapshot_store.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const { ServiceScript } = await import("../server/service/durable_object/scripts.js");
const { ServiceDevice } = await import("../server/service/durable_object/devices.js");

const env = { CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CLOUDFLARE_WORKER_NAME: "test-worker", CLOUDFLARE_API_TOKEN: "private-test-token" };
const script = (now, fields = {}) => ({ route: "script", status: "error", phase: "runtime", level: "error", message: "failed",
  path: "/test", params_json: "{}", query_json: "{}", lines_json: "[]", created_at: now, ...fields });
const device = (now, fields = {}) => ({ device_id: "device", category: "heartbeat", level: "info", message: "heartbeat", metadata_json: "{}", created_at: now, ...fields });

function fixture(t) {
  const storage = snapshot_store(), events = [], requests = [];
  let now = Date.now();
  for (const level of ["log", "info", "error", "warn", "debug"]) t.mock.method(console, level, value => {
    if (value?.log_version === 1) events.push({ source: structuredClone(value), timestamp: now,
      $metadata: { id: "event-" + events.length, service: env.CLOUDFLARE_WORKER_NAME } });
  });
  const telemetry = new WorkersLogs(env, { fetch: async (url, options) => {
    const query = JSON.parse(options.body); requests.push({ url, options, query });
    const matching = events.toReversed().filter(event => event.timestamp >= query.timeframe.from && event.timestamp <= query.timeframe.to
      && query.parameters.filters.every(({ key, operation, value }) => {
        const actual = key === "$metadata.service" ? event.$metadata.service : event.source[key];
        return operation === "eq" ? actual === value : operation === "lt" ? actual < value : actual > value;
      }));
    const offset = query.offset ? matching.findIndex(event => event.$metadata.id === query.offset) + 1 : 0;
    return Response.json({ success: true, result: { run: { status: "COMPLETED" }, events: { events: matching.slice(offset, offset + query.limit) } } });
  } });
  const options = { telemetry, object_store: storage.object_store, clock: () => now };
  const logs = new RepositoryWorkersLogs(options);
  t.after(() => storage.db.close());
  return { ...storage, logs, telemetry, options, requests, events, get now() { return now; }, advance(ms) { now += ms; } };
}
async function append(logs, kind, fields) { const row = await logs.insert(kind, fields); emit_worker_log(kind, row); return row; }

test("日志正文只输出到 Workers Logs，一万条编号共用状态预留；重建后编号不重复且查询不读旧 SQL", async t => {
  const f = fixture(t), saved = [];
  for (let i = 0; i < 120; i++) saved.push(await append(f.logs, "device", device(f.now, { message: String(i) })));
  assert.equal(f.bucket.calls.put, 1);
  assert.deepEqual([...f.bucket.objects.keys()], ["logs/workers/state.json"]);
  assert.doesNotMatch(await f.object_store.get_text("logs/workers/state.json"), /heartbeat|metadata_json|message/);
  assert.equal(f.sql.exec("SELECT COUNT(*) AS n FROM device_logs").toArray()[0].n, 0);
  assert.equal(f.sql.exec("SELECT COUNT(*) AS n FROM script_logs").toArray()[0].n, 0);
  const restarted = new RepositoryWorkersLogs(f.options);
  const latest = await append(restarted, "device", device(f.now, { category: "call", message: "new" }));
  assert.ok(latest.id > saved.at(-1).id);
  restarted.recent = [];
  const first = await restarted.devices.list_logs("device", "", null, 10);
  assert.deepEqual(first.map(row => row.message), ["new", "119", "118", "117", "116", "115", "114", "113", "112", "111"]);
  assert.equal((await restarted.devices.list_logs("device", "", first.at(-1).id, 10))[0].message, "110");
  assert.deepEqual((await restarted.devices.list_logs("device", "call", null, 10)).map(row => row.id), [latest.id]);
  const { url, options, query } = f.requests[0];
  assert.match(url, /api\.cloudflare\.com\/client\/v4\/accounts\/[a-f0-9]+\/workers\/observability\/telemetry\/query$/);
  assert.equal(options.headers.Authorization, "Bearer " + env.CLOUDFLARE_API_TOKEN);
  assert.equal(options.redirect, "error"); assert.ok(options.signal instanceof AbortSignal);
  assert.equal(query.dry, true); assert.equal(query.view, "events");
  assert.equal(query.timeframe.to - query.timeframe.from, WORKERS_LOG_RETENTION_MILLISECONDS);
  assert.equal(query.parameters.filters[0].value, env.CLOUDFLARE_WORKER_NAME);
  assert.ok(f.requests.some(request => request.query.offset), "同毫秒的事件跨页不能遗漏");
});

test("同毫秒返回乱序日志仍按业务 ID 分页，短期缓存合并去重并补齐索引延迟", async t => {
  const f = fixture(t), rows = [];
  for (let i = 0; i < 120; i++) rows.push(await append(f.logs, "script", script(f.now, { route: i % 2 ? "a" : "b" })));
  f.logs.recent = [];
  f.events.reverse();
  assert.deepEqual((await f.logs.scripts.list_errors(null, 10)).map(row => row.id), rows.slice(-10).toReversed().map(row => row.id));
  const fresh = await append(f.logs, "script", script(f.now, { message: "indexing" }));
  f.events.pop();
  assert.equal((await f.logs.scripts.list_errors(null, 10))[0].id, fresh.id);
  f.advance(120001);
  assert.ok((await f.logs.scripts.list_errors(null, 10)).every(row => row.id !== fresh.id));
});

test("删除和已读边界持久化，未来错误与其它设备不受影响，保存失败仍能重试", async t => {
  const f = fixture(t);
  await append(f.logs, "script", script(f.now, { message: "old" }));
  const read = await append(f.logs, "script", script(f.now, { message: "read" }));
  await append(f.logs, "script", script(f.now, { status: "ok" }));
  await f.logs.scripts.delete_errors_through(Number.MAX_SAFE_INTEGER);
  const future = await append(f.logs, "script", script(f.now, { route: "another" }));
  assert.deepEqual((await f.logs.scripts.list_errors(null, 10)).map(row => row.id), [future.id]);
  assert.equal((await f.logs.scripts.list_by_route("script", null, 10)).length, 1);
  await append(f.logs, "device", device(f.now, { device_id: "__proto__" }));
  const other = await append(f.logs, "device", device(f.now));
  await f.logs.devices.delete_logs_for("__proto__");
  const restarted = new RepositoryWorkersLogs(f.options);
  assert.deepEqual(await restarted.devices.list_logs("__proto__", "", null, 10), []);
  assert.deepEqual((await restarted.devices.list_logs("device", "", null, 10)).map(row => row.id), [other.id]);
  await restarted.scripts.delete_for_route("another");
  assert.deepEqual(await restarted.scripts.list_errors(null, 10), []);
  const next = await append(restarted, "script", script(f.now, { route: "another" }));
  f.bucket.fail_next({ op: "put" });
  await assert.rejects(restarted.scripts.delete_errors_through(next.id), /put failed/);
  assert.deepEqual((await restarted.scripts.list_errors(null, 10)).map(row => row.id), [next.id]);
  await restarted.scripts.delete_errors_through(next.id);
  assert.deepEqual(await restarted.scripts.list_errors(null, 10), []);
  assert.ok(read.id < next.id);
});

test("设备心跳不等待查询，完整错误立即通知与发送 Webhook；状态存储失败仍输出日志及发送业务通知", async t => {
  const f = fixture(t), hooks = [], notifications = [], sent = [], pending = [];
  const scripts = new ServiceScript({ repo: { script_logs: f.logs.scripts }, ports: { wait_until: value => pending.push(value) },
    app: { webhook_settings: { settings: () => ({ url: "https://notify.example" }), push_message: value => hooks.push(value) } } });
  scripts.message_listeners.add(event => notifications.push(event));
  await scripts.record_log({ status: "error", route: "script", message: "bad", error_text: "stack\n at script-source.js:3:4", query: { token: "secret" }, lines: [{ text: "full log" }] });
  assert.equal(f.requests.length, 0);
  assert.equal(hooks[0].error_text, "stack\n at script-source.js:3:4");
  assert.equal(hooks[0].query.token, "[redacted]");
  assert.equal(hooks[0].lines[0].text, "full log");
  assert.equal(f.events[0].source.query_json, '{"token":"[redacted]"}');
  const devices = new ServiceDevice({ repo: { devices: { ...f.logs.devices, set_seen() {} } }, ports: { wait_until: value => pending.push(value) }, app: {} });
  await devices.webSocketMessage({ deserializeAttachment: () => ({ device_id: "device", connection_id: "connection" }), serializeAttachment() {}, send: message => sent.push(JSON.parse(message)) }, '{"type":"client.heartbeat"}');
  await Promise.all(pending);
  assert.equal(sent[0].type, "client.heartbeat.ack");
  assert.equal(f.requests.length, 0);
  f.logs.next_id = f.logs.reserved_id;
  f.bucket.fail_next({ op: "put" });
  await scripts.record_log({ status: "error", message: "state unavailable" });
  assert.equal(f.events.at(-1).source.message, "state unavailable");
  assert.equal(hooks.length, 2); assert.equal(notifications.length, 2);
});

test("新启用日志时先删除再重用设备标识，也不会隐藏随后产生的第一条日志", async t => {
  const f = fixture(t);
  await f.logs.devices.delete_logs_for("device");
  const marker = f.logs.state.deleted.device.device;
  const row = await append(f.logs, "device", device(f.now));
  assert.ok(row.id > marker);
  const restarted = new RepositoryWorkersLogs(f.options);
  assert.deepEqual((await restarted.devices.list_logs("device", "", null, 10)).map(row => row.id), [row.id]);
});

test("日志正文按 UTF-8 限制大小，保留字段与有效 JSON，超大参数先脱敏再截断", async t => {
  const f = fixture(t);
  const scripts = new ServiceScript({ repo: { script_logs: f.logs.scripts }, ports: {}, app: {} });
  const large = "🙂".repeat(30000);
  await scripts.record_log({ status: "error", params: { value: large, password: "private" }, query: { value: large }, lines: [{ text: large }] });
  const source = f.events[0].source;
  assert.ok(new TextEncoder().encode(JSON.stringify(source)).length < 256 * 1024);
  assert.doesNotMatch(JSON.stringify(source), /private/);
  for (const key of ["params_json", "query_json", "lines_json"]) assert.doesNotThrow(() => JSON.parse(source[key]));
  const escaped = "\\".repeat(50000);
  await scripts.record_log({ status: "error", params: { value: escaped }, query: { value: escaped }, lines: [{ text: escaped }] });
  assert.ok(new TextEncoder().encode(JSON.stringify(f.events[1].source)).length < 256 * 1024, "转义字符不能导致截断循环不收敛");
});

test("缺少配置、无权限、限流、超时及无效响应不会暴露令牌，后台返回明确的 503", async t => {
  const f = fixture(t);
  const query = { filters: [], from: 1, to: 2, limit: 10 };
  await assert.rejects(new WorkersLogs({}).query(query), /日志查询未配置/);
  for (const status of [401, 403, 429, 500]) {
    const client = new WorkersLogs(env, { fetch: async () => new Response(env.CLOUDFLARE_API_TOKEN, { status }) });
    await assert.rejects(client.query(query), error => !error.message.includes(env.CLOUDFLARE_API_TOKEN)
      && (status === 401 || status === 403 ? error.message.includes("Workers Observability Write") : error.message.includes(String(status))));
  }
  const network = new WorkersLogs(env, { fetch: async () => { throw new Error(env.CLOUDFLARE_API_TOKEN); } });
  await assert.rejects(network.query(query), /连接失败或超时/);
  for (const response of [new Response("{"), Response.json(null), Response.json({ success: false }), Response.json({ success: true, result: { run: { status: "STARTED" } } })]) {
    await assert.rejects(new WorkersLogs(env, { fetch: async () => response }).query(query), /无效|尚未完成/);
  }
  f.telemetry.query = async () => { throw new Error("查询权限不足"); };
  const service = new ServiceScript({ repo: { script_logs: f.logs.scripts }, ports: {}, app: {} });
  await assert.rejects(service.list_messages(new URL("https://internal/messages")), error => error.status === 503 && error.message === "查询权限不足");
  await assert.rejects(service.list_script_logs(new URL("https://internal/logs?route=script")), error => error.status === 503);
});

test("大日志不会撑满 DO 内存，淘汰缓存后仍能从官方查询读取；只显示本 Worker 的保留期内记录", async t => {
  const f = fixture(t);
  for (let i = 0; i < 25; i++) await append(f.logs, "script", script(f.now, { query_json: JSON.stringify({ value: "x".repeat(100000) }) }));
  assert.ok(f.logs.recent.length < 25);
  assert.equal((await f.logs.scripts.list_errors(null, 100)).length, 25);
  await append(f.logs, "script", script(f.now - 4 * 86400000, { message: "expired" }));
  f.events.push({ ...f.events[0], source: { ...f.events[0].source, log_id: Number.MAX_SAFE_INTEGER }, $metadata: { id: "foreign", service: "another-worker" } });
  f.logs.recent = [];
  assert.equal((await f.logs.scripts.list_errors(null, 100)).length, 25);
});

test("错误或循环分页游标明确报错，损坏状态不会覆盖或回退写入旧日志", async t => {
  const f = fixture(t);
  f.telemetry.query = async () => Array.from({ length: 100 }, () => ({ source: {}, timestamp: f.now, $metadata: { id: "same" } }));
  await assert.rejects(f.logs.scripts.list_errors(null, 10), /无效游标/);
  await f.object_store.put("logs/workers/state.json", "{}");
  const restarted = new RepositoryWorkersLogs(f.options);
  await assert.rejects(restarted.scripts.insert(script(f.now)), /状态格式错误/);
  assert.equal(await f.object_store.get_text("logs/workers/state.json"), "{}");
});
