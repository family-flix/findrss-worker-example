import assert from "node:assert/strict";
import test from "node:test";
import { ScriptModel } from "../server/domain/script.js";

test('已保存旧脚本缺少 kind 时仍按顶部标记、基类和 NewsNow 特征分类', () => {
  for (const [source, kind] of [
    ['/** RSS */ const source = {};', 'rss'],
    ['class Ranking extends HotRankScript {}', 'hot'],
    ['class Feed extends RSSScript {}', 'rss'],
    ['const source = { name: "旧榜单" };', 'hot'],
    ['export const route = {};', 'rss'],
  ]) assert.equal(ScriptModel.fromRow({ script: source, metadata_json: '{}' }).toValue().kind, kind);
});
