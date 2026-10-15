import assert from "node:assert/strict";
import test from "node:test";
import { cookie_header } from "../server/infra/rss_cookies.js";

test("按域名、路径、安全标记和有效期选择 Cookie", () => {
  const cookies = [
    { name: "global", value: "1", domain: ".example.com", path: "/" },
    { name: "page", value: "2", domain: "www.example.com", path: "/news", hostOnly: true },
    { name: "secure", value: "3", domain: "example.com", path: "/", secure: true },
    { name: "expired", value: "4", domain: "example.com", path: "/", expirationDate: 9 },
    { name: "other", value: "5", domain: "other.test", path: "/" },
  ];
  assert.equal(cookie_header(cookies, "https://www.example.com/news/1", 10), "global=1; page=2; secure=3");
  assert.equal(cookie_header(cookies, "http://example.com/", 10), "global=1");
  assert.equal(cookie_header(cookies, "https://sub.www.example.com/newsroom", 10), "global=1; secure=3");
});

test("通配域只匹配自身和子域，不匹配相似域", () => {
  const cookies = [{ name: "SUB", value: "session", domain: "*.weibo.com" }];
  assert.equal(cookie_header(cookies, "https://weibo.com/u/1992429663"), "SUB=session");
  assert.equal(cookie_header(cookies, "https://www.weibo.com/"), "SUB=session");
  assert.equal(cookie_header(cookies, "https://evilweibo.com/"), "");
});
