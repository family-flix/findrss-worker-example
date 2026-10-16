import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { readFile } from "node:fs/promises";
import { ScriptCookieAccess } from "../server/infra/script_cookie_access.js";
import { discovery_feed_defaults } from "../server/infra/feed_fetch.js";
import { FeedModel } from "../server/domain/feed_format.js";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { compile_script_module, execute_script } = await import("../server/infra/script_sandbox.js");

test("微博示例头像经图片代理输出到 RSS 和 Atom，代理保留头像原图及 Referer", async t => {
  const source = await readFile(new URL("../examples/scripts/rss/weibo.js", import.meta.url), "utf8");
  const compiled = await compile_script_module(source);
  assert.equal(compiled.error, "");
  assert.deepEqual(compiled.metadata.routes.map(route => route.path), ["/weibo/u/:uid", "/img/weibo"]);
  const avatar = "https://tvax3.sinaimg.cn/crop.0.0.1080.1080.1024/avatar.jpg";
  const origin = "http://127.0.0.1:8787";
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async url => url.includes("/ajax/profile/")
    ? Response.json({ ok: 1, data: { user: { screen_name: "微博用户", avatar_hd: avatar } } })
    : new Response('<script type="application/json">{"idstr":"1","text_raw":"正文","user":{}}</script>');
  const permissions = compiled.metadata.permissions;
  const access = new ScriptCookieAccess({ permissions, cookies: () => [], assert_grant: () => {} });
  const metadata = { ...compiled.metadata, ...compiled.metadata.routes[0] };
  const result = await execute_script(source, metadata, null, { method: "GET", pathname: "/rss/weibo/u/123",
    params: { uid: "123" }, query: {}, public_origin: origin }, [], "", access);
  assert.ok(!result.error, result.error);
  const feed = JSON.parse(result.output);
  const proxy_url = origin + "/img/weibo?url=" + encodeURIComponent(avatar);
  assert.equal(feed.image, proxy_url);
  for (const format of ["rss", "atom"]) {
    assert.equal(discovery_feed_defaults(FeedModel(feed).render(format), origin + "/" + format + "/weibo/u/123").avatar_url, proxy_url);
  }
  const proxy = await execute_script(source, { ...compiled.metadata, ...compiled.metadata.routes[1] }, null,
    { method: "GET", pathname: "/img/weibo", params: {}, query: { url: avatar }, public_origin: origin }, [], "", access);
  assert.ok(!proxy.error, proxy.error);
  const descriptor = JSON.parse(proxy.output);
  assert.equal(descriptor.url, avatar);
  assert.equal(descriptor.headers.Referer, "https://weibo.com/");
});
