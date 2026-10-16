import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { ScriptCookieAccess } from '../server/infra/script_cookie_access.js';
import { KUAISHOU_SDK_FILE } from '../server/infra/kuaishou_sdk.js';

register('./support/quickjs_wasm_hook.js', import.meta.url);
const { compile_script_module, execute_script } = await import('../server/infra/script_sandbox.js');
const source = await readFile(new URL('../examples/scripts/rss/kuaishou.js', import.meta.url), 'utf8');
const compiled = await compile_script_module(source);
assert.equal(compiled.error, '');
const sdk_bytes = gunzipSync(await readFile(new URL('./fixtures/kuaishou/web-sdk.js.gz', import.meta.url)));
const upstream = handler => async (url, options) => url === KUAISHOU_SDK_FILE.url
  ? new Response(sdk_bytes) : handler(url, options);
const user_id = '3xuxw5yhgr6f4um';
const link = 'https://www.kuaishou.com/profile/' + user_id;
const names = ['kpf', 'clientid', 'did', 'kwpsecproductname', 'userId', 'kpn',
  'kuaishou.server.webday7_st', 'kuaishou.server.webday7_ph', 'kwfv1', 'kwssectoken', 'kwscode'];
const cookies = [...names, 'unrelated-secret'].map(name => ({
  name, value: 'fixture-' + name, domain: '.kuaishou.com', path: '/', secure: true,
}));
const run = (params = { user_id }, grant = new ScriptCookieAccess({
  permissions: compiled.metadata.permissions, assert_grant() {}, cookies: () => cookies,
})) => execute_script(source, { ...compiled.metadata, debug: true }, null, {
  method: 'GET', pathname: '/kuaishou/profile/' + user_id, params, query: {},
}, [], '', grant);

test('快手作品接口发送完整的已授权登录和验证 Cookie，保留 POST 及派生 kww 请求头', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = upstream(async (url, options) => {
    calls++;
    const target = new URL(url);
    assert.equal(target.origin + target.pathname, 'https://www.kuaishou.com/rest/v/profile/feed');
    assert.equal(target.searchParams.get('caver'), '2');
    assert.ok(target.searchParams.get('__NS_hxfalcon').length > 200);
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { user_id, pcursor: '', page: 'profile' });
    assert.equal(options.headers.referer, link);
    assert.equal(options.headers.kww, 'fixture-kwfv1');
    assert.match(options.headers['user-agent'], /Macintosh/);
    const sent = options.headers.Cookie.split('; ').map(pair => pair.split('=')[0]);
    assert.deepEqual(sent.sort(), [...names].sort());
    return Response.json({ result: 1, feeds: [{
      author: { id: user_id, name: '作者' },
      photo: { id: 'photo_1', caption: '作品', timestamp: 1792080550000,
        photoUrls: [{ cdn: 'cdn.example', url: 'https://cdn.example/video.mp4' }] },
    }] });
  });
  const result = await run();
  const feed = JSON.parse(result.output);
  assert.equal(calls, 1);
  assert.equal(feed.title, '作者 的快手作品');
  assert.equal(feed.items[0].id, 'kuaishou:photo:photo_1');
  assert.equal(feed.items[0].published, new Date(1792080550000).toISOString());
  assert.equal(feed.items[0].enclosure.url, 'https://cdn.example/video.mp4');
  assert.doesNotMatch(JSON.stringify(result), /fixture-/);
});

test('快手签名选项校验类型、目标及重定向，禁止对其它站点或方法签名', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('unexpected'); };
  for (const [url, options, message] of [
    ['https://www.kuaishou.com/rest/v/profile/feed', { kuaishou_sign: 'true' }, /必须为布尔值/],
    ['https://other.example/rest/v/profile/feed', { kuaishou_sign: true, method: 'POST' }, /签名只允许 POST/],
    ['https://www.kuaishou.com/rest/v/profile/feed', { kuaishou_sign: true }, /签名只允许 POST/],
    ['https://www.kuaishou.com/other', { kuaishou_sign: true, method: 'POST' }, /签名只允许 POST/],
  ]) {
    const script = `export const route = { name: 'probe', path: '/probe', example: '/probe', async handler(ctx) {
      return ctx.fetchText(${JSON.stringify(url)}, ${JSON.stringify(options)});
    } };`;
    const probe = await compile_script_module(script);
    assert.equal(probe.error, '');
    await assert.rejects(execute_script(script, probe.metadata, null), message);
  }
  assert.equal(calls, 0);
  globalThis.fetch = upstream(async () => {
    calls++;
    return new Response(null, { status: 302, headers: { Location: 'https://other.example/' } });
  });
  await assert.rejects(run(), /签名只允许 POST/);
  assert.equal(calls, 1);
});

test('快手 HTTP 200 中的 result=50 明确报告签名失败，不误报为 Cookie 失效或返回空订阅', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = upstream(async () => Response.json({ result: 50, ab8d: true, error_msg: '签名验证失败' }));
  await assert.rejects(run(), error => {
    assert.equal(error.problem.code, 'UPSTREAM_ACCESS_DENIED');
    assert.match(error.message, /签名验证失败（result=50）/);
    assert.match(error.message, /主页 HTTP 200 不代表作品接口可用/);
    assert.doesNotMatch(error.message, /请同步/);
    return true;
  });
});

test('快手保留参数、Cookie 授权、HTTP 和无效响应错误，允许上游明确返回空列表', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = upstream(async () => { calls++; return Response.json({ result: 1, feeds: [] }); });
  await assert.rejects(run({ user_id: '../profile' }), /user_id 无效/);
  await assert.rejects(run({ user_id }, null), /Cookie 权限/);
  assert.equal(calls, 0);
  assert.deepEqual(JSON.parse((await run()).output).items, []);
  for (const response of [
    () => new Response('', { status: 403 }),
    () => new Response('<html>主页 HTTP 200</html>'),
    () => Response.json(null),
    () => Response.json({ result: 1 }),
  ]) {
    globalThis.fetch = upstream(async () => response());
    await assert.rejects(run(), /HTTP 403|unexpected token|未返回作品列表/);
  }
});
