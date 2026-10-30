import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { register } from "node:module";
import { create_worker } from "../router.js";
import { handle_admin_request } from "../admin.js";
import { ServiceDiscovery } from "../server/service/application/discovery.js";
import { load_discovery_snapshot } from "../server/infra/discovery_snapshot.js";
import { feed_hostname_origin } from "../server/service/worker/discovery.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const {
  route
} = await import("../application_router.js");
const {
  default: api
} = await import("../api.js");

// 使用 DO 的真实请求入口，覆盖域名记忆与内部路由，避免依赖 Cloudflare 运行时。
const source_code = readFileSync(new URL("../server/application.js", import.meta.url), "utf8");
const do_fetch = vm.runInNewContext("({" + source_code.match(/  async fetch\(request\) \{[\s\S]*?\n  \}/)[0] + "}).fetch", {
  route,
  URL
});
function setup(configured = {}) {
  const values = new Map(),
    calls = [];
  const source = {
    id: "source-1",
    title: "视频",
    feed_url: "{{hostname}}/rss/bilibili/650898515/upload/video?limit=3",
    enabled: 1,
    require_token: 0,
    tags_json: "[]"
  };
  let snapshot = {};
  const repo = {
    discovery: {
      find: () => ({
        ...source
      }),
      list: () => [{
        ...source,
        ...snapshot
      }],
      list_tags: () => [],
      snapshot_attempt() {},
      snapshot_save(_id, _url, articles, saved_at, error = "") {
        snapshot = {
          saved_at,
          articles_json: JSON.stringify(articles),
          error
        };
      },
      snapshot_get: () => snapshot,
      snapshot_due: () => [source]
    }
  };
  const storage = {
    get: async key => values.get(key),
    put: async (key, value) => {
      values.set(key, value);
    }
  };
  const serve_route = async (format, pathname, request, options) => {
    calls.push({
      format,
      pathname,
      request,
      options
    });
    const article_url = new URL("/article/1", await request.headers.get("X-Feed-Public-URL")).href;
    return {
      body: `<rss><channel><title>视频</title><item><title>新视频</title><link>${article_url}</link></item></channel></rss>`
    };
  };
  const dependencies = {
    repo,
    storage,
    public_origin: feed_hostname_origin(configured),
    load_snapshot: (source, origin) => load_discovery_snapshot(source, origin, serve_route)
  };
  const service = new ServiceDiscovery(dependencies);
  const object = {
    app: {
      discovery: service
    },
    discovery_alarm_started: true
  };
  const env = {
    ...configured,
    ADMIN_PASSWORD: "test-admin",
    APPLICATION: (() => ({
      fetch: request => do_fetch.call(object, request)
    }))()
  };
  const worker = create_worker({
    api,
    admin: handle_admin_request,
    discovery: async () => new Response("not found", {
      status: 404
    })
  });
  const fetch = async (origin, suffix = "", method = "GET") => await worker.fetch(new Request(origin + "/admin/api/discovery/sources" + suffix, {
    method,
    headers: {
      Authorization: "Bearer test-admin",
      "X-Feed-Public-URL": "https://spoofed.example"
    }
  }), env);
  const public_fetch = async (origin, path) => await worker.fetch(new Request(origin + path, {
    headers: {
      "X-Feed-Public-URL": "https://spoofed.example"
    }
  }), env);
  return {
    fetch,
    public_fetch,
    service,
    dependencies,
    object,
    values,
    calls,
    source
  };
}
test("未配置域名：列表和手动快照跟随 workers.dev、自定义域名和本地访问地址", async () => {
  const app = setup();
  for (const origin of ["https://findrss.litao.workers.dev", "https://findrss.cloud", "http://127.0.0.1:8787"]) {
    const listed = await (await app.fetch(origin)).json();
    assert.equal(listed.sources[0].feed_url, origin + "/rss/bilibili/650898515/upload/video?limit=3");
    assert.equal(listed.sources[0].feed_url_template, app.source.feed_url);
    const response = await app.fetch(origin, "/source-1/snapshot", "POST");
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.snapshot.error, "");
    assert.ok(result.snapshot.saved_at > 0);
    assert.equal(result.snapshot.articles[0].title, "新视频");
    // 公开文章链接仍过滤回环地址，本地 origin 只用于内部执行和模板展开。
    assert.equal(result.snapshot.articles[0].link, origin.startsWith("http://127.0.0.1") ? "" : origin + "/article/1");
    const call = app.calls.at(-1);
    assert.equal(call.request.url, "https://internal/_public/feed/rss/bilibili/650898515/upload/video?limit=3");
    assert.equal(await call.request.headers.get("X-Feed-Public-URL"), listed.sources[0].feed_url);
    assert.equal(call.options.refresh, true);
  }
  assert.equal(app.source.feed_url, "{{hostname}}/rss/bilibili/650898515/upload/video?limit=3");
});
test("定时刷新沿用最近的访问域名，重建服务后从持久化存储恢复", async () => {
  const app = setup();
  await app.fetch("https://findrss.litao.workers.dev");
  await app.fetch("https://findrss.cloud");
  for (const service of [app.service, new ServiceDiscovery(app.dependencies)]) {
    await service.refresh_due_snapshots();
    assert.equal(await app.calls.at(-1).request.headers.get("X-Feed-Public-URL"), "https://findrss.cloud/rss/bilibili/650898515/upload/video?limit=3");
  }
  // 显式传入本次请求的域名，不受其他请求记忆的域名影响。
  await app.service.refresh_discovery_snapshot("source-1", "https://findrss.litao.workers.dev");
  assert.match(await app.calls.at(-1).request.headers.get("X-Feed-Public-URL"), /^https:\/\/findrss\.litao\.workers\.dev\//);
});
test("相同访问域名在服务重建后不重复写入，切换域名仍立即持久化", async t => {
  const app = setup();
  const put = t.mock.method(app.dependencies.storage, "put", async (key, value) => app.values.set(key, value));
  await app.service.remember_public_origin("https://findrss.cloud");
  await new ServiceDiscovery(app.dependencies).remember_public_origin("https://findrss.cloud");
  assert.equal(put.mock.calls.length, 1);
  await new ServiceDiscovery(app.dependencies).remember_public_origin("https://other.example");
  assert.equal(put.mock.calls.length, 2);
  assert.equal(await app.values.get("discovery_public_origin"), "https://other.example");
});
test("匿名读取公开目录也能提供定时刷新域名，其他接口的透传头不会改写它", async () => {
  const app = setup();
  for (const [origin, path] of [["https://findrss.litao.workers.dev", "/discovery/sources"], ["https://findrss.cloud", "/discovery/catalog"]]) {
    const response = await app.public_fetch(origin, path);
    assert.equal(response.status, 200);
    await new ServiceDiscovery(app.dependencies).refresh_due_snapshots();
    assert.equal(new URL(await app.calls.at(-1).request.headers.get("X-Feed-Public-URL")).origin, origin);
  }
  await do_fetch.call(app.object, new Request("https://internal/_internal/unknown", {
    headers: {
      "X-Feed-Public-URL": "https://spoofed.example"
    }
  }));
  assert.equal(await app.service.snapshot_origin(), "https://findrss.cloud");
});
test("固定域名配置优先于访问域名，兼容 FEED_HOSTNAME", async () => {
  for (const configured of [{
    FINDRSS_HOSTNAME: "fixed.example"
  }, {
    FEED_HOSTNAME: "https://fixed.example/"
  }, {
    FINDRSS_HOSTNAME: "fixed.example",
    FEED_HOSTNAME: "legacy.example"
  }]) {
    const app = setup(configured);
    const result = await (await app.fetch("https://findrss.cloud", "/source-1/snapshot", "POST")).json();
    assert.equal(result.snapshot.error, "");
    assert.equal(result.snapshot.articles[0].link, "https://fixed.example/article/1");
    await new ServiceDiscovery(app.dependencies).refresh_due_snapshots();
    assert.equal(await app.calls.at(-1).request.headers.get("X-Feed-Public-URL"), "https://fixed.example/rss/bilibili/650898515/upload/video?limit=3");
  }
});
test("无请求的首次任务给出明确提示，非法或内部地址不会覆盖已保存的域名", async () => {
  const app = setup();
  const result = await app.service.refresh_discovery_snapshot("source-1");
  assert.match(result.snapshot.error, /尚未获取访问域名/);
  assert.equal(app.calls.length, 0);
  await app.service.remember_public_origin("https://findrss.cloud");
  for (const value of [null, "", "{{hostname}}", "https://internal/_admin/discovery/sources", "ftp://example.com", "https://user:password@example.com"]) {
    await app.service.remember_public_origin(value);
  }
  await new ServiceDiscovery(app.dependencies).refresh_due_snapshots();
  assert.equal(await app.calls.at(-1).request.headers.get("X-Feed-Public-URL"), "https://findrss.cloud/rss/bilibili/650898515/upload/video?limit=3");
});
test("Atom 与私密源仍走正确内部路由，外部私网源继续拒绝", async () => {
  let called;
  const result = await load_discovery_snapshot({
    feed_url: "{{hostname}}/atom/private?id=1",
    require_token: true
  }, "https://findrss.cloud", async (_format, _pathname, request) => {
    called = request;
    return {
      body: '<feed xmlns="http://www.w3.org/2005/Atom"><title>私密源</title></feed>'
    };
  });
  assert.equal(called.url, "https://internal/_admin/feed/atom/private?id=1");
  assert.equal(await called.headers.get("X-Feed-Public-URL"), "https://findrss.cloud/atom/private?id=1");
  assert.deepEqual(result.articles, []);
  assert.match(result.fingerprint, /^[0-9a-f]{64}$/);
  await assert.rejects(load_discovery_snapshot({
    feed_url: "http://192.168.1.1/feed.xml"
  }, "https://findrss.cloud", () => assert.fail("外部源不应走脚本路由")), /订阅源地址被拒绝/);
});
