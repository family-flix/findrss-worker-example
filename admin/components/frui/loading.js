import {
  atomic_classes
} from "./atomic.js";
const {
  View,
  Show,
  computed
} = Timeless;
import {
  loading_art
} from "./loading-art.js";
import {
  as_children
} from "./shared.js";

Timeless.Icon.register({
  "findrss-loading": loading_art
});

/** Small, reusable brand status; the parent controls placement. */
export function Loading({
  label = "正在加载",
  size = "medium",
  class: custom_class,
  attributes = {}
} = {}) {
  const resolved_size = ["small", "large"].includes(size) ? size : "medium";
  return View({
    class: atomic_classes([
      "frui-loading-size-calc-space-4-4 display-inline-flex flex-direction-column align-items-center justify-content-center pointer-events-none user-select-none",
      `${{"small":"frui-loading-size-calc-space-5-2","large":"frui-loading-size-calc-space-6-4"}[resolved_size] || ""}`,
      custom_class
    ].filter(Boolean).join(" ")),
    attributes: {
      n: "loading",
      role: "status",
      "aria-label": label,
      ...attributes
    },
  }, [
    View({
      class: "display-grid place-items-center width-loading-size height-loading-size aspect-ratio-1",
      attributes: {
        n: "loading-art",
        "aria-hidden": "true"
      }
    }, [
      Timeless.Icon({
        name: "findrss-loading",
        size: "100%"
      }),
    ]),
  ]);
}

export function XiaoxunLoading({
  loading = true,
  label = "正在加载",
  size = "medium",
  class: custom_class,
  attributes = {}
} = {}, children = []) {
  const content = as_children(children);
  if (!content.length) return Show({
    when: loading,
    ok: () => Loading({
      label,
      size,
      class: atomic_classes(custom_class),
      attributes
    })
  });
  return View({
    class: atomic_classes([
      "position-relative isolation-isolate display-grid grid-template-columns-minmax-0-1fr grid-template-rows-minmax-0-1fr min-width-0 min-height-0",
      custom_class
    ].filter(Boolean).join(" ")),
    attributes: {
      n: "xiaoxun-loading",
      ...attributes,
      "aria-busy": computed(loading, String)
    },
  }, [
    View({
      class: "min-width-0 min-height-0",
      attributes: {
        n: "xiaoxun-loading-content"
      }
    }, content),
    Show({
      when: loading,
      ok: () => View({
        class: "position-absolute inset-0 z-index-1 display-grid place-items-center pointer-events-none",
        attributes: {
          n: "xiaoxun-loading-overlay"
        },
      }, [Loading({
        label,
        size
      })])
    }),
  ]);
}
