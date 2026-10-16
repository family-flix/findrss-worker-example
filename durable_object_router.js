import { AdminAgentRunRequestModel } from "./server/domain/admin_agent.js";
// APIDurableObject 的 fetch 路由表：DO 内部请求（/_admin、/_reader、/_public、/_internal
// 与设备协议）的路径匹配与分派。抽出来只为让 DO 类回归「状态 + 平台钩子」。
//
// 不 import DO 类（避免循环）：所有方法调用都经 route(request, app)，app 是 service 注册表。
//
// 这里是**唯一**的 `DurableObjectError → Response` 翻译点：service 只回数据或抛错，
// 一律经本文件组装 Response。需要自定义状态码/头的成功用 `do_result(...)` 包一层（invoke
// 的积分响应头走这条）；另有 3 处必须绕开 `json_response`（它会强制 `no-store` +
// `application/json`），在 dispatch 里直接造 `Response`：101 握手、二进制头像、feed。
import { DEFAULT_REDEMPTION_PAGE_SIZE } from "./server/lib/constants.js";
import { error_response, json_response } from "./server/lib/http.js";
import { decode_identifier } from "./server/lib/identifiers.js";
import { DurableObjectError, DurableObjectResult } from "./server/service/durable_object/error.js";
import { script_debug_html } from "./server/infra/script_debug.js";
import { feed_problem } from "./server/lib/feed_error.js";
import { redact_log_value } from "./server/lib/log_redact.js";
import { messages_socket } from "./messages_socket.js";
import { script_agent_socket } from "./script_agent_socket.js";

/**
 * @param {Request} request
 * @param {Record<string, any>} app
 * @returns {Promise<Response>}
 */
export async function route(request, app) {
  try {
    return translate(await dispatch(request, app));
  } catch (error) {
    if (error instanceof DurableObjectError) {
      const public_feed = new URL(request.url).pathname.startsWith("/_public/feed/");
      if (error.details.rss_debug && public_feed && (new URL(request.url).pathname.startsWith("/_public/feed/debug/") || request.headers.get("Accept")?.includes("text/html"))) {
        return debug_response(error.details.rss_debug, error.status, error.headers);
      }
      if (public_feed) {
        const codes = { 400: "INVALID_PARAMETER", 401: "FEED_AUTH_REQUIRED", 402: "INSUFFICIENT_CREDITS", 404: "FEED_NOT_FOUND", 409: "DEVICE_UNAVAILABLE", 502: "SCRIPT_FAILED", 503: "SOURCE_UNAVAILABLE", 504: "UPSTREAM_TIMEOUT" };
        const detail = error.error === "script failed" ? "订阅脚本执行失败，请联系订阅源管理员查看日志" : error.error;
        const problem = feed_problem(error.details.code, detail) || feed_problem(codes[error.status] || "SCRIPT_FAILED", detail);
        return json_response({ ...problem, status: error.status,
          ...(error.details.rss_debug ? { rss_debug: redact_log_value(error.details.rss_debug) } : {}),
        }, error.status, {
          ...error.headers, "Content-Type": "application/problem+json", "X-Content-Type-Options": "nosniff",
        });
      }
      return json_response({ error: error.error, ...error.details }, error.status, error.headers);
    }
    throw error;
  }
}

function debug_response(debug, status, headers = {}) {
  return new Response(script_debug_html(debug, status), {
    status, headers: { ...headers,
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      "Referrer-Policy": "no-referrer",
    },
  });
}

/**
 * 唯一的成功结果翻译：`Response` 原样放行（二进制 / WebSocket / 非 JSON 特例），
 * `DurableObjectResult` 用其自带状态码与响应头，其余裸数据一律 200 JSON。
 * @param {unknown} result
 * @returns {Response}
 */
function translate(result) {
  if (result instanceof Response) return result;
  if (result instanceof DurableObjectResult) {
    return json_response(result.data, result.status, result.headers);
  }
  return json_response(result);
}

/**
 * @param {Request} request
 * @param {Record<string, any>} app
 * @returns {Promise<unknown>}
 */
async function dispatch(request, app) {
  const url = new URL(request.url);
  if (url.pathname === "/_admin/background-tasks") {
    if (request.method === "GET") return app.background_tasks.list();
    throw new DurableObjectError("method not allowed", 405);
  }
  const cancel_background_task = url.pathname.match(/^\/_admin\/background-tasks\/([A-Za-z0-9-]+)\/cancel$/);
  if (cancel_background_task) {
    if (request.method === "POST") return app.background_tasks.cancel(cancel_background_task[1]);
    throw new DurableObjectError("method not allowed", 405);
  }
  if (["/_admin/settings/snapshots", "/_admin/settings/cookies", "/_admin/settings/webhook"].includes(url.pathname)) {
    const settings = url.pathname.endsWith("/webhook") ? app.webhook_settings
      : url.pathname.endsWith("/cookies") ? app.cookie_push_settings : app.snapshot_settings;
    if (request.method === "GET") return settings.settings();
    if (request.method === "PUT") {
      if (Number(request.headers.get("Content-Length") || 0) > 16384) throw new DurableObjectError("request body is too large", 413);
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > 16384) throw new DurableObjectError("request body is too large", 413);
      let body;
      try { body = JSON.parse(text); } catch { throw new DurableObjectError("invalid JSON", 400); }
      return settings.save_settings(body);
    }
    throw new DurableObjectError("method not allowed", 405);
  }
  const device_token_match = url.pathname.match(/^\/_admin\/device-tokens(?:\/([A-Za-z0-9-]+)(?:\/(reveal|revoke))?)?$/);
  if (device_token_match || url.pathname === "/_internal/device-tokens/verify") {
    const [, id, action] = device_token_match || [];
    if (request.method === "GET" && !id && device_token_match) return app.device_tokens.list();
    if (request.method === "POST" && action === "reveal") return app.device_tokens.reveal(id);
    if (request.method === "POST" && action === "revoke") return app.device_tokens.revoke(id);
    if ((request.method === "POST" && !id) || (request.method === "PATCH" && id && !action)) {
      const text = await request.text();
      if (text.length > 4096) throw new DurableObjectError("request body is too large", 413);
      let body;
      try { body = JSON.parse(text); } catch { throw new DurableObjectError("invalid JSON", 400); }
      if (!device_token_match) return app.device_tokens.verify(body?.token);
      return id ? app.device_tokens.update_note(id, body) : app.device_tokens.create(body);
    }
    throw new DurableObjectError("method not allowed", 405);
  }
  if (url.pathname === "/_admin/agent/ws" && request.method === "GET") return script_agent_socket(request, app.script_agent, { request_model: AdminAgentRunRequestModel, run: (input, emit, signal) => app.script_agent.run_admin(input, emit, signal) });
  if (url.pathname === "/_admin/scripts/agent/ws" && request.method === "GET") return script_agent_socket(request, app.script_agent);
  if (url.pathname === "/_admin/scripts/agent/settings" && request.method === "GET") return app.script_agent.settings();
  if ((url.pathname === "/_admin/scripts/agent/settings" && request.method === "PUT") || (url.pathname === "/_admin/scripts/agent/test" && request.method === "POST")) {
    const text = await request.text();
    if (text.length > 256 * 1024) throw new DurableObjectError("model settings body is too large", 413);
    let body;
    try { body = JSON.parse(text); } catch { throw new DurableObjectError("invalid JSON", 400); }
    return url.pathname.endsWith("/test") ? app.script_agent.test_connection(body) : app.script_agent.save_settings(body);
  }
  if (url.pathname === "/_admin/messages" && request.method === "GET") return app.scripts.list_messages(url);
  if (url.pathname === "/_admin/messages" && request.method === "DELETE") return app.scripts.delete_read_messages(url);
  if (url.pathname === "/_admin/messages/ws" && request.method === "GET") return messages_socket(request, app.scripts);
  if (url.pathname === "/connect") {
    // 特例 1：101 握手。WebSocketPair 的 client 必须原样交给 101 Response。
    const { client } = await app.devices.accept_connection(request);
    return new Response(null, { status: 101, webSocket: client });
  }
  if (url.pathname === "/" && request.method === "GET") {
    return app.devices.summary();
  }
  if (url.pathname === "/_admin/statistics" && request.method === "GET") {
    return app.statistics.snapshot().statistics;
  }
  if (url.pathname === "/_admin/overview" && request.method === "GET") return app.statistics.snapshot();
  if ((url.pathname === "/call" || url.pathname === "/tasks") && request.method === "POST") {
    return app.tasks.create_task(request);
  }
  if (url.pathname === "/invoke" && request.method === "POST") {
    return app.tasks.invoke(request);
  }
  if (url.pathname === "/tasks" && request.method === "GET") {
    return app.tasks.list_tasks(request, url);
  }
  if (url.pathname === "/credits" && request.method === "GET") {
    return app.credit.credit_usage(request);
  }
  const task_match = url.pathname.match(/^\/tasks\/([A-Za-z0-9-]+)$/);
  if (task_match && request.method === "GET") {
    return app.tasks.get_task(request, task_match[1]);
  }
  if (url.pathname === "/_admin/access-tokens" && request.method === "GET") {
    return app.access_tokens.list_access_tokens();
  }
  if (url.pathname === "/_admin/access-tokens" && request.method === "POST") {
    return app.access_tokens.create_access_token(request);
  }
  if (url.pathname === "/_admin/credit-transactions" && request.method === "GET") {
    return app.credit.list_credit_transactions(url);
  }
  if (url.pathname === "/_admin/redemption-campaigns" && request.method === "GET") {
    return app.redemption.list_redemption_campaigns(url);
  }
  if (url.pathname === "/_admin/redemption-campaigns" && request.method === "POST") {
    return app.redemption.create_redemption_campaign(request);
  }
  const redemption_cards_create_match = url.pathname.match(
    /^\/_admin\/redemption-campaigns\/([A-Za-z0-9-]+)\/cards$/,
  );
  if (redemption_cards_create_match && request.method === "POST") {
    return app.redemption.create_redemption_cards(request, redemption_cards_create_match[1]);
  }
  const redemption_card_revoke_match = url.pathname.match(
    /^\/_admin\/redemption-campaigns\/([A-Za-z0-9-]+)\/cards\/([A-Za-z0-9-]+)\/revoke$/,
  );
  if (redemption_card_revoke_match && request.method === "POST") {
    return app.redemption.revoke_redemption_card(
      redemption_card_revoke_match[1],
      redemption_card_revoke_match[2],
    );
  }
  const redemption_campaign_match = url.pathname.match(
    /^\/_admin\/redemption-campaigns\/([A-Za-z0-9-]+)$/,
  );
  if (redemption_campaign_match && request.method === "GET") {
    const limit_value = Number(url.searchParams.get("limit") ?? DEFAULT_REDEMPTION_PAGE_SIZE);
    const offset_value = Number(url.searchParams.get("offset") ?? "0");
    const limit = Number.isFinite(limit_value)
      ? Math.max(1, Math.min(DEFAULT_REDEMPTION_PAGE_SIZE, Math.floor(limit_value)))
      : DEFAULT_REDEMPTION_PAGE_SIZE;
    const offset = Number.isFinite(offset_value)
      ? Math.max(0, Math.min(1_000_000, Math.floor(offset_value)))
      : 0;
    return app.redemption.get_redemption_campaign(redemption_campaign_match[1], limit, offset);
  }
  if (redemption_campaign_match && request.method === "PATCH") {
    return app.redemption.update_redemption_campaign(request, redemption_campaign_match[1]);
  }
  if (url.pathname === "/_reader/credits" && request.method === "GET") {
    return app.credit.reader_credit_overview(request);
  }
  if (url.pathname === "/_reader/credits-history" && request.method === "GET") {
    return app.activity.reader_credit_history(request);
  }
  if (url.pathname === "/_reader/events" && request.method === "GET") {
    return app.activity.reader_events_list(request);
  }
  if (url.pathname === "/_reader/events" && request.method === "POST") {
    return app.activity.reader_events_post(request);
  }
  if (url.pathname === "/_reader/redeem" && request.method === "POST") {
    return app.redemption.redeem_credit_card(request);
  }
  const access_token_credits_match = url.pathname.match(
    /^\/_admin\/access-tokens\/([A-Za-z0-9-]+)\/credits$/,
  );
  if (access_token_credits_match && request.method === "POST") {
    return app.access_tokens.adjust_access_token_credits(request, access_token_credits_match[1]);
  }
  const access_token_match = url.pathname.match(
    /^\/_admin\/access-tokens\/([A-Za-z0-9-]+)$/,
  );
  if (access_token_match && request.method === "DELETE") {
    return app.access_tokens.delete_access_token(access_token_match[1]);
  }
  const access_token_expire_match = url.pathname.match(
    /^\/_admin\/access-tokens\/([A-Za-z0-9-]+)\/expire$/,
  );
  if (access_token_expire_match && request.method === "POST") {
    return app.access_tokens.expire_access_token(access_token_expire_match[1]);
  }
  if (url.pathname === "/_admin/users" && request.method === "GET") {
    return app.users.list_admin_users(url);
  }
  const admin_user_verify_match = url.pathname.match(
    /^\/_admin\/users\/([A-Za-z0-9-]+)\/verify-email$/,
  );
  if (admin_user_verify_match && request.method === "POST") {
    return app.users.admin_verify_user_email(admin_user_verify_match[1]);
  }
  const admin_user_reset_password_match = url.pathname.match(
    /^\/_admin\/users\/([A-Za-z0-9-]+)\/reset-password$/,
  );
  if (admin_user_reset_password_match && request.method === "POST") {
    return app.users.admin_reset_user_password(request, admin_user_reset_password_match[1]);
  }
  const admin_user_activity_match = url.pathname.match(
    /^\/_admin\/users\/([A-Za-z0-9-]+)\/activity$/,
  );
  if (admin_user_activity_match && request.method === "GET") {
    return app.activity.admin_user_activity(admin_user_activity_match[1], url);
  }
  const admin_user_match = url.pathname.match(/^\/_admin\/users\/([A-Za-z0-9-]+)$/);
  if (admin_user_match && request.method === "GET") {
    return app.users.get_admin_user(admin_user_match[1]);
  }
  if (admin_user_match && request.method === "PATCH") {
    return app.users.update_admin_user(request, admin_user_match[1]);
  }
  if (admin_user_match && request.method === "DELETE") {
    return app.users.delete_admin_user(admin_user_match[1]);
  }
  if (url.pathname === "/_admin/discovery/preview-cache" && request.method === "POST") {
    return app.discovery.cache_discovery_preview(await request.json());
  }
  if (url.pathname === "/_admin/discovery/sources" && request.method === "GET") {
    return app.discovery.list_discovery_sources(url, true);
  }
  if (url.pathname === "/_admin/discovery/sources" && request.method === "POST") {
    return app.discovery.create_discovery_source(request);
  }
  if (url.pathname === "/_public/discovery/sources" && request.method === "GET") {
    return app.discovery.list_discovery_sources(url, false);
  }
  if (url.pathname === "/_public/discovery/catalog" && request.method === "GET") {
    return app.discovery.public_catalog();
  }
  // 详情页的公开数据。必须排在下面的 `_admin/.../:id` 与 avatars 之前，但两条正则
  // 前缀不同（`_public` / `_admin`），实际只有可读性上的先后。
  const public_discovery_source_match = url.pathname.match(
    /^\/_public\/discovery\/sources\/([A-Za-z0-9-]+)$/,
  );
  if (public_discovery_source_match && request.method === "GET") {
    return app.discovery.get_public_discovery_source(public_discovery_source_match[1]);
  }
  const discovery_snapshot_match = url.pathname.match(/^\/_admin\/discovery\/sources\/([A-Za-z0-9-]+)\/snapshot$/);
  if (discovery_snapshot_match && request.method === "POST") {
    if (request.headers.get("Prefer") === "respond-async") {
      return new DurableObjectResult({ task: app.discovery.snapshot_task(discovery_snapshot_match[1], request.headers.get("X-Feed-Public-URL")).task }, 202);
    }
    return app.discovery.refresh_discovery_snapshot(discovery_snapshot_match[1], request.headers.get("X-Feed-Public-URL"));
  }
  const discovery_source_avatar_match = url.pathname.match(
    /^\/_admin\/discovery\/sources\/([A-Za-z0-9-]+)\/avatar$/,
  );
  if (discovery_source_avatar_match && request.method === "PUT") {
    return app.discovery.put_discovery_avatar(request, discovery_source_avatar_match[1]);
  }
  if (discovery_source_avatar_match && request.method === "DELETE") {
    return app.discovery.delete_discovery_avatar(discovery_source_avatar_match[1]);
  }
  const public_avatar_match = url.pathname.match(
    /^\/_public\/discovery\/avatars\/([A-Za-z0-9-]+)$/,
  );
  if (public_avatar_match && request.method === "GET") {
    // 特例 2：二进制头像。URL 带 `?v=`（内容一变就换 URL），可安全长缓存；
    // 不能经 json_response，否则会被强制 no-store + application/json。
    const avatar = await app.discovery.get_discovery_avatar(public_avatar_match[1]);
    return new Response(avatar.bytes, {
      headers: {
        "Content-Type": avatar.content_type,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const discovery_source_match = url.pathname.match(
    /^\/_admin\/discovery\/sources\/([A-Za-z0-9-]+)$/,
  );
  if (discovery_source_match && request.method === "PATCH") {
    return app.discovery.update_discovery_source(request, discovery_source_match[1]);
  }
  if (discovery_source_match && request.method === "DELETE") {
    return app.discovery.delete_discovery_source(discovery_source_match[1]);
  }
  if (url.pathname === "/_admin/scripts" && request.method === "GET") {
    return app.scripts.list_scripts(url);
  }
  if (url.pathname === "/_admin/scripts" && request.method === "POST") {
    return app.scripts.create_script(request);
  }
  if (url.pathname === "/_admin/cookies" && request.method === "GET") {
    return { cookies: app.scripts.rss_cookies() };
  }
  if ((url.pathname === "/_admin/cookies" && ["POST", "PATCH", "DELETE"].includes(request.method)) ||
      (url.pathname === "/_admin/cookies/domain" && request.method === "DELETE")) {
    if (Number(request.headers.get("Content-Length") || 0) > 1024 * 1024) return error_response("request body is too large", 413);
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 1024 * 1024) return error_response("request body is too large", 413);
    let body;
    try { body = JSON.parse(text); } catch { return error_response("invalid JSON", 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return error_response("invalid JSON body", 400);
    if (url.pathname === "/_admin/cookies/domain") return app.scripts.delete_rss_cookie_domain(body);
    return app.scripts.edit_rss_cookie(body, request.method);
  }
  if (url.pathname === "/_admin/cookies/update" && request.method === "POST") {
    return app.scripts.update_rss_cookies(request);
  }
  // 测试运行按编辑器内容执行，不再指向已保存记录，故用精确路径放在 :id 路由之前。
  if (url.pathname === "/_admin/scripts/cookie-grants" && request.method === "POST") return app.scripts.approve_cookie_grant(request);
  const cookie_grant_match = url.pathname.match(/^\/_admin\/scripts\/([^/]+)\/cookie-grant$/);
  if (cookie_grant_match && request.method === "DELETE") return app.scripts.revoke_cookie_grant(cookie_grant_match[1]);
  const cookie_permissions_match = url.pathname.match(/^\/_admin\/scripts\/([^/]+)\/cookie-permissions$/);
  if (cookie_permissions_match && request.method === "POST") return app.scripts.check_cookie_permissions(cookie_permissions_match[1]);
  if (url.pathname === "/_admin/scripts/test" && request.method === "POST") {
    return app.scripts.test_script(request);
  }
  if (url.pathname === "/_admin/scripts/debug" && request.method === "POST") {
    return app.scripts.debug_script(request);
  }
  if (url.pathname === "/_admin/scripts/install-preview" && request.method === "POST") {
    return app.scripts.preview_script_install(request);
  }
  const preview_asset_match = url.pathname.match(/^\/_admin\/scripts\/preview-assets\/([a-f0-9-]{36})$/);
  if (preview_asset_match && ["GET", "HEAD"].includes(request.method)) {
    return app.scripts.preview_script_asset(request, preview_asset_match[1]);
  }
  if (url.pathname === "/_admin/scripts/routes" && request.method === "POST") {
    return app.scripts.preview_script_routes(request);
  }
  // 日志按 route query 过滤：route 是 UUID，塞进路径段会与下面的 :id 字符集冲突。
  if (url.pathname === "/_admin/scripts/logs" && request.method === "GET") {
    return app.scripts.list_script_logs(url);
  }
  const script_match = url.pathname.match(/^\/_admin\/scripts\/([a-z0-9/_-]+)$/);
  if (script_match && request.method === "PATCH") {
    return app.scripts.update_script(request, script_match[1]);
  }
  if (script_match && request.method === "DELETE") {
    return app.scripts.delete_script(script_match[1]);
  }
  const rss_route_match = url.pathname.match(/^\/_(?:public|admin)\/feed\/(rss|atom|debug|raw)(\/.*)$/);
  if (rss_route_match && request.method === "GET") {
    // 特例 3：feed 需自定义 Content-Type / Cache-Control，不能经 json_response。
    const feed = await app.scripts.serve_rss_route(
      rss_route_match[1],
      rss_route_match[2],
      request,
    );
    if (rss_route_match[1] === "raw") return feed;
    if (feed.rss_debug) return debug_response({ ...feed.rss_debug, output: feed.body }, 200, feed.headers);
    return new Response(feed.body, { headers: feed.headers });
  }
  if (url.pathname === "/_internal/access-tokens/verify" && request.method === "POST") {
    return app.access_tokens.verify_access_token(request);
  }
  if (url.pathname === "/_reader/auth/login" && request.method === "POST") {
    return app.auth.authenticate_reader(request);
  }
  if (url.pathname === "/_reader/auth/register" && request.method === "POST") {
    return app.auth.register_reader(request);
  }
  if (url.pathname === "/_reader/auth/verify-email" && request.method === "POST") {
    return app.auth.verify_reader_email(request);
  }
  if (url.pathname === "/_reader/auth/resend-verification" && request.method === "POST") {
    return app.auth.resend_reader_verification(request);
  }
  if (url.pathname === "/_internal/reader-session/verify" && request.method === "POST") {
    return app.auth.verify_reader_identity(request);
  }
  const rejected_connection_match = url.pathname.match(
    /^\/_internal\/devices\/([^/]+)\/connection-rejected$/,
  );
  const rejected_connection_device_id = rejected_connection_match
    ? decode_identifier(rejected_connection_match[1])
    : null;
  if (rejected_connection_device_id !== null && request.method === "POST") {
    app.devices.record_device_log(
      rejected_connection_device_id,
      "connection",
      "connection.auth_rejected",
      "设备连接鉴权失败",
      { direction: "inbound", level: "warn" },
    );
    return { recorded: true };
  }
  const device_reset_match = url.pathname.match(/^\/_admin\/devices\/([^/]+)\/reset$/);
  const reset_device_id = device_reset_match
    ? decode_identifier(device_reset_match[1])
    : null;
  if (reset_device_id !== null && request.method === "POST") {
    return app.devices.reset_device(reset_device_id);
  }
  const device_disable_match = url.pathname.match(/^\/_admin\/devices\/([^/]+)\/disable$/);
  const disable_device_id = device_disable_match
    ? decode_identifier(device_disable_match[1])
    : null;
  if (disable_device_id !== null && request.method === "POST") {
    let disabled = true;
    try {
      const body = await request.json();
      if (body !== null && typeof body === "object" && !Array.isArray(body)) {
        disabled = body.disabled === undefined ? true : Boolean(body.disabled);
      }
    } catch {
      disabled = true;
    }
    return app.devices.set_device_disabled(disable_device_id, disabled);
  }
  const device_delete_match = url.pathname.match(/^\/_admin\/devices\/([^/]+)$/);
  const delete_device_id = device_delete_match
    ? decode_identifier(device_delete_match[1])
    : null;
  if (delete_device_id !== null && request.method === "DELETE") {
    return app.devices.delete_device(delete_device_id);
  }
  const device_logs_match = url.pathname.match(/^\/_admin\/devices\/([^/]+)\/logs$/);
  const logs_device_id = device_logs_match
    ? decode_identifier(device_logs_match[1])
    : null;
  if (logs_device_id !== null && request.method === "GET") {
    return app.devices.list_device_logs(url, logs_device_id);
  }
  return error_response("not found", 404);
}
