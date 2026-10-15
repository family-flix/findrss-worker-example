import assert from "node:assert/strict";
import test from "node:test";

import { public_http_url } from "../server/lib/proxy_url.js";

test("public_http_url 接受正常公网地址", () => {
  assert.equal(public_http_url("https://example.com/feed.xml"), "https://example.com/feed.xml");
  assert.equal(public_http_url(" http://example.com:8080/a?b=c "), "http://example.com:8080/a?b=c");
});

test("public_http_url 拒绝本地与私网地址", () => {
  for (const value of [
    "http://127.0.0.1/",
    "http://localhost/",
    "http://foo.localhost/",
    "http://printer.local/",
    "http://169.254.169.254/",
    "http://[::1]/",
    "http://10.0.0.1/",
    "http://192.168.1.1/",
    "http://172.16.0.1/",
  ]) {
    assert.equal(public_http_url(value), null, value);
  }
});

test("public_http_url 拒绝编码混淆的环回地址与带凭证地址", () => {
  // WHATWG URL 会把八进制/十六进制/整数形式归一成点分十进制。
  for (const value of [
    "http://0177.0.0.1/",
    "http://0x7f.0.0.1/",
    "http://2130706433/",
    "http://user:pass@example.com/",
    "ftp://example.com/",
    "javascript:alert(1)",
    "",
  ]) {
    assert.equal(public_http_url(value), null, value);
  }
  assert.equal(public_http_url(123), null);
});
