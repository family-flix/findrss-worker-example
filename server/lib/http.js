// HTTP 响应装配：所有 JSON 响应统一 no-store（凭证、设备状态、积分经手，不允许中间层缓存）。
//
// 纯模块，可在 node --test 下直接覆盖。

/**
 * @param {unknown} value
 * @param {number} [status]
 * @param {HeadersInit} [headers]
 * @returns {Response}
 */
export function json_response(value, status = 200, headers = {}) {
  return Response.json(value, {
    status,
    headers: { ...headers, "Cache-Control": "no-store" },
  });
}

/**
 * @param {string} error
 * @param {number} status
 * @param {HeadersInit} [headers]
 * @returns {Response}
 */
export function error_response(error, status, headers = {}) {
  return json_response({ error }, status, headers);
}

/**
 * 读一个 JSON 请求体的公共闸门：先按 Content-Length 拦超大请求，再解析并限定为对象。
 * 服务用它读 `Request`，但失败只回数据（`{ok:false,error}`），由调用方决定抛还是回 400。
 * @param {Request} request
 * @param {number} max_bytes
 * @returns {Promise<{ ok: true, body: Record<string, unknown> }
 *   | { ok: false, error: { status: number, message: string } }>}
 */
export async function read_json(request, max_bytes) {
  const content_length = Number(request.headers.get("Content-Length") ?? "0");
  if (content_length > max_bytes) {
    return { ok: false, error: { status: 413, message: "request body is too large" } };
  }
  /** @type {unknown} */
  let body;
  try {
    body = await request.json();
  } catch {
    return { ok: false, error: { status: 400, message: "invalid JSON" } };
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: { status: 400, message: "invalid JSON body" } };
  }
  return { ok: true, body: /** @type {Record<string, unknown>} */ (body) };
}

/**
 * 请求头里的用户凭证：`Authorization: Bearer` 优先，其次 `X-FindRSS-Token`。
 * 后者让阅读端能用「源请求头规则」给指定域名的订阅源请求带 token，
 * 不必把 token 写进订阅地址。
 * @param {Request} request
 * @returns {string}
 */
export function bearer_token(request) {
  const authorization = request.headers.get("Authorization") ?? "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7);
  return (request.headers.get("X-FindRSS-Token") ?? "").trim();
}
