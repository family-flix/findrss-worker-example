import { MCP_TOOL_SCOPES } from "../lib/mcp_tools.js";

export function McpTokenModel(row = {}) {
  let scopes;
  try { scopes = JSON.parse(row.scopes_json ?? "[]"); } catch { scopes = []; }
  scopes = Object.freeze(Array.isArray(scopes) ? scopes.filter(scope => McpTokenModel.SCOPES.includes(scope)) : []);
  const state = Object.freeze({
    id: String(row.id ?? ""), name: String(row.name ?? ""), token_hint: String(row.token_hint ?? ""),
    scopes, resource: String(row.resource ?? ""), created_at: Number(row.created_at ?? 0),
    expires_at: Number(row.expires_at ?? 0), revoked_at: row.revoked_at ?? null, last_used_at: row.last_used_at ?? null,
  });
  const status = now => state.revoked_at !== null ? "revoked"
    : !Number.isFinite(state.expires_at) || state.expires_at <= now ? "expired" : "active";
  return Object.freeze({
    ...state,
    is_active_at: (now = Date.now()) => status(now) === "active",
    allows: name => Object.hasOwn(MCP_TOOL_SCOPES, name) && scopes.includes(MCP_TOOL_SCOPES[name]),
    toValue: (now = Date.now()) => ({ ...state, scopes: [...scopes], status: status(now) }),
  });
}
McpTokenModel.SCOPES = Object.freeze([...new Set(Object.values(MCP_TOOL_SCOPES))]);
McpTokenModel.DEFAULT_LIFETIME_SECONDS = 7 * 86400;
McpTokenModel.MAX_LIFETIME_SECONDS = 90 * 86400;
McpTokenModel.MAX_TOKENS = 100;
McpTokenModel.parse = body => {
  const invalid = message => ({ ok: false, error: { status: 400, message } });
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalid("invalid JSON body");
  if (Object.keys(body).some(key => !["name", "scopes", "expires_in_seconds"].includes(key))) return invalid("unknown MCP token field");
  if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 80) return invalid("name must contain 1–80 characters");
  const scopes = body.scopes === undefined ? ["discovery:create"] : body.scopes;
  if (!Array.isArray(scopes) || !scopes.length || scopes.length > McpTokenModel.SCOPES.length ||
      scopes.some(scope => !McpTokenModel.SCOPES.includes(scope)) || new Set(scopes).size !== scopes.length) return invalid("select valid MCP scopes");
  const lifetime = body.expires_in_seconds === undefined ? McpTokenModel.DEFAULT_LIFETIME_SECONDS : body.expires_in_seconds;
  if (!Number.isInteger(lifetime) || lifetime < 60 || lifetime > McpTokenModel.MAX_LIFETIME_SECONDS) return invalid("expires_in_seconds must be between 60 and 7776000");
  return { ok: true, name: body.name.trim(), scopes: [...scopes], lifetime };
};
