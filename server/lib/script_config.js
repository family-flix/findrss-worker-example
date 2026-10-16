const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const keywords = new Set(["$schema", "$id", "type", "title", "description", "properties", "required", "additionalProperties", "items", "enum", "enumDescriptions", "default", "minLength", "maxLength", "pattern", "minimum", "maximum", "minItems", "maxItems", "writeOnly"]);

// shortcut: 支持配置表单所需的 JSON Schema 子集；需要 $ref/组合 schema 时扩展统一校验与渲染。
export function validate_config_schema(schema, path = "config_schema", depth = 0) {
  if (schema === undefined && depth === 0) return;
  if (!object(schema) || depth > 8) throw new Error(path + " 必须是对象，嵌套不能超过 8 层");
  for (const key of Object.keys(schema)) if (!keywords.has(key)) throw new Error(path + " 暂不支持 " + key);
  if (!["object", "array", "string", "number", "integer", "boolean"].includes(schema.type)) throw new Error(path + ".type 无效");
  if (depth === 0 && schema.type !== "object") throw new Error("config_schema.type 必须是 object");
  for (const key of ["title", "description", "$schema", "$id", "pattern"]) {
    if (schema[key] !== undefined && typeof schema[key] !== "string") throw new Error(path + "." + key + " 必须是字符串");
  }
  if (schema.writeOnly !== undefined && typeof schema.writeOnly !== "boolean") throw new Error(path + ".writeOnly 必须是布尔值");
  for (const key of ["minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum"]) {
    if (schema[key] !== undefined && (!Number.isFinite(schema[key]) || (!["minimum", "maximum"].includes(key) && (!Number.isInteger(schema[key]) || schema[key] < 0)))) throw new Error(path + "." + key + " 无效");
  }
  for (const [min, max] of [["minLength", "maxLength"], ["minItems", "maxItems"], ["minimum", "maximum"]]) {
    if (schema[min] > schema[max]) throw new Error(path + "." + min + " 不能大于 " + max);
  }
  if (schema.pattern !== undefined) new RegExp(schema.pattern, "u");
  if (schema.type === "object") {
    if (!object(schema.properties)) throw new Error(path + ".properties 必须是对象");
    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") throw new Error(path + ".additionalProperties 只支持布尔值");
    if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some(key => typeof key !== "string" || !Object.hasOwn(schema.properties, key)))) throw new Error(path + ".required 必须引用已声明字段");
    for (const [key, child] of Object.entries(schema.properties)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error(path + " 包含非法字段名");
      validate_config_schema(child, path + "." + key, depth + 1);
    }
  }
  if (schema.type === "array") {
    if (!schema.items) throw new Error(path + ".items 必须声明元素类型");
    validate_config_schema(schema.items, path + "[]", depth + 1);
  }
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || !schema.enum.length || schema.enum.some(value => !["string", "number", "boolean"].includes(typeof value))) throw new Error(path + ".enum 必须是非空的标量数组");
    for (const value of schema.enum) validate_value({ ...schema, enum: undefined }, value, path);
  }
  if (schema.enumDescriptions !== undefined && (!Array.isArray(schema.enumDescriptions) || schema.enumDescriptions.length !== schema.enum?.length || schema.enumDescriptions.some(value => typeof value !== "string"))) throw new Error(path + ".enumDescriptions 必须与 enum 一一对应");
  if (Object.hasOwn(schema, "default")) validate_value(schema, config_defaults(schema, schema.default), path + ".default");
}

export function config_defaults(schema, value) {
  if (!schema) return value ?? {};
  if (value === undefined && Object.hasOwn(schema, "default")) value = structuredClone(schema.default);
  if (schema.type === "object" && object(value)) {
    const result = { ...value };
    for (const [key, child] of Object.entries(schema.properties)) {
      const next = config_defaults(child, Object.hasOwn(value, key) ? value[key] : undefined);
      if (next !== undefined) result[key] = next;
    }
    return result;
  }
  if (schema.type === "array" && Array.isArray(value)) return value.map(item => config_defaults(schema.items, item));
  return value;
}

function validate_value(schema, value, path) {
  const type = schema.type;
  if (type === "object" ? !object(value) : type === "array" ? !Array.isArray(value) : type === "integer" ? !Number.isInteger(value) : typeof value !== type || type === "number" && !Number.isFinite(value)) throw new Error(path + " 必须是 " + type);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(path + " 必须选择枚举中的值");
  if (type === "object") {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw new Error(path + "." + key + " 为必填项");
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(schema.properties, key)) validate_value(schema.properties[key], child, path + "." + key);
      else if (schema.additionalProperties === false) throw new Error(path + "." + key + " 未声明");
    }
  }
  if (type === "string") {
    const length = [...value].length;
    if (length < schema.minLength || length > schema.maxLength) throw new Error(path + " 长度不符合要求");
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) throw new Error(path + " 格式不符合要求");
  }
  if (["number", "integer"].includes(type) && (value < schema.minimum || value > schema.maximum)) throw new Error(path + " 超出允许范围");
  if (type === "array") {
    if (value.length < schema.minItems || value.length > schema.maxItems) throw new Error(path + " 数组长度不符合要求");
    value.forEach((item, index) => validate_value(schema.items, item, path + "[" + index + "]"));
  }
}

export function script_config_value(schema, value = {}) {
  if (!object(value)) throw new Error("脚本配置必须是 JSON 对象");
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 32768) throw new Error("脚本配置不能超过 32KB");
  if (!schema) {
    if (Object.keys(value).length) throw new Error("脚本未声明 config_schema");
    return {};
  }
  const config = config_defaults(schema, value);
  if (new TextEncoder().encode(JSON.stringify(config)).byteLength > 32768) throw new Error("脚本配置不能超过 32KB");
  validate_value(schema, config, "配置");
  return config;
}
