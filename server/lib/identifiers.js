// 标识符与访问 token 的字符串形状校验。
//
// 这些值全部来自外部（URL 段、请求体、Authorization 头），在 index.js 里被校验几十次。
// 放在一起是为了让「什么算合法 id」只有一处定义。
//
// 纯模块，可在 node --test 下直接覆盖。

/** 访问 token 最短长度。 */
export const MIN_ACCESS_TOKEN_LENGTH = 16;
/** 访问 token 最长长度，挡住把 token 当载荷灌进来的请求。 */
export const MAX_ACCESS_TOKEN_LENGTH = 256;

/**
 * 设备 id / 用户 id 的统一形状：首字符是字母或数字，其余允许 `.`/`_`/`:`/`-`，
 * 总长 1–128。UUID、`api_call_xxx`、`reader:local` 都在范围内。
 * @param {string} value
 * @returns {boolean}
 */
export function valid_identifier(value) {
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
}

/**
 * URL 段里的 id 可能被百分号编码，先解码再套 valid_identifier；
 * 解码失败（畸形 `%`）或形状不合法都回 null，调用方据此回 400。
 * @param {string} value
 * @returns {string | null}
 */
export function decode_identifier(value) {
  try {
    const decoded = decodeURIComponent(value);
    return valid_identifier(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * 常量时间字符串比较：逐字节异或累积，长度差也混进同一位，
 * 因此比较结果不泄露「前缀对了多少」。用于比对 device token / admin token。
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
export function safe_equal(left, right) {
  const encoder = new TextEncoder();
  const left_bytes = encoder.encode(left);
  const right_bytes = encoder.encode(right);
  const length = Math.max(left_bytes.length, right_bytes.length);
  let difference = left_bytes.length ^ right_bytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left_bytes[index] ?? 0) ^ (right_bytes[index] ?? 0);
  }
  return difference === 0;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
export function valid_access_token(value) {
  return (
    value.length >= MIN_ACCESS_TOKEN_LENGTH &&
    value.length <= MAX_ACCESS_TOKEN_LENGTH &&
    /^[A-Za-z0-9._~+/=-]+$/.test(value)
  );
}

/**
 * 列表页展示用的掩码：留前缀与末 4 位。`api_call_` 前缀本身是公开格式，
 * 所以多留几位以便用户分辨是哪一条。
 * @param {string} token
 * @returns {string}
 */
export function access_token_hint(token) {
  const visible_prefix_length = token.startsWith("api_call_") ? 20 : 4;
  return token.slice(0, visible_prefix_length) + "…" + token.slice(-4);
}

// 访问 token 本体：32 字节随机 → base64url，前缀 api_call_ 便于肉眼识别来源。
/** @returns {string} */
export function generate_access_token() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return "api_call_" + btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
