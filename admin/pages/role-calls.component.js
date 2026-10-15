import {
  atomic_classes
} from "../components/frui/atomic.js";
const {
  View,
  Show,
  For,
  ref,
  computed,
  combine
} = Timeless;
import {
  Button
} from "../components/frui/button.js";
import {
  IconButton
} from "../components/frui/icon-button.js";
import {
  Modal
} from "../components/frui/modal.js";
import {
  Popconfirm
} from "../components/frui/popconfirm.js";
import {
  Loading
} from "../components/frui/loading.js";
import {
  XiaoxunDialogueView
} from "@/components/xiaoxun-dialogue.js";

function RoleCallsView({
  app,
  role
}) {
  const current = role.value;
  const dialogue = app.dialogue.for_role(current.id);
  const state = ref(dialogue.toValue()),
    conversation = ref(dialogue.model.dialogue()),
    open = ref(false);
  const blocked = combine({
    state,
    conversation
  }, ({
    state,
    conversation
  }) => conversation.busy || Boolean(state.deleting || state.restoring));
  const allowed = app.user$.can("ai:use");

  function show() {
    app.dialogue.model.close_dialogue();
    open.set(true);
    void dialogue.refresh_history();
  }
  return View({
    attributes: {
      n: "settings-role-calls"
    },
    onUnmounted() {
      dialogue.destroy();
    },
    onMounted() {
      const detach_state = dialogue.subscribe(value => state.set(value));
      const detach_model = dialogue.model.subscribe(value => conversation.set(value));
      const detach_events = app.realtime?.subscribe(event => {
        if (open.value && event.type === "agent" && event.role_id === current.id && (event.event === "done" || event.event ===
            "error")) void dialogue.refresh_history();
      });
      return () => {
        detach_state();
        detach_model();
        detach_events?.();
      };
    },
  }, [
    Button({
      attributes: {
        n: "settings-role-calls-open"
      },
      disabled: !allowed,
      onClick: show
    }, ["调用记录"]),
    Modal({
      open,
      title: computed(role, value => `${value.name || value.id} · 调用记录`),
      class: "width-min-1000-pixels-100-percent height-min-700-pixels-calc-100-dynamic-vh-space-6-2",
      attributes: {
        n: "role-calls-dialog"
      },
      onClose: () => open.set(false),
      style: {
        ...{
          "--width-min-1000-pixels-100-percent": "min(1000px,100%)",
          "--height-min-700-pixels-calc-100-dynamic-vh-space-6-2": "min(700px,calc(100dvh - var(--frui-space-6)*2))"
        }
      }
    }, () => View({
      class: "display-grid grid-template-columns-240-pixels-minmax-0-1fr flex-1 min-height-0 media-max-width-640-pixels-grid-template-columns-minmax-0-1fr media-max-width-640-pixels-grid-template-rows-minmax-80-pixels-25-percent-minmax-0-1fr",
      attributes: {
        n: "role-calls-workspace"
      },
      style: {
        ...{
          "--grid-template-columns-240-pixels-minmax-0-1fr": "240px minmax(0,1fr)",
          "--media-max-width-640-pixels-grid-template-rows-minmax-80-pixels-25-percent-minmax-0-1fr": "minmax(80px,25%) minmax(0,1fr)"
        }
      }
    }, [
      View({
        as: "aside",
        class: "display-flex flex-direction-column gap-space-3 min-width-0 min-height-0 padding-space-4 border-right-1-pixels-solid-color-border-soft media-max-width-640-pixels-border-right-0 media-max-width-640-pixels-border-bottom-1-pixels-solid-color-border-soft media-max-width-640-pixels-padding-space-2",
        attributes: {
          n: "role-calls-history",
          "aria-label": "角色调用记录"
        },
        style: {
          ...{
            "--border-right-1-pixels-solid-color-border-soft": "1px solid var(--frui-color-border-soft)",
            "--media-max-width-640-pixels-border-bottom-1-pixels-solid-color-border-soft": "1px solid var(--frui-color-border-soft)"
          }
        }
      }, [
        View({
          class: "display-flex align-items-center justify-content-space-between flex-none",
          attributes: {
            n: "role-calls-toolbar"
          }
        }, [
          IconButton({
            icon: "refresh-cw",
            label: "刷新调用记录",
            attributes: {
              n: "role-calls-refresh"
            },
            disabled: computed(state, value => value.loading),
            onClick: () => dialogue.refresh_history()
          }),
        ]),
        View({
          class: "display-flex flex-direction-column flex-1 min-height-0 overflow-y-auto gap-space-1 media-max-width-640-pixels-flex-direction-row media-max-width-640-pixels-overflow-x-auto",
          attributes: {
            n: "role-calls-list"
          }
        }, [
          Show({
            when: computed(state, value => value.loading && !value.conversations.length),
            ok: () => Loading({
              label: "正在加载调用记录",
              size: "small"
            })
          }),
          For({
            each: computed(state, value => value.conversations),
            key: "id",
            render(raw) {
              const item = raw?.__is_ref ? raw.value : raw;
              return View({
                class: "media-max-width-640-pixels-min-width-180-pixels media-max-width-640-pixels-max-width-240-pixels display-flex align-items-center gap-space-1",
                attributes: {
                  n: "role-call-row"
                },
                style: {
                  ...{
                    "--media-max-width-640-pixels-min-width-180-pixels": "180px",
                    "--media-max-width-640-pixels-max-width-240-pixels": "240px"
                  }
                }
              }, [
                Button({
                  variant: "ghost",
                  class: atomic_classes(computed(conversation, value =>
                    "flex-1 min-width-0 height-auto padding-space-3 display-flex flex-direction-column align-items-flex-start gap-space-1 text-align-left" +
                    (value.conversation_id === item.id ? " background-color-selected color-color-link" : ""))),
                  attributes: {
                    n: "role-call-item",
                    title: computed(raw, value => value.title),
                    "aria-current": computed(conversation, value => value.conversation_id === item.id ? "true" :
                      undefined)
                  },
                  disabled: combine({
                    blocked,
                    row: raw
                  }, ({
                    blocked,
                    row
                  }) => blocked || row.message_count < 2),
                  onClick: () => dialogue.select_conversation(item.id),
                }, [
                  View({
                    as: "span",
                    class: "white-space-normal overflow-wrap-anywhere",
                    attributes: {
                      n: "role-call-title"
                    }
                  }, [computed(raw, value => value.title)]),
                  View({
                    as: "span",
                    class: "color-color-muted font-size-font-size-sm",
                    attributes: {
                      n: "role-call-date"
                    }
                  }, [computed(raw, value => value.message_count < 2 ? "调用中…" : new Date(value.updated_at)
                    .toLocaleString("zh-CN", {
                      hour12: false
                    }))]),
                ]),
                Popconfirm({
                  title: "删除这段调用记录及全部消息？",
                  disabled: blocked,
                  attributes: {
                    n: `role-call-delete-${item.id}`
                  },
                  onConfirm: () => dialogue.delete_conversation(item.id),
                  trigger: IconButton({
                    icon: "trash",
                    label: "删除调用记录",
                    size: "small",
                    disabled: blocked,
                    attributes: {
                      n: "role-call-delete"
                    }
                  }),
                }),
              ]);
            }
          }),
          Show({
            when: computed(state, value => !value.loading && !value.error && !value.conversations.length),
            ok: () => View({
              class: "color-color-muted font-size-12-pixels font-weight-400 line-height-1-6",
              attributes: {
                n: "role-calls-empty",
                role: "status"
              },
              style: {
                ...{
                  "--font-size-12-pixels": "12px"
                }
              }
            }, ["暂无调用记录"])
          }),
        ]),
        Show({
          when: computed(state, value => Boolean(value.error)),
          ok: () => View({
            class: "",
            attributes: {
              n: "role-calls-error",
              role: "alert"
            }
          }, [
            computed(state, value => value.error), Button({
              variant: "link",
              onClick: () => dialogue.retry(),
              attributes: {
                n: "role-calls-retry"
              }
            }, ["重试"]),
          ])
        }),
      ]),
      XiaoxunDialogueView({
        dialogue,
        page: true,
        read_only: true
      }),
    ])),
  ]);
}

export {
  RoleCallsView
};
