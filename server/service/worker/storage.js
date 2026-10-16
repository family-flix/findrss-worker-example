import { create_api_object_store } from "../../infra/object_store.js";
import { error_response, json_response } from "../../lib/http.js";
import { is_valid_key } from "@findrss/object-store";

// 由 api.js 的管理员鉴权入口调用；对象内容始终通过此入口读取。
export async function admin_storage_request(request, env) {
  const url = new URL(request.url);
  const file_request = url.pathname.endsWith("/file");
  const allowed = file_request ? ["GET", "HEAD"] : ["GET"];
  if (!allowed.includes(request.method)) return error_response("method not allowed", 405, { Allow: allowed.join(", ") });
  const store = create_api_object_store(env);
  if (!store) return error_response("未配置 R2 存储", 503);
  const key = url.searchParams.get("key");
  if (file_request && !is_valid_key(key)) return error_response("无效的文件路径", 400);
  const cursor = url.searchParams.get("cursor");
  if (cursor && cursor.length > 8192) return error_response("无效的分页游标", 400);
  try {
    if (url.pathname.endsWith("/usage")) {
      return json_response({ ...await store.usage(), generated_at: Date.now() });
    }
    if (file_request) {
      const object = await (request.method === "HEAD" ? store.head(key) : store.get(key));
      if (!object) return error_response("文件不存在", 404);
      const download = url.searchParams.get("download") === "1";
      const content_type = object.httpMetadata?.contentType || "application/octet-stream";
      // HTML/SVG 等可执行内容以纯文本查看，避免借管理员域名执行脚本。
      const safe_type = /^(image\/(png|jpeg|gif|webp|avif|bmp)|text\/plain|application\/json)($|;)/i.test(content_type);
      const headers = {
        "Content-Type": download ? "application/octet-stream" : safe_type ? content_type : "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(key.split("/").at(-1)).replace(/['()]/g, char => "%" + char.charCodeAt(0).toString(16))}`,
      };
      if (!download && object.httpMetadata?.contentEncoding) headers["Content-Encoding"] = object.httpMetadata.contentEncoding;
      return new Response(request.method === "HEAD" ? null : object.body, { headers });
    }
    const page = await store.list({ cursor, limit: 100 });
    return json_response({ ...page, objects: page.objects.map(object => ({
      key: object.key, size: object.size, uploaded: object.uploaded,
    })) });
  } catch {
    return error_response("R2 存储读取失败，请重试", 502);
  }
}
