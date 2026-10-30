import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { RssRouteCache } from "../server/infra/rss_cache.js";
import { snapshot_store } from "./support/snapshot_store.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const {
  ServiceScript
} = await import("../server/service/application/scripts.js");
test("管理预览执行指定停用脚本，不被更具体路由或公开缓存覆盖；公开请求不能指定脚本", async () => {
  const row = (id, path, name, enabled) => ({
    route: id,
    path,
    enabled,
    metadata_json: JSON.stringify({
      path,
      name
    }),
    script: `export const route = { handler(ctx) { return {title: ${JSON.stringify(name)} + ':' + (ctx.params.uid || '') + ':' + (ctx.query.offset || ''), items: []}; } };`
  });
  const disabled = row("disabled-script", "/user/:uid", "停用", 0);
  const specific = row("specific-script", "/user/list", "公开", 1);
  const cache = new RssRouteCache(60000, 100);
  const service = new ServiceScript({
    repo: {
      rss_route_cache: snapshot_store().repo,
      scripts: {
        list_enabled: () => [specific],
        find_config: id => id === disabled.route ? disabled : id === specific.route ? specific : undefined
      },
      rss_cookies: {
        get: () => []
      }
    },
    ports: {
      route_cache: cache
    },
    app: {}
  });
  service.rss_address_is_public = () => true;
  const request = (admin, id = disabled.route) => new Request("https://internal/" + (admin ? "_admin" : "_public") + "/feed/rss/user/list?offset=3", {
    headers: {
      "X-RSS-Preview-Script-ID": id
    }
  });
  const normal = await service.serve_rss_route("rss", "/user/list", request(false), {
    refresh: true
  });
  assert.match(normal.body, /公开::3/);
  const preview = await service.serve_rss_route("rss", "/user/list", request(true));
  assert.match(preview.body, /停用:list:3/);
  assert.equal(cache.stats().entries, 2);
  assert.match((await service.serve_rss_route("rss", "/user/list", request(false))).body, /公开::3/);
  await assert.rejects(service.serve_rss_route("rss", "/user/list", request(true, "missing")), error => error.status === 404);
});
