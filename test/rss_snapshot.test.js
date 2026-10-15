import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { snapshot_store } from "./support/snapshot_store.js";
import { RssRouteCache, rss_route_cache_key } from "../server/infra/rss_cache.js";
import { RSS_ROUTE_CACHE_TTL_MS } from "../server/lib/constants.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const { ServiceScript } = await import("../server/service/durable_object/scripts.js");

function fixture(public_source = true) {
  const store = snapshot_store();
  let calls = 0, fail = false, scheduled = 0;
  const row = { route: "snapshot", path: "/snapshot/:id", enabled: 1,
    script: `export const route = { path: "/snapshot/:id", async handler(ctx) {
      const result = await ctx.invoke("count", {});
      if (result.error) return result;
      return Result.Ok({ title: "版本" + result.data, items: [] });
    } };`, metadata_json: JSON.stringify({ path: "/snapshot/:id", name: "快照" }) };
  const ports = { route_cache: new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, 100, { store: store.repo }),
    schedule_alarm: async () => { scheduled++; } };
  const repo = { rss_route_cache: store.repo, scripts: { list_enabled: () => row.enabled ? [row] : [] },
    discovery: { list_public_routes: () => public_source ? [{ feed_url: "https://feeds.example.com/rss/snapshot/1", enabled: 1 }] : [],
      list_private_routes: () => public_source ? [] : [{ feed_url: "https://feeds.example.com/rss/snapshot/1" }] },
  };
  const service = new ServiceScript({ repo, ports, app: {}, public_origin: "https://feeds.example.com" });
  service.record_log = () => {};
  service.script_invoke = async () => { calls++; if (fail) throw new Error("offline"); return calls; };
  const request = (format = "rss", { token = "", admin = false, query = "" } = {}) => new Request(
    "https://internal/" + (admin ? "_admin" : "_public") + "/feed/" + format + "/snapshot/1" + query,
    { headers: { "X-Api-Access-Token-ID": token, "X-Feed-Public-URL": "https://alias.example.com/" + format + "/snapshot/1" + query } });
  const serve = (format = "rss", options, refresh = false) => service.serve_rss_route(format, "/snapshot/1", request(format, options), { refresh });
  return { ...store, service, ports, row, serve, get calls() { return calls; }, get scheduled() { return scheduled; },
    set_public(value) { public_source = value; }, fail() { fail = true; } };
}

test("公开请求只读 XML；未生成时返回 503，后台定时生成，重建 DO 后仍复用", async () => {
  const f = fixture();
  await assert.rejects(f.serve(), error => error.status === 503 && error.headers["Retry-After"] === "5");
  assert.equal(f.calls, 0); assert.equal(f.scheduled, 1);
  await f.service.refresh_due_snapshots();
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

test("公开快照过期与后台失败仍可读旧 XML；新的参数在后台生成", async () => {
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
  await f.service.refresh_due_snapshots();
  assert.match((await f.serve("rss", { query: "?page=2" })).body, /版本/);
  const body = (await f.serve()).body;
  f.fail(); f.sql.exec("UPDATE rss_public_feeds SET attempted_at = 0");
  await f.service.refresh_due_snapshots();
  assert.equal((await f.serve()).body, body);
  f.db.close();
});

test("私密源有效身份触发生成，同键并发和 RSS/Atom 在 10 分钟内只用一份快照", async t => {
  let now = Date.now(); t.mock.method(Date, "now", () => now);
  const f = fixture(false);
  await assert.rejects(f.serve(), { status: 401 }); assert.equal(f.calls, 0);
  const options = { token: "user-token-id" };
  const results = await Promise.all([f.serve("rss", options), f.serve("atom", options)]);
  assert.equal(f.calls, 1); assert.ok(results.every(result => result.body.includes("版本1")));
  assert.equal(results[0].headers["Cache-Control"], "private, no-cache");
  now += RSS_ROUTE_CACHE_TTL_MS - 1;
  f.ports.route_cache = new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, 100, { store: f.repo });
  assert.match((await f.serve("rss", options)).body, /版本1/); assert.equal(f.calls, 1);
  now += 1;
  assert.match((await f.serve("rss", options)).body, /版本2/); assert.equal(f.calls, 2);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS count FROM rss_public_feeds").get().count, 0);
  f.db.close();
});

test("管理员强制刷新绕过 TTL，失败保留旧快照；私密产物不发布到公开源", async () => {
  const f = fixture(false);
  await f.serve("rss", { token: "user-token-id" });
  assert.match((await f.serve("rss", { admin: true }, true)).body, /版本2/);
  assert.match((await f.serve("atom", { token: "user-token-id" })).body, /版本2/);
  f.fail();
  await assert.rejects(f.serve("rss", { admin: true }, true), { status: 502 });
  assert.match((await f.serve("rss", { token: "user-token-id" })).body, /版本2/);
  f.set_public(true);
  await assert.rejects(f.serve(), { status: 503 });
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
  f.db.close();
});

test("大 XML 分块持久化，超过 L1 预算仍可返回；删除与清理不会留下分块", async () => {
  const { db, repo } = snapshot_store();
  const cache = new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, 100, { store: repo, max_bytes: 1 });
  const xml = "🐈快照".repeat(100000);
  const result = await cache.run("private-snapshot:large", Date.now(), async () => ({ output: "{}", invoked: false,
    rendered: new Map([["rss\n", xml], ["atom\n", xml]]) }));
  assert.equal(result.rendered.get("rss\n"), xml); assert.equal(cache.stats().entries, 0);
  const rebuilt = new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, 100, { store: repo });
  assert.equal(rebuilt.resolve("private-snapshot:large", Date.now()).rendered.get("atom\n"), xml);
  assert.ok(db.prepare("SELECT COUNT(*) AS count FROM rss_route_cache_chunks").get().count > 1);
  repo.delete_expired(Date.now() + RSS_ROUTE_CACHE_TTL_MS);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM rss_route_cache_chunks").get().count, 0);
  db.close();
});

test("定时登记有界，任意请求头不能强制刷新；query token 不进入 XML", async () => {
  const f = fixture(false);
  const input = new Request("https://internal/_public/feed/rss/snapshot/1?token=secret", {
    headers: { "X-Api-Access-Token-ID": "test-user", "X-FindRSS-Force-Refresh": "1" },
  });
  const first = await f.service.serve_rss_route("rss", "/snapshot/1", input);
  const second = await f.service.serve_rss_route("rss", "/snapshot/1", input);
  assert.equal(first.body, second.body); assert.equal(f.calls, 1);
  assert.doesNotMatch(first.body, /secret|token=/);
  assert.equal(f.repo.register_public("first", "/first", [], "", 1), true);
  assert.equal(f.repo.register_public("second", "/second", [], "", 1), false);
  assert.equal(f.repo.register_public("first", "/first", [], "", 1), true);
  f.db.close();
});
