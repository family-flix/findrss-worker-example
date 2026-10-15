import {
  atomic_classes
} from "./atomic.js";
const {
  ref,
  computed,
  combine
} = Timeless;
import {
  IconButton
} from "./icon-button.js";
import {
  frui_host
} from "./platform.js";

export function CopyButton({
  onCopy,
  onError,
  label = "复制",
  host = frui_host,
  disabled = false,
  class: custom_class,
  attributes = {},
  ...props
}) {
  const copied = ref(false),
    busy = ref(false);
  let timer = null,
    active = true;

  function clear_timer() {
    if (timer !== null) host.clear_timeout(timer);
    timer = null;
  }
  const status = combine({
    copied,
    label
  }, value => value.copied ? "已复制" : value.label);
  return IconButton({
    ...props,
    icon: computed(copied, value => value ? "check" : "copy"),
    label: status,
    class: atomic_classes(combine({
        copied,
        custom_class
      }, value => ["", value.custom_class, value.copied ? "color-color-success hover-color-color-success" : ""].filter(Boolean)
      .join(" "))),
    disabled: combine({
      busy,
      disabled
    }, value => value.busy || value.disabled),
    attributes: {
      n: "copy-button",
      ...attributes,
      title: status,
      "aria-label": status
    },
    async onClick() {
      if (!onCopy || busy.value) return;
      busy.as(true);
      try {
        await onCopy();
        if (!active) return;
        clear_timer();
        copied.as(true);
        timer = host.set_timeout(() => {
          timer = null;
          copied.as(false);
        }, 2000);
      } catch (error) {
        if (active) {
          clear_timer();
          copied.as(false);
          onError?.(error);
        }
      } finally {
        if (active) busy.as(false);
      }
    },
    onUnmounted() {
      active = false;
      clear_timer();
      copied.destroy?.();
      busy.destroy?.();
      props.onUnmounted?.();
    },
  });
}
