import { ScriptAgentRunRequestModel } from "./server/domain/script_agent.js";
import { SCRIPT_AGENT_DURATION_MS } from "./server/lib/script_agent_protocol.js";

export function script_agent_socket(
  request,
  service,
  {
    request_model = ScriptAgentRunRequestModel,
    run = (input, emit, signal) => service.run(input, emit, signal),
  } = {},
) {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("websocket upgrade required", { status: 426 });
  }
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  const session = create_script_agent_session(service, value => server.send(JSON.stringify(value)), { request_model, run });
  server.addEventListener("close", session.close);
  server.addEventListener("error", session.close);
  server.addEventListener("message", event => session.receive(event.data));
  return new Response(null, { status: 101, webSocket: client });
}

export function create_script_agent_session(service, emit, {
  request_model = ScriptAgentRunRequestModel,
  run = (input, send, signal) => service.run(input, send, signal),
} = {}) {
  let active = null,
    closed = false;
  const send = (value) => {
    if (!closed) {
      try {
        emit(value);
      } catch {
        close();
      }
    }
  };
  const close = () => {
    closed = true;
    active?.controller.abort(new Error("对话连接已关闭"));
  };
  const receive = data => {
    if (closed) return;
    let run_id = "";
    try {
      if (
        typeof data !== "string" ||
        new TextEncoder().encode(data).length >
          request_model.MAX_MESSAGE_BYTES
      ) {
        throw new Error("对话请求过大或格式无效");
      }
      const command = JSON.parse(data);
      run_id = String(command.run_id || "");
      if (command.type === "cancel") {
        if (active?.run_id === run_id) {
          active.controller.abort(new Error("对话已停止"));
        }
        return;
      }
      if (command.type !== "run") {
        throw new Error("未知对话命令");
      }
      if (active) {
        throw new Error("上一轮对话尚未结束");
      }
      const parsed = request_model.fromBody(command);
      if (!parsed.ok) {
        throw new Error(parsed.error.message);
      }
      const controller = new AbortController();
      const current = { run_id, controller };
      active = current;
      const timer = setTimeout(
        () =>
          controller.abort(
            new Error("本轮对话已达到 3 分钟上限，请缩小任务范围后继续"),
          ),
        SCRIPT_AGENT_DURATION_MS,
      );
      send({ type: "start", run_id });
      const pending = run(
        parsed.model,
        (value) => {
          if (!controller.signal.aborted && active === current)
            send({ ...value, run_id });
        },
        controller.signal,
      )
        .catch((error) => {
          if (!closed)
            send({
              type: "error",
              run_id,
              error: controller.signal.aborted
                ? controller.signal.reason.message
                : error.error || error.message || "对话执行失败",
            });
        })
        .finally(() => {
          clearTimeout(timer);
          if (active === current) active = null;
        });
      service.wait_until?.(pending);
    } catch (error) {
      send({ type: "error", run_id, error: error.message || "对话请求失败" });
    }
  };
  send({ type: "ready", settings: service.settings() });
  return { receive, close };
}
