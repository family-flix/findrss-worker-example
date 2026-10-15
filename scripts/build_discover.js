import * as esbuild from "esbuild";
import { cpSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { BROWSER_PLATFORM, LITE_ESM, timeless_plugin } from "./timeless_plugin.js";
import { load_build_catalog } from "./discovery_catalog.js";
import { gzip_html } from "../server/infra/discovery_compression.js";
import { build_stage } from "./build_paths.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const tmp_dir = build_stage;
for (const name of ["index.html", "style.css", "site.webmanifest"]) {
  cpSync(join(root, "discover", name), join(tmp_dir, name));
}

await esbuild.build({
  entryPoints: [join(root, "discover/index.js")], bundle: true, format: "iife", platform: "browser", target: "es2022",
  loader: { ".svg": "text" },
  outfile: join(tmp_dir, "index.js"), plugins: [timeless_plugin({ platform: BROWSER_PLATFORM })], logLevel: "info",
});

const server = await esbuild.build({
  entryPoints: [join(root, "server/infra/discovery_home.js")], bundle: true, write: false,
  format: "esm", platform: "neutral", mainFields: ["main"], loader: { ".html": "text", ".css": "text", ".svg": "text" },
  plugins: [timeless_plugin({ platform: LITE_ESM, ssr: true })],
});
const { render_embedded_home } = await import("data:text/javascript;base64," + Buffer.from(server.outputFiles[0].text).toString("base64"));
const { catalog, origin } = await load_build_catalog(tmp_dir);
const feed_origin = process.env.FINDRSS_HOSTNAME || origin;
const html = render_embedded_home(catalog,
  /^https?:\/\//.test(feed_origin) ? feed_origin : "https://" + feed_origin);
const compressed = await gzip_html(html);
writeFileSync(join(tmp_dir, "index.html"), html);
writeFileSync(join(tmp_dir, "index.html.gz"), compressed);
const original_bytes = Buffer.byteLength(html);
console.log(`Discover gzip: ${original_bytes} → ${compressed.byteLength} bytes，减少 ${(100 * (1 - compressed.byteLength / original_bytes)).toFixed(1)}%`);
console.log(`Discover SSR: 已生成首页（${catalog.sources.length} 个订阅源，内嵌样式与首屏内容）`);

for (const name of ["index.html", "index.js", "style.css"]) {
  if (!statSync(join(tmp_dir, name), { throwIfNoEntry: false })) throw new Error("构建产物缺少 " + name + "，dist/ 未切换");
}

// shortcut: 旧 R2 首页仍引用 app.js，全部重新发布后可删除此别名。
cpSync(join(tmp_dir, "index.js"), join(tmp_dir, "app.js"));
