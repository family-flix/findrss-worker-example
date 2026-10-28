import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { SITE_CSP, SITE_HEADERS } from "../server/lib/site_security.js";
import { admin_dev_import_map_hash } from "./admin_dev.js";
import { admin_dev, build_assets, build_stage, finalize_assets } from "./build_paths.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const stage = build_stage;
execFileSync(process.execPath, [join(root, "scripts/sync_hot_scripts.js")], { cwd: root, stdio: "inherit" });
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(join(root, "public"), stage, { recursive: true });
execFileSync(process.execPath, [join(root, admin_dev ? "scripts/admin_dev.js" : "scripts/build_admin_ui.js")], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, [join(root, "scripts/build_discover.js")], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, [join(root, "scripts/build_rank.js")], { cwd: root, stdio: "inherit" });
const manifest = JSON.parse(readFileSync(join(stage, "site.webmanifest"), "utf8"));
writeFileSync(join(stage, "admin/site.webmanifest"), JSON.stringify({ ...manifest,
  name: "FindRSS 管理后台", short_name: "FindRSS",
}, null, 2) + "\n");
// Existing R2 snapshots and installed manifests may still reference the old icon URLs.
for (const name of readdirSync(join(stage, "brand"))) {
  cpSync(join(stage, "brand", name), join(stage, name));
  cpSync(join(stage, "brand", name), join(stage, "admin", name));
}
const static_headers = ["/*", ...Object.entries(SITE_HEADERS).map(([name, value]) => `  ${name}: ${value}`)];
const styles = /<style id="discovery-stylesheet">([^]*?)<\/style>/.exec(readFileSync(join(stage, "index.html"), "utf8"))[1];
const style_hash = createHash("sha256").update(styles).digest("base64");
for (const path of ["/", "/index.html", "/account", "/account.html"]) {
  static_headers.push(path, `  Content-Security-Policy: ${SITE_CSP.discovery.replace("style-src 'self'", `style-src 'self' 'sha256-${style_hash}'`)}`);
}
const admin_csp = admin_dev
  ? SITE_CSP.admin.replace("script-src 'self'", `script-src 'self' 'sha256-${admin_dev_import_map_hash}'`)
  : SITE_CSP.admin;
static_headers.push("/admin/*", `  Content-Security-Policy: ${admin_csp}`);
if (admin_dev) {
  static_headers.push("  Cache-Control: no-store", "/server/*", "  Cache-Control: no-store");
}
writeFileSync(join(stage, "_headers"), static_headers.join("\n") + "\n");
finalize_assets(stage, build_assets, admin_dev);
console.log("FindRSS frontend assets built; Wrangler bundles index.js and QuickJS WASM");
