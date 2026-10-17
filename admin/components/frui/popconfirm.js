const {
  View,
  ref,
  combine
} = Timeless;
import { source_value } from "./shared.js";
import {
  Button
} from "./button.js";
import {
  DropdownMenu
} from "./dropdown-menu.js";

function Popconfirm({
  trigger,
  title,
  confirmText = "确认删除",
  disabled,
  onConfirm,
  attributes = {}
}) {
  const name = attributes.n || "popconfirm";
  const pending = ref(false);
  const disabled_source = disabled?.__is_ref ? disabled : ref(Boolean(disabled));
  const busy = combine({ pending, disabled: disabled_source },
    ({ pending, disabled }) => pending || Boolean(disabled));
  return DropdownMenu({
    trigger,
    disabled: busy,
    onUnmounted() {
      busy.destroy?.();
      pending.destroy?.();
      if (disabled_source !== disabled) disabled_source.destroy?.();
    },
    align: "end",
    side: "top",
    attributes: {
      ...attributes,
      n: name,
      "aria-label": title
    },
    content({
      close
    }) {
      return View({
        class: "max-width-min-280-pixels-calc-100-vw-32-pixels padding-space-3 color-color-text font-size-font-size",
        attributes: {
          n: `${name}-content`
        },
        onMounted(event) {
          const element = event.target?.get$elm?.() || event.target;
          element?.querySelector("button")?.focus();
        },
        style: {
          ...{
            "--max-width-min-280-pixels-calc-100-vw-32-pixels": "min(280px,calc(100vw - 32px))"
          }
        }
      }, [
        View({
          attributes: {
            n: `${name}-title`
          }
        }, [title]),
        View({
          class: "display-flex justify-content-flex-end gap-space-2 margin-top-space-3",
          attributes: {
            n: `${name}-actions`
          }
        }, [
          Button({
            disabled: busy,
            attributes: {
              n: `${name}-cancel`
            },
            onClick: close
          }, ["取消"]),
          Button({
            disabled: busy,
            variant: "danger",
            attributes: {
              n: `${name}-confirm`
            },
            async onClick() {
              if (pending.value || source_value(disabled, false)) return;
              pending.as(true);
              try {
                await onConfirm();
                close();
              } finally {
                pending.as(false);
              }
            }
          }, [confirmText]),
        ]),
      ]);
    },
  });
}

export {
  Popconfirm
};
