import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { register } from "node:module";
import { ServiceStatistics } from "../server/service/application/statistics.js";
import { RepositoryStatistics } from "../server/repository/statistics.js";
import { RepositoryDiscoverySource } from "../server/repository/discovery_source.js";
import { API_SCHEMA_SQL } from "../server/repository/schema.js";
import { admin_overview, admin_management_overview } from "../server/service/worker/application_proxy.js";
import { snapshot_store } from "./support/snapshot_store.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const {
  ServiceScript
} = await import("../server/service/application/scripts.js");
const {
  route
} = await import("../application_router.js");
const {
  default: worker
} = await import("../api.js");
function fixture() {
  const rows = [{
    id: "a",
    title: "源 A",
    feed_url: "{{hostname}}/rss/news/你好?b=2&a=1",
    enabled: 1,
    source_type: "weibo",
    tags_json: '["新闻","新闻"]',
    call_count: 2
  }, {
    id: "b",
    title: "源 B",
    feed_url: "https://feeds.example/atom/news/你好?a=1&b=2",
    enabled: 1,
    source_type: "weibo",
    tags_json: '["新闻","技术"]',
    call_count: 3
  }, {
    id: "c",
    title: "停用",
    feed_url: "{{hostname}}/rss/news/你好?a=1&b=2",
    enabled: 0,
    source_type: "website",
    call_count: 4
  }, {
    id: "d",
    title: "外部源",
    feed_url: "https://example.com/feed.xml",
    enabled: 1,
    source_type: "website",
    call_count: 0
  }];
  const script = {
    route: "script",
    path: "/news/:name",
    enabled: 1,
    metadata_json: JSON.stringify({
      routes: [{
        path: "/news/:name",
        platform: "微博"
      }, {
        path: "/image",
        platform: "自定义"
      }]
    })
  };
  let reads = 0;
  const repo = {
    statistics: {
      sources: () => {
        reads++;
        return rows;
      },
      scripts: () => [script, {
        route: "broken",
        metadata_json: "bad"
      }],
      record_calls(ids) {
        for (const row of rows) if (row.enabled && ids.includes(row.id)) row.call_count++;
      }
    },
    rss_cookies: {
      get: () => [{
        value: "secret"
      }, {
        value: "another secret"
      }]
    }
  };
  return {
    rows,
    script,
    repo,
    service: new ServiceStatistics({
      repo
    }),
    get reads() {
      return reads;
    }
  };
}
test("统计快照覆盖全部源、多个路由、去重平台和标签，不返回 Cookie 或脚本正文", async () => {
  const f = fixture();
  const snapshot = await f.service.collect();
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
  f.rows.length = 0;
  f.repo.statistics.scripts = () => [];
  f.repo.rss_cookies.get = () => [];
  const empty = await f.service.collect();
  for (const field of ["script_count", "source_count", "source_call_count", "cookie_count", "route_count", "tag_count"]) assert.equal(empty[field], 0);
  assert.equal(empty.platform_count, 1); // 平台目录始终含默认「网站」。
});
test("调用计数共用 RSS/Atom 路由身份，归一 query 和编码，停用、未知变体不计数，源变更后重建索引", async () => {
  const f = fixture();
  await f.service.record_call("/news/%E4%BD%A0%E5%A5%BD", new URLSearchParams("a=1&b=2"));
  await f.service.record_call("/news/你好", new URLSearchParams("b=2&a=1"));
  assert.deepEqual(f.rows.map(row => row.call_count), [4, 5, 4, 0]);
  assert.equal(f.reads, 1);
  await f.service.record_call("/news/你好", new URLSearchParams("a=2&b=2"));
  await f.service.record_call("/missing", new URLSearchParams());
  assert.deepEqual(f.rows.map(row => row.call_count), [4, 5, 4, 0]);
  f.rows[0].feed_url = "{{hostname}}/rss/changed";
  f.rows[1].enabled = 0;
  f.service.invalidate_sources();
  await f.service.record_call("/news/你好", new URLSearchParams("a=1&b=2"));
  await f.service.record_call("/changed", new URLSearchParams());
  assert.deepEqual(f.rows.map(row => row.call_count), [5, 5, 4, 0]);
  assert.equal(f.reads, 2);
});
test("真实 RSS/Atom 快照命中及暂未生成均计数，鉴权拒绝、404、调试、预览和自动刷新不计数", async () => {
  const f = fixture();
  const calls = [];
  const service = new ServiceScript({
    repo: {
      scripts: {
        list_enabled: () => [f.script]
      },
      rss_route_cache: {
        register_public: () => true
      },
      discovery: {
        list_public_routes: () => [],
        list_private_routes: () => []
      }
    },
    ports: {
      route_cache: {
        resolve: () => ({
          rendered: new Map([["rss\n", "RSS"], ["atom\n", "Atom"]])
        })
      }
    },
    app: {
      statistics: {
        record_call: (...args) => calls.push(args)
      }
    }
  });
  service.cookie_access = async () => null;
  const request = (format, path = "/news/hello", headers = {}) => new Request("https://internal/_public/feed/" + format + path + "?token=secret&a=1", {
    headers
  });
  const authenticated = {
    "X-Api-Access-Token-ID": "user"
  };
  await assert.rejects(service.serve_rss_route("rss", "/news/hello", request("rss")), {
    status: 401
  });
  await assert.rejects(service.serve_rss_route("rss", "/missing", request("rss", "/missing", authenticated)), {
    status: 404
  });
  service.rss_address_is_public = () => true;
  for (const format of ["rss", "atom"]) assert.ok((await service.serve_rss_route(format, "/news/hello", request(format))).body);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1].has("token"), false);
  service.ports.route_cache.resolve = () => null;
  await assert.rejects(service.serve_rss_route("rss", "/news/hello", request("rss")), {
    status: 503
  });
  assert.equal(calls.length, 3);
  service.ports.route_cache.run = () => {
    throw new Error("stop before execution");
  };
  service.record_log = () => {};
  await assert.rejects(service.serve_rss_route("rss", "/news/hello", request("rss"), {
    refresh: true
  }));
  await assert.rejects(service.serve_rss_route("rss", "/news/hello", new Request("https://internal/_admin/feed/rss/news/hello")));
  await assert.rejects(service.serve_rss_route("debug", "/news/hello", request("debug")));
  assert.equal(calls.length, 3);
  delete service.app.statistics;
  service.ports.route_cache.resolve = () => ({
    rendered: new Map([["rss\n", "RSS"]])
  });
  assert.equal((await service.serve_rss_route("rss", "/news/hello", request("rss"))).body, "RSS");
  assert.equal(calls.length, 3);
});
test("SQLite 计数原子递增、重建仓储不清零、全量读取不截断，删除源清理计数", async () => {
  const statements = [];
  const sql = {
    exec(sql, ...args) {
      statements.push([sql, args]);
      return {
        toArray: () => []
      };
    }
  };
  const repo = new RepositoryStatistics({
    sql
  });
  await repo.record_calls(["a", "disabled"]);
  await repo.record_calls(["a"]);
  await new RepositoryStatistics({
    sql
  }).record_calls(["a"]);
  await repo.sources();
  await repo.scripts();
  await new RepositoryDiscoverySource({
    sql
  }).delete("a");
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
`], {
    input: JSON.stringify([API_SCHEMA_SQL, statements]),
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
});
test("概览快照每五分钟持久化一次，读接口不统计，重建服务和生成失败均保留旧快照", async t => {
  const {
    db,
    sql
  } = snapshot_store();
  t.after(() => db.close());
  db.exec("INSERT INTO discovery_sources(id,title,feed_url,category,created_at,updated_at) VALUES('a','源 A','{{hostname}}/rss/news','',1,1)");
  const repo = {
    statistics: new RepositoryStatistics({
      sql
    }),
    rss_cookies: {
      get: () => []
    },
    access_tokens: {
      count_active: () => 7
    }
  };
  let summary_reads = 0;
  const app = {
    devices: {
      summary: () => {
        summary_reads++;
        return {
          devices: ["online", "busy", "offline", "disabled"].map(status => ({
            status
          })),
          task_counts: [{
            count: 2
          }, {
            count: 3
          }]
        };
      }
    }
  };
  const service = new ServiceStatistics({
    repo,
    app
  });
  assert.equal(await service.next_snapshot_at(), 0);
  const missing = await route(new Request("https://internal/_admin/overview"), {
    statistics: service
  });
  assert.equal(missing.status, 503);
  assert.match((await missing.json()).error, /尚未生成/);
  assert.equal(summary_reads, 0);
  const now = 1000000;
  await service.refresh_snapshot(now);
  const snapshot = await service.snapshot();
  assert.equal(snapshot.generated_at, now);
  for (const [field, value] of Object.entries({
    device_count: 4,
    online_count: 2,
    offline_count: 2,
    task_count: 5,
    token_count: 7,
    source_count: 1,
    source_call_count: 0
  })) assert.equal(snapshot.statistics[field], value, field);
  assert.equal(await service.next_snapshot_at(), now + 300000);
  await repo.statistics.record_calls(["a"]);
  await service.refresh_snapshot(now + 299999);
  assert.equal(summary_reads, 1);
  assert.deepEqual(await service.snapshot(), snapshot);
  const restarted = new ServiceStatistics({
    repo: {
      statistics: new RepositoryStatistics({
        sql
      })
    }
  });
  assert.deepEqual(await restarted.snapshot(), snapshot);
  assert.equal(await restarted.next_snapshot_at(), now + 300000);
  const response = await route(new Request("https://internal/_admin/overview"), {
    statistics: restarted
  });
  assert.deepEqual(await response.json(), snapshot);
  assert.equal(await response.headers.get("Cache-Control"), "no-store");
  const statistics_response = await route(new Request("https://internal/_admin/statistics"), {
    statistics: restarted
  });
  assert.deepEqual(await statistics_response.json(), snapshot.statistics);
  await service.refresh_snapshot(now + 300000);
  assert.equal(summary_reads, 2);
  assert.equal((await service.snapshot()).statistics.source_call_count, 1);
  assert.equal((await service.snapshot()).generated_at, now + 300000);
  repo.rss_cookies.get = () => {
    throw new Error("read failed");
  };
  await assert.rejects(async () => await service.refresh_snapshot(now + 600000), /read failed/);
  assert.equal((await service.snapshot()).generated_at, now + 300000);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM overview_snapshot").get().count, 1);
});
test("概览接口仅请求已存快照并展开模板，保留生成时间，未生成时不回退实时统计", async () => {
  const paths = [];
  let fail = false;
  const env = {
    FINDRSS_HOSTNAME: "feeds.example",
    APPLICATION: (() => ({
      fetch: async url => {
        const path = new URL(url).pathname;
        paths.push(path);
        assert.equal(path, "/_admin/overview");
        return fail ? Response.json({
          error: "概览快照尚未生成，请稍后刷新"
        }, {
          status: 503
        }) : Response.json({
          generated_at: 1000,
          statistics: {
            token_count: 7,
            source_count: 1,
            sources: [{
              feed_url: "{{hostname}}/rss/news"
            }]
          }
        });
      }
    }))()
  };
  const overview = await (await admin_overview(env)).json();
  assert.deepEqual(paths, ["/_admin/overview"]);
  assert.equal(overview.generated_at, 1000);
  assert.equal(overview.statistics.token_count, 7);
  assert.equal(overview.statistics.source_count, 1);
  assert.equal(overview.statistics.sources[0].feed_url, "https://feeds.example/rss/news");
  fail = true;
  assert.equal((await admin_overview(env)).status, 503);
  assert.deepEqual(paths, ["/_admin/overview", "/_admin/overview"]);
});
test("设备和 Token 管理保留实时接口，不触发概览统计", async () => {
  const paths = [];
  const env = {
    APPLICATION: (() => ({
      fetch: async url => {
        const path = new URL(url).pathname;
        paths.push(path);
        assert.ok(["/", "/_admin/access-tokens"].includes(path));
        return Response.json(path === "/" ? {
          devices: [{
            device_id: "a"
          }],
          methods: [],
          task_counts: []
        } : {
          access_tokens: [{
            id: "token"
          }]
        });
      }
    }))()
  };
  const overview = await (await admin_management_overview(env)).json();
  assert.deepEqual(paths.sort(), ["/", "/_admin/access-tokens"]);
  assert.equal(overview.devices[0].device_id, "a");
  assert.equal(overview.access_tokens[0].id, "token");
});
test("未注册统计服务时概览与统计接口返回停用提示，不读取历史快照", async () => {
  const app = {
    repo: new Proxy({}, {
      get() {
        assert.fail("停用概览不可访问仓储");
      }
    })
  };
  for (const path of ["/_admin/overview", "/_admin/statistics"]) {
    const response = await route(new Request("https://internal" + path), app);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "概览统计已暂时停用");
  }
});
test("概览与管理接口均需管理员鉴权，并分别路由到快照和实时数据", async () => {
  const paths = [];
  const app = {
    statistics: {
      snapshot: () => ({
        generated_at: 1000,
        statistics: {
          token_count: 7,
          sources: []
        }
      })
    },
    devices: {
      summary: () => ({
        devices: [],
        task_counts: [],
        methods: []
      })
    },
    access_tokens: {
      list_access_tokens: () => ({
        access_tokens: [{
          id: "live"
        }]
      })
    }
  };
  const env = {
    ADMIN_PASSWORD: "admin-secret",
    APPLICATION: (() => ({
      fetch: url => {
        paths.push(new URL(url).pathname);
        return route(new Request(url), app);
      }
    }))()
  };
  for (const path of ["/admin/api/overview", "/admin/api/management-overview"]) {
    assert.equal((await worker.fetch(new Request("https://api" + path), env)).status, 401);
    assert.equal(paths.length, 0);
  }
  const request = path => new Request("https://api/admin/api/" + path, {
    headers: {
      Authorization: "Bearer admin-secret"
    }
  });
  const snapshot = await (await worker.fetch(request("overview"), env)).json();
  assert.equal(snapshot.generated_at, 1000);
  assert.deepEqual(paths, ["/_admin/overview"]);
  const live = await (await worker.fetch(request("management-overview"), env)).json();
  assert.equal(live.access_tokens[0].id, "live");
  assert.deepEqual(paths, ["/_admin/overview", "/", "/_admin/access-tokens"]);
});
