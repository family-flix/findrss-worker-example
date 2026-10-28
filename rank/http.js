import { rank_style_hash, render_rank_home } from "../server/infra/rank_home.js";
import { secure_site_response } from "../server/lib/site_security.js";
import { rank_query_state } from "./model.js";
import { RANK_HOME_ORIGIN } from "./home.js";

export function create_rank_handler(read_snapshot, version) {
  return async function handle_rank_request(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/rank" && ["GET", "HEAD"].includes(request.method)) {
      url.pathname = "/rank/";
      return Response.redirect(url.href, 302);
    }
    if (!["/rank/", "/rank/index.html"].includes(url.pathname)) {
      return secure_site_response(await env.ASSETS.fetch(request), "discovery");
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    const style_hash = await rank_style_hash();
    const cache_url = new URL("/rank/", url.origin);
    const filters = new URLSearchParams(rank_query_state(url.searchParams));
    filters.forEach((value, key) => cache_url.searchParams.set(key, value));
    cache_url.searchParams.set("version", version);
    cache_url.searchParams.set("styles", style_hash);
    cache_url.searchParams.set("format", "rank-home-v1");
    const cache = globalThis.caches?.default;
    let html, key, response_style_hash = style_hash, status = 200;
    try {
      const snapshot = await read_snapshot(env);
      if (!snapshot?.html || !snapshot.version || !snapshot.style_hash) throw new Error("排行榜页面快照不可用");
      cache_url.searchParams.set("snapshot", snapshot.version);
      key = new Request(cache_url);
      const cached = await cache?.match(key).catch(() => null);
      if (cached) return request.method === "HEAD" ? new Response(null, cached) : cached;
      if ([...filters.values()].some(Boolean)) {
        const bootstrap = /<script id="rank-catalog"[^>]*>([^]*?)<\/script>/.exec(snapshot.html);
        if (!bootstrap) throw new Error("排行榜页面缺少初始化数据");
        html = render_rank_home(JSON.parse(bootstrap[1]), url.origin, filters);
      } else {
        html = snapshot.html.replace(`href="${RANK_HOME_ORIGIN}/rank/"`, () => `href="${url.origin}/rank/"`);
        response_style_hash = snapshot.style_hash;
      }
    } catch {
      status = 503;
      html = render_rank_home({ boards: [{ id: "unavailable", title: "排行榜", entries: [],
        error: "排行榜快照尚未生成或暂不可用，请稍后重试" }] }, url.origin);
    }
    const response = secure_site_response(new Response(html, {
      status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": status === 200 ? "public, max-age=0, s-maxage=60" : "no-store" },
    }), "discovery", response_style_hash);
    if (status === 200) await cache?.put(key, response.clone()).catch(() => {});
    return request.method === "HEAD" ? new Response(null, response) : response;
  };
}
