import { sha256_hex } from "../../lib/crypto.js";
import { access_token_hint, safe_equal } from "../../lib/identifiers.js";
import { McpTokenModel } from "../../domain/mcp_token.js";
import { do_error, do_result } from "./error.js";

const access_lifetime = 3600;
const grant_lifetime = 90 * 86400000;
const fail = (error, description, status = 400) => { throw do_error(error, status, { error_description: description }); };
const random = prefix => prefix + [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, "0")).join("");
const scopes_from = value => {
  const scopes = value === undefined ? ["discovery:create"] : typeof value === "string" ? value.split(" ").filter(Boolean) : [];
  if (!scopes.length || scopes.length > McpTokenModel.SCOPES.length || new Set(scopes).size !== scopes.length || scopes.some(scope => !McpTokenModel.SCOPES.includes(scope))) fail("invalid_scope", "Select supported MCP permissions");
  return scopes;
};
function redirect_url(value) {
  if (typeof value !== "string" || value.length > 2048) fail("invalid_redirect_uri", "Invalid callback URL");
  let url;
  try { url = new URL(value); } catch { fail("invalid_redirect_uri", "Invalid callback URL"); }
  const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.hash ||
      ["code", "state", "error", "iss"].some(key => url.searchParams.has(key))) fail("invalid_redirect_uri", "Use HTTPS or a local loopback callback without credentials or OAuth response parameters");
  return url;
}
function callback(request, values) {
  const url = new URL(request.redirect_uri);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  if (request.state) url.searchParams.set("state", request.state);
  url.searchParams.set("iss", new URL(request.resource).origin);
  return { redirect_uri: url.href };
}
async function pkce(verifier) {
  if (typeof verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) fail("invalid_grant", "Invalid PKCE verifier");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export class ServiceMcpOauth {
  constructor({ repo, tokens }) { this.repo = repo; this.tokens = tokens; }
  client(id, resource) {
    if (typeof id !== "string") fail("invalid_client", "Missing client_id");
    const row = this.repo.client(id, resource);
    if (!row) fail("invalid_client", "Register this MCP client first");
    return JSON.parse(row.metadata_json);
  }
  register(body, resource) {
    if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== "none") fail("invalid_client_metadata", "Only public clients with PKCE are supported");
    if (!Array.isArray(body.redirect_uris) || !body.redirect_uris.length || body.redirect_uris.length > 10) fail("invalid_client_metadata", "Provide 1–10 callback URLs");
    for (const uri of body.redirect_uris) redirect_url(uri);
    if (body.client_name !== undefined && (typeof body.client_name !== "string" || !body.client_name.trim() || body.client_name.length > 80)) fail("invalid_client_metadata", "client_name must contain 1–80 characters");
    if (body.grant_types !== undefined && (!Array.isArray(body.grant_types) || !body.grant_types.includes("authorization_code") || body.grant_types.some(type => !["authorization_code", "refresh_token"].includes(type)))) fail("invalid_client_metadata", "Unsupported grant type");
    if (body.response_types !== undefined && (!Array.isArray(body.response_types) || body.response_types.length !== 1 || body.response_types[0] !== "code")) fail("invalid_client_metadata", "Only authorization code responses are supported");
    if (body.scope !== undefined) scopes_from(body.scope);
    if (this.repo.client_count() >= 2000) fail("temporarily_unavailable", "Client registration limit reached", 503);
    const id = random("fr_client_"), now = Date.now();
    const metadata = { client_id: id, client_name: body.client_name?.trim() || "MCP 客户端", redirect_uris: [...new Set(body.redirect_uris)],
      token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      ...(body.scope !== undefined ? { scope: body.scope } : {}), client_id_issued_at: Math.floor(now / 1000) };
    this.repo.register({ id, resource, metadata_json: JSON.stringify(metadata), created_at: now });
    return do_result(metadata, 201);
  }
  begin(params, resource) {
    const client = this.client(params.client_id, resource);
    // Validate before any redirect; unregistered callbacks never receive codes or errors.
    redirect_url(params.redirect_uri);
    if (!client.redirect_uris.includes(params.redirect_uri)) fail("invalid_redirect_uri", "Callback does not exactly match the registered URL");
    if (params.response_type !== "code") fail("unsupported_response_type", "Use response_type=code");
    if (params.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge || "")) fail("invalid_request", "PKCE S256 is required");
    if (params.resource !== resource) fail("invalid_target", "resource must match this MCP endpoint");
    if (params.state !== undefined && (typeof params.state !== "string" || params.state.length > 2048)) fail("invalid_request", "Invalid state");
    const scopes = scopes_from(params.scope), now = Date.now(), id = random("fr_request_");
    this.repo.prune(now);
    if (this.repo.pending_count() >= 1000) fail("temporarily_unavailable", "Too many pending authorization requests", 503);
    this.repo.insert_request({ id, resource, client_id: client.client_id, redirect_uri: params.redirect_uri, state: params.state || "",
      scopes_json: JSON.stringify(scopes), code_challenge: params.code_challenge, created_at: now, expires_at: now + 10 * 60000 });
    return new Response(null, { status: 302, headers: { Location: new URL("/admin/oauth?request=" + id, resource).href,
      "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }
  pending(id, resource) {
    const row = this.repo.request(id, resource);
    if (!row || row.expires_at <= Date.now() || row.status !== "pending") fail("invalid_request", "Authorization request expired or already completed");
    return row;
  }
  inspect(id, resource) {
    const row = this.pending(id, resource), client = this.client(row.client_id, resource);
    return { authorization: { id, client_id: row.client_id, client_name: client.client_name, redirect_uri: row.redirect_uri,
      resource, scopes: JSON.parse(row.scopes_json), expires_at: row.expires_at } };
  }
  async decide(id, body, resource) {
    if (typeof body.approved !== "boolean") fail("invalid_request", "Explicit consent is required");
    const code = body.approved ? random("fr_code_") : null;
    const hash = code ? await sha256_hex(code) : null;
    return this.repo.transaction(() => {
      const row = this.pending(id, resource), requested = JSON.parse(row.scopes_json);
      const scopes = body.approved ? scopes_from(Array.isArray(body.scopes) ? body.scopes.join(" ") : "") : requested;
      if (scopes.some(scope => !requested.includes(scope))) fail("invalid_scope", "Cannot grant permissions the client did not request");
      this.repo.decide(id, body.approved ? "approved" : "denied", hash, JSON.stringify(scopes), Date.now() + 60000);
      return callback(row, body.approved ? { code } : { error: "access_denied", error_description: "User denied this authorization" });
    });
  }
  async credentials() {
    const access_token = random("fr_mcp_"), refresh_token = random("fr_refresh_");
    return { access_token, refresh_token, row: { id: crypto.randomUUID(), access_hash: await sha256_hex(access_token),
      refresh_hash: await sha256_hex(refresh_token), created_at: Date.now(), access_expires_at: Date.now() + access_lifetime * 1000 } };
  }
  token_result(pair, scopes) {
    return { access_token: pair.access_token, refresh_token: pair.refresh_token, token_type: "Bearer", expires_in: access_lifetime, scope: scopes.join(" ") };
  }
  async exchange(body, resource) {
    this.client(body.client_id, resource);
    if (body.resource !== resource) fail("invalid_target", "resource must match this MCP endpoint");
    if (body.grant_type === "refresh_token") return this.refresh(body, resource);
    if (body.grant_type !== "authorization_code") fail("unsupported_grant_type", "Unsupported grant type");
    if (typeof body.code !== "string" || body.code.length > 256) fail("invalid_grant", "Invalid authorization code");
    const hash = await sha256_hex(body.code), challenge = await pkce(body.code_verifier), pair = await this.credentials();
    return this.repo.transaction(() => {
      const row = this.repo.request_by_code(hash);
      if (!row || row.status !== "approved" || row.expires_at <= Date.now() || row.resource !== resource || row.client_id !== body.client_id || row.redirect_uri !== body.redirect_uri || !safe_equal(row.code_challenge, challenge)) fail("invalid_grant", "Invalid, expired or already used authorization code");
      if (this.tokens.count_active(Date.now()) >= McpTokenModel.MAX_TOKENS) fail("temporarily_unavailable", "MCP authorization limit reached", 503);
      const id = crypto.randomUUID(), now = Date.now(), client = this.client(row.client_id, resource);
      this.repo.consume(row.id);
      // OAuth grants hold permission/lifetime state; access and refresh digests are separate.
      this.tokens.insert({ id, name: client.client_name, token_hash: "oauth:" + id, token_hint: access_token_hint(pair.access_token),
        scopes_json: row.scopes_json, resource, created_at: now, expires_at: now + grant_lifetime });
      this.repo.insert_grant(id, row.client_id);
      this.repo.insert_credential({ ...pair.row, grant_id: id });
      return this.token_result(pair, JSON.parse(row.scopes_json));
    });
  }
  async refresh(body, resource) {
    if (typeof body.refresh_token !== "string" || !/^fr_refresh_[0-9a-f]{64}$/.test(body.refresh_token)) fail("invalid_grant", "Invalid refresh token");
    const hash = await sha256_hex(body.refresh_token), pair = await this.credentials();
    const result = this.repo.transaction(() => {
      const old = this.repo.credential(hash, "refresh"), grant = old && this.tokens.find(old.grant_id);
      if (!grant || grant.resource !== resource || this.repo.grant_client(grant.id) !== body.client_id || !McpTokenModel(grant).is_active_at()) fail("invalid_grant", "Authorization expired or revoked");
      if (old.used_at !== null) {
        this.tokens.revoke(grant.id, Date.now());
        return null; // Commit revocation before reporting refresh-token replay.
      }
      const scopes = JSON.parse(grant.scopes_json);
      if (body.scope !== undefined && scopes_from(body.scope).join(" ") !== scopes.join(" ")) fail("invalid_scope", "Refresh cannot change granted permissions");
      this.repo.use_credential(old.id, Date.now());
      this.repo.insert_credential({ ...pair.row, grant_id: grant.id });
      return this.token_result(pair, scopes);
    });
    if (!result) fail("invalid_grant", "Refresh token reused; authorization revoked");
    return result;
  }
  async verify_access(hash, resource) {
    const row = this.repo.credential(hash, "access");
    if (!row || row.used_at !== null || row.access_expires_at <= Date.now()) return null;
    const grant = this.tokens.find(row.grant_id);
    return grant?.resource === resource && McpTokenModel(grant).is_active_at() ? grant : null;
  }
  async revoke(body, resource) {
    this.client(body.client_id, resource);
    if (typeof body.token !== "string" || body.token.length > 256) fail("invalid_request", "Missing token");
    const hash = await sha256_hex(body.token);
    return this.repo.transaction(() => {
      const credential = this.repo.credential(hash, "refresh") || this.repo.credential(hash, "access");
      const grant = credential && this.tokens.find(credential.grant_id);
      if (grant?.resource === resource && this.repo.grant_client(grant.id) === body.client_id) this.tokens.revoke(grant.id, Date.now());
      return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
    });
  }
}
