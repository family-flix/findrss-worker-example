// Workers AI 适配器：走 `env.AI` binding，不需要密钥。
//
// 只做两件事：把内部消息形状转成 binding 的入参，把返回值归一成 assistant 回合。
// 真正的工具循环在 service 里（这一层不认识 repo、也不认识 ReaderError）。
//
// **不做流式**：gpt-oss 这类模型要支持 function calling 才可用，而 binding 的流式
// 返回需要额外解析 SSE 片段；单步调用的结果直接整条广播给前端，代价只是「摘要
// 一次出现」而不是逐字。要改流式时，改的只有这一个文件。

import { normalize_assistant_turn, to_chat_messages, tool_definitions } from "../lib/script_agent_protocol.js";
import { create_ai_request_timeout } from "./script_agent_timeout.js";

/**
 * @param {{
 *   settings: { model: string },
 *   ai_binding?: { run: (model: string, inputs: object) => Promise<unknown> } | undefined,
 * }} deps
 * @returns {{
 *   provider: string,
 *   model: string,
 *   available: boolean,
 *   reason: string,
 *   complete: (messages: unknown[], options?: { tools?: unknown[], on_delta?: (text: string) => void }) => Promise<ReturnType<typeof normalize_assistant_turn>>,
 * }}
 */
export function create_workers_ai_provider({ settings, ai_binding }) {
  const model = settings.model;
  const available = Boolean(ai_binding);
  const reason = available
    ? ""
    : "未绑定 Workers AI：wrangler.jsonc 里缺 `ai` binding（本地 `wrangler dev` 还需 --remote）。";
  return {
    provider: "workers_ai",
    model,
    available,
    reason,
    async complete(messages, options = {}) {
      if (!ai_binding) throw new Error(reason);
      /** @type {Record<string, unknown>} */
      const inputs = { ...settings.options, messages: to_chat_messages(messages) };
      const tools = Array.isArray(options.tools) ? options.tools : [];
      if (tools.length > 0) inputs.tools = tool_definitions(tools);
      let result;
      try {
        const timeout = create_ai_request_timeout({ signal: options.signal });
        try { result = await timeout.wait(ai_binding.run(model, inputs)); } finally { timeout.close(); }
      } catch (error) {
        // 模型不支持 function calling 时会在这里抛。把模型名带上，便于一眼看出是
        // 「配置的模型不行」而不是「代码坏了」。
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Workers AI 调用失败（${model}）：${detail}`);
      }
      const turn = normalize_assistant_turn(result);
      if (turn.content !== "" && typeof options.on_delta === "function") {
        options.on_delta(turn.content);
      }
      return turn;
    },
  };
}
