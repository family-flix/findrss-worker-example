import { DeviceTokenModel } from "../../domain/device_token.js";
import { sha256_hex } from "../../lib/crypto.js";
import { access_token_hint } from "../../lib/identifiers.js";
import { do_error, do_result } from "./error.js";

export class ServiceDeviceToken {
  constructor({ repo, credentials, app, schedule_alarm }) {
    this.repo = repo;
    this.credentials = credentials;
    this.app = app;
    this.schedule_alarm = schedule_alarm;
  }
  list() { return { device_tokens: this.repo.list().map(row => DeviceTokenModel(row).toValue()) }; }
  find(id) {
    const row = this.repo.find(id);
    if (!row) throw do_error("device token not found", 404);
    return row;
  }
  is_active(id, now = Date.now()) {
    if (typeof id !== "string" || !id) return false;
    const row = this.repo.find(id);
    return Boolean(row && DeviceTokenModel(row).is_active_at(now));
  }
  async store(token, fields) {
    const row = { ...fields, id: crypto.randomUUID(), token_hash: await sha256_hex(token),
      token_hint: access_token_hint(token), encrypted_token: await this.credentials.encrypt(token), created_at: Date.now() };
    this.repo.insert(row);
    return this.repo.find(row.id);
  }
  async import_legacy(token) {
    if (!token || this.repo.find_by_hash(await sha256_hex(token))) return;
    await this.store(token, { name: "原部署 Device Token", note: "从 DEVICE_TOKEN 自动导入", expires_at: null });
  }
  async create(body) {
    const parsed = DeviceTokenModel.parse(body);
    if (!parsed.ok) throw do_error(parsed.error.message, parsed.error.status);
    if (this.repo.count() >= DeviceTokenModel.MAX_TOKENS) throw do_error("device token limit reached", 409);
    const token = "frd_" + [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    // 加密操作会让出执行权，落库前重查上限。
    const encrypted_token = await this.credentials.encrypt(token);
    const token_hash = await sha256_hex(token);
    if (this.repo.count() >= DeviceTokenModel.MAX_TOKENS) throw do_error("device token limit reached", 409);
    const row = { ...parsed.model.toValue(), id: crypto.randomUUID(), token_hash, encrypted_token,
      token_hint: access_token_hint(token), created_at: Date.now() };
    this.repo.insert(row);
    await this.schedule_alarm();
    return do_result({ device_token: DeviceTokenModel(row).toValue() }, 201);
  }
  update_note(id, body) {
    this.find(id);
    if (!body || typeof body.note !== "string" || body.note.length > 256) throw do_error("note must not exceed 256 characters", 400);
    this.repo.update_note(id, body.note.trim());
    return { device_token: DeviceTokenModel(this.find(id)).toValue() };
  }
  async reveal(id) {
    const row = this.find(id);
    if (row.revoked_at !== null) throw do_error("device token is revoked", 409);
    try { return { token: await this.credentials.decrypt(row.encrypted_token) }; }
    catch { throw do_error("设备 Token 无法解密，请创建新 Token；更换 ADMIN_PASSWORD 会影响明文查看", 409); }
  }
  async revoke(id) {
    this.find(id);
    this.repo.revoke(id, Date.now());
    this.app.devices.close_unauthorized_connections();
    await this.app.tasks.dispatch_pending();
    return { device_token: DeviceTokenModel(this.find(id)).toValue() };
  }
  async verify(token) {
    if (typeof token !== "string" || !token || token.length > 4096) throw do_error("unauthorized", 401);
    const row = this.repo.find_by_hash(await sha256_hex(token));
    if (!row || !DeviceTokenModel(row).is_active_at()) throw do_error("unauthorized", 401);
    this.repo.set_last_used(row.id, Date.now());
    return { device_token: { id: row.id } };
  }
}
