import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { run_dev as run_dev_impl } from "../scripts/dev.js";
import { start_local_worker } from "../scripts/local_worker.js";

const run_dev = options => run_dev_impl({ watch_admin: () => () => {}, ...options });

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "findrss-dev-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const events = [], controller = new AbortController();
  let exit, mark_waiting;
  const exited = new Promise(resolve => { exit = resolve; });
  const waiting = new Promise(resolve => { mark_waiting = resolve; });
  const worker = { address: "127.0.0.1", port: 42123,
    waitUntilExit: () => { mark_waiting(); return exited; },
    async stop() { events.push("stop"); exit(); },
  };
  return { root, events, controller, worker, exit, waiting };
}

test("dev 从空构建目录先等待 API 就绪再构建，SSR 使用实际端口且运行期间保留 Worker", async t => {
  const { root, events, controller, worker, waiting } = fixture(t);
  let ready, built;
  const built_promise = new Promise(resolve => { built = resolve; });
  const pending = run_dev({ root, signal: controller.signal,
    env: { FINDRSS_WORKER_PORT: "0", DISCOVERY_API_ORIGIN: "https://remote.example",
      FINDRSS_HOSTNAME: "feeds.example", FEED_HOSTNAME: "legacy.example" },
    start_worker: async (script, options) => {
      assert.equal(script, join(root, "index.js"));
      assert.equal(options.port, 0);
      assert.equal(options.assets, join(root, "dist/assets.dev"));
      assert.equal(existsSync(options.assets), true);
      assert.equal(options.persistTo, join(root, ".wrangler/state"));
      assert.match(options.vars.ADMIN_DEV_IMPORT_MAP_HASH, /^[A-Za-z0-9+/]{43}=$/);
      assert.equal(options.vars.FINDRSS_HOSTNAME, "feeds.example");
      assert.equal(options.vars.FEED_HOSTNAME, "legacy.example");
      assert.equal(existsSync(options.temp_dir), true);
      events.push("start");
      await new Promise(resolve => { ready = resolve; });
      events.push("ready");
      return worker;
    },
    build: async ({ env, signal }) => {
      events.push("build");
      assert.equal(env.DISCOVERY_API_ORIGIN, "http://127.0.0.1:42123");
      assert.equal(env.FINDRSS_HOSTNAME, "feeds.example");
      assert.equal(env.TMPDIR, join(root, ".wrangler/tmp/runtime"));
      assert.equal(env.FINDRSS_ADMIN_ESM, "1");
      assert.equal(signal, controller.signal);
      built();
    },
    watch_admin: options => {
      assert.equal(options.assets, join(root, "dist/assets.dev"));
      events.push("watch");
      return () => events.push("unwatch");
    },
  });
  assert.deepEqual(events, ["start"]);
  ready(); await built_promise; await waiting;
  assert.deepEqual(events, ["start", "ready", "build", "watch"]);
  controller.abort(); await pending;
  assert.deepEqual(events, ["start", "ready", "build", "watch", "unwatch", "stop"]);
});

test("Wrangler 使用项目临时目录，内部启动错误、构建错误和超时会返回并关闭环境", async t => {
  const saved = Object.fromEntries(["TMPDIR", "TMP", "TEMP"].map(name => [name, process.env[name]]));
  t.after(() => { for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  } });
  for (const phase of ["error", "buildFailed", "timeout", "abort", "ready", "runtime"]) {
    let environment, stopped = 0;
    const controller = new AbortController();
    class FakeEnvironment extends EventEmitter {
      constructor() { super(); environment = this; }
      async startWorker(options) {
        assert.equal(options.dev.server.port, 8787);
        assert.equal(options.assets, "/project/dist/assets.dev");
        assert.equal(options.dev.watch, true);
        if (["error", "buildFailed"].includes(phase)) queueMicrotask(() => this.emit(phase, {
          cause: new Error("EACCES: permission denied, mkdir /root-temp/email-store"),
        }));
        if (phase === "abort") queueMicrotask(() => controller.abort(new Error("用户停止")));
        return { ready: ["ready", "runtime"].includes(phase) ? Promise.resolve() : new Promise(() => {}),
          url: Promise.resolve(new URL("http://127.0.0.1:8787")) };
      }
      async teardown() { stopped++; this.emit("teardown"); }
    }
    const pending = start_local_worker("index.js", { config: "wrangler.jsonc", port: 8787, assets: "/project/dist/assets.dev",
      temp_dir: "/project/.wrangler/tmp/runtime", signal: controller.signal }, {
      startup_ms: 15, load_wrangler: async () => {
        assert.equal(process.env.TMPDIR, "/project/.wrangler/tmp/runtime");
        return { unstable_DevEnv: FakeEnvironment };
      },
    });
    if (["ready", "runtime"].includes(phase)) {
      const worker = await pending;
      assert.equal(worker.port, 8787);
      const waiting = worker.waitUntilExit();
      if (phase === "runtime") {
        environment.emit("error", { cause: new Error("运行时失败") });
        await assert.rejects(waiting, /运行时失败/);
      }
      await worker.stop(); await worker.stop();
      if (phase === "ready") await waiting;
    } else {
      await assert.rejects(pending, phase === "timeout" ? /启动超时/ : phase === "abort" ? /用户停止/ : /EACCES/);
    }
    assert.equal(stopped, 1);
    assert.equal(environment.listenerCount("error"), 0);
  }
});

test("dev 构建失败关闭 Worker，启动失败不构建，非法端口不启动", async t => {
  const { root, events, worker } = fixture(t);
  await assert.rejects(run_dev({ root, env: {}, start_worker: async () => worker,
    build: async () => { throw new Error("SSR 获取目录失败"); },
  }), /SSR 获取目录失败/);
  assert.deepEqual(events, ["stop"]);
  await assert.rejects(run_dev({ root, env: {}, start_worker: async () => { throw new Error("API 启动失败"); },
    build: () => assert.fail("不应构建"),
  }), /API 启动失败/);
  for (const port of ["-1", "65536", "abc", "1.5"]) {
    await assert.rejects(run_dev({ root, env: { FINDRSS_WORKER_PORT: port },
      start_worker: () => assert.fail("非法端口不应启动"),
    }), /端口号/);
  }
});

test("dev 启动中取消后不构建，Worker 正常退出时也执行清理", async t => {
  const { root, events, controller, worker, exit } = fixture(t);
  await assert.rejects(run_dev({ root, env: { API_WORKER_PORT: "9123" }, signal: controller.signal,
    start_worker: async (_script, options) => {
      assert.equal(options.port, 9123);
      controller.abort(); return worker;
    },
    build: () => assert.fail("取消后不应构建"),
  }), { name: "AbortError" });
  assert.deepEqual(events, ["stop"]);
  events.length = 0;
  exit();
  await run_dev({ root, env: {}, start_worker: async (_script, options) => {
    assert.equal(options.port, 8787); return worker;
  }, build: async () => events.push("build") });
  assert.deepEqual(events, ["build", "stop"]);
});
