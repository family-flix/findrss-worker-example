import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { ScriptCookieAccess } from "../server/infra/script_cookie_access.js";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { compile_script_module, execute_script } = await import("../server/infra/script_sandbox.js");
const source = `import { Result } from "@findrss/core";
export const permissions = { cookies: [{ id: "account", origin: "https://www.instagram.com", path_prefix: "/", names: ["csrftoken"], purpose: "Read profile" }] };
export const route = { name: "Runner", path: "/runner", example_name: "Instagram", handler: async ctx => {
  const acquired = await ctx.cookies.get("account");
  if (acquired.error) return acquired;
  for (const timeout_ms of [30000, 60000]) {
    const result = await ctx.fetchText("https://www.instagram.com/", { cookies: acquired.data, timeout_ms });
    if (result.error) return result;
  }
  return Result.Ok({ title: "Fixture", link: "https://www.instagram.com/", items: [] });
} };`;

function cookie_access(assert_grant = async () => {}) {
  return new ScriptCookieAccess({
    permissions: { cookies: [{ id: "account", origin: "https://www.instagram.com", path_prefix: "/", names: ["csrftoken"] }] },
    cookies: async () => [{ name: "csrftoken", value: "private-fixture", domain: ".instagram.com", path: "/", secure: true }],
    assert_grant,
  });
}

test("runner 支持 Instagram 的 30/60 秒请求并等待异步 Cookie 授权", async t => {
  const timeouts = [];
  const timeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, "timeout", milliseconds => {
    timeouts.push(milliseconds);
    return timeout(milliseconds);
  });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    assert.equal(options.headers.Cookie, "csrftoken=private-fixture");
    return new Response("fixture");
  });
  const compiled = await compile_script_module(source);
  assert.equal(compiled.error, "");
  assert.equal(compiled.metadata.example_name, "Instagram");
  const result = await execute_script(source, { ...compiled.metadata, debug: true }, null, undefined, [], "", cookie_access());
  assert.equal(calls, 2);
  assert.deepEqual(timeouts, [30000, 60000]);
  assert.equal(JSON.parse(result.output).title, "Fixture");
  assert.doesNotMatch(JSON.stringify(result), /private-fixture/);
  calls = 0;
  await assert.rejects(execute_script(source, compiled.metadata, null, undefined, [], "", cookie_access(async () => {
    throw new Error("Cookie authorization revoked");
  })), /authorization revoked/);
  assert.equal(calls, 0);
});

test("runner 正文超时保留 UPSTREAM_TIMEOUT，任务取消保留原始原因", async t => {
  let controller;
  t.mock.method(AbortSignal, "timeout", () => (controller = new AbortController()).signal);
  const task = new AbortController();
  let cancel_task = false;
  t.mock.method(globalThis, "fetch", async () => {
    const response = new Response("fixture");
    response.arrayBuffer = async () => {
      if (cancel_task) task.abort(new Error("task cancelled"));
      controller.abort(new DOMException("private body timeout", "TimeoutError"));
      throw controller.signal.reason;
    };
    return response;
  });
  const compiled = await compile_script_module(source);
  await assert.rejects(execute_script(source, compiled.metadata, null, undefined, [], "", cookie_access()), error => {
    assert.equal(error.problem?.code, "UPSTREAM_TIMEOUT");
    assert.doesNotMatch(error.message, /private body timeout/);
    return true;
  });
  cancel_task = true;
  await assert.rejects(execute_script(source, compiled.metadata, null, undefined, [], "", cookie_access(), task.signal), /task cancelled/);
});
