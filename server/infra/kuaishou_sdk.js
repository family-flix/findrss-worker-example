export const KUAISHOU_SDK_FILE = Object.freeze({
  url: 'https://p66-plat.wskwai.com/kos/nlav111422/ks-web/assets/index-tD5zqbs9.js',
  sha256: 'ce3ba2c5b1ab5e907ce0c1116c22dca5a3aa45d1dc86f213c4d79f96a07a27b6',
});
let sdk_flight;
async function download_sdk() {
  const response = await fetch(KUAISHOU_SDK_FILE.url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('快手签名 SDK 下载失败：HTTP ' + response.status);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 2 * 1024 * 1024) throw new Error('快手签名 SDK 文件过大');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== KUAISHOU_SDK_FILE.sha256) throw new Error('快手官方 SDK 内容已变更，需要重新审核版本');
  const source = new TextDecoder().decode(bytes);
  const start = source.indexOf('var Jose=');
  const end = source.indexOf('const sig4Report=', start);
  if (start < 0 || end <= start) throw new Error('快手官方 SDK 缺少签名模块');
  return source.slice(start, end);
}
export async function load_kuaishou_sdk() {
  if (!sdk_flight) sdk_flight = download_sdk().catch(error => { sdk_flight = undefined; throw error; });
  return sdk_flight;
}
export function sign_kuaishou_request(QuickJS, source, request) {
  const target = new URL(request.url);
  if (target.origin !== 'https://www.kuaishou.com' || target.pathname !== '/rest/v/profile/feed' || request.method !== 'POST') {
    throw new Error('快手签名只允许 POST www.kuaishou.com/rest/v/profile/feed');
  }
  target.searchParams.delete('__NS_hxfalcon');
  target.searchParams.delete('caver');
  const input = { ...request, path: target.pathname, query: Object.fromEntries(target.searchParams) };
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(32 * 1024 * 1024);
  runtime.setMaxStackSize(64 * 1024);
  const deadline = Date.now() + 3000;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm = runtime.newContext();
  try {
    const value = vm.newString(JSON.stringify(input));
    vm.setProp(vm.global, '__sdk_request', value); value.dispose();
    const result = vm.evalCode(`
      var request = JSON.parse(__sdk_request);
      var window = globalThis, document = { cookie: request.cookie, scripts: [] };
      var location = { href: request.url }, console = { log() {}, error() {} };
      ${source}
      var caver = Jose.call('$getCatVersion'), output;
      Jose.call('$encode', [{
        url: request.path, query: { caver, ...request.query }, form: {},
        requestBody: JSON.parse(request.body),
      }, { suc(sign) { output = { sign, caver }; }, err() { throw new Error('签名失败'); } }]);
      JSON.stringify(output);
    `, 'kuaishou-sdk.js');
    if (result.error) { result.error.dispose(); throw new Error('快手官方 SDK 签名执行失败，需检查 SDK 版本'); }
    const text = vm.getString(result.value); result.value.dispose();
    const output = JSON.parse(text);
    if (typeof output?.sign !== 'string' || !output.sign || output.sign.length > 4096 || !/^\d{1,8}$/.test(output.caver)) {
      throw new Error('快手 SDK 返回非法签名参数');
    }
    target.searchParams.set('__NS_hxfalcon', output.sign);
    target.searchParams.set('caver', output.caver);
    return target.toString();
  } finally { vm.dispose(); runtime.dispose(); }
}
