import { ScriptTestRequestModel } from "./script_test.js";
import { RssRoutePatternModel } from "./rss_route.js";
import { ScriptVersionModel } from "./script_version.js";

// 调试链接只提供本地草稿的路由上下文，不会直接请求链接指向的主机。
export function ScriptDebugRequestModel(state = {}) {
  const script = String(state.script ?? "");
  const route = String(state.route ?? "");
  const request_url = String(state.request_url ?? "");
  return Object.freeze({
    script, route, request_url,
    ...(state.version === undefined ? {} : { version: state.version }),
    resolve(routes, public_origin = "") {
      const url = new URL(request_url, public_origin || "https://example.invalid");
      const pathname = url.pathname.replace(/^\/(rss|atom|debug)(?=\/)/, "");
      const selected = routes.map(metadata => ({ metadata,
        match: RssRoutePatternModel.fromValue(metadata.path)?.match(pathname) }))
        .filter(entry => entry.match)
        .sort((left, right) => right.match.score - left.match.score)[0];
      if (!selected) return { ok: false, error: { status: 400, message: "调试链接与当前脚本的路由不匹配" } };
      url.searchParams.delete("token");
      return { ok: true, metadata: selected.metadata, context: {
        method: "GET", pathname: "/debug" + pathname, public_origin,
        params: selected.match.params, query: Object.fromEntries(url.searchParams),
      } };
    },
    toValue: () => ({ script, route, request_url, ...(state.version === undefined ? {} : { version: state.version }) }),
  });
}

ScriptDebugRequestModel.of = ScriptDebugRequestModel;
ScriptDebugRequestModel.MAX_URL_CHARS = 8192;
ScriptDebugRequestModel.fromBody = body => {
  const parsed = ScriptTestRequestModel.fromBody(body);
  if (!parsed.ok) return parsed;
  const parsed_version = ScriptVersionModel.parse(body.version);
  if (!parsed_version.ok) return parsed_version;
  if (typeof body.request_url !== "string" || !body.request_url.trim()) {
    return { ok: false, error: { status: 400, message: "填写实际的脚本路由链接" } };
  }
  const request_url = body.request_url.trim();
  if (request_url.length > ScriptDebugRequestModel.MAX_URL_CHARS) {
    return { ok: false, error: { status: 400, message: "调试链接过长" } };
  }
  try {
    // 接受完整 HTTP(S) 地址或以 / 开头的本地路由。
    if (!request_url.startsWith("/") && !/^https?:\/\//i.test(request_url)) throw new Error();
    const url = new URL(request_url, "https://example.invalid");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
  } catch {
    return { ok: false, error: { status: 400, message: "调试链接必须是 HTTP(S) 地址或以 / 开头的路由" } };
  }
  return { ok: true, model: ScriptDebugRequestModel({ ...parsed.model.toValue(), request_url,
    ...(body.version === undefined ? {} : { version: parsed_version.model.version }) }) };
};
