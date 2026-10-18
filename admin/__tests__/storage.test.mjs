import assert from "node:assert/strict";
import test from "node:test";
import { StorageModel } from "../pages/storage.model.js";
import { create_memory_bucket } from "@findrss/object-store";
import { admin_storage_request } from "../../server/service/worker/storage.js";

const ref = value => ({ value, as(next) { this.value = next; } });
const ui = { ref, computed: (source, map) => ({ get value() { return map(source.value); } }) };
const id = key => "node:" + key;
const event = key => ({ key, preventDefault() {} });

async function fixture(files) {
  const bucket = create_memory_bucket(), requests = [];
  for (const [key, value, content_type = "text/plain"] of files) await bucket.put(key, value, { httpMetadata: { contentType: content_type } });
  globalThis.window = { FindRSSAdminUI: ui, FindRSSAdminAuth: { fetch: async (url, options) => {
    requests.push({ url, options });
    return admin_storage_request(new Request("https://feeds.example" + url, options), { API_STORAGE: bucket });
  } } };
  const model = StorageModel();
  await model.methods.refresh();
  return { ...model, bucket, requests };
}

test("文件树按需展开目录，支持折叠、缓存以及同名文件和目录", async () => {
  const { state, methods, requests } = await fixture([["a/one", "1"], ["a/deep/two", "22"], ["a", "3"], ["z", "4"]]);
  assert.deepEqual(state.rows.value.map(row => [row.key, row.depth]), [["a/", 0], ["a", 0], ["z", 0]]);
  assert.equal(requests.length, 2, "初始化只请求根目录第一页和用量");
  assert.equal(state.rows.value[0].expanded, false);
  await methods.activate(id("a/"));
  assert.deepEqual(state.rows.value.map(row => [row.key, row.depth]), [["a/", 0], ["a/deep/", 1], ["a/one", 1], ["a", 0], ["z", 0]]);
  assert.equal(requests.length, 3, "展开目录只加载其直接子级");
  await methods.activate(id("a/deep/"));
  assert.deepEqual(state.rows.value.map(row => [row.key, row.depth]), [["a/", 0], ["a/deep/", 1], ["a/deep/two", 2], ["a/one", 1], ["a", 0], ["z", 0]]);
  assert.equal(state.count_label.value, "4 个文件");
  assert.equal(requests.length, 4);
  assert.ok(state.rows.value.filter(row => row.folder).every(row => row.expanded));
  await methods.activate(id("a/"));
  assert.equal(state.rows.value.length, 3);
  const count = requests.length;
  await methods.activate(id("a/"));
  assert.equal(requests.length, count, "重新展开不重复读已加载目录");
  assert.ok(state.rows.value.some(row => row.key === "a/deep/two"));
  methods.dispose();
});

test("千余文件只按需加载一页，分页失败可重试且不清空已加载内容", async () => {
  const f = await fixture(Array.from({ length: 1205 }, (_, index) => ["files/" + String(index).padStart(4, "0"), "abc"]));
  assert.equal(f.state.rows.value.length, 1);
  assert.equal(f.requests.length, 2);
  await f.methods.activate(id("files/"));
  assert.equal(f.state.rows.value.filter(row => !row.more && !row.folder).length, 100);
  assert.equal(f.state.rows.value.at(-1).id, "more:files/");
  assert.equal(f.requests.length, 3);
  const original = window.FindRSSAdminAuth.fetch;
  let failed = false;
  window.FindRSSAdminAuth.fetch = (url, options) => {
    if (new URL("https://test" + url).searchParams.has("cursor") && !failed) {
      failed = true;
      return Response.json({ error: "R2 读取失败" }, { status: 502 });
    }
    return original(url, options);
  };
  await f.methods.activate("more:files/");
  assert.match(f.state.rows.value.at(-1).title, /点击重试/);
  assert.equal(f.state.rows.value.filter(row => !row.more && !row.folder).length, 100);
  await f.methods.activate("more:files/");
  assert.equal(f.state.rows.value.filter(row => !row.more && !row.folder).length, 200);
  assert.equal(f.state.rows.value.at(-1).id, "more:files/");
  for (let page = 0; page < 11; page++) await f.methods.activate("more:files/");
  assert.equal(f.state.rows.value.length, 1206);
  assert.ok(!f.state.rows.value.some(row => row.more));
  assert.equal(new Set(f.state.rows.value.map(row => row.id)).size, 1206);
  assert.equal(f.requests.filter(item => item.url.endsWith("/usage")).length, 1);
  f.methods.dispose();
});

test("根目录超过一页时逐页加载，始终不自动遍历子目录", async () => {
  const f = await fixture(Array.from({ length: 125 }, (_, index) => ["folder" + String(index).padStart(3, "0") + "/deep/file", "abc"]));
  assert.equal(f.state.rows.value.filter(row => row.folder).length, 100);
  assert.equal(f.state.rows.value.at(-1).id, "more:");
  assert.equal(f.requests.length, 2);
  await f.methods.activate("more:");
  assert.equal(f.state.rows.value.length, 125);
  assert.ok(f.state.rows.value.every(row => row.folder && !row.expanded));
  assert.equal(f.requests.length, 3);
  assert.ok(f.requests.filter(item => !item.url.endsWith("/usage")).every(item => new URL("https://test" + item.url).searchParams.get("prefix") === ""));
  f.methods.dispose();
});

test("重复点击正在加载的分页不会重复请求", async () => {
  const f = await fixture(Array.from({ length: 205 }, (_, index) => [String(index).padStart(3, "0"), "abc"]));
  const original = window.FindRSSAdminAuth.fetch;
  let resolve_page, calls = 0;
  window.FindRSSAdminAuth.fetch = (url, options) => {
    calls++;
    return new Promise(resolve => { resolve_page = () => resolve(original(url, options)); });
  };
  const pending = f.methods.activate("more:");
  await f.methods.activate("more:");
  assert.equal(calls, 1);
  resolve_page();
  await pending;
  assert.equal(f.state.rows.value.filter(row => !row.more).length, 200);
  assert.equal(f.state.rows.value.at(-1).id, "more:");
  f.methods.dispose();
});

test("刷新取消旧目录请求，迟到结果不会污染新文件树", async () => {
  const f = await fixture([["a/child", "one"]]);
  const original = window.FindRSSAdminAuth.fetch;
  let resolve_directory, signal;
  window.FindRSSAdminAuth.fetch = (url, options) => {
    if (new URL("https://test" + url).searchParams.get("prefix") === "a/") {
      signal = options.signal;
      return new Promise(resolve => { resolve_directory = resolve; });
    }
    return original(url, options);
  };
  const pending = f.methods.activate(id("a/"));
  await f.methods.refresh();
  assert.equal(signal.aborted, true);
  resolve_directory(Response.json({ objects: [{ key: "a/stale", size: 3 }], delimited_prefixes: [], truncated: false }));
  await pending;
  assert.deepEqual(f.state.rows.value.map(row => row.key), ["a/"]);
  assert.equal(f.state.rows.value[0].expanded, false);
  assert.equal(f.state.error.value, "");
  f.methods.dispose();
});

test("文件树键盘导航支持上下、首尾、展开、父级和 Enter 预览", async () => {
  const f = await fixture([["a/one", "hello"], ["z", "last"]]);
  assert.equal(f.state.active_key.value, id("a/"));
  f.methods.keydown(event("ArrowRight"));
  await new Promise(setImmediate);
  f.methods.keydown(event("ArrowRight"));
  assert.equal(f.state.active_key.value, id("a/one"));
  f.methods.keydown(event("ArrowLeft"));
  assert.equal(f.state.active_key.value, id("a/"));
  f.methods.keydown(event("ArrowLeft"));
  assert.equal(f.state.rows.value.length, 2);
  f.methods.keydown(event("End"));
  assert.equal(f.state.active_key.value, id("z"));
  f.methods.keydown(event("Enter"));
  await new Promise(setImmediate);
  assert.equal(f.state.preview.value.text, "last");
  f.methods.keydown(event("Home"));
  assert.equal(f.state.active_key.value, id("a/"));
  f.methods.dispose();
});

test("预览图片、纯文本、空文件和不支持的类型，大文本限制为 1 MiB", async () => {
  const f = await fixture([["头像.png", "image", "image/png"], ["page.html", "<script>alert(1)</script>", "text/html"],
    ["empty", ""], ["large", "x".repeat(1024 * 1024 + 20)], ["binary", "zip", "application/zip"]]);
  await f.methods.activate(id("头像.png"));
  assert.equal(f.state.preview.value.kind, "image");
  assert.equal(f.state.preview.value.src, "/admin/api/storage/file?key=" + encodeURIComponent("头像.png"));
  assert.equal(f.bucket.calls.get, 0, "图片由浏览器直接读取，Model 不缓存图片字节");
  await f.methods.activate(id("page.html"));
  assert.equal(f.state.preview.value.text, "<script>alert(1)</script>");
  await f.methods.activate(id("empty"));
  assert.equal(f.state.preview.value.text, "");
  await f.methods.activate(id("large"));
  assert.equal(f.state.preview.value.text.length, 1024 * 1024);
  assert.equal(f.state.preview.value.truncated, true);
  await f.methods.activate(id("binary"));
  assert.equal(f.state.preview.value.kind, "unsupported");
  f.methods.close_preview();
  assert.equal(f.state.preview.value, null);
  assert.equal(f.bucket.calls.put, 5);
  assert.equal(f.bucket.calls.delete, 0);
  f.methods.dispose();
});

test("JSON、XML 按后缀识别并格式化，不受大小写或 Content-Type 影响", async () => {
  const json = '{"id":9007199254740993123,"body":"原文","items":[1,2]}';
  const xml = '<?xml version="1.0"?><feed xmlns:media="urn:media"><entry><media:title><![CDATA[<p>原文</p>]]></media:title></entry></feed>';
  const f = await fixture([["data.json", json, "application/octet-stream"], ["DATA.JSON", json, "text/plain"],
    ["feed.xml", xml, "application/xml"], ["FEED.XML", xml, "image/svg+xml"],
    ["broken.json", '{"broken":'], ["plain.txt", json], ["data.json.bak", json]]);
  for (const key of ["data.json", "DATA.JSON"]) {
    await f.methods.activate(id(key));
    const value = f.state.preview.value;
    assert.equal(value.kind, "text");
    assert.equal(value.mode, "application/json");
    assert.equal(value.text, json);
    assert.match(value.formatted, /\n  "id": 9007199254740993123,/);
    assert.match(value.formatted, /"body": "原文"/);
  }
  for (const key of ["feed.xml", "FEED.XML"]) {
    await f.methods.activate(id(key));
    const value = f.state.preview.value;
    assert.equal(value.kind, "text");
    assert.equal(value.mode, "application/xml");
    assert.equal(value.text, xml);
    assert.match(value.formatted, /\n  <entry>\n    <media:title>/);
    assert.match(value.formatted, /<!\[CDATA\[<p>原文<\/p>\]\]>/);
  }
  await f.methods.activate(id("broken.json"));
  assert.equal(f.state.preview.value.mode, "application/json");
  assert.equal(f.state.preview.value.formatted, '{"broken":');
  for (const key of ["plain.txt", "data.json.bak"]) {
    await f.methods.activate(id(key));
    assert.equal(f.state.preview.value.mode, "");
    assert.equal(f.state.preview.value.text, json);
  }
  assert.equal(f.bucket.calls.put, 7, "格式化只影响展示，不写回存储");
  f.methods.dispose();
});

test("截断的 JSON、XML 保留已读取原文并保持高亮模式", async () => {
  const limit = 1024 * 1024;
  const f = await fixture([["large.json", '{"text":"' + "x".repeat(limit) + '"}'],
    ["large.xml", "<feed><entry>" + "x".repeat(limit) + "</entry></feed>"]]);
  for (const key of ["large.json", "large.xml"]) {
    await f.methods.activate(id(key));
    const value = f.state.preview.value;
    assert.equal(value.kind, "text");
    assert.equal(value.truncated, true);
    assert.equal(value.text.length, limit);
    assert.equal(value.formatted, value.text);
    assert.equal(value.mode, key.endsWith("json") ? "application/json" : "application/xml");
  }
  f.methods.dispose();
});

test("关闭或切换预览取消请求，迟到响应不覆盖当前文件", async () => {
  const f = await fixture([["a", "first"], ["b", "second"]]);
  let resolve_head, first_signal;
  const original = window.FindRSSAdminAuth.fetch;
  window.FindRSSAdminAuth.fetch = (url, options) => {
    if (url.endsWith("key=a")) {
      first_signal = options.signal;
      return new Promise(resolve => { resolve_head = resolve; });
    }
    return original(url, options);
  };
  const pending = f.methods.activate(id("a"));
  await f.methods.activate(id("b"));
  assert.equal(first_signal.aborted, true);
  resolve_head(new Response(null, { headers: { "Content-Type": "text/plain" } }));
  await pending;
  assert.equal(f.state.preview.value.key, "b");
  assert.equal(f.state.preview.value.text, "second");
  f.methods.dispose();
  assert.equal(f.state.preview.value, null);
});

test("根目录和统计失败显示错误并可刷新重试", async () => {
  const f = await fixture([["a", "one"]]);
  const original = window.FindRSSAdminAuth.fetch;
  window.FindRSSAdminAuth.fetch = async () => Response.json({ error: "R2 不可用" }, { status: 502 });
  await f.methods.refresh();
  assert.equal(f.state.error.value, "R2 不可用");
  assert.equal(f.state.usage_error.value, "R2 不可用");
  assert.match(f.state.rows.value.at(-1).title, /点击重试/);
  window.FindRSSAdminAuth.fetch = original;
  await f.methods.refresh();
  assert.equal(f.state.error.value, "");
  assert.equal(f.state.usage_error.value, "");
  assert.equal(f.state.rows.value[0].key, "a");
  f.methods.dispose();
});

test("卸载后忽略目录的迟到响应，特殊加载行与真实文件键不冲突", async () => {
  const f = await fixture([["a/child", "one"], ["more:", "real file"]]);
  await f.methods.activate(id("more:"));
  assert.equal(f.state.preview.value.text, "real file");
  f.methods.preview_error("a/old");
  assert.equal(f.state.preview.value.error, "");
  const original = window.FindRSSAdminAuth.fetch;
  let resolve_directory, signal;
  window.FindRSSAdminAuth.fetch = (url, options) => {
    if (new URL("https://feeds.example" + url).searchParams.get("prefix") === "a/") {
      signal = options.signal;
      return new Promise(resolve => { resolve_directory = resolve; });
    }
    return original(url, options);
  };
  const pending = f.methods.activate(id("a/"));
  await new Promise(setImmediate);
  f.methods.dispose();
  assert.equal(signal.aborted, true);
  resolve_directory(Response.json({ objects: [{ key: "a/old", size: 3 }], delimited_prefixes: [], truncated: false }));
  await pending;
  assert.ok(!f.state.rows.value.some(row => row.key === "a/old"));
  assert.equal(f.state.preview.value, null);
});
