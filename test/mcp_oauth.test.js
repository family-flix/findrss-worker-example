import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { register } from "node:module";
import { API_SCHEMA_SQL } from "../server/repository/schema.js";
import { RepositoryMcpToken } from "../server/repository/mcp_token.js";
import { RepositoryMcpOauth } from "../server/repository/mcp_oauth.js";
import { ServiceMcpToken } from "../server/service/application/mcp_tokens.js";
import { ServiceMcpOauth } from "../server/service/application/mcp_oauth.js";
import api from "../api.js";
import { create_worker } from "../router.js";
import { handle_admin_request } from "../admin.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
const {
  route
} = await import("../application_router.js");
const origin = "https://api.example",
  resource = origin + "/mcp",
  redirect_uri = "http://127.0.0.1:45678/callback";
const verifier = "a".repeat(43);
const challenge = async value => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("base64url");
function fixture(t) {
  const db = new DatabaseSync(":memory:");
  db.exec(API_SCHEMA_SQL);
  t.after(() => db.close());
  const sql = {
    exec(text, ...args) {
      const statement = db.prepare(text);
      if (/^SELECT/.test(text.trim())) return {
        toArray: () => statement.all(...args)
      };
      statement.run(...args);
      return {
        toArray: () => []
      };
    }
  };
  const transaction = action => {
    db.exec("BEGIN");
    try {
      const result = action();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const tokens = new RepositoryMcpToken({
      sql
    }),
    oauth = new RepositoryMcpOauth({
      sql,
      transaction
    }),
    app = {};
  app.mcp_tokens = new ServiceMcpToken({
    repo: tokens,
    app
  });
  app.mcp_oauth = new ServiceMcpOauth({
    repo: oauth,
    tokens
  });
  const env = {
    ADMIN_PASSWORD: "test-admin",
    APPLICATION: (() => ({
      fetch: input => route(input, app)
    }))(),
    ASSETS: {
      fetch: async () => new Response("admin assets")
    }
  };
  const worker = create_worker({
    api,
    admin: handle_admin_request,
    discovery: async () => new Response(null, {
      status: 404
    })
  });
  const fetch = async (path, options) => await worker.fetch(new Request(new URL(path, origin), options), env);
  const post = async (path, body, admin = false, extra = {}) => await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": admin || path === "/oauth/register" ? "application/json" : "application/x-www-form-urlencoded",
      ...(admin ? {
        Authorization: "Bearer test-admin"
      } : {}),
      ...extra
    },
    body: admin || path === "/oauth/register" ? JSON.stringify(body) : new URLSearchParams(body)
  });
  const admin = async (path, headers = {
    Authorization: "Bearer test-admin"
  }) => await fetch(path, {
    headers
  });
  const register_client = async (extra = {}) => {
    const response = await post("/oauth/register", {
      client_name: "Code Agent",
      redirect_uris: [redirect_uri],
      ...extra
    });
    assert.equal(response.status, 201, await response.clone().text());
    return response.json();
  };
  const begin = async (client, extra = {}) => {
    const params = {
      client_id: client.client_id,
      redirect_uri,
      resource,
      response_type: "code",
      scope: "discovery:create scripts:create",
      code_challenge: await challenge(verifier),
      code_challenge_method: "S256",
      state: "opaque-client-state",
      ...extra
    };
    const response = await fetch("/oauth/authorize?" + new URLSearchParams(params));
    assert.equal(response.status, 302, await response.clone().text());
    const location = new URL(await response.headers.get("Location"));
    assert.equal(location.pathname, "/admin/oauth");
    return await location.searchParams.get("request");
  };
  const approve = async (client, scopes = ["discovery:create"], approved = true) => {
    const id = await begin(client),
      response = await post("/admin/api/mcp-oauth/requests/" + id + "/decision", {
        approved,
        scopes
      }, true);
    assert.equal(response.status, 200, await response.clone().text());
    const callback = new URL((await response.json()).redirect_uri);
    return {
      id,
      callback,
      code: await callback.searchParams.get("code")
    };
  };
  const exchange = async (client, code, extra = {}) => await post("/oauth/token", {
    grant_type: "authorization_code",
    client_id: client.client_id,
    redirect_uri,
    resource,
    code,
    code_verifier: verifier,
    ...extra
  });
  const connect = async (scopes = ["discovery:create"]) => {
    const client = await register_client(),
      consent = await approve(client, scopes),
      response = await exchange(client, consent.code);
    assert.equal(response.status, 200, await response.clone().text());
    return {
      client,
      ...consent,
      pair: await response.json()
    };
  };
  const mcp = async token => await fetch("/mcp", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list"
    })
  });
  const refresh = async (client, token, extra = {}) => await post("/oauth/token", {
    grant_type: "refresh_token",
    client_id: client.client_id,
    resource,
    refresh_token: token,
    ...extra
  });
  return {
    db,
    app,
    tokens,
    oauth,
    env,
    fetch,
    post,
    admin,
    register_client,
    begin,
    approve,
    exchange,
    connect,
    mcp,
    refresh
  };
}
test("MCP discovery advertises OAuth, PKCE, registration and default least privilege", async t => {
  const f = fixture(t),
    unauthorized = await f.fetch("/mcp");
  assert.equal(unauthorized.status, 401);
  assert.match(await unauthorized.headers.get("WWW-Authenticate"), /resource_metadata="https:\/\/api.example\/\.well-known\/oauth-protected-resource\/mcp"/);
  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    const metadata = await (await f.fetch(path)).json();
    assert.equal(metadata.resource, resource);
    assert.deepEqual(metadata.authorization_servers, [origin]);
  }
  const metadata = await (await f.fetch("/.well-known/oauth-authorization-server")).json();
  assert.equal(metadata.issuer, origin);
  assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
  assert.equal(metadata.registration_endpoint, origin + "/oauth/register");
  for (const path of ["/.well-known/oauth-protected-resource/mcp", "/oauth/token", "/oauth/register"]) {
    const response = await f.fetch(path, {
      method: "OPTIONS",
      headers: {
        Origin: "https://client.example"
      }
    });
    assert.equal(response.status, 204);
    assert.equal(await response.headers.get("Access-Control-Allow-Origin"), "*");
  }
  for (const path of ["/_mcp-oauth/token", "/_admin/mcp-oauth/requests/guess"]) assert.equal((await f.fetch(path)).status, 404);
});
test("consent displays requested permissions; callback delivers only code and state; durable token exchange enables scoped MCP", async t => {
  const f = fixture(t),
    client = await f.register_client(),
    id = await f.begin(client);
  const path = "/admin/api/mcp-oauth/requests/" + id;
  assert.equal((await f.admin(path, {})).status, 401);
  assert.equal((await f.post(path + "/decision", {
    approved: true,
    scopes: ["discovery:create"]
  }, true, {
    Origin: "https://evil.example"
  })).status, 403);
  const consent = await (await f.admin(path)).json();
  assert.equal(consent.authorization.client_name, "Code Agent");
  assert.equal(consent.authorization.redirect_uri, redirect_uri);
  assert.deepEqual(consent.authorization.scopes, ["discovery:create", "scripts:create"]);
  assert.equal((await f.tokens.list(Date.now())).length, 0);
  const approved = await f.post(path + "/decision", {
    approved: true,
    scopes: ["discovery:create"]
  }, true);
  const callback = new URL((await approved.json()).redirect_uri);
  assert.equal(callback.origin, new URL(redirect_uri).origin);
  assert.equal(await callback.searchParams.get("state"), "opaque-client-state");
  assert.equal(await callback.searchParams.get("iss"), origin);
  assert.equal(callback.searchParams.has("access_token"), false);
  const code = await callback.searchParams.get("code"),
    response = await f.exchange(client, code);
  assert.equal(response.status, 200);
  assert.equal(await response.headers.get("Cache-Control"), "no-store");
  const pair = await response.json();
  assert.equal(pair.scope, "discovery:create");
  assert.equal(pair.expires_in, 3600);
  assert.deepEqual((await (await f.mcp(pair.access_token)).json()).result.tools.map(tool => tool.name), ["add_subscription"]);
  const list = await (await f.admin("/admin/api/mcp-tokens")).json();
  assert.equal(list.mcp_tokens.length, 1);
  assert.equal(list.mcp_tokens[0].authorization_type, "oauth");
  assert.equal(list.mcp_tokens[0].name, "Code Agent");
  assert.equal(list.mcp_tokens[0].expires_at - list.mcp_tokens[0].created_at, 90 * 86400000);
  const stored = JSON.stringify({
    credentials: f.db.prepare("SELECT * FROM mcp_oauth_credentials").all(),
    requests: f.db.prepare("SELECT * FROM mcp_oauth_requests").all(),
    grants: await f.tokens.list(Date.now()),
    list
  });
  for (const secret of [pair.access_token, pair.refresh_token, code]) assert.equal(stored.includes(secret), false);
  // Recreating service instances models worker restart; credentials survive in storage.
  f.app.mcp_oauth = new ServiceMcpOauth({
    repo: f.oauth,
    tokens: f.tokens
  });
  assert.equal((await f.mcp(pair.access_token)).status, 200);
  assert.equal((await f.exchange(client, code)).status, 400);
  assert.equal((await f.post(path + "/decision", {
    approved: true,
    scopes: ["discovery:create"]
  }, true)).status, 400);
});
test("authorization rejects unknown callbacks, missing resource, weak PKCE, unsupported scopes and duplicate query fields", async t => {
  const f = fixture(t),
    client = await f.register_client();
  const params = {
    client_id: client.client_id,
    redirect_uri,
    resource,
    response_type: "code",
    scope: "discovery:create",
    code_challenge: await challenge(verifier),
    code_challenge_method: "S256"
  };
  for (const extra of [{
    redirect_uri: "https://evil.example/callback"
  }, {
    redirect_uri: "javascript:alert(1)"
  }, {
    resource: "https://other.example/mcp"
  }, {
    resource: ""
  }, {
    code_challenge_method: "plain"
  }, {
    code_challenge: "short"
  }, {
    scope: "admin"
  }, {
    response_type: "token"
  }, {
    client_id: "unknown"
  }]) {
    const response = await f.fetch("/oauth/authorize?" + new URLSearchParams({
      ...params,
      ...extra
    }));
    assert.equal(response.status, 400, JSON.stringify(extra));
    assert.equal(response.headers.has("Location"), false);
  }
  assert.equal((await f.fetch("/oauth/authorize?" + new URLSearchParams(params) + "&resource=" + resource)).status, 400);
  for (const uri of ["http://remote.example/callback", "https://user:pass@example.com/callback", "https://example.com/callback#fragment", "file:///tmp/callback", "https://example.com/callback?code=bad"]) {
    assert.equal((await f.post("/oauth/register", {
      redirect_uris: [uri]
    })).status, 400);
  }
  assert.equal((await f.post("/oauth/register", {
    redirect_uris: [redirect_uri],
    token_endpoint_auth_method: "client_secret_basic"
  })).status, 400);
});
test("denial, consent narrowing and expired requests never issue credentials", async t => {
  const f = fixture(t),
    client = await f.register_client(),
    denied = await f.approve(client, [], false);
  assert.equal(denied.code, null);
  assert.equal(await denied.callback.searchParams.get("error"), "access_denied");
  assert.equal(await denied.callback.searchParams.get("state"), "opaque-client-state");
  assert.equal((await f.tokens.list(Date.now())).length, 0);
  const id = await f.begin(client, {
      scope: "discovery:create"
    }),
    path = "/admin/api/mcp-oauth/requests/" + id;
  for (const body of [{
    approved: true,
    scopes: ["scripts:create"]
  }, {
    approved: true,
    scopes: []
  }, {
    scopes: ["discovery:create"]
  }]) {
    assert.equal((await f.post(path + "/decision", body, true)).status, 400);
  }
  f.db.prepare("UPDATE mcp_oauth_requests SET expires_at = ? WHERE id = ?").run(Date.now(), id);
  assert.equal((await f.admin(path)).status, 400);
  assert.equal((await f.post(path + "/decision", {
    approved: true,
    scopes: ["discovery:create"]
  }, true)).status, 400);
});
test("code exchange binds PKCE, resource, client and exact callback, and consumes codes atomically", async t => {
  const f = fixture(t),
    client = await f.register_client(),
    other = await f.register_client(),
    {
      code
    } = await f.approve(client);
  for (const extra of [{
    code_verifier: "b".repeat(43)
  }, {
    resource: "https://other.example/mcp"
  }, {
    client_id: other.client_id
  }, {
    redirect_uri: redirect_uri + "/other"
  }, {
    code_verifier: "short"
  }, {
    grant_type: "password"
  }]) {
    assert.equal((await f.exchange(client, code, extra)).status, 400);
  }
  const responses = await Promise.all([f.exchange(client, code), f.exchange(client, code)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 400]);
  const response = await responses.find(response => response.status === 200),
    pair = await response.json();
  assert.equal((await f.mcp(pair.access_token)).status, 200);
  assert.equal((await f.fetch("https://other.example/mcp", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + pair.access_token
    }
  })).status, 401);
  assert.equal((await f.tokens.list(Date.now())).length, 1);
});
test("refresh rotates credentials; replay revokes the entire authorization; expiry and admin revocation stop refresh immediately", async t => {
  const f = fixture(t),
    {
      client,
      pair
    } = await f.connect();
  f.db.prepare("UPDATE mcp_oauth_credentials SET access_expires_at = ?").run(Date.now());
  assert.equal((await f.mcp(pair.access_token)).status, 401);
  const refreshed = await f.refresh(client, pair.refresh_token);
  assert.equal(refreshed.status, 200);
  const next = await refreshed.json();
  assert.notEqual(next.access_token, pair.access_token);
  assert.notEqual(next.refresh_token, pair.refresh_token);
  assert.equal((await f.mcp(next.access_token)).status, 200);
  assert.equal((await f.refresh(client, pair.refresh_token)).status, 400);
  assert.equal((await f.mcp(next.access_token)).status, 401);
  assert.equal((await f.refresh(client, next.refresh_token)).status, 400);
  const second = await f.connect(["scripts:create"]),
    list = await (await f.admin("/admin/api/mcp-tokens")).json();
  const active = await list.mcp_tokens.find(token => token.status === "active");
  assert.equal((await f.post("/admin/api/mcp-tokens/" + active.id + "/revoke", {}, true)).status, 200);
  assert.equal((await f.mcp(second.pair.access_token)).status, 401);
  assert.equal((await f.refresh(second.client, second.pair.refresh_token)).status, 400);
  const third = await f.connect();
  f.db.prepare("UPDATE mcp_tokens SET expires_at = ? WHERE revoked_at IS NULL").run(Date.now());
  assert.equal((await f.refresh(third.client, third.pair.refresh_token)).status, 400);
});
test("revocation endpoint validates ownership and invalidates both access and refresh tokens", async t => {
  const f = fixture(t),
    {
      client,
      pair
    } = await f.connect(),
    other = await f.register_client();
  assert.equal((await f.post("/oauth/revoke", {
    client_id: other.client_id,
    token: pair.refresh_token
  })).status, 200);
  assert.equal((await f.mcp(pair.access_token)).status, 200);
  assert.equal((await f.post("/oauth/revoke", {
    client_id: client.client_id,
    token: pair.refresh_token
  })).status, 200);
  assert.equal((await f.mcp(pair.access_token)).status, 401);
  assert.equal((await f.refresh(client, pair.refresh_token)).status, 400);
});
test("admin cookie login protects consent, malformed requests are bounded, and manual token issuance is disabled", async t => {
  const f = fixture(t),
    client = await f.register_client(),
    id = await f.begin(client);
  const login = await f.fetch("/admin/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      password: "test-admin"
    })
  });
  const cookie = (await login.headers.get("Set-Cookie")).split(";")[0];
  assert.equal((await f.admin("/admin/api/mcp-oauth/requests/" + id, {
    Cookie: cookie
  })).status, 200);
  const approved = await f.fetch("/admin/api/mcp-oauth/requests/" + id + "/decision", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: origin,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      approved: true,
      scopes: ["discovery:create"]
    })
  });
  assert.equal(approved.status, 200);
  assert.equal((await f.post("/admin/api/mcp-tokens", {
    name: "manual bypass"
  }, true)).status, 405);
  assert.equal((await f.fetch("/oauth/token")).status, 405);
  assert.equal((await f.fetch("/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: "{}"
  })).status, 415);
  assert.equal((await f.fetch("/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "client_id=a&client_id=b"
  })).status, 400);
  assert.equal((await f.post("/oauth/register", {
    client_name: "x".repeat(20000)
  })).status, 413);
});
