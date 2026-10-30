// Durable Object 服务的领域错误。
//
// 服务（`service/application/*`）只抛 **数据**：错误码、文案、附加字段与响应头，
// 绝不自己造 `Response`。`application_router.js` 是**唯一**的
// `DurableObjectError → Response` 翻译点。
//
// 纯模块（不依赖 Cloudflare API），可在 node --test 下直接覆盖。

export class DurableObjectError extends Error {
  /**
   * @param {string} error
   * @param {number} [status]
   * @param {Record<string, unknown>} [details] 并入响应体的附加字段（如 balance/required）。
   * @param {HeadersInit} [headers]
   */
  constructor(error, status = 400, details = {}, headers = {}) {
    super(error);
    this.name = "DurableObjectError";
    this.error = error;
    this.status = status;
    this.details = details;
    this.headers = headers;
  }
}

/**
 * 抛出一个 Durable Object 领域错误。
 * @param {string} error
 * @param {number} [status]
 * @param {Record<string, unknown>} [details]
 * @param {HeadersInit} [headers]
 * @returns {never}
 */
export function do_error(error, status = 400, details = {}, headers = {}) {
  throw new DurableObjectError(error, status, details, headers);
}

/**
 * 一个需要自定义状态码/响应头的成功结果。服务返回它（仍是纯数据，不是 `Response`），
 * 由 router 翻译成 `json_response(data, status, headers)`。绝大多数成功直接返回裸数据即可。
 */
export class DurableObjectResult {
  /**
   * @param {unknown} data
   * @param {number} [status]
   * @param {HeadersInit} [headers]
   */
  constructor(data, status = 200, headers = {}) {
    this.data = data;
    this.status = status;
    this.headers = headers;
  }
}

/**
 * @param {unknown} data
 * @param {number} [status]
 * @param {HeadersInit} [headers]
 * @returns {DurableObjectResult}
 */
export function do_result(data, status = 200, headers = {}) {
  return new DurableObjectResult(data, status, headers);
}
