import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { snapshot_store } from "./support/snapshot_store.js";
import { RssRouteCache, rss_route_cache_key } from "../server/infra/rss_cache.js";
import { RSS_ROUTE_CACHE_TTL_MS } from "../server/lib/constants.js";
import { ServiceCredit } from "../server/service/durable_object/credits.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const { ServiceScript } = await import("../server/service/durable_object/scripts.js");

function fixture(public_source = true) {
  const store = snapshot_store();
  const jobs = [];
  let calls = 0, fail = false, scheduled = 0;
  const row = { route: "snapshot", path: "/snapshot/:id", enabled: 1,
    script: `export const route = { path: "/snapshot/:id", async handler(ctx) {
      const result = await ctx.invoke("count", {});
      if (result.error) return result;
      return Result.Ok({ title: "版本" + result.data, items: [] });
    } };`, metadata_json: JSON.stringify({ path: "/snapshot/:id", name: "快照" }) };
  const ports = { route_cache: new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, 100, { store: store.repo }),
    schedule_alarm: async () => { scheduled++; }, wait_until: task => jobs.push(task) };
  const repo = { rss_route_cache: store.repo, scripts: { list_enabled: () => row.enabled ? [row] : [] },
    discovery: { list_public_routes: () => public_source ? [{ feed_url: "https://feeds.example.com/rss/snapshot/1", enabled: 1 }] : [],
      list_private_routes: () => public_source ? [] : [{ feed_url: "https://feeds.example.com/rss/snapshot/1" }] },
  };
  const token = { credit_balance: 1000 };
  repo.access_tokens = { find: () => token, set_balance_used: (_id, balance) => { token.credit_balance = balance; } };
  repo.credit = { insert() {} };
  const service = new ServiceScript({ repo, ports, app: { credit: new ServiceCredit({ repo, storage: store.storage }) }, public_origin: "https://feeds.example.com" });
  service.record_log = () => {};
  service.script_invoke = async () => { calls++; if (fail) throw new Error("offline"); return calls; };
  const request = (format = "rss", { token = "", admin = false, query = "" } = {}) => new Request(
    "https://internal/" + (admin ? "_admin" : "_public") + "/feed/" + format + "/snapshot/1" + query,
    { headers: { "X-Api-Access-Token-ID": token, "X-Feed-Public-URL": "https://alias.example.com/" + format + "/snapshot/1" + query } });
  const serve = (format = "rss", options, refresh = false) => service.serve_rss_route(format, "/snapshot/1", request(format, options), { refresh });
  return { ...store, service, ports, row, serve, jobs, wait_for_xml: () => Promise.all(jobs),
    get calls() { return calls; }, get scheduled() { return scheduled; },
    set_public(value) { public_source = value; }, fail(value = true) { fail = value; } };
}

test("首次访问返回正在生成并启动后台任务，生成后只读 XML，重建 DO 后仍复用", async () => {
  const f = fixture();
  await assert.rejects(f.serve(), error => error.status === 503 && error.headers["Retry-After"] === "5");
  assert.equal(f.jobs.length, 1); assert.equal(f.scheduled, 1);
  await f.wait_for_xml();
  assert.equal(f.calls, 1);
  for (const format of ["rss", "atom"]) {
    const result = await f.serve(format);
    assert.match(result.body, /版本1/); assert.equal(result.headers["X-Api-RSS-Cache"], "hit");
    assert.ok(result.body.includes("https://feeds.example.com/" + format + "/snapshot/1"));
  }
  f.ports.route_cache = new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, 100, { store: f.repo });
  assert.match((await f.serve()).body, /版本1/); assert.equal(f.calls, 1);
  f.db.close();
});

for (const public_source of [true, false]) test(`${public_source ? "公开" : "私密"}源并发首次访问只创建一个生成任务，RSS/Atom 和乱序 query 共用任务`, async t => {
  const f = fixture(public_source); t.after(() => f.db.close());
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const invoked = new Promise(resolve => { started = resolve; });
  const invoke = f.service.script_invoke;
  t.mock.method(f.service, "script_invoke", async (...args) => {
    const value = await invoke(...args); started(); await gate; return value;
  });
  if (!public_source) {
    await assert.rejects(f.serve(), { status: 401 }); assert.equal(f.jobs.length, 0);
  }
  const responses = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => f.serve(
    index % 2 ? "rss" : "atom", { token: public_source ? "" : "user-" + index,
      query: index % 2 ? "?a=1&b=2" : "?b=2&a=1" })));
  assert.ok(responses.every(result => result.status === "rejected" && result.reason.status === 503
    && result.reason.details.code === "FEED_GENERATING" && /正在生成/.test(result.reason.message)
    && result.reason.headers["Retry-After"] === "5"));
  await invoked;
  assert.equal(f.calls, 1); assert.equal(f.jobs.length, 1); assert.equal(f.service.xml_tasks.size, 1);
  await assert.rejects(f.serve("rss", { token: "valid-user", query: "?a=1&b=2" }), { status: 503 });
  assert.equal(f.jobs.length, 1);
  let scheduled = Promise.resolve();
  if (public_source) {
    f.sql.exec("UPDATE rss_public_feeds SET attempted_at = 0");
    scheduled = f.service.refresh_due_snapshots();
  }
  release(); await Promise.all([f.wait_for_xml(), scheduled]);
  assert.equal(f.service.xml_tasks.size, 0);
  for (const format of ["rss", "atom"]) {
    assert.match((await f.serve(format, { token: "valid-user", query: "?a=1&b=2" })).body, /版本1/);
  }
  assert.equal(f.calls, 1); assert.equal(f.jobs.length, 1);
});

test("首次生成失败释放任务，下次访问可重新生成，凭证和不存在的路由不创建任务", async t => {
  const f = fixture(false); t.after(() => f.db.close());
  f.fail();
  await assert.rejects(f.serve(), { status: 401 }); assert.equal(f.jobs.length, 0);
  f.row.enabled = 0; f.service.enabled_routes = null;
  await assert.rejects(f.serve("rss", { token: "user" }), { status: 404 }); assert.equal(f.jobs.length, 0);
  f.row.enabled = 1; f.service.enabled_routes = null;
  await assert.rejects(f.serve("rss", { token: "user" }), { status: 503 });
  await f.wait_for_xml();
  assert.equal(f.service.xml_tasks.size, 0); assert.equal(f.calls, 1);
  f.fail(false);
  await assert.rejects(f.serve("rss", { token: "user" }), { status: 503 });
  await f.wait_for_xml();
  assert.equal(f.jobs.length, 2); assert.equal(f.calls, 2);
  assert.match((await f.serve("rss", { token: "user" })).body, /版本2/);
});

test("旧版 XML 的过期字段不影响读取，后台失败保留 XML；新的参数在后台生成", async () => {
  const f = fixture();
  await f.serve("rss", {}, true);
  const key = "public-snapshot:" + rss_route_cache_key("/snapshot/1", []);
  f.sql.exec("UPDATE rss_route_cache SET expires_at = 1");
  f.sql.exec("UPDATE rss_public_feeds SET attempted_at = 0");
  f.repo.delete_expired(Date.now());
  f.ports.route_cache = new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, 100, { store: f.repo });
  assert.equal(f.repo.read(key).expires_at, 1);
  assert.match((await f.serve()).body, /版本1/); assert.equal(f.calls, 1);
  await assert.rejects(f.serve("atom", { query: "?page=2" }), { status: 503 });
  await f.wait_for_xml();
  await f.service.refresh_due_snapshots();
  assert.match((await f.serve("rss", { query: "?page=2" })).body, /版本/);
  const body = (await f.serve()).body;
  f.fail(); f.sql.exec("UPDATE rss_public_feeds SET attempted_at = 0");
  await f.service.refresh_due_snapshots();
  assert.equal((await f.serve()).body, body);
  f.db.close();
});

test("私密订阅请求只读，XML 无过期时间，重启及清理后 RSS/Atom 仍读取同一份内容", async t => {
  let now = Date.now(); t.mock.method(Date, "now", () => now);
  const f = fixture(false);
  await assert.rejects(f.serve(), { status: 401 }); assert.equal(f.calls, 0);
  const options = { token: "user-token-id" };
  await assert.rejects(f.serve("rss", options), { status: 503 });
  await f.wait_for_xml();
  const results = await Promise.all([f.serve("rss", options), f.serve("atom", options)]);
  assert.equal(f.calls, 1); assert.ok(results.every(result => result.body.includes("版本1")));
  assert.equal(results[0].headers["Cache-Control"], "private, no-cache");
  now += 365 * 86400000;
  f.repo.delete_expired(now);
  f.ports.route_cache = new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, 100, { store: f.repo });
  assert.match((await f.serve("rss", options)).body, /版本1/); assert.equal(f.calls, 1);
  const key = "private-snapshot:" + rss_route_cache_key("/snapshot/1", []);
  const state = f.ports.route_cache.inspect(key, now);
  assert.equal(state.status, "fresh"); assert.equal("expires_at" in state, false);
  assert.equal(state.saved_at, now - 365 * 86400000); assert.equal(state.persistent, true);
  assert.equal(f.repo.read(key).expires_at, 0);
  assert.match((await f.serve("atom", options)).body, /版本1/); assert.equal(f.calls, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS count FROM rss_public_feeds").get().count, 0);
  f.db.close();
});

test("管理员强制刷新替换 XML，失败保留旧 XML；私密产物不发布到公开源", async () => {
  const f = fixture(false);
  await f.serve("rss", { admin: true }, true);
  assert.match((await f.serve("rss", { admin: true }, true)).body, /版本2/);
  assert.match((await f.serve("atom", { token: "user-token-id" })).body, /版本2/);
  f.fail();
  await assert.rejects(f.serve("rss", { admin: true }, true), { status: 502 });
  assert.match((await f.serve("rss", { token: "user-token-id" })).body, /版本2/);
  f.set_public(true);
  await assert.rejects(f.serve(), { status: 503 });
  await f.wait_for_xml();
  f.db.close();
});

test("public 声明不绕过目录私密设置；转私密后后台任务撤下，匿名不能读旧 XML", async () => {
  const f = fixture();
  await f.serve("rss", {}, true);
  f.set_public(false);
  f.row.metadata_json = JSON.stringify({ path: "/snapshot/:id", public: true });
  f.service.enabled_routes = null;
  await assert.rejects(f.serve(), { status: 401 });
  f.sql.exec("UPDATE rss_public_feeds SET attempted_at = 0");
  await f.service.refresh_due_snapshots();
  assert.equal(f.db.prepare("SELECT COUNT(*) AS count FROM rss_public_feeds").get().count, 0);
  assert.ok(f.repo.read("public-snapshot:" + rss_route_cache_key("/snapshot/1", [])));
  f.db.close();
});

test("兼容旧版公开及私密 XML，抓取时间在刷新后准确保存，临时缓存淘汰不删除 XML", async t => {
  let now = Date.now(); t.mock.method(Date, "now", () => now);
  const { db, repo } = snapshot_store(); t.after(() => db.close());
  const saved_at = now - 86400000;
  for (const prefix of ["public-snapshot:", "private-snapshot:"]) {
    repo.write({ key: prefix + "old", output_json: "{}", invoked: 0,
      expires_at: saved_at + RSS_ROUTE_CACHE_TTL_MS, created_at: saved_at, rendered: [["rss\n", "old XML"]] });
  }
  repo.delete_expired(now);
  const cache = new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, 1, { store: repo });
  for (const prefix of ["public-snapshot:", "private-snapshot:"]) {
    assert.equal(cache.inspect(prefix + "old").saved_at, saved_at);
    assert.equal(cache.resolve(prefix + "old", now).rendered.get("rss\n"), "old XML");
    await cache.run(prefix + "old", now, async () => ({ output: "{}", invoked: false,
      rendered: new Map([["rss\n", "new XML"]]) }), { force: true });
    assert.equal(repo.read(prefix + "old").saved_at, now);
  }
  for (const key of ["temporary-a", "temporary-b"]) {
    now++;
    await cache.run(key, now, async () => ({ output: key, invoked: false }));
  }
  assert.equal(repo.count(), 1);
  for (const prefix of ["public-snapshot:", "private-snapshot:"]) {
    assert.equal(cache.resolve(prefix + "old", now).rendered.get("rss\n"), "new XML");
  }
});

test("15:44 生成的 XML 在 15:54 Cookie 同步、清理和重启后仍可读取", async t => {
  let now = Date.parse("2026-10-16T15:44:00+08:00");
  t.mock.method(Date, "now", () => now);
  const f = fixture(); t.after(() => f.db.close());
  await f.serve("rss", {}, true);
  const key = "public-snapshot:" + rss_route_cache_key("/snapshot/1", []);
  const saved_at = now;
  f.service.repo.rss_cookies = { put() {} };
  f.service.app.cookie_push_settings = { decrypt: async body => body };
  now += RSS_ROUTE_CACHE_TTL_MS;
  await f.service.update_rss_cookies(new Request("https://internal/cookies", {
    method: "PUT", body: JSON.stringify([{ domain: ".kuaishou.com", name: "sid", value: "updated" }]),
  }));
  f.repo.delete_expired(now);
  f.ports.route_cache = new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, 100, { store: f.repo });
  const state = f.ports.route_cache.inspect(key, now);
  assert.equal(state.status, "fresh");
  assert.equal(state.saved_at, saved_at);
  assert.equal(state.persistent, true);
  for (const format of ["rss", "atom"]) assert.match((await f.serve(format)).body, /版本1/);
  assert.equal(f.calls, 1);
});

test("大 XML 分块持久化，超过 L1 预算仍可返回；删除与清理不会留下分块", async () => {
  const { db, repo } = snapshot_store();
  const cache = new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, 100, { store: repo, max_bytes: 1 });
  const xml = "🐈快照".repeat(100000);
  const result = await cache.run("private-snapshot:large", Date.now(), async () => ({ output: "{}", invoked: false,
    rendered: new Map([["rss\n", xml], ["atom\n", xml]]) }));
  assert.equal(result.rendered.get("rss\n"), xml); assert.equal(cache.stats().entries, 0);
  cache.invalidate_all();
  const rebuilt = new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, 100, { store: repo });
  assert.equal(rebuilt.resolve("private-snapshot:large", Date.now()).rendered.get("atom\n"), xml);
  assert.ok(db.prepare("SELECT COUNT(*) AS count FROM rss_route_cache_chunks").get().count > 1);
  repo.delete_expired(Date.now() + RSS_ROUTE_CACHE_TTL_MS);
  assert.equal(rebuilt.resolve("private-snapshot:large", Date.now() + RSS_ROUTE_CACHE_TTL_MS).rendered.get("rss\n"), xml);
  repo.delete_oldest(0);
  assert.ok(repo.read("private-snapshot:large"));
  repo.delete("private-snapshot:large");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM rss_route_cache_chunks").get().count, 0);
  db.close();
});

test("定时登记有界，任意请求头不能强制刷新；query token 不进入 XML", async () => {
  const f = fixture(false);
  const input = new Request("https://internal/_public/feed/rss/snapshot/1?token=secret", {
    headers: { "X-Api-Access-Token-ID": "test-user", "X-FindRSS-Force-Refresh": "1" },
  });
  await assert.rejects(f.service.serve_rss_route("rss", "/snapshot/1", input), { status: 503 });
  await f.wait_for_xml();
  const first = await f.service.serve_rss_route("rss", "/snapshot/1", input);
  const second = await f.service.serve_rss_route("rss", "/snapshot/1", input);
  assert.equal(first.body, second.body); assert.equal(f.calls, 1);
  assert.doesNotMatch(first.body, /secret|token=/);
  assert.equal(f.repo.register_public("first", "/first", [], "", 1), true);
  assert.equal(f.repo.register_public("second", "/second", [], "", 1), false);
  assert.equal(f.repo.register_public("first", "/first", [], "", 1), true);
  f.db.close();
});
