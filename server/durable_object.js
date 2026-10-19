import { DiscoverySourceModel } from "./domain/discovery_source.js";
import { render_embedded_home } from "./infra/discovery_home.js";
import { DISCOVERY_CATALOG_ORIGIN } from "./lib/discovery_catalog.js";
import { feed_hostname_origin } from "./service/worker/discovery.js";
// APIDurableObject：设备接入、任务队列、账号与访问 Token、积分账本、兑换、
// 订阅源目录与 脚本沙箱的宿主。
//
// 这是 composition root：只装引导（DDL→ALTER→依赖索引→种子→legacy 迁移，顺序不可动）、
// 组合根（repository + service 注册表）与平台钩子（fetch / WebSocket / alarm）。
// 业务逻辑全在 `repository/`（纯 SQL，回原始行）与 `service/durable_object/`（编排，抛
// DurableObjectError，绝不造 Response）；HTTP 组装与唯一的错误翻译点是
// `../durable_object_router.js`。
import { DurableObject } from "cloudflare:workers";
import { AdminSocketHub } from "../admin_socket.js";
import { observe_admin_changes } from "./service/durable_object/admin_events.js";
import { route } from "../durable_object_router.js";
import { DeviceSocketHub } from "../socket_hub.js";
import { CallModel } from "./domain/call.js";
import { RssRouteCache } from "./infra/rss_cache.js";
import { create_api_object_store } from "./infra/object_store.js";
import { load_discovery_snapshot } from './infra/discovery_snapshot.js';
import { ScriptModel } from './domain/script.js';
import {
  MAINTENANCE_MILLISECONDS,
  RSS_ROUTE_CACHE_MAX_BYTES,
  RSS_ROUTE_CACHE_MAX_ENTRIES,
  RSS_ROUTE_CACHE_PERSIST_MAX_BYTES,
  RSS_ROUTE_CACHE_TTL_MS,
} from "./lib/constants.js";
import { RepositoryAccessToken } from "./repository/access_token.js";
import { RepositoryActivity } from "./repository/activity.js";
import { RepositoryCall } from "./repository/call.js";
import { RepositoryCredit } from "./repository/credit.js";
import { RepositoryDevice } from "./repository/device.js";
import { RepositoryDeviceToken } from "./repository/device_token.js";
import { RepositoryMcpToken } from "./repository/mcp_token.js";
import { RepositoryMcpOauth } from "./repository/mcp_oauth.js";
import { ServiceMcpOauth } from "./service/durable_object/mcp_oauth.js";
import { ServiceMcpToken } from "./service/durable_object/mcp_tokens.js";
import { ServiceDeviceToken } from "./service/durable_object/device_tokens.js";
import { create_device_token_credentials } from "./infra/device_token_credentials.js";
import { reader_session_secret } from "./infra/reader_session_secret.js";
import { RepositoryDiscoverySource } from "./repository/discovery_source.js";
import { RepositoryStatistics } from "./repository/statistics.js";
import { ServiceStatistics } from "./service/durable_object/statistics.js";
import { RepositoryRedemption } from "./repository/redemption.js";
import { RepositoryRssCookieGrant } from "./repository/rss_cookie_grant.js";
import { RepositoryRssCookie } from "./repository/rss_cookie.js";
import { RepositoryScript } from "./repository/script.js";
import { RepositoryScriptRelease } from "./repository/script_release.js";
import { RepositoryPlatform } from "./repository/platform.js";
import { RepositoryTag } from "./repository/tag.js";
import { RepositoryScriptLog } from "./repository/script_log.js";
import { RepositoryRssRouteCache } from "./repository/rss_route_cache.js";
import { RepositoryUser } from "./repository/user.js";
import { RepositoryScriptAgent } from "./repository/script_agent.js";
import { ServiceScriptAgent } from "./service/durable_object/script_agent.js";
import { create_script_agent_credentials } from "./infra/script_agent_credentials.js";
import { API_SCHEMA_SQL, API_SCHEMA_VERSION, migrate_script_tables } from "./repository/schema.js";
import { ServiceAccessToken } from "./service/durable_object/access_tokens.js";
import { ServiceActivity } from "./service/durable_object/activity.js";
import { ServiceAuth } from "./service/durable_object/auth.js";
import { ServiceCredit } from "./service/durable_object/credits.js";
import { ServiceDevice } from "./service/durable_object/devices.js";
import { ServiceDiscovery } from "./service/durable_object/discovery.js";
import { ServiceMaintenance } from "./service/durable_object/maintenance.js";
import { ServiceRedemption } from "./service/durable_object/redemption.js";
import { ServiceScript } from "./service/durable_object/scripts.js";
import { ServiceTask } from "./service/durable_object/tasks.js";
import { RepositoryBackgroundTasks } from "./repository/background_tasks.js";
import { ServiceBackgroundTasks } from "./service/durable_object/background_tasks.js";
import { ServiceUser } from "./service/durable_object/users.js";
import { RepositorySnapshotSettings } from "./repository/snapshot_settings.js";
import { ServiceSnapshotSettings } from "./service/durable_object/snapshot_settings.js";
import { RepositoryCookiePushSettings } from "./repository/cookie_push_settings.js";
import { ServiceCookiePushSettings } from "./service/durable_object/cookie_push_settings.js";
import { RepositoryWebhookSettings } from "./repository/webhook_settings.js";
import { ServiceWebhookSettings } from "./service/durable_object/webhook_settings.js";
import { seed_default_data } from "./service/durable_object/default_data.js";
import apple_script from "../examples/scripts/rss/apple.js" with { type: "text" };
import clip_script_source from "../examples/scripts/region_clip.js" with { type: "text" };
import { RepositoryClip } from "./repository/clip.js";
import { ServiceClip } from "./service/durable_object/clips.js";
import { create_clip_loader } from "./infra/clip_snapshot.js";
import { create_puppeteer_navigate } from "./infra/script_puppeteer.js";

/**
 * @typedef {Object} Env
 * @property {DurableObjectNamespace<APIDurableObject>} API
 * @property {string} [DEVICE_TOKEN]
 * @property {string} ADMIN_PASSWORD
 * @property {string} [READER_SESSION_SECRET]
 * @property {string} [READER_SMTP_USER]
 * @property {string} [READER_SMTP_PASSWORD]
 * @property {string} [READER_SMTP_HOST]
 * @property {string} [COOKIE_PUSH_UUID]
 * @property {string} [COOKIE_PUSH_KEY]
 * @property {string} [FINDRSS_HOSTNAME]
 * @property {import("@cloudflare/puppeteer").BrowserWorker} [BROWSER]
 */

/** @typedef {"queued" | "assigned" | "running" | "completed" | "failed"} TaskStatus */

/**
 * @typedef {Object} CallRow
 * @property {string} id
 * @property {string} method
 * @property {string} publisher_device_id
 * @property {string | null} access_token_id
 * @property {number} credit_cost
 * @property {string | null} target_device_id
 * @property {string | null} idempotency_key
 * @property {string} args_json
 * @property {TaskStatus} status
 * @property {string | null} assigned_device_id
 * @property {string | null} lease_token
 * @property {number | null} lease_expires_at
 * @property {number} attempt_count
 * @property {string | null} result_json
 * @property {string | null} error_message
 * @property {number} created_at
 * @property {number} updated_at
 * @property {number | null} completed_at
 */

/**
 * 注意这里**没有** `avatar_url`：头像是独立的上传端点（multipart/二进制 PUT），
 * 不是 JSON 字段，所以不接受在 body 里传。
 * @typedef {Object} DiscoverySourceBody
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [website]
 * @property {string} [feed_url]
 * @property {string} [category]
 * @property {string[] | string} [tags]
 * @property {boolean} [enabled]
 * @property {boolean} [require_token]
 * @property {number} [credit_cost]
 * @property {number} [sort_order]
 * @property {string} [source_type]
 */

export class APIDurableObject extends DurableObject {
  /**
   * @param {DurableObjectState} ctx
   * @param {Env} env
   */
  constructor(ctx, env) {
    super(ctx, env);
    // 环境变量只在这里读一次，作为普通值注入服务；壳本身不再留存。
    const device_token = env.DEVICE_TOKEN || reader_session_secret(env);
    const cookie_push_uuid = String(env.COOKIE_PUSH_UUID || "").trim();
    const cookie_push_key = String(env.COOKIE_PUSH_KEY || "").trim();
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS api_schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)");
    const schema_version = Number(this.ctx.storage.sql.exec("SELECT version FROM api_schema_version WHERE id = 1").toArray()[0]?.version || 0);
    if (schema_version < API_SCHEMA_VERSION) {
      this.ctx.storage.transactionSync(() => migrate_script_tables(this.ctx.storage.sql));
      this.ctx.storage.sql.exec(API_SCHEMA_SQL);
      const background_task_columns = this.ctx.storage.sql.exec("PRAGMA table_info(background_tasks)").toArray();
      if (!background_task_columns.some(column => column.name === "source_id")) {
        this.ctx.storage.sql.exec("ALTER TABLE background_tasks ADD COLUMN source_id TEXT NOT NULL DEFAULT ''");
      }
      const agent_columns = this.ctx.storage.sql.exec("PRAGMA table_info(script_agent_settings)").toArray();
      if (!agent_columns.some(column => column.name === "config_json")) this.ctx.storage.sql.exec("ALTER TABLE script_agent_settings ADD COLUMN config_json TEXT NOT NULL DEFAULT ''");
      if (!agent_columns.some(column => column.name === "encrypted_keys_json")) this.ctx.storage.sql.exec("ALTER TABLE script_agent_settings ADD COLUMN encrypted_keys_json TEXT NOT NULL DEFAULT '{}'");
      const credential_columns = this.ctx.storage.sql
        .exec("PRAGMA table_info(user_credentials)")
        .toArray();
      if (!credential_columns.some((column) => column.name === "email_verified_at")) {
        this.ctx.storage.sql.exec(
          "ALTER TABLE user_credentials ADD COLUMN email_verified_at INTEGER");
        // Accounts that predate self-registration were issued by an administrator.
        this.ctx.storage.sql.exec(
          "UPDATE user_credentials SET email_verified_at = created_at WHERE email_verified_at IS NULL");
      }
      const device_columns = this.ctx.storage.sql.exec("PRAGMA table_info(devices)").toArray();
      if (!device_columns.some((column) => column.name === "disabled")) {
        this.ctx.storage.sql.exec(
          "ALTER TABLE devices ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0");
      }
      if (!device_columns.some((column) => column.name === "max_concurrency")) {
        this.ctx.storage.sql.exec(
          "ALTER TABLE devices ADD COLUMN max_concurrency INTEGER NOT NULL DEFAULT 1");
      }
      const call_columns = this.ctx.storage.sql.exec("PRAGMA table_info(calls)").toArray();
      if (!call_columns.some((column) => column.name === "access_token_id")) {
        this.ctx.storage.sql.exec("ALTER TABLE calls ADD COLUMN access_token_id TEXT");
      }
      if (!call_columns.some((column) => column.name === "credit_cost")) {
        this.ctx.storage.sql.exec(
          "ALTER TABLE calls ADD COLUMN credit_cost INTEGER NOT NULL DEFAULT 0");
      }
      if (!call_columns.some((column) => column.name === "coalesce_key")) {
        this.ctx.storage.sql.exec("ALTER TABLE calls ADD COLUMN coalesce_key TEXT");
      }
      const access_token_columns = this.ctx.storage.sql
        .exec("PRAGMA table_info(access_tokens)")
        .toArray();
      if (!access_token_columns.some((column) => column.name === "user_id")) {
        this.ctx.storage.sql.exec("ALTER TABLE access_tokens ADD COLUMN user_id TEXT");
      }
      if (!access_token_columns.some((column) => column.name === "revoked_at")) {
        this.ctx.storage.sql.exec("ALTER TABLE access_tokens ADD COLUMN revoked_at INTEGER");
      }
      if (!access_token_columns.some((column) => column.name === "credit_balance")) {
        this.ctx.storage.sql.exec(
          "ALTER TABLE access_tokens ADD COLUMN credit_balance INTEGER NOT NULL DEFAULT 0");
      }
      if (!access_token_columns.some((column) => column.name === "total_credits_granted")) {
        this.ctx.storage.sql.exec(
          "ALTER TABLE access_tokens ADD COLUMN total_credits_granted INTEGER NOT NULL DEFAULT 0");
      }
      if (!access_token_columns.some((column) => column.name === "total_credits_used")) {
        this.ctx.storage.sql.exec(
          "ALTER TABLE access_tokens ADD COLUMN total_credits_used INTEGER NOT NULL DEFAULT 0");
      }
      this.ctx.storage.sql.exec(`
        INSERT OR IGNORE INTO users (id, name, created_at, updated_at)
          SELECT id, CASE WHEN name = '' THEN 'Reader' ELSE name END, created_at, created_at
          FROM access_tokens;
        UPDATE access_tokens SET user_id = id WHERE user_id IS NULL OR user_id = '';
        CREATE INDEX IF NOT EXISTS access_tokens_user
          ON access_tokens(user_id, created_at DESC);
      `);
      // calls_access_token 依赖 calls.access_token_id（上面 ALTER 补的列）：老库上
      // CREATE TABLE 是 no-op，这个索引必须排在 ALTER 之后，所以不能进 API_SCHEMA_SQL。
      this.ctx.storage.sql.exec(
        "CREATE INDEX IF NOT EXISTS calls_access_token ON calls(access_token_id, created_at)");
      // 同上：calls_coalesce 依赖 calls.coalesce_key（上面 ALTER 补的列），必须排在 ALTER 之后。
      // 部分索引——绝大多数行的 coalesce_key 是 NULL，不该进索引。
      this.ctx.storage.sql.exec(
        "CREATE INDEX IF NOT EXISTS calls_coalesce ON calls(coalesce_key) WHERE coalesce_key IS NOT NULL");
      // 账本的「行为」标签。历史行留空串，读取端按 method/note 兜底，四个写入点无需改动。
      const credit_transaction_columns = this.ctx.storage.sql
        .exec("PRAGMA table_info(credit_transactions)")
        .toArray();
      if (!credit_transaction_columns.some((column) => column.name === "subject")) {
        this.ctx.storage.sql.exec(
          "ALTER TABLE credit_transactions ADD COLUMN subject TEXT NOT NULL DEFAULT ''");
      }
      // 每卡可选积分（NULL 继承活动默认）。
      const redemption_card_columns = this.ctx.storage.sql
        .exec("PRAGMA table_info(redemption_cards)")
        .toArray();
      if (!redemption_card_columns.some((column) => column.name === "credits")) {
        this.ctx.storage.sql.exec(
          "ALTER TABLE redemption_cards ADD COLUMN credits INTEGER");
      }
      const discovery_source_columns = this.ctx.storage.sql
        .exec("PRAGMA table_info(discovery_sources)")
        .toArray();
      if (!discovery_source_columns.some(column => column.name === "social_url")) {
        this.ctx.storage.sql.exec("ALTER TABLE discovery_sources ADD COLUMN social_url TEXT NOT NULL DEFAULT ''");
      }
      if (!discovery_source_columns.some(column => column.name === "social_urls_json")) {
        this.ctx.storage.sql.exec("ALTER TABLE discovery_sources ADD COLUMN social_urls_json TEXT NOT NULL DEFAULT '[]'");
      }
      if (!discovery_source_columns.some((column) => column.name === "require_token")) {
        this.ctx.storage.sql.exec(
          "ALTER TABLE discovery_sources ADD COLUMN require_token INTEGER NOT NULL DEFAULT 0");
      }
      if (!discovery_source_columns.some((column) => column.name === "credit_cost")) {
        this.ctx.storage.sql.exec("ALTER TABLE discovery_sources ADD COLUMN credit_cost INTEGER NOT NULL DEFAULT 1");
      }
      if (!discovery_source_columns.some((column) => column.name === "source_type")) {
        this.ctx.storage.sql.exec(
          "ALTER TABLE discovery_sources ADD COLUMN source_type TEXT NOT NULL DEFAULT 'website'");
      }
      if (!discovery_source_columns.some((column) => column.name === "avatar_updated_at")) {
        this.ctx.storage.sql.exec(
          "ALTER TABLE discovery_sources ADD COLUMN avatar_updated_at INTEGER NOT NULL DEFAULT 0");
      }
      const avatar_columns = this.ctx.storage.sql.exec("PRAGMA table_info(discovery_source_avatars)").toArray();
      for (const [name, definition] of [["poll_policy_json", "TEXT NOT NULL DEFAULT '{\"mode\":\"inherit\"}'"], ["poll_updated_at", "INTEGER NOT NULL DEFAULT 0"]]) {
        if (!discovery_source_columns.some(column => column.name === name)) this.ctx.storage.sql.exec(`ALTER TABLE discovery_sources ADD COLUMN ${name} ${definition}`);
      }
      const snapshot_columns = this.ctx.storage.sql.exec("PRAGMA table_info(discovery_source_snapshots)").toArray();
      const snapshot_settings_columns = this.ctx.storage.sql.exec("PRAGMA table_info(snapshot_settings)").toArray();
      if (!snapshot_settings_columns.some(column => column.name === "max_concurrency")) this.ctx.storage.sql.exec("ALTER TABLE snapshot_settings ADD COLUMN max_concurrency INTEGER NOT NULL DEFAULT 4");
      if (!snapshot_columns.some(column => column.name === "adaptive_interval")) this.ctx.storage.sql.exec("ALTER TABLE discovery_source_snapshots ADD COLUMN adaptive_interval INTEGER NOT NULL DEFAULT 0");
      if (!snapshot_columns.some(column => column.name === "poll_fingerprint")) this.ctx.storage.sql.exec("ALTER TABLE discovery_source_snapshots ADD COLUMN poll_fingerprint TEXT NOT NULL DEFAULT ''");
      if (!avatar_columns.some((column) => column.name === "object_key")) {
        this.ctx.storage.sql.exec("ALTER TABLE discovery_source_avatars ADD COLUMN object_key TEXT NOT NULL DEFAULT ''");
      }
      const script_columns = this.ctx.storage.sql
        .exec("PRAGMA table_info(scripts)")
        .toArray();
      if (!script_columns.some((column) => column.name === "path")) {
        this.ctx.storage.sql.exec("ALTER TABLE scripts ADD COLUMN path TEXT NOT NULL DEFAULT ''");
      }
      if (!script_columns.some((column) => column.name === "metadata_json")) {
        this.ctx.storage.sql.exec(
          "ALTER TABLE scripts ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'");
      }
      const legacy_scripts = this.ctx.storage.sql
        .exec(
          `SELECT route, title, script, metadata_json FROM scripts
           WHERE path = '' ORDER BY created_at LIMIT 500`)
        .toArray();
      for (const legacy_script of legacy_scripts) {
        if (ScriptModel.fromRow(legacy_script).status === "draft") continue;
        const path = "/" + String(legacy_script.route).replace(/^\/+/, "");
        const metadata = {
          path,
          name: String(legacy_script.title || legacy_script.route),
          url: "",
          maintainers: [],
          example: path,
          parameters: {},
          description: "由旧版函数脚本自动迁移。",
        };
        const legacy_handler = String(legacy_script.script).trim();
        const module_script = `const handler = ${legacy_handler}

  export const route = {
    path: ${JSON.stringify(metadata.path)},
    name: ${JSON.stringify(metadata.name)},
    url: "",
    maintainers: [],
    handler,
    example: ${JSON.stringify(metadata.example)},
    parameters: {},
    description: ${JSON.stringify(metadata.description)},
  };
  `;
        this.ctx.storage.sql.exec(
          `UPDATE scripts
           SET path = ?, metadata_json = ?, script = ?, updated_at = ?
           WHERE route = ?`,
          path,
          JSON.stringify(metadata),
          module_script,
          Date.now(),
          legacy_script.route);
      }
      this.ctx.storage.sql.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS scripts_path ON scripts(path) WHERE path <> ''");
      // 每项历史迁移只属于首次升级；以后递增 schema 版本时不能重放旧任务。
      if (schema_version < 1) {
        const legacy_tables = new Set(
          this.ctx.storage.sql
            .exec("SELECT name FROM sqlite_master WHERE type = 'table'")
            .toArray()
            .map((row) => row.name));
        if (legacy_tables.has("tasks")) {
          this.ctx.storage.sql.exec(`
            INSERT OR IGNORE INTO calls (
              id, method, publisher_device_id, target_device_id, idempotency_key,
              args_json, status, assigned_device_id, lease_token, lease_expires_at,
              attempt_count, result_json, error_message, created_at, updated_at, completed_at
            )
            SELECT id, kind, publisher_id, target_client_id, idempotency_key,
              payload_json, status, assigned_client_id, lease_token, lease_expires_at,
              attempt_count, result_json, error_message, created_at, updated_at, completed_at
            FROM tasks
          `);
        }
        if (legacy_tables.has("client_registry")) {
          const registry_columns = this.ctx.storage.sql
            .exec("PRAGMA table_info(client_registry)")
            .toArray();
          if (!registry_columns.some((column) => column.name === "device_name")) {
            this.ctx.storage.sql.exec(
              "ALTER TABLE client_registry ADD COLUMN device_name TEXT NOT NULL DEFAULT ''");
          }
          if (!registry_columns.some((column) => column.name === "device_os")) {
            this.ctx.storage.sql.exec(
              "ALTER TABLE client_registry ADD COLUMN device_os TEXT NOT NULL DEFAULT ''");
          }
          this.ctx.storage.sql.exec(`
            INSERT OR IGNORE INTO devices (
              device_id, connection_id, methods_json, device_name, device_os,
              connected_at, last_seen_at, disconnected_at, status
            )
            SELECT client_id, connection_id, capabilities_json, device_name, device_os,
              connected_at, last_seen_at, disconnected_at, status
            FROM client_registry
          `);
        }
        this.ctx.storage.sql.exec("DELETE FROM rss_route_cache_chunks WHERE key NOT IN (SELECT key FROM rss_route_cache)");
        // 历史数据只回填一次；后续增删和批量状态变更由 SQLite 触发器维护。
        this.ctx.storage.sql.exec("DELETE FROM call_status_counts");
        this.ctx.storage.sql.exec("INSERT INTO call_status_counts(status, count) SELECT status, COUNT(*) FROM calls GROUP BY status");
      }
      this.ctx.storage.transactionSync(() => {
        if (schema_version < 1) {
          const scripts = new RepositoryScript({ sql: this.ctx.storage.sql }).list();
          new RepositoryPlatform({ sql: this.ctx.storage.sql }).import_published(scripts);
          new RepositoryTag({ sql: this.ctx.storage.sql }).import_published(scripts);
        }
        this.ctx.storage.sql.exec("INSERT OR REPLACE INTO api_schema_version(id, version) VALUES (1, ?)", API_SCHEMA_VERSION);
      });
    }
    /** 纯 SQL 存储层：每个聚合一个 RepositoryX，只回原始行/Set/数字。 */
    this.repo = {
      background_tasks: new RepositoryBackgroundTasks({ sql: this.ctx.storage.sql }),
      snapshot_settings: new RepositorySnapshotSettings({ sql: this.ctx.storage.sql }),
      cookie_push_settings: new RepositoryCookiePushSettings({ sql: this.ctx.storage.sql }),
      webhook_settings: new RepositoryWebhookSettings({ sql: this.ctx.storage.sql }),
      access_tokens: new RepositoryAccessToken({ sql: this.ctx.storage.sql }),
      activity: new RepositoryActivity({ sql: this.ctx.storage.sql }),
      calls: new RepositoryCall({ sql: this.ctx.storage.sql }),
      credit: new RepositoryCredit({ sql: this.ctx.storage.sql }),
      devices: new RepositoryDevice({ sql: this.ctx.storage.sql }),
      device_tokens: new RepositoryDeviceToken({ sql: this.ctx.storage.sql }),
      mcp_tokens: new RepositoryMcpToken({ sql: this.ctx.storage.sql }),
      mcp_oauth: new RepositoryMcpOauth({ sql: this.ctx.storage.sql, transaction: action => this.ctx.storage.transactionSync(action) }),
      discovery: new RepositoryDiscoverySource({ sql: this.ctx.storage.sql }),
      clips: new RepositoryClip({ sql: this.ctx.storage.sql }),
      statistics: new RepositoryStatistics({ sql: this.ctx.storage.sql }),
      redemption: new RepositoryRedemption({ sql: this.ctx.storage.sql }),
      rss_cookie_grants: new RepositoryRssCookieGrant({ sql: this.ctx.storage.sql }),
      rss_cookies: new RepositoryRssCookie({ sql: this.ctx.storage.sql }),
      scripts: new RepositoryScript({ sql: this.ctx.storage.sql }),
      script_releases: new RepositoryScriptRelease({ sql: this.ctx.storage.sql }),
      platforms: new RepositoryPlatform({ sql: this.ctx.storage.sql }),
      tags: new RepositoryTag({ sql: this.ctx.storage.sql }),
      script_logs: new RepositoryScriptLog({ sql: this.ctx.storage.sql }),
      rss_route_cache: new RepositoryRssRouteCache({ sql: this.ctx.storage.sql, storage: this.ctx.storage }),
      users: new RepositoryUser({ sql: this.ctx.storage.sql }),
      script_agent: new RepositoryScriptAgent({ sql: this.ctx.storage.sql }),
    };
    /**
     * 出站端口：socket 接入点、alarm 调度与 RSS route 缓存。
     * 必须建在 `this.repo` 之后：route 缓存的 L2 是注入的 store（layering 规则不许
     * `infra/` import `repository/`，所以持久化只能由组合根注进去），而
     * `RepositoryRssRouteCache` 的方法名**就是** store 接口，直接注入即可。
     */
    const ports = {
      puppeteer_navigate: env.BROWSER ? create_puppeteer_navigate(env.BROWSER) : null,
      object_store: create_api_object_store(env),
      transaction: callback => this.ctx.storage.transactionSync(callback),
      sockets: new DeviceSocketHub(ctx),
      schedule_alarm: () => this.schedule_alarm(),
      wait_until: promise => this.ctx.waitUntil(promise),
      route_cache: new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, RSS_ROUTE_CACHE_MAX_ENTRIES, {
        store: this.repo.rss_route_cache,
        object_store: create_api_object_store(env),
        max_bytes: RSS_ROUTE_CACHE_MAX_BYTES,
        persist_max_bytes: RSS_ROUTE_CACHE_PERSIST_MAX_BYTES,
      }),
    };
    /** 应用服务注册表：兄弟服务经 `this.app.<svc>.<method>` 互相调用。 */
    this.app = {};
    this.app.events = new AdminSocketHub(ctx);
    observe_admin_changes(this.repo, this.app.events);
    this.app.mcp_tokens = new ServiceMcpToken({ repo: this.repo.mcp_tokens, app: this.app });
    this.app.mcp_oauth = new ServiceMcpOauth({ repo: this.repo.mcp_oauth, tokens: this.repo.mcp_tokens });
    this.app.background_tasks = new ServiceBackgroundTasks({ repo: this.repo.background_tasks, wait_until: ports.wait_until,
      notify: task => {
        this.app.events.invalidate("background-tasks.changed", task?.source_id || task?.id || null);
        if (task?.kind === "clip") this.app.events.invalidate("clips.changed");
        else if (task?.source_id) this.app.events.invalidate("discovery.changed", task.source_id);
      } });
    this.app.webhook_settings = new ServiceWebhookSettings({ repo: this.repo.webhook_settings,
      credentials: create_script_agent_credentials(env.ADMIN_PASSWORD || "") });
    this.app.snapshot_settings = new ServiceSnapshotSettings({ repo: this.repo.snapshot_settings, schedule_alarm: ports.schedule_alarm });
    this.app.clips = new ServiceClip({ repo: this.repo.clips, storage: this.ctx.storage,
      object_store: ports.object_store, load_snapshot: create_clip_loader(ports.puppeteer_navigate, clip_script_source),
      background_tasks: this.app.background_tasks, snapshot_settings: () => this.app.snapshot_settings.settings(),
      schedule_alarm: ports.schedule_alarm });
    this.app.cookie_push_settings = new ServiceCookiePushSettings({ repo: this.repo.cookie_push_settings,
      credentials: create_script_agent_credentials(env.ADMIN_PASSWORD || "") });
    this.app.statistics = new ServiceStatistics({ repo: this.repo, app: this.app });
    this.app.maintenance = new ServiceMaintenance({ repo: this.repo });
    this.app.activity = new ServiceActivity({ repo: this.repo, app: this.app });
    this.app.credit = new ServiceCredit({ repo: this.repo, storage: this.ctx.storage });
    this.app.redemption = new ServiceRedemption({
      repo: this.repo,
      storage: this.ctx.storage,
      app: this.app,
    });
    this.app.tasks = new ServiceTask({
      repo: this.repo,
      ports,
      storage: this.ctx.storage,
      app: this.app,
    });
    this.app.devices = new ServiceDevice({ repo: this.repo, ports, app: this.app });
    this.app.device_tokens = new ServiceDeviceToken({ repo: this.repo.device_tokens,
      credentials: create_device_token_credentials(env.ADMIN_PASSWORD || ""), app: this.app,
      schedule_alarm: ports.schedule_alarm });
    this.ctx.blockConcurrencyWhile(async () => {
      await this.app.device_tokens.import_legacy(env.DEVICE_TOKEN);
      await this.app.cookie_push_settings.import_legacy(cookie_push_uuid, cookie_push_key);
      await seed_default_data({ repo: this.repo, storage: this.ctx.storage, script: apple_script });
      try {
        if (!await this.ctx.storage.get("script_storage_migrated_v1")) {
          await this.app.scripts.migrate_script_storage();
          if (this.app.scripts.source_store.available && !this.app.scripts.migration_pending)
            await this.ctx.storage.put("script_storage_migrated_v1", true);
        }
      }
      catch (error) { this.app.scripts.migration_pending = true; console.warn("Script storage migration failed", error.message); }
    });
    this.app.auth = new ServiceAuth({
      repo: this.repo,
      storage: this.ctx.storage,
      app: this.app,
      device_token,
    });
    this.app.access_tokens = new ServiceAccessToken({
      repo: this.repo,
      storage: this.ctx.storage,
    });
    this.app.users = new ServiceUser({ repo: this.repo, storage: this.ctx.storage });
    this.app.discovery = new ServiceDiscovery({
      background_tasks: this.app.background_tasks,
      wait_until: ports.wait_until,
      snapshot_settings: () => this.app.snapshot_settings.settings(),
      check_cookie_permissions: script_id => this.app.scripts.check_cookie_permissions(script_id),
      public_origin: feed_hostname_origin(env),
      statistics: this.app.statistics,
      repo: this.repo, route_cache: ports.route_cache, storage: this.ctx.storage,
      object_store: create_api_object_store(env),
      schedule_alarm: ports.schedule_alarm,
      render_catalog: catalog => render_embedded_home(catalog, DISCOVERY_CATALOG_ORIGIN),
      load_snapshot: (source, origin, signal) => load_discovery_snapshot(source, origin,
        (...args) => this.app.scripts.serve_rss_route(...args), signal),
    });
    this.app.scripts = new ServiceScript({
      repo: this.repo,
      ports,
      app: this.app,
      public_origin: feed_hostname_origin(env),
    });
    this.app.script_agent = new ServiceScriptAgent({
      repo: this.repo.script_agent,
      credentials: create_script_agent_credentials(env.ADMIN_PASSWORD || ""),
      admin_ports: {
        source_types: () => this.app.discovery.platforms().map(platform => platform.id),
        context: async page => {
          if (page === "overview") return this.app.statistics.snapshot();
          if (page === "devices") return this.app.devices.summary();
          if (page === "discovery") return { source_count: this.repo.discovery.count(), source_types: Object.fromEntries(this.app.discovery.platforms().map(platform => [platform.id, platform.label])), tags: this.app.discovery.tags(),
            script_routes: (await this.app.scripts.list_scripts()).scripts.filter(script => script.status === "published").flatMap(script => (script.routes || [script]).map(route => ({ path: route.path, platform: route.platform, tags: route.tags, enabled: script.enabled }))) };
          if (page === "scripts") return { scripts: (await this.app.scripts.list_scripts()).scripts.map(({ id, name, path, platform, tags, enabled, routes }) => ({ id, name, path, platform, tags, enabled, routes })) };
          if (page === "users") return this.app.users.list_admin_users(new URL("https://internal/?limit=20"));
          if (page === "redemptions") return this.app.redemption.list_redemption_campaigns(new URL("https://internal/?limit=20"));
          if (page === "cookies") { const cookies = this.repo.rss_cookies.get(); return { cookie_count: cookies.length, domains: [...new Set(cookies.map(cookie => cookie.domain))] }; }
          return {};
        },
        get_source: id => { const row = this.repo.discovery.find(id); return row ? DiscoverySourceModel.fromRow(row).toValue() : null; },
        list_sources: ({ query, source_type, enabled, offset, limit }) => {
          const sources = this.repo.discovery.list({ include_disabled: true, query, source_type }).map(row => DiscoverySourceModel.fromRow(row).toValue())
            .filter(source => enabled === undefined || source.enabled === enabled);
          return { sources: sources.slice(offset, offset + limit), total_count: sources.length, offset, limit, has_more: offset + limit < sources.length };
        },
        create_source: async body => (await this.app.discovery.create_discovery_source(new Request("https://internal/_admin/discovery/sources", { method: "POST", body: JSON.stringify(body) }))).data,
        update_source: (id, body, expected) => this.app.discovery.update_discovery_source(new Request("https://internal/_admin/discovery/sources/" + id, { method: "PATCH", body: JSON.stringify(body) }), id, expected),
        delete_source: (id, expected) => this.app.discovery.delete_discovery_source(id, expected),
      },
      secret_lookup: name => /^READER_AI_[A-Z0-9_]{1,64}$/.test(name) ? env[name] : "",
      debug_draft: body => this.app.scripts.debug_script(new Request("https://internal/_admin/scripts/debug", {
        method: "POST", body: JSON.stringify(body),
      })),
    });
    this.app.script_agent.wait_until = promise => this.ctx.waitUntil(promise);
    this.discovery_alarm_started = false;
    this.discovery_alarm_checked_at = 0;
  }

  /**
   * DO 的 fetch 只做分派，路由表见 durable_object_router.js。
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  async fetch(request) {
    // 只记忆目录入口由 Worker 覆写的访问地址，不采用其他接口透传的请求头。
    if (/^\/_(admin|public)\/discovery\//.test(new URL(request.url).pathname)) {
      await this.app.discovery.remember_public_origin(request.headers.get("X-Feed-Public-URL"));
    }
    if (!this.discovery_alarm_started || Date.now() - this.discovery_alarm_checked_at >= 60000) {
      const initialize = !this.discovery_alarm_started;
      this.discovery_alarm_started = true;
      this.discovery_alarm_checked_at = Date.now();
      // 定期检查并恢复丢失的 alarm；初始化失败时允许下次请求重试。
      this.ctx.waitUntil(this.schedule_alarm().catch(error => {
        this.discovery_alarm_started = false;
        console.warn("discovery alarm initialization failed", error.message);
      }));
      // alarm 丢失或未唤醒时，普通请求也按原规则补抓到期源；入口内部负责并发去重。
      for (const [name, run] of [
        ["discovery snapshot", () => this.app.discovery.refresh_due_snapshots()],
        ["RSS snapshot", () => this.app.scripts.refresh_due_snapshots()],
        ["clip snapshot", () => new URL(request.url).pathname.startsWith("/_public/clips/")
          ? undefined : this.app.clips.refresh_due_snapshots()],
      ]) {
        this.ctx.waitUntil(Promise.resolve().then(run).catch(error => console.warn(name + " recovery failed", error.message)));
      }
      if (initialize) this.ctx.waitUntil(this.app.discovery.ensure_catalog().catch(error => console.warn("discovery catalog initialization failed", error)));
    }
    return route(request, this.app);
  }

  /**
   * @param {WebSocket} socket
   * @param {ArrayBuffer | string} message
   * @returns {Promise<void>}
   */
  async webSocketMessage(socket, message) {
    if (this.app.events?.owns(socket)) return this.app.events.receive(socket, message, this.app);
    return this.app.devices.webSocketMessage(socket, message);
  }

  /**
   * @param {WebSocket} socket
   * @param {number} code
   * @param {string} reason
   * @param {boolean} was_clean
   * @returns {Promise<void>}
   */
  async webSocketClose(socket, code, reason, was_clean) {
    if (this.app.events?.owns(socket)) { this.app.events.close(socket); socket.close(1000, "closed"); return; }
    return this.app.devices.webSocketClose(socket, code, reason, was_clean);
  }

  /**
   * @param {WebSocket} socket
   * @returns {Promise<void>}
   */
  async webSocketError(socket) {
    if (this.app.events?.owns(socket)) { this.app.events.close(socket); socket.close(1011, "websocket error"); return; }
    return this.app.devices.webSocketError(socket);
  }

  /** @returns {Promise<void>} */
  async alarm() {
    try {
      await this.maintain_alarm();
    } finally {
      // 维护或统计失败不能跳过抓取，更不能中断后续的定时唤醒。
      for (const [name, run] of [
        ["discovery snapshot", () => this.app.discovery.refresh_due_snapshots()],
        ["RSS snapshot", () => this.app.scripts.refresh_due_snapshots()],
        ["clip snapshot", () => this.app.clips.refresh_due_snapshots()],
        ["discovery catalog", () => this.app.discovery.ensure_catalog()],
      ]) {
        try { this.ctx.waitUntil(Promise.resolve(run()).catch(error => console.warn(name + " alarm failed", error.message))); }
        catch (error) { console.warn(name + " alarm failed", error.message); }
      }
      await this.schedule_alarm();
    }
  }

  /** @returns {Promise<void>} */
  async maintain_alarm() {
    const now = Date.now();
    if (this.app.scripts.migration_pending) {
      try {
        await this.app.scripts.migrate_script_storage();
        if (this.app.scripts.source_store.available && !this.app.scripts.migration_pending)
          await this.ctx.storage.put("script_storage_migrated_v1", true);
      }
      catch (error) { this.app.scripts.migration_pending = true; console.warn("Script storage migration retry failed", error.message); }
    }
    this.ctx.waitUntil(this.app.scripts.prune_script_objects().catch(error => console.warn("Script object cleanup failed", error.message)));
    this.app.devices.close_unauthorized_connections();
    /** @type {CallRow[]} */
    const expired = this.repo.calls.list_expired_leases(now);
    const exhausted = expired.filter((row) => CallModel.fromRow(row).attempts_exhausted());

    this.repo.calls.sweep_expired(now, CallModel.MAX_ATTEMPTS);
    this.app.maintenance.prune_retention(now);
    this.app.maintenance.prune_events(now);

    for (const row of expired) {
      if (!row.assigned_device_id) continue;
      const task_failed = CallModel.fromRow(row).attempts_exhausted();
      this.app.devices.record_device_log(
        row.assigned_device_id,
        task_failed ? "response" : "call",
        task_failed ? "response.lease_exhausted" : "call.lease_expired",
        task_failed
          ? "调用租约反复过期，任务已失败"
          : "调用租约已过期，任务重新排队",
        {
          direction: "internal",
          level: task_failed ? "error" : "warn",
          task_id: row.id,
          method: row.method,
          metadata: {
            attempt_count: row.attempt_count,
            max_attempts: CallModel.MAX_ATTEMPTS,
            lease_expires_at: row.lease_expires_at,
          },
          created_at: now,
        });
    }

    for (const row of exhausted) {
      const failed_row = this.repo.calls.find(row.id) ?? null;
      if (failed_row !== null) {
        this.app.tasks.resolve_invoke_waiter(failed_row.id, failed_row);
        this.app.tasks.send_to_device(failed_row.publisher_device_id, {
          type: "task.failed",
          task: CallModel.fromRow(failed_row).toValue(),
        });
      }
    }
    await this.app.tasks.dispatch_pending();
    this.app.statistics.refresh_snapshot(now);
  }

  /** @returns {Promise<void>} */
  async schedule_alarm() {
    /** @type {number | null | undefined} */
    const next_lease = this.repo.calls.min_lease_expires_at();
    const next_snapshot = this.app.discovery.next_snapshot_at();
    const next_feed = this.app.scripts?.next_snapshot_at();
    const next_clip = this.app.clips?.next_snapshot_at();
    const now = Date.now();
    const next_statistics = Math.max(now, this.app.statistics.next_snapshot_at());
    const next_token_expiry = this.repo.device_tokens.min_expires_at(now);
    const desired = Math.min(next_lease ?? Infinity, next_snapshot ?? Infinity, next_feed ?? Infinity, next_clip ?? Infinity, next_statistics, next_token_expiry ?? Infinity,
      this.app.scripts?.migration_pending ? now + 10000 : Infinity, now + MAINTENANCE_MILLISECONDS);
    const current = await this.ctx.storage.getAlarm();
    // 保留仍有效的更早唤醒；滞留超过一分钟的过期 alarm 重新登记以恢复调度。
    if (current === null || current < now - 60000 || desired < current - 1000) {
      await this.ctx.storage.setAlarm(desired);
    }
  }
}
