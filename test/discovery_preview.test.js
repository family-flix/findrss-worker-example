import assert from "node:assert/strict";
import test from "node:test";
import { discovery_feed_defaults, discovery_feed_preview, fetch_discovery_avatar } from "../server/infra/feed_fetch.js";
import { admin_discovery_preview } from "../server/service/worker/discovery.js";

test("RSS 和 Atom 读取 feed 元数据，不把文章分类当源标签", () => {
  const rss = discovery_feed_defaults(`<rss version="2.0"><channel><title>科技日报</title><link>https://example.com/</link><description>介绍</description><image><url>https://example.com/icon.png</url></image><category>technology</category><item><title>文章</title><category>article-only</category></item></channel></rss>`, "https://example.com/feed");
  assert.equal(rss.title, "科技日报");
  assert.equal(rss.avatar_url, "https://example.com/icon.png");
  assert.deepEqual(rss.tags, ["technology"]);
  const atom = discovery_feed_defaults(`<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><subtitle>简介</subtitle><link href="https://example.com/"/><icon>https://example.com/icon.png</icon><category term="science"/></feed>`, "https://example.com/feed");
  assert.equal(atom.description, "简介");
  assert.equal(atom.website, "https://example.com/");
  assert.deepEqual(atom.tags, ["science"]);
  assert.throws(() => discovery_feed_defaults("<html>not a feed</html>", "https://example.com"));
});

test("目录元数据允许 5000 次实体展开，超过上限仍拒绝", () => {
  const xml = (count) => '<rss><channel><title>微博</title><item><title>文章</title><description>'
    + '&lt;'.repeat(count) + '</description></item></channel></rss>';
  assert.equal(discovery_feed_defaults(xml(1008), "https://example.com/feed").title, "微博");
  assert.equal(discovery_feed_defaults(xml(5000), "https://example.com/feed").title, "微博");
  assert.throws(() => discovery_feed_defaults(xml(5001), "https://example.com/feed"),
    /Entity expansion limit exceeded: 5001 > 5000/);
});

test("模板使用 FINDRSS_HOSTNAME，管理员预览走内部专用路由，外部私网地址拒绝", async () => {
  let called;
  const env = { FINDRSS_HOSTNAME: "http://127.0.0.1:8787", API: { getByName() { return { async fetch(request) {
    called = request;
    return new Response('<rss><channel><title>账号</title><category>science</category></channel></rss>');
  } }; } } };
  const request = (feed_url) => new Request("https://admin/admin/api/discovery/preview", { method: "POST", body: JSON.stringify({ feed_url }) });
  const result = await admin_discovery_preview(env, request("{{hostname}}/atom/wxmp/gh_test?offset=1"));
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.feed_url, "http://127.0.0.1:8787/atom/wxmp/gh_test?offset=1");
  assert.equal(called.url, "https://internal/_admin/feed/atom/wxmp/gh_test?offset=1");
  assert.equal(data.defaults.source_type, "wxmp");
  assert.equal(data.defaults.category, "science");
  assert.equal(data.feed, undefined);
  assert.equal((await admin_discovery_preview(env, request("http://127.0.0.1:2022/private"))).status, 502);
  await assert.rejects(fetch_discovery_avatar("http://127.0.0.1/avatar"), /被拒绝/);
});

test("脚本预览不依赖公开域名配置，透传参数并解析真实 RSS/Atom；失败不当成成功", async () => {
  let called;
  let xml = '<rss><channel><title>用户文章</title><item><title>文章一</title><link>https://example.com/1</link><description>&lt;b&gt;简介&lt;/b&gt;</description></item></channel></rss>';
  const env = { API: { getByName() { return { fetch(request) { called = request; return new Response(xml); } }; } } };
  const request = () => new Request("https://api/admin/api/discovery/preview", { method: "POST",
    body: JSON.stringify({ feed_url: "/rss/weibo/123?offset=a%26b", include_feed: true, script_id: "script-123" }) });
  const result = await admin_discovery_preview(env, request());
  const data = await result.json();
  assert.equal(called.url, "https://internal/_admin/feed/rss/weibo/123?offset=a%26b");
  assert.equal(called.headers.get("X-RSS-Preview-Script-ID"), "script-123");
  assert.equal(data.feed.title, "用户文章");
  assert.equal(data.feed.articles[0].summary, "简介");
  assert.equal(data.xml, xml);
  xml = '<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><entry><title>Atom 文章</title><link href="https://example.com/atom"/><summary>简介</summary></entry></feed>';
  assert.equal((await (await admin_discovery_preview(env, request())).json()).feed.articles[0].title, "Atom 文章");
  xml = "<html>not RSS</html>";
  const invalid_xml = await admin_discovery_preview(env, request());
  assert.equal(invalid_xml.status, 422);
  assert.equal((await invalid_xml.json()).xml, xml);
  env.API.getByName = () => ({ fetch: () => new Response('{"error":"设备离线"}', { status: 503 }) });
  assert.equal((await admin_discovery_preview(env, request())).status, 503);
  const invalid = new Request("https://api/admin/api/discovery/preview", { method: "POST",
    body: JSON.stringify({ feed_url: "/rss/weibo/123", include_feed: true, script_id: "bad\r\nheader" }) });
  assert.equal((await admin_discovery_preview(env, invalid)).status, 400);
});

test("预览保留全部文章、正文与 XML 字段，同时过滤不安全链接", () => {
  const xml = '<rss><channel><title>源</title>' + Array.from({ length: 201 }, () =>
    '<item><title>文章</title><link>javascript:alert(1)</link><description>' + 'a'.repeat(3000) + '</description></item>').join('') + '</channel></rss>';
  const feed = discovery_feed_preview(xml, "https://example.com/feed");
  assert.equal(feed.total_count, 201);
  assert.equal(feed.articles.length, 201);
  assert.equal(feed.articles[0].link, "");
  assert.equal(feed.articles[0].summary.length, 3000);
  assert.equal(feed.articles[0].content_html.length, 3000);
  assert.equal(feed.articles[0].xml_fields.link, "javascript:alert(1)");
  assert.equal(feed.icon, "");
  assert.equal(feed.validation.ok, true);
});

test("RSS 频道图标、封面、多图、媒体、普通附件和扩展属性完整可检查", () => {
  const feed = discovery_feed_preview(`<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
    <title>频道</title><link>https://example.com/</link><image><url>/avatar.png</url><title>头像</title></image><language>zh-cn</language>
    <item><guid isPermaLink="false">id-1</guid><title>文章</title><author>作者</author><category>技术</category>
      <content:encoded><![CDATA[<p>完整正文<img src="/inline.png"></p>]]></content:encoded>
      <media:thumbnail url="/cover.jpg"/><media:content url="/photo.jpg" type="image/jpeg"/>
      <media:content url="/video.mp4" type="video/mp4" key="decrypt-key" width="1920" height="1080"/>
      <enclosure url="/audio.mp3" type="audio/mpeg" length="12345"/><enclosure url="/file.pdf?q=a&amp;b=2" type="application/pdf" length="54321"/>
    </item></channel></rss>`, "https://example.com/feed");
  assert.equal(feed.icon, "https://example.com/avatar.png");
  assert.equal(feed.xml_fields.language, "zh-cn");
  const article = feed.articles[0];
  assert.equal(article.thumbnail, "https://example.com/cover.jpg");
  assert.ok(article.images.includes("https://example.com/photo.jpg"));
  assert.ok(article.media.some(media => media.kind === "audio"));
  assert.ok(article.media.some(media => media.key === "decrypt-key"));
  assert.equal(article.xml_fields.author, "作者");
  assert.equal(article.xml_fields.guid["@_isPermaLink"], "false");
  assert.match(article.content_html, /完整正文/);
  assert.deepEqual(article.attachments[1], { url: "https://example.com/file.pdf?q=a&b=2", type: "application/pdf", length: "54321", key: "" });
});

test("Atom logo 和 enclosure 保留，宽容解析不会掩盖原 XML 的语法错误", () => {
  const feed = discovery_feed_preview(`<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><logo>https://example.com/logo.png</logo>
    <entry><id>item-id</id><title>附件</title><author><name>作者</name></author><updated>2026-10-12T00:00:00Z</updated>
    <link rel="enclosure" href="https://example.com/file.zip" type="application/zip" length="123"/></entry></feed>`, "https://example.com/feed");
  assert.equal(feed.icon, "https://example.com/logo.png");
  assert.equal(feed.articles[0].attachments[0].type, "application/zip");
  assert.equal(feed.articles[0].xml_fields.author.name, "作者");
  assert.equal(feed.articles[0].xml_fields.updated, "2026-10-12T00:00:00Z");
  const lenient = discovery_feed_preview("<rss><channel><title>A & B</title></channel></rss>", "https://example.com/feed");
  assert.equal(lenient.validation.ok, false);
});
