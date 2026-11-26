import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { register } from "node:module";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { get_quickjs_module } = await import("../server/infra/script_sandbox.js");

const home = readFileSync(new URL("./fixtures/douyin/home.html", import.meta.url), "utf8");
const sdk = ["bdms", "security"].map(name => gunzipSync(
  readFileSync(new URL("./fixtures/douyin/" + name + ".js.gz", import.meta.url))));
const QuickJS = await get_quickjs_module();
const request = {
  url: "https://www-hj.douyin.com/aweme/v1/web/aweme/post/?aid=6383&sec_user_id=author&count=18&max_cursor=0&timestamp=1",
  cookie: "UIFID=fixture-UIFID; sessionid=fixture-session",
  user_agent: "Mozilla/5.0 Chrome/156.0.0.0",
};
let module_index = 0;
const fresh_cache = () => import("../server/infra/douyin_sdk.js?cache=" + module_index++);
function upstream(t) {
  let page_calls = 0;
  t.mock.method(globalThis, "fetch", async url => {
    if (url === "https://www.douyin.com/") { page_calls++; return new Response(home); }
    return new Response(sdk[url.includes("bdms") ? 0 : 1]);
  });
  return () => page_calls;
}

test("同一请求复用整套签名超过五分钟，忽略原始 timestamp，并发只初始化一次", async t => {
  const { get_douyin_signature } = await fresh_cache();
  const page_calls = upstream(t);
  let creates = 0;
  const create = async () => { creates++; return QuickJS; };
  const results = await Promise.all([get_douyin_signature(create, request), get_douyin_signature(create, request)]);
  assert.equal(results[0], results[1]);
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  t.mock.timers.tick(24 * 60 * 60 * 1000);
  const again = await get_douyin_signature(create, { ...request, url: request.url.replace("timestamp=1", "timestamp=999") });
  assert.equal(again, results[0]);
  assert.equal(again.headers["x-secsdk-web-expire"], new URL(again.url).searchParams.get("timestamp"));
  assert.equal(creates, 1);
  assert.equal(page_calls(), 1);
});

test("作者、分页、数量、域名、Cookie 和 UA 不同不能共用签名，过期的失败不删除新缓存", async t => {
  const { get_douyin_signature, invalidate_douyin_signature } = await fresh_cache();
  const page_calls = upstream(t);
  let creates = 0;
  const create = async () => { creates++; return QuickJS; };
  const first = await get_douyin_signature(create, request);
  for (const changed of [
    { url: request.url.replace("sec_user_id=author", "sec_user_id=other") },
    { url: request.url.replace("max_cursor=0", "max_cursor=100") },
    { url: request.url.replace("count=18", "count=2") },
    { url: request.url.replace("www-hj.douyin.com", "www.douyin.com") },
    { cookie: request.cookie + "-updated" },
    { user_agent: request.user_agent.replace("156", "157") },
  ]) assert.notEqual(await get_douyin_signature(create, { ...request, ...changed }), first);
  assert.equal(creates, 7);
  assert.equal(page_calls(), 1);
  invalidate_douyin_signature(first);
  const fresh = await get_douyin_signature(create, request);
  assert.notEqual(fresh, first);
  assert.equal(page_calls(), 2);
  invalidate_douyin_signature(first);
  assert.equal(await get_douyin_signature(create, request), fresh);
  assert.equal(creates, 8);
});

test("签名生成失败不缓存失败状态，重试可以恢复", async t => {
  const { get_douyin_signature } = await fresh_cache();
  upstream(t);
  let creates = 0;
  const create = async () => {
    if (++creates === 1) throw new Error("fixture startup failed");
    return QuickJS;
  };
  await assert.rejects(get_douyin_signature(create, request), /startup failed/);
  assert.ok((await get_douyin_signature(create, request)).url.includes("a_bogus="));
  assert.equal(creates, 2);
});

test("签名失效判定不把登录、限流、普通拒绝或合法空列表当签名失效", async () => {
  const { douyin_signature_rejected: rejected } = await fresh_cache();
  for (const status of [200, 403]) assert.equal(rejected(status, "Blocked by ArgusSecurityPlugin Sign Invalid"), true);
  assert.equal(rejected(200, " \n"), true);
  for (const [status, text] of [
    [200, '{"status_code":0,"aweme_list":[]}'], [200, '{"status_code":4}'],
    [200, '{"status_code":0,"aweme_list":[{"desc":"Blocked by ArgusSecurityPlugin Sign Invalid"}]}'],
    [401, ""], [403, "Forbidden"], [403, ""], [429, ""], [500, ""],
  ]) assert.equal(rejected(status, text), false);
});

test("SDK 执行失败后重新发现 SDK，不会永久缓存损坏源码", async t => {
  const { get_douyin_signature } = await fresh_cache();
  let broken = true;
  let page_calls = 0;
  t.mock.method(globalThis, "fetch", async url => {
    if (url === "https://www.douyin.com/") { page_calls++; return new Response(home); }
    return new Response(broken ? "throw new Error('fixture SDK changed')" : sdk[url.includes("bdms") ? 0 : 1]);
  });
  await assert.rejects(get_douyin_signature(async () => QuickJS, request), /执行失败/);
  broken = false;
  assert.ok((await get_douyin_signature(async () => QuickJS, request)).url.includes("a_bogus="));
  assert.equal(page_calls, 2);
});
