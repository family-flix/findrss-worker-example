import { secure_site_response } from "./server/lib/site_security.js";
// Public site HTTP routes share the main Worker with the API.
import {
  is_public_feed_url,
  preview_byte_limit,
  preview_via_api,
  search_query_max_length,
  upstream_timeout_ms,
} from "./server/lib/discovery_feeds.js";
import { managed_source_result } from "./server/lib/discovery_sources.js";
import {
  DISCOVERY_ASSETS_VERSION,
  discovery_style_hash,
  inline_home_styles,
  render_embedded_home,
} from "./server/infra/discovery_home.js";
import { create_api_object_store } from "./server/infra/object_store.js";
import {
  DISCOVERY_CATALOG_KEY,
  DISCOVERY_CATALOG_ORIGIN,
} from "./server/lib/discovery_catalog.js";
import {
  feed_hostname_origin,
  resolve_discovery_source_feed_urls,
} from "./server/service/worker/discovery.js";
import {
  accepts_gzip,
  stored_html,
} from "./server/infra/discovery_compression.js";

async function catalog_response(env, api_fetch) {
  if (!api_fetch)
    return json_response({ error: "API handler is not configured" }, 503);
  const response = await api_fetch("https://api/discovery/catalog");
  return resolve_discovery_source_feed_urls(
    response,
    feed_hostname_origin(env),
    false,
  );
}

async function home_page(request, env, api_fetch) {
  const url = new URL(request.url);
  const origin = new URL(feed_hostname_origin(env) || url.origin).origin;
  const cache_url = new URL("/index.html", url.origin);
  cache_url.searchParams.set("feed_origin", origin);
  cache_url.searchParams.set("runtime", "0.34.2");
  cache_url.searchParams.set("assets", DISCOVERY_ASSETS_VERSION);
  cache_url.searchParams.set("compression", "v2");
  const cache = globalThis.caches?.default;
  try {
    cache_url.searchParams.set("styles", await discovery_style_hash());
    const cache_request = new Request(cache_url);
    const cached = await cache?.match(cache_request).catch(() => null);
    if (cached)
      return request.method === "HEAD" ? new Response(null, cached) : cached;
    const store = create_api_object_store(env);
    let html = store
      ? await stored_html(await store.get(DISCOVERY_CATALOG_KEY))
      : "";
    if (html) {
      html = html
        .replaceAll(DISCOVERY_CATALOG_ORIGIN, origin)
        .replaceAll("/assets/timeless/0.34.0/", "/assets/timeless/0.34.2/");
      if (!html.includes(`name="discovery-embedded-assets" content="${DISCOVERY_ASSETS_VERSION}"`)) {
        const bootstrap =
          /<script data-n="discovery-catalog" type="application\/json">([^]*?)<\/script>/.exec(
            html,
          );
        if (bootstrap)
          html = render_embedded_home(JSON.parse(bootstrap[1]), origin);
      }
    } else {
      const response = await catalog_response(
        { ...env, FINDRSS_HOSTNAME: origin },
        api_fetch,
      );
      if (!response.ok) {
        const headers = new Headers(response.headers);
        headers.set("Cache-Control", "no-store");
        return new Response(request.method === "HEAD" ? null : response.body, {
          status: response.status,
          headers,
        });
      }
      html = render_embedded_home(await response.json(), origin);
    }
    html = inline_home_styles(html);
    const response = new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=0, s-maxage=60",
        Vary: "Accept-Encoding",
      },
    });
    await cache
      ?.put(cache_request, response.clone())
      .catch((error) =>
        console.warn("discovery home cache write failed", error.message),
      );
    return request.method === "HEAD" ? new Response(null, response) : response;
  } catch (error) {
    console.warn("discovery home read failed", error.message);
    return json_response({ error: "订阅广场暂时不可用，请稍后重试" }, 503);
  }
}

/**
 * @param {unknown} payload
 * @param {number} status
 * @returns {Response}
 */
function json_response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Cache-Control": status === 200 ? "public, max-age=300" : "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

/** @param {string} message */
function api_error(message) {
  return json_response({ error: message }, 400);
}

/**
 * @param {Object} env
 * @param {URL} source_url
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function managed_sources(env, source_url, api_fetch) {
  if (!api_fetch) return [];
  const internal_url = new URL("https://api/discovery/sources");
  for (const key of ["q", "category", "source_type", "tag"]) {
    for (const value of source_url.searchParams.getAll(key)) {
      if (value) internal_url.searchParams.append(key, value);
    }
  }
  const response = await api_fetch(internal_url);
  if (!response.ok) return [];
  const payload = await response.json().catch(() => ({}));
  const sources = Array.isArray(payload?.sources) ? payload.sources : [];
  return sources
    .map(managed_source_result)
    .filter((item) => is_public_feed_url(String(item.feed_url)));
}

/** @param {Request} request @param {Object} env */
async function search_feeds(request, env, api_fetch) {
  const source_url = new URL(request.url);
  const query =
    source_url.searchParams
      .get("q")
      ?.trim()
      .slice(0, search_query_max_length) || "";
  if (query.length < 1) {
    return api_error("请输入搜索关键词");
  }
  source_url.searchParams.set("q", query);
  const results = await managed_sources(env, source_url, api_fetch);
  if (results.length === 0) {
    return json_response({ error: "没有找到匹配的订阅源" }, 404);
  }
  return json_response({ query, results });
}

/**
 * 订阅源头像：`avatar_url` 是站内相对路径 `/api/avatar/<id>?v=`，这里按同源路径转发给
 * API 的公开端点。响应是图片二进制，原样返回（套 json_response 会把它变成 JSON）。
 * @param {Request} request
 * @param {Object} env
 */
async function avatar_source(request, env, api_fetch) {
  if (!api_fetch) {
    return json_response({ error: "avatar not found" }, 404);
  }
  const url = new URL(request.url);
  const source_id = url.pathname.slice("/api/avatar/".length);
  return api_fetch(
    new URL("https://api/discovery/avatars/" + source_id + url.search),
  );
}

/** @param {Request} request @param {Object} env */
async function list_sources(request, env, api_fetch) {
  if (!api_fetch) {
    return json_response({
      sources: [],
      tags: [],
      total_count: 0,
      limit: 20,
      offset: 0,
      has_more: false,
    });
  }
  const source_url = new URL(request.url);
  const internal_url = new URL("https://api/discovery/sources");
  internal_url.searchParams.set(
    "limit",
    source_url.searchParams.get("limit") ?? "20",
  );
  internal_url.searchParams.set(
    "offset",
    source_url.searchParams.get("offset") ?? "0",
  );
  for (const key of ["q", "category", "source_type", "tag"]) {
    for (const value of source_url.searchParams.getAll(key)) {
      if (value) internal_url.searchParams.append(key, value);
    }
  }
  return api_fetch(internal_url);
}

/** @param {Request} request @param {Object} env */
async function preview_feed(request, env, api_fetch) {
  const request_url = new URL(request.url);
  const feed_url = request_url.searchParams.get("url") || "";
  const headers = {
    Accept:
      "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1",
    "User-Agent": "findrss-worker/discover/1.0",
  };
  let target = null;
  try {
    target = new URL(feed_url);
  } catch {}
  let response;
  if (api_fetch && target !== null && preview_via_api(target, request_url)) {
    response = await api_fetch(
      new Request("https://api" + target.pathname + target.search, { headers }),
    ).catch(() => null);
    if (response === null) {
      return json_response({ error: "订阅源读取失败" }, 502);
    }
    if (!response.ok) {
      return response;
    }
  } else {
    if (!is_public_feed_url(feed_url)) {
      return api_error("只支持公网 HTTP(S) RSS/Atom 地址");
    }
    response = await fetch(feed_url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(upstream_timeout_ms),
    });
    if (!response.ok || !is_public_feed_url(response.url)) {
      return json_response({ error: "订阅源读取失败" }, 502);
    }
  }
  const body = await response.arrayBuffer();
  if (body.byteLength > preview_byte_limit) {
    return json_response({ error: "订阅源超过 512KB 预览限制" }, 413);
  }
  const xml = new TextDecoder().decode(body);
  const document_start = xml.slice(0, 2048).toLowerCase();
  if (
    !document_start.includes("<rss") &&
    !document_start.includes("<feed") &&
    !document_start.includes("<rdf:rdf")
  ) {
    return json_response({ error: "目标地址不是 RSS/Atom 文档" }, 415);
  }
  return new Response(body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/xml; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const secure_response = (response, style_hash = "") =>
  secure_site_response(response, "discovery", style_hash);

export async function handle_discovery_request(request, env, api_fetch) {
  const pathname = new URL(request.url).pathname;
  if (
    ["/", "/index.html"].includes(pathname) &&
    ["GET", "HEAD"].includes(request.method)
  ) {
    const response = secure_response(
      await home_page(request, env, api_fetch),
      await discovery_style_hash(),
    );
    // 平台会改写请求头；正文保留明文，由 Workers 自动编码，避免缓存和边缘转码时重复压缩。
    if (
      response.status === 200 &&
      accepts_gzip(
        request.cf?.clientAcceptEncoding ??
          request.headers.get("Accept-Encoding"),
      )
    ) {
      response.headers.set("Content-Encoding", "gzip");
    }
    return response;
  }
  if (request.method !== "GET") {
    return json_response({ error: "Method Not Allowed" }, 405);
  }
  if (pathname === "/api/sources") {
    return list_sources(request, env, api_fetch);
  }
  if (pathname === "/api/catalog") {
    return catalog_response(
      {
        ...env,
        FINDRSS_HOSTNAME: feed_hostname_origin(env) || new URL(request.url).origin,
      },
      api_fetch,
    );
  }
  if (pathname === "/api/search") {
    return search_feeds(request, env, api_fetch);
  }
  if (pathname === "/api/preview") {
    return preview_feed(request, env, api_fetch);
  }
  if (pathname.startsWith("/api/avatar/")) {
    return avatar_source(request, env, api_fetch);
  }
  return secure_response(await env.ASSETS.fetch(request));
}
