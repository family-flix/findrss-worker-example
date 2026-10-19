import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { create_puppeteer_navigate } from "../server/infra/script_puppeteer.js";
import { RssRouteCache } from "../server/infra/rss_cache.js";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { execute_script, compile_script_module } = await import("../server/infra/script_sandbox.js");
const { ServiceScript } = await import("../server/service/durable_object/scripts.js");

function fixture({ fail_at, capture, launch } = {}) {
  const calls = [];
  const page = Object.fromEntries(["setViewport", "goto", "waitForSelector"].map(method => [method, async (...args) => {
    calls.push([method, ...args]);
    if (method === fail_at) throw new Error("页面加载失败");
  }]));
  page.evaluate = async (script, arg) => {
    calls.push(["evaluate", arg]);
    const context = {
      arg, document: { fonts: { ready: Promise.resolve() }, documentElement: { outerHTML: "<div>渲染后的页面</div>" },
        querySelector: selector => ({ textContent: "渲染后的选区", selector }) },
      getComputedStyle: () => ({ color: "rgb(255, 0, 0)" }), TextEncoder,
      setTimeout: resolve => { resolve(); }, capture,
    };
    return vm.runInNewContext(typeof script === "string" ? script : `(${String(script)})(arg)`, context);
  };
  const binding = {};
  const navigate = create_puppeteer_navigate(binding, { launch: async value => {
    assert.equal(value, binding); calls.push(["launch"]);
    await launch?.();
    return { newPage: async () => page, close: async () => { calls.push(["close"]); } };
  } });
  return { navigate, calls };
}

test("navigate 渲染页面或执行提取函数，传递参数与视口并关闭会话；不调用浏览器", async () => {
  const { navigate, calls } = fixture();
  const result = await navigate("https://example.com", { selector: "#weather", wait_ms: 500,
    viewport: { width: 800, height: 600 }, args: ["#weather"] }, selector => {
    const node = document.querySelector(selector);
    return { text: node.textContent, selector: node.selector, color: getComputedStyle(node).color };
  });
  assert.deepEqual(result, { text: "渲染后的选区", selector: "#weather", color: "rgb(255, 0, 0)" });
  assert.deepEqual(calls.slice(0, 4), [["launch"], ["setViewport", { width: 800, height: 600 }],
    ["goto", "https://example.com/", { waitUntil: "networkidle2", timeout: 30000 }],
    ["waitForSelector", "#weather", { visible: true, timeout: 15000 }]]);
  assert.deepEqual(calls.at(-1), ["close"]);
  assert.deepEqual(await navigate("https://example.com"), { html: "<div>渲染后的页面</div>" });
});

test("navigate 在创建会话前校验 URL、选项、函数与参数体积", async () => {
  const { navigate, calls } = fixture();
  for (const [url, options, evaluate] of [
    ["not-url"], ["file:///etc/passwd"], ["https://user:secret@example.com"],
    ["https://example.com", []], ["https://example.com", { headers: { Cookie: "secret" } }],
    ["https://example.com", { viewport: { width: 1, height: 600 } }],
    ["https://example.com", { wait_ms: 10001 }], ["https://example.com", { selector: "" }],
    ["https://example.com", { args: {} }], ["https://example.com", {}, 123],
    ["https://example.com", { args: ["x".repeat(10 * 1024 * 1024)] }, "x => x"],
  ]) await assert.rejects(navigate(url, options, evaluate));
  assert.equal(calls.length, 0);
});

test("页面失败、函数失败、结果超限、取消及启动期间取消均关闭会话", async () => {
  for (const [options, evaluate, message] of [
    [{ fail_at: "goto" }, undefined, /页面加载失败/],
    [{}, () => { throw new Error("提取失败"); }, /提取失败/],
    [{}, () => undefined, /结果无效或过大/],
    [{}, () => "x".repeat(24 * 1024 * 1024), /结果无效或过大/],
  ]) {
    const { navigate, calls } = fixture(options);
    await assert.rejects(navigate("https://example.com", {}, evaluate), message);
    assert.deepEqual(calls.at(-1), ["close"]);
  }
  const controller = new AbortController();
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const { navigate, calls } = fixture({ capture: () => { started(); return new Promise(() => {}); } });
  const pending = navigate("https://example.com", {}, () => capture(), controller.signal);
  await ready; controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.deepEqual(calls.at(-1), ["close"]);
  const count = calls.length;
  await assert.rejects(navigate("https://example.com", {}, undefined, controller.signal), { name: "AbortError" });
  assert.equal(calls.length, count);
  const late_controller = new AbortController();
  const late = fixture({ launch: () => late_controller.abort() });
  await assert.rejects(late.navigate("https://example.com", {}, undefined, late_controller.signal), { name: "AbortError" });
  assert.deepEqual(late.calls, [["launch"], ["close"]]);
});

const source = `export const route = { path: "/render", name: "渲染", public: true, async handler(ctx) {
  return ctx.puppeteer.navigate("https://example.com", { args: ["#weather"] }, selector => ({
    text: document.querySelector(selector).textContent, color: getComputedStyle(document.querySelector(selector)).color,
  }));
} };`;
const context = { method: "GET", pathname: "/render", params: {}, query: {} };

test("真实 QuickJS 桥接导航、序列化提取函数，Result 只展开一层并传递取消信号", async () => {
  const { navigate } = fixture();
  const controller = new AbortController();
  const result = await execute_script(source, {}, null, context, [], "", null, controller.signal,
    (url, options, evaluate, signal) => {
      assert.equal(signal, controller.signal); assert.equal(typeof evaluate, "string");
      return navigate(url, options, evaluate, signal);
    });
  assert.deepEqual(JSON.parse(result.output), { text: "渲染后的选区", color: "rgb(255, 0, 0)" });
  await assert.rejects(execute_script(source, {}, null, context), /BROWSER/);
});

test("区域剪藏示例可编译并在 QuickJS 中调用 navigate mock，mock 失败保留错误", async () => {
  const clip_source = readFileSync(new URL("../examples/scripts/region_clip.js", import.meta.url), "utf8");
  const compiled = await compile_script_module(clip_source);
  assert.equal(compiled.error, "");
  const metadata = { ...compiled.metadata, config: { url: "https://example.com", selector: "#weather" } };
  for (const returned of ['({ ok: true, html: "<div style=\\"color:red\\">区域</div>", stats: { width: 320 } })',
    'Result.Ok({ ok: true, html: "<div style=\\"color:red\\">区域</div>", stats: { width: 320 } })']) {
    const result = await execute_script(clip_source, metadata, null, context, [], `({ puppeteer: {
      navigate(url, options, evaluate) {
        if (url !== "https://example.com" || options.selector !== "#weather" || !String(evaluate).includes("getComputedStyle")) throw new Error("参数丢失");
        return ${returned};
      }
    } })`, null, undefined, () => assert.fail("mock 不能调用真实渲染器"));
    assert.match(JSON.parse(result.output).html, /color:red/);
  }
  await assert.rejects(execute_script(clip_source, metadata, null, context, [],
    '({ puppeteer: { navigate() { return { ok: false, error: "选区不可见" }; } } })'), /选区不可见/);
  await assert.rejects(execute_script(source, {}, null, context, [],
    '({ puppeteer: { navigate() { return Result.Err("渲染服务不可用"); } } })'), /渲染服务不可用/);
});

test("脚本正式请求、Debug 和测试运行共用注入的导航能力，Mock 覆盖真实能力", async () => {
  const rows = [];
  let calls = 0;
  const service = new ServiceScript({ repo: {
    scripts: { list: () => rows, list_enabled: () => rows, count: () => rows.length,
      find: id => rows.find(row => row.route === id), find_config: id => rows.find(row => row.route === id),
      insert: row => rows.push(row) }, rss_cookies: { get: () => [] },
  }, ports: { route_cache: new RssRouteCache(60000, 10), puppeteer_navigate: async (_url, _options, evaluate) => {
    calls++; assert.match(evaluate, /getComputedStyle/); return { text: "实际渲染结果" };
  } }, app: {} });
  service.record_log = () => {};
  service.rss_address_is_public = () => false;
  const request = body => new Request("https://internal", { method: "POST", body: JSON.stringify(body) });
  const created = (await service.create_script(request({ script: source, version: "1.0.0" }))).data.script;
  const response = await service.serve_rss_route("raw", "/render", new Request("https://internal/_public/script/render"));
  assert.equal(response.raw.text, "实际渲染结果");
  const debug = await service.debug_script(request({ script: source, route: created.id, request_url: "/debug/render" }));
  assert.equal(JSON.parse(debug.rss_debug.output).text, "实际渲染结果");
  const tested = await service.test_script(request({ script: source, route: created.id }));
  assert.equal(JSON.parse(tested.preview).text, "实际渲染结果");
  assert.equal(calls, 3);
  const mocked = await service.test_script(request({ script: source, route: created.id,
    mock_ctx: '({ puppeteer: { navigate: async () => ({ text: "Mock 结果" }) } })' }));
  assert.equal(JSON.parse(mocked.preview).text, "Mock 结果");
  assert.equal(calls, 3);
});
