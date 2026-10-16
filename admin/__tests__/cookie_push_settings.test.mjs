import assert from "node:assert/strict";
import test from "node:test";
import { CookiePushSettingsModel } from "../components/cookie_push_settings.model.js";

const ui = { ref(value) { return { value, set(next) { this.value = next; } }; } };

test("Cookie 解密设置加载失败可重试，保存失败保留草稿，保存成功清除密码，留空保留配置", async () => {
  let fail_read = true, fail_save = true;
  const requests = [];
  const model = CookiePushSettingsModel({ ui, request_json: async (url, options) => {
    requests.push({ url, options });
    if (!options && fail_read) throw new Error("读取失败");
    if (options?.method === "PUT" && fail_save) throw new Error("保存失败");
    return { uuid: "123", configured: true };
  } });
  await model.methods.save();
  assert.equal(requests.length, 0);
  await model.methods.start();
  assert.equal(model.state.error.value, "读取失败");
  assert.equal(model.state.loaded.value, false);
  fail_read = false;
  await model.methods.start();
  assert.equal(model.state.uuid.value, "123");
  assert.equal(model.state.password.value, "");
  model.methods.set_password("secret");
  await model.methods.save();
  assert.equal(model.state.error.value, "保存失败");
  assert.equal(model.state.password.value, "secret");
  fail_save = false;
  await model.methods.save();
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), { uuid: "123", password: "secret" });
  assert.equal(model.state.password.value, "");
  assert.match(model.state.message.value, /立即生效/);
  await model.methods.save();
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), { uuid: "123", password: "" });
  model.methods.set_password("discarded");
  model.methods.leave();
  assert.equal(model.state.password.value, "");
  assert.equal(model.state.uuid.value, "");
  assert.equal(model.state.loaded.value, false);
});

test("离开忽略迟到响应，返回页面等待进行中的保存完成后读取最新配置", async () => {
  let finish_read, finish_save;
  const requests = [];
  const model = CookiePushSettingsModel({ ui, request_json: (url, options) => {
    requests.push(options?.method || "GET");
    return new Promise(resolve => { if (options) finish_save = resolve; else finish_read = resolve; });
  } });
  const first = model.methods.start(); model.methods.leave();
  finish_read({ uuid: "stale", configured: true }); await first;
  assert.equal(model.state.uuid.value, "");
  const load = model.methods.start(); finish_read({ uuid: "123", configured: true }); await load;
  model.methods.set_password("secret");
  const save = model.methods.save();
  await model.methods.save();
  assert.deepEqual(requests, ["GET", "GET", "PUT"]);
  model.methods.leave();
  const reload = model.methods.start();
  assert.equal(requests.length, 3);
  finish_save({ uuid: "123", configured: true }); await save;
  await Promise.resolve();
  finish_read({ uuid: "123", configured: true }); await reload;
  assert.equal(model.state.password.value, "");
  assert.equal(model.state.loaded.value, true);
});
