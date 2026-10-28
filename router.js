// Route both websites and API without exposing internal DO routes.
import { MCP_OAUTH_PATHS } from "./server/service/worker/mcp_oauth.js";
import { error_response } from "./server/lib/http.js";
import { admin_hot_snapshot } from "./server/service/worker/hot_snapshot.js";

export function create_worker({ api, admin, discovery, rank, rank_snapshot }) {
  return {
    async scheduled(controller, env) {
      await rank_snapshot?.(env);
    },
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      const path = url.pathname;
      env = {
        ...env,
        FINDRSS_HOSTNAME:
          String(env.FINDRSS_HOSTNAME ?? "").trim() ||
          String(env.FEED_HOSTNAME ?? "").trim() ||
          url.origin,
      };
      const api_fetch = (input, init) => {
        const forwarded = new Request(input, init);
        if (new URL(forwarded.url).pathname === "/admin/api/hot/snapshot") {
          return admin_hot_snapshot(forwarded, env);
        }
        return api.fetch(forwarded, env, ctx);
      };
      if (rank && (path === "/rank" || path.startsWith("/rank/"))) {
        return rank(request, env);
      }
      if (path === "/admin") {
        url.pathname = "/admin/";
        return Response.redirect(url.href, 302);
      }
      if (path.startsWith("/admin/")) {
        if (path === "/admin/api" || path.startsWith("/admin/api/")) {
          try {
            if (request.headers.has("Authorization")) {
              return await api_fetch(request);
            }
            return await admin(request, env, api_fetch);
          } catch (error) {
            console.error(
              "Admin API request failed",
              request.method,
              path,
              error,
            );
            return error_response("internal server error", 500);
          }
        }
        return admin(request, env, api_fetch);
      }
      if (
        path === "/health" ||
        path === "/mcp" ||
        MCP_OAUTH_PATHS.includes(path) ||
        path === "/v1" ||
        path.startsWith("/v1/") ||
        path.startsWith("/reader/") ||
        path.startsWith("/discovery/") ||
        path === "/public" ||
        path.startsWith("/public/") ||
        path.startsWith("/clips/") ||
        path === "/api/cookies/update" ||
        path === "/api/detect" ||
        path.startsWith("/api/detect/") ||
        path === "/api/clip" ||
        path.startsWith("/api/clip/") ||
        path === "/api/hot" ||
        path.startsWith("/api/hot/") ||
        path.startsWith("/rss/") ||
        path.startsWith("/atom/") ||
        path.startsWith("/debug/") ||
        path === "/findrss-logo.png" ||
        path === "/wxmpimgproxy"
      ) {
        return api.fetch(request, env, ctx);
      }
      if (path.startsWith("/_internal/") || path.startsWith("/_admin/")) {
        return new Response("Not Found", { status: 404 });
      }
      if (path === "/") {
        url.pathname = "/index.html";
      }
      // Discovery owns public pages and /api/{catalog,sources,search,preview,avatar}.
      const page = await discovery(new Request(url, request), env, api_fetch);
      if (
        page.status === 404 &&
        ["GET", "HEAD"].includes(request.method) &&
        !path.startsWith("/api/") &&
        !path.startsWith("/_")
      ) {
        return api.fetch(request, env, ctx);
      }
      return page;
    },
  };
}
