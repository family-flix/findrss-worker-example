// 日志脱敏与元数据截断：设备日志（device_logs）与 脚本日志（script_logs）共用。
//
// 两张表的 metadata/params/query/lines 都是外部可控的任意 JSON，既要落库也要打到
// CF Workers Logs，所以统一在这一层处理：
// - 键名先按 camelCase → snake_case 归一（`accessToken` 与 `access_token` 都要命中），
//   命中 SENSITIVE_LOG_FIELD_PATTERN 的整值替换为 "[redacted]"；
// - 递归深度封顶，循环引用与超深对象都在这里止住（不抛错、不爆栈）；
// - 序列化后超过上限只留 preview，避免单条日志撑爆存储。
//
// 纯模块，可在 node --test 下直接覆盖。

/**
 * 命中即整值替换为 "[redacted]"。匹配的是**归一化后的键名**，
 * 因此 `authToken`、`x-api-token`、`Secret`、`cookie_value` 都会命中。
 */
export const SENSITIVE_LOG_FIELD_PATTERN =
  /(^|[-_])(authorization|cookie|password|passwd|secret|token)([-_]|$)/i;

/** 单条日志 metadata_json 的长度上限，超出即截断为 preview。 */
export const MAX_LOG_METADATA_LENGTH = 64 * 1024;

/** 递归深度上限。 */
export const MAX_LOG_DEPTH = 12;

/**
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {unknown}
 */
export function redact_log_value(value, depth = 0) {
  if (depth >= MAX_LOG_DEPTH) return "[max depth]";
  if (Array.isArray(value)) {
    return value.map((item) => redact_log_value(item, depth + 1));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  /** @type {Record<string, unknown>} */
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const normalized_key = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
    result[key] = SENSITIVE_LOG_FIELD_PATTERN.test(normalized_key)
      ? "[redacted]"
      : redact_log_value(item, depth + 1);
  }
  return result;
}

/**
 * 脱敏 → 序列化 → 截断，永不抛错：落库的 metadata 一定是合法 JSON 字符串。
 * @param {unknown} metadata
 * @returns {string}
 */
export function serialize_log_metadata(metadata) {
  let value;
  try {
    value = JSON.stringify(redact_log_value(metadata ?? {}));
  } catch (error) {
    value = JSON.stringify({
      serialization_error: error instanceof Error ? error.message : String(error),
    });
  }
  if (value.length <= MAX_LOG_METADATA_LENGTH) {
    return value;
  }
  return JSON.stringify({
    truncated: true,
    original_length: value.length,
    preview: value.slice(0, MAX_LOG_METADATA_LENGTH - 200),
  });
}
