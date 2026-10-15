import { ScriptAgentModel, ScriptAgentPanelView } from "./script_agent.js";
import { admin_agent_page } from "../../server/lib/admin_agent_context.js";

export function AdminAgentModel({ ui, request_json, location = () => window.location.href, create_socket, new_id }) {
  const page = ui.ref(admin_agent_page(new URL(location()).pathname) || admin_agent_page("/admin/overview"));
  const editor_open = ui.ref(false);
  const open = ui.ref(false), adapters = new Map();
  const agent = ScriptAgentModel({ ui, request_json, location, create_socket, new_id, socket_path: "/admin/api/agent/ws",
    get_context: () => ({ ready: true, pathname: page.value.pathname, page_context: adapters.get(page.value.pathname)?.read_context?.() || {} }),
    on_event(event) {
      if (event.type !== "resource_changed" || event.resource !== "discovery") return;
      Promise.resolve().then(() => adapters.get("/admin/discovery")?.on_change?.(event)).catch(error => {
        agent.state.error.set("操作已完成，但列表刷新失败：" + error.message);
      });
    },
  });
  const methods = {
    set_editor_open(value) { editor_open.set(Boolean(value)); },
    set_pathname(pathname) {
      const next = admin_agent_page(pathname);
      if (!next || next.pathname === page.value.pathname) return;
      agent.methods.close(); page.set(next);
      if (open.value) void agent.methods.start();
    },
    toggle() { open.set(!open.value); if (!open.value) agent.methods.close(); },
    close() { open.set(false); agent.methods.close(); },
    register_page(pathname, adapter) {
      const normalized = admin_agent_page(pathname)?.pathname;
      if (!normalized) return () => {};
      adapters.set(normalized, adapter);
      return () => { if (adapters.get(normalized) === adapter) adapters.delete(normalized); };
    },
    destroy() { open.set(false); adapters.clear(); agent.destroy(); },
  };
  return { state: { page, open, editor_open }, agent, methods };
}

export function AdminAgentView({ ui, model }) {
  const { View, Show, Button, Icon, computed } = ui;
  return View({ class: computed(model.state.editor_open, open => "box-border " + (open ? "hidden" : "contents")), attributes: { n: "admin-global-agent" } }, [
    Button({ variant: "primary", class: "box-border fixed inset-inline-end-space-5 inset-block-end-space-5 rounded-card box-shadow-shadow-card flex-none max-760-inset-block-end", style: {
      "z-index": "8999",
      "min-height": "44px",
      "--max-760-inset-block-end": "calc(var(--frui-space-5) + 76px)"
    }, icon: Icon("sparkles", 18),
      attributes: { n: "admin-global-agent-toggle", "aria-label": "与小讯对话", "aria-expanded": computed(model.state.open, String), "aria-controls": "admin-global-agent-dialog" },
      onClick: model.methods.toggle }, ["小讯"]),
    Show({ when: model.state.open, ok: () => View({ class: "box-border fixed inset-inline-end-space-5 flex min-h-0 overflow-hidden rounded-card bg-surface box-shadow-shadow-card max-760-inset-inline-end max-760-inset-block-end max-760-height", style: {
      "inset-block-end": "calc(var(--frui-space-5) + 56px)",
      "z-index": "9000",
      "width": "min(460px, calc(100vw - 2 * var(--frui-space-4)))",
      "height": "min(660px, calc(100dvh - 100px))",
      "border": "1px solid var(--frui-color-border)",
      "--max-760-inset-inline-end": "var(--frui-space-4)",
      "--max-760-inset-block-end": "calc(var(--frui-space-5) + 128px)",
      "--max-760-height": "min(600px, calc(100dvh - 168px))"
    }, attributes: { n: "admin-global-agent-dialog", id: "admin-global-agent-dialog", role: "region", "aria-label": "XiaoxunAgent 管理助手" },
      onKeyDown(event) { if (event.key === "Escape" && !model.agent.state.config.value.open) { event.stopPropagation(); model.methods.close(); } },
    }, [ScriptAgentPanelView({ style: {
      flex: "1",
      border: "0",
      "--max-1100-height": "auto"
    }, ui, agent: model.agent, title: "XiaoxunAgent", on_close: model.methods.close,
      context_label: computed(model.state.page, value => `${value.title} · ${value.task}`),
      placeholder: "告诉小讯要查询或修改什么…",
    })]) }),
  ]);
}

if (typeof window !== "undefined" && window.FindRSSAdminUI) {
  const request_json = async (url, options = {}) => {
    const response = await window.FindRSSAdminAuth.fetch(url, { cache: "no-store", ...options,
      headers: { "Content-Type": "application/json", ...options.headers } });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "请求失败：HTTP " + response.status);
    return value;
  };
  let model;
  window.FindRSSAdminAgent = {
    View() { model ||= AdminAgentModel({ ui: window.FindRSSAdminUI, request_json }); return AdminAgentView({ ui: window.FindRSSAdminUI, model }); },
    set_editor_open(value) { model?.methods.set_editor_open(value); },
    set_pathname(pathname) { model?.methods.set_pathname(pathname); },
    register_page(pathname, adapter) { model ||= AdminAgentModel({ ui: window.FindRSSAdminUI, request_json }); return model.methods.register_page(pathname, adapter); },
    stop() { model?.methods.destroy(); model = null; },
  };
  window.addEventListener?.("pagehide", () => window.FindRSSAdminAgent.stop());
}
