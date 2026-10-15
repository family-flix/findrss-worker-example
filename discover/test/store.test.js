import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";
import { BROWSER_PLATFORM } from "../../scripts/timeless_plugin.js";

const source = buildSync({
  stdin: { contents: 'export { match_discovery_route } from "./index.js";',
    resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "js" },
  bundle: true, write: false, format: "iife", globalName: "DiscoveryStore",
  loader: { ".svg": "text" },
  alias: { timeless: BROWSER_PLATFORM },
}).outputFiles[0].text;
test("前台路由只匹配首页，账号页与详情页路径不再匹配", () => {
  const context = vm.createContext({ Timeless: { DOM: {} } });
  vm.runInContext(source, context);
  const match = context.DiscoveryStore.match_discovery_route;
  for (const path of ["/", "/index.html"]) assert.equal(match(path).page, "Home");
  for (const path of ["/account", "/account.html", "/s/source-1", "/s/:id", "/s/", "/s/source/extra", "/admin/", "/unknown"]) assert.equal(match(path), null);
});
