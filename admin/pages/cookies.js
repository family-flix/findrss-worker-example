import { CookiesViewModel } from "./cookies.model.js";

const Timeless = window.FindRSSAdminUI;

if (!Timeless?.DOM || !window.FindRSSAdminAuth || !window.FindRSSAdminShell) {
  throw new Error("Cookie 管理页无法启动：管理运行时未加载");
}
const { Button, Dialog, For, Input, Show, Textarea, View, combine, computed } = Timeless;

function CookieRowView({ model, group, row }) {
  return View({ class: "box-border grid items-start bg-surface-raised rounded-card max-960-grid-template-columns", style: {
    "grid-template-columns": "minmax(120px,.6fr) minmax(0,1.6fr) auto",
    "gap": "12px",
    "border-top": "1px solid var(--frui-color-border-soft)",
    "padding-top": "12px",
    "border": "1px solid var(--frui-color-border)",
    "padding": "14px",
    "--max-960-grid-template-columns": "minmax(0,1fr)"
  }, attributes: { n: "cookie-row" } }, [
    View({ class: "box-border grid min-w-0 break-anywhere", style: {
      "gap": "6px",
      "font": "12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace"
    }, attributes: { n: "cookie-key" } }, [
      View({class: "box-border",  attributes: { n: "cookie-name" } }, [row.cookie.name]),
      View({ class: "box-border text-muted", style: {
        "font-size": "11px"
      }, attributes: { n: "cookie-path" } }, ["路径 " + row.cookie.path]),
    ]),
    View({ class: "box-border min-w-0", attributes: { n: "cookie-value" } }, [
      Textarea({class: "box-border",  value: row.value, disabled: model.state.busy,
        attributes: { n: "cookie-value-input", "aria-label": group.domain + " " + row.cookie.name + " " + row.cookie.path + " 的值", rows: "2", spellcheck: "false" },
        onInput: (event) => model.methods.set_value(row.value, event.target.value) }),
    ]),
    View({ class: "box-border flex max-960-justify-content", style: {
      "gap": "7px",
      "--max-960-justify-content": "flex-end"
    }, attributes: { n: "cookie-actions" } }, [
      Button({class: "box-border",  attributes: { n: "cookie-save-button" }, disabled: model.state.busy,
        onClick: () => model.methods.save_cookie(row) }, ["保存"]),
      Button({ class: "box-border flex-none justify-self-center", attributes: { n: "cookie-delete-button" }, disabled: model.state.busy,
        onClick: () => model.methods.remove_cookie(group, row) }, ["删除"]),
    ]),
  ]);
}

function CookieGroupView({ model, group }) {
  return View({ class: "box-border grid min-w-0", style: {
    "gap": "14px"
  }, attributes: { n: "cookie-domain-group" } }, [
    View({ class: "box-border flex items-center justify-between", style: {
      "gap": "12px"
    }, attributes: { n: "cookie-domain-heading" } }, [
      View({ class: "box-border min-w-0 break-anywhere", style: {
        "font-size": "13px",
        "font-weight": "680"
      }, attributes: { n: "cookie-domain-name" } }, [group.domain]),
      View({ class: "box-border text-muted flex-none", style: {
        "font-size": "11px"
      }, attributes: { n: "cookie-domain-count" } }, [computed(group.rows, (rows) => rows.length + " 条")]),
    ]),
    View({ class: "box-border grid min-w-0", style: {
      "gap": "14px"
    }, attributes: { n: "cookie-list" } }, [
      Show({ when: computed(group.rows, rows => rows.length === 0),
        ok: () => View({ class: "box-border text-muted rounded-card", style: {
          "padding": "20px",
          "font-size": "13px"
        }, attributes: { n: "cookie-domain-empty" } }, ["该域名暂无 Cookie，可添加键值对。"]) }),
      For({ each: group.rows, key: "id", render(value) {
        return CookieRowView({ model, group, row: value?.__is_ref ? value.value : value });
      } }),
    ]),
    View({ class: "box-border grid rounded-card bg-surface max-960-grid-template-columns", style: {
      "grid-template-columns": "minmax(120px,.6fr) minmax(0,1.6fr) auto",
      "gap": "12px",
      "padding-top": "14px",
      "border-top": "1px solid var(--frui-color-border-soft)",
      "padding": "16px",
      "border": "1px solid var(--frui-color-border-soft)",
      "--max-960-grid-template-columns": "minmax(0,1fr)"
    }, attributes: { n: "cookie-add-form" } }, [
      Input({class: "box-border",  value: group.new_name, disabled: model.state.busy, placeholder: "key",
        attributes: { n: "cookie-add-key", "aria-label": group.domain + " 新 Cookie key", spellcheck: "false" },
        onInput: (event) => model.methods.set_value(group.new_name, event.target.value) }),
      Input({class: "box-border",  value: group.new_value, disabled: model.state.busy, placeholder: "value",
        attributes: { n: "cookie-add-value", "aria-label": group.domain + " 新 Cookie value", spellcheck: "false" },
        onInput: (event) => model.methods.set_value(group.new_value, event.target.value) }),
      Button({class: "box-border",  attributes: { n: "cookie-add-button" }, disabled: model.state.busy,
        onClick: () => model.methods.add_cookie(group) }, ["添加键值对"]),
    ]),
  ]);
}

function CookieWorkspaceView({ model }) {
  const state = model.state;
  return View({ class: "box-border grid items-start max-760-grid-template-columns max-760-gap", style: {
    "grid-template-columns": "minmax(180px, 240px) minmax(0, 1fr)",
    "gap": "24px",
    "--max-760-grid-template-columns": "minmax(0,1fr)",
    "--max-760-gap": "20px"
  }, attributes: { n: "cookies-workspace" } }, [
    View({ class: "box-border sticky grid min-w-0 max-760-position", style: {
      "top": "20px",
      "gap": "14px",
      "--max-760-position": "static"
    }, attributes: { n: "cookies-domains", "aria-label": "Cookie 域名" } }, [
      View({ class: "box-border grid overflow-auto rounded-card bg-surface max-760-max-height", style: {
        "gap": "6px",
        "max-height": "60dvh",
        "padding": "8px",
        "border": "1px solid var(--frui-color-border-soft)",
        "--max-760-max-height": "180px"
      }, attributes: { n: "cookie-domain-list", "aria-label": "域名列表" } }, [
        Show({ when: computed(state.groups, groups => groups.length === 0),
          ok: () => View({ class: "box-border text-muted rounded-card", style: {
            "padding": "20px",
            "font-size": "13px"
          }, attributes: { n: "cookies-domains-empty" } }, ["暂无域名，请先导入 Cookies。"]) }),
        For({ each: state.groups, key: "domain", render(value) {
          const group = value?.__is_ref ? value.value : value;
          const selected = computed(state.selected_domain, domain => domain === group.domain);
          return View({ class: "box-border flex items-center min-w-0", style: { gap: "var(--frui-space-1)" },
            attributes: { n: "cookie-domain-item" } }, [
          Button({ variant: "quiet", disabled: state.busy,
            class: computed(selected, active => "box-border " + ("flex-1 min-w-0 text-left " + (active ? "bg-selected text-link" : ""))), style: {
              "padding": "10px"
            },
            attributes: { n: "cookie-domain-select-" + group.domain, title: group.domain, "aria-pressed": computed(selected, String) },
            onClick() { model.methods.select_domain(group.domain); } }, [
            View({ class: "box-border flex items-center justify-between w-full min-w-0", style: { gap: "10px" },
              attributes: { n: "cookie-domain-content" } }, [
            View({ class: "box-border min-w-0 break-anywhere", style: {
              "font-size": "13px",
              "font-weight": "680", "text-align": "left", flex: "1"
            }, attributes: { n: "cookie-domain-label" } }, [group.domain]),
            View({ class: "box-border text-muted flex-none", style: {
              "font-size": "11px"
            }, attributes: { n: "cookie-domain-count" } }, [computed(group.rows, rows => String(rows.length))]),
            ]),
          ]),
          Button({ variant: "danger", size: "small", class: "box-border flex-none", disabled: state.busy,
            attributes: { n: "cookie-domain-delete-" + group.domain, title: "删除域名及其所有 Cookie", "aria-label": "删除域名 " + group.domain + " 及其所有 Cookie" },
            onClick: () => model.methods.remove_domain(group) }, []),
          ]);
        } }),
      ]),
    ]),
    View({ class: "box-border min-w-0", attributes: { n: "cookies-details", "aria-label": "域名键值对" } }, [
      Show({ when: computed(state.selected_groups, groups => groups.length === 0),
        ok: () => View({ class: "box-border text-muted rounded-card", style: {
          "padding": "20px",
          "font-size": "13px"
        }, attributes: { n: "cookies-empty" } }, ["请选择域名查看和编辑键值对，或导入 Cookies。"]) }),
      For({ each: state.selected_groups, key: "domain", render(value) {
        return CookieGroupView({ model, group: value?.__is_ref ? value.value : value });
      } }),
    ]),
  ]);
}

function CookieImportView({ model }) {
  const state = model.state;
  const trigger = document.activeElement;
  function handle_keydown(event) {
    if (event.key === "Escape") { event.stopPropagation(); model.methods.close_import(); }
    if (event.key !== "Tab") return;
    const dialog = document.querySelector('[data-n="cookies-import-dialog"], [n="cookies-import-dialog"]');
    const controls = Array.from(dialog?.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)') || [])
      .filter(node => node.getClientRects().length);
    const next = event.shiftKey ? controls.at(-1) : controls[0];
    const edge = event.shiftKey ? controls[0] : controls.at(-1);
    if (document.activeElement === edge || !controls.includes(document.activeElement)) {
      event.preventDefault();
      next?.focus();
    }
  }
  return Dialog({
    open: state.import_open, title: "导入 Cookies",
    description: "粘贴 key=value; k2=v2，保存到指定域名的 / 路径；同名 Cookie 将更新值。",
    attributes: { n: "cookies-import-dialog", "aria-label": "导入 Cookies" },
    class: "box-border flex flex-col overflow-hidden p-0",
    style: { width: "min(560px, calc(100vw - 32px))", "max-height": "calc(100dvh - 32px)" },
    headerProps: { class: "box-border flex-none m-0", style: { padding: "20px 24px" } },
    bodyProps: { class: "box-border grid min-h-0 overflow-auto", style: { padding: "0 24px 24px", gap: "14px" } },
    footerProps: { class: "box-border flex-none m-0", style: { padding: "16px 24px" } },
    closable: false, maskClosable: false, onClose: model.methods.close_import,
    onMounted() { document.addEventListener("keydown", handle_keydown); },
    onUnmounted() { document.removeEventListener("keydown", handle_keydown); trigger?.focus?.(); },
    footer: [
      Button({ attributes: { n: "cookies-import-cancel-button" }, disabled: state.busy,
        onClick: model.methods.close_import }, ["取消"]),
      Button({ attributes: { n: "cookies-import-submit-button" }, disabled: state.busy,
        onClick: model.methods.import_cookies }, [computed(state.busy, busy => busy ? "导入中…" : "导入")]),
    ],
  }, [
    Input({ value: state.import_domain, disabled: state.busy, placeholder: ".example.com",
      attributes: { n: "cookies-import-domain", "aria-label": "导入目标域名", spellcheck: "false" },
      onInput: event => model.methods.set_value(state.import_domain, event.target.value) }),
    Textarea({ value: state.import_text, disabled: state.busy, placeholder: "key=value; k2=v2",
      attributes: { n: "cookies-import-text", "aria-label": "Cookie 字符串", rows: "8", spellcheck: "false" },
      onInput: event => model.methods.set_value(state.import_text, event.target.value) }),
    View({ class: "text-danger whitespace-pre-wrap break-anywhere", attributes: { n: "cookies-import-error", role: "alert" } }, [state.import_error]),
  ]);
}

function CookiesPage() {
  const model = CookiesViewModel();
  const state = model.state;
  return window.FindRSSAdminShell.Page({
    page_id: "cookies", title: "Cookie 管理", count: computed(state.count, String),
    actions: [Button({ attributes: { n: "cookies-import-button" },
      disabled: combine({ busy: state.busy, loaded: state.loaded }, values => values.busy || !values.loaded),
      onClick: model.methods.open_import }, ["导入 Cookies"]),
      Button({ class: "box-border flex-none justify-self-center", attributes: { n: "cookies-refresh-button" },
      disabled: state.busy, onClick: model.methods.refresh }, ["重新读取"])],
  }, [View({ class: "box-border grid min-w-0", style: {
    "gap": "16px"
  }, attributes: { n: "cookies-management" }, onMounted: model.methods.refresh }, [
    View({ class: "box-border text-success", style: {
      "font-size": "12px"
    }, attributes: { n: "cookies-message", role: "status" } }, [state.message]),
    View({ class: "box-border text-danger whitespace-pre-wrap break-anywhere", style: {
      "font-size": "12px"
    }, attributes: { n: "cookies-error", role: "alert" } }, [state.error]),
    CookieWorkspaceView({ model }),
    Show({ when: state.import_open, ok: () => CookieImportView({ model }) }),
  ])]);
}

export { CookiesPage };
