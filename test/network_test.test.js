import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { spawnSync } from "node:child_process";
import { admin_network_test } from "../server/service/worker/network_test.js";
import { handle_admin_request } from "../admin.js";
import { create_worker } from "../router.js";
import { mock_tcp_http } from "./support/tcp_socket_fixture.js";
import { route } from "../application_router.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const {
  default: api
} = await import("../api.js");
const env = {
  ADMIN_PASSWORD: "test-admin",
  APPLICATION: {
    fetch() {
      assert.fail("网络测试不经过业务服务");
    }
  }
};
const cookie_env = cookies => ({
  ...env,
  APPLICATION: (() => ({
    fetch: async url => {
      assert.equal(url, "https://internal/_admin/cookies");
      return Response.json({
        cookies
      });
    }
  }))()
});
const request = (body = {}, options = {}) => new Request("https://app.example/admin/api/network-test", {
  method: "POST",
  headers: {
    Authorization: "Bearer test-admin"
  },
  body: JSON.stringify({
    url: "https://example.com/",
    ...body
  }),
  ...options
});
test("网络测试经过管理员鉴权，后台会话和管理员 Token 均不转发给目标网站", async t => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://example.com/");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "manual");
    const headers = new Headers(options.headers);
    assert.equal(headers.has("authorization"), false);
    assert.equal(headers.has("cookie"), false);
    return new Response("<script>alert(1)</script>", {
      status: 403,
      headers: {
        "X-Test": "upstream"
      }
    });
  });
  assert.equal((await api.fetch(request({}, {
    headers: {}
  }), env)).status, 401);
  assert.equal((await api.fetch(request({}, {
    method: "GET",
    body: undefined
  }), env)).status, 405);
  const worker = create_worker({
    api,
    admin: handle_admin_request
  });
  const login = await worker.fetch(new Request("https://app.example/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({
      password: "test-admin"
    })
  }), env);
  const cookie = (await login.headers.get("Set-Cookie")).split(";")[0];
  const response = await worker.fetch(request({}, {
    headers: {
      Cookie: cookie
    }
  }), env);
  assert.equal(await response.headers.get("Cache-Control"), "no-store");
  const value = await response.json();
  assert.equal(value.status, 403);
  assert.equal(value.headers["x-test"], "upstream");
  assert.equal(value.body, "<script>alert(1)</script>");
  assert.equal(value.error, "");
  assert.equal(value.requests.length, 1);
  assert.ok(value.elapsed_ms >= value.headers_ms);
});
test("域名列表仅向管理员返回域名及数量，不包含 Cookie 名称或值", async () => {
  const url = "https://app.example/admin/api/network-test/cookie-domains";
  assert.equal((await api.fetch(new Request(url), env)).status, 401);
  const response = await api.fetch(new Request(url, {
    headers: {
      Authorization: "Bearer test-admin"
    }
  }), cookie_env([{
    domain: "z.example",
    name: "secret-name",
    value: "private-value"
  }, {
    domain: ".example.com",
    name: "first-secret",
    value: "second-secret"
  }, {
    domain: ".example.com",
    name: "third-secret",
    value: "fourth-secret"
  }]));
  assert.equal(await response.headers.get("Cache-Control"), "no-store");
  const result = await response.json();
  assert.deepEqual(result, {
    domains: [{
      domain: ".example.com",
      count: 2
    }, {
      domain: "z.example",
      count: 1
    }]
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|private-value/);
});
test("脚本宿主测试经过管理员鉴权，在同一 DO 内请求并直接读取 Cookie，不转发管理员凭证", async t => {
  const tcp = mock_tcp_http(t);
  const forwarded = [];
  const app = {
    scripts: {
      rss_cookies: () => [{
        name: "SESSDATA",
        value: "fixture",
        domain: ".bilibili.com",
        path: "/",
        secure: true
      }]
    }
  };
  const host = {
    ...env,
    APPLICATION: function () {
      return {
        async fetch(request) {
          forwarded.push(request.url);
          assert.equal(request.headers.has("Authorization"), false);
          assert.equal(request.headers.has("Cookie"), false);
          return route(request, app);
        }
      };
    }()
  };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://api.bilibili.com/x/web-interface/nav");
    assert.equal(await options.headers.get("cookie"), "SESSDATA=fixture");
    return Response.json({
      code: 0
    });
  });
  const make_request = (curl = false, headers = {
    Authorization: "Bearer test-admin"
  }) => new Request("https://app.example/admin/api/network-test" + (curl ? "/curl" : "") + "?execution=script", {
    method: "POST",
    headers,
    body: JSON.stringify({
      url: "https://api.bilibili.com/x/web-interface/nav",
      transport: "tcp",
      cookie_domains: [".bilibili.com"]
    })
  });
  assert.equal((await api.fetch(make_request(false, {}), host)).status, 401);
  assert.equal((await api.fetch(make_request(true, {}), host)).status, 401);
  assert.equal(forwarded.length, 0);
  const result = await (await api.fetch(make_request(), host)).json();
  assert.equal(result.execution, "script", JSON.stringify(result));
  assert.equal(result.error, "");
  assert.equal(result.body, '{"code":0}');
  assert.equal(tcp.connections.length, 1);
  const curl = await (await api.fetch(make_request(true), host)).json();
  assert.match(curl.command, /cookie: SESSDATA=fixture/);
  assert.equal(tcp.connections.length, 1, "生成 curl 不请求目标网站");
  assert.deepEqual(forwarded, ["https://internal/_admin/network-test?execution=script", "https://internal/_admin/network-test/curl?execution=script"]);
  const worker = create_worker({
    api,
    admin: handle_admin_request
  });
  assert.equal((await worker.fetch(new Request("https://app.example/_admin/network-test?execution=script"), host)).status, 404);
  assert.equal((await api.fetch(new Request("https://app.example/admin/api/network-test?execution=script", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-admin"
    },
    body: JSON.stringify({
      url: "http://127.0.0.1/"
    })
  }), host)).status, 400);
  assert.equal(forwarded.length, 2, "无效请求在转发 DO 前被拒绝");
  assert.equal((await admin_network_test(new Request("https://app.example/admin/api/network-test?execution=unknown", {
    method: "POST",
    body: "{}"
  }), host)).status, 400);
});
test("TCP 使用与 Bilibili 脚本相同的传输、请求头和 Cookie，重定向仍校验地址与凭证", async t => {
  const tcp = mock_tcp_http(t);
  const headers = {
    Accept: "application/json, text/plain, */*",
    Referer: "https://space.bilibili.com/123/dynamic",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "User-Agent": "bilibili-test",
    Authorization: "Bearer explicit"
  };
  const seen = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    seen.push({
      url,
      headers: options.headers
    });
    return seen.length === 1 ? new Response(null, {
      status: 302,
      headers: {
        Location: "https://other.example/next"
      }
    }) : new Response('{"code":0}', {
      headers: {
        "Content-Type": "application/json"
      }
    });
  });
  const value = await (await admin_network_test(request({
    url: "https://api.bilibili.com/x/test?uid=123",
    transport: "tcp",
    headers,
    cookie_domains: [".bilibili.com"]
  }), cookie_env([{
    domain: ".bilibili.com",
    name: "SESSDATA",
    value: "fixture",
    path: "/",
    secure: true
  }]))).json();
  assert.equal(value.transport, "tcp");
  assert.equal(value.body, '{"code":0}');
  assert.deepEqual(value.requests.map(entry => entry.status), [302, 200]);
  for (const [name, header] of Object.entries(headers)) assert.equal(seen[0].headers.get(name), header);
  assert.equal(seen[0].headers.get("cookie"), "SESSDATA=fixture");
  assert.equal(seen[0].headers.get("accept-encoding"), "identity");
  assert.equal(seen[0].headers.get("connection"), "close");
  assert.equal(seen[1].headers.has("cookie"), false);
  assert.equal(seen[1].headers.has("authorization"), false);
  assert.ok(tcp.connections.every(connection => connection.options.secureTransport === "on" && connection.closed));
  t.mock.method(globalThis, "fetch", async () => new Response(null, {
    status: 302,
    headers: {
      Location: "http://127.0.0.1/"
    }
  }));
  const blocked = await (await admin_network_test(request({
    transport: "tcp"
  }))).json();
  assert.match(blocked.error, /公网/);
  assert.equal(tcp.connections.length, 3);
});
test("TCP 沿用脚本响应上限及超时，并保留失败诊断", async t => {
  const tcp = mock_tcp_http(t);
  t.mock.method(globalThis, "fetch", async () => new Response("x".repeat(10 * 1024 * 1024 + 1)));
  const failed = await (await admin_network_test(request({
    transport: "tcp"
  }))).json();
  assert.equal(failed.code, "UPSTREAM_FETCH_FAILED");
  assert.match(failed.error, /10MB|大小限制/);
  assert.ok(tcp.connections[0].closed);
  t.mock.method(AbortSignal, "timeout", () => AbortSignal.abort(new DOMException("timeout", "TimeoutError")));
  const timeout = await (await admin_network_test(request({
    transport: "tcp"
  }))).json();
  assert.equal(timeout.code, "UPSTREAM_TIMEOUT");
  assert.equal(tcp.connections.length, 1);
});
test("TCP curl 使用 HTTP/1.1 和相同传输请求头，不出网", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("生成命令不得出网"));
  const {
    command
  } = await (await admin_network_test(request({
    transport: "tcp"
  }), env, true)).json();
  assert.match(command, /--http1\.1/);
  assert.match(command, /--header 'accept-encoding: identity'/);
  assert.match(command, /--header 'connection: close'/);
  assert.doesNotMatch(command, /--compressed/);
});
test("复制 curl 仅管理员可用，不出网，匹配已选 Cookie 并安全转义终端参数", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("生成命令不得请求目标网站"));
  const url = "https://www.example.com/private/[page]?q=a'b&next=$HOME";
  const referer = "https://example.com/'$(printf expanded)`printf expanded`";
  const saved = [{
    domain: ".example.com",
    name: "session",
    value: "a'b$HOME`printf expanded`",
    path: "/private",
    secure: true
  }, {
    domain: ".example.com",
    name: "expired",
    value: "no",
    expirationDate: 1
  }, {
    domain: ".example.com",
    name: "wrong_path",
    value: "no",
    path: "/elsewhere"
  }, {
    domain: ".example.com",
    name: "host_only",
    value: "no",
    hostOnly: true
  }, {
    domain: "www.example.com",
    name: "unselected",
    value: "no"
  }];
  const curl_request = options => new Request("https://app.example/admin/api/network-test/curl", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-admin"
    },
    body: JSON.stringify({
      url,
      timeout_ms: 1250,
      headers: {
        Referer: referer,
        Accept: ""
      },
      cookie_domains: [".example.com"]
    }),
    ...options
  });
  const cookies = cookie_env(saved);
  assert.equal((await api.fetch(curl_request({
    headers: {}
  }), cookies)).status, 401);
  assert.equal((await api.fetch(curl_request({
    method: "GET",
    body: undefined
  }), cookies)).status, 405);
  const response = await api.fetch(curl_request(), cookies);
  assert.equal(response.status, 200);
  assert.equal(await response.headers.get("Cache-Control"), "no-store");
  const {
    command
  } = await response.json();
  const parsed = spawnSync("/bin/sh", ["-c", "curl() { printf '%s\\0' \"$@\"; }\n" + command], {
    encoding: "utf8"
  });
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.deepEqual(parsed.stdout.split("\0").slice(0, -1), ["-q", "--globoff", "--silent", "--show-error", "--include", "--compressed", "--max-time", "1.25", "--header", "user-agent: findrss-script/1.0", "--header", "accept;", "--header", "referer: " + referer, "--header", "cookie: session=a'b$HOME`printf expanded`", "--url", new URL(url).href]);
  const anonymous = await (await admin_network_test(request(), env, true)).json();
  assert.doesNotMatch(anonymous.command, /cookie:|test-admin|--location/);
  for (const body of [{
    url: "http://127.0.0.1/"
  }, {
    headers: {
      Host: "evil.example"
    }
  }, {
    headers: {
      Cookie: "manual"
    }
  }, {
    timeout_ms: 0
  }, {
    cookie_domains: ["missing.example"]
  }]) {
    assert.equal((await admin_network_test(request(body), cookies, true)).status, 400);
  }
});
test("每一跳重新匹配所选域名的路径、HTTPS、hostOnly 和有效期，不发送未勾选的域", async t => {
  const saved = [{
    domain: ".example.com",
    name: "global",
    value: "yes",
    path: "/"
  }, {
    domain: ".example.com",
    name: "page",
    value: "yes",
    path: "/private"
  }, {
    domain: ".example.com",
    name: "secure",
    value: "yes",
    secure: true
  }, {
    domain: ".example.com",
    name: "expired",
    value: "no",
    expirationDate: 1
  }, {
    domain: "www.example.com",
    name: "host",
    value: "yes",
    hostOnly: true
  }, {
    domain: "example.com",
    name: "unselected",
    value: "no"
  }, {
    domain: "other.example",
    name: "other",
    value: "yes"
  }];
  const seen = [];
  const redirects = ["/public", "https://other.example/", "http://www.example.com/private/end", "https://sub.www.example.com/private/end"];
  t.mock.method(globalThis, "fetch", async (_, options) => {
    seen.push(await new Headers(options.headers).get("cookie"));
    return seen.length <= redirects.length ? new Response(null, {
      status: 302,
      headers: {
        Location: redirects[seen.length - 1]
      }
    }) : new Response("ok");
  });
  const response = await admin_network_test(request({
    url: "https://www.example.com/private/start",
    cookie_domains: [".example.com", "www.example.com", "other.example"]
  }), cookie_env(saved));
  assert.equal(response.status, 200);
  assert.deepEqual(seen, ["global=yes; page=yes; secure=yes; host=yes", "global=yes; secure=yes; host=yes", "other=yes", "global=yes; page=yes; host=yes", "global=yes; page=yes; secure=yes"]);
  assert.doesNotMatch(JSON.stringify(await response.json()), /global=yes|page=yes|expired|unselected/);
});
test("已选域名失效或 Cookie 存储读取失败时不发起上游请求", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("Cookie 校验失败不得出网"));
  assert.equal((await admin_network_test(request({
    cookie_domains: ["missing.example"]
  }), cookie_env([]))).status, 400);
  const failed_env = {
    ...env,
    APPLICATION: (() => ({
      fetch: async () => new Response(null, {
        status: 503
      })
    }))()
  };
  assert.equal((await admin_network_test(request({
    cookie_domains: ["example.com"]
  }), failed_env)).status, 502);
  assert.equal((await api.fetch(new Request("https://app.example/admin/api/network-test/cookie-domains", {
    headers: {
      Authorization: "Bearer test-admin"
    }
  }), failed_env)).status, 502);
});
test("网络测试在出网前校验地址、请求头、超时和请求体", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("无效请求不得出网"));
  for (const url of ["file:///etc/passwd", "http://localhost/", "http://127.1/", "http://10.0.0.1/", "http://169.254.169.254/", "https://metadata.google.internal/", "http://[::1]/", "https://example.com:8080/", "https://user:pass@example.com/"]) {
    assert.equal((await admin_network_test(request({
      url
    }))).status, 400, url);
  }
  for (const body of [{
    timeout_ms: 0
  }, {
    timeout_ms: 60001
  }, {
    timeout_ms: "1000"
  }, {
    timeout_ms: 1000.5
  }, {
    headers: []
  }, {
    headers: null
  }, {
    headers: {
      Host: "other.example"
    }
  }, {
    headers: {
      Referer: "x\r\nCookie: secret"
    }
  }, {
    headers: {
      Accept: 1
    }
  }, {
    headers: {
      Cookie: "sid=x\r\nX-Injected: secret"
    }
  }, {
    headers: {
      Cookie: "sid=x\0"
    }
  }, {
    headers: {
      Cookie: "x".repeat(4097)
    }
  }, {
    headers: {
      Cookie: "manual"
    }
  }, {
    cookie_domains: "example.com"
  }, {
    cookie_domains: [null]
  }, {
    cookie_domains: ["example.com/path"]
  }, {
    transport: "udp"
  }, {
    transport: null
  }, {
    transport: {}
  }]) {
    assert.equal((await admin_network_test(request(body))).status, 400, JSON.stringify(body));
    assert.equal((await admin_network_test(request(body), env, true)).status, 400, JSON.stringify(body));
  }
  for (const body of ["null", "[]", "invalid"]) {
    assert.equal((await admin_network_test(request({}, {
      body
    }))).status, 400);
  }
  assert.equal((await admin_network_test(request({
    padding: "x".repeat(32768)
  }))).status, 413);
});
test("逐跳匹配选中域的 Cookie，跨域移除手动认证头，返回原域重新匹配 Cookie", async t => {
  const seen = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    seen.push(new Headers(options.headers));
    if (seen.length === 1) return new Response(null, {
      status: 302,
      headers: {
        Location: "/same"
      }
    });
    if (seen.length === 2) return new Response(null, {
      status: 307,
      headers: {
        Location: "https://other.example/next"
      }
    });
    if (seen.length === 3) return new Response(null, {
      status: 301,
      headers: {
        Location: "https://example.com/back"
      }
    });
    return new Response("正文");
  });
  const value = await (await admin_network_test(request({
    cookie_domains: ["example.com"],
    headers: {
      "User-Agent": "test-agent",
      Referer: "https://example.com/",
      Authorization: "Bearer explicit-token"
    }
  }), cookie_env([{
    name: "session",
    value: "fixture",
    domain: "example.com",
    path: "/"
  }]))).json();
  assert.deepEqual(value.requests.map(entry => entry.status), [302, 307, 301, 200]);
  assert.equal(value.body, "正文");
  assert.equal(value.url, "https://example.com/back");
  assert.equal(seen[0].get("cookie"), "session=fixture");
  assert.equal(seen[1].get("authorization"), "Bearer explicit-token");
  for (const headers of seen.slice(2)) {
    assert.equal(headers.has("authorization"), false);
    assert.equal(await headers.get("user-agent"), "test-agent");
  }
  assert.equal(seen[2].has("cookie"), false);
  assert.equal(seen[3].get("cookie"), "session=fixture");
});
test("重定向目标也必须通过公网校验，并且有跳数限制", async t => {
  for (const location of ["http://127.0.0.1/secret", "javascript:alert(1)", "https://example.com/loop", ""]) {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      return new Response(null, {
        status: 302,
        headers: location ? {
          Location: location
        } : {}
      });
    });
    const value = await (await admin_network_test(request())).json();
    assert.ok(value.error);
    assert.equal(value.status, 302);
    assert.equal(calls, location.endsWith("/loop") ? 6 : 1);
  }
});
test("正文以字节限制预览，超限取消流；GBK 响应仍能解码", async t => {
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(65537).fill(65));
    },
    cancel() {
      cancelled = true;
    }
  })));
  const value = await (await admin_network_test(request())).json();
  assert.equal(value.truncated, true);
  assert.equal(value.body_bytes, 65536);
  assert.equal(value.body, "A".repeat(65536));
  assert.equal(cancelled, true);
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]), {
    headers: {
      "Content-Type": "text/html; charset=gbk"
    }
  }));
  assert.equal((await (await admin_network_test(request())).json()).body, "中文");
});
test("连接失败、收到响应头前超时以及读取正文超时保留各阶段诊断", async t => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("connection reset");
  });
  const failed = await (await admin_network_test(request())).json();
  assert.equal(failed.code, "UPSTREAM_FETCH_FAILED");
  assert.equal(failed.requests[0].status, null);
  assert.match(failed.error, /connection reset/);
  t.mock.method(AbortSignal, "timeout", ms => {
    assert.equal(ms, 1000);
    return AbortSignal.abort(new DOMException("timeout", "TimeoutError"));
  });
  t.mock.method(globalThis, "fetch", async (_, {
    signal
  }) => {
    throw signal.reason;
  });
  const timeout = await (await admin_network_test(request({
    timeout_ms: 1000
  }))).json();
  assert.equal(timeout.code, "UPSTREAM_TIMEOUT");
  assert.equal(timeout.headers_ms, null);
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) {
      controller.error(new Error("body timeout"));
    }
  })));
  const body_timeout = await (await admin_network_test(request({
    timeout_ms: 1000
  }))).json();
  assert.equal(body_timeout.code, "UPSTREAM_TIMEOUT");
  assert.equal(body_timeout.status, 200);
  assert.equal(body_timeout.requests[0].status, 200);
  assert.notEqual(body_timeout.headers_ms, null);
});
test("媒体使用本次带 Cookie 的完整响应，二进制通过 multipart 返回且不按文本解码", async t => {
  const bytes = new Uint8Array(65539).fill(255);
  for (const [type, kind] of [["image/png", "img"], ["image/svg+xml", "img"], ["video/mp4", "video"], ["audio/mpeg", "audio"]]) {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (_, options) => {
      calls++;
      assert.equal(await new Headers(options.headers).get("cookie"), "session=media");
      return new Response(bytes, {
        headers: {
          "Content-Type": type
        }
      });
    });
    const response = await admin_network_test(request({
      cookie_domains: ["example.com"]
    }), cookie_env([{
      name: "session",
      value: "media",
      domain: "example.com",
      path: "/"
    }]));
    assert.match(await response.headers.get("Content-Type"), /^multipart\/form-data;/);
    assert.equal(await response.headers.get("Cache-Control"), "no-store");
    const form = await response.formData();
    const result = JSON.parse(await form.get("result"));
    const media = await form.get("media");
    assert.equal(calls, 1);
    assert.equal(result.body_kind, kind);
    assert.equal(result.content_type, type);
    assert.equal(result.body, "");
    assert.equal(result.truncated, false);
    assert.equal(result.body_bytes, bytes.length);
    assert.equal(result.file.size_bytes, bytes.length);
    assert.equal(media.type, type);
    assert.deepEqual(new Uint8Array(await media.arrayBuffer()), bytes);
  }
});
test("文件只读取元信息，不下载正文，文件名优先 RFC 5987，缺失大小显示未知", async t => {
  for (const headers of [{
    "Content-Type": "application/octet-stream",
    "Content-Length": "123456789",
    "Content-Disposition": "attachment; filename=backup.zip; filename*=UTF-8''%E6%96%87%E4%BB%B6.zip"
  }, {
    "Content-Type": "application/pdf"
  }, {
    "Content-Type": "text/html",
    "Content-Disposition": 'attachment; filename="report.html"'
  }, {
    "Content-Type": "application/zip",
    "Content-Disposition": "attachment; filename=safe.zip; filename*=UTF-8''bad%zz"
  }]) {
    let cancelled = false;
    t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
      pull() {
        assert.fail("文件预览不读取正文");
      },
      cancel() {
        cancelled = true;
      }
    }, {
      highWaterMark: 0
    }), {
      headers
    }));
    const result = await (await admin_network_test(request({
      url: "https://example.com/folder/download.pdf"
    }))).json();
    assert.equal(cancelled, true);
    assert.equal(result.body_kind, "file");
    assert.equal(result.body_bytes, 0);
    assert.equal(result.body, "");
    assert.equal(result.file.name, headers["Content-Type"] === "application/octet-stream" ? "文件.zip" : headers["Content-Type"] === "text/html" ? "report.html" : headers["Content-Type"] === "application/zip" ? "safe.zip" : "download.pdf");
    assert.equal(result.file.size_bytes, headers["Content-Length"] ? 123456789 : null);
  }
});
test("媒体超过上限时只显示文件信息，未知长度的媒体按实际读取限制中止", async t => {
  const size = 16 * 1024 * 1024;
  for (const declared of [true, false]) {
    let cancelled = false;
    let chunks_read = 0;
    t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
      pull(controller) {
        chunks_read++;
        controller.enqueue(new Uint8Array(size + 1));
      },
      cancel() {
        cancelled = true;
      }
    }, {
      highWaterMark: 0
    }), {
      headers: {
        "Content-Type": "video/mp4",
        ...(declared ? {
          "Content-Length": String(size + 1)
        } : {})
      }
    }));
    const response = await admin_network_test(request());
    const result = await response.json();
    assert.equal(result.body_kind, "file");
    assert.match(result.preview_message, /16MB/);
    assert.equal(result.body_bytes, declared ? 0 : size);
    assert.equal(chunks_read, declared ? 0 : 1);
    assert.equal(result.file.size_bytes, declared ? size + 1 : null);
    assert.equal(cancelled, true);
  }
});
