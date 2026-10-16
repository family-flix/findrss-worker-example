import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import { ScriptCookieAccess } from '../server/infra/script_cookie_access.js';
import { FeedModel } from '../server/domain/feed_format.js';

register('./support/quickjs_wasm_hook.js', import.meta.url);
const { compile_script_module, execute_script } = await import('../server/infra/script_sandbox.js');

test('小红书笔记将 time 毫秒时间戳输出为 RSS/Atom 发布时间，缺失时间不补日期', async t => {
  const source = await readFile(new URL('../examples/scripts/rss/xiaohongshu.js', import.meta.url), 'utf8');
  const compiled = await compile_script_module(source);
  assert.equal(compiled.error, '');
  assert.equal(compiled.metadata.routes[0].path, '/xiaohongshu/user/profile/:uid');
  assert.equal(compiled.metadata.routes[0].example, '/xiaohongshu/user/profile/5d2aec020000000012037401');
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const times = [1791916160000, undefined, 1792080550000];
  const notes = times.map((time, index) => ({ noteCard: {
    noteId: String(index + 1).padStart(24, '0'), displayTitle: '笔记 ' + index, time,
  } }));
  globalThis.fetch = async () => new Response('<script>window.__INITIAL_STATE__=' + JSON.stringify({ user: {
    userPageData: { basicInfo: { nickname: '博主' } }, notes: [notes],
  } }) + ';</script>');
  const permissions = compiled.metadata.permissions;
  const access = new ScriptCookieAccess({ permissions, assert_grant() {}, cookies: () => [] });
  const result = await execute_script(source, compiled.metadata, null, {
    method: 'GET', pathname: '/xiaohongshu/user/profile/5a13b53b4eacab190f3d0667',
    params: { uid: '5a13b53b4eacab190f3d0667' }, query: {},
  }, [], '', access);
  const feed = JSON.parse(result.output);
  assert.deepEqual(feed.items.map(item => item.published), [
    new Date(times[2]).toISOString(), new Date(times[0]).toISOString(), undefined,
  ]);
  assert.equal(feed.items[0].id, 'xiaohongshu:note:' + notes[2].noteCard.noteId);
  assert.equal(feed.updated, feed.items[0].published);
  const model = FeedModel(feed);
  const rss = model.render('rss');
  const atom = model.render('atom');
  assert.equal((rss.match(/<pubDate>/g) || []).length, 2);
  assert.equal((atom.match(/<published>/g) || []).length, 2);
  for (const time of [times[0], times[2]]) {
    assert.ok(rss.includes('<pubDate>' + new Date(time).toUTCString() + '</pubDate>'));
    assert.ok(atom.includes('<published>' + new Date(time).toISOString() + '</published>'));
  }
});
