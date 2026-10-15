import { image_proxy_descriptor } from "./image_proxy.js";

export function script_output(route, value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (Object.hasOwn(value, "body")) {
      if (typeof value.body !== "string") throw new Error("路由响应 body 必须是字符串");
      const content_type = value.content_type ?? "text/plain; charset=utf-8";
      if (typeof content_type !== "string" || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:; charset=utf-8)?$/i.test(content_type)) {
        throw new Error("路由响应 content_type 无效");
      }
      return { body: value.body, content_type };
    }
    if (Object.hasOwn(value, "url") && !Array.isArray(value.items)) {
      return { descriptor: image_proxy_descriptor(route, value) };
    }
  }
  if (typeof value === "string") return { body: value, content_type: "text/plain; charset=utf-8" };
  const body = JSON.stringify(value);
  if (typeof body !== "string") throw new Error("路由返回值无法序列化");
  return { body, content_type: "application/json; charset=utf-8" };
}
