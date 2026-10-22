import { format_datetime as format_time } from "../../server/lib/datetime.js";
import { ListPaginationModel, PaginationModel } from "../components/pagination.js";
const Timeless = window.FindRSSAdminUI;
const fetch = window.FindRSSAdminAuth.fetch;
const { combine, computed, ref, refarr, refobj } = Timeless;

function empty_metrics() {
  return {
    device_count: 0,
    online_count: 0,
    offline_count: 0,
    task_count: 0,
    token_count: 0,
    source_count: 0,
    script_count: 0,
    source_call_count: 0,
    cookie_count: 0,
    route_count: 0,
    platform_count: 0,
    tag_count: 0,
  };
}

function DashboardViewModel(page_id = "overview") {
  const is_overview = page_id === "overview";
  const is_token_page = page_id === "tokens";
  const loading_ = ref(false);
  const error_ = ref("");
  const devices_ = refarr([]);
  const download_devices_ = refarr([]);
  const task_counts_ = refarr([]);
  const available_methods_ = refarr([]);
  const metrics_ = refobj(empty_metrics());
  const source_calls_ = refarr([]);
  const source_calls_pagination = PaginationModel(Timeless, {
    total: computed(source_calls_, sources => sources.length), loading: loading_,
  });
  const paged_source_calls = combine({ sources: source_calls_, page: source_calls_pagination.state },
    ({ sources, page }) => sources.slice(page.page * page.page_size, (page.page + 1) * page.page_size));
  const generated_at_ = ref(0);
  const refreshed_at_ = ref(0);
  const access_tokens_ = refarr([]);
  const access_token_form_open_ = ref(false);
  const access_token_draft_ = refobj({
    name: "",
    token: "",
    email: "",
    password: "",
    expires_in_seconds: "604800",
    credits: "0",
  });
  const access_token_action_ = refobj({
    creating: false,
    busy_id: "",
    busy_action: "",
    created_token: "",
    created_token_name: "",
    copy_message: "",
    error: "",
  });
  const access_token_logs_ = refarr([]);
  const access_token_log_state_ = refobj({
    id: "", name: "", open: false, loading: false, loading_more: false,
    next_cursor: "", error: "",
  });
  let access_token_log_generation = 0;
  const device_logs_ = refarr([]);
  const device_log_state_ = refobj({
    device_id: "",
    device_name: "",
    device_os: "unknown",
    category: "",
    loading: false,
    loading_more: false,
    error: "",
    has_more: false,
    refreshed_at: 0,
    retention_milliseconds: 0,
  });
  const device_log_drawer$ = new vm.DialogCore({
    title: "设备日志",
    closeable: true,
    footer: false,
  });
  const confirm_state_ = refobj({
    title: "",
    message: "",
    confirm_label: "确认",
    cancel_label: "取消",
    danger: false,
  });
  const confirm_dialog$ = new vm.DialogCore({
    title: "请确认",
    closeable: true,
    footer: false,
  });
  let confirm_resolver = null;
  const test_drafts_ = refobj({});
  const download_drafts_ = refobj({});
  const tests_ = refobj({});
  const device_reset_actions_ = refobj({});
  const device_actions_ = refobj({});
  const device_sources = new Map();
  const access_token_sources = new Map();
  const task_refreshes = new Map();
  const task_read_versions = new Map();
  let refresh_promise = null;
  let stop_realtime = null;
  let stop_log_realtime = null;
  let refresh_pending = false;
  let device_log_pending = false;
  let lifecycle_generation = 0;
  let started = false;

  function normalize_access_token(access_token) {
    return {
      id: String(access_token.id || ""),
      name: String(access_token.name || "未填写用途或使用人"),
      email: String(access_token.email || ""),
      token_hint: String(access_token.token_hint || ""),
      status: access_token.status === "expired" ? "expired" : "active",
      expires_at: Number(access_token.expires_at || 0),
      created_at: Number(access_token.created_at || 0),
      last_used_at: Number(access_token.last_used_at || 0),
      credit_balance: Number(access_token.credit_balance || 0),
      total_credits_granted: Number(access_token.total_credits_granted || 0),
      total_credits_used: Number(access_token.total_credits_used || 0),
    };
  }

  function normalize_overview(overview) {
    const devices = overview.devices.map((device) => {
      const methods_source = Array.isArray(device.methods)
        ? device.methods
        : Array.isArray(device.capabilities)
          ? device.capabilities
          : [];
      const methods = methods_source.map(String);
      const status = ["online", "busy", "offline", "disabled"].includes(
        device.status,
      )
        ? device.status
        : "offline";
      const disabled = status === "disabled" || device.disabled === true;
      return {
        device_id: String(device.device_id || ""),
        device_name: String(
          device.device_name || device.device_id || "未命名设备",
        ),
        device_os: String(device.device_os || "unknown"),
        methods,
        connected_at: Number(device.connected_at || 0),
        last_seen_at: Number(device.last_seen_at || 0),
        disconnected_at: Number(device.disconnected_at || 0),
        active_tasks: Math.max(0, Number(device.active_tasks || 0)),
        max_concurrency: Math.max(1, Number(device.max_concurrency || 1)),
        status: disabled ? "disabled" : status,
        disabled,
        can_test:
          !disabled &&
          status !== "offline" &&
          methods.includes("wxchannels.fetch"),
      };
    });
    const task_counts = Array.isArray(overview.task_counts)
      ? overview.task_counts
      : [];
    const methods_source = Array.isArray(overview.methods)
      ? overview.methods
      : Array.isArray(overview.capabilities)
        ? overview.capabilities
        : [];
    const methods = methods_source.map(String);
    const online_count = devices.filter(
      (device) => device.status === "online" || device.status === "busy",
    ).length;
    const offline_count = devices.filter(
      (device) => device.status === "offline" || device.status === "disabled",
    ).length;
    const task_count = task_counts.reduce(
      (total, item) => total + Number(item.count || 0),
      0,
    );
    const access_tokens = Array.isArray(overview.access_tokens)
      ? overview.access_tokens.map(normalize_access_token)
      : [];
    return Object.assign({}, overview, {
      devices,
      download_devices: devices.filter(
        (device) =>
          (device.status === "online" || device.status === "busy") &&
          device.methods.includes("download.create"),
      ),
      task_counts,
      methods,
      access_tokens,
      metrics: {
        device_count: devices.length,
        online_count,
        offline_count,
        task_count,
      },
    });
  }

  function set_access_token_draft(field, value) {
    access_token_draft_.as(
      Object.assign({}, access_token_draft_.value, { [field]: value }),
    );
  }

  function set_access_token_action(next_action) {
    access_token_action_.as(
      Object.assign({}, access_token_action_.value, next_action),
    );
  }

  function normalize_device_log(log) {
    return {
      id: Number(log.id || 0),
      device_id: String(log.device_id || ""),
      connection_id: String(log.connection_id || ""),
      category: String(log.category || "system"),
      event_type: String(log.event_type || "system.event"),
      direction: String(log.direction || "internal"),
      level: ["info", "warn", "error"].includes(log.level) ? log.level : "info",
      task_id: String(log.task_id || ""),
      method: String(log.method || ""),
      message: String(log.message || "设备事件"),
      metadata:
        log.metadata && typeof log.metadata === "object" ? log.metadata : {},
      created_at: Number(log.created_at || 0),
    };
  }

  function set_device_log_state(next_state) {
    device_log_state_.as(
      Object.assign({}, device_log_state_.value, next_state),
    );
  }

  function stop_device_log_refresh() {
    stop_log_realtime?.(); stop_log_realtime = null;
    device_log_pending = false;
  }

  function start_device_log_refresh() {
    stop_device_log_refresh();
    stop_log_realtime = window.FindRSSAdminRealtime?.subscribe("device.logs", event => {
      if ((event.type === "realtime.connected" && event.reconnected)
        || (event.type === "device.logs" && (!event.ids?.length || event.ids.includes(device_log_state_.value.device_id)))) {
        void refresh_device_logs(true);
      }
    });
  }

  async function refresh_device_logs(merge = false) {
    const current_state = device_log_state_.value;
    const device_id = current_state.device_id;
    const category = current_state.category;
    if (device_id === "") return;
    if (current_state.loading || current_state.loading_more) { device_log_pending = true; return; }
    set_device_log_state({ loading: true, error: "" });
    const query = new URLSearchParams({ limit: "100" });
    if (category !== "") query.set("category", category);
    try {
      const response = await fetch(
        "/admin/api/devices/" +
          encodeURIComponent(device_id) +
          "/logs?" +
          query.toString(),
        { credentials: "same-origin", cache: "no-store" },
      );
      const value = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          value.error || "加载设备日志失败：HTTP " + response.status,
        );
      }
      if (!Array.isArray(value.logs)) {
        throw new Error("设备日志接口返回格式不正确");
      }
      if (
        device_log_state_.value.device_id !== device_id ||
        device_log_state_.value.category !== category
      ) {
        return;
      }
      const incoming_logs = value.logs.map(normalize_device_log);
      if (merge && device_logs_.value.length > 0) {
        const logs_by_id = new Map(
          device_logs_.value.map((log) => [Number(log.id), log]),
        );
        for (const log of incoming_logs) logs_by_id.set(log.id, log);
        device_logs_.assign(
          [...logs_by_id.values()].sort((left, right) => right.id - left.id),
        );
      } else {
        device_logs_.assign(incoming_logs);
      }
      set_device_log_state({
        device_name: String(
          value.device?.device_name || current_state.device_name,
        ),
        device_os: String(value.device?.device_os || current_state.device_os),
        loading: false,
        error: "",
        has_more: merge
          ? device_log_state_.value.has_more || Boolean(value.has_more)
          : Boolean(value.has_more),
        refreshed_at: Date.now(),
        retention_milliseconds: Number(value.retention_milliseconds || 0),
      });
    } catch (error) {
      if (
        device_log_state_.value.device_id === device_id &&
        device_log_state_.value.category === category
      ) {
        set_device_log_state({
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      if (device_log_pending && stop_log_realtime) {
        device_log_pending = false;
        void refresh_device_logs(true);
      }
    }
  }

  async function load_older_device_logs() {
    const current_state = device_log_state_.value;
    if (
      current_state.device_id === "" ||
      current_state.loading ||
      current_state.loading_more ||
      !current_state.has_more ||
      device_logs_.value.length === 0
    ) {
      return;
    }
    const device_id = current_state.device_id;
    const category = current_state.category;
    const before_id = Math.min(
      ...device_logs_.value.map((log) => Number(log.id)),
    );
    set_device_log_state({ loading_more: true, error: "" });
    const query = new URLSearchParams({
      limit: "100",
      before_id: String(before_id),
    });
    if (category !== "") query.set("category", category);
    try {
      const response = await fetch(
        "/admin/api/devices/" +
          encodeURIComponent(device_id) +
          "/logs?" +
          query.toString(),
        { credentials: "same-origin", cache: "no-store" },
      );
      const value = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          value.error || "加载更早日志失败：HTTP " + response.status,
        );
      }
      if (!Array.isArray(value.logs)) {
        throw new Error("设备日志接口返回格式不正确");
      }
      if (
        device_log_state_.value.device_id !== device_id ||
        device_log_state_.value.category !== category
      ) {
        return;
      }
      const logs_by_id = new Map(
        device_logs_.value.map((log) => [Number(log.id), log]),
      );
      for (const log of value.logs.map(normalize_device_log)) {
        logs_by_id.set(log.id, log);
      }
      device_logs_.assign(
        [...logs_by_id.values()].sort((left, right) => right.id - left.id),
      );
      set_device_log_state({
        loading_more: false,
        has_more: Boolean(value.has_more),
        error: "",
      });
    } catch (error) {
      if (
        device_log_state_.value.device_id === device_id &&
        device_log_state_.value.category === category
      ) {
        set_device_log_state({
          loading_more: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      if (device_log_pending && stop_log_realtime) {
        device_log_pending = false;
        void refresh_device_logs(true);
      }
    }
  }

  function set_device_log_category(category) {
    const normalized_category = [
      "",
      "connection",
      "heartbeat",
      "call",
      "response",
      "system",
    ].includes(category)
      ? category
      : "";
    set_device_log_state({
      category: normalized_category,
      loading: false,
      loading_more: false,
      has_more: false,
      error: "",
    });
    device_logs_.assign([]);
    refresh_device_logs(false);
  }

  function open_device_log_drawer(device_id) {
    const device = devices_.value.find(
      (candidate) => candidate.device_id === device_id,
    );
    if (!device) return;
    stop_device_log_refresh();
    device_logs_.assign([]);
    const category = device_log_state_.value.category;
    device_log_state_.as({
      device_id,
      device_name: device.device_name,
      device_os: device.device_os,
      category,
      loading: false,
      loading_more: false,
      error: "",
      has_more: false,
      refreshed_at: 0,
      retention_milliseconds: 0,
    });
    device_log_drawer$.setTitle("设备日志 · " + device.device_name);
    device_log_drawer$.show();
    refresh_device_logs(false);
    start_device_log_refresh();
  }

  const device_log_drawer_unlisten = device_log_drawer$.onHidden(() => {
    stop_device_log_refresh();
  });

  function settle_confirm(result) {
    if (confirm_resolver === null) return;
    const resolve = confirm_resolver;
    confirm_resolver = null;
    confirm_dialog$.hide();
    resolve(result);
  }

  /**
   * @param {{ title?: string, message?: string, confirm_label?: string,
   *           cancel_label?: string, danger?: boolean }} options
   * @returns {Promise<boolean>}
   */
  function request_confirm(options) {
    return new Promise((resolve) => {
      if (confirm_resolver !== null) settle_confirm(false);
      const title = String(options.title || "请确认");
      confirm_state_.as({
        title,
        message: String(options.message || ""),
        confirm_label: String(options.confirm_label || "确认"),
        cancel_label: String(options.cancel_label || "取消"),
        danger: options.danger === true,
      });
      confirm_resolver = resolve;
      confirm_dialog$.setTitle(title);
      confirm_dialog$.show();
    });
  }

  confirm_dialog$.onOk(() => settle_confirm(true));
  confirm_dialog$.onCancel(() => settle_confirm(false));
  confirm_dialog$.onHidden(() => settle_confirm(false));

  async function create_access_token() {
    if (access_token_action_.value.creating) return;
    const draft = access_token_draft_.value;
    const name = String(draft.name || "").trim();
    const token = String(draft.token || "").trim();
    const email = String(draft.email || "")
      .trim()
      .toLowerCase();
    const password = String(draft.password || "");
    if (
      token !== "" &&
      (token.length < 16 ||
        token.length > 256 ||
        !/^[A-Za-z0-9._~+/=-]+$/.test(token))
    ) {
      set_access_token_action({
        error:
          "自定义 Token 必须为 16–256 位，只能包含字母、数字和 . _ ~ + / = -",
      });
      return;
    }
    if ((email === "") !== (password === "")) {
      set_access_token_action({ error: "邮箱和密码需要同时填写，或同时留空" });
      return;
    }
    if (email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      set_access_token_action({ error: "请输入合法的邮箱地址" });
      return;
    }
    if (password !== "" && (password.length < 8 || password.length > 128)) {
      set_access_token_action({ error: "密码长度必须为 8–128 个字符" });
      return;
    }
    const expires_value = String(draft.expires_in_seconds || "");
    const credits = Number(draft.credits || 0);
    if (!Number.isInteger(credits) || credits < 0 || credits > 1000000000) {
      set_access_token_action({
        error: "初始积分必须是 0–1000000000 之间的整数",
      });
      return;
    }
    set_access_token_action({
      creating: true,
      copy_message: "",
      error: "",
    });
    try {
      const response = await fetch("/admin/api/access-tokens", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          token: token || null,
          email,
          password,
          expires_in_seconds:
            expires_value === "" ? null : Number(expires_value),
          credits,
        }),
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          value.error || "创建用户 Token 失败：HTTP " + response.status,
        );
      }
      if (!value.access_token || !value.token) {
        throw new Error("创建用户 Token 的返回格式不正确");
      }
      const normalized_access_token = normalize_access_token(
        value.access_token,
      );
      sync_access_tokens([
        normalized_access_token,
        ...access_tokens_.value.filter(
          (access_token) => access_token.id !== normalized_access_token.id,
        ),
      ]);
      access_token_draft_.as({
        name: "",
        token: "",
        email: "",
        password: "",
        expires_in_seconds: expires_value,
        credits: String(credits),
      });
      set_access_token_action({
        creating: false,
        created_token: String(value.token),
        created_token_name: name || "未填写用途或使用人",
        copy_message: "",
        error: "",
      });
      access_token_form_open_.as(false);
      if (is_token_page) await token_pagination.load(0);
      else refresh(false);
    } catch (error) {
      set_access_token_action({
        creating: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function close_access_token_logs() {
    access_token_log_generation += 1;
    access_token_logs_.assign([]);
    access_token_log_state_.as({
      id: "", name: "", open: false, loading: false, loading_more: false,
      next_cursor: "", error: "",
    });
  }

  async function load_access_token_logs(more = false) {
    const state = access_token_log_state_.value;
    if (!state.open || state.loading || state.loading_more || (more && !state.next_cursor)) return;
    const generation = ++access_token_log_generation;
    access_token_log_state_.as({ ...state, loading: !more, loading_more: more, error: "" });
    const params = new URLSearchParams({ access_token_id: state.id, limit: "50" });
    if (more) params.set("cursor", state.next_cursor);
    try {
      const response = await fetch("/admin/api/credit-transactions?" + params, { cache: "no-store" });
      const value = await response.json();
      if (generation !== access_token_log_generation) return;
      if (!response.ok) throw new Error(value.error || "加载积分日志失败：HTTP " + response.status);
      if (!Array.isArray(value.credit_transactions)) throw new Error("积分日志接口返回格式不正确");
      access_token_logs_.assign(more
        ? [...access_token_logs_.value, ...value.credit_transactions]
        : value.credit_transactions);
      access_token_log_state_.as({ ...access_token_log_state_.value, next_cursor: value.next_cursor || "" });
    } catch (failure) {
      if (generation === access_token_log_generation) {
        access_token_log_state_.as({ ...access_token_log_state_.value, error: failure.message || String(failure) });
      }
    } finally {
      if (generation === access_token_log_generation) {
        access_token_log_state_.as({ ...access_token_log_state_.value, loading: false, loading_more: false });
      }
    }
  }

  function open_access_token_logs(access_token_id) {
    const token = access_tokens_.value.find(candidate => candidate.id === access_token_id);
    if (!token) return;
    close_access_token_logs();
    access_token_log_state_.as({ ...access_token_log_state_.value, id: token.id, name: token.name, open: true });
    return load_access_token_logs();
  }

  async function expire_access_token(access_token_id) {
    const access_token = access_tokens_.value.find(
      (candidate) => candidate.id === access_token_id,
    );
    if (!access_token || access_token.status === "expired") return;
    const confirmed = await request_confirm({
      title: "让用户 Token 过期",
      message: "立即让用户 Token“" + access_token.name + "”过期？",
      confirm_label: "让 Token 过期",
    });
    if (!confirmed) return;
    set_access_token_action({
      busy_id: access_token_id,
      busy_action: "expire",
      error: "",
    });
    try {
      const response = await fetch(
        "/admin/api/access-tokens/" +
          encodeURIComponent(access_token_id) +
          "/expire",
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      const value = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          value.error || "设置 Token 过期失败：HTTP " + response.status,
        );
      }
      sync_access_tokens(
        access_tokens_.value.map((candidate) =>
          candidate.id === access_token_id
            ? normalize_access_token(value.access_token)
            : candidate,
        ),
      );
      set_access_token_action({ busy_id: "", busy_action: "", error: "" });
    } catch (error) {
      set_access_token_action({
        busy_id: "",
        busy_action: "",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function grant_access_token_credits(access_token_id) {
    const access_token = access_tokens_.value.find(
      (candidate) => candidate.id === access_token_id,
    );
    if (!access_token) return;
    const requested_amount = window.prompt(
      "为用户 Token“" + access_token.name + "”充值多少积分？",
      "100",
    );
    if (requested_amount === null) return;
    const amount = Number(requested_amount.trim());
    if (!Number.isInteger(amount) || amount <= 0 || amount > 10000000) {
      set_access_token_action({
        error: "单次充值积分必须是 1–10000000 之间的整数",
      });
      return;
    }
    set_access_token_action({
      busy_id: access_token_id,
      busy_action: "credits",
      error: "",
    });
    try {
      const response = await fetch(
        "/admin/api/access-tokens/" +
          encodeURIComponent(access_token_id) +
          "/credits",
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount,
            reason: "admin console credit grant",
          }),
        },
      );
      const value = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(value.error || "充值积分失败：HTTP " + response.status);
      }
      sync_access_tokens(
        access_tokens_.value.map((candidate) =>
          candidate.id === access_token_id
            ? normalize_access_token(value.access_token)
            : candidate,
        ),
      );
      set_access_token_action({ busy_id: "", busy_action: "", error: "" });
    } catch (error) {
      set_access_token_action({
        busy_id: "",
        busy_action: "",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function remove_access_token(access_token_id) {
    const access_token = access_tokens_.value.find(
      (candidate) => candidate.id === access_token_id,
    );
    if (!access_token) return;
    if (access_token_action_.value.busy_id) return;
    set_access_token_action({
      busy_id: access_token_id,
      busy_action: "remove",
      error: "",
    });
    try {
      const response = await fetch(
        "/admin/api/access-tokens/" + encodeURIComponent(access_token_id),
        {
          method: "DELETE",
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      const value = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          value.error || "移除用户 Token 失败：HTTP " + response.status,
        );
      }
      sync_access_tokens(
        access_tokens_.value.filter(
          (candidate) => candidate.id !== access_token_id,
        ),
      );
      if (is_token_page) await token_pagination.load();
      set_access_token_action({ busy_id: "", busy_action: "", error: "" });
    } catch (error) {
      set_access_token_action({
        busy_id: "",
        busy_action: "",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function copy_created_access_token() {
    const token = access_token_action_.value.created_token;
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      set_access_token_action({ copy_message: "已复制到剪贴板", error: "" });
    } catch (error) {
      set_access_token_action({
        copy_message: "",
        error:
          "复制失败，请手动选择 Token：" +
          (error instanceof Error ? error.message : String(error)),
      });
    }
  }

  function dismiss_created_access_token() {
    set_access_token_action({
      created_token: "",
      created_token_name: "",
      copy_message: "",
    });
  }

  function reconcile_test_drafts(devices) {
    const test_drafts = Object.assign({}, test_drafts_.value);
    for (const device of devices) {
      const current = test_drafts[device.device_id] || { url: "" };
      test_drafts[device.device_id] = { url: current.url || "" };
    }
    return test_drafts;
  }

  function reconcile_download_drafts(devices, download_devices) {
    const download_drafts = Object.assign({}, download_drafts_.value);
    for (const device of devices) {
      const current = download_drafts[device.device_id] || {
        target_device_id: "",
        download_dir: "",
        filename: "",
      };
      const target_exists = download_devices.some(
        (download_device) =>
          download_device.device_id === current.target_device_id,
      );
      download_drafts[device.device_id] = {
        target_device_id: target_exists
          ? current.target_device_id
          : download_devices[0]
            ? download_devices[0].device_id
            : "",
        download_dir: current.download_dir || "",
        filename: current.filename || "",
      };
    }
    return download_drafts;
  }

  function sync_devices(devices) {
    const active_device_ids = new Set();
    for (const device of devices) {
      const device_id = String(device.device_id);
      active_device_ids.add(device_id);
      const device_ = device_sources.get(device_id);
      if (device_) device_.as(device);
    }
    devices_.assign(devices);
    for (const [device_id, device_] of device_sources) {
      if (active_device_ids.has(device_id)) continue;
      device_sources.delete(device_id);
      device_.destroy();
    }
  }

  function sync_access_tokens(access_tokens) {
    const active_access_token_ids = new Set();
    for (const access_token of access_tokens) {
      const access_token_id = String(access_token.id);
      active_access_token_ids.add(access_token_id);
      const access_token_ = access_token_sources.get(access_token_id);
      if (access_token_) access_token_.as(access_token);
    }
    access_tokens_.assign(access_tokens);
    for (const [access_token_id, access_token_] of access_token_sources) {
      if (active_access_token_ids.has(access_token_id)) continue;
      access_token_sources.delete(access_token_id);
      access_token_.destroy();
    }
  }

  function device_source(device_id, index) {
    const current_device_ = device_sources.get(device_id);
    if (current_device_) return current_device_;
    const device_ = devices_.get(index);
    device_sources.set(device_id, device_);
    return device_;
  }

  function access_token_source(access_token_id, index) {
    const current_access_token_ = access_token_sources.get(access_token_id);
    if (current_access_token_) return current_access_token_;
    const access_token_ = access_tokens_.get(index);
    access_token_sources.set(access_token_id, access_token_);
    return access_token_;
  }

  function set_test_draft(device_id, field, value) {
    const current = test_drafts_.value[device_id] || { url: "" };
    test_drafts_.as(
      Object.assign({}, test_drafts_.value, {
        [device_id]: Object.assign({}, current, { [field]: value }),
      }),
    );
  }

  function set_download_draft(device_id, field, value) {
    const current = download_drafts_.value[device_id] || {
      target_device_id: "",
      download_dir: "",
      filename: "",
    };
    download_drafts_.as(
      Object.assign({}, download_drafts_.value, {
        [device_id]: Object.assign({}, current, { [field]: value }),
      }),
    );
  }

  function set_device_test(device_id, next_test) {
    const current = tests_.value[device_id] || {};
    tests_.as(
      Object.assign({}, tests_.value, {
        [device_id]: Object.assign({}, current, next_test),
      }),
    );
  }

  function set_device_reset_action(device_id, next_action) {
    device_reset_actions_.as(
      Object.assign({}, device_reset_actions_.value, {
        [device_id]: Object.assign(
          {},
          device_reset_actions_.value[device_id] || {},
          next_action,
        ),
      }),
    );
  }

  function set_device_action(device_id, next_action) {
    device_actions_.as(
      Object.assign({}, device_actions_.value, {
        [device_id]: Object.assign(
          {},
          device_actions_.value[device_id] || {},
          next_action,
        ),
      }),
    );
  }

  async function reset_device(device_id) {
    const device = devices_.value.find(
      (candidate) => candidate.device_id === device_id,
    );
    if (!device || device.status !== "busy") return;
    const confirmed = await request_confirm({
      title: "强制重置设备",
      message:
        "强制重置设备“" +
        device.device_name +
        "”？当前未完成调用会被标记为失败。",
      confirm_label: "强制重置",
    });
    if (!confirmed) return;
    set_device_reset_action(device_id, { submitting: true, error: "" });
    try {
      const response = await fetch(
        "/admin/api/devices/" + encodeURIComponent(device_id) + "/reset",
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      const value = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          value.error || "强制重置设备失败：HTTP " + response.status,
        );
      }
      set_device_reset_action(device_id, { submitting: false, error: "" });
      await refresh(false);
    } catch (error) {
      set_device_reset_action(device_id, {
        submitting: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function toggle_device_disabled(device_id) {
    const device = devices_.value.find(
      (candidate) => candidate.device_id === device_id,
    );
    if (!device) return;
    const disabling = !device.disabled;
    const confirmed = await request_confirm({
      title: disabling ? "禁用设备" : "解除设备禁用",
      message: disabling
        ? "禁用设备“" +
          device.device_name +
          "”？会断开其连接并终止未完成的调用，设备将无法重新连接。"
        : "解除设备“" + device.device_name + "”的禁用？设备可重新连接。",
      confirm_label: disabling ? "禁用" : "解除禁用",
      danger: disabling,
    });
    if (!confirmed) return;
    set_device_action(device_id, { toggling: true, error: "" });
    try {
      const response = await fetch(
        "/admin/api/devices/" + encodeURIComponent(device_id) + "/disable",
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ disabled: disabling }),
        },
      );
      const value = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          value.error || "更新设备禁用状态失败：HTTP " + response.status,
        );
      }
      set_device_action(device_id, { toggling: false, error: "" });
      await refresh(false);
    } catch (error) {
      set_device_action(device_id, {
        toggling: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function delete_device(device_id) {
    const device = devices_.value.find(
      (candidate) => candidate.device_id === device_id,
    );
    if (!device) return;
    const action = device_actions_.value[device_id];
    if (action?.deleting || action?.toggling) return;
    set_device_action(device_id, { deleting: true, error: "" });
    try {
      const response = await fetch(
        "/admin/api/devices/" + encodeURIComponent(device_id),
        {
          method: "DELETE",
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      const value = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(value.error || "删除设备失败：HTTP " + response.status);
      }
      set_device_action(device_id, { deleting: false, error: "" });
      await refresh(false);
    } catch (error) {
      set_device_action(device_id, {
        deleting: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function run_test(device_id) {
    const draft = test_drafts_.value[device_id] || { url: "" };
    if (!draft.url.trim()) {
      set_device_test(device_id, {
        submitting: false,
        task: null,
        error: "请填写视频号 URL",
      });
      return;
    }
    set_device_test(device_id, {
      submitting: true,
      task: null,
      download: null,
      error: "",
    });
    try {
      const response = await fetch("/admin/api/call", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_device_id: device_id,
          method: "wxchannels.fetch",
          args: { url: draft.url.trim() },
        }),
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          value.error || "发起测试调用失败：HTTP " + response.status,
        );
      if (!value.task || !value.task.id)
        throw new Error("测试调用返回格式不正确");
      set_device_test(device_id, {
        submitting: false,
        task: value.task,
        error: "",
      });
      void refresh_test(device_id, value.task.id);
    } catch (error) {
      set_device_test(device_id, {
        submitting: false,
        task: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function refresh_test(device_id, task_id) {
    const current = tests_.value[device_id];
    if (!current || !current.task || current.task.id !== task_id) return;
    if (["completed", "failed"].includes(current.task.status)) return;
    const generation = lifecycle_generation;
    const read_key = "test:" + device_id;
    const version = (task_read_versions.get(read_key) || 0) + 1;
    task_read_versions.set(read_key, version);
    try {
      const response = await fetch(
        "/admin/api/tasks/" + encodeURIComponent(task_id),
        { credentials: "same-origin", cache: "no-store" },
      );
      const value = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          value.error || "查询测试调用失败：HTTP " + response.status,
        );
      if (!value.task || value.task.id !== task_id)
        throw new Error("测试调用查询返回格式不正确");
      if (generation !== lifecycle_generation || task_read_versions.get(read_key) !== version || tests_.value[device_id]?.task?.id !== task_id) return;
      set_device_test(device_id, {
        submitting: false,
        task: value.task,
        error: "",
      });
    } catch (error) {
      if (generation !== lifecycle_generation || task_read_versions.get(read_key) !== version || tests_.value[device_id]?.task?.id !== task_id) return;
      set_device_test(device_id, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function set_download_test(device_id, next_download) {
    const current_test = tests_.value[device_id] || {};
    const current_download = current_test.download || {};
    set_device_test(device_id, {
      download: Object.assign({}, current_download, next_download),
    });
  }

  async function run_download_test(device_id) {
    const current_test = tests_.value[device_id];
    const source_task = current_test && current_test.task;
    const draft = download_drafts_.value[device_id] || {
      target_device_id: "",
      download_dir: "",
      filename: "",
    };
    if (!source_task || source_task.status !== "completed") {
      set_download_test(device_id, {
        submitting: false,
        task: null,
        error: "视频号内容调用尚未完成",
      });
      return;
    }
    if (!draft.target_device_id) {
      set_download_test(device_id, {
        submitting: false,
        task: null,
        error: "请选择支持 download.create 的在线设备",
      });
      return;
    }
    set_download_test(device_id, { submitting: true, task: null, error: "" });
    try {
      const response = await fetch("/admin/api/call", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_device_id: draft.target_device_id,
          method: "download.create",
          args: {
            request: {
              platform: "wxchannels",
              content: source_task.result,
              build_from_fetch: true,
              download_dir: draft.download_dir.trim(),
              filename: draft.filename.trim(),
              config: {},
              auto_start: true,
            },
          },
        }),
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          value.error || "创建下载任务失败：HTTP " + response.status,
        );
      if (!value.task || !value.task.id)
        throw new Error("创建下载任务返回格式不正确");
      set_download_test(device_id, {
        submitting: false,
        task: value.task,
        error: "",
      });
      void refresh_download_test(device_id, value.task.id);
    } catch (error) {
      set_download_test(device_id, {
        submitting: false,
        task: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function refresh_download_test(device_id, task_id) {
    const current = tests_.value[device_id];
    const download = current && current.download;
    if (!download || !download.task || download.task.id !== task_id) return;
    if (["completed", "failed"].includes(download.task.status)) return;
    const generation = lifecycle_generation;
    const read_key = "download:" + device_id;
    const version = (task_read_versions.get(read_key) || 0) + 1;
    task_read_versions.set(read_key, version);
    try {
      const response = await fetch(
        "/admin/api/tasks/" + encodeURIComponent(task_id),
        { credentials: "same-origin", cache: "no-store" },
      );
      const value = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          value.error || "查询下载任务失败：HTTP " + response.status,
        );
      if (!value.task || value.task.id !== task_id)
        throw new Error("下载任务查询返回格式不正确");
      if (generation !== lifecycle_generation || task_read_versions.get(read_key) !== version || tests_.value[device_id]?.download?.task?.id !== task_id) return;
      set_download_test(device_id, {
        submitting: false,
        task: value.task,
        error: "",
      });
    } catch (error) {
      if (generation !== lifecycle_generation || task_read_versions.get(read_key) !== version || tests_.value[device_id]?.download?.task?.id !== task_id) return;
      set_download_test(device_id, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function refresh(show_loading = true) {
    if (is_token_page) return token_pagination.load();
    if (refresh_promise !== null) { refresh_pending = true; return refresh_promise; }
    if (show_loading) loading_.as(true);
    const generation = lifecycle_generation;
    error_.as("");
    refresh_promise = fetch(is_overview ? "/admin/api/overview" : "/admin/api/management-overview", {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        const overview = await response.json();
        if (generation !== lifecycle_generation) return;
        if (!response.ok) throw new Error(overview?.error || "加载失败：HTTP " + response.status);
        if (!overview || (is_overview ? !overview.statistics : !Array.isArray(overview.devices)))
          throw new Error("管理接口返回格式不正确");
        const normalized_overview = normalize_overview({ ...overview, devices: overview.devices || [] });
        test_drafts_.as(reconcile_test_drafts(normalized_overview.devices));
        download_drafts_.as(
          reconcile_download_drafts(
            normalized_overview.devices,
            normalized_overview.download_devices,
          ),
        );
        metrics_.as(
          Object.assign(
            {},
            empty_metrics(),
            normalized_overview.metrics,
            normalized_overview.statistics,
            is_overview ? {} : { token_count: normalized_overview.access_tokens.length },
          ),
        );
        source_calls_.assign(normalized_overview.statistics?.sources || []);
        source_calls_pagination.page.set(source_calls_pagination.state.value.page);
        download_devices_.assign(normalized_overview.download_devices);
        task_counts_.assign(normalized_overview.task_counts);
        available_methods_.assign(normalized_overview.methods);
        sync_access_tokens(normalized_overview.access_tokens);
        generated_at_.as(normalized_overview.generated_at || 0);
        sync_devices(normalized_overview.devices);
        refreshed_at_.as(Date.now());
        error_.as("");
      })
      .catch((error) => {
        error_.as(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (show_loading) loading_.as(false);
        refresh_promise = null;
        if (refresh_pending && started) { refresh_pending = false; void refresh(false); }
      });
    return refresh_promise;
  }

  function ready() {
    if (started) return;
    started = true;
    refresh();
    stop_realtime = window.FindRSSAdminRealtime?.subscribe(
      is_overview ? ["overview.changed"] : is_token_page ? ["tokens.changed"] : ["devices.changed", "tasks.changed"],
      event => {
        if (!started || event.type === "realtime.disconnected" || (event.type === "realtime.connected" && !event.reconnected)) return;
        if (event.type !== "tasks.changed") void refresh(false);
        if (event.type === "tasks.changed" || event.type === "realtime.connected") {
          for (const [device_id, test] of Object.entries(tests_.value)) {
            for (const [kind, task] of [["test", test.task], ["download", test.download?.task]]) {
              if (!task || ["completed", "failed"].includes(task.status) || (event.ids?.length && !event.ids.includes(task.id))) continue;
              const key = kind + ":" + device_id;
              if (task_refreshes.has(key)) { task_refreshes.get(key).pending = true; continue; }
              const state = { pending: false }; task_refreshes.set(key, state);
              const run = async () => {
                do {
                  state.pending = false;
                  await (kind === "test" ? refresh_test(device_id, task.id) : refresh_download_test(device_id, task.id));
                } while (state.pending && started);
                task_refreshes.delete(key);
              };
              void run();
            }
          }
        }
      });
  }

  function pause() {
    lifecycle_generation++;
    started = false;
    device_log_drawer$.hide();
    stop_realtime?.(); stop_realtime = null;
    stop_device_log_refresh();
    close_access_token_logs();
  }

  function dispose() {
    lifecycle_generation++;
    close_access_token_logs();
    token_pagination?.destroy();
    started = false;
    stop_realtime?.(); stop_realtime = null;
    refresh_pending = false;
    task_refreshes.clear();
    task_read_versions.clear();
    stop_device_log_refresh();
    if (typeof device_log_drawer_unlisten === "function") {
      device_log_drawer_unlisten();
    }
    settle_confirm(false);
    device_log_drawer$.destroy();
    confirm_dialog$.destroy();
  }

  const refresh_status_ = combine(
    { loading: loading_, refreshedAt: refreshed_at_, generated_at: generated_at_ },
    ({ loading, refreshedAt, generated_at }) =>
      loading
        ? "正在刷新…"
        : is_overview
          ? (generated_at ? "快照生成于 " + format_time(generated_at) : "等待快照生成")
          : refreshedAt
            ? "更新于 " + format_time(refreshedAt)
            : "等待刷新",
  );

  const state = {
    loading: loading_,
    error: error_,
    devices: devices_,
    download_devices: download_devices_,
    task_counts: task_counts_,
    available_methods: available_methods_,
    metrics: metrics_,
    source_calls: source_calls_,
    generated_at: generated_at_,
    refreshed_at: refreshed_at_,
    refresh_status: refresh_status_,
    access_tokens: access_tokens_,
    access_token_form_open: access_token_form_open_,
    access_token_draft: access_token_draft_,
    access_token_action: access_token_action_,
    access_token_logs: access_token_logs_,
    access_token_log_state: access_token_log_state_,
    device_logs: device_logs_,
    device_log_state: device_log_state_,
    test_drafts: test_drafts_,
    download_drafts: download_drafts_,
    tests: tests_,
    device_reset_actions: device_reset_actions_,
    device_actions: device_actions_,
    confirm: confirm_state_,
  };

  const methods = {
    ready,
    dispose,
    pause,
    refresh,
    confirm: request_confirm,
    acceptConfirm() {
      settle_confirm(true);
    },
    cancelConfirm() {
      settle_confirm(false);
    },
    runTest: run_test,
    runDownloadTest: run_download_test,
    resetDevice: reset_device,
    toggleDeviceDisabled: toggle_device_disabled,
    deleteDevice: delete_device,
    setTestDraft: set_test_draft,
    setDownloadDraft: set_download_draft,
    setAccessTokenDraft: set_access_token_draft,
    openAccessTokenForm() {
      set_access_token_action({ error: "" });
      access_token_form_open_.as(true);
    },
    closeAccessTokenForm() {
      if (access_token_action_.value.creating) return;
      access_token_form_open_.as(false);
      set_access_token_action({ error: "" });
    },
    createAccessToken: create_access_token,
    openAccessTokenLogs: open_access_token_logs,
    closeAccessTokenLogs: close_access_token_logs,
    refreshAccessTokenLogs: () => load_access_token_logs(),
    loadMoreAccessTokenLogs: () => load_access_token_logs(true),
    grantAccessTokenCredits: grant_access_token_credits,
    expireAccessToken: expire_access_token,
    removeAccessToken: remove_access_token,
    copyCreatedAccessToken: copy_created_access_token,
    dismissCreatedAccessToken: dismiss_created_access_token,
    openDeviceLogDrawer: open_device_log_drawer,
    refreshDeviceLogs: refresh_device_logs,
    loadOlderDeviceLogs: load_older_device_logs,
    setDeviceLogCategory: set_device_log_category,
    deviceSource: device_source,
    accessTokenSource: access_token_source,
  };

  const ui_stores = {
    device_log_drawer: device_log_drawer$,
    confirm_dialog: confirm_dialog$,
  };

  const token_pagination = is_token_page ? ListPaginationModel(Timeless, {
    fetch, url: "/admin/api/access-tokens", key: "access_tokens", normalize: normalize_access_token,
    loading: loading_, error: error_,
    on_data(tokens) {
      sync_access_tokens(tokens);
      metrics_.as({ ...metrics_.value, token_count: token_pagination.total.value });
      refreshed_at_.as(Date.now());
    },
  }) : null;
  return { state, methods, ui: ui_stores, token_pagination, source_calls_pagination, paged_source_calls };
}

function DeviceTokensModel() {
  const open = ref(false),
    tokens = refarr([]),
    busy = ref(false),
    error = ref("");
  const draft = refobj({ name: "", note: "", expires_in_seconds: "2592000" });
  const revealed = refobj({});
  const created = refobj({ name: "", token: "" });
  const timers = new Map();
  let disclosure_generation = 0;
  async function request(path = "", method = "GET", body) {
    const response = await fetch("/admin/api/device-tokens" + path, {
      method,
      cache: "no-store",
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "设备 Token 操作失败");
    return value;
  }
  async function run(action) {
    if (busy.value) return;
    busy.as(true);
    error.as("");
    try {
      await action();
    } catch (failure) {
      error.as(failure.message || String(failure));
    } finally {
      busy.as(false);
    }
  }
  async function load() {
    tokens.assign((await request()).device_tokens);
  }
  function hide(id) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    const values = { ...revealed.value };
    delete values[id];
    revealed.as(values);
  }
  function conceal() {
    disclosure_generation += 1;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    revealed.as({});
    close_created();
  }
  function close_created() {
    created.as({ name: "", token: "" });
  }
  return {
    open,
    tokens,
    busy,
    error,
    draft,
    revealed,
    created,
    close_created,
    copy_created() {
      return navigator.clipboard.writeText(created.value.token);
    },
    set_draft(field, value) {
      draft.as({ ...draft.value, [field]: value });
    },
    toggle() {
      open.as(!open.value);
      conceal();
      if (open.value) return run(load);
    },
    refresh: () => run(load),
    create: () =>
      run(async () => {
        const generation = disclosure_generation;
        const result = await request("", "POST", {
          ...draft.value,
          expires_in_seconds:
            draft.value.expires_in_seconds === ""
              ? null
              : Number(draft.value.expires_in_seconds),
        });
        draft.as({ ...draft.value, name: "", note: "" });
        try {
          if (open.value && generation === disclosure_generation) {
            const value = await request("/" + result.device_token.id + "/reveal", "POST");
            if (open.value && generation === disclosure_generation) {
              created.as({ name: result.device_token.name, token: value.token });
            }
          }
        } finally {
          await load();
        }
      }),
    reveal(id) {
      if (revealed.value[id]) {
        hide(id);
        return;
      }
      const generation = disclosure_generation;
      return run(async () => {
        const value = await request("/" + id + "/reveal", "POST");
        if (!open.value || generation !== disclosure_generation) return;
        revealed.as({ ...revealed.value, [id]: value.token });
        timers.set(
          id,
          setTimeout(() => hide(id), 30000),
        );
      });
    },
    copy(id) {
      return navigator.clipboard.writeText(revealed.value[id]);
    },
    copy_error(failure) {
      error.as("复制失败：" + (failure.message || String(failure)));
    },
    async revoke(token) {
      return run(async () => {
        await request("/" + token.id + "/revoke", "POST");
        hide(token.id);
        await load();
      });
    },
    edit_note(token) {
      const note = window.prompt("设备 Token 备注（最多 256 字）", token.note);
      if (note === null) return;
      return run(async () => {
        await request("/" + token.id, "PATCH", { note });
        await load();
      });
    },
    dispose: conceal,
  };
}

export { DashboardViewModel, format_time, DeviceTokensModel };
