import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { snapshot_store } from "./support/snapshot_store.js";
import { RepositoryDiscoverySource } from "../server/repository/discovery_source.js";
import { RepositoryAccessToken } from "../server/repository/access_token.js";
import { RepositoryCredit } from "../server/repository/credit.js";
import { ServiceCredit } from "../server/service/application/credits.js";
import { RssRouteCache, rss_route_cache_key } from "../server/infra/rss_cache.js";
import { ServiceDiscovery } from "../server/service/application/discovery.js";
import { admin_discovery_preview } from "../server/service/worker/discovery.js";
import { RSS_ROUTE_CACHE_TTL_MS } from "../server/lib/constants.js";
import { sha256_hex } from "../server/lib/crypto.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const {
  ServiceScript
} = await import("../server/service/application/scripts.js");
const {
  route
} = await import("../application_router.js");
async function fixture(t) {
  const store = snapshot_store();
  t.after(async () => await store.db.close());
  const row = {
    route: "preview",
    path: "/preview/:id",
    enabled: 1,
    metadata_json: JSON.stringify({
      path: "/preview/:id",
      kind: "rss"
    }),
    script: `export const route = { path: "/preview/:id", async handler(ctx) {
      await ctx.invoke("count", {});
      return Result.Ok({ title: "预览源", items: [{ title: "预览文章", link: "https://example.com/article" }] });
    } };`
  };
  const repo = {
    discovery: new RepositoryDiscoverySource(store),
    rss_route_cache: store.repo,
    access_tokens: new RepositoryAccessToken(store),
    credit: new RepositoryCredit(store),
    scripts: {
      list: () => [row],
      list_enabled: () => [row],
      find: () => row
    }
  };
  await repo.access_tokens.insert({
    id: "valid-token-id",
    user_id: "reader",
    name: "Reader",
    token_hash: "hash",
    token_hint: "hint",
    expires_at: null,
    created_at: 1,
    credit_balance: 10,
    total_credits_granted: 10
  });
  const ports = {
    route_cache: new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, 100, {
      store: store.repo,
      object_store: store.object_store
    }),
    schedule_alarm: async () => {}
  };
  const app = {};
  app.credit = new ServiceCredit({
    repo,
    storage: store.storage
  });
  app.discovery = new ServiceDiscovery({
    repo,
    route_cache: ports.route_cache,
    public_origin: "https://feeds.example",
    check_cookie_permissions: script_id => app.scripts.check_cookie_permissions(script_id)
  });
  app.scripts = new ServiceScript({
    repo,
    ports,
    app,
    public_origin: "https://feeds.example"
  });
  let executions = 0,
    published;
  app.scripts.record_log = () => {};
  app.scripts.script_invoke = async () => ++executions;
  app.discovery.publish_catalog = async () => {
    published = await app.discovery.public_catalog();
  };
  const env = {
    FINDRSS_HOSTNAME: "https://feeds.example",
    APPLICATION: (() => ({
      fetch: request => route(request, app)
    }))()
  };
  const preview = feed_url => admin_discovery_preview(env, new Request("https://feeds.example/admin/api/discovery/preview", {
    method: "POST",
    body: JSON.stringify({
      feed_url,
      cache_snapshot: true
    })
  }));
  const save = async (feed_url, preview_id, fields = {}) => {
    const result = await route(new Request("https://internal/_admin/discovery/sources", {
      method: "POST",
      headers: {
        "X-Feed-Preview-ID": preview_id
      },
      body: JSON.stringify({
        title: "源",
        feed_url,
        ...fields
      })
    }), app);
    assert.equal(result.status, 201);
    return (await result.json()).source;
  };
  const serve = (format = "rss", token = "") => app.scripts.serve_rss_route(format, "/preview/1", new Request("https://internal/_public/feed/" + format + "/preview/1?b=2&a=1", {
    headers: {
      "X-Api-Access-Token-ID": token
    }
  }));
  return {
    ...store,
    repo,
    row,
    app,
    ports,
    preview,
    save,
    serve,
    get executions() {
      return executions;
    },
    get published() {
      return published;
    }
  };
}
test("读取结果跨缓存重建复用，保存即发布广场文章和 RSS/Atom，上传头像保留快照状态", async t => {
  const f = await fixture(t);
  const feed_url = "{{hostname}}/atom/preview/1?a=1&b=2";
  const response = await f.preview(feed_url);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(data.preview_id);
  assert.equal(f.executions, 1);
  assert.equal(await f.repo.discovery.count(), 0);
  await assert.rejects(f.serve(), {
    status: 401
  });
  f.ports.route_cache = new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, 100, {
    store: f.repo.rss_route_cache,
    object_store: f.object_store
  });
  f.app.discovery.route_cache = f.ports.route_cache;
  const source = await f.save(feed_url, data.preview_id, {
    poll_policy: {
      mode: "manual"
    },
    require_token: false
  });
  assert.equal(source.snapshot.articles[0].title, "预览文章");
  assert.ok(source.snapshot.saved_at > 0);
  assert.equal(source.cache.status, "fresh");
  assert.equal(source.cache.persistent, true);
  assert.equal(source.next_snapshot_at, null);
  assert.equal(f.published.sources[0].snapshot.articles[0].title, "预览文章");
  for (const format of ["rss", "atom"]) assert.match((await f.serve(format)).body, /预览文章/);
  f.ports.route_cache = new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, 100, {
    store: f.repo.rss_route_cache,
    object_store: f.object_store
  });
  assert.match((await f.serve()).body, /预览文章/);
  assert.equal(f.executions, 1);
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  f.app.discovery.storage = {
    transaction: fn => fn()
  };
  const avatar = await f.app.discovery.put_discovery_avatar(new Request("https://internal/avatar", {
    method: "PUT",
    body: png
  }), source.id);
  assert.equal(avatar.source.snapshot.saved_at, source.snapshot.saved_at);
  assert.equal(avatar.source.cache.status, "fresh");
});
test("新增、改为私密与删除订阅源都保留已有持久 XML，私密访问仍需凭证", async t => {
  const f = await fixture(t);
  const key = "public-snapshot:" + rss_route_cache_key("/kuaishou/profile/3xuxw5yhgr6f4um", []);
  await f.ports.route_cache.run(key, Date.now(), async () => ({
    output: "{}",
    invoked: false,
    rendered: new Map([["rss\n", "快手 XML"]])
  }));
  const feed_url = "{{hostname}}/rss/preview/1?a=1&b=2";
  const data = await (await f.preview(feed_url)).json();
  const source = await f.save(feed_url, data.preview_id, {
    require_token: false
  });
  assert.ok(await f.repo.rss_route_cache.read(key));
  await f.app.discovery.update_discovery_source(new Request("https://internal/source", {
    method: "PATCH",
    body: JSON.stringify({
      require_token: true
    })
  }), source.id);
  const own_key = "public-snapshot:" + rss_route_cache_key("/preview/1", new URLSearchParams("a=1&b=2"));
  assert.ok(await f.repo.rss_route_cache.read(own_key));
  await assert.rejects(f.serve(), {
    status: 401
  });
  f.app.discovery.storage = f.storage;
  await f.app.discovery.delete_discovery_source(source.id);
  const rebuilt = new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, 100, {
    store: f.repo.rss_route_cache,
    object_store: f.object_store
  });
  assert.ok(await (await rebuilt.resolve(own_key, Date.now())).rendered.get("rss\n"));
  assert.equal(await (await rebuilt.resolve(key, Date.now())).rendered.get("rss\n"), "快手 XML");
});
test("预览保存为私密源只复用私密 XML，不进入公开目录，清理和重建后仍需身份访问", async t => {
  const f = await fixture(t);
  const feed_url = "{{hostname}}/rss/preview/1?a=1&b=2";
  const data = await (await f.preview(feed_url)).json();
  const source = await f.save(feed_url, data.preview_id);
  assert.equal(source.require_token, true);
  assert.equal(source.credit_cost, 1);
  assert.equal(source.snapshot.saved_at, 0);
  assert.deepEqual(source.snapshot.articles, []);
  assert.equal(source.cache.status, "fresh");
  assert.deepEqual(f.published.sources, []);
  assert.doesNotMatch(JSON.stringify(f.published), /预览文章|example.com\/article/);
  await assert.rejects(f.serve(), {
    status: 401
  });
  await f.repo.rss_route_cache.delete_expired(Date.now() + RSS_ROUTE_CACHE_TTL_MS + 1);
  f.ports.route_cache = new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, 100, {
    store: f.repo.rss_route_cache,
    object_store: f.object_store
  });
  assert.match((await f.serve("atom", "valid-token-id")).body, /预览文章/);
  assert.equal(f.executions, 1);
});
for (const initially_public of [false, true]) test(`切换${initially_public ? "公开" : "私密"}源复用持久 XML 和抓取计划，仅更新广场预览`, async t => {
  const f = await fixture(t);
  const feed_url = "{{hostname}}/atom/preview/1?a=1&b=2";
  const data = await (await f.preview(feed_url)).json();
  const source = await f.save(feed_url, data.preview_id, {
    require_token: !initially_public
  });
  await f.repo.discovery.snapshot_save(source.id, feed_url, [], 0, "上次抓取失败");
  await f.repo.discovery.snapshot_adaptive(source.id, 420);
  const snapshot = await f.repo.discovery.snapshot_get(source.id);
  const next_at = (await (await f.app.discovery.scheduled_sources()).find(row => row.id === source.id)).next_at;
  const original_rss = (await f.serve("rss", "valid-token-id")).body;
  const original_atom = (await f.serve("atom", "valid-token-id")).body;
  const route_key = rss_route_cache_key("/preview/1", new URLSearchParams("b=2&a=1"));
  const saved_at = (await f.ports.route_cache.inspect((initially_public ? "public-snapshot:" : "private-snapshot:") + route_key)).saved_at;
  t.mock.method(globalThis, "fetch", async () => {
    assert.fail("切换公开性不得请求上游或封面");
  });
  f.app.discovery.load_snapshot = async () => {
    assert.fail("切换公开性不得重新抓取 XML");
  };
  for (const is_public of [!initially_public, initially_public]) {
    const result = await f.app.discovery.update_discovery_source(new Request("https://internal/source", {
      method: "PATCH",
      body: JSON.stringify({
        require_token: !is_public
      })
    }), source.id);
    assert.equal(result.source.require_token, !is_public);
    const {
      articles_json,
      ...status
    } = await f.repo.discovery.snapshot_get(source.id);
    const {
      articles_json: previous_articles,
      ...previous_status
    } = snapshot;
    assert.deepEqual(status, previous_status);
    assert.equal((await (await f.app.discovery.scheduled_sources()).find(row => row.id === source.id)).next_at, next_at);
    if (is_public) assert.equal(f.published.sources[0].snapshot.articles[0].title, "预览文章");else {
      assert.deepEqual(f.published.sources, []);
      assert.deepEqual(result.source.snapshot.articles, []);
      await assert.rejects(f.serve(), {
        status: 401
      });
    }
    const key = (is_public ? "public-snapshot:" : "private-snapshot:") + route_key;
    assert.equal((await f.ports.route_cache.inspect(key)).saved_at, saved_at);
    f.ports.route_cache = new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, 100, {
      store: f.repo.rss_route_cache,
      object_store: f.object_store
    });
    f.app.discovery.route_cache = f.ports.route_cache;
    assert.equal((await f.serve("rss", is_public ? "" : "valid-token-id")).body, original_rss);
    assert.equal((await f.serve("atom", is_public ? "" : "valid-token-id")).body, original_atom);
    await f.app.discovery.refresh_due_snapshots();
    assert.equal(f.executions, 1);
  }
});
test("切换公开性时没有已有 XML 也不主动抓取，改变地址仍清除旧广场快照", async t => {
  const f = await fixture(t);
  const feed_url = "{{hostname}}/rss/preview/1?a=1&b=2";
  const source = await f.save(feed_url, "", {
    poll_policy: {
      mode: "manual"
    }
  });
  for (const require_token of [false, true]) {
    await f.app.discovery.update_discovery_source(new Request("https://internal/source", {
      method: "PATCH",
      body: JSON.stringify({
        require_token
      })
    }), source.id);
    assert.equal(f.executions, 0);
    assert.equal(await f.repo.discovery.snapshot_get(source.id), undefined);
  }
  await f.repo.discovery.snapshot_attempt(source.id, feed_url, 123);
  await f.repo.discovery.snapshot_save(source.id, feed_url, [{
    title: "旧文章"
  }], 123);
  await f.app.discovery.update_discovery_source(new Request("https://internal/source", {
    method: "PATCH",
    body: JSON.stringify({
      feed_url: "{{hostname}}/rss/preview/2"
    })
  }), source.id);
  assert.equal(await f.repo.discovery.snapshot_get(source.id), undefined);
});
test("再次公开复用私密期间更新的 XML，覆盖旧公开缓存且不重新采集", async t => {
  const f = await fixture(t);
  const feed_url = "{{hostname}}/rss/preview/1?a=1&b=2";
  const data = await (await f.preview(feed_url)).json();
  const source = await f.save(feed_url, data.preview_id, {
    require_token: false
  });
  const patch = require_token => f.app.discovery.update_discovery_source(new Request("https://internal/source", {
    method: "PATCH",
    body: JSON.stringify({
      require_token
    })
  }), source.id);
  await patch(true);
  f.row.script = f.row.script.replace("预览文章", "新版文章");
  await f.app.scripts.serve_rss_route("rss", "/preview/1", new Request("https://internal/_admin/feed/rss/preview/1?b=2&a=1"), {
    refresh: true
  });
  assert.equal(f.executions, 2);
  await patch(false);
  assert.equal(f.published.sources[0].snapshot.articles[0].title, "新版文章");
  assert.match((await f.serve()).body, /新版文章/);
  assert.equal(f.executions, 2);
});
test("复用 XML 写入失败或脚本权限失效时，保留私密状态与原快照，不发布文章", async t => {
  const f = await fixture(t);
  const feed_url = "{{hostname}}/rss/preview/1?a=1&b=2";
  const data = await (await f.preview(feed_url)).json();
  const source = await f.save(feed_url, data.preview_id);
  const snapshot = await f.repo.discovery.snapshot_get(source.id);
  const publish = () => f.app.discovery.update_discovery_source(new Request("https://internal/source", {
    method: "PATCH",
    body: '{"require_token":false}'
  }), source.id);
  f.bucket.fail_next({
    op: "put"
  });
  await assert.rejects(publish(), /put failed/);
  f.app.discovery.check_cookie_permissions = async () => {
    throw await Object.assign(new Error("Cookie 权限已撤销"), {
      status: 409
    });
  };
  await assert.rejects(publish(), {
    status: 409
  });
  assert.equal((await f.repo.discovery.find(source.id)).require_token, 1);
  assert.deepEqual(await f.repo.discovery.snapshot_get(source.id), snapshot);
  assert.deepEqual(f.published.sources, []);
  await assert.rejects(f.serve(), {
    status: 401
  });
  assert.equal(f.executions, 1);
});
test("外部源读取一次即可保存广场快照，地址改变或临时缓存过期时不复用", async t => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches++;
    return new Response('<rss><channel><title>外部源</title><item><title>外部文章</title></item></channel></rss>');
  };
  for (const mode of ["matching", "changed", "expired", "invalidated", "private"]) {
    const f = await fixture(t);
    const feed_url = "https://example.com/" + mode + ".xml";
    const data = await (await f.preview(feed_url)).json();
    assert.ok(data.preview_id);
    if (mode === "expired") {
      f.sql.exec("UPDATE rss_route_cache SET expires_at = 1");
      f.app.discovery.route_cache = new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, 100, {
        store: f.repo.rss_route_cache,
        object_store: f.object_store
      });
    }
    if (mode === "invalidated") await f.app.discovery.route_cache.invalidate_all();
    const source = await f.save(mode === "changed" ? "https://example.com/other.xml" : feed_url, data.preview_id, {
      require_token: mode === "private"
    });
    if (mode === "matching") assert.equal(source.snapshot.articles[0].title, "外部文章");else assert.equal(source.snapshot.saved_at, 0);
  }
  assert.equal(fetches, 5);
});
test("已有 Cookie 授权在新增公开源后继续有效，保存即发布文章和 XML", async t => {
  const f = await fixture(t);
  const permissions = {
    cookies: [{
      id: "session",
      origin: "https://example.com",
      path_prefix: "/",
      names: ["SUB"],
      purpose: "读取登录内容"
    }]
  };
  const metadata = {
    ...JSON.parse(f.row.metadata_json),
    permissions,
    cookie_grant_id: "grant"
  };
  f.row.metadata_json = JSON.stringify(metadata);
  const grant = {
    script_id: f.row.route,
    script_hash: await sha256_hex(f.row.script),
    permissions_json: JSON.stringify({
      permissions,
      visibility: {
        ...f.app.scripts.cookie_visibility(metadata),
        public_sources: []
      }
    })
  };
  f.repo.rss_cookie_grants = {
    find: () => grant
  };
  const feed_url = "{{hostname}}/rss/preview/1?a=1&b=2";
  const response = await f.preview(feed_url);
  assert.equal(response.status, 200);
  const source = await f.save(feed_url, (await response.json()).preview_id, {
    require_token: false
  });
  assert.ok(source.snapshot.saved_at > 0);
  assert.equal(source.snapshot.error, "");
  assert.equal(source.snapshot.articles[0].title, "预览文章");
  assert.equal(source.cache.status, "fresh");
  assert.equal(f.published.sources[0].snapshot.articles[0].title, "预览文章");
  assert.equal((await f.app.scripts.check_cookie_permissions(f.row.route)).cookie_authorization.status, "active");
  assert.match((await f.serve()).body, /预览文章/);
  assert.equal(f.executions, 1);
});
test("读取信息后撤销 Cookie 授权，保存仍阻止发布预览文章和 XML", async t => {
  const f = await fixture(t);
  const permissions = {
    cookies: [{
      id: "session",
      origin: "https://example.com",
      path_prefix: "/",
      names: ["SUB"],
      purpose: "读取登录内容"
    }]
  };
  const metadata = {
    ...JSON.parse(f.row.metadata_json),
    permissions,
    cookie_grant_id: "grant"
  };
  f.row.metadata_json = JSON.stringify(metadata);
  let grant = {
    script_id: f.row.route,
    script_hash: await sha256_hex(f.row.script),
    permissions_json: JSON.stringify({
      permissions,
      visibility: f.app.scripts.cookie_visibility(metadata)
    })
  };
  f.repo.rss_cookie_grants = {
    find: () => grant
  };
  const feed_url = "{{hostname}}/rss/preview/1?a=1&b=2";
  const response = await f.preview(feed_url);
  assert.equal(response.status, 200);
  grant = null;
  const source = await f.save(feed_url, (await response.json()).preview_id, {
    require_token: false
  });
  assert.equal(source.snapshot.saved_at, 0);
  assert.match(source.snapshot.error, /Cookie 权限/);
  assert.equal(source.cache.status, "empty");
  assert.doesNotMatch(JSON.stringify(f.published), /预览文章|example.com\/article/);
  await assert.rejects(f.serve(), {
    status: 409
  });
});
