import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { watch_admin_dev } from "../scripts/admin_dev.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const exec_file = promisify(execFile);

test("本地 package 依赖全部保存在项目目录内", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  for (const [name, version] of Object.entries(pkg.dependencies)) {
    if (!version.startsWith("file:")) continue;
    const directory = realpathSync(resolve(root, version.slice(5)));
    assert.ok(directory.startsWith(root), name + " escapes the project directory");
    assert.equal(JSON.parse(readFileSync(resolve(directory, "package.json"), "utf8")).name, name);
  }
});

test("构建入口不再引用项目外的共享目录", () => {
  for (const name of ["scripts/build.js", "scripts/build_admin_ui.js", "scripts/build_discover.js", "scripts/timeless_plugin.js", "scripts/sync_hot_scripts.js"]) {
    const source = readFileSync(resolve(root, name), "utf8");
    assert.doesNotMatch(source, /xiaoxunrss-worker|\.\.\/packages/, name);
  }
});


test("统一构建取数后 SSR，保留旧品牌 URL、安全策略和取数失败前的产物", async () => {
  const requests = [];
  let status = 200, invalid = false;
  const server = createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(invalid ? {} : { sources: [{ id: "build-source", title: "构建时接口订阅源",
      feed_url: "{{hostname}}/rss/build-source", tags: ["科技"], avatar_url: `http://127.0.0.1:${server.address().port}/api/avatar/build-source?v=1`,
      snapshot: { saved_at: 100, articles: [{ title: "构建时文章", link: "https://example.com/article" }] },
    }], tags: ["科技"] }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const options = { cwd: root, env: { ...process.env, DISCOVERY_API_ORIGIN: origin, FINDRSS_HOSTNAME: "feeds.example", FINDRSS_ADMIN_ESM: "0" } };
  let stop_watching;
  try {
    await exec_file(process.execPath, ["scripts/build.js"], {
      ...options, env: { ...options.env, FINDRSS_ADMIN_ESM: "1" },
    });
    const dev_assets = resolve(root, "dist/assets.dev");
    const dev_paths = ["admin/index.html", "admin/app.dev.js", "admin/login.dev.js",
      "admin/app.js", "admin/components/ui.js", "admin/vendor/prosemirror-model.js", "_headers"];
    const dev_contents = dev_paths.map(path => readFileSync(resolve(dev_assets, path)));
    assert.match(dev_contents[0].toString(), /src="\/admin\/app\.dev\.js"/);
    stop_watching = watch_admin_dev();
    requests.length = 0;
    const result = await exec_file(process.execPath, ["scripts/build.js"], options);
    assert.match(result.stdout, /Discover SSR: GET http:\/\/127\.0\.0\.1:\d+\/discovery\/catalog/);
    assert.match(result.stdout, /已生成首页（1 个订阅源/);
    assert.deepEqual(requests, ["/discovery/catalog"]);
    for (const [index, path] of dev_paths.entries()) {
      assert.deepEqual(readFileSync(resolve(dev_assets, path)), dev_contents[index], path);
    }
    const assets = resolve(root, "dist/assets");
    for (const path of ["index.html", "index.html.gz", "index.js", "app.js", "admin/index.html", "admin/login.html", "admin/app.js", "admin/login.js", "admin/ui.js",
      "assets/timeless/0.34.2/timeless.umd.min.js", "assets/timeless/0.34.2/timeless.dom.umd.min.js",
      "assets/timeless/0.34.2/timeless.lite.esm.js", "assets/timeless/0.34.2/timeless.ssr.esm.js", "assets/timeless/compat.js", "brand/logo.svg", "base.css"]) {
      assert.ok(existsSync(resolve(assets, path)), path);
    }
    assert.deepEqual(readdirSync(resolve(root, "public/assets/timeless")).filter(name => name !== ".DS_Store").sort(), ["0.34.2", "compat.js"]);
    assert.deepEqual(readdirSync(resolve(assets, "assets/timeless")).filter(name => name !== ".DS_Store").sort(), ["0.34.2", "compat.js"]);
    assert.equal(existsSync(resolve(root, "vendor/public")), false);
    const provider_logos = readdirSync(resolve(root, "public/provider-logos"));
    assert.deepEqual(readdirSync(resolve(assets, "provider-logos")), provider_logos);
    for (const name of provider_logos) {
      assert.deepEqual(readFileSync(resolve(assets, "provider-logos", name)), readFileSync(resolve(root, "public/provider-logos", name)), name);
    }
    assert.equal(existsSync(resolve(assets, "admin/assets/timeless")), false);
    for (const path of ["admin/auth.js", "source.js", "account.html", "account.js", "_worker.js", "admin/_worker.js", "api.js", "api.wasm", "admin.js", "admin/pages", "admin/components", "admin/store.js", "admin/README.md", "admin/__tests__", "pages", "components", "store.js"]) {
      assert.equal(existsSync(resolve(assets, path)), false, path);
    }
    for (const path of ["style.css"]) {
      assert.match(readFileSync(resolve(assets, path), "utf8"), /@import url\("\/base\.css"\)/);
    }
    assert.match(readFileSync(resolve(assets, "index.html"), "utf8"), /src="\.\/index\.js"/);
    const html = readFileSync(resolve(assets, "index.html"), "utf8");
    const compressed = readFileSync(resolve(assets, "index.html.gz"));
    assert.equal(gunzipSync(compressed).toString("utf8"), html);
    assert.ok(compressed.length < Buffer.byteLength(html));
    assert.match(html, /构建时接口订阅源/);
    assert.match(html, /构建时文章/);
    assert.doesNotMatch(html, /data:image\/png;base64|<img[^>]*n="feed-avatar-image"/);
    assert.match(html, /"avatar_url":"\/api\/avatar\/build-source\?v=1"/);
    assert.match(html, /n="feed-avatar-placeholder"/);
    assert.match(html, /src="data:image\/svg\+xml,/);
    assert.doesNotMatch(html, /<img[^>]+src="(?:https?:|\/api\/avatar|\/brand|\/platform-icons)/);
    assert.match(html, /https:\/\/feeds\.example\/rss\/build-source/);
    assert.doesNotMatch(html, /<link[^>]*rel="stylesheet"|@import/);
    const styles = /<style id="discovery-stylesheet">([^]*?)<\/style>/.exec(html)[1];
    assert.match(styles, /box-sizing:border-box/);
    assert.doesNotMatch(styles, /\n|\/\*/);
    assert.doesNotMatch(html, /\r|\n/);
    assert.match(styles, /\.feed-articles-list/);
    assert.equal(readFileSync(resolve(assets, "app.js"), "utf8"), readFileSync(resolve(assets, "index.js"), "utf8"));
    const manifest = path => JSON.parse(readFileSync(resolve(assets, path), "utf8"));
    const public_manifest = manifest("site.webmanifest"), admin_manifest = manifest("admin/site.webmanifest");
    assert.equal(public_manifest.name, JSON.parse(readFileSync(resolve(root, "discover/site.webmanifest"), "utf8")).name);
    assert.equal(admin_manifest.name, "FindRSS 管理后台");
    assert.deepEqual(admin_manifest.icons, public_manifest.icons);
    for (const path of ["code_editor.js", "feed_address_editor.js", "feed_address_model.js", "api_docs.js"]) {
      assert.equal(existsSync(resolve(assets, "admin", path)), false, path);
    }
    const icon = readFileSync(resolve(assets, "brand/icon-192.png"));
    for (const path of ["icon-192.png", "admin/icon-192.png"]) assert.deepEqual(readFileSync(resolve(assets, path)), icon);
    const headers = readFileSync(resolve(assets, "_headers"), "utf8");
    assert.match(headers, /X-Frame-Options: DENY/);
    assert.match(headers, /Content-Security-Policy: .*manifest-src 'self'/);
    const hash = createHash("sha256").update(styles).digest("base64");
    assert.ok(headers.includes(`style-src 'self' 'sha256-${hash}'`));
    assert.match(headers, /\/admin\/\*\n  Content-Security-Policy: .*form-action 'self'/);
    assert.match(readFileSync(resolve(assets, "admin/index.html"), "utf8"), /src="\/assets\/timeless\/0\.34\.2\//);
    assert.doesNotMatch(readFileSync(resolve(assets, "admin/index.html"), "utf8"), /app\.dev\.js|type="importmap"/);
    status = 503;
    await assert.rejects(exec_file(process.execPath, ["scripts/build.js"], options), error => {
      assert.match(error.stderr, /目录获取失败：HTTP 503/);
      return true;
    });
    assert.equal(readFileSync(resolve(assets, "index.html"), "utf8"), html);
    status = 200; invalid = true;
    await assert.rejects(exec_file(process.execPath, ["scripts/build.js"], options), error => {
      assert.match(error.stderr, /目录格式错误/);
      return true;
    });
    assert.equal(readFileSync(resolve(assets, "index.html"), "utf8"), html);
  } finally {
    stop_watching?.();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
