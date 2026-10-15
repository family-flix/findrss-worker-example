import {
  atomic_classes
} from "./frui/atomic.js";
const {
  View,
  Show,
  For,
  ref,
  computed
} = Timeless;
import {
  EditorView
} from "prosemirror-view";

function XiaoxunComposer({
  model,
  id_prefix = "xiaoxun",
  label = "向小讯提问",
  placeholder = "问问小讯，输入 / 引用文章或订阅源…",
  editorStyle = {}
}) {
  const state = ref(model.toValue());
  return View({
    class: "position-relative",
    attributes: {
      n: "xiaoxun-composer-editor"
    },
    onMounted() {
      state.set(model.toValue());
      return model.subscribe(value => state.set(value));
    },
  }, [
    Show({
      when: computed(state, value => Boolean(value.menu)),
      ok: () => View({
        class: "position-absolute bottom-calc-100-percent-8-pixels left-0 right-0 z-index-2 max-height-min-220-pixels-32-dynamic-vh overflow-y-auto padding-4-pixels border-1-pixels-solid-color-border border-radius-10-pixels background-color-surface box-shadow-shadow-card",
        attributes: {
          n: "xiaoxun-reference-menu",
          id: `${id_prefix}-reference-menu`,
          role: "listbox",
          "aria-label": "引用快捷命令"
        },
        onMounted(event) {
          const element = event.target?.get$elm?.() || event.target;
          return model.subscribe(() => queueMicrotask(() => {
            const option = element.querySelector('[aria-selected="true"]');
            if (!option) return;
            if (option.offsetTop < element.scrollTop) element.scrollTop = option.offsetTop;
            if (option.offsetTop + option.offsetHeight > element.scrollTop + element.clientHeight) element.scrollTop =
              option.offsetTop + option.offsetHeight - element.clientHeight;
          }));
        },
        style: {
          ...{
            "--bottom-calc-100-percent-8-pixels": "calc(100% + 8px)",
            "--max-height-min-220-pixels-32-dynamic-vh": "min(220px,32dvh)",
            "--padding-4-pixels": "4px",
            "--border-1-pixels-solid-color-border": "1px solid var(--frui-color-border)",
            "--border-radius-10-pixels": "10px"
          }
        }
      }, [
        View({
          class: "padding-6-pixels-8-pixels font-size-11-pixels color-color-muted",
          attributes: {
            n: "xiaoxun-reference-menu-title"
          },
          style: {
            ...{
              "--padding-6-pixels-8-pixels": "6px 8px",
              "--font-size-11-pixels": "11px"
            }
          }
        }, [computed(state, value => value.menu?.stage === "commands" ? "引用内容" : value.menu?.stage === "article" ? "搜索文章标题" :
          "搜索订阅源")]),
        For({
          each: computed(state, value => value.menu?.items || []),
          render(raw, index) {
            return View({
              as: "button",
              class: atomic_classes(computed(state, value =>
                "display-flex flex-direction-column gap-2-pixels width-100-percent padding-7-pixels-8-pixels border-none border-radius-6-pixels color-inherit background-transparent text-align-left hover-background-color-surface-hover" +
                (value.menu?.index === index.value ? " background-color-surface-hover" : ""))),
              attributes: {
                n: "xiaoxun-reference-option",
                type: "button",
                role: "option",
                id: computed(index, value => `${id_prefix}-reference-option-${value}`),
                "aria-selected": computed(state, value => String(value.menu?.index === index.value))
              },
              onMouseDown: event => event.preventDefault(),
              onClick: () => model.select(index.value),
              style: {
                ...{
                  "--gap-2-pixels": "2px",
                  "--padding-7-pixels-8-pixels": "7px 8px",
                  "--border-radius-6-pixels": "6px"
                }
              }
            }, [View({
                as: "strong",
                class: "font-size-12-pixels font-weight-500",
                attributes: {
                  n: "xiaoxun-reference-title"
                },
                style: {
                  ...{
                    "--font-size-12-pixels": "12px"
                  }
                }
              }, [computed(raw, value => value.title)]),
              View({
                as: "span",
                class: "display-block max-width-100-percent overflow-hidden text-overflow-ellipsis white-space-nowrap font-size-10-pixels color-color-muted",
                attributes: {
                  n: "xiaoxun-reference-detail"
                },
                style: {
                  ...{
                    "--font-size-10-pixels": "10px"
                  }
                }
              }, [computed(raw, value => value.detail)])
            ]);
          }
        }),
        Show({
          when: computed(state, value => !value.menu?.items.length),
          ok: () => View({
              class: "padding-12-pixels-8-pixels color-color-muted font-size-12-pixels",
              attributes: {
                n: "xiaoxun-reference-empty",
                role: "status"
              },
              style: {
                ...{
                  "--padding-12-pixels-8-pixels": "12px 8px",
                  "--font-size-12-pixels": "12px"
                }
              }
            },
            [computed(state, value => value.menu?.error || (value.menu?.loading ? "正在搜索…" : "没有匹配的结果"))])
        }),
      ])
    }),
    View({
      attributes: {
        n: "xiaoxun-input-host"
      },
      onMounted(event) {
        const element = event.target?.get$elm?.() || event.target;
        const attributes = value => ({
          class: "position-relative min-height-52-pixels max-height-120-pixels overflow-y-auto padding-4-pixels outline-none white-space-pre-wrap overflow-wrap-anywhere user-select-text cursor-text line-height-1-6 data-empty-true-before-content-attr-data-placeholder data-empty-true-before-position-absolute data-empty-true-before-color-color-muted data-empty-true-before-pointer-events-none contenteditable-false-opacity-6",
          style: Object.entries({
            ...{
              "--min-height-52-pixels": "52px",
              "--max-height-120-pixels": "120px",
              "--padding-4-pixels": "4px"
            },
            ...editorStyle
          }).map(([key, value]) => `${key}: ${value}`).join(";"),
          "data-n": "xiaoxun-dialogue-input",
          role: "textbox",
          "aria-label": label,
          "aria-multiline": "true",
          "data-empty": String(value.empty),
          "data-placeholder": placeholder,
          "aria-autocomplete": "list",
          "aria-controls": value.menu ? `${id_prefix}-reference-menu` : "",
          "aria-activedescendant": value.menu?.items.length ? `${id_prefix}-reference-option-${value.menu.index}` : ""
        });
        const view = new EditorView(element, {
          state: model.toValue().editor,
          attributes: attributes(model.toValue()),
          editable: () => !model.toValue().busy,
          dispatchTransaction: transaction => model.dispatch(transaction),
          handleKeyDown: (_, event) => model.handle_key(event),
        });
        const detach = model.subscribe(value => {
          view.updateState(value.editor);
          view.setProps({
            attributes: attributes(value)
          });
        });
        view.focus();
        return () => {
          detach();
          view.destroy();
        };
      }
    }),
  ]);
}
export {
  XiaoxunComposer
};
