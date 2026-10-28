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
  assert.deepEqual(metadata.platform, { name: "网页", icon: "" });
  assert.deepEqual(metadata.tags, ["文章"]);
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
    { id: "first", title: "榜首", link: "https://example.com/first", thumbnail: "https://cdn.example.com/cover.jpg", rank: 1, heat: { value: 10, unit: "热度", text: "10" } },
  ];
  globalThis.fetch = async () => Response.json({ entries });
  const metadata = await compile(SCRIPT_AGENT_HOT_RANK_EXAMPLE);
  assert.equal(metadata.category, "科技");
  assert.equal(metadata.order, 10);
  const result = await execute_script(SCRIPT_AGENT_HOT_RANK_EXAMPLE, metadata);
  const snapshot = JSON.parse(result.output);
  assert.equal(snapshot.category, "科技");
  assert.equal(snapshot.kind, "hot_rank");
  assert.deepEqual(snapshot.entries.map(entry => entry.id), ["pinned", "first", "third"]);
  assert.deepEqual(snapshot.entries.map(entry => entry.rank), [null, 1, 3]);
  assert.equal(snapshot.entries[2].heat.value, 900);
  assert.equal(snapshot.entries[1].thumbnail, "https://cdn.example.com/cover.jpg");
  assert.equal("thumbnail" in snapshot.entries[0], false);
  assert.ok(Number.isFinite(Date.parse(snapshot.observed_at)));
  assert.equal("items" in snapshot, false);
  assert.ok(snapshot.entries.every(entry => !("published" in entry)));
  assert.throws(() => FeedModel.fromValue(snapshot), /items 必须是数组/);
  entries = [{ ...entries[0], rank: 0 }];
  await assert.rejects(execute_script(SCRIPT_AGENT_HOT_RANK_EXAMPLE, metadata), /正整数排名/);
});

test("热榜分类及页面顺序校验不影响旧脚本和 RSS，非法声明在编译时拒绝", async () => {
  const source = (declarations = "", payload = {}) => `/** HOT */
${declarations}
class Ranking extends HotRankScript { async fetch() { return Result.Ok(${JSON.stringify({ title: "榜单", link: "https://example.com/", entries: [], ...payload })}); } }
export const route = { path: '/rank-test', name: '排序测试', handler: ctx => new Ranking().run(ctx) };`;
  for (const order of [-10, 0, 20, Number.MAX_SAFE_INTEGER]) {
    const metadata = await compile(source(`export const category = ' 科技 '; export const order = ${order};`));
    assert.equal(metadata.category, "科技");
    assert.equal(metadata.order, order);
  }
  const legacy = await compile(source());
  assert.equal("category" in legacy, false);
  assert.equal("order" in legacy, false);
  for (const value of [null, 3, {}, "x".repeat(33), "科技\n", "科\u0000技"]) {
    const result = await compile_script_module(source(`export const category = ${JSON.stringify(value)};`));
    assert.match(result.error, /category/);
  }
  for (const value of ["1", null, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const result = await compile_script_module(source(`export const order = ${JSON.stringify(value)};`));
    assert.match(result.error, /order/);
  }
  for (const value of [undefined, null, "", " 小说 "]) {
    const script = source("", { category: value });
    const snapshot = JSON.parse((await execute_script(script, await compile(script))).output);
    assert.equal(snapshot.category, value?.trim() || undefined);
  }
  for (const value of [false, 2, {}, "x".repeat(33), "科\n技"]) {
    const script = source("", { category: value });
    await assert.rejects(execute_script(script, await compile(script)), /category/);
  }
  const rss = await compile(`/** RSS */ export const category = {}; export const order = 'legacy';
export const route = { path: '/rss-test', name: 'RSS 测试', handler: () => ({items:[]}) };`);
  assert.equal("category" in rss, false);
  assert.equal("order" in rss, false);
});

test("热榜缩略图可省略、为空或 null，有值时仅允许无凭据 HTTP(S) 绝对地址", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let entry = { id: "book", title: "小说", link: "https://example.com/book", rank: null, heat: { value: null, unit: "热度", text: "" } };
  globalThis.fetch = async () => Response.json({ entries: [entry] });
  const metadata = await compile(SCRIPT_AGENT_HOT_RANK_EXAMPLE);
  for (const thumbnail of [undefined, null, "", "https://cdn.example/cover.jpg?sign=a%2Fb&expires=123", "http://cdn.example/cover.png"]) {
    entry = { ...entry, thumbnail };
    const result = await execute_script(SCRIPT_AGENT_HOT_RANK_EXAMPLE, metadata);
    const row = JSON.parse(result.output).entries[0];
    if (thumbnail) assert.equal(row.thumbnail, thumbnail);
    else assert.equal("thumbnail" in row, false);
  }
  for (const thumbnail of ["/cover.jpg", "//cdn.example/cover.jpg", "javascript:alert(1)", "data:image/png,bad", "file:///cover", "https://user:secret@cdn.example/cover", "https:///cover", "https://cdn.example/cover\n.jpg", "https://cdn.example/cover\\name.jpg", {}, 123, false]) {
    entry = { ...entry, thumbnail };
    await assert.rejects(execute_script(SCRIPT_AGENT_HOT_RANK_EXAMPLE, metadata), error =>
      error.problem.code === "UPSTREAM_INVALID_RESPONSE" && /thumbnail/.test(error.message));
  }
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
