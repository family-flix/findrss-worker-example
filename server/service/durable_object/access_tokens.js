// 访问 Token 的管理端 CRUD 与内部校验（服务端只认 token 哈希，绝不存明文）。
//
// 只回数据或抛 DurableObjectError，绝不造 Response。
import { AccessTokenModel } from "../../domain/access_token.js";
import { RegisteredUserModel } from "../../domain/registered_user.js";
import { CreditModel } from "../../domain/credits.js";
import { generate_password_salt, hash_reader_password } from "../../infra/reader_auth.js";
import { sha256_hex } from "../../lib/crypto.js";
import { access_token_hint, generate_access_token, valid_access_token } from "../../lib/identifiers.js";
import { do_error, do_result } from "./error.js";

export class ServiceAccessToken {
  /**
   * @param {{ repo: Record<string, any>, storage: DurableObjectStorage }} deps
   */
  constructor({ repo, storage }) {
    this.repo = repo;
    this.storage = storage;
  }

  /** @returns {Record<string, unknown>} */
  list_access_tokens() {
    const rows = this.repo.access_tokens.list();
    const now = Date.now();
    return { access_tokens: rows.map((row) => AccessTokenModel.fromRow(row).toValue(now)) }
  }

  /**
   * @param {Request} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async create_access_token(request) {
    const content_length = Number(request.headers.get("Content-Length") ?? "0");
    if (content_length > 16 * 1024) {
      throw do_error("request body is too large", 413);
    }
    /** @type {{ name?: unknown, token?: unknown, email?: unknown, password?: unknown, expires_in_seconds?: unknown, credits?: unknown }} */
    let body;
    try {
      body = await request.json();
    } catch {
      throw do_error("invalid JSON", 400);
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw do_error("invalid JSON body", 400);
    }
    if (body.name !== undefined && typeof body.name !== "string") {
      throw do_error("name must be a string", 400);
    }
    if (
      body.token !== undefined &&
      body.token !== null &&
      typeof body.token !== "string"
    ) {
      throw do_error("token must be a string", 400);
    }
    if (body.email !== undefined && typeof body.email !== "string") {
      throw do_error("email must be a string", 400);
    }
    if (body.password !== undefined && typeof body.password !== "string") {
      throw do_error("password must be a string", 400);
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length > 128 || /[\r\n]/.test(name)) {
      throw do_error("name must not exceed 128 characters or contain newlines", 400, {});
    }
    const requested_token =
      typeof body.token === "string" ? body.token.trim() : "";
    if (requested_token !== "" && !valid_access_token(requested_token)) {
      throw do_error("token must be 16 to 256 characters using letters, numbers, or . _ ~ + / = -", 400, {});
    }
    const email = RegisteredUserModel.normalize_email(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    if ((email === "") !== (password === "")) {
      throw do_error("email and password must be provided together", 400);
    }
    if (email !== "" && !RegisteredUserModel.valid_email(email)) {
      throw do_error("invalid email", 400);
    }
    if (password !== "" && !RegisteredUserModel.valid_password(password)) {
      throw do_error("password must be between 8 and 128 characters", 400);
    }
    if (email !== "") {
      if (this.repo.users.email_taken(email)) {
        throw do_error("email already exists", 409);
      }
    }
    const lifetime = AccessTokenModel.validate_lifetime(body.expires_in_seconds);
    if (!lifetime.ok) {
      throw do_error(lifetime.error.message, lifetime.error.status);
    }
    const expires_in_seconds = lifetime.expires_in_seconds;
    const credits = body.credits === undefined ? 0 : Number(body.credits);
    if (!Number.isInteger(credits) || credits < 0 || credits > CreditModel.MAX_BALANCE) {
      throw do_error("credits must be an integer between 0 and 1000000000", 400);
    }
    const token_count = this.repo.access_tokens.count_active();
    if (token_count >= AccessTokenModel.MAX_TOKENS) {
      throw do_error("access token limit reached", 409);
    }

    const token = requested_token || generate_access_token();
    const token_hash = await sha256_hex(token);
    if (this.repo.access_tokens.exists_by_hash(token_hash)) {
      const conflict = AccessTokenModel.duplicate_reason();
      throw do_error(conflict.message, conflict.status);
    }
    const password_salt = password === "" ? "" : generate_password_salt();
    const password_hash = password === ""
      ? ""
      : await hash_reader_password(password, password_salt);
    const now = Date.now();
    const expires_at =
      expires_in_seconds === null ? null : now + expires_in_seconds * 1000;
    const id = crypto.randomUUID();
    const user_id = crypto.randomUUID();
    const token_hint = access_token_hint(token);
    this.storage.transactionSync(() => {
      this.repo.users.insert({
        id: user_id,
        name: name || email || "Reader",
        created_at: now,
        updated_at: now,
      });
      if (email !== "") {
        this.repo.users.insert_credential({
          id: crypto.randomUUID(),
          user_id,
          email,
          password_hash,
          password_salt,
          email_verified_at: now,
          created_at: now,
          updated_at: now,
        });
      }
      this.repo.access_tokens.insert({
        id,
        user_id,
        name,
        token_hash,
        token_hint,
        expires_at,
        created_at: now,
        credit_balance: credits,
        total_credits_granted: credits,
      });
      if (credits > 0) {
        this.repo.credit.insert({
          id: crypto.randomUUID(),
          access_token_id: id,
          task_id: null,
          type: "grant",
          amount: credits,
          balance_after: credits,
          method: null,
          note: "initial credits",
          created_at: now,
        });
      }
    });
    const row = this.repo.access_tokens.find_with_credential_by_id(id);
    return do_result({ access_token: AccessTokenModel.fromRow(row).toValue(now), token }, 201);
  }

  /**
   * @param {Request} request
   * @param {string} access_token_id
   * @returns {Promise<Record<string, unknown>>}
   */
  async adjust_access_token_credits(request, access_token_id) {
    const content_length = Number(request.headers.get("Content-Length") ?? "0");
    if (content_length > 16 * 1024) {
      throw do_error("request body is too large", 413);
    }
    /** @type {{ amount?: unknown, reason?: unknown }} */
    let body;
    try {
      body = await request.json();
    } catch {
      throw do_error("invalid JSON", 400);
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw do_error("invalid JSON body", 400);
    }
    const parsed_amount = CreditModel.validate_adjustment(body.amount);
    if (!parsed_amount.ok) {
      throw do_error(parsed_amount.error.message, parsed_amount.error.status);
    }
    const amount = parsed_amount.amount;
    if (body.reason !== undefined && typeof body.reason !== "string") {
      throw do_error("reason must be a string", 400);
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length > 256 || /[\r\n]/.test(reason)) {
      throw do_error("reason must not exceed 256 characters or contain newlines", 400);
    }
    const now = Date.now();
    const adjustment = this.storage.transactionSync(() => {
      const existing = this.repo.access_tokens.find_not_revoked(access_token_id);
      if (existing === undefined) return { error: "not_found" };
      const balance = Number(existing.credit_balance) + amount;
      if (balance < 0) return { error: "negative_balance", balance: Number(existing.credit_balance) };
      if (CreditModel.over_balance_limit(balance)) return { error: "balance_limit" };
      this.repo.access_tokens.set_balance_granted(
        access_token_id,
        balance,
        Math.max(0, amount));
      this.repo.credit.insert({
        id: crypto.randomUUID(),
        access_token_id,
        task_id: null,
        type: amount > 0 ? "grant" : "adjustment",
        amount,
        balance_after: balance,
        method: null,
        note: reason || (amount > 0 ? "admin credit grant" : "admin credit adjustment"),
        created_at: now,
      });
      const row = this.repo.access_tokens.find(access_token_id);
      return { row };
    });
    if (adjustment.error === "not_found") {
      throw do_error("access token not found", 404);
    }
    if (adjustment.error === "negative_balance") {
      throw do_error(
        "credit adjustment would make the balance negative",
        409,
        { balance: adjustment.balance });
    }
    if (adjustment.error === "balance_limit") {
      throw do_error("credit balance limit exceeded", 409);
    }
    return { access_token: AccessTokenModel.fromRow(adjustment.row).toValue(now) }
  }

  /**
   * @param {string} access_token_id
   * @returns {Record<string, unknown>}
   */
  expire_access_token(access_token_id) {
    const existing = this.repo.access_tokens.find_not_revoked(access_token_id);
    if (existing === undefined) {
      throw do_error("access token not found", 404);
    }
    const now = Date.now();
    this.repo.access_tokens.set_expiry(access_token_id, now);
    const row = this.repo.access_tokens.find(access_token_id);
    return { access_token: AccessTokenModel.fromRow(row).toValue(now) }
  }

  /**
   * @param {string} access_token_id
   * @returns {Record<string, unknown>}
   */
  delete_access_token(access_token_id) {
    if (!this.repo.access_tokens.exists_not_revoked(access_token_id)) {
      throw do_error("access token not found", 404);
    }
    this.repo.access_tokens.revoke(access_token_id, Date.now());
    return { removed: true, id: access_token_id }
  }

  /**
   * @param {Request} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async verify_access_token(request) {
    /** @type {{ token?: unknown }} */
    let body;
    try {
      body = await request.json();
    } catch {
      throw do_error("unauthorized", 401);
    }
    const token = typeof body.token === "string" ? body.token : "";
    if (!valid_access_token(token)) {
      throw do_error("unauthorized", 401);
    }
    const token_hash = await sha256_hex(token);
    const row = this.repo.access_tokens.find_with_credential_by_hash(token_hash);
    const now = Date.now();
    if (
      row === undefined ||
      (row.email && row.email_verified_at === null) ||
      !AccessTokenModel.fromRow(row).is_active_at(now)
    ) {
      throw do_error("unauthorized", 401);
    }
    this.repo.access_tokens.set_last_used(String(row.id), now);
    return {
      access_token: {
        id: row.id,
        name: row.name,
        publisher_id: "caller:" + row.id,
        credit_balance: Number(row.credit_balance),
      },
    }
  }
}
