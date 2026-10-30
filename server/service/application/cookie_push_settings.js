import { decrypt_cookie_push } from "../../infra/cookie_push.js";
import { do_error } from "./error.js";
export class ServiceCookiePushSettings {
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
      uuid: row?.uuid || "",
      configured: Boolean(row?.encrypted_key),
      updated_at: row?.updated_at || 0
    };
  }
  async import_legacy(uuid, key) {
    if ((await this.repo.get()) || !uuid || !/^[0-9a-fA-F]{16}$/.test(key)) return;
    await this.repo.put(uuid, await this.credentials.encrypt(key.toLowerCase()), Date.now());
  }
  async save_settings(body) {
    const uuid = typeof body?.uuid === "string" ? body.uuid.trim() : "";
    if (!uuid || uuid.length > 256) throw do_error("Cookie 解密 UUID 必须是 1–256 个字符", 400);
    if (body.password !== undefined && typeof body.password !== "string") throw do_error("Cookie 解密密码必须是字符串", 400);
    const password = body.password || "";
    if (password.length > 4096) throw do_error("Cookie 解密密码不能超过 4096 个字符", 400);
    const row = await this.repo.get();
    let encrypted_key = row?.encrypted_key;
    if (password) {
      const digest = new Uint8Array(await crypto.subtle.digest("MD5", new TextEncoder().encode(uuid + "-" + password)));
      const key = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
      encrypted_key = await this.credentials.encrypt(key);
    } else if (!encrypted_key || row.uuid !== uuid) {
      throw do_error("首次配置或更换 UUID 时，请填写 Cookie 解密密码", 400);
    }
    await this.repo.put(uuid, encrypted_key, Date.now());
    return await this.settings();
  }
  async decrypt(body) {
    if (body?.crypto_type === undefined || typeof body.crypto_type === "string" && body.crypto_type.trim().toLowerCase() === "none") {
      return decrypt_cookie_push(body, "", "");
    }
    const row = await this.repo.get();
    if (!row?.encrypted_key) throw do_error("请先在后台设置 Cookie 解密 UUID 和密码", 400);
    let key;
    try {
      key = await this.credentials.decrypt(row.encrypted_key);
    } catch {
      throw do_error("Cookie 解密配置无法读取，请在后台重新填写密码", 400);
    }
    return decrypt_cookie_push(body, row.uuid, key);
  }
}
