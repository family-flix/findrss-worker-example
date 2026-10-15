// 外层 Worker 侧的处理函数：只碰 env 与 Request/Response，不 import DO 类。
// 阅读端注册与邮箱验证：经内部请求转发到 DO，外层只做请求体闸门。
import { API_OBJECT_NAME } from "../../lib/constants.js";
import { error_response, json_response } from "../../lib/http.js";

/**
 * @param {Env} env
 * @param {Request} request
 * @param {string} internal_path
 * @returns {Promise<Response>}
 */
export async function reader_auth_internal_request(env, request, internal_path) {
  if (request.method !== "POST") {
    return error_response("method not allowed", 405, { Allow: "POST" });
  }
  const headers = new Headers(request.headers);
  const client_ip = request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Reader-Client-IP") || "";
  if (client_ip !== "") headers.set("X-Reader-Client-IP", client_ip);
  const object = env.API.getByName(API_OBJECT_NAME);
  return object.fetch(
    new Request("https://internal" + internal_path, new Request(request, { headers })),
  );
}

/** @param {Env} env @param {Request} request */
export async function reader_register(env, request) {
  if (!env.READER_SMTP_USER || !env.READER_SMTP_PASSWORD) {
    return error_response("邮箱验证邮件服务尚未配置", 503);
  }
  const response = await reader_auth_internal_request(
    env,
    request,
    "/_reader/auth/register",
  );
  if (!response.ok) return response;
  /** @type {{ send_verification_email?: boolean, email?: string, code?: string }} */
  const result = await response.json();
  if (result.send_verification_email) {
    try {
      await send_reader_verification_email(env, {
        to: String(result.email ?? ""),
        code: String(result.code ?? ""),
      });
    } catch {
      return error_response("验证邮件暂时发送失败，请稍后重试", 502);
    }
  }
  return json_response(
    {
      request_accepted: true,
      message: "如果该邮箱可以注册，请查收验证码；未收到可稍后重新发送。已验证账户可返回登录。",
    },
    202,
  );
}

/** @param {Env} env @param {Request} request */
export async function reader_resend_verification(env, request) {
  if (!env.READER_SMTP_USER || !env.READER_SMTP_PASSWORD) {
    return error_response("邮箱验证邮件服务尚未配置", 503);
  }
  const response = await reader_auth_internal_request(
    env,
    request,
    "/_reader/auth/resend-verification",
  );
  if (!response.ok) return response;
  /** @type {{ send_verification_email?: boolean, email?: string, code?: string }} */
  const result = await response.json();
  if (result.send_verification_email) {
    try {
      await send_reader_verification_email(env, {
        to: String(result.email ?? ""),
        code: String(result.code ?? ""),
      });
    } catch {
      return error_response("验证邮件暂时发送失败，请稍后重试", 502);
    }
  }
  return json_response(
    {
      request_accepted: true,
      message: "如果该邮箱有待验证账户，验证码会发送或已经发送；未收到可稍后再试。",
    },
    202,
  );
}

/** @param {Env} env @param {Request} request */
export async function reader_verify_email(env, request) {
  return reader_auth_internal_request(env, request, "/_reader/auth/verify-email");
}
