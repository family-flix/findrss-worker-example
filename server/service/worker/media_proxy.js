import { image_proxy_descriptor, image_proxy_target } from "../../lib/image_proxy.js";
import { error_response } from "../../lib/http.js";
import { script_image_response } from "./image_proxy.js";

const audio_types = new Set(["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/wav", "audio/x-wav", "audio/webm", "audio/flac", "audio/x-flac"]);

// 播放器按 Range 读取；直接流式返回，媒体不进入共享图片缓存。
export async function script_media_response(request, options) {
  if (!options.kind || options.kind === "img") return script_image_response(request, options);
  if (!["video", "audio"].includes(options.kind)) return error_response("media kind invalid", 400);
  const range = request.headers.get("Range");
  if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return error_response("media range invalid", 400);
  try {
    const descriptor = image_proxy_descriptor(options.route, options.descriptor);
    let target = descriptor.url;
    for (let hop = 0; hop <= 5; hop++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      let response;
      try {
        response = await fetch(target, { method: request.method === "HEAD" ? "HEAD" : "GET",
          headers: { ...descriptor.headers, ...(range ? { Range: range } : {}) },
          redirect: "manual", signal: controller.signal });
      } finally { clearTimeout(timer); }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("Location");
        if (!location || hop === 5) throw new Error("媒体重定向无效");
        target = image_proxy_target(options.route, new URL(location, target).href);
        continue;
      }
      const headers = { "Cache-Control": options.headers["Cache-Control"], "X-Content-Type-Options": "nosniff" };
      for (const name of ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"]) {
        if (response.headers.has(name)) headers[name] = response.headers.get(name);
      }
      if (range && response.status === 416) {
        await response.body?.cancel();
        delete headers["Content-Length"];
        return new Response(null, { status: 416, headers });
      }
      const type = (response.headers.get("Content-Type") || "").split(";", 1)[0].trim().toLowerCase();
      if (![200, 206].includes(response.status) || (options.kind === "video" ? type !== "video/mp4" : !audio_types.has(type))) {
        await response.body?.cancel();
        throw new Error("媒体上游类型或状态无效");
      }
      if (request.method === "HEAD") await response.body?.cancel();
      return new Response(request.method === "HEAD" ? null : response.body, { status: response.status, headers });
    }
  } catch { return error_response("media upstream failed", 502); }
}
