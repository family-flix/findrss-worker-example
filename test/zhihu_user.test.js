import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { RssRoutePatternModel } from "../server/domain/rss_route.js";
import { FeedModel } from "../server/domain/feed_format.js";
import { ScriptCookieAccess } from "../server/infra/script_cookie_access.js";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { compile_script_module, execute_script } = await import("../server/infra/script_sandbox.js");
const source = await readFile(new URL("../examples/scripts/rss/zhihu.js", import.meta.url), "utf8");
const compiled = await compile_script_module(source);
assert.equal(compiled.error, "");
const author = { name: "测试用户", avatar_url: "https://pic.example/avatar.jpg" };
const answer = { id: "9007199254740993", type: "answer", question: { id: "123", title: "问题" }, content: "<p>回答正文</p>", created_time: 1700000000, author };
const article = { id: "9007199254740993", type: "article", title: "文章", content: "<p>文章正文</p>", created: 1700000001, author };
const video = { id: "456", type: "zvideo", title: "视频", published_at: 1700000002, image_url: "https://pic.example/video.jpg", author };
const question = { id: "123", type: "question", title: "提问", detail: "<p>问题详情</p>", created: 1700000003, author };
const pin = { id: "789", type: "pin", created: 1700000004, author, content: [
  { type: "text", own_text: "<内容>\n第二行" },
  { type: "image", url: "https://pic.example/pin.jpg" },
  { type: "link", url: "javascript:alert(1)", title: "坏链接" },
] };
const cases = [
  { path: "/zhihu/people/:user", params: { user: "example" }, endpoint: "https://www.zhihu.com/api/v3/moments/example/activities", entries: [{ id: "activity-1", actor: author, action_text: "回答了问题", created_time: 1700000005, target: answer }], ids: ["zhihu:activity:activity-1"] },
  { path: "/zhihu/people/:user/answers", params: { user: "example" }, endpoint: "https://www.zhihu.com/api/v4/members/example/answers", entries: [answer], ids: ["zhihu:answer:" + answer.id] },
  { path: "/zhihu/people/:user/zvideos", params: { user: "example" }, endpoint: "https://www.zhihu.com/api/v4/members/example/zvideos", entries: [video], ids: ["zhihu:zvideo:456"] },
  { path: "/zhihu/people/:user/asks", params: { user: "example" }, endpoint: "https://www.zhihu.com/api/v4/members/example/questions", entries: [question], ids: ["zhihu:question:123"] },
  { path: "/zhihu/people/:user/posts", params: { user: "example" }, endpoint: "https://www.zhihu.com/api/v4/members/example/articles", entries: [article], ids: ["zhihu:article:" + article.id] },
  { path: "/zhihu/column/:column_id", params: { column_id: "googledevelopers" }, endpoint: "https://zhuanlan.zhihu.com/api/columns/googledevelopers/items", entries: [article, answer], ids: ["zhihu:article:" + article.id, "zhihu:answer:" + answer.id] },
  { path: "/zhihu/people/:user/pins", params: { user: "example" }, endpoint: "https://api.zhihu.com/pins/example/moments", entries: [{ target: pin }], ids: ["zhihu:pin:789"] },
  { path: "/zhihu/collection/:collection_id", params: { collection_id: "26444956" }, endpoint: "https://www.zhihu.com/api/v4/collections/26444956/items", entries: [answer, article, video, pin].map(content => ({ content })), ids: ["zhihu:pin:789", "zhihu:zvideo:456", "zhihu:article:" + article.id, "zhihu:answer:" + answer.id] },
];
const cookie_access = new ScriptCookieAccess({ permissions: compiled.metadata.permissions, assert_grant() {}, cookies: () => [] });
const run = (index, params = cases[index].params, query = {}) => execute_script(source,
  { ...compiled.metadata, ...compiled.metadata.routes[index] }, null,
  { method: "GET", pathname: compiled.metadata.routes[index].example, params, query, public_origin: "https://feeds.example" }, [], "", cookie_access);

test("知乎注册 8 条独立路由，user 参数一致", () => {
  assert.deepEqual(compiled.metadata.routes.map(route => route.path), cases.map(fixture => fixture.path));
  for (const [index, fixture] of cases.entries()) {
    const route = compiled.metadata.routes[index];
    assert.deepEqual(Object.keys(route.parameters), [...Object.keys(fixture.params), ...(index === 0 ? ["limit"] : [])]);
    const path = fixture.path.replace(/:(\w+)/g, (_, key) => fixture.params[key]);
    assert.deepEqual({ ...RssRoutePatternModel(route.path).match(path).params }, fixture.params);
  }
  assert.ok(compiled.metadata.routes.every(route => !route.path.includes(":kind")));
  assert.equal(new Set(compiled.metadata.routes.map(route => route.path)).size, 8);
  assert.equal(compiled.metadata.script_type, "rss");
  assert.equal(compiled.metadata.permissions.cookies.length, 3);
});

test("合并后的知乎动态保留独立脚本的混合内容，重复条目只输出一次", async t => {
  const original_fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = original_fetch; });
  const fixtures = JSON.parse(await readFile(new URL("./fixtures/script_migration.json", import.meta.url)));
  const fixture = fixtures.find(fixture => fixture.file === "zhihu" && !fixture.route_index);
  const body = JSON.parse(fixture.responses[0].body);
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).pathname, "/api/v3/moments/80-81-1-25-44/activities");
    const headers = new Headers(options.headers);
    assert.equal(headers.get("cache-control"), "no-cache");
    assert.equal(headers.get("sec-fetch-site"), "same-origin");
    return Response.json({ data: [...body.data, ...body.data] });
  };
  const feed = JSON.parse((await run(0, fixture.params)).output);
  assert.deepEqual(feed.items.map(item => item.id), ["zhihu:activity:a4", "zhihu:activity:a3", "zhihu:activity:a2", "zhihu:activity:a1"]);
  assert.equal(feed.items[3].content, "<p>回答正文</p>");
  assert.equal(feed.items[2].content, "<p>文章正文</p>");
  assert.match(feed.items[1].content, /&lt;内容&gt;/);
  assert.equal(feed.items[1].image, "https://pic.example/image.jpg");
  assert.doesNotMatch(feed.items[1].content, /javascript:/);
});

test("知乎动态保留 limit 默认值和 1–50 校验，限制数量且合并简介正文", async t => {
  const original_fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = original_fetch; });
  globalThis.fetch = async () => assert.fail("非法参数不可出站");
  for (const limit of ["0", "51", "-1", "1.5", "abc", ""]) {
    await assert.rejects(run(0, undefined, { limit }), error => error.problem?.code === "INVALID_PARAMETER");
  }
  const entries = Array.from({ length: 55 }, (_, index) => ({
    id: "activity-" + index, actor: author, action_text: "关注了话题", created_time: 1700000100 - index,
    target: { id: String(index + 1), type: "topic", title: "<b>话题</b>", introduction: "<p>话题简介</p>" },
  }));
  for (const [query, expected] of [[{}, 20], [{ limit: "1" }, 1], [{ limit: "50" }, 50]]) {
    globalThis.fetch = async url => {
      assert.equal(new URL(url).searchParams.get("limit"), String(expected));
      return Response.json({ data: entries.flatMap(entry => [entry, entry]) });
    };
    const feed = JSON.parse((await run(0, undefined, query)).output);
    assert.equal(feed.items.length, expected);
    assert.equal(new Set(feed.items.map(item => item.id)).size, expected);
    assert.equal(feed.items[0].title, "测试用户关注了话题：话题");
    assert.equal(feed.items[0].content, "<p>话题简介</p>");
  }
});

for (const [index, fixture] of cases.entries()) test("知乎 QuickJS：" + fixture.path, async t => {
  const original_fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = original_fetch; });
  let calls = 0;
  let entries = fixture.entries;
  globalThis.fetch = async (url, options) => {
    calls++;
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, fixture.endpoint);
    assert.equal(parsed.searchParams.get("limit"), "20");
    assert.equal(parsed.searchParams.get("offset"), "0");
    assert.ok(options.headers.referer.startsWith("https://"));
    if (index === 0) assert.equal(parsed.searchParams.get("desktop"), "true");
    if (index === 1 || index === 4) assert.equal(parsed.searchParams.get("sort_by"), "created");
    if (index === 2) assert.equal(parsed.searchParams.get("similar_aggregation"), "true");
    return new Response(JSON.stringify({ data: [...entries, ...entries] }));
  };
  const feed = JSON.parse((await run(index)).output);
  assert.equal(calls, 1);
  assert.deepEqual(feed.items.map(item => item.id), fixture.ids);
  assert.equal(feed.kind, "rss");
  for (const format of ["rss", "atom"]) assert.ok(FeedModel.fromValue(feed).render(format).includes(fixture.ids[0]));
  if (index === 0) {
    assert.equal(feed.items[0].title, "测试用户回答了问题：问题");
    assert.equal(feed.items[0].content, answer.content);
  }
  if (index === 2) {
    assert.equal(feed.items[0].image, video.image_url);
    assert.equal(feed.items[0].enclosure, undefined);
  }
  if (index === 3) assert.equal(feed.items[0].link, "https://www.zhihu.com/question/123");
  if (index === 6 || index === 7) {
    assert.match(feed.items[0].content, /&lt;内容&gt;<br>第二行/);
    assert.doesNotMatch(feed.items[0].content, /javascript:/);
    assert.equal(feed.items[0].image, "https://pic.example/pin.jpg");
  }
  entries = [];
  assert.deepEqual(JSON.parse((await run(index)).output).items, []);
});

test("知乎参数在出站前校验，各路由固定类型并拒绝损坏响应", async t => {
  const original_fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = original_fetch; });
  globalThis.fetch = () => assert.fail("非法参数不可出站");
  for (const [index, fixture] of cases.entries()) {
    const key = Object.keys(fixture.params)[0];
    for (const value of ["", "../bad", "bad/name", "a".repeat(129)]) await assert.rejects(run(index, { [key]: value }), /无效/);
  }
  await assert.rejects(run(7, { collection_id: "abc" }), /必须为数字/);
  let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    assert.match(url, /\/answers\?/);
    return new Response(JSON.stringify({ data: [answer] }));
  };
  assert.equal(JSON.parse((await run(1, { user: "example", kind: "posts" })).output).items[0].id, "zhihu:answer:" + answer.id);
  assert.equal(calls, 1);
  for (const body of ["<html>验证码</html>", "null", "{}", '{"data":null}', '{"need_force_login":true,"data":[]}', '{"error":{},"data":[]}']) {
    globalThis.fetch = async () => new Response(body);
    await assert.rejects(run(1), /Cookie/);
  }
  for (const entry of [{ ...answer, id: 9007199254740992 }, { ...answer, question: { id: "bad" } }]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ data: [entry] }));
    await assert.rejects(run(1), /ID/);
  }
});
