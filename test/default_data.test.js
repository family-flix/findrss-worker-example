import { read_script } from "./support/script_sources.js";
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { snapshot_store } from "./support/snapshot_store.js";
import { RepositoryScript } from "../server/repository/script.js";
import { RepositoryDiscoverySource } from "../server/repository/discovery_source.js";
import { RepositoryPlatform } from "../server/repository/platform.js";
import { RepositoryTag } from "../server/repository/tag.js";
import { ScriptModel } from "../server/domain/script.js";
import { SourceAddressModel } from "../server/domain/source_address.js";
import { RssRouteSelectionModel } from "../server/domain/rss_route_selection.js";
import { sha256_hex } from "../server/lib/crypto.js";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { seed_default_data } = await import("../server/service/durable_object/default_data.js");
const { execute_script } = await import("../server/infra/script_sandbox.js");
const script = read_script("rss/apple.js");

function fixture(t) {
  const store = snapshot_store(), values = new Map();
  t.after(() => store.db.close());
  const storage = { ...store.storage, get: async key => values.get(key),
    async put(key, value) {
      for (const [name, item] of typeof key === "string" ? [[key, value]] : Object.entries(key)) values.set(name, item);
    } };
  const repo = { scripts: new RepositoryScript(store), discovery: new RepositoryDiscoverySource(store),
    platforms: new RepositoryPlatform(store), tags: new RepositoryTag(store) };
  return { ...store, repo, storage, values, script };
}

test("空库启动写入正式 Apple 脚本、公开订阅源和平台，默认地址可运行", async t => {
  const f = fixture(t);
  const original_fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = original_fetch; });
  globalThis.fetch = () => { throw new Error("初始化不应请求上游"); };
  await seed_default_data(f);
  assert.equal(f.repo.scripts.count(), 1);
  assert.equal(f.repo.discovery.count(), 1);
  const row = f.repo.scripts.list()[0], source = f.repo.discovery.list({ include_disabled: false })[0];
  const model = ScriptModel.fromRow(row);
  assert.equal(model.status, "published");
  assert.equal(model.version, "1.0.0");
  assert.equal(model.published_script, script);
  assert.equal(model.script_hash, await sha256_hex(script));
  assert.equal(model.is_servable(), true);
  assert.equal(source.enabled, 1);
  assert.equal(source.require_token, 0);
  assert.equal(source.source_type, "Apple");
  assert.equal(source.feed_url, "{{hostname}}/rss/apple/apps/update/us/id408709785");
  const address = SourceAddressModel(source.feed_url);
  assert.equal(address.resolve("https://feeds.example"), "https://feeds.example/rss/apple/apps/update/us/id408709785");
  const selected = RssRouteSelectionModel([row], address.route_pathname).best();
  assert.ok(selected);
  assert.equal(model.routes.find(route => route.path === "/img/apple").public, true);
  assert.equal(f.repo.platforms.list()[0].id, "Apple");
  assert.match(f.repo.platforms.list()[0].icon, /^<svg/);
  assert.equal(f.values.get("discovery_catalog_dirty"), true);
  assert.equal(f.values.get("default_data_v1"), true);
  globalThis.fetch = async () => Response.json({ data: [{ attributes: {
    name: "Example App", platformAttributes: { ios: {
      iconArtwork: { url: "https://is1-ssl.mzstatic.com/app/{w}x{h}.{f}" },
      versionHistory: [{ versionDisplay: "1.0", releaseTimestamp: "2026-10-14T08:00:00Z", releaseNotes: "更新" }],
    } },
  } }] });
  const result = await execute_script(row.script, JSON.parse(row.metadata_json), null, {
    method: "GET", pathname: address.route_pathname, params: selected.path_match.params,
    query: {}, public_origin: "https://feeds.example",
  });
  assert.equal(JSON.parse(result.output).items.length, 1);
});

test("重复启动保留修改，删除全部记录后也不重新生成", async t => {
  const f = fixture(t);
  await seed_default_data(f);
  const row = f.repo.scripts.list()[0];
  f.repo.scripts.update({ ...row, title: "管理员修改", enabled: 0 });
  await seed_default_data(f);
  assert.equal(f.repo.scripts.count(), 1);
  assert.equal(f.repo.discovery.count(), 1);
  assert.equal(f.repo.scripts.find(row.route).title, "管理员修改");
  assert.equal(f.repo.scripts.find(row.route).enabled, 0);
  f.repo.scripts.delete(row.route);
  f.repo.discovery.delete(f.repo.discovery.list({ include_disabled: true })[0].id);
  await seed_default_data(f);
  assert.equal(f.repo.scripts.count(), 0);
  assert.equal(f.repo.discovery.count(), 0);
});

test("已有脚本或订阅源的部署不插入默认记录，之后清空也不补回", async t => {
  for (const table of ["scripts", "discovery_sources"]) {
    const f = fixture(t);
    if (table === "scripts") f.sql.exec("INSERT INTO scripts (route, script, created_at, updated_at) VALUES ('existing', '', 1, 1)");
    else f.sql.exec("INSERT INTO discovery_sources (id, title, feed_url, category, created_at, updated_at) VALUES ('existing', '已有源', 'https://example.com/feed', '', 1, 1)");
    await seed_default_data({ ...f, script: "invalid script" });
    assert.equal(f.repo.scripts.count() + f.repo.discovery.count(), 1);
    f.sql.exec("DELETE FROM " + table);
    await seed_default_data(f);
    assert.equal(f.repo.scripts.count() + f.repo.discovery.count(), 0);
  }
});

test("编译或写入失败不留下半套默认数据，下次可重试", async t => {
  const f = fixture(t);
  await assert.rejects(seed_default_data({ ...f, script: "invalid script" }), /默认脚本校验失败/);
  assert.equal(f.repo.scripts.count(), 0);
  const insert = f.repo.discovery.insert;
  f.repo.discovery.insert = () => { throw new Error("write failed"); };
  await assert.rejects(seed_default_data(f), /write failed/);
  assert.equal(f.repo.scripts.count(), 0);
  assert.equal(f.repo.platforms.list().length, 0);
  assert.equal(f.values.has("default_data_v1"), false);
  f.repo.discovery.insert = insert;
  await seed_default_data(f);
  assert.equal(f.repo.scripts.count(), 1);
  assert.equal(f.repo.discovery.count(), 1);
});
