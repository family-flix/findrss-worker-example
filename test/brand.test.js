import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import { FINDRSS_LOGO_PNG } from '../server/lib/brand.js';
import { SourceAvatarModel } from '../server/domain/discovery_source.js';

register('./support/quickjs_wasm_hook.js', import.meta.url);
const { default: worker } = await import('../api.js');

test('FindRSS 占位头像与品牌资产一致，可导入头像，公开 GET/HEAD 无需账号或 DO', async () => {
  const expected = await readFile(new URL('../public/brand/icon-192.png', import.meta.url));
  assert.deepEqual(Buffer.from(FINDRSS_LOGO_PNG), expected);
  assert.equal(SourceAvatarModel.sniff(FINDRSS_LOGO_PNG), 'image/png');
  for (const method of ['GET', 'HEAD']) {
    const response = await worker.fetch(new Request('https://feeds.example/findrss-logo.png', { method }), {});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'image/png');
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=86400');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), method === 'GET' ? expected : Buffer.alloc(0));
  }
});
