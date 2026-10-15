import assert from "node:assert/strict";
import test from "node:test";

import { DiscoverySourceModel, SourceAvatarModel } from "../server/domain/discovery_source.js";

/** @param {Record<string, unknown>} overrides */
function source_row(overrides = {}) {
  return {
    id: "src-1",
    title: "标题",
    description: "描述",
    website: "https://example.com",
    feed_url: "https://example.com/feed.xml",
    category: "technology",
    tags_json: '["a","b"]',
    enabled: 1,
    require_token: 0,
    sort_order: 3,
    source_type: "wxmp",
    avatar_updated_at: 0,
    created_at: 1000,
    updated_at: 2000,
    ...overrides,
  };
}

/** @param {Record<string, unknown>} overrides */
const value_of = (overrides = {}) => DiscoverySourceModel.fromRow(source_row(overrides)).toValue();

test("DiscoverySourceModel.TYPES 支持平台目录", () => {
  assert.deepEqual([...DiscoverySourceModel.TYPES].sort(), ["douyin", "wxchannels", "wxmp", "zhihu", "x", "xiaohongshu", "bilibili", "weibo", "kuaishou", "youtube", "instagram", "telegram", "website"].sort());
  assert.equal(SourceAvatarModel.MAX_BYTES, 5 * 1024 * 1024);
});

test("DiscoverySourceModel.infer_type 按 route 首段判定来源", () => {
  // 模板地址先归一成占位 origin，规则与普通地址一致
  assert.equal(DiscoverySourceModel.infer_type("{{hostname}}/rss/wxmp/wow36kr"), "wxmp");
  assert.equal(DiscoverySourceModel.infer_type("https://api.example/rss/wxmp/wow36kr"), "wxmp");
  assert.equal(DiscoverySourceModel.infer_type("https://api.example/atom/wxchannels/abc"), "wxchannels");
  assert.equal(DiscoverySourceModel.infer_type("{{hostname}}/atom/wxchannels/abc"), "wxchannels");
  // 旧式无路径参数的写法也算
  assert.equal(DiscoverySourceModel.infer_type("https://api.example/rss/wxmp?username=gh_x"), "wxmp");
});

test("DiscoverySourceModel.infer_type 认不出来的一律网站", () => {
  assert.equal(DiscoverySourceModel.infer_type("https://example.com/feed.xml"), "website");
  assert.equal(DiscoverySourceModel.infer_type("https://blog.example/rss"), "website");
  assert.equal(DiscoverySourceModel.infer_type("https://api.example/rss/other/wow36kr"), "website");
  assert.equal(DiscoverySourceModel.infer_type("https://api.example/feed/wxmp/wow36kr"), "website");
  assert.equal(DiscoverySourceModel.infer_type(""), "website");
  assert.equal(DiscoverySourceModel.infer_type("not a url"), "website");
  assert.equal(DiscoverySourceModel.infer_type(undefined), "website");
  assert.equal(DiscoverySourceModel.infer_type(null), "website");
  // 大小写敏感：约定里的路由就是小写
  assert.equal(DiscoverySourceModel.infer_type("https://api.example/rss/WXMP/wow36kr"), "website");
});

test("SourceAvatarModel.sniff 认四种光栅格式的魔数", () => {
  const pad = (head) => Uint8Array.from([...head, ...new Array(16 - head.length).fill(0)]);
  assert.equal(SourceAvatarModel.sniff(pad([0x89, 0x50, 0x4e, 0x47])), "image/png");
  assert.equal(SourceAvatarModel.sniff(pad([0xff, 0xd8, 0xff])), "image/jpeg");
  assert.equal(
    SourceAvatarModel.sniff(
      Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
    ),
    "image/webp",
  );
  assert.equal(SourceAvatarModel.sniff(pad([0x47, 0x49, 0x46, 0x38])), "image/gif");
  // RIFF 头但不是 WEBP（例如 wav）不算图片
  assert.equal(
    SourceAvatarModel.sniff(
      Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]),
    ),
    "",
  );
  // SVG 故意不支持（同源直开可执行脚本）
  assert.equal(SourceAvatarModel.sniff(new TextEncoder().encode("<svg xmlns=")), "");
  assert.equal(SourceAvatarModel.sniff(new TextEncoder().encode("<svg xmlns='http://x'/>")), "");
});

test("SourceAvatarModel.sniff 对残缺字节与空输入回空串", () => {
  assert.equal(SourceAvatarModel.sniff(new Uint8Array(0)), "");
  assert.equal(SourceAvatarModel.sniff(new Uint8Array([0x89, 0x50])), "");
  assert.equal(SourceAvatarModel.sniff(new Uint8Array(11)), "");
  // ArrayBuffer 也接受
  assert.equal(SourceAvatarModel.sniff(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer), "");
});

test("SourceAvatarModel.path 只在有头像时给出带版本号的相对路径", () => {
  assert.equal(SourceAvatarModel.path("src-1", 1700000000000), "/api/avatar/src-1?v=1700000000000");
  assert.equal(SourceAvatarModel.path("src-1", 1), "/api/avatar/src-1?v=1");
  assert.equal(SourceAvatarModel.path("src-1", 0), "");
  assert.equal(SourceAvatarModel.path("src-1", null), "");
  assert.equal(SourceAvatarModel.path("src-1", undefined), "");
  assert.equal(SourceAvatarModel.path("src-1", -1), "");
  assert.equal(SourceAvatarModel.path("src-1", "abc"), "");
});

test("DiscoverySourceModel 组合出头像实体（path / has）", () => {
  const none = DiscoverySourceModel.fromRow(source_row()).avatar();
  assert.equal(none.has(), false);
  assert.equal(none.path(), "");

  const with_avatar = DiscoverySourceModel.fromRow(source_row({ avatar_updated_at: 1700000000000 })).avatar();
  assert.equal(with_avatar.has(), true);
  assert.equal(with_avatar.path(), "/api/avatar/src-1?v=1700000000000");
});

test("DiscoverySourceModel.fromRow().toValue() 把 0/1 列翻成布尔，tags 逐项转字符串", () => {
  assert.deepEqual(value_of(), {
    id: "src-1",
    title: "标题",
    description: "描述",
    website: "https://example.com",
    feed_url: "https://example.com/feed.xml",
    category: "technology",
    tags: ["a", "b"],
    enabled: true,
    require_token: false,
    sort_order: 3,
    source_type: "wxmp",
    avatar_url: "",
    poll_policy: { mode: "inherit" },
    created_at: 1000,
    updated_at: 2000,
  });
});

test("DiscoverySourceModel 老行缺列时 source_type 回退 website、avatar_url 回退空串", () => {
  // 老库（迁移前）的 SELECT * 不会有这两列
  const legacy = value_of({ source_type: undefined, avatar_updated_at: undefined });
  assert.equal(legacy.source_type, "website");
  assert.equal(legacy.avatar_url, "");
  assert.equal(value_of({ source_type: "" }).source_type, "website");
  assert.equal(value_of({ avatar_updated_at: null }).avatar_url, "");
});

test("DiscoverySourceModel 有头像时给出带版本号的同源路径", () => {
  assert.equal(value_of({ avatar_updated_at: 1700000000000 }).avatar_url, "/api/avatar/src-1?v=1700000000000");
});

test("DiscoverySourceModel 对坏 tags_json 与非数组降级成空数组，不抛错", () => {
  assert.deepEqual(value_of({ tags_json: "not json" }).tags, []);
  assert.deepEqual(value_of({ tags_json: "" }).tags, []);
  assert.deepEqual(value_of({ tags_json: '{"a":1}' }).tags, []);
  assert.deepEqual(value_of({ tags_json: "null" }).tags, []);
  // 数字元素按标签定义一律字符串化
  assert.deepEqual(value_of({ tags_json: "[1,2]" }).tags, ["1", "2"]);
});

test("DiscoverySourceModel.fromValue 归一请求体形状（布尔与 tags 数组）", () => {
  const model = DiscoverySourceModel.fromValue({
    title: "标题",
    description: "",
    website: "",
    feed_url: "https://example.com/feed.xml",
    category: "technology",
    tags: ["a", "b"],
    enabled: false,
    require_token: true,
    sort_order: -2,
    source_type: "wxchannels",
  });
  assert.equal(model.enabled, false);
  assert.equal(model.require_token, true);
  assert.deepEqual([...model.tags], ["a", "b"]);
  assert.equal(model.sort_order, -2);
  assert.equal(model.source_type, "wxchannels");
  assert.equal(model.id, "");
});

test("DiscoverySourceModel.validate 拒绝非法请求体，错误串逐字不变", () => {
  const error_of = (body) => {
    const result = DiscoverySourceModel.validate(body);
    assert.equal(result.ok, false, "期望校验失败");
    return result.error;
  };
  assert.deepEqual(error_of({ title: 1 }), { status: 400, message: "title must be a string" });
  assert.deepEqual(
    error_of({ title: "  " }),
    { status: 400, message: "title must be 1 to 128 characters without newlines" },
  );
  assert.deepEqual(
    error_of({ title: "a", website: "not a url" }),
    { status: 400, message: "website must be a public HTTP(S) URL" },
  );
  assert.deepEqual(
    error_of({ title: "a", feed_url: "not a url" }),
    { status: 400, message: "feed_url must be a public HTTP(S) URL" },
  );
  assert.deepEqual(
    error_of({ title: "a", feed_url: "https://example.com/feed.xml", category: "invalid" }),
    { status: 400, message: "invalid category" },
  );
  assert.deepEqual(
    error_of({ title: "a", feed_url: "https://example.com/feed.xml", category: "technology", source_type: "nope" }),
    { status: 400, message: "invalid source_type" },
  );
  assert.deepEqual(
    error_of({ title: "a", feed_url: "https://example.com/feed.xml", category: "technology", enabled: "yes" }),
    { status: 400, message: "enabled must be a boolean" },
  );
});

test("DiscoverySourceModel.validate 接受合法请求体并预判来源类型", () => {
  const result = DiscoverySourceModel.validate({
    title: " 公众号 ",
    feed_url: "https://api.example/rss/wxmp/wow36kr",
    category: "technology",
    tags: "a, b ,",
  });
  assert.equal(result.ok, true);
  assert.equal(result.model.title, "公众号");
  assert.equal(result.model.source_type, "wxmp");
  assert.deepEqual([...result.model.tags], ["a", "b"]);
  assert.equal(result.model.enabled, true);
});

test("DiscoverySourceModel.parseBody 读请求体：超限 413、坏 JSON 400", async () => {
  const json_request = (body, length) => new Request("https://internal/_admin/discovery/sources", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": String(length ?? 10) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

  const too_large = await DiscoverySourceModel.parseBody(json_request({}, 16 * 1024 + 1));
  assert.deepEqual(too_large, { ok: false, error: { status: 413, message: "request body is too large" } });

  const bad_json = await DiscoverySourceModel.parseBody(json_request("{不是 JSON"));
  assert.deepEqual(bad_json, { ok: false, error: { status: 400, message: "invalid JSON" } });

  const not_object = await DiscoverySourceModel.parseBody(json_request("[1]"));
  assert.deepEqual(not_object, { ok: false, error: { status: 400, message: "invalid JSON body" } });

  const ok = await DiscoverySourceModel.parseBody(json_request({
    title: "标题",
    feed_url: "https://example.com/feed.xml",
    category: "technology",
  }));
  assert.equal(ok.ok, true);
  assert.equal(ok.model.title, "标题");
  assert.equal(ok.model.source_type, "website");
});

test("DiscoverySourceModel.is_public_route 要求启用、不要 token 且 route 匹配", () => {
  const base = {
    id: "1",
    title: "T",
    feed_url: "{{hostname}}/rss/wxmp/wow36kr",
    category: "technology",
    tags_json: "[]",
    enabled: 1,
    require_token: 0,
  };
  assert.equal(DiscoverySourceModel.fromRow(base).is_public_route("/wxmp/wow36kr"), true);
  // /atom/ 前缀指向同一条 route，公开性只比较 route pathname
  assert.equal(
    DiscoverySourceModel.fromRow({ ...base, feed_url: "{{hostname}}/atom/wxmp/wow36kr" })
      .is_public_route("/wxmp/wow36kr"),
    true,
  );
  assert.equal(DiscoverySourceModel.fromRow(base).is_public_route("/wxmp/other"), false);
  // 要求 token 或未启用即不公开
  assert.equal(DiscoverySourceModel.fromRow({ ...base, require_token: 1 }).is_public_route("/wxmp/wow36kr"), false);
  assert.equal(DiscoverySourceModel.fromRow({ ...base, enabled: 0 }).is_public_route("/wxmp/wow36kr"), false);
  // 普通公网 RSS 地址不是脚本路由，永远不公开
  assert.equal(
    DiscoverySourceModel.fromRow({ ...base, feed_url: "https://example.com/feed.xml" })
      .is_public_route("/wxmp/wow36kr"),
    false,
  );
});

test("DiscoverySourceModel.merge_for_patch 只覆盖出现过的字段", () => {
  const current = DiscoverySourceModel.fromRow({
    id: "1",
    title: "旧标题",
    description: "旧描述",
    website: "https://example.com",
    feed_url: "https://example.com/feed.xml",
    category: "technology",
    tags_json: '["a"]',
    enabled: 1,
    require_token: 0,
    sort_order: 5,
    source_type: "website",
    poll_policy: { mode: "inherit" },
  });
  // 空体 = 全沿用旧值
  assert.deepEqual(DiscoverySourceModel.merge_for_patch(current, {}), {
    title: "旧标题",
    description: "旧描述",
    website: "https://example.com",
    feed_url: "https://example.com/feed.xml",
    category: "technology",
    tags: ["a"],
    enabled: true,
    require_token: false,
    sort_order: 5,
    source_type: "website",
    poll_policy: { mode: "inherit" },
  });
  // 出现的字段才覆盖（false / 0 / "" 也算出现）
  const patched = DiscoverySourceModel.merge_for_patch(current, {
    title: "新标题",
    enabled: false,
    sort_order: 0,
  });
  assert.equal(patched.title, "新标题");
  assert.equal(patched.enabled, false);
  assert.equal(patched.sort_order, 0);
  assert.equal(patched.description, "旧描述");
  assert.deepEqual(patched.tags, ["a"]);
});

test("DiscoverySourceModel 的上限常量与重复文案", () => {
  assert.equal(DiscoverySourceModel.MAX_SOURCES, 1000);
  assert.equal(DiscoverySourceModel.MAX_RELATED, 12);
  assert.deepEqual(DiscoverySourceModel.duplicate_reason(), {
    status: 409,
    message: "discovery source already exists",
  });
});


test("新增源不要求分类，各平台按路由预判，旧分类作为标签读取且去重", () => {
  for (const platform of DiscoverySourceModel.TYPES) {
    const feed_url = "{{hostname}}/rss/" + platform + "/user";
    const result = DiscoverySourceModel.validate({ title: "源", feed_url, tags: ["科技", "文章"] });
    assert.equal(result.ok, true);
    assert.equal(result.model.category, "");
    assert.equal(result.model.source_type, platform);
  }
  const model = DiscoverySourceModel.fromRow(source_row({ tags_json: '["科技","视频"]' }));
  assert.deepEqual(model.discovery_tags(), ["科技", "视频"]);
  assert.deepEqual(DiscoverySourceModel.fromRow(source_row()).discovery_tags(), ["a", "b", "科技"]);
  assert.equal(DiscoverySourceModel.fromRow(source_row()).category, "technology");
});


test("旧分类加满额标签可无损保存为纯标签源", () => {
  const model = DiscoverySourceModel.fromRow(source_row({ tags_json: JSON.stringify(Array.from({ length: 12 }, (_, i) => "tag" + i)) }));
  const result = DiscoverySourceModel.validate({ title: "源", feed_url: "https://example.com/feed", category: "", tags: model.discovery_tags() });
  assert.equal(result.ok, true);
  assert.equal(result.model.tags.length, 13);
  assert.ok(result.model.tags.includes("科技"));
});
