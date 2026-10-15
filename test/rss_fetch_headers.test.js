import test from "node:test";
import assert from "node:assert/strict";
import { rss_fetch_headers, rss_fetch_request, rss_fetch_timeout, rss_cookie_headers, RSS_FETCH_CREDENTIAL_HEADERS } from '../server/infra/rss_fetch_headers.js';

test('每请求超时只能缩短默认预算，拒绝非法值', () => {
  assert.equal(rss_fetch_timeout(), 10000);
  assert.equal(rss_fetch_timeout({ timeout_ms: 3000 }), 3000);
  for (const timeout_ms of [null, 0, -1, 10001, 1.5, '3000', Infinity, NaN]) assert.throws(() => rss_fetch_timeout({ timeout_ms }));
});

test('微博 profile 请求头和 Cookie 派生 XSRF，跨 origin 时作为认证头移除', () => {
  const headers = rss_fetch_headers({ headers: { 'client-version': 'v1.1.251', 'server-version': 'v2026.10.12.1', 'x-xsrf-token': 'fixture' } });
  assert.equal(headers['x-xsrf-token'], 'fixture');
  const options = { cookie_headers: { 'x-xsrf-token': 'XSRF-TOKEN' } };
  assert.deepEqual(rss_cookie_headers(options, 'SUB=private; XSRF-TOKEN=xsrf-fixture'), { 'x-xsrf-token': 'xsrf-fixture' });
  assert.deepEqual(rss_cookie_headers(options, ''), {});
  assert.ok(RSS_FETCH_CREDENTIAL_HEADERS.includes('x-xsrf-token'));
  assert.throws(() => rss_cookie_headers({ cookie_headers: { 'x-xsrf-token': 'SUB' } }, 'SUB=private'));
});

test('临时 Cookie 头经过同样的类型、长度和换行校验', () => {
  assert.equal(rss_fetch_headers({ headers: { Cookie: 'SUB=fixture' } }).cookie, 'SUB=fixture');
  for (const cookie of [123, null, 'SUB=x\r\nHost: other.example', 'x'.repeat(4097)]) {
    assert.throws(() => rss_fetch_headers({ headers: { Cookie: cookie } }), /请求头值无效/);
  }
});

test('POST body 和认证头通过边界校验，Host 仍不可覆盖', () => {
  assert.deepEqual(rss_fetch_request({ method: 'post', body: '{}' }), { method: 'POST', body: '{}' });
  assert.equal(rss_fetch_request(null).method, 'GET');
  for (const options of [{ method: 123 }, { method: 'DELETE' }, { body: '' }, { method: 'POST', body: {} }, { method: 'POST', body: '中'.repeat(45000) }]) assert.throws(() => rss_fetch_request(options));
  assert.equal(rss_fetch_headers({ headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' } }).authorization, 'Bearer fixture');
  for (const headers of [{ Host: 'other.example' }, { Authorization: 'Bearer x\r\nHost: bad' }]) assert.throws(() => rss_fetch_headers({ headers }));
  assert.deepEqual(rss_cookie_headers({ cookie_headers: { kww: 'kwfv1', 'X-Csrf-Token': 'ct0' } }, 'kwfv1=k;ct0=c'), { kww: 'k', 'x-csrf-token': 'c' });
});

test('Cookie 派生头仅允许站点约定映射，不允许覆盖任意请求头', async () => {
  const { rss_cookie_headers } = await import('../server/infra/rss_fetch_headers.js');
  assert.deepEqual(rss_cookie_headers({ cookie_headers: { uifid: 'UIFID' } }, 'sid=x; UIFID=fixture'), { uifid: 'fixture' });
  assert.deepEqual(rss_cookie_headers({ cookie_headers: { uifid: 'UIFID' } }, ''), {});
  for (const mapping of [{ Cookie: 'UIFID' }, { uifid: 'sessionid' }, null, []]) assert.throws(() => rss_cookie_headers({ cookie_headers: mapping }, 'UIFID=fixture'));
});

test('酷安 App 协议头通过校验，Token 按认证头处理', () => {
  const headers = Object.fromEntries(['X-App-Id', 'X-App-Token', 'X-Sdk-Int', 'X-Sdk-Locale', 'X-App-Version', 'X-Api-Version', 'X-App-Code'].map(name => [name, 'fixture']));
  assert.equal(Object.keys(rss_fetch_headers({ headers })).length, 9);
  assert.ok(RSS_FETCH_CREDENTIAL_HEADERS.includes('x-app-token'));
  assert.throws(() => rss_fetch_headers({ headers: { 'X-App-Token': 'x\r\nHost: bad' } }), /无效/);
});
