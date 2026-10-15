import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

async function fetch_catalog(origin, timeout_ms = 30000) {
  const url = new URL("/discovery/catalog", origin);
  console.log(`Discover SSR: GET ${url}`);
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeout_ms) });
  if (!response.ok) throw new Error(`Discover 目录获取失败：HTTP ${response.status}`);
  const catalog = await response.json();
  if (!catalog || !Array.isArray(catalog.sources) || catalog.sources.some(source => !source || typeof source !== "object" || Array.isArray(source))) {
    throw new Error("Discover 目录格式错误：sources 必须为订阅源对象数组");
  }
  return catalog;
}

export async function load_build_catalog(assets) {
  const configured = process.env.DISCOVERY_API_ORIGIN;
  const origin = new URL(configured || `http://127.0.0.1:${process.env.FINDRSS_WORKER_PORT || process.env.API_WORKER_PORT || 8787}`).origin;
  if (!/^https?:$/.test(new URL(origin).protocol)) throw new Error("DISCOVERY_API_ORIGIN 必须是 HTTP(S) 地址");
  try {
    return { catalog: await fetch_catalog(origin, configured ? 30000 : 2000), origin };
  } catch (error) {
    if (configured || error.cause?.code !== "ECONNREFUSED") throw error;
  }

  console.log("Discover SSR: 本地 API 未启动，临时启动 Worker 读取本地数据");
  const { unstable_dev } = await import("wrangler");
  const worker = await unstable_dev(join(root, "index.js"), {
    config: join(root, "wrangler.jsonc"), assets, local: true, port: 0, inspectorPort: 0,
    persistTo: join(root, ".wrangler/state"), logLevel: "error",
    vars: { ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "local-admin-token" },
    experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false, liveReload: false },
  });
  try {
    return { catalog: await fetch_catalog(`http://${worker.address}:${worker.port}`), origin };
  } finally {
    await worker.stop();
  }
}
