import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { create_memory_bucket } from "@findrss/object-store";
import { admin_storage_request } from "../server/service/worker/storage.js";
import { handle_admin_request } from "../admin.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const {
  default: api
} = await import("../api.js");
const request = (path = "", options) => new Request("https://feeds.example/admin/api/storage" + path, options);
test("存储按目录读取子文件和文件夹，目录游标不遗漏文件，用量仍覆盖整个桶", async () => {
  const bucket = create_memory_bucket();
  for (let index = 0; index < 1005; index++) await bucket.put(`files/${String(index).padStart(4, "0")}`, "abc");
  await bucket.put("discovery/avatars/头像.png", "1234");
  const env = {
    API_STORAGE: bucket
  };
  const root = await (await admin_storage_request(request(), env)).json();
  assert.deepEqual(root.delimited_prefixes, ["discovery/", "files/"]);
  assert.deepEqual(root.objects, []);
  const first = await (await admin_storage_request(request("?prefix=files%2F"), env)).json();
  assert.equal(first.objects.length, 100);
  assert.equal(first.truncated, true);
  assert.deepEqual(Object.keys(first.objects[0]), ["key", "size", "uploaded"]);
  const next = await (await admin_storage_request(request("?prefix=files%2F&cursor=" + encodeURIComponent(first.cursor)), env)).json();
  assert.equal(next.objects.length, 100);
  assert.ok(next.objects[0].key > first.objects.at(-1).key);
  const usage = await (await admin_storage_request(request("/usage"), env)).json();
  assert.equal(usage.bytes, 3019);
  assert.equal(usage.objects, 1006);
  assert.equal(usage.truncated, false);
  assert.equal(bucket.calls.get, 0);
});
test("用量达到扫描上限时标记下限，R2 失败和缺少绑定不会显示为零用量", async () => {
  let calls = 0;
  const bucket = {
    get() {},
    put() {},
    delete() {},
    async list() {
      calls++;
      return {
        objects: [{
          key: "a",
          size: 3
        }],
        truncated: true,
        cursor: String(calls)
      };
    }
  };
  const usage = await (await admin_storage_request(request("/usage"), {
    API_STORAGE: bucket
  })).json();
  assert.equal(usage.truncated, true);
  assert.equal(calls, 50);
  assert.equal(usage.bytes, 150);
  assert.equal((await admin_storage_request(request(), {})).status, 503);
  bucket.list = async () => {
    throw new Error("secret upstream error");
  };
  const failed = await admin_storage_request(request(), {
    API_STORAGE: bucket
  });
  assert.equal(failed.status, 502);
  assert.doesNotMatch(await failed.text(), /secret/);
});
test("仅预览和 HEAD 支持中文路径，拒绝下载，HTML/SVG 不以可执行内容返回", async () => {
  const bucket = create_memory_bucket();
  const env = {
    API_STORAGE: bucket
  };
  for (const [key, content_type] of [["头像/图 #1.png", "image/png"], ["files/a.html", "text/html"], ["icons/a.svg", "image/svg+xml"]]) {
    await bucket.put(key, "payload", {
      httpMetadata: {
        contentType: content_type
      }
    });
    const path = "/file?key=" + encodeURIComponent(key);
    const preview = await admin_storage_request(request(path), env);
    assert.equal(await preview.text(), "payload");
    assert.equal(await preview.headers.get("Content-Type"), key.endsWith("png") ? "image/png" : "text/plain; charset=utf-8");
    assert.equal(await preview.headers.get("Cache-Control"), "no-store");
    assert.equal(await preview.headers.get("X-Content-Type-Options"), "nosniff");
    const download = await admin_storage_request(request(path + "&download=1"), env);
    assert.equal(download.status, 400);
    assert.equal(await preview.headers.get("Content-Disposition"), "inline");
    assert.equal(await (await admin_storage_request(request(path, {
      method: "HEAD"
    }), env)).text(), "");
  }
  assert.equal((await admin_storage_request(request("/file?key=missing"), env)).status, 404);
  for (const key of ["", "../secret", "/absolute", "a\\b"]) {
    assert.equal((await admin_storage_request(request("/file?key=" + encodeURIComponent(key)), env)).status, 400);
  }
  assert.equal((await admin_storage_request(request("?cursor=" + "x".repeat(8193)), env)).status, 400);
  for (const prefix of ["files", "../", "/", "files//", "files/../"]) {
    assert.equal((await admin_storage_request(request("?prefix=" + encodeURIComponent(prefix)), env)).status, 400);
  }
  assert.equal((await admin_storage_request(request("", {
    method: "DELETE"
  }), env)).status, 405);
  assert.equal(bucket.calls.delete, 0);
});
test("存储所有入口受管理员鉴权保护，浏览器登录会话可查看文件", async () => {
  const bucket = create_memory_bucket();
  await bucket.put("a", "private");
  const env = {
    API_STORAGE: bucket,
    ADMIN_PASSWORD: "storage-test-password"
  };
  for (const path of ["", "/usage", "/file?key=a"]) {
    assert.equal((await api.fetch(request(path), env)).status, 401);
    assert.equal((await handle_admin_request(request(path), env, async incoming => await api.fetch(incoming, env))).status, 401);
    assert.equal((await api.fetch(request(path, {
      headers: {
        Authorization: "Bearer " + env.ADMIN_PASSWORD
      }
    }), env)).status, 200);
  }
  const login = await handle_admin_request(new Request("https://feeds.example/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({
      password: env.ADMIN_PASSWORD
    })
  }), env);
  const cookie = (await login.headers.get("Set-Cookie")).split(";")[0];
  const file = await handle_admin_request(request("/file?key=a", {
    headers: {
      Cookie: cookie
    }
  }), env, async incoming => await api.fetch(incoming, env));
  assert.equal(file.status, 200);
  assert.equal(await file.text(), "private");
});
