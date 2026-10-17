import assert from "node:assert/strict";
import test from "node:test";
import { McpTokensModel } from "../pages/settings/mcp-tokens.model.js";
const ui = { ref(value) { return { value, set(next) { this.value = next; } }; } };
const token = { id: "one", name: "agent", scopes: ["discovery:create"], status: "active", resource: "https://example.com/mcp" };
const list = { resource: token.resource, mcp_tokens: [token] };

test("list and revocation retry safely; leaving clears consent and ignores late responses", async () => {
  let fail_read = true, fail_revoke = true;
  const requests = [];
  const model = McpTokensModel({ ui, request_json: async (url, options) => {
    requests.push({ url, options });
    if (!options && fail_read) throw new Error("读取失败");
    if (url.endsWith("/revoke")) {
      if (fail_revoke) throw new Error("撤销失败");
      return { mcp_token: { ...token, status: "revoked" } };
    }
    return list;
  } });
  await model.methods.start(); assert.equal(model.state.error.value, "读取失败");
  fail_read = false; await model.methods.start();
  model.methods.request_revoke(token); model.methods.cancel_revoke(); assert.equal(requests.length, 2);
  model.methods.request_revoke(token); await model.methods.confirm_revoke();
  assert.equal(model.state.error.value, "撤销失败"); assert.equal(model.state.tokens.value[0].status, "active");
  fail_revoke = false; await model.methods.confirm_revoke();
  assert.equal(model.state.tokens.value[0].status, "revoked"); assert.equal(model.state.revoke_target.value, null);
  let read;
  const late = McpTokensModel({ ui, request_json: () => new Promise(resolve => { read = resolve; }) });
  const pending = late.methods.start(); late.methods.leave(); read(list); await pending;
  assert.equal(late.state.loaded.value, false); assert.deepEqual(late.state.tokens.value, []);
});
