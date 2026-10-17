import { format_datetime } from "../../server/lib/datetime.js";
import { PaginationView } from "../components/pagination.js";
import { source_value, UsersViewModel } from "./users.model.js";

const Timeless = window.FindRSSAdminUI;

if (
  !Timeless ||
  !Timeless.DOM ||
  !window.FindRSSAdminAuth ||
  !window.FindRSSAdminShell
) {
  throw new Error("用户管理页无法启动：管理运行时未加载");
}
const { Button, For, Input, Popconfirm, Show, View, combine, computed } = Timeless;

function format_time(value) {
  return value ? format_datetime(value) : "—";
}

function email_text(email) {
  return email ? email : "未绑定邮箱";
}

function UserStatusBadgeView({ user }) {
  const email = source_value(user).email;
  const verified = Boolean(source_value(user).email_verified);
  if (!email) {
    return View(
      {
        class:
          "box-border rounded-pill whitespace-nowrap bg-surface-raised text-muted",
        style: {
          padding: "4px 9px",
          "font-size": "11px",
        },
        attributes: { n: "users-status-none" },
      },
      ["未绑定邮箱"],
    );
  }
  return View(
    {
      class:
        "box-border " +
        ("rounded-pill whitespace-nowrap " +
          (verified
            ? "bg-success-bg text-success"
            : !verified
              ? "bg-warning-bg text-warning"
              : "")),
      style: {
        padding: "4px 9px",
        "font-size": "11px",
      },
      attributes: { n: "users-email-status" },
    },
    [verified ? "邮箱已验证" : "邮箱未验证"],
  );
}

function UserCardView(props) {
  const vm$ = props.store;
  const user_ = props.user;
  const user = source_value(user_);
  const user_id = String(user.id);
  const expanded = computed(vm$.state.expanded_user_id, (id) => id === user_id);

  const busy_delete = computed(
    vm$.state.busy_action,
    (action) => vm$.state.busy_user_id.value === user_id && action === "delete",
  );
  const delete_label_ = computed(busy_delete, busy => busy ? "删除中…" : "删除");

  return View(
    {
      class: computed(
        expanded,
        (active) =>
          "box-border " +
          ("grid rounded-card " +
            (active
              ? "bg-selected border-color-border-strong"
              : "bg-surface-raised")),
      ),
      style: {
        border: "1px solid var(--frui-color-border)",
      },
      attributes: { n: "users-card", "data-user-id": user_id },
    },
    [
      View(
        {
          class:
            "box-border grid items-center max-960-grid-template-columns max-960-gap",
          style: {
            "grid-template-columns":
              "minmax(220px, 1.4fr) minmax(240px, auto) minmax(120px, .7fr)",
            gap: "18px",
            padding: "15px",
            "--max-960-grid-template-columns": "1fr",
            "--max-960-gap": "12px",
          },
          attributes: { n: "users-card-main" },
        },
        [
          View(
            {
              class: "box-border min-w-0",
              attributes: { n: "users-identity" },
            },
            [
              View(
                {
                  class: "box-border break-anywhere",
                  style: {
                    "font-size": "16px",
                    "font-weight": "700",
                  },
                  attributes: { n: "users-name" },
                },
                [String(user.name || "Reader")],
              ),
              View(
                {
                  class: "box-border text-muted break-anywhere",
                  style: {
                    "margin-top": "4px",
                    "font-size": "12px",
                  },
                  attributes: { n: "users-email" },
                },
                [email_text(user.email)],
              ),
              View(
                {
                  class: "box-border text-muted",
                  style: {
                    "margin-top": "6px",
                    "font-size": "11px",
                    "line-height": "1.5",
                  },
                  attributes: { n: "users-card-meta" },
                },
                [
                  "创建于 " + format_time(user.created_at),
                  user.last_used_at
                    ? " · 最近使用 " + format_time(user.last_used_at)
                    : " · 尚未使用",
                ],
              ),
            ],
          ),
          View(
            {
              class: "box-border flex flex-wrap",
              style: {
                gap: "18px",
              },
              attributes: { n: "users-stats" },
            },
            [
              View(
                {
                  class: "box-border grid",
                  style: {
                    gap: "2px",
                  },
                  attributes: { n: "users-stat-credits" },
                },
                [
                  View(
                    {
                      class:
                        "box-border text-muted tabular-nums whitespace-nowrap",
                      style: {
                        "font-size": "15px",
                        "font-weight": "680",
                      },
                      attributes: { n: "users-stat-credits-value" },
                    },
                    [String(user.credit_balance || 0)],
                  ),
                  View(
                    {
                      class: "box-border text-muted",
                      style: {
                        "font-size": "10px",
                        "letter-spacing": ".04em",
                      },
                      attributes: { n: "users-stat-credits-label" },
                    },
                    ["积分余额"],
                  ),
                ],
              ),
              View(
                {
                  class: "box-border grid",
                  style: {
                    gap: "2px",
                  },
                  attributes: { n: "users-stat-tokens" },
                },
                [
                  View(
                    {
                      class:
                        "box-border text-muted tabular-nums whitespace-nowrap",
                      style: {
                        "font-size": "15px",
                        "font-weight": "680",
                      },
                      attributes: { n: "users-stat-tokens-value" },
                    },
                    [
                      String(user.active_token_count || 0) +
                        " / " +
                        String(user.token_count || 0),
                    ],
                  ),
                  View(
                    {
                      class: "box-border text-muted",
                      style: {
                        "font-size": "10px",
                        "letter-spacing": ".04em",
                      },
                      attributes: { n: "users-stat-tokens-label" },
                    },
                    ["有效 / 全部凭证"],
                  ),
                ],
              ),
              View(
                {
                  class: "box-border grid",
                  style: {
                    gap: "2px",
                  },
                  attributes: { n: "users-stat-used" },
                },
                [
                  View(
                    {
                      class:
                        "box-border text-muted tabular-nums whitespace-nowrap",
                      style: {
                        "font-size": "15px",
                        "font-weight": "680",
                      },
                      attributes: { n: "users-stat-used-value" },
                    },
                    [String(user.total_credits_used || 0)],
                  ),
                  View(
                    {
                      class: "box-border text-muted",
                      style: {
                        "font-size": "10px",
                        "letter-spacing": ".04em",
                      },
                      attributes: { n: "users-stat-used-label" },
                    },
                    ["累计消耗"],
                  ),
                ],
              ),
            ],
          ),
          View(
            {
              class: "box-border flex flex-wrap",
              style: {
                gap: "7px",
              },
              attributes: { n: "users-card-footer" },
            },
            [UserStatusBadgeView({ user: user_ })],
          ),
        ],
      ),
      View(
        {
          class: "box-border flex flex-wrap items-center",
          style: {
            gap: "8px",
            padding: "0 15px 15px",
          },
          attributes: { n: "users-card-actions" },
        },
        [
          Button(
            {
              class: "box-border flex-none justify-self-center",
              attributes: { n: "users-detail-button", type: "button" },
              onClick() {
                return vm$.methods.loadDetail(user_id);
              },
            },
            [
              computed(expanded, (is_expanded) =>
                is_expanded ? "收起" : "详情",
              ),
            ],
          ),
          Button(
            {
              class: "box-border flex-none justify-self-center",
              attributes: { n: "users-edit-button", type: "button" },
              onClick() {
                if (expanded.value !== true) vm$.methods.loadDetail(user_id);
              },
            },
            ["编辑"],
          ),
          Show({
            when: computed(
              vm$.state.detail_user,
              (detail_user) =>
                detail_user.id === user_id &&
                detail_user.email &&
                !detail_user.email_verified,
            ),
            ok() {
              const verify_label = computed(vm$.state.busy_action, (action) =>
                vm$.state.busy_user_id.value === user_id && action === "verify"
                  ? "处理中…"
                  : "验证邮箱",
              );
              return Button(
                {
                  class: "box-border flex-none justify-self-center",
                  attributes: { n: "users-verify-button", type: "button" },
                  onClick() {
                    return vm$.methods.verifyEmail();
                  },
                },
                [verify_label],
              );
            },
          }),
          Button(
            {
              class: "box-border flex-none justify-self-center",
              attributes: { n: "users-reset-password-button", type: "button" },
              onClick() {
                if (expanded.value !== true) vm$.methods.loadDetail(user_id);
              },
            },
            ["重置密码"],
          ),
          Popconfirm({
            title: `删除用户“${user.email || user.name || user_id}”？此操作无法撤销。`,
            disabled: busy_delete, attributes: { n: "users-delete-confirmation" },
            onConfirm: () => vm$.methods.confirmDelete(user_id),
            trigger: props => Button({ ...props, class: "box-border flex-none", disabled: busy_delete,
              attributes: { ...props.attributes, n: "users-delete-button", type: "button" } }, [delete_label_]),
          }),
        ],
      ),
      Show({
        when: expanded,
        ok() {
          return DetailPanelView({ store: vm$ });
        },
      }),
    ],
  );
}

function DetailPanelView(props) {
  const vm$ = props.store;
  return View(
    {
      class: "box-border grid",
      style: {
        "border-top": "1px solid var(--frui-color-border-soft)",
        padding: "16px 15px",
        gap: "16px",
      },
      attributes: { n: "users-detail" },
    },
    [
      View(
        {
          class: "box-border grid rounded-card bg-surface",
          style: {
            gap: "10px",
            padding: "16px",
            border: "1px solid var(--frui-color-border-soft)",
          },
          attributes: { n: "users-detail-section" },
        },
        [
          View(
            {
              class: "box-border text-muted",
              style: {
                "font-size": "13px",
                "font-weight": "700",
              },
              attributes: { n: "users-detail-title" },
            },
            ["编辑资料"],
          ),
          View(
            {
              class:
                "box-border flex flex-wrap items-flex-end rounded-card bg-surface",
              style: {
                gap: "12px",
                padding: "16px",
                border: "1px solid var(--frui-color-border-soft)",
              },
              attributes: { n: "users-edit-form" },
            },
            [
              View(
                {
                  class: "box-border grid text-muted",
                  style: {
                    "min-width": "220px",
                    flex: "1 1 220px",
                    gap: "6px",
                    "font-size": "11px",
                  },
                  attributes: { n: "users-name-field" },
                },
                [
                  View(
                    {
                      class: "box-border",
                      attributes: { n: "users-name-label" },
                    },
                    ["名称"],
                  ),
                  Input({
                    class: "box-border w-full min-w-0",
                    value: computed(vm$.state.edit, (edit) => edit.name),
                    attributes: {
                      n: "users-name-input",
                      "aria-label": "用户名称",
                      maxlength: "128",
                      autocomplete: "off",
                    },
                    onInput(event) {
                      vm$.methods.setEditField("name", event.target.value);
                    },
                  }),
                ],
              ),
              View(
                {
                  class: "box-border grid text-muted",
                  style: {
                    "min-width": "220px",
                    flex: "1 1 220px",
                    gap: "6px",
                    "font-size": "11px",
                  },
                  attributes: { n: "users-email-field" },
                },
                [
                  View(
                    {
                      class: "box-border",
                      attributes: { n: "users-email-label" },
                    },
                    ["邮箱（留空则移除）"],
                  ),
                  Input({
                    class: "box-border w-full min-w-0",
                    value: computed(vm$.state.edit, (edit) => edit.email),
                    attributes: {
                      n: "users-email-input",
                      "aria-label": "邮箱",
                      type: "email",
                      maxlength: "254",
                      autocomplete: "off",
                    },
                    onInput(event) {
                      vm$.methods.setEditField("email", event.target.value);
                    },
                  }),
                ],
              ),
              Button(
                {
                  class: "box-border flex-none justify-self-center",
                  attributes: { n: "users-save-button", type: "button" },
                  disabled: computed(
                    vm$.state.edit,
                    (edit) => edit.saving || undefined,
                  ),
                  onClick() {
                    return vm$.methods.saveEdit();
                  },
                },
                [
                  computed(vm$.state.edit, (edit) =>
                    edit.saving ? "保存中…" : "保存",
                  ),
                ],
              ),
            ],
          ),
          Show({
            when: computed(vm$.state.edit, (edit) => Boolean(edit.error)),
            ok() {
              return View(
                {
                  class: "box-border rounded-card bg-danger-bg text-danger",
                  style: {
                    padding: "10px 12px",
                    "font-size": "12px",
                    "line-height": "1.5",
                  },
                  attributes: { n: "users-edit-error", role: "alert" },
                },
                [computed(vm$.state.edit, (edit) => edit.error)],
              );
            },
          }),
        ],
      ),
      View(
        {
          class: "box-border grid rounded-card bg-surface",
          style: {
            gap: "10px",
            padding: "16px",
            border: "1px solid var(--frui-color-border-soft)",
          },
          attributes: { n: "users-detail-reset-section" },
        },
        [
          View(
            {
              class: "box-border text-muted",
              style: {
                "font-size": "13px",
                "font-weight": "700",
              },
              attributes: { n: "users-detail-reset-title" },
            },
            ["重置登录密码"],
          ),
          View(
            {
              class:
                "box-border flex flex-wrap items-flex-end rounded-card bg-surface",
              style: {
                gap: "12px",
                padding: "16px",
                border: "1px solid var(--frui-color-border-soft)",
              },
              attributes: { n: "users-reset-form" },
            },
            [
              View(
                {
                  class: "box-border grid text-muted",
                  style: {
                    "min-width": "220px",
                    flex: "1 1 220px",
                    gap: "6px",
                    "font-size": "11px",
                  },
                  attributes: { n: "users-password-field" },
                },
                [
                  View(
                    {
                      class: "box-border",
                      attributes: { n: "users-password-label" },
                    },
                    ["新密码（8–128 位）"],
                  ),
                  Input({
                    class: "box-border w-full min-w-0",
                    value: computed(vm$.state.reset, (reset) => reset.password),
                    attributes: {
                      n: "users-password-input",
                      "aria-label": "新密码",
                      type: "password",
                      autocomplete: "new-password",
                    },
                    onInput(event) {
                      vm$.methods.setResetField(event.target.value);
                    },
                  }),
                ],
              ),
              Button(
                {
                  class: "box-border flex-none justify-self-center",
                  attributes: { n: "users-reset-button", type: "button" },
                  disabled: computed(
                    vm$.state.reset,
                    (reset) => reset.saving || undefined,
                  ),
                  onClick() {
                    return vm$.methods.resetPassword();
                  },
                },
                [
                  computed(vm$.state.reset, (reset) =>
                    reset.saving ? "重置中…" : "重置密码",
                  ),
                ],
              ),
            ],
          ),
          Show({
            when: computed(vm$.state.reset, (reset) => Boolean(reset.error)),
            ok() {
              return View(
                {
                  class: "box-border rounded-card bg-danger-bg text-danger",
                  style: {
                    padding: "10px 12px",
                    "font-size": "12px",
                    "line-height": "1.5",
                  },
                  attributes: { n: "users-reset-error", role: "alert" },
                },
                [computed(vm$.state.reset, (reset) => reset.error)],
              );
            },
          }),
        ],
      ),
      View(
        {
          class: "box-border grid rounded-card bg-surface",
          style: {
            gap: "10px",
            padding: "16px",
            border: "1px solid var(--frui-color-border-soft)",
          },
          attributes: { n: "users-detail-tokens-section" },
        },
        [
          View(
            {
              class: "box-border text-muted",
              style: {
                "font-size": "13px",
                "font-weight": "700",
              },
              attributes: { n: "users-detail-tokens-title" },
            },
            ["订阅凭证"],
          ),
          Show({
            when: computed(
              vm$.state.detail_tokens,
              (tokens) => tokens.length === 0,
            ),
            ok() {
              return View(
                {
                  class: "box-border rounded-card text-muted",
                  style: {
                    padding: "18px",
                    "font-size": "12px",
                  },
                  attributes: { n: "users-tokens-empty" },
                },
                ["该用户暂无订阅凭证"],
              );
            },
          }),
          View(
            {
              class: "box-border grid",
              style: {
                gap: "14px",
              },
              attributes: { n: "users-token-list" },
            },
            [
              For({
                key: "id",
                each: vm$.state.detail_tokens,
                render(token_value) {
                  const token = source_value(token_value);
                  const status_label =
                    token.status === "revoked"
                      ? "已撤销"
                      : token.status === "expired"
                        ? "已过期"
                        : "有效";

                  return View(
                    {
                      class:
                        "box-border grid items-center rounded-card bg-surface-raised max-960-grid-template-columns",
                      style: {
                        "grid-template-columns":
                          "minmax(150px, 1.3fr) auto minmax(120px, auto) minmax(140px, auto) minmax(130px, auto)",
                        gap: "12px",
                        padding: "10px 12px",
                        border: "1px solid var(--frui-color-border)",
                        "--max-960-grid-template-columns":
                          "minmax(0, 1fr) auto",
                      },
                      attributes: { n: "users-token-row" },
                    },
                    [
                      View(
                        {
                          class: "box-border min-w-0",
                          attributes: { n: "users-token-identity" },
                        },
                        [
                          View(
                            {
                              class: "box-border break-anywhere",
                              style: {
                                "font-size": "13px",
                                "font-weight": "680",
                              },
                              attributes: { n: "users-token-name" },
                            },
                            [String(token.name || "Reader")],
                          ),
                          View(
                            {
                              class: "box-border text-muted break-anywhere",
                              style: {
                                "margin-top": "3px",
                                font: "11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
                              },
                              attributes: { n: "users-token-hint" },
                            },
                            [String(token.token_hint || "")],
                          ),
                        ],
                      ),
                      View(
                        {
                          class:
                            "box-border " +
                            ("flex-none rounded-pill whitespace-nowrap " +
                              (token.status === "active"
                                ? "bg-success-bg text-success"
                                : token.status !== "active"
                                  ? "bg-danger-bg text-danger"
                                  : "")),
                          style: {
                            padding: "4px 8px",
                            "font-size": "11px",
                          },
                          attributes: { n: "users-token-status" },
                        },
                        [status_label],
                      ),
                      View(
                        {
                          class: "box-border text-muted max-960-grid-column",
                          style: {
                            "font-size": "11px",
                            "line-height": "1.5",
                            "--max-960-grid-column": "1 / -1",
                          },
                          attributes: { n: "users-token-meta" },
                        },
                        [
                          "余额 " +
                            String(token.credit_balance) +
                            " · 消耗 " +
                            String(token.total_credits_used),
                        ],
                      ),
                      View(
                        {
                          class: "box-border text-muted max-960-grid-column",
                          style: {
                            "font-size": "11px",
                            "line-height": "1.5",
                            "--max-960-grid-column": "1 / -1",
                          },
                          attributes: { n: "users-token-time" },
                        },
                        [
                          token.expires_at
                            ? "过期 " + format_time(token.expires_at)
                            : "长期有效",
                        ],
                      ),
                      View(
                        {
                          class: "box-border text-muted max-960-grid-column",
                          style: {
                            "font-size": "11px",
                            "line-height": "1.5",
                            "--max-960-grid-column": "1 / -1",
                          },
                          attributes: { n: "users-token-created" },
                        },
                        ["创建 " + format_time(token.created_at)],
                      ),
                    ],
                  );
                },
              }),
            ],
          ),
        ],
      ),
      View(
        {
          class: "box-border flex flex-wrap",
          style: {
            gap: "9px",
          },
          attributes: { n: "users-detail-actions" },
        },
        [
          Show({
            when: computed(vm$.state.detail_user, (detail_user) =>
              Boolean(detail_user.email && !detail_user.email_verified),
            ),
            ok() {
              return Button(
                {
                  class: "box-border flex-none justify-self-center",
                  attributes: {
                    n: "users-detail-verify-button",
                    type: "button",
                  },
                  onClick() {
                    return vm$.methods.verifyEmail();
                  },
                },
                ["标记邮箱已验证"],
              );
            },
          }),
          Button(
            {
              class: "box-border flex-none justify-self-center",
              attributes: { n: "users-detail-refresh-button", type: "button" },
              onClick() {
                return vm$.methods.refreshDetail();
              },
            },
            ["刷新"],
          ),
        ],
      ),
    ],
  );
}

function UsersPage() {
  const vm$ = UsersViewModel();
  const content = View(
    {
      class: "box-border grid",
      style: {
        gap: "14px",
      },
      attributes: { n: "users-management" },
      onMounted() {
        vm$.methods.loadUsers(0);
      },
    },
    [
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
              attributes: { n: "users-error", role: "alert" },
            },
            [vm$.state.error],
          );
        },
      }),
      Show({
        when: computed(vm$.state.message, Boolean),
        ok() {
          return View(
            {
              class: "box-border rounded-card bg-success-bg text-success",
              style: {
                padding: "11px 13px",
                "font-size": "12px",
                "line-height": "1.55",
              },
              attributes: { n: "users-message", role: "status" },
            },
            [vm$.state.message],
          );
        },
      }),
      View({ class: "box-border min-w-0", attributes: { n: "users-panel" } }, [
        View(
          {
            class:
              "box-border flex items-stretch justify-between max-640-flex-direction",
            style: {
              gap: "20px",
              "--max-640-flex-direction": "column",
            },
            attributes: { n: "users-panel-header" },
          },
          [
            View(
              {
                class:
                  "box-border flex flex-1 flex-wrap items-center justify-start max-640-justify-content",
                style: {
                  gap: "10px",
                  "--max-640-justify-content": "flex-start",
                },
                attributes: { n: "users-toolbar" },
              },
              [
                View(
                  {
                    as: "form",
                    class:
                      "box-border flex items-center rounded-card bg-surface flex-1 min-w-0 max-640-width",
                    style: {
                      gap: "9px",
                      padding: "16px",
                      border: "1px solid var(--frui-color-border-soft)",
                      "--max-640-width": "100%",
                    },
                    attributes: { n: "users-search-form" },
                    onSubmit(event) {
                      event.preventDefault();
                      return vm$.methods.search();
                    },
                  },
                  [
                    Input({
                      class: "box-border min-w-0 max-640-flex max-640-width",
                      style: {
                        width: "min(240px, 100%)",
                        "--max-640-flex": "1",
                        "--max-640-width": "auto",
                      },
                      value: vm$.state.search_text,
                      placeholder: "按名称或邮箱搜索",
                      attributes: {
                        n: "users-search-input",
                        "aria-label": "搜索用户",
                        maxlength: "100",
                      },
                      onInput(event) {
                        vm$.methods.setSearchText(event.target.value);
                      },
                    }),
                    Button(
                      {
                        class: "box-border flex-none justify-self-center",
                        attributes: {
                          n: "users-search-button",
                          type: "submit",
                        },
                        // Timeless 0.34.0 不渲染真实 <form>，submit 事件不会触发，提交必须走 onClick。
                        onClick(event) {
                          event.preventDefault();
                          return vm$.methods.search();
                        },
                      },
                      ["搜索"],
                    ),
                  ],
                ),
                Button(
                  {
                    class: "box-border flex-none justify-self-center",
                    attributes: { n: "users-refresh-button", type: "button" },
                    disabled: computed(
                      vm$.state.loading,
                      (loading) => loading || undefined,
                    ),
                    onClick() {
                      return vm$.methods.loadUsers(vm$.state.page.value);
                    },
                  },
                  [
                    computed(vm$.state.loading, (loading) =>
                      loading ? "正在刷新…" : "刷新",
                    ),
                  ],
                ),
              ],
            ),
          ],
        ),
        Show({
          when: computed(
            vm$.state.loading,
            (loading) => loading && vm$.state.users.value.length === 0,
          ),
          ok() {
            return View(
              {
                class: "box-border rounded-card text-muted text-center",
                style: {
                  margin: "18px 0 0",
                  padding: "26px",
                  "font-size": "13px",
                },
                attributes: { n: "users-loading" },
              },
              ["正在加载用户…"],
            );
          },
        }),
        Show({
          when: computed(
            vm$.state.users,
            (users) => users.length === 0 && !vm$.state.loading.value,
          ),
          ok() {
            return View(
              {
                class: "box-border rounded-card text-muted text-center",
                style: {
                  margin: "18px 0 0",
                  padding: "26px",
                  "font-size": "13px",
                },
                attributes: { n: "users-empty" },
              },
              [
                "没有找到用户" +
                  (vm$.state.query.value ? "，换个关键词试试" : ""),
              ],
            );
          },
        }),
        View(
          {
            class: "box-border grid",
            style: {
              gap: "14px",
              "margin-top": "12px",
            },
            attributes: { n: "users-list" },
          },
          [
            For({
              key: "id",
              each: vm$.state.users,
              render(user_value) {
                return UserCardView({ store: vm$, user: user_value });
              },
            }),
          ],
        ),
        PaginationView(Timeless, {
          model: vm$.pagination,
          name: "users-pagination",
          label: "用户列表分页",
        }),
      ]),
    ],
  );

  return window.FindRSSAdminShell.Page(
    {
      page_id: "users",
      eyebrow: "Reader Accounts",
      title: "用户管理",
      count: computed(vm$.state.total_count, String),
    },
    [content],
  );
}

export { UsersPage };
