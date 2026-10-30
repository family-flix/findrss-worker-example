import { cookie_header } from "./rss_cookies.js";

// 句柄只在本次执行有效；Cookie 明文从不进入沙箱。
export class ScriptCookieAccess {
  constructor({
    permissions,
    cookies,
    assert_grant
  }) {
    this.permissions = permissions;
    this.cookies = cookies;
    this.assert_grant = assert_grant;
    this.handles = new Map();
    this.records = [];
  }
  async get(id) {
    await this.assert_grant();
    const entry = this.permissions.cookies.find(entry => entry.id === id);
    if (!entry) throw new Error("未声明 Cookie 权限：" + id);
    const handle = [...this.handles].find(([, current]) => current === entry)?.[0] || crypto.randomUUID();
    this.handles.set(handle, entry);
    if (this.records.length < 200) this.records.push({
      permission: id,
      action: "get",
      names: [...entry.names],
      granted: true
    });
    return {
      id: handle,
      names: [...entry.names]
    };
  }
  async entry(handle) {
    await this.assert_grant();
    const entry = this.handles.get(handle?.id);
    if (!entry) throw new Error("Cookie 句柄无效或不属于本次执行");
    return entry;
  }
  async allows(handle, target) {
    const entry = await this.entry(handle);
    return !/%/i.test(target.pathname) && target.origin === entry.origin && (target.pathname === entry.path_prefix || target.pathname.startsWith(entry.path_prefix.endsWith("/") ? entry.path_prefix : entry.path_prefix + "/"));
  }
  async header(handle, target, derived = {}) {
    const entry = await this.entry(handle);
    if (!(await this.allows(handle, target))) throw new Error("请求地址超出 Cookie 授权范围");
    if (Object.values(derived || {}).some(name => !entry.names.includes(name))) throw new Error("派生请求头使用了未授权的 Cookie 名称");
    const selected = (await this.cookies()).filter(cookie => entry.names.includes(cookie.name));
    const header = cookie_header(selected, target);
    if (this.records.length < 200) this.records.push({
      permission: entry.id,
      action: "send",
      target: target.origin + target.pathname,
      names: header ? header.split("; ").map(pair => pair.slice(0, pair.indexOf("="))) : [],
      granted: true
    });
    return header;
  }
}
