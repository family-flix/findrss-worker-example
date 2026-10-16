import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cpSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";

const root = fileURLToPath(new URL("../", import.meta.url));
export const admin_dev = process.env.FINDRSS_ADMIN_ESM === "1";
export const build_assets = join(root, admin_dev ? "dist/assets.dev" : "dist/assets");
export const build_stage = build_assets + ".tmp";

export function finalize_assets(stage, assets, development) {
  if (development) {
    // Wrangler 正在监听此目录；替换根目录会让首次构建后的 ASSETS 清单停留在空目录。
    mkdirSync(assets, { recursive: true });
    for (const name of readdirSync(assets)) rmSync(join(assets, name), { recursive: true, force: true });
    cpSync(stage, assets, { recursive: true });
    rmSync(stage, { recursive: true, force: true });
  } else {
    rmSync(assets, { recursive: true, force: true });
    renameSync(stage, assets);
  }
}
