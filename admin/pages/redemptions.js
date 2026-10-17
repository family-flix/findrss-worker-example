import { format_datetime } from "../../server/lib/datetime.js";
import { PaginationView } from "../components/pagination.js";
import { RedemptionCardsViewModel } from "./redemptions.model.js";

const Timeless = window.FindRSSAdminUI;

if (!Timeless || !Timeless.DOM || !window.FindRSSAdminAuth || !window.FindRSSAdminShell) {
  throw new Error("兑换卡管理页无法启动：管理运行时未加载");
}
const { Button, For, Input, Popconfirm, Show, Textarea, View, computed } = Timeless;

function source_value(value) {
  return value && value.__is_ref ? value.value : value;
}

function format_time(value) {
  return value ? format_datetime(value) : "不限";
}

function campaign_status_label(status) {
  return ({
    active: "进行中",
    paused: "已停用",
    scheduled: "未开始",
    expired: "已过期",
    exhausted: "已兑完",
  })[status] || "未知";
}

function CampaignRowView({ store, campaign }) {
  const vm$ = store;
  const selected_ = computed(vm$.state.selected_campaign_id, (id) => id === campaign.id);

  return View({ class: computed(selected_, active => "box-border " + ("grid items-center rounded-card max-760-grid-template-columns " + (active ? "bg-selected border-color-border-strong" : "bg-surface-raised"))), style: {
    "grid-template-columns": "minmax(0,1fr) auto",
    "gap": "12px",
    "padding": "10px 12px",
    "border": "1px solid var(--frui-color-border)",
    "--max-760-grid-template-columns": "1fr"
  }, attributes: { n: "redemption-campaign-row" } }, [
    Button(
      {
        class: "box-border grid min-w-0 justify-items-start text-left flex-none", style: {
          "gap": "4px"
        },
        attributes: { n: "redemption-campaign-select-" + campaign.id },
        onClick() {
          return vm$.methods.loadCampaign(campaign.id);
        },
      },
      [
        View({ class: "box-border overflow-hidden max-w-full text-muted text-ellipsis whitespace-nowrap", style: {
          "font-size": "13px",
          "font-weight": "680"
        }, attributes: { n: "redemption-campaign-name" } }, [campaign.name]),
        View({ class: "box-border text-muted", style: {
          "font-size": "11px",
          "line-height": "1.5"
        }, attributes: { n: "redemption-campaign-summary" } }, [
          "默认 " + campaign.credits + " 积分/张 · " + campaign.redeemed_count + "/" + campaign.card_count + " 已兑",
        ]),
        View({ class: "box-border text-muted", style: {
          "font-size": "11px",
          "line-height": "1.5"
        }, attributes: { n: "redemption-campaign-dates" } }, [
          "有效期：" + (campaign.starts_at ? format_time(campaign.starts_at) : "立即") + " — " + format_time(campaign.expires_at),
        ]),
      ],
    ),
    View(
      { class: "box-border flex flex-wrap items-center justify-end max-760-justify-content", style: {
        "gap": "9px",
        "--max-760-justify-content": "space-between"
      }, attributes: { n: "redemption-campaign-actions" } },
      [
        View({ class: "box-border " + ("rounded-pill whitespace-nowrap " + (["paused", "expired", "exhausted"].includes(campaign.status) ? "bg-danger-bg text-danger" : campaign.status === "scheduled" ? "bg-warning-bg text-warning" : "bg-success-bg text-success")), style: {
          "padding": "5px 8px",
          "font-size": "10px"
        }, attributes: { n: "redemption-campaign-status" } }, [
          campaign_status_label(campaign.status),
        ]),
        Button(
          {
            class: "box-border flex-none justify-self-center", style: {
              "min-height": "40px",
              "font-size": "11px",
              "padding": "7px 10px"
            },
            attributes: { n: "redemption-campaign-toggle-" + campaign.id },
            disabled: computed(vm$.state.busy, (busy) => busy || undefined),
            onClick() {
              return vm$.methods.setCampaignActive(campaign);
            },
          },
          [campaign.active ? "停用活动" : "启用活动"],
        ),
      ],
    ),
  ]);
}

function CardRowView({ store, card }) {
  const status_text = ({ available: "可兑换", redeemed: "已兑换", revoked: "已停用" })[card.status] || "未知";
  return View({ class: "box-border grid items-center rounded-card bg-surface-raised max-760-grid-template-columns", style: {
    "grid-template-columns": "minmax(130px,.7fr) 72px 90px minmax(160px,1.2fr) auto",
    "gap": "12px",
    "padding": "10px 12px",
    "border": "1px solid var(--frui-color-border)",
    "--max-760-grid-template-columns": "minmax(0,1fr) auto auto"
  }, attributes: { n: "redemption-card-row" } }, [
    View({ class: "box-border text-muted", style: {
      "font": "12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace"
    }, attributes: { n: "redemption-card-code" } }, [card.code_hint]),
    View({ class: "box-border text-warning whitespace-nowrap", style: {
      "font-size": "11px"
    }, attributes: { n: "redemption-card-credits" } }, [
      String(card.credits ?? "—") + " 积分",
    ]),
    View({ class: "box-border text-success", style: {
      "font-size": "11px"
    }, attributes: { n: "redemption-card-status" } }, [status_text]),
    View({ class: "box-border text-muted break-anywhere max-760-grid-column", style: {
      "font-size": "11px",
      "--max-760-grid-column": "1/-1"
    }, attributes: { n: "redemption-card-detail" } }, [
      card.status === "redeemed"
        ? (card.redeemer_email || card.redeemer_name || "Reader") + " · " + format_time(card.redeemed_at)
        : "创建于 " + format_time(card.created_at),
    ]),
    card.status === "available"
      ? Popconfirm({ title: "停用这张尚未兑换的卡？停用后无法恢复。", confirmText: "确认停用",
          attributes: { n: "revoke-redemption-card-confirmation-" + card.id },
          onConfirm: () => store.methods.revokeCard(card.id),
          trigger: props => Button({ ...props, class: "box-border flex-none justify-self-center",
            attributes: { ...props.attributes, n: "revoke-redemption-card-" + card.id } }, ["停用卡片"]),
        })
      : null,
  ]);
}

function RedemptionCardsPage() {
  const vm$ = RedemptionCardsViewModel();
  const create_label_ = computed(vm$.state.busy, (busy) => busy ? "正在生成…" : "生成兑换卡");
  const date_attributes = (name, label) => ({
    n: name,
    "aria-label": label,
    type: "datetime-local",
  });
  const content = View({
    class: "box-border grid", style: {
      "gap": "16px"
    },
    attributes: { n: "redemption-management" },
    onMounted() {
      vm$.methods.loadCampaigns();
    },
  }, [
    Show({
      when: computed(vm$.state.error, Boolean),
      ok() {
        return View({ class: "box-border text-danger rounded-card bg-danger-bg", style: {
          "padding": "11px 13px",
          "font-size": "12px",
          "line-height": "1.55"
        }, attributes: { n: "redemption-error", role: "alert" } }, [vm$.state.error]);
      },
    }),
    Show({
      when: computed(vm$.state.message, Boolean),
      ok() {
        return View({ class: "box-border text-success rounded-card bg-success-bg", style: {
          "padding": "11px 13px",
          "font-size": "12px",
          "line-height": "1.55"
        }, attributes: { n: "redemption-message", role: "status" } }, [vm$.state.message]);
      },
    }),
    View({ class: "box-border min-w-0", attributes: { n: "redemption-create-panel" } }, [
      View({ class: "box-border flex items-center justify-between", style: {
        "gap": "16px"
      }, attributes: { n: "redemption-create-heading" } }, [
        View({class: "box-border",  style: {
          "font-size": "20px",
          "font-weight": "720"
        }, attributes: { n: "redemption-create-title" } }, ["创建兑换活动"]),
        View({ class: "box-border text-muted", style: {
          "max-width": "720px",
          "margin-top": "7px",
          "font-size": "12px",
          "line-height": "1.6"
        }, attributes: { n: "redemption-create-description" } }, [
          "设置默认积分与数量，也可逐行自定义兑换码和每张卡的积分。兑换码只在创建后显示一次，数据库仅保存哈希。",
        ]),
      ]),
      View({
        as: "form",
        class: "box-border grid items-end rounded-card bg-surface max-760-grid-template-columns", style: {
          "grid-template-columns": "repeat(3,minmax(0,1fr))",
          "gap": "12px",
          "margin-top": "18px",
          "padding-top": "18px",
          "border-top": "1px solid var(--frui-color-border-soft)",
          "padding": "16px",
          "border": "1px solid var(--frui-color-border-soft)",
          "--max-760-grid-template-columns": "repeat(2,minmax(0,1fr))"
        },
        attributes: { n: "redemption-create-form" },
        onSubmit(event) {
          event.preventDefault();
          return vm$.methods.createCampaign();
        },
      }, [
        View({ class: "box-border grid min-w-0 col-span-full-grid-column", style: {
          "gap": "7px",
          "width": "min(220px,100%)"
        }, attributes: { n: "redemption-name-field" } }, [
          View({ class: "box-border text-muted", style: {
            "font-size": "12px"
          }, attributes: { n: "redemption-name-label" } }, ["活动名称"]),
          Input({
            class: "box-border w-full min-w-0", style: {
              "min-height": "44px"
            },
            value: vm$.state.draft_name,
            placeholder: "例如：秋季读者福利",
            attributes: { n: "redemption-name-input", "aria-label": "活动名称", maxlength: "80", autocomplete: "off" },
            onInput(event) { vm$.methods.setDraft("name", event.target.value); },
          }),
        ]),
        View({ class: "box-border grid min-w-0", style: {
          "gap": "7px",
          "width": "min(220px,100%)"
        }, attributes: { n: "redemption-credits-field" } }, [
          View({ class: "box-border text-muted", style: {
            "font-size": "12px"
          }, attributes: { n: "redemption-credits-label" } }, ["每张卡奖励积分"]),
          Input({
            class: "box-border w-full min-w-0", style: {
              "min-height": "44px"
            },
            value: vm$.state.draft_credits,
            attributes: { n: "redemption-credits-input", "aria-label": "每张卡奖励积分", type: "number", min: "1", max: "10000000", step: "1" },
            onInput(event) { vm$.methods.setDraft("credits", event.target.value); },
          }),
        ]),
        View({ class: "box-border grid min-w-0", style: {
          "gap": "7px",
          "width": "min(220px,100%)"
        }, attributes: { n: "redemption-count-field" } }, [
          View({ class: "box-border text-muted", style: {
            "font-size": "12px"
          }, attributes: { n: "redemption-count-label" } }, ["卡片数量（最多 1000）"]),
          Input({
            class: "box-border w-full min-w-0", style: {
              "min-height": "44px"
            },
            value: vm$.state.draft_card_count,
            attributes: {
              n: "redemption-count-input",
              "aria-label": "兑换卡数量",
              type: "number",
              min: "1",
              max: "1000",
              step: "1",
              disabled: computed(vm$.state.draft_custom_enabled, (enabled) => enabled || undefined),
            },
            onInput(event) { vm$.methods.setDraft("card_count", event.target.value); },
          }),
        ]),
        View({ class: "box-border grid min-w-0", style: {
          "gap": "7px",
          "width": "min(220px,100%)"
        }, attributes: { n: "redemption-start-field" } }, [
          View({ class: "box-border text-muted", style: {
            "font-size": "12px"
          }, attributes: { n: "redemption-start-label" } }, ["开始时间（可选）"]),
          Input({
            class: "box-border w-full min-w-0", style: {
              "min-height": "44px"
            },
            value: vm$.state.draft_starts_at,
            attributes: date_attributes("redemption-start-input", "兑换活动开始时间"),
            onInput(event) { vm$.methods.setDraft("starts_at", event.target.value); },
          }),
        ]),
        View({ class: "box-border grid min-w-0", style: {
          "gap": "7px",
          "width": "min(220px,100%)"
        }, attributes: { n: "redemption-expiry-field" } }, [
          View({ class: "box-border text-muted", style: {
            "font-size": "12px"
          }, attributes: { n: "redemption-expiry-label" } }, ["过期时间（可选）"]),
          Input({
            class: "box-border w-full min-w-0", style: {
              "min-height": "44px"
            },
            value: vm$.state.draft_expires_at,
            attributes: date_attributes("redemption-expiry-input", "兑换活动过期时间"),
            onInput(event) { vm$.methods.setDraft("expires_at", event.target.value); },
          }),
        ]),
        View({ class: "box-border grid min-w-0 col-span-full-grid-column", style: {
          "gap": "7px",
          "width": "min(220px,100%)"
        }, attributes: { n: "redemption-custom-field" } }, [
          View({ class: "box-border flex items-center", style: {
            "gap": "9px"
          }, attributes: { n: "redemption-custom-toggle-row" } }, [
            Input({class: "box-border",
              attributes: {
                n: "redemption-custom-toggle-input",
                type: "checkbox",
                checked: computed(vm$.state.draft_custom_enabled, (enabled) => enabled || undefined),
                "aria-label": "自定义兑换码",
              },
              onChange(event) { vm$.methods.setDraft("custom_enabled", event.target.checked); },
            }),
            View({ class: "box-border text-muted", style: {
              "font-size": "12px"
            }, attributes: { n: "redemption-custom-toggle-label" } }, [
              "自定义兑换码（勾选后按清单创建，忽略上方数量）",
            ]),
          ]),
          Show({
            when: computed(vm$.state.draft_custom_enabled, Boolean),
            ok() {
              return View({ class: "box-border grid", style: {
                "gap": "7px"
              }, attributes: { n: "redemption-custom-input" } }, [
                Textarea({
                  class: "box-border block w-full min-w-0 resize-vertical rounded-control bg-surface text-text", style: {
                    "min-height": "104px",
                    "padding": "9px 11px",
                    "font": "12px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace"
                  },
                  value: vm$.state.draft_custom_codes,
                  attributes: {
                    n: "redemption-custom-codes-input",
                    rows: "4",
                    spellcheck: "false",
                    "aria-label": "自定义兑换码清单",
                    placeholder: "每行一个，例如：\nGIFT-2026-READER\nFINDRSS-TEAM,250",
                  },
                  onInput(event) { vm$.methods.setDraft("custom_codes", event.target.value); },
                }),
                View({ class: "box-border m-0 text-muted break-anywhere col-span-full", style: {
                  "font-size": "12px",
                  "line-height": "1.5"
                }, attributes: { n: "redemption-custom-codes-hint" } }, [
                  "每行一个，8–32 位字母或数字，可用空格或连字符分组；写作「兑换码,积分」可自定义该卡积分，不写则用默认积分。保存时统一转为大写并去掉分隔符。",
                ]),
              ]);
            },
          }),
        ]),
        Button({class: "box-border",
          attributes: { n: "create-redemption-campaign-button", type: "submit" },
          disabled: computed(vm$.state.busy, (busy) => busy || undefined),
          // Timeless 0.34.0 不渲染真实 <form>，submit 事件不会触发，提交必须走 onClick。
          onClick() { return vm$.methods.createCampaign(); },
        }, [create_label_]),
      ]),
    ]),
    Show({
      when: computed(vm$.state.created_codes, (value) => value.codes.length > 0),
      ok() {
        const codes_text_ = computed(vm$.state.created_codes, (value) =>
          value.codes.map((item) => item.credits == null ? item.code : item.code + "," + item.credits).join("\n"));
        const heading_ = computed(vm$.state.created_codes, (value) => value.campaign_name + " · " + value.codes.length + " 张卡");
        return View({ class: "box-border rounded-card bg-success-bg box-shadow-shadow-card border-color-border-soft max-760-padding", style: {
          "padding": "18px",
          "--max-760-padding": "15px"
        }, attributes: { n: "redemption-created-codes" } }, [
          View({ class: "box-border flex items-flex-start justify-between max-760-align-items max-760-flex-direction", style: {
            "gap": "16px",
            "--max-760-align-items": "flex-start",
            "--max-760-flex-direction": "column"
          }, attributes: { n: "redemption-created-heading" } }, [
            View({class: "box-border",  style: {
              "font-size": "20px",
              "font-weight": "720"
            }, attributes: { n: "redemption-created-title" } }, [heading_]),
            View({ class: "box-border flex flex-none flex-wrap justify-end max-760-justify-content", style: {
              "gap": "8px",
              "--max-760-justify-content": "flex-start"
            }, attributes: { n: "redemption-export-actions" } }, [
              Button({class: "box-border",  attributes: { n: "download-redemption-codes-button" }, onClick() { vm$.methods.downloadCodes(); } }, ["下载 CSV"]),
              Button({ class: "box-border flex-none justify-self-center", attributes: { n: "hide-redemption-codes-button" }, onClick() { vm$.methods.clearCreatedCodes(); } }, ["隐藏兑换码"]),
            ]),
          ]),
          View({ class: "box-border text-muted", style: {
            "max-width": "720px",
            "margin-top": "7px",
            "font-size": "12px",
            "line-height": "1.6"
          }, attributes: { n: "redemption-created-description" } }, [
            "完整兑换码仅本次可见，自定义积分以「兑换码,积分」展示。下载后妥善保存；关闭或刷新页面后，后台无法再次读取明文。",
          ]),
          Textarea({
            class: "box-border block w-full resize-vertical rounded-control bg-surface-raised text-muted", style: {
              "min-height": "126px",
              "margin-top": "14px",
              "padding": "11px",
              "font": "12px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace"
            },
            value: codes_text_,
            attributes: { n: "redemption-code-export", rows: "6", readonly: "readonly", spellcheck: "false", "aria-label": "新生成的兑换码" },
          }),
        ]);
      },
    }),
    View({ class: "box-border min-w-0", attributes: { n: "redemption-campaign-panel" } }, [
      Show({
        when: computed(vm$.state.campaigns, (campaigns) => campaigns.length === 0),
        ok() {
          return View({ class: "box-border rounded-card text-muted", style: {
            "margin-top": "14px",
            "padding": "18px",
            "font-size": "12px",
            "line-height": "1.6"
          }, attributes: { n: "redemption-campaigns-empty" } }, ["还没有兑换活动。创建活动后会在这里查看卡片状态和兑换记录。"]);
        },
      }),
      View({ class: "box-border grid", style: {
        "gap": "14px",
        "margin-top": "14px"
      }, attributes: { n: "redemption-campaign-list" } }, [
        For({
          key: "id",
          each: vm$.state.campaigns,
          render(campaign_value) {
            return CampaignRowView({ store: vm$, campaign: source_value(campaign_value) });
          },
        }),
      ]),
      PaginationView(Timeless, { model: vm$.campaign_pagination, name: "campaigns-pagination", label: "兑换活动列表分页" }),
    ]),
    Show({
      when: computed(vm$.state.selected_campaign, Boolean),
      ok() {
        const selected_ = vm$.state.selected_campaign;
        const detail_title_ = computed(selected_, (campaign) => campaign ? campaign.name + " · 卡片明细" : "卡片明细");
        const detail_summary_ = computed(selected_, (campaign) => campaign
          ? campaign.redeemed_count + " 已兑换 · " + campaign.available_count + " 可兑换 · " + campaign.revoked_count + " 已停用"
          : "");
        return View({ class: "box-border min-w-0", attributes: { n: "redemption-card-panel" } }, [
          View({ class: "box-border flex items-center justify-between", style: {
            "gap": "16px"
          }, attributes: { n: "redemption-card-list-heading" } }, [
            View({class: "box-border",  style: {
              "font-size": "16px",
              "font-weight": "700"
            }, attributes: { n: "redemption-card-list-title" } }, [detail_title_]),
            View({ class: "box-border text-muted", style: {
              "margin-top": "5px",
              "font-size": "11px"
            }, attributes: { n: "redemption-card-list-summary" } }, [detail_summary_]),
          ]),
          View({
            as: "form",
            class: "box-border flex flex-wrap items-end rounded-card bg-surface", style: {
              "gap": "12px",
              "margin-top": "14px",
              "padding": "16px",
              "border": "1px solid var(--frui-color-border-soft)"
            },
            attributes: { n: "redemption-add-cards-form" },
            onSubmit(event) {
              event.preventDefault();
              return vm$.methods.createCards();
            },
          }, [
            View({
              class: "box-border grid min-w-0 col-span-full-grid-column w-full", style: {
                "gap": "7px"
              },
              attributes: { n: "redemption-add-custom-field" },
            }, [
              View({ class: "box-border flex items-center", style: {
                "gap": "9px"
              }, attributes: { n: "redemption-add-custom-toggle-row" } }, [
                Input({class: "box-border",
                  attributes: {
                    n: "redemption-add-custom-toggle-input",
                    type: "checkbox",
                    checked: computed(vm$.state.add_custom_enabled, (enabled) => enabled || undefined),
                    "aria-label": "自定义兑换码",
                  },
                  onChange(event) { vm$.methods.setDraft("add_custom_enabled", event.target.checked); },
                }),
                View({ class: "box-border text-muted", style: {
                  "font-size": "12px"
                }, attributes: { n: "redemption-add-custom-toggle-label" } }, [
                  "自定义兑换码（勾选后按清单创建，忽略数量）",
                ]),
              ]),
              Show({
                when: computed(vm$.state.add_custom_enabled, Boolean),
                ok() {
                  return View({ class: "box-border grid", style: {
                    "gap": "7px"
                  }, attributes: { n: "redemption-add-custom-input" } }, [
                    Textarea({
                      class: "box-border block w-full min-w-0 resize-vertical rounded-control bg-surface text-text", style: {
                        "min-height": "104px",
                        "padding": "9px 11px",
                        "font": "12px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace"
                      },
                      value: vm$.state.add_custom_codes,
                      attributes: {
                        n: "redemption-add-custom-codes-input",
                        rows: "4",
                        spellcheck: "false",
                        "aria-label": "自定义兑换码清单",
                        placeholder: "每行一个，例如：\nGIFT-2026-READER\nFINDRSS-TEAM,250",
                      },
                      onInput(event) { vm$.methods.setDraft("add_custom_codes", event.target.value); },
                    }),
                    View({ class: "box-border m-0 text-muted break-anywhere col-span-full", style: {
                      "font-size": "12px",
                      "line-height": "1.5"
                    }, attributes: { n: "redemption-add-custom-codes-hint" } }, [
                      "每行一个，8–32 位字母或数字，可用空格或连字符分组；写作「兑换码,积分」可自定义该卡积分，不写则用活动默认积分。保存时统一转为大写并去掉分隔符。",
                    ]),
                  ]);
                },
              }),
            ]),
            View({ class: "box-border grid min-w-0", style: {
              "gap": "7px",
              "width": "min(220px,100%)"
            }, attributes: { n: "redemption-add-count-field" } }, [
              View({ class: "box-border text-muted", style: {
                "font-size": "12px"
              }, attributes: { n: "redemption-add-count-label" } }, ["新增卡片数量"]),
              Input({
                class: "box-border w-full min-w-0", style: {
                  "min-height": "44px"
                },
                value: vm$.state.add_card_count,
                attributes: {
                  n: "redemption-add-count-input",
                  "aria-label": "新增兑换卡数量",
                  type: "number",
                  min: "1",
                  max: "1000",
                  step: "1",
                  disabled: computed(vm$.state.add_custom_enabled, (enabled) => enabled || undefined),
                },
                onInput(event) { vm$.methods.setDraft("add_card_count", event.target.value); },
              }),
            ]),
            Button({class: "box-border",
              attributes: { n: "add-redemption-cards-button", type: "submit" },
              disabled: computed(vm$.state.busy, (busy) => busy || undefined),
              // 同上：submit 事件不会触发，提交必须走 onClick。
              onClick() { return vm$.methods.createCards(); },
            }, [computed(vm$.state.busy, (busy) => busy ? "正在生成…" : "在活动内生成兑换卡")]),
          ]),
          View({ class: "box-border grid", style: {
            "gap": "14px",
            "margin-top": "14px"
          }, attributes: { n: "redemption-card-list" } }, [
            For({
              key: "id",
              each: vm$.state.cards,
              render(card_value) {
                return CardRowView({ store: vm$, card: source_value(card_value) });
              },
            }),
          ]),
          PaginationView(Timeless, { model: vm$.card_pagination, name: "cards-pagination", label: "兑换卡列表分页" }),
        ]);
      },
    }),
  ]);

  return window.FindRSSAdminShell.Page({
    page_id: "redemptions",
    eyebrow: "Reader Credits",
    title: "兑换卡管理",
    count: computed(vm$.state.campaign_total_count, count => count + " 个活动"),
    actions: [
      Button({
        class: "box-border flex-none justify-self-center",
        attributes: { n: "refresh-redemption-campaigns-button" },
        disabled: computed(vm$.state.loading, (loading) => loading || undefined),
        onClick() { return vm$.methods.loadCampaigns(); },
      }, [computed(vm$.state.loading, (loading) => loading ? "正在刷新…" : "刷新")]),
    ],
  }, [content]);
}

export { RedemptionCardsPage };
