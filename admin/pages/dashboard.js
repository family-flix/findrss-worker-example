import {
  DashboardViewModel,
  format_time,
  DeviceTokensModel,
} from "./dashboard.model.js";
import { PaginationView } from "../components/pagination.js";

const Timeless = window.FindRSSAdminUI;

if (!Timeless || !Timeless.DOM) {
  throw new Error("FindRSS 管理页无法启动：Timeless 运行时未加载");
}

if (!window.FindRSSAdminAuth) {
  throw new Error("FindRSS 管理页无法启动：认证模块未加载");
}

if (!window.FindRSSAdminShell) {
  throw new Error("FindRSS 管理页无法启动：管理 Shell 未加载");
}
const {
  Button,
  Dialog,
  EmptyCard,
  For,
  Input,
  Icon,
  Popconfirm,
  Select,
  Show,
  View,
  combine,
  computed,
  ref,
  refobj,
} = Timeless;

function format_json(value) {
  try {
    const content = JSON.stringify(value, null, 2);
    return content.length > 50000
      ? content.slice(0, 50000) + "\n… 内容过长，已截断显示"
      : content;
  } catch {
    return String(value);
  }
}

function source_value(value) {
  return value && value.__is_ref ? value.value : value;
}

function device_select_entries(devices, empty_label) {
  const options =
    devices.length === 0
      ? [{ value: "", label: empty_label }]
      : devices.map((device) => ({
          value: String(device.device_id),
          label:
            String(device.device_name) +
            (device.status === "busy" ? "（正在执行调用）" : "（在线）"),
        }));

  return [
    {
      key:
        devices.length === 0
          ? "empty"
          : devices
              .map(
                (device) =>
                  String(device.device_id) +
                  ":" +
                  String(device.device_name) +
                  ":" +
                  String(device.status),
              )
              .join("|"),
      options,
    },
  ];
}

function MetricView(props) {
  return View(
    {
      class: "box-border bg-surface box-shadow-shadow-card rounded-card",
      style: {
        "backdrop-filter": "blur(18px)",
        padding: "18px",
      },
      attributes: {
        n: props.name + "-metric",
        ...(props.description ? { title: props.description } : {}),
      },
    },
    [
      View(
        {
          class: "box-border m-0 text-muted text-transform-uppercase",
          style: {
            "font-size": "12px",
            "letter-spacing": ".08em",
          },
          attributes: { n: props.name + "-label" },
        },
        [props.label],
      ),
      View(
        {
          class: "box-border",
          style: {
            margin: "7px 0 0",
            "font-size": "28px",
            "font-weight": "760",
          },
          attributes: { n: props.name + "-value" },
        },
        [
          computed(props.metrics, (metrics) =>
            String(Number(metrics[props.field] || 0)),
          ),
        ],
      ),
    ],
  );
}

function MetricsView(props) {
  const call_records_metric = {
    name: "total-tasks",
    label: "调用记录",
    description:
      "当前保存的任务记录数，包含所有状态；已完成和失败的记录保留 7 天。",
    field: "task_count",
    metrics: props.metrics,
  };
  if (props.devices_only) {
    return View(
      {
        class:
          "box-border grid max-960-grid-template-columns max-760-grid-template-columns",
        style: {
          "grid-template-columns": "repeat(6, minmax(0, 1fr))",
          gap: "14px",
          "margin-bottom": "22px",
          "--max-960-grid-template-columns": "repeat(3, minmax(0, 1fr))",
          "--max-760-grid-template-columns": "repeat(2, minmax(0, 1fr))",
        },
        attributes: {
          n: "device-overview-metrics",
          "aria-label": "设备汇总指标",
        },
      },
      [
        MetricView({
          name: "registered-devices",
          label: "已登记设备",
          field: "device_count",
          metrics: props.metrics,
        }),
        MetricView({
          name: "online-devices",
          label: "在线设备",
          field: "online_count",
          metrics: props.metrics,
        }),
        MetricView({
          name: "offline-devices",
          label: "离线设备",
          field: "offline_count",
          metrics: props.metrics,
        }),
        MetricView(call_records_metric),
      ],
    );
  }
  return View(
    {
      class:
        "box-border grid max-960-grid-template-columns max-760-grid-template-columns",
      style: {
        "grid-template-columns": "repeat(6, minmax(0, 1fr))",
        gap: "14px",
        "margin-bottom": "22px",
        "--max-960-grid-template-columns": "repeat(3, minmax(0, 1fr))",
        "--max-760-grid-template-columns": "repeat(2, minmax(0, 1fr))",
      },
      attributes: {
        n: "overview-metrics",
        "aria-label": "汇总指标",
      },
    },
    [
      MetricView({
        name: "registered-devices",
        label: "已登记设备",
        field: "device_count",
        metrics: props.metrics,
      }),
      MetricView({
        name: "online-devices",
        label: "在线设备",
        field: "online_count",
        metrics: props.metrics,
      }),
      MetricView({
        name: "user-tokens",
        label: "用户 Token",
        field: "token_count",
        metrics: props.metrics,
      }),
      MetricView({
        name: "discovery-sources",
        label: "订阅源",
        field: "source_count",
        metrics: props.metrics,
      }),
      MetricView({
        name: "scripts",
        label: "脚本",
        field: "script_count",
        metrics: props.metrics,
      }),
      MetricView(call_records_metric),
      MetricView({
        name: "source-calls",
        label: "订阅源调用总次数",
        field: "source_call_count",
        metrics: props.metrics,
      }),
      MetricView({
        name: "cookies",
        label: "Cookie",
        field: "cookie_count",
        metrics: props.metrics,
      }),
      MetricView({
        name: "routes",
        label: "路由",
        field: "route_count",
        metrics: props.metrics,
      }),
      MetricView({
        name: "platforms",
        label: "来源",
        field: "platform_count",
        metrics: props.metrics,
      }),
      MetricView({
        name: "tags",
        label: "标签",
        field: "tag_count",
        metrics: props.metrics,
      }),
    ],
  );
}

function SourceCallsView(props) {
  return View(
    {
      class: "box-border rounded-card bg-surface overflow-hidden",
      style: {
        "margin-bottom": "22px",
      },
      attributes: { n: "source-statistics" },
    },
    [
      View(
        {
          class: "box-border",
          style: {
            padding: "18px 20px",
          },
          attributes: { n: "source-statistics-header" },
        },
        [
          View(
            {
              class: "box-border m-0",
              as: "h2",
              style: {
                "font-size": "20px",
                "font-weight": "720",
              },
              attributes: { n: "source-statistics-title" },
            },
            ["订阅源调用次数"],
          ),
          View(
            {
              class: "box-border text-muted",
              style: {
                "max-width": "720px",
                "margin-top": "7px",
                "font-size": "12px",
                "line-height": "1.6",
              },
              attributes: { n: "source-statistics-description" },
            },
            [
              "从启用统计后累计，包含通过鉴权的 RSS / Atom 请求及快照命中；后台测试、自动刷新不计入。总次数为当前订阅源计数之和。",
            ],
          ),
        ],
      ),
      View(
        {
          class: "box-border overflow-auto",
          style: {
            "max-height": "420px",
          },
          attributes: {
            n: "source-statistics-scroll",
            tabindex: "0",
            role: "region",
            "aria-label": "订阅源调用明细",
          },
        },
        [
          Show({
            when: computed(props.sources, (sources) => sources.length === 0),
            ok() {
              return View(
                {
                  class: "box-border text-muted",
                  style: {
                    padding: "20px",
                  },
                  attributes: { n: "source-statistics-empty" },
                },
                ["暂无订阅源"],
              );
            },
          }),
          For({
            each: props.sources,
            render(source_ref) {
              const source = source_value(source_ref);
              return View(
                {
                  class: "box-border flex items-center justify-between",
                  style: {
                    gap: "16px",
                    padding: "12px 20px",
                    "border-top": "1px solid var(--frui-color-border-soft)",
                  },
                  attributes: { n: "source-statistics-row" },
                },
                [
                  View(
                    {
                      class: "box-border min-w-0 break-anywhere",
                      attributes: { n: "source-statistics-info" },
                    },
                    [
                      View(
                        {
                          class: "box-border",
                          attributes: { n: "source-statistics-source-title" },
                        },
                        [source.title + (source.enabled ? "" : "（已停用）")],
                      ),
                      View(
                        {
                          class: "box-border text-muted",
                          style: {
                            "margin-top": "5px",
                            "font-size": "12px",
                          },
                          attributes: { n: "source-statistics-url" },
                        },
                        [source.feed_url],
                      ),
                    ],
                  ),
                  View(
                    {
                      class: "box-border flex-none tabular-nums",
                      style: {
                        "font-size": "13px",
                      },
                      attributes: {
                        n: "source-statistics-count",
                        "aria-label": "调用次数",
                      },
                    },
                    [
                      source.tracked
                        ? String(source.call_count)
                        : "外部源 · 无法统计",
                    ],
                  ),
                ],
              );
            },
          }),
        ],
      ),
      View({
        class: "box-border",
        style: { "padding-inline": "20px" },
        attributes: { n: "source-statistics-footer" },
      }, [PaginationView(Timeless, {
        model: props.pagination, name: "source-calls-pagination", label: "订阅源调用次数分页",
      })]),
    ],
  );
}

function access_token_expiration_text(access_token) {
  if (access_token.status === "expired") {
    return "已过期于 " + format_time(access_token.expires_at);
  }
  return access_token.expires_at
    ? "有效期至 " + format_time(access_token.expires_at)
    : "永不过期";
}

function DrawerView(props, children = []) {
  const store = props.store;
  const drawer_name = String(props.name || "access-token");
  const drawer_class = drawer_name + "-drawer";
  const state_ = refobj(store.state);
  const presence_state_ = refobj(store.presence.state);
  const was_exiting_ = ref(false);
  const layer_manager =
    typeof vm.getGlobalLayerManager === "function"
      ? vm.getGlobalLayerManager()
      : null;
  const z_index = 200 + (layer_manager ? layer_manager.size * 50 : 0);
  const unlistens = [
    store.onStateChange((state) => state_.as(state)),
    store.presence.onStateChange((state) => {
      presence_state_.as(state);
      if (state.exit) was_exiting_.as(true);
      if (state.mounted) was_exiting_.as(false);
    }),
  ];
  return ui.DialogPrimitive.Root(
    {
      store,
      attributes: { n: drawer_class + "-root" },
      onUnmounted() {
        for (const unlisten of unlistens) {
          if (typeof unlisten === "function") unlisten();
        }
      },
    },
    () => {
      const content_children =
        typeof children === "function" ? children() : children;
      return [
        ui.DialogPrimitive.Overlay({
          store,
          zIndex: z_index,
          attributes: { n: drawer_class + "-overlay" },
          onClick(event) {
            if (
              event.target === event.currentTarget &&
              state_.value.closeable
            ) {
              store.hide();
            }
          },
          class: "box-border fixed inset-0 bg-overlay",
          style: computed(presence_state_, (state) => ({
            ...{ "backdrop-filter": "blur(4px)" },
            animation: state.enter
              ? "access-token-drawer-fade-in .16s ease-out both"
              : state.exit || (!state.mounted && was_exiting_.value)
                ? "access-token-drawer-fade-out .13s ease-in both"
                : "none",
          })),
        }),
        View(
          {
            class:
              "box-border fixed inset-0 flex justify-end pointer-events-none",
            style: {
              "z-index": z_index + 1,
            },
            attributes: { n: drawer_class + "-positioner" },
          },
          [
            ui.DialogPrimitive.Content(
              {
                store,
                zIndex: z_index + 1,
                style: computed(presence_state_, (state) => ({
                  ...{
                    "border-left": "1px solid var(--frui-color-border-soft)",
                  },
                  animation: state.enter
                    ? "access-token-drawer-slide-in .22s cubic-bezier(.2,.8,.2,1) both"
                    : state.exit || (!state.mounted && was_exiting_.value)
                      ? "access-token-drawer-slide-out .16s ease-in both"
                      : "none",
                  width: props.width || "min(760px, 100vw)",
                })),
                attributes: {
                  n: drawer_class + "-content",
                  role: "dialog",
                  "aria-modal": "true",
                },
                class:
                  "box-border relative flex h-full min-h-0 flex-col overflow-hidden bg-surface box-shadow-none outline-0 pointer-events-auto",
              },
              [
                Show({
                  when: computed(state_, (state) => Boolean(state.title)),
                  ok() {
                    return ui.DialogPrimitive.Header(
                      {
                        store,
                        class: "box-border flex flex-col justify-center",
                        style: {
                          "min-height": "64px",
                          flex: "0 0 auto",
                          padding: "14px 58px 14px 22px",
                          "border-bottom":
                            "1px solid var(--frui-color-border-soft)",
                        },
                        attributes: { n: drawer_class + "-header" },
                      },
                      [
                        ui.DialogPrimitive.Title(
                          {
                            store,
                            class: "box-border m-0",
                            style: {
                              "font-size": "20px",
                              "font-weight": "720",
                            },
                            attributes: { n: drawer_class + "-title" },
                          },
                          [computed(state_, (state) => state.title || "")],
                        ),
                      ],
                    );
                  },
                }),
                ...content_children,
                ui.DialogPrimitive.Close(
                  {
                    store,
                    class:
                      "box-border absolute inline-grid place-items-center border-color-transparent p-0 bg-transparent text-muted leading-none",
                    style: {
                      top: "14px",
                      right: "14px",
                      width: "36px",
                      height: "36px",
                      "font-size": "24px",
                    },
                    attributes: {
                      n: drawer_class + "-close",
                      "aria-label": props.close_label || "关闭抽屉",
                      role: "button",
                      tabindex: "0",
                    },
                  },
                  [Icon("x")],
                ),
              ],
            ),
          ],
        ),
      ];
    },
  );
}

function ConfirmDialogView(props) {
  const vm$ = props.store;
  const store = vm$.ui.confirm_dialog;
  const state_ = refobj(store.state);
  const presence_state_ = refobj(store.presence.state);
  const was_exiting_ = ref(false);
  const layer_manager =
    typeof vm.getGlobalLayerManager === "function"
      ? vm.getGlobalLayerManager()
      : null;
  const z_index = 300 + (layer_manager ? layer_manager.size * 50 : 0);
  const unlistens = [
    store.onStateChange((state) => state_.as(state)),
    store.presence.onStateChange((state) => {
      presence_state_.as(state);
      if (state.exit) was_exiting_.as(true);
      if (state.mounted) was_exiting_.as(false);
    }),
  ];
  const title_ = computed(
    vm$.state.confirm,
    (state) => state.title || "请确认",
  );
  const message_ = computed(vm$.state.confirm, (state) => state.message);
  const confirm_label_ = computed(
    vm$.state.confirm,
    (state) => state.confirm_label,
  );
  const cancel_label_ = computed(
    vm$.state.confirm,
    (state) => state.cancel_label,
  );

  return ui.DialogPrimitive.Root(
    {
      store,
      attributes: { n: "confirm-dialog-root" },
      onUnmounted() {
        for (const unlisten of unlistens) {
          if (typeof unlisten === "function") unlisten();
        }
      },
    },
    () => [
      ui.DialogPrimitive.Overlay({
        store,
        zIndex: z_index,
        attributes: { n: "confirm-dialog-overlay" },
        onClick(event) {
          if (event.target === event.currentTarget && state_.value.closeable) {
            vm$.methods.cancelConfirm();
          }
        },
        class: "box-border fixed inset-0 bg-overlay",
        style: computed(presence_state_, (state) => ({
          ...{ "backdrop-filter": "blur(4px)" },
          animation: state.enter
            ? "access-token-drawer-fade-in .16s ease-out both"
            : state.exit || (!state.mounted && was_exiting_.value)
              ? "access-token-drawer-fade-out .13s ease-in both"
              : "none",
        })),
      }),
      View(
        {
          class:
            "box-border fixed inset-0 flex items-center justify-center pointer-events-none",
          style: {
            padding: "24px",
            "z-index": z_index + 1,
          },
          attributes: { n: "confirm-dialog-positioner" },
        },
        [
          ui.DialogPrimitive.Content(
            {
              store,
              zIndex: z_index + 1,
              style: computed(presence_state_, (state) => ({
                ...{ padding: "22px" },
                animation: state.enter
                  ? "confirm-dialog-pop-in .18s cubic-bezier(.2,.8,.2,1) both"
                  : state.exit || (!state.mounted && was_exiting_.value)
                    ? "confirm-dialog-pop-out .13s ease-in both"
                    : "none",
                width: "min(440px, calc(100vw - 32px))",
              })),
              attributes: {
                n: "confirm-dialog-content",
                role: "alertdialog",
                "aria-modal": "true",
              },
              class:
                "box-border relative flex flex-col overflow-hidden rounded-card bg-surface box-shadow-none outline-0 pointer-events-auto",
            },
            [
              ui.DialogPrimitive.Title(
                {
                  store,
                  class: "box-border m-0",
                  style: {
                    "font-size": "18px",
                    "font-weight": "720",
                  },
                  attributes: { n: "confirm-dialog-title" },
                },
                [title_],
              ),
              View(
                {
                  class:
                    "box-border text-muted whitespace-pre-wrap break-anywhere",
                  style: {
                    margin: "10px 0 0",
                    "font-size": "13px",
                    "line-height": "1.65",
                  },
                  attributes: { n: "confirm-dialog-message" },
                },
                [message_],
              ),
              View(
                {
                  class: "box-border flex justify-end",
                  style: {
                    gap: "10px",
                    "margin-top": "22px",
                  },
                  attributes: { n: "confirm-dialog-actions" },
                },
                [
                  Button(
                    {
                      class: "box-border flex-none justify-self-center",
                      attributes: { n: "confirm-dialog-cancel-button" },
                      onClick() {
                        return vm$.methods.cancelConfirm();
                      },
                    },
                    [cancel_label_],
                  ),
                  Button(
                    {
                      class: computed(
                        vm$.state.confirm,
                        (state) =>
                          "box-border " +
                          (state.danger ? "bg-danger-bg text-danger" : ""),
                      ),
                      attributes: { n: "confirm-dialog-confirm-button" },
                      onClick() {
                        return vm$.methods.acceptConfirm();
                      },
                    },
                    [confirm_label_],
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  );
}

function AccessTokenCardView(props) {
  const vm$ = props.store;
  const access_token_ = props.access_token;
  const access_token_id = String(access_token_.value.id);
  const name_ = computed(access_token_, (access_token) => access_token.name);
  const email_ = computed(access_token_, (access_token) =>
    access_token.email ? "邮箱登录 · " + access_token.email : "仅 Token 登录",
  );
  const status_ = computed(
    access_token_,
    (access_token) => access_token.status,
  );

  const status_label_ = computed(status_, (status) =>
    status === "expired" ? "已过期" : "有效",
  );
  const expiration_ = computed(access_token_, access_token_expiration_text);
  const usage_ = computed(access_token_, (access_token) =>
    access_token.last_used_at
      ? "最近使用 " + format_time(access_token.last_used_at)
      : "尚未使用",
  );
  const created_ = computed(
    access_token_,
    (access_token) => "创建于 " + format_time(access_token.created_at),
  );
  const credits_ = computed(
    access_token_,
    (access_token) =>
      "积分余额 " +
      String(access_token.credit_balance) +
      " · 已消耗 " +
      String(access_token.total_credits_used) +
      " · 累计发放 " +
      String(access_token.total_credits_granted),
  );
  const busy_ = computed(vm$.state.access_token_action, (action) =>
    Boolean(action.busy_id),
  );
  const expire_visible_ = computed(status_, (status) => status !== "expired");
  const expire_label_ = computed(vm$.state.access_token_action, (action) =>
    action.busy_id === access_token_id && action.busy_action === "expire"
      ? "处理中…"
      : "立即过期",
  );
  const remove_label_ = computed(vm$.state.access_token_action, (action) =>
    action.busy_id === access_token_id && action.busy_action === "remove"
      ? "移除中…"
      : "移除",
  );
  const credits_label_ = computed(vm$.state.access_token_action, (action) =>
    action.busy_id === access_token_id && action.busy_action === "credits"
      ? "充值中…"
      : "充值积分",
  );

  return View(
    {
      class: computed(
        status_,
        (status) =>
          "box-border " +
          ("grid items-center rounded-card bg-surface-raised max-760-grid-template-columns " +
            (status === "expired" ? "" : "")),
      ),
      style: computed(status_, (status) => ({
        "grid-template-columns":
          "minmax(160px, .7fr) minmax(300px, 1.5fr) minmax(250px, auto)",
        gap: "18px",
        padding: "14px 15px",
        border: "1px solid var(--frui-color-border)",
        "--max-760-grid-template-columns": "1fr",
        opacity: status === "expired" ? ".68" : "",
      })),
      attributes: {
        n: "access-token-card",
        "data-access-token-id": access_token_id,
      },
    },
    [
      View(
        { class: "box-border", attributes: { n: "access-token-identity" } },
        [
          View(
            {
              class: "box-border break-anywhere",
              style: {
                "font-size": "14px",
                "font-weight": "680",
              },
              attributes: { n: "access-token-name" },
            },
            [name_],
          ),
          View(
            {
              class: "box-border text-muted break-anywhere",
              style: {
                "margin-top": "5px",
                "font-size": "11px",
              },
              attributes: { n: "access-token-email" },
            },
            [email_],
          ),
        ],
      ),
      View(
        {
          class: "box-border flex flex-wrap items-center",
          style: {
            gap: "7px 12px",
          },
          attributes: { n: "access-token-status-group" },
        },
        [
          View(
            {
              class: computed(
                status_,
                (status) =>
                  "box-border " +
                  ("rounded-pill " +
                    (status === "active"
                      ? "bg-success-bg text-success"
                      : status !== "active"
                        ? "bg-danger-bg text-danger"
                        : "")),
              ),
              style: {
                padding: "4px 8px",
                "font-size": "11px",
              },
              attributes: { n: "access-token-status" },
            },
            [status_label_],
          ),
          View(
            {
              class: "box-border text-muted",
              style: {
                "font-size": "11px",
              },
              attributes: { n: "access-token-expiration" },
            },
            [expiration_],
          ),
          View(
            {
              class: "box-border text-muted",
              style: {
                "font-size": "11px",
              },
              attributes: { n: "access-token-credits" },
            },
            [credits_],
          ),
          View(
            {
              class: "box-border text-muted",
              style: {
                "font-size": "11px",
              },
              attributes: { n: "access-token-last-used" },
            },
            [usage_],
          ),
          View(
            {
              class: "box-border text-muted",
              style: {
                "font-size": "11px",
              },
              attributes: { n: "access-token-created-at" },
            },
            [created_],
          ),
        ],
      ),
      View(
        {
          class:
            "box-border flex flex-wrap justify-end max-760-justify-content",
          style: {
            gap: "8px",
            "--max-760-justify-content": "flex-start",
          },
          attributes: { n: "access-token-card-actions" },
        },
        [
          Button({
            variant: "secondary",
            attributes: { n: "view-access-token-button", "aria-label": "查看积分消耗日志" },
            onClick: () => vm$.methods.openAccessTokenLogs(access_token_id),
          }, ["查看"]),
          Button(
            {
              class: "box-border",
              attributes: { n: "grant-access-token-credits-button" },
              disabled: busy_,
              onClick() {
                return vm$.methods.grantAccessTokenCredits(access_token_id);
              },
            },
            [credits_label_],
          ),
          Show({
            when: expire_visible_,
            ok() {
              return Button(
                {
                  class: "box-border flex-none justify-self-center",
                  attributes: { n: "expire-access-token-button" },
                  disabled: busy_,
                  onClick() {
                    return vm$.methods.expireAccessToken(access_token_id);
                  },
                },
                [expire_label_],
              );
            },
          }),
          Popconfirm({
            title: computed(name_, name => `移除用户 Token“${name}”？此操作无法撤销。`), confirmText: "确认移除",
            disabled: busy_, attributes: { n: "remove-access-token-confirmation" },
            onConfirm: () => vm$.methods.removeAccessToken(access_token_id),
            trigger: props => Button({ ...props, class: "box-border flex-none", disabled: busy_,
              attributes: { ...props.attributes, n: "remove-access-token-button" } }, [remove_label_]),
          }),
        ],
      ),
    ],
  );
}

function AccessTokenLogsView({ store: vm$ }) {
  const state = vm$.state.access_token_log_state;
  const busy = computed(state, value => value.loading || value.loading_more);
  const error = computed(state, value => value.error);
  return Dialog({
    open: computed(state, value => value.open),
    title: computed(state, value => "积分消耗日志 · " + value.name),
    description: "按时间倒序显示此 Token 的扣费、退款和充值记录。",
    style: { "--width-min-480-pixels-calc-100-vw-32-pixels": "min(760px,calc(100vw - 32px))" },
    attributes: { n: "access-token-logs-dialog", "aria-label": "Token 积分消耗日志" },
    onClose: vm$.methods.closeAccessTokenLogs,
    footer: [
      Button({ variant: "secondary", disabled: busy,
        attributes: { n: "refresh-access-token-logs-button" },
        onClick: vm$.methods.refreshAccessTokenLogs }, ["刷新"]),
      Button({ attributes: { n: "close-access-token-logs-button" },
        onClick: vm$.methods.closeAccessTokenLogs }, ["关闭"]),
    ],
  }, [
    View({ class: "grid min-w-0 gap-space-3", attributes: {
      n: "access-token-logs", "aria-busy": computed(busy, String),
    } }, [
      Show({ when: computed(error, Boolean), ok: () => View({ class: "text-danger",
        attributes: { n: "access-token-logs-error", role: "alert" } }, [error]) }),
      Show({ when: computed(state, value => value.loading), ok: () => View({ class: "text-muted",
        attributes: { n: "access-token-logs-loading", role: "status" } }, ["正在加载积分日志…"]) }),
      Show({ when: combine({ state, rows: vm$.state.access_token_logs },
        ({ state, rows }) => !state.loading && !state.error && !rows.length),
        ok: () => View({ class: "text-muted", attributes: { n: "access-token-logs-empty" } }, ["暂无积分记录"]),
      }),
      For({ each: vm$.state.access_token_logs, render(row_ref) {
        const row = source_value(row_ref);
        const amount = Number(row.amount) || 0;
        const type = { charge: "扣费", refund: "退款", grant: "充值", adjustment: "调整", redemption: "兑换" }[row.type] || "积分变动";
        return View({ class: "grid min-w-0 gap-space-2 rounded-card bg-surface-raised padding-space-3",
          attributes: { n: "access-token-log-row", "data-transaction-id": row.id } }, [
          View({ class: "flex flex-wrap items-center justify-between gap-space-2" }, [
            View({ class: "text-muted tabular-nums", attributes: { n: "access-token-log-time" } }, [format_time(row.created_at)]),
            View({ class: "text-muted", attributes: { n: "access-token-log-type" } }, [type]),
          ]),
          View({ class: "break-anywhere", attributes: { n: "access-token-log-subject" } }, [
            String(row.subject || row.note || row.method || type),
          ]),
          View({ class: "flex flex-wrap items-center justify-between gap-space-2 tabular-nums" }, [
            View({ class: amount < 0 ? "text-danger" : "text-success", attributes: { n: "access-token-log-amount" } }, [
              (amount > 0 ? "+" : "") + amount + " 积分",
            ]),
            View({ class: "text-muted", attributes: { n: "access-token-log-balance" } }, ["余额 " + Number(row.balance_after || 0)]),
          ]),
        ]);
      } }),
      Show({ when: computed(state, value => Boolean(value.next_cursor)), ok: () => Button({
        variant: "secondary", disabled: busy, attributes: { n: "load-more-access-token-logs-button" },
        onClick: vm$.methods.loadMoreAccessTokenLogs,
      }, [computed(state, value => value.loading_more ? "正在加载…" : "加载更早记录")]) }),
    ]),
  ]);
}

function AccessTokenCreateView(props) {
  const vm$ = props.store;
  const name_ = computed(vm$.state.access_token_draft, (draft) =>
    String(draft.name || ""),
  );
  const token_ = computed(vm$.state.access_token_draft, (draft) =>
    String(draft.token || ""),
  );
  const email_ = computed(vm$.state.access_token_draft, (draft) =>
    String(draft.email || ""),
  );
  const password_ = computed(vm$.state.access_token_draft, (draft) =>
    String(draft.password || ""),
  );
  const expires_in_seconds_ = computed(vm$.state.access_token_draft, (draft) =>
    String(draft.expires_in_seconds || ""),
  );
  const credits_ = computed(vm$.state.access_token_draft, (draft) =>
    String(draft.credits ?? "0"),
  );
  const creating_ = computed(vm$.state.access_token_action, (action) =>
    Boolean(action.creating),
  );
  const create_label_ = computed(creating_, (creating) =>
    creating ? "创建中…" : "创建用户 Token",
  );
  const error_ = computed(vm$.state.access_token_action, (action) =>
    String(action.error || ""),
  );
  const expiration_options = [
    { value: "86400", label: "1 天" },
    { value: "604800", label: "7 天" },
    { value: "2592000", label: "30 天" },
    { value: "7776000", label: "90 天" },
    { value: "", label: "永不过期" },
  ];

  const trigger = document.activeElement;
  function handle_keydown(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      vm$.methods.closeAccessTokenForm();
    }
    if (event.key !== "Tab") return;
    const dialog = document.querySelector('[data-n="access-token-create-dialog"], [n="access-token-create-dialog"]');
    const controls = Array.from(dialog?.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]') || [])
      .filter(node => node.getClientRects().length);
    const edge = event.shiftKey ? controls[0] : controls.at(-1);
    if (document.activeElement === edge || !controls.includes(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
    }
  }
  return Dialog({
    open: vm$.state.access_token_form_open,
    title: "创建 Token",
    description: "每次调用消耗 1 积分。Token 明文仅在创建时显示一次；可选填邮箱和密码用于登录 Reader。",
    class: "box-border flex flex-col overflow-hidden p-0",
    style: { width: "min(760px, calc(100vw - 32px))", "max-height": "calc(100dvh - 32px)" },
    headerProps: { class: "box-border flex-none m-0", style: { padding: "22px 24px", "border-bottom": "1px solid var(--frui-color-border-soft)" } },
    bodyProps: { class: "box-border flex-1 min-h-0 overflow-auto", style: { padding: "24px" } },
    footerProps: { class: "box-border flex-none flex-wrap m-0", style: { padding: "16px 24px", "border-top": "1px solid var(--frui-color-border-soft)" } },
    attributes: { n: "access-token-create-dialog", "aria-label": "创建 Token" },
    closable: false,
    maskClosable: false,
    onClose: vm$.methods.closeAccessTokenForm,
    onMounted() { document.addEventListener("keydown", handle_keydown); },
    onUnmounted() {
      document.removeEventListener("keydown", handle_keydown);
      trigger?.focus?.();
    },
    footer: [
      Show({
        when: computed(error_, Boolean),
        ok() {
          return View(
            {
              class: "box-border w-full text-danger",
              style: {
                "font-size": "12px",
                "line-height": "1.55",
              },
              attributes: {
                n: "access-token-error",
                role: "alert",
              },
            },
            [error_],
          );
        },
      }),
      Button({ attributes: { n: "cancel-access-token-button" }, variant: "secondary", disabled: creating_, onClick: vm$.methods.closeAccessTokenForm }, ["取消"]),
      Button({ attributes: { n: "create-access-token-button" }, disabled: creating_, onClick: vm$.methods.createAccessToken }, [create_label_]),
    ],
  }, [
      View(
        {
          class:
            "box-border grid items-end max-760-grid-template-columns",
          style: {
            "grid-template-columns": "repeat(2, minmax(0, 1fr))",
            gap: "10px",
            "--max-760-grid-template-columns": "1fr",
          },
          attributes: { n: "access-token-create-form" },
        },
        [
          View(
            {
              class: "box-border grid text-muted",
              style: {
                gap: "6px",
                "font-size": "11px",
              },
              attributes: { n: "access-token-name-field" },
            },
            [
              "用途或使用人（可选）",
              Input({
                class:
                  "box-border w-full min-w-0 rounded-control bg-surface text-text font-inherit",
                style: {
                  padding: "10px 11px",
                },
                value: name_,
                placeholder: "例如：合作方 A",
                attributes: {
                  n: "access-token-name-input",
                  "aria-label": "Token 用途或使用人",
                  maxlength: "128",
                },
                onInput(event) {
                  vm$.methods.setAccessTokenDraft(
                    "name",
                    String(event.target.value),
                  );
                },
              }),
            ],
          ),
          View(
            {
              class: "box-border grid text-muted",
              style: {
                gap: "6px",
                "font-size": "11px",
              },
              attributes: { n: "access-token-value-field" },
            },
            [
              "自定义 Token（可选）",
              Input({
                class:
                  "box-border w-full min-w-0 rounded-control bg-surface text-text font-inherit",
                style: {
                  padding: "10px 11px",
                },
                value: token_,
                placeholder: "留空时自动生成，至少 16 位",
                attributes: {
                  n: "access-token-value-input",
                  "aria-label": "自定义用户 Token",
                  autocomplete: "off",
                  maxlength: "256",
                  spellcheck: "false",
                },
                onInput(event) {
                  vm$.methods.setAccessTokenDraft(
                    "token",
                    String(event.target.value),
                  );
                },
              }),
            ],
          ),
          View(
            {
              class: "box-border grid text-muted",
              style: {
                gap: "6px",
                "font-size": "11px",
              },
              attributes: { n: "access-token-email-field" },
            },
            [
              "登录邮箱（可选）",
              Input({
                class:
                  "box-border w-full min-w-0 rounded-control bg-surface text-text font-inherit",
                style: {
                  padding: "10px 11px",
                },
                value: email_,
                placeholder: "reader@example.com",
                attributes: {
                  n: "access-token-email-input",
                  "aria-label": "Reader 登录邮箱",
                  type: "email",
                  autocomplete: "off",
                  maxlength: "254",
                },
                onInput(event) {
                  vm$.methods.setAccessTokenDraft(
                    "email",
                    String(event.target.value),
                  );
                },
              }),
            ],
          ),
          View(
            {
              class: "box-border grid text-muted",
              style: {
                gap: "6px",
                "font-size": "11px",
              },
              attributes: { n: "access-token-password-field" },
            },
            [
              "登录密码（可选）",
              Input({
                class:
                  "box-border w-full min-w-0 rounded-control bg-surface text-text font-inherit",
                style: {
                  padding: "10px 11px",
                },
                value: password_,
                placeholder: "与邮箱同时填写，至少 8 位",
                attributes: {
                  n: "access-token-password-input",
                  "aria-label": "Reader 登录密码",
                  type: "password",
                  autocomplete: "new-password",
                  maxlength: "128",
                },
                onInput(event) {
                  vm$.methods.setAccessTokenDraft(
                    "password",
                    String(event.target.value),
                  );
                },
              }),
            ],
          ),
          View(
            {
              class: "box-border grid text-muted",
              style: {
                gap: "6px",
                "font-size": "11px",
              },
              attributes: { n: "access-token-credits-field" },
            },
            [
              "初始积分",
              Input({
                class:
                  "box-border w-full min-w-0 rounded-control bg-surface text-text font-inherit",
                style: {
                  padding: "10px 11px",
                },
                value: credits_,
                attributes: {
                  n: "access-token-credits-input",
                  "aria-label": "Token 初始积分",
                  inputmode: "numeric",
                },
                onInput(event) {
                  vm$.methods.setAccessTokenDraft(
                    "credits",
                    String(event.target.value),
                  );
                },
              }),
            ],
          ),
          View(
            {
              class: "box-border grid text-muted",
              style: {
                gap: "6px",
                "font-size": "11px",
              },
              attributes: { n: "access-token-expiration-field" },
            },
            [
              "有效期",
              Select({
                class:
                  "box-border w-full min-w-0 rounded-control bg-surface text-text font-inherit",
                style: {
                  padding: "10px 11px",
                },
                value: expires_in_seconds_,
                options: expiration_options,
                attributes: {
                  n: "access-token-expiration-select",
                  "aria-label": "Token 有效期",
                },
                onChange(event) {
                  vm$.methods.setAccessTokenDraft(
                    "expires_in_seconds",
                    String(event.target.value),
                  );
                },
              }),
            ],
          ),
        ],
      ),
  ]);
}

function AccessTokenManagementView(props) {
  const vm$ = props.store;
  const error_ = computed(vm$.state.access_token_action, action => String(action.error || ""));
  const created_token_ = computed(vm$.state.access_token_action, (action) =>
    String(action.created_token || ""),
  );
  const created_token_name_ = computed(
    vm$.state.access_token_action,
    (action) => String(action.created_token_name || ""),
  );
  const copy_message_ = computed(vm$.state.access_token_action, (action) =>
    String(action.copy_message || ""),
  );
  return View({ class: "box-border", attributes: { n: "access-token-management", "aria-label": "用户 Token 管理" } }, [
    Show({ when: vm$.state.access_token_form_open, ok: () => AccessTokenCreateView({ store: vm$ }) }),
    Show({ when: computed(vm$.state.access_token_log_state, state => state.open),
      ok: () => AccessTokenLogsView({ store: vm$ }) }),
      Show({
        when: combine({ error: error_, open: vm$.state.access_token_form_open }, state => Boolean(state.error) && !state.open),
        ok() {
          return View(
            {
              class: "box-border text-danger",
              style: {
                "margin-top": "12px",
                "font-size": "12px",
                "line-height": "1.55",
              },
              attributes: {
                n: "access-token-error",
                role: "alert",
              },
            },
            [error_],
          );
        },
      }),
      Show({
        when: computed(created_token_, Boolean),
        ok() {
          return View(
            {
              class: "box-border rounded-card bg-success-bg",
              style: {
                "margin-top": "16px",
                padding: "15px",
              },
              attributes: { n: "created-access-token" },
            },
            [
              View(
                {
                  class: "box-border text-muted",
                  style: {
                    "font-size": "14px",
                    "font-weight": "680",
                  },
                  attributes: { n: "created-access-token-title" },
                },
                ["请立即保存“", created_token_name_, "”的 Token"],
              ),
              View(
                {
                  class: "box-border text-muted",
                  style: {
                    "margin-top": "5px",
                    "font-size": "11px",
                    "line-height": "1.55",
                  },
                  attributes: { n: "created-access-token-description" },
                },
                ["关闭此提示后无法再次查看明文，只能创建新 Token。"],
              ),
              View(
                {
                  class: "box-border grid max-760-grid-template-columns",
                  style: {
                    "grid-template-columns": "minmax(220px, 1fr) auto auto",
                    gap: "9px",
                    "margin-top": "12px",
                    "--max-760-grid-template-columns": "1fr",
                  },
                  attributes: { n: "created-access-token-value-row" },
                },
                [
                  Input({
                    class:
                      "box-border font-mono w-full min-w-0 rounded-control bg-surface text-text font-inherit",
                    style: {
                      padding: "10px 11px",
                    },
                    value: created_token_,
                    readonly: true,
                    attributes: {
                      n: "created-access-token-value",
                      "aria-label": "新创建的用户 Token",
                    },
                  }),
                  Button(
                    {
                      class: "box-border",
                      attributes: { n: "copy-access-token-button" },
                      onClick() {
                        return vm$.methods.copyCreatedAccessToken();
                      },
                    },
                    ["复制"],
                  ),
                  Button(
                    {
                      class: "box-border flex-none justify-self-center",
                      attributes: { n: "dismiss-access-token-button" },
                      onClick() {
                        vm$.methods.dismissCreatedAccessToken();
                      },
                    },
                    ["已保存，关闭"],
                  ),
                ],
              ),
              Show({
                when: computed(copy_message_, Boolean),
                ok() {
                  return View(
                    {
                      class: "box-border text-success",
                      style: {
                        "margin-top": "12px",
                        "font-size": "12px",
                        "line-height": "1.55",
                      },
                      attributes: { n: "access-token-copy-message" },
                    },
                    [copy_message_],
                  );
                },
              }),
            ],
          );
        },
      }),
      View(
        {
          class: "box-border grid",
          style: {
            gap: "14px",
            "margin-top": "18px",
          },
          attributes: { n: "access-token-list" },
        },
        [
          Show({
            when: combine(
              { tokens: vm$.state.access_tokens, loading: vm$.state.loading, error: vm$.state.error, refreshed_at: vm$.state.refreshed_at },
              ({ tokens, loading, error, refreshed_at }) => tokens.length === 0 && !loading && !error && refreshed_at > 0,
            ),
            ok() {
              return EmptyCard({
                name: "empty-access-token-list",
                title: "还没有 Token",
                description: "创建第一个 Token，用于访问订阅源或登录 Reader。",
                actions: [Button({
                  variant: "primary",
                  attributes: { n: "empty-create-access-token-button" },
                  disabled: computed(vm$.state.access_token_action, action => action.creating),
                  onClick: vm$.methods.openAccessTokenForm,
                }, ["创建 Token"])],
              });
            },
          }),
          For({
            key: "id",
            each: vm$.state.access_tokens,
            render(access_token_value, index_) {
              const access_token_id = String(
                source_value(access_token_value).id,
              );
              return AccessTokenCardView({
                store: vm$,
                access_token: vm$.methods.accessTokenSource(
                  access_token_id,
                  index_.value,
                ),
              });
            },
          }),
        ],
      ),
    ],
  );
}

function device_log_category_label(category) {
  const labels = {
    connection: "连接",
    heartbeat: "心跳",
    call: "调用",
    response: "响应",
    system: "系统",
  };
  return labels[category] || "系统";
}

function device_log_direction_label(direction) {
  const labels = {
    inbound: "设备 → API",
    outbound: "API → 设备",
    internal: "API 内部",
  };
  return labels[direction] || "API 内部";
}

function DeviceLogEntryView(props) {
  const log_ = props.log;
  const log_id = String(source_value(log_).id);

  const created_at_ = computed(log_, (log) => format_time(log.created_at));
  const category_ = computed(log_, (log) =>
    device_log_category_label(log.category),
  );
  const direction_ = computed(log_, (log) =>
    device_log_direction_label(log.direction),
  );
  const message_ = computed(log_, (log) => log.message);
  const event_type_ = computed(log_, (log) => log.event_type);
  const context_ = computed(log_, (log) => {
    const parts = [];
    if (log.method) parts.push("方法 " + log.method);
    if (log.task_id) parts.push("调用 " + log.task_id);
    if (log.connection_id) parts.push("连接 " + log.connection_id);
    return parts.join(" · ");
  });
  const metadata_visible_ = computed(log_, (log) =>
    Boolean(log.metadata && Object.keys(log.metadata).length > 0),
  );
  const metadata_ = computed(log_, (log) => format_json(log.metadata));

  return View(
    {
      class: "box-border relative rounded-card bg-surface",
      style: computed(log_, (log) => ({
        "border-left":
          "3px solid " +
          (log.level === "error"
            ? "var(--frui-color-danger)"
            : log.level === "warn"
              ? "var(--frui-color-warning)"
              : "var(--frui-color-border-soft)"),
        padding: "13px 14px",
      })),
      attributes: {
        n: "device-log-entry",
        "data-log-id": log_id,
      },
    },
    [
      View(
        {
          class: "box-border flex items-center justify-between",
          style: {
            gap: "12px",
          },
          attributes: { n: "device-log-entry-header" },
        },
        [
          View(
            {
              class: "box-border flex flex-wrap items-center",
              style: {
                gap: "7px",
              },
              attributes: { n: "device-log-badges" },
            },
            [
              View(
                {
                  class: "box-border rounded-pill bg-selected text-muted",
                  style: {
                    padding: "4px 8px",
                    "font-size": "10px",
                  },
                  attributes: { n: "device-log-category" },
                },
                [category_],
              ),
              View(
                {
                  class: "box-border rounded-pill bg-surface-raised text-muted",
                  style: {
                    padding: "4px 8px",
                    "font-size": "10px",
                  },
                  attributes: { n: "device-log-direction" },
                },
                [direction_],
              ),
            ],
          ),
          View(
            {
              class: "box-border text-muted whitespace-nowrap",
              style: {
                font: "10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
              },
              attributes: { n: "device-log-time" },
            },
            [created_at_],
          ),
        ],
      ),
      View(
        {
          class: "box-border text-text",
          style: {
            "margin-top": "10px",
            "font-size": "13px",
            "font-weight": "650",
            "line-height": "1.5",
          },
          attributes: { n: "device-log-message" },
        },
        [message_],
      ),
      View(
        {
          class: "box-border text-muted",
          style: {
            "margin-top": "4px",
            font: "10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
          },
          attributes: { n: "device-log-event-type" },
        },
        [event_type_],
      ),
      Show({
        when: computed(context_, Boolean),
        ok() {
          return View(
            {
              class: "box-border text-muted break-anywhere",
              style: {
                "margin-top": "7px",
                font: "10px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace",
              },
              attributes: { n: "device-log-context" },
            },
            [context_],
          );
        },
      }),
      Show({
        when: metadata_visible_,
        ok() {
          return View(
            {
              class: "box-border",
              as: "details",
              style: {
                "margin-top": "9px",
              },
              attributes: { n: "device-log-details" },
            },
            [
              View(
                {
                  as: "summary",
                  class:
                    "box-border text-muted cursor-pointer user-select-none",
                  style: {
                    "font-size": "11px",
                  },
                  attributes: { n: "device-log-details-summary" },
                },
                ["查看参数 / 响应数据"],
              ),
              View(
                {
                  as: "pre",
                  class:
                    "box-border overflow-auto rounded-control bg-canvas text-muted whitespace-pre-wrap break-anywhere",
                  style: {
                    "max-height": "360px",
                    margin: "9px 0 0",
                    padding: "11px",
                    font: "10px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace",
                  },
                  attributes: { n: "device-log-metadata" },
                },
                [metadata_],
              ),
            ],
          );
        },
      }),
    ],
  );
}

function DeviceLogDrawerView(props) {
  const vm$ = props.store;
  const category_ = computed(vm$.state.device_log_state, (state) =>
    String(state.category || ""),
  );
  const loading_ = computed(vm$.state.device_log_state, (state) =>
    Boolean(state.loading),
  );
  const loading_more_ = computed(vm$.state.device_log_state, (state) =>
    Boolean(state.loading_more),
  );
  const error_ = computed(vm$.state.device_log_state, (state) =>
    String(state.error || ""),
  );
  const has_more_ = computed(vm$.state.device_log_state, (state) =>
    Boolean(state.has_more),
  );
  const refresh_label_ = computed(loading_, (loading) =>
    loading ? "刷新中…" : "立即刷新",
  );
  const load_more_label_ = computed(loading_more_, (loading) =>
    loading ? "加载中…" : "加载更早日志",
  );
  const description_ = computed(vm$.state.device_log_state, (state) => {
    const retention_days = state.retention_milliseconds
      ? Math.round(state.retention_milliseconds / (24 * 60 * 60 * 1000))
      : 7;
    return (
      String(state.device_os || "unknown") +
      " · " +
      String(state.device_id || "") +
      " · 保留最近 " +
      String(retention_days) +
      " 天 · 每 5 秒自动刷新"
    );
  });
  const refreshed_text_ = computed(vm$.state.device_log_state, (state) =>
    state.refreshed_at
      ? "更新于 " + format_time(state.refreshed_at)
      : "等待加载",
  );
  const empty_visible_ = combine(
    { loading: loading_, logs: vm$.state.device_logs },
    ({ loading, logs }) => !loading && logs.length === 0,
  );
  const initial_loading_ = combine(
    { loading: loading_, logs: vm$.state.device_logs },
    ({ loading, logs }) => loading && logs.length === 0,
  );
  const category_options = [
    { value: "", label: "全部日志" },
    { value: "connection", label: "连接" },
    { value: "heartbeat", label: "心跳" },
    { value: "call", label: "调用" },
    { value: "response", label: "响应" },
    { value: "system", label: "系统" },
  ];

  return DrawerView(
    {
      store: vm$.ui.device_log_drawer,
      name: "device-log",
      width: "min(860px, 100vw)",
      close_label: "关闭设备日志抽屉",
    },
    () => [
      View(
        {
          class: "box-border min-h-0 flex-1 overflow-auto",
          style: {
            padding: "20px 22px 28px",
          },
          attributes: { n: "device-log-drawer-body" },
        },
        [
          View(
            {
              class:
                "box-border flex items-flex-end justify-between max-760-align-items max-760-flex-direction",
              style: {
                gap: "18px",
                "padding-bottom": "16px",
                "border-bottom": "1px solid var(--frui-color-border-soft)",
                "--max-760-align-items": "flex-start",
                "--max-760-flex-direction": "column",
              },
              attributes: { n: "device-log-toolbar" },
            },
            [
              View(
                {
                  class: "box-border",
                  attributes: { n: "device-log-description-group" },
                },
                [
                  View(
                    {
                      class: "box-border text-muted break-anywhere",
                      style: {
                        "font-size": "12px",
                        "line-height": "1.6",
                      },
                      attributes: { n: "device-log-description" },
                    },
                    [description_],
                  ),
                  View(
                    {
                      class: "box-border text-muted",
                      style: {
                        "margin-top": "5px",
                        "font-size": "11px",
                      },
                      attributes: { n: "device-log-refreshed-at" },
                    },
                    [refreshed_text_],
                  ),
                ],
              ),
              View(
                {
                  class:
                    "box-border flex flex-none items-center max-760-width max-760-flex-wrap",
                  style: {
                    gap: "9px",
                    "--max-760-width": "100%",
                    "--max-760-flex-wrap": "wrap",
                  },
                  attributes: { n: "device-log-toolbar-actions" },
                },
                [
                  Select({
                    class:
                      "box-border w-full min-w-0 rounded-control bg-surface text-text font-inherit max-760-flex max-760-width max-760-min-width",
                    style: {
                      padding: "10px 11px",
                      "--max-760-flex": "1",
                      "--max-760-width": "auto",
                      "--max-760-min-width": "140px",
                    },
                    value: category_.value,
                    options: category_options,
                    attributes: {
                      n: "device-log-category-select",
                      "aria-label": "筛选设备日志类型",
                    },
                    onChange(event) {
                      vm$.methods.setDeviceLogCategory(
                        String(event.target.value),
                      );
                    },
                  }),
                  Button(
                    {
                      class: "box-border flex-none justify-self-center",
                      attributes: { n: "refresh-device-logs-button" },
                      disabled: loading_,
                      onClick() {
                        return vm$.methods.refreshDeviceLogs(false);
                      },
                    },
                    [refresh_label_],
                  ),
                ],
              ),
            ],
          ),
          Show({
            when: computed(error_, Boolean),
            ok() {
              return View(
                {
                  class: "box-border rounded-card bg-danger-bg text-danger",
                  style: {
                    "margin-top": "14px",
                    padding: "11px 12px",
                    "font-size": "12px",
                  },
                  attributes: { n: "device-log-error", role: "alert" },
                },
                [error_],
              );
            },
          }),
          Show({
            when: initial_loading_,
            ok() {
              return View(
                {
                  class: "box-border text-center m-0 text-muted",
                  style: {
                    padding: "8px 0",
                  },
                  attributes: { n: "device-log-loading" },
                },
                ["正在加载设备日志…"],
              );
            },
          }),
          Show({
            when: empty_visible_,
            ok() {
              return View(
                {
                  class: "box-border text-center m-0 text-muted",
                  style: {
                    padding: "8px 0",
                  },
                  attributes: { n: "empty-device-logs" },
                },
                ["当前筛选条件下还没有日志。新连接和设备行为会自动记录。"],
              );
            },
          }),
          View(
            {
              class: "box-border grid",
              style: {
                gap: "10px",
                "margin-top": "16px",
              },
              attributes: { n: "device-log-list" },
            },
            [
              For({
                key: "id",
                each: vm$.state.device_logs,
                render(log_value) {
                  return DeviceLogEntryView({ log: log_value });
                },
              }),
            ],
          ),
          Show({
            when: has_more_,
            ok() {
              return View(
                {
                  class: "box-border flex justify-center",
                  style: {
                    "margin-top": "16px",
                  },
                  attributes: { n: "device-log-load-more" },
                },
                [
                  Button(
                    {
                      class: "box-border flex-none justify-self-center",
                      attributes: { n: "load-older-device-logs-button" },
                      disabled: loading_more_,
                      onClick() {
                        return vm$.methods.loadOlderDeviceLogs();
                      },
                    },
                    [load_more_label_],
                  ),
                ],
              );
            },
          }),
        ],
      ),
    ],
  );
}

function task_meta_text(task) {
  if (!task) return "";
  let meta =
    "调用 " +
    String(task.id) +
    " · 执行设备 " +
    String(
      task.assigned_device_id ||
        task.assigned_client_id ||
        task.target_device_id ||
        task.target_client_id ||
        "等待分配",
    ) +
    " · 尝试 " +
    String(task.attempt_count || 0) +
    " · 创建 " +
    format_time(task.created_at) +
    " · 更新 " +
    format_time(task.updated_at);
  if (task.completed_at) meta += " · 完成 " + format_time(task.completed_at);
  return meta;
}

function task_output_text(task) {
  if (!task) return "";
  if (task.status === "completed") return format_json(task.result);
  if (task.status === "failed") return String(task.error || "调用执行失败");
  return "";
}

function TaskResultView(props) {
  const task_ = computed(props.result, (result) => result.task || null);
  const error_ = computed(props.result, (result) => String(result.error || ""));
  const submitting_ = computed(props.result, (result) =>
    Boolean(result.submitting),
  );
  const status_text_ = computed(task_, (task) =>
    task ? props.status_labels[task.status] || String(task.status) : "",
  );

  const meta_ = computed(task_, task_meta_text);
  const output_ = computed(task_, task_output_text);
  const output_visible_ = computed(task_, (task) =>
    Boolean(task && (task.status === "completed" || task.status === "failed")),
  );

  return View(
    {
      class: "box-border",
      style: {
        "margin-top": "14px",
        "padding-top": "14px",
        "border-top": "1px solid var(--frui-color-border-soft)",
      },
      attributes: { n: props.name + "-result" },
    },
    [
      Show({
        when: computed(error_, Boolean),
        ok() {
          return View(
            {
              class: "box-border m-0 text-danger",
              style: {
                "font-size": "13px",
              },
              attributes: { n: props.name + "-error" },
            },
            [error_],
          );
        },
      }),
      Show({
        when: submitting_,
        ok() {
          return View(
            {
              class: "box-border m-0 text-muted",
              style: {
                "font-size": "13px",
              },
              attributes: { n: props.name + "-submitting" },
            },
            [props.submitting_text],
          );
        },
      }),
      Show({
        when: computed(task_, Boolean),
        ok() {
          return [
            View(
              {
                class: computed(
                  task_,
                  (task) =>
                    "box-border " +
                    ("m-0 " +
                      (task?.status === "completed"
                        ? "text-success"
                        : task?.status === "failed"
                          ? "text-danger"
                          : task?.status === "running"
                            ? "text-muted"
                            : task?.status === "assigned"
                              ? "text-muted"
                              : task?.status === "queued"
                                ? "text-muted"
                                : "text-muted")),
                ),
                style: {
                  "font-size": "13px",
                },
                attributes: { n: props.name + "-status" },
              },
              [status_text_],
            ),
            View(
              {
                class: "box-border text-muted",
                style: {
                  margin: "7px 0 0",
                  "font-size": "11px",
                  "line-height": "1.6",
                },
                attributes: { n: props.name + "-meta" },
              },
              [meta_],
            ),
            Show({
              when: output_visible_,
              ok() {
                return View(
                  {
                    class:
                      "box-border overflow-auto rounded-control bg-surface-raised text-muted whitespace-pre-wrap break-anywhere",
                    style: {
                      "max-height": "320px",
                      margin: "12px 0 0",
                      padding: "12px",
                      font: "11px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace",
                    },
                    attributes: { n: props.name + "-output" },
                  },
                  [output_],
                );
              },
            }),
          ];
        },
      }),
    ],
  );
}

function TestResultView(props) {
  return TaskResultView({
    name: "api-test",
    result: props.test,
    submitting_text: "正在发起测试调用…",
    status_labels: {
      queued: "等待目标设备接收调用",
      assigned: "调用已推送，等待设备确认",
      running: "目标设备正在获取数据",
      completed: "测试成功：设备已获取并提交数据",
      failed: "测试失败",
    },
  });
}

function DownloadResultView(props) {
  return TaskResultView({
    name: "api-download",
    result: props.download,
    submitting_text: "正在发起 API 下载调用…",
    status_labels: {
      queued: "等待下载设备接收调用",
      assigned: "下载调用已推送，等待设备确认",
      running: "目标设备正在创建本地下载任务",
      completed: "提交成功：目标设备已创建并启动本地下载任务",
      failed: "下载任务提交失败",
    },
  });
}

function DownloadPanelView(props) {
  const vm$ = props.store;
  const device_id = props.device_id;
  const download_select_entries_ = computed(
    props.download_devices,
    (download_devices) =>
      device_select_entries(
        download_devices,
        "没有在线且支持 download.create 的设备",
      ),
  );
  const panel_visible_ = computed(props.test, (test) =>
    Boolean(test.task && test.task.status === "completed"),
  );
  const download_ = computed(props.test, (test) => test.download || {});
  const active_ = computed(download_, (download) =>
    Boolean(
      download.submitting ||
      (download.task &&
        !["completed", "failed"].includes(download.task.status)),
    ),
  );
  const disabled_ = combine(
    { active: active_, devices: props.download_devices },
    ({ active, devices }) => active || devices.length === 0,
  );
  const target_device_id_ = computed(props.draft, (draft) =>
    String(draft.target_device_id || ""),
  );
  const download_dir_ = computed(props.draft, (draft) =>
    String(draft.download_dir || ""),
  );
  const filename_ = computed(props.draft, (draft) =>
    String(draft.filename || ""),
  );
  const submit_label_ = computed(active_, (active) =>
    active ? "提交中…" : "发起下载调用",
  );

  return Show({
    when: panel_visible_,
    ok() {
      return View(
        {
          class: "box-border",
          style: {
            "margin-top": "16px",
            "padding-top": "16px",
            "border-top": "1px solid var(--frui-color-border-soft)",
          },
          attributes: { n: "api-download-panel" },
        },
        [
          View(
            {
              class: "box-border m-0",
              style: {
                "font-size": "15px",
              },
              attributes: { n: "api-download-title" },
            },
            ["将获取内容提交给下载设备"],
          ),
          View(
            {
              class: "box-border text-muted",
              style: {
                margin: "7px 0 14px",
                "font-size": "12px",
                "line-height": "1.6",
              },
              attributes: { n: "api-download-description" },
            },
            [
              "把上一步回传的 content 作为 args 调用 download.create；成功后目标设备会创建并自动启动本地下载任务。",
            ],
          ),
          View(
            {
              class:
                "box-border grid items-end rounded-card bg-surface max-760-grid-template-columns",
              style: {
                "grid-template-columns":
                  "minmax(170px, .8fr) minmax(180px, 1fr) minmax(150px, .8fr) auto",
                gap: "10px",
                padding: "16px",
                border: "1px solid var(--frui-color-border-soft)",
                "--max-760-grid-template-columns": "1fr",
              },
              attributes: { n: "api-download-form" },
            },
            [
              View(
                {
                  class: "box-border grid text-muted",
                  style: {
                    gap: "6px",
                    "font-size": "11px",
                  },
                  attributes: { n: "api-download-device-field" },
                },
                [
                  "下载设备",
                  For({
                    key: "key",
                    each: download_select_entries_,
                    render(entry_value) {
                      const entry = source_value(entry_value);
                      return Select({
                        class:
                          "box-border w-full min-w-0 rounded-control bg-surface text-text font-inherit",
                        style: {
                          padding: "10px 11px",
                        },
                        value: target_device_id_,
                        options: entry.options,
                        attributes: {
                          n: "api-download-device-select",
                          "aria-label": "下载设备",
                        },
                        onChange(event) {
                          vm$.methods.setDownloadDraft(
                            device_id,
                            "target_device_id",
                            String(event.target.value),
                          );
                        },
                      });
                    },
                  }),
                ],
              ),
              View(
                {
                  class: "box-border grid text-muted",
                  style: {
                    gap: "6px",
                    "font-size": "11px",
                  },
                  attributes: { n: "api-download-directory-field" },
                },
                [
                  "下载目录（可选）",
                  Input({
                    class:
                      "box-border w-full min-w-0 rounded-control bg-surface text-text font-inherit",
                    style: {
                      padding: "10px 11px",
                    },
                    value: download_dir_,
                    placeholder: "留空使用目标设备默认目录",
                    attributes: {
                      n: "api-download-directory-input",
                      "aria-label": "下载目录（可选）",
                    },
                    onInput(event) {
                      vm$.methods.setDownloadDraft(
                        device_id,
                        "download_dir",
                        String(event.target.value),
                      );
                    },
                  }),
                ],
              ),
              View(
                {
                  class: "box-border grid text-muted",
                  style: {
                    gap: "6px",
                    "font-size": "11px",
                  },
                  attributes: { n: "api-download-filename-field" },
                },
                [
                  "文件名（可选）",
                  Input({
                    class:
                      "box-border w-full min-w-0 rounded-control bg-surface text-text font-inherit",
                    style: {
                      padding: "10px 11px",
                    },
                    value: filename_,
                    placeholder: "留空使用内容标题",
                    attributes: {
                      n: "api-download-filename-input",
                      "aria-label": "文件名（可选）",
                    },
                    onInput(event) {
                      vm$.methods.setDownloadDraft(
                        device_id,
                        "filename",
                        String(event.target.value),
                      );
                    },
                  }),
                ],
              ),
              Button(
                {
                  class: "box-border",
                  attributes: {
                    n: "api-download-submit-button",
                  },
                  disabled: disabled_,
                  onClick() {
                    return vm$.methods.runDownloadTest(device_id);
                  },
                },
                [submit_label_],
              ),
            ],
          ),
          DownloadResultView({ download: download_ }),
        ],
      );
    },
  });
}

function TestPanelView(props) {
  const vm$ = props.store;
  const device_id = props.device_id;
  const active_ = computed(props.test, (test) =>
    Boolean(
      test.submitting ||
      (test.task && !["completed", "failed"].includes(test.task.status)),
    ),
  );
  const disabled_ = combine(
    { active: active_, device: props.device },
    ({ active, device }) => active || !device.can_test,
  );
  const url_ = computed(props.draft, (draft) => String(draft.url || ""));
  const submit_label_ = computed(active_, (active) =>
    active ? "测试中…" : "发起测试调用",
  );

  return View(
    {
      class: "box-border rounded-card bg-surface",
      style: {
        margin: "18px 22px 22px",
        padding: "18px",
      },
      attributes: { n: "api-test-panel" },
    },
    [
      View(
        {
          class: "box-border m-0",
          style: {
            "font-size": "15px",
          },
          attributes: { n: "api-test-title" },
        },
        ["调用此设备的 wxchannels.fetch 方法"],
      ),
      View(
        {
          class: "box-border text-muted",
          style: {
            margin: "7px 0 14px",
            "font-size": "12px",
            "line-height": "1.6",
          },
          attributes: { n: "api-test-description" },
        },
        [
          "发起真实调用并观察当前设备是否接收、获取视频号数据并把结果提交回 API。",
        ],
      ),
      View(
        {
          class:
            "box-border grid items-end rounded-card bg-surface max-760-grid-template-columns",
          style: {
            "grid-template-columns": "minmax(260px, 1fr) auto",
            gap: "10px",
            padding: "16px",
            border: "1px solid var(--frui-color-border-soft)",
            "--max-760-grid-template-columns": "1fr",
          },
          attributes: { n: "api-test-form" },
        },
        [
          View(
            {
              class: "box-border grid text-muted",
              style: {
                gap: "6px",
                "font-size": "11px",
              },
              attributes: { n: "api-test-url-field" },
            },
            [
              "视频号 URL",
              Input({
                class:
                  "box-border w-full min-w-0 rounded-control bg-surface text-text font-inherit",
                style: {
                  padding: "10px 11px",
                },
                value: url_,
                placeholder: "https://channels.weixin.qq.com/...",
                type: "url",
                attributes: {
                  n: "api-test-url-input",
                  "aria-label": "视频号 URL",
                },
                onInput(event) {
                  vm$.methods.setTestDraft(
                    device_id,
                    "url",
                    String(event.target.value),
                  );
                },
              }),
            ],
          ),
          Button(
            {
              class: "box-border",
              attributes: {
                n: "api-test-submit-button",
              },
              disabled: disabled_,
              onClick() {
                return vm$.methods.runTest(device_id);
              },
            },
            [submit_label_],
          ),
        ],
      ),
      TestResultView({ test: props.test }),
      DownloadPanelView({
        store: vm$,
        device_id,
        download_devices: props.download_devices,
        test: props.test,
        draft: props.download_draft,
      }),
    ],
  );
}

function format_os(value) {
  const labels = {
    darwin: "macOS",
    linux: "Linux",
    windows: "Windows",
    freebsd: "FreeBSD",
  };
  return labels[value] || value || "未知系统";
}

function DeviceView(props) {
  const vm$ = props.store;
  const device_ = props.device;
  const device_id = String(device_.value.device_id);
  const status_ = computed(device_, (device) => device.status);

  const status_label_ = computed(status_, (status) => {
    const labels = {
      online: "在线",
      busy: "执行调用",
      offline: "离线",
      disabled: "已禁用",
    };
    return labels[status] || "离线";
  });

  const device_name_ = computed(device_, (device) => device.device_name);
  const os_label_ = computed(device_, (device) => format_os(device.device_os));
  const capacity_label_ = computed(
    device_,
    (device) =>
      String(device.active_tasks) +
      "/" +
      String(device.max_concurrency) +
      " 并发",
  );
  const activity_text_ = computed(device_, (device) =>
    device.disabled
      ? "最近活跃 " + format_time(device.last_seen_at)
      : device.status === "offline"
        ? "最近活跃 " +
          format_time(device.last_seen_at) +
          " · 离线于 " +
          format_time(device.disconnected_at)
        : "连接于 " +
          format_time(device.connected_at) +
          " · 最近活跃 " +
          format_time(device.last_seen_at),
  );
  const disabled_ = computed(device_, (device) => Boolean(device.disabled));
  const action_ = computed(
    vm$.state.device_actions,
    (actions) => actions[device_id] || {},
  );
  const action_error_ = computed(action_, (action) =>
    String(action.error || ""),
  );
  const action_busy_ = computed(
    action_,
    (action) => Boolean(action.toggling) || Boolean(action.deleting),
  );
  const toggle_button_label_ = computed(action_, (action) =>
    action.toggling ? "处理中…" : "禁用",
  );
  const enable_button_label_ = computed(action_, (action) =>
    action.toggling ? "处理中…" : "启用",
  );
  const delete_button_label_ = computed(action_, (action) =>
    action.deleting ? "删除中…" : "删除",
  );
  const reset_action_ = computed(
    vm$.state.device_reset_actions,
    (actions) => actions[device_id] || {},
  );
  const reset_button_label_ = computed(reset_action_, (action) =>
    action.submitting ? "重置中…" : "强制重置",
  );
  const reset_button_disabled_ = computed(reset_action_, (action) =>
    Boolean(action.submitting),
  );
  const reset_error_ = computed(reset_action_, (action) =>
    String(action.error || ""),
  );
  const methods_ = computed(device_, (device) => device.methods);
  const test_visible_ = computed(
    device_,
    (device) => !device.disabled && device.methods.includes("wxchannels.fetch"),
  );
  const test_ = computed(vm$.state.tests, (tests) => tests[device_id] || {});
  const test_draft_ = computed(
    vm$.state.test_drafts,
    (drafts) => drafts[device_id] || { url: "" },
  );
  const download_draft_ = computed(
    vm$.state.download_drafts,
    (drafts) =>
      drafts[device_id] || {
        target_device_id: "",
        download_dir: "",
        filename: "",
      },
  );

  return View(
    {
      class: computed(
        status_,
        (status) =>
          "box-border " +
          ("bg-surface box-shadow-shadow-card rounded-card overflow-hidden " +
            (status === "offline"
              ? ""
              : status === "disabled"
                ? "border-color-border-soft"
                : status === "busy"
                  ? "border-color-border-soft"
                  : "")),
      ),
      style: computed(status_, (status) => ({
        "backdrop-filter": "blur(18px)",
        border: "1px solid var(--frui-color-border)",
        opacity:
          status === "offline" ? ".76" : status === "disabled" ? ".7" : "",
      })),
      attributes: {
        n: "device-card",
        "data-device-id": device_id,
      },
    },
    [
      View(
        {
          class:
            "box-border flex justify-between items-center max-760-align-items max-760-flex-direction",
          style: {
            gap: "18px",
            padding: "20px 22px",
            "border-bottom": "1px solid var(--frui-color-border-soft)",
            "--max-760-align-items": "flex-start",
            "--max-760-flex-direction": "column",
          },
          attributes: { n: "device-card-header" },
        },
        [
          View({ class: "box-border", attributes: { n: "device-identity" } }, [
            View(
              {
                class: "box-border break-anywhere",
                style: {
                  "font-size": "20px",
                  "font-weight": "720",
                  "line-height": "1.3",
                },
                attributes: { n: "device-name" },
              },
              [device_name_],
            ),
            View(
              {
                class: "box-border text-muted break-anywhere",
                style: {
                  "margin-top": "6px",
                  font: "12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace",
                },
                attributes: { n: "device-meta" },
              },
              [os_label_, " · ", device_id, " · ", capacity_label_],
            ),
            View(
              {
                class: "box-border text-muted",
                style: {
                  "margin-top": "5px",
                  "font-size": "11px",
                },
                attributes: { n: "device-activity-time" },
              },
              [activity_text_],
            ),
          ]),
          View(
            {
              class:
                "box-border flex flex-none items-center max-760-width max-760-justify-content",
              style: {
                gap: "12px",
                "--max-760-width": "100%",
                "--max-760-justify-content": "space-between",
              },
              attributes: { n: "device-header-actions" },
            },
            [
              View(
                {
                  class: computed(
                    status_,
                    (status) =>
                      "box-border " +
                      ("inline-flex items-center whitespace-nowrap " +
                        (status === "online"
                          ? "text-success"
                          : status === "busy"
                            ? "text-warning"
                            : status === "offline"
                              ? "text-muted"
                              : status === "disabled"
                                ? "text-muted"
                                : "")),
                  ),
                  style: {
                    gap: "8px",
                    "font-size": "13px",
                  },
                  attributes: { n: "device-connection-status" },
                },
                [status_label_],
              ),
              Button(
                {
                  class: "box-border flex-none justify-self-center",
                  style: {
                    "min-width": "64px",
                  },
                  attributes: {
                    n: "open-device-log-drawer-button",
                    "aria-label": "查看设备日志",
                  },
                  onClick() {
                    vm$.methods.openDeviceLogDrawer(device_id);
                  },
                },
                ["日志"],
              ),
              Show({
                when: disabled_,
                ok() {
                  return Button(
                    {
                      class: "box-border flex-none justify-self-center",
                      style: {
                        "min-width": "64px",
                      },
                      attributes: {
                        n: "enable-device-button",
                        "aria-label": "解除设备禁用",
                      },
                      disabled: action_busy_,
                      onClick() {
                        return vm$.methods.toggleDeviceDisabled(device_id);
                      },
                    },
                    [enable_button_label_],
                  );
                },
                else() {
                  return Button(
                    {
                      class: "box-border flex-none justify-self-center",
                      style: {
                        "min-width": "64px",
                      },
                      attributes: {
                        n: "disable-device-button",
                        "aria-label": "禁用设备",
                      },
                      disabled: action_busy_,
                      onClick() {
                        return vm$.methods.toggleDeviceDisabled(device_id);
                      },
                    },
                    [toggle_button_label_],
                  );
                },
              }),
              Popconfirm({
                title: computed(device_, device => `删除设备“${device.device_name}”？会断开其连接、终止未完成的调用并清除设备日志，此操作无法撤销。`),
                disabled: action_busy_, attributes: { n: "delete-device-confirmation" },
                onConfirm: () => vm$.methods.deleteDevice(device_id),
                trigger: props => Button({ ...props, class: "box-border flex-none", style: { "min-width": "64px" }, disabled: action_busy_,
                  attributes: { ...props.attributes, n: "delete-device-button", "aria-label": "删除设备" } }, [delete_button_label_]),
              }),
            ],
          ),
        ],
      ),
      Show({
        when: computed(action_error_, Boolean),
        ok() {
          return View(
            {
              class: "box-border text-danger",
              style: {
                padding: "12px 22px 0",
                "font-size": "11px",
              },
              attributes: { n: "device-action-error", role: "alert" },
            },
            [action_error_],
          );
        },
      }),
      Show({
        when: computed(status_, (status) => status === "busy"),
        ok() {
          return View(
            {
              class: "box-border flex items-center",
              style: {
                gap: "10px",
                padding: "12px 22px 0",
              },
              attributes: { n: "device-reset-actions" },
            },
            [
              Button(
                {
                  class: "box-border flex-none",
                  attributes: { n: "reset-device-button" },
                  disabled: reset_button_disabled_,
                  onClick() {
                    return vm$.methods.resetDevice(device_id);
                  },
                },
                [reset_button_label_],
              ),
              Show({
                when: computed(reset_error_, Boolean),
                ok() {
                  return View(
                    {
                      class: "box-border text-danger",
                      style: {
                        "font-size": "11px",
                      },
                      attributes: { n: "device-reset-error", role: "alert" },
                    },
                    [reset_error_],
                  );
                },
              }),
            ],
          );
        },
      }),
      View(
        {
          class: "box-border grid",
          style: {
            gap: "9px",
            padding: "16px 22px 0",
          },
          attributes: { n: "device-method-section" },
        },
        [
          View(
            {
              class: "box-border text-muted text-transform-uppercase",
              style: {
                "font-size": "11px",
                "font-weight": "680",
                "letter-spacing": ".08em",
              },
              attributes: { n: "device-method-label" },
            },
            ["可调用方法"],
          ),
          View(
            {
              class: "box-border flex flex-wrap",
              style: {
                gap: "6px",
              },
              attributes: { n: "device-methods" },
            },
            [
              Show({
                when: computed(methods_, (methods) => methods.length === 0),
                ok() {
                  return View(
                    {
                      class:
                        "box-border rounded-pill bg-surface-raised text-muted",
                      style: {
                        "font-size": "12px",
                        padding: "5px 8px",
                      },
                      attributes: { n: "empty-device-method" },
                    },
                    ["仅发布调用"],
                  );
                },
              }),
              For({
                each: methods_,
                render(method_value) {
                  return View(
                    {
                      class: "box-border rounded-pill bg-selected text-link",
                      style: {
                        "font-size": "12px",
                        padding: "5px 8px",
                      },
                      attributes: { n: "device-method" },
                    },
                    [String(source_value(method_value))],
                  );
                },
              }),
            ],
          ),
        ],
      ),
      Show({
        when: test_visible_,
        ok() {
          return TestPanelView({
            store: vm$,
            device: device_,
            device_id,
            download_devices: vm$.state.download_devices,
            test: test_,
            draft: test_draft_,
            download_draft: download_draft_,
          });
        },
      }),
    ],
  );
}

function DeviceListView(props) {
  const vm$ = props.store;

  return View(
    {
      class: "box-border grid",
      style: {
        gap: "14px",
      },
      attributes: {
        n: "device-list",
        "aria-label": "操作系统设备列表",
      },
    },
    [
      Show({
        when: computed(vm$.state.devices, (devices) => devices.length === 0),
        ok() {
          return View(
            {
              class: "box-border rounded-card text-center m-0 text-muted",
              style: {
                padding: "8px 0",
              },
              attributes: { n: "empty-device-list" },
            },
            ["尚无设备注册。请在一台操作系统中启用设备连接。"],
          );
        },
      }),
      For({
        key: "device_id",
        each: vm$.state.devices,
        render(device_value, index_) {
          const device_id = String(source_value(device_value).device_id);
          return DeviceView({
            store: vm$,
            device: vm$.methods.deviceSource(device_id, index_.value),
          });
        },
      }),
    ],
  );
}

function DeviceTokensView(model) {
  const field = (name, label, max_length) =>
    View(
      {
        class: "box-border grid text-muted",
        style: {
          gap: "6px",
          "font-size": "11px",
        },
        attributes: { n: "device-token-" + name + "-field" },
      },
      [
        label,
        Input({
          class: "box-border",
          value: computed(model.draft, (value) => value[name]),
          attributes: {
            n: "device-token-" + name + "-input",
            "aria-label": label,
            maxlength: max_length,
          },
          onInput(event) {
            model.set_draft(name, event.target.value);
          },
        }),
      ],
    );
  return View(
    {
      class:
        "box-border rounded-card p-0 bg-transparent box-shadow-none backdrop-filter-none m-0 border-0",
      style: {
        "margin-bottom": "22px",
      },
      attributes: { n: "device-token-management" },
    },
    [
      Show({
        when: computed(model.created, value => Boolean(value.token)),
        ok: () => Dialog({
          open: true,
          title: "Device Token 已创建",
          description: "复制此 Token 用于设备连接。关闭弹窗后，也可在列表中再次查看明文。",
          attributes: { n: "device-token-created-dialog", "aria-label": "Device Token 已创建" },
          onClose: model.close_created,
          footer: [
            Timeless.CopyButton({
              label: "复制设备 Token",
              attributes: { n: "copy-created-device-token-button" },
              onCopy: model.copy_created,
              onError: model.copy_error,
            }),
            Button({
              attributes: { n: "close-created-device-token-button" },
              onClick: model.close_created,
            }, ["关闭"]),
          ],
        }, [
          View({ class: "box-border text-muted break-anywhere", attributes: { n: "device-token-created-name" } }, [
            computed(model.created, value => value.name),
          ]),
          View({ as: "code", class: "box-border block break-anywhere padding-space-3 bg-surface-raised rounded-card", attributes: { n: "device-token-created-value" } }, [
            computed(model.created, value => value.token),
          ]),
          Show({
            when: computed(model.error, Boolean),
            ok: () => View({ class: "box-border text-danger", attributes: { n: "device-token-created-error", role: "alert" } }, [model.error]),
          }),
        ]),
      }),
      View(
        {
          class:
            "box-border flex items-flex-start justify-between max-760-align-items max-760-flex-direction",
          style: {
            gap: "20px",
            "--max-760-align-items": "flex-start",
            "--max-760-flex-direction": "column",
          },
          attributes: { n: "device-token-heading" },
        },
        [
          View(
            {
              class: "box-border",
              as: "h2",
              attributes: { n: "device-token-title" },
            },
            ["Device Token"],
          ),
          Button(
            {
              class: "box-border",
              disabled: model.busy,
              attributes: { n: "refresh-device-tokens-button" },
              onClick: model.refresh,
            },
            ["刷新"],
          ),
        ],
      ),
      View(
        {
          class: "box-border text-muted",
          style: {
            "max-width": "720px",
            "margin-top": "7px",
            "font-size": "12px",
            "line-height": "1.6",
          },
          attributes: { n: "device-token-description" },
        },
        [
          "用于设备连接，可为不同设备创建独立 Token。明文默认隐藏，查看后 30 秒自动隐藏；到期或撤销后连接失效。",
        ],
      ),
      View(
        {
          class:
            "box-border grid items-end rounded-card bg-surface max-760-grid-template-columns",
          style: {
            "grid-template-columns": "repeat(2, minmax(0, 1fr))",
            gap: "10px",
            "margin-top": "18px",
            "padding-top": "18px",
            "border-top": "1px solid var(--frui-color-border-soft)",
            padding: "16px",
            border: "1px solid var(--frui-color-border-soft)",
            "--max-760-grid-template-columns": "1fr",
          },
          attributes: { n: "device-token-create-form" },
        },
        [
          field("name", "名称", 80),
          field("note", "备注", 256),
          View(
            {
              class: "box-border grid text-muted",
              style: {
                gap: "6px",
                "font-size": "11px",
              },
              attributes: { n: "device-token-expiry-field" },
            },
            [
              "有效期",
              Select({
                class: "box-border",
                value: computed(
                  model.draft,
                  (value) => value.expires_in_seconds,
                ),
                attributes: {
                  n: "device-token-expiry-select",
                  "aria-label": "Device Token 有效期",
                },
                options: [
                  { value: "604800", label: "7 天" },
                  { value: "2592000", label: "30 天" },
                  { value: "7776000", label: "90 天" },
                  { value: "31536000", label: "1 年" },
                  { value: "", label: "永不过期" },
                ],
                onChange(event) {
                  model.set_draft(
                    "expires_in_seconds",
                    String(event.target.value),
                  );
                },
              }),
            ],
          ),
          Button(
            {
              class: "box-border",
              disabled: model.busy,
              attributes: { n: "create-device-token-button" },
              onClick: model.create,
            },
            ["创建 Device Token"],
          ),
        ],
      ),
      Show({
        when: computed(model.error, Boolean),
        ok: () =>
          View(
            {
              class:
                "box-border block rounded-card bg-danger-bg text-danger whitespace-pre-wrap",
              style: {
                margin: "0 0 18px",
                padding: "14px 16px",
              },
              attributes: { n: "device-token-error", role: "alert" },
            },
            [model.error],
          ),
      }),
      Show({
        when: computed(model.tokens, (values) => values.length === 0),
        ok: () =>
          View(
            {
              class: "box-border m-0 text-muted",
              style: {
                padding: "8px 0",
              },
              attributes: { n: "device-token-empty" },
            },
            ["尚无设备 Token，请先创建。 "],
          ),
      }),
      For({
        each: model.tokens,
        render(token_ref) {
          const token = source_value(token_ref);
          const plaintext = computed(
            model.revealed,
            (values) => values[token.id] || "",
          );
          return View(
            {
              class:
                "box-border grid items-center rounded-card bg-surface-raised max-760-grid-template-columns",
              style: {
                "grid-template-columns": "minmax(0, 1fr) auto",
                gap: "18px",
                padding: "14px 15px",
                "margin-top": "14px",
                border: "1px solid var(--frui-color-border)",
                "--max-760-grid-template-columns": "minmax(0, 1fr)",
              },
              attributes: { n: "device-token-card", "data-token-id": token.id },
            },
            [
              View(
                {
                  class: "box-border",
                  attributes: { n: "device-token-details" },
                },
                [
                  View(
                    {
                      class: "box-border break-anywhere",
                      style: {
                        "font-size": "20px",
                        "font-weight": "720",
                        "line-height": "1.3",
                      },
                      attributes: { n: "device-token-name" },
                    },
                    [token.name],
                  ),
                  View(
                    {
                      class: "box-border text-muted break-anywhere",
                      style: {
                        "margin-top": "6px",
                        font: "12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace",
                      },
                      attributes: { n: "device-token-status" },
                    },
                    [
                      { active: "有效", expired: "已过期", revoked: "已撤销" }[
                        token.status
                      ] +
                        " · " +
                        (token.expires_at
                          ? "到期 " + format_time(token.expires_at)
                          : "永不过期"),
                    ],
                  ),
                  View(
                    {
                      class: "box-border text-muted break-anywhere",
                      style: {
                        "margin-top": "6px",
                        font: "12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace",
                      },
                      attributes: { n: "device-token-note" },
                    },
                    [token.note || "无备注"],
                  ),
                  View(
                    {
                      class: "box-border text-muted",
                      style: {
                        "margin-top": "5px",
                        "font-size": "11px",
                      },
                      attributes: { n: "device-token-time" },
                    },
                    [
                      "创建 " +
                        format_time(token.created_at) +
                        " · 最近使用 " +
                        (token.last_used_at
                          ? format_time(token.last_used_at)
                          : "从未使用"),
                    ],
                  ),
                  Show({
                    when: computed(plaintext, Boolean),
                    ok: () => View(
                      {
                        as: "code",
                        class: "box-border block break-anywhere",
                        style: {
                          "margin-top": "8px",
                        },
                        attributes: { n: "device-token-value" },
                      },
                      [plaintext],
                    ),
                  }),
                ],
              ),
              View(
                {
                  class:
                    "box-border flex flex-wrap justify-end max-760-justify-content",
                  style: {
                    gap: "8px",
                    "--max-760-justify-content": "flex-start",
                  },
                  attributes: { n: "device-token-actions" },
                },
                [
                  Button(
                    {
                      class: "box-border",
                      disabled: computed(
                        model.busy,
                        (value) => value || token.status === "revoked",
                      ),
                      attributes: { n: "preview-device-token-button" },
                      onClick: () => model.reveal(token.id),
                    },
                    [
                      computed(plaintext, (value) =>
                        value ? "隐藏明文" : "查看明文",
                      ),
                    ],
                  ),
                  Timeless.CopyButton({
                    label: "复制设备 Token",
                    disabled: computed(plaintext, (value) => !value),
                    attributes: { n: "copy-device-token-button" },
                    onCopy: () => model.copy(token.id),
                    onError: model.copy_error,
                  }),
                  Button(
                    {
                      class: "box-border",
                      disabled: model.busy,
                      attributes: { n: "edit-device-token-note-button" },
                      onClick: () => model.edit_note(token),
                    },
                    ["编辑备注"],
                  ),
                  Popconfirm({
                    title: `撤销设备 Token“${token.name}”？使用它的设备将断开连接，此操作无法撤销。`, confirmText: "确认撤销",
                    disabled: computed(model.busy, value => value || token.status === "revoked"),
                    attributes: { n: "revoke-device-token-confirmation" }, onConfirm: () => model.revoke(token),
                    trigger: props => Button({ ...props, class: "box-border flex-none",
                      disabled: computed(model.busy, value => value || token.status === "revoked"),
                      attributes: { ...props.attributes, n: "revoke-device-token-button" } }, ["撤销"]),
                  }),
                ],
              ),
            ],
          );
        },
      }),
    ],
  );
}

function DashboardApplicationView(page_id = "overview", embedded = false, route_view) {
  const is_device_page = page_id === "devices";
  const is_token_page = page_id === "tokens";
  const vm$ = DashboardViewModel(page_id);
  let stop_hide, stop_show;
  const device_tokens = is_device_page
    ? DeviceTokensModel()
    : null;
  const refresh_disabled_ = computed(vm$.state.loading, (loading) =>
    loading ? true : undefined,
  );

  const header_actions = is_token_page ? [Button({
      class: "box-border",
      attributes: { n: "open-access-token-create-button" },
      disabled: computed(vm$.state.access_token_action, action => action.creating),
      onClick: vm$.methods.openAccessTokenForm,
    }, ["创建 Token"])] : [
    View(
      {
        class:
          "box-border text-muted tabular-nums text-right whitespace-nowrap max-760-width max-760-text-align max-900-width max-900-text-align max-640-grid-column max-640-min-width",
        style: {
          "min-width": "180px",
          "font-size": "13px",
          "--max-760-width": "100%",
          "--max-760-text-align": "left",
          "--max-900-width": "100%",
          "--max-900-text-align": "left",
          "--max-640-grid-column": "1 / -1",
          "--max-640-min-width": "0",
        },
        attributes: { n: "refresh-status" },
      },
      [vm$.state.refresh_status],
    ),
    ...(is_device_page
      ? [
          Button(
            {
              class: "box-border flex-none justify-self-center",
              attributes: { n: "open-device-token-management-button" },
              onClick: device_tokens.toggle,
            },
            [
              computed(device_tokens.open, (open) =>
                open ? "收起 Device Token" : "Device Token",
              ),
            ],
          ),
        ]
      : []),
    Button(
      {
        class: "box-border",
        attributes: { n: "refresh-button" },
        disabled: refresh_disabled_,
        onClick() {
          return vm$.methods.refresh();
        },
      },
      [
        computed(vm$.state.loading, (loading) =>
          loading ? "正在刷新…" : "立即刷新",
        ),
      ],
    ),
  ];

  const content = View(
    {
      class: "box-border",
      attributes: {
        n: is_device_page ? "device-management-view" : is_token_page ? "token-management-view" : "dashboard-view",
      },
      onMounted() {
        stop_show = route_view?.onShow?.(vm$.methods.ready);
        stop_hide = route_view?.onBeforeHide(vm$.methods.pause);
        vm$.methods.ready();
      },
      onUnmounted() {
        stop_hide?.(); stop_show?.();
        device_tokens?.dispose();
        vm$.methods.dispose();
      },
    },
    is_device_page
      ? [
          MetricsView({ metrics: vm$.state.metrics, devices_only: true }),
          Show({
            when: device_tokens.open,
            ok: () => DeviceTokensView(device_tokens),
          }),
          Show({
            when: computed(vm$.state.error, Boolean),
            ok() {
              return View(
                {
                  class:
                    "box-border block rounded-card bg-danger-bg text-danger whitespace-pre-wrap",
                  style: {
                    margin: "0 0 18px",
                    padding: "14px 16px",
                  },
                  attributes: { n: "dashboard-error", role: "alert" },
                },
                [vm$.state.error],
              );
            },
          }),
          DeviceListView({ store: vm$ }),
          DeviceLogDrawerView({ store: vm$ }),
          ConfirmDialogView({ store: vm$ }),
        ]
      : [
          Show({
            when: computed(vm$.state.error, Boolean),
            ok() {
              return View(
                {
                  class:
                    "box-border block rounded-card bg-danger-bg text-danger whitespace-pre-wrap",
                  style: {
                    margin: "0 0 18px",
                    padding: "14px 16px",
                  },
                  attributes: { n: "dashboard-error", role: "alert" },
                },
                [vm$.state.error],
              );
            },
          }),
          ...(is_token_page
            ? [
                AccessTokenManagementView({ store: vm$ }),
                PaginationView(Timeless, { model: vm$.token_pagination, name: "access-token-pagination", label: "Token 分页" }),
                ConfirmDialogView({ store: vm$ }),
              ]
            : [
                MetricsView({ metrics: vm$.state.metrics }),
                SourceCallsView({ sources: vm$.paged_source_calls, pagination: vm$.source_calls_pagination }),
                View(
                  {
                    class: "box-border text-muted text-center",
                    style: {
                      "margin-top": "22px",
                      "font-size": "12px",
                    },
                    attributes: { n: "dashboard-footer" },
                  },
                  ["统计快照每 5 分钟生成一次，生成后自动更新，也可手动刷新"],
                ),
              ]),
        ],
  );

  const page_options = {
    page_id,
    eyebrow: "Durable Objects Control Plane",
    title: is_device_page ? "设备管理" : is_token_page ? "Token" : "运行概览",
    count: is_device_page
      ? computed(vm$.state.devices, (devices) => String(devices.length))
      : is_token_page ? computed(vm$.token_pagination.total, String) : undefined,
    actions: header_actions,
  };
  return embedded
    ? window.FindRSSAdminShell.Page(page_options, [content])
    : window.FindRSSAdminShell.View(page_options, [content]);
}

function OverviewPage({ view } = {}) {
  return DashboardApplicationView("overview", true, view);
}

function DevicesPage({ view } = {}) {
  return DashboardApplicationView("devices", true, view);
}

function TokensPage({ view } = {}) {
  return DashboardApplicationView("tokens", true, view);
}

export { OverviewPage, DevicesPage, TokensPage, DeviceTokensView };
