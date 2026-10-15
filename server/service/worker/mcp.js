import { handle_mcp } from "../../lib/mcp.js";
import { admin_authorized, admin_auth_required } from "./auth.js";
import { admin_discovery_source_request, admin_script_request } from "./do_proxy.js";

const tools = [
  { name: "add_subscription", description: "Add a feed to the Discovery directory (administrator only).", inputSchema: { type: "object", properties: {
    title: { type: "string" }, feed_url: { type: "string" }, description: { type: "string" }, category: { type: "string", enum: ["recommended", "technology", "development", "business", "science", "design", "life"] }, website: { type: "string" }, tags: { type: "string", description: "Comma-separated tags" }, source_type: { type: "string", enum: ["website", "wxmp", "wxchannels"] }, enabled: { type: "boolean" }, require_token: { type: "boolean" }
  }, required: ["title", "feed_url", "category"], additionalProperties: false } },
  { name: "add_script", description: "Compile and add an script exporting route.path and route.handler(ctx).", inputSchema: { type: "object", properties: { script: { type: "string" }, enabled: { type: "boolean" } }, required: ["script"], additionalProperties: false } },
];
export async function api_mcp(request, env) {
  if (!admin_authorized(request, env)) return admin_auth_required();
  return handle_mcp(request, { name: "findrss-api", tools, call: (name, args) => {
    const forwarded = new Request(request.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) });
    return name === "add_script" ? admin_script_request(env, forwarded) : admin_discovery_source_request(env, forwarded);
  } });
}
