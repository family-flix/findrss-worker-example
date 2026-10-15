import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { RssRoutePatternModel } from "../server/domain/rss_route.js";
import { FeedModel } from "../server/domain/feed_format.js";
import { ScriptCookieAccess } from "../server/infra/script_cookie_access.js";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { compile_script_module, execute_script } = await import("../server/infra/script_sandbox.js");
const source = await readFile(new URL("../examples/rss/zhihu_user.js", import.meta.url), "utf8");
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
  { path: "/zhihu/people/:user_id", params: { user_id: "example" }, endpoint: "https://www.zhihu.com/api/v3/moments/example/activities", entries: [{ id: "activity-1", actor: author, action_text: "回答了问题", created_time: 1700000005, target: answer }], ids: ["zhihu:activity:activity-1"] },
  { path: "/zhihu/people/:user_id/answers", params: { user_id: "example" }, endpoint: "https://www.zhihu.com/api/v4/members/example/answers", entries: [answer], ids: ["zhihu:answer:" + answer.id] },
  { path: "/zhihu/people/:user_id/zvideos", params: { user_id: "example" }, endpoint: "https://www.zhihu.com/api/v4/members/example/zvideos", entries: [video], ids: ["zhihu:zvideo:456"] },
  { path: "/zhihu/people/:user_id/asks", params: { user_id: "example" }, endpoint: "https://www.zhihu.com/api/v4/members/example/questions", entries: [question], ids: ["zhihu:question:123"] },
  { path: "/zhihu/people/:user_id/posts", params: { user_id: "example" }, endpoint: "https://www.zhihu.com/api/v4/members/example/articles", entries: [article], ids: ["zhihu:article:" + article.id] },
  { path: "/zhihu/column/:column_id", params: { column_id: "googledevelopers" }, endpoint: "https://zhuanlan.zhihu.com/api/columns/googledevelopers/items", entries: [article, answer], ids: ["zhihu:article:" + article.id, "zhihu:answer:" + answer.id] },
  { path: "/zhihu/people/:user_id/pins", params: { user_id: "example" }, endpoint: "https://api.zhihu.com/pins/example/moments", entries: [{ target: pin }], ids: ["zhihu:pin:789"] },
  { path: "/zhihu/collection/:collection_id", params: { collection_id: "26444956" }, endpoint: "https://www.zhihu.com/api/v4/collections/26444956/items", entries: [answer, article, video, pin].map(content => ({ content })), ids: ["zhihu:pin:789", "zhihu:zvideo:456", "zhihu:article:" + article.id, "zhihu:answer:" + answer.id] },
];
const cookie_access = new ScriptCookieAccess({ permissions: compiled.metadata.permissions, assert_grant() {}, cookies: () => [] });
const run = (index, params = cases[index].params) => execute_script(source,
  { ...compiled.metadata, ...compiled.metadata.routes[index] }, null,
  { method: "GET", pathname: compiled.metadata.routes[index].example, params, query: {}, public_origin: "https://feeds.example" }, [], "", cookie_access);

test("知乎注册 8 条独立路由，user_id 参数一致", () => {
  assert.deepEqual(compiled.metadata.routes.map(route => route.path), cases.map(fixture => fixture.path));
  for (const [index, fixture] of cases.entries()) {
    const route = compiled.metadata.routes[index];
    assert.deepEqual(Object.keys(route.parameters), Object.keys(fixture.params));
    const path = fixture.path.replace(/:(\w+)/g, (_, key) => fixture.params[key]);
    assert.deepEqual({ ...RssRoutePatternModel(route.path).match(path).params }, fixture.params);
  }
  assert.ok(compiled.metadata.routes.every(route => !route.path.includes(":kind")));
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
  for (const format of ["rss", "atom"]) assert.ok(FeedModel(feed).render(format).includes(fixture.ids[0]));
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
  assert.equal(JSON.parse((await run(1, { user_id: "example", kind: "posts" })).output).items[0].id, "zhihu:answer:" + answer.id);
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
