import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build_stage } from "./build_paths.js";

const project_root = fileURLToPath(new URL("../", import.meta.url));
const dependencies = [
  "dayjs", "dayjs/plugin/utc.js", "dayjs/plugin/timezone.js", "dayjs/locale/zh-cn.js",
  "codemirror", "codemirror/mode/javascript/javascript.js", "codemirror/mode/xml/xml.js",
  "codemirror/mode/css/css.js", "codemirror/mode/htmlmixed/htmlmixed.js",
  "codemirror/mode/diff/diff.js", "diff",
  "prosemirror-model", "prosemirror-state", "prosemirror-view", "prosemirror-keymap",
  "prosemirror-commands", "prosemirror-history",
  "js-beautify/js/lib/beautify.js", "js-beautify/js/lib/beautify-html.js", "js-beautify/js/lib/beautify-css.js",
  "fast-xml-parser/src/fxp.js",
];
const dependency_name = name => name.replace(/[^a-z0-9-]/gi, "_");
export const admin_dev_import_map = JSON.stringify({ imports: {
  "@/": "/admin/",
  ...Object.fromEntries(dependencies.map(name => [name, `/admin/vendor/${dependency_name(name)}.js`])),
} });
export const admin_dev_import_map_hash = createHash("sha256").update(admin_dev_import_map).digest("base64");
const shared_modules = ["server/lib/datetime.js", "server/lib/poll_schedule.js", "server/lib/snapshot_schedule.js", "server/domain/clip.js", "server/domain/rss_route.js", "server/lib/admin_agent_context.js", "server/domain/feed_format.js", "server/lib/discovery_platform.js", "server/lib/constants.js", "server/lib/script_config.js", "packages/feed-fetch/src/feed_parser.js"];
const aliases = ["devices.html", "discovery-admin.html", "rss-scripts.html"];

function dev_html(source, entry) {
  return source.replace(/  <script src="(?:\.\/|\/admin\/)ui\.js"><\/script>/,
    `  <script type="importmap">${admin_dev_import_map}</script>`)
    .replace(/  <script src="(?:\.\/|\/admin\/)(?:login|oauth|app)\.js"(?: defer)?><\/script>/,
      `  <script type="module" src="/admin/${entry}.dev.js"></script>`);
}

function source_allowed(path) {
  return !path.split(/[\\/]/).some(part => part.startsWith(".") || part === "__tests__")
    && (!extname(path) || [".js", ".css", ".html"].includes(extname(path)));
}

function write_changed(path, contents) {
  const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  if (statSync(path, { throwIfNoEntry: false })?.isFile() && readFileSync(path).equals(bytes)) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

function sync_source(root, assets, path) {
  if (!source_allowed(path)) return;
  const source = join(root, path), target = join(assets, path);
  const stats = statSync(source, { throwIfNoEntry: false });
  if (!stats) { rmSync(target, { recursive: true, force: true }); return; }
  if (!stats.isFile()) return;
  if (["admin/index.html", "admin/login.html", "admin/oauth.html"].includes(path)) {
    const entry = path.endsWith("login.html") ? "login" : path.endsWith("oauth.html") ? "oauth" : "app";
    const html = dev_html(readFileSync(source, "utf8"), entry);
    write_changed(target, html);
    if (path === "admin/index.html") for (const name of aliases) write_changed(join(assets, "admin", name), html);
  } else {
    const contents = readFileSync(source);
    write_changed(target, contents);
    if (path === "admin/components/frui/tokens.css") write_changed(join(assets, "admin/frui.css"), contents);
  }
}

function sync_admin_sources(root, assets, previous = new Set()) {
  const paths = new Set(shared_modules);
  function collect(directory) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.name.startsWith(".") || entry.name === "__tests__") continue;
      if (entry.isDirectory()) collect(path);
      else if (entry.isFile() && source_allowed(path)) paths.add(path);
    }
  }
  collect("admin");
  for (const path of previous) if (!paths.has(path)) rmSync(join(assets, path), { force: true });
  for (const path of paths) sync_source(root, assets, path);
  return paths;
}

export async function prepare_admin_dev({ root = project_root, assets = build_stage } = {}) {
  sync_admin_sources(root, assets);
  // Only npm dependencies are prebundled. Admin source remains native ES modules.
  await build({
    absWorkingDir: root,
    entryPoints: dependencies.map(name => ({ in: name, out: dependency_name(name) })),
    outdir: join(assets, "admin/vendor"), bundle: true, splitting: true, format: "esm",
    charset: "utf8", target: "es2022", nodePaths: [join(root, "node_modules")],
  });
  for (const [name, entry] of [["app", "./app.js"], ["login", "./pages/login.js"], ["oauth", "./pages/oauth.js"]]) {
    writeFileSync(join(assets, `admin/${name}.dev.js`),
      `import "./components/ui.js";\nawait import(${JSON.stringify(entry)});\n`);
  }
  for (const name of ["codemirror.css", "prosemirror.css"]) {
    const contents = name === "codemirror.css"
      ? ["codemirror/lib/codemirror.css", "codemirror/theme/material-darker.css"]
      : ["prosemirror-view/style/prosemirror.css"];
    writeFileSync(join(assets, "admin", name), contents.map(path => readFileSync(join(root, "node_modules", path), "utf8")).join("\n"));
  }
}

export function watch_admin_dev({ root = project_root, assets = join(root, "dist/assets.dev"), on_error = console.error } = {}) {
  const watchers = [];
  let timer, previous;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        previous = sync_admin_sources(root, assets, previous);
      } catch (error) { on_error(error); }
    }, 30);
  };
  const stop = () => { clearTimeout(timer); for (const watcher of watchers) watcher.close(); };
  try {
    const admin_watcher = watch(join(root, "admin"), { recursive: true }, (_event, name) => {
      if (!name) return;
      const path = join("admin", String(name));
      if (source_allowed(path)) schedule();
    });
    watchers.push(admin_watcher);
    for (const path of shared_modules) {
      watchers.push(watch(dirname(join(root, path)), (_event, name) => {
        if (name && join(dirname(path), String(name)) === path) schedule();
      }));
    }
    for (const watcher of watchers) watcher.on("error", on_error);
    // Catch edits made while Discover SSR and dependency preparation were running.
    previous = sync_admin_sources(root, assets);
    return stop;
  } catch (error) { stop(); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepare_admin_dev();
}
