const object = properties => ({ type: "object", properties, additionalProperties: false });
const string = { type: "string" }, boolean = { type: "boolean" };
export const ADMIN_AGENT_SOURCE_FIELDS = Object.freeze(["title", "description", "website", "social_url", "social_urls", "feed_url", "category", "tags", "enabled", "require_token", "credit_cost", "sort_order", "source_type"]);
const source_fields = { title: string, description: string, website: string, social_url: { type: "string", description: "兼容单个社媒主页，空串清除" }, social_urls: { type: "array", items: string, description: "社媒主页，公开 HTTP(S) 地址；第一项用作 RSS/Atom 主页，空数组清除" }, feed_url: string, category: string,
  tags: { type: "array", items: string }, enabled: boolean, require_token: boolean, credit_cost: { type: "integer", minimum: 0, maximum: 1_000_000_000 }, sort_order: { type: "integer" }, source_type: string };
export const ADMIN_AGENT_TOOLS = Object.freeze([
  { name: "get_admin_context", description: "读取当前管理页面的任务、界面上下文和服务端实际状态。", parameters: object({}) },
  { name: "list_discovery_sources", description: "查询订阅源列表，包含停用源；可按关键词、来源和启用状态筛选，分页返回真实 ID。", parameters: object({ query: string, source_type: string, enabled: boolean, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 40 } }) },
  { name: "get_discovery_source", description: "按真实 ID 读取最新订阅源。编辑或删除前必须先读取当前记录。", parameters: { ...object({ source_id: string }), required: ["source_id"] } },
  { name: "create_discovery_source", description: "按用户明确的新建请求保存订阅源。至少填写真实 title 和 feed_url，不能编造地址。", parameters: { ...object({ source: { ...object(source_fields), required: ["title", "feed_url"] } }), required: ["source"] } },
  { name: "update_discovery_source", description: "按用户要求修改已读取的订阅源，只传需改变的字段。服务端保留缺省字段，检测并拒绝读取后已变更的记录。", parameters: { ...object({ source_id: string, patch: object(source_fields) }), required: ["source_id", "patch"] } },
  { name: "delete_discovery_source", description: "按用户明确的删除请求删除已读取且唯一确定的订阅源；不是停用，不可恢复。目标不明确时先询问用户。", parameters: { ...object({ source_id: string }), required: ["source_id"] } },
]);

export function admin_agent_tools(pathname) {
  return pathname === "/admin/discovery" ? ADMIN_AGENT_TOOLS : ADMIN_AGENT_TOOLS.slice(0, 1);
}
