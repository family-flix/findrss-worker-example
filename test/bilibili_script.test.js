import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { createHash } from "node:crypto";
import { RssRoutePatternModel } from "../server/domain/rss_route.js";
import { FeedModel } from "../server/domain/feed_format.js";
import { ScriptCookieAccess } from "../server/infra/script_cookie_access.js";
import { mock_tcp_http } from "./support/tcp_socket_fixture.js";
import { admin_network_test } from "../server/service/worker/network_test.js";

beforeEach(t => {
  const tcp = mock_tcp_http(t);
  t.tcp = tcp;
  t.after(() => {
    for (const connection of tcp.connections) {
      assert.deepEqual(connection.address, { hostname: "api.bilibili.com", port: 443 });
      assert.deepEqual(connection.options, { secureTransport: "on" });
      assert.equal(connection.closed, true);
    }
  });
});

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { compile_script_module, execute_script } = await import("../server/infra/script_sandbox.js");
const source = await readFile(new URL("../examples/scripts/rss/bilibili.js", import.meta.url), "utf8");
const compiled = await compile_script_module(source);
assert.equal(compiled.error, "");
const fixtures = JSON.parse(await readFile(new URL("./fixtures/script_migration.json", import.meta.url)))
  .filter(fixture => fixture.file === "bilibili");
// 网络测试成功请求的通用请求头及 Cookie 名称；查询参数沿用 upload_video.har。
const video_request = JSON.parse(await readFile(new URL("./fixtures/bilibili_video_request.json", import.meta.url)));
const saved_cookies = video_request.cookie_names.map(name => ({ name, value: name === "SESSDATA" ? "test-cookie" : "fixture-" + name,
  domain: ".bilibili.com", path: "/", secure: true }));
const expected_cookie = saved_cookies.map(cookie => cookie.name + "=" + cookie.value).join("; ");
const cookie_access = new ScriptCookieAccess({
  permissions: compiled.metadata.permissions,
  assert_grant() {},
  cookies: () => saved_cookies,
});
const run = (index, params, query = {}, debug = false) => execute_script(source,
  { ...compiled.metadata, ...compiled.metadata.routes[index], debug_request: debug }, null,
  { method: "GET", pathname: compiled.metadata.routes[index].example, params, query, public_origin: "https://feeds.example" },
  [], "", cookie_access);

test("Bilibili 合并脚本注册动态和视频路由，参数均为 userid", () => {
  assert.deepEqual(compiled.metadata.routes.map(route => route.path), [
    "/bilibili/:userid/dynamic", "/bilibili/:userid/upload/video",
  ]);
  for (const route of compiled.metadata.routes) {
    assert.deepEqual({ ...RssRoutePatternModel(route.path).match(route.example).params }, { userid: "650898515" });
    assert.ok(Object.hasOwn(route.parameters, "userid"));
    assert.equal(Object.hasOwn(route.parameters, "uid"), false);
  }
});

for (const fixture of fixtures) test("Bilibili QuickJS 保留内容和媒体：" + (fixture.route_index ? "视频" : "动态"), async t => {
  const original_fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = original_fetch; });
  const index = fixture.route_index || 0;
  let calls = 0;
  globalThis.fetch = async (input, options) => {
    calls++;
    const url = new URL(input);
    assert.equal(new Headers(options.headers).get("cookie"), expected_cookie);
    if (index) {
      const headers = new Headers(options.headers);
      for (const [name, value] of Object.entries(video_request.headers)) {
        assert.equal(headers.get(name), name === "referer" ? input : value, name);
      }
    }
    if (url.pathname.includes("/feed/space")) {
      assert.equal(url.searchParams.get("host_mid"), fixture.params.userid);
      assert.equal(url.searchParams.get("offset"), "123456");
    }
    if (url.pathname.includes("/arc/search")) {
      assert.equal(url.searchParams.get("mid"), fixture.params.userid);
      assert.equal(url.searchParams.get("pn"), "2");
      assert.equal(url.searchParams.get("ps"), "10");
      for (const [name, value] of Object.entries(video_request.params)) {
        assert.equal(url.searchParams.get(name), value, name);
      }
      assert.ok(Math.abs(Number(url.searchParams.get("wts")) - Date.now() / 1000) < 5);
      const signature = url.searchParams.get("w_rid");
      const query = [...url.searchParams].filter(([name]) => name !== "w_rid")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, value]) => encodeURIComponent(name) + "=" + encodeURIComponent(value.replace(/[!'()*]/g, ""))).join("&");
      assert.equal(signature, createHash("md5").update(query + "ea1db124af3c7062474693fa704f4ff8").digest("hex"));
    }
    const response = fixture.responses.find(response => input.includes(response.contains));
    assert.ok(response, input);
    return new Response(response.body);
  };
  const route = compiled.metadata.routes[index];
  const pathname = route.path.replace(":userid", fixture.params.userid);
  const params = RssRoutePatternModel(route.path).match(pathname).params;
  const feed = JSON.parse((await run(index, params, index ? { pn: "2", ps: "10" } : { offset: "123456" })).output);
  assert.ok(calls > 0);
  assert.equal(t.tcp.connections.length, calls, "全部网页 API 请求应使用 TCP");
  assert.equal(feed.link, "https://space.bilibili.com/" + fixture.params.userid + (index ? "/upload/video" : "/dynamic"));
  assert.deepEqual(feed.items.map(item => item.id), fixture.expected_ids);
  if (index) assert.equal(feed.items[0].enclosure.length, 456);
  else assert.equal(feed.items[0].images.length, 2);
  for (const format of ["rss", "atom"]) assert.ok(FeedModel.fromValue(feed).render(format).includes(fixture.expected_ids[0]));
});

test("视频脚本对齐网络测试成功请求的 Safari 请求头及通用 Cookie，并逐个 API 比较 TCP 请求", async t => {
  const fixture = fixtures.find(fixture => fixture.route_index === 1);
  t.mock.method(globalThis, "fetch", async input => new Response(
    fixture.responses.find(response => input.includes(response.contains)).body,
  ));
  await run(1, { userid: "3707051406527347" }, { ps: "1" });
  const requests = [...t.tcp.requests];
  assert.equal(requests.some(request => request.url.startsWith("https://space.bilibili.com/")), false);
  assert.ok(requests.some(request => request.url.includes("/nav")));
  assert.ok(requests.some(request => request.url.includes("/arc/search?")));
  for (const original of requests) {
    const headers = { ...video_request.headers, referer: original.url };
    const request = new Request("https://app.example/admin/api/network-test", { method: "POST", body: JSON.stringify({
      url: original.url, transport: "tcp", headers, timeout_ms: 10000, cookie_domains: [".bilibili.com"],
    }) });
    const env = { API: { getByName: () => ({ fetch: async () => Response.json({ cookies: saved_cookies }) }) } };
    const result = await (await admin_network_test(request, env)).json();
    assert.equal(result.error, "");
    const actual = t.tcp.requests.at(-1);
    assert.equal(actual.url, original.url);
    assert.equal(actual.method, original.method);
    assert.deepEqual([...actual.headers], [...original.headers]);
  }
});

test("视频脚本保留必需及播放接口的上游错误码，并显示具体失败接口", async t => {
  const fixture = fixtures.find(fixture => fixture.route_index === 1);
  for (const path of ["/nav", "/arc/search", "/view", "/playurl"]) {
    for (const [status, code] of [[500, "UPSTREAM_FETCH_FAILED"], [429, "UPSTREAM_RATE_LIMITED"], [504, "UPSTREAM_TIMEOUT"]]) {
      t.mock.method(globalThis, "fetch", async input => new URL(input).pathname.endsWith(path)
        ? new Response(null, { status })
        : new Response(fixture.responses.find(response => input.includes(response.contains)).body));
      await assert.rejects(run(1, { userid: "3707051406527347" }, { ps: "1" }, true), error => {
        assert.equal(error.problem?.code, code);
        assert.ok(error.message.includes(path), error.message);
        assert.doesNotMatch(error.message, /test-cookie|w_rid=/);
        const line = error.lines.find(line => line.text.includes("B 站 API 请求失败"));
        assert.ok(line, "保留可用于网络测试的请求信息");
        const diagnostic = JSON.parse(line.text.slice(line.text.indexOf("{")));
        const parameters = error.lines.find(line => line.text.includes("B 站 API 请求参数"));
        const options = JSON.parse(parameters.text.slice(parameters.text.indexOf("{")));
        const outgoing = t.tcp.requests.findLast(request => request.url === diagnostic.url);
        assert.ok(outgoing);
        assert.equal(options.transport, "tcp");
        assert.equal(options.timeout_ms, 10000);
        assert.ok(diagnostic.elapsed_ms >= 0);
        for (const [name, value] of Object.entries(options.headers)) assert.equal(outgoing.headers.get(name), value);
        assert.doesNotMatch(line.text + parameters.text, /test-cookie/);
        if (status === 504) assert.match(error.message, /超时预算 10 秒/);
        return true;
      });
    }
  }
  const connections = t.tcp.connections.length;
  t.mock.method(AbortSignal, "timeout", ms => {
    assert.equal(ms, 10000);
    return AbortSignal.abort(new DOMException("timeout", "TimeoutError"));
  });
  await assert.rejects(run(1, { userid: "3707051406527347" }), error =>
    error.problem?.code === "UPSTREAM_TIMEOUT" && error.message.includes("/nav"));
  assert.equal(t.tcp.connections.length, connections);
});

test("Bilibili 两条路由在出站前校验 userid 和分页参数", async t => {
  const original_fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = original_fetch; });
  globalThis.fetch = async () => assert.fail("非法参数不应发出请求");
  for (const index of [0, 1]) {
    for (const userid of ["", "abc", "../123", "1".repeat(21)]) {
      await assert.rejects(run(index, { userid }), error => error.problem?.code === "INVALID_PARAMETER");
    }
  }
  for (const [index, query] of [[0, { offset: "abc" }], [1, { pn: "0" }], [1, { ps: "51" }]]) {
    await assert.rejects(run(index, { userid: "123" }, query), error => error.problem?.code === "INVALID_PARAMETER");
  }
});

test("Bilibili 动态把字符串和数字时间戳归一化，保留真实时间并将置顶旧动态按时间排序", async t => {
  const original_fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = original_fetch; });
  const card = (id, pub_ts) => ({ id_str: id, modules: {
    module_author: { mid: "650898515", name: "UP 主", pub_ts },
    module_dynamic: { desc: { text: "动态 " + id } },
  } });
  globalThis.fetch = async () => Response.json({ code: 0, data: { items: [
    card("1", "1720000000"), card("2", 1720000010),
    card("3", "1720000020000"), card("4", 1720000030000),
    ...[undefined, null, "", 0, "0"].map((value, index) => card(String(index + 5), value)),
  ] } });
  const feed = JSON.parse((await run(0, { userid: "650898515" })).output);
  assert.deepEqual(feed.items.map(item => item.id), ["4", "3", "2", "1", "5", "6", "7", "8", "9"].map(id => "bilibili:dynamic:" + id));
  assert.equal(feed.items[0].published, new Date(1720000030000).toISOString());
  assert.equal(feed.items[3].published, new Date(1720000000000).toISOString());
  assert.equal(feed.updated, feed.items[0].published);
  assert.ok(feed.items.slice(4).every(item => item.published === undefined));
  for (const format of ["rss", "atom"]) assert.doesNotMatch(FeedModel.fromValue(feed).render(format), /Invalid Date|NaN/);
});

test("Bilibili 动态无效时间返回具体动态 ID，空列表不伪造更新时间", async t => {
  const original_fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = original_fetch; });
  for (const pub_ts of ["invalid-date", -1, "999999999999999999999"]) {
    globalThis.fetch = async () => Response.json({ code: 0, data: { items: [{ id_str: "123456", modules: {
      module_author: { mid: "650898515", pub_ts }, module_dynamic: { desc: { text: "动态" } },
    } }] } });
    await assert.rejects(run(0, { userid: "650898515" }), error =>
      error.problem?.code === "UPSTREAM_INVALID_RESPONSE" && /B 站动态 123456 的发布时间无效/.test(error.message));
  }
  globalThis.fetch = async () => Response.json({ code: 0, data: { items: [] } });
  const feed = JSON.parse((await run(0, { userid: "650898515" })).output);
  assert.deepEqual(feed.items, []);
  assert.equal(feed.updated, undefined);
});
