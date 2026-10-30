import { read_script } from "./support/script_sources.js";
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { RssRouteCache } from "../server/infra/rss_cache.js";
import { snapshot_store } from "./support/snapshot_store.js";
import { image_proxy_descriptor, image_proxy_target } from "../server/lib/image_proxy.js";
import { fetch_script_image } from "../server/infra/image_proxy.js";
import { sha256_hex } from "../server/lib/crypto.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const {
  compile_script_module,
  execute_script
} = await import("../server/infra/script_sandbox.js");
const {
  ServiceScript
} = await import("../server/service/application/scripts.js");
const {
  route: dispatch
} = await import("../application_router.js");
const {
  default: worker
} = await import("../api.js");
const feed = (path, title = path) => `{ path: ${JSON.stringify(path)}, name: "feed", url: "example.com", maintainers: [], example: ${JSON.stringify(path)}, parameters: {}, description: "", handler(ctx) { return { title: ${JSON.stringify(title)}, image: ctx.public_origin + "/wxmpimgproxy?url=x", items: [] }; } }`;
const image = (handler = 'return { url: ctx.query.url, headers: { Referer: "https://mp.weixin.qq.com/" } };') => `{ public: true, path: "/wxmpimgproxy", name: "图片", allowed_hosts: ["mmbiz.qpic.cn"], example: "/wxmpimgproxy?url=https%3A%2F%2Fmmbiz.qpic.cn%2Fa", handler(ctx) { ${handler} } }`;
const source = `export const routes = [${feed("/first")}, ${feed("/second")}, ${image()}];`;
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const proxy_route = {
  allowed_hosts: ["mmbiz.qpic.cn"]
};
test("路由接受多位维护者对象、旧字符串和平台元数据；非法字段在保存前拒绝", async () => {
  const maintainers = [{
    nickname: "甲",
    url: "https://example.com/author",
    avatar: "https://example.com/avatar.png"
  }, {
    nickname: "乙",
    url: "",
    avatar: ""
  }, "旧维护者"];
  const compile = metadata => compile_script_module(`export const route = { path: "/metadata", name: "元数据", handler() {}, ...${JSON.stringify(metadata)} };`);
  const compiled = await compile({
    platform: "知乎",
    maintainers
  });
  assert.equal(compiled.error, "");
  assert.deepEqual(compiled.metadata.platform, {
    name: "知乎",
    icon: ""
  });
  assert.deepEqual(compiled.metadata.maintainers, maintainers);
  const named = await compile({
    maintainers: [{
      name: "  丙  ",
      avatar: "https://example.com/c.png"
    }]
  });
  assert.equal(named.error, "");
  assert.deepEqual(named.metadata.maintainers, [{
    nickname: "丙",
    url: "",
    avatar: "https://example.com/c.png"
  }]);
  assert.deepEqual((await compile({})).metadata.platform, {
    name: "网页",
    icon: ""
  });
  for (const metadata of [{
    platform: []
  }, {
    platform: ""
  }, {
    platform: "all"
  }, {
    platform: "bad\nname"
  }, {
    platform: "a".repeat(65)
  }, {
    maintainers: [{}]
  }, {
    maintainers: [{
      nickname: ""
    }]
  }, {
    maintainers: [{
      nickname: "甲",
      avatar: "javascript:alert(1)"
    }]
  }, {
    maintainers: [{
      nickname: "甲",
      url: "https://user:password@example.com/"
    }]
  }, {
    maintainers: [null]
  }, {
    maintainers: [{
      name: ""
    }]
  }, {
    maintainers: [{
      name: "a".repeat(129)
    }]
  }, {
    maintainers: [{
      name: 123
    }]
  }, {
    maintainers: [{
      name: "丙",
      avatar: "javascript:alert(1)"
    }]
  }]) {
    assert.notEqual((await compile(metadata)).error, "", JSON.stringify(metadata));
  }
});
async function setup(script = source) {
  const compiled = await compile_script_module(script);
  assert.equal(compiled.error, "");
  const rows = [{
    route: "module-1",
    path: compiled.metadata.path,
    script,
    metadata_json: JSON.stringify(compiled.metadata),
    enabled: 1,
    updated_at: 1
  }];
  const cache = new RssRouteCache(60000, 100);
  const service = new ServiceScript({
    public_origin: "https://feeds.example.com",
    repo: {
      rss_route_cache: snapshot_store().repo,
      scripts: {
        list: () => rows,
        list_enabled: () => rows.filter(row => row.enabled),
        find: async id => await rows.find(row => row.route === id),
        find_config: async id => await rows.find(row => row.route === id),
        count: () => rows.length,
        insert: row => rows.push(row),
        update: async value => await Object.assign(await rows.find(row => row.route === value.route), value),
        exists: id => rows.some(row => row.route === id),
        delete: id => rows.splice(rows.findIndex(row => row.route === id), 1)
      },
      rss_cookies: {
        get: () => []
      },
      script_logs: {
        delete_for_route() {}
      }
    },
    ports: {
      route_cache: cache
    },
    app: {}
  });
  service.rss_address_is_public = () => true;
  service.record_log = () => {};
  return {
    service,
    rows,
    cache,
    metadata: compiled.metadata
  };
}
const edit = body => new Request("https://internal/_admin/scripts/module-1", {
  method: "PATCH",
  body: JSON.stringify(body)
});
test("脚本新增、修改平台和删除均重新发布首页目录", async () => {
  const {
    service
  } = await setup();
  let published = 0;
  service.app.discovery = {
    async publish_catalog() {
      published++;
    }
  };
  const created = await service.create_script(edit({
    script: `export const route = { ...${feed("/platform")}, platform: "知乎" };`,
    version: "1.0.0"
  }));
  assert.deepEqual(created.data.script.platform, {
    name: "知乎",
    icon: ""
  });
  assert.equal(published, 1);
  const updated = await service.update_script(edit({
    script: `export const route = { ...${feed("/platform")}, platform: "独立平台" };`,
    version: "1.0.1"
  }), created.data.script.id);
  assert.deepEqual(updated.script.platform, {
    name: "独立平台",
    icon: ""
  });
  assert.equal(published, 2);
  await service.delete_script(created.data.script.id);
  assert.equal(published, 3);
});
test("多路由编译校验全部条目，旧 route 可用，双导出/重复路径/系统路径拒绝", async () => {
  const compiled = await compile_script_module(source);
  assert.equal(compiled.error, "");
  assert.ok(compiled.metadata.routes.every(entry => !Object.hasOwn(entry, "type")));
  assert.equal(compiled.metadata.routes[2].public, true);
  assert.equal((await compile_script_module(`export const route = ${feed("/legacy")};`)).error, "");
  for (const script of [`export const route = ${feed("/a")}; export const routes = [route];`, `export const routes = [${feed("/a")}, ${feed("/a")}];`, `export const routes = [${image().replace('/wxmpimgproxy', '/admin/proxy')}];`, `export const routes = [${image().replace('mmbiz.qpic.cn', '*.qpic.cn')}];`, `export const routes = [${image().replace('mmbiz.qpic.cn', '127.0.0.1')}];`, `export const routes = [${image().replace('mmbiz.qpic.cn', 'metadata.goog')}];`, 'export const routes = [];']) assert.notEqual((await compile_script_module(script)).error, "", script);
});
test("选中第二条 feed handler，RSS/Atom 共享执行缓存且 origin 固定", async () => {
  const fixture = await setup();
  fixture.service.rss_cookies = () => [];
  await fixture.service.serve_rss_route("rss", "/second", new Request("https://internal/_public/feed/rss/second"), {
    refresh: true
  });
  for (const format of ["rss", "atom"]) {
    const response = await dispatch(new Request(`https://internal/_public/feed/${format}/second`), {
      scripts: fixture.service
    });
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /second/);
    assert.match(body, /https:\/\/feeds.example.com\/wxmpimgproxy/);
  }
  assert.equal(fixture.cache.stats().executions, 1);
  await assert.rejects(fixture.service.serve_rss_route("rss", "/wxmpimgproxy", new Request("https://internal/_public/feed/rss/wxmpimgproxy?url=https%3A%2F%2Fmmbiz.qpic.cn%2Fa"), {
    refresh: true
  }), {
    status: 502
  });
});
test("附加路由冲突返回 409，保存失败不覆盖源码和路由", async () => {
  const {
    service,
    rows
  } = await setup();
  const original = {
    ...rows[0]
  };
  await assert.rejects(service.create_script(edit({
    script: `export const route = ${feed("/second")};`,
    version: "1.0.0"
  })), error => error.status === 409);
  await assert.rejects(service.update_script(edit({
    script: 'export const routes = [];'
  }), "module-1"), error => error.status === 400);
  assert.deepEqual(rows[0], original);
  rows.push({
    ...original,
    route: "other",
    path: "/third",
    metadata_json: JSON.stringify({
      path: "/third"
    })
  });
  await assert.rejects(service.update_script(edit({
    script: `export const routes = [${feed("/first")}, ${feed("/third")}];`,
    version: "1.0.0"
  }), "module-1"), error => error.status === 409);
  assert.deepEqual(rows[0], original);
});
test("路由测试返回描述，停用删除立即失效", async () => {
  const {
    service,
    rows
  } = await setup();
  const result = await service.test_script(edit({
    script: source,
    route_index: 2
  }));
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(result.preview).url, "https://mmbiz.qpic.cn/a");
  const request = new Request("https://internal/_public/feed/raw/wxmpimgproxy?url=https%3A%2F%2Fmmbiz.qpic.cn%2Fa&token=private");
  assert.equal((await service.serve_rss_route("raw", "/wxmpimgproxy", request)).raw.headers.Referer, "https://mp.weixin.qq.com/");
  await service.update_script(edit({
    enabled: false
  }), "module-1");
  await assert.rejects(service.serve_rss_route("raw", "/wxmpimgproxy", request), error => error.status === 404);
  await service.update_script(edit({
    enabled: true
  }), "module-1");
  await service.delete_script("module-1");
  assert.equal(rows.length, 0);
  await assert.rejects(service.serve_rss_route("raw", "/wxmpimgproxy", request), error => error.status === 404);
});
test("路由函数共享 fetchText 和 invoke 能力，按 handler 索引执行", async () => {
  const script = `export const routes = [${feed("/first")}, ${image('const invoked = await ctx.invoke("demo", {}); if (invoked.error) return invoked; const fetched = await ctx.fetchText("https://example.com/chapter"); if (fetched.error) return fetched; return Result.Ok({ body: fetched.data, content_type: "text/html" });').replace('handler(ctx)', 'async handler(ctx)')}];`;
  const compiled = await compile_script_module(script);
  assert.equal(compiled.error, "");
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response("<p>正文</p>");
  try {
    const result = await execute_script(script, compiled.metadata.routes[1], null, {
      pathname: "/wxmpimgproxy",
      params: {},
      query: {}
    }, [], '({ invoke() { return {}; } })');
    assert.deepEqual(JSON.parse(result.output), {
      body: "<p>正文</p>",
      content_type: "text/html"
    });
  } finally {
    globalThis.fetch = previous;
  }
});
test("代理拒绝白名单外地址、非 HTTPS、凭证、端口、请求头注入", () => {
  for (const url of ['https://mmbiz.qpic.cn.evil.com/a', 'https://127.0.0.1/a', 'http://mmbiz.qpic.cn/a', 'https://mmbiz.qpic.cn:8443/a', 'https://user:pass@mmbiz.qpic.cn/a']) assert.throws(() => image_proxy_target(proxy_route, url));
  for (const headers of [{
    Cookie: 'secret'
  }, {
    Authorization: 'secret'
  }, {
    Host: 'evil.example'
  }, {
    Referer: 'bad\r\nCookie: secret'
  }, {
    'sec-fetch-site': 'cross-site\r\nCookie: secret'
  }, {
    'Accept-Language': 'x'.repeat(2049)
  }, {
    Priority: 1
  }]) {
    assert.throws(() => image_proxy_descriptor(proxy_route, {
      url: "https://mmbiz.qpic.cn/a",
      headers
    }));
  }
});
test("宿主读取真实二进制、验证每跳地址与类型、限制正文大小", async () => {
  const urls = [];
  const result = await fetch_script_image(proxy_route, {
    url: "https://mmbiz.qpic.cn/a"
  }, async (url, options) => {
    urls.push(url);
    assert.equal(await new Headers(options.headers).get("cookie"), null);
    assert.equal(options.redirect, "manual");
    return urls.length === 1 ? new Response(null, {
      status: 302,
      headers: {
        Location: "/b"
      }
    }) : new Response(png, {
      headers: {
        "Content-Type": "image/png"
      }
    });
  });
  assert.deepEqual(result.body, png);
  assert.deepEqual(urls, ["https://mmbiz.qpic.cn/a", "https://mmbiz.qpic.cn/b"]);
  for (const response of [new Response(null, {
    status: 302,
    headers: {
      Location: "https://evil.example/a"
    }
  }), new Response("<html>bad</html>", {
    headers: {
      "Content-Type": "image/png"
    }
  }), new Response(png, {
    headers: {
      "Content-Type": "image/svg+xml"
    }
  }), new Response(new Uint8Array(5 * 1024 * 1024 + 1), {
    headers: {
      "Content-Type": "image/png"
    }
  })]) await assert.rejects(fetch_script_image(proxy_route, {
    url: "https://mmbiz.qpic.cn/a"
  }, async () => response));
});
test("公众号、微博与 Apple 图片路由 GET/HEAD 强缓存 90 天并命中边缘缓存；客户端身份头不透传上游", async () => {
  const original = globalThis.fetch;
  const original_caches = globalThis.caches;
  try {
    for (const [file, path, target, referer] of [["wxmp", "/img/wxmp", "https://mmbiz.qpic.cn/a", "https://mp.weixin.qq.com/"], ["weibo", "/img/weibo", "https://wx4.sinaimg.cn/orj360/001YqBPrgy1ih705eegpfj63uw8ohnpv02.jpg", "https://weibo.com/"], ["weibo", "/img/weibo", "https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/e1/201810_yueliang_mobile.png", "https://weibo.com/"], ["apple", "/img/apple", "https://is1-ssl.mzstatic.com/image/thumb/example/400x400bb.webp", "https://apps.apple.com/"]]) {
      const script = read_script(`rss/${file}.js`);
      const {
        service,
        metadata,
        rows
      } = await setup(script);
      assert.equal(metadata.routes.find(route => route.path === path).public, true);
      service.rss_address_is_public = () => false;
      if (metadata.permissions.cookies.length) {
        const grant = {
          script_id: "module-1",
          script_hash: await sha256_hex(script),
          permissions_json: JSON.stringify({
            permissions: metadata.permissions,
            visibility: service.cookie_visibility(metadata),
            version: metadata.version
          })
        };
        rows[0].metadata_json = JSON.stringify({
          ...metadata,
          cookie_grant_id: "image-test-grant"
        });
        service.repo.rss_cookie_grants = {
          find: id => id === "image-test-grant" ? grant : undefined
        };
      }
      const env = {
        APPLICATION: (() => ({
          fetch: request => dispatch(request, {
            scripts: service
          })
        }))()
      };
      const entries = new Map();
      let upstream_calls = 0;
      globalThis.caches = {
        default: {
          async match(request) {
            return (await entries.get(request.url))?.clone();
          },
          async put(request, response) {
            entries.set(request.url, response);
          }
        }
      };
      globalThis.fetch = async (url, options) => {
        upstream_calls++;
        assert.equal(url, target);
        assert.equal(options.headers.referer, referer);
        if (file === "weibo" || file === "apple") {
          assert.match(options.headers["user-agent"], /Chrome\/155/);
          assert.equal(options.headers["sec-fetch-dest"], "image");
          assert.equal(options.headers["sec-fetch-mode"], "no-cors");
          assert.equal(options.headers["cache-control"], "no-cache");
          assert.equal(options.headers["sec-ch-ua-platform"], '"macOS"');
          assert.equal(options.headers["sec-fetch-storage-access"], "active");
          assert.doesNotMatch(options.headers.accept, /avif|jxl|svg/);
        } else assert.deepEqual(options.headers, {
          referer
        });
        assert.equal(options.headers.cookie, undefined);
        assert.equal(options.headers.authorization, undefined);
        return new Response(png, {
          headers: {
            "Content-Type": "image/png",
            "Set-Cookie": "secret"
          }
        });
      };
      for (const method of ["GET", "HEAD", "GET"]) {
        const request_url = file === "weibo" ? target.replace("/orj360/", "/large/") : target;
        const response = await worker.fetch(new Request("https://feeds.example.com" + path + "?url=" + encodeURIComponent(request_url), {
          method,
          headers: {
            Cookie: "private",
            Authorization: "Bearer private"
          }
        }), env);
        assert.equal(response.status, 200);
        assert.equal(await response.headers.get("Content-Type"), "image/png");
        assert.equal(await response.headers.get("Cache-Control"), "public, max-age=7776000, immutable");
        assert.equal(await response.headers.get("Set-Cookie"), null);
        assert.equal((await response.arrayBuffer()).byteLength, method === "HEAD" ? 0 : png.length);
      }
      assert.equal(upstream_calls, 1, file + " 图片缓存命中后不再请求上游");
      assert.equal(entries.size, 1);
    }
  } finally {
    globalThis.fetch = original;
    globalThis.caches = original_caches;
  }
});
test("图片缓存复用二进制，停用后仍检查路由，缓存不可用不影响成功响应", async () => {
  const {
    service
  } = await setup();
  const env = {
    APPLICATION: (() => ({
      fetch: request => dispatch(request, {
        scripts: service
      })
    }))()
  };
  const previous_fetch = globalThis.fetch;
  const previous_caches = globalThis.caches;
  const entries = new Map();
  let calls = 0;
  globalThis.caches = {
    default: {
      async match(request) {
        return (await entries.get(request.url))?.clone();
      },
      async put(request, response) {
        entries.set(request.url, response);
      }
    }
  };
  globalThis.fetch = async () => {
    calls++;
    return new Response(png, {
      headers: {
        "Content-Type": "image/png"
      }
    });
  };
  const request = () => new Request("https://feeds.example.com/wxmpimgproxy?url=https%3A%2F%2Fmmbiz.qpic.cn%2Fa");
  try {
    for (let index = 0; index < 2; index++) {
      const response = await worker.fetch(request(), env);
      assert.equal(response.status, 200);
      assert.equal(await response.headers.get("Cache-Control"), "public, max-age=7776000, immutable");
    }
    assert.equal(await [...entries.values()][0].headers.get("Cache-Control"), "public, max-age=7776000, immutable");
    assert.equal(calls, 1);
    await service.update_script(edit({
      enabled: false
    }), "module-1");
    assert.equal((await worker.fetch(request(), env)).status, 404);
    await service.update_script(edit({
      enabled: true
    }), "module-1");
    globalThis.caches.default = {
      match: async () => {
        throw new Error("cache unavailable");
      },
      put: async () => {
        throw new Error("cache unavailable");
      }
    };
    assert.equal((await worker.fetch(request(), env)).status, 200);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previous_fetch;
    if (previous_caches === undefined) delete globalThis.caches;else globalThis.caches = previous_caches;
  }
});
