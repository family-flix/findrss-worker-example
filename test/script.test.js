import assert from "node:assert/strict";
import test from "node:test";

import { ScriptModel } from "../server/domain/script.js";

const value_of = (row) => ScriptModel.fromRow(row).toValue();

test("旧榜单兼容两种 source 写法，kind 优先且 RSS 标记和基类保持 RSS", () => {
  for (const script of ['const source = { id: "baidu", name: "百度" };', 'utils.source = { id: "baidu" };']) {
    assert.equal(value_of({ script }).kind, 'hot');
    assert.equal(value_of({ script: '/** RSS */\n' + script }).kind, 'rss');
    assert.equal(value_of({ script: 'class Article extends RSSScript {}\n' + script }).kind, 'rss');
    assert.equal(value_of({ script, metadata_json: JSON.stringify({ kind: 'rss', script_type: 'hot' }) }).kind, 'rss');
  }
});

test("ScriptModel 优先取 metadata_json，缺失字段回退到 row 上的列", () => {
  const metadata = {
    path: "/wxmp/:biz",
    name: "公众号",
    url: "https://example.com",
    maintainers: ["a", 1],
    example: "biz",
    parameters: { biz: "Mzkx" },
    description: "说明",
  };
  assert.deepEqual(
    value_of({
      route: "/wxmp/:biz",
      title: "ignored",
      script: "export const route = {}",
      metadata_json: JSON.stringify(metadata),
      enabled: 1,
      created_at: 5,
      updated_at: 6,
    }),
    {
      id: "/wxmp/:biz",
      path: "/wxmp/:biz",
      name: "公众号",
      url: "https://example.com",
      platform: { name: "网页", icon: "" },
      tags: [],
      maintainers: ["a", "1"],
      example: "biz",
      parameters: { biz: "Mzkx" },
      description: "说明",
      config: {},
      cookie_grant_id: "",
      permissions: { cookies: [] },
      debug: false,
      version: "",
      published_version: "",
      published_script: "export const route = {}",
      script_hash: "",
      status: "published",
      script_type: "rss",
      kind: "rss",
      script: "export const route = {}",
      enabled: true,
      created_at: 5,
      updated_at: 6,
    },
  );

  // 无 metadata 时退到 route/title/path 列，其余给空值而不是 undefined
  const bare = value_of({
    route: "/plain",
    title: "标题",
    script: "s",
    path: "/plain",
    enabled: 0,
    created_at: 0,
    updated_at: 0,
  });
  assert.equal(bare.path, "/plain");
  assert.equal(bare.name, "标题");
  assert.equal(bare.enabled, false);
  assert.deepEqual(bare.maintainers, []);
  assert.deepEqual(bare.parameters, {});
});

test("正式源码兼容旧正式脚本，草稿没有快照时不以版本号或当前源码冒充正式源码", () => {
  const value = metadata => value_of({ script: "当前源码", metadata_json: JSON.stringify(metadata) });
  assert.equal(value({}).published_script, "当前源码");
  assert.equal(value({ status: "draft", published_version: "1.0.0" }).published_script, null);
  assert.equal(value({ status: "draft", published_script: "正式源码" }).published_script, "正式源码");
  assert.equal(value({ status: "draft", published_script: "" }).published_script, "");
});

test("ScriptModel 对坏 metadata_json、数组与标量都归一成空对象", () => {
  for (const metadata_json of ["not json", "[]", "null", '"str"', "42", ""]) {
    const value = value_of({
      route: "/r",
      title: "t",
      script: "s",
      metadata_json,
      enabled: 1,
      created_at: 1,
      updated_at: 1,
    });
    assert.equal(value.parameters === undefined, false, `parameters 缺失：${metadata_json}`);
    assert.deepEqual(value.parameters, {}, `parameters 未归一：${metadata_json}`);
    assert.equal(value.name, "t", `name 未回退：${metadata_json}`);
  }
});

test("ScriptModel.route_pattern 坏 path 返回 null 而不抛错", () => {
  const model = ScriptModel.fromRow({
    route: "/wxmp/:biz",
    script: "s",
    metadata_json: JSON.stringify({ path: "/wxmp/:biz" }),
    enabled: 1,
  });
  assert.deepEqual({ ...model.route_pattern().match("/wxmp/wow36kr").params }, { biz: "wow36kr" });
  assert.equal(model.route_pattern().score > 0, true);

  // 坏 metadata（path 变成 query string 写法）与缺 path 都不能让整个列表 500
  const broken = ScriptModel.fromRow({
    route: "/broken",
    script: "s",
    metadata_json: JSON.stringify({ path: "/feed?type=rss" }),
    enabled: 1,
  });
  assert.equal(broken.route_pattern(), null);
  assert.equal(ScriptModel.fromRow({ route: "/x", script: "s" }).route_pattern(), null);
});

test("ScriptModel.is_servable 要求启用且有 path", () => {
  const row = { route: "/r", script: "s", metadata_json: JSON.stringify({ path: "/wxmp/:biz" }) };
  assert.equal(ScriptModel.fromRow({ ...row, enabled: 1 }).is_servable(), true);
  assert.equal(ScriptModel.fromRow({ ...row, enabled: 0 }).is_servable(), false);
  assert.equal(ScriptModel.fromRow({ ...row, enabled: 1, metadata_json: "{}" }).is_servable(), false);
  assert.equal(ScriptModel.fromRow({ ...row, enabled: 1, metadata_json: JSON.stringify({ path: "/wxmp/:biz", status: "draft" }) }).is_servable(), false);
});

test("ScriptModel.covers 命中同一条 route 模式", () => {
  const model = ScriptModel.fromRow({
    route: "/wxmp/:biz",
    script: "s",
    metadata_json: JSON.stringify({ path: "/wxmp/:biz" }),
    enabled: 1,
  });
  assert.equal(model.covers("/wxmp/wow36kr"), true);
  assert.equal(model.covers("/atom/other"), false);
});

test("ScriptModel 的上限常量、名字截断与 path 冲突文案", () => {
  assert.equal(ScriptModel.MAX_SCRIPTS, 200);
  assert.equal(ScriptModel.MAX_BYTES, 10 * 1024 * 1024);
  assert.equal(
    ScriptModel.truncate_name("x".repeat(ScriptModel.NAME_MAX_LENGTH + 5)).length,
    ScriptModel.NAME_MAX_LENGTH,
  );
  assert.equal(ScriptModel.truncate_name(null), "");
  assert.deepEqual(ScriptModel.path_conflict_reason("/wxmp/:biz"), {
    status: 409,
    message: "route.path 已存在：/wxmp/:biz",
  });
});
