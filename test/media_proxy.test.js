import assert from "node:assert/strict";
import test from "node:test";
import { script_media_response } from "../server/service/worker/media_proxy.js";
import { script_output } from "../server/lib/script_output.js";

const route = { allowed_hosts: ["cdn.example"] };
const options = kind => ({ kind, route, descriptor: { url: "https://cdn.example/file", headers: { Referer: "https://example.com/" } },
  version: "", headers: { "Cache-Control": "no-store" } });

test("媒体返回值区分直接地址和声明 allowed_hosts 的代理，保留显式 kind", () => {
  for (const kind of ["img", "video", "audio"]) {
    const value = { kind, url: "https://cdn.example/file" };
    assert.equal(JSON.parse(script_output({}, value).body).kind, kind);
    assert.equal(script_output(route, value).kind, kind);
    assert.equal(script_output(route, value).descriptor.url, value.url);
    assert.throws(() => script_output({}, { ...value, headers: { Referer: "https://example.com/" } }), /allowed_hosts/);
    for (const url of ["javascript:alert(1)", "https://user:pass@cdn.example/file", "file:///file"]) {
      assert.throws(() => script_output({}, { ...value, url }));
    }
  }
});

test("MP4 和音频按 Range 流式响应，保留 206 及媒体头，不透传身份和 Cookie", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const [kind, type] of [["video", "video/mp4"], ["audio", "audio/mpeg"], ["audio", "audio/mp4"]]) {
    let read = false;
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://cdn.example/file");
      assert.equal(init.headers.Range, "bytes=4-7");
      assert.equal(init.headers.referer, "https://example.com/");
      assert.equal(init.headers.Cookie, undefined);
      assert.equal(init.headers.Authorization, undefined);
      return new Response(new ReadableStream({ pull(controller) { read = true; controller.enqueue(new Uint8Array([1, 2, 3, 4])); controller.close(); } }), {
        status: 206, headers: { "Content-Type": type, "Content-Length": "4", "Content-Range": "bytes 4-7/100", "Accept-Ranges": "bytes", "Set-Cookie": "secret=1" },
      });
    };
    const response = await script_media_response(new Request("https://feeds.example/preview", {
      headers: { Range: "bytes=4-7", Cookie: "private=1", Authorization: "Bearer private" },
    }), options(kind));
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("Content-Type"), type);
    assert.equal(response.headers.get("Content-Range"), "bytes 4-7/100");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("Set-Cookie"), null);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
    assert.equal(read, true);
  }
});

test("媒体拒绝越界重定向和非媒体类型，支持 HEAD 和 Range 越界状态", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.method, "HEAD");
    return new Response(null, { headers: { "Content-Type": "video/mp4", "Content-Length": "100" } });
  };
  const head = await script_media_response(new Request("https://feeds.example/preview", { method: "HEAD" }), options("video"));
  assert.equal(head.status, 200);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal(head.headers.get("Content-Length"), "100");
  globalThis.fetch = async () => new Response(null, { status: 416, headers: { "Content-Range": "bytes */100" } });
  const range = await script_media_response(new Request("https://feeds.example/preview", { headers: { Range: "bytes=200-" } }), options("video"));
  assert.equal(range.status, 416);
  assert.equal(range.headers.get("Content-Range"), "bytes */100");
  for (const response of [new Response(null, { status: 302, headers: { Location: "https://evil.example/file" } }),
    new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } })]) {
    globalThis.fetch = async () => response;
    assert.equal((await script_media_response(new Request("https://feeds.example/preview"), options("video"))).status, 502);
  }
});
