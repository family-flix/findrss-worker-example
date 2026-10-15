import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { DOUYIN_SDK_FILES, load_douyin_sdk, sign_douyin_request } from '../server/infra/douyin_sdk.js';
import { DOUYIN_SDK_ENVIRONMENT, DOUYIN_SDK_RESULT } from '../server/infra/douyin_sdk_environment.js';

test('SDK 下载使用 Workers 支持的 manual 模式，拒绝重定向且允许失败后重试', async () => {
  const original_fetch = globalThis.fetch;
  let calls = 0;
  try {
    for (const status of [301, 302, 303, 307, 308]) {
      globalThis.fetch = async (url, options) => {
        calls++;
        assert.equal(url, DOUYIN_SDK_FILES[0].url);
        assert.equal(options.redirect, 'manual');
        return new Response(null, { status, headers: { Location: 'https://other.example/sdk.js' } });
      };
      await assert.rejects(load_douyin_sdk(), new RegExp('SDK 下载失败：HTTP ' + status));
    }
    assert.equal(calls, 5);
  } finally { globalThis.fetch = original_fetch; }
});

test('SDK 正常响应仍校验内容哈希', async () => {
  const original_fetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.redirect, 'manual');
    return new Response('changed SDK');
  };
  try {
    await assert.rejects(load_douyin_sdk(), /SDK 内容已变更/);
  } finally { globalThis.fetch = original_fetch; }
});

test('SDK document.cookie 合并单项写入、覆盖和过期删除，保留 UIFID 与含等号的值', () => {
  const context = { __sdk_request: JSON.stringify({ cookie: 'UIFID=fixture; session=a=b', url: 'https://www.douyin.com/', user_agent: 'fixture' }) };
  runInNewContext(DOUYIN_SDK_ENVIRONMENT, context);
  for (const value of ['msToken=new; path=/; secure', 'msToken=updated; path=/', 'session=; Max-Age=0', 'expired=x; expires=Thu, 01 Jan 1970 00:00:00 GMT']) {
    context.document.cookie = value;
  }
  assert.equal(context.document.cookie, 'UIFID=fixture; msToken=updated');
});

test('SDK 签名使用同一时刻，并保持浏览器请求中的 %20 与字面加号', () => {
  const context = { __sdk_request: JSON.stringify({ cookie: 'UIFID=fixture; s_v_web_id=verify_fixture', url: 'https://www.douyin.com/aweme/v1/web/aweme/post/?os_name=Mac%20OS&literal=%2B&timestamp=1', user_agent: 'fixture' }) };
  const output = JSON.parse(runInNewContext(DOUYIN_SDK_ENVIRONMENT + `
    var signing_input;
    var bdms={init:{_v:[null,[]]}};
    bdms.init._v[1][37]=function(query){signing_input=query;return 'fixture';};
    function use(){return function(url){return {url:url,headers:{'x-secsdk-web-signature':'fixture','x-secsdk-web-expire':String(Math.floor(Date.now()/1000))}};};}
  ` + DOUYIN_SDK_RESULT, context));
  assert.match(context.signing_input, /os_name=Mac%20OS&literal=%2B/);
  const params = new URL(output.url).searchParams;
  assert.notEqual(params.get('timestamp'), '1');
  assert.equal(params.get('timestamp'), output.headers['x-secsdk-web-expire']);
  assert.equal(params.get('verifyFp'), 'verify_fixture');
  assert.equal(params.get('fp'), 'verify_fixture');
});

test('真实固定版本 SDK 在 QuickJS 写 Cookie 后仍传出 provider UIFID，失败后可继续执行', async () => {
  register('./support/quickjs_wasm_hook.js', import.meta.url);
  const { get_quickjs_module } = await import('../server/infra/script_sandbox.js');
  const QuickJS = await get_quickjs_module();
  const request = { url: 'https://www.douyin.com/aweme/v1/web/aweme/post/?aid=6383&os_name=Mac%20OS&timestamp=1', cookie: 'UIFID=provider-fixture', user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36' };
  const files = await Promise.all(['bdms.js.gz', 'security.js.gz'].map(name => readFile(new URL('./fixtures/douyin/' + name, import.meta.url))));
  const original_fetch = globalThis.fetch;
  let sources;
  try {
    globalThis.fetch = async url => new Response(gunzipSync(files[DOUYIN_SDK_FILES.findIndex(file => file.url === url)]));
    sources = await load_douyin_sdk();
  } finally { globalThis.fetch = original_fetch; }
  assert.throws(() => sign_douyin_request(QuickJS, ['throw new Error("fixture")', ''], request), /SDK 签名执行失败/);
  const result = sign_douyin_request(QuickJS, sources, request);
  assert.equal(result.headers.uifid, 'provider-fixture');
  assert.ok(new URL(result.url).searchParams.get('a_bogus').length > 100);
  assert.match(result.headers['x-secsdk-web-signature'], /^[a-f0-9]{32}$/);
  assert.match(result.headers['x-secsdk-web-expire'], /^\d+$/);
  assert.equal(new URL(result.url).searchParams.get('timestamp'), result.headers['x-secsdk-web-expire']);
  assert.throws(() => sign_douyin_request(QuickJS, sources, { ...request, cookie: '' }), /UIFID Cookie/);
  assert.throws(() => sign_douyin_request(QuickJS, sources, { ...request, url: 'https://other.example/aweme/v1/web/' }), /只允许/);
});
