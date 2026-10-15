// Exercise native module scope and initialization without invoking a browser.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { admin_dev_import_map } from "../../scripts/admin_dev.js";

const assets = process.argv[2];
const imports = JSON.parse(admin_dev_import_map).imports;
const context = vm.createContext({ console, URL, URLSearchParams,
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {} });
context.window = context;
const root = new URL("../../", import.meta.url);
vm.runInContext(readFileSync(new URL("public/assets/timeless/0.34.2/timeless.umd.min.js", root), "utf8"), context);
context.Timeless.DOM = {};
const cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path);
  // CodeMirror requires mounted DOM; its UI interactions have separate tests.
  const module = path.includes("/vendor/codemirror")
    ? new vm.SyntheticModule(["default"], function() { this.setExport("default", {}); }, { context, identifier: path })
    : new vm.SourceTextModule(readFileSync(path, "utf8"), { context, identifier: path });
  cache.set(path, module);
  return module;
}
function link(specifier, importer) {
  const mapped = imports[specifier] || (specifier.startsWith("@/") ? "/admin/" + specifier.slice(2) : specifier);
  return load(mapped.startsWith("/") ? join(assets, mapped) : resolve(dirname(importer.identifier), mapped));
}
const ui = load(join(assets, "admin/components/ui.js"));
await ui.link(link);
await ui.evaluate();
assert.ok(context.FindRSSAdminUI.Button);
assert.ok(context.vm.ButtonCore);
context.document = { readyState: "loading", addEventListener() {} };
for (const path of ["admin/pages/login.js", "admin/app.js"]) {
  const module = load(join(assets, path));
  await module.link(link);
  await module.evaluate();
}
