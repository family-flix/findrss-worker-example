// 日志由 Workers Logs 保存；这里只负责结构化输出及官方查询 API。
export function emit_worker_log(kind, row) {
  const value = row;
  const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
  while (bytes(value) > 240 * 1024) {
    const key = ["metadata_json", "params_json", "query_json", "lines_json"]
      .filter(key => typeof value[key] === "string").sort((a, b) => value[b].length - value[a].length)[0];
    if (!key || value[key].length < 1000) throw new Error("日志内容过大");
    value[key] = JSON.stringify({ truncated: true, original_length: value[key].length, preview: value[key].slice(0, Math.floor(value[key].length / 4)) });
  }
  const level = ["error", "warn", "info", "debug"].includes(value.level) ? value.level : "log";
  console[level]({ ...value, event: kind === "device" ? "device.log" : "script.exec", log_version: 1, log_id: value.id || 0 });
  return value;
}

export class WorkersLogs {
  constructor(env, { fetch: request = globalThis.fetch.bind(globalThis) } = {}) {
    this.account_id = String(env.CLOUDFLARE_ACCOUNT_ID || "").trim();
    this.worker_name = String(env.CLOUDFLARE_WORKER_NAME || "").trim();
    this.token = String(env.CLOUDFLARE_API_TOKEN || "").trim();
    this.fetch = request;
  }

  async query({ filters, from, to, limit, offset }) {
    if (!/^[a-f0-9]{32}$/i.test(this.account_id) || !this.worker_name || !this.token || /[\r\n]/.test(this.token)) {
      throw new Error("日志查询未配置：请设置 CLOUDFLARE_ACCOUNT_ID、CLOUDFLARE_WORKER_NAME 和 CLOUDFLARE_API_TOKEN");
    }
    let response;
    try {
      response = await this.fetch(`https://api.cloudflare.com/client/v4/accounts/${this.account_id}/workers/observability/telemetry/query`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
        headers: { Authorization: "Bearer " + this.token, "Content-Type": "application/json" },
        body: JSON.stringify({ queryId: "findrss-logs", dry: true, view: "events", limit,
          timeframe: { from, to }, ...(offset ? { offset, offsetDirection: "next" } : {}),
          parameters: { filters: [{ key: "$metadata.service", operation: "eq", type: "string", value: this.worker_name }, ...filters], filterCombination: "and" } }),
      });
    } catch { throw new Error("Cloudflare 日志查询连接失败或超时"); }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw new Error("Cloudflare 日志查询权限不足：API Token 需要 Workers Observability Write 权限");
      throw new Error(`Cloudflare 日志查询失败（HTTP ${response.status}）`);
    }
    let value;
    try { value = await response.json(); } catch { throw new Error("Cloudflare 日志查询返回无效 JSON"); }
    if (value?.result?.run?.status === "STARTED") throw new Error("Cloudflare 日志查询尚未完成，请重试");
    if (value?.success !== true || !Array.isArray(value.result?.events?.events)) throw new Error("Cloudflare 日志查询返回无效数据");
    return value.result.events.events;
  }
}
