import { message_value, messages_model } from "./messages.model.js";
import { ScriptEditorView } from "./script.js";

const { View, Button, For, Popconfirm, Show, computed } = window.FindRSSAdminUI;

function MessageView(value) {
  const row = message_value(value);
  return View(
    {
      class: "box-border rounded-card grid break-anywhere bg-surface-raised",
      style: {
        padding: "var(--frui-space-3)",
        "border-left": "3px solid var(--frui-color-border-soft)",
        gap: "10px",
        border: "1px solid var(--frui-color-border)",
      },
      attributes: { n: "admin-message" },
    },
    [
      View(
        {
          class: "box-border flex items-center flex-wrap",
          style: {
            gap: "14px",
          },
          attributes: { n: "admin-message-heading" },
        },
        [
          View(
            {
              class: "box-border",
              style: {
                "font-size": "20px",
                "font-weight": "720",
              },
              attributes: { n: "admin-message-script" },
            },
            [row.script_name || row.path || "未保存的脚本"],
          ),
          View(
            {
              class: "box-border text-muted font-monospace",
              attributes: { n: "admin-message-location" },
            },
            [row.location],
          ),
          View(
            {
              class: "box-border",
              attributes: { n: "admin-message-read-status" },
            },
            [
              computed(messages_model.state.read_id, (id) =>
                row.id > id ? "未读" : "已读",
              ),
            ],
          ),
        ],
      ),
      View(
        {
          class: "box-border text-muted break-anywhere",
          style: {
            font: "10px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
          },
          attributes: { n: "admin-message-meta" },
        },
        [row.time + " · " + row.source_label + " · " + row.phase],
      ),
      View({ class: "box-border", attributes: { n: "admin-message-route" } }, [
        row.path || row.route || "未保存的草稿",
      ]),
      View(
        { class: "box-border", attributes: { n: "admin-message-request" } },
        [row.method + " " + row.pathname],
      ),
      View(
        {
          class:
            "box-border m-0 overflow-auto rounded-control whitespace-pre-wrap break-anywhere bg-danger-bg text-danger",
          style: {
            "max-height": "300px",
            padding: "10px",
            font: "10px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace",
            "font-size": "12px",
          },
          attributes: { n: "admin-message-error" },
        },
        [row.error_text],
      ),
      View(
        {
          class: "box-border",
          attributes: { n: "admin-message-parameters-label" },
        },
        ["传入参数"],
      ),
      View(
        {
          class:
            "box-border m-0 overflow-auto rounded-control whitespace-pre-wrap break-anywhere bg-canvas text-muted",
          style: {
            "max-height": "300px",
            padding: "10px",
            font: "10px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace",
            "font-size": "12px",
          },
          attributes: { n: "admin-message-parameters" },
        },
        [row.parameters],
      ),
      ...(Array.isArray(row.lines) && row.lines.length
        ? [
            View(
              {
                class:
                  "box-border m-0 overflow-auto rounded-control whitespace-pre-wrap break-anywhere grid bg-canvas text-muted",
                style: {
                  "max-height": "300px",
                  padding: "10px",
                  font: "10px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace",
                  gap: "4px",
                  "font-size": "12px",
                },
                attributes: { n: "admin-message-console" },
              },
              [
                row.lines
                  .map((line) => "[" + line.level + "] " + line.text)
                  .join("\n"),
              ],
            ),
          ]
        : []),
      Button(
        {
          class: "box-border",
          attributes: { n: "admin-message-edit-script", type: "button", title: row.route ? "编辑关联脚本" : "未关联已保存的脚本" },
          disabled: computed(messages_model.state.opening_script, opening => opening || !row.route),
          onClick: () => messages_model.methods.edit_script(row.route),
        },
        ["编辑脚本"],
      ),
    ],
  );
}

function MessagesPage() {
  const model = messages_model;
  return window.FindRSSAdminShell.Page(
    {
      title: "消息",
      count: window.Timeless.combine(
        { rows: model.state.visible_rows, more: model.state.has_more },
        ({ rows, more }) => String(rows.length) + (more ? "+" : ""),
      ),
      actions: [
        Show({
          when: computed(model.state.tab, value => value === "read"),
          ok: () => {
            const disabled = window.Timeless.combine(
                { loading: model.state.loading, deleting: model.state.deleting, read_id: model.state.read_id },
                state => state.loading || state.deleting || state.read_id <= 0,
            );
            return Popconfirm({ title: "删除全部已读消息？此操作无法撤销。", disabled,
              attributes: { n: "admin-messages-delete-read-confirmation" }, onConfirm: model.methods.delete_read,
              trigger: props => Button({ ...props, class: "box-border flex-none justify-self-center", disabled,
                attributes: { ...props.attributes, n: "admin-messages-delete-read", type: "button" } },
              [computed(model.state.deleting, value => value ? "删除中…" : "删除全部")]),
            });
          },
        }),
        Button(
          {
            class: "box-border flex-none justify-self-center",
            attributes: { n: "admin-messages-refresh", type: "button" },
            disabled: model.state.loading,
            onClick: () => model.methods.load(),
          },
          ["刷新"],
        ),
        Button(
          {
            class: "box-border flex-none justify-self-center",
            attributes: { n: "admin-messages-mark-read", type: "button" },
            onClick: model.methods.mark_read,
          },
          ["全部标记已读"],
        ),
      ],
    },
    [
      View(
        {
          class: "box-border grid",
          style: {
            gap: "var(--frui-space-3)",
          },
          attributes: { n: "admin-messages" },
          onMounted: model.methods.start,
        },
        [
          View(
            {
              class: "box-border flex flex-wrap",
              style: {
                gap: "8px",
              },
              attributes: {
                n: "admin-messages-tabs",
                role: "group",
                "aria-label": "消息状态",
              },
            },
            [
              ...[
                ["unread", "未读"],
                ["read", "已读"],
              ].map(([tab, label]) =>
                Button(
                  {
                    class: computed(
                      model.state.tab,
                      (value) =>
                        "box-border " +
                        ("rounded-pill font-inherit cursor-pointer " +
                          (value === tab
                            ? "bg-selected text-text border-color-border-soft"
                            : "bg-surface-raised text-muted")),
                    ),
                    style: {
                      padding: "7px 14px",
                      "font-size": "12px",
                    },
                    attributes: {
                      n: "admin-messages-tab-" + tab,
                      type: "button",
                      "aria-pressed": computed(model.state.tab, (value) =>
                        String(value === tab),
                      ),
                    },
                    onClick: () => model.methods.set_tab(tab),
                  },
                  [label],
                ),
              ),
            ],
          ),
          View(
            {
              class: "box-border text-muted break-anywhere",
              style: {
                font: "10px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
              },
              attributes: { n: "admin-messages-connection", role: "status" },
            },
            [
              computed(model.state.connected, (value) =>
                value ? "实时消息已连接" : "实时消息连接中…",
              ),
            ],
          ),
          Show({
            when: computed(model.state.error, Boolean),
            ok: () =>
              View(
                {
                  class:
                    "box-border block rounded-card bg-danger-bg text-danger whitespace-pre-wrap",
                  style: {
                    margin: "0 0 18px",
                    padding: "14px 16px",
                  },
                  attributes: { n: "admin-messages-error", role: "alert" },
                },
                [model.state.error],
              ),
          }),
          Show({
            when: window.Timeless.combine(
              { rows: model.state.visible_rows, loading: model.state.loading },
              (state) => !state.rows.length && !state.loading,
            ),
            ok: () =>
              View(
                {
                  class: "box-border",
                  attributes: { n: "admin-messages-empty" },
                },
                [
                  computed(model.state.tab, (value) =>
                    value === "unread" ? "暂无未读消息" : "暂无已读消息",
                  ),
                ],
              ),
          }),
          For({ each: model.state.visible_rows, render: MessageView }),
          ScriptEditorView({ store: model.editor }),
          Show({
            when: model.state.has_more,
            ok: () =>
              Button(
                {
                  class: "box-border flex-none justify-self-center",
                  attributes: { n: "admin-messages-older", type: "button" },
                  disabled: model.state.loading,
                  onClick: () => model.methods.load(true),
                },
                ["加载更早消息"],
              ),
          }),
        ],
      ),
    ],
  );
}

export { MessagesPage };
