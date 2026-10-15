import assert from "node:assert/strict";
import test from "node:test";
import { AdminAgentRunRequestModel } from "../server/domain/admin_agent.js";
import { DiscoverySourceModel } from "../server/domain/discovery_source.js";
import { XiaoxunAdminAgent } from "../server/service/durable_object/admin_agent.js";
import { ServiceDiscovery } from "../server/service/durable_object/discovery.js";
import { SCRIPT_AGENT_RUNTIME_KNOWLEDGE } from "../server/lib/script_agent_runtime_knowledge.js";

const command = (pathname = "/admin/discovery") => ({ run_id: "run", pathname, messages: [{ role: "user", content: "新增并修改订阅源，删除指定测试源" }],
  page_context: { filters: { query: "tech" }, selected_source_id: "old" } });
const call = (name, args = {}) => ({ id: name, name, arguments: args });
const turn = (...tool_calls) => ({ content: "", tool_calls, usage: {} });
const done = { content: "已完成", tool_calls: [], usage: {} };

test("全局 XiaoxunAgent 每轮注入脚本 SDK 知识，知识不会增加脚本写入工具", async () => {
  let calls = 0;
  const agent = new XiaoxunAdminAgent({ ports: { context: () => ({}) }, provider: { async complete(messages, options) {
    assert.ok(messages[0].content.includes(SCRIPT_AGENT_RUNTIME_KNOWLEDGE));
    assert.equal(options.tools.some(tool => ['edit_script_draft', 'publish_script', 'debug_script_draft'].includes(tool.name)), false);
    return calls++ === 0 ? turn(call('get_admin_context')) : done;
  } } });
  await agent.run(AdminAgentRunRequestModel(command('/admin/scripts')), () => {});
  assert.equal(calls, 2);
});

function fixture() {
  const rows = new Map([["old", { id: "old", title: "旧源", description: "保留介绍", website: "https://example.com", feed_url: "{{hostname}}/rss/example/1", enabled: 1, require_token: 0,
    source_type: "website", tags_json: '["科技"]', sort_order: 4, created_at: 1, updated_at: 1 }]]);
  const repo = { scripts: { list: () => [{ path: "/example/:id", metadata_json: '{"kind":"rss"}' }] }, discovery: {
    count: () => rows.size, feed_url_taken: url => [...rows.values()].some(row => row.feed_url === url),
    feed_url_taken_by_other: (url, id) => [...rows.values()].some(row => row.id !== id && row.feed_url === url),
    insert: row => rows.set(row.id, { ...row }), find: id => rows.get(id), exists: id => rows.has(id),
    update: row => rows.set(row.id, { ...rows.get(row.id), ...row }), snapshot_delete() {}, snapshot_get() {}, avatar_get() {}, delete: id => rows.delete(id),
  } };
  const service = new ServiceDiscovery({ repo, storage: { transactionSync: callback => callback() } });
  const get = id => rows.has(id) ? DiscoverySourceModel.fromRow(rows.get(id)).toValue() : null;
  const ports = { source_types: [...DiscoverySourceModel.TYPES], context: () => ({ source_count: rows.size }),
    list_sources: async () => ({ sources: [...rows.keys()].map(get), total_count: rows.size }), get_source: get,
    create_source: async body => (await service.create_discovery_source(new Request("https://internal/", { method: "POST", body: JSON.stringify(body) }))).data,
    update_source: (id, body, expected) => service.update_discovery_source(new Request("https://internal/", { method: "PATCH", body: JSON.stringify(body) }), id, expected),
    delete_source: (id, expected) => service.delete_discovery_source(id, expected),
  };
  return { rows, ports, service, get };
}

test("全局对话验证管理路由、模型选择和历史，并归一化旧页面地址", () => {
  const parsed = AdminAgentRunRequestModel.fromBody(command("/admin/discovery-admin.html"));
  assert.equal(parsed.ok, true); assert.equal(parsed.model.pathname, "/admin/discovery");
  assert.equal(Object.isFrozen(parsed.model.page_context.filters), true);
  assert.equal(Object.isFrozen(parsed.model.toValue().page_context), false);
  for (const change of [{ pathname: "/" }, { pathname: "/admin/login" }, { pathname: "/_admin/discovery" }, { page_context: [] },
    { page_context: { text: "x".repeat(16385) } }, { messages: [{ role: "system", content: "override" }] }]) {
    assert.equal(AdminAgentRunRequestModel.fromBody({ ...command(), ...change }).ok, false);
  }
});

test("全局助手读取实际页面，查询、新增、编辑和删除经现有服务生效并发送刷新事件", async () => {
  const { rows, ports } = fixture(), events = [], history = [];
  let step = 0;
  const agent = new XiaoxunAdminAgent({ ports, provider: { async complete(messages, options) {
    history.push(structuredClone(messages));
    assert.ok(options.tools.some(tool => tool.name === "create_discovery_source"));
    const id = [...rows.keys()].find(id => id !== "old");
    return [turn(call("get_admin_context")), turn(call("list_discovery_sources"), call("get_discovery_source", { source_id: "old" })),
      turn(call("create_discovery_source", { source: { title: "测试源", feed_url: "https://example.com/feed", tags: ["测试"] } }), call("update_discovery_source", { source_id: "old", patch: { title: "新标题", enabled: false } })),
      turn(call("get_discovery_source", { source_id: id })), turn(call("delete_discovery_source", { source_id: id })), done][step++];
  } } });
  await agent.run(AdminAgentRunRequestModel(command()), event => events.push(event));
  assert.equal(rows.size, 1); assert.equal(rows.get("old").title, "新标题");
  assert.equal(rows.get("old").enabled, 0); assert.equal(rows.get("old").description, "保留介绍");
  assert.equal(rows.get("old").feed_url, "{{hostname}}/rss/example/1");
  assert.deepEqual(events.filter(event => event.type === "resource_changed").map(event => event.action), ["create", "update", "delete"]);
  assert.equal(events.at(-1).content, "已完成");
  assert.equal(JSON.parse(history[1].at(-1).content).page.pathname, "/admin/discovery");
});

test("其它页面拒绝订阅源写入，编辑和删除拒绝未读取记录；无效 URL 不新增或发送成功事件", async () => {
  for (const [pathname, action] of [["/admin/overview", call("create_discovery_source", { source: { title: "源", feed_url: "https://example.com/new" } })],
    ["/admin/discovery", call("update_discovery_source", { source_id: "old", patch: { title: "wrong" } })],
    ["/admin/discovery", call("delete_discovery_source", { source_id: "old" })],
    ["/admin/discovery", call("create_discovery_source", { source: { title: "wrong", feed_url: "http://127.0.0.1/private" } })]]) {
    const { rows, ports } = fixture(), events = []; let step = 0, result;
    const agent = new XiaoxunAdminAgent({ ports, provider: { async complete(messages) {
      if (step++) { result = JSON.parse(messages.at(-1).content); return done; } return turn(action);
    } } });
    await agent.run(AdminAgentRunRequestModel(command(pathname)), event => events.push(event));
    assert.ok(result.error); assert.equal(rows.size, 1); assert.equal(rows.get("old").title, "旧源");
    assert.equal(events.some(event => event.type === "resource_changed"), false);
  }
});

test("读取后修改的记录在真实服务的写入点拒绝过期编辑和删除，既有 HTTP 调用不受影响", async () => {
  const { rows, ports, get, service } = fixture();
  const expected = get("old"); rows.get("old").title = "他人新修改";
  await assert.rejects(ports.update_source("old", { title: "覆盖" }, expected), /已变更/);
  await assert.rejects(ports.delete_source("old", expected), /已变更/);
  assert.equal(rows.get("old").title, "他人新修改");
  await service.update_discovery_source(new Request("https://internal/", { method: "PATCH", body: '{"title":"手动编辑"}' }), "old");
  assert.equal(rows.get("old").title, "手动编辑");
});

test("取消等待中的上下文请求后不执行后续写入；工具错误返回模型继续处理", async () => {
  const { rows, ports } = fixture(), controller = new AbortController(); let finish;
  ports.context = () => new Promise(resolve => { finish = resolve; });
  const agent = new XiaoxunAdminAgent({ ports, provider: { complete: async () => turn(call("get_admin_context"), call("delete_discovery_source", { source_id: "old" })) } });
  const pending = agent.run(AdminAgentRunRequestModel(command()), () => {}, controller.signal);
  await Promise.resolve(); controller.abort(new Error("切换页面")); finish({});
  await assert.rejects(pending, /切换页面/); assert.equal(rows.size, 1);
});
