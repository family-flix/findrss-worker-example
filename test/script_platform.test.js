import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { RepositoryPlatform } from "../server/repository/platform.js";
import { RepositoryScript } from "../server/repository/script.js";
import { API_SCHEMA_SQL } from "../server/repository/schema.js";
import { ScriptModel } from "../server/domain/script.js";
import { ServiceDiscovery } from "../server/service/durable_object/discovery.js";
import { discovery_platform_id, platform_icon_url } from "../server/lib/discovery_platform.js";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { compile_script_module } = await import("../server/infra/script_sandbox.js");
const { ServiceScript } = await import("../server/service/durable_object/scripts.js");
const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';
const next_icon = icon.replace("M0 0", "M1 1");
const declaration = (platform, suffix = "") => `export const platform = ${JSON.stringify(platform)};
export const routes = ["/platform-test${suffix}", "/platform-test${suffix}/extra"].map(path => ({
  path, name: "测试", handler() { return { title: "测试", items: [] }; }
}));`;
const request = body => new Request("https://internal/_admin/scripts", { method: "POST", body: JSON.stringify(body) });

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(API_SCHEMA_SQL);
  const sql = { exec(statement, ...args) {
    const rows = db.prepare(statement).all(...args).map(row => ({ ...row }));
    return { toArray: () => rows };
  } };
  const repo = { platforms: new RepositoryPlatform({ sql }), scripts: new RepositoryScript({ sql }),
    rss_cookies: { get: () => [] }, script_logs: { delete_for_route() {} },
    discovery: { list: () => [], list_tags: () => [], list_types: () => [] } };
  let publishes = 0;
  const discovery = new ServiceDiscovery({ repo });
  discovery.publish_catalog = async () => { publishes++; };
  const service = new ServiceScript({ repo, app: { discovery }, ports: {
    transaction(callback) {
      db.exec("BEGIN");
      try { callback(); db.exec("COMMIT"); }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    route_cache: { delete() {}, invalidate_all() {} },
  } });
  service.record_log = () => {};
  return { db, repo, service, discovery, get publishes() { return publishes; } };
}

test("platform 对象支持脚本共用、路由覆盖和旧字符串，并拒绝无效名称与图标", async () => {
  const shared = { name: "自定义平台", icon };
  const compiled = await compile_script_module(declaration(shared));
  assert.equal(compiled.error, "");
  assert.deepEqual(compiled.metadata.platform, shared);
  assert.ok(compiled.metadata.routes.every(route => route.platform.icon === icon));
  const overridden = await compile_script_module(declaration(shared).replace('path, name:', 'path, platform: { name: "知乎", icon: "" }, name:'));
  assert.equal(overridden.error, "");
  assert.deepEqual(overridden.metadata.platform, { name: "知乎", icon: "" });
  assert.deepEqual((await compile_script_module(declaration("zhihu"))).metadata.platform, { name: "知乎", icon: "" });
  for (const platform of [null, [], 123, { name: "" }, { name: "all" }, { name: "a".repeat(65) },
    { name: "bad\nname" }, { name: "测试", icon: 1 }, { name: "测试", icon: "javascript:alert(1)" },
    { name: "测试", icon: "https://user:secret@example.com/icon.svg" }, { name: "测试", icon: "//evil.example/icon.svg" },
    { name: "测试", icon: "<svg>" }, { name: "测试", icon: "x".repeat(131073) }]) {
    const result = await compile_script_module(declaration(platform));
    assert.notEqual(result.error, "", JSON.stringify(platform).slice(0, 160));
  }
  const model = ScriptModel.fromRow({ metadata_json: JSON.stringify(compiled.metadata) });
  const value = model.toValue();
  value.platform.icon = "changed";
  value.routes[0].platform.name = "changed";
  assert.equal(model.platform.icon, icon);
  assert.equal(model.routes[0].platform.name, "自定义平台");
  assert.equal(discovery_platform_id(shared), "自定义平台");
  assert.equal(decodeURIComponent(platform_icon_url(icon).split(",")[1]), icon);
});

test("正式发布才收集平台，草稿与失败发布不污染列表，同名更新图标且重启后仍保留", async t => {
  const f = fixture(t);
  const first_source = declaration({ name: "独立平台", icon });
  const draft = (await f.service.create_script(request({ script: first_source, status: "draft" }))).data.script;
  assert.deepEqual(f.repo.platforms.list(), []);
  await assert.rejects(f.service.update_script(request({ status: "published" }), draft.id), { status: 400 });
  assert.deepEqual(f.repo.platforms.list(), []);
  await f.service.update_script(request({ status: "published", version: "1.0.0" }), draft.id);
  assert.deepEqual(f.repo.platforms.list(), [{ id: "独立平台", name: "独立平台", icon }]);
  const catalog = f.discovery.public_catalog();
  assert.deepEqual(catalog.platforms.find(platform => platform.id === "独立平台"), { id: "独立平台", label: "独立平台", icon });
  assert.deepEqual(f.discovery.list_discovery_sources(new URL("https://internal/sources?source_type=" + encodeURIComponent("独立平台")), true).platforms, catalog.platforms);
  const before = f.publishes;
  const changed = declaration({ name: "独立平台", icon: next_icon });
  await assert.rejects(f.service.update_script(request({ script: changed, status: "published", version: "1.0.0" }), draft.id), { status: 409 });
  assert.equal(f.repo.platforms.list()[0].icon, icon);
  await f.service.update_script(request({ script: changed, status: "published", version: "1.0.1" }), draft.id);
  assert.equal(f.publishes, before + 1);
  assert.deepEqual(f.repo.platforms.list(), [{ id: "独立平台", name: "独立平台", icon: next_icon }]);
  await f.service.update_script(request({ script: declaration({ name: "草稿平台", icon }), status: "draft" }), draft.id);
  assert.equal(f.repo.platforms.list().length, 1);
  const restarted = new RepositoryPlatform({ sql: { exec(statement, ...args) {
    return { toArray: () => f.db.prepare(statement).all(...args).map(row => ({ ...row })) };
  } } });
  restarted.import_published(f.repo.scripts.list());
  assert.equal(restarted.list()[0].icon, next_icon);
  await f.service.delete_script(draft.id);
  assert.equal(restarted.list().length, 1);
});

test("首次直接发布、多平台路由、名称别名去重，平台落库失败会回滚脚本", async t => {
  const f = fixture(t);
  const source = `export const platform = ${JSON.stringify({ name: "知乎", icon })};
export const routes = [
  { path: "/first", name: "一", handler() {} },
  { path: "/second", name: "二", platform: "zhihu", handler() {} },
  { path: "/third", name: "三", platform: { name: "视频平台", icon: "https://example.com/icon.png" }, handler() {} }
];`;
  await f.service.create_script(request({ script: source, status: "published", version: "1.0.0" }));
  const platforms = f.repo.platforms.list();
  assert.equal(platforms.length, 2);
  assert.equal(platforms.find(platform => platform.id === "zhihu").icon, icon, "缺省图标不覆盖已收集的图标");
  f.repo.platforms.collect = () => { throw new Error("platform write failed"); };
  await assert.rejects(f.service.create_script(request({ script: declaration({ name: "失败平台", icon }, "-failed"), version: "1.0.0" })), /platform write failed/);
  assert.equal(f.repo.scripts.count(), 1);
  assert.equal(f.repo.platforms.list().length, 2);
});

test("升级回填只收集已发布脚本，草稿不入库，旧数据不覆盖更新后的图标", t => {
  const f = fixture(t);
  const row = (name, status, updated_at, image = icon) => ({ updated_at,
    metadata_json: JSON.stringify({ status, platform: { name, icon: image }, routes: [{ path: "/" + name, platform: { name, icon: image } }] }) });
  const rows = [row("知乎", "published", 1), row("草稿", "draft", 100), row("知乎", "published", 2, next_icon)];
  f.repo.platforms.import_published(rows);
  assert.deepEqual(f.repo.platforms.list(), [{ id: "zhihu", name: "知乎", icon: next_icon }]);
  f.repo.platforms.collect({ platform: { name: "知乎", icon: "https://example.com/latest.png" } }, 3);
  f.repo.platforms.import_published(rows);
  assert.equal(f.repo.platforms.list()[0].icon, "https://example.com/latest.png");
});
