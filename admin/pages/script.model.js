import { ScriptAgentModel } from "../components/script_agent.js";
import { ListPaginationModel } from "../components/pagination.js";
import { script_platform } from "../components/discovery_platform.js";
import { createTwoFilesPatch } from "diff";
import { ScriptConfigModel } from "../components/script_config.model.js";

import { DEFAULT_RSS_SCRIPT, DEFAULT_HOT_SCRIPT } from "./script.default.js";

const Timeless = window.FindRSSAdminUI;
const fetch = window.FindRSSAdminAuth.fetch;
const { combine, computed, ref, refarr, refobj } = Timeless;

function normalize_script(raw) {
  const safe_url = (value) => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password
        ? url.href
        : "";
    } catch {
      return "";
    }
  };
  let website_url = "";
  try {
    if (raw.url) {
      const website = new URL(
        /^[a-z][a-z\d+.-]*:/i.test(raw.url) ? raw.url : "https://" + raw.url,
      );
      if (
        ["http:", "https:"].includes(website.protocol) &&
        !website.username &&
        !website.password
      )
        website_url = website.href;
    }
  } catch {}
  return {
    id: String(raw.id || ""),
    render_key: [
      raw.id,
      raw.updated_at,
      raw.kind ?? raw.script_type,
      raw.status,
      raw.enabled,
      raw.debug,
      raw.version,
      raw.script_hash,
      raw.cookie_grant_id,
      raw.cookie_authorization?.status,
      raw.draft ? "draft" : "",
      raw.draft?.updated_at,
      raw.current_release_id,
      raw.source_loaded,
      raw.script_bytes,
    ].join(":"),
    version: String(raw.version || ""),
    published_version: String(raw.published_version || ""),
    script_hash: String(raw.script_hash || ""),
    current_release_id: String(raw.current_release_id || ""),
    max_published_version: String(raw.max_published_version || raw.published_version || ""),
    source_loaded: raw.source_loaded !== false,
    script_bytes: Number(raw.script_bytes ?? String(raw.script || "").length),
    kind: (raw.kind ?? raw.script_type) === "hot" ? "hot" : "rss",
    routes: (Array.isArray(raw.routes) && raw.routes.length
      ? raw.routes
      : [raw]
    ).map((entry, route_index) => ({
      ...entry,
      route_index,
      name: String(entry.name || raw.name || ""),
      path: String(entry.path || ""),
      example: String(entry.example || entry.path || ""),
      parameters:
        entry.parameters &&
        typeof entry.parameters === "object" &&
        !Array.isArray(entry.parameters)
          ? entry.parameters
          : route_index === 0 &&
              raw.parameters &&
              typeof raw.parameters === "object" &&
              !Array.isArray(raw.parameters)
            ? raw.parameters
            : {},
    })),
    path: String(raw.path || ""),
    name: String(raw.name || ""),
    url: String(raw.url || ""),
    platform: script_platform(raw.platform),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    website_url,
    maintainers: Array.isArray(raw.maintainers)
      ? raw.maintainers.map((value) =>
          value && typeof value === "object"
            ? {
                nickname: String(value.nickname || value.name || ""),
                url: safe_url(value.url),
                avatar: safe_url(value.avatar),
              }
            : String(value),
        )
      : [],
    example: String(raw.example || ""),
    parameters:
      raw.parameters && typeof raw.parameters === "object"
        ? raw.parameters
        : {},
    description: String(raw.description || ""),
    config_schema: raw.config_schema || null,
    config: raw.config || {},
    cookie_grant_id: String(raw.cookie_grant_id || ""),
    cookie_authorization: {
      status: ["active", "required"].includes(raw.cookie_authorization?.status)
        ? raw.cookie_authorization.status
        : "none",
      message: String(raw.cookie_authorization?.message || ""),
    },
    script: String(raw.script || ""),
    draft: raw.draft && typeof raw.draft.script === "string" ? { ...raw.draft } : null,
    published_script: typeof raw.published_script === "string" ? raw.published_script
      : raw.status !== "draft" ? String(raw.script || "") : null,
    enabled: raw.enabled === true,
    debug: raw.debug === true,
    status: raw.status === "draft" ? "draft" : "published",
    created_at: Number(raw.created_at || 0),
    updated_at: Number(raw.updated_at || 0),
  };
}

/** 归一化一条执行日志：字段全部兜底，坏数据只影响单条渲染。 */
function normalize_script_log(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  return {
    id: Number(value.id || 0),
    source: String(value.source || ""),
    method: String(value.method || ""),
    pathname: String(value.pathname || ""),
    params:
      value.params && typeof value.params === "object" ? value.params : {},
    status: String(value.status || ""),
    phase: String(value.phase || ""),
    level: String(value.level || "info"),
    message: String(value.message || ""),
    error_text: String(value.error_text || ""),
    lines: normalize_log_lines(value.lines),
    elapsed_ms: Number(value.elapsed_ms || 0),
    invoked: value.invoked === true,
    created_at: Number(value.created_at || 0),
  };
}

function normalize_log_lines(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((line) => ({
    level: String(line?.level || "info"),
    text: String(line?.text ?? ""),
  }));
}

async function request_json(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(
      new Error(payload.error || "请求失败：HTTP " + response.status),
      { payload },
    );
  }
  return payload;
}

function ScriptViewModel() {
  const scripts_ = refarr([]);
  const cookie_consent_ = refobj({
    open: false,
    busy: false,
    error: "",
    info: null,
  });
  let cookie_pending = null;
  let cookie_grant_id = "";
  const query_ = ref("");
  const filter_status_ = ref("all");
  const script_type_ = ref("rss");
  const draft_type_ = ref("rss");
  const draft_script_ = ref("");
  const published_script_ = ref(null);
  const diff_open_ = ref(false);
  const diff_text_ = ref("");
  const draft_version_ = ref("");

  const debug_url_ = ref("");
  const debug_routes_ = ref([]);
  const debug_routes_error_ = ref("");
  const debug_route_path_ = ref("");
  let routes_timer = null;
  let routes_generation = 0;
  const live_debug_ = ref(true);
  const debugging_ = ref(false);
  const debug_result_ = refobj({
    status: 0,
    rss_debug: null,
    error: "",
    stale: false,
  });
  let debug_generation = 0;
  let debug_timer = null;
  let debug_armed = false;
  let debug_controller = null;
  const route_debug_states = new Map();

  const draft_enabled_ = ref(true);
  const draft_debug_ = ref(false);
  const enabled_pending_ = refobj({});
  const status_pending_ = refobj({});
  const editing_id_ = ref("");
  const form_open_ = ref(false);
  const loading_ = ref(false);
  const saving_ = ref(false);
  const draft_saved_ = ref(false);
  const draft_saved_at_ = ref(0);
  let draft_saved_timer = null;
  const list_error_ = ref("");
  const form_error_ = ref("");
  const form_message_ = ref("");
  const install_open_ = ref(false);
  const install_input_ = ref("");
  const install_busy_ = ref(false);
  const install_preview_ = ref(null);
  const history_ = ref({ open: false, busy: false, script_id: "", versions: [], source: "", selected_id: "", error: "" });

  const script_logs_ = refarr([]);
  const script_logs_route_ = ref("");
  const script_logs_loading_ = ref(false);
  const script_logs_loading_more_ = ref(false);
  const script_logs_has_more_ = ref(false);
  const script_logs_error_ = ref("");
  let script_logs_generation = 0;
  let agent = null;
  let draft_revision = 0;

  const state = {
    history: history_,
    cookie_consent: cookie_consent_,
    scripts: scripts_,
    query: query_,
    filter_status: filter_status_,
    script_type: script_type_,
    draft_type: draft_type_,
    draft_script: draft_script_,
    diff_open: diff_open_,
    diff_text: diff_text_,
    diff_available: computed(published_script_, script => script !== null),
    draft_version: draft_version_,

    debug_url: debug_url_,
    debug_routes: debug_routes_,
    debug_routes_error: debug_routes_error_,
    debug_route_path: debug_route_path_,
    live_debug: live_debug_,
    debugging: debugging_,
    debug_result: debug_result_,

    draft_enabled: draft_enabled_,
    draft_debug: draft_debug_,
    enabled_pending: enabled_pending_,
    status_pending: status_pending_,
    editing_id: editing_id_,
    form_title: combine({ id: editing_id_, scripts: scripts_ }, ({ id, scripts }) =>
      id ? `编辑脚本：${scripts.find(script => script.id === id)?.name || id}` : "新增脚本",
    ),
    form_open: form_open_,
    loading: loading_,
    saving: saving_,
    draft_saved: draft_saved_,
    draft_saved_at: draft_saved_at_,
    list_error: list_error_,
    form_error: form_error_,
    form_message: form_message_,
    install_open: install_open_,
    install_input: install_input_,
    install_busy: install_busy_,
    install_preview: install_preview_,

    script_logs: script_logs_,
    script_logs_route: script_logs_route_,
    script_logs_loading: script_logs_loading_,
    script_logs_loading_more: script_logs_loading_more_,
    script_logs_has_more: script_logs_has_more_,
    script_logs_error: script_logs_error_,
  };

  async function load() {
    return pagination.load();
  }

  function reset_draft_save_feedback() {
    if (draft_saved_timer !== null) clearTimeout(draft_saved_timer);
    draft_saved_timer = null;
    draft_saved_.set(false);
  }

  /** 每页日志条数，与 DO 侧的默认 limit 无关，显式传入。 */
  const LOG_PAGE_LIMIT = 50;

  function log_query(route, before_id) {
    const query = new URLSearchParams({ route, limit: String(LOG_PAGE_LIMIT) });
    if (before_id !== null) query.set("before_id", String(before_id));
    return "/admin/api/scripts/logs?" + query.toString();
  }

  /** 按 route 拉最新一页日志，按 id 合并（翻页/重复请求不会产生重复条目）。 */
  async function refresh_script_logs(route) {
    if (
      route === "" ||
      route !== script_logs_route_.value ||
      script_logs_loading_.value ||
      script_logs_loading_more_.value
    ) {
      return;
    }
    const generation = script_logs_generation;
    script_logs_loading_.set(true);
    script_logs_error_.set("");
    try {
      const payload = await request_json(log_query(route, null));
      if (!Array.isArray(payload.logs))
        throw new Error("脚本日志接口返回格式不正确");
      if (script_logs_route_.value !== route || generation !== script_logs_generation) return;
      const logs_by_id = new Map(
        script_logs_.value.map((log) => [log.id, log]),
      );
      for (const log of payload.logs.map(normalize_script_log))
        logs_by_id.set(log.id, log);
      script_logs_.assign(
        [...logs_by_id.values()].sort((left, right) => right.id - left.id),
      );
      script_logs_has_more_.set(Boolean(payload.has_more));
    } catch (error) {
      if (script_logs_route_.value === route && generation === script_logs_generation) {
        script_logs_error_.set(
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      if (generation === script_logs_generation) script_logs_loading_.set(false);
    }
  }

  async function load_older_script_logs() {
    const route = script_logs_route_.value;
    if (
      route === "" ||
      script_logs_loading_.value ||
      script_logs_loading_more_.value ||
      !script_logs_has_more_.value ||
      script_logs_.value.length === 0
    ) {
      return;
    }
    const before_id = Math.min(
      ...script_logs_.value.map((log) => Number(log.id)),
    );
    const generation = script_logs_generation;
    script_logs_loading_more_.set(true);
    script_logs_error_.set("");
    try {
      const payload = await request_json(log_query(route, before_id));
      if (!Array.isArray(payload.logs))
        throw new Error("脚本日志接口返回格式不正确");
      if (script_logs_route_.value !== route || generation !== script_logs_generation) return;
      const logs_by_id = new Map(
        script_logs_.value.map((log) => [log.id, log]),
      );
      for (const log of payload.logs.map(normalize_script_log))
        logs_by_id.set(log.id, log);
      script_logs_.assign(
        [...logs_by_id.values()].sort((left, right) => right.id - left.id),
      );
      script_logs_has_more_.set(Boolean(payload.has_more));
    } catch (error) {
      if (script_logs_route_.value === route && generation === script_logs_generation) {
        script_logs_error_.set(
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      if (generation === script_logs_generation) script_logs_loading_more_.set(false);
    }
  }

  function reset_script_logs() {
    script_logs_generation++;
    script_logs_route_.set("");
    script_logs_.assign([]);
    script_logs_error_.set("");
    script_logs_has_more_.set(false);
    script_logs_loading_.set(false);
    script_logs_loading_more_.set(false);
  }

  function request_cookie_consent(error, source, script_id, retry) {
    const info = error.payload?.cookie_permissions;
    if (!info) return false;
    cookie_pending = {
      source,
      script_id,
      retry,
      version: info.version ?? draft_version_.value.trim(),
    };
    cookie_consent_.as({ open: true, busy: false, error: "", info });
    return true;
  }

  function reset_debug() {
    route_debug_states.clear();
    routes_generation++;
    if (routes_timer !== null) clearTimeout(routes_timer);
    routes_timer = null;
    debug_routes_.set([]);
    debug_routes_error_.set("");
    debug_route_path_.set("");
    debug_generation++;
    if (debug_timer !== null) clearTimeout(debug_timer);
    debug_timer = null;
    debug_controller?.abort();
    debug_controller = null;
    debug_armed = false;
    debugging_.set(false);
    debug_url_.set("");
    live_debug_.set(true);
    debug_result_.as({ status: 0, rss_debug: null, error: "", stale: false });
  }

  function debug_request_url(path) {
    return path.trim() ? "/debug" + path.trim() : "";
  }

  function save_route_debug_state() {
    const path = debug_route_path_.value;
    if (debug_routes_.value.some(row => row.path === path)) {
      route_debug_states.set(path, { result: debug_result_.value, armed: debug_armed });
    }
  }

  function mark_debug_results_stale() {
    save_route_debug_state();
    for (const entry of route_debug_states.values()) {
      entry.result = { ...entry.result, stale: Boolean(entry.result.rss_debug) };
    }
  }

  function select_debug_route(path) {
    const route = debug_routes_.value.find(row => row.path === path);
    if (!route || path === debug_route_path_.value) return;
    save_route_debug_state();
    debug_generation++;
    if (debug_timer !== null) clearTimeout(debug_timer);
    debug_timer = null;
    debug_controller?.abort();
    debug_controller = null;
    debugging_.set(false);
    const previous = route_debug_states.get(path);
    debug_armed = previous?.armed || false;
    debug_route_path_.set(path);
    debug_url_.set(debug_request_url(route.url));
    debug_result_.as(previous?.result || { status: 0, rss_debug: null, error: "", stale: false });
    draft_revision++;
    if (agent?.state.busy.value) agent.methods.cancel("调试路由已切换，已停止当前 AI 对话");
    if (debug_result_.value.stale) schedule_debug();
  }

  function update_debug_routes(routes) {
    save_route_debug_state();
    const previous = debug_routes_.value;
    const rows = routes
      .filter((entry) => entry.path)
      .map((entry) => ({
        path: entry.path,
        name: entry.name || entry.path,
        image_proxy: entry.image_proxy === true || Boolean(entry.allowed_hosts?.length),
        url:
          previous.find((row) => row.path === entry.path)?.url ??
          (entry.example || entry.path),
      }));
    debug_routes_.set(rows);
    for (const path of route_debug_states.keys()) {
      if (!rows.some(row => row.path === path)) route_debug_states.delete(path);
    }
    const selected =
      rows.find((row) => row.path === debug_route_path_.value) || rows[0];
    if (selected && selected.path !== debug_route_path_.value) {
      select_debug_route(selected.path);
      return;
    }
    if (!selected) {
      debug_generation++;
      debug_controller?.abort();
      debug_controller = null;
      debugging_.set(false);
      debug_armed = false;
      debug_route_path_.set("");
      debug_result_.as({ status: 0, rss_debug: null, error: "", stale: false });
    }
    const request_url = debug_request_url(selected?.url || "");
    const changed = debug_url_.value !== request_url;
    debug_url_.set(request_url);
    if (changed) schedule_debug();
  }

  function schedule_debug_routes() {
    const generation = ++routes_generation;
    if (routes_timer !== null) clearTimeout(routes_timer);
    debug_routes_error_.set("");
    routes_timer = setTimeout(async () => {
      routes_timer = null;
      if (!form_open_.value) return;
      try {
        const payload = await request_json("/admin/api/scripts/routes", {
          method: "POST",
          body: JSON.stringify({ script: draft_script_.value }),
        });
        if (generation !== routes_generation) return;
        if (!Array.isArray(payload.routes))
          throw new Error("路由接口返回格式不正确");
        update_debug_routes(payload.routes);
      } catch (error) {
        if (generation === routes_generation)
          debug_routes_error_.set(error.message || String(error));
      }
    }, 400);
  }

  function schedule_debug() {
    debug_generation++;
    if (debug_timer !== null) clearTimeout(debug_timer);
    debug_timer = null;
    debug_result_.as({
      ...debug_result_.value,
      stale: Boolean(debug_result_.value.rss_debug),
    });
    if (
      agent?.state.busy.value ||
      !debug_armed ||
      !live_debug_.value ||
      !form_open_.value ||
      !debug_url_.value.trim() ||
      !draft_script_.value.trim()
    )
      return;
    debug_timer = setTimeout(() => {
      debug_timer = null;
      if (!debugging_.value && !saving_.value)
        methods.debug_script();
    }, 800);
  }

  const methods = {
    async open_history(script_id) {
      if (history_.value.busy) return;
      history_.set({ open: true, busy: true, script_id, versions: [], source: "", selected_id: "", error: "" });
      try {
        const result = await request_json("/admin/api/scripts/" + script_id + "/versions");
        history_.set({ ...history_.value, versions: result.versions || [] });
      } catch (error) { history_.set({ ...history_.value, error: error.message }); }
      finally { history_.set({ ...history_.value, busy: false }); }
    },
    close_history() { if (!history_.value.busy && !cookie_consent_.value.open) history_.set({ ...history_.value, open: false }); },
    async view_version(release_id) {
      if (history_.value.busy) return;
      history_.set({ ...history_.value, busy: true, error: "" });
      try {
        const result = await request_json("/admin/api/scripts/" + history_.value.script_id + "/versions/" + release_id);
        history_.set({ ...history_.value, selected_id: release_id, source: result.version.script });
      } catch (error) { history_.set({ ...history_.value, error: error.message }); }
      finally { history_.set({ ...history_.value, busy: false }); }
    },
    async rollback_version(release_id, confirmed = false) {
      if (history_.value.busy || cookie_consent_.value.open) return;
      const script_id = history_.value.script_id;
      const release = history_.value.versions.find(value => value.id === release_id);
      const current = scripts_.value.find(value => value.id === script_id);
      if (!release || release.current) return;
      if (!confirmed && !window.confirm(`将正式脚本回退到 ${release.version || "未编号版本"}？未发布草稿会保留，订阅源快照将重新生成。`)) return;
      history_.set({ ...history_.value, busy: true, error: "" });
      try {
        await request_json("/admin/api/scripts/" + script_id + "/rollback", { method: "POST",
          body: JSON.stringify({ release_id, expected_release_id: current?.current_release_id,
            ...(confirmed && cookie_grant_id ? { cookie_grant_id } : {}) }) });
        history_.set({ ...history_.value, busy: false });
        await load();
        await methods.open_history(script_id);
        form_message_.set(`已回退到 ${release.version || "未编号版本"}，快照正在刷新。`);
      } catch (error) {
        if (error.payload?.cookie_permissions) {
          try {
            const result = await request_json("/admin/api/scripts/" + script_id + "/versions/" + release_id);
            request_cookie_consent(error, result.version.script, script_id, () => methods.rollback_version(release_id, true));
          } catch (failure) { history_.set({ ...history_.value, error: failure.message }); }
        } else history_.set({ ...history_.value, error: error.message });
      } finally { history_.set({ ...history_.value, busy: false }); }
    },
    open_install() {
      if (saving_.value || install_busy_.value || cookie_consent_.value.open) return;
      methods.reset_draft();
      install_input_.set("");
      install_open_.set(true);
    },
    close_install() {
      if (saving_.value || install_busy_.value || cookie_consent_.value.open) return;
      methods.reset_draft();
    },
    set_install_input(value) {
      if (saving_.value || install_busy_.value || cookie_consent_.value.open) return;
      install_input_.set(String(value));
      install_preview_.set(null);
      draft_script_.set("");
      draft_version_.set("");
      cookie_grant_id = "";
      form_error_.set("");
    },
    async preview_install() {
      if (install_busy_.value || saving_.value || cookie_consent_.value.open) return;
      install_preview_.set(null);
      form_error_.set("");
      if (!install_input_.value.trim()) {
        form_error_.set("请输入脚本 URL 或脚本内容");
        return;
      }
      install_busy_.set(true);
      try {
        const result = await request_json("/admin/api/scripts/install-preview", {
          method: "POST", body: JSON.stringify({ input: install_input_.value }),
        });
        draft_script_.set(result.script);
        draft_type_.set(result.metadata.kind);
        draft_version_.set(result.metadata.version || "");
        cookie_grant_id = "";
        // 先解除忙碌状态，避免新建控件在挂载前错过解禁事件。
        install_busy_.set(false);
        install_preview_.set(result);
      } catch (error) {
        form_error_.set(error.message || String(error));
      } finally {
        install_busy_.set(false);
      }
    },
    save_install(status = "draft") {
      if (!install_preview_.value || install_busy_.value || cookie_consent_.value.open) return;
      return methods.save_script(status);
    },
    start() {
      return load();
    },
    async open_script(script_id) {
      const payload = await request_json("/admin/api/scripts?limit=1&offset=0&id=" + encodeURIComponent(script_id));
      const raw = payload.scripts?.find(script => script.id === script_id);
      if (!raw) throw new Error("脚本已删除或不存在，无法编辑");
      const script = normalize_script(raw);
      scripts_.as([script, ...scripts_.value.filter(item => item.id !== script_id)]);
      methods.edit_script(script_id);
    },
    destroy() {
      reset_draft_save_feedback();
      reset_script_logs();
      agent?.destroy();
      reset_debug();
      pagination.destroy();
    },
    set_filter(name, value) {
      pagination.reset();
      if (name === "query") query_.set(String(value));
      if (name === "status") filter_status_.set(String(value));
      return load();
    },
    select_script_type(value) {
      if (!["hot", "rss"].includes(value)) return;
      query_.set("");
      filter_status_.set("all");
      pagination.reset();
      reset_script_logs();
      script_type_.set(value);
      return load();
    },
    set_draft(name, value) {
      if (name === "script") draft_script_.set(String(value));
      if (name === "version") draft_version_.set(String(value));

      if (name === "enabled") draft_enabled_.set(value === true);
      if (name === "debug") draft_debug_.set(value === true);

      if (name === "script" || name === "version") {
        cookie_grant_id = "";
        draft_revision++;
        if (agent?.state.busy.value)
          agent.methods.cancel("你已手动修改代码，已停止 AI 更新");
        if (name === "script") {
          schedule_debug_routes();
          mark_debug_results_stale();
          schedule_debug();
        } else {
          // 版本输入不触发调试或授权，旧请求也不能在输入后弹出确认窗口。
          debug_generation++;
          if (debug_timer !== null) clearTimeout(debug_timer);
          debug_timer = null;
          debug_controller?.abort();
          debug_controller = null;
          debugging_.set(false);
        }
      }
    },
    set_debug_url(value, path = debug_route_path_.value) {
      if (path !== debug_route_path_.value) select_debug_route(path);
      const route_url = String(value)
        .trim()
        .replace(/^\/debug(?=\/|[?#]|$)/, "");
      debug_routes_.set(
        debug_routes_.value.map((row) =>
          row.path === path ? { ...row, url: route_url } : row,
        ),
      );
      debug_route_path_.set(path);
      debug_url_.set(debug_request_url(route_url));
      draft_revision++;
      if (agent?.state.busy.value)
        agent.methods.cancel("调试链接已修改，已停止当前 AI 对话");
      schedule_debug();
    },
    select_debug_route,
    set_live_debug(value) {
      live_debug_.set(value === true);
      if (value === true) schedule_debug();
      else {
        if (debug_timer !== null) clearTimeout(debug_timer);
        debug_timer = null;
      }
    },
    async debug_script(path) {
      if (cookie_consent_.value.open) return;
      if (
        agent?.state.busy.value ||
        debugging_.value ||
        saving_.value ||
        !form_open_.value
      )
        return;
      if (path !== undefined) {
        const row = debug_routes_.value.find((row) => row.path === path);
        if (!row) return;
        select_debug_route(path);
      }
      if (debug_timer !== null) clearTimeout(debug_timer);
      debug_timer = null;
      if (!draft_script_.value.trim() || !debug_url_.value.trim()) {
        debug_result_.as({
          ...debug_result_.value,
          error: "填写脚本内容和路由地址后运行调试",
        });
        return;
      }
      debug_armed = true;
      const generation = ++debug_generation;
      const controller = new AbortController();
      debug_controller = controller;
      debugging_.set(true);
      debug_result_.as({ ...debug_result_.value, error: "" });
      try {
        const payload = await request_json("/admin/api/scripts/debug", {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({
            script: draft_script_.value,
            version: draft_version_.value.trim(),
            request_url: debug_url_.value,
            route: editing_id_.value,
            cookie_grant_id,
          }),
        });
        if (generation !== debug_generation) return;
        if (!payload.rss_debug) throw new Error("调试接口未返回执行详情");
        debug_result_.as({
          status: payload.status,
          rss_debug: payload.rss_debug,
          error: "",
          stale: false,
        });
      } catch (error) {
        if (generation === debug_generation && error.name !== "AbortError") {
          if (
            !request_cookie_consent(
              error,
              draft_script_.value,
              editing_id_.value,
              () => methods.debug_script(),
            )
          )
            debug_result_.as({
              ...debug_result_.value,
              error: error.message || String(error),
            });
        }
      } finally {
        if (debug_controller === controller) {
          debug_controller = null;
          debugging_.set(false);
          // 执行期间允许继续编辑，只补跑最后一份草稿。
          if (generation !== debug_generation) schedule_debug();
        }
      }
    },

    script_routes(script) {
      return script.routes || [{ ...script, route_index: 0 }];
    },
    async toggle_script_logs(script_id) {
      if (script_logs_route_.value === script_id) {
        reset_script_logs();
        return;
      }
      reset_script_logs();
      script_logs_route_.set(script_id);
      await refresh_script_logs(script_id);
    },
    close_script_logs() {
      reset_script_logs();
    },
    refresh_script_logs(script_id) {
      return refresh_script_logs(script_id);
    },
    load_older_script_logs() {
      return load_older_script_logs();
    },
    create_script() {
      if (saving_.value) return;
      methods.reset_draft();
      draft_type_.set(script_type_.value);
      draft_script_.set(
        script_type_.value === "hot" ? DEFAULT_HOT_SCRIPT : DEFAULT_RSS_SCRIPT,
      );
      update_debug_routes([
        { path: script_type_.value === "hot" ? "/baidu/hot" : "/solidot" },
      ]);
      form_open_.set(true);
    },
    close_form() {
      if (saving_.value) return;
      methods.reset_draft();
    },
    open_diff() {
      if (!form_open_.value || !editing_id_.value || !state.diff_available.value) return;
      diff_text_.set(published_script_.value === draft_script_.value ? "" : createTwoFilesPatch(
        "published.js", "draft.js", published_script_.value, draft_script_.value,
      ));
      diff_open_.set(true);
    },
    close_diff() {
      diff_open_.set(false);
    },
    edit_script(script_id) {
      if (saving_.value) return;
      const script = scripts_.value.find((item) => item.id === script_id);
      if (!script) return;
      if (!script.source_loaded) return methods.open_script(script_id).catch(error => list_error_.set(error.message));
      const draft = script.draft || script;
      draft_saved_at_.set(Number(draft.updated_at) || 0);
      reset_draft_save_feedback();
      agent?.methods.close();
      draft_revision++;
      reset_debug();
      diff_open_.set(false);
      published_script_.set(script.published_script);
      editing_id_.set(script.id);
      draft_type_.set(draft.kind);
      draft_script_.set(draft.script);
      draft_version_.set(draft.version);
      cookie_grant_id = draft.cookie_grant_id;

      update_debug_routes(script.routes);
      schedule_debug_routes();

      draft_enabled_.set(draft.enabled);
      draft_debug_.set(draft.debug);
      form_error_.set("");
      form_message_.set("");

      form_open_.set(true);
    },
    reset_draft() {
      reset_draft_save_feedback();
      draft_saved_at_.set(0);
      install_open_.set(false);
      install_preview_.set(null);
      cookie_grant_id = "";
      agent?.methods.close();
      draft_revision++;
      reset_debug();
      form_open_.set(false);
      diff_open_.set(false);
      diff_text_.set("");
      published_script_.set(null);

      editing_id_.set("");
      draft_script_.set("");
      draft_version_.set("");

      draft_enabled_.set(true);
      draft_debug_.set(false);
      form_error_.set("");
      form_message_.set("");

    },
    async save_script(status = "draft") {
      if (agent?.state.busy.value || saving_.value) return;
      if (draft_script_.value.trim() === "" && status === "published") {
        form_error_.set("脚本内容不能为空");
        return;
      }
      if (status === "published" && !draft_version_.value.trim()) {
        form_error_.set("发布正式时必须指定版本号");
        return;
      }
      saving_.set(true);
      reset_draft_save_feedback();
      form_error_.set("");
      form_message_.set("");
      const was_editing = editing_id_.value !== "";
      try {
        const body = JSON.stringify({
          script: draft_script_.value,
          version: draft_version_.value.trim(),
          enabled: draft_enabled_.value,
          debug: draft_debug_.value,
          status,
          cookie_grant_id,
          kind: draft_type_.value,
        });
        const result = was_editing
          ? await request_json("/admin/api/scripts/" + editing_id_.value, {
              method: "PATCH",
              body,
            })
          : await request_json("/admin/api/scripts", {
              method: "POST",
              body,
            });
        const saved = normalize_script(result.script);
        if (install_open_.value) {
          script_type_.set(saved.kind);
          query_.set("");
          filter_status_.set("all");
        }
        scripts_.as(
          was_editing
            ? scripts_.value.map((item) =>
                item.id === saved.id ? saved : item,
              )
            : [saved, ...scripts_.value],
        );
        if (!was_editing) pagination.reset();
        if (status === "draft" && form_open_.value) {
          // Keep the editor and debug state; subsequent saves update this script.
          editing_id_.set(saved.id);
        } else {
          methods.reset_draft();
        }
        await load();
        form_message_.set(
          `脚本 ${saved.name} 已${status === "draft" ? "保存为草稿" : "发布为正式"}。`,
        );
        if (status === "draft" && form_open_.value) {
          reset_draft_save_feedback();
          draft_saved_at_.set(Number(saved.draft?.updated_at || saved.updated_at) || Date.now());
          draft_saved_.set(true);
          draft_saved_timer = setTimeout(() => {
            draft_saved_timer = null;
            draft_saved_.set(false);
          }, 3000);
        }
      } catch (error) {
        if (
          !request_cookie_consent(
            error,
            draft_script_.value,
            editing_id_.value,
            () => methods.save_script(status),
          )
        )
          form_error_.set(
            error instanceof Error ? error.message : String(error),
          );
      } finally {
        saving_.set(false);
      }
    },
    cancel_cookie_consent() {
      if (cookie_consent_.value.busy) return;
      cookie_pending = null;
      cookie_consent_.as({ open: false, busy: false, error: "", info: null });
      debug_armed = false;
    },
    async confirm_cookie_consent() {
      if (!cookie_pending || cookie_consent_.value.busy) return;
      const pending = cookie_pending;
      const info = cookie_consent_.value.info;
      cookie_consent_.as({ ...cookie_consent_.value, busy: true, error: "" });
      try {
        if (
          (form_open_.value || install_open_.value) &&
          (draft_script_.value !== pending.source ||
            editing_id_.value !== pending.script_id ||
            draft_version_.value.trim() !== pending.version)
        )
          throw new Error("脚本或版本号已变化，请关闭授权窗口并重新运行或发布");
        const result = await request_json(
          "/admin/api/scripts/cookie-grants",
          {
            method: "POST",
            body: JSON.stringify({
              ...info,
              script: pending.source,
              confirmed: true,
            }),
          },
        );
        cookie_grant_id = result.cookie_grant_id;
        scripts_.as(
          scripts_.value.map((item) =>
            item.id === pending.script_id &&
            item.script === pending.source &&
            item.version === pending.version
              ? { ...item, cookie_grant_id }
              : item,
          ),
        );
        cookie_pending = null;
        cookie_consent_.as({ open: false, busy: false, error: "", info: null });
        await pending.retry();
      } catch (error) {
        cookie_consent_.as({
          ...cookie_consent_.value,
          busy: false,
          error: error.message || String(error),
        });
      }
    },
    async revoke_cookie_consent(script_id) {
      try {
        await request_json(
          "/admin/api/scripts/" + script_id + "/cookie-grant",
          { method: "DELETE" },
        );
        scripts_.as(
          scripts_.value.map((item) =>
            item.id === script_id
              ? {
                  ...item,
                  cookie_grant_id: "",
                  cookie_authorization: {
                    status:
                      item.cookie_authorization.status === "none"
                        ? "none"
                        : "required",
                    message: "Cookie 授权已撤销",
                  },
                  render_key: item.render_key + ":revoked",
                }
              : item,
          ),
        );
        if (editing_id_.value === script_id) cookie_grant_id = "";
        form_message_.set("Cookie 授权已撤销，响应缓存已清空。");
      } catch (error) {
        list_error_.set(error.message || String(error));
      }
    },
    async check_cookie_permissions(script_id) {
      const script = scripts_.value.find((item) => item.id === script_id);
      if (!script || cookie_consent_.value.open || form_open_.value) return;
      list_error_.set("");
      try {
        await request_json(
          "/admin/api/scripts/" + script_id + "/cookie-permissions",
          { method: "POST" },
        );
        await load();
      } catch (error) {
        let source = script.script;
        if (!script.source_loaded && error.payload?.cookie_permissions) {
          try { source = (await request_json("/admin/api/scripts/" + script_id)).script.script; }
          catch (failure) { list_error_.set(failure.message); return; }
        }
        if (!request_cookie_consent(error, source, script_id, load))
          list_error_.set(error.message || String(error));
      }
    },
    async set_script_status(script_id, status) {
      if (status === "published") {
        methods.edit_script(script_id);
        return;
      }
      if (status_pending_.value[script_id]) return;
      const script = scripts_.value.find((item) => item.id === script_id);
      if (!script) return;
      const overwrite_draft = status === "draft" && Boolean(script.draft);
      status_pending_.as({ ...status_pending_.value, [script_id]: true });
      list_error_.set("");
      try {
        const result = await request_json(
          "/admin/api/scripts/" + script_id,
          {
            method: "PATCH",
            body: JSON.stringify({
              status,
              cookie_grant_id: script.cookie_grant_id || "",
              ...(overwrite_draft ? { overwrite_draft: true } : {}),
            }),
          },
        );
        const updated = normalize_script(result.script);
        scripts_.as(
          scripts_.value.map((item) =>
            item.id === script_id ? updated : item,
          ),
        );
        await load();
        form_message_.set(
          `脚本 ${updated.name} 已${updated.status === "draft" ? "退回草稿，路由停止服务" : "发布为正式"}。`,
        );
      } catch (error) {
        const script = scripts_.value.find((item) => item.id === script_id);
        if (
          !script ||
          !request_cookie_consent(error, script.script, script_id, () =>
            methods.set_script_status(script_id, status),
          )
        )
          list_error_.set(error.message || String(error));
      } finally {
        const { [script_id]: finished, ...pending } = status_pending_.value;
        status_pending_.as(pending);
      }
    },
    async set_script_enabled(script_id, enabled) {
      if (enabled_pending_.value[script_id] !== undefined) return;
      enabled_pending_.as({ ...enabled_pending_.value, [script_id]: enabled });
      list_error_.set("");
      try {
        const result = await request_json(
          "/admin/api/scripts/" + script_id,
          {
            method: "PATCH",
            body: JSON.stringify({ enabled }),
          },
        );
        const updated = normalize_script(result.script);
        scripts_.as(
          scripts_.value.map((item) =>
            item.id === script_id ? updated : item,
          ),
        );
        await load();
        form_message_.set(
          updated.name + (updated.enabled ? " 已启用。" : " 已停用。"),
        );
      } catch (error) {
        list_error_.set(error.message || String(error));
      } finally {
        const { [script_id]: finished, ...pending } = enabled_pending_.value;
        enabled_pending_.as(pending);
      }
    },
    async remove_script(script_id) {
      const script = scripts_.value.find((item) => item.id === script_id);
      if (!script) return;
      try {
        await request_json("/admin/api/scripts/" + script_id, {
          method: "DELETE",
        });
        scripts_.as(scripts_.value.filter((item) => item.id !== script_id));
        if (editing_id_.value === script_id) methods.reset_draft();
        // 日志随脚本一并删除，同步关闭日志弹窗。
        if (script_logs_route_.value === script_id) reset_script_logs();
        form_message_.set("脚本 " + script.name + " 已删除。");
        await load();
      } catch (error) {
        list_error_.set(error instanceof Error ? error.message : String(error));
      }
    },

  };

  agent = ScriptAgentModel({
    ui: Timeless,
    request_json,
    get_context() {
      if (debug_timer !== null) clearTimeout(debug_timer);
      debug_timer = null;
      return {
        ready:
          !saving_.value &&
          !debugging_.value &&
          form_open_.value,
        script: draft_script_.value,
        version: draft_version_.value.trim(),
        cookie_grant_id,
        revision: draft_revision,
        request_url: debug_url_.value,
        route: editing_id_.value,
      };
    },
    apply_script(event) {
      if (!form_open_.value || event.expected_revision !== draft_revision)
        return false;
      draft_script_.set(event.script);
      draft_revision = event.revision;
      schedule_debug_routes();
      mark_debug_results_stale();
      schedule_debug();
      return true;
    },
    apply_debug(event) {
      if (
        !form_open_.value ||
        event.revision !== draft_revision ||
        event.request_url !== debug_url_.value
      )
        return;
      debug_generation++;
      debug_armed = true;
      debug_result_.as({
        status: event.result.status,
        rss_debug: event.result.rss_debug,
        error: "",
        stale: false,
      });
    },
    on_finish() {
      if (debug_result_.value.stale) schedule_debug();
    },
  });

  const pagination = ListPaginationModel(Timeless, {
    fetch, url: "/admin/api/scripts", key: "scripts", normalize: normalize_script,
    loading: loading_, error: list_error_,
    filters: () => ({ q: query_.value.trim(), kind: script_type_.value, status: filter_status_.value }),
    on_data(scripts) { scripts_.as(scripts); },
  });
  const visible_scripts = scripts_;
  const config = ScriptConfigModel({ save: async (id, value) => {
    await request_json("/admin/api/scripts/" + encodeURIComponent(id), {
      method: "PATCH", body: JSON.stringify({ config: value }),
    });
    await load();
  } });
  const paged_scripts = scripts_;
  return { state, methods, visible_scripts, paged_scripts, pagination, agent, config };
}

export { normalize_script, normalize_log_lines, ScriptViewModel };
