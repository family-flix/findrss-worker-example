import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { KUAISHOU_SDK_FILE, load_kuaishou_sdk, sign_kuaishou_request } from '../server/infra/kuaishou_sdk.js';

test('快手 SDK 拒绝重定向和哈希变更，失败可重试，成功只下载一次', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const status of [301, 302, 303, 307, 308]) {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, KUAISHOU_SDK_FILE.url);
      assert.equal(options.redirect, 'manual');
      return new Response(null, { status, headers: { Location: 'https://other.example/sdk.js' } });
    };
    await assert.rejects(load_kuaishou_sdk(), new RegExp('SDK 下载失败：HTTP ' + status));
  }
  globalThis.fetch = async () => new Response('changed SDK');
  await assert.rejects(load_kuaishou_sdk(), /SDK 内容已变更/);
  globalThis.fetch = async () => new Response(new Uint8Array(2 * 1024 * 1024 + 1));
  await assert.rejects(load_kuaishou_sdk(), /SDK 文件过大/);
  let calls = 0;
  const bytes = gunzipSync(await readFile(new URL('./fixtures/kuaishou/web-sdk.js.gz', import.meta.url)));
  globalThis.fetch = async () => { calls++; return new Response(bytes); };
  const source = await load_kuaishou_sdk();
  assert.match(source, /^var Jose=/);
  assert.equal(await load_kuaishou_sdk(), source);
  assert.equal(calls, 1);
});

test('固定版快手官方 SDK 在 QuickJS 动态生成签名，限制目标和方法并可从执行失败恢复', async () => {
  register('./support/quickjs_wasm_hook.js', import.meta.url);
  const { get_quickjs_module } = await import('../server/infra/script_sandbox.js');
  const QuickJS = await get_quickjs_module();
  const source = await load_kuaishou_sdk();
  const request = { url: 'https://www.kuaishou.com/rest/v/profile/feed', method: 'POST',
    body: JSON.stringify({ user_id: '3xuxw5yhgr6f4um', pcursor: '', page: 'profile' }), cookie: 'did=fixture' };
  assert.throws(() => sign_kuaishou_request(QuickJS, 'throw new Error("fixture")', request), /SDK 签名执行失败/);
  const signed = new URL(sign_kuaishou_request(QuickJS, source, request));
  assert.equal(signed.origin + signed.pathname, request.url);
  assert.equal(signed.searchParams.get('caver'), '2');
  assert.ok(signed.searchParams.get('__NS_hxfalcon').length > 200);
  assert.ok(!signed.toString().includes('fixture'));
  for (const changed of [
    { url: 'https://other.example/rest/v/profile/feed' },
    { url: 'https://www.kuaishou.com/other' },
    { method: 'GET' },
  ]) assert.throws(() => sign_kuaishou_request(QuickJS, source, { ...request, ...changed }), /签名只允许 POST/);
  assert.throws(() => sign_kuaishou_request(QuickJS, source, { ...request, body: '<html>' }), /SDK 签名执行失败/);
  assert.throws(() => sign_kuaishou_request(QuickJS, 'var Jose={call(){return "";}};', request), /签名参数|JSON/);
});

test('快手签名绑定当前 JSON 请求体及查询参数，替换旧签名且保留原查询', async () => {
  const { get_quickjs_module } = await import('../server/infra/script_sandbox.js');
  const QuickJS = await get_quickjs_module();
  const probe = `var Jose = { call(name, args) {
    if (name === '$getCatVersion') return '2';
    var input = args[0];
    if (input.url !== '/rest/v/profile/feed' || input.query.caver !== '2' || input.query.test !== '+' ||
        '__NS_hxfalcon' in input.query || input.requestBody.user_id !== 'fixture-user' ||
        input.requestBody.pcursor !== '' || input.requestBody.page !== 'profile' || Object.keys(input.form).length) throw new Error('wrong input');
    args[1].suc('fresh-signature');
  } };`;
  const signed = new URL(sign_kuaishou_request(QuickJS, probe, {
    url: 'https://www.kuaishou.com/rest/v/profile/feed?test=%2B&__NS_hxfalcon=old&caver=1',
    method: 'POST', body: JSON.stringify({ user_id: 'fixture-user', pcursor: '', page: 'profile' }), cookie: '',
  }));
  assert.deepEqual([...signed.searchParams], [['test', '+'], ['__NS_hxfalcon', 'fresh-signature'], ['caver', '2']]);
});
