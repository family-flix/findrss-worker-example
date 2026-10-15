import assert from "node:assert/strict";
import test from "node:test";
import { handle_mcp } from "../server/lib/mcp.js";
import worker from "../api.js";
const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
const request = (method, params = {}, extra = {}) => new Request("https://api.example/mcp", { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
const config = { name: "test", tools: [], call: () => { throw Error("unexpected"); } };
test("MCP initialize, discovery, ping and invalid method", async () => {
  const initialized = await (await handle_mcp(request("initialize", { protocolVersion: "2025-11-25" }), config)).json();
  assert.equal(initialized.result.protocolVersion, "2025-11-25");
  assert.deepEqual((await (await handle_mcp(request("ping"), config)).json()).result, {});
  assert.deepEqual((await (await handle_mcp(request("tools/list"), config)).json()).result.tools, []);
  assert.equal((await (await handle_mcp(request("bad"), config)).json()).error.code, -32601);
});
test("MCP transport guards and notifications never execute tools", async () => {
  assert.equal((await handle_mcp(request("ping", {}, { Origin: "https://evil.example" }), config)).status, 403);
  assert.equal((await handle_mcp(request("ping", {}, { "MCP-Protocol-Version": "bad" }), config)).status, 400);
  assert.equal((await handle_mcp(request("ping", {}, { Accept: "application/json" }), config)).status, 406);
  assert.equal((await handle_mcp(new Request("https://api.example/mcp"), config)).status, 405);
  const notification = new Request("https://api.example/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  const response = await handle_mcp(notification, config);
  assert.equal(response.status, 202);
  assert.equal(await response.text(), "");
  assert.equal((await handle_mcp(new Request("https://api.example/mcp", { method: "POST", headers, body: "{" }), config)).status, 400);
});
test("API MCP requires admin and routes additions through existing handlers", async () => {
  const calls = [];
  const env = { ADMIN_PASSWORD: "test-admin", API: { getByName: () => ({ fetch: async (req) => {
    calls.push({ url: req.url, body: await req.json() });
    return Response.json({ script: { id: "script-1" } });
  } }) } };
  assert.equal((await worker.fetch(request("tools/list"), env)).status, 401);
  const auth = { Authorization: "Bearer test-admin" };
  const tools = await (await worker.fetch(request("tools/list", {}, auth), env)).json();
  assert.deepEqual(tools.result.tools.map((tool) => tool.name), ["add_subscription", "add_script"]);
  const bad = await (await worker.fetch(request("tools/call", { name: "add_script", arguments: {} }, auth), env)).json();
  assert.equal(bad.error.code, -32602);
  assert.equal(calls.length, 0);
  const result = await (await worker.fetch(request("tools/call", { name: "add_script", arguments: { script: "export const route = {};" } }, auth), env)).json();
  assert.equal(result.result.isError, false);
  assert.ok(calls[0].url.endsWith("/_admin/scripts"));
  assert.equal(calls[0].body.script, "export const route = {};");
});
test("API source creation forwards directory fields and exposes business errors", async () => {
  const calls = [];
  const env = { ADMIN_PASSWORD: "test-admin", API: { getByName: () => ({ fetch: async (req) => {
    calls.push({ url: req.url, body: await req.json() });
    return Response.json({ error: "source already exists" }, { status: 409 });
  } }) } };
  const params = { name: "add_subscription", arguments: { title: "Feed", feed_url: "https://example.com/rss.xml", category: "technology", require_token: true } };
  const auth = { Authorization: "Bearer test-admin" };
  const response = await (await worker.fetch(request("tools/call", params, auth), env)).json();
  assert.equal(response.result.isError, true);
  assert.equal(JSON.parse(response.result.content[0].text).error, "source already exists");
  assert.ok(calls[0].url.endsWith("/_admin/discovery/sources"));
  assert.deepEqual(calls[0].body, params.arguments);
  params.arguments.category = "invalid";
  assert.equal((await (await worker.fetch(request("tools/call", params, auth), env)).json()).error.code, -32602);
  assert.equal(calls.length, 1);
});
