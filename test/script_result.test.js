import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { compile_script_module, execute_script } = await import("../server/infra/script_sandbox.js");
const source = body => `export const route = { path: "/result", name: "Result测试", async handler(ctx) { ${body} } };`;
async function run(body, invoke = null, mock = "") {
  const script = source(body);
  const compiled = await compile_script_module(script);
  assert.equal(compiled.error, "");
  return execute_script(script, compiled.metadata, invoke, undefined, [], mock);
}

test("全局 Result、BizError 和 parseJSON 对齐 Timeless 结构，解析失败和 reviver 错误不抛出", async () => {
  const result = await run(`
    const invalid = parseJSON("broken");
    const reviver = parseJSON('{"a":1}', () => { throw new Error("reviver failed"); });
    const original = Result.Err(["第一条", "第二条"], "TEST", { field: "title" });
    const propagated = Result.Err(original);
    class BrokenRSS extends RSSScript { async fetch() { throw new Error("subclass failed"); } }
    const broken = await new BrokenRSS().run(ctx);
    return { object: parseJSON('{"a":1}'), array: parseJSON('[1,2]'), nil: parseJSON('null'),
      invalid: { data: invalid.data, messages: invalid.error.messages, code: invalid.error.code, message: invalid.error.message },
      reviver: reviver.error.message, original,
      propagated: propagated.error === original.error, error_class: original.error instanceof BizError,
      timestamp: RSSScript.timestamp("invalid"), broken,
      primitives: [parseJSON('0'), parseJSON('false')] };
  `);
  const value = JSON.parse(result.output);
  assert.deepEqual(value.object, { data: { a: 1 }, error: null });
  assert.deepEqual(value.array, { data: [1, 2], error: null });
  assert.deepEqual(value.nil, { data: null, error: null });
  assert.equal(value.invalid.data, null);
  assert.equal(value.invalid.code, "UPSTREAM_INVALID_RESPONSE");
  assert.ok(value.invalid.messages[0]);
  assert.equal(value.reviver, "reviver failed");
  assert.equal(value.original.code, "TEST");
  assert.deepEqual(value.original.error.messages, ["第一条", "第二条"]);
  assert.deepEqual(value.original.error.data, { field: "title" });
  assert.equal(value.propagated, true);
  assert.equal(value.error_class, true);
  assert.ok(value.timestamp.error);
  assert.deepEqual(value.broken.error.messages, ["subclass failed"]);
  assert.deepEqual(value.primitives, [{ data: 0, error: null }, { data: false, error: null }]);
});

test("接口请求、invoke 校验、设备错误和 Cookie 获取返回 Result，脚本可继续执行", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let requests = 0;
  globalThis.fetch = async url => { requests++; return new Response(url.includes("forbidden") ? "private" : "html", { status: url.includes("forbidden") ? 403 : 200 }); };
  const result = await run(`
    const good = await ctx.fetchText("https://example.com/good");
    const bad = await ctx.fetchText("https://example.com/forbidden");
    const unsafe = await ctx.fetchText("file:///tmp/private");
    const invalid = await ctx.invoke("", []);
    const device = await ctx.invoke("test", {});
    const cookie = await ctx.cookies.get("undeclared");
    ctx.log("所有操作都返回 Result");
    return { good, bad, unsafe, invalid, device, cookie };
  `, async () => { throw Object.assign(new Error("device failed"), { name: "FeedError", code: "DEVICE_UNAVAILABLE" }); });
  const value = JSON.parse(result.output);
  assert.deepEqual(value.good, { data: "html", error: null });
  assert.equal(value.bad.error.code, "UPSTREAM_ACCESS_DENIED");
  for (const key of ["bad", "unsafe", "invalid", "device", "cookie"]) {
    assert.equal(value[key].data, null);
    assert.ok(value[key].error.messages.length);
  }
  assert.equal(value.device.error.code, "DEVICE_UNAVAILABLE");
  assert.equal(requests, 2);
  assert.ok(result.lines.some(line => line.text.includes("所有操作")));
  const mocked = await run('return await ctx.invoke("test", {});', null, '({ invoke: () => Result.Ok({ mocked: true }) })');
  assert.deepEqual(JSON.parse(mocked.output), { mocked: true });
  const status = await run('const result = await ctx.invoke("test", {}); return { code: result.error.code };',
    async () => { throw Object.assign(new Error("积分不足"), { status: 402 }); });
  assert.equal(JSON.parse(status.output).code, 402);
});

test("fetchText 完整保留 NUL、引号和 Unicode，不把响应内容当代码执行", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const text = '前缀\0"; throw new Error("executed"); //\n后缀😀\0';
  globalThis.fetch = async () => new Response(text);
  const result = await run('return await ctx.fetchText("https://example.com/stream");');
  assert.equal(JSON.parse(result.output), text);
});

test("路由出口只展开一次 Result，错误保留代码、日志和堆栈，处理失败可返回回退结果", async () => {
  const ok = await run('return Result.Ok({ title: "feed", items: [] });');
  assert.deepEqual(JSON.parse(ok.output), { title: "feed", items: [] });
  await assert.rejects(run('ctx.log("before failure"); return Result.Err("请更新登录状态", "UPSTREAM_AUTH_REQUIRED");'), error => {
    assert.equal(error.problem.code, "UPSTREAM_AUTH_REQUIRED");
    assert.ok(error.lines.some(line => line.text.includes("before failure")));
    assert.match(error.sandbox_stack, /script-source/);
    return true;
  });
  const fallback = await run('const result = parseJSON("broken"); return result.error ? Result.Ok({ items: [] }) : result;');
  assert.deepEqual(JSON.parse(fallback.output), { items: [] });
  await assert.rejects(run('return ctx.fail("INVALID_PARAMETER", "缺少参数");'), error => error.problem.status === 400);
});
