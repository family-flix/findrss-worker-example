import { DiscoverySourceModel } from "./domain/discovery_source.js";
import { render_embedded_home } from "./infra/discovery_home.js";
import { DISCOVERY_CATALOG_ORIGIN } from "./lib/discovery_catalog.js";
import { feed_hostname_origin } from "./service/worker/discovery.js";
// Worker 组合根：D1 业务存储、KV 查询缓存、R2 文件和 Queue 后台任务。
import { route } from "../application_router.js";
import { RssRouteCache } from "./infra/rss_cache.js";
import { create_api_object_store } from "./infra/object_store.js";
import { load_discovery_snapshot } from './infra/discovery_snapshot.js';
import { RSS_ROUTE_CACHE_MAX_BYTES, RSS_ROUTE_CACHE_MAX_ENTRIES, RSS_ROUTE_CACHE_PERSIST_MAX_BYTES, RSS_ROUTE_CACHE_TTL_MS } from "./lib/constants.js";
import { RepositoryAccessToken } from "./repository/access_token.js";
import { RepositoryActivity } from "./repository/activity.js";
import { RepositoryCall } from "./repository/call.js";
import { RepositoryCredit } from "./repository/credit.js";
import { RepositoryDevice } from "./repository/device.js";
import { RepositoryDeviceToken } from "./repository/device_token.js";
import { RepositoryMcpToken } from "./repository/mcp_token.js";
import { RepositoryMcpOauth } from "./repository/mcp_oauth.js";
import { ServiceMcpOauth } from "./service/application/mcp_oauth.js";
import { ServiceMcpToken } from "./service/application/mcp_tokens.js";
import { ServiceDeviceToken } from "./service/application/device_tokens.js";
import { create_device_token_credentials } from "./infra/device_token_credentials.js";
import { reader_session_secret } from "./infra/reader_session_secret.js";
import { RepositoryDiscoverySource } from "./repository/discovery_source.js";
import { RepositoryRedemption } from "./repository/redemption.js";
import { RepositoryRssCookieGrant } from "./repository/rss_cookie_grant.js";
import { RepositoryRssCookie } from "./repository/rss_cookie.js";
import { RepositoryScript } from "./repository/script.js";
import { RepositoryScriptRelease } from "./repository/script_release.js";
import { RepositoryPlatform } from "./repository/platform.js";
import { RepositoryTag } from "./repository/tag.js";
import { RepositoryWorkersLogs } from "./repository/workers_logs.js";
import { WorkersLogs } from "./infra/workers_logs.js";
import { RepositoryRssRouteCache } from "./repository/rss_route_cache.js";
import { RepositoryUser } from "./repository/user.js";
import { RepositoryScriptAgent } from "./repository/script_agent.js";
import { ServiceScriptAgent } from "./service/application/script_agent.js";
import { create_script_agent_credentials } from "./infra/script_agent_credentials.js";
import { ServiceAccessToken } from "./service/application/access_tokens.js";
import { ServiceActivity } from "./service/application/activity.js";
import { ServiceAuth } from "./service/application/auth.js";
import { ServiceCredit } from "./service/application/credits.js";
import { ServiceDevice } from "./service/application/devices.js";
import { ServiceDiscovery } from "./service/application/discovery.js";
import { ServiceMaintenance } from "./service/application/maintenance.js";
import { ServiceRedemption } from "./service/application/redemption.js";
import { ServiceScript } from "./service/application/scripts.js";
import { ServiceTask } from "./service/application/tasks.js";
import { RepositoryBackgroundTasks } from "./repository/background_tasks.js";
import { ServiceBackgroundTasks } from "./service/application/background_tasks.js";
import { ServiceHotSnapshots } from "./service/application/hot_snapshots.js";
import { create_rank_snapshot_builder } from "../rank.js";
import { publish_rank_home } from "../rank/home.js";
import { ServiceUser } from "./service/application/users.js";
import { RepositorySnapshotSettings } from "./repository/snapshot_settings.js";
import { ServiceSnapshotSettings } from "./service/application/snapshot_settings.js";
import { RepositoryCookiePushSettings } from "./repository/cookie_push_settings.js";
import { ServiceCookiePushSettings } from "./service/application/cookie_push_settings.js";
import { RepositoryWebhookSettings } from "./repository/webhook_settings.js";
import { ServiceWebhookSettings } from "./service/application/webhook_settings.js";
import { RepositoryClip } from "./repository/clip.js";
import { ServiceDetection } from "./service/application/detections.js";
import { RepositoryDetection } from "./repository/detection.js";
import { ServiceClip } from "./service/application/clips.js";
import { create_puppeteer_navigate } from "./infra/script_puppeteer.js";
import { D1Store } from "./infra/d1.js";
import { WorkerSocketHub, WorkerAdminEvents } from "./infra/realtime.js";
import { ServiceJobs } from "./service/jobs.js";
import { WorkerEntrypoint } from "cloudflare:workers";
import { ScriptAgentRunRequestModel } from "./domain/script_agent.js";
import { AdminAgentRunRequestModel } from "./domain/admin_agent.js";
import { WorkerSocket } from "./infra/realtime.js";
import { ReadCache } from "./infra/read_cache.js";
import { observe_application_changes } from "./service/application_events.js";
export class Application {
  constructor(env, ctx) {
    // Queue cancellation and lease fencing also apply before publishing stable R2 keys.
    if (env.API_STORAGE) env = {
      ...env,
      API_STORAGE: new Proxy(env.API_STORAGE, {
        get: (bucket, name) => {
          const value = Reflect.get(bucket, name);
          if (typeof value !== 'function') return value;
          return name === 'put' ? async (...args) => {
            await this.jobs?.assert_current();
            return value.apply(bucket, args);
          } : value.bind(bucket);
        }
      })
    };
    this.env = env;
    this.wait_until = promise => ctx.waitUntil(promise);
    this.storage = new D1Store(env.DB);
    this.sockets = new WorkerSocketHub(env.REALTIME.getByName("realtime"));
    this.events = new WorkerAdminEvents(env.REALTIME.getByName("realtime"));
    const device_token = env.DEVICE_TOKEN || reader_session_secret(env);
    this.repo = {
      background_tasks: new RepositoryBackgroundTasks({
        sql: this.storage.sql
      }),
      snapshot_settings: new RepositorySnapshotSettings({
        sql: this.storage.sql
      }),
      cookie_push_settings: new RepositoryCookiePushSettings({
        sql: this.storage.sql
      }),
      webhook_settings: new RepositoryWebhookSettings({
        sql: this.storage.sql
      }),
      access_tokens: new RepositoryAccessToken({
        sql: this.storage.sql
      }),
      activity: new RepositoryActivity({
        sql: this.storage.sql
      }),
      calls: new RepositoryCall({
        sql: this.storage.sql
      }),
      credit: new RepositoryCredit({
        sql: this.storage.sql
      }),
      devices: new RepositoryDevice({
        sql: this.storage.sql
      }),
      device_tokens: new RepositoryDeviceToken({
        sql: this.storage.sql
      }),
      mcp_tokens: new RepositoryMcpToken({
        sql: this.storage.sql
      }),
      mcp_oauth: new RepositoryMcpOauth({
        sql: this.storage.sql,
        transaction: action => this.storage.transaction(action)
      }),
      discovery: new RepositoryDiscoverySource({
        sql: this.storage.sql
      }),
      clips: new RepositoryClip({
        sql: this.storage.sql
      }),
      detections: new RepositoryDetection({
        sql: this.storage.sql
      }),
      redemption: new RepositoryRedemption({
        sql: this.storage.sql
      }),
      rss_cookie_grants: new RepositoryRssCookieGrant({
        sql: this.storage.sql
      }),
      rss_cookies: new RepositoryRssCookie({
        sql: this.storage.sql
      }),
      scripts: new RepositoryScript({
        sql: this.storage.sql
      }),
      script_releases: new RepositoryScriptRelease({
        sql: this.storage.sql
      }),
      platforms: new RepositoryPlatform({
        sql: this.storage.sql
      }),
      tags: new RepositoryTag({
        sql: this.storage.sql
      }),
      rss_route_cache: new RepositoryRssRouteCache({
        sql: this.storage.sql,
        storage: this.storage
      }),
      users: new RepositoryUser({
        sql: this.storage.sql
      }),
      script_agent: new RepositoryScriptAgent({
        sql: this.storage.sql
      })
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
      transaction: callback => this.storage.transaction(callback),
      sockets: this.sockets,
      schedule_alarm: async () => {},
      wait_until: promise => this.wait_until(promise),
      route_cache: new RssRouteCache(RSS_ROUTE_CACHE_TTL_MS, RSS_ROUTE_CACHE_MAX_ENTRIES, {
        store: this.repo.rss_route_cache,
        object_store: create_api_object_store(env),
        max_bytes: RSS_ROUTE_CACHE_MAX_BYTES,
        persist_max_bytes: RSS_ROUTE_CACHE_PERSIST_MAX_BYTES
      })
    };
    this.logs = new RepositoryWorkersLogs({
      telemetry: new WorkersLogs(env),
      object_store: ports.object_store
    });
    Object.assign(this.repo.devices, this.logs.devices);
    this.repo.script_logs = this.logs.scripts;
    /** 应用服务注册表：兄弟服务经 `this.app.<svc>.<method>` 互相调用。 */
    this.app = {};
    this.jobs = new ServiceJobs({
      store: this.storage,
      queue: env.JOBS,
      app: this.app,
      wait_until: this.wait_until
    });
    this.app.events = this.events;
    this.app.mcp_tokens = new ServiceMcpToken({
      repo: this.repo.mcp_tokens,
      app: this.app
    });
    this.app.mcp_oauth = new ServiceMcpOauth({
      repo: this.repo.mcp_oauth,
      tokens: this.repo.mcp_tokens
    });
    this.app.background_tasks = new ServiceBackgroundTasks({
      repo: this.repo.background_tasks,
      jobs: this.jobs,
      wait_until: ports.wait_until,
      notify: async task => {
        await this.app.events.invalidate("background-tasks.changed", task?.source_id || task?.id || null);
        if (task?.kind === "detect") await this.app.events.invalidate("detections.changed");else if (task?.kind === "clip") await this.app.events.invalidate("clips.changed");else if (task?.source_id) await this.app.events.invalidate("discovery.changed", task.source_id);
      }
    });
    this.app.webhook_settings = new ServiceWebhookSettings({
      repo: this.repo.webhook_settings,
      credentials: create_script_agent_credentials(env.ADMIN_PASSWORD || "")
    });
    this.app.snapshot_settings = new ServiceSnapshotSettings({
      repo: this.repo.snapshot_settings,
      schedule_alarm: ports.schedule_alarm
    });
    this.app.detections = new ServiceDetection({
      repo: this.repo.detections,
      storage: this.storage,
      object_store: ports.object_store,
      load_snapshot: async (record, previous, signal) => await this.app.scripts.execute_detection(record, previous, signal),
      script_routes: async () => await this.app.scripts.detect_routes(),
      validate_script: async record => await this.app.scripts.detect_source(record),
      background_tasks: this.app.background_tasks,
      snapshot_settings: async () => await this.app.snapshot_settings.settings(),
      schedule_alarm: ports.schedule_alarm
    });
    this.app.clips = new ServiceClip({
      repo: this.repo.clips,
      storage: this.storage,
      object_store: ports.object_store,
      load_snapshot: async (record, signal) => await this.app.scripts.execute_clip_snapshot(record, signal),
      script_routes: async () => await this.app.scripts.clip_routes(),
      validate_script: async record => await this.app.scripts.clip_source(record),
      background_tasks: this.app.background_tasks,
      snapshot_settings: async () => await this.app.snapshot_settings.settings(),
      schedule_alarm: ports.schedule_alarm
    });
    this.app.cookie_push_settings = new ServiceCookiePushSettings({
      repo: this.repo.cookie_push_settings,
      credentials: create_script_agent_credentials(env.ADMIN_PASSWORD || "")
    });
    // 暂停概览统计，不注册统计服务，停止 RSS 计数和统计快照扫描。
    this.app.maintenance = new ServiceMaintenance({
      repo: this.repo
    });
    this.app.activity = new ServiceActivity({
      repo: this.repo,
      app: this.app
    });
    this.app.credit = new ServiceCredit({
      repo: this.repo,
      storage: this.storage
    });
    this.app.redemption = new ServiceRedemption({
      repo: this.repo,
      storage: this.storage,
      app: this.app
    });
    this.app.tasks = new ServiceTask({
      repo: this.repo,
      ports,
      storage: this.storage,
      app: this.app
    });
    this.app.devices = new ServiceDevice({
      repo: this.repo,
      ports,
      app: this.app
    });
    this.app.device_tokens = new ServiceDeviceToken({
      repo: this.repo.device_tokens,
      credentials: create_device_token_credentials(env.ADMIN_PASSWORD || ""),
      app: this.app,
      schedule_alarm: ports.schedule_alarm
    });
    this.app.auth = new ServiceAuth({
      repo: this.repo,
      storage: this.storage,
      app: this.app,
      device_token
    });
    this.app.access_tokens = new ServiceAccessToken({
      repo: this.repo,
      storage: this.storage
    });
    this.app.users = new ServiceUser({
      repo: this.repo,
      storage: this.storage
    });
    this.app.discovery = new ServiceDiscovery({
      background_tasks: this.app.background_tasks,
      wait_until: ports.wait_until,
      snapshot_settings: async () => await this.app.snapshot_settings.settings(),
      check_cookie_permissions: async script_id => await this.app.scripts.check_cookie_permissions(script_id),
      public_origin: feed_hostname_origin(env),
      repo: this.repo,
      route_cache: ports.route_cache,
      storage: this.storage,
      object_store: create_api_object_store(env),
      schedule_alarm: ports.schedule_alarm,
      render_catalog: catalog => render_embedded_home(catalog, DISCOVERY_CATALOG_ORIGIN),
      load_snapshot: (source, origin, signal) => load_discovery_snapshot(source, origin, async (...args) => await this.app.scripts.serve_rss_route(...args), signal)
    });
    this.app.scripts = new ServiceScript({
      repo: this.repo,
      ports,
      app: this.app,
      public_origin: feed_hostname_origin(env)
    });
    const build_rank_snapshot = create_rank_snapshot_builder(async (context, signal) => await this.app.scripts.execute_hot_snapshot(context, signal));
    this.app.hot_snapshots = new ServiceHotSnapshots({
      background_tasks: this.app.background_tasks,
      build_snapshot: ports.object_store ? signal => build_rank_snapshot(env, signal) : null,
      build_home: ports.object_store ? (catalog, signal) => publish_rank_home(catalog, env, signal) : null
    });
    this.app.script_agent = new ServiceScriptAgent({
      repo: this.repo.script_agent,
      credentials: create_script_agent_credentials(env.ADMIN_PASSWORD || ""),
      admin_ports: {
        source_types: async () => (await this.app.discovery.platforms()).map(platform => platform.id),
        context: async page => {
          if (page === "overview") return {
            disabled: true,
            message: "概览统计已暂时停用"
          };
          if (page === "devices") return await this.app.devices.summary();
          if (page === "discovery") return {
            source_count: await this.repo.discovery.count(),
            source_types: Object.fromEntries((await this.app.discovery.platforms()).map(platform => [platform.id, platform.label])),
            tags: await this.app.discovery.tags(),
            script_routes: (await this.app.scripts.list_scripts()).scripts.filter(script => script.status === "published").flatMap(script => (script.routes || [script]).map(route => ({
              path: route.path,
              platform: route.platform,
              tags: route.tags,
              enabled: script.enabled
            })))
          };
          if (page === "scripts") return {
            scripts: (await this.app.scripts.list_scripts()).scripts.map(({
              id,
              name,
              path,
              platform,
              tags,
              enabled,
              routes
            }) => ({
              id,
              name,
              path,
              platform,
              tags,
              enabled,
              routes
            }))
          };
          if (page === "users") return await this.app.users.list_admin_users(new URL("https://internal/?limit=20"));
          if (page === "redemptions") return await this.app.redemption.list_redemption_campaigns(new URL("https://internal/?limit=20"));
          if (page === "cookies") {
            const cookies = await this.repo.rss_cookies.get();
            return {
              cookie_count: cookies.length,
              domains: [...new Set(cookies.map(cookie => cookie.domain))]
            };
          }
          return {};
        },
        get_source: async id => {
          const row = await this.repo.discovery.find(id);
          return row ? DiscoverySourceModel.fromRow(row).toValue() : null;
        },
        list_sources: async ({
          query,
          source_type,
          enabled,
          offset,
          limit
        }) => {
          const sources = (await this.repo.discovery.list({
            include_disabled: true,
            query,
            source_type
          })).map(row => DiscoverySourceModel.fromRow(row).toValue()).filter(source => enabled === undefined || source.enabled === enabled);
          return {
            sources: sources.slice(offset, offset + limit),
            total_count: sources.length,
            offset,
            limit,
            has_more: offset + limit < sources.length
          };
        },
        create_source: async body => (await this.app.discovery.create_discovery_source(new Request("https://internal/_admin/discovery/sources", {
          method: "POST",
          body: JSON.stringify(body)
        }))).data,
        update_source: async (id, body, expected) => await this.app.discovery.update_discovery_source(new Request("https://internal/_admin/discovery/sources/" + id, {
          method: "PATCH",
          body: JSON.stringify(body)
        }), id, expected),
        delete_source: async (id, expected) => await this.app.discovery.delete_discovery_source(id, expected)
      },
      secret_lookup: name => /^READER_AI_[A-Z0-9_]{1,64}$/.test(name) ? env[name] : "",
      debug_draft: async body => await this.app.scripts.debug_script(new Request("https://internal/_admin/scripts/debug", {
        method: "POST",
        body: JSON.stringify(body)
      }))
    });
    this.app.script_agent.wait_until = promise => this.wait_until(promise);
    observe_application_changes(this.repo, {
      store: this.storage,
      events: this.events,
      jobs: this.jobs,
      cache: new ReadCache(env.CACHE, this.wait_until)
    });
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (/^\/_(admin|public)\/discovery\//.test(path)) await this.app.discovery.remember_public_origin(request.headers.get('X-Feed-Public-URL'));
    if (["/connect", "/_admin/events/ws", "/_admin/messages/ws", "/_admin/agent/ws", "/_admin/scripts/agent/ws"].includes(path)) return this.env.REALTIME.getByName("realtime").fetch(request);
    return route(request, this.app);
  }
}
export class ApplicationEntrypoint extends WorkerEntrypoint {
  application() {
    return new Application(this.env, this.ctx);
  }
  async device_connect(headers) {
    return this.application().app.devices.prepare_connection(new Request('https://internal/connect', {
      headers
    }));
  }
  async device_ready() {
    return this.application().app.tasks.dispatch_pending();
  }
  async device_message(attachment, message) {
    const application = this.application();
    return application.app.devices.webSocketMessage(new WorkerSocket(application.sockets, attachment), message);
  }
  async device_closed(attachment, code, reason, clean) {
    const application = this.application();
    return application.app.devices.mark_device_offline(new WorkerSocket(application.sockets, attachment), 'connection.closed', reason, {
      code,
      clean
    });
  }
  async task_status(id) {
    return this.application().app.tasks.find_task(id);
  }
  async agent_settings() {
    return this.application().app.script_agent.settings();
  }
  async agent_run(body, kind) {
    const Model = kind === 'admin-agent' ? AdminAgentRunRequestModel : ScriptAgentRunRequestModel;
    const parsed = Model.fromBody(body);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const application = this.application(),
      abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(180000)]);
    const encoder = new TextEncoder();
    return new ReadableStream({
      type: 'bytes',
      start: controller => {
        const emit = value => {
          if (!signal.aborted) controller.enqueue(encoder.encode(JSON.stringify({
            ...value,
            run_id: body.run_id || ''
          }) + '\n'));
        };
        emit({
          type: 'start'
        });
        const pending = (kind === 'admin-agent' ? application.app.script_agent.run_admin(parsed.model, emit, signal) : application.app.script_agent.run(parsed.model, emit, signal)).catch(error => emit({
          type: 'error',
          error: error.message
        })).finally(() => {
          if (!abort.signal.aborted) controller.close();
        });
        this.ctx.waitUntil(pending);
      },
      cancel: () => abort.abort(new Error('对话已取消'))
    });
  }
}
