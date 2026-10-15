import { image_proxy_descriptor, image_proxy_target } from "../lib/image_proxy.js";
import { SourceAvatarModel } from "../domain/discovery_source.js";

const max_bytes = 5 * 1024 * 1024;

/** 二进制只留在宿主；请求超时覆盖重定向与读取正文。 */
export async function fetch_script_image(route, descriptor, fetch_impl = fetch) {
  const request = image_proxy_descriptor(route, descriptor);
  const signal = AbortSignal.timeout(10000);
  let url = request.url;
  for (let hop = 0; hop <= 5; hop++) {
    const response = await fetch_impl(url, { headers: request.headers, redirect: "manual", signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("Location");
      if (!location || hop === 5) throw new Error("图片上游重定向无效或过多");
      url = image_proxy_target(route, new URL(location, url).toString());
      continue;
    }
    const content_type = (response.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
    if (!response.ok || !["image/png", "image/jpeg", "image/webp", "image/gif", "image/x-icon", "image/vnd.microsoft.icon"].includes(content_type)) {
      await response.body?.cancel();
      throw new Error("图片上游返回非图片响应或 HTTP " + response.status);
    }
    if (Number(response.headers.get("Content-Length")) > max_bytes) {
      await response.body?.cancel();
      throw new Error("图片超过 5MB 限制");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("图片上游返回空正文");
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max_bytes) throw new Error("图片超过 5MB 限制");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    const detected = SourceAvatarModel.sniff(body);
    if (!detected || detected !== (content_type === "image/vnd.microsoft.icon" ? "image/x-icon" : content_type)) throw new Error("图片类型与正文不一致");
    return { body, content_type: detected };
  }
  throw new Error("图片上游重定向过多");
}
