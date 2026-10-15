import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source_dir = resolve(root, "admin");
const out_dir = resolve(root, "dist/assets.tmp/admin");
mkdirSync(out_dir, { recursive: true });
for (const name of ["index.html", "login.html", "style.css"]) {
  cpSync(resolve(source_dir, name), resolve(out_dir, name));
}
// Preserve existing bookmarked HTML URLs with the same SPA shell.
for (const name of ["devices.html", "discovery-admin.html", "rss-scripts.html"]) {
  cpSync(resolve(source_dir, "index.html"), resolve(out_dir, name));
}
await build({
  entryPoints: { app: resolve(source_dir, "app.js"), login: resolve(source_dir, "pages/login.js"), ui: resolve(source_dir, "components/ui.js") },
  outdir: out_dir, bundle: true, format: "iife", charset: "utf8", target: "es2022",
  nodePaths: [resolve(root, "node_modules")],
  alias: { "@": source_dir },
});
await build({
  entryPoints: [resolve(source_dir, "components/frui/tokens.css")],
  outfile: resolve(out_dir, "frui.css"), bundle: true, charset: "utf8",
});
await build({
  stdin: { contents: '@import "codemirror/lib/codemirror.css"; @import "codemirror/theme/material-darker.css";',
    loader: "css", resolveDir: root },
  outfile: resolve(out_dir, "codemirror.css"), bundle: true, charset: "utf8",
});
await build({
  stdin: { contents: '@import "prosemirror-view/style/prosemirror.css";', loader: "css", resolveDir: root },
  outfile: resolve(out_dir, "prosemirror.css"), bundle: true, charset: "utf8",
});
