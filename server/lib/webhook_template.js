export const DEFAULT_WEBHOOK_TEMPLATE = '{"text":"小讯RSS：{{script_name}}\\n{{message}}\\n{{error_text}}"}';
const variables = new Set(["message", "error_text", "script_name", "path", "pathname", "route", "source", "phase", "created_at"]);

function map_template(value, replace, depth = 0) {
  if (depth > 20) throw new Error("Webhook 模板嵌套不能超过 20 层");
  if (typeof value === "string") return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => {
    if (!variables.has(name)) throw new Error("Webhook 模板变量不支持：" + name);
    return replace(name);
  });
  if (Array.isArray(value)) return value.map(item => map_template(item, replace, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, map_template(item, replace, depth + 1)]));
  }
  return value;
}

export function parse_webhook_template(template) {
  if (typeof template !== "string" || !template.trim() || template.length > 8192) {
    throw new Error("Webhook 模板必须是 1–8192 个字符的 JSON 对象");
  }
  let value;
  try { value = JSON.parse(template); } catch { throw new Error("Webhook 模板必须是有效 JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Webhook 模板必须是 JSON 对象");
  map_template(value, name => "{{" + name + "}}");
  return value;
}

export function render_webhook_template(template, message) {
  return map_template(parse_webhook_template(template), name => String(message[name] ?? ""));
}
