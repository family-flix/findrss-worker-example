import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./support/quickjs_wasm_hook.js", import.meta.url);
const { compile_script_module, execute_script } = await import("../server/infra/script_sandbox.js");
const source = body => `import { utils } from '@findrss/util';
export const route = { path: '/util', name: utils.decode_html('工具 &amp; 测试'), async handler(ctx) { ${body} } };`;
async function run(body, mock_ctx = "") {
  const script = source(body);
  const compiled = await compile_script_module(script);
  assert.equal(compiled.error, "");
  assert.equal(compiled.metadata.routes[0].name, "工具 & 测试");
  const result = await execute_script(script, compiled.metadata, null, undefined, [], mock_ctx);
  return JSON.parse(result.output);
}
function assert_errors(results, code = "UPSTREAM_INVALID_RESPONSE") {
  for (const result of results) {
    assert.equal(result.data, null);
    assert.equal(result.error.code, code);
  }
}

test("RSS 2.0、RSS 1.0 和 Atom 解析保留原始正文与日期，不补发布时间", async () => {
  const value = await run(`return {
    rss: utils.feed_items('<rss><channel><item><guid>post</guid><title>文章 &amp; 内容</title><link>/post</link><content:encoded><![CDATA[<p>正文</p>]]></content:encoded><pubDate>Tue, 13 Oct 2026 00:00:00 GMT</pubDate></item></channel></rss>', 'https://example.com/'),
    atom: utils.feed_items('<feed><entry><id>entry</id><title>标题</title><link rel="self" href="/api/entry"/><link href="/entry"/><updated>2026-10-14T00:00:00Z</updated><summary>说明</summary></entry></feed>', 'https://example.com/'),
    rdf: utils.feed_items('<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><channel><title>频道</title></channel><item rdf:about="https://example.com/story"><title>RSS 1.0 标题</title><link>https://example.com/story</link><description><![CDATA[<p>说明</p>]]></description></item></rdf:RDF>'),
    invalid: [utils.feed_items('<html>登录页</html>'), utils.feed_items('<!DOCTYPE rss><rss/>')],
    parent: utils.document_nodes('<div><p>文本</p></div>').data.children[0].children[0].parent.tag,
  };`);
  assert.equal(value.rss.error, null);
  assert.equal(value.rss.data[0].link, 'https://example.com/post');
  assert.equal(value.rss.data[0].title, '文章 & 内容');
  assert.equal(value.rss.data[0].content, '<p>正文</p>');
  assert.equal(value.rss.data[0].published, 'Tue, 13 Oct 2026 00:00:00 GMT');
  assert.equal(value.atom.data[0].link, 'https://example.com/entry');
  assert.equal(value.atom.data[0].published, undefined);
  assert.equal(value.atom.data[0].updated, '2026-10-14T00:00:00Z');
  assert.equal(value.rdf.data.length, 1);
  assert.equal(value.rdf.data[0].id, 'https://example.com/story');
  assert.equal(value.rdf.data[0].title, 'RSS 1.0 标题');
  assert.equal(value.rdf.data[0].description, '<p>说明</p>');
  assert.equal(value.rdf.data[0].published, undefined);
  assert.equal(value.parent, 'div');
  assert_errors(value.invalid);
});

test("Result 集合和文本替换直接传播错误，保留 falsy 数据并捕获回调异常", async () => {
  const value = await run(`const failed = Result.Err('失败', 'PARSE_FAILED');
    let calls = 0;
    const mapped = utils.map_results([1, 2, 3], (item) => { calls++; return item === 2 ? failed : Result.Ok(item); });
    const replaced = utils.replace_results('a b c', /[abc]/g, item => item === 'b' ? failed : Result.Ok(item.toUpperCase()));
    return { same: mapped === failed && replaced === failed, calls,
      values: utils.map_results([0, false, null], item => Result.Ok(item)),
      replaced: utils.replace_results('x1 x2', /x(\\d)/g, (match, number) => Result.Ok('item-' + number)),
      bad: [utils.map_results([1], () => 1), utils.replace_results('x', /x/, () => 'y')],
      thrown: utils.map_results([1], () => { throw new Error('回调异常'); }) };
  `);
  assert.equal(value.same, true);
  assert.equal(value.calls, 2);
  assert.deepEqual(value.values.data, [0, false, null]);
  assert.equal(value.replaced.data, 'item-1 item-2');
  assert_errors(value.bad);
  assert.deepEqual(value.thrown.error.messages, ['回调异常']);
});

test("内置工具可在模块顶层和 Mock 调试 handler 使用；禁止其它模块", async () => {
  const value = await run(`return { frozen: Object.isFrozen(utils), same: utils.decode_html === utils.decode_entities,
    parsed: utils.parseJSON('false'), mock: utils.decode_html(ctx.params.text), state: 'source' in utils || 'main' in utils };`,
  `({ params: { text: 'Mock &amp; ctx' } })`);
  assert.deepEqual(value, { frozen: true, same: true, parsed: { data: false, error: null }, mock: "Mock & ctx", state: false });
  for (const name of ["node:fs", "./private.js", "https://example.com/code.js", "@findrss/other"]) {
    const compiled = await compile_script_module(source("return {};").replace("@findrss/util", name));
    assert.match(compiled.error, /脚本不支持导入模块/);
  }
});

test("HTML 纯转换直接返回字符串，保留非法实体，剔除脚本和样式", async () => {
  const value = await run(`return {
    decoded: utils.decode_html('&AMP; &lt; &quot; &apos; &nbsp; &#65; &#x1f600; &#0; &#55296; &#1114112;'),
    once: utils.decode_entities('&amp;lt;'),
    text: utils.plain_text('<style>hidden</style><p>标题 &amp; 内容<br>第二行</p><script>hidden</script>'),
    escaped: utils.escape_html(${JSON.stringify('<a title="x">\'&</a>')}), empty: utils.escape_html(null),
  };`);
  assert.equal(value.decoded, '& < " \'   A 😀 &#0; &#55296; &#1114112;');
  assert.equal(value.once, "&lt;");
  assert.equal(value.text, "标题 & 内容\n第二行");
  assert.equal(value.escaped, "&lt;a title=&quot;x&quot;&gt;&#39;&amp;&lt;/a&gt;");
  assert.equal(value.empty, "");
});

test("URL、时间、数组和稳定 ID 校验返回 Result", async () => {
  const value = await run(`return {
    urls: [utils.absolute_url('../story?q=1#x', 'https://example.com/news/today'),
      utils.absolute_url('//cdn.example.com/a', 'http://example.com/'),
      utils.absolute_url('?page=2', 'https://example.com/a?old=1'), utils.absolute_url('https://other.com/x'), utils.absolute_url('')],
    bad_urls: ['javascript:bad', 'https://user:pass@example.com/x', 'a b', '/relative', '#only'].map(v => utils.absolute_url(v)),
    dates: [utils.timestamp(1700000000), utils.timestamp('1700000000000'), utils.timestamp('2026/10/14 08:00'), utils.timestamp(null)],
    bad_dates: ['invalid', -1, Infinity].map(v => utils.timestamp(v)),
    arrays: [utils.array_at({ data: { list: [1] } }, 'data.list'), utils.array_at([])],
    bad_arrays: [utils.array_at({}, 'data.list'), utils.array_at({ list: {} }, 'list')],
    ids: [utils.identity('  id  '), utils.identity(0), utils.identity(9007199254740993n)],
    bad_ids: ['', null, {}, 9007199254740992].map(v => utils.identity(v)),
  };`);
  assert.deepEqual(value.urls.map(r => r.data), ["https://example.com/story?q=1#x", "http://cdn.example.com/a", "https://example.com/a?page=2", "https://other.com/x", ""]);
  assert.deepEqual(value.dates.map(r => r.data), [1700000000000, 1700000000000, Date.parse("2026-10-14T00:00:00Z"), undefined]);
  assert.deepEqual(value.arrays.map(r => r.data), [[1], []]);
  assert.deepEqual(value.ids.map(r => r.data), ["id", "0", "9007199254740993"]);
  for (const key of ["bad_urls", "bad_dates", "bad_arrays", "bad_ids"]) assert_errors(value[key]);
});

test("内嵌 JSON 扫描正确处理字符串、转义和重复 marker；失败返回 Result", async () => {
  const payload = { text: '引号"、反斜线\\、括号 } ]', list: [{ n: 1 }] };
  const input = `before window.DATA = ${JSON.stringify(payload)}; after`;
  const value = await run(`const marker = /window\\.DATA\\s*=/g; marker.lastIndex = 999;
    return { first: utils.embedded_json(${JSON.stringify(input)}, marker),
      second: utils.embedded_json(${JSON.stringify(input)}, marker),
      bad: ['missing', 'DATA= {"a":', 'DATA= {broken}', 'DATA= true'].map(v => utils.embedded_json(v, /DATA=/)),
      marker: utils.embedded_json('DATA={}', 'DATA=') };`);
  assert.deepEqual(value.first.data, payload);
  assert.deepEqual(value.second.data, payload);
  assert_errors(value.bad);
  assert_errors([value.marker], "INVALID_PARAMETER");
});

test("轻量节点解析和选择器复用示例语义，XML 支持 CDATA 并拒绝 DOCTYPE", async () => {
  const html = '<section id="list"><article class="entry"><a href="https://example.com/a?x=1&amp;y=2">标题 <b>一</b></a><img src="/cover"></article><div><article class="entry">嵌套</article></div></section><script><article>隐藏</article></script>';
  const value = await run(`const parsed = utils.document_nodes(${JSON.stringify(html)});
    if (parsed.error) return parsed;
    const root = parsed.data, node = utils.first(root, '#list > article.entry');
    const xml = utils.document_nodes('<rss><item><title><![CDATA[<新闻>]]></title></item></rss>', true);
    return { count: utils.select(root, '#list article.entry').length,
      direct: utils.select(root, '#list > article.entry').length,
      title: utils.field(node, 'a'), href: utils.attribute(node, 'a[href^="https://example.com/"]', 'href'),
      matches: utils.matches(node, 'article.entry'), empty: utils.select(root, '.missing'),
      inherited: utils.select(root, '[constructor]').length,
      rows: utils.rows(root, 'article.entry').data.length, missing: utils.rows(root, '.missing'),
      xml: utils.field(xml.data, 'rss > item > title'),
      unsafe_xml: utils.document_nodes('<!DOCTYPE rss><rss/>', true) };`);
  assert.equal(value.count, 2);
  assert.equal(value.direct, 1);
  assert.equal(value.title, "标题 一");
  assert.equal(value.href, "https://example.com/a?x=1&y=2");
  assert.equal(value.matches, true);
  assert.deepEqual(value.empty, []);
  assert.equal(value.inherited, 0);
  assert.equal(value.rows, 2);
  assert.equal(value.xml, "<新闻>");
  assert_errors([value.missing, value.unsafe_xml]);
});

test("请求辅助透传 options 和失败 Result；JSON 错误可被脚本处理", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(url.endsWith('/denied') ? 'denied' : url.endsWith('/broken') ? '{broken}' : 'false',
      { status: url.endsWith('/denied') ? 403 : 200 });
  };
  const value = await run(`return {
    good: await utils.request_json(ctx, 'https://example.com/good', { method: 'POST', body: 'data', headers: { Accept: 'application/json', Referer: 'https://example.com/' } }),
    broken: await utils.request_json(ctx, 'https://example.com/broken'),
    denied: await utils.request_json(ctx, 'https://example.com/denied'),
    missing_ctx: await utils.request_text({}, 'https://example.com/'),
    thrown: await utils.request_json({ fetchText() { throw new Error('failed'); } }, 'https://example.com/'),
    invalid_mock: await utils.request_json({ fetchText() {} }, 'https://example.com/'),
  };`);
  assert.deepEqual(value.good, { data: false, error: null });
  assert_errors([value.broken]);
  assert_errors([value.denied], "UPSTREAM_ACCESS_DENIED");
  for (const key of ["missing_ctx", "thrown", "invalid_mock"]) assert.ok(value[key].error);
  assert.equal(requests.length, 3);
  const options = requests[0].options;
  assert.equal(options.method, "POST");
  assert.equal(options.body, "data");
  assert.equal(options.headers.accept, "application/json");
  assert.equal(options.headers.referer, "https://example.com/");
  assert.equal(requests[1].options.headers.referer, undefined);
  assert.ok(requests.every(r => !r.options.headers.cookie));
});
