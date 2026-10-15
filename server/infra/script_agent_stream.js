// 沿用阅读器的 SSE 解帧与工具片段拼接逻辑。
import { normalize_assistant_turn, normalize_usage } from "../lib/script_agent_protocol.js";
import { SCRIPT_AGENT_RESPONSE_MAX_BYTES as READER_FETCH_MAX_BODY } from "../lib/script_agent_protocol.js";

// 真正按 SSE 事件边界解帧；读到 [DONE] 即结束，不等上游关闭 keep-alive 连接。
export async function read_chat_stream(response, { on_delta, timeout, on_activity } = {}) {
  if (!response.body) throw new Error("兼容端点返回了空的事件流");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const calls = new Map();
  let buffer = "", data_lines = [], content = "", reasoning_content = "", usage = {}, finished = false, done_marker = false, event_bytes = 0, retained_bytes = 0;
  const keep_text = (text, previous = "") => {
    retained_bytes += encoder.encode(text).byteLength - encoder.encode(previous).byteLength;
    if (retained_bytes > READER_FETCH_MAX_BODY) throw new Error("兼容端点生成内容超过大小上限");
    return text;
  };
  const dispatch = () => {
    if (!data_lines.length) return;
    const data = data_lines.join("\n").trim(); data_lines = []; event_bytes = 0;
    if (!data) return;
    if (data === "[DONE]") { done_marker = true; return; }
    let chunk;
    try { chunk = JSON.parse(data); } catch { throw new Error("兼容端点返回了无效的 SSE 数据，回答尚未完成"); }
    if (chunk?.error) throw new Error(`上游事件流返回错误：${chunk.error.message || "生成失败"}`);
    if (chunk?.usage) usage = normalize_usage(chunk.usage);
    const choice = chunk?.choices?.[0];
    if (choice?.finish_reason) finished = true;
    const piece = choice?.delta ?? choice?.message;
    if (!piece || typeof piece !== "object") return;
    if (typeof piece.content === "string" && piece.content) { content += keep_text(piece.content); on_delta?.(piece.content); }
    if (typeof piece.reasoning_content === "string") { reasoning_content += keep_text(piece.reasoning_content); on_activity?.("thinking"); }
    for (const [index, fragment] of (Array.isArray(piece.tool_calls) ? piece.tool_calls : []).entries()) {
      if (!fragment || typeof fragment !== "object") continue;
      on_activity?.("tool_call");
      const key = Number.isSafeInteger(fragment.index) ? fragment.index : index;
      if (!calls.has(key) && calls.size >= 1024) throw new Error("兼容端点单轮工具调用超过数量上限");
      const existing = calls.get(key) || { id: "", name: "", arguments: "" };
      if (fragment.id) existing.id = keep_text(String(fragment.id), existing.id);
      const name = fragment.function?.name;
      if (typeof name === "string" && name && name !== existing.name) existing.name += keep_text(name);
      if (typeof fragment.function?.arguments === "string") existing.arguments += keep_text(fragment.function.arguments);
      const signature = fragment.extra_content?.google?.thought_signature;
      if (typeof signature === "string") existing.extra_content = { google: { thought_signature: keep_text(signature, existing.extra_content?.google?.thought_signature || "") } };
      calls.set(key, existing);
    }
  };
  const line = value => {
    if (value === "") { dispatch(); return; }
    const size = encoder.encode(value).byteLength;
    if (size > READER_FETCH_MAX_BODY) throw new Error("兼容端点单个事件超过大小上限");
    if (value.startsWith("data:")) {
      event_bytes += size + 1;
      if (event_bytes > READER_FETCH_MAX_BODY) throw new Error("兼容端点单个事件超过大小上限");
      data_lines.push(value.slice(5).replace(/^ /, ""));
    }
  };
  const drain = (final = false) => {
    while (!done_marker) {
      const index = buffer.search(/[\r\n]/);
      if (index < 0 || (!final && buffer[index] === "\r" && index === buffer.length - 1)) break;
      const size = buffer[index] === "\r" && buffer[index + 1] === "\n" ? 2 : 1;
      const value = buffer.slice(0, index); buffer = buffer.slice(index + size); line(value);
    }
    if (final && !done_marker) { if (buffer) line(buffer); buffer = ""; dispatch(); }
    if (!done_marker && encoder.encode(buffer).byteLength > READER_FETCH_MAX_BODY) throw new Error("兼容端点单个事件超过大小上限");
  };
  try {
    while (!done_marker) {
      const pending = reader.read();
      const { value, done } = timeout ? await timeout.wait(pending) : await pending;
      if (done) { buffer += decoder.decode(); drain(true); break; }
      timeout?.touch();
      on_activity?.("streaming");
      // 传输包装和心跳消费后即丢弃；只限制驻留数据，不累计整个长连接的字节。
      for (let offset = 0; offset < value.byteLength && !done_marker; offset += 64 * 1024) {
        buffer += decoder.decode(value.subarray(offset, offset + 64 * 1024), { stream: true }); drain();
      }
    }
    if (!done_marker && !finished) throw new Error("兼容端点事件流提前断开，回答尚未完成，请重试");
    for (const call of calls.values()) {
      try { JSON.parse(call.arguments || "{}"); } catch { throw new Error("兼容端点返回了不完整的工具参数，未执行工具，请重试"); }
    }
    return normalize_assistant_turn({ content, reasoning_content, tool_calls: [...calls.values()], usage });
  } finally {
    reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
