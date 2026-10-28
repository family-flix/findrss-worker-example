import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { read_script, script_names } from "../../test/support/script_sources.js";
import { hot_scripts, HOT_SCRIPTS_VERSION } from "../scripts.js";
import { createHash } from "node:crypto";
import { create_rank_loader } from "../loader.js";
import { validate_script_route_path } from "../../server/lib/image_proxy.js";

const metadata = (name = "榜单") => ({ script_type: "hot", routes: [{ name, route_index: 0,
  path: "/demo/:id?", example: "/demo/123?period=week", platform: { name: "网页" }, tags: [] }] });
const output = title => ({ output: JSON.stringify({ kind: "hot_rank", title, link: "https://example.com/", entries: [] }) });

test("rank 清单包含全部 Hot 示例，版本随源码更新，浏览器产物不携带采集源码", async () => {
  const names = script_names("hot");
  assert.deepEqual(hot_scripts, names.map(name => ({ id: name.slice(0, -3), source: read_script("hot/" + name) })));
  const sources = names.map(name => name + read_script("hot/" + name));
  const version = createHash("sha256").update(sources.join("\n")).digest("hex").slice(0, 16);
  assert.equal(HOT_SCRIPTS_VERSION, version);
  const browser = await readFile(new URL("../index.js", import.meta.url), "utf8");
  assert.doesNotMatch(browser, /scripts\.js|script_sandbox|loader\.js/);
  assert.throws(() => validate_script_route_path({ path: "/rank/custom" }), /系统路径/);
});

test("全部脚本并发执行，失败保留原因并继续后续榜单，不串用参数或返回顺序", async () => {
  let active = 0, peak = 0, executions = 0, compilations = 0;
  const scripts = Array.from({ length: 19 }, (_, index) => ({ id: String(index), source: String(index) }));
  const load = create_rank_loader(scripts, {
    compile: async source => { compilations++; return source === "2" ? { error: "语法错误" } : { metadata: metadata("榜单" + source) }; },
    execute: async (source, route, invoke, context, cookies, mock, cookie_access, signal) => {
      assert.equal(invoke, null);
      assert.equal(cookie_access, null);
      assert.deepEqual(cookies, []);
      assert.equal(mock, "");
      assert.ok(signal instanceof AbortSignal);
      assert.equal(route.route_index, 0);
      assert.deepEqual({ ...context.params }, { id: "123" });
      assert.deepEqual(context.query, { period: "week" });
      executions++; active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, Number(source) % 2 ? 2 : 4));
      active--;
      if (source === "1") throw Object.assign(new Error("脚本执行失败：上游要求授权 Cookie"), { problem: { code: "UPSTREAM_AUTH_REQUIRED" } });
      return output("成功" + source);
    },
  });
  const saved = [];
  const [first, same] = await Promise.all([load(board => saved.push(board.id)), load()]);
  assert.equal(first, same);
  assert.equal(compilations, 19);
  assert.equal(executions, 18);
  assert.ok(peak > 1 && peak <= 8);
  assert.deepEqual(first.boards.map(board => board.id), scripts.map(script => script.id));
  assert.equal(first.boards[1].error, "上游要求授权 Cookie");
  assert.equal(first.boards[2].error, "语法错误");
  assert.equal(first.boards.at(-1).title, "成功18");
  assert.deepEqual(saved.sort((a, b) => Number(a) - Number(b)), scripts.map(script => script.id));
  assert.notEqual(await load(), first);
  assert.equal(compilations, 19);
  assert.equal(executions, 36);
});

test("每个脚本完成后立即通知写入，不等待较慢脚本完成", async () => {
  const slow = Promise.withResolvers();
  const fast_saved = Promise.withResolvers();
  const saved = [];
  const load = create_rank_loader(["slow", "fast"].map(id => ({ id, source: id })), {
    compile: async () => ({ metadata: metadata() }),
    execute: async source => { if (source === "slow") await slow.promise; return output(source); },
  });
  const task = load(board => { saved.push(board.id); if (board.id === "fast") fast_saved.resolve(); });
  await fast_saved.promise;
  assert.deepEqual(saved, ["fast"]);
  slow.resolve();
  await task;
  assert.deepEqual(saved, ["fast", "slow"]);
});

test("错误返回值不冒充热榜；全失败仍返回全部错误卡片；每轮预构建重新执行", async () => {
  let runs = 0;
  const load = create_rank_loader([{ id: "invalid", source: "invalid" }], {
    compile: async () => ({ metadata: metadata() }),
    execute: async () => { runs++; return { output: '{"items":[]}' }; },
  });
  const first = await load();
  assert.match(first.boards[0].error, /未返回热榜快照/);
  assert.deepEqual(first.boards[0].entries, []);
  assert.notEqual(await load(), first);
  assert.equal(runs, 2);
  const empty = create_rank_loader([], { compile() { assert.fail(); }, execute() { assert.fail(); } });
  assert.deepEqual((await empty()).boards, []);
});

test("单个脚本超时后保留明确原因，并继续处理其余榜单", async t => {
  t.mock.method(AbortSignal, "timeout", () => AbortSignal.abort(new Error("test timeout")));
  const load = create_rank_loader([{ id: "slow", source: "slow" }, { id: "next", source: "next" }], {
    compile: async () => ({ metadata: metadata() }),
    execute: async source => { if (source === "slow") throw new Error("aborted"); return output("后续榜单"); },
  });
  const result = await load();
  assert.match(result.boards[0].error, /超时/);
  assert.equal(result.boards[1].title, "后续榜单");
});

test("脚本顺序升序且同值稳定，失败保留声明分类与来源，快照分类优先", async () => {
  const scripts = ["later", "first", "tie", "default"].map(id => ({ id, source: id }));
  const load = create_rank_loader(scripts, {
    compile: async source => ({ metadata: { ...metadata(source), category: "科技", ...(source === "default" ? {} : { order: source === "later" ? 10 : -5 }) } }),
    execute: async source => {
      if (source === "first") throw Error("上游维护");
      return { output: JSON.stringify({ kind: "hot_rank", title: source, category: "小说", entries: [] }) };
    },
  });
  const { boards } = await load();
  assert.deepEqual(boards.map(board => board.id), ["first", "tie", "default", "later"]);
  assert.equal(boards[0].category, "科技");
  assert.equal(boards[0].platform.name, "网页");
  assert.equal(boards[0].error, "上游维护");
  assert.equal(boards[1].category, "小说");
  assert.equal(boards[2].order, 0);
});
