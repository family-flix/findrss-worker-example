import test from 'node:test';
import assert from 'node:assert/strict';
import { rss_response_text } from '../server/infra/rss_response_text.js';

test('按 HTTP charset 或 HTML meta 解码 GBK，UTF-8 默认行为不变', () => {
  const gbk = Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4]);
  assert.equal(rss_response_text(gbk, 'text/html; charset=gbk'), '中文');
  const prefix = new TextEncoder().encode('<meta charset="GBK">');
  const page = new Uint8Array([...prefix, ...gbk]);
  assert.equal(rss_response_text(page), '<meta charset="GBK">中文');
  assert.equal(rss_response_text(new TextEncoder().encode('中文')), '中文');
  assert.equal(rss_response_text(new TextEncoder().encode('<meta charset="GBK">中文'), 'text/html; charset=utf-8'), '<meta charset="GBK">中文');
});
