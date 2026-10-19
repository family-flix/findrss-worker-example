import puppeteer from "@cloudflare/puppeteer";
import { MAX_SCRIPT_BYTES } from "../lib/constants.js";

export function create_puppeteer_navigate(binding, puppeteer_impl = puppeteer) {
  return async (url, options = {}, evaluate, signal) => {
    let target;
    try { target = new URL(url); } catch { throw new Error("navigate 需要完整的 HTTP(S) URL"); }
    if (!["http:", "https:"].includes(target.protocol) || target.username || target.password || target.href.length > 8192) {
      throw new Error("navigate 只允许无凭据的 HTTP(S) URL");
    }
    if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("navigate 的 options 必须是对象");
    for (const key of Object.keys(options)) {
      if (!["viewport", "selector", "wait_ms", "args"].includes(key)) throw new Error("navigate 不支持选项：" + key);
    }
    const viewport = options.viewport ?? { width: 1440, height: 900 };
    if (!viewport || !Number.isInteger(viewport.width) || viewport.width < 320 || viewport.width > 3840
      || !Number.isInteger(viewport.height) || viewport.height < 320 || viewport.height > 2160) throw new Error("navigate 的 viewport 超出范围");
    const wait_ms = options.wait_ms ?? 1000;
    if (!Number.isInteger(wait_ms) || wait_ms < 0 || wait_ms > 10000) throw new Error("navigate 的 wait_ms 须为 0–10000 的整数");
    if (options.selector !== undefined && (typeof options.selector !== "string" || !options.selector.trim() || options.selector.length > 1000)) {
      throw new Error("navigate 的 selector 须为 1–1000 字符的 CSS 选择器");
    }
    if (options.args !== undefined && !Array.isArray(options.args)) throw new Error("navigate 的 args 必须是数组");
    if (evaluate !== undefined && !["function", "string"].includes(typeof evaluate)) throw new Error("navigate 的 evaluate 必须是函数");
    const evaluation = evaluate === undefined ? "({ html: document.documentElement.outerHTML })"
      : `(${String(evaluate)})(...${JSON.stringify(options.args ?? [])})`;
    if (new TextEncoder().encode(evaluation).length > MAX_SCRIPT_BYTES) throw new Error("navigate 的提取函数及参数过大");
    const combined = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(110000)]);
    combined.throwIfAborted();
    const browser = await puppeteer_impl.launch(binding);
    let on_abort;
    try {
      combined.throwIfAborted();
      return await Promise.race([
        (async () => {
          const page = await browser.newPage();
          await page.setViewport({ width: viewport.width, height: viewport.height });
          await page.goto(target.href, { waitUntil: "networkidle2", timeout: 30000 });
          if (options.selector) await page.waitForSelector(options.selector, { visible: true, timeout: 15000 });
          await page.evaluate(async delay => {
            await new Promise(resolve => setTimeout(resolve, delay));
            await Promise.race([document.fonts?.ready, new Promise(resolve => setTimeout(resolve, 2000))]);
          }, wait_ms);
          // CDP evaluation avoids injecting a script tag that the page's CSP could block.
          const json = await page.evaluate(`(async () => {
            const result = await (${evaluation});
            const json = JSON.stringify(result);
            if (json === undefined || new TextEncoder().encode(json).length > 24 * 1024 * 1024) throw new Error("navigate 的结果无效或过大，请缩小选区");
            return json;
          })()`);
          combined.throwIfAborted();
          return JSON.parse(json);
        })(),
        new Promise((_, reject) => {
          on_abort = () => reject(combined.reason);
          combined.addEventListener("abort", on_abort, { once: true });
          if (combined.aborted) on_abort();
        }),
      ]);
    } finally {
      if (on_abort) combined.removeEventListener("abort", on_abort);
      await browser.close();
    }
  };
}
