import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { config_defaults, script_config_value, validate_config_schema } from "../server/lib/script_config.js";
import { RssRouteCache } from "../server/infra/rss_cache.js";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { compile_script_module, execute_script } = await import("../server/infra/script_sandbox.js");
const { ServiceScript } = await import("../server/service/durable_object/scripts.js");

const schema = { type: "object", additionalProperties: false, required: ["token"], properties: {
  token: { type: "string", title: "Token", minLength: 1, writeOnly: true },
  count: { type: "integer", minimum: 0, maximum: 10, default: 0 },
  enabled: { type: "boolean", default: false },
  mode: { type: "string", enum: ["full", "brief"], enumDescriptions: ["完整", "简洁"], default: "brief" },
  options: { type: "object", properties: { label: { type: "string", default: "默认" } } },
  tags: { type: "array", items: { type: "string", pattern: "^[a-z]+$" }, minItems: 1 },
} };
const source = `export const config_schema = ${JSON.stringify(schema)};
export const routes = ["/config-test", "/config-test/second"].map(path => ({ path, name: "配置测试", public: true,
  handler(ctx) { return { config: ctx.config, pathname: ctx.pathname }; } }));`;
const request = body => new Request("https://internal/_admin/scripts", { method: "POST", body: JSON.stringify(body) });

test("配置使用默认值并保留零、false、空字符串；校验类型、必填、枚举和嵌套值", () => {
  validate_config_schema(schema);
  assert.deepEqual(script_config_value(schema, { token: "secret" }), { token: "secret", count: 0, enabled: false, mode: "brief" });
  assert.deepEqual(config_defaults(schema, { options: {}, count: 2, enabled: true }), { options: { label: "默认" }, count: 2, enabled: true, mode: "brief" });
  assert.deepEqual(script_config_value({ type: "object", properties: { text: { type: "string", default: "fallback" } } }, { text: "" }), { text: "" });
  for (const value of [{}, { token: "" }, { token: 1 }, { token: "s", count: "1" }, { token: "s", count: 1.5 },
    { token: "s", count: 11 }, { token: "s", enabled: "false" }, { token: "s", mode: "other" },
    { token: "s", extra: true }, { token: "s", options: { label: 1 } }, { token: "s", tags: [] }, { token: "s", tags: ["123"] }, null, []]) {
    assert.throws(() => script_config_value(schema, value));
  }
  assert.throws(() => script_config_value(schema, { token: "x".repeat(32769) }), /32KB/);
  assert.throws(() => script_config_value(schema, { token: "配".repeat(11000) }), /32KB/);
  assert.deepEqual(script_config_value(undefined), {});
  assert.throws(() => script_config_value(undefined, { token: "s" }), /未声明/);
});

test("声明拒绝不支持的 Schema、非法默认值和危险字段", async () => {
  for (const value of [null, [], { type: "string" }, { type: "object", properties: {}, oneOf: [] },
    { type: "object", properties: { count: { type: "integer", default: "1" } } },
    { type: "object", properties: { list: { type: "array" } } },
    JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}'),
    { type: "object", properties: { text: { type: "string", pattern: "[" } } },
    { type: "object", properties: {}, required: ["missing"] }]) {
    assert.throws(() => validate_config_schema(value));
    const compiled = await compile_script_module(source.replace(JSON.stringify(schema), "JSON.parse(" + JSON.stringify(JSON.stringify(value)) + ")"));
    assert.notEqual(compiled.error, "", JSON.stringify(value));
  }
});

test("真实沙箱读取配置和默认值；缺失必填配置在调用 handler 前报错", async () => {
  const compiled = await compile_script_module(source);
  assert.equal(compiled.error, "");
  assert.deepEqual(compiled.metadata.config_schema, schema);
  const result = await execute_script(source, { ...compiled.metadata, config: { token: "saved" } });
  assert.deepEqual(JSON.parse(result.output).config, { token: "saved", count: 0, enabled: false, mode: "brief" });
  await assert.rejects(execute_script(source, compiled.metadata), /脚本配置无效.*token/);
});

test("API 持久化配置，更新代码与状态保留配置，多路由、Debug 与 Mock 测试读取相同配置", async () => {
  const rows = [];
  const cache = new RssRouteCache(60000, 100);
  const service = new ServiceScript({ repo: {
    scripts: { list: () => rows, list_enabled: () => rows, count: () => rows.length,
      find: id => rows.find(row => row.route === id), find_config: id => rows.find(row => row.route === id),
      insert: row => rows.push(row), update: row => Object.assign(rows.find(value => value.route === row.route), row) },
    rss_cookies: { get: () => [] },
  }, ports: { route_cache: cache }, app: {} });
  service.record_log = () => {};
  service.rss_address_is_public = () => false;
  const created = (await service.create_script(request({ script: source, version: "1.0.0" }))).data.script;
  assert.deepEqual(created.config_schema, schema);
  assert.deepEqual(created.config, {});
  const generation = cache.generation;
  const saved = (await service.update_script(request({ config: { token: "saved", enabled: false, count: 0, tags: ["news"] } }), created.id)).script;
  assert.equal(saved.config.token, "saved");
  assert.equal(saved.version, "1.0.0");
  assert.ok(cache.generation > generation);
  await assert.rejects(service.update_script(request({ config: { token: "" } }), created.id), error => error.status === 400);
  assert.equal(JSON.parse(rows[0].metadata_json).config.token, "saved");
  const updated = (await service.update_script(request({ script: source + "\n// Updated", version: "1.0.1" }), created.id)).script;
  assert.deepEqual(updated.config, saved.config);
  await service.update_script(request({ enabled: false }), created.id);
  assert.deepEqual(JSON.parse(rows[0].metadata_json).config, saved.config);
  await service.update_script(request({ enabled: true }), created.id);
  for (const path of ["/config-test", "/config-test/second"]) {
    const result = await service.serve_rss_route("raw", path, new Request("https://internal/_public/script" + path));
    assert.deepEqual(result.raw.config, saved.config);
  }
  const debug = await service.debug_script(request({ script: source, route: created.id, request_url: "/debug/config-test/second" }));
  assert.equal(debug.status, 200, JSON.stringify(debug));
  assert.deepEqual(JSON.parse(debug.rss_debug.output).config, saved.config);
  const preview = await service.preview_script_routes(request({ script: source }));
  assert.deepEqual(preview.config_schema, schema);
  for (const route of [created.id, ""]) {
    const configured = await service.debug_script(request({ script: source, route, request_url: "/debug/config-test",
      config: { token: "debug", count: 2 } }));
    assert.equal(configured.status, 200, JSON.stringify(configured));
    assert.deepEqual(JSON.parse(configured.rss_debug.output).config, { token: "debug", count: 2, enabled: false, mode: "brief" });
  }
  for (const config of [null, [], {}, { token: "" }, { token: "debug", count: -1 }, { token: "x".repeat(32769) }]) {
    const invalid = await service.debug_script(request({ script: source, route: created.id, request_url: "/debug/config-test", config }));
    assert.ok(invalid.status >= 400);
    assert.match(invalid.rss_debug.error_text, /脚本配置无效/);
  }
  assert.deepEqual(JSON.parse(rows[0].metadata_json).config, saved.config, "调试配置不写入正式配置");
  const mock = await service.test_script(request({ script: source, route: created.id, route_index: 1 }));
  assert.equal(mock.ok, true, JSON.stringify(mock));
  assert.deepEqual(JSON.parse(mock.preview).config, saved.config);
  const draft = (await service.update_script(request({ status: "draft" }), created.id)).script;
  assert.deepEqual(draft.config, saved.config);
});
