// 脚本标签与目录筛选共用的边界；旧元数据容错读取，发布时严格校验。
export function script_tags(value = [], { strict = false } = {}) {
  if (!Array.isArray(value) || value.some(tag => typeof tag !== "string"
    || !tag.trim() || tag.trim().length > 32 || /[\u0000-\u001f\u007f]/.test(tag))) {
    if (strict) throw new Error("tags 必须是字符串数组，每个标签为 1–32 字符且不含控制字符");
    return [];
  }
  const tags = [...new Set(value.map(tag => tag.trim()))];
  if (tags.length > 13) {
    if (strict) throw new Error("tags 最多包含 13 个不同标签");
    return tags.slice(0, 13);
  }
  return tags;
}
