import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { register } from "node:module";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { get_quickjs_module } = await import("../server/infra/script_sandbox.js");

const home_url = "https://www.douyin.com/";
const home = readFileSync(new URL("./fixtures/douyin/home.html", import.meta.url), "utf8");
const waf_page = readFileSync(new URL("./fixtures/douyin/waf.html", import.meta.url), "utf8");
const waf_sdk = gunzipSync(readFileSync(new URL("./fixtures/douyin/waf-sha256.js.gz", import.meta.url)));
const user_agent = "Mozilla/5.0 Chrome/156.0.0.0";
const QuickJS = await get_quickjs_module();
let module_index = 0;
const fresh_loader = async () => (await import(
  "../server/infra/douyin_sdk.js?test=" + module_index++
)).load_douyin_sdk;

test("云端 WAF 校验执行官方脚本后继续 nonce 校验，直到得到包含 SDK 的首页", async t => {
  const load = await fresh_loader();
  let page_calls = 0;
  let waf_calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url === home_url) {
      page_calls++;
      if (page_calls === 1) return new Response(waf_page);
      assert.match(options.headers.Cookie, /_wafchallengeid=/);
      if (page_calls === 2) {
        const pair = options.headers.Cookie.split("; ").find(pair => pair.startsWith("_wafchallengeid="));
        const proof = JSON.parse(Buffer.from(pair.slice(pair.indexOf("=") + 1), "base64"));
        assert.equal(Buffer.from(proof.d, "base64").toString(), "4");
        return new Response(`<script data-n="nonce-check">var _$jsvmprt=true;document.cookie="__ac_signature="+sdk_cookies.get("__ac_nonce");</script>`,
          { headers: { "Set-Cookie": "__ac_nonce=fixture; Path=/; Secure" } });
      }
      assert.match(options.headers.Cookie, /__ac_signature=fixture/);
      return new Response(home);
    }
    assert.equal(options.headers.Cookie, undefined);
    if (url === "https://lf-waf-js.byted-static.com/obj/waf-jschallenge/out-sha256.js") { waf_calls++; return new Response(waf_sdk); }
    return new Response("sdk");
  });
  assert.deepEqual(await load(QuickJS, user_agent), ["sdk", "sdk"]);
  assert.equal(page_calls, 3);
  assert.equal(waf_calls, 1);
});

test("WAF 只执行官方来源并限制页面校验轮数", async t => {
  const load = await fresh_loader();
  let page = waf_page.replace("https://lf-waf-js.byted-static.com/", "https://other.example/");
  let page_calls = 0;
  t.mock.method(globalThis, "fetch", async url => {
    if (url === home_url) { page_calls++; return new Response(page); }
    assert.equal(url, "https://lf-waf-js.byted-static.com/obj/waf-jschallenge/out-sha256.js");
    return new Response(waf_sdk);
  });
  await assert.rejects(load(QuickJS, user_agent), /非官方 WAF/);
  page = waf_page;
  page_calls = 0;
  await assert.rejects(load(QuickJS, user_agent), /未提供签名 SDK/);
  assert.equal(page_calls, 4);
});

test("BDMS 主 CDN 在云端超时后按官网 srcList 尝试备用 CDN", async t => {
  const load = await fresh_loader();
  const downloads = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url === home_url) return new Response(home);
    assert.equal(options.headers.Cookie, undefined);
    downloads.push(url);
    if (url.startsWith("https://p-pc-weboff.byteimg.com/")) throw new DOMException("Timed out", "TimeoutError");
    return new Response("sdk");
  });
  assert.deepEqual(await load(QuickJS, user_agent), ["sdk", "sdk"]);
  assert.deepEqual(downloads.map(url => new URL(url).hostname), [
    "p-pc-weboff.byteimg.com", "lf-c-flwb.bytetos.com", "lf-security.bytegoofy.com",
  ]);
});

test("正式出口对首页返回 403 时仍从核实的官方地址实时加载 SDK", async t => {
  const load = await fresh_loader();
  const downloads = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url === home_url) return new Response("", { status: 403 });
    assert.equal(options.headers.Cookie, undefined);
    downloads.push(url);
    return new Response("live-sdk");
  });
  assert.deepEqual(await load(QuickJS, user_agent), ["live-sdk", "live-sdk"]);
  assert.deepEqual(downloads, [
    "https://lf-c-flwb.bytetos.com/obj/rc-client-security/web/stable/1.0.1.19-fix.01/bdms.js",
    "https://lf-security.bytegoofy.com/obj/security-secsdk/runtime_bundler_34.js",
  ]);
});

test("轻量页面执行前置校验和 SDK 初始化，按页面地址下载且不向 CDN 传 Cookie", async t => {
  const load = await fresh_loader();
  const calls = [];
  const updated = home.replaceAll("1.0.1.19_fix", "2.0.0_fix").replaceAll("runtime_bundler_34", "runtime_bundler_35");
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, "manual");
    if (url === home_url && calls.length === 1) {
      assert.equal(options.headers.Cookie, undefined);
      return new Response(`<script data-n="challenge-setup">var _$jsvmprt = true;</script>
        <script data-n="challenge-cookie">document.cookie = "__ac_signature=" + sdk_cookies.get("__ac_nonce");location.reload();</script>`,
      { headers: { "Set-Cookie": "__ac_nonce=fixture-nonce; Path=/; Secure" } });
    }
    if (url === home_url) {
      assert.equal(options.headers.Cookie, "__ac_nonce=fixture-nonce; __ac_signature=fixture-nonce");
      return new Response(updated);
    }
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.headers.Referer, home_url);
    return new Response(url.includes("bdms") ? "bdms-v2" : "security-v2");
  });
  assert.deepEqual(await load(QuickJS, user_agent), ["bdms-v2", "security-v2"]);
  assert.deepEqual(calls, [home_url, home_url,
    "https://p-pc-weboff.byteimg.com/tos-cn-i-9r5gewecjs/bdms_2.0.0_fix.js",
    "https://lf-security.bytegoofy.com/obj/security-secsdk/runtime_bundler_35.js"]);
});

test("SDK 并发共享下载，经过五分钟仍然复用，直到签名被上游拒绝", async t => {
  const load = await fresh_loader();
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  let generation = 1;
  let page_calls = 0;
  t.mock.method(globalThis, "fetch", async url => {
    if (url === home_url) { page_calls++; return new Response(home); }
    return new Response("sdk-" + generation);
  });
  const results = await Promise.all([load(QuickJS, user_agent), load(QuickJS, user_agent)]);
  assert.deepEqual(results, [["sdk-1", "sdk-1"], ["sdk-1", "sdk-1"]]);
  generation++;
  assert.deepEqual(await load(QuickJS, user_agent), ["sdk-1", "sdk-1"]);
  assert.equal(page_calls, 1);
  t.mock.timers.tick(24 * 60 * 60 * 1000);
  assert.deepEqual(await load(QuickJS, user_agent), ["sdk-1", "sdk-1"]);
  assert.equal(page_calls, 1);
});

test("页面和 SDK 拒绝重定向，下载失败后可以重新发现并重试", async t => {
  const load = await fresh_loader();
  let redirect_page = true;
  let redirect_sdk = true;
  let empty_sdk = true;
  t.mock.method(globalThis, "fetch", async url => {
    if (url === home_url && !redirect_page) return new Response(home);
    if (url === home_url || redirect_sdk) return new Response(null, {
      status: 302, headers: { Location: "https://other.example/sdk.js" },
    });
    return new Response(empty_sdk ? "" : "sdk");
  });
  await assert.rejects(load(QuickJS, user_agent), /HTTP 302/);
  redirect_page = false;
  await assert.rejects(load(QuickJS, user_agent), /HTTP 302/);
  redirect_sdk = false;
  await assert.rejects(load(QuickJS, user_agent), /响应为空/);
  empty_sdk = false;
  assert.deepEqual(await load(QuickJS, user_agent), ["sdk", "sdk"]);
});

test("非官方 SDK 地址、无 SDK 的校验页和超限响应不会进入签名器", async t => {
  const load = await fresh_loader();
  let html;
  let sdk_calls = 0;
  t.mock.method(globalThis, "fetch", async url => {
    if (url !== home_url) { sdk_calls++; return new Response("must not download"); }
    return new Response(html);
  });
  for (html of [
    home.replace("https://lf-security.bytegoofy.com/", "https://other.example/"),
    home.replace("https://p-pc-weboff.byteimg.com/", "http://127.0.0.1/"),
    home.replace("https://lf-security.bytegoofy.com/", "https://secret@lf-security.bytegoofy.com/"),
    home.replace("https://lf-security.bytegoofy.com/", "https://lf-security.bytegoofy.com:8443/"),
  ]) await assert.rejects(load(QuickJS, user_agent), /非官方 SDK/);
  html = "<html data-n='verification-page'>验证</html>";
  await assert.rejects(load(QuickJS, user_agent), /未提供签名 SDK/);
  html = "x".repeat(2 * 1024 * 1024 + 1);
  await assert.rejects(load(QuickJS, user_agent), /文件过大/);
  assert.equal(sdk_calls, 0);
});

test("失控页面脚本受 VM 时限约束，SDK 流式响应受大小限制", async t => {
  const load = await fresh_loader();
  let body = home.replace("window._SdkGlueInit(c, a);", "while(true){};window._SdkGlueInit(c, a);");
  t.mock.method(globalThis, "fetch", async url => new Response(url === home_url ? body : "x".repeat(512001)));
  await assert.rejects(load(QuickJS, user_agent), /执行超时/);
  body = home;
  await assert.rejects(load(QuickJS, user_agent), /文件过大/);
});
