import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { RssRouteCache } from "../server/infra/rss_cache.js";
import { ScriptModel } from "../server/domain/script.js";
import { sha256_hex } from "../server/lib/crypto.js";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { ServiceScript } = await import("../server/service/durable_object/scripts.js");
const { route } = await import("../durable_object_router.js");
const source = `export const routes = ["/publication-test", "/publication-test/extra"].map(path => ({
  path, name: "发布测试", url: "https://example.com/", maintainers: [], example: path, parameters: {}, description: "",
  handler() { return { title: "发布测试", items: [] }; }
}));`;
const edit = body => new Request("https://internal/_admin/scripts", { method: "POST", body: JSON.stringify(body) });

function setup() {
  const rows = [];
  const cache = new RssRouteCache(60000, 100);
  const service = new ServiceScript({ repo: {
    scripts: { list: () => rows, list_enabled: () => rows.filter(row => row.enabled && row.path), count: () => rows.length,
      find: id => rows.find(row => row.route === id), find_config: id => rows.find(row => row.route === id),
      insert: row => rows.push(row), update: value => Object.assign(rows.find(row => row.route === value.route), value) },
    rss_cookies: { get: () => [] },
  }, ports: { route_cache: cache }, app: {} });
  service.record_log = () => {};
  service.rss_address_is_public = () => false;
  const serve = pathname => route(new Request("https://internal/_public/feed/rss" + pathname, {
    headers: { "X-Api-Access-Token-ID": "test-user" },
  }), { scripts: service });
  return { rows, cache, service, serve };
}

test("正式发布必填三段递增版本，绑定源码哈希，草稿保留上次正式版本", async () => {
  const { service, rows } = setup();
  await assert.rejects(service.create_script(edit({ script: source })), error => error.status === 400 && /版本号/.test(error.error));
  for (const version of ["1", "1.0", "01.0.0", "1.0.0-beta", null]) {
    await assert.rejects(service.create_script(edit({ script: source, version })), error => error.status === 400);
  }
  const draft = (await service.create_script(edit({ script: source, status: "draft" }))).data.script;
  assert.equal(draft.version, "");
  assert.equal(draft.script_hash, await sha256_hex(source));
  const id = draft.id;
  await assert.rejects(service.update_script(edit({ status: "published" }), id), error => error.status === 400);
  const first = (await service.update_script(edit({ status: "published", version: "1.9.0" }), id)).script;
  assert.equal(first.version, "1.9.0");
  assert.equal(first.published_version, "1.9.0");
  assert.equal(first.script_hash, await sha256_hex(source));
  const original = { ...rows[0] };
  for (const version of ["1.9.0", "1.8.99", "0.99.99"]) {
    await assert.rejects(service.update_script(edit({ status: "published", version }), id), error => error.status === 409);
    assert.deepEqual(rows[0], original);
  }
  await assert.rejects(service.update_script(edit({ script: source + "\n" }), id), error => error.status === 400);
  assert.deepEqual(rows[0], original);
  const toggled = (await service.update_script(edit({ enabled: false, debug: true }), id)).script;
  assert.equal(toggled.version, "1.9.0");
  assert.equal(toggled.published_version, "1.9.0");
  const next = (await service.update_script(edit({ script: source + "\n", version: "1.10.0" }), id)).script;
  assert.equal(next.version, "1.10.0");
  assert.equal(next.script_hash, await sha256_hex(source + "\n"));
  await service.update_script(edit({ status: "draft", script: source, version: "" }), id);
  assert.equal((await service.list_scripts()).scripts[0].published_version, "1.10.0");
  await assert.rejects(service.update_script(edit({ status: "published", version: "1.9.9" }), id), error => error.status === 409);
  assert.equal(rows[0].path, "");
  const restored = (await service.update_script(edit({ status: "published", version: "2.0.0" }), id)).script;
  assert.equal(restored.published_version, "2.0.0");
});

test("旧脚本无编号时仍可启停，下一次正式发布需指定版本号", async () => {
  const { service, rows } = setup();
  const id = (await service.create_script(edit({ script: source, version: "1.0.0" }))).data.script.id;
  const metadata = JSON.parse(rows[0].metadata_json);
  delete metadata.version;
  delete metadata.published_version;
  delete metadata.script_hash;
  rows[0].metadata_json = JSON.stringify(metadata);
  assert.equal((await service.list_scripts()).scripts[0].version, "");
  assert.equal((await service.update_script(edit({ enabled: false }), id)).script.version, "");
  await assert.rejects(service.update_script(edit({ status: "published" }), id), error => error.status === 400);
  assert.equal((await service.update_script(edit({ status: "published", version: "1.0.0" }), id)).script.version, "1.0.0");
});

test("并发发布同一版本只有一次成功，不覆盖已经提交的版本", async () => {
  const { service, rows } = setup();
  const id = (await service.create_script(edit({ script: source, version: "1.0.0" }))).data.script.id;
  const results = await Promise.allSettled([
    service.update_script(edit({ status: "published", version: "1.0.1", script: source + "\n// A" }), id),
    service.update_script(edit({ status: "published", version: "1.0.1", script: source + "\n// B" }), id),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.status, 409);
  assert.equal((await service.list_scripts()).scripts[0].version, "1.0.1");
  assert.equal((await service.list_scripts()).scripts[0].script_hash, await sha256_hex(rows[0].script));
});

test("草稿可保存不完整代码；发布需校验，正式路由和缓存退回后立即撤下", async () => {
  const { rows, cache, service, serve } = setup();
  const created = await service.create_script(edit({ script: "export const route = {", status: "draft" }));
  const id = created.data.script.id;
  assert.equal(created.data.script.status, "draft");
  assert.equal(rows[0].path, "");
  assert.equal(ScriptModel.fromRow(rows[0]).is_servable(), false);
  const original = { ...rows[0] };
  await assert.rejects(service.update_script(edit({ status: "published" }), id), error => error.status === 400);
  assert.deepEqual(rows[0], original);
  await service.update_script(edit({ script: source }), id);
  assert.equal((await service.list_scripts()).scripts[0].status, "draft");
  assert.equal((await serve("/publication-test")).status, 404);
  assert.equal((await serve("/publication-test/extra")).status, 404);
  const published = await service.update_script(edit({ status: "published", version: "1.0.0" }), id);
  assert.equal(published.script.status, "published");
  assert.equal(rows[0].path, "/publication-test");
  for (const path of ["/publication-test", "/publication-test/extra"]) assert.equal((await serve(path)).status, 200);
  assert.equal(cache.stats().entries, 2);
  await service.update_script(edit({ status: "draft" }), id);
  assert.equal(rows[0].script, source);
  assert.equal(cache.stats().entries, 0);
  for (const path of ["/publication-test", "/publication-test/extra"]) assert.equal((await serve(path)).status, 404);
  await service.update_script(edit({ enabled: false }), id);
  await service.update_script(edit({ status: "published", version: "1.0.1" }), id);
  assert.equal((await serve("/publication-test")).status, 404);
  await service.update_script(edit({ enabled: true }), id);
  assert.equal((await serve("/publication-test")).status, 200);
});

test("草稿可以使用相同路径；发布冲突保持草稿，旧脚本默认正式且保存保留状态", async () => {
  const { service, rows, serve } = setup();
  const old = await service.create_script(edit({ script: source, version: "1.0.0" }));
  const id = old.data.script.id;
  const metadata = JSON.parse(rows[0].metadata_json);
  delete metadata.status;
  rows[0].metadata_json = JSON.stringify(metadata);
  assert.equal((await service.list_scripts()).scripts[0].status, "published");
  const draft = await service.create_script(edit({ script: source, status: "draft" }));
  assert.equal(draft.data.script.path, "/publication-test");
  await assert.rejects(service.update_script(edit({ status: "published", version: "1.0.0" }), draft.data.script.id), error => error.status === 409);
  assert.equal(rows[1].path, "");
  assert.equal((await service.list_scripts()).scripts[1].status, "draft");
  await service.update_script(edit({ script: source, debug: true }), id);
  assert.equal((await service.list_scripts()).scripts[0].status, "published");
  assert.equal((await serve("/publication-test")).status, 200);
  for (const status of [null, true, "invalid"]) {
    await assert.rejects(service.create_script(edit({ script: source, status })), error => error.status === 400);
    await assert.rejects(service.update_script(edit({ status }), id), error => error.status === 400);
  }
});

test("脚本类型写入元数据，草稿、发布和状态更新保留类型，旧脚本兼容 RSS", async () => {
  const { service, rows } = setup();
  const hot_source = '/** HOT */\n' + source;
  const created = await service.create_script(edit({ script: hot_source, status: "draft" }));
  assert.equal(created.data.script.script_type, "hot");
  const id = created.data.script.id;
  await service.update_script(edit({ status: "published", version: "1.0.0" }), id);
  assert.equal((await service.list_scripts()).scripts[0].script_type, "hot");
  await service.update_script(edit({ enabled: false }), id);
  assert.equal(JSON.parse(rows[0].metadata_json).script_type, "hot");
  await service.update_script(edit({ script: source, status: "draft" }), id);
  assert.equal((await service.list_scripts()).scripts[0].script_type, "rss");
  const broken = await service.create_script(edit({ script: "export const route = {", status: "draft", script_type: "hot" }));
  assert.equal(broken.data.script.script_type, "hot");
  for (const script_type of [null, "other", true]) {
    await assert.rejects(service.create_script(edit({ script: source, script_type })), error => error.status === 400);
    await assert.rejects(service.update_script(edit({ script_type }), id), error => error.status === 400);
  }
  const declared = await service.create_script(edit({ script: '/** HOT */\nexport const script_type="rss";\n' + source, status: "draft" }));
  assert.equal(declared.data.script.script_type, "rss");
  await assert.rejects(service.create_script(edit({ script: 'export const script_type="invalid";\n' + source })), error => error.status === 400);
});

test("kind 筛选仅返回对应脚本，并在草稿保存及列表 API 中保留和校验", async () => {
  const { service, rows } = setup();
  const hot = await service.create_script(edit({ script: source, status: 'draft', kind: 'hot' }));
  const rss = await service.create_script(edit({ script: 'export const kind="rss";\n' + source, status: 'draft' }));
  assert.equal(hot.data.script.kind, 'hot');
  assert.equal(rss.data.script.kind, 'rss');
  assert.equal(JSON.parse(rows[0].metadata_json).kind, 'hot');
  const list = async kind => route(new Request('https://internal/_admin/scripts?kind=' + kind), { scripts: service });
  assert.deepEqual((await (await list('hot')).json()).scripts.map(script => script.id), [hot.data.script.id]);
  assert.deepEqual((await (await list('rss')).json()).scripts.map(script => script.id), [rss.data.script.id]);
  assert.equal((await service.list_scripts()).scripts.length, 2);
  await service.update_script(edit({ enabled: false }), hot.data.script.id);
  assert.equal((await service.list_scripts()).scripts[0].kind, 'hot');
  for (const kind of [null, 'other', true, '']) {
    await assert.rejects(service.create_script(edit({ script: source, kind })), error => error.status === 400);
    await assert.rejects(service.update_script(edit({ kind }), hot.data.script.id), error => error.status === 400);
  }
  assert.equal((await list('other')).status, 400);
  await assert.rejects(service.create_script(edit({ script: 'export const kind="invalid";\n' + source })), error => error.status === 400);
});
