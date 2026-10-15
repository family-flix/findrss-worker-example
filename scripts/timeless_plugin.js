// 广场视图只 import "timeless" 这个名字，实际指到哪份实现由构建时决定。
// 单独成一个文件（而不是塞在 build.js 里）是因为 test.mjs 也要用它渲染同一棵树：
// 构建与测试必须解析到完全相同的实现，否则「测试绿了、构建挂了」这类分叉最难查。
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

/**
 * Worker 侧基座。lite 是自包含的单文件 ESM（158KB，零 import），比核心 UMD 小
 * 3.4 倍，但导出同一套原语（含 `isElement`，SSR 产物内部要用）。
 */
export const LITE_ESM = join(root, "public/assets/timeless/0.34.2/timeless.lite.esm.js");
/**
 * `renderToString`。它内部 import 的 `timeless` 也必须指到上面那份 lite：
 * SSR 与 hydrate 混用两套原语是 hydration 不匹配的典型来源。
 */
export const SSR_ESM = join(root, "public/assets/timeless/0.34.2/timeless.ssr.esm.js");
/** 浏览器侧 shim：re-export `window.Timeless`，核心不进 bundle（DOM 运行时本来就要单独加载）。 */
export const BROWSER_PLATFORM = join(root, "public/assets/timeless/compat.js");

/**
 * @param {{ platform: string, ssr?: boolean }} options
 */
export function timeless_plugin({ platform, ssr = false }) {
  return {
    name: "timeless",
    setup(build) {
      build.onResolve({ filter: /^timeless$/ }, () => ({ path: platform }));
      if (ssr) {
        build.onResolve({ filter: /^timeless-ssr$/ }, () => ({ path: SSR_ESM }));
      }
    },
  };
}
