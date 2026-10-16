import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { snapshot_store } from "./support/snapshot_store.js";
import { RepositoryAccessToken } from "../server/repository/access_token.js";
import { RepositoryCredit } from "../server/repository/credit.js";
import { RepositoryDiscoverySource } from "../server/repository/discovery_source.js";
import { ServiceCredit } from "../server/service/durable_object/credits.js";
import { ServiceDiscovery } from "../server/service/durable_object/discovery.js";
import { RssRouteCache } from "../server/infra/rss_cache.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const { ServiceScript } = await import("../server/service/durable_object/scripts.js");

async function fixture(t, fields = {}) {
  const store = snapshot_store();
  t.after(() => store.db.close());
  const row = { route: "paid", enabled: 1, path: "/paid/:id", metadata_json: JSON.stringify({ kind: "rss", path: "/paid/:id" }),
    script: `export const route = { path: "/paid/:id", async handler(ctx) {
      await ctx.invoke("count", {});
      return Result.Ok({ title: "付费源", items: [] });
    } };` };
  const repo = { discovery: new RepositoryDiscoverySource(store), access_tokens: new RepositoryAccessToken(store),
    credit: new RepositoryCredit(store), rss_route_cache: store.repo, scripts: { list: () => [row], list_enabled: () => [row] } };
  repo.access_tokens.insert({ id: "reader-token", user_id: "reader", name: "Reader", token_hash: "hash", token_hint: "hint",
    expires_at: null, created_at: 1, credit_balance: 20, total_credits_granted: 20 });
  const jobs = [], invocations = [];
  const ports = { route_cache: new RssRouteCache(60000, 100, { store: store.repo }), wait_until: task => jobs.push(task) };
  const app = { credit: new ServiceCredit({ repo, storage: store.storage }) };
  app.scripts = new ServiceScript({ repo, ports, app });
  app.scripts.record_log = () => {};
  app.scripts.script_invoke = async token => { invocations.push(token); return 1; };
  app.discovery = new ServiceDiscovery({ repo, route_cache: ports.route_cache });
  const write = (body, method = "POST") => new Request("https://internal/_admin/discovery/sources", { method, body: JSON.stringify(body) });
  const created = await app.discovery.create_discovery_source(write({ title: "付费源", feed_url: "{{hostname}}/rss/paid/1", require_token: true, ...fields }));
  const id = created.data.source.id;
  const serve = (format = "rss", query = "", token = "reader-token", admin = false) => app.scripts.serve_rss_route(format, "/paid/1",
    new Request("https://internal/" + (admin ? "_admin" : "_public") + "/feed/" + format + "/paid/1" + query,
      { headers: { "X-Api-Access-Token-ID": token } }));
  const balance = () => repo.access_tokens.find("reader-token").credit_balance;
  const ledger = () => store.sql.exec("SELECT * FROM credit_transactions ORDER BY created_at, id").toArray();
  const patch = body => app.discovery.update_discovery_source(write(body, "PATCH"), id);
  return { ...store, repo, app, row, id, serve, jobs, invocations, balance, ledger, patch, write };
}

test("私密源按实际配置对每次 RSS/Atom 缓存访问扣费，生成与设备调用不重复扣费，修改即时生效", async t => {
  const f = await fixture(t, { credit_cost: 3 });
  assert.equal(f.repo.discovery.find(f.id).credit_cost, 3);
  await assert.rejects(f.serve(), { status: 503 });
  await Promise.all(f.jobs);
  assert.equal(f.balance(), 20);
  assert.deepEqual(f.invocations, [""]);
  for (const [format, expected] of [["rss", 17], ["atom", 14], ["rss", 11]]) {
    const result = await f.serve(format);
    assert.match(result.body, /付费源/);
    assert.equal(result.headers["X-Api-Credit-Balance"], String(expected));
    assert.equal(f.balance(), expected);
  }
  assert.deepEqual(f.ledger().map(row => row.amount), [-3, -3, -3]);
  assert.ok(f.ledger().every(row => row.task_id === null && row.subject === "付费源"));
  await f.patch({ title: "改名" });
  assert.equal(f.repo.discovery.find(f.id).credit_cost, 3);
  await f.patch({ credit_cost: 5 });
  await f.serve();
  assert.equal(f.balance(), 6);
  assert.equal(f.repo.access_tokens.find("reader-token").total_credits_used, 14);
});

test("旧源缺省消耗 1，零积分仍需 token，公开和管理预览免费", async t => {
  const f = await fixture(t);
  assert.equal(f.repo.discovery.find(f.id).credit_cost, 1);
  await f.serve("rss", "", "", true);
  assert.equal(f.balance(), 20);
  await f.serve();
  assert.equal(f.balance(), 19);
  await f.patch({ credit_cost: 0 });
  await assert.rejects(f.serve("rss", "", ""), { status: 401 });
  await f.serve();
  assert.equal(f.balance(), 19);
  assert.equal(f.ledger().length, 1);
  await f.patch({ require_token: false, credit_cost: 9 });
  await f.serve("rss", "", "", true);
  await f.serve();
  assert.equal(f.balance(), 19);
});

test("缓存命中余额不足返回 402，过期与撤销返回 401，账本写入失败回滚余额", async t => {
  const f = await fixture(t, { credit_cost: 21 });
  await f.serve("rss", "", "", true);
  await assert.rejects(f.serve(), error => error.status === 402 && error.details.required === 21 && error.details.balance === 20);
  assert.equal(f.balance(), 20);
  assert.equal(f.ledger().length, 0);
  await f.patch({ credit_cost: 2 });
  f.sql.exec("UPDATE access_tokens SET expires_at = 1");
  await assert.rejects(f.serve(), { status: 401 });
  f.sql.exec("UPDATE access_tokens SET expires_at = NULL, revoked_at = 1");
  await assert.rejects(f.serve(), { status: 401 });
  f.sql.exec("UPDATE access_tokens SET revoked_at = NULL");
  t.mock.method(f.repo.credit, "insert", () => { throw new Error("ledger unavailable"); });
  await assert.rejects(f.serve(), /ledger unavailable/);
  assert.equal(f.balance(), 20);
  assert.equal(f.repo.access_tokens.find("reader-token").total_credits_used, 0);
});

test("同路径不同 query 按源计价，RSS/Atom 和 query 顺序不影响匹配", async t => {
  const f = await fixture(t, { credit_cost: 3, feed_url: "{{hostname}}/rss/paid/1?a=1&b=2" });
  await f.app.discovery.create_discovery_source(f.write({ title: "另一源", feed_url: "{{hostname}}/atom/paid/1?a=2&b=1", require_token: true, credit_cost: 7 }));
  for (const query of ["?b=2&a=1", "?b=1&a=2"]) await f.serve("atom", query, "", true);
  await f.serve("rss", "?b=2&a=1");
  assert.equal(f.balance(), 17);
  await f.serve("atom", "?b=1&a=2");
  assert.equal(f.balance(), 10);
});

test("并发访问逐次扣费且不透支，脚本失败不扣访问积分", async t => {
  const f = await fixture(t, { credit_cost: 6 });
  await f.serve("rss", "", "", true);
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => f.serve()));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 3);
  assert.ok(results.filter(result => result.status === "rejected").every(result => result.reason.status === 402));
  assert.equal(f.balance(), 2);
  assert.equal(f.ledger().length, 3);
  f.row.script = 'export const route = { path: "/paid/:id", async handler() { throw new Error("failed"); } };';
  await f.patch({ feed_url: "{{hostname}}/rss/paid/1?new=1" });
  await assert.rejects(f.serve("rss", "?new=1", "", true), { status: 502 });
  assert.equal(f.balance(), 2);
});

test("直接执行与其缓存命中也按每次访问扣费，余额错误保持 402", async t => {
  const f = await fixture(t, { credit_cost: 8 });
  for (const expected of [12, 4]) {
    const result = await f.serve("raw");
    assert.equal(result.raw.title, "付费源");
    assert.equal(result.headers["X-Api-Credit-Balance"], String(expected));
    assert.equal(result.headers["Cache-Control"], "private, no-cache");
  }
  assert.deepEqual(f.invocations, [""]);
  await assert.rejects(f.serve("raw"), { status: 402 });
  assert.equal(f.balance(), 4);
});
