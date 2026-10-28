import { read_script, script_names } from "../../test/support/script_sources.js";
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { create_rank_loader } from "../loader.js";

register("../../test/support/quickjs_wasm_hook.js", import.meta.url);
const { compile_script_module, execute_script } = await import("../../server/infra/script_sandbox.js");

test("百度榜单将零起始 index 转成正整数排名，保留置顶与未知排名", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const source = read_script("hot/baidu_hot.js");
  const rows = [
    { isTop: true, index: 0 }, { index: 0 }, { index: 1 }, {}, { index: null }, { index: "" },
  ].map((row, index) => ({ ...row, rawUrl: `https://www.baidu.com/s?wd=${index}`, word: "新闻" + index }));
  globalThis.fetch = async url => {
    assert.equal(url, "https://top.baidu.com/board?tab=realtime");
    return new Response("<!--s-data:" + JSON.stringify({ data: { cards: [{ content: rows }] } }) + "-->");
  };
  const load = create_rank_loader([{ id: "baidu_hot", source }], { compile: compile_script_module, execute: execute_script });
  const { boards: [board] } = await load();
  assert.equal(board.error, "");
  assert.deepEqual(board.entries.map(entry => entry.rank), [null, 1, 2, null, null, null]);
  assert.equal(board.entries[0].pinned, true);
  for (const index of [-1, "bad"]) {
    rows[1].index = index;
    const { boards: [failed] } = await load();
    assert.match(failed.error, /正整数排名/);
    assert.deepEqual(failed.entries, []);
  }
});

test("全部 Hot 示例经生产 QuickJS 调用，一处成功和其他失败均保留卡片", async t => {
  const scripts = script_names("hot").map(name => ({ id: name.slice(0, -3), source: read_script("hot/" + name) }));
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async url => {
    if (String(url).startsWith("https://m.qidian.com/rank/yuepiao/")) return new Response('<script id="vite-plugin-ssr_pageContext" type="application/json">' + JSON.stringify({ pageContext: { pageProps: { pageData: { records: [
      { bid: "9007199254740993", bName: "真实执行测试", rankNum: 1, rankCnt: "11万月票" },
    ] } } } }) + "</script>");
    return new Response("模拟上游维护", { status: 503 });
  };
  let executions = 0;
  const load = create_rank_loader(scripts, { compile: compile_script_module,
    execute: (...args) => { executions++; return execute_script(...args); } });
  const result = await load();
  assert.equal(scripts.length, 84);
  assert.equal(result.boards.length, scripts.length);
  assert.equal(executions, scripts.length);
  assert.ok(result.boards.every(board => board.category && Number.isSafeInteger(board.order) && board.platform?.name !== "网页"));
  assert.deepEqual(result.boards.map(board => board.order), result.boards.map(board => board.order).sort((a, b) => a - b));
  const book = result.boards.find(board => board.id === "qidian");
  assert.equal(book.error, "");
  assert.equal(book.category, "小说");
  assert.equal(book.entries[0].title, "真实执行测试");
  assert.ok(book.entries[0].thumbnail);
  const failures = result.boards.filter(board => board.id !== "qidian");
  assert.ok(failures.every(board => board.error && board.entries.length === 0));
  assert.ok(result.boards.find(board => board.id === "weibo_hot").error.includes("Cookie"));
});
