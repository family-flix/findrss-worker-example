import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { start_local_worker } from "./local_worker.js";

// 显式运行：node --test scripts/script_storage_smoke.test.mjs。仅使用隔离的本地存储和 HTTP。
test("真实本地 Worker 保存 10MB 脚本到 R2，发布新版后可回退并保留草稿", {
  timeout: 120000
}, async t => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const temp = await mkdtemp(join(tmpdir(), "findrss-script-storage-"));
  let worker;
  t.after(async () => {
    await worker?.stop();
    await rm(temp, {
      recursive: true,
      force: true
    });
  });
  worker = await start_local_worker(join(root, "index.js"), {
    config: join(root, "wrangler.jsonc"),
    assets: join(root, "dist/assets"),
    persistTo: join(temp, "state"),
    temp_dir: temp,
    local: true,
    port: 0,
    watch: false,
    initialize_database: true,
    vars: {
      ADMIN_PASSWORD: "isolated-smoke-test"
    }
  });
  const origin = `http://${worker.address}:${worker.port}`;
  const storage_keys = async script_id => {
    const response = await fetch(origin + "/admin/api/storage?" + new URLSearchParams({
      prefix: `scripts/${script_id}/`
    }), {
      headers: {
        Authorization: "Bearer isolated-smoke-test"
      }
    });
    assert.equal(response.status, 200);
    return (await response.json()).objects.map(value => value.key);
  };
  const request = async (path, body, method = "GET") => {
    const response = await fetch(origin + "/admin/api/scripts" + path, {
      method,
      headers: {
        Authorization: "Bearer isolated-smoke-test",
        "Content-Type": "application/json"
      },
      ...(body ? {
        body: JSON.stringify(body)
      } : {})
    });
    const value = await response.json();
    assert.ok(response.ok, JSON.stringify({
      status: response.status,
      value
    }));
    return value;
  };
  const base = 'export const route = { path: "/storage-smoke", name: "Storage Smoke", handler() { return { title: "Smoke", items: [] }; } };';
  const script = base + "/*" + "x".repeat(10 * 1024 * 1024 - base.length - 4) + "*/";
  const first = (await request("", {
    script,
    status: "published",
    version: "1.0.0"
  }, "POST")).script;
  assert.equal(first.script.length, script.length);
  assert.ok(first.current_release_id);
  assert.deepEqual(await storage_keys(first.id), [`scripts/${first.id}/1.0.0.js`]);
  const listed = await request("?limit=10");
  const summary = listed.scripts.find(value => value.id === first.id);
  assert.equal(summary.source_loaded, false);
  assert.equal(summary.script_bytes, 10 * 1024 * 1024);
  assert.equal(summary.script, "");
  await request("/" + first.id, {
    script: base + "\n// Version 2",
    status: "published",
    version: "2.0.0"
  }, "PATCH");
  await request("/" + first.id, {
    script: "// unfinished draft",
    status: "draft",
    version: "3.0.0"
  }, "PATCH");
  const reverted = (await request("/" + first.id + "/rollback", {
    release_id: first.current_release_id
  }, "POST")).script;
  assert.equal(reverted.version, "1.0.0");
  assert.equal(reverted.max_published_version, "2.0.0");
  assert.equal(reverted.script, script);
  assert.equal(reverted.draft.script, "// unfinished draft");
  const versions = await request("/" + first.id + "/versions");
  assert.equal(versions.versions.length, 2);
  assert.deepEqual(await storage_keys(first.id), [`scripts/${first.id}/1.0.0.js`, `scripts/${first.id}/2.0.0.js`]);
  await request("/" + first.id, null, "DELETE");
  assert.deepEqual(await storage_keys(first.id), []);
});
