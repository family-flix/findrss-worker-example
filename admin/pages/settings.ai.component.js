import {
  atomic_classes
} from "../components/frui/atomic.js";
const {
  View,
  For,
  Show,
  computed,
  combine
} = Timeless;

import {
  SettingsPanelSider
} from "../components/frui/settings-panel-sider.js";
import {
  SettingsPanelHeader
} from "../components/frui/settings-panel-header.js";
import {
  Avatar
} from "../components/frui/avatar.js";
import {
  Button
} from "../components/frui/button.js";
import {
  IconButton
} from "../components/frui/icon-button.js";
import {
  Input
} from "../components/frui/input.js";
import {
  Textarea
} from "../components/frui/textarea.js";
import {
  Switch
} from "../components/frui/switch.js";
import {
  Select
} from "../components/frui/select.js";
import {
  FilePicker
} from "../components/frui/file-picker.js";
import {
  Popconfirm
} from "../components/frui/popconfirm.js";
import {
  EmptyCard
} from "../components/illustration-card.js";
import {
  AI_REASONING_EFFORTS,
  AI_BUILTIN_ROLES,
} from "@/domain/preferences/ai_settings.js";
import {
  ai_provider_preset
} from "@/domain/preferences/ai_presets.js";
import {
  AISettingsModel
} from "@/application/reader/ai_settings.js";
import {
  source_value
} from "@/utils.js";
import {
  AIProviderLogo
} from "@/components/ai-provider-logo.js";
import {
  XiaoxunModelSelect
} from "@/components/xiaoxun-model-select.js";

import {
  SettingsActions
} from "./settings.actions.js";
import {
  RoleCallsView
} from "./role-calls.component.js";

function ModelSelect({
  choices,
  value,
  busy,
  choose,
  name = "settings-ai-role-model",
  label = "角色使用的模型"
}) {
  const options = combine({
    choices,
    value
  }, ({
    choices,
    value
  }) => [{
      value: "",
      label: choices.length ? "选择模型" : "没有可用模型，请检查厂商配置",
      disabled: true
    },
    ...(value && !choices.some(choice => choice.value === value) ? [{
      value,
      label: "当前模型不可用，请重新选择",
      disabled: true
    }] : []),
    ...choices.map(choice => ({
      value: choice.value,
      label: `${choice.group} · ${choice.label}`
    })),
  ]);
  return View({
    class: "",
    attributes: {
      n: `${name}-select`
    }
  }, [
    Select({
      value,
      options,
      disabled: combine({
        busy,
        choices
      }, ({
        busy,
        choices
      }) => busy || choices.length === 0),
      attributes: {
        n: `${name}-control`,
        "aria-label": label
      },
      onChange: choose,
    }),
  ]);
}

function AISettingsEditor({
  store,
  app,
  section = "models"
}) {
  const vm = AISettingsModel({
      store
    }),
    {
      state,
      methods
    } = vm;
  const busy = store.state.settings_busy;
  const node = (class_name, name, children, extra = {}) =>
    View({
      class: atomic_classes(class_name),
      attributes: {
        n: name
      },
      ...extra
    }, children);
  const field = (
      label,
      name,
      value,
      update,
      placeholder = "",
      multiline = false,
      type = "text",
    ) =>
    node("flex-1 min-width-0 display-grid gap-space-1", `${name}-field`, [
      View({
          as: "label",
          class: "color-color-text font-size-13-pixels font-weight-600",
          attributes: {
            n: `${name}-label`,
            for: name
          },
          style: {
            ...{
              "--font-size-13-pixels": "13px"
            }
          }
        },
        [label],
      ),
      Show({
        when: multiline,
        ok() {
          return Textarea({
            id: name,
            class: "box-sizing-border-box width-100-percent min-width-0 min-height-control-height border-1-pixels-solid-color-border border-radius-8-pixels padding-0-10-pixels background-color-color-surface color-color-text font-400-font-size-1-4-font-family transition-background-color-motion-fast-border-color-motion-fast-box-shadow-motion-fast placeholder-color-color-placeholder placeholder-opacity-1 aria-invalid-true-frui-control-focus-color-color-danger aria-invalid-true-border-color-color-danger not-disabled-hover-border-color-control-focus-color-color-border-strong focus-border-color-control-focus-color-color-focus focus-visible-border-color-control-focus-color-color-focus focus-outline-none focus-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent focus-visible-outline-none focus-visible-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent disabled-cursor-not-allowed disabled-opacity-6 where-select-appearance-none where-select-padding-inline-end-calc-space-3-16-pixels-space-2 where-select-background-image-linear-gradient-45deg-transparent-50-percent-color-muted-50-percent-linear-gradient-135deg-color-muted-50-percent-transparent-50-percent where-select-background-position-right-17-pixels-center-right-12-pixels-center where-select-background-size-5-pixels-5-pixels where-select-background-repeat-no-repeat where-textarea-padding-block-space-2 media-forced-colors-active-focus-outline-2-pixels-solid-highlight media-forced-colors-active-focus-outline-offset-2-pixels media-prefers-reduced-motion-reduce-transition-none max-width-100-percent min-height-180-pixels",
            value,
            disabled: busy,
            placeholder,
            attributes: {
              n: name,
              "aria-label": label,
              type
            },
            onInput(event) {
              update(event.target.value);
            },
            style: {
              ...{
                "--border-1-pixels-solid-color-border": "1px solid var(--frui-color-border)",
                "--border-radius-8-pixels": "8px",
                "--padding-0-10-pixels": "0 10px",
                "--focus-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent": "0 0 0 3px color-mix(in srgb,var(--frui-control-focus-color, var(--frui-color-focus)) 24%,transparent)",
                "--focus-visible-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent": "0 0 0 3px color-mix(in srgb,var(--frui-control-focus-color, var(--frui-color-focus)) 24%,transparent)",
                "--where-select-padding-inline-end-calc-space-3-16-pixels-space-2": "calc(var(--frui-space-3) + 16px + var(--frui-space-2))",
                "--where-select-background-position-right-17-pixels-center-right-12-pixels-center": "right 17px center,right 12px center",
                "--where-select-background-size-5-pixels-5-pixels": "5px 5px",
                "--media-forced-colors-active-focus-outline-2-pixels-solid-highlight": "2px solid Highlight",
                "--media-forced-colors-active-focus-outline-offset-2-pixels": "2px",
                "--min-height-180-pixels": "180px"
              }
            }
          });
        },
        else() {
          return Input({
            id: name,
            class: "box-sizing-border-box width-100-percent min-width-0 min-height-control-height border-1-pixels-solid-color-border border-radius-8-pixels padding-0-10-pixels background-color-color-surface color-color-text font-400-font-size-1-4-font-family transition-background-color-motion-fast-border-color-motion-fast-box-shadow-motion-fast placeholder-color-color-placeholder placeholder-opacity-1 aria-invalid-true-frui-control-focus-color-color-danger aria-invalid-true-border-color-color-danger not-disabled-hover-border-color-control-focus-color-color-border-strong focus-border-color-control-focus-color-color-focus focus-visible-border-color-control-focus-color-color-focus focus-outline-none focus-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent focus-visible-outline-none focus-visible-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent disabled-cursor-not-allowed disabled-opacity-6 where-select-appearance-none where-select-padding-inline-end-calc-space-3-16-pixels-space-2 where-select-background-image-linear-gradient-45deg-transparent-50-percent-color-muted-50-percent-linear-gradient-135deg-color-muted-50-percent-transparent-50-percent where-select-background-position-right-17-pixels-center-right-12-pixels-center where-select-background-size-5-pixels-5-pixels where-select-background-repeat-no-repeat where-textarea-padding-block-space-2 media-forced-colors-active-focus-outline-2-pixels-solid-highlight media-forced-colors-active-focus-outline-offset-2-pixels media-prefers-reduced-motion-reduce-transition-none max-width-100-percent",
            value,
            disabled: busy,
            placeholder,
            attributes: {
              n: name,
              "aria-label": label,
              type
            },
            onInput(event) {
              update(event.target.value);
            },
            style: {
              ...{
                "--border-1-pixels-solid-color-border": "1px solid var(--frui-color-border)",
                "--border-radius-8-pixels": "8px",
                "--padding-0-10-pixels": "0 10px",
                "--focus-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent": "0 0 0 3px color-mix(in srgb,var(--frui-control-focus-color, var(--frui-color-focus)) 24%,transparent)",
                "--focus-visible-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent": "0 0 0 3px color-mix(in srgb,var(--frui-control-focus-color, var(--frui-color-focus)) 24%,transparent)",
                "--where-select-padding-inline-end-calc-space-3-16-pixels-space-2": "calc(var(--frui-space-3) + 16px + var(--frui-space-2))",
                "--where-select-background-position-right-17-pixels-center-right-12-pixels-center": "right 17px center,right 12px center",
                "--where-select-background-size-5-pixels-5-pixels": "5px 5px",
                "--media-forced-colors-active-focus-outline-2-pixels-solid-highlight": "2px solid Highlight",
                "--media-forced-colors-active-focus-outline-offset-2-pixels": "2px"
              }
            }
          });
        },
      }),
    ]);
  const active = state.active_provider;

  function model_row(raw) {
    const id = source_value(raw).id;
    const model = computed(
      active,
      (provider) => provider.models.find((model) => model.id === id) || {},
    );
    const editing = computed(state.editing_model, (value) => value === id);
    const model_enabled = computed(model, (value) => value.enabled);
    const option = (key, value) => methods.set_model_option(id, key, value);
    return node("border-block-end-1-pixels-solid-color-border", `settings-ai-model-${id}`, [
      node(
        "display-flex align-items-center justify-content-space-between gap-space-3 padding-block-space-3 media-max-width-480-pixels-flex-wrap-wrap",
        `settings-ai-model-row-${id}`, [
          node("display-grid gap-space-1 flex-1 min-width-0 media-max-width-480-pixels-flex-basis-100-percent",
            `settings-ai-model-title-${id}`, [
              node("color-color-text font-size-13-pixels font-weight-600", `settings-ai-model-name-${id}`, [
                computed(model, (value) => value.name || "新模型"),
              ], {
                style: {
                  "--font-size-13-pixels": "13px"
                }
              }),
              node(
                "color-color-muted font-size-12-pixels font-weight-400 line-height-1-6 overflow-wrap-anywhere",
                `settings-ai-model-id-${id}`,
                [computed(model, (value) => value.model || "请填写模型 ID")], {
                  style: {
                    "--font-size-12-pixels": "12px"
                  }
                },
              ),
            ]),
          Button({
            class: "",
            disabled: combine({
                busy,
                entry: state.active_entry
              },
              ({
                busy,
                entry
              }) => busy || !entry.configured,
            ),
            attributes: {
              n: `settings-ai-model-configure-${id}`,
              "aria-label": computed(
                model,
                (value) => `配置模型：${value.name}`,
              ),
              "aria-expanded": editing
            },
            onClick() {
              return methods.configure_model(id);
            }
          }, ["配置"]),
          Switch({
            checked: model_enabled,
            disabled: combine({
                busy,
                entry: state.active_entry
              },
              ({
                busy,
                entry
              }) => busy || !entry.configured,
            ),
            attributes: {
              n: `settings-ai-model-toggle-${id}`,
              "aria-label": "启用模型"
            },
            onChange(enabled) {
              return methods.update_model(id, {
                enabled
              });
            }
          }),
        ]),
      Show({
        when: editing,
        ok() {
          return node(
            "display-grid gap-space-3 padding-block-space-3-space-4",
            `settings-ai-model-details-${id}`,
            [
              field(
                "显示名称",
                `settings-ai-model-name-input-${id}`,
                computed(model, (value) => value.name || ""),
                (name) => methods.update_model(id, {
                  name
                }),
              ),
              field(
                "模型 ID",
                `settings-ai-model-id-input-${id}`,
                computed(model, (value) => value.model || ""),
                (model) => methods.update_model(id, {
                  model
                }),
                "厂商提供的模型 ID",
              ),
              node("color-color-text font-size-13-pixels font-weight-600", `settings-ai-reasoning-label-${id}`, [
                "推理深度",
              ], {
                style: {
                  "--font-size-13-pixels": "13px"
                }
              }),
              Select({
                value: computed(model, value => value.options?.reasoning_effort || ""),
                options: AI_REASONING_EFFORTS.map(value => ({
                  value,
                  label: value || "模型默认"
                })),
                disabled: busy,
                attributes: {
                  n: `settings-ai-reasoning-${id}`,
                  "aria-label": "推理深度"
                },
                onChange(value) {
                  return option("reasoning_effort", value);
                },
              }),
              node(
                "display-grid grid-template-columns-repeat-2-minmax-0-1fr gap-space-3 media-max-width-480-pixels-grid-template-columns-minmax-0-1fr",
                `settings-ai-parameters-${id}`,
                [
                  field(
                    "温度",
                    `settings-ai-temperature-${id}`,
                    computed(model, (value) =>
                      String(value.options?.temperature ?? ""),
                    ),
                    (value) => option("temperature", value),
                    "模型默认",
                    false,
                    "number",
                  ),
                  field(
                    "输出 Token 上限",
                    `settings-ai-max-tokens-${id}`,
                    computed(model, (value) =>
                      String(value.options?.max_tokens ?? ""),
                    ),
                    (value) => option("max_tokens", value),
                    "模型默认",
                    false,
                    "number",
                  ),
                ],
              ),
              node("color-color-muted font-size-12-pixels font-weight-400 line-height-1-6", `settings-ai-parameter-hint-${id}`, [
                "留空使用模型默认值，参数支持范围以厂商为准。",
              ], {
                style: {
                  "--font-size-12-pixels": "12px"
                }
              }),
              Popconfirm({
                title: "确认删除这个模型？",
                disabled: busy,
                attributes: {
                  n: `settings-ai-model-delete-${id}-confirmation`
                },
                onConfirm: () => methods.remove_model(id),
                trigger: props => Button({
                  ...props,
                  class: "",
                  disabled: busy,
                  attributes: {
                    ...props.attributes,
                    n: `settings-ai-model-delete-${id}`,
                    "aria-label": "删除模型"
                  },
                }, ["删除模型"]),
              }),
            ],
          );
        },
      }),
    ], {
      style: {
        "--border-block-end-1-pixels-solid-color-border": "1px solid var(--frui-color-border)"
      }
    });
  }

  function provider_panel() {
    return node("display-grid gap-space-4", "settings-ai-provider", [
      SettingsPanelHeader({
        title: node("display-flex align-items-center gap-space-2 min-width-0", "settings-ai-provider-title", [
          AIProviderLogo({
            provider: active,
            attributes: {
              n: "settings-ai-provider-logo"
            }
          }),
          View({
            as: "span",
            attributes: {
              n: "settings-ai-provider-title-text"
            }
          }, [computed(active, value => value.name)]),
        ]),
        attributes: {
          n: "settings-ai-provider-heading"
        },
        title_attributes: {
          n: "settings-ai-provider-name"
        }
      }),
      node("color-color-muted font-size-12-pixels font-weight-400 line-height-1-6", "settings-ai-provider-note", [
        computed(
          active,
          (value) =>
          ai_provider_preset(value.preset_id)?.note ||
          "连接自定义 OpenAI 兼容服务。",
        ),
      ], {
        style: {
          "--font-size-12-pixels": "12px"
        }
      }),
      node("display-grid gap-space-2 padding-space-4 background-color-surface border-radius-radius-control",
        "settings-ai-provider-credentials", [
          Show({
            when: computed(active, (value) => value.type === "openai_compat"),
            ok() {
              return node("", "settings-ai-key-config", [
                field(
                  "API Key",
                  "settings-ai-api-key",
                  state.key_value,
                  methods.set_api_key,
                  "填写该厂商的 API Key",
                  false,
                  "password",
                ),
                node("color-color-muted font-size-12-pixels font-weight-400 line-height-1-6", "settings-ai-key-status", [
                  state.key_status,
                ], {
                  style: {
                    "--font-size-12-pixels": "12px"
                  }
                }),
                Show({
                  when: computed(
                    active,
                    (value) => value.api_key_source === "account",
                  ),
                  ok() {
                    return Popconfirm({
                      title: "确认删除已保存的 API Key？保存设置后生效。",
                      disabled: busy,
                      attributes: {
                        n: "settings-ai-key-clear-confirmation"
                      },
                      onConfirm: () => methods.set_api_key(null),
                      trigger: props => Button({
                        ...props,
                        class: "",
                        disabled: busy,
                        attributes: {
                          ...props.attributes,
                          n: "settings-ai-key-clear",
                          "aria-label": "删除已保存的 API Key"
                        },
                      }, ["删除已保存的 API Key"]),
                    });
                  },
                }),
              ]);
            },
          }),
          node("flex-1 min-width-0 display-grid gap-space-1", "settings-ai-test-model-field", [
            node("color-color-text font-size-13-pixels font-weight-600", "settings-ai-test-model-label", ["测试模型"], {
              style: {
                "--font-size-13-pixels": "13px"
              }
            }),
            ModelSelect({
              choices: state.test_choices,
              value: state.test_model_value,
              busy: computed(state.test_state, (value) => value.busy),
              choose: methods.select_test_model,
              name: "settings-ai-test-model",
              label: "连接测试使用的模型",
            }),
          ]),
          Button({
            class: "",
            disabled: combine({
                busy,
                test: state.test_state,
                choices: state.test_choices
              },
              ({
                busy,
                test,
                choices
              }) => busy || test.busy || !choices.length,
            ),
            attributes: {
              n: "settings-ai-test-button",
              "aria-label": "测试连接"
            },
            onClick() {
              return methods.test_connection();
            }
          }, [computed(state.test_state, (value) =>
            value.busy ? "正在测试…" : "测试连接",
          )]),
          node(
            "success-message",
            "settings-ai-test-success",
            [computed(state.test_state, (value) => value.message)], {
              attributes: {
                n: "settings-ai-test-success",
                role: "status"
              }
            },
          ),
          node(
            "",
            "settings-ai-test-error",
            [computed(state.test_state, (value) => value.error)], {
              attributes: {
                n: "settings-ai-test-error",
                role: "alert"
              }
            },
          ),
          node("color-color-muted font-size-12-pixels font-weight-400 line-height-1-6", "settings-ai-test-hint", [
            "测试使用当前填写的配置发起一次小请求；修改后请保存。",
          ], {
            style: {
              "--font-size-12-pixels": "12px"
            }
          }),
        ]),
      Show({
        when: computed(state.active_entry, (value) => value.configured),
        ok() {
          return node(
            "display-grid gap-space-3",
            "settings-ai-connection-actions",
            [
              Button({
                class: "",
                disabled: busy,
                attributes: {
                  n: "settings-ai-provider-advanced-toggle",
                  "aria-label": "高级设置",
                  "aria-expanded": state.provider_advanced
                },
                onClick() {
                  return methods.toggle_advanced();
                }
              }, ["高级设置"]),
              Show({
                when: state.provider_advanced,
                ok() {
                  return node(
                    "display-grid gap-space-3",
                    "settings-ai-provider-advanced",
                    [
                      field(
                        "厂商名称",
                        "settings-ai-provider-name-input",
                        computed(active, (value) => value.name || ""),
                        (name) => methods.update_provider({
                          name
                        }),
                      ),
                      Show({
                        when: computed(active, (value) => !value.preset_id),
                        ok() {
                          return Select({
                            value: computed(active, value => value.type),
                            options: [{
                              value: "workers_ai",
                              label: "Workers AI"
                            }, {
                              value: "openai_compat",
                              label: "OpenAI 兼容"
                            }],
                            disabled: busy,
                            attributes: {
                              n: "settings-ai-provider-type",
                              "aria-label": "厂商类型"
                            },
                            onChange(type) {
                              return methods.update_provider({
                                type
                              });
                            },
                          });
                        },
                      }),
                      Show({
                        when: computed(
                          active,
                          (value) => value.type === "openai_compat",
                        ),
                        ok() {
                          return node(
                            "display-grid gap-space-3",
                            "settings-ai-endpoint",
                            [
                              field(
                                "接口地址",
                                "settings-ai-base-url",
                                computed(
                                  active,
                                  (value) => value.base_url || "",
                                ),
                                (base_url) =>
                                methods.update_provider({
                                  base_url
                                }),
                                "https://api.example.com/v1",
                              ),
                              field(
                                "部署密钥名",
                                "settings-ai-secret-name",
                                computed(
                                  active,
                                  (value) => value.api_key_secret_name || "",
                                ),
                                (api_key_secret_name) =>
                                methods.update_provider({
                                  api_key_secret_name,
                                }),
                                "READER_AI_API_KEY",
                              ),
                              node("color-color-muted font-size-12-pixels font-weight-400 line-height-1-6",
                                "settings-ai-secret-hint", [
                                  "填写 Worker 环境中的 READER_AI_ 密钥名，接口地址后自动拼接 /chat/completions。",
                                ], {
                                  style: {
                                    "--font-size-12-pixels": "12px"
                                  }
                                }),
                            ],
                          );
                        },
                      }),
                    ],
                  );
                },
              }),
            ],
          );
        },
      }),
      SettingsPanelHeader({
        title: "模型列表",
        attributes: {
          n: "settings-ai-model-heading"
        },
        title_attributes: {
          n: "settings-ai-model-list-label"
        },
        actions: [
          Show({
            when: computed(state.active_entry, (value) => value.configured),
            ok() {
              return Button({
                class: "",
                disabled: busy,
                attributes: {
                  n: "settings-ai-model-add",
                  "aria-label": "添加自定义模型"
                },
                onClick() {
                  return methods.add_model();
                }
              }, ["添加自定义模型"]);
            },
          }),
        ]
      }),
      field(
        "搜索模型",
        "settings-ai-model-search",
        state.model_query,
        methods.search_models,
        "按名称或模型 ID 搜索",
        false,
        "search",
      ),
      node("border-block-start-1-pixels-solid-color-border", "settings-ai-model-list", [
        For({
          each: state.visible_models,
          key: "id",
          render: model_row
        }),
      ], {
        style: {
          "--border-block-start-1-pixels-solid-color-border": "1px solid var(--frui-color-border)"
        }
      }),
      Show({
        when: computed(state.visible_models, (value) => value.length === 0),
        ok() {
          return EmptyCard({
            name: "settings-ai-model-empty",
            variant: "inline",
            title: "暂无模型",
            description: "调整搜索或添加自定义模型。"
          });
        },
      }),
    ]);
  }

  function role_panel() {
    const role = state.active_role;
    const selected = computed(role, (value) =>
      value ? JSON.stringify([value.provider_id, value.model_id]) : "",
    );
    let model_picker_unlisten = [];
    const model_picker = {
      dialogue() {
        const current = selected.value ? JSON.parse(selected.value) : [];
        return {
          models: state.model_choices.value.map(choice => ({
            key: `${choice.provider_id}/${choice.model_id}`,
            provider_id: choice.provider_id,
            model_id: choice.model_id,
            name: choice.label,
            provider_name: choice.group,
            provider_logo: choice.provider_logo,
            enabled: true,
          })),
          model_key: current.length === 2 ? `${current[0]}/${current[1]}` : "",
          busy: Boolean(busy.value),
        };
      },
      subscribe(listener) {
        const notify = () => listener(this.dialogue());
        model_picker_unlisten = [state.model_choices, selected, busy]
          .map(source => source.subscribe?.({
            onChange: notify
          }))
          .filter(Boolean);
        return () => {
          model_picker_unlisten.forEach(unlisten => unlisten());
          model_picker_unlisten = [];
        };
      },
      dispose() {
        model_picker_unlisten.forEach(unlisten => unlisten());
        model_picker_unlisten = [];
      },
      select_model(key) {
        const choice = state.model_choices.value.find(item => `${item.provider_id}/${item.model_id}` === key);
        if (choice) methods.choose_role_model(choice.value);
      },
    };
    return node("display-grid gap-space-4", "settings-ai-role", [
      SettingsPanelHeader({
        title: computed(role, value => value?.name || "角色"),
        attributes: {
          n: "settings-ai-role-heading"
        },
        title_attributes: {
          n: "settings-ai-role-name"
        }
      }),
      node("color-color-muted font-size-12-pixels font-weight-400 line-height-1-6", "settings-ai-role-description", [
        computed(role, (value) =>
          AI_BUILTIN_ROLES.some((builtin) => builtin.id === value?.id) ?
          "内置角色，可调整模型和提示词。" :
          "自定义问答角色，可在阅读文章时使用。",
        ),
      ], {
        style: {
          "--font-size-12-pixels": "12px"
        }
      }),
      node("flex-1 min-width-0 display-grid gap-space-1 justify-items-start", "settings-ai-role-icon-field", [
        node("color-color-text font-size-13-pixels font-weight-600", "settings-ai-role-icon-label", ["图标"], {
          style: {
            "--font-size-13-pixels": "13px"
          }
        }),
        FilePicker({
          accept: "image/png,image/jpeg,image/webp,image/gif",
          loading: busy,
          class: "width-fit-content",
          tip: "选择或拖拽图片以更换图标",
          attributes: {
            n: "settings-ai-role-icon-file",
            "aria-label": "上传角色图标（PNG、JPEG、WebP、GIF，最大 2 MB）",
            title: "点击或拖拽图片以更换图标"
          },
          onChange: files => methods.set_role_icon_file(files[0]),
        }, [Avatar({
          class: "width-64-pixels height-64-pixels",
          shape: "square",
          name: computed(role, value => value?.name || "角色"),
          src: combine({
            entries: state.role_entries,
            role
          }, ({
            entries,
            role
          }) => entries.find(entry => entry.id === role?.id)?.avatar_src || ""),
          attributes: {
            n: "settings-ai-role-icon-image",
            "aria-label": "角色图标"
          },
          style: {
            ...{
              "--width-64-pixels": "64px",
              "--height-64-pixels": "64px"
            }
          }
        })]),
      ]),
      field(
        "角色名称",
        "settings-ai-role-name-input",
        computed(role, (value) => value?.name || ""),
        (name) => methods.update_role({
          name
        }),
      ),
      node("flex-1 min-width-0 display-grid gap-space-1", "settings-ai-role-model-field", [
        node("color-color-text font-size-13-pixels font-weight-600", "settings-ai-role-model-label", ["使用模型"], {
          style: {
            "--font-size-13-pixels": "13px"
          }
        }),
        View({
          class: "",
          attributes: {
            n: "settings-ai-role-model-select"
          }
        }, [
          XiaoxunModelSelect({
            pet: model_picker,
            label: "角色使用的模型",
            list_label: "角色可用模型"
          }),
        ]),
        node("color-color-muted font-size-12-pixels font-weight-400 line-height-1-6", "settings-ai-role-model-hint", [
          "按厂商分组，只显示已启用的模型。",
        ], {
          style: {
            "--font-size-12-pixels": "12px"
          }
        }),
      ]),
      field(
        "角色提示词",
        "settings-ai-role-prompt",
        computed(role, (value) => value?.prompt || ""),
        (prompt) => methods.update_role({
          prompt
        }),
        "描述任务、语言与输出格式",
        true,
      ),
      node("color-color-muted font-size-12-pixels font-weight-400 line-height-1-6", "settings-ai-role-prompt-variables", [
        "支持 {{date.today}}（UTC 日期）和 {{articles.today.metadata}}（当前账号当天首次抓到、仍保留的全部文章元数据 JSON）。定时日报使用汇总日期；未知变量或填充后超过 28 KiB 会报错，不截断文章。",
      ], {
        style: {
          "--font-size-12-pixels": "12px"
        }
      }),
      ...(app ? [RoleCallsView({
        app,
        role
      })] : []),
    ]);
  }

  return node(
    "display-grid gap-space-4 grid-template-columns-180-pixels-minmax-0-1fr gap-space-3 min-width-0 min-height-0 overflow-hidden media-max-width-960-pixels-grid-template-columns-minmax-0-1fr media-max-width-960-pixels-grid-template-rows-auto-minmax-0-1fr",
    "settings-ai-editor",
    [
      SettingsPanelSider({
          class: "min-height-0 overflow-y-auto overscroll-behavior-contain media-max-width-960-pixels-border-inline-end-0 media-max-width-960-pixels-padding-inline-end-space-1 media-max-width-960-pixels-border-block-end-1-pixels-solid-color-border media-max-width-960-pixels-padding-block-end-space-2 media-max-width-960-pixels-padding-block-end-0",
          attributes: {
            n: "settings-ai-navigation",
            "aria-label": section === "models" ? "模型厂商" : "角色"
          },
          style: {
            ...{
              "--media-max-width-960-pixels-border-block-end-1-pixels-solid-color-border": "1px solid var(--frui-color-border)"
            }
          }
        },
        [Show({
          when: section === "models",
          ok() {
            return [
              node("display-flex align-items-flex-end gap-space-2 min-width-0", "settings-ai-provider-actions", [
                Input({
                  type: "search",
                  value: state.provider_query,
                  placeholder: "搜索厂商",
                  disabled: busy,
                  attributes: {
                    n: "settings-ai-provider-search",
                    "aria-label": "搜索厂商"
                  },
                  onChange: methods.search_providers,
                }),
                Button({
                  class: "flex-none width-control-height padding-0",
                  disabled: busy,
                  attributes: {
                    n: "settings-ai-provider-add",
                    "aria-label": "添加自定义厂商",
                    title: "添加自定义厂商"
                  },
                  onClick: methods.add_provider,
                }, [Timeless.Icon({
                  name: "plus",
                  size: 16
                })]),
              ]),
              node(
                "display-grid grid-template-columns-minmax-0-1fr gap-space-2 media-max-width-960-pixels-display-flex media-max-width-960-pixels-overflow-x-auto media-max-width-960-pixels-padding-space-1 media-max-width-960-pixels-margin-inline-calc-negative-1-space-1",
                "settings-ai-provider-navigation",
                [
                  For({
                    each: state.visible_providers,
                    key: "id",
                    render(raw) {
                      const entry = source_value(raw);
                      const current = computed(
                        state.provider_entries,
                        (entries) =>
                        entries.find((value) => value.id === entry.id) ||
                        entry,
                      );
                      return node(computed(state.active_entry, active =>
                        `display-flex flex-direction-column align-items-flex-start gap-space-1 min-width-0 padding-space-1-space-2 border-radius-radius-control color-color-muted cursor-pointer hover-background-color-surface hover-color-color-text media-max-width-960-pixels-flex-shrink-0 media-max-width-960-pixels-width-min-180-pixels-100-percent media-max-width-960-pixels-box-sizing-border-box${active.id === entry.id ? " background-color-selected color-color-link" : ""}`
                        ), `settings-ai-nav-card-${entry.id}`, [Button({
                          class: "display-flex justify-content-flex-start align-items-flex-start gap-space-2 min-height-control-height padding-space-1-space-2 font-size-font-size-sm border-0 border-radius-radius-control background-transparent color-color-muted text-align-start cursor-pointer flex-direction-column gap-space-1 hover-background-color-surface hover-color-color-text focus-visible-outline-2-pixels-solid-color-focus focus-visible-outline-offset-2-pixels width-100-percent min-width-0 min-height-0 height-auto padding-0 color-inherit disabled-cursor-default disabled-color-color-muted focus-visible-outline-2-pixels-solid-color-primary media-max-width-960-pixels-flex-shrink-0 media-max-width-960-pixels-max-width-220-pixels",
                          contentProps: {
                            class: "display-flex flex-direction-column align-items-flex-start gap-space-1 width-100-percent min-width-0"
                          },
                          disabled: busy,
                          attributes: {
                            n: `settings-ai-nav-${entry.id}`,
                            "aria-current": computed(
                              state.active_entry,
                              (active) =>
                              active.id === entry.id ? "true" : undefined,
                            ),
                          },
                          style: {
                            ...{
                              "--focus-visible-outline-2-pixels-solid-color-focus": "2px solid var(--frui-color-focus)",
                              "--focus-visible-outline-offset-2-pixels": "2px",
                              "--focus-visible-outline-2-pixels-solid-color-primary": "2px solid var(--frui-color-primary)",
                              "--media-max-width-960-pixels-max-width-220-pixels": "220px"
                            }
                          }
                        },
                        [
                          node(
                            "font-size-font-size-sm overflow-wrap-anywhere display-flex align-items-center gap-space-2 min-width-0 max-width-100-percent",
                            `settings-ai-nav-name-${entry.id}`,
                            [AIProviderLogo({
                                provider: current,
                                attributes: {
                                  n: `settings-ai-nav-logo-${entry.id}`
                                }
                              }),
                              View({
                                as: "span",
                                attributes: {
                                  n: `settings-ai-nav-label-${entry.id}`
                                }
                              }, [computed(current, (value) => value.name)])
                            ],
                          ),
                          node(
                            "font-size-font-size-sm color-color-muted font-weight-400 overflow-wrap-anywhere max-width-100-percent",
                            `settings-ai-nav-status-${entry.id}`,
                            [
                              computed(current, (value) =>
                                !value.enabled ?
                                "已停用" :
                                value.provider?.type === "workers_ai" ?
                                "Workers AI 绑定" :
                                value.provider?.api_key_configured ?
                                "已配置 API Key" :
                                "待配置 API Key",
                              ),
                            ],
                          ),
                        ],
                      ), node("display-flex flex-wrap-wrap gap-space-2 align-items-center width-100-percent",
                        `settings-ai-nav-actions-${entry.id}`, [Switch({
                          size: "small",
                          checked: computed(current, value => value.enabled),
                          disabled: busy,
                          attributes: {
                            n: `settings-ai-nav-toggle-${entry.id}`,
                            "aria-label": computed(current, value => `启用 ${value.name}`)
                          },
                          onChange: enabled => methods.set_provider_enabled(entry.id, enabled),
                        }), Popconfirm({
                          title: "确认删除这个厂商及其模型？保存设置后生效。",
                          disabled: combine({
                            busy,
                            current
                          }, ({
                            busy,
                            current
                          }) => busy || !current.deletable),
                          attributes: {
                            n: `settings-ai-nav-delete-${entry.id}-confirmation`
                          },
                          onConfirm: () => methods.remove_provider(entry.id),
                          trigger: props => IconButton({
                            ...props,
                            icon: "trash",
                            size: "small",
                            label: computed(current, value => `删除 ${value.name}`),
                            disabled: combine({
                              busy,
                              current
                            }, ({
                              busy,
                              current
                            }) => busy || !current.deletable),
                            attributes: {
                              ...props.attributes,
                              n: `settings-ai-nav-delete-${entry.id}`,
                              "aria-label": computed(current, value => `删除 ${value.name}`),
                              title: computed(current, value => value.deletable ? "删除厂商" : "内置厂商无法删除")
                            },
                          }),
                        })], {
                          onClick(event) {
                            if (event.target.closest('[role="switch"], button')) event.stopPropagation();
                          }
                        })], {
                        onClick() {
                          if (!busy.value) methods.select_provider(entry.id);
                        },
                        style: {
                          ...{
                            "--media-max-width-960-pixels-width-min-180-pixels-100-percent": "min(180px,100%)"
                          }
                        }
                      });
                    },
                  }),
                ],
              ),
              Show({
                when: computed(state.visible_providers, values => values.length === 0),
                ok: () => EmptyCard({
                  name: "settings-ai-provider-empty",
                  variant: "inline",
                  title: "暂无厂商",
                  description: "调整搜索或添加自定义厂商。"
                }),
              }),

            ];
          },
          else() {
            return [
              node("display-flex align-items-flex-end gap-space-2 min-width-0", "settings-ai-role-search-actions", [
                Input({
                  type: "search",
                  value: state.role_query,
                  placeholder: "搜索角色",
                  disabled: busy,
                  attributes: {
                    n: "settings-ai-role-search",
                    "aria-label": "搜索角色"
                  },
                  onChange: methods.search_roles
                }),
                Button({
                  class: "flex-none width-control-height padding-0",
                  disabled: busy,
                  attributes: {
                    n: "settings-ai-role-add",
                    "aria-label": "添加角色",
                    title: "添加角色"
                  },
                  onClick: methods.add_role,
                }, [Timeless.Icon({
                  name: "plus",
                  size: 16
                })]),
              ]),
              node(
                "display-grid grid-template-columns-minmax-0-1fr gap-space-2 media-max-width-960-pixels-display-flex media-max-width-960-pixels-overflow-x-auto media-max-width-960-pixels-padding-space-1 media-max-width-960-pixels-margin-inline-calc-negative-1-space-1",
                "settings-ai-role-navigation",
                [
                  For({
                    each: state.visible_roles,
                    key: "id",
                    render(raw) {
                      const id = source_value(raw).id;
                      const role = computed(
                        state.roles,
                        (values) => values.find((role) => role.id === id) || {},
                      );
                      const entry = computed(state.role_entries, values => values.find(value => value.id === id) || {});
                      return node(computed(state.active_role, value =>
                          "display-flex flex-direction-column align-items-flex-start gap-space-1 min-width-0 padding-space-1-space-2 border-radius-radius-control color-color-muted cursor-pointer hover-background-color-surface hover-color-color-text media-max-width-960-pixels-flex-shrink-0 media-max-width-960-pixels-width-min-180-pixels-100-percent media-max-width-960-pixels-box-sizing-border-box" +
                          (value?.id === id ? " background-color-selected color-color-link" : "")),
                        `settings-ai-role-nav-row-${id}`, [Button({
                            class: "display-flex justify-content-flex-start align-items-flex-start gap-space-2 min-height-control-height padding-space-1-space-2 font-size-font-size-sm border-0 border-radius-radius-control background-transparent color-color-muted text-align-start cursor-pointer flex-direction-column gap-space-1 hover-background-color-surface hover-color-color-text focus-visible-outline-2-pixels-solid-color-focus focus-visible-outline-offset-2-pixels width-100-percent min-width-0 min-height-0 height-auto padding-0 color-inherit disabled-cursor-default disabled-color-color-muted focus-visible-outline-2-pixels-solid-color-primary media-max-width-960-pixels-flex-shrink-0 media-max-width-960-pixels-max-width-220-pixels",
                            contentProps: {
                              class: "display-flex flex-direction-column align-items-flex-start gap-space-1 width-100-percent min-width-0"
                            },
                            disabled: busy,
                            attributes: {
                              n: `settings-ai-role-nav-${id}`,
                              "aria-current": computed(
                                state.active_role,
                                (value) =>
                                value?.id === id ? "true" : undefined,
                              ),
                            },
                            style: {
                              ...{
                                "--focus-visible-outline-2-pixels-solid-color-focus": "2px solid var(--frui-color-focus)",
                                "--focus-visible-outline-offset-2-pixels": "2px",
                                "--focus-visible-outline-2-pixels-solid-color-primary": "2px solid var(--frui-color-primary)",
                                "--media-max-width-960-pixels-max-width-220-pixels": "220px"
                              }
                            }
                          },
                          [
                            node(
                              "font-size-font-size-sm overflow-wrap-anywhere display-flex align-items-center gap-space-2 min-width-0 max-width-100-percent",
                              `settings-ai-role-nav-title-${id}`, [
                                Avatar({
                                  src: computed(entry, value => value.avatar_src),
                                  name: source_value(role).name,
                                  shape: "square",
                                  class: "width-space-5 height-space-5",
                                  attributes: {
                                    n: `settings-ai-role-avatar-${id}`,
                                    "aria-hidden": "true"
                                  },
                                }),
                                View({
                                  as: "span",
                                  attributes: {
                                    n: `settings-ai-role-nav-name-${id}`
                                  }
                                }, [computed(role, value => value.name)]),
                              ]),
                            node(
                              "font-size-font-size-sm color-color-muted font-weight-400 overflow-wrap-anywhere max-width-100-percent display-flex align-items-center gap-space-1 min-width-0 font-size-font-size-xs",
                              `settings-ai-role-nav-model-${id}`, [
                                Show({
                                  when: computed(entry, value => Boolean(value.provider_logo)),
                                  ok: () => AIProviderLogo({
                                    logo: computed(entry, value => value.provider_logo || {}),
                                    attributes: {
                                      n: `settings-ai-role-nav-provider-logo-${id}`
                                    },
                                  })
                                }),
                                node("min-width-0 overflow-wrap-anywhere white-space-normal",
                                  `settings-ai-role-nav-model-name-${id}`, [computed(entry, value => value.model_label)]),
                              ], {
                                attributes: {
                                  n: `settings-ai-role-nav-model-${id}`,
                                  title: computed(entry, value => value.model_title)
                                }
                              }),
                          ],
                        ), node("display-flex flex-wrap-wrap gap-space-2 align-items-center width-100-percent",
                          `settings-ai-role-nav-actions-${id}`, [Switch({
                            size: "small",
                            checked: computed(role, value => Boolean(value.enabled)),
                            disabled: busy,
                            attributes: {
                              n: `settings-ai-role-nav-status-${id}`,
                              "aria-label": computed(role, value => `启用 ${value.name || id}`)
                            },
                            onChange: enabled => methods.set_role_enabled(id, enabled),
                          }), Popconfirm({
                            title: "确认删除这个角色？保存设置后生效。",
                            disabled: combine({
                              busy,
                              entry
                            }, ({
                              busy,
                              entry
                            }) => busy || !entry.deletable),
                            attributes: {
                              n: `settings-ai-role-nav-delete-${id}-confirmation`
                            },
                            onConfirm: () => methods.remove_role(id),
                            trigger: props => IconButton({
                              ...props,
                              icon: "trash",
                              size: "small",
                              label: computed(role, value => `删除 ${value.name || id}`),
                              disabled: combine({
                                busy,
                                entry
                              }, ({
                                busy,
                                entry
                              }) => busy || !entry.deletable),
                              attributes: {
                                ...props.attributes,
                                n: `settings-ai-role-nav-delete-${id}`,
                                "aria-label": computed(role, value => `删除 ${value.name || id}`),
                                title: computed(entry, value => value.deletable ? "删除角色" : "内置角色无法删除")
                              },
                            }),
                          })], {
                            onClick(event) {
                              if (event.target.closest('[role="switch"], button')) event.stopPropagation();
                            }
                          })], {
                          onClick() {
                            if (!busy.value) methods.select_role(id);
                          },
                          style: {
                            ...{
                              "--media-max-width-960-pixels-width-min-180-pixels-100-percent": "min(180px,100%)"
                            }
                          }
                        });
                    },
                  }),
                ],
              ),

              Show({
                when: computed(state.visible_roles, roles => roles.length === 0),
                ok: () => EmptyCard({
                  name: "settings-ai-role-empty",
                  variant: "inline",
                  title: "暂无角色",
                  description: "调整搜索或添加角色。"
                }),
              }),
            ];
          },
        })],
      ),
      Show({
        when: section === "models",
        ok() {
          return node("min-height-0 overflow-y-auto overscroll-behavior-contain min-width-0", "settings-ai-detail", [
            For({
              each: computed(state.active_provider, (value) => [value]),
              key: "id",
              render: provider_panel,
            }),
          ]);
        },
        else() {
          return node("min-height-0 overflow-y-auto overscroll-behavior-contain min-width-0", "settings-ai-detail", [
            For({
              each: computed(state.active_role, (value) =>
                value ? [value] : [],
              ),
              key: "id",
              render: role_panel,
            }),
          ]);
        },
      }),
    ], {
      onUnmounted() {
        vm.destroy();
      },
      style: {
        ...{
          "--grid-template-columns-180-pixels-minmax-0-1fr": "180px minmax(0,1fr)"
        }
      }
    },
  );
}

function AIPreferencesView({
  store,
  style
}) {
  return View({
      class: "width-100-percent min-width-0 display-grid gap-space-4 height-100-percent min-height-0 grid-template-rows-minmax-0-1fr-auto",
      style,
      attributes: {
        n: "settings-ai-form"
      },
    },
    [
      AISettingsEditor({
        store,
        section: "models"
      }),
      SettingsActions({
        store,
        section: "ai"
      }),
    ],
  );
}

export {
  AIPreferencesView,
  AISettingsEditor
};
