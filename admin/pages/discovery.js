import { format_datetime as format_time } from "../../server/lib/datetime.js";
import { PaginationView } from "../components/pagination.js";
import { PollPolicyView, poll_policy_label } from "../components/poll_policy.js";
import { discovery_platform_label, discovery_platform_icon_url } from "../components/discovery_platform.js";
import { is_template_feed_url, is_managed_rss_url, DiscoveryAdminViewModel } from "./discovery.model.js";

const Timeless = window.FindRSSAdminUI;

if (!Timeless || !Timeless.DOM) {
  throw new Error("订阅源管理页无法启动：Timeless 运行时未加载");
}

if (!window.FindRSSAdminAuth) {
  throw new Error("订阅源管理页无法启动：认证模块未加载");
}

if (!window.FindRSSAdminShell) {
  throw new Error("订阅源管理页无法启动：管理 Shell 未加载");
}
const { Badge, Button, CopyButton, Dialog, DropdownMenu, For, FilePicker, FeedAddressEditor, Field, Img, Input, Icon, Link, Popconfirm, Select, Show, Switch, TableField, Textarea, Tooltip, View, combine, computed, notify, ref } = Timeless;

const avatar_accept = "image/png,image/jpeg,image/webp,image/gif";

const avatar_max_bytes = 5 * 1024 * 1024;

const filter_status_options = [
  { value: "all", label: "全部" },
  { value: "enabled", label: "启用" },
  { value: "disabled", label: "停用" },
];
const filter_visibility_options = [
  { value: "all", label: "全部" },
  { value: "public", label: "公开" },
  { value: "private", label: "不公开" },
];

/** @param {unknown} value */
function source_value(value) {
  return value && value.__is_ref ? value.value : value;
}

function PlatformOptionView(id, platforms, label) {
  return View({ class: "inline-flex items-center", style: { gap: "6px" }, attributes: { n: "discovery-platform-option" } }, [
    Img({ class: "block flex-none object-fit-contain", style: { width: "18px", height: "18px" },
      src: combine({ id: typeof id === "string" ? ref(id) : id, platforms },
        values => discovery_platform_icon_url(values.id, values.platforms)),
      attributes: { n: "discovery-platform-icon", alt: "", "aria-hidden": "true", width: "18", height: "18" } }),
    label,
  ]);
}

function format_bytes(value) {
  const bytes = Number(value || 0);
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  if (bytes >= 1024) return Math.round(bytes / 1024) + " KB";
  return bytes + " B";
}

function FieldView({ semantic_name, label, controlProps = {}, style = {} }, children = []) {
  return Field({ controlProps: { class: "box-border grid min-w-0", style: {
    gap: "12px"
  }, ...controlProps }, messageProps: { class: "box-border hidden" }, class: "box-border min-w-0 m-0 grid text-muted", style: {
    "gap": "6px",
    "font-size": "11px",
    ...style
  }, attributes: { n: semantic_name }, label }, children);
}

function SourceSocialUrlsView({ store: vm$ }) {
  let next_id = 0;
  const array = new Timeless.vm.ArrayFieldCore({
    label: "社媒主页",
    field() {
      return new Timeless.vm.SingleFieldCore({
        name: "discovery-source-social-" + next_id++,
        input: new Timeless.vm.InputCore({ defaultValue: "", type: "url" }),
      });
    },
  });
  const initial = vm$.state.draft_social_urls.value;
  array.setValue(initial.length ? initial : [""]);
  const rows = Timeless.refarr(array.fields.map(item => ({ key: item.field.name, field: item.field })));
  function sync_draft() {
    vm$.methods.set_draft("social_urls", array.value);
  }
  const unlisten = array.onStateChange(() => {
    rows.as(array.fields.map(item => ({ key: item.field.name, field: item.field })));
    sync_draft();
  });
  return View({ class: "grid min-w-0 gap-space-2", attributes: { n: "discovery-source-social-array" },
    onUnmounted() { unlisten(); array.destroy(); rows.destroy?.(); } }, [
    For({ each: rows, key: "key", render(value) {
      const { field } = source_value(value);
      return View({ class: "flex items-center min-w-0 gap-space-2", attributes: { n: "discovery-source-social-row" } }, [
        Input({ class: "box-border", store: field.input, disabled: vm$.state.saving,
          placeholder: "https://www.douyin.com/user/…",
          attributes: { n: "discovery-source-social-input", "aria-label": "社媒主页", type: "url",
            inputmode: "url", maxlength: "2048", spellcheck: "false" },
          onInput: sync_draft,
        }),
        Popconfirm({ title: "移除此社媒主页？保存订阅源后生效。", confirmText: "确认移除", disabled: vm$.state.saving,
          attributes: { n: "discovery-source-social-remove-confirmation" },
          onConfirm() {
            const index = array.fields.findIndex(item => item.field === field);
            if (index >= 0) array.removeByIndex(index);
          },
          trigger: props => Button({ ...props, variant: "ghost", icon: Icon("x", 16), disabled: vm$.state.saving,
            attributes: { ...props.attributes, n: "discovery-source-social-remove", "aria-label": "移除此社媒主页" } }),
        }),
      ]);
    } }),
    Button({ class: "justify-self-start", disabled: vm$.state.saving,
      attributes: { n: "discovery-source-social-add" },
      onClick() { array.append(); },
    }, ["添加社媒主页"]),
  ]);
}

function SourceFormView({ store: vm$ }) {
  const trigger = document.activeElement;
  function handle_keydown(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      vm$.methods.close_form();
    }
    if (event.key !== "Tab") return;
    const dialog = document.querySelector('[data-n="discovery-source-dialog"], [n="discovery-source-dialog"]');
    const controls = Array.from(dialog?.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || [])
      .filter((node) => node.getClientRects().length);
    const next = event.shiftKey ? controls.at(-1) : controls[0];
    const edge = event.shiftKey ? controls[0] : controls.at(-1);
    if (document.activeElement === edge || !controls.includes(document.activeElement)) {
      event.preventDefault();
      next?.focus();
    }
  }
  const busy = combine({ saving: vm$.state.saving, previewing: vm$.state.previewing },
    (deps) => deps.saving || deps.previewing);
  return Dialog({headerProps: {class:"box-border flex-none m-0 max-560-padding",style:{"padding":"22px 64px 20px 24px","border-bottom":"1px solid var(--frui-color-border-soft)","--max-560-padding":"18px 56px 16px 18px"}}, bodyProps: {class:"box-border flex-1 min-h-0 overflow-auto bg-canvas max-560-padding",style:{"padding":"24px","--max-560-padding":"18px"}}, footerProps: {class:"box-border flex-none flex-wrap m-0 max-560-padding",style:{"padding":"16px 24px","border-top":"1px solid var(--frui-color-border-soft)","--max-560-padding":"14px 18px"}},
    open: vm$.state.form_open,
    title: computed(vm$.state.editing_id, (id) => id ? "编辑订阅源" : "新增订阅源"),
    description: "填写订阅地址，再完善广场展示信息。",
    class: "box-border flex flex-col overflow-hidden p-0 max-560-width max-560-max-height", style: {
      "width": "min(760px, calc(100vw - 32px))",
      "max-height": "calc(100dvh - 48px)",
      "--max-560-width": "calc(100vw - 16px)",
      "--max-560-max-height": "calc(100dvh - 16px)"
    }, closable: false, maskClosable: false,
    attributes: { n: "discovery-source-dialog", "aria-label": "订阅源表单" },
    onClose: vm$.methods.close_form,
    onUnmounted() {
      document.removeEventListener("keydown", handle_keydown);
      trigger?.focus?.();
    },
    footer: [
      View({ class: "box-border text-success", style: {
        "margin": "6px 0 0",
        "font-size": "12px"
      }, attributes: { n: "discovery-source-form-status", role: "status" } }, [vm$.state.form_message]),
      View({ class: "box-border text-danger", style: {
        "margin": "12px 0 0"
      }, attributes: { n: "discovery-source-form-error", role: "alert" } }, [vm$.state.form_error]),
      Button({class: "box-border",  variant: "secondary", attributes: { n: "discovery-source-cancel-button" },
        disabled: vm$.state.saving, onClick: vm$.methods.close_form }, ["取消"]),
      Button({class: "box-border",  attributes: { n: "discovery-source-submit-button" },
        disabled: busy, onClick: vm$.methods.save_source },
        [computed(vm$.state.saving, (saving) => saving ? "保存中…" : "保存订阅源")]),
    ],
  }, [
    Button({ variant: "ghost", size: "small", class: "box-border absolute flex-none", style: {
      "top": "16px",
      "right": "18px"
    },
      attributes: { n: "discovery-source-close-button", "aria-label": "关闭订阅源表单" },
      icon: Icon("x", 16), disabled: vm$.state.saving, onClick: vm$.methods.close_form }, []),
    View({ class: "box-border grid", style: {
      "gap": "24px"
    }, attributes: { n: "discovery-source-form" },
      onMounted() { document.addEventListener("keydown", handle_keydown); },
    }, [
      View({class: "box-border",  style: {
        "border-top": "1px solid var(--frui-color-border-soft)",
        "padding-top": "22px"
      }, attributes: { n: "discovery-source-address-group" } }, [
        View({ class: "box-border text-text", style: {
          "margin-bottom": "14px",
          "font-size": "14px",
          "font-weight": "650"
        }, attributes: { n: "discovery-source-address-heading", role: "heading", "aria-level": "3" } }, ["订阅地址"]),
        View({ class: "box-border grid", style: {
          "grid-template-columns": "minmax(0, 1fr)",
          "gap": "18px"
        }, attributes: { n: "discovery-source-address-fields" } }, [
          FieldView({ semantic_name: "discovery-source-feed-field", label: "RSS/Atom 地址" }, [
            View({ class: "box-border flex items-center max-560-align-items max-560-flex-direction", style: {
              "gap": "10px",
              "--max-560-align-items": "stretch",
              "--max-560-flex-direction": "column"
            }, attributes: { n: "discovery-source-feed-control" } }, [
              FeedAddressEditor({
                value: vm$.state.draft_feed_url,
                scripts: vm$.state.scripts,
                disabled: vm$.state.saving,
                placeholder: "{{hostname}}/rss/wxmp/wow36kr 或 https://example.com/feed.xml",
                attributes: {
                  n: "discovery-source-feed-input",
                  "aria-label": "RSS/Atom 地址",
                  inputmode: "url",
                  maxlength: "2048",
                  spellcheck: "false",
                },
                onInput(event) {
                  vm$.methods.set_draft("feed_url", event.target.value);
                },
              }),
              Button({class: "box-border",
                attributes: { n: "discovery-source-preview-button" },
                disabled: combine({ previewing: vm$.state.previewing, saving: vm$.state.saving,
                  address: vm$.state.draft_feed_url },
                  (deps) => deps.previewing || deps.saving || !deps.address.trim()),
                onClick() { return vm$.methods.preview_feed(); },
              }, [computed(vm$.state.previewing, (busy) => busy ? "正在读取…" : "读取订阅源信息")]),
            ]),
            View(
              { class: "box-border m-0 text-muted break-anywhere col-span-full", style: {
                "font-size": "12px",
                "line-height": "1.5"
              }, attributes: { n: "discovery-source-feed-hint" } },
              ["输入 { 补全 {{hostname}}，输入 /rss/ 或 /atom/ 联想脚本路由。↑ ↓ 选择，Tab 补全及切换路径参数，Shift+Tab 返回，Esc 退出；淡色文字为待补全内容。"],
            ),
            View({ class: "box-border m-0 text-muted break-anywhere col-span-full", style: {
              "font-size": "12px",
              "line-height": "1.5"
            }, attributes: { n: "discovery-source-completion-status", role: "status" } }, [
              combine({ loading: vm$.state.scripts_loading, error: vm$.state.scripts_error },
                deps => deps.loading ? "正在加载脚本路由…" : deps.error),
            ]),
          ]),
        ]),
      ]),
      View({class: "box-border",  style: {
        "border-top": "1px solid var(--frui-color-border-soft)",
        "padding-top": "22px"
      }, attributes: { n: "discovery-source-display-group" } }, [
        View({ class: "box-border text-text", style: {
          "margin-bottom": "14px",
          "font-size": "14px",
          "font-weight": "650"
        }, attributes: { n: "discovery-source-display-heading", role: "heading", "aria-level": "3" } }, ["订阅源信息"]),
        View({ class: "box-border grid", style: {
          "grid-template-columns": "minmax(0, 1fr)",
          "gap": "18px"
        }, attributes: { n: "discovery-source-display-fields" } }, [
          View({ class: "box-border grid items-start max-560-grid-template-columns max-560-gap", style: {
            "grid-template-columns": "minmax(0, 190px) minmax(0, 1fr)",
            "gap": "20px",
            "--max-560-grid-template-columns": "minmax(0, 112px) minmax(0, 1fr)",
            "--max-560-gap": "14px"
          }, attributes: { n: "discovery-source-identity-row" } }, [
            FieldView({ semantic_name: "discovery-source-avatar-field", label: "头像" }, [
              View(
                { class: "box-border flex items-center flex-wrap", style: {
                  "gap": "12px"
                }, attributes: { n: "discovery-source-avatar-control" } },
                [
                  Show({
                    when: combine(
                      { source: vm$.editing_source, file: vm$.state.avatar_file },
                      (deps) => Boolean(deps.source && deps.source.avatar_url) && deps.file === null,
                    ),
                    ok() {
                      return Img({
                        class: "box-border flex-none rounded-card bg-selected object-cover", style: {
                          "width": "48px",
                          "height": "48px"
                        },
                        attributes: { n: "discovery-source-avatar-preview", alt: "" },
                        src: computed(vm$.editing_source, (source) => (source ? source.avatar_url : "")),
                      });
                    },
                  }),
                  Show({
                    when: computed(vm$.state.preview_avatar, Boolean),
                    ok() { return Img({
                      class: "box-border flex-none rounded-card bg-selected object-cover", style: {
                        "width": "48px",
                        "height": "48px"
                      },
                      attributes: { n: "discovery-source-feed-avatar-preview", alt: "订阅源头像" },
                      src: vm$.state.preview_avatar,
                    }); },
                  }),
                  FilePicker({class: "box-border",
                    accept: avatar_accept,
                    tip: "选择头像",
                    attributes: {
                      n: "discovery-source-avatar-input",
                      "aria-label": "上传头像",
                    },
                    onChange(files) {
                      vm$.methods.set_avatar_file(files[0] || null);
                    },
                  }, ["选择头像"]),
                ],
              ),
              Show({
                when: computed(vm$.state.avatar_file, (file) => file !== null),
                ok() {
                  return View(
                    { class: "box-border text-muted break-anywhere", style: {
                      "font-size": "12px"
                    }, attributes: { n: "discovery-source-avatar-pending" } },
                    [
                      combine(
                        { file: vm$.state.avatar_file, editing: vm$.state.editing_id },
                        (deps) => {
                          const name = deps.file ? deps.file.name : "";
                          const size = deps.file ? format_bytes(deps.file.size) : "";
                          return "待上传：" + name + "（" + size + "）" +
                            (deps.editing ? "，保存后上传。" : "，创建订阅源后上传。");
                        },
                      ),
                    ],
                  );
                },
              }),
              Show({
                when: combine(
                  { source: vm$.editing_source, file: vm$.state.avatar_file },
                  (deps) => Boolean(deps.source && deps.source.avatar_url) && deps.file === null,
                ),
                ok() {
                  return Popconfirm({ title: "移除此订阅源的头像？", confirmText: "确认移除",
                    disabled: vm$.state.saving, attributes: { n: "discovery-source-avatar-remove-confirmation" },
                    onConfirm: () => vm$.methods.remove_avatar(),
                    trigger: props => Button({ ...props, disabled: vm$.state.saving, class: "box-border flex-none justify-self-center",
                      attributes: { ...props.attributes, n: "discovery-source-avatar-remove-button" } }, ["移除头像"]),
                  });
                },
              }),
              View(
                { class: "box-border m-0 text-muted break-anywhere col-span-full", style: {
                  "font-size": "12px",
                  "line-height": "1.5"
                }, attributes: { n: "discovery-source-avatar-hint" } },
                [
                  "支持 PNG / JPEG / WebP / GIF，小于 " + format_bytes(avatar_max_bytes) +
                    "，保存时上传。",
                ],
              ),
            ]),
            FieldView({ semantic_name: "discovery-source-title-field", label: "名称" }, [
              Input({class: "box-border",
                value: vm$.state.draft_title,
                attributes: { n: "discovery-source-title-input", "aria-label": "名称", maxlength: "128" },
                onInput(event) {
                  vm$.methods.set_draft("title", event.target.value);
                },
              }),
            ]),
          ]),
          FieldView({ semantic_name: "discovery-source-description-field", label: "简介" }, [
            View(
              {class: "box-border",  attributes: { n: "discovery-source-description-input" } },
              [
                Textarea({class: "box-border",
                  value: vm$.state.draft_description,
                  attributes: { n: "discovery-source-description-textarea", "aria-label": "简介", rows: "3", maxlength: "1000" },
                  onInput(event) {
                    vm$.methods.set_draft("description", event.target.value);
                  },
                }),
              ],
            ),
          ]),
          FieldView({ semantic_name: "discovery-source-type-field", label: "来源" }, [
            Select({class: "box-border",
              value: vm$.state.draft_source_type,
              options: vm$.state.platform_options,
              attributes: { n: "discovery-source-type-select", "aria-label": "来源" },
              render_option: ({ value, label }) => PlatformOptionView(value, vm$.state.platforms, label),
              render_value: ({ label }) => PlatformOptionView(vm$.state.draft_source_type, vm$.state.platforms, label),
              onChange(event) {
                vm$.methods.set_draft("source_type", event.target.value);
              },
            }),
            View(
              { class: "box-border m-0 text-muted break-anywhere col-span-full", style: {
                "font-size": "12px",
                "line-height": "1.5"
              }, attributes: { n: "discovery-source-type-hint" } },
              ["新增时根据订阅地址识别，可手动修改。"],
            ),
          ]),
          FieldView({ semantic_name: "discovery-source-website-field", label: "网站地址" }, [
            Input({class: "box-border",
              value: vm$.state.draft_website,
              placeholder: "https://example.com",
              attributes: {
                n: "discovery-source-website-input",
                "aria-label": "网站地址",
                inputmode: "url",
                maxlength: "2048",
                spellcheck: "false",
              },
              onInput(event) {
                vm$.methods.set_draft("website", event.target.value);
              },
            }),
          ]),
          FieldView({ semantic_name: "discovery-source-social-field", label: "社媒主页（可选）" }, [
            SourceSocialUrlsView({ store: vm$ }),
            View({ class: "box-border m-0 text-muted", style: { "font-size": "12px", "line-height": "1.5" },
              attributes: { n: "discovery-source-social-hint" } },
              ["第一项用作 RSS/Atom 的主页链接；已有 XML 在下次刷新后生效。留空沿用脚本输出。"]),
          ]),
          FieldView({ semantic_name: "discovery-source-tags-field", label: "标签（逗号分隔）" }, [
            Input({class: "box-border",
              value: vm$.state.draft_tags,
              placeholder: "选择下方标签，或输入标签",
              attributes: { n: "discovery-source-tags-input", "aria-label": "标签", maxlength: "512" },
              onInput(event) {
                vm$.methods.set_draft("tags", event.target.value);
              },
            }),
            View({ class: "box-border flex flex-wrap gap-space-3 min-w-0", attributes: { n: "discovery-source-tag-options", role: "group", "aria-label": "脚本标签" } }, [
              For({ each: vm$.state.tags, render(tag_value) {
                const tag = source_value(tag_value);
                return Input({
                  label: tag,
                  disabled: vm$.state.saving,
                  attributes: { n: "discovery-source-tag-option", type: "checkbox",
                    checked: computed(vm$.state.draft_tags, value => value.split(",").map(item => item.trim()).includes(tag)) },
                  onChange() { vm$.methods.toggle_tag(tag); },
                });
              } }),
            ]),
            View({ class: "box-border m-0 text-muted break-anywhere col-span-full", attributes: { n: "discovery-source-tags-hint" } }, [
              "可选标签来自已发布脚本；新增时按匹配路由预填，可手动修改。",
            ]),
          ]),
          FieldView({ semantic_name: "discovery-source-order-field", label: "排序值" }, [
            Input({class: "box-border",
              value: vm$.state.draft_sort_order,
              attributes: {
                n: "discovery-source-order-input",
                "aria-label": "排序值",
                inputmode: "numeric",
              },
              onInput(event) {
                vm$.methods.set_draft("sort_order", event.target.value);
              },
            }),
            View({ class: "box-border m-0 text-muted break-anywhere col-span-full", style: {
              "font-size": "12px",
              "line-height": "1.5"
            }, attributes: { n: "discovery-source-order-hint" } }, ["数值越小，展示越靠前。"]),
          ]),
          FieldView({ semantic_name: "discovery-source-poll-policy-field", label: "抓取规则" }, [
            PollPolicyView(vm$.poll_editor, { name: "discovery-source-poll", disabled: vm$.state.saving }),
            View({ class: "text-muted" }, ["公开源自动更新 XML 和广场预览；私密自有源自动更新 XML，仍需凭证访问且不发布预览。选择仅手动可停止自动抓取。外部私密源的快照由上游管理。"]),
          ]),
          View({ class: "box-border grid items-start gap-space-4", style: {
            "grid-template-columns": "minmax(0, 1fr) minmax(0, 2fr)"
          }, attributes: { n: "discovery-source-access-row" } }, [
            FieldView({ semantic_name: "discovery-source-require-token-field", label: "访问权限" }, [
              Input({class: "box-border",  label: "需要 token 访问",
                attributes: { n: "discovery-source-require-token-input", type: "checkbox",
                  checked: computed(vm$.state.draft_require_token, (required) => required || undefined),
                  "aria-label": "需要 token 访问" },
                onChange(event) { vm$.methods.set_draft("require_token", event.target.checked); },
              }),
              View({ class: "box-border m-0 text-muted break-anywhere col-span-full", style: {
                "font-size": "12px",
                "line-height": "1.5"
              }, attributes: { n: "discovery-source-require-token-hint" } }, [
                "自有源关闭此项后可公开访问。",
              ]),
            ]),
            Show({ when: vm$.state.draft_require_token, ok() {
              return FieldView({ semantic_name: "discovery-source-credit-cost-field", label: "每次访问消耗积分" }, [
                Input({ class: "box-border", value: vm$.state.draft_credit_cost, disabled: vm$.state.saving,
                  attributes: { n: "discovery-source-credit-cost-input", type: "number", min: "0", max: "1000000000", step: "1",
                    required: true, "aria-label": "每次访问消耗积分" },
                  onInput(event) { vm$.methods.set_draft("credit_cost", event.target.value); },
                }),
                View({ class: "text-muted", attributes: { n: "discovery-source-credit-cost-hint" } }, [
                  "自有源每次成功访问（含缓存命中）按此值扣费，默认 1；0 表示免费，仍需 token。",
                ]),
              ]);
            } }),
          ]),
        ]),
      ]),
    ]),
  ]);
}

function FilterFormView({ store }) {
  const vm$ = store;
  return View(
    { class: "box-border grid rounded-card bg-surface max-760-align-items max-760-flex-direction max-760-display max-760-grid-template-columns", style: {
      "grid-template-columns": "repeat(4, minmax(0, 1fr)) auto",
      "gap": "13px",
      "padding": "16px",
      "border": "1px solid var(--frui-color-border-soft)",
      "margin-bottom": "12px",
      "--max-760-align-items": "stretch",
      "--max-760-flex-direction": "column",
      "--max-760-display": "grid",
      "--max-760-grid-template-columns": "1fr"
    }, attributes: { n: "discovery-source-filter-form" } },
    [
      FieldView({ semantic_name: "discovery-source-filter-query-field", label: "搜索" }, [
        Input({class: "box-border",
          value: vm$.state.query, disabled: vm$.state.bulk_busy,
          placeholder: "名称、简介或 URL",
          attributes: { n: "discovery-source-filter-query-input", "aria-label": "搜索" },
          onInput(event) {
            vm$.methods.set_filter("query", event.target.value);
          },
        }),
      ]),
      FieldView({ semantic_name: "discovery-source-filter-platform-field", label: "来源" }, [
        Select({class: "box-border",
          value: vm$.state.filter_platform, disabled: vm$.state.bulk_busy,
          options: vm$.state.filter_platform_options,
          attributes: { n: "discovery-source-filter-platform-select", "aria-label": "筛选来源" },
          render_option: ({ value, label }) => PlatformOptionView(value, vm$.state.platforms, label),
          render_value: ({ label }) => PlatformOptionView(vm$.state.filter_platform, vm$.state.platforms, label),
          onChange(event) {
            vm$.methods.set_filter("platform", event.target.value);
          },
        }),
      ]),
      FieldView({ semantic_name: "discovery-source-filter-status-field", label: "状态" }, [
        Select({class: "box-border",
          value: vm$.state.filter_status, disabled: vm$.state.bulk_busy,
          options: filter_status_options,
          attributes: { n: "discovery-source-filter-status-select", "aria-label": "筛选状态" },
          onChange(event) {
            vm$.methods.set_filter("status", event.target.value);
          },
        }),
      ]),
      FieldView({ semantic_name: "discovery-source-filter-visibility-field", label: "公开性" }, [
        Select({ class: "box-border", value: vm$.state.filter_visibility, disabled: vm$.state.bulk_busy,
          options: filter_visibility_options,
          attributes: { n: "discovery-source-filter-visibility-select", "aria-label": "筛选公开性" },
          onChange(event) { return vm$.methods.set_filter("visibility", event.target.value); },
        }),
      ]),
      Button({ loading: vm$.state.loading,
        disabled: combine({ loading: vm$.state.loading, busy: vm$.state.bulk_busy }, value => value.loading || value.busy),
        style: { "align-self": "end", "justify-self": "end" },
        attributes: { n: "discovery-source-list-refresh" }, onClick: vm$.methods.refresh_list }, ["刷新"]),
    ],
  );
}

function SourceCellView(name, children) {
  return View({ class: "box-border min-w-0", style: {
    padding: "14px 12px", "border-bottom": "1px solid var(--frui-color-border-soft)",
  }, attributes: { n: "discovery-source-cell-" + name, role: "cell" } }, children);
}

function SourceAddressView({ store, source, kind, address = kind === "social" ? source.social_url : kind === "website" ? source.website : source.feed_url }) {
  const name = "discovery-source-row-";
  const label = kind === "social" ? "社媒主页" : kind === "feed" ? " RSS/Atom 地址" : "网站地址";
  const address_class = "block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm";
  return View({ class: "box-border grid items-center min-w-0 gap-space-2", style: {
    "grid-template-columns": kind === "social" ? "2.5em minmax(0, 1fr) auto" : "minmax(0, 1fr) auto",
    "min-height": "var(--frui-control-height-sm)",
  }, attributes: { n: name + kind + "-address" } }, [
    ...(kind === "social" ? [View({ class: "text-muted text-sm whitespace-nowrap", attributes: { n: name + kind + "-label" } }, ["社媒"])] : []),
    is_template_feed_url(address)
      ? View({ class: address_class + " text-muted",
        attributes: { n: name + (kind === "feed" ? "feed-value" : kind), title: address } }, [address])
      : Link({ class: address_class + " text-link no-underline hover-text-decoration-underline focus-visible-outline-2-pixels-solid-color-focus focus-visible-outline-offset-2-pixels", style: {
        "line-height": "var(--frui-control-height-sm)",
        "--focus-visible-outline-2-pixels-solid-color-focus": "2px solid var(--frui-color-focus)",
        "--focus-visible-outline-offset-2-pixels": "2px",
      },
        href: address, target: "_blank", rel: "noopener noreferrer",
        attributes: { n: name + (kind === "feed" ? "feed-link" : kind), title: address, "aria-label": "打开" + label + "：" + address } }, [address]),
    CopyButton({ size: "small", label: "复制" + label,
      attributes: { n: name + "copy-" + kind }, onCopy() { return store.methods.copy_url(address); } }),
  ]);
}

function format_relative_time(timestamp, now) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return "未知";
  const elapsed = now - value;
  const duration = Math.abs(elapsed);
  if (elapsed >= 0 && duration < 60_000) return "刚刚";
  const units = [["年", 365 * 86_400_000], ["个月", 30 * 86_400_000],
    ["天", 86_400_000], ["小时", 3_600_000], ["分钟", 60_000]];
  const [unit, interval] = units.find(([, interval]) => duration >= interval) || units.at(-1);
  const count = elapsed < 0 ? Math.ceil(duration / interval) : Math.floor(duration / interval);
  return count + unit + (elapsed < 0 ? "后" : "前");
}

function RelativeTimeView({ timestamp, now, scheduled = false, name, class: custom_class }) {
  return View({ as: "time", class: custom_class, attributes: { n: name, title: format_time(timestamp) } }, [
    computed(now, current => scheduled && timestamp <= current ? "等待调度" : format_relative_time(timestamp, current)),
  ]);
}

function SourceSnapshotTimeView({ timestamp, now, error, name, label }) {
  const tone = computed(error, reason => reason ? (timestamp ? "text-warning" : "text-danger") : "");
  const explanation = computed(error, reason => label + "失败：" + reason
    + (timestamp ? "（显示上次成功时间，保留上次内容）" : ""));
  return View({ class: "inline-flex items-center min-w-0 gap-space-1" }, [
    timestamp ? RelativeTimeView({ timestamp, now, name, class: tone })
      : View({ class: tone, attributes: { n: name } }, [computed(error, reason => reason ? label + "失败" : "等待生成")]),
    Show({ when: computed(error, Boolean), ok() {
      return Tooltip({ as: "button", content: explanation,
        class: computed(tone, color => "inline-flex items-center justify-center flex-none border-0 padding-0 background-transparent cursor-help rounded-control focus-visible-outline-2-pixels-solid-color-focus focus-visible-outline-offset-2-pixels " + color),
        style: { "--focus-visible-outline-2-pixels-solid-color-focus": "2px solid var(--frui-color-focus)", "--focus-visible-outline-offset-2-pixels": "2px" },
        attributes: { n: name + "-info", type: "button", "aria-label": explanation },
      }, [Icon("info-circle", 14)]);
    } }),
  ]);
}

function SourceSnapshotView({ source, now = ref(Date.now()), error = ref(source.snapshot.error || "") }) {
  const cache = source.cache;
  return TableField({
    class: "text-muted",
    style: { "grid-template-columns": "64px minmax(0, 1fr)", "line-height": "1.6" },
    attributes: { n: "discovery-source-row-metadata" },
    labelProps: { class: "whitespace-nowrap" },
    items: [
      ...(cache ? [{ key: "xml", label: "XML", value:
        View({ class: "flex flex-wrap items-center min-w-0 gap-space-2", attributes: { n: "discovery-source-xml-details" } }, [
          Badge({ tone: cache.status === "empty" ? "neutral" : "success", attributes: { n: "discovery-source-xml-state" } },
            [cache.status === "empty" ? "未生成" : "已生成"]),
          ...(cache.saved_at ? [Badge({ attributes: { n: "discovery-source-xml-size" } }, [format_bytes(cache.bytes)])] : []),
          ...(cache.refreshing ? [Badge({ tone: "brand", attributes: { n: "discovery-source-xml-refreshing" } }, ["正在生成"])] : []),
        ]),
      },
        { key: "xml-saved-at", label: "XML 抓取", value:
          SourceSnapshotTimeView({ timestamp: cache.saved_at, now, error, name: "discovery-source-xml-saved-at", label: "抓取" }) },
      ] : []),
      { key: "snapshot", label: "广场快照", value:
        View({ class: "flex flex-wrap items-center min-w-0 gap-space-2", attributes: { n: "discovery-source-snapshot-details" } }, [
          source.require_token ? "不生成公开快照"
            : SourceSnapshotTimeView({ timestamp: source.snapshot.saved_at, now, error, name: "discovery-source-snapshot-saved-at", label: "快照生成" }),
        ]),
      },
      ...(source.enabled && (!source.require_token || is_managed_rss_url(source.feed_url_template || source.feed_url)) ? [
        { key: "next-snapshot", label: "下次抓取", value:
          View({ class: "flex flex-wrap items-center min-w-0 gap-space-1", attributes: { n: "discovery-source-next-snapshot-details" } }, [
            source.next_snapshot_at === null ? "仅手动抓取"
              : RelativeTimeView({ timestamp: source.next_snapshot_at, now, scheduled: true, name: "discovery-source-next-snapshot-time" }),
            Tooltip({
              as: "button",
              content: "抓取规则：" + poll_policy_label(source.poll_policy)
                + (source.poll_policy.mode === "inherit" && source.poll_effective ? "（" + poll_policy_label(source.poll_effective) + "）" : ""),
              class: "inline-flex items-center justify-center flex-none border-0 padding-0 background-transparent color-color-muted cursor-help focus-visible-outline-2-pixels-solid-color-focus focus-visible-outline-offset-2-pixels focus-visible-border-radius-radius-sm",
              style: { "--focus-visible-outline-2-pixels-solid-color-focus": "2px solid var(--frui-color-focus)", "--focus-visible-outline-offset-2-pixels": "2px" },
              attributes: { n: "discovery-source-poll-rule-help", type: "button", "aria-label": "查看抓取规则" },
            }, [Icon("circle-help", 14)]),
          ]),
        },
      ] : []),
    ],
  });
}

function SourceRowView({ store: vm$, source, now }) {
  const initial = String(source.title || "?").trim().charAt(0).toUpperCase() || "?";
  const avatar_failed_ = ref(false);
  const row_busy = combine({ bulk: vm$.state.bulk_busy, updating: vm$.state.source_updating },
    ({ bulk, updating }) => bulk || updating.includes(source.id));
  return View({ class: computed(vm$.state.selected_ids, ids => "box-border grid hover-background-color-surface-hover " + (ids.includes(source.id) ? "bg-selected" : "")),
    style: { "grid-template-columns": "var(--discovery-source-columns)" },
    attributes: { n: "discovery-source-row", role: "row", "aria-selected": computed(vm$.state.selected_ids, ids => String(ids.includes(source.id))) },
    dataset: { sourceId: source.id },
  }, [
    SourceCellView("selection", [Input({ disabled: vm$.state.bulk_busy,
      attributes: { n: "discovery-source-select", type: "checkbox", "aria-label": "选择订阅源“" + source.title + "”",
        checked: computed(vm$.state.selected_ids, ids => ids.includes(source.id)) },
      onChange() { vm$.methods.toggle_selection(source.id); },
    })]),
    SourceCellView("identity", [
      View({ class: "flex items-start min-w-0 gap-space-3", attributes: { n: "discovery-source-row-identity" } }, [
        Show({ when: computed(avatar_failed_, failed => Boolean(source.avatar_url) && !failed),
          ok() { return Img({ class: "flex-none rounded-card object-cover bg-selected", style: { width: "36px", height: "36px" }, src: source.avatar_url,
            attributes: { n: "discovery-source-row-avatar", alt: "", loading: "lazy", decoding: "async" }, onError() { avatar_failed_.set(true); } }); },
          else() { return View({ class: "flex-none rounded-card bg-selected grid place-items-center", style: { width: "36px", height: "36px", "font-weight": "700" },
            attributes: { n: "discovery-source-row-initial", "aria-hidden": "true" } }, [initial]); },
        }),
        View({ class: "grid min-w-0 gap-space-1", attributes: { n: "discovery-source-row-details" } }, [
          View({ class: "flex flex-wrap items-center gap-space-2", attributes: { n: "discovery-source-row-heading" } }, [
            View({ class: "text-text break-anywhere", style: { "font-size": "14px", "font-weight": "650" }, attributes: { n: "discovery-source-row-title" } }, [source.title]),
          ]),
          View({ class: "text-muted text-sm display-webkit-box webkit-box-orient-vertical overflow-hidden break-anywhere line-height-1-5", style: { "-webkit-line-clamp": "3" },
            attributes: { n: "discovery-source-row-description", title: source.description } }, [source.description || "暂无简介"]),
          View({ class: "flex flex-wrap gap-space-1 min-w-0", attributes: { n: "discovery-source-row-tags", role: "list", "aria-label": "订阅源标签" } },
            source.tags.map(tag => Badge({ attributes: { n: "discovery-source-row-tag", role: "listitem" } }, [tag]))),
        ]),
      ]),
    ]),
    SourceCellView("links", [
      View({ class: "grid min-w-0 gap-space-1",
        attributes: { n: "discovery-source-row-addresses", role: "group", "aria-label": "订阅源链接" } }, [
        ...(source.website ? [SourceAddressView({ store: vm$, source, kind: "website" })] : []),
        ...(source.social_urls || (source.social_url ? [source.social_url] : [])).map(address => SourceAddressView({ store: vm$, source, kind: "social", address })),
        SourceAddressView({ store: vm$, source, kind: "feed" }),
      ]),
    ]),
    SourceCellView("platform", [
      View({ class: "flex items-center min-w-0 break-anywhere",
        attributes: { n: "discovery-source-row-platform" } }, [
        PlatformOptionView(source.source_type, vm$.state.platforms,
          computed(vm$.state.platforms, platforms => discovery_platform_label(source.source_type, platforms))),
      ]),
    ]),
    SourceCellView("status", [
      View({ class: "grid gap-space-2", attributes: { n: "discovery-source-row-status" } }, [
        Switch({ size: "small", label: "启用", checked: source.enabled, disabled: row_busy,
          labelProps: { class: "text-muted text-sm" },
          attributes: { n: "discovery-source-enabled", "aria-label": "启用订阅源“" + source.title + "”" },
          onChange(enabled) { vm$.methods.toggle_source(source.id, enabled); },
        }),
        Switch({ size: "small", label: "公开", checked: !source.require_token, disabled: row_busy,
          labelProps: { class: "text-muted text-sm" },
          attributes: { n: "discovery-source-public", "aria-label": "公开订阅源“" + source.title + "”" },
          onChange(is_public) { vm$.methods.set_source_public(source.id, is_public); },
        }),
        ...(source.sort_order ? [View({ class: "text-muted tabular-nums", attributes: { n: "discovery-source-row-order" } }, ["排序 " + source.sort_order])] : []),
      ]),
    ]),
    SourceCellView("snapshot", [SourceSnapshotView({ source, now,
      error: computed(vm$.state.snapshot_errors, errors => errors.get(source.id) || source.snapshot.error || ""),
    })]),
    SourceCellView("actions", [
      View({ class: "grid gap-space-2", attributes: { n: "discovery-source-row-actions" } }, [
        View({ class: "flex flex-wrap gap-space-1", attributes: { n: "discovery-source-row-action-buttons" } }, [
          Button({ size: "small", variant: "ghost", disabled: row_busy, attributes: { n: "discovery-source-edit-button" },
            onClick() { vm$.methods.edit_source(source.id); } }, ["编辑"]),
          Button({ size: "small", variant: "ghost",
            loading: computed(vm$.state.snapshot_refreshing, ids => ids.includes(source.id)),
            disabled: combine({ ids: vm$.state.snapshot_refreshing, busy: row_busy }, ({ ids, busy }) => busy || (source.require_token && !source.cache) || ids.includes(source.id)),
            attributes: { n: "discovery-source-refresh-snapshot" }, onClick() { return vm$.methods.refresh_snapshot(source.id); },
          }, [computed(vm$.state.snapshot_refreshing, ids => ids.includes(source.id) ? "生成中…" : "刷新快照")]),
          Popconfirm({ title: `删除订阅源“${source.title}”？此操作无法撤销。`, disabled: row_busy,
            attributes: { n: "discovery-source-delete-confirmation" }, onConfirm: () => vm$.methods.remove_source(source.id),
            trigger: props => Button({ ...props, size: "small", disabled: row_busy,
              attributes: { ...props.attributes, n: "discovery-source-delete-button" } }, ["删除"]),
          }),
        ]),
        View({ class: "text-danger whitespace-pre-wrap break-anywhere", attributes: { n: "discovery-source-snapshot-error", role: "alert" } }, [
          computed(vm$.state.snapshot_errors, errors => errors.get(source.id) || ""),
        ]),
      ]),
    ]),
  ]);
}

function SourceBulkActionsView({ store: vm$ }) {
  const disabled = combine({ busy: vm$.state.bulk_busy, loading: vm$.state.loading, selected: vm$.state.selected_ids, updating: vm$.state.source_updating },
    ({ busy, loading, selected, updating }) => busy || loading || updating.length > 0 || !selected.length);
  return View({ class: "flex flex-wrap items-center justify-between gap-space-3", style: { "margin-block": "16px" },
    attributes: { n: "discovery-source-bulk-toolbar" } }, [
    View({ class: "flex flex-wrap items-center gap-space-3", attributes: { n: "discovery-source-bulk-controls" } }, [
      DropdownMenu({ disabled, attributes: { n: "discovery-source-bulk-menu", "aria-label": "批量操作" },
        trigger: props => Button({ ...props, disabled }, ["批量操作", Icon("chevron-down", 14)]),
        items: [
          { id: "discovery-bulk-enable", label: "批量启用", onClick: () => vm$.methods.bulk_action("enable") },
          { id: "discovery-bulk-disable", label: "批量停用", onClick: () => vm$.methods.bulk_action("disable") },
          { id: "discovery-bulk-refresh", label: "批量刷新快照", onClick: () => vm$.methods.bulk_action("refresh") },
        ],
      }),
      Popconfirm({
        title: computed(vm$.state.selected_ids, ids => `删除选中的 ${ids.length} 个订阅源？此操作无法撤销。`),
        disabled, attributes: { n: "discovery-bulk-delete-confirmation" }, onConfirm: () => vm$.methods.bulk_action("delete"),
        trigger: props => Button({ ...props, size: "small", variant: "danger", disabled,
          attributes: { ...props.attributes, n: "discovery-bulk-delete" } }, ["批量删除"]),
      }),
      View({ class: "text-muted tabular-nums", attributes: { n: "discovery-source-selection-summary", role: "status" } }, [
        computed(vm$.state.selected_ids, ids => "已选择 " + ids.length + " 项"),
      ]),
      Button({ size: "small", variant: "ghost", disabled, attributes: { n: "discovery-source-clear-selection" },
        onClick: vm$.methods.clear_selection }, ["清空选择"]),
    ]),
    View({ class: "text-muted", style: { "font-size": "12px" }, attributes: { n: "discovery-source-selection-hint" } }, ["支持跨页选择，切换筛选后清空"]),
    Show({ when: computed(vm$.state.bulk_message, Boolean), ok() {
      return View({ class: "text-muted whitespace-pre-wrap", style: { width: "100%" },
        attributes: { n: "discovery-source-bulk-message", role: "status" } }, [vm$.state.bulk_message]);
    } }),
  ]);
}

function SourceTableView({ store: vm$ }) {
  const now_ = ref(Date.now());
  let time_timer;
  return View({ class: "box-border min-w-0 overflow-auto rounded-card bg-surface", style: { border: "1px solid var(--frui-color-border)", "margin-top": "12px" },
    onMounted() {
      now_.as(Date.now());
      if (time_timer !== undefined) return;
      time_timer = setInterval(() => now_.as(Date.now()), 60_000);
    },
    onUnmounted() {
      clearInterval(time_timer);
      time_timer = undefined;
    },
    attributes: { n: "discovery-source-table-scroll", role: "region", "aria-label": "订阅源表格", tabindex: "0" } }, [
    View({ class: "box-border", style: { width: "100%", "min-width": "1280px", "font-size": "12px",
      "--discovery-source-columns": "44px minmax(240px, 1fr) minmax(300px, 1.25fr) 120px 110px 280px 170px" },
      attributes: { n: "discovery-source-table", role: "table", "aria-label": "订阅源列表", "aria-busy": computed(vm$.state.loading, String) } }, [
      View({ class: "bg-surface-raised text-muted", attributes: { n: "discovery-source-table-header", role: "rowgroup" } }, [
        View({ class: "grid", style: { "grid-template-columns": "var(--discovery-source-columns)" }, attributes: { n: "discovery-source-table-header-row", role: "row" } }, [
          View({ style: { padding: "12px", "box-sizing": "border-box" }, attributes: { n: "discovery-source-selection-header", role: "columnheader" } }, [
            Input({ disabled: combine({ busy: vm$.state.bulk_busy, loading: vm$.state.loading, rows: vm$.paged_sources }, ({ busy, loading, rows }) => busy || loading || !rows.length),
              attributes: { n: "discovery-source-select-page", type: "checkbox",
                "aria-label": computed(vm$.page_selection, selection => selection.some && !selection.all ? "选择本页全部订阅源（本页部分已选）" : "选择本页全部订阅源"),
                checked: computed(vm$.page_selection, selection => selection.all) },
              onChange: vm$.methods.toggle_page_selection,
            }),
          ]),
          ...[["identity", "订阅源"], ["links", "链接"], ["platform", "来源"], ["status", "状态"], ["snapshot", "抓取与快照"], ["actions", "操作"]].map(([name, label]) =>
            View({ style: { padding: "12px", "text-align": "left", "font-weight": "500", "box-sizing": "border-box" },
              attributes: { n: "discovery-source-header-" + name, role: "columnheader" } }, [label])),
        ]),
      ]),
      View({ attributes: { n: "discovery-source-list", role: "rowgroup" } }, [
        Show({ when: combine({ loading: vm$.state.loading, rows: vm$.paged_sources }, ({ loading, rows }) => loading || !rows.length),
          ok() { return View({ attributes: { n: "discovery-source-table-state-row", role: "row" } }, [
            View({ class: "text-muted text-center", style: { padding: "32px" }, attributes: { n: "discovery-source-table-state", role: "cell", "aria-colspan": "7", "aria-live": "polite" } },
              [computed(vm$.state.loading, loading => loading ? "正在加载订阅源…" : "没有匹配的订阅源。")]),
          ]); },
        }),
        Show({ when: computed(vm$.state.loading, loading => !loading), ok() {
          return For({ each: vm$.paged_sources, render(raw) { return SourceRowView({ store: vm$, source: source_value(raw), now: now_ }); } });
        } }),
      ]),
    ]),
  ]);
}

function SourceListView({ store }) {
  const vm$ = store;
  return View(
    { class: "box-border min-w-0", attributes: { n: "discovery-source-list-section" } },
    [
      FilterFormView({ store: vm$ }),
      SourceBulkActionsView({ store: vm$ }),
      Show({
        when: computed(vm$.state.list_error, Boolean),
        ok() {
          return View(
            { class: "box-border text-danger whitespace-pre-wrap", style: {
              "margin": "12px 0 0"
            }, attributes: { n: "discovery-source-list-error", role: "alert" } },
            [vm$.state.list_error],
          );
        },
      }),
      SourceTableView({ store: vm$ }),
      PaginationView(Timeless, { model: vm$.pagination, name: "discovery-pagination", label: "订阅源列表分页" }),
    ],
  );
}

function SourceImportView({ store: vm$ }) {
  const state = vm$.state;
  const blocked = combine({ busy: state.import_busy, reading: state.import_reading }, values => values.busy || values.reading);
  const trigger = document.activeElement;
  function handle_keydown(event) {
    if (event.key === "Escape") { event.stopPropagation(); vm$.methods.close_import(); }
    const dialog = document.querySelector('[data-n="discovery-import-dialog"], [n="discovery-import-dialog"]');
    const dropzone = dialog?.querySelector('[n="discovery-import-file-dropzone"], [data-n="discovery-import-file-dropzone"]');
    if (event.target === dropzone && ["Enter", " "].includes(event.key) && !blocked.value) {
      event.preventDefault(); dialog.querySelector('input[type="file"]')?.click();
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(dialog?.querySelectorAll('button:not(:disabled), textarea:not(:disabled), [role="button"][tabindex="0"]:not([disabled])') || [])
      .filter(node => node.getClientRects().length);
    const next = event.shiftKey ? controls.at(-1) : controls[0];
    const edge = event.shiftKey ? controls[0] : controls.at(-1);
    if (document.activeElement === edge || !controls.includes(document.activeElement)) {
      event.preventDefault(); next?.focus();
    }
  }
  return Dialog({
    open: state.import_open, title: "导入 JSON",
    description: '粘贴订阅源数组或 { "sources": [...] }，也可拖入导出的 JSON 文件。仅新增，重复地址跳过。',
    class: "box-border flex flex-col overflow-hidden p-0",
    style: { width: "min(680px, calc(100vw - 32px))", "max-height": "calc(100dvh - 32px)" },
    attributes: { n: "discovery-import-dialog", "aria-label": "导入订阅源 JSON" },
    headerProps: { class: "box-border flex-none m-0", style: { padding: "20px 24px" } },
    bodyProps: { class: "box-border grid min-h-0 overflow-auto", style: { padding: "0 24px 24px", gap: "14px" } },
    footerProps: { class: "box-border flex-none m-0", style: { padding: "16px 24px" } },
    closable: false, maskClosable: false, onClose: vm$.methods.close_import,
    onMounted() { document.addEventListener("keydown", handle_keydown); },
    onUnmounted() { document.removeEventListener("keydown", handle_keydown); trigger?.focus?.(); },
    footer: [
      Button({ attributes: { n: "discovery-import-cancel-button" }, disabled: state.import_busy,
        onClick: vm$.methods.close_import }, ["关闭"]),
      Button({ attributes: { n: "discovery-import-submit-button" },
        disabled: combine({ blocked, text: state.import_text }, values => values.blocked || !values.text.trim()),
        onClick: vm$.methods.import_sources }, [computed(state.import_busy, busy => busy ? "导入中…" : "导入")]),
    ],
  }, [
    FilePicker({ accept: ".json", disabled: blocked, loading: state.import_reading,
      attributes: { n: "discovery-import-file", "aria-label": "选择或拖入 JSON 文件", role: "button", tabindex: "0" },
      tip: "拖入 JSON 文件，或点击选择（最大 2 MB）", onChange: vm$.methods.read_import_file }),
    Textarea({ value: state.import_text, disabled: blocked,
      placeholder: '{ "sources": [{ "title": "示例", "feed_url": "https://example.com/feed" }] }',
      attributes: { n: "discovery-import-text", "aria-label": "订阅源 JSON", rows: "12", spellcheck: "false" },
      onInput: event => vm$.methods.set_import_text(event.target.value) }),
    View({ class: "text-success", attributes: { n: "discovery-import-message", role: "status" } }, [state.import_message]),
    View({ class: "text-danger whitespace-pre-wrap break-anywhere", attributes: { n: "discovery-import-error", role: "alert" } }, [state.import_error]),
  ]);
}

function DiscoveryApplicationView(embedded = false) {
  const vm$ = DiscoveryAdminViewModel();
  let detach_agent;
  const content = View(
    {
      class: "box-border min-w-0",
      attributes: { n: "discovery-admin-content" },
      onMounted() {
        vm$.methods.start();
        detach_agent = window.FindRSSAdminAgent?.register_page("/admin/discovery", {
          read_context: () => ({ filters: { query: vm$.state.query.value, source_type: vm$.state.filter_platform.value, status: vm$.state.filter_status.value, visibility: vm$.state.filter_visibility.value },
            selected_source_id: vm$.state.editing_id.value, form_open: vm$.state.form_open.value,
            ...(vm$.state.form_open.value ? { unsaved_draft: { title: vm$.state.draft_title.value, feed_url: vm$.state.draft_feed_url.value, website: vm$.state.draft_website.value, social_urls: vm$.state.draft_social_urls.value, description: vm$.state.draft_description.value, tags: vm$.state.draft_tags.value, enabled: vm$.state.draft_enabled.value, require_token: vm$.state.draft_require_token.value, credit_cost: vm$.state.draft_credit_cost.value, sort_order: vm$.state.draft_sort_order.value, source_type: vm$.state.draft_source_type.value } } : {}) }),
          async on_change(event) {
            await vm$.methods.refresh_list();
            if (event.action === "delete" && vm$.state.editing_id.value === event.source_id) vm$.methods.close_form();
          },
        });
      },
      onUnmounted() { detach_agent?.(); vm$.pagination.destroy(); },
    },
    [SourceListView({ store: vm$ }), Show({ when: vm$.state.form_open,
      ok() { return SourceFormView({ store: vm$ }); },
    }), Show({ when: vm$.state.import_open, ok: () => SourceImportView({ store: vm$ }) })],
  );
  const page_options = {
    page_id: "discovery",
    eyebrow: "Discovery Operations",
    title: "订阅源管理",
    count: computed(vm$.pagination.total, String),
    actions: [Button({ attributes: { n: "discovery-source-import-button" },
      disabled: combine({ loading: vm$.state.loading, saving: vm$.state.saving, bulk_busy: vm$.state.bulk_busy }, values => values.loading || values.saving || values.bulk_busy),
      onClick: vm$.methods.open_import }, ["导入 JSON"]),
      Button({class: "box-border",  variant: "secondary", attributes: { n: "discovery-source-export-button", title: "导出所有订阅源，包括停用源，不受分页和筛选影响" },
      disabled: vm$.state.loading,
      onClick: vm$.methods.export_sources }, ["导出 JSON"]), Button({class: "box-border",  attributes: { n: "discovery-source-create-button" },
      disabled: combine({ saving: vm$.state.saving, bulk_busy: vm$.state.bulk_busy }, values => values.saving || values.bulk_busy), onClick: vm$.methods.create_source }, ["新增订阅源"])],
  };
  return embedded
    ? window.FindRSSAdminShell.Page(page_options, [content])
    : window.FindRSSAdminShell.View(page_options, [content]);
}

function DiscoveryPage() { return DiscoveryApplicationView(true); }

export { DiscoveryPage, SourceFormView };
