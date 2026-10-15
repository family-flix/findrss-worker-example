import assert from "node:assert/strict";
import test from "node:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { admin_dev_import_map, admin_dev_import_map_hash, prepare_admin_dev, watch_admin_dev } from "../scripts/admin_dev.js";
import { handle_admin_request } from "../admin.js";

const root = fileURLToPath(new URL("../", import.meta.url));

test("开发后台保留源码，import map 完整解析模块图，共享依赖只加载一份", async t => {
  const assets = mkdtempSync(join(tmpdir(), "findrss-admin-modules-"));
  t.after(() => rmSync(assets, { recursive: true, force: true }));
  await prepare_admin_dev({ root, assets });
  for (const path of ["admin/app.js", "admin/pages/login.js", "admin/components/ui.js", "admin/store.js",
    "server/domain/rss_route.js", "server/lib/admin_agent_context.js", "server/domain/feed_format.js",
    "server/lib/discovery_platform.js", "server/lib/constants.js", "packages/feed-fetch/src/feed_parser.js"]) {
    assert.equal(readFileSync(join(assets, path), "utf8"), readFileSync(join(root, path), "utf8"));
  }
  for (const name of ["index", "login", "devices", "discovery-admin", "rss-scripts"]) {
    const html = readFileSync(join(assets, `admin/${name}.html`), "utf8");
    assert.ok(html.includes(`<script type="importmap">${admin_dev_import_map}</script>`));
    assert.match(html, /<script type="module" src="\/admin\/(app|login)\.dev\.js"><\/script>/);
    assert.doesNotMatch(html, /<script src="\.\/(ui|app|login)\.js"/);
  }
  const imports = JSON.parse(admin_dev_import_map).imports;
  const result = await build({
    absWorkingDir: assets, entryPoints: ["admin/app.dev.js", "admin/login.dev.js"],
    bundle: true, write: false, outdir: join(assets, "check"), format: "esm", metafile: true,
    plugins: [{ name: "browser-import-map", setup(builder) {
      builder.onResolve({ filter: /^[^./]/ }, args => {
        const mapped = imports[args.path] || (args.path.startsWith("@/") ? "/admin/" + args.path.slice(2) : null);
        assert.ok(mapped, `未映射的浏览器依赖：${args.path}`);
        return { path: join(assets, mapped) };
      });
    } }],
  });
  assert.ok(result.metafile.inputs["admin/pages/discovery.js"]);
  assert.ok(result.metafile.inputs["admin/pages/script.js"]);
  const vendor = Object.keys(result.metafile.inputs).filter(path => path.startsWith("admin/vendor/"));
  // All package entry points share esbuild chunks instead of duplicating ProseMirror classes.
  const models = vendor.filter(path => readFileSync(join(assets, path), "utf8").includes("prosemirror-model/dist/index.js"));
  assert.equal(models.length, 1);
  assert.equal(existsSync(join(assets, "admin/__tests__")), false);
  assert.equal(existsSync(join(assets, "server/domain/script_agent.js")), false);
  assert.equal(existsSync(join(assets, "admin/README.md")), false);
  execFileSync(process.execPath, ["--experimental-vm-modules",
    fileURLToPath(new URL("./helpers/admin_module_runtime.mjs", import.meta.url)), assets], { stdio: "pipe" });
});

test("开发文件监听同步保存、新建、重命名与删除，停止后不再同步", async t => {
  const fixture = mkdtempSync(join(tmpdir(), "findrss-admin-watch-"));
  const assets = join(fixture, "assets");
  for (const path of ["admin/index.html", "admin/login.html", "admin/components/frui/tokens.css",
    "admin/pages/login.js", "server/domain/rss_route.js", "server/lib/admin_agent_context.js", "server/domain/feed_format.js",
    "server/lib/discovery_platform.js", "server/lib/constants.js", "packages/feed-fetch/src/feed_parser.js"]) {
    mkdirSync(dirname(join(fixture, path)), { recursive: true });
    cpSync(join(root, path), join(fixture, path));
  }
  const errors = [];
  const stop = watch_admin_dev({ root: fixture, assets, on_error: error => errors.push(error) });
  t.after(() => { stop(); rmSync(fixture, { recursive: true, force: true }); });
  const wait_for = async condition => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (condition()) return;
      await setTimeout(20);
    }
    assert.fail("文件同步超时");
  };
  const saved = path => existsSync(join(assets, path)) ? readFileSync(join(assets, path), "utf8") : undefined;
  writeFileSync(join(fixture, "admin/pages/login.js"), "export const changed = true;\n");
  writeFileSync(join(fixture, "admin/components/frui/tokens.css"), ":root { --color: red; }\n");
  writeFileSync(join(fixture, "server/domain/rss_route.js"), "export const updated = true;\n");
  await wait_for(() => saved("admin/pages/login.js")?.includes("changed")
    && saved("admin/frui.css")?.includes("red") && saved("server/domain/rss_route.js")?.includes("updated"));
  mkdirSync(join(fixture, "admin/pages/new"));
  writeFileSync(join(fixture, "admin/pages/new/page.js"), "export const fresh = true;\n");
  await wait_for(() => saved("admin/pages/new/page.js")?.includes("fresh"));
  renameSync(join(fixture, "admin/pages/new/page.js"), join(fixture, "admin/pages/new/renamed.js"));
  await wait_for(() => !saved("admin/pages/new/page.js") && saved("admin/pages/new/renamed.js"));
  renameSync(join(fixture, "admin/pages/new"), join(fixture, "admin/pages/moved"));
  await wait_for(() => !saved("admin/pages/new/renamed.js") && saved("admin/pages/moved/renamed.js"));
  rmSync(join(fixture, "admin/pages/moved"), { recursive: true });
  await wait_for(() => !saved("admin/pages/moved/renamed.js"));
  stop();
  writeFileSync(join(fixture, "admin/pages/login.js"), "export const stopped = true;\n");
  await setTimeout(100);
  assert.ok(saved("admin/pages/login.js").includes("changed"));
  assert.deepEqual(errors, []);
});

test("开发 import map 的 CSP 仅在开发绑定存在时放行，禁用缓存", async () => {
  const request = new Request("http://127.0.0.1/admin/");
  const env = { ASSETS: { fetch: async () => new Response("admin") } };
  const production = await handle_admin_request(request, env);
  assert.doesNotMatch(production.headers.get("Content-Security-Policy"), /sha256-|unsafe-inline/);
  const development = await handle_admin_request(request, { ...env, ADMIN_DEV_IMPORT_MAP_HASH: admin_dev_import_map_hash });
  assert.ok(development.headers.get("Content-Security-Policy").includes(`'sha256-${admin_dev_import_map_hash}'`));
  assert.equal(development.headers.get("Cache-Control"), "no-store");
});
