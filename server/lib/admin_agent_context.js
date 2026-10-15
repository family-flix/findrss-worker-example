export const ADMIN_AGENT_PAGES = Object.freeze({
  overview: { title: "运行概览", task: "了解设备、任务队列和服务状态" },
  devices: { title: "设备管理", task: "查看在线设备、可调用方法与并发容量" },
  messages: { title: "消息", task: "查看管理后台消息" },
  users: { title: "用户管理", task: "了解账号与用户 Token 管理；当前助手不能修改账号或凭证" },
  activity: { title: "用户日志", task: "了解用户操作与积分流水；当前助手不能修改日志或积分" },
  discovery: { title: "订阅源管理", task: "查询、新增、编辑、删除订阅源，调整标签、平台、排序、启用状态及 token 访问要求" },
  scripts: { title: "脚本管理", task: "了解 脚本与返回格式；进入脚本编辑器后使用三栏中的脚本助手实时编辑代码和 Debug" },
  cookies: { title: "Cookie 管理", task: "了解抓取 Cookie 的配置；当前助手不能读取或修改 Cookie 密钥" },
  redemptions: { title: "兑换卡管理", task: "了解积分兑换活动；当前助手不能创建、删除活动或读取兑换码" },
});

export function admin_agent_page(pathname) {
  const aliases = { "/admin/": "overview", "/admin": "overview", "/admin/index.html": "overview", "/admin/devices.html": "devices", "/admin/discovery-admin.html": "discovery", "/admin/rss-scripts.html": "scripts" };
  const key = aliases[pathname] || String(pathname || "").match(/^\/admin\/([a-z]+)\/?$/)?.[1];
  const value = Object.hasOwn(ADMIN_AGENT_PAGES, key || "") ? ADMIN_AGENT_PAGES[key] : null;
  return value ? { id: key, pathname: "/admin/" + key, ...value } : null;
}
