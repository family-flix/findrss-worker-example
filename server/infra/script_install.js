import { proxy_target_url } from "@findrss/feed-fetch";
import { MAX_SCRIPT_BYTES } from "../lib/constants.js";

/** 下载源码时逐跳校验地址，超时和字节上限覆盖完整正文。 */
export async function fetch_install_script(input, fetch_impl = fetch) {
  const signal = AbortSignal.timeout(15000);
  let url = input;
  for (let hop = 0; hop <= 5; hop++) {
    url = proxy_target_url(url);
    if (!url) throw new Error("请输入公网 HTTP(S) 脚本直链，不支持凭据、内网地址或非标准端口");
    const response = await fetch_impl(url, { redirect: "manual", signal, headers: { Accept: "text/plain, application/javascript" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("Location");
      if (!location || hop === 5) throw new Error("脚本下载重定向无效或过多");
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("脚本下载失败：HTTP " + response.status);
    }
    if (Number(response.headers.get("Content-Length")) > MAX_SCRIPT_BYTES) {
      await response.body?.cancel();
      throw new Error("脚本超过 128KB 限制");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("下载的脚本内容为空");
    const decoder = new TextDecoder();
    let script = "", size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_SCRIPT_BYTES) throw new Error("脚本超过 128KB 限制");
        script += decoder.decode(value, { stream: true });
      }
      script += decoder.decode();
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (!script.trim()) throw new Error("下载的脚本内容为空");
    if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(script)) throw new Error("下载地址返回了 HTML 页面，请填写脚本源码直链");
    return { script, source_url: url };
  }
}
