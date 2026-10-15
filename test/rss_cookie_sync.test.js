import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/quickjs_wasm_hook.js', import.meta.url);
const { ServiceScript } = await import('../server/service/durable_object/scripts.js');
function setup() {
  let saved;
  const service = Object.create(ServiceScript.prototype);
  service.repo = { rss_cookies: { get: () => saved || [], put: cookies => { saved = cookies; } } };
  service.invalidate_routes = () => {};
  return { service, saved: () => saved };
}
function request(cookies) { return new Request('https://local/api/cookies/update', { method: 'POST', body: JSON.stringify({ cookies, crypto_type: 'none' }) }); }
test('Cookie 管理读取需要管理员身份，读取和编辑复用已有存储', async () => {
  const { route } = await import('../durable_object_router.js');
  const { default: worker } = await import('../api.js');
  const ctx = setup();
  const app = { scripts: ctx.service };
  let forwarded = 0;
  const env = { ADMIN_PASSWORD: 'admin-fixture', API: { getByName: () => ({ fetch: async request => {
    forwarded++;
    return route(request, app);
  } }) } };
  const url = 'https://local/admin/api/cookies';
  assert.equal((await worker.fetch(new Request(url), env)).status, 401);
  assert.equal(forwarded, 0);
  const headers = { Authorization: 'Bearer admin-fixture' };
  const empty = await worker.fetch(new Request(url, { headers }), env);
  assert.deepEqual(await empty.json(), { cookies: [] });
  assert.match(empty.headers.get('Cache-Control'), /no-store/);
  const cookie = { name: 'sid', value: 'submitted', domain: '.example.com', path: '/account', secure: true };
  await ctx.service.update_rss_cookies(request([cookie]));
  let result = await worker.fetch(new Request(url, { headers }), env);
  assert.equal((await result.json()).cookies[0].value, 'submitted');
  const update = { method: 'POST', headers, body: JSON.stringify({ cookies: [{ ...cookie, value: 'edited' }] }) };
  assert.equal((await worker.fetch(new Request(url + '/update', update), env)).status, 200);
  result = await worker.fetch(new Request(url, { headers }), env);
  const saved = (await result.json()).cookies[0];
  assert.equal(saved.value, 'edited');
  assert.equal(saved.path, '/account');
  assert.equal(saved.secure, true);
  assert.equal((await worker.fetch(new Request('https://local/api/cookies'), env)).status, 404);
});
test('浏览器无名 Cookie 被跳过，合法 Cookie 仍原样保存', async () => {
  const ctx = setup();
  const cookie = { name: 'sessionid', value: 'fixture', domain: '.douyin.com', path: '/', secure: true };
  const result = await ctx.service.update_rss_cookies(request([{ name: '', value: 'douyin.com', domain: 'www.douyin.com', path: '/user' }, cookie]));
  assert.equal(result.count, 1);
  assert.equal(result.skipped, 1);
  assert.equal(ctx.saved()[0].name, 'sessionid');
  assert.equal(ctx.saved()[0].secure, true);
});
test('逐条增改删按域名/name/path 定位，保留其他 Cookie 和原属性', async () => {
  const ctx = setup();
  const cookie = { name: 'sid', value: 'original', domain: '.example.com', path: '/', secure: true, hostOnly: true, expirationDate: 1900000000 };
  await ctx.service.update_rss_cookies(request([cookie, { ...cookie, path: '/account' }, { ...cookie, domain: '.other.com' }]));
  const result = ctx.service.edit_rss_cookie({ domain: cookie.domain, name: cookie.name, path: '/', value: 'edited', secure: false }, 'PATCH');
  assert.equal(result.cookie.value, 'edited');
  assert.equal(result.cookie.secure, true);
  assert.equal(result.cookie.hostOnly, true);
  assert.equal(result.cookie.expirationDate, 1900000000);
  assert.equal(ctx.saved()[1].value, 'original');
  assert.equal(ctx.saved()[2].value, 'original');
  assert.throws(() => ctx.service.edit_rss_cookie({ ...cookie, value: 'invalid;value' }, 'PATCH'), /invalid/);
  assert.throws(() => ctx.service.edit_rss_cookie({ ...cookie, path: 'invalid' }, 'DELETE'), /path/);
  assert.throws(() => ctx.service.edit_rss_cookie(cookie, 'POST'), error => error.status === 409);
  assert.throws(() => ctx.service.edit_rss_cookie({ ...cookie, name: 'missing' }, 'DELETE'), error => error.status === 404);
  assert.equal(ctx.saved().length, 3);
  const added = ctx.service.edit_rss_cookie({ domain: cookie.domain, name: 'new', value: '' }, 'POST');
  assert.equal(added.count, 4);
  assert.equal(added.cookie.path, '/');
  ctx.service.edit_rss_cookie({ ...cookie, path: '/account' }, 'DELETE');
  assert.deepEqual(ctx.saved().map(item => [item.domain, item.name, item.path]), [
    ['.example.com', 'sid', '/'], ['.other.com', 'sid', '/'], ['.example.com', 'new', '/'],
  ]);
});
test('管理员单条接口要求鉴权，拒绝非法 JSON/值并复用缓存失效', async () => {
  const { route } = await import('../durable_object_router.js');
  const { default: worker } = await import('../api.js');
  const ctx = setup();
  let invalidations = 0;
  ctx.service.invalidate_routes = () => invalidations++;
  const env = { ADMIN_PASSWORD: 'admin-fixture', API: { getByName: () => ({ fetch: request => route(request, { scripts: ctx.service }) }) } };
  const send = (method, body, authorized = true) => worker.fetch(new Request('https://local/admin/api/cookies', {
    method, body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: authorized ? { Authorization: 'Bearer admin-fixture' } : {},
  }), env);
  const cookie = { domain: '.example.com', name: 'sid', value: 'test' };
  for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal((await send(method, cookie, false)).status, 401);
  assert.equal((await send('POST', cookie)).status, 200);
  assert.equal((await send('PATCH', { ...cookie, value: 'edited' })).status, 200);
  for (const body of ['{', 'null', '[]', { ...cookie, value: 'bad\nvalue' }, { ...cookie, name: '' }]) {
    assert.equal((await send('PATCH', body)).status, 400);
  }
  assert.equal(ctx.saved()[0].value, 'edited');
  assert.equal((await send('POST', cookie)).status, 409);
  assert.equal((await send('DELETE', cookie)).status, 200);
  assert.deepEqual(ctx.saved(), []);
  assert.equal(invalidations, 3);
});
test('全为无名 Cookie 不清空存储，危险 Cookie 仍拒绝；显式空数组允许清空', async () => {
  const ctx = setup();
  await assert.rejects(ctx.service.update_rss_cookies(request([{ name: '', value: 'x', domain: '.douyin.com' }])), /no valid named/);
  assert.equal(ctx.saved(), undefined);
  await assert.rejects(ctx.service.update_rss_cookies(request([{ name: 'sessionid', value: 'a\r\nb', domain: '.douyin.com' }])), /invalid/);
  assert.equal(ctx.saved(), undefined);
  const result = await ctx.service.update_rss_cookies(request([]));
  assert.equal(result.count, 0);
  assert.deepEqual(ctx.saved(), []);
});
