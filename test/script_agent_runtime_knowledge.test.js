import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { FeedModel } from "../server/domain/feed_format.js";
import { ScriptCookieAccess } from "../server/infra/script_cookie_access.js";
import { SCRIPT_AGENT_UTIL_EXAMPLE, SCRIPT_AGENT_HOT_RANK_EXAMPLE, SCRIPT_AGENT_COOKIE_EXAMPLE } from "../server/lib/script_agent_runtime_knowledge.js";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { compile_script_module, execute_script } = await import("../server/infra/script_sandbox.js");
async function compile(source) {
  const result = await compile_script_module(source);
  assert.equal(result.error, "");
  return result.metadata;
}

test("知识中的 RSS 工具示例实际抓取、校验、排序、渲染和记录日志；解析失败透传 Result", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let response = JSON.stringify({ data: { items: [
    { id: "old", title: "旧 &amp; 内容", url: "/old", published: 1700000000 },
    { id: "new", title: "<b>新内容</b>", url: "/new", published: "2026/10/14 08:00", content: "<p>原文 &amp; 图片</p>" },
    { id: "old", title: "重复", url: "/old", published: 1700000000 },
    { id: "unknown", title: "无发布时间", url: "/unknown" },
  ] } });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://example.com/api/articles");
    assert.equal(options.headers.referer, "https://example.com/");
    assert.equal(options.headers.Cookie, undefined);
    return new Response(response);
  };
  const metadata = await compile(SCRIPT_AGENT_UTIL_EXAMPLE);
  const result = await execute_script(SCRIPT_AGENT_UTIL_EXAMPLE, metadata);
  const feed = JSON.parse(result.output);
  assert.deepEqual(feed.items.map(item => item.id), ["new", "old", "unknown"]);
  assert.equal(feed.items[0].published, "2026-10-14T00:00:00.000Z");
  assert.equal(feed.items[1].title, "旧 & 内容");
  assert.equal(feed.items[2].published, undefined);
  assert.equal(feed.items[0].link, "https://example.com/new");
  assert.equal(feed.items[0].content, "<p>原文 &amp; 图片</p>");
  assert.ok(FeedModel.fromValue(feed).render("rss").includes("&lt;p&gt;原文 &amp;amp; 图片&lt;/p&gt;"));
  assert.match(result.lines.map(line => line.text).join("\n"), /解析文章列表[\s\S]*RSS 内容完成/);
  for (const invalid of ["{broken}", JSON.stringify({ data: { items: {} } }), JSON.stringify({ data: { items: [{ id: 9007199254740992 }] } })]) {
    response = invalid;
    await assert.rejects(execute_script(SCRIPT_AGENT_UTIL_EXAMPLE, metadata), error => error.problem.code === "UPSTREAM_INVALID_RESPONSE");
  }
});

test("知识中的热榜示例保留上游 rank 与 heat，不输出 items 或 published", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let entries = [
    { id: "third", title: "热度高", link: "https://example.com/third", rank: 3, heat: { value: 900, unit: "热度", text: "900" } },
    { id: "pinned", title: "置顶", link: "https://example.com/pinned", rank: null, pinned: true, heat: { value: null, unit: "热度", text: "" } },
    { id: "first", title: "榜首", link: "https://example.com/first", rank: 1, heat: { value: 10, unit: "热度", text: "10" } },
  ];
  globalThis.fetch = async () => Response.json({ entries });
  const metadata = await compile(SCRIPT_AGENT_HOT_RANK_EXAMPLE);
  const result = await execute_script(SCRIPT_AGENT_HOT_RANK_EXAMPLE, metadata);
  const snapshot = JSON.parse(result.output);
  assert.equal(snapshot.kind, "hot_rank");
  assert.deepEqual(snapshot.entries.map(entry => entry.id), ["pinned", "first", "third"]);
  assert.deepEqual(snapshot.entries.map(entry => entry.rank), [null, 1, 3]);
  assert.equal(snapshot.entries[2].heat.value, 900);
  assert.ok(Number.isFinite(Date.parse(snapshot.observed_at)));
  assert.equal("items" in snapshot, false);
  assert.ok(snapshot.entries.every(entry => !("published" in entry)));
  assert.throws(() => FeedModel.fromValue(snapshot), /items 必须是数组/);
  entries = [{ ...entries[0], rank: 0 }];
  await assert.rejects(execute_script(SCRIPT_AGENT_HOT_RANK_EXAMPLE, metadata), /正整数排名/);
});

test("知识中的 Cookie 示例声明精确权限；未经授权不请求，授权后只发送指定 Cookie", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response("<p>账户页面</p>");
  };
  const metadata = await compile(SCRIPT_AGENT_COOKIE_EXAMPLE);
  assert.deepEqual(metadata.permissions.cookies[0], { id: "account", origin: "https://example.com", path_prefix: "/account/", names: ["session"], purpose: "读取用户授权的登录账户页面" });
  await assert.rejects(execute_script(SCRIPT_AGENT_COOKIE_EXAMPLE, metadata), /Cookie 权限/);
  assert.equal(requests.length, 0);
  const access = new ScriptCookieAccess({ permissions: metadata.permissions, assert_grant: () => {}, cookies: () => [
    { name: "session", value: "test-secret", domain: "example.com", path: "/", secure: true },
    { name: "other", value: "never-send", domain: "example.com", path: "/", secure: true },
  ] });
  const result = await execute_script(SCRIPT_AGENT_COOKIE_EXAMPLE, metadata, null, undefined, [], "", access);
  assert.equal(requests[0].url, "https://example.com/account/profile");
  assert.equal(requests[0].options.headers.Cookie, "session=test-secret");
  assert.equal(JSON.parse(result.output).body, "<p>账户页面</p>");
  assert.doesNotMatch(JSON.stringify(result), /test-secret|never-send/);
  assert.match(result.lines[0].text, /账户页面获取完成/);
});
