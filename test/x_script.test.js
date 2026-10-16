import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import { ScriptCookieAccess } from '../server/infra/script_cookie_access.js';

register('./support/quickjs_wasm_hook.js', import.meta.url);
const { compile_script_module, execute_script } = await import('../server/infra/script_sandbox.js');
const source = await readFile(new URL('../examples/scripts/rss/x.js', import.meta.url), 'utf8');
const profile = JSON.parse(await readFile(new URL('./fixtures/x_profile.json', import.meta.url), 'utf8'));
const legacy = JSON.parse(await readFile(new URL('./fixtures/script_migration.json', import.meta.url), 'utf8')).find(row => row.file === 'x');
const compiled = await compile_script_module(source);
assert.equal(compiled.error, '');
const run = (username = 'NTCGoK9jFQURsEu') => execute_script(source, compiled.metadata, null, {
  method: 'GET', pathname: '/x/' + username, params: { username }, query: {},
}, [], '', new ScriptCookieAccess({ permissions: compiled.metadata.permissions, assert_grant() {}, cookies: () => [] }));
const stream = data => '<script>kind:"Result.Ok",value:' + JSON.stringify(JSON.stringify(data)) + '</script>';

test('X 新版真实页面从含 NUL 的流式数据读取正文、时间和视频，无需加载客户端脚本', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const html = '<script src="' + profile.script_url + '"></script>' + profile.scripts.map(body => '<script>' + body + '</script>').join('');
  assert.ok(html.includes('\0'));
  const calls = [];
  globalThis.fetch = async url => { calls.push(url); return new Response(html); };
  const feed = JSON.parse((await run()).output);
  assert.deepEqual(calls, ['https://x.com/NTCGoK9jFQURsEu']);
  assert.equal(feed.id, 'x:user:1452097352735477762');
  assert.equal(feed.title, 'K-pop GIF Archive 的 X 作品');
  assert.match(feed.description, /English/);
  assert.match(feed.image, /^https:\/\/pbs\.twimg\.com\//);
  assert.equal(feed.items.length, 5);
  assert.equal(feed.items[0].id, 'x:tweet:2110732449550602384');
  assert.equal(feed.items[0].published, new Date(1792072806000).toISOString());
  assert.match(feed.items[0].description, /^#Sakura/);
  assert.match(feed.items[0].enclosure.url, /1080x1920\/W1nwFx6nOqrn80rE\.mp4/);
  assert.equal(feed.updated, feed.items[0].published);
});

test('X 保留旧版 main.js、UserByScreenName 和 UserTweets 流程', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(url);
    return new Response(legacy.responses.find(row => url.includes(row.contains)).body);
  };
  const feed = JSON.parse((await run('example')).output);
  assert.equal(calls.length, 4);
  assert.deepEqual(feed.items.map(item => item.id), legacy.expected_ids);
  assert.equal(feed.items[0].enclosure.url, 'https://video.twimg.com/high.mp4');
});

test('X 不把缺失时间线或不安全的用户 ID 当作空列表，不执行内嵌脚本', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const user of [
    { rest_id: '123' },
    { rest_id: 9007199254740992, profile_user_originals_timeline: { timeline: { instructions: [] } } },
  ]) {
    globalThis.fetch = async () => new Response(stream({ data: { user_result_by_screen_name: { result: user } } }));
    await assert.rejects(run(), error => error.problem?.code === 'UPSTREAM_INVALID_RESPONSE');
  }
  globalThis.fetch = async () => new Response('<script>throw new Error("executed");</script><title>Log in / X</title>');
  await assert.rejects(run(), error => {
    assert.equal(error.problem.code, 'UPSTREAM_INVALID_RESPONSE');
    assert.match(error.message, /登录页或验证页/);
    assert.doesNotMatch(error.message, /executed/);
    return true;
  });
});
