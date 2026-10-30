import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build_frontend, start_local_worker } from "./local_worker.js";
const project_root = fileURLToPath(new URL("../", import.meta.url));
export async function run_build({
  root = project_root,
  env = process.env,
  signal,
  start_worker = start_local_worker,
  build = build_frontend
} = {}) {
  signal?.throwIfAborted();
  // 开发命令已启动 API；显式指定线上目录时也直接使用该接口。
  if (env.DISCOVERY_API_ORIGIN) {
    await build({
      root,
      env,
      signal
    });
    return;
  }
  const assets = join(root, env.FINDRSS_ADMIN_ESM === "1" ? "dist/assets.dev" : "dist/assets");
  mkdirSync(assets, {
    recursive: true
  });
  const temp_dir = join(root, ".wrangler/tmp/runtime");
  mkdirSync(temp_dir, {
    recursive: true
  });
  console.log("FindRSS build: 先启动本地 API Worker，等待就绪…");
  const worker = await start_worker(join(root, "index.js"), {
    config: join(root, "wrangler.jsonc"),
    assets,
    local: true,
    port: 0,
    watch: false,
    initialize_database: true,
    persistTo: join(root, ".wrangler/state"),
    vars: {
      ...(env.FINDRSS_HOSTNAME ? {
        FINDRSS_HOSTNAME: env.FINDRSS_HOSTNAME
      } : {}),
      ...(env.FEED_HOSTNAME ? {
        FEED_HOSTNAME: env.FEED_HOSTNAME
      } : {}),
      ...(env.ADMIN_PASSWORD ? {
        ADMIN_PASSWORD: env.ADMIN_PASSWORD
      } : {})
    },
    temp_dir,
    signal
  });
  const controller = new AbortController();
  try {
    signal?.throwIfAborted();
    const origin = `http://${worker.address}:${worker.port}`;
    console.log(`FindRSS build: API 已就绪 ${origin}，开始构建前端和 Discover SSR…`);
    await Promise.race([build({
      root,
      env: {
        ...env,
        TMPDIR: temp_dir,
        TMP: temp_dir,
        TEMP: temp_dir,
        DISCOVERY_API_ORIGIN: origin,
        // 临时 API 使用随机端口；静态订阅链接继续沿用配置域名或默认本地地址。
        FINDRSS_HOSTNAME: env.FINDRSS_HOSTNAME || `http://127.0.0.1:${env.FINDRSS_WORKER_PORT || env.API_WORKER_PORT || 8787}`
      },
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    }), worker.waitUntilExit().then(() => {
      throw new Error("构建期间 API Worker 已退出");
    })]);
  } finally {
    controller.abort();
    await worker.stop();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await run_build({
      signal: controller.signal
    });
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
