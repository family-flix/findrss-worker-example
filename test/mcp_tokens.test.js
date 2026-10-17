import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { register } from "node:module";
import { API_SCHEMA_SQL } from "../server/repository/schema.js";
import { RepositoryMcpToken } from "../server/repository/mcp_token.js";
import { McpTokenModel } from "../server/domain/mcp_token.js";
import { ServiceMcpToken } from "../server/service/durable_object/mcp_tokens.js";
import { do_error, do_result } from "../server/service/durable_object/error.js";
import worker from "../api.js";
import { create_worker } from "../router.js";
import { reader_identity } from "../server/service/worker/session.js";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { route } = await import("../durable_object_router.js");
const origin = "https://api.example", resource = origin + "/mcp";
const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

function fixture(t) {
  const db = new DatabaseSync(":memory:"); db.exec(API_SCHEMA_SQL); t.after(() => db.close());
  const sql = { exec(text, ...args) {
    const statement = db.prepare(text);
    if (/^(SELECT|PRAGMA)/.test(text.trim())) return { toArray: () => statement.all(...args) };
    statement.run(...args); return { toArray: () => [] };
  } };
  const repo = new RepositoryMcpToken({ sql }), calls = [];
  const app = {
    scripts: { async create_script(request) {
      calls.push({ url: request.url, headers: request.headers, body: await request.json() });
      return do_result({ script: { id: "script-1" } }, 201);
    } },
    discovery: { async create_discovery_source(request) {
      const body = await request.json(); calls.push({ url: request.url, headers: request.headers, body });
      if (body.title === "duplicate") throw do_error("source already exists", 409);
      return do_result({ source: { id: "source-1", ...body } }, 201);
    } },
  };
  app.mcp_tokens = new ServiceMcpToken({ repo, app, load_profile: async source => ({ defaults: { title: source.title, description: source.description || "", website: source.website || "" } }) });
  const forwarded = [];
  const env = { ADMIN_PASSWORD: "test-admin", API: { getByName: () => ({ fetch(input) {
    forwarded.push(input); return route(input, app);
  } }) } };
  const admin = (path = "", method = "GET", body, extra = {}) => worker.fetch(new Request(origin + "/admin/api/mcp-tokens" + path, {
    method, headers: { "Content-Type": "application/json", Authorization: "Bearer test-admin", ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env);
  const create = async (body = { name: "my agent" }) => {
    return (await app.mcp_tokens.create(body, resource)).data;
  };
  const mcp = (token, method = "tools/list", params = {}, extra = {}, url = resource) => worker.fetch(new Request(url, {
    method: "POST", headers: { ...headers, ...(token ? { Authorization: "Bearer " + token } : {}), ...extra },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }), env);
  return { db, repo, app, env, forwarded, calls, admin, create, mcp };
}

test("兼容已有 MCP Token 的摘要与权限管理，停止手动签发接口", async t => {
  const f = fixture(t);
  assert.equal((await f.admin("", "POST", { name: "my agent" })).status, 405);
  const { token, mcp_token } = await f.create();
  assert.match(token, /^fr_mcp_[0-9a-f]{64}$/);
  assert.deepEqual(mcp_token.scopes, ["discovery:create"]);
  assert.equal(mcp_token.resource, resource);
  assert.equal(mcp_token.expires_at - mcp_token.created_at, 7 * 86400000);
  const row = f.repo.find(mcp_token.id);
  assert.match(row.token_hash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(row).includes(token), false);
  const list = await (await f.admin()).json();
  assert.equal(list.resource, resource); assert.equal(list.mcp_tokens.length, 1);
  assert.equal(JSON.stringify(list).includes(token), false);
  assert.equal(JSON.stringify(list).includes(row.token_hash), false);
  assert.equal((await f.admin("/" + mcp_token.id + "/reveal", "POST")).status, 404);
});

test("拒绝 Admin 密码、Basic、读者/设备凭证、query token 和伪造内部身份", async t => {
  const f = fixture(t), { token } = await f.create();
  for (const credential of [undefined, "test-admin", "reader-token", "frd_" + "a".repeat(64), "fr_mcp_" + "b".repeat(64)]) {
    const response = await f.mcp(credential);
    assert.equal(response.status, 401); assert.match(response.headers.get("WWW-Authenticate"), /^Bearer/);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  assert.equal((await f.mcp(null, "tools/list", {}, { Authorization: "Basic " + btoa("admin:test-admin") })).status, 401);
  assert.equal((await f.mcp(null, "tools/list", {}, { "X-FindRSS-Token": token, "X-Api-MCP-Token-ID": "forged" }, resource + "?token=" + token)).status, 401);
  assert.equal((await f.admin("", "GET", undefined, { Authorization: "Bearer " + token })).status, 401);
  assert.equal(await reader_identity(f.env, token), null);
  const public_worker = create_worker({ api: worker, admin: () => new Response(), discovery: () => new Response(null, { status: 404 }) });
  for (const path of ["/_mcp", "/_internal/mcp", "/_admin/mcp-tokens"]) {
    assert.equal((await public_worker.fetch(new Request(origin + path, { headers: { Authorization: "Bearer " + token } }), f.env)).status, 404);
  }
  assert.equal(f.calls.length, 0);
});

test("MCP 每次请求验证 token，按权限列出工具并阻止直接越权调用", async t => {
  const f = fixture(t), { token, mcp_token } = await f.create();
  const tools = await (await f.mcp(token)).json();
  assert.deepEqual(tools.result.tools.map(tool => tool.name), ["add_subscription"]);
  const denied = await f.mcp(token, "tools/call", { name: "add_script", arguments: { script: "secret script" } });
  assert.equal(denied.status, 403); assert.match(denied.headers.get("WWW-Authenticate"), /scripts:create/);
  assert.equal(f.calls.length, 0);
  const args = { title: "Feed", feed_url: "{{hostname}}/rss/sample", category: "technology", require_token: true };
  const response = await (await f.mcp(token, "tools/call", { name: "add_subscription", arguments: args }, { "X-MCP-Resource": "forged", "X-Feed-Public-URL": "https://evil" })).json();
  assert.equal(response.result.isError, false);
  const source = JSON.parse(response.result.content[0].text).source;
  assert.equal(source.feed_url, origin + "/rss/sample"); assert.equal(source.feed_url_template, args.feed_url);
  assert.deepEqual(f.calls[0].body, { ...args, description: "", website: "" }); assert.equal(f.calls[0].headers.get("X-Feed-Public-URL"), origin);
  assert.ok(f.repo.find(mcp_token.id).last_used_at);
  const audit = await (await f.admin("/" + mcp_token.id + "/calls")).json();
  assert.deepEqual(audit.calls.map(call => call.status), ["success", "denied"]);
  assert.equal(JSON.stringify(audit).includes("secret script"), false);
  assert.equal(JSON.stringify(audit).includes(token), false);
  const business = await (await f.mcp(token, "tools/call", { name: "add_subscription", arguments: { ...args, title: "duplicate" } })).json();
  assert.equal(business.result.isError, true);
  assert.equal(JSON.parse(business.result.content[0].text).error, "source already exists");
  assert.equal(f.repo.calls(mcp_token.id)[0].status, "error");
});

test("脚本授权可单独创建，协议和参数检查保留，通知不执行写操作", async t => {
  const f = fixture(t), { token } = await f.create({ name: "script agent", scopes: ["scripts:create"] });
  assert.deepEqual((await (await f.mcp(token)).json()).result.tools.map(tool => tool.name), ["add_script"]);
  const initialized = await (await f.mcp(token, "initialize", { protocolVersion: "2025-11-25" })).json();
  assert.equal(initialized.result.serverInfo.name, "findrss-api");
  const bad = await (await f.mcp(token, "tools/call", { name: "add_script", arguments: {} })).json();
  assert.equal(bad.error.code, -32602); assert.equal(f.calls.length, 0);
  const result = await (await f.mcp(token, "tools/call", { name: "add_script", arguments: { script: "export const route = {};" } })).json();
  assert.equal(result.result.isError, false); assert.ok(f.calls[0].url.endsWith("/_admin/scripts"));
  const notification = new Request(resource, { method: "POST", headers: { ...headers, Authorization: "Bearer " + token },
    body: JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name: "add_script", arguments: { script: "must not execute" } } }) });
  assert.equal((await worker.fetch(notification, f.env)).status, 202); assert.equal(f.calls.length, 1);
  assert.equal((await f.mcp(token, "ping", {}, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await f.mcp(token, "ping", {}, { Origin: origin })).status, 200);
  assert.equal((await f.mcp(token, "ping", {}, { "MCP-Protocol-Version": "bad" })).status, 400);
  assert.equal((await f.mcp(token, "ping", {}, { Accept: "application/json" })).status, 406);
});

test("到期和撤销立即作用于已有连接，轮换及修改 Admin 密码不影响其他授权", async t => {
  const f = fixture(t), first = await f.create(), second = await f.create();
  assert.notEqual(first.token, second.token);
  const model = McpTokenModel(f.repo.find(first.mcp_token.id));
  assert.equal(model.is_active_at(first.mcp_token.expires_at - 1), true);
  assert.equal(model.is_active_at(first.mcp_token.expires_at), false);
  assert.equal((await f.admin("/" + first.mcp_token.id + "/revoke", "POST")).status, 200);
  const revoked_at = f.repo.find(first.mcp_token.id).revoked_at;
  assert.equal((await f.admin("/" + first.mcp_token.id + "/revoke", "POST")).status, 200);
  assert.equal(f.repo.find(first.mcp_token.id).revoked_at, revoked_at);
  for (const method of ["initialize", "ping", "tools/list", "tools/call"]) assert.equal((await f.mcp(first.token, method)).status, 401);
  f.env.ADMIN_PASSWORD = "rotated";
  assert.equal((await f.mcp(second.token)).status, 200);
  f.db.prepare("UPDATE mcp_tokens SET expires_at = ? WHERE id = ?").run(Date.now(), second.mcp_token.id);
  assert.equal((await f.mcp(second.token)).status, 401);
  assert.equal(f.calls.length, 0);
});

test("资源绑定拒绝跨域复用，数据库故障拒绝执行，读取正文期间撤销也生效", async t => {
  const f = fixture(t), { token, mcp_token } = await f.create();
  assert.equal((await f.mcp(token, "tools/list", {}, { "X-MCP-Resource": resource }, "https://other.example/mcp")).status, 401);
  const authorize = f.app.mcp_tokens.authorize.bind(f.app.mcp_tokens);
  f.app.mcp_tokens.authorize = (...args) => { f.repo.revoke(mcp_token.id, Date.now()); return authorize(...args); };
  assert.equal((await f.mcp(token)).status, 401);
  const { token: next } = await f.create();
  f.repo.find_by_hash = () => { throw new Error("database unavailable with secret details"); };
  const response = await f.mcp(next);
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /secret details/);
  assert.equal(f.calls.length, 0);
});

test("授权管理校验参数、字节数、方法、记录上限，审计记录有界", async t => {
  const f = fixture(t);
  for (const body of [null, [], {}, { name: " " }, { name: "a".repeat(81) }, { name: "n", scopes: [] },
    { name: "n", scopes: "scripts:create" }, { name: "n", scopes: ["admin"] }, { name: "n", scopes: ["scripts:create", "scripts:create"] },
    ...[null, 0, 59, 7776001, "3600", [3600], 1.5].map(expires_in_seconds => ({ name: "n", expires_in_seconds })),
    { name: "n", resource: "https://evil/mcp" }]) {
    await assert.rejects(f.app.mcp_tokens.create(body, resource), { status: 400 });
  }
  assert.equal((await f.admin("", "DELETE")).status, 405);
  assert.equal((await f.admin("/missing/revoke", "POST")).status, 404);
  const created = await f.create({ name: "both", scopes: ["discovery:create", "scripts:create"], expires_in_seconds: 90 * 86400 });
  assert.equal((await (await f.mcp(created.token)).json()).result.tools.length, 2);
  const service = new ServiceMcpToken({ repo: { count_active: () => McpTokenModel.MAX_TOKENS } });
  await assert.rejects(service.create({ name: "full" }, resource), { status: 409 });
  for (let i = 0; i < 1005; i++) f.repo.record_call(created.mcp_token.id, "add_subscription", "success", Date.now());
  assert.equal(f.db.prepare("SELECT COUNT(*) AS count FROM mcp_calls").get().count, 1000);
  assert.equal(f.repo.calls(created.mcp_token.id).length, 50);
});

test("历史过期记录不会挤掉仍需管理的有效授权", async t => {
  const f = fixture(t), { mcp_token } = await f.create(), now = Date.now();
  f.db.prepare("UPDATE mcp_tokens SET created_at = ? WHERE id = ?").run(now - 3 * 86400000, mcp_token.id);
  for (let i = 0; i < 205; i++) f.repo.insert({ id: "expired-" + i, name: "old agent", token_hash: String(i).padStart(64, "0"),
    token_hint: "masked", scopes_json: '["discovery:create"]', resource, created_at: now - 2 * 86400000, expires_at: now - 86400000 });
  const list = await (await f.admin()).json();
  assert.equal(list.mcp_tokens.length, 200); assert.equal(list.mcp_tokens[0].id, mcp_token.id);
  assert.equal(list.mcp_tokens[0].status, "active");
});

test("MCP 添加读取真实名称简介和头像，保存模板，不需要占位名称", async t => {
  const f = fixture(t), { token } = await f.create();
  const args = { feed_url: "{{hostname}}/rss/wxchannels/finder", category: "life", source_type: "wxchannels" };
  const avatar = Uint8Array.from([137, 80, 78, 71]);
  const uploads = [];
  f.app.mcp_tokens.load_profile = async (source, public_origin) => {
    assert.equal(source.feed_url, args.feed_url); assert.equal(source.require_token, true); assert.equal(public_origin, origin);
    return { defaults: { title: "真实作者", description: "真实简介", website: "https://channels.weixin.qq.com/", tags: ["视频"] },
      avatar: { data: Buffer.from(avatar).toString("base64"), content_type: "image/png" } };
  };
  f.app.discovery.put_discovery_avatar = async (request, id) => {
    uploads.push({ id, bytes: new Uint8Array(await request.arrayBuffer()) });
    return { source: { id, avatar_url: "/api/avatar/" + id + "?v=1" } };
  };
  const response = await (await f.mcp(token, "tools/call", { name: "add_subscription", arguments: args })).json();
  assert.equal(response.result.isError, false);
  const source = JSON.parse(response.result.content[0].text).source;
  assert.equal(source.title, "真实作者"); assert.equal(source.description, "真实简介");
  assert.equal(source.feed_url_template, args.feed_url); assert.match(source.avatar_url, /^\/api\/avatar\//);
  assert.deepEqual(f.calls[0].body, { ...args, title: "真实作者", description: "真实简介", website: "https://channels.weixin.qq.com/", tags: ["视频"] });
  assert.equal(uploads.length, 1); assert.deepEqual(uploads[0].bytes, avatar);
});

test("读取源信息失败或缺少真实名称时不创建占位订阅，读取期间撤销也禁止写入", async t => {
  const args = { feed_url: "{{hostname}}/rss/wxchannels/finder", title: "占位名称", category: "life" };
  for (const mode of ["failed", "blank", "revoked"]) {
    const f = fixture(t), { token, mcp_token } = await f.create();
    f.app.mcp_tokens.load_profile = async () => {
      if (mode === "failed") throw new Error("设备离线");
      if (mode === "revoked") f.repo.revoke(mcp_token.id, Date.now());
      return { defaults: { title: mode === "blank" ? " " : "真实名称", description: "简介" } };
    };
    const result = await (await f.mcp(token, "tools/call", { name: "add_subscription", arguments: args })).json();
    assert.equal(result.result.isError, true); assert.equal(f.calls.length, 0);
    assert.doesNotMatch(result.result.content[0].text, /占位名称/);
    if (mode === "failed") assert.match(result.result.content[0].text, /设备离线/);
  }
});

test("MCP 头像保存失败明确报告已创建的源，避免误报完整成功", async t => {
  const f = fixture(t), { token } = await f.create();
  f.app.mcp_tokens.load_profile = async () => ({ defaults: { title: "真实名称", description: "简介" }, avatar: { data: "iVBORw==" } });
  f.app.discovery.put_discovery_avatar = async () => { throw new Error("对象存储不可用"); };
  const result = await (await f.mcp(token, "tools/call", { name: "add_subscription", arguments: { feed_url: "{{hostname}}/rss/wxchannels/finder", category: "life" } })).json();
  assert.equal(result.result.isError, true);
  const failure = JSON.parse(result.result.content[0].text);
  assert.match(failure.error, /订阅已创建，但头像保存失败/); assert.equal(failure.source.id, "source-1");
  assert.equal(f.repo.calls(f.repo.list(Date.now())[0].id)[0].status, "error");
});
