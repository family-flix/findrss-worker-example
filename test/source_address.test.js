import assert from "node:assert/strict";
import test from "node:test";

import { SourceAddressModel } from "../server/domain/source_address.js";

const route_of = (feed_url) => SourceAddressModel(feed_url).toValue();

test("只解析 /rss/ 与 /atom/ 地址并剥离前缀", () => {
  assert.deepEqual(route_of("https://prod.example/rss/wxmp/wow36kr"), {
    route_pathname: "/wxmp/wow36kr",
    format: "rss",
  });
  assert.deepEqual(route_of("https://prod.example/atom/wxmp/wow36kr"), {
    route_pathname: "/wxmp/wow36kr",
    format: "atom",
  });
  assert.deepEqual(route_of("http://localhost:8787/rss/author/%E5%BC%A0%E4%B8%89"), {
    route_pathname: "/author/张三",
    format: "rss",
  });
  assert.deepEqual(route_of("http://localhost:8787/atom/author/%E5%BC%A0%E4%B8%89"), {
    route_pathname: "/author/张三",
    format: "atom",
  });
  assert.equal(SourceAddressModel("https://example.com/feed.xml").is_route(), false);
  assert.equal(SourceAddressModel("https://example.com/rssish/feed").is_route(), false);
  assert.equal(SourceAddressModel("https://example.com/atomish/feed").is_route(), false);
  assert.equal(SourceAddressModel("https://example.com/atoms/feed").is_route(), false);
});

test("地址匹配忽略 host、query 与格式前缀，只看 pathname", () => {
  const feed_url = "https://prod.example/rss/wxmp/wow36kr?offset=1&lang=zh";
  const matches = (candidate, route) => SourceAddressModel(candidate).matches(route);

  assert.equal(matches(feed_url, "/wxmp/wow36kr"), true);
  // 源地址上的 query 有无、多少、顺序都不影响同源判定
  assert.equal(matches("https://prod.example/rss/wxmp/wow36kr", "/wxmp/wow36kr"), true);
  assert.equal(matches("https://prod.example/rss/wxmp/wow36kr?a=1&a=2", "/wxmp/wow36kr"), true);
  assert.equal(matches(feed_url, "/wxmp/other"), false);
  // 同一条 route 的 /atom 地址与 /rss 地址视为同一个源（公开性判定与格式无关）
  assert.equal(matches("https://prod.example/atom/wxmp/wow36kr", "/wxmp/wow36kr"), true);
  assert.equal(matches("https://prod.example/atom/wxmp/other", "/wxmp/wow36kr"), false);
});

test("路径会解码且坏 URL、坏编码与 token 地址不参与公开判定", () => {
  assert.equal(
    SourceAddressModel("https://prod.example/rss/author/%E5%BC%A0%E4%B8%89")
      .matches("/author/%E5%BC%A0%E4%B8%89"),
    true,
  );
  assert.equal(
    SourceAddressModel("https://prod.example/rss/author/%E0%A4%A")
      .matches("/author/%E0%A4%A"),
    false,
  );
  assert.equal(SourceAddressModel("not a URL").is_route(), false);
  assert.equal(SourceAddressModel("https://prod.example/rss/wxmp/wow36kr?token=secret").is_route(), false);
});

test("{{hostname}} 模板归一为占位 origin 后复用同一套地址规则", () => {
  assert.equal(SourceAddressModel.HOST_TOKEN, "{{hostname}}");
  assert.equal(
    SourceAddressModel.feed_url_template("{{hostname}}/rss/wxmp/wow36kr"),
    "https://template.invalid/rss/wxmp/wow36kr",
  );
  assert.equal(SourceAddressModel.feed_url_template("https://prod.example/rss/wxmp/wow36kr"), null);
  assert.equal(SourceAddressModel.feed_url_template("{{hostname}}"), "https://template.invalid/");
  assert.equal(SourceAddressModel.feed_url_template(42), null);

  assert.deepEqual(route_of("{{hostname}}/rss/wxmp/wow36kr?offset=1"), {
    route_pathname: "/wxmp/wow36kr",
    format: "rss",
  });
  assert.deepEqual(route_of("{{hostname}}/atom/wxmp/wow36kr?offset=1"), {
    route_pathname: "/wxmp/wow36kr",
    format: "atom",
  });
  assert.equal(SourceAddressModel("{{hostname}}/feed.xml").is_route(), false);
  assert.equal(SourceAddressModel("{{hostname}}/rss/wxmp/wow36kr?token=secret").is_route(), false);
  assert.equal(SourceAddressModel("{{hostname}}/rss/wxmp/wow36kr").matches("/wxmp/wow36kr"), true);
  assert.equal(SourceAddressModel("{{hostname}}/rss/wxmp/wow36kr?offset=1").matches("/wxmp/wow36kr"), true);
  assert.equal(SourceAddressModel("{{hostname}}/atom/wxmp/wow36kr").matches("/wxmp/wow36kr"), true);
  assert.equal(SourceAddressModel("{{hostname}}/rss/wxmp/wow36kr").is_template, true);
  assert.equal(SourceAddressModel("https://prod.example/rss/wxmp/wow36kr").is_template, false);
});

test("resolve 替换模板并透传普通地址", () => {
  assert.equal(
    SourceAddressModel.resolve_feed_url("{{hostname}}/rss/wxmp/wow36kr", "https://discover-beta.findrss.cloud"),
    "https://discover-beta.findrss.cloud/rss/wxmp/wow36kr",
  );
  assert.equal(
    SourceAddressModel.resolve_feed_url("{{hostname}}/rss/a?x=1", "http://127.0.0.1:8789/"),
    "http://127.0.0.1:8789/rss/a?x=1",
  );
  assert.equal(
    SourceAddressModel.resolve_feed_url("https://prod.example/feed.xml", "https://discover.findrss.cloud"),
    "https://prod.example/feed.xml",
  );
  assert.equal(
    SourceAddressModel.resolve_feed_url("{{hostname}}/rss/a", "not an origin"),
    "{{hostname}}/rss/a",
  );
  // 实例方法与静态函数同源
  assert.equal(
    SourceAddressModel("{{hostname}}/rss/a").resolve("https://x.example"),
    "https://x.example/rss/a",
  );
});
