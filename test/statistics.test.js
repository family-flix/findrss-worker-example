import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { register } from "node:module";
import { ServiceStatistics } from "../server/service/durable_object/statistics.js";
import { RepositoryStatistics } from "../server/repository/statistics.js";
import { RepositoryDiscoverySource } from "../server/repository/discovery_source.js";
import { API_SCHEMA_SQL } from "../server/repository/schema.js";
import { admin_overview } from "../server/service/worker/do_proxy.js";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { ServiceScript } = await import("../server/service/durable_object/scripts.js");
const { route } = await import("../durable_object_router.js");

function fixture() {
  const rows = [
    { id: "a", title: "源 A", feed_url: "{{hostname}}/rss/news/你好?b=2&a=1", enabled: 1, source_type: "weibo", tags_json: '["新闻","新闻"]', call_count: 2 },
    { id: "b", title: "源 B", feed_url: "https://feeds.example/atom/news/你好?a=1&b=2", enabled: 1, source_type: "weibo", tags_json: '["新闻","技术"]', call_count: 3 },
    { id: "c", title: "停用", feed_url: "{{hostname}}/rss/news/你好?a=1&b=2", enabled: 0, source_type: "website", call_count: 4 },
    { id: "d", title: "外部源", feed_url: "https://example.com/feed.xml", enabled: 1, source_type: "website", call_count: 0 },
  ];
  const script = { route: "script", path: "/news/:name", enabled: 1,
    metadata_json: JSON.stringify({ routes: [{ path: "/news/:name", platform: "微博" }, { path: "/image", platform: "自定义" }] }) };
  let reads = 0;
  const repo = {
    statistics: { sources: () => { reads++; return rows; }, scripts: () => [script, { route: "broken", metadata_json: "bad" }],
      record_calls(ids) { for (const row of rows) if (row.enabled && ids.includes(row.id)) row.call_count++; } },
    rss_cookies: { get: () => [{ value: "secret" }, { value: "another secret" }] },
  };
  return { rows, script, repo, service: new ServiceStatistics({ repo }), get reads() { return reads; } };
}

test("统计快照覆盖全部源、多个路由、去重平台和标签，不返回 Cookie 或脚本正文", () => {
  const f = fixture();
  const snapshot = f.service.snapshot();
  assert.equal(snapshot.script_count, 2);
  assert.equal(snapshot.source_count, 4);
  assert.equal(snapshot.source_call_count, 9);
  assert.equal(snapshot.cookie_count, 2);
  assert.equal(snapshot.route_count, 2);
  assert.equal(snapshot.platform_count, 3);
  assert.equal(snapshot.tag_count, 2);
  assert.equal(snapshot.sources[3].tracked, false);
  assert.equal(snapshot.sources[2].enabled, false);
  assert.ok(snapshot.generated_at > 0);
  assert.equal(JSON.stringify(snapshot).includes("secret"), false);
  assert.equal(JSON.stringify(snapshot).includes("metadata_json"), false);
  f.rows.length = 0; f.repo.statistics.scripts = () => []; f.repo.rss_cookies.get = () => [];
  const empty = f.service.snapshot();
  for (const field of ["script_count", "source_count", "source_call_count", "cookie_count", "route_count", "tag_count"]) assert.equal(empty[field], 0);
  assert.equal(empty.platform_count, 1); // 平台目录始终含默认「网站」。
});

test("调用计数共用 RSS/Atom 路由身份，归一 query 和编码，停用、未知变体不计数，源变更后重建索引", () => {
  const f = fixture();
  f.service.record_call("/news/%E4%BD%A0%E5%A5%BD", new URLSearchParams("a=1&b=2"));
  f.service.record_call("/news/你好", new URLSearchParams("b=2&a=1"));
  assert.deepEqual(f.rows.map(row => row.call_count), [4, 5, 4, 0]);
  assert.equal(f.reads, 1);
  f.service.record_call("/news/你好", new URLSearchParams("a=2&b=2"));
  f.service.record_call("/missing", new URLSearchParams());
  assert.deepEqual(f.rows.map(row => row.call_count), [4, 5, 4, 0]);
  f.rows[0].feed_url = "{{hostname}}/rss/changed";
  f.rows[1].enabled = 0;
  f.service.invalidate_sources();
  f.service.record_call("/news/你好", new URLSearchParams("a=1&b=2"));
  f.service.record_call("/changed", new URLSearchParams());
  assert.deepEqual(f.rows.map(row => row.call_count), [5, 5, 4, 0]);
  assert.equal(f.reads, 2);
});

test("真实 RSS/Atom 快照命中及暂未生成均计数，鉴权拒绝、404、调试、预览和自动刷新不计数", async () => {
  const f = fixture();
  const calls = [];
  const service = new ServiceScript({ repo: {
    scripts: { list_enabled: () => [f.script] }, rss_route_cache: { register_public: () => true },
    discovery: { list_public_routes: () => [], list_private_routes: () => [] },
  }, ports: { route_cache: { resolve: () => ({ rendered: new Map([["rss\n", "RSS"], ["atom\n", "Atom"]]) }) } },
  app: { statistics: { record_call: (...args) => calls.push(args) } } });
  service.cookie_access = async () => null;
  const request = (format, path = "/news/hello", headers = {}) => new Request("https://internal/_public/feed/" + format + path + "?token=secret&a=1", { headers });
  const authenticated = { "X-Api-Access-Token-ID": "user" };
  await assert.rejects(service.serve_rss_route("rss", "/news/hello", request("rss")), { status: 401 });
  await assert.rejects(service.serve_rss_route("rss", "/missing", request("rss", "/missing", authenticated)), { status: 404 });
  service.rss_address_is_public = () => true;
  for (const format of ["rss", "atom"]) assert.ok((await service.serve_rss_route(format, "/news/hello", request(format))).body);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1].has("token"), false);
  service.ports.route_cache.resolve = () => null;
  await assert.rejects(service.serve_rss_route("rss", "/news/hello", request("rss")), { status: 503 });
  assert.equal(calls.length, 3);
  service.ports.route_cache.run = () => { throw new Error("stop before execution"); };
  service.record_log = () => {};
  await assert.rejects(service.serve_rss_route("rss", "/news/hello", request("rss"), { refresh: true }));
  await assert.rejects(service.serve_rss_route("rss", "/news/hello", new Request("https://internal/_admin/feed/rss/news/hello")));
  await assert.rejects(service.serve_rss_route("debug", "/news/hello", request("debug")));
  assert.equal(calls.length, 3);
});

test("SQLite 计数原子递增、重建仓储不清零、全量读取不截断，删除源清理计数", () => {
  const statements = [];
  const sql = { exec(sql, ...args) { statements.push([sql, args]); return { toArray: () => [] }; } };
  const repo = new RepositoryStatistics({ sql });
  repo.record_calls(["a", "disabled"]); repo.record_calls(["a"]);
  new RepositoryStatistics({ sql }).record_calls(["a"]);
  repo.sources(); repo.scripts();
  new RepositoryDiscoverySource({ sql }).delete("a");
  const result = spawnSync("python3", ["-c", `import sqlite3,json,sys
schema,statements=json.load(sys.stdin)
db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row;db.executescript(schema);db.executescript(schema)
for i in range(1001):
 db.execute("INSERT INTO discovery_sources(id,title,feed_url,category,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",(str(i),'源','https://example.com/'+str(i),'',1,1,1))
db.execute("UPDATE discovery_sources SET id='a' WHERE id='0'")
db.execute("UPDATE discovery_sources SET id='disabled',enabled=0 WHERE id='1'")
for sql,args in statements:
 rows=[dict(row) for row in db.execute(sql,args).fetchall()]
 if sql.startswith('SELECT d.id'):
  assert len(rows)==1001 and rows[0]['id']=='a' and rows[0]['call_count']==3
  assert db.execute('SELECT COUNT(*) FROM discovery_source_calls').fetchone()[0]==1
assert db.execute('SELECT COUNT(*) FROM discovery_source_calls').fetchone()[0]==0
`], { input: JSON.stringify([API_SCHEMA_SQL, statements]), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("概览接口附带快照并展开模板，保留原字段，统计失败返回错误", async () => {
  const paths = [];
  let fail = false;
  const env = { FINDRSS_HOSTNAME: "feeds.example", API: { getByName: () => ({ fetch: async url => {
    const path = new URL(url).pathname; paths.push(path);
    if (path === "/_admin/statistics") return fail ? new Response("offline", { status: 503 })
      : Response.json({ source_count: 1, sources: [{ feed_url: "{{hostname}}/rss/news" }] });
    return Response.json(path === "/" ? { devices: [], methods: [], task_counts: [] } : { access_tokens: [] });
  } }) } };
  const overview = await (await admin_overview(env)).json();
  assert.deepEqual(paths.sort(), ["/", "/_admin/access-tokens", "/_admin/statistics"]);
  assert.deepEqual(overview.devices, []);
  assert.equal(overview.statistics.source_count, 1);
  assert.equal(overview.statistics.sources[0].feed_url, "https://feeds.example/rss/news");
  const result = await route(new Request("https://internal/_admin/statistics"), { statistics: { snapshot: () => ({ script_count: 2 }) } });
  assert.equal((await result.json()).script_count, 2);
  fail = true;
  assert.equal((await admin_overview(env)).status, 500);
});
