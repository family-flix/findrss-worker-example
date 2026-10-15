// 脚本 Agent 的兼容消息协议，沿用阅读器的工具消息与流式响应形状。
export const SCRIPT_AGENT_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
export const SCRIPT_AGENT_IDLE_MS = 60_000;
export const SCRIPT_AGENT_DURATION_MS = 180_000;

export function normalize_usage(raw = {}) {
  const count = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
  return { prompt_tokens: count(raw.prompt_tokens ?? raw.input_tokens), completion_tokens: count(raw.completion_tokens ?? raw.output_tokens) };
}

export function normalize_assistant_turn(payload) {
  const source = payload?.result && typeof payload.result === "object" ? payload.result : payload;
  const message = source?.choices?.[0]?.message ?? source;
  const raw_content = message?.content ?? message?.response;
  if (!message || typeof message !== "object") throw new Error("兼容端点返回了无效回答");
  const content = typeof raw_content === "string" ? raw_content : Array.isArray(raw_content)
    ? raw_content.map(part => part?.text || "").join("") : "";
  return { content, reasoning_content: message.reasoning_content || "",
    tool_calls: (Array.isArray(message.tool_calls) ? message.tool_calls : []).map((call, index) => {
      const fn = call.function ?? call;
      let args = fn.arguments ?? {};
      if (typeof args === "string") {
        try { args = JSON.parse(args || "{}"); } catch { throw new Error("模型返回了不完整的工具参数，未执行工具"); }
      }
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("模型工具参数必须是 JSON 对象");
      return { id: String(call.id || "call_" + index), name: String(fn.name || ""), arguments: args,
        ...(call.extra_content ? { extra_content: call.extra_content } : {}) };
    }), usage: normalize_usage(source.usage || {}) };
}

export function to_chat_messages(messages) {
  return messages.map(message => message.role === "assistant" && message.tool_calls?.length ? {
    role: "assistant", content: message.content || null,
    ...(message.reasoning_content ? { reasoning_content: message.reasoning_content } : {}),
    tool_calls: message.tool_calls.map(call => ({ id: call.id, type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      ...(call.extra_content ? { extra_content: call.extra_content } : {}) })),
  } : { role: message.role, content: message.content || "",
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id, name: message.name } : {}) });
}

export const tool_definitions = tools => tools.map(tool => ({ type: "function", function: tool }));

export function truncate_agent_text(value, max_bytes = 32 * 1024) {
  const bytes = new TextEncoder().encode(String(value ?? ""));
  return bytes.length > max_bytes ? new TextDecoder().decode(bytes.subarray(0, max_bytes)) + "\n[内容已截断]" : String(value ?? "");
}
