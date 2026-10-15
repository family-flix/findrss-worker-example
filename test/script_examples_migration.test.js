import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { register } from 'node:module';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { DOUYIN_SDK_FILES } from '../server/infra/douyin_sdk.js';
import { ScriptCookieAccess } from '../server/infra/script_cookie_access.js';
import { FeedModel } from '../server/domain/feed_format.js';
import { ScriptModel } from '../server/domain/script.js';

register('./support/quickjs_wasm_hook.js', import.meta.url);
const { compile_script_module, execute_script } = await import('../server/infra/script_sandbox.js');
const base = new URL('../examples/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('scripts/fixtures/newsnow_sources.json', base)));
const fixtures = JSON.parse(await readFile(new URL('scripts/fixtures/newsnow_responses.json', base)));
const content_cases = JSON.parse(await readFile(new URL('./fixtures/script_migration.json', import.meta.url)));
const read = path => readFile(new URL(path, base), 'utf8');
const hash = (kind, value) => createHash(kind).update(value).digest('hex');

test('所有脚本按用户的 RSS 标记分类，保持路由并采用全局基类和内置工具模块', async () => {
  const names = (await readdir(new URL('scripts/', base))).filter(name => name.endsWith('.js')).sort();
  const expected = { hot: [], rss: [] };
  for (const name of names) {
    const original = await read('scripts/' + name);
    const kind = original.trimStart().startsWith('/** RSS */') ? 'rss' : 'hot';
    expected[kind].push(name);
    const source = await read(kind + '/' + name);
    assert.match(source, /import\s*\{\s*utils\s*\}\s*from\s*['"]@findrss\/util['"]/);
    assert.match(source, kind === 'rss' ? /extends RSSScript/ : /extends HotRankScript/);
    assert.doesNotMatch(source, /const (utils|main) = \{\}|JSON\.parse\(/);
    const compiled = await compile_script_module(source);
    assert.equal(compiled.error, '', name);
    assert.equal(compiled.metadata.script_type, kind, name);
    assert.equal(compiled.metadata.kind, kind, name);
    const old = await compile_script_module(original);
    assert.equal(old.error, '', name);
    const paths = name === "zhihu.js" ? [
      "/zhihu/people/:user", "/zhihu/people/:user/answers", "/zhihu/people/:user/zvideos",
      "/zhihu/people/:user/asks", "/zhihu/people/:user/posts", "/zhihu/column/:column_id",
      "/zhihu/people/:user/pins", "/zhihu/collection/:collection_id",
    ] : old.metadata.routes.map(route => route.path);
    assert.deepEqual(compiled.metadata.routes.map(route => route.path), paths, name);
  }
  for (const kind of ['hot', 'rss']) assert.deepEqual((await readdir(new URL(kind + '/', base))).filter(name => name.endsWith('.js')).sort(), expected[kind]);
});

test('已保存的 70 个旧示例缺少 kind 和顶部标记时仍按用户分类展示', async () => {
  const counts = { hot: 0, rss: 0 };
  for (const name of (await readdir(new URL('scripts/', base))).filter(name => name.endsWith('.js'))) {
    const source = await read('scripts/' + name);
    const expected = source.trimStart().startsWith('/** RSS */') ? 'rss' : 'hot';
    const legacy = ScriptModel.fromRow({ script: source.replace(/^\s*\/\*\* RSS \*\//, ''), metadata_json: '{}' }).toValue();
    assert.equal(legacy.kind, expected, name);
    counts[legacy.kind]++;
  }
  assert.deepEqual(counts, { hot: 53, rss: 17 });
});

for (const fixture of content_cases) test('迁移脚本保留内容与媒体：' + fixture.file + (fixture.route_index ? (fixture.file === 'zhihu' ? ' 回答' : fixture.file === 'bilibili' ? ' 视频' : ' 正文代理') : ''), async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const kind = fixture.kind || 'rss';
  const source = await read(kind + '/' + fixture.file + '.js');
  const compiled = await compile_script_module(source);
  assert.equal(compiled.error, '');
  const metadata = { ...compiled.metadata, ...compiled.metadata.routes[fixture.route_index || 0] };
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const sdk_index = DOUYIN_SDK_FILES.findIndex(file => file.url === url);
    if (sdk_index >= 0) return new Response(gunzipSync(await readFile(new URL('./fixtures/douyin/' + ['bdms.js.gz','security.js.gz'][sdk_index], import.meta.url))));
    calls.push({ url, options });
    const response = fixture.responses.find(response => url.includes(response.contains));
    assert.ok(response, fixture.file + ': ' + url);
    return new Response(response.body);
  };
  const permissions = compiled.metadata.permissions;
  const access = permissions.cookies.length ? new ScriptCookieAccess({ permissions, assert_grant: () => {}, cookies: () =>
    permissions.cookies.flatMap(permission => permission.names.map(name => ({ name, value: name === 'UIFID' ? 'provider-fixture' : 'test-cookie',
      domain: new URL(permission.origin).hostname, path: '/', secure: true }))) }) : null;
  const result = await execute_script(source, metadata, fixture.invoke ? async spec => {
    assert.equal(spec.method, fixture.invoke.method);
    return fixture.invoke.body;
  } : null, { method: 'GET', pathname: metadata.example, params: fixture.params, query: {}, public_origin: 'https://feeds.example' }, [], '', access);
  const value = JSON.parse(result.output);
  if (fixture.expect_body) {
    assert.match(value.body, new RegExp(fixture.expect_body));
    assert.equal(value.content_type, 'text/html; charset=utf-8');
    return;
  }
  const items = kind === 'hot' ? value.entries : value.items;
  assert.ok(items.length > 0, fixture.file);
  assert.equal(new Set(items.map(item => item.id)).size, items.length);
  if (fixture.expected_ids) assert.deepEqual(items.map(item => item.id), fixture.expected_ids, fixture.file);
  if (kind === 'rss') {
    assert.equal(value.kind, 'rss');
    for (const format of ['rss','atom']) assert.match(FeedModel(value).render(format), new RegExp(items[0].id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/&/g,'&amp;')));
    assert.ok(items.every(item => !('rank' in item)));
  } else {
    assert.equal(value.kind, 'hot_rank');
    assert.equal('items' in value, false);
  }
  if (fixture.file === 'youtube') {
    const estimated = Date.parse(items[0].published);
    assert.ok(Math.abs(Date.now() - 4 * 86400000 - estimated) < 10000, '根据 4天前 估算发布时间');
    assert.equal(value.updated, items[0].published);
  }
  if (fixture.file === 'bilibili' && !fixture.route_index) assert.equal(items[0].images.length, 2);
  if (fixture.file === 'bilibili' && fixture.route_index === 1) assert.equal(items[0].enclosure.length, 456);
  if (fixture.file === 'douyin_user') { assert.equal(items[1].images.length, 2); assert.equal(items[0].media_group, true); }
  if (fixture.file === 'wxchannels_contact_feed_list') { assert.equal(items[0].live_photos[0].key, 'photo-key'); assert.equal(items[1].enclosure.key, 'key-1'); }
  if (fixture.file === 'wxmp_biz_msg_list') assert.equal(items[0].live_photos[0].key, 'live-key');
  if (fixture.file === 'x_user') assert.equal(items[0].enclosure.url, 'https://video.twimg.com/high.mp4');
  if (fixture.file === 'weibo') { assert.ok(items[0].images[0].includes('/img/weibo?')); assert.doesNotMatch(items[0].content, /\[object Object\]/); }
});

test('52 个源重写为列表快照，生产 QuickJS 正常执行、去重并保留稳定 ID 和链接', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const entry of manifest.sources) {
    const script = await read('hot/' + entry.file);
    const compiled = await compile_script_module(script);
    assert.equal(compiled.error, '', entry.file);
    const fixture = fixtures[entry.source];
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      if (entry.source.startsWith('cls-')) {
        const query = new URL(url).searchParams;
        const signature = query.get('sign');
        query.delete('sign');
        assert.equal(signature, hash('md5', hash('sha1', query.toString())));
      }
      if (entry.source === 'qqvideo-tv-hotsearch') {
        assert.equal(options.method, 'POST');
        assert.equal(JSON.parse(options.body).page_params.rank_name, 'HotSearch');
      }
      return new Response(fixture.body);
    };
    const permissions = compiled.metadata.permissions;
    const access = permissions.cookies.length ? new ScriptCookieAccess({ permissions, assert_grant: () => {}, cookies: () => [] }) : null;
    const result = await execute_script(script, compiled.metadata, null, undefined, [], '', access).catch(error => {
      error.message = entry.file + ': ' + error.message;
      throw error;
    });
    const snapshot = JSON.parse(result.output);
    assert.equal(snapshot.kind, 'hot_rank', entry.file);
    assert.ok(snapshot.entries.length > 0, entry.file);
    assert.equal(new Set(snapshot.entries.map(row => row.id)).size, snapshot.entries.length, entry.file);
    const expected = snapshot.entries.find(row => row.link === fixture.link);
    assert.ok(expected, entry.file + ': ' + fixture.link);
    assert.equal(expected.title, fixture.title, entry.file);
    assert.equal('items' in snapshot, false);
    assert.ok(snapshot.entries.every(row => !('published' in row) && !('updated' in row)));
    assert.ok(Number.isFinite(Date.parse(snapshot.observed_at)));
    assert.equal(calls.length, fixture.requests || 1, entry.file);
  }
});

test('迁移脚本透传请求失败 Result，不把错误当作空列表成功输出', async () => {
  const names = (await readdir(new URL('scripts/', base))).filter(name => name.endsWith('.js'));
  for (const name of names) {
    const kind = (await read('scripts/' + name)).trimStart().startsWith('/** RSS */') ? 'rss' : 'hot';
    const original = await read(kind + '/' + name);
    const fixture = content_cases.find(fixture => fixture.file + '.js' === name);
    const script = original + `
const test_routes = typeof routes === 'undefined' ? [route] : routes;
for (const test_route of test_routes) {
  const handler = test_route.handler;
  test_route.handler = ctx => handler({ ...ctx, params: ${JSON.stringify(fixture?.params || {})},
    fetchText: async () => Result.Err('请求失败', 'UPSTREAM_TIMEOUT'),
    invoke: async () => Result.Err('设备不可用', 'DEVICE_UNAVAILABLE'),
    cookies: { get: async () => Result.Ok({ id: 'fixture-cookie' }) },
  });
}`;
    const compiled = await compile_script_module(script);
    assert.equal(compiled.error, '', name);
    await assert.rejects(execute_script(script, compiled.metadata), error => {
      assert.ok(error.message, name);
      assert.match(error.message, /请求失败|设备不可用/, name);
      return true;
    }, name);
  }
});
