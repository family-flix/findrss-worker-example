import assert from "node:assert/strict";
import test from "node:test";
import { fetch_rsshub_route_js } from "../server/infra/rsshub_route.js";

const blob_url = "https://github.com/DIYgod/RSSHub/blob/master/lib/routes/005/index.tsx";
const raw_url = "https://raw.githubusercontent.com/DIYgod/RSSHub/master/lib/routes/005/index.tsx";
const source = `import { load } from 'cheerio';
import { parseDate } from '@/utils/parse-date';
import helper from './helper';
import config from '../config.json';
export const route: Route = { path: '/:category?', handler: () => <p>资讯</p> };`;

test("RSSHub blob/raw 源码链接归一化，不执行 TSX，返回同分支依赖候选与命名空间", async () => {
  for (const url of [blob_url + "?plain=1#L10", raw_url, blob_url.replace("/blob/", "/raw/")]) {
    const result = await fetch_rsshub_route_js({ url }, { fetch_impl: async (url, options) => {
      assert.equal(url, raw_url);
      assert.equal(options.redirect, "manual");
      assert.equal(options.method, "GET");
      assert.equal(options.headers.Authorization, undefined);
      return new Response(source);
    } });
    assert.equal(result.source, source);
    assert.equal(result.bytes, new TextEncoder().encode(source).byteLength);
    assert.equal(result.path, "lib/routes/005/index.tsx");
    assert.equal(result.namespace_url, raw_url.replace("index.tsx", "namespace.ts"));
    assert.deepEqual(result.imports[0], { specifier: "cheerio", candidate_urls: [] });
    assert.equal(result.imports[1].candidate_urls[0], "https://raw.githubusercontent.com/DIYgod/RSSHub/master/lib/utils/parse-date.ts");
    assert.equal(result.imports[2].candidate_urls[0], raw_url.replace("index.tsx", "helper.ts"));
    assert.deepEqual(result.imports[3].candidate_urls, ["https://raw.githubusercontent.com/DIYgod/RSSHub/master/lib/routes/config.json"]);
  }
  const branch = await fetch_rsshub_route_js({ url: blob_url.replace("/master/", "/feature/route/") }, {
    fetch_impl: async url => { assert.ok(url.includes("/feature/route/lib/")); return new Response(source); },
  });
  assert.equal(branch.ref, "feature/route");
  assert.ok(branch.imports[1].candidate_urls[0].includes("/feature/route/lib/"));
});

test("RSSHub 抓取拒绝外部仓库、非源码路径、凭据、内网和编码路径绕过", async () => {
  for (const url of [undefined, 123, "x".repeat(2049), "not-a-url", "http://localhost/lib/test.ts",
    blob_url.replace("https:", "http:"), blob_url.replace("github.com", "github.com.evil.example"),
    blob_url.replace("DIYgod/RSSHub", "other/RSSHub"), blob_url.replace("/blob/", "/tree/"),
    blob_url.replace("/lib/", "/docs/"), blob_url.replace(".tsx", ".html"),
    blob_url.replace("github.com", "u:p@github.com"), blob_url.replace("github.com", "github.com:8443"),
    blob_url.replace("/005/", "/005/%2e%2e%2f%2e%2e%2f"), blob_url.replace("index.tsx", "bad%00.ts"),
    blob_url.replace("index.tsx", "bad%252f.ts"), blob_url.replace("index.tsx", "bad%ZZ.ts")]) {
    await assert.rejects(fetch_rsshub_route_js({ url }, { fetch_impl: () => assert.fail("非法地址不能发起请求") }));
  }
});

test("RSSHub 非成功响应、重定向、空文件、HTML 和超大源码均返回明确错误", async () => {
  for (const [response, error] of [
    [new Response("missing", { status: 404 }), /HTTP 404/],
    [new Response("", { status: 302, headers: { Location: "http://127.0.0.1/" } }), /HTTP 302/],
    [new Response(null), /响应为空/], [new Response(" \n"), /文件为空/],
    [new Response("<!doctype html><html>error</html>"), /HTML/],
    [new Response(source, { headers: { "Content-Length": String(64 * 1024 + 1) } }), /64KB/],
    [new Response("中".repeat(24 * 1024)), /64KB/],
  ]) {
    await assert.rejects(fetch_rsshub_route_js({ url: blob_url }, { fetch_impl: async () => response }), error);
    assert.equal(response.body?.locked ?? false, false);
  }
});

test("RSSHub 分块解码保持 UTF-8，大小限制覆盖响应体，超时和取消覆盖响应头与正文", async () => {
  const encoded = new TextEncoder().encode(source);
  const decoded = await fetch_rsshub_route_js({ url: blob_url }, { fetch_impl: async () => new Response(new ReadableStream({
    start(controller) { for (const byte of encoded) controller.enqueue(new Uint8Array([byte])); controller.close(); },
  })) });
  assert.equal(decoded.source, source);
  for (const body_phase of [false, true]) {
    let request_signal, cancelled = false;
    const fetch_impl = async (_url, options) => {
      request_signal = options.signal;
      if (!body_phase) return new Promise(() => {});
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
    };
    await assert.rejects(fetch_rsshub_route_js({ url: blob_url }, {
      fetch_impl, timeout_options: { idle_ms: 10, total_ms: 1000 },
    }), /超时/);
    assert.equal(request_signal.aborted, true);
    if (body_phase) assert.equal(cancelled, true);
    const controller = new AbortController();
    const pending = fetch_rsshub_route_js({ url: blob_url }, { fetch_impl, signal: controller.signal });
    await Promise.resolve(); await Promise.resolve();
    controller.abort(new Error("用户已停止"));
    await assert.rejects(pending, /用户已停止/);
    assert.equal(request_signal.aborted, true);
  }
});
