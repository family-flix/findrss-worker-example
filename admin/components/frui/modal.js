import {
  atomic_classes
} from "./atomic.js";
const {
  Portal,
  Show,
  View,
  computed
} = Timeless;
import {
  IconButton
} from "./icon-button.js";
import {
  ModalViewModel
} from "./modal.model.js";
import {
  next_uid
} from "./shared.js";

// 不传 title 时保留媒体浮层；带 title 时提供标准 header、遮罩与可滚动 body。
function Modal({
  open,
  title,
  header,
  close_size = "medium",
  fullscreen,
  progress,
  onClose,
  busy,
  initialFocus,
  class: custom_class,
  attributes = {},
  onMounted,
  onUnmounted
}, render) {
  return Show({
    when: open,
    ok() {
      const content = render();
      if (title === undefined) return Portal({}, [
        View({
          class: "position-fixed inset-0 z-index-80",
          attributes: {
            n: "modal"
          }
        }, [content]),
      ]);
      const model = ModalViewModel({
        onClose,
        busy,
        initialFocus
      });
      const title_id = next_uid("modal-title");
      return Portal({}, [View({
        class: atomic_classes(computed(fullscreen, value =>
          "position-fixed inset-0 z-index-80 display-flex align-items-center justify-content-center padding-space-4 background-color-overlay" +
          (value ? " padding-0" : ""))),
        attributes: {
          n: "modal"
        },
        onMounted,
        onUnmounted,
        onClick(event) {
          if (event.target === event.currentTarget) model.close();
        },
      }, [View({
        class: computed(fullscreen, value => atomic_classes([
          "display-flex flex-direction-column min-width-0 max-height-100-percent width-min-480-pixels-100-percent overflow-hidden border-radius-radius-card background-color-surface color-color-text box-shadow-shadow-card focus-visible-outline-2-pixels-solid-color-focus focus-visible-outline-offset-2-pixels",
          value ? "width-100-percent height-100-percent border-radius-0" : "", custom_class
        ].filter(Boolean).join(" "))),
        attributes: {
          n: "modal-dialog",
          role: "dialog",
          "aria-modal": "true",
          ...(header ? {
            "aria-label": title
          } : {
            "aria-labelledby": title_id
          }),
          tabindex: "-1",
          ...attributes
        },
        onMounted: model.mount,
        onUnmounted: model.unmount,
        onKeyDown: model.keydown,
        style: {
          ...{
            "--width-min-480-pixels-100-percent": "min(480px,100%)",
            "--focus-visible-outline-2-pixels-solid-color-focus": "2px solid var(--frui-color-focus)",
            "--focus-visible-outline-offset-2-pixels": "2px"
          }
        }
      }, [
        View({
          class: "display-flex flex-none align-items-center gap-space-3 padding-space-3-space-4",
          attributes: {
            n: "modal-header"
          }
        }, [
          header ? header() : View({
            as: "h2",
            class: "flex-1 min-width-0 margin-0 overflow-wrap-anywhere font-size-font-size-lg font-weight-700 line-height-1-4 display-webkit-box webkit-box-orient-vertical webkit-line-clamp-2 overflow-hidden",
            attributes: {
              n: "modal-title",
              id: title_id
            }
          }, [title]),
          IconButton({
            icon: "x",
            label: "关闭",
            size: close_size,
            attributes: {
              n: "modal-close"
            },
            onClick: model.close
          }),
        ]),
        Show({
          when: computed(progress, value => value !== undefined && value !== null),
          ok: () => View({
            class: "flex-none height-3-pixels background-color-surface-hover",
            attributes: {
              n: "modal-reading-progress",
              role: "progressbar",
              "aria-label": "阅读进度",
              "aria-valuemin": "0",
              "aria-valuemax": "100",
              "aria-valuenow": computed(progress, value => Math.round(value * 100))
            },
            style: {
              ...{
                "--height-3-pixels": "3px"
              }
            }
          }, [View({
            class: "height-100-percent background-color-primary transform-origin-left-center",
            attributes: {
              n: "modal-reading-progress-fill"
            },
            style: computed(progress, value => ({
              transform: `scaleX(${Math.max(0, Math.min(1, value))})`
            })),
          })]),
        }),
        View({
          class: "display-flex flex-direction-column flex-1 min-height-0 overflow-auto",
          attributes: {
            n: "modal-body"
          }
        }, [content]),
      ])])]);
    },
  });
}

export {
  Modal
};
