import { script_result_helpers_source } from "../server/infra/script_result.js";
import assert from "node:assert/strict";
import test from "node:test";

import {
  SCRIPT_LOG_MAX_LINES,
  script_ctx_source,
  script_mock_source,
  script_result_source,
} from "../server/infra/script_sources.js";

new Function(script_result_helpers_source())();

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const route_metadata = {
  path: "/wxmp/:account?",
  name: "微信公众号文章",
  url: "mp.weixin.qq.com",
  maintainers: [],
  example: "/wxmp/wow36kr",
  parameters: {},
  description: "测试用元数据",
};

const request_context = {
  method: "GET",
  pathname: "/rss/wxmp/wow36kr",
  params: { account: "", page: "1" },
  query: { offset: "", limit: "20" },
};

const probe_script = `
const handler = async (ctx) => {
  globalThis.__probe = {
    method: ctx.method,
    pathname: ctx.pathname,
    params: ctx.params,
    query: ctx.query,
  };
  return { title: "probe", link: "https://example.com/", items: [] };
};
export const route = { handler };
`;

const invoke_script = `
const handler = async (ctx) => {
  const result = await ctx.invoke("wxmp.biz.msg.list", {
    username: ctx.params.account,
    offset: ctx.query.offset,
  });
  if (result.error) return result;
  const data = result.data;
  const articles = Array.isArray(data.articles) ? data.articles : [];
  return {
    title: "invoke",
    items: articles.map((article) => ({ title: article.title })),
  };
};
export const route = { handler };
`;

/**
 * 复刻 index.js 的装配方式：mock 单独求值挂到 globalThis，再跑
 * ctx 段 + 脚本 + 结果段；结果经 globalThis.__result 传出。
 * 失败时按 index.js 的做法把已收集的日志行挂到错误对象上（failure.lines）。
 * @param {{ script: string, mock_ctx?: string, has_invoke?: boolean, invoke?: (spec: string) => Promise<string> | string, request_context?: object }} options
 * @returns {Promise<{ output: string, probe: unknown, lines: { level: string, text: string }[] }>}
 */
async function run_sandbox(options) {
  const injections = {
    __requestContextJSON: JSON.stringify(options.request_context ?? request_context),
    __routeMetadataJSON: JSON.stringify(route_metadata),
    __fetchText: async () => "",
    __invoke: options.invoke ?? (async () => JSON.stringify(null)),
  };
  delete globalThis.__mockCtx;
  delete globalThis.__probe;
  delete globalThis.__result;
  delete globalThis.__logLines;
  try {
    if ((options.mock_ctx ?? "") !== "") {
      new Function(script_mock_source(options.mock_ctx))();
    }
    const names = Object.keys(injections);
    // 沙箱里是 module 求值，node 的 AsyncFunction 只能解析脚本，
    // 因此剥掉 export 关键字以保持 ctx/结果段语义一致。
    const source = [
      script_ctx_source({ has_invoke: options.has_invoke === true, debug: options.debug === true }),
      options.script.replace(/^export\s+/gm, ""),
      script_result_source(),
    ].join("\n");
    const run = new AsyncFunction(...names, source);
    await run(...names.map((name) => injections[name]));
    return {
      output: globalThis.__result,
      probe: globalThis.__probe,
      lines: globalThis.__logLines ?? [],
    };
  } catch (failure) {
    // index.js 的失败路径从沙箱读回 __logLines 挂到 ScriptError 上，这里同样还原。
    failure.lines = globalThis.__logLines ? [...globalThis.__logLines] : [];
    throw failure;
  } finally {
    delete globalThis.__mockCtx;
    delete globalThis.__probe;
    delete globalThis.__result;
    delete globalThis.__logLines;
  }
}


test("mock 的 params/query 按 key 覆盖基线并保留未提及的键", async () => {
  const baseline = await run_sandbox({ script: probe_script });
  assert.deepEqual(baseline.probe, {
    method: "GET",
    pathname: "/rss/wxmp/wow36kr",
    params: { account: "", page: "1" },
    query: { offset: "", limit: "20" },
  });

  const merged = await run_sandbox({
    script: probe_script,
    mock_ctx: '({ params: { account: "wow36kr" }, query: { offset: "next-page" } })',
  });
  assert.deepEqual(merged.probe, {
    method: "GET",
    pathname: "/rss/wxmp/wow36kr",
    params: { account: "wow36kr", page: "1" },
    query: { offset: "next-page", limit: "20" },
  });
});

test("mock 的 method/pathname 覆盖基线", async () => {
  const { probe } = await run_sandbox({
    script: probe_script,
    mock_ctx: '({ method: "POST", pathname: "/rss/other" })',
  });
  assert.deepEqual(probe.method, "POST");
  assert.deepEqual(probe.pathname, "/rss/other");
});

test("mock 的 invoke 被调用且返回值可见于输出", async () => {
  const { output, probe } = await run_sandbox({
    script: invoke_script,
    mock_ctx: `({
  params: { account: "wow36kr" },
  query: { offset: "" },
  invoke(method, args) {
    globalThis.__probe = { method, args };
    return { account: {}, articles: [{ title: "Mock 文章标题" }] };
  },
})`,
  });
  assert.equal(JSON.parse(output).items[0].title, "Mock 文章标题");
  assert.deepEqual(probe, {
    method: "wxmp.biz.msg.list",
    args: { username: "wow36kr", offset: "" },
  });
});

test("无 mock invoke 时调用直接抛明确错误，不回落设备", async () => {
  let bridge_called = false;
  await assert.rejects(
    run_sandbox({
      script: invoke_script,
      has_invoke: false,
      invoke: async () => {
        bridge_called = true;
        return JSON.stringify({ articles: [] });
      },
    }),
    /测试运行未提供 invoke mock：请在 mock ctx 中声明 invoke\(method, args\) 后重试/,
  );
  assert.equal(bridge_called, false);
});

test("有 invoke_impl 且无 mock 时仍走真实设备桥接", async () => {
  const specs = [];
  const { output } = await run_sandbox({
    script: invoke_script,
    has_invoke: true,
    request_context: {
      method: "GET",
      pathname: "/rss/wxmp/gh_real",
      params: { account: "gh_real" },
      query: { offset: "" },
    },
    // 沙箱里的 __invoke 是 asyncify 函数，对脚本呈现为同步返回；
    // 此处同样用同步函数还原该语义。
    invoke: (spec) => {
      specs.push(JSON.parse(spec));
      return JSON.stringify({ articles: [{ title: "真实设备文章" }] });
    },
  });
  assert.equal(JSON.parse(output).items[0].title, "真实设备文章");
  assert.deepEqual(specs, [{
    method: "wxmp.biz.msg.list",
    args: { username: "gh_real", offset: "" },
    target_device_id: "",
  }]);
});

test("mock 求值结果必须是对象", async () => {
  await assert.rejects(
    run_sandbox({ script: probe_script, mock_ctx: '"nope"' }),
    /mock ctx 求值结果必须是对象/,
  );
  await assert.rejects(
    run_sandbox({ script: probe_script, mock_ctx: "({ params: [] })" }),
    /mock ctx 的 params 必须是对象/,
  );
});

test("mock 语法错误在单独求值时暴露，不与脚本错误混淆", () => {
  assert.throws(() => new Function(script_mock_source("({ params: })"))(), SyntaxError);
});

test("handler 抛错时错误文本带「脚本异常：」", async () => {
  await assert.rejects(
    run_sandbox({
      script: `
const handler = async () => { throw new Error("设备返回了无效数据"); };
export const route = { handler };
`,
    }),
    /脚本异常：设备返回了无效数据/,
  );
});

test("路由允许文本、JSON、HTML 响应；不可序列化的值被拒绝", async () => {
  for (const value of [42, "正文", [], { title: "x" }, { body: "<p>正文</p>", content_type: "text/html" }]) {
    const { output } = await run_sandbox({ script: `export const route = { handler: async () => (${JSON.stringify(value)}) };` });
    assert.deepEqual(JSON.parse(output), value);
  }
  for (const expression of ['undefined', '(() => { const value = {}; value.self = value; return value; })()']) {
    await assert.rejects(run_sandbox({ script: `export const route = { handler: async () => (${expression}) };` }), /路由返回值无法序列化/);
  }
});

test("脚本不再提供 ctx.xmlEscape", async () => {
  const { probe } = await run_sandbox({
    script: `
const handler = async (ctx) => {
  globalThis.__probe = { xmlEscape: typeof ctx.xmlEscape };
  return { items: [] };
};
export const route = { handler };
`,
  });
  assert.deepEqual(probe, { xmlEscape: "undefined" });
});

const log_script = `
const handler = async (ctx) => {
  ctx.log("params", ctx.params);
  ctx.error("失败了", { code: 402 });
  return { title: "logs", items: [] };
};
export const route = { handler };
`;

test("ctx.log/ctx.error 收集为 lines 并区分 level", async () => {
  const { output, lines } = await run_sandbox({ script: log_script });
  assert.equal(JSON.parse(output).title, "logs");
  assert.deepEqual(lines, [
    { level: "info", text: '"params" {"account":"","page":"1"}' },
    { level: "error", text: '"失败了" {"code":402}' },
  ]);
});

test("未调用 ctx.log 时 lines 为空数组", async () => {
  const { lines } = await run_sandbox({ script: probe_script });
  assert.deepEqual(lines, []);
});

test("日志格式化：对象、数组、多参与单值截断", async () => {
  const { lines } = await run_sandbox({
    script: `
const handler = async (ctx) => {
  ctx.log({ nested: { list: [1, "two", null, true] } });
  ctx.log("a", 1, undefined, function named() {}, Symbol("s"), 10n);
  ctx.log("x".repeat(600));
  return { items: [] };
};
export const route = { handler };
`,
  });
  assert.equal(lines[0].text, '{"nested":{"list":[1,"two",null,true]}}');
  assert.equal(lines[1].text, '"a" 1 "[undefined]" "[function named]" "Symbol(s)" "10"');
  assert.equal(lines[2].text.length, 500 + "…[截断]".length);
  // 截断按字符切，序列化后的收尾引号一并被切掉，属预期。
  assert.match(lines[2].text, /^"x+…\[截断\]$/);
});

test("调试日志保留原始长字符串，并在 4MB 总量上限后提示截断", async () => {
  const { lines } = await run_sandbox({ debug: true, script: `
export const route = { handler(ctx) {
  ctx.log("<html>" + "原始正文".repeat(2000) + "</html>");
  ctx.log("x".repeat(4 * 1024 * 1024));
  ctx.log("超限后");
  return { items: [] };
} };` });
  assert.equal(lines[0].text, '<html>' + '原始正文'.repeat(2000) + '</html>');
  assert.equal(lines.length, 2);
  assert.equal(lines[1].level, 'warn');
  assert.match(lines[1].text, /4MB.*后续输出已省略/);
});

test("日志格式化：循环引用与超深对象降级为占位文本", async () => {
  const { lines } = await run_sandbox({
    script: `
const handler = async (ctx) => {
  const circular = { name: "self" };
  circular.self = circular;
  ctx.log("circular", circular);
  let deep = { end: true };
  for (let index = 0; index < 10; index += 1) deep = { next: deep };
  ctx.log("deep", deep);
  return { items: [] };
};
export const route = { handler };
`,
  });
  assert.equal(lines[0].text, '"circular" {"name":"self","self":"[循环引用]"}');
  assert.match(lines[1].text, /\[超过深度上限\]/);
});

test("取值抛错的值不会中断脚本，ctx.log 自身绝不抛错", async () => {
  const { output, lines } = await run_sandbox({
    script: `
const handler = async (ctx) => {
  const hostile = {};
  Object.defineProperty(hostile, "boom", { enumerable: true, get() { throw new Error("getter 爆炸"); } });
  ctx.log(hostile);
  ctx.log("继续执行");
  return { items: [] };
};
export const route = { handler };
`,
  });
  assert.deepEqual(JSON.parse(output).items, []);
  assert.deepEqual(lines, [
    { level: "info", text: "[无法序列化的值]" },
    { level: "info", text: '"继续执行"' },
  ]);
});

test("行数超过上限时截断并追加一条提示", async () => {
  const { lines } = await run_sandbox({
    script: `
const handler = async (ctx) => {
  for (let index = 0; index < ${SCRIPT_LOG_MAX_LINES + 50}; index += 1) ctx.log("line-" + index);
  return { items: [] };
};
export const route = { handler };
`,
  });
  assert.equal(lines.length, SCRIPT_LOG_MAX_LINES + 1);
  assert.deepEqual(lines[lines.length - 1], {
    level: "warn",
    text: `日志超过上限（${SCRIPT_LOG_MAX_LINES} 行 / 32KB），后续输出已省略`,
  });
  assert.equal(lines[0].text, '"line-0"');
});

test("字节超过上限时提前截断，且只追加一条提示", async () => {
  const { lines } = await run_sandbox({
    script: `
const handler = async (ctx) => {
  for (let index = 0; index < 200; index += 1) ctx.log("y".repeat(400));
  ctx.log("超过上限之后的输出");
  return { items: [] };
};
export const route = { handler };
`,
  });
  assert.ok(lines.length < 200);
  assert.equal(lines[lines.length - 1].level, "warn");
  assert.match(lines[lines.length - 1].text, /后续输出已省略/);
  assert.equal(
    lines.filter((line) => line.level === "warn").length,
    1,
  );
  assert.ok(
    !lines.some((line) => line.text.includes("超过上限之后的输出")),
  );
});

test("失败时已收集的日志行随错误一起带回", async () => {
  const failure = await run_sandbox({
    script: `
const handler = async (ctx) => {
  ctx.log("进入 handler", ctx.params);
  ctx.error("准备抛错");
  throw new Error("handler 内部失败");
};
export const route = { handler };
`,
  }).catch((error) => error);
  assert.match(failure.message, /脚本异常：handler 内部失败/);
  assert.deepEqual(failure.lines, [
    { level: "info", text: '"进入 handler" {"account":"","page":"1"}' },
    { level: "error", text: '"准备抛错"' },
  ]);
});
