import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import { FeedModel } from '../server/domain/feed_format.js';
import { ScriptCookieAccess } from '../server/infra/script_cookie_access.js';

register('./support/quickjs_wasm_hook.js', import.meta.url);
const { compile_script_module, execute_script } = await import('../server/infra/script_sandbox.js');
const source = await readFile(new URL('../examples/scripts/rss/instagram.js', import.meta.url), 'utf8');
const fixture = JSON.parse(await readFile(new URL('./fixtures/instagram_profile.json', import.meta.url), 'utf8'));
const connection = 'xdt_api__v1__feed__user_timeline_graphql_connection';
const context = { method: 'GET', pathname: '/instagram/rachelc00k', params: { username: '@RachelC00k' }, query: {} };
const link = 'https://www.instagram.com/rachelc00k/';
const profile = '<script type="application/json">["DTSGInitialData",[],{"token":"page-dtsg"}];["LSD",[],{"token":"page-lsd"}]</script>';
const cookies = ['sessionid', 'csrftoken'].map(name => ({ name, value: 'fixture-' + name, domain: '.instagram.com', path: '/', secure: true }));
const compiled = await compile_script_module(source);
assert.equal(compiled.error, '');
const access = () => new ScriptCookieAccess({ permissions: compiled.metadata.permissions, assert_grant() {}, cookies: () => cookies });
const run = (request = context, grant = access()) => execute_script(source, { ...compiled.metadata, debug: true }, null, request, [], '', grant);

test('Instagram 查询 GraphQL taken_at，按真实发布时间排序并生成 RSS/Atom 日期', async t => {
  assert.equal(compiled.metadata.kind, 'rss');
  assert.equal(compiled.metadata.routes[0].path, '/instagram/:username');
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.headers.Cookie, 'sessionid=fixture-sessionid; csrftoken=fixture-csrftoken');
    if (url === link) {
      assert.equal(options.method, 'GET');
      assert.match(options.headers['user-agent'], /iPhone/);
      assert.equal(options.headers.referer, link);
      return new Response(profile);
    }
    assert.equal(url, 'https://www.instagram.com/graphql/query');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['x-csrftoken'], 'fixture-csrftoken');
    assert.equal(options.headers['x-ig-app-id'], '936619743392459');
    assert.equal(options.headers['x-fb-friendly-name'], 'PolarisProfilePostsQuery');
    const form = new URLSearchParams(options.body);
    assert.equal(form.get('doc_id'), '28834890909485062');
    assert.equal(form.get('fb_dtsg'), 'page-dtsg');
    assert.equal(form.get('lsd'), 'page-lsd');
    assert.equal(form.get('__a'), '1');
    assert.equal(form.get('jazoest'), '2' + [...'page-dtsg'].reduce((sum, char) => sum + char.charCodeAt(0), 0));
    const variables = JSON.parse(form.get('variables'));
    assert.equal(variables.username, 'rachelc00k');
    assert.equal(variables.data.count, 12);
    return Response.json(fixture);
  };
  const result = await run();
  const feed = JSON.parse(result.output);
  const expected = fixture.data[connection].edges.map(entry => entry.node).sort((a, b) => b.taken_at - a.taken_at);
  assert.equal(calls.length, 2);
  assert.equal(feed.kind, 'rss');
  assert.equal('entries' in feed, false);
  assert.deepEqual(feed.items.map(item => item.id), expected.map(node => 'instagram:post:' + node.pk));
  const model = FeedModel(feed);
  const rss = model.render('rss');
  const atom = model.render('atom');
  for (const [index, item] of feed.items.entries()) {
    const node = expected[index];
    assert.equal(item.published, new Date(node.taken_at * 1000).toISOString());
    assert.equal(item.description, node.caption.text);
    assert.equal(item.image, node.image_versions2.candidates[0].url);
    assert.equal(item.link, 'https://www.instagram.com/p/' + node.code + '/');
    assert.equal(item.author.name, node.user.full_name);
    assert.ok(rss.includes('<pubDate>' + new Date(node.taken_at * 1000).toUTCString() + '</pubDate>'));
    assert.ok(atom.includes('<published>' + item.published + '</published>'));
  }
  assert.equal(feed.updated, feed.items[0].published);
  assert.ok(!JSON.stringify(result).includes('fixture-sessionid'));
  assert.ok(!JSON.stringify(result).includes('fixture-csrftoken'));
});

test('Instagram 日期缺失时不使用 caption.created_at 或抓取时间代替，空列表仍输出 RSS', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const response = structuredClone(fixture);
  delete response.data[connection].edges[0].node.taken_at;
  globalThis.fetch = async url => url === link ? new Response(profile) : Response.json(response);
  const feed = JSON.parse((await run()).output);
  assert.equal(feed.items.at(-1).id, 'instagram:post:' + fixture.data[connection].edges[0].node.pk);
  assert.equal(feed.items.at(-1).published, undefined);
  response.data[connection].edges = [];
  const empty = JSON.parse((await run()).output);
  assert.equal(empty.kind, 'rss');
  assert.deepEqual(empty.items, []);
});

test('Instagram 校验参数及授权，保留 HTTP、GraphQL、登录页和页面参数错误', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(''); };
  await assert.rejects(run({ ...context, params: { username: '../accounts' } }), /username 必须/);
  await assert.rejects(run(context, null), /Cookie 权限/);
  assert.equal(calls, 0);
  await assert.rejects(run(), /缺少查询参数/);
  for (const response of [
    () => new Response('', { status: 429 }),
    () => Response.json({ errors: [{ message: 'Login required' }] }),
    () => new Response('for (;;);' + JSON.stringify({ error: 1357004 })),
    () => new Response('<html>Login</html>'),
  ]) {
    globalThis.fetch = async url => url === link ? new Response(profile) : response();
    await assert.rejects(run(), /HTTP 429|作品查询失败|未返回 JSON/);
  }
});
