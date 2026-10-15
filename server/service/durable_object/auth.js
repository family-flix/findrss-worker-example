// 读者身份：自注册、邮箱验证、登录与身份校验。
//
// 只回数据或抛 DurableObjectError，绝不造 Response（router 是唯一翻译点）。
import { AccessTokenModel } from "../../domain/access_token.js";
import { RegisteredUserModel } from "../../domain/registered_user.js";
import { generate_password_salt, generate_reader_verification_code, hash_reader_password, hash_reader_verification_code, verify_reader_password } from "../../infra/reader_auth.js";
import { READER_SIGNUP_IP_MAX_SENDS, READER_SIGNUP_IP_WINDOW_MS, READER_VERIFICATION_MAX_ATTEMPTS, READER_VERIFICATION_RESEND_COOLDOWN_MS, READER_VERIFICATION_TTL_MS } from "../../lib/constants.js";
import { sha256_hex } from "../../lib/crypto.js";
import { access_token_hint, generate_access_token, valid_access_token, valid_identifier } from "../../lib/identifiers.js";
import { do_error } from "./error.js";

export class ServiceAuth {
  /**
   * @param {{ repo: Record<string, any>, storage: DurableObjectStorage, app: Record<string, any>, device_token: string }} deps
   */
  constructor({ repo, storage, app, device_token }) {
    this.repo = repo;
    this.storage = storage;
    /** 兄弟服务注册表（activity 的 record_user_event）。 */
    this.app = app;
    this.device_token = device_token;
  }

  /**
   * 校验 Reader 身份对应的 access token 仍然有效。
   * @param {string} user_id
   * @param {string} access_token_id
   * @returns {boolean}
   */
  valid_reader_token(user_id, access_token_id) {
    return this.repo.access_tokens.is_active_for_user(access_token_id, user_id, Date.now());
  }

  /**
   * 校验读者身份（X-Api-User-ID + X-Api-Access-Token-ID）并确认 token 仍有效。
   * @param {Request} request
   * @returns {{ user_id: string, access_token_id: string } | null}
   */
  reader_auth(request) {
    const user_id = (request.headers.get("X-Api-User-ID") ?? "").trim();
    const access_token_id = (request.headers.get("X-Api-Access-Token-ID") ?? "").trim();
    if (!valid_identifier(user_id) || !valid_identifier(access_token_id)) return null;
    if (!this.valid_reader_token(user_id, access_token_id)) return null;
    return { user_id, access_token_id };
  }

  /**
   * @param {string} ip_hash
   * @param {number} now
   * @returns {boolean}
   */
  consume_reader_signup_ip_limit(ip_hash, now) {
    if (ip_hash === "") return true;
    const row = this.repo.users.signup_limit_find(ip_hash);
    if (row === undefined) {
      this.repo.users.signup_limit_insert(ip_hash, now);
      return true;
    }
    if (Number(row.window_start) <= now - READER_SIGNUP_IP_WINDOW_MS) {
      this.repo.users.signup_limit_reset(ip_hash, now);
      return true;
    }
    if (Number(row.sends) >= READER_SIGNUP_IP_MAX_SENDS) return false;
    this.repo.users.signup_limit_increment(ip_hash);
    return true;
  }

  /**
   * @param {Request} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async register_reader(request) {
    let body;
    try {
      const text = await request.text();
      if (text.length > 16 * 1024) throw do_error("request body is too large", 413)
      body = JSON.parse(text);
    } catch {
      throw do_error("invalid JSON", 400);
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw do_error("invalid JSON body", 400);
    }
    const email = RegisteredUserModel.normalize_email(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    if (!RegisteredUserModel.valid_email(email) || !RegisteredUserModel.valid_password(password)) {
      throw do_error("请输入有效邮箱和 8–128 位密码", 400);
    }

    const now = Date.now();
    const salt = generate_password_salt();
    const password_hash = await hash_reader_password(password, salt);
    const reader_name = RegisteredUserModel.default_name(email);
    const code = generate_reader_verification_code();
    const user_id = crypto.randomUUID();
    const access_token_id = crypto.randomUUID();
    const verification_hash = await hash_reader_verification_code(
      this.device_token,
      user_id,
      code);
    const token = generate_access_token();
    const token_hash = await sha256_hex(token);
    const raw_ip = String(request.headers.get("X-Reader-Client-IP") ?? "").trim();
    const ip_hash = raw_ip === ""
      ? ""
      : await hash_reader_verification_code(this.device_token, "signup-ip", raw_ip);

    const result = this.storage.transactionSync(() => {
      const existing = this.repo.users.find_credential_by_email(email);
      if (existing !== undefined) {
        if (existing.email_verified_at !== null) return { send: false };
        return { existing_pending: true };
      }

      const token_count = this.repo.access_tokens.count_active();
      if (token_count >= AccessTokenModel.MAX_TOKENS) return { rate_limited: true };
      if (!this.consume_reader_signup_ip_limit(ip_hash, now)) {
        return { rate_limited: true };
      }
      this.repo.users.insert({
        id: user_id,
        name: reader_name,
        created_at: now,
        updated_at: now,
      });
      this.repo.users.insert_credential({
        id: crypto.randomUUID(),
        user_id,
        email,
        password_hash,
        password_salt: salt,
        email_verified_at: null,
        created_at: now,
        updated_at: now,
      });
      this.repo.access_tokens.insert({
        id: access_token_id,
        user_id,
        name: reader_name,
        token_hash,
        token_hint: access_token_hint(token),
        expires_at: null,
        created_at: now,
        credit_balance: 0,
        total_credits_granted: 0,
      });
      this.app.activity.record_user_event({
        user_id,
        access_token_id,
        type: "register",
        subject: email,
      });
      this.repo.users.upsert_verification(
        user_id,
        verification_hash,
        now + READER_VERIFICATION_TTL_MS,
        now);
      return { send: true, email, code, user_id };
    });

    if (result.rate_limited) {
      throw do_error("请求过于频繁，请稍后重试", 429);
    }
    if (result.existing_pending) {
      return this.resend_reader_verification(
        new Request("https://internal/_reader/auth/resend-verification", {
          method: "POST",
          headers: request.headers,
          body: JSON.stringify({ email }),
        }));
    }
    return { send_verification_email: result.send, email: result.email, code: result.code }
  }

  /**
   * @param {Request} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async resend_reader_verification(request) {
    let body;
    try {
      const text = await request.text();
      if (text.length > 16 * 1024) throw do_error("request body is too large", 413)
      body = JSON.parse(text);
    } catch {
      throw do_error("invalid JSON", 400);
    }
    const email = RegisteredUserModel.normalize_email(body?.email);
    if (!RegisteredUserModel.valid_email(email)) throw do_error("invalid email", 400)
    const credential = this.repo.users.find_credential_by_email(email);
    if (credential === undefined || credential.email_verified_at !== null) {
      return { send_verification_email: false }
    }

    const now = Date.now();
    const code = generate_reader_verification_code();
    const verification_hash = await hash_reader_verification_code(
      this.device_token,
      String(credential.user_id),
      code);
    const raw_ip = String(request.headers.get("X-Reader-Client-IP") ?? "").trim();
    const ip_hash = raw_ip === ""
      ? ""
      : await hash_reader_verification_code(this.device_token, "signup-ip", raw_ip);
    const result = this.storage.transactionSync(() => {
      const current = this.repo.users.find_credential_by_email(email);
      if (
        current === undefined ||
        current.user_id !== credential.user_id ||
        current.email_verified_at !== null
      ) {
        return { send: false };
      }
      const pending = this.repo.users.find_verification_sent_at(credential.user_id);
      if (
        pending !== undefined &&
        now - Number(pending.sent_at) < READER_VERIFICATION_RESEND_COOLDOWN_MS
      ) {
        return { send: false };
      }
      if (!this.consume_reader_signup_ip_limit(ip_hash, now)) return { rate_limited: true };
      this.repo.users.upsert_verification(
        credential.user_id,
        verification_hash,
        now + READER_VERIFICATION_TTL_MS,
        now);
      return { send: true, email, code };
    });
    if (result.rate_limited) throw do_error("请求过于频繁，请稍后重试", 429)
    return { send_verification_email: result.send, email: result.email, code: result.code }
  }

  /**
   * @param {Request} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async verify_reader_email(request) {
    let body;
    try {
      const text = await request.text();
      if (text.length > 16 * 1024) throw do_error("request body is too large", 413)
      body = JSON.parse(text);
    } catch {
      throw do_error("invalid JSON", 400);
    }
    const email = RegisteredUserModel.normalize_email(body?.email);
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    if (!RegisteredUserModel.valid_email(email) || !/^\d{6}$/.test(code)) {
      throw do_error("邮箱验证码无效或已过期", 400);
    }
    const credential = this.repo.users.find_credential_by_email(email);
    if (credential === undefined) throw do_error("邮箱验证码无效或已过期", 400)
    if (credential.email_verified_at !== null) return { verified: true }
    const expected_hash = await hash_reader_verification_code(
      this.device_token,
      String(credential.user_id),
      code);
    const now = Date.now();
    const verified = this.storage.transactionSync(() => {
      const current = this.repo.users.find_credential_by_email(email);
      if (current === undefined || current.user_id !== credential.user_id) return false;
      if (current.email_verified_at !== null) return true;
      const pending = this.repo.users.find_verification(current.user_id);
      if (
        pending === undefined ||
        Number(pending.expires_at) <= now ||
        Number(pending.attempts) >= READER_VERIFICATION_MAX_ATTEMPTS
      ) {
        return false;
      }
      if (String(pending.code_hash) !== expected_hash) {
        this.repo.users.bump_verification_attempts(current.user_id);
        return false;
      }
      this.repo.users.mark_email_verified(current.user_id, now);
      this.repo.users.delete_verification(current.user_id);
      this.app.activity.record_user_event({
        user_id: String(current.user_id),
        type: "verify_email",
        subject: email,
      });
      return true;
    });
    if (!verified) throw do_error("邮箱验证码无效或已过期", 400)
    return { verified: true }
  }

  /**
   * @param {Request} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async authenticate_reader(request) {
    const content_length = Number(request.headers.get("Content-Length") ?? "0");
    if (content_length > 16 * 1024) {
      throw do_error("request body is too large", 413);
    }
    /** @type {{ method?: unknown, token?: unknown, email?: unknown, password?: unknown }} */
    let body;
    try {
      body = await request.json();
    } catch {
      throw do_error("invalid JSON", 400);
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw do_error("invalid JSON body", 400);
    }
    const method = body.method === "password" ? "password" : body.method === "token" ? "token" : "";
    const now = Date.now();
    /** @type {(AccessTokenRow & { user_name: string, password_hash?: string, password_salt?: string }) | undefined} */
    let row;
    if (method === "token") {
      const token = typeof body.token === "string" ? body.token.trim() : "";
      if (!valid_access_token(token)) throw do_error("登录凭证无效", 401)
      const token_hash = await sha256_hex(token);
      row = this.repo.access_tokens.find_login_by_token_hash(token_hash);
    } else if (method === "password") {
      const email = RegisteredUserModel.normalize_email(body.email);
      const password = typeof body.password === "string" ? body.password : "";
      if (!RegisteredUserModel.valid_email(email) || !RegisteredUserModel.valid_password(password)) {
        throw do_error("邮箱或密码错误", 401);
      }
      row = this.repo.access_tokens.find_login_by_email(email);
      if (
        row === undefined ||
        !(await verify_reader_password(
          password,
          String(row.password_salt ?? ""),
          String(row.password_hash ?? "")))
      ) {
        throw do_error("邮箱或密码错误", 401);
      }
    } else {
      throw do_error("method must be token or password", 400);
    }
    if (
      row !== undefined &&
      row.email &&
      row.email_verified_at === null
    ) {
      throw do_error("邮箱尚未验证，请先完成邮箱验证", 403);
    }
    if (row === undefined || !AccessTokenModel.fromRow(row).is_active_at(now)) {
      throw do_error("登录凭证无效", 401);
    }
    this.repo.access_tokens.set_last_used(String(row.id), now);
    // 只在这个「真正登录」入口记事件；verify_reader_identity 每次页面加载都会跑，绝不能记。
    this.app.activity.record_user_event({
      user_id: String(row.user_id),
      access_token_id: String(row.id),
      type: "login",
      subject: row.email ?? row.user_name ?? "",
      metadata: { method },
    });
    return {
      user: RegisteredUserModel.fromIdentityRow(row).toValue(),
      access_token: { id: row.id },
    }
  }

  /**
   * @param {Request} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async verify_reader_identity(request) {
    /** @type {{ user_id?: unknown, access_token_id?: unknown }} */
    let body;
    try {
      body = await request.json();
    } catch {
      throw do_error("unauthorized", 401);
    }
    const user_id = typeof body.user_id === "string" ? body.user_id : "";
    const access_token_id = typeof body.access_token_id === "string"
      ? body.access_token_id
      : "";
    if (!valid_identifier(user_id) || !valid_identifier(access_token_id)) {
      throw do_error("unauthorized", 401);
    }
    const now = Date.now();
    const row = this.repo.access_tokens.find_with_user(access_token_id, user_id);
    if (
      row === undefined ||
      (row.email && row.email_verified_at === null) ||
      !AccessTokenModel.fromRow(row).is_active_at(now)
    ) {
      throw do_error("unauthorized", 401);
    }
    return {
      user: RegisteredUserModel.fromIdentityRow(row).toValue(),
      access_token: { id: row.id },
    }
  }
}
