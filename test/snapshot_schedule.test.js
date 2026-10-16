import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { snapshot_store } from "./support/snapshot_store.js";
import { RepositoryDiscoverySource } from "../server/repository/discovery_source.js";
import { RepositoryAccessToken } from "../server/repository/access_token.js";
import { RepositoryCredit } from "../server/repository/credit.js";
import { ServiceCredit } from "../server/service/durable_object/credits.js";
import { RepositorySnapshotSettings } from "../server/repository/snapshot_settings.js";
import { ServiceDiscovery } from "../server/service/durable_object/discovery.js";
import { ServiceSnapshotSettings } from "../server/service/durable_object/snapshot_settings.js";
import { DiscoverySourceModel } from "../server/domain/discovery_source.js";
import { parse_poll_policy, next_policy_at, learn_poll_interval } from "../server/lib/poll_schedule.js";
import { snapshot_next_at } from "../server/lib/snapshot_schedule.js";
import { RssRouteCache, rss_route_cache_key } from "../server/infra/rss_cache.js";
import { load_discovery_snapshot } from "../server/infra/discovery_snapshot.js";
import { RSS_ROUTE_CACHE_TTL_MS } from "../server/lib/constants.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const { ServiceScript } = await import("../server/service/durable_object/scripts.js");
const { route } = await import("../durable_object_router.js");
const { default: api } = await import("../api.js");
const at = value => Date.parse(value);
const interval = minutes => ({ mode: "interval", interval: minutes * 60, timezone: "Asia/Shanghai" });

function fixture(t) {
  const store = snapshot_store();
  t.after(() => store.db.close());
  const repo = { discovery: new RepositoryDiscoverySource(store), rss_route_cache: store.repo };
  const settings = new ServiceSnapshotSettings({ repo: new RepositorySnapshotSettings(store), schedule_alarm: async () => {} });
  const calls = [];
  let fail = false, articles = [{ title: "第一篇", link: "https://example.com/1" }];
  const service = new ServiceDiscovery({ repo, snapshot_settings: () => settings.settings(), schedule_alarm: async () => {},
    load_snapshot: async source => { calls.push(source.id); if (fail) throw new Error("离线"); return articles; } });
  function add(id, policy, fields = {}) {
    repo.discovery.insert({ id, title: id, description: "", website: "", feed_url: "https://example.com/" + id,
      category: "", tags_json: "[]", enabled: 1, require_token: 0, sort_order: 0, source_type: "website",
      created_at: at("2026-10-16T00:00:00Z"), updated_at: at("2026-10-16T00:00:00Z"),
      poll_policy_json: JSON.stringify(policy || { mode: "inherit" }), ...fields });
  }
  return { ...store, repo, settings, service, calls, add, fail: () => { fail = true; }, articles: value => { articles = value; } };
}

test("默认一小时；默认规则保存重建后继承，单源覆盖与仅手动优先", async t => {
  const now = at("2026-10-16T01:00:00Z"); t.mock.method(Date, "now", () => now);
  const f = fixture(t);
  assert.deepEqual(f.settings.settings().policy, interval(60));
  f.add("inherit"); f.add("own", interval(5)); f.add("manual", { mode: "manual" });
  await f.settings.save_settings({ policy: interval(30) });
  const restarted = new ServiceSnapshotSettings({ repo: new RepositorySnapshotSettings(f) });
  assert.deepEqual(restarted.settings().policy, interval(30));
  assert.equal(f.service.scheduled_at(f.repo.discovery.find("inherit")), now + 30 * 60000);
  assert.equal(f.service.scheduled_at(f.repo.discovery.find("own")), 0);
  assert.equal(f.service.scheduled_at(f.repo.discovery.find("manual")), null);
  await f.service.refresh_due_snapshots();
  assert.deepEqual(f.calls, ["own"]);
  await f.service.refresh_discovery_snapshot("manual");
  assert.deepEqual(f.calls, ["own", "manual"]);
  assert.equal(f.service.scheduled_at(f.repo.discovery.find("manual")), null);
  for (const policy of [{ mode: "inherit" }, interval(1), { mode: "times", times: [] }, { mode: "cron", cron: "bad" }]) {
    await assert.rejects(f.settings.save_settings({ policy }), error => error.status === 400);
  }
  assert.deepEqual(restarted.settings().policy, interval(30));
});

test("每天、多时间点、星期与 Cron 按指定时区计算，跨午夜时段尊重开始日", () => {
  const now = at("2026-10-16T00:00:00Z"); // 周五北京时间 08:00
  assert.equal(next_policy_at(parse_poll_policy({ mode: "times", times: ["09:00", "18:00"], days: [1,2,3,4,5] }), now), at("2026-10-16T01:00:00Z"));
  assert.equal(next_policy_at(parse_poll_policy({ mode: "cron", cron: "0 8 * * 1-5" }), now), at("2026-10-19T00:00:00Z"));
  assert.equal(next_policy_at(parse_poll_policy({ mode: "times", timezone: "UTC", times: ["09:00"] }), now), at("2026-10-16T09:00:00Z"));
  const policy = parse_poll_policy({ mode: "windows", timezone: "UTC", windows: [{ days: [5], start: "22:00", end: "02:00", interval: 600 }], outside_interval: 0 });
  assert.equal(next_policy_at(policy, at("2026-10-16T21:00:00Z")), at("2026-10-16T22:00:00Z"));
  assert.equal(next_policy_at(policy, at("2026-10-17T01:55:00Z")), at("2026-10-23T22:00:00Z"));
  const daily = parse_poll_policy({ mode: "times", times: ["08:30"] });
  assert.equal(next_policy_at(daily, now), at("2026-10-16T00:30:00Z"));
  assert.equal(next_policy_at(daily, at("2026-10-16T00:30:00Z")), at("2026-10-17T00:30:00Z"));
  const dst = parse_poll_policy({ mode: "times", timezone: "America/New_York", times: ["02:30"] });
  assert.equal(next_policy_at(dst, at("2026-03-08T05:00:00Z")), at("2026-03-09T06:30:00Z"));
});

test("规则校验拒绝无效时间、时区、重叠时段，PATCH 保留规则并可恢复继承", () => {
  for (const policy of [{ mode: "times", times: ["25:00"] }, { ...interval(10), timezone: "No/Zone" },
    { mode: "adaptive", min_interval: 3600, max_interval: 300 },
    { mode: "windows", windows: [{ days: [1], start: "23:00", end: "02:00", interval: 600 }, { days: [2], start: "01:00", end: "03:00", interval: 600 }] }]) {
    assert.throws(() => parse_poll_policy(policy));
  }
  const current = DiscoverySourceModel({ title: "源", feed_url: "https://example.com/feed", poll_policy: interval(30) });
  assert.deepEqual(DiscoverySourceModel.validate(DiscoverySourceModel.merge_for_patch(current, { title: "新名称" })).model.poll_policy, interval(30));
  assert.equal(DiscoverySourceModel.validate(DiscoverySourceModel.merge_for_patch(current, { poll_policy: { mode: "inherit" } })).model.poll_policy.mode, "inherit");
  assert.equal(DiscoverySourceModel.validate({ title: "源", feed_url: "https://example.com/feed", poll_policy: null }).ok, false);
});

test("分批抓取到期源，失败保留文章并推迟到下一轮，重建调度状态仍正确", async t => {
  let now = at("2026-10-16T01:00:00Z"); t.mock.method(Date, "now", () => now);
  const f = fixture(t);
  for (let i = 0; i < 6; i++) f.add("source-" + i, interval(5));
  f.add("disabled", interval(5), { enabled: 0 }); f.add("private", interval(5), { require_token: 1 });
  await f.service.refresh_due_snapshots(); assert.equal(f.calls.length, 4);
  await f.service.refresh_due_snapshots(); assert.equal(f.calls.length, 6);
  await f.service.refresh_due_snapshots(); assert.equal(f.calls.length, 6);
  now += 300000; f.fail();
  await f.service.refresh_due_snapshots();
  const saved = f.repo.discovery.snapshot_get("source-0");
  assert.match(saved.error, /离线/); assert.equal(JSON.parse(saved.articles_json)[0].title, "第一篇");
  const restarted = new ServiceDiscovery({ repo: f.repo, snapshot_settings: () => f.settings.settings() });
  const row = f.repo.discovery.snapshot_schedule().find(source => source.id === "source-0");
  assert.equal(restarted.scheduled_at(row), now + 300000);
});

test("智能刷新从文章变化学习间隔，手动和首次抓取不改变学习结果", async t => {
  let now = at("2026-10-16T01:00:00Z"); t.mock.method(Date, "now", () => now);
  const f = fixture(t);
  const policy = { mode: "adaptive", min_interval: 300, max_interval: 1800, timezone: "UTC" };
  f.add("adaptive", policy);
  await f.service.refresh_due_snapshots(); assert.equal(f.repo.discovery.snapshot_get("adaptive").adaptive_interval, 300);
  now += 300000;
  await f.service.refresh_due_snapshots(); assert.equal(f.repo.discovery.snapshot_get("adaptive").adaptive_interval, 450);
  f.articles([{ title: "第二篇", link: "https://example.com/2" }]); now += 450000;
  await f.service.refresh_due_snapshots(); assert.equal(f.repo.discovery.snapshot_get("adaptive").adaptive_interval, 338);
  await f.service.refresh_discovery_snapshot("adaptive"); assert.equal(f.repo.discovery.snapshot_get("adaptive").adaptive_interval, 338);
  assert.equal(learn_poll_interval(policy, 1800, { failed: true }), 1800);
});

test("已登记源由单源规则调度，RSS/Atom 与 query 顺序归一；仅手动不被旧调度绕过", async t => {
  const f = fixture(t);
  f.add("manual", { mode: "manual" }, { feed_url: "{{hostname}}/atom/demo?a=1&b=2" });
  const query = new URLSearchParams("b=2&a=1");
  const key = "public-snapshot:" + rss_route_cache_key("/demo", query);
  f.repo.rss_route_cache.register_public(key, "/demo", query, "https://feeds.example/rss/demo", 100);
  const script = new ServiceScript({ repo: f.repo, ports: { schedule_alarm: async () => {} }, app: { discovery: f.service } });
  assert.equal(script.next_snapshot_at(), null);
  await script.refresh_due_snapshots(); assert.deepEqual(f.calls, []);
  assert.equal(snapshot_next_at({ enabled: 1, require_token: 0, poll_policy: { mode: "manual" } }), null);
});

test("默认规则 API 要求管理员身份，保存校验错误返回 400 且不覆盖原规则", async t => {
  const f = fixture(t), app = { snapshot_settings: f.settings };
  const env = { ADMIN_PASSWORD: "test-password", API: { getByName: () => ({ fetch: request => route(request, app) }) } };
  const url = "https://feeds.example/admin/api/settings/snapshots";
  assert.equal((await api.fetch(new Request(url), env)).status, 401);
  const headers = { Authorization: "Bearer test-password", "Content-Type": "application/json" };
  const saved = await api.fetch(new Request(url, { method: "PUT", headers, body: JSON.stringify({ policy: interval(30) }) }), env);
  assert.equal(saved.status, 200); assert.deepEqual((await saved.json()).policy, interval(30));
  const bad = await api.fetch(new Request(url, { method: "PUT", headers, body: '{"policy":{"mode":"cron","cron":"bad"}}' }), env);
  assert.equal(bad.status, 400);
  const read = await api.fetch(new Request(url, { headers }), env);
  assert.deepEqual((await read.json()).policy, interval(30));
  assert.equal((await route(new Request("https://internal/_admin/settings/snapshots", { method: "PUT", body: "bad" }), app)).status, 400);
});

test("新增定时源从创建时刻开始安排，不补抓该源创建前的历史时刻", () => {
  const now = at("2026-10-16T00:00:00Z");
  const policy = parse_poll_policy({ mode: "times", times: ["18:00"] });
  const row = { enabled: 1, require_token: 0, created_at: now, poll_policy: { mode: "inherit" } };
  assert.equal(snapshot_next_at(row, { policy, updated_at: now - 86400000 }, now), at("2026-10-16T10:00:00Z"));
  assert.equal(snapshot_next_at(row, { policy: interval(30), updated_at: now - 86400000 }, now), 0);
});

test("新增和编辑订阅源持久化规则，修改其他字段保留规则与调度起点", async t => {
  let now = at("2026-10-16T01:00:00Z"); t.mock.method(Date, "now", () => now);
  const f = fixture(t);
  const request = body => new Request("https://internal/", { method: "POST", body: JSON.stringify(body) });
  const created = await f.service.create_discovery_source(request({ title: "源", feed_url: "https://example.com/feed", poll_policy: interval(30) }));
  const id = created.data.source.id;
  assert.deepEqual(DiscoverySourceModel.fromRow(f.repo.discovery.find(id)).poll_policy, interval(30));
  now += 1000;
  await f.service.update_discovery_source(request({ poll_policy: { mode: "manual" } }), id);
  const manual = f.repo.discovery.find(id);
  assert.equal(f.service.scheduled_at(manual), null); assert.equal(manual.poll_updated_at, now);
  now += 1000;
  await f.service.update_discovery_source(request({ title: "新标题" }), id);
  const renamed = f.repo.discovery.find(id);
  assert.equal(renamed.poll_updated_at, manual.poll_updated_at);
  assert.equal(DiscoverySourceModel.fromRow(renamed).poll_policy.mode, "manual");
});

test("私密自有源按规则自动抓取，手动模式及外部私密源不自动抓取，重启恢复下一次时间", async t => {
  let now = at("2026-10-16T01:00:00Z"); t.mock.method(Date, "now", () => now);
  const f = fixture(t);
  f.add("private", interval(60), { require_token: 1, feed_url: "{{hostname}}/rss/private" });
  f.add("manual", { mode: "manual" }, { require_token: 1, feed_url: "{{hostname}}/atom/manual" });
  f.add("external", interval(5), { require_token: 1 });
  await f.service.refresh_due_snapshots(); assert.deepEqual(f.calls, ["private"]);
  const saved = f.repo.discovery.snapshot_get("private");
  assert.equal(saved.articles_json, "[]"); assert.match(saved.poll_fingerprint, /^[0-9a-f]{64}$/);
  const public_catalog = f.service.public_catalog();
  assert.ok(public_catalog.sources.every(source => source.snapshot.articles.length === 0));
  assert.doesNotMatch(JSON.stringify(public_catalog), /第一篇|https:\/\/example.com\/1|poll_fingerprint/);
  const restarted = new ServiceDiscovery({ repo: f.repo });
  const row = f.repo.discovery.snapshot_schedule().find(source => source.id === "private");
  assert.equal(restarted.scheduled_at(row), now + 3600000);
  await f.service.refresh_due_snapshots(); assert.equal(f.calls.length, 1);
  now += 3600000; f.fail();
  await f.service.refresh_due_snapshots(); assert.equal(f.calls.length, 2);
  const failed = f.repo.discovery.snapshot_get("private");
  assert.equal(failed.saved_at, saved.saved_at); assert.match(failed.error, /离线/);
  assert.equal(f.service.scheduled_sources().find(source => source.id === "private").next_at, now + 3600000);
});

test("私密智能刷新根据指纹学习，不存文章预览；编辑私密源保留状态", async t => {
  let now = at("2026-10-16T01:00:00Z"); t.mock.method(Date, "now", () => now);
  const f = fixture(t);
  f.add("private", { mode: "adaptive", min_interval: 300, max_interval: 1800 }, { require_token: 1, feed_url: "{{hostname}}/rss/private" });
  await f.service.refresh_due_snapshots();
  now += 300000; await f.service.refresh_due_snapshots();
  assert.equal(f.repo.discovery.snapshot_get("private").adaptive_interval, 450);
  f.articles([{ title: "第二篇私密文章", link: "https://example.com/2" }]);
  now += 450000; await f.service.refresh_due_snapshots();
  assert.equal(f.repo.discovery.snapshot_get("private").adaptive_interval, 338);
  assert.equal(f.repo.discovery.snapshot_get("private").articles_json, "[]");
  f.repo.scripts = { list: () => [{ route: "private", path: "/private", metadata_json: JSON.stringify({ path: "/private" }), kind: "rss", enabled: 1 }] };
  const previous = f.repo.discovery.snapshot_get("private");
  await f.service.update_discovery_source(new Request("https://internal/", { method: "POST", body: '{"title":"新名称"}' }), "private");
  assert.deepEqual(f.repo.discovery.snapshot_get("private"), previous);
});

test("真实私密脚本自动生成 RSS/Atom；鉴权后只读，过期清理与重建后保留 XML，失败不泄露文章", async t => {
  let now = at("2026-10-16T01:00:00Z"); t.mock.method(Date, "now", () => now);
  const f = fixture(t);
  f.add("private", interval(60), { require_token: 1, feed_url: "{{hostname}}/rss/private/1?a=1&b=2" });
  const row = { route: "private", path: "/private/:id", enabled: 1, script: `export const route = {
    path: "/private/:id", async handler(ctx) {
      const result = await ctx.invoke("count", {});
      if (result.error) return result;
      return Result.Ok({ title: "私密版本" + result.data, items: [{ title: "私密文章", link: "https://example.com/secret" }] });
    }
  };`, metadata_json: JSON.stringify({ path: "/private/:id", name: "私密" }) };
  f.repo.scripts = { list_enabled: () => [row] };
  f.repo.access_tokens = new RepositoryAccessToken(f);
  f.repo.credit = new RepositoryCredit(f);
  f.repo.access_tokens.insert({ id: "user-token-id", user_id: "reader", name: "Reader", token_hash: "hash", token_hint: "hint",
    expires_at: null, created_at: 1, credit_balance: 10, total_credits_granted: 10 });
  const ports = { route_cache: new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, 100, { store: f.repo.rss_route_cache }), schedule_alarm: async () => {} };
  const script = new ServiceScript({ repo: f.repo, ports, app: { discovery: f.service,
    credit: new ServiceCredit({ repo: f.repo, storage: f.storage }) }, public_origin: "https://feeds.example" });
  let executions = 0, fail = false;
  script.record_log = () => {};
  script.script_invoke = async () => { if (fail) throw new Error("offline"); return ++executions; };
  f.service.load_snapshot = (source, origin) => load_discovery_snapshot(source, "https://feeds.example", (...args) => script.serve_rss_route(...args));
  const serve = (token = "", format = "rss") => script.serve_rss_route(format, "/private/1", new Request(
    "https://internal/_public/feed/" + format + "/private/1?b=2&a=1", { headers: { "X-Api-Access-Token-ID": token } }));
  await assert.rejects(serve(), { status: 401 });
  await assert.rejects(serve("user-token-id"), { status: 503 });
  await Promise.all([f.service.refresh_due_snapshots(), ...script.xml_tasks.values()]); assert.equal(executions, 1);
  await assert.rejects(serve(), { status: 401 });
  const first = await serve("user-token-id");
  assert.match(first.body, /私密文章/); assert.equal(first.headers["Cache-Control"], "private, no-cache");
  assert.match((await serve("user-token-id", "atom")).body, /私密文章/); assert.equal(executions, 1);
  now += RSS_ROUTE_CACHE_TTL_MS + 1;
  f.repo.rss_route_cache.delete_expired(now);
  ports.route_cache = new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, 100, { store: f.repo.rss_route_cache });
  assert.equal((await serve("user-token-id")).body, first.body); assert.equal(executions, 1);
  now += 3600000; fail = true;
  await f.service.refresh_due_snapshots();
  assert.match(f.repo.discovery.snapshot_get("private").error, /offline/);
  assert.equal((await serve("user-token-id")).body, first.body);
  await assert.rejects(serve(), { status: 401 });
  assert.doesNotMatch(JSON.stringify(f.service.public_catalog()), /私密文章|example.com\/secret/);
});
