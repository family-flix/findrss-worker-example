import { secure_site_response } from "./server/lib/site_security.js";
import { safe_equal } from "./server/lib/identifiers.js";
import { json_response } from "./server/lib/http.js";

/**
 * @typedef {Object} Env
 * @property {Fetcher} ASSETS
 * @property {string} [ADMIN_PASSWORD]
 */

const admin_username = "admin";
const session_cookie_name = "findrss_admin_session";
const session_duration_seconds = 12 * 60 * 60;

/** @param {ArrayBuffer} value */
function base64_url_encode(value) {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/**
 * @param {string} admin_token
 * @param {number} expires_at
 */
async function sign_session(admin_token, expires_at) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(admin_token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode("findrss-admin-session:" + String(expires_at)),
  );
  return base64_url_encode(signature);
}

/** @param {Request} request */
function session_cookie(request) {
  const cookies = request.headers.get("Cookie") || "";
  for (const part of cookies.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === session_cookie_name) {
      return part.slice(separator + 1).trim();
    }
  }
  return "";
}

/**
 * @param {Request} request
 * @param {Env} env
 */
async function session_authorized(request, env) {
  const admin_token =
    typeof env.ADMIN_PASSWORD === "string" ? env.ADMIN_PASSWORD : "";
  const parts = session_cookie(request).split(".");
  if (admin_token === "" || parts.length !== 3 || parts[0] !== "v1")
    return false;
  const expires_at = Number(parts[1]);
  if (
    !Number.isSafeInteger(expires_at) ||
    expires_at <= Math.floor(Date.now() / 1000)
  ) {
    return false;
  }
  return safe_equal(parts[2], await sign_session(admin_token, expires_at));
}

/** @param {Request} request */
function secure_cookie_attribute(request) {
  const hostname = new URL(request.url).hostname;
  return hostname === "127.0.0.1" || hostname === "localhost" ? "" : "; Secure";
}

/**
 * @param {Request} request
 * @param {string} value
 * @param {number} max_age
 */
function session_set_cookie(request, value, max_age) {
  return (
    session_cookie_name +
    "=" +
    value +
    "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" +
    String(max_age) +
    secure_cookie_attribute(request)
  );
}

/** @returns {Response} */
function authentication_required() {
  return json_response({ error: "authentication required" }, 401);
}

/**
 * @param {Request} request
 * @param {Env} env
 */
async function handle_login(request, env) {
  if (request.method !== "POST") {
    return json_response({ error: "method not allowed" }, 405, {
      Allow: "POST",
    });
  }
  const admin_token =
    typeof env.ADMIN_PASSWORD === "string" ? env.ADMIN_PASSWORD : "";
  if (admin_token === "") {
    return json_response({ error: "ADMIN_PASSWORD is not configured" }, 503);
  }
  let body;
  try {
    const text = await request.text();
    if (text.length > 4096)
      return json_response({ error: "request body is too large" }, 413);
    body = JSON.parse(text);
  } catch {
    return json_response({ error: "invalid JSON" }, 400);
  }
  const password = typeof body?.password === "string" ? body.password : "";
  if (!safe_equal(password, admin_token)) {
    return json_response({ error: "密码错误" }, 401);
  }
  const expires_at = Math.floor(Date.now() / 1000) + session_duration_seconds;
  const signature = await sign_session(admin_token, expires_at);
  const session = "v1." + String(expires_at) + "." + signature;
  return json_response(
    {
      logged_in: true,
      user: { username: admin_username },
      expires_at: expires_at * 1000,
    },
    200,
    {
      "Set-Cookie": session_set_cookie(
        request,
        session,
        session_duration_seconds,
      ),
    },
  );
}

/** @param {Request} request */
function handle_logout(request) {
  if (request.method !== "POST") {
    return json_response({ error: "method not allowed" }, 405, {
      Allow: "POST",
    });
  }
  return json_response({ logged_in: false }, 200, {
    "Set-Cookie": session_set_cookie(request, "", 0),
  });
}

/**
 * @param {Request} request
 * @param {Env} env
 */
async function handle_session(request, env) {
  if (request.method !== "GET") {
    return json_response({ error: "method not allowed" }, 405, {
      Allow: "GET",
    });
  }
  const logged_in = await session_authorized(request, env);
  return json_response({
    logged_in,
    user: logged_in ? { username: admin_username } : null,
  });
}

/**
 * @param {Request} request
 * @param {Env} env
 */
async function proxy_admin_api(request, env, api_fetch) {
  if (!(await session_authorized(request, env)))
    return authentication_required();
  if (
    request.headers.get("Upgrade") &&
    request.headers.get("Origin") !== new URL(request.url).origin
  ) {
    return json_response({ error: "origin rejected" }, 403);
  }
  const headers = new Headers(request.headers);
  headers.set("Authorization", "Bearer " + env.ADMIN_PASSWORD);
  headers.delete("Cookie");
  return api_fetch(new Request(request, { headers }));
}

const secure_response = (response) => secure_site_response(response, "admin");

export async function handle_admin_request(request, env, api_fetch) {
  const pathname = new URL(request.url).pathname;
  let response;
  if (pathname === "/admin/auth/login") {
    response = await handle_login(request, env);
  } else if (pathname === "/admin/auth/logout") {
    response = handle_logout(request);
  } else if (pathname === "/admin/auth/session") {
    response = await handle_session(request, env);
  } else if (pathname === "/admin/api" || pathname.startsWith("/admin/api/")) {
    response = await proxy_admin_api(request, env, api_fetch);
  } else if (request.headers.get("Upgrade") !== null) {
    // 管理页没有 WebSocket 端点；ASSETS 无法处理 Upgrade 请求会抛 500，这里直接返回 404
    response = json_response({ error: "not found" }, 404);
  } else {
    const url = new URL(request.url);
    if (
      [
        "/admin/",
        "/admin/overview",
        "/admin/tokens",
        "/admin/devices",
        "/admin/messages",
        "/admin/users",
        "/admin/activity",
        "/admin/discovery",
        "/admin/scripts",
        "/admin/cookies",
        "/admin/redemptions",
      ].includes(pathname)
    )
      url.pathname = "/admin/index.html";
    if (pathname === "/admin/login") url.pathname = "/admin/login.html";
    response = await env.ASSETS.fetch(new Request(url, request));
  }
  return secure_response(response);
}
