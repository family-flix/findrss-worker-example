import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { FeedModel } from "../server/domain/feed_format.js";
import { script_output } from "../server/lib/script_output.js";
import { fetch_script_image } from "../server/infra/image_proxy.js";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { compile_script_module, execute_script } = await import("../server/infra/script_sandbox.js");
const source = await readFile(new URL("../examples/scripts/rss/apple.js", import.meta.url), "utf8");
const compiled = await compile_script_module(source);
assert.equal(compiled.error, "");
const metadata = compiled.metadata;
const public_origin = "https://feeds.example";
const proxy_image = url => public_origin + "/img/apple?url=" + encodeURIComponent(url);
const fixture = () => ({ data: [{ attributes: {
  name: "Example App", artistName: "Example Developer",
  platformAttributes: {
    ios: {
      description: { standard: "应用简介\n第二行" },
      iconArtwork: { url: "https://is1-ssl.mzstatic.com/art/{w}x{h}{c}.{f}" },
      versionHistory: [
        { versionDisplay: "1.0", releaseTimestamp: "2026-10-10T10:00:00Z", releaseNotes: "旧版本" },
        { versionDisplay: "2.0", releaseTimestamp: "2026-10-14T10:00:00Z", releaseNotes: '修复 <问题> & 优化\r\n支持 "新功能"' },
        { versionDisplay: "2.0", releaseTimestamp: "2026-10-14T10:00:00Z", releaseNotes: "重复记录" },
        { versionDisplay: "0.5", releaseNotes: "未知日期" },
      ],
    },
    osx: {
      description: { standard: "Mac 应用简介" },
      versionHistory: [{ versionDisplay: "2.0", releaseTimestamp: "2026-10-15T09:00:00+08:00", releaseNotes: "Mac 更新" }],
    },
    appletvos: { versionHistory: [] },
  },
} }] });
const run = async (params = {}, query = {}) => {
  const result = await execute_script(source, metadata, null, {
    method: "GET", pathname: "/apple/apps/update/us/id408709785",
    params: { country: "us", id: "id408709785", ...params }, query,
    public_origin,
  });
  return JSON.parse(result.output);
};

test("Apple 示例在真实 QuickJS 合并平台、排序、去重，保留稳定 ID、正文和 RSS/Atom 元数据", async t => {
  assert.equal(metadata.routes[0].path, "/apple/apps/update/:country/:id/:platform?");
  assert.equal(metadata.kind, "rss");
  assert.deepEqual(metadata.routes.map(route => route.path), ["/apple/apps/update/:country/:id/:platform?", "/img/apple"]);
  const original_fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = original_fetch; });
  let requests = 0;
  globalThis.fetch = async (input, options) => {
    requests++;
    const url = new URL(input);
    assert.equal(url.origin + url.pathname, "https://apps.apple.com/api/apps/v1/catalog/us/apps/408709785");
    assert.equal(url.searchParams.get("extend"), "description,iconArtwork,versionHistory");
    assert.equal(url.searchParams.get("platform"), "iphone");
    assert.equal(url.searchParams.get("additionalPlatforms"), "appletv,ipad,iphone,mac,realityDevice,watch");
    const headers = new Headers(options.headers);
    assert.equal(headers.get("authorization"), "Bearer");
    assert.equal(headers.get("origin"), "https://apps.apple.com");
    return Response.json(fixture());
  };
  const feed = await run();
  assert.equal(requests, 1);
  assert.equal(feed.title, "Example App - Apple App Store");
  assert.equal(feed.author, "Example Developer");
  assert.equal(feed.language, "en-US");
  assert.equal(feed.image, proxy_image("https://is1-ssl.mzstatic.com/art/400x400bb.webp"));
  assert.deepEqual(feed.items.map(item => item.id), [
    "apple/apps/us/id408709785/osx#2.0", "apple/apps/us/id408709785/ios#2.0",
    "apple/apps/us/id408709785/ios#1.0", "apple/apps/us/id408709785/ios#0.5",
  ]);
  assert.equal(feed.updated, "2026-10-15T01:00:00.000Z");
  assert.equal(feed.items.at(-1).published, undefined);
  assert.deepEqual(feed.items[0].categories, ["macOS"]);
  assert.equal(feed.items[1].content, "修复 &lt;问题&gt; &amp; 优化<br>支持 &quot;新功能&quot;");
  for (const format of ["rss", "atom"]) {
    const xml = FeedModel.fromValue(feed).render(format);
    assert.match(xml, /apple\/apps\/us\/id408709785\/osx#2.0/);
    if (format === "atom") assert.match(xml, /Example Developer/);
    assert.match(xml, /macOS/);
    assert.doesNotMatch(xml, /undefined|NaN/);
  }
});

test("Apple 示例支持平台别名、大小写、纯数字 ID、limit 和空历史，未知平台回退全部", async t => {
  const original_fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = original_fetch; });
  globalThis.fetch = async () => Response.json(fixture());
  for (const [platform, expected] of [["ios", "iOS"], ["macos", "macOS"], ["osx", "macOS"], ["MACOS", "macOS"]]) {
    const feed = await run({ country: "US", id: "408709785", platform }, { limit: "1" });
    assert.equal(feed.title, "Example App for " + expected + " - Apple App Store");
    assert.equal(feed.items.length, 1);
    assert.deepEqual(feed.items[0].categories, [expected]);
    assert.equal(feed.items[0].link, "https://apps.apple.com/us/app/id408709785");
    if (platform === "ios") assert.equal(feed.description, "应用简介 第二行");
  }
  for (const platform of ["all", "ALL", "unknown", "constructor"]) {
    assert.equal((await run({ platform })).items.length, 4);
  }
  for (const platform of ["tvos", "appletvos"]) {
    assert.deepEqual((await run({ platform })).items, []);
  }
});

test("Apple 接口缺少图标时从应用页面 srcset 读取 logo，RSS 和 Atom 使用真实图片", async t => {
  const original_fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = original_fetch; });
  const html = await readFile(new URL("./fixtures/apple_app_icon.html", import.meta.url), "utf8");
  const body = fixture();
  delete body.data[0].attributes.platformAttributes.ios.iconArtwork;
  const expected = proxy_image("https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/33/4a/b8/334ab8fd-5176-28fe-2359-72132fe81d85/Placeholder.mill/200x200bb-75.webp");
  const requests = [];
  globalThis.fetch = async (input, options) => {
    requests.push(String(input));
    if (String(input).includes("/api/apps/")) return Response.json(body);
    assert.equal(new Headers(options.headers).get("accept"), "text/html");
    return new Response(html);
  };
  const feed = await run();
  assert.equal(requests.length, 2);
  assert.equal(requests[1], "https://apps.apple.com/us/app/id408709785");
  assert.equal(feed.image, expected);
  assert.equal(feed.items.length, 4);
  assert.ok(FeedModel.fromValue(feed).render("rss").includes("<url>" + expected + "</url>"));
  assert.ok(FeedModel.fromValue(feed).render("atom").includes("<logo>" + expected + "</logo>"));
});

test("Apple 页面缺少 logo 或不可用时保留版本订阅，拒绝非法图片 URL", async t => {
  const original_fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = original_fetch; });
  const body = fixture();
  delete body.data[0].attributes.platformAttributes.ios.iconArtwork;
  for (const page of [
    () => new Response('<div class="app-icon"><picture><img src="/assets/artwork/1x1.gif"></picture></div>'),
    () => new Response("unavailable", { status: 503 }),
  ]) {
    globalThis.fetch = async input => String(input).includes("/api/apps/") ? Response.json(body) : page();
    const feed = await run();
    assert.equal(feed.image, undefined);
    assert.equal(feed.items.length, 4);
  }
  globalThis.fetch = async input => String(input).includes("/api/apps/") ? Response.json(body)
    : new Response('<div class="app-icon"><picture><source srcset="javascript:bad 200w"></picture></div>');
  await assert.rejects(run(), error => error.problem?.code === "UPSTREAM_INVALID_RESPONSE");
});

test("Apple 图片代理转发浏览器请求头、返回图片，并限制 HTTPS CDN 目标", async () => {
  const route = metadata.routes[1];
  assert.equal(route.public, true);
  const target = "https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/33/4a/b8/334ab8fd-5176-28fe-2359-72132fe81d85/Placeholder.mill/400x400bb.webp";
  const result = await execute_script(source, { ...metadata, ...route }, null, {
    method: "GET", pathname: "/img/apple", params: {}, query: { url: target }, public_origin,
  });
  const output = script_output(route, JSON.parse(result.output));
  const descriptor = output.descriptor;
  assert.equal(descriptor.url, target);
  assert.equal(descriptor.headers.referer, "https://apps.apple.com/");
  assert.match(descriptor.headers["user-agent"], /Chrome\/155\.0\.0\.0/);
  assert.match(descriptor.headers.accept, /^image\/webp,/);
  assert.equal(descriptor.headers["accept-language"], "zh-CN,zh;q=0.9,en;q=0.8");
  assert.equal(descriptor.headers["cache-control"], "no-cache");
  assert.equal(descriptor.headers.pragma, "no-cache");
  assert.equal(descriptor.headers.priority, "i");
  assert.equal(descriptor.headers["sec-ch-ua"], '"Google Chrome";v="155", "Chromium";v="155", "Not(A:Brand";v="24"');
  assert.equal(descriptor.headers["sec-ch-ua-mobile"], "?0");
  assert.equal(descriptor.headers["sec-ch-ua-platform"], '"macOS"');
  assert.equal(descriptor.headers["sec-fetch-dest"], "image");
  assert.equal(descriptor.headers["sec-fetch-mode"], "no-cors");
  assert.equal(descriptor.headers["sec-fetch-site"], "cross-site");
  assert.equal(descriptor.headers["sec-fetch-storage-access"], "active");
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  const image = await fetch_script_image(route, descriptor, async (url, options) => {
    assert.equal(url, target);
    assert.deepEqual(options.headers, descriptor.headers);
    return new Response(png, { headers: { "Content-Type": "image/png" } });
  });
  assert.equal(image.content_type, "image/png");
  assert.deepEqual(image.body, png);
  for (const url of [
    "http://is1-ssl.mzstatic.com/a", "https://is1-ssl.mzstatic.com:8443/a",
    "https://is1-ssl.mzstatic.com.evil.example/a", "https://127.0.0.1/a",
    "https://user:password@is1-ssl.mzstatic.com/a", "javascript:bad", "",
  ]) {
    assert.throws(() => script_output(route, { ...descriptor, url }));
  }
});

test("Apple 图标需要公开域名才能生成绝对代理地址", async t => {
  const original_fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = original_fetch; });
  globalThis.fetch = async () => Response.json(fixture());
  await assert.rejects(execute_script(source, metadata, null, {
    method: "GET", pathname: "/apple/apps/update/us/id408709785",
    params: { country: "us", id: "408709785" }, query: {},
  }), /FINDRSS_HOSTNAME/);
});

test("Apple 示例在抓取前拒绝非法参数，上游缺字段和坏 JSON 失败而不伪造空订阅", async t => {
  const original_fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = original_fetch; });
  globalThis.fetch = async () => assert.fail("非法参数不应发出请求");
  for (const [params, query] of [
    [{ country: "../us" }, {}], [{ id: "id0" }, {}], [{ id: "1?x=2" }, {}], [{ platform: "../macos" }, {}],
    [{}, { limit: "0" }], [{}, { limit: "-1" }], [{}, { limit: "1001" }], [{}, { limit: "1.5" }], [{}, { limit: "2x" }],
  ]) {
    await assert.rejects(run(params, query), error => error.problem?.code === "INVALID_PARAMETER");
  }
  const missing_version = fixture();
  delete missing_version.data[0].attributes.platformAttributes.ios.versionHistory[0].versionDisplay;
  const bad_date = fixture();
  bad_date.data[0].attributes.platformAttributes.ios.versionHistory[0].releaseTimestamp = "invalid";
  for (const body of [{}, { data: [] }, { data: [{ attributes: { name: "App", platformAttributes: {} } }] },
    { data: [{ attributes: { name: "App", platformAttributes: { ios: {} } } }] }, missing_version, bad_date]) {
    globalThis.fetch = async () => Response.json(body);
    await assert.rejects(run(), error => error.problem?.code === "UPSTREAM_INVALID_RESPONSE");
  }
  globalThis.fetch = async () => new Response("not json");
  await assert.rejects(run());
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  await assert.rejects(run());
});
