import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { FeedModel } from "../server/domain/feed_format.js";
import { create_feed_parser } from "@findrss/feed-fetch";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { compile_script_module, execute_script } = await import("../server/infra/script_sandbox.js");
const source = await readFile(new URL("../examples/scripts/rss/github.js", import.meta.url), "utf8");
const compiled = await compile_script_module(source);
assert.equal(compiled.error, "");
const run = async (params = {}) => {
  const result = await execute_script(source, compiled.metadata, null, {
    method: "GET", pathname: "/github/ltaoo/wx_channels_download/release",
    params: { org: "ltaoo", pro: "wx_channels_download", ...params }, query: {},
  });
  return JSON.parse(result.output);
};
const entry = (tag, time, extra = "") => `<entry>
  <id>tag:github.com,2008:Repository/865292903/${tag}</id>
  <link rel="self" href="https://api.github.com/releases/${tag}"/>
  <link rel="alternate" href="https://github.com/ltaoo/wx_channels_download/releases/tag/${tag}"/>
  <title>${tag} &amp; fixes</title><updated>${time}</updated>
  <author><name>github-actions[bot]</name></author>
  <content type="html">&lt;p&gt;修复 &amp;amp; 优化&lt;/p&gt;
&lt;pre&gt;&lt;code&gt;line 1
  line 2&lt;/code&gt;&lt;/pre&gt;</content>${extra}
</entry>`;
const fixture = entries => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-US">
  <title>Release notes from wx_channels_download</title><updated>2026-10-26T01:00:00Z</updated>${entries}
</feed>`;

test("GitHub 发布路由匿名请求 Atom，保留版本、正文缩进、作者和更新时间，输出 RSS/Atom", async t => {
  assert.equal(compiled.metadata.version, "1.1.0");
  assert.equal(compiled.metadata.kind, "rss");
  assert.deepEqual(compiled.metadata.routes.map(route => route.path), ["/github/:org/:pro/release"]);
  assert.equal(compiled.metadata.platform.name, "GitHub");
  assert.equal(XMLValidator.validate(compiled.metadata.platform.icon), true);
  assert.equal(compiled.metadata.platform.icon, (await readFile(new URL("../public/platform-icons/github.svg", import.meta.url), "utf8")).trim());
  assert.deepEqual(compiled.metadata.permissions.cookies, []);
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const first = entry("v1.1.0", "2026-10-26T01:00:00Z");
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://github.com/ltaoo/wx_channels_download/releases.atom");
    const headers = new Headers(options.headers);
    assert.match(headers.get("accept"), /application\/atom\+xml/);
    assert.match(headers.get("user-agent"), /Macintosh.*Chrome\//);
    assert.equal(headers.get("referer"), "https://github.com/ltaoo/wx_channels_download/releases");
    assert.equal(headers.has("cookie"), false);
    return new Response(fixture(first + first + entry("v1.0.0-rc.1", "2026-10-25T01:00:00Z")));
  };
  const feed = await run();
  assert.equal(feed.title, "ltaoo/wx_channels_download Releases");
  assert.equal(feed.link, "https://github.com/ltaoo/wx_channels_download/releases");
  assert.equal(feed.language, "en-US");
  assert.equal(feed.items.length, 2);
  assert.equal(feed.items[1].title, "v1.0.0-rc.1 & fixes");
  assert.equal(feed.items[0].id, "tag:github.com,2008:Repository/865292903/v1.1.0");
  assert.equal(feed.items[0].title, "v1.1.0 & fixes");
  assert.equal(feed.items[0].link, "https://github.com/ltaoo/wx_channels_download/releases/tag/v1.1.0");
  assert.equal(feed.items[0].author, "github-actions[bot]");
  assert.equal(feed.items[0].published, undefined);
  assert.equal(feed.items[0].updated, "2026-10-26T01:00:00.000Z");
  assert.match(feed.items[0].content, /<p>修复 &amp; 优化<\/p>/);
  assert.match(feed.items[0].content, /<code>line 1\n  line 2<\/code>/);
  for (const format of ["rss", "atom"]) {
    const xml = FeedModel(feed).render(format);
    assert.equal(XMLValidator.validate(xml), true);
    const parsed = create_feed_parser(XMLParser, XMLValidator).parse_feed_document(xml, feed.link);
    assert.equal(parsed.articles.length, 2);
    assert.match(parsed.articles[0].content_html, /line 1\n  line 2/);
  }
});

test("GitHub 空发布列表正常返回，显式发布时间保留，未提供时间时不补采集时间", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response(fixture(""));
  assert.deepEqual((await run()).items, []);
  globalThis.fetch = async () => new Response(fixture(entry("v1", "2026-10-26T01:00:00Z", "<published>2026-10-25T01:00:00Z</published>")));
  assert.equal((await run()).items[0].published, "2026-10-25T01:00:00.000Z");
  globalThis.fetch = async () => new Response(fixture(entry("v1", "2026-10-26T01:00:00Z")).replace(/<updated>[^<]*<\/updated>/g, ""));
  const feed = await run();
  assert.equal(feed.items[0].published, undefined);
  assert.equal(feed.items[0].updated, undefined);
  assert.equal(feed.updated, undefined);
});

test("GitHub 非法仓库参数在出网前拒绝，登录页和 HTTP 错误不会变成空列表", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => assert.fail("Invalid parameters must not request upstream");
  for (const params of [{ org: "" }, { org: "../other" }, { org: "x?y" }, { pro: ".." }, { pro: "." }, { pro: "a/b" }, { pro: "x#y" }, { pro: "x".repeat(101) }]) {
    await assert.rejects(run(params), error => error.problem.code === "INVALID_PARAMETER");
  }
  globalThis.fetch = async () => new Response("<html>Sign in to GitHub</html>");
  await assert.rejects(run(), error => error.problem.code === "UPSTREAM_INVALID_RESPONSE");
  for (const [status, code] of [[403, "UPSTREAM_ACCESS_DENIED"], [429, "UPSTREAM_RATE_LIMITED"], [404, "UPSTREAM_FETCH_FAILED"]]) {
    globalThis.fetch = async () => new Response("Unavailable", { status });
    await assert.rejects(run(), error => error.problem.code === code);
  }
});
