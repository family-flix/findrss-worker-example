import test from "node:test";
import assert from "node:assert/strict";
import { list_ui } from "./list_fixture.mjs";
import { ListPaginationModel } from "../components/pagination.js";

test("ListCore 按后端总数翻页、筛选、修改条数，末页缩小后回退", async t => {
  let total = 41, query = "", rows;
  const calls = [];
  const model = ListPaginationModel(list_ui, { url: "/sources", key: "sources", filters: () => ({ q: query }),
    fetch: async url => {
      const params = new URL(url, "https://admin").searchParams;
      calls.push(params);
      const offset = Number(params.get("offset")), limit = Number(params.get("limit"));
      return Response.json({ total_count: total, sources: Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, index) => ({ id: offset + index })) });
    }, on_data(value) { rows = value; } });
  t.after(() => model.destroy());
  assert.ok(model.list instanceof list_ui.kit.ListCore);
  await model.load();
  assert.equal(rows.length, 20);
  await model.set_page(2);
  assert.deepEqual(Array.from(rows, row => row.id), [40]);
  assert.equal(calls.at(-1).get("offset"), "40");
  total = 40;
  await model.load();
  assert.equal(model.state.value.page, 1);
  assert.equal(calls.at(-1).get("offset"), "20");
  query = "筛选";
  model.reset();
  await model.load();
  assert.equal(calls.at(-1).get("q"), query);
  assert.equal(calls.at(-1).get("offset"), "0");
  await model.set_page_size(10);
  assert.equal(calls.at(-1).get("limit"), "10");
  assert.equal(rows.length, 10);
});

test("ListCore 连续筛选只接受最后的响应，错误保留旧列表且可重试", async t => {
  const pending = [];
  let query = "old", rows = [];
  const model = ListPaginationModel(list_ui, { url: "/sources", key: "sources", filters: () => ({ q: query }),
    fetch: url => new Promise(resolve => pending.push({ url, resolve })), on_data(value) { rows = value; } });
  t.after(() => model.destroy());
  const first = model.load();
  query = "new";
  const second = model.load();
  pending[0].resolve(Response.json({ total_count: 1, sources: [{ id: "old" }] }));
  await first;
  assert.equal(rows.length, 0);
  assert.equal(model.state.value.loading, true);
  pending[1].resolve(Response.json({ total_count: 1, sources: [{ id: "new" }] }));
  await second;
  assert.equal(rows[0].id, "new");
  const failed = model.load();
  pending[2].resolve(Response.json({ error: "加载失败" }, { status: 500 }));
  await failed;
  assert.equal(model.error.value, "加载失败");
  assert.equal(rows[0].id, "new");
  const retry = model.load();
  pending[3].resolve(Response.json({ total_count: 0, sources: [] }));
  await retry;
  assert.equal(model.error.value, "");
  assert.equal(rows.length, 0);
});

test("后台补齐空页保留加载状态，并按可见条数显示范围", async t => {
  let finish, rows = [];
  const visible_count = list_ui.ref(0);
  const model = ListPaginationModel(list_ui, { url: "/sources", key: "sources", visible_count,
    fetch: () => new Promise(resolve => { finish = resolve; }),
    on_data(value) { rows = value; visible_count.set(value.length); } });
  t.after(() => model.destroy());
  model.total.set(25);
  model.page.set(1);
  const pending = model.load(1, { background: true });
  assert.equal(model.state.value.loading, false);
  finish(Response.json({ total_count: 25, sources: [{ id: "one" }, { id: "two" }] }));
  await pending;
  assert.equal(rows.length, 2);
  assert.equal(model.state.value.loading, false);
  assert.equal(model.state.value.first, 21);
  assert.equal(model.state.value.last, 22);
  assert.equal(model.state.value.total, 25);
});
