import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { ScriptAgentRunRequestModel, ScriptAgentSettingsModel } from "../server/domain/script_agent.js";
import { create_script_agent_credentials } from "../server/infra/script_agent_credentials.js";
import { create_openai_compat_provider } from "../server/infra/script_agent_provider.js";
import { to_chat_messages } from "../server/lib/script_agent_protocol.js";
import { SCRIPT_AGENT_FEED_KNOWLEDGE } from "../server/lib/script_agent_feed_knowledge.js";
import { SCRIPT_AGENT_RUNTIME_KNOWLEDGE } from "../server/lib/script_agent_runtime_knowledge.js";
import { SCRIPT_AGENT_RSSHUB_KNOWLEDGE } from "../server/lib/script_agent_rsshub_knowledge.js";
import { fetch_rsshub_route_js } from "../server/infra/rsshub_route.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const { XiaoxunScriptAgent, ServiceScriptAgent } = await import("../server/service/durable_object/script_agent.js");
const { route } = await import("../durable_object_router.js");
const { default: worker } = await import("../api.js");

const source = title => `export const route = { path: "/agent/:id", name: "${title}", url: "example.com", maintainers: [],
  example: "/agent/1", parameters: {}, description: "", handler(ctx) { return { title: "${title}", items: [], id: ctx.params.id }; } };`;
const input = () => ScriptAgentRunRequestModel({ run_id: "run-1", revision: 2, script: source("before"),
  request_url: "/debug/agent/real", route: "", messages: [{ role: "user", content: "修改标题并验证" }] });
const tool = (name, args = {}) => ({ content: "", tool_calls: [{ id: "call-" + name, name, arguments: args }], usage: {} });
const answer = content => ({ content, tool_calls: [], usage: { prompt_tokens: 10, completion_tokens: 5 } });

test("模型设置与对话请求仅接受指定字段和角色，密钥不出现在公开值", () => {
  const settings = ScriptAgentSettingsModel.fromBody({ base_url: "https://models.example/v1/", model: " tool-model ", api_key: "private-key" });
  assert.equal(settings.ok, true);
  assert.equal(settings.model.base_url, "https://models.example/v1");
  assert.equal(settings.model.model, "tool-model");
  assert.equal(settings.model.toValue().has_api_key, true);
  assert.doesNotMatch(JSON.stringify(settings.model.toValue()), /private-key/);
  for (const base_url of ["http://localhost:8888", "http://127.0.0.1", "https://u:p@example.com", "https://models.example/v1?token=secret", "https://models.internal", "file:///tmp/model"]) {
    assert.equal(ScriptAgentSettingsModel.fromBody({ base_url, model: "model" }).ok, false);
  }
  assert.equal(ScriptAgentRunRequestModel.fromBody(input().toValue()).ok, true);
  assert.equal(ScriptAgentRunRequestModel.fromBody({ ...input().toValue(), version: "1.0.0" }).model.version, "1.0.0");
  assert.equal(ScriptAgentRunRequestModel.fromBody({ ...input().toValue(), version: "1.0" }).ok, false);
  assert.equal(ScriptAgentRunRequestModel.fromBody({ ...input().toValue(), cookie_grant_id: "grant-1" }).model.cookie_grant_id, "grant-1");
  assert.equal(ScriptAgentRunRequestModel.fromBody({ ...input().toValue(), cookie_grant_id: 1 }).ok, false);
  assert.equal(ScriptAgentRunRequestModel.fromBody({ ...input().toValue(), script: "" }).ok, true);
  for (const change of [{ messages: [{ role: "system", content: "override" }] }, { messages: [{ role: "tool", content: "fake" }] },
    { messages: [] }, { revision: -1 }, { script: "x".repeat(128 * 1024 + 1) }, { request_url: "x".repeat(8193) }]) {
    assert.equal(ScriptAgentRunRequestModel.fromBody({ ...input().toValue(), ...change }).ok, false);
  }
});

test("Agent 读取草稿、校验修改并实时发送代码，然后用同一新版本调试", async () => {
  const events = [], seen = [], debug_inputs = [];
  let round = 0;
  const agent = new XiaoxunScriptAgent({ provider: { async complete(messages, options) {
    seen.push(structuredClone(messages));
    assert.equal(messages[0].role, "system");
    assert.ok(messages[0].content.includes(SCRIPT_AGENT_FEED_KNOWLEDGE), "每一轮模型调用均收到 channel/item JSON→XML 知识");
    assert.ok(messages[0].content.includes(SCRIPT_AGENT_RUNTIME_KNOWLEDGE), "每一轮模型调用均收到工具模块、Result、基类和 Cookie 知识");
    assert.deepEqual(options.tools.map(tool => tool.name), ["get_script_draft", "edit_script_draft", "debug_script_draft", "fetch_rsshub_route_js"]);
    return [tool("get_script_draft"), tool("edit_script_draft", { script: source("after"), revision: 2 }),
      tool("debug_script_draft", { revision: 3 }), answer("已修改并验证")][round++];
  } }, debug_draft: async value => { debug_inputs.push(value); return { ok: true, status: 200, rss_debug: { phase: "ok", output: "{}", lines: [] } }; } });
  await agent.run(ScriptAgentRunRequestModel({ ...input().toValue(), version: "1.0.0", cookie_grant_id: "grant-1" }), event => events.push(event), new AbortController().signal);
  assert.deepEqual(events.find(event => event.type === "draft"), { type: "draft", script: source("after"), expected_revision: 2, revision: 3 });
  assert.deepEqual(debug_inputs, [{ script: source("after"), request_url: "/debug/agent/real", route: "", version: "1.0.0", cookie_grant_id: "grant-1" }]);
  assert.equal(events.find(event => event.type === "debug").revision, 3);
  assert.equal(events.at(-1).type, "done");
  assert.equal(events.at(-1).content, "已修改并验证");
  assert.equal(JSON.parse(seen[1].at(-1).content).revision, 2);
  const wire = to_chat_messages(seen[3]);
  assert.ok(wire.some(message => message.role === "assistant" && typeof message.tool_calls[0].function.arguments === "string"));
  assert.ok(wire.some(message => message.role === "tool" && message.tool_call_id));
});

test("Agent 读取 RSSHub 源码提供给模型，转换后经真实编译更新草稿并调试", async () => {
  const url = "https://github.com/DIYgod/RSSHub/blob/master/lib/routes/005/index.tsx";
  const upstream_source = "export const route: Route = { path: '/:category?', handler: () => <p>资讯</p> };";
  const converted = `export const route = { path: '/005/:category?', name: '资讯', example: '/005/zx',
    handler(ctx) { return Result.Ok({ title: '资讯', link: 'https://005.tv/', items: [] }); } };`;
  const events = [];
  let round = 0, fetched = 0;
  const controller = new AbortController();
  const agent = new XiaoxunScriptAgent({
    fetch_rsshub: (args, { signal }) => {
      assert.equal(signal, controller.signal);
      return fetch_rsshub_route_js(args, { signal, fetch_impl: async requested => {
        fetched++; assert.equal(requested, url.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/"));
        return new Response(upstream_source);
      } });
    },
    provider: { async complete(messages, options) {
      assert.ok(messages[0].content.includes(SCRIPT_AGENT_RSSHUB_KNOWLEDGE));
      assert.ok(options.tools.some(tool => tool.name === "fetch_rsshub_route_js"));
      if (round === 1) {
        const result = JSON.parse(messages.at(-1).content);
        assert.equal(result.source, upstream_source);
        assert.equal(result.path, "lib/routes/005/index.tsx");
      }
      return [tool("fetch_rsshub_route_js", { url }), tool("get_script_draft"),
        tool("edit_script_draft", { script: converted, revision: 2 }),
        tool("debug_script_draft", { revision: 3 }), answer("已转换并更新草稿")][round++];
    } },
    debug_draft: async value => {
      assert.equal(value.script, converted);
      return { ok: true, status: 200, rss_debug: { output: "{}", lines: [] } };
    },
  });
  await agent.run(input(), event => events.push(event), controller.signal);
  assert.equal(fetched, 1);
  assert.deepEqual(events.filter(event => event.type === "tool_end").map(event => event.ok), [true, true, true, true]);
  assert.equal(events.find(event => event.type === "draft").script, converted);
  assert.equal(events.find(event => event.type === "debug").revision, 3);
});

test("RSSHub 抓取失败回传模型，取消后不发送迟到的工具结果", async () => {
  let round = 0;
  const events = [];
  const agent = new XiaoxunScriptAgent({ fetch_rsshub: async () => { throw new Error("RSSHub HTTP 404"); },
    provider: { async complete(messages) {
      if (!round++) return tool("fetch_rsshub_route_js", { url: "missing" });
      assert.match(JSON.parse(messages.at(-1).content).error, /404/);
      return answer("源码不存在");
    } },
  });
  await agent.run(input(), event => events.push(event));
  assert.equal(events.find(event => event.type === "tool_end").ok, false);
  assert.equal(events.some(event => event.type === "draft"), false);
  let finish;
  const controller = new AbortController(), cancelled_events = [];
  const cancelled = new XiaoxunScriptAgent({ fetch_rsshub: () => new Promise(resolve => { finish = resolve; }),
    provider: { complete: async () => tool("fetch_rsshub_route_js", { url: "source" }) },
  });
  const pending = cancelled.run(input(), event => cancelled_events.push(event), controller.signal);
  await Promise.resolve(); controller.abort(new Error("停止抓取")); finish({ source: "late" });
  await assert.rejects(pending, /停止抓取/);
  assert.equal(cancelled_events.some(event => event.type === "tool_end"), false);
});

test("过期版本、非法脚本、未注册工具和缺失调试链接返回工具错误，不修改代码", async () => {
  for (const call of [tool("edit_script_draft", { script: source("after"), revision: 1 }),
    tool("edit_script_draft", { script: "broken javascript", revision: 2 }), tool("delete_script"), tool("debug_script_draft", { revision: 2 })]) {
    let round = 0; const events = []; let result;
    const agent = new XiaoxunScriptAgent({ provider: { async complete(messages) {
      if (round++) { result = JSON.parse(messages.at(-1).content); return answer("需要修正输入"); }
      return call;
    } }, debug_draft: () => assert.fail("不应执行调试") });
    await agent.run({ ...input(), request_url: "" }, event => events.push(event));
    assert.ok(result.error);
    assert.equal(events.some(event => event.type === "draft"), false);
    assert.equal(events.some(event => event.type === "debug"), false);
  }
});

test("取消校验中的对话不会发送迟到代码；循环工具请求在 8 轮终止", async () => {
  const controller = new AbortController(); let validated;
  const events = [];
  const agent = new XiaoxunScriptAgent({ provider: { complete: async () => tool("edit_script_draft", { script: source("after"), revision: 2 }) },
    validate_script: () => new Promise(resolve => { validated = resolve; }) });
  const pending = agent.run(input(), event => events.push(event), controller.signal);
  await Promise.resolve(); controller.abort(new Error("stop"));
  validated({ error: "", metadata: { routes: [] } });
  await assert.rejects(pending, /stop/);
  assert.equal(events.some(event => event.type === "draft"), false);
  let calls = 0;
  const loop = new XiaoxunScriptAgent({ provider: { complete: async () => { calls++; return tool("get_script_draft"); } } });
  await assert.rejects(loop.run(input(), () => {}), /8 轮/);
  assert.equal(calls, 8);
});

test("模型 API Key 加密保存，空密钥更新保留旧值，返回值永不带密钥", async () => {
  const credentials = create_script_agent_credentials("admin-secret");
  let stored = {};
  const service = new ServiceScriptAgent({ repo: { get: () => stored, put: row => { stored = row; } }, credentials });
  await assert.rejects(service.save_settings({ base_url: "https://models.example/v1", model: "m" }), /API Key/);
  const result = await service.save_settings({ base_url: "https://models.example/v1", model: "m", api_key: "private-key" });
  assert.equal(result.configured, true);
  assert.doesNotMatch(JSON.stringify(stored), /private-key/);
  assert.doesNotMatch(JSON.stringify(result), /private-key|encrypted_api_key/);
  const ciphertext = stored.encrypted_api_key;
  assert.equal(await credentials.decrypt(ciphertext), "private-key");
  await service.save_settings({ base_url: "https://models.example/v1", model: "changed", api_key: "" });
  assert.equal(stored.encrypted_api_key, ciphertext);
  await assert.rejects(create_script_agent_credentials("wrong-secret").decrypt(ciphertext), /重新配置/);
});

test("模型适配器完整读取 JSON 和分块 SSE，发送工具协议并脱敏上游错误", async () => {
  const requests = [];
  const provider = create_openai_compat_provider({ settings: { model: "model", base_url: "https://models.example/v1", api_key_secret_name: "" },
    api_key_lookup: () => "private-key", fetch_impl: async (url, options) => {
      requests.push({ url, options });
      return Response.json({ choices: [{ message: { content: "回答", tool_calls: [] } }], usage: { prompt_tokens: 10 } });
    } });
  const deltas = [];
  const result = await provider.complete([{ role: "user", content: "hi" }], { tools: ScriptAgentRunRequestModel.TOOLS, on_delta: text => deltas.push(text) });
  assert.equal(result.content, "回答"); assert.deepEqual(deltas, ["回答"]);
  assert.equal(requests[0].url, "https://models.example/v1/chat/completions");
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.tools[0].type, "function"); assert.equal(body.stream, true);
  const data = [
    { choices: [{ delta: { content: "生成" } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "edit", function: { name: "edit_script_draft", arguments: '{"revision":2,' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"script":"code"}' } }] }, finish_reason: "tool_calls" }] },
  ].map(value => "data: " + JSON.stringify(value) + "\r\n\r\n").join("") + "data: [DONE]\r\n\r\n";
  const bytes = new TextEncoder().encode(data);
  const streaming = create_openai_compat_provider({ settings: { model: "model", base_url: "https://models.example/v1", api_key_secret_name: "" },
    api_key_lookup: () => "private-key", fetch_impl: async () => new Response(new ReadableStream({ start(controller) {
      for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.subarray(i, i + 3)); controller.close();
    } }), { headers: { "Content-Type": "text/event-stream" } }) });
  const streamed = await streaming.complete([{ role: "user", content: "hi" }]);
  assert.equal(streamed.content, "生成");
  assert.deepEqual(streamed.tool_calls[0].arguments, { revision: 2, script: "code" });
  const failed = create_openai_compat_provider({ settings: { model: "m", base_url: "https://models.example", api_key_secret_name: "" },
    api_key_lookup: () => "private-key", fetch_impl: async () => new Response("invalid private-key", { status: 401 }) });
  await assert.rejects(failed.complete([]), error => /\[redacted\]/.test(error.message) && !error.message.includes("private-key"));
});

test("管理员模型设置端点鉴权、转发与响应；WebSocket 拒绝跨站 Origin", async () => {
  const credentials = create_script_agent_credentials("admin"); let stored = {};
  const service = new ServiceScriptAgent({ repo: { get: () => stored, put: row => { stored = row; } }, credentials });
  const env = { ADMIN_PASSWORD: "admin", API: { getByName: () => ({ fetch: input => route(input, { script_agent: service }) }) } };
  const headers = { Authorization: "Bearer admin" };
  const endpoint = "https://feeds.example/admin/api/scripts/agent/settings";
  assert.equal((await worker.fetch(new Request(endpoint), env)).status, 401);
  let response = await worker.fetch(new Request(endpoint, { headers }), env);
  assert.equal((await response.json()).configured, false);
  response = await worker.fetch(new Request(endpoint, { method: "PUT", headers,
    body: JSON.stringify({ base_url: "https://models.example/v1", model: "m", api_key: "private" }) }), env);
  assert.equal(response.status, 200); assert.equal((await response.json()).configured, true);
  response = await worker.fetch(new Request(endpoint, { headers }), env);
  assert.doesNotMatch(await response.text(), /private|encrypted_api_key/);
  response = await worker.fetch(new Request("https://feeds.example/admin/api/scripts/agent/ws", { headers: { ...headers, Origin: "https://other.example", Upgrade: "websocket" } }), env);
  assert.equal(response.status, 403);
  const global_endpoint = "https://feeds.example/admin/api/agent/ws";
  assert.equal((await worker.fetch(new Request(global_endpoint, { headers: { Upgrade: "websocket" } }), env)).status, 401);
  assert.equal((await worker.fetch(new Request(global_endpoint, { headers: { ...headers, Origin: "https://other.example", Upgrade: "websocket" } }), env)).status, 403);
});

const provider_config = (id, model_id = "m") => ({ id, name: id, type: "openai_compat", enabled: true, base_url: `https://${id}.example/v1`,
  api_key_secret_name: "", models: [{ id: model_id, name: model_id, model: `${id}-model`, enabled: true, options: { temperature: 0.2, max_tokens: 400 } }] });

test("多厂商密钥独立加密、留空保留、显式删除；删除厂商清除其凭证，环境密钥仅允许模型前缀", async () => {
  let stored = {};
  const credentials = create_script_agent_credentials("admin");
  const service = new ServiceScriptAgent({ repo: { get: () => stored, put: row => { stored = row; } }, credentials,
    secret_lookup: name => name === "READER_AI_TEST" ? "environment-key" : "" });
  const p1 = provider_config("one"), p2 = provider_config("two");
  await service.save_settings({ providers: [p1, p2], ai_keys: { one: "key-one", two: "key-two" } });
  const keys = JSON.parse(stored.encrypted_keys_json);
  assert.equal(await credentials.decrypt(keys.one), "key-one");
  assert.equal(await credentials.decrypt(keys.two), "key-two");
  assert.doesNotMatch(JSON.stringify(service.settings()), /key-one|key-two|encrypted/);
  assert.equal(service.settings().providers[1].api_key_source, "account");
  await service.save_settings({ providers: [p1, p2], ai_keys: { one: "", two: null } });
  assert.equal(JSON.parse(stored.encrypted_keys_json).one, keys.one);
  assert.equal(service.settings().providers[1].api_key_configured, undefined);
  assert.equal(service.settings().providers[0].api_key_configured, true);
  await service.save_settings({ providers: [{ ...p2, api_key_secret_name: "READER_AI_TEST" }] });
  assert.deepEqual(JSON.parse(stored.encrypted_keys_json), {});
  assert.equal(service.settings().providers[0].api_key_source, "environment");
  await assert.rejects(service.save_settings({ providers: [{ ...p2, api_key_secret_name: "ADMIN_PASSWORD" }] }), /环境密钥/);
  await assert.rejects(service.save_settings({ providers: [p1, p1] }), /重复/);
  await assert.rejects(service.save_settings({ providers: [p1], ai_keys: { two: "wrong" } }), /厂商不存在/);
});

test("每轮对话使用准确选中的厂商、模型与参数；不可用选择不回退，草稿测试不保存配置", async () => {
  let stored = {}, saved = 0;
  const calls = [];
  const service = new ServiceScriptAgent({ repo: { get: () => stored, put: row => { stored = row; saved++; } },
    credentials: create_script_agent_credentials("admin"), provider_factory: config => ({ async complete() {
      calls.push({ ...config.settings, key: await config.api_key_lookup() }); return answer("OK");
    } }) });
  const p1 = provider_config("one"), p2 = provider_config("two");
  p2.models.push({ ...p2.models[0], id: "other", model: "other-model", options: { reasoning_effort: "high" } });
  await service.save_settings({ providers: [p1, p2], ai_keys: { one: "key-one", two: "key-two" } });
  await service.run({ ...input(), provider_id: "two", model_id: "other" }, () => {});
  assert.equal(calls[0].model, "other-model"); assert.equal(calls[0].base_url, p2.base_url); assert.equal(calls[0].key, "key-two");
  assert.deepEqual(calls[0].options, { reasoning_effort: "high" });
  await assert.rejects(service.run({ ...input(), provider_id: "two", model_id: "deleted" }, () => {}), /不可用/);
  assert.equal(calls.length, 1);
  const draft = { ...p2, base_url: "https://draft.example/v1" };
  const result = await service.test_connection({ provider: draft, model_id: "other", api_key: "draft-key" });
  assert.equal(result.model, "other-model"); assert.equal(calls[1].key, "draft-key"); assert.equal(calls[1].base_url, draft.base_url);
  assert.equal(saved, 1); assert.equal(service.settings().providers[1].base_url, p2.base_url);
  await service.save_settings({ providers: [p1, { ...p2, enabled: false }] });
  await assert.rejects(service.run({ ...input(), provider_id: "two", model_id: "other" }, () => {}), /不可用/);
});

test("升级单模型配置时保留凭证，移除 Workers AI 后拒绝该厂商并过滤旧配置", async () => {
  const credentials = create_script_agent_credentials("admin");
  let stored = { base_url: "https://legacy.example/v1", model: "legacy-model", encrypted_api_key: await credentials.encrypt("legacy-key") };
  const service = new ServiceScriptAgent({ credentials, repo: { get: () => stored, put: row => { stored = row; } } });
  const upgraded = service.settings().providers;
  assert.equal(upgraded[0].models[0].model, "legacy-model");
  const cloud = { id: "workers", name: "Workers AI", type: "workers_ai", enabled: true, base_url: "", models: [{ id: "cf", name: "Cloud", model: "@cf/test/model", enabled: true, options: {} }] };
  await assert.rejects(service.save_settings({ providers: [...upgraded, cloud] }), /不支持的模型厂商类型/);
  await assert.rejects(service.test_connection({ provider: cloud, model_id: "cf" }), /不支持的模型厂商类型/);
  await service.save_settings({ providers: upgraded });
  assert.equal(await credentials.decrypt(JSON.parse(stored.encrypted_keys_json).default), "legacy-key");
  stored.config_json = JSON.stringify({ providers: [...upgraded, cloud] });
  assert.deepEqual(service.settings().providers.map(provider => provider.id), ["default"]);
  await assert.rejects(service.run({ ...input(), provider_id: "workers", model_id: "cf" }, () => {}), /不可用/);
});
