import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run_build } from "../scripts/build.js";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "findrss-build-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const events = [];
  let exit, fail;
  const exited = new Promise((resolve, reject) => { exit = resolve; fail = reject; });
  const worker = { address: "127.0.0.1", port: 42123,
    waitUntilExit: () => exited,
    async stop() { events.push("stop"); exit(); },
  };
  return { root, events, worker, exit, fail };
}

test("build 先等待 API 就绪再构建，读取实际端口，完成后关闭 Worker", async t => {
  const { root, events, worker } = fixture(t);
  let ready;
  const pending = run_build({ root, env: { ADMIN_PASSWORD: "test-password" },
    start_worker: async (script, options) => {
      assert.equal(script, join(root, "index.js"));
      assert.equal(options.assets, join(root, "dist/assets"));
      assert.ok(existsSync(options.assets));
      assert.ok(existsSync(options.temp_dir));
      assert.equal(options.persistTo, join(root, ".wrangler/state"));
      assert.equal(options.port, 0);
      assert.equal(options.watch, false);
      assert.equal(options.vars.ADMIN_PASSWORD, "test-password");
      events.push("start");
      await new Promise(resolve => { ready = resolve; });
      events.push("ready");
      return worker;
    },
    build: async ({ env }) => {
      events.push("build");
      assert.equal(env.DISCOVERY_API_ORIGIN, "http://127.0.0.1:42123");
      assert.equal(env.FINDRSS_HOSTNAME, "http://127.0.0.1:8787");
      assert.equal(env.TMPDIR, join(root, ".wrangler/tmp/runtime"));
    },
  });
  assert.deepEqual(events, ["start"]);
  ready(); await pending;
  assert.deepEqual(events, ["start", "ready", "build", "stop"]);
});

test("build 显式指定目录接口时使用现有 API，不启动或关闭 Worker", async () => {
  const controller = new AbortController();
  const env = { DISCOVERY_API_ORIGIN: "https://feeds.example", FINDRSS_HOSTNAME: "rss.example" };
  let built = false;
  await run_build({ env, signal: controller.signal,
    start_worker: () => assert.fail("不应启动本地 Worker"),
    build: async options => {
      assert.equal(options.env, env);
      assert.equal(options.signal, controller.signal);
      built = true;
    },
  });
  assert.equal(built, true);
});

test("build 保留订阅域名配置，不注入默认管理密码", async t => {
  const { root, worker } = fixture(t);
  await run_build({ root, env: { FINDRSS_HOSTNAME: "feeds.example", FEED_HOSTNAME: "legacy.example" },
    start_worker: async (_script, options) => {
      assert.deepEqual(options.vars, { FINDRSS_HOSTNAME: "feeds.example", FEED_HOSTNAME: "legacy.example" });
      return worker;
    },
    build: async ({ env }) => {
      assert.equal(env.FINDRSS_HOSTNAME, "feeds.example");
      assert.equal(env.FEED_HOSTNAME, "legacy.example");
    },
  });
});

test("build 启动失败不构建，构建失败和取消都会关闭 Worker", async t => {
  const { root, events, worker } = fixture(t);
  await assert.rejects(run_build({ root, env: {},
    start_worker: async () => { throw new Error("API 启动失败"); },
    build: () => assert.fail("不应构建"),
  }), /API 启动失败/);
  await assert.rejects(run_build({ root, env: {}, start_worker: async () => worker,
    build: async () => { throw new Error("SSR 获取目录失败"); },
  }), /SSR 获取目录失败/);
  assert.deepEqual(events, ["stop"]);
  const controller = new AbortController();
  await assert.rejects(run_build({ root, env: {}, signal: controller.signal,
    start_worker: async () => { controller.abort(); return worker; },
    build: () => assert.fail("取消后不应构建"),
  }), { name: "AbortError" });
  assert.deepEqual(events, ["stop", "stop"]);
});

test("build 期间 API 异常或退出会中断构建并清理 Worker", async t => {
  for (const phase of ["failure", "exit"]) {
    const { root, events, worker, exit, fail } = fixture(t);
    let build_signal;
    await assert.rejects(run_build({ root, env: {}, start_worker: async () => worker,
      build: ({ signal }) => {
        build_signal = signal;
        if (phase === "failure") fail(new Error("API 运行失败")); else exit();
        return new Promise(() => {});
      },
    }), phase === "failure" ? /API 运行失败/ : /API Worker 已退出/);
    assert.equal(build_signal.aborted, true);
    assert.deepEqual(events, ["stop"]);
  }
});
