import assert from "node:assert/strict";
import test from "node:test";
import { SettingsModel } from "../pages/settings/models.model.js";

function ref(value) {
  const listeners = new Set();
  return { value,
    set(next) { this.value = next; for (const listener of listeners) listener.onChange(next); },
    as(next) { this.set(next); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
const ui = { ref };
const provider = { id: "custom", name: "Custom", type: "openai_compat", enabled: true,
  base_url: "https://models.example/v1", api_key_secret_name: "",
  models: [{ id: "model", name: "Model", model: "m", enabled: true, options: {} }] };

test("设置页与助手读写相同配置，临时密钥可测试，保存失败后可重试且成功后清除", async t => {
  const requests = [];
  let fail_save = true;
  const model = SettingsModel({ ui, request_json: async (url, options) => {
    requests.push({ url, method: options?.method || "GET", body: options?.body && JSON.parse(options.body) });
    if (url.endsWith("/test")) return { model: "m", elapsed_ms: 1 };
    if (options?.method === "PUT" && fail_save) throw new Error("保存失败");
    return { providers: [provider], configured: true };
  } });
  t.after(model.methods.destroy);
  await model.methods.start();
  assert.equal(model.state.loaded.value, true);
  model.store.methods.set_ai_key("custom", "temporary-key");
  await model.store.methods.test_ai_provider(provider, "model");
  assert.equal(requests.at(-1).url, "/admin/api/scripts/agent/test");
  assert.equal(requests.at(-1).body.api_key, "temporary-key");
  await model.store.methods.save_settings();
  assert.equal(model.store.state.settings_error.value, "保存失败");
  fail_save = false;
  await model.store.methods.save_settings();
  assert.equal(requests.at(-1).url, "/admin/api/scripts/agent/settings");
  assert.equal(requests.at(-1).body.ai_keys.custom, "temporary-key");
  assert.match(model.store.state.settings_message.value, /已保存/);
  await model.store.methods.save_settings();
  assert.deepEqual(requests.at(-1).body.ai_keys, {});
  assert.doesNotMatch(JSON.stringify(model.state.settings.value), /temporary-key/);
});

test("配置读取失败或加载中不能保存，重试成功后才允许编辑保存", async t => {
  const requests = [];
  let fail_read = true, finish;
  const model = SettingsModel({ ui, request_json: (url, options) => {
    requests.push({ url, options });
    if (fail_read) return Promise.reject(new Error("读取失败"));
    return new Promise(resolve => { finish = resolve; });
  } });
  t.after(model.methods.destroy);
  await model.store.methods.save_settings();
  assert.equal(requests.length, 0);
  await model.methods.start();
  assert.equal(model.state.error.value, "读取失败");
  assert.equal(model.state.loaded.value, false);
  await model.store.methods.save_settings();
  assert.equal(requests.length, 1);
  fail_read = false;
  const pending = model.methods.start();
  assert.equal(model.state.loading.value, true);
  await model.store.methods.save_settings();
  assert.equal(requests.length, 2);
  finish({ providers: [provider] }); await pending;
  assert.equal(model.state.error.value, "");
  assert.equal(model.state.loaded.value, true);
});

test("离开缓存页面忽略迟到响应，清除未保存草稿和密钥，返回重新加载配置", async t => {
  let finish, latest = provider;
  const writes = [];
  const model = SettingsModel({ ui, request_json: (url, options) => {
    if (options?.method === "PUT") {
      writes.push(JSON.parse(options.body));
      return Promise.resolve({ providers: [latest] });
    }
    return new Promise(resolve => { finish = resolve; });
  } });
  t.after(model.methods.destroy);
  const pending = model.methods.start(); model.methods.leave();
  finish({ providers: [provider] }); await pending;
  assert.equal(model.state.loaded.value, false);
  assert.deepEqual(model.state.settings.value.providers, []);
  const next = model.methods.start(); finish({ providers: [provider] }); await next;
  model.store.methods.update_ai_entry("provider", "custom", { name: "未保存" });
  model.store.methods.set_ai_key("custom", "discarded-key");
  model.methods.leave();
  latest = { ...provider, name: "助手中保存的厂商" };
  const reopened = model.methods.start(); finish({ providers: [latest] }); await reopened;
  assert.equal(model.store.state.settings_draft.value.ai_providers[0].name, latest.name);
  await model.store.methods.save_settings();
  assert.deepEqual(writes[0].ai_keys, {});
  assert.equal(writes[0].providers[0].name, latest.name);
});
