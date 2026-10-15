import { public_http_url } from "../lib/proxy_url.js";
import { valid_identifier } from "../lib/identifiers.js";
import { ScriptVersionModel } from "./script_version.js";

const fail = message => ({ ok: false, error: { status: 400, message } });

const identifier = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(value);
const safe_endpoint = value => {
  if (!public_http_url(value)) return false;
  const url = new URL(value.trim());
  return !url.search && !url.hash && !/\.(internal|lan|home)$/i.test(url.hostname);
};
const copy_provider = provider => ({ id: provider.id, name: provider.name, type: provider.type, enabled: provider.enabled,
  ...(provider.preset_id ? { preset_id: provider.preset_id } : {}), base_url: provider.base_url,
  api_key_secret_name: provider.api_key_secret_name || "",
  ...(provider.api_key_configured ? { api_key_configured: true, api_key_source: provider.api_key_source } : {}),
  models: provider.models.map(model => ({ id: model.id, name: model.name, model: model.model, enabled: model.enabled, options: { ...model.options } })),
});
const freeze_provider = provider => Object.freeze({ ...copy_provider(provider), models: Object.freeze(provider.models.map(model => Object.freeze({ ...model, options: Object.freeze({ ...model.options }) }))) });
export function ScriptAgentSettingsModel(state = {}) {
  const base_url = String(state.base_url || ""), model = String(state.model || ""), api_key = String(state.api_key || "");
  const has_api_key = Boolean(state.has_api_key || api_key);
  const providers = Object.freeze((state.providers || []).map(freeze_provider));
  return Object.freeze({ base_url, model, api_key, has_api_key, providers,
    toValue: () => ({ base_url, model, has_api_key,
      configured: providers.length ? providers.some(p => p.enabled && (p.type === "workers_ai" ? state.workers_ai_available : p.api_key_configured) && p.models.some(m => m.enabled && m.model)) : Boolean(base_url && model && has_api_key),
      providers: providers.map(copy_provider), workers_ai_available: Boolean(state.workers_ai_available) }),
  });
}
ScriptAgentSettingsModel.of = ScriptAgentSettingsModel;
ScriptAgentSettingsModel.fromBody = body => {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("模型设置必须是 JSON 对象");
  if (!Array.isArray(body.providers)) return parse_legacy_settings(body);
  if (body.providers.length > 16) return fail("最多配置 16 个厂商");
  const providers = [], seen = new Set();
  for (const raw of body.providers) {
    if (!raw || !identifier(raw.id) || seen.has(raw.id)) return fail("厂商标识无效或重复");
    seen.add(raw.id);
    if (!["openai_compat", "workers_ai"].includes(raw.type)) return fail("不支持的模型厂商类型");
    const base_url = typeof raw.base_url === "string" ? raw.base_url.trim() : "";
    if (base_url && !safe_endpoint(base_url)) return fail("接口地址必须是公开 HTTP(S) 地址，不能包含 query 或 fragment");
    if (raw.api_key_secret_name && !/^READER_AI_[A-Z0-9_]{1,64}$/.test(raw.api_key_secret_name)) return fail("无效的模型环境密钥名称");
    if (!Array.isArray(raw.models) || raw.models.length > 32) return fail("每个厂商最多配置 32 个模型");
    const models = [], model_ids = new Set();
    for (const m of raw.models) {
      if (!m || !identifier(m.id) || model_ids.has(m.id)) return fail("模型标识无效或重复");
      model_ids.add(m.id);
      if (typeof m.model !== "string" || m.model.length > 200 || /[\x00-\x1f]/.test(m.model)) return fail("模型名称格式无效");
      const options = {}, o = m.options || {};
      if (["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(o.reasoning_effort)) options.reasoning_effort = o.reasoning_effort;
      if (typeof o.temperature === "number" && Number.isFinite(o.temperature)) options.temperature = Math.max(0, Math.min(2, o.temperature));
      if (typeof o.max_tokens === "number" && Number.isFinite(o.max_tokens)) options.max_tokens = Math.max(1, Math.min(131072, Math.floor(o.max_tokens)));
      models.push({ id: m.id, name: String(m.name || m.model || m.id).slice(0, 128), model: m.model.trim(), enabled: m.enabled !== false, options });
    }
    providers.push({ id: raw.id, name: String(raw.name || raw.id).slice(0, 128), type: raw.type, enabled: raw.enabled !== false,
      preset_id: typeof raw.preset_id === "string" ? raw.preset_id.slice(0, 64) : "", base_url: base_url.replace(/\/+$/, ""),
      api_key_secret_name: raw.api_key_secret_name || "", models });
  }
  return { ok: true, model: ScriptAgentSettingsModel({ providers }) };
};
const parse_legacy_settings = body => {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("模型设置必须是 JSON 对象");
  if (typeof body.base_url !== "string" || !public_http_url(body.base_url)) return fail("接口地址必须是公开 HTTP(S) 地址");
  const url = new URL(body.base_url.trim());
  if (url.search || url.hash || /\.(internal|lan|home)$/i.test(url.hostname)) return fail("接口地址不能包含 query、fragment 或内网主机");
  if (typeof body.model !== "string" || !body.model.trim() || body.model.length > 200 || /[\x00-\x1f]/.test(body.model)) return fail("填写有效的模型名称（最多 200 字符）");
  if (body.api_key !== undefined && (typeof body.api_key !== "string" || body.api_key.length > 4096 || /[\r\n]/.test(body.api_key))) return fail("API Key 格式无效");
  return { ok: true, model: ScriptAgentSettingsModel({ base_url: url.href.replace(/\/+$/, ""), model: body.model.trim(), api_key: body.api_key?.trim() }) };
};

export function ScriptAgentRunRequestModel(state = {}) {
  const run_id = String(state.run_id || ""), script = String(state.script || ""), request_url = String(state.request_url || ""), route = String(state.route || "");
  const revision = Number(state.revision || 0);
  const provider_id = String(state.provider_id || ""), model_id = String(state.model_id || "");
  const messages = Object.freeze((state.messages || []).map(message => Object.freeze({ role: message.role, content: message.content })));
  const authorization_fields = { ...(state.version === undefined ? {} : { version: state.version }),
    ...(state.cookie_grant_id === undefined ? {} : { cookie_grant_id: state.cookie_grant_id }) };
  return Object.freeze({ run_id, script, request_url, route, revision, messages, provider_id, model_id, ...authorization_fields,
    toValue: () => ({ run_id, script, request_url, route, revision, provider_id, model_id, ...authorization_fields, messages: messages.map(message => ({ ...message })) }),
  });
}
ScriptAgentRunRequestModel.of = ScriptAgentRunRequestModel;
ScriptAgentRunRequestModel.MAX_STEPS = 8;
ScriptAgentRunRequestModel.MAX_MESSAGE_BYTES = 1024 * 1024;
ScriptAgentRunRequestModel.fromBody = body => {
  if (!body || typeof body !== "object" || !valid_identifier(body.run_id)) return fail("无效的对话运行标识");
  const parsed_version = ScriptVersionModel.parse(body.version);
  if (!parsed_version.ok) return parsed_version;
  if (body.cookie_grant_id !== undefined && (typeof body.cookie_grant_id !== "string" || body.cookie_grant_id && !valid_identifier(body.cookie_grant_id))) return fail("无效的 Cookie 授权标识");
  if ((body.provider_id || body.model_id) && (!identifier(body.provider_id) || !identifier(body.model_id))) return fail("无效的对话模型选择");
  if (typeof body.script !== "string" || body.script.length > 128 * 1024) return fail("脚本内容须是 128KB 以内的字符串");
  if (!Number.isSafeInteger(body.revision) || body.revision < 0) return fail("无效的草稿版本");
  if (typeof body.request_url !== "string" || body.request_url.length > 8192) return fail("调试链接过长或格式无效");
  if (body.route !== undefined && (typeof body.route !== "string" || body.route.length > 128)) return fail("无效的脚本标识");
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 24) return fail("对话历史须包含 1–24 条消息");
  let bytes = 0;
  for (const message of body.messages) {
    if (!message || !["user", "assistant"].includes(message.role) || typeof message.content !== "string" || message.content.length > 16 * 1024) return fail("对话只接受 user/assistant 文本消息，每条最多 16KB");
    bytes += new TextEncoder().encode(message.content).length;
  }
  if (bytes > 64 * 1024) return fail("对话历史超过 64KB，请新建对话");
  if (body.messages.at(-1).role !== "user" || !body.messages.at(-1).content.trim()) return fail("填写本次对话内容");
  return { ok: true, model: ScriptAgentRunRequestModel({ ...body,
    ...(body.version === undefined ? {} : { version: parsed_version.model.version }) }) };
};
ScriptAgentRunRequestModel.TOOLS = Object.freeze([
  { name: "get_script_draft", description: "读取当前完整 ES 模块草稿、版本和调试链接。", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "edit_script_draft", description: "替换当前完整脚本草稿并立即同步到代码编辑器。先读取草稿；只修改草稿，不保存或发布。", parameters: {
    type: "object", properties: { script: { type: "string", description: "完整 ES 模块代码，导出 route 或 routes" }, revision: { type: "integer", description: "最近读取的草稿版本" } }, required: ["script", "revision"], additionalProperties: false } },
  { name: "debug_script_draft", description: "按工作区实际链接运行当前草稿，读取输出、日志、上游请求与错误。会使用真实抓取和在线设备。", parameters: {
    type: "object", properties: { revision: { type: "integer", description: "当前草稿版本" } }, required: ["revision"], additionalProperties: false } },
]);
