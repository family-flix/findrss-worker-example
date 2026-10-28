import { result_fixture_source } from "./support/result_fixture.js";
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
register("./support/quickjs_wasm_hook.js", import.meta.url);
import { ScriptCookieAccess } from "../server/infra/script_cookie_access.js";
const { execute_script_inner: execute_anonymous } = await import("../server/infra/script_sandbox.js");
const request_context = { method: "GET", pathname: "/rss/weibo/u/1992429663", params: { uid: "1992429663" }, query: {} };
const metadata = { path: "/weibo/u/:uid", name: "微博用户列表", example: "/weibo/u/1992429663" };
async function execute_script_inner(source, route_metadata, invoke, context, cookies, mock) {
  const permissions = { cookies: ["https://weibo.com", "https://www.douyin.com", "https://x.com"].map((origin, index) => ({
    id: "session" + index, origin, path_prefix: "/", names: ["SUB", "XSRF-TOKEN", "UIFID", "ct0"], purpose: "测试授权" })) };
  const fixture = source.replaceAll("ctx.fetchText(", "__cookieFetch(ctx, ") + `
async function __cookieFetch(ctx, url, options = {}) {
  const origins = ${JSON.stringify(permissions.cookies.map(entry => entry.origin))};
  const index = origins.findIndex(origin => url.startsWith(origin + "/"));
  return ctx.fetchText(url, index < 0 ? options : { ...options, cookies: await ctx.cookies.get("session" + index) });
}`;
  const access = new ScriptCookieAccess({ permissions, cookies: () => cookies, assert_grant: () => {} });
  return execute_anonymous(result_fixture_source(fixture), route_metadata, invoke, context, [], mock, access);
}
async function with_fetch(fetch_impl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = fetch_impl;
  try { return await run(); } finally { globalThis.fetch = original; }
}

test("生产 QuickJS：跨 origin 重定向移除微博 XSRF，返回原 origin 也不恢复", async () => {
  const probe = `export const route = { async handler(ctx) {
    return { title: await ctx.fetchText('https://weibo.com/start', {
      headers: { 'x-xsrf-token': 'inline-fixture' }, cookie_headers: { 'x-xsrf-token': 'XSRF-TOKEN' }
    }), items: [] };
  } };`;
  const requests = [];
  await with_fetch(async (url, options) => {
    requests.push(new Headers(options.headers));
    if (url.endsWith('/start')) return new Response(null, { status: 302, headers: { Location: 'https://other.example/next' } });
    if (url.endsWith('/next')) return new Response(null, { status: 302, headers: { Location: 'https://weibo.com/back' } });
    return new Response('feed');
  }, () => execute_script_inner(probe, metadata, null, request_context,
    [{ name: 'XSRF-TOKEN', value: 'cookie-fixture', domain: '.weibo.com', path: '/', secure: true }], ''));
  assert.equal(requests[0].get('x-xsrf-token'), 'cookie-fixture');
  assert.equal(requests[1].get('x-xsrf-token'), null);
  assert.equal(requests[2].get('x-xsrf-token'), null);
});

test("Debug 上游请求记录实际发送的 Cookie 来源及每跳状态，不记录凭证值或 URL query", async () => {
  const probe = `export const route = { async handler(ctx) { await ctx.fetchText('https://weibo.com/start?token=upstream-secret'); return {items: []}; } };`;
  await with_fetch(async url => url.includes('weibo.com')
    ? new Response(null, { status: 302, headers: { Location: 'https://other.example/failure?secret=redirect-secret' } })
    : new Response('private body', { status: 403 }), () => assert.rejects(
      execute_script_inner(probe, { ...metadata, debug: true }, null, request_context,
        [{ name: 'SUB', value: 'private-cookie-value', domain: '.weibo.com', secure: true }], ''), failure => {
        assert.equal(failure.upstream_requests.length, 2);
        assert.equal(failure.upstream_requests[0].status, 302);
        assert.equal(failure.upstream_requests[0].credentials.source, 'script_grant');
        assert.deepEqual(failure.upstream_requests[0].credentials.headers_sent, ['Cookie']);
        assert.equal(failure.upstream_requests[1].status, 403);
        assert.equal(failure.upstream_requests[1].credentials.source, 'none');
        assert.deepEqual(failure.upstream_requests[1].credentials.headers_sent, []);
        assert.doesNotMatch(JSON.stringify(failure.upstream_requests), /upstream-secret|redirect-secret|private-cookie-value|private body/);
        return true;
      }));
});
test("生产 QuickJS：连续 invoke 与微任务中的 fetchText 都正常完成", async () => {
  const probe = `export const route = { async handler(ctx) {
    const first = await ctx.invoke("one", { id: 1 });
    await Promise.resolve();
    const text = await ctx.fetchText("https://example.com/data");
    const second = await ctx.invoke("two", { id: 2 });
    return { title: text, items: [{ title: first.title + second.title }] };
  } };`;
  const calls = [];
  const result = await with_fetch(async () => new Response("feed"), () => execute_script_inner(probe, metadata, async (spec) => {
    calls.push(spec);
    return { title: spec.method };
  }, request_context, [], ""));
  assert.deepEqual(calls.map((call) => call.method), ["one", "two"]);
  assert.equal(result.invoked, true);
  assert.equal(JSON.parse(result.output).items[0].title, "onetwo");
});

test("生产 QuickJS：未完成的脚本 Promise 不误报 undefined JSON", async () => {
  await assert.rejects(execute_script_inner('export const route = { handler() { return new Promise(() => {}); } };', metadata, null, request_context, [], ""), /脚本异步任务未完成/);
});

test("生产 QuickJS：脚本不能覆盖 Host 或注入请求头", async () => {
  for (const headers of [{ Host: "secret" }, { Cookie: "bad\r\nX-Injected: secret" }, { "User-Agent": "bad\r\nCookie: secret" }]) {
    await with_fetch(() => { assert.fail("无效请求头应在出网之前被拒绝"); }, () =>
      assert.rejects(execute_script_inner(`export const route = { async handler(ctx) { await ctx.fetchText("https://example.com/", { headers: ${JSON.stringify(headers)} }); return { items: [] }; } };`, metadata, null, request_context, [], ""), /fetchText.*请求头/));
  }
});

test('生产 QuickJS：禁止直接传入 Cookie 请求头', async () => {
  const probe = `export const route = { async handler(ctx) {
    return { title: await ctx.fetchText('https://weibo.com/start', { headers: { Cookie: 'SUB=inline-fixture' } }), items: [] };
  } };`;
  await with_fetch(() => assert.fail("禁止的 Cookie 不得发送"), () => assert.rejects(
    execute_script_inner(probe, metadata, null, request_context, [], ''), /禁止直接填写/));
});

test('UIFID Cookie 派生头按每一跳域名匹配，跨域重定向不泄露', async () => {
  const probe = `export const route = { async handler(ctx) { return { title: await ctx.fetchText('https://www.douyin.com/test', { cookie_headers: { uifid: 'UIFID' } }), items: [] }; } };`;
  const cookies = [{ name: 'UIFID', value: 'fixture', domain: '.douyin.com', path: '/', secure: true }];
  const calls = [];
  const result = await with_fetch(async (url, options) => {
    calls.push(options.headers);
    return url.includes('douyin.com') ? new Response(null, { status: 302, headers: { Location: 'https://other.example/test' } }) : new Response('done');
  }, () => execute_script_inner(probe, metadata, null, request_context, cookies, ''));
  assert.equal(JSON.parse(result.output).title, 'done');
  assert.equal(calls[0].uifid, 'fixture');
  assert.equal(calls[0].Cookie, 'UIFID=fixture');
  assert.equal(calls[1].uifid, undefined);
  assert.equal(calls[1].Cookie, undefined);
});

test('生产 QuickJS：POST JSON、认证头和 Cookie 派生头可用于列表接口', async () => {
  const probe = `export const route = { async handler(ctx) { return { title: await ctx.fetchText('https://x.com/list', {
    method: 'POST', body: '{"count":20}', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' }, cookie_headers: { 'x-csrf-token': 'ct0' }
  }), items: [] }; } };`;
  const cookies = [{ name: 'ct0', value: 'csrf', domain: 'x.com', path: '/', secure: true }];
  let calls = 0;
  await with_fetch(async (url, options) => {
    calls++;
    assert.equal(options.method, 'POST');
    assert.equal(options.body, '{"count":20}');
    assert.equal(options.headers.authorization, 'Bearer fixture');
    assert.equal(options.headers['x-csrf-token'], 'csrf');
    return calls === 1 ? new Response(null, { status: 307, headers: { Location: '/next' } }) : new Response('feed');
  }, () => execute_script_inner(probe, metadata, null, request_context, cookies, ''));
  assert.equal(calls, 2);
});

test('生产 QuickJS：跨 origin 移除认证，返回初始 origin 也不恢复；302/303 POST 改 GET', async () => {
  for (const status of [301, 302, 303]) {
    const probe = `export const route = { async handler(ctx) { return { title: await ctx.fetchText('https://x.com/start', {
      method: 'POST', body: 'private-body', headers: { Authorization: 'Bearer fixture', 'X-Csrf-Token': 'inline-csrf', kww: 'inline-kww', 'X-App-Token': 'app-token', 'Content-Type': 'application/json' }, cookie_headers: { 'x-csrf-token': 'ct0' }
    }), items: [] }; } };`;
    const seen = [];
    await with_fetch(async (url, options) => {
      seen.push(options);
      if (seen.length === 1) return new Response(null, { status, headers: { Location: 'https://other.example/next' } });
      assert.equal(options.method, 'GET');
      assert.equal(options.body, undefined);
      for (const name of ['authorization', 'x-csrf-token', 'kww', 'x-app-token', 'content-type']) assert.equal(options.headers[name], undefined, name);
      return seen.length === 2 ? new Response(null, { status: 302, headers: { Location: 'https://x.com/end' } }) : new Response('done');
    }, () => execute_script_inner(probe, metadata, null, request_context, [{ name: 'ct0', value: 'csrf', domain: 'x.com', path: '/', secure: true }], ''));
    assert.equal(seen.length, 3);
  }
});

test('生产 QuickJS：307/308 不把 POST body 转发到跨 origin 目标', async () => {
  for (const status of [307, 308]) {
    let calls = 0;
    await with_fetch(async () => {
      calls++;
      return new Response(null, { status, headers: { Location: 'https://other.example/' } });
    }, () => assert.rejects(execute_script_inner(`export const route = { async handler(ctx) { await ctx.fetchText('https://x.com/', { method: 'POST', body: 'private' }); return { items: [] }; } };`, metadata, null, request_context, [], ''), /跨 origin/));
    assert.equal(calls, 1);
  }
});
