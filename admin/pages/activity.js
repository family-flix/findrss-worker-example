import { source_value, UserActivityViewModel } from "./activity.model.js";

const Timeless = window.FindRSSAdminUI;

if (!Timeless || !Timeless.DOM || !window.FindRSSAdminAuth || !window.FindRSSAdminShell) {
  throw new Error("用户日志页无法启动：管理运行时未加载");
}
const { Button, For, Input, Show, View, combine, computed } = Timeless;

function format_time(value) {
  if (!value) return "—";
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? "未知" : date.toLocaleString();
}

function email_text(email) {
  return email ? email : "未绑定邮箱";
}

/** 行为标签：优先用账本里的 subject，缺失时按 note/method 兜底。 */
function credit_label(row) {
  const subject = String(row.subject || "").trim();
  if (subject !== "") return subject;
  const note = String(row.note || "").trim();
  if (note !== "") return note;
  const method = String(row.method || "").trim();
  return method !== "" ? "调用 " + method : "积分变动";
}

const event_type_labels = {
  login: "登录",
  register: "注册",
  verify_email: "邮箱验证",
  subscription_add: "订阅新增",
  subscription_remove: "订阅删除",
  refresh: "手动刷新",
  redeem: "兑换积分",
};

function event_label(row) {
  const type = String(row.type || "");
  return event_type_labels[type] || type || "操作";
}

function UserRowView({ store, user }) {
  const vm$ = store;
  const id = String(source_value(user).id || "");
  const selected = computed(vm$.state.selected_user_id, (current) => current === id);

  return Button(
    {
      class: computed(selected, active => "box-border " + ("grid rounded-card text-text text-left font-inherit cursor-pointer " + (active ? "bg-selected border-color-border-strong" : "bg-surface-raised"))), style: {
        "gap": "3px",
        "padding": "12px 14px",
        "border": "1px solid var(--frui-color-border)"
      },
      attributes: { n: "user-activity-user", "data-user-id": id, type: "button" },
      onClick() {
        vm$.methods.selectUser(id);
      },
    },
    [
      View({ class: "box-border break-anywhere", style: {
        "font-size": "14px",
        "font-weight": "680"
      }, attributes: { n: "user-activity-user-name" } }, [
        String(source_value(user).name || "Reader"),
      ]),
      View({ class: "box-border text-muted break-anywhere", style: {
        "font-size": "12px"
      }, attributes: { n: "user-activity-user-email" } }, [
        email_text(source_value(user).email),
      ]),
    ],
  );
}

function ActivityRowsView({ store }) {
  const vm$ = store;
  const show_credits_ = computed(vm$.state.kind, (kind) => kind !== "events");
  const show_events_ = computed(vm$.state.kind, (kind) => kind === "events");
  // 必须同时跟踪 loading：选中用户时 loading 已经翻成 true，只看数组的话「空列表」
  // 分支会被永久跳过（请求回来仍是空数组，computed 不会重算）。
  const empty_ = combine(
    { rows: vm$.state.rows, loading: vm$.state.loading },
    (deps) => deps.rows.length === 0 && !deps.loading,
  );
  const has_more_ = computed(vm$.state.cursor, (cursor) => String(cursor || "") !== "");
  const more_label_ = computed(vm$.state.more_loading, (busy) => (busy ? "正在加载…" : "加载更多"));
  const more_button_ = () =>
    Button(
      {
        class: "box-border flex-none justify-self-center",
        attributes: { n: "user-activity-more-button", type: "button" },
        disabled: computed(vm$.state.more_loading, (busy) => busy || undefined),
        onClick() {
          return vm$.methods.loadMore();
        },
      },
      [more_label_],
    );

  const credit_row = (row_value) => {
    const row = source_value(row_value);
    const amount = Number(row.amount) || 0;
    return View({ class: "box-border grid items-center rounded-card bg-surface-raised max-960-grid-template-columns", style: {
      "grid-template-columns": "minmax(150px, .9fr) minmax(140px, 1fr) auto auto",
      "gap": "12px",
      "padding": "10px 12px",
      "border": "1px solid var(--frui-color-border)",
      "--max-960-grid-template-columns": "minmax(0, 1fr) auto"
    }, attributes: { n: "user-activity-credit-row" } }, [
      View({ class: "box-border text-muted tabular-nums whitespace-nowrap", style: {
        "font-size": "11px"
      }, attributes: { n: "user-activity-credit-time" } }, [
        format_time(row.created_at),
      ]),
      View({ class: "box-border min-w-0 break-anywhere max-960-grid-column", style: {
        "font-size": "13px",
        "--max-960-grid-column": "1 / -1"
      }, attributes: { n: "user-activity-credit-label" } }, [
        credit_label(row),
      ]),
      View(
        {
          class: "box-border " + ("tabular-nums whitespace-nowrap " + (amount < 0 ? "text-danger" : amount >= 0 ? "text-success" : "")), style: {
            "font-size": "13px",
            "font-weight": "680"
          },
          attributes: { n: "user-activity-credit-amount" },
        },
        [(amount > 0 ? "+" : "") + String(amount)],
      ),
      View({ class: "box-border text-muted tabular-nums whitespace-nowrap", style: {
        "font-size": "12px"
      }, attributes: { n: "user-activity-credit-balance" } }, [
        "余额 " + String(Number(row.balance_after) || 0),
      ]),
    ]);
  };

  const event_row = (row_value) => {
    const row = source_value(row_value);
    const feed_url = String(row.metadata?.feed_url || "");
    return View({ class: "box-border grid items-center rounded-card bg-surface-raised max-960-grid-template-columns", style: {
      "grid-template-columns": "minmax(150px, .9fr) minmax(140px, 1fr) auto auto",
      "gap": "12px",
      "padding": "10px 12px",
      "border": "1px solid var(--frui-color-border)",
      "--max-960-grid-template-columns": "minmax(0, 1fr) auto"
    }, attributes: { n: "user-activity-event-row" } }, [
      View({ class: "box-border text-muted tabular-nums whitespace-nowrap", style: {
        "font-size": "11px"
      }, attributes: { n: "user-activity-event-time" } }, [
        format_time(row.created_at),
      ]),
      View({ class: "box-border min-w-0 break-anywhere max-960-grid-column", style: {
        "font-size": "13px",
        "--max-960-grid-column": "1 / -1"
      }, attributes: { n: "user-activity-event-label" } }, [
        event_label(row),
      ]),
      View({ class: "box-border min-w-0 text-muted break-anywhere max-960-grid-column", style: {
        "font-size": "12px",
        "--max-960-grid-column": "1 / -1"
      }, attributes: { n: "user-activity-event-subject" } }, [
        String(row.subject || feed_url),
      ]),
    ]);
  };

  return View({ class: "box-border grid", style: {
    "gap": "12px"
  }, attributes: { n: "user-activity-lists" } }, [
    View({ class: "box-border grid", style: {
      "gap": "10px"
    }, attributes: { n: "user-activity-credit-list" } }, [
      Show({
        when: show_credits_,
        ok() {
          return View({ class: "box-border grid", style: {
            "gap": "14px"
          }, attributes: { n: "user-activity-credit-rows" } }, [
            For({ each: vm$.state.rows, render: credit_row }),
            Show({
              when: empty_,
              ok() {
                return View({ class: "box-border rounded-card text-muted text-center", style: {
                  "padding": "24px",
                  "font-size": "13px"
                }, attributes: { n: "user-activity-credit-empty" } }, [
                  "暂无积分流水。",
                ]);
              },
            }),
            Show({ when: has_more_, ok: more_button_ }),
          ]);
        },
      }),
    ]),
    View({ class: "box-border grid", style: {
      "gap": "10px"
    }, attributes: { n: "user-activity-event-list" } }, [
      Show({
        when: show_events_,
        ok() {
          return View({ class: "box-border grid", style: {
            "gap": "14px"
          }, attributes: { n: "user-activity-event-rows" } }, [
            For({ each: vm$.state.rows, render: event_row }),
            Show({
              when: empty_,
              ok() {
                return View({ class: "box-border rounded-card text-muted text-center", style: {
                  "padding": "24px",
                  "font-size": "13px"
                }, attributes: { n: "user-activity-event-empty" } }, [
                  "暂无操作记录。",
                ]);
              },
            }),
            Show({ when: has_more_, ok: more_button_ }),
          ]);
        },
      }),
    ]),
  ]);
}

function UserActivityPage() {
  const vm$ = UserActivityViewModel();

  const has_selection_ = computed(vm$.state.selected_user_id, (id) => String(id) !== "");

  const content = View(
    {
      class: "box-border grid", style: {
        "gap": "14px"
      },
      attributes: { n: "user-activity-management" },
      onMounted() {
        vm$.methods.search();
      },
    },
    [
      Show({
        when: computed(vm$.state.error, Boolean),
        ok() {
          return View({ class: "box-border block rounded-card bg-danger-bg text-danger whitespace-pre-wrap", style: {
            "margin": "0 0 18px",
            "padding": "14px 16px"
          }, attributes: { n: "user-activity-error", role: "alert" } }, [
            vm$.state.error,
          ]);
        },
      }),
      View({ class: "box-border min-w-0", attributes: { n: "user-activity-panel" } }, [
        View({ class: "box-border flex items-stretch justify-between max-640-flex-direction", style: {
          "gap": "20px",
          "--max-640-flex-direction": "column"
        }, attributes: { n: "user-activity-panel-header" } }, [
          View({
            as: "form",
            class: "box-border flex items-center rounded-card bg-surface flex-1 min-w-0 max-640-width", style: {
              "gap": "9px",
              "padding": "16px",
              "border": "1px solid var(--frui-color-border-soft)",
              "--max-640-width": "100%"
            },
            attributes: { n: "user-activity-search-form" },
            onSubmit(event) {
              event.preventDefault();
              return vm$.methods.search();
            },
          }, [
            Input({
              class: "box-border min-w-0 max-640-flex max-640-width", style: {
                "width": "min(240px, 100%)",
                "--max-640-flex": "1",
                "--max-640-width": "auto"
              },
              value: vm$.state.search_text,
              placeholder: "按名称或邮箱搜索",
              attributes: { n: "user-activity-search-input", "aria-label": "搜索用户", maxlength: "100" },
              onInput(event) {
                vm$.methods.setSearchText(event.target.value);
              },
            }),
            Button(
              {
                class: "box-border flex-none justify-self-center",
                attributes: { n: "user-activity-search-button", type: "submit" },
                // Timeless 0.34.0 不渲染真实 <form>，submit 事件不会触发，提交必须走 onClick。
                onClick(event) {
                  event.preventDefault();
                  return vm$.methods.search();
                },
              },
              ["搜索"],
            ),
          ]),
        ]),
        Show({
          when: combine(
            { users: vm$.state.users, loading: vm$.state.users_loading },
            (deps) => deps.users.length === 0 && !deps.loading,
          ),
          ok() {
            return View({ class: "box-border rounded-card text-muted text-center", style: {
              "padding": "24px",
              "font-size": "13px"
            }, attributes: { n: "user-activity-users-empty" } }, [
              "没有找到用户",
            ]);
          },
        }),
        View({ class: "box-border grid", style: {
          "gap": "14px",
          "margin-top": "14px"
        }, attributes: { n: "user-activity-users" } }, [
          For({
            each: vm$.state.users,
            render(user) {
              return UserRowView({ store: vm$, user });
            },
          }),
        ]),
      ]),
      Show({
        when: has_selection_,
        ok() {
          return View({ class: "box-border rounded-card bg-surface grid", style: {
            "padding": "18px 20px",
            "gap": "14px"
          }, attributes: { n: "user-activity-detail" } }, [
            View({ class: "box-border grid", style: {
              "gap": "3px"
            }, attributes: { n: "user-activity-detail-header" } }, [
              View({ class: "box-border break-anywhere", style: {
                "font-size": "18px",
                "font-weight": "720"
              }, attributes: { n: "user-activity-detail-name" } }, [
                computed(vm$.state.selected_user, (user) => String(user.name || "Reader")),
              ]),
              View({ class: "box-border text-muted break-anywhere", style: {
                "font-size": "12px"
              }, attributes: { n: "user-activity-detail-email" } }, [
                computed(vm$.state.selected_user, (user) => email_text(user.email)),
              ]),
            ]),
            View({ class: "box-border flex flex-wrap", style: {
              "gap": "8px"
            }, attributes: { n: "user-activity-tabs" } }, [
              Button(
                {
                  class: computed(vm$.state.kind, kind => "box-border " + ("rounded-pill font-inherit cursor-pointer " + (kind === "credits" ? "bg-selected text-text border-color-border-soft" : "bg-surface-raised text-muted"))), style: {
                    "padding": "7px 14px",
                    "font-size": "12px"
                  },
                  attributes: { n: "user-activity-tab-credits", type: "button" },
                  onClick() {
                    vm$.methods.setKind("credits");
                  },
                },
                ["积分流水"],
              ),
              Button(
                {
                  class: computed(vm$.state.kind, kind => "box-border " + ("rounded-pill font-inherit cursor-pointer " + (kind === "events" ? "bg-selected text-text border-color-border-soft" : "bg-surface-raised text-muted"))), style: {
                    "padding": "7px 14px",
                    "font-size": "12px"
                  },
                  attributes: { n: "user-activity-tab-events", type: "button" },
                  onClick() {
                    vm$.methods.setKind("events");
                  },
                },
                ["操作记录"],
              ),
            ]),
            Show({
              when: computed(vm$.state.loading, (loading) => loading && vm$.state.rows.value.length === 0),
              ok() {
                return View({ class: "box-border rounded-card text-muted text-center", style: {
                  "padding": "24px",
                  "font-size": "13px"
                }, attributes: { n: "user-activity-loading" } }, [
                  "正在加载记录…",
                ]);
              },
            }),
            ActivityRowsView({ store: vm$ }),
          ]);
        },
      }),
    ],
  );

  return window.FindRSSAdminShell.Page(
    {
      page_id: "activity",
      eyebrow: "Activity & Credits",
      title: "用户日志",
      count: computed(vm$.state.users, users => users.length + " 位用户"),
    },
    [content],
  );
}

export { UserActivityPage };
