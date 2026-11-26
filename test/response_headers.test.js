import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const { compile_script_module, execute_script } = await import("../server/infra/script_sandbox.js");

async function request(options) {
  const source = `export const version = "1.0.0";
export const route = { name: "Response headers", path: "/response", handler: async ctx => {
  const response = await ctx.fetchText("https://example.com/", ${JSON.stringify(options)});
  if (response.error) return response;
  return Result.Ok({ title: "Fixture", link: "https://example.com/", description: JSON.stringify(response.data), items: [] });
} };`;
  const compiled = await compile_script_module(source);
  assert.equal(compiled.error, "");
  const result = await execute_script(source, { ...compiled.metadata, debug: true, debug_request: true });
  return { result, data: JSON.parse(JSON.parse(result.output).description) };
}

test("fetchText 默认返回文本，可显式读取响应头，保留多个 Set-Cookie 及内嵌 NUL", async t => {
  const headers = new Headers({ "Content-Type": "text/plain", "X-Source": "fixture" });
  headers.append("Set-Cookie", "first=private-one; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Path=/");
  headers.append("Set-Cookie", "second=private-two; Path=/");
  t.mock.method(globalThis, "fetch", async () => new Response("before\0after", { headers }));
  for (const options of [undefined, { include_headers: false }]) assert.equal((await request(options)).data, "before\0after");
  const { data, result } = await request({ include_headers: true });
  assert.equal(data.text, "before\0after");
  assert.deepEqual(data.headers.filter(([name]) => name === "set-cookie").map(([, value]) => value), headers.getSetCookie());
  assert.equal(new Map(data.headers).get("x-source"), "fixture");
  assert.doesNotMatch(JSON.stringify({ lines: result.lines, upstream_requests: result.upstream_requests }), /private-one|private-two/);
});

test("fetchText 响应头仅来自最终响应，重定向不会转发上游下发的 Cookie", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(new Headers(options.headers).get("cookie"), null);
    return ++calls === 1
      ? new Response("", { status: 302, headers: { Location: "https://other.example/", "Set-Cookie": "redirect=private; Path=/" } })
      : new Response("final", { headers: { "X-Source": "final" } });
  });
  const { data } = await request({ include_headers: true });
  assert.equal(calls, 2);
  assert.equal(data.text, "final");
  assert.equal(new Map(data.headers).get("x-source"), "final");
  assert.equal(new Map(data.headers).has("set-cookie"), false);
});

test("fetchText 拒绝非法响应头选项及读取托管 Cookie 响应头，请求前失败", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("invalid options must not fetch"));
  for (const include_headers of [null, "true", 1, {}]) await assert.rejects(request({ include_headers }), /include_headers 必须为布尔值/);
  await assert.rejects(request({ include_headers: true, cookies: "managed-cookie-handle" }), /include_headers 不支持 Cookie 句柄/);
});
