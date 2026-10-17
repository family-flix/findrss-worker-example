import assert from "node:assert/strict";
import test from "node:test";
import { handle_mcp } from "../server/lib/mcp.js";
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
