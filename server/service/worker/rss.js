// 外层 Worker 侧的处理函数：只碰 env 与 Request/Response，不 import DO 类。
// /rss/ 与 /atom/ 公开路由：公网地址推导与匿名脚本调用。
import { bearer_token } from "../../lib/http.js";
import { valid_access_token, valid_identifier } from "../../lib/identifiers.js";
import { reader_identity } from "./session.js";

/**
 * 渲染 rel="self" 用的公开地址：优先取上游反向代理（如订阅广场）透传的
 * X-Feed-Public-URL（此时 request.url 是内部 Service Binding 地址，推不出公开地址），
 * 否则用调用方实际请求推导。两者都会剥离 token。
 * @param {Request} request
 * @returns {string}
 */
export function feed_public_url(request) {
  const forwarded = (request.headers.get("X-Feed-Public-URL") ?? "").trim();
  let public_url = new URL(request.url);
  if (forwarded !== "") {
    try {
      const parsed = new URL(forwarded);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") public_url = parsed;
    } catch {
      // 透传值不是合法 URL 时退回按 request.url 推导。
    }
  }
  const cleaned = new URL(public_url);
  cleaned.pathname = cleaned.pathname.replace(/^\/debug\//, "/rss/");
  cleaned.searchParams.delete("token");
  return cleaned.toString();
}

/**
 * 公开 RSS/Atom 路由接受用户 token（query、Bearer 或 X-FindRSS-Token 头）或 Reader Session（Bearer）。
 * 有效身份会被注入内部请求；无效或缺失身份交由 DO 按公开源地址判断。
 * `/rss/<route>` 与 `/atom/<route>` 指向同一条 route：format 只决定序列化格式，
 * 公开性判定与响应缓存都与格式无关。
 * @param {Env} env
 * @param {Request} request
 * @param {string} route_pathname
 * @param {string} format
 * @returns {Promise<Response>}
 */
export async function public_rss_route(env, request, route_pathname, format) {
  const source_url = new URL(request.url);
  const token = (source_url.searchParams.get("token") ?? "").trim() || bearer_token(request);
  const authorization = request.headers.get("Authorization") ?? "";
  const credential_sources = [source_url.searchParams.get("token")?.trim() ? "query" : "", authorization.startsWith("Bearer ") && authorization.slice(7).trim() ? "bearer" : "", request.headers.get("X-FindRSS-Token")?.trim() ? "header" : ""].filter(Boolean);
  let verification_status = token ? "invalid_format" : "missing";
  const object = env.APPLICATION;
  let access_token_id = "";
  if (token.startsWith("reader_v1.")) {
    const identity = await reader_identity(env, token);
    access_token_id = identity?.access_token_id ?? "";
    verification_status = valid_identifier(access_token_id) ? "accepted" : "invalid_session";
  } else if (valid_access_token(token)) {
    verification_status = "rejected";
    const verification = await object.fetch("https://internal/_internal/access-tokens/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        token
      })
    });
    if (verification.ok) {
      /** @type {{ access_token?: { id?: string } }} */
      const authorization = await verification.json();
      access_token_id = String(authorization.access_token?.id ?? "");
      if (valid_identifier(access_token_id)) verification_status = "accepted";
    }
  }
  const internal_url = new URL("https://internal/_public/feed/" + format + route_pathname);
  for (const [name, value] of source_url.searchParams) {
    if (name !== "token") internal_url.searchParams.append(name, value);
  }
  // 渲染 rel="self" 用的公开地址：脚本无关，由外层推导或由反向代理透传（已剥离 token）。
  const public_url = feed_public_url(request);
  return object.fetch(new Request(internal_url, {
    method: "GET",
    headers: {
      "X-Api-Access-Token-ID": valid_identifier(access_token_id) ? access_token_id : "",
      "X-RSS-Credential-Sources": credential_sources.join(","),
      "X-RSS-Credential-Status": verification_status,
      "X-RSS-Browser-Credentials": request.headers.get("Cookie")?.trim() ? "present" : "absent",
      "X-Feed-Public-URL": public_url.toString(),
      "X-FindRSS-Refresh-ID": request.headers.get("X-FindRSS-Refresh-ID") ?? "",
      Accept: request.headers.get("Accept") ?? ""
    }
  }));
}
