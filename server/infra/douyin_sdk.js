import { parse } from 'node-html-parser';
import { DOUYIN_SDK_ENVIRONMENT, DOUYIN_BDMS_REQUEST, DOUYIN_SDK_RESULT } from './douyin_sdk_environment.js';

export const DOUYIN_HOME = 'https://www.douyin.com/';
let sdk_cache, sdk_flight;
const signature_cache = new Map();

function execute_page_script(QuickJS, source, request) {
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(32 * 1024 * 1024);
  runtime.setMaxStackSize(64 * 1024);
  const deadline = Date.now() + 10000;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm = runtime.newContext();
  try {
    const input = vm.newString(JSON.stringify(request));
    vm.setProp(vm.global, '__sdk_request', input); input.dispose();
    const result = vm.evalCode(DOUYIN_SDK_ENVIRONMENT + '\n' + source, 'douyin-page.js');
    if (result.error) {
      const error = vm.dump(result.error);
      result.error.dispose();
      throw new Error(error?.message?.includes('interrupted')
        ? '抖音官方页面或 SDK 执行超时'
        : '抖音官方页面或 SDK 执行失败，请检查兼容性');
    }
    try { return JSON.parse(vm.getString(result.value)); }
    finally { result.value.dispose(); }
  } finally { vm.dispose(); runtime.dispose(); }
}

async function read_official_text(url, headers, limit) {
  const response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Object.assign(new Error('抖音页面或 SDK 下载失败：HTTP ' + response.status + ' (' + new URL(url).hostname + ')'), { status: response.status, url });
  const reader = response.body?.getReader();
  if (!reader) throw new Error('抖音页面或 SDK 响应为空');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('抖音页面或 SDK 文件过大');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (!size) throw new Error('抖音页面或 SDK 响应为空');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { text: new TextDecoder().decode(bytes), headers: response.headers };
}

function sdk_url(value, kind) {
  const url = new URL(value, DOUYIN_HOME);
  const allowed = kind === 'security'
    ? url.hostname === 'lf-security.bytegoofy.com' && /^\/obj\/security-secsdk(?:-gray)?\/runtime_bundler_[\w.-]+\.js$/.test(url.pathname)
    : url.hostname === 'p-pc-weboff.byteimg.com' && /^\/tos-cn-i-9r5gewecjs\/bdms_[\w.-]+\.js$/.test(url.pathname)
      || ['lf-c-flwb.bytetos.com', 'lf-headquarters-speed.yhgfb-cn-static.com'].includes(url.hostname)
        && /^\/obj\/rc-client-security\/web\/stable\/[\w.-]+\/bdms\.js$/.test(url.pathname);
  if (!allowed || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
    throw new Error('抖音页面返回了非官方 SDK 地址');
  }
  return url.href;
}

async function discover_sdk_urls(QuickJS, user_agent) {
  const headers = {
    'User-Agent': user_agent,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Cache-Control': 'no-cache',
    'sec-fetch-site': 'none',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-dest': 'document',
  };
  let page, cookie = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    page = await read_official_text(DOUYIN_HOME, { ...headers, ...(cookie ? { Cookie: cookie, Referer: DOUYIN_HOME } : {}) }, 2 * 1024 * 1024);
    const nodes = parse(page.text).querySelectorAll('script');
    const waf = nodes.find(node => node.textContent.includes('"_wafchallengeid"'));
    if (!waf && !page.text.includes('_$jsvmprt')) break;
    cookie = [cookie, ...page.headers.getSetCookie().map(value => value.split(';')[0])].filter(Boolean).join('; ');
    let source;
    if (waf) {
      const script = nodes.find(node => (node.getAttribute('src') || '').includes('/obj/waf-jschallenge/'));
      if (script?.getAttribute('src') !== 'https://lf-waf-js.byted-static.com/obj/waf-jschallenge/out-sha256.js') {
        throw new Error('抖音页面返回了非官方 WAF 校验脚本');
      }
      const challenge = await read_official_text(script.getAttribute('src'), { 'User-Agent': user_agent, Referer: DOUYIN_HOME }, 512000);
      source = `
        var TextEncoder=function(){};
        TextEncoder.prototype.encode=function(value){var text=unescape(encodeURIComponent(String(value)));return Uint8Array.from(text,function(c){return c.charCodeAt(0);});};
        navigator.plugins=[];navigator.webdriver=false;navigator.vendor='Google Inc.';
        window.WAFJS=noop;
        var interval_callback;
        setInterval=function(callback){interval_callback=callback;return 1;};
        clearInterval=function(){interval_callback=null;};
      ` + challenge.text + '\n' + waf.textContent + '\nreadygo();\n'
        + 'for(var turn=0;interval_callback && turn<=1000000;turn++)interval_callback();';
    } else {
      source = nodes.filter(node => !node.getAttribute('src')).map(node => node.textContent).join('\n;\n');
    }
    cookie = execute_page_script(QuickJS,
      'location.reload=noop;location.replace=noop;\n' + source + '\nJSON.stringify(document.cookie);',
      { url: DOUYIN_HOME, cookie, user_agent });
    if (typeof cookie !== 'string' || /[\r\n\0]/.test(cookie)) throw new Error('抖音首页返回了无效 Cookie');
  }
  const scripts = parse(page.text).querySelectorAll('script');
  const security = scripts.find(node => /\/security-secsdk(?:-gray)?\//.test(node.getAttribute('src') || ''));
  const init = scripts.find(node => !node.getAttribute('src') && node.textContent.includes('window._SdkGlueInit('));
  if (!security || !init) throw new Error('抖音首页未提供签名 SDK，请检查上游页面或访问校验');
  const config = execute_page_script(QuickJS,
    'var sdk_config;window._SdkGlueInit=function(config,files){sdk_config=files;};\n'
      + init.textContent + '\nJSON.stringify(sdk_config);',
    { url: DOUYIN_HOME, cookie: '', user_agent });
  const bdms_urls = config?.bdms?.srcList;
  if (!Array.isArray(bdms_urls) || !bdms_urls.length || bdms_urls.some(url => typeof url !== 'string')) throw new Error('抖音首页未提供 BDMS SDK');
  const urls = bdms_urls.slice(0, 3).map(url => sdk_url(url, 'bdms'));
  const security_url = sdk_url(security.getAttribute('src'), 'security');
  return { urls, security_url };
}

async function download_sdk(QuickJS, user_agent) {
  let discovered;
  try { discovered = await discover_sdk_urls(QuickJS, user_agent); }
  catch (error) {
    if (error.status !== 403 || error.url !== DOUYIN_HOME) throw error;
    // shortcut: 首页被拒绝时使用最后核实的官方地址，官网停用此 BDMS 版本时需更新引导地址。
    discovered = {
      urls: [
        'https://lf-c-flwb.bytetos.com/obj/rc-client-security/web/stable/1.0.1.19-fix.01/bdms.js',
        'https://p-pc-weboff.byteimg.com/tos-cn-i-9r5gewecjs/bdms_1.0.1.19_fix.js',
        'https://lf-headquarters-speed.yhgfb-cn-static.com/obj/rc-client-security/web/stable/1.0.1.19-fix.01/bdms.js',
      ],
      security_url: 'https://lf-security.bytegoofy.com/obj/security-secsdk/runtime_bundler_34.js',
    };
  }
  const { urls, security_url } = discovered;
  const sdk_headers = { 'User-Agent': user_agent, Referer: DOUYIN_HOME };
  let bdms, failure;
  for (const url of urls) {
    try { bdms = (await read_official_text(url, sdk_headers, 512000)).text; break; }
    catch (error) { failure = error; }
  }
  if (!bdms) throw failure;
  const security_source = await read_official_text(security_url, sdk_headers, 512000);
  return [bdms, security_source.text];
}

export async function load_douyin_sdk(QuickJS, user_agent) {
  if (sdk_cache) return sdk_cache;
  if (!sdk_flight) {
    sdk_flight = download_sdk(QuickJS, user_agent).then(sources => {
      sdk_cache = sources;
      return sources;
    }).finally(() => { sdk_flight = undefined; });
  }
  return sdk_flight;
}

export async function get_douyin_signature(create_quickjs, request, storage) {
  const url = new URL(request.url);
  // timestamp 由签名器重写；复用时必须连同旧时间戳和全部签名请求头一起发送。
  url.searchParams.delete('timestamp');
  url.searchParams.delete('a_bogus');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(
    JSON.stringify([url.href, request.cookie, request.user_agent])));
  const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  let entry = signature_cache.get(key);
  if (!entry?.promise) {
    const rejected_url = entry?.rejected_url;
    if (signature_cache.size >= 256 && !entry) signature_cache.delete(signature_cache.keys().next().value);
    entry = {};
    signature_cache.set(key, entry);
    entry.promise = (async () => {
      try {
        if (storage) {
          try {
            const saved = await storage.read(key);
            if (saved && saved.url !== rejected_url) {
              return { ...validated_signature(new URL(request.url), saved), key, entry, storage };
            }
          } catch {}
        }
        let signed;
        if (storage?.generate) {
          signed = validated_signature(new URL(request.url), await storage.generate(request));
        } else {
          const QuickJS = await create_quickjs();
          const sdk = await load_douyin_sdk(QuickJS, request.user_agent);
          signed = sign_douyin_request(QuickJS, sdk, request);
        }
        // 签名缓存不可用时仍返回本次有效签名；Cookie 授权与读取失败继续由宿主拒绝。
        if (storage) { try { await storage.write(key, signed); } catch {} }
        return { ...signed, key, entry, storage };
      } catch (error) {
        if (signature_cache.get(key) === entry) {
          signature_cache.delete(key);
          sdk_cache = undefined;
        }
        throw error;
      }
    })();
  }
  return entry.promise;
}

export async function invalidate_douyin_signature(signature) {
  if (signature_cache.get(signature.key) !== signature.entry) return;
  // KV 删除可能尚未传播，当前实例不能再次接受刚被上游拒绝的旧签名。
  signature_cache.set(signature.key, { rejected_url: signature.url });
  sdk_cache = undefined;
  if (signature.storage) { try { await signature.storage.remove(signature.key); } catch {} }
}

export function douyin_signature_rejected(status, text) {
  const body = text.trim();
  return status === 200 && !body
    || [200, 403].includes(status) && /^(?:Blocked by\s+)?ArgusSecurityPlugin\s+Sign\s+Invalid[.!]?$/i.test(body);
}

export function sign_douyin_request(QuickJS, sources, request) {
  const target = new URL(request.url);
  if (!['https://www.douyin.com', 'https://www-hj.douyin.com'].includes(target.origin) || !target.pathname.startsWith('/aweme/v1/web/')) throw new Error('抖音签名只允许 www.douyin.com 或 www-hj.douyin.com 作品接口');
  if (!request.cookie.split('; ').some(pair => /^(?:UIFID|UIFID_TEMP)=.+/.test(pair))) throw new Error('抖音签名需要已同步的 UIFID 或 UIFID_TEMP Cookie');
  const output = execute_page_script(QuickJS, sources[0] + '\n' + DOUYIN_BDMS_REQUEST + '\n' + sources[1] + '\n' + DOUYIN_SDK_RESULT, request);
  return validated_signature(target, output);
}

function validated_signature(target, output) {
  const signed = new URL(output.url);
  if (signed.origin !== target.origin || signed.pathname !== target.pathname) throw new Error('抖音 SDK 返回非法目标地址');
  const headers = {};
  for (const name of ['uifid','x-secsdk-web-signature','x-secsdk-web-expire']) {
    const value = output.headers?.[name];
    if (typeof value !== 'string' || /[\r\n\0]/.test(value) || value.length > 4096) throw new Error('抖音 SDK 返回非法签名请求头');
    headers[name] = value;
  }
  return { url: signed.toString(), headers };
}
