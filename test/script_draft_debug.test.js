import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { ScriptDebugRequestModel } from "../server/domain/script_debug_request.js";
import worker_router from "../api.js";
import { do_error, do_result } from "../server/service/durable_object/error.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const { ServiceScript } = await import("../server/service/durable_object/scripts.js");
const { route } = await import("../durable_object_router.js");

test("草稿路由预览编译起点类式多路由，只返回元数据，不调用 handler 或写日志", async () => {
  const { service, records, calls } = setup();
  const source = readFileSync(new URL("../examples/rss/qidian_chapters.js", import.meta.url), "utf8");
  const preview = body => route(new Request("https://internal/_admin/scripts/routes", {
    method: "POST", body: JSON.stringify(body),
  }), { scripts: service });
  const response = await preview({ script: source });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).routes, [
    { path: "/qidian/book/:book_id", name: "起点中文网章节列表", example: "/qidian/book/1036526469" },
    { path: "/qidian/chapter/:book_id/:chapter_id", name: "起点中文网正文", example: "/qidian/chapter/1036526469/745825165" },
  ]);
  assert.deepEqual(records, []);
  assert.deepEqual(calls, []);
  for (const body of [{ script: "" }, { script: "invalid javascript" }, { script: "x".repeat(128 * 1024 + 1) }, []]) {
    assert.equal((await preview(body)).status, 400);
  }
  const invalid_json = await route(new Request("https://internal/_admin/scripts/routes", {
    method: "POST", body: "{",
  }), { scripts: service });
  assert.equal(invalid_json.status, 400);
});

const script = handler => `export const routes = [
  { path: "/sample/:uid", name: "草稿", example: "/sample/example", url: "example.com", maintainers: [],
    parameters: {}, description: "", async handler(ctx) { ${handler} } },
  { path: "/sample/special", name: "具体路由", example: "/sample/special", url: "example.com", maintainers: [],
    parameters: {}, description: "", handler() { return { chosen: "specific" }; } }
];`;
const request = (source, request_url = "/debug/sample/actual?offset=2", extra = {}) =>
  new Request("https://internal/_admin/scripts/debug", { method: "POST",
    body: JSON.stringify({ script: source, request_url, ...extra }) });
function setup(invoke = async () => do_result({ title: "设备结果" })) {
  const records = [], calls = [];
  const service = new ServiceScript({ repo: { rss_cookies: { get: () => [] } }, ports: {},
    public_origin: "https://feeds.example", app: { tasks: { async invoke(request) {
      calls.push({ headers: request.headers, body: await request.json() });
      return invoke();
    } } } });
  service.record_log = record => records.push(record);
  return { service, records, calls };
}

test("调试链接接受完整链接和相对路由，剥离 token 并按最具体路径选择路由", () => {
  const routes = [{ path: "/sample/:uid" }, { path: "/sample/special" }];
  for (const prefix of ["/rss", "/atom", "/debug", ""]) {
    const parsed = ScriptDebugRequestModel.fromBody({ script: "draft", request_url: `https://foreign.example${prefix}/sample/actual?offset=2&token=credential` });
    assert.equal(parsed.ok, true);
    const resolved = parsed.model.resolve(routes, "https://feeds.example");
    assert.equal(resolved.ok, true);
    assert.equal(resolved.context.pathname, "/debug/sample/actual");
    assert.deepEqual({ ...resolved.context.params }, { uid: "actual" });
    assert.deepEqual(resolved.context.query, { offset: "2" });
    assert.equal(resolved.context.public_origin, "https://feeds.example");
  }
  assert.equal(ScriptDebugRequestModel({ request_url: "/debug/sample/special" }).resolve(routes).metadata.path, "/sample/special");
  assert.equal(ScriptDebugRequestModel({ request_url: "/debug/other" }).resolve(routes).ok, false);
  for (const request_url of ["", 12, "javascript:alert(1)", "https://user:secret@example.com/sample/a", "not a url", "file:///sample/a", "x".repeat(8193)]) {
    assert.equal(ScriptDebugRequestModel.fromBody({ script: "draft", request_url }).ok, false);
  }
});

test("未保存草稿通过 DO 调试路由真实执行，返回完整输出和 debug 日志，不需要已保存记录", async () => {
  const { service, records } = setup();
  const source = script('ctx.log("actual", ctx.params.uid); return { params: ctx.params, query: ctx.query, pathname: ctx.pathname, content: "x".repeat(5000) };');
  const response = await route(request(source, "https://other.example/rss/sample/user?offset=7&token=private&secret=hide"), { scripts: service });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const result = await response.json();
  assert.equal(result.ok, true);
  const output = JSON.parse(result.rss_debug.output);
  assert.equal(output.content.length, 5000);
  assert.deepEqual(output.params, { uid: "user" });
  assert.equal(output.pathname, "/debug/sample/user");
  assert.equal(output.query.token, undefined);
  assert.equal(result.rss_debug.request.query.secret, "[redacted]");
  assert.ok(result.rss_debug.lines.some(line => line.text.includes("actual")));
  assert.equal(records[0].source, "test");
  assert.equal(records[0].route, "");
});

test("草稿调试使用真实设备调用，不注入 mock、不扣积分；重复调试不使用缓存", async () => {
  const { service, calls } = setup();
  const source = script('return await ctx.invoke("sample.method", { uid: ctx.params.uid });');
  for (let i = 0; i < 2; i++) {
    const result = await service.debug_script(request(source, "/debug/sample/42", { mock_ctx: '({ invoke() { throw new Error("mock must not run"); } })' }));
    assert.equal(result.ok, true);
    assert.equal(result.rss_debug.invoked, true);
    assert.equal(JSON.parse(result.rss_debug.output).title, "设备结果");
  }
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers.get("X-Api-Access-Token-ID"), "");
  assert.deepEqual(calls[0].body.args, { uid: "42" });
});

test("草稿 fetchText 默认匿名，记录上游诊断而不泄露凭证值", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let received;
  globalThis.fetch = async (url, options) => {
    received = { url, headers: new Headers(options.headers) };
    return new Response("真实上游正文");
  };
  const { service } = setup();
  service.repo.rss_cookies.get = () => [{ name: "session", value: "private-cookie", domain: "example.com", path: "/" }];
  const result = await service.debug_script(request(script('const result = await ctx.fetchText("https://example.com/data/" + ctx.params.uid); if (result.error) return result; return Result.Ok({ text: result.data });')));
  assert.equal(result.ok, true);
  assert.equal(received.url, "https://example.com/data/actual");
  assert.equal(received.headers.get("Cookie"), null);
  assert.equal(JSON.parse(result.rss_debug.output).text, "真实上游正文");
  assert.equal(result.rss_debug.upstream_requests[0].status, 200);
  assert.equal(result.rss_debug.upstream_requests[0].credentials.source, "none");
  assert.doesNotMatch(JSON.stringify(result.rss_debug), /private-cookie/);
});

test("调试错误保留堆栈与之前的日志，设备不可用和编译/匹配错误可辨识", async () => {
  const { service } = setup();
  let result = await service.debug_script(request(script('ctx.log("before error"); throw new Error("draft failed");')));
  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
  assert.equal(result.rss_debug.phase, "runtime");
  assert.match(result.rss_debug.error_text, /draft failed[\s\S]*at /);
  assert.ok(result.rss_debug.lines.some(line => line.text.includes("before error")));
  result = await service.debug_script(request("not valid javascript"));
  assert.equal(result.rss_debug.phase, "module");
  result = await service.debug_script(request(script("return {};"), "/debug/unmatched"));
  assert.equal(result.status, 400);
  assert.equal(result.rss_debug.phase, "metadata");
  const offline = setup(async () => { throw do_error("没有在线设备", 503); });
  result = await offline.service.debug_script(request(script('return await ctx.invoke("sample.method", {});')));
  assert.equal(result.status, 503);
  assert.equal(result.rss_debug.phase, "invoke");
  assert.match(result.rss_debug.upstream_error, /没有在线设备/);
});

test("外层草稿调试端点需要管理员权限并完整转发请求体", async () => {
  let received;
  const env = { ADMIN_PASSWORD: "admin-test", API: { getByName: () => ({ async fetch(request) {
    received = { url: request.url, body: await request.json() };
    return Response.json({ ok: true });
  } }) } };
  const body = { script: script("return {};"), request_url: "/debug/sample/test" };
  const input = authorization => new Request("https://feeds.example/admin/api/scripts/debug", {
    method: "POST", headers: authorization ? { Authorization: authorization } : {}, body: JSON.stringify(body),
  });
  assert.equal((await worker_router.fetch(input(""), env)).status, 401);
  assert.equal(received, undefined);
  assert.equal((await worker_router.fetch(input("Bearer admin-test"), env)).status, 200);
  assert.equal(received.url, "https://internal/_admin/scripts/debug");
  assert.deepEqual(received.body, body);
  received = undefined;
  const preview = authorization => new Request("https://feeds.example/admin/api/scripts/routes", {
    method: "POST", headers: authorization ? { Authorization: authorization } : {}, body: JSON.stringify({ script: body.script }),
  });
  assert.equal((await worker_router.fetch(preview(""), env)).status, 401);
  assert.equal(received, undefined);
  assert.equal((await worker_router.fetch(preview("Bearer admin-test"), env)).status, 200);
  assert.equal(received.url, "https://internal/_admin/scripts/routes");
  assert.deepEqual(received.body, { script: body.script });
});
