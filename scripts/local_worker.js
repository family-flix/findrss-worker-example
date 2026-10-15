import { spawn } from "node:child_process";
import { join } from "node:path";

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
            persist: options.persistTo, watch: options.watch ?? true, inspector: false, logLevel: "info" },
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

export function build_frontend({ root, env, signal }) {
  return new Promise((resolve_build, reject) => {
    const child = spawn(process.execPath, [join(root, "scripts/build_frontend.js")], {
      cwd: root, env, stdio: "inherit", signal,
    });
    child.once("error", reject);
    child.once("exit", (code, exit_signal) => {
      if (code === 0) resolve_build();
      else reject(new Error(`前端构建失败（${exit_signal || code}）`));
    });
  });
}

