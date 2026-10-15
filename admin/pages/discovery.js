import { PaginationView } from "../components/pagination.js";
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
const { Badge, Button, CopyButton, Dialog, For, FilePicker, FeedAddressEditor, Field, Img, Input, Icon, Link, Select, Show, Textarea, View, combine, computed, ref, refarr } = Timeless;

const avatar_accept = "image/png,image/jpeg,image/webp,image/gif";

const avatar_max_bytes = 5 * 1024 * 1024;

const filter_status_options = [
  { value: "all", label: "全部" },
  { value: "enabled", label: "启用" },
  { value: "disabled", label: "停用" },
];

/** @param {unknown} value */
function source_value(value) {
  return value && value.__is_ref ? value.value : value;
}

function PlatformOptionView(id, platforms, label) {
  return View({ class: "inline-flex items-center", style: { gap: "6px" } }, [
    Img({ class: "block flex-none object-fit-contain", style: { width: "18px", height: "18px" },
      src: combine({ id: typeof id === "string" ? ref(id) : id, platforms },
        values => discovery_platform_icon_url(values.id, values.platforms)),
      attributes: { alt: "", "aria-hidden": "true", width: "18", height: "18" } }),
    label,
  ]);
}

function format_time(value) {
  if (!value) return "未知";
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? "未知" : date.toLocaleString();
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
                  return Button(
                    {
                      class: "box-border flex-none justify-self-center",
                      attributes: { n: "discovery-source-avatar-remove-button" },
                      onClick() {
                        return vm$.methods.remove_avatar();
                      },
                    },
                    ["移除头像"],
                  );
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
          FieldView({ semantic_name: "discovery-source-type-field", label: "平台" }, [
            Select({class: "box-border",
              value: vm$.state.draft_source_type,
              options: vm$.state.platform_options,
              attributes: { n: "discovery-source-type-select", "aria-label": "平台" },
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
          FieldView({ semantic_name: "discovery-source-tags-field", label: "标签（逗号分隔）" }, [
            Input({class: "box-border",
              value: vm$.state.draft_tags,
              placeholder: "科技, 视频, 文章, 音频, 博客",
              attributes: { n: "discovery-source-tags-input", "aria-label": "标签", maxlength: "512" },
              onInput(event) {
                vm$.methods.set_draft("tags", event.target.value);
              },
            }),
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
              "自有源关闭此项后可公开访问；外部源遵循原站权限。",
            ]),
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
      "grid-template-columns": "repeat(3, minmax(0, 1fr))",
      "gap": "13px",
      "margin-top": "16px",
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
          value: vm$.state.query,
          placeholder: "名称、简介或 URL",
          attributes: { n: "discovery-source-filter-query-input", "aria-label": "搜索" },
          onInput(event) {
            vm$.methods.set_filter("query", event.target.value);
          },
        }),
      ]),
      FieldView({ semantic_name: "discovery-source-filter-platform-field", label: "平台" }, [
        Select({class: "box-border",
          value: vm$.state.filter_platform,
          options: vm$.state.filter_platform_options,
          attributes: { n: "discovery-source-filter-platform-select", "aria-label": "筛选平台" },
          render_option: ({ value, label }) => PlatformOptionView(value, vm$.state.platforms, label),
          render_value: ({ label }) => PlatformOptionView(vm$.state.filter_platform, vm$.state.platforms, label),
          onChange(event) {
            vm$.methods.set_filter("platform", event.target.value);
          },
        }),
      ]),
      FieldView({ semantic_name: "discovery-source-filter-status-field", label: "状态" }, [
        Select({class: "box-border",
          value: vm$.state.filter_status,
          options: filter_status_options,
          attributes: { n: "discovery-source-filter-status-select", "aria-label": "筛选状态" },
          onChange(event) {
            vm$.methods.set_filter("status", event.target.value);
          },
        }),
      ]),
    ],
  );
}

function SourceCardView({ store, source }) {
  const vm$ = store;
  const initial = String(source.title || "?").trim().charAt(0).toUpperCase() || "?";
  const avatar_failed_ = ref(false);
  const avatar_visible_ = computed(avatar_failed_, (failed) => source.avatar_url !== "" && !failed);
  return View(
    {
      class: "box-border grid rounded-card bg-surface-raised min-w-0", style: {
        "gap": "11px",
        "padding": "15px",
        "border": "1px solid var(--frui-color-border)",
        "grid-template-columns": "minmax(0, 1fr)"
      },
      attributes: { n: "discovery-source-card" },
      dataset: { sourceId: source.id },
    },
    [
      View(
        { class: "box-border flex items-flex-start justify-between", style: {
          "gap": "15px"
        }, attributes: { n: "discovery-source-card-header" } },
        [
          Show({
            when: avatar_visible_,
            ok() {
              return Img({
                class: "box-border flex-none rounded-card bg-selected object-cover", style: {
                  "width": "40px",
                  "height": "40px"
                },
                attributes: { n: "discovery-source-card-avatar", alt: "", loading: "lazy", decoding: "async" },
                src: source.avatar_url,
                onError() {
                  avatar_failed_.as(true);
                },
              });
            },
            else() {
              return View(
                {
                  class: "box-border flex-none rounded-card object-cover grid place-items-center", style: {
                    "width": "40px",
                    "height": "40px",
                    "background": "linear-gradient(135deg, var(--frui-color-selected), var(--frui-color-danger-bg))",
                    "font-weight": "700"
                  },
                  attributes: { n: "discovery-source-card-initial", "aria-hidden": "true" },
                },
                [initial],
              );
            },
          }),
          View(
            { class: "box-border flex-1 min-w-0", attributes: { n: "discovery-source-card-identity" } },
            [
              // 与订阅广场一致：来源类型单独提到标题上方当 eyebrow。
              View(
                {
                  class: "box-border inline-flex items-center text-muted", style: {
                    "gap": "4px",
                    "margin-bottom": "3px",
                    "font-size": "11px",
                    "font-weight": "700",
                    "letter-spacing": ".04em"
                  },
                  attributes: { n: "discovery-source-card-type" },
                },
                [
                  Img({ class: "box-border block flex-none object-fit-contain", style: {
                    "width": "16px",
                    "height": "16px"
                  }, src: computed(vm$.state.platforms, platforms => discovery_platform_icon_url(source.source_type, platforms)),
                    attributes: { n: "discovery-source-card-type-icon", alt: "", "aria-hidden": "true", width: "16", height: "16" } }),
                  computed(vm$.state.platforms, platforms => discovery_platform_label(source.source_type, platforms)),
                ],
              ),
              View(
                { class: "box-border m-0", style: {
                  "font-size": "17px"
                }, attributes: { n: "discovery-source-card-title" } },
                [source.title],
              ),
              View({ class: "box-border flex items-center min-w-0", style: {
                "gap": "6px"
              }, attributes: { n: "discovery-source-card-website-address" } }, [
                is_template_feed_url(source.website || source.feed_url)
                  ? View({ class: "box-border block min-w-0 m-0 text-muted break-anywhere", style: {
                    "font-size": "11px"
                  }, attributes: { n: "discovery-source-card-website" } }, [source.website || source.feed_url])
                  : Link({ class: "box-border block min-w-0 w-fit-content m-0 p-0 bg-transparent text-link break-anywhere text-left", style: {
                    "font-size": "11px"
                  }, href: source.website || source.feed_url,
                    target: "_blank", rel: "noopener noreferrer",
                    attributes: { n: "discovery-source-card-website", title: "打开网站" } }, [source.website || source.feed_url]),
                CopyButton({class: "box-border",  size: "small", label: "复制网站地址", attributes: { n: "discovery-source-card-copy-website" },
                  onCopy() { return vm$.methods.copy_url(source.website || source.feed_url); } }),
              ]),
            ],
          ),
          View(
            {
              class: "box-border " + ("flex-none rounded-pill " + (!source.enabled ? "bg-surface-raised text-muted" : "bg-selected text-link")), style: {
                "padding": "5px 9px",
                "font-size": "11px"
              },
              attributes: { n: "discovery-source-status" },
            },
            [source.enabled ? "启用" : "停用"],
          ),
        ],
      ),
      View(
        { class: "box-border m-0 text-muted", style: {
          "font-size": "13px",
          "line-height": "1.55"
        }, attributes: { n: "discovery-source-card-description" } },
        [source.description || "暂无简介"],
      ),
      Show({
        when: source.tags.length > 0,
        ok() {
          return View({ class: "box-border flex flex-wrap gap-space-2 min-w-0", attributes: { n: "discovery-source-card-tags", role: "list", "aria-label": "订阅源标签" } }, [
            For({ each: refarr(source.tags), render(tag_value) {
              return Badge({ class: "box-border max-w-full break-anywhere", style: {
                "line-height": "1.5"
              }, attributes: { n: "discovery-source-card-tag", role: "listitem" } },
                [source_value(tag_value)]);
            } }),
          ]);
        },
      }),
      View(
        { class: "box-border flex flex-wrap text-muted", style: {
          "gap": "6px",
          "font-size": "11px"
        }, attributes: { n: "discovery-source-card-metadata" } },
        [
          View({class: "box-border",  attributes: { n: "discovery-source-card-order" } }, ["排序 " + source.sort_order]),
          View({class: "box-border",  attributes: { n: "discovery-source-card-updated" } }, ["更新于 " + format_time(source.updated_at)]),
          Show({
            when: Boolean(source.cache),
            ok() {
              const cache = source.cache;
              return View({class: "box-border",  attributes: { n: "discovery-source-cache-status" } }, [
                (cache.status === "fresh" ? "XML 快照有效（10 分钟）" : cache.status === "expired" ? "XML 快照待更新" : "无 XML 快照") +
                (cache.refreshing ? " · 正在生成" : "") +
                (cache.saved_at ? " · 抓取于 " + format_time(cache.saved_at) + " · " + format_bytes(cache.bytes) +
                  (cache.persistent ? " · 已持久化" : " · 仅内存") : ""),
              ]);
            },
          }),
          View({class: "box-border",  attributes: { n: "discovery-source-snapshot-status" } }, [
            source.require_token ? "不生成公开快照" : source.snapshot.saved_at
              ? "广场快照 · " + format_time(source.snapshot.saved_at) + (source.snapshot.error ? " · 更新失败，保留上次内容" : "")
              : "广场快照 · " + (source.snapshot.error ? "生成失败：" + source.snapshot.error : "等待生成"),
          ]),
          Show({
            // 自有路由源始终展示公开性；其它地址只在勾了「需要 token 访问」时给出提示。
            when: is_managed_rss_url(source.feed_url) || source.require_token === true,
            ok() {
              return View(
                {
                  class: "box-border " + (" " + (source.require_token ? "bg-warning-bg text-warning" : !source.require_token ? "bg-success-bg text-success" : "")), style: {},
                  attributes: { n: "discovery-source-access-badge" },
                },
                [source.require_token ? "需 token" : "公开"],
              );
            },
          }),
        ],
      ),
      View({ class: "box-border flex items-center min-w-0", style: {
        "gap": "6px"
      }, attributes: { n: "discovery-source-card-feed-address" } }, [
        // 模板地址尚未展开时只显示文本，仍可复制。
        is_template_feed_url(source.feed_url)
          ? View({ class: "box-border block min-w-0 m-0 text-muted break-anywhere", style: {
            "font-size": "11px"
          }, attributes: { n: "discovery-source-card-feed-value" } }, [source.feed_url])
          : Link({ class: "box-border block min-w-0 w-fit-content m-0 p-0 bg-transparent text-link break-anywhere text-left", style: {
            "font-size": "11px"
          }, href: source.feed_url, target: "_blank", rel: "noopener noreferrer",
            attributes: { n: "discovery-source-card-feed-link", title: "打开 RSS/Atom 地址" } }, [source.feed_url]),
        CopyButton({class: "box-border",  size: "small", label: "复制 RSS/Atom 地址", attributes: { n: "discovery-source-card-copy-feed" },
          onCopy() { return vm$.methods.copy_url(source.feed_url); } }),
      ]),
      View(
        { class: "box-border flex flex-wrap", style: {
          "gap": "7px"
        }, attributes: { n: "discovery-source-card-actions" } },
        [
          Button({
            class: "box-border flex-none justify-self-center",
            disabled: computed(vm$.state.snapshot_refreshing, ids => source.require_token && !source.cache || ids.includes(source.id)),
            attributes: { n: "discovery-source-refresh-snapshot", type: "button" },
            onClick() { return vm$.methods.refresh_snapshot(source.id); },
          }, [computed(vm$.state.snapshot_refreshing, ids => ids.includes(source.id) ? "生成中…" : "强制刷新快照")]),
          Button(
            {
              class: "box-border flex-none justify-self-center",
              attributes: { n: "discovery-source-edit-button" },
              onClick() {
                vm$.methods.edit_source(source.id);
              },
            },
            ["编辑"],
          ),
          Button(
            {
              class: "box-border flex-none justify-self-center",
              attributes: { n: "discovery-source-toggle-button" },
              onClick() {
                return vm$.methods.toggle_source(source.id);
              },
            },
            [source.enabled ? "停用" : "启用"],
          ),
          Button(
            {
              class: "box-border flex-none",
              attributes: { n: "discovery-source-delete-button" },
              onClick() {
                return vm$.methods.remove_source(source.id);
              },
            },
            ["删除"],
          ),
        ],
      ),
      View({ class: "box-border text-danger whitespace-pre-wrap break-anywhere", attributes: { n: "discovery-source-snapshot-error", role: "alert" } }, [
        computed(vm$.state.snapshot_errors, errors => errors.get(source.id) || ""),
      ]),
    ],
  );
}

function SourceListView({ store }) {
  const vm$ = store;
  return View(
    { class: "box-border min-w-0", attributes: { n: "discovery-source-list-section" } },
    [
      Show({ when: computed(vm$.state.form_open, (open) => !open), ok() {
        return View({ class: "box-border text-success", style: {
          "margin": "6px 0 0",
          "font-size": "12px"
        }, attributes: { n: "discovery-source-list-message", role: "status" } }, [vm$.state.form_message]);
      } }),
      FilterFormView({ store: vm$ }),
      Button({
        class: "box-border flex-none justify-self-center", attributes: { n: "discovery-source-refresh-status-button" },
        onClick() { return vm$.methods.refresh_list(); },
      }, ["刷新列表与快照状态"]),
      Show({
        when: computed(vm$.state.list_error, Boolean),
        ok() {
          return View(
            { class: "box-border text-danger", style: {
              "margin": "12px 0 0"
            }, attributes: { n: "discovery-source-list-error", role: "alert" } },
            [vm$.state.list_error],
          );
        },
      }),
      View({ class: "box-border grid", style: {
        "gap": "14px",
        "margin-top": "16px"
      }, attributes: { n: "discovery-source-list" } }, [
        Show({
          when: vm$.state.loading,
          ok() {
            return View(
              { class: "box-border m-0 rounded-card text-muted text-center", style: {
                "padding": "22px"
              }, attributes: { n: "discovery-source-list-loading" } },
              ["正在加载订阅源…"],
            );
          },
        }),
        Show({
          when: combine(
            { loading: vm$.state.loading, visible: vm$.visible_sources },
            (deps) => !deps.loading && deps.visible.length === 0,
          ),
          ok() {
            return View(
              { class: "box-border m-0 rounded-card text-muted text-center", style: {
                "padding": "22px"
              }, attributes: { n: "discovery-source-list-empty" } },
              ["没有匹配的订阅源。"],
            );
          },
        }),
        For({
          key: "id",
          each: vm$.paged_sources,
          render(source_value_) {
            const source = source_value(source_value_);
            return SourceCardView({ store: vm$, source });
          },
        }),
      ]),
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
          read_context: () => ({ filters: { query: vm$.state.query.value, source_type: vm$.state.filter_platform.value, status: vm$.state.filter_status.value },
            selected_source_id: vm$.state.editing_id.value, form_open: vm$.state.form_open.value,
            ...(vm$.state.form_open.value ? { unsaved_draft: { title: vm$.state.draft_title.value, feed_url: vm$.state.draft_feed_url.value, website: vm$.state.draft_website.value, description: vm$.state.draft_description.value, tags: vm$.state.draft_tags.value, enabled: vm$.state.draft_enabled.value, require_token: vm$.state.draft_require_token.value, sort_order: vm$.state.draft_sort_order.value, source_type: vm$.state.draft_source_type.value } } : {}) }),
          async on_change(event) {
            await vm$.methods.refresh_list();
            if (event.action === "delete" && vm$.state.editing_id.value === event.source_id) vm$.methods.close_form();
          },
        });
      },
      onUnmounted() { detach_agent?.(); },
    },
    [SourceListView({ store: vm$ }), Show({ when: vm$.state.form_open,
      ok() { return SourceFormView({ store: vm$ }); },
    }), Show({ when: vm$.state.import_open, ok: () => SourceImportView({ store: vm$ }) })],
  );
  const page_options = {
    page_id: "discovery",
    eyebrow: "Discovery Operations",
    title: "订阅源管理",
    count: combine({ sources: vm$.state.sources, visible: vm$.visible_sources },
      ({ sources, visible }) => visible.length === sources.length ? String(sources.length) : visible.length + " / " + sources.length),
    actions: [Button({ attributes: { n: "discovery-source-import-button" },
      disabled: combine({ loading: vm$.state.loading, saving: vm$.state.saving }, values => values.loading || values.saving),
      onClick: vm$.methods.open_import }, ["导入 JSON"]),
      Button({class: "box-border",  variant: "secondary", attributes: { n: "discovery-source-export-button", title: "导出所有订阅源，包括停用源，不受分页和筛选影响" },
      disabled: combine({ loading: vm$.state.loading, sources: vm$.state.sources }, ({ loading, sources }) => loading || sources.length === 0),
      onClick: vm$.methods.export_sources }, ["导出 JSON"]), Button({class: "box-border",  attributes: { n: "discovery-source-create-button" },
      disabled: vm$.state.saving, onClick: vm$.methods.create_source }, ["新增订阅源"])],
  };
  return embedded
    ? window.FindRSSAdminShell.Page(page_options, [content])
    : window.FindRSSAdminShell.View(page_options, [content]);
}

function DiscoveryPage() { return DiscoveryApplicationView(true); }

export { DiscoveryPage };
