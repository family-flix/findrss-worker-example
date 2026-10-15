import assert from "node:assert/strict";
import test from "node:test";

import { RssRouteSelectionModel } from "../server/domain/rss_route_selection.js";

/** @param {string} path @param {Record<string, unknown>} [extra] */
const row = (path, extra) => ({
  route: "route-" + path,
  script: "export const route = {}",
  metadata_json: JSON.stringify({ path }),
  enabled: 1,
  updated_at: 1,
  ...extra,
});

test("RssRouteSelectionModel 只保留命中的行，best() 取分数最高者", () => {
  const rows = [row("/:kind/:biz"), row("/wxmp/:biz"), row("/other/:biz")];
  const selection = RssRouteSelectionModel(rows, "/wxmp/wow36kr");
  assert.equal(selection.count(), 2);
  // 静态段（100+4）比两个参数段（10+10）更具体
  assert.equal(selection.best().row.route, "route-/wxmp/:biz");
  assert.deepEqual({ ...selection.best().path_match.params }, { biz: "wow36kr" });
});

test("RssRouteSelectionModel 一个都没命中时 best() 为 null", () => {
  const selection = RssRouteSelectionModel([row("/wxmp/:biz")], "/atom/other");
  assert.equal(selection.count(), 0);
  assert.equal(selection.best(), null);
  assert.deepEqual(selection.toValue(), []);
});

test("RssRouteSelectionModel 的坏 path 被跳过而不是抛错", () => {
  const broken = {
    route: "broken",
    script: "s",
    metadata_json: JSON.stringify({ path: "/feed?type=rss" }),
    enabled: 1,
    updated_at: 2,
  };
  const selection = RssRouteSelectionModel([broken, row("/wxmp/:biz")], "/wxmp/wow36kr");
  assert.equal(selection.count(), 1);
  assert.equal(selection.best().row.route, "route-/wxmp/:biz");
});

test("RssRouteSelectionModel 冻结自身，toValue() 回新的未冻结数组", () => {
  const selection = RssRouteSelectionModel([row("/wxmp/:biz")], "/wxmp/wow36kr");
  assert.ok(Object.isFrozen(selection));
  const value = selection.toValue();
  assert.equal(Array.isArray(value), true);
  assert.equal(Object.isFrozen(value), false);
  assert.equal(value[0].path, "/wxmp/:biz");
  assert.equal(value[0].enabled, true);
});
