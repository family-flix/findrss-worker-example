import assert from "node:assert/strict";
import test from "node:test";
import { discovery_feed_defaults, discovery_feed_preview, fetch_discovery_avatar } from "../server/infra/feed_fetch.js";
import { admin_discovery_preview } from "../server/service/worker/discovery.js";
import { FINDRSS_LOGO_PNG } from "../server/lib/brand.js";
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
  const xml = count => '<rss><channel><title>微博</title><item><title>文章</title><description>' + '&lt;'.repeat(count) + '</description></item></channel></rss>';
  assert.equal(discovery_feed_defaults(xml(1008), "https://example.com/feed").title, "微博");
  assert.equal(discovery_feed_defaults(xml(5000), "https://example.com/feed").title, "微博");
  assert.throws(() => discovery_feed_defaults(xml(5001), "https://example.com/feed"), /Entity expansion limit exceeded: 5001 > 5000/);
});
test("模板使用 FINDRSS_HOSTNAME，管理员预览走内部专用路由，外部私网地址拒绝", async () => {
  let called;
  const env = {
    FINDRSS_HOSTNAME: "http://127.0.0.1:8787",
    APPLICATION: {
      async fetch(request) {
        called = request;
        return new Response('<rss><channel><title>账号</title><category>science</category></channel></rss>');
      }
    }
  };
  const request = feed_url => new Request("https://admin/admin/api/discovery/preview", {
    method: "POST",
    body: JSON.stringify({
      feed_url
    })
  });
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
test("添加微博订阅时，同源头像走内部图片代理并保留上游 Referer", async t => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const avatar_url = "https://tvax3.sinaimg.cn/crop.0.0.1080.1080.1024/avatar.jpg";
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  const upstream = [];
  globalThis.fetch = async (url, options) => {
    upstream.push(url);
    assert.equal(url, avatar_url);
    assert.equal(options.headers.referer, "https://weibo.com/");
    assert.equal(options.headers.cookie, undefined);
    assert.equal(options.headers.authorization, undefined);
    return new Response(png, {
      headers: {
        "Content-Type": "image/png"
      }
    });
  };
  for (const origin of ["http://127.0.0.1:8787", "https://feeds.example"]) {
    const calls = [];
    const proxy_url = origin + "/img/weibo?url=" + encodeURIComponent(avatar_url);
    const env = {
      FINDRSS_HOSTNAME: origin,
      APPLICATION: {
        fetch(request) {
          const url = new URL(request.url);
          calls.push(url.pathname);
          if (url.pathname === "/_admin/feed/rss/weibo/u/123") {
            return new Response(`<rss><channel><title>微博用户</title><image><url>${proxy_url}</url></image></channel></rss>`);
          }
          assert.equal(url.pathname, "/_public/feed/raw/img/weibo");
          assert.equal(url.searchParams.get("url"), avatar_url);
          assert.equal(request.headers.get("Cookie"), null);
          assert.equal(request.headers.get("Authorization"), null);
          assert.equal(request.headers.get("X-Api-Access-Token-ID"), "");
          return Response.json({
            raw: {
              url: avatar_url,
              headers: {
                Referer: "https://weibo.com/"
              }
            },
            route: {
              allowed_hosts: ["tvax3.sinaimg.cn"]
            },
            version: "1",
            headers: {
              "Cache-Control": "public, max-age=120"
            }
          });
        }
      }
    };
    const response = await admin_discovery_preview(env, new Request(origin + "/admin/api/discovery/preview", {
      method: "POST",
      headers: {
        Cookie: "admin_session=private",
        Authorization: "Bearer private"
      },
      body: JSON.stringify({
        feed_url: "{{hostname}}/rss/weibo/u/123"
      })
    }));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.avatar_error, "");
    assert.equal(data.defaults.avatar_url, proxy_url);
    assert.equal(data.avatar.content_type, "image/png");
    assert.deepEqual(Buffer.from(data.avatar.data, "base64"), Buffer.from(png));
    assert.deepEqual(calls, ["/_admin/feed/rss/weibo/u/123", "/_public/feed/raw/img/weibo"]);
  }
  assert.equal(upstream.length, 2);
});
test("本地默认头像直接读取品牌图片，不请求回环网络", async t => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () => assert.fail("默认头像不应发起网络请求");
  const origin = "http://127.0.0.1:8787";
  const env = {
    FINDRSS_HOSTNAME: origin,
    APPLICATION: {
      fetch: () => new Response(`<rss><channel><title>微博</title><image><url>${origin}/findrss-logo.png</url></image></channel></rss>`)
    }
  };
  const response = await admin_discovery_preview(env, new Request(origin + "/admin/api/discovery/preview", {
    method: "POST",
    body: JSON.stringify({
      feed_url: "{{hostname}}/rss/weibo/u/123"
    })
  }));
  const data = await response.json();
  assert.equal(data.avatar_error, "");
  assert.deepEqual(Buffer.from(data.avatar.data, "base64"), Buffer.from(FINDRSS_LOGO_PNG));
});
test("同源头像读取不放开其他私网地址、凭证地址或重定向目标", async () => {
  const options = {
    local_origin: "http://127.0.0.1:8787",
    fetch_local: async () => new Response(null, {
      status: 302,
      headers: {
        Location: "http://192.168.1.1/private"
      }
    })
  };
  for (const url of ["http://127.0.0.1:2022/avatar", "http://192.168.1.1/avatar", "http://user:password@127.0.0.1:8787/img/weibo", "http://127.0.0.1:8787/img/weibo"]) {
    await assert.rejects(fetch_discovery_avatar(url, options), /头像地址被拒绝/);
  }
});
test("模板预览仅接受 RSS/Atom 路径，错误地址不触发抓取", async () => {
  const env = {
    FINDRSS_HOSTNAME: "http://127.0.0.1:8787",
    APPLICATION: {
      fetch() {
        assert.fail("无效模板不应读取订阅源");
      }
    }
  };
  for (const feed_url of ["{{hostname}}", "{{hostname}}/feed.xml", "{{hostname}}/admin", "{{hostname}}/rss-other/test", "{{hostname}}/atom.xml", "{{hostname}}.example.com/rss/test", "{{hostname}}/rss/../../admin", "{{hostname}}/atom/%2e%2e/feed.xml"]) {
    const response = await admin_discovery_preview(env, new Request("https://admin/admin/api/discovery/preview", {
      method: "POST",
      body: JSON.stringify({
        feed_url
      })
    }));
    assert.equal(response.status, 400, feed_url);
    assert.equal((await response.json()).error, "模板订阅源地址必须以 {{hostname}}/rss/ 或 {{hostname}}/atom/ 开头");
  }
});
test("脚本预览不依赖公开域名配置，透传参数并解析真实 RSS/Atom；失败不当成成功", async () => {
  let called;
  let xml = '<rss><channel><title>用户文章</title><item><title>文章一</title><link>https://example.com/1</link><description>&lt;b&gt;简介&lt;/b&gt;</description></item></channel></rss>';
  const env = {
    APPLICATION: {
      fetch(request) {
        called = request;
        return new Response(xml);
      }
    }
  };
  const request = () => new Request("https://api/admin/api/discovery/preview", {
    method: "POST",
    body: JSON.stringify({
      feed_url: "/rss/weibo/u/123?offset=a%26b",
      include_feed: true,
      script_id: "script-123"
    })
  });
  const result = await admin_discovery_preview(env, request());
  const data = await result.json();
  assert.equal(called.url, "https://internal/_admin/feed/rss/weibo/u/123?offset=a%26b");
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
  env.APPLICATION = {
    fetch: () => new Response('{"error":"设备离线"}', {
      status: 503
    })
  };
  assert.equal((await admin_discovery_preview(env, request())).status, 503);
  const invalid = new Request("https://api/admin/api/discovery/preview", {
    method: "POST",
    body: JSON.stringify({
      feed_url: "/rss/weibo/u/123",
      include_feed: true,
      script_id: "bad\r\nheader"
    })
  });
  assert.equal((await admin_discovery_preview(env, invalid)).status, 400);
});
test("预览保留全部文章、正文与 XML 字段，同时过滤不安全链接", () => {
  const xml = '<rss><channel><title>源</title>' + Array.from({
    length: 201
  }, () => '<item><title>文章</title><link>javascript:alert(1)</link><description>' + 'a'.repeat(3000) + '</description></item>').join('') + '</channel></rss>';
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
  assert.deepEqual(article.attachments[1], {
    url: "https://example.com/file.pdf?q=a&b=2",
    type: "application/pdf",
    length: "54321",
    key: ""
  });
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
