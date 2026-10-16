import assert from "node:assert/strict";
import test from "node:test";
import { StorageModel } from "../pages/storage.model.js";

const ref = value => ({ value, as(next) { this.value = next; } });
const ui = { ref, refarr: ref, computed: (source, map) => ({ get value() { return map(source.value); } }) };

test("存储 Model 分页、刷新用量、保留失败前数据并重试", async () => {
  const requests = [];
  let fail = false;
  globalThis.window = { FindRSSAdminUI: ui, FindRSSAdminAuth: { fetch: async url => {
    requests.push(url);
    if (fail) return Response.json({ error: "R2 不可用" }, { status: 502 });
    if (url.endsWith("/usage")) return Response.json({ bytes: 2048, objects: 101, truncated: true, generated_at: Date.now() });
    const second = url.includes("cursor=");
    return Response.json({ objects: [{ key: second ? "z" : "头像/a #.png", size: 1024, uploaded: "2026-10-16T00:00:00.000Z" }], truncated: !second, cursor: second ? null : "a+/=" });
  } } };
  const { state, methods } = StorageModel();
  await methods.refresh();
  assert.equal(state.usage_label.value, "≥ 2.0 KB");
  assert.equal(state.count_label.value, "≥ 101 个文件");
  assert.match(state.usage_status.value, /下限/);
  assert.equal(state.files.value[0].view_url, "/admin/api/storage/file?key=" + encodeURIComponent("头像/a #.png"));
  assert.equal(state.can_previous.value, false);
  await methods.next();
  assert.match(requests.at(-1), /cursor=a%2B%2F%3D/);
  assert.equal(state.files.value[0].key, "z");
  assert.equal(state.can_next.value, false);
  assert.equal(state.can_previous.value, true);
  fail = true;
  await methods.previous();
  assert.equal(state.files.value[0].key, "z");
  assert.match(state.page_label.value, /第 2 页/);
  assert.equal(state.error.value, "R2 不可用");
  await methods.refresh();
  assert.equal(state.usage_error.value, "R2 不可用");
  assert.equal(state.usage_label.value, "≥ 2.0 KB");
  fail = false;
  await methods.refresh();
  assert.match(state.page_label.value, /第 1 页/);
  assert.equal(state.error.value, "");
  assert.equal(state.usage_error.value, "");
});
