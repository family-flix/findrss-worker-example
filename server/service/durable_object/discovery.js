// 订阅源目录（discovery_sources）与头像的读写。
//
// 只回数据或抛 DurableObjectError，绝不造 Response：头像取回回 `{ bytes, content_type }`，
// 由 api 层组装需要长缓存的二进制 Response。
import { DiscoverySourceModel, SourceAvatarModel } from "../../domain/discovery_source.js";
import { DISCOVERY_CATEGORIES, RSS_ROUTE_CACHE_TTL_MS } from "../../lib/constants.js";
import { do_error, do_result } from "./error.js";
import { rss_route_cache_key } from "../../infra/rss_cache.js";
import { SourceAddressModel } from "../../domain/source_address.js";
import { ScriptModel } from "../../domain/script.js";
import { DISCOVERY_CATALOG_KEY } from "../../lib/discovery_catalog.js";
import { discovery_platforms, discovery_platform_id } from "../../lib/discovery_platform.js";
import { RssRoutePatternModel } from "../../domain/rss_route.js";
import { gzip_html } from "../../infra/discovery_compression.js";

const snapshot_interval = RSS_ROUTE_CACHE_TTL_MS;

function http_origin(value) {
  try {
    const url = new URL(value);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.hostname !== "internal") return url.origin;
  } catch {}
  return "";
}

function snapshot_value(row, include_error = false) {
  let articles = [];
  try { articles = JSON.parse(row.articles_json || "[]"); } catch {}
  return { saved_at: Number(row.snapshot_saved_at || row.saved_at || 0),
    articles: Array.isArray(articles) ? articles : [],
    ...(include_error ? { error: String(row.snapshot_error || row.error || "") } : {}) };
}

export class ServiceDiscovery {
  /**
   * @param {{ repo: Record<string, any>, storage?: any, route_cache?: any, object_store?: any, load_snapshot?: Function, schedule_alarm?: Function, render_catalog?: Function, public_origin?: string }} deps
   */
  constructor({ repo, storage, route_cache = null, object_store = null, load_snapshot = null, schedule_alarm = null, render_catalog = null, statistics = null, public_origin = "" }) {
    this.repo = repo;
    this.statistics = statistics;
    this.storage = storage;
    this.route_cache = route_cache;
    this.object_store = object_store;
    this.load_snapshot = load_snapshot;
    this.schedule_alarm = schedule_alarm;
    this.render_catalog = render_catalog;
    this.catalog_publish = Promise.resolve();
    this.catalog_checked = false;
    this.catalog_retry_at = null;
    this.snapshot_pending = new Map();
    this.snapshot_refreshing = null;
    this.public_origin = http_origin(public_origin);
    this.last_public_origin = "";
  }

  async remember_public_origin(public_url) {
    const origin = http_origin(public_url);
    if (this.public_origin || !origin || origin === this.last_public_origin) return;
    await this.storage?.put("discovery_public_origin", origin);
    this.last_public_origin = origin;
  }

  async snapshot_origin(public_url) {
    return this.public_origin || http_origin(public_url) || this.last_public_origin
      || http_origin(await this.storage?.get("discovery_public_origin"));
  }

  /**
   * @param {URL} url
   * @param {boolean} include_disabled
   * @returns {Record<string, unknown>}
   */
  list_discovery_sources(url, include_disabled) {
    const category = (url.searchParams.get("category") ?? "").trim();
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    const tags = [...new Set(url.searchParams.getAll("tag").map((tag) => tag.trim()).filter(Boolean))];
    const source_type = (url.searchParams.get("source_type") ?? "").trim();
    const platforms = this.platforms();
    if (source_type && !DiscoverySourceModel.TYPES.has(source_type) && !platforms.some(platform => platform.id === source_type)) throw do_error("invalid source_type", 400);
    if (category !== "" && !DISCOVERY_CATEGORIES.has(category)) {
      throw do_error("invalid category", 400);
    }
    if (tags.length > 13 || tags.some((tag) => tag.length > 32 || /[\r\n]/.test(tag))) {
      throw do_error("invalid tag", 400);
    }
    const filters = {
      include_disabled,
      category,
      query,
      tags,
      source_type,
    };
    let pagination = {};
    if (!include_disabled && (url.searchParams.has("limit") || url.searchParams.has("offset"))) {
      const limit_value = Number(url.searchParams.get("limit") ?? "20");
      const offset_value = Number(url.searchParams.get("offset") ?? "0");
      const limit = Number.isFinite(limit_value) ? Math.max(1, Math.min(100, Math.floor(limit_value))) : 20;
      const offset = Number.isFinite(offset_value) ? Math.max(0, Math.min(1_000_000, Math.floor(offset_value))) : 0;
      const total_count = this.repo.discovery.count_filtered(filters);
      Object.assign(filters, { limit, offset });
      pagination = { total_count, limit, offset, has_more: offset + limit < total_count };
    }
    const rows = this.repo.discovery.list(filters);
    return { ...pagination, platforms: discovery_platforms(platforms, rows), sources: rows.map(row => this.source_value(row, include_disabled)), tags: this.tags() }
  }

  platforms() {
    return discovery_platforms(this.repo.platforms?.list() || [],
      this.repo.discovery.list_types?.() || []);
  }

  tags() {
    return this.repo.tags?.list() || [];
  }

  validate_source(body) {
    const pathname = SourceAddressModel(body.feed_url).route_pathname;
    const route = (this.repo.scripts?.list() || []).map(row => ScriptModel.fromRow(row))
      .filter(script => script.status === "published").flatMap(script => script.routes)
      .find(entry => RssRoutePatternModel.fromValue(entry.path)?.match(pathname));
    return DiscoverySourceModel.validate({ ...body, tags: body.tags === undefined ? route?.tags : body.tags }, new Set([...DiscoverySourceModel.TYPES, ...this.platforms().map(platform => platform.id)]), discovery_platform_id(route?.platform));
  }

  source_value(row, include_disabled = false) {
    const model = DiscoverySourceModel.fromRow(row);
    const source = model.toValue();
    source.tags = model.discovery_tags();
    source.snapshot = source.require_token ? { saved_at: 0, articles: [] } : snapshot_value(row, include_disabled);
    if (include_disabled && this.route_cache && SourceAddressModel(source.feed_url).is_route()) {
      const address = new URL(source.feed_url.replace("{{hostname}}", "https://template.invalid"));
      const pathname = address.pathname.replace(/^\/(rss|atom)/, "");
      address.searchParams.delete("token");
      source.cache = this.route_cache.inspect((source.require_token ? "private-snapshot:" : "public-snapshot:") + rss_route_cache_key(pathname, address.searchParams));
    }
    return source;
  }

  public_catalog() {
    const rows = this.repo.discovery.list({ include_disabled: false, limit: DiscoverySourceModel.MAX_SOURCES, offset: 0 });
    const sources = rows.map(row => this.source_value(row));
    return { sources, platforms: discovery_platforms(this.platforms(), rows), tags: this.tags() };
  }

  async ensure_catalog() {
    if (!this.object_store || !this.render_catalog || this.catalog_checked && this.catalog_retry_at === null) return;
    let needed;
    try {
      needed = await this.storage.get("discovery_catalog_dirty") || !await this.object_store.head(DISCOVERY_CATALOG_KEY) || !await this.storage.get("discovery_catalog_lazy_avatars_v1") || !await this.storage.get("discovery_catalog_platforms_v1") || !await this.storage.get("discovery_catalog_script_tags_v1");
    } catch (error) {
      this.catalog_retry_at = Date.now() + 60000;
      await this.schedule_alarm?.();
      throw error;
    }
    if (needed) {
      await this.publish_catalog();
    }
    this.catalog_checked = true;
  }

  publish_catalog() {
    if (!this.object_store || !this.render_catalog) return Promise.resolve();
    // 串行写入，后来的发布重新读 SQL；并发编辑/刷新不会让旧产物覆盖新目录。
    this.catalog_publish = this.catalog_publish.catch(() => {}).then(async () => {
      try {
        await this.storage.put("discovery_catalog_dirty", true);
        const html = await this.render_catalog(this.public_catalog());
        await this.object_store.put(DISCOVERY_CATALOG_KEY, await gzip_html(html),
          { httpMetadata: { contentType: "text/html; charset=utf-8", contentEncoding: "gzip" } });
        await this.storage.delete("discovery_catalog_dirty");
        await this.storage.put("discovery_catalog_lazy_avatars_v1", true);
        await this.storage.put("discovery_catalog_platforms_v1", true);
        await this.storage.put("discovery_catalog_script_tags_v1", true);
        this.catalog_checked = true;
        this.catalog_retry_at = null;
      } catch (error) {
        this.catalog_retry_at = Date.now() + 60000;
        // 发布失败时移除旧产物，权限变化后不继续从 R2 展示旧的公开文章。
        try { await this.object_store.delete(DISCOVERY_CATALOG_KEY); }
        catch (delete_error) { console.warn("discovery catalog cleanup failed", delete_error); }
        await this.schedule_alarm?.();
        console.warn("discovery catalog publish failed", error.message);
        throw do_error("目录已保存，静态发布失败，稍后自动重试", 503);
      }
    });
    return this.catalog_publish;
  }

  /**
   * 广场详情页（`/s/<id>`）的数据：单条源 + 同平台的相关源。
   * 单开一个端点而不是让广场去 list 里捞：目录上限 1000 条、列表还夹了 500，捞法既慢
   * 又会让第 500 条之后的详情页永远 404。
   * `related` 只回 id/title —— 详情页把它们渲染成 `<a href="/s/<id>">`，是给爬虫发现
   * 其它详情页的内部链接网，不需要正文。
   * @param {string} id
   * @returns {Record<string, unknown>}
   */
  get_public_discovery_source(id) {
    const row = this.repo.discovery.find_enabled(id);
    if (row === undefined) {
      throw do_error("source not found", 404);
    }
    const model = DiscoverySourceModel.fromRow(row);
    const source = model.toValue();
    source.tags = model.discovery_tags();
    const related = this.repo.discovery.list_related(id, source.source_type, DiscoverySourceModel.MAX_RELATED);
    return { source, related }
  }

  next_snapshot_at() {
    if (!this.load_snapshot) return this.catalog_retry_at;
    if (this.snapshot_refreshing) return Date.now() + 60000;
    const next = this.repo.discovery.snapshot_next_at(snapshot_interval);
    const snapshot_at = next === null ? null : Math.max(Number(next), Date.now() + 5000);
    return this.catalog_retry_at === null ? snapshot_at : Math.min(snapshot_at ?? Infinity, this.catalog_retry_at);
  }

  refresh_due_snapshots() {
    if (this.snapshot_refreshing) return this.snapshot_refreshing;
    const sources = this.repo.discovery.snapshot_due(Date.now() - snapshot_interval, 4);
    this.snapshot_refreshing = Promise.all(sources.map(source => this.refresh_discovery_snapshot(source.id)))
      .finally(async () => { this.snapshot_refreshing = null; await this.schedule_alarm?.(); });
    return this.snapshot_refreshing;
  }

  async refresh_discovery_snapshot(source_id, public_url = "") {
    if (this.snapshot_pending.has(source_id)) return this.snapshot_pending.get(source_id);
    const source = this.repo.discovery.find(source_id);
    if (!source) throw do_error("discovery source not found", 404);
    if (source.require_token && !SourceAddressModel(source.feed_url).is_route()) throw do_error("外部私密源的快照由上游管理", 400);
    if (!this.load_snapshot) throw do_error("snapshot service is unavailable", 503);
    if (!source.require_token) this.repo.discovery.snapshot_attempt(source_id, source.feed_url, Date.now());
    const pending = (async () => {
      try {
        const origin = await this.snapshot_origin(public_url);
        const articles = await this.load_snapshot(source, origin);
        // 抓取期间编辑 / 删除源时，不能把旧地址的内容重新发布到新卡片。
        const current = this.repo.discovery.find(source_id);
        if (current?.feed_url === source.feed_url && !current.require_token) {
          this.repo.discovery.snapshot_save(source_id, source.feed_url, articles, Date.now());
        }
      } catch (error) {
        if (source.require_token) throw error;
        this.repo.discovery.snapshot_save(source_id, source.feed_url, [], 0, String(error.message || "快照更新失败").slice(0, 240));
      } finally { this.snapshot_pending.delete(source_id); }
      if (!source.require_token) await this.publish_catalog();
      return { snapshot: source.require_token ? { saved_at: 0, articles: [], error: "" }
        : snapshot_value(this.repo.discovery.snapshot_get(source_id) || {}, true),
        cache: this.source_value(source, true).cache };
    })();
    this.snapshot_pending.set(source_id, pending);
    return pending;
  }

  validate_feed_route(feed_url) {
    const address = SourceAddressModel(feed_url);
    if (!address.is_route()) return;
    const matches = this.repo.scripts.list().some(row => {
      const script = ScriptModel.fromRow(row);
      return script.kind === "rss" && script.covers(address.route_pathname);
    });
    if (!matches) throw do_error("订阅源路由必须匹配 kind 为 rss 的脚本", 400);
  }

  /**
   * @param {Request} request
   * @returns {Promise<Record<string, unknown>>}
   */
  async create_discovery_source(request) {
    const parsed = await DiscoverySourceModel.parseBody(request, body => this.validate_source(body));
    if (!parsed.ok) throw do_error(parsed.error.message, parsed.error.status)
    const source = parsed.model;
    this.validate_feed_route(source.feed_url);
    const source_count = this.repo.discovery.count();
    if (source_count >= DiscoverySourceModel.MAX_SOURCES) {
      throw do_error("discovery source limit reached", 409);
    }
    if (this.repo.discovery.feed_url_taken(source.feed_url)) {
      const conflict = DiscoverySourceModel.duplicate_reason();
      throw do_error(conflict.message, conflict.status);
    }
    const now = Date.now();
    const id = crypto.randomUUID();
    this.repo.discovery.insert({
      id,
      title: source.title,
      description: source.description,
      website: source.website,
      feed_url: source.feed_url,
      category: source.category,
      tags_json: JSON.stringify(source.tags),
      enabled: source.enabled ? 1 : 0,
      require_token: source.require_token ? 1 : 0,
      sort_order: source.sort_order,
      source_type: source.source_type,
      created_at: now,
      updated_at: now,
    });
    const row = this.repo.discovery.find(id);
    this.route_cache?.invalidate_all?.();
    this.statistics?.invalidate_sources();
    await this.publish_catalog();
    await this.schedule_alarm?.();
    return do_result({ source: DiscoverySourceModel.fromRow(row).toValue() }, 201);
  }

  /**
   * @param {Request} request
   * @param {string} source_id
   * @returns {Promise<Record<string, unknown>>}
   */
  async update_discovery_source(request, source_id, expected_source) {
    const content_length = Number(request.headers.get("Content-Length") ?? "0");
    if (content_length > 16 * 1024) {
      throw do_error("request body is too large", 413);
    }
    /** @type {Record<string, unknown>} */
    let body;
    try {
      body = await request.json();
    } catch {
      throw do_error("invalid JSON", 400);
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw do_error("invalid JSON body", 400);
    }
    const existing = this.repo.discovery.find(source_id);
    if (existing === undefined) {
      throw do_error("discovery source not found", 404);
    }
    const current = DiscoverySourceModel.fromRow(existing);
    if (expected_source && JSON.stringify(current.toValue()) !== JSON.stringify(expected_source)) throw do_error("订阅源已变更，请重新读取后再编辑", 409);
    const candidate = DiscoverySourceModel.merge_for_patch(current, body);
    const parsed = this.validate_source(candidate);
    if (!parsed.ok) throw do_error(parsed.error.message, parsed.error.status)
    const source = parsed.model;
    this.validate_feed_route(source.feed_url);
    if (this.repo.discovery.feed_url_taken_by_other(source.feed_url, source_id)) {
      const conflict = DiscoverySourceModel.duplicate_reason();
      throw do_error(conflict.message, conflict.status);
    }
    this.repo.discovery.update({
      id: source_id,
      title: source.title,
      description: source.description,
      website: source.website,
      feed_url: source.feed_url,
      category: source.category,
      tags_json: JSON.stringify(source.tags),
      enabled: source.enabled ? 1 : 0,
      require_token: source.require_token ? 1 : 0,
      sort_order: source.sort_order,
      source_type: source.source_type,
      updated_at: Date.now(),
    });
    if (existing.feed_url !== source.feed_url || source.require_token) this.repo.discovery.snapshot_delete(source_id);
    this.statistics?.invalidate_sources();
    if (existing.feed_url !== source.feed_url || Boolean(existing.require_token) !== source.require_token || Boolean(existing.enabled) !== source.enabled) this.route_cache?.invalidate_all?.();
    await this.publish_catalog();
    await this.schedule_alarm?.();
    const row = this.repo.discovery.find(source_id);
    return { source: { ...DiscoverySourceModel.fromRow(row).toValue(), snapshot: source.require_token
      ? { saved_at: 0, articles: [] } : snapshot_value(this.repo.discovery.snapshot_get(source_id) || {}, true) } }
  }

  /**
   * @param {string} source_id
   * @returns {Promise<Record<string, unknown>>}
   */
  async delete_discovery_source(source_id, expected_source) {
    if (!this.repo.discovery.exists(source_id)) {
      throw do_error("discovery source not found", 404);
    }
    if (expected_source && JSON.stringify(DiscoverySourceModel.fromRow(this.repo.discovery.find(source_id)).toValue()) !== JSON.stringify(expected_source)) throw do_error("订阅源已变更，请重新读取后再删除", 409);
    const avatar = this.repo.discovery.avatar_get(source_id);
    this.storage.transactionSync(() => this.repo.discovery.delete(source_id));
    this.statistics?.invalidate_sources();
    this.route_cache?.invalidate_all?.();
    await this.delete_avatar_object(avatar);
    await this.publish_catalog();
    return { removed: true, id: source_id }
  }

  /**
   * 头像取回。二进制响应头必须由调用方自己写：`json_response` 会给 `no-store`，而这里的
   * URL 带 `?v=`（内容变一次就换 URL），可以安全地长缓存。
   * @param {string} source_id
   * @returns {Promise<{ bytes: ArrayBuffer, content_type: string }>}
   */
  async get_discovery_avatar(source_id) {
    const row = this.repo.discovery.avatar_get(source_id);
    if (row?.object_key) {
      if (!this.object_store) throw do_error("avatar storage is unavailable", 503);
      try {
        const object = await this.object_store.get(row.object_key);
        if (object) return { bytes: await object.arrayBuffer(), content_type: String(row.content_type) };
      } catch {
        throw do_error("avatar storage read failed", 502);
      }
      throw do_error("avatar not found", 404);
    }
    // 读回的是 ArrayBuffer（绑定 Uint8Array 时 workerd 这样存），所以只信 byteLength。
    const bytes = row?.bytes;
    if (row === undefined || !(bytes?.byteLength > 0)) {
      throw do_error("avatar not found", 404);
    }
    return { bytes, content_type: String(row.content_type) }
  }

  /**
   * @param {Request} request
   * @param {string} source_id
   * @returns {Promise<Record<string, unknown>>}
   */
  async put_discovery_avatar(request, source_id) {
    const existing = this.repo.discovery.find(source_id);
    if (existing === undefined) {
      throw do_error("discovery source not found", 404);
    }
    // 不能只看 Content-Length：经 service binding 转发后它可能是 0。
    const payload = new Uint8Array(await request.arrayBuffer());
    if (payload.byteLength === 0) {
      throw do_error("avatar body is required", 413);
    }
    if (payload.byteLength > SourceAvatarModel.MAX_BYTES) {
      throw do_error("avatar is too large", 413);
    }
    const content_type = SourceAvatarModel.sniff(payload);
    if (content_type === "") {
      throw do_error("avatar must be a PNG, JPEG, WebP or GIF image", 415);
    }
    // 每次上传用独立 key，R2 写入失败或并发替换不会覆盖当前头像。
    const object_key = this.object_store ? `discovery/avatars/${source_id}/${crypto.randomUUID()}` : "";
    if (object_key) {
      try {
        await this.object_store.put(object_key, payload, { httpMetadata: { contentType: content_type } });
      } catch {
        throw do_error("avatar storage write failed", 502);
      }
    }
    let previous, row;
    try {
      this.storage.transactionSync(() => {
        const current = this.repo.discovery.find(source_id);
        if (current === undefined) throw do_error("discovery source not found", 404);
        previous = this.repo.discovery.avatar_get(source_id);
        const now = Math.max(Date.now(), Number(current.avatar_updated_at || 0) + 1);
        // R2 保存字节，SQLite 只保留指针；无绑定时沿用旧存储。
        this.repo.discovery.avatar_put(source_id, content_type, object_key ? new Uint8Array(0) : payload, now, object_key);
        this.repo.discovery.set_avatar_ts(source_id, now);
        row = this.repo.discovery.find(source_id);
      });
    } catch (error) {
      await this.delete_avatar_object({ object_key });
      throw error;
    }
    await this.delete_avatar_object(previous);
    await this.publish_catalog();
    return { source: DiscoverySourceModel.fromRow(row).toValue() }
  }

  /**
   * @param {string} source_id
   * @returns {Promise<Record<string, unknown>>}
   */
  async delete_discovery_avatar(source_id) {
    const existing = this.repo.discovery.find(source_id);
    if (existing === undefined) {
      throw do_error("discovery source not found", 404);
    }
    const avatar = this.repo.discovery.avatar_get(source_id);
    this.storage.transactionSync(() => {
      this.repo.discovery.avatar_delete(source_id);
      this.repo.discovery.set_avatar_ts(source_id, 0);
    });
    const row = this.repo.discovery.find(source_id);
    await this.delete_avatar_object(avatar);
    await this.publish_catalog();
    return { source: DiscoverySourceModel.fromRow(row).toValue() }
  }

  async delete_avatar_object(avatar) {
    if (avatar?.object_key && this.object_store) {
      // shortcut: 清理失败由 SDK 记日志，若孤儿对象积累再加重试回收。
      await this.object_store.delete_many([avatar.object_key], { best_effort: true });
    }
  }
}
