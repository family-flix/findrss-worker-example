import assert from "node:assert/strict";
import test from "node:test";
import { OauthModel } from "../pages/oauth.model.js";
const ui = { ref(value) { return { value, set(next) { this.value = next; } }; } };
const authorization = { id: "request-one", scopes: ["discovery:create", "scripts:create"] };

test("独立授权仅请求申请内容，允许缩减权限，失败保留选项供重试", async () => {
  const requests = [], redirects = [];
  let fail = true;
  const model = OauthModel({ ui, request_id: () => authorization.id, redirect: url => redirects.push(url), request_json: async (url, options) => {
    requests.push({ url, options });
    if (!options) return { authorization };
    if (fail) throw new Error("授权失败");
    return { redirect_uri: "http://127.0.0.1/callback?code=opaque" };
  } });
  await model.methods.start(); assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/admin/api/mcp-oauth/requests/request-one");
  model.methods.set_scripts(false); model.methods.set_subscriptions(false);
  await model.methods.decide(true); assert.match(model.state.error.value, /至少/);
  model.methods.set_subscriptions(true); await model.methods.decide(true);
  assert.equal(model.state.error.value, "授权失败"); assert.equal(model.state.scripts.value, false);
  assert.deepEqual(redirects, []);
  fail = false; await model.methods.decide(true);
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), { approved: true, scopes: ["discovery:create"] });
  assert.deepEqual(redirects, ["http://127.0.0.1/callback?code=opaque"]);
  assert.equal(model.state.authorization.value, null);
});

test("拒绝授权无需选择权限，不能选择未申请的权限", async () => {
  let submitted, callback;
  const model = OauthModel({ ui, request_id: () => authorization.id, redirect: url => { callback = url; }, request_json: async (url, options) => {
    if (!options) return { authorization: { ...authorization, scopes: ["discovery:create"] } };
    submitted = JSON.parse(options.body); return { redirect_uri: "http://127.0.0.1/callback?error=access_denied" };
  } });
  await model.methods.start(); model.methods.set_scripts(true);
  assert.equal(model.state.scripts.value, false);
  model.methods.set_subscriptions(false); await model.methods.decide(false);
  assert.deepEqual(submitted, { approved: false, scopes: [] }); assert.match(callback, /access_denied/);
});

test("缺少申请和过期申请显示错误，不读取授权列表，不产生回调", async () => {
  let calls = 0;
  const missing = OauthModel({ ui, request_id: () => null, request_json: () => { calls++; } });
  await missing.methods.start(); assert.match(missing.state.error.value, /重新发起/); assert.equal(calls, 0);
  const expired = OauthModel({ ui, request_id: () => "old", request_json: async () => { throw new Error("申请已过期"); } });
  await expired.methods.start(); assert.equal(expired.state.error.value, "申请已过期"); assert.equal(expired.state.authorization.value, null);
});

test("重复点击仅提交一次，离开页面后忽略迟到的申请和回调", async () => {
  let complete, redirected = false, count = 0;
  const model = OauthModel({ ui, request_id: () => authorization.id, redirect: () => { redirected = true; }, request_json: async (url, options) => {
    if (!options) return { authorization };
    count++; return new Promise(resolve => { complete = resolve; });
  } });
  await model.methods.start();
  const pending = model.methods.decide(true); await model.methods.decide(true); assert.equal(count, 1);
  model.methods.leave(); complete({ redirect_uri: "http://127.0.0.1/callback?code=late" }); await pending;
  assert.equal(redirected, false); assert.equal(model.state.authorization.value, null);
  let read;
  const late = OauthModel({ ui, request_id: () => authorization.id, request_json: () => new Promise(resolve => { read = resolve; }) });
  const load = late.methods.start(); late.methods.leave(); read({ authorization }); await load;
  assert.equal(late.state.authorization.value, null);
});
