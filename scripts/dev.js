import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { admin_dev_import_map_hash, watch_admin_dev } from "./admin_dev.js";

const project_root = fileURLToPath(new URL("../", import.meta.url));

export async function start_local_worker(script, options, { load_wrangler = () => import("wrangler"), startup_ms = 60_000 } = {}) {
  // 必须在导入 Wrangler/Miniflare 前设置，部分依赖会缓存系统临时目录。
  for (const name of ["TMPDIR", "TMP", "TEMP"]) process.env[name] = options.temp_dir;
  const { unstable_DevEnv } = await load_wrangler();
  const environment = new unstable_DevEnv();
  let reject_failure, timer, stopping;
  const failure = new Promise((_resolve, reject) => { reject_failure = reject; });
  const exited = new Promise(resolve_exit => environment.once("teardown", resolve_exit));
  const on_error = event => {
    const cause = event instanceof Error ? event : event?.cause || new Error(event?.reason || "未知错误");
    reject_failure(new Error("API Worker 启动或运行失败：" + cause.message, { cause }));
  };
  const on_abort = () => reject_failure(options.signal.reason);
  environment.on("error", on_error);
  environment.on("buildFailed", on_error);
  options.signal?.addEventListener("abort", on_abort, { once: true });
  const stop = () => stopping ||= environment.teardown().finally(() => {
    clearTimeout(timer);
    environment.removeListener("error", on_error);
    environment.removeListener("buildFailed", on_error);
    options.signal?.removeEventListener("abort", on_abort);
  });
  try {
    options.signal?.throwIfAborted();
    timer = setTimeout(() => reject_failure(new Error(`API Worker 启动超时（${startup_ms / 1000} 秒），请检查端口和上方错误`)), startup_ms);
    const url = await Promise.race([
      (async () => {
        const worker = await environment.startWorker({
          config: options.config, entrypoint: script, assets: options.assets,
          bindings: Object.fromEntries(Object.entries(options.vars || {}).map(([name, value]) => [name, { type: "secret_text", value }])),
          dev: { remote: false, server: { hostname: "127.0.0.1", port: options.port },
            persist: options.persistTo, watch: true, inspector: false, logLevel: "info" },
        });
        await worker.ready;
        return worker.url;
      })(),
      failure,
    ]);
    clearTimeout(timer);
    return { address: url.hostname, port: Number(url.port), stop,
      waitUntilExit: () => Promise.race([exited, failure]) };
  } catch (error) {
    await stop();
    throw error;
  }
}

function build_frontend({ root, env, signal }) {
  return new Promise((resolve_build, reject) => {
    const child = spawn(process.execPath, [join(root, "scripts/build.js")], {
      cwd: root, env, stdio: "inherit", signal,
    });
    child.once("error", reject);
    child.once("exit", (code, exit_signal) => {
      if (code === 0) resolve_build();
      else reject(new Error(`前端构建失败（${exit_signal || code}）`));
    });
  });
}

export async function run_dev({ root = project_root, env = process.env, signal,
  start_worker = start_local_worker, build = build_frontend, watch_admin = watch_admin_dev } = {}) {
  const port_value = env.FINDRSS_WORKER_PORT || env.API_WORKER_PORT || "8787";
  const port = Number(port_value);
  if (!/^\d+$/.test(String(port_value)) || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("FINDRSS_WORKER_PORT / API_WORKER_PORT 必须是 0–65535 的端口号");
  }
  signal?.throwIfAborted();
  // 首次开发时还没有构建产物，但 Worker 的静态资源绑定要求目录存在。
  const assets = join(root, "dist/assets.dev");
  mkdirSync(assets, { recursive: true });
  const temp_dir = join(root, ".wrangler/tmp/runtime");
  mkdirSync(temp_dir, { recursive: true });
  console.log("FindRSS dev: 先启动本地 API Worker，等待就绪…");
  const worker = await start_worker(join(root, "index.js"), {
    config: join(root, "wrangler.jsonc"), assets, local: true, port,
    persistTo: join(root, ".wrangler/state"),
    vars: { ADMIN_DEV_IMPORT_MAP_HASH: admin_dev_import_map_hash,
      ...(env.FINDRSS_HOSTNAME ? { FINDRSS_HOSTNAME: env.FINDRSS_HOSTNAME } : {}),
      ...(env.FEED_HOSTNAME ? { FEED_HOSTNAME: env.FEED_HOSTNAME } : {}),
      ...(env.ADMIN_PASSWORD ? { ADMIN_PASSWORD: env.ADMIN_PASSWORD } : {}) },
    temp_dir, signal,
  });
  let on_abort, stop_watching;
  try {
    signal?.throwIfAborted();
    const origin = `http://${worker.address}:${worker.port}`;
    console.log(`FindRSS dev: API 已就绪 ${origin}，开始构建前端和 Discover SSR…`);
    // 开发 SSR 始终读取刚启动的实例，避免远端配置或临时 Worker 覆盖本地目录。
    await build({ root, env: { ...env, TMPDIR: temp_dir, TMP: temp_dir, TEMP: temp_dir,
      DISCOVERY_API_ORIGIN: origin, FINDRSS_ADMIN_ESM: "1" }, signal });
    signal?.throwIfAborted();
    stop_watching = watch_admin({ root, assets });
    console.log(`FindRSS dev: 构建完成，服务运行于 ${origin}（管理后台 ${origin}/admin/）`);
    console.log("FindRSS dev: admin 使用原生 ES modules，修改 JS / CSS / HTML 后刷新页面即可生效");
    await Promise.race([
      worker.waitUntilExit(),
      new Promise(resolve_abort => {
        on_abort = resolve_abort;
        signal?.addEventListener("abort", on_abort, { once: true });
        if (signal?.aborted) resolve_abort();
      }),
    ]);
  } finally {
    if (on_abort) signal?.removeEventListener("abort", on_abort);
    stop_watching?.();
    await worker.stop();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await run_dev({ signal: controller.signal });
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error(error.message);
      process.exitCode = 1;
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
