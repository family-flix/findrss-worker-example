// 脚本的增删改查、Cookie 同步、试运行，以及公开 `/rss|/atom/<route>` 的取数。
//
// 只回数据或抛 DurableObjectError，绝不造 Response：`serve_rss_route` 回
// `{ body, headers }` 由 api 层组装 Response（feed 需要自定义 Content-Type / Cache-Control）。
import { DiscoverySourceModel } from "../../domain/discovery_source.js";
import { FeedModel } from "../../domain/feed_format.js";
import { ScriptModel } from "../../domain/script.js";
import { ScriptVersionModel } from "../../domain/script_version.js";
import { ScriptLogModel, ScriptLogQueryModel } from "../../domain/script_log.js";
import { ScriptTestRequestModel } from "../../domain/script_test.js";
import { ScriptDebugRequestModel } from "../../domain/script_debug_request.js";
import { RssRoutePatternModel } from "../../domain/rss_route.js";
import { RssRouteSelectionModel } from "../../domain/rss_route_selection.js";
import { SourceAddressModel } from "../../domain/source_address.js";
import { ScriptCookiePermissionsModel } from "../../domain/script_cookie_permissions.js";
import { ScriptCookieAccess } from "../../infra/script_cookie_access.js";
import { ScriptPreviewAssets } from "../../infra/script_preview_assets.js";
import { image_proxy_descriptor } from "../../lib/image_proxy.js";
import { script_output } from "../../lib/script_output.js";
import { sha256_hex } from "../../lib/crypto.js";
import { decrypt_cookie_push } from "../../infra/cookie_push.js";
import { LogThrottle } from "../../infra/log_throttle.js";
import { ScriptInvokeError, compile_script_module, execute_script, script_failure_fields } from "../../infra/script_sandbox.js";
import { rss_route_cache_key } from "../../infra/rss_cache.js";
import {
  COALESCE_KEY_HEADER,
  CREDIT_SUBJECT_HEADER,
  MAX_RSS_ROUTE_PATH_BYTES,
  RETENTION_MILLISECONDS,
  SCRIPT_FAILURE_LOG_MAX_KEYS,
  SCRIPT_FAILURE_LOG_WINDOW_MS,
  SCRIPT_INVOKE_TIMEOUT_MS,
  RSS_ROUTE_CACHE_TTL_MS,
  RSS_ROUTE_CACHE_MAX_ENTRIES,
} from "../../lib/constants.js";
import { valid_identifier } from "../../lib/identifiers.js";
import { redact_log_value } from "../../lib/log_redact.js";
import { DurableObjectError, do_error, do_result } from "./error.js";
import { record_script_log } from "./logs.js";

function normalize_rss_cookies(cookies) {
  if (cookies.length > 5000) throw do_error("cookies must contain at most 5000 items", 400);
  const normalized = [];
  let skipped = 0;
  for (const cookie of cookies) {
    if (!cookie || typeof cookie !== "object" || Array.isArray(cookie)) throw do_error("each cookie must be an object", 400);
    const name = typeof cookie.name === "string" ? cookie.name.trim() : "";
    // 浏览器允许保存无名 Cookie；它不是可注入的 name=value 凭证。
    if (cookie.name === "" || (typeof cookie.name === "string" && name === "")) { skipped++; continue; }
    const value = String(cookie.value ?? "");
    const domain = typeof cookie.domain === "string" ? cookie.domain.trim().toLowerCase() : "";
    if (!name || /[;=\r\n]/.test(name) || /[;\x00-\x1f\x7f]/.test(value) || !domain || /[\s/]/.test(domain)) {
      throw do_error("cookie name, value, or domain is invalid", 400);
    }
    normalized.push({ name, value, domain,
      path: typeof cookie.path === "string" && cookie.path.startsWith("/") ? cookie.path : "/",
      hostOnly: cookie.hostOnly === true, secure: cookie.secure === true,
      expirationDate: Number.isFinite(Number(cookie.expirationDate)) ? Number(cookie.expirationDate) : 0,
    });
  }
  if (skipped > 0 && normalized.length === 0) throw do_error("no valid named cookies to synchronize", 400);
  return { normalized, skipped };
}

export class ServiceScript {
  /**
   * @param {{ repo: Record<string, any>, ports: Record<string, any>, app: Record<string, any>, cookie_push_uuid: string, cookie_push_key: string }} deps
   */
  constructor({ repo, ports, app, cookie_push_uuid, cookie_push_key, public_origin = "" }) {
    try {
      const origin = new URL(public_origin);
      this.public_origin = ["http:", "https:"].includes(origin.protocol) && !origin.username && !origin.password ? origin.origin : "";
    } catch { this.public_origin = ""; }
    this.repo = repo;
    this.ports = ports;
    /** 兄弟服务注册表（serve_rss_route 经 tasks.invoke 下发设备调用）。 */
    this.app = app;
    this.cookie_push_uuid = cookie_push_uuid;
    this.cookie_push_key = cookie_push_key;
    /**
     * 启用中的路由表（内存索引）。`repo.scripts.list_enabled()` 是「LIMIT 500 +
     * ORDER BY updated_at DESC」的 storage 读，命中缓存的请求原本也要付这一次；并发一高，
     * 这些读就在 DO 上排成一条线。写入本表的**只有本文件**（insert/update/delete 三处，
     * 见 `invalidate_routes`），所以失效点是完备的。
     * @type {Record<string, unknown>[] | null}
     */
    this.enabled_routes = null;
    this.message_listeners = new Set();
    this.public_registered = new Set();
    this.public_refreshing = null;
    this.preview_assets = new ScriptPreviewAssets();
    /** 失败日志闸门：同一路由 + 相位 + query 在一个窗口内只记一行。 */
    this.failure_log_throttle = new LogThrottle(
      SCRIPT_FAILURE_LOG_WINDOW_MS,
      SCRIPT_FAILURE_LOG_MAX_KEYS);
  }

  record_log(record) {
    if (!record_script_log(this.repo, record) || record.status !== "error") return;
    for (const send of this.message_listeners) send({ type: "messages.changed" });
  }

  resolve_public_origin(request) {
    if (this.public_origin) return this.public_origin;
    try {
      const url = new URL(request.headers.get("X-Feed-Public-URL") || request.url);
      if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password
        && url.hostname !== "internal") return url.origin;
    } catch {}
    return "";
  }

  delete_read_messages(url) {
    const read_id = Number(url.searchParams.get("read_id"));
    if (!Number.isSafeInteger(read_id) || read_id <= 0) throw do_error("invalid read_id", 400);
    this.repo.script_logs.delete_errors_through(read_id);
    for (const send of this.message_listeners) send({ type: "messages.changed" });
    return { ok: true };
  }

  list_messages(url) {
    const parsed = ScriptLogQueryModel.fromQuery(url, { require_route: false });
    if (!parsed.ok) throw do_error(parsed.error.message, parsed.error.status);
    const query = parsed.model;
    const rows = this.repo.script_logs.list_errors(query.before_id, query.limit + 1);
    const has_more = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    return {
      messages: page.map(row => ({
        ...ScriptLogModel.fromRow(row).toValue(),
        script_name: ScriptModel.fromRow({ metadata_json: row.script_metadata_json }).toValue().name || row.path || "未保存的脚本",
      })),
      has_more,
      next_before_id: has_more ? page[page.length - 1].id : null,
      retention_milliseconds: RETENTION_MILLISECONDS,
    };
  }

  /**
   * 脚本配置变更后的统一失效入口：路由索引与响应缓存必须一起清。
   * 两者共用失效点不是巧合——它们缓存的是同一份「脚本世界」的两个投影。
   * @returns {void}
   */
  invalidate_routes() {
    this.enabled_routes = null;
    this.ports.route_cache.invalidate_all();
    this.ports.schedule_alarm?.().catch(error => console.warn("RSS snapshot schedule failed", error));
  }

  next_snapshot_at() {
    if (this.public_refreshing) return Date.now() + 60000;
    const next = this.repo.rss_route_cache.public_next_at(RSS_ROUTE_CACHE_TTL_MS);
    return next === null ? null : Math.max(Number(next), Date.now() + 5000);
  }

  refresh_due_snapshots() {
    if (this.public_refreshing) return this.public_refreshing;
    const sources = this.repo.rss_route_cache.public_due(Date.now() - RSS_ROUTE_CACHE_TTL_MS, 4);
    this.public_refreshing = Promise.all(sources.map(async source => {
      this.repo.rss_route_cache.public_attempt(source.key, Date.now());
      const target = new URL("https://internal/_public/feed/rss" + source.pathname);
      target.search = new URLSearchParams(JSON.parse(source.query_json)).toString();
      try {
        await this.serve_rss_route("rss", source.pathname, new Request(target, {
          headers: { "X-Feed-Public-URL": source.self_url },
        }), { refresh: true });
      } catch (error) {
        // 停用或改成私密后，移除定时任务及旧公开产物。
        if (error.status === 401 || error.status === 404) {
          this.repo.rss_route_cache.delete_public(source.key);
          this.public_registered.delete(source.key);
        }
        console.warn("RSS snapshot refresh failed", source.pathname, error.message);
      }
    })).finally(async () => { this.public_refreshing = null; await this.ports.schedule_alarm?.(); });
    return this.public_refreshing;
  }

  cookie_visibility(metadata) {
    const routes = (metadata.routes || [metadata]).map(entry => ({ path: entry.path, public: entry.public === true })).sort((a, b) => a.path.localeCompare(b.path));
    const public_sources = [...new Set((this.repo.discovery?.list_public_routes() || []).map(row => SourceAddressModel(row.feed_url).route_pathname)
      .filter(path => path && routes.some(entry => RssRoutePatternModel.fromValue(entry.path)?.match(path))))].sort();
    return { routes, public_sources, subscribers: "持有效访问 token 的订阅者" };
  }

  async cookie_access(script, metadata, script_id = "", grant_id = "", interactive = false) {
    const permissions = ScriptCookiePermissionsModel(metadata.permissions || {}).toValue();
    if (!permissions.cookies.length) return null;
    const script_hash = await sha256_hex(script);
    const visibility = this.cookie_visibility(metadata);
    const version = String(metadata.version || "");
    const permissions_json = JSON.stringify({ permissions, visibility, ...(version ? { version } : {}) });
    const assert_grant = () => {
      const grant = this.repo.rss_cookie_grants.find(grant_id);
      if (!grant || grant.script_hash !== script_hash || grant.permissions_json !== permissions_json || JSON.stringify(this.cookie_visibility(metadata)) !== JSON.stringify(visibility)
          || grant.script_id !== script_id || (!script_id && grant.created_at < Date.now() - 900000)) {
        throw do_error("此脚本版本需要管理员确认 Cookie 权限", 409, interactive ? {
          code: "SCRIPT_COOKIE_PERMISSION_REQUIRED",
          cookie_permissions: { script_id, script_hash, version, permissions, visibility,
            source: "管理员共享 Cookie 库", audience: "脚本输出可被订阅者读取；公开路由可被匿名访问。请仅输出允许分享的内容。" },
        } : { code: "SCRIPT_COOKIE_PERMISSION_REQUIRED" });
      }
    };
    assert_grant();
    return new ScriptCookieAccess({ permissions, cookies: () => this.rss_cookies(), assert_grant });
  }

  async approve_cookie_grant(request) {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > ScriptModel.MAX_BYTES + 32768) throw do_error("request body is too large", 413);
    let body;
    try { body = JSON.parse(text); } catch { throw do_error("invalid JSON", 400); }
    if (!body || typeof body.script !== "string" || body.confirmed !== true) throw do_error("必须明确确认 Cookie 权限", 400);
    const script_id = typeof body.script_id === "string" ? body.script_id : "";
    if (script_id && !this.repo.scripts.exists(script_id)) throw do_error("script not found", 404);
    const compiled = await compile_script_module(body.script);
    if (compiled.error || !compiled.metadata) throw do_error("脚本校验失败：" + compiled.error, 400);
    const permissions = compiled.metadata.permissions;
    const parsed_version = ScriptVersionModel.parse(body.version);
    if (!parsed_version.ok) throw do_error(parsed_version.error.message, parsed_version.error.status);
    const version = parsed_version.model.version;
    const script_hash = await sha256_hex(body.script);
    const visibility = this.cookie_visibility(compiled.metadata);
    if (!permissions.cookies.length || script_hash !== body.script_hash || JSON.stringify(permissions) !== JSON.stringify(body.permissions) || JSON.stringify(visibility) !== JSON.stringify(body.visibility)) throw do_error("脚本或权限已变化，请重新确认", 409);
    const id = crypto.randomUUID();
    this.repo.rss_cookie_grants.insert({ id, script_id, script_hash, permissions_json: JSON.stringify({ permissions, visibility, ...(version ? { version } : {}) }), created_at: Date.now() });
    const current = script_id ? this.repo.scripts.find(script_id) : null;
    if (current?.script === body.script && ScriptModel.fromRow(current).version === version) {
      const metadata = JSON.parse(current.metadata_json);
      metadata.permissions = permissions;
      metadata.cookie_grant_id = id;
      this.repo.scripts.update({ ...current, metadata_json: JSON.stringify(metadata), updated_at: Date.now() });
    }
    this.invalidate_routes();
    return { cookie_grant_id: id };
  }

  revoke_cookie_grant(script_id) {
    if (!this.repo.scripts.exists(script_id)) throw do_error("script not found", 404);
    this.repo.rss_cookie_grants.revoke(script_id);
    const row = this.repo.scripts.find(script_id);
    const metadata = JSON.parse(row.metadata_json);
    delete metadata.cookie_grant_id;
    this.repo.scripts.update({ ...row, metadata_json: JSON.stringify(metadata), updated_at: Date.now() });
    this.invalidate_routes();
    return { revoked: true };
  }

  /** @returns {Promise<Record<string, unknown>>} */
  async list_scripts(url) {
    const kind = url?.searchParams.get("kind");
    if (kind !== undefined && kind !== null && !ScriptModel.TYPES.includes(kind)) throw do_error("kind must be hot or rss", 400);
    const rows = this.repo.scripts.list().filter(row => !kind || ScriptModel.fromRow(row).kind === kind);
    return { scripts: await Promise.all(rows.map(async row => {
      const script = ScriptModel.fromRow(row).toValue();
      try {
        const metadata = JSON.parse(String(row.metadata_json || "{}"));
        const access = await this.cookie_access(script.script, metadata, script.id, script.cookie_grant_id);
        script.cookie_authorization = { status: access ? "active" : "none", message: "" };
      } catch (error) {
        script.cookie_authorization = { status: "required", message: error.error || "Cookie 授权信息无效，请重新确认" };
      }
      return script;
    })) };
  }

  async check_cookie_permissions(script_id) {
    const row = this.repo.scripts.find(script_id);
    if (!row) throw do_error("script not found", 404);
    let metadata;
    try { metadata = JSON.parse(row.metadata_json); } catch { throw do_error("脚本授权元数据无效，请编辑脚本后保存", 400); }
    const access = await this.cookie_access(row.script, metadata, script_id, metadata.cookie_grant_id || "", true);
    return { cookie_authorization: { status: access ? "active" : "none", message: "" } };
  }

  async publication_metadata(body, script, status, existing) {
    const previous = existing ? ScriptModel.fromRow(existing).toValue() : {};
    const publishing = status === "published" && (!existing || body.status === "published" || script !== existing.script
      || (body.version !== undefined && body.version !== previous.version));
    const parsed = ScriptVersionModel.parse(body.version === undefined ? publishing ? "" : previous.version : body.version, { required: publishing });
    if (!parsed.ok) throw do_error(parsed.error.message, parsed.error.status);
    const version = parsed.model.version;
    const published_version = previous.published_version || "";
    if (publishing && !parsed.model.is_after(published_version)) throw do_error("版本号必须高于上次正式版本 " + published_version, 409);
    return { version, script_hash: await sha256_hex(script), published_version: publishing ? version : published_version };
  }

  /**
   * @param {Request} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async create_script(request) {
    const content_length = Number(request.headers.get("Content-Length") ?? "0");
    if (content_length > ScriptModel.MAX_BYTES + 4096) {
      throw do_error("request body is too large", 413);
    }
    /** @type {{ script?: unknown, enabled?: unknown, debug?: unknown }} */
    let body;
    try {
      body = await request.json();
    } catch {
      throw do_error("invalid JSON", 400);
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw do_error("invalid JSON body", 400);
    }
    if (body.debug !== undefined && typeof body.debug !== "boolean") throw do_error("debug must be a boolean", 400);
    if (body.status !== undefined && !ScriptModel.STATUSES.includes(body.status)) throw do_error("status must be draft or published", 400);
    if (body.script_type !== undefined && !ScriptModel.TYPES.includes(body.script_type)) throw do_error("script_type must be hot or rss", 400);
    if (body.kind !== undefined && !ScriptModel.TYPES.includes(body.kind)) throw do_error("kind must be hot or rss", 400);
    const status = body.status ?? "published";
    const script = String(body.script ?? "");
    if (script.length === 0 && status === "published") {
      throw do_error("脚本内容不能为空", 400);
    }
    if (script.length > ScriptModel.MAX_BYTES) {
      throw do_error("脚本超过 128KB 限制", 413);
    }
    const compiled = await compile_script_module(script);
    if (status === "published" && (compiled.error !== "" || compiled.metadata === null)) {
      // 新增时还没有 route，仍记录一行（route 为空串），便于在 CF Workers Logs 里按事件查询。
      this.record_log({
        route: "",
        source: "save",
        method: "POST",
        pathname: "/admin/api/scripts",
        status: "error",
        phase: "module",
        level: "error",
        message: "脚本校验失败",
        error_text: compiled.error,
      });
      throw do_error("脚本校验失败：" + compiled.error, 400);
    }
    const metadata = compiled.metadata || { name: "未命名脚本", path: "" };
    metadata.debug = body.debug === true;
    metadata.status = status;
    metadata.kind = body.kind ?? metadata.kind ?? metadata.script_type ?? body.script_type ?? "rss";
    metadata.script_type = metadata.kind;
    Object.assign(metadata, await this.publication_metadata(body, script, status));
    const path = status === "published" ? String(metadata.path) : "";
    const script_count = this.repo.scripts.count();
    if (script_count >= ScriptModel.MAX_SCRIPTS) {
      throw do_error("script limit reached", 409);
    }
    if (status === "published") this.assert_route_paths(metadata);
    const grant_id = typeof body.cookie_grant_id === "string" ? body.cookie_grant_id : "";
    if (status === "published" || grant_id) await this.cookie_access(script, metadata, "", grant_id, true);
    metadata.cookie_grant_id = grant_id;
    const script_id = crypto.randomUUID();
    if (grant_id) this.repo.rss_cookie_grants.bind(grant_id, script_id);
    const now = Date.now();
    this.save_script(() => this.repo.scripts.insert({
      route: script_id,
      title: ScriptModel.truncate_name(metadata.name),
      path,
      metadata_json: JSON.stringify(metadata),
      script,
      enabled: body.enabled === false ? 0 : 1,
      created_at: now,
      updated_at: now,
    }), metadata, now, status === "published");
    this.invalidate_routes();
    const row = this.repo.scripts.find(script_id);
    await this.app.discovery?.publish_catalog();
    return do_result({ script: ScriptModel.fromRow(row).toValue() }, 201);
  }

  /**
   * @param {Request} request
   * @param {string} script_id
   * @returns {Promise<Record<string, unknown>>}
   */
  async update_script(request, script_id) {
    const content_length = Number(request.headers.get("Content-Length") ?? "0");
    if (content_length > ScriptModel.MAX_BYTES + 4096) {
      throw do_error("request body is too large", 413);
    }
    /** @type {{ script?: unknown, enabled?: unknown, debug?: unknown }} */
    let body;
    try {
      body = await request.json();
    } catch {
      throw do_error("invalid JSON", 400);
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw do_error("invalid JSON body", 400);
    }
    if (body.debug !== undefined && typeof body.debug !== "boolean") throw do_error("debug must be a boolean", 400);
    if (body.status !== undefined && !ScriptModel.STATUSES.includes(body.status)) throw do_error("status must be draft or published", 400);
    if (body.script_type !== undefined && !ScriptModel.TYPES.includes(body.script_type)) throw do_error("script_type must be hot or rss", 400);
    if (body.kind !== undefined && !ScriptModel.TYPES.includes(body.kind)) throw do_error("kind must be hot or rss", 400);
    const stored = this.repo.scripts.find_config(script_id);
    if (stored === undefined) {
      throw do_error("script not found", 404);
    }
    const existing = { ...stored };
    const status = body.status ?? ScriptModel.fromRow(existing).status;
    const script = body.script === undefined ? existing.script : String(body.script);
    if (script.length === 0 && status === "published") {
      throw do_error("脚本内容不能为空", 400);
    }
    if (script.length > ScriptModel.MAX_BYTES) {
      throw do_error("脚本超过 128KB 限制", 413);
    }
    let metadata;
    if (body.script === undefined && body.status !== "published") {
      try {
        metadata = JSON.parse(existing.metadata_json);
      } catch {
        metadata = null;
      }
    } else {
      const compiled = await compile_script_module(script);
      if (status === "published" && (compiled.error !== "" || compiled.metadata === null)) {
        this.record_log({
          route: script_id,
          path: String(existing.path ?? ""),
          source: "save",
          method: "PATCH",
          pathname: "/admin/api/scripts/" + script_id,
          status: "error",
          phase: "module",
          level: "error",
          message: "脚本校验失败",
          error_text: compiled.error,
        });
        throw do_error("脚本校验失败：" + compiled.error, 400);
      }
      metadata = compiled.metadata || { name: ScriptModel.fromRow(existing).name || "未命名脚本", path: "" };
    }
    if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
      throw do_error("脚本缺少有效的 route 元数据，请更新为模块格式", 400);
    }
    metadata.debug = body.debug === undefined
      ? ScriptModel.fromRow(existing).debug : body.debug;
    metadata.status = status;
    metadata.kind = body.kind ?? metadata.kind ?? metadata.script_type ?? body.script_type ?? ScriptModel.fromRow(existing).kind;
    metadata.script_type = metadata.kind;
    Object.assign(metadata, await this.publication_metadata(body, script, status, existing));
    const path = status === "published" ? String(metadata.path || "") : "";
    if (status === "published") this.assert_route_paths(metadata, script_id);
    const previous_metadata = ScriptModel.fromRow(existing).toValue();
    const grant_id = typeof body.cookie_grant_id === "string" ? body.cookie_grant_id : previous_metadata.cookie_grant_id || "";
    if (status === "published") await this.cookie_access(script, metadata, script_id, grant_id, true);
    metadata.cookie_grant_id = grant_id;
    const current = this.repo.scripts.find_config(script_id);
    if (!current || current.script !== existing.script || current.metadata_json !== existing.metadata_json || current.enabled !== existing.enabled) {
      throw do_error("脚本已更新，请重新打开后发布或保存", 409);
    }
    const now = Date.now();
    this.save_script(() => this.repo.scripts.update({
      route: script_id,
      title: ScriptModel.truncate_name(metadata.name),
      path,
      metadata_json: JSON.stringify(metadata),
      script,
      enabled: body.enabled === undefined ? Number(existing.enabled) : body.enabled === true ? 1 : 0,
      updated_at: now,
    }), metadata, now, status === "published" && (body.status === "published" || script !== existing.script
      || metadata.published_version !== previous_metadata.published_version));
    this.invalidate_routes();
    const row = this.repo.scripts.find(script_id);
    await this.app.discovery?.publish_catalog();
    return { script: ScriptModel.fromRow(row).toValue() }
  }

  save_script(write, metadata, now, collect) {
    const save = () => {
      write();
      if (collect) {
        this.repo.platforms?.collect(metadata, now);
        this.repo.tags?.collect(metadata, now);
      }
    };
    if (this.ports.transaction) this.ports.transaction(save);
    else save();
  }

  assert_route_paths(metadata, script_id = "") {
    const paths = new Set((metadata.routes || [metadata]).map(entry => entry.path));
    for (const row of this.repo.scripts.list()) {
      if (row.route === script_id || ScriptModel.fromRow(row).status === "draft") continue;
      for (const entry of ScriptModel.fromRow(row).routes) {
        if (paths.has(entry.path)) {
          const error = ScriptModel.path_conflict_reason(entry.path);
          throw do_error(error.message, error.status);
        }
      }
    }
  }

  /**
   * @param {string} script_id
   * @returns {Record<string, unknown>}
   */
  async delete_script(script_id) {
    if (!this.repo.scripts.exists(script_id)) {
      throw do_error("script not found", 404);
    }
    this.repo.rss_cookie_grants?.revoke(script_id);
    this.repo.scripts.delete(script_id);
    this.repo.script_logs.delete_for_route(script_id);
    this.invalidate_routes();
    await this.app.discovery?.publish_catalog();
    return { removed: true, id: script_id }
  }

  /** @returns {unknown} */
  rss_cookies() {
    return this.repo.rss_cookies.get();
  }

  delete_rss_cookie_domain(body) {
    const domain = typeof body.domain === "string" ? body.domain.trim().toLowerCase() : "";
    if (!domain || /[\s/]/.test(domain)) throw do_error("cookie domain is invalid", 400);
    const cookies = this.rss_cookies();
    const remaining = cookies.filter(cookie => cookie.domain !== domain);
    this.repo.rss_cookies.put(remaining, Date.now());
    this.invalidate_routes();
    return { domain, deleted: cookies.length - remaining.length, count: remaining.length };
  }

  edit_rss_cookie(body, method) {
    if (typeof body.name !== "string" || !body.name.trim() ||
        (method !== "DELETE" && typeof body.value !== "string")) {
      throw do_error("cookie name and value must be strings", 400);
    }
    if (body.path !== undefined && (typeof body.path !== "string" || !body.path.startsWith("/"))) {
      throw do_error("cookie path must start with /", 400);
    }
    const { normalized: [cookie] } = normalize_rss_cookies([{ ...body, value: method === "DELETE" ? "" : body.value }]);
    const cookies = this.rss_cookies().slice();
    const index = cookies.findIndex((item) => item.domain === cookie.domain && item.name === cookie.name && item.path === cookie.path);
    if (method === "POST") {
      if (index !== -1) throw do_error("Cookie 已存在，请编辑已有条目", 409);
      if (cookies.length >= 5000) throw do_error("cookies must contain at most 5000 items", 400);
      cookies.push(cookie);
    } else {
      if (index === -1) throw do_error("Cookie 不存在，请重新读取", 404);
      if (method === "DELETE") cookies.splice(index, 1);
      else cookies[index] = { ...cookies[index], value: cookie.value };
    }
    this.repo.rss_cookies.put(cookies, Date.now());
    this.invalidate_routes();
    return { cookie: method === "DELETE" ? null : cookies[method === "POST" ? cookies.length - 1 : index], count: cookies.length };
  }

  /**
   * @param {Request} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async update_rss_cookies(request) {
    if (Number(request.headers.get("Content-Length") || 0) > 1024 * 1024) {
      throw do_error("request body is too large", 413);
    }
    let body;
    try {
      const text = await request.text();
      if (new TextEncoder().encode(text).length > 1024 * 1024) throw do_error("request body is too large", 413);
      body = JSON.parse(text);
    } catch (error) {
      if (error.status === 413) throw error;
      throw do_error("invalid JSON", 400);
    }
    let cookies;
    try {
      cookies = await decrypt_cookie_push(body, this.cookie_push_uuid, this.cookie_push_key);
    } catch (failure) {
      throw do_error(failure instanceof Error ? failure.message : String(failure), 400);
    }
    const { normalized, skipped } = normalize_rss_cookies(cookies);
    this.repo.rss_cookies.put(normalized, Date.now());
    this.invalidate_routes();
    return { updated: true, count: normalized.length, skipped, action: "done", code: 0, msg: "成功", data: { count: normalized.length, skipped } }
  }

  /**
   * 用实际链接执行当前草稿，返回与 /debug 一致的执行详情。
   * 跳过保存、公开缓存和积分，复用真实 fetchText / Cookie / invoke。
   * @param {Request} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async preview_script_routes(request) {
    const max_bytes = ScriptTestRequestModel.MAX_SCRIPT_BYTES * 6 + 1024;
    if (Number(request.headers.get("Content-Length") || 0) > max_bytes) throw do_error("request body is too large", 413);
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > max_bytes) throw do_error("request body is too large", 413);
    let body;
    try { body = JSON.parse(text); } catch { throw do_error("invalid JSON", 400); }
    const parsed = ScriptTestRequestModel.fromBody(body);
    if (!parsed.ok) throw do_error(parsed.error.message, parsed.error.status);
    const compiled = await compile_script_module(parsed.model.script);
    if (compiled.error || !compiled.metadata) throw do_error("脚本校验失败：" + compiled.error, 400);
    return { routes: compiled.metadata.routes.map(({ path, name, example, allowed_hosts }) => ({ path, name, example,
      ...(allowed_hosts?.length ? { image_proxy: true } : {}) })) };
  }

  async debug_script(request) {
    const max_bytes = ScriptModel.MAX_BYTES + ScriptDebugRequestModel.MAX_URL_CHARS + 4096;
    if (Number(request.headers.get("Content-Length") || 0) > max_bytes) throw do_error("request body is too large", 413);
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > max_bytes) throw do_error("request body is too large", 413);
    let body;
    try { body = JSON.parse(text); } catch { throw do_error("invalid JSON", 400); }
    const parsed = ScriptDebugRequestModel.fromBody(body);
    if (!parsed.ok) throw do_error(parsed.error.message, parsed.error.status);
    const draft = parsed.model;
    const started_at = Date.now();
    const debug = {
      script: { id: draft.route, name: "未保存草稿", path: "" },
      request: {}, phase: "module", lines: [], upstream_requests: [], elapsed_ms: 0, invoked: false,
    };
    const finish = (status, message = "") => {
      debug.elapsed_ms = Date.now() - started_at;
      this.record_log({ route: draft.route, path: debug.script.path, source: "test",
        ...debug.request, status: status < 400 ? "ok" : "error", phase: debug.phase,
        level: status < 400 ? "info" : "error", message: message || "草稿调试成功",
        error_text: debug.error_text || "", lines: debug.lines,
        elapsed_ms: debug.elapsed_ms, invoked: debug.invoked });
      // 与 /debug 的上下文脱敏契约一致；输出与日志保留沙箱给出的内容。
      return { ok: status < 400, status, rss_debug: { ...debug, request: redact_log_value(debug.request) } };
    };
    const compiled = await compile_script_module(draft.script);
    if (compiled.error || !compiled.metadata) {
      debug.error_text = "脚本校验失败：" + compiled.error;
      return finish(400, debug.error_text);
    }
    const selected = draft.resolve(compiled.metadata.routes, this.resolve_public_origin(request));
    if (!selected.ok) {
      debug.phase = "metadata";
      debug.error_text = selected.error.message;
      return finish(selected.error.status, debug.error_text);
    }
    const metadata = { ...selected.metadata, debug: true, debug_request: true };
    const stored = draft.route ? this.repo.scripts.find_config(draft.route) : null;
    const version = draft.version ?? (stored ? ScriptModel.fromRow(stored).version : "");
    const grant_id = body.cookie_grant_id || (stored ? ScriptModel.fromRow(stored).toValue().cookie_grant_id : "") || "";
    const cookie_access = await this.cookie_access(draft.script, { ...compiled.metadata, version }, draft.route, grant_id, true);
    debug.script = { id: draft.route, name: metadata.name || "未保存草稿", path: metadata.path, version, script_hash: await sha256_hex(draft.script) };
    debug.request = { ...selected.context, authentication: {
      verification: "admin", public_route: true, authenticated: true,
    } };
    let invoke_failure = null;
    const invoke_impl = async spec => {
      debug.invoked = true;
      try {
        // 与管理员订阅预览一样以匿名设备任务执行，不写入公开缓存。
        return await this.script_invoke("", spec, "", "");
      } catch (error) {
        invoke_failure ??= error;
        throw error;
      }
    };
    try {
      const result = await execute_script(draft.script, metadata, invoke_impl, selected.context, [], "", cookie_access);
      Object.assign(debug, { phase: "ok", output: result.output, lines: result.lines,
        cookie_accesses: result.cookie_accesses || [], upstream_requests: result.upstream_requests || [] });
      const returned = JSON.parse(result.output);
      const rendered = script_output(metadata, returned);
      debug.preview_assets = this.preview_assets.create({ script: draft.script,
        metadata: { ...compiled.metadata, version }, script_id: draft.route, grant_id,
        media: rendered.descriptor ? { route: metadata, descriptor: rendered.descriptor, kind: rendered.kind || "img" } : null,
        public_origin: selected.context.public_origin });
      return finish(200);
    } catch (failure) {
      cookie_access?.assert_grant();
      const fields = script_failure_fields(failure);
      Object.assign(debug, { phase: invoke_failure ? "invoke" : fields.phase,
        error_text: fields.error_text, lines: fields.lines,
        cookie_accesses: failure.cookie_accesses || [], upstream_requests: failure.upstream_requests || [], upstream_error: invoke_failure?.message || "" });
      const status = invoke_failure instanceof ScriptInvokeError
        ? (invoke_failure.status === 504 ? 503 : invoke_failure.status) : failure.problem?.status || 502;
      return finish(status, fields.message);
    }
  }

  async preview_script_asset(request, id) {
    const snapshot = this.preview_assets.get(id);
    if (!snapshot) throw do_error("媒体预览已过期，请重新运行 Debug", 410);
    if (new URL(request.url).searchParams.get("media") === "1") {
      if (!snapshot.media) throw do_error("本次 Debug 没有媒体输出", 404);
      const access = await this.cookie_access(snapshot.script, snapshot.metadata, snapshot.script_id, snapshot.grant_id, true);
      access?.assert_grant();
      return snapshot.media;
    }
    let target;
    try {
      const value = new URL(request.url).searchParams.get("url");
      if (!value || value.length > 8192) throw new Error();
      target = new URL(value);
      if (target.origin !== snapshot.public_origin || target.username || target.password) throw new Error();
    } catch { throw do_error("资源地址与本次草稿预览不匹配", 400); }
    const selected = snapshot.metadata.routes.map(metadata => ({ metadata,
      match: RssRoutePatternModel.fromValue(metadata.path)?.match(target.pathname) }))
      .filter(entry => entry.match).sort((left, right) => right.match.score - left.match.score)[0];
    if (!selected?.metadata.allowed_hosts?.length) throw do_error("草稿中没有匹配的媒体代理路由", 404);
    target.searchParams.delete("token");
    const metadata = { ...selected.metadata, debug_request: true };
    const cookie_access = await this.cookie_access(snapshot.script, snapshot.metadata,
      snapshot.script_id, snapshot.grant_id, true);
    try {
      const result = await execute_script(snapshot.script, metadata,
        spec => this.script_invoke("", spec, "", ""), {
          method: "GET", pathname: target.pathname, params: selected.match.params,
          query: Object.fromEntries(target.searchParams), public_origin: snapshot.public_origin,
        }, [], "", cookie_access);
      const returned = JSON.parse(result.output);
      return { route: metadata, descriptor: image_proxy_descriptor(metadata, returned),
        ...(["img", "video", "audio"].includes(returned.kind) ? { kind: returned.kind } : {}) };
    } catch (error) {
      cookie_access?.assert_grant();
      const fields = script_failure_fields(error);
      this.record_log({ route: snapshot.script_id, path: metadata.path, source: "test",
        status: "error", phase: fields.phase, level: "error", message: fields.message,
        error_text: fields.error_text, lines: fields.lines });
      throw do_error("预览媒体执行失败：" + fields.message, 502);
    }
  }

  /** mock 测试保持独立：不连真实设备，未声明的 invoke 直接抛错。 */
  async test_script(request) {
    const content_length = Number(request.headers.get("Content-Length") ?? "0");
    if (content_length > ScriptModel.MAX_BYTES + ScriptTestRequestModel.MOCK_MAX_BYTES + 4096) {
      throw do_error("request body is too large", 413);
    }
    /** @type {unknown} */
    let body;
    try {
      body = await request.json();
    } catch {
      throw do_error("invalid JSON", 400);
    }
    const parsed_body = ScriptTestRequestModel.fromBody(body);
    if (!parsed_body.ok) {
      throw do_error(parsed_body.error.message, parsed_body.error.status);
    }
    const normalized = parsed_body.model;
    const started_at = Date.now();
    // 测试运行全部落日志（成败都写）：草稿还没保存时 route 为空串，仍可用于
    // CF Workers Logs 查询；编辑已保存脚本时前端会带上 route，历史失败可在卡片内翻查。
    const log_base = {
      route: normalized.route,
      source: "test",
      method: "POST",
      pathname: "/admin/api/scripts/test",
    };
    const compiled = await compile_script_module(normalized.script);
    if (compiled.error !== "" || compiled.metadata === null) {
      this.record_log({
        ...log_base,
        status: "error",
        phase: "module",
        level: "error",
        message: "脚本校验失败",
        error_text: compiled.error,
        elapsed_ms: Date.now() - started_at,
      });
      return {
        ok: false,
        elapsed_ms: 0,
        error: "脚本校验失败：" + compiled.error,
        lines: [],
      }
    }
    const entries = compiled.metadata.routes;
    const route_index = normalized.route_index ?? 0;
    const metadata = entries[route_index];
    if (!metadata) throw do_error("route_index 超出路由范围", 400);
    let example_url;
    try {
      example_url = new URL(String(metadata.example), "https://example.invalid");
    } catch {
      return { ok: false, elapsed_ms: 0, error: "route.example 无效", lines: [] }
    }
    const path_match = RssRoutePatternModel(String(metadata.path)).match(example_url.pathname);
    if (path_match === null) {
      return {
        ok: false,
        elapsed_ms: 0,
        error: "route.example 与 route.path 不匹配",
        lines: [],
      }
    }
    /** @type {Record<string, string>} */
    const query = Object.create(null);
    for (const [name, value] of example_url.searchParams) query[name] = value;
    const log_context = {
      ...log_base,
      path: String(metadata.path ?? ""),
      params: path_match.params,
      query,
    };
    try {
      const { output, lines } = await execute_script(
        normalized.script,
        metadata,
        null,
        {
          method: "GET",
          pathname: example_url.pathname,
          public_origin: this.resolve_public_origin(request),
          params: path_match.params,
          query,
        },
        this.rss_cookies(),
        normalized.mock_ctx);
      this.record_log({
        ...log_context,
        status: "ok",
        phase: "ok",
        level: "info",
        message: "测试运行成功",
        lines,
        elapsed_ms: Date.now() - started_at,
      });
      return {
        ok: true,
        elapsed_ms: Date.now() - started_at,
        bytes: output.length,
        preview: output.slice(0, 4096),
        lines,
      }
    } catch (failure) {
      const fields = script_failure_fields(failure);
      this.record_log({
        ...log_context,
        ...failure.request_context,
        status: "error",
        phase: fields.phase,
        level: "error",
        message: fields.message,
        error_text: fields.error_text,
        lines: fields.lines,
        elapsed_ms: Date.now() - started_at,
      });
      return {
        ok: false,
        elapsed_ms: Date.now() - started_at,
        error: failure instanceof Error ? failure.message : String(failure),
        lines: fields.lines,
      }
    }
  }

  /**
   * 沙箱脚本的设备调用入口：以发起 RSS 请求的用户身份走 invoke 全流程，
   * 复用 create_task 的积分校验与扣费、租约派发和等待器。
   * @param {string} access_token_id
   * @param {{ method: string, args: unknown, target_device_id?: string }} spec
   * @param {string} [credit_subject] 扣费归因标签，原样透传到 create_task 写账本那一跳
   * @param {string} [coalesce_key] 合并键：同键的在飞同参调用会被复用而不是重复下发
   * @returns {Promise<unknown>} 设备返回的结果
   */
  async script_invoke(access_token_id, spec, credit_subject = "", coalesce_key = "", resume_key = "") {
    const method = typeof spec.method === "string" ? spec.method.trim() : "";
    if (!valid_identifier(method)) {
      throw new Error("invoke 的 method 非法：" + String(spec.method).slice(0, 100));
    }
    const args = spec.args ?? {};
    if (args === null || typeof args !== "object" || Array.isArray(args)) {
      throw new Error("invoke 的 args 必须是对象");
    }
    const target_device_id = typeof spec.target_device_id === "string" ? spec.target_device_id.trim() : "";
    const body = JSON.stringify({ method, args, target_device_id, ...(resume_key ? { idempotency_key: resume_key } : {}) });
    /** @type {Record<string, string>} */
    const invoke_headers = {
      "Content-Type": "application/json",
      "Content-Length": String(body.length),
      "X-Api-Authenticated-Publisher-ID": "caller:" + access_token_id,
      "X-Api-Access-Token-ID": access_token_id,
    };
    if (credit_subject !== "") invoke_headers[CREDIT_SUBJECT_HEADER] = credit_subject;
    if (coalesce_key !== "") invoke_headers[COALESCE_KEY_HEADER] = coalesce_key;
    const invoke_request = new Request("https://internal/invoke", {
      method: "POST",
      headers: invoke_headers,
      body,
    });
    // invoke 成功回 do_result（200 + 结果），失败抛 DurableObjectError；把后者还原成
    // ScriptInvokeError，保持「402/409 被 serve_rss_route 透传」的既有语义。
    try {
      const result = await this.app.tasks.invoke(invoke_request, resume_key ? 1000 : SCRIPT_INVOKE_TIMEOUT_MS, resume_key !== "");
      return result.data;
    } catch (error) {
      if (error instanceof DurableObjectError) {
        const message = typeof error.error === "string" ? error.error : "";
        throw new ScriptInvokeError(
          error.status,
          "调用设备失败（HTTP " + error.status + (message ? "：" + message : "") + "）", error.headers);
      }
      throw error;
    }
  }

  /**
   * 启用中的路由表（内存索引，`invalidate_routes` 是唯一失效点）。
   * 返回的行会被 `RssRouteSelectionModel` 按只读使用，不做拷贝：每次请求都复制一遍
   * 500 行反而是新的开销。
   * @returns {Record<string, unknown>[]}
   */
  enabled_route_rows() {
    if (this.enabled_routes === null) {
      this.enabled_routes = this.repo.scripts.list_enabled().filter(row => ScriptModel.fromRow(row).status === "published");
    }
    return this.enabled_routes;
  }

  /**
   * 判断请求地址是否命中一个启用中的公开自有 RSS 源。只比较 route pathname，
   * query 无论有无、是否一致都视为同一个源，因此公开源的任意 query 变体同样公开。
   * @param {string} route_pathname
   * @returns {boolean}
   */
  rss_address_is_public(route_pathname) {
    const rows = this.repo.discovery.list_public_routes();
    return rows.some((row) =>
      DiscoverySourceModel.fromRow(row).is_public_route(route_pathname));
  }

  /**
   * 公开 RSS/Atom 输出路由：GET /_public/feed/<format>/<path>
   * 匿名身份仅可命中 discovery_sources 中地址完全匹配的公开源；
   * 公开性只比较 route pathname，与 format 无关。
   * XML 快照持久化 feed JSON 和 RSS/Atom 正文。公开请求只读；私密请求按 10 分钟 TTL
   * 生成并合并并发。refresh 仅由后台服务传入，不能由外部请求头触发。
   * @param {string} format
   * @param {string} route_pathname
   * @param {Request} request
   * @param {{ refresh?: boolean }} [options]
   * @returns {Promise<{ body: string, headers: Record<string, string> }>}
   */
  async serve_rss_route(format, route_pathname, request, { refresh = false } = {}) {
    const debug_request = format === "debug";
    if (
      !route_pathname.startsWith("/") ||
      new TextEncoder().encode(route_pathname).byteLength > MAX_RSS_ROUTE_PATH_BYTES
    ) {
      throw do_error("not found", 404);
    }
    const access_token_id = (request.headers.get("X-Api-Access-Token-ID") ?? "").trim();
    const authenticated = valid_identifier(access_token_id);
    const request_url = new URL(request.url);
    const request_query = new URLSearchParams();
    /** @type {Record<string, string>} */
    const query = Object.create(null);
    for (const [name, value] of request_url.searchParams) {
      // token 在 Worker 已被剥离；DO 再次过滤，避免凭证进入地址匹配和脚本上下文。
      if (name === "token") continue;
      request_query.append(name, value);
      query[name] = value;
    }
    // 管理预览按脚本 ID 选择（含停用脚本），缓存不污染公开路由。
    const preview_script_id = request_url.pathname.startsWith("/_admin/feed/")
      ? (request.headers.get("X-RSS-Preview-Script-ID") ?? "").trim() : "";
    const preview_row = preview_script_id ? this.repo.scripts.find_config(preview_script_id) : null;
    const rows = preview_script_id ? (preview_row ? [preview_row] : []) : this.enabled_route_rows();
    const selected = RssRouteSelectionModel(rows, route_pathname).best();
    if (format === "raw" && !selected) throw do_error("not found", 404);
    const directory_public = this.rss_address_is_public(route_pathname);
    const directory_private = (this.repo.discovery?.list_private_routes?.() || []).some(row => SourceAddressModel(row.feed_url).matches(route_pathname));
    const feed_public = directory_public || !directory_private && selected?.metadata.public === true;
    const public_route = request_url.pathname.startsWith("/_admin/feed/") || feed_public;
    if (debug_request && (!selected || !ScriptModel.fromRow(selected.row).debug)) throw do_error("not found", 404);
    const authentication = {
      credential_sources: (request.headers.get("X-RSS-Credential-Sources") ?? "").split(",")
        .filter(value => ["query", "bearer", "header"].includes(value)),
      verification: authenticated ? "accepted" : ["missing", "invalid_format", "rejected", "invalid_session"].find(
        value => value === request.headers.get("X-RSS-Credential-Status")) || "missing",
      browser_credentials_received: request.headers.get("X-RSS-Browser-Credentials") === "present",
      authenticated, public_route,
    };
    if (!authenticated && !public_route) {
      const failure = new DurableObjectError("订阅源需要有效访问凭证，请使用包含 token 的订阅地址或配置请求头", 401,
        { code: "FEED_AUTH_REQUIRED" }, { "WWW-Authenticate": 'Bearer realm="FindRSS"' });
      if (selected && ScriptModel.fromRow(selected.row).debug && request_url.pathname.startsWith("/_public/feed/")) {
        failure.details.rss_debug = {
          script: { id: String(selected.row.route), name: selected.metadata.name || "", path: selected.metadata.path },
          request: { method: "GET", pathname: "/" + (debug_request ? "debug" : format) + route_pathname, params: selected.path_match.params, query, authentication },
          phase: "auth", error_text: failure.stack, elapsed_ms: 0, invoked: false, upstream_requests: [],
          lines: [{ level: "info", text: "FindRSS 鉴权未通过：脚本未执行，未发起上游请求，尚未向微博等站点发送 Cookie。" }],
        };
      }
      throw failure;
    }
    if (selected === null) {
      throw do_error("not found", 404);
    }
    if (!refresh && (format === "rss" || format === "atom") && request_url.pathname.startsWith("/_public/feed/")) {
      this.app.statistics?.record_call(route_pathname, request_query);
    }
    let metadata;
    try {
      const root_metadata = JSON.parse(String(selected.row.metadata_json));
      metadata = { ...selected.metadata, routes: root_metadata.routes, permissions: root_metadata.permissions, version: root_metadata.version || "", cookie_grant_id: root_metadata.cookie_grant_id, debug: root_metadata.debug === true };
      metadata.debug_request = debug_request;
    } catch {
      throw do_error("script metadata is invalid", 500);
    }
    if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
      throw do_error("script metadata is invalid", 500);
    }
    const cookie_access = await this.cookie_access(String(selected.row.script), metadata, String(selected.row.route), metadata.cookie_grant_id || "");
    const request_context = {
      public_origin: this.resolve_public_origin(request),
      method: "GET",
      pathname: format === "raw" ? route_pathname : "/" + (debug_request ? "debug" : format) + route_pathname,
      params: selected.path_match.params,
      query,
    };
    // 公开自有源不计积分：即使携带身份也按匿名调用下发，登录用户读公开源同样免费；
    // 只有非公开源（个人订阅凭证访问）才以调用方身份计费。
    const invoke_token = public_route ? "" : access_token_id;
    // 相同 path+query 复用快照；私密源窗口内首个请求者承担 invoke 成本。
    // XML 快照同时保存 RSS 与 Atom；公开/私密分开，切换权限不会复用旧公开产物。
    const snapshot = (format === "rss" || format === "atom") && !preview_script_id;
    const cache_key = (snapshot ? (feed_public ? "public-snapshot:" : "private-snapshot:")
      : preview_script_id ? "admin-preview:" + preview_script_id + ":" : "")
      + rss_route_cache_key(route_pathname, request_query);
    const self_url = (request.headers.get("X-Feed-Public-URL") ?? "").trim();
    if (snapshot && feed_public && !this.public_registered.has(cache_key)) {
      if (!this.repo.rss_route_cache.register_public(cache_key, route_pathname, request_query, self_url, RSS_ROUTE_CACHE_MAX_ENTRIES)) {
        throw do_error("公开订阅源快照数量已达上限", 429);
      }
      this.public_registered.add(cache_key);
      await this.ports.schedule_alarm?.();
    }
    if (snapshot && feed_public && refresh) this.repo.rss_route_cache.public_attempt(cache_key, Date.now());
    if (snapshot && feed_public && !refresh && request_url.pathname.startsWith("/_public/feed/")) {
      const stored = this.ports.route_cache.resolve(cache_key, Date.now(), true);
      const body = stored?.rendered?.get(format + "\n");
      if (body === undefined) throw do_error("订阅源快照正在后台生成，请稍后重试", 503, {}, { "Retry-After": "5" });
      return { body, headers: { "Content-Type": FeedModel.content_type(format), "Cache-Control": "public, max-age=120",
        "X-Content-Type-Options": "nosniff", "X-Api-RSS-Cache": "hit" } };
    }
    // 只在写账本那一跳归一；这里原样透传，因此最多错标调用方自己那一行。
    const credit_subject = (request.headers.get(CREDIT_SUBJECT_HEADER) ?? "").trim();
    // 设备调用错误对象穿不过 QuickJS 沙箱，必须在这里的抛出点先截住上游状态。
    /** @type {{ status: number, message: string, headers: Record<string, string> } | null} */
    let invoke_failure = null;
    let script_invoked = false;
    const refresh_id = request.headers.get("X-FindRSS-Refresh-ID") ?? "";
    const resumable = /^[a-f0-9-]{36}$/.test(refresh_id);
    let invocation_index = 0;
    const invoke_impl = async (spec) => {
      script_invoked = true;
      const index = ++invocation_index;
      try {
        // cache_key 作为合并键一路传到 create_task：同一个「路由+query」派生出的同参调用
        // 已经有一条在飞时，后来的请求挂到那条上等结果，而不是再下发一次设备调用。
        const resume_key = resumable ? "rss:" + await sha256_resume(JSON.stringify([refresh_id, cache_key, index, spec])) : "";
        return await this.script_invoke(invoke_token, spec, credit_subject, cache_key, resume_key);
      } catch (error) {
        if (invoke_failure === null && error instanceof ScriptInvokeError) {
          if (error.status === 402 || error.status === 409 || error.status === 503) {
            // 调用方可以直接行动（充积分 / 等设备上线），原样透出上游状态。
            invoke_failure = { status: error.status, message: error.message, headers: {} };
          } else if (error.status === 504) {
            // invoke 的等待器到点 = 设备还没做完，**不是失败**：那条 calls 行仍在排/跑。
            // 回 503 + Retry-After 让调用方重试，重试会因合并键挂回同一条任务。
            invoke_failure = {
              status: 503,
              message: "设备调用尚未完成，请稍后重试",
              headers: { "Retry-After": "5", ...error.headers, "X-FindRSS-Pending": "1" },
            };
          }
        }
        throw error;
      }
    };
    const started_at = Date.now();
    try {
      const produce = async () => {
        const result = await execute_script(
          String(selected.row.script),
          metadata,
          invoke_impl,
          request_context,
          [], "", cookie_access);
        cookie_access?.assert_grant();
        if (snapshot) {
          const feed = FeedModel.fromValue(JSON.parse(result.output));
          const rendered = new Map();
          for (const type of ["rss", "atom"]) {
            const url = this.public_origin ? new URL("/" + type + route_pathname, this.public_origin) : self_url ? new URL(self_url) : null;
            if (url) {
              url.pathname = "/" + type + route_pathname;
              url.search = new URLSearchParams([...request_query].sort()).toString();
            }
            rendered.set(type + "\n", feed.render(type, { self_url: url?.toString() || "" }));
          }
          result.rendered = rendered;
        }
        return result;
      };
      const { output, invoked, cached, lines, upstream_requests, cookie_accesses, rendered } = debug_request
        ? await produce()
        : await this.ports.route_cache.run(cache_key, Date.now(), produce, { force: refresh });
      cookie_access?.assert_grant();
      if (format === "raw" && !debug_request) {
        return {
          raw: JSON.parse(output), route: { allowed_hosts: metadata.allowed_hosts },
          version: String(selected.row.route) + ":" + selected.row.updated_at + ":" + metadata.route_index,
          headers: { "Cache-Control": public_route ? "public, max-age=120" : "private, max-age=60",
            "X-Api-RSS-Cache": cached ? "hit" : "miss" },
        };
      }
      if (debug_request) {
        return {
          body: output,
          rss_debug: {
            script: { id: String(selected.row.route), name: metadata.name || "", path: metadata.path },
            request: { ...request_context, authentication }, phase: "ok", lines, upstream_requests, cookie_accesses,
            elapsed_ms: Date.now() - started_at, invoked,
          },
        };
      }
      // 普通订阅读完整 XML；指定脚本的管理预览保留原有渲染缓存。
      const body = snapshot ? rendered.get(format + "\n") : this.ports.route_cache.render(
        cache_key,
        format,
        self_url,
        () => FeedModel.fromValue(JSON.parse(output)).render(format, { self_url }));
      return {
        body,
        // 匿名公开源按约定共享 120 秒；登录用户保留原有个性化缓存策略。
        headers: {
          "Cache-Control": snapshot && !feed_public ? "private, no-cache" : !authenticated
            ? "public, max-age=120"
            : invoked ? "private, max-age=60" : "public, max-age=120",
          "Content-Type": FeedModel.content_type(format),
          "X-Content-Type-Options": "nosniff",
          "X-Api-RSS-Cache": cached ? "hit" : "miss",
        },
      };
    } catch (failure) {
      cookie_access?.assert_grant();
      const fields = script_failure_fields(failure);
      const phase = invoke_failure !== null ? "invoke" : fields.phase;
      const debug_details = metadata.debug === true && request_url.pathname.startsWith("/_public/feed/") ? {
        rss_debug: {
          script: { id: String(selected.row.route), name: String(metadata.name || ""), path: String(selected.row.path) },
          request: { ...request_context, ...failure.request_context, authentication }, phase, error_text: fields.error_text, lines: fields.lines,
          cookie_accesses: failure.cookie_accesses || [], upstream_requests: failure.upstream_requests || [],
          elapsed_ms: Date.now() - started_at, invoked: script_invoked,
          upstream_error: invoke_failure?.message || "",
        },
      } : {};
      if (invoke_failure?.headers?.["X-FindRSS-Pending"] === "1") {
        throw do_error(invoke_failure.message, invoke_failure.status, debug_details, invoke_failure.headers);
      }
      // 只记失败的真实请求：成功、缓存命中与正常轮询不写库，避免随订阅者轮询量线性膨胀。
      // 设备调用被上游拒绝/未完成时相位记为 invoke，便于和脚本自身错误区分。
      // 再加一道时间窗闸门：冷缓存下同键的 N 个并发请求会同时走到这里，
      // 逐条写库既是同一原因的重复记录，也会把 script_logs 写爆。
      if (this.failure_log_throttle.allow(phase + "|" + cache_key, Date.now())) {
        this.record_log({
          route: String(selected.row.route),
          path: String(selected.row.path),
          source: "request",
          method: request_context.method,
          pathname: request_context.pathname,
          params: request_context.params,
          query: request_context.query,
          status: "error",
          phase,
          level: "error",
          message: fields.message,
          error_text: fields.error_text,
          lines: fields.lines,
          elapsed_ms: Date.now() - started_at,
          invoked: script_invoked,
        });
      }
      // 脚本可能吞掉设备错误后另抛异常，但上游状态（402/409 可行动、503 可重试）优先于
      // 统一的 502 透出，否则调用方看不到「重试就好」这个信息。
      if (invoke_failure !== null) {
        throw do_error(invoke_failure.message, invoke_failure.status, debug_details, invoke_failure.headers);
      }
      if (failure.problem) {
        throw do_error(failure.problem.detail, failure.problem.status, { ...debug_details, code: failure.problem.code });
      }
      throw do_error(request_url.pathname.startsWith("/_admin/feed/") ? fields.message : "script failed", 502, debug_details);
    }
  }

  /**
   * 按 route 倒序翻页读取脚本执行日志（id 倒序 + before_id，形状对齐 list_device_logs）。
   * @param {URL} url
   * @returns {Record<string, unknown>}
   */
  list_script_logs(url) {
    const parsed_query = ScriptLogQueryModel.fromQuery(url);
    if (!parsed_query.ok) {
      throw do_error(parsed_query.error.message, parsed_query.error.status);
    }
    const query = parsed_query.model;
    const rows = this.repo.script_logs.list_by_route(
      query.route,
      query.before_id,
      query.limit + 1);
    const has_more = rows.length > query.limit;
    const page = has_more ? rows.slice(0, query.limit) : rows;
    return {
      logs: page.map((row) => ScriptLogModel.fromRow(row).toValue()),
      has_more,
      next_before_id: has_more && page.length > 0 ? page[page.length - 1].id : null,
      retention_milliseconds: RETENTION_MILLISECONDS,
    }
  }
}

async function sha256_resume(value) {
 const bytes = new TextEncoder().encode(value);
 return [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(value=>value.toString(16).padStart(2,"0")).join("");
}
