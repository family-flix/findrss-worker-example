import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { create_worker } from "../router.js";
import { handle_admin_request } from "../admin.js";
import { feed_hostname_origin } from "../server/service/worker/discovery.js";
import { RssRouteCache } from "../server/infra/rss_cache.js";
import { snapshot_store } from "./support/snapshot_store.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const {
  compile_script_module
} = await import("../server/infra/script_sandbox.js");
const {
  ServiceScript
} = await import("../server/service/application/scripts.js");
const {
  route: dispatch
} = await import("../application_router.js");
const {
  default: api
} = await import("../api.js");

// 复现公众号脚本：真实 QuickJS 中缺少 origin 就返回相同业务错误。
const source = `class ImageFeed extends RSSScript {
  async fetch(ctx) {
    if (!ctx.public_origin) return Result.Err("公众号图片代理需要配置 FEED_HOSTNAME");
    return Result.Ok({ title: "图片源", link: "https://mp.weixin.qq.com/", items: [],
      image: ctx.public_origin + "/wxmpimgproxy?url=" + encodeURIComponent("https://mmbiz.qpic.cn/a") });
  }
}
export const route = { path: "/origin/:id", name: "图片源", url: "mp.weixin.qq.com",
  maintainers: [], parameters: {}, description: "", example: "/origin/example", public: true,
  handler: ctx => new ImageFeed().run(ctx) };`;
async function setup(t, configured) {
  const compiled = await compile_script_module(source);
  assert.equal(compiled.error, "");
  const row = {
    route: "origin-script",
    path: compiled.metadata.path,
    script: source,
    enabled: 1,
    metadata_json: JSON.stringify(compiled.metadata),
    updated_at: 1
  };
  const store = snapshot_store();
  t.after(async () => await store.db.close());
  // DO 使用原始配置，不继承外层 Worker 临时补全的 env。
  const service = new ServiceScript({
    public_origin: feed_hostname_origin(configured),
    repo: {
      scripts: {
        list_enabled: () => [row]
      },
      rss_cookies: {
        get: () => []
      },
      rss_route_cache: store.repo
    },
    ports: {
      route_cache: new RssRouteCache(60000, 100)
    },
    app: {}
  });
  service.rss_address_is_public = () => true;
  service.record_log = () => {};
  const env = {
    ...configured,
    ADMIN_PASSWORD: "test-admin",
    APPLICATION: (() => ({
      fetch: request => dispatch(request, {
        scripts: service
      })
    }))()
  };
  const worker = create_worker({
    api,
    admin: handle_admin_request,
    discovery: async () => new Response("not found", {
      status: 404
    })
  });
  const origin = "http://127.0.0.1:8787";
  return {
    service,
    origin,
    fetch: async (path, body) => await worker.fetch(new Request(origin + path, body === undefined ? {} : {
      method: "POST",
      headers: {
        Authorization: "Bearer test-admin",
        "Content-Type": "application/json",
        "X-Feed-Public-URL": "https://spoofed.example"
      },
      body: JSON.stringify(body)
    }), env)
  };
}
test("旧 FEED_HOSTNAME 可归一化，FINDRSS_HOSTNAME 非空时优先", () => {
  assert.equal(feed_hostname_origin({
    FEED_HOSTNAME: " legacy.example/ "
  }), "https://legacy.example");
  assert.equal(feed_hostname_origin({
    FINDRSS_HOSTNAME: "  ",
    FEED_HOSTNAME: "http://localhost:8787/"
  }), "http://localhost:8787");
  assert.equal(feed_hostname_origin({
    FINDRSS_HOSTNAME: "canonical.example",
    FEED_HOSTNAME: "legacy.example"
  }), "https://canonical.example");
});
for (const [name, configured, expected] of [["未配置", {}, "http://127.0.0.1:8787"], ["旧变量", {
  FEED_HOSTNAME: "legacy.example/"
}, "https://legacy.example"], ["新变量", {
  FINDRSS_HOSTNAME: "https://canonical.example/"
}, "https://canonical.example"], ["同时配置", {
  FINDRSS_HOSTNAME: "canonical.example",
  FEED_HOSTNAME: "legacy.example"
}, "https://canonical.example"]]) test(`${name}：Mock、草稿 Debug、预览和公开快照使用同一图片代理域名`, async t => {
  const app = await setup(t, configured);
  const image = expected + "/wxmpimgproxy?url=" + encodeURIComponent("https://mmbiz.qpic.cn/a");
  const mock = await (await app.fetch("/admin/api/scripts/test", {
    script: source
  })).json();
  assert.equal(mock.ok, true, mock.error);
  assert.equal(JSON.parse(mock.preview).image, image);
  const debug = await (await app.fetch("/admin/api/scripts/debug", {
    script: source,
    request_url: "/debug/origin/actual"
  })).json();
  assert.equal(debug.ok, true, debug.rss_debug?.error_text);
  assert.equal(JSON.parse(debug.rss_debug.output).image, image);
  const preview_response = await app.fetch("/admin/api/discovery/preview", {
    feed_url: "/rss/origin/actual",
    include_feed: true
  });
  assert.equal(preview_response.status, 200);
  assert.equal((await preview_response.json()).feed.icon, image);

  // 首次访问启动生成任务，由后台使用已传递的公开地址执行脚本。
  assert.equal((await app.fetch("/rss/origin/public")).status, 503);
  await Promise.all(app.service.xml_tasks.values());
  const response = await app.fetch("/rss/origin/public");
  assert.equal(response.status, 200);
  assert.ok((await response.text()).includes(image));
});
