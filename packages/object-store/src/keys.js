// key 代数：校验、拼接、前缀。
//
// 这里的规则**结构化地**让调用方无法逃出自己的前缀：key 不能是绝对路径（前导 `/`）、
// 不能有 `..`/`.` 段、不能有反斜杠或控制字符。因此拼接后的完整 key
// （`store.prefix + key`）永远落在 store 自己的命名空间里。

import { utf8_length } from "./bytes.js";

/** key 的 UTF-8 字节上限（对齐 S3 的 1024）。 */
export const MAX_KEY_LENGTH = 1024;

/** 控制字符：key 里出现即拒绝。 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** SDK 的所有可预期失败都带一个稳定的 `code`。 */
export class ObjectStoreError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "ObjectStoreError";
    this.code = code;
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function assert_key(value) {
  if (typeof value !== "string") throw new ObjectStoreError("invalid_key", "key must be a string");
  if (value.length === 0) throw new ObjectStoreError("invalid_key", "key must not be empty");
  if (utf8_length(value) > MAX_KEY_LENGTH) {
    throw new ObjectStoreError("invalid_key", `key exceeds ${MAX_KEY_LENGTH} bytes`);
  }
  if (value.startsWith("/")) throw new ObjectStoreError("invalid_key", "key must not start with /");
  if (value.endsWith("/")) throw new ObjectStoreError("invalid_key", "key must not end with /");
  if (value.includes("//")) throw new ObjectStoreError("invalid_key", "key must not contain //");
  if (value.includes("\\")) throw new ObjectStoreError("invalid_key", "key must not contain \\");
  if (CONTROL_CHARS.test(value)) throw new ObjectStoreError("invalid_key", "key must not contain control characters");
  for (const segment of value.split("/")) {
    if (segment === "." || segment === "..") {
      throw new ObjectStoreError("invalid_key", "key must not contain . or .. segments");
    }
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function is_valid_key(value) {
  try {
    assert_key(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * 校验并原样返回 key；非法输入抛 `ObjectStoreError("invalid_key")`。
 * @param {unknown} value
 * @returns {string}
 */
export function normalize_key(value) {
  return assert_key(value);
}

/**
 * 把若干段拼成一个 key；空段被丢弃，每段的首尾 `/` 先剥掉，再整体校验。
 * 全部为空时抛 `invalid_key`（调用方不该拼出一个空 key）。
 * @param {...unknown} segments
 * @returns {string}
 */
export function join_key(...segments) {
  const parts = segments
    .map((segment) => (segment === null || segment === undefined ? "" : String(segment)))
    .map((segment) => segment.replace(/^\/+/, "").replace(/\/+$/, ""))
    .filter((segment) => segment !== "");
  return assert_key(parts.join("/"));
}

/**
 * 归一一个**前缀**：空输入返回 `""`，否则保证尾部恰好一个 `/`。
 * 前缀内部仍走 key 的校验（拒绝 `..`、`//`、控制字符、反斜杠）。
 * @param {unknown} value
 * @returns {string}
 */
export function key_prefix(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.replace(/^\/+/, "");
  if (trimmed === "" || trimmed === "/") return "";
  const body = trimmed.replace(/\/+$/, "");
  if (body === "") return "";
  assert_key(body);
  return `${body}/`;
}
