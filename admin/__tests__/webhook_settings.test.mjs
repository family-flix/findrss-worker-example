import assert from "node:assert/strict";
import test from "node:test";
import { WebhookSettingsModel } from "../components/webhook_settings.model.js";

const ui = { ref(value) { return { value, set(next) { this.value = next; } }; } };
const settings = { url: "https://notify.example/api", token_configured: true, template: '{"text":"{{message}}"}' };

test("Webhook 设置加载和保存失败可重试，保留草稿，保存成功清除 Token 并可关闭推送", async () => {
  let fail_read = true, fail_save = true;
  const requests = [];
  const model = WebhookSettingsModel({ ui, request_json: async (url, options) => {
    requests.push({ url, options });
    if (!options && fail_read) throw new Error("读取失败");
    if (options?.method === "PUT" && fail_save) throw new Error("保存失败");
    const body = options && JSON.parse(options.body);
    return body ? { ...settings, url: body.url, template: body.template } : settings;
  } });
  await model.methods.save();
  assert.equal(requests.length, 0);
  await model.methods.start();
  assert.equal(model.state.error.value, "读取失败");
  fail_read = false;
  await model.methods.start();
  assert.equal(model.state.url.value, settings.url);
  assert.equal(model.state.token.value, "");
  model.methods.set_token("secret");
  model.methods.set_template('{"text":"{{error_text}}"}');
  await model.methods.save();
  assert.equal(model.state.error.value, "保存失败");
  assert.equal(model.state.token.value, "secret");
  fail_save = false;
  await model.methods.save();
  assert.equal(requests.at(-1).url, "/admin/api/settings/webhook");
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), {
    url: settings.url, token: "secret", template: '{"text":"{{error_text}}"}',
  });
  assert.equal(model.state.token.value, "");
  assert.match(model.state.message.value, /立即生效/);
  model.methods.set_url("");
  await model.methods.save();
  assert.equal(JSON.parse(requests.at(-1).options.body).token, "");
  assert.match(model.state.message.value, /已关闭/);
});

test("离开设置页清除 Token 和草稿、忽略迟到响应，返回时等待保存再读取", async () => {
  let finish_read, finish_save;
  const requests = [];
  const model = WebhookSettingsModel({ ui, request_json: (url, options) => {
    requests.push(options?.method || "GET");
    return new Promise(resolve => { if (options) finish_save = resolve; else finish_read = resolve; });
  } });
  const first = model.methods.start(); model.methods.leave();
  finish_read(settings); await first;
  assert.equal(model.state.loaded.value, false);
  assert.equal(model.state.url.value, "");
  const load = model.methods.start(); finish_read(settings); await load;
  model.methods.set_token("secret");
  const save = model.methods.save();
  await model.methods.save();
  assert.deepEqual(requests, ["GET", "GET", "PUT"]);
  model.methods.leave();
  assert.equal(model.state.token.value, "");
  assert.equal(model.state.template.value, "");
  const reload = model.methods.start();
  assert.equal(requests.length, 3);
  finish_save(settings); await save;
  await Promise.resolve();
  finish_read(settings); await reload;
  assert.equal(model.state.loaded.value, true);
  assert.equal(model.state.token.value, "");
  assert.equal(model.state.url.value, settings.url);
});
