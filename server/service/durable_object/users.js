// 管理端的 Reader 用户管理：列表、详情、改名/改邮箱、删除、验证邮箱、重置密码。
//
// 只回数据或抛 DurableObjectError，绝不造 Response。
import { AccessTokenModel } from "../../domain/access_token.js";
import { RegisteredUserModel } from "../../domain/registered_user.js";
import { generate_password_salt, hash_reader_password } from "../../infra/reader_auth.js";
import { do_error } from "./error.js";

export class ServiceUser {
  /**
   * @param {{ repo: Record<string, any>, storage: DurableObjectStorage }} deps
   */
  constructor({ repo, storage }) {
    this.repo = repo;
    this.storage = storage;
  }

  /**
   * 列出所有 Reader 用户（聚合每个用户的凭据与订阅凭证信息）。
   * @param {URL} url
   * @returns {Record<string, unknown>}
   */
  list_admin_users(url) {
    const limit_value = Number(url.searchParams.get("limit") ?? "50");
    const offset_value = Number(url.searchParams.get("offset") ?? "0");
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    const limit = Number.isFinite(limit_value)
      ? Math.max(1, Math.min(100, Math.floor(limit_value)))
      : 50;
    const offset = Number.isFinite(offset_value)
      ? Math.max(0, Math.min(1_000_000, Math.floor(offset_value)))
      : 0;
    const total_count = this.repo.users.count_admin(q);
    const now = Date.now();
    /** @type {Array<Record<string, unknown>>} */
    const rows = this.repo.users.list_admin(q, limit, offset, now);
    return {
      users: rows.map((row) => RegisteredUserModel.fromRow(row).admin_list_value()),
      total_count,
      limit,
      offset,
    }
  }

  /**
   * @param {string} user_id
   * @returns {Record<string, unknown>}
   */
  get_admin_user(user_id) {
    const user = this.repo.users.find(user_id);
    if (user === undefined) throw do_error("user not found", 404)
    /** @type {{email: string, password_hash: string, email_verified_at: number | null, created_at: number, updated_at: number} | undefined} */
    const credential = this.repo.users.find_credential(user_id);
    const tokens = this.repo.access_tokens.list_for_user(user_id);
    const now = Date.now();
    return {
      user: RegisteredUserModel.fromRow({
        ...user,
        email: credential?.email,
        email_verified_at: credential?.email_verified_at,
        password_hash: credential?.password_hash,
      }).admin_detail_value(),
      access_tokens: tokens.map((row) => AccessTokenModel.fromRow(row).toValue(now)),
    }
  }

  /**
   * 管理员更新用户资料：可单独或同时修改名称与邮箱。
   * @param {Request} request
   * @param {string} user_id
   * @returns {Promise<Record<string, unknown>>}
   */
  async update_admin_user(request, user_id) {
    const content_length = Number(request.headers.get("Content-Length") ?? "0");
    if (content_length > 16 * 1024) throw do_error("request body is too large", 413)
    /** @type {{ name?: unknown, email?: unknown }} */
    let body;
    try {
      body = await request.json();
    } catch {
      throw do_error("invalid JSON", 400);
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw do_error("invalid JSON body", 400);
    }
    if (!this.repo.users.exists(user_id)) throw do_error("user not found", 404)

    let name = null;
    if (body.name !== undefined) {
      if (typeof body.name !== "string") throw do_error("name must be a string", 400)
      name = body.name.trim();
      if (name === "") throw do_error("name must not be empty", 400)
      if (name.length > 128 || /[\r\n]/.test(name)) {
        throw do_error("name must not exceed 128 characters or contain newlines", 400);
      }
    }

    let email = null;
    let remove_credential = false;
    if (body.email !== undefined) {
      if (body.email !== null && typeof body.email !== "string") {
        throw do_error("email must be a string or null", 400);
      }
      email = body.email === null ? "" : RegisteredUserModel.normalize_email(body.email);
      if (email !== "" && !RegisteredUserModel.valid_email(email)) {
        throw do_error("invalid email", 400);
      }
      if (email === "") {
        if (this.repo.users.find_credential_id(user_id) !== undefined) remove_credential = true;
      } else {
        if (this.repo.users.email_taken_by_other(email, user_id)) {
          throw do_error("email already exists", 409)
        }
      }
    }

    const now = Date.now();
    /** @type {{ email: string, email_verified_at: number | null } | undefined} */
    const current_credential = email === null && !remove_credential
      ? undefined
      : this.repo.users.find_credential_email_verified(user_id);

    this.storage.transactionSync(() => {
      if (name !== null) {
        this.repo.users.set_name(user_id, name, now);
      }
      if (remove_credential) {
        this.repo.users.delete_credential(user_id);
      } else if (email !== null && email !== "") {
        if (current_credential === undefined) {
          this.repo.users.insert_credential({
            id: crypto.randomUUID(),
            user_id,
            email,
            password_hash: "",
            password_salt: "",
            email_verified_at: now,
            created_at: now,
            updated_at: now,
          });
        } else {
          const email_verified_at =
            current_credential.email_verified_at === null ? now : current_credential.email_verified_at;
          this.repo.users.set_credential_email(user_id, email, email_verified_at, now);
        }
      }
    });

    return this.get_admin_user(user_id);
  }

  /**
   * 删除用户：撤销其全部订阅凭证并清除凭据、设置与验证记录。
   * @param {string} user_id
   * @returns {Record<string, unknown>}
   */
  delete_admin_user(user_id) {
    if (!this.repo.users.exists(user_id)) throw do_error("user not found", 404)
    const now = Date.now();
    this.storage.transactionSync(() => {
      this.repo.access_tokens.revoke_for_user(user_id, now);
      this.repo.users.delete_credential(user_id);
      this.repo.users.delete_verification(user_id);
      this.repo.users.delete(user_id);
    });
    return { removed: true, id: user_id }
  }

  /**
   * 管理员直接标记用户邮箱为已验证。
   * @param {string} user_id
   * @returns {Record<string, unknown>}
   */
  admin_verify_user_email(user_id) {
    if (!this.repo.users.exists(user_id)) throw do_error("user not found", 404)
    const credential = this.repo.users.find_credential_email(user_id);
    if (credential === undefined) {
      throw do_error("user has no email credential", 409);
    }
    const now = Date.now();
    this.repo.users.mark_email_verified(user_id, now);
    this.repo.users.delete_verification(user_id);
    return this.get_admin_user(user_id);
  }

  /**
   * 管理员重置用户登录密码（需用户已有邮箱凭据）。
   * @param {Request} request
   * @param {string} user_id
   * @returns {Promise<Record<string, unknown>>}
   */
  async admin_reset_user_password(request, user_id) {
    const content_length = Number(request.headers.get("Content-Length") ?? "0");
    if (content_length > 16 * 1024) throw do_error("request body is too large", 413)
    /** @type {{ password?: unknown }} */
    let body;
    try {
      body = await request.json();
    } catch {
      throw do_error("invalid JSON", 400);
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw do_error("invalid JSON body", 400);
    }
    if (!this.repo.users.exists(user_id)) throw do_error("user not found", 404)
    const credential = this.repo.users.find_credential_id(user_id);
    if (credential === undefined) throw do_error("user has no email credential", 409)
    const password = body.password;
    if (typeof password !== "string" || !RegisteredUserModel.valid_password(password)) {
      throw do_error("password must be between 8 and 128 characters", 400);
    }
    const password_salt = generate_password_salt();
    const password_hash = await hash_reader_password(password, password_salt);
    const now = Date.now();
    this.repo.users.set_password(user_id, password_hash, password_salt, now);
    return this.get_admin_user(user_id);
  }
}
