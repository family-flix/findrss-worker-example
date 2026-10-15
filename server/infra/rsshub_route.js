import { create_ai_request_timeout } from "./script_agent_timeout.js";

const MAX_SOURCE_BYTES = 64 * 1024;
const source_extension = /\.(?:[cm]?js|jsx|ts|tsx|json)$/i;

function source_location(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("填写 RSSHub 的 GitHub blob 或 raw 源码链接"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
    !["github.com", "raw.githubusercontent.com"].includes(url.hostname)) {
    throw new Error("仅支持 DIYgod/RSSHub 仓库的 HTTPS 源码链接");
  }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { throw new Error("RSSHub 源码路径编码无效"); }
  const prefix = url.hostname === "github.com" ? /^\/DIYgod\/RSSHub\/(?:blob|raw)\//i : /^\/DIYgod\/RSSHub\//i;
  const match = /^(.*?)\/(lib\/.+)$/.exec(pathname.replace(prefix, ""));
  if (!prefix.test(pathname) || !match || !source_extension.test(match[2]) ||
    /[\x00-\x20\x7f\\%?#]/.test(match[0]) || match[0].split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("链接须指向 DIYgod/RSSHub 的 lib/ 下的 JS、TS、TSX 或 JSON 文件");
  }
  const [, ref, path] = match;
  return { ref, path, raw_url: source_url(ref, path) };
}

function source_url(ref, path) {
  return "https://raw.githubusercontent.com/DIYgod/RSSHub/" + [...ref.split("/"), ...path.split("/")].map(encodeURIComponent).join("/");
}

function related_sources(source, { ref, path }) {
  const imports = [];
  // 只提供候选文件线索，不执行源码；扩展名候选是否存在由下一次抓取确认。
  for (const match of source.matchAll(/\bfrom\s*['"]([^'"\r\n]+)['"]|\bimport\s*(?:\(\s*)?['"]([^'"\r\n]+)['"]/g)) {
    const specifier = match[1] || match[2];
    if (imports.some(item => item.specifier === specifier)) continue;
    const urls = [];
    if (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("@/")) {
      const resolved = new URL(specifier.startsWith("@/") ? "/" + specifier.slice(2) : specifier,
        "https://rsshub.invalid/" + path.slice(4));
      const target = "lib" + resolved.pathname;
      for (const candidate of source_extension.test(target) ? [target] :
        [target + ".ts", target + ".tsx", target + ".js", target + ".json", target + "/index.ts", target + "/index.tsx"]) {
        try { urls.push(source_location(source_url(ref, candidate)).raw_url); } catch { /* 非源码引用留给模型分析 */ }
      }
    }
    imports.push({ specifier, candidate_urls: urls });
    if (imports.length >= 40) break;
  }
  const namespace = /^lib\/routes\/([^/]+)\//.exec(path);
  return { imports, ...(namespace ? { namespace_url: source_url(ref, `lib/routes/${namespace[1]}/namespace.ts`) } : {}) };
}

export async function fetch_rsshub_route_js(args, { signal, fetch_impl = (...values) => fetch(...values), timeout_options } = {}) {
  if (typeof args?.url !== "string" || args.url.length > 2048) throw new Error("填写有效的 RSSHub 源码链接（最多 2048 字符）");
  const location = source_location(args.url);
  const timeout = create_ai_request_timeout({ idle_ms: 15_000, total_ms: 30_000, ...timeout_options, signal });
  let reader;
  try {
    const response = await timeout.wait(fetch_impl(location.raw_url, {
      method: "GET", redirect: "manual", signal: timeout.signal,
      headers: { Accept: "text/plain", "User-Agent": "FindRSS-RSSHub-Route-Tool" },
    }));
    if (!response.ok) {
      response.body?.cancel().catch(() => {});
      throw new Error(`RSSHub 源码抓取失败（HTTP ${response.status}），请确认文件路径和分支；不跟随重定向`);
    }
    reader = response.body?.getReader();
    if (!reader) throw new Error("RSSHub 源码响应为空");
    if (Number(response.headers.get("content-length")) > MAX_SOURCE_BYTES) throw new Error("RSSHub 源码超过 64KB，请选择较小的依赖文件");
    const decoder = new TextDecoder();
    let source = "", bytes = 0;
    for (;;) {
      const { value, done } = await timeout.wait(reader.read());
      if (done) { source += decoder.decode(); break; }
      timeout.touch();
      bytes += value.byteLength;
      if (bytes > MAX_SOURCE_BYTES) throw new Error("RSSHub 源码超过 64KB，请选择较小的依赖文件");
      source += decoder.decode(value, { stream: true });
    }
    if (!source.trim()) throw new Error("RSSHub 源码文件为空");
    if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(source)) throw new Error("RSSHub 返回了 HTML 页面，未取得源码");
    return { ...location, source, bytes, ...related_sources(source, location) };
  } catch (error) {
    if (error.name === "TimeoutError") throw new Error("RSSHub 源码抓取超时，请重试");
    throw error;
  } finally {
    if (reader) { reader.cancel().catch(() => {}); reader.releaseLock(); }
    timeout.close();
  }
}
