import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { RepositoryScript } from "../server/repository/script.js";
import { RepositoryPlatform } from "../server/repository/platform.js";
import { RepositoryTag } from "../server/repository/tag.js";
import { RepositoryDiscoverySource } from "../server/repository/discovery_source.js";
import { API_SCHEMA_SQL } from "../server/repository/schema.js";
import { ScriptModel } from "../server/domain/script.js";
import { ServiceDiscovery } from "../server/service/application/discovery.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const {
  compile_script_module
} = await import("../server/infra/script_sandbox.js");
const {
  ServiceScript
} = await import("../server/service/application/scripts.js");
const request = body => new Request("https://internal/", {
  method: "POST",
  body: JSON.stringify(body)
});
const declaration = (tags, suffix = "") => `export const tags = ${JSON.stringify(tags)};
export const platform = { name: "脚本平台", icon: "" };
export const routes = [
  { path: "/tags${suffix}/:id", name: "文章", example: "/tags${suffix}/1", handler() {} },
  { path: "/tags${suffix}/video/:id", name: "视频", example: "/tags${suffix}/video/1", tags: ["视频"], handler() {} },
  { path: "/tags${suffix}/empty", name: "空标签", tags: [], handler() {} }
];`;
function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(API_SCHEMA_SQL);
  const sql = {
    exec(statement, ...args) {
      const rows = db.prepare(statement).all(...args).map(row => ({
        ...row
      }));
      return {
        toArray: () => rows
      };
    }
  };
  const repo = {
    scripts: new RepositoryScript({
      sql
    }),
    platforms: new RepositoryPlatform({
      sql
    }),
    tags: new RepositoryTag({
      sql
    }),
    discovery: new RepositoryDiscoverySource({
      sql
    }),
    rss_cookies: {
      get: () => []
    },
    script_logs: {
      delete_for_route() {}
    }
  };
  const discovery = new ServiceDiscovery({
    repo
  });
  let publishes = 0;
  discovery.publish_catalog = async () => {
    publishes++;
  };
  const service = new ServiceScript({
    repo,
    app: {
      discovery
    },
    ports: {
      async transaction(callback) {
        db.exec("BEGIN");
        try {
          await callback();
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
      route_cache: {
        delete() {},
        invalidate_all() {}
      }
    }
  });
  service.record_log = () => {};
  return {
    repo,
    service,
    discovery,
    sql,
    get publishes() {
      return publishes;
    }
  };
}
test("脚本标签支持共用、路由覆盖、去重、空数组与旧脚本默认值，模型返回独立数组", async () => {
  const compiled = await compile_script_module(declaration([" 科技 ", "文章", "科技"]));
  assert.equal(compiled.error, "");
  assert.deepEqual(compiled.metadata.tags, ["科技", "文章"]);
  assert.deepEqual(compiled.metadata.routes.map(route => route.tags), [["科技", "文章"], ["视频"], []]);
  const model = ScriptModel.fromRow({
    metadata_json: JSON.stringify(compiled.metadata)
  });
  const value = model.toValue();
  value.tags.push("改动");
  value.routes[0].tags.push("改动");
  assert.deepEqual(model.tags, ["科技", "文章"]);
  assert.deepEqual(model.routes[0].tags, ["科技", "文章"]);
  const legacy = await compile_script_module('export const route = { path: "/legacy", name: "旧脚本", handler() {} };');
  assert.equal(legacy.error, "");
  assert.deepEqual(legacy.metadata.tags, []);
  assert.deepEqual(ScriptModel.fromRow({
    metadata_json: '{"tags":null}'
  }).tags, []);
});
test("标签拒绝非法类型、空名称、控制字符、超长与超过 13 个不同标签", async () => {
  for (const tags of [null, {}, "科技", 1, [null], [1], [""], ["  "], ["bad\ntag"], ["bad\u0000tag"], ["a".repeat(33)], Array.from({
    length: 14
  }, (_, index) => "标签" + index)]) {
    const result = await compile_script_module(declaration(tags));
    assert.match(result.error, /tags/, JSON.stringify(tags));
  }
  const boundary = await compile_script_module(declaration(Array.from({
    length: 13
  }, (_, index) => String(index).padEnd(32, "字"))));
  assert.equal(boundary.error, "");
  const route_error = await compile_script_module(declaration([]).replace('tags: ["视频"]', 'tags: [false]'));
  assert.match(route_error.error, /tags/);
});
test("正式发布才收集标签，无源时前后台目录一致，草稿和失败发布不污染标签", async t => {
  const f = fixture(t);
  const source = declaration(["科技", "文章"]);
  const draft = (await f.service.create_script(request({
    script: source,
    status: "draft"
  }))).data.script;
  assert.deepEqual(draft.tags, ["科技", "文章"]);
  assert.deepEqual(await f.repo.tags.list(), []);
  await assert.rejects(f.service.update_script(request({
    status: "published"
  }), draft.id), {
    status: 400
  });
  assert.deepEqual(await f.repo.tags.list(), []);
  await f.service.update_script(request({
    status: "published",
    version: "1.0.0"
  }), draft.id);
  assert.deepEqual(new Set(await f.repo.tags.list()), new Set(["科技", "文章", "视频"]));
  const public_catalog = await f.discovery.public_catalog();
  assert.deepEqual(public_catalog.sources, []);
  for (const include_disabled of [true, false]) {
    assert.deepEqual((await f.discovery.list_discovery_sources(new URL("https://internal/?q=无结果&tag=不存在"), include_disabled)).tags, public_catalog.tags);
  }
  await assert.rejects(f.service.update_script(request({
    script: declaration(["失败标签"]),
    status: "published",
    version: "1.0.0"
  }), draft.id), {
    status: 409
  });
  assert.equal((await f.repo.tags.list()).includes("失败标签"), false);
  const before = f.publishes;
  await f.service.update_script(request({
    script: declaration(["新标签"]),
    status: "published",
    version: "1.0.1"
  }), draft.id);
  assert.equal(f.publishes, before + 1);
  assert.equal((await f.repo.tags.list()).includes("新标签"), true);
  await f.service.update_script(request({
    script: declaration(["草稿标签"]),
    status: "draft"
  }), draft.id);
  assert.equal((await f.repo.tags.list()).includes("草稿标签"), false);
  const restarted = new RepositoryTag({
    sql: f.sql
  });
  await restarted.import_published(await f.repo.scripts.list());
  await f.service.delete_script(draft.id);
  assert.deepEqual(await restarted.list(), await f.repo.tags.list());
  assert.equal((await restarted.list()).includes("科技"), true);
});
test("标签入库失败回滚脚本和平台，升级只回填已发布脚本且可重复执行", async t => {
  const f = fixture(t);
  const collect = f.repo.tags.collect;
  f.repo.tags.collect = () => {
    throw new Error("tag write failed");
  };
  await assert.rejects(f.service.create_script(request({
    script: declaration(["回滚"]),
    version: "1.0.0"
  })), /tag write failed/);
  assert.equal(await f.repo.scripts.count(), 0);
  assert.deepEqual(await f.repo.platforms.list(), []);
  f.repo.tags.collect = collect;
  const rows = [{
    metadata_json: '{"tags":["已发布"],"routes":[{"tags":["路由标签"]},{"tags":[]}]}'
  }, {
    metadata_json: '{"status":"draft","tags":["草稿"]}'
  }, {
    metadata_json: '{"tags":["旧标签"]}'
  }, {
    metadata_json: 'broken'
  }];
  await f.repo.tags.import_published(rows);
  await f.repo.tags.import_published(rows);
  assert.deepEqual(new Set(await f.repo.tags.list()), new Set(["路由标签", "旧标签"]));
});
test("新增源默认使用匹配路由标签，明确指定的空标签和手动标签保留，手动标签不进入目录", async t => {
  const f = fixture(t);
  await f.service.create_script(request({
    script: declaration(["科技", "文章"]),
    version: "1.0.0"
  }));
  const create = async (path, extra = {}) => (await f.discovery.create_discovery_source(request({
    title: "源",
    feed_url: "{{hostname}}/rss" + path,
    ...extra
  }))).data.source;
  assert.deepEqual((await create("/tags/1")).tags, ["科技", "文章"]);
  assert.deepEqual((await create("/tags/video/1")).tags, ["视频"]);
  assert.deepEqual((await create("/tags/2", {
    tags: []
  })).tags, []);
  const manual = await create("/tags/3", {
    tags: ["手动标签"]
  });
  assert.deepEqual(manual.tags, ["手动标签"]);
  assert.equal((await f.discovery.public_catalog()).tags.includes("手动标签"), false);
  await f.discovery.update_discovery_source(request({
    title: "改名"
  }), manual.id);
  assert.deepEqual((await f.discovery.source_value(await f.repo.discovery.find(manual.id))).tags, ["手动标签"]);
});
