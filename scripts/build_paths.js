import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
export const admin_dev = process.env.FINDRSS_ADMIN_ESM === "1";
export const build_assets = join(root, admin_dev ? "dist/assets.dev" : "dist/assets");
export const build_stage = build_assets + ".tmp";
