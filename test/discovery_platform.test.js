import assert from "node:assert/strict";
import test from "node:test";
import { discovery_platforms, discovery_platform_icon } from "../server/lib/discovery_platform.js";
import { ScriptModel } from "../server/domain/script.js";
import { ServiceDiscovery } from "../server/service/durable_object/discovery.js";

test("默认只有网页，脚本名称和旧源平台合并去重，自定义平台使用通用图标", () => {
  assert.deepEqual(discovery_platforms(), [{ id: "website", label: "网页", icon: "" }]);
  assert.deepEqual(discovery_platforms(["知乎", "zhihu", "独立平台", "网站"], [{ source_type: "x" }]), [
    { id: "website", label: "网页", icon: "" }, { id: "zhihu", label: "知乎", icon: "" },
    { id: "独立平台", label: "独立平台", icon: "" }, { id: "x", label: "X", icon: "" },
  ]);
  assert.equal(discovery_platform_icon("独立平台"), "website");
  assert.equal(discovery_platform_icon("zhihu"), "zhihu");
});

test("维护者对象完整往返，返回数据不会改写模型中的维护者", () => {
  const maintainers = [{ nickname: "甲", url: "https://example.com/author", avatar: "https://example.com/avatar.png" },
    { nickname: "乙", url: "", avatar: "" }, "旧维护者"];
  const model = ScriptModel.fromRow({ metadata_json: JSON.stringify({ platform: "知乎", maintainers }) });
  assert.deepEqual(model.platform, { name: "知乎", icon: "" });
  assert.deepEqual(model.toValue().maintainers, maintainers);
  model.toValue().maintainers[0].nickname = "修改副本";
  assert.equal(model.maintainers[0].nickname, "甲");
});

test("没有订阅源也会提供脚本平台；新增源按路由推断平台，旧源平台继续可编辑", async () => {
  const scripts = [];
  const platforms = [];
  const sources = new Map();
  const repo = { platforms: { list: () => platforms }, scripts: { list: () => scripts }, discovery: {
    list: () => [...sources.values()], list_tags: () => [], list_types: () => [...sources.values()],
    count: () => sources.size, feed_url_taken: () => false, feed_url_taken_by_other: () => false,
    insert: source => sources.set(source.id, source), find: id => sources.get(id),
    update: source => sources.set(source.id, { ...sources.get(source.id), ...source }),
    snapshot_get: () => undefined, snapshot_delete() {},
  } };
  const service = new ServiceDiscovery({ repo });
  assert.deepEqual(service.public_catalog().platforms, [{ id: "website", label: "网页", icon: "" }]);
  scripts.push({ metadata_json: JSON.stringify({ kind: "rss", routes: [
    { path: "/people/:id", platform: "知乎" }, { path: "/special/:id", platform: "独立平台" },
  ] }) });
  assert.deepEqual(service.public_catalog().platforms.map(platform => platform.id), ["website"], "草稿或未收集的脚本不注册平台");
  platforms.push({ id: "zhihu", name: "知乎", icon: "" }, { id: "独立平台", name: "独立平台", icon: "" });
  assert.deepEqual(service.public_catalog().platforms.map(platform => platform.id), ["website", "zhihu", "独立平台"]);
  const request = (body, method = "POST") => new Request("https://internal/source", { method, body: JSON.stringify(body) });
  const result = await service.create_discovery_source(request({ title: "自定义", feed_url: "{{hostname}}/atom/special/123" }));
  assert.equal(result.data.source.source_type, "独立平台");
  await assert.rejects(service.create_discovery_source(request({ title: "非法", feed_url: "https://example.com/feed", source_type: "未注册" })), { status: 400 });
  scripts.length = 0;
  assert.deepEqual(service.public_catalog().platforms.map(platform => platform.id), ["website", "zhihu", "独立平台"]);
  const updated = await service.update_discovery_source(request({ title: "保留原平台", feed_url: "https://example.com/feed" }, "PATCH"), result.data.source.id);
  assert.equal(updated.source.source_type, "独立平台");
});
