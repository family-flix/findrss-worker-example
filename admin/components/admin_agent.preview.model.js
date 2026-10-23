import { AdminAgentModel } from "./admin_agent.js";

export function AdminAgentPreviewModel({ ui }) {
  const settings = {
    configured: true,
    providers: [
      {
        id: "preview",
        name: "预览模型",
        type: "openai_compat",
        enabled: true,
        base_url: "https://preview.invalid/v1",
        api_key_configured: true,
        models: ["chat", "reasoning"].map((id) => ({
          id,
          name: id === "chat" ? "对话模型" : "推理模型",
          model: id,
          enabled: true,
          options: {},
        })),
      },
    ],
  };
  let next_id = 0;
  const model = AdminAgentModel({
    ui,
    location: () => "https://preview.invalid/admin/discovery",
    new_id: () => "preview-" + ++next_id,
    async request_json(url, options = {}) {
      // shortcut: 仅模拟设置读取和对话，预览设置保存或连通测试时再补充接口。
      if (
        url === "/admin/api/scripts/agent/settings" &&
        (!options.method || options.method === "GET")
      )
        return settings;
      throw new Error("组件预览不保存设置或连接真实模型。");
    },
    create_socket() {
      const socket = {
        readyState: 0,
        send(data) {
          const request = JSON.parse(data);
          if (request.type !== "run") return;
          queueMicrotask(() => {
            if (socket.readyState !== 1) return;
            socket.onmessage?.({
              data: JSON.stringify({
                type: "done",
                run_id: request.run_id,
                content:
                  "这是 XiaoxunAgent 的本地预览回复。可以继续提问、切换模型或开始新对话。",
              }),
            });
          });
        },
        close() {
          socket.readyState = 3;
        },
      };
      queueMicrotask(() => {
        if (socket.readyState !== 0) return;
        socket.readyState = 1;
        socket.onopen?.();
      });
      return socket;
    },
  });
  model.agent.state.messages.as([
    { id: "preview-user", role: "user", content: "帮我查看订阅源的状态。" },
    {
      id: "preview-assistant",
      role: "assistant",
      content:
        "这里是订阅源管理助手的组件预览。你可以查询订阅源、调整设置，或让我协助整理订阅。\n\n当前展示的是 mock 数据，预览对话不会修改真实订阅源。",
    },
  ]);
  model.methods.toggle();
  return model;
}
