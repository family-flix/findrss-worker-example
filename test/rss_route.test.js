import assert from "node:assert/strict";
import test from "node:test";

import { RssRoutePatternModel } from "../server/domain/rss_route.js";

const match = (path, pathname) => RssRoutePatternModel(path).match(pathname);

test("静态 route.path 精确匹配且具有更高优先级", () => {
  const static_match = match("/wxmp", "/wxmp");
  const dynamic_match = match("/:category{.+}?", "/wxmp");

  assert.deepEqual({ ...static_match.params }, {});
  assert.ok(static_match.score > dynamic_match.score);
  assert.equal(match("/wxmp", "/wxmp/other"), null);
});

test("自定义正则参数可以跨路径段并写入 params", () => {
  const match_deep = match("/:category{.+}?", "/423down/category");
  const home_match = match("/:category{.+}?", "/");

  assert.equal(match_deep.params.category, "423down/category");
  assert.equal(home_match.params.category, "");
});

test("普通参数按路径段匹配并解码", () => {
  const match_name = match("/author/:name", "/author/%E5%BC%A0%E4%B8%89");

  assert.equal(match_name.params.name, "张三");
  assert.equal(match("/author/:name", "/author/a/posts"), null);
});

test("拒绝重复参数名和 query string", () => {
  assert.throws(() => RssRoutePatternModel("/:id/:id"), /参数名重复/);
  assert.throws(() => RssRoutePatternModel("/feed?type=rss"), /query string/);
});

test("RssRoutePatternModel.fromValue 容错：坏 path 返回 null", () => {
  assert.equal(RssRoutePatternModel.fromValue("/feed?type=rss"), null);
  assert.equal(RssRoutePatternModel.fromValue("/:id/:id"), null);
  assert.equal(RssRoutePatternModel.fromValue(""), null);
  const model = RssRoutePatternModel.fromValue("/wxmp/:biz");
  assert.ok(model !== null);
  assert.equal(model.toValue().path, "/wxmp/:biz");
  assert.deepEqual(model.toValue().parameter_names, ["biz"]);
});
