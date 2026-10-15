// SQL LIKE 通配符转义：订阅广场的关键词/标签搜索把用户输入拼进 LIKE 模式，
// 必须先把 `\`、`%`、`_` 转义掉，否则用户输入的通配符会改变匹配语义。
//
// 纯模块，只被 repository/ 与组合根使用。

/**
 * 转义 LIKE 通配符，供订阅广场的关键词搜索用。
 * @param {string} value
 * @returns {string}
 */
export function escape_like(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
