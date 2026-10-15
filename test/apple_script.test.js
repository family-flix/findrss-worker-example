import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { FeedModel } from "../server/domain/feed_format.js";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { compile_script_module, execute_script } = await import("../server/infra/script_sandbox.js");
const source = await readFile(new URL("../examples/scripts/rss/apple.js", import.meta.url), "utf8");
const compiled = await compile_script_module(source);
assert.equal(compiled.error, "");
const metadata = compiled.metadata;
const fixture = () => ({ data: [{ attributes: {
  name: "Example App", artistName: "Example Developer",
  platformAttributes: {
    ios: {
      description: { standard: "应用简介\n第二行" },
      iconArtwork: { url: "https://example.com/art/{w}x{h}{c}.{f}" },
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
  });
  return JSON.parse(result.output);
};

test("Apple 示例在真实 QuickJS 合并平台、排序、去重，保留稳定 ID、正文和 RSS/Atom 元数据", async t => {
  assert.equal(metadata.routes[0].path, "/apple/apps/update/:country/:id/:platform?");
  assert.equal(metadata.kind, "rss");
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
  assert.equal(feed.image, "https://example.com/art/3000x3000bb.webp");
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
