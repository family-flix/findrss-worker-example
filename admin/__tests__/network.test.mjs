import assert from "node:assert/strict";
import test from "node:test";
import { NetworkTestModel } from "../pages/network.model.js";

const ui = { ref: value => ({ value, as(next) { this.value = next; } }) };

test("网络测试只调用后台接口，可编辑网址、超时和请求头，保留 HTTP 错误响应", async () => {
  let finish;
  const calls = [];
  const model = NetworkTestModel({ ui, fetch_impl: (url, options) => {
    calls.push({ url, options });
    return new Promise(resolve => { finish = resolve; });
  } });
  model.methods.set("url", "https://example.com/path");
  model.methods.set("timeout", "60");
  model.methods.set("headers", '{"User-Agent":"my-agent"}');
  const pending = model.methods.run();
  assert.equal(model.state.busy.value, true);
  await model.methods.run();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/admin/api/network-test");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    url: "https://example.com/path", timeout_ms: 60000, headers: { "User-Agent": "my-agent" },
  });
  finish(Response.json({ status: 403, body: "WAF 拦截", error: "" }));
  await pending;
  assert.equal(model.state.result.value.status, 403);
  assert.equal(model.state.result.value.body, "WAF 拦截");
  assert.equal(model.state.error.value, "");
  assert.equal(model.state.busy.value, false);
});

test("输入无效不提交；后端校验错误和带诊断的超时均可展示和重试", async () => {
  let calls = 0;
  const model = NetworkTestModel({ ui, fetch_impl: async () => {
    calls++;
    return calls === 1 ? Response.json({ error: "地址被拒绝" }, { status: 400 })
      : Response.json({ status: null, requests: [], error: "请求超时", code: "UPSTREAM_TIMEOUT" });
  } });
  for (const [key, invalid] of [["url", "file:///etc/passwd"], ["timeout", "61"], ["headers", "[1]"], ["headers", '{"Accept":1}']]) {
    const original = model.state[key].value;
    model.methods.set(key, invalid);
    await model.methods.run();
    assert.ok(model.state.error.value);
    model.methods.set(key, original);
  }
  assert.equal(calls, 0);
  await model.methods.run();
  assert.equal(model.state.error.value, "地址被拒绝");
  assert.equal(model.state.busy.value, false);
  await model.methods.run();
  assert.equal(model.state.error.value, "请求超时");
  assert.equal(model.state.result.value.code, "UPSTREAM_TIMEOUT");
});

test("离开页面取消浏览器请求并忽略迟到结果，返回后可以再次测试", async () => {
  const calls = [];
  const model = NetworkTestModel({ ui, fetch_impl: (_, options) => new Promise(resolve => calls.push({ options, resolve })) });
  const first = model.methods.run();
  model.methods.leave();
  assert.equal(calls[0].options.signal.aborted, true);
  const second = model.methods.run();
  calls[0].resolve(Response.json({ status: 200, body: "旧响应" }));
  await first;
  assert.equal(model.state.busy.value, true);
  assert.equal(model.state.result.value, null);
  calls[1].resolve(Response.json({ status: 200, body: "新响应" }));
  await second;
  assert.equal(model.state.result.value.body, "新响应");
  assert.equal(model.state.busy.value, false);
});
