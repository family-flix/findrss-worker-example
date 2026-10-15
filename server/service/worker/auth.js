// 外层 Worker 侧的处理函数：只碰 env 与 Request/Response，不 import DO 类。
// 管理端鉴权：Bearer / X-Admin-Token 与 env.ADMIN_PASSWORD 常量时间比较。
import { safe_equal } from "../../lib/identifiers.js";

/**
 * @param {Request} request
 * @param {Env} env
 * @returns {boolean}
 */
export function admin_authorized(request, env) {
  if (!env.ADMIN_PASSWORD) {
    return false;
  }
  const authorization = request.headers.get("Authorization") ?? "";
  if (authorization.startsWith("Bearer ")) {
    return safe_equal(authorization.slice(7), env.ADMIN_PASSWORD);
  }
  if (!authorization.startsWith("Basic ")) {
    return false;
  }
  try {
    const credentials = atob(authorization.slice(6));
    const separator = credentials.indexOf(":");
    if (separator < 0) {
      return false;
    }
    const username = credentials.slice(0, separator);
    const password = credentials.slice(separator + 1);
    return username === "admin" && safe_equal(password, env.ADMIN_PASSWORD);
  } catch {
    return false;
  }
}

/** @returns {Response} */
export function admin_auth_required() {
  return new Response("Authorization required", {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "WWW-Authenticate": 'Basic realm="FindRSS Admin", charset="UTF-8"',
    },
  });
}
