import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { RepositoryDiscoverySource } from "../server/repository/discovery_source.js";
import { API_SCHEMA_SQL } from "../server/repository/schema.js";
import { ServiceDiscovery } from "../server/service/application/discovery.js";
import { snapshot_store } from "./support/snapshot_store.js";
function fixture() {
  const calls = [];
  const row = {
    id: "old",
    category: "technology",
    tags_json: '["文章","科技"]',
    enabled: 1,
    source_type: "zhihu"
  };
  const repo = {
    tags: {
      list: () => ["文章", "科技", "博客"]
    },
    discovery: {
      list(filters) {
        calls.push(filters);
        return [row];
      },
      list_tags() {
        throw new Error("标签目录不能再从订阅源聚合");
      },
      find_enabled() {
        return row;
      },
      list_related(...args) {
        calls.push(args);
        return [];
      }
    }
  };
  return {
    service: new ServiceDiscovery({
      repo
    }),
    calls
  };
}
test("平台、多个精确标签与关键词一起查询，标签目录不受结果筛选影响", async () => {
  const {
    service,
    calls
  } = fixture();
  const result = await service.list_discovery_sources(new URL("https://api/discovery/sources?source_type=zhihu&q=日报&tag=科技&tag=文章&tag=科技"), false);
  assert.deepEqual(calls[0], {
    include_disabled: false,
    category: "",
    source_type: "zhihu",
    query: "日报",
    tags: ["科技", "文章"]
  });
  assert.deepEqual(result.sources[0].tags, ["文章", "科技"]);
  assert.deepEqual(result.tags, ["文章", "科技", "博客"]);
  await service.list_discovery_sources(new URL("https://api/discovery/sources"), false);
  assert.deepEqual(calls[1].tags, []);
  await service.get_public_discovery_source("old");
  assert.deepEqual(calls[2], ["old", "zhihu", 12]);
});
test("非法平台、换行和超限标签在查询前拒绝", async () => {
  const {
    service,
    calls
  } = fixture();
  for (const query of ["source_type=other", "tag=bad%0Atag", "tag=" + "a".repeat(33), Array.from({
    length: 14
  }, (_, i) => "tag=t" + i).join("&")]) {
    await assert.rejects(async () => await service.list_discovery_sources(new URL("https://api/discovery/sources?" + query), false), {
      status: 400
    });
  }
  assert.equal(calls.length, 0);
});
test("标签查询使用 JSON 精确值和 AND；参数绑定，旧分类可匹配标签", async () => {
  let statement, parameters;
  const repository = new RepositoryDiscoverySource({
    sql: {
      exec(sql, ...args) {
        statement = sql;
        parameters = args;
        return {
          toArray: () => []
        };
      }
    }
  });
  await repository.list({
    include_disabled: false,
    source_type: "x",
    query: "100%_",
    tags: ["科技", 'a"b\\c']
  });
  assert.match(statement, /enabled = 1 AND require_token = 0 AND source_type = \? AND/);
  assert.equal((statement.match(/EXISTS \(SELECT 1 FROM json_each/g) || []).length, 2);
  assert.match(statement, /OR category = \?\) AND \(EXISTS/);
  assert.deepEqual(parameters, ["x", ...Array(6).fill("%100\\%\\_%"), "[]", "科技", "technology", 'a"b\\c', "__no_category__"]);
  assert.equal(statement.includes('a"b'), false);
  await repository.list({
    include_disabled: false,
    query: "科技"
  });
  assert.equal(parameters.at(-1), '["technology"]');
  // 管理列表保留非公开源，公开性由 visibility 筛选控制。
  await repository.list({
    include_disabled: true
  });
  assert.equal(statement.includes("require_token = 0"), false);
  await repository.list({
    include_disabled: true,
    visibility: "private"
  });
  assert.match(statement, /require_token = \?/);
});
test("公开详情把非公开源当作不存在", async () => {
  const service = new ServiceDiscovery({
    repo: {
      discovery: {
        find_enabled: () => ({
          id: "secret",
          require_token: 1,
          source_type: "website"
        })
      }
    }
  });
  await assert.rejects(async () => await service.get_public_discovery_source("secret"), {
    status: 404
  });
});
test("SQLite 公开列表、分页总数、搜索、详情和相关推荐只读取启用的公开源", async t => {
  const store = snapshot_store();
  t.after(async () => await store.db.close());
  const repository = new RepositoryDiscoverySource(store);
  for (const [id, enabled, require_token] of [["public-a", 1, 0], ["public-b", 1, 0], ["private", 1, 1], ["disabled-public", 0, 0], ["disabled-private", 0, 1]]) {
    store.sql.exec(`INSERT INTO discovery_sources
      (id, title, feed_url, category, source_type, enabled, require_token, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, id, "https://example.com/" + id, "", "website", enabled, require_token, 1, 1);
  }
  const service = new ServiceDiscovery({
    repo: {
      discovery: repository
    }
  });
  const list = async (query, admin = false) => await service.list_discovery_sources(new URL("https://api/discovery/sources?" + query), admin);
  const first = await list("limit=1&offset=0&visibility=private&status=disabled");
  assert.deepEqual(first.sources.map(source => source.id), ["public-a"]);
  assert.equal(first.total_count, 2);
  assert.equal(first.has_more, true);
  const second = await list("limit=1&offset=1");
  assert.deepEqual(second.sources.map(source => source.id), ["public-b"]);
  assert.equal(second.total_count, 2);
  assert.equal(second.has_more, false);
  const search = await list("q=private&limit=20");
  assert.deepEqual(search.sources, []);
  assert.equal(search.total_count, 0);
  assert.deepEqual((await service.public_catalog()).sources.map(source => source.id), ["public-a", "public-b"]);
  const detail = await service.get_public_discovery_source("public-a");
  assert.deepEqual(detail.related, [{
    id: "public-b",
    title: "public-b"
  }]);
  for (const id of ["private", "disabled-public", "disabled-private"]) {
    await assert.rejects(async () => await service.get_public_discovery_source(id), {
      status: 404
    });
  }
  assert.equal((await list("limit=20", true)).total_count, 5);
  const private_sources = await list("limit=20&visibility=private", true);
  assert.equal(private_sources.total_count, 2);
  assert.deepEqual(private_sources.sources.map(source => source.id), ["disabled-private", "private"]);
});
test("管理分页读取全部 1000 个源，公开目录维持既有上限和排序", async () => {
  const statements = [];
  const repository = new RepositoryDiscoverySource({
    sql: {
      exec(sql, ...args) {
        statements.push([sql, args]);
        return {
          toArray: () => []
        };
      }
    }
  });
  await repository.list({
    include_disabled: true
  });
  await repository.list({
    include_disabled: false
  });
  const result = spawnSync("python3", ["-c", `import sqlite3,json,sys
schema,statements=json.load(sys.stdin)
db=sqlite3.connect(':memory:');db.executescript(schema)
for i in range(1000):
 db.execute("INSERT INTO discovery_sources(id,title,feed_url,category,created_at,updated_at) VALUES(?,?,?,?,?,?)", (str(i),str(i),'https://example.com/'+str(i),'',i,i))
admin=db.execute(*[statements[0][0],statements[0][1]]).fetchall()
public=db.execute(*[statements[1][0],statements[1][1]]).fetchall()
assert len(admin)==1000 and admin[0][0]=='999' and admin[-1][0]=='0'
assert len(public)==500
`], {
    input: JSON.stringify([API_SCHEMA_SQL, statements]),
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
});
test("公开目录和管理列表都按筛选后的总数返回分页元数据，无分页参数保留全量响应", async () => {
  const calls = [];
  const service = new ServiceDiscovery({
    repo: {
      tags: {
        list: () => ["科技", "文章", "其他"]
      },
      discovery: {
        count_filtered(filters) {
          calls.push({
            count: {
              ...filters
            }
          });
          return 41;
        },
        list(filters) {
          calls.push({
            list: {
              ...filters
            }
          });
          return [{
            id: "page-item",
            enabled: 1
          }];
        },
        list_tags() {
          throw new Error("标签目录不能再从订阅源聚合");
        }
      }
    }
  });
  const url = new URL("https://api/discovery/sources?limit=20&offset=20&source_type=zhihu&tag=科技&tag=文章&q=日报");
  const result = await service.list_discovery_sources(url, false);
  assert.equal(result.total_count, 41);
  assert.equal(result.limit, 20);
  assert.equal(result.offset, 20);
  assert.equal(result.has_more, true);
  assert.deepEqual(calls[0].count, {
    include_disabled: false,
    category: "",
    source_type: "zhihu",
    tags: ["科技", "文章"],
    query: "日报"
  });
  assert.deepEqual(calls[1].list, {
    ...calls[0].count,
    limit: 20,
    offset: 20
  });
  assert.deepEqual(result.tags, ["科技", "文章", "其他"]);
  for (const [query, limit, offset] of [["limit=0&offset=-10", 1, 0], ["limit=1000&offset=1e20", 100, 1_000_000], ["limit=bad&offset=Infinity", 20, 0], ["offset=40", 20, 40]]) {
    const page = await service.list_discovery_sources(new URL("https://api/discovery/sources?" + query), false);
    assert.equal(page.limit, limit);
    assert.equal(page.offset, offset);
    assert.equal(page.has_more, offset + limit < 41);
  }
  const admin = await service.list_discovery_sources(url, true);
  assert.equal(admin.total_count, 41);
  assert.equal(calls.at(-1).list.limit, 20);
  const full = await service.list_discovery_sources(new URL("https://api/discovery/sources"), true);
  assert.equal("total_count" in full, false);
  assert.equal("limit" in calls.at(-1).list, false);
});
test("SQLite 公开分页可读取第 501 条之后，重复标题排序稳定且所有筛选与总数一致", async () => {
  const statements = [];
  const repository = new RepositoryDiscoverySource({
    sql: {
      exec(sql, ...args) {
        statements.push([sql, args]);
        return {
          toArray: () => []
        };
      }
    }
  });
  const filters = {
    include_disabled: false,
    query: "%_",
    source_type: "zhihu",
    tags: ["科技", "文章"]
  };
  await repository.count_filtered(filters);
  for (const offset of [0, 20, 500, 600, 1000]) await repository.list({
    ...filters,
    limit: 20,
    offset
  });
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
`], {
    input: JSON.stringify([API_SCHEMA_SQL, statements]),
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
});
