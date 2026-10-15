import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { RepositoryDiscoverySource } from "../server/repository/discovery_source.js";
import { API_SCHEMA_SQL } from "../server/repository/schema.js";
import { ServiceDiscovery } from "../server/service/durable_object/discovery.js";

function fixture() {
  const calls = [];
  const row = { id: "old", category: "technology", tags_json: '["文章","科技"]', enabled: 1, source_type: "zhihu" };
  const repo = { discovery: {
    list(filters) { calls.push(filters); return [row]; },
    list_tags() { return [row, { tags_json: '["博客"]' }, { tags_json: "broken" }]; },
    find_enabled() { return row; },
    list_related(...args) { calls.push(args); return []; },
  } };
  return { service: new ServiceDiscovery({ repo }), calls };
}

test("平台、多个精确标签与关键词一起查询，标签目录不受结果筛选影响", () => {
  const { service, calls } = fixture();
  const result = service.list_discovery_sources(new URL("https://api/discovery/sources?source_type=zhihu&q=日报&tag=科技&tag=文章&tag=科技"), false);
  assert.deepEqual(calls[0], { include_disabled: false, category: "", source_type: "zhihu", query: "日报", tags: ["科技", "文章"] });
  assert.deepEqual(result.sources[0].tags, ["文章", "科技"]);
  assert.deepEqual(result.tags, ["文章", "科技", "博客"]);
  service.list_discovery_sources(new URL("https://api/discovery/sources"), false);
  assert.deepEqual(calls[1].tags, []);
  service.get_public_discovery_source("old");
  assert.deepEqual(calls[2], ["old", "zhihu", 12]);
});

test("非法平台、换行和超限标签在查询前拒绝", () => {
  const { service, calls } = fixture();
  for (const query of ["source_type=other", "tag=bad%0Atag", "tag=" + "a".repeat(33), Array.from({ length: 14 }, (_, i) => "tag=t" + i).join("&")]) {
    assert.throws(() => service.list_discovery_sources(new URL("https://api/discovery/sources?" + query), false), { status: 400 });
  }
  assert.equal(calls.length, 0);
});

test("标签查询使用 JSON 精确值和 AND；参数绑定，旧分类可匹配标签", () => {
  let statement, parameters;
  const repository = new RepositoryDiscoverySource({ sql: { exec(sql, ...args) {
    statement = sql; parameters = args; return { toArray: () => [] };
  } } });
  repository.list({ include_disabled: false, source_type: "x", query: "100%_", tags: ["科技", 'a"b\\c'] });
  assert.match(statement, /enabled = 1 AND source_type = \? AND/);
  assert.equal((statement.match(/EXISTS \(SELECT 1 FROM json_each/g) || []).length, 2);
  assert.match(statement, /OR category = \?\) AND \(EXISTS/);
  assert.deepEqual(parameters, ["x", ...Array(5).fill("%100\\%\\_%"), "[]", "科技", "technology", 'a"b\\c', "__no_category__"]);
  assert.equal(statement.includes('a"b'), false);
  repository.list({ include_disabled: false, query: "科技" });
  assert.equal(parameters.at(-1), '["technology"]');
});

test("管理分页读取全部 1000 个源，公开目录维持既有上限和排序", () => {
  const statements = [];
  const repository = new RepositoryDiscoverySource({ sql: { exec(sql, ...args) {
    statements.push([sql, args]); return { toArray: () => [] };
  } } });
  repository.list({ include_disabled: true });
  repository.list({ include_disabled: false });
  const result = spawnSync("python3", ["-c", `import sqlite3,json,sys
schema,statements=json.load(sys.stdin)
db=sqlite3.connect(':memory:');db.executescript(schema)
for i in range(1000):
 db.execute("INSERT INTO discovery_sources(id,title,feed_url,category,created_at,updated_at) VALUES(?,?,?,?,?,?)", (str(i),str(i),'https://example.com/'+str(i),'',i,i))
admin=db.execute(*[statements[0][0],statements[0][1]]).fetchall()
public=db.execute(*[statements[1][0],statements[1][1]]).fetchall()
assert len(admin)==1000 and admin[0][0]=='999' and admin[-1][0]=='0'
assert len(public)==500
`], { input: JSON.stringify([API_SCHEMA_SQL, statements]), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("公开目录按筛选后的总数返回分页元数据，管理列表维持完整响应", () => {
  const calls = [];
  const service = new ServiceDiscovery({ repo: { discovery: {
    count_filtered(filters) { calls.push({ count: { ...filters } }); return 41; },
    list(filters) { calls.push({ list: { ...filters } }); return [{ id: "page-item", enabled: 1 }]; },
    list_tags() { return [{ tags_json: '["科技","文章","其他"]' }]; },
  } } });
  const url = new URL("https://api/discovery/sources?limit=20&offset=20&source_type=zhihu&tag=科技&tag=文章&q=日报");
  const result = service.list_discovery_sources(url, false);
  assert.equal(result.total_count, 41);
  assert.equal(result.limit, 20);
  assert.equal(result.offset, 20);
  assert.equal(result.has_more, true);
  assert.deepEqual(calls[0].count, { include_disabled: false, category: "", source_type: "zhihu", tags: ["科技", "文章"], query: "日报" });
  assert.deepEqual(calls[1].list, { ...calls[0].count, limit: 20, offset: 20 });
  assert.deepEqual(result.tags, ["科技", "文章", "其他"]);
  for (const [query, limit, offset] of [["limit=0&offset=-10", 1, 0], ["limit=1000&offset=1e20", 100, 1_000_000],
    ["limit=bad&offset=Infinity", 20, 0], ["offset=40", 20, 40]]) {
    const page = service.list_discovery_sources(new URL("https://api/discovery/sources?" + query), false);
    assert.equal(page.limit, limit);
    assert.equal(page.offset, offset);
    assert.equal(page.has_more, offset + limit < 41);
  }
  const admin = service.list_discovery_sources(url, true);
  assert.equal("total_count" in admin, false);
  assert.equal("limit" in calls.at(-1).list, false);
});

test("SQLite 公开分页可读取第 501 条之后，重复标题排序稳定且所有筛选与总数一致", () => {
  const statements = [];
  const repository = new RepositoryDiscoverySource({ sql: { exec(sql, ...args) {
    statements.push([sql, args]); return { toArray: () => [] };
  } } });
  const filters = { include_disabled: false, query: "%_", source_type: "zhihu", tags: ["科技", "文章"] };
  repository.count_filtered(filters);
  for (const offset of [0, 20, 500, 600, 1000]) repository.list({ ...filters, limit: 20, offset });
  const result = spawnSync("python3", ["-c", `import sqlite3,json,sys
schema,statements=json.load(sys.stdin)
db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row;db.executescript(schema)
for i in range(620):
 db.execute("INSERT INTO discovery_sources(id,title,feed_url,category,tags_json,enabled,source_type,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)", (str(i),'同名%_源','https://example.com/'+str(i),'',json.dumps(['科技'] if i==617 else ['科技','文章']),0 if i==619 else 1,'website' if i==618 else 'zhihu',i,i))
results=[db.execute(sql,args).fetchall() for sql,args in statements]
assert results[0][0]['count']==617
expected=sorted(str(i) for i in range(617))
for rows,offset in zip(results[1:],[0,20,500,600,1000]):
 assert [r['id'] for r in rows]==expected[offset:offset+20]
`], { input: JSON.stringify([API_SCHEMA_SQL, statements]), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
