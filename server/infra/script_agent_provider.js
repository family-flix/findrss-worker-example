// 基于阅读器 OpenAI 兼容适配器；密钥由服务端加密仓储读取。
import { public_http_url } from "@findrss/feed-fetch";
const ai_endpoint_url = value => public_http_url(value, { allow_loopback: false });
import { create_ai_request_timeout } from "./script_agent_timeout.js";
import { read_chat_stream } from "./script_agent_stream.js";
import { SCRIPT_AGENT_RESPONSE_MAX_BYTES as READER_FETCH_MAX_BODY } from "../lib/script_agent_protocol.js";
import {
  normalize_assistant_turn,
  to_chat_messages,
} from "../lib/script_agent_protocol.js";
import { tool_definitions } from "../lib/script_agent_protocol.js";

// 保留忽略 stream=true 的 JSON 兼容端点，读取失败不能降级成空的成功回答。
async function parse_turn(response, options, timeout) {
  const content_type = String(response.headers.get("content-type") ?? "").toLowerCase();
  if (content_type.includes("text/event-stream")) return read_chat_stream(response, { ...options, timeout });
  if (!response.body) throw new Error("兼容端点返回了空响应");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let text = "", bytes = 0;
  try {
    for (;;) {
      const { value, done } = await timeout.wait(reader.read());
      if (done) { text += decoder.decode(); break; }
      timeout.touch(); bytes += value.byteLength;
      if (bytes > READER_FETCH_MAX_BODY) throw new Error("兼容端点响应超过大小上限");
      text += decoder.decode(value, { stream: true });
    }
  } finally { reader.cancel().catch(() => {}); reader.releaseLock(); }
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error("兼容端点返回了无效 JSON，回答尚未完成"); }
  if (payload?.error) throw new Error(`上游返回错误：${payload.error.message || "生成失败"}`);
  const turn = normalize_assistant_turn(payload);
  if (turn.content !== "" && typeof options.on_delta === "function") options.on_delta(turn.content);
  return turn;
}

/**
 * @param {{
 *   settings: { model: string, base_url: string, api_key_secret_name: string },
 *   secret_lookup?: (name: string) => unknown,
 *   fetch_impl?: typeof fetch,
 *   timeout_options?: Parameters<typeof create_ai_request_timeout>[0],
 * }} deps
 */
export function create_openai_compat_provider({ settings, secret_lookup, fetch_impl, api_key_lookup, timeout_options }) {
  const model = settings.model;
  const base_url = settings.base_url;
  const secret_name = settings.api_key_secret_name;
  const api_key = secret_name === "" ? "" : String(secret_lookup?.(secret_name) ?? "").trim();

  /** @type {string[]} */
  const missing = [];
  if (base_url === "") missing.push("base_url");
  if (!api_key_lookup) {
    if (secret_name === "") missing.push("api_key_secret_name");
    else if (api_key === "") missing.push(`secret「${secret_name}」`);
  }
  const available = missing.length === 0;
  const reason = available ? "" : `OpenAI 兼容端点未配置：缺 ${missing.join("、")}。`;

  const do_fetch = fetch_impl ?? ((...args) => fetch(...args));

  return {
    provider: "openai_compat",
    model,
    available,
    reason,
    async complete(messages, options = {}) {
      if (!available) throw new Error(reason);
      const active_key = api_key_lookup ? String(await api_key_lookup()).trim() : api_key;
      if (!active_key) throw new Error("请配置 API Key");
      if (api_key_lookup) {
        const endpoint = ai_endpoint_url(base_url);
        if (!endpoint || endpoint.username || endpoint.password) throw new Error("接口地址必须是公开 HTTP(S) 地址，不能包含内网地址或用户名密码");
      }
      const redact = (text) => String(text).replaceAll(active_key, "[redacted]");
      /** @type {Record<string, unknown>} */
      const body = { ...settings.options, model, messages: to_chat_messages(messages), stream: true };
      if (settings.preset_id === "openai" && body.max_tokens !== undefined) {
        body.max_completion_tokens = body.max_tokens;
        delete body.max_tokens;
      }
      const tools = Array.isArray(options.tools) ? options.tools : [];
      if (tools.length > 0) {
        body.tools = tool_definitions(tools);
        body.tool_choice = "auto";
      }
      // 一个调用最多两次连接尝试；已返回正文/工具片段时不重放。
      const timeout = create_ai_request_timeout({ ...timeout_options, signal: options.signal });
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          timeout.touch();
          let response, received_output = false;
          const stream_options = { ...options,
            on_delta: text => { received_output = true; options.on_delta?.(text); },
            on_activity: phase => { if (phase === "tool_call") received_output = true; options.on_activity?.(phase); },
          };
          try {
            response = await timeout.wait(do_fetch(`${base_url}/chat/completions`, {
              method: "POST", redirect: "manual",
              headers: { "content-type": "application/json", accept: "text/event-stream, application/json",
                "cache-control": "no-cache", authorization: `Bearer ${active_key}` },
              body: JSON.stringify(body), signal: timeout.signal,
            }));
            timeout.touch();
            if (response.status >= 300 && response.status < 400) {
              response.body?.cancel().catch(() => {});
              throw new Error(`OpenAI 兼容端点返回 ${response.status}：接口地址发生重定向，请使用最终的 API 地址。`);
            }
            if (!response.ok) {
              const detail = redact(await timeout.wait(response.text())).slice(0, 300);
              throw new Error(`OpenAI 兼容端点返回 ${response.status}${detail === "" ? "" : `：${detail}`}`);
            }
            return await parse_turn(response, stream_options, timeout);
          } catch (error) {
            const detail = redact(error instanceof Error ? error.message : String(error));
            // 响应头前或仅有思考流时可恢复；正文/工具已开始、超时或上游明确拒绝时不重试。
            if ((!response || response.ok && !received_output) && attempt === 0 && !timeout.signal.aborted && !detail.startsWith("上游") &&
              /network connection lost|connection reset|ECONNRESET|socket hang up|fetch failed/i.test(detail)) {
              options.on_retry?.();
              continue;
            }
            if (detail.startsWith("OpenAI 兼容端点")) throw new Error(detail);
            throw new Error(`OpenAI 兼容端点${response ? "响应读取" : "请求"}失败：${detail}`);
          } finally {
            if (response?.body && !response.body.locked) response.body.cancel().catch(() => {});
          }
        }
      } finally { timeout.close(); }
    },
  };
}
