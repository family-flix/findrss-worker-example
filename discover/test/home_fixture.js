import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";
import { BROWSER_PLATFORM } from "../../scripts/timeless_plugin.js";

// 同构首页按浏览器平台打包后交给 VM，组件仍可用轻量替身检查。
export const home_source = buildSync({
  stdin: { contents: 'export { DiscoveryViewModel, FeedArticlesView, FeedCopyButtonView } from "./index.js"; export { LazyAvatar, LazyImgModel } from "./lazy_img.js";',
    resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "js" },
  bundle: true, write: false, format: "iife", globalName: "DiscoveryHome",
  loader: { ".svg": "text" },
  alias: { timeless: BROWSER_PLATFORM },
}).outputFiles[0].text +
  "\nconst { DiscoveryViewModel, FeedArticlesView, FeedCopyButtonView, LazyAvatar, LazyImgModel } = DiscoveryHome;";

export function initialize_home(context, vm) {
  context.Timeless = context.window.Timeless;
  context.Timeless.computed ||= (source, map) => ({ __is_ref: true, get value() { return map(source.value); } });
  context.Timeless.combine ||= (sources, map) => ({ __is_ref: true, get value() {
    return map(Object.fromEntries(Object.entries(sources).map(([key, source]) => [key, source.value])));
  } });
  vm.runInContext(home_source + "\nglobalThis.model = DiscoveryViewModel(globalThis.catalog || null, globalThis.parameters || null);", context);
  return context.model;
}
