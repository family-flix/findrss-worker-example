import { ScriptAgentRunRequestModel } from "./script_agent.js";
import { admin_agent_page } from "../lib/admin_agent_context.js";

function frozen_data(value) {
  if (value && typeof value === "object") { for (const child of Object.values(value)) frozen_data(child); Object.freeze(value); }
  return value;
}
export function AdminAgentRunRequestModel(state = {}) {
  const request = ScriptAgentRunRequestModel({ ...state, script: "", request_url: "", route: "", revision: 0 });
  const page = admin_agent_page(state.pathname) || admin_agent_page("/admin/overview");
  const page_context = frozen_data(JSON.parse(JSON.stringify(state.page_context || {})));
  return Object.freeze({ run_id: request.run_id, messages: request.messages, provider_id: request.provider_id, model_id: request.model_id,
    pathname: page.pathname, page_context,
    toValue: () => ({ run_id: request.run_id, messages: request.messages.map(message => ({ ...message })), provider_id: request.provider_id, model_id: request.model_id,
      pathname: page.pathname, page_context: JSON.parse(JSON.stringify(page_context)) }),
  });
}
AdminAgentRunRequestModel.of = AdminAgentRunRequestModel;
AdminAgentRunRequestModel.MAX_MESSAGE_BYTES = ScriptAgentRunRequestModel.MAX_MESSAGE_BYTES;
AdminAgentRunRequestModel.fromBody = body => {
  const parsed = ScriptAgentRunRequestModel.fromBody({ ...body, script: "", request_url: "", route: "", revision: 0 });
  if (!parsed.ok) return parsed;
  if (!admin_agent_page(body.pathname)) return { ok: false, error: { status: 400, message: "无效的管理页面上下文" } };
  const context = body.page_context ?? {};
  if (typeof context !== "object" || context === null || Array.isArray(context) || new TextEncoder().encode(JSON.stringify(context)).length > 16 * 1024) {
    return { ok: false, error: { status: 400, message: "页面上下文须是 16KB 以内的对象" } };
  }
  return { ok: true, model: AdminAgentRunRequestModel({ ...body, page_context: context }) };
};
