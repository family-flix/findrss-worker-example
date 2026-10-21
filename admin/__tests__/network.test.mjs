import assert from "node:assert/strict";
import test from "node:test";
import { NetworkTestModel } from "../pages/network.model.js";

const ui = { ref: value => ({ value, as(next) { this.value = next; } }) };
const set_headers = (model, headers) => {
  for (const row of model.state.headers.value) model.methods.remove_header(row.id);
  for (const [key, value] of Object.entries(headers)) model.methods.add_header(key, value);
};

test("执行位置默认 Worker，可切换脚本宿主，测试和 curl 均发送到对应位置", async () => {
  const calls = [];
  const model = NetworkTestModel({ ui, clipboard: { writeText: async () => {} }, fetch_impl: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    model.methods.set("execution", "worker");
    return Response.json(url.includes("/curl") ? { command: "curl --http1.1" } : { status: 200, execution: "script" });
  } });
  assert.equal(model.state.execution.value, "worker");
  model.methods.set("execution", "script");
  model.methods.set("transport", "tcp");
  await model.methods.run();
  await model.methods.copy_curl();
  assert.deepEqual(calls.map(call => call.url), ["/admin/api/network-test?execution=script", "/admin/api/network-test/curl?execution=script"]);
  assert.deepEqual(calls[0].body, calls[1].body);
  assert.equal(model.state.execution.value, "script");
  assert.equal(model.state.result.value.execution, "script");
  assert.equal(model.state.copied.value, true);
  model.methods.set("execution", "worker");
  assert.equal(model.state.copied.value, false);
  model.methods.set("execution", "unknown");
  await model.methods.run();
  assert.match(model.state.error.value, /执行位置/);
  assert.equal(calls.length, 2);
});

test("传输方式默认 Fetch，可切换 TCP 并同时用于测试和 curl，忙碌时禁止切换", async () => {
  const calls = [];
  const model = NetworkTestModel({ ui, clipboard: { writeText: async () => {} }, fetch_impl: async (url, options) => {
    calls.push(JSON.parse(options.body));
    model.methods.set("transport", "fetch");
    return Response.json(url.endsWith("/curl") ? { command: "curl --http1.1" } : { status: 200 });
  } });
  assert.equal(model.state.transport.value, "fetch");
  model.methods.set("transport", "tcp");
  await model.methods.run();
  await model.methods.copy_curl();
  assert.equal(model.state.transport.value, "tcp");
  assert.deepEqual(calls.map(body => body.transport), ["tcp", "tcp"]);
  assert.equal(model.state.copied.value, true);
  model.methods.set("transport", "fetch");
  assert.equal(model.state.copied.value, false);
  model.methods.set("transport", "udp");
  await model.methods.run();
  assert.match(model.state.error.value, /传输方式/);
  assert.equal(calls.length, 2);
});

test("请求头支持增删和编辑键值，忽略空白行，空值保留，测试与 curl 使用同一份数据", async () => {
  const calls = [];
  const model = NetworkTestModel({ ui, clipboard: { writeText: async () => {} }, fetch_impl: async (url, options) => {
    calls.push(JSON.parse(options.body).headers);
    return Response.json(url.endsWith("/curl") ? { command: "curl 'https://example.com/'" } : { status: 200 });
  } });
  assert.deepEqual(model.state.headers.value.map(row => row.key.value), ["Referer", "Accept", "Accept-Language", "User-Agent"]);
  set_headers(model, {});
  model.methods.add_header();
  const row = model.state.headers.value[0];
  model.methods.update_header(row.id, "key", "  Accept  ");
  model.methods.update_header(row.id, "value", "text/html");
  model.methods.update_header(row.id, "key", "User-Agent");
  model.methods.update_header(row.id, "value", "local-test");
  model.methods.add_header("Accept", "");
  model.methods.add_header();
  assert.equal(model.state.headers.value[0], row);
  await model.methods.run();
  await model.methods.copy_curl();
  assert.deepEqual(calls, [{ "User-Agent": "local-test", Accept: "" }, { "User-Agent": "local-test", Accept: "" }]);
  assert.equal(model.state.copied.value, true);
  model.methods.update_header(row.id, "value", "edited");
  assert.equal(model.state.copied.value, false);
  for (const entry of model.state.headers.value) model.methods.remove_header(entry.id);
  await model.methods.run();
  assert.deepEqual(calls[2], {});
});

test("无效名称、重复名称、换行值及手填 Cookie 阻止测试和复制请求", async () => {
  const model = NetworkTestModel({ ui, fetch_impl: async () => assert.fail("无效请求头不得提交") });
  for (const headers of [ [["", "value"]], [["bad name", "value"]], [["Accept", "a"], ["accept", "b"]],
    [["Accept", "a\r\nb"]], [["Accept", "a\0b"]], [["cOoKiE", "manual"]] ]) {
    set_headers(model, {});
    for (const [key, value] of headers) model.methods.add_header(key, value);
    for (const action of [model.methods.run, model.methods.copy_curl]) {
      await action();
      assert.ok(model.state.error.value);
      assert.equal(model.state.busy.value, false);
    }
  }
});

test("修改有效目标网址更新 Referer，删除后补回，允许手动编辑，无效网址不覆盖", () => {
  const model = NetworkTestModel({ ui });
  const referer = model.state.headers.value[0];
  model.methods.set("url", "https://example.com/path?x=1#section");
  assert.equal(referer.value.value, "https://example.com/path?x=1");
  assert.equal(model.state.headers.value[0], referer);
  model.methods.update_header(referer.id, "key", "rEfErEr");
  model.methods.update_header(referer.id, "value", "https://manual.example/");
  assert.equal(referer.value.value, "https://manual.example/");
  for (const url of ["", "https://", "file:///tmp/example", "https://user:pass@example.com/"]) model.methods.set("url", url);
  assert.equal(referer.value.value, "https://manual.example/");
  model.methods.set("url", "http://other.example/");
  assert.equal(referer.value.value, "http://other.example/");
  model.methods.remove_header(referer.id);
  model.methods.set("url", "https://example.com/new");
  const added = model.state.headers.value.find(row => row.key.value === "Referer");
  assert.equal(added.value.value, "https://example.com/new");
  const before = model.state.headers.value;
  model.state.busy.as(true);
  model.methods.add_header(); model.methods.remove_header(added.id);
  model.methods.update_header(added.id, "value", "blocked");
  model.methods.set("url", "https://blocked.example/");
  assert.equal(model.state.headers.value, before);
  assert.equal(added.value.value, "https://example.com/new");
});

test("复制 curl 使用当前参数和所选域名，保留测试结果并显示复制状态", async () => {
  const calls = [], copied = [];
  let finish;
  const model = NetworkTestModel({ ui, clipboard: { writeText: async text => copied.push(text) }, fetch_impl: (url, options) => {
    calls.push({ url, options });
    return new Promise(resolve => { finish = resolve; });
  } });
  model.state.cookie_domains.as([{ domain: ".example.com", count: 1 }]);
  model.methods.set("url", "https://www.example.com/private");
  set_headers(model, { "User-Agent": "local-test" });
  model.methods.set("timeout", "15");
  const result = { status: 403, body: "保留结果" };
  model.state.result.as(result);
  const pending = model.methods.copy_curl();
  assert.equal(model.state.busy.value, true);
  assert.equal(model.state.copying.value, true);
  await model.methods.copy_curl();
  await model.methods.run();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/admin/api/network-test/curl");
  assert.deepEqual(JSON.parse(calls[0].options.body), { url: "https://www.example.com/private", timeout_ms: 15000, transport: "fetch",
    headers: { "User-Agent": "local-test" }, cookie_domains: [".example.com"] });
  finish(Response.json({ command: "curl --url 'https://www.example.com/private'" }));
  await pending;
  assert.deepEqual(copied, ["curl --url 'https://www.example.com/private'"]);
  assert.equal(model.state.result.value, result);
  assert.equal(model.state.copied.value, true);
  assert.equal(model.state.busy.value, false);
  assert.equal(model.state.copying.value, false);
  model.methods.toggle_cookie_domain(".example.com", false);
  assert.equal(model.state.copied.value, false);
});

test("复制 curl 校验输入，显示接口或剪贴板错误，离开页面后不复制迟到响应", async () => {
  const copied = [];
  let response = Response.json({ error: "读取 Cookie 失败" }, { status: 502 });
  let finish, calls = 0;
  const model = NetworkTestModel({ ui, clipboard: { async writeText(text) { copied.push(text); throw new Error("剪贴板权限被拒绝"); } },
    fetch_impl: async () => { calls++; return response ?? new Promise(resolve => { finish = resolve; }); } });
  set_headers(model, { Cookie: "manual" });
  await model.methods.copy_curl();
  assert.match(model.state.error.value, /请勾选/);
  assert.equal(calls, 0);
  set_headers(model, {});
  await model.methods.copy_curl();
  assert.equal(model.state.error.value, "读取 Cookie 失败");
  response = Response.json({ command: "curl 'https://example.com/'" });
  await model.methods.copy_curl();
  assert.equal(model.state.error.value, "剪贴板权限被拒绝");
  assert.equal(model.state.copied.value, false);
  assert.equal(model.state.busy.value, false);
  response = null;
  const pending = model.methods.copy_curl();
  model.methods.leave();
  finish(Response.json({ command: "旧命令" }));
  await pending;
  assert.deepEqual(copied, ["curl 'https://example.com/'"]);
  assert.equal(model.state.copied.value, false);
});

test("网络测试只调用后台接口，可编辑网址、超时和请求头，保留 HTTP 错误响应", async () => {
  let finish;
  const calls = [];
  const model = NetworkTestModel({ ui, fetch_impl: (url, options) => {
    calls.push({ url, options });
    return new Promise(resolve => { finish = resolve; });
  } });
  model.methods.set("url", "https://example.com/path");
  model.methods.set("timeout", "60");
  set_headers(model, { "User-Agent": "my-agent" });
  const pending = model.methods.run();
  assert.equal(model.state.busy.value, true);
  await model.methods.run();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/admin/api/network-test");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    url: "https://example.com/path", timeout_ms: 60000, transport: "fetch", headers: { "User-Agent": "my-agent" }, cookie_domains: [],
  });
  finish(Response.json({ status: 403, body: "WAF 拦截", error: "" }));
  await pending;
  assert.equal(model.state.result.value.status, 403);
  assert.equal(model.state.result.value.body, "WAF 拦截");
  assert.equal(model.state.error.value, "");
  assert.equal(model.state.busy.value, false);
});

test("输入无效不提交；后端校验错误和带诊断的超时均可展示和重试", async () => {
  let calls = 0;
  const model = NetworkTestModel({ ui, fetch_impl: async () => {
    calls++;
    return calls === 1 ? Response.json({ error: "地址被拒绝" }, { status: 400 })
      : Response.json({ status: null, requests: [], error: "请求超时", code: "UPSTREAM_TIMEOUT" });
  } });
  for (const [key, invalid] of [["url", "file:///etc/passwd"], ["timeout", "61"]]) {
    const original = model.state[key].value;
    model.methods.set(key, invalid);
    await model.methods.run();
    assert.ok(model.state.error.value);
    model.methods.set(key, original);
  }
  assert.equal(calls, 0);
  await model.methods.run();
  assert.equal(model.state.error.value, "地址被拒绝");
  assert.equal(model.state.busy.value, false);
  await model.methods.run();
  assert.equal(model.state.error.value, "请求超时");
  assert.equal(model.state.result.value.code, "UPSTREAM_TIMEOUT");
});

test("Cookie 按目标域名筛选并默认勾选，支持取消、刷新和仅提交匹配域名", async () => {
  const calls = [];
  let domains = [{ domain: ".example.com", count: 2 }, { domain: "www.example.com", count: 1 }, { domain: "other.example", count: 1 }];
  const model = NetworkTestModel({ ui, fetch_impl: async (url, options) => {
    if (url.endsWith("/cookie-domains")) return Response.json({ domains });
    calls.push(options);
    return Response.json({ status: 200, error: "" });
  } });
  model.methods.set("url", "https://www.example.com/path");
  await model.methods.load_cookie_domains();
  assert.deepEqual(model.state.cookie_domains.value, domains);
  assert.deepEqual(model.state.matching_domains.value, domains.slice(0, 2));
  assert.deepEqual(model.state.selected_domains.value, [".example.com", "www.example.com"]);
  model.methods.toggle_cookie_domain(".example.com");
  assert.deepEqual(model.state.selected_domains.value, ["www.example.com"]);
  model.methods.toggle_cookie_domain(".example.com");
  assert.deepEqual(model.state.selected_domains.value, ["www.example.com", ".example.com"]);
  model.methods.toggle_cookie_domain("www.example.com", false);
  model.methods.set("url", "https://www.example.com/other?next=https://other.example");
  await model.methods.load_cookie_domains();
  assert.deepEqual(model.state.selected_domains.value, [".example.com"]);
  model.methods.toggle_cookie_domain(".example.com", true);
  model.methods.toggle_cookie_domain("other.example", true);
  model.methods.toggle_cookie_domain("missing.example", true);
  assert.deepEqual(model.state.selected_domains.value, [".example.com"]);
  model.methods.toggle_cookie_domain("other.example", false);
  await model.methods.run();
  assert.deepEqual(JSON.parse(calls[0].body).cookie_domains, [".example.com"]);
  assert.equal(Object.keys(JSON.parse(calls[0].body).headers).some(name => name.toLowerCase() === "cookie"), false);
  assert.equal(new Headers(calls[0].headers).has("cookie"), false);
  domains = [{ domain: "other.example", count: 1 }];
  await model.methods.load_cookie_domains();
  assert.deepEqual(model.state.selected_domains.value, []);
  await model.methods.run();
  assert.deepEqual(JSON.parse(calls[1].body).cookie_domains, []);
});

test("切换目标域名重新默认勾选，匹配域边界、大小写和前导点，无效网址清空匹配", async () => {
  const domains = [".example.com", "*.example.com", "API.Example.COM", "other.example", ".notexample.com"].map(domain => ({ domain, count: 1 }));
  const model = NetworkTestModel({ ui, fetch_impl: async () => Response.json({ domains }) });
  const loading = model.methods.load_cookie_domains();
  model.methods.set("url", "https://API.Example.COM:443/path");
  await loading;
  assert.deepEqual(model.state.selected_domains.value, domains.slice(0, 3).map(entry => entry.domain));
  model.methods.toggle_cookie_domain(".example.com", false);
  model.methods.set("url", "https://other.example/");
  assert.deepEqual(model.state.matching_domains.value, [domains[3]]);
  assert.deepEqual(model.state.selected_domains.value, ["other.example"]);
  model.methods.set("url", "https://example.com/");
  assert.deepEqual(model.state.selected_domains.value, [".example.com", "*.example.com"]);
  model.methods.set("url", "https://notexample.com/");
  assert.deepEqual(model.state.selected_domains.value, [".notexample.com"]);
  for (const url of ["", "https://", "file:///example.com", "https://user:pass@example.com/", "https://example.com.evil.test/"]) {
    model.methods.set("url", url);
    assert.deepEqual(model.state.matching_domains.value, [], url);
    assert.deepEqual(model.state.selected_domains.value, [], url);
  }
  model.methods.set("url", "https://example.com/");
  domains.push({ domain: "example.com", count: 1 });
  await model.methods.load_cookie_domains();
  assert.deepEqual(model.state.selected_domains.value, [".example.com", "*.example.com", "example.com"]);
});

test("域名读取失败可以重试，离开后忽略旧请求且不影响返回页面的新请求", async () => {
  let fail = true;
  const calls = [];
  const model = NetworkTestModel({ ui, fetch_impl: (_, options) => fail
    ? Promise.resolve(Response.json({ error: "读取失败" }, { status: 502 }))
    : new Promise(resolve => calls.push({ options, resolve })) });
  await model.methods.load_cookie_domains();
  assert.equal(model.state.cookies_error.value, "读取失败");
  fail = false;
  const old = model.methods.load_cookie_domains();
  model.methods.leave();
  assert.equal(calls[0].options.signal.aborted, true);
  const current = model.methods.load_cookie_domains();
  calls[0].resolve(Response.json({ domains: [{ domain: "old.example", count: 1 }] }));
  await old;
  assert.equal(model.state.cookies_loading.value, true);
  assert.deepEqual(model.state.cookie_domains.value, []);
  calls[1].resolve(Response.json({ domains: [{ domain: "new.example", count: 2 }] }));
  await current;
  assert.equal(model.state.cookie_domains.value[0].domain, "new.example");
  assert.equal(model.state.cookies_loading.value, false);
});

test("离开页面取消浏览器请求并忽略迟到结果，返回后可以再次测试", async () => {
  const calls = [];
  const model = NetworkTestModel({ ui, fetch_impl: (_, options) => new Promise(resolve => calls.push({ options, resolve })) });
  model.state.cookie_domains.as([{ domain: ".example.com", count: 1 }]);
  model.methods.set("url", "https://example.com/");
  model.methods.toggle_cookie_domain(".example.com", true);
  const first = model.methods.run();
  model.methods.leave();
  assert.deepEqual(model.state.selected_domains.value, []);
  assert.equal(calls[0].options.signal.aborted, true);
  const second = model.methods.run();
  assert.deepEqual(JSON.parse(calls[1].options.body).cookie_domains, []);
  calls[0].resolve(Response.json({ status: 200, body: "旧响应" }));
  await first;
  assert.equal(model.state.busy.value, true);
  assert.equal(model.state.result.value, null);
  calls[1].resolve(Response.json({ status: 200, body: "新响应" }));
  await second;
  assert.equal(model.state.result.value.body, "新响应");
  assert.equal(model.state.busy.value, false);
});

test("网络正文严格按 Content-Type 格式化 HTML/JSON/JS/CSS，其他文本不高亮、不猜测", async () => {
  let result;
  const model = NetworkTestModel({ ui, fetch_impl: async () => Response.json(result) });
  for (const [type, body, mode, formatted] of [
    ["Text/HTML; charset=utf-8", "<div><p>内容</p></div>", "text/html", /\n  <p>/],
    ["application/problem+json", '{"id":9007199254740993123,"ok":true}', "application/json", /\n  "id": 9007199254740993123/],
    ["text/javascript; charset=utf-8", "const x={a:1};", "javascript", /const x = \{\n  a: 1/],
    ["text/css", "a{color:red}", "text/css", /\n  color: red/],
  ]) {
    result = { body, content_type: type, body_kind: "text" };
    await model.methods.run();
    assert.equal(model.state.preview.value.mode, mode);
    assert.match(model.state.preview.value.formatted, formatted);
  }
  for (const type of ["text/plain", "application/xml", "application/rss+xml", "text/csv", ""]) {
    const body = '<root><node> x </node></root>';
    result = { body, content_type: type, body_kind: "text" };
    await model.methods.run();
    assert.equal(model.state.preview.value.mode, "text/plain", type);
    assert.equal(model.state.preview.value.formatted, body, type);
  }
  result = { body: '{"broken":', content_type: "application/json", body_kind: "text", truncated: true };
  await model.methods.run();
  assert.equal(model.state.preview.value.formatted, result.body);
});

test("媒体预览使用 Blob URL，切换响应及离开页面时释放，文件信息不生成播放器地址", async () => {
  const created = [], revoked = [];
  let kind = "img";
  const model = NetworkTestModel({ ui, object_urls: {
    createObjectURL(blob) { created.push(blob); return "blob:preview-" + created.length; },
    revokeObjectURL(url) { revoked.push(url); },
  }, fetch_impl: async () => {
    const result = { body_kind: kind, file: { name: "demo", type: kind === "file" ? "application/zip" : "image/png", size_bytes: 3 } };
    if (kind === "file") return Response.json(result);
    const form = new FormData();
    form.set("result", JSON.stringify(result));
    form.set("media", new Blob([new Uint8Array([0, 128, 255])], { type: "image/png" }), "demo.png");
    return new Response(form);
  } });
  await model.methods.run();
  assert.equal(model.state.preview.value.kind, "img");
  assert.equal(model.state.preview.value.src, "blob:preview-1");
  assert.deepEqual(new Uint8Array(await created[0].arrayBuffer()), new Uint8Array([0, 128, 255]));
  kind = "audio";
  await model.methods.run();
  assert.deepEqual(revoked, ["blob:preview-1"]);
  assert.equal(model.state.preview.value.kind, "audio");
  assert.equal(model.state.preview.value.src, "blob:preview-2");
  model.methods.leave();
  assert.deepEqual(revoked, ["blob:preview-1", "blob:preview-2"]);
  assert.equal(model.state.preview.value.src, "");
  kind = "file";
  await model.methods.run();
  assert.equal(model.state.preview.value.kind, "file");
  assert.equal(model.state.preview.value.file.name, "demo");
  assert.equal(created.length, 2);
});
