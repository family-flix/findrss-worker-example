import { DOUYIN_SDK_ENVIRONMENT, DOUYIN_SDK_RESULT } from './douyin_sdk_environment.js';
export const DOUYIN_SDK_FILES = Object.freeze([
  { url: 'https://p-pc-weboff.byteimg.com/tos-cn-i-9r5gewecjs/bdms_1.0.1.19_fix.js', sha256: 'a0e46f84476d63a1fa57bdcb47223e0e545c6ce0c3dacdd2818180dfa087909e' },
  { url: 'https://lf-security.bytegoofy.com/obj/security-secsdk-gray/runtime_bundler_34.js', sha256: 'aac9a17e87c05f8be30e0a5ee5cb7d544b89749f6bb0da9e5df4b434b7c2de04' },
]);
let sdk_flight;
async function download_sdk() {
  const sources = [];
  for (const file of DOUYIN_SDK_FILES) {
    const response = await fetch(file.url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('抖音签名 SDK 下载失败：HTTP ' + response.status);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 512000) throw new Error('抖音签名 SDK 文件过大');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('');
    if (hash !== file.sha256) throw new Error('抖音官方 SDK 内容已变更，需要重新审核版本');
    sources.push(new TextDecoder().decode(bytes));
  }
  return sources;
}
export async function load_douyin_sdk() {
  if (!sdk_flight) sdk_flight = download_sdk().catch(error => { sdk_flight = undefined; throw error; });
  return sdk_flight;
}
export function sign_douyin_request(QuickJS, sources, request) {
  const target = new URL(request.url);
  if (target.origin !== 'https://www.douyin.com' || !target.pathname.startsWith('/aweme/v1/web/')) throw new Error('抖音签名只允许 www.douyin.com 作品接口');
  if (!request.cookie.split('; ').some(pair => pair.startsWith('UIFID='))) throw new Error('抖音签名需要已同步的 UIFID Cookie');
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(32 * 1024 * 1024);
  runtime.setMaxStackSize(64 * 1024);
  const deadline = Date.now() + 3000;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm = runtime.newContext();
  try {
    const input = vm.newString(JSON.stringify(request));
    vm.setProp(vm.global, '__sdk_request', input); input.dispose();
    const bdms = sources[0].replace('return Y.set(t,n),V.set(n,[e,r]),n', 'n._v=[e,r];n._u=X;return Y.set(t,n),V.set(n,[e,r]),n');
    const result = vm.evalCode(DOUYIN_SDK_ENVIRONMENT + '\n' + bdms + '\n' + sources[1] + '\n' + DOUYIN_SDK_RESULT, 'douyin-sdk.js');
    if (result.error) { result.error.dispose(); throw new Error('抖音官方 SDK 签名执行失败，需检查 SDK 版本'); }
    const text = vm.getString(result.value); result.value.dispose();
    const output = JSON.parse(text);
    const signed = new URL(output.url);
    if (signed.origin !== target.origin || signed.pathname !== target.pathname) throw new Error('抖音 SDK 返回非法目标地址');
    const headers = {};
    for (const name of ['uifid','x-secsdk-web-signature','x-secsdk-web-expire']) {
      const value = output.headers?.[name];
      if (typeof value !== 'string' || /[\r\n\0]/.test(value) || value.length > 4096) throw new Error('抖音 SDK 返回非法签名请求头');
      headers[name] = value;
    }
    return { url: signed.toString(), headers };
  } finally { vm.dispose(); runtime.dispose(); }
}
