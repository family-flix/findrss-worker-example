import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { merge_deployment_config, parse_jsonc, sync_upstream } from "../scripts/sync_upstream.mjs";

function repository(t, prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "master");
  git("config", "user.name", "FindRSS test");
  git("config", "user.email", "findrss@example.test");
  const write = (path, content) => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  const commit = () => { git("add", "."); git("commit", "-m", "fixture"); return git("rev-parse", "HEAD"); };
  return { root, git, write, commit };
}

const upstream_config = {
  name: "findrss-worker", main: "index.js", compatibility_date: "2026-05-03",
  assets: { directory: "./dist/assets", run_worker_first: ["/", "/admin/*", "/new/*"] },
  vars: { NEW_DEFAULT: "enabled", FINDRSS_HOSTNAME: "" },
  r2_buckets: [{ binding: "API_STORAGE", bucket_name: "findrss-storage" }, { binding: "NEW_STORAGE", bucket_name: "new-storage" }],
  durable_objects: { bindings: [{ name: "API", class_name: "APIDurableObject" }] },
  exports: { APIDurableObject: { type: "durable-object", storage: "sqlite" } },
};

test("JSONC 支持注释、尾逗号和 BOM，不破坏字符串中的 URL、转义和注释符号", () => {
  assert.deepEqual(parse_jsonc('\uFEFF{ // comment\n "url": "https://example.test/a/*b*/", /* multi\nline */ "text": "quote: \\\" // ,}", "items": [1, 2,], }'), {
    url: "https://example.test/a/*b*/", text: 'quote: " // ,}', items: [1, 2],
  });
  for (const source of ['{"a": 1 /* unfinished', '{"a": 1,,}', '{"a": "bad\nstring"}', "[]", "null"]) {
    assert.throws(() => parse_jsonc(source));
  }
});

test("保留实例身份、R2 桶、自定义域名和变量，同时更新应用配置并添加新绑定", () => {
  const local = {
    name: "my-findrss", account_id: "my-account", workers_dev: false, preview_urls: false,
    routes: [{ pattern: "rss.example.test", custom_domain: true }],
    vars: { FINDRSS_HOSTNAME: "https://rss.example.test", CUSTOM: "value" },
    assets: { directory: "old", run_worker_first: ["/old/*"] },
    r2_buckets: [{ binding: "API_STORAGE", bucket_name: "my-bucket", jurisdiction: "eu" }],
    durable_objects: { bindings: [{ name: "API", class_name: "OldClass", script_name: "my-shared-worker", environment: "production" }] },
    migrations: [{ tag: "v1", new_sqlite_classes: ["OldClass"] }],
  };
  const merged = merge_deployment_config(upstream_config, local);
  assert.equal(merged.name, local.name);
  assert.equal(merged.account_id, local.account_id);
  assert.equal(merged.workers_dev, false);
  assert.equal(merged.preview_urls, false);
  assert.deepEqual(merged.routes, local.routes);
  assert.deepEqual(merged.vars, { NEW_DEFAULT: "enabled", ...local.vars });
  assert.deepEqual(merged.assets, upstream_config.assets);
  assert.deepEqual(merged.exports, upstream_config.exports);
  assert.equal(merged.migrations, undefined);
  assert.deepEqual(merged.r2_buckets, [local.r2_buckets[0], upstream_config.r2_buckets[1]]);
  assert.deepEqual(merged.durable_objects.bindings[0], { ...upstream_config.durable_objects.bindings[0], script_name: "my-shared-worker", environment: "production" });
  assert.equal(upstream_config.name, "findrss-worker");
});

test("保留自定义环境的存储绑定，已有环境仍接收新版配置，单路由与多路由不会冲突", () => {
  const local_env = { vars: { FINDRSS_HOSTNAME: "https://staging.example.test" },
    r2_buckets: [{ binding: "API_STORAGE", bucket_name: "staging-bucket" }] };
  const local = { route: "rss.example.test/*", env: { staging: local_env } };
  const upstream = { ...upstream_config, routes: ["default.example.test/*"] };
  const custom = merge_deployment_config(upstream, local);
  assert.deepEqual(custom.env.staging, local_env);
  assert.equal(custom.route, local.route);
  assert.equal(Object.hasOwn(custom, "routes"), false);
  const explicit = merge_deployment_config({ ...upstream, env: { staging: {
    ...local_env, assets: { directory: "new-assets" }, r2_buckets: upstream_config.r2_buckets,
  } } }, local);
  assert.deepEqual(explicit.env.staging.assets, { directory: "new-assets" });
  assert.equal(explicit.env.staging.r2_buckets[0].bucket_name, "staging-bucket");
  assert.equal(explicit.env.staging.r2_buckets[1].binding, "NEW_STORAGE");
  assert.equal(Object.hasOwn(merge_deployment_config({ route: "old" }, { routes: [] }), "route"), false);
});

test("独立仓库无需合并历史：更新和删除应用文件、保留工作流，重复更新没有变化", t => {
  const source = repository(t, "findrss-upstream-");
  source.write("wrangler.jsonc", "// upstream configuration\n" + JSON.stringify(upstream_config, null, 2));
  source.write("index.js", "export default 'new';\n");
  source.write("new.js", "export const added = true;\n");
  source.write(".github/workflows/update-findrss.yml", "upstream workflow\n");
  source.write(".github/workflows/new.yml", "new upstream workflow\n");
  const upstream_sha = source.commit();
  const target = repository(t, "findrss-generated-");
  target.write("wrangler.jsonc", JSON.stringify({ ...upstream_config, name: "existing-worker", r2_buckets: [{ binding: "API_STORAGE", bucket_name: "existing-bucket" }] }));
  target.write("index.js", "export default 'old';\n");
  target.write("removed.js", "obsolete\n");
  target.write(".github/workflows/update-findrss.yml", "installed workflow\n");
  target.write(".github/workflows/custom.yml", "custom workflow\n");
  const old_head = target.commit();
  target.git("fetch", source.root, "master");
  // Exercise the actual bootstrap path: a script outside a repository with no
  // updater or node_modules, loaded from the upstream snapshot by the workflow.
  const updater_path = join(source.root, "bootstrapped-updater.mjs");
  const output_path = join(source.root, "github-output");
  writeFileSync(updater_path, readFileSync(new URL("../scripts/sync_upstream.mjs", import.meta.url)));
  execFileSync(process.execPath, [updater_path, "FETCH_HEAD"], { cwd: target.root,
    env: { ...process.env, GITHUB_OUTPUT: output_path } });
  assert.equal(readFileSync(output_path, "utf8"), `changed=true\nupstream_sha=${upstream_sha}\n`);
  assert.equal(target.git("rev-parse", "HEAD"), old_head);
  assert.equal(readFileSync(join(target.root, "index.js"), "utf8"), "export default 'new';\n");
  assert.equal(existsSync(join(target.root, "new.js")), true);
  assert.equal(existsSync(join(target.root, "removed.js")), false);
  assert.equal(readFileSync(join(target.root, ".github/workflows/update-findrss.yml"), "utf8"), "installed workflow\n");
  assert.equal(readFileSync(join(target.root, ".github/workflows/custom.yml"), "utf8"), "custom workflow\n");
  assert.equal(existsSync(join(target.root, ".github/workflows/new.yml")), false);
  const merged = parse_jsonc(readFileSync(join(target.root, "wrangler.jsonc"), "utf8"));
  assert.equal(merged.name, "existing-worker");
  assert.equal(merged.r2_buckets[0].bucket_name, "existing-bucket");
  assert.equal(merged.r2_buckets[1].binding, "NEW_STORAGE");
  assert.equal(target.git("diff", "--name-only"), "");
  target.commit();
  assert.deepEqual(sync_upstream({ root: target.root, upstream_ref: upstream_sha }), { changed: false, upstream_sha });
});

test("没有实例差异时保留上游 JSONC 注释，避免无意义的更新提交", t => {
  const target = repository(t, "findrss-current-");
  const config = "// keep comments\n" + JSON.stringify(upstream_config, null, 2) + "\n";
  target.write("wrangler.jsonc", config);
  const sha = target.commit();
  assert.equal(sync_upstream({ root: target.root, upstream_ref: sha }).changed, false);
  assert.equal(readFileSync(join(target.root, "wrangler.jsonc"), "utf8"), config);
});

test("脏工作区、损坏的配置或缺少 Worker 名称时，在替换文件前停止", t => {
  const target = repository(t, "findrss-invalid-");
  target.write("wrangler.jsonc", JSON.stringify(upstream_config));
  target.write("index.js", "original\n");
  const sha = target.commit();
  target.write("index.js", "uncommitted\n");
  assert.throws(() => sync_upstream({ root: target.root, upstream_ref: sha }), /工作目录不干净/);
  assert.equal(readFileSync(join(target.root, "index.js"), "utf8"), "uncommitted\n");
  target.git("restore", "index.js");
  for (const config of ["{broken", "{}", '{"name":""}']) {
    target.write("wrangler.jsonc", config);
    target.commit();
    assert.throws(() => sync_upstream({ root: target.root, upstream_ref: sha }));
    assert.equal(readFileSync(join(target.root, "index.js"), "utf8"), "original\n");
    assert.equal(target.git("status", "--porcelain"), "");
  }
});
