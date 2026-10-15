import {
  atomic_classes
} from "./frui/atomic.js";
const {
  View,
  Show,
  For,
  ref,
  computed,
  combine
} = Timeless;
import {
  AgentDownloads
} from "./agent-downloads.js";
import {
  Button
} from "./frui/button.js";
import {
  Loading
} from "./frui/loading.js";
import {
  XiaoxunComposer
} from "./xiaoxun-composer.js";
import {
  XiaoxunModelSelect
} from "./xiaoxun-model-select.js";

function XiaoxunDialogueView({
  dialogue,
  page = false,
  read_only = false,
  composer_options = {},
  style,
  class: custom_class,
  composerProps = {},
  onUnmounted
}) {
  const {
    model,
    composer
  } = dialogue;
  const state = ref(model.dialogue()),
    history = ref(dialogue.toValue());
  let messages_element;

  function message_view(role, content, stream = false) {
    return View({
      class: atomic_classes(computed(role, value =>
        `display-flex flex-direction-column align-items-flex-start gap-space-2 margin-bottom-space-6 overflow-wrap-anywhere empty-display-none  ${value === "user" ? "align-items-flex-end margin-left-space-6" : "margin-right-space-3"}`
        )),
      attributes: {
        n: stream ? "xiaoxun-dialogue-stream" : "xiaoxun-dialogue-message"
      }
    }, [
      View({
        as: "span",
        class: "display-block padding-inline-space-1 font-size-font-size-sm color-color-muted",
        attributes: {
          n: "xiaoxun-dialogue-speaker"
        }
      }, [computed(role, value => read_only ? (value === "user" ? "输入" : "响应") : (value === "user" ? "你" : "小讯"))]),
      View({
        class: atomic_classes(computed(role, value =>
          "max-width-100-percent box-sizing-border-box padding-space-2-space-3 border-radius-radius-card white-space-pre-wrap " +
          (value === "user" ? "background-color-surface-raised border-bottom-right-radius-radius-sm" : "padding-inline-space-1"))),
        attributes: {
          n: "xiaoxun-dialogue-message-content"
        }
      }, [content]),
    ]);
  }
  async function load_older() {
    const height = messages_element?.scrollHeight || 0,
      top = messages_element?.scrollTop || 0;
    await dialogue.load_older();
    queueMicrotask(() => {
      if (messages_element) messages_element.scrollTop = top + messages_element.scrollHeight - height;
    });
  }
  return View({
    class: atomic_classes([
      "position-fixed width-420-pixels height-480-pixels box-sizing-border-box display-flex flex-direction-column overflow-auto padding-14-pixels border-1-pixels-solid-color-border border-radius-16-pixels background-color-surface color-color-text box-shadow-0-12-pixels-36-pixels-reader-color-shadow pointer-events-auto user-select-text z-index-1 font-size-13-pixels" +
      (page ?
        " position-relative width-100-percent height-100-percent min-height-0 padding-space-4 border-0 border-radius-0 box-shadow-none" :
        ""), custom_class
    ].filter(Boolean).join(" ")),
    style: {
      ...{
        "--width-420-pixels": "420px",
        "--height-480-pixels": "480px",
        "--padding-14-pixels": "14px",
        "--border-1-pixels-solid-color-border": "1px solid var(--frui-color-border)",
        "--border-radius-16-pixels": "16px",
        "--box-shadow-0-12-pixels-36-pixels-reader-color-shadow": "0 12px 36px var(--reader-color-shadow)",
        "--font-size-13-pixels": "13px"
      },
      ...(style)
    },
    attributes: {
      n: page ? "dialogue-panel" : "xiaoxun-dialogue",
      role: page ? "region" : "dialog",
      "aria-label": read_only ? "角色调用详情" : "与小讯对话"
    },
    onMounted() {
      state.set(model.dialogue());
      history.set(dialogue.toValue());
      const detach = model.subscribe(value => state.set(value));
      const detach_history = dialogue.subscribe(value => history.set(value));
      return () => {
        detach();
        detach_history();
      };
    },
    onUnmounted,
  }, [
    ...(!page ? [View({
      class: "display-flex align-items-center gap-8-pixels flex-none padding-bottom-10-pixels cursor-grab touch-action-none user-select-none active-cursor-grabbing",
      attributes: {
        n: "xiaoxun-dialogue-header"
      },
      style: {
        ...{
          "--gap-8-pixels": "8px",
          "--padding-bottom-10-pixels": "10px"
        }
      }
    }, [
      View({
        as: "strong",
        class: "margin-right-auto font-size-15-pixels",
        attributes: {
          n: "xiaoxun-dialogue-title"
        },
        style: {
          ...{
            "--font-size-15-pixels": "15px"
          }
        }
      }, ["小讯"]),
      Button({
        variant: "ghost",
        size: "small",
        attributes: {
          n: "xiaoxun-dialogue-page",
          "aria-label": "在对话页面继续",
          title: "在对话页面继续"
        },
        onClick: dialogue.open_page
      }, [Timeless.Icon({
        name: "maximize",
        size: 16
      })]),
      Button({
        variant: "ghost",
        size: "small",
        attributes: {
          n: "xiaoxun-dialogue-close",
          "aria-label": "关闭对话"
        },
        onClick() {
          model.close_dialogue();
        }
      }, [Timeless.Icon({
        name: "x",
        size: 16
      })]),
    ])] : []),
    ...(!page ? [View({
      class: "flex-none padding-8-pixels-10-pixels border-radius-8-pixels background-color-surface-raised color-color-muted font-size-12-pixels overflow-wrap-anywhere max-height-50-pixels overflow-y-auto",
      attributes: {
        n: "xiaoxun-dialogue-context"
      },
      style: {
        ...{
          "--padding-8-pixels-10-pixels": "8px 10px",
          "--border-radius-8-pixels": "8px",
          "--font-size-12-pixels": "12px",
          "--max-height-50-pixels": "50px"
        }
      }
    }, [computed(state, ({
        context
      }) =>
      context.automation ? `自动化：${context.automation.flow.name || "未命名流程"} · 修改实时更新草稿，保存后生效` :
      context.article ? `文章：${context.article.title || context.article.article_key} · ${context.feed.title}` :
      context.feed ? `订阅源：${context.feed.title || context.feed.url}` : "可以聊聊你的订阅和文章。")])] : []),
    View({
      class: "flex-1 min-height-0 padding-16-pixels-0-8-pixels overflow-y-auto line-height-1-7 overscroll-behavior-contain",
      attributes: {
        n: "xiaoxun-dialogue-messages",
        role: "log",
        "aria-live": "polite",
        "aria-busy": computed(state, value => String(Boolean(value.loading)))
      },
      onMounted(event) {
        const element = event.target?.get$elm?.() || event.target;
        messages_element = element;
        let active = true,
          previous = model.dialogue();
        const scroll = () => queueMicrotask(() => {
          if (active && element) element.scrollTop = element.scrollHeight;
        });
        const detach = model.subscribe(value => {
          const near_bottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
          const new_conversation = value.editor_revision !== previous.editor_revision;
          const new_message = value.messages.length > previous.messages.length && value.messages.at(-1)?.role === "user";
          if (new_conversation || new_message || near_bottom && (value.streaming !== previous.streaming || value.messages.at(-1)
              ?.content !== previous.messages.at(-1)?.content)) scroll();
          previous = value;
        });
        scroll();
        return () => {
          active = false;
          messages_element = null;
          detach();
        };
      },
      style: {
        ...{
          "--padding-16-pixels-0-8-pixels": "16px 0 8px"
        }
      }
    }, [
      Show({
        when: computed(state, value => value.loading),
        ok: () => View({
          class: "display-flex align-items-center justify-content-center height-100-percent",
          attributes: {
            n: "xiaoxun-dialogue-loading"
          }
        }, [Loading({
          label: "正在恢复对话"
        })])
      }),
      Show({
        when: computed(state, value => value.has_more && !value.loading),
        ok: () => Button({
          variant: "link",
          attributes: {
            n: "dialogue-load-older"
          },
          disabled: computed(history, value => value.older_loading),
          onClick: load_older
        }, [computed(history, value => value.older_loading ? "正在加载…" : "加载较早消息")])
      }),
      ...(!page ? [Show({
        when: computed(state, value => !value.messages.length && !value.busy && !value.loading),
        ok: () => View({
          class: "display-flex flex-direction-column justify-content-center height-100-percent box-sizing-border-box padding-20-pixels-10-pixels",
          attributes: {
            n: "xiaoxun-dialogue-empty"
          },
          style: {
            ...{
              "--padding-20-pixels-10-pixels": "20px 10px"
            }
          }
        }, [View({
            as: "strong",
            class: "font-size-17-pixels font-weight-600",
            attributes: {
              n: "xiaoxun-dialogue-empty-title"
            },
            style: {
              ...{
                "--font-size-17-pixels": "17px"
              }
            }
          }, ["一起聊聊正在读的内容"]),
          View({
            as: "p",
            class: "margin-8-pixels-0-0 color-color-muted font-size-12-pixels",
            attributes: {
              n: "xiaoxun-dialogue-empty-hint"
            },
            style: {
              ...{
                "--margin-8-pixels-0-0": "8px 0 0",
                "--font-size-12-pixels": "12px"
              }
            }
          }, ["可以问文章讲了什么，也可以查找订阅里的内容。"]),
        ])
      })] : []),
      For({
        each: computed(state, value => value.loading ? [] : value.messages),
        render: row =>
          message_view(computed(row, value => value.role), computed(row, value => value.content))
      }),
      Show({
        when: computed(state, value => !value.loading && (value.busy || Boolean(value.streaming))),
        ok: () => message_view("assistant", computed(state, value => value.streaming || "正在思考…"), true)
      }),
      View({
        class: "margin-0-4-pixels-8-pixels color-color-muted font-size-11-pixels empty-display-none",
        attributes: {
          n: "xiaoxun-agent-activity",
          role: "status"
        },
        style: {
          ...{
            "--margin-0-4-pixels-8-pixels": "0 4px 8px",
            "--font-size-11-pixels": "11px"
          }
        }
      }, [computed(state, value => value.busy ? value.activity : "")]),
      AgentDownloads({
        items: computed(state, value => value.loading ? [] : value.artifacts)
      }),
    ]),
    View({
      class: "empty-display-none flex-none margin-bottom-8-pixels color-reader-color-error-dc2626 font-size-12-pixels",
      attributes: {
        n: "xiaoxun-dialogue-error",
        role: "alert"
      },
      style: {
        ...{
          "--margin-bottom-8-pixels": "8px",
          "--font-size-12-pixels": "12px"
        }
      }
    }, [combine({
      state,
      history
    }, ({
      state,
      history
    }) => state.error || history.error)]),
    Show({
      when: computed(state, value => value.reconnecting || !value.connected),
      ok: () => Button({
        variant: "link",
        attributes: {
          n: "xiaoxun-dialogue-reconnect",
          "aria-label": "重连并恢复对话"
        },
        disabled: computed(state, value => value.recovering),
        onClick: () => model.reconnect()
      }, [computed(state, value => value.recovering ? "正在恢复…" : "重连")])
    }),
    Show({
      when: computed(history, value => Boolean(value.error)),
      ok: () => Button({
        variant: "link",
        attributes: {
          n: "dialogue-restore-retry"
        },
        onClick: () => dialogue.retry()
      }, ["重试"])
    }),
    ...(!read_only ? [View({
      ...composerProps,
      class: atomic_classes([
        "flex-none padding-8-pixels border-1-pixels-solid-color-border border-radius-12-pixels background-color-surface-raised focus-within-border-color-color-focus",
        composerProps.class
      ].filter(Boolean).join(" ")),
      attributes: {
        n: "xiaoxun-dialogue-composer"
      },
      style: {
        ...{
          "--padding-8-pixels": "8px",
          "--border-1-pixels-solid-color-border": "1px solid var(--frui-color-border)",
          "--border-radius-12-pixels": "12px"
        },
        ...(composerProps)?.style
      }
    }, [
      XiaoxunComposer({
        model: composer,
        id_prefix: page ? "dialogue" : "xiaoxun",
        ...composer_options
      }),
      View({
        class: "display-flex align-items-center justify-content-space-between gap-space-2",
        attributes: {
          n: "xiaoxun-dialogue-composer-footer"
        }
      }, [
        XiaoxunModelSelect({
          pet: model
        }),
        Button({
          class: "width-32-pixels height-32-pixels min-height-32-pixels padding-0 border-radius-50-percent background-color-primary color-color-primary-contrast-white",
          attributes: {
            n: "xiaoxun-dialogue-send",
            "aria-label": "发送消息"
          },
          disabled: computed(state, value => value.busy || value.loading || !value.draft.trim()),
          onClick: () => model.send(),
          style: {
            ...{
              "--width-32-pixels": "32px",
              "--height-32-pixels": "32px",
              "--min-height-32-pixels": "32px"
            }
          }
        }, [Timeless.Icon({
          name: "arrow-up",
          size: 18
        })]),
      ]),
    ])] : []),
  ]);
}

export {
  XiaoxunDialogueView
};
