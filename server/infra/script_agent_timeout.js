import { SCRIPT_AGENT_IDLE_MS as READER_AI_REQUEST_TIMEOUT_MS, SCRIPT_AGENT_DURATION_MS as READER_AI_REQUEST_MAX_DURATION_MS } from "../lib/script_agent_protocol.js";

// 同一 deadline 覆盖 fetch 响应头与响应体；仅流量活动续期，绝对时限不续。
export function create_ai_request_timeout({ idle_ms = READER_AI_REQUEST_TIMEOUT_MS,
  total_ms = READER_AI_REQUEST_MAX_DURATION_MS, signal, set_timeout = setTimeout, clear_timeout = clearTimeout } = {}) {
  const controller = new AbortController();
  let idle_timer, total_timer;
  const abort = kind => {
    const error = new Error(kind === "idle" ? "兼容端点长时间没有返回数据，等待已超时" : "兼容端点生成超过最长等待时间");
    error.name = "TimeoutError";
    controller.abort(error);
  };
  const touch = () => {
    if (controller.signal.aborted) return;
    clear_timeout(idle_timer);
    idle_timer = set_timeout(() => abort("idle"), idle_ms);
  };
  const cancel = () => controller.abort(signal.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  touch();
  total_timer = set_timeout(() => abort("total"), total_ms);
  return { signal: controller.signal, touch,
    wait(promise) {
      return new Promise((resolve, reject) => {
        const on_abort = () => reject(controller.signal.reason);
        if (controller.signal.aborted) { Promise.resolve(promise).catch(() => {}); on_abort(); return; }
        controller.signal.addEventListener("abort", on_abort, { once: true });
        Promise.resolve(promise).then(value => {
          controller.signal.removeEventListener("abort", on_abort); resolve(value);
        }, error => {
          controller.signal.removeEventListener("abort", on_abort); reject(error);
        });
      });
    },
    close() { clear_timeout(idle_timer); clear_timeout(total_timer); signal?.removeEventListener("abort", cancel); },
  };
}
