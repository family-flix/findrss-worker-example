import { FINDRSS_LOGO_PNG } from "./server/lib/brand.js";
import { public_script_route } from "./server/service/worker/script_route.js";
import { api_mcp } from "./server/service/worker/mcp.js";
import { api_mcp_oauth, MCP_OAUTH_PATHS } from "./server/service/worker/mcp_oauth.js";
// 该文件与 Application 是同级的 composition root——允许 import 任意层。
import { bearer_token, error_response, json_response } from "./server/lib/http.js";
import { decode_identifier, valid_identifier } from "./server/lib/identifiers.js";
import { admin_auth_required, admin_authorized } from "./server/service/worker/auth.js";
import { admin_access_token_request, admin_cookie_request, admin_create_call, admin_credit_transactions, admin_device_action, admin_device_logs, admin_discovery_source_request, admin_overview, admin_management_overview, admin_redemption_campaign_request, admin_reset_device, admin_script_request, admin_script_asset_request, admin_task_status, admin_user_request } from "./server/service/worker/application_proxy.js";
import { admin_discovery_preview, public_discovery_avatar, public_discovery_catalog, public_discovery_source, public_discovery_sources } from "./server/service/worker/discovery.js";
import { public_rss_route } from "./server/service/worker/rss.js";
import { admin_network_test, admin_network_cookie_domains } from "./server/service/worker/network_test.js";
import { admin_storage_request } from "./server/service/worker/storage.js";
import { public_asset_request } from "./server/service/worker/public_assets.js";
import { public_clip_request, admin_clip_request } from "./server/service/worker/clips.js";

/** @type {ExportedHandler<Env>} */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const clip_match = url.pathname.match(/^\/clips\/([a-f0-9-]{36})$/);
    if (clip_match) return public_clip_request(request, env, clip_match[1]);
    if (url.pathname === "/public" || url.pathname.startsWith("/public/")) return public_asset_request(request, env, ctx);
    // 兼容已发布的管理客户端；内部与前端统一使用 /scripts。
    url.pathname = url.pathname.replace(/^\/admin\/api\/rss-scripts(?=\/|$)/, "/admin/api/scripts");
    if (url.pathname === "/findrss-logo.png" && ["GET", "HEAD"].includes(request.method)) {
      return new Response(request.method === "HEAD" ? null : FINDRSS_LOGO_PNG, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400",
          "X-Content-Type-Options": "nosniff"
        }
      });
    }
    if (url.pathname === "/api/cookies/update") {
      if (request.method !== "POST") return error_response("method not allowed", 405);
      return admin_cookie_request(env, request);
    }
    if (url.pathname === "/mcp") return api_mcp(request, env);
    if (MCP_OAUTH_PATHS.includes(url.pathname)) return api_mcp_oauth(request, env);
    if (url.pathname === "/health" && request.method === "GET") {
      return json_response({
        ok: true
      });
    }
    const is_admin_route = url.pathname === "/admin" || url.pathname.startsWith("/admin/");
    if (is_admin_route) {
      if (!admin_authorized(request, env)) {
        return admin_auth_required();
      }
      if (url.pathname === "/admin/api/events/ws" && request.method === "GET") {
        if (request.headers.has("Origin") && request.headers.get("Origin") !== url.origin) return error_response("origin rejected", 403);
        return env.APPLICATION.fetch(new Request("https://internal/_admin/events/ws", request));
      }
      if (/^\/admin\/api\/detections(?:\/[a-f0-9-]{36}(?:\/(?:run|reset|runs(?:\/[a-f0-9-]{36})?))?)?$/.test(url.pathname)) {
        return admin_clip_request(request, env);
      }
      if (/^\/admin\/api\/clips(?:\/[a-f0-9-]{36}(?:\/snapshot)?)?$/.test(url.pathname)) {
        return admin_clip_request(request, env);
      }
      if (/^\/admin\/api\/background-tasks(?:\/[A-Za-z0-9-]+\/cancel)?$/.test(url.pathname)) {
        const internal_url = new URL("https://internal" + url.pathname.replace("/admin/api/", "/_admin/"));
        internal_url.search = url.search;
        return env.APPLICATION.fetch(new Request(internal_url, request));
      }
      if (["/admin/api/storage", "/admin/api/storage/usage", "/admin/api/storage/file"].includes(url.pathname)) {
        return admin_storage_request(request, env);
      }
      if (url.pathname === "/admin/api/network-test") return admin_network_test(request, env);
      if (url.pathname === "/admin/api/network-test/curl") return admin_network_test(request, env, true);
      if (url.pathname === "/admin/api/network-test/cookie-domains") {
        if (request.method !== "GET") return error_response("method not allowed", 405, {
          Allow: "GET"
        });
        return admin_network_cookie_domains(env);
      }
      if (["/admin/api/messages", "/admin/api/messages/ws"].includes(url.pathname) && request.method === "GET" || url.pathname === "/admin/api/messages" && request.method === "DELETE") {
        if (url.pathname.endsWith("/ws") && !request.headers.get("Authorization")?.startsWith("Bearer ") && request.headers.has("Origin") && request.headers.get("Origin") !== url.origin) {
          return error_response("origin rejected", 403);
        }
        const internal_url = new URL("https://internal" + url.pathname.replace("/admin/api/", "/_admin/"));
        internal_url.search = url.search;
        return env.APPLICATION.fetch(new Request(internal_url, request));
      }
      if (url.pathname === "/admin/api/agent/ws" && request.method === "GET") {
        if (request.headers.has("Origin") && request.headers.get("Origin") !== url.origin) return error_response("origin rejected", 403);
        return env.APPLICATION.fetch(new Request("https://internal/_admin/agent/ws", request));
      }
      if (url.pathname === "/admin/api/scripts/agent/ws" && request.method === "GET") {
        if (request.headers.has("Origin") && request.headers.get("Origin") !== url.origin) return error_response("origin rejected", 403);
        return admin_script_request(env, request, "/agent/ws");
      }
      if (url.pathname === "/admin/api/scripts/agent/settings" && ["GET", "PUT"].includes(request.method)) {
        return admin_script_request(env, request, "/agent/settings");
      }
      if (url.pathname === "/admin/api/scripts/agent/test" && request.method === "POST") {
        return admin_script_request(env, request, "/agent/test");
      }
      if (url.pathname === "/admin/api/overview" && request.method === "GET") {
        return admin_overview(env);
      }
      if (url.pathname === "/admin/api/management-overview" && request.method === "GET") {
        return admin_management_overview(env);
      }
      if (["/admin/api/settings/snapshots", "/admin/api/settings/cookies", "/admin/api/settings/webhook"].includes(url.pathname) && ["GET", "PUT"].includes(request.method)) {
        return env.APPLICATION.fetch(new Request("https://internal" + url.pathname.replace("/admin/api/", "/_admin/"), request));
      }
      if (/^\/admin\/api\/mcp-tokens(?:\/[A-Za-z0-9-]+\/(?:revoke|calls))?$/.test(url.pathname) || /^\/admin\/api\/mcp-oauth\/requests\/[A-Za-z0-9_-]+(?:\/decision)?$/.test(url.pathname)) {
        if (request.method !== "GET" && request.headers.has("Origin") && request.headers.get("Origin") !== url.origin) return error_response("origin rejected", 403);
        const forwarded = new Request("https://internal" + url.pathname.replace("/admin/api/", "/_admin/"), request);
        // Derived from the authenticated admin URL; never accept a resource supplied by the client.
        forwarded.headers.set("X-MCP-Resource", new URL("/mcp", request.url).href);
        return env.APPLICATION.fetch(forwarded);
      }
      if (/^\/admin\/api\/device-tokens(?:\/[A-Za-z0-9-]+(?:\/(?:reveal|revoke))?)?$/.test(url.pathname)) {
        return env.APPLICATION.fetch(new Request("https://internal" + url.pathname.replace("/admin/api/", "/_admin/"), request));
      }
      if (url.pathname === "/admin/api/call" && request.method === "POST") {
        return admin_create_call(env, request);
      }
      if (url.pathname === "/admin/api/access-tokens") {
        if (request.method !== "GET" && request.method !== "POST") {
          return error_response("method not allowed", 405);
        }
        return admin_access_token_request(env, request, "");
      }
      if (url.pathname === "/admin/api/discovery/preview" && request.method === "POST") {
        return admin_discovery_preview(env, request);
      }
      if (url.pathname === "/admin/api/discovery/sources" && request.method === "GET") {
        return admin_discovery_source_request(env, request);
      }
      if (url.pathname === "/admin/api/discovery/sources" && request.method === "POST") {
        return admin_discovery_source_request(env, request);
      }
      if (url.pathname === "/admin/api/discovery/sources/recover-overdue") {
        if (request.method !== "POST") return error_response("method not allowed", 405);
        return admin_discovery_source_request(env, request, "/recover-overdue");
      }
      const admin_discovery_snapshot_match = url.pathname.match(/^\/admin\/api\/discovery\/sources\/([A-Za-z0-9-]+)\/snapshot$/);
      if (admin_discovery_snapshot_match && request.method === "POST") {
        return admin_discovery_source_request(env, request, "/" + admin_discovery_snapshot_match[1] + "/snapshot");
      }
      const admin_discovery_source_match = url.pathname.match(/^\/admin\/api\/discovery\/sources\/([A-Za-z0-9-]+)$/);
      if (admin_discovery_source_match && request.method === "PATCH") {
        return admin_discovery_source_request(env, request, "/" + admin_discovery_source_match[1]);
      }
      if (admin_discovery_source_match && request.method === "DELETE") {
        return admin_discovery_source_request(env, request, "/" + admin_discovery_source_match[1]);
      }
      // 头像上传是二进制 body：复用同一个转发（它把 method/body 原样带过去），
      // 外层的 JSON 后处理对二进制响应会因 clone().json() 失败而原样返回。
      const admin_discovery_avatar_match = url.pathname.match(/^\/admin\/api\/discovery\/sources\/([A-Za-z0-9-]+)\/avatar$/);
      if (admin_discovery_avatar_match && request.method === "PUT") {
        return admin_discovery_source_request(env, request, "/" + admin_discovery_avatar_match[1] + "/avatar");
      }
      if (admin_discovery_avatar_match && request.method === "DELETE") {
        return admin_discovery_source_request(env, request, "/" + admin_discovery_avatar_match[1] + "/avatar");
      }
      if (url.pathname === "/admin/api/credit-transactions" && request.method === "GET") {
        return admin_credit_transactions(env, request);
      }
      if (url.pathname === "/admin/api/redemption-campaigns" && request.method === "GET") {
        return admin_redemption_campaign_request(env, request);
      }
      if (url.pathname === "/admin/api/redemption-campaigns" && request.method === "POST") {
        return admin_redemption_campaign_request(env, request);
      }
      const admin_redemption_cards_create_match = url.pathname.match(/^\/admin\/api\/redemption-campaigns\/([A-Za-z0-9-]+)\/cards$/);
      if (admin_redemption_cards_create_match && request.method === "POST") {
        return admin_redemption_campaign_request(env, request, "/" + admin_redemption_cards_create_match[1] + "/cards");
      }
      const admin_redemption_card_revoke_match = url.pathname.match(/^\/admin\/api\/redemption-campaigns\/([A-Za-z0-9-]+)\/cards\/([A-Za-z0-9-]+)\/revoke$/);
      if (admin_redemption_card_revoke_match && request.method === "POST") {
        return admin_redemption_campaign_request(env, request, "/" + admin_redemption_card_revoke_match[1] + "/cards/" + admin_redemption_card_revoke_match[2] + "/revoke");
      }
      const admin_redemption_campaign_match = url.pathname.match(/^\/admin\/api\/redemption-campaigns\/([A-Za-z0-9-]+)$/);
      if (admin_redemption_campaign_match && (request.method === "GET" || request.method === "PATCH")) {
        return admin_redemption_campaign_request(env, request, "/" + admin_redemption_campaign_match[1]);
      }
      if (url.pathname === "/admin/api/scripts" && (request.method === "GET" || request.method === "POST")) {
        return admin_script_request(env, request);
      }
      if (url.pathname === "/admin/api/cookies" && request.method === "GET") {
        return admin_cookie_request(env, request, "");
      }
      if (url.pathname === "/admin/api/cookies" && ["POST", "PATCH", "DELETE"].includes(request.method)) {
        return admin_cookie_request(env, request, "");
      }
      if (url.pathname === "/admin/api/cookies/domain" && request.method === "DELETE") {
        return admin_cookie_request(env, request, "/domain");
      }
      if (url.pathname === "/admin/api/cookies/update" && request.method === "POST") {
        return admin_cookie_request(env, request);
      }
      if (url.pathname === "/admin/api/scripts/cookie-grants" && request.method === "POST") {
        return admin_script_request(env, request, "/cookie-grants");
      }
      if (url.pathname === "/admin/api/scripts/test" && request.method === "POST") {
        return admin_script_request(env, request, "/test");
      }
      if (url.pathname === "/admin/api/scripts/debug" && request.method === "POST") {
        return admin_script_request(env, request, "/debug");
      }
      if (url.pathname === "/admin/api/scripts/install-preview" && request.method === "POST") {
        return admin_script_request(env, request, "/install-preview");
      }
      const preview_asset_match = url.pathname.match(/^\/admin\/api\/scripts\/preview-assets\/([a-f0-9-]{36})$/);
      if (preview_asset_match && ["GET", "HEAD"].includes(request.method)) {
        return admin_script_asset_request(env, request, preview_asset_match[1]);
      }
      if (url.pathname === "/admin/api/scripts/routes" && request.method === "POST") {
        return admin_script_request(env, request, "/routes");
      }
      if (url.pathname === "/admin/api/scripts/logs" && request.method === "GET") {
        return admin_script_request(env, request, "/logs");
      }
      const admin_cookie_permissions_match = url.pathname.match(/^\/admin\/api\/scripts\/([^/]+)\/cookie-permissions$/);
      if (admin_cookie_permissions_match && request.method === "POST") {
        return admin_script_request(env, request, "/" + admin_cookie_permissions_match[1] + "/cookie-permissions");
      }
      const admin_script_match = url.pathname.match(/^\/admin\/api\/scripts\/([a-z0-9/_-]+)$/);
      if (admin_script_match && (request.method === "GET" || request.method === "PATCH" || request.method === "DELETE")) {
        return admin_script_request(env, request, "/" + admin_script_match[1]);
      }
      const script_versions_match = url.pathname.match(/^\/admin\/api\/scripts\/([^/]+)\/(versions(?:\/[^/]+)?|rollback)$/);
      if (script_versions_match && (request.method === "GET" && script_versions_match[2].startsWith("versions") || request.method === "POST" && script_versions_match[2] === "rollback")) {
        return admin_script_request(env, request, "/" + script_versions_match[1] + "/" + script_versions_match[2]);
      }
      const admin_access_token_credits_match = url.pathname.match(/^\/admin\/api\/access-tokens\/([A-Za-z0-9-]+)\/credits$/);
      if (admin_access_token_credits_match !== null && request.method === "POST") {
        return admin_access_token_request(env, request, "/" + admin_access_token_credits_match[1] + "/credits");
      }
      const admin_access_token_expire_match = url.pathname.match(/^\/admin\/api\/access-tokens\/([A-Za-z0-9-]+)\/expire$/);
      if (admin_access_token_expire_match !== null && request.method === "POST") {
        return admin_access_token_request(env, request, "/" + admin_access_token_expire_match[1] + "/expire");
      }
      const admin_access_token_match = url.pathname.match(/^\/admin\/api\/access-tokens\/([A-Za-z0-9-]+)$/);
      if (admin_access_token_match !== null && request.method === "DELETE") {
        return admin_access_token_request(env, request, "/" + admin_access_token_match[1]);
      }
      if (url.pathname === "/admin/api/users" && request.method === "GET") {
        return admin_user_request(env, request, "");
      }
      const admin_user_verify_match = url.pathname.match(/^\/admin\/api\/users\/([A-Za-z0-9-]+)\/verify-email$/);
      if (admin_user_verify_match !== null && request.method === "POST") {
        return admin_user_request(env, request, "/" + admin_user_verify_match[1] + "/verify-email");
      }
      const admin_user_reset_password_match = url.pathname.match(/^\/admin\/api\/users\/([A-Za-z0-9-]+)\/reset-password$/);
      if (admin_user_reset_password_match !== null && request.method === "POST") {
        return admin_user_request(env, request, "/" + admin_user_reset_password_match[1] + "/reset-password");
      }
      const admin_user_activity_match = url.pathname.match(/^\/admin\/api\/users\/([A-Za-z0-9-]+)\/activity$/);
      if (admin_user_activity_match !== null && request.method === "GET") {
        return admin_user_request(env, request, "/" + admin_user_activity_match[1] + "/activity");
      }
      const admin_user_match = url.pathname.match(/^\/admin\/api\/users\/([A-Za-z0-9-]+)$/);
      if (admin_user_match !== null && (request.method === "GET" || request.method === "PATCH" || request.method === "DELETE")) {
        return admin_user_request(env, request, "/" + admin_user_match[1]);
      }
      const admin_task_match = url.pathname.match(/^\/admin\/api\/tasks\/([^/]+)$/);
      if (admin_task_match !== null && request.method === "GET") {
        return admin_task_status(env, admin_task_match[1]);
      }
      const admin_device_reset_match = url.pathname.match(/^\/admin\/api\/devices\/([^/]+)\/reset$/);
      const reset_device_id = admin_device_reset_match ? decode_identifier(admin_device_reset_match[1]) : null;
      if (reset_device_id !== null && request.method === "POST") {
        return admin_reset_device(env, request, reset_device_id);
      }
      const admin_device_disable_match = url.pathname.match(/^\/admin\/api\/devices\/([^/]+)\/disable$/);
      const disable_device_id = admin_device_disable_match ? decode_identifier(admin_device_disable_match[1]) : null;
      if (disable_device_id !== null && request.method === "POST") {
        return admin_device_action(env, request, disable_device_id, "/disable");
      }
      const admin_device_match = url.pathname.match(/^\/admin\/api\/devices\/([^/]+)$/);
      const delete_device_id = admin_device_match ? decode_identifier(admin_device_match[1]) : null;
      if (delete_device_id !== null && request.method === "DELETE") {
        return admin_device_action(env, request, delete_device_id, "");
      }
      const admin_device_logs_match = url.pathname.match(/^\/admin\/api\/devices\/([^/]+)\/logs$/);
      const logs_device_id = admin_device_logs_match ? decode_identifier(admin_device_logs_match[1]) : null;
      if (logs_device_id !== null && request.method === "GET") {
        return admin_device_logs(env, request, logs_device_id);
      }
      return error_response("not found", 404);
    }
    if (url.pathname === "/discovery/sources" && request.method === "GET") {
      return public_discovery_sources(env, request);
    }
    if (url.pathname === "/discovery/catalog" && request.method === "GET") {
      return public_discovery_catalog(env);
    }
    const public_discovery_source_match = url.pathname.match(/^\/discovery\/sources\/([A-Za-z0-9-]+)$/);
    if (public_discovery_source_match && request.method === "GET") {
      return public_discovery_source(env, public_discovery_source_match[1]);
    }
    const public_discovery_avatar_match = url.pathname.match(/^\/discovery\/avatars\/([A-Za-z0-9-]+)$/);
    if (public_discovery_avatar_match && request.method === "GET") {
      return public_discovery_avatar(env, public_discovery_avatar_match[1]);
    }
    if (url.pathname === "/api/detect" || url.pathname.startsWith("/api/detect/")) {
      if (!["GET", "HEAD"].includes(request.method)) return error_response("method not allowed", 405);
      return public_script_route(env, request, url.pathname.slice(11) || "/", "detect");
    }
    if (url.pathname === "/api/clip" || url.pathname.startsWith("/api/clip/")) {
      if (!["GET", "HEAD"].includes(request.method)) return error_response("method not allowed", 405);
      return public_script_route(env, request, url.pathname.slice(9) || "/", "clip");
    }
    if (url.pathname === "/api/hot" || url.pathname.startsWith("/api/hot/")) {
      if (!["GET", "HEAD"].includes(request.method)) return error_response("method not allowed", 405);
      return public_script_route(env, request, url.pathname.slice(8) || "/", "hot");
    }
    const public_rss_match = url.pathname.match(/^\/(rss|atom|debug)(\/.*)$/);
    if (public_rss_match && request.method === "GET") {
      return public_rss_route(env, request, public_rss_match[2], public_rss_match[1]);
    }
    let forwarded_path = "";
    if (url.pathname === "/v1") {
      forwarded_path = "/";
    } else if (url.pathname.startsWith("/v1/")) {
      forwarded_path = url.pathname.slice(3);
    } else {
      if (["GET", "HEAD"].includes(request.method)) return public_script_route(env, request);
      return error_response("not found", 404);
    }
    if (/^\/_(?:admin|internal|reader|public)(?:\/|$)/.test(forwarded_path)) {
      return error_response("not found", 404);
    }
    const forwarded_url = new URL(request.url);
    forwarded_url.pathname = forwarded_path;
    const object = env.APPLICATION;
    const token = bearer_token(request);
    const device_id = request.headers.get("X-Api-Device-ID")?.trim() ?? "";
    let device_token_id = "";
    if (valid_identifier(device_id)) {
      const verified = await object.fetch("https://internal/_internal/device-tokens/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          token
        })
      });
      if (verified.ok) device_token_id = String((await verified.json()).device_token?.id || "");
    }
    const device_authorized = Boolean(device_token_id);
    if (forwarded_path === "/connect" && !device_authorized) {
      if (valid_identifier(device_id)) {
        await object.fetch("https://internal/_internal/devices/" + device_id + "/connection-rejected", {
          method: "POST"
        });
      }
      return error_response("unauthorized", 401);
    }
    if (device_authorized) {
      const headers = new Headers(request.headers);
      headers.delete("X-Api-Publisher-ID");
      headers.delete("X-Api-Authenticated-Publisher-ID");
      headers.delete("X-Api-Access-Token-ID");
      headers.set("X-Api-Device-Token-ID", device_token_id);
      headers.set("X-Api-Authenticated-Publisher-ID", device_id);
      return object.fetch(new Request(forwarded_url, new Request(request, {
        headers
      })));
    }
    const authorization_response = await object.fetch("https://internal/_internal/access-tokens/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        token
      })
    });
    if (!authorization_response.ok) {
      return error_response("unauthorized", 401);
    }
    /** @type {{ access_token?: { id?: string, name?: string, publisher_id?: string } }} */
    const authorization = await authorization_response.json();
    const publisher_id = String(authorization.access_token?.publisher_id ?? "");
    if (!valid_identifier(publisher_id)) {
      return error_response("unauthorized", 401);
    }
    const headers = new Headers(request.headers);
    headers.delete("X-Api-Publisher-ID");
    headers.delete("X-Api-Authenticated-Publisher-ID");
    headers.delete("X-Api-Device-ID");
    headers.delete("X-Api-Access-Token-ID");
    headers.delete("X-Api-Device-Token-ID");
    headers.set("X-Api-Authenticated-Publisher-ID", publisher_id);
    headers.set("X-Api-Access-Token-ID", String(authorization.access_token?.id ?? ""));
    return object.fetch(new Request(forwarded_url, new Request(request, {
      headers
    })));
  }
};
