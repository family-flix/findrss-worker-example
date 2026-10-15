// 外层 Worker 侧的处理函数：只碰 env 与 Request/Response，不 import DO 类。
// 管理端与阅读端写入口：校验调用方后把请求转发给 API DO 的内部路由。
import { API_OBJECT_NAME, MAX_BODY_BYTES, READER_SYNC_MAX_BODY } from "../../lib/constants.js";
import { DeviceModel } from "../../domain/device_capacity.js";
import { bearer_token, error_response, json_response } from "../../lib/http.js";
import { valid_identifier } from "../../lib/identifiers.js";
import { feed_hostname_origin, resolve_discovery_source_feed_urls } from "./discovery.js";
import { reader_identity } from "./session.js";
import { script_media_response } from "./media_proxy.js";

/**
 * @param {Env} env
 * @returns {Promise<Response>}
 */
export async function admin_overview(env) {
  const object = env.API.getByName(API_OBJECT_NAME);
  const [response, access_tokens_response, statistics_response] = await Promise.all([
    object.fetch("https://internal/"),
    object.fetch("https://internal/_admin/access-tokens"),
    object.fetch("https://internal/_admin/statistics"),
  ]);
  if (!response.ok || !access_tokens_response.ok || !statistics_response.ok) {
    return error_response("failed to load API overview", 500);
  }
  /** @type {Record<string, unknown>} */
  const summary = await response.json();
  /** @type {{ access_tokens?: Record<string, unknown>[] }} */
  const access_tokens = await access_tokens_response.json();
  const statistics = await (await resolve_discovery_source_feed_urls(statistics_response, feed_hostname_origin(env), false)).json();
  return json_response({
    generated_at: Date.now(),
    ...summary,
    statistics,
    access_tokens: Array.isArray(access_tokens.access_tokens)
      ? access_tokens.access_tokens
      : [],
  });
}

/**
 * @param {Env} env
 * @param {Request} request
 * @param {string} path
 * @returns {Promise<Response>}
 */
export async function admin_access_token_request(env, request, path) {
  const object = env.API.getByName(API_OBJECT_NAME);
  return object.fetch(new Request("https://internal/_admin/access-tokens" + path, request));
}

/**
 * 用户管理的所有请求原样转发到 Durable Object。
 * @param {Env} env
 * @param {Request} request
 * @param {string} path
 * @returns {Promise<Response>}
 */
export async function admin_user_request(env, request, path) {
  const object = env.API.getByName(API_OBJECT_NAME);
  // 把 Request 当 init 传给 new Request() 不会带 query，必须显式搬过来，
  // 否则 limit/offset/q（用户列表）和 kind/cursor/limit（用户日志）全部丢失。
  const internal_url = new URL("https://internal/_admin/users" + path);
  internal_url.search = new URL(request.url).search;
  return object.fetch(new Request(internal_url, request));
}

/**
 * @param {Env} env
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function admin_discovery_source_request(env, request, path = "") {
  const object = env.API.getByName(API_OBJECT_NAME);
  const source_url = new URL(request.url);
  const internal_url = new URL("https://internal/_admin/discovery/sources" + path);
  internal_url.search = source_url.search;
  const forwarded = new Request(internal_url, request);
  forwarded.headers.set("X-Feed-Public-URL", feed_hostname_origin(env) || source_url.origin);
  const response = await object.fetch(forwarded);
  return resolve_discovery_source_feed_urls(response, feed_hostname_origin(env), true);
}

/**
 * 归一 FINDRSS_HOSTNAME 为完整 origin：纯 hostname 默认补 https://，尾斜杠去掉。
 * @param {Env} env
 * @returns {string}
 */

/**
 * @param {Env} env
 * @param {Request} request
 * @param {string} path
 * @returns {Promise<Response>}
 */
export async function admin_script_request(env, request, path = "") {
  const object = env.API.getByName(API_OBJECT_NAME);
  const source_url = new URL(request.url);
  const internal_url = new URL("https://internal/_admin/scripts" + path);
  internal_url.search = source_url.search;
  const forwarded = new Request(internal_url, request);
  // DO 的 env 不会继承路由层按访问地址补全的变量，显式传递脚本使用的公开地址。
  forwarded.headers.set("X-Feed-Public-URL", feed_hostname_origin(env) || source_url.origin);
  return object.fetch(forwarded);
}

export async function admin_script_asset_request(env, request, id) {
  const response = await admin_script_request(env, request, "/preview-assets/" + id);
  if (!response.ok) return response;
  const { route, descriptor, kind } = await response.json();
  return script_media_response(request, { route, descriptor, kind, version: "",
    headers: { "Cache-Control": "no-store" } });
}

export async function admin_cookie_request(env, request, path = "/update") {
  const object = env.API.getByName(API_OBJECT_NAME);
  return object.fetch(new Request("https://internal/_admin/cookies" + path, request));
}

/**
 * 渲染 rel="self" 用的公开地址：优先取上游反向代理（如订阅广场）透传的
 * X-Feed-Public-URL（此时 request.url 是内部 Service Binding 地址，推不出公开地址），
 * 否则用调用方实际请求推导。两者都会剥离 token。
 * @param {Request} request
 * @returns {string}
 */

export async function admin_credit_transactions(env, request) {
  const object = env.API.getByName(API_OBJECT_NAME);
  const source_url = new URL(request.url);
  const internal_url = new URL("https://internal/_admin/credit-transactions");
  internal_url.search = source_url.search;
  return object.fetch(new Request(internal_url, request));
}

/** @param {Env} env @param {Request} request @param {string} path */
export async function admin_redemption_campaign_request(env, request, path = "") {
  const object = env.API.getByName(API_OBJECT_NAME);
  const source_url = new URL(request.url);
  const internal_url = new URL("https://internal/_admin/redemption-campaigns" + path);
  internal_url.search = source_url.search;
  return object.fetch(new Request(internal_url, request));
}

/**
 * @param {Env} env
 * @param {Request} request
 * @param {string} internal_path
 * @param {number} [max_body]
 */
export async function reader_redemption_request(env, request, internal_path, max_body = 4096) {
  const identity = await reader_identity(env, bearer_token(request));
  if (identity === null) return error_response("authentication required", 401);
  const headers = new Headers({
    "X-Api-User-ID": identity.user.id,
    "X-Api-Access-Token-ID": identity.access_token_id,
  });
  let body;
  if (request.method === "POST") {
    const content_length = Number(request.headers.get("Content-Length") ?? "0");
    if (content_length > max_body) return error_response("request body is too large", 413);
    body = await request.text();
    if (body.length > max_body) return error_response("request body is too large", 413);
    headers.set("Content-Type", "application/json");
  }
  const object = env.API.getByName(API_OBJECT_NAME);
  return object.fetch(new Request("https://internal" + internal_path, {
    method: request.method,
    headers,
    body,
  }));
}

/**
 * 订阅/文章/已读的通用读写入口：验签 → 注入账号头（含 query）→ 转发 DO。
 * 状态本身存在 DO 里，外层只做鉴权与转发。
 * @param {Env} env
 * @param {Request} request
 * @param {string} internal_path
 * @param {number} [max_body]
 * @returns {Promise<Response>}
 */
export async function reader_sync_request(env, request, internal_path, max_body = READER_SYNC_MAX_BODY) {
  const identity = await reader_identity(env, bearer_token(request));
  if (identity === null) return error_response("authentication required", 401);
  const headers = new Headers({
    "X-Api-User-ID": identity.user.id,
    "X-Api-Access-Token-ID": identity.access_token_id,
  });
  let body;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const content_length = Number(request.headers.get("Content-Length") ?? "0");
    if (Number.isFinite(content_length) && content_length > max_body) {
      return error_response("request body is too large", 413);
    }
    body = await request.text();
    if (body.length > max_body) return error_response("request body is too large", 413);
    headers.set("Content-Type", "application/json");
  }
  const internal_url = new URL("https://internal" + internal_path);
  internal_url.search = new URL(request.url).search;
  const object = env.API.getByName(API_OBJECT_NAME);
  return object.fetch(new Request(internal_url, {
    method: request.method,
    headers,
    body,
  }));
}

/**
 * @param {Env} env
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function admin_create_call(env, request) {
  const content_length = Number(request.headers.get("Content-Length") ?? "0");
  if (content_length > MAX_BODY_BYTES) {
    return error_response("request body is too large", 413);
  }
  /** @type {AdminCallBody} */
  let body;
  try {
    body = await request.json();
  } catch {
    return error_response("invalid JSON", 400);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return error_response("invalid JSON body", 400);
  }
  const target_device_id =
    typeof body.target_device_id === "string" ? body.target_device_id.trim() : "";
  const method = typeof body.method === "string" ? body.method.trim() : "";
  const args = body.args ?? {};
  if (target_device_id !== "" && !valid_identifier(target_device_id)) {
    return error_response("invalid target_device_id", 400);
  }
  if (!valid_identifier(method)) {
    return error_response("invalid method", 400);
  }
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return error_response("args must be an object", 400);
  }

  const object = env.API.getByName(API_OBJECT_NAME);
  if (target_device_id !== "") {
    const summary_response = await object.fetch("https://internal/");
    if (!summary_response.ok) {
      return error_response("failed to load API devices", 502);
    }
    /** @type {{ devices?: DeviceSummary[] }} */
    const summary = await summary_response.json();
    const devices = Array.isArray(summary.devices) ? summary.devices : [];
    const target_device = devices.find((device) => device.device_id === target_device_id);
    if (target_device === undefined) {
      return error_response("target device is not registered", 404);
    }
    if (target_device.status === "disabled" || target_device.disabled === true) {
      return error_response("target device is disabled", 409);
    }
    if (target_device.status === "offline") {
      return error_response("target device is offline", 409);
    }
    if (!DeviceModel.supports(target_device.methods, method)) {
      return error_response("target device does not provide method " + method, 409);
    }
  }

  return object.fetch("https://internal/call", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Publisher-ID": "admin-console",
    },
    body: JSON.stringify({
      method,
      target_device_id,
      idempotency_key:
        typeof body.idempotency_key === "string" && body.idempotency_key.trim() !== ""
          ? body.idempotency_key.trim()
          : "admin-call-" + crypto.randomUUID(),
      args,
    }),
  });
}

/**
 * @param {Env} env
 * @param {string} task_id
 * @returns {Promise<Response>}
 */
export async function admin_task_status(env, task_id) {
  if (!/^[A-Za-z0-9-]{1,128}$/.test(task_id)) {
    return error_response("invalid task id", 400);
  }
  const object = env.API.getByName(API_OBJECT_NAME);
  return object.fetch("https://internal/tasks/" + encodeURIComponent(task_id));
}

/**
 * @param {Env} env
 * @param {Request} request
 * @param {string} device_id
 * @returns {Promise<Response>}
 */
export async function admin_reset_device(env, request, device_id) {
  const object = env.API.getByName(API_OBJECT_NAME);
  return object.fetch(
    new Request("https://internal/_admin/devices/" + device_id + "/reset", request),
  );
}

/**
 * @param {Env} env
 * @param {Request} request
 * @param {string} device_id
 * @param {string} action_path
 * @returns {Promise<Response>}
 */
export async function admin_device_action(env, request, device_id, action_path) {
  const object = env.API.getByName(API_OBJECT_NAME);
  return object.fetch(
    new Request(
      "https://internal/_admin/devices/" + device_id + action_path,
      request,
    ),
  );
}

/**
 * @param {Env} env
 * @param {Request} request
 * @param {string} device_id
 * @returns {Promise<Response>}
 */
export async function admin_device_logs(env, request, device_id) {
  const object = env.API.getByName(API_OBJECT_NAME);
  const source_url = new URL(request.url);
  const internal_url = new URL(
    "https://internal/_admin/devices/" + device_id + "/logs",
  );
  internal_url.search = source_url.search;
  return object.fetch(new Request(internal_url, request));
}
