import assert from "node:assert/strict";
import test from "node:test";
import { ARTICLE_MAX_BYTES, fetch_article_document } from "@findrss/feed-fetch";

import { fetch_source_article, fetch_source_feed } from "../server/infra/feed_fetch.js";

test("原文默认允许超过 2MiB，仍拒绝超过 8MiB 的响应", async () => {
  assert.equal(ARTICLE_MAX_BYTES, 8 * 1024 * 1024);
  for (const size of [3 * 1024 * 1024, ARTICLE_MAX_BYTES, ARTICLE_MAX_BYTES + 1]) {
    const html = "x".repeat(size);
    const result = await fetch_article_document({
      article_url: "https://example.com/article",
      fetch_impl: async () => new Response(html),
    });
    assert.equal(result.error, size > ARTICLE_MAX_BYTES ? "原文内容过大" : "");
    assert.equal(result.html, size > ARTICLE_MAX_BYTES ? "" : html);
  }
});

test("API 共用抓取内核可按源配置抓取并解析订阅源", async () => {
  let requested_url = "";
  let requested_headers = {};
  const result = await fetch_source_feed({
    feed_url: "https://example.com/feed.xml?old=1",
    settings: { headers: { user_agent: "FindRSS-Test" } },
    options: {
      extra_query: [{ name: "old", value: "2" }],
      headers: { custom: [{ name: "X-Source", value: "yes" }] },
    },
    fetch_impl: async (url, init) => {
      requested_url = url;
      requested_headers = init.headers;
      return new Response(`<?xml version="1.0"?><rss version="2.0"><channel>
        <title>共享源</title><link>https://example.com/</link>
        <item><title>文章</title><link>https://example.com/a</link></item>
      </channel></rss>`, { headers: { ETag: '"v1"' } });
    },
  });

  assert.equal(result.error, "");
  assert.equal(result.etag, '"v1"');
  assert.equal(result.feed.title, "共享源");
  assert.equal(result.feed.articles[0].link, "https://example.com/a");
  assert.equal(requested_url, "https://example.com/feed.xml?old=2");
  assert.equal(requested_headers["user-agent"], "FindRSS-Test");
  assert.equal(requested_headers["x-source"], "yes");
});

test("API 共用抓取内核直接从 HTML 抽正文，不执行网页 JavaScript", async () => {
  const result = await fetch_source_article({
    article_url: "https://example.com/posts/1",
    options: { rules: { remove_selectors: [".ad"] } },
    fetch_impl: async () => new Response(`<!doctype html><html><body><article>
      <script>document.write("不应执行")</script><p>正文</p><p class="ad">广告</p>
      <a href="/next">下一篇</a>
    </article></body></html>`),
  });

  assert.equal(result.error, "");
  assert.match(result.content_html, /<p>正文<\/p>/);
  assert.match(result.content_html, /href="https:\/\/example\.com\/next"/);
  assert.doesNotMatch(result.content_html, /不应执行|广告/);
});

test("共用抓取内核拒绝重定向到内网", async () => {
  let calls = 0;
  const result = await fetch_source_feed({
    feed_url: "https://example.com/feed.xml",
    fetch_impl: async () => {
      calls += 1;
      return new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private" } });
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.feed, null);
  assert.equal(result.error, "订阅源重定向地址被拒绝");
});

test("API 对成功状态的空响应报告空内容，避免误报 XML 语法错误", async () => {
  const result = await fetch_source_feed({
    feed_url: "https://www.zhihu.com/rss",
    fetch_impl: async () => new Response("", { headers: { "Content-Type": "application/rss+xml", "Content-Length": "0" } }),
  });
  assert.equal(result.error, "订阅源返回了空内容（HTTP 200），未提供 RSS/Atom/JSON Feed 数据");
  assert.equal(result.http_status, 200);
  assert.equal(result.size_bytes, 0);
  assert.equal(result.feed, null);
});
