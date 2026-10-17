import { API_OBJECT_NAME } from "../../lib/constants.js";
import { error_response } from "../../lib/http.js";
import { feed_hostname_origin } from "./discovery.js";
import { mcp_challenge } from "./mcp_oauth.js";

export async function api_mcp(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  if (!/^Bearer fr_mcp_[0-9a-f]{64}$/i.test(authorization)) return error_response("MCP token required", 401, {
    "WWW-Authenticate": mcp_challenge(new URL("/mcp", request.url).href),
  });
  const forwarded = new Request("https://internal/_mcp", request);
  forwarded.headers.set("X-MCP-Resource", new URL("/mcp", request.url).href);
  forwarded.headers.set("X-Feed-Public-URL", feed_hostname_origin(env) || new URL(request.url).origin);
  try {
    const response = await env.API.getByName(API_OBJECT_NAME).fetch(forwarded);
    if (response.status !== 401) return response;
    const headers = new Headers(response.headers);
    headers.set("WWW-Authenticate", mcp_challenge(new URL("/mcp", request.url).href) + ', error="invalid_token"');
    return new Response(response.body, { status: response.status, headers });
  }
  catch { return error_response("MCP service unavailable", 503); }
}
