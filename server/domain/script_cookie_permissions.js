import { public_http_url } from "../lib/proxy_url.js";

export function ScriptCookiePermissionsModel(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("permissions 必须是对象");
  const entries = value.cookies ?? [];
  if (!Array.isArray(entries) || entries.length > 32) throw new Error("permissions.cookies 必须是最多 32 项的数组");
  const ids = new Set();
  const cookies = entries.map(entry => {
    if (!entry || typeof entry !== "object") throw new Error("Cookie 权限必须是对象");
    const { id, origin, path_prefix, names, purpose } = entry;
    if (typeof id !== "string" || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(id) || ids.has(id)) throw new Error("Cookie 权限 id 无效或重复");
    ids.add(id);
    const valid_url = public_http_url(origin);
    const url = valid_url ? new URL(valid_url) : null;
    if (!url || url.protocol !== "https:" || url.origin !== origin) throw new Error("Cookie origin 必须是完整 HTTPS origin");
    if (typeof path_prefix !== "string" || !path_prefix.startsWith("/") || /[?#%\\\s]/.test(path_prefix) || new URL(path_prefix, origin).pathname !== path_prefix) throw new Error("Cookie path_prefix 必须是规范的绝对路径");
    if (!Array.isArray(names) || !names.length || names.length > 32 || new Set(names).size !== names.length || names.some(name => typeof name !== "string" || name.includes("*") || !/^[!#$&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name))) throw new Error("Cookie names 必须明确列出名称，不能使用通配符");
    if (typeof purpose !== "string" || !purpose.trim() || purpose.length > 500) throw new Error("Cookie purpose 必须说明读取用途");
    return Object.freeze({ id, origin, path_prefix, names: Object.freeze([...names].sort()), purpose: purpose.trim() });
  }).sort((a, b) => a.id.localeCompare(b.id));
  return Object.freeze({ cookies: Object.freeze(cookies), toValue: () => ({ cookies: cookies.map(entry => ({ ...entry, names: [...entry.names] })) }) });
}
ScriptCookiePermissionsModel.of = ScriptCookiePermissionsModel;
