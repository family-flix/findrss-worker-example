import { json_response } from "../../lib/http.js";
import { MCP_TOOL_SCOPES } from "../../lib/mcp_tools.js";
export const MCP_OAUTH_PATHS = Object.freeze(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server", "/oauth/register", "/oauth/authorize", "/oauth/token", "/oauth/revoke"]);
export function mcp_challenge(resource) {
  return `Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource/mcp", resource).href}", scope="discovery:create"`;
}
export async function api_mcp_oauth(request, env) {
  const url = new URL(request.url),
    resource = new URL("/mcp", url).href;
  let response;
  if (request.method === "OPTIONS") response = new Response(null, {
    status: 204
  });else if (url.pathname.startsWith("/.well-known/")) {
    if (request.method !== "GET") response = json_response({
      error: "invalid_request"
    }, 405, {
      Allow: "GET, OPTIONS"
    });else if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) response = json_response({
      resource,
      authorization_servers: [url.origin],
      scopes_supported: Object.values(MCP_TOOL_SCOPES),
      bearer_methods_supported: ["header"],
      resource_name: "FindRSS MCP"
    });else response = json_response({
      issuer: url.origin,
      authorization_endpoint: url.origin + "/oauth/authorize",
      token_endpoint: url.origin + "/oauth/token",
      registration_endpoint: url.origin + "/oauth/register",
      revocation_endpoint: url.origin + "/oauth/revoke",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: Object.values(MCP_TOOL_SCOPES),
      authorization_response_iss_parameter_supported: true
    });
  } else {
    const forwarded = new Request("https://internal/_mcp-oauth/" + url.pathname.split("/").at(-1) + url.search, request);
    forwarded.headers.set("X-MCP-Resource", resource);
    try {
      response = await env.APPLICATION.fetch(forwarded);
    } catch {
      response = json_response({
        error: "temporarily_unavailable",
        error_description: "MCP authorization service unavailable"
      }, 503);
    }
  }
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Cache-Control", "no-store");
  headers.set("Pragma", "no-cache");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, {
    status: response.status,
    headers
  });
}
