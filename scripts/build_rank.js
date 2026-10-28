import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BROWSER_PLATFORM, timeless_plugin } from "./timeless_plugin.js";
import { build_stage } from "./build_paths.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(build_stage, "rank");
mkdirSync(output, { recursive: true });
cpSync(join(root, "rank/style.css"), join(output, "style.css"));
await build({ entryPoints: [join(root, "rank/index.js")], outfile: join(output, "index.js"),
  bundle: true, format: "iife", platform: "browser", target: "es2022",
  plugins: [timeless_plugin({ platform: BROWSER_PLATFORM })], logLevel: "info" });
