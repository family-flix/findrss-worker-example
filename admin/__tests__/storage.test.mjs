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

test("文件树按需加载、折叠、缓存子目录，支持同名文件和目录", async () => {
  const { state, methods, requests } = await fixture([["a/one", "1"], ["a/deep/two", "22"], ["a", "3"], ["z", "4"]]);
  assert.deepEqual(state.rows.value.map(row => row.key), ["a/", "a", "z"]);
  assert.equal(state.count_label.value, "4 个文件");
  assert.equal(requests.length, 2);
  await methods.activate(id("a/"));
  assert.deepEqual(state.rows.value.map(row => [row.key, row.depth]), [["a/", 0], ["a/deep/", 1], ["a/one", 1], ["a", 0], ["z", 0]]);
  await methods.activate(id("a/deep/"));
  assert.equal(state.rows.value.find(row => row.key === "a/deep/two").depth, 2);
  await methods.activate(id("a/"));
  assert.equal(state.rows.value.length, 3);
  const count = requests.length;
  await methods.activate(id("a/"));
  assert.equal(requests.length, count, "重新展开不重复读已加载目录");
  assert.ok(state.rows.value.some(row => row.key === "a/deep/two"));
  methods.dispose();
});

test("大量同级文件以加载更多追加，目录读取失败可重试且不清空已加载内容", async () => {
  const f = await fixture(Array.from({ length: 205 }, (_, index) => ["files/" + String(index).padStart(3, "0"), "abc"]));
  await f.methods.activate(id("files/"));
  assert.equal(f.state.rows.value.length, 102);
  f.bucket.fail_next({ op: "list" });
  await f.methods.activate("more:files/");
  assert.match(f.state.rows.value.at(-1).title, /点击重试/);
  assert.equal(f.state.rows.value.filter(row => !row.more && !row.folder).length, 100);
  await f.methods.activate("more:files/");
  assert.equal(f.state.rows.value.filter(row => !row.more && !row.folder).length, 200);
  await f.methods.activate("more:files/");
  assert.equal(f.state.rows.value.length, 206);
  assert.ok(!f.state.rows.value.some(row => row.more));
  assert.equal(f.requests.filter(item => item.url.endsWith("/usage")).length, 1);
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

test("刷新后忽略旧目录的迟到响应，特殊加载行与真实文件键不冲突", async () => {
  const f = await fixture([["a/child", "one"], ["more:", "real file"]]);
  const original = window.FindRSSAdminAuth.fetch;
  let resolve_directory;
  window.FindRSSAdminAuth.fetch = (url, options) => {
    if (new URL("https://feeds.example" + url).searchParams.get("prefix") === "a/") {
      return new Promise(resolve => { resolve_directory = resolve; });
    }
    return original(url, options);
  };
  const pending = f.methods.activate(id("a/"));
  await f.methods.refresh();
  resolve_directory(Response.json({ objects: [{ key: "a/old", size: 3 }], delimited_prefixes: [], truncated: false }));
  await pending;
  assert.deepEqual(f.state.rows.value.map(row => row.key), ["a/", "more:"]);
  await f.methods.activate(id("more:"));
  assert.equal(f.state.preview.value.text, "real file");
  f.methods.preview_error("a/old");
  assert.equal(f.state.preview.value.error, "");
  f.methods.dispose();
});
