import assert from "node:assert/strict";
import test from "node:test";
import { ScriptFeedPreviewModel } from "../components/script_feed.js";
import { FeedModel } from "../../server/domain/feed_format.js";

test("RSSScript 的 feed JSON 使用公开路由的序列化器，频道与条目来自生成的 XML", () => {
  const feed = {
    title: "频道 & 测试", link: "https://example.com/blog/", description: "频道简介",
    image: "https://example.com/logo.png", items: [
      { title: "文章", link: "/post/1", published: 1720000000,
        content: "<p>完整正文</p>", image: "https://example.com/cover.png" },
    ],
  };
  const self_url = "https://worker.example/rss/test?limit=1";
  const preview = ScriptFeedPreviewModel(JSON.stringify(feed), self_url);
  assert.equal(preview.error, "");
  assert.equal(preview.xml, FeedModel.fromValue(feed).render("rss", { self_url }));
  assert.equal(preview.feed.title, "频道 & 测试");
  assert.equal(preview.feed.description, "频道简介");
  assert.equal(preview.feed.icon, feed.image);
  assert.equal(preview.feed.articles[0].summary, "完整正文");
  assert.equal(preview.feed.articles[0].link, "https://example.com/post/1");
  assert.equal(preview.feed.articles[0].published_at, 1720000000000);
  assert.equal(preview.feed.articles[0].thumbnail, feed.items[0].image);
});

test("RSS XML 保留原响应，解析 CDATA、命名空间和实体，拒绝危险的链接和图片", () => {
  const xml = `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
    <channel><title>频道</title><link>https://example.com/</link><description>简介</description>
      <image><url>javascript:alert(1)</url></image>
      <item><title>A &amp; B</title><link>javascript:alert(1)</link>
        <content:encoded><![CDATA[<p>正文</p><script>evil()</script><img src="data:image/svg+xml,bad" onerror="evil()">]]></content:encoded>
      </item><item><title>相对路径</title><link>/second</link></item>
    </channel></rss>`;
  const result = ScriptFeedPreviewModel(xml);
  assert.equal(result.xml, xml);
  assert.equal(result.error, "");
  assert.equal(result.feed.icon, "");
  assert.equal(result.feed.articles[0].title, "A & B");
  assert.equal(result.feed.articles[0].link, "");
  assert.equal(result.feed.articles[0].thumbnail, "");
  assert.equal(result.feed.articles[0].summary, "正文");
  assert.equal(result.feed.articles[1].link, "https://example.com/second");
});

test("Atom 频道和 entry 支持相对链接、HTML 摘要与发布时间", () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom 频道</title>
    <subtitle>简介</subtitle><link href="https://example.com/blog/"/><logo>/logo.png</logo>
    <entry><id>1</id><title>文章</title><link href="/post/1"/><published>2026-10-15T00:00:00Z</published>
    <summary type="html">&lt;p&gt;摘要&lt;/p&gt;</summary></entry></feed>`;
  const result = ScriptFeedPreviewModel(xml);
  assert.equal(result.error, "");
  assert.equal(result.feed.kind, "atom");
  assert.equal(result.feed.icon, "https://example.com/logo.png");
  assert.equal(result.feed.articles[0].summary, "摘要");
  assert.equal(result.feed.articles[0].published_at, Date.parse("2026-10-15T00:00:00Z"));
});

test("未运行、空频道、无效 XML 和非 feed 输出都有明确状态，失败保留响应", () => {
  assert.equal(ScriptFeedPreviewModel("").empty, true);
  const empty = ScriptFeedPreviewModel(JSON.stringify({ title: "空频道", items: [] }));
  assert.equal(empty.error, "");
  assert.equal(empty.feed.articles.length, 0);
  for (const source of ["<rss><channel></rss>", "<html><body>登录</body></html>", "{}", "null"]) {
    const result = ScriptFeedPreviewModel(source);
    assert.equal(result.empty, false);
    assert.equal(result.feed, null);
    assert.match(result.error, /无法生成预览/);
    assert.equal(result.xml, source);
  }
});

test("卡片代理图片使用管理员草稿入口，外站图片和原始 XML 地址保持原样", () => {
  const endpoint = "/admin/api/scripts/preview-assets/11111111-1111-4111-8111-111111111111";
  const origin = "https://feeds.example";
  const icon = origin + "/img/draft/icon?url=https%3A%2F%2Fcdn.example%2Ficon.png";
  const cover = origin + "/img/draft/cover?url=https%3A%2F%2Fcdn.example%2Fcover.png";
  const source = JSON.stringify({ title: "草稿", link: "https://example.com/", image: icon,
    items: [{ title: "封面", link: "https://example.com/1", image: cover },
      { title: "外站", image: "https://other.example/img/draft/cover" },
      { title: "其他路由", image: origin + "/other.png" }] });
  const result = ScriptFeedPreviewModel(source, origin + "/rss/draft", {
    endpoint, public_origin: origin, paths: ["/img/draft/:kind"],
  });
  assert.equal(result.error, "");
  assert.equal(result.feed.icon, endpoint + "?url=" + encodeURIComponent(icon));
  assert.equal(result.feed.articles[0].thumbnail, endpoint + "?url=" + encodeURIComponent(cover));
  assert.equal(result.feed.articles[1].thumbnail, "https://other.example/img/draft/cover");
  assert.equal(result.feed.articles[2].thumbnail, origin + "/other.png");
  assert.equal(result.xml, ScriptFeedPreviewModel(source, origin + "/rss/draft").xml);
  assert.equal(result.xml.includes(endpoint), false);
});
