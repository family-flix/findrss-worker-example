import { do_error } from "./error.js";
import { parse_webhook_template, render_webhook_template, DEFAULT_WEBHOOK_TEMPLATE } from "../../lib/webhook_template.js";
export class ServiceWebhookSettings {
  constructor({
    repo,
    credentials
  }) {
    this.repo = repo;
    this.credentials = credentials;
  }
  async settings() {
    const row = await this.repo.get();
    return {
      url: row?.url || "",
      token_configured: Boolean(row?.encrypted_token),
      template: row?.template || DEFAULT_WEBHOOK_TEMPLATE,
      updated_at: row?.updated_at || 0
    };
  }
  async save_settings(body) {
    if (typeof body?.url !== "string") throw do_error("Webhook 地址必须是字符串", 400);
    const url = body.url.trim();
    if (url.length > 4096) throw do_error("Webhook 地址不能超过 4096 个字符", 400);
    if (url) {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        throw do_error("Webhook 地址必须是有效的 HTTP(S) URL", 400);
      }
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
        throw do_error("Webhook 地址必须使用 HTTP(S)，且不能包含用户名、密码或片段", 400);
      }
    }
    if (body.token !== undefined && (typeof body.token !== "string" || body.token.length > 4096 || /[\r\n]/.test(body.token))) {
      throw do_error("Webhook Token 必须是不含换行的字符串，且不超过 4096 个字符", 400);
    }
    try {
      parse_webhook_template(body.template);
    } catch (error) {
      throw do_error(error.message, 400);
    }
    const encrypted_token = body.token ? await this.credentials.encrypt(body.token) : (await this.repo.get())?.encrypted_token || "";
    await this.repo.put(url, encrypted_token, body.template, Date.now());
    return await this.settings();
  }
  async push_message(message) {
    // shortcut: 每条消息只发送一次，需要可靠投递时再接入持久化重试。
    try {
      const row = await this.repo.get();
      if (!row?.url) return;
      const headers = {
        "Content-Type": "application/json"
      };
      if (row.encrypted_token) headers.Authorization = "Bearer " + (await this.credentials.decrypt(row.encrypted_token));
      const response = await fetch(row.url, {
        method: "POST",
        headers,
        body: JSON.stringify(render_webhook_template(row.template, message)),
        redirect: "error",
        signal: AbortSignal.timeout(10000)
      });
      await response.body?.cancel();
      if (!response.ok) console.warn("Webhook 推送失败：HTTP " + response.status);
    } catch {
      // fetch 错误可能含有地址中的令牌，避免将其写入日志。
      console.warn("Webhook 推送失败");
    }
  }
}
