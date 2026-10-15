// 外层 Worker 侧的处理函数：只碰 env 与 Request/Response，不 import DO 类。
// 阅读端会话：登录签发、会话校验与身份解析（签名契约见 infra/reader_auth.js）。
import { sign_reader_session, verify_reader_session } from "../../infra/reader_auth.js";
import { reader_session_secret } from "../../infra/reader_session_secret.js";
import { API_OBJECT_NAME } from "../../lib/constants.js";
import { bearer_token, error_response, json_response } from "../../lib/http.js";
import { valid_identifier } from "../../lib/identifiers.js";

/**
 * @param {Env} env
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function reader_login(env, request) {
  if (request.method !== "POST") {
    return error_response("method not allowed", 405, { Allow: "POST" });
  }
  const object = env.API.getByName(API_OBJECT_NAME);
  const authentication = await object.fetch(
    new Request("https://internal/_reader/auth/login", request),
  );
  if (!authentication.ok) return authentication;
  /** @type {{ user?: { id?: string, name?: string, email?: string | null }, access_token?: { id?: string } }} */
  const identity = await authentication.json();
  const user_id = String(identity.user?.id ?? "");
  const access_token_id = String(identity.access_token?.id ?? "");
  if (!valid_identifier(user_id) || !valid_identifier(access_token_id)) {
    return error_response("authentication failed", 500);
  }
  const signed = await sign_reader_session(
    reader_session_secret(env),
    { user_id, access_token_id },
  );
  return json_response({
    logged_in: true,
    session: signed.session,
    expires_at: signed.expires_at,
    user: {
      id: user_id,
      name: String(identity.user?.name ?? "Reader"),
      email: identity.user?.email ?? null,
    },
  });
}

/**
 * @param {Env} env
 * @param {Request} request
 * @param {string} internal_path
 * @returns {Promise<Response>}
 */

/**
 * @param {Env} env
 * @param {string} session
 * @returns {Promise<{ user: { id: string, name: string, email: string | null }, access_token_id: string, expires_at: number } | null>}
 */
export async function reader_identity(env, session) {
  const claims = await verify_reader_session(reader_session_secret(env), session);
  if (
    claims === null ||
    !valid_identifier(claims.user_id) ||
    !valid_identifier(claims.access_token_id)
  ) {
    return null;
  }
  const object = env.API.getByName(API_OBJECT_NAME);
  const verification = await object.fetch(
    "https://internal/_internal/reader-session/verify",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: claims.user_id,
        access_token_id: claims.access_token_id,
      }),
    },
  );
  if (!verification.ok) return null;
  /** @type {{ user?: { id?: string, name?: string, email?: string | null } }} */
  const value = await verification.json();
  if (String(value.user?.id ?? "") !== claims.user_id) return null;
  return {
    user: {
      id: claims.user_id,
      name: String(value.user?.name ?? "Reader"),
      email: value.user?.email ?? null,
    },
    access_token_id: claims.access_token_id,
    expires_at: claims.expires_at,
  };
}

/**
 * @param {Env} env
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function reader_session(env, request) {
  if (request.method !== "GET") {
    return error_response("method not allowed", 405, { Allow: "GET" });
  }
  const identity = await reader_identity(env, bearer_token(request));
  if (identity === null) return error_response("authentication required", 401);
  return json_response({
    logged_in: true,
    expires_at: identity.expires_at,
    user: identity.user,
  });
}
